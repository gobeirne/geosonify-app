/*
  geosonify-sky-renderer.selftest.js — run: node geosonify-sky-renderer.selftest.js
  Needs jsdom (npm i jsdom), plus geosonify-sky.js and geosonify-healpix.js.

  Runs the real DOM code under jsdom, so the built-in renderer is exercised as
  written rather than as imagined. SVG is real DOM in jsdom; only rasterisation
  is missing, and nothing here depends on pixels being painted.

  Gates:
    1  the built-in renderer satisfies the renderer contract
    2  project/unproject are true inverses
    3  the far hemisphere is culled
    4  handedness is correct -- east is LEFT
    5  zoom changes scale as expected and is clamped
    6  panning moves the centre and fires events
    7  DOM is built and torn down cleanly
    8  the overlay group is a real SVG <g> our paths can go into
    9  end to end: a HEALPix cell renders into the overlay as an SVG path
*/
'use strict';

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }

var JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch (e) { console.log('jsdom not installed: npm i jsdom'); process.exit(1); }

var dom = new JSDOM('<!doctype html><div id="sky" style="width:800px;height:600px"></div>', {
  pretendToBeVisual: true
});
global.window = dom.window;
global.document = dom.window.document;
global.ResizeObserver = dom.window.ResizeObserver;

// jsdom does not lay out, so give the container a size the renderer can read
var container = document.getElementById('sky');
container.getBoundingClientRect = function () { return { width: 800, height: 600, left: 0, top: 0 }; };

var Renderer = require('./geosonify-sky-renderer.js');
var Overlay = require('./geosonify-sky-overlay.js');
var Sky = require('./geosonify-sky.js');
var HP = require('./geosonify-healpix.js');
Sky.setEngine(HP);

head('1  contract conformance');
var r = Renderer.createBuiltInRenderer(container, { ra: 180, dec: -40, fovDeg: 60 });
var conf = Renderer.conformsTo(r);
ok('implements every contract method', conf.ok, 'missing: ' + conf.missing.join(', '));
ok('contract has the expected surface', Renderer.CONTRACT.length === 14, String(Renderer.CONTRACT.length));
r.init();
ok('reports its capabilities honestly', (function () {
  var c = r.capabilities();
  return c.offline === true && c.imagery === false && c.handedness === 'sky';
})(), JSON.stringify(r.capabilities()));
ok('claims no attribution (nothing borrowed)', r.attribution() === null);

head('2  project / unproject are inverses');
var worst = 0;
for (var i = 0; i < 2000; i++) {
  var ra = 180 + (Math.random() - 0.5) * 50;
  var dec = -40 + (Math.random() - 0.5) * 50;
  var p = r.project(ra, dec);
  if (!p) continue;
  var back = r.unproject(p[0], p[1]);
  if (!back) { worst = 999; break; }
  var d = Sky.separationDeg(ra, dec, back[0], back[1]) * 3600;
  if (d > worst) worst = d;
}
ok('round-trip within 1 milliarcsec', worst < 0.001, worst.toExponential(3) + ' arcsec');

head('3  far hemisphere culled');
ok('antipode is null', r.project(0, 40) === null);
ok('90 deg away is null or on the limb', (function () {
  var p = r.project(180, 50);   // 90 deg from dec -40
  return p === null || Math.abs(Math.hypot(p[0] - 400, p[1] - 300)) > 100;
})());
ok('centre projects to the middle', (function () {
  var p = r.project(180, -40);
  return Math.abs(p[0] - 400) < 0.5 && Math.abs(p[1] - 300) < 0.5;
})(), JSON.stringify(r.project(180, -40)));

head('4  handedness: east is LEFT');
/*
  Increasing RA is east. Seen from inside the celestial sphere with north up,
  east appears to the LEFT -- the mirror of an Earth map. This is the single
  most common bug in home-grown sky views, so it gets its own gate.
*/
var pC = r.project(180, -40);
var pE = r.project(180.5, -40);          // half a degree east
var pN = r.project(180, -39.5);          // half a degree north
ok('east decreases screen x', pE[0] < pC[0], 'east x=' + pE[0].toFixed(1) + ' centre x=' + pC[0].toFixed(1));
ok('north decreases screen y (up)', pN[1] < pC[1], 'north y=' + pN[1].toFixed(1) + ' centre y=' + pC[1].toFixed(1));

head('5  zoom');
var before = r.project(180.5, -40);
r.setFovDeg(30);
var after = r.project(180.5, -40);
var d0 = Math.abs(before[0] - 400), d1 = Math.abs(after[0] - 400);
/*
  Orthographic scale is (minDim/2) / sin(fov/2), so halving the field of view
  does NOT double the scale -- it multiplies it by sin(30)/sin(15) = 1.93185.
  Doubling is only the small-angle limit. Asserting 2 here would be asserting a
  bug into existence.
*/
var expected = Math.sin(30 * Math.PI / 180) / Math.sin(15 * Math.PI / 180);
ok('60->30 deg scales by sin(30)/sin(15) = 1.9319', Math.abs(d1 / d0 - expected) < 1e-3,
   (d1 / d0).toFixed(5) + ' vs ' + expected.toFixed(5));
