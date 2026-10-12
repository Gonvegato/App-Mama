// Enlaces guardados en un viaje: cómo mostrarlos dentro de la app.
// 1. Servicios que permiten mostrarse dentro (Google Drive, Docs, YouTube): vista integrada.
// 2. Archivos (PDF, fotos, Dropbox, pCloud…): se trae el archivo y se muestra con el visor propio.
// 3. Páginas web: se muestran dentro si la web lo permite; si no, se trae su contenido
//    (con el ayudante de Gmail) y se enseña en modo lectura.
// Lo que se abre una vez se guarda en el dispositivo para poder verlo sin conexión.
import { gmailConfigured, fetchViaHelper } from './gmail.js';
import { offlineFiles } from './backend.js';
import { base64ToBlob } from './util.js';

const FILE_EXT = /\.(pdf|jpe?g|png|gif|webp|heic|avif|svg|txt)(?:$|[?#])/i;

export function classifyLink(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return { kind: 'invalid' }; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const path = u.pathname;
  let m;

  // Google Drive y Docs: tienen una «vista previa» pensada para mostrarse dentro de otras páginas.
  if (host === 'drive.google.com') {
    const id = (/\/file\/d\/([^/]+)/.exec(path) || [])[1] || u.searchParams.get('id');
    if (id) return { kind: 'embed', src: `https://drive.google.com/file/d/${id}/preview`, service: 'Google Drive' };
    if ((m = /\/drive\/(?:u\/\d+\/)?folders\/([^/?#]+)/.exec(path))) return { kind: 'embed', src: `https://drive.google.com/embeddedfolderview?id=${m[1]}#list`, service: 'Google Drive' };
  }
  if (host === 'docs.google.com') {
    if ((m = /^\/(document|spreadsheets|presentation)\/d\/([^/]+)/.exec(path))) return { kind: 'embed', src: `https://docs.google.com/${m[1]}/d/${m[2]}/preview`, service: 'Google' };
    if ((m = /^\/forms\/d\/(?:e\/)?([^/]+)/.exec(path))) return { kind: 'embed', src: `https://docs.google.com/forms/d/${path.includes('/d/e/') ? 'e/' : ''}${m[1]}/viewform?embedded=true`, service: 'Google Forms' };
  }
  // YouTube
  if (host === 'youtu.be' && path.length > 1) return { kind: 'embed', src: `https://www.youtube-nocookie.com/embed/${path.slice(1)}`, service: 'YouTube' };
  if ((host === 'youtube.com' || host === 'm.youtube.com') && u.searchParams.get('v')) return { kind: 'embed', src: `https://www.youtube-nocookie.com/embed/${u.searchParams.get('v')}`, service: 'YouTube' };
  // Dropbox: con dl=1 se obtiene el archivo en sí.
  if (host === 'dropbox.com' || host.endsWith('.dropbox.com')) {
    const d = new URL(u); d.searchParams.delete('dl'); d.searchParams.set('raw', '1');
    return { kind: 'file', src: d.href, service: 'Dropbox' };
  }
  // pCloud: enlace público («Compartir enlace»).
  if (/(^|\.)pcloud\.(link|com)$/.test(host)) {
    const code = u.searchParams.get('code');
    if (code) return { kind: 'pcloud', code, src: u.href, service: 'pCloud' };
  }
  if (FILE_EXT.test(path)) return { kind: 'file', src: u.href };
  return { kind: 'page', src: u.href };
}

export const isDesktop = () => !!window.cuaderno?.desktop;

const cacheKey = url => `enlace:${url}`;

async function directFetch(url) {
  const r = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const blob = await r.blob();
  return { blob, mime: (r.headers.get('content-type') || blob.type || '').split(';')[0], finalUrl: r.url };
}

// En la versión de escritorio se puede pedir el archivo de pCloud directamente.
async function pcloudDesktop(code) {
  for (const host of ['https://eapi.pcloud.com', 'https://api.pcloud.com']) {
    try {
      const r = await fetch(`${host}/getpublinkdownload?code=${encodeURIComponent(code)}`);
      const j = await r.json();
      if (j.result === 0 && j.hosts?.length) return directFetch(`https://${j.hosts[0]}${j.path}`);
    } catch { /* siguiente servidor */ }
  }
  throw new Error('pCloud no ha devuelto el archivo');
}

// Trae el contenido de un enlace. Devuelve { type: 'pdf'|'image'|'html'|'text'|'other', blob?, html?, frameable?, finalUrl? }
export async function loadLink(url, info = classifyLink(url), { allowCache = true, store = true } = {}) {
  if (allowCache) {
    const cached = await offlineFiles.get(cacheKey(url));
    if (cached) return describe(cached, cached.type, url, true);
  }
  let got = null, lastErr = null;
  // 1) Directo desde el dispositivo (funciona si la web lo permite; en escritorio, casi siempre).
  if (info.kind === 'file' || (isDesktop() && info.kind === 'page')) {
    try { got = await directFetch(info.src); } catch (e) { lastErr = e; }
  }
  if (!got && info.kind === 'pcloud' && isDesktop()) {
    try { got = await pcloudDesktop(info.code); } catch (e) { lastErr = e; }
  }
  // 2) A través del ayudante (servidor de Google, sin las restricciones del navegador).
  if (!got && gmailConfigured() && info.kind !== 'embed') {
    try {
      const r = await fetchViaHelper(info.src);
      if (r.html != null) {
        const blob = new Blob([r.html], { type: 'text/html' });
        const out = { type: 'html', html: r.html, frameable: !!r.frameable, finalUrl: r.finalUrl || info.src, blob };
        if (store && r.html.length < 3e6) offlineFiles.put(cacheKey(url), blob);
        return out;
      }
      got = { blob: base64ToBlob(r.data, r.mime || 'application/octet-stream'), mime: r.mime, finalUrl: r.finalUrl, frameable: r.frameable };
    } catch (e) { lastErr = e; }
  }
  if (!got) throw lastErr || new Error('No se ha podido traer el enlace');
  if (store && got.blob.size < 60 * 1024 * 1024 && !/text\/html/.test(got.mime)) offlineFiles.put(cacheKey(url), new Blob([got.blob], { type: got.mime || got.blob.type }));
  return describe(got.blob, got.mime, got.finalUrl || info.src, false, got.frameable);
}

async function describe(blob, mime = '', finalUrl, cached, frameable) {
  const m = (mime || blob.type || '').toLowerCase();
  let type = 'other';
  if (m.includes('pdf')) type = 'pdf';
  else if (m.startsWith('image/')) type = 'image';
  else if (m.includes('html')) type = 'html';
  else if (m.startsWith('text/')) type = 'text';
  else {
    // Sin tipo fiable: se mira el principio del archivo.
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) type = 'pdf';
    else if (head[0] === 0xff && head[1] === 0xd8) type = 'image';
    else if (head[0] === 0x89 && head[1] === 0x50) type = 'image';
  }
  const out = { type, blob, finalUrl, cached, frameable };
  if (type === 'html') out.html = await blob.text();
  if (type === 'text') out.text = await blob.text();
  return out;
}

// HTML de una web preparado para el modo lectura: sin scripts y con las rutas resueltas.
export function readerDoc(htmlText, baseUrl) {
  let h = String(htmlText || '');
  h = h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<noscript>([\s\S]*?)<\/noscript>/gi, '$1')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/<meta[^>]+http-equiv=["']?refresh[^>]*>/gi, '');
  // Imágenes con carga diferida: se pasa data-src a src.
  h = h.replace(/<img([^>]*?)\sdata-src=("[^"]*"|'[^']*')/gi, '<img$1 src=$2');
  const baseTag = `<base href="${String(baseUrl).replace(/"/g, '&quot;')}" target="_blank">`;
  const style = '<style>img,video{max-width:100%!important;height:auto!important}body{overflow-wrap:break-word}</style>';
  if (/<head[^>]*>/i.test(h)) return h.replace(/<head([^>]*)>/i, `<head$1>${baseTag}${style}`);
  return `<!doctype html><html><head><meta charset="utf-8">${baseTag}${style}</head><body>${h}</body></html>`;
}

export const forgetLink = url => offlineFiles.remove([cacheKey(url)]);
