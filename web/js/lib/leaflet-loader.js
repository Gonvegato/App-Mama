// Carga Leaflet (mapas) solo cuando hace falta.
import { state } from './store.js';

let loading;
export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!loading) loading = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = new URL('../../vendor/leaflet/leaflet.css', import.meta.url).href;
    document.head.appendChild(css);
    const s = document.createElement('script');
    s.src = new URL('../../vendor/leaflet/leaflet.js', import.meta.url).href;
    s.onload = () => resolve(window.L);
    s.onerror = () => reject(new Error('No se pudo cargar el mapa'));
    document.head.appendChild(s);
  });
  return loading;
}

const ATTR_CARTO = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';
const ATTR_OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

export const MAP_STYLES = {
  color:  { label: 'Color',   url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', attr: ATTR_CARTO, sub: 'abcd', max: 20 },
  claro:  { label: 'Claro',   url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', attr: ATTR_CARTO, sub: 'abcd', max: 20 },
  oscuro: { label: 'Oscuro',  url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attr: ATTR_CARTO, sub: 'abcd', max: 20 },
  detalle:{ label: 'Detallado', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attr: ATTR_OSM, sub: '', max: 19 },
};

export function currentMapStyle() {
  const p = state.prefs.mapStyle || 'auto';
  if (p !== 'auto' && MAP_STYLES[p]) return p;
  const dark = document.documentElement.dataset.dark === '1';
  return dark ? 'oscuro' : 'color';
}

export function tileLayer(L, styleId) {
  const s = MAP_STYLES[styleId] || MAP_STYLES.color;
  return L.tileLayer(s.url, { attribution: s.attr, subdomains: s.sub || 'abc', maxZoom: s.max, detectRetina: false });
}
