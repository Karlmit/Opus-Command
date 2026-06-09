const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { requireAuth, requireAuthOrWorkspaceToken } = require('../middleware/auth');
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
      capabilities: req.body.capabilities,
    });
    res.json(registration);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Connector registration failed.' });
  }
});

router.get('/', requireAuthOrWorkspaceToken, (req, res) => {
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

router.get('/jobs/:jobId', requireAuthOrWorkspaceToken, (req, res) => {
  const job = connectors.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json({ job });
});

router.get('/jobs', requireAuthOrWorkspaceToken, (req, res) => {
  const jobs = connectors.listJobs({
    connectorId: req.query.connectorId,
    projectId: req.query.projectId,
    limit: req.query.limit,
  });
  res.json({ jobs });
});

router.post('/jobs/:jobId/cancel', requireAuthOrWorkspaceToken, (req, res) => {
  try {
    const job = connectors.cancelJob(req.params.jobId);
    res.json({ job });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Job cancellation failed.' });
  }
});

router.get('/artifacts/:artifactId/download', requireAuthOrWorkspaceToken, (req, res) => {
  const artifact = connectors.getArtifact(req.params.artifactId);
  if (!artifact || !fs.existsSync(artifact.path)) {
    return res.status(404).json({ error: 'Artifact not found.' });
  }
  res.download(artifact.path, artifact.name);
});

router.get('/:connectorId', requireAuthOrWorkspaceToken, (req, res) => {
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

router.post('/:connectorId/jobs', requireAuthOrWorkspaceToken, async (req, res) => {
  try {
    const { command, shell, cwd, env, args, stdin, script, projectId, timeoutMs } = req.body;
    if ((!command || !command.trim()) && !script?.content) {
      return res.status(400).json({ error: 'Command or script is required.' });
    }

    const { job, completion } = connectors.createJob({
      connectorId: req.params.connectorId,
      userId: req.session?.userId || null,
      projectId,
      shell,
      command,
      cwd,
      env,
      args,
      stdin,
      script,
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

router.get('/:connectorId/files/download', requireAuthOrWorkspaceToken, async (req, res) => {
  try {
    const requestedPath = String(req.query.path || '');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(requestedPath) || 'download.bin')}"`);
    await connectors.streamConnectorFile(req.params.connectorId, requestedPath, res);
  } catch (err) {
    if (!res.headersSent) {
      res.status(err.status || 500).json({ error: err.message || 'File download failed.' });
    } else {
      res.destroy(err);
    }
  }
});

router.post('/:connectorId/files/upload', requireAuthOrWorkspaceToken, async (req, res) => {
  try {
    const isRaw = (req.headers['content-type'] || '').startsWith('application/octet-stream');
    const result = isRaw
      ? await connectors.streamUploadConnectorFile(req.params.connectorId, {
          filePath: req.query.path || req.headers['x-opus-connector-path'],
          readable: req,
          mode: req.query.mode || req.headers['x-opus-connector-mode'],
        })
      : await connectors.writeConnectorFile(req.params.connectorId, {
          filePath: req.body.path,
          contentBase64: req.body.contentBase64,
          mode: req.body.mode,
        });
    res.json({ file: result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'File upload failed.' });
  }
});

router.post('/:connectorId/feedback', requireAuthOrWorkspaceToken, async (req, res) => {
  try {
    const result = await connectors.createFeedback(req.params.connectorId, {
      title: req.body.title,
      message: req.body.message,
      severity: req.body.severity,
      reporter: req.body.reporter,
      workspace: req.body.workspace,
      command: req.body.command,
      connectorSelector: req.body.connectorSelector,
      context: req.body.context,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Feedback submission failed.' });
  }
});

router.get('/:connectorId/feedback', requireAuthOrWorkspaceToken, async (req, res) => {
  try {
    const result = await connectors.listFeedback(req.params.connectorId, {
      includeRead: req.query.includeRead !== 'false',
      limit: req.query.limit,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Feedback list failed.' });
  }
});

router.post('/:connectorId/feedback/:feedbackId/read', requireAuthOrWorkspaceToken, async (req, res) => {
  try {
    const result = await connectors.markFeedbackRead(
      req.params.connectorId,
      req.params.feedbackId,
      req.body.read !== false
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Feedback update failed.' });
  }
});

module.exports = router;
