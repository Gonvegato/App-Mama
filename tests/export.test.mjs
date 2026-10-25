// Pruebas de la exportación: lo que se exporta se vuelve a leer igual con los importadores.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;
const imp = await import('../web/js/lib/importers.js');
const exp = await import('../web/js/lib/export.js');

const ruta = { id: 'r1', name: 'Paseo <por> el «Retiro» & más', points: [[40.41, -3.7, 650], [40.411, -3.701, 655.5], [40.412, -3.702]] };

test('GPX: ida y vuelta de una ruta con altitud, nombre con símbolos', () => {
  const gpx = exp.routeToGpx(ruta);
  assert.match(gpx, /xmlns="http:\/\/www\.topografix\.com\/GPX\/1\/1"/);
  const back = imp.parseGPX(gpx);
  assert.equal(back.routes.length, 1);
  assert.equal(back.routes[0].name, ruta.name);
  assert.deepEqual(back.routes[0].points, ruta.points);
});

test('KML: lugares, planes con ubicación y rutas se vuelven a leer', () => {
  const trip = {
    title: 'Madrid', places: [{ name: 'Palacio Real', lat: 40.418, lng: -3.714, address: 'Calle Bailén', notes: 'Cierra lunes' }, { name: 'Sin sitio', lat: null, lng: null }],
    routes: [ruta], plan: { '2026-11-03': [{ text: 'Museo', time: '10:00', where: { name: 'Prado', lat: 40.4138, lng: -3.6921, address: 'Madrid' } }, { text: 'Cena', where: { name: 'x', lat: null, lng: null } }] },
  };
  const back = imp.parseKML(exp.tripToKml(trip));
  assert.deepEqual(back.places.map(p => p.name).sort(), ['Museo', 'Palacio Real']);
  const pal = back.places.find(p => p.name === 'Palacio Real');
  assert.equal(pal.lat, 40.418); assert.equal(pal.lng, -3.714);
  assert.equal(back.routes.length, 1);
  assert.equal(back.routes[0].name, ruta.name);
  assert.equal(back.routes[0].points.length, 3);
  assert.equal(back.routes[0].points[0][0], 40.41);
});

test('KML: un recorrido larguísimo se aligera (límite de My Maps)', () => {
  const pts = Array.from({ length: 9000 }, (_, i) => [40 + i / 100000, -3 - i / 100000]);
  const back = imp.parseKML(exp.tripToKml({ title: 'x', places: [], routes: [{ name: 'Larga', points: pts }], plan: {} }));
  assert.ok(back.routes[0].points.length <= exp.KML_MAX_POINTS + 1, `quedaron ${back.routes[0].points.length}`);
  assert.deepEqual(back.routes[0].points.at(-1), pts.at(-1));
});

test('GPX: una ruta sin puntos válidos no rompe', () => {
  assert.doesNotThrow(() => exp.routeToGpx({ name: 'Vacía', points: [] }));
});
