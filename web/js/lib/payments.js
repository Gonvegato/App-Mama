// Pagos automáticos: los avisos de pago del móvil llegan a un buzón en la nube (tabla «pagos»
// de Supabase) y esta pieza los recoge, y si es durante un viaje, los apunta como gasto.
//  · Una app del móvil (Tasker, MacroDroid, Atajos del iPhone) manda el texto de cada aviso.
//    La app web no puede leer las notificaciones del móvil por sí sola: no hay permiso para ello.
//  · Solo se apunta lo que se entiende como un pago y cae dentro de las fechas de un viaje. El resto
//    queda en el registro de Ajustes para que la persona lo vea; no se pierde nada en silencio.
import { state, getBackend, getConfig, updateTrip, getTrip, toast, saveSettings, LS } from './store.js';
import { parsePayment, tripOn } from './payment-parse.js';
export { tripOn };
import { categorize } from './receipt-parse.js';
import { EXPENSE_CATS } from './model.js';
import { sid, norm, todayISO, fmtMoney } from './util.js';

const LOG_KEY = 'cv-pagos-log';
const KEEP_DAYS = 14;

// ---------- Código secreto y datos para configurar el móvil ----------
export const paymentsToken = () => state.settings?.pagosToken || '';
export const paymentsEnabled = () => state.mode === 'cloud' && !!paymentsToken();

export async function enablePayments() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  await saveSettings({ pagosToken: [...bytes].map(b => b.toString(16).padStart(2, '0')).join('') });
}
export const disablePayments = () => saveSettings({ pagosToken: '' });

// Datos que hay que poner en la app de automatización del móvil.
export function paymentsSetup() {
  const cfg = getConfig() || {};
  const key = cfg.key || '';
  const legacy = key.startsWith('eyJ');            // clave antigua (JWT): además va en Authorization
  const base = `${(cfg.url || '').replace(/\/$/, '')}/rest/v1/rpc`;
  return {
    urlText: `${base}/recibir_pago`, urlJson: `${base}/recibir_pago_json`,
    headersText: [`apikey: ${key}`, ...(legacy ? [`Authorization: Bearer ${key}`] : []), `x-token: ${paymentsToken()}`, 'Content-Type: text/plain'],
    headersJson: [`apikey: ${key}`, ...(legacy ? [`Authorization: Bearer ${key}`] : []), `x-token: ${paymentsToken()}`, 'Content-Type: application/json'],
  };
}

// ---------- Registro de lo recibido (solo en este dispositivo) ----------
export const getPaymentLog = () => LS.get(LOG_KEY, []).filter(e => Date.now() - Date.parse(e.at) < KEEP_DAYS * 86400000);
function addLog(entry) {
  LS.set(LOG_KEY, [{ ...entry, at: entry.at || new Date().toISOString() }, ...getPaymentLog()].slice(0, 40));
  listeners.forEach(l => l());
}
const listeners = new Set();
export const onPaymentsChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

// ---------- Un aviso → gasto ----------
export function handlePayment(row) {
  const text = row.texto;
  const base = { texto: text.slice(0, 160), recibido: row.recibido };
  // Los avisos de prueba (botón «Probar») se leen, para comprobar que se entienden, pero no se apuntan.
  if (/^PRUEBA\b/.test(text)) {
    const t = parsePayment(text.replace(/^PRUEBA\s*[·:-]?\s*/, ''));
    return { ...base, estado: 'prueba', importe: t.amount, moneda: t.currency, comercio: t.merchant, motivo: t.kind === 'pago' ? '' : 'no se entiende el texto' };
  }
  const p = parsePayment(text);
  if (p.kind === 'ignorado') return { ...base, estado: 'ignorado', motivo: p.reason };
  if (p.kind === 'sin-leer') return { ...base, estado: 'sin-leer', motivo: p.reason };
  const day = todayISO(new Date(row.recibido));
  const trip = tripOn(state.trips, day);
  if (!trip) return { ...base, estado: 'sin-viaje', importe: p.amount, moneda: p.currency, comercio: p.merchant };

  const memory = state.settings?.merchantCats || {};
  const name = p.merchant || 'Pago con tarjeta';
  // El mismo pago puede avisar dos veces (autorización y cargo): si ya está apuntado, no se repite.
  const t0 = Date.parse(row.recibido);
  const dup = trip.expenses.find(e => e.source === 'notificacion' && e.amount === p.amount && norm(e.text) === norm(name) && Math.abs(Date.parse(e.detectedAt) - t0) < 10 * 60000);
  if (dup) return { ...base, estado: 'repetido', tripId: trip.id, importe: p.amount, comercio: name };

  const exp = {
    id: sid(), text: name, amount: p.amount, currency: p.currency || trip.budget?.currency || 'EUR',
    category: categorize(p.merchant, text, memory).value || 'otros', date: day,
    // Con un solo viajero se sabe quién pagó; con varios, no: se deja sin asignar para que lo ponga la persona.
    paidBy: trip.travelers.length === 1 ? trip.travelers[0] : '', split: true,
    source: 'notificacion', detectedAt: row.recibido, raw: text.slice(0, 300),
  };
  updateTrip(trip.id, t => { t.expenses.push(exp); });
  return { ...base, estado: 'añadido', tripId: trip.id, expenseId: exp.id, importe: exp.amount, moneda: exp.currency, comercio: name };
}

