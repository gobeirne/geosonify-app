/*
  geosonify-sky-shapes.selftest.js — run: node geosonify-sky-shapes.selftest.js

  Checked against closed-form spherical results, not against itself.
*/
'use strict';
var S = require('./geosonify-sky-shapes.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }
var AS = 3600;

head('offset is exact spherical, not planar');
// 90 degrees north from the equator lands exactly on the pole, from any longitude
[0, 45, 179, 300].forEach(function (lon) {
  var p = S.offset(lon, 0, Math.PI / 2, 0);
  ok('90 deg north from lon ' + lon + ' -> the pole', Math.abs(p[0] - 90) < 1e-9, String(p[0]));
});
// a 1-degree offset east from the equator moves 1 degree of longitude
var e = S.offset(10, 0, 1 * Math.PI / 180, Math.PI / 2);
ok('1 deg east at the equator is 1 deg of longitude', Math.abs(e[1] - 11) < 1e-9, String(e[1]));
ok('and stays on the equator', Math.abs(e[0]) < 1e-9);

head('circle is a true small circle');
var c = S.circle(137, -22, 900, { steps: 180 });          // 15 arcmin
var worst = 0;
c.forEach(function (p) { worst = Math.max(worst, Math.abs(S.separationArcsec(137, -22, p[1], p[0]) - 900)); });
ok('every point is exactly the radius away', worst < 1e-6, worst.toExponential(2) + ' arcsec error');
ok('closed ring', c[0][0] === c[c.length - 1][0] && c[0][1] === c[c.length - 1][1]);

var big = S.circle(0, 0, 20 * AS, { steps: 360 });        // 20 degrees
var worstBig = 0;
big.forEach(function (p) { worstBig = Math.max(worstBig, Math.abs(S.separationArcsec(0, 0, p[1], p[0]) - 20 * AS)); });
ok('exact at 20 degrees too (a planar circle would fail here)', worstBig < 1e-6,
   worstBig.toExponential(2) + ' arcsec');

head('circle area matches the closed form 2*pi*(1-cos r)');
[[60, 1], [3600, 1], [10 * AS, 1]].forEach(function (t) {
  var r = t[0];
  var expect = 2 * Math.PI * (1 - Math.cos(r / 206264.80624709636)) * (180 / Math.PI) * (180 / Math.PI);
  ok(r + '" -> ' + S.circleAreaDeg2(r).toExponential(4) + ' deg2',
     Math.abs(S.circleAreaDeg2(r) - expect) < 1e-12);
});
ok('a 1-degree-radius circle is ~3.1414 deg2', Math.abs(S.circleAreaDeg2(3600) - 3.1414) < 1e-3,
   S.circleAreaDeg2(3600).toFixed(5));

head('ellipse degenerates to a circle when a == b');
var el = S.ellipse(50, 30, 600, 600, 37, { steps: 120 });
var worstE = 0;
el.forEach(function (p) { worstE = Math.max(worstE, Math.abs(S.separationArcsec(50, 30, p[1], p[0]) - 600)); });
ok('every point is the radius away regardless of PA', worstE < 1e-6, worstE.toExponential(2));

head('position angle really is North through East');
var maj = S.ellipse(0, 0, 3600, 900, 0, { steps: 4 });    // PA 0: major axis N-S
var pa0 = maj[0];                                         // t=0 -> along the major axis
ok('PA 0 puts the major axis due North', Math.abs(S.positionAngleDeg(0, 0, pa0[1], pa0[0])) < 1e-6 ||
   Math.abs(S.positionAngleDeg(0, 0, pa0[1], pa0[0]) - 360) < 1e-6,
   String(S.positionAngleDeg(0, 0, pa0[1], pa0[0])));
var maj90 = S.ellipse(0, 0, 3600, 900, 90, { steps: 4 })[0];
ok('PA 90 puts it due East', Math.abs(S.positionAngleDeg(0, 0, maj90[1], maj90[0]) - 90) < 1e-6,
   String(S.positionAngleDeg(0, 0, maj90[1], maj90[0])));
ok('major axis is longer than minor', S.separationArcsec(0, 0, pa0[1], pa0[0]) > 3599.9,
   String(S.separationArcsec(0, 0, pa0[1], pa0[0])));

head('ellipse containment');
ok('centre is inside', S.ellipseContains(0, 0, 3600, 900, 0, 0, 0));
ok('just inside the major axis', S.ellipseContains(0, 0, 3600, 900, 0, 0, 0.99));
ok('just outside the major axis', !S.ellipseContains(0, 0, 3600, 900, 0, 0, 1.01));
ok('inside along major but outside along minor', !S.ellipseContains(0, 0, 3600, 900, 0, 0.5, 0),
   'a point 0.5 deg east should be outside a 0.25 deg semi-minor');
ok('rotating PA by 90 swaps which axis is long',
   S.ellipseContains(0, 0, 3600, 900, 90, 0.9, 0) && !S.ellipseContains(0, 0, 3600, 900, 0, 0.9, 0));

head('rectangle');
var r = S.rectangle(0, 0, 1800, 3600, 0, { stepsPerEdge: 1 });   // 0.5 x 1 deg, PA 0
ok('four corners plus closure', r.length === 5, String(r.length));

/*
  A CORNER of this rectangle does NOT sit at dec 0.5. Confirmed by hand:
  separation 2012.46", PA atan2(900,1800) = 26.565 deg, so
      sin(dec) = sin(rho) cos(PA)  ->  dec = 0.4999984134
  A planar rectangle would put it at exactly 0.5; a spherical one does not, and
  that difference IS the sphere. Asserting 0.5 here would have baked a planar
  approximation into the tests and quietly rewarded the wrong implementation.

  What IS exactly 0.5 is the MIDPOINT of the north edge, which lies due north of
  the centre at PA 0 — so that is what gets asserted.
*/
ok('the corner is at the exact spherical dec, not the planar one',
   Math.abs(Math.max.apply(null, r.map(function (p) { return p[0]; })) - 0.4999984134) < 1e-9,
   String(Math.max.apply(null, r.map(function (p) { return p[0]; }))));
var r8 = S.rectangle(0, 0, 1800, 3600, 0, { stepsPerEdge: 8 });
ok('north edge midpoint is exactly half the height', 
   Math.abs(Math.max.apply(null, r8.map(function (p) { return p[0]; })) - 0.5) < 1e-12,
   String(Math.max.apply(null, r8.map(function (p) { return p[0]; }))));
var rot = S.rectangle(0, 0, 1800, 3600, 90, { stepsPerEdge: 8 });
ok('PA 90 lays it on its side (half the WIDTH now N-S)',
   Math.abs(Math.max.apply(null, rot.map(function (p) { return p[0]; })) - 0.25) < 1e-12,
   String(Math.max.apply(null, rot.map(function (p) { return p[0]; }))));
ok('area is width x height in deg2', Math.abs(S.rectangleAreaDeg2(1800, 3600) - 0.5) < 1e-12);

head('polygon and path need no units at all');
var poly = S.polygon([[0, 0], [1, 0], [1, 1]]);
ok('polygon closes', poly.length === 4 && poly[0][0] === poly[3][0]);
ok('path does not close', S.path([[0, 0], [1, 1]]).length === 2);
ok('longitudes normalised to [0,360)', S.polygon([[0, -10]])[0][1] === 350);

head('Earth conversions, so ellipses work on the ground too');
ok('1 arcsec is ~30.9 m at the equator', Math.abs(S.arcsecToMetres(1) - 30.92) < 0.01,
   S.arcsecToMetres(1).toFixed(3));
ok('round-trips', Math.abs(S.metresToArcsec(S.arcsecToMetres(1234)) - 1234) < 1e-9);
var earthCircle = S.circle(174.7, -41.3, S.metresToArcsec(1000), { steps: 90 });
var worstM = 0;
earthCircle.forEach(function (p) {
  worstM = Math.max(worstM, Math.abs(S.arcsecToMetres(S.separationArcsec(174.7, -41.3, p[1], p[0])) - 1000));
});
ok('a 1 km circle on Earth is accurate to a millimetre', worstM < 0.001, worstM.toExponential(2) + ' m');

head('poles do not break it');
var polar = S.circle(0, 89.9, 3600, { steps: 72 });
ok('a circle straddling the pole stays on the sphere',
   polar.every(function (p) { return p[0] <= 90 && p[0] >= -90 && isFinite(p[1]); }));
ok('and every point is still the right distance away',
   polar.every(function (p) { return Math.abs(S.separationArcsec(0, 89.9, p[1], p[0]) - 3600) < 1e-6; }));

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
