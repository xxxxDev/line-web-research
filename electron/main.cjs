const { app, BrowserWindow, session, ipcMain, Notification, shell, Menu, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { createDownloadHost } = require('./download-host.cjs');

const ID = 'ophjlpahpchlmihnnnihgmmeilfjmjjc';
const ORIGIN = `chrome-extension://${ID}`;
const unreadSmoke = process.argv.includes('--unread-smoke');
let receiptAttempts = 0;
const downloadSmoke = process.argv.includes('--download-smoke');
const smoke = process.argv.includes('--smoke') || downloadSmoke || unreadSmoke;
const smokeRoot = process.env.LINE_SMOKE_ROOT || path.join(app.getPath('temp'), 'line-electron-prototype-smoke');
app.setName('LINE');
if (smoke) { fs.mkdirSync(smokeRoot, { recursive: true }); app.setPath('userData', path.join(smokeRoot, 'profile')); }
else app.setPath('userData', path.join(app.getPath('appData'), 'LINE Electron Prototype'));
const notices = new Map();
let mainWindow;
let externalPromptPending = false;

function trustedURL(raw) {
  try { const u = new URL(raw); return u.protocol === 'chrome-extension:' && u.hostname === ID && ['/index.html', '/popup.html'].includes(u.pathname); }
  catch { return false; }
}
function authorize(event) {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || !trustedURL(event.senderFrame.url)) throw new Error('Untrusted renderer');
}
function windowInfo(w) { return { id: w.id, focused: w.isFocused(), ...w.getBounds() }; }
async function external(raw) {
  if (externalPromptPending) return;
  externalPromptPending = true;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return;
    const { response } = await dialog.showMessageBox({ type: 'question', message: `Open ${url.host} in your default browser?`, detail: url.href.slice(0, 2000), buttons: ['Cancel', 'Open'], defaultId: 0, cancelId: 0 });
    if (response === 1) await shell.openExternal(url.href);
  } catch { /* A rejected URL or browser launch leaves the LINE window intact. */ }
  finally { externalPromptPending = false; }
}
function configure(w) {
  w.webContents.on('will-navigate', (e, url) => { if (!trustedURL(url)) { e.preventDefault(); external(url); } });
  w.webContents.on('will-redirect', (e, url) => { if (!trustedURL(url)) e.preventDefault(); });
  w.webContents.on('will-prevent-unload', e => {
    if (dialog.showMessageBoxSync(w, { type: 'question', message: 'Close the LINE window?', buttons: ['Cancel', 'Close'], defaultId: 0, cancelId: 0 }) === 1) e.preventDefault();
  });
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (trustedURL(url)) return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: preferences() } };
    external(url); return { action: 'deny' };
  });
  w.webContents.on('did-create-window', child => configure(child));
}
function preferences() {
  return { partition: 'persist:line', preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true };
}
function registerBridge(ses) {
  const downloads = createDownloadHost({ session: ses, origin: ORIGIN, trustedURL, downloadsPath: app.getPath('downloads'), reveal: file => shell.showItemInFolder(file) });
  ipcMain.handle('line-host', async (event, method, data = {}) => {
    authorize(event);
    const w = BrowserWindow.fromWebContents(event.sender);
    switch (method) {
      case 'download': return downloads.start(event.sender, data);
      case 'showDownload': return downloads.show(event.sender, data.id);
      case 'zoom': return event.sender.getZoomFactor();
      case 'currentWindow': return windowInfo(w);
      case 'allWindows': return BrowserWindow.getAllWindows().filter(x => trustedURL(x.webContents.getURL())).map(windowInfo);
      case 'focus': {
        const target = BrowserWindow.fromId(data.id);
        if (!target || !trustedURL(target.webContents.getURL())) throw new Error('Unknown window');
        target.show(); target.focus(); return windowInfo(target);
      }
      case 'badge': app.dock?.setBadge(String(data.text ?? '').slice(0, 12)); return;
      case 'notify': {
        const id = String(data.id).slice(0, 200);
        notices.get(id)?.close();
        const n = new Notification({ title: String(data.title ?? 'LINE').slice(0, 200), body: String(data.message ?? '').slice(0, 2000), silent: !!data.silent });
        const send = name => { if (!event.sender.isDestroyed()) event.sender.send('line-notification', { name, id }); };
        n.on('click', () => { if (!w.isDestroyed()) { w.show(); w.focus(); } send('clicked'); });
        n.on('close', () => { if (notices.get(id) === n) { notices.delete(id); send('closed'); } });
        notices.set(id, n); n.show(); return id;
      }
      case 'clearNotification': { const n = notices.get(String(data.id)); n?.close(); notices.delete(String(data.id)); return !!n; }
      case 'removeLoginCookie': {
        const u = new URL(data.url);
        if (u.origin !== 'https://line-chrome-gw.line-apps.com' || data.name !== 'lct') throw new Error('Cookie target not allowed');
        await ses.cookies.remove(u.href, 'lct'); return { url: u.href, name: 'lct' };
      }
      default: throw new Error('Unsupported operation');
    }
  });
}
async function createWindow() {
  const w = new BrowserWindow({ title: 'LINE', width: 900, height: 680, minWidth: 600, minHeight: 500, backgroundColor: '#141d29', webPreferences: preferences() });
  mainWindow = w; configure(w);
  w.on('closed', () => { if (mainWindow === w) mainWindow = null; });
  await w.loadURL(`${ORIGIN}/index.html`);
  return w;
}

