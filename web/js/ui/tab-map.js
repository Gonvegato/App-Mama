// Pestaña Mapa: lugares, alojamientos, vuelos y rutas; búsqueda e importación.
import { html, useState, useEffect, useRef, useMemo } from '../../vendor/preact-htm.js';
import { Btn, Icon, IconBtn, Chip, Modal, Field, openModal, confirm, Spinner, Menu, useMedia, Select } from './kit.js';
import { ImportModal } from './map-import.js';
import { openReservation } from './tab-bookings.js';
import { openPlan } from './tab-itinerary.js';
import { ICONS } from '../lib/icon-data.js';
import { loadLeaflet, baseLayer, currentMapStyle, MAP_STYLES } from '../lib/leaflet-loader.js';
import { PLACE_CATS, RES_KINDS, newPlace, resTitle, isTransport, locatedPlans } from '../lib/model.js';
import { updateTrip, toast, useStore, setPrefs, getTrip } from '../lib/store.js';
import { isRouteInstruction } from '../lib/importers.js';
import { exportTripKml } from '../lib/export.js';
import { geocode, reverseGeocode, guessCategory, greatCircle, googleMapsUrl, appleMapsUrl, navigateUrl, googleDirectionsUrl, appleDirectionsUrl, isApple, distanceKm } from '../lib/geo.js';
import { eachDay, fmtDate, cx } from '../lib/util.js';

// Planes del itinerario con lugar: se dibujan con su propio color e icono.
const PLAN_MARK = { label: 'Planes del itinerario', icon: 'notes', color: '#3f7472' };

const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function markerIcon(L, { color, icon, shape = 'round', selected, faded, label }) {
  return L.divIcon({
    className: '',
    html: `<div class="mk mk-${shape}${selected ? ' is-sel' : ''}${faded ? ' is-faded' : ''}" style="--c:${color}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon] || ICONS.pin}</svg>${label ? `<span class="mk-label">${esc(label)}</span>` : ''}</div>`,
    iconSize: [30, 30], iconAnchor: [15, 15],
  });
}

// Elementos dibujables de un viaje. `hidden` es un conjunto de capas ocultas:
// «p:<categoría>» para lugares, «r:<tipo>» para reservas, «plans» para los planes
// del itinerario con lugar y «routes» para las rutas.
function collect(trip, { hidden = new Set(), day }) {
  const places = trip.places.filter(p => p.lat != null && !hidden.has(`p:${p.category}`) && (!day || p.day === day));
  const plans = hidden.has('plans') ? [] : locatedPlans(trip, day);
  const res = [];
  const lines = [];
  for (const r of trip.reservations) {
    if (hidden.has(`r:${r.kind}`)) continue;
    if (day && !(r.start || '').startsWith(day) && !(r.end || '').startsWith(day) && !(r.kind === 'hotel' && r.start && r.end && r.start.slice(0, 10) <= day && r.end.slice(0, 10) >= day)) continue;
    const k = RES_KINDS[r.kind];
    if (r.kind === 'flight' && r.from?.lat != null && r.to?.lat != null) {
      lines.push({ id: `r-${r.id}`, res: r, pts: greatCircle(r.from, r.to), color: k.color, dash: '6 8', kind: 'flight' });
      res.push({ id: `r-${r.id}-a`, res: r, at: r.from, icon: 'plane', color: k.color, label: r.from.iata });
      res.push({ id: `r-${r.id}-b`, res: r, at: r.to, icon: 'plane', color: k.color, label: r.to.iata });
    } else if ((isTransport(r.kind) || r.kind === 'car') && (r.from?.lat != null || r.to?.lat != null)) {
      if (r.from?.lat != null && r.to?.lat != null) lines.push({ id: `r-${r.id}`, res: r, pts: [[r.from.lat, r.from.lng], [r.to.lat, r.to.lng]], color: k.color, dash: '2 7', kind: r.kind });
      if (r.from?.lat != null) res.push({ id: `r-${r.id}-a`, res: r, at: r.from, icon: k.icon, color: k.color });
      if (r.to?.lat != null && !(r.kind === 'car' && r.to.lat === r.from?.lat)) res.push({ id: `r-${r.id}-b`, res: r, at: r.to, icon: k.icon, color: k.color });
    } else if (r.location?.lat != null) {
      res.push({ id: `r-${r.id}`, res: r, at: r.location, icon: k.icon, color: k.color });
    }
  }
  // Con un día elegido, solo las rutas puestas para ese día en el itinerario.
  const routes = hidden.has('routes') ? [] : trip.routes.filter(r => r.points?.length > 1 && (!day || r.day === day));
  return { places, plans, res, lines, routes };
}

