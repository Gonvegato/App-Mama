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
      const win = text.slice(i, i + lab.length + 90);
      const m = win.match(DATE_RE);
      if (m) { const iso = parseDate(m[0]); if (iso) return iso; }
      i = low.indexOf(lab, i + 1);
    }
  }
  return '';
}

// Tipo de reserva a partir del texto (alojamiento, vuelo, tren…). Devuelve una clave de RES_KINDS o null.
// El alojamiento va primero porque los correos de hotel suelen incluir anuncios de vuelos o coches.
export function guessReservationKind(text) {
  const t = String(text || '').toLowerCase().replace(/ /g, ' ');
  const has = re => re.test(t);
  if (has(/\b(hotel|hostal|hostel|aparthotel|apartament(?:o|os)?|alojamiento|casa rural|caser[ií]o|agroturismo|pensi[oó]n|albergue|parador|guest\s?house|resort|bed and breakfast|habitaci[oó]n(?:es)?|check-?in|noches?)\b|booking\.com|airbnb/)) return 'hotel';
  if (has(/\b(vuelo|vuelos|flight|boarding pass|tarjeta de embarque|e-?ticket|aerol[ií]nea|puerta de embarque|localizador de vuelo)\b|iberia|ryanair|vueling|easyjet|air europa|lufthansa/)) return 'flight';
  if (has(/\b(tren|trenes|renfe|ouigo|iryo|ave|alta velocidad|rail|train|estaci[oó]n de tren)\b/)) return 'train';
  if (has(/\b(autob[uú]s|autocar)\b|\balsa\b|flixbus|blablabus/)) return 'bus';
  if (has(/\b(ferry|crucero|naviera)\b|balearia|trasmediterr[aá]nea/)) return 'ferry';
  if (has(/\b(alquiler de coche|coche de alquiler|rent a car|car rental|rental car)\b|europcar|\bhertz\b|\bavis\b|\bsixt\b|goldcar/)) return 'car';
  if (has(/\b(restaurante|restaurant|mesa para \d|reserva de mesa|men[uú] degustaci[oó]n)\b|thefork|the fork|opentable/)) return 'restaurant';
  if (has(/\b(entrada|entradas|ticket|tickets|museo|tour|excursi[oó]n|actividad|visita guiada|espect[aá]culo|concierto)\b/)) return 'activity';
  return null;
}

// Limpia el nombre del alojamiento: quita «el/la», prefijos y coletillas de confirmación y signos sueltos.
function cleanName(s) {
  if (!s) return s;
  let n = s.replace(/\s{2,}/g, ' ').trim();
  // Prefijo «Confirmación de (tu) reserva en/de/: …» → se queda con lo de después.
  n = n.replace(/^(?:la\s+)?confirmaci[oó]n\s+de\s+(?:tu\s+)?reserva\s*(?:en|de|:)?\s*/i, '');
  n = n.replace(/^confirmation of (?:your )?(?:booking|reservation)\s*(?:at|for|:)?\s*/i, '');
  // Coletilla «… está confirmada / is confirmed». Los PDF a veces parten las palabras
  // («con fi rmada»), así que se mira el final sin espacios para reconocerla.
  const tail = /\s+(est[aá]|is|was|has been|ya)(?=\s|$)([\s\S]*)$/i.exec(n);
  if (tail && /confirm|reserv|book/i.test(tail[2].replace(/\s+/g, ''))) n = n.slice(0, tail.index);
  n = n.replace(/[\s,.;:–-]+$/, '');
  n = n.replace(/^(el|la|los|las|the)\s+/i, '');
  return n.trim();
}

// ¿Es un título basura (una frase de confirmación/reserva, no el nombre real del sitio)?
const LODGING = /\b(hotel|hostal|hostel|apartament|apartamento|aparthotel|guest\s?house|casa|villa|resort|pensi[oó]n|albergue|lodge|suites?|parador|caser[ií]o|agroturismo|b&b)\b/i;
function looksLikeJunkName(s) {
  const n = (s || '').trim();
  if (n.length < 3) return true;
  if (LODGING.test(n)) return false;   // si nombra un tipo de alojamiento, lo damos por bueno
  // Empieza por (o es solo) palabras de reserva/confirmación/saludo sin nombre real.
  if (/^(confirmaci[oó]n|confirmation|reserva|booking|reservation|n[uú]mero|number|localizador|gracias|thank you|hola|hello|tu reserva|your (booking|reservation))\b/i.test(n)) return true;
  if (/^(de|tu|la|el|los|las|your|the|of)(\s+(de|tu|la|el|los|las|your|the|of|reserva|confirmaci[oó]n|booking|reservation|confirmad[oa]|confirmed))*$/i.test(n)) return true;
  return false;
}

