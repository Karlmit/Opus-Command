const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
const { getDB } = require('../db');
const { projects } = require('../db/schema');
const { eq } = require('drizzle-orm');
const cdesktop = require('../services/cdesktop.service');

function configuredOrigin(req) {
  return process.env.OPUS_EXTERNAL_ORIGIN ||
    process.env.PUBLIC_URL ||
    process.env.OPUS_COMMAND_URL ||
    req.get('origin') ||
    `${req.protocol}://${req.get('host')}`;
}

function getProject(projectId) {
  const db = getDB();
  return db.select().from(projects).where(eq(projects.id, projectId)).all()[0] || null;
}

function projectGuard(req, res, next) {
  const projectId = parseInt(req.params.projectId || req.params.id, 10);
  if (!Number.isInteger(projectId)) return res.status(400).json({ error: 'Invalid project id.' });
  const project = getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  req.projectId = projectId;
  next();
}

router.get('/status', requireAuth, projectGuard, async (req, res) => {
  try {
    res.json(await cdesktop.getStatus(req.projectId));
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

router.post('/install', requireAuth, projectGuard, async (req, res) => {
  try {
    res.json(await cdesktop.install(req.projectId));
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

router.post('/update', requireAuth, projectGuard, async (req, res) => {
  try {
    res.json(await cdesktop.update(req.projectId, configuredOrigin(req)));
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

router.post('/start', requireAuth, projectGuard, async (req, res) => {
  try {
    res.json(await cdesktop.start(req.projectId, configuredOrigin(req)));
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

router.post('/stop', requireAuth, projectGuard, async (req, res) => {
  try {
    res.json(await cdesktop.stop(req.projectId));
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

router.post('/restart', requireAuth, projectGuard, async (req, res) => {
  try {
    res.json(await cdesktop.restart(req.projectId, configuredOrigin(req)));
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

router.get('/logs', requireAuth, projectGuard, async (req, res) => {
  try {
    res.json({ logs: await cdesktop.getLogs(req.projectId, req.query.tail || 200) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
