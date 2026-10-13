// Pestaña Itinerario: el viaje día a día con reservas, lugares y planes propios.
import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { Btn, Icon, IconBtn, Empty, openModal, Select, Modal, Field, MicButton, Spinner, pickFiles, useFileUrl, confirm } from './kit.js';
import { buildAgenda, RES_KINDS, PLACE_CATS, resTitle, newPlanItem, planItem } from '../lib/model.js';
import { updateTrip, uploadFile, removeFiles, toast, useStore } from '../lib/store.js';
import { resizeImage } from '../lib/image.js';
import { openReservation } from './tab-bookings.js';
import { TripForm } from './trip-form.js';
import { fmtDate, sid, cx, daysBetween } from '../lib/util.js';
import { go, tripPath } from '../lib/router.js';
import { forecast } from '../lib/weather.js';
import { geocode } from '../lib/geo.js';
import { PlaceSearch } from './pickers.js';

const PHASE = { start: '', end: 'Salida', during: 'Noche en', arrive: 'Llegada' };

// Guarda (o borra) un plan dentro de trip.plan[day].
function savePlan(trip, day, item, { remove = false } = {}) {
  updateTrip(trip.id, t => {
    const list = t.plan[day] || (t.plan[day] = []);
    const i = list.findIndex(x => x.id === item.id);
    if (remove) { if (i >= 0) list.splice(i, 1); }
    else if (i >= 0) list[i] = item;
    else list.push(item);
    if (!list.length) delete t.plan[day];
  });
}

// Miniatura de una foto guardada (por ruta de archivo).
function PhotoThumb({ path, name, onRemove }) {
  const url = useFileUrl(path);
  return html`<div class="plan-photo">
    ${url ? html`<img src=${url} alt=${name || 'Foto'} loading="lazy" />` : html`<div class="plan-photo-ph"><${Spinner} size=${18} /></div>`}
    ${onRemove && html`<button type="button" class="plan-photo-x" aria-label="Quitar foto" title="Quitar foto" onClick=${onRemove}><${Icon} name="x" size=${14} /></button>`}
  </div>`;
}

