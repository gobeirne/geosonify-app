/*
  geosonify-starpin-map_selftest.js — run: node geosonify-starpin-map_selftest.js

  This file exists because `node --check` passed on a build whose draw() threw
  a ReferenceError on every frame, and the map shipped with NO GRID AT ALL.
  Syntax checking cannot catch a call to a function that was deleted. So this
  actually mounts the map against a minimal Leaflet stand-in, renders at five
  zoom levels, and fails on any thrown error or empty canvas.
*/
'use strict';
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }

var { JSDOM } = require('jsdom');
var dom = new JSDOM('<!doctype html><html><head></head><body><div id="m"></div></body></html>',
                    { pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document;
global.getComputedStyle = dom.window.getComputedStyle;

var HP = require('./geosonify-healpix.js');
global.HealpixGrids = HP;
global.GeosonifyStarpin = require('./geosonify-starpin.js');

// ── a Leaflet stand-in: only what the map module actually touches ───────────
var D2R = Math.PI / 180, M_PER_DEG = 111319.9;
var state = { lat: -43.552932, lon: 172.652115, spanM: 1600, w: 400, h: 400 };
function mkMap() {
  var handlers = {};
  return {
    getSize: function () { return { x: state.w, y: state.h }; },
    getCenter: function () { return { lat: state.lat, lng: state.lon }; },
    getZoom: function () { return 16; },
    setView: function () { return this; },
    on: function (evs, fn) { String(evs).split(' ').forEach(function (e) { handlers[e] = fn; }); },
    off: function () {},
    remove: function () {},
    invalidateSize: function () {},
    addLayer: function () {}, removeLayer: function () {},
    getPanes: function () { return { overlayPane: document.createElement('div') }; },
    options: { zoomAnimation: false },
    distance: function (a, b) {
      return Math.abs(b.lng - a.lng) * M_PER_DEG * Math.cos(state.lat * D2R);
    },
    getBounds: function () {
      var dLon = state.spanM / (M_PER_DEG * Math.cos(state.lat * D2R)) / 2;
      var dLat = state.spanM / M_PER_DEG / 2;
      return {
        getNorthWest: function () { return { lat: state.lat + dLat, lng: state.lon - dLon }; },
        getNorthEast: function () { return { lat: state.lat + dLat, lng: state.lon + dLon }; }
      };
    },
    latLngToContainerPoint: function (ll) {
      var la = ll.lat != null ? ll.lat : ll[0], lo = ll.lng != null ? ll.lng : ll[1];
      var mpp = state.spanM / state.w;
      return { x: state.w / 2 + (lo - state.lon) * M_PER_DEG * Math.cos(state.lat * D2R) / mpp,
               y: state.h / 2 - (la - state.lat) * M_PER_DEG / mpp };
    },
    containerPointToLatLng: function (p) {
      var mpp = state.spanM / state.w;
      return { lat: state.lat - (p[1] - state.h / 2) * mpp / M_PER_DEG,
               lng: state.lon + (p[0] - state.w / 2) * mpp / (M_PER_DEG * Math.cos(state.lat * D2R)) };
    },
    containerPointToLayerPoint: function () { return { x: 0, y: 0 }; },
    _fire: function (e) { if (handlers[e]) handlers[e](); }
  };
}
var theMap = mkMap();
global.L = {
  map: function () { return theMap; },
  tileLayer: function () { return { addTo: function () { return this; } }; },
  Layer: { extend: function (proto) {
    function C() {}
    C.prototype = proto;
    C.prototype.addTo = function (m) { this._map = m; this.onAdd(m); return this; };
    return C;
  } },
  DomUtil: {
    create: function (tag, cls) { var e = document.createElement(tag); e.className = cls || ''; return e; },
    setPosition: function () {}, setTransform: function () {}
  },
  Browser: { any3d: false }
};

// count what the canvas was actually asked to draw
var strokes = 0, arcs = 0, lastErr = null;
var proto = dom.window.HTMLCanvasElement.prototype;
proto.getContext = function () {
  return {
    setTransform: function () {}, clearRect: function () {}, scale: function () {},
    beginPath: function () {}, moveTo: function () {}, lineTo: function () {},
    closePath: function () {}, arc: function () { arcs++; }, fill: function () {},
    stroke: function () { strokes++; }, save: function () {}, restore: function () {},
    translate: function () {}, rotate: function () {}, fillRect: function () {},
    set lineWidth(v) {}, set strokeStyle(v) {}, set fillStyle(v) {}, set globalAlpha(v) {}
  };
};

var M = require('./geosonify-starpin-map.js');

head('1: it renders at all');
var map;
try { map = M.mount(document.getElementById('m')); }
catch (e) { lastErr = e; }
ok('mount does not throw', !lastErr, lastErr && lastErr.message);

head('2: draw() actually draws, at every zoom');
// The regression this file exists for: draw() threw ReferenceError: zoomBoost
// is not defined, silently, on every frame.
[400, 5000, 50000, 200000, 2000000].forEach(function (span) {
  state.spanM = span; strokes = 0; lastErr = null;
  try { map.redraw(); } catch (e) { lastErr = e; }
  var label = span < 1000 ? span + ' m' : (span / 1000) + ' km';
  ok('draws at ' + label, !lastErr && strokes > 0,
     lastErr ? lastErr.message : strokes + ' strokes');
});

head('3: the ramp is sane at every zoom');
[400, 5000, 50000, 200000, 2000000].forEach(function (span) {
  var widths = [], n = 0;
  for (var o = 0; o <= 22; o++) {
    var st = M.strokeFor(o, span);
    if (st.across < 1 / 64) continue;
    if (st.across > 44 || !st.visible) break;
    widths.push(st.width); n++;
  }
  var label = span < 1000 ? span + ' m' : (span / 1000) + ' km';
  ok('at ' + label + ': between 5 and 14 orders drawn', n >= 5 && n <= 14, String(n));
  ok('at ' + label + ': widths descend', widths.every(function (w, i) {
    return i === 0 || w <= widths[i - 1] + 1e-9; }), widths.map(function (w) {
    return w.toFixed(1); }).join(' '));
});

head('4: markers survive a render');
state.spanM = 1600; arcs = 0; lastErr = null;
try {
  map.setFix(-43.552932, 172.652115, 6);
  map.setBagged(['V:f9.111202110020']);
  map.setHighlight('V:f9.111202110020');
  map.setStars([{ lat: -43.5547, lon: 172.6538, mag: 12.3, name: 'Gaia DR3 1' }]);
  map.redraw();
} catch (e) { lastErr = e; }
ok('fix, bagged, highlight and stars all draw', !lastErr && arcs > 0,
   lastErr ? lastErr.message : arcs + ' arcs');

head('5: knobs');
ok('weight clamps', M.setWeight(99) === 8 && M.setWeight(0) === 0.3);
ok('falloff clamps', M.setFalloff(2) === 0.98 && M.setFalloff(0) === 0.5,
   'a deliberate 0 must clamp to the floor, not fall back to the default \u2014 ' +
   '`Number(v) || dflt` treated 0 as absent');
ok('persist clamps', M.setPersist(9) === 1.5 && M.setPersist(-1) === 0);
M.setWeight(2); M.setFalloff(0.75); M.setPersist(0.3);
ok('defaults restored and still draw', (function () {
  strokes = 0; try { map.redraw(); } catch (e) { return false; } return strokes > 0;
})());

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
