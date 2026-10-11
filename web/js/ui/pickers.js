// Buscadores de lugares (OpenStreetMap) y de aeropuertos.
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { Icon, IconBtn, Spinner } from './kit.js';
import { geocode, searchAirports } from '../lib/geo.js';
import { cx } from '../lib/util.js';

export function PlaceSearch({ value, onChange, near, placeholder = 'Nombre o dirección', autoFocus }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);
  const [editing, setEditing] = useState(!value);
  const run = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try { setResults(await geocode(q, { near })); } finally { setBusy(false); }
  };
  if (value && !editing) {
    return html`<div class="place-value">
      <${Icon} name=${value.lat != null ? 'pin' : 'type'} size=${17} />
      <div class="place-value-text"><b>${value.name || value.address}</b>${value.address && value.address !== value.name && html`<small>${value.address}</small>`}
        ${value.lat == null && html`<small class="muted">Sin ubicación en el mapa</small>`}</div>
      <${IconBtn} icon="edit" label="Cambiar" onClick=${() => { setQ(value.name || ''); setEditing(true); setResults(null); }} />
      <${IconBtn} icon="x" label="Quitar" onClick=${() => { onChange(null); setQ(''); setEditing(true); }} />
    </div>`;
  }
  return html`<div class="place-search">
    <div class="search-row">
      <input class="input" value=${q} placeholder=${placeholder} autofocus=${autoFocus}
        onInput=${e => setQ(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); run(); } }} />
      <button type="button" class="btn btn-default" onClick=${run} disabled=${busy || !q.trim()}>${busy ? html`<${Spinner} size=${16} />` : html`<${Icon} name="search" size=${17} />`}<span>Buscar</span></button>
    </div>
    ${results && html`<ul class="results">
      ${results.map(r => html`<li><button type="button" onClick=${() => { onChange({ name: r.name, address: r.address, lat: r.lat, lng: r.lng, country: r.country, osmType: r.type, osmCat: r.category }); setEditing(false); setResults(null); }}>
        <${Icon} name="pin" size=${16} /><span><b>${r.name}</b><small>${r.address}</small></span></button></li>`)}
      ${!results.length && html`<li class="results-none">No se ha encontrado nada. Prueba con otra forma de escribirlo o añade la ciudad.</li>`}
      <li><button type="button" class="results-plain" onClick=${() => { onChange({ name: q.trim(), address: '', lat: null, lng: null }); setEditing(false); setResults(null); }}>
        <${Icon} name="type" size=${16} /><span>Guardar «${q.trim()}» sin ubicación</span></button></li>
    </ul>`}
    ${!results && value && html`<button type="button" class="link-btn" onClick=${() => setEditing(false)}>Cancelar</button>`}
  </div>`;
}

export function AirportPicker({ value, onChange, placeholder = 'Ciudad o código (MAD)' }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef();
  useEffect(() => {
    let alive = true;
    if (!q.trim()) { setList([]); return; }
    searchAirports(q).then(r => { if (alive) { setList(r); setHi(0); } });
    return () => { alive = false; };
  }, [q]);
  useEffect(() => {
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const pick = a => { onChange({ iata: a.iata, name: a.city || a.name, airport: a.name, lat: a.lat, lng: a.lng, country: a.country }); setQ(''); setOpen(false); };
  if (value) {
    return html`<div class="place-value airport-value">
      <span class="iata">${value.iata || '—'}</span>
      <div class="place-value-text"><b>${value.name}</b><small>${value.airport || ''}</small></div>
      <${IconBtn} icon="x" label="Cambiar aeropuerto" onClick=${() => onChange(null)} />
    </div>`;
  }
  return html`<div class="combo" ref=${ref}>
    <input class="input" value=${q} placeholder=${placeholder} onFocus=${() => setOpen(true)}
      onInput=${e => { setQ(e.target.value); setOpen(true); }}
      onKeyDown=${e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, list.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); if (list[hi]) pick(list[hi]); }
      }} />
    ${open && list.length > 0 && html`<ul class="combo-list">
      ${list.map((a, i) => html`<li><button type="button" class=${cx(i === hi && 'is-hi')} onMouseMove=${() => i !== hi && setHi(i)} onClick=${() => pick(a)}>
        <span class="iata">${a.iata}</span><span><b>${a.city || a.name}</b><small>${a.name} · ${a.country}</small></span></button></li>`)}
    </ul>`}
  </div>`;
}