app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:line');
  const lineDomain = host => ['line.me', 'line-apps.com', 'line-scdn.net'].some(root => host === root || host.endsWith('.' + root));
  ses.webRequest.onBeforeRequest((details, callback) => {
    const u = new URL(details.url);
    if (unreadSmoke && u.pathname.endsWith('/api/talk/thrift/Talk/TalkService/sendChatChecked')) {
      receiptAttempts++; callback({ cancel: true }); return;
    }
    callback({ cancel: ['http:', 'https:', 'ws:', 'wss:'].includes(u.protocol) && (!['https:', 'wss:'].includes(u.protocol) || !lineDomain(u.hostname)) });
  });
  ses.setPermissionRequestHandler((wc, permission, callback, details) => callback(permission === 'notifications' && trustedURL(wc.getURL()) && details.isMainFrame === true));
  ses.setPermissionCheckHandler((wc, permission, origin, details) => permission === 'notifications' && !!wc && trustedURL(wc.getURL()) && details.isMainFrame === true);
  registerBridge(ses);
  const extension = await ses.extensions.loadExtension(path.join(__dirname, 'extension'));
  if (extension.id !== ID) throw new Error('Unexpected extension identity');
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }
  ]));
  const w = await createWindow();
  if (unreadSmoke) {
    try {
      await new Promise(resolve => setTimeout(resolve, 12000));
      await require('./tests/theme-smoke.cjs')({ window: w, root: smokeRoot });
      await require('./tests/unread-smoke.cjs')({ window: w, root: smokeRoot, attempts: () => receiptAttempts });
    } catch (error) { console.error(error); process.exitCode = 1; }
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    app.exit(process.exitCode || 0); return;
  }
  if (downloadSmoke) {
    try {
      await require('./tests/download-smoke.cjs')({ window: w, session: ses, root: smokeRoot });
    } catch (error) { console.error(error); process.exitCode = 1; }
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    app.exit(process.exitCode || 0);
    return;
  }
  if (smoke) {
    setTimeout(async () => {
      try {
        const evidence = path.join(smokeRoot, 'evidence'); fs.mkdirSync(evidence, { recursive: true });
        const result = await w.webContents.executeJavaScript(`({loginForm:!!document.querySelector('input[type=password]'),inputs:[...document.querySelectorAll('input')].map(x=>({type:x.type})),nodeExposed:typeof require!=='undefined',bridge:typeof lineHost,downloadsAPI:typeof chrome.downloads?.download})`);
        result.appName = app.getName();
        result.checks = await w.webContents.executeJavaScript(`(async()=>{
          const previous = (await chrome.storage.local.get('prototypeSmoke')).prototypeSmoke;
          await chrome.storage.local.set({prototypeSmoke:'persisted'});
          const current = await chrome.windows.getCurrent();
          const zoom = await chrome.tabs.getZoom();
          const blocked = async (method,data) => {try{await lineHost.invoke(method,data);return false}catch{return true}};
          return {previousStorageValue:previous || null,windowId:current.id,zoom,invalidOperationBlocked:await blocked('arbitraryOperation',{}),foreignCookieBlocked:await blocked('removeLoginCookie',{url:'https://example.com',name:'lct'})};
        })()`);
        if (result.nodeExposed || result.bridge !== 'object' || !result.inputs.some(x => x.type === 'password') || !result.checks.invalidOperationBlocked || !result.checks.foreignCookieBlocked) throw new Error('Smoke assertion failed');
        fs.writeFileSync(path.join(evidence, 'smoke.json'), JSON.stringify(result, null, 2));
        console.log('SMOKE', JSON.stringify(result));
      } catch (e) { console.error(e); process.exitCode = 1; }
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
      app.exit(process.exitCode || 0);
    }, 12000);
  }
}).catch(e => { console.error(e); app.exit(1); });
app.on('activate', () => { if (!mainWindow && app.isReady()) void createWindow(); else mainWindow?.show(); });
app.on('window-all-closed', () => app.quit());
