/*
  geosonify-starpin-vtiles_selftest.js — run: node geosonify-starpin-vtiles_selftest.js
  Needs: npm i geojson-vt@3 vt-pbf@3 @mapbox/vector-tile@1 pbf@3
  (test-only: they build real Mapbox Vector Tiles, and supply the reference
   decoder ours is held to. None of them ships to the browser.)

    1  our decoder agrees with @mapbox/vector-tile, vertex for vertex, on real tiles
    2  tile maths: round trips, bounds, coverage, wrapping, zoom choice
    3  the OpenMapTiles schema maps to what we draw; rail and ferries are not ground
    4  a coastline cut by a tile edge is filled but never stroked along the cut
    5  the store: memory first, device cache second, network last, no duplicates
*/
'use strict';
var T = require('./geosonify-starpin-vtiles.js');
var geojsonvt = require('geojson-vt'), vtpbf = require('vt-pbf');
var VectorTile = require('@mapbox/vector-tile').VectorTile, Pbf = require('pbf');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }

// Anchor every test feature on the CENTRE of the z14 tile over Christchurch, so
// nothing falls off its edge by accident.
var Z = 14, X0 = Math.floor(T.lon2x(172.6365, Z)), Y0 = Math.floor(T.lat2y(-43.5309, Z));
var LAT = T.y2lat(Y0 + 0.5, Z), LON = T.x2lon(X0 + 0.5, Z);
function F(props, type, coords) { return { type: 'Feature', properties: props, geometry: { type: type, coordinates: coords } }; }
var layers = {
  transportation: [F({ 'class': 'minor' }, 'LineString', [[LON - .01, LAT], [LON + .01, LAT + .002]]),
                   F({ 'class': 'primary' }, 'LineString', [[LON, LAT - .01], [LON + .001, LAT + .01]]),
                   F({ 'class': 'path' }, 'LineString', [[LON - .002, LAT - .0015], [LON + .002, LAT + .001]]),
                   F({ 'class': 'rail' }, 'LineString', [[LON - .01, LAT + .0006], [LON + .01, LAT + .0006]]),
                   F({ 'class': 'ferry' }, 'LineString', [[LON - .01, LAT - .0006], [LON + .01, LAT - .0006]]),
                   F({ 'class': 'tertiary_construction' }, 'LineString', [[LON - .01, LAT - .0009], [LON + .01, LAT - .0009]])],
  water: [F({ 'class': 'ocean' }, 'Polygon', [[[LON + .0005, LAT - .5], [LON + 2, LAT - .5], [LON + 2, LAT + .5], [LON + .0005, LAT + .5], [LON + .0005, LAT - .5]]])],
  waterway: [F({ 'class': 'river' }, 'LineString', [[LON - .01, LAT - .001], [LON + .01, LAT - .0015]])],
  boundary: [F({ admin_level: 2, maritime: 0 }, 'LineString', [[LON - .01, LAT + .0012], [LON + .01, LAT + .0012]]),
             F({ admin_level: 2, maritime: 1 }, 'LineString', [[LON - .01, LAT + .0013], [LON + .01, LAT + .0013]]),
             F({ admin_level: 8, maritime: 0 }, 'LineString', [[LON - .01, LAT + .0014], [LON + .01, LAT + .0014]])]
};
var idx = {};
Object.keys(layers).forEach(function (n) {
  idx[n] = geojsonvt({ type: 'FeatureCollection', features: layers[n] }, { maxZoom: 14, extent: 4096, buffer: 64 });
});
function tileBytes(z, x, y) {
  var ls = {};
  Object.keys(idx).forEach(function (n) { var t = idx[n].getTile(z, x, y); if (t) ls[n] = t; });
  return new Uint8Array(vtpbf.fromGeojsonVt(ls, { version: 2 }));
}
var X = X0, Y = Y0;

