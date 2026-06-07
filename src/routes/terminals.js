const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
const terminal = require('../services/terminal.service');
const { getDB } = require('../db');
const { projects } = require('../db/schema');
const { eq } = require('drizzle-orm');

// GET /api/projects/:projectId/terminals — list sessions
router.get('/', requireAuth, (req, res) => {
  const projectId = parseInt(req.params.projectId);
  try {
    const sessions = terminal.listSessions(projectId);
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list terminal sessions.' });
  }
});

// POST /api/projects/:projectId/terminals — create a new session
router.post('/', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.projectId);
  try {
    const db = getDB();
    const proj = db.select().from(projects).where(eq(projects.id, projectId)).all()[0];
    if (!proj) return res.status(404).json({ error: 'Project not found.' });

    const io = req.app.get('io');
    const { sessionId, name } = await terminal.createSession(projectId, io);

    res.json({ sessionId, name, projectId });
  } catch (err) {
    console.error('[terminals] Create error:', err.message);
    res.status(500).json({ error: `Failed to create terminal: ${err.message}` });
  }
});

// DELETE /api/projects/:projectId/terminals/:sessionId — kill session
router.delete('/:sessionId', requireAuth, (req, res) => {
  const { sessionId } = req.params;
  terminal.killSession(sessionId);
  res.json({ success: true });
});

// PATCH /api/projects/:projectId/terminals/:sessionId — rename
router.patch('/:sessionId', requireAuth, (req, res) => {
  const { sessionId } = req.params;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  terminal.renameSession(sessionId, name.trim());
  res.json({ success: true });
});

module.exports = router;
