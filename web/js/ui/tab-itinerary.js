// Pestaña Itinerario: el viaje día a día con reservas, lugares y planes propios.
import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { Btn, Icon, IconBtn, Empty, openModal, Select } from './kit.js';
import { buildAgenda, RES_KINDS, PLACE_CATS, resTitle } from '../lib/model.js';
import { updateTrip } from '../lib/store.js';
import { openReservation } from './tab-bookings.js';
import { TripForm } from './trip-form.js';
import { fmtDate, sid, cx, daysBetween } from '../lib/util.js';
import { go, tripPath } from '../lib/router.js';
import { forecast } from '../lib/weather.js';

const PHASE = { start: '', end: 'Salida', during: 'Noche en', arrive: 'Llegada' };

export function AgendaItem({ item, trip, compact }) {
  const [edit, setEdit] = useState(false);
  if (item.type === 'res') {
    const r = item.res, k = RES_KINDS[r.kind];
    let label = resTitle(r);
    let phase = PHASE[item.phase] || '';
    if (r.kind === 'hotel') phase = item.phase === 'start' ? 'Entrada' : item.phase === 'end' ? 'Salida' : 'Noche en';
    if (r.kind === 'car') phase = item.phase === 'start' ? 'Recogida' : item.phase === 'end' ? 'Devolución' : 'Coche';
    return html`<li class=${cx('ag-item', 'ag-res', item.phase === 'during' && 'ag-faint')} style=${`--kc:${k.color}`}>
      <span class="ag-time">${item.time || ''}</span>
      <button type="button" class="ag-body" onClick=${() => openReservation(trip, r)}>
        <span class="ag-ico"><${Icon} name=${k.icon} size=${16} /></span>
        <span class="ag-text">${phase && html`<small>${phase}</small>`}<b>${label}</b>${!compact && r.code && item.phase !== 'during' && html`<small class="ag-code">Código ${r.code}</small>`}</span>
      </button>
    </li>`;
  }
  if (item.type === 'place') {
    const p = item.place, c = PLACE_CATS[p.category] || PLACE_CATS.other;
    return html`<li class=${cx('ag-item', 'ag-place', p.visited && 'is-done')} style=${`--kc:${c.color}`}>
      <span class="ag-time">${item.time || ''}</span>
      <button type="button" class="ag-body" onClick=${() => go(`${tripPath(trip.id, 'mapa')}/p-${p.id}`)}>
        <span class="ag-ico"><${Icon} name=${c.icon} size=${16} /></span>
        <span class="ag-text"><b>${p.name}</b>${!compact && p.notes && html`<small>${p.notes.split('\n')[0]}</small>`}</span>
      </button>
      ${!compact && html`<${IconBtn} icon=${p.visited ? 'check-circle' : 'circle'} label=${p.visited ? 'Visitado' : 'Marcar como visitado'} class=${cx('ag-visit', p.visited && 'is-on')}
        onClick=${() => updateTrip(trip.id, t => { const x = t.places.find(x => x.id === p.id); if (x) x.visited = !x.visited; })} />`}
    </li>`;
  }
  const it = item.item;
  const day = item.day;
  if (edit) return html`<${PlanEditor} trip=${trip} day=${day} it=${it} done=${() => setEdit(false)} />`;
  return html`<li class="ag-item ag-plan">
    <span class="ag-time">${it.time || ''}</span>
    <button type="button" class="ag-body" onClick=${() => !compact && setEdit(true)}>
      <span class="ag-ico"><${Icon} name="notes" size=${16} /></span>
      <span class="ag-text"><b>${it.text}</b></span>
    </button>
  </li>`;
}

function PlanEditor({ trip, day, it, done }) {
  const [time, setTime] = useState(it?.time || '');
  const [text, setText] = useState(it?.text || '');
  const save = () => {
    const v = text.trim();
    updateTrip(trip.id, t => {
      const list = t.plan[day] || (t.plan[day] = []);
      if (it) {
        const i = list.findIndex(x => x.id === it.id);
        if (!v) list.splice(i, 1); else list[i] = { ...it, time, text: v };
      } else if (v) list.push({ id: sid(), time, text: v });
      if (!list.length) delete t.plan[day];
    });
    done();
  };
  return html`<li class="ag-item ag-edit">
    <input class="input input-time" type="time" value=${time} onInput=${e => setTime(e.target.value)} aria-label="Hora" />
    <input class="input" value=${text} autofocus placeholder="Ej.: Paseo por el casco antiguo" onInput=${e => setText(e.target.value)}
      onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') done(); }} />
    <${IconBtn} icon="check" label="Guardar" onClick=${save} />
    ${it && html`<${IconBtn} icon="trash" label="Borrar" onClick=${() => { setText(''); updateTrip(trip.id, t => { t.plan[day] = (t.plan[day] || []).filter(x => x.id !== it.id); if (!t.plan[day].length) delete t.plan[day]; }); done(); }} />`}
  </li>`;
}

