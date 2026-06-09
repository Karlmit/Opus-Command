const { PassThrough } = require('stream');
const { docker, containerName } = require('./docker.service');

const CDESKTOP_PORT = parseInt(process.env.CDESKTOP_PORT || '3910', 10);
const RUNTIME_DIR = '/root/.cdesktop/opus-command';
const PID_FILE = `${RUNTIME_DIR}/cdesktop.pid`;
const LOG_FILE = `${RUNTIME_DIR}/cdesktop.log`;
const MIN_NODE = [20, 19, 0];
const WORKSPACE_BIN_PATH = '/root/bin:/root/.npm-global/bin:/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

const transitions = new Map();

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function transition(projectId, status, message = '') {
  transitions.set(String(projectId), { status, message, at: Date.now() });
}

function clearTransition(projectId) {
  transitions.delete(String(projectId));
}

function activeTransition(projectId) {
  const item = transitions.get(String(projectId));
  if (!item) return null;
  if (Date.now() - item.at > 10 * 60 * 1000) {
    transitions.delete(String(projectId));
    return null;
  }
  return item;
}

function parseVersion(version) {
  const match = String(version || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return match.slice(1).map(n => parseInt(n, 10));
}

function isNodeSupported(version) {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  for (let i = 0; i < MIN_NODE.length; i += 1) {
    if (parsed[i] > MIN_NODE[i]) return true;
    if (parsed[i] < MIN_NODE[i]) return false;
  }
  return true;
}

function stripDockerMultiplex(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return buffer?.toString('utf8') || '';
  const chunks = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset + 4);
    if (size < 0 || offset + 8 + size > buffer.length) return buffer.toString('utf8');
    chunks.push(buffer.slice(offset + 8, offset + 8 + size));
    offset += 8 + size;
  }
  if (offset !== buffer.length) return buffer.toString('utf8');
  return Buffer.concat(chunks).toString('utf8');
}

async function inspectContainer(projectId) {
  const container = docker.getContainer(containerName(projectId));
  const info = await container.inspect();
  return { container, info };
}

async function execInWorkspace(projectId, command, options = {}) {
  return execRawInWorkspace(projectId, ['bash', '-lc', command], options);
}

async function execRawInWorkspace(projectId, cmd, options = {}) {
  const { container, info } = await inspectContainer(projectId);
  if (!info.State?.Running) {
    throw new Error('Workspace container is not running.');
  }

  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    WorkingDir: '/workspace',
  });

  const stream = await exec.start({ Detach: false, Tty: false });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdoutChunks = [];
  const stderrChunks = [];
  stdout.on('data', chunk => stdoutChunks.push(chunk));
  stderr.on('data', chunk => stderrChunks.push(chunk));
  docker.modem.demuxStream(stream, stdout, stderr);

  await new Promise((resolve, reject) => {
    const timer = options.timeoutMs
      ? setTimeout(() => reject(new Error(`Command timed out after ${options.timeoutMs}ms.`)), options.timeoutMs)
      : null;
    stream.on('end', () => {
      if (timer) clearTimeout(timer);
      resolve();
    });
    stream.on('error', err => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });

  const inspect = await exec.inspect();
  const result = {
    exitCode: inspect.ExitCode,
    stdout: stripDockerMultiplex(Buffer.concat(stdoutChunks)),
    stderr: stripDockerMultiplex(Buffer.concat(stderrChunks)),
  };
  if (result.exitCode !== 0 && !options.allowFailure) {
    const output = `${result.stderr || result.stdout}`.trim();
    throw new Error(output || `Command exited with ${result.exitCode}.`);
  }
  return result;
}

async function execDetachedInWorkspace(projectId, command) {
  const { container, info } = await inspectContainer(projectId);
  if (!info.State?.Running) {
    throw new Error('Workspace container is not running.');
  }

  const exec = await container.exec({
    Cmd: ['bash', '-lc', command],
    AttachStdout: false,
    AttachStderr: false,
    Tty: false,
    WorkingDir: '/workspace',
  });
  await exec.start({ Detach: true, Tty: false });
}

