// Saca los datos de un gasto (importe, moneda, fecha, comercio y categoría) del texto de un ticket.
// Trabaja sobre texto que viene de un OCR, así que es tolerante con los errores típicos, y cada
// dato lleva su fiabilidad ('alta' | 'media' | 'baja') para que la pantalla marque lo que hay que revisar.
import { norm } from './util.js';

// ---------- Importe ----------
// Números con dos decimales, con o sin separador de miles: 42,00 · 1.234,56 · 1,234.56 · 7.5 no (un decimal no vale).
const AMOUNT = /(?<![\d.,])(\d{1,3}(?:[.,\s]\d{3})+[.,]\d{2}|\d+[.,]\d{2})(?![\d]|\s?%)/g;
export function toNumber(tok) {
  const m = String(tok).match(/^(.*)[.,](\d{2})$/);
  return m ? +`${m[1].replace(/[.,\s]/g, '')}.${m[2]}` : NaN;
}
const amountsIn = line => [...String(line).matchAll(AMOUNT)].map(m => toNumber(m[1])).filter(n => n > 0 && n < 1e6);

const TOTAL = /\b(total|importe|a pagar|amount due|balance due|grand total|totale|montant|gesamt|summe)\b/i;
const NOT_TOTAL = /subtotal|sub-total|cambio|entregado|recibido|efectivo|tendered|\bchange\b|propina|\btip\b|descuento|\bdto\b|base imponible|\bpuntos?\b/i;

function findAmount(lines) {
  const found = [];
  lines.forEach((l, i) => {
    if (!TOTAL.test(l) || NOT_TOTAL.test(l)) return;
    let a = amountsIn(l);
    if (!a.length && lines[i + 1] && !NOT_TOTAL.test(lines[i + 1])) a = amountsIn(lines[i + 1]);   // «TOTAL» y el importe en la línea de abajo
    for (const n of a) found.push({ n, strong: /\btotal\b/i.test(l) });
  });
  if (found.length) {
    // El total es lo más grande entre las líneas de «total» (el IVA y las bases son menores).
    const best = found.reduce((x, y) => (y.n > x.n ? y : x));
    return { value: best.n, conf: best.strong ? 'alta' : 'media' };
  }
  const all = lines.flatMap(l => (NOT_TOTAL.test(l) ? [] : amountsIn(l)));
  if (!all.length) return { value: null, conf: 'baja' };
  return { value: Math.max(...all), conf: all.length === 1 ? 'media' : 'baja' };
}

// ---------- Moneda ----------
const DOLLAR_LIKE = ['MXN', 'ARS', 'COP', 'CLP', 'CAD', 'AUD'];
const KRONA = ['SEK', 'NOK', 'DKK', 'ISK'];
function findCurrency(text, tripCur) {
  const iso = text.match(/\b(EUR|USD|GBP|CHF|JPY|MXN|ARS|COP|CLP|PEN|BRL|CAD|AUD|NOK|SEK|DKK|PLN|CZK|HUF|TRY|MAD|EGP|THB|CNY|INR|ISK)\b/);
  if (iso) return { value: iso[1], conf: 'alta' };
  if (/€|\beuros?\b/i.test(text)) return { value: 'EUR', conf: 'alta' };
  if (/£/.test(text)) return { value: 'GBP', conf: 'alta' };
  if (/R\$/.test(text)) return { value: 'BRL', conf: 'alta' };
  if (/\bzł\b|\bpln\b/i.test(text)) return { value: 'PLN', conf: 'alta' };
  if (/\bkč\b/i.test(text)) return { value: 'CZK', conf: 'alta' };
  if (/₺/.test(text)) return { value: 'TRY', conf: 'alta' };
  if (/฿/.test(text)) return { value: 'THB', conf: 'alta' };
  if (/\$/.test(text)) return { value: DOLLAR_LIKE.includes(tripCur) ? tripCur : 'USD', conf: 'media' };
  if (/¥/.test(text)) return { value: tripCur === 'CNY' ? 'CNY' : 'JPY', conf: 'media' };
  if (/\bkr\b/i.test(text) && KRONA.includes(tripCur)) return { value: tripCur, conf: 'media' };
  return { value: tripCur || 'EUR', conf: 'media', assumed: true };       // sin pistas: la moneda del viaje
}

// ---------- Fecha ----------
const MONTHS = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
const pad = n => String(n).padStart(2, '0');
function validDate(y, m, d) {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(y, m, 0).getDate()) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
function allDates(text) {
  // El OCR confunde la «O» con el 0 dentro de las fechas.
  const t = text.replace(/(?<=\d)[Oo](?=\d|[/.\-])|(?<=[/.\-])[Oo](?=\d)|(?<![A-Za-z0-9])[Oo](?=\d[/.\-])/g, '0');
  const out = [];
  for (const m of t.matchAll(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b/g)) {
    let d = +m[1], mo = +m[2], y = +m[3];
    if (m[3].length === 2) y += 2000;
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];         // formato americano
    const v = validDate(y, mo, d); if (v) out.push(v);
  }
  for (const m of t.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) { const v = validDate(+m[1], +m[2], +m[3]); if (v) out.push(v); }
  for (const m of t.matchAll(/\b(\d{1,2})\s*(?:de\s+)?(ene|jan|feb|mar|abr|apr|may|jun|jul|ago|aug|sep|set|oct|nov|dic|dec)[a-z]*\.?,?\s*(?:de\s+)?(\d{4}|\d{2})\b/gi)) {
    let y = +m[3]; if (m[3].length === 2) y += 2000;
    const v = validDate(y, MONTHS[m[2].toLowerCase()], +m[1]); if (v) out.push(v);
  }
  return out;
}
const dayNum = iso => Math.round(Date.parse(`${iso}T12:00:00Z`) / 86400000);

