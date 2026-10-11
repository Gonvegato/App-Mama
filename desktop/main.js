// Aplicación de escritorio (Windows): abre la misma app web en una ventana propia.
const { app, BrowserWindow, protocol, net, shell, Menu, session, screen } = require('electron');
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
      { type: 'separator' }, { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
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
    const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(WEB, rel));
    if (!file.startsWith(WEB)) return new Response('No permitido', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const referer = siteUrl();
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['https://*.openstreetmap.org/*', 'https://photon.komoot.io/*', 'https://*.basemaps.cartocdn.com/*'] },
    (details, cb) => {
      details.requestHeaders['Referer'] = referer;
      details.requestHeaders['User-Agent'] = `CuadernoDeViajes/${app.getVersion()} (${referer})`;
      cb({ requestHeaders: details.requestHeaders });
    },
  );
  session.defaultSession.setSpellCheckerLanguages(['es-ES']);
  // Solo se conceden los permisos que usa la app (ubicación en el mapa y portapapeles).
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['geolocation', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });

  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
