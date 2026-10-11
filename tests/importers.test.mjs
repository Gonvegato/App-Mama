// Pruebas de los importadores. Ejecutar con: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';

globalThis.DOMParser = DOMParser;
globalThis.JSZip = JSZip;

const imp = await import('../web/js/lib/importers.js');

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Roma 2026</name>
    <Style id="line-1"><LineStyle><color>ff0000ff</color><width>4</width></LineStyle></Style>
    <StyleMap id="line-1-map"><Pair><key>normal</key><styleUrl>#line-1</styleUrl></Pair></StyleMap>
    <Folder>
      <name>Monumentos</name>
      <Placemark>
        <name>Coliseo</name>
        <description><![CDATA[Entrada a las <b>10:00</b><br>Llevar DNI]]></description>
        <ExtendedData><Data name="Dirección"><value>Piazza del Colosseo, 1</value></Data></ExtendedData>
        <Point><coordinates>12.4922309,41.8902102,0</coordinates></Point>
      </Placemark>
      <Placemark><name>Sin coordenadas</name><address>Via del Corso 1, Roma</address></Placemark>
    </Folder>
    <Folder>
      <name>Paseo</name>
      <Placemark>
        <name>Ruta por el Trastévere</name>
        <styleUrl>#line-1-map</styleUrl>
        <LineString><tessellate>1</tessellate><coordinates>
          12.4698,41.8893,0 12.4705,41.8880,0
          12.4721,41.8867,0
        </coordinates></LineString>
      </Placemark>
    </Folder>
  </Document>
</kml>`;

test('KML de Google My Maps: lugares, capas, notas, rutas y colores', () => {
  const r = imp.parseKML(KML);
  assert.equal(r.places.length, 1);
  const p = r.places[0];
  assert.equal(p.name, 'Coliseo');
  assert.equal(p.group, 'Monumentos');
  assert.ok(Math.abs(p.lat - 41.8902102) < 1e-9 && Math.abs(p.lng - 12.4922309) < 1e-9);
  assert.match(p.notes, /Entrada a las 10:00\nLlevar DNI/);
  assert.match(p.notes, /Piazza del Colosseo/);
  assert.equal(r.routes.length, 1);
  assert.equal(r.routes[0].points.length, 3);
  assert.equal(r.routes[0].color, '#ff0000');
  assert.equal(r.pending.length, 1);
  assert.equal(r.pending[0].address, 'Via del Corso 1, Roma');
});

test('KMZ: lee el doc.kml de dentro del zip', async () => {
  const zip = new JSZip();
  zip.file('doc.kml', KML);
  zip.file('images/icon.png', 'x');
  const buf = await zip.generateAsync({ type: 'arraybuffer' });
  const r = await imp.parseKMZ(buf);
  assert.equal(r.places[0].name, 'Coliseo');
  assert.equal(r.routes.length, 1);
});

test('GPX: puntos, rutas y recorridos', () => {
  const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="x" xmlns="http://www.topografix.com/GPX/1/1">
    <wpt lat="48.8584" lon="2.2945"><name>Torre Eiffel</name><desc>Subir al atardecer</desc></wpt>
    <rte><name>Mi ruta</name><rtept lat="48.86" lon="2.33"><name>Louvre</name></rtept><rtept lat="48.853" lon="2.35"></rtept></rte>
    <trk><name>Paseo</name><trkseg><trkpt lat="48.85" lon="2.34"/><trkpt lat="48.851" lon="2.341"/><trkpt lat="48.852" lon="2.342"/></trkseg></trk>
  </gpx>`;
  const r = imp.parseGPX(gpx);
  assert.deepEqual(r.places.map(p => p.name), ['Torre Eiffel', 'Louvre']);
  assert.equal(r.places[0].notes, 'Subir al atardecer');
  assert.equal(r.routes.length, 2);
  assert.equal(r.routes[1].points.length, 3);
});

test('GeoJSON de Google Takeout (Sitios guardados), con y sin coordenadas', () => {
  const gj = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [-3.6921, 40.4138] }, properties: { date: '2025-01-01T00:00:00Z', google_maps_url: 'http://maps.google.com/?cid=123', location: { address: 'C. de Ruiz de Alarcón, 23, Madrid', country_code: 'ES', name: 'Museo del Prado' } } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { google_maps_url: 'https://www.google.com/maps/search/?api=1&query=Casa+Lucio', location: { name: 'Casa Lucio', address: 'Cava Baja 35, Madrid' } } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { google_maps_url: 'https://www.google.com/maps/place/40.4,-3.7', Title: 'Punto' } },
    ],
  };
  const r = imp.parseGeoJSON(gj);
  assert.equal(r.places.length, 2);
  assert.equal(r.places[0].name, 'Museo del Prado');
  assert.equal(r.places[0].lat, 40.4138);
  assert.equal(r.places[1].lat, 40.4);
  assert.equal(r.pending.length, 1);
  assert.equal(r.pending[0].name, 'Casa Lucio');
});

