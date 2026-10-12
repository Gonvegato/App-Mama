// Pestaña Rutas: importar recorridos (GPX, KML…) y seguirlos viendo tu ubicación encima.
// Pensado también sin conexión: los puntos de la ruta están guardados y el mapa usa los
// trozos ya visitados. La nube y el móvil siguen funcionando igual.
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { Btn, Icon, IconBtn, Empty, Field, Modal, openModal, confirm } from './kit.js';
import { ImportModal } from './map-import.js';
import { loadLeaflet, baseLayer, currentMapStyle } from '../lib/leaflet-loader.js';
import { PLACE_CATS, RES_KINDS } from '../lib/model.js';
import { ICONS } from '../lib/icon-data.js';
import { updateTrip, getTrip } from '../lib/store.js';
import { routeLengthKm, nearestOnRoute, fmtKm, routeStats } from '../lib/geo-route.js';
import { appleDirectionsUrl, googleDirectionsUrl, isApple, distanceKm } from '../lib/geo.js';
import { cx } from '../lib/util.js';

const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Puntos de referencia del viaje (alojamiento y lugares) para enseñarlos tenues al seguir.
function referencePoints(trip) {
  const pts = [];
  for (const p of trip.places) if (p.lat != null) {
    const c = PLACE_CATS[p.category] || PLACE_CATS.other;
    pts.push({ lat: p.lat, lng: p.lng, name: p.name, icon: c.icon, color: c.color });
  }
  for (const r of trip.reservations) {
    const k = RES_KINDS[r.kind];
    if (r.location?.lat != null) pts.push({ lat: r.location.lat, lng: r.location.lng, name: r.location.name || r.title || k.label, icon: k.icon, color: k.color });
  }
  return pts;
}

function refIcon(L, { color, icon }) {
  return L.divIcon({
    className: '',
    html: `<div class="mk mk-round is-faded" style="--c:${color}"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon] || ICONS.pin}</svg></div>`,
    iconSize: [26, 26], iconAnchor: [13, 13],
  });
}

