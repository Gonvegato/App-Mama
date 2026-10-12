// Crear y editar un viaje: nombre, destino, fechas, viajeros y portada.
import { html, useState } from '../../vendor/preact-htm.js';
import { Modal, Btn, Field, Icon, pickFiles, Spinner, confirm } from './kit.js';
import { Cover, presetById } from './cover.js';
import { COVER_PRESETS } from '../lib/model.js';
import { createTrip, updateTrip, uploadFile, removeFiles, toast, getTrip, deleteTrip } from '../lib/store.js';
import { resizeImage } from '../lib/image.js';
import { geocode } from '../lib/geo.js';
import { uid, cx, daysBetween } from '../lib/util.js';
import { go, tripPath } from '../lib/router.js';

export function ChipsInput({ value, onChange, placeholder }) {
  const [txt, setTxt] = useState('');
  const add = () => {
    const parts = txt.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) onChange([...value, ...parts.filter(p => !value.includes(p))]);
    setTxt('');
  };
  return html`<div class="chips-input">
    ${value.map(v => html`<span class="tag">${v}<button type="button" aria-label=${`Quitar ${v}`} onClick=${() => onChange(value.filter(x => x !== v))}><${Icon} name="x" size=${12} /></button></span>`)}
    <input value=${txt} placeholder=${value.length ? '' : placeholder} onInput=${e => setTxt(e.target.value)}
      onKeyDown=${e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } else if (e.key === 'Backspace' && !txt && value.length) onChange(value.slice(0, -1)); }}
      onBlur=${add} />
  </div>`;
}

export function CoverPicker({ tripId, cover, onChange, title }) {
  const [busy, setBusy] = useState(false);
  const upload = async () => {
    const [f] = await pickFiles({ accept: 'image/*', multiple: false });
    if (!f) return;
    setBusy(true);
    try {
      const img = await resizeImage(f, 2400, 0.86);
      const up = await uploadFile(tripId, 'portada', img);
      // Miniatura para listas y tarjetas (gasta muchos menos datos en el móvil).
      let thumbPath = null;
      try { const th = await resizeImage(f, 640, 0.8, true); thumbPath = (await uploadFile(tripId, 'portada', th, `mini-${th.name}`)).path; } catch { /* sin miniatura */ }
      onChange({ type: 'image', path: up.path, thumbPath, focusY: 50 });
    } catch (e) { toast(`No se pudo subir la foto: ${e.message}`, 'error'); }
    setBusy(false);
  };
  const fake = { id: tripId, cover };
  return html`<div class="cover-picker">
    <${Cover} trip=${fake} class="cover-preview">
      <div class="cover-preview-title">${title || 'Tu viaje'}</div>
      ${busy && html`<div class="cover-busy"><${Spinner} size=${26} /></div>`}
    </${Cover}>
    <div class="swatches" role="radiogroup" aria-label="Colores de portada">
      ${COVER_PRESETS.map(p => html`<button type="button" role="radio" aria-checked=${cover?.type !== 'image' && cover?.id === p.id}
        class=${cx('swatch', cover?.type !== 'image' && cover?.id === p.id && 'is-active')} style=${`background:linear-gradient(135deg,${p.a},${p.b})`}
        aria-label=${`Color ${p.id}`} onClick=${() => onChange({ type: 'preset', id: p.id })}></button>`)}
      <button type="button" class="swatch swatch-upload" onClick=${upload} aria-label="Subir una foto"><${Icon} name="camera" size=${18} /></button>
    </div>
    ${cover?.type === 'image' && html`<label class="range-row"><span>Encuadre</span>
      <input type="range" min="0" max="100" value=${cover.focusY ?? 50} onInput=${e => onChange({ ...cover, focusY: +e.target.value })} /></label>`}
  </div>`;
}

