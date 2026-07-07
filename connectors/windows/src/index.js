#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const WebSocket = require('ws');
const {
  parseArgs,
  ensureLayout,
  configPath,
  logPath,
  readConfig,
  writeConfig,
  normalizeServer,
} = require('opus-connector-shared');

// Derive the version from package.json (the single source of truth that also
// drives the release installer name and the auto-update manifest). A hardcoded
// constant here previously drifted from package.json and made the app report an
// old version, triggering an endless auto-update loop.
const VERSION = require('../package.json').version;
// Protocol 2 unlocks scripts, file transfer, and job cancellation on the
// server. The connector advertises it through capabilities.protocol.
const CONNECTOR_PROTOCOL = 2;
const WINDOWS_INSTALL_HOME = 'C:\\OpusConnector';
const DEFAULT_HOME = process.platform === 'win32'
  ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'OpusConnector')
  : path.join(os.homedir(), '.opus-connector');

const children = new Map();
const incomingTransfers = new Map();
let shuttingDown = false;
let connectorStarted = false;
let connectionStatus = 'starting';
let lastError = '';
let signalHandlersInstalled = false;
let activeSocket = null;

function connectorHome(args = {}) {
  return args.home || process.env.OPUS_CONNECTOR_HOME || DEFAULT_HOME;
}

function legacyConfigPath() {
  return process.platform === 'win32'
    ? path.join(WINDOWS_INSTALL_HOME, 'config', 'connector.json')
    : null;
}

function log(home, message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(logPath(home), `${line}\n`);
  } catch (_) {}
}

function setStatus(status, error = '') {
  connectionStatus = status;
  lastError = error;
}

function getStatus() {
  return { status: connectionStatus, error: lastError };
}

function migrateLegacyConfig(home) {
  const oldPath = legacyConfigPath();
  const newPath = configPath(home);
  if (!oldPath || oldPath === newPath || fs.existsSync(newPath) || !fs.existsSync(oldPath)) return;
  fs.copyFileSync(oldPath, newPath);
  log(home, `Migrated connector config from ${oldPath}`);
}

function cryptoRandomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

// ---------------------------------------------------------------------------
// Capability detection (Windows). PowerShell is the headline capability since
// the Windows connector exists primarily to run and test PowerShell.
// ---------------------------------------------------------------------------

// Windows builds a process's PATH from the Machine + User registry values when
// it launches, so a long-running connector keeps the PATH it started with and
// never sees tools added to PATH afterwards (e.g. a fresh `adb` install) — no
// amount of re-scanning helps while the stale PATH is in effect. Re-read the
// live PATH from the registry so detection (which re-runs on every heartbeat)
// and job execution pick up newly-installed tools without a connector restart.
let livePath = process.env.Path || process.env.PATH || '';

function refreshLivePath() {
  if (process.platform !== 'win32') return livePath;
  const result = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    "[Environment]::ExpandEnvironmentVariables(([Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')))",
  ], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  const value = result.status === 0 ? String(result.stdout || '').trim() : '';
  if (value) livePath = value;
  return livePath;
}

function liveEnv(extra) {
  // Override both casings: Windows env is case-insensitive but Node's env
  // object is not, so a stale `Path` would otherwise shadow our `PATH`.
  return { ...process.env, Path: livePath, PATH: livePath, ...(extra || {}) };
}

function capture(command, timeout = 5000) {
  // Run through cmd.exe so .cmd/.bat shims (npm, choco, ...) resolve correctly.
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    env: liveEnv(),
  });
  if (result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

function commandExists(command) {
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `where ${command}`], {
    stdio: 'ignore',
    timeout: 5000,
    windowsHide: true,
    env: liveEnv(),
  });
  return result.status === 0;
}

function powershellVersion() {
  return capture('powershell -NoProfile -NonInteractive -Command "$PSVersionTable.PSVersion.ToString()"');
}

function pwshVersion() {
  if (!commandExists('pwsh')) return '';
  return capture('pwsh -NoProfile -NonInteractive -Command "$PSVersionTable.PSVersion.ToString()"');
}

function dockerAccessible() {
  if (!commandExists('docker')) return false;
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'docker version --format "{{.Server.Version}}"'], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
    env: liveEnv(),
  });
  return result.status === 0 && !!String(result.stdout || '').trim();
}

