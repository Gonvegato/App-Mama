// Cálculo de qué trozos de mapa (teselas) hacen falta para ver sin conexión la zona de un viaje.
// Sin dependencias: se puede probar con node. Las coordenadas de tesela son las de OpenStreetMap/OpenMapTiles.

export const MIN_ZOOM = 6;
export const MAX_ZOOM = 14;      // el máximo de las teselas vectoriales de OpenFreeMap

// Posición fraccionaria de un punto en la cuadrícula de teselas de un zoom.
export function tileCoords(lat, lng, z) {
  const n = 2 ** z;
  const la = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
  return { x: (lng + 180) / 360 * n, y: (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n };
}

// Alrededor de cada punto se añade 1 tesela de margen en los zooms de detalle, para poder moverse un poco.
const ringAt = z => (z >= 12 ? 1 : 0);

// Teselas de un zoom para unos puntos sueltos y unos recorridos (se rellenan los huecos entre puntos).
export function tilesAtZoom({ spots = [], paths = [] }, z) {
  const n = 2 ** z;
  const base = new Set();
  const add = (fx, fy) => {
    const x = Math.min(n - 1, Math.max(0, Math.floor(fx))), y = Math.min(n - 1, Math.max(0, Math.floor(fy)));
    base.add(y * n + x);
  };
  for (const p of spots) { const c = tileCoords(p.lat, p.lng, z); add(c.x, c.y); }
  for (const path of paths) {
    let prev = null;
    for (const p of path) {
      const c = tileCoords(p.lat, p.lng, z);
      if (prev) {
        // Un paso de como mucho media tesela, para no saltarse ninguna.
        const steps = Math.min(400, Math.ceil(Math.max(Math.abs(c.x - prev.x), Math.abs(c.y - prev.y)) / 0.5));
        for (let i = 1; i < steps; i++) add(prev.x + (c.x - prev.x) * i / steps, prev.y + (c.y - prev.y) * i / steps);
      }
      add(c.x, c.y);
      prev = c;
    }
  }
  const r = ringAt(z), out = new Set();
  for (const k of base) {
    const x = k % n, y = Math.floor(k / n);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < n && yy >= 0 && yy < n) out.add(yy * n + xx);
    }
  }
  return [...out].map(k => ({ z, x: k % n, y: Math.floor(k / n) }));
}

// Niveles de zoom de menos a más detalle, hasta que se alcance el máximo de teselas.
// Devuelve [{ z, tiles }] y si se quedó corto (`truncated`).
export function planTiles(geo, { minZoom = MIN_ZOOM, maxZoom = MAX_ZOOM, maxTiles = 3000 } = {}) {
  const levels = [];
  let total = 0, truncated = false;
  if (!geo.spots?.length && !geo.paths?.some(p => p.length)) return { levels, total, truncated };
  for (let z = minZoom; z <= maxZoom; z++) {
    const tiles = tilesAtZoom(geo, z);
    if (total + tiles.length > maxTiles) { truncated = true; break; }
    levels.push({ z, tiles });
    total += tiles.length;
  }
  return { levels, total, truncated };
}

export const tileUrl = (template, t) => template.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);

// Puntos y recorridos del viaje que hay que poder ver en el mapa sin conexión.
export function tripGeo(trip) {
  const ok = p => p && isFinite(p.lat) && isFinite(p.lng) && p.lat != null && p.lng != null;
  const spots = [];
  const push = p => { if (ok(p)) spots.push({ lat: +p.lat, lng: +p.lng }); };
  push(trip.center);
  for (const p of trip.places || []) push(p);
  for (const r of trip.reservations || []) {
    push(r.location);
    if (r.kind === 'flight') push(r.to);          // el aeropuerto de salida está lejos de lo que se visita
    else { push(r.from); push(r.to); }
  }
  for (const items of Object.values(trip.plan || {})) for (const it of items) push(it.where);
  const paths = (trip.routes || []).map(r => (r.points || []).filter(p => p && isFinite(p[0]) && isFinite(p[1])).map(p => ({ lat: p[0], lng: p[1] }))).filter(p => p.length > 1);
  return { spots, paths };
}
