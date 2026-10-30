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
    fitBounds: function () { return this; },
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
    _fire: function (e) { if (handlers[e]) handlers[e](); },
    _click: function (e) { if (handlers.click) handlers.click(e); }
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
var strokes = 0, arcs = 0, fills = 0, lastErr = null;
var proto = dom.window.HTMLCanvasElement.prototype;
proto.getContext = function () {
  return {
    setTransform: function () {}, clearRect: function () {}, scale: function () {},
    beginPath: function () {}, moveTo: function () {}, lineTo: function () {},
    closePath: function () {}, arc: function () { arcs++; }, fill: function () { fills++; },
    rect: function () {}, setLineDash: function () {},
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

head('5: tapping — regression: markers stopped being selectable');
(function () {
  var picked = null;
  var m2 = M.mount(document.getElementById('m'), {
    onSelect: function (sel) { picked = sel; }
  });
  m2.setFix(-43.552932, 172.652115, 6);
  m2.setBagged(['V:f9.111202110020']);
  m2.setStars([{ lat: -43.5547019, lon: 172.6538020, mag: 12.3, name: 'Gaia DR3 5382127323687128576' }]);
  m2.redraw();

  function clickAt(lat, lon) {
    picked = null;
    var p = theMap.latLngToContainerPoint({ lat: lat, lng: lon });
    theMap._click({ containerPoint: p, latlng: { lat: lat, lng: lon } });
    return picked;
  }
  var star = clickAt(-43.5547019, 172.6538020);
  ok('tapping a star selects it', star && star.kind === 'star',
     star ? star.kind : 'nothing was selected');
  var cs = null;
  try { cs = clickAt(GeosonifyStarpin.cornerstonePoint('V:f9.111202110020').lat,
                     GeosonifyStarpin.cornerstonePoint('V:f9.111202110020').lon); } catch (e) {}
  ok('tapping a bagged cornerstone selects it', cs && cs.kind === 'cornerstone',
     cs ? cs.kind : 'nothing was selected');
  var empty = clickAt(-43.60, 172.70);
  ok('tapping empty ground drops a read-only pin', empty && empty.kind === 'pin',
     empty ? empty.kind : 'nothing');
  ok('the pin carries coordinates', empty && empty.data && empty.data.lat != null);
})();

head('5b: bagged starpins are visible at every zoom');
// The field report: a starpin you had bagged looked exactly like one you had
// never seen, and above an 8 km span the star layer is empty entirely, so a
// collection was invisible from a city-wide view -- let alone from a map of
// another country.
(function () {
  var picked = null;
  var m3 = M.mount(document.getElementById('m'), {
    onSelect: function (sel) { picked = sel; }
  });
  var FIND = { id: '5382127323687128576', name: 'Gaia DR3 5382127323687128576',
               lat: -43.5547019, lon: 172.6538020 };
  m3.setFinds([FIND]);

  var drewAt = [];
  [400, 5000, 50000, 2000000].forEach(function (span) {
    state.spanM = span; arcs = 0; lastErr = null;
    try { m3.redraw(); } catch (e) { lastErr = e; }
    if (!lastErr && arcs > 0) drewAt.push(span);
  });
  ok('a find draws at every zoom, including well past the star cutoff',
     drewAt.length === 4, drewAt.join(' '));

  // One star, one dot. The lookup layer spells it "Gaia DR3 5382..." and the
  // log spells it "starpin:gdr3:5382..."; keying the dedupe on the display
  // name would draw it twice, one on top of the other, and push two hits.
  state.spanM = 1600;
  m3.setStars([{ lat: FIND.lat, lon: FIND.lon, mag: 12.3,
                 name: 'Gaia DR3 5382127323687128576' }]);
  m3.redraw();
  var p = theMap.latLngToContainerPoint({ lat: FIND.lat, lng: FIND.lon });
  picked = null;
  theMap._click({ containerPoint: p, latlng: { lat: FIND.lat, lng: FIND.lon } });
  ok('a bagged star that is also in the lookup is one target, not two',
     picked && picked.kind === 'star', picked ? picked.kind : 'nothing');

  // fitFinds has to cover cornerstones too, or "show all my finds" hides half
  // the collection.
  ok('fitFinds counts starpins and cornerstones together', (function () {
    m3.setBagged(['V:f9.111202110020c3']);
    return m3.fitFinds() === 2;
  })());
  ok('fitFinds reports nothing rather than jumping somewhere odd', (function () {
    var m4 = M.mount(document.getElementById('m'));
    return m4.fitFinds() === 0;
  })());
})();

head('6: knobs');
ok('weight clamps', M.setWeight(99) === 8 && M.setWeight(0) === 0.3);
ok('falloff clamps', M.setFalloff(2) === 0.98 && M.setFalloff(0) === 0.5,
   'a deliberate 0 must clamp to the floor, not fall back to the default \u2014 ' +
   '`Number(v) || dflt` treated 0 as absent');
ok('persist clamps', M.setPersist(9) === 1.5 && M.setPersist(-1) === 0);
M.setWeight(2); M.setFalloff(0.75); M.setPersist(0.3);
ok('defaults restored and still draw', (function () {
  strokes = 0; try { map.redraw(); } catch (e) { return false; } return strokes > 0;
})());


head('7: patches (game design v2, phase 1)');
(function () {
  var S = GeosonifyStarpin;
  // A real record for a corner: the fix sits exactly on it, 5 m accuracy.
  var nid = 0;
  function rec(name, ms) {
    var p = S.cornerstonePoint(name);
    return { record_id: 'r' + (++nid), target: { cornerstone: name },
             fix: { lat_1e7: Math.round(p.lat * 1e7), lon_1e7: Math.round(p.lon * 1e7), accuracy_m: 5 },
             event: { time_ms: ms || 1.79e12 } };
  }
  // Every order-14 corner inside one order-12 cell: the 5 x 5 vertex grid.
  var p12 = M.parseCellPath('f9.111202110020');
  ok('parseCellPath reads order and index', p12 && p12.order === 12);
  var names = {};
  for (var i = 0n; i < 16n; i++) {
    var ip = p12.ipix * 16n + i;
    var digits = '', q = ip - 9n * (1n << 28n);
    for (var d = 0; d < 14; d++) { digits = String(q & 3n) + digits; q >>= 2n; }
    S.cellCornerstones('f9.' + digits).forEach(function (c) { names[c.name] = 1; });
  }
  var all = Object.keys(names);
  ok('an order-12 cell has 25 order-14 vertices', all.length === 25, String(all.length));

  var full = S.cellProgress(all.map(function (n) { return rec(n); }), { orders: M.PATCH_ORDERS });
  var m = M.patchModel(full);
  var big = m.lit.filter(function (c) { return c.order === 12; });
  ok('all 25 corners light the large patch', big.length === 1 && big[0].cell === 'f9.111202110020',
     big.map(function (c) { return c.cell; }).join(' '));
  ok('...and make it Bright', big.length === 1 && big[0].bright === true);
  ok('its 16 small patches are lit', m.lit.filter(function (c) {
    return c.order === 14 && (c.ipix >> 4n) === p12.ipix; }).length === 16);
  ok('cells inside a lit patch are not filled twice', m.lit.every(function (c) {
    return c.order === 12 ? !c.covered : (((c.ipix >> BigInt(2 * (c.order - 12))) === p12.ipix) ? c.covered : true); }));
  ok('a Bright patch inside a Bright patch is not filled twice', m.lit.filter(function (c) {
    return c.order === 13 && c.bright; }).every(function (c) { return c.brightCovered; }));

  // Take away the centre vertex of the 5 x 5 grid. Four small patches go dark,
  // so nothing coarser can be Bright, but the large patch's own corners stand.
  var dropped = null;
  all.forEach(function (n) {
    var p = S.cornerstonePoint(n), inc = S.cellsAtVertex(p.lat, p.lon, [12]);
    if (!inc.length && !dropped) {
      var at13 = S.cellsAtVertex(p.lat, p.lon, [13]);
      if (at13.length === 4 && at13.every(function (c) { return c.cell.indexOf('f9.111202110020') === 0; })) dropped = n;
    }
  });
  ok('found the centre vertex', !!dropped);
  var less = S.cellProgress(all.filter(function (n) { return n !== dropped; })
                              .map(function (n) { return rec(n); }), { orders: M.PATCH_ORDERS });
  var m2 = M.patchModel(less);
  var big2 = m2.lit.filter(function (c) { return c.order === 12; });
  ok('the large patch is still lit by its own four corners', big2.length === 1);
  ok('...but no longer Bright', big2.length === 1 && big2[0].bright === false);
  ok('the four medium patches lose a corner and glow', m2.glow.filter(function (c) {
    return c.order === 13 && c.have === 3; }).length === 4);
  ok('a glowing patch marks each missing corner', m2.glow.every(function (c) {
    return c.missing.length === 4 - c.have; }));
  ok('...and the 3-of-4 ones mark the dropped vertex', m2.glow.filter(function (c) {
    return c.order === 13 && c.have === 3; }).every(function (c) {
    var p = S.cornerstonePoint(dropped);
    return S.haversineM(c.missing[0].lat, c.missing[0].lon, p.lat, p.lon) < 0.5; }));
  ok('a patch with one corner does not glow', M.patchModel(
      S.cellProgress([rec(all[0])], { orders: M.PATCH_ORDERS })).glow.length === 0);
  ok('no progress draws nothing and does not throw', (function () {
    var e = M.patchModel(null); return e.lit.length === 0 && e.glow.length === 0; })());

  // The log's cells are this same result narrowed to orders 13 and 14.
  var direct = S.cellProgress(all.filter(function (n) { return n !== dropped; })
                                .map(function (n) { return rec(n); }));
  function keyOf(p, orders) {
    return JSON.stringify(p.complete.filter(function (e) { return orders.indexOf(e.order) >= 0; })
      .map(function (e) { return e.cell; })) + '|' +
      JSON.stringify(p.partial.filter(function (e) { return orders.indexOf(e.order) >= 0; })
      .map(function (e) { return e.cell + ':' + e.have; }));
  }
  ok('narrowing 12-14 to 13-14 equals running at 13-14', keyOf(less, S.CELL_ORDERS) === keyOf(direct, S.CELL_ORDERS));

  ok('display order: small at neighbourhood zoom (2 km across 400 px)', M.patchDisplayOrder(2000 / 400) === 14);
  ok('display order: medium across suburbs (8 km)', M.patchDisplayOrder(8000 / 400) === 13);
  ok('display order: large across the city (20 km)', M.patchDisplayOrder(20000 / 400) === 12);
  ok('display order: large, never finer, from a country view', M.patchDisplayOrder(2e6 / 400) === 12);

  var ring = M.patchRing(12, p12.ipix);
  ok('a patch ring closes round its own corners', ring.length === 24 && (function () {
    return S.cellCornerstones('f9.111202110020').every(function (c) {
      return ring.some(function (q) { return S.haversineM(q[0], q[1], c.lat, c.lon) < 0.5; }); });
  })());

  var mp = M.mount(document.getElementById('m'));
  var drewAt = [];
  [1200, 8000, 20000, 2000000].forEach(function (span) {
    state.spanM = span; fills = 0; lastErr = null;
    try { mp.setPatches(less); mp.redraw(); } catch (e) { lastErr = e; }
    if (!lastErr && fills > 0) drewAt.push(span);
    else if (lastErr) console.log('   ', lastErr.stack);
  });
  ok('patches draw at every zoom, and stay visible from a country view', drewAt.length === 4, drewAt.join(' '));
  ok('setPatches(null) clears them', (function () {
    try { mp.setPatches(null); mp.redraw(); } catch (e) { return false; }
    return mp.patches().lit.length === 0;
  })());
})();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
