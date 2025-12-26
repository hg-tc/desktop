const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const { URL } = require('url');

const isDev = !app.isPackaged;

function resolveDevServerUrl() {
  const envUrl = process.env.VITE_DEV_SERVER_URL;
  if (envUrl && envUrl.trim()) return envUrl;
  return 'http://localhost:1420';
}

function resolveRemoteAppUrl() {
  const raw = process.env.BROWSER_AGENT_REMOTE_URL || process.env.CONSULT_WEB_URL;
  if (!raw || !raw.trim()) return null;
  try {
    return new URL(raw.trim()).toString();
  } catch {
    return null;
  }
}

function getAllowedOrigins() {
  const origins = new Set();
  const remote = resolveRemoteAppUrl();
  if (remote) {
    origins.add(new URL(remote).origin);
  }
  if (isDev) {
    origins.add(new URL(resolveDevServerUrl()).origin);
  }
  return origins;
}

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const allowedOrigins = getAllowedOrigins();
    return allowedOrigins.has(u.origin);
  } catch {
    return false;
  }
}

function getWorkerBaseUrl() {
  const raw = process.env.BROWSER_AGENT_WORKER_URL || 'http://127.0.0.1:8765';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'http://127.0.0.1:8765';
    return u.toString().replace(/\/$/, '');
  } catch {
    return 'http://127.0.0.1:8765';
  }
}

async function workerRequest(method, pathname, body) {
  const base = getWorkerBaseUrl();
  const url = new URL(pathname, base);
  const init = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), init);
  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`Worker request failed (${res.status} ${res.statusText})`);
    err.payload = payload;
    throw err;
  }
  return payload;
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#f8fafc',
    title: 'Browser Agent',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedUrl(url)) return;
    const isHttp = url.startsWith('http://') || url.startsWith('https://');
    if (!isHttp) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  const remoteUrl = resolveRemoteAppUrl();
  if (remoteUrl) {
    win.loadURL(remoteUrl);
  } else if (isDev) {
    win.loadURL(resolveDevServerUrl());
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  ipcMain.handle('browserAgent:openExternal', async (_event, url) => {
    if (typeof url !== 'string' || url.trim() === '') return false;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false;

    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('browserAgent:getAppVersion', () => app.getVersion());

  ipcMain.handle('browserAgent:config', async () => {
    try {
      const raw = await workerRequest('GET', '/api/config');
      return {
        api_base: raw && typeof raw.api_base === 'string' ? raw.api_base : null,
        model: raw && typeof raw.model === 'string' ? raw.model : null,
        browser_url: raw && typeof raw.browser_url === 'string' ? raw.browser_url : null,
        has_api_key: Boolean(raw && raw.api_key),
      };
    } catch (e) {
      return { error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('browserAgent:status', async () => {
    try {
      return await workerRequest('GET', '/api/status');
    } catch (e) {
      return { initialized: false, connected: false, error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('browserAgent:tools', async () => {
    try {
      return await workerRequest('GET', '/api/tools');
    } catch (e) {
      return { tools: [], error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('browserAgent:setup', async (_event, payload) => {
    try {
      return await workerRequest('POST', '/api/setup', payload || {});
    } catch (e) {
      return { success: false, error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('browserAgent:execute', async (_event, payload) => {
    const safe = payload && typeof payload === 'object' ? payload : {};
    if (typeof safe.prompt !== 'string' || safe.prompt.trim() === '') {
      return { success: false, output: '', error: "Missing 'prompt'" };
    }
    try {
      return await workerRequest('POST', '/api/execute', { prompt: safe.prompt });
    } catch (e) {
      return { success: false, output: '', error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('browserAgent:clearHistory', async () => {
    try {
      return await workerRequest('POST', '/api/clear-history', {});
    } catch (e) {
      return { success: false, error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('browserAgent:shutdown', async () => {
    try {
      return await workerRequest('POST', '/api/shutdown', {});
    } catch (e) {
      return { success: false, error: String(e && e.message ? e.message : e) };
    }
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
