// Interpreta el texto de un aviso de pago del móvil (notificación del banco, de Google Wallet,
// de Apple Wallet…) y saca el importe, la moneda y el comercio.
// OJO: cada banco redacta sus avisos a su manera. Esto reconoce las formas habituales, y lo que
// no entiende NO se inventa: se devuelve como «sin-leer» para que lo vea la persona.
import { titleCase } from './receipt-parse.js';

const SYM = '€|EUR|euros?|USD|US\\$|\\$|£|GBP|CHF|JPY|¥|MXN|ARS|COP|CLP|PEN|BRL|CAD|AUD|NOK|SEK|DKK|PLN|CZK|HUF|TRY|MAD|EGP|THB|CNY|INR|ISK';
const NUM = '\\d{1,3}(?:[.,\\s]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';
const SYM_TO_ISO = { '€': 'EUR', euro: 'EUR', euros: 'EUR', '$': 'USD', 'us$': 'USD', '£': 'GBP', '¥': 'JPY' };
const isoOf = s => { const k = s.toLowerCase(); return SYM_TO_ISO[k] || s.toUpperCase(); };

// «1.234,56» · «1,234.56» · «25,5» · «25» → número
export function toAmount(tok) {
  const t = String(tok).replace(/\s/g, '');
  const lastC = t.lastIndexOf(','), lastD = t.lastIndexOf('.');
  if (lastC >= 0 && lastD >= 0) return +(lastC > lastD ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''));
  const sep = lastC >= 0 ? ',' : lastD >= 0 ? '.' : '';
  if (!sep) return +t;
  const parts = t.split(sep);
  // «1.234» → miles; «25,5» y «25,50» → decimales
  return parts.length > 2 || (parts[1].length === 3 && parts[0].length <= 3) ? +parts.join('') : +`${parts[0]}.${parts[1]}`;
}

const AFTER = new RegExp(`(?<![\\d.,])(-?)(${NUM})\\s?(${SYM})(?![A-Za-z])`, 'gi');
const BEFORE = new RegExp(`(?<![A-Za-z])(${SYM})\\s?(-?)(${NUM})(?!\\d)`, 'gi');
const HAS_MONEY = new RegExp(`(?:${NUM})\\s?(?:${SYM})(?![A-Za-z])|(?<![A-Za-z])(?:${SYM})\\s?-?(?:${NUM})`, 'i');
const SALDO = /saldo|balance|disponible|available|l[ií]mite|limit|restante|remaining/i;

// Importes con moneda, por orden de aparición, sin los que son un saldo o un límite.
function amountsWithCurrency(text) {
  const out = [];
  for (const m of text.matchAll(AFTER)) out.push({ i: m.index, end: m.index + m[0].length, n: toAmount(m[2]), cur: isoOf(m[3]) });
  for (const m of text.matchAll(BEFORE)) out.push({ i: m.index, end: m.index + m[0].length, n: toAmount(m[3]), cur: isoOf(m[1]) });
  out.sort((a, b) => a.i - b.i);
  // Un «saldo» o «límite» solo descarta el importe que viene justo detrás, no los de otras frases.
  return out.filter((a, k) => {
    const from = Math.max(k ? out[k - 1].end : 0, a.i - 30);
    const ctx = text.slice(from, a.i).split(/[·|\n;]/).pop();
    return a.n > 0 && a.n < 1e6 && !SALDO.test(ctx);
  });
}

const NOT_PAYMENT = /\b(has recibido|ha recibido|recibiste|te han (enviado|ingresado|transferido)|has ingresado|ingreso (recibido|de)|abono|n[oó]mina|devoluci[oó]n|reembolso|bizum recibido|transferencia recibida|received|refund(ed)?|deposit(ed)?|cashback)\b/i;
const FAILED = /\b(rechazad[oa]|denegad[oa]|no se ha (podido|completado)|declined|failed|insufficient|insuficiente|cancelad[oa])\b/i;
const PAY_WORDS = /\b(pago|pagado|has pagado|compra|cargo|cobro|gasto|payment|paid|purchase|charged|spent|transacci[oó]n|transaction|tarjeta|card|apple pay|google pay|wallet)\b/i;

