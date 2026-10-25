// Pestaña Fotos: subir las fotos del viaje a pCloud y verlas dentro de la app.
// Las fotos NO se guardan en la nube de la app ni en el móvil: van a la cuenta de pCloud
// conectada (Ajustes → Fotos). Aquí solo se guardan sus datos (el id en pCloud) para poder
// mostrarlas con miniaturas servidas por pCloud.
import { html, useState, useEffect } from '../../vendor/preact-htm.js';
import { Btn, Icon, Empty, Modal, openModal, confirm, Spinner, pickFiles } from './kit.js';
import { updateTrip, toast } from '../lib/store.js';
import { resizeImage } from '../lib/image.js';
import { pcloudConfigured, pcloudTripFolder, pcloudUpload, pcloudThumb, pcloudDelete } from '../lib/pcloud.js';
import { sid } from '../lib/util.js';
import { go } from '../lib/router.js';
import { queuedPhotos, onQueueChange, flushPhotoQueue } from '../lib/photo-queue.js';

// Una miniatura de la galería (pide a pCloud la imagen y la muestra).
function PhotoTile({ photo, onOpen }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let on = true;
    pcloudThumb(photo.fileid, '320x320').then(u => on && setUrl(u)).catch(() => on && setErr(true));
    return () => { on = false; };
  }, [photo.fileid]);
  return html`<button type="button" class="photo-tile" onClick=${onOpen} aria-label=${photo.name || 'Foto'}>
    ${url ? html`<img src=${url} loading="lazy" alt=${photo.name || 'Foto'} />`
      : err ? html`<span class="photo-ph"><${Icon} name="image" size=${22} /></span>`
      : html`<span class="photo-ph"><${Spinner} size=${18} /></span>`}
  </button>`;
}

// Visor de una foto a tamaño grande, con opción de borrar.
function PhotoViewer({ close, trip, photo }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let on = true;
    pcloudThumb(photo.fileid, '1024x1024', { crop: false }).then(u => on && setUrl(u)).catch(() => on && setErr(true));
    return () => { on = false; };
  }, [photo.fileid]);
  const del = async () => {
    if (!await confirm('¿Borrar esta foto?', 'Se borrará también de la carpeta de pCloud. No se puede deshacer.', { okLabel: 'Borrar', danger: true })) return;
    try { await pcloudDelete(photo.fileid); } catch (e) { toast(`No se pudo borrar de pCloud: ${e.message}`, 'error'); return; }
    updateTrip(trip.id, t => { t.photos = t.photos.filter(p => p.id !== photo.id); });
    toast('Foto borrada', 'ok');
    close();
  };
  return html`<${Modal} title=${photo.name || 'Foto'} close=${close} size="xl" class="viewer photo-viewer"
    footer=${html`<${Btn} kind="ghost" icon="trash" onClick=${del}>Borrar</${Btn}><${Btn} kind="ghost" onClick=${close}>Cerrar</${Btn}>`}>
    <div class="photo-stage">
      ${url ? html`<img src=${url} alt=${photo.name || 'Foto'} />`
        : err ? html`<p class="error">No se pudo cargar la foto. Revisa la conexión.</p>`
        : html`<${Spinner} size=${28} />`}
    </div>
  </${Modal}>`;
}

export function PhotosTab({ trip }) {
  const [waiting, setWaiting] = useState(0);   // fotos hechas en ruta que aún no se han subido
  useEffect(() => {
    const upd = () => queuedPhotos(trip.id).then(l => setWaiting(l.length));
    upd();
    flushPhotoQueue();
    return onQueueChange(upd);
  }, [trip.id]);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(null);   // {i, total, pct}

  if (!pcloudConfigured()) {
    return html`<div class="page-pad"><${Empty} icon="image" title="Conecta pCloud para las fotos"
      text="Las fotos del viaje se guardan en la cuenta de pCloud y se ven aquí dentro. Se conecta una vez y vale en todos los dispositivos.">
      <${Btn} kind="primary" icon="cloud" onClick=${() => go('/ajustes/fotos')}>Conectar pCloud</${Btn}>
    </${Empty}></div>`;
  }

  const photos = [...(trip.photos || [])].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));

  const add = async () => {
    const files = await pickFiles({ accept: 'image/*', capture: 'environment' });
    if (!files.length) return;
    setBusy(true);
    let folderid;
    try { folderid = await pcloudTripFolder(trip.title || trip.destination || 'Viaje'); }
    catch (e) { toast(`No se pudo preparar la carpeta en pCloud: ${e.message}`, 'error'); setBusy(false); return; }
    let n = 0;
    for (let i = 0; i < files.length; i++) {
      setProg({ i: i + 1, total: files.length, pct: 0 });
      try {
        const img = await resizeImage(files[i], 2560);
        const meta = await pcloudUpload(folderid, img, { onProgress: pct => setProg({ i: i + 1, total: files.length, pct }) });
        updateTrip(trip.id, t => { t.photos.push({ id: sid(), fileid: meta.fileid, name: meta.name || files[i].name || 'Foto', width: meta.width, height: meta.height, addedAt: new Date().toISOString() }); });
        n++;
      } catch (e) { toast(`No se pudo subir «${files[i].name || 'foto'}»: ${e.message}`, 'error'); }
    }
    setProg(null); setBusy(false);
    if (n) toast(n > 1 ? `${n} fotos subidas` : 'Foto subida', 'ok');
  };

  return html`<div class="page-pad photos-tab">
    <div class="toolbar">
      <h3 class="section-title">Fotos del viaje${photos.length ? html` <span class="muted">· ${photos.length}</span>` : ''}</h3>
      <${Btn} kind="primary" icon=${busy ? undefined : 'camera'} onClick=${add} disabled=${busy}>
        ${busy ? html`<${Spinner} size=${15} /> ${prog ? `Subiendo ${prog.i}/${prog.total}${prog.pct ? ` · ${Math.round(prog.pct * 100)}%` : ''}…` : 'Subiendo…'}` : 'Añadir fotos'}
      </${Btn}>
    </div>
    <p class="muted small">Las fotos se guardan en pCloud. Para verlas hace falta conexión.</p>
    ${waiting > 0 && html`<p class="notice notice-warn"><${Icon} name="info" size=${16} /> <span>${waiting === 1 ? 'Hay 1 foto hecha en una ruta esperando' : `Hay ${waiting} fotos hechas en rutas esperando`} a subirse. Se suben solas cuando haya conexión.</span></p>`}
    ${photos.length === 0
      ? html`<${Empty} icon="image" title="Aún no hay fotos" text="Pulsa «Añadir fotos» para subir las del viaje." />`
      : html`<div class="photo-grid">
          ${photos.map(p => html`<${PhotoTile} key=${p.id} photo=${p} onOpen=${() => openModal(PhotoViewer, { trip, photo: p })} />`)}
        </div>`}
  </div>`;
}
