/**
 * unraid-lxc.config.js — configuration store for the Unraid LXC workspace backend.
 *
 * Precedence for every field: environment variable > stored UI setting > default.
 * The main configuration path is the Settings UI (persisted in the `settings`
 * table under `unraid_lxc_config`); env vars exist only as an advanced override.
 *
 * The SSH private key is NEVER stored in the database. It lives as a file on
 * disk (default /app/data/ssh/opus-unraid-nopass, inside the persistent data
 * volume) referenced by `sshKeyPath`. Key contents are never returned to the
 * client — callers only learn whether the key file exists.
 */

const fs = require('fs');
const path = require('path');
const { getSetting, setSetting } = require('./auth.service');
const { DATA_DIR } = require('../config');

const SETTINGS_KEY = 'unraid_lxc_config';

const DEFAULTS = {
  enabled: false,
  // How Opus Command reaches the Unraid host: 'agent' talks to the Opus
  // Connect plugin (recommended — no SSH key in the app); 'ssh' is the legacy
  // direct-root-SSH transport. Default stays 'ssh' so existing installs keep
  // working after an upgrade; the Settings UI recommends switching.
  connectionMode: 'ssh',
  agentUrl: '',
  agentApiKey: '',
  agentFingerprint: '',
  host: '192.168.1.66',
  sshPort: 22,
  sshUser: 'root',
  sshKeyPath: path.join(DATA_DIR, 'ssh', 'opus-unraid-nopass'),
  // LXC rootfs / runtime data lives here (per Unraid LXC plugin).
  basePath: '/mnt/system_nvme/linux',
  // Project files live in the shared project storage — the SAME location Docker
  // workspaces use. One project = one project folder, regardless of backend.
  sharePath: '/mnt/user/opus-projects',
  dist: 'ubuntu',
  release: 'noble',
  arch: 'amd64',
};

// Map of config field → environment variable override.
const ENV_MAP = {
  enabled: 'UNRAID_LXC_ENABLED',
  connectionMode: 'UNRAID_CONNECTION_MODE',
  agentUrl: 'UNRAID_AGENT_URL',
  agentApiKey: 'UNRAID_AGENT_API_KEY',
  agentFingerprint: 'UNRAID_AGENT_FINGERPRINT',
  host: 'UNRAID_HOST',
  sshPort: 'UNRAID_SSH_PORT',
  sshUser: 'UNRAID_SSH_USER',
  sshKeyPath: 'UNRAID_SSH_KEY_PATH',
  basePath: 'UNRAID_LXC_BASE_PATH',
  sharePath: 'UNRAID_WORKSPACE_SHARE',
  dist: 'UNRAID_LXC_DIST',
  release: 'UNRAID_LXC_RELEASE',
  arch: 'UNRAID_LXC_ARCH',
};

// Fields whose value the env override controls (so the UI can flag them as locked).
function envOverriddenFields() {
  return Object.keys(ENV_MAP).filter((k) => process.env[ENV_MAP[k]] !== undefined);
}

function readStored() {
  try {
    const raw = getSetting(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function coerce(field, value) {
  if (value === undefined || value === null) return undefined;
  if (field === 'enabled') {
    if (typeof value === 'boolean') return value;
    return String(value).toLowerCase() === 'true' || value === '1' || value === 1;
  }
  if (field === 'sshPort') {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  if (field === 'connectionMode') {
    return value === 'agent' || value === 'ssh' ? value : undefined;
  }
  return String(value);
}

/**
 * Resolve the effective configuration (env > stored > default).
 * Internal — includes the resolved sshKeyPath so services can read the key.
 */
function getConfig() {
  const stored = readStored();
  const out = {};
  for (const field of Object.keys(DEFAULTS)) {
    const envVal = coerce(field, process.env[ENV_MAP[field]]);
    const storedVal = coerce(field, stored[field]);
    out[field] = envVal !== undefined ? envVal
      : storedVal !== undefined ? storedVal
      : DEFAULTS[field];
  }
  return out;
}

function hasKey(cfg = getConfig()) {
  try {
    return !!cfg.sshKeyPath && fs.existsSync(cfg.sshKeyPath) && fs.statSync(cfg.sshKeyPath).size > 0;
  } catch {
    return false;
  }
}

/**
 * Config shape safe to send to the client. Never includes the private key
 * contents or the agent API key — only whether each is present and which
 * fields are env-locked.
 */
function getPublicConfig() {
  const cfg = getConfig();
  const pub = {
    ...cfg,
    hasKey: hasKey(cfg),
    hasAgentKey: !!cfg.agentApiKey,
    envOverridden: envOverriddenFields(),
  };
  delete pub.agentApiKey;
  return pub;
}

/**
 * Whether the LXC backend is usable with the current config, and why not.
 * Used by the backend picker and project creation.
 */
function readiness(cfg = getConfig()) {
  if (!cfg.enabled) return { ready: false, reason: 'Disabled in Settings.' };
  if (cfg.connectionMode === 'agent') {
    if (!cfg.agentUrl) return { ready: false, reason: 'Opus Connect agent URL is not configured.' };
    if (!cfg.agentApiKey) return { ready: false, reason: 'Opus Connect API key is not configured.' };
    return { ready: true, reason: null };
  }
  if (!hasKey(cfg)) return { ready: false, reason: 'No SSH key configured.' };
  return { ready: true, reason: null };
}

/**
 * Persist a partial config update from the UI. Only known fields are stored.
 * Env-overridden fields are still stored (so removing the env var later keeps
 * the UI value) but the effective value remains the env one until then.
 */
function saveConfig(patch = {}) {
  const stored = readStored();
  const next = { ...stored };
  for (const field of Object.keys(DEFAULTS)) {
    if (!(field in patch)) continue;
    // The API key is write-only from the client: an empty value means "keep
    // the stored key" (the UI never echoes it back), never "clear it".
    if (field === 'agentApiKey' && String(patch[field] || '').trim() === '') continue;
    const v = coerce(field, patch[field]);
    if (v !== undefined) next[field] = v;
  }
  setSetting(SETTINGS_KEY, JSON.stringify(next));
  return getPublicConfig();
}

/**
 * Write a pasted/uploaded private key to the configured key path with 0600
 * permissions. Creates the parent directory if needed. Returns the path.
 */
function writePrivateKey(contents) {
  const cfg = getConfig();
  const keyPath = cfg.sshKeyPath;
  if (!keyPath) throw new Error('SSH key path is not configured.');
  let normalized = String(contents || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) throw new Error('Private key is empty.');
  if (!normalized.endsWith('\n')) normalized += '\n';
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(normalized)) {
    throw new Error('That does not look like a PEM/OpenSSH private key.');
  }
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, normalized, { mode: 0o600 });
  try { fs.chmodSync(keyPath, 0o600); } catch (_) {}
  return keyPath;
}

module.exports = {
  DEFAULTS,
  getConfig,
  getPublicConfig,
  saveConfig,
  hasKey,
  readiness,
  writePrivateKey,
};
