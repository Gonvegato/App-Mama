// Aplicación de escritorio (Windows): abre la misma app web en una ventana propia.
const { app, BrowserWindow, protocol, net, shell, Menu, session, screen, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const WEB = path.join(__dirname, '..', 'web');
const SCHEME = 'app';
const ORIGIN = `${SCHEME}://cuaderno`;

// Los servicios de mapas y búsqueda (OpenStreetMap) piden identificar la aplicación.
function siteUrl() {
  try {
    const cfg = fs.readFileSync(path.join(WEB, 'config.js'), 'utf8');
    const m = /webUrl:\s*'([^']*)'/.exec(cfg);
    if (m && m[1]) return m[1];
  } catch { /* sin config */ }
  return 'https://github.com/';
}

// ---------- Modo USB ----------
// Si junto al programa hay un archivo «modo-usb.txt», todo (sesión, ajustes y copias de
// los archivos) se guarda en el propio USB y se puede llevar de un ordenador a otro.
const EXE_DIR = path.dirname(process.execPath);
const USB_ROOT = process.env.CUADERNO_USB || (fs.existsSync(path.join(EXE_DIR, 'modo-usb.txt')) ? path.resolve(EXE_DIR, '..') : null);
const USB_FILES = USB_ROOT ? path.join(USB_ROOT, 'Archivos de viajes') : null;
if (USB_ROOT) {
  app.setPath('userData', path.join(USB_ROOT, 'Cuaderno de viajes', 'Datos'));
}

// Ruta segura dentro de la carpeta de archivos del USB (nunca fuera de ella).
function usbPath(rel) {
  if (!USB_FILES || typeof rel !== 'string' || !rel) throw new Error('Ruta no válida');
  const full = path.normalize(path.join(USB_FILES, rel));
  if (!full.startsWith(USB_FILES + path.sep)) throw new Error('Ruta no válida');
  return full;
}

