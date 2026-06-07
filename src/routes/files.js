const express = require('express');
const router = express.Router({ mergeParams: true });
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { PROJECTS_DIR } = require('../config');
const { getDB } = require('../db');
const { projects } = require('../db/schema');
const { eq } = require('drizzle-orm');

function getProjectRoot(projectId) {
  const db = getDB();
  const rows = db.select().from(projects).where(eq(projects.id, parseInt(projectId))).all();
  if (!rows.length) return null;
  return path.resolve(PROJECTS_DIR, rows[0].folderPath);
}

function validatePath(projectRoot, reqPath) {
  const resolved = path.resolve(projectRoot, reqPath || '');
  if (!resolved.startsWith(projectRoot)) return null;
  return resolved;
}

function buildTree(dir, root, depth = 0) {
  if (depth > 10) return [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter(e => !e.name.startsWith('.git') || depth === 0)
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      })
      .map(entry => {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(root, fullPath);
        if (entry.isDirectory()) {
          return { name: entry.name, path: relativePath, type: 'dir', children: buildTree(fullPath, root, depth + 1) };
        }
        return { name: entry.name, path: relativePath, type: 'file' };
      });
  } catch {
    return [];
  }
}

function walkDir(dir, root, results = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relative = path.relative(root, fullPath);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        walkDir(fullPath, root, results);
      } else if (entry.isFile()) {
        results.push({ name: entry.name, path: relative });
      }
    }
  } catch (_) {}
  return results;
}

// GET /api/projects/:projectId/files — file tree
router.get('/', requireAuth, (req, res) => {
  const projectRoot = getProjectRoot(req.params.projectId);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found.' });

  if (!fs.existsSync(projectRoot)) {
    fs.mkdirSync(projectRoot, { recursive: true });
    return res.json({ tree: [] });
  }

  const tree = buildTree(projectRoot, projectRoot);
  res.json({ tree, root: projectRoot });
});

// GET /api/projects/:projectId/files/read — read file content
router.get('/read', requireAuth, (req, res) => {
  const projectRoot = getProjectRoot(req.params.projectId);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found.' });

  const filePath = validatePath(projectRoot, req.query.path);
  if (!filePath) return res.status(403).json({ error: 'Access denied. The path is outside the project folder.' });

  try {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];

    if (imageExts.includes(ext)) {
      return res.sendFile(filePath);
    }

    if (stat.size > 5 * 1024 * 1024) {
      return res.status(413).json({ error: 'File too large to edit (>5MB).' });
    }

    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ content, path: req.query.path });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found.' });
    res.status(500).json({ error: 'Could not load file.' });
  }
});

// POST /api/projects/:projectId/files/write — write file
router.post('/write', requireAuth, (req, res) => {
  const projectRoot = getProjectRoot(req.params.projectId);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found.' });

  const { filePath: reqPath, content } = req.body;
  const filePath = validatePath(projectRoot, reqPath);
  if (!filePath) return res.status(403).json({ error: 'Access denied. The path is outside the project folder.' });

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content || '', 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'File save failed. Check that the file path is still valid.' });
  }
});

// POST /api/projects/:projectId/files/create — create file or directory
router.post('/create', requireAuth, (req, res) => {
  const projectRoot = getProjectRoot(req.params.projectId);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found.' });

  const { filePath: reqPath, type = 'file' } = req.body;
  const filePath = validatePath(projectRoot, reqPath);
  if (!filePath) return res.status(403).json({ error: 'Access denied. The path is outside the project folder.' });

  try {
    if (type === 'dir') {
      fs.mkdirSync(filePath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, '', { flag: 'wx' });
    }
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'EEXIST') return res.status(409).json({ error: 'File already exists.' });
    res.status(500).json({ error: `Failed to create: ${err.message}` });
  }
});

// POST /api/projects/:projectId/files/rename — rename
router.post('/rename', requireAuth, (req, res) => {
  const projectRoot = getProjectRoot(req.params.projectId);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found.' });

  const { oldPath: reqOld, newPath: reqNew } = req.body;
  const oldPath = validatePath(projectRoot, reqOld);
  const newPath = validatePath(projectRoot, reqNew);
  if (!oldPath || !newPath) return res.status(403).json({ error: 'Access denied. The path is outside the project folder.' });

  try {
    fs.renameSync(oldPath, newPath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Rename failed: ${err.message}` });
  }
});

// DELETE /api/projects/:projectId/files — delete file or directory
router.delete('/', requireAuth, (req, res) => {
  const projectRoot = getProjectRoot(req.params.projectId);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found.' });

  const filePath = validatePath(projectRoot, req.body.path);
  if (!filePath) return res.status(403).json({ error: 'Access denied. The path is outside the project folder.' });

  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.rmSync(filePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(filePath);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Delete failed: ${err.message}` });
  }
});

// GET /api/projects/:projectId/files/download — download file
router.get('/download', requireAuth, (req, res) => {
  const projectRoot = getProjectRoot(req.params.projectId);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found.' });

  const filePath = validatePath(projectRoot, req.query.path);
  if (!filePath) return res.status(403).json({ error: 'Access denied.' });

  try {
    res.download(filePath, path.basename(filePath));
  } catch (err) {
    res.status(500).json({ error: `Download failed: ${err.message}` });
  }
});

// GET /api/projects/:projectId/files/search — search files by name
router.get('/search', requireAuth, (req, res) => {
  const projectRoot = getProjectRoot(req.params.projectId);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found.' });

  const query = (req.query.q || '').toLowerCase();
  if (!query) return res.json({ results: [] });

  const all = walkDir(projectRoot, projectRoot);
  const results = all
    .filter(f => f.name.toLowerCase().includes(query))
    .slice(0, 100);

  res.json({ results });
});

// GET /api/projects/:projectId/files/content-search — search file contents
router.get('/content-search', requireAuth, (req, res) => {
  const projectRoot = getProjectRoot(req.params.projectId);
  if (!projectRoot) return res.status(404).json({ error: 'Project not found.' });

  const query = (req.query.q || '').toLowerCase();
  if (!query || query.length < 2) return res.json({ results: [] });

  const textExts = new Set(['.js','.ts','.jsx','.tsx','.mjs','.cjs','.py','.go','.rs','.rb','.php','.java','.c','.cpp','.h','.css','.html','.json','.yaml','.yml','.md','.txt','.sh','.bash','.ps1','.sql','.env','.toml','.ini','.cfg','.xml']);
  const all = walkDir(projectRoot, projectRoot);
  const results = [];

  for (const file of all) {
    if (results.length >= 50) break;
    const ext = path.extname(file.name).toLowerCase();
    if (!textExts.has(ext)) continue;
    try {
      const content = fs.readFileSync(path.join(projectRoot, file.path), 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(query)) {
          results.push({ file: file.path, line: i + 1, content: lines[i].trim() });
          if (results.length >= 50) break;
        }
      }
    } catch (_) {}
  }

  res.json({ results });
});

// POST /api/projects/:projectId/files/upload — upload files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const projectRoot = getProjectRoot(req.params.projectId);
    const uploadDir = req.body.targetPath
      ? validatePath(projectRoot, req.body.targetPath)
      : projectRoot;
    cb(null, uploadDir || projectRoot);
  },
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

router.post('/upload', requireAuth, upload.array('files', 50), (req, res) => {
  res.json({
    uploaded: req.files.map(f => ({ name: f.originalname, size: f.size })),
  });
});

module.exports = router;
