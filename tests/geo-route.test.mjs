// Pruebas de los cálculos para seguir una ruta.
import test from 'node:test';
import assert from 'node:assert/strict';

const { routeLengthKm, nearestOnRoute, fmtKm } = await import('../web/js/lib/geo-route.js');

// Una línea de 4 puntos aproximadamente en línea recta hacia el este.
const route = [
  [40.000, -3.000],
  [40.000, -2.990],
  [40.000, -2.980],
  [40.000, -2.970],
];

test('la longitud es la suma de los tramos y es mayor que cero', () => {
  const len = routeLengthKm(route);
  assert.ok(len > 2 && len < 3.5, `longitud inesperada: ${len}`);
  assert.equal(routeLengthKm([[40, -3]]), 0);
});

test('un punto justo sobre la ruta tiene distancia fuera de ruta casi nula', () => {
  const r = nearestOnRoute(route, { lat: 40.0, lng: -2.985 });
  assert.ok(r.offKm < 0.05, `debería estar sobre la ruta: ${r.offKm}`);
  assert.ok(r.aheadKm > 0, 'debe quedar camino por delante');
  assert.ok(r.progress > 0.3 && r.progress < 0.7, `progreso raro: ${r.progress}`);
});

test('un punto alejado da una distancia fuera de ruta grande', () => {
  const r = nearestOnRoute(route, { lat: 40.1, lng: -2.985 });
  assert.ok(r.offKm > 5, `debería estar lejos: ${r.offKm}`);
});

test('al principio queda casi toda la ruta; al final, casi nada', () => {
  const ini = nearestOnRoute(route, { lat: 40.0, lng: -3.0 });
  const fin = nearestOnRoute(route, { lat: 40.0, lng: -2.97 });
  const total = routeLengthKm(route);
  assert.ok(Math.abs(ini.aheadKm - total) < 0.05, `al inicio debe quedar casi todo: ${ini.aheadKm} vs ${total}`);
  assert.ok(fin.aheadKm < 0.05, `al final no debe quedar casi nada: ${fin.aheadKm}`);
});

test('fmtKm usa metros, un decimal y kilómetros enteros', () => {
  assert.equal(fmtKm(0.45), '450 m');
  assert.equal(fmtKm(2.34), '2,3 km');
  assert.equal(fmtKm(42), '42 km');
  assert.equal(fmtKm(null), '');
});

test('nearestOnRoute aguanta una ruta de un solo punto y una vacía', () => {
  assert.equal(nearestOnRoute([], { lat: 0, lng: 0 }), null);
  const r = nearestOnRoute([[40, -3]], { lat: 40.01, lng: -3 });
  assert.equal(r.aheadKm, 0);
  assert.ok(r.offKm > 0);
});
