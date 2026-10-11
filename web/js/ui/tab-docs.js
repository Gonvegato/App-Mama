// Pestaña Documentos: billetes, entradas, guías, seguros, fotos y enlaces.
import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { Btn, Icon, Empty, Chip, Modal, Field, openModal, confirm, pickFiles, DropZone, useFileUrl, Spinner, Menu, Select } from './kit.js';
import { DOC_KINDS, resTitle } from '../lib/model.js';
import { updateTrip, uploadFile, removeFiles, fileBlob, toast, keepOffline, offlineFiles, useStore } from '../lib/store.js';
import { fmtSize, sid, cx, downloadBlob, fileExt, isUrl, matches } from '../lib/util.js';
import { resizeImage } from '../lib/image.js';

export function guessDocKind(name = '', mime = '') {
  const n = name.toLowerCase();
  if (/embarque|boarding|billete|ticket|e-?ticket|bilhete|biglietto|billet|pkpass|tren|train|renfe|vuelo|flight/.test(n)) return 'billete';
  if (/entrada|admission|tickets?_|museo|museum|concierto|concert/.test(n)) return 'entrada';
  if (/seguro|insurance|poliza|póliza/.test(n)) return 'seguro';
  if (/gu[ií]a|guide|mapa|map|itinerario|itinerary/.test(n)) return 'guia';
  if (/pasaporte|passport|dni|visa|visado|esta|eta|vacuna|vaccin/.test(n)) return 'identidad';
  if (/reserva|booking|confirmaci|confirmation|factura|invoice|voucher|bono|hotel|airbnb/.test(n)) return 'reserva';
  if (mime.startsWith('image/')) return 'foto';
  return 'otro';
}

const isImage = d => /^image\//.test(d.mime || '') || /\.(jpe?g|png|gif|webp|heic)$/i.test(d.name || '');
const isPdf = d => /pdf/.test(d.mime || '') || /\.pdf$/i.test(d.name || '');

export async function uploadDocs(trip, files, extra = {}) {
  const added = [];
  toast(files.length > 1 ? `Subiendo ${files.length} archivos…` : 'Subiendo archivo…');
  for (const f0 of files) {
    try {
      const f = isImage({ mime: f0.type, name: f0.name }) ? await resizeImage(f0) : f0;
      const up = await uploadFile(trip.id, 'docs', f, f0.name);
      added.push({ id: sid(), name: f0.name.replace(/\.[^.]+$/, '') || f0.name, file: f0.name, kind: guessDocKind(f0.name, f0.type), path: up.path, mime: up.mime || f0.type, size: up.size, addedAt: new Date().toISOString(), ...extra });
    } catch (e) {
      toast(`No se pudo subir «${f0.name}»: ${e.message}`, 'error');
    }
  }
  if (added.length) {
    updateTrip(trip.id, t => { t.docs.push(...added); });
    toast(added.length > 1 ? `${added.length} documentos añadidos` : 'Documento añadido', 'ok');
  }
  return added;
}

function DocViewer({ close, trip, doc }) {
  const url = useFileUrl(doc.path);
  // Al abrir un documento se guarda una copia para poder verlo sin conexión.
  useEffect(() => { if (doc.path && navigator.onLine) keepOffline(doc.path).catch(() => {}); }, []);
  const res = trip.reservations.find(r => r.id === doc.resId);
  const download = async () => {
    try { downloadBlob(await fileBlob(doc.path), doc.file || `${doc.name}.${fileExt(doc.path) || 'pdf'}`); }
    catch (e) { toast(e.message, 'error'); }
  };
  return html`<${Modal} title=${doc.name} close=${close} size="xl" class="viewer"
    footer=${html`
      <${Btn} kind="ghost" icon="edit" onClick=${() => { close(); editDoc(trip, doc); }}>Editar</${Btn}>
      ${url && html`<a class="btn btn-default" href=${url} target="_blank" rel="noopener"><${Icon} name="external" size=${18} /><span>Abrir aparte</span></a>`}
      <${Btn} kind="primary" icon="download" onClick=${download}>Descargar</${Btn}>`}>
    ${(doc.note || res) && html`<p class="viewer-meta">${res && html`<span><${Icon} name="ticket" size=${15} /> ${resTitle(res)}</span>`}${doc.note && html`<span>${doc.note}</span>`}</p>`}
    <div class="viewer-stage">
      ${!url ? html`<${Spinner} size=${28} />`
        : isImage(doc) ? html`<img src=${url} alt=${doc.name} />`
        : isPdf(doc) ? html`<iframe src=${url} title=${doc.name}></iframe>`
        : html`<${Empty} icon="file" title="Vista previa no disponible" text="Descárgalo para abrirlo con su programa." />`}
    </div>
  </${Modal}>`;
}

