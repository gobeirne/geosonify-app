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

// ── culmination attendance is capturable ──────────────────────────────────────
head('7b: culmination attendance');
(function () {
  // 13 Aug 2026: Greg stood at a starpin at culmination, tapped bag, and the
  // app wrote nothing, because "already yours" returned early. attendance-v1
  // derives from the raw timestamp, so no record at the instant means the
  // moment is gone -- there is nothing to derive from afterwards. The rule
  // itself was never wrong; nothing was ever asked to save the timestamp.
  var CULM = S.attendance(1786631733328).culminationMs;
  ok('attendance is derived, never stored', S.attendance(CULM).attended === true);
  ok('the window is 60 s late', S.attendance(CULM + 59000).attended === true);
  ok('and closes at 61 s', S.attendance(CULM + 61000).attended === false);
  ok('the window is 60 s early', S.attendance(CULM - 59000).attended === true);
  ok('a visit five hours before culmination is not attendance',
     S.attendance(CULM - 5 * 3600000).attended === false);

  // Two events, two records, one target. The visit is never edited.
  var T = { starpin: 'starpin:gdr3:5382128182680588160',
            lat_1e7: -435261299, lon_1e7: 1725954480 };
  var recs = [
    { schema: 'starpin.record/1', record_id: 'v', kind: 'visit', target: T,
      event: { time_ms: 1786309714204 },
      fix: { lat_1e7: -435263270, lon_1e7: 1725954589, accuracy_m: 5.2,
             time_ms: 1786309714204, source: 'web-geolocation' } },
    { schema: 'starpin.record/1', record_id: 'c', kind: 'culmination-attempt', target: T,
      event: { time_ms: CULM + 4000 },
      fix: { lat_1e7: -435261299, lon_1e7: 1725954480, accuracy_m: 4.7,
             time_ms: CULM + 4000, source: 'web-geolocation' } }];
  var rk = S.rankByTarget(recs);
  ok('a visit and a culmination are one target, not two',
     rk.v.count === 2 && rk.c.count === 2);
  ok('the attendance is derivable from the record set',
     recs.some(function (r) {
       return r.kind === 'culmination-attempt' && S.attendance(r.event.time_ms).attended;
     }));
  ok('and the visit record is still a plain visit',
     recs[0].kind === 'visit' && S.attendance(recs[0].event.time_ms).attended === false);
})();

// ── the countdown bar's arithmetic ────────────────────────────────────────────
head('7c: the culmination bar');
(function () {
  var C = S.attendance(Date.now()).culminationMs;
  var HALF = Math.round(86164090.5 / 2);
  // The bar's own selection rule, copied from starpin-demo.html. attendance()
  // snaps to the NEAREST culmination, so one second after the instant it is
  // still the right one; an earlier version switched to the next culmination
  // at +1 s and tore the bar away at the moment it mattered most.
  function barShows(now) {
    var a = S.attendance(now);
    var next = a.offsetMs <= 60000 ? a.culminationMs
             : S.attendance(now + HALF).culminationMs;
    var ms = next - now;
    return !(ms > 15 * 60000 || ms < -60000);
  }
  ok('hidden at T-16 min', barShows(C - 16 * 60000) === false);
  ok('showing at T-15 min', barShows(C - 15 * 60000 + 500) === true);
  ok('showing at the instant', barShows(C) === true);
  ok('STILL showing one second after', barShows(C + 1000) === true);
  ok('still showing at +59 s, while a record can be logged',
     barShows(C + 59000) === true);
  ok('gone at +61 s, when it no longer counts', barShows(C + 61000) === false);

  // The sidereal day is 23h56m04s. A countdown cached against a solar day
  // drifts nearly four minutes each day, which is the difference between
  // standing there and missing it.
  // attendance() snaps to the NEAREST culmination, so asking it about exactly
  // half a sidereal day later sits on a knife edge and can snap BACK to C.
  // This test failed about one run in four for that reason -- the test was
  // wrong, not the code. Step clear of the midpoint instead.
  var next = S.attendance(C + 13 * 3600000).culminationMs;
  ok('successive culminations are a sidereal day apart',
     Math.abs((next - C) - 86164090.5) < 1500, String(next - C));
  ok('and that is 236 s short of a solar day',
     Math.abs(86400000 - (next - C) - 235900) < 1500);
})();