// Dónde termina el nombre de un comercio.
const TERM = String.raw`(?=\s*(?:$|[\n|·;,()]|\.(?:\s|$)|\s(?:con|with|using|mediante|desde|el|on|tarjeta|card|terminad\w*|ending|saldo|balance|fecha|a las|at)\b|\s[-–—]\s|\*{2,}|\s\d{4}\b))`;
const MERCH = String.raw`([^\n|·;,()]{2,48}?)`;
const BAD_MERCHANT = /^(tu|su|la|el|los|las|una?|your|the|ti)\b\s*(tarjeta|cuenta|card|account)?|^(tarjeta|cuenta|card|account|apple pay|google pay|wallet)\b|^\W*\d[\d\s*·.-]*$/i;

function cleanMerchant(raw) {
  let m = String(raw || '').replace(/^[\s"'«“-]+|[\s"'»”.:-]+$/g, '').replace(/\s{2,}/g, ' ');
  if ((m.match(/\p{L}/gu) || []).length < 3 || BAD_MERCHANT.test(m) || PAY_WORDS.test(m) && m.length < 12) return '';
  if (m === m.toUpperCase()) m = titleCase(m.replace(/\s+(ES|ESP|FR|IT|PT|DE|GB|UK|US|USA|NL|BE|CH|AT|IE)$/, ''));
  return m;
}

function findMerchant(text, amt) {
  // 1) justo después del importe: «25,00 € en PICHON ROJO»
  const after = text.slice(amt.end).match(new RegExp(String.raw`^\s*(?:en|at|a|to|@|-|–|—|·|:)\s+${MERCH}${TERM}`, 'i'));
  if (after && cleanMerchant(after[1])) return cleanMerchant(after[1]);
  // 2) «Has pagado en PICHON ROJO 25,00 €» / «Purchase at PICHON ROJO»
  const before = text.slice(0, amt.i).match(new RegExp(String.raw`(?:pago|pagado|compra|cargo|cobro|gasto|payment|purchase|paid|charged|spent)\b[^\n|]{0,60}?\b(?:en|at|a|to)\s+${MERCH}\s*[:\-–—]?\s*$`, 'i'));
  if (before && cleanMerchant(before[1])) return cleanMerchant(before[1]);
  // 3) estilo Wallet: «PICHON ROJO | 25,00 €», «PICHON ROJO · 25,00 €» o en otra línea
  for (const part of text.split(/\n|\||·|–|—|\s-\s/).map(x => x.trim())) {
    if (!part || PAY_WORDS.test(part) || HAS_MONEY.test(part)) continue;
    const m = cleanMerchant(part);
    if (m) return m;
  }
  return '';
}

// Devuelve { kind: 'pago' | 'ignorado' | 'sin-leer', amount?, currency?, merchant?, reason? }
export function parsePayment(raw) {
  const text = String(raw || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!text) return { kind: 'sin-leer', reason: 'vacío' };
  if (FAILED.test(text)) return { kind: 'ignorado', reason: 'pago rechazado o cancelado' };
  if (NOT_PAYMENT.test(text) && !/\b(has pagado|pago de|compra de|you paid|purchase)\b/i.test(text)) return { kind: 'ignorado', reason: 'no es un pago (dinero recibido o devolución)' };
  const amt = amountsWithCurrency(text)[0];
  if (!amt) return { kind: 'sin-leer', reason: 'no encuentro el importe' };
  const merchant = findMerchant(text, amt);
  if (!PAY_WORDS.test(text) && !merchant) return { kind: 'sin-leer', reason: 'no parece un pago' };
  return { kind: 'pago', amount: amt.n, currency: amt.cur, merchant };
}

// ---------- ¿Estás de viaje? ----------
// Viaje que está en marcha en ese día (de la fecha de salida a la de vuelta, ambas incluidas).
// Si coinciden varios, el que salió más tarde. Los archivados no cuentan.
export function tripOn(trips, day) {
  const on = trips.filter(t => !t.archived && t.startDate && t.startDate <= day && day <= (t.endDate || t.startDate));
  return on.sort((a, b) => b.startDate.localeCompare(a.startDate))[0] || null;
}
