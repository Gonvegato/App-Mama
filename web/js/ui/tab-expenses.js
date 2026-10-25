// Pestaña Gastos: presupuesto, gastos del viaje y reservas pagadas.
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { Btn, Icon, Empty, Modal, Field, openModal, confirm, Progress, Select, Toggle, pickFiles, Spinner } from './kit.js';
import { EXPENSE_CATS, RES_KINDS, resTitle } from '../lib/model.js';
import { updateTrip, toast, uploadFile, removeFiles, saveSettings, useStore } from '../lib/store.js';
import { openReservation } from './tab-bookings.js';
import { openDoc } from './tab-docs.js';
import { resizeImage } from '../lib/image.js';
import { categorize } from '../lib/receipt-parse.js';
import { CURRENCIES, fmtMoney, parseAmount, fmtDate, todayISO, sid, dateOnly, norm } from '../lib/util.js';

const RES_TO_CAT = { flight: 'transporte', train: 'transporte', bus: 'transporte', ferry: 'transporte', car: 'transporte', hotel: 'alojamiento', restaurant: 'comida', activity: 'ocio', other: 'otros' };

// Qué se ve mientras se lee el ticket (el lector se descarga la primera vez, unos 8 MB).
const scanLabel = p => (!p ? 'Preparando la foto…'
  : /loading|initializ/i.test(p.status) ? 'Preparando el lector (la primera vez tarda un poco)…'
  : /recogniz/i.test(p.status) ? `Leyendo el ticket… ${Math.round((p.progress || 0) * 100)} %` : 'Leyendo el ticket…');

