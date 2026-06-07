const setupRouter = require('./setup');
const authRouter = require('./auth');
const settingsRouter = require('./settings');
const projectsRouter = require('./projects');

function registerRoutes(app) {
  app.use('/api/setup', setupRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/projects', projectsRouter);
}

module.exports = { registerRoutes };
