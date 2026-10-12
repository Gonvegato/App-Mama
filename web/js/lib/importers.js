// Importadores de lugares y rutas: KML/KMZ (Google My Maps, Google Earth), GPX,
// GeoJSON (Google Takeout), CSV (listas de Google Takeout) y enlaces de Google Maps y Apple Maps.
// Todas las funciones devuelven { places: [], routes: [], pending: [], warnings: [] }
// · pending: lugares sin coordenadas que hay que buscar por nombre.

const empty = () => ({ places: [], routes: [], pending: [], warnings: [] });

const num = v => { const n = parseFloat(v); return isFinite(n) ? n : null; };
const validLL = (lat, lng) => lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

export function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

function parseXml(text) {
  const P = globalThis.DOMParser;
  const doc = new P().parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('El archivo no es un XML válido');
  return doc;
}

// Busca hijos por nombre local ignorando espacios de nombres (kml:, gx:…).
function kids(el, name) {
  const out = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (n.localName || n.nodeName.split(':').pop()) === name) out.push(n);
  return out;
}
function kid(el, name) { return kids(el, name)[0] || null; }
function desc(el, name) {
  const out = [];
  const all = el.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const n = all[i];
    if ((n.localName || n.nodeName.split(':').pop()) === name) out.push(n);
  }
  return out;
}
const text = el => (el ? (el.textContent || '').trim() : '');

// ---------- KML ----------
function kmlColor(c) {
  // KML usa aabbggrr
  const m = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((c || '').trim());
  if (!m) return null;
  return `#${m[4]}${m[3]}${m[2]}`;
}

function parseCoordList(s) {
  return String(s || '').trim().split(/\s+/).map(t => {
    const [lng, lat] = t.split(',').map(num);
    return validLL(lat, lng) ? [lat, lng] : null;
  }).filter(Boolean);
}

