/*
  geosonify-sky-overlay.selftest.js — run: node geosonify-sky-overlay.selftest.js
  Needs geosonify-sky.js and geosonify-healpix.js alongside.

  The point of the projection contract is that this file can test the whole
  overlay pipeline with NO renderer present. The mock is a real orthographic
  projection written here, which genuinely returns null for the far hemisphere --
  so clipping, culling and partial rings are exercised for real, not faked.

  Gates:
    1  a fully visible cell projects to one closed path
    2  a cell on the limb is clipped into open segments, never falsely closed
    3  a cell on the far side is culled entirely
    4  screen size scales with zoom as expected
    5  wrap detection splits rather than drawing across the viewport
    6  pickVisible chooses a legible band and reports what it dropped
    7  the order-29 ceiling does NOT limit what we can draw
    8  path strings are well formed
*/
'use strict';

var Sky = require('./geosonify-sky.js');
var HP = require('./geosonify-healpix.js');
var Overlay = require('./geosonify-sky-overlay.js');
Sky.setEngine(HP);

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }

var VP = { width: 800, height: 600 };
var D2R = Math.PI / 180;

/*
  Orthographic projection centred on (ra0, dec0), scale in px per radian.
  Returns null for the far hemisphere -- exactly the behaviour Aladin's
  world2pix exhibits outside the visible field, which is what we must handle.
*/
function ortho(ra0, dec0, scale) {
  var l0 = ra0 * D2R, p0 = dec0 * D2R;
  var sinp0 = Math.sin(p0), cosp0 = Math.cos(p0);
  return function (ra, dec) {
    var l = ra * D2R, p = dec * D2R;
    var cosc = sinp0 * Math.sin(p) + cosp0 * Math.cos(p) * Math.cos(l - l0);
    if (cosc <= 0) return null;                       // far hemisphere
    var x = Math.cos(p) * Math.sin(l - l0);
    var y = cosp0 * Math.sin(p) - sinp0 * Math.cos(p) * Math.cos(l - l0);
    return [VP.width / 2 + x * scale, VP.height / 2 - y * scale];
  };
}

// A test cell and its ancestry. Order 6 is ~51 arcmin, big enough to see.
var LAT = -43.555444, LON = 172.650913;
var deepOrder = 34;
var deepIpix = HP.nestIndex(LAT, LON, deepOrder);
var chain = Sky.ancestry(deepOrder, deepIpix, { fromOrder: 2 });
function boundaryOf(cell) {
  return Sky.cellBoundary(cell.order, cell.ipix, { step: 6, close: true, frame: 'sky' });
}
// The centre of the deep cell, in sky terms: Dec = lat, RA = lon.
var ra0 = ((LON % 360) + 360) % 360, dec0 = LAT;

head('1  fully visible cell -> one closed path');
var big = chain.filter(function (c) { return c.order === 6; })[0];
var pr = Overlay.projectRing(boundaryOf(big), ortho(ra0, dec0, 60000), { viewport: VP });
ok('visible', pr.visible);
ok('complete (no vertex clipped)', pr.complete, pr.points + ' of 25 points');
ok('single segment', pr.segments.length === 1, String(pr.segments.length));
var path = Overlay.ringToPath(pr);
ok('path closes with Z', /Z$/.test(path), path.slice(-30));
ok('bbox is a sane size', pr.maxPx > 5 && pr.maxPx < 2000, pr.maxPx.toFixed(1) + ' px');

head('2  cell on the limb -> open segments, never falsely closed');
/*
  Offsetting RA is NOT the same as offsetting great-circle distance: at
  dec -43.6, 89.6 degrees of RA is only 61 degrees of arc, so the cell stayed
  comfortably visible. Offsetting DECLINATION by 90 gives exactly 90 degrees of
  arc regardless of declination, putting the cell centre precisely on the limb.
*/
var limbDec = dec0 + 90 <= 90 ? dec0 + 90 : dec0 - 90;
var limbProj = ortho(ra0, limbDec, 400);
var order2 = chain.filter(function (c) { return c.order === 2; })[0];
var limb = Overlay.projectRing(boundaryOf(order2), limbProj, { viewport: VP });
ok('partially visible', limb.visible && !limb.complete,
   'visible=' + limb.visible + ' complete=' + limb.complete + ' pts=' + limb.points);
ok('flagged as clipped', limb.clipped);
var limbPath = Overlay.ringToPath(limb);
ok('path does NOT close', limbPath.indexOf('Z') === -1);
ok('at least one segment', limb.segments.length >= 1, String(limb.segments.length));

