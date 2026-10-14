// Exportar al calendario (.ics) y compartir un resumen en texto.
import { RES_KINDS, resTitle, buildAgenda, isTransport } from './model.js';
import { fmtRange, fmtDate, dateOnly, timeOnly, addDays, eachDay } from './util.js';

const icsEscape = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const icsDate = d => d.replace(/-/g, '');
const icsDateTime = s => `${icsDate(dateOnly(s))}T${timeOnly(s).replace(':', '')}00`;

// Las horas se guardan como hora local del sitio, así que van sin zona horaria
// («hora flotante»): el calendario las muestra tal cual, sea cual sea el huso.
const enc = new TextEncoder();
function fold(line) {
  // Líneas de 75 bytes como máximo, sin partir caracteres acentuados.
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function tripToIcs(trip) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cuaderno de viajes//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEscape(trip.title || trip.destination)}`];
  const ev = (uid, summary, start, end, { location, description, alarm } = {}) => {
    lines.push('BEGIN:VEVENT', `UID:${uid}@cuaderno-de-viajes`, `DTSTAMP:${now}`);
    if (timeOnly(start)) {
      lines.push(`DTSTART:${icsDateTime(start)}`);
      const e = end && timeOnly(end) ? end : `${dateOnly(start)}T${String(Math.min(23, +timeOnly(start).slice(0, 2) + 1)).padStart(2, '0')}:${timeOnly(start).slice(3)}`;
      lines.push(`DTEND:${icsDateTime(e)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(dateOnly(start))}`, `DTEND;VALUE=DATE:${icsDate(addDays(dateOnly(end || start), 1))}`);
    }
    lines.push(`SUMMARY:${icsEscape(summary)}`);
    if (location) lines.push(`LOCATION:${icsEscape(location)}`);
    if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
    if (alarm) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(summary)}`, `TRIGGER:-PT${alarm}M`, 'END:VALARM');
    lines.push('END:VEVENT');
  };
  if (trip.startDate) ev(`viaje-${trip.id}`, trip.title || trip.destination, trip.startDate, trip.endDate, { location: trip.destination });
  for (const r of trip.reservations) {
    if (!r.start) continue;
    const k = RES_KINDS[r.kind]?.label || 'Reserva';
    const desc = [r.code && `Código de reserva: ${r.code}`, r.provider, r.number, r.seat && `Asiento: ${r.seat}`, r.terminal && `Terminal: ${r.terminal}`, r.phone && `Teléfono: ${r.phone}`, r.notes].filter(Boolean).join('\n');
    const where = isTransport(r.kind) ? (r.from?.airport || r.from?.name || '') : (r.location?.address || r.location?.name || '');
    if (r.kind === 'hotel') {
      ev(`${r.id}-in`, `Entrada: ${resTitle(r)}`, r.start, null, { location: where, description: desc });
      if (r.end) ev(`${r.id}-out`, `Salida: ${resTitle(r)}`, r.end, null, { location: where, description: desc });
    } else {
      ev(r.id, `${k}: ${resTitle(r)}`, r.start, r.end, { location: where, description: desc, alarm: isTransport(r.kind) && timeOnly(r.start) ? 180 : timeOnly(r.start) ? 60 : null });
    }
  }
  for (const [day, items] of Object.entries(trip.plan || {})) {
    for (const it of items) ev(it.id, it.text, it.time ? `${day}T${it.time}` : day, null, {});
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function tripSummaryText(trip) {
  const out = [];
  out.push(`✈️ ${trip.title || trip.destination}`);
  if (trip.startDate) out.push(`${fmtRange(trip.startDate, trip.endDate)}${trip.destination && trip.destination !== trip.title ? ` · ${trip.destination}` : ''}`);
  const res = [...trip.reservations].filter(r => r.start).sort((a, b) => a.start.localeCompare(b.start));
  if (res.length) {
    out.push('', 'Reservas:');
    for (const r of res) {
      const t = timeOnly(r.start);
      out.push(`• ${fmtDate(dateOnly(r.start), 'weekday')}${t ? ` ${t}` : ''} — ${RES_KINDS[r.kind].label}: ${resTitle(r)}`);
    }
  }
  const { days } = buildAgenda(trip);
  const planned = days.filter(d => d.items.some(i => i.type !== 'res'));
  if (planned.length) {
    out.push('', 'Plan:');
    for (const d of planned) {
      const names = d.items.filter(i => i.type !== 'res').map(i => (i.type === 'place' ? i.place.name : i.type === 'route' ? `ruta «${i.route.name}»` : i.item.text));
      out.push(`• Día ${eachDay(trip.startDate, trip.endDate).indexOf(d.day) + 1}: ${names.join(', ')}`);
    }
  }
  return out.join('\n');
}