function setupUsbIpc() {
  ipcMain.handle('usb:info', async () => {
    if (!USB_ROOT) return { enabled: false };
    let free = null, total = null;
    try { const st = fs.statfsSync(USB_ROOT); free = st.bavail * st.bsize; total = st.blocks * st.bsize; } catch { /* sin datos */ }
    return { enabled: true, free, total, folder: USB_FILES };
  });
  ipcMain.handle('usb:write', async (_e, rel, data) => {
    const full = usbPath(rel);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.parcial`;
    await fs.promises.writeFile(tmp, Buffer.from(data));
    await fs.promises.rename(tmp, full);
    return true;
  });
  ipcMain.handle('usb:stat', async (_e, rel) => {
    try { const st = await fs.promises.stat(usbPath(rel)); return st.isFile() ? st.size : null; } catch { return null; }
  });
  ipcMain.handle('usb:move', async (_e, from, to) => {
    try {
      const a = usbPath(from), b = usbPath(to);
      await fs.promises.mkdir(path.dirname(b), { recursive: true });
      await fs.promises.rename(a, b);
      const dir = path.dirname(a);
      if (dir !== USB_FILES && (await fs.promises.readdir(dir)).length === 0) await fs.promises.rmdir(dir);
      return true;
    } catch { return false; }
  });
  ipcMain.handle('usb:remove', async (_e, rel) => {
    try {
      const full = usbPath(rel);
      await fs.promises.rm(full, { force: true });
      // Quita la carpeta del viaje si se ha quedado vacía.
      const dir = path.dirname(full);
      if (dir !== USB_FILES && (await fs.promises.readdir(dir)).length === 0) await fs.promises.rmdir(dir);
    } catch { /* ya no estaba */ }
    return true;
  });
  ipcMain.handle('usb:index:get', async () => {
    try { return JSON.parse(await fs.promises.readFile(path.join(app.getPath('userData'), 'indice-archivos.json'), 'utf8')); } catch { return {}; }
  });
  ipcMain.handle('usb:index:set', async (_e, idx) => {
    const file = path.join(app.getPath('userData'), 'indice-archivos.json');
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(`${file}.parcial`, JSON.stringify(idx));
    await fs.promises.rename(`${file}.parcial`, file);
    return true;
  });
  ipcMain.handle('usb:open', async (_e, rel) => {
    if (!USB_FILES) return false;
    await fs.promises.mkdir(USB_FILES, { recursive: true });
    if (rel) { try { shell.showItemInFolder(usbPath(rel)); return true; } catch { /* abre la carpeta */ } }
    await shell.openPath(USB_FILES);
    return true;
  });
}

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

const stateFile = () => path.join(app.getPath('userData'), 'ventana.json');
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const visible = screen.getAllDisplays().some(d => {
      const a = d.workArea;
      return b.x >= a.x - 50 && b.y >= a.y - 50 && b.x < a.x + a.width && b.y < a.y + a.height;
    });
    return visible ? b : null;
  } catch { return null; }
}
function saveBounds(win) {
  try {
    const b = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch { /* nada */ }
}

let win;
function createWindow() {
  const b = loadBounds();
  win = new BrowserWindow({
    width: b?.width || 1360,
    height: b?.height || 880,
    x: b?.x, y: b?.y,
    minWidth: 820,
    minHeight: 560,
    title: 'Cuaderno de viajes',
    backgroundColor: '#f6f2ea',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      plugins: true, // visor de PDF integrado
    },
  });
  if (b?.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', () => saveBounds(win));
  // La app guarda los cambios pendientes antes de cerrar y los sube al volver a abrirla.
  win.webContents.on('will-prevent-unload', e => e.preventDefault());

  // Enlaces externos: en el navegador normal. Archivos (blob:) en una ventana aparte.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('blob:') || url.startsWith(ORIGIN)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { plugins: true, sandbox: true } } };
    }
    if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });

  win.loadURL(`${ORIGIN}/index.html`);
}

function buildMenu() {
  const template = [
    { label: 'Archivo', submenu: [{ role: 'quit', label: 'Salir' }] },
    { label: 'Editar', submenu: [
      { role: 'undo', label: 'Deshacer' }, { role: 'redo', label: 'Rehacer' }, { type: 'separator' },
      { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' },
    ] },
    { label: 'Ver', submenu: [
      { role: 'reload', label: 'Recargar' },
      { role: 'zoomIn', label: 'Letra más grande' }, { role: 'zoomOut', label: 'Letra más pequeña' }, { role: 'resetZoom', label: 'Tamaño normal' },
      { type: 'separator' }, { role: 'togglefullscreen', label: 'Pantalla completa' },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(() => {
  protocol.handle(SCHEME, req => {
    const { pathname } = new URL(req.url);
    // Archivos copiados en el USB: app://cuaderno/__usb/<ruta>
    if (pathname.startsWith('/__usb/')) {
      try { return net.fetch(pathToFileURL(usbPath(decodeURIComponent(pathname.slice(7)))).toString()); }
      catch { return new Response('No encontrado', { status: 404 }); }
    }
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(WEB)) return new Response('No permitido', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const referer = siteUrl();
  const ses = session.defaultSession;
  const isPcloud = u => /^https:\/\/([a-z0-9-]+\.)*pcloud\.(com|link)\//i.test(u);
  // Cabeceras de salida: identificación para OpenStreetMap; pCloud solo atiende si la petición «viene» de su web.
  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, cb) => {
    const h = details.requestHeaders;
    if (/^https:\/\/([a-z0-9-]+\.)*openstreetmap\.org\/|^https:\/\/photon\.komoot\.io\//i.test(details.url)) {
      h['Referer'] = referer;
      h['User-Agent'] = `CuadernoDeViajes/${app.getVersion()} (${referer})`;
    } else if (isPcloud(details.url)) {
      h['Referer'] = 'https://my.pcloud.com/';
      h['Origin'] = 'https://my.pcloud.com';
    }
    cb({ requestHeaders: h });
  });
  // Cabeceras de entrada: para que los enlaces guardados se vean siempre dentro del programa.
  const drop = (headers, name) => { for (const k of Object.keys(headers)) if (k.toLowerCase() === name) delete headers[k]; };
  const has = (headers, name) => Object.keys(headers).some(k => k.toLowerCase() === name);
  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, cb) => {
    const h = details.responseHeaders || {};
    if (details.resourceType === 'subFrame') {
      // Webs que prohíben mostrarse dentro de otra página.
      drop(h, 'x-frame-options');
      for (const k of Object.keys(h)) {
        if (k.toLowerCase() === 'content-security-policy') {
          h[k] = h[k].map(v => v.split(';').filter(d => !/^\s*frame-ancestors/i.test(d)).join(';'));
        }
      }
    }
    if ((details.resourceType === 'xhr' && /^app:\/\/cuaderno/.test(details.referrer || '')) || isPcloud(details.url)) {
      // Descargas que pide la propia app (PDF y fotos de enlaces guardados).
      if (isPcloud(details.url)) { drop(h, 'access-control-allow-origin'); h['Access-Control-Allow-Origin'] = ['*']; }
      else if (!has(h, 'access-control-allow-origin')) h['Access-Control-Allow-Origin'] = ['*'];
    }
    cb({ responseHeaders: h });
  });
  ses.setSpellCheckerLanguages(['es-ES']);
  // Solo se conceden los permisos que usa la app (ubicación en el mapa y portapapeles).
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['geolocation', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });

  setupUsbIpc();
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
