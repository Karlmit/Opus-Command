const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, Menu, Tray, ipcMain, shell } = require('electron');
const connector = require('./index');

const DEFAULT_HOME = process.platform === 'win32'
  ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'OpusConnector')
  : path.join(os.homedir(), '.opus-connector');
const APP_ICON = path.join(__dirname, '..', 'assets', 'mark-dark.ico');

let tray;
let window;
let quitting = false;
let connectorStarted = false;
let connectionStatus = 'starting';
let lastError = '';
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

function setStatus(status, error = '') {
  connectionStatus = status;
  lastError = error;
  if (window && !window.isDestroyed()) {
    window.webContents.send('connector:state', state());
  }
}

function pushLog(line) {
  const text = String(line);
  logLines.push(text);
  while (logLines.length > 80) logLines.shift();
  if (text.includes('Connecting to ')) setStatus('connecting');
  if (text.includes('Connector online.')) setStatus('online');
  if (text.includes('Connector offline.')) setStatus('offline');
  if (text.startsWith('[error]')) setStatus('error', text.replace(/^\[error\]\s*/, ''));
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

function createWindow() {
  if (window && !window.isDestroyed()) {
    window.show();
    window.focus();
    return;
  }

  window = new BrowserWindow({
    width: 560,
    height: 520,
    minWidth: 420,
    minHeight: 420,
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
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        quitting = true;
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
ipcMain.handle('connector:pair', async (_event, payload) => {
  try {
    const args = [
      '--server', String(payload.server || '').trim(),
      '--pair', String(payload.token || '').trim(),
      '--name', String(payload.name || os.hostname()).trim(),
      '--labels', String(payload.labels || 'windows,vm').trim(),
    ];
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
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
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
