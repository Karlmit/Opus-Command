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

module.exports = { requireAuth, requireNoAuth };
