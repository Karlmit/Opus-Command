const path = require('path');

const DATA_DIR = process.env.DATA_DIR ||
  (process.env.NODE_ENV === 'production' ? '/app/data' : path.join(__dirname, '..', 'data'));

const PROJECTS_DIR = process.env.PROJECTS_DIR || '/projects';

module.exports = {
  DATA_DIR,
  PROJECTS_DIR,
  DB_PATH: path.join(DATA_DIR, 'db.sqlite'),
  AGENT_PATTERNS_PATH: path.join(DATA_DIR, 'agent-patterns.json'),
  PORT: parseInt(process.env.PORT || '3000', 10),
  SESSION_SECRET: process.env.SESSION_SECRET || 'opus-command-dev-secret-please-change',
  NODE_ENV: process.env.NODE_ENV || 'development',
  APP_VERSION: process.env.APP_VERSION || require('../package.json').version,
};
