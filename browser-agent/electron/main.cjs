const { app, BrowserWindow, shell, ipcMain, session, net: electronNet } = require('electron');
const path = require('path');
const fs = require('fs');
const nodeNet = require('net');
const { spawn } = require('child_process');
const { URL } = require('url');
const dns = require('dns');

const isDev = !app.isPackaged;

let mainWindow = null;

try {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      } catch {
      }
    });
  }
} catch {
}

const DEFAULT_REMOTE_APP_URL = 'https://119.45.92.209';
const DEFAULT_REMOTE_HOST_IP_MAP = {
  'ai.ibraintech.top': '119.45.92.209',
};

const DEFAULT_APP_ID = 'desktop-browser-agent';

let activeAuthorizations = new Map();
let consentStore = null;
let consentStorePath = null;

let pythonWorkerProcess = null;
let xhsMcpProcess = null;
let ensureXhsMcpPromise = null;

if (!isDev) {
  try {
    const remote = process.env.BROWSER_AGENT_FORCE_LOCAL_UI === '1'
      ? null
      : process.env.BROWSER_AGENT_REMOTE_URL || process.env.CONSULT_WEB_URL || DEFAULT_REMOTE_APP_URL;
    if (remote && String(remote).trim()) {
      app.commandLine.appendSwitch('allow-running-insecure-content');

      const hostRules = process.env.BROWSER_AGENT_HOST_RESOLVER_RULES;
      if (hostRules && String(hostRules).trim()) {
        app.commandLine.appendSwitch('host-resolver-rules', String(hostRules).trim());
        appendAppLog('main.log', `chrome switch enabled: host-resolver-rules=${String(hostRules).trim()}`);
      } else {
        try {
          const host = new URL(String(remote).trim()).hostname;
          const remoteIp = process.env.BROWSER_AGENT_REMOTE_IP;
          const ip = (remoteIp && String(remoteIp).trim()) || DEFAULT_REMOTE_HOST_IP_MAP[host];
          if (host && ip && nodeNet.isIP(host) === 0) {
            const rules = `MAP ${host} ${String(ip).trim()}`;
            app.commandLine.appendSwitch('host-resolver-rules', rules);
            appendAppLog('main.log', `chrome switch enabled: host-resolver-rules=${rules}`);
          }
        } catch {
        }
      }

      const proxyServer = process.env.BROWSER_AGENT_PROXY_SERVER || process.env.CONSULT_PROXY_SERVER;
      if (proxyServer && String(proxyServer).trim()) {
        app.commandLine.appendSwitch('proxy-server', String(proxyServer).trim());
        appendAppLog('main.log', `chrome switch enabled: proxy-server=${String(proxyServer).trim()}`);

        const bypass = process.env.BROWSER_AGENT_PROXY_BYPASS_LIST;
        if (bypass && String(bypass).trim()) {
          app.commandLine.appendSwitch('proxy-bypass-list', String(bypass).trim());
          appendAppLog('main.log', `chrome switch enabled: proxy-bypass-list=${String(bypass).trim()}`);
        }
      }

      const ignoreCertEnv = process.env.BROWSER_AGENT_IGNORE_CERT_ERRORS;
      let ignoreCert = ignoreCertEnv === '1';
      if (!ignoreCert && ignoreCertEnv !== '0') {
        try {
          const host = new URL(String(remote).trim()).hostname;
          if (host && nodeNet.isIP(host) !== 0) {
            ignoreCert = true;
            appendAppLog('main.log', 'auto enabled: ignore-certificate-errors for IP remote url');
          }
        } catch {
        }
      }
      if (ignoreCert) {
        app.commandLine.appendSwitch('ignore-certificate-errors');
        app.commandLine.appendSwitch('allow-insecure-localhost');
        appendAppLog('main.log', 'chrome switch enabled: ignore-certificate-errors');
      }
    }
  } catch {
  }
}

function appendAppLog(filename, message) {
  try {
    const p = path.join(app.getPath('userData'), filename);
    const line = `[${new Date().toISOString()}] ${String(message || '').trim()}\n`;
    fs.appendFileSync(p, line, { encoding: 'utf8' });
  } catch {
    return;
  }
}

