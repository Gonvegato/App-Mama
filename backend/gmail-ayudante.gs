/**
 * Ayudante de Gmail para «Cuaderno de viajes».
 *
 * Qué hace: permite a la app BUSCAR y LEER correos de esta cuenta de Gmail y sus
 * archivos adjuntos para guardarlos en cada viaje. No envía, no borra y no modifica nada.
 * También sirve para abrir enlaces cortos de Google Maps y Apple Maps (maps.app.goo.gl, maps.apple)
 * y para mostrar dentro de la app los enlaces guardados en los viajes (PDF, fotos, pCloud, webs).
 *
 * Instalación (en la cuenta de Gmail de la persona que usará la app):
 *  1. Entra en https://script.google.com con esa cuenta → «Nuevo proyecto».
 *  2. Borra todo, pega este archivo completo y cambia la CLAVE de abajo por una frase secreta tuya.
 *  3. Guarda (icono de disquete). Arriba elige la función «probar» → «Ejecutar» y acepta los permisos
 *     (si sale «Google no ha verificado esta aplicación»: Configuración avanzada → Ir a … (no seguro).
 *     Es normal: la aplicación es tuya y nadie más la usa).
 *  4. «Implementar» → «Nueva implementación» → tipo «Aplicación web».
 *       · Ejecutar como: «Yo»
 *       · Quién tiene acceso: «Cualquier usuario»
 *     → «Implementar» y copia la URL (termina en /exec).
 *  5. En la app: Ajustes → Correo → pega la URL y la misma clave.
 *
 * Si cambias este código, hay que publicar una versión nueva:
 * «Implementar» → «Gestionar implementaciones» → lápiz → Versión: «Nueva versión» → «Implementar».
 */

const CLAVE = 'CAMBIA-ESTA-FRASE-SECRETA';

function doPost(e) {
  return responder(e && e.postData ? e.postData.contents : '{}');
}

function doGet(e) {
  return salida({ ok: true, mensaje: 'Ayudante de Gmail de Cuaderno de viajes activo. Úsalo desde la app.' });
}

function responder(cuerpo) {
  let p;
  try { p = JSON.parse(cuerpo || '{}'); } catch (err) { return salida({ error: 'Petición no válida' }); }
  if (CLAVE === 'CAMBIA-ESTA-FRASE-SECRETA') return salida({ error: 'Cambia la CLAVE dentro del script antes de usarlo.' });
  if (p.key !== CLAVE) return salida({ error: 'clave' });
  try {
    switch (p.action) {
      case 'ping': return salida({ ok: true, email: Session.getEffectiveUser().getEmail() });
      case 'search': return salida({ results: buscar(String(p.q || ''), Math.min(Number(p.max) || 30, 60)) });
      case 'get': return salida(leer(String(p.id)));
      case 'attachment': return salida(adjunto(String(p.id), Number(p.index)));
      case 'resolve': return salida({ url: resolver(String(p.url)) });
      case 'fetch': return salida(traer(String(p.url)));
      default: return salida({ error: 'Acción desconocida' });
    }
  } catch (err) {
    return salida({ error: String(err && err.message ? err.message : err) });
  }
}

function salida(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function infoAdjuntos(m) {
  return m.getAttachments({ includeInlineImages: false, includeAttachments: true }).map(function (a, i) {
    return { index: i, name: a.getName(), mime: a.getContentType(), size: a.getSize() };
  });
}

function resumen(m, total) {
  const texto = (m.getPlainBody() || '').replace(/\s+/g, ' ').trim();
  return {
    id: m.getId(),
    threadId: m.getThread().getId(),
    subject: m.getSubject() || '(sin asunto)',
    from: m.getFrom(),
    date: m.getDate().toISOString(),
    snippet: texto.slice(0, 220),
    attachments: infoAdjuntos(m),
    count: total,
  };
}

function buscar(q, max) {
  const hilos = GmailApp.search(q, 0, max);
  const out = [];
  hilos.forEach(function (h) {
    const msgs = h.getMessages();
    // El mensaje más útil: el último con adjuntos o, si no, el primero del hilo.
    let elegido = msgs[0];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].getAttachments({ includeInlineImages: false }).length) { elegido = msgs[i]; break; }
    }
    out.push(resumen(elegido, msgs.length));
  });
  return out;
}