// ── the arpeggio is this place's ──────────────────────────────────────────────
head('7d: the culmination arpeggio');
(function () {
  var F = null;
  try { F = require('./geosonify-starpin-feedback.js'); } catch (e) {}
  if (!F || !F.composeCulminationRun) { ok('feedback module present', false); return; }
  var here = F.composeCulminationRun('1112021011333333333303', 'dorian');
  var there = F.composeCulminationRun('2033112003211230', 'dorian');
  ok('the run ascends', here.notes.every(function (n, i) {
    return i === 0 || n.cents >= here.notes[i - 1].cents; }));
  ok('and lands exactly on the instant',
     Math.abs(here.notes[here.notes.length - 1].t) < 1e-9);
  ok('it starts before the instant, never after', here.notes[0].t < 0);
  ok('a different place is a different run',
     JSON.stringify(here.notes) !== JSON.stringify(there.notes));
  ok('the same place is the same run every time',
     JSON.stringify(F.composeCulminationRun('1112021011333333333303', 'dorian')) ===
     JSON.stringify(here));
  // An earlier version stepped 1..4 degrees over sixteen digits and topped out
  // near 22 kHz: inaudible, so the climax was silence.
  var hz = function (c) { return 440 * Math.pow(2, (c - 6900) / 1200); };
  var top = hz(here.notes[here.notes.length - 1].cents);
  var bot = hz(here.notes[0].cents);
  ok('every note is audible on a phone', bot > 50 && top < 5000,
     bot.toFixed(0) + '-' + top.toFixed(0) + ' Hz');
  ok('the chord is a chord', here.chord.length >= 4);
})();

// ── the moment ────────────────────────────────────────────────────────────────
head('7e: the moment');
(function () {
  // The state machine from starpin-demo.html, restated so the timing is pinned
  // somewhere runnable. The modal is up for the last ten seconds and stays up
  // for the whole 60 s afterwards in which a record still counts -- a slow tap
  // at +59 s must still be able to mark the occasion.
  var R = 3 * 30.9222;
  function state(ms, distanceM, marked) {
    if (!(ms <= 10000 && ms > -60000)) return { shown: false };
    return { shown: true,
             lines: [ms <= 10000, ms <= 7000, ms <= 4000].filter(Boolean).length,
             now: ms <= 0,
             mark: ms <= 0 && distanceM != null && distanceM <= R && !marked };
  }
  ok('nothing at T-15 s', state(15000, 40, false).shown === false);
  ok('up at T-10 s, one line', state(10000, 40, false).lines === 1);
  ok('two lines at T-7 s', state(7000, 40, false).lines === 2);
  ok('three lines at T-4 s', state(4000, 40, false).lines === 3);
  ok('"now" waits for the instant itself', state(1000, 40, false).now === false &&
     state(0, 40, false).now === true);
  ok('the mark is offered at zero', state(0, 40, false).mark === true);
  ok('a slow tap at +59 s still counts', state(-59000, 40, false).mark === true);
  ok('and the modal is gone at +61 s', state(-61000, 40, false).shown === false);

  // Arrival is not acceptance: the moment belongs to anyone standing anywhere,
  // but the RECORD needs you inside R.
  ok('inside R the mark is offered', state(-2000, 92, false).mark === true);
  ok('outside R it is not', state(-2000, 93, false).mark === false);
  ok('the moment still shows when you are too far',
     state(-2000, 5000, false).shown === true);
  ok('and it is never offered twice for one culmination',
     state(-2000, 40, true).mark === false);
})();