function findDate(text, trip, today) {
  const dates = allDates(text);
  if (!dates.length) return { value: null, conf: 'baja' };
  // Si el viaje tiene fechas, la que cae dentro (con unos días de margen) es casi seguro la buena.
  if (trip?.startDate) {
    const a = dayNum(trip.startDate) - 3, b = dayNum(trip.endDate || trip.startDate) + 3;
    const inside = dates.find(d => dayNum(d) >= a && dayNum(d) <= b);
    if (inside) return { value: inside, conf: 'alta' };
  }
  const recent = dates.find(d => dayNum(d) <= dayNum(today) + 1 && dayNum(d) >= dayNum(today) - 400);
  return { value: recent || dates[0], conf: 'media' };
}

// ---------- Comercio ----------
const SKIP_LINE = /ticket|factura|simplificada|\bcopia\b|cliente|\bc\.?i\.?f\b|\bn\.?i\.?f\b|tel[eé]?f|tfno|www\.|https?:|@|\bc\/|calle|\bavda?\b|avenida|plaza|\bpza\b|paseo|\bn[ºo°]\s*\d|fecha|\bhora\b|\bmesa\b|\bcaja\b|operador|camarero|gracias|bienvenid|\biva\b|total|\bdni\b|c\.p\.|\bcp\b\s*\d|\d{5}|^\W*$/i;
export function titleCase(s) {
  if (s !== s.toUpperCase()) return s;                               // solo si viene todo en mayúsculas
  // Las siglas con puntos (S.L., S.A.) se dejan como están.
  return s.split(/(\s+)/).map(w => (/^(?:\p{L}\.){2,}\p{L}?\.?$/u.test(w) ? w : w.toLowerCase().replace(/(^|[\-(])([a-záéíóúñü])/g, (_, p, c) => p + c.toUpperCase()).replace(/^[a-záéíóúñü]/, c => c.toUpperCase()))).join('');
}
function findMerchant(lines) {
  for (const raw of lines.slice(0, 10)) {
    const l = raw.replace(/[|_~*#=]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    const letters = (l.match(/\p{L}/gu) || []).length;
    if (letters < 3 || letters / l.length < 0.55 || SKIP_LINE.test(l)) continue;
    return { value: titleCase(l.replace(/^[^\p{L}\d]+|[^\p{L}\d.)]+$/gu, '')), conf: 'media' };
  }
  return { value: '', conf: 'baja' };
}

// ---------- Categoría ----------
// Cada categoría con palabras que suelen aparecer en el nombre del comercio o en el ticket.
export const CATEGORY_RULES = [
  ['alojamiento', /\b(hotel|hostal|hostel|apartament\w*|aparthotel|airbnb|booking|resort|pension|alojamiento|camping|parador|albergue)\b/],
  ['transporte', /\b(taxi|uber|cabify|bolt|gasolin\w*|combustible|repsol|cepsa|galp|shell|diesel|gasoil|peaje|autopista|parking|aparcamiento|renfe|ouigo|iryo|metro|autobus|bus|tranvia|ferry|trasmediterranea|balearia|aeropuerto|ryanair|vueling|iberia|easyjet|rent a car|hertz|avis|sixt|europcar|estacion de servicio|litros?)\b/],
  ['ocio', /\b(museo|museum|entradas?|cine|teatro|concierto|zoo|acuario|excursion|tour|visita guiada|catedral|alhambra|monumento|castillo|spa|balneario|discoteca|espectaculo|parque tematico|atraccion\w*)\b/],
  ['comida', /\b(restaurante|restaurant|bar|cafe|cafeteria|cerveceria|taberna|tasca|meson|pizzeria|pizza|trattoria|osteria|burger|kebab|bocadill\w*|panaderia|pasteleria|heladeria|gelateria|supermercado|mercadona|carrefour|lidl|aldi|alcampo|eroski|hipercor|tapas|menu|desayuno|cerveza|vino|brasa|asador|marisqueria|sushi|ramen|bodega|cocina|diner|coffee|breakfast|brunch|grill|pub|bistro|brasserie|bakery|deli|trattoria|ristorante|pizzeria)\b/],
  ['compras', /\b(tienda|zara|mango|primark|souvenirs?|recuerdos?|farmacia|boutique|libreria|decathlon|outlet|ropa|calzado|zapateria|joyeria|perfumeria|regalos?)\b/],
];
const count = (re, text) => (text.match(new RegExp(re.source, 'g')) || []).length;

// memory: { 'nombre del comercio normalizado': 'categoría' } — lo que la persona ya ha elegido antes.
export function categorize(merchant, body = '', memory = {}) {
  const key = norm(merchant);
  if (key && memory[key]) return { value: memory[key], source: 'memoria' };
  const m = norm(merchant), b = norm(body).split('\n').slice(0, 40).join('\n');
  let best = null, bestScore = 0;
  for (const [cat, re] of CATEGORY_RULES) {
    const s = count(re, m) * 3 + count(re, b);                      // el nombre del comercio pesa más que el cuerpo del ticket
    if (s > bestScore) { best = cat; bestScore = s; }
  }
  return best ? { value: best, source: 'reglas' } : { value: null, source: null };
}

// ---------- Todo junto ----------
export function parseReceipt(text, { trip = {}, memory = {}, today = new Date().toISOString().slice(0, 10) } = {}) {
  const clean = String(text || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
  const merchant = findMerchant(lines);
  return {
    amount: findAmount(lines),
    currency: findCurrency(clean, trip.budget?.currency),
    date: findDate(clean, trip, today),
    merchant,
    category: categorize(merchant.value, clean, memory),
  };
}
