// El discriminador de correos: qué parece del viaje y qué no.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreMail, rankMails, domainOf, baseDomain } from '../web/js/lib/mail-score.js';

const trip = { title: 'Escapada a Madrid', destination: 'Madrid', reservations: [{ code: 'XK92LM' }, { code: 'ab' }] };
const mail = (from, subject, snippet = '', attachments = []) => ({ id: subject, from, subject, snippet, attachments, date: '2026-10-01' });
const level = (...a) => scoreMail(mail(...a), trip).level;

test('confirmaciones reales → probable', () => {
  assert.equal(level('Booking.com <noreply@booking.com>', 'Tu reserva en Hotel Avenida está confirmada'), 'probable');
  assert.equal(level('Vueling <no-reply@vueling.com>', 'Confirmación de tu vuelo BCN → MAD'), 'probable');
  assert.equal(level('Ryanair <noreply@ryanair.com>', 'Haz el check-in online para tu vuelo'), 'probable');
  assert.equal(level('Renfe <ventaweb@renfe.es>', 'Tu billete Madrid-Sevilla', 'Adjuntamos tu billete', [{ name: 'billete.pdf', mime: 'application/pdf' }]), 'probable');
});

test('publicidad de las mismas empresas → oculto', () => {
  assert.equal(level('Ryanair <news@mail.ryanair.com>', 'Ofertas de vuelos desde 9,99 €'), 'oculto');
  assert.equal(level('Booking.com <noreply@booking.com>', 'Ofertas de última hora para tu viaje a Madrid'), 'oculto');
  assert.equal(level('Booking.com <noreply@booking.com>', 'Valora tu estancia en Hotel Avenida'), 'oculto');
  assert.equal(level('Vueling <marketing@vueling.com>', 'Descuento del 20% en tu próximo vuelo'), 'oculto');
});

test('correos de otra cosa → oculto', () => {
  assert.equal(level('Ana <ana@gmail.com>', 'Reunión del jueves'), 'oculto');
  assert.equal(level('Amazon <pedidos@amazon.es>', 'Tu pedido ha sido enviado'), 'oculto');
});

test('el código de una reserva del viaje es señal fuerte, y un código demasiado corto no cuenta', () => {
  assert.equal(level('Alguien <x@gmail.com>', 'Re: localizador XK92LM'), 'probable');
  assert.equal(level('Alguien <x@gmail.com>', 'ab cd ef'), 'oculto');
});

test('menciona el destino pero nada más → dudoso (se enseña, sin destacar)', () => {
  assert.equal(level('Marta <marta@gmail.com>', '¿Qué tal el viaje a Madrid?'), 'dudoso');
});

test('lo aprendido de lo que descartas o guardas cuenta', () => {
  const m = mail('Hoteles <info@hotelesx.com>', 'Confirmación de estancia');
  assert.equal(scoreMail(m, trip).level, 'dudoso');                              // +3 sin más
  assert.equal(scoreMail(m, trip, { 'hotelesx.com': 2 }).level, 'probable');
  assert.equal(scoreMail(m, trip, { 'hotelesx.com': -3 }).level, 'oculto');
});

test('rankMails: probables primero, luego dudosos, y los ocultos al final', () => {
  const r = rankMails([mail('a@gmail.com', 'Reunión'), mail('Marta <m@gmail.com>', 'Viaje a Madrid'), mail('Vueling <n@vueling.com>', 'Confirmación de tu vuelo')], trip, {});
  assert.deepEqual(r.map(x => x.level), ['probable', 'dudoso', 'oculto']);
  assert.ok(r[0].why.length > 0);
});

test('dominios', () => {
  assert.equal(domainOf('Booking.com <noreply@mail.booking.com>'), 'mail.booking.com');
  assert.equal(baseDomain('mail.booking.com'), 'booking.com');
  assert.equal(domainOf(''), '');
});
