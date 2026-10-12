// Página de un viaje: portada, pestañas y contenido.
import { html, useEffect } from '../../vendor/preact-htm.js';
import { Btn, Icon, Menu, openModal, confirm, Empty, copyText } from './kit.js';
import { tripToIcs, tripSummaryText } from '../lib/share.js';
import { Cover } from './cover.js';
import { TripForm } from './trip-form.js';
import { SummaryTab } from './tab-summary.js';
import { ItineraryTab } from './tab-itinerary.js';
import { MapTab } from './tab-map.js';
import { RoutesTab } from './tab-routes.js';
import { BookingsTab } from './tab-bookings.js';
import { DocsTab } from './tab-docs.js';
import { MailTab } from './tab-mail.js';
import { PackingTab } from './tab-packing.js';
import { ExpensesTab } from './tab-expenses.js';
import { useStore, deleteTrip, duplicateTrip, toast, keepOffline, state } from '../lib/store.js';
import { fmtRange, tripStatus, cx, downloadBlob, safeFileName, daysBetween } from '../lib/util.js';
import { go, tripPath } from '../lib/router.js';
import { printTrip } from './print.js';

export const TABS = [
  { id: 'resumen', label: 'Resumen', icon: 'compass', C: SummaryTab },
  { id: 'itinerario', label: 'Itinerario', icon: 'calendar', C: ItineraryTab },
  { id: 'mapa', label: 'Mapa', icon: 'map', C: MapTab, full: true },
  { id: 'rutas', label: 'Rutas', icon: 'route', C: RoutesTab, count: t => t.routes.filter(r => r.points?.length > 1).length },
  { id: 'reservas', label: 'Reservas', icon: 'ticket', C: BookingsTab, count: t => t.reservations.length },
  { id: 'documentos', label: 'Documentos', icon: 'file', C: DocsTab, count: t => t.docs.length },
  { id: 'correos', label: 'Correos', icon: 'mail', C: MailTab, count: t => t.emails.length },
  { id: 'maleta', label: 'Maleta', icon: 'suitcase', C: PackingTab, count: t => (t.packing.length ? `${t.packing.filter(p => p.done).length}/${t.packing.length}` : 0) },
  { id: 'gastos', label: 'Gastos', icon: 'wallet', C: ExpensesTab },
];