test('CSV de una lista de Google Takeout (sin coordenadas) y CSV con lat/lng', () => {
  const csv = 'Title,Note,URL,Tags,Comment\n"Mercado de San Miguel","Ir pronto, se llena",https://www.google.com/maps/place/Mercado+de+San+Miguel/data=!4m2!3m1!1s0xd42287da1a3e3f9:0x5dda9a6f8a6e6d2e,,\nBotín,,"https://www.google.com/maps/place/Sobrino+de+Bot%C3%ADn/@40.4141,-3.7083,17z/data=!3m1!4b1!4m6!3m5!1s0x1:0x2!8m2!3d40.4140877!4d-3.7079988",,\n';
  const r = imp.parseCSV(csv, 'Madrid.csv');
  assert.equal(r.places.length, 1);
  assert.equal(r.places[0].name, 'Botín');
  assert.equal(r.places[0].lat, 40.4140877);
  assert.equal(r.places[0].group, 'Madrid');
  assert.equal(r.pending.length, 1);
  assert.equal(r.pending[0].name, 'Mercado de San Miguel');
  assert.equal(r.pending[0].notes, 'Ir pronto, se llena');

  const csv2 = 'nombre;latitud;longitud;notas\nPlaza Mayor;40,4155;-3,7074;centro\n';
  const r2 = imp.parseCSV(csv2.replace(/40,4155/, '40.4155').replace(/-3,7074/, '-3.7074'));
  assert.equal(r2.places[0].name, 'Plaza Mayor');
  assert.equal(r2.places[0].lng, -3.7074);
});

test('Enlace de lugar de Google Maps', () => {
  const r = imp.parseMapLink('https://www.google.com/maps/place/Sagrada+Fam%C3%ADlia/@41.4036299,2.1717486,17z/data=!3m1!4b1!4m6!3m5!1s0x12a4a2dcd83dfb93:0x9bd8aac21bc3c950!8m2!3d41.4036299!4d2.1743235!16zL20vMGc2bjM?entry=ttu');
  assert.equal(r.places.length, 1);
  assert.equal(r.places[0].name, 'Sagrada Família');
  assert.equal(r.places[0].lng, 2.1743235); // usa !4d (el lugar), no el centro de la vista
});

test('Enlace de ruta de Google Maps con paradas', () => {
  const url = 'https://www.google.com/maps/dir/Puerta+del+Sol,+Madrid/40.4138,-3.6921/Parque+del+Retiro,+Madrid/@40.41,-3.69,15z/data=!3m1!4b1!4m14!4m13!1m5!1m1!1s0xd42287e472b3b8f:0x6a4f71889c9ee1e5!2m2!1d-3.7035!2d40.4169!1m0!1m5!1m1!1s0xd4228a!2m2!1d-3.6845!2d40.4153!3e2';
  const r = imp.parseMapLink(url);
  assert.equal(r.places.length, 3);
  assert.equal(r.places[0].name, 'Puerta del Sol, Madrid');
  assert.equal(r.places[0].lat, 40.4169);
  assert.equal(r.places[1].lat, 40.4138);
  assert.equal(r.places[2].name, 'Parque del Retiro, Madrid');
  assert.equal(r.places[2].lng, -3.6845);
  assert.ok(r.routeFromOrder);
});

test('Enlaces api=1 de Google', () => {
  const r = imp.parseMapLink('https://www.google.com/maps/dir/?api=1&origin=Lisboa&destination=38.6916,-9.2160&waypoints=Sintra%7CCascais');
  assert.equal(r.places.length, 1);
  assert.equal(r.pending.map(p => p.name).join('|'), 'Lisboa|Sintra|Cascais');
  const s = imp.parseMapLink('https://www.google.com/maps/search/?api=1&query=47.5951518,-122.3316393');
  assert.equal(s.places[0].lat, 47.5951518);
});

test('Enlaces de Apple Maps (nuevos y antiguos)', () => {
  let r = imp.parseMapLink('https://maps.apple.com/place?coordinate=40.779092,-73.962932&name=The%20Met');
  assert.equal(r.places[0].name, 'The Met');
  assert.equal(r.places[0].lat, 40.779092);
  r = imp.parseMapLink('https://maps.apple.com/?ll=48.8584,2.2945&q=Torre%20Eiffel');
  assert.equal(r.places[0].name, 'Torre Eiffel');
  r = imp.parseMapLink('https://maps.apple.com/place?address=1000%20Fifth%20Ave,%20NY');
  assert.equal(r.pending[0].address, '1000 Fifth Ave, NY');
  r = imp.parseMapLink('https://maps.apple.com/directions?source=37.795442,-122.393624&destination=San%20Francisco%20City%20Hall&waypoint=37.80,-122.41&mode=walking');
  assert.equal(r.places.length, 2);
  assert.equal(r.pending[0].name, 'San Francisco City Hall');
  assert.ok(r.routeFromOrder);
  r = imp.parseMapLink('https://maps.apple.com/?saddr=Madrid&daddr=Toledo%20to:Segovia');
  assert.deepEqual(r.pending.map(p => p.name), ['Madrid', 'Toledo', 'Segovia']);
});

test('Enlaces cortos se marcan para resolver', () => {
  assert.equal(imp.parseMapLink('https://maps.app.goo.gl/AbCdEf123').needsResolve, true);
  assert.equal(imp.parseMapLink('https://maps.apple/p/AbCdEf').needsResolve, true);
  assert.ok(imp.parseMapLink('https://example.com').warnings.length);
});

test('Extraer enlaces de un texto pegado', () => {
  const urls = imp.extractUrls('Mira esto: https://maps.app.goo.gl/abc y (https://maps.apple.com/?ll=1.5,2.5).');
  assert.deepEqual(urls, ['https://maps.app.goo.gl/abc', 'https://maps.apple.com/?ll=1.5,2.5']);
});

test('CSV con comillas y saltos de línea dentro de campos', () => {
  const rows = imp.parseCSVText('a,b\n"uno, dos","tres\ncuatro"\n');
  assert.deepEqual(rows, [['a', 'b'], ['uno, dos', 'tres\ncuatro']]);
});
