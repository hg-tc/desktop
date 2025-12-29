const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { URL } = require('url');

const isDev = !app.isPackaged;

const DEFAULT_REMOTE_APP_URL = 'https://ai.ibraintech.top';

const DEFAULT_APP_ID = 'desktop-browser-agent';

let activeAuthorization = null;
let consentStore = null;
let consentStorePath = null;

let pythonWorkerProcess = null;
let xhsMcpProcess = null;

function resolveDevServerUrl() {
  const envUrl = process.env.VITE_DEV_SERVER_URL;
  if (envUrl && envUrl.trim()) return envUrl;
  return 'http://localhost:1420';
}

function resolveRemoteAppUrl() {
  if (process.env.BROWSER_AGENT_FORCE_LOCAL_UI === '1') return null;
  const raw = process.env.BROWSER_AGENT_REMOTE_URL || process.env.CONSULT_WEB_URL;
  if (!raw || !raw.trim()) {
    if (!isDev) return DEFAULT_REMOTE_APP_URL;
    return null;
  }
  try {
    return new URL(raw.trim()).toString();
  } catch {
    return null;
  }
}

function resolveWorkerScriptPath() {
  if (isDev) {
    return path.join(__dirname, '../python/main.py');
  }
  return path.join(process.resourcesPath, 'python', 'main.py');
}

function resolveEmbeddedPythonExecutable() {
  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push(path.join(process.resourcesPath, 'python-runtime', 'python.exe'));
  } else {
    candidates.push(path.join(process.resourcesPath, 'python-runtime', 'bin', 'python3'));
    candidates.push(path.join(process.resourcesPath, 'python-runtime', 'bin', 'python'));
  }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      continue;
    }
  }
  return null;
}

function resolveSystemPythonExecutable() {
  if (process.platform === 'win32') return 'python';
  return 'python3';
}

function resolveXhsMcpExecutablePath() {
  const exeName = process.platform === 'win32' ? 'xiaohongshu-mcp.exe' : 'xiaohongshu-mcp';
  if (!isDev) {
    return path.join(process.resourcesPath, 'xiaohongshu-mcp', exeName);
  }
  return path.join(path.resolve(__dirname, '../../xiaohongshu-mcp'), exeName);
}

