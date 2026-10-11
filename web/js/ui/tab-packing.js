// Pestaña Maleta: lista de cosas que llevar, con plantillas.
import { html, useState } from '../../vendor/preact-htm.js';
import { Btn, Icon, IconBtn, Empty, Modal, openModal, confirm, Progress, Menu, Select } from './kit.js';
import { PACKING_TEMPLATES } from '../lib/model.js';
import { updateTrip, toast, useStore } from '../lib/store.js';
import { sid, cx, norm } from '../lib/util.js';

function TemplatePicker({ close, trip }) {
  const [sel, setSel] = useState(new Set(trip.packing.length ? [] : ['Esencial', 'Ropa', 'Aseo']));
  const others = useStore(s => s.trips.filter(t => t.id !== trip.id && t.packing.length));
  const [fromTrip, setFromTrip] = useState('');
  const add = () => {
    const existing = new Set(trip.packing.map(p => norm(p.text)));
    const items = [];
    for (const name of sel) for (const text of PACKING_TEMPLATES[name]) {
      if (!existing.has(norm(text))) { existing.add(norm(text)); items.push({ id: sid(), text, done: false, group: name }); }
    }
    const src = others.find(t => t.id === fromTrip);
    if (src) for (const p of src.packing) {
      if (!existing.has(norm(p.text))) { existing.add(norm(p.text)); items.push({ id: sid(), text: p.text, done: false, group: p.group || 'General' }); }
    }
    updateTrip(trip.id, t => { t.packing.push(...items); });
    close(items.length);
  };
  return html`<${Modal} title="Añadir a la maleta" close=${() => close(0)} size="md"
    footer=${html`<${Btn} kind="ghost" onClick=${() => close(0)}>Cancelar</${Btn}><${Btn} kind="primary" onClick=${add} disabled=${!sel.size && !fromTrip}>Añadir</${Btn}>`}>
    <p class="muted">Elige listas ya hechas. No se repetirá nada que ya tengas.</p>
    <div class="template-grid">
      ${Object.entries(PACKING_TEMPLATES).map(([name, items]) => html`<label class=${cx('template', sel.has(name) && 'is-active')}>
        <input type="checkbox" checked=${sel.has(name)} onChange=${() => setSel(s => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; })} />
        <b>${name}</b><small>${items.slice(0, 4).join(', ')}…</small></label>`)}
    </div>
    ${others.length > 0 && html`<label class="field"><span class="field-label">O copia la maleta de otro viaje</span>
      <${Select} class="input" value=${fromTrip} onChange=${e => setFromTrip(e.target.value)}>
        <option value="">—</option>${others.map(t => html`<option value=${t.id}>${t.title || t.destination} (${t.packing.length})</option>`)}
      </${Select}></label>`}
  </${Modal}>`;
}

function Item({ trip, it }) {
  const [edit, setEdit] = useState(false);
  const [txt, setTxt] = useState(it.text);
  const commit = () => {
    setEdit(false);
    const v = txt.trim();
    if (!v) { updateTrip(trip.id, t => { t.packing = t.packing.filter(p => p.id !== it.id); }); return; }
    if (v !== it.text) updateTrip(trip.id, t => { const p = t.packing.find(p => p.id === it.id); if (p) p.text = v; });
  };
  return html`<li class=${cx('pack-item', it.done && 'is-done')}>
    <label class="check"><input type="checkbox" checked=${it.done} onChange=${() => updateTrip(trip.id, t => { const p = t.packing.find(p => p.id === it.id); if (p) p.done = !p.done; })} />
      <span class="check-box"><${Icon} name="check" size=${14} /></span></label>
    ${edit ? html`<input class="input input-inline" value=${txt} autofocus onInput=${e => setTxt(e.target.value)} onBlur=${commit} onKeyDown=${e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setTxt(it.text); setEdit(false); } }} />`
      : html`<span class="pack-text" onClick=${() => setEdit(true)}>${it.text}</span>`}
    <${IconBtn} icon="x" label="Quitar" class="pack-x" size=${16} onClick=${() => updateTrip(trip.id, t => { t.packing = t.packing.filter(p => p.id !== it.id); })} />
  </li>`;
}

