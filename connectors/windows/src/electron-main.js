const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const { app, BrowserWindow, Menu, Tray, ipcMain, shell, dialog } = require('electron');
const connector = require('./index');

const DEFAULT_HOME = process.platform === 'win32'
  ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'OpusConnector')
  : path.join(os.homedir(), '.opus-connector');
const APP_ICON = path.join(__dirname, '..', 'assets', 'app-icon.ico');

// Auto-update: the connector installer is published as a release asset on the
// Opus Command GitHub repo, alongside a small JSON manifest describing the
// latest connector version. The app polls that manifest, and when a newer
// version is available downloads the installer and runs it silently.
const GITHUB_REPO = 'Karlmit/Opus-Command';
const UPDATE_MANIFEST_ASSET = 'opus-windows-connector.json';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

let tray;
let window;
let quitting = false;
let connectorStarted = false;
let connectionStatus = 'starting';
let lastError = '';
let cachedCapabilities = null;
let updateInfo = { status: 'idle', currentVersion: connector.VERSION, latestVersion: null, error: null };
const logLines = [];

function connectorHome() {
  const args = process.argv;
  const homeIndex = args.indexOf('--home');
  if (homeIndex !== -1 && args[homeIndex + 1]) return args[homeIndex + 1];
  return process.env.OPUS_CONNECTOR_HOME || DEFAULT_HOME;
}

function configPath() {
  return path.join(connectorHome(), 'config', 'connector.json');
}

function logPath() {
  return path.join(connectorHome(), 'logs', 'connector.log');
}

function appendStartupLog(message) {
  try {
    fs.mkdirSync(path.dirname(logPath()), { recursive: true });
    fs.appendFileSync(logPath(), `[${new Date().toISOString()}] ${message}\n`);
  } catch (_) {}
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (_) {
    return null;
  }
}

function refreshCapabilities() {
  try {
    cachedCapabilities = connector.detectCapabilities();
  } catch (err) {
    appendStartupLog(`[error] Capability detection failed: ${err.message}`);
  }
  return cachedCapabilities;
}

function setStatus(status, error = '') {
  connectionStatus = status;
  lastError = error;
  pushState();
}

function pushState() {
  if (window && !window.isDestroyed()) {
    window.webContents.send('connector:state', state());
  }
}

function pushLog(line) {
  const text = String(line);
  logLines.push(text);
  while (logLines.length > 120) logLines.shift();
  if (text.includes('Connecting to ')) connectionStatus = 'connecting';
  if (text.includes('Connector online.')) connectionStatus = 'online';
  if (text.includes('Connector offline.')) connectionStatus = 'offline';
  if (text.startsWith('[error]')) {
    connectionStatus = 'error';
    lastError = text.replace(/^\[error\]\s*/, '');
  }
  if (window && !window.isDestroyed()) {
    window.webContents.send('connector:log', text);
    window.webContents.send('connector:state', state());
  }
}

function state() {
  const config = readConfig();
  return {
    home: connectorHome(),
    paired: !!config,
    status: connectionStatus,
    error: lastError,
    server: config?.server || '',
    connectorId: config?.connectorId || '',
    name: config?.name || '',
    version: connector.VERSION,
    capabilities: cachedCapabilities,
    update: updateInfo,
    logs: logLines,
  };
}

