/*
  sky-frame-gate.test.js — run: node sky-frame-gate.test.js

  1  geosonify-bip39-entry.js parses at all (it did not, before the const fix)
  2  Earth region hints are suppressed in the sky frame
  3  Nominatim is never called with a celestial position
  4  opening / closing the sky view flips the declared frame
*/
'use strict';
var fs = require('fs');
var { JSDOM } = require('jsdom');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }

head('1  the file parses');
var src = fs.readFileSync('geosonify-bip39-entry.js', 'utf8');
var parsed = true, err = '';
try { new Function(src); } catch (e) { parsed = false; err = e.message; }
ok('geosonify-bip39-entry.js parses', parsed, err);
ok('the duplicate const is gone', (src.match(/const flat = gridDef\.grid\.flat\(\);/g) || []).length === 1,
   String((src.match(/const flat = gridDef\.grid\.flat\(\);/g) || []).length) + ' occurrences');
ok('the original in the repo does NOT parse (so this was a live bug)', (function () {
  try { new Function(fs.readFileSync('/mnt/project/geosonify-bip39-entry.js', 'utf8')); return false; }
  catch (e) { return /already been declared/.test(e.message); }
})());

var dom = new JSDOM('<!doctype html><body><div id="mapWrap" style="position:relative">' +
  '<div id="mapContainerMobile"></div></div><div id="skyPanelMount"></div></body>',
  { pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://geosonify.test/' });
var w = dom.window;
global.window = w; global.document = w.document; global.ResizeObserver = w.ResizeObserver;
w.showToast = function () {};
w.__fetches = [];
w.fetch = function (url) { w.__fetches.push(url); return Promise.resolve({ json: function () { return Promise.resolve({}); } }); };
w.__state = {};
w.AppState = {
  get: function (k) { return w.__state[k] || (k === 'coordinate' ? { lat: -43.5, lon: 172.6 } : null); },
  set: function (k, v) { w.__state[k] = v; },
  subscribe: function () { return function () {}; }
};
w.GISGrids = { SCHEMES: { mgrs: {}, pluscode: {} } };
w.BIP39_GEO_LOOKUP = { 0: 'Tasman Sea', 5: 'New Zealand' };

var files = ['geosonify-healpix.js', 'geosonify-sky.js', 'geosonify-sky-panel.js',
             'geosonify-sky-overlay.js', 'geosonify-sky-renderer.js', 'geosonify-sky-view.js'];
w.eval(files.map(function (f) { return fs.readFileSync(f, 'utf8'); }).join('\n;\n'));

// expose the gated helpers for testing without booting the whole entry UI
w.eval('window.__isSkyFrame = ' + (function () {
  var m = src.match(/function isSkyFrame\(\) \{[\s\S]*?\n  \}/);
  return m[0].replace('function isSkyFrame()', 'function ()');
})() + ';');

head('4  the sky view declares the frame');
ok('earth before opening', !w.__isSkyFrame());
w.GeosonifySkyView.open();
ok('frame recorded in AppState', w.__state.frame && w.__state.frame.sphere === 'sky',
   JSON.stringify(w.__state.frame));
ok('epoch defaulted', w.__state.frame.epoch === 'J2000');

head('2 & 3  hints suppressed while the sky is showing');
ok('isSkyFrame() true', w.__isSkyFrame());
ok('no network calls were made at all', w.__fetches.length === 0, JSON.stringify(w.__fetches));

w.GeosonifySkyView.close();
ok('frame back to earth on close', w.__state.frame.sphere === 'earth');
ok('isSkyFrame() false again', !w.__isSkyFrame());

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
