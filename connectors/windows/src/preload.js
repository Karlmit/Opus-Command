const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('opusConnector', {
  getState: () => ipcRenderer.invoke('connector:get-state'),
  openHome: () => ipcRenderer.invoke('connector:open-home'),
  onLog: (callback) => ipcRenderer.on('connector:log', (_event, line) => callback(line)),
  onState: (callback) => ipcRenderer.on('connector:state', (_event, state) => callback(state)),
});
