const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { getDB } = require('../db');
const { projects, terminalSessions, activityLog } = require('../db/schema');
const { eq, asc } = require('drizzle-orm');
const { PROJECTS_DIR } = require('../config');
const docker = require('../services/docker.service');
const workspace = require('../services/workspace.service');
const lxcConfig = require('../services/unraid-lxc.config');
const terminal = require('../services/terminal.service');
const { getSetting, setSetting } = require('../services/auth.service');
const { ensurePlanningArea } = require('../services/project-files.service');

const WORKSPACE_BACKENDS = new Set(['docker', 'unraid_lxc']);

const CLAUDE_AZURE_ENV_KEYS = new Set([
  'CLAUDE_CODE_USE_FOUNDRY',
]);

function clearClaudeAzureEnvSettings() {
  let existing = [];
  try { existing = JSON.parse(getSetting('workspace_env_vars') || '[]'); } catch {}
  const filtered = existing.filter(v => {
    const key = String(v.key || '').toUpperCase();
    return !CLAUDE_AZURE_ENV_KEYS.has(key) && !key.startsWith('ANTHROPIC_');
  });
  setSetting('workspace_env_vars', JSON.stringify(filtered));
}

// Container paths the workspace owns — user volumes may not target these.
const RESERVED_CONTAINER_PATHS = new Set(['/workspace', '/root', '/']);

// Host path prefixes considered sensitive. Mounting these is allowed (it is a
// trusted, authenticated admin UI) but the API flags them so the UI can warn.
const SENSITIVE_HOST_PREFIXES = [
  '/root', '/etc', '/var/run', '/run/secrets', '/proc', '/sys',
  '/boot', '/var/run/docker.sock', '/home',
];

function isSensitiveHostPath(hostPath) {
  const p = String(hostPath || '');
  return SENSITIVE_HOST_PREFIXES.some(prefix => p === prefix || p.startsWith(prefix + '/'));
}

// Validate + normalize the user-supplied volume list. Returns
// { volumes } on success or { error } describing the first problem found.
function normalizeVolumes(input) {
  if (!Array.isArray(input)) return { error: 'volumes must be an array.' };
  const seen = new Set();
  const volumes = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return { error: 'Each volume must be an object.' };
    const hostPath = String(raw.hostPath || '').trim();
    const containerPath = String(raw.containerPath || '').trim();
    const description = String(raw.description || '').trim().slice(0, 200);
    const readOnly = raw.readOnly !== false; // default read-only

    if (!hostPath) return { error: 'Host path is required.' };
    if (!containerPath) return { error: 'Container path is required.' };
    if (!hostPath.startsWith('/')) return { error: `Host path must be absolute: ${hostPath}` };
    if (!containerPath.startsWith('/')) return { error: `Container path must be absolute: ${containerPath}` };
    if (RESERVED_CONTAINER_PATHS.has(containerPath.replace(/\/+$/, '') || '/')) {
      return { error: `Container path ${containerPath} is reserved by the workspace.` };
    }
    if (seen.has(containerPath)) return { error: `Duplicate container path: ${containerPath}` };
    seen.add(containerPath);

    volumes.push({ hostPath, containerPath, readOnly, description });
  }
  return { volumes };
}

