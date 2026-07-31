/*
  sky-coord-bridge.test.js — run: node sky-coord-bridge.test.js

  Reproduces the real bridge, including the trap that broke it:

    index.html:  let currentCardCoord = null;      <- LEXICAL, not window.*
    main.js:     global.currentCardCoord = coord;  <- writes a DIFFERENT variable

  The mock below mirrors that exactly, so a fix that only touches AppState fails
  this test the way it failed in the app.
*/
'use strict';
var { JSDOM } = require('jsdom');
var fs = require('fs');

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }

var dom = new JSDOM('<!doctype html><body><div id="mapWrap" style="position:relative">' +
  '<div id="mapContainerMobile"></div></div><div id="skyPanelMount"></div></body>',
  { pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://geosonify.test/' });
var w = dom.window;
global.window = w; global.document = w.document; global.ResizeObserver = w.ResizeObserver;
w.showToast = function () {};

// ── the inline script's world: a LEXICAL variable, exactly as index.html has it
var inline = (function () {
  var currentCardCoord = null;          // let, at top level of a classic script
  var renders = 0;
  return {
    onCoordChange: function (lat, lon) { currentCardCoord = { lat: lat, lon: lon }; },
    renderCards: function () { renders++; },
    read: function () { return currentCardCoord; },
    renders: function () { return renders; }
  };
})();

// ── card-renderer's world
w.CardRenderer = {
  _coord: null,
  setCoordinate: function (lat, lon) {
    this._coord = { lat: lat, lon: lon };
    inline.onCoordChange(lat, lon);     // the callback that actually works
    inline.renderCards();
  },
  getPassphrase: function () { return ''; },
  isObfuscated: function () { return false; }
};

// ── main.js's broken bridge: writes window.currentCardCoord, not the lexical one
w.__appstate = { coordinate: { lat: -43.5, lon: 172.6 } };
w.AppState = {
  get: function (k) { return k === 'coordinate' ? w.__appstate.coordinate : null; },
  set: function (k, v) {
    w.__appstate[k] = v;
    if (k === 'coordinate') { w.currentCardCoord = v; }   // the trap, faithfully
  },
  subscribe: function () { return function () {}; }
};
w.GISGrids = { SCHEMES: { mgrs: {}, pluscode: {} } };

var files = ['geosonify-healpix.js', 'geosonify-sky.js', 'geosonify-sky-panel.js',
             'geosonify-sky-overlay.js', 'geosonify-sky-renderer.js', 'geosonify-sky-view.js'];
w.eval(files.map(function (f) { return fs.readFileSync(f, 'utf8'); }).join('\n;\n'));

head('the trap itself');
w.AppState.set('coordinate', { lat: 10, lon: 20 });
ok('AppState.set does NOT reach the lexical variable', inline.read() === null,
   JSON.stringify(inline.read()));
ok('it wrote a separate window property instead', w.currentCardCoord.lat === 10);

head('pushCoordinate uses the path that works');
w.GeosonifySkyView.open();
var before = inline.renders();
var pushed = w.GeosonifySkyView.pushCoordinate(-43.5554, 279.2347);   // Vega-ish
ok('reported success', pushed === true);
ok('lexical variable updated', inline.read() !== null && Math.abs(inline.read().lat + 43.5554) < 1e-9,
   JSON.stringify(inline.read()));
ok('RA folded into [-180,180] for longitude', Math.abs(inline.read().lon - (279.2347 - 360)) < 1e-9,
   String(inline.read().lon));
ok('cards were re-rendered', inline.renders() === before + 1,
   before + ' -> ' + inline.renders());
ok('AppState kept coherent too', w.__appstate.coordinate.lat === -43.5554);

head('RA below 180 is passed through unchanged');
w.GeosonifySkyView.pushCoordinate(12.5, 172.65);
ok('longitude unchanged', Math.abs(inline.read().lon - 172.65) < 1e-9, String(inline.read().lon));
ok('declination became latitude', Math.abs(inline.read().lat - 12.5) < 1e-9);

head('degrades safely');
var savedCR = w.CardRenderer;
w.CardRenderer = undefined;
ok('still succeeds via AppState alone', w.GeosonifySkyView.pushCoordinate(1, 2) === true);
w.CardRenderer = savedCR;
var savedAS = w.AppState;
w.AppState = undefined;
ok('still succeeds via CardRenderer alone', w.GeosonifySkyView.pushCoordinate(3, 4) === true);
ok('and it reached the cards', Math.abs(inline.read().lat - 3) < 1e-9);
w.AppState = savedAS;

w.GeosonifySkyView.close();
console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
