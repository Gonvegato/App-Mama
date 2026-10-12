// Estado global de la app, sincronización con el almacenamiento y cola sin conexión.
import { useEffect, useState } from '../../vendor/preact-htm.js';
import { LocalBackend, CloudBackend, niceError } from './backend.js';
import { normalizeTrip, newTrip, tripFilePaths } from './model.js';
import { clone, uid, sid, safeFileName, fileExt } from './util.js';

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nada */ } },
};
export { LS };

const listeners = new Set();
export const state = {
  phase: 'boot',          // boot | setup | login | ready | error
  mode: null,             // local | cloud
  user: null,
  trips: [],
  settings: {},           // sincronizados (correo, moneda…)
  prefs: LS.get('cv-prefs', { theme: 'auto', textSize: 'normal', mapStyle: 'auto' }), // de este dispositivo
  online: navigator.onLine,
  syncing: 0,
  pending: Object.keys(LS.get('cv-pending', {})).length,
  lastSync: LS.get('cv-lastsync', null),
  error: null,
};
let backend = null;
export const getBackend = () => backend;

let version = 0;
function emit() { version++; for (const l of listeners) l(state); }
// Para módulos que no son componentes (p. ej. la copia al USB).
export function subscribe(l) { listeners.add(l); return () => listeners.delete(l); }

export function setState(patch) { Object.assign(state, typeof patch === 'function' ? patch(state) : patch); emit(); }

export function useStore(selector = s => s) {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    // Por si el estado cambió entre el primer pintado y la suscripción.
    if (version !== seen) l();
    return () => listeners.delete(l);
  }, []);
  const seen = version;
  return selector(state);
}

// ---------------- Configuración ----------------
export function getConfig() {
  const saved = LS.get('cv-config', null);
  if (saved?.mode) return saved;
  const baked = window.APP_CONFIG || {};
  if (baked.supabaseUrl && baked.supabaseKey) return { mode: 'cloud', url: baked.supabaseUrl, key: baked.supabaseKey, baked: true };
  return null;
}
export function bakedConfig() {
  const b = window.APP_CONFIG || {};
  return b.supabaseUrl && b.supabaseKey ? { url: b.supabaseUrl, key: b.supabaseKey } : null;
}
export function saveConfig(cfg) { LS.set('cv-config', cfg); }

export function setPrefs(patch) {
  const prefs = { ...state.prefs, ...patch };
  LS.set('cv-prefs', prefs);
  setState({ prefs });
}

// ---------------- Arranque ----------------
export async function boot() {
  const cfg = getConfig();
  if (!cfg) { setState({ phase: 'setup' }); return; }
  try {
    if (cfg.mode === 'local') {
      backend = await new LocalBackend().init();
      setState({ mode: 'local', user: { local: true } });
      await loadAll();
      return;
    }
    backend = await new CloudBackend(cfg.url, cfg.key).init();
    const cached = LS.get('cv-cache', null);
    const user = await backend.getUser();
    if (!user) { setState({ phase: 'login', mode: 'cloud' }); return; }
    setState({ mode: 'cloud', user });
    if (cached?.user === user.id && Array.isArray(cached.trips)) {
      setState({ trips: cached.trips.map(normalizeTrip), settings: cached.settings || {}, phase: 'ready' });
    }
    await loadAll();
    backend.sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') setState({ phase: 'login', user: null }); });
  } catch (e) {
    setState({ phase: state.trips.length ? 'ready' : 'error', error: niceError(e) });
  }
}

export async function signIn(email, password) {
  const user = await backend.signIn(email, password);
  setState({ user, mode: 'cloud' });
  await loadAll();
}

export async function signOut() {
  try { await backend?.signOut(); } catch { /* nada */ }
  LS.del('cv-cache');
  setState({ trips: [], user: null, phase: state.mode === 'cloud' ? 'login' : 'setup' });
}

export async function resetConfig() {
  try { await backend?.signOut(); } catch { /* nada */ }
  LS.del('cv-config'); LS.del('cv-cache'); LS.del('cv-pending');
  location.hash = '#/';
  location.reload();
}

