// Modelo de datos de un viaje, catálogos y normalización.
import { uid, sid, eachDay, dateOnly, todayISO } from './util.js';

export const RES_KINDS = {
  flight:     { label: 'Vuelo',           icon: 'plane',    color: '#4f6d8a' },
  hotel:      { label: 'Alojamiento',     icon: 'bed',      color: '#8a6a4f' },
  train:      { label: 'Tren',            icon: 'train',    color: '#5e7a5a' },
  bus:        { label: 'Autobús',         icon: 'bus',      color: '#6f7d4e' },
  ferry:      { label: 'Barco',           icon: 'ship',     color: '#3f7f86' },
  car:        { label: 'Coche de alquiler', icon: 'car',    color: '#7a5f7c' },
  activity:   { label: 'Actividad o entrada', icon: 'ticket', color: '#a0624a' },
  restaurant: { label: 'Restaurante',     icon: 'food',     color: '#9a7b3c' },
  other:      { label: 'Otra reserva',    icon: 'receipt',  color: '#6b6b6b' },
};

// Las reservas que van de un sitio a otro.
export const isTransport = k => ['flight', 'train', 'bus', 'ferry'].includes(k);

export const PLACE_CATS = {
  sight:     { label: 'Visitar',        icon: 'landmark', color: '#a0624a' },
  food:      { label: 'Comer y beber',  icon: 'food',     color: '#9a7b3c' },
  stay:      { label: 'Alojamiento',    icon: 'bed',      color: '#8a6a4f' },
  nature:    { label: 'Naturaleza',     icon: 'trees',    color: '#5e7a5a' },
  shop:      { label: 'Compras',        icon: 'shopping', color: '#7a5f7c' },
  transport: { label: 'Transporte',     icon: 'navigation', color: '#4f6d8a' },
  other:     { label: 'Otros',          icon: 'pin',      color: '#5f6b73' },
};

export const DOC_KINDS = {
  billete:   { label: 'Billete',          icon: 'ticket' },
  entrada:   { label: 'Entrada o ticket', icon: 'ticket' },
  reserva:   { label: 'Reserva',          icon: 'receipt' },
  guia:      { label: 'Guía',             icon: 'book' },
  seguro:    { label: 'Seguro',           icon: 'shield' },
  identidad: { label: 'Documentación',    icon: 'id' },
  foto:      { label: 'Foto',             icon: 'image' },
  enlace:    { label: 'Enlace',           icon: 'link' },
  otro:      { label: 'Otro',             icon: 'file' },
};

export const EXPENSE_CATS = {
  transporte:  { label: 'Transporte',   icon: 'plane' },
  alojamiento: { label: 'Alojamiento',  icon: 'bed' },
  comida:      { label: 'Comida',       icon: 'food' },
  ocio:        { label: 'Ocio',         icon: 'ticket' },
  compras:     { label: 'Compras',      icon: 'shopping' },
  otros:       { label: 'Otros',        icon: 'wallet' },
};

export const PACKING_TEMPLATES = {
  'Esencial': ['Pasaporte o DNI', 'Tarjeta sanitaria europea', 'Tarjetas y algo de efectivo', 'Móvil y cargador', 'Adaptador de enchufe', 'Medicación habitual', 'Gafas', 'Llaves de casa'],
  'Ropa': ['Ropa interior', 'Calcetines', 'Pijama', 'Camisetas', 'Pantalones', 'Jersey o chaqueta', 'Calzado cómodo', 'Ropa de abrigo'],
  'Aseo': ['Cepillo y pasta de dientes', 'Champú y gel', 'Desodorante', 'Crema solar', 'Peine', 'Maquillaje', 'Botiquín básico'],
  'Playa': ['Bañador', 'Toalla de playa', 'Gafas de sol', 'Sombrero', 'Chanclas', 'After sun'],
  'Frío': ['Abrigo', 'Gorro', 'Guantes', 'Bufanda', 'Ropa térmica', 'Botas'],
  'Avión': ['Tarjeta de embarque', 'Bolsa de líquidos (100 ml)', 'Almohada de viaje', 'Auriculares', 'Libro o revista'],
};

