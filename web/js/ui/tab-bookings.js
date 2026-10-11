// Pestaña Reservas: vuelos, alojamientos, trenes… con sus códigos y billetes.
import { html, useState } from '../../vendor/preact-htm.js';
import { Btn, Icon, Empty, Chip, openModal, confirm, Modal, copyText } from './kit.js';
import { ReservationForm, KindPicker } from './res-form.js';
import { openDoc } from './tab-docs.js';
import { RES_KINDS, resTitle, isTransport, DOC_KINDS } from '../lib/model.js';
import { updateTrip, toast } from '../lib/store.js';
import { fmtDateTime, fmtDate, dateOnly, timeOnly, fmtMoney, daysBetween } from '../lib/util.js';
import { googleMapsUrl, appleMapsUrl, isApple, distanceKm } from '../lib/geo.js';
import { go, tripPath } from '../lib/router.js';

export async function addReservation(trip, kind) {
  const k = kind || await openModal(KindPicker);
  if (!k) return;
  return openModal(ReservationForm, { trip, kind: k });
}

export function editReservation(trip, res) { return openModal(ReservationForm, { trip, res }); }

export async function removeReservation(trip, res) {
  if (!await confirm('¿Borrar esta reserva?', `«${resTitle(res)}» se quitará del viaje. Sus documentos se conservan en la pestaña Documentos.`, { okLabel: 'Borrar', danger: true })) return false;
  updateTrip(trip.id, t => {
    t.reservations = t.reservations.filter(x => x.id !== res.id);
    for (const d of t.docs) if (d.resId === res.id) d.resId = null;
  });
  toast('Reserva borrada', 'ok');
  return true;
}

function Route({ r }) {
  const a = r.from, b = r.to;
  // La duración no se calcula: las horas son locales y origen y destino pueden tener husos distintos.
  const km = a?.lat != null && b?.lat != null ? Math.round(distanceKm(a, b)) : null;
  return html`<div class="leg">
    <div class="leg-end">
      <span class="leg-code">${r.kind === 'flight' ? (a?.iata || '—') : timeOnly(r.start) || '—'}</span>
      <span class="leg-place">${r.kind === 'flight' ? a?.name : a?.name || ''}</span>
      ${r.kind === 'flight' && timeOnly(r.start) && html`<span class="leg-time">${timeOnly(r.start)}</span>`}
    </div>
    <div class="leg-line"><span></span><${Icon} name=${RES_KINDS[r.kind].icon} size=${16} /><span></span>
      ${km ? html`<small>${km.toLocaleString('es-ES')} km</small>` : ''}</div>
    <div class="leg-end leg-end-r">
      <span class="leg-code">${r.kind === 'flight' ? (b?.iata || '—') : timeOnly(r.end) || '—'}</span>
      <span class="leg-place">${b?.name || ''}</span>
      ${r.kind === 'flight' && timeOnly(r.end) && html`<span class="leg-time">${timeOnly(r.end)}${r.end && r.start && dateOnly(r.end) !== dateOnly(r.start) ? html`<sup>+${daysBetween(dateOnly(r.start), dateOnly(r.end))}</sup>` : ''}</span>`}
    </div>
  </div>`;
}

export function ResCard({ trip, r, onOpen }) {
  const k = RES_KINDS[r.kind] || RES_KINDS.other;
  const docs = trip.docs.filter(d => r.docIds?.includes(d.id) || d.resId === r.id);
  const route = isTransport(r.kind) && (r.from || r.to);
  const nights = r.kind === 'hotel' && r.start && r.end ? daysBetween(dateOnly(r.start), dateOnly(r.end)) : null;
  return html`<article class="res-card" style=${`--kc:${k.color}`}>
    <button type="button" class="res-main" onClick=${() => onOpen(r)}>
      <div class="res-head">
        <span class="res-ico"><${Icon} name=${k.icon} size=${18} /></span>
        <div class="res-head-text">
          <span class="res-kind">${k.label}${r.provider ? ` · ${r.provider}` : ''}${r.number ? ` ${r.number}` : ''}</span>
          <h3>${resTitle(r, { short: true })}</h3>
        </div>
      </div>
      ${route ? html`<${Route} r=${r} />` : ''}
      <div class="res-facts">
        ${r.start && html`<span><${Icon} name="calendar" size=${15} />${r.kind === 'hotel' ? `${fmtDate(dateOnly(r.start), 'weekday')} → ${r.end ? fmtDate(dateOnly(r.end), 'weekday') : '…'}${nights ? ` · ${nights} ${nights === 1 ? 'noche' : 'noches'}` : ''}` : fmtDateTime(r.start)}</span>`}
        ${!route && r.location?.address && html`<span><${Icon} name="pin" size=${15} />${r.location.address}</span>`}
        ${r.seat && html`<span><${Icon} name="users" size=${15} />${r.seat}</span>`}
        ${r.price?.amount && html`<span><${Icon} name="wallet" size=${15} />${fmtMoney(r.price.amount, r.price.currency)}</span>`}
      </div>
    </button>
    ${(r.code || docs.length > 0) && html`<div class="res-foot">
      ${r.code && html`<button type="button" class="code-pill" title="Copiar código" onClick=${() => copyText(r.code).then(() => toast('Código copiado', 'ok'))}>
        <small>Código</small><b>${r.code}</b><${Icon} name="copy" size=${14} /></button>`}
      ${docs.map(d => html`<button type="button" class="doc-pill" onClick=${() => openDoc(trip, d)}><${Icon} name=${DOC_KINDS[d.kind]?.icon || 'file'} size=${15} /><span>${d.name}</span></button>`)}
    </div>`}
  </article>`;
}