export function TripPage({ route }) {
  const trip = useStore(s => s.trips.find(t => t.id === route.id));
  const phase = useStore(s => s.phase);
  const tab = TABS.find(t => t.id === route.tab) || TABS[0];

  useEffect(() => { document.title = trip ? `${trip.title || trip.destination} · Cuaderno de viajes` : 'Cuaderno de viajes'; }, [trip?.title]);
  useEffect(() => {
    // Mantiene visible la pestaña activa en móvil.
    document.querySelector('.tabs .is-active')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    document.querySelector('.main')?.scrollTo?.({ top: 0 });
  }, [route.tab, route.id]);

  // Si el viaje está en curso o empieza en 3 días, se guardan solos los billetes y reservas para verlos sin conexión.
  useEffect(() => {
    if (!trip || state.mode !== 'cloud' || !navigator.onLine) return;
    const st = tripStatus(trip);
    if (!(st.kind === 'now' || (st.kind === 'upcoming' && st.days <= 3))) return;
    const important = trip.docs.filter(d => d.path && ['billete', 'entrada', 'reserva', 'identidad', 'seguro'].includes(d.kind) && (d.size || 0) < 15 * 1024 * 1024);
    (async () => { for (const d of important) { try { await keepOffline(d.path); } catch { /* sigue */ } } })();
  }, [trip?.id, trip?.docs.length]);

  if (!trip) {
    return html`<div class="page"><${Empty} icon="compass" title=${phase === 'ready' ? 'Este viaje no existe' : 'Cargando…'} text=${phase === 'ready' ? 'Puede que se haya borrado desde otro dispositivo.' : ''}>
      <${Btn} onClick=${() => go('/')}>Volver al inicio</${Btn}></${Empty}></div>`;
  }

  const st = tripStatus(trip);
  const compact = tab.id !== 'resumen';
  const nights = trip.startDate && trip.endDate ? daysBetween(trip.startDate, trip.endDate) : null;

  const actions = [
    { icon: 'edit', label: 'Editar viaje', onClick: () => openModal(TripForm, { trip }) },
    { icon: 'copy', label: 'Duplicar viaje', onClick: async () => { const t = await duplicateTrip(trip.id); if (t) { toast('Viaje duplicado', 'ok'); go(tripPath(t.id)); } } },
    { icon: 'print', label: 'Imprimir o guardar en PDF', onClick: () => printTrip(trip) },
    { icon: 'calendar', label: 'Añadir al calendario (.ics)', onClick: () => { downloadBlob(new Blob([tripToIcs(trip)], { type: 'text/calendar' }), `${safeFileName(trip.title || 'viaje')}.ics`); toast('Abre el archivo descargado para añadir las reservas a tu calendario.', 'info'); } },
    { icon: 'users', label: 'Compartir resumen', onClick: async () => {
      const text = tripSummaryText(trip);
      try {
        if (navigator.share) { await navigator.share({ title: trip.title || trip.destination, text }); return; }
      } catch (e) { if (e?.name === 'AbortError') return; }
      await copyText(text); toast('Resumen copiado: pégalo en WhatsApp o en un correo.', 'ok');
    } },
    { icon: 'download', label: 'Exportar copia (.json)', onClick: () => downloadBlob(new Blob([JSON.stringify({ app: 'cuaderno-de-viajes', version: 1, trips: [trip] }, null, 2)], { type: 'application/json' }), `${safeFileName(trip.title || 'viaje')}.json`) },
    '-',
    { icon: 'trash', label: 'Borrar viaje', danger: true, onClick: async () => {
      if (await confirm('¿Borrar este viaje?', `Se borrará «${trip.title || trip.destination}» con todos sus documentos, correos guardados y notas. No se puede deshacer.`, { okLabel: 'Borrar', danger: true })) {
        go('/'); await deleteTrip(trip.id); toast('Viaje borrado', 'ok');
      } } },
  ];

  return html`<div class=${cx('trip', tab.full && 'trip-full')}>
    <${Cover} trip=${trip} class=${cx('hero', compact && 'hero-compact')}>
      <div class="hero-shade"></div>
      <div class="hero-top">
        <a class="hero-back only-mobile" href="#/" aria-label="Volver"><${Icon} name="back" size=${20} /></a>
        <div class="hero-actions">
          <button type="button" class="hero-btn" onClick=${() => openModal(TripForm, { trip })}><${Icon} name="image" size=${16} /><span>Portada y datos</span></button>
          <${Menu} items=${actions} button=${toggle => html`<button type="button" class="hero-btn hero-btn-icon" aria-label="Más opciones" onClick=${toggle}><${Icon} name="more" size=${18} /></button>`} />
        </div>
      </div>
      <div class="hero-text">
        ${!compact && st.kind !== 'nodate' && html`<span class=${`badge badge-${st.kind}`}>${st.label}</span>`}
        <h1>${trip.title || trip.destination || 'Sin nombre'}</h1>
        <p>
          ${trip.destination && trip.destination !== trip.title && html`<span>${trip.destination}</span>`}
          <span>${trip.startDate ? fmtRange(trip.startDate, trip.endDate) : 'Sin fechas'}</span>
          ${!compact && nights != null && nights > 0 && html`<span>${nights + 1} días</span>`}
        </p>
      </div>
    </${Cover}>
    <nav class="tabs" aria-label="Secciones del viaje">
      ${TABS.map(t => {
        const c = t.count?.(trip);
        return html`<a href=${`#${tripPath(trip.id, t.id)}`} class=${cx('tab', t.id === tab.id && 'is-active')} aria-current=${t.id === tab.id ? 'page' : undefined}>
          <${Icon} name=${t.icon} size=${17} /><span>${t.label}</span>${c ? html`<span class="tab-count">${c}</span>` : ''}
        </a>`;
      })}
    </nav>
    <section class=${cx('tab-body', `tab-${tab.id}`)} key=${tab.id}>
      <${tab.C} trip=${trip} route=${route} />
    </section>
  </div>`;
}