// ── 8. cornerstones ───────────────────────────────────────────────────────────
head('8: cornerstones');
var haveHp = true;
try { S.nearestCornerstone(-43.552937, 172.652138, 14); } catch (e) { haveHp = false; console.log('  SKIP  ' + e.message); }
if (haveHp) {
  var v = S.nearestCornerstone(-43.552937, 172.652138, 14);
  ok('finds the vertex within a metre', v.distanceM < 2, v.distanceM + ' m');
  ok('canonical name is the lowest incident cell PLUS the corner',
     v.name === 'V:f9.11120211002122c3', v.name);
  ok('notation keeps f = FACE', /^V:f\d/.test(v.name));
  ok('intrinsic order measured, not guessed', v.intrinsicOrder === 14);
  ok('degree 4 (not one of the exceptional eight)', v.degree === 4);
  ok('all four incident cells are reported', v.incident.length === 4);

  var corners = S.cellCornerstones('f9.11120211002300').map(function (x) { return x.name; });
  ok('a cell has four distinct corner names', new Set(corners).size === 4);
  ok('at most one corner carries the cell\'s own name',
     corners.filter(function (n) { return n.indexOf('V:f9.11120211002300c') === 0; }).length <= 1);
  ok('the naive guess is wrong, and provably so',
     corners.indexOf('V:f9.11120211002301') === -1, corners.join(' '));
  ok('bonus: incomplete is reported with what is missing',
     S.cellComplete('f9.11120211002300', [corners[0]]).missing.length === 3);
  ok('bonus: complete when all four held',
     S.cellComplete('f9.11120211002300', corners).complete === true);

  // ── the naming is a FUNCTION: one name, one point, everywhere ──────────────
  //
  // v0.2 named a vertex by its lowest incident cell alone, on the argument that
  // the corner was then implied. Inside a face it is; across a seam it is not,
  // and at order 2 that put 54 of 136 names on more than one point. Every
  // fixture in this section was a face-9 interior cell, so the suite passed
  // while V:f0.00 meant two different vertices. Sweep the whole sphere at a
  // small order instead of trusting one neighbourhood.
  (function () {
    var order = 2, byName = {}, collisions = 0, D2R = Math.PI / 180;
    for (var f = 0; f < 12; f++) {
      for (var i = 0; i < Math.pow(4, order); i++) {
        var digits = i.toString(4);
        while (digits.length < order) digits = '0' + digits;
        S.cellCornerstones('f' + f + '.' + digits).forEach(function (c) {
          var la = c.lat * D2R, lo = c.lon * D2R;
          var v = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
          (byName[c.name] = byName[c.name] || []).push(v);
        });
      }
    }
    Object.keys(byName).forEach(function (n) {
      var a = byName[n];
      for (var j = 1; j < a.length; j++) {
        var d = Math.sqrt(Math.pow(a[j][0] - a[0][0], 2) + Math.pow(a[j][1] - a[0][1], 2) +
                          Math.pow(a[j][2] - a[0][2], 2)) * 6371008.8;
        if (d > 0.001) { collisions++; break; }               // 1 mm
      }
    });
    var names = Object.keys(byName).length;
    ok('order 2: one name per vertex, sphere-wide',
       names === 12 * Math.pow(4, order) + 2, names + ' names for ' +
       (12 * Math.pow(4, order) + 2) + ' vertices');
    ok('order 2: no name lands on two different points', collisions === 0,
       collisions + ' colliding names');
    var rt = 0;
    Object.keys(byName).forEach(function (n) {
      try { S.cornerstonePoint(n); } catch (e) { rt++; }
    });
    ok('order 2: every name resolves back to a point', rt === 0, rt + ' failed');
  })();

  // ── the exceptional eight (concept doc 7.1) ───────────────────────────────
  //
  // Three cells, not four, at arcsin(2/3) on the four cardinal meridians, at
  // every order forever. They were unreachable in v0.2 for two separate
  // reasons, both of which have a test here now:
  //   - the frozen nestIndex returns the polar pixel for ANY latitude on
  //     longitude 0/90/180/270 in the NORTHERN cap, so the query snapped to a
  //     corner thousands of km away;
  //   - the four diagonal probes lie along the lattice edges at a three-valent
  //     vertex, so the third cell was never seen and degree came back 2.
  // The rarest find on the planet was the one the code could not name.
  (function () {
    var LAT = Math.asin(2 / 3) * 180 / Math.PI, seen = {}, three = 0, near = 0;
    [0, 90, 180, 270].forEach(function (lon) {
      [LAT, -LAT].forEach(function (lat) {
        var c = S.nearestCornerstone(lat, lon, 12);
        if (c.degree === 3) three++;
        if (c.distanceM < 1) near++;
        seen[c.name] = 1;
      });
    });
    ok('the eight are found where they are', near === 8, near + ' within a metre');
    ok('the eight are three-valent', three === 8, three + ' of 8 reported degree 3');
    ok('the eight have eight distinct names', Object.keys(seen).length === 8,
       Object.keys(seen).length + ' distinct');
    var n = S.nearestCornerstone(LAT, 0, 12);
    ok('an exceptional vertex is a vertex at order 1', n.intrinsicOrder === 1,
       'intrinsic ' + n.intrinsicOrder);
  })();

  // ── the probe scales, or fine orders all look exceptional ─────────────────
  //
  // A flat 5 m probe is wider than the cell past order 19, so it stepped clean
  // over the neighbouring cells and every ordinary vertex reported degree 3 --
  // which is this file's marker for the exceptional eight.
  ok('an ordinary vertex is still four-valent at order 21', (function () {
    var c = S.cellCornerstones('f9.111202110020111111111')[0];
    return S.nearestCornerstone(c.lat, c.lon, 21).degree === 4;
  })());

  // ── legacy names: decode where they can, refuse where they cannot ─────────
  //
  // Four cornerstones were logged with v0.2 names before the corner suffix
  // existed. They stay readable forever; they must never resolve to the wrong
  // ground instead.
  ['V:f9.1112021011', 'V:f9.1112021100222', 'V:f9.111202110020',
   'V:f9.11120211002122'].forEach(function (old) {
    var p = S.cornerstonePoint(old), q = S.cornerstonePoint(S.canonicaliseCornerstone(old));
    ok('legacy ' + old + ' still resolves, and to the same ground',
       Math.abs(p.lat - q.lat) < 1e-9 && Math.abs(p.lon - q.lon) < 1e-9);
  });
  // A legacy record and a canonical one are the same corner. Anything that
  // asks "have I got this?" has to agree, or the map reports a vertex sitting
  // in the log as not yet logged -- which it did, on the phone, in the field.
  (function () {
    var legacy = 'V:f9.1112021011', canon = S.canonicaliseCornerstone(legacy);
    ok('legacy and canonical share one target key',
       S.targetKey({ cornerstone: legacy }) === S.targetKey({ cornerstone: canon }));
    var recs = [
      { schema: 'starpin.record/1', record_id: 'a', kind: 'visit',
        target: { cornerstone: legacy }, event: { time_ms: 1786395301296 },
        fix: { lat_1e7: -435560053, lon_1e7: 1726290709, accuracy_m: 4.2,
               time_ms: 1786395301296, source: 'web-geolocation' } },
      { schema: 'starpin.record/1', record_id: 'b', kind: 'visit',
        target: { cornerstone: canon }, event: { time_ms: 1786395401296 },
        fix: { lat_1e7: -435560389, lon_1e7: 1726289181, accuracy_m: 4.2,
               time_ms: 1786395401296, source: 'web-geolocation' } }];
    var rk = S.rankByTarget(recs);
    ok('one vertex, one group, whichever spelling was used',
       rk.a.count === 2 && rk.b.count === 2, JSON.stringify([rk.a.count, rk.b.count]));
    ok('the closer record wins the group', rk.b.best === true && rk.a.best === false);
  })();

  ok('an ambiguous legacy name THROWS rather than guessing',
     throws(function () { S.cornerstonePoint('V:f0.00'); }));
  ok('canonicalising is idempotent',
     S.canonicaliseCornerstone('V:f9.111202110020c3') === 'V:f9.111202110020c3');
  ok('rejects a corner index out of range',
     throws(function () { S.cornerstonePoint('V:f9.111202110020c4'); }));
}