// Editor de un plan: hora, título, nota larga y fotos. Con dictado por voz.
function PlanModal({ close, trip, day, it }) {
  const editing = !!it;
  const base = planItem(it || newPlanItem());
  const [time, setTime] = useState(base.time);
  const [text, setText] = useState(base.text);
  const [note, setNote] = useState(base.note);
  // Fotos ya guardadas que se conservan + fotos nuevas aún sin confirmar.
  const [keep, setKeep] = useState(() => base.photoIds.map(id => trip.docs.find(d => d.id === id)).filter(Boolean));
  const [fresh, setFresh] = useState([]);
  const [uploading, setUploading] = useState(false);
  // Lugar del plan (para que salga en el mapa) y lo que se ha escrito en el buscador sin buscar aún.
  const [where, setWhere] = useState(base.where);
  const [whereQ, setWhereQ] = useState('');
  const [saving, setSaving] = useState(false);

  const addPhotos = async () => {
    const files = await pickFiles({ accept: 'image/*', capture: 'environment' });
    if (!files.length) return;
    setUploading(true);
    try {
      for (const f0 of files) {
        const f = await resizeImage(f0);
        const up = await uploadFile(trip.id, 'docs', f, f0.name || 'foto.jpg');
        setFresh(d => [...d, { id: sid(), name: (f0.name || 'Foto').replace(/\.[^.]+$/, ''), file: f0.name, kind: 'foto', path: up.path, mime: up.mime, size: up.size, addedAt: new Date().toISOString() }]);
      }
    } catch (e) { toast(`No se pudo subir la foto: ${e.message}`, 'error'); }
    setUploading(false);
  };

  // Si se ha escrito un lugar pero no se ha elegido de la lista, se busca solo al guardar
  // y se coge el primer resultado (cerca del destino del viaje).
  const resolveWhere = async () => {
    if (where) return where;
    const q = whereQ.trim();
    if (!q) return null;
    const near = trip.center || undefined;
    try {
      const hit = (await geocode(trip.destination && !q.toLowerCase().includes(trip.destination.toLowerCase()) ? `${q}, ${trip.destination}` : q, { near, limit: 1 }))[0]
        || (await geocode(q, { near, limit: 1 }))[0];
      if (hit) return { name: hit.name || q, address: hit.address || '', lat: hit.lat, lng: hit.lng };
    } catch { /* sin conexión: se guarda sin ubicación */ }
    toast(`No he encontrado «${q}» en el mapa. Se guarda el nombre; puedes buscarlo con otras palabras.`, 'error');
    return { name: q, address: '', lat: null, lng: null };
  };

  const save = async () => {
    if (saving) return;
    const v = text.trim();
    const n = note.trim();
    const photos = [...keep, ...fresh];
    // Un plan sin título, nota ni fotos no se guarda (y si existía, se borra).
    if (!v && !n && !photos.length && !where && !whereQ.trim()) {
      if (editing) removePlan(trip, day, base, { ask: false });
      else cleanFresh();
      close();
      return;
    }
    setSaving(true);
    const w = await resolveWhere();
    setSaving(false);
    const item = { ...base, time, text: v || w?.name || (n ? n.split('\n')[0].slice(0, 60) : 'Plan'), note: n, photoIds: photos.map(p => p.id), where: w };
    const removedIds = base.photoIds.filter(id => !keep.some(k => k.id === id));
    const removedDocs = removedIds.map(id => trip.docs.find(d => d.id === id)).filter(Boolean);
    updateTrip(trip.id, t => {
      const list = t.plan[day] || (t.plan[day] = []);
      const i = list.findIndex(x => x.id === item.id);
      if (i >= 0) list[i] = item; else list.push(item);
      for (const d of fresh) t.docs.push({ ...d, fromPlan: item.id });
      t.docs = t.docs.filter(d => !removedIds.includes(d.id));
    });
    if (removedDocs.length) removeFiles(removedDocs.map(d => d.path));
    toast(editing ? 'Plan guardado' : 'Plan añadido', 'ok');
    close();
  };

  const cleanFresh = () => { if (fresh.length) removeFiles(fresh.map(d => d.path)); };
  const cancel = () => { cleanFresh(); close(); };

  return html`<${Modal} title=${`${editing ? 'Plan' : 'Nuevo plan'} · ${fmtDate(day, 'weekday')}`} close=${cancel} size="md" onSubmit=${save} class="plan-modal"
    footer=${html`
      ${editing && html`<${Btn} kind="ghost" icon="trash" onClick=${() => { removePlan(trip, day, base); close(); }}>Borrar</${Btn}>`}
      <${Btn} kind="ghost" onClick=${cancel}>Cancelar</${Btn}>
      <${Btn} kind="primary" type="submit" disabled=${saving}>${saving ? 'Buscando el lugar…' : editing ? 'Guardar' : 'Añadir'}</${Btn}>`}>
    <div class="form-grid">
      <${Field} label="Hora (opcional)" wide=${false}><input class="input input-time" type="time" value=${time} onInput=${e => setTime(e.target.value)} aria-label="Hora" /></${Field}>
      <${Field} label="Título" wide><div class="mic-row">
        <input class="input" value=${text} autofocus placeholder="Ej.: Paseo por el casco antiguo" onInput=${e => setText(e.target.value)} />
        <${MicButton} title="Dictar el título" onText=${t => setText(v => (v ? v + ' ' : '') + t)} />
      </div></${Field}>
      <${Field} label="Lugar (opcional)" wide hint="Escribe el sitio y pulsa «Buscar» para elegirlo. Así aparecerá en el mapa.">
        <${PlaceSearch} value=${where} onChange=${setWhere} near=${trip.center || undefined} query=${whereQ} onQuery=${setWhereQ}
          placeholder=${text.trim() ? `Ej.: ${text.trim()}` : 'Ej.: Museo del Prado'} />
        ${!where && !whereQ.trim() && text.trim() && html`<button type="button" class="link-btn small" onClick=${() => setWhereQ(text.trim())}>Usar el título como lugar</button>`}
      </${Field}>
      <${Field} label="Nota" wide><div class="mic-row mic-row-area">
        <textarea class="input" rows="4" value=${note} placeholder="Escribe o dicta lo que quieras recordar de este plan…" onInput=${e => setNote(e.target.value)}></textarea>
        <${MicButton} title="Dictar la nota" onText=${t => setNote(v => (v ? v + ' ' : '') + t)} />
      </div></${Field}>
      <${Field} label="Fotos" wide>
        <div class="plan-photos">
          ${keep.map(d => html`<${PhotoThumb} key=${d.id} path=${d.path} name=${d.name} onRemove=${() => setKeep(k => k.filter(x => x.id !== d.id))} />`)}
          ${fresh.map(d => html`<${PhotoThumb} key=${d.id} path=${d.path} name=${d.name} onRemove=${() => { removeFiles([d.path]); setFresh(f => f.filter(x => x.id !== d.id)); }} />`)}
          <button type="button" class="plan-photo-add" onClick=${addPhotos} disabled=${uploading}>
            ${uploading ? html`<${Spinner} size=${20} />` : html`<${Icon} name="camera" size=${22} />`}
            <span>${uploading ? 'Subiendo…' : 'Añadir'}</span>
          </button>
        </div>
      </${Field}>
    </div>
  </${Modal}>`;
}

