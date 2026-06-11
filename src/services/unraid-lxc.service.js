/**
 * unraid-lxc.service.js — Unraid LXC workspace backend.
 *
 * Mirrors the slice of docker.service that the routes use, but operates over
 * SSH against the `opus-lxc` helper script installed on the Unraid host. All
 * host interaction is funneled through ssh.service so a future V2 can replace
 * SSH/root with a local host agent without touching this file's callers.
 */

const fs = require('fs');
const path = require('path');
const ssh = require('./ssh.service');
const lxcConfig = require('./unraid-lxc.config');

const HELPER_REMOTE_PATH = '/usr/local/bin/opus-lxc';
const HELPER_LOCAL_PATH = path.join(__dirname, '..', 'workspace', 'opus-lxc.sh');
const NAME_PREFIX = 'opus-workspace-';

// ── naming / paths ────────────────────────────────────────────────────────────

function slug(project) {
  const base = path.basename(project.folderPath || project.name || `project-${project.id}`);
  const s = String(base).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || `project-${project.id}`;
}

function containerNameFor(project) {
  return project.lxcContainerName || `${NAME_PREFIX}${slug(project)}-${project.id}`;
}

function projectPathFor(project, cfg = lxcConfig.getConfig()) {
  // One project = one project folder. LXC and Docker workspaces share the same
  // project storage location: <share>/<folderPath>. Only the LXC rootfs/runtime
  // lives separately, under the LXC base path (container name). Existing projects
  // keep their stored lxcProjectPath, so nothing is migrated implicitly.
  if (project.lxcProjectPath) return project.lxcProjectPath;
  const folder = String(project.folderPath || containerNameFor(project)).replace(/^\/+/, '');
  return `${cfg.sharePath.replace(/\/+$/, '')}/${folder}`;
}

function lxcTemplateFor(project) {
  // Reuse the existing template ids; the helper maps claude-code→work provisioning.
  return project.lxcTemplate || project.template || 'claude-code';
}

// ── helper invocation ─────────────────────────────────────────────────────────

