// starpin-flip_testtiles.js -- synthetic vector tiles for starpin-flip_browsertest.py: an OpenMapTiles-shaped Christchurch that
// does not need the network. node gen-tile.js z x y  -> MVT bytes on stdout
// (or require() it and call tile(z, x, y)).
var geojsonvt = require('geojson-vt'), vtpbf = require('vt-pbf');
var LAT0 = -43.5309, LON0 = 172.6365;
var M = 111320, k = Math.cos(LAT0 * Math.PI / 180);
var dLat = 110 / M, dLon = 110 / (M * k);
function line(props, coords) { return { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } }; }
var roads = [];
for (var i = -60; i <= 60; i++) {           // a 13 km grid of 110 m blocks
  var la = LAT0 + i * dLat, lo = LON0 + i * dLon;
  roads.push(line({ 'class': 'minor' }, [[LON0 - 60 * dLon, la], [LON0 + 60 * dLon, la]]));
  roads.push(line({ 'class': 'minor' }, [[lo, LAT0 - 60 * dLat], [lo, LAT0 + 60 * dLat]]));
}
roads.push(line({ 'class': 'primary' }, [[LON0 - 0.08, LAT0 - 0.06], [LON0 + 0.08, LAT0 + 0.06]]));
roads.push(line({ 'class': 'rail' }, [[LON0 - 0.08, LAT0 + 0.02], [LON0 + 0.08, LAT0 + 0.02]]));
var loop = [];
for (var t = 0; t <= 24; t++) { var a = t / 24 * 2 * Math.PI; loop.push([LON0 + 3 * dLon * Math.cos(a), LAT0 + 3 * dLat * Math.sin(a)]); }
roads.push(line({ 'class': 'path' }, loop));
var sea = { type: 'Feature', properties: { 'class': 'ocean' }, geometry: { type: 'Polygon',
  coordinates: [[[172.72, -44.5], [174.5, -44.5], [174.5, -42.5], [172.72, -42.5], [172.72, -44.5]]] } };
var river = line({ 'class': 'river' }, [[172.40, -43.60], [172.60, -43.54], [172.72, -43.52]]);
var border = line({ admin_level: 4, maritime: 0 }, [[172.0, -43.0], [172.9, -43.0]]);
var opts = { maxZoom: 14, extent: 4096, buffer: 64, tolerance: 0, indexMaxZoom: 5 };
var idx = {
  transportation: geojsonvt({ type: 'FeatureCollection', features: roads }, opts),
  water: geojsonvt({ type: 'FeatureCollection', features: [sea] }, opts),
  waterway: geojsonvt({ type: 'FeatureCollection', features: [river] }, opts),
  boundary: geojsonvt({ type: 'FeatureCollection', features: [border] }, opts)
};
function tile(z, x, y) {
  var layers = {}, any = false;
  Object.keys(idx).forEach(function (n) { var t = idx[n].getTile(z, x, y); if (t) { layers[n] = t; any = true; } });
  return any ? Buffer.from(vtpbf.fromGeojsonVt(layers, { version: 2 })) : Buffer.alloc(0);
}
module.exports = { tile: tile };
if (require.main === module) process.stdout.write(tile(+process.argv[2], +process.argv[3], +process.argv[4]));
