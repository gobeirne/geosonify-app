/*
  geosonify-starpin-flip_selftest.js — run: node geosonify-starpin-flip_selftest.js
  Needs geosonify-starpin.js and geosonify-sky-renderer.js alongside (and jsdom
  for gate 3, which drives the real built-in renderer).

  The browser half -- the turn, Aladin, the round trips -- is in
  starpin-flip_browsertest.py, because it needs a real WebGL2 page. This file
  holds the maths that half depends on:

    1  one scale, both ways: zoom <-> arcsec per px, and 30.92 m per arcsec
    2  the tangent plane: forward and inverse are true inverses; east is LEFT
    3  the affine read from a live renderer reproduces renderer.project()
    4  scale bar, tiers and the survey floor say what they should
    5  Overpass parsing keeps what it should and drops what it should
    6  reachability: near / none / unknown, and never "none" from coarse data
*/
'use strict';
var F = require('./geosonify-starpin-flip.js');
var S = require('./geosonify-starpin.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }

var LAT = -43.5309, LON = 172.6365;

head('1  one scale, both ways');
ok('zoom -> arcsec/px -> zoom is exact at -43.5', Math.abs(F.zoomForAsp(F.aspForZoom(16.37, LAT), LAT) - 16.37) < 1e-12);
ok('a zoom level is a factor of two', Math.abs(F.aspForZoom(15, LAT) / F.aspForZoom(16, LAT) - 2) < 1e-12);
ok('the equator shows more sky per pixel than Christchurch, by 1/cos(lat)',
   Math.abs(F.aspForZoom(16, 0) / F.aspForZoom(16, LAT) - 1 / Math.cos(LAT * Math.PI / 180)) < 1e-12);
var sb = F.scaleBar(0.2667, 88);
ok('scale bar: 16" is 500 m', sb.mLabel === '500 m' && sb.arcLabel === '16\u2033', sb.mLabel + ' / ' + sb.arcLabel);
ok('...using the engine\'s 30.92 m per arcsec', Math.abs(sb.metres / sb.arcsec - S.M_PER_ARCSEC) < 1e-9);

head('2  the tangent plane');
var worst = 0;
for (var i = 0; i < 500; i++) {
  var xi = (Math.random() - 0.5) * 0.02, eta = (Math.random() - 0.5) * 0.02;
  var rd = F.fromTangent(LON, LAT, xi, eta);
  var t = F.tangentOf(LON, LAT)(rd[1], rd[0]);
  worst = Math.max(worst, Math.abs(t[0] - xi), Math.abs(t[1] - eta));
}
ok('fromTangent and tangentOf are inverses (worst ' + worst.toExponential(1) + ' rad)', worst < 1e-14);
var P = F.skyProjector(LON, LAT, 0.25, 400, 800);
ok('east is LEFT on the sky', P(LAT, LON + 0.001)[0] < 200);
ok('north is UP', P(LAT + 0.001, LON)[1] < 400);
ok('the far hemisphere is null', F.tangentOf(LON, LAT)(-LAT, LON + 180) === null);
ok('1" of declination is 1/asp px', Math.abs((400 - P(LAT + 1 / 3600, LON)[1]) - 4) < 1e-6,
   String(400 - P(LAT + 1 / 3600, LON)[1]));

head('3  the affine read from a live renderer');
var R = null;
try {
  var JSDOM = require('jsdom').JSDOM;
  var dom = new JSDOM('<!doctype html><div id="s"></div>', { pretendToBeVisual: true });
  global.window = dom.window; global.document = dom.window.document;
  global.ResizeObserver = dom.window.ResizeObserver;
  R = require('./geosonify-sky-renderer.js');
} catch (e) { console.log('  (skipped: ' + e.message + ')'); }
if (R) {
  var host = document.getElementById('s');
  host.getBoundingClientRect = function () { return { width: 390, height: 844, left: 0, top: 0 }; };
  var r = R.createBuiltInRenderer(host, { ra: LON, dec: LAT, fovDeg: 0.03 });
  r.init();
  // The same three calls the module makes.
  var e = r.getFovDeg() * Math.PI / 180 * 0.05, c = r.getCenter();
  var p0 = r.project(c[0], c[1]);
  var pe = r.project.apply(null, F.fromTangent(c[0], c[1], e, 0));
  var pn = r.project.apply(null, F.fromTangent(c[0], c[1], 0, e));
  var A = { ax: (pe[0] - p0[0]) / e, ay: (pe[1] - p0[1]) / e, bx: (pn[0] - p0[0]) / e, by: (pn[1] - p0[1]) / e };
  var T = F.tangentOf(c[0], c[1]), wd = 0;
  for (var k = 0; k < 400; k++) {
    var la = LAT + (Math.random() - 0.5) * 0.02, lo = LON + (Math.random() - 0.5) * 0.03;
    var tt = T(la, lo), ours = [p0[0] + tt[0] * A.ax + tt[1] * A.bx, p0[1] + tt[0] * A.ay + tt[1] * A.by];
    var theirs = r.project(lo, la);
    wd = Math.max(wd, Math.abs(ours[0] - theirs[0]), Math.abs(ours[1] - theirs[1]));
  }
  ok('three project() calls reproduce the renderer to ' + wd.toExponential(1) + ' px', wd < 1e-6);
  ok('...and the affine has east on the left, as the renderer does', A.ax < 0);
  r.destroy();
}

head('4  scale bar, tiers and the survey floor');
ok('street view gets full detail', F.tierForView(1200).key === 'A');
ok('suburb view drops paths', F.tierForView(4000).key === 'B' && F.tierForView(4000).classes.indexOf('footway') < 0);
ok('city view keeps only main roads', F.tierForView(12000).key === 'C');
ok('country view draws no streets', F.tierForView(40000) === null);
ok('DSS2 pulls back below 0.267"/px', Math.abs(F.floorAsp(F.SURVEYS[0]) - 0.8 / 3) < 1e-12);
ok('Pan-STARRS admits it stops at -30', F.SURVEYS[1].decMin === -30);

head('5  Overpass parsing');
var ways = F.parseOverpass({ elements: [
  { type: 'way', tags: { highway: 'residential' }, geometry: [{ lat: 1, lon: 2 }, { lat: 1.1, lon: 2.1 }] },
  { type: 'way', tags: { highway: 'primary_link' }, geometry: [{ lat: 1, lon: 2 }, { lat: 1.2, lon: 2 }] },
  { type: 'way', tags: { highway: 'footway' }, geometry: [{ lat: 1, lon: 2 }, { lat: 1, lon: 2.01 }] },
  { type: 'way', tags: { highway: 'proposed' }, geometry: [{ lat: 1, lon: 2 }, { lat: 1, lon: 3 }] },
  { type: 'way', tags: { highway: 'residential' }, geometry: [{ lat: 1, lon: 2 }] },
  { type: 'node', lat: 1, lon: 2 }
] });
ok('keeps three drawable ways', ways.length === 3, String(ways.length));
ok('a _link is its road\'s class', ways[1].cls === 'major');
ok('footways are paths', ways[2].cls === 'path');
ok('bounding boxes are right', ways[0].bb.join() === '1,2,1.1,2.1', ways[0].bb.join());
var q = F.overpassQuery(F.TIERS[1], { s: -43.6, w: 172.5, n: -43.5, e: 172.7 });
ok('the query names the tier\'s classes and the box', /residential/.test(q) && !/footway/.test(q) &&
   q.indexOf('(-43.600000,172.500000,-43.500000,172.700000)') > 0, q);

head('6  reachability says only what the data supports');
var R_M = F.VISIT_R_ARCSEC * S.M_PER_ARCSEC;                 // 92.8 m
var dLat = function (m) { return m / (S.M_PER_ARCSEC * 3600); };
var road = { cls: 'minor', pts: [[LAT + dLat(50), LON - 0.01], [LAT + dLat(50), LON + 0.01]],
             bb: [LAT + dLat(50), LON - 0.01, LAT + dLat(50), LON + 0.01] };
var star = { lat: LAT, lon: LON };
ok('nearestLineM finds the road 50 m north', Math.abs(F.nearestLineM(LAT, LON, [road], 200) - 50) < 0.01,
   String(F.nearestLineM(LAT, LON, [road], 200)));
var boxFull = { tier: F.TIERS[0], s: LAT - 0.05, n: LAT + 0.05, w: LON - 0.05, e: LON + 0.05, ways: [road] };
ok('a road inside the circle -> near', F.reachOf(star, [boxFull]) === 'near');
var farRoad = JSON.parse(JSON.stringify(road));
farRoad.pts.forEach(function (p) { p[0] = LAT + dLat(R_M + 20); });
farRoad.bb[0] = farRoad.bb[2] = LAT + dLat(R_M + 20);
ok('only a road 113 m away, with full detail -> none',
   F.reachOf(star, [{ tier: F.TIERS[0], s: boxFull.s, n: boxFull.n, w: boxFull.w, e: boxFull.e, ways: [farRoad] }]) === 'none');
ok('the same, but only main-road data -> unknown, not none',
   F.reachOf(star, [{ tier: F.TIERS[2], s: boxFull.s, n: boxFull.n, w: boxFull.w, e: boxFull.e, ways: [farRoad] }]) === 'unknown');
ok('coarse data CAN still prove near', F.reachOf(star, [{ tier: F.TIERS[2], s: boxFull.s, n: boxFull.n,
   w: boxFull.w, e: boxFull.e, ways: [road] }]) === 'near');
ok('no data at all -> unknown', F.reachOf(star, []) === 'unknown');
var dateline = { cls: 'minor', pts: [[-17.8, 179.9995], [-17.8, -179.9995]], bb: [-17.8, -179.9995, -17.8, 179.9995] };
ok('a road across the date line is still found', F.nearestLineM(-17.8, 180, [dateline], 200) < 1, 
   String(F.nearestLineM(-17.8, 180, [dateline], 200)));

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
