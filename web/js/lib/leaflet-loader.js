// Carga del mapa (Leaflet) y de los estilos de fondo.
// Fondo: OpenFreeMap (gratis, sin clave ni registro) dibujado con MapLibre GL.
// Si el dispositivo no puede dibujar mapas vectoriales (sin WebGL), se usa OpenStreetMap.
import { state } from './store.js';

const vendor = p => new URL(`../../vendor/${p}`, import.meta.url).href;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve;
    s.onerror = () => reject(new Error('No se pudo cargar el mapa'));
    document.head.appendChild(s);
  });
}
function loadCss(href) {
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.appendChild(l);
}

let loading, glLoading;
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!loading) loading = (async () => {
    loadCss(vendor('leaflet/leaflet.css'));
    await loadScript(vendor('leaflet/leaflet.js'));
    return window.L;
  })();
  return loading;
}

let webgl;
export function hasWebGL() {
  if (webgl !== undefined) return webgl;
  try {
    const c = document.createElement('canvas');
    webgl = !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { webgl = false; }
  return webgl;
}

function loadGL() {
  if (window.L?.maplibreGL) return Promise.resolve(true);
  if (!glLoading) glLoading = (async () => {
    loadCss(vendor('maplibre/maplibre-gl.css'));
    await loadScript(vendor('maplibre/maplibre-gl.js'));
    await loadScript(vendor('maplibre/leaflet-maplibre-gl.js'));
    return true;
  })().catch(e => { glLoading = null; throw e; });
  return glLoading;
}

const ATTR_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const ATTR_OFM = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · Datos de ' + ATTR_OSM;

export const MAP_STYLES = {
  claro:   { label: 'Claro',   gl: 'positron' },
  color:   { label: 'Color',   gl: 'liberty' },
  oscuro:  { label: 'Oscuro',  gl: 'dark' },
  detalle: { label: 'Clásico (OpenStreetMap)' },
};

export function currentMapStyle() {
  const p = state.prefs.mapStyle || 'auto';
  if (p !== 'auto' && MAP_STYLES[p]) return p;
  return document.documentElement.dataset.dark === '1' ? 'oscuro' : 'claro';
}

// Estilo de OpenFreeMap con los nombres en español cuando existen (Londres, Lisboa…).
const styleCache = new Map();
function spanishNames(node) {
  if (Array.isArray(node)) {
    if (node.length === 2 && node[0] === 'get' && (node[1] === 'name:latin' || node[1] === 'name_en' || node[1] === 'name')) {
      return ['coalesce', ['get', 'name:es'], node];
    }
    return node.map(spanishNames);
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = spanishNames(v);
    return out;
  }
  return node;
}
async function glStyle(id) {
  if (styleCache.has(id)) return styleCache.get(id);
  const p = (async () => {
    const url = `https://tiles.openfreemap.org/styles/${id}`;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error();
      const s = await r.json();
      for (const layer of s.layers || []) {
        if (layer.layout?.['text-field']) layer.layout['text-field'] = spanishNames(layer.layout['text-field']);
      }
      return s;
    } catch {
      styleCache.delete(id);
      return url; // que MapLibre lo intente por su cuenta
    }
  })();
  styleCache.set(id, p);
  return p;
}

function osmLayer(L) {
  return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: ATTR_OSM, maxZoom: 19 });
}

// Devuelve una capa de fondo lista para añadir al mapa.
export async function baseLayer(L, styleId, { interactive = true } = {}) {
  const s = MAP_STYLES[styleId] || MAP_STYLES.claro;
  if (!s.gl || !hasWebGL()) return osmLayer(L);
  try {
    await loadGL();
    const style = await glStyle(s.gl);
    return L.maplibreGL({ style, attributionControl: { customAttribution: ATTR_OFM }, interactive: false, fadeDuration: interactive ? 300 : 0 });
  } catch {
    return osmLayer(L);
  }
}
