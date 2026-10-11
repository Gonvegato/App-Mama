// Geografía: búsqueda de lugares, aeropuertos, arcos de vuelo y enlaces a mapas.
import { norm, sleep } from './util.js';

// ---------- Búsqueda de lugares (OpenStreetMap) ----------
// Nominatim solo permite búsquedas lanzadas por la persona (nada de autocompletar)
// y como máximo una por segundo, así que se espacian y se guardan en caché.
const GEO_CACHE_KEY = 'cv-geocache';
let geoCache;
function cache() {
  if (!geoCache) { try { geoCache = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}'); } catch { geoCache = {}; } }
  return geoCache;
}
function saveCache() {
  try {
    const keys = Object.keys(geoCache);
    if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete geoCache[k];
    localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geoCache));
  } catch { /* lleno */ }
}

let lastCall = 0;
async function throttle() {
  const wait = lastCall + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}

function shortAddress(a, display) {
  if (!a) return display || '';
  const road = [a.road || a.pedestrian || a.footway, a.house_number].filter(Boolean).join(' ');
  const city = a.city || a.town || a.village || a.municipality || a.county;
  return [road, city, a.country].filter(Boolean).join(', ') || display || '';
}

function nameOf(r) {
  return r.name || r.namedetails?.name || (r.display_name || '').split(',')[0];
}

export async function geocode(q, { near, limit = 6 } = {}) {
  const query = (q || '').trim();
  if (!query) return [];
  const key = `${norm(query)}|${near ? `${near.lat.toFixed(1)},${near.lng.toFixed(1)}` : ''}`;
  if (cache()[key]) return cache()[key];
  let results = [];
  try {
    await throttle();
    const p = new URLSearchParams({ q: query, format: 'jsonv2', addressdetails: '1', limit: String(limit), 'accept-language': 'es' });
    if (near) {
      const d = 1.5;
      p.set('viewbox', `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`);
    }
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${p}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    results = data.map(x => ({
      name: nameOf(x),
      address: shortAddress(x.address, x.display_name),
      lat: +x.lat, lng: +x.lon,
      type: x.type, category: x.category,
      country: x.address?.country_code?.toUpperCase() || '',
    }));
  } catch {
    // Alternativa: Photon (también basado en OpenStreetMap).
    try {
      const p = new URLSearchParams({ q: query, limit: String(limit), lang: 'default' });
      if (near) { p.set('lat', near.lat); p.set('lon', near.lng); }
      const r = await fetch(`https://photon.komoot.io/api/?${p}`);
      const data = await r.json();
      results = (data.features || []).map(f => {
        const pr = f.properties || {};
        return {
          name: pr.name || pr.street || pr.city || query,
          address: [pr.street && [pr.street, pr.housenumber].filter(Boolean).join(' '), pr.city, pr.country].filter(Boolean).join(', '),
          lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
          type: pr.osm_value, category: pr.osm_key, country: (pr.countrycode || '').toUpperCase(),
        };
      });
    } catch { results = []; }
  }
  if (results.length) { cache()[key] = results; saveCache(); }
  return results;
}

export async function reverseGeocode(lat, lng) {
  const key = `rev|${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (cache()[key]) return cache()[key];
  try {
    await throttle();
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=es`);
    const x = await r.json();
    const res = { name: nameOf(x) || '', address: shortAddress(x.address, x.display_name) };
    cache()[key] = res; saveCache();
    return res;
  } catch { return { name: '', address: '' }; }
}

// Categoría de lugar sugerida según el tipo de OpenStreetMap.
export function guessCategory(r) {
  const t = `${r.category || ''}:${r.type || ''}`;
  if (/restaurant|cafe|bar|pub|fast_food|bakery|ice_cream|food/.test(t)) return 'food';
  if (/hotel|hostel|guest_house|apartment|motel|camp_site/.test(t)) return 'stay';
  if (/park|garden|beach|peak|natural|nature|forest|water|viewpoint/.test(t)) return 'nature';
  if (/shop|mall|marketplace|market/.test(t)) return 'shop';
  if (/station|aerodrome|airport|bus|railway|ferry|terminal/.test(t)) return 'transport';
  if (/museum|attraction|monument|castle|church|cathedral|historic|tourism|gallery|theatre|artwork|memorial|ruins/.test(t)) return 'sight';
  return 'other';
}

