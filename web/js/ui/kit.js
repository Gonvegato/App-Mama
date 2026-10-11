// Piezas de interfaz reutilizables.
import { html, useState, useEffect, useRef, useCallback, useLayoutEffect } from '../../vendor/preact-htm.js';
import { ICONS } from '../lib/icon-data.js';
import { toasts, dismissToast, fileUrl } from '../lib/store.js';
import { cx, sid } from '../lib/util.js';

export { html };

export function Icon({ name, size = 18, class: cls, title }) {
  const inner = ICONS[name] || ICONS.circle;
  return html`<svg class=${cx('icon', cls)} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden=${title ? undefined : 'true'} dangerouslySetInnerHTML=${{ __html: (title ? `<title>${title}</title>` : '') + inner }}></svg>`;
}

export function Btn({ kind = 'default', icon, children, class: cls, size, ...rest }) {
  return html`<button type="button" class=${cx('btn', `btn-${kind}`, size && `btn-${size}`, !children && 'btn-icon', cls)} ...${rest}>
    ${icon && html`<${Icon} name=${icon} size=${size === 'sm' ? 16 : 18} />`}${children && html`<span>${children}</span>`}
  </button>`;
}

export function IconBtn({ icon, label, class: cls, size = 18, ...rest }) {
  return html`<button type="button" class=${cx('icon-btn', cls)} aria-label=${label} title=${label} ...${rest}><${Icon} name=${icon} size=${size} /></button>`;
}

export function Field({ label, hint, children, class: cls, wide }) {
  return html`<div class=${cx('field', wide && 'field-wide', cls)} role="group" aria-label=${label}>
    ${label && html`<span class="field-label">${label}</span>`}
    ${children}
    ${hint && html`<span class="field-hint">${hint}</span>`}
  </div>`;
}

// <select> que siempre muestra el valor elegido (aunque las opciones cambien).
export function Select({ value, children, ...rest }) {
  const ref = useRef();
  useLayoutEffect(() => { if (ref.current && ref.current.value !== String(value ?? '')) ref.current.value = String(value ?? ''); });
  return html`<select ref=${ref} value=${value} ...${rest}>${children}</select>`;
}

export function Empty({ icon = 'compass', title, text, children }) {
  return html`<div class="empty">
    <div class="empty-icon"><${Icon} name=${icon} size=${28} /></div>
    ${title && html`<h3>${title}</h3>`}
    ${text && html`<p>${text}</p>`}
    ${children && html`<div class="empty-actions">${children}</div>`}
  </div>`;
}

export function Spinner({ size = 18 }) {
  return html`<span class="spinner" style=${`width:${size}px;height:${size}px`} aria-label="Cargando"></span>`;
}

export function Chip({ active, children, onClick, icon, count }) {
  return html`<button type="button" class=${cx('chip', active && 'is-active')} onClick=${onClick}>
    ${icon && html`<${Icon} name=${icon} size=${15} />`}<span>${children}</span>${count != null && html`<span class="chip-count">${count}</span>`}
  </button>`;
}

export function Segmented({ value, options, onChange }) {
  return html`<div class="segmented" role="radiogroup">
    ${options.map(o => html`<button type="button" role="radio" aria-checked=${value === o.value} class=${cx(value === o.value && 'is-active')} onClick=${() => onChange(o.value)}>
      ${o.icon && html`<${Icon} name=${o.icon} size=${15} />`}<span>${o.label}</span></button>`)}
  </div>`;
}

// ---------- Menú desplegable ----------
export function Menu({ icon = 'more', label = 'Más opciones', items, align = 'right', button }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  return html`<div class="menu" ref=${ref}>
    ${button ? button(() => setOpen(o => !o)) : html`<${IconBtn} icon=${icon} label=${label} onClick=${() => setOpen(o => !o)} />`}
    ${open && html`<div class=${cx('menu-pop', `menu-${align}`)} role="menu">
      ${items.filter(Boolean).map(it => it === '-' ? html`<hr />` : html`<button type="button" role="menuitem" class=${cx('menu-item', it.danger && 'is-danger')} onClick=${() => { setOpen(false); it.onClick(); }}>
        ${it.icon && html`<${Icon} name=${it.icon} size=${16} />`}<span>${it.label}</span></button>`)}
    </div>`}
  </div>`;
}

// ---------- Ventanas (modales) ----------
const escStack = [];
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && escStack.length) { e.preventDefault(); escStack[escStack.length - 1].close(); }
});
const modalState = { list: [], listeners: new Set() };
const emitModals = () => modalState.listeners.forEach(l => l());

export function openModal(Component, props = {}) {
  return new Promise(resolve => {
    const id = sid();
    const close = result => {
      modalState.list = modalState.list.filter(m => m.id !== id);
      emitModals();
      resolve(result);
    };
    modalState.list = [...modalState.list, { id, Component, props, close }];
    emitModals();
  });
}

export function ModalHost() {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force(n => n + 1); modalState.listeners.add(l); return () => modalState.listeners.delete(l); }, []);
  // Al cambiar de pantalla (incluido el botón Atrás del móvil) se cierran las ventanas abiertas.
  useEffect(() => {
    const onRoute = () => { for (const m of [...modalState.list].reverse()) m.close(undefined); };
    window.addEventListener('hashchange', onRoute);
    return () => window.removeEventListener('hashchange', onRoute);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('has-modal', modalState.list.length > 0);
  });
  return html`${modalState.list.map(m => html`<${m.Component} key=${m.id} ...${m.props} close=${m.close} />`)}`;
}

