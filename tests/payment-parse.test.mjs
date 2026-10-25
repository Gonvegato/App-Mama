// Avisos de pago del móvil. OJO: los textos de abajo son redacciones habituales que he escrito yo,
// NO avisos reales copiados de ningún banco. Sirven para comprobar la lógica, no que cada banco encaje.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePayment, toAmount, tripOn } from '../web/js/lib/payment-parse.js';

const pay = (t, exp) => {
  const r = parsePayment(t);
  assert.equal(r.kind, 'pago', `«${t}» → ${JSON.stringify(r)}`);
  assert.equal(r.amount, exp.amount, `importe de «${t}»`);
  if (exp.currency) assert.equal(r.currency, exp.currency, `moneda de «${t}»`);
  if ('merchant' in exp) assert.equal(r.merchant, exp.merchant, `comercio de «${t}»`);
};

test('el caso del padre: pago en Pichón Rojo', () => {
  pay('Pago de 25,00 € en PICHON ROJO', { amount: 25, currency: 'EUR', merchant: 'Pichon Rojo' });
  pay('Pago de 25 € en Pichón Rojo', { amount: 25, currency: 'EUR', merchant: 'Pichón Rojo' });
});

test('redacciones habituales en español', () => {
  pay('Has pagado 25,00 € en Pichón Rojo con tu tarjeta terminada en 1234', { amount: 25, currency: 'EUR', merchant: 'Pichón Rojo' });
  pay('Compra aprobada: 25,00 EUR - PICHON ROJO MADRID', { amount: 25, currency: 'EUR', merchant: 'Pichon Rojo Madrid' });
  pay('Tarjeta *1234: pago de 25,00 € en PICHON ROJO. Saldo disponible: 1.234,56 €', { amount: 25, merchant: 'Pichon Rojo' });
  pay('Cargo de 1.200,00 € en HOTEL AVENIDA', { amount: 1200, merchant: 'Hotel Avenida' });
  pay('Has pagado en Casa Lucio 45,43 €', { amount: 45.43, merchant: 'Casa Lucio' });
  pay('Pago con tarjeta de 9,50 € en BAR PEPE el 03/11/2026 a las 21:14', { amount: 9.5, merchant: 'Bar Pepe' });
});

test('redacciones habituales en inglés y con otras monedas', () => {
  pay('You paid €25.00 at Pichon Rojo', { amount: 25, currency: 'EUR', merchant: 'Pichon Rojo' });
  pay('Card ending 1234: purchase of $13.77 at JOES DINER', { amount: 13.77, currency: 'USD', merchant: 'Joes Diner' });
  pay('Payment of £8.40 to Costa Coffee', { amount: 8.4, currency: 'GBP', merchant: 'Costa Coffee' });
});

test('estilo cartera (título y cantidad)', () => {
  pay('Pichón Rojo | €25,00', { amount: 25, currency: 'EUR', merchant: 'Pichón Rojo' });
  pay('Pichón Rojo\n-25,00 €', { amount: 25, merchant: 'Pichón Rojo' });
  pay('Pago con Google Wallet · Pichón Rojo · 25,00 €', { amount: 25 });
});

test('el saldo, el límite o lo disponible nunca se toman por el importe', () => {
  pay('Saldo: 1.500,00 € · Pago de 12,40 € en Mercadona', { amount: 12.4, merchant: 'Mercadona' });
  pay('Pago de 12,40 € en Mercadona. Límite disponible 800 €', { amount: 12.4 });
});

test('dinero recibido, devoluciones y pagos rechazados se ignoran (no son gastos)', () => {
  assert.equal(parsePayment('Has recibido un Bizum de 10 € de Juan').kind, 'ignorado');
  assert.equal(parsePayment('Has recibido una transferencia de 100,00 € de Mamá').kind, 'ignorado');
  assert.equal(parsePayment('Devolución de 25,00 € de PICHON ROJO').kind, 'ignorado');
  assert.equal(parsePayment('Pago de 25,00 € en PICHON ROJO rechazado').kind, 'ignorado');
  assert.equal(parsePayment('Payment of €25.00 declined').kind, 'ignorado');
});

test('lo que no se entiende queda «sin-leer», no se inventa nada', () => {
  assert.equal(parsePayment('Tu código de verificación es 482913').kind, 'sin-leer');
  assert.equal(parsePayment('').kind, 'sin-leer');
  assert.equal(parsePayment('Gana 50 € invitando a un amigo').kind, 'sin-leer');
  assert.equal(parsePayment('Hola, ¿qué tal?').kind, 'sin-leer');
});

test('un pago sin comercio legible se apunta igualmente (con el comercio vacío)', () => {
  const r = parsePayment('Pago con tarjeta de 25,00 €');
  assert.equal(r.kind, 'pago'); assert.equal(r.amount, 25); assert.equal(r.merchant, '');
});

test('comillas, saltos de línea y símbolos en el texto no rompen nada', () => {
  pay('Pago de 5,00 € en L\'Atelier "Le Petit"\nsegunda línea', { amount: 5 });
});

test('toAmount: miles y decimales en los dos formatos', () => {
  assert.equal(toAmount('1.234,56'), 1234.56);
  assert.equal(toAmount('1,234.56'), 1234.56);
  assert.equal(toAmount('25,5'), 25.5);
  assert.equal(toAmount('25'), 25);
  assert.equal(toAmount('1.234'), 1234);
  assert.equal(toAmount('2 500,00'), 2500);
});

test('¿estás de viaje?: dentro de las fechas (extremos incluidos), el más reciente si hay dos, y sin archivados', () => {
  const a = { id: 'a', startDate: '2026-11-02', endDate: '2026-11-04' };
  const b = { id: 'b', startDate: '2026-11-04', endDate: '2026-11-10' };
  const z = { id: 'z', startDate: '2026-11-01', endDate: '2026-11-30', archived: true };
  assert.equal(tripOn([a, b, z], '2026-11-01'), null);                 // el archivado no cuenta
  assert.equal(tripOn([a, b], '2026-11-02').id, 'a');                  // día de salida
  assert.equal(tripOn([a, b], '2026-11-04').id, 'b');                  // coinciden dos: el que salió más tarde
  assert.equal(tripOn([a, b], '2026-11-10').id, 'b');                  // día de vuelta
  assert.equal(tripOn([a, b], '2026-11-11'), null);
  assert.equal(tripOn([{ id: 'c', startDate: '2026-11-05' }], '2026-11-05').id, 'c');   // sin fecha de vuelta: ese día
  assert.equal(tripOn([{ id: 'd', startDate: '' }], '2026-11-05'), null);
});