// ---------- Mapa reutilizable ----------
function useLeafletMap(ref, { interactive = true } = {}) {
  const [map, setMap] = useState(null);
  const theme = useStore(s => s.prefs.mapStyle + (document.documentElement.dataset.dark || ''));
  useEffect(() => {
    let m, alive = true;
    loadLeaflet().then(L => {
      if (!alive || !ref.current) return;
      m = L.map(ref.current, {
        zoomControl: interactive, attributionControl: true, dragging: interactive, scrollWheelZoom: interactive, doubleClickZoom: interactive,
        boxZoom: interactive, keyboard: interactive, touchZoom: interactive, tap: interactive, worldCopyJump: true, zoomSnap: 0.5,
      }).setView([40.4, -3.7], 3);
      if (interactive) m.zoomControl.setPosition('topright');
      m.attributionControl.setPrefix(false);
      setMap(m);
      // Ajusta el tamaño cuando cambia el contenedor.
      const ro = new ResizeObserver(() => m.invalidateSize());
      ro.observe(ref.current);
      m._cvRO = ro;
    }).catch(e => toast(e.message, 'error'));
    return () => { alive = false; if (m) { m._cvRO?.disconnect(); m.remove(); } };
  }, []);
  // Fondo del mapa (se cambia al cambiar el tema o el estilo).
  useEffect(() => {
    if (!map) return;
    let alive = true;
    baseLayer(window.L, currentMapStyle(), { interactive }).then(layer => {
      if (!alive) return;
      map._cvTiles?.remove();
      map._cvTiles = layer.addTo(map);
    }).catch(() => {});
    return () => { alive = false; };
  }, [theme, map]);
  return map;
}

function drawLayers(map, trip, data, { selected, onSelect, labels }) {
  const L = window.L;
  const group = L.featureGroup();
  const dayIndex = new Map(eachDay(trip.startDate, trip.endDate).map((d, i) => [d, i + 1]));
  for (const r of data.routes) {
    const line = L.polyline(r.points, { color: r.color || '#4c6f86', weight: 4, opacity: 0.85, dashArray: r.straight ? '1 8' : null, lineCap: 'round' });
    line.bindTooltip(esc(r.name), { sticky: true });
    if (onSelect) line.on('click', () => onSelect({ type: 'route', id: r.id }));
    group.addLayer(line);
    // Ruta puesta en un día del itinerario: marca en el inicio con su día (D1, D2…).
    if (labels && r.day && dayIndex.get(r.day)) {
      const sel = selected?.type === 'route' && selected.id === r.id;
      const m = L.marker(r.points[0], { icon: markerIcon(L, { color: r.color || '#4c6f86', icon: 'route', selected: sel, label: `D${dayIndex.get(r.day)}` }), riseOnHover: true, zIndexOffset: sel ? 1000 : 0 });
      m.bindTooltip(esc(`${r.name} · inicio`), { direction: 'top', offset: [0, -14] });
      if (onSelect) m.on('click', () => onSelect({ type: 'route', id: r.id }));
      group.addLayer(m);
    }
  }
  for (const l of data.lines) {
    const line = L.polyline(l.pts, { color: l.color, weight: l.kind === 'flight' ? 2.5 : 3, opacity: 0.8, dashArray: l.dash, lineCap: 'round' });
    line.bindTooltip(esc(resTitle(l.res)), { sticky: true });
    if (onSelect) line.on('click', () => onSelect({ type: 'res', id: l.res.id }));
    group.addLayer(line);
  }
  for (const r of data.res) {
    const m = L.marker([r.at.lat, r.at.lng], { icon: markerIcon(L, { color: r.color, icon: r.icon, shape: 'square', selected: selected?.type === 'res' && selected.id === r.res.id, label: labels ? r.label : null }), keyboard: false, riseOnHover: true });
    m.bindTooltip(esc(r.label ? `${r.label} · ${r.at.airport || r.at.name}` : resTitle(r.res)), { direction: 'top', offset: [0, -14] });
    if (onSelect) m.on('click', () => onSelect({ type: 'res', id: r.res.id }));
    group.addLayer(m);
  }
  for (const p of data.places) {
    const c = PLACE_CATS[p.category] || PLACE_CATS.other;
    const sel = selected?.type === 'place' && selected.id === p.id;
    const m = L.marker([p.lat, p.lng], { icon: markerIcon(L, { color: c.color, icon: c.icon, selected: sel, faded: p.visited, label: labels && p.day && dayIndex.get(p.day) ? `D${dayIndex.get(p.day)}` : null }), riseOnHover: true, zIndexOffset: sel ? 1000 : 0 });
    m.bindTooltip(esc(p.name), { direction: 'top', offset: [0, -14] });
    if (onSelect) m.on('click', () => onSelect({ type: 'place', id: p.id }));
    group.addLayer(m);
  }
  for (const it of data.plans) {
    const sel = selected?.type === 'plan' && selected.id === it.id;
    const m = L.marker([it.where.lat, it.where.lng], { icon: markerIcon(L, { color: PLAN_MARK.color, icon: PLAN_MARK.icon, selected: sel, label: labels && dayIndex.get(it.day) ? `D${dayIndex.get(it.day)}` : null }), riseOnHover: true, zIndexOffset: sel ? 1000 : 0 });
    m.bindTooltip(esc(it.text && it.text !== it.where.name ? `${it.text} · ${it.where.name}` : it.where.name), { direction: 'top', offset: [0, -14] });
    if (onSelect) m.on('click', () => onSelect({ type: 'plan', id: it.id }));
    group.addLayer(m);
  }
  group.addTo(map);
  return group;
}

// Hueco que tapa el panel lateral (en escritorio) para centrar bien lo que se enfoca.
function panelOffset(map) {
  const panel = map.getContainer().parentElement?.querySelector('.map-panel');
  if (!panel || matchMedia('(max-width: 860px)').matches) return 0;
  return panel.getBoundingClientRect().width + 12;
}