export function undoPayment(tripId, expenseId) {
  if (!getTrip(tripId)) return;
  updateTrip(tripId, t => { t.expenses = t.expenses.filter(e => e.id !== expenseId); });
  const log = getPaymentLog().map(e => (e.expenseId === expenseId ? { ...e, estado: 'deshecho' } : e));
  LS.set(LOG_KEY, log);
  listeners.forEach(l => l());
}

// ---------- Recoger el buzón ----------
let running = false;
export let lastMailboxError = null;
// Devuelve cuántos avisos se han procesado.
export async function processPayments() {
  if (running || !paymentsEnabled() || !navigator.onLine || state.phase !== 'ready') return 0;
  const sb = getBackend()?.sb;
  if (!sb) return 0;
  running = true;
  let n = 0;
  try {
    const { data: rows, error } = await sb.from('pagos').select('id,texto,recibido').order('recibido', { ascending: true }).limit(50);
    if (error) { lastMailboxError = error.message || String(error); return 0; }
    lastMailboxError = null;
    for (const row of rows || []) {
      // Se «reclama» el aviso borrándolo: si otro dispositivo se lo ha llevado antes, aquí no devuelve nada.
      const { data: gone } = await sb.from('pagos').delete().eq('id', row.id).select('id');
      if (!gone?.length) continue;
      const entry = handlePayment(row);
      addLog(entry);
      n++;
      if (entry.estado === 'añadido') {
        toast(`Gasto apuntado: ${entry.comercio} · ${fmtMoney(entry.importe, entry.moneda)}`, 'ok', { ms: 9000, actionLabel: 'Deshacer', action: () => undoPayment(entry.tripId, entry.expenseId) });
      } else if (entry.estado === 'sin-leer' && tripOn(state.trips, todayISO())) {
        toast('Ha llegado un aviso de pago que no he sabido leer. Míralo en Ajustes → Pagos automáticos.', 'info', { ms: 8000 });
      }
    }
  } catch (e) { lastMailboxError = e.message || String(e); }
  finally { running = false; }
  return n;
}

// Manda un aviso de prueba por el mismo camino que usará el móvil y lo recoge.
// Devuelve la entrada del registro, o lanza un error que dice qué falla.
export async function sendTestPayment(text = 'PRUEBA · Pago de 1,23 € en Prueba de la app') {
  const s = paymentsSetup();
  const h = Object.fromEntries(s.headersText.map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  let r;
  try { r = await fetch(s.urlText, { method: 'POST', headers: h, body: text }); }
  catch { throw new Error('No se pudo contactar con el servidor. Revisa la conexión.'); }
  if (!r.ok) {
    if (r.status === 404) throw new Error('El servidor no tiene el buzón. Ejecuta de nuevo el script backend/supabase.sql en el panel de Supabase.');
    throw new Error(`El servidor respondió ${r.status}. ${(await r.text()).slice(0, 120)}`);
  }
  // La función no avisa si el código es falso (a propósito): se comprueba mirando si el aviso llega.
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    await processPayments();
    const e = getPaymentLog().find(x => x.texto === text && Date.parse(x.at) >= t0 - 1000);
    if (e) return e;
    await new Promise(res => setTimeout(res, 800));
  }
  if (lastMailboxError) throw new Error(`No se pudo leer el buzón: ${lastMailboxError}. ¿Has ejecutado el script SQL?`);
  throw new Error('El aviso no ha llegado. Comprueba que el código de la cabecera x-token es el de esta pantalla.');
}

export function startPaymentSync() {
  const tick = () => { if (document.visibilityState === 'visible') processPayments(); };
  window.addEventListener('online', () => setTimeout(tick, 1500));
  document.addEventListener('visibilitychange', tick);
  setTimeout(tick, 3500);
  setInterval(tick, 60000);
}
