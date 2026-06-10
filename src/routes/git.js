const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// Execute a shell command inside the workspace container
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

// Cache git root per container so we only pay the detection cost once.
const gitRootCache = new Map();

async function getGitRoot(contName) {
  if (gitRootCache.has(contName)) return gitRootCache.get(contName);
  try {
    // Try /workspace first (most common); fall back to first .git found one level down.
    const r = await execInContainer(contName,
      'if [ -d /workspace/.git ]; then echo /workspace; ' +
      'else find /workspace -maxdepth 2 -name ".git" -type d 2>/dev/null | head -1 | sed "s|/\\.git$||"; fi'
    );
    const root = r.stdout.trim() || '/workspace';
    gitRootCache.set(contName, root);
    return root;
  } catch {
    return '/workspace';
  }
}

// GET /api/projects/:projectId/git/status
router.get('/status', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const contName = containerName(project.id);
  try {
    const root = await getGitRoot(contName);
    const branchResult = await execInContainer(contName, `git -C '${root}' branch --show-current 2>/dev/null || echo ""`);
    const branch = branchResult.stdout.trim();

    if (!branch && branchResult.stderr.includes('not a git repository')) {
      return res.json({ initialized: false });
    }

    const statusResult = await execInContainer(contName, `git -C '${root}' status --porcelain 2>/dev/null`);
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
    const root = await getGitRoot(contName);
    const safe = filePath.replace(/'/g, "\\'");
    const result = await execInContainer(contName,
      `git -C '${root}' diff -- '${safe}' 2>/dev/null; git -C '${root}' diff --cached -- '${safe}' 2>/dev/null`
    );
    res.json({ diff: result.stdout });
  } catch (err) {
    res.status(500).json({ error: `Git diff failed: ${err.message}` });
  }
});

// POST /api/projects/:projectId/git/stage — stage or unstage files
router.post('/stage', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const { files, unstage } = req.body;
  if (!Array.isArray(files) || !files.length) return res.status(400).json({ error: 'Files required.' });

  const contName = containerName(project.id);
  try {
    const root = await getGitRoot(contName);
    const safePaths = files.map(f => `'${f.replace(/'/g, "\\'")}'`).join(' ');
    const cmd = unstage
      ? `git -C '${root}' reset HEAD -- ${safePaths}`
      : `git -C '${root}' add -- ${safePaths}`;
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
    const root = await getGitRoot(contName);
    const result = await execInContainer(contName,
      `git -C '${root}' -c user.email="opus@command" -c user.name="Opus Command" commit -m '${safeMsg}' 2>&1`
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
    const root = await getGitRoot(contName);
    let cmd;
    if (all) {
      cmd = `git -C '${root}' checkout -- . && git -C '${root}' clean -fd 2>&1`;
    } else {
      if (!filePath) return res.status(400).json({ error: 'File path required.' });
      const safe = filePath.replace(/'/g, "\\'");
      cmd = `git -C '${root}' checkout -- '${safe}' 2>&1`;
    }
    await execInContainer(contName, cmd);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Git operation failed: ${err.message}` });
  }
});

// POST /api/projects/:projectId/git/branch — create and switch branch
router.post('/branch', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Branch name required.' });

  const contName = containerName(project.id);
  const safe = name.trim().replace(/'/g, "\\'");
  try {
    const root = await getGitRoot(contName);
    const result = await execInContainer(contName, `git -C '${root}' checkout -b '${safe}' 2>&1`);
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
  const msg = label ? `${ts}: ${label}` : ts;

  const contName = containerName(project.id);
  const safeTag = tag.replace(/'/g, "\\'");
  const safeMsg = msg.replace(/'/g, "\\'");
  try {
    const root = await getGitRoot(contName);
    await execInContainer(contName,
      `git -C '${root}' -c user.email="opus@command" -c user.name="Opus Command" tag -a '${safeTag}' -m '${safeMsg}' 2>&1`
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
    const root = await getGitRoot(contName);
    const result = await execInContainer(contName,
      `git -C '${root}' tag -l "snapshot/*" --sort=-creatordate --format="%(refname:short)|%(creatordate:iso)|%(subject)" 2>/dev/null`
    );
    const snapshots = result.stdout.split('\n').filter(Boolean).map(line => {
      const [tag, date, ...msgParts] = line.split('|');
      const fullMsg = msgParts.join('|').trim();
      // Message is "ts: label" or just "ts" — extract the human-written label only
      const colonIdx = fullMsg.indexOf(': ');
      const label = colonIdx >= 0 ? fullMsg.slice(colonIdx + 2) : '';
      return { tag: tag.trim(), date: date?.trim(), label };
    });
    res.json({ snapshots });
  } catch {
    res.json({ snapshots: [] });
  }
});

// POST /api/projects/:projectId/git/restore — restore to snapshot
router.post('/restore', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const { tag } = req.body;
  if (!tag) return res.status(400).json({ error: 'Tag required.' });
  if (!/^snapshot\/\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(tag)) {
    return res.status(400).json({ error: 'Invalid snapshot tag.' });
  }

  const contName = containerName(project.id);
  try {
    const root = await getGitRoot(contName);
    const quotedRoot = shellQuote(root);
    const quotedTag = shellQuote(tag);
    const quotedCommit = shellQuote(`${tag}^{commit}`);

    // A snapshot restore is a safety rollback: move the current branch/worktree
    // back to the snapshot commit, then remove files added after the snapshot.
    await execInContainer(contName,
      `git -C ${quotedRoot} rev-parse --verify --quiet ${quotedCommit} >/dev/null 2>&1 && ` +
      `git -C ${quotedRoot} reset --hard ${quotedTag} 2>&1 && ` +
      `git -C ${quotedRoot} clean -fd 2>&1`
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Git operation failed: ${err.message}` });
  }
});

