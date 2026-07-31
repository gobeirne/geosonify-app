/*
  sky-nav-share.test.js — run: node sky-nav-share.test.js
  Covers the navigation and share-URL fixes.
*/
'use strict';
var fs = require('fs'); var { JSDOM } = require('jsdom');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }

var dom = new JSDOM('<!doctype html><body><div id="mapWrap" style="position:relative">' +
  '<div id="mapContainerMobile"></div></div><div id="skyPanelMount"></div></body>',
  { pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://geosonify.test/' });
var w = dom.window;
global.window = w; global.document = w.document; global.ResizeObserver = w.ResizeObserver;
w.showToast = function () {};
w.__state = {};
w.__cards = [];
w.AppState = {
  get: function (k) { return w.__state[k] || (k === 'coordinate' ? { lat: -43.5, lon: 172.6 } : null); },
  set: function (k, v) { w.__state[k] = v; }, subscribe: function () { return function () {}; }
};
w.CardRenderer = {
  setCoordinate: function (lat, lon) { w.__cards.push({ lat: lat, lon: lon }); },
  getPassphrase: function () { return ''; }, isObfuscated: function () { return false; }
};
w.GISGrids = { SCHEMES: { mgrs: {} } };
['geosonify-healpix.js','geosonify-sky.js','geosonify-sky-url.js','geosonify-sky-panel.js',
 'geosonify-sky-overlay.js','geosonify-sky-renderer.js','geosonify-sky-view.js']
  .forEach(function () {});
w.eval(['geosonify-healpix.js','geosonify-sky.js','geosonify-sky-url.js','geosonify-sky-panel.js',
        'geosonify-sky-overlay.js','geosonify-sky-renderer.js','geosonify-sky-view.js']
  .map(function (f) { return fs.readFileSync(f, 'utf8'); }).join('\n;\n'));

head('zoom controls exist and drive the field of view');
w.GeosonifySkyView.open();
var btns = w.document.querySelectorAll('button[aria-label="Zoom in"], button[aria-label="Zoom out"]');
ok('two zoom buttons rendered', btns.length === 2, String(btns.length));
ok('they sit over the canvas, not the page', btns[0].closest('#mapWrap') !== null);

head('goTo moves the cell and tells the app');
var before = w.__cards.length;
var moved = w.GeosonifySkyView.goTo(279.2347, 38.7837);      // Vega
ok('reported success', moved === true);
ok('coordinate pushed to the cards', w.__cards.length === before + 1, String(w.__cards.length));
ok('declination became latitude', Math.abs(w.__cards[w.__cards.length - 1].lat - 38.7837) < 1e-9);
ok('RA folded to longitude', Math.abs(w.__cards[w.__cards.length - 1].lon - (279.2347 - 360)) < 1e-9,
   String(w.__cards[w.__cards.length - 1].lon));

head('frame= is emitted only in the sky frame');
function frameParams() {
  var f = w.AppState.get('frame');
  if (!f || f.sphere !== 'sky') return [];
  var out = w.GeosonifySkyUrl.serialize(f.key, f.epoch || null);
  return Object.keys(out).map(function (k) { return k + '=' + encodeURIComponent(out[k]); });
}
ok('sky frame emits frame=icrs', frameParams().indexOf('frame=icrs') >= 0, JSON.stringify(frameParams()));
ok('and an epoch', frameParams().some(function (p) { return /^epoch=/.test(p); }), JSON.stringify(frameParams()));
w.GeosonifySkyView.close();
ok('earth emits nothing at all', frameParams().length === 0, JSON.stringify(frameParams()));

head('a sky link round-trips through the parser');
var parsed = w.GeosonifySkyUrl.parse(new w.URLSearchParams('hphex=956250B00862&frame=icrs&epoch=J2000'));
ok('frame recovered', parsed.frame === 'icrs');
ok('sphere recovered', parsed.sphere === 'sky');
ok('an Earth link is still Earth', w.GeosonifySkyUrl.parse(new w.URLSearchParams('hphex=956250B00862')).frame === 'earth');

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