async function loadAll() {
  setState(s => ({ syncing: s.syncing + 1 }));
  try {
    const [trips, settings] = await Promise.all([backend.listTrips(), backend.getSettings().catch(() => ({}))]);
    // Los cambios pendientes de subir mandan sobre lo que viene del servidor.
    const pending = LS.get('cv-pending', {});
    const prev = new Map(state.trips.map(t => [t.id, t]));
    for (const t of trips) base.set(t.id, t.updatedAt);
    // Si un viaje no ha cambiado, se conserva el mismo objeto (así no se repinta nada).
    const byId = new Map(trips.map(t => [t.id, prev.get(t.id)?.updatedAt === t.updatedAt && !timers.has(t.id) ? prev.get(t.id) : normalizeTrip(t)]));
    for (const [id, t] of prev) if (timers.has(id) && byId.has(id)) byId.set(id, t);
    for (const [id, t] of Object.entries(pending)) {
      if (t === null) byId.delete(id);
      else byId.set(id, normalizeTrip(t));
    }
    const lastSync = new Date().toISOString();
    setState({ trips: [...byId.values()], settings, phase: 'ready', error: null, lastSync });
    LS.set('cv-lastsync', lastSync);
    persistCache();
    if (Object.keys(pending).length) flushPending();
  } catch (e) {
    if (state.trips.length) { setState({ phase: 'ready', error: niceError(e) }); }
    else throw e;
  } finally {
    setState(s => ({ syncing: Math.max(0, s.syncing - 1) }));
  }
}

export const refresh = () => loadAll().catch(e => toast(niceError(e), 'error'));

function persistCache() {
  if (state.mode !== 'cloud' || !state.user?.id) return;
  LS.set('cv-cache', { user: state.user.id, trips: state.trips, settings: state.settings });
}

// ---------------- Guardado con cola ----------------
const timers = new Map();
const base = new Map();   // versión del servidor sobre la que se hicieron los cambios
const ops = new Map();    // cambios pendientes de cada viaje (para combinarlos si hay conflicto)

function queuePending(id, trip) {
  const p = LS.get('cv-pending', {});
  p[id] = trip;
  LS.set('cv-pending', p);
  setState({ pending: Object.keys(p).length });
}
function clearPending(id, trip) {
  const p = LS.get('cv-pending', {});
  if (id in p && (trip === undefined || p[id]?.updatedAt === trip?.updatedAt || p[id] === null)) delete p[id];
  LS.set('cv-pending', p);
  setState({ pending: Object.keys(p).length });
}

const saving = new Set();  // viajes que se están guardando ahora mismo
const again = new Set();   // viajes que han cambiado mientras se guardaban
let opSeq = 0;

async function saveNow(id, attempt = 0) {
  if (saving.has(id)) { again.add(id); return; }
  const trip = state.trips.find(t => t.id === id);
  if (!trip) return;
  saving.add(id);
  queuePending(id, trip);
  setState(s => ({ syncing: s.syncing + 1 }));
  const lastSeq = opSeq;
  try {
    const myOps = ops.get(id) || [];
    // Sin cambios que reaplicar (p. ej. tras reiniciar la app), se guarda tal cual.
    const saved = await backend.saveTrip(trip, myOps.length ? base.get(id) : undefined);
    base.set(id, saved.updatedAt);
    ops.set(id, (ops.get(id) || []).filter(o => o.seq > lastSeq));
    clearPending(id, trip);
    // Conserva cambios hechos mientras se guardaba.
    const cur = state.trips.find(t => t.id === id);
    if (cur === trip) replaceTrip({ ...cur, updatedAt: saved.updatedAt }, false);
    persistCache();
  } catch (e) {
    if (e.conflict && attempt < 3) {
      mergeConflict(id, e.conflict);
      saving.delete(id);
      setState(s => ({ syncing: Math.max(0, s.syncing - 1) }));
      await saveNow(id, attempt + 1);
      return;
    }
    if (!navigator.onLine || /conexión|fetch/i.test(String(e.message))) {
      setState({ online: false });
    } else {
      toast(`No se pudo guardar: ${niceError(e)}`, 'error');
    }
  } finally {
    if (saving.has(id)) {
      saving.delete(id);
      setState(s => ({ syncing: Math.max(0, s.syncing - 1) }));
    }
  }
  if (again.has(id)) { again.delete(id); return saveNow(id); }
}

// Hay una versión más nueva en el servidor: se aplican encima los cambios hechos aquí.
function mergeConflict(id, server) {
  let draft = normalizeTrip(clone(server));
  for (const { fn } of ops.get(id) || []) {
    try { const r = fn(draft); if (r) draft = normalizeTrip(r); } catch { /* cambio que ya no aplica */ }
  }
  draft.updatedAt = new Date().toISOString();
  base.set(id, server.updatedAt);
  setState({ trips: state.trips.map(t => (t.id === id ? draft : t)) });
  toast('Había cambios hechos desde otro dispositivo: se han combinado con los tuyos.', 'info');
}

