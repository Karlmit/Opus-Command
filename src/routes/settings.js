const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getSetting, setSetting } = require('../services/auth.service');
const { APP_VERSION } = require('../config');
const https = require('https');

// Selectable theme ids (see client/src/lib/themes.js). Legacy values from
// older clients are normalized onto current ids rather than rejected.
const THEME_IDS = [
  'opus-dark', 'opus-light',
  'catppuccin-latte', 'catppuccin-frappe', 'catppuccin-macchiato', 'catppuccin-mocha',
];
const LEGACY_THEMES = { dark: 'opus-dark', light: 'opus-light', system: 'opus-dark' };
const normalizeTheme = (id) =>
  THEME_IDS.includes(id) ? id : (LEGACY_THEMES[id] || null);

router.get('/theme', requireAuth, (req, res) => {
  const theme = normalizeTheme(getSetting('theme')) || 'opus-dark';
  res.json({ theme });
});

router.post('/theme', requireAuth, (req, res) => {
  const theme = normalizeTheme(req.body.theme);
  if (!theme) {
    return res.status(400).json({ error: 'Invalid theme.' });
  }
  setSetting('theme', theme);
  res.json({ success: true, theme });
});

router.get('/sound', requireAuth, (req, res) => {
  const enabled = getSetting('sound_enabled') === 'true';
  const sound = getSetting('sound_choice') || 'chime';
  res.json({ enabled, sound });
});

router.post('/sound', requireAuth, (req, res) => {
  const { enabled, sound } = req.body;
  setSetting('sound_enabled', String(!!enabled));
  if (sound) setSetting('sound_choice', sound);
  res.json({ success: true });
});

// ── Workspace environment variables (injected into all workspace containers) ──

router.get('/workspace-env', requireAuth, (req, res) => {
  try {
    const raw = getSetting('workspace_env_vars');
    const vars = raw ? JSON.parse(raw) : [];
    // Never return values — client gets keys only for display; values shown masked
    res.json({ vars });
  } catch {
    res.json({ vars: [] });
  }
});

router.post('/workspace-env', requireAuth, (req, res) => {
  const { vars } = req.body; // [{ key, value }]
  if (!Array.isArray(vars)) return res.status(400).json({ error: 'vars must be an array.' });

  const incoming = vars
    .filter(v => v.key && v.key.trim())
    .map(v => ({ key: v.key.trim().toUpperCase(), value: v.value || '' }));

  // Merge with existing: non-empty value = upsert, empty value = remove key, missing = preserve
  let existing = [];
  try { existing = JSON.parse(getSetting('workspace_env_vars') || '[]'); } catch {}
  const map = Object.fromEntries(existing.map(v => [v.key, v.value]));
  for (const { key, value } of incoming) {
    if (value) map[key] = value;
    else delete map[key];
  }
  const merged = Object.entries(map).map(([key, value]) => ({ key, value }));
  setSetting('workspace_env_vars', JSON.stringify(merged));
  res.json({ success: true, count: merged.length });
});

router.get('/version', requireAuth, (req, res) => {
  res.json({ version: APP_VERSION });
});

router.post('/updates/apply', requireAuth, async (req, res) => {
  const { selfUpdate } = require('../services/docker.service');
  const io = req.app.get('io');

  // Stream progress to the client via Socket.io while the pull happens
  const onProgress = (event) => {
    if (io) io.emit('self-update:progress', event);
  };

  try {
    const result = await selfUpdate(onProgress);
    if (result.alreadyLatest) {
      return res.json({ alreadyLatest: true, message: 'Already running the latest version.' });
    }
    // "updating: true" means the restart timer is armed — connection will drop soon
    res.json({ updating: true, message: 'Update started. Reconnecting in a few seconds…' });
  } catch (err) {
    console.error('[self-update] Error:', err.message);
    res.status(500).json({ error: `Update failed: ${err.message}` });
  }
});

