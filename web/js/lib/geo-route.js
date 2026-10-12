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

// Desnivel y altitud a partir de la altura (tercer valor de cada punto, si el GPX la trae).
// Se usa un pequeño umbral para no contar el «ruido» del GPS como subidas y bajadas.
export function elevationStats(points, threshold = 4) {
  const eles = points.map(p => (p.length > 2 && isFinite(p[2]) ? p[2] : null));
  if (eles.filter(e => e != null).length < 2) return { has: false };
  let ascent = 0, descent = 0, min = Infinity, max = -Infinity, last = null;
  for (const e of eles) {
    if (e == null) continue;
    if (e < min) min = e;
    if (e > max) max = e;
    if (last != null) {
      const d = e - last;
      if (d > threshold) { ascent += d; last = e; }
      else if (d < -threshold) { descent += -d; last = e; }
    } else last = e;
  }
  return { has: true, ascent: Math.round(ascent), descent: Math.round(descent), min: Math.round(min), max: Math.round(max) };
}

// Estimación de dificultad a partir de distancia y desnivel positivo (regla de a pie, tipo Naismith:
// 100 m de subida ≈ 1 km de esfuerzo). No mide lo técnico del terreno; es orientativa.
export function difficulty(lengthKm, ascentM = 0) {
  const effort = lengthKm + (ascentM || 0) / 100;
  if (effort < 5) return { level: 1, label: 'Fácil' };
  if (effort < 12) return { level: 2, label: 'Moderada' };
  if (effort < 22) return { level: 3, label: 'Exigente' };
  return { level: 4, label: 'Difícil' };
}

// Resumen completo de una ruta para el menú de detalles.
export function routeStats(route) {
  const points = route.points || [];
  const lengthKm = routeLengthKm(points);
  const ele = elevationStats(points);
  const diff = difficulty(lengthKm, ele.has ? ele.ascent : 0);
  return { lengthKm, points: points.length, ele, difficulty: diff };
}

// Texto corto de una distancia en km (p. ej. «450 m», «2,3 km»).
export function fmtKm(km) {
  if (km == null || !isFinite(km)) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}
