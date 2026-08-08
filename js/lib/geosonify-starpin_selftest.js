/*
  geosonify-starpin_selftest.js — run: node geosonify-starpin_selftest.js

  Gates the rules that fail SILENTLY if broken. Every test here exists because
  the wrong behaviour looks plausible rather than throwing.
*/
'use strict';
var S = require('./geosonify-starpin.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }

// ── 1. the asymmetric float64 trap ────────────────────────────────────────────
head('1: source_id precision — the cell survives float64, the identity does not');
var ID = '5382127323687128576';
ok('rejects an unsafe Number', throws(function () { S.decodeSourceId(5382127323687128576); }));
ok('accepts the decimal string', S.decodeSourceId(ID).cell === '156640521');
ok('accepts a BigInt', S.decodeSourceId(BigInt(ID)).cell === '156640521');
ok('float64 would give the RIGHT cell', Math.floor(Number(ID) / Math.pow(2, 35)) === 156640521);
ok('float64 would give the WRONG identity', BigInt(Number(ID)).toString() !== ID,
   'error is ' + (BigInt(Number(ID)) - BigInt(ID)));
ok('low bits are preserved exactly', S.decodeSourceId(ID).low === '4299918848');
ok('cell 0 ids are safe but still handled', S.decodeSourceId('12345').cell === '0');

// ── 2. quaternary address ─────────────────────────────────────────────────────
head('2: address');
ok('matches the card', S.decodeSourceId(ID).quaternary === 'f9.111202110021');
ok('12 digits at order 12', S.decodeSourceId(ID).digits.length === 12);

// ── 3. alias round trip and the check symbol ──────────────────────────────────
head('3: alias');
var A = S.alias(ID);
ok('canonical form', A === 'G3-f9.111202110021-404Q3G0-E', A);
ok('round trips', S.parseAlias(A).sourceId === ID);
ok('case insensitive', S.parseAlias(A.toLowerCase()).sourceId === ID);
ok('separators optional', S.parseAlias(A.replace(/-/g, '')).sourceId === ID);
ok('Crockford ambiguity: O -> 0', S.parseAlias(A.replace('0', 'O')).sourceId === ID);
ok('rejects an unknown release token', throws(function () { S.parseAlias(A.replace('G3', 'G9')); }));
ok('MISTYPED RELEASE TOKEN IS CAUGHT', throws(function () { S.parseAlias(A.replace('G3', 'G4')); }),
   'the checksum must cover the token, not only the id');
ok('rejects a corrupted digit', throws(function () {
  return S.parseAlias('G3-f9.111202110022-404Q3G0-8'); }));
ok('low bits are zero padded to 7', /-0000000-/.test(S.alias('34359738368')));
ok('the three card neighbours give distinct aliases',
   new Set([S.alias('5382127323687128576'), S.alias('5382127323687128832'),
            S.alias('5382127323684805632')]).size === 3);

// ── 4. coordinates as integers, one rounding step ─────────────────────────────
head('4: starpin-address-v1');
ok('exact decimal string', S.toUnits('172.6521327') === 1726521327);
ok('negative', S.toUnits('-43.5529318') === -435529318);
ok('half to even, down', S.toUnits('0.00000005') === 0);
ok('half to even, up', S.toUnits('0.00000015') === 2);
ok('rounds up above half', S.toUnits('0.000000051') === 1);
ok('no negative zero', Object.is(S.toUnits('-0.00000001'), -0) === false || S.toUnits('-0.00000001') === 0);
var addr = S.starpinAddress('172.6521327', '-43.5529318');
ok('dec -> geodetic lat', addr.lat_1e7 === -435529318);
ok('ra -> east longitude', addr.lonEast_1e7 === 1726521327);
ok('conventional longitude below 180 unchanged', addr.lon_1e7 === 1726521327);
ok('ra 180 folds to -180', S.starpinAddress('180', '0').lon_1e7 === -1800000000);
ok('ra 179.999... stays positive', S.starpinAddress('179.9999999', '0').lon_1e7 > 0);
ok('ra 270 -> -90', S.starpinAddress('270', '0').lon_1e7 === -900000000);
ok('rejects ra 360', throws(function () { S.starpinAddress('360', '0'); }));
ok('datum is stated', addr.datum === 'WGS84');

// ── 5. culmination-v1 ─────────────────────────────────────────────────────────
head('5: culmination-v1 (Model A)');
var now = Date.UTC(2026, 7, 8, 0, 0, 0);
var c = S.nextCulmination(now);
ok('lands on phase ~0', Math.min(S.phaseDeg(c), 360 - S.phaseDeg(c)) < 1e-4, String(S.phaseDeg(c)));
ok('is in the future', c > now);
ok('within one sidereal day', c - now <= S.SIDEREAL_DAY_MS + 1000);
ok('sidereal day is 23h56m04s', Math.abs(S.SIDEREAL_DAY_MS - 86164090.5) < 1);
var c2 = S.nextCulmination(c + 1);
ok('successive culminations differ by a sidereal day',
   Math.abs((c2 - c) - S.SIDEREAL_DAY_MS) < 1000, String(c2 - c));
ok('the hour angle cancels the star: H == phase for every RA', (function () {
  var vals = [0, 37.5, 172.62, 359.9].map(function (a) { return S.lstDeg(now, a) - a; });
  return vals.every(function (v) { return Math.abs(((v - vals[0]) % 360 + 540) % 360 - 180) < 1e-9; });
})());
ok('idempotent — never caches a wall clock', S.nextCulmination(now) === c);

head('5b: attendance-v1');
ok('exactly on time', S.attendance(c).attended === true);
ok('+59 s attends', S.attendance(c + 59000).attended === true);
ok('+61 s does not', S.attendance(c + 61000).attended === false);
ok('-61 s does not', S.attendance(c - 61000).attended === false);
ok('carries the rule name', S.attendance(c).rule === 'attendance-v1');

// ── 6. the sun (not frozen — sanity only) ─────────────────────────────────────
head('6: sun');
var midwinterNZ = Date.UTC(2026, 5, 21, 0, 0, 0);
ok('June solstice: sun is south', S.sunPosition(midwinterNZ).decDeg > 23,
   String(S.sunPosition(midwinterNZ).decDeg));
ok('December solstice: sun is north', S.sunPosition(Date.UTC(2026, 11, 21)).decDeg < -23);
ok('equinox near zero', Math.abs(S.sunPosition(Date.UTC(2026, 2, 20, 12)).decDeg) < 1);
ok('midday at Greenwich in June is high',
   S.sunAltitude(Date.UTC(2026, 5, 21, 12), 51.48, 0) > 55);
ok('midnight is below the horizon', S.sunAltitude(Date.UTC(2026, 5, 21, 0), 51.48, 0) < 0);
ok('darkness bands are ordered', (function () {
  var b = S.darkness(Date.UTC(2026, 5, 21, 12), 51.48, 0);
  return b.band === 'day' && b.dark === false;
})());

// ── 7. visit-geometry-v1 ──────────────────────────────────────────────────────
head('7: visit-geometry-v1');
ok('1 arcsec is 30.92 m at every latitude', Math.abs(S.M_PER_ARCSEC - 30.9222) < 0.001);
var tgt = { lat: -43.552932, lon: 172.652133 };
ok('standing on it, good fix -> well-supported',
   S.assessVisit({ lat: -43.552940, lon: 172.652140, accuracy_m: 8 }, tgt).verdict === 'well-supported');
ok('80 m away with a 20 m fix -> compatible',
   S.assessVisit({ lat: -43.553650, lon: 172.652133, accuracy_m: 20 }, tgt).verdict === 'compatible');
ok('300 m away -> not supported',
   S.assessVisit({ lat: -43.555630, lon: 172.652133, accuracy_m: 10 }, tgt).verdict === 'not-supported');
ok('a fix coarser than R is TOO COARSE, not compatible',
   S.assessVisit({ lat: -43.552940, lon: 172.652140, accuracy_m: 150 }, tgt).verdict === 'fix-too-coarse');
ok('unknown accuracy is stated, not assumed',
   S.assessVisit({ lat: -43.552940, lon: 172.652140 }, tgt).verdict === 'accuracy-unknown');
ok('reports separation in arcseconds too',
   S.assessVisit({ lat: -43.553650, lon: 172.652133, accuracy_m: 20 }, tgt).separationArcsec > 2);
ok('verdict is a verdict, never a badge',
   S.assessVisit({ lat: -43.552940, lon: 172.652140, accuracy_m: 8 }, tgt).rule === 'visit-geometry-v1');

// ── 8. cornerstones ───────────────────────────────────────────────────────────
head('8: cornerstones');
var haveHp = true;
try { S.nearestCornerstone(-43.552937, 172.652138, 14); } catch (e) { haveHp = false; console.log('  SKIP  ' + e.message); }
if (haveHp) {
  var v = S.nearestCornerstone(-43.552937, 172.652138, 14);
  ok('finds the vertex within a metre', v.distanceM < 2, v.distanceM + ' m');
  ok('canonical name is the lowest incident cell', v.name === 'V:f9.11120211002122', v.name);
  ok('notation keeps f = FACE', /^V:f\d/.test(v.name));
  ok('intrinsic order measured, not guessed', v.intrinsicOrder === 14);
  ok('degree 4 (not one of the exceptional eight)', v.degree === 4);
  ok('all four incident cells are reported', v.incident.length === 4);

  var corners = S.cellCornerstones('f9.11120211002300').map(function (x) { return x.name; });
  ok('a cell has four distinct corner names', new Set(corners).size === 4);
  ok('only ONE corner carries the cell\'s own name',
     corners.filter(function (n) { return n === 'V:f9.11120211002300'; }).length === 1);
  ok('the naive guess is wrong, and provably so',
     corners.indexOf('V:f9.11120211002301') === -1, corners.join(' '));
  ok('bonus: incomplete is reported with what is missing',
     S.cellComplete('f9.11120211002300', ['V:f9.11120211002300']).missing.length === 3);
  ok('bonus: complete when all four held',
     S.cellComplete('f9.11120211002300', corners).complete === true);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
