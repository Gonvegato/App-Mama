// Espacio para archivos: indicador, aviso y limpieza ordenada por tamaño.
import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { Btn, Icon, Modal, Progress, Spinner, Empty, openModal, confirm, Segmented } from './kit.js';
import { useStore, storageUsage, storageLimit, STORAGE_PLANS, saveSettings, updateTrip, removeFiles, toast } from '../lib/store.js';
import { DOC_KINDS } from '../lib/model.js';
import { fmtSize, fmtDate, tripStatus, cx, dateOnly } from '../lib/util.js';
import { openDoc } from './tab-docs.js';
import { listOfflineInfo, removeTripOffline, offlineBytes } from '../lib/offline.js';

export const WARN_AT = 0.8;

export function useUsage(deps = []) {
  const [u, setU] = useState(null);
  const trips = useStore(s => s.trips);
  useEffect(() => { let alive = true; storageUsage().then(r => alive && setU(r)).catch(() => {}); return () => { alive = false; }; }, [trips.length, ...deps]);
  return [u, () => storageUsage({ fresh: true }).then(setU)];
}

// Todos los archivos subidos, con su viaje, de mayor a menor.
function allFiles(trips) {
  const out = [];
  for (const t of trips) {
    for (const d of t.docs) if (d.path) out.push({ trip: t, doc: d, size: d.size || 0, key: `${t.id}:${d.id}` });
  }
  return out.sort((a, b) => b.size - a.size);
}

function CleanupModal({ close }) {
  const trips = useStore(s => s.trips);
  const [onlyPast, setOnlyPast] = useState(false);
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const files = allFiles(trips).filter(f => !onlyPast || tripStatus(f.trip).kind === 'past');
  const chosen = files.filter(f => sel.has(f.key));
  const total = chosen.reduce((a, f) => a + f.size, 0);
  const toggle = k => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const remove = async () => {
    if (!chosen.length) return;
    const important = chosen.filter(f => ['billete', 'identidad', 'seguro', 'reserva', 'entrada'].includes(f.doc.kind) && tripStatus(f.trip).kind !== 'past');
    const extra = important.length ? ` Ojo: ${important.length === 1 ? 'hay un billete o documento importante' : `hay ${important.length} billetes o documentos importantes`} de un viaje que aún no ha pasado.` : '';
    if (!await confirm(`¿Borrar ${chosen.length === 1 ? 'este archivo' : `estos ${chosen.length} archivos`}?`, `Se liberarán ${fmtSize(total)}. No se puede deshacer.${extra}`, { okLabel: 'Borrar', danger: true })) return;
    setBusy(true);
    const byTrip = new Map();
    for (const f of chosen) { if (!byTrip.has(f.trip.id)) byTrip.set(f.trip.id, new Set()); byTrip.get(f.trip.id).add(f.doc.id); }
    for (const [tid, ids] of byTrip) {
      updateTrip(tid, t => {
        t.docs = t.docs.filter(d => !ids.has(d.id));
        for (const r of t.reservations) r.docIds = (r.docIds || []).filter(id => !ids.has(id));
      });
    }
    await removeFiles(chosen.map(f => f.doc.path));
    await storageUsage({ fresh: true }).catch(() => {});
    toast(`Liberados ${fmtSize(total)}`, 'ok');
    setSel(new Set()); setBusy(false);
  };

  return html`<${Modal} title="Liberar espacio" close=${() => close()} size="lg" class="cleanup"
    footer=${html`<span class="cleanup-total">${chosen.length ? `${chosen.length} seleccionado${chosen.length > 1 ? 's' : ''} · ${fmtSize(total)}` : 'Marca lo que quieras borrar'}</span>
      <${Btn} kind="danger" icon=${busy ? undefined : 'trash'} disabled=${!chosen.length || busy} onClick=${remove}>${busy ? html`<${Spinner} size=${15} /> Borrando…` : 'Borrar'}</${Btn}>`}>
    <p class="muted small">Archivos subidos a todos los viajes, del más grande al más pequeño. Las guías grandes se pueden guardar mejor como enlace (en Documentos → «Enlace»).</p>
    <div class="cleanup-opts">
      <${Segmented} value=${onlyPast ? 'past' : 'all'} onChange=${v => { setOnlyPast(v === 'past'); setSel(new Set()); }} options=${[{ value: 'all', label: 'Todos los viajes' }, { value: 'past', label: 'Solo viajes pasados' }]} />
      ${files.length > 0 && html`<button type="button" class="link-btn small" onClick=${() => setSel(new Set(files.slice(0, 10).map(f => f.key)))}>Marcar los 10 más grandes</button>`}
    </div>
    ${!files.length ? html`<${Empty} icon="check-circle" title="No hay archivos" text=${onlyPast ? 'Los viajes pasados no tienen archivos subidos.' : 'Todavía no has subido ningún archivo.'} />`
      : html`<ul class="cleanup-list">
        ${files.map(f => {
          const st = tripStatus(f.trip);
          return html`<li class=${cx(sel.has(f.key) && 'is-sel')}>
            <label class="cleanup-check"><input type="checkbox" checked=${sel.has(f.key)} onChange=${() => toggle(f.key)} aria-label=${`Seleccionar ${f.doc.name}`} /></label>
            <button type="button" class="cleanup-row" onClick=${() => openDoc(f.trip, f.doc)}>
              <span class="cleanup-ico"><${Icon} name=${DOC_KINDS[f.doc.kind]?.icon || 'file'} size=${17} /></span>
              <span class="cleanup-text"><b>${f.doc.name}</b>
                <small>${f.trip.title || f.trip.destination}${st.kind === 'past' ? ' · viaje pasado' : ''}${f.doc.fromEmail ? ' · adjunto de un correo' : ''}${f.doc.addedAt ? ` · ${fmtDate(dateOnly(f.doc.addedAt))}` : ''}</small></span>
              <span class="cleanup-size">${f.size ? fmtSize(f.size) : '—'}</span>
            </button>
          </li>`;
        })}
      </ul>`}
  </${Modal}>`;
}