function leer(id) {
  const m = GmailApp.getMessageById(id);
  if (!m) throw new Error('No se encuentra el correo');
  return {
    id: m.getId(),
    threadId: m.getThread().getId(),
    subject: m.getSubject() || '(sin asunto)',
    from: m.getFrom(),
    to: m.getTo(),
    date: m.getDate().toISOString(),
    html: m.getBody(),
    plain: m.getPlainBody(),
    attachments: infoAdjuntos(m),
  };
}

function adjunto(id, index) {
  const m = GmailApp.getMessageById(id);
  const a = m.getAttachments({ includeInlineImages: false, includeAttachments: true })[index];
  if (!a) throw new Error('No se encuentra el adjunto');
  return { name: a.getName(), mime: a.getContentType(), size: a.getSize(), data: Utilities.base64Encode(a.getBytes()) };
}

// Sigue las redirecciones de un enlace corto y devuelve la dirección final.
function resolver(url) {
  if (!/^https:\/\/(maps\.app\.goo\.gl|goo\.gl|g\.co|maps\.apple)\//i.test(url) && !/^https:\/\/[a-z0-9.-]*maps\.apple(\/|$)/i.test(url)) {
    throw new Error('Solo se abren enlaces cortos de Google Maps o Apple Maps');
  }
  let actual = url;
  for (let i = 0; i < 8; i++) {
    const r = UrlFetchApp.fetch(actual, { followRedirects: false, muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const code = r.getResponseCode();
    const h = r.getAllHeaders();
    const loc = h.Location || h.location;
    if (code >= 300 && code < 400 && loc) {
      actual = Array.isArray(loc) ? loc[0] : loc;
      // Página de consentimiento de Google: la dirección real va en «continue».
      const m = /[?&]continue=([^&]+)/.exec(actual);
      if (/consent\.google/.test(actual) && m) actual = decodeURIComponent(m[1]);
      continue;
    }
    break;
  }
  return actual;
}

const NAVEGADOR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const MAX_BYTES = 30 * 1024 * 1024;

// Trae un enlace para mostrarlo dentro de la app. Devuelve el archivo (en base64) o el HTML de la página.
function traer(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Enlace no válido');
  var destino = url;
  // Enlaces públicos de pCloud: se pide la dirección real del archivo.
  var pc = /pcloud\.(link|com)/i.test(url) && /[?&]code=([A-Za-z0-9]+)/.exec(url);
  if (pc) {
    destino = null;
    var servidores = ['https://eapi.pcloud.com', 'https://api.pcloud.com'];
    for (var i = 0; i < servidores.length && !destino; i++) {
      var r0 = UrlFetchApp.fetch(servidores[i] + '/getpublinkdownload?code=' + encodeURIComponent(pc[1]), { muteHttpExceptions: true });
      try {
        var j = JSON.parse(r0.getContentText());
        if (j.result === 0 && j.hosts && j.hosts.length) destino = 'https://' + j.hosts[0] + j.path;
      } catch (e) { /* siguiente servidor */ }
    }
    if (!destino) throw new Error('pCloud no ha dado el archivo. ¿El enlace es público y sigue activo?');
  }
  var r = UrlFetchApp.fetch(destino, { followRedirects: true, muteHttpExceptions: true, headers: { 'User-Agent': NAVEGADOR, 'Accept-Language': 'es-ES,es;q=0.9' } });
  var code = r.getResponseCode();
  if (code >= 400) throw new Error('La web respondió con un error (' + code + ').');
  var h = r.getAllHeaders();
  var tipo = String(h['Content-Type'] || h['content-type'] || '').split(';')[0].trim().toLowerCase();
  var xfo = h['X-Frame-Options'] || h['x-frame-options'];
  var csp = String(h['Content-Security-Policy'] || h['content-security-policy'] || '');
  var permiteMarco = !xfo && !(/frame-ancestors/i.test(csp) && !/frame-ancestors[^;]*\*/i.test(csp));
  var bytes = r.getContent();
  if (bytes.length > MAX_BYTES) throw new Error('El archivo es demasiado grande para mostrarlo aquí (más de 30 MB).');
  if (tipo.indexOf('html') >= 0) return { html: r.getContentText(), frameable: permiteMarco, finalUrl: destino };
  return { mime: tipo || 'application/octet-stream', data: Utilities.base64Encode(bytes), frameable: permiteMarco, finalUrl: destino };
}

// Ejecuta esta función una vez desde el editor para conceder permisos y comprobar que todo va bien.
function probar() {
  const n = GmailApp.search('in:inbox', 0, 1).length;
  Logger.log('Permisos correctos. Cuenta: ' + Session.getEffectiveUser().getEmail() + ' · correos encontrados: ' + n);
}
