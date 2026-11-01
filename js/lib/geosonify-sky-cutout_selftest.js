// node geosonify-sky-cutout_selftest.js -- device-made sky thumbnails (geometry and URL handling)
'use strict';
global.HealpixGrids = require('./geosonify-healpix.js');
var SC = require('./geosonify-sky-cutout.js');
var C = HealpixGrids._core, D2R = Math.PI / 180;
var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}
function vecRaDec(v) {
  var x = v.x != null ? v.x : v[0], y = v.y != null ? v.y : v[1], z = v.z != null ? v.z : v[2];
  var r = Math.hypot(x, y, z);
  return { ra: Math.atan2(y, x), dec: Math.asin(z / r) };
}

console.log('\nwhere a sky point lands in a tile');
// For points at known fractions inside known order-9 tiles (Christchurch's sky,
// a polar-cap face, and the equator), locate() must find the same tile and put
// the point at row = NE fraction, column = NW fraction (x 512).
[[172.6, -43.5], [10.68, 41.27], [83.8, -5.4], [279.2, 38.8], [250.4, 36.5], [56.75, 24.1]].forEach(function (rd) {
  var nside = 512;
  var ip = Number(C.ang2pix_nest(nside, (90 - rd[1]) * D2R, rd[0] * D2R));
  var worst = 0, same = true;
  [[0.1, 0.2], [0.5, 0.5], [0.9, 0.3], [0.25, 0.85]].forEach(function (f) {
    var s = vecRaDec(C.pixcoord2vec_nest(nside, ip, f[0], f[1]));
    var L = SC._test.locate(C, nside, 512, s.ra, s.dec);
    if (L.ipix !== ip) same = false;
    worst = Math.max(worst, Math.abs(L.row - f[0] * 512), Math.abs(L.col - f[1] * 512));
  });
  ok('RA ' + rd[0] + ', Dec ' + rd[1] + ': same tile, row = NE and column = NW to ' + worst.toExponential(1) + ' px',
     same && worst < 1e-3, worst);
});

console.log('\nthe picture itself');
var px = 240, fov = 48 / 3600 * D2R, scale = fov / px, ra0 = 172.6 * D2R, dec0 = -43.5 * D2R;
var c = SC._test.skyAt(px / 2 - 0.5, px / 2 - 0.5, px, px, scale, ra0, dec0);
ok('the centre pixel is the requested position', Math.abs(c.ra - ra0) < 1e-9 && Math.abs(c.dec - dec0) < 1e-9);
var L0 = SC._test.skyAt(0, px / 2 - 0.5, px, px, scale, ra0, dec0), R0 = SC._test.skyAt(px - 1, px / 2 - 0.5, px, px, scale, ra0, dec0);
ok('east is LEFT, as in hips2fits: the left edge has the larger RA', L0.ra > ra0 && R0.ra < ra0);
var T0 = SC._test.skyAt(px / 2 - 0.5, 0, px, px, scale, ra0, dec0);
ok('north is up', T0.dec > dec0);
function sep(a, b) { return 2 * Math.asin(Math.sqrt(Math.pow(Math.sin((a.dec - b.dec) / 2), 2) +
  Math.cos(a.dec) * Math.cos(b.dec) * Math.pow(Math.sin((a.ra - b.ra) / 2), 2))); }
var span = sep(L0, R0) / D2R * 3600;
ok('the field across the width is the requested 48 arcsec (' + span.toFixed(2) + ')', Math.abs(span - 47.8) < 0.3);
ok('order: a 48 arcsec, 240 px picture uses order 9 tiles (DSS2\'s finest)', SC._test.orderFor(scale, 512, 9) === 9);
ok('order: a whole-degree picture uses a coarser order', SC._test.orderFor(1 * D2R / 240, 512, 9) < 9);
ok('tile paths follow HiPS: Norder9/Dir40000/Npix41234.jpg',
   SC._test.tileUrl('B', 9, 41234, 'jpg') === 'B/Norder9/Dir40000/Npix41234.jpg');

console.log('\nhips2fits URLs');
var u = 'https://alasky.cds.unistra.fr/hips-image-services/hips2fits?hips=' + encodeURIComponent('CDS/P/DSS2/color') +
        '&width=240&height=240&fov=0.013333333333333334&projection=TAN&coordsys=icrs&format=jpg&ra=172.600000&dec=-43.500000';
var p = SC.parseHips2fits(u);
ok('a DSS2 hips2fits URL is read', p && p.survey === 'P/DSS2/color' && p.width === 240 && Math.abs(p.fovDeg - 48 / 3600) < 1e-12 && p.dec === -43.5);
ok('a survey with no mirrors is left alone', SC.parseHips2fits(u.replace(encodeURIComponent('CDS/P/DSS2/color'), encodeURIComponent('CDS/P/2MASS/color'))) === null);
SC.src('https://example.org/x.jpg').then(function (r) {
  ok('a URL that is not hips2fits comes back unchanged', r === 'https://example.org/x.jpg');
  return SC.src(u);
}).then(function (r) {
  ok('without a mirror resolver (as here, in node) the original URL is kept', r === u);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