function ExpenseForm({ close, trip, exp, initialFile }) {
  const today = todayISO();
  const defDate = trip.startDate && today >= trip.startDate && today <= (trip.endDate || trip.startDate) ? today : (trip.startDate || today);
  const memory = useStore(s => s.settings.merchantCats) || {};
  const [e, setE] = useState(() => exp ? { ...exp, amountTxt: String(exp.amount).replace('.', ',') } : { id: sid(), text: '', amountTxt: '', currency: trip.budget?.currency || 'EUR', category: 'comida', date: defDate, paidBy: trip.travelers[0] || '', split: true });
  const set = p => setE(s => ({ ...s, ...p }));
  const [catTouched, setCatTouched] = useState(!!exp);     // si ya eligió categoría, no se la cambia sola
  const [receipt, setReceipt] = useState(null);            // foto del ticket nueva, aún sin guardar
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [scanning, setScanning] = useState(null);          // null | { status, progress }
  const [guess, setGuess] = useState({});                  // campos leídos con poca seguridad: hay que revisarlos
  const [readText, setReadText] = useState('');
  const [saving, setSaving] = useState(false);
  const oldDoc = !removeReceipt && exp?.receiptDocId ? trip.docs.find(d => d.id === exp.receiptDocId) : null;
  const thumb = useRef(null);
  if (receipt && !thumb.current) thumb.current = URL.createObjectURL(receipt);
  useEffect(() => () => { if (thumb.current) URL.revokeObjectURL(thumb.current); }, []);

  // Lee el ticket con el OCR y rellena el formulario. No guarda nada: la persona revisa y confirma.
  const readFile = async file => {
    setScanning({ status: '', progress: 0 });
    try {
      const { scanReceipt } = await import('../lib/receipt.js');
      const r = await scanReceipt(file, { trip, memory, onProgress: p => setScanning(p) });
      const patch = {}, g = {};
      if (r.amount.value) { patch.amountTxt = String(r.amount.value).replace('.', ','); g.amount = r.amount.conf !== 'alta'; } else g.amount = true;
      if (r.currency.value && CURRENCIES.includes(r.currency.value)) { patch.currency = r.currency.value; g.currency = !!r.currency.assumed; }
      if (r.date.value) { patch.date = r.date.value; g.date = r.date.conf !== 'alta'; } else g.date = true;
      if (r.merchant.value) { patch.text = r.merchant.value; g.text = true; }
      if (r.category.value) { patch.category = r.category.value; g.category = true; setCatTouched(false); }
      set(patch); setGuess(g); setReadText(r.text);
      if (thumb.current) URL.revokeObjectURL(thumb.current);
      thumb.current = null; setReceipt(file); setRemoveReceipt(false);
      toast(r.amount.value ? 'He leído el ticket. Revisa lo marcado antes de guardar.' : 'No he podido leer el importe. Escríbelo a mano; la foto se guardará igualmente.', r.amount.value ? 'ok' : 'info', { ms: 6000 });
    } catch (err) { toast(`No se pudo leer el ticket: ${err.message}`, 'error'); }
    setScanning(null);
  };
  const pick = async camera => {
    const [f] = await pickFiles({ accept: 'image/*', multiple: false, capture: camera ? 'environment' : undefined });
    if (f) readFile(f);
  };
  useEffect(() => { if (initialFile) readFile(initialFile); }, []);

  const save = async () => {
    if (saving) return;
    const amount = parseAmount(e.amountTxt);
    if (!amount) { toast('Escribe el importe.', 'error'); return; }
    const { amountTxt: _txt, ...rest } = e;
    const out = { ...rest, amount, text: e.text.trim() || EXPENSE_CATS[e.category].label };
    let newDoc = null;
    setSaving(true);
    try {
      if (receipt) {
        // La foto del ticket queda como justificante en Documentos del viaje.
        const f = await resizeImage(receipt, 2000);
        const up = await uploadFile(trip.id, 'docs', f, `ticket-${out.date || todayISO()}.jpg`);
        newDoc = { id: sid(), name: `Ticket · ${out.text}`.slice(0, 80), file: receipt.name || 'ticket.jpg', kind: 'recibo', path: up.path, mime: up.mime, size: up.size, addedAt: new Date().toISOString(), fromExpense: out.id };
        out.receiptDocId = newDoc.id;
      } else if (removeReceipt) delete out.receiptDocId;
    } catch (err) { toast(`No se pudo guardar la foto del ticket: ${err.message}`, 'error'); setSaving(false); return; }
    const dropDoc = (receipt || removeReceipt) && exp?.receiptDocId ? trip.docs.find(d => d.id === exp.receiptDocId) : null;
    updateTrip(trip.id, t => {
      const i = t.expenses.findIndex(x => x.id === out.id);
      if (i >= 0) t.expenses[i] = out; else t.expenses.push(out);
      if (newDoc) t.docs.push(newDoc);
      if (dropDoc) t.docs = t.docs.filter(d => d.id !== dropDoc.id);
    });
    if (dropDoc?.path) removeFiles([dropDoc.path]);
    // Recuerda qué categoría se eligió para este comercio, para la próxima vez.
    const key = norm(out.text);
    if (key && out.text !== EXPENSE_CATS[out.category]?.label && memory[key] !== out.category) {
      const entries = Object.entries({ ...memory, [key]: out.category });
      saveSettings({ merchantCats: Object.fromEntries(entries.slice(-300)) });
    }
    close(out);
  };

  const flag = k => (guess[k] ? 'is-guess' : '');
  const anyGuess = Object.values(guess).some(Boolean);
  return html`<${Modal} title=${exp ? 'Editar gasto' : 'Nuevo gasto'} close=${() => close(null)} size="sm" onSubmit=${save}
    footer=${html`${exp && html`<${Btn} kind="ghost" icon="trash" onClick=${async () => {
        const d = trip.docs.find(x => x.id === exp.receiptDocId);
        if (await confirm('¿Borrar este gasto?', d ? 'También se borrará la foto del ticket.' : '', { okLabel: 'Borrar', danger: true })) {
          updateTrip(trip.id, t => { t.expenses = t.expenses.filter(x => x.id !== exp.id); if (d) t.docs = t.docs.filter(x => x.id !== d.id); });
          if (d?.path) removeFiles([d.path]);
          close(null);
        } }}>Borrar</${Btn}>`}
      <${Btn} kind="primary" type="submit" disabled=${saving || !!scanning}>${saving ? 'Guardando…' : 'Guardar'}</${Btn}>`}>
    <div class="form-grid">
      <div class="scan-box">
        ${scanning ? html`<div class="scan-busy"><${Spinner} size=${18} /><span>${scanLabel(scanning)}</span></div>`
          : html`<div class="btn-row">
              <${Btn} icon="camera" onClick=${() => pick(true)}>Escanear ticket</${Btn}>
              <${Btn} kind="ghost" icon="image" onClick=${() => pick(false)}>Elegir foto</${Btn}>
            </div>`}
        ${(receipt || oldDoc) && !scanning && html`<div class="scan-attached">
          ${thumb.current && html`<img src=${thumb.current} alt="Ticket" />`}
          <span class="small">${receipt ? 'Ticket para guardar con el gasto' : 'Este gasto tiene su ticket guardado'}</span>
          ${oldDoc && !receipt && html`<button type="button" class="link-btn small" onClick=${() => openDoc(trip, oldDoc)}>Ver</button>`}
          <button type="button" class="link-btn small" onClick=${() => { if (receipt) { if (thumb.current) URL.revokeObjectURL(thumb.current); setReceipt(null); thumb.current = null; setGuess({}); } else setRemoveReceipt(true); }}>Quitar</button>
        </div>`}
        ${anyGuess && html`<p class="notice notice-warn scan-note"><${Icon} name="info" size=${16} /> <span>Lo marcado en ámbar lo he leído con poca seguridad: compruébalo con el ticket.</span></p>`}
        ${readText && html`<details class="scan-text"><summary class="small muted">Ver el texto que he leído</summary><pre>${readText}</pre></details>`}
      </div>
      <${Field} label="Importe" class=${flag('amount')}><div class="money-input">
        <input class="input input-lg" inputmode="decimal" value=${e.amountTxt} onInput=${ev => { set({ amountTxt: ev.target.value }); setGuess(g => ({ ...g, amount: false })); }} placeholder="0,00" autofocus=${!initialFile} />
        <${Select} class="input" value=${e.currency} onChange=${ev => set({ currency: ev.target.value })} aria-label="Moneda">${CURRENCIES.map(c => html`<option value=${c}>${c}</option>`)}</${Select}></div></${Field}>
      <${Field} label="Concepto" class=${flag('text')}><input class="input" value=${e.text} onInput=${ev => {
          const text = ev.target.value;
          set({ text }); setGuess(g => ({ ...g, text: false }));
          // Mientras escribe el comercio, se sugiere la categoría (si aún no ha elegido una).
          if (!catTouched) { const c = categorize(text, '', memory).value; if (c) set({ category: c }); }
        }} placeholder="Ej.: Cena en el puerto" /></${Field}>
      <div class=${`field ${flag('category')}`}><span class="field-label">Categoría</span>
        <div class="cat-pick">${Object.entries(EXPENSE_CATS).map(([k, v]) => html`<button type="button" class=${`cat-btn ${e.category === k ? 'is-active' : ''}`} onClick=${() => { set({ category: k }); setCatTouched(true); setGuess(g => ({ ...g, category: false })); }}><${Icon} name=${v.icon} size=${18} /><span>${v.label}</span></button>`)}</div></div>
      <div class="field-row">
        <${Field} label="Fecha" class=${flag('date')}><input class="input" type="date" value=${e.date} onInput=${ev => { set({ date: ev.target.value }); setGuess(g => ({ ...g, date: false })); }} /></${Field}>
        ${trip.travelers.length > 1 && html`<${Field} label="Pagó"><${Select} class="input" value=${e.paidBy} onChange=${ev => set({ paidBy: ev.target.value })}>${trip.travelers.map(p => html`<option value=${p}>${p}</option>`)}</${Select}></${Field}>`}
      </div>
      ${trip.travelers.length > 1 && html`<div class="field"><${Toggle} checked=${e.split !== false} onChange=${v => set({ split: v })} label="Repartir entre los viajeros" />
        <small class="muted">${e.split !== false ? 'Entra en las cuentas: se divide a partes iguales.' : 'Gasto personal: no entra en las cuentas entre viajeros.'}</small></div>`}
    </div>
  </${Modal}>`;
}