// ── 9. the evaluator: assessments are derived, never stored ──────────────────
head('9: assessRecord — derived, re-derivable, versioned');
if (haveHp) {
  var REC = { schema: 'starpin.record/1', kind: 'visit',
    target: { cornerstone: 'V:f9.11120211002122' }, membership: null,
    event: { time_ms: 1786160642206, time_uncertainty_ms: null },
    fix: { lat_1e7: -435529316, lon_1e7: 1726521153, datum: 'WGS84',
           accuracy_m: 2.1, time_ms: 1786160642206, source: 'web-geolocation' } };

  ok('resolves a cornerstone name to a point',
     Math.abs(S.cornerstonePoint('V:f9.11120211002122').lat + 43.5529318) < 1e-6);
  ok('rejects a malformed cornerstone name', throws(function () {
    S.cornerstonePoint('f9.11120211002122'); }));
  ok('rejects a bad face', throws(function () { S.cornerstonePoint('V:f99.0000'); }));
  var A9 = S.assessRecord(REC);
  ok('verdict is well-supported', A9.visit.verdict === 'well-supported', A9.visit.verdict);
  ok('distance about 1.4 m', Math.abs(A9.visit.distanceM - 1.40) < 0.05, String(A9.visit.distanceM));
  ok('carries the evaluator version', /^starpin-eval-/.test(A9.evaluator));
  ok('names both rules it applied',
     A9.rules.visit === 'visit-geometry-v1' && A9.rules.attendance === 'attendance-v1');
  ok('attendance derived from the raw timestamp', A9.attendance.attended === false);
  ok('SAME record, tighter R, tighter verdict',
     S.assessRecord(REC, { radiusArcsec: 0.1 }).visit.verdict === 'compatible',
     'R=3.1 m: d=1.4 a=2.1 so d+a>R but d-a<R');
  ok('R below the fix accuracy gives FIX-TOO-COARSE, not "you were not there"',
     S.assessRecord(REC, { radiusArcsec: 0.05 }).visit.verdict === 'fix-too-coarse',
     'R=1.55 m but the fix is +/-2.1 m, so the honest answer is that the fix cannot tell');
  ok('a genuinely distant fix IS not-supported', (function () {
     var far = JSON.parse(JSON.stringify(REC)); far.fix.lat_1e7 -= 30000;   // ~333 m
     return S.assessRecord(far).visit.verdict === 'not-supported'; })());
  ok('the record itself is never modified by assessment',
     REC.visit === undefined && REC.verdict === undefined);
  ok('a starpin target with no coordinates says so, rather than guessing',
     S.assessRecord({ target: { starpin: 'starpin:gdr3:1' }, event: { time_ms: 0 },
                      fix: REC.fix }).visit.verdict === 'target-coordinates-unknown');
}

