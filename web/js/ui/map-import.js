// Importar lugares y rutas desde Google Maps, Apple Maps y archivos (KML, KMZ, GPX, GeoJSON, CSV).
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { Btn, Icon, Modal, Segmented, Spinner, DropZone, pickFiles, Field, Select } from './kit.js';
import { parseFile, parseMapLink, extractUrls, merge, emptyImport } from '../lib/importers.js';
import { geocode, distanceKm } from '../lib/geo.js';
import { gmailConfigured, resolveUrl } from '../lib/gmail.js';
import { PLACE_CATS, newPlace, newRoute } from '../lib/model.js';
import { updateTrip, toast } from '../lib/store.js';
import { cx, sid, sleep, plural } from '../lib/util.js';

const ROUTE_COLORS = ['#4c6f86', '#a0624a', '#5e7a5a', '#7a5f7c', '#9a7b3c', '#3f7f86'];

function Help() {
  return html`<div class="import-help">
    <details open><summary>Google Maps: un lugar o una ruta</summary>
      <p>En el móvil, abre el lugar o la ruta en Google Maps → <b>Compartir</b> → <b>Copiar enlace</b>, y pégalo en «Enlaces». Puedes pegar muchos a la vez.</p></details>
    <details><summary>Google Maps: tus listas guardadas («Quiero ir», «Favoritos»…)</summary>
      <p>Desde el ordenador entra en <a href="https://takeout.google.com" target="_blank" rel="noopener">takeout.google.com</a> → «Anular selección» → marca solo <b>Guardado</b> (y si quieres <b>Mapas (tus sitios)</b>) → crea la exportación. Te llegará un .zip: descomprímelo e importa aquí los archivos <b>.csv</b> de cada lista o <b>Sitios guardados.json</b>.</p>
      <p class="muted small">Las listas de Takeout no traen coordenadas: la app busca cada sitio por su nombre y te deja revisar el resultado antes de añadirlo.</p></details>
    <details><summary>Google My Maps (mapas personalizados)</summary>
      <p>Abre el mapa en <a href="https://www.google.com/maps/d/" target="_blank" rel="noopener">My Maps</a> → menú ⋮ → <b>Descargar KML</b> → marca «Exportar a archivo .KML» → importa el archivo aquí. Se conservan las capas, las notas y las rutas.</p></details>
    <details><summary>Apple Maps</summary>
      <p>Abre un lugar o una ruta en Mapas → <b>Compartir</b> → <b>Copiar</b> y pégalo en «Enlaces». Apple Maps no permite exportar las guías enteras: hay que compartir los lugares uno a uno (puedes pegarlos todos juntos).</p>
      <p class="muted small">Si una app de rutas (Komoot, Wikiloc, Strava…) te da un archivo <b>GPX</b>, también se puede importar.</p></details>
    <details><summary>Enlaces cortos (maps.app.goo.gl, maps.apple)</summary>
      <p>Para abrir enlaces cortos hace falta tener conectado el ayudante de Gmail (Ajustes → Correo). Si no, abre el enlace en el navegador y copia la dirección completa que aparece arriba.</p></details>
  </div>`;
}