function focusOn(map, latlng, zoom) {
  const off = panelOffset(map);
  const z = zoom ?? map.getZoom();
  if (!off) { map.setView(latlng, z); return; }
  const pt = map.project(latlng, z).subtract([off / 2, 0]);
  map.setView(map.unproject(pt, z), z);
}

function fit(map, group, trip, opts = {}) {
  const b = group.getBounds();
  const off = opts.padding ? 0 : panelOffset(map);
  const pad = opts.padding ? { padding: opts.padding } : { paddingTopLeft: [off + 40, 60], paddingBottomRight: [40, 40] };
  if (b.isValid()) {
    if (b.getNorthEast().equals(b.getSouthWest())) focusOn(map, b.getCenter(), 14);
    else map.fitBounds(b, { ...pad, maxZoom: 15, animate: opts.animate });
  } else if (trip.center) focusOn(map, [trip.center.lat, trip.center.lng], 12);
  else map.setView([40.4, -3.7], 4);
}

// Puntos en los que centrar la vista inicial: lo que hay en el destino
// (sin el aeropuerto de salida, que alejaría demasiado el mapa).
function focusPoints(trip, data) {
  const pts = [], airports = [];
  for (const p of data.places) pts.push([p.lat, p.lng]);
  for (const it of data.plans) pts.push([it.where.lat, it.where.lng]);
  for (const r of data.res) (r.res.kind === 'flight' ? airports : pts).push([r.at.lat, r.at.lng]);
  for (const r of data.routes) for (const q of r.points.filter((_, i) => i % 10 === 0)) pts.push(q);
  const c = trip.center || (data.places[0] ? { lat: data.places[0].lat, lng: data.places[0].lng } : data.plans[0] ? { lat: data.plans[0].where.lat, lng: data.plans[0].where.lng } : null);
  if (!c) return pts.length ? pts : airports;
  const d = ([lat, lng]) => distanceKm(c, { lat, lng });
  // Aeropuertos solo si están junto al destino; el resto, si no está muy lejos.
  const near = [...pts.filter(p => d(p) < 600), ...airports.filter(p => d(p) < 80)];
  return near.length ? near : [...pts, ...airports];
}

function fitPoints(map, pts, trip, opts = {}) {
  const L = window.L;
  if (!pts.length) return fit(map, L.featureGroup(), trip, opts);
  const b = L.latLngBounds(pts);
  const off = opts.padding ? 0 : panelOffset(map);
  const pad = opts.padding ? { padding: opts.padding } : { paddingTopLeft: [off + 40, 60], paddingBottomRight: [40, 40] };
  if (b.getNorthEast().equals(b.getSouthWest())) focusOn(map, b.getCenter(), 14);
  else map.fitBounds(b, { ...pad, maxZoom: 15, animate: opts.animate });
}

export function MiniMap({ trip, onOpen }) {
  const ref = useRef();
  const map = useLeafletMap(ref, { interactive: false });
  useEffect(() => {
    if (!map) return;
    const data = collect(trip, { day: '' });
    const g = drawLayers(map, trip, data, {});
    fitPoints(map, focusPoints(trip, data), trip, { padding: [24, 24] });
    return () => g.remove();
  }, [map, trip]);
  return html`<div class="minimap" ref=${ref} onClick=${onOpen} role="button" aria-label="Abrir mapa" tabIndex="0"></div>`;
}

// ---------- Formulario de lugar ----------
export function PlaceForm({ close, trip, place }) {
  const [p, setP] = useState({ ...place });
  const days = eachDay(trip.startDate, trip.endDate);
  const exists = trip.places.some(x => x.id === p.id);
  const save = () => {
    if (!p.name.trim()) { toast('Ponle un nombre al lugar.', 'error'); return; }
    updateTrip(trip.id, t => { const i = t.places.findIndex(x => x.id === p.id); if (i >= 0) t.places[i] = { ...p, name: p.name.trim() }; else t.places.push({ ...p, name: p.name.trim() }); });
    close(p);
  };
  return html`<${Modal} title=${exists ? 'Editar lugar' : 'Añadir lugar'} close=${() => close(null)} size="md" onSubmit=${save}
    footer=${html`${exists && html`<${Btn} kind="ghost" icon="trash" onClick=${async () => { if (await removePlace(trip, p)) close(null); }}>Borrar</${Btn}>`}<${Btn} kind="primary" type="submit">${exists ? 'Guardar' : 'Añadir al mapa'}</${Btn}>`}>
    <div class="form-grid">
      <${Field} label="Nombre"><input class="input input-lg" value=${p.name} onInput=${e => setP({ ...p, name: e.target.value })} autofocus /></${Field}>
      ${p.address && html`<p class="muted small"><${Icon} name="pin" size=${14} /> ${p.address}</p>`}
      <div class="field"><span class="field-label">Tipo</span>
        <div class="cat-pick">${Object.entries(PLACE_CATS).map(([k, v]) => html`<button type="button" class=${cx('cat-btn', p.category === k && 'is-active')} style=${`--kc:${v.color}`} onClick=${() => setP({ ...p, category: k })}><${Icon} name=${v.icon} size=${18} /><span>${v.label}</span></button>`)}</div></div>
      ${days.length > 0 && html`<div class="field-row">
        <${Field} label="Día"><${Select} class="input" value=${p.day || ''} onChange=${e => setP({ ...p, day: e.target.value })}>
          <option value="">Sin día</option>${days.map((d, i) => html`<option value=${d}>Día ${i + 1} · ${fmtDate(d, 'weekday')}</option>`)}</${Select}></${Field}>
        <${Field} label="Hora (opcional)"><input class="input" type="time" value=${p.time || ''} onInput=${e => setP({ ...p, time: e.target.value })} /></${Field}>
      </div>`}
      <${Field} label="Notas"><textarea class="input" rows="3" value=${p.notes} onInput=${e => setP({ ...p, notes: e.target.value })} placeholder="Horario, precio de la entrada, qué pedir…"></textarea></${Field}>
      <${Field} label="Enlace (opcional)"><input class="input" type="url" value=${p.url || ''} onInput=${e => setP({ ...p, url: e.target.value })} placeholder="https://…" /></${Field}>
      <label class="check-inline"><input type="checkbox" checked=${p.visited} onChange=${e => setP({ ...p, visited: e.target.checked })} /> Ya visitado</label>
    </div>
  </${Modal}>`;
}

