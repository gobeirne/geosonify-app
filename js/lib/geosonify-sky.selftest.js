/*
  geosonify-sky.selftest.js  — run:  node geosonify-sky.selftest.js
  Requires geosonify-healpix.js alongside it (for convention cross-checks).

  Gates:
    1  quaternary <-> ipix agrees with HealpixGrids at many random cells
    2  Appendix A frozen vector reproduces exactly
    3  MOC round-trip is exact at orders 1..60 (past every reference ceiling)
    4  NUNIQ round-trip is exact, and beats the vendored uniq2orderpix ceiling
    5  Number safety: rounded/oversized Numbers are REFUSED, not coerced
    6  bit-width proof: order 34 needs >64 bits, so u64 tools cannot hold it
    7  mocApprox degrades to order 29 with the correct area factor
    8  sexagesimal round-trips to sub-mas, incl. carry and sign edges
    9  parser accepts every common spelling
   10  sidereal time matches astropy's 2026-07-30 numbers
   11  cell sizes match the published table
*/
'use strict';

var Sky = require('./geosonify-sky.js');
var HP = null;
try { HP = require('./geosonify-healpix.js'); } catch (e) {}

var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }
function head(s) { console.log('\n' + s); }

// ---- 1  convention agreement with the live engine ------------------------
head('1  quaternary <-> ipix agrees with HealpixGrids');
if (!HP) { console.log('  SKIP  geosonify-healpix.js not found'); }
else {
  var mismatch = 0, checked = 0;
  for (var k = 1; k <= 40; k++) {
    for (var t = 0; t < 25; t++) {
      var face = Math.floor(Math.random() * 12);
      var digits = [];
      for (var i = 0; i < k; i++) digits.push(Math.floor(Math.random() * 4));
      var mine = Sky.cellToIpix(face, digits).ipix;
      var theirs = BigInt(HP.pathToNest(face, digits));
      if (mine !== theirs) mismatch++;
      var back = Sky.ipixToCell(k, mine);
      if (back.face !== face || back.digits.join('') !== digits.join('')) mismatch++;
      checked++;
    }
  }
  ok('1,000 random cells, orders 1-40, agree with engine', mismatch === 0, mismatch + ' mismatches');
}

// ---- 2  the frozen Appendix A vector ------------------------------------
head('2  Appendix A vector');
var Q = 'f9.1112021100230000201202';
var m = Sky.toMoc(Q);
ok('order = 22', m.order === 22, String(m.order));
ok('ipix = 164249493047394', m.ipix === 164249493047394n, m.ipix.toString());
ok('MOC = 22/164249493047394', m.moc === '22/164249493047394', m.moc);
ok('NUNIQ = 234618237225054', m.nuniq === 234618237225054n, m.nuniq.toString());
ok('is standard MOC (order <= 29)', m.standard === true);
var back = Sky.fromMoc('22/164249493047394');
ok('MOC -> quaternary round-trips', back.quaternary === Q, back.quaternary);

// ---- 3  MOC round-trip well past the u64 ceiling ------------------------
head('3  MOC round-trip, orders 1-60');
var bad = [];
for (var o = 1; o <= 60; o++) {
  var face = o % 12;
  var digits = [];
  for (var i = 0; i < o; i++) digits.push((i * 7 + o) % 4);
  var q = Sky.formatQuaternary(face, digits);
  var r = Sky.toMoc(q);
  var rt = Sky.fromMoc(r.moc);
  if (rt.quaternary !== q) bad.push(o);
  if (rt.ipix !== r.ipix) bad.push(o + 'i');
}
ok('exact at every order 1-60', bad.length === 0, 'failed at ' + bad.join(','));

// ---- 4  NUNIQ, incl. where the vendored version dies -------------------
head('4  NUNIQ round-trip');
var nbad = [];
for (var o2 = 0; o2 <= 60; o2++) {
  var ip = Sky.cellsPerSphere(o2) - 1n;         // last cell at this order
  var u = Sky.nuniq(o2, ip);
  var un = Sky.fromNuniq(u);
  if (un.order !== o2 || un.ipix !== ip) nbad.push(o2);
}
ok('exact at every order 0-60 (last cell)', nbad.length === 0, 'failed at ' + nbad.join(','));
var u16 = Sky.nuniq(16, 12345678n);
ok('order 16 NUNIQ exceeds vendored assert (0x7fffffff)', u16 > 0x7fffffffn, u16.toString());
ok('  ...and still unpacks correctly', Sky.fromNuniq(u16).order === 16);