function parseStoredVolumes(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// GET /api/projects/templates — list workspace templates
router.get('/templates', requireAuth, (req, res) => {
  res.json({
    templates: Object.values(docker.WORKSPACE_TEMPLATES).map(({ id, label, description }) => ({
      id,
      label,
      description,
    })),
  });
});

// GET /api/projects/backends — available workspace backends
router.get('/backends', requireAuth, (req, res) => {
  const cfg = lxcConfig.getPublicConfig();
  res.json({
    backends: [
      { id: 'docker', label: 'Docker', description: 'Portable Docker workspace (default).', available: true },
      {
        id: 'unraid_lxc',
        label: 'Unraid LXC',
        description: 'LXC container on your Unraid server over SSH.',
        available: !!(cfg.enabled && cfg.hasKey),
        reason: cfg.enabled ? (cfg.hasKey ? null : 'No SSH key configured.') : 'Disabled in Settings.',
      },
    ],
  });
});

// GET /api/projects — list all projects with live status
router.get('/', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const rows = db.select().from(projects).orderBy(asc(projects.sortOrder), asc(projects.id)).all();

    const projectsWithStatus = await Promise.all(rows.map(async p => {
      const status = await workspace.getStatus(p).catch(() => 'stopped');
      const aiSummary = terminal.getProjectAISummary(p.id);
      return {
        id: p.id,
        name: p.name,
        folderPath: p.folderPath,
        template: p.template,
        backend: workspace.backendOf(p),
        avatar: p.avatar || '',
        status,
        terminalCount: aiSummary.terminalCount,
        aiWaiting: aiSummary.aiWaiting,
        aiActive: aiSummary.aiActive,
        aiBusy: aiSummary.aiBusy,
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
    const requestedTemplate = req.body.template || 'claude-code';
    const template = docker.normalizeTemplate(requestedTemplate);
    if (template !== requestedTemplate) return res.status(400).json({ error: 'Invalid workspace template.' });
    if (!name || !name.trim()) return res.status(400).json({ error: 'Project name is required.' });
    if (!folder || !folder.trim()) return res.status(400).json({ error: 'Project folder is required.' });

    const backend = req.body.backend || 'docker';
    if (!WORKSPACE_BACKENDS.has(backend)) return res.status(400).json({ error: 'Invalid workspace backend.' });
    if (backend === 'unraid_lxc') {
      const cfg = lxcConfig.getPublicConfig();
      if (!cfg.enabled) return res.status(400).json({ error: 'Unraid LXC backend is disabled. Enable it in Settings → Workspace Backends.' });
      if (!cfg.hasKey) return res.status(400).json({ error: 'No SSH key configured for the Unraid LXC backend.' });
    }

    const folderPath = folder.trim().replace(/^\//, '');

    // Docker workspaces bind a folder under PROJECTS_DIR — validate + create it.
    // LXC workspaces live on the Unraid share; the helper creates that folder
    // remotely, so no local folder is created here.
    if (backend === 'docker') {
      const resolved = path.resolve(PROJECTS_DIR, folderPath);
      if (!resolved.startsWith(PROJECTS_DIR)) {
        return res.status(403).json({ error: 'Access denied. The path is outside the project folder.' });
      }
      ensurePlanningArea(resolved);
    }

    const db = getDB();
    const now = Date.now();
    // Place new projects at the end of the current ordering.
    const maxOrder = db.select().from(projects).all()
      .reduce((max, p) => Math.max(max, p.sortOrder || 0), 0);
    const inserted = db.insert(projects).values({
      name: name.trim(),
      folderPath,
      template,
      workspaceBackend: backend,
      lxcTemplate: backend === 'unraid_lxc' ? template : null,
      status: 'starting',
      sortOrder: maxOrder + 1,
      createdAt: now,
    }).returning().all();

    const project = inserted[0];
    const io = req.app.get('io');

    // Provision the workspace asynchronously via the backend dispatcher.
    workspace.create(project)
      .then(async (fields) => {
        db.update(projects).set({ ...fields, status: 'starting' }).where(eq(projects.id, project.id)).run();

        const merged = { ...project, ...fields };
        const status = await workspace.start(merged);

        db.update(projects).set({
          status,
          lxcStatus: backend === 'unraid_lxc' ? status : null,
          lastStartedAt: Date.now(),
        }).where(eq(projects.id, project.id)).run();
        if (io) io.emit('project:status', { id: project.id, status });

        db.insert(activityLog).values({
          projectId: project.id,
          type: 'workspace_started',
          message: backend === 'unraid_lxc' ? 'LXC workspace started.' : 'Workspace container started.',
          createdAt: Date.now(),
        }).run();

        // LXC: provision tools (node, Claude Code, …) in the background so the
        // workspace is usable immediately while the install runs.
        if (backend === 'unraid_lxc') {
          workspace.update(merged)
            .then(() => {
              db.update(projects).set({ lastUpdatedAt: Date.now() }).where(eq(projects.id, project.id)).run();
              db.insert(activityLog).values({
                projectId: project.id,
                type: 'workspace_updated',
                message: 'LXC workspace provisioned (tools installed).',
                createdAt: Date.now(),
              }).run();
            })
            .catch(err => console.warn('[projects] LXC background provision warning:', err.message));
        }
      })
      .catch(err => {
        console.error('[projects] Workspace provisioning error:', err.message);
        db.update(projects).set({ status: 'error' }).where(eq(projects.id, project.id)).run();
        if (io) io.emit('project:status', { id: project.id, status: 'error' });
      });

    res.json({
      id: project.id,
      name: project.name,
      folderPath: project.folderPath,
      template: project.template,
      backend,
      status: 'starting',
      terminalCount: 0,
      aiWaiting: 0,
      aiActive: 0,
      aiBusy: 0,
    });
  } catch (err) {
    console.error('[projects] Create error:', err);
    res.status(500).json({ error: 'Failed to create project.' });
  }
});

// PATCH /api/projects/reorder — persist a new project ordering
// Body: { order: [id, id, …] } — ids in the desired display order.
router.patch('/reorder', requireAuth, (req, res) => {
  try {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of project ids.' });

    const db = getDB();
    order.forEach((id, index) => {
      db.update(projects).set({ sortOrder: index + 1 }).where(eq(projects.id, parseInt(id))).run();
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[projects] Reorder error:', err);
    res.status(500).json({ error: 'Failed to reorder projects.' });
  }
});

// GET /api/projects/:id — project detail
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const rows = db.select().from(projects).where(eq(projects.id, parseInt(req.params.id))).all();
    if (!rows.length) return res.status(404).json({ error: 'Project not found.' });

    const p = rows[0];
    const status = await workspace.getStatus(p).catch(() => 'stopped');

    // Get recent activity
    const activity = db.select().from(activityLog)
      .where(eq(activityLog.projectId, p.id))
      .all()
      .slice(-20)
      .reverse();

    const aiSummary = terminal.getProjectAISummary(p.id);

    res.json({
      id: p.id,
      name: p.name,
      folderPath: p.folderPath,
      template: p.template,
      backend: workspace.backendOf(p),
      lxcContainerName: p.lxcContainerName || null,
      lxcProjectPath: p.lxcProjectPath || null,
      lastStartedAt: p.lastStartedAt || null,
      lastStoppedAt: p.lastStoppedAt || null,
      lastUpdatedAt: p.lastUpdatedAt || null,
      status,
      terminalCount: aiSummary.terminalCount,
      aiCount: aiSummary.aiBusy,
      aiActive: aiSummary.aiActive,
      aiWaiting: aiSummary.aiWaiting,
      aiBusy: aiSummary.aiBusy,
      gitBranch: null,
      changedFiles: 0,
      activity,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch project.' });
  }
});

// PATCH /api/projects/:id — update name, avatar, or workspace template
router.patch('/:id', requireAuth, (req, res) => {
  const projectId = parseInt(req.params.id);
  try {
    const db = getDB();
    const rows = db.select().from(projects).where(eq(projects.id, projectId)).all();
    if (!rows.length) return res.status(404).json({ error: 'Project not found.' });

    const { name, avatar, template } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (avatar !== undefined) updates.avatar = avatar;
    if (template !== undefined) {
      const templateId = docker.normalizeTemplate(template);
      if (templateId !== template) return res.status(400).json({ error: 'Invalid workspace template.' });
      updates.template = templateId;
      if (templateId === 'private') clearClaudeAzureEnvSettings();
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Nothing to update.' });
    db.update(projects).set(updates).where(eq(projects.id, projectId)).run();
    const updated = db.select().from(projects).where(eq(projects.id, projectId)).all()[0];
    res.json({ success: true, project: updated });
  } catch (err) {
    res.status(500).json({ error: 'Update failed.' });
  }
});

// GET /api/projects/:id/volumes — list extra volume mounts for a workspace
router.get('/:id/volumes', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id);
  try {
    const db = getDB();
    const rows = db.select().from(projects).where(eq(projects.id, projectId)).all();
    if (!rows.length) return res.status(404).json({ error: 'Project not found.' });

    const volumes = parseStoredVolumes(rows[0].volumes).map(v => ({
      ...v,
      sensitive: isSensitiveHostPath(v.hostPath),
    }));

    // Extra volume mounts are a Docker-only feature in V1. For LXC, report the
    // stored config as-is (the only mount is /workspace, handled by the helper).
    if (workspace.isLxc(rows[0])) {
      const status = await workspace.getStatus(rows[0]).catch(() => 'stopped');
      return res.json({ volumes, status, applied: true, backend: 'unraid_lxc' });
    }

    const status = await docker.getContainerStatus(projectId).catch(() => 'stopped');

    // Tell the UI whether the live container already reflects the saved config.
    const desired = docker.buildExtraBinds(parseStoredVolumes(rows[0].volumes));
    const current = (await docker.getContainerBinds(projectId))
      .filter(b => !b.endsWith(':/workspace') && !b.endsWith(':/root'));
    const applied = JSON.stringify([...desired].sort()) === JSON.stringify([...current].sort());

    res.json({ volumes, status, applied });
  } catch (err) {
    console.error('[projects] Volumes list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch volumes.' });
  }
});

// PUT /api/projects/:id/volumes — replace the extra volume mounts for a workspace.
// Persists the backend-neutral config. Volumes only take effect when the
// container is (re)created, so the response reports whether a restart is needed.
router.put('/:id/volumes', requireAuth, async (req, res) => {
  const projectId = parseInt(req.params.id);
  try {
    const db = getDB();
    const rows = db.select().from(projects).where(eq(projects.id, projectId)).all();
    if (!rows.length) return res.status(404).json({ error: 'Project not found.' });

    const result = normalizeVolumes(req.body.volumes);
    if (result.error) return res.status(400).json({ error: result.error });

    db.update(projects).set({ volumes: JSON.stringify(result.volumes) })
      .where(eq(projects.id, projectId)).run();

    const status = await docker.getContainerStatus(projectId).catch(() => 'stopped');
    const restartRequired = status === 'running';

    db.insert(activityLog).values({
      projectId,
      type: 'volumes_updated',
      message: `Workspace volumes updated (${result.volumes.length} mount${result.volumes.length === 1 ? '' : 's'}).`,
      createdAt: Date.now(),
    }).run();

    res.json({
      success: true,
      volumes: result.volumes.map(v => ({ ...v, sensitive: isSensitiveHostPath(v.hostPath) })),
      status,
      restartRequired,
      message: restartRequired
        ? 'Changing volumes requires recreating/restarting the workspace.'
        : 'Volumes saved. They will be applied the next time the workspace starts.',
    });
  } catch (err) {
    console.error('[projects] Volumes update error:', err.message);
    res.status(500).json({ error: 'Failed to update volumes.' });
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
    const volumes = parseStoredVolumes(project.volumes);
    const io = req.app.get('io');

    function emitStatus(status) {
      db.update(projects).set({ status }).where(eq(projects.id, projectId)).run();
      if (io) io.emit('project:status', { id: projectId, status });
    }

    // ── Unraid LXC backend — start/stop/restart/update/status over SSH ──────────
    if (workspace.isLxc(project)) {
      let status;
      switch (action) {
        case 'start':
          emitStatus('starting');
          status = await workspace.start(project);
          db.update(projects).set({ lastStartedAt: Date.now() }).where(eq(projects.id, projectId)).run();
          emitStatus(status);
          break;
        case 'stop':
          status = await workspace.stop(project);
          db.update(projects).set({ lastStoppedAt: Date.now() }).where(eq(projects.id, projectId)).run();
          emitStatus(status);
          break;
        case 'restart':
          emitStatus('starting');
          status = await workspace.restart(project);
          db.update(projects).set({ lastStartedAt: Date.now() }).where(eq(projects.id, projectId)).run();
          emitStatus(status);
          break;
        case 'update': {
          const before = await workspace.getStatus(project).catch(() => 'stopped');
          if (before !== 'running') {
            emitStatus('starting');
            await workspace.start(project);
          }
          const result = await workspace.update(project);
          db.update(projects).set({ lastUpdatedAt: Date.now() }).where(eq(projects.id, projectId)).run();
          status = await workspace.getStatus(project).catch(() => 'running');
          emitStatus(status);
          db.insert(activityLog).values({
            projectId,
            type: 'lifecycle_update',
            message: 'LXC workspace update completed.',
            createdAt: Date.now(),
          }).run();
          return res.json({ success: true, status, log: result?.log || '' });
        }
        case 'status':
          status = await workspace.getStatus(project);
          db.update(projects).set({ lxcStatus: status }).where(eq(projects.id, projectId)).run();
          return res.json({ success: true, status });
        default:
          return res.status(400).json({ error: `Action "${action}" is not supported for Unraid LXC workspaces.` });
      }
      db.update(projects).set({ lxcStatus: status }).where(eq(projects.id, projectId)).run();
      db.insert(activityLog).values({
        projectId,
        type: `lifecycle_${action}`,
        message: `LXC workspace ${action} completed.`,
        createdAt: Date.now(),
      }).run();
      return res.json({ success: true, status });
    }

    switch (action) {
      case 'start': {
        emitStatus('starting');
        // A stopped container keeps its original binds, so if the saved volume
        // config no longer matches the existing container we recreate it to
        // apply the change ("apply on next start").
        const desired = docker.buildExtraBinds(volumes);
        const current = (await docker.getContainerBinds(projectId))
          .filter(b => !b.endsWith(':/workspace') && !b.endsWith(':/root'));
        const matches = JSON.stringify([...desired].sort()) === JSON.stringify([...current].sort());
        if (matches) {
          await docker.startContainer(projectId);
        } else {
          const { containerId: startedId } = await docker.recreateContainer(projectId, project.folderPath, project.template, volumes);
          db.update(projects).set({ containerId: startedId }).where(eq(projects.id, projectId)).run();
        }
        emitStatus('running');
        break;
      }

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
        const { containerId: newId } = await docker.recreateContainer(projectId, project.folderPath, project.template, volumes);
        db.update(projects).set({ containerId: newId }).where(eq(projects.id, projectId)).run();
        emitStatus('running');
        break;
      }
      case 'rebuild': {
        emitStatus('starting');
        const { containerId: rebuiltId } = await docker.rebuildContainer(projectId, project.folderPath, project.template, volumes);
        db.update(projects).set({ containerId: rebuiltId }).where(eq(projects.id, projectId)).run();
        emitStatus('running');
        break;
      }
      case 'reset': {
        emitStatus('starting');
        const { containerId: resetId } = await docker.resetEnvironment(projectId, project.folderPath, project.template, volumes);
        db.update(projects).set({ containerId: resetId }).where(eq(projects.id, projectId)).run();
        emitStatus('running');
        break;
      }
      case 'update': {
        // Docker "update" = pull the latest image and recreate the container.
        emitStatus('starting');
        const { containerId: updatedId } = await docker.rebuildContainer(projectId, project.folderPath, project.template, volumes);
        db.update(projects).set({ containerId: updatedId, lastUpdatedAt: Date.now() }).where(eq(projects.id, projectId)).run();
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
    const db = getDB();
    const project = db.select().from(projects).where(eq(projects.id, projectId)).all()[0];
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    const logs = await workspace.getLogs(project, parseInt(req.query.tail || 200));
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

    // Remove backend resources (Docker container + volume, or LXC container).
    // Project files are kept on disk / the Unraid share in both cases.
    await workspace.remove(rows[0]).catch(err => {
      console.warn('[projects] Workspace cleanup warning:', err.message);
    });

    // Remove from DB (cascade deletes terminal sessions + activity)
    db.delete(projects).where(eq(projects.id, projectId)).run();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to delete project: ${err.message}` });
  }
});

module.exports = router;
