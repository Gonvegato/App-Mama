// Escaneo automático del correo al abrir un viaje.
// Busca en Gmail correos que podrían ser de este viaje (reservas, billetes…) y
// los ofrece para añadirlos. No guarda nada solo: la persona decide qué entra.
// Para no molestar ni gastar cuota, solo mira cada pocas horas por viaje, y recuerda
// lo encontrado y lo descartado en este dispositivo (localStorage, no se sincroniza).
import { state, setState, LS } from './store.js';
import { gmailConfigured, gmailSearch, suggestedQuery } from './gmail.js';
import { rankMails, domainOf, baseDomain } from './mail-score.js';

const THROTTLE_MS = 6 * 60 * 60 * 1000;         // vuelve a mirar como mucho cada 6 h
const RECENT_DAYS = 30;                          // no mira viajes acabados hace más de 30 días
const resKey = id => `cv-mailscan-${id}`;        // { at, candidates } de la última vez
const dismissKey = id => `cv-maildismiss-${id}`; // ids de Gmail que ya se descartaron

const getDismissed = id => new Set(LS.get(dismissKey(id), []));

// Remitentes de los que se han guardado correos: la próxima vez puntúan más (solo en este dispositivo).
const SENDERS_KEY = 'cv-mailsenders';
const getSenders = () => LS.get(SENDERS_KEY, {});
export function learnSender(from) {
  const d = baseDomain(domainOf(from));
  if (!d) return;
  const s = getSenders();
  s[d] = Math.min(4, (s[d] || 0) + 1);
  LS.set(SENDERS_KEY, s);
}

function setScan(tripId, data) {
  setState(s => ({ mailScan: { ...(s.mailScan || {}), [tripId]: data } }));
}

// Quita ya guardados y ya descartados, y deja solo los que parecen del viaje: primero los probables
// y luego los dudosos (publicidad, boletines y peticiones de reseña se apartan).
function freshen(trip, list) {
  const saved = new Set((trip.emails || []).map(e => e.gmailId));
  const dismissed = getDismissed(trip.id);
  const fresh = (list || []).filter(r => !saved.has(r.id) && !dismissed.has(r.id));
  return rankMails(fresh, trip, getSenders()).filter(r => r.level !== 'oculto');
}

// Guarda solo lo justo de cada correo para enseñarlo luego sin volver a Gmail.
const slim = r => ({ id: r.id, from: r.from, date: r.date, subject: r.subject, snippet: (r.snippet || '').slice(0, 200), attachments: (r.attachments || []).map(a => ({ name: a.name, mime: a.mime, size: a.size })), count: r.count });

function worthScanning(trip) {
  if (!trip) return false;
  if (!trip.destination && !trip.title && !(trip.reservations?.length)) return false;
  if (trip.endDate && Date.now() - new Date(trip.endDate).getTime() > RECENT_DAYS * 86400000) return false;
  return true;
}

export function dismissCandidates(tripId, gmailIds) {
  const s = getDismissed(tripId);
  for (const g of gmailIds) s.add(g);
  LS.set(dismissKey(tripId), [...s].slice(-800));
  const cur = state.mailScan?.[tripId];
  const left = (cur?.candidates || []).filter(c => !gmailIds.includes(c.id));
  setScan(tripId, { ...(cur || { status: 'done' }), candidates: left });
  const stored = LS.get(resKey(tripId), null);
  if (stored) LS.set(resKey(tripId), { ...stored, candidates: (stored.candidates || []).filter(c => !gmailIds.includes(c.id)) });
}

export async function scanTripMail(trip, { force = false } = {}) {
  if (!trip || !gmailConfigured() || !navigator.onLine || !worthScanning(trip)) return;
  const stored = LS.get(resKey(trip.id), null);
  // Si se miró hace poco, se enseña lo que ya se encontró, sin volver a buscar.
  if (!force && stored && Date.now() - (stored.at || 0) < THROTTLE_MS) {
    setScan(trip.id, { status: 'done', candidates: freshen(trip, stored.candidates), at: stored.at });
    return;
  }
  if (state.mailScan?.[trip.id]?.status === 'scanning') return;
  setScan(trip.id, { status: 'scanning', candidates: freshen(trip, stored?.candidates) });
  try {
    const results = (await gmailSearch(suggestedQuery(trip), 40)).map(slim);
    LS.set(resKey(trip.id), { at: Date.now(), candidates: results });
    setScan(trip.id, { status: 'done', candidates: freshen(trip, results), at: Date.now() });
  } catch (e) {
    setScan(trip.id, { status: 'error', candidates: freshen(trip, stored?.candidates), error: e.message });
  }
}

export const mailScanState = tripId => state.mailScan?.[tripId] || null;
export const mailCandidates = tripId => state.mailScan?.[tripId]?.candidates || [];
