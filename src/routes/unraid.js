/**
 * unraid.js — Settings → Workspace Backends → Unraid LXC.
 *
 * Configuration, SSH connection test, preflight, and helper install for the
 * Unraid LXC backend. The SSH private key is write-only from the client's
 * perspective: it can be pasted/uploaded but never read back.
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const lxcConfig = require('../services/unraid-lxc.config');
const lxc = require('../services/unraid-lxc.service');
const ssh = require('../services/ssh.service');

// GET /api/settings/unraid — current config (no secrets)
router.get('/', requireAuth, (req, res) => {
  res.json({ config: lxcConfig.getPublicConfig() });
});

// POST /api/settings/unraid — save config; optional privateKey is written to disk
router.post('/', requireAuth, (req, res) => {
  try {
    const { privateKey, ...patch } = req.body || {};
    const config = lxcConfig.saveConfig(patch);
    let keyWritten = false;
    if (privateKey && String(privateKey).trim()) {
      lxcConfig.writePrivateKey(privateKey);
      keyWritten = true;
    }
    res.json({ success: true, keyWritten, config: lxcConfig.getPublicConfig() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/settings/unraid/test — SSH connectivity check
router.post('/test', requireAuth, async (req, res) => {
  try {
    const result = await ssh.testConnection();
    res.json(result);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// POST /api/settings/unraid/preflight — full backend readiness check
router.post('/preflight', requireAuth, async (req, res) => {
  try {
    const report = await lxc.preflight();
    res.json(report);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/settings/unraid/install — (re)install the opus-lxc helper script
router.post('/install', requireAuth, async (req, res) => {
  try {
    const path = await lxc.installHelper();
    res.json({ ok: true, path });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
