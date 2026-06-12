const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAuth } = require('../middleware/auth');
const { getDB } = require('../db');
const { projects } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { docker } = require('../services/docker.service');
const lxc = require('../services/unraid-lxc.service');

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
function execInDockerContainer(containerName, command) {
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

function isLxcProject(project) {
  return project?.workspaceBackend === 'unraid_lxc';
}

async function execInWorkspace(project, command) {
  if (isLxcProject(project)) {
    return lxc.execWorkspace(project, command);
  }
  return execInDockerContainer(containerName(project.id), command);
}

// Cache discovered repos per workspace with a short TTL: cheap enough that a
// newly cloned repo shows up without a backend restart, but we don't pay the
// find cost on every git call.
const repoCache = new Map();
const REPO_TTL_MS = 15000;

// Discover Git working trees under /workspace. Matches `.git` as a directory OR
// a file — worktrees and submodules store `.git` as a `gitdir:` pointer file,
// not a directory — then resolves each to its working-tree root via rev-parse.
// maxdepth 2 covers both /workspace/.git and /workspace/<project>/.git.
async function discoverRepos(project, { force = false } = {}) {
  const cacheKey = `${project.workspaceBackend || 'docker'}:${project.id}`;
  const cached = repoCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.at < REPO_TTL_MS) return cached.repos;

  let repos = [];
  try {
    const r = await execInWorkspace(project,
      'find /workspace -maxdepth 2 -name .git 2>/dev/null | while read g; do ' +
      'git -C "$(dirname "$g")" rev-parse --show-toplevel 2>/dev/null; ' +
      'done'
    );
    repos = Array.from(new Set(
      r.stdout.split('\n').map(s => s.trim()).filter(Boolean)
    )).sort();
    // Float a repo rooted directly at /workspace to the front — it's the
    // natural default when the user hasn't chosen one.
    if (repos.includes('/workspace')) {
      repos = ['/workspace', ...repos.filter(p => p !== '/workspace')];
    }
  } catch {
    repos = [];
  }

  repoCache.set(cacheKey, { at: Date.now(), repos });
  return repos;
}

// The repo the Git menu currently operates on: the user's saved choice if it is
// still present, otherwise the default (prefer /workspace, else first found).
async function getActiveRepoRoot(project) {
  const repos = await discoverRepos(project);
  if (!repos.length) return '/workspace'; // preserve legacy fallback
  if (project.gitRepoPath && repos.includes(project.gitRepoPath)) {
    return project.gitRepoPath;
  }
  return repos[0]; // discoverRepos already floats /workspace to the front
}

// GET /api/projects/:projectId/git/status
router.get('/status', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  try {
    const root = await getActiveRepoRoot(project);
    const repoResult = await execInWorkspace(project, `git -C '${root}' rev-parse --is-inside-work-tree 2>/dev/null || echo false`);
    if (repoResult.stdout.trim() !== 'true') {
      return res.json({ initialized: false });
    }

    const branchResult = await execInWorkspace(project, `git -C '${root}' branch --show-current 2>/dev/null || echo ""`);
    const branch = branchResult.stdout.trim();

    const statusResult = await execInWorkspace(project, `git -C '${root}' status --porcelain 2>/dev/null`);
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

// GET /api/projects/:projectId/git/repos — list every Git repo discovered under
// /workspace, with branch + clean state, and which one is active. The picker
// only needs to render when there are two or more.
router.get('/repos', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  try {
    const paths = await discoverRepos(project, { force: req.query.refresh === '1' });
    const active = await getActiveRepoRoot(project);

    const repos = await Promise.all(paths.map(async (path) => {
      try {
        const [branchRes, statusRes] = await Promise.all([
          execInWorkspace(project, `git -C '${path}' branch --show-current 2>/dev/null || echo ""`),
          execInWorkspace(project, `git -C '${path}' status --porcelain 2>/dev/null`),
        ]);
        const dirty = statusRes.stdout.split('\n').filter(Boolean).length;
        return { path, branch: branchRes.stdout.trim() || 'HEAD', dirty, clean: dirty === 0 };
      } catch {
        return { path, branch: 'HEAD', dirty: 0, clean: true };
      }
    }));

    res.json({ repos, active });
  } catch (err) {
    res.json({ repos: [], active: null, error: err.message });
  }
});

// POST /api/projects/:projectId/git/repos/active — remember the chosen repo.
router.post('/repos/active', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const { path } = req.body;
  if (!path) return res.status(400).json({ error: 'Repository path required.' });

  // Only accept a path we actually discovered — never trust an arbitrary path
  // from the client into a shell git command.
  const repos = await discoverRepos(project, { force: true });
  if (!repos.includes(path)) {
    return res.status(400).json({ error: 'Unknown repository path.' });
  }

  try {
    const db = getDB();
    db.update(projects).set({ gitRepoPath: path }).where(eq(projects.id, project.id)).run();
    res.json({ success: true, active: path });
  } catch (err) {
    res.status(500).json({ error: `Could not save repository choice: ${err.message}` });
  }
});

