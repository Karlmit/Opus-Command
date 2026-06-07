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

router.get('/version', requireAuth, (req, res) => {
  res.json({ version: APP_VERSION });
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
