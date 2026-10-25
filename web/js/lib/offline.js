// Llevarse un viaje sin conexión: datos, documentos y el mapa de la zona, en este dispositivo.
// Y quitarlo después. No toca nada de la nube.
//  · Los datos del viaje ya se guardan solos en el dispositivo (store.js); aquí se asegura que
//    el navegador no los borre (almacenamiento persistente).
//  · Documentos y billetes: copia en la Cache API (la misma que usa «Guardar para verlos sin conexión»).
//  · Mapa: teselas vectoriales de OpenFreeMap de los sitios y rutas del viaje, en la caché «mapa-v2»
//    que ya lee el service worker (sw.js).
import { keepOffline, offlineFiles } from './store.js';
import { idbPut, idbGet, idbDel, idbAll } from './idb-cache.js';
import { MAP_STYLES } from './leaflet-loader.js';
import { planTiles, tileUrl, tripGeo, MIN_ZOOM, MAX_ZOOM } from './tiles.js';

const OFM = 'https://tiles.openfreemap.org';
const TILE_CACHE = 'mapa-v2';                 // el mismo nombre que en sw.js
const OCR_CACHE = 'ocr-v1';                   // ídem: el lector de tickets
const OCR_FILES = ['tesseract.min.js', 'worker.min.js', 'tesseract-core-lstm.wasm.js', 'lang/spa.traineddata.gz', 'lang/eng.traineddata.gz'];
// Condiciones de OpenFreeMap para descargas sin conexión: como mucho 3.000 teselas o 50 MB, y 4 peticiones
// a la vez. Se queda por debajo (45 MB) para dejar margen a los archivos de estilo, símbolos y letras.
export const LIMITS = { tiles: 3000, bytes: 45 * 1024 * 1024, parallel: 4 };
const GLYPH_RANGES = ['0-255', '256-511', '8192-8447'];   // letras latinas y puntuación general

const cacheOk = () => typeof caches !== 'undefined';

export const getOfflineInfo = tripId => idbGet('manifest', tripId).then(v => v || null, () => null);   // null = nada descargado
export const listOfflineInfo = () => idbAll('manifest').catch(() => []);

