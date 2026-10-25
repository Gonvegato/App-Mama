// Leer un ticket con la cámara: OCR en el propio dispositivo (Tesseract.js, español e inglés),
// sin enviar la foto a ningún servidor. Los archivos del lector están en web/vendor/tesseract y
// solo se cargan al escanear el primer ticket (unos 8 MB; después quedan guardados y sirven sin conexión).
import { parseReceipt } from './receipt-parse.js';

const vendor = p => new URL(`../../vendor/tesseract/${p}`, import.meta.url).href;
let scriptP, workerP, idleTimer, progressCb = null;

function loadScript() {
  if (window.Tesseract) return Promise.resolve();
  if (!scriptP) scriptP = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = vendor('tesseract.min.js');
    s.onload = resolve;
    s.onerror = () => { scriptP = null; reject(new Error('No se pudo cargar el lector de tickets.')); };
    document.head.appendChild(s);
  });
  return scriptP;
}

async function getWorker() {
  clearTimeout(idleTimer);
  if (!workerP) workerP = (async () => {
    await loadScript();
    return window.Tesseract.createWorker('spa+eng', 1, {   // 1 = solo el motor moderno (LSTM)
      workerPath: vendor('worker.min.js'),
      corePath: vendor('tesseract-core-lstm.wasm.js'),     // un archivo concreto: sin probar variantes
      langPath: vendor('lang'),
      cacheMethod: 'none',                                  // el service worker ya guarda los archivos
      logger: m => progressCb?.(m),
    });
  })().catch(e => { workerP = null; throw e; });
  const w = await workerP;
  // Se libera la memoria si no se escanea nada más en un rato.
  idleTimer = setTimeout(() => { workerP?.then(x => x.terminate()).catch(() => {}); workerP = null; }, 90000);
  return w;
}

// Pasa la foto a grises y estira el contraste, que es lo que más ayuda a leer tickets (papel térmico, luz mala).
async function prepare(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const img = ctx.getImageData(0, 0, w, h), d = img.data, hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = d[i + 1] = d[i + 2] = g; hist[g]++; }
  const total = w * h; let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= total * 0.02) { hi = v; break; } }
  if (hi - lo > 20) {
    const k = 255 / (hi - lo);
    for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, (d[i] - lo) * k)) | 0; d[i] = d[i + 1] = d[i + 2] = v; }
  }
  ctx.putImageData(img, 0, 0);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('No se pudo preparar la foto.'))), 'image/png'));
}

// onProgress({ status, progress }) con progress de 0 a 1.
// Devuelve { text, confidence, ...datos del gasto }. Nunca guarda nada: la pantalla enseña el resultado para revisarlo.
export async function scanReceipt(file, { trip, memory, onProgress } = {}) {
  progressCb = onProgress || null;
  try {
    const img = await prepare(file);
    const worker = await getWorker();
    const { data } = await worker.recognize(img);
    return { text: data.text || '', confidence: Math.round(data.confidence || 0), ...parseReceipt(data.text || '', { trip, memory }) };
  } finally { progressCb = null; }
}
