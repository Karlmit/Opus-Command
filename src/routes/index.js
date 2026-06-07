const setupRouter = require('./setup');
const authRouter = require('./auth');
const settingsRouter = require('./settings');
const projectsRouter = require('./projects');
const terminalsRouter = require('./terminals');

function registerRoutes(app) {
  app.use('/api/setup', setupRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/projects/:projectId/terminals', terminalsRouter);
}

module.exports = { registerRoutes };