// Detection spawns ~15 helper processes (powershell, pwsh, node, docker, …),
// which is far too heavy to repeat on every 30-second heartbeat on someone's
// workstation. cachedCapabilities() serves a recent result instead; newly
// installed tools still show up within CAPABILITIES_TTL_MS.
const CAPABILITIES_TTL_MS = 5 * 60 * 1000;
let _capsCache = null;
let _capsCacheAt = 0;

function cachedCapabilities(maxAgeMs = CAPABILITIES_TTL_MS) {
  if (_capsCache && Date.now() - _capsCacheAt < maxAgeMs) return _capsCache;
  return detectCapabilities();
}

function detectCapabilities() {
  refreshLivePath();
  const has = commandExists;
  const psVersion = powershellVersion();
  const pwsh = pwshVersion();
  const dotnet = has('dotnet') ? capture('dotnet --version') : '';
  const node = has('node') ? capture('node --version') : '';
  const npm = has('npm') ? capture('npm --version') : '';
  const python = has('python') ? capture('python --version') : (has('py') ? capture('py --version') : '');
  const git = has('git') ? capture('git --version') : '';
  const docker = has('docker');
  const dockerCompose = docker && !!capture('docker compose version');
  const winget = has('winget');
  const choco = has('chocolatey') || has('choco');
  const wsl = has('wsl');
  const adb = has('adb');
  const playwright = has('playwright') || (has('npx') && !!capture('npx --no-install playwright --version'));

  const labels = ['windows', 'powershell'];
  if (pwsh) labels.push('pwsh');
  if (dotnet) labels.push('dotnet');
  if (node) labels.push('node');
  if (npm) labels.push('npm');
  if (python) labels.push('python');
  if (git) labels.push('git');
  if (docker) labels.push('docker');
  if (dockerCompose) labels.push('docker-compose');
  if (winget) labels.push('winget');
  if (choco) labels.push('choco');
  if (wsl) labels.push('wsl');
  if (adb) labels.push('adb', 'android');
  if (playwright) labels.push('playwright');

  const capabilities = {
    schemaVersion: 1,
    protocol: CONNECTOR_PROTOCOL,
    detectedAt: new Date().toISOString(),
    platform: {
      os: 'windows',
      release: os.release(),
      architecture: os.arch(),
      hostname: os.hostname(),
      version: capture('ver') || `Windows ${os.release()}`,
    },
    shells: {
      windowsPowershell: { available: !!psVersion, version: psVersion },
      powershellCore: { available: !!pwsh, version: pwsh },
      cmd: { available: true },
      bash: { available: has('bash') },
    },
    development: {
      git: { available: !!git, version: git },
      node: { available: !!node, version: node },
      npm: { available: !!npm, version: npm },
      python: { available: !!python, version: python },
      dotnet: { available: !!dotnet, version: dotnet },
    },
    containers: {
      docker: { available: docker, accessible: dockerAccessible() },
      dockerCompose: { available: dockerCompose },
      wsl: { available: wsl },
    },
    browserTesting: {
      playwright: { available: playwright },
      edge: { available: fs.existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe') },
      chrome: { available: fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe') },
    },
    packageManagers: {
      winget: { available: winget },
      chocolatey: { available: choco },
    },
    android: {
      adb: { available: adb },
    },
    automation: {
      powershell: { available: !!psVersion },
      pwsh: { available: !!pwsh },
      python: { available: !!python },
    },
    feedback: { available: true },
    labels: [...new Set(labels)],
  };
  _capsCache = capabilities;
  _capsCacheAt = Date.now();
  return capabilities;
}

function printPreflight(capabilities, json) {
  if (json) {
    console.log(JSON.stringify(capabilities, null, 2));
    return;
  }
  const lines = [
    `OS: ${capabilities.platform.version}`,
    `Architecture: ${capabilities.platform.architecture}`,
    `Windows PowerShell: ${capabilities.shells.windowsPowershell.available ? capabilities.shells.windowsPowershell.version : 'Missing'}`,
    `PowerShell (pwsh): ${capabilities.shells.powershellCore.available ? capabilities.shells.powershellCore.version : 'Missing'}`,
    `.NET SDK: ${capabilities.development.dotnet.available ? capabilities.development.dotnet.version : 'Missing'}`,
    `Node.js: ${capabilities.development.node.available ? capabilities.development.node.version : 'Missing'}`,
    `npm: ${capabilities.development.npm.available ? capabilities.development.npm.version : 'Missing'}`,
    `Python: ${capabilities.development.python.available ? capabilities.development.python.version : 'Missing'}`,
    `Git: ${capabilities.development.git.available ? capabilities.development.git.version : 'Missing'}`,
    `Docker: ${capabilities.containers.docker.available ? (capabilities.containers.docker.accessible ? 'Available' : 'Installed, no daemon') : 'Missing'}`,
    `WSL: ${capabilities.containers.wsl.available ? 'Available' : 'Missing'}`,
    `winget: ${capabilities.packageManagers.winget.available ? 'Available' : 'Missing'}`,
    `Chocolatey: ${capabilities.packageManagers.chocolatey.available ? 'Available' : 'Missing'}`,
    `Playwright: ${capabilities.browserTesting.playwright.available ? 'Available' : 'Missing'}`,
    `Labels: ${capabilities.labels.join(', ')}`,
  ];
  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Feedback store (parity with the Linux connector).
// ---------------------------------------------------------------------------

function feedbackDir(home) {
  return path.join(home, 'OpusCommand', 'feedback');
}

function safeFeedbackId(value) {
  return String(value || '').replace(/[^\w.-]/g, '');
}

function feedbackPath(home, id) {
  const safeId = safeFeedbackId(id);
  if (!safeId) throw new Error('Feedback id is required.');
  return path.join(feedbackDir(home), `${safeId}.json`);
}

function truncateText(value, maxLength) {
  const text = String(value || '').trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function readFeedbackFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function listFeedback(home, { includeRead = true, limit = 100 } = {}) {
  const dir = feedbackDir(home);
  if (!fs.existsSync(dir)) return [];
  const max = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => readFeedbackFile(path.join(dir, name)))
    .filter(Boolean)
    .filter(item => includeRead || !item.readAt)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, max);
}

function createFeedback(home, report = {}) {
  const title = truncateText(report.title, 160);
  const message = truncateText(report.message || report.body, 8000);
  if (!title && !message) throw new Error('Feedback title or message is required.');
  const id = `fb_${Date.now().toString(36)}_${cryptoRandomHex(6)}`;
  const createdAt = new Date().toISOString();
  let context = {};
  if (report.context && typeof report.context === 'object' && !Array.isArray(report.context)) {
    try {
      context = JSON.parse(JSON.stringify(report.context));
    } catch (_) {
      context = {};
    }
  }

  const item = {
    id,
    title: title || message.split('\n')[0].slice(0, 160) || 'Connector feedback',
    message,
    severity: truncateText(report.severity || 'info', 32),
    status: 'unread',
    readAt: null,
    createdAt,
    updatedAt: createdAt,
    source: {
      reporter: truncateText(report.reporter || 'agent', 120),
      workspace: truncateText(report.workspace || '', 240),
      command: truncateText(report.command || '', 1000),
      connectorSelector: truncateText(report.connectorSelector || '', 120),
    },
    context,
  };
  fs.mkdirSync(feedbackDir(home), { recursive: true });
  fs.writeFileSync(feedbackPath(home, id), `${JSON.stringify(item, null, 2)}\n`);
  return item;
}

function markFeedbackRead(home, id, read = true) {
  const file = feedbackPath(home, id);
  if (!fs.existsSync(file)) throw new Error('Feedback report not found.');
  const item = readFeedbackFile(file);
  if (!item) throw new Error('Feedback report is unreadable.');
  const nowIso = new Date().toISOString();
  item.readAt = read ? (item.readAt || nowIso) : null;
  item.status = read ? 'read' : 'unread';
  item.updatedAt = nowIso;
  fs.writeFileSync(file, `${JSON.stringify(item, null, 2)}\n`);
  return item;
}

// ---------------------------------------------------------------------------
// Connection + protocol.
// ---------------------------------------------------------------------------

function wsUrl(server, connectorId, secret) {
  const url = new URL(normalizeServer(server));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/connectors/ws';
  url.searchParams.set('connectorId', connectorId);
  url.searchParams.set('secret', secret);
  return url.toString();
}

async function pair(home, args) {
  if (!args.server) throw new Error('--server is required when pairing.');
  if (!args.pair) throw new Error('--pair is required when pairing.');

  const capabilities = detectCapabilities();
  const suppliedLabels = args.labels ? String(args.labels).split(',') : [];
  const labels = [...new Set([...capabilities.labels, ...suppliedLabels]
    .map(label => String(label).trim())
    .filter(Boolean))];
  const server = normalizeServer(args.server);
  const response = await fetch(`${server}/api/connectors/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pairingToken: args.pair,
      name: args.name || os.hostname(),
      platform: 'windows',
      hostname: os.hostname(),
      version: VERSION,
      labels,
      capabilities,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Pairing failed: HTTP ${response.status} ${body}`);
  }

  const registration = await response.json();
  const config = {
    server,
    connectorId: registration.connectorId,
    connectorSecret: registration.connectorSecret,
    name: args.name || os.hostname(),
    protocolVersion: registration.protocolVersion,
    pairedAt: new Date().toISOString(),
  };
  writeConfig(home, config);
  log(home, `Paired connector ${config.connectorId} with ${server}`);
  return config;
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendResponse(ws, requestId, result) {
  send(ws, { type: 'response', requestId, ok: true, result });
}

function sendErrorResponse(ws, requestId, err) {
  send(ws, { type: 'response', requestId, ok: false, error: err.message || String(err) });
}

// ---------------------------------------------------------------------------
// Job execution.
// ---------------------------------------------------------------------------

function shellCommand(job) {
  const shell = String(job.shell || 'powershell').toLowerCase();
  const command = String(job.command || '');

  if (shell === 'exec' || shell === 'executable') {
    return { file: command, args: Array.isArray(job.args) ? job.args : [], options: { shell: false } };
  }
  if (shell === 'powershell' || shell === 'windows-powershell') {
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      options: { shell: false },
    };
  }
  if (shell === 'pwsh' || shell === 'powershell-core') {
    return {
      file: 'pwsh.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      options: { shell: false },
    };
  }
  if (shell === 'cmd' || shell === 'command') {
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', command], options: { shell: false } };
  }
  if (shell === 'python' || shell === 'python3') {
    return { file: 'python', args: ['-c', command], options: { shell: false } };
  }
  if (shell === 'bash') {
    return { file: 'bash.exe', args: ['-lc', command], options: { shell: false } };
  }
  return { file: command, args: [], options: { shell: true } };
}

function scriptExtension(shell) {
  const normalized = String(shell || 'powershell').toLowerCase();
  if (normalized === 'python' || normalized === 'python3') return '.py';
  if (normalized === 'cmd' || normalized === 'command') return '.cmd';
  if (normalized === 'bash') return '.sh';
  return '.ps1';
}

function materializeScript(job, jobDir) {
  if (!job.script?.content) return job;
  const name = String(job.script.name || `script${scriptExtension(job.shell)}`).replace(/[^\w.-]/g, '_');
  const scriptPath = path.join(jobDir, name);
  fs.writeFileSync(scriptPath, String(job.script.content));

  const shell = String(job.shell || 'powershell').toLowerCase();
  if (shell === 'python' || shell === 'python3') {
    return { ...job, shell: 'exec', command: 'python', args: [scriptPath] };
  }
  if (shell === 'cmd' || shell === 'command') {
    return { ...job, shell: 'exec', command: 'cmd.exe', args: ['/d', '/s', '/c', scriptPath] };
  }
  if (shell === 'bash') {
    return { ...job, shell: 'exec', command: 'bash.exe', args: ['-lc', scriptPath] };
  }
  if (shell === 'pwsh' || shell === 'powershell-core') {
    return { ...job, shell: 'exec', command: 'pwsh.exe', args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath] };
  }
  return { ...job, shell: 'exec', command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath] };
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) entries.push(...listFiles(fullPath));
    else if (stat.isFile()) entries.push(fullPath);
  }
  return entries;
}

