// Tarjeta «Llévate el viaje sin internet»: descargar el viaje al dispositivo y quitarlo después.
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { Btn, Icon, Progress, Spinner, confirm } from './kit.js';
import { useStore, toast } from '../lib/store.js';
import { downloadTripOffline, removeTripOffline, getOfflineInfo, offlineBytes } from '../lib/offline.js';
import { fmtSize, fmtDate, dateOnly } from '../lib/util.js';

const phaseText = p => (!p ? '' : p.phase === 'docs' ? `Guardando documentos… ${p.done} de ${p.total}` : `Descargando el mapa… ${p.done} de ${p.total} trozos`);

export function OfflineCard({ trip }) {
  const [info, setInfo] = useState(undefined);       // undefined = cargando, null = nada descargado
  const [prog, setProg] = useState(null);
  const ctl = useRef(null);
  const online = useStore(s => s.online);
  const mapStyle = useStore(s => s.prefs.mapStyle || 'auto');
  const reload = () => getOfflineInfo(trip.id).then(setInfo);
  useEffect(() => { reload(); }, [trip.id]);

  const start = async () => {
    ctl.current = new AbortController();
    setProg({ phase: 'docs', done: 0, total: 0 });
    try {
      const res = await downloadTripOffline(trip, { onProgress: setProg, signal: ctl.current.signal });
      if (ctl.current.signal.aborted) { toast('Descarga cancelada', 'info'); }
      else toast(res.map.skipped === 'sin-sitios' ? 'Viaje guardado. No hay lugares ni rutas con ubicación, así que no se ha descargado mapa.' : 'Viaje guardado en este dispositivo', 'ok');
    } catch (e) { toast(e.message || 'No se pudo descargar el viaje.', 'error'); }
    ctl.current = null; setProg(null); reload();
  };

  const remove = async () => {
    if (!await confirm('¿Quitar el viaje de este dispositivo?', 'Se borran las copias guardadas aquí (documentos y mapa). No se borra nada de la nube: el viaje sigue en la aplicación y se puede volver a descargar.', { okLabel: 'Quitar del dispositivo', danger: true })) return;
    await removeTripOffline(trip.id);
    toast('Quitado de este dispositivo', 'ok');
    reload();
  };

  if (info === undefined) return null;
  const busy = !!prog;
  const outdated = info && trip.updatedAt && info.tripUpdatedAt && trip.updatedAt > info.tripUpdatedAt;
  const m = info?.map;

  return html`<section class="card offline-card">
    <h3 class="section-title"><${Icon} name="hard-drive" size=${18} /> Llévate el viaje sin internet</h3>
    ${!info && html`<p class="muted small">Guarda en este móvil los documentos, billetes y el mapa de la zona (lugares y rutas) para verlos aunque no haya cobertura. Hazlo antes de salir, con wifi. Cuando acabe el viaje, puedes quitarlo desde aquí.</p>`}
    ${info && html`<ul class="offline-facts">
      <li><${Icon} name="check-circle" size=${16} /> Guardado el ${fmtDate(dateOnly(info.savedAt), 'medium')} · ${fmtSize(offlineBytes(info))}</li>
      <li><${Icon} name="file" size=${16} /> ${info.docs.total ? `${info.docs.ok} de ${info.docs.total} documentos` : 'Sin documentos que guardar'}</li>
      <li><${Icon} name="map" size=${16} /> ${m?.tiles ? `Mapa de la zona hasta el detalle ${m.maxZoom || '—'} de 14${m.truncated ? ' (el límite de descarga hizo que no cupiera más)' : ''}` : m?.skipped === 'sin-sitios' ? 'Sin mapa: añade lugares o rutas con ubicación y vuelve a descargar' : 'El mapa no se ha podido descargar'}</li>
    </ul>`}
    ${outdated && html`<p class="notice notice-warn"><${Icon} name="info" size=${16} /> <span>Has cambiado cosas del viaje desde que lo guardaste. Pulsa «Actualizar» para llevarte lo último.</span></p>`}
    ${mapStyle === 'detalle' && html`<p class="notice notice-warn"><${Icon} name="info" size=${16} /> <span>Tienes elegido el mapa «Clásico (OpenStreetMap)», que no se puede guardar sin conexión. Elige Claro, Color u Oscuro en el menú del mapa.</span></p>`}
    ${busy ? html`<div class="offline-prog"><${Progress} value=${prog.done} max=${prog.total || 1} label="Descarga" />
        <div class="offline-prog-row"><span class="small muted"><${Spinner} size=${14} /> ${phaseText(prog)}</span><button type="button" class="link-btn small" onClick=${() => ctl.current?.abort()}>Cancelar</button></div></div>`
      : html`<div class="btn-row">
        <${Btn} kind=${info && !outdated ? 'default' : 'primary'} icon="download" onClick=${start} disabled=${!online}>${info ? 'Actualizar' : 'Descargar para usar sin conexión'}</${Btn}>
        ${info && html`<${Btn} kind="ghost" icon="trash" onClick=${remove}>Quitar del dispositivo</${Btn}>`}
      </div>
      ${!online && html`<p class="muted small">Sin conexión ahora mismo: para descargar hace falta internet.</p>`}`}
  </section>`;
}