// ---------- Aeropuertos ----------
let airports, airportsLoading;
export async function loadAirports() {
  if (airports) return airports;
  if (!airportsLoading) airportsLoading = fetch(new URL('../../data/airports.json', import.meta.url)).then(r => r.json()).then(rows => {
    airports = rows.map(([iata, name, city, country, lat, lng, size]) => ({ iata, name, city, country, lat, lng, size, _n: norm(`${iata} ${city} ${name}`) }));
    return airports;
  });
  return airportsLoading;
}
export async function findAirport(code) {
  const list = await loadAirports();
  const c = (code || '').trim().toUpperCase();
  return list.find(a => a.iata === c) || null;
}
export async function searchAirports(q, limit = 8) {
  const list = await loadAirports();
  const nq = norm(q);
  if (!nq) return [];
  const exact = list.filter(a => a.iata.toLowerCase() === nq);
  const words = nq.split(/\s+/);
  const rest = list.filter(a => a.iata.toLowerCase() !== nq && words.every(w => a._n.includes(w)));
  rest.sort((a, b) => b.size - a.size || (norm(a.city).startsWith(nq) ? -1 : 0) - (norm(b.city).startsWith(nq) ? -1 : 0));
  return [...exact, ...rest].slice(0, limit);
}

// ---------- Cálculos ----------
const R = 6371;
const toRad = d => (d * Math.PI) / 180, toDeg = r => (r * 180) / Math.PI;
export function distanceKm(a, b) {
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Arco de círculo máximo para dibujar vuelos con su curva real.
export function greatCircle(a, b, n = 64) {
  const φ1 = toRad(a.lat), λ1 = toRad(a.lng), φ2 = toRad(b.lat), λ2 = toRad(b.lng);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (d === 0) return [[a.lat, a.lng], [b.lat, b.lng]];
  const pts = [];
  let prevLng = null;
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    let lng = toDeg(Math.atan2(y, x));
    const lat = toDeg(Math.atan2(z, Math.sqrt(x * x + y * y)));
    // Evita saltos al cruzar el antimeridiano.
    if (prevLng !== null) { while (lng - prevLng > 180) lng -= 360; while (lng - prevLng < -180) lng += 360; }
    prevLng = lng;
    pts.push([lat, lng]);
  }
  return pts;
}

// ---------- Enlaces a apps de mapas ----------
export function googleMapsUrl(p) {
  if (p.gplaceId) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name || `${p.lat},${p.lng}`)}&query_place_id=${encodeURIComponent(p.gplaceId)}`;
  if (p.lat != null && p.lng != null) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.lat},${p.lng}`)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.name, p.address].filter(Boolean).join(', '))}`;
}
export function appleMapsUrl(p) {
  if (p.lat != null && p.lng != null) {
    const n = p.name ? `&name=${encodeURIComponent(p.name)}` : '';
    return `https://maps.apple.com/place?coordinate=${p.lat},${p.lng}${n}`;
  }
  return `https://maps.apple.com/search?query=${encodeURIComponent([p.name, p.address].filter(Boolean).join(', '))}`;
}
export function googleDirectionsUrl(points) {
  const pts = points.filter(p => p.lat != null);
  if (pts.length < 2) return pts[0] ? googleMapsUrl(pts[0]) : '';
  const enc = p => `${p.lat},${p.lng}`;
  // Google admite hasta 9 paradas intermedias (3 en navegadores móviles).
  const wp = pts.slice(1, -1).slice(0, 9).map(enc).join('|');
  return `https://www.google.com/maps/dir/?api=1&origin=${enc(pts[0])}&destination=${enc(pts[pts.length - 1])}${wp ? `&waypoints=${encodeURIComponent(wp)}` : ''}`;
}
export function appleDirectionsUrl(points) {
  const pts = points.filter(p => p.lat != null);
  if (pts.length < 2) return pts[0] ? appleMapsUrl(pts[0]) : '';
  const enc = p => `${p.lat},${p.lng}`;
  const wp = pts.slice(1, -1).map(p => `&waypoint=${enc(p)}`).join('');
  return `https://maps.apple.com/directions?source=${enc(pts[0])}&destination=${enc(pts[pts.length - 1])}${wp}`;
}

export const isApple = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
