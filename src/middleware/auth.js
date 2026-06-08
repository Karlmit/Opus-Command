const { isWorkspaceTokenRequest } = require('../services/auth.service');

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/login');
}

function requireNoAuth(req, res, next) {
  if (req.session && req.session.userId) return res.redirect('/');
  next();
}

function requireAuthOrWorkspaceToken(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (isWorkspaceTokenRequest(req)) {
    req.workspaceAuth = true;
    return next();
  }
  if (req.xhr || req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/login');
}

module.exports = { requireAuth, requireNoAuth, requireAuthOrWorkspaceToken };