async function startConnector(args = []) {
  if (connectorStarted) return;
  connectorStarted = true;
  setStatus('connecting');
  try {
    await connector.main(args);
  } catch (err) {
    connectorStarted = false;
    const message = err.message || String(err);
    if (message.includes('No connector config found')) setStatus('not_paired', message);
    else setStatus('error', message);
    pushLog(`[error] ${message}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Auto-update.
// ---------------------------------------------------------------------------

function httpsGetJson(url) {
  return httpsGet(url).then(buf => JSON.parse(buf.toString('utf8')));
}

function httpsGet(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'OpusConnector', Accept: 'application/octet-stream, application/json' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirects <= 0) return reject(new Error('Too many redirects.'));
        res.resume();
        return resolve(httpsGet(res.headers.location, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Request timed out.')));
  });
}

function compareSemver(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

async function findUpdateRelease() {
  // Prefer the published "latest" release, then fall back to scanning recent
  // releases for the first one that carries the connector manifest asset.
  const candidates = [];
  try {
    candidates.push(await httpsGetJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`));
  } catch (_) {}
  try {
    const recent = await httpsGetJson(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`);
    if (Array.isArray(recent)) candidates.push(...recent);
  } catch (_) {}

  for (const release of candidates) {
    const manifestAsset = (release?.assets || []).find(a => a.name === UPDATE_MANIFEST_ASSET);
    if (!manifestAsset) continue;
    try {
      const manifest = JSON.parse((await httpsGet(manifestAsset.browser_download_url)).toString('utf8'));
      const installerAsset = (release.assets || []).find(a => a.name === manifest.installer);
      if (manifest.version && installerAsset) {
        return { manifest, installerUrl: installerAsset.browser_download_url };
      }
    } catch (_) {}
  }
  return null;
}

async function checkForUpdates({ interactive = false } = {}) {
  if (updateInfo.status === 'checking' || updateInfo.status === 'downloading') return updateInfo;
  updateInfo = { ...updateInfo, status: 'checking', error: null };
  pushState();
  try {
    const found = await findUpdateRelease();
    if (!found) {
      updateInfo = { ...updateInfo, status: 'idle', error: 'No connector release was found.' };
      pushState();
      if (interactive) dialog.showMessageBox(window, { type: 'info', message: 'No connector release was found yet.' });
      return updateInfo;
    }
    const { manifest, installerUrl } = found;
    const newer = compareSemver(manifest.version, connector.VERSION) > 0;
    updateInfo = {
      status: newer ? 'available' : 'up-to-date',
      currentVersion: connector.VERSION,
      latestVersion: manifest.version,
      notes: manifest.notes || '',
      installerUrl,
      error: null,
    };
    pushState();
    if (newer) {
      pushLog(`Update available: ${manifest.version} (current ${connector.VERSION}).`);
      await applyUpdate(installerUrl, manifest.version);
    } else if (interactive) {
      dialog.showMessageBox(window, { type: 'info', message: `Opus Connector is up to date (v${connector.VERSION}).` });
    }
    return updateInfo;
  } catch (err) {
    updateInfo = { ...updateInfo, status: 'error', error: err.message || String(err) };
    pushState();
    appendStartupLog(`[error] Update check failed: ${err.message}`);
    if (interactive) dialog.showMessageBox(window, { type: 'error', message: `Update check failed: ${err.message}` });
    return updateInfo;
  }
}

async function applyUpdate(installerUrl, version) {
  try {
    updateInfo = { ...updateInfo, status: 'downloading' };
    pushState();
    const buf = await httpsGet(installerUrl);
    const installerPath = path.join(os.tmpdir(), `OpusConnector-Setup-${version}.exe`);
    fs.writeFileSync(installerPath, buf);
    pushLog(`Downloaded installer ${version}. Installing silently…`);
    updateInfo = { ...updateInfo, status: 'installing' };
    pushState();

    // Run the NSIS installer silently. It stops the running app, replaces the
    // files, and relaunches OpusConnector.exe when finished.
    const child = spawn(installerPath, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    // Give the installer a moment to start before we exit so our files unlock.
    setTimeout(() => {
      quitting = true;
      try { connector.shutdown(connectorHome()); } catch (_) {}
      app.quit();
    }, 1500);
  } catch (err) {
    updateInfo = { ...updateInfo, status: 'error', error: err.message || String(err) };
    pushState();
    appendStartupLog(`[error] Update install failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Windows UI.
// ---------------------------------------------------------------------------

function createWindow() {
  if (window && !window.isDestroyed()) {
    window.show();
    window.focus();
    return;
  }

  window = new BrowserWindow({
    width: 620,
    height: 640,
    minWidth: 460,
    minHeight: 460,
    title: 'Opus Connector',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.loadFile(path.join(__dirname, 'status.html'));
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
}

function createTray() {
  tray = new Tray(APP_ICON);
  tray.setToolTip('Opus Connector');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Opus Connector', click: createWindow },
    { label: 'Open Connector Folder', click: () => shell.openPath(connectorHome()) },
    { label: 'Check for Updates…', click: () => checkForUpdates({ interactive: true }) },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        quitting = true;
        try { connector.shutdown(connectorHome()); } catch (_) {}
        app.quit();
      },
    },
  ]));
  tray.on('click', createWindow);
}

function patchConsole() {
  const originalLog = console.log.bind(console);
  const originalError = console.error.bind(console);
  console.log = (...args) => {
    originalLog(...args);
    pushLog(args.join(' '));
  };
  console.error = (...args) => {
    originalError(...args);
    pushLog(args.join(' '));
  };
}

ipcMain.handle('connector:get-state', () => state());
ipcMain.handle('connector:open-home', () => shell.openPath(connectorHome()));
ipcMain.handle('connector:check-updates', () => checkForUpdates({ interactive: true }));
ipcMain.handle('connector:pair', async (_event, payload) => {
  try {
    const args = [
      '--server', String(payload.server || '').trim(),
      '--pair', String(payload.token || '').trim(),
      '--name', String(payload.name || os.hostname()).trim(),
    ];
    const labels = String(payload.labels || '').trim();
    if (labels) args.push('--labels', labels);
    if (!args[1]) throw new Error('Server URL is required.');
    if (!args[3]) throw new Error('Pairing token is required.');
    await startConnector(args);
    return { ok: true, state: state() };
  } catch (err) {
    return { ok: false, error: err.message || String(err), state: state() };
  }
});

app.whenReady().then(() => {
  patchConsole();
  refreshCapabilities();
  createWindow();
  try {
    createTray();
  } catch (err) {
    appendStartupLog(`[error] Tray failed: ${err.message}`);
    pushLog(`[error] Tray failed: ${err.message}`);
  }
  const args = process.argv.slice(1);
  if (readConfig() || args.includes('--pair')) {
    startConnector(args).catch(() => {});
  } else {
    setStatus('not_paired');
    pushLog('Connector is not paired. Enter your Opus server and pairing token.');
  }

  // Refresh capabilities periodically and run update checks in the background.
  setInterval(refreshCapabilities, 5 * 60 * 1000).unref?.();
  setTimeout(() => checkForUpdates().catch(() => {}), 8000);
  setInterval(() => checkForUpdates().catch(() => {}), UPDATE_CHECK_INTERVAL_MS).unref?.();
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

app.on('before-quit', () => {
  quitting = true;
  try { connector.shutdown(connectorHome()); } catch (_) {}
});

process.on('uncaughtException', (err) => {
  appendStartupLog(`[error] Uncaught exception: ${err.stack || err.message}`);
  pushLog(`[error] ${err.message}`);
});

process.on('unhandledRejection', (err) => {
  const message = err?.stack || err?.message || String(err);
  appendStartupLog(`[error] Unhandled rejection: ${message}`);
  pushLog(`[error] ${err?.message || String(err)}`);
});