function ResDetail({ close, trip, r }) {
  const k = RES_KINDS[r.kind];
  const pts = [r.from, r.to, r.location].filter(p => p && p.lat != null);
  const where = r.location?.lat != null ? r.location : r.kind === 'car' ? r.from : r.to;
  return html`<${Modal} title=${k.label} close=${close} size="md"
    footer=${html`
      <${Btn} kind="ghost" icon="trash" onClick=${async () => { if (await removeReservation(trip, r)) close(); }}>Borrar</${Btn}>
      <${Btn} kind="primary" icon="edit" onClick=${() => { close(); editReservation(trip, r); }}>Editar</${Btn}>`}>
    <${ResCard} trip=${trip} r=${r} onOpen=${() => {}} />
    <dl class="details">
      ${r.start && html`<dt>${r.kind === 'hotel' ? 'Entrada' : 'Inicio'}</dt><dd>${fmtDateTime(r.start)}</dd>`}
      ${r.end && html`<dt>${r.kind === 'hotel' ? 'Salida' : 'Fin'}</dt><dd>${fmtDateTime(r.end)}</dd>`}
      ${r.terminal && html`<dt>Terminal / puerta</dt><dd>${r.terminal}</dd>`}
      ${r.phone && html`<dt>Teléfono</dt><dd><a href=${`tel:${r.phone.replace(/\s+/g, '')}`}>${r.phone}</a></dd>`}
      ${r.notes && html`<dt>Notas</dt><dd class="pre">${r.notes}</dd>`}
    </dl>
    ${pts.length > 0 && html`<div class="btn-row">
      <${Btn} icon="map" size="sm" onClick=${() => { close(); go(`${tripPath(trip.id, 'mapa')}/r-${r.id}`); }}>Ver en el mapa</${Btn}>
      ${where?.lat != null && html`<a class="btn btn-default btn-sm" href=${isApple() ? appleMapsUrl(where) : googleMapsUrl(where)} target="_blank" rel="noopener"><${Icon} name="navigation" size=${16} /><span>Cómo llegar</span></a>`}
    </div>`}
  </${Modal}>`;
}

export const openReservation = (trip, r) => openModal(ResDetail, { trip, r });

export function BookingsTab({ trip }) {
  const [filter, setFilter] = useState('all');
  const list = [...trip.reservations].sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'));
  const kinds = [...new Set(list.map(r => r.kind))];
  const shown = filter === 'all' ? list : list.filter(r => r.kind === filter);
  const byDay = new Map();
  for (const r of shown) {
    const d = dateOnly(r.start) || 'sin-fecha';
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(r);
  }
  const total = list.reduce((acc, r) => { if (r.price?.amount) acc[r.price.currency] = (acc[r.price.currency] || 0) + r.price.amount; return acc; }, {});
  return html`<div class="page-pad">
    <div class="toolbar">
      <div class="toolbar-left chips">
        ${kinds.length > 1 && html`<${Chip} active=${filter === 'all'} onClick=${() => setFilter('all')} count=${list.length}>Todas</${Chip}>`}
        ${kinds.length > 1 && kinds.map(k => html`<${Chip} active=${filter === k} icon=${RES_KINDS[k].icon} onClick=${() => setFilter(k)} count=${list.filter(r => r.kind === k).length}>${RES_KINDS[k].label}</${Chip}>`)}
      </div>
      <${Btn} kind="primary" icon="plus" onClick=${() => addReservation(trip)}>Añadir reserva</${Btn}>
    </div>
    ${!list.length ? html`<${Empty} icon="ticket" title="Sin reservas todavía"
        text="Guarda aquí vuelos, hoteles, trenes, coches, entradas o restaurantes. Con sus códigos de reserva y sus billetes a mano.">
        <div class="quick-kinds">${['flight', 'hotel', 'train', 'activity'].map(k => html`<${Btn} icon=${RES_KINDS[k].icon} onClick=${() => addReservation(trip, k)}>${RES_KINDS[k].label}</${Btn}>`)}</div>
      </${Empty}>`
      : html`${[...byDay.entries()].map(([d, rs]) => html`<section class="day-block">
          <h3 class="day-title">${d === 'sin-fecha' ? 'Sin fecha' : fmtDate(d, 'daylong')}</h3>
          <div class="res-list">${rs.map(r => html`<${ResCard} key=${r.id} trip=${trip} r=${r} onOpen=${x => openReservation(trip, x)} />`)}</div>
        </section>`)}
        ${Object.keys(total).length > 0 && html`<p class="muted total-line">Total en reservas: ${Object.entries(total).map(([c, v]) => fmtMoney(v, c)).join(' + ')}</p>`}`}
  </div>`;
}
