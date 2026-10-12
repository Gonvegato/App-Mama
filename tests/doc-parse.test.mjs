// Pruebas del lector de documentos de reserva (solo el análisis del texto, sin PDF.js).
import test from 'node:test';
import assert from 'node:assert/strict';

const { parseReservationDoc, parseDate, guessReservationKind } = await import('../web/js/lib/doc-parse.js');

test('parseDate entiende varios formatos', () => {
  assert.equal(parseDate('2026-10-15'), '2026-10-15');
  assert.equal(parseDate('15/10/2026'), '2026-10-15');
  assert.equal(parseDate('15 oct 2026'), '2026-10-15');
  assert.equal(parseDate('15 de octubre de 2026'), '2026-10-15');
  assert.equal(parseDate('Oct 15, 2026'), '2026-10-15');
  assert.equal(parseDate('no es fecha'), '');
});

test('reserva de Booking en español', () => {
  const txt = `Confirmación de tu reserva
Tu reserva en: Hotel Avenida Palace
Booking.com
Número de confirmación: 1234567890
Entrada: 15 de octubre de 2026
Salida: 19 de octubre de 2026
Precio total: 612,00 €
Teléfono: +351 21 321 8100`;
  const r = parseReservationDoc(txt);
  assert.equal(r.code, '1234567890');
  assert.equal(r.start, '2026-10-15');
  assert.equal(r.end, '2026-10-19');
  assert.equal(r.price, 612);
  assert.equal(r.currency, 'EUR');
  assert.equal(r.provider, 'Booking');
  assert.equal(r.name, 'Hotel Avenida Palace');
  assert.ok(r.phone.includes('351'));
});

test('reserva de Airbnb en inglés', () => {
  const txt = `Your reservation at Sunny Loft Apartment
Airbnb
Confirmation code: HMABCDEF
Check-in: Oct 15, 2026
Check-out: Oct 19, 2026
Total: $540 USD`;
  const r = parseReservationDoc(txt);
  assert.equal(r.code, 'HMABCDEF');
  assert.equal(r.start, '2026-10-15');
  assert.equal(r.end, '2026-10-19');
  assert.equal(r.price, 540);
  assert.equal(r.currency, 'USD');
  assert.equal(r.provider, 'Airbnb');
  assert.equal(r.name, 'Sunny Loft Apartment');
});

test('si no hay etiquetas de fecha, toma las dos fechas del documento', () => {
  const r = parseReservationDoc('Reserva\n2026-11-01 ... 2026-11-05 ... Hotel Mar');
  assert.equal(r.start, '2026-11-01');
  assert.equal(r.end, '2026-11-05');
});

test('no inventa datos cuando no los hay', () => {
  const r = parseReservationDoc('Gracias por tu compra. Que tengas buen viaje.');
  assert.equal(r.code, undefined);
  assert.equal(r.start, undefined);
  assert.equal(r.price, undefined);
  assert.equal(r.name, undefined);
});

test('detecta el tipo de reserva', () => {
  assert.equal(guessReservationKind('Tu reserva en el Hotel Rural, Booking.com, 2 noches, habitación doble'), 'hotel');
  assert.equal(guessReservationKind('Tarjeta de embarque vuelo IB3456, puerta de embarque'), 'flight');
  assert.equal(guessReservationKind('Billete de tren Renfe AVE Madrid-Sevilla'), 'train');
  assert.equal(guessReservationKind('Entradas para el museo del Prado, visita guiada'), 'activity');
  assert.equal(guessReservationKind('Gracias por tu compra'), null);
});

test('reserva de hotel reenviada: tipo, fechas reales y nombre limpio', () => {
  // Parecido al PDF real: el correo se reenvió el 11 sep, pero la estancia es 23-25 oct.
  const txt = `Fecha: viernes, 11 de septiembre de 2026
¡Gracias! Tu reserva en el HOTEL RURAL BASQUE IRATI está confirmada
Booking.com
Confirmación: 5665352263
Entrada                               viernes, 23 de octubre de 2026 (de 16:00 a 21:00)
Salida                  domingo, 25 de octubre de 2026 (de 06:00 a 11:00)
Precio total                                                                      € 210`;
  const r = parseReservationDoc(txt);
  assert.equal(r.kind, 'hotel');
  assert.equal(r.start, '2026-10-23');   // la entrada, no la fecha del correo
  assert.equal(r.end, '2026-10-25');
  assert.equal(r.name, 'HOTEL RURAL BASQUE IRATI');  // sin «el» ni «está confirmada»
  assert.equal(r.price, 210);
  assert.equal(r.provider, 'Booking');
});

test('limpia el nombre aunque el PDF parta las palabras («con fi rmada»)', () => {
  const r = parseReservationDoc('Tu reserva en el HOTEL RURAL BASQUE IRATI está con fi rmada\nBooking.com\nEntrada: 23 de octubre de 2026\nSalida: 25 de octubre de 2026');
  assert.equal(r.name, 'HOTEL RURAL BASQUE IRATI');
});
