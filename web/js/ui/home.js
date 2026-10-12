// Pantalla de inicio: viaje en curso o próximo, y todos los viajes.
import { html } from '../../vendor/preact-htm.js';
import { Btn, Icon, IconBtn, openModal, Empty, Progress } from './kit.js';
import { Cover } from './cover.js';
import { TripForm } from './trip-form.js';
import { SyncBadge } from './sidebar.js';
import { AgendaItem } from './tab-itinerary.js';
import { StorageWarning } from './storage.js';
import { useStore } from '../lib/store.js';
import { sortTrips, buildAgenda, tripStats } from '../lib/model.js';
import { fmtRange, tripStatus, greeting, fmtDate, todayISO, plural } from '../lib/util.js';
import { go, tripPath } from '../lib/router.js';

function TripCard({ trip, size }) {
  const st = tripStatus(trip);
  return html`<a class=${`trip-card ${size === 'sm' ? 'trip-card-sm' : ''}`} href=${`#${tripPath(trip.id)}`}>
    <${Cover} trip=${trip} class="trip-card-cover" thumb>
      ${st.kind !== 'past' && st.kind !== 'nodate' && html`<span class=${`badge badge-${st.kind}`}>${st.label}</span>`}
    </${Cover}>
    <div class="trip-card-body">
      <h3>${trip.title || trip.destination || 'Sin nombre'}</h3>
      <p>${trip.startDate ? fmtRange(trip.startDate, trip.endDate) : 'Sin fechas'}${trip.destination && trip.destination !== trip.title ? html` · ${trip.destination}` : ''}</p>
    </div>
  </a>`;
}

function NowCard({ trip }) {
  const st = tripStatus(trip);
  const today = todayISO();
  const agenda = buildAgenda(trip).days.find(d => d.day === today);
  return html`<section class="feature feature-now">
    <${Cover} trip=${trip} class="feature-cover">
      <div class="feature-overlay">
        <span class="eyebrow">Estás de viaje · ${st.label}</span>
        <h2>${trip.title || trip.destination}</h2>
        <p>${fmtRange(trip.startDate, trip.endDate)}</p>
      </div>
    </${Cover}>
    <div class="feature-body">
      <h3 class="section-title">Hoy, ${fmtDate(today, 'daylong').toLowerCase()}</h3>
      ${agenda?.items.length
        ? html`<ul class="agenda agenda-compact">${agenda.items.map(it => html`<${AgendaItem} item=${it} trip=${trip} compact />`)}</ul>`
        : html`<p class="muted">Nada programado para hoy. ¡Día libre!</p>`}
      <div class="feature-actions">
        <${Btn} kind="primary" icon="arrow-right" onClick=${() => go(tripPath(trip.id))}>Abrir el viaje</${Btn}>
        <${Btn} icon="map" onClick=${() => go(tripPath(trip.id, 'mapa'))}>Mapa</${Btn}>
        <${Btn} icon="ticket" onClick=${() => go(tripPath(trip.id, 'documentos'))}>Billetes</${Btn}>
      </div>
    </div>
  </section>`;
}

// Cosas que faltan por preparar (solo a partir de lo que hay guardado en el viaje).
function pendingTasks(trip, st) {
  const out = [];
  const has = k => trip.reservations.some(r => r.kind === k);
  const transport = trip.reservations.some(r => ['flight', 'train', 'bus', 'ferry', 'car'].includes(r.kind));
  if (!transport) out.push({ text: 'Añadir cómo vas a ir (vuelo, tren…)', tab: 'reservas' });
  if (!has('hotel') && trip.startDate !== trip.endDate) out.push({ text: 'Añadir el alojamiento', tab: 'reservas' });
  if (has('flight') && !trip.docs.some(d => d.kind === 'billete')) out.push({ text: 'Subir las tarjetas de embarque o billetes', tab: 'documentos' });
  if (st.days <= 7 && (!trip.packing.length || trip.packing.some(p => !p.done))) out.push({ text: trip.packing.length ? `Terminar la maleta (faltan ${trip.packing.filter(p => !p.done).length})` : 'Preparar la lista de la maleta', tab: 'maleta' });
  return out.slice(0, 4);
}

function NextCard({ trip }) {
  const st = tripStatus(trip);
  const s = tripStats(trip);
  const todo = st.days <= 30 ? pendingTasks(trip, st) : [];
  return html`<section class="feature">
    <${Cover} trip=${trip} class="feature-cover">
      <div class="feature-overlay">
        <span class="eyebrow">Próximo viaje</span>
        <h2>${trip.title || trip.destination}</h2>
        <p>${fmtRange(trip.startDate, trip.endDate)}</p>
      </div>
    </${Cover}>
    <div class="feature-body feature-next">
      <div class="countdown">
        <span class="countdown-n">${st.days}</span>
        <span class="countdown-l">${st.days === 1 ? 'día para salir' : 'días para salir'}</span>
      </div>
      <ul class="prep">
        <li><${Icon} name="ticket" size=${17} /><span>${plural(s.reservations, 'reserva', 'reservas')}</span></li>
        <li><${Icon} name="file" size=${17} /><span>${plural(s.docs, 'documento', 'documentos')}</span></li>
        <li><${Icon} name="pin" size=${17} /><span>${plural(s.places, 'lugar', 'lugares')} en el mapa</span></li>
        <li><${Icon} name="suitcase" size=${17} /><span>${s.packing ? `Maleta: ${s.packed} de ${s.packing}` : 'Maleta sin preparar'}</span>
          ${s.packing > 0 && html`<${Progress} value=${s.packed} max=${s.packing} label="Maleta" />`}</li>
      </ul>
      ${todo.length > 0 && html`<div class="todo">
        <span class="eyebrow">Por preparar</span>
        <ul>${todo.map(t => html`<li><a href=${`#${tripPath(trip.id, t.tab)}`}><${Icon} name="circle" size=${14} /><span>${t.text}</span><${Icon} name="chevron-right" size=${14} /></a></li>`)}</ul>
      </div>`}
      <div class="feature-actions"><${Btn} kind="primary" icon="arrow-right" onClick=${() => go(tripPath(trip.id))}>Abrir el viaje</${Btn}></div>
    </div>
  </section>`;
}

export function Home() {
  const trips = useStore(s => s.trips);
  const g = sortTrips(trips);
  const feature = g.now[0] || g.upcoming[0];
  const rest = [...g.now.slice(1), ...g.upcoming.filter(t => t !== feature && !g.now.includes(t)), ...g.nodate].filter(t => t !== feature);
  return html`<div class="page home">
    <div class="mobile-bar only-mobile">
      <span class="brand"><span class="brand-mark"><${Icon} name="compass" size=${18} /></span><span class="brand-name">Cuaderno <em>de viajes</em></span></span>
      <span class="mobile-bar-actions"><${SyncBadge} compact /><${IconBtn} icon="settings" label="Ajustes" onClick=${() => go('/ajustes')} /></span>
    </div>
    <header class="home-head">
      <div>
        <p class="eyebrow">${fmtDate(todayISO(), 'long')}</p>
        <h1>${greeting()}</h1>
      </div>
    </header>
    <${StorageWarning} />

    ${!trips.length ? html`
      <div class="welcome">
        <${Empty} icon="compass" title="Aquí empieza tu cuaderno"
          text="Crea un viaje y ve guardando en él los billetes, las reservas, los lugares que quieres ver, los correos de confirmación, la maleta y los gastos. Todo en un solo sitio, en el ordenador y en el móvil.">
          <${Btn} kind="primary" icon="plus" onClick=${() => openModal(TripForm)}>Crear el primer viaje</${Btn}>
        </${Empty}>
      </div>` : html`
      ${feature && (g.now.includes(feature) ? html`<${NowCard} trip=${feature} />` : html`<${NextCard} trip=${feature} />`)}
      ${rest.length > 0 && html`<section class="home-section">
        <h2 class="section-title">${feature ? 'Más viajes' : 'Tus viajes'}</h2>
        <div class="trip-grid">${rest.map(t => html`<${TripCard} key=${t.id} trip=${t} />`)}</div>
      </section>`}
      ${g.past.length > 0 && html`<section class="home-section">
        <h2 class="section-title">Recuerdos</h2>
        <div class="trip-grid trip-grid-sm">${g.past.map(t => html`<${TripCard} key=${t.id} trip=${t} size="sm" />`)}</div>
      </section>`}
    `}
    <button type="button" class="fab only-mobile" onClick=${() => openModal(TripForm)} aria-label="Nuevo viaje"><${Icon} name="plus" size=${24} /></button>
  </div>`;
}
