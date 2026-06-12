/**
 * unraid.js — Settings → Workspace Backends → Unraid LXC.
 *
 * Configuration, connection test, preflight, and helper install for the
 * Unraid LXC backend, for both transports (Opus Connect agent and legacy
 * SSH). Secrets are write-only from the client's perspective: the SSH private
 * key and the agent API key can be pasted but never read back.
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const lxcConfig = require('../services/unraid-lxc.config');
const lxc = require('../services/unraid-lxc.service');
const ssh = require('../services/ssh.service');
const agent = require('../services/unraid-agent.service');

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

// POST /api/settings/unraid/test — connectivity check for the active transport.
// In agent mode the first successful test pins the agent's TLS certificate
// fingerprint (trust-on-first-use); later tests verify against the pin.
router.post('/test', requireAuth, async (req, res) => {
  try {
    const cfg = lxcConfig.getConfig();
    if (cfg.connectionMode === 'agent') {
      const result = await agent.testConnection();
      if (result.ok && result.fingerprint && !cfg.agentFingerprint) {
        lxcConfig.saveConfig({ agentFingerprint: result.fingerprint });
        result.pinnedNow = true;
      }
      return res.json({ ...result, mode: 'agent' });
    }
    const result = await ssh.testConnection();
    res.json({ ...result, mode: 'ssh' });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// POST /api/settings/unraid/reset-fingerprint — forget the pinned agent
// certificate (e.g. after reinstalling the Opus Connect plugin). The next
// successful test pins the new one.
router.post('/reset-fingerprint', requireAuth, (req, res) => {
  const config = lxcConfig.saveConfig({ agentFingerprint: '' });
  res.json({ success: true, config });
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

// POST /api/settings/unraid/install — (re)install the opus-lxc helper script.
// In agent mode this is a no-op: the Opus Connect plugin ships the helper.
router.post('/install', requireAuth, async (req, res) => {
  try {
    const path = await lxc.installHelper();
    res.json({ ok: true, path });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