function checkTcpPort(host, port, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        return;
      }
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function waitForPort(host, port, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await checkTcpPort(host, port, 250);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function ensurePythonWorker() {
  const u = new URL(getWorkerBaseUrl());
  const host = u.hostname || '127.0.0.1';
  const port = Number(u.port || 8765);
  if (Number.isFinite(port) && (await checkTcpPort(host, port, 250))) return;

  const scriptPath = resolveWorkerScriptPath();
  const pythonExec = resolveEmbeddedPythonExecutable() || resolveSystemPythonExecutable();

  const pythonProjectDir = isDev
    ? path.join(__dirname, '../python')
    : path.join(process.resourcesPath, 'python');
  const bundledSitePackagesDir = path.join(process.resourcesPath, 'python-site-packages');
  const existingPythonPath = typeof process.env.PYTHONPATH === 'string' ? process.env.PYTHONPATH : '';
  const pythonPathParts = [];
  if (!isDev) {
    pythonPathParts.push(bundledSitePackagesDir);
  }
  pythonPathParts.push(pythonProjectDir);
  if (existingPythonPath) pythonPathParts.push(existingPythonPath);
  const pythonPath = pythonPathParts.filter(Boolean).join(path.delimiter);

  const childEnv = {
    ...process.env,
    SERVER_HOST: host,
    SERVER_PORT: String(port),
    UVICORN_RELOAD: '0',
    XIAOHONGSHU_MCP_BASE_URL: 'http://127.0.0.1:18060',
    PYTHONPATH: pythonPath,
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  };

  pythonWorkerProcess = spawn(pythonExec, [scriptPath], {
    env: childEnv,
    stdio: 'inherit',
    windowsHide: true,
  });

  await waitForPort(host, port, 15000);
}

async function ensureXhsMcp() {
  const host = '127.0.0.1';
  const port = 18060;
  if (await checkTcpPort(host, port, 250)) return;

  // Login is much more reliable in headed mode. Default to headed unless explicitly disabled.
  // Set XHS_MCP_HEADLESS=1 to force headless mode.
  const headless = process.env.XHS_MCP_HEADLESS === '1' || process.env.XIAOHONGSHU_MCP_HEADLESS === '1';
  // IMPORTANT: Go's flag.BoolVar treats "--headless" as true and does not consume the next arg.
  // Use "--headless=false" form to reliably set it.
  const mcpArgs = ['--port', ':18060', `--headless=${headless ? 'true' : 'false'}`];

  if (isDev) {
    const xhsDir = path.resolve(__dirname, '../../xiaohongshu-mcp');
    xhsMcpProcess = spawn('go', ['run', '.', ...mcpArgs], {
      cwd: xhsDir,
      env: { ...process.env },
      stdio: 'inherit',
      windowsHide: true,
    });
  } else {
    const exePath = resolveXhsMcpExecutablePath();
    xhsMcpProcess = spawn(exePath, mcpArgs, {
      env: { ...process.env },
      stdio: 'inherit',
      windowsHide: true,
    });
  }

  await waitForPort(host, port, 20000);
}

function safeKillProcess(p) {
  if (!p) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      return;
    }
    p.kill('SIGTERM');
  } catch {
    return;
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

function shouldEnforceAuthorization() {
  return Boolean(resolveRemoteAppUrl());
}

function loadConsentStore() {
  if (consentStore) return consentStore;
  consentStore = {};
  if (!consentStorePath) return consentStore;
  try {
    if (fs.existsSync(consentStorePath)) {
      const raw = fs.readFileSync(consentStorePath, 'utf-8');
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object') {
        consentStore = parsed;
      }
    }
  } catch {
    consentStore = {};
  }
  return consentStore;
}

function saveConsentStore() {
  if (!consentStorePath || !consentStore) return;
  try {
    fs.writeFileSync(consentStorePath, JSON.stringify(consentStore, null, 2), 'utf-8');
  } catch {
    return;
  }
}

function consentKeyFromPayload(payload) {
  const userId = payload && payload.user_id != null ? String(payload.user_id) : 'unknown';
  const appId = payload && typeof payload.app_id === 'string' ? payload.app_id : 'unknown';
  const capability = payload && typeof payload.capability === 'string' ? payload.capability : 'unknown';
  return `${userId}:${appId}:${capability}`;
}