// Ejecuta tareas de N en N.
async function pool(items, n, fn, signal) {
  let i = 0;
  const worker = async () => { while (i < items.length) { if (signal?.aborted) return; const it = items[i++]; await fn(it); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

// Descarga una dirección y la deja en la caché del mapa. Devuelve los bytes (0 si falló).
async function grab(cache, url, { keep = false } = {}) {
  try {
    if (!keep) { const hit = await cache.match(url); if (hit) return { bytes: (await hit.clone().arrayBuffer()).byteLength, cached: true }; }
    const res = await fetch(url);
    if (!res.ok) return { bytes: 0 };
    const bytes = (await res.clone().arrayBuffer()).byteLength;
    await cache.put(url, res);
    return { bytes, res };
  } catch { return { bytes: 0 }; }
}

// Estilos (los tres de color), símbolos y letras: lo necesario para dibujar el mapa sin red.
// Cada estilo usa varias fuentes de teselas: un fondo de baja resolución (raster, hasta zoom 6)
// y el mapa vectorial con el detalle (hasta zoom 14). Se devuelven todas, con su rango de zoom.
async function prepareStyles(cache, signal) {
  const sources = new Map();       // plantilla → { template, raster, minZoom, maxZoom }
  const extra = new Set();
  const glGroups = [...new Set(Object.values(MAP_STYLES).map(s => s.gl).filter(Boolean))];
  const json = url => cache.match(url).then(r => r?.clone().json()).catch(() => null);
  for (const id of glGroups) {
    if (signal?.aborted) break;
    await grab(cache, `${OFM}/styles/${id}`, { keep: true });                 // el estilo siempre se refresca
    const style = await json(`${OFM}/styles/${id}`);
    if (!style) continue;
    for (const src of Object.values(style.sources || {})) {
      let template = null, maxzoom = src.maxzoom, minzoom = src.minzoom;
      if (src.url) {
        await grab(cache, src.url, { keep: true });
        const tj = await json(src.url);
        template = tj?.tiles?.[0]; maxzoom = tj?.maxzoom ?? maxzoom; minzoom = tj?.minzoom ?? minzoom;
      } else template = src.tiles?.[0];
      if (!template || !template.startsWith(`${OFM}/`) || sources.has(template)) continue;   // solo OpenFreeMap
      const raster = src.type === 'raster';
      sources.set(template, { template, raster, minZoom: raster ? Math.max(0, minzoom ?? 0) : Math.max(MIN_ZOOM, minzoom ?? 0), maxZoom: Math.min(maxzoom ?? MAX_ZOOM, MAX_ZOOM) });
    }
    if (typeof style.sprite === 'string') for (const f of ['.json', '.png', '@2x.json', '@2x.png']) extra.add(style.sprite + f);
    if (style.glyphs) {
      const stacks = new Set();
      for (const l of style.layers || []) { const tf = l.layout?.['text-font']; if (Array.isArray(tf) && tf.every(x => typeof x === 'string')) stacks.add(tf.join(',')); }
      for (const st of stacks) for (const r of GLYPH_RANGES) extra.add(style.glyphs.replace('{fontstack}', st).replace('{range}', r));
    }
  }
  let bytes = 0;
  await pool([...extra], LIMITS.parallel, async u => { bytes += (await grab(cache, u)).bytes; }, signal);
  // Primero el fondo de baja resolución (muy pocas teselas) y luego el vectorial.
  return { sources: [...sources.values()].sort((a, b) => b.raster - a.raster), bytes };
}

// Descarga el viaje para usarlo sin conexión.
// onProgress({ phase: 'docs'|'map', done, total, bytes })
export async function downloadTripOffline(trip, { onProgress, signal } = {}) {
  if (!navigator.onLine) throw new Error('Hace falta conexión para descargar el viaje.');
  // Pide que el navegador no borre los datos si falta espacio (puede no concederlo).
  let persistent = false;
  try { persistent = !!(await navigator.storage?.persist?.()); } catch { /* nada */ }

  // 1) Documentos y billetes
  const docs = (trip.docs || []).filter(d => d.path);
  let done = 0, ok = 0, docBytes = 0;
  onProgress?.({ phase: 'docs', done, total: docs.length, bytes: 0 });
  await pool(docs, 3, async d => {
    try { if (await keepOffline(d.path)) { ok++; docBytes += d.size || 0; } } catch { /* sigue con el resto */ }
    onProgress?.({ phase: 'docs', done: ++done, total: docs.length, bytes: docBytes });
  }, signal);

  // 2) Mapa de la zona
  const map = { tiles: 0, bytes: 0, maxZoom: 0, truncated: false, sources: [], skipped: null };
  const geo = tripGeo(trip);
  if (cacheOk() && !signal?.aborted) {
    if (!geo.spots.length && !geo.paths.length) map.skipped = 'sin-sitios';
    else {
      onProgress?.({ phase: 'map', done: 0, total: 0, bytes: 0 });
      const cache = await caches.open(TILE_CACHE);
      const { sources, bytes: styleBytes } = await prepareStyles(cache, signal);
      map.bytes = styleBytes;
      if (!sources.length) map.skipped = 'sin-estilo';
      // Qué teselas hacen falta de cada fuente, sin pasar del máximo de teselas entre todas.
      const plans = [];
      let left = LIMITS.tiles, total = 0;
      for (const src of sources) {
        const plan = planTiles(geo, { minZoom: src.minZoom, maxZoom: src.maxZoom, maxTiles: left });
        left -= plan.total; total += plan.total;
        if (plan.truncated) map.truncated = true;
        plans.push({ src, plan, keys: [], maxZoom: 0 });
      }
      let n = 0, stop = false, capped = false, biggest = 0;
      onProgress?.({ phase: 'map', done: 0, total, bytes: map.bytes });
      for (const P of plans) {
        for (const lvl of P.plan.levels) {
          if (stop || signal?.aborted) break;
          const before = P.keys.length;
          await pool(lvl.tiles, LIMITS.parallel, async t => {
            // Se cuentan también las que ya van de camino (4 a la vez), como si fueran de la más grande vista.
            if (signal?.aborted) return;
            if (map.bytes + LIMITS.parallel * biggest > LIMITS.bytes) { capped = true; return; }
            const r = await grab(cache, tileUrl(P.src.template, t));
            if (r.bytes) { map.bytes += r.bytes; map.tiles++; biggest = Math.max(biggest, r.bytes); P.keys.push(`${t.z}/${t.x}/${t.y}`); }
            onProgress?.({ phase: 'map', done: ++n, total, bytes: map.bytes });
          }, signal);
          if (P.keys.length > before) P.maxZoom = lvl.z;
          if (capped) { stop = true; map.truncated = true; }   // máximo de MB: este nivel queda a medias
        }
      }
      map.sources = plans.map(P => ({ template: P.src.template, raster: P.src.raster, keys: P.keys, maxZoom: P.maxZoom }));
      map.maxZoom = Math.max(0, ...map.sources.filter(s => !s.raster).map(s => s.maxZoom));
    }
  }

  // 3) Lector de tickets (OCR), para poder escanear gastos sin cobertura. Es el mismo para todos los viajes.
  const ocr = { ok: false, bytes: 0 };
  if (cacheOk() && !signal?.aborted) {
    const cache = await caches.open(OCR_CACHE);
    let k = 0, good = 0;
    onProgress?.({ phase: 'ocr', done: 0, total: OCR_FILES.length, bytes: 0 });
    for (const f of OCR_FILES) {
      if (signal?.aborted) break;
      const r = await grab(cache, new URL(`../../vendor/tesseract/${f}`, import.meta.url).href);
      if (r.bytes) { good++; ocr.bytes += r.bytes; }
      onProgress?.({ phase: 'ocr', done: ++k, total: OCR_FILES.length, bytes: ocr.bytes });
    }
    ocr.ok = good === OCR_FILES.length;
  }

  const info = {
    tripId: trip.id, title: trip.title || trip.destination || 'Viaje', savedAt: new Date().toISOString(), tripUpdatedAt: trip.updatedAt || '',
    persistent, docs: { total: docs.length, ok, bytes: docBytes }, files: docs.map(d => d.path), map, ocr,
  };
  if (!signal?.aborted) await idbPut('manifest', trip.id, info);
  return info;
}

// Quita del dispositivo lo descargado de un viaje. NO borra nada de la nube ni del viaje.
export async function removeTripOffline(tripId) {
  const info = await getOfflineInfo(tripId);
  if (!info) return;
  await offlineFiles.remove(info.files || []);
  // Las teselas pueden servir a otro viaje descargado: solo se quitan las que no usa ningún otro.
  if (cacheOk() && info.map?.sources?.length) {
    const others = new Set();
    for (const m of await listOfflineInfo()) if (m.tripId !== tripId) for (const src of m.map?.sources || []) for (const k of src.keys || []) others.add(`${src.template}|${k}`);
    const cache = await caches.open(TILE_CACHE);
    for (const src of info.map.sources) for (const k of src.keys || []) {
      if (others.has(`${src.template}|${k}`)) continue;
      const [z, x, y] = k.split('/');
      await cache.delete(tileUrl(src.template, { z, x, y }));
    }
  }
  await idbDel('manifest', tripId);
}

export const offlineBytes = info => (info?.docs?.bytes || 0) + (info?.map?.bytes || 0);