export function ImportModal({ close, trip }) {
  const [mode, setMode] = useState('links');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState(null);   // { places, routes, pending, warnings, orderedRoutes }
  const [checked, setChecked] = useState(new Set());
  const [cat, setCat] = useState('auto');
  const [geo, setGeo] = useState(null);       // progreso de búsqueda
  const stop = useRef(false);

  useEffect(() => () => { stop.current = true; }, []);

  const finish = res => {
    // Marca duplicados respecto a lo que ya hay en el viaje.
    const isDup = p => trip.places.some(x => x.lat != null && p.lat != null && distanceKm(x, p) < 0.05 && x.name.toLowerCase() === p.name.toLowerCase());
    res.places = res.places.map(p => ({ ...p, _id: sid(), _dup: isDup(p) }));
    res.pending = res.pending.map(p => ({ ...p, _id: sid() }));
    res.routes = res.routes.map(r => ({ ...r, _id: sid() }));
    setFound(res);
    setChecked(new Set([...res.places.filter(p => !p._dup).map(p => p._id), ...res.routes.map(r => r._id)]));
    if (res.pending.length) geocodePending(res);
  };

  const fromLinks = async () => {
    const urls = extractUrls(text);
    if (!urls.length) { toast('No he encontrado enlaces en el texto.', 'error'); return; }
    setBusy(true);
    const out = emptyImport();
    for (const u0 of urls) {
      let u = u0;
      let r = parseMapLink(u);
      if (r.needsResolve) {
        if (!gmailConfigured()) { out.warnings.push(`Enlace corto sin abrir: ${u0}. Conecta el ayudante de Gmail o pega el enlace completo.`); continue; }
        try { u = (await resolveUrl(u0)).url; r = parseMapLink(u); }
        catch (e) { out.warnings.push(`No se pudo abrir ${u0}: ${e.message}`); continue; }
        if (r.needsResolve) { out.warnings.push(`No se pudo abrir ${u0}.`); continue; }
      }
      merge(out, r);
    }
    setBusy(false);
    finish(out);
  };

  const fromFiles = async files => {
    if (!files?.length) return;
    setBusy(true);
    const out = emptyImport();
    for (const f of files) {
      try {
        const r = await parseFile(f);
        if (r.links) { setText(r.links.join('\n')); setMode('links'); setBusy(false); return; }
        merge(out, r);
      } catch (e) { out.warnings.push(`${f.name}: ${e.message}`); }
    }
    setBusy(false);
    finish(out);
  };

  const geocodePending = async res => {
    stop.current = false;
    const list = [...res.pending];
    setGeo({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      if (stop.current) break;
      const p = list[i];
      const query = [p.name, p.address && !p.name.includes(p.address) ? p.address : ''].filter(Boolean).join(', ');
      let hit = null;
      try {
        const r = await geocode(query, { near: p.near || trip.center || undefined, limit: 1 });
        hit = r[0];
        if (!hit && p.address) hit = (await geocode(p.address, { limit: 1 }))[0];
        if (!hit && trip.destination && !query.includes(trip.destination)) hit = (await geocode(`${p.name}, ${trip.destination}`, { limit: 1 }))[0];
      } catch { /* sigue */ }
      setFound(f => {
        if (!f) return f;
        const pending = f.pending.map(x => x._id === p._id ? { ...x, _done: true, _hit: hit || null } : x);
        return { ...f, pending };
      });
      if (hit) setChecked(s => new Set([...s, p._id]));
      setGeo({ done: i + 1, total: list.length });
      await sleep(50);
    }
  };

  const toggle = id => setChecked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const add = () => {
    const places = [];
    const byOrder = new Map();
    for (const p of found.places) if (checked.has(p._id)) {
      const np = newPlace({ name: p.name, address: p.address || '', lat: p.lat, lng: p.lng, notes: p.notes || '', url: p.url || '', source: p.source, category: cat === 'auto' ? guessFromGroup(p.group) : cat });
      places.push(np);
      if (p.order != null) byOrder.set(p, np);
    }
    for (const p of found.pending) if (checked.has(p._id) && p._hit) {
      const np = newPlace({ name: p.name, address: p._hit.address || p.address || '', lat: p._hit.lat, lng: p._hit.lng, notes: p.notes || '', url: p.url || '', source: p.source, category: cat === 'auto' ? guessFromGroup(p.group) : cat });
      places.push(np);
      if (p.order != null) byOrder.set(p, np);
    }
    const routes = found.routes.filter(r => checked.has(r._id)).map((r, i) => newRoute({ name: r.name, points: r.points, color: r.color || ROUTE_COLORS[(trip.routes.length + i) % ROUTE_COLORS.length], source: r.source }));
    // Rutas de enlaces con paradas: línea entre paradas en orden.
    for (const o of found.orderedRoutes || []) {
      const stops = [...o.places, ...o.pending.map(p => found.pending.find(x => x.name === p.name && x.order === p.order) || p)]
        .sort((a, b) => a.order - b.order)
        .map(p => (p._hit ? { lat: p._hit.lat, lng: p._hit.lng, name: p.name } : p.lat != null ? { lat: p.lat, lng: p.lng, name: p.name } : null)).filter(Boolean);
      if (stops.length > 1) routes.push(newRoute({ name: o.name, points: stops.map(s => [s.lat, s.lng]), stops, straight: true, color: ROUTE_COLORS[(trip.routes.length + routes.length) % ROUTE_COLORS.length], source: o.source }));
    }
    if (!places.length && !routes.length) { toast('No hay nada marcado para añadir.', 'error'); return; }
    updateTrip(trip.id, t => { t.places.push(...places); t.routes.push(...routes); });
    const parts = [];
    if (places.length) parts.push(plural(places.length, 'lugar', 'lugares'));
    if (routes.length) parts.push(plural(routes.length, 'ruta', 'rutas'));
    toast(`Añadido: ${parts.join(' y ')}`, 'ok');
    close(true);
  };

  const n = found ? [...found.places, ...found.pending.filter(p => p._hit)].filter(p => checked.has(p._id)).length + found.routes.filter(r => checked.has(r._id)).length : 0;

  return html`<${Modal} title="Importar al mapa" close=${() => close(false)} size="lg" class="import-modal"
    footer=${found ? html`<${Btn} kind="ghost" onClick=${() => { stop.current = true; setFound(null); setGeo(null); }}>Atrás</${Btn}>
      <${Btn} kind="primary" icon="plus" onClick=${add} disabled=${!n}>${n ? `Añadir ${n} al viaje` : 'Nada seleccionado'}</${Btn}>` : null}>
    ${!found ? html`
      <${Segmented} value=${mode} onChange=${setMode} options=${[{ value: 'links', label: 'Enlaces', icon: 'link' }, { value: 'file', label: 'Archivo', icon: 'file' }, { value: 'help', label: 'Cómo exportar', icon: 'info' }]} />
      ${mode === 'links' && html`<div class="import-pane">
        <${Field} label="Pega uno o varios enlaces de Google Maps o Apple Maps" hint="Lugares, rutas con paradas o búsquedas. Uno por línea o todos juntos.">
          <textarea class="input" rows="7" value=${text} onInput=${e => setText(e.target.value)} placeholder=${'https://maps.app.goo.gl/…\nhttps://maps.apple.com/place?…\nhttps://www.google.com/maps/place/…'}></textarea></${Field}>
        <div class="btn-row"><${Btn} kind="primary" icon=${busy ? undefined : 'search'} onClick=${fromLinks} disabled=${busy || !text.trim()}>${busy ? html`<${Spinner} size=${16} /> Leyendo…` : 'Leer enlaces'}</${Btn}>
          ${navigator.clipboard?.readText && html`<${Btn} icon="copy" onClick=${async () => { try { const clip = await navigator.clipboard.readText(); setText(t => (t ? `${t}\n` : '') + clip); } catch { toast('No se pudo leer el portapapeles. Pega con Ctrl+V o manteniendo pulsado.', 'error'); } }}>Pegar</${Btn}>`}</div>
      </div>`}
      ${mode === 'file' && html`<${DropZone} onFiles=${fromFiles} class="import-pane import-drop">
        <${Icon} name="upload" size=${30} />
        <p><b>Arrastra aquí el archivo</b> o elígelo</p>
        <p class="muted small">KML o KMZ (Google My Maps, Google Earth) · GPX · GeoJSON o JSON (Google Takeout) · CSV (listas de Google Takeout)</p>
        <${Btn} kind="primary" icon=${busy ? undefined : 'file'} disabled=${busy} onClick=${async () => fromFiles(await pickFiles({ accept: '.kml,.kmz,.gpx,.json,.geojson,.csv,.txt' }))}>${busy ? html`<${Spinner} size=${16} /> Leyendo…` : 'Elegir archivo'}</${Btn}>
      </${DropZone}>`}
      ${mode === 'help' && html`<${Help} />`}
    ` : html`
      ${found.warnings.length > 0 && html`<ul class="warnings">${found.warnings.map(w => html`<li><${Icon} name="info" size=${15} /> ${w}</li>`)}</ul>`}
      ${(found.places.length + found.pending.length + found.routes.length) === 0 ? html`<p class="muted">No se ha encontrado nada que importar.</p>` : html`
        <div class="import-opts">
          <label class="field"><span class="field-label">Tipo para los lugares</span>
            <${Select} class="input input-sm" value=${cat} onChange=${e => setCat(e.target.value)}>
              <option value="auto">Automático (según la capa o lista)</option>
              ${Object.entries(PLACE_CATS).map(([k, v]) => html`<option value=${k}>${v.label}</option>`)}</${Select}></label>
          <div class="btn-row">
            <button type="button" class="link-btn small" onClick=${() => setChecked(new Set([...found.places.map(p => p._id), ...found.pending.filter(p => p._hit).map(p => p._id), ...found.routes.map(r => r._id)]))}>Marcar todo</button>
            <button type="button" class="link-btn small" onClick=${() => setChecked(new Set())}>Desmarcar todo</button>
          </div>
        </div>
        ${geo && geo.done < geo.total && html`<div class="geo-progress"><${Spinner} size=${16} /> Buscando ubicaciones ${geo.done} de ${geo.total}… <span class="muted small">(una por segundo, por las normas de OpenStreetMap)</span></div>`}
        <ul class="import-list">
          ${found.places.map(p => html`<li class=${cx(p._dup && 'is-dup')}><label>
            <input type="checkbox" checked=${checked.has(p._id)} onChange=${() => toggle(p._id)} />
            <span><b>${p.name}</b><small>${[p.group, p.address, p._dup ? 'ya está en el mapa' : ''].filter(Boolean).join(' · ')}</small></span></label></li>`)}
          ${found.pending.map(p => html`<li class=${cx(!p._done && 'is-wait', p._done && !p._hit && 'is-miss')}><label>
            <input type="checkbox" checked=${checked.has(p._id) && !!p._hit} disabled=${!p._hit} onChange=${() => toggle(p._id)} />
            <span><b>${p.name}</b><small>${!p._done ? 'Buscando…' : p._hit ? `Encontrado: ${p._hit.address || p._hit.name}` : 'No encontrado: añádelo a mano desde el buscador del mapa'}</small></span></label></li>`)}
          ${found.routes.map(r => html`<li><label><input type="checkbox" checked=${checked.has(r._id)} onChange=${() => toggle(r._id)} />
            <span><b><${Icon} name="route" size=${14} /> ${r.name}</b><small>Ruta · ${r.points.length} puntos</small></span></label></li>`)}
          ${(found.orderedRoutes || []).map(o => html`<li class="is-info"><span><${Icon} name="route" size=${14} /> Se añadirá la ruta «${o.name}» uniendo las paradas en orden.</span></li>`)}
        </ul>`}
    `}
  </${Modal}>`;
}

function guessFromGroup(g = '') {
  const s = g.toLowerCase();
  if (/comer|restaur|food|bar|caf|tapas|cena|desayuno|brunch/.test(s)) return 'food';
  if (/hotel|aloja|dormir|stay|airbnb/.test(s)) return 'stay';
  if (/compra|shop|tienda|mercad/.test(s)) return 'shop';
  if (/playa|parque|natur|monta|senderismo|hike|beach|park/.test(s)) return 'nature';
  if (/transp|estaci|aeropuerto|bus|tren|metro/.test(s)) return 'transport';
  return 'sight';
}
