// Pestaña Gastos: presupuesto, gastos del viaje y reservas pagadas.
import { html, useState } from '../../vendor/preact-htm.js';
import { Btn, Icon, IconBtn, Empty, Modal, Field, openModal, confirm, Progress, Select } from './kit.js';
import { EXPENSE_CATS, RES_KINDS, resTitle } from '../lib/model.js';
import { updateTrip, toast } from '../lib/store.js';
import { openReservation } from './tab-bookings.js';
import { CURRENCIES, fmtMoney, parseAmount, fmtDate, todayISO, sid, dateOnly } from '../lib/util.js';

const RES_TO_CAT = { flight: 'transporte', train: 'transporte', bus: 'transporte', ferry: 'transporte', car: 'transporte', hotel: 'alojamiento', restaurant: 'comida', activity: 'ocio', other: 'otros' };

function ExpenseForm({ close, trip, exp }) {
  const today = todayISO();
  const defDate = trip.startDate && today >= trip.startDate && today <= (trip.endDate || trip.startDate) ? today : (trip.startDate || today);
  const [e, setE] = useState(() => exp ? { ...exp, amountTxt: String(exp.amount).replace('.', ',') } : { id: sid(), text: '', amountTxt: '', currency: trip.budget?.currency || 'EUR', category: 'comida', date: defDate, paidBy: trip.travelers[0] || '' });
  const set = p => setE(s => ({ ...s, ...p }));
  const save = () => {
    const amount = parseAmount(e.amountTxt);
    if (!amount) { toast('Escribe el importe.', 'error'); return; }
    const { amountTxt, ...rest } = e;
    const out = { ...rest, amount, text: e.text.trim() || EXPENSE_CATS[e.category].label };
    updateTrip(trip.id, t => { const i = t.expenses.findIndex(x => x.id === out.id); if (i >= 0) t.expenses[i] = out; else t.expenses.push(out); });
    close(out);
  };
  return html`<${Modal} title=${exp ? 'Editar gasto' : 'Nuevo gasto'} close=${() => close(null)} size="sm" onSubmit=${save}
    footer=${html`${exp && html`<${Btn} kind="ghost" icon="trash" onClick=${async () => { if (await confirm('¿Borrar este gasto?', '', { okLabel: 'Borrar', danger: true })) { updateTrip(trip.id, t => { t.expenses = t.expenses.filter(x => x.id !== exp.id); }); close(null); } }}>Borrar</${Btn}>`}
      <${Btn} kind="primary" type="submit">Guardar</${Btn}>`}>
    <div class="form-grid">
      <${Field} label="Importe"><div class="money-input">
        <input class="input input-lg" inputmode="decimal" value=${e.amountTxt} onInput=${ev => set({ amountTxt: ev.target.value })} placeholder="0,00" autofocus />
        <${Select} class="input" value=${e.currency} onChange=${ev => set({ currency: ev.target.value })} aria-label="Moneda">${CURRENCIES.map(c => html`<option>${c}</option>`)}</${Select}></div></${Field}>
      <${Field} label="Concepto"><input class="input" value=${e.text} onInput=${ev => set({ text: ev.target.value })} placeholder="Ej.: Cena en el puerto" /></${Field}>
      <div class="field"><span class="field-label">Categoría</span>
        <div class="cat-pick">${Object.entries(EXPENSE_CATS).map(([k, v]) => html`<button type="button" class=${`cat-btn ${e.category === k ? 'is-active' : ''}`} onClick=${() => set({ category: k })}><${Icon} name=${v.icon} size=${18} /><span>${v.label}</span></button>`)}</div></div>
      <div class="field-row">
        <${Field} label="Fecha"><input class="input" type="date" value=${e.date} onInput=${ev => set({ date: ev.target.value })} /></${Field}>
        ${trip.travelers.length > 1 && html`<${Field} label="Pagó"><${Select} class="input" value=${e.paidBy} onChange=${ev => set({ paidBy: ev.target.value })}>${trip.travelers.map(p => html`<option>${p}</option>`)}</${Select}></${Field}>`}
      </div>
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
      <${Select} class="input" value=${cur} onChange=${e => setCur(e.target.value)}>${CURRENCIES.map(c => html`<option>${c}</option>`)}</${Select}></div></${Field}>
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
  for (const e of trip.expenses) if (e.currency === cur && e.paidBy in paid) paid[e.paidBy] += e.amount;
  const shared = Object.values(paid).reduce((a, b) => a + b, 0);
  const share = people.length ? shared / people.length : 0;

  const add = () => openModal(ExpenseForm, { trip });

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
        <div class="btn-row"><${Btn} kind="primary" icon="plus" onClick=${add}>Añadir gasto</${Btn}><${Btn} size="sm" icon="sliders" onClick=${() => openModal(BudgetForm, { trip })}>Presupuesto</${Btn}></div>
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
        <p class="muted small">Reparto a partes iguales de los gastos con «Pagó». Las reservas no cuentan aquí.</p>
      </div>`}
    </div>
    ${!all.length ? html`<${Empty} icon="wallet" title="Sin gastos todavía" text="Apunta lo que vas gastando y compáralo con tu presupuesto. Los precios de las reservas se suman solos." />`
      : [...groups.entries()].map(([d, list]) => html`<section class="day-block">
        <h3 class="day-title">${d === 'sin-fecha' ? 'Sin fecha' : fmtDate(d, 'daylong')}<span class="muted small">${fmtMoney(list.filter(x => x.currency === cur).reduce((a, x) => a + x.amount, 0), cur)}</span></h3>
        <ul class="exp-list">${list.map(e => html`<li><button type="button" class="exp-row" onClick=${() => e.res ? openReservation(trip, e.res) : openModal(ExpenseForm, { trip, exp: e })}>
          <span class="exp-ico"><${Icon} name=${e.res ? RES_KINDS[e.res.kind].icon : EXPENSE_CATS[e.category]?.icon || 'wallet'} size=${17} /></span>
          <span class="exp-text"><b>${e.text}</b><small>${e.res ? 'Reserva' : EXPENSE_CATS[e.category]?.label}${e.paidBy && people.length > 1 ? ` · pagó ${e.paidBy}` : ''}</small></span>
          <span class="exp-amt">${fmtMoney(e.amount, e.currency)}</span></button></li>`)}</ul>
      </section>`)}
  </div>`;
}
