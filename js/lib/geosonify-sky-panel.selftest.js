/*
  geosonify-sky-panel.selftest.js  — run: node geosonify-sky-panel.selftest.js
  Needs geosonify-sky.js and geosonify-healpix.js alongside it.

  Tests the PURE compute() path only — no DOM. Gates:
    1  compute() agrees with the cards' own encoder at the same order
    2  Appendix A coordinate reproduces the Appendix A cell
    3  truncation holds: lower order = ancestor of higher order
    4  order 29/30 boundary flips the `standard` flag correctly
    5  deep orders report bit width and a correct order-29 fallback
    6  missing coordinate and missing deps degrade, never throw
    7  the zenith moves with time; the sky address does not
*/
'use strict';

globalThis.GeosonifySky = require('./geosonify-sky.js');
globalThis.HealpixGrids = require('./geosonify-healpix.js');
var Panel = require('./geosonify-sky-panel.js');
var HP = globalThis.HealpixGrids;

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }

var LAT = -43.55548056777462, LON = 172.6509186643265;
var WHEN = new Date('2026-07-30T09:00:00Z');

head('1  compute() agrees with the HEALPix card encoder');
var mismatch = 0;
for (var k = 1; k <= 40; k++) {
  var r = Panel.compute(LAT, LON, k, WHEN);
  var viaCard = HP.encodeStandalone ? null : null;   // not all builds expose it
  var expect = 'f' + HP.nestPath(HP.nestIndex(LAT, LON, k), k).f + '.' +
               HP.nestPath(HP.nestIndex(LAT, LON, k), k).digits.join('');
  if (r.quaternary !== expect) mismatch++;
}
ok('orders 1-40 match HealpixGrids.nestIndex/nestPath', mismatch === 0, mismatch + ' mismatches');

head('2  Appendix A');
var r22 = Panel.compute(LAT, LON, 22, WHEN);
ok('quaternary = f9.1112021100230000201202', r22.quaternary === 'f9.1112021100230000201202', r22.quaternary);
ok('MOC = 22/164249493047394', r22.moc === '22/164249493047394', r22.moc);
ok('NUNIQ = 234618237225054', r22.nuniq === '234618237225054', r22.nuniq);
ok('cell size = 50.3 mas', r22.cellSize === '50.3 mas', r22.cellSize);
ok('flagged standard', r22.standard === true);
ok('no fallback offered', r22.approx === undefined);
console.log('  sky address : ' + r22.skyRA + '  ' + r22.skyDec);
console.log('  designation : ' + r22.designation);

head('3  truncation: coarser order is an ancestor');
var badTrunc = [];
for (var k2 = 2; k2 <= 45; k2++) {
  var fine = Panel.compute(LAT, LON, k2, WHEN);
  var coarse = Panel.compute(LAT, LON, k2 - 1, WHEN);
  if (fine.quaternary.indexOf(coarse.quaternary) !== 0) badTrunc.push(k2);
  if ((fine.ipix >> 2n) !== coarse.ipix) badTrunc.push(k2 + 'i');
}
ok('order k-1 is a prefix of order k, orders 2-45', badTrunc.length === 0, badTrunc.join(','));

head('4  the order-29 standard boundary');
ok('order 29 is standard', Panel.compute(LAT, LON, 29, WHEN).standard === true);
ok('order 30 is not standard', Panel.compute(LAT, LON, 30, WHEN).standard === false);
ok('order 29 offers no fallback', Panel.compute(LAT, LON, 29, WHEN).approx === undefined);
ok('order 30 offers a fallback', !!Panel.compute(LAT, LON, 30, WHEN).approx);

head('5  deep orders');
var r34 = Panel.compute(LAT, LON, 34, WHEN);
ok('order 34 reports bit width > 64', r34.bits > 64, String(r34.bits));
ok('fallback is order 29', r34.approx.moc.indexOf('29/') === 0, r34.approx.moc);
ok('area factor = 1024', r34.approx.areaFactor === '1024', r34.approx.areaFactor);
var anc = Panel.compute(LAT, LON, 29, WHEN);
ok('fallback equals the real order-29 cell', r34.approx.moc === anc.moc, r34.approx.moc + ' vs ' + anc.moc);
ok('cell size = 12.29 uas', r34.cellSize === '12.29 uas', r34.cellSize);
console.log('  order 34 MOC : ' + r34.moc);
console.log('  fallback     : ' + r34.approx.moc + '  (' + r34.approx.note + ')');

head('6  degrades without throwing');
ok('null coordinate returns unavailable', !!Panel.compute(null, null, 22, WHEN).unavailable);
var savedHP = globalThis.HealpixGrids;
globalThis.HealpixGrids = null;
var noHP = Panel.compute(LAT, LON, 22, WHEN);
globalThis.HealpixGrids = savedHP;
ok('missing HealpixGrids returns unavailable', !!noHP.unavailable, JSON.stringify(noHP));

head('7  zenith moves, sky address does not');
var t1 = Panel.compute(LAT, LON, 22, new Date('2026-07-30T09:00:00Z'));
var t2 = Panel.compute(LAT, LON, 22, new Date('2026-07-30T15:00:00Z'));
ok('sky address identical 6h later', t1.skyRA === t2.skyRA && t1.skyDec === t2.skyDec);
ok('MOC identical 6h later', t1.moc === t2.moc);
ok('zenith RA differs 6h later', t1.zenithRA !== t2.zenithRA, t1.zenithRA + ' vs ' + t2.zenithRA);
console.log('  09:00 UTC overhead : ' + t1.zenithRA + '  ' + t1.zenithDec);
console.log('  15:00 UTC overhead : ' + t2.zenithRA + '  ' + t2.zenithDec);

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
