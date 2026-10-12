// Lee el texto de un PDF de reserva y saca los datos (fechas, código, precio, nombre…).
// Es una ayuda: rellena lo que encuentra con seguridad y el resto se pone a mano.
// Solo PDF con texto; de una foto o un PDF escaneado no se puede leer sin conexión.

const base = p => new URL(`../../vendor/pdfjs/${p}`, import.meta.url).href;
let libPromise;
function loadPdfJs() {
  if (!libPromise) libPromise = import(base('pdf.min.mjs')).then(lib => {
    lib.GlobalWorkerOptions.workerSrc = base('pdf.worker.min.mjs');
    return lib;
  }).catch(e => { libPromise = null; throw e; });
  return libPromise;
}

export async function extractPdfText(blob, maxPages = 5) {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const task = lib.getDocument({ data, isEvalSupported: false, enableXfa: false, cMapUrl: base('cmaps/'), cMapPacked: true, standardFontDataUrl: base('standard_fonts/'), wasmUrl: base('wasm/'), iccUrl: base('iccs/') });
  const doc = await task.promise;
  let text = '';
  const n = Math.min(doc.numPages, maxPages);
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const c = await page.getTextContent();
    let last = null, line = '';
    for (const it of c.items) {
      const y = it.transform?.[5];
      if (last != null && Math.abs(y - last) > 3) { text += line.trim() + '\n'; line = ''; }
      line += it.str + (it.hasEOL ? '\n' : ' ');
      last = y;
    }
    text += line.trim() + '\n';
  }
  try { await doc.destroy?.(); } catch { /* nada */ }
  try { await task.destroy?.(); } catch { /* nada */ }
  return text;
}

const MONTHS = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
const pad = n => String(n).padStart(2, '0');

// Convierte una fecha suelta a «AAAA-MM-DD». Acepta 2026-10-15, 15/10/2026, «15 oct 2026», «15 de octubre de 2026».
export function parseDate(s) {
  if (!s) return '';
  s = String(s).trim();
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/);
  if (m) { let [, d, mo, y] = m; if (y.length === 2) y = '20' + y; if (+mo > 12 && +d <= 12) [d, mo] = [mo, d]; return `${y}-${pad(+mo)}-${pad(+d)}`; }
  m = s.match(/\b(\d{1,2})\s+(?:de\s+)?([a-záéíóú]{3,})\.?\s+(?:de\s+)?(\d{4})\b/i);
  if (m) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')]; if (mo) return `${m[3]}-${pad(mo)}-${pad(+m[1])}`; }
  m = s.match(/\b([a-záéíóú]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})\b/i); // «Oct 15, 2026»
  if (m) { const mo = MONTHS[m[1].slice(0, 3).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')]; if (mo) return `${m[3]}-${pad(mo)}-${pad(+m[2])}`; }
  return '';
}

const DATE_RE = /(\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{1,2}\s+(?:de\s+)?[a-záéíóú]{3,}\.?\s+(?:de\s+)?\d{4}|[a-záéíóú]{3,}\.?\s+\d{1,2},?\s+\d{4})/gi;

function dateNear(text, labels) {
  const low = text.toLowerCase();
  for (const lab of labels) {
    let i = low.indexOf(lab);
    while (i >= 0) {
      const win = text.slice(i, i + lab.length + 60);
      const m = win.match(DATE_RE);
      if (m) { const iso = parseDate(m[0]); if (iso) return iso; }
      i = low.indexOf(lab, i + 1);
    }
  }
  return '';
}

// Analiza el texto de una reserva y devuelve los campos que encuentra con seguridad.
export function parseReservationDoc(text) {
  const t = String(text || '').replace(/ /g, ' ');
  const low = t.toLowerCase();
  const out = {};

  const code = t.match(/(?:c[oó]digo de (?:reserva|confirmaci[oó]n)|confirmation (?:number|code|no\.?)|n[uú]mero de confirmaci[oó]n|booking (?:number|reference|ref\.?)|localizador|reservation (?:code|number))\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/i);
  if (code) out.code = code[1].toUpperCase().replace(/-+$/, '');

  const ci = dateNear(t, ['check-in', 'check in', 'entrada', 'llegada', 'arrival']);
  const co = dateNear(t, ['check-out', 'check out', 'salida', 'departure']);
  if (ci) out.start = ci;
  if (co) out.end = co;
  // Si no hay etiquetas pero sí dos fechas, se asumen entrada y salida (orden del documento).
  if (!ci || !co) {
    const all = [...t.matchAll(DATE_RE)].map(m => parseDate(m[0])).filter(Boolean);
    const uniq = [...new Set(all)].sort();
    if (!out.start && uniq[0]) out.start = uniq[0];
    if (!out.end && uniq[1]) out.end = uniq[uniq.length - 1];
  }

  const price = t.match(/(?:precio total|total(?:\s+a pagar|\s+price|\s+amount)?|importe(?:\s+total)?|amount)\s*[:]?\s*(?:([€$£])\s?)?(\d[\d.,]*)\s?(eur|usd|gbp|€|\$|£)?/i);
  if (price) {
    const raw = price[2].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    const amount = parseFloat(raw);
    if (isFinite(amount) && amount > 0) {
      out.price = amount;
      const cur = (price[1] || price[3] || '').toLowerCase();
      out.currency = cur === '€' || cur === 'eur' ? 'EUR' : cur === '$' || cur === 'usd' ? 'USD' : cur === '£' || cur === 'gbp' ? 'GBP' : null;
    }
  }

  const phone = t.match(/(?:tel[eé]fono|phone|tel\.?)\s*[:]?\s*(\+?[\d][\d\s()-]{6,}\d)/i);
  if (phone) out.phone = phone[1].trim();

  if (/booking\.com/.test(low)) out.provider = 'Booking';
  else if (/airbnb/.test(low)) out.provider = 'Airbnb';
  else if (/expedia/.test(low)) out.provider = 'Expedia';
  else if (/hotels\.com/.test(low)) out.provider = 'Hotels.com';

  // Nombre del alojamiento: la línea cercana a «tu reserva en …» o la primera con palabra de alojamiento.
  const near = t.match(/(?:tu reserva en|your (?:booking|reservation) (?:at|for)|reserva en|estancia en)\s*[:]?\s*([^\n]{3,70})/i);
  if (near) out.name = near[1].trim().replace(/\s{2,}/g, ' ');
  if (!out.name) {
    for (const line of t.split('\n').map(s => s.trim()).slice(0, 25)) {
      if (line.length >= 4 && line.length <= 70 && /\b(hotel|hostal|hostel|apartament|apartment|apartamento|aparthotel|guesthouse|casa|villa|resort|b&b|bed (and|&) breakfast|pensi[oó]n|albergue|lodge|suites?)\b/i.test(line) && !/booking\.com|airbnb|política|policy|cancel/i.test(line)) { out.name = line; break; }
    }
  }
  return out;
}