function BudgetForm({ close, trip }) {
  const [amt, setAmt] = useState(trip.budget?.amount ? String(trip.budget.amount).replace('.', ',') : '');
  const [cur, setCur] = useState(trip.budget?.currency || 'EUR');
  return html`<${Modal} title="Presupuesto del viaje" close=${() => close()} size="sm" onSubmit=${() => { updateTrip(trip.id, t => { t.budget = { amount: parseAmount(amt), currency: cur }; }); close(); }}
    footer=${html`<${Btn} kind="primary" type="submit">Guardar</${Btn}>`}>
    <${Field} label="¿Cuánto quieres gastar como mucho?" hint="Es la moneda principal del viaje: los gastos nuevos la usarán por defecto.">
      <div class="money-input"><input class="input input-lg" inputmode="decimal" value=${amt} onInput=${e => setAmt(e.target.value)} placeholder="0" autofocus />
      <${Select} class="input" value=${cur} onChange=${e => setCur(e.target.value)}>${CURRENCIES.map(c => html`<option value=${c}>${c}</option>`)}</${Select}></div></${Field}>
  </${Modal}>`;
}

export function ExpensesTab({ trip }) {
  const cur = trip.budget?.currency || 'EUR';
  const fromRes = trip.reservations.filter(r => r.price?.amount).map(r => ({ id: `r-${r.id}`, res: r, text: resTitle(r), amount: r.price.amount, currency: r.price.currency, category: RES_TO_CAT[r.kind], date: dateOnly(r.start) || '' }));
  const all = [...trip.expenses, ...fromRes];
  const totals = {};
  for (const e of all) totals[e.currency] = (totals[e.currency] || 0) + e.amount;
  const spent = totals[cur] || 0;
  const others = Object.entries(totals).filter(([c]) => c !== cur);
  const byCat = {};
  for (const e of all.filter(x => x.currency === cur)) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  const maxCat = Math.max(1, ...Object.values(byCat));
  const groups = new Map();
  for (const e of [...all].sort((a, b) => (b.date || '').localeCompare(a.date || ''))) {
    const k = e.date || 'sin-fecha';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  // Cuentas entre viajeros (solo moneda principal y gastos con «pagó»).
  const people = trip.travelers;
  const paid = Object.fromEntries(people.map(p => [p, 0]));
  for (const e of trip.expenses) if (e.currency === cur && e.paidBy in paid && e.split !== false) paid[e.paidBy] += e.amount;
  const shared = Object.values(paid).reduce((a, b) => a + b, 0);
  const share = people.length ? shared / people.length : 0;

  const add = () => openModal(ExpenseForm, { trip });
  // El botón de la pestaña abre ya la cámara (en el mismo toque, que es lo que piden los móviles)
  // y el formulario se abre leyendo el ticket.
  const scan = async () => {
    const [f] = await pickFiles({ accept: 'image/*', multiple: false, capture: 'environment' });
    if (f) openModal(ExpenseForm, { trip, initialFile: f });
  };

  return html`<div class="page-pad expenses">
    <div class="exp-top">
      <div class="card exp-budget">
        <span class="eyebrow">Gastado</span>
        <div class="exp-big">${fmtMoney(spent, cur)}</div>
        ${trip.budget?.amount ? html`
          <${Progress} value=${spent} max=${trip.budget.amount} label="Presupuesto" />
          <p class="muted small">${spent <= trip.budget.amount ? `Quedan ${fmtMoney(trip.budget.amount - spent, cur)} de ${fmtMoney(trip.budget.amount, cur)}` : `Te has pasado ${fmtMoney(spent - trip.budget.amount, cur)} del presupuesto (${fmtMoney(trip.budget.amount, cur)})`}</p>`
          : html`<p class="muted small">Sin presupuesto definido.</p>`}
        ${others.length > 0 && html`<p class="small">Además: ${others.map(([c, v]) => fmtMoney(v, c)).join(' · ')} <span class="muted">(otras monedas, no se convierten)</span></p>`}
        <div class="btn-row"><${Btn} kind="primary" icon="plus" onClick=${add}>Añadir gasto</${Btn}><${Btn} icon="camera" onClick=${scan}>Escanear ticket</${Btn}><${Btn} size="sm" icon="sliders" onClick=${() => openModal(BudgetForm, { trip })}>Presupuesto</${Btn}></div>
      </div>
      ${Object.keys(byCat).length > 0 && html`<div class="card exp-cats">
        <span class="eyebrow">Por categorías</span>
        ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => html`<div class="bar-row">
          <span class="bar-label"><${Icon} name=${EXPENSE_CATS[k]?.icon || 'wallet'} size=${15} />${EXPENSE_CATS[k]?.label || k}</span>
          <span class="bar"><span style=${`width:${(v / maxCat) * 100}%`}></span></span>
          <span class="bar-val">${fmtMoney(v, cur)}</span></div>`)}
      </div>`}
      ${people.length > 1 && shared > 0 && html`<div class="card exp-split">
        <span class="eyebrow">Cuentas entre viajeros</span>
        ${people.map(p => {
          const diff = paid[p] - share;
          return html`<div class="split-row"><b>${p}</b><span>pagó ${fmtMoney(paid[p], cur)}</span>
            <span class=${diff >= 0 ? 'pos' : 'neg'}>${Math.abs(diff) < 0.01 ? 'en paz' : diff > 0 ? `le deben ${fmtMoney(diff, cur)}` : `debe ${fmtMoney(-diff, cur)}`}</span></div>`;
        })}
        <p class="muted small">Reparto a partes iguales de los gastos marcados para repartir. Los gastos personales y las reservas no cuentan aquí.</p>
      </div>`}
    </div>
    ${!all.length ? html`<${Empty} icon="wallet" title="Sin gastos todavía" text="Apunta lo que vas gastando y compáralo con tu presupuesto. Los precios de las reservas se suman solos." />`
      : [...groups.entries()].map(([d, list]) => html`<section class="day-block">
        <h3 class="day-title">${d === 'sin-fecha' ? 'Sin fecha' : fmtDate(d, 'daylong')}<span class="muted small">${fmtMoney(list.filter(x => x.currency === cur).reduce((a, x) => a + x.amount, 0), cur)}</span></h3>
        <ul class="exp-list">${list.map(e => html`<li><button type="button" class="exp-row" onClick=${() => e.res ? openReservation(trip, e.res) : openModal(ExpenseForm, { trip, exp: e })}>
          <span class="exp-ico"><${Icon} name=${e.res ? RES_KINDS[e.res.kind].icon : EXPENSE_CATS[e.category]?.icon || 'wallet'} size=${17} /></span>
          <span class="exp-text"><b>${e.text}</b><small>${e.res ? 'Reserva' : EXPENSE_CATS[e.category]?.label}${e.receiptDocId && trip.docs.some(d => d.id === e.receiptDocId) ? ' · con ticket' : ''}${e.source === 'notificacion' ? ' · aviso de pago' : ''}${e.paidBy && people.length > 1 ? ` · pagó ${e.paidBy}${e.split === false ? ' · personal' : ''}` : ''}</small></span>
          <span class="exp-amt">${fmtMoney(e.amount, e.currency)}</span></button></li>`)}</ul>
      </section>`)}
  </div>`;
}