async function bootstrapCdesktop(projectId) {
  const script = String.raw`
const fs = require('fs');
const path = require('path');

const dataDir = '/root/.local/share/cdesktop';
fs.mkdirSync(dataDir, { recursive: true });

const configPath = path.join(dataDir, 'config.json');
const defaultConfig = {
  config_version: 'v8',
  theme: 'DARK',
  executor_profile: { executor: 'CLAUDE_CODE' },
  disclaimer_acknowledged: true,
  onboarding_acknowledged: true,
  remote_onboarding_acknowledged: false,
  notifications: {
    sound_enabled: false,
    push_enabled: false,
    sound_file: 'ABSTRACT_SOUND3',
  },
  editor: {
    editor_type: 'VS_CODE',
    custom_command: null,
    remote_ssh_host: null,
    remote_ssh_user: null,
    auto_install_extension: false,
  },
  github: {
    pat: null,
    oauth_token: null,
    username: null,
    primary_email: null,
    default_pr_base: 'main',
  },
  analytics_enabled: false,
  workspace_dir: '/workspace',
  last_app_version: null,
  show_release_notes: false,
  language: 'EN',
  git_branch_prefix: 'cdt',
  showcases: {},
  pr_auto_description_enabled: true,
  pr_auto_description_prompt: null,
  commit_reminder_enabled: false,
  commit_reminder_prompt: null,
  send_message_shortcut: 'Enter',
  relay_enabled: false,
  host_nickname: 'Opus Workspace',
};

let config = defaultConfig;
try {
  config = { ...defaultConfig, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
} catch (_) {}
config.workspace_dir = '/workspace';
config.executor_profile = config.executor_profile || { executor: 'CLAUDE_CODE' };
config.disclaimer_acknowledged = true;
config.onboarding_acknowledged = true;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

const profilesPath = path.join(dataDir, 'profiles.json');
let profiles = { executors: {} };
try {
  profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
} catch (_) {}
profiles.executors ||= {};
profiles.executors.CODEX ||= {};
profiles.executors.CODEX.DEFAULT ||= {};
profiles.executors.CODEX.DEFAULT.CODEX ||= {};
profiles.executors.CODEX.DEFAULT.CODEX = {
  append_prompt: null,
  sandbox: 'danger-full-access',
  ask_for_approval: 'never',
  plan: false,
  ...profiles.executors.CODEX.DEFAULT.CODEX,
};

const foundryKeys = [
  'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_FOUNDRY_RESOURCE',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_FOUNDRY_API_KEY',
];
const claudeEnv = {
  IS_SANDBOX: '1',
};
for (const key of foundryKeys) {
  if (process.env[key]) claudeEnv[key] = process.env[key];
}
if (claudeEnv.ANTHROPIC_FOUNDRY_RESOURCE && claudeEnv.ANTHROPIC_FOUNDRY_API_KEY) {
  claudeEnv.CLAUDE_CODE_USE_FOUNDRY = claudeEnv.CLAUDE_CODE_USE_FOUNDRY || '1';
}
profiles.executors.CLAUDE_CODE ||= {};
profiles.executors.CLAUDE_CODE.DEFAULT ||= {};
profiles.executors.CLAUDE_CODE.DEFAULT.CLAUDE_CODE ||= {};
profiles.executors.CLAUDE_CODE.DEFAULT.CLAUDE_CODE.dangerously_skip_permissions = true;
profiles.executors.CLAUDE_CODE.DEFAULT.CLAUDE_CODE.env = {
  ...(profiles.executors.CLAUDE_CODE.DEFAULT.CLAUDE_CODE.env || {}),
  ...claudeEnv,
};
fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2));
`;
  await execRawInWorkspace(projectId, ['node', '-e', script], { timeoutMs: 10000 });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function isServiceReachable(projectId) {
  try {
    const response = await fetch(`http://${containerName(projectId)}:${CDESKTOP_PORT}/`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.status < 500;
  } catch (_) {
    return false;
  }
}

async function getNodeVersion(projectId) {
  const result = await execInWorkspace(projectId, 'node -v 2>/dev/null || true', { allowFailure: true, timeoutMs: 5000 });
  return result.stdout.trim();
}

async function getInstalledVersion(projectId) {
  const command = [
    'node - <<\'NODE\'',
    'const { execSync } = require("child_process");',
    'try {',
    '  const json = execSync("npm list -g cdesktop --depth=0 --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });',
    '  const parsed = JSON.parse(json);',
    '  console.log(parsed.dependencies?.cdesktop?.version || "");',
    '} catch { console.log(""); }',
    'NODE',
  ].join('\n');
  const result = await execInWorkspace(projectId, command, { allowFailure: true, timeoutMs: 10000 });
  return result.stdout.trim();
}

async function getProcessInfo(projectId) {
  const command = [
    `mkdir -p ${shellQuote(RUNTIME_DIR)}`,
    `pid=$(cat ${shellQuote(PID_FILE)} 2>/dev/null || true)`,
    'if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then',
    '  printf "running:%s" "$pid"',
    'else',
    `  node -e "const net=require('net'); const s=net.connect(${CDESKTOP_PORT}, '127.0.0.1', () => process.exit(0)); s.setTimeout(1000, () => process.exit(1)); s.on('error', () => process.exit(1));" >/dev/null 2>&1 && { printf "running:"; exit 0; }`,
    '  printf "stopped"',
    'fi',
  ].join('\n');
  const result = await execInWorkspace(projectId, command, { allowFailure: true, timeoutMs: 5000 });
  const output = result.stdout.trim();
  if (output.startsWith('running:')) return { running: true, pid: output.slice('running:'.length) };
  return { running: false, pid: null };
}

async function getLogs(projectId, tail = 200) {
  const safeTail = Math.max(1, Math.min(parseInt(tail, 10) || 200, 1000));
  try {
    const result = await execInWorkspace(projectId, `mkdir -p ${shellQuote(RUNTIME_DIR)}; touch ${shellQuote(LOG_FILE)}; tail -n ${safeTail} ${shellQuote(LOG_FILE)}`, {
      allowFailure: true,
      timeoutMs: 5000,
    });
    return result.stdout || result.stderr || '';
  } catch (err) {
    return err.message || '';
  }
}

async function getStatus(projectId) {
  const pending = activeTransition(projectId);
  try {
    await inspectContainer(projectId);
  } catch (err) {
    return { status: 'stopped', installed: false, running: false, error: 'Workspace container not found.' };
  }

  let nodeVersion = '';
  let installedVersion = '';
  let processInfo = { running: false, pid: null };
  let nodeSupported = false;

  try {
    nodeVersion = await getNodeVersion(projectId);
    nodeSupported = isNodeSupported(nodeVersion);
    installedVersion = await getInstalledVersion(projectId);
    processInfo = await getProcessInfo(projectId);
    if (!processInfo.running && await isServiceReachable(projectId)) {
      processInfo = { running: true, pid: null };
    }
  } catch (err) {
    return {
      status: 'error',
      installed: false,
      running: false,
      error: err.message,
      nodeVersion,
      nodeSupported,
    };
  }

  if (!nodeSupported) {
    return {
      status: 'error',
      installed: !!installedVersion,
      running: false,
      version: installedVersion,
      nodeVersion,
      nodeSupported,
      error: `cdesktop requires Node >=20.19.0. Workspace has ${nodeVersion || 'unknown'}.`,
    };
  }

  if (pending && !processInfo.running) {
    return {
      status: pending.status,
      message: pending.message,
      installed: !!installedVersion,
      running: false,
      version: installedVersion,
      nodeVersion,
      nodeSupported,
    };
  }

  return {
    status: processInfo.running ? 'running' : (installedVersion ? 'stopped' : 'not_installed'),
    installed: !!installedVersion,
    running: processInfo.running,
    pid: processInfo.pid,
    version: installedVersion,
    nodeVersion,
    nodeSupported,
  };
}

async function install(projectId) {
  transition(projectId, 'installing', 'Installing cdesktop in the workspace.');
  try {
    const nodeVersion = await getNodeVersion(projectId);
    if (!isNodeSupported(nodeVersion)) {
      throw new Error(`cdesktop requires Node >=20.19.0. Workspace has ${nodeVersion || 'unknown'}.`);
    }
    await bootstrapCdesktop(projectId);
    await execInWorkspace(projectId, [
      `mkdir -p ${shellQuote(RUNTIME_DIR)} /root/.config/cdesktop`,
      'npm install -g cdesktop --quiet',
    ].join('; '), { timeoutMs: 120000 });
    clearTransition(projectId);
    return getStatus(projectId);
  } catch (err) {
    transition(projectId, 'error', err.message);
    throw err;
  }
}

async function update(projectId, allowedOrigins) {
  transition(projectId, 'updating', 'Updating cdesktop in the workspace.');
  try {
    const wasRunning = (await getStatus(projectId)).running;
    if (wasRunning) await stop(projectId);

    const nodeVersion = await getNodeVersion(projectId);
    if (!isNodeSupported(nodeVersion)) {
      throw new Error(`cdesktop requires Node >=20.19.0. Workspace has ${nodeVersion || 'unknown'}.`);
    }
    await bootstrapCdesktop(projectId);
    await execInWorkspace(projectId, [
      `mkdir -p ${shellQuote(RUNTIME_DIR)} /root/.config/cdesktop`,
      'npm install -g cdesktop@latest --quiet',
    ].join('; '), { timeoutMs: 120000 });

    clearTransition(projectId);
    if (wasRunning) return start(projectId, allowedOrigins);
    return getStatus(projectId);
  } catch (err) {
    transition(projectId, 'error', err.message);
    throw err;
  }
}

async function start(projectId, allowedOrigins) {
  transition(projectId, 'starting', 'Starting cdesktop.');
  try {
    const status = await getStatus(projectId);
    if (status.status === 'running') {
      clearTransition(projectId);
      return status;
    }
    if (!status.nodeSupported) {
      throw new Error(status.error || 'Unsupported workspace Node version.');
    }
    await bootstrapCdesktop(projectId);

    const origin = allowedOrigins || '*';
    const command = [
      `mkdir -p ${shellQuote(RUNTIME_DIR)} /root/.config/cdesktop`,
      `pid=$(cat ${shellQuote(PID_FILE)} 2>/dev/null || true)`,
      `if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "already running"; exit 0; fi`,
      `: > ${shellQuote(LOG_FILE)}`,
      'cd /workspace',
      `echo $$ > ${shellQuote(PID_FILE)}`,
      `exec env PATH=${shellQuote(WORKSPACE_BIN_PATH)} NPM_CONFIG_PREFIX=/root/.npm-global IS_SANDBOX=1 HOST=0.0.0.0 PORT=${CDESKTOP_PORT} CDT_ALLOWED_ORIGINS=${shellQuote(origin)} npx -y cdesktop >> ${shellQuote(LOG_FILE)} 2>&1`,
    ].join('; ');
    await execDetachedInWorkspace(projectId, command);
    await sleep(5000);
    clearTransition(projectId);
    return getStatus(projectId);
  } catch (err) {
    transition(projectId, 'error', err.message);
    throw err;
  }
}

async function stop(projectId) {
  try {
    const killPortScript = `
      const fs = require('fs');
      const portHex = (${CDESKTOP_PORT}).toString(16).toUpperCase().padStart(4, '0');
      const inodes = new Set();
      for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
        let text = '';
        try { text = fs.readFileSync(table, 'utf8'); } catch { continue; }
        for (const line of text.trim().split(/\\n/).slice(1)) {
          const parts = line.trim().split(/\\s+/);
          const local = parts[1] || '';
          const state = parts[3] || '';
          const inode = parts[9] || '';
          if (state === '0A' && local.toUpperCase().endsWith(':' + portHex) && inode) inodes.add(inode);
        }
      }
      for (const pid of fs.readdirSync('/proc').filter(name => /^\\d+$/.test(name))) {
        const fdDir = '/proc/' + pid + '/fd';
        let fds = [];
        try { fds = fs.readdirSync(fdDir); } catch { continue; }
        for (const fd of fds) {
          let target = '';
          try { target = fs.readlinkSync(fdDir + '/' + fd); } catch { continue; }
          const match = target.match(/^socket:\\[(\\d+)\\]$/);
          if (match && inodes.has(match[1])) {
            try { process.kill(Number(pid), 15); } catch {}
            try { process.kill(Number(pid), 9); } catch {}
          }
        }
      }
      try { fs.unlinkSync(${JSON.stringify(PID_FILE)}); } catch {}
    `;

    await execInWorkspace(projectId, [
      `pid=$(cat ${shellQuote(PID_FILE)} 2>/dev/null || true)`,
      'if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi',
      `rm -f ${shellQuote(PID_FILE)}`,
    ].join('\n'), { allowFailure: true, timeoutMs: 10000 });
    await execRawInWorkspace(projectId, ['node', '-e', killPortScript], { timeoutMs: 10000 });
    await sleep(1000);
    clearTransition(projectId);
    return getStatus(projectId);
  } catch (err) {
    transition(projectId, 'error', err.message);
    throw err;
  }
}

async function restart(projectId, allowedOrigins) {
  await stop(projectId);
  return start(projectId, allowedOrigins);
}

module.exports = {
  CDESKTOP_PORT,
  getStatus,
  install,
  update,
  start,
  stop,
  restart,
  getLogs,
};
