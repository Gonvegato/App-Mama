// Formulario de reservas: vuelos, alojamientos, trenes, coches, actividades…
import { html, useState } from '../../vendor/preact-htm.js';
import { Modal, Btn, Field, Icon, pickFiles, Spinner, Select } from './kit.js';
import { PlaceSearch, AirportPicker } from './pickers.js';
import { RES_KINDS, newReservation, isTransport, DOC_KINDS } from '../lib/model.js';
import { updateTrip, uploadFile, toast, removeFiles } from '../lib/store.js';
import { CURRENCIES, dateOnly, timeOnly, parseAmount, sid, cx } from '../lib/util.js';
import { resizeImage } from '../lib/image.js';
import { linkPreview, classifyLink } from '../lib/links.js';
import { geocode } from '../lib/geo.js';

export function DateTime({ value, onChange, min, defaultTime }) {
  const d = dateOnly(value), t = timeOnly(value);
  const emit = (nd, nt) => onChange(nd ? (nt ? `${nd}T${nt}` : nd) : '');
  return html`<div class="datetime">
    <input class="input" type="date" value=${d} min=${min} onInput=${e => emit(e.target.value, t || (e.target.value && !d ? defaultTime || '' : t))} aria-label="Fecha" />
    <input class="input input-time" type="time" value=${t} onInput=${e => emit(d, e.target.value)} disabled=${!d} aria-label="Hora" />
  </div>`;
}

export function KindPicker({ close }) {
  return html`<${Modal} title="Nueva reserva" close=${() => close(null)} size="md">
    <p class="muted">¿Qué quieres guardar?</p>
    <div class="kind-grid">
      ${Object.entries(RES_KINDS).map(([k, v]) => html`<button type="button" class="kind-btn" style=${`--kc:${v.color}`} onClick=${() => close(k)}>
        <span class="kind-ico"><${Icon} name=${v.icon} size=${22} /></span><span>${v.label}</span></button>`)}
    </div>
  </${Modal}>`;
}

const LABELS = {
  flight: { provider: 'Aerolínea', number: 'Número de vuelo', start: 'Salida', end: 'Llegada', seat: 'Asiento', terminal: 'Terminal / puerta' },
  train: { provider: 'Compañía', number: 'Número de tren', start: 'Salida', end: 'Llegada', seat: 'Coche y asiento', from: 'Estación de salida', to: 'Estación de llegada' },
  bus: { provider: 'Compañía', number: 'Número de servicio', start: 'Salida', end: 'Llegada', seat: 'Asiento', from: 'Sale de', to: 'Llega a' },
  ferry: { provider: 'Naviera', number: 'Barco o trayecto', start: 'Salida', end: 'Llegada', seat: 'Camarote o butaca', from: 'Puerto de salida', to: 'Puerto de llegada' },
  hotel: { title: 'Nombre del alojamiento', provider: 'Reservado en (Booking, Airbnb…)', start: 'Entrada', end: 'Salida', location: 'Dirección' },
  car: { provider: 'Empresa de alquiler', start: 'Recogida', end: 'Devolución', from: 'Lugar de recogida', to: 'Lugar de devolución', number: 'Coche / matrícula' },
  activity: { title: 'Qué es', provider: 'Organiza o vende', start: 'Cuándo', end: 'Hasta (opcional)', location: 'Dónde' },
  restaurant: { title: 'Restaurante', start: 'Cuándo', location: 'Dónde', seat: 'Personas' },
  other: { title: 'Qué es', provider: 'Empresa', start: 'Cuándo', end: 'Hasta (opcional)', location: 'Dónde' },
};