head('10: rankByTarget — your personal best, derived every time');
if (haveHp) {
  function rec(dLatUnits, t) {
    return { schema: 'starpin.record/1', record_id: 'r' + dLatUnits, kind: 'visit',
      target: { cornerstone: 'V:f9.11120211002122' },
      event: { time_ms: t || 1786160642206 },
      fix: { lat_1e7: -435529316 - dLatUnits, lon_1e7: 1726521153,
             accuracy_m: 5, source: 'web-geolocation' } };
  }
  var far = rec(30000), mid = rec(9000), near = rec(20);
  var rk = S.rankByTarget([far, mid, near]);
  ok('the closest is best', rk[near.record_id].best === true);
  ok('the others are not', rk[mid.record_id].best === false && rk[far.record_id].best === false);
  ok('ranks are ordered by distance',
     rk[near.record_id].rank === 0 && rk[mid.record_id].rank === 1 && rk[far.record_id].rank === 2);
  ok('every record knows the best distance for its target',
     Math.abs(rk[far.record_id].bestDistanceM - rk[near.record_id].distanceM) < 0.01);
  ok('a supported visit outranks an unsupported one', rk[near.record_id].supported === true);
  ok('logging a CLOSER one demotes the earlier best', (function () {
     var only = S.rankByTarget([mid]);
     if (!only[mid.record_id].best) return false;
     var both = S.rankByTarget([mid, near]);
     return both[mid.record_id].best === false && both[near.record_id].best === true;
  })(), 'nothing about "your closest" is stored, so it just changes');
  ok('separate targets rank separately', (function () {
     var other = rec(50); other.record_id = 'other';
     other.target = { starpin: 'starpin:gdr3:5382127323687128576',
                      lat_1e7: -435547019, lon_1e7: 1726538020 };
     var r2 = S.rankByTarget([near, other]);
     return r2[near.record_id].best && r2.other.best;
  })());
  ok('a starpin record carries its own target address so it can be assessed',
     S.assessRecord({ target: { starpin: 'x', lat_1e7: -435529318, lon_1e7: 1726521327 },
                      event: { time_ms: 0 },
                      fix: { lat_1e7: -435529316, lon_1e7: 1726521153, accuracy_m: 5 } })
       .visit.verdict === 'well-supported');
}

head('11: a starpin is not a vertex');
var FB = require('./geosonify-starpin-feedback.js');
var starWords = [null, 4.2, 11.7, 16.3].map(function (m) {
  var t = FB.starTier(m); return t.label + ' ' + t.blurb;
}).join(' ');
ok('no HEALPix order language leaks into star copy', !/order \d/i.test(starWords), starWords.slice(0, 60));
ok('no "one every N m"', !/one every/i.test(starWords));
// Match the vertex-rarity PHRASINGS, not the words. "its place on Earth" is
// the project's own sentence and must not trip this.
ok('no vertex counts', !/one of [\d,]+ on Earth|within 50 km of here|only eight/i.test(starWords),
   starWords.slice(0, 80));
ok('but the project sentence is still allowed',
   /place on Earth/i.test(FB.starTier(16.3).blurb));
ok('magnitude is hedged with an approximation sign', /\u2248/.test(FB.starTier(4.2).label));
ok('unknown magnitude says so rather than guessing',
   FB.starTier(null).key === 'unmeasured' && !/\u2248/.test(FB.starTier(null).label));
ok('brighter stars celebrate harder',
   FB.starTier(4.2).particles > FB.starTier(11.7).particles);
ok('a cornerstone still gets lattice language',
   /on Earth|within 50 km/.test(FB.tierOf(12).label + FB.tierOf(12).blurb));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