export async function flushPending() {
  const p = LS.get('cv-pending', {});
  for (const [id, t] of Object.entries(p)) {
    try {
      if (t === null) { await backend.deleteTrip(id); clearPending(id); continue; }
      // Si el viaje está en memoria se guarda la versión actual (con su control de cambios).
      if (state.trips.some(x => x.id === id)) { await saveNow(id); if (LS.get('cv-pending', {})[id]) return; continue; }
      const saved = await backend.saveTrip(t);
      base.set(id, saved.updatedAt);
      clearPending(id, t);
    } catch { return; }
  }
  setState({ online: true });
  persistCache();
}

window.addEventListener('online', () => { setState({ online: true }); flushPending(); });
window.addEventListener('offline', () => setState({ online: false }));
setInterval(() => { if (state.pending && navigator.onLine) flushPending(); }, 30000);
// Trae cada poco los cambios hechos desde otros dispositivos (si no hay nada a medias).
setInterval(() => {
  if (state.mode === 'cloud' && state.phase === 'ready' && document.visibilityState === 'visible' && navigator.onLine
    && !state.syncing && !state.pending && !timers.size && !document.documentElement.classList.contains('has-modal')) refresh();
}, 120000);
window.addEventListener('beforeunload', e => {
  for (const [id, t] of timers) { clearTimeout(t); timers.delete(id); const trip = state.trips.find(x => x.id === id); if (trip) queuePending(id, trip); }
  if (state.syncing) { e.preventDefault(); e.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    for (const [id, t] of timers) { clearTimeout(t); timers.delete(id); saveNow(id); }
  } else if (state.phase === 'ready' && state.mode === 'cloud') {
    // Al volver a la app, trae cambios hechos desde otro dispositivo.
    const last = state.lastSync ? Date.parse(state.lastSync) : 0;
    if (Date.now() - last > 60000 && !timers.size && !state.syncing) refresh();
  }
});

function replaceTrip(trip, schedule = true) {
  const trips = state.trips.map(t => (t.id === trip.id ? trip : t));
  setState({ trips });
  if (schedule) {
    clearTimeout(timers.get(trip.id));
    timers.set(trip.id, setTimeout(() => { timers.delete(trip.id); saveNow(trip.id); }, 700));
    queuePending(trip.id, trip);
  }
}

export function getTrip(id) { return state.trips.find(t => t.id === id); }

// Aplica un cambio a un viaje. fn recibe un borrador mutable.
export function updateTrip(id, fn) {
  const cur = getTrip(id);
  if (!cur) return;
  const draft = clone(cur);
  const r = fn(draft);
  if (!ops.has(id)) ops.set(id, []);
  ops.get(id).push({ seq: ++opSeq, fn });
  const next = normalizeTrip(r || draft);
  next.updatedAt = new Date().toISOString();
  replaceTrip(next);
  return next;
}

export async function createTrip(partial) {
  const t = newTrip(partial);
  setState({ trips: [t, ...state.trips] });
  queuePending(t.id, t);
  await saveNow(t.id);
  return t;
}

export async function importTrip(data) {
  const t = normalizeTrip({ ...data, id: uid(), createdAt: new Date().toISOString() });
  // Los archivos no viajan en la copia: se quitan referencias rotas.
  t.docs = t.docs.filter(d => !d.path);
  t.emails = t.emails.map(e => ({ ...e, bodyPath: null }));
  if (t.cover?.type === 'image') t.cover = { type: 'preset', id: 'arena' };
  setState({ trips: [t, ...state.trips] });
  await saveNow(t.id);
  return t;
}

export async function duplicateTrip(id) {
  const src = getTrip(id);
  if (!src) return;
  const t = clone(src);
  t.id = uid();
  t.title = `${src.title || 'Viaje'} (copia)`;
  t.createdAt = new Date().toISOString();
  // Copia los archivos para que el duplicado sea independiente.
  const copyFile = async path => {
    if (!path) return path;
    try {
      const blob = await backend.fileBlob(path);
      const np = path.replace(src.id, t.id);
      await backend.upload(np, blob, blob.type);
      return np;
    } catch { return null; }
  };
  if (t.cover?.type === 'image') { t.cover.path = await copyFile(t.cover.path); t.cover.thumbPath = await copyFile(t.cover.thumbPath); }
  for (const d of t.docs) if (d.path) d.path = await copyFile(d.path);
  for (const e of t.emails) if (e.bodyPath) e.bodyPath = await copyFile(e.bodyPath);
  t.docs = t.docs.filter(d => d.path !== null);
  setState({ trips: [normalizeTrip(t), ...state.trips] });
  await saveNow(t.id);
  return t;
}