export function TripForm({ close, trip }) {
  const editing = !!trip;
  const [id] = useState(() => trip?.id || uid());
  const [f, setF] = useState(() => ({
    title: trip?.title || '', destination: trip?.destination || '',
    startDate: trip?.startDate || '', endDate: trip?.endDate || '',
    travelers: trip?.travelers || [], cover: trip?.cover || { type: 'preset', id: presetById(COVER_PRESETS[Math.floor(Math.random() * COVER_PRESETS.length)].id).id },
  }));
  const [saving, setSaving] = useState(false);
  const set = patch => setF(s => ({ ...s, ...patch }));

  const nights = f.startDate && f.endDate ? daysBetween(f.startDate, f.endDate) : null;

  const save = async () => {
    if (!f.title.trim() && !f.destination.trim()) { toast('Pon al menos un nombre o un destino.', 'error'); return; }
    if (f.endDate && f.startDate && f.endDate < f.startDate) { toast('La vuelta no puede ser antes que la ida.', 'error'); return; }
    setSaving(true);
    const data = { ...f, title: f.title.trim() || f.destination.trim(), destination: f.destination.trim(), endDate: f.endDate || f.startDate };
    const destChanged = !editing || data.destination !== trip.destination;
    try {
      if (editing) {
        const oldCover = trip.cover?.type === 'image' ? trip.cover.path : null;
        updateTrip(id, t => { Object.assign(t, data); if (destChanged) t.center = null; });
        if (oldCover && (data.cover.type !== 'image' || data.cover.path !== oldCover)) removeFiles([oldCover, trip.cover.thumbPath].filter(Boolean));
        close(true);
      } else {
        await createTrip({ id, ...data });
        close(true);
        go(tripPath(id));
      }
      // Sitúa el destino en el mapa (para el mapa y el tiempo).
      if (destChanged && data.destination) {
        geocode(data.destination, { limit: 1 }).then(r => {
          if (r[0] && getTrip(id)) updateTrip(id, t => { t.center = { lat: r[0].lat, lng: r[0].lng, name: r[0].name }; });
        });
      }
    } catch (e) { toast(e.message, 'error'); setSaving(false); }
  };

  const cancel = () => {
    // Si se subió una portada nueva y no se guarda, se borra.
    if (f.cover?.type === 'image' && f.cover.path !== trip?.cover?.path) removeFiles([f.cover.path, f.cover.thumbPath].filter(Boolean));
    close(false);
  };

  const removeThis = async () => {
    if (!await confirm('¿Borrar este viaje?', `Se borrará «${trip.title || trip.destination}» con todos sus documentos, correos guardados y notas. No se puede deshacer.`, { okLabel: 'Borrar', danger: true })) return;
    if (f.cover?.type === 'image' && f.cover.path !== trip.cover?.path) removeFiles([f.cover.path, f.cover.thumbPath].filter(Boolean));
    close(false); go('/'); await deleteTrip(trip.id); toast('Viaje borrado', 'ok');
  };

  return html`<${Modal} title=${editing ? 'Editar viaje' : 'Nuevo viaje'} close=${cancel} size="lg" onSubmit=${save}
    footer=${html`${editing
        ? html`<${Btn} kind="ghost" icon="trash" class="btn-danger-text" onClick=${removeThis}>Borrar viaje</${Btn}>`
        : html`<${Btn} kind="ghost" onClick=${cancel}>Cancelar</${Btn}>`}
      <${Btn} kind="primary" type="submit" disabled=${saving}>${editing ? 'Guardar cambios' : 'Crear viaje'}</${Btn}>`}>
    <div class="form-grid trip-form">
      <div class="form-col">
        <${Field} label="Nombre del viaje"><input class="input input-lg" value=${f.title} onInput=${e => set({ title: e.target.value })} placeholder="Ej.: Primavera en Lisboa" autofocus /></${Field}>
        <${Field} label="Destino" hint="Ciudad, región o país. Sirve para situar el mapa y ver el tiempo.">
          <input class="input" value=${f.destination} onInput=${e => set({ destination: e.target.value })} placeholder="Ej.: Lisboa, Portugal" /></${Field}>
        <div class="field-row">
          <${Field} label="Ida"><input class="input" type="date" value=${f.startDate} onInput=${e => set({ startDate: e.target.value, endDate: f.endDate && f.endDate < e.target.value ? e.target.value : f.endDate })} /></${Field}>
          <${Field} label="Vuelta"><input class="input" type="date" value=${f.endDate} min=${f.startDate || undefined} onInput=${e => set({ endDate: e.target.value })} /></${Field}>
        </div>
        ${nights != null && nights >= 0 && html`<p class="muted small">${nights + 1} ${nights + 1 === 1 ? 'día' : 'días'} · ${nights} ${nights === 1 ? 'noche' : 'noches'}</p>`}
        <${Field} label="Quién viaja" hint="Escribe un nombre y pulsa Intro.">
          <${ChipsInput} value=${f.travelers} onChange=${v => set({ travelers: v })} placeholder="Ej.: Mamá, Papá" />
        </${Field}>
      </div>
      <div class="form-col">
        <span class="field-label">Portada</span>
        <${CoverPicker} tripId=${id} cover=${f.cover} title=${f.title || f.destination} onChange=${c => {
          if (f.cover?.type === 'image' && f.cover.path !== trip?.cover?.path && c.path !== f.cover.path) removeFiles([f.cover.path, f.cover.thumbPath].filter(Boolean));
          set({ cover: c });
        }} />
      </div>
    </div>
  </${Modal}>`;
}
