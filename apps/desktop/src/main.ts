/** The Electron main process: one window around the app in apps/web, served from its own `app://centcom` address with the same policy as the hosted pages. */
import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROTOCOL, linkFromArgv } from './links.js';
import { APP_ORIGIN, APP_SCHEME, WEB_PREFERENCES, appUrlToFile, isAppUrl, isSafeExternal, permissionAllowed, responseHeaders } from './security.js';

const WEB_ROOT = app.isPackaged ? join(process.resourcesPath, 'web') : join(__dirname, '../../web/dist');
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
let win: BrowserWindow | undefined; let pending: string | undefined; let ready = false;
const send = (raw: string): void => { if (win && ready) { win.webContents.send('centcom:link', raw); if (win.isMinimized()) win.restore(); win.focus(); } else pending = raw; };
function createWindow(): void {
  win = new BrowserWindow({ width: 1280, height: 820, minWidth: 420, minHeight: 520, title: 'Centcom', backgroundColor: '#0A0A0C', show: false, webPreferences: { ...WEB_PREFERENCES, preload: join(__dirname, 'preload.cjs') } });
  const smoke = process.env.CENTCOM_SMOKE === '1'; /* a check that loads the page without showing a window, prints what it found and quits */
  win.once('ready-to-show', () => { if (!smoke) win?.show(); });
  if (smoke) { win.webContents.on('did-fail-load', (_e, code, desc) => { console.log(JSON.stringify({ ok: false, code, desc })); app.exit(1); }); win.webContents.on('did-finish-load', () => { void win?.webContents.executeJavaScript(`JSON.stringify({ href: location.href, title: document.title, bridge: typeof window.centcom === 'object' && window.centcom.desktop === true, root: !!document.getElementById('root') && document.getElementById('root').childElementCount > 0, node: typeof require === 'undefined' && typeof process === 'undefined' })`).then((r: string) => { console.log(JSON.stringify({ ok: true, ...JSON.parse(r) })); app.exit(0); }); }); setTimeout(() => { console.log(JSON.stringify({ ok: false, desc: 'timeout' })); app.exit(2); }, 20_000); }
  win.webContents.setWindowOpenHandler(({ url }) => { if (isSafeExternal(url)) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!isAppUrl(url)) { e.preventDefault(); if (isSafeExternal(url)) void shell.openExternal(url); } });
  win.on('closed', () => { win = undefined; ready = false; }); void win.loadURL(`${APP_ORIGIN}/`);
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', (_e, argv) => { const l = linkFromArgv(argv); if (l) send(l.raw); else if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('open-url', (e, url) => { e.preventDefault(); const l = linkFromArgv([url]); if (l) send(l.raw); }); /* macOS */
  void app.whenReady().then(() => {
    if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [process.argv[1]]); else app.setAsDefaultProtocolClient(PROTOCOL);
    protocol.handle(APP_SCHEME, async (req) => { const file = appUrlToFile(req.url, WEB_ROOT); if (!file || !existsSync(file)) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } }); const r = await net.fetch(pathToFileURL(file).toString()); return new Response(r.body, { status: 200, headers: responseHeaders(file) }); });
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permissionAllowed(permission, wc.getURL())));
    session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => permissionAllowed(permission, origin));
    ipcMain.handle('centcom:open-external', (_e, url: unknown) => { if (typeof url === 'string' && isSafeExternal(url)) { void shell.openExternal(url); return true; } return false; });
    ipcMain.handle('centcom:ready', () => { ready = true; if (pending) { const p = pending; pending = undefined; send(p); } });
    const first = linkFromArgv(process.argv); if (first) pending = first.raw; createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