export const COVER_PRESETS = [
  { id: 'arena',    a: '#d9c3a5', b: '#a8805c' },
  { id: 'salvia',   a: '#c5d0b8', b: '#6d8366' },
  { id: 'mar',      a: '#b9cdd8', b: '#4c6f86' },
  { id: 'atardecer',a: '#e7c2a6', b: '#a2594a' },
  { id: 'lavanda',  a: '#cfc5da', b: '#6e6085' },
  { id: 'pizarra',  a: '#b8bdc4', b: '#4a525c' },
  { id: 'trigo',    a: '#e8d9a8', b: '#a78b3f' },
  { id: 'bosque',   a: '#a9bfae', b: '#3e5a48' },
];

export function newTrip(partial = {}) {
  const now = new Date().toISOString();
  return normalizeTrip({
    id: uid(),
    title: '',
    destination: '',
    startDate: '',
    endDate: '',
    cover: { type: 'preset', id: COVER_PRESETS[Math.floor(Math.random() * COVER_PRESETS.length)].id },
    createdAt: now,
    updatedAt: now,
    ...partial,
  });
}

export function normalizeTrip(t) {
  const trip = { ...t };
  trip.title = trip.title || '';
  trip.destination = trip.destination || '';
  trip.startDate = trip.startDate || '';
  trip.endDate = trip.endDate || trip.startDate || '';
  trip.cover = trip.cover || { type: 'preset', id: 'arena' };
  trip.travelers = Array.isArray(trip.travelers) ? trip.travelers : [];
  trip.notes = trip.notes || '';
  trip.budget = trip.budget || { amount: 0, currency: 'EUR' };
  trip.center = trip.center || null; // {lat,lng} del destino
  for (const k of ['reservations', 'places', 'routes', 'docs', 'emails', 'packing', 'expenses', 'links', 'photos'])
    trip[k] = Array.isArray(trip[k]) ? trip[k] : [];
  trip.plan = trip.plan && typeof trip.plan === 'object' ? trip.plan : {};
  trip.archived = !!trip.archived;
  return trip;
}

export const newReservation = (kind = 'flight', p = {}) => ({ id: sid(), kind, title: '', start: '', end: '', from: null, to: null, location: null, code: '', provider: '', number: '', seat: '', notes: '', url: '', price: null, docIds: [], ...p });
export const newPlace = (p = {}) => ({ id: sid(), name: '', address: '', lat: null, lng: null, category: 'sight', day: '', notes: '', url: '', visited: false, source: 'manual', ...p });
export const newRoute = (p = {}) => ({ id: sid(), name: 'Ruta', color: '#4c6f86', points: [], source: 'manual', ...p });
// Un plan del día: hora, título, una nota más larga, fotos (ids de documentos del viaje)
// y, si se indica, el sitio donde es (`where`: {name, address, lat, lng}) para verlo en el mapa.
export const newPlanItem = (p = {}) => ({ id: sid(), time: '', text: '', note: '', photoIds: [], where: null, ...p });
// Deja un plan con todos sus campos aunque venga de una versión antigua (sin nota, fotos ni lugar).
export const planItem = it => ({ note: '', photoIds: [], time: '', text: '', where: null, ...it });

// Planes del itinerario que tienen un lugar con coordenadas (para dibujarlos en el mapa).
export function locatedPlans(trip, day = '') {
  const out = [];
  for (const [d, items] of Object.entries(trip.plan || {})) {
    if (day && d !== day) continue;
    for (const it of items) if (it.where?.lat != null && it.where?.lng != null) out.push({ ...planItem(it), day: d });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || (a.time || '99').localeCompare(b.time || '99'));
}

export function resTitle(r, { short = false } = {}) {
  if (r.title) return r.title;
  if (r.kind === 'flight') {
    const a = short ? r.from?.name || r.from?.iata : r.from?.iata || r.from?.name;
    const b = short ? r.to?.name || r.to?.iata : r.to?.iata || r.to?.name;
    const n = [r.provider, r.number].filter(Boolean).join(' ');
    if (a && b) return `${a} → ${b}${n && !short ? ` · ${n}` : ''}`;
    return n || 'Vuelo';
  }
  if (isTransport(r.kind)) {
    const a = r.from?.name, b = r.to?.name;
    if (a && b) return `${a} → ${b}`;
  }
  if (r.location?.name) return r.location.name;
  return r.provider || RES_KINDS[r.kind]?.label || 'Reserva';
}

