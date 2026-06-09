#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
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

const VERSION = '0.1.3';
const WINDOWS_INSTALL_HOME = 'C:\\OpusConnector';
const DEFAULT_HOME = process.platform === 'win32'
  ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'OpusConnector')
  : path.join(os.homedir(), '.opus-connector');

function connectorHome(args) {
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

function migrateLegacyConfig(home) {
  const oldPath = legacyConfigPath();
  const newPath = configPath(home);
  if (!oldPath || oldPath === newPath || fs.existsSync(newPath) || !fs.existsSync(oldPath)) return;
  fs.copyFileSync(oldPath, newPath);
  log(home, `Migrated connector config from ${oldPath}`);
}

function wsUrl(server, connectorId, secret) {
  const base = normalizeServer(server);
  const url = new URL(base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/connectors/ws';
  url.searchParams.set('connectorId', connectorId);
  url.searchParams.set('secret', secret);
  return url.toString();
}

async function pair(home, args) {
  if (!args.server) throw new Error('--server is required when pairing.');
  if (!args.pair) throw new Error('--pair is required when pairing.');

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
      labels: args.labels,
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

function shellCommand(job) {
  const command = job.command;
  const shell = String(job.shell || 'powershell').toLowerCase();

  if (shell === 'powershell' || shell === 'windows-powershell') {
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      options: { shell: false },
    };
  }

  if (shell === 'pwsh' || shell === 'powershell-core') {
    return {
      file: 'pwsh.exe',
      args: ['-NoLogo', '-NoProfile', '-Command', command],
      options: { shell: false },
    };
  }

  if (shell === 'cmd' || shell === 'command') {
    return {
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', command],
      options: { shell: false },
    };
  }

  return {
    file: command,
    args: [],
    options: { shell: true },
  };
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = [];
  for (const name of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      entries.push(...listFiles(fullPath));
    } else if (stat.isFile()) {
      entries.push(fullPath);
    }
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
  if (files.length > 0) {
    log(home, `Uploaded ${files.length} artifact(s) for job ${job.id}`);
  }
}

function runJob(home, ws, job) {
  const started = Date.now();
  const command = shellCommand(job);
  const cwd = job.cwd || path.join(home, 'OpusCommand');
  const artifactDir = path.join(home, 'OpusCommand', 'artifacts', job.id);

  fs.mkdirSync(path.join(home, 'OpusCommand', 'jobs', job.id), { recursive: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  log(home, `Starting job ${job.id}: ${job.shell || 'powershell'} ${job.command}`);

  let child;
  try {
    child = spawn(command.file, command.args, {
      cwd,
      windowsHide: true,
      ...command.options,
      env: {
        ...process.env,
        OPUS_CONNECTOR_HOME: home,
        OPUS_CONNECTOR_JOB_ID: job.id,
        OPUS_CONNECTOR_ARTIFACT_DIR: artifactDir,
      },
    });
  } catch (err) {
    send(ws, {
      type: 'job:output',
      jobId: job.id,
      stream: 'stderr',
      data: `${err.message}\n`,
    });
    send(ws, {
      type: 'job:complete',
      jobId: job.id,
      exitCode: 1,
      durationMs: Date.now() - started,
    });
    return;
  }

  child.stdout.on('data', (chunk) => {
    send(ws, { type: 'job:output', jobId: job.id, stream: 'stdout', data: chunk.toString() });
  });

  child.stderr.on('data', (chunk) => {
    send(ws, { type: 'job:output', jobId: job.id, stream: 'stderr', data: chunk.toString() });
  });

  child.on('error', (err) => {
    send(ws, { type: 'job:output', jobId: job.id, stream: 'stderr', data: `${err.message}\n` });
  });

  child.on('close', (code) => {
    const exitCode = Number.isInteger(code) ? code : 1;
    log(home, `Completed job ${job.id} with exit code ${exitCode}`);
    uploadArtifacts(home, ws, job);
    send(ws, {
      type: 'job:complete',
      jobId: job.id,
      exitCode,
      durationMs: Date.now() - started,
    });
  });
}

function connect(home, config) {
  let reconnectMs = 1000;

  function open() {
    const url = wsUrl(config.server, config.connectorId, config.connectorSecret);
    log(home, `Connecting to ${config.server}`);
    const ws = new WebSocket(url);
    let heartbeat;

    ws.on('open', () => {
      reconnectMs = 1000;
      log(home, 'Connector online.');
      heartbeat = setInterval(() => {
        send(ws, { type: 'heartbeat', at: Date.now(), hostname: os.hostname(), version: VERSION });
      }, 30000);
    });

    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (err) {
        log(home, `Ignored invalid message: ${err.message}`);
        return;
      }

      if (message.type === 'job:start') {
        runJob(home, ws, message.job);
      }
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
      log(home, `Connector offline. Reconnecting in ${reconnectMs}ms.`);
      setTimeout(open, reconnectMs);
      reconnectMs = Math.min(reconnectMs * 2, 30000);
    });

    ws.on('error', (err) => {
      log(home, `Connection error: ${err.message}`);
    });
  }

  open();
}

function usage() {
  console.log(`Opus Windows Connector ${VERSION}

Usage:
  & "C:\\OpusConnector\\OpusConnector.exe" --server http://OPUS_HOST:3000 --pair TOKEN --name "Windows VM"
  & "C:\\OpusConnector\\OpusConnector.exe" --server https://opus.jabba.se --pair TOKEN --labels "windows,android,adb"
  & "C:\\OpusConnector\\OpusConnector.exe" --home C:\\ProgramData\\OpusConnector

Options:
  --server   Opus Command base URL, required for first pairing.
  --pair     One-time pairing token generated by Opus Command.
  --name     Friendly connector name.
  --labels   Comma-separated connector labels, such as windows,android,adb.
  --home     Connector data directory. Defaults to C:\\ProgramData\\OpusConnector on Windows.
  --init     Create the connector directory layout and exit.
  --version  Print version and exit.
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

  if (args.init) {
    log(home, `Initialized connector layout at ${home}`);
    return;
  }

  let config = readConfig(home);
  if (args.pair) {
    config = await pair(home, args);
  }

  if (!config) {
    usage();
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

module.exports = { main };
