// Rutas sencillas con «#»: funcionan igual en el ordenador, en el móvil y con el botón Atrás.
import { useEffect, useState } from '../../vendor/preact-htm.js';

export function parseRoute(hash = location.hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'viaje' && parts[1]) return { name: 'trip', id: parts[1], tab: parts[2] || 'resumen', sub: parts[3] || null };
  if (parts[0] === 'ajustes') return { name: 'settings', section: parts[1] || null };
  return { name: 'home' };
}

export function useRoute() {
  const [route, setRoute] = useState(parseRoute());
  useEffect(() => {
    const l = () => setRoute(parseRoute());
    window.addEventListener('hashchange', l);
    return () => window.removeEventListener('hashchange', l);
  }, []);
  return route;
}

export function go(path, { replace = false } = {}) {
  const h = path.startsWith('#') ? path : `#${path}`;
  if (replace) history.replaceState(null, '', h);
  else if (location.hash !== h) location.hash = h;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export const tripPath = (id, tab) => `/viaje/${encodeURIComponent(id)}${tab && tab !== 'resumen' ? `/${tab}` : ''}`;
