/*
  sky-provenance.test.js — run: node sky-provenance.test.js

  "Click regions with the accuracy provenance appropriate to the zoom level."
  These gates are that sentence, made checkable.
*/
'use strict';
var fs = require('fs'); var { JSDOM } = require('jsdom');
var Sky = require('./geosonify-sky.js'); var HP = require('./geosonify-healpix.js');
Sky.setEngine(HP);
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }

head('a click never justifies more than its pixel');
[[60, 640, 1], [1, 640, 1], [1 / 60, 640, 1], [1 / 3600, 640, 1]].forEach(function (c) {
  var p = Sky.clickProvenance(c[0], c[1], c[2]);
  var cell = Sky.cellSize(p.order).arcsec;
  ok('fov ' + c[0] + ' deg: cell (' + Sky.cellSize(p.order).text + ') >= click accuracy (' + p.text + ')',
     cell >= p.arcsec, cell + ' vs ' + p.arcsec);
});

head('orderForAngle is conservative, never optimistic');
[0.05, 1, 51.5, 3600].forEach(function (a) {
  var k = Sky.orderForAngle(a);
  ok(a + '" -> order ' + k + ' whose cell is coarser or equal', Sky.cellSize(k).arcsec >= a,
     Sky.cellSize(k).arcsec + ' vs ' + a);
  ok('  and one order finer would be too fine', Sky.cellSize(k + 1).arcsec < a);
});

head('zoom changes what a click justifies');
var wide = Sky.clickProvenance(60, 640, 1), tight = Sky.clickProvenance(0.01, 640, 1);
ok('tighter zoom justifies a deeper order', tight.order > wide.order, wide.order + ' -> ' + tight.order);
ok('a 6000x zoom buys about 12 orders', tight.order - wide.order === 12, String(tight.order - wide.order));

head('a fingertip is worth less than a mouse');
var mouse = Sky.clickProvenance(1, 640, 1), finger = Sky.clickProvenance(1, 640, 10);
ok('10px pointer justifies a coarser order', finger.order < mouse.order, mouse.order + ' vs ' + finger.order);
ok('by about 3 orders (10x is ~2^3.3)', mouse.order - finger.order === 4, String(mouse.order - finger.order));

head('over-claiming is reported, not prevented');
ok('claiming the justified order is fine', Sky.overclaims(mouse.order, mouse) === null);
ok('claiming coarser is fine', Sky.overclaims(mouse.order - 3, mouse) === null);
var over = Sky.overclaims(mouse.order + 5, mouse);
ok('claiming finer is flagged', !!over);
ok('with the factor stated', over.factor === 32, String(over.factor));
ok('and readable text', /32\u00d7 finer/.test(over.text), over.text);

head('the view uses it');
var dom = new JSDOM('<!doctype html><body><div id="mapWrap" style="position:relative">' +
  '<div id="mapContainerMobile"></div></div><div id="skyPanelMount"></div></body>',
  { pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://geosonify.test/' });
var w = dom.window;
global.window = w; global.document = w.document; global.ResizeObserver = w.ResizeObserver;
w.showToast = function () {};
w.__state = {};
w.AppState = { get: function (k) { return w.__state[k] || (k === 'coordinate' ? { lat: -43.5, lon: 172.6 } : null); },
               set: function (k, v) { w.__state[k] = v; }, subscribe: function () { return function () {}; } };
w.CardRenderer = { setCoordinate: function () {}, getPassphrase: function () { return ''; }, isObfuscated: function () { return false; } };
w.GISGrids = { SCHEMES: { mgrs: {} } };
w.eval(['geosonify-healpix.js','geosonify-sky.js','geosonify-sky-panel.js','geosonify-sky-overlay.js',
        'geosonify-sky-renderer.js','geosonify-sky-view.js']
  .map(function (f) { return fs.readFileSync(f, 'utf8'); }).join('\n;\n'));

w.GeosonifySkyView.open({ fovDeg: 60 });
ok('no provenance before the first click', w.GeosonifySkyView.getProvenance() === null);
ok('order is not manual yet', !w.GeosonifySkyView.isOrderManual());

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
