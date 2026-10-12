// Cálculos para seguir una ruta: longitud, punto más cercano y distancia que queda.
// Puntos en formato [lat, lng]. Distancias en kilómetros.
import { distanceKm } from './geo.js';

const ll = p => ({ lat: p[0], lng: p[1] });

// Longitud total de la línea (suma de los tramos).
export function routeLengthKm(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceKm(ll(points[i - 1]), ll(points[i]));
  return total;
}

// Proyección de un punto sobre un tramo, en coordenadas planas locales (vale para distancias cortas).
function projectOnSegment(pos, a, b) {
  const latRef = (a[0] + b[0]) / 2;
  const kx = Math.cos((latRef * Math.PI) / 180);
  const ax = a[1] * kx, ay = a[0];
  const bx = b[1] * kx, by = b[0];
  const px = pos.lng * kx, py = pos.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { lat: ay + t * dy, lng: (ax + t * dx) / kx, t };
}

// Punto de la ruta más cercano a la posición actual.
// Devuelve: distancia fuera de ruta (offKm), cuánto queda hasta el final (aheadKm),
// avance 0..1 (progress), índice del tramo y el punto proyectado {lat,lng}.
export function nearestOnRoute(points, pos) {
  if (!points || points.length === 0) return null;
  if (points.length === 1) {
    const off = distanceKm(pos, ll(points[0]));
    return { offKm: off, aheadKm: 0, doneKm: 0, progress: 1, index: 0, at: ll(points[0]) };
  }
  // Longitud acumulada hasta el inicio de cada tramo.
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum[i] = cum[i - 1] + distanceKm(ll(points[i - 1]), ll(points[i]));
  const total = cum[points.length - 1];

  let best = null;
  for (let i = 1; i < points.length; i++) {
    const proj = projectOnSegment(pos, points[i - 1], points[i]);
    const off = distanceKm(pos, proj);
    if (!best || off < best.off) {
      const segLen = cum[i] - cum[i - 1];
      const done = cum[i - 1] + proj.t * segLen;
      best = { off, done, index: i - 1, at: { lat: proj.lat, lng: proj.lng } };
    }
  }
  return {
    offKm: best.off,
    doneKm: best.done,
    aheadKm: Math.max(0, total - best.done),
    progress: total ? best.done / total : 0,
    index: best.index,
    at: best.at,
  };
}

// Texto corto de una distancia en km (p. ej. «450 m», «2,3 km»).
export function fmtKm(km) {
  if (km == null || !isFinite(km)) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}
