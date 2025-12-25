const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAgentDesktop', {
  openExternal: (url) => ipcRenderer.invoke('browserAgent:openExternal', url),
  getAppVersion: () => ipcRenderer.invoke('browserAgent:getAppVersion'),
});
