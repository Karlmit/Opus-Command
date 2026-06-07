const express = require('express');
const router = express.Router({ mergeParams: true });
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const { PROJECTS_DIR } = require('../config');
const { getDB } = require('../db');
const { projects } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { docker } = require('../services/docker.service');

function getProjectInfo(projectId) {
  const db = getDB();
  const rows = db.select().from(projects).where(eq(projects.id, parseInt(projectId))).all();
  if (!rows.length) return null;
  return rows[0];
}

function containerName(projectId) {
  return `opus-workspace-${projectId}`;
}

// Execute git command inside the workspace container
function execInContainer(containerName, command) {
  return new Promise((resolve, reject) => {
    const container = docker.getContainer(containerName);
    container.exec({
      Cmd: ['sh', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: '/workspace',
      Env: ['HOME=/root', 'GIT_TERMINAL_PROMPT=0'],
    }, (err, exec) => {
      if (err) return reject(err);
      exec.start({ hijack: true, stdin: false }, (err, stream) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        stream.on('data', chunk => {
          // Docker multiplexing: first byte is stream type (1=stdout, 2=stderr)
          if (chunk.length > 8) {
            const type = chunk[0];
            const data = chunk.slice(8).toString('utf8');
            if (type === 1) stdout += data;
            else stderr += data;
          }
        });
        stream.on('end', () => resolve({ stdout: stdout.trim(), stderr: stderr.trim() }));
        stream.on('error', reject);
      });
    });
  });
}

// GET /api/projects/:projectId/git/status
router.get('/status', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const contName = containerName(project.id);

  try {
    const branchResult = await execInContainer(contName, 'git -C /workspace branch --show-current 2>/dev/null || echo ""');
    const branch = branchResult.stdout.trim();

    if (!branch && !branchResult.stdout && branchResult.stderr.includes('not a git repository')) {
      return res.json({ initialized: false });
    }

    const statusResult = await execInContainer(contName, 'git -C /workspace status --porcelain 2>/dev/null');
    const files = statusResult.stdout
      .split('\n')
      .filter(Boolean)
      .map(line => ({
        status: line.substring(0, 2).trim() || '?',
        path: line.substring(3),
      }));

    res.json({
      initialized: true,
      branch: branch || 'HEAD',
      files,
      clean: files.length === 0,
    });
  } catch (err) {
    // Container not running or git not installed
    res.json({ initialized: false, error: `Git status failed: ${err.message}` });
  }
});

// GET /api/projects/:projectId/git/diff
router.get('/diff', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Path required.' });

  const contName = containerName(project.id);
  try {
    const result = await execInContainer(contName,
      `git -C /workspace diff -- ${filePath.replace(/'/g, "'\\''")} 2>/dev/null; git -C /workspace diff --cached -- ${filePath.replace(/'/g, "'\\''")} 2>/dev/null`
    );
    res.json({ diff: result.stdout });
  } catch (err) {
    res.status(500).json({ error: `Git diff failed: ${err.message}` });
  }
});

// POST /api/projects/:projectId/git/stage — stage files
router.post('/stage', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const { files, unstage } = req.body;
  if (!Array.isArray(files) || !files.length) return res.status(400).json({ error: 'Files required.' });

  const contName = containerName(project.id);
  const safePaths = files.map(f => `'${f.replace(/'/g, "\\'")}'`).join(' ');
  const cmd = unstage
    ? `git -C /workspace reset HEAD -- ${safePaths}`
    : `git -C /workspace add -- ${safePaths}`;

  try {
    await execInContainer(contName, cmd);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Git operation failed: ${err.message}` });
  }
});

// POST /api/projects/:projectId/git/commit
router.post('/commit', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const { message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Commit message is required.' });

  const contName = containerName(project.id);
  const safeMsg = message.replace(/'/g, "\\'");
  try {
    const result = await execInContainer(contName,
      `git -C /workspace -c user.email="opus@command" -c user.name="Opus Command" commit -m '${safeMsg}' 2>&1`
    );
    if (result.stdout.includes('nothing to commit')) {
      return res.status(400).json({ error: 'Nothing to commit. Stage files first.' });
    }
    res.json({ success: true, output: result.stdout });
  } catch (err) {
    res.status(500).json({ error: `Git operation failed: ${err.message}` });
  }
});

// POST /api/projects/:projectId/git/revert — revert file to HEAD
router.post('/revert', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const { filePath, all } = req.body;
  const contName = containerName(project.id);

  try {
    let cmd;
    if (all) {
      cmd = 'git -C /workspace checkout -- . && git -C /workspace clean -fd 2>&1';
    } else {
      if (!filePath) return res.status(400).json({ error: 'File path required.' });
      const safe = filePath.replace(/'/g, "\\'");
      cmd = `git -C /workspace checkout -- '${safe}' 2>&1`;
    }
    await execInContainer(contName, cmd);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Git operation failed: ${err.message}` });
  }
});

// POST /api/projects/:projectId/git/branch — create branch
router.post('/branch', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Branch name required.' });

  const contName = containerName(project.id);
  const safe = name.trim().replace(/'/g, "\\'");
  try {
    const result = await execInContainer(contName,
      `git -C /workspace checkout -b '${safe}' 2>&1`
    );
    if (result.stdout.includes('fatal') || result.stderr.includes('fatal')) {
      return res.status(400).json({ error: result.stdout || result.stderr });
    }
    res.json({ success: true, branch: name.trim() });
  } catch (err) {
    res.status(500).json({ error: `Git operation failed: ${err.message}` });
  }
});

// POST /api/projects/:projectId/git/snapshot — create annotated tag
router.post('/snapshot', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const { label } = req.body;
  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
  const tag = `snapshot/${ts}`;
  const msg = label ? `${ts}${label ? ': ' + label : ''}` : ts;

  const contName = containerName(project.id);
  const safeTag = tag.replace(/'/g, "\\'");
  const safeMsg = msg.replace(/'/g, "\\'");

  try {
    await execInContainer(contName,
      `git -C /workspace -c user.email="opus@command" -c user.name="Opus Command" tag -a '${safeTag}' -m '${safeMsg}' 2>&1`
    );
    res.json({ success: true, tag });
  } catch (err) {
    res.status(500).json({ error: `Git operation failed: ${err.message}` });
  }
});

// GET /api/projects/:projectId/git/snapshots — list snapshots
router.get('/snapshots', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const contName = containerName(project.id);
  try {
    const result = await execInContainer(contName,
      'git -C /workspace tag -l "snapshot/*" --sort=-creatordate --format="%(refname:short)|%(creatordate:iso)|%(subject)" 2>/dev/null'
    );
    const snapshots = result.stdout.split('\n').filter(Boolean).map(line => {
      const [tag, date, ...labelParts] = line.split('|');
      return { tag: tag.trim(), date: date?.trim(), label: labelParts.join('|').trim() };
    });
    res.json({ snapshots });
  } catch (err) {
    res.json({ snapshots: [] });
  }
});

// POST /api/projects/:projectId/git/restore — restore to snapshot
router.post('/restore', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const { tag } = req.body;
  if (!tag) return res.status(400).json({ error: 'Tag required.' });

  const contName = containerName(project.id);
  const safeTag = tag.replace(/'/g, "\\'");

  try {
    await execInContainer(contName,
      `git -C /workspace checkout '${safeTag}' -- . 2>&1`
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Git operation failed: ${err.message}` });
  }
});

module.exports = router;