export function openDoc(trip, doc) {
  if (doc.kind === 'enlace' || (!doc.path && doc.url)) { window.open(doc.url, '_blank', 'noopener'); return; }
  return openModal(DocViewer, { trip, doc });
}

function DocEditor({ close, trip, doc }) {
  const [d, setD] = useState({ ...doc });
  const link = d.kind === 'enlace' || (!d.path && 'url' in d);
  const save = () => {
    if (link && !isUrl(d.url)) { toast('Escribe una dirección web completa (https://…)', 'error'); return; }
    updateTrip(trip.id, t => {
      const i = t.docs.findIndex(x => x.id === d.id);
      if (i >= 0) t.docs[i] = d; else t.docs.push(d);
      for (const r of t.reservations) {
        r.docIds = (r.docIds || []).filter(x => x !== d.id);
        if (r.id === d.resId) r.docIds.push(d.id);
      }
    });
    close(d);
  };
  return html`<${Modal} title=${doc.id && trip.docs.some(x => x.id === doc.id) ? 'Editar documento' : link ? 'Añadir enlace' : 'Documento'} close=${() => close(null)} size="md" onSubmit=${save}
    footer=${html`<${Btn} kind="ghost" onClick=${() => close(null)}>Cancelar</${Btn}><${Btn} kind="primary" type="submit">Guardar</${Btn}>`}>
    <div class="form-grid">
      <${Field} label="Nombre"><input class="input" value=${d.name} onInput=${e => setD({ ...d, name: e.target.value })} autofocus /></${Field}>
      ${link && html`<${Field} label="Dirección web"><input class="input" type="url" value=${d.url || ''} onInput=${e => setD({ ...d, url: e.target.value.trim() })} placeholder="https://…" /></${Field}>`}
      ${!link && html`<${Field} label="Tipo"><${Select} class="input" value=${d.kind} onChange=${e => setD({ ...d, kind: e.target.value })}>
        ${Object.entries(DOC_KINDS).filter(([k]) => k !== 'enlace').map(([k, v]) => html`<option value=${k}>${v.label}</option>`)}</${Select}></${Field}>`}
      <${Field} label="Reserva relacionada"><${Select} class="input" value=${d.resId || ''} onChange=${e => setD({ ...d, resId: e.target.value || null })}>
        <option value="">Ninguna</option>
        ${trip.reservations.map(r => html`<option value=${r.id}>${resTitle(r)}</option>`)}</${Select}></${Field}>
      <${Field} label="Nota"><textarea class="input" rows="2" value=${d.note || ''} onInput=${e => setD({ ...d, note: e.target.value })} placeholder="Ej.: imprimir antes de salir"></textarea></${Field}>
    </div>
  </${Modal}>`;
}

export const editDoc = (trip, doc) => openModal(DocEditor, { trip, doc });

async function removeDoc(trip, doc) {
  if (!await confirm('¿Borrar este documento?', `«${doc.name}» se borrará del viaje.`, { okLabel: 'Borrar', danger: true })) return;
  updateTrip(trip.id, t => {
    t.docs = t.docs.filter(x => x.id !== doc.id);
    for (const r of t.reservations) r.docIds = (r.docIds || []).filter(x => x !== doc.id);
  });
  if (doc.path) removeFiles([doc.path]);
  toast('Documento borrado', 'ok');
}

function Thumb({ doc }) {
  const url = useFileUrl(isImage(doc) ? doc.path : null);
  if (url) return html`<div class="doc-thumb" style=${`background-image:url("${url}")`}></div>`;
  const ext = doc.kind === 'enlace' ? 'web' : (fileExt(doc.file || doc.path) || 'doc');
  return html`<div class=${cx('doc-thumb', 'doc-thumb-icon', `doc-${doc.kind}`)}><${Icon} name=${DOC_KINDS[doc.kind]?.icon || 'file'} size=${26} /><span>${ext.toUpperCase()}</span></div>`;
}