function Day({ trip, d, index, weather }) {
  const [adding, setAdding] = useState(false);
  const w = weather?.find(x => x.day === d.day);
  return html`<section class=${cx('day', d.outside && 'day-outside')} id=${`dia-${d.day}`}>
    <header class="day-head">
      <div>
        ${!d.outside && html`<span class="day-n">Día ${index + 1}</span>`}
        <h3>${fmtDate(d.day, 'daylong')}</h3>
      </div>
      ${w && html`<span class="weather-chip" title=${w.label}><${Icon} name=${w.icon} size=${17} /><b>${w.max}°</b><small>${w.min}°</small>${w.rain != null && w.rain >= 30 ? html`<small>· ${w.rain}%</small>` : ''}</span>`}
    </header>
    <ul class="agenda">
      ${d.items.map(it => html`<${AgendaItem} item=${{ ...it, day: d.day }} trip=${trip} />`)}
      ${adding ? html`<${PlanEditor} trip=${trip} day=${d.day} done=${() => setAdding(false)} />`
        : html`<li class="ag-add"><button type="button" class="link-btn" onClick=${() => setAdding(true)}><${Icon} name="plus" size=${15} /> Añadir un plan</button></li>`}
    </ul>
  </section>`;
}

export function ItineraryTab({ trip }) {
  const [weather, setWeather] = useState(null);
  useEffect(() => {
    if (trip.center && trip.startDate) forecast(trip.center.lat, trip.center.lng, trip.startDate, trip.endDate).then(setWeather).catch(() => {});
  }, [trip.center?.lat, trip.startDate, trip.endDate]);
  if (!trip.startDate) return html`<div class="page-pad"><${Empty} icon="calendar" title="Pon fechas al viaje" text="Con la ida y la vuelta se organiza el itinerario día a día.">
    <${Btn} kind="primary" icon="calendar" onClick=${() => openModal(TripForm, { trip })}>Poner fechas</${Btn}></${Empty}></div>`;
  const { days, outside } = buildAgenda(trip);
  const unassigned = trip.places.filter(p => !p.day);
  const total = daysBetween(trip.startDate, trip.endDate) + 1;
  return html`<div class="page-pad itinerary">
    ${total > 4 && html`<nav class="day-jump" aria-label="Ir al día">${days.map((d, i) => html`<a href=${`#dia-${d.day}`} onClick=${e => { e.preventDefault(); document.getElementById(`dia-${d.day}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
      <small>${fmtDate(d.day, 'weekday').split(' ')[0].replace(',', '')}</small><b>${i + 1}</b></a>`)}</nav>`}
    <div class="days">
      ${days.map((d, i) => html`<${Day} key=${d.day} trip=${trip} d=${d} index=${i} weather=${weather} />`)}
    </div>
    ${outside.length > 0 && html`<h3 class="section-title">Fuera de las fechas del viaje</h3>
      <div class="days">${outside.map(d => html`<${Day} key=${d.day} trip=${trip} d=${d} index=${0} />`)}</div>`}
    ${unassigned.length > 0 && html`<section class="card unassigned">
      <h3 class="section-title">Lugares sin día</h3>
      <p class="muted small">Asígnales un día para verlos en el itinerario.</p>
      <ul class="assign-list">${unassigned.map(p => html`<li>
        <span class="assign-name"><${Icon} name=${PLACE_CATS[p.category]?.icon || 'pin'} size=${16} />${p.name}</span>
        <${Select} class="input input-sm" value="" onChange=${e => { const v = e.target.value; updateTrip(trip.id, t => { const x = t.places.find(x => x.id === p.id); if (x) x.day = v; }); }} aria-label=${`Día para ${p.name}`}>
          <option value="">Elegir día…</option>
          ${days.map((d, i) => html`<option value=${d.day}>Día ${i + 1} · ${fmtDate(d.day, 'weekday')}</option>`)}
        </${Select}></li>`)}</ul>
    </section>`}
    ${weather?.length > 0 && html`<p class="muted small credit">Previsión: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (hasta 16 días vista).</p>`}
  </div>`;
}
