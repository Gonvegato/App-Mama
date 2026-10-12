// Almacenamiento: modo local (IndexedDB, solo este dispositivo) y modo nube (Supabase).

const DB_NAME = 'cuaderno-viajes';
const BUCKET = 'viajes';

// ---------------- IndexedDB mínimo ----------------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('trips')) db.createObjectStore('trips', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Operación cancelada'));
  });
}

export class LocalBackend {
  constructor() { this.kind = 'local'; this.urls = new Map(); }
  async init() { this.db = await openDB(); return this; }
  async getUser() { return { email: null, local: true }; }
  async signOut() {}
  async listTrips() { return (await tx(this.db, 'trips', 'readonly', s => s.getAll())) || []; }
  async saveTrip(trip) {
    const t = { ...trip, updatedAt: new Date().toISOString() };
    await tx(this.db, 'trips', 'readwrite', s => s.put(t));
    return t;
  }
  async deleteTrip(id) { await tx(this.db, 'trips', 'readwrite', s => s.delete(id)); }
  async upload(path, blob) {
    await tx(this.db, 'files', 'readwrite', s => s.put(blob, path));
    return path;
  }
  async fileBlob(path) {
    const b = await tx(this.db, 'files', 'readonly', s => s.get(path));
    if (!b) throw new Error('No se encuentra el archivo');
    return b;
  }
  async fileUrl(path) {
    if (this.urls.has(path)) return this.urls.get(path);
    const b = await this.fileBlob(path);
    const u = URL.createObjectURL(b);
    this.urls.set(path, u);
    return u;
  }
  async fileUrls(paths) {
    const out = {};
    for (const p of paths) { try { out[p] = await this.fileUrl(p); } catch { /* falta */ } }
    return out;
  }
  async removeFiles(paths) {
    if (!paths?.length) return;
    await tx(this.db, 'files', 'readwrite', s => { for (const p of paths) s.delete(p); });
    for (const p of paths) { const u = this.urls.get(p); if (u) URL.revokeObjectURL(u); this.urls.delete(p); }
  }
  async keepOffline() { return true; }
  async getSettings() { return (await tx(this.db, 'kv', 'readonly', s => s.get('settings'))) || {}; }
  async saveSettings(obj) { await tx(this.db, 'kv', 'readwrite', s => s.put(obj, 'settings')); }
  async usage() {
    try { const e = await navigator.storage?.estimate?.(); return e ? { used: e.usage } : null; } catch { return null; }
  }
}

// ---------------- Supabase ----------------
let supaLoading;
function loadSupabaseLib() {
  if (window.supabase?.createClient) return Promise.resolve();
  if (!supaLoading) supaLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/supabase.js', import.meta.url).href;
    s.onload = resolve;
    s.onerror = () => reject(new Error('No se pudo cargar la librería de Supabase'));
    document.head.appendChild(s);
  });
  return supaLoading;
}

function niceError(e) {
  const m = e?.message || String(e);
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/Email not confirmed/i.test(m)) return 'Falta confirmar el correo de esta cuenta (desde el panel de Supabase o el email de confirmación).';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'No hay conexión con el servidor. Revisa internet o si el proyecto de Supabase está en pausa.';
  if (/JWT|token/i.test(m) && /expired/i.test(m)) return 'La sesión ha caducado. Vuelve a entrar.';
  if (/row-level security|violates/i.test(m)) return 'Permiso denegado por la base de datos. ¿Has ejecutado el script SQL de instalación?';
  if (/Bucket not found/i.test(m)) return 'Falta el espacio de archivos «viajes» en Supabase. Ejecuta el script SQL de instalación.';
  if (/relation .* does not exist|Could not find the table/i.test(m)) return 'Faltan las tablas en Supabase. Ejecuta el script SQL de instalación.';
  if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return 'El archivo es demasiado grande para el plan gratuito (máximo 50 MB).';
  return m;
}