// and it does approach 2 when the angles are small
r.setFovDeg(0.2); var s0 = Math.abs(r.project(180.001, -40)[0] - 400);
r.setFovDeg(0.1); var s1 = Math.abs(r.project(180.001, -40)[0] - 400);
ok('small-angle limit approaches 2', Math.abs(s1 / s0 - 2) < 0.001, (s1 / s0).toFixed(5));
r.setFovDeg(30);
r.setFovDeg(1e9); ok('fov clamps at 180', r.getFovDeg() === 180, String(r.getFovDeg()));
r.setFovDeg(0);   ok('fov clamps above zero', r.getFovDeg() > 0 && r.getFovDeg() < 1e-6, String(r.getFovDeg()));
r.setFovDeg(60);

head('6  panning and events');
var moves = 0, zooms = 0;
var onMove = function () { moves++; };
r.on('move', onMove);
r.on('zoom', function () { zooms++; });
r.setCenter(190, -35);
ok('setCenter updates the centre', Math.abs(r.getCenter()[0] - 190) < 1e-9 && Math.abs(r.getCenter()[1] + 35) < 1e-9,
   JSON.stringify(r.getCenter()));
ok('move event fired', moves === 1, String(moves));
r.setFovDeg(45);
ok('zoom event fired', zooms === 1, String(zooms));
r.off('move', onMove);
r.setCenter(191, -35);
ok('off() unsubscribes', moves === 1, String(moves));
ok('declination clamps at the pole', (function () { r.setCenter(0, 95); return r.getCenter()[1] < 90; })(),
   String(r.getCenter()[1]));
ok('RA wraps into [0,360)', (function () { r.setCenter(-30, 0); return Math.abs(r.getCenter()[0] - 330) < 1e-9; })(),
   String(r.getCenter()[0]));

head('7  DOM lifecycle');
ok('svg was created', container.querySelectorAll('svg').length === 1);
ok('grid was drawn', container.querySelectorAll('.gs-sky-grid path').length > 4,
   String(container.querySelectorAll('.gs-sky-grid path').length) + ' grid paths');
ok('background rect sized to the container', (function () {
  var bg = container.querySelector('.gs-sky-bg');
  return bg.getAttribute('width') === '800' && bg.getAttribute('height') === '600';
})());
ok('getSize reports the container', r.getSize().width === 800 && r.getSize().height === 600,
   JSON.stringify(r.getSize()));

head('8  overlay group');
var g = r.overlayGroup();
ok('is an SVG g element', g && g.tagName === 'g', g && g.tagName);
ok('is inside the svg', g.parentNode.tagName === 'svg');
ok('is drawn last (on top of the grid)', (function () {
  var kids = Array.prototype.slice.call(g.parentNode.childNodes);
  return kids.indexOf(g) === kids.length - 1;
})());

head('9  end to end: a real HEALPix cell into the overlay');
r.setCenter(172.650913, -43.555444);
r.setFovDeg(0.5);
var deepIpix = HP.nestIndex(-43.555444, 172.650913, 16);
var chain = Sky.ancestry(16, deepIpix, { fromOrder: 8 });
function boundaryOf(cell) {
  return Sky.cellBoundary(cell.order, cell.ipix, { step: 6, close: true, frame: 'sky' });
}
var picked = Overlay.pickVisible(chain, boundaryOf, r.project, { viewport: r.getSize() });
ok('some orders are legible at this zoom', picked.draw.length > 0, String(picked.draw.length));
ok('deeper orders reported sub-pixel', picked.subPixel.length > 0, String(picked.subPixel.length));

picked.draw.forEach(function (entry) {
  var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', Overlay.ringToPath(entry.projected));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#dc2626');
  g.appendChild(path);
});
ok('cells rendered into the overlay group', g.childNodes.length === picked.draw.length,
   g.childNodes.length + ' paths');
ok('every path has real geometry', Array.prototype.every.call(g.childNodes, function (n) {
  var d = n.getAttribute('d');
  return d && d.indexOf('M') === 0 && d.indexOf('NaN') === -1 && d.length > 20;
}));
console.log('        ' + Overlay.legibility(picked, 16));
console.log('        deepest drawn: order ' + picked.deepest.cell.order +
            ' at ' + picked.deepest.px.toFixed(1) + ' px (' + picked.deepest.cell.sizeText + ')');

head('teardown');
r.destroy();
ok('svg removed', container.querySelectorAll('svg').length === 0);
ok('destroy is idempotent', (function () { try { r.destroy(); return true; } catch (e) { return false; } })());

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
