// Visor de PDF propio (PDF.js): se ve igual en el ordenador, en Android y en iPhone,
// sin depender del visor del navegador. Dibuja solo las páginas que están a la vista.
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { Icon, Spinner } from './kit.js';

const base = p => new URL(`../../vendor/pdfjs/${p}`, import.meta.url).href;
let libPromise;
function loadPdfJs() {
  if (!libPromise) libPromise = import(base('pdf.min.mjs')).then(lib => {
    lib.GlobalWorkerOptions.workerSrc = base('pdf.worker.min.mjs');
    return lib;
  }).catch(e => { libPromise = null; throw e; });
  return libPromise;
}

// ¿Hace falta el visor propio? En móviles y tabletas el visor del navegador no sirve dentro de la app.
export function needsPdfJs() {
  if (window.cuaderno?.desktop) return false;
  const touch = matchMedia('(pointer: coarse)').matches;
  return touch || navigator.pdfViewerEnabled === false;
}

const MAX_DPR = 2;

function Page({ doc, num, width, ratio, onRatio }) {
  const ref = useRef();
  const canvasRef = useRef();
  const taskRef = useRef();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '900px 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!visible || !width) {
      // Libera memoria de las páginas que no se ven.
      if (canvas) { canvas.width = 0; canvas.height = 0; }
      return;
    }
    (async () => {
      const page = await doc.getPage(num);
      if (cancelled) return;
      const v1 = page.getViewport({ scale: 1 });
      const r = v1.height / v1.width;
      if (Math.abs(r - ratio) > 0.001) onRatio(num, r);
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const scale = (width / v1.width) * dpr;
      const vp = page.getViewport({ scale });
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      taskRef.current?.cancel();
      const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, canvas });
      taskRef.current = task;
      try { await task.promise; } catch { /* cancelado */ }
    })();
    return () => { cancelled = true; taskRef.current?.cancel(); };
  }, [visible, width]);
  return html`<div class="pdf-page" ref=${ref} style=${`width:${width}px;height:${Math.round(width * ratio)}px`}>
    <canvas ref=${canvasRef} aria-label=${`Página ${num}`}></canvas>
    ${!visible && html`<span class="pdf-page-n">${num}</span>`}
  </div>`;
}

export function PdfView({ blob }) {
  const wrap = useRef();
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState(null);
  const [ratios, setRatios] = useState([]);
  const [fitW, setFitW] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState(1);

  useEffect(() => {
    let alive = true, task;
    const destroy = () => { try { task?.destroy(); } catch { /* ya cerrado */ } };
    (async () => {
      try {
        const lib = await loadPdfJs();
        const data = new Uint8Array(await blob.arrayBuffer());
        if (!alive) return;
        task = lib.getDocument({
          data, isEvalSupported: false, enableXfa: false,
          cMapUrl: base('cmaps/'), cMapPacked: true,
          standardFontDataUrl: base('standard_fonts/'), wasmUrl: base('wasm/'), iccUrl: base('iccs/'),
        });
        const d = await task.promise;
        if (!alive) { destroy(); return; }
        const p1 = await d.getPage(1);
        const v = p1.getViewport({ scale: 1 });
        setRatios(Array(d.numPages).fill(v.height / v.width));
        setDoc(d);
      } catch (e) {
        if (alive) setErr(/password/i.test(e?.name || e?.message) ? 'Este PDF tiene contraseña y no se puede mostrar aquí.' : 'No se ha podido abrir este PDF.');
      }
    })();
    return () => { alive = false; destroy(); };
  }, [blob]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFitW(Math.max(200, el.clientWidth - 24)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Página actual según el desplazamiento.
  useEffect(() => {
    const el = wrap.current;
    if (!el || !doc) return;
    const onScroll = () => {
      const pages = el.querySelectorAll('.pdf-page');
      const mid = el.scrollTop + el.clientHeight / 3;
      let n = 1;
      for (const [i, p] of [...pages].entries()) { if (p.offsetTop <= mid) n = i + 1; else break; }
      setCurrent(n);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [doc]);

  const changeZoom = z => {
    const el = wrap.current;
    const rel = el ? (el.scrollTop + el.clientHeight / 2) / (el.scrollHeight || 1) : 0;
    setZoom(z);
    requestAnimationFrame(() => { if (el) el.scrollTop = rel * el.scrollHeight - el.clientHeight / 2; });
  };

  const width = Math.round(fitW * zoom);
  return html`<div class="pdf-view">
    <div class="pdf-scroll" ref=${wrap}>
      ${err ? html`<p class="pdf-msg">${err}</p>`
        : !doc ? html`<div class="pdf-msg"><${Spinner} size=${26} /></div>`
        : ratios.map((r, i) => html`<${Page} key=${i} doc=${doc} num=${i + 1} width=${width} ratio=${r}
            onRatio=${(n, nr) => setRatios(rs => { const c = [...rs]; c[n - 1] = nr; return c; })} />`)}
    </div>
    ${doc && html`<div class="pdf-bar">
      <span class="pdf-count">${current} / ${doc.numPages}</span>
      <button type="button" class="icon-btn" aria-label="Alejar" disabled=${zoom <= 1} onClick=${() => changeZoom(Math.max(1, +(zoom - 0.5).toFixed(1)))}><${Icon} name="minus" size=${18} /></button>
      <button type="button" class="pdf-zoom" onClick=${() => changeZoom(1)} aria-label="Ajustar al ancho">${Math.round(zoom * 100)} %</button>
      <button type="button" class="icon-btn" aria-label="Acercar" disabled=${zoom >= 3} onClick=${() => changeZoom(Math.min(3, zoom + 0.5))}><${Icon} name="plus" size=${18} /></button>
    </div>`}
  </div>`;
}
