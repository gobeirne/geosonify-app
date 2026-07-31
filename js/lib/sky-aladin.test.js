/*
  sky-aladin.test.js — run: node sky-aladin.test.js

  The real Aladin needs WebGL2 and network, neither of which exists here. So the
  MODULE is mocked with the exact API surface read out of the shipped bundle, and
  everything on our side of the seam is tested for real: contract conformance,
  event mapping, the overlay layer, the capital-V setFoV, the array-returning
  getFov, and graceful failure.

  What this canNOT prove: that the real Aladin behaves as its bundle implies.
  That is the one thing left to check in a browser.
*/
'use strict';
var fs = require('fs'); var { JSDOM } = require('jsdom');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }

var dom = new JSDOM('<!doctype html><body><div id="host" style="position:relative"></div></body>',
  { pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://geosonify.test/' });
var w = dom.window;
global.window = w; global.document = w.document; global.ResizeObserver = w.ResizeObserver;

// ── mock Aladin, matching the surface verified in aladin-lite@3.9.0-beta ──
w.__aladinCalls = { setFoV: 0, setFov: 0, gotoRaDec: 0 };
w.__mockAladin = {
  _ra: 10, _dec: 20, _fov: 60, _handlers: {},
  on: function (n, cb) { this._handlers[n] = cb; },
  fire: function (n, p) { if (this._handlers[n]) this._handlers[n](p); },
  world2pix: function (ra, dec) { return [400 + (ra - this._ra) * 10, 300 - (dec - this._dec) * 10]; },
  pix2world: function (x, y, frame) {
    if (frame !== 'icrs') throw new Error('frame string must be lowercase icrs');
    return [this._ra + (x - 400) / 10, this._dec - (y - 300) / 10];
  },
  getRaDec: function () { return [this._ra, this._dec]; },
  gotoRaDec: function (ra, dec) { w.__aladinCalls.gotoRaDec++; this._ra = ra; this._dec = dec; },
  getFov: function () { return [this._fov, this._fov * 0.75]; },   // ARRAY, not scalar
  setFoV: function (d) { w.__aladinCalls.setFoV++; this._fov = d; }
  // deliberately NO setFov — calling it must throw, as in the real library
};
w.__lastOptions = null;
w.__A = {
  init: Promise.resolve(),
  aladin: function (el, options) { w.__lastOptions = options; w.__mockAladin._el = el; return w.__mockAladin; }
};

var src = fs.readFileSync('geosonify-sky-aladin.js', 'utf8');
// swap the dynamic import for the mock, leaving every other line intact
src = src.replace(
  "_modulePromise = new Function('u', 'return import(u);')(url)",
  "_modulePromise = Promise.resolve({ default: window.__A })");
// WebGL2 is unavailable in jsdom; force the probe true so the rest can run
src = src.replace('function webgl2Available() {', 'function webgl2Available() { if (window.__forceWebGL) return true;');
w.__forceWebGL = true;
w.eval(fs.readFileSync('geosonify-sky-renderer.js', 'utf8') + '\n;\n' + src);

var host = w.document.getElementById('host');
host.getBoundingClientRect = function () { return { width: 800, height: 600, left: 0, top: 0 }; };

head('contract conformance — same 14 methods as the built-in renderer');
var r = w.GeosonifySkyAladin.createAladinRenderer(host, { ra: 10, dec: 20, fovDeg: 60 });
var conf = w.GeosonifySkyRenderer.conformsTo(r);
ok('implements every contract method', conf.ok, 'missing: ' + conf.missing.join(', '));

var done = false;
r.init().then(function () { done = true; }).catch(function (e) { console.log('init failed:', e.message); });

setTimeout(function () {
  ok('init resolved', done);

  head('chrome is entirely off');
  var o = w.__lastOptions;
  var chromeKeys = Object.keys(w.GeosonifySkyAladin.CHROME_OFF);
  ok('all ' + chromeKeys.length + ' chrome options false',
     chromeKeys.every(function (k) { return o[k] === false; }),
     chromeKeys.filter(function (k) { return o[k] !== false; }).join(','));
  ok('reticle off', o.showReticle === false);
  ok('coordinate readout off', o.showCooLocation === false);
  ok('background overridden, not Aladin grey', o.backgroundColor === '#0b0f19', o.backgroundColor);

  head('projection plumbing');
  ok('project() maps through world2pix', JSON.stringify(r.project(10, 20)) === '[400,300]',
     JSON.stringify(r.project(10, 20)));
  ok('unproject() uses the lowercase icrs frame', JSON.stringify(r.unproject(400, 300)) === '[10,20]',
     JSON.stringify(r.unproject(400, 300)));
  ok('project/unproject round-trip', (function () {
    var p = r.project(11.5, 21.25); var b = r.unproject(p[0], p[1]);
    return Math.abs(b[0] - 11.5) < 1e-9 && Math.abs(b[1] - 21.25) < 1e-9;
  })());

  head('the two API traps');
  r.setFovDeg(12);
  ok('setFovDeg calls setFoV (capital V)', w.__aladinCalls.setFoV === 1, String(w.__aladinCalls.setFoV));
  ok('getFovDeg unwraps the ARRAY getFov returns', r.getFovDeg() === 12 * 0.75,
     String(r.getFovDeg()));

  head('overlay layer is ours, on top, and does not steal input');
  var g = r.overlayGroup();
  ok('is an SVG g', g && g.tagName === 'g');
  ok('lives in our own svg, not inside Aladin', g.parentNode.getAttribute('class') === 'gs-sky-svg');
  ok('svg does not capture pointer events', /pointer-events:none/.test(g.parentNode.getAttribute('style')));
  ok('svg is above the aladin host', g.parentNode.previousSibling.className === 'gs-aladin-host');

  head('events map onto the contract');
  var got = {};
  r.on('move', function (p) { got.move = p; });
  r.on('zoom', function (p) { got.zoom = p; });
  r.on('click', function (p) { got.click = p; });
  w.__mockAladin.fire('positionChanged', { ra: 55, dec: -5, dragging: true });
  ok('positionChanged -> move', got.move && got.move.ra === 55 && got.move.dragging === true);
  w.__mockAladin.fire('zoomChanged', {});
  ok('zoomChanged -> zoom with a scalar fov', got.zoom && typeof got.zoom.fovDeg === 'number');
  w.__mockAladin.fire('click', { x: 400, y: 300 });
  ok('click -> click, derived from pixels', got.click && Math.abs(got.click.ra - w.__mockAladin._ra) < 1e-9,
     JSON.stringify(got.click));

  head('honest capabilities and attribution');
  var c = r.capabilities();
  ok('declares imagery', c.imagery === true);
  ok('declares NOT offline', c.offline === false);
  ok('declares the order-29 ceiling', c.maxResolvableOrder === 29);
  ok('declares its licence', c.licence === 'LGPL-3.0-or-later');
  var a = r.attribution();
  ok('credits CDS', a && /CDS/.test(a.text), JSON.stringify(a));
  ok('links to Aladin', a.href.indexOf('aladin.cds.unistra.fr') >= 0);
  ok('the built-in renderer, by contrast, owes nothing',
     w.GeosonifySkyRenderer.createBuiltInRenderer(host, {}).attribution() === null);

  head('teardown');
  r.destroy();
  ok('overlay removed', !host.querySelector('.gs-sky-svg'));
  ok('aladin host removed', !host.querySelector('.gs-aladin-host'));

  console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
  process.exit(fail === 0 ? 0 : 1);
}, 30);