// Puntos con coordenadas que aporta una reserva.
export function resPoints(r) {
  const pts = [];
  for (const key of ['from', 'to', 'location']) {
    const p = r[key];
    if (p && isFinite(p.lat) && isFinite(p.lng) && p.lat !== null) pts.push({ ...p, role: key });
  }
  return pts;
}

// Agenda día a día: reservas, lugares asignados y planes propios.
export function buildAgenda(trip) {
  const days = eachDay(trip.startDate, trip.endDate);
  const map = new Map(days.map(d => [d, []]));
  const extra = new Map();
  const push = (day, item) => {
    if (!day) return;
    if (!map.has(day)) { if (!extra.has(day)) extra.set(day, []); extra.get(day).push(item); return; }
    map.get(day).push(item);
  };
  for (const r of trip.reservations) {
    const d0 = dateOnly(r.start);
    if (r.kind === 'hotel' || r.kind === 'car') {
      const d1 = dateOnly(r.end);
      push(d0, { type: 'res', res: r, phase: 'start', time: r.start?.slice(11, 16) || '' });
      if (d1 && d1 !== d0) {
        for (const d of eachDay(d0, d1).slice(1, -1)) push(d, { type: 'res', res: r, phase: 'during', time: '' });
        push(d1, { type: 'res', res: r, phase: 'end', time: r.end?.slice(11, 16) || '' });
      }
    } else {
      push(d0, { type: 'res', res: r, phase: 'start', time: r.start?.slice(11, 16) || '' });
      const d1 = dateOnly(r.end);
      if (d1 && d1 !== d0 && isTransport(r.kind)) push(d1, { type: 'res', res: r, phase: 'arrive', time: r.end?.slice(11, 16) || '' });
    }
  }
  for (const p of trip.places) if (p.day) push(p.day, { type: 'place', place: p, time: p.time || '' });
  for (const [day, items] of Object.entries(trip.plan || {}))
    for (const it of items) push(day, { type: 'plan', item: it, time: it.time || '' });
  const sortItems = arr => arr.sort((a, b) => {
    const ta = a.time || (a.phase === 'during' ? '00:00' : '99:99'), tb = b.time || (b.phase === 'during' ? '00:00' : '99:99');
    return ta.localeCompare(tb);
  });
  const out = days.map(d => ({ day: d, items: sortItems(map.get(d)) }));
  const outside = [...extra.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, items]) => ({ day, items: sortItems(items), outside: true }));
  return { days: out, outside };
}

export function tripStats(trip) {
  return {
    reservations: trip.reservations.length,
    places: trip.places.length,
    docs: trip.docs.length,
    emails: trip.emails.length,
    packing: trip.packing.length,
    packed: trip.packing.filter(p => p.done).length,
    expenses: trip.expenses.length,
  };
}

export function sortTrips(trips, today = todayISO()) {
  const now = [], upcoming = [], past = [], nodate = [];
  for (const t of trips) {
    if (!t.startDate) nodate.push(t);
    else if (today < t.startDate) upcoming.push(t);
    else if (today > (t.endDate || t.startDate)) past.push(t);
    else now.push(t);
  }
  upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate));
  now.sort((a, b) => a.startDate.localeCompare(b.startDate));
  past.sort((a, b) => b.startDate.localeCompare(a.startDate));
  nodate.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return { now, upcoming, past, nodate };
}

// Archivos (rutas de almacenamiento) que usa un viaje, para borrarlos con él.
export function tripFilePaths(trip) {
  const paths = [];
  if (trip.cover?.type === 'image' && trip.cover.path) paths.push(trip.cover.path);
  if (trip.cover?.type === 'image' && trip.cover.thumbPath) paths.push(trip.cover.thumbPath);
  for (const d of trip.docs) if (d.path) paths.push(d.path);
  for (const e of trip.emails) if (e.bodyPath) paths.push(e.bodyPath);
  return paths;
}
