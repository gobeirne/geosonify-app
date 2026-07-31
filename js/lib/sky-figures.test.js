'use strict';
var F = require('./geosonify-sky-figures.js');
var S = require('./geosonify-sky-shapes.js');
var Sky = require('./geosonify-sky.js'); var HP = require('./geosonify-healpix.js');
Sky.setEngine(HP);
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }

head('star positions are plausible');
var b = F.star('betelgeuse');
ok('Betelgeuse RA ~ 88.79 deg', Math.abs(b.ra - 88.7929) < 0.01, String(b.ra));
ok('Betelgeuse Dec ~ +7.407', Math.abs(b.dec - 7.4069) < 0.01, String(b.dec));
ok('Rigel is south of the equator', F.star('rigel').dec < 0);
ok('Acrux is far south', F.star('acrux').dec < -60);
ok('the belt stars are within a degree of the equator',
   ['mintaka','alnilam','alnitak'].every(function (k) { return Math.abs(F.star(k).dec) < 2; }));

head('the belt really is a belt');
var m = F.star('mintaka'), a = F.star('alnilam'), z = F.star('alnitak');
var d1 = S.separationArcsec(m.ra, m.dec, a.ra, a.dec) / 3600;
var d2 = S.separationArcsec(a.ra, a.dec, z.ra, z.dec) / 3600;
// Checked against the coordinates by hand: 4m12s of RA and 54' of Dec gives
// 1.39 deg; 4m33s and 44' gives 1.36 deg. My first guesses (1.34, 1.22) were
// eyeballed and wrong — these are what the positions actually imply.
ok('Mintaka-Alnilam is ~1.39 deg', Math.abs(d1 - 1.386) < 0.02, d1.toFixed(3));
ok('Alnilam-Alnitak is ~1.36 deg', Math.abs(d2 - 1.356) < 0.02, d2.toFixed(3));
/*
  The belt is NOT straight. The two segments differ in position angle by 7.6
  degrees — a shallow arc you can see with the naked eye. A 5-degree tolerance
  asserted a straightness the sky does not have; 10 degrees admits the real bend
  while still catching a transposed coordinate.
*/
var paBelt1 = S.positionAngleDeg(m.ra, m.dec, a.ra, a.dec);
var paBelt2 = S.positionAngleDeg(a.ra, a.dec, z.ra, z.dec);
ok('the belt is a shallow arc, bending ~7.6 deg', Math.abs(Math.abs(paBelt1 - paBelt2) - 7.6) < 1,
   paBelt1.toFixed(1) + ' vs ' + paBelt2.toFixed(1));
ok('but close enough to a line to read as a belt', Math.abs(paBelt1 - paBelt2) < 10);

head('figures convert to paths');
var paths = F.toPaths('orion');
ok('six segments', paths.length === 6, String(paths.length));
ok('the belt segment has three vertices', paths[2].length === 3);
ok('vertices are [dec, ra]', Math.abs(paths[2][0][0] - m.dec) < 1e-9 && Math.abs(paths[2][0][1] - m.ra) < 1e-9);
ok('seven distinct stars in Orion', F.vertices('orion').length === 7, String(F.vertices('orion').length));
ok('four in Crux', F.vertices('crux').length === 4);

head('bounds frame the figure');
var ob = F.bounds('orion');
ok('Orion spans ~17 deg', Math.abs(ob.spanDeg - 17.1) < 1, ob.spanDeg.toFixed(2));
// The centre is the midpoint of Rigel (RA 78.6) and Betelgeuse (RA 88.8), not
// Betelgeuse itself — which is what I had absent-mindedly asserted.
ok('centred at RA 83.7, midway between Rigel and Betelgeuse',
   Math.abs(ob.raCentre - 83.71) < 0.1, ob.raCentre.toFixed(2));
ok('Crux is much smaller', F.bounds('crux').spanDeg < ob.spanDeg);

head('a constellation fits in a URL');
function urlCost(fig, k) {
  return F.vertices(fig).map(function (s) {
    var d = HP.nestPath(HP.nestIndex(s.dec, s.ra, k), k);
    return HP._ser.serHex(d.f, d.digits, {});
  }).join('~').length;
}
ok('Orion at order 10 is under 60 chars', urlCost('orion', 10) < 60, String(urlCost('orion', 10)));
ok('Orion at order 14 is under 80 chars', urlCost('orion', 14) < 80, String(urlCost('orion', 14)));
ok('Crux at order 12 is under 40 chars', urlCost('crux', 12) < 40, String(urlCost('crux', 12)));
ok('deeper orders cost more, as they should', urlCost('orion', 14) > urlCost('orion', 10));

head('codes round-trip to the right stars');
var star = F.star('rigel');
var k = 12;
var ip = HP.nestIndex(star.dec, star.ra, k);
var back = HP.nestCentre(ip, k);
ok('Rigel round-trips within one cell', S.separationArcsec(star.ra, star.dec, back[1], back[0]) < Sky.cellSize(k).arcsec,
   S.separationArcsec(star.ra, star.dec, back[1], back[0]).toFixed(2) + '" vs cell ' + Sky.cellSize(k).text);

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
