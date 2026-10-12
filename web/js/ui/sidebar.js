// Barra lateral: crear viajes y lista de viajes agrupada.
import { html, useState } from '../../vendor/preact-htm.js';
import { Btn, Icon, openModal } from './kit.js';
import { Cover } from './cover.js';
import { TripForm } from './trip-form.js';
import { useStore } from '../lib/store.js';
import { sortTrips } from '../lib/model.js';
import { UsbBadge } from './usb-panel.js';
import { fmtRange, tripStatus, matches, cx } from '../lib/util.js';
import { tripPath } from '../lib/router.js';

export function SyncBadge({ compact }) {
  const s = useStore();
  const T = t => (compact ? null : html`<span>${t}</span>`);
  if (s.mode === 'local') return html`<span class="sync sync-local" title="Los datos se guardan solo en este dispositivo"><${Icon} name="database" size=${15} />${T('En este dispositivo')}</span>`;
  if (!s.online || s.pending) return html`<span class="sync sync-off" title="Los cambios se subirán al recuperar la conexión"><${Icon} name="cloud-off" size=${15} />${T(s.pending ? `Sin conexión · ${s.pending} pendiente${s.pending > 1 ? 's' : ''}` : 'Sin conexión')}</span>`;
  if (s.syncing) return html`<span class="sync sync-busy"><${Icon} name="refresh" size=${15} class="spin" />${T('Guardando…')}</span>`;
  return html`<span class="sync sync-ok" title="Todo guardado en la nube"><${Icon} name="cloud" size=${15} />${T('Guardado')}</span>`;
}

function TripLink({ trip, active }) {
  const st = tripStatus(trip);
  return html`<a class=${cx('side-trip', active && 'is-active')} href=${`#${tripPath(trip.id)}`} aria-current=${active ? 'page' : undefined}>
    <${Cover} trip=${trip} class="side-thumb" pattern=${false} thumb />
    <span class="side-text">
      <span class="side-title">${trip.title || trip.destination || 'Sin nombre'}</span>
      <span class="side-meta">${trip.startDate ? fmtRange(trip.startDate, trip.endDate) : 'Sin fechas'}${st.kind === 'upcoming' || st.kind === 'now' ? html` · <em>${st.label}</em>` : ''}</span>
    </span>
  </a>`;
}

function Group({ title, trips, activeId, collapsible, initiallyOpen = true }) {
  const [open, setOpen] = useState(initiallyOpen);
  if (!trips.length) return null;
  return html`<section class="side-group">
    <button type="button" class="side-group-head" onClick=${() => collapsible && setOpen(o => !o)} aria-expanded=${open} disabled=${!collapsible}>
      <span>${title}</span><span class="side-count">${trips.length}</span>
      ${collapsible && html`<${Icon} name=${open ? 'chevron-down' : 'chevron-right'} size=${14} />`}
    </button>
    ${open && trips.map(t => html`<${TripLink} key=${t.id} trip=${t} active=${t.id === activeId} />`)}
  </section>`;
}

export function Sidebar({ route }) {
  const trips = useStore(s => s.trips);
  const [q, setQ] = useState('');
  const activeId = route.name === 'trip' ? route.id : null;
  const filtered = trips.filter(t => matches(q, t.title, t.destination, ...(t.travelers || [])));
  const g = sortTrips(filtered);
  return html`<aside class="sidebar">
    <a class="brand" href="#/">
      <span class="brand-mark"><${Icon} name="compass" size=${20} /></span>
      <span class="brand-name">Cuaderno <em>de viajes</em></span>
    </a>
    <${Btn} kind="primary" icon="plus" class="side-new" onClick=${() => openModal(TripForm)}>Nuevo viaje</${Btn}>
    ${trips.length > 4 && html`<label class="side-search"><${Icon} name="search" size=${16} />
      <input type="search" placeholder="Buscar viaje" value=${q} onInput=${e => setQ(e.target.value)} aria-label="Buscar viaje" /></label>`}
    <nav class="side-list" aria-label="Viajes">
      <a class=${cx('side-home', route.name === 'home' && 'is-active')} href="#/"><${Icon} name="home" size=${17} /><span>Inicio</span></a>
      <${Group} title="Ahora de viaje" trips=${g.now} activeId=${activeId} />
      <${Group} title="Próximos" trips=${g.upcoming} activeId=${activeId} />
      <${Group} title="Sin fechas" trips=${g.nodate} activeId=${activeId} />
      <${Group} title="Anteriores" trips=${g.past} activeId=${activeId} collapsible initiallyOpen=${g.past.length <= 6 || !!q || g.past.some(t => t.id === activeId)} />
      ${q && !filtered.length && html`<p class="side-none">No hay viajes que coincidan.</p>`}
    </nav>
    <footer class="side-foot">
      <span class="side-badges"><${SyncBadge} /><${UsbBadge} /></span>
      <a class=${cx('side-settings', route.name === 'settings' && 'is-active')} href="#/ajustes" aria-label="Ajustes" title="Ajustes"><${Icon} name="settings" size=${18} /></a>
    </footer>
  </aside>`;
}
