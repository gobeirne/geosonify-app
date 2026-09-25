/*
  geosonify-starpin-map-wrap_selftest.js — run: node geosonify-starpin-map-wrap_selftest.js

  The grid used to take each edge point's longitude straight from atan2, so a
  cell edge crossing the antimeridian stepped from +179.9 to -179.9 and Leaflet
  drew that step as a line the whole way across the world. Near Christchurch
  (172.6 E) this striped the regional and world views with horizontal lines,
  and it looked fine at street zoom, which is how it survived.

  Part 1 holds the pure helpers (wrapNear, ringCopies) to their contract using
  REAL HEALPix boundaries from every cell at orders 0-4. Part 2 mounts the map
  on the same Leaflet stand-in as geosonify-starpin-map_selftest.js, renders at
  street, regional and world spans, and fails if any drawn segment is longer
  than a third of the world. Set MAP_MODULE to point Part 2 at another build
  (for example the pre-fix one) to confirm the test actually catches the bug.
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

var D2R = Math.PI / 180, M_PER_DEG = 111319.9;

// ── Part 1: the helpers, on real cell boundaries ────────────────────────────
var M = require(process.env.MAP_MODULE || './geosonify-starpin-map.js');

if (!M.wrapNear) console.log('\n(this build exports no wrap helpers; Part 1 skipped)');
else (function () {
head('1: wrapNear');
ok('179.9 near 172 stays', Math.abs(M.wrapNear(179.9, 172) - 179.9) < 1e-9);
ok('-179.9 near 172 becomes 180.1', Math.abs(M.wrapNear(-179.9, 172) - 180.1) < 1e-9);
ok('10 near 370 becomes 370', Math.abs(M.wrapNear(10, 370) - 370) < 1e-9);
ok('result is always within half a turn of ref', (function () {
  for (var a = -720; a <= 720; a += 17.3) for (var r = -540; r <= 540; r += 23.9)
    if (Math.abs(M.wrapNear(a, r) - r) > 180 + 1e-9) return false;
  return true;
})());

// A cell boundary built exactly as draw() builds it.
function ringOf(order, ipix, segs) {
  var nside = Math.pow(2, order), ring = [], ip = BigInt(ipix);
  for (var e = 0; e < 4; e++) for (var t = 0; t < segs; t++) {
    var f = t / segs;
    var uv = e === 0 ? [f, 0] : e === 1 ? [1, f] : e === 2 ? [1 - f, 1] : [0, 1 - f];
    var v = HP._core.pixcoord2vec_nest(nside, ip, uv[0], uv[1]);
    var x = v[0], y = v[1], z = v[2], r = Math.hypot(x, y, z);
    ring.push([Math.asin(z / r) / D2R, Math.hypot(x, y) < 1e-12 * r ? null : Math.atan2(y, x) / D2R]);
  }
  return ring;
}
// Longest longitude step round a closed ring, closing segment included.
function maxStep(pts, lonOf) {
  var m = 0;
  for (var i = 0; i < pts.length; i++) {
    var a = lonOf(pts[i]), b = lonOf(pts[(i + 1) % pts.length]);
    m = Math.max(m, Math.abs(b - a));
  }
  return m;
}

head('2: every cell at orders 0-4 comes back continuous');
var worstNew = 0, rawBad = 0, total = 0, poleRings = 0, poleOk = true;
for (var order = 0; order <= 4; order++) {
  var npix = 12 * Math.pow(4, order);
  for (var p = 0; p < npix; p++) {
    var ring = ringOf(order, p, 8);
    total++;
    // The OLD behaviour, for contrast: raw atan2, pole read as lon 0.
    if (maxStep(ring, function (q) { return q[1] == null ? 0 : q[1]; }) > 180) rawBad++;
    var copies = M.ringCopies(ring, 0, null, null);
    if (copies.length !== 1) { worstNew = Infinity; continue; }
    worstNew = Math.max(worstNew, maxStep(copies[0], function (q) { return q[1]; }));
    if (ring.some(function (q) { return q[1] == null; })) {
      poleRings++;
      // A pole point becomes two points, so the ring grows by one per pole.
      var poles = ring.filter(function (q) { return q[1] == null; }).length;
      if (copies[0].length !== ring.length + poles) poleOk = false;
    }
  }
}
ok('the old method really was broken on some cells (' + rawBad + ' of ' + total + ')', rawBad > 0);
ok('no longitude step over 120 degrees on any cell (worst ' + worstNew.toFixed(1) + ')', worstNew <= 120);
ok('pole corners were met (' + poleRings + ' rings) and each became two points', poleRings > 0 && poleOk);

head('3: copies land where the view is');
// The order-3 cell under 179.5 E, 43.5 S: it straddles the antimeridian.
var ipStraddle = Number(HP.nestIndex(-43.5, 179.5, 3));
var rs = ringOf(3, ipStraddle, 8);
var c1 = M.ringCopies(rs, 172.65, 165, 181);
ok('Christchurch regional view: one copy', c1.length === 1);
ok('...and every point sits east of 150, none flung to -180',
   c1[0].every(function (q) { return q[1] > 150 && q[1] < 200; }));
var c2 = M.ringCopies(rs, -170, -185, -160);
ok('same cell seen from the far side: drawn near -180 instead',
   c2.length === 1 && c2[0].every(function (q) { return q[1] > -210 && q[1] < -150; }));
var c3 = M.ringCopies(rs, 180, -170, 530);
ok('a view two worlds wide draws the cell in each world (' + c3.length + ')', c3.length === 2);
var c4 = M.ringCopies(rs, 172.65, 10, 20);
ok('a cell nowhere near the view draws nothing', c4.length === 0);
ok('a ring of nothing but poles draws nothing', M.ringCopies([[90, null], [90, null]], 0).length === 0);

})();

// ── Part 2: through the real draw() ─────────────────────────────────────────
var state = { lat: -43.552932, lon: 172.652115, spanM: 1600, w: 400, h: 400 };
function mkMap() {
  var handlers = {};
  function mpp() { return state.spanM / state.w; }
  function kx() { return M_PER_DEG * Math.cos(state.lat * D2R); }
  return {
    getSize: function () { return { x: state.w, y: state.h }; },
    getCenter: function () { return { lat: state.lat, lng: state.lon }; },
    getZoom: function () { return 16; },
    setView: function () { return this; }, fitBounds: function () { return this; },
    on: function (evs, fn) { String(evs).split(' ').forEach(function (e) { handlers[e] = fn; }); },
    off: function () {}, remove: function () {}, invalidateSize: function () {},
    addLayer: function () {}, removeLayer: function () {},
    getPanes: function () { return { overlayPane: document.createElement('div') }; },
    options: { zoomAnimation: false },
    distance: function (a, b) { return Math.abs(b.lng - a.lng) * kx(); },
    getBounds: function () {
      var dLon = state.spanM / kx() / 2, dLat = state.spanM / M_PER_DEG / 2;
      return {
        getNorthWest: function () { return { lat: state.lat + dLat, lng: state.lon - dLon }; },
        getNorthEast: function () { return { lat: state.lat + dLat, lng: state.lon + dLon }; }
      };
    },
    latLngToContainerPoint: function (ll) {
      var la = ll.lat != null ? ll.lat : ll[0], lo = ll.lng != null ? ll.lng : ll[1];
      return { x: state.w / 2 + (lo - state.lon) * kx() / mpp(),
               y: state.h / 2 - (la - state.lat) * M_PER_DEG / mpp() };
    },
    containerPointToLatLng: function (p) {
      return { lat: state.lat - (p[1] - state.h / 2) * mpp() / M_PER_DEG,
               lng: state.lon + (p[0] - state.w / 2) * mpp() / kx() };
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
    function C() {} C.prototype = proto;
    C.prototype.addTo = function (m) { this._map = m; this.onAdd(m); return this; };
    return C;
  } },
  DomUtil: { create: function (tag, cls) { var e = document.createElement(tag); e.className = cls || ''; return e; },
             setPosition: function () {}, setTransform: function () {} },
  Browser: { any3d: false }
};

// Record every segment the canvas is asked for.
var longest = 0, segments = 0, cur = null;
dom.window.HTMLCanvasElement.prototype.getContext = function () {
  return {
    setTransform: function () {}, clearRect: function () {}, scale: function () {},
    beginPath: function () { cur = null; },
    moveTo: function (x, y) { cur = [x, y]; },
    lineTo: function (x, y) {
      if (cur) { var dd = Math.hypot(x - cur[0], y - cur[1]); longest = Math.max(longest, dd); segments++; }
      cur = [x, y];
    },
    closePath: function () {}, arc: function () {}, fill: function () {}, stroke: function () {},
    save: function () {}, restore: function () {}, translate: function () {}, rotate: function () {},
    fillRect: function () {},
    set lineWidth(v) {}, set strokeStyle(v) {}, set fillStyle(v) {}, set globalAlpha(v) {}
  };
};

var map = M.mount(document.getElementById('m'));
function render(lat, lon, spanM) {
  state.lat = lat; state.lon = lon; state.spanM = spanM;
  longest = 0; segments = 0;
  map.redraw();
  var worldPx = 360 * M_PER_DEG * Math.cos(lat * D2R) / (spanM / state.w);
  if (process.env.DBG) console.log(JSON.stringify(global.LSEG));
  return { longest: longest, segments: segments, worldPx: worldPx };
}

head('4: no stripes through draw()');
[['street, Christchurch', -43.5529, 172.6521, 1600],
 ['regional, Christchurch (the screenshot)', -43.49, 172.65, 400000],
 ['regional, panned past 180', -43.49, 181.5, 400000],
 ['regional, Fiji-side of the line', -17.8, -179.5, 600000],
 ['whole Earth', -8.74, 106.17, 20000000]].forEach(function (c) {
  var r = render(c[1], c[2], c[3]);
  ok(c[0] + ': drew something (' + r.segments + ' segments)', r.segments > 0);
  ok(c[0] + ': longest segment ' + Math.round(r.longest) + ' px, under a third of the world (' +
     Math.round(r.worldPx / 3) + ' px)', r.longest < r.worldPx / 3);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
