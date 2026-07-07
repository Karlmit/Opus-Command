const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDB } = require('../db');
const { users, settings } = require('../db/schema');
const { eq } = require('drizzle-orm');

const BCRYPT_ROUNDS = 12;

async function hasAdminAccount() {
  const db = getDB();
  const result = db.select().from(users).limit(1).all();
  return result.length > 0;
}

async function createAdminAccount(username, password) {
  const db = getDB();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const now = Date.now();
  db.insert(users).values({ username, passwordHash, createdAt: now }).run();
}

async function verifyCredentials(username, password) {
  const db = getDB();
  const rows = db.select().from(users).where(eq(users.username, username)).all();
  if (!rows.length) return null;
  const user = rows[0];
  const match = await bcrypt.compare(password, user.passwordHash);
  return match ? user : null;
}

async function changePassword(userId, currentPassword, newPassword) {
  const db = getDB();
  const rows = db.select().from(users).where(eq(users.id, userId)).all();
  if (!rows.length) return { success: false, error: 'User not found' };

  const user = rows[0];
  const match = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!match) return { success: false, error: 'Current password is incorrect.' };

  const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  db.update(users).set({ passwordHash: newHash }).where(eq(users.id, userId)).run();
  return { success: true };
}

function getSetting(key) {
  const db = getDB();
  const rows = db.select().from(settings).where(eq(settings.key, key)).all();
  return rows.length ? rows[0].value : null;
}

function setSetting(key, value) {
  const db = getDB();
  db.insert(settings).values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

function deleteSetting(key) {
  const db = getDB();
  db.delete(settings).where(eq(settings.key, key)).run();
}

const WORKSPACE_INSTRUCTION_FILES = {
  claude: 'CLAUDE.md',
  agents: 'AGENTS.md',
};

function workspaceInstructionKey(kind) {
  return `workspace_instruction_template_${kind}`;
}

function getDefaultWorkspaceInstructionTemplate(kind) {
  const file = WORKSPACE_INSTRUCTION_FILES[kind];
  if (!file) return '';
  const candidates = [
    path.join(__dirname, 'workspace-defaults', file),
    path.join(__dirname, '..', 'workspace', `default-${file}`),
    path.join(__dirname, '..', '..', 'workspace-images', 'claude-code', file),
  ];
  for (const candidate of candidates) {
    try {
      return fs.readFileSync(candidate, 'utf8');
    } catch {}
  }
  return '';
}

function getWorkspaceInstructionTemplate(kind, fallback) {
  const stored = getSetting(workspaceInstructionKey(kind));
  if (stored !== null) return stored;
  if (fallback !== undefined) return fallback;
  return getDefaultWorkspaceInstructionTemplate(kind);
}

function setWorkspaceInstructionTemplate(kind, value) {
  if (!WORKSPACE_INSTRUCTION_FILES[kind]) throw new Error('Invalid instruction template.');
  setSetting(workspaceInstructionKey(kind), String(value == null ? '' : value));
}

function resetWorkspaceInstructionTemplate(kind) {
  if (!WORKSPACE_INSTRUCTION_FILES[kind]) throw new Error('Invalid instruction template.');
  deleteSetting(workspaceInstructionKey(kind));
}

function getWorkspaceEnvVars() {
  try {
    const raw = getSetting('workspace_env_vars');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function getWorkspaceAccessToken() {
  let token = getSetting('workspace_access_token');
  if (!token) {
    token = `opus_ws_${crypto.randomBytes(32).toString('base64url')}`;
    setSetting('workspace_access_token', token);
  }
  return token;
}

// Per-workspace terminal-agent token. Distinct from workspace_access_token,
// which is a single global secret deliberately exposed to workspace user code
// (env + /etc/profile.d) for the `opus` CLI. The agent token must NOT be that
// secret: a per-project token means leaking one workspace's token only grants a
// shell in that workspace (which the holder already has), not every LXC on the
// LAN. Stored plaintext (we must present it) in the settings table, same as the
// workspace access token.
function terminalAgentTokenKey(projectId) {
  return `terminal_agent_token:${projectId}`;
}

function getTerminalAgentToken(projectId) {
  const key = terminalAgentTokenKey(projectId);
  let token = getSetting(key);
  if (!token) {
    token = `opus_ta_${crypto.randomBytes(32).toString('base64url')}`;
    setSetting(key, token);
  }
  return token;
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function workspaceTokenFromRequest(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(req.headers['x-opus-workspace-token'] || '').trim();
}

function isValidWorkspaceToken(token) {
  const expected = getSetting('workspace_access_token');
  return !!expected && timingSafeEqual(token, expected);
}

function isWorkspaceTokenRequest(req) {
  return isValidWorkspaceToken(workspaceTokenFromRequest(req));
}

module.exports = {
  hasAdminAccount,
  createAdminAccount,
  verifyCredentials,
  changePassword,
  getSetting,
  setSetting,
  deleteSetting,
  getWorkspaceEnvVars,
  getDefaultWorkspaceInstructionTemplate,
  getWorkspaceInstructionTemplate,
  setWorkspaceInstructionTemplate,
  resetWorkspaceInstructionTemplate,
  getWorkspaceAccessToken,
  getTerminalAgentToken,
  isWorkspaceTokenRequest,
};
