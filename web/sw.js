// Service worker: la app abre sin conexión y guarda los trozos de mapa ya vistos.
const VERSION = 'cv-1.0.0';
const SHELL = `shell-${VERSION}`;
const TILES = 'mapa-v2';
const MAX_TILES = 2500;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(['./', './index.html', './css/app.css', './config.js', './manifest.webmanifest',
      './vendor/preact-htm.js', './vendor/supabase.js', './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css', './vendor/jszip.min.js', './vendor/qrcode.mjs',
      './vendor/maplibre/maplibre-gl.js', './vendor/maplibre/maplibre-gl.css', './vendor/maplibre/leaflet-maplibre-gl.js',
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

  // Mapa (OpenFreeMap): lo ya visto se guarda para verlo sin conexión.
  // Los de OpenStreetMap no se guardan: sus normas no permiten el uso sin conexión.
  if (url.hostname === 'tiles.openfreemap.org') {
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      // El estilo puede cambiar: primero la red y, sin conexión, la copia.
      if (url.pathname.startsWith('/styles/')) {
        try { const res = await fetch(req); if (res.ok) c.put(req, res.clone()); return res; }
        catch { return (await c.match(req)) || Response.error(); }
      }
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
