const express = require('express');
const router = express.Router();
const { requireAuthOrWorkspaceToken } = require('../middleware/auth');
const terminal = require('../services/terminal.service');

router.post('/', requireAuthOrWorkspaceToken, (req, res) => {
  const io = req.app.get('io');
  const {
    provider = 'unknown',
    event,
    terminalSessionId,
    cliSessionId,
    cwd,
    payload,
  } = req.body || {};

  if (!terminalSessionId || !event) {
    return res.status(400).json({ error: 'terminalSessionId and event are required.' });
  }

  terminal.applyAgentHookEvent(terminalSessionId, event, io, {
    provider,
    cliSessionId,
    cwd,
    kind: payload?.notification_type || payload?.notificationType || payload?.type || null,
    toolName: payload?.tool_name || payload?.toolName || null,
    raw: payload || {},
  });

  res.json({ ok: true });
});

module.exports = router;