function uploadArtifacts(home, ws, job) {
  const artifactDir = path.join(home, 'OpusCommand', 'artifacts', job.id);
  const files = listFiles(artifactDir);
  for (const file of files) {
    const relativeName = path.relative(artifactDir, file).replace(/\\/g, '/');
    const data = fs.readFileSync(file);
    send(ws, {
      type: 'artifact:file',
      jobId: job.id,
      name: relativeName,
      size: data.length,
      contentBase64: data.toString('base64'),
    });
  }
  if (files.length > 0) log(home, `Uploaded ${files.length} artifact(s) for job ${job.id}`);
}

function stopChild(child) {
  if (!child) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      // Kill the whole process tree; PowerShell spawns child processes.
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  } catch (_) {
    try { child.kill('SIGKILL'); } catch (_) {}
  }
}

function runJob(home, ws, job) {
  const started = Date.now();
  const cwd = job.cwd || path.join(home, 'OpusCommand');
  const artifactDir = path.join(home, 'OpusCommand', 'artifacts', job.id);
  const jobDir = path.join(home, 'OpusCommand', 'jobs', job.id);

  fs.mkdirSync(jobDir, { recursive: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  const runnableJob = materializeScript(job, jobDir);
  const command = shellCommand(runnableJob);
  log(home, `Starting job ${job.id}: ${runnableJob.shell || 'powershell'} ${runnableJob.command}`);

  let child;
  try {
    child = spawn(command.file, command.args, {
      cwd,
      windowsHide: true,
      ...command.options,
      env: liveEnv({
        ...(runnableJob.env && typeof runnableJob.env === 'object' ? runnableJob.env : {}),
        OPUS_CONNECTOR_HOME: home,
        OPUS_CONNECTOR_JOB_ID: job.id,
        OPUS_CONNECTOR_ARTIFACT_DIR: artifactDir,
      }),
    });
  } catch (err) {
    send(ws, { type: 'job:output', jobId: job.id, stream: 'stderr', data: `${err.message}\n` });
    send(ws, { type: 'job:complete', jobId: job.id, exitCode: 1, durationMs: Date.now() - started });
    return;
  }

  children.set(job.id, child);
  if (typeof runnableJob.stdin === 'string' && child.stdin) {
    child.stdin.end(runnableJob.stdin);
  } else if (child.stdin) {
    child.stdin.end();
  }
  child.stdout.on('data', chunk => send(ws, { type: 'job:output', jobId: job.id, stream: 'stdout', data: chunk.toString() }));
  child.stderr.on('data', chunk => send(ws, { type: 'job:output', jobId: job.id, stream: 'stderr', data: chunk.toString() }));
  child.on('error', err => send(ws, { type: 'job:output', jobId: job.id, stream: 'stderr', data: `${err.message}\n` }));
  child.on('close', (code, signal) => {
    children.delete(job.id);
    const exitCode = Number.isInteger(code) ? code : 1;
    log(home, `Completed job ${job.id} with exit code ${exitCode}${signal ? ` (${signal})` : ''}`);
    uploadArtifacts(home, ws, job);
    send(ws, {
      type: 'job:complete',
      jobId: job.id,
      exitCode,
      canceled: child.killed || signal === 'SIGTERM' || signal === 'SIGKILL',
      durationMs: Date.now() - started,
    });
  });
}

function cancelJob(home, ws, jobId) {
  const child = children.get(jobId);
  if (!child) {
    send(ws, { type: 'job:complete', jobId, exitCode: 130, canceled: true, durationMs: 0 });
    return;
  }
  log(home, `Canceling job ${jobId}`);
  stopChild(child);
}

// ---------------------------------------------------------------------------
// File transfer.
// ---------------------------------------------------------------------------

function readConnectorFile(ws, request) {
  try {
    const targetPath = path.resolve(String(request.path || ''));
    const stat = fs.statSync(targetPath);
    if (!stat.isFile()) throw new Error('Path is not a file.');
    const data = fs.readFileSync(targetPath);
    sendResponse(ws, request.requestId, {
      path: targetPath,
      name: path.basename(targetPath),
      size: data.length,
      contentBase64: data.toString('base64'),
    });
  } catch (err) {
    sendErrorResponse(ws, request.requestId, err);
  }
}

function writeConnectorFile(ws, request) {
  try {
    const targetPath = path.resolve(String(request.path || ''));
    const data = Buffer.from(request.contentBase64 || '', 'base64');
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, data);
    sendResponse(ws, request.requestId, { path: targetPath, size: data.length });
  } catch (err) {
    sendErrorResponse(ws, request.requestId, err);
  }
}

function sendTransferError(ws, transferId, err) {
  send(ws, { type: 'file:transfer:error', transferId, error: err.message || String(err) });
}

function streamFileDownload(ws, request) {
  const transferId = request.transferId;
  try {
    const targetPath = path.resolve(String(request.path || ''));
    const stat = fs.statSync(targetPath);
    if (!stat.isFile()) throw new Error('Path is not a file.');
    const chunkSize = Math.min(Math.max(parseInt(request.chunkSize, 10) || 256 * 1024, 32 * 1024), 1024 * 1024);
    let offset = 0;
    const stream = fs.createReadStream(targetPath, { highWaterMark: chunkSize });
    stream.on('data', chunk => {
      send(ws, { type: 'file:download:chunk', transferId, offset, contentBase64: chunk.toString('base64') });
      offset += chunk.length;
    });
    stream.on('end', () => {
      send(ws, {
        type: 'file:download:complete',
        transferId,
        path: targetPath,
        name: path.basename(targetPath),
        size: stat.size,
      });
    });
    stream.on('error', err => sendTransferError(ws, transferId, err));
  } catch (err) {
    sendTransferError(ws, transferId, err);
  }
}

function startFileUpload(ws, request) {
  const transferId = request.transferId;
  try {
    const targetPath = path.resolve(String(request.path || ''));
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const stream = fs.createWriteStream(targetPath);
    stream.on('error', err => sendTransferError(ws, transferId, err));
    incomingTransfers.set(transferId, { path: targetPath, stream, size: 0 });
  } catch (err) {
    sendTransferError(ws, transferId, err);
  }
}

function appendFileUploadChunk(ws, request) {
  const transfer = incomingTransfers.get(request.transferId);
  if (!transfer) {
    sendTransferError(ws, request.transferId, new Error('Unknown upload transfer.'));
    return;
  }
  const data = Buffer.from(request.contentBase64 || '', 'base64');
  transfer.size += data.length;
  transfer.stream.write(data);
}

function completeFileUpload(ws, request) {
  const transfer = incomingTransfers.get(request.transferId);
  if (!transfer) {
    sendTransferError(ws, request.transferId, new Error('Unknown upload transfer.'));
    return;
  }
  incomingTransfers.delete(request.transferId);
  transfer.stream.end(() => {
    send(ws, {
      type: 'file:upload:complete',
      transferId: request.transferId,
      path: transfer.path,
      size: transfer.size,
      result: { path: transfer.path, size: transfer.size },
    });
  });
}

function handleFeedbackRequest(home, ws, message) {
  try {
    if (message.type === 'feedback:create') {
      const report = createFeedback(home, message.report || {});
      log(home, `Stored feedback report ${report.id}: ${report.title}`);
      sendResponse(ws, message.requestId, { report });
      return;
    }
    if (message.type === 'feedback:list') {
      sendResponse(ws, message.requestId, {
        reports: listFeedback(home, {
          includeRead: message.includeRead !== false,
          limit: message.limit,
        }),
      });
      return;
    }
    if (message.type === 'feedback:mark-read') {
      const report = markFeedbackRead(home, message.feedbackId, message.read !== false);
      sendResponse(ws, message.requestId, { report });
      return;
    }
    sendErrorResponse(ws, message.requestId, new Error(`Unknown feedback request: ${message.type}`));
  } catch (err) {
    sendErrorResponse(ws, message.requestId, err);
  }
}

function terminateChildren(home) {
  if (children.size === 0) return;
  log(home, `Stopping ${children.size} running job(s).`);
  for (const [jobId, child] of children) {
    try {
      stopChild(child);
    } catch (err) {
      log(home, `Failed to stop job ${jobId}: ${err.message}`);
    }
  }
}

function shutdown(home = connectorHome()) {
  if (shuttingDown) return;
  shuttingDown = true;
  terminateChildren(home);
  try {
    if (activeSocket && activeSocket.readyState === WebSocket.OPEN) activeSocket.close();
  } catch (_) {}
}

function installSignalHandlers(home) {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  const onSignal = () => {
    shutdown(home);
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}

function connect(home, config) {
  if (connectorStarted) return;
  connectorStarted = true;
  let reconnectMs = 1000;

  function open() {
    if (shuttingDown) return;
    const url = wsUrl(config.server, config.connectorId, config.connectorSecret);
    setStatus('connecting');
    log(home, `Connecting to ${config.server}`);
    const ws = new WebSocket(url);
    activeSocket = ws;
    let heartbeat;

    ws.on('open', () => {
      reconnectMs = 1000;
      setStatus('online');
      log(home, 'Connector online.');
      send(ws, { type: 'capabilities:update', capabilities: detectCapabilities(), at: Date.now() });
      heartbeat = setInterval(() => {
        send(ws, {
          type: 'heartbeat',
          at: Date.now(),
          hostname: os.hostname(),
          version: VERSION,
          capabilities: cachedCapabilities(),
        });
      }, 30000);
    });

    ws.on('message', raw => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (err) {
        log(home, `Ignored invalid message: ${err.message}`);
        return;
      }

      if (message.type === 'job:start') runJob(home, ws, message.job);
      else if (message.type === 'job:cancel') cancelJob(home, ws, message.jobId);
      else if (message.type === 'file:read') readConnectorFile(ws, message);
      else if (message.type === 'file:write') writeConnectorFile(ws, message);
      else if (message.type === 'file:download:start') streamFileDownload(ws, message);
      else if (message.type === 'file:upload:start') startFileUpload(ws, message);
      else if (message.type === 'file:upload:chunk') appendFileUploadChunk(ws, message);
      else if (message.type === 'file:upload:complete') completeFileUpload(ws, message);
      else if (message.type?.startsWith('feedback:')) handleFeedbackRequest(home, ws, message);
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      if (activeSocket === ws) activeSocket = null;
      if (shuttingDown) return;
      setStatus('offline');
      log(home, `Connector offline. Reconnecting in ${reconnectMs}ms.`);
      setTimeout(open, reconnectMs).unref();
      reconnectMs = Math.min(reconnectMs * 2, 30000);
    });

    ws.on('error', err => {
      setStatus('error', err.message);
      log(home, `Connection error: ${err.message}`);
    });
  }

  open();
}

function usage() {
  console.log(`Opus Windows Connector ${VERSION}

Usage:
  & "C:\\OpusConnector\\OpusConnector.exe" --server http://OPUS_HOST:3000 --pair TOKEN --name "Windows VM"
  & "C:\\OpusConnector\\OpusConnector.exe" --server https://opus.jabba.se --pair TOKEN --labels "windows,powershell"
  node src/index.js --preflight

Options:
  --server     Opus Command base URL, required for first pairing.
  --pair       One-time pairing token generated by Opus Command.
  --name       Friendly connector name.
  --labels     Comma-separated extra labels, such as windows,powershell.
  --home       Connector data directory. Defaults to C:\\ProgramData\\OpusConnector.
  --init       Create the connector directory layout and exit.
  --preflight  Print detected capabilities and exit.
  --json       Print preflight output as JSON.
  --version    Print version and exit.
`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || args.h) return usage();
  if (args.version) {
    console.log(VERSION);
    return;
  }

  const home = connectorHome(args);
  ensureLayout(home);
  migrateLegacyConfig(home);

  if (args.preflight) return printPreflight(detectCapabilities(), !!args.json);
  if (args.init) {
    log(home, `Initialized connector layout at ${home}`);
    return;
  }

  installSignalHandlers(home);

  let config = readConfig(home);
  if (args.pair) {
    config = await pair(home, args);
  }

  if (!config) {
    setStatus('not_paired');
    throw new Error(`No connector config found at ${configPath(home)}. Pair the connector first.`);
  }

  connect(home, config);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[error] ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  VERSION,
  detectCapabilities,
  cachedCapabilities,
  connectorHome,
  getStatus,
  shutdown,
  createFeedback,
  listFeedback,
  markFeedbackRead,
  feedbackDir,
};
