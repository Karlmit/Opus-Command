const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { getDB } = require('../db');
const { projects, terminalSessions, activityLog } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { PROJECTS_DIR } = require('../config');
const docker = require('../services/docker.service');

// GET /api/projects — list all projects with live status
router.get('/', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const rows = db.select().from(projects).all();

    const projectsWithStatus = await Promise.all(rows.map(async p => {
      const status = await docker.getContainerStatus(p.id).catch(() => 'stopped');
      return {
        id: p.id,
        name: p.name,
        folderPath: p.folderPath,
        template: p.template,
        avatar: p.avatar || '',
        status,
        terminalCount: 0,
        aiWaiting: 0,
        aiActive: 0,
      };
    }));

    res.json({ projects: projectsWithStatus });
  } catch (err) {
    console.error('[projects] List error:', err);
    res.status(500).json({ error: 'Failed to fetch projects.' });
  }
});

// POST /api/projects — create a new project
router.post('/', requireAuth, async (req, res) => {
  try {
    const { name, folder } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Project name is required.' });
    if (!folder || !folder.trim()) return res.status(400).json({ error: 'Project folder is required.' });

    // Validate folder path is within /projects
    const folderPath = folder.trim().replace(/^\//, '');
    const resolved = path.resolve(PROJECTS_DIR, folderPath);
    if (!resolved.startsWith(PROJECTS_DIR)) {
      return res.status(403).json({ error: 'Access denied. The path is outside the project folder.' });
    }

    // Create folder if it doesn't exist
    fs.mkdirSync(resolved, { recursive: true });

    const db = getDB();
    const now = Date.now();
    const inserted = db.insert(projects).values({
      name: name.trim(),
      folderPath,
      template: 'claude-code',
      status: 'starting',
      createdAt: now,
    }).returning().all();

    const project = inserted[0];

    // Provision workspace container asynchronously
    docker.createWorkspaceContainer(project.id, folderPath)
      .then(async ({ containerId, homeVolume }) => {
        db.update(projects).set({
          containerId,
          homeVolume,
          status: 'starting',
        }).where(eq(projects.id, project.id)).run();

        await docker.startContainer(project.id);

        db.update(projects).set({ status: 'running' }).where(eq(projects.id, project.id)).run();

        // Emit status update via Socket.io
        const io = req.app.get('io');
        if (io) io.emit('project:status', { id: project.id, status: 'running' });

        // Log activity
        db.insert(activityLog).values({
          projectId: project.id,
          type: 'workspace_started',
          message: 'Workspace container started.',
          createdAt: Date.now(),
        }).run();
      })
      .catch(err => {
        console.error('[projects] Container provisioning error:', err.message);
        db.update(projects).set({ status: 'error' }).where(eq(projects.id, project.id)).run();
        const io = req.app.get('io');
        if (io) io.emit('project:status', { id: project.id, status: 'error' });
      });

    res.json({
      id: project.id,
      name: project.name,
      folderPath: project.folderPath,
      template: project.template,
      status: 'starting',
      terminalCount: 0,
      aiWaiting: 0,
    });
  } catch (err) {
    console.error('[projects] Create error:', err);
    res.status(500).json({ error: 'Failed to create project.' });
  }
});

// GET /api/projects/:id — project detail
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const rows = db.select().from(projects).where(eq(projects.id, parseInt(req.params.id))).all();
    if (!rows.length) return res.status(404).json({ error: 'Project not found.' });

    const p = rows[0];
    const status = await docker.getContainerStatus(p.id).catch(() => 'stopped');

    // Get recent activity
    const activity = db.select().from(activityLog)
      .where(eq(activityLog.projectId, p.id))
      .all()
      .slice(-20)
      .reverse();

    res.json({
      id: p.id,
      name: p.name,
      folderPath: p.folderPath,
      template: p.template,
      status,
      terminalCount: 0,
      aiCount: 0,
      gitBranch: null,
      changedFiles: 0,
      activity,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch project.' });
  }
});

// PATCH /api/projects/:id — update name or avatar
router.patch('/:id', requireAuth, (req, res) => {
  const projectId = parseInt(req.params.id);
  try {
    const db = getDB();
    const { name, avatar } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (avatar !== undefined) updates.avatar = avatar;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update.' });
    db.update(projects).set(updates).where(eq(projects.id, projectId)).run();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Update failed.' });
  }
});

// POST /api/projects/:id/lifecycle — workspace lifecycle actions
router.post('/:id/lifecycle', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id);
  const { action } = req.body;

  try {
    const db = getDB();
    const rows = db.select().from(projects).where(eq(projects.id, projectId)).all();
    if (!rows.length) return res.status(404).json({ error: 'Project not found.' });

    const project = rows[0];
    const io = req.app.get('io');

    function emitStatus(status) {
      db.update(projects).set({ status }).where(eq(projects.id, projectId)).run();
      if (io) io.emit('project:status', { id: projectId, status });
    }

    switch (action) {
      case 'start':
        emitStatus('starting');
        await docker.startContainer(projectId);
        emitStatus('running');
        break;

      case 'stop':
        await docker.stopContainer(projectId);
        emitStatus('stopped');
        break;

      case 'restart':
        emitStatus('starting');
        await docker.restartContainer(projectId);
        emitStatus('running');
        break;

      case 'recreate': {
        emitStatus('starting');
        const { containerId: newId } = await docker.recreateContainer(projectId, project.folderPath);
        db.update(projects).set({ containerId: newId }).where(eq(projects.id, projectId)).run();
        emitStatus('running');
        break;
      }
      case 'rebuild': {
        emitStatus('starting');
        const { containerId: rebuiltId } = await docker.rebuildContainer(projectId, project.folderPath);
        db.update(projects).set({ containerId: rebuiltId }).where(eq(projects.id, projectId)).run();
        emitStatus('running');
        break;
      }
      case 'reset': {
        emitStatus('starting');
        const { containerId: resetId } = await docker.resetEnvironment(projectId, project.folderPath);
        db.update(projects).set({ containerId: resetId }).where(eq(projects.id, projectId)).run();
        emitStatus('running');
        break;
      }

      default:
        return res.status(400).json({ error: 'Invalid lifecycle action.' });
    }

    db.insert(activityLog).values({
      projectId,
      type: `lifecycle_${action}`,
      message: `Workspace ${action} completed.`,
      createdAt: Date.now(),
    }).run();

    res.json({ success: true, status: action === 'stop' ? 'stopped' : 'running' });
  } catch (err) {
    console.error('[projects] Lifecycle error:', err.message);
    res.status(500).json({ error: `Docker operation failed: ${err.message}` });
  }
});

// GET /api/projects/:id/logs — container logs
router.get('/:id/logs', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id);
  try {
    const logs = await docker.getContainerLogs(projectId, parseInt(req.query.tail || 200));
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch logs: ${err.message}` });
  }
});

// DELETE /api/projects/:id — delete project (keep files on disk)
router.delete('/:id', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id);
  try {
    const db = getDB();
    const rows = db.select().from(projects).where(eq(projects.id, projectId)).all();
    if (!rows.length) return res.status(404).json({ error: 'Project not found.' });

    // Remove Docker resources (container + home volume)
    await docker.removeWorkspace(projectId).catch(err => {
      console.warn('[projects] Docker cleanup warning:', err.message);
    });

    // Remove from DB (cascade deletes terminal sessions + activity)
    db.delete(projects).where(eq(projects.id, projectId)).run();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to delete project: ${err.message}` });
  }
});

module.exports = router;