export function parseKML(xmlText, opts = {}) {
  const res = empty();
  const doc = parseXml(xmlText);
  // Estilos de línea por id (incluidos StyleMap → normal).
  const styles = {};
  for (const st of desc(doc, 'Style')) {
    const id = st.getAttribute('id');
    const ls = kid(st, 'LineStyle');
    if (id && ls) styles[id] = kmlColor(text(kid(ls, 'color')));
    const is = kid(st, 'IconStyle');
    if (id && is && !styles[id]) styles[`icon:${id}`] = kmlColor(text(kid(is, 'color')));
  }
  for (const sm of desc(doc, 'StyleMap')) {
    const id = sm.getAttribute('id');
    for (const pair of kids(sm, 'Pair')) {
      if (text(kid(pair, 'key')) === 'normal') {
        const ref = text(kid(pair, 'styleUrl')).replace(/^#/, '');
        if (styles[ref]) styles[id] = styles[ref];
      }
    }
  }
  const docName = text(kid(kid(doc.documentElement, 'Document') || doc.documentElement, 'name'));
  const placemarks = desc(doc, 'Placemark');
  for (const pm of placemarks) {
    const name = text(kid(pm, 'name'));
    const description = stripHtml(text(kid(pm, 'description')));
    const address = text(kid(pm, 'address'));
    // Carpeta/capa a la que pertenece (en Google My Maps, la capa).
    let folder = '';
    for (let p = pm.parentNode; p && p.nodeType === 1; p = p.parentNode) {
      if ((p.localName || p.nodeName) === 'Folder') { folder = text(kid(p, 'name')); break; }
    }
    // Datos extendidos (dirección, enlaces…)
    let extra = '';
    const ed = kid(pm, 'ExtendedData');
    if (ed) {
      for (const d of kids(ed, 'Data')) {
        const k = d.getAttribute('name') || '';
        const v = text(kid(d, 'value'));
        if (v && !/^gx_media_links$/i.test(k) && !description.includes(v)) extra += `${k}: ${v}\n`;
      }
    }
    const styleRef = text(kid(pm, 'styleUrl')).replace(/^#/, '');
    const lineColor = styles[styleRef] || (kid(pm, 'Style') && kmlColor(text(desc(kid(pm, 'Style'), 'color')[0]))) || null;
    const notes = [description, extra.trim()].filter(Boolean).join('\n');

    for (const pt of desc(pm, 'Point')) {
      const [c] = parseCoordList(text(kid(pt, 'coordinates')));
      if (c) res.places.push({ name: name || 'Lugar', address, lat: c[0], lng: c[1], notes, group: folder || docName, source: opts.source || 'kml' });
    }
    const lines = [...desc(pm, 'LineString'), ...desc(pm, 'LinearRing').filter(lr => !desc(pm, 'Polygon').length)];
    for (const ln of lines) {
      const pts = parseCoordList(text(kid(ln, 'coordinates')));
      if (pts.length > 1) res.routes.push({ name: name || folder || 'Ruta', points: pts, color: lineColor || null, notes, source: opts.source || 'kml' });
    }
    for (const tr of desc(pm, 'Track')) {
      const pts = desc(tr, 'coord').map(c => { const [lng, lat] = text(c).split(/\s+/).map(num); return validLL(lat, lng) ? [lat, lng] : null; }).filter(Boolean);
      if (pts.length > 1) res.routes.push({ name: name || 'Recorrido', points: pts, color: lineColor, notes, source: opts.source || 'kml' });
    }
    if (!desc(pm, 'Point').length && !lines.length && !desc(pm, 'Track').length && desc(pm, 'Polygon').length) {
      // Polígono: se importa su centro como lugar.
      const ring = parseCoordList(text(desc(desc(pm, 'Polygon')[0], 'coordinates')[0]));
      if (ring.length) {
        const lat = ring.reduce((s, p) => s + p[0], 0) / ring.length, lng = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        res.places.push({ name: name || 'Zona', address, lat, lng, notes, group: folder || docName, source: opts.source || 'kml' });
      }
    }
    if (!desc(pm, 'Point').length && !lines.length && !desc(pm, 'Track').length && !desc(pm, 'Polygon').length && (name || address)) {
      res.pending.push({ name: name || address, address, notes, group: folder || docName, source: opts.source || 'kml' });
    }
  }
  if (!placemarks.length) res.warnings.push('El archivo no contiene lugares.');
  return res;
}

export async function parseKMZ(buffer) {
  const JSZip = globalThis.JSZip;
  if (!JSZip) throw new Error('No se pudo abrir el KMZ');
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.values(zip.files).filter(f => !f.dir && /\.kml$/i.test(f.name));
  if (!files.length) throw new Error('El KMZ no contiene ningún KML');
  files.sort((a, b) => (a.name === 'doc.kml' ? -1 : b.name === 'doc.kml' ? 1 : 0));
  const out = empty();
  for (const f of files) {
    const r = parseKML(await f.async('string'), { source: 'kml' });
    merge(out, r);
  }
  return out;
}

// ---------- GPX ----------
export function parseGPX(xmlText) {
  const res = empty();
  const doc = parseXml(xmlText);
  for (const w of desc(doc, 'wpt')) {
    const lat = num(w.getAttribute('lat')), lng = num(w.getAttribute('lon'));
    if (!validLL(lat, lng)) continue;
    res.places.push({ name: text(kid(w, 'name')) || 'Punto', lat, lng, notes: stripHtml(text(kid(w, 'desc')) || text(kid(w, 'cmt'))), source: 'gpx' });
  }
  for (const r of desc(doc, 'rte')) {
    const pts = desc(r, 'rtept').map(p => gpxPoint(p)).filter(Boolean);
    if (pts.length > 1) res.routes.push({ name: text(kid(r, 'name')) || 'Ruta', points: pts, source: 'gpx' });
    // Los puntos con nombre de una ruta también se ofrecen como lugares.
    for (const p of desc(r, 'rtept')) {
      const nm = text(kid(p, 'name'));
      const lat = num(p.getAttribute('lat')), lng = num(p.getAttribute('lon'));
      if (nm && validLL(lat, lng)) res.places.push({ name: nm, lat, lng, notes: stripHtml(text(kid(p, 'desc'))), source: 'gpx' });
    }
  }
  for (const t of desc(doc, 'trk')) {
    const pts = desc(t, 'trkpt').map(p => gpxPoint(p)).filter(Boolean);
    if (pts.length > 1) res.routes.push({ name: text(kid(t, 'name')) || 'Recorrido', points: simplify(pts, 1500), source: 'gpx' });
  }
  if (!res.places.length && !res.routes.length) res.warnings.push('El GPX no contiene puntos ni rutas.');
  return res;
}

// Un punto de ruta GPX: [lat, lng] y, si viene, la altitud en metros como tercer valor.
function gpxPoint(p) {
  const lat = num(p.getAttribute('lat')), lng = num(p.getAttribute('lon'));
  if (!validLL(lat, lng)) return null;
  const ele = num(text(kid(p, 'ele')));
  return ele != null ? [lat, lng, ele] : [lat, lng];
}

// Reduce recorridos larguísimos para que el mapa vaya fluido.
export function simplify(pts, max = 1500) {
  if (pts.length <= max) return pts;
  const step = Math.ceil(pts.length / max);
  const out = pts.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

// ---------- GeoJSON (incluye «Sitios guardados» de Google Takeout) ----------
export function parseGeoJSON(obj) {
  const res = empty();
  const data = typeof obj === 'string' ? JSON.parse(obj) : obj;
  const feats = data.type === 'FeatureCollection' ? data.features : data.type === 'Feature' ? [data] : Array.isArray(data) ? data : [];
  for (const f of feats || []) {
    const pr = f.properties || {};
    const loc = pr.location || pr.Location || {};
    const name = pr.name || pr.Name || pr.Title || pr.title || loc.name || loc['Business Name'] || '';
    const address = loc.address || loc.Address || pr.address || '';
    const url = pr.google_maps_url || pr['Google Maps URL'] || pr.url || '';
    const notes = stripHtml(pr.comment || pr.Comment || pr.description || pr.note || '');
    const g = f.geometry;
    if (!g) { if (name || address) res.pending.push({ name: name || address, address, notes, url, source: 'google' }); continue; }
    if (g.type === 'Point') {
      let [lng, lat] = g.coordinates.map(num);
      if (!validLL(lat, lng)) {
        const fromUrl = url ? coordsFromGoogleUrl(url) : null;
        if (fromUrl) { lat = fromUrl.lat; lng = fromUrl.lng; }
      }
      if (validLL(lat, lng)) res.places.push({ name: name || address || 'Lugar', address, lat, lng, notes, url, source: url ? 'google' : 'geojson' });
      else if (name || address) res.pending.push({ name: name || address, address, notes, url, source: 'google' });
    } else if (g.type === 'LineString') {
      res.routes.push({ name: name || 'Ruta', points: simplify(g.coordinates.map(([lng, lat]) => [lat, lng])), source: 'geojson' });
    } else if (g.type === 'MultiLineString') {
      for (const line of g.coordinates) res.routes.push({ name: name || 'Ruta', points: simplify(line.map(([lng, lat]) => [lat, lng])), source: 'geojson' });
    } else if (g.type === 'MultiPoint') {
      for (const [lng, lat] of g.coordinates) if (validLL(lat, lng)) res.places.push({ name: name || 'Lugar', lat, lng, notes, source: 'geojson' });
    }
  }
  if (!feats?.length) res.warnings.push('El archivo no contiene lugares.');
  return res;
}

// ---------- CSV (listas de Google Takeout y CSV genéricos) ----------
export function parseCSVText(t) {
  const rows = [];
  let row = [], cur = '', q = false;
  const s = String(t).replace(/^﻿/, '');
  const sep = (() => {
    const first = s.split(/\r?\n/)[0] || '';
    const c = (first.match(/,/g) || []).length, sc = (first.match(/;/g) || []).length, tb = (first.match(/\t/g) || []).length;
    return tb > c && tb > sc ? '\t' : sc > c ? ';' : ',';
  })();
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(c => c !== '')) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some(c => c !== '')) rows.push(row);
  return rows;
}

export function parseCSV(textData, fileName = '') {
  const res = empty();
  const rows = parseCSVText(textData);
  if (rows.length < 2) { res.warnings.push('El CSV está vacío.'); return res; }
  const head = rows[0].map(h => h.trim().toLowerCase());
  const idx = (...names) => head.findIndex(h => names.includes(h));
  const iName = idx('title', 'name', 'nombre', 'título', 'titulo', 'lugar');
  const iLat = idx('lat', 'latitude', 'latitud', 'y');
  const iLng = idx('lng', 'lon', 'long', 'longitude', 'longitud', 'x');
  const iNote = idx('note', 'nota', 'notas', 'comment', 'comentario', 'description', 'descripción', 'descripcion');
  const iUrl = idx('url', 'google maps url', 'enlace', 'link');
  const iAddr = idx('address', 'dirección', 'direccion');
  const group = fileName.replace(/\.csv$/i, '');
  for (const r of rows.slice(1)) {
    const name = (iName >= 0 ? r[iName] : r[0] || '').trim();
    const notes = [iNote >= 0 ? r[iNote] : '', r[idx('comment')] && iNote !== idx('comment') ? r[idx('comment')] : ''].filter(Boolean).join('\n').trim();
    const url = iUrl >= 0 ? (r[iUrl] || '').trim() : '';
    const address = iAddr >= 0 ? (r[iAddr] || '').trim() : '';
    let lat = iLat >= 0 ? num(r[iLat]) : null, lng = iLng >= 0 ? num(r[iLng]) : null;
    if (!validLL(lat, lng) && url) { const c = coordsFromGoogleUrl(url); if (c) { lat = c.lat; lng = c.lng; } }
    const nameFromUrl = !name && url ? googlePlaceName(url) : '';
    if (validLL(lat, lng)) res.places.push({ name: name || nameFromUrl || 'Lugar', address, lat, lng, notes, url, group, source: url ? 'google' : 'csv' });
    else if (name || nameFromUrl || address) res.pending.push({ name: name || nameFromUrl || address, address, notes, url, group, source: url ? 'google' : 'csv' });
  }
  return res;
}

// ---------- Enlaces de Google Maps ----------
const dec = s => { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch { return String(s).replace(/\+/g, ' '); } };
const llRe = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*\+?(-?\d{1,3}(?:\.\d+)?)\s*$/;
function asLL(s) {
  const m = llRe.exec(dec(s || ''));
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return validLL(lat, lng) ? { lat, lng } : null;
}

export function coordsFromGoogleUrl(url) {
  const u = String(url);
  let m = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(u);
  if (m) return { lat: +m[1], lng: +m[2] };
  m = /[?&](?:q|query|ll|center|destination|daddr)=(-?\d+\.\d+)(?:,|%2C)\+?(-?\d+\.\d+)/i.exec(u);
  if (m) return { lat: +m[1], lng: +m[2] };
  m = /\/maps\/search\/(-?\d+\.\d+)(?:,|%2C)\+?(-?\d+\.\d+)/.exec(u);
  if (m) return { lat: +m[1], lng: +m[2] };
  m = /\/maps\/place\/(-?\d+\.\d+)(?:,|%2C)\+?(-?\d+\.\d+)/.exec(u);
  if (m) return { lat: +m[1], lng: +m[2] };
  return null;
}

export function googlePlaceName(url) {
  const m = /\/maps\/place\/([^/@?]+)/.exec(String(url));
  if (!m) return '';
  const n = dec(m[1]);
  return asLL(n) ? '' : n;
}

function isShortLink(u) {
  return /^(maps\.app\.goo\.gl|goo\.gl|g\.co)$/i.test(u.hostname) || /(^|\.)maps\.apple$/i.test(u.hostname);
}

export function parseGoogleLink(raw) {
  const res = empty();
  let u;
  try { u = new URL(raw); } catch { res.warnings.push('Enlace no válido'); return res; }
  const path = u.pathname;
  const qp = u.searchParams;
  // api=1 (enlaces de direcciones o búsqueda «oficiales»)
  if (qp.get('api') === '1') {
    if (/\/dir\//.test(path) || qp.get('origin') || qp.get('destination')) {
      const parts = [qp.get('origin'), ...(qp.get('waypoints') || '').split('|'), qp.get('destination')].filter(Boolean);
      return routeFromParts(parts, 'google');
    }
    const q = qp.get('query') || '';
    const ll = asLL(q);
    if (ll) res.places.push({ name: 'Lugar', ...ll, url: raw, source: 'google' });
    else if (q) res.pending.push({ name: q, url: raw, source: 'google', gplaceId: qp.get('query_place_id') || undefined });
    return res;
  }
  if (/\/maps\/dir\//.test(path)) {
    const after = path.split('/maps/dir/')[1] || '';
    const segs = after.split('/').filter(s => s && !s.startsWith('@') && !s.startsWith('data=') && s !== 'am=t');
    const dataStr = (raw.split('/data=')[1] || '');
    // Coordenadas de los puntos con nombre: !1d<lng>!2d<lat> en orden
    const coords = [...dataStr.matchAll(/!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/g)].map(m => ({ lng: +m[1], lat: +m[2] }));
    let ci = 0;
    const pts = segs.map(s => {
      const ll = asLL(s);
      if (ll) return { name: '', ...ll };
      const name = dec(s);
      const c = coords[ci++];
      return c ? { name, ...c } : { name };
    });
    return routeFromPoints(pts, 'google', raw);
  }
  const named = googlePlaceName(raw);
  const c = coordsFromGoogleUrl(raw);
  if (/\/maps\/place\//.test(path)) {
    if (c) res.places.push({ name: named || 'Lugar', lat: c.lat, lng: c.lng, url: raw, source: 'google' });
    else if (named) res.pending.push({ name: named, url: raw, source: 'google' });
    return res;
  }
  if (/\/maps\/search\//.test(path)) {
    const q = dec((path.split('/maps/search/')[1] || '').split('/')[0]);
    const ll = asLL(q);
    if (ll) res.places.push({ name: 'Lugar', ...ll, url: raw, source: 'google' });
    else if (q) {
      const near = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(path);
      res.pending.push({ name: q, url: raw, source: 'google', near: near ? { lat: +near[1], lng: +near[2] } : undefined });
    }
    return res;
  }
  const q = qp.get('q') || qp.get('query') || qp.get('daddr');
  if (q) {
    const ll = asLL(q);
    if (ll) res.places.push({ name: 'Lugar', ...ll, url: raw, source: 'google' });
    else res.pending.push({ name: q, url: raw, source: 'google' });
    return res;
  }
  if (c) { res.places.push({ name: 'Lugar', ...c, url: raw, source: 'google' }); return res; }
  if (/\/maps\/d\//.test(path) || qp.get('mid')) {
    res.warnings.push('Es un mapa de Google My Maps: ábrelo, pulsa los tres puntos ⋮ → «Descargar KML» (marca «Exportar a KML») e impórtalo como archivo.');
    return res;
  }
  res.warnings.push('No se ha reconocido el enlace de Google Maps.');
  return res;
}

function routeFromParts(parts, source) {
  return routeFromPoints(parts.map(p => { const ll = asLL(p); return ll ? { name: '', ...ll } : { name: dec(p) }; }), source);
}

function routeFromPoints(pts, source, url) {
  const res = empty();
  pts = pts.filter(p => p.name || p.lat != null);
  pts.forEach((p, i) => {
    const label = p.name || (i === 0 ? 'Salida' : i === pts.length - 1 ? 'Llegada' : `Parada ${i}`);
    if (p.lat != null) res.places.push({ name: label, lat: p.lat, lng: p.lng, source, order: i, url });
    else res.pending.push({ name: p.name, source, order: i, url });
  });
  if (pts.length > 1) res.routeFromOrder = { name: pts.map(p => p.name).filter(Boolean).join(' → ') || 'Ruta', source };
  return res;
}

// ---------- Enlaces de Apple Maps ----------
export function parseAppleLink(raw) {
  const res = empty();
  let u;
  try { u = new URL(raw); } catch { res.warnings.push('Enlace no válido'); return res; }
  const qp = u.searchParams;
  const path = u.pathname.replace(/\/+$/, '');
  if (/^\/guides?\b/.test(path) || qp.get('guide') || qp.get('_ext') && /guide/i.test(raw)) {
    res.warnings.push('Apple Maps no permite exportar guías completas. Abre la guía y comparte cada lugar (Compartir → Copiar), o pega aquí los enlaces de uno en uno.');
    return res;
  }
  if (path === '/directions' || qp.get('saddr') || qp.get('daddr')) {
    let parts = [];
    if (path === '/directions') parts = [qp.get('source'), ...qp.getAll('waypoint'), qp.get('destination')].filter(Boolean);
    else {
      const d = qp.get('daddr') || '';
      parts = [qp.get('saddr'), ...d.split(/\s+to:\s*/i)].filter(Boolean);
    }
    return routeFromParts(parts, 'apple');
  }
  const coordStr = qp.get('coordinate') || qp.get('ll') || qp.get('center') || qp.get('sll');
  const ll = coordStr ? asLL(coordStr) : null;
  const name = qp.get('name') || qp.get('q') || qp.get('query') || '';
  const address = qp.get('address') || '';
  if (ll) { res.places.push({ name: name || address || 'Lugar', address, ...ll, url: raw, source: 'apple' }); return res; }
  if (name || address) {
    res.pending.push({ name: name || address, address, url: raw, source: 'apple' });
    return res;
  }
  if (qp.get('place-id') || qp.get('auid')) {
    res.warnings.push('Este enlace de Apple Maps solo trae un identificador interno sin coordenadas. Ábrelo en Mapas y usa «Compartir → Copiar» desde la ficha, o busca el lugar por su nombre.');
    return res;
  }
  res.warnings.push('No se ha reconocido el enlace de Apple Maps.');
  return res;
}

export function linkKind(raw) {
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (isShortLink(u)) return 'short';
  if (/(^|\.)apple\.com$/i.test(u.hostname) && /maps/i.test(u.hostname + u.pathname)) return 'apple';
  if (/google\.[a-z.]+$/i.test(u.hostname) && (/\/maps/.test(u.pathname) || u.hostname.startsWith('maps.'))) return 'google';
  if (/^maps\.google\./i.test(u.hostname)) return 'google';
  return null;
}

export function parseMapLink(raw) {
  const k = linkKind(raw);
  if (k === 'apple') return parseAppleLink(raw);
  if (k === 'google') return parseGoogleLink(raw);
  const res = empty();
  if (k === 'short') res.needsResolve = true;
  else res.warnings.push('No parece un enlace de Google Maps ni de Apple Maps.');
  return res;
}

export function extractUrls(textBlock) {
  return [...String(textBlock || '').matchAll(/https?:\/\/[^\s<>"']+/g)].map(m => m[0].replace(/[),.;]+$/, ''));
}

// ---------- Detección por archivo ----------
export async function parseFile(file) {
  const name = file.name || '';
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
  if (ext === 'kmz') return parseKMZ(await file.arrayBuffer());
  const textData = await file.text();
  if (ext === 'kml' || /<kml[\s>]/i.test(textData.slice(0, 500))) return parseKML(textData);
  if (ext === 'gpx' || /<gpx[\s>]/i.test(textData.slice(0, 500))) return parseGPX(textData);
  if (ext === 'json' || ext === 'geojson') return parseGeoJSON(textData);
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    // Un .txt con enlaces también vale.
    const urls = extractUrls(textData);
    if (ext === 'txt' && urls.length) { const r = empty(); r.links = urls; return r; }
    return parseCSV(textData, name);
  }
  throw new Error('Formato no reconocido. Usa KML, KMZ, GPX, GeoJSON, JSON o CSV.');
}

export function merge(into, r) {
  into.places.push(...(r.places || []));
  into.routes.push(...(r.routes || []));
  into.pending.push(...(r.pending || []));
  into.warnings.push(...(r.warnings || []));
  if (r.routeFromOrder) (into.orderedRoutes ||= []).push({ ...r.routeFromOrder, places: r.places, pending: r.pending });
  return into;
}

export { empty as emptyImport };
