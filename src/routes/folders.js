const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { PROJECTS_DIR } = require('../config');
const { getDB } = require('../db');
const { projects } = require('../db/schema');

// Resolve a folder name (single path segment) safely inside PROJECTS_DIR.
// Returns the absolute path, or null if the name escapes the projects dir.
function resolveFolder(name) {
  if (!name || typeof name !== 'string') return null;
  // Reject anything that isn't a plain folder name (no separators, no traversal)
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') return null;
  const resolved = path.resolve(PROJECTS_DIR, name);
  const rootWithSep = PROJECTS_DIR.endsWith(path.sep) ? PROJECTS_DIR : PROJECTS_DIR + path.sep;
  if (!resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

// Best-effort recursive directory size + file count. Guarded against runaway
// trees and unreadable entries so a single bad folder never breaks the listing.
function folderStats(dir, depth = 0) {
  let size = 0;
  let files = 0;
  if (depth > 12) return { size, files };
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { size, files };
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        const sub = folderStats(full, depth + 1);
        size += sub.size;
        files += sub.files;
      } else if (entry.isFile()) {
        size += fs.statSync(full).size;
        files += 1;
      }
    } catch { /* skip unreadable entry */ }
  }
  return { size, files };
}

// Map of folderPath -> project, so we can flag folders still tied to a project.
function linkedFolders() {
  const map = new Map();
  try {
    const db = getDB();
    const rows = db.select().from(projects).all();
    for (const p of rows) {
      // folderPath may be nested (e.g. "team/app"); key on the top-level segment.
      const top = String(p.folderPath || '').replace(/^\//, '').split('/')[0];
      if (top) map.set(top, p);
    }
  } catch { /* DB not ready — treat all as unlinked */ }
  return map;
}

// GET /api/folders — list every directory directly under /projects
router.get('/', requireAuth, (req, res) => {
  if (!fs.existsSync(PROJECTS_DIR)) return res.json({ folders: [], root: PROJECTS_DIR });

  const linked = linkedFolders();
  let entries;
  try {
    entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  } catch (err) {
    return res.status(500).json({ error: `Could not read projects directory: ${err.message}` });
  }

  const folders = entries
    .filter(e => e.isDirectory())
    .map(e => {
      const full = path.join(PROJECTS_DIR, e.name);
      const { size, files } = folderStats(full);
      let modified = null;
      try { modified = fs.statSync(full).mtimeMs; } catch {}
      const project = linked.get(e.name);
      return {
        name: e.name,
        size,
        files,
        modified,
        linked: !!project,
        projectName: project ? project.name : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json({ folders, root: PROJECTS_DIR });
});

// DELETE /api/folders/:name — permanently remove a folder under /projects.
// Folders still attached to a project are protected; delete the project first.
router.delete('/:name', requireAuth, (req, res) => {
  const target = resolveFolder(req.params.name);
  if (!target) return res.status(400).json({ error: 'Invalid folder name.' });

  if (linkedFolders().has(req.params.name)) {
    return res.status(409).json({ error: 'This folder belongs to an existing project. Delete the project first.' });
  }

  try {
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a folder.' });
    fs.rmSync(target, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Folder not found.' });
    res.status(500).json({ error: `Delete failed: ${err.message}` });
  }
});

module.exports = router;