// GET /api/projects/:projectId/git/diff
router.get('/diff', requireAuth, async (req, res) => {
  const project = getProjectInfo(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Path required.' });

  try {
    const root = await getActiveRepoRoot(project);
    const safe = filePath.replace(/'/g, "\\'");
    const result = await execInWorkspace(project,
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

  try {
    const root = await getActiveRepoRoot(project);
    const safePaths = files.map(f => `'${f.replace(/'/g, "\\'")}'`).join(' ');
    const cmd = unstage
      ? `git -C '${root}' reset HEAD -- ${safePaths}`
      : `git -C '${root}' add -- ${safePaths}`;
    await execInWorkspace(project, cmd);
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

  const safeMsg = message.replace(/'/g, "\\'");
  try {
    const root = await getActiveRepoRoot(project);
    const result = await execInWorkspace(project,
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
  try {
    const root = await getActiveRepoRoot(project);
    let cmd;
    if (all) {
      cmd = `git -C '${root}' checkout -- . && git -C '${root}' clean -fd 2>&1`;
    } else {
      if (!filePath) return res.status(400).json({ error: 'File path required.' });
      const safe = filePath.replace(/'/g, "\\'");
      cmd = `git -C '${root}' checkout -- '${safe}' 2>&1`;
    }
    await execInWorkspace(project, cmd);
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

  const safe = name.trim().replace(/'/g, "\\'");
  try {
    const root = await getActiveRepoRoot(project);
    const result = await execInWorkspace(project, `git -C '${root}' checkout -b '${safe}' 2>&1`);
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

  const safeTag = tag.replace(/'/g, "\\'");
  const safeMsg = msg.replace(/'/g, "\\'");
  try {
    const root = await getActiveRepoRoot(project);
    await execInWorkspace(project,
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

  try {
    const root = await getActiveRepoRoot(project);
    const result = await execInWorkspace(project,
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

  try {
    const root = await getActiveRepoRoot(project);
    const quotedRoot = shellQuote(root);
    const quotedTag = shellQuote(tag);
    const quotedCommit = shellQuote(`${tag}^{commit}`);

    // A snapshot restore is a safety rollback: move the current branch/worktree
    // back to the snapshot commit, then remove files added after the snapshot.
    await execInWorkspace(project,
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

  try {
    const root = await getActiveRepoRoot(project);
    const result = await execInWorkspace(project,
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

  try {
    const root = await getActiveRepoRoot(project);
    const urlResult = await execInWorkspace(project,
      `git -C '${root}' remote get-url origin 2>/dev/null || echo ""`
    );
    const remoteUrl = urlResult.stdout.trim();
    if (!remoteUrl) return res.json({ hasRemote: false });

    const [trackingResult, aheadResult, behindResult] = await Promise.all([
      execInWorkspace(project, `git -C '${root}' rev-parse --abbrev-ref HEAD@{upstream} 2>/dev/null || echo ""`),
      execInWorkspace(project, `git -C '${root}' rev-list HEAD@{upstream}..HEAD --count 2>/dev/null || echo "0"`),
      execInWorkspace(project, `git -C '${root}' rev-list HEAD..HEAD@{upstream} --count 2>/dev/null || echo "0"`),
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

  try {
    const root = await getActiveRepoRoot(project);
    const result = await execInWorkspace(project, `git -C '${root}' fetch --prune 2>&1`);
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

  try {
    const root = await getActiveRepoRoot(project);
    const result = await execInWorkspace(project, `git -C '${root}' pull 2>&1`);
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

  try {
    const root = await getActiveRepoRoot(project);
    const result = await execInWorkspace(project, `git -C '${root}' push 2>&1`);
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
