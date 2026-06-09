const fs = require('fs');
const os = require('os');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function ensureLayout(home) {
  const dirs = [
    'config',
    'logs',
    'OpusCommand',
    path.join('OpusCommand', 'jobs'),
    path.join('OpusCommand', 'artifacts'),
    path.join('OpusCommand', 'temp'),
  ];
  for (const dir of dirs) fs.mkdirSync(path.join(home, dir), { recursive: true });
}

function configPath(home) {
  return path.join(home, 'config', 'connector.json');
}

function logPath(home) {
  return path.join(home, 'logs', 'connector.log');
}

function readConfig(home) {
  const file = configPath(home);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeConfig(home, config) {
  fs.writeFileSync(configPath(home), JSON.stringify(config, null, 2));
  try {
    fs.chmodSync(configPath(home), 0o600);
  } catch (_) {}
}

function normalizeServer(server) {
  return String(server || '').replace(/\/+$/, '');
}

function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function defaultHome(appName = '.opus-connector') {
  return path.join(os.homedir(), appName);
}

module.exports = {
  parseArgs,
  ensureLayout,
  configPath,
  logPath,
  readConfig,
  writeConfig,
  normalizeServer,
  quote,
  defaultHome,
};
