const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, Menu, Tray, ipcMain, shell } = require('electron');
const connector = require('./index');

const DEFAULT_HOME = process.platform === 'win32'
  ? 'C:\\OpusConnector'
  : path.join(os.homedir(), '.opus-connector');

let tray;
let window;
let quitting = false;
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

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (_) {
    return null;
  }
}

function pushLog(line) {
  const text = String(line);
  logLines.push(text);
  while (logLines.length > 80) logLines.shift();
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
    server: config?.server || '',
    connectorId: config?.connectorId || '',
    name: config?.name || '',
    logs: logLines,
  };
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
    icon: path.join(__dirname, '..', 'assets', 'mark-dark.svg'),
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
  tray = new Tray(path.join(__dirname, '..', 'assets', 'mark-dark.svg'));
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

app.whenReady().then(() => {
  patchConsole();
  createTray();
  createWindow();
  connector.main(process.argv.slice(1)).catch((err) => {
    pushLog(`[error] ${err.message}`);
  });
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
