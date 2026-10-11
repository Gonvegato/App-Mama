// Versión imprimible del viaje (o «Guardar como PDF» desde el diálogo de impresión).
import { buildAgenda, RES_KINDS, PLACE_CATS, resTitle } from '../lib/model.js';
import { fmtRange, fmtDate, fmtDateTime, fmtMoney, todayISO } from '../lib/util.js';

const e = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function tripHtml(trip) {
  const { days } = buildAgenda(trip);
  const res = [...trip.reservations].sort((a, b) => (a.start || '9').localeCompare(b.start || '9'));
  const groups = [...new Set(trip.packing.map(p => p.group || 'General'))];
  const row = it => {
    if (it.type === 'res') {
      const r = it.res;
      const ph = r.kind === 'hotel' ? ({ start: 'Entrada · ', end: 'Salida · ', during: 'Noche en ' }[it.phase] || '') : it.phase === 'arrive' ? 'Llegada · ' : '';
      return `<li><span class="t">${e(it.time)}</span><span>${ph}<b>${e(resTitle(r))}</b>${r.code && it.phase !== 'during' ? ` <span class="code">${e(r.code)}</span>` : ''}</span></li>`;
    }
    if (it.type === 'place') return `<li><span class="t">${e(it.time)}</span><span>${e(it.place.name)}${it.place.address ? ` <small>${e(it.place.address)}</small>` : ''}</span></li>`;
    return `<li><span class="t">${e(it.time)}</span><span>${e(it.item.text)}</span></li>`;
  };
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${e(trip.title || trip.destination)}</title>
<style>
  @page { margin: 16mm 14mm; }
  body { font-family: 'Newsreader Variable', Georgia, 'Times New Roman', serif; color: #1d1b18; font-size: 11.5pt; line-height: 1.45; }
  h1 { font-size: 26pt; font-weight: 500; margin: 0 0 2pt; letter-spacing: -0.01em; }
  h2 { font-size: 14pt; font-weight: 600; border-bottom: 1px solid #ccc; padding-bottom: 3pt; margin: 18pt 0 8pt; break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 10pt 0 3pt; break-after: avoid; }
  .sub { color: #555; margin: 0 0 4pt; }
  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; vertical-align: top; padding: 4pt 6pt 4pt 0; border-bottom: 1px solid #e6e6e6; }
  th { font-size: 9pt; text-transform: uppercase; letter-spacing: .06em; color: #666; font-weight: 600; }
  .code { font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 700; letter-spacing: .05em; background: #f1efe9; padding: 0 4px; border-radius: 3px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { display: flex; gap: 10pt; padding: 2pt 0; }
  .t { width: 34pt; flex: none; color: #666; font-variant-numeric: tabular-nums; }
  small { color: #666; }
  .day { break-inside: avoid; }
  .cols { columns: 2; column-gap: 20pt; }
  .box { display:inline-block; width: 9pt; height: 9pt; border: 1px solid #555; margin-right: 6pt; vertical-align: -1pt; }
  .done { text-decoration: line-through; color: #888; }
  .notes { white-space: pre-wrap; }
  footer { margin-top: 24pt; color: #999; font-size: 9pt; }
</style></head><body>
<h1>${e(trip.title || trip.destination)}</h1>
<p class="sub">${e([trip.destination !== trip.title ? trip.destination : '', trip.startDate ? fmtRange(trip.startDate, trip.endDate) : '', trip.travelers.join(', ')].filter(Boolean).join(' · '))}</p>
${res.length ? `<h2>Reservas</h2><table><thead><tr><th>Qué</th><th>Cuándo</th><th>Código</th><th>Detalles</th></tr></thead><tbody>
${res.map(r => `<tr><td><b>${e(resTitle(r))}</b><br><small>${e(RES_KINDS[r.kind].label)}${r.provider ? ` · ${e(r.provider)}` : ''}${r.number ? ` ${e(r.number)}` : ''}</small></td>
<td>${e(fmtDateTime(r.start))}${r.end ? `<br><small>hasta ${e(fmtDateTime(r.end))}</small>` : ''}</td>
<td>${r.code ? `<span class="code">${e(r.code)}</span>` : ''}</td>
<td><small>${e([r.location?.address, r.seat && `Asiento: ${r.seat}`, r.terminal && `Terminal: ${r.terminal}`, r.phone && `Tel.: ${r.phone}`, r.price?.amount && fmtMoney(r.price.amount, r.price.currency), r.notes].filter(Boolean).join(' · '))}</small></td></tr>`).join('')}
</tbody></table>` : ''}
${days.some(d => d.items.length) ? `<h2>Itinerario</h2>${days.map((d, i) => `<div class="day"><h3>Día ${i + 1} · ${e(fmtDate(d.day, 'daylong'))}</h3>${d.items.length ? `<ul>${d.items.map(row).join('')}</ul>` : '<p class="sub">Día libre</p>'}</div>`).join('')}` : ''}
${trip.places.length ? `<h2>Lugares</h2><div class="cols"><ul>${trip.places.map(p => `<li><span>${p.visited ? '✓ ' : ''}<b>${e(p.name)}</b> <small>${e(PLACE_CATS[p.category]?.label || '')}${p.address ? ` · ${e(p.address)}` : ''}</small></span></li>`).join('')}</ul></div>` : ''}
${trip.packing.length ? `<h2>Maleta</h2><div class="cols">${groups.map(g => `<h3>${e(g)}</h3><ul>${trip.packing.filter(p => (p.group || 'General') === g).map(p => `<li><span class="${p.done ? 'done' : ''}"><span class="box"></span>${e(p.text)}</span></li>`).join('')}</ul>`).join('')}</div>` : ''}
${trip.notes ? `<h2>Notas</h2><p class="notes">${e(trip.notes)}</p>` : ''}
<footer>Cuaderno de viajes · impreso el ${e(fmtDate(todayISO()))}</footer>
</body></html>`;
}

export function printTrip(trip) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open(); doc.write(tripHtml(trip)); doc.close();
  setTimeout(() => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => iframe.remove(), 2000);
  }, 300);
}
