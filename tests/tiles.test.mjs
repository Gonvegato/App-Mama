// Pruebas del cálculo de teselas para el mapa sin conexión.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tileCoords, tilesAtZoom, planTiles, tileUrl, tripGeo } from '../web/js/lib/tiles.js';

test('coordenadas de tesela: valores calculados aparte con la fórmula de la wiki de OpenStreetMap', () => {
  const sol = tileCoords(40.4169, -3.7035, 12);      // Madrid, Puerta del Sol
  assert.deepEqual([Math.floor(sol.x), Math.floor(sol.y)], [2005, 1544]);
  const lon = tileCoords(51.5074, -0.1278, 10);      // Londres
  assert.deepEqual([Math.floor(lon.x), Math.floor(lon.y)], [511, 340]);
});

test('un punto da 1 tesela en zoom bajo y 3x3 en zoom de detalle', () => {
  const g = { spots: [{ lat: 40.4169, lng: -3.7035 }] };
  assert.equal(tilesAtZoom(g, 8).length, 1);
  assert.equal(tilesAtZoom(g, 13).length, 9);
});

test('un recorrido no deja huecos: cada punto del trazado cae en una tesela descargada', () => {
  // Recta de ~60 km con solo dos puntos (como las rutas «líneas rectas» importadas)
  const a = { lat: 40.4, lng: -3.7 }, b = { lat: 40.9, lng: -3.5 };
  const z = 13, set = new Set(tilesAtZoom({ paths: [[a, b]] }, z).map(t => `${t.x}/${t.y}`));
  for (let i = 0; i <= 200; i++) {
    const c = tileCoords(a.lat + (b.lat - a.lat) * i / 200, a.lng + (b.lng - a.lng) * i / 200, z);
    assert.ok(set.has(`${Math.floor(c.x)}/${Math.floor(c.y)}`), `hueco en el paso ${i}`);
  }
});

test('planTiles: sube de zoom hasta el tope de teselas y avisa si se quedó corto', () => {
  const geo = { spots: [{ lat: 40.4169, lng: -3.7035 }] };
  const full = planTiles(geo, { maxTiles: 3000 });
  assert.equal(full.truncated, false);
  assert.equal(full.levels[0].z, 6);
  assert.equal(full.levels.at(-1).z, 14);
  const short = planTiles({ paths: [Array.from({ length: 60 }, (_, i) => ({ lat: 40 + i * 0.02, lng: -3 + i * 0.02 }))] }, { maxTiles: 300 });
  assert.equal(short.truncated, true);
  assert.ok(short.total <= 300);
  assert.ok(short.levels.length > 0 && short.levels.at(-1).z < 14);
});

test('planTiles: sin puntos no pide nada', () => {
  assert.deepEqual(planTiles({ spots: [], paths: [] }).levels, []);
});

test('tileUrl rellena la plantilla', () => {
  assert.equal(tileUrl('https://t/planet/v1/{z}/{x}/{y}.pbf', { z: 12, x: 1994, y: 1532 }), 'https://t/planet/v1/12/1994/1532.pbf');
});

test('tripGeo recoge lugares, reservas, planes y rutas; el aeropuerto de salida no', () => {
  const g = tripGeo({
    center: { lat: 40.4, lng: -3.7 },
    places: [{ lat: 40.41, lng: -3.71 }, { lat: null, lng: null }],
    reservations: [{ kind: 'flight', from: { lat: 51.4, lng: -0.4 }, to: { lat: 40.47, lng: -3.56 } }, { kind: 'hotel', location: { lat: 40.42, lng: -3.70 } }],
    plan: { d: [{ where: { lat: 40.43, lng: -3.69 } }, { where: null }] },
    routes: [{ points: [[40.4, -3.7, 650], [40.41, -3.71]] }, { points: [[1, 1]] }],
  });
  assert.equal(g.spots.length, 5);          // centro, 1 lugar, aeropuerto llegada, hotel, plan
  assert.ok(!g.spots.some(s => s.lat === 51.4));
  assert.equal(g.paths.length, 1);
});