async function removePlan(trip, day, it, { ask = true } = {}) {
  if (ask && !await confirm('¿Borrar este plan?', it.photoIds?.length ? `También se borrarán ${it.photoIds.length} foto(s).` : '', { okLabel: 'Borrar', danger: true })) return false;
  const docs = (it.photoIds || []).map(id => trip.docs.find(d => d.id === id)).filter(Boolean);
  updateTrip(trip.id, t => {
    const list = t.plan[day] || [];
    const i = list.findIndex(x => x.id === it.id);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) delete t.plan[day];
    t.docs = t.docs.filter(d => !docs.some(x => x.id === d.id));
  });
  if (docs.length) removeFiles(docs.map(d => d.path));
  return true;
}

export const openPlan = (trip, day, it) => openModal(PlanModal, { trip, day, it });

export function AgendaItem({ item, trip, compact }) {
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
  const it = planItem(item.item);
  const day = item.day;
  const nPhotos = it.photoIds.length;
  return html`<li class="ag-item ag-plan">
    <span class="ag-time">${it.time || ''}</span>
    <button type="button" class="ag-body" onClick=${() => openPlan(trip, day, it)}>
      <span class="ag-ico"><${Icon} name="notes" size=${16} /></span>
      <span class="ag-text"><b>${it.text}</b>
        ${it.where && !compact && (it.where.name !== it.text || it.where.lat == null) && html`<small class="ag-where"><${Icon} name="pin" size=${13} /> ${it.where.name}${it.where.lat == null ? ' (sin ubicar)' : ''}</small>`}
        ${it.note && html`<small>${it.note.split('\n')[0]}</small>`}
        ${nPhotos > 0 && html`<small class="ag-photos"><${Icon} name="image" size=${13} /> ${nPhotos} foto${nPhotos > 1 ? 's' : ''}</small>`}
      </span>
    </button>
    ${!compact && it.where?.lat != null && html`<${IconBtn} icon="map" label="Ver en el mapa" class="ag-visit"
      onClick=${() => go(`${tripPath(trip.id, 'mapa')}/n-${it.id}`)} />`}
  </li>`;
}

// Panel con el detalle de un día: su agenda y los planes, con botón para añadir.
function DayDetail({ close, trip: trip0, day, index, weather }) {
  const trip = useStore(s => s.trips.find(t => t.id === trip0.id)) || trip0;
  const { days, outside } = buildAgenda(trip);
  const d = days.find(x => x.day === day) || outside.find(x => x.day === day) || { day, items: [] };
  const w = weather?.find(x => x.day === day);
  return html`<${Modal} title=${fmtDate(day, 'daylong')} close=${close} size="lg" class="day-detail"
    footer=${html`<${Btn} kind="ghost" onClick=${close}>Cerrar</${Btn}><${Btn} kind="primary" icon="plus" onClick=${() => openPlan(trip, day)}>Añadir un plan</${Btn}>`}>
    <div class="day-detail-head">
      ${index != null && index >= 0 && html`<span class="day-n">Día ${index + 1}</span>`}
      ${w && html`<span class="weather-chip" title=${w.label}><${Icon} name=${w.icon} size=${17} /><b>${w.max}°</b><small>${w.min}°</small>${w.rain != null && w.rain >= 30 ? html`<small>· ${w.rain}%</small>` : ''}</span>`}
    </div>
    ${d.items.length === 0
      ? html`<${Empty} icon="notes" title="Aún no hay nada este día" text="Añade un plan, escribe una nota o adjunta fotos. También puedes dictarlo por voz." />`
      : html`<ul class="agenda agenda-detail">${d.items.map(it => html`<${AgendaItem} item=${{ ...it, day }} trip=${trip} />`)}</ul>`}
  </${Modal}>`;
}

function Day({ trip, d, index, weather }) {
  const w = weather?.find(x => x.day === d.day);
  return html`<section class=${cx('day', d.outside && 'day-outside')} id=${`dia-${d.day}`}>
    <button type="button" class="day-head day-head-btn" onClick=${() => openModal(DayDetail, { trip, day: d.day, index: d.outside ? -1 : index, weather })}>
      <div>
        ${!d.outside && html`<span class="day-n">Día ${index + 1}</span>`}
        <h3>${fmtDate(d.day, 'daylong')}</h3>
      </div>
      <span class="day-head-right">
        ${w && html`<span class="weather-chip" title=${w.label}><${Icon} name=${w.icon} size=${17} /><b>${w.max}°</b><small>${w.min}°</small>${w.rain != null && w.rain >= 30 ? html`<small>· ${w.rain}%</small>` : ''}</span>`}
        <${Icon} name="chevron-right" size=${18} class="day-chevron" />
      </span>
    </button>
    <ul class="agenda">
      ${d.items.map(it => html`<${AgendaItem} item=${{ ...it, day: d.day }} trip=${trip} />`)}
      <li class="ag-add"><button type="button" class="link-btn" onClick=${() => openPlan(trip, d.day)}><${Icon} name="plus" size=${15} /> Añadir un plan</button></li>
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
