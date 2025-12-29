const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('browserAgentDesktop', {
  openExternal: (url) => ipcRenderer.invoke('browserAgent:openExternal', url),
  getAppVersion: () => ipcRenderer.invoke('browserAgent:getAppVersion'),
});

contextBridge.exposeInMainWorld('browserAgent', {
  getAppVersion: () => ipcRenderer.invoke('browserAgent:getAppVersion'),
  openExternal: (url) => ipcRenderer.invoke('browserAgent:openExternal', url),
  authorize: (payload) => ipcRenderer.invoke('browserAgent:authorize', payload),
  config: () => ipcRenderer.invoke('browserAgent:config'),
  status: () => ipcRenderer.invoke('browserAgent:status'),
  tools: () => ipcRenderer.invoke('browserAgent:tools'),
  setup: (payload) => ipcRenderer.invoke('browserAgent:setup', payload),
  execute: (payload) => ipcRenderer.invoke('browserAgent:execute', payload),
  clearHistory: () => ipcRenderer.invoke('browserAgent:clearHistory'),
  shutdown: () => ipcRenderer.invoke('browserAgent:shutdown'),
});

contextBridge.exposeInMainWorld('desktopApps', {
  listApps: () => ipcRenderer.invoke('desktopApps:listApps'),
  authorize: (payload) => ipcRenderer.invoke('browserAgent:authorize', payload),
  call: (payload) => ipcRenderer.invoke('desktopApps:call', payload),
  getAppVersion: () => ipcRenderer.invoke('browserAgent:getAppVersion'),
  openExternal: (url) => ipcRenderer.invoke('browserAgent:openExternal', url),
});
