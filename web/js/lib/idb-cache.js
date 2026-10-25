// Almacenamiento local en IndexedDB (base «cv-offline»), solo de este dispositivo:
//  · cache    → copia de todos los viajes (cuando localStorage se queda pequeño)
//  · manifest → qué viajes se descargaron para usar sin conexión
//  · photos   → fotos hechas sin cobertura, a la espera de subirse
// No importa nada de la app, para poder usarlo desde cualquier módulo sin ciclos.
const DB = 'cv-offline';
const STORES = ['cache', 'manifest', 'photos'];
let dbp;

function open() {
  if (!dbp) dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Sin IndexedDB')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(e => { dbp = null; throw e; });
  return dbp;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const idbGet = (store, key) => run(store, 'readonly', s => s.get(key));
export const idbAll = (store) => run(store, 'readonly', s => s.getAll());
export const idbPut = (store, key, value) => run(store, 'readwrite', s => s.put(value, key));
export const idbDel = (store, key) => run(store, 'readwrite', s => s.delete(key));

// Copia de los viajes. Devuelve false si no se pudo guardar (nunca lanza).
export const writeCache = data => idbPut('cache', 'main', data).then(() => true, () => false);
export const readCache = () => idbGet('cache', 'main').catch(() => null);
export const clearCache = () => idbDel('cache', 'main').catch(() => {});