// GET /api/projects/:projectId/git/log
router.get('/log', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const contName = containerName(project.id);
  try {
    const root = await getGitRoot(contName);
    const result = await execInContainer(contName,
      `git -C '${root}' log --all --date-order --format="%H%x1f%h%x1f%s%x1f%an%x1f%ar%x1f%D%x1f%P" -60 2>/dev/null`
    );
    const commits = result.stdout.split('\n').filter(Boolean).map(line => {
      const p = line.split('\x1f');
      return {
        hash:         p[0] || '',
        shortHash:    p[1] || '',
        subject:      p[2] || '',
        author:       p[3] || '',
        relativeDate: p[4] || '',
        refs:         p[5] || '',
        parents:      (p[6] || '').split(' ').filter(Boolean),
      };
    }).filter(c => c.hash);
    res.json({ commits });
  } catch {
    res.json({ commits: [] });
  }
});

// GET /api/projects/:projectId/git/remote
router.get('/remote', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const contName = containerName(project.id);
  try {
    const root = await getGitRoot(contName);
    const urlResult = await execInContainer(contName,
      `git -C '${root}' remote get-url origin 2>/dev/null || echo ""`
    );
    const remoteUrl = urlResult.stdout.trim();
    if (!remoteUrl) return res.json({ hasRemote: false });

    const [trackingResult, aheadResult, behindResult] = await Promise.all([
      execInContainer(contName, `git -C '${root}' rev-parse --abbrev-ref HEAD@{upstream} 2>/dev/null || echo ""`),
      execInContainer(contName, `git -C '${root}' rev-list HEAD@{upstream}..HEAD --count 2>/dev/null || echo "0"`),
      execInContainer(contName, `git -C '${root}' rev-list HEAD..HEAD@{upstream} --count 2>/dev/null || echo "0"`),
    ]);

    res.json({
      hasRemote: true,
      remoteUrl,
      tracking: trackingResult.stdout.trim(),
      ahead:    parseInt(aheadResult.stdout.trim())  || 0,
      behind:   parseInt(behindResult.stdout.trim()) || 0,
    });
  } catch {
    res.json({ hasRemote: false });
  }
});

// POST /api/projects/:projectId/git/fetch
router.post('/fetch', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const contName = containerName(project.id);
  try {
    const root = await getGitRoot(contName);
    const result = await execInContainer(contName, `git -C '${root}' fetch --prune 2>&1`);
    const output = (result.stdout + ' ' + result.stderr).trim();
    if (output.includes('fatal:') || output.includes('error:')) {
      return res.status(400).json({ error: output });
    }
    res.json({ success: true, output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:projectId/git/pull
router.post('/pull', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const contName = containerName(project.id);
  try {
    const root = await getGitRoot(contName);
    const result = await execInContainer(contName, `git -C '${root}' pull 2>&1`);
    const output = (result.stdout + ' ' + result.stderr).trim();
    if (output.includes('fatal:') || output.includes('error:')) {
      return res.status(400).json({ error: output });
    }
    res.json({ success: true, output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:projectId/git/push
router.post('/push', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const contName = containerName(project.id);
  try {
    const root = await getGitRoot(contName);
    const result = await execInContainer(contName, `git -C '${root}' push 2>&1`);
    const output = (result.stdout + ' ' + result.stderr).trim();
    if (output.includes('fatal:') || output.includes('error:')) {
      return res.status(400).json({ error: output });
    }
    res.json({ success: true, output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