// Analiza el texto de una reserva y devuelve los campos que encuentra con seguridad.
export function parseReservationDoc(text) {
  // Se juntan los espacios/tabuladores sobrantes (los PDF dejan huecos enormes) pero se conservan los saltos de línea.
  const t = String(text || '').replace(/ /g, ' ').replace(/[ \t]{2,}/g, ' ');
  const low = t.toLowerCase();
  const out = {};

  const kind = guessReservationKind(t);
  if (kind) out.kind = kind;

  const code = t.match(/(?:c[oó]digo de (?:reserva|confirmaci[oó]n)|n[uú]mero de (?:reserva|confirmaci[oó]n)|confirmation (?:number|code|no\.?)|booking (?:number|reference|ref\.?)|localizador|reservation (?:code|number)|confirmaci[oó]n|confirmation)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/i);
  if (code) out.code = code[1].toUpperCase().replace(/-+$/, '');

  const ci = dateNear(t, ['check-in', 'check in', 'entrada', 'llegada', 'arrival']);
  const co = dateNear(t, ['check-out', 'check out', 'salida', 'departure']);
  if (ci) out.start = ci;
  if (co) out.end = co;
  // Si NO hay ninguna etiqueta (ni entrada ni salida) pero sí dos fechas, se asumen entrada y salida.
  // Si alguna etiqueta sí apareció, nos fiamos solo de ellas: así no se cuela la fecha de envío del correo.
  if (!ci && !co) {
    const all = [...t.matchAll(DATE_RE)].map(m => parseDate(m[0])).filter(Boolean);
    const uniq = [...new Set(all)].sort();
    if (uniq[0]) out.start = uniq[0];
    if (uniq[1]) out.end = uniq[uniq.length - 1];
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

  // Dirección: el texto que aparece tras «Ubicación / Dirección / Localización / Address».
  // Es la dirección de verdad, así que se guarda tal cual y luego se usa para el mapa.
  const addr = t.match(/(?:ubicaci[oó]n|direcci[oó]n|localizaci[oó]n|address|location)\s*:?\s*([^\n]{5,120})(\n[^\n]{2,60})?/i);
  if (addr) {
    let a = addr[1].trim();
    if (addr[2] && /,\s*$/.test(a)) a += ' ' + addr[2].trim();   // une la segunda línea si la dirección venía partida
    a = a.replace(/\s{2,}/g, ' ').replace(/[,\s]+$/, '').trim();
    // Solo si parece una dirección de verdad (con número, coma o palabra de calle) y no un correo ni «en el mapa».
    if (a.length >= 5 && !/@/.test(a) && /\d|,|\b(c\/|calle|avda|avenida|plaza|pza|paseo|camino|carrer|r[uú]a|str\.?|street|road|rd\.?)\b/i.test(a) && !/\b(mapa|map|aqu[ií]|here)\b/i.test(a)) out.address = a;
  }

  if (/booking\.com/.test(low)) out.provider = 'Booking';
  else if (/airbnb/.test(low)) out.provider = 'Airbnb';
  else if (/expedia/.test(low)) out.provider = 'Expedia';
  else if (/hotels\.com/.test(low)) out.provider = 'Hotels.com';

  // Nombre del alojamiento: la línea cercana a «tu reserva en …» o la primera con palabra de alojamiento.
  const near = t.match(/(?:tu reserva en|your (?:booking|reservation) (?:at|for)|reserva en|estancia en)\s*[:]?\s*([^\n]{3,70})/i);
  if (near) out.name = cleanName(near[1]);
  // Si el nombre sigue sin salir o es basura (frase de confirmación/reserva), se busca
  // la primera línea con palabra de alojamiento.
  if (!out.name || looksLikeJunkName(out.name)) {
    out.name = undefined;
    for (const line of t.split('\n').map(s => s.trim()).slice(0, 30)) {
      if (line.length >= 4 && line.length <= 70 && LODGING.test(line) && !/booking\.com|airbnb|política|policy|cancel|confirmad/i.test(line)) { out.name = cleanName(line); break; }
    }
  }
  // Mejor sin nombre que con basura: si lo que quedó sigue siendo una frase de reserva, se descarta.
  if (out.name && looksLikeJunkName(out.name)) out.name = undefined;
  return out;
}