// ---- 5  Number safety --------------------------------------------------
head('5  Number safety: refuse, do not coerce');
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }
ok('rejects non-integer Number', throws(function () { Sky.toBig(1.5); }));
ok('rejects Number > MAX_SAFE_INTEGER', throws(function () { Sky.toBig(1e17); }));
ok('accepts decimal string', Sky.toBig('164249493047394') === 164249493047394n);
ok('accepts BigInt', Sky.toBig(7n) === 7n);
ok('rejects ipix out of range for order', throws(function () { Sky.ipixToCell(2, 999n); }));
ok('rejects quaternary digit 4', throws(function () { Sky.parseQuaternary('f9.1112021100230000201204'); }));
ok('rejects face 12', throws(function () { Sky.parseQuaternary('f12.0123'); }));

// ---- 6  bit-width proof ------------------------------------------------
head('6  bit-width: what a uint64 tool cannot hold');
function bits(b) { return b.toString(2).length; }
[[29, 'MOC 2.0 ceiling'], [30, ''], [34, 'Gaia-precision band'], [40, '']].forEach(function (row) {
  var o = row[0];
  var maxIpix = Sky.cellsPerSphere(o) - 1n;
  var maxUniq = Sky.nuniq(o, maxIpix);
  var fits = bits(maxUniq) <= 64;
  console.log('  order ' + String(o).padStart(2) + ':  ipix ' + String(bits(maxIpix)).padStart(3) +
              ' bits, NUNIQ ' + String(bits(maxUniq)).padStart(3) + ' bits   ' +
              (fits ? 'fits u64' : 'DOES NOT FIT u64') + (row[1] ? '   (' + row[1] + ')' : ''));
});
ok('order 29 NUNIQ fits u64', bits(Sky.nuniq(29, Sky.cellsPerSphere(29) - 1n)) <= 64);
ok('order 34 NUNIQ does NOT fit u64', bits(Sky.nuniq(34, Sky.cellsPerSphere(34) - 1n)) > 64);
var deep = Sky.toMoc(Sky.formatQuaternary(9, Array.from({ length: 34 }, function (_, i) { return (i * 3) % 4; })));
ok('order 34 MOC string is produced exactly', deep.moc.split('/')[1].length === deep.ipix.toString().length);
ok('order 34 flagged as non-standard', deep.standard === false);
console.log('  order 34 example: ' + deep.moc);
console.log('  its NUNIQ:        ' + deep.nuniq.toString());

// ---- 7  lossy degradation is labelled ----------------------------------
head('7  mocApprox: order-29 ancestor');
var ap = Sky.mocApprox(deep.order, deep.ipix);
ok('degrades to order 29', ap.order === 29 && ap.degraded === true);
ok('area factor = 4^5 = 1024', ap.areaFactor === 1024n, ap.areaFactor.toString());
ok('ancestor contains the deep cell', (deep.ipix >> 10n) === ap.ipix);
ok('no degradation when already standard', Sky.mocApprox(22, m.ipix).degraded === false);

// ---- 8  sexagesimal round-trip ----------------------------------------
head('8  sexagesimal');
var worst = 0;
for (var n = 0; n < 20000; n++) {
  var ra = Math.random() * 360;
  var de = Math.random() * 180 - 90;
  var raBack = Sky.parseSexagesimal(Sky.formatRA(ra, { decimals: 4, delimiter: 'spaces' }), true);
  var deBack = Sky.parseSexagesimal(Sky.formatDec(de, { decimals: 3, delimiter: 'spaces' }), false);
  worst = Math.max(worst, Math.abs(raBack - ra) * 3600, Math.abs(deBack - de) * 3600);
}
ok('20,000 round-trips within 1 mas', worst < 0.001, 'worst ' + (worst * 1000).toFixed(3) + ' mas');
ok('carry: 59.9999s does not print 60', Sky.formatRA(15 * (11 + 59 / 60 + 59.9999 / 3600), { decimals: 2 }) === '12h 00m 00.00s',
   Sky.formatRA(15 * (11 + 59 / 60 + 59.9999 / 3600), { decimals: 2 }));
