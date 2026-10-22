import { app, BrowserWindow, Menu, ipcMain, protocol, net, dialog, shell } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, basename, extname } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createMonitor } from '../monitor.mjs';
import { resolveAdb } from './adb.mjs';
import { createApkInstaller } from './apk-installer.mjs';

const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
app.setName('BKDeviceMonitor');
protocol.registerSchemesAsPrivileged([{ scheme: 'bkdevicemonitor', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window, monitor, installer;
let choosingApk = false;
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });

function trusted(event) {
  if (event.sender !== window?.webContents || event.senderFrame !== window?.webContents.mainFrame || !event.senderFrame.url.startsWith('bkdevicemonitor://app/')) throw new Error('Untrusted sender');
}
function createWindow() {
  window = new BrowserWindow({
    title: 'BKDeviceMonitor · 手机性能监测', width: 1500, height: 1000, minWidth: 900, minHeight: 650,
    backgroundColor: '#1c1c1c', show: false, autoHideMenuBar: true,
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 25 }
    } : {}),
    webPreferences: { preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false }
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('bkdevicemonitor://app/')) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try { const link = new URL(url); if (link.protocol === 'https:' && /(^|\.)(mi\.com|qualcomm\.com)$/.test(link.hostname)) void shell.openExternal(url); } catch {}
    return { action: 'deny' };
  });
  window.on('closed', () => { window = null; });
  void window.loadURL('bkdevicemonitor://app/');
}

if (ownsInstance) app.whenReady().then(async () => {
  protocol.handle('bkdevicemonitor', async request => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'app' || request.method !== 'GET') return new Response('Not found', { status: 404 });
      const path = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
      if (path.split('/').some(part => part === '..') || path.includes('\\') || path.includes('\0')) return new Response('Not found', { status: 404 });
      const response = await net.fetch(pathToFileURL(join(publicRoot, path)).href);
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'");
      headers.set('X-Content-Type-Options', 'nosniff');
      headers.set('Cache-Control', 'no-store');
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  const adbPath = await resolveAdb({ resourcesPath: process.resourcesPath });
  monitor = createMonitor({ adbPath });
  installer = createApkInstaller({
    adbPath,
    getDevices: async () => (await monitor.request('/api/devices')).data.devices,
    onChange: state => { if (window && !window.isDestroyed()) window.webContents.send('bkdm:event', 'apk-install', state); }
  });
  ipcMain.handle('bkdm:apk', async (event, input) => {
    trusted(event);
    try {
      if (!input || typeof input !== 'object') throw new Error('无效的 APK 操作。');
      if (input.action === 'state') return { state: installer.state() };
      if (input.action === 'install') return { state: await installer.install({ fileId: input.fileId, serial: input.serial }) };
      if (input.action !== 'choose') throw new Error('无效的 APK 操作。');
      if (choosingApk || ['checking', 'installing'].includes(installer.state().phase)) throw new Error('请等待当前选择或安装完成。');
      choosingApk = true;
      try {
        const result = await dialog.showOpenDialog(window, { title: '选择要安装的 APK', properties: ['openFile'], filters: [{ name: 'Android 安装包', extensions: ['apk'] }] });
        if (result.canceled || !result.filePaths.length) return { canceled: true, state: installer.state() };
        return { state: await installer.select(result.filePaths[0]) };
      } finally { choosingApk = false; }
    } catch (error) { return { error: error.message }; }
  });
  monitor.subscribe((name, data) => { if (window && !window.isDestroyed()) window.webContents.send('bkdm:event', name, data); });
  ipcMain.handle('bkdm:request', (event, path, method) => { trusted(event); return monitor.request(path, method); });
  ipcMain.handle('bkdm:save', async (event, file) => {
    trusted(event);
    if (!file || typeof file.filename !== 'string' || file.filename.length > 180 || basename(file.filename) !== file.filename || /[\\/:\0]/.test(file.filename) || !['.json', '.csv'].includes(extname(file.filename)) || typeof file.content !== 'string' || Buffer.byteLength(file.content) > 64 * 1024 * 1024) throw new Error('无效的导出文件');
    const { canceled, filePath } = await dialog.showSaveDialog(window, { title: '导出监测数据', defaultPath: join(app.getPath('documents'), file.filename), filters: [{ name: extname(file.filename) === '.csv' ? 'CSV 表格' : 'JSON 报告', extensions: [extname(file.filename).slice(1)] }] });
    if (canceled || !filePath) return { saved: false };
    await writeFile(filePath, file.content, 'utf8'); return { saved: true };
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'BKDeviceMonitor', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '显示', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'close' }] }
  ]));
  createWindow(); void monitor.start();
  app.on('activate', () => { if (!window) createWindow(); });
}).catch(error => { dialog.showErrorBox('BKDeviceMonitor 启动失败', error.message); app.quit(); });

// Closing the last window exits on both platforms, stopping all owned samplers.
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { installer?.stop(); monitor?.stop(); });