export async function removePlace(trip, p) {
  if (!await confirm('¿Quitar este lugar?', `«${p.name}» se quitará del mapa y del itinerario.`, { okLabel: 'Quitar', danger: true })) return false;
  updateTrip(trip.id, t => { t.places = t.places.filter(x => x.id !== p.id); });
  toast('Lugar quitado', 'ok');
  return true;
}

// ---------- Tarjeta del elemento seleccionado ----------
function SelectedCard({ trip, sel, onClose }) {
  if (sel.type === 'place') {
    const p = trip.places.find(x => x.id === sel.id);
    if (!p) return null;
    const c = PLACE_CATS[p.category] || PLACE_CATS.other;
    const days = eachDay(trip.startDate, trip.endDate);
    return html`<div class="map-card-sel" style=${`--kc:${c.color}`}>
      <div class="sel-head"><span class="sel-ico"><${Icon} name=${c.icon} size=${18} /></span>
        <div><small>${c.label}${p.day ? ` · Día ${days.indexOf(p.day) + 1}` : ''}</small><h3>${p.name}</h3></div>
        <${IconBtn} icon="x" label="Cerrar" onClick=${onClose} /></div>
      ${p.address && html`<p class="muted small">${p.address}</p>`}
      ${p.notes && html`<p class="sel-notes">${p.notes}</p>`}
      ${p.url && html`<p class="small"><a href=${p.url} target="_blank" rel="noopener">${p.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}</a></p>`}
      <div class="btn-row">
        <a class="btn btn-primary btn-sm" href=${navigateUrl(p)} target="_blank" rel="noopener"><${Icon} name="navigation" size=${16} /><span>Navegar hasta aquí</span></a>
        <${Btn} size="sm" icon="edit" onClick=${() => openModal(PlaceForm, { trip, place: p })}>Editar</${Btn}>
        <${Btn} size="sm" icon=${p.visited ? 'check-circle' : 'circle'} onClick=${() => updateTrip(trip.id, t => { const x = t.places.find(x => x.id === p.id); if (x) x.visited = !x.visited; })}>${p.visited ? 'Visitado' : 'Marcar visitado'}</${Btn}>
        <${Menu} items=${[
          { icon: 'navigation', label: 'Ir a pie', onClick: () => window.open(navigateUrl(p, 'walking'), '_blank', 'noopener') },
          { icon: 'external', label: 'Abrir en Google Maps', onClick: () => window.open(googleMapsUrl(p), '_blank', 'noopener') },
          { icon: 'external', label: 'Abrir en Apple Maps', onClick: () => window.open(appleMapsUrl(p), '_blank', 'noopener') },
          '-',
          { icon: 'trash', label: 'Quitar del mapa', danger: true, onClick: async () => { if (await removePlace(trip, p)) onClose(); } },
        ]} />
      </div>
    </div>`;
  }
  if (sel.type === 'plan') {
    const it = locatedPlans(trip).find(x => x.id === sel.id);
    if (!it) return null;
    const w = it.where;
    const days = eachDay(trip.startDate, trip.endDate);
    const n = days.indexOf(it.day) + 1;
    return html`<div class="map-card-sel" style=${`--kc:${PLAN_MARK.color}`}>
      <div class="sel-head"><span class="sel-ico"><${Icon} name=${PLAN_MARK.icon} size=${18} /></span>
        <div><small>Plan · ${n > 0 ? `Día ${n}` : fmtDate(it.day, 'weekday')}${it.time ? ` · ${it.time}` : ''}</small><h3>${it.text}</h3></div>
        <${IconBtn} icon="x" label="Cerrar" onClick=${onClose} /></div>
      <p class="muted small"><${Icon} name="pin" size=${14} /> ${[w.name !== it.text && w.name, w.address].filter(Boolean).join(' · ') || w.name}</p>
      ${it.note && html`<p class="sel-notes">${it.note}</p>`}
      <div class="btn-row">
        <a class="btn btn-primary btn-sm" href=${navigateUrl(w)} target="_blank" rel="noopener"><${Icon} name="navigation" size=${16} /><span>Navegar hasta aquí</span></a>
        <${Btn} size="sm" icon="edit" onClick=${() => openPlan(trip, it.day, trip.plan[it.day]?.find(x => x.id === it.id))}>Ver o editar plan</${Btn}>
      </div>
    </div>`;
  }
  if (sel.type === 'res') {
    const r = trip.reservations.find(x => x.id === sel.id);
    if (!r) return null;
    const k = RES_KINDS[r.kind];
    return html`<div class="map-card-sel" style=${`--kc:${k.color}`}>
      <div class="sel-head"><span class="sel-ico sel-sq"><${Icon} name=${k.icon} size=${18} /></span>
        <div><small>${k.label}</small><h3>${resTitle(r)}</h3></div><${IconBtn} icon="x" label="Cerrar" onClick=${onClose} /></div>
      <div class="btn-row"><${Btn} size="sm" kind="primary" icon="eye" onClick=${() => openReservation(trip, r)}>Ver reserva</${Btn}></div>
    </div>`;
  }
  if (sel.type === 'route') {
    const r = trip.routes.find(x => x.id === sel.id);
    if (!r) return null;
    const ends = [r.points[0], r.points[r.points.length - 1]].map(([lat, lng]) => ({ lat, lng }));
    return html`<div class="map-card-sel" style=${`--kc:${r.color}`}>
      <div class="sel-head"><span class="sel-ico"><${Icon} name="route" size=${18} /></span>
        <div><small>Ruta${r.day && eachDay(trip.startDate, trip.endDate).includes(r.day) ? ` · Día ${eachDay(trip.startDate, trip.endDate).indexOf(r.day) + 1}` : ''}${r.straight ? ' · líneas rectas entre paradas' : ''}</small><h3>${r.name}</h3></div><${IconBtn} icon="x" label="Cerrar" onClick=${onClose} /></div>
      <div class="btn-row">
        <a class="btn btn-sm btn-primary" href=${navigateUrl(ends[0])} target="_blank" rel="noopener"><${Icon} name="navigation" size=${16} /><span>Ir al inicio de la ruta</span></a>
        <a class="btn btn-sm btn-default" href=${isApple() ? appleDirectionsUrl(r.stops || ends) : googleDirectionsUrl(r.stops || ends)} target="_blank" rel="noopener"><${Icon} name="route" size=${16} /><span>Ver la ruta en Maps</span></a>
        <${Btn} size="sm" icon="trash" kind="ghost" onClick=${async () => { if (await confirm('¿Quitar esta ruta?', `«${r.name}» se quitará del mapa.`, { okLabel: 'Quitar', danger: true })) { updateTrip(trip.id, t => { t.routes = t.routes.filter(x => x.id !== r.id); }); onClose(); } }}>Quitar</${Btn}>
      </div>
    </div>`;
  }
  return null;
}

