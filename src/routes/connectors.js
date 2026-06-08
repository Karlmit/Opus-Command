const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const connectors = require('../services/connectors.service');

router.post('/register', (req, res) => {
  try {
    const registration = connectors.registerConnector({
      pairingToken: req.body.pairingToken,
      name: req.body.name,
      platform: req.body.platform,
      hostname: req.body.hostname,
      version: req.body.version,
      labels: req.body.labels,
    });
    res.json(registration);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Connector registration failed.' });
  }
});

router.get('/', requireAuth, (req, res) => {
  res.json({ connectors: connectors.listConnectors() });
});

router.post('/pairing-token', requireAuth, (req, res) => {
  try {
    const token = connectors.createPairingToken({
      name: req.body.name,
      ttlMinutes: req.body.ttlMinutes,
      createdBy: req.session.userId,
    });
    res.json(token);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create pairing token.' });
  }
});

router.get('/jobs/:jobId', requireAuth, (req, res) => {
  const job = connectors.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json({ job });
});

router.get('/:connectorId', requireAuth, (req, res) => {
  const connector = connectors.getConnector(req.params.connectorId);
  if (!connector) return res.status(404).json({ error: 'Connector not found.' });
  res.json({ connector });
});

router.patch('/:connectorId', requireAuth, (req, res) => {
  try {
    const connector = connectors.updateConnector(req.params.connectorId, {
      name: req.body.name,
      labels: req.body.labels,
    });
    res.json({ connector });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Connector update failed.' });
  }
});

router.post('/:connectorId/jobs', requireAuth, async (req, res) => {
  try {
    const { command, shell, cwd, projectId, timeoutMs } = req.body;
    if (!command || !command.trim()) {
      return res.status(400).json({ error: 'Command is required.' });
    }

    const { job, completion } = connectors.createJob({
      connectorId: req.params.connectorId,
      userId: req.session.userId,
      projectId,
      shell,
      command,
      cwd,
      timeoutMs,
    });

    if (req.query.wait === 'false') {
      return res.status(202).json({ jobId: job.id });
    }

    const result = await completion;
    res.json({ job: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Connector job failed.' });
  }
});

module.exports = router;
