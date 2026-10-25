// Lectura de tickets: importe, moneda, fecha, comercio y categoría a partir del texto del OCR.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, categorize, toNumber } from '../web/js/lib/receipt-parse.js';

const trip = { startDate: '2026-11-02', endDate: '2026-11-04', budget: { currency: 'EUR' } };
const TODAY = '2026-11-05';
const read = (text, t = trip, memory = {}) => parseReceipt(text, { trip: t, memory, today: TODAY });

const RESTAURANTE = `CASA LUCIO S.L.
C/ Cava Baja, 35
28005 MADRID
CIF B12345678
Fecha: 03/11/2026 21:14
Mesa 12   Camarero 4
2 Huevos rotos        24,00
1 Merluza             12,50
2 Cerveza              4,80
SUBTOTAL              41,30
IVA 10%                4,13
TOTAL                 45,43 €
Entregado             50,00
Cambio                 4,57
Gracias por su visita`;

test('ticket de restaurante: total, no el subtotal ni el cambio', () => {
  const r = read(RESTAURANTE);
  assert.equal(r.amount.value, 45.43); assert.equal(r.amount.conf, 'alta');
  assert.equal(r.currency.value, 'EUR');
  assert.equal(r.date.value, '2026-11-03'); assert.equal(r.date.conf, 'alta');
  assert.equal(r.merchant.value, 'Casa Lucio S.L.');
  assert.equal(r.category.value, 'comida');
});

test('gasolinera: «Importe» y los litros no cuentan como total', () => {
  const r = read(`REPSOL ESTACION DE SERVICIO
Fecha 02/11/26 18:40
Producto  Diesel e+
Litros     38,52
Precio/l   1,435
Importe    55,28 EUR
Pago tarjeta`);
  assert.equal(r.amount.value, 55.28);
  assert.equal(r.currency.value, 'EUR');
  assert.equal(r.date.value, '2026-11-02');
  assert.equal(r.category.value, 'transporte');
});

test('miles con punto y decimales con coma: 1.234,56', () => {
  assert.equal(toNumber('1.234,56'), 1234.56);
  assert.equal(toNumber('1,234.56'), 1234.56);
  assert.equal(toNumber('42,00'), 42);
  const r = read('HOTEL AVENIDA\nTOTAL A PAGAR 1.234,56 EUR\n02/11/2026');
  assert.equal(r.amount.value, 1234.56);
  assert.equal(r.category.value, 'alojamiento');
});

test('el total en la línea de debajo de la palabra «TOTAL»', () => {
  assert.equal(read('TIENDA X\nTOTAL\n18,90 €').amount.value, 18.9);
});

test('ticket en inglés con dólares y fecha americana', () => {
  const r = read(`JOE'S DINER
Date 11/25/2026 08:12
Pancakes 9.50
Coffee 3.25
Tax 1.02
TOTAL $13.77`, { startDate: '2026-11-20', endDate: '2026-11-28', budget: { currency: 'USD' } });
  assert.equal(r.amount.value, 13.77);
  assert.equal(r.currency.value, 'USD');
  assert.equal(r.date.value, '2026-11-25'); assert.equal(r.date.conf, 'alta');
});

test('«$» en un viaje a México se queda en pesos mexicanos', () => {
  assert.equal(read('TACOS EL GÜERO\nTOTAL $180.00', { budget: { currency: 'MXN' } }).currency.value, 'MXN');
});

test('el OCR confunde la O con el 0 en la fecha', () => {
  assert.equal(read('BAR PEPE\nFecha: O3/11/2O26\nTOTAL 7,50').date.value, '2026-11-03');
});

test('fecha con el mes en letra', () => {
  assert.equal(read('MUSEO\n3 nov 2026\nTOTAL 12,00').date.value, '2026-11-03');
});

test('varias fechas: se elige la que cae dentro del viaje', () => {
  const r = read('TIENDA\nPedido 15/09/2026\nEntrega 03/11/2026\nTOTAL 20,00');
  assert.equal(r.date.value, '2026-11-03');
});

test('sin ninguna palabra de total: el mayor importe, marcado como poco fiable', () => {
  const r = read('KIOSKO\nPrensa 2,50\nAgua 1,20\nChicles 0,90');
  assert.equal(r.amount.value, 2.5); assert.equal(r.amount.conf, 'baja');
});

test('texto vacío o basura: no inventa nada', () => {
  const r = read('###\n~~~\n');
  assert.equal(r.amount.value, null); assert.equal(r.date.value, null); assert.equal(r.merchant.value, '');
  assert.equal(r.category.value, null);
});

test('un porcentaje no se toma por importe', () => {
  assert.equal(read('TIENDA\nIVA 21,00%\nTOTAL 10,00').amount.value, 10);
});

test('la categoría aprendida manda sobre las reglas', () => {
  assert.equal(categorize('Bar Parking', '', {}).value, 'transporte');          // regla: parking pesa por empate de orden
  assert.deepEqual(categorize('Casa Lucio', '', { 'casa lucio': 'ocio' }), { value: 'ocio', source: 'memoria' });
});

test('el nombre del comercio en mayúsculas se pasa a «Título» sin romper apóstrofos ni siglas', () => {
  assert.equal(read("JOE'S DINER\nTOTAL 5,00").merchant.value, "Joe's Diner");
  assert.equal(read('BAR PEPE S.A.\nTOTAL 5,00').merchant.value, 'Bar Pepe S.A.');
  assert.equal(read('Café Gijón\nTOTAL 5,00').merchant.value, 'Café Gijón');   // ya venía bien: no se toca
});

test('categorías de comercios habituales', () => {
  const c = (n, b = '') => categorize(n, b).value;
  assert.equal(c('Hotel Avenida'), 'alojamiento');
  assert.equal(c('Taxi Madrid'), 'transporte');
  assert.equal(c('Museo del Prado'), 'ocio');
  assert.equal(c('Mercadona'), 'comida');
  assert.equal(c('Farmacia García'), 'compras');
  assert.equal(c('Pepe', 'cerveza\ntapas'), 'comida');
  assert.equal(c("Joe's Diner", 'Pancakes\nCoffee'), 'comida');
  assert.equal(c('Xyz'), null);
});
