#!/usr/bin/env node
/*
  tests/geojson-export.test.js — js/features/geojson-export.js against
  GeographicLib (WP1.5 acceptance, kept as a test). Needs geographiclib-geodesic.
*/
'use strict';
const path = require('path');
const G = require(path.join(__dirname, '..', 'js/features/geojson-export.js'));
let gl = require('geographiclib-geodesic'); if (!gl.Geodesic && gl.geodesic) gl = gl.geodesic;
const geod = gl.Geodesic.WGS84;
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) pass++; else { fail++; console.log('FAIL ' + name + (detail ? ': ' + detail : '')); } }

// Densified geodesic edge stays within 1 m of the true geodesic (Wellington -> Sydney).
{
  const p = [-41.2865, 174.7762], q = [-33.8688, 151.2093];
  const seq = G._densify(geod, [p, q], null, false, 1);
  let worst = 0;
  for (let i = 0; i < seq.length - 1; i++) {
    const a = seq[i], b = seq[i + 1], c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const sub = geod.InverseLine(a[0], a[1], b[0], b[1]);
    const f = u => { const r = sub.Position(sub.s13 * u); return geod.Inverse(c[0], c[1], r.lat2, r.lon2).s12; };
    let lo = 0, hi = 1; for (let k = 0; k < 60; k++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (f(m1) < f(m2)) hi = m2; else lo = m1; }
    worst = Math.max(worst, f((lo + hi) / 2));
  }
  check('geodesic densified to 1 m', worst < 1, 'worst ' + worst.toFixed(3) + ' m');
  check('original vertices kept', seq[0][0] === p[0] && seq[seq.length - 1][0] === q[0]);
}
// Rhumb: constant azimuth along the densified line.
{
  const seq = G._densify(geod, [[47.0, 2.0], [47.9, 3.3]], ['R'], false, 1);
  const az = []; for (let i = 0; i < seq.length - 1; i++) az.push(geod.Inverse(seq[i][0], seq[i][1], seq[i + 1][0], seq[i + 1][1]).azi1);
  check('rhumb has constant azimuth', Math.max(...az) - Math.min(...az) < 0.001);
}
// Shapes: type, antimeridian split, poles, circle, groups.
function build(parts) { return G.build(JSON.parse(JSON.stringify(parts)), { geod, toleranceM: 1 }).features[0]; }
function ccw(ring) { let a = 0; for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return a > 0; }
function within(f) { return JSON.stringify(f.geometry.coordinates).match(/-?\d+(\.\d+)?/g).length > 0; }
{
  const f = build([{ kind: 'polygon', coords: [[-16, 177], [-16, -178], [-19, -178], [-19, 177], [-16, 177]] }]);
  check('180° crossing -> MultiPolygon', f.geometry.type === 'MultiPolygon' && f.geometry.coordinates.length === 2);
  check('split pieces anticlockwise', f.geometry.coordinates.every(p => ccw(p[0])));
  check('all longitudes within ±180', f.geometry.coordinates.flat(2).every(c => Math.abs(c[0]) <= 180));
}
{
  const f = build([{ kind: 'polygon', coords: [[-10, 178], [-10, -178], [-11, -178], [-11, 179], [-12, 179], [-12, -178], [-13, -178], [-13, 178], [-10, 178]] }]);
  check('C-shape crossing 180° twice', f.geometry.type === 'MultiPolygon' && f.geometry.coordinates.length >= 2);
}
{
  const f = build([{ kind: 'polygon', coords: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360].map(l => [80, ((l + 180) % 360) - 180]) }]);
  check('polar cap -> one Polygon through the North Pole', f.geometry.type === 'Polygon' && /north/.test(f.properties.pole_enclosed || ''));
}
{
  const f = build([{ kind: 'circle', center: [-43.53, 172.63], radius: 10000 }]);
  check('10 km circle has >= 64 vertices', f.properties.circle_vertices >= 64 && f.geometry.coordinates[0].length > 64);
}
{
  const f = build([{ kind: 'polygon', coords: [[0, 0], [0, 1], [1, 1], [0, 0]] }, { kind: 'line', coords: [[2, 2], [3, 3]] }, { kind: 'point', coords: [[5, 5]] }]);
  check('mixed groups -> GeometryCollection', f.geometry.type === 'GeometryCollection' && f.geometry.geometries.length === 3);
}
{
  const f = build([{ kind: 'line', coords: [[10, 170], [12, -170], [14, -160]] }]);
  check('line crossing 180° -> MultiLineString', f.geometry.type === 'MultiLineString');
}
console.log(fail ? `${pass} passed, ${fail} failed` : `ALL PASS  (${pass} passed)`);
process.exit(fail ? 1 : 0);
