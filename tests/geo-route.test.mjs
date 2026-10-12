// Pruebas de los cálculos para seguir una ruta.
import test from 'node:test';
import assert from 'node:assert/strict';

const { routeLengthKm, nearestOnRoute, fmtKm, elevationStats, difficulty, routeStats } = await import('../web/js/lib/geo-route.js');

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

test('elevationStats suma subidas y bajadas ignorando el ruido pequeño', () => {
  const pts = [
    [40, -3, 100],
    [40, -3, 101],   // +1 (ruido, se ignora con umbral 4)
    [40, -3, 160],   // +60 sube
    [40, -3, 120],   // -40 baja
    [40, -3, 170],   // +50 sube
  ];
  const e = elevationStats(pts, 4);
  assert.equal(e.has, true);
  assert.equal(e.ascent, 110);   // 60 + 50
  assert.equal(e.descent, 40);
  assert.equal(e.min, 100);
  assert.equal(e.max, 170);
});

test('elevationStats dice que no hay datos si los puntos no traen altura', () => {
  assert.equal(elevationStats([[40, -3], [40.1, -3]]).has, false);
});

test('difficulty sube de nivel con la distancia y el desnivel', () => {
  assert.equal(difficulty(3, 0).label, 'Fácil');
  assert.equal(difficulty(8, 0).label, 'Moderada');
  assert.equal(difficulty(3, 900).level >= 2, true); // 900 m de subida ya no es «fácil»
  assert.equal(difficulty(30, 2000).label, 'Difícil');
});

test('routeStats junta longitud, puntos, altitud y dificultad', () => {
  const r = { points: [[40, -3, 100], [40, -2.99, 160], [40, -2.98, 120]] };
  const s = routeStats(r);
  assert.ok(s.lengthKm > 0);
  assert.equal(s.points, 3);
  assert.equal(s.ele.has, true);
  assert.ok(s.difficulty.label);
});
