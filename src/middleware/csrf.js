const crypto = require('crypto');

function csrfMiddleware(req, res, next) {
  if (!req.session) return next();

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    res.locals.csrfToken = req.session.csrfToken;
    return next();
  }

  // Skip CSRF for setup endpoint when no user exists yet (first-run)
  if (req.path === '/api/setup' && !req.session.csrfToken) {
    return next();
  }

  const token = req.headers['x-csrf-token'] || (req.body && req.body._csrf);
  if (!token || !req.session.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}

module.exports = { csrfMiddleware };