ok('negative dec keeps sign', Sky.formatDec(-0.5, { delimiter: 'spaces' }).charAt(0) === '-', Sky.formatDec(-0.5, { delimiter: 'spaces' }));
ok('dec +0 is +', Sky.formatDec(0.5, { delimiter: 'spaces' }).charAt(0) === '+');
ok('RA wraps 360 -> 0', Sky.formatRA(360) === '00h 00m 00.00s', Sky.formatRA(360));
ok('rejects |dec| > 90', throws(function () { Sky.formatDec(91); }));

head('8b  designations truncate, never round');
// Dec -43 33 19.55" must NOT become ...433320, which names a box the point is
// outside. Containment is the whole point of a truncatable identifier.
var dLat = -43.555431565421, dLon = 172.650929689407;
ok('truncates seconds', Sky.designation(dLon, dLat) === 'J113036.2-433319', Sky.designation(dLon, dLat));
ok('rounding opt-in still available', Sky.designation(dLon, dLat, { round: true }) === 'J113036.2-433320',
   Sky.designation(dLon, dLat, { round: true }));
var trWorst = 0;
for (var q = 0; q < 20000; q++) {
  var ra2 = Math.random() * 360, de2 = Math.random() * 180 - 90;
  var dg = Sky.designation(ra2, de2);
  // reconstruct the box the designation names and check the point is inside it
  var hh = +dg.slice(1, 3), mmm = +dg.slice(3, 5), sss = parseFloat(dg.slice(5, 9));
  var sgn = dg.charAt(9) === '-' ? -1 : 1;
  var dd2 = +dg.slice(10, 12), dm = +dg.slice(12, 14), ds = +dg.slice(14, 16);
  var raBox = (hh + mmm / 60 + sss / 3600) * 15;
  var deBox = sgn * (dd2 + dm / 60 + ds / 3600);
  // truncation means the box floor is at or below the true value
  if (raBox > ra2 + 1e-9 || (sgn > 0 ? deBox > de2 + 1e-9 : deBox < de2 - 1e-9)) trWorst++;
}
ok('20,000 designations name a containing box', trWorst === 0, trWorst + ' escaped the box');

head('8b  designations truncate, so short names stay prefixes of long ones');
var dec = -(43 + 33 / 60 + 19.64 / 3600), ra = 172.65090833;
var d0 = Sky.designation(ra, dec, { raDecimals: 0, decDecimals: 0 });
var d1 = Sky.designation(ra, dec, { raDecimals: 1, decDecimals: 1 });
var d2 = Sky.designation(ra, dec, { raDecimals: 2, decDecimals: 2 });
ok('19.64" truncates to 19, never rounds to 20', d0.indexOf('-433319') > 0, d0);
ok('sexagesimal display still rounds to 19.6', Sky.formatDec(dec, { delimiter: 'spaces' }).indexOf('19.6') > 0,
   Sky.formatDec(dec, { delimiter: 'spaces' }));
ok('RA part refines as a prefix', d1.split('-')[0].indexOf(d0.split('-')[0]) === 0, d0 + ' -> ' + d1);
ok('Dec part refines as a prefix', ('-' + d1.split('-')[1]).indexOf('-' + d0.split('-')[1]) === 0, d0 + ' -> ' + d1);
ok('and again at 2 decimals', d2.split('-')[0].indexOf(d1.split('-')[0]) === 0, d1 + ' -> ' + d2);
ok('carry guard survives 59.999s', Sky.designation(15 * (11 + 59 / 60 + 59.999 / 3600), 0.5, { raDecimals: 0 }) === 'J115959+003000',
   Sky.designation(15 * (11 + 59 / 60 + 59.999 / 3600), 0.5, { raDecimals: 0 }));

head('8c  decimals scale with order');
var dcTest = -(43 + 33 / 60 + 19.598 / 3600);
ok('order 12 needs no decimals', Sky.autoDecimals(12, dcTest).ra === 0);
ok('order 22 needs 3 RA / 2 Dec', Sky.autoDecimals(22, dcTest).ra === 3 && Sky.autoDecimals(22, dcTest).dec === 2,
   JSON.stringify(Sky.autoDecimals(22, dcTest)));
ok('RA always needs >= Dec decimals', [8, 12, 16, 22, 26, 29, 34].every(function (k) {
  var a = Sky.autoDecimals(k, dcTest); return a.ra >= a.dec;
}));
ok('quantum is finer than half a cell at order 22', (function () {
  var a = Sky.autoDecimals(22, dcTest);
  var raQ = Math.pow(10, -a.ra) * 15 * Math.cos(dcTest * Math.PI / 180);
  return raQ <= a.cellArcsec / 2;
})());
ok('capped at 7 and finite at the pole', Sky.autoDecimals(60, 89.9999).ra === 7);
ok('order 22 reproduces Aladin to displayed precision',
   Sky.formatRA(15 * (11 + 30 / 60 + 36.219 / 3600), { decimals: 3 }) === '11h 30m 36.219s',
   Sky.formatRA(15 * (11 + 30 / 60 + 36.219 / 3600), { decimals: 3 }));

