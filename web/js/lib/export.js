// Exportar rutas y lugares a GPX y KML, para abrirlos en otras apps de mapas
// (Google My Maps, Google Earth, Organic Maps, Komoot, el reloj…).
// Los puntos de una ruta son [lat, lng] o [lat, lng, altitud].
import { simplify } from './importers.js';
import { safeFileName } from './util.js';

const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const XML = '<?xml version="1.0" encoding="UTF-8"?>';
const hasLL = p => p && p.lat != null && p.lng != null && isFinite(p.lat) && isFinite(p.lng);
const pointsOf = r => (r.points || []).filter(p => p && isFinite(p[0]) && isFinite(p[1]));

// Google My Maps admite KML de hasta 5 MB (y no recomienda más de 2.000 filas).
// Por eso los recorridos largos se aligeran antes de exportar.
export const KML_MAX_POINTS = 2000;

export function routeToGpx(r) {
  const pts = pointsOf(r);
  const trkpt = pts.map(([la, ln, el]) => `<trkpt lat="${la}" lon="${ln}">${el != null && isFinite(el) ? `<ele>${el}</ele>` : ''}</trkpt>`).join('');
  return `${XML}
<gpx version="1.1" creator="Cuaderno de viajes" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${esc(r.name)}</name></metadata>
<trk><name>${esc(r.name)}</name><trkseg>${trkpt}</trkseg></trk>
</gpx>
`;
}

// Un KML con los lugares del viaje, las rutas y los planes con ubicación.
// `routes` y `places` permiten exportar solo una parte.
export function tripToKml(trip, { routes = trip.routes, places = trip.places, plans = true } = {}) {
  const pm = (name, desc, lng, lat) => `<Placemark><name>${esc(name)}</name>${desc ? `<description>${esc(desc)}</description>` : ''}<Point><coordinates>${lng},${lat},0</coordinates></Point></Placemark>`;
  const out = [];
  for (const p of places) if (hasLL(p)) out.push(pm(p.name || 'Lugar', [p.address, p.notes].filter(Boolean).join('\n'), p.lng, p.lat));
  if (plans) {
    for (const [day, items] of Object.entries(trip.plan || {})) {
      for (const it of items) if (hasLL(it.where)) out.push(pm(it.text || it.where.name, `${day}${it.time ? ` ${it.time}` : ''}${it.where.address ? `\n${it.where.address}` : ''}`, it.where.lng, it.where.lat));
    }
  }
  for (const r of routes) {
    const pts = simplify(pointsOf(r), KML_MAX_POINTS);
    if (pts.length < 2) continue;
    out.push(`<Placemark><name>${esc(r.name)}</name><LineString><tessellate>1</tessellate><coordinates>${pts.map(([la, ln, el]) => `${ln},${la},${el != null && isFinite(el) ? el : 0}`).join(' ')}</coordinates></LineString></Placemark>`);
  }
  return `${XML}
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(trip.title || trip.destination || 'Viaje')}</name>
${out.join('\n')}
</Document></kml>
`;
}

// Descarga un archivo de texto. Devuelve false si el navegador no lo permite.
export function downloadText(filename, text, mime) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  } catch { return false; }
}

export const exportRouteGpx = r => downloadText(`${safeFileName(r.name) || 'ruta'}.gpx`, routeToGpx(r), 'application/gpx+xml');
export const exportTripKml = (trip, opts) => downloadText(`${safeFileName(trip.title || trip.destination || 'viaje')}.kml`, tripToKml(trip, opts), 'application/vnd.google-earth.kml+xml');
