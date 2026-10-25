// Fotos hechas sin cobertura (p. ej. siguiendo una ruta): se guardan en el móvil con su
// ubicación y se suben solas a pCloud cuando vuelve la conexión.
import { idbPut, idbAll, idbDel } from './idb-cache.js';
import { getTrip, updateTrip, toast } from './store.js';
import { pcloudConfigured, pcloudTripFolder, pcloudUpload } from './pcloud.js';
import { sid } from './util.js';

const listeners = new Set();
const notify = () => listeners.forEach(l => l());
export const onQueueChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

// item: { tripId, blob, name, routeId?, day?, geo?: {lat, lng, acc} }
export async function queuePhoto(item) {
  const rec = { id: sid(), takenAt: new Date().toISOString(), ...item };
  await idbPut('photos', rec.id, rec);
  notify();
  return rec;
}

export async function queuedPhotos(tripId) {
  try { return (await idbAll('photos')).filter(p => !tripId || p.tripId === tripId); } catch { return []; }
}

let flushing = false;
// Sube lo que haya en cola. Devuelve cuántas fotos se subieron. Si no hay conexión
// o pCloud no está conectado, no hace nada y las fotos siguen guardadas.
export async function flushPhotoQueue() {
  if (flushing || !navigator.onLine || !pcloudConfigured()) return 0;
  flushing = true;
  let done = 0;
  try {
    const folders = new Map();
    for (const p of await queuedPhotos()) {
      const trip = getTrip(p.tripId);
      if (!trip) { await idbDel('photos', p.id); continue; }   // el viaje ya no existe
      try {
        if (!folders.has(p.tripId)) folders.set(p.tripId, await pcloudTripFolder(trip.title || trip.destination || 'Viaje'));
        const meta = await pcloudUpload(folders.get(p.tripId), new File([p.blob], p.name || 'foto.jpg', { type: p.blob.type || 'image/jpeg' }));
        updateTrip(p.tripId, t => {
          t.photos.push({
            id: sid(), fileid: meta.fileid, name: meta.name || p.name || 'Foto', width: meta.width, height: meta.height, addedAt: p.takenAt,
            ...(p.routeId ? { source: 'route', routeId: p.routeId } : {}), ...(p.day ? { day: p.day } : {}), ...(p.geo ? { geo: p.geo } : {}),
          });
        });
        await idbDel('photos', p.id);   // solo se borra la copia local cuando ya está subida y anotada
        done++;
      } catch { break; }                // sin conexión a medias: se reintenta luego
    }
  } finally { flushing = false; notify(); }
  if (done) toast(done > 1 ? `${done} fotos subidas a pCloud` : 'Foto subida a pCloud', 'ok');
  return done;
}

// Se llama una vez al arrancar: sube lo pendiente ahora y cada vez que vuelva la conexión.
export function startPhotoSync() {
  window.addEventListener('online', () => setTimeout(flushPhotoQueue, 1500));
  setTimeout(flushPhotoQueue, 4000);
  setInterval(() => { if (navigator.onLine) flushPhotoQueue(); }, 120000);
}
