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

router.get('/updates/check', requireAuth, (req, res) => {
  const url = 'https://api.github.com/repos/Karlmit/Opus-Command/releases/latest';
  const req2 = https.get(url, { headers: { 'User-Agent': 'OpusCommand' } }, (resp) => {
    let data = '';
    resp.on('data', chunk => { data += chunk; });
    resp.on('end', () => {
      try {
        const release = JSON.parse(data);
        const latest = release.tag_name?.replace(/^v/, '');
        const current = APP_VERSION.replace(/^v/, '');
        res.json({ current, latest, url: release.html_url });
      } catch {
        res.status(502).json({ error: 'Could not parse GitHub response.' });
      }
    });
  });
  req2.on('error', () => {
    res.status(502).json({ error: 'Could not check for updates. Check your internet connection.' });
  });
  req2.setTimeout(10000, () => {
    req2.destroy();
    res.status(502).json({ error: 'Could not check for updates. Check your internet connection.' });
  });
});

module.exports = router;
