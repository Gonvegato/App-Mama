// ¿Este correo es del viaje? Puntúa cada correo encontrado con lo que se ve sin abrirlo
// (remitente, asunto, extracto y nombres de adjuntos) para quedarse con lo que parece una
// reserva, un billete o una confirmación, y apartar publicidad, boletines y peticiones de reseña.
//   ≥ 4  → «probable»   1 a 3 → «dudoso»   ≤ 0 → «oculto» (no parece del viaje)
import { norm } from './util.js';

const CONFIRM = /confirmaci[oó]n|confirmad[oa]|confirmation|confirmed|e-?ticket|billete|boarding pass|tarjeta de embarque|itinerar|voucher|\breserva\b|\bbooking\b|reservation|check-?in|localizador|\bpnr\b/i;
const PROMO = /\bofertas?\b|descuento|promoci[oó]n|\bpromo\b|newsletter|bolet[ií]n|sorteo|cup[oó]n|rebajas|black friday|[uú]ltimas plazas|\bdeals?\b|\bsale\b|hasta (un )?\d+ ?%|\bahorra|suscr[ií]bete|unsubscribe|darte de baja|encuesta|valora|opina|rate your|how was your|cu[eé]ntanos|rese[ñn]a|\breview\b/i;
const ATT_TICKET = /ticket|billete|boarding|embarque|reserva|booking|confirm|voucher|itinerar|entrada|factura-?viaje/i;
const BULK_SENDER = /(^|[.@_-])(news|newsletter|marketing|promo|promos|offers?|ofertas|deals|mailing|campaign|mkt)([.@_-]|$)/i;
// Empresas de viajes conocidas (ejemplos habituales; el resto se detecta por las palabras).
const TRAVEL_DOMAINS = ['booking.com', 'airbnb.com', 'airbnb.es', 'expedia.com', 'expedia.es', 'hotels.com', 'agoda.com', 'trip.com', 'ryanair.com', 'vueling.com', 'iberia.com', 'iberiaexpress.com', 'aireuropa.com', 'easyjet.com', 'klm.com', 'lufthansa.com', 'britishairways.com', 'airfrance.com', 'volotea.com', 'renfe.com', 'ouigo.com', 'iryo.eu', 'trainline.com', 'trainline.es', 'blablacar.com', 'alsa.es', 'flixbus.com', 'getyourguide.com', 'viator.com', 'civitatis.com', 'tiqets.com', 'rentalcars.com', 'hertz.com', 'avis.com', 'sixt.com', 'europcar.com', 'goldcar.es'];

export const domainOf = from => {
  const m = String(from || '').match(/@([^>\s]+)/);
  return (m ? m[1] : '').toLowerCase().replace(/[>"']+$/, '');
};
// Dominio «base» para recordar remitentes (mail.ryanair.com → ryanair.com).
export const baseDomain = d => d.split('.').slice(-2).join('.');
const isTravelDomain = d => TRAVEL_DOMAINS.some(t => d === t || d.endsWith(`.${t}`));

function words(s) { return norm(s).split(/[\s,·\-–/()]+/).filter(w => w.length > 3); }

// senders: puntos aprendidos por dominio (+ si se guardaron correos suyos, − si se descartaron).
export function scoreMail(m, trip = {}, senders = {}) {
  const subject = m.subject || '', snippet = m.snippet || '', from = m.from || '';
  const dom = domainOf(from), local = String(from).toLowerCase();
  let score = 0;
  const why = [];
  const add = (n, text) => { score += n; why.push(`${n > 0 ? '+' : ''}${n} ${text}`); };

  if (CONFIRM.test(subject)) add(3, 'el asunto parece una confirmación o billete');
  else if (CONFIRM.test(snippet)) add(2, 'el texto menciona una reserva o billete');
  const codes = (trip.reservations || []).map(r => (r.code || '').trim()).filter(c => c.length >= 5);
  if (codes.some(c => subject.toUpperCase().includes(c.toUpperCase()) || snippet.toUpperCase().includes(c.toUpperCase()))) add(5, 'tiene el código de una de tus reservas');
  if (isTravelDomain(dom)) add(3, 'lo envía una empresa de viajes');
  const atts = m.attachments || [];
  if (atts.some(a => ATT_TICKET.test(a.name || ''))) add(3, 'trae un adjunto que parece un billete o reserva');
  else if (atts.some(a => /pdf|pkpass|calendar/i.test(`${a.mime} ${a.name}`))) add(1, 'trae un PDF o un evento de calendario');
  const hay = norm(`${subject} ${snippet}`);
  if ([...words(trip.destination), ...words(trip.title)].some(w => hay.includes(w))) add(1, 'menciona el destino del viaje');

  if (PROMO.test(subject)) add(-4, 'el asunto parece publicidad, boletín o encuesta');
  else if (PROMO.test(snippet)) add(-2, 'el texto parece publicidad');
  if (BULK_SENDER.test(local)) add(-3, 'lo envía una dirección de envíos masivos');

  const learned = senders[baseDomain(dom)];
  if (learned) add(learned, learned > 0 ? 'has guardado correos de este remitente' : 'has descartado correos de este remitente');

  const level = score >= 4 ? 'probable' : score >= 1 ? 'dudoso' : 'oculto';
  return { score, level, why };
}

const ORDER = { probable: 0, dudoso: 1, oculto: 2 };
// Anota cada correo con su puntuación y ordena: primero los probables y, dentro, los más nuevos.
export function rankMails(list, trip, senders) {
  return list.map(m => ({ ...m, ...scoreMail(m, trip, senders) }))
    .sort((a, b) => ORDER[a.level] - ORDER[b.level] || (b.date || '').localeCompare(a.date || ''));
}
