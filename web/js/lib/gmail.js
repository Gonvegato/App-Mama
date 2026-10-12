// Conexión con Gmail a través del ayudante de Google Apps Script (ver backend/gmail-ayudante.gs).
// El ayudante se ejecuta en la cuenta de Google de quien lo instala y solo responde
// a quien conozca su clave secreta.
import { state } from './store.js';
import { addDays, norm } from './util.js';
import { isTransport } from './model.js';

export function gmailConfigured() {
  const g = state.settings?.gmail;
  return !!(g?.url && g?.key);
}

async function call(action, params = {}, cfg = state.settings?.gmail) {
  if (!cfg?.url || !cfg?.key) throw new Error('Gmail no está conectado. Ve a Ajustes → Correo.');
  let r;
  try {
    // Sin cabeceras propias para que el navegador no haga la comprobación CORS previa.
    r = await fetch(cfg.url, { method: 'POST', body: JSON.stringify({ key: cfg.key, action, ...params }), redirect: 'follow' });
  } catch {
    throw new Error('No se pudo contactar con el ayudante de Gmail. Revisa la conexión y que la URL termine en /exec.');
  }
  const txt = await r.text();
  let data;
  try { data = JSON.parse(txt); } catch {
    if (/accounts\.google\.com|ServiceLogin|Sign in/i.test(txt)) throw new Error('El ayudante pide iniciar sesión: al implementarlo, en «Quién tiene acceso» hay que elegir «Cualquier usuario».');
    throw new Error('Respuesta inesperada del ayudante de Gmail. ¿Has copiado la URL de la implementación (termina en /exec)?');
  }
  if (data.error) throw new Error(data.error === 'clave' ? 'La clave del ayudante de Gmail no coincide.' : data.error);
  return data;
}

export const gmailPing = cfg => call('ping', {}, cfg);
export const gmailSearch = async (q, max = 30) => (await call('search', { q, max })).results || [];
export const gmailGet = id => call('get', { id });
export const gmailAttachment = (id, index) => call('attachment', { id, index });
export const resolveUrl = url => call('resolve', { url });
// Trae un archivo o una página a través del ayudante (para mostrarlos dentro de la app).
export const fetchViaHelper = url => call('fetch', { url });

const gdate = iso => iso.replace(/-/g, '/');

// Palabras útiles del destino (sin palabras vacías).
const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'en', 'a', 'con', 'por', 'para', 'viaje', 'vacaciones', 'escapada', 'the', 'to', 'of', 'and', 'trip']);
function words(s) {
  return (s || '').split(/[\s,·\-–/()]+/).map(w => w.trim()).filter(w => w.length > 2 && !STOP.has(norm(w)));
}
const quote = w => (/\s/.test(w) ? `"${w}"` : w);

// Construye la búsqueda de Gmail para encontrar correos de un viaje.
export function suggestedQuery(trip) {
  const terms = new Set();
  for (const w of words(trip.destination)) terms.add(w);
  for (const w of words(trip.title)) terms.add(w);
  for (const r of trip.reservations) {
    if (r.code) terms.add(r.code.trim());
    if (r.provider && r.provider.length > 2) terms.add(r.provider.trim());
    if (r.kind === 'flight') { if (r.from?.iata) terms.add(r.from.iata); if (r.to?.iata) terms.add(r.to.iata); }
    if (isTransport(r.kind)) { if (r.to?.name) words(r.to.name).slice(0, 2).forEach(w => terms.add(w)); }
    if (r.kind === 'hotel' && r.location?.name) terms.add(r.location.name.split(',')[0].trim());
  }
  const list = [...terms].filter(Boolean).slice(0, 18).map(quote);
  const topic = '(reserva OR booking OR confirmación OR confirmation OR billete OR ticket OR vuelo OR flight OR itinerario OR itinerary OR "tarjeta de embarque" OR "boarding pass" OR hotel OR check-in OR entradas OR factura)';
  let q = list.length ? `(${list.join(' OR ')}) ${topic}` : topic;
  if (trip.startDate) {
    const after = addDays(trip.startDate, -300);
    const before = addDays(trip.endDate || trip.startDate, 10);
    q += ` after:${gdate(after)} before:${gdate(before)}`;
  }
  return q;
}

export function quickQueries(trip) {
  const dest = words(trip.destination).slice(0, 3).map(quote).join(' OR ');
  const out = [];
  if (dest) out.push({ label: `Todo sobre ${trip.destination}`, q: `(${dest})` });
  out.push({ label: 'Vuelos y tarjetas de embarque', q: '(vuelo OR flight OR "tarjeta de embarque" OR "boarding pass" OR "e-ticket" OR itinerario)' + (dest ? ` (${dest})` : '') });
  out.push({ label: 'Hoteles y alojamientos', q: '(hotel OR booking.com OR airbnb OR alojamiento OR apartamento OR "check-in")' + (dest ? ` (${dest})` : '') });
  out.push({ label: 'Con archivos adjuntos', q: `has:attachment (reserva OR booking OR billete OR ticket OR confirmación OR confirmation)${dest ? ` (${dest})` : ''}` });
  return out;
}