// Copia local de archivos para poder abrir billetes y reservas sin conexión.
const OFFLINE_CACHE = 'cv-archivos-v1';
const offlineKey = path => `https://cuaderno.local/archivo/${encodeURIComponent(path)}`;
export const offlineFiles = {
  async put(path, blob) {
    if (!('caches' in window)) return false;
    try {
      const c = await caches.open(OFFLINE_CACHE);
      await c.put(new Request(offlineKey(path)), new Response(blob, { headers: { 'Content-Type': blob.type || 'application/octet-stream' } }));
      return true;
    } catch { return false; }
  },
  async get(path) {
    if (!('caches' in window)) return null;
    try {
      const c = await caches.open(OFFLINE_CACHE);
      const r = await c.match(offlineKey(path));
      return r ? await r.blob() : null;
    } catch { return null; }
  },
  async has(path) {
    if (!('caches' in window)) return false;
    try { return !!(await (await caches.open(OFFLINE_CACHE)).match(offlineKey(path))); } catch { return false; }
  },
  async remove(paths) {
    if (!('caches' in window)) return;
    try { const c = await caches.open(OFFLINE_CACHE); for (const p of paths) await c.delete(offlineKey(p)); } catch { /* nada */ }
  },
};

export class CloudBackend {
  constructor(url, key) { this.kind = 'cloud'; this.url = url; this.key = key; this.signed = new Map(); }
  async init() {
    await loadSupabaseLib();
    this.sb = window.supabase.createClient(this.url, this.key, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cv-auth', detectSessionInUrl: false },
    });
    return this;
  }
  async getUser() {
    const { data } = await this.sb.auth.getSession();
    return data?.session?.user ? { email: data.session.user.email, id: data.session.user.id } : null;
  }
  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(niceError(error));
    return { email: data.user.email, id: data.user.id };
  }
  // Solo en este dispositivo: cerrar sesión en un PC no debe sacarla del móvil.
  async signOut() { await this.sb.auth.signOut({ scope: 'local' }); }
  // Por si se pierde un USB o un móvil: cierra la sesión en todos los demás.
  async signOutOthers() {
    const { error } = await this.sb.auth.signOut({ scope: 'others' });
    if (error) throw new Error(niceError(error));
  }
  async changePassword(password) {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw new Error(/should be at least|weak|short/i.test(error.message) ? 'La contraseña es demasiado corta o sencilla (mínimo 6 caracteres).' : /different from the old/i.test(error.message) ? 'La nueva contraseña debe ser distinta de la actual.' : niceError(error));
  }
  async uidOrThrow() {
    const u = await this.getUser();
    if (!u) throw new Error('Tienes que iniciar sesión.');
    return u.id;
  }
  async listTrips() {
    const { data, error } = await this.sb.from('viajes').select('id,data,updated_at').order('updated_at', { ascending: false });
    if (error) throw new Error(niceError(error));
    return (data || []).map(r => ({ ...r.data, id: r.id, updatedAt: r.updated_at }));
  }
  // Guarda un viaje. Si se indica la versión de partida (base) y en el servidor hay otra
  // más reciente (cambiada desde otro dispositivo), lanza un error con esa versión en «conflict».
  async saveTrip(trip, base) {
    const updatedAt = new Date().toISOString();
    const t = { ...trip, updatedAt };
    if (base) {
      const { data, error } = await this.sb.from('viajes').update({ data: t, updated_at: updatedAt }).eq('id', t.id).eq('updated_at', base).select('id');
      if (error) throw new Error(niceError(error));
      if (data?.length) return t;
      const { data: cur, error: e2 } = await this.sb.from('viajes').select('id,data,updated_at').eq('id', t.id).maybeSingle();
      if (e2) throw new Error(niceError(e2));
      if (cur) {
        const err = new Error('El viaje ha cambiado en otro dispositivo');
        err.conflict = { ...cur.data, id: cur.id, updatedAt: cur.updated_at };
        throw err;
      }
      // Se borró en otro dispositivo: se vuelve a crear con los cambios de este.
    }
    const { error } = await this.sb.from('viajes').upsert({ id: t.id, data: t, updated_at: updatedAt });
    if (error) throw new Error(niceError(error));
    return t;
  }
  async deleteTrip(id) {
    const { error } = await this.sb.from('viajes').delete().eq('id', id);
    if (error) throw new Error(niceError(error));
  }
  async fullPath(path) { return `${await this.uidOrThrow()}/${path}`; }
  async upload(path, blob, mime) {
    const full = await this.fullPath(path);
    const { error } = await this.sb.storage.from(BUCKET).upload(full, blob, { contentType: mime || blob.type || 'application/octet-stream', upsert: true });
    if (error) throw new Error(niceError(error));
    return path;
  }
  async fileBlob(path) {
    try {
      const { data, error } = await this.sb.storage.from(BUCKET).download(await this.fullPath(path));
      if (error) throw new Error(niceError(error));
      return data;
    } catch (e) {
      const cached = await offlineFiles.get(path);
      if (cached) return cached;
      throw e;
    }
  }
  // Descarga y guarda una copia local (para verla sin conexión).
  async keepOffline(path) {
    if (await offlineFiles.has(path)) return true;
    const { data, error } = await this.sb.storage.from(BUCKET).download(await this.fullPath(path));
    if (error) throw new Error(niceError(error));
    return offlineFiles.put(path, data);
  }
  async fileUrl(path) {
    const c = this.signed.get(path);
    if (c && c.exp > Date.now() && navigator.onLine) return c.url;
    if (!navigator.onLine) {
      const blob = await offlineFiles.get(path);
      if (blob) return URL.createObjectURL(blob);
    }
    // Evita pedir dos veces la misma dirección a la vez.
    this.inflight ||= new Map();
    if (this.inflight.has(path)) return this.inflight.get(path);
    const p = this._sign(path).catch(async e => {
      const blob = await offlineFiles.get(path);
      if (blob) return URL.createObjectURL(blob);
      throw e;
    }).finally(() => this.inflight.delete(path));
    this.inflight.set(path, p);
    return p;
  }
  async _sign(path) {
    const { data, error } = await this.sb.storage.from(BUCKET).createSignedUrl(await this.fullPath(path), 3600 * 6);
    if (error) throw new Error(niceError(error));
    this.signed.set(path, { url: data.signedUrl, exp: Date.now() + 3600 * 5 * 1000 });
    return data.signedUrl;
  }
  async fileUrls(paths) {
    const out = {}, missing = [];
    for (const p of paths) {
      const c = this.signed.get(p);
      if (c && c.exp > Date.now()) out[p] = c.url; else missing.push(p);
    }
    if (missing.length) {
      const uidp = await this.uidOrThrow();
      const { data } = await this.sb.storage.from(BUCKET).createSignedUrls(missing.map(p => `${uidp}/${p}`), 3600 * 6);
      for (const [i, row] of (data || []).entries()) {
        if (row?.signedUrl) {
          out[missing[i]] = row.signedUrl;
          this.signed.set(missing[i], { url: row.signedUrl, exp: Date.now() + 3600 * 5 * 1000 });
        }
      }
    }
    return out;
  }
  async removeFiles(paths) {
    if (!paths?.length) return;
    offlineFiles.remove(paths);
    const uidp = await this.uidOrThrow();
    const { error } = await this.sb.storage.from(BUCKET).remove(paths.map(p => `${uidp}/${p}`));
    if (error) throw new Error(niceError(error));
    for (const p of paths) this.signed.delete(p);
  }
  async getSettings() {
    const { data, error } = await this.sb.from('ajustes').select('data').maybeSingle();
    if (error) throw new Error(niceError(error));
    return data?.data || {};
  }
  async saveSettings(obj) {
    const id = await this.uidOrThrow();
    const { error } = await this.sb.from('ajustes').upsert({ user_id: id, data: obj, updated_at: new Date().toISOString() });
    if (error) throw new Error(niceError(error));
  }
  // Espacio que ocupan los archivos (función «uso_archivos» del script SQL).
  async usage() {
    const { data, error } = await this.sb.rpc('uso_archivos');
    if (error) throw new Error(niceError(error));
    return { used: Number(data) || 0, exact: true };
  }
}

export { niceError };
