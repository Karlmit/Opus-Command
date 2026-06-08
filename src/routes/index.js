const setupRouter = require('./setup');
const authRouter = require('./auth');
const settingsRouter = require('./settings');
const projectsRouter = require('./projects');
const terminalsRouter = require('./terminals');
const filesRouter = require('./files');
const gitRouter = require('./git');
const connectorsRouter = require('./connectors');

function registerRoutes(app) {
  app.use('/api/setup', setupRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/projects/:projectId/terminals', terminalsRouter);
  app.use('/api/projects/:projectId/files', filesRouter);
  app.use('/api/projects/:projectId/git', gitRouter);
  app.use('/api/connectors', connectorsRouter);
}

module.exports = { registerRoutes };