export async function deleteTrip(id) {
  const trip = getTrip(id);
  if (!trip) return;
  clearTimeout(timers.get(id)); timers.delete(id);
  base.delete(id); ops.delete(id);
  setState({ trips: state.trips.filter(t => t.id !== id) });
  queuePending(id, null);
  try {
    await backend.deleteTrip(id);
    clearPending(id);
    try { await backend.removeFiles(tripFilePaths(trip)); } catch { /* no crítico */ }
  } catch (e) {
    if (navigator.onLine) toast(`No se pudo borrar en el servidor: ${niceError(e)}`, 'error');
  }
  persistCache();
}

// ---------------- Archivos ----------------
export async function uploadFile(tripId, folder, file, nameOverride) {
  const name = nameOverride || file.name || `archivo.${fileExt(file.type) || 'bin'}`;
  if (state.mode === 'cloud') {
    const u = LS.get('cv-usage', null);
    if (u && u.used + (file.size || 0) > storageLimit()) throw new Error('No queda espacio para archivos en la nube. Mira Ajustes → Cuenta para liberar espacio o ampliar el plan.');
    if ((file.size || 0) > 50 * 1024 * 1024) throw new Error('El archivo pesa más de 50 MB. Guárdalo mejor como enlace.');
  }
  const path = `${tripId}/${folder}/${sid()}-${safeFileName(name)}`;
  await backend.upload(path, file, file.type);
  const u2 = LS.get('cv-usage', null);
  if (u2) LS.set('cv-usage', { ...u2, used: u2.used + (file.size || 0) });
  return { path, name, mime: file.type || '', size: file.size || 0 };
}
export const fileUrl = path => backend.fileUrl(path);
export const fileUrls = paths => backend.fileUrls(paths);
export const fileBlob = path => backend.fileBlob(path);
export const removeFiles = paths => backend.removeFiles(paths).catch(() => {}).finally(() => LS.del('cv-usage'));

// ---------------- Espacio para archivos ----------------
export const STORAGE_PLANS = { free: { label: 'Gratuito', bytes: 1024 ** 3 }, pro: { label: 'Pro', bytes: 100 * 1024 ** 3 } };
export const storageLimit = () => (STORAGE_PLANS[state.settings?.storagePlan] || STORAGE_PLANS.free).bytes;

// Suma de lo que se sabe por los propios viajes (si la función del servidor no está disponible).
function estimateUsage() {
  let used = 0;
  for (const t of state.trips) {
    for (const d of t.docs) used += d.size || 0;
    if (t.cover?.type === 'image') used += 600 * 1024;
    used += t.emails.length * 80 * 1024;
  }
  return { used, exact: false };
}

export async function storageUsage({ fresh = false } = {}) {
  const c = LS.get('cv-usage', null);
  if (!fresh && c && Date.now() - c.at < 6 * 3600 * 1000) return c;
  let u;
  if (state.mode === 'cloud') {
    try { u = await backend.usage(); } catch { u = estimateUsage(); }
  } else {
    u = (await backend.usage().catch(() => null)) || estimateUsage();
  }
  const out = { ...u, at: Date.now() };
  LS.set('cv-usage', out);
  return out;
}
export const keepOffline = path => backend.keepOffline(path);
export { offlineFiles } from './backend.js';

// ---------------- Ajustes sincronizados ----------------
export async function saveSettings(patch) {
  const settings = { ...state.settings, ...patch };
  setState({ settings });
  persistCache();
  try { await backend.saveSettings(settings); } catch (e) { toast(`No se pudieron guardar los ajustes: ${niceError(e)}`, 'error'); }
}

// ---------------- Avisos ----------------
export const toasts = { list: [], listeners: new Set() };
export function toast(text, kind = 'info', opts = {}) {
  const t = { id: sid(), text, kind, action: opts.action, actionLabel: opts.actionLabel };
  toasts.list = [...toasts.list.filter(x => x.text !== text), t].slice(-3);
  toasts.listeners.forEach(l => l());
  setTimeout(() => dismissToast(t.id), opts.ms || (kind === 'error' ? 7000 : 3500));
}
export function dismissToast(id) {
  toasts.list = toasts.list.filter(t => t.id !== id);
  toasts.listeners.forEach(l => l());
}

export async function startLocal() {
  saveConfig({ mode: 'local' });
  backend = await new LocalBackend().init();
  setState({ mode: 'local', user: { local: true } });
  await loadAll();
}

export async function startCloud(url, key) {
  const b = await new CloudBackend(url, key).init();
  backend = b;
  saveConfig({ mode: 'cloud', url, key });
  setState({ mode: 'cloud', phase: 'login' });
}

// Copia de seguridad completa (sin archivos binarios).
export function exportAll() {
  return { app: 'cuaderno-de-viajes', version: 1, exportedAt: new Date().toISOString(), trips: state.trips };
}
