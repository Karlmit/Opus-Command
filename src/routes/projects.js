const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { getDB } = require('../db');
const { projects } = require('../db/schema');
const { eq } = require('drizzle-orm');

router.get('/', requireAuth, (req, res) => {
  try {
    const db = getDB();
    const rows = db.select().from(projects).all();
    res.json({ projects: rows.map(p => ({
      id: p.id,
      name: p.name,
      folderPath: p.folderPath,
      template: p.template,
      status: p.status || 'stopped',
      terminalCount: 0,
      aiWaiting: 0,
    })) });
  } catch (err) {
    console.error('[projects] Error:', err);
    res.status(500).json({ error: 'Failed to fetch projects.' });
  }
});

router.post('/', requireAuth, (req, res) => {
  try {
    const { name, folder, template } = req.body;
    if (!name || !folder || !template) {
      return res.status(400).json({ error: 'Name, folder, and template are required.' });
    }

    const db = getDB();
    const result = db.insert(projects).values({
      name: name.trim(),
      folderPath: folder.trim(),
      template,
      status: 'stopped',
      createdAt: Date.now(),
    }).returning().all();

    const project = result[0];
    res.json({
      id: project.id,
      name: project.name,
      folderPath: project.folderPath,
      template: project.template,
      status: project.status,
      terminalCount: 0,
      aiWaiting: 0,
    });
  } catch (err) {
    console.error('[projects] Create error:', err);
    res.status(500).json({ error: 'Failed to create project.' });
  }
});

router.get('/:id', requireAuth, (req, res) => {
  try {
    const db = getDB();
    const rows = db.select().from(projects).where(eq(projects.id, parseInt(req.params.id))).all();
    if (!rows.length) return res.status(404).json({ error: 'Project not found.' });
    const p = rows[0];
    res.json({ id: p.id, name: p.name, folderPath: p.folderPath, template: p.template, status: p.status });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch project.' });
  }
});

router.delete('/:id', requireAuth, (req, res) => {
  try {
    const db = getDB();
    db.delete(projects).where(eq(projects.id, parseInt(req.params.id))).run();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete project.' });
  }
});

module.exports = router;
