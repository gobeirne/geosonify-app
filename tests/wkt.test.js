#!/usr/bin/env node
/* tests/wkt.test.js — js/features/wkt.js: parsing, writing and round trips (WP2.4) */
'use strict';
const W = require(require('path').join(__dirname, '..', 'js/features/wkt.js'));
let pass = 0, fail = 0;
function eq(name, a, b) { const ok = JSON.stringify(a) === JSON.stringify(b); if (ok) pass++; else { fail++; console.log('FAIL ' + name + '\n  got  ' + JSON.stringify(a) + '\n  want ' + JSON.stringify(b)); } }
function throws(name, fn, re) { try { fn(); fail++; console.log('FAIL ' + name + ': did not throw'); } catch (e) { if (re.test(e.message)) pass++; else { fail++; console.log('FAIL ' + name + ': ' + e.message); } } }

eq('point', W.parse('POINT (172.6 -43.5)'), { type: 'Point', coordinates: [172.6, -43.5] });
eq('point Z, lower case', W.parse('point z (1 2 3)'), { type: 'Point', coordinates: [1, 2] });
eq('EWKT SRID=4326', W.parse('SRID=4326;LINESTRING(0 0, 1 1)'), { type: 'LineString', coordinates: [[0, 0], [1, 1]] });
eq('polygon with hole', W.parse('POLYGON ((0 0, 4 0, 4 4, 0 4, 0 0), (1 1, 2 1, 2 2, 1 1))').coordinates.length, 2);
eq('multipoint, both forms', [W.parse('MULTIPOINT (1 2, 3 4)'), W.parse('MULTIPOINT ((1 2), (3 4))')].map(g => g.coordinates), [[[1, 2], [3, 4]], [[1, 2], [3, 4]]]);
eq('multipolygon', W.parse('MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5)))').coordinates.length, 2);
eq('geometry collection', W.parse('GEOMETRYCOLLECTION (POINT (1 2), LINESTRING (0 0, 1 1))').geometries.map(g => g.type), ['Point', 'LineString']);
eq('ZM and scientific notation', W.parse('LINESTRING ZM (1e1 2.5E-1 3 4, -1 -2 0 0)').coordinates, [[10, 0.25], [-1, -2]]);
eq('empty', W.parse('POLYGON EMPTY'), { type: 'Polygon', coordinates: [] });
throws('other SRID refused', () => W.parse('SRID=2193;POINT (1570000 5180000)'), /SRID 4326/);
throws('latitude out of range', () => W.parse('POINT (-43.5 172.6)'), /out of range/);
throws('trailing text', () => W.parse('POINT (1 2) extra'), /Unexpected text/);
throws('unknown type', () => W.parse('CIRCLE (1 2 3)'), /geometry type/);
eq('detects WKT', [W.looksLikeWKT(' polygon((0 0,1 0,1 1,0 0))'), W.looksLikeWKT('{"type":"Point"}')], [true, false]);
// write -> read gives back the same geometry, for every type
const samples = [
  { type: 'Point', coordinates: [172.63, -43.53] },
  { type: 'MultiPoint', coordinates: [[1, 2], [3, 4]] },
  { type: 'LineString', coordinates: [[170, 10], [180, 12]] },
  { type: 'MultiLineString', coordinates: [[[170, 10], [180, 12]], [[-180, 12], [-170, 14]]] },
  { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6], [5, 5]]]] },
  { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1, 2] }, { type: 'LineString', coordinates: [[0, 0], [1, 1]] }] }
];
samples.forEach(g => eq('round trip ' + g.type, W.parse(W.stringify(g)), g));
eq('8 decimals', W.stringify({ type: 'Point', coordinates: [172.123456789123, -43.000000001] }), 'POINT (172.12345679 -43)');
console.log(fail ? `${pass} passed, ${fail} failed` : `ALL PASS  (${pass} passed)`);
process.exit(fail ? 1 : 0);
