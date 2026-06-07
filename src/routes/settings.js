const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getSetting, setSetting } = require('../services/auth.service');
const { APP_VERSION } = require('../config');
const https = require('https');

router.get('/theme', requireAuth, (req, res) => {
  const theme = getSetting('theme') || 'dark';
  res.json({ theme });
});

router.post('/theme', requireAuth, (req, res) => {
  const { theme } = req.body;
  if (!['dark', 'light', 'system'].includes(theme)) {
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

  const filtered = vars
    .filter(v => v.key && v.key.trim())
    .map(v => ({ key: v.key.trim().toUpperCase(), value: v.value || '' }));

  setSetting('workspace_env_vars', JSON.stringify(filtered));
  res.json({ success: true, count: filtered.length });
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

// Fetch a URL, return parsed JSON
function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'OpusCommand', ...headers } }, (resp) => {
      let data = '';
      resp.on('data', c => { data += c; });
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Check the GHCR registry manifest digest for our own image.
// This detects ANY new push to :latest, not just tagged releases.
async function getGhcrDigest(imageName) {
  // imageName: ghcr.io/karlmit/opus-command:latest
  const parts = imageName.replace('ghcr.io/', '').split(':');
  const repo  = parts[0];
  const tag   = parts[1] || 'latest';

  // Anonymous token for public GHCR packages
  const tokenData = await fetchJson(
    `https://ghcr.io/token?scope=repository:${repo}:pull&service=ghcr.io`
  );
  const token = tokenData.token;

  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://ghcr.io/v2/${repo}/manifests/${tag}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.docker.distribution.manifest.v2+json',
          'User-Agent': 'OpusCommand',
        },
      },
      (resp) => {
        // The digest is in the response header, no need to read the body
        resolve(resp.headers['docker-content-digest'] || null);
        resp.resume(); // drain
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
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

    // 2. GHCR digest — has the :latest image changed since we last pulled?
    let digestChanged = false;
    let localDigest   = null;
    let remoteDigest  = null;
    try {
      const selfInfo  = await docker.getContainer(os.hostname()).inspect();
      const imageName = selfInfo.Config.Image; // ghcr.io/karlmit/opus-command:latest
      localDigest  = selfInfo.Image;            // sha256:... of running image layers

      // Get the local image's RepoDigests (what digest it was pulled as)
      const imageInfo = await docker.getImage(imageName).inspect();
      const localPulledDigest = (imageInfo.RepoDigests || [])[0]?.split('@')[1] || null;

      remoteDigest = await getGhcrDigest(imageName);
      digestChanged = remoteDigest && localPulledDigest && remoteDigest !== localPulledDigest;
    } catch (_) {
      // Docker not available or image not from GHCR — fall back to version compare only
    }

    const current = APP_VERSION.replace(/^v/, '');

    res.json({
      current,
      latest: latestRelease,
      url: releaseUrl,
      digestChanged,   // true = new image on GHCR even if version number is same
      localDigest: localDigest?.slice(0, 19),   // short, just for display
      remoteDigest: remoteDigest?.slice(0, 19),
    });
  } catch (err) {
    res.status(502).json({ error: 'Could not check for updates. Check your internet connection.' });
  }
});

module.exports = router;