// ---- 9  parser spellings -----------------------------------------------
head('9  parser accepts common spellings');
// 11h 30m 36.22s is 172.65091666... deg -- two-decimal seconds carry only
// ~0.026 arcsec, so each case is compared against what its own text implies.
var sexaTarget = 15 * (11 + 30 / 60 + 36.22 / 3600);
var degTarget = 172.6509186643265;
[['11h30m36.22s', true, sexaTarget], ['11 30 36.22', true, sexaTarget],
 ['11:30:36.22', true, sexaTarget], ['11h 30m 36.22s', true, sexaTarget],
 ['172.6509186643265', false, degTarget], ['172.6509186643265deg', false, degTarget],
 ['172.6509186643265 degrees', false, degTarget]].forEach(function (c) {
  var got = Sky.parseSexagesimal(c[0], c[1]);
  ok('"' + c[0] + '"', near(got, c[2], 1e-9), got.toFixed(9));
});
ok('two-decimal seconds resolve to 0.03 arcsec of the exact value',
   Math.abs(sexaTarget - degTarget) * 3600 < 0.05,
   (Math.abs(sexaTarget - degTarget) * 3600).toFixed(3) + '"');
ok('unicode minus in dec', near(Sky.parseSexagesimal('\u221243\u00b0 33\u2032 19.7\u2033', false), -43.5554722, 1e-5));

// ---- 10  sidereal time vs astropy 8.0.1 --------------------------------
head('10  sidereal time vs astropy (2026-07-30T09:00:00Z, lon 172.6509186643265)');
var lat = -43.55548056777462, lon = 172.6509186643265;
var when = new Date('2026-07-30T09:00:00Z');
var z = Sky.zenith(lat, lon, when);
ok('LST = 17.044488 h (astropy apparent 17.044654)', near(z.lstHours, 17.044488, 2e-5), z.lstHours.toFixed(6));
ok('zenith RA = 255.66732 deg', near(z.raDeg, 255.66732, 1e-4), z.raDeg.toFixed(5));
ok('zenith Dec = geodetic latitude exactly', z.decDeg === lat);
var apparentRA = 255.66990;                        // astropy TETE
ok('within 10 arcsec of apparent of-date RA', Math.abs(z.raDeg - apparentRA) * 3600 < 10,
   ((z.raDeg - apparentRA) * 3600).toFixed(1) + '"');
var icrsRA = 255.18552, icrsDec = -43.51408;       // astropy ICRS
var sep = Math.acos(Math.sin(lat / 57.29578) * Math.sin(icrsDec / 57.29578) +
          Math.cos(lat / 57.29578) * Math.cos(icrsDec / 57.29578) *
          Math.cos((z.raDeg - icrsRA) / 57.29578)) * 57.29578;
ok('ICRS separation ~0.354 deg (precession, expected)', near(sep, 0.3536, 0.01), sep.toFixed(4) + ' deg');
console.log('  frame label: ' + z.frame);

// ---- 11  cell sizes ----------------------------------------------------
head('11  cell size table');
[[12, 51.53], [22, 0.0503], [29, 0.000393], [34, 0.0000123]].forEach(function (r) {
  var s = Sky.cellSize(r[0]);
  ok('order ' + r[0] + ' = ' + s.text, near(s.arcsec, r[1], Math.abs(r[1]) * 0.01), s.arcsec.toExponential(4));
});

// ---- readout smoke test ------------------------------------------------
head('readout() for the Appendix A cell');
var R = Sky.readout(lat, lon, Q, when);
console.log('  sky address : ' + R.skyRA + '  ' + R.skyDec);
console.log('  designation : ' + R.designation);
console.log('  cell size   : ' + R.cellSize);
console.log('  MOC         : ' + R.moc + (R.standard ? '  (standard)' : '  (NON-standard)'));
console.log('  NUNIQ       : ' + R.nuniq);
console.log('  overhead    : ' + R.zenith.ra + '  ' + R.zenith.dec + '   [' + R.zenith.frame + ']');

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
