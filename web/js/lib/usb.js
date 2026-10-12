// Modo USB (solo en el programa de Windows ejecutado desde un USB):
// copia automáticamente al USB todos los archivos de los viajes (los subidos y los enlazados)
// para abrirlos desde ahí, rápido y sin conexión. La nube sigue siendo el original.
import { state, fileBlob } from './store.js';
import { classifyLink, loadLink } from './links.js';
import { sleep } from './util.js';

const api = () => window.cuaderno?.usb;
const listeners = new Set();
export const usbState = { enabled: false, ready: false, index: {}, running: false, done: 0, total: 0, current: '', errors: 0, info: null, lastRun: null };
function emit(patch) { Object.assign(usbState, patch); listeners.forEach(l => l(usbState)); }
export function onUsb(l) { listeners.add(l); return () => listeners.delete(l); }

export async function initUsb() {
  if (!api()) return false;
  try {
    const info = await api().info();
    if (!info?.enabled) return false;
    const index = (await api().getIndex()) || {};
    emit({ enabled: true, ready: true, index, info });
    scheduleSync(3000);
    window.addEventListener('online', () => scheduleSync(2000));
    setInterval(() => scheduleSync(0), 15 * 60 * 1000);
    return true;
  } catch { return false; }
}

// ---------- Nombres de carpetas y archivos legibles ----------
const clean = s => String(s || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'Sin nombre';
// «2026-10 Otoño en Lisboa»: así las carpetas salen ordenadas por fecha.
function tripFolder(t) {
  const name = clean(t.title || t.destination || 'Viaje');
  return t.startDate ? `${t.startDate.slice(0, 7)} ${name}` : `Sin fecha - ${name}`;
}
function extFor(doc, mime) {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(doc.file || doc.path || '')?.[1];
  if (fromName) return fromName.toLowerCase();
  const m = (mime || doc.mime || '').toLowerCase();
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('jpeg')) return 'jpg';
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.startsWith('text/')) return 'txt';
  return 'bin';
}
const docKey = (t, d) => `${t.id}:${d.id}`;

function uniqueRel(folder, base, ext, key) {
  const taken = new Set(Object.entries(usbState.index).filter(([k]) => k !== key).map(([, v]) => v.rel.toLowerCase()));
  let rel = `${folder}/${base}.${ext}`, n = 2;
  while (taken.has(rel.toLowerCase())) rel = `${folder}/${base} (${n++}).${ext}`;
  return rel;
}

// Enlaces que tienen un archivo que se pueda guardar (no webs).
function linkSource(url) {
  const info = classifyLink(url);
  if (info.kind === 'file' || info.kind === 'pcloud') return info;
  if (info.kind === 'embed' && /drive\.google\.com\/file\/d\/([^/]+)/.test(info.src)) {
    const id = /\/file\/d\/([^/]+)/.exec(info.src)[1];
    return { kind: 'file', src: `https://drive.google.com/uc?export=download&id=${id}`, service: 'Google Drive' };
  }
  return null;
}

// Copia local de un documento, si existe: dirección para abrirlo dentro del programa.
export function localUrl(trip, doc) {
  if (!usbState.enabled) return null;
  const e = usbState.index[docKey(trip, doc)];
  if (!e) return null;
  return `app://cuaderno/__usb/${e.rel.split('/').map(encodeURIComponent).join('/')}`;
}
export function localEntry(trip, doc) { return usbState.enabled ? usbState.index[docKey(trip, doc)] || null : null; }
// Comprueba que la copia sigue en el USB (alguien podría haberla borrado desde el Explorador).
export async function getLocal(trip, doc) {
  const e = localEntry(trip, doc);
  if (!e) return null;
  const size = await api().stat(e.rel).catch(() => null);
  if (size == null) { delete usbState.index[docKey(trip, doc)]; saveIndex(); emit({}); scheduleSync(); return null; }
  return { url: localUrl(trip, doc), rel: e.rel, size };
}
export const openUsbFolder = rel => api()?.open(rel || null);

let timer = null;
export function scheduleSync(ms = 4000) {
  if (!usbState.enabled) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncUsb(), ms);
}

let saveTimer;
function saveIndex() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api().setIndex(usbState.index).catch(() => {}), 400);
}

export async function syncUsb() {
  if (!usbState.enabled || usbState.running || state.phase !== 'ready') return;
  const work = [];
  const alive = new Set();
  for (const t of state.trips) {
    for (const d of t.docs) {
      const key = docKey(t, d);
      alive.add(key);
      const e = usbState.index[key];
      const source = d.path ? { type: 'file', path: d.path } : d.url ? linkSource(d.url) && { type: 'link', url: d.url } : null;
      if (!source) continue;
      const sig = d.path || d.url;
      if (e && e.sig === sig && e.folder === tripFolder(t)) continue;
      work.push({ t, d, key, source, sig, old: e });
    }
  }
  // Archivos de documentos que ya no existen.
  const orphans = Object.keys(usbState.index).filter(k => !alive.has(k));
  emit({ running: true, done: 0, total: work.length, errors: 0, current: '' });
  try {
    for (const k of orphans) {
      try { await api().remove(usbState.index[k].rel); } catch { /* ya no estaba */ }
      delete usbState.index[k];
    }
    if (orphans.length) saveIndex();
    for (const [i, w] of work.entries()) {
      emit({ current: w.d.name, done: i });
      if (!navigator.onLine) break;
      try {
        const folder = tripFolder(w.t);
        if (w.old && w.old.sig === w.sig && w.old.folder !== folder) {
          const rel = uniqueRel(folder, w.old.rel.split('/').pop().replace(/\.[^.]+$/, ''), w.old.rel.split('.').pop(), w.key);
          if (await api().move(w.old.rel, rel)) {
            usbState.index[w.key] = { ...w.old, rel, folder };
            saveIndex();
            continue;
          }
        }
        let blob, mime;
        if (w.source.type === 'file') { blob = await fileBlob(w.source.path); mime = blob.type || w.d.mime; }
        else {
          const r = await loadLink(w.d.url, linkSource(w.d.url), { store: false });
          if (!r.blob || r.type === 'html') throw new Error('No es un archivo');
          blob = r.blob; mime = r.blob.type;
        }
        const rel = w.old && w.old.folder === folder && w.old.sig === w.sig ? w.old.rel : uniqueRel(folder, clean(w.d.name), extFor(w.d, mime), w.key);
        await api().write(rel, await blob.arrayBuffer());
        if (w.old && w.old.rel !== rel) { try { await api().remove(w.old.rel); } catch { /* nada */ } }
        usbState.index[w.key] = { rel, sig: w.sig, folder, size: blob.size, at: new Date().toISOString() };
        saveIndex();
      } catch {
        emit({ errors: usbState.errors + 1 });
      }
      await sleep(30);
    }
  } finally {
    const info = await api().info().catch(() => usbState.info);
    emit({ running: false, done: usbState.total, current: '', lastRun: new Date().toISOString(), info });
  }
}

export function usbTotals() {
  const entries = Object.values(usbState.index);
  return { count: entries.length, bytes: entries.reduce((a, e) => a + (e.size || 0), 0) };
}