function shq(v) {
  return `'${String(v).replace(/'/g, `'\\''`)}'`;
}

function helperEnvPrefix(cfg) {
  return [
    `OPUS_LXC_BASE=${shq(cfg.basePath)}`,
    `OPUS_SHARE_ROOT=${shq(cfg.sharePath)}`,
    `OPUS_LXC_DIST=${shq(cfg.dist)}`,
    `OPUS_LXC_RELEASE=${shq(cfg.release)}`,
    `OPUS_LXC_ARCH=${shq(cfg.arch)}`,
  ].join(' ');
}

// Parse KEY=VALUE lines from helper stdout into an object.
function parseKeyValues(stdout) {
  const out = {};
  for (const line of String(stdout || '').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function runHelper(subcmd, args = [], { timeoutMs } = {}) {
  const cfg = lxcConfig.getConfig();
  const argStr = args.map(shq).join(' ');
  const command = `${helperEnvPrefix(cfg)} ${HELPER_REMOTE_PATH} ${subcmd} ${argStr}`.trim();
  const { code, stdout, stderr } = await ssh.exec(command, { timeoutMs });
  if (code !== 0) {
    const msg = (stderr || stdout || '').trim() || `exit code ${code}`;
    const err = new Error(`opus-lxc ${subcmd} failed: ${msg}`);
    err.code = code;
    err.stdout = stdout;
    err.stderr = stderr;
    throw err;
  }
  return { values: parseKeyValues(stdout), stdout, stderr };
}

// ── helper installation ───────────────────────────────────────────────────────

async function installHelper() {
  const script = fs.readFileSync(HELPER_LOCAL_PATH);
  await ssh.uploadFile(HELPER_REMOTE_PATH, script, 0o755);
  // SFTP mode is advisory on some setups — make the exec bit explicit.
  await ssh.exec(`chmod +x ${HELPER_REMOTE_PATH}`, { timeoutMs: 15_000 });
  return HELPER_REMOTE_PATH;
}

// ── preflight ─────────────────────────────────────────────────────────────────

async function preflight() {
  const checks = {};
  // 1. SSH connectivity
  const conn = await ssh.testConnection();
  checks.ssh = conn.ok;
  if (!conn.ok) {
    return { ok: false, hostname: null, checks, raw: '', error: conn.error };
  }

  // 2. Ensure the helper is installed (install/refresh on every preflight).
  let helperInstalled = false;
  try {
    await installHelper();
    helperInstalled = true;
  } catch (err) {
    checks.helper_install = false;
    return { ok: false, hostname: conn.hostname, checks, raw: '', error: `Helper install failed: ${err.message}` };
  }
  checks.helper_install = helperInstalled;

  // 3. Run the helper's own preflight.
  try {
    const { values, stdout } = await runHelper('preflight', [], { timeoutMs: 30_000 });
    for (const [k, v] of Object.entries(values)) {
      if (v === 'OK' || v === 'FAIL') checks[k] = v === 'OK';
    }
    const ok = Object.values(checks).every(Boolean);
    return { ok, hostname: conn.hostname, checks, raw: stdout, containerCount: parseInt(values.container_count || '0', 10) };
  } catch (err) {
    return { ok: false, hostname: conn.hostname, checks, raw: err.stdout || '', error: err.message };
  }
}

// ── lifecycle ─────────────────────────────────────────────────────────────────

function mapState(state) {
  switch (state) {
    case 'RUNNING': return 'running';
    case 'FROZEN':  return 'running';
    case 'STOPPED': return 'stopped';
    default:        return 'stopped';
  }
}

async function getStatus(project) {
  try {
    const name = containerNameFor(project);
    const { values } = await runHelper('status', ['--name', name], { timeoutMs: 20_000 });
    return mapState(values.STATE);
  } catch {
    return 'stopped';
  }
}

/**
 * Create (if needed) the LXC container and its /workspace bind mount.
 * Returns the resolved name + path for the route to persist. Does not start.
 */
async function createWorkspace(project) {
  const cfg = lxcConfig.getConfig();
  const name = containerNameFor(project);
  const projectPath = projectPathFor(project, cfg);
  await installHelper(); // ensure helper present before first use
  await runHelper('create', [
    '--name', name,
    '--project-path', projectPath,
    '--template', lxcTemplateFor(project),
  ], { timeoutMs: 300_000 });
  return { lxcContainerName: name, lxcProjectPath: projectPath, lxcTemplate: lxcTemplateFor(project) };
}

async function startWorkspace(project) {
  const { values } = await runHelper('start', ['--name', containerNameFor(project)], { timeoutMs: 60_000 });
  return mapState(values.STATE);
}

async function stopWorkspace(project) {
  const { values } = await runHelper('stop', ['--name', containerNameFor(project)], { timeoutMs: 45_000 });
  return mapState(values.STATE);
}

async function restartWorkspace(project) {
  const { values } = await runHelper('restart', ['--name', containerNameFor(project)], { timeoutMs: 90_000 });
  return mapState(values.STATE);
}

async function updateWorkspace(project) {
  const { stdout, stderr } = await runHelper('update', [
    '--name', containerNameFor(project),
    '--template', lxcTemplateFor(project),
  ], { timeoutMs: 600_000 });
  return { log: `${stderr || ''}${stdout || ''}`.trim() };
}

async function removeWorkspace(project) {
  try {
    await runHelper('destroy', ['--name', containerNameFor(project)], { timeoutMs: 60_000 });
  } catch (err) {
    // Non-fatal: project deletion should proceed even if the container is gone.
    console.warn('[unraid-lxc] destroy warning:', err.message);
  }
}

// ── terminal ──────────────────────────────────────────────────────────────────

// Remote command that opens an interactive login shell inside /workspace.
function terminalCommand(project) {
  const name = containerNameFor(project);
  return `lxc-attach -n ${shq(name)} -- bash -lc 'cd /workspace 2>/dev/null; exec bash -l'`;
}

// Wait until the container's init is up enough for lxc-attach to work. Right
// after `lxc-start` the monitor reports RUNNING before init has a pid, so the
// first attach can fail with "Failed to get init pid / Connection refused".
// The retry loop runs on the host to avoid many SSH round-trips; it returns
// almost instantly once the container is ready (the common case).
async function waitUntilAttachable(project, { attempts = 25, delayMs = 400 } = {}) {
  const name = containerNameFor(project);
  const sleepS = (delayMs / 1000).toFixed(2);
  const cmd =
    `for i in $(seq 1 ${attempts}); do ` +
    `lxc-attach -n ${shq(name)} -- true >/dev/null 2>&1 && { echo OPUS_READY; exit 0; }; ` +
    `sleep ${sleepS}; done; exit 7`;
  try {
    const { stdout } = await ssh.exec(cmd, { timeoutMs: attempts * delayMs + 15_000 });
    return stdout.includes('OPUS_READY');
  } catch {
    return false;
  }
}

// Open an interactive PTY (over SSH) attached to the container's /workspace.
// Waits for the container to be attachable first so the first terminal after a
// start doesn't fail with the init-pid race. Returns the ssh.openShell handle.
async function openTerminal(project, { cols = 80, rows = 24 } = {}, handlers = {}) {
  const ready = await waitUntilAttachable(project);
  if (!ready) {
    throw new Error('the container is not ready to attach (it may be stopped or still starting)');
  }
  return ssh.openShell({ command: terminalCommand(project), cols, rows }, handlers);
}

module.exports = {
  NAME_PREFIX,
  containerNameFor,
  projectPathFor,
  lxcTemplateFor,
  installHelper,
  preflight,
  getStatus,
  createWorkspace,
  startWorkspace,
  stopWorkspace,
  restartWorkspace,
  updateWorkspace,
  removeWorkspace,
  terminalCommand,
  waitUntilAttachable,
  openTerminal,
};
