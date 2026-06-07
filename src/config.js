const path = require('path');

const DATA_DIR = process.env.DATA_DIR ||
  (process.env.NODE_ENV === 'production' ? '/app/data' : path.join(__dirname, '..', 'data'));

const PROJECTS_DIR = process.env.PROJECTS_DIR || '/projects';

// HOST_PROJECTS_DIR is the path to the projects folder AS SEEN BY THE DOCKER HOST.
// When opus-command runs inside Docker, workspace container bind mounts are
// resolved by the host Docker daemon — so they need the real host-side path.
//
// Example: if your docker-compose has "- /mnt/user/projects:/projects",
// set HOST_PROJECTS_DIR=/mnt/user/projects in your environment.
//
// If not set, falls back to PROJECTS_DIR (correct for bare-metal installs).
const HOST_PROJECTS_DIR = process.env.HOST_PROJECTS_DIR || PROJECTS_DIR;

module.exports = {
  DATA_DIR,
  PROJECTS_DIR,
  HOST_PROJECTS_DIR,
  DB_PATH: path.join(DATA_DIR, 'db.sqlite'),
  AGENT_PATTERNS_PATH: path.join(DATA_DIR, 'agent-patterns.json'),
  PORT: parseInt(process.env.PORT || '3000', 10),
  SESSION_SECRET: process.env.SESSION_SECRET || 'opus-command-dev-secret-please-change',
  NODE_ENV: process.env.NODE_ENV || 'development',
  APP_VERSION: process.env.APP_VERSION || require('../package.json').version,
};
