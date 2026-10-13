// Conexión con pCloud para el apartado Fotos.
// Las fotos se suben a la cuenta de pCloud de quien la conecta (p. ej. el padre) y se
// ven dentro de la app con miniaturas servidas por pCloud. El permiso (token) se obtiene
// con el flujo OAuth «token» de pCloud (solo navegador, sin clave secreta) y se guarda en
// los ajustes de la cuenta (sincronizados), así que se conecta una vez y vale en todos los
// dispositivos. El token se guarda junto con el «hostname» que devuelve pCloud, para usar
// el servidor correcto (EE. UU. api.pcloud.com o UE eapi.pcloud.com).
import { state, saveSettings, LS } from './store.js';

const OAUTH_LS = 'cv-pcloud-oauth';          // lo deja pcloud-oauth.html al volver
const cfg = () => state.settings?.pcloud || {};
export const pcloudConfigured = () => !!(cfg().token && cfg().hostname);
export const pcloudClientId = () => cfg().clientId || '';

// Dirección a la que pCloud devuelve tras autorizar (hay que registrarla igual en pCloud).
export function pcloudRedirectUri() {
  return new URL('pcloud-oauth.html', document.baseURI).href;
}

// Empieza la conexión: guarda el client_id y manda a la persona a pCloud a dar permiso.
export async function pcloudConnect(clientId) {
  const id = (clientId || '').trim();
  if (!id) throw new Error('Falta el ID de la aplicación de pCloud.');
  await saveSettings({ pcloud: { ...cfg(), clientId: id } });
  const p = new URLSearchParams({ client_id: id, response_type: 'token', redirect_uri: pcloudRedirectUri() });
  location.href = `https://my.pcloud.com/oauth2/authorize?${p}`;
}

// Al volver de pCloud, pcloud-oauth.html deja aquí el token. Se guarda en los ajustes.
export async function pcloudCaptureRedirect() {
  const data = LS.get(OAUTH_LS, null);   // lo guarda pcloud-oauth.html (ya como objeto)
  if (!data) return false;
  LS.del(OAUTH_LS);
  if (data.error || !data.access_token || !data.hostname) return false;
  await saveSettings({ pcloud: { ...cfg(), token: data.access_token, hostname: data.hostname, locationid: data.locationid, uid: data.userid || data.uid } });
  return true;
}

export async function pcloudDisconnect() {
  await saveSettings({ pcloud: { clientId: cfg().clientId || '' } });   // se conserva el client_id para reconectar
}

export const pcloudRegion = () => (cfg().locationid === 2 || /eapi/.test(cfg().hostname || '') ? 'Europa' : 'EE. UU.');

// ---- Llamadas a la API ----
function base() {
  const host = cfg().hostname || 'api.pcloud.com';
  return `https://${host}`;
}
function authErr(code) {
  // 1000/2000/2094/2095: problemas de sesión → hay que reconectar.
  return [1000, 2000, 2094, 2095].includes(code);
}
async function api(method, params = {}) {
  if (!pcloudConfigured()) throw new Error('pCloud no está conectado. Ve a Ajustes → Fotos.');
  const p = new URLSearchParams({ access_token: cfg().token, ...params });
  let r;
  try { r = await fetch(`${base()}/${method}?${p}`); }
  catch { throw new Error('No se pudo contactar con pCloud. Revisa la conexión.'); }
  const data = await r.json();
  if (data.result !== 0) {
    if (authErr(data.result)) throw new Error('El permiso de pCloud ha caducado o se ha revocado. Vuelve a conectarlo en Ajustes → Fotos.');
    throw new Error(data.error || `Error de pCloud (${data.result}).`);
  }
  return data;
}

// Crea (si no existe) una carpeta por su ruta y devuelve su folderid.
async function folderId(path) {
  const d = await api('createfolderifnotexists', { path });
  return d.metadata.folderid;
}
const safeName = s => (s || 'Viaje').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 80) || 'Viaje';

// Devuelve el folderid de una subcarpeta del viaje, creando toda la ruta:
// /Cuaderno de viajes/<viaje>/<sub>  (sub por defecto «Fotos»; para archivar, «Documentos»).
export async function pcloudTripFolder(tripName, sub = 'Fotos') {
  await folderId('/Cuaderno de viajes');
  const safe = safeName(tripName);
  await folderId(`/Cuaderno de viajes/${safe}`);
  return folderId(`/Cuaderno de viajes/${safe}/${safeName(sub)}`);
}

// Sube una foto a una carpeta. Devuelve los metadatos del archivo creado.
export function pcloudUpload(folderid, file, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (!pcloudConfigured()) return reject(new Error('pCloud no está conectado.'));
    const p = new URLSearchParams({ access_token: cfg().token, folderid: String(folderid), renameifexists: '1' });
    const fd = new FormData();
    fd.append('file', file, file.name || 'foto.jpg');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${base()}/uploadfile?${p}`);
    xhr.responseType = 'json';
    if (onProgress && xhr.upload) xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      const d = xhr.response;
      if (!d) return reject(new Error('Respuesta vacía de pCloud.'));
      if (d.result !== 0 || !d.metadata?.length) return reject(new Error(d.error || `Error de pCloud (${d.result}).`));
      resolve(d.metadata[0]);
    };
    xhr.onerror = () => reject(new Error('No se pudo subir a pCloud (¿conexión o permiso?).'));
    xhr.send(fd);
  });
}

export async function pcloudDelete(fileid) {
  await api('deletefile', { fileid: String(fileid) });
}

// ---- Miniaturas (para ver las fotos dentro de la app) ----
// Se guardan en memoria con su caducidad para no pedirlas a cada momento.
const thumbCache = new Map();
export async function pcloudThumb(fileid, size = '320x320', { crop = true } = {}) {
  const key = `${fileid}|${size}|${crop ? 'c' : ''}`;
  const hit = thumbCache.get(key);
  if (hit && hit.until > Date.now()) return hit.url;
  const d = await api('getthumblink', { fileid: String(fileid), size, ...(crop ? { crop: '1' } : {}) });
  if (!d.hosts?.length) throw new Error('pCloud no devolvió la miniatura.');
  const url = `https://${d.hosts[0]}${d.path}`;
  // Caduca un poco antes de lo que dice pCloud, por si acaso.
  thumbCache.set(key, { url, until: Date.now() + 8 * 60 * 1000 });
  return url;
}
