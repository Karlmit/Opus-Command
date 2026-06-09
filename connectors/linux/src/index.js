#!/usr/bin/env node
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
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
  quote,
} = require('opus-connector-shared');

const VERSION = '0.1.0';
const DEFAULT_HOME = process.getuid && process.getuid() === 0
  ? '/var/lib/opus-connector'
  : path.join(os.homedir(), '.opus-connector');
const SERVICE_PATH = '/etc/systemd/system/opus-connector.service';
const DEFAULT_UI_HOST = '127.0.0.1';
const DEFAULT_UI_PORT = 3899;

const children = new Map();
const incomingTransfers = new Map();
let shuttingDown = false;
let connectorStarted = false;
let connectionStatus = 'starting';
let lastError = '';
let signalHandlersInstalled = false;

function connectorHome(args = {}) {
  return args.home || process.env.OPUS_CONNECTOR_HOME || DEFAULT_HOME;
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

function readRecentLogs(home, maxLines = 120) {
  try {
    const lines = fs.readFileSync(logPath(home), 'utf8').split('\n').filter(Boolean);
    return lines.slice(-maxLines);
  } catch (_) {
    return [];
  }
}

function wsUrl(server, connectorId, secret) {
  const url = new URL(normalizeServer(server));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/connectors/ws';
  url.searchParams.set('connectorId', connectorId);
  url.searchParams.set('secret', secret);
  return url.toString();
}

function commandExists(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${quote(command)} >/dev/null 2>&1`], {
    stdio: 'ignore',
  });
  return result.status === 0;
}

function commandOutput(command, args = []) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) return '';
  return String(result.stdout || '').trim();
}

function readOsRelease() {
  try {
    const values = {};
    for (const line of fs.readFileSync('/etc/os-release', 'utf8').split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      values[match[1]] = match[2].replace(/^"|"$/g, '');
    }
    return values;
  } catch (_) {
    return {};
  }
}

function dockerAccessible() {
  if (!commandExists('docker')) return false;
  const result = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  return result.status === 0;
}

function detectUsbDevices() {
  if (fs.existsSync('/dev/serial/by-id')) {
    try {
      return fs.readdirSync('/dev/serial/by-id').length;
    } catch (_) {}
  }
  return 0;
}

function detectCapabilities() {
  const osRelease = readOsRelease();
  const has = commandExists;
  const docker = has('docker');
  const compose = has('docker-compose') || (docker && spawnSync('docker', ['compose', 'version'], {
    stdio: 'ignore',
    timeout: 5000,
  }).status === 0);
  const nodeVersion = has('node') ? commandOutput('node', ['--version']) : '';
  const npmVersion = has('npm') ? commandOutput('npm', ['--version']) : '';
  const pythonVersion = has('python3') ? commandOutput('python3', ['--version']) : '';
  const gitVersion = has('git') ? commandOutput('git', ['--version']) : '';
  const playwright = has('playwright') || (has('npx') && spawnSync('sh', ['-lc', 'npx --no-install playwright --version >/dev/null 2>&1'], { timeout: 5000 }).status === 0);
  const adb = has('adb');
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || '';
  const serialDeviceCount = detectUsbDevices();

  const labels = ['linux', 'bash'];
  if (docker) labels.push('docker');
  if (compose) labels.push('docker-compose');
  if (has('git')) labels.push('git');
  if (has('node')) labels.push('node');
  if (has('npm')) labels.push('npm');
  if (has('python3')) labels.push('python');
  if (playwright) labels.push('playwright');
  if (adb) labels.push('adb', 'android');
  if (serialDeviceCount > 0) labels.push('serial', 'hardware');

  return {
    schemaVersion: 1,
    detectedAt: new Date().toISOString(),
    platform: {
      os: 'linux',
      distro: osRelease.PRETTY_NAME || osRelease.NAME || 'Linux',
      distroId: osRelease.ID || '',
      distroVersion: osRelease.VERSION_ID || '',
      architecture: os.arch(),
      kernel: os.release(),
      hostname: os.hostname(),
      initSystem: fs.existsSync('/run/systemd/system') ? 'systemd' : 'unknown',
    },
    development: {
      git: { available: has('git'), version: gitVersion },
      node: { available: has('node'), version: nodeVersion },
      npm: { available: has('npm'), version: npmVersion },
      python3: { available: has('python3'), version: pythonVersion },
      java: { available: has('java'), version: has('java') ? commandOutput('java', ['-version']) : '' },
      dotnet: { available: has('dotnet'), version: has('dotnet') ? commandOutput('dotnet', ['--version']) : '' },
      go: { available: has('go'), version: has('go') ? commandOutput('go', ['version']) : '' },
    },
    containers: {
      docker: { available: docker, accessible: dockerAccessible() },
      dockerCompose: { available: compose },
    },
    browserTesting: {
      playwright: { available: playwright },
      chromium: { available: has('chromium') || has('chromium-browser') || has('google-chrome') },
      firefox: { available: has('firefox') },
    },
    android: {
      adb: { available: adb },
      androidSdk: { available: !!androidHome && fs.existsSync(androidHome), path: androidHome },
      androidStudio: { available: has('studio') || fs.existsSync('/opt/android-studio') },
    },
    hardware: {
      usbDevices: { available: fs.existsSync('/dev/bus/usb') },
      serialDevices: { available: serialDeviceCount > 0, count: serialDeviceCount },
    },
    automation: {
      bash: { available: has('bash') },
      sh: { available: has('sh') },
      pythonScripts: { available: has('python3') },
      powershell: { available: has('pwsh') },
    },
    labels: [...new Set(labels)],
  };
}

function printPreflight(capabilities, json) {
  if (json) {
    console.log(JSON.stringify(capabilities, null, 2));
    return;
  }
  const lines = [
    `OS: ${capabilities.platform.distro}`,
    `Architecture: ${capabilities.platform.architecture}`,
    `Kernel: ${capabilities.platform.kernel}`,
    `Init System: ${capabilities.platform.initSystem}`,
    `Docker: ${capabilities.containers.docker.available ? 'Installed' : 'Missing'}`,
    `Docker Socket: ${capabilities.containers.docker.accessible ? 'Accessible' : 'Not accessible'}`,
    `Docker Compose: ${capabilities.containers.dockerCompose.available ? 'Installed' : 'Missing'}`,
    `Git: ${capabilities.development.git.available ? capabilities.development.git.version : 'Missing'}`,
    `Node.js: ${capabilities.development.node.available ? capabilities.development.node.version : 'Missing'}`,
    `npm: ${capabilities.development.npm.available ? capabilities.development.npm.version : 'Missing'}`,
    `Python3: ${capabilities.development.python3.available ? capabilities.development.python3.version : 'Missing'}`,
    `Playwright: ${capabilities.browserTesting.playwright.available ? 'Available' : 'Missing'}`,
    `ADB: ${capabilities.android.adb.available ? 'Installed' : 'Missing'}`,
    `Serial Devices: ${capabilities.hardware.serialDevices.count}`,
    `Sudo Access: ${process.getuid && process.getuid() === 0 ? 'Root' : commandExists('sudo') ? 'sudo installed' : 'No sudo command'}`,
    `Labels: ${capabilities.labels.join(', ')}`,
  ];
  console.log(lines.join('\n'));
}

async function pair(home, args) {
  if (!args.server) throw new Error('--server is required when pairing.');
  if (!args.pair) throw new Error('--pair is required when pairing.');

  const capabilities = detectCapabilities();
  const suppliedLabels = args.labels ? String(args.labels).split(',') : [];
  const labels = [...new Set([...capabilities.labels, ...suppliedLabels].map(label => String(label).trim()).filter(Boolean))];
  const server = normalizeServer(args.server);
  const response = await fetch(`${server}/api/connectors/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pairingToken: args.pair,
      name: args.name || os.hostname(),
      platform: 'linux',
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

function state(home) {
  const config = readConfig(home);
  return {
    home,
    paired: !!config,
    status: config ? connectionStatus : 'not_paired',
    error: lastError,
    server: config?.server || '',
    connectorId: config?.connectorId || '',
    name: config?.name || '',
    version: VERSION,
    capabilities: detectCapabilities(),
    logs: readRecentLogs(home),
  };
}

function htmlPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Opus Connector for Linux</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #101418; color: #eef2f3; }
    main { max-width: 920px; margin: 0 auto; padding: 28px; }
    header { display: flex; justify-content: space-between; gap: 18px; align-items: center; margin-bottom: 22px; }
    h1 { margin: 0; font-size: 24px; letter-spacing: 0; }
    .status { padding: 8px 12px; border-radius: 6px; background: #26313a; font-weight: 650; }
    .online { background: #0f5132; }
    .error { background: #842029; }
    section { border-top: 1px solid #2b343d; padding: 18px 0; }
    label { display: block; margin: 10px 0 6px; color: #b8c2ca; }
    input { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #43505b; border-radius: 6px; background: #151b21; color: #eef2f3; }
    button { margin-top: 12px; padding: 10px 14px; border: 0; border-radius: 6px; background: #4d8dff; color: white; font-weight: 700; cursor: pointer; }
    pre { white-space: pre-wrap; overflow: auto; background: #070a0d; padding: 14px; border-radius: 6px; max-height: 340px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .card { background: #151b21; border: 1px solid #2b343d; border-radius: 6px; padding: 12px; }
    .muted { color: #9ca8b2; }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Opus Connector for Linux</h1>
        <div class="muted" id="subtitle"></div>
      </div>
      <div class="status" id="status">loading</div>
    </header>
    <section id="pairing"></section>
    <section>
      <h2>Capabilities</h2>
      <div class="grid" id="capabilities"></div>
    </section>
    <section>
      <h2>Logs</h2>
      <pre id="logs"></pre>
    </section>
  </main>
  <script>
    async function refresh() {
      const res = await fetch('/api/state');
      const data = await res.json();
      const status = document.getElementById('status');
      status.textContent = data.status;
      status.className = 'status ' + (data.status === 'online' ? 'online' : data.status === 'error' ? 'error' : '');
      document.getElementById('subtitle').textContent = data.paired ? data.name + ' · ' + data.server : 'Not paired';
      document.getElementById('logs').textContent = (data.logs || []).join('\\n');
      const caps = data.capabilities || {};
      const items = [
        ['Docker', caps.containers?.docker?.available ? (caps.containers.docker.accessible ? 'available' : 'installed, no socket access') : 'missing'],
        ['Docker Compose', caps.containers?.dockerCompose?.available ? 'available' : 'missing'],
        ['Git', caps.development?.git?.available ? caps.development.git.version : 'missing'],
        ['Node.js', caps.development?.node?.available ? caps.development.node.version : 'missing'],
        ['Python3', caps.development?.python3?.available ? caps.development.python3.version : 'missing'],
        ['Playwright', caps.browserTesting?.playwright?.available ? 'available' : 'missing'],
        ['ADB', caps.android?.adb?.available ? 'available' : 'missing'],
        ['Serial Devices', caps.hardware?.serialDevices?.count || 0],
      ];
      document.getElementById('capabilities').innerHTML = items.map(([k, v]) => '<div class="card"><strong>' + k + '</strong><br><span class="muted">' + v + '</span></div>').join('');
      if (!data.paired) {
        document.getElementById('pairing').innerHTML = '<h2>Pair Connector</h2><form id="pairForm"><label>Opus Command URL</label><input name="server" placeholder="http://192.168.1.10:3000" required><label>Pairing Token</label><input name="pair" required><label>Name</label><input name="name" value="' + location.hostname + '"><label>Extra Labels</label><input name="labels" placeholder="linux,docker,server"><button>Pair and Connect</button></form>';
        document.getElementById('pairForm').onsubmit = async (event) => {
          event.preventDefault();
          const body = Object.fromEntries(new FormData(event.target).entries());
          const response = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (!response.ok) alert(await response.text());
          await refresh();
        };
      } else {
        document.getElementById('pairing').innerHTML = '<h2>Connection</h2><div class="grid"><div class="card"><strong>Connector ID</strong><br><span class="muted">' + data.connectorId + '</span></div><div class="card"><strong>Home</strong><br><span class="muted">' + data.home + '</span></div><div class="card"><strong>Version</strong><br><span class="muted">' + data.version + '</span></div></div>';
      }
    }
    refresh();
    setInterval(refresh, 3000);
  </script>
</body>
</html>`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function startUiServer(home, args, onPaired) {
  if (args['no-ui']) return null;
  const host = args['ui-host'] || process.env.OPUS_CONNECTOR_UI_HOST || DEFAULT_UI_HOST;
  const port = parseInt(args['ui-port'] || process.env.OPUS_CONNECTOR_UI_PORT || DEFAULT_UI_PORT, 10);
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(htmlPage());
        return;
      }
      if (req.method === 'GET' && req.url === '/api/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state(home)));
        return;
      }
      if (req.method === 'POST' && req.url === '/api/pair') {
        const body = await readJsonBody(req);
        const config = await pair(home, body);
        onPaired(config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(err.message || String(err));
    }
  });
  server.listen(port, host, () => {
    log(home, `Status UI listening on http://${host}:${port}`);
  });
  server.on('error', err => log(home, `Status UI failed: ${err.message}`));
  return server;
}

function shellCommand(job) {
  const shell = String(job.shell || 'bash').toLowerCase();
  const command = String(job.command || '');

  if (shell === 'bash') return { file: 'bash', args: ['-lc', command], options: { shell: false } };
  if (shell === 'sh') return { file: 'sh', args: ['-lc', command], options: { shell: false } };
  if (shell === 'python' || shell === 'python3') return { file: 'python3', args: ['-c', command], options: { shell: false } };
  if (shell === 'pwsh' || shell === 'powershell') return { file: 'pwsh', args: ['-NoLogo', '-NoProfile', '-Command', command], options: { shell: false } };
  if (shell === 'exec' || shell === 'executable') return { file: command, args: Array.isArray(job.args) ? job.args : [], options: { shell: false } };
  return { file: command, args: [], options: { shell: true } };
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function sendResponse(ws, requestId, result) {
  send(ws, { type: 'response', requestId, ok: true, result });
}

function sendErrorResponse(ws, requestId, err) {
  send(ws, { type: 'response', requestId, ok: false, error: err.message || String(err) });
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

function scriptExtension(shell) {
  const normalized = String(shell || 'bash').toLowerCase();
  if (normalized === 'python' || normalized === 'python3') return '.py';
  if (normalized === 'pwsh' || normalized === 'powershell') return '.ps1';
  if (normalized === 'sh') return '.sh';
  return '.sh';
}

function materializeScript(job, jobDir) {
  if (!job.script?.content) return job;
  const name = String(job.script.name || `script${scriptExtension(job.shell)}`).replace(/[^\w.-]/g, '_');
  const scriptPath = path.join(jobDir, name);
  fs.writeFileSync(scriptPath, String(job.script.content));
  fs.chmodSync(scriptPath, 0o700);

  const shell = String(job.shell || 'bash').toLowerCase();
  if (shell === 'python' || shell === 'python3') return { ...job, shell: 'exec', command: 'python3', args: [scriptPath] };
  if (shell === 'pwsh' || shell === 'powershell') return { ...job, shell: 'pwsh', command: `& '${scriptPath.replace(/'/g, "''")}'` };
  if (shell === 'sh') return { ...job, shell: 'sh', command: quote(scriptPath) };
  return { ...job, shell: 'bash', command: quote(scriptPath) };
}

function stopChild(child) {
  try {
    if (child.pid) process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch (_) {
    try { child.kill('SIGTERM'); } catch (_) {}
  }
  setTimeout(() => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch (_) {}
  }, 5000).unref();
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
  log(home, `Starting job ${job.id}: ${runnableJob.shell || 'bash'} ${runnableJob.command}`);

  let child;
  try {
    child = spawn(command.file, command.args, {
      cwd,
      detached: true,
      ...command.options,
      env: {
        ...process.env,
        ...(runnableJob.env && typeof runnableJob.env === 'object' ? runnableJob.env : {}),
        OPUS_CONNECTOR_HOME: home,
        OPUS_CONNECTOR_JOB_ID: job.id,
        OPUS_CONNECTOR_ARTIFACT_DIR: artifactDir,
      },
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
    send(ws, { type: 'job:complete', jobId: job.id, exitCode, canceled: signal === 'SIGTERM' || signal === 'SIGKILL', durationMs: Date.now() - started });
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
    if (request.mode) fs.chmodSync(targetPath, parseInt(String(request.mode), 8));
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
      send(ws, {
        type: 'file:download:chunk',
        transferId,
        offset,
        contentBase64: chunk.toString('base64'),
      });
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
    incomingTransfers.set(transferId, {
      path: targetPath,
      mode: request.mode,
      stream,
      size: 0,
    });
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
    try {
      if (transfer.mode) fs.chmodSync(transfer.path, parseInt(String(transfer.mode), 8));
      send(ws, {
        type: 'file:upload:complete',
        transferId: request.transferId,
        path: transfer.path,
        size: transfer.size,
        result: { path: transfer.path, size: transfer.size },
      });
    } catch (err) {
      sendTransferError(ws, request.transferId, err);
    }
  });
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

function installSignalHandlers(home) {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  process.on('SIGTERM', () => {
    shuttingDown = true;
    terminateChildren(home);
    setTimeout(() => process.exit(0), 5500).unref();
  });
  process.on('SIGINT', () => {
    shuttingDown = true;
    terminateChildren(home);
    setTimeout(() => process.exit(0), 5500).unref();
  });
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
          capabilities: detectCapabilities(),
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
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
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

function serviceUiArgs(args) {
  const parts = [];
  if (args['no-ui']) parts.push('--no-ui');
  if (args['ui-host']) parts.push('--ui-host', String(args['ui-host']));
  if (args['ui-port']) parts.push('--ui-port', String(args['ui-port']));
  return parts;
}

function installService(home, args = {}) {
  if (process.getuid && process.getuid() !== 0) {
    throw new Error('--install-service must be run as root.');
  }
  if (!fs.existsSync('/run/systemd/system')) {
    throw new Error('systemd was not detected on this host.');
  }
  const nodePath = process.execPath;
  const scriptPath = path.resolve(__filename);
  const uiArgs = serviceUiArgs(args).map(quote).join(' ');
  const unit = `[Unit]
Description=Opus Connector for Linux
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=OPUS_CONNECTOR_HOME=${home}
ExecStart=${nodePath} ${scriptPath} --home ${home}${uiArgs ? ` ${uiArgs}` : ''}
Restart=always
RestartSec=5
KillMode=control-group
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
`;

  ensureLayout(home);
  fs.writeFileSync(SERVICE_PATH, unit);
  spawnSync('systemctl', ['daemon-reload'], { stdio: 'inherit' });
  spawnSync('systemctl', ['enable', '--now', 'opus-connector.service'], { stdio: 'inherit' });
  console.log(`Installed and started opus-connector.service using ${home}`);
}

function uninstallService() {
  if (process.getuid && process.getuid() !== 0) {
    throw new Error('--uninstall-service must be run as root.');
  }
  spawnSync('systemctl', ['disable', '--now', 'opus-connector.service'], { stdio: 'inherit' });
  try {
    fs.unlinkSync(SERVICE_PATH);
  } catch (_) {}
  spawnSync('systemctl', ['daemon-reload'], { stdio: 'inherit' });
  console.log('Removed opus-connector.service');
}

function autostartPath() {
  return path.join(os.homedir(), '.config', 'autostart', 'opus-connector.desktop');
}

function installLoginAutostart(home, args = {}) {
  const nodePath = process.execPath;
  const scriptPath = path.resolve(__filename);
  const target = autostartPath();
  const uiArgs = serviceUiArgs(args).map(quote).join(' ');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `[Desktop Entry]
Type=Application
Name=Opus Connector
Comment=Start Opus Connector after login
Exec=${nodePath} ${scriptPath} --home ${home}${uiArgs ? ` ${uiArgs}` : ''}
Terminal=false
X-GNOME-Autostart-enabled=true
`);
  console.log(`Installed login autostart at ${target}`);
}

function uninstallLoginAutostart() {
  try {
    fs.unlinkSync(autostartPath());
  } catch (_) {}
  console.log('Removed login autostart entry.');
}

async function selfUpdate(args) {
  const source = args['installer'] || args['installer-url'];
  if (!source) throw new Error('--installer PATH_OR_URL is required for --self-update.');
  if (process.getuid && process.getuid() !== 0) {
    throw new Error('--self-update must be run as root.');
  }

  let installerPath = source;
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Installer download failed: HTTP ${response.status}`);
    installerPath = path.join(os.tmpdir(), `opus-linux-connector-installer-${Date.now()}.sh`);
    fs.writeFileSync(installerPath, Buffer.from(await response.arrayBuffer()));
    fs.chmodSync(installerPath, 0o755);
  }

  const result = spawnSync('bash', [installerPath, '--profile', 'none', '--service', 'yes'], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`Self-update failed with exit code ${result.status}`);
  }
}

function usage() {
  console.log(`Opus Linux Connector ${VERSION}

Usage:
  node src/index.js --preflight
  node src/index.js --server http://OPUS_HOST:3000 --pair TOKEN --name "Linux Server"
  node src/index.js --home /var/lib/opus-connector
  sudo node src/index.js --install-service
  node src/index.js --install-autostart
  sudo node src/index.js --self-update --installer ./opus-linux-connector-installer.sh

Options:
  --server            Opus Command base URL, required for first pairing.
  --pair              One-time pairing token generated by Opus Command.
  --name              Friendly connector name.
  --labels            Comma-separated extra labels.
  --home              Connector data directory.
  --init              Create the connector directory layout and exit.
  --preflight         Print detected capabilities and installation readiness.
  --json              Print preflight as JSON.
  --install-service   Install and start systemd service.
  --uninstall-service Remove systemd service.
  --install-autostart Start connector after desktop login.
  --uninstall-autostart Remove desktop login autostart.
  --self-update       Run a newer one-file installer in update mode.
  --installer         Installer path or URL for --self-update.
  --ui-host           Status UI host. Defaults to 127.0.0.1.
  --ui-port           Status UI port. Defaults to 3899.
  --no-ui             Disable local status UI.
  --version           Print version and exit.
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

  if (args.preflight) return printPreflight(detectCapabilities(), !!args.json);
  if (args.init) {
    log(home, `Initialized connector layout at ${home}`);
    return;
  }
  if (args['install-service']) return installService(home, args);
  if (args['uninstall-service']) return uninstallService();
  if (args['install-autostart']) return installLoginAutostart(home, args);
  if (args['uninstall-autostart']) return uninstallLoginAutostart();
  if (args['self-update']) return selfUpdate(args);

  let config = readConfig(home);
  if (args.pair) config = await pair(home, args);

  startUiServer(home, args, nextConfig => connect(home, nextConfig));
  installSignalHandlers(home);

  if (!config) {
    setStatus('not_paired');
    log(home, `No connector config found at ${configPath(home)}. Open the status UI to pair.`);
    return;
  }

  connect(home, config);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[error] ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  detectCapabilities,
};