export function ReservationForm({ close, trip, res, kind: kindProp, isNew }) {
  const editing = !!res && !isNew;
  const [r, setR] = useState(() => res ? { ...res, docIds: [...(res.docIds || [])] } : newReservation(kindProp || 'flight'));
  const [price, setPrice] = useState(() => (res?.price?.amount ? String(res.price.amount).replace('.', ',') : ''));
  const [currency, setCurrency] = useState(res?.price?.currency || trip.budget?.currency || 'EUR');
  const [uploading, setUploading] = useState(false);
  const [newDocs, setNewDocs] = useState([]);
  const [fetchingLink, setFetchingLink] = useState(false);
  const set = patch => setR(s => ({ ...s, ...patch }));

  // Rellena nombre, ubicación y foto a partir del enlace (Booking, Airbnb, web del hotel…).
  const fillFromLink = async () => {
    const url = (r.url || '').trim();
    if (!url) return;
    if (classifyLink(url).kind === 'invalid') { toast('Escribe una dirección web completa (https://…).', 'error'); return; }
    setFetchingLink(true);
    try {
      const p = await linkPreview(url, { refresh: true });
      if (!p) { toast('No he podido leer el enlace. Rellénalo a mano; el enlace se guarda igual.', 'error'); return; }
      const patch = {};
      const name = p.name || p.title;
      if (name && !r.title.trim()) patch.title = name;
      if (p.site && !r.provider?.trim()) patch.provider = p.site.replace(/\.com$/i, '');
      // Ubicación: coordenadas del propio enlace si las trae; si no, se busca por el nombre.
      if (r.location?.lat == null) {
        if (p.coords) patch.location = { lat: p.coords.lat, lng: p.coords.lng, name: name || 'Alojamiento', address: '' };
        else if (name) {
          try {
            const hit = (await geocode(`${name}${trip.destination ? `, ${trip.destination}` : ''}`, { near, limit: 1 }))[0] || (await geocode(name, { limit: 1 }))[0];
            if (hit) patch.location = { lat: hit.lat, lng: hit.lng, name: hit.name || name, address: hit.address || '' };
          } catch { /* sin ubicación */ }
        }
      }
      if (Object.keys(patch).length) set(patch);
      toast(patch.location ? 'Datos y ubicación traídos del enlace' : name ? 'Datos traídos del enlace' : 'Enlace guardado (sin datos extra)', 'ok');
    } finally { setFetchingLink(false); }
  };
  const L = LABELS[r.kind] || LABELS.other;
  const near = trip.center || undefined;
  const k = RES_KINDS[r.kind];
  const transport = isTransport(r.kind) || r.kind === 'car';

  const uploadDoc = async () => {
    const files = await pickFiles({ accept: 'image/*,application/pdf,.pdf,.pkpass,.doc,.docx' });
    if (!files.length) return;
    setUploading(true);
    try {
      for (const f0 of files) {
        const f = f0.type.startsWith('image/') ? await resizeImage(f0) : f0;
        const up = await uploadFile(trip.id, 'docs', f, f0.name);
        const doc = { id: sid(), name: f0.name, kind: r.kind === 'hotel' ? 'reserva' : (r.kind === 'activity' ? 'entrada' : 'billete'), path: up.path, mime: up.mime, size: up.size, addedAt: new Date().toISOString() };
        setNewDocs(d => [...d, doc]);
        setR(s => ({ ...s, docIds: [...s.docIds, doc.id] }));
      }
    } catch (e) { toast(`No se pudo subir: ${e.message}`, 'error'); }
    setUploading(false);
  };

  const save = () => {
    if (r.end && r.start && dateOnly(r.end) < dateOnly(r.start)) { toast('La fecha de fin es anterior a la de inicio.', 'error'); return; }
    const amount = parseAmount(price);
    const out = { ...r, price: amount ? { amount, currency } : null };
    updateTrip(trip.id, t => {
      for (const d of newDocs) t.docs.push({ ...d, resId: out.id });
      const i = t.reservations.findIndex(x => x.id === out.id);
      if (i >= 0) t.reservations[i] = out; else t.reservations.push(out);
      // Mantiene el enlace en los documentos.
      for (const d of t.docs) {
        if (out.docIds.includes(d.id)) d.resId = out.id;
        else if (d.resId === out.id) d.resId = null;
      }
    });
    toast(editing ? 'Reserva guardada' : 'Reserva añadida', 'ok');
    close(out);
  };

  const cancel = () => { if (newDocs.length) removeFiles(newDocs.map(d => d.path)); close(null); };

  const allDocs = [...trip.docs.filter(d => d.kind !== 'enlace' || d.url), ...newDocs];

  return html`<${Modal} title=${`${editing ? 'Editar' : 'Nueva'}: ${k.label.toLowerCase()}`} close=${cancel} size="lg" onSubmit=${save} class="res-form"
    footer=${html`<${Btn} kind="ghost" onClick=${cancel}>Cancelar</${Btn}><${Btn} kind="primary" type="submit">${editing ? 'Guardar' : 'Añadir reserva'}</${Btn}>`}>
    ${!editing && html`<div class="kind-switch">
      ${Object.entries(RES_KINDS).map(([kk, v]) => html`<button type="button" class=${cx('kind-mini', kk === r.kind && 'is-active')} onClick=${() => set({ kind: kk })} title=${v.label} aria-label=${v.label}><${Icon} name=${v.icon} size=${18} /></button>`)}
    </div>`}
    <div class="form-grid">
      ${r.kind === 'flight' ? html`
        <div class="field-row">
          <${Field} label="Origen"><${AirportPicker} value=${r.from} onChange=${v => set({ from: v })} /></${Field}>
          <${Field} label="Destino"><${AirportPicker} value=${r.to} onChange=${v => set({ to: v })} /></${Field}>
        </div>` : transport ? html`
        <div class="field-row">
          <${Field} label=${L.from || 'Desde'}><${PlaceSearch} value=${r.from} onChange=${v => set({ from: v })} near=${near} /></${Field}>
          <${Field} label=${L.to || 'Hasta'}><${PlaceSearch} value=${r.to} onChange=${v => set({ to: v })} near=${near} /></${Field}>
        </div>` : html`
        <${Field} label=${L.title || 'Nombre'}><input class="input input-lg" value=${r.title} onInput=${e => set({ title: e.target.value })} placeholder=${r.kind === 'hotel' ? 'Ej.: Hotel Avenida' : ''} /></${Field}>
        <${Field} label=${L.location || 'Lugar'} hint=${r.kind === 'hotel' ? 'Búscalo para que aparezca en el mapa.' : ''}>
          <${PlaceSearch} value=${r.location} near=${near} placeholder=${r.title ? `Ej.: ${r.title}` : 'Nombre o dirección'}
            onChange=${v => set({ location: v, title: r.title || v?.name || '' })} /></${Field}>`}

      ${!isTransport(r.kind) && html`<${Field} label=${r.kind === 'hotel' ? 'Enlace del alojamiento (Booking, Airbnb, web…)' : 'Enlace (opcional)'}
        hint="Pega el enlace y pulsa «Traer datos»: rellena el nombre y la ubicación y guarda una foto para verla aquí.">
        <div class="link-fill">
          <input class="input" type="url" value=${r.url || ''} onInput=${e => set({ url: e.target.value })}
            onBlur=${() => { if ((r.url || '').trim() && !r.title.trim() && r.location?.lat == null) fillFromLink(); }}
            placeholder="https://www.booking.com/…  ·  https://airbnb.com/…" />
          <${Btn} size="sm" icon=${fetchingLink ? undefined : 'download'} disabled=${fetchingLink || !(r.url || '').trim()} onClick=${fillFromLink}>${fetchingLink ? html`<${Spinner} size=${14} /> Leyendo…` : 'Traer datos'}</${Btn}>
        </div>
      </${Field}>`}

      <div class="field-row">
        <${Field} label=${L.start || 'Inicio'}><${DateTime} value=${r.start} onChange=${v => set({ start: v })} min=${undefined} defaultTime=${r.kind === 'hotel' ? '15:00' : ''} /></${Field}>
        ${(L.end || transport) && html`<${Field} label=${L.end || 'Fin'}><${DateTime} value=${r.end} onChange=${v => set({ end: v })} min=${dateOnly(r.start) || undefined} defaultTime=${r.kind === 'hotel' ? '12:00' : ''} /></${Field}>`}
      </div>

      <div class="field-row field-row-3">
        ${L.provider && html`<${Field} label=${L.provider}><input class="input" value=${r.provider} onInput=${e => set({ provider: e.target.value })} /></${Field}>`}
        ${L.number && html`<${Field} label=${L.number}><input class="input" value=${r.number} onInput=${e => set({ number: e.target.value.toUpperCase() })} placeholder=${r.kind === 'flight' ? 'Ej.: IB3456' : ''} /></${Field}>`}
        <${Field} label="Código de reserva"><input class="input input-code" value=${r.code} onInput=${e => set({ code: e.target.value.toUpperCase() })} placeholder="Ej.: X7KQ2L" autocapitalize="characters" /></${Field}>
      </div>

      <div class="field-row field-row-3">
        ${L.seat && html`<${Field} label=${L.seat}><input class="input" value=${r.seat} onInput=${e => set({ seat: e.target.value })} /></${Field}>`}
        ${L.terminal && html`<${Field} label=${L.terminal}><input class="input" value=${r.terminal || ''} onInput=${e => set({ terminal: e.target.value })} /></${Field}>`}
        ${(r.kind === 'hotel' || r.kind === 'restaurant' || r.kind === 'car') && html`<${Field} label="Teléfono"><input class="input" type="tel" value=${r.phone || ''} onInput=${e => set({ phone: e.target.value })} /></${Field}>`}
        <${Field} label="Precio">
          <div class="money-input">
            <input class="input" inputmode="decimal" value=${price} onInput=${e => setPrice(e.target.value)} placeholder="0,00" />
            <${Select} class="input" value=${currency} onChange=${e => setCurrency(e.target.value)} aria-label="Moneda">${CURRENCIES.map(c => html`<option value=${c}>${c}</option>`)}</${Select}>
          </div>
        </${Field}>
      </div>

      <${Field} label="Notas"><textarea class="input" rows="3" value=${r.notes} onInput=${e => set({ notes: e.target.value })} placeholder="Equipaje incluido, cómo llegar, qué llevar…"></textarea></${Field}>

      <div class="field">
        <span class="field-label">Billetes y documentos de esta reserva</span>
        ${allDocs.length > 0 && html`<div class="doc-checks">
          ${allDocs.map(d => html`<label class="check-pill">
            <input type="checkbox" checked=${r.docIds.includes(d.id)} onChange=${e => set({ docIds: e.target.checked ? [...r.docIds, d.id] : r.docIds.filter(x => x !== d.id) })} />
            <${Icon} name=${DOC_KINDS[d.kind]?.icon || 'file'} size=${15} /><span>${d.name}</span></label>`)}
        </div>`}
        <div><${Btn} icon=${uploading ? undefined : 'upload'} size="sm" onClick=${uploadDoc} disabled=${uploading}>${uploading ? html`<${Spinner} size=${14} /> Subiendo…` : 'Subir billete o justificante'}</${Btn}></div>
      </div>
    </div>
  </${Modal}>`;
}
