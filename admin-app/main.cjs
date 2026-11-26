const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const { createCommercialStore } = require('./commercial-store.cjs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const issuer = require('./license-admin.cjs');
const page = path.join(__dirname, 'index.html');
const pageURL = pathToFileURL(page).href;
app.setName('GULF POS Administration Center');
app.setPath('userData', path.join(app.getPath('appData'), 'GULF POS Administration Center'));
let win;
function authorized(event) {
  if (!win || win.isDestroyed() || event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== pageURL) {
    throw new Error('Unauthorized administration request');
  }
}
function safe(handler) {
  return (event, ...args) => {
    authorized(event);
    try { return { ok: true, data: handler(...args) }; }
    catch (error) { return { ok: false, error: String(error.message || 'Operation failed').slice(0, 500) }; }
  };
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    win = new BrowserWindow({
      title: 'GULF POS Administration Center',
      width: 1280, height: 850, minWidth: 780, minHeight: 620,
      backgroundColor: '#071b35',
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, webSecurity: true, devTools: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const commercial = createCommercialStore(path.join(app.getPath('userData'), 'commercial-registry.enc'), safeStorage);
    ipcMain.handle('gulf-admin:commercial-list', safe(() => commercial.read()));
    ipcMain.handle('gulf-admin:commercial-record', safe(input => commercial.record(input)));
    ipcMain.handle('gulf-admin:status', safe(() => ({
      ...issuer.issuerStatus(), configured: Boolean(process.env.GULF_LICENSE_KEYS_DIR)
    })));
    ipcMain.handle('gulf-admin:list', safe(() => issuer.listLicenses()));
    ipcMain.handle('gulf-admin:issue', safe(input => {
      if (!process.env.GULF_LICENSE_KEYS_DIR) throw new Error('Configure the restricted issuer directory before issuing');
      return issuer.issueFromForm(input);
    }));
    win.loadFile(page);
    win.on('closed', () => { win = undefined; });
  });
}
app.on('window-all-closed', () => app.quit());