function fetchJson(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'OpusCommand', ...extraHeaders },
    }, (resp) => {
      // Follow redirects
      if (resp.statusCode === 301 || resp.statusCode === 302) {
        return fetchJson(resp.headers.location, extraHeaders).then(resolve, reject);
      }
      let data = '';
      resp.on('data', c => { data += c; });
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`JSON parse error: ${e.message} — body: ${data.slice(0, 100)}`)); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Fetch the image config digest from GHCR for the given image.
// The config digest is the sha256 of the image configuration blob —
// identical to what `docker inspect --format '{{.Id}}'` returns.
// Comparing this with selfInfo.Image detects ANY new image push,
// regardless of manifest list vs single-arch format.
async function getRemoteImageConfigDigest(imageName) {
  // ghcr.io/karlmit/opus-command:latest → repo=karlmit/opus-command, tag=latest
  const withoutHost = imageName.replace(/^ghcr\.io\//, '');
  const colonIdx = withoutHost.lastIndexOf(':');
  const repo = colonIdx >= 0 ? withoutHost.slice(0, colonIdx) : withoutHost;
  const tag  = colonIdx >= 0 ? withoutHost.slice(colonIdx + 1) : 'latest';

  // Anonymous pull token for public GHCR packages
  const tokenData = await fetchJson(
    `https://ghcr.io/token?scope=repository:${repo}:pull&service=ghcr.io`
  );
  const token = tokenData.token;
  if (!token) throw new Error('No token from GHCR');

  const ACCEPTS = [
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json',
    'application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.v2+json',
  ].join(', ');

  // Fetch the top-level manifest (may be a list or a single manifest)
  const manifest = await fetchJson(
    `https://ghcr.io/v2/${repo}/manifests/${tag}`,
    { Authorization: `Bearer ${token}`, Accept: ACCEPTS }
  );

  // Manifest list / OCI index → find the linux/amd64 platform manifest
  if (Array.isArray(manifest.manifests)) {
    const amd64 = manifest.manifests.find(m =>
      m.platform?.os === 'linux' && m.platform?.architecture === 'amd64'
    ) || manifest.manifests[0];

    if (amd64?.digest) {
      const platManifest = await fetchJson(
        `https://ghcr.io/v2/${repo}/manifests/${amd64.digest}`,
        { Authorization: `Bearer ${token}`, Accept: amd64.mediaType || ACCEPTS }
      );
      return platManifest.config?.digest || null;
    }
  }

  // Single-arch manifest — config.digest is what we want
  return manifest.config?.digest || null;
}

router.get('/updates/check', requireAuth, async (req, res) => {
  try {
    const os = require('os');
    const { docker } = require('../services/docker.service');

    // 1. GitHub releases — what is the latest tagged release?
    let githubRelease = null;
    try {
      githubRelease = await fetchJson(
        'https://api.github.com/repos/Karlmit/Opus-Command/releases/latest'
      );
    } catch (_) {}

    const latestRelease = githubRelease?.tag_name?.replace(/^v/, '') || null;
    const releaseUrl    = githubRelease?.html_url || null;

    // 2. Image config digest check — detects ANY new push to :latest.
    //    selfInfo.Image = sha256 of the image config blob.
    //    getRemoteImageConfigDigest() fetches the same value from GHCR.
    //    If they differ, a new image is available regardless of version number.
    let digestChanged    = false;
    let localConfigHash  = null;
    let remoteConfigHash = null;
    let digestError      = null;

    try {
      const selfInfo  = await docker.getContainer(os.hostname()).inspect();
      const imageName = selfInfo.Config.Image;
      localConfigHash = selfInfo.Image; // sha256:abc123...

      if (imageName.startsWith('ghcr.io/')) {
        remoteConfigHash = await getRemoteImageConfigDigest(imageName);
        digestChanged = !!(remoteConfigHash && localConfigHash && remoteConfigHash !== localConfigHash);
      }
    } catch (err) {
      digestError = err.message;
      console.warn('[updates] Digest check failed:', err.message);
    }

    const current = APP_VERSION.replace(/^v/, '');

    res.json({
      current,
      latest:       latestRelease,
      url:          releaseUrl,
      digestChanged,
      // Short hashes for display — same 8-char format Unraid/Watchtower shows
      localHash:  localConfigHash?.replace('sha256:', '').slice(0, 8)  || null,
      remoteHash: remoteConfigHash?.replace('sha256:', '').slice(0, 8) || null,
      digestError: digestError || undefined,
    });
  } catch (err) {
    res.status(502).json({ error: 'Could not check for updates. Check your internet connection.' });
  }
});

module.exports = router;