export function Modal({ title, close, children, footer, size = 'md', class: cls, onSubmit, dismissable = true }) {
  const ref = useRef();
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const first = el?.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]), textarea, select');
    if (first && matchMedia('(pointer:fine)').matches) requestAnimationFrame(() => { if (!el.contains(document.activeElement)) first.focus(); });
    const entry = { close: () => dismissable && close() };
    escStack.push(entry);
    if (!first) el?.focus({ preventScroll: true });
    return () => { const i = escStack.indexOf(entry); if (i >= 0) escStack.splice(i, 1); prev?.focus?.({ preventScroll: true }); };
  }, []);
  const Body = onSubmit ? 'form' : 'div';
  return html`<div class="modal-layer" onPointerDown=${e => { if (e.target === e.currentTarget && dismissable) e.currentTarget.dataset.down = '1'; }}
      onClick=${e => { if (e.target === e.currentTarget && e.currentTarget.dataset.down && dismissable) close(); delete e.currentTarget.dataset.down; }}>
    <${Body} class=${cx('modal', `modal-${size}`, cls)} ref=${ref} tabIndex="-1" role="dialog" aria-modal="true" aria-label=${title}
      onSubmit=${onSubmit ? e => { e.preventDefault(); onSubmit(e); } : undefined}>
      <header class="modal-head">
        <h2>${title}</h2>
        <${IconBtn} icon="x" label="Cerrar" onClick=${() => close()} />
      </header>
      <div class="modal-body">${children}</div>
      ${footer && html`<footer class="modal-foot">${footer}</footer>`}
    </${Body}>
  </div>`;
}

function ConfirmModal({ close, title, text, okLabel = 'Aceptar', cancelLabel = 'Cancelar', danger }) {
  return html`<${Modal} title=${title} close=${() => close(false)} size="sm"
    footer=${html`<${Btn} kind="ghost" onClick=${() => close(false)}>${cancelLabel}</${Btn}><${Btn} kind=${danger ? 'danger' : 'primary'} autofocus onClick=${() => close(true)}>${okLabel}</${Btn}>`}>
    <p class="confirm-text">${text}</p>
  </${Modal}>`;
}
export const confirm = (title, text, opts = {}) => openModal(ConfirmModal, { title, text, ...opts });

// ---------- Avisos ----------
export function ToastHost() {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force(n => n + 1); toasts.listeners.add(l); return () => toasts.listeners.delete(l); }, []);
  return html`<div class="toasts" aria-live="polite">
    ${toasts.list.map(t => html`<div key=${t.id} class=${cx('toast', `toast-${t.kind}`)}>
      <${Icon} name=${t.kind === 'error' ? 'alert' : t.kind === 'ok' ? 'check-circle' : 'info'} size=${18} />
      <span>${t.text}</span>
      ${t.action && html`<button type="button" class="toast-action" onClick=${() => { t.action(); dismissToast(t.id); }}>${t.actionLabel}</button>`}
      <button type="button" class="toast-x" aria-label="Cerrar" onClick=${() => dismissToast(t.id)}><${Icon} name="x" size=${14} /></button>
    </div>`)}
  </div>`;
}

// ---------- Archivos ----------
export function useFileUrl(path) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!path) { setUrl(null); return; }
    fileUrl(path).then(u => { if (alive) setUrl(u); }).catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [path]);
  return url;
}

export function useAsync(fn, deps) {
  const [st, setSt] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true;
    setSt(s => ({ ...s, loading: true }));
    Promise.resolve().then(fn).then(data => alive && setSt({ loading: false, data, error: null }))
      .catch(error => alive && setSt({ loading: false, data: null, error }));
    return () => { alive = false; };
  }, deps);
  return st;
}

export function useMedia(q) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const l = () => setM(mq.matches);
    mq.addEventListener('change', l);
    return () => mq.removeEventListener('change', l);
  }, [q]);
  return m;
}

// Selector de archivos invisible reutilizable.
export function pickFiles({ accept = '', multiple = true, capture } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    if (capture) input.capture = capture;
    input.style.display = 'none';
    input.onchange = () => { resolve([...(input.files || [])]); input.remove(); };
    input.oncancel = () => { resolve([]); input.remove(); };
    document.body.appendChild(input);
    input.click();
  });
}

// Zona para soltar archivos.
export function DropZone({ onFiles, children, class: cls }) {
  const [over, setOver] = useState(false);
  const onDrop = useCallback(e => {
    e.preventDefault(); setOver(false);
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) onFiles(files);
  }, [onFiles]);
  return html`<div class=${cx('dropzone', over && 'is-over', cls)}
    onDragOver=${e => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)} onDrop=${onDrop}>${children}</div>`;
}

export function Progress({ value, max = 100, label }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return html`<div class="progress" role="progressbar" aria-valuenow=${pct} aria-valuemin="0" aria-valuemax="100" aria-label=${label}><span style=${`width:${pct}%`}></span></div>`;
}

export function Toggle({ checked, onChange, label }) {
  return html`<label class="toggle"><input type="checkbox" checked=${checked} onChange=${e => onChange(e.target.checked)} /><span class="toggle-track"><span></span></span>${label && html`<span class="toggle-label">${label}</span>`}</label>`;
}

export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* se prueba de la otra forma */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.appendChild(ta); ta.select();
  try { return document.execCommand('copy'); } catch { return false; } finally { ta.remove(); }
}