head('3  far side -> culled entirely');
var farProj = ortho(ra0 + 180, -dec0, 400);
var far = Overlay.projectRing(boundaryOf(order2), farProj, { viewport: VP });
ok('not visible', !far.visible, 'points=' + far.points);
ok('empty path', Overlay.ringToPath(far) === '', JSON.stringify(Overlay.ringToPath(far)));

head('4  screen size tracks zoom linearly');
var s1 = Overlay.projectRing(boundaryOf(big), ortho(ra0, dec0, 10000), { viewport: VP }).maxPx;
var s2 = Overlay.projectRing(boundaryOf(big), ortho(ra0, dec0, 20000), { viewport: VP }).maxPx;
ok('doubling scale doubles size', Math.abs(s2 / s1 - 2) < 0.02, (s2 / s1).toFixed(4));

head('5  wrap detection splits instead of striping the viewport');
// A deliberately pathological projection that flips sign halfway round, the way
// an all-sky frame wraps at its seam.
var wrapProj = function (ra, dec) {
  var x = ((ra % 360) + 360) % 360;
  return [x < 180 ? x * 4 : (x - 360) * 4 + VP.width, VP.height / 2 - dec * 4];
};
var seamCell = chain.filter(function (c) { return c.order === 2; })[0];
var seam = Overlay.projectRing(
  [[0, 179.6], [0, 179.9], [0, 180.4], [0, 180.9], [0, 179.6]], wrapProj, { viewport: VP });
ok('wrap detected', seam.wrapped);
// The synthetic ring crosses the seam twice -- going up through 180 and again
// when it closes back to 179.6 -- so three segments is correct, not two.
ok('split into >= 2 segments', seam.segments.length >= 2, String(seam.segments.length));
ok('no segment stripes the viewport', seam.segments.every(function (sg) {
  var xs = sg.map(function (p) { return p[0]; });
  return Math.max.apply(null, xs) - Math.min.apply(null, xs) < VP.width * Overlay.WRAP_FRACTION;
}));
ok('wrapped path is not closed', Overlay.ringToPath(seam).indexOf('Z') === -1);

head('6  pickVisible chooses a legible band');
var wide = Overlay.pickVisible(chain, boundaryOf, ortho(ra0, dec0, 400), { viewport: VP });
ok('wide field draws only coarse cells', wide.draw.length > 0 && wide.deepest.cell.order < 12,
   'deepest drawn = order ' + (wide.deepest && wide.deepest.cell.order));
ok('deep cells reported as sub-pixel', wide.subPixel.length > 0, String(wide.subPixel.length));
ok('drawn cells are all >= minPx', wide.draw.every(function (e) { return e.px >= 6; }));
ok('coarsest first', wide.draw.every(function (e, i) {
  return i === 0 || e.cell.order > wide.draw[i - 1].cell.order;
}));
console.log('        ' + Overlay.legibility(wide, deepOrder));

var tight = Overlay.pickVisible(chain, boundaryOf, ortho(ra0, dec0, 4e10), { viewport: VP });
ok('tight field reaches deeper', tight.deepest.cell.order > wide.deepest.cell.order,
   'wide ' + wide.deepest.cell.order + ' -> tight ' + tight.deepest.cell.order);
ok('and drops oversized ancestors', tight.oversized.length > 0, String(tight.oversized.length));
console.log('        ' + Overlay.legibility(tight, deepOrder));

head('7  no order-29 ceiling on what we can draw');
var deep = chain.filter(function (c) { return c.order === deepOrder; })[0];
ok('the test cell really is order 34', deep.order === 34);
ok('and is beyond standard MOC', Sky.toMoc(deep.quaternary).standard === false);
// zoom until a 12 microarcsecond cell is a visible size on screen
var huge = Overlay.projectRing(boundaryOf(deep), ortho(ra0, dec0, 5e12), { viewport: VP });
ok('order-34 cell projects to a real outline', huge.visible && huge.maxPx > 10,
   huge.maxPx.toFixed(1) + ' px for a ' + Sky.cellSize(34).text + ' cell');
ok('and closes properly', /Z$/.test(Overlay.ringToPath(huge)));

head('8  path strings are well formed');
var p8 = Overlay.ringToPath(Overlay.projectRing(boundaryOf(big), ortho(ra0, dec0, 60000), { viewport: VP }));
ok('starts with M', p8.indexOf('M') === 0);
ok('no NaN', p8.indexOf('NaN') === -1);
ok('no Infinity', p8.indexOf('Infinity') === -1);
ok('honours precision option', Overlay.ringToPath(
  Overlay.projectRing(boundaryOf(big), ortho(ra0, dec0, 60000), { viewport: VP }),
  { precision: 0 }).indexOf('.') === -1);

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