// ---------- Seguir una ruta ----------
function RouteFollow({ trip, route, onExit }) {
  const ref = useRef();
  const mapRef = useRef();
  const meRef = useRef();
  const accRef = useRef();
  const snapRef = useRef();
  const wakeRef = useRef(null);
  const [status, setStatus] = useState({ state: 'init' }); // init | ok | denied | error
  const [info, setInfo] = useState(null);                  // { offKm, aheadKm, progress }
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  useEffect(() => { followRef.current = follow; }, [follow]);

  const total = routeLengthKm(route.points);

  // Monta el mapa y dibuja la ruta.
  useEffect(() => {
    let alive = true, m;
    loadLeaflet().then(async L => {
      if (!alive || !ref.current) return;
      m = L.map(ref.current, { zoomControl: true, attributionControl: true, worldCopyJump: true, zoomSnap: 0.5 });
      m.zoomControl.setPosition('topright');
      m.attributionControl.setPrefix(false);
      mapRef.current = m;
      const layer = await baseLayer(L, currentMapStyle(), { interactive: true });
      if (!alive) return;
      layer.addTo(m);
      // Referencia tenue: alojamiento y lugares del viaje.
      for (const p of referencePoints(trip)) L.marker([p.lat, p.lng], { icon: refIcon(L, p), keyboard: false }).addTo(m).bindTooltip(esc(p.name), { direction: 'top', offset: [0, -12] });
      // La ruta, con borde claro para que se vea sobre cualquier fondo.
      L.polyline(route.points, { color: '#ffffff', weight: 8, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(m);
      L.polyline(route.points, { color: route.color || '#2f7de1', weight: 4.5, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(m);
      const first = route.points[0], last = route.points[route.points.length - 1];
      L.marker(first, { icon: endIcon(L, 'start'), keyboard: false }).addTo(m).bindTooltip('Inicio', { direction: 'top', offset: [0, -12] });
      L.marker(last, { icon: endIcon(L, 'end'), keyboard: false }).addTo(m).bindTooltip('Final', { direction: 'top', offset: [0, -12] });
      m.fitBounds(route.points, { padding: [50, 50], maxZoom: 16 });
      // Si el usuario arrastra el mapa, se deja de centrar solo.
      m.on('dragstart', () => { if (followRef.current) setFollow(false); });
      const ro = new ResizeObserver(() => m.invalidateSize());
      ro.observe(ref.current);
      m._cvRO = ro;
    }).catch(e => { setStatus({ state: 'error', msg: e.message }); });
    return () => { alive = false; if (m) { m._cvRO?.disconnect(); m.remove(); } };
  }, []);

  // Mantener la pantalla encendida mientras se sigue (si el dispositivo lo permite).
  useEffect(() => {
    let released = false;
    const req = () => navigator.wakeLock?.request?.('screen').then(w => { if (released) w.release?.(); else wakeRef.current = w; }).catch(() => {});
    req();
    const onVis = () => { if (document.visibilityState === 'visible' && !wakeRef.current) req(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { released = true; document.removeEventListener('visibilitychange', onVis); try { wakeRef.current?.release?.(); } catch { /* nada */ } wakeRef.current = null; };
  }, []);

  // Ubicación en vivo.
  useEffect(() => {
    if (!navigator.geolocation) { setStatus({ state: 'error', msg: 'Este dispositivo no permite conocer la ubicación.' }); return; }
    const id = navigator.geolocation.watchPosition(pos => {
      const L = window.L, m = mapRef.current;
      if (!m) return;
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const ll = [here.lat, here.lng];
      const acc = pos.coords.accuracy || 0;
      if (!meRef.current) {
        meRef.current = L.circleMarker(ll, { radius: 9, color: '#fff', weight: 3, fillColor: '#2f7de1', fillOpacity: 1, className: 'me-dot' }).addTo(m);
        accRef.current = L.circle(ll, { radius: acc, color: '#2f7de1', weight: 1, opacity: 0.4, fillColor: '#2f7de1', fillOpacity: 0.1 }).addTo(m);
      } else {
        meRef.current.setLatLng(ll);
        accRef.current.setLatLng(ll).setRadius(acc);
      }
      const near = nearestOnRoute(route.points, here);
      setInfo({ offKm: near.offKm, aheadKm: near.aheadKm, progress: near.progress, acc });
      setStatus({ state: 'ok' });
      // Marca el punto de la ruta más cercano.
      if (!snapRef.current) snapRef.current = L.circleMarker([near.at.lat, near.at.lng], { radius: 5, color: route.color || '#2f7de1', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(m);
      else snapRef.current.setLatLng([near.at.lat, near.at.lng]);
      if (followRef.current) m.panTo(ll, { animate: true, duration: 0.6 });
    }, err => {
      setStatus({ state: err.code === 1 ? 'denied' : 'error', msg: err.message });
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const off = info && info.offKm > 0.08;
  return html`<div class="follow">
    <div class="follow-map" ref=${ref}></div>
    <div class="follow-top">
      <${IconBtn} icon="chevron-left" label="Salir de seguir" class="follow-exit" onClick=${onExit} />
      <div class="follow-name"><${Icon} name="route" size=${16} /><span>${route.name}</span></div>
    </div>

    ${status.state === 'denied' && html`<div class="follow-msg"><${Icon} name="navigation" size=${18} /> No se ha dado permiso para la ubicación. Actívalo para ver dónde estás sobre la ruta.</div>`}
    ${status.state === 'error' && html`<div class="follow-msg"><${Icon} name="alert" size=${18} /> ${status.msg || 'No se pudo obtener la ubicación.'}</div>`}
    ${status.state === 'init' && html`<div class="follow-msg"><${Icon} name="navigation" size=${18} /> Buscando tu ubicación…</div>`}

    ${!follow && status.state === 'ok' && html`<button type="button" class="follow-recenter" onClick=${() => { setFollow(true); const m = mapRef.current; if (m && meRef.current) m.panTo(meRef.current.getLatLng(), { animate: true }); }}><${Icon} name="crosshair" size=${16} /> Centrar en mí</button>`}

    <div class="follow-stats">
      <div class="fs-bar"><span class="fs-fill" style=${`width:${Math.round((info?.progress || 0) * 100)}%;--c:${route.color || '#2f7de1'}`}></span></div>
      <div class="fs-row">
        <div class="fs-cell"><small>Queda</small><b>${info ? fmtKm(info.aheadKm) : '—'}</b></div>
        <div class="fs-cell"><small>Hecho</small><b>${info ? `${Math.round(info.progress * 100)} %` : '—'}</b></div>
        <div class="fs-cell"><small>Ruta total</small><b>${fmtKm(total)}</b></div>
        <div class=${cx('fs-cell', off && 'fs-warn')}><small>${off ? 'Fuera de ruta' : 'En la ruta'}</small><b>${info ? (off ? fmtKm(info.offKm) : '✓') : '—'}</b></div>
      </div>
      ${off && html`<p class="fs-off"><${Icon} name="alert" size=${14} /> Estás a ${fmtKm(info.offKm)} de la ruta. Vuelve a la línea marcada.</p>`}
    </div>
  </div>`;
}

function endIcon(L, which) {
  const color = which === 'start' ? '#2f8f4e' : '#a2594a';
  const ic = which === 'start' ? ICONS.flag || ICONS.pin : ICONS.flag || ICONS.pin;
  return L.divIcon({ className: '', html: `<div class="mk mk-round" style="--c:${color}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic}</svg></div>`, iconSize: [28, 28], iconAnchor: [14, 14] });
}

// Ventana para cambiar el nombre de una ruta (sin usar el prompt del navegador, que el programa no muestra).
function RenameRoute({ close, trip, r }) {
  const [name, setName] = useState(r.name);
  const save = () => { const v = name.trim(); if (v) updateTrip(trip.id, t => { const x = t.routes.find(x => x.id === r.id); if (x) x.name = v; }); close(); };
  return html`<${Modal} title="Nombre de la ruta" close=${close} size="sm" onSubmit=${save}
    footer=${html`<${Btn} kind="primary" type="submit">Guardar</${Btn}>`}>
    <${Field} label="Nombre"><input class="input input-lg" value=${name} autofocus onInput=${e => setName(e.target.value)} /></${Field}>
  </${Modal}>`;
}

// Dibuja el perfil de altitud: altura frente a distancia recorrida.
function ElevationProfile({ points }) {
  const W = 520, H = 120, pad = 4;
  const eles = [];
  let dist = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) dist += distanceKm({ lat: points[i - 1][0], lng: points[i - 1][1] }, { lat: points[i][0], lng: points[i][1] });
    if (points[i].length > 2 && isFinite(points[i][2])) eles.push({ x: dist, y: points[i][2] });
  }
  if (eles.length < 2) return null;
  const maxX = eles[eles.length - 1].x || 1;
  const ys = eles.map(e => e.y);
  const minY = Math.min(...ys), maxY = Math.max(...ys), span = maxY - minY || 1;
  const px = x => pad + (x / maxX) * (W - 2 * pad);
  const py = y => pad + (1 - (y - minY) / span) * (H - 2 * pad);
  const line = eles.map((e, i) => `${i ? 'L' : 'M'}${px(e.x).toFixed(1)} ${py(e.y).toFixed(1)}`).join(' ');
  const area = `${line} L${px(maxX).toFixed(1)} ${H - pad} L${px(0).toFixed(1)} ${H - pad} Z`;
  return html`<svg class="elev-svg" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Perfil de altitud">
    <path d=${area} class="elev-area" />
    <path d=${line} class="elev-line" />
  </svg>`;
}

// Menú con todo lo que se sabe de la ruta, y el botón para empezar.
function RouteInfo({ close, trip, r, onFollow }) {
  const s = routeStats(r);
  const diffClass = `diff-${s.difficulty.level}`;
  return html`<${Modal} title=${r.name} close=${close} size="md"
    footer=${html`<${Btn} kind="primary" icon="navigation" onClick=${() => { close(); onFollow(r); }}>Empezar ruta</${Btn}>`}>
    <div class="route-info">
      <div class="ri-stats">
        <div class="ri-stat"><small>Distancia</small><b>${fmtKm(s.lengthKm)}</b></div>
        ${s.ele.has && html`<div class="ri-stat"><small>Subida</small><b>↑ ${s.ele.ascent} m</b></div>`}
        ${s.ele.has && html`<div class="ri-stat"><small>Bajada</small><b>↓ ${s.ele.descent} m</b></div>`}
        ${s.ele.has && html`<div class="ri-stat"><small>Altitud</small><b>${s.ele.min}–${s.ele.max} m</b></div>`}
        <div class=${cx('ri-stat', 'ri-diff', diffClass)}><small>Dificultad</small><b>${s.difficulty.label}</b></div>
      </div>
      ${s.ele.has ? html`<div class="ri-profile">
          <${ElevationProfile} points=${r.points} />
          <div class="ri-profile-ax"><span>0</span><span>${fmtKm(s.lengthKm)}</span></div>
        </div>`
        : html`<p class="muted small"><${Icon} name="info" size=${15} /> Este archivo no trae datos de altitud, así que no se puede mostrar el desnivel ni el perfil. La dificultad es solo por distancia.</p>`}
      <p class="muted small ri-note">La dificultad es orientativa (según distancia y subida, no el tipo de terreno). Para indicaciones calle a calle usa «Abrir en Maps» desde la lista.</p>
    </div>
  </${Modal}>`;
}

// ---------- Lista de rutas ----------
function RouteCard({ trip, r, onFollow }) {
  const len = routeLengthKm(r.points);
  const ends = [r.points[0], r.points[r.points.length - 1]].map(([lat, lng]) => ({ lat, lng }));
  const rename = () => openModal(RenameRoute, { trip, r });
  const del = async () => {
    if (await confirm('¿Quitar esta ruta?', `«${r.name}» se quitará del viaje.`, { okLabel: 'Quitar', danger: true }))
      updateTrip(trip.id, t => { t.routes = t.routes.filter(x => x.id !== r.id); });
  };
  const s = routeStats(r);
  const sub = [fmtKm(s.lengthKm), s.ele.has ? `↑ ${s.ele.ascent} m` : null, s.difficulty.label].filter(Boolean).join(' · ');
  return html`<article class="route-card" style=${`--kc:${r.color || '#4c6f86'}`}>
    <div class="route-head">
      <span class="route-ico"><${Icon} name="route" size=${18} /></span>
      <div class="route-text">
        <h3>${r.name}</h3>
        <small>${sub}${r.straight ? ' · líneas rectas entre paradas' : ''}</small>
      </div>
    </div>
    <div class="btn-row">
      <${Btn} kind="primary" size="sm" icon="navigation" onClick=${() => onFollow(r)}>Empezar</${Btn}>
      <${Btn} size="sm" icon="info" onClick=${() => openModal(RouteInfo, { trip, r, onFollow })}>Detalles</${Btn}>
      <a class="btn btn-default btn-sm" href=${isApple() ? appleDirectionsUrl(r.stops || ends) : googleDirectionsUrl(r.stops || ends)} target="_blank" rel="noopener"><${Icon} name="external" size=${15} /><span>Abrir en Maps</span></a>
      <${Btn} size="sm" kind="ghost" icon="edit" onClick=${rename}>Renombrar</${Btn}>
      <${Btn} size="sm" kind="ghost" icon="trash" onClick=${del}>Quitar</${Btn}>
    </div>
  </article>`;
}

export function RoutesTab({ trip }) {
  const [following, setFollowing] = useState(null); // ruta que se está siguiendo
  const routes = trip.routes.filter(r => r.points?.length > 1);

  const importNow = () => openModal(ImportModal, { trip });

  if (following) {
    const live = (getTrip(trip.id) || trip).routes.find(r => r.id === following.id) || following;
    return html`<${RouteFollow} trip=${trip} route=${live} onExit=${() => setFollowing(null)} />`;
  }

  return html`<div class="page-pad routes-tab">
    <div class="toolbar">
      <div class="toolbar-left"><p class="muted small">Importa recorridos (senderos, rutas en coche o a pie) y síguelos viendo tu posición encima, aunque no haya conexión.</p></div>
      <${Btn} kind="primary" icon="import" onClick=${importNow}>Importar ruta</${Btn}>
    </div>
    ${!routes.length ? html`<${Empty} icon="route" title="Todavía no hay rutas"
      text="Importa un archivo GPX (Komoot, Wikiloc, Strava, tu reloj…), un KML de Google My Maps o una ruta de Google o Apple Maps. Luego pulsa «Seguir» para verte sobre ella mientras caminas o conduces.">
      <${Btn} kind="primary" icon="import" onClick=${importNow}>Importar una ruta</${Btn}>
    </${Empty}>`
    : html`<div class="route-list">
        ${routes.map(r => html`<${RouteCard} key=${r.id} trip=${trip} r=${r} onFollow=${setFollowing} />`)}
      </div>
      <p class="muted small routes-tip"><${Icon} name="info" size=${15} /> Al seguir una ruta, el alojamiento y los lugares del viaje salen también en el mapa como referencia. Para navegar con indicaciones calle a calle, usa «Abrir en Maps».</p>`}
  </div>`;
}
