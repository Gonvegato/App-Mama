// Pestaña Correos: busca en Gmail los correos del viaje y los guarda con sus adjuntos.
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { Btn, Icon, IconBtn, Empty, Modal, openModal, confirm, Spinner, Toggle, Chip } from './kit.js';
import { gmailConfigured, gmailSearch, gmailGet, gmailAttachment, suggestedQuery, quickQueries } from '../lib/gmail.js';
import { updateTrip, uploadFile, removeFiles, fileBlob, toast, useStore, offlineFiles } from '../lib/store.js';
import { guessDocKind } from './tab-docs.js';
import { KindPicker, ReservationForm } from './res-form.js';
import { newReservation } from '../lib/model.js';
import { parseReservationDoc } from '../lib/doc-parse.js';
import { geocode } from '../lib/geo.js';
import { sid, fmtSize, base64ToBlob, cx } from '../lib/util.js';
import { go } from '../lib/router.js';
import { mailScanState, mailCandidates, dismissCandidates } from '../lib/mail-scan.js';

const fmtWhen = iso => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(d).replace('.', '');
};
const sender = from => (/^"?([^"<]+)"?\s*</.exec(from || '')?.[1] || from || '').trim();

// Documento HTML seguro para mostrar un correo: sin scripts y con enlaces que abren fuera.
function emailDoc(m) {
  const head = '<meta charset="utf-8"><base target="_blank"><style>body{font-family:Georgia,serif;margin:16px;color:#222;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%!important}</style>';
  if (m.html) {
    // Se quitan scripts y marcos (además, el visor no permite ejecutar código).
    const clean = m.html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<iframe[\s\S]*?<\/iframe>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');
    return `<!doctype html><html><head>${head}</head><body>${clean}</body></html>`;
  }
  const esc = (m.plain || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<!doctype html><html><head>${head}</head><body><pre style="white-space:pre-wrap;font-family:inherit">${esc}</pre></body></html>`;
}

function MailFrame({ srcdoc }) {
  return html`<iframe class="mail-frame" sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin" srcdoc=${srcdoc} title="Correo"></iframe>`;
}

// Texto plano de un correo (de un HTML).
const stripHtml = h => String(h || '')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<\/(p|div|tr|li|br|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#\d+;/g, ' ')
  .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

// Saca el texto del correo: primero el cuerpo ya guardado (vale sin conexión) y, si no, lo pide a Gmail.
async function emailText(email) {
  try { if (email.bodyPath) { const b = await fileBlob(email.bodyPath); return stripHtml(await b.text()); } } catch { /* sigue */ }
  try { const m = await gmailGet(email.gmailId); return m.plain || stripHtml(m.html) || ''; } catch { return email.snippet || ''; }
}

// Crea una reserva leyendo los datos del propio correo (tipo, nombre, fechas, código, precio, teléfono, ubicación).
async function createReservationFromEmail(trip, email, close) {
  let parsed = {};
  try { parsed = parseReservationDoc(`${email.subject || ''}\n${await emailText(email)}`); }
  catch { /* si no se puede leer, se rellena a mano */ }
  let kind = parsed.kind;
  if (!kind) kind = await openModal(KindPicker);   // si no se adivina el tipo, se pregunta
  if (!kind) return;
  close?.();
  const docIds = trip.docs.filter(d => d.fromEmail === email.id).map(d => d.id);
  const r = { ...newReservation(kind), docIds, notes: `Del correo «${email.subject}» (${sender(email.from)}, ${fmtWhen(email.date)}).` };
  const filled = [];
  if (parsed.name) { r.title = parsed.name; filled.push('nombre'); }
  if (parsed.code) { r.code = parsed.code; filled.push('código'); }
  if (parsed.start) { r.start = parsed.start; filled.push('fechas'); }
  if (parsed.end) r.end = parsed.end;
  if (parsed.provider) r.provider = parsed.provider;
  if (parsed.phone) r.phone = parsed.phone;
  if (parsed.price) { r.price = { amount: parsed.price, currency: parsed.currency || trip.budget?.currency || 'EUR' }; filled.push('precio'); }
  if (parsed.name && ['hotel', 'restaurant', 'activity'].includes(kind)) {
    try {
      const hit = (await geocode(`${parsed.name}${trip.destination ? `, ${trip.destination}` : ''}`, { near: trip.center || undefined, limit: 1 }))[0] || (await geocode(parsed.name, { limit: 1 }))[0];
      if (hit) { r.location = { lat: hit.lat, lng: hit.lng, name: hit.name || parsed.name, address: hit.address || '' }; filled.push('ubicación'); }
    } catch { /* sin ubicación */ }
  }
  if (filled.length) toast(`Del correo he rellenado: ${filled.join(', ')}. Revísalo por si acaso.`, 'ok');
  openModal(ReservationForm, { trip, kind, res: r, isNew: true });
}

function MailReader({ close, trip, email, preview, onSave }) {
  const [doc, setDoc] = useState(preview ? emailDoc(preview) : null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (preview || !email?.bodyPath) { if (!preview && email) setDoc(emailDoc({ plain: email.snippet || '' })); return; }
    fileBlob(email.bodyPath).then(b => { offlineFiles.put(email.bodyPath, b); return b.text(); }).then(setDoc).catch(e => setErr(e.message));
  }, []);
  const m = preview || email;
  const savedDocs = email ? trip.docs.filter(d => d.fromEmail === email.id) : [];
  return html`<${Modal} title=${m.subject} close=${close} size="xl" class="viewer mail-reader"
    footer=${preview ? html`<${Btn} kind="ghost" onClick=${close}>Cerrar</${Btn}><${Btn} kind="primary" icon="paperclip" onClick=${() => { close(); onSave?.(); }}>Guardar en el viaje</${Btn}>`
      : html`<${Btn} kind="ghost" icon="trash" onClick=${async () => { if (await removeEmail(trip, email)) close(); }}>Quitar del viaje</${Btn}>
        <${Btn} icon="ticket" onClick=${() => createReservationFromEmail(trip, email, close)}>Crear reserva con este correo</${Btn}>
        ${email.gmailId && html`<a class="btn btn-default" href=${`https://mail.google.com/mail/u/0/#all/${email.threadId || email.gmailId}`} target="_blank" rel="noopener"><${Icon} name="external" size=${18} /><span>Abrir en Gmail</span></a>`}`}>
    <div class="mail-meta">
      <span><b>${sender(m.from)}</b> <small>${m.from?.includes('<') ? m.from.slice(m.from.indexOf('<')) : ''}</small></span>
      <span class="muted">${new Date(m.date).toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' })}</span>
    </div>
    ${savedDocs.length > 0 && html`<div class="mail-atts">${savedDocs.map(d => html`<span class="doc-pill" onClick=${() => { close(); go(`/viaje/${trip.id}/documentos`); }}><${Icon} name="paperclip" size=${14} />${d.name}</span>`)}</div>`}
    ${preview?.attachments?.length > 0 && html`<div class="mail-atts">${preview.attachments.map(a => html`<span class="doc-pill"><${Icon} name="paperclip" size=${14} />${a.name} <small>${fmtSize(a.size)}</small></span>`)}</div>`}
    <div class="viewer-stage viewer-mail">${err ? html`<p class="error">${err}</p>` : doc ? html`<${MailFrame} srcdoc=${doc} />` : html`<${Spinner} size=${28} />`}</div>
  </${Modal}>`;
}

async function removeEmail(trip, email) {
  const docs = trip.docs.filter(d => d.fromEmail === email.id);
  if (!await confirm('¿Quitar este correo del viaje?', docs.length ? `También se borrarán ${docs.length} adjunto(s) guardado(s) en Documentos. En Gmail no se borra nada.` : 'En Gmail no se borra nada.', { okLabel: 'Quitar', danger: true })) return false;
  updateTrip(trip.id, t => {
    t.emails = t.emails.filter(e => e.id !== email.id);
    t.docs = t.docs.filter(d => d.fromEmail !== email.id);
    for (const r of t.reservations) r.docIds = (r.docIds || []).filter(id => !docs.some(d => d.id === id));
  });
  removeFiles([email.bodyPath, ...docs.map(d => d.path)].filter(Boolean));
  toast('Correo quitado del viaje', 'ok');
  return true;
}

export async function saveEmail(trip, gmailId, { withAttachments = true } = {}) {
  const m = await gmailGet(gmailId);
  const id = sid();
  const body = new Blob([emailDoc(m)], { type: 'text/html' });
  const up = await uploadFile(trip.id, 'correos', body, `${id}.html`);
  const docs = [];
  if (withAttachments) {
    for (const a of m.attachments || []) {
      if (a.size > 45 * 1024 * 1024) { toast(`«${a.name}» es demasiado grande y no se ha guardado.`, 'error'); continue; }
      try {
        const data = await gmailAttachment(gmailId, a.index);
        const blob = base64ToBlob(data.data, data.mime || a.mime);
        const f = new File([blob], a.name, { type: data.mime || a.mime });
        const upA = await uploadFile(trip.id, 'docs', f, a.name);
        docs.push({ id: sid(), name: a.name.replace(/\.[^.]+$/, ''), file: a.name, kind: guessDocKind(`${a.name} ${m.subject}`, a.mime), path: upA.path, mime: upA.mime, size: upA.size, addedAt: new Date().toISOString(), fromEmail: id, note: `Adjunto del correo «${m.subject}»` });
      } catch (e) { toast(`No se pudo guardar el adjunto «${a.name}»: ${e.message}`, 'error'); }
    }
  }
  const email = { id, gmailId: m.id, threadId: m.threadId, subject: m.subject, from: m.from, date: m.date, snippet: (m.plain || '').replace(/\s+/g, ' ').trim().slice(0, 260), bodyPath: up.path, attachments: (m.attachments || []).map(a => ({ name: a.name, mime: a.mime, size: a.size })), savedAt: new Date().toISOString() };
  updateTrip(trip.id, t => { t.emails.push(email); t.docs.push(...docs); });
  return { email, docs };
}

function NotConnected() {
  return html`<${Empty} icon="mail" title="Conecta el correo de Gmail"
    text="Así podrás buscar los correos de confirmación de vuelos, hoteles y entradas y guardarlos dentro de cada viaje, con sus adjuntos. Se configura una sola vez y sirve en todos tus dispositivos.">
    <${Btn} kind="primary" icon="settings" onClick=${() => go('/ajustes/correo')}>Conectar Gmail</${Btn}>
  </${Empty}>`;
}

function Results({ trip, results, onSaved }) {
  const [sel, setSel] = useState(new Set());
  const [withAtt, setWithAtt] = useState(true);
  const [saving, setSaving] = useState(null);
  const saved = new Set(trip.emails.map(e => e.gmailId));
  const toggle = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const saveSel = async (ids) => {
    const list = ids || [...sel];
    if (!list.length) return;
    let n = 0;
    for (const id of list) {
      setSaving(id);
      try { await saveEmail(trip, id, { withAttachments: withAtt }); n++; }
      catch (e) { toast(`No se pudo guardar un correo: ${e.message}`, 'error'); }
    }
    setSaving(null); setSel(new Set());
    if (n) { toast(n > 1 ? `${n} correos guardados en el viaje` : 'Correo guardado en el viaje', 'ok'); onSaved?.(); }
  };
  const preview = async r => {
    try {
      const m = await gmailGet(r.id);
      openModal(MailReader, { trip, preview: m, onSave: () => saveSel([r.id]) });
    } catch (e) { toast(e.message, 'error'); }
  };
  if (!results.length) return html`<p class="muted pad-y">No hay correos que coincidan. Prueba con otra búsqueda.</p>`;
  return html`<div class="mail-results">
    <div class="mail-actions">
      <${Toggle} checked=${withAtt} onChange=${setWithAtt} label="Guardar también los adjuntos en Documentos" />
      <${Btn} kind="primary" icon="paperclip" disabled=${!sel.size || saving} onClick=${() => saveSel()}>${saving ? html`<${Spinner} size=${15} /> Guardando…` : sel.size ? `Guardar ${sel.size} en el viaje` : 'Marca los que quieras guardar'}</${Btn}>
    </div>
    <ul class="mail-list">
      ${results.map(r => {
        const isSaved = saved.has(r.id);
        return html`<li class=${cx('mail-row', isSaved && 'is-saved', sel.has(r.id) && 'is-selected')}>
          <label class="mail-check">${isSaved ? html`<${Icon} name="check-circle" size=${20} title="Ya está en el viaje" />` : html`<input type="checkbox" checked=${sel.has(r.id)} onChange=${() => toggle(r.id)} aria-label="Seleccionar" />`}</label>
          <button type="button" class="mail-open" onClick=${() => preview(r)}>
            <span class="mail-top"><b>${sender(r.from)}</b><span class="muted small">${fmtWhen(r.date)}</span></span>
            <span class="mail-subject">${r.subject}${r.count > 1 ? html` <small class="muted">(${r.count})</small>` : ''}</span>
            <span class="mail-snippet">${r.snippet}</span>
            ${r.attachments?.length > 0 && html`<span class="mail-attcount"><${Icon} name="paperclip" size=${13} /> ${r.attachments.map(a => a.name).join(', ')}</span>`}
          </button>
          ${saving === r.id && html`<${Spinner} size=${18} />`}
        </li>`;
      })}
    </ul>
  </div>`;
}

// Modal para revisar los correos que la app encontró sola para este viaje.
function MailSuggestions({ close, trip: trip0 }) {
  useStore(s => s.trips);
  useStore(s => s.mailScan);
  const trip = useStore(s => s.trips.find(t => t.id === trip0.id)) || trip0;
  const cands = mailCandidates(trip0.id);
  const discardAll = () => { if (cands.length) dismissCandidates(trip0.id, cands.map(c => c.id)); close(); };
  return html`<${Modal} title="Correos encontrados para este viaje" close=${close} size="lg" class="mail-reader"
    footer=${html`<${Btn} kind="ghost" onClick=${close}>Cerrar</${Btn}>${cands.length > 0 && html`<${Btn} kind="ghost" icon="x" onClick=${discardAll}>Descartar todos</${Btn}>`}`}>
    ${cands.length === 0
      ? html`<${Empty} icon="mail" title="Nada pendiente" text="Ya has revisado los correos que encontré. Buscaré de nuevo más adelante." />`
      : html`<p class="mail-suggest-note">Los he buscado en tu Gmail con el destino, las fechas y tus reservas. Marca los que sean de este viaje para guardarlos; los demás puedes descartarlos.</p>
        <${Results} trip=${trip} results=${cands} onSaved=${() => {}} />`}
  </${Modal}>`;
}

export const openMailSuggestions = trip => openModal(MailSuggestions, { trip });

// Aviso que aparece en el viaje cuando hay correos nuevos que podrían añadirse.
export function MailSuggestionsBanner({ trip }) {
  useStore(s => s.mailScan);
  const sc = mailScanState(trip.id);
  const n = sc?.candidates?.length || 0;
  if (!n) return null;
  return html`<div class="mail-suggest" role="status">
    <${Icon} name="mail" size=${18} />
    <span>He encontrado <b>${n}</b> ${n > 1 ? 'correos que podrían ser' : 'correo que podría ser'} de este viaje.</span>
    <${Btn} kind="primary" icon="search" onClick=${() => openMailSuggestions(trip)}>Revisar</${Btn}>
    <${IconBtn} icon="x" label="Descartar todos" onClick=${() => dismissCandidates(trip.id, sc.candidates.map(c => c.id))} />
  </div>`;
}

export function MailTab({ trip }) {
  useStore(s => s.settings);
  const connected = gmailConfigured();
  const [q, setQ] = useState(() => suggestedQuery(trip));
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [showQ, setShowQ] = useState(false);
  const [searchOpen, setSearchOpen] = useState(trip.emails.length === 0);
  const ran = useRef(false);

  const run = async (query = q) => {
    setBusy(true); setErr(null);
    try { setResults((await gmailSearch(query, 40)).sort((a, b) => b.date.localeCompare(a.date))); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  useEffect(() => {
    if (connected && searchOpen && !ran.current) { ran.current = true; run(); }
  }, [connected, searchOpen]);

  if (!connected && !trip.emails.length) return html`<div class="page-pad"><${NotConnected} /></div>`;
  const emails = [...trip.emails].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return html`<div class="page-pad mail-tab">
    ${emails.length > 0 && html`<section class="mail-saved">
      <div class="toolbar"><h3 class="section-title">Correos guardados</h3>
        ${connected && !searchOpen && html`<${Btn} kind="primary" icon="search" onClick=${() => setSearchOpen(true)}>Buscar más en Gmail</${Btn}>`}</div>
      <ul class="mail-list">
        ${emails.map(e => html`<li class="mail-row">
          <span class="mail-check"><${Icon} name="mail" size=${18} /></span>
          <button type="button" class="mail-open" onClick=${() => openModal(MailReader, { trip, email: e })}>
            <span class="mail-top"><b>${sender(e.from)}</b><span class="muted small">${fmtWhen(e.date)}</span></span>
            <span class="mail-subject">${e.subject}</span>
            <span class="mail-snippet">${e.snippet}</span>
            ${trip.docs.some(d => d.fromEmail === e.id) && html`<span class="mail-attcount"><${Icon} name="paperclip" size=${13} /> ${trip.docs.filter(d => d.fromEmail === e.id).length} adjunto(s) en Documentos</span>`}
          </button>
          <${IconBtn} icon="trash" label="Quitar del viaje" onClick=${() => removeEmail(trip, e)} />
        </li>`)}
      </ul>
    </section>`}

    ${connected && searchOpen && html`<section class="mail-search">
      <div class="toolbar"><h3 class="section-title">Buscar en Gmail</h3>
        ${emails.length > 0 && html`<${IconBtn} icon="x" label="Cerrar búsqueda" onClick=${() => setSearchOpen(false)} />`}</div>
      <p class="muted small">He preparado una búsqueda con el destino, las fechas y tus reservas. Marca los correos que sean de este viaje.</p>
      <div class="chips">
        <${Chip} active=${q === suggestedQuery(trip)} icon="sparkle" onClick=${() => { const s = suggestedQuery(trip); setQ(s); run(s); }}>Sugeridos para este viaje</${Chip}>
        ${quickQueries(trip).map(x => html`<${Chip} active=${q === x.q} onClick=${() => { setQ(x.q); run(x.q); }}>${x.label}</${Chip}>`)}
      </div>
      <form class="search-row" onSubmit=${e => { e.preventDefault(); run(); }}>
        ${showQ ? html`<input class="input" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Búsqueda de Gmail" />`
          : html`<input class="input" placeholder="Buscar por palabras: hotel, Iberia, código…" onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value.trim(); if (v) { setQ(v); run(v); } } }} aria-label="Buscar en Gmail" />`}
        <${Btn} type="submit" icon="search" disabled=${busy}>Buscar</${Btn}>
      </form>
      <button type="button" class="link-btn small" onClick=${() => setShowQ(s => !s)}>${showQ ? 'Ocultar la búsqueda avanzada' : 'Ver o editar la búsqueda avanzada'}</button>
      ${err && html`<p class="error">${err}</p>`}
      ${busy ? html`<div class="pad-y center"><${Spinner} size=${24} /></div>` : results && html`<${Results} trip=${trip} results=${results} onSaved=${() => {}} />`}
    </section>`}
    ${!connected && html`<p class="muted small">Para buscar más correos, <a href="#/ajustes/correo">conecta Gmail en Ajustes</a>.</p>`}
  </div>`;
}
