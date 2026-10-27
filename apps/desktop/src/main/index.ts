import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';
import { api } from './api';
import { checkAccess, getLocation, importPaths, relocateFiles, resolveAsset, selectLocation } from './library';
import { scanLibrary, scanProgress, setProgressSink, startScheduledScans } from './indexer';
import { store } from './store';

let win: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;

app.setName('Mantis');
// Settings used to live under the old name. Copy them once so a rename does not sign the user out.
const legacySettings = path.join(app.getPath('appData'), 'Marketing Hub', 'settings.json');
const mantisSettings = path.join(app.getPath('userData'), 'settings.json');
if (fsSync.existsSync(legacySettings) && !fsSync.existsSync(mantisSettings)) {
  fsSync.mkdirSync(path.dirname(mantisSettings), { recursive: true });
  fsSync.copyFileSync(legacySettings, mantisSettings);
}

const PROTOCOL = 'marketinghub';

/** marketinghub://posts/abc -> /posts/abc */
function deepLinkToRoute(url: string): string | null {
  if (!url.startsWith(`${PROTOCOL}://`)) return null;
  return '/' + url.slice(`${PROTOCOL}://`.length).replace(/^\/+/, '');
}

function sendDeepLink(url: string) {
  const route = deepLinkToRoute(url);
  if (!route) return;
  if (win) {
    win.webContents.send('app:navigate', route);
    if (win.isMinimized()) win.restore();
    win.focus();
  } else {
    pendingDeepLink = route;
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    if (link) sendDeepLink(link);
    else if (win) win.focus();
  });
}

if (process.defaultApp && process.argv[1]) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Mantis',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  setProgressSink(win.webContents);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));

  win.on('closed', () => {
    win = null;
  });
}

function registerIpc() {
  // ---- Session ----
  ipcMain.handle('session:get', () => ({ serverUrl: store.get('serverUrl'), token: store.getToken() }));
  ipcMain.handle('session:set', (_e, s: { serverUrl?: string; token?: string | null }) => {
    if (s.serverUrl) store.set('serverUrl', s.serverUrl.replace(/\/+$/, ''));
    if (s.token !== undefined) store.setToken(s.token);
    if (s.token) startScheduledScans();
    return true;
  });
  ipcMain.handle('app:takeDeepLink', () => {
    const r = pendingDeepLink;
    pendingDeepLink = null;
    return r;
  });
  ipcMain.handle('app:version', () => app.getVersion());

  // ---- Library location (the "Select Library Location" button) ----
  ipcMain.handle('library:select', (_e, name?: string) => selectLocation(win, name));
  ipcMain.handle('library:getLocation', () => getLocation());
  ipcMain.handle('library:checkAccess', () => checkAccess());
  ipcMain.handle('library:import', (_e, kind: 'FOLDER' | 'FILE') => importPaths(win, kind));
  ipcMain.handle('library:relocate', (_e, folder: string, moves: { id: string; from: string; to: string }[]) => relocateFiles(folder, moves));

  // ---- Indexing & files ----
  ipcMain.handle('library:scan', (_e, force?: boolean) => scanLibrary({ force }));
  ipcMain.handle('library:scanProgress', () => scanProgress());
  ipcMain.handle('library:open', async (_e, relPath: string) => {
    const err = await shell.openPath(resolveAsset(relPath));
    if (err) throw new Error(err);
  });
  ipcMain.handle('library:reveal', (_e, relPath: string) => shell.showItemInFolder(resolveAsset(relPath)));
  /** Uploads the full file so it can be used in generated content. */
  ipcMain.handle('library:upload', async (_e, assetId: string, relPath: string) => {
    const abs = resolveAsset(relPath);
    const buf = await fs.readFile(abs);
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(buf)]), path.basename(abs));
    return api('POST', `/library/assets/${assetId}/upload`, form);
  });

  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (!/^https?:\/\//.test(url)) throw new Error('Only web links can be opened');
    return shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  const link = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (link) pendingDeepLink = deepLinkToRoute(link);
  if (store.getToken()) startScheduledScans();
  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