head('1  decoder vs the reference');
var worst = 0, verts = 0, featN = 0, mism = [];
[[14, X, Y], [12, X >> 2, Y >> 2], [9, X >> 5, Y >> 5]].forEach(function (zxy) {
  var bytes = tileBytes(zxy[0], zxy[1], zxy[2]), ours = T.decode(bytes), ref = new VectorTile(new Pbf(bytes));
  Object.keys(ref.layers).forEach(function (name) {
    var L = ref.layers[name];
    if (!ours[name] || ours[name].features.length !== L.length) { mism.push(name + ' count'); return; }
    if (ours[name].extent !== L.extent) mism.push(name + ' extent');
    for (var i = 0; i < L.length; i++) {
      var f = L.feature(i), o = ours[name].features[i]; featN++;
      if (f.type !== o.type) mism.push(name + ' type');
      if (JSON.stringify(f.properties) !== JSON.stringify(o.props)) mism.push(name + ' props ' + JSON.stringify(o.props));
      f.loadGeometry().forEach(function (ring, ri) {
        ring.forEach(function (p, pi) {
          var q = o.rings[ri] && o.rings[ri][pi];
          if (!q) { mism.push(name + ' ring'); return; }
          worst = Math.max(worst, Math.abs(q[0] - p.x), Math.abs(q[1] - p.y)); verts++;
        });
      });
    }
  });
});
ok('same layers, features, types and properties (' + featN + ' features)', mism.length === 0, mism.slice(0, 3).join('; '));
ok('every vertex identical (' + verts + ' checked, worst ' + worst + ')', worst === 0 && verts > 50);
ok('asking for some layers skips the rest', Object.keys(T.decode(tileBytes(Z, X, Y), ['water'])).join() === 'water');

head('2  tile maths');
var rt = 0;
for (var i = 0; i < 200; i++) {
  var la = -80 + Math.random() * 160, lo = -180 + Math.random() * 360;
  rt = Math.max(rt, Math.abs(T.y2lat(T.lat2y(la, 12), 12) - la), Math.abs(T.x2lon(T.lon2x(lo, 12), 12) - lo));
}
ok('lat/lon <-> tile coordinates round-trip (' + rt.toExponential(1) + ' deg)', rt < 1e-9);
var b = T.tileBounds(Z, X, Y);
ok('Christchurch lies inside its own z14 tile', LAT > b.s && LAT < b.n && LON > b.w && LON < b.e, JSON.stringify(b));
ok('a z14 tile here is about 1.8 km across', Math.abs((b.e - b.w) * 111320 * Math.cos(LAT * Math.PI / 180) - 1771) < 20);
var cov = T.tilesFor({ s: b.s + 1e-9, n: b.n - 1e-9, w: b.w + 1e-9, e: b.e - 1e-9 }, Z, 1);
ok('one tile plus a margin is a 3 x 3 block', cov.length === 9, String(cov.length));
var dl = T.tilesFor({ s: -18, n: -17.5, w: 179.8, e: 180.3 }, 6, 0);
ok('a view across the date line runs past the edge of the world', dl.some(function (t) { return t.x === 64; }), JSON.stringify(dl));
ok('...and wrapX folds it back for fetching', T.wrapX(64, 6) === 0 && T.wrapX(-1, 6) === 63);
ok('the whole world never asks for more tiles than exist', T.tilesFor({ s: -80, n: 80, w: -400, e: 400 }, 2, 1).length <= 16);
ok('map zoom 17 draws z14 tiles, 12 draws z11, 0 draws z0',
   T.tileZoomFor(17) === 14 && T.tileZoomFor(12) === 11 && T.tileZoomFor(0) === 0);

head('3  the schema, as we read it');
var geo = T.toGeo(T.decode(tileBytes(Z, X, Y)), Z, X, Y);
var classes = geo.roads.map(function (r) { return r.cls; }).sort().join(',');
ok('minor, primary, path and a road under construction are ground', classes === 'major,major,minor,path', classes);
ok('rail and ferries are not', geo.roads.length === 4);
ok('rivers are drawn big', geo.waterways.length === 1 && geo.waterways[0].big === true);
ok('countries draw; maritime lines and suburbs do not',
   geo.borders.length === 1 && geo.borders[0].level === 2, JSON.stringify(geo.borders.map(function (x) { return x.level; })));
ok('geometry leaves as lat/lon, on the right spot',
   geo.roads.every(function (r) { return r.pts.every(function (p) { return Math.abs(p[0] - LAT) < 0.02 && Math.abs(p[1] - LON) < 0.02; }); }));