// ---------- Pestaña ----------
export function MapTab({ trip, route }) {
  const ref = useRef();
  const map = useLeafletMap(ref);
  const [hidden, setHidden] = useState(new Set());
  const [day, setDay] = useState('');
  const [sel, setSel] = useState(null);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(true);
  const [preview, setPreview] = useState(null);
  const mobile = useMedia('(max-width: 860px)');
  const fitted = useRef(false);
  const layerRef = useRef();
  const previewRef = useRef();
  const meRef = useRef();
  const mapStyle = useStore(s => s.prefs.mapStyle || 'auto');

  useEffect(() => { if (mobile) setPanel(false); }, [mobile]);

  const data = useMemo(() => collect(trip, { hidden, day }), [trip, hidden, day]);
  const toggleLayer = key => setHidden(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // Dibuja capas
  useEffect(() => {
    if (!map) return;
    layerRef.current?.remove();
    layerRef.current = drawLayers(map, trip, data, { selected: sel, onSelect: setSel, labels: true });
    if (!fitted.current) { fitted.current = true; fitPoints(map, focusPoints(trip, data), trip); }
  }, [map, data, sel]);

  // Enfoca un elemento si la ruta lo indica (#/viaje/id/mapa/p-xxx)
  useEffect(() => {
    if (!map || !route.sub) return;
    const [type, id] = [route.sub.slice(0, 1), route.sub.slice(2)];
    if (type === 'p') {
      const p = trip.places.find(x => x.id === id);
      if (p?.lat != null) { setSel({ type: 'place', id }); setTimeout(() => focusOn(map, [p.lat, p.lng], 16), 50); fitted.current = true; }
    } else if (type === 't') {
      const r = trip.routes.find(x => x.id === id);
      if (r?.points?.length > 1) { setSel({ type: 'route', id }); setTimeout(() => map.fitBounds(r.points, { paddingTopLeft: [panelOffset(map) + 40, 60], paddingBottomRight: [40, 40] }), 50); fitted.current = true; }
    } else if (type === 'n') {
      const it = locatedPlans(trip).find(x => x.id === id);
      if (it) { setSel({ type: 'plan', id }); setTimeout(() => focusOn(map, [it.where.lat, it.where.lng], 16), 50); fitted.current = true; }
    } else if (type === 'r') {
      const r = trip.reservations.find(x => x.id === id);
      const pts = [r?.from, r?.to, r?.location].filter(x => x?.lat != null);
      if (pts.length) { setSel({ type: 'res', id }); setTimeout(() => { if (pts.length === 1) focusOn(map, [pts[0].lat, pts[0].lng], 15); else map.fitBounds(pts.map(p => [p.lat, p.lng]), { paddingTopLeft: [panelOffset(map) + 60, 60], paddingBottomRight: [60, 60] }); }, 50); fitted.current = true; }
    }
  }, [map, route.sub]);

  // Modo «añadir punto tocando el mapa»
  useEffect(() => {
    if (!map) return;
    const el = map.getContainer();
    el.classList.toggle('is-adding', adding);
    if (!adding) return;
    const onClick = async e => {
      setAdding(false);
      const { lat, lng } = e.latlng;
      toast('Buscando la dirección…');
      const info = await reverseGeocode(lat, lng);
      const place = await openModal(PlaceForm, { trip, place: newPlace({ name: info.name || '', address: info.address, lat, lng, category: 'sight' }) });
      if (place) setSel({ type: 'place', id: place.id });
    };
    map.once('click', onClick);
    return () => map.off('click', onClick);
  }, [adding, map]);

  // Marcador de vista previa de búsqueda
  useEffect(() => {
    if (!map) return;
    previewRef.current?.remove();
    if (!preview) return;
    const L = window.L;
    previewRef.current = L.marker([preview.lat, preview.lng], { icon: markerIcon(L, { color: '#1f2933', icon: 'search', selected: true }) }).addTo(map);
    focusOn(map, [preview.lat, preview.lng], Math.max(map.getZoom(), 15));
  }, [preview, map]);

  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const near = map ? { lat: map.getCenter().lat, lng: map.getCenter().lng } : trip.center;
      setResults(await geocode(q, { near: map && map.getZoom() >= 9 ? near : trip.center || undefined, limit: 8 }));
    } finally { setBusy(false); }
  };

  const addFromResult = async r => {
    const place = await openModal(PlaceForm, { trip, place: newPlace({ name: r.name, address: r.address, lat: r.lat, lng: r.lng, category: guessCategory(r) }) });
    if (place) { setPreview(null); setResults(null); setQ(''); setSel({ type: 'place', id: place.id }); }
  };

  const locate = () => {
    if (!navigator.geolocation) { toast('Este dispositivo no permite conocer la ubicación.', 'error'); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      const L = window.L;
      const ll = [pos.coords.latitude, pos.coords.longitude];
      meRef.current?.remove();
      meRef.current = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#2f7de1', fillOpacity: 1 }).addTo(map).bindTooltip('Estás aquí');
      focusOn(map, ll, 15);
    }, () => toast('No se pudo obtener tu ubicación. Revisa los permisos.', 'error'), { enableHighAccuracy: true, timeout: 12000 });
  };

  const importNow = async () => { if (await openModal(ImportModal, { trip })) { setHidden(new Set()); setDay(''); setSel(null); setTimeout(() => layerRef.current && fitPoints(map, focusPoints(trip, collect(getTrip(trip.id) || trip, { day: '' })), trip, { animate: true }), 120); } };

  const days = eachDay(trip.startDate, trip.endDate);
  const catCounts = {};
  for (const p of trip.places) if (p.lat != null) catCounts[p.category] = (catCounts[p.category] || 0) + 1;
  const resCounts = {};
  for (const r of trip.reservations) if (r.from?.lat != null || r.to?.lat != null || r.location?.lat != null) resCounts[r.kind] = (resCounts[r.kind] || 0) + 1;
  const routeCount = trip.routes.filter(r => r.points?.length > 1).length;
  const planCount = locatedPlans(trip).length;
  const listPlans = hidden.has('plans') ? [] : locatedPlans(trip, day);
  const listPlaces = trip.places.filter(p => !hidden.has(`p:${p.category}`) && (!day || p.day === day));
  const junk = trip.places.filter(p => isRouteInstruction(p.name));
  const cleanJunk = async () => {
    if (!await confirm('Quitar indicaciones de ruta', `Se quitarán ${junk.length} puntos que parecen indicaciones de navegación (como «Gira a la izquierda»). Las rutas y los demás lugares no se tocan.`, { okLabel: `Quitar ${junk.length}`, danger: true })) return;
    const ids = new Set(junk.map(p => p.id));
    updateTrip(trip.id, t => { t.places = t.places.filter(p => !ids.has(p.id)); });
    setSel(null);
    toast('Indicaciones quitadas', 'ok');
  };
  // Paradas del día: lugares con día y planes con lugar, por hora.
  const dayStops = day ? [
    ...trip.places.filter(p => p.day === day && p.lat != null),
    ...locatedPlans(trip, day).map(it => ({ ...it.where, time: it.time })),
  ].sort((a, b) => (a.time || '99').localeCompare(b.time || '99')) : [];
  const empty = !trip.places.length && !trip.routes.length && !data.res.length && !planCount;

  return html`<div class="map-wrap">
    <div class="map" ref=${ref}></div>

    <div class="map-tools">
      <${Btn} size="sm" kind=${adding ? 'primary' : 'default'} icon="crosshair" onClick=${() => setAdding(a => !a)} aria-label="Añadir punto">Añadir punto</${Btn}>
      <${Btn} size="sm" icon="import" onClick=${importNow} aria-label="Importar">Importar</${Btn}>
      <${Menu} items=${[
        { icon: 'maximize', label: 'Centrar en el destino', onClick: () => fitPoints(map, focusPoints(trip, data), trip, { animate: true }) },
        { icon: 'globe', label: 'Ver todo (con vuelos)', onClick: () => layerRef.current && fit(map, layerRef.current, trip, { animate: true }) },
        { icon: 'navigation', label: 'Mi ubicación', onClick: locate },
        { icon: 'download', label: 'Exportar lugares y rutas (KML)', onClick: () => { if (exportTripKml(trip)) toast('Archivo KML guardado. Para verlo en Google Maps, impórtalo en «Mis mapas» (mymaps.google.com).', 'ok', { ms: 9000 }); else toast('No se pudo guardar el archivo.', 'error'); } },
        '-',
        ...Object.entries({ auto: 'Estilo automático', ...Object.fromEntries(Object.entries(MAP_STYLES).map(([k, v]) => [k, `Estilo: ${v.label}`])) })
          .map(([k, label]) => ({ icon: mapStyle === k ? 'check' : 'layers', label, onClick: () => setPrefs({ mapStyle: k }) })),
      ]} button=${t => html`<button type="button" class="btn btn-default btn-sm btn-icon" onClick=${t} aria-label="Opciones del mapa"><${Icon} name="layers" size=${16} /></button>`} />
    </div>

    ${adding && html`<div class="map-hint"><${Icon} name="crosshair" size=${16} /><span>Toca el mapa donde quieras poner el punto</span><button type="button" class="link-btn" onClick=${() => setAdding(false)}>Cancelar</button></div>`}

    <button type="button" class=${cx('panel-toggle', panel && 'is-open')} onClick=${() => setPanel(p => !p)} aria-expanded=${panel}>
      <${Icon} name=${panel ? 'chevron-left' : 'search'} size=${18} /><span>${panel ? 'Ocultar' : `Buscar y lista${trip.places.length ? ` (${trip.places.length})` : ''}`}</span></button>

    ${panel && html`<aside class="map-panel">
      <form class="search-row" onSubmit=${e => { e.preventDefault(); search(); }}>
        <input class="input" type="search" placeholder="Buscar un sitio para añadir" value=${q} onInput=${e => { setQ(e.target.value); if (!e.target.value) { setResults(null); setPreview(null); } }} />
        <button type="submit" class="btn btn-default btn-icon" aria-label="Buscar" disabled=${busy}>${busy ? html`<${Spinner} size=${16} />` : html`<${Icon} name="search" size=${18} />`}</button>
      </form>
      ${results && html`<ul class="results results-map">
        ${results.map(r => html`<li class=${cx(preview === r && 'is-hi')}>
          <button type="button" onClick=${() => { setPreview(r); if (mobile) setPanel(false); }}><${Icon} name="pin" size=${16} /><span><b>${r.name}</b><small>${r.address}</small></span></button>
          <button type="button" class="btn btn-primary btn-sm" onClick=${() => addFromResult(r)}>Añadir</button></li>`)}
        ${!results.length && html`<li class="results-none">Sin resultados. Prueba añadiendo la ciudad.</li>`}
      </ul>`}

      ${junk.length > 0 && html`<div class="notice notice-warn map-junk">
        <${Icon} name="info" size=${16} />
        <span>Hay ${junk.length} ${junk.length === 1 ? 'punto que parece una indicación' : 'puntos que parecen indicaciones'} de ruta («Gira…», «Turn…»).</span>
        <${Btn} size="sm" icon="trash" onClick=${cleanJunk}>Quitar${junk.length > 1 ? ` (${junk.length})` : ''}</${Btn}>
      </div>`}

      ${(Object.keys(catCounts).length + Object.keys(resCounts).length + (routeCount ? 1 : 0) + (planCount ? 1 : 0) > 1 || days.length > 0) && html`<div class="panel-filters">
        ${Object.keys(catCounts).length + Object.keys(resCounts).length + (routeCount ? 1 : 0) + (planCount ? 1 : 0) > 1 && html`<div class="layers">
          <div class="layers-head"><span class="small muted">Mostrar en el mapa</span>${hidden.size > 0 && html`<button type="button" class="link-btn small" onClick=${() => setHidden(new Set())}>Ver todo</button>`}</div>
          <div class="chips chips-wrap">
            ${Object.entries(catCounts).map(([k, n]) => html`<${Chip} icon=${PLACE_CATS[k]?.icon} active=${!hidden.has(`p:${k}`)} count=${n}
              onClick=${() => toggleLayer(`p:${k}`)}>${PLACE_CATS[k]?.label}</${Chip}>`)}
            ${Object.entries(resCounts).map(([k, n]) => html`<${Chip} icon=${RES_KINDS[k]?.icon} active=${!hidden.has(`r:${k}`)} count=${n}
              onClick=${() => toggleLayer(`r:${k}`)}>${RES_KINDS[k]?.label}</${Chip}>`)}
            ${planCount > 0 && html`<${Chip} icon=${PLAN_MARK.icon} active=${!hidden.has('plans')} count=${planCount}
              onClick=${() => toggleLayer('plans')}>Planes</${Chip}>`}
            ${routeCount > 0 && html`<${Chip} icon="route" active=${!hidden.has('routes')} count=${routeCount}
              onClick=${() => toggleLayer('routes')}>Rutas</${Chip}>`}
          </div>
        </div>`}
        ${days.length > 0 && html`<${Select} class="input input-sm" value=${day} onChange=${e => { setDay(e.target.value); fitted.current = false; }} aria-label="Filtrar por día">
          <option value="">Todos los días</option>${days.map((d, i) => html`<option value=${d}>Día ${i + 1} · ${fmtDate(d, 'weekday')}</option>`)}</${Select}>`}
      </div>`}

      ${day && dayStops.length > 1 && html`<div class="day-route">
        <span class="small">Ruta del día (${dayStops.length} paradas)</span>
        <a class="btn btn-sm btn-default" href=${isApple() ? appleDirectionsUrl(dayStops) : googleDirectionsUrl(dayStops)} target="_blank" rel="noopener"><${Icon} name="navigation" size=${15} /><span>Navegar</span></a>
      </div>`}

      ${empty && !results ? html`<div class="panel-empty">
        <p><b>Tu mapa está vacío.</b></p>
        <p class="muted small">Busca sitios arriba, toca «Añadir punto» y pulsa en el mapa, o importa tus listas de Google Maps o Apple Maps.</p>
        <${Btn} size="sm" icon="import" onClick=${importNow}>Importar de Google o Apple</${Btn}>
      </div>` : html`<ul class="place-list">
        ${listPlaces.map(p => {
          const c = PLACE_CATS[p.category] || PLACE_CATS.other;
          return html`<li class=${cx(sel?.type === 'place' && sel.id === p.id && 'is-sel', p.visited && 'is-done')}>
            <button type="button" onClick=${() => { setSel({ type: 'place', id: p.id }); if (mobile) setPanel(false); if (p.lat != null) setTimeout(() => focusOn(map, [p.lat, p.lng], Math.max(map.getZoom(), 15)), mobile ? 60 : 0); }}>
              <span class="pl-dot" style=${`--kc:${c.color}`}><${Icon} name=${c.icon} size=${14} /></span>
              <span class="pl-text"><b>${p.name}</b><small>${[p.day ? `Día ${days.indexOf(p.day) + 1}` : '', p.lat == null ? 'sin ubicación' : '', p.address].filter(Boolean).join(' · ')}</small></span>
            </button></li>`;
        })}
        ${listPlans.length > 0 && html`<li class="pl-sep">Planes del itinerario</li>`}
        ${listPlans.map(it => html`<li class=${cx(sel?.type === 'plan' && sel.id === it.id && 'is-sel')}>
          <button type="button" onClick=${() => { setSel({ type: 'plan', id: it.id }); if (mobile) setPanel(false); setTimeout(() => focusOn(map, [it.where.lat, it.where.lng], Math.max(map.getZoom(), 15)), mobile ? 60 : 0); }}>
            <span class="pl-dot" style=${`--kc:${PLAN_MARK.color}`}><${Icon} name=${PLAN_MARK.icon} size=${14} /></span>
            <span class="pl-text"><b>${it.text}</b><small>${[days.includes(it.day) ? `Día ${days.indexOf(it.day) + 1}` : fmtDate(it.day, 'weekday'), it.time, it.where.name !== it.text ? it.where.name : '', it.where.address].filter(Boolean).join(' · ')}</small></span>
          </button></li>`)}
        ${data.routes.length > 0 && html`<li class="pl-sep">Rutas</li>`}
        ${data.routes.map(r => html`<li class=${cx(sel?.type === 'route' && sel.id === r.id && 'is-sel')}><button type="button" onClick=${() => { setSel({ type: 'route', id: r.id }); if (mobile) setPanel(false); map.fitBounds(r.points, { paddingTopLeft: [mobile ? 40 : panelOffset(map) + 40, 60], paddingBottomRight: [40, 40] }); }}>
          <span class="pl-dot" style=${`--kc:${r.color}`}><${Icon} name="route" size=${14} /></span><span class="pl-text"><b>${r.name}</b><small>${[r.day && days.includes(r.day) ? `Día ${days.indexOf(r.day) + 1}` : '', `${r.points.length} puntos`].filter(Boolean).join(' · ')}</small></span></button></li>`)}
      </ul>`}
      <p class="map-legend small muted"><span class="lg lg-round"></span> lugares y planes <span class="lg lg-square"></span> reservas <span class="lg lg-dash"></span> trayectos</p>
    </aside>`}

    ${sel && html`<${SelectedCard} trip=${trip} sel=${sel} onClose=${() => setSel(null)} />`}
    ${preview && !sel && html`<div class="map-card-sel">
      <div class="sel-head"><span class="sel-ico"><${Icon} name="search" size=${18} /></span><div><small>Resultado</small><h3>${preview.name}</h3></div>
        <${IconBtn} icon="x" label="Cerrar" onClick=${() => setPreview(null)} /></div>
      <p class="muted small">${preview.address}</p>
      <div class="btn-row"><${Btn} kind="primary" size="sm" icon="plus" onClick=${() => addFromResult(preview)}>Añadir al viaje</${Btn}></div>
    </div>`}
  </div>`;
}
