const crypto = require('crypto');
const { isWorkspaceTokenRequest } = require('../services/auth.service');

function csrfMiddleware(req, res, next) {
  if (!req.session) return next();

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }
    res.locals.csrfToken = req.session.csrfToken;
    return next();
  }

  // Setup endpoint is self-protected (only works once, 403 after first run)
  if (req.path === '/api/setup') {
    return next();
  }

  if (req.path === '/api/connectors/register') {
    return next();
  }

  if (req.path.startsWith('/api/connectors') && isWorkspaceTokenRequest(req)) {
    return next();
  }

  const token = req.headers['x-csrf-token'] || (req.body && req.body._csrf);
  if (!token || !req.session.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}

module.exports = { csrfMiddleware };