function checkAuthorization(appId, capability, action) {
  if (!shouldEnforceAuthorization()) return { ok: true };
  if (!activeAuthorization || !activeAuthorization.payload) {
    return { ok: false, error: 'Not authorized' };
  }
  if (Date.now() >= activeAuthorization.expiresAtMs) {
    return { ok: false, error: 'Authorization expired' };
  }
  const payload = activeAuthorization.payload;
  if (payload.type !== 'desktop_grant') {
    return { ok: false, error: 'Invalid authorization type' };
  }
  if (payload.app_id !== appId) {
    return { ok: false, error: 'App not authorized' };
  }
  if (payload.capability !== capability) {
    return { ok: false, error: 'Capability not authorized' };
  }
  if (!Array.isArray(payload.actions) || !payload.actions.includes(action)) {
    return { ok: false, error: `Action not authorized: ${action}` };
  }
  const store = loadConsentStore();
  const key = consentKeyFromPayload(payload);
  if (!store[key]) {
    return { ok: false, error: 'Local consent missing' };
  }
  return { ok: true };
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

function normalizeDesktopAction(action) {
  const a = typeof action === 'string' ? action.trim() : '';
  if (!a) return null;
  const allowed = new Set(['status', 'config', 'tools', 'setup', 'execute', 'clearHistory', 'shutdown']);
  if (!allowed.has(a)) return null;
  return a;
}

function mapDesktopActionToRequest(appId, action, payload) {
  const prefix = `/api/apps/${encodeURIComponent(appId)}`;
  switch (action) {
    case 'status':
      return { method: 'GET', path: `${prefix}/status` };
    case 'config':
      return { method: 'GET', path: `${prefix}/config` };
    case 'tools':
      return { method: 'GET', path: `${prefix}/tools` };
    case 'setup':
      return { method: 'POST', path: `${prefix}/setup`, body: payload || {} };
    case 'execute':
      return { method: 'POST', path: `${prefix}/execute`, body: payload || {} };
    case 'clearHistory':
      return { method: 'POST', path: `${prefix}/clear-history`, body: {} };
    case 'shutdown':
      return { method: 'POST', path: `${prefix}/shutdown`, body: {} };
    default:
      return null;
  }
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
  consentStorePath = path.join(app.getPath('userData'), 'desktop-consents.json');

  ensureXhsMcp().catch(() => null);
  ensurePythonWorker().catch(() => null);

  ipcMain.handle('browserAgent:openExternal', async (_event, url) => {
    if (typeof url !== 'string' || url.trim() === '') return false;
    if (!url.startsWith('http://') && !url.startsWith('https://')) return false;

    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('browserAgent:getAppVersion', () => app.getVersion());

  ipcMain.handle('browserAgent:authorize', async (event, payload) => {
    if (!shouldEnforceAuthorization()) {
      return { success: true, enforced: false };
    }

    const safe = payload && typeof payload === 'object' ? payload : {};
    const grant = typeof safe.grant === 'string' ? safe.grant.trim() : '';
    const accessToken = typeof safe.access_token === 'string' ? safe.access_token.trim() : '';
    if (!grant || !accessToken) {
      return { success: false, error: "Missing 'grant' or 'access_token'" };
    }

    let origin;
    try {
      const frameUrl = event && event.senderFrame && event.senderFrame.url ? event.senderFrame.url : null;
      if (!frameUrl || !isAllowedUrl(frameUrl)) {
        return { success: false, error: 'Unauthorized origin' };
      }
      origin = new URL(frameUrl).origin;
    } catch {
      return { success: false, error: 'Invalid origin' };
    }

    const envVerifyBase = process.env.BROWSER_AGENT_REMOTE_API_URL || process.env.CONSULT_API_URL || process.env.BROWSER_AGENT_API_URL;
    const verifyOrigins = [];
    if (envVerifyBase) {
      try {
        verifyOrigins.push(new URL(envVerifyBase).origin);
      } catch {
        return { success: false, error: 'Invalid BROWSER_AGENT_REMOTE_API_URL/CONSULT_API_URL' };
      }
    }
    verifyOrigins.push(origin);

    const uniqOrigins = Array.from(new Set(verifyOrigins));
    const verifyUrls = [];
    for (const o of uniqOrigins) {
      verifyUrls.push(new URL('/api/v1/apps/desktop-grant/verify', o).toString());
      verifyUrls.push(new URL('/api/apps/desktop-grant/verify', o).toString());
    }
    try {
      let lastNonOkError = null;
      let lastInvalid = false;
      let lastUsedUrl = null;
      let data = null;

      for (const url of verifyUrls) {
        lastUsedUrl = url;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ grant }),
        });

        data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const msg = data && (data.detail || data.message) ? String(data.detail || data.message) : `HTTP ${res.status}`;
          lastNonOkError = msg;
          continue;
        }

        if (!data || data.valid !== true || !data.payload) {
          lastInvalid = true;
          continue;
        }

        lastInvalid = false;
        lastNonOkError = null;
        break;
      }

      if (!data || data.valid !== true || !data.payload) {
        if (lastNonOkError) {
          return { success: false, error: lastNonOkError };
        }
        if (lastInvalid) {
          const reason = data && typeof data.reason === 'string' && data.reason ? `; reason=${data.reason}` : '';
          return { success: false, error: `Invalid grant (verified at ${lastUsedUrl})${reason}` };
        }
        return { success: false, error: 'Invalid grant' };
      }

      const exp = typeof data.payload.exp === 'number' ? data.payload.exp : null;
      if (!exp) {
        return { success: false, error: 'Invalid grant payload' };
      }

      activeAuthorization = {
        payload: data.payload,
        expiresAtMs: exp * 1000,
      };

      const store = loadConsentStore();
      const key = consentKeyFromPayload(data.payload);
      store[key] = true;
      consentStore = store;
      saveConsentStore();

      return { success: true, enforced: true, expires_at: exp };
    } catch (e) {
      return { success: false, error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('browserAgent:config', async () => {
    const auth = checkAuthorization(DEFAULT_APP_ID, 'browser_automation', 'config');
    if (!auth.ok) return { error: auth.error };
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
    const auth = checkAuthorization(DEFAULT_APP_ID, 'browser_automation', 'status');
    if (!auth.ok) return { initialized: false, connected: false, error: auth.error };
    try {
      return await workerRequest('GET', '/api/status');
    } catch (e) {
      return { initialized: false, connected: false, error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('browserAgent:tools', async () => {
    const auth = checkAuthorization(DEFAULT_APP_ID, 'browser_automation', 'tools');
    if (!auth.ok) return { tools: [], error: auth.error };
    try {
      return await workerRequest('GET', '/api/tools');
    } catch (e) {
      return { tools: [], error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('browserAgent:setup', async (_event, payload) => {
    const auth = checkAuthorization(DEFAULT_APP_ID, 'browser_automation', 'setup');
    if (!auth.ok) return { success: false, error: auth.error };
    try {
      return await workerRequest('POST', '/api/setup', payload || {});
    } catch (e) {
      return { success: false, error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('browserAgent:execute', async (_event, payload) => {
    const auth = checkAuthorization(DEFAULT_APP_ID, 'browser_automation', 'execute');
    if (!auth.ok) return { success: false, output: '', error: auth.error };
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
    const auth = checkAuthorization(DEFAULT_APP_ID, 'browser_automation', 'clearHistory');
    if (!auth.ok) return { success: false, error: auth.error };
    try {
      return await workerRequest('POST', '/api/clear-history', {});
    } catch (e) {
      return { success: false, error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('browserAgent:shutdown', async () => {
    const auth = checkAuthorization(DEFAULT_APP_ID, 'browser_automation', 'shutdown');
    if (!auth.ok) return { success: false, error: auth.error };
    try {
      return await workerRequest('POST', '/api/shutdown', {});
    } catch (e) {
      return { success: false, error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('desktopApps:listApps', async () => {
    try {
      return await workerRequest('GET', '/api/apps');
    } catch (e) {
      return { apps: [], error: String(e && e.message ? e.message : e) };
    }
  });

  ipcMain.handle('desktopApps:call', async (_event, payload) => {
    const safe = payload && typeof payload === 'object' ? payload : {};
    const appId = typeof safe.app_id === 'string' ? safe.app_id.trim() : '';
    const capability = typeof safe.capability === 'string' ? safe.capability.trim() : '';
    const action = normalizeDesktopAction(safe.action);
    const data = safe.data;
    if (!appId || !capability || !action) {
      return { success: false, error: "Missing 'app_id'/'capability' or invalid 'action'" };
    }

    if (action !== 'status' && action !== 'config') {
      const auth = checkAuthorization(appId, capability, action);
      if (!auth.ok) return { success: false, error: auth.error };
    } else {
      const auth = checkAuthorization(appId, capability, action);
      if (!auth.ok) {
        return action === 'status'
          ? { initialized: false, connected: false, error: auth.error }
          : { error: auth.error };
      }
    }

    const req = mapDesktopActionToRequest(appId, action, data);
    if (!req) {
      return { success: false, error: 'Unsupported action' };
    }

    try {
      return await workerRequest(req.method, req.path, req.body);
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

app.on('before-quit', () => {
  safeKillProcess(pythonWorkerProcess);
  safeKillProcess(xhsMcpProcess);
});