ok('every road carries a bounding box for culling and reach', geo.roads.every(function (r) { return r.bb.length === 4 && r.bb[0] <= r.bb[2]; }));

head('4  the sea is filled, its tile cuts are not stroked');
ok('the ocean arrives as a polygon', geo.water.length >= 1);
var w = geo.water[0], cuts = w.edge.filter(Boolean).length, shore = w.edge.length - cuts;
ok('its edges along the tile boundary are marked (' + cuts + ')', cuts >= 2);
ok('and the real shoreline is not (' + shore + ')', shore >= 1);

head('5  the store');
(async function () {
  var calls = [], dev = {};
  var fakeCaches = { open: function () { return Promise.resolve({
    match: function (k) { return Promise.resolve(dev[k] ? { headers: { get: function () { return String(dev[k].at); } },
                                                            arrayBuffer: function () { return Promise.resolve(dev[k].buf); } } : undefined); },
    put: function (k, r) { return r.arrayBuffer().then(function (buf) { dev[k] = { buf: buf, at: Date.now() }; }); } }); } };
  function fakeFetch(url) {
    calls.push(url);
    if (/tilejson/.test(url)) return Promise.resolve({ json: function () { return Promise.resolve({ tiles: ['https://t.test/{z}/{x}/{y}.pbf'] }); } });
    var m = /(\d+)\/(\d+)\/(\d+)\.pbf/.exec(url);
    var bytes = tileBytes(+m[1], +m[2], +m[3]);
    return Promise.resolve({ ok: true, status: 200, arrayBuffer: function () { return Promise.resolve(bytes.slice().buffer); } });
  }
  var win = { Response: global.Response, Blob: global.Blob, localStorage: { getItem: function () { return null; }, setItem: function () {} } };
  var arrived = 0;
  var st = T.createStore({ window: win, fetch: fakeFetch, caches: fakeCaches, tilejson: 'https://t.test/tilejson',
                           onTile: function () { arrived++; } });
  ok('a first request returns nothing yet', st.request(Z, X, Y) === null);
  st.request(Z, X, Y); st.request(Z, X, Y);
  await new Promise(function (r) { setTimeout(r, 200); });
  ok('it arrives once, however many times it was asked for', arrived === 1 && calls.filter(function (u) { return /pbf/.test(u); }).length === 1,
     arrived + ' arrivals, ' + calls.length + ' calls');
  ok('then it is in memory', !!st.request(Z, X, Y) && st.stats.network === 1);
  ok('a missing child is stood in for by its parent', st.peek(Z + 1, X * 2, Y * 2) === st.peek(Z, X, Y));
  var st2 = T.createStore({ window: win, fetch: fakeFetch, caches: fakeCaches, tilejson: 'https://t.test/tilejson', onTile: function () {} });
  var before = calls.length;
  st2.request(Z, X, Y);
  await new Promise(function (r) { setTimeout(r, 200); });
  ok('a fresh session reads it from the device, not the network', calls.filter(function (u) { return /pbf/.test(u); }).length === 1 &&
     st2.stats.device === 1, 'calls ' + (calls.length - before) + ', device ' + st2.stats.device);
  var many = T.tilesFor({ s: LAT - 0.05, n: LAT + 0.05, w: LON - 0.07, e: LON + 0.07 }, 14, 0);
  var peak = 0, active = 0;
  var slowFetch = function (url) {
    if (/tilejson/.test(url)) return fakeFetch(url);
    active++; peak = Math.max(peak, active);
    return new Promise(function (r) { setTimeout(function () { active--; r(fakeFetch(url)); }, 20); });
  };
  var st3 = T.createStore({ window: win, fetch: slowFetch, caches: null, tilejson: 'https://t.test/tilejson', onTile: function () {} });
  many.forEach(function (t) { st3.request(t.z, t.x, t.y); });
  await new Promise(function (r) { setTimeout(r, 1500); });
  ok('never more than four requests in flight (' + many.length + ' asked for, peak ' + peak + ')', peak <= 4 && peak > 0);
  console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
  process.exit(fail === 0 ? 0 : 1);
})();
