const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');

const isDev = !app.isPackaged;

function resolveDevServerUrl() {
  const envUrl = process.env.VITE_DEV_SERVER_URL;
  if (envUrl && envUrl.trim()) return envUrl;
  return 'http://localhost:1420';
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
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const isHttp = url.startsWith('http://') || url.startsWith('https://');
    if (!isHttp) return;

    const devUrl = resolveDevServerUrl();
    if (isDev && url.startsWith(devUrl)) return;

    event.preventDefault();
    shell.openExternal(url);
  });

  if (isDev) {
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