function OfflineButton({ trip }) {
  const mode = useStore(s => s.mode);
  const [st, setSt] = useState(null); // {done,total,cached}
  const paths = trip.docs.filter(d => d.path).map(d => d.path);
  useEffect(() => {
    let alive = true;
    Promise.all(paths.map(p => offlineFiles.has(p))).then(r => { if (alive) setSt(s => ({ ...(s || {}), cached: r.filter(Boolean).length })); });
    return () => { alive = false; };
  }, [paths.join('|')]);
  if (mode !== 'cloud' || !paths.length) return null;
  const all = st?.cached === paths.length;
  const run = async () => {
    let ok = 0;
    setSt({ done: 0, total: paths.length, cached: st?.cached || 0 });
    for (const [i, p] of paths.entries()) {
      try { if (await keepOffline(p)) ok++; } catch { /* sigue */ }
      setSt(s => ({ ...s, done: i + 1 }));
    }
    setSt({ cached: ok });
    toast(ok === paths.length ? 'Todos los documentos se pueden ver sin conexión en este dispositivo' : `Guardados ${ok} de ${paths.length}`, ok === paths.length ? 'ok' : 'error');
  };
  if (st?.total) return html`<span class="offline-state"><${Spinner} size=${15} /> Guardando ${st.done} de ${st.total}…</span>`;
  return html`<${Btn} icon=${all ? 'check-circle' : 'cloud-off'} kind=${all ? 'ghost' : 'default'} onClick=${run} title="Guarda una copia en este dispositivo para poder abrirlos sin internet (por ejemplo, en el aeropuerto)">
    ${all ? 'Disponibles sin conexión' : 'Guardar para verlos sin conexión'}</${Btn}>`;
}

export function DocsTab({ trip }) {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const kinds = [...new Set(trip.docs.map(d => d.kind))];
  const shown = trip.docs.filter(d => (filter === 'all' || d.kind === filter) && matches(q, d.name, d.note, d.file))
    .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  const upload = async files => { if (files?.length) await uploadDocs(trip, files); };
  const pick = async () => upload(await pickFiles({ accept: '' }));
  const addLink = () => editDoc(trip, { id: sid(), name: '', kind: 'enlace', url: '', addedAt: new Date().toISOString() });

  return html`<${DropZone} onFiles=${upload} class="page-pad">
    <div class="toolbar">
      <div class="toolbar-left chips">
        ${kinds.length > 1 && html`<${Chip} active=${filter === 'all'} onClick=${() => setFilter('all')} count=${trip.docs.length}>Todos</${Chip}>`}
        ${kinds.length > 1 && kinds.map(k => html`<${Chip} active=${filter === k} icon=${DOC_KINDS[k]?.icon} onClick=${() => setFilter(k)} count=${trip.docs.filter(d => d.kind === k).length}>${DOC_KINDS[k]?.label || k}</${Chip}>`)}
      </div>
      <div class="toolbar-right">
        ${trip.docs.length > 8 && html`<input class="input input-sm" type="search" placeholder="Buscar" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Buscar documentos" />`}
        <${OfflineButton} trip=${trip} />
        <${Btn} icon="link" onClick=${addLink}>Enlace</${Btn}>
        <${Btn} kind="primary" icon="upload" onClick=${pick}>Subir archivos</${Btn}>
      </div>
    </div>
    ${!trip.docs.length ? html`<${Empty} icon="file" title="Guarda aquí los papeles del viaje"
        text="Billetes, tarjetas de embarque, entradas, reservas, seguros, guías en PDF o fotos del pasaporte. Arrastra los archivos aquí o súbelos desde el móvil.">
        <${Btn} kind="primary" icon="upload" onClick=${pick}>Subir archivos</${Btn}>
        <${Btn} icon="camera" onClick=${async () => upload(await pickFiles({ accept: 'image/*', capture: 'environment', multiple: false }))}>Hacer una foto</${Btn}>
      </${Empty}>`
      : html`<div class="doc-grid">
        ${shown.map(d => html`<article class="doc-card" key=${d.id}>
          <button type="button" class="doc-open" onClick=${() => openDoc(trip, d)}>
            <${Thumb} doc=${d} />
            <span class="doc-info">
              <b>${d.name}</b>
              <small>${DOC_KINDS[d.kind]?.label || 'Documento'}${d.size ? ` · ${fmtSize(d.size)}` : ''}${d.fromEmail ? ' · de un correo' : ''}</small>
              ${d.resId && html`<small class="doc-res"><${Icon} name="ticket" size=${13} /> ${resTitle(trip.reservations.find(r => r.id === d.resId) || {})}</small>`}
            </span>
          </button>
          <${Menu} items=${[
            { icon: 'eye', label: 'Abrir', onClick: () => openDoc(trip, d) },
            { icon: 'edit', label: 'Editar', onClick: () => editDoc(trip, d) },
            d.path && { icon: 'download', label: 'Descargar', onClick: async () => downloadBlob(await fileBlob(d.path), d.file || d.name) },
            '-',
            { icon: 'trash', label: 'Borrar', danger: true, onClick: () => removeDoc(trip, d) },
          ]} />
        </article>`)}
      </div>
      <p class="muted small drop-hint only-desktop">Puedes arrastrar archivos a esta ventana para añadirlos.</p>`}
  </${DropZone}>`;
}