function resolveWindowsBrowserBin() {
  const candidates = [];
  const pf = process.env.ProgramFiles;
  const pf86 = process.env['ProgramFiles(x86)'];
  const ld = process.env.LOCALAPPDATA;

  if (pf86) {
    candidates.push(path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    candidates.push(path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  if (pf) {
    candidates.push(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    candidates.push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }
  if (ld) {
    candidates.push(path.join(ld, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    candidates.push(path.join(ld, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  }

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      continue;
    }
  }
  return null;
}

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

function resolveRemoteUserAgent() {
  const envUa = process.env.BROWSER_AGENT_REMOTE_USER_AGENT || process.env.BROWSER_AGENT_USER_AGENT;
  if (envUa && String(envUa).trim()) return String(envUa).trim();
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
}

function resolveRemoteLoadRetries() {
  const raw = process.env.BROWSER_AGENT_REMOTE_LOAD_RETRIES;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return Math.min(Math.floor(n), 10);
  return 2;
}

async function probeRemoteConnectivity(remoteUrl) {
  try {
    if (!remoteUrl || typeof remoteUrl !== 'string') return;
    const u = new URL(remoteUrl);
    const host = u.hostname;
    appendAppLog('main.log', `remote probe start url=${remoteUrl} host=${host}`);

    try {
      if (dns && dns.promises && typeof dns.promises.lookup === 'function') {
        const addrs = await dns.promises.lookup(host, { all: true });
        const mapped = Array.isArray(addrs)
          ? addrs
              .map((a) => `${a && a.address ? a.address : 'unknown'}/${a && a.family ? a.family : 'unknown'}`)
              .join(',')
          : '';
        appendAppLog('main.log', `remote probe dns host=${host} addrs=${mapped}`);
      }
    } catch (err) {
      appendAppLog('main.log', `remote probe dns failed host=${host} err=${err && err.message ? err.message : String(err)}`);
    }

    try {
      const p = await session.defaultSession.resolveProxy(remoteUrl);
      appendAppLog('main.log', `remote probe resolveProxy url=${remoteUrl} proxy=${p}`);
    } catch (err) {
      appendAppLog(
        'main.log',
        `remote probe resolveProxy failed url=${remoteUrl} err=${err && err.message ? err.message : String(err)}`
      );
    }

    try {
      await new Promise((resolve) => {
        let done = false;
        const finish = (msg) => {
          if (done) return;
          done = true;
          appendAppLog('main.log', msg);
          resolve();
        };

        const timer = setTimeout(() => finish(`remote probe timeout url=${remoteUrl}`), 8000);
        const req = electronNet.request({ method: 'GET', url: remoteUrl });

        req.on('response', (res) => {
          try {
            const status = typeof res.statusCode === 'number' ? res.statusCode : -1;
            const loc = res.headers && res.headers.location ? String(res.headers.location) : '';
            appendAppLog('main.log', `remote probe response url=${remoteUrl} status=${status} location=${loc}`);
          } catch {
          }
          res.on('data', () => null);
          res.on('end', () => {
            clearTimeout(timer);
            finish(`remote probe response end url=${remoteUrl}`);
          });
          res.on('error', (err) => {
            clearTimeout(timer);
            finish(`remote probe response error url=${remoteUrl} err=${err && err.message ? err.message : String(err)}`);
          });
        });
        req.on('error', (err) => {
          clearTimeout(timer);
          finish(`remote probe request error url=${remoteUrl} err=${err && err.message ? err.message : String(err)}`);
        });

        try {
          req.end();
        } catch (err) {
          clearTimeout(timer);
          finish(`remote probe request end failed url=${remoteUrl} err=${err && err.message ? err.message : String(err)}`);
        }
      });
    } catch (err) {
      appendAppLog('main.log', `remote probe threw url=${remoteUrl} err=${err && err.stack ? err.stack : String(err)}`);
    }
  } catch {
  }
}

async function showRemoteLoadFailedPage(win, remoteUrl, errorDescription) {
  try {
    try {
      if (win && !win.isDestroyed()) win.show();
    } catch {
    }
    const safeUrl = String(remoteUrl || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const safeErr = String(errorDescription || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<!doctype html><html><head><meta charset="utf-8" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
      <title>Browser Agent</title></head>
      <body style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; padding: 24px;">
        <h2 style="margin:0 0 8px 0;">Remote UI 加载失败</h2>
        <div style="opacity:0.8; margin-bottom: 12px;">${safeErr || 'ERR_CONNECTION_CLOSED'}</div>
        <div style="margin-bottom: 16px; word-break: break-all;">${safeUrl}</div>
        <div style="opacity:0.8; margin-bottom: 16px;">你可以：</div>
        <ol style="line-height: 1.6;">
          <li>检查网络/代理/证书拦截（公司网络经常会断开 Electron 连接）</li>
          <li>点击右键复制链接，用系统浏览器打开验证可访问性</li>
          <li>设置环境变量 <code>BROWSER_AGENT_FORCE_LOCAL_UI=1</code> 强制使用本地 UI</li>
        </ol>
      </body></html>`;
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  } catch {
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
    const socket = new nodeNet.Socket();
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
  appendAppLog('main.log', 'ensurePythonWorker enter');
  try {
    const u = new URL(getWorkerBaseUrl());
    const host = u.hostname || '127.0.0.1';
    const port = Number(u.port || 8765);

    if (Number.isFinite(port) && (await checkTcpPort(host, port, 250))) {
      appendAppLog('main.log', 'ensurePythonWorker early return: port already open');
      return;
    }

    const scriptPath = resolveWorkerScriptPath();
    const pythonExec = resolveEmbeddedPythonExecutable() || resolveSystemPythonExecutable();
    appendAppLog('python-worker.log', `pythonExec: ${pythonExec}`);
    appendAppLog('python-worker.log', `scriptPath: ${scriptPath}`);

    const pythonProjectDir = isDev ? path.join(__dirname, '../python') : path.join(process.resourcesPath, 'python');
    const bundledSitePackagesDir = path.join(process.resourcesPath, 'python-site-packages');
    const existingPythonPath = typeof process.env.PYTHONPATH === 'string' ? process.env.PYTHONPATH : '';
    const pythonPathParts = [];
    if (!isDev) {
      pythonPathParts.push(bundledSitePackagesDir);
      if (process.platform === 'win32') {
        pythonPathParts.push(path.join(bundledSitePackagesDir, 'win32'));
        pythonPathParts.push(path.join(bundledSitePackagesDir, 'win32', 'lib'));
        pythonPathParts.push(path.join(bundledSitePackagesDir, 'pywin32_system32'));
      }
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

    if (!isDev && process.platform === 'win32') {
      const pywin32System32 = path.join(bundledSitePackagesDir, 'pywin32_system32');
      const existingPath = typeof process.env.PATH === 'string' ? process.env.PATH : '';
      childEnv.PATH = [pywin32System32, existingPath].filter(Boolean).join(path.delimiter);

      appendAppLog('python-worker.log', `PYTHONPATH: ${childEnv.PYTHONPATH || ''}`);
      appendAppLog('python-worker.log', `PATH: ${childEnv.PATH || ''}`);

      try {
        const win32LibDir = path.join(bundledSitePackagesDir, 'win32', 'lib');
        const hasWin32Lib = fs.existsSync(win32LibDir);
        const hasSystem32 = fs.existsSync(pywin32System32);
        appendAppLog('python-worker.log', `pywin32 win32/lib exists: ${hasWin32Lib}`);
        appendAppLog('python-worker.log', `pywin32_system32 exists: ${hasSystem32}`);
        if (hasWin32Lib) {
          const entries = fs.readdirSync(win32LibDir).slice(0, 50).join(',');
          appendAppLog('python-worker.log', `win32/lib entries: ${entries}`);
        }
        if (hasSystem32) {
          const entries = fs.readdirSync(pywin32System32).slice(0, 50).join(',');
          appendAppLog('python-worker.log', `pywin32_system32 entries: ${entries}`);
        }
      } catch (err) {
        appendAppLog('python-worker.log', `pywin32 probe failed: ${err && err.stack ? err.stack : String(err)}`);
      }
    }

    try {
      pythonWorkerProcess = spawn(pythonExec, [scriptPath], {
        env: childEnv,
        stdio: isDev ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      appendAppLog('python-worker.log', `spawn threw: ${err && err.stack ? err.stack : String(err)}`);
      return;
    }

    appendAppLog('python-worker.log', `spawn: ${pythonExec} ${scriptPath}`);
    if (!isDev) {
      if (pythonWorkerProcess.stdout) {
        pythonWorkerProcess.stdout.on('data', (buf) => appendAppLog('python-worker.log', `[stdout] ${buf}`));
      }
      if (pythonWorkerProcess.stderr) {
        pythonWorkerProcess.stderr.on('data', (buf) => appendAppLog('python-worker.log', `[stderr] ${buf}`));
      }
    }
    pythonWorkerProcess.once('error', (err) => {
      appendAppLog('python-worker.log', `spawn failed: ${err && err.stack ? err.stack : String(err)}`);
    });
    pythonWorkerProcess.once('exit', (code, signal) => {
      appendAppLog('python-worker.log', `exit: code=${code} signal=${signal}`);
    });

    const ready = await waitForPort(host, port, 15000);
    appendAppLog('main.log', `ensurePythonWorker waitForPort result: ${ready}`);
  } catch (err) {
    appendAppLog('main.log', `ensurePythonWorker threw: ${err && err.stack ? err.stack : String(err)}`);
  }
}

async function ensureXhsMcp() {
  if (ensureXhsMcpPromise) return ensureXhsMcpPromise;
  ensureXhsMcpPromise = (async () => {
  try {
    appendAppLog('main.log', `ensureXhsMcp enter host=127.0.0.1 port=18060 isDev=${isDev}`);

    const host = '127.0.0.1';
    const port = 18060;

    if (await checkTcpPort(host, port, 250)) {
      appendAppLog('main.log', 'ensureXhsMcp early return: port already open');
      return;
    }

    if (process.env.XHS_MCP_DISABLE === '1' || process.env.XIAOHONGSHU_MCP_DISABLE === '1') {
      appendAppLog('main.log', 'ensureXhsMcp early return: disabled by env');
      return;
    }

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
      appendAppLog('xhs-mcp.log', `exePath: ${exePath}`);

      try {
        if (!fs.existsSync(exePath)) {
          console.warn(`[xhs-mcp] executable not found: ${exePath}`);
          appendAppLog('xhs-mcp.log', `executable not found: ${exePath}`);
          return;
        }
      } catch {
        console.warn(`[xhs-mcp] executable not accessible: ${exePath}`);
        appendAppLog('xhs-mcp.log', `executable not accessible: ${exePath}`);
        return;
      }

      const childEnv = { ...process.env };

      if (process.platform === 'win32' && !childEnv.ROD_BROWSER_BIN) {
        const detected = resolveWindowsBrowserBin();
        if (detected) {
          childEnv.ROD_BROWSER_BIN = detected;
        }
      }

      if (childEnv.ROD_BROWSER_BIN) {
        appendAppLog('xhs-mcp.log', `ROD_BROWSER_BIN: ${childEnv.ROD_BROWSER_BIN}`);
      }

      if (process.platform === 'win32') {
        const forcedTemp = process.env.BROWSER_AGENT_XHS_TEMP_DIR;
        const programData = process.env.ProgramData || process.env.PROGRAMDATA || 'C:\\ProgramData';
        const defaultTemp = path.join(programData, 'browser-agent', 'xhs-tmp');
        const tempDir = forcedTemp && forcedTemp.trim() ? forcedTemp.trim() : defaultTemp;
        try {
          fs.mkdirSync(tempDir, { recursive: true });
          childEnv.TEMP = tempDir;
          childEnv.TMP = tempDir;
        } catch {
          try {
            const fallback = path.join(app.getPath('userData'), 'xhs-tmp');
            fs.mkdirSync(fallback, { recursive: true });
            childEnv.TEMP = fallback;
            childEnv.TMP = fallback;
          } catch {
            // ignore
          }
        }
      }

      if (childEnv.TEMP || childEnv.TMP) {
        appendAppLog('xhs-mcp.log', `TEMP: ${childEnv.TEMP || ''} TMP: ${childEnv.TMP || ''}`);
      }

      if (!childEnv.COOKIES_PATH) {
        try {
          const cookiePath = path.join(app.getPath('userData'), 'xhs-cookies.json');
          fs.mkdirSync(path.dirname(cookiePath), { recursive: true });
          childEnv.COOKIES_PATH = cookiePath;
        } catch {
          // ignore
        }
      }

      if (childEnv.COOKIES_PATH) {
        appendAppLog('xhs-mcp.log', `COOKIES_PATH: ${childEnv.COOKIES_PATH}`);
      }

      try {
        xhsMcpProcess = spawn(exePath, mcpArgs, {
          env: childEnv,
          cwd: app.getPath('userData'),
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (err) {
        appendAppLog('xhs-mcp.log', `spawn threw: ${err && err.stack ? err.stack : String(err)}`);
        return;
      }

      appendAppLog('xhs-mcp.log', `spawn: ${exePath} ${mcpArgs.join(' ')}`);
      if (xhsMcpProcess.stdout) {
        xhsMcpProcess.stdout.on('data', (buf) => appendAppLog('xhs-mcp.log', `[stdout] ${buf}`));
      }
      if (xhsMcpProcess.stderr) {
        xhsMcpProcess.stderr.on('data', (buf) => appendAppLog('xhs-mcp.log', `[stderr] ${buf}`));
      }
      xhsMcpProcess.once('error', (err) => {
        console.error('[xhs-mcp] spawn failed', err);
        appendAppLog('xhs-mcp.log', `spawn failed: ${err && err.stack ? err.stack : String(err)}`);
      });
      xhsMcpProcess.once('exit', (code, signal) => {
        appendAppLog('xhs-mcp.log', `exit: code=${code} signal=${signal}`);
      });
    }

    const ready = await waitForPort(host, port, 20000);
    appendAppLog('main.log', `ensureXhsMcp waitForPort result: ${ready}`);
  } catch (err) {
    appendAppLog('main.log', `ensureXhsMcp threw: ${err && err.stack ? err.stack : String(err)}`);
  }
  })().finally(() => {
    ensureXhsMcpPromise = null;
  });

  return ensureXhsMcpPromise;
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

function getAllowedHostSuffixes() {
  const suffixes = new Set();
  const remote = resolveRemoteAppUrl();
  if (remote) {
    try {
      const host = new URL(remote).hostname;
      if (host) {
        const parts = host.split('.').filter(Boolean);
        if (parts.length >= 2) {
          suffixes.add(parts.slice(-2).join('.'));
        }
      }
    } catch {
    }
  }

  const raw = process.env.BROWSER_AGENT_ALLOWED_HOST_SUFFIXES;
  if (raw && String(raw).trim()) {
    for (const item of String(raw).split(',')) {
      const v = item.trim();
      if (v) suffixes.add(v);
    }
  }

  return suffixes;
}

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const allowedOrigins = getAllowedOrigins();
    if (allowedOrigins.has(u.origin)) return true;

    const allowedSuffixes = getAllowedHostSuffixes();
    const hostname = (u.hostname || '').toLowerCase();
    for (const suffix of allowedSuffixes) {
      const s = String(suffix || '').toLowerCase();
      if (!s) continue;
      if (hostname === s || hostname.endsWith(`.${s}`)) return true;
    }
    return false;
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
  const remote = resolveRemoteAppUrl();
  if (!remote) return false;
  try {
    const host = new URL(remote).hostname;
    if (host && nodeNet.isIP(host) !== 0) return false;
  } catch {
  }
  return true;
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
  const authKey = `${appId}:${capability}`;
  const entry = activeAuthorizations && activeAuthorizations.get ? activeAuthorizations.get(authKey) : null;
  if (!entry || !entry.payload) {
    return { ok: false, error: 'Not authorized' };
  }
  if (Date.now() >= entry.expiresAtMs) {
    try {
      activeAuthorizations.delete(authKey);
    } catch {
      // ignore
    }
    return { ok: false, error: 'Authorization expired' };
  }
  const payload = entry.payload;
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
  const consentKey = consentKeyFromPayload(payload);
  if (!store[consentKey]) {
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
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const payload = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    let detail = '';
    try {
      if (payload && typeof payload === 'object') {
        detail = JSON.stringify(payload);
      } else if (typeof payload === 'string') {
        detail = payload;
      }
    } catch (_) {
      detail = '';
    }

    const errMsg = detail
      ? `Worker request failed (${res.status} ${res.statusText}): ${detail}`
      : `Worker request failed (${res.status} ${res.statusText})`;

    const err = new Error(errMsg);
    err.payload = payload;
    throw err;
  }

  return payload;
}

function normalizeDesktopAction(action) {
  const a = typeof action === 'string' ? action.trim() : '';
  if (!a) return null;
  const allowed = new Set(['status', 'config', 'tools', 'setup', 'execute', 'callTool', 'clearHistory', 'shutdown']);
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
    case 'callTool':
      return { method: 'POST', path: `${prefix}/call-tool`, body: payload || {} };
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
      allowRunningInsecureContent: Boolean(resolveRemoteAppUrl()),
    },
  });

  try {
    win.webContents.on('did-finish-load', () => {
      try {
        appendAppLog('main.log', `renderer did-finish-load url=${win.webContents.getURL()}`);
      } catch {
      }
    });
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      appendAppLog('main.log', `renderer console level=${level} ${sourceId || ''}:${line || ''} ${message}`);
    });
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      appendAppLog(
        'main.log',
        `renderer did-fail-load main=${Boolean(isMainFrame)} code=${errorCode} desc=${errorDescription} url=${validatedURL}`
      );

      try {
        const remote = resolveRemoteAppUrl();
        if (
          remote &&
          Boolean(isMainFrame) &&
          typeof validatedURL === 'string' &&
          validatedURL.startsWith(new URL(remote).origin)
        ) {
          if (win && !win.isDestroyed()) {
            try {
              win.show();
            } catch {
            }

            if (!win.__remoteFallbackShown) {
              const maxRetries = resolveRemoteLoadRetries();
              const tried = typeof win.__remoteRetryCount === 'number' ? win.__remoteRetryCount : 0;
              if (maxRetries > 0 && tried < maxRetries && !win.__remoteRetryTimer) {
                win.__remoteRetryCount = tried + 1;
                const delayMs = 600 * win.__remoteRetryCount;
                appendAppLog('main.log', `remote ui main-frame failed, retry ${win.__remoteRetryCount}/${maxRetries} in ${delayMs}ms`);
                win.__remoteRetryTimer = setTimeout(() => {
                  try {
                    win.__remoteRetryTimer = null;
                    if (win && !win.isDestroyed() && !win.__remoteFallbackShown) {
                      win.loadURL(remote).catch((e) => {
                        appendAppLog(
                          'main.log',
                          `remote ui retry loadURL rejected url=${remote} err=${e && e.message ? e.message : String(e)}`
                        );
                      });
                    }
                  } catch {
                  }
                }, delayMs);
                return;
              }

              win.__remoteFallbackShown = true;
              if (!isDev) {
                appendAppLog('main.log', 'remote ui failed, falling back to local dist ui');
                win.loadFile(path.join(__dirname, '../dist/index.html')).catch((err) => {
                  appendAppLog('main.log', `renderer loadFile fallback failed err=${err && err.stack ? err.stack : String(err)}`);
                  showRemoteLoadFailedPage(win, remote, `ERR ${errorCode} ${errorDescription}`);
                });
              } else {
                showRemoteLoadFailedPage(win, remote, `ERR ${errorCode} ${errorDescription}`);
              }
            }
          }
        }
      } catch {
      }
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      appendAppLog('main.log', `renderer process gone reason=${details && details.reason ? details.reason : 'unknown'} exitCode=${details && typeof details.exitCode === 'number' ? details.exitCode : 'unknown'}`);
    });
  } catch {
    // ignore
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  setTimeout(() => {
    try {
      if (win && !win.isDestroyed() && !win.isVisible()) {
        appendAppLog('main.log', 'renderer forced show after timeout');
        win.show();
      }
    } catch {
    }
  }, 1500);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) {
      return { action: 'allow' };
    }
    appendAppLog('main.log', `renderer window.open blocked url=${url}`);
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedUrl(url)) return;
    const isHttp = url.startsWith('http://') || url.startsWith('https://');
    if (!isHttp) return;
    appendAppLog('main.log', `renderer will-navigate blocked url=${url}`);
    event.preventDefault();
    shell.openExternal(url);
  });

  const remoteUrl = resolveRemoteAppUrl();
  if (remoteUrl) {
    appendAppLog('main.log', `ui mode=remote url=${remoteUrl}`);
    const ua = resolveRemoteUserAgent();
    appendAppLog('main.log', `ui mode=remote userAgent=${ua}`);
    try {
      win.webContents.setUserAgent(ua);
    } catch {
    }
    probeRemoteConnectivity(remoteUrl).catch(() => null);
    win.loadURL(remoteUrl).catch((err) => {
      appendAppLog('main.log', `renderer loadURL failed url=${remoteUrl} err=${err && err.stack ? err.stack : String(err)}`);
      try {
        if (!win.__remoteFallbackShown) {
          if (win.__remoteRetryTimer) {
            appendAppLog('main.log', 'remote ui loadURL rejected but retry is pending, skip fallback');
            return;
          }
          const maxRetries = resolveRemoteLoadRetries();
          const tried = typeof win.__remoteRetryCount === 'number' ? win.__remoteRetryCount : 0;
          if (maxRetries > 0 && tried < maxRetries && !win.__remoteRetryTimer) {
            win.__remoteRetryCount = tried + 1;
            const delayMs = 600 * win.__remoteRetryCount;
            appendAppLog('main.log', `remote ui loadURL rejected, retry ${win.__remoteRetryCount}/${maxRetries} in ${delayMs}ms`);
            win.__remoteRetryTimer = setTimeout(() => {
              try {
                win.__remoteRetryTimer = null;
                if (win && !win.isDestroyed() && !win.__remoteFallbackShown) {
                  win.loadURL(remoteUrl).catch((e) => {
                    appendAppLog(
                      'main.log',
                      `remote ui retry loadURL rejected url=${remoteUrl} err=${e && e.message ? e.message : String(e)}`
                    );
                  });
                }
              } catch {
              }
            }, delayMs);
            return;
          }

          win.__remoteFallbackShown = true;
          if (!isDev) {
            appendAppLog('main.log', 'remote ui loadURL rejected, falling back to local dist ui');
            win.loadFile(path.join(__dirname, '../dist/index.html')).catch((e2) => {
              appendAppLog('main.log', `renderer loadFile fallback failed err=${e2 && e2.stack ? e2.stack : String(e2)}`);
              showRemoteLoadFailedPage(win, remoteUrl, err && err.message ? err.message : String(err));
            });
          } else {
            showRemoteLoadFailedPage(win, remoteUrl, err && err.message ? err.message : String(err));
          }
        }
      } catch {
      }
    });
  } else if (isDev) {
    const devUrl = resolveDevServerUrl();
    appendAppLog('main.log', `ui mode=dev url=${devUrl}`);
    win.loadURL(devUrl).catch((err) => {
      appendAppLog('main.log', `renderer loadURL failed url=${devUrl} err=${err && err.stack ? err.stack : String(err)}`);
    });
  } else {
    appendAppLog('main.log', 'ui mode=local file=dist/index.html');
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  try {
    mainWindow = win;
  } catch {
  }

  return win;
}

app.whenReady().then(() => {
  appendAppLog('main.log', `app ready version=${app.getVersion()} isDev=${isDev} remote=${String(resolveRemoteAppUrl() || '')}`);
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

      try {
        const p = data.payload;
        const k = `${p.app_id}:${p.capability}`;
        activeAuthorizations.set(k, {
          payload: p,
          expiresAtMs: exp * 1000,
        });
      } catch {
        // ignore
      }

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

    appendAppLog('desktop-apps.log', `call enter app_id=${appId} capability=${capability} action=${action}`);

    if (action !== 'status' && action !== 'config') {
      const auth = checkAuthorization(appId, capability, action);
      if (!auth.ok) {
        appendAppLog('desktop-apps.log', `call denied app_id=${appId} capability=${capability} action=${action} error=${auth.error}`);
        return { success: false, error: auth.error };
      }
    } else {
      const auth = checkAuthorization(appId, capability, action);
      if (!auth.ok) {
        appendAppLog('desktop-apps.log', `call denied app_id=${appId} capability=${capability} action=${action} error=${auth.error}`);
        return action === 'status'
          ? { initialized: false, connected: false, error: auth.error }
          : { error: auth.error };
      }
    }

    const req = mapDesktopActionToRequest(appId, action, data);
    if (!req) {
      return { success: false, error: 'Unsupported action' };
    }

    const decorate = (resp) => {
      if (resp && typeof resp === 'object' && !Array.isArray(resp)) {
        return { ...resp, app_id: appId, capability, action };
      }
      return { app_id: appId, capability, action, data: resp };
    };

    try {
      const resp = await workerRequest(req.method, req.path, req.body);
      appendAppLog('desktop-apps.log', `call ok app_id=${appId} capability=${capability} action=${action}`);
      return decorate(resp);
    } catch (e) {
      const errMsg = String(e && e.message ? e.message : e);
      appendAppLog('desktop-apps.log', `call failed app_id=${appId} capability=${capability} action=${action} error=${errMsg}`);
      return decorate({ success: false, error: errMsg });
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