export const openCleanup = () => openModal(CleanupModal, {});

// Viajes descargados para usar sin conexión en este dispositivo, con botón para quitarlos.
// Quitar aquí solo borra la copia de este dispositivo, no el viaje ni sus archivos en la nube.
function OfflineList() {
  const trips = useStore(s => s.trips);
  const [list, setList] = useState(null);
  const reload = () => listOfflineInfo().then(l => setList(l.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''))));
  useEffect(() => { reload(); }, []);
  if (!list?.length) return null;
  const isPast = m => { const t = trips.find(x => x.id === m.tripId); return !t || tripStatus(t).kind === 'past'; };
  const past = list.filter(isPast);
  const drop = async ms => {
    const total = ms.reduce((a, m) => a + offlineBytes(m), 0);
    if (!await confirm(ms.length === 1 ? '¿Quitar este viaje del dispositivo?' : `¿Quitar ${ms.length} viajes del dispositivo?`, `Se liberan unos ${fmtSize(total)} de este dispositivo. No se borra nada de la nube.`, { okLabel: 'Quitar', danger: true })) return;
    for (const m of ms) await removeTripOffline(m.tripId);
    toast(`Liberados ${fmtSize(total)} de este dispositivo`, 'ok');
    reload();
  };
  return html`<div class="offline-block">
    <h3 class="section-title">Viajes descargados en este dispositivo</h3>
    <p class="muted small">Copias para usar sin conexión. Quitarlas no borra el viaje ni nada de la nube.</p>
    <ul class="offline-list">${list.map(m => html`<li>
      <span class="ol-text"><b>${m.title}</b><small>${fmtSize(offlineBytes(m))} · guardado el ${fmtDate(dateOnly(m.savedAt), 'medium')}${isPast(m) ? ' · viaje pasado' : ''}</small></span>
      <${Btn} size="sm" kind="ghost" icon="trash" onClick=${() => drop([m])}>Quitar</${Btn}></li>`)}</ul>
    ${past.length > 0 && html`<div class="btn-row"><${Btn} icon="trash" onClick=${() => drop(past)}>Quitar los de viajes pasados (${past.length})</${Btn}></div>`}
  </div>`;
}

// Tarjeta de Ajustes.
export function StorageSection() {
  const s = useStore();
  const [u, reload] = useUsage();
  const cloud = s.mode === 'cloud';
  const limit = storageLimit();
  const pct = u && cloud ? u.used / limit : 0;
  return html`<section class="set-section card" id="ajustes-espacio">
    <h2><${Icon} name="hard-drive" size=${20} /> Espacio para archivos</h2>
    ${!u ? html`<${Spinner} size=${18} />` : html`
      <div class="usage">
        <div class="usage-line"><b>${fmtSize(u.used)}</b>${cloud ? html` de ${fmtSize(limit)} <span class="muted">(${Math.round(pct * 100)} %)</span>` : ' en este dispositivo'}
          ${!u.exact && cloud ? html`<span class="muted small"> · aproximado</span>` : ''}</div>
        ${cloud && html`<${Progress} value=${u.used} max=${limit} label="Espacio usado" />`}
        ${cloud && pct >= WARN_AT && html`<p class="usage-warn"><${Icon} name="alert" size=${16} /> Queda poco espacio. Borra archivos que ya no necesites o amplía el plan de Supabase.</p>`}
      </div>
      <p class="muted small">Billetes, fotos, PDF y correos guardados. Los datos de los viajes (fechas, reservas, notas…) apenas ocupan.</p>
      <div class="btn-row">
        <${Btn} icon="trash" onClick=${async () => { await openCleanup(); reload(); }}>Liberar espacio</${Btn}>
        <${Btn} kind="ghost" icon="refresh" onClick=${reload}>Actualizar</${Btn}>
      </div>
      <${OfflineList} />
      ${cloud && html`<div class="field usage-plan"><span class="field-label">Plan de Supabase</span>
        <${Segmented} value=${s.settings.storagePlan || 'free'} onChange=${v => saveSettings({ storagePlan: v })}
          options=${Object.entries(STORAGE_PLANS).map(([value, p]) => ({ value, label: `${p.label} · ${fmtSize(p.bytes)}` }))} />
        <span class="field-hint">Indica el plan que tienes contratado para que el aviso salga a tiempo. Cambiarlo aquí no cambia el plan en Supabase.</span></div>`}
    `}
  </section>`;
}

// Aviso en el inicio cuando queda poco espacio.
export function StorageWarning() {
  const mode = useStore(s => s.mode);
  const [u] = useUsage();
  if (mode !== 'cloud' || !u) return null;
  const limit = storageLimit();
  const pct = u.used / limit;
  if (pct < WARN_AT) return null;
  return html`<div class="notice">
    <${Icon} name="hard-drive" size=${20} />
    <div><b>${pct >= 1 ? 'No queda espacio para archivos' : 'Queda poco espacio para archivos'}</b>
      <span>${fmtSize(u.used)} de ${fmtSize(limit)} (${Math.round(pct * 100)} %).</span></div>
    <${Btn} size="sm" kind="primary" onClick=${openCleanup}>Liberar espacio</${Btn}>
  </div>`;
}
