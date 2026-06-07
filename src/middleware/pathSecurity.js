const path = require('path');
const { PROJECTS_DIR } = require('../config');

function validateProjectPath(reqPath, projectFolder) {
  const base = projectFolder
    ? path.resolve(PROJECTS_DIR, projectFolder)
    : path.resolve(PROJECTS_DIR);
  const resolved = path.resolve(base, reqPath);

  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    return { valid: false, resolved };
  }
  return { valid: true, resolved };
}

function pathSecurityMiddleware(req, res, next) {
  const filePath = req.body?.path || req.query?.path;
  if (!filePath) return next();

  const resolved = path.resolve(filePath);
  const projectsResolved = path.resolve(PROJECTS_DIR);

  if (!resolved.startsWith(projectsResolved + path.sep) && resolved !== projectsResolved) {
    console.warn(`[security] Path traversal attempt: ${filePath} from ${req.ip}`);
    return res.status(403).json({ error: 'Access denied. The path is outside the project folder.' });
  }
  next();
}

module.exports = { pathSecurityMiddleware, validateProjectPath };
