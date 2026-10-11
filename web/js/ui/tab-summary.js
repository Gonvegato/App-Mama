// Pestaña Resumen: lo esencial del viaje de un vistazo.
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { Btn, Icon, openModal, Progress } from './kit.js';
import { TripForm } from './trip-form.js';
import { ResCard, openReservation, addReservation } from './tab-bookings.js';
import { MiniMap } from './tab-map.js';
import { updateTrip } from '../lib/store.js';
import { tripStats, RES_KINDS } from '../lib/model.js';
import { fmtDate, fmtRange, tripStatus, daysBetween, debounce, plural, todayISO, fmtMoney } from '../lib/util.js';
import { forecast } from '../lib/weather.js';
import { go, tripPath } from '../lib/router.js';

function Notes({ trip }) {
  const [v, setV] = useState(trip.notes);
  const latest = useRef(trip.notes);
  const dirty = useRef(false);
  const save = useRef(debounce((id, val) => { dirty.current = false; updateTrip(id, t => { t.notes = val; }); }, 600)).current;
  useEffect(() => () => { if (dirty.current) { save.cancel(); updateTrip(trip.id, t => { t.notes = latest.current; }); } }, []);
  useEffect(() => { if (document.activeElement?.id !== 'trip-notes') { setV(trip.notes); latest.current = trip.notes; } }, [trip.notes]);
  return html`<section class="card notes-card">
    <h3 class="section-title"><${Icon} name="notes" size=${18} /> Notas</h3>
    <textarea id="trip-notes" class="input notes" rows="6" value=${v} placeholder="Ideas, teléfonos útiles, recomendaciones, lo que no hay que olvidar…"
      onInput=${e => { setV(e.target.value); latest.current = e.target.value; dirty.current = true; save(trip.id, e.target.value); }}></textarea>
  </section>`;
}

function Weather({ trip }) {
  const [w, setW] = useState(null);
  useEffect(() => {
    if (trip.center && trip.startDate) forecast(trip.center.lat, trip.center.lng, trip.startDate, trip.endDate).then(setW).catch(() => setW(null));
  }, [trip.center?.lat, trip.startDate, trip.endDate]);
  if (!w?.length) return null;
  return html`<section class="card weather-card">
    <h3 class="section-title"><${Icon} name="cloud-sun" size=${18} /> El tiempo en ${trip.center?.name || trip.destination}</h3>
    <div class="weather-row">${w.map(d => html`<div class="wday" title=${d.label}>
      <small>${fmtDate(d.day, 'weekday').split(',')[0]}</small><${Icon} name=${d.icon} size=${24} />
      <b>${d.max}°</b><small>${d.min}°</small>${d.rain != null && d.rain >= 30 ? html`<small class="rain">${d.rain}%</small>` : ''}</div>`)}</div>
  </section>`;
}

export function SummaryTab({ trip }) {
  const s = tripStats(trip);
  const st = tripStatus(trip);
  const now = `${todayISO()}T${new Date().toTimeString().slice(0, 5)}`;
  const next = [...trip.reservations].filter(r => r.start && (r.start.length > 10 ? r.start : `${r.start}T23:59`) >= now).sort((a, b) => a.start.localeCompare(b.start))[0];
  const nights = trip.startDate && trip.endDate ? daysBetween(trip.startDate, trip.endDate) : null;
  const spent = trip.expenses.filter(e => e.currency === (trip.budget?.currency || 'EUR')).reduce((a, e) => a + e.amount, 0)
    + trip.reservations.filter(r => r.price?.currency === (trip.budget?.currency || 'EUR')).reduce((a, r) => a + r.price.amount, 0);
  const tiles = [
    { tab: 'reservas', icon: 'ticket', label: 'Reservas', value: s.reservations },
    { tab: 'documentos', icon: 'file', label: 'Documentos', value: s.docs },
    { tab: 'mapa', icon: 'pin', label: 'Lugares', value: s.places },
    { tab: 'correos', icon: 'mail', label: 'Correos', value: s.emails },
    { tab: 'maleta', icon: 'suitcase', label: 'Maleta', value: s.packing ? `${s.packed}/${s.packing}` : '—', progress: s.packing ? [s.packed, s.packing] : null },
    { tab: 'gastos', icon: 'wallet', label: 'Gastado', value: spent ? fmtMoney(spent, trip.budget?.currency || 'EUR') : '—' },
  ];
  return html`<div class="page-pad summary">
    <div class="summary-grid">
      <div class="summary-main">
        <section class="facts card">
          <div class="fact"><span class="eyebrow">Fechas</span><b>${trip.startDate ? fmtRange(trip.startDate, trip.endDate) : 'Sin fechas'}</b>
            ${nights != null && html`<small>${plural(nights + 1, 'día', 'días')} · ${plural(nights, 'noche', 'noches')}</small>`}</div>
          <div class="fact"><span class="eyebrow">${st.kind === 'upcoming' ? 'Cuenta atrás' : 'Estado'}</span><b>${st.label}</b>
            ${st.kind === 'upcoming' && html`<small>Salida el ${fmtDate(trip.startDate, 'daylong').toLowerCase()}</small>`}</div>
          <div class="fact"><span class="eyebrow">Viajeros</span><b>${trip.travelers.length ? trip.travelers.join(', ') : '—'}</b>
            ${!trip.travelers.length && html`<button type="button" class="link-btn small" onClick=${() => openModal(TripForm, { trip })}>Añadir</button>`}</div>
        </section>

        ${next ? html`<section class="next">
          <h3 class="section-title">Lo próximo</h3>
          <${ResCard} trip=${trip} r=${next} onOpen=${r => openReservation(trip, r)} />
        </section>` : !trip.reservations.length && html`<section class="card next-empty">
          <h3 class="section-title">Empieza por las reservas</h3>
          <p class="muted">Añade el vuelo o el tren y el alojamiento: aparecerán en el itinerario y en el mapa.</p>
          <div class="btn-row">${['flight', 'hotel', 'train'].map(k => html`<${Btn} icon=${RES_KINDS[k].icon} onClick=${() => addReservation(trip, k)}>${RES_KINDS[k].label}</${Btn}>`)}</div>
        </section>`}

        <section class="tiles">
          ${tiles.map(t => html`<a class="tile" href=${`#${tripPath(trip.id, t.tab)}`}>
            <span class="tile-ico"><${Icon} name=${t.icon} size=${19} /></span>
            <span class="tile-val">${t.value}</span><span class="tile-label">${t.label}</span>
            ${t.progress && html`<${Progress} value=${t.progress[0]} max=${t.progress[1]} label=${t.label} />`}
          </a>`)}
        </section>

        <${Notes} trip=${trip} key=${trip.id} />
      </div>
      <aside class="summary-side">
        <section class="card map-card">
          <${MiniMap} trip=${trip} onOpen=${() => go(tripPath(trip.id, 'mapa'))} />
          <button type="button" class="map-card-foot" onClick=${() => go(tripPath(trip.id, 'mapa'))}>
            <span>${s.places ? plural(s.places, 'lugar guardado', 'lugares guardados') : 'Abrir el mapa del viaje'}</span><${Icon} name="arrow-right" size=${16} /></button>
        </section>
        <${Weather} trip=${trip} />
      </aside>
    </div>
  </div>`;
}
