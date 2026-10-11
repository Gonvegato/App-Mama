// Service worker: la app abre sin conexión y guarda los trozos de mapa ya vistos.
const VERSION = 'cv-1.0.0';
const SHELL = `shell-${VERSION}`;
const TILES = 'tiles-v1';
const MAX_TILES = 1500;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(['./', './index.html', './css/app.css', './config.js', './manifest.webmanifest',
      './vendor/preact-htm.js', './vendor/supabase.js', './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css', './vendor/jszip.min.js', './vendor/qrcode.mjs',
      './fonts/newsreader-latin-opsz-normal.woff2', './fonts/newsreader-latin-opsz-italic.woff2', './fonts/newsreader-latin-ext-opsz-normal.woff2',
      './icons/icon-192.png', './icons/icon.svg', './data/airports.json']);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== TILES) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  if (keys.length > MAX_TILES) for (const k of keys.slice(0, keys.length - MAX_TILES)) await c.delete(k);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Trozos de mapa: primero la caché, luego la red (y se guardan).
  if (/basemaps\.cartocdn\.com|tile\.openstreetmap\.org/.test(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trimTiles(); }
        return res;
      } catch { return hit || Response.error(); }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Configuración: siempre la más reciente si hay red.
  // Archivos de la app: red primero (para recibir mejoras) y si no hay conexión, la caché.
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    try {
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    } catch {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await c.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