function AddRow({ trip, group }) {
  const [txt, setTxt] = useState('');
  const add = () => {
    const parts = txt.split(/\n|;/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) return;
    updateTrip(trip.id, t => { for (const p of parts) t.packing.push({ id: sid(), text: p, done: false, group }); });
    setTxt('');
  };
  return html`<li class="pack-add"><${Icon} name="plus" size=${16} />
    <input class="input input-inline" placeholder="Añadir algo…" value=${txt} onInput=${e => setTxt(e.target.value)} onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur=${add} /></li>`;
}

export function PackingTab({ trip }) {
  const [hideDone, setHideDone] = useState(false);
  const [newGroup, setNewGroup] = useState('');
  const [manual, setManual] = useState(false);
  const [extra, setExtra] = useState([]); // grupos nuevos aún vacíos
  const groups = [];
  for (const p of trip.packing) { const g = p.group || 'General'; if (!groups.includes(g)) groups.push(g); }
  if (!groups.length && manual && !extra.length) groups.push('General');
  for (const g of extra) if (!groups.includes(g)) groups.push(g);
  const done = trip.packing.filter(p => p.done).length;
  const total = trip.packing.length;

  if (!total && !manual) return html`<div class="page-pad"><${Empty} icon="suitcase" title="Prepara la maleta"
    text="Empieza con listas ya hechas (lo esencial, ropa, aseo, playa, frío…) y añade lo que quieras. Ve marcando lo que ya está dentro.">
    <${Btn} kind="primary" icon="sparkle" onClick=${() => openModal(TemplatePicker, { trip })}>Empezar con una lista</${Btn}>
    <${Btn} icon="plus" onClick=${() => setManual(true)}>Hacerla a mano</${Btn}>
  </${Empty}></div>`;

  return html`<div class="page-pad packing">
    <div class="pack-summary card">
      <div class="pack-count">${total ? html`<b>${done}</b> de ${total} cosas en la maleta${done === total ? ' · ¡Lista!' : ''}` : 'Escribe abajo lo que quieras llevar y pulsa Intro.'}</div>
      <${Progress} value=${done} max=${total} label="Maleta" />
      <div class="toolbar">
        <label class="small muted check-inline"><input type="checkbox" checked=${hideDone} onChange=${e => setHideDone(e.target.checked)} /> Ocultar lo ya guardado</label>
        <div class="toolbar-right">
          <${Btn} icon="sparkle" size="sm" onClick=${async () => { const n = await openModal(TemplatePicker, { trip }); if (n) toast(`${n} cosas añadidas`, 'ok'); }}>Añadir listas</${Btn}>
          <${Menu} items=${[
            { icon: 'undo', label: 'Desmarcar todo (para la vuelta)', onClick: () => updateTrip(trip.id, t => { t.packing.forEach(p => { p.done = false; }); }) },
            { icon: 'check', label: 'Marcar todo', onClick: () => updateTrip(trip.id, t => { t.packing.forEach(p => { p.done = true; }); }) },
            '-',
            { icon: 'trash', label: 'Vaciar la lista', danger: true, onClick: async () => { if (await confirm('¿Vaciar la maleta?', 'Se borrarán todos los elementos de la lista.', { okLabel: 'Vaciar', danger: true })) updateTrip(trip.id, t => { t.packing = []; }); } },
          ]} />
        </div>
      </div>
    </div>
    <div class="pack-groups">
      ${groups.map(g => {
        const items = trip.packing.filter(p => (p.group || 'General') === g);
        const gd = items.filter(p => p.done).length;
        return html`<section class="pack-group card">
          <header><h3>${g}</h3><span class="muted small">${gd}/${items.length}</span></header>
          <ul>
            ${items.filter(p => !hideDone || !p.done).map(it => html`<${Item} key=${it.id} trip=${trip} it=${it} />`)}
            <${AddRow} trip=${trip} group=${g} />
          </ul>
        </section>`;
      })}
      <section class="pack-group card pack-newgroup">
        <form onSubmit=${e => { e.preventDefault(); const g = newGroup.trim(); if (g && !groups.includes(g)) { setExtra(x => [...x, g]); setNewGroup(''); } }}>
          <input class="input input-inline" placeholder="+ Nuevo grupo (Ej.: Para los nietos)" value=${newGroup} onInput=${e => setNewGroup(e.target.value)} />
        </form>
      </section>
    </div>
  </div>`;
}
