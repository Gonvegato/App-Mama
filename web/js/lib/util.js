// Utilidades generales: identificadores, fechas, formato y pequeñas ayudas.

export const uid = () => {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

export const sid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));

export const cx = (...a) => a.filter(Boolean).join(' ');

export function debounce(fn, ms = 300) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); fn(...args); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- Fechas ----------
// Las fechas se guardan como 'AAAA-MM-DD' y las horas como 'AAAA-MM-DDTHH:mm' (hora local del sitio).

export const pad = n => String(n).padStart(2, '0');

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}

export const dateOnly = s => (s ? String(s).slice(0, 10) : '');
export const timeOnly = s => (s && String(s).length >= 16 ? String(s).slice(11, 16) : '');

export function addDays(iso, n) {
  const d = parseDate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + n);
  return todayISO(d);
}

export function daysBetween(a, b) {
  const da = parseDate(a), db = parseDate(b);
  if (!da || !db) return 0;
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((ub - ua) / 86400000);
}

export function eachDay(start, end) {
  const out = [];
  if (!start) return out;
  const last = end && end >= start ? end : start;
  let cur = start, guard = 0;
  while (cur <= last && guard++ < 400) { out.push(cur); cur = addDays(cur, 1); }
  return out;
}

const LOCALE = 'es-ES';
const fmtCache = new Map();
function fmt(opts) {
  const k = JSON.stringify(opts);
  if (!fmtCache.has(k)) fmtCache.set(k, new Intl.DateTimeFormat(LOCALE, opts));
  return fmtCache.get(k);
}

export function fmtDate(iso, style = 'medium') {
  const d = parseDate(iso);
  if (!d) return '';
  if (style === 'short') return fmt({ day: 'numeric', month: 'short' }).format(d).replace('.', '');
  if (style === 'weekday') return cap(fmt({ weekday: 'short', day: 'numeric', month: 'short' }).format(d).replace(/\./g, ''));
  if (style === 'long') return cap(fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d));
  if (style === 'daylong') return cap(fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(d));
  if (style === 'month') return cap(fmt({ month: 'long', year: 'numeric' }).format(d));
  return fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(d).replace('.', '');
}

export function fmtRange(a, b) {
  if (!a) return 'Sin fechas';
  const da = parseDate(a), db = parseDate(b || a);
  if (!b || a === b) return fmtDate(a);
  const sameYear = da.getFullYear() === db.getFullYear();
  const sameMonth = sameYear && da.getMonth() === db.getMonth();
  if (sameMonth) return `${da.getDate()}–${db.getDate()} ${fmt({ month: 'short', year: 'numeric' }).format(db).replace('.', '')}`;
  if (sameYear) return `${fmtDate(a, 'short')} – ${fmtDate(b)}`;
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}

export function fmtTime(s) { return timeOnly(s); }

export function fmtDateTime(s) {
  if (!s) return '';
  const t = timeOnly(s);
  return t ? `${fmtDate(dateOnly(s), 'weekday')} · ${t}` : fmtDate(dateOnly(s), 'weekday');
}

export const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

// Estado temporal de un viaje respecto a hoy.
export function tripStatus(trip, today = todayISO()) {
  const s = trip.startDate, e = trip.endDate || trip.startDate;
  if (!s) return { kind: 'nodate', label: 'Sin fechas' };
  if (today < s) {
    const n = daysBetween(today, s);
    return { kind: 'upcoming', days: n, label: n === 1 ? 'Mañana' : `Faltan ${n} días` };
  }
  if (today > e) {
    const n = daysBetween(e, today);
    let label;
    if (n < 31) label = n === 1 ? 'Terminó ayer' : `Hace ${n} días`;
    else if (n < 365) { const m = Math.round(n / 30.4); label = m === 1 ? 'Hace un mes' : `Hace ${m} meses`; }
    else { const y = Math.floor(n / 365); label = y === 1 ? 'Hace un año' : `Hace ${y} años`; }
    return { kind: 'past', days: n, label };
  }
  const total = daysBetween(s, e) + 1, cur = daysBetween(s, today) + 1;
  return { kind: 'now', day: cur, total, label: `Día ${cur} de ${total}` };
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 6) return 'Buenas noches';
  if (h < 13) return 'Buenos días';
  if (h < 21) return 'Buenas tardes';
  return 'Buenas noches';
}

// ---------- Números y dinero ----------
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'MXN', 'ARS', 'COP', 'CLP', 'PEN', 'BRL', 'CAD', 'AUD', 'NOK', 'SEK', 'DKK', 'PLN', 'CZK', 'HUF', 'TRY', 'MAD', 'EGP', 'THB', 'CNY', 'INR', 'ISK'];

export function fmtMoney(amount, currency = 'EUR') {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export function parseAmount(s) {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  let t = String(s).trim().replace(/[^\d,.-]/g, '');
  if (t.includes(',') && t.includes('.')) {
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
  } else if (t.includes(',')) t = t.replace(',', '.');
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}

export function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

// ---------- Texto ----------
export const norm = s => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function matches(q, ...fields) {
  const nq = norm(q);
  if (!nq) return true;
  const hay = norm(fields.filter(Boolean).join(' '));
  return nq.split(/\s+/).every(w => hay.includes(w));
}

export function hashHue(str) {
  let h = 0;
  for (const c of String(str || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function linkify(text) {
  return String(text || '');
}

export function isUrl(s) { return /^https?:\/\/\S+$/i.test((s || '').trim()); }

export function fileExt(name) { const m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name || 'archivo';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function base64ToBlob(b64, mime = 'application/octet-stream') {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function safeFileName(name) {
  return (name || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(-120);
}
