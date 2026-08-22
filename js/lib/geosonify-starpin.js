/*
  geosonify-starpin.js v0.1 — the Starpin engine

  Zero-build, no dependencies except (optionally) HealpixGrids for cornerstones.
  Browser: window.GeosonifyStarpin.   Node: require('./geosonify-starpin.js').

  What lives here, and what is frozen vs provisional:

    identity      source_id -> selection cell -> quaternary address -> alias   [freeze candidate]
    address       ra/dec -> integer 1e-7 degree terrestrial address            [freeze candidate]
    culmination   culmination-v1, Model A: a synthetic sidereal phase from     [freeze candidate]
                  integer Unix ms. A protocol event, NOT a measurement of
                  Earth orientation. Makes no claim of a bound to UT1.
    sun           low-precision solar position, ~0.01 deg. NOT frozen — this
                  is the observation engine and is expected to improve.
    visit         visit-geometry-v1, R in arcseconds.                          [provisional R]
    cornerstone   nearest HEALPix vertex, canonical name, intrinsic order.     [provisional]

  Two rules this file exists to enforce:

    1. source_id is NEVER a Number. The failure is asymmetric and silent:
       Number("5382127323687128576") is wrong by 512, but 512 << 2^35, so the
       CELL still comes out right while the IDENTITY is corrupted. Every
       integer path here is BigInt or decimal string.

    2. Coordinates are integers in units of 1e-7 degrees, everywhere. No
       float64 in the address path, no negative zero, one rounding step.
*/
'use strict';

var GeosonifyStarpin = (function () {

  // ── constants ─────────────────────────────────────────────────────────────

  var SELECTION_ORDER = 12;                  // Gaia encodes the L12 pixel; 13+ is closed
  var ID_SHIFT        = 35n;                 // source_id >> 35 == level-12 nested pixel
  var UNIT            = 10000000;            // 1e-7 degrees per integer unit
  var M_PER_DEG       = 111319.9;            // matches geosonify-healpix.js line ~651
  var M_PER_ARCSEC    = M_PER_DEG / 3600;    // 30.9222 m — constant at every latitude
  var JD_J2000        = 2451545.0;
  var JD_UNIX_EPOCH   = 2440587.5;
  var SIDEREAL_RATE   = 360.98564736629;     // deg per day, frozen
  var SIDEREAL_DAY_MS = 86400000 * 360 / SIDEREAL_RATE;   // 86164090.5 ms

  // visit-geometry-v1. Provisional: R is a game rule, not physics.
  var VISIT_R_ARCSEC  = 3;                   // 92.77 m

  // Crockford base32, and the 5 extra check symbols
  var B32   = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  var CHECK = B32 + '*~$=U';

  // Frozen registry of catalogue release tokens. Unknown tokens are rejected,
  // never guessed — a source_id is not guaranteed unique across releases.
  var RELEASES = { 'G3': 'gaia-dr3', 'G4': 'gaia-dr4', 'CSN': 'iau-csn' };

  // ── small helpers ─────────────────────────────────────────────────────────

  function wrap360(x) { return x - 360 * Math.floor(x / 360); }
  function toBig(v, what) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'string') {
      if (!/^-?\d+$/.test(v.trim())) throw new Error(what + ': not a decimal integer string');
      return BigInt(v.trim());
    }
    if (typeof v === 'number') {
      if (!Number.isSafeInteger(v))
        throw new Error(what + ': ' + v + ' is outside the safe integer range. ' +
                        'Pass a BigInt or a decimal string — a rounded source_id ' +
                        'still yields the right CELL, which is why this must throw.');
      return BigInt(v);
    }
    throw new Error(what + ': expected BigInt, safe integer, or decimal string');
  }

  // ── identity ──────────────────────────────────────────────────────────────

  // source_id -> {cell, low, face, digits, quaternary}
  // The trailing digit run of anything that names a Gaia source: a display
  // name, a starpin URI, a bare id. NEVER replace(/\D/g,'') -- that turns
  // "Gaia DR3 5382128178381506048" into "35382128178381506048" (the 3 from
  // DR3) and matches nothing. That bug shipped three times in three files,
  // which is why this lives here and is exported rather than re-typed.
  function sourceIdOf(v) {
    return (String(v == null ? '' : v).match(/(\d{5,})\s*$/) || [])[1] || '';
  }

  function decodeSourceId(sourceId) {
    var id = toBig(sourceId, 'source_id');
    if (id < 0n) throw new Error('source_id: must be non-negative');
    var cell = id >> ID_SHIFT;
    var low  = id & ((1n << ID_SHIFT) - 1n);
    var span = 1n << BigInt(2 * SELECTION_ORDER);          // 4^12
    var face = Number(cell / span);
    if (face > 11) throw new Error('source_id: implies HEALPix face ' + face + ' (>11)');
    var rest = cell - BigInt(face) * span, digits = [];
    for (var i = SELECTION_ORDER - 1; i >= 0; i--) { digits[i] = Number(rest & 3n); rest >>= 2n; }
    return {
      sourceId: id.toString(),
      cell: cell.toString(),
      low: low.toString(),
      face: face,
      digits: digits,
      quaternary: 'f' + face + '.' + digits.join('')
    };
  }

  // Positional mod-37 over the canonical payload, base 257.
  // Covers the release token as well as the identifier — a mistyped token must
  // not pass. Honest limitation: two characters whose codes differ by exactly
  // 37 are not distinguished ('1' vs 'V'); this is not a CRC.
  function checkSymbol(payload) {
    var h = 0n;
    for (var i = 0; i < payload.length; i++) h = (h * 257n + BigInt(payload.charCodeAt(i))) % 37n;
    return CHECK[Number(h)];
  }

  function base32Low(low) {
    var s = '', v = toBig(low, 'low');
    for (var i = 0; i < 7; i++) { s = B32[Number(v & 31n)] + s; v >>= 5n; }
    return s;                                              // always exactly 7, zero-padded
  }

  // G3-f9.111202110021-404Q3G0-8
  function alias(sourceId, release) {
    var rel = (release || 'G3').toUpperCase();
    if (!RELEASES[rel]) throw new Error('alias: unknown release token "' + rel + '"');
    var d = decodeSourceId(sourceId);
    var payload = rel + 'F' + d.face + '.' + d.digits.join('') + base32Low(d.low);
    return rel + '-' + d.quaternary + '-' + base32Low(d.low) + '-' + checkSymbol(payload);
  }

  function parseAlias(str) {
    var s = String(str).toUpperCase().replace(/[\s-]/g, '');
    s = s.replace(/[ILO]/g, function (c) { return c === 'O' ? '0' : '1'; });
    var m = /^([A-Z0-9]{2,3})F(\d{1,2})\.([0-3]+)([0-9A-Z]{7})(.)$/.exec(s);
    if (!m) throw new Error('alias: unparseable "' + str + '"');
    var rel = m[1];
    if (!RELEASES[rel]) throw new Error('alias: unknown release token "' + rel + '"');
    var face = parseInt(m[2], 10), digits = m[3];
    if (face > 11) throw new Error('alias: face ' + face + ' (>11)');
    if (digits.length !== SELECTION_ORDER)
      throw new Error('alias: expected ' + SELECTION_ORDER + ' quaternary digits, got ' + digits.length);
    var low = 0n;
    for (var i = 0; i < 7; i++) {
      var k = B32.indexOf(m[4][i]);
      if (k < 0) throw new Error('alias: bad base32 character "' + m[4][i] + '"');
      low = low * 32n + BigInt(k);
    }
    if (checkSymbol(rel + 'F' + face + '.' + digits + m[4]) !== m[5])
      throw new Error('alias: check symbol failed');
    var cell = 0n;
    for (var j = 0; j < digits.length; j++) cell = cell * 4n + BigInt(digits[j]);
    cell += BigInt(face) * (1n << BigInt(2 * SELECTION_ORDER));
    return { release: rel, catalogue: RELEASES[rel], sourceId: ((cell << ID_SHIFT) + low).toString() };
  }

  // ── the address transform: starpin-address-v1 ─────────────────────────────

  // Exact decimal-string -> integer 1e-7 degrees, round-half-even, no float64.
  function toUnits(decimalString) {
    var s = String(decimalString).trim();
    var m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m) throw new Error('toUnits: not a decimal number: "' + decimalString + '"');
    var sign = m[1] === '-' ? -1n : 1n, intPart = m[2] || '0', frac = m[3] || '';
    var keep = (frac + '00000000').slice(0, 7);
    var rest = frac.slice(7).replace(/0+$/, '');
    var n = BigInt(intPart) * 10000000n + BigInt(keep);
    if (rest.length) {
      var firstDigit = rest.charCodeAt(0) - 48;
      var exactlyHalf = firstDigit === 5 && rest.length === 1;
      if (firstDigit > 5 || (firstDigit === 5 && !exactlyHalf)) n += 1n;
      else if (exactlyHalf && (n & 1n) === 1n) n += 1n;     // half to even
    }
    return Number(sign * n);
  }

  // { ra, dec } as decimal strings or numbers -> the terrestrial address
  function starpinAddress(ra, dec) {
    var raU  = toUnits(ra), decU = toUnits(dec);
    if (raU < 0 || raU >= 360 * UNIT) throw new Error('ra out of [0,360)');
    if (decU < -90 * UNIT || decU > 90 * UNIT) throw new Error('dec out of [-90,90]');
    var lonU = raU >= 180 * UNIT ? raU - 360 * UNIT : raU;   // -> [-180, 180)
    return {
      lat_1e7: decU, lon_1e7: lonU, lonEast_1e7: raU,
      lat: decU / UNIT, lon: lonU / UNIT, lonEast: raU / UNIT,
      datum: 'WGS84'                                          // geodetic: the zenith is the
    };                                                        // ellipsoid normal, not geocentric
  }

  // ── culmination-v1 (Model A) ──────────────────────────────────────────────

  function julianDay(ms) { return ms / 86400000 + JD_UNIX_EPOCH; }

  // The frozen sidereal phase. Fed integer Unix ms, which do not count leap
  // seconds. This is Starpin protocol time by definition; it is not a claim
  // about Earth orientation, and its separation from apparent meridian transit
  // is not bounded forever. That is the honest cost of replayability.
  function phaseDeg(ms) {
    var d = julianDay(ms) - JD_J2000, T = d / 36525;
    return wrap360(280.46061837 + SIDEREAL_RATE * d + 0.000387933 * T * T - (T * T * T) / 38710000);
  }

  function lstDeg(ms, lonEastDeg) { return wrap360(phaseDeg(ms) + lonEastDeg); }

  // Next instant at or after ms where phase == 0. Linear estimate, then bisect.
  function nextCulmination(ms) {
    var t0 = Math.floor(ms), g0 = phaseDeg(t0);
    if (g0 === 0) return t0;
    var t = t0 + ((360 - g0) / SIDEREAL_RATE) * 86400000;
    var lo = t - 2000, hi = t + 2000;
    function resid(x) { var g = phaseDeg(x); return g > 180 ? g - 360 : g; }   // signed, near zero
    if (resid(lo) > 0) lo = t - 60000;
    if (resid(hi) < 0) hi = t + 60000;
    for (var i = 0; i < 64 && hi - lo > 1; i++) {
      var mid = (lo + hi) / 2;
      if (resid(mid) < 0) lo = mid; else hi = mid;
    }
    var out = Math.round(hi);
    return out < t0 ? t0 : out;
  }



  // attendance-v1: a separately versioned game rule, never a stored boolean.
  var ATTENDANCE_WINDOW_MS = 60000;
  function attendance(eventMs) {
    var next = nextCulmination(eventMs);
    var prev = nextCulmination(next - Math.round(SIDEREAL_DAY_MS) - 1000);
    var t = Math.abs(eventMs - prev) <= Math.abs(eventMs - next) ? prev : next;
    return { rule: 'attendance-v1', culminationMs: t, offsetMs: eventMs - t,
             attended: Math.abs(eventMs - t) <= ATTENDANCE_WINDOW_MS };
  }

  // ── the sun (observation engine — NOT frozen) ─────────────────────────────

  var D2R = Math.PI / 180, R2D = 180 / Math.PI;

  function sunPosition(ms) {
    var n = julianDay(ms) - JD_J2000;
    var L = wrap360(280.460 + 0.9856474 * n);
    var g = wrap360(357.528 + 0.9856003 * n) * D2R;
    var lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
    var eps = (23.439 - 0.0000004 * n) * D2R;
    var ra = wrap360(Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) * R2D);
    var dec = Math.asin(Math.sin(eps) * Math.sin(lam)) * R2D;
    return { raDeg: ra, decDeg: dec };
  }

  function sunAltitude(ms, latDeg, lonEastDeg) {
    var s = sunPosition(ms);
    var H = (lstDeg(ms, lonEastDeg) - s.raDeg) * D2R;
    var phi = latDeg * D2R, dec = s.decDeg * D2R;
    return Math.asin(Math.sin(phi) * Math.sin(dec) +
                     Math.cos(phi) * Math.cos(dec) * Math.cos(H)) * R2D;
  }

  function darkness(ms, latDeg, lonEastDeg) {
    var a = sunAltitude(ms, latDeg, lonEastDeg);
    var band = a > -0.833 ? 'day'
             : a > -6     ? 'civil'
             : a > -12    ? 'nautical'
             : a > -18    ? 'astronomical' : 'night';
    return { sunAltDeg: a, band: band, dark: a <= -12 };     // nautical or darker
  }

  // ── visit-geometry-v1 ─────────────────────────────────────────────────────

  function haversineM(lat1, lon1, lat2, lon2) {
    var p = (lat2 - lat1) * D2R, q = (lon2 - lon1) * D2R;
    var h = Math.sin(p / 2) * Math.sin(p / 2) +
            Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(q / 2) * Math.sin(q / 2);
    return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
  }

  // Returns a verdict, never a badge. R defaults to 3 arcsec (92.77 m).
  // A fix coarser than R cannot support anything — that is 'fix-too-coarse',
  // not 'compatible', or a bad urban fix weakly supports the whole street.
  function assessVisit(fix, target, opts) {
    var R = ((opts && opts.radiusArcsec) || VISIT_R_ARCSEC) * M_PER_ARCSEC;
    var d = haversineM(fix.lat, fix.lon, target.lat, target.lon);
    var a = (fix.accuracy_m == null) ? null : Math.abs(fix.accuracy_m);
    var out = { rule: 'visit-geometry-v1', radiusM: R, distanceM: d, accuracyM: a,
                separationArcsec: d / M_PER_ARCSEC };
    if (a == null)        out.verdict = 'accuracy-unknown';
    else if (a > R)       out.verdict = 'fix-too-coarse';
    else if (d + a <= R)  out.verdict = 'well-supported';
    else if (d - a <= R)  out.verdict = 'compatible';
    else                  out.verdict = 'not-supported';
    return out;
  }

  // ── cornerstones ──────────────────────────────────────────────────────────
  //
  // Notation: the cell keeps its address unchanged, because 'f9' means FACE 9.
  // A vertex is the same string with an object tag in front:
  //
  //     f9.11120211002122       the cell
  //   V:f9.11120211002122       the vertex canonically named by that cell
  //
  // Canonical rule: a vertex is shared by up to four cells; it is named by the
  // LOWEST nested index among them, PLUS which corner of that cell it is:
  //
  //     f9.11120211002122       the cell
  //   V:f9.11120211002122c0     the vertex at that cell's (u=0, v=0) corner
  //
  // corner index = 2v + u, where (u, v) are the cell's own unit-square corner
  // coordinates. Naming cell picks the name; corner index makes it a function.
  //
  // The corner suffix is NOT redundant, though v0.2 assumed it was. That
  // assumption needed "the lowest-indexed cell always meets the vertex at the
  // same corner", which is true inside a face and false across a seam, because
  // nested index runs face-major and face numbering is not a geometric order.
  // Measured at order 2 before the fix: 56 of 192 cells named none of their
  // corners, 51 named two or three, and 54 of 136 names resolved to more than
  // one point. V:f0.00 meant two different vertices. Face interiors were fine,
  // which is why every fixture in the suite passed; the seams were not, and the
  // exceptional eight of section 7.1 live exactly on the seams.
  //
  // Legacy: suffix-less names still decode (see cornerstonePoint) wherever they
  // are unambiguous, and throw rather than guess where they are not.

  function hp() {
    var H = (typeof HealpixGrids !== 'undefined') ? HealpixGrids
          : (typeof require === 'function' ? (function () {
              var tries = ['./geosonify-healpix.js', './js/lib/geosonify-healpix.js',
                           '../lib/geosonify-healpix.js', '../../js/lib/geosonify-healpix.js'];
              for (var i = 0; i < tries.length; i++) {
                try { return require(tries[i]); } catch (e) {}
              }
              return null;
            })() : null);
    if (!H) throw new Error('cornerstones need geosonify-healpix.js \u2014 the global ' +
                            'HealpixGrids is absent. Check the <script> path (it lives in ' +
                            'js/lib/) and the browser console for a 404.');
    return H;
  }

  function vec2ll(v) {
    var x = v.x != null ? v.x : v[0], y = v.y != null ? v.y : v[1], z = v.z != null ? v.z : v[2];
    return [Math.asin(z / Math.hypot(x, y, z)) * R2D, Math.atan2(y, x) * R2D];
  }
  // Which corner of `cell` the point (lat, lon) is, as 2v + u, or -1 if it is
  // not a corner of that cell. Compared on the sphere, so no face maths here.
  function cornerIndexIn(H, ipix, order, lat, lon) {
    var nside = Math.pow(2, order), best = -1, bestD = Infinity;
    [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (uv) {
      var ll = vec2ll(H._core.pixcoord2vec_nest(nside, ipix, uv[0], uv[1]));
      var dm = haversineM(lat, lon, ll[0], ll[1]);
      if (dm < bestD) { bestD = dm; best = 2 * uv[1] + uv[0]; }
    });
    return bestD <= probeM(order) ? best : -1;
  }

  // The canonical name of the vertex at (lat, lon), given its incident cells.
  function vertexName(H, inc, order, lat, lon) {
    var c = cornerIndexIn(H, inc[0], order, lat, lon);
    if (c < 0) throw new Error('vertexName: point is not a corner of ' +
                               pathStr(H, inc[0], order));
    return 'V:' + pathStr(H, inc[0], order) + 'c' + c;
  }

  function pathStr(H, ipix, order) {
    var p = H.nestPath(ipix, order);
    return 'f' + (p.f != null ? p.f : p.face) + '.' + p.digits.join('');
  }

  // The four (or three) cells meeting at a vertex, at a given order.
  // The probe steps off the vertex into each quadrant. It must be small
  // relative to the cell at THIS order (or it wanders into cells that do not
  // touch the vertex) and small in absolute terms (or an interior point looks
  // like it sits on a coarse boundary, which is how crossOrder is detected).
  // So: 5 m, shrinking with the cell once the cell is smaller than 40 m.
  // At 5 m flat, every ordinary vertex at order >= 20 reported degree 3 --
  // the marker this file uses for the exceptional eight.
  function probeM(order) {
    var sideM = Math.sqrt(Math.PI / 3) / Math.pow(2, order) * 6371008.8;
    return Math.min(5, sideM / 8);
  }
  // Eight directions at bearings 22.5, 67.5, 112.5 ... Neither the diagonals
  // nor the axes, and both exclusions are load bearing:
  //
  //   - the four DIAGONALS are exactly the directions the lattice edges run in
  //     at a THREE-valent vertex, so a diagonal-only probe sat on a boundary in
  //     every direction and never saw the third cell. The exceptional eight
  //     reported degree 2 and were tiered as ordinary crossings.
  //   - the AXES hold longitude fixed, so probing due north from a vertex on
  //     longitude 0, 90, 180 or 270 re-enters the frozen nestIndex knife edge
  //     (see nearestCornerstone) and returns a cell that is nowhere near.
  //
  // Eight bearings 45 degrees apart put at least one probe inside every sector
  // of a three- or four-valent vertex, and none of them lands on an edge.
  function incidentCells(H, lat, lon, order) {
    var d = probeM(order) / 6371008.8 * R2D, cosLat = Math.cos(lat * D2R), seen = {};
    for (var b = 0; b < 8; b++) {
      var th = (22.5 + 45 * b) * D2R;
      var la = lat + d * Math.cos(th);
      if (la > 90) la = 180 - la; else if (la < -90) la = -180 - la;
      seen[H.nestIndex(la, lon + d * Math.sin(th) / cosLat, order).toString()] = 1;
    }
    return Object.keys(seen).map(BigInt).sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
  }

  // Nearest vertex to a point at a given order, canonically named, with the
  // intrinsic (coarsest) order at which the point is still a vertex.
  // Candidate cells come from the four-quadrant probe, NOT from a single
  // nestIndex(lat, lon). On a longitude of exactly 0, 90, 180 or 270 in the
  // NORTHERN cap, nestIndex returns the polar pixel f0.333... whatever the
  // latitude -- so a query on one of those meridians used to snap to a corner
  // thousands of kilometres away and name it confidently. The southern cap is
  // unaffected. geosonify-healpix.js is frozen and its addresses are load
  // bearing elsewhere, so this is worked around here rather than fixed there.
  // The probe offsets are never exactly on the meridian, so they miss the
  // knife edge; away from it the probe lands in the same single cell nestIndex
  // would have returned, and the result is unchanged.
  //
  // This is why the exceptional eight of the concept doc's section 7.1 could
  // not be logged: all eight sit on exactly those meridians.
  function nearestCornerstone(lat, lon, order) {
    var H = hp(), nside = Math.pow(2, order);
    var best = null;
    incidentCells(H, lat, lon, order).forEach(function (ipix) {
      [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(function (uv) {
        var ll = vec2ll(H._core.pixcoord2vec_nest(nside, ipix, uv[0], uv[1]));
        var dm = haversineM(lat, lon, ll[0], ll[1]);
        if (!best || dm < best.distanceM) best = { lat: ll[0], lon: ll[1], distanceM: dm };
      });
    });
    // TWO orders meet at every vertex, and they need not be equal.
    //
    // In the face grid a vertex sits at integer (i, j). The line x = i survives
    // to the coarsest order where i is still a multiple of the cell step, and
    // the line y = j does likewise — independently. So a vertex can be the
    // crossing of a major order-8 boundary and a mundane order-13 one.
    //
    // Detected without touching face coordinates: at an order where BOTH lines
    // survive, four cells meet; where only ONE survives, the point lies on an
    // edge and two cells meet; where neither does, it is interior to one cell.
    //
    //   crossOrder     coarsest order with >= 2 incident cells  (the major line)
    //   intrinsicOrder coarsest order with >= 3 incident cells  (a true vertex)
    //
    // A crossing of one rare line and one common one therefore sits between two
    // rare and two common, exactly as intuition says, and tierOrder is the mean.
    var intrinsic = order, cross = order;
    for (var k = 1; k <= order; k++) {
      if (incidentCells(H, best.lat, best.lon, k).length >= 2) { cross = k; break; }
    }
    for (var k2 = cross; k2 <= order; k2++) {
      if (incidentCells(H, best.lat, best.lon, k2).length >= 3) { intrinsic = k2; break; }
    }
    var inc = incidentCells(H, best.lat, best.lon, intrinsic);
    return {
      lat: best.lat, lon: best.lon, distanceM: best.distanceM,
      intrinsicOrder: intrinsic,
      crossOrder: cross,
      tierOrder: (intrinsic + cross) / 2,
      degree: inc.length,                                   // 3 => one of the exceptional eight
      name: vertexName(H, inc, intrinsic, best.lat, best.lon),
      incident: inc.map(function (i) { return pathStr(H, i, intrinsic); })
    };
  }

  // The nearest vertex whose TIER is at least as rare as maxTier — i.e. the
  // nearest one the compass should point at.
  //
  // Why this exists: nearestCornerstone(lat, lon, order) finds the nearest
  // vertex whose INTRINSIC order <= order. But tier is (cross + intrinsic)/2,
  // and a rare line crossing a common one (say 10 x 14, tier 12) has intrinsic
  // 14 — so it is invisible to a probe below order 14, and the compass would
  // instead route you to a COARSER, more common vertex hundreds of metres away.
  // That is the "I stood on a tier-12 and could not bag it" bug.
  //
  // The fix: probe deep enough to see fine-intrinsic vertices (probeOrder,
  // default 14 — the depth the map already draws to), enumerate the distinct
  // vertices in a neighbourhood, and return the nearest whose tierOrder <=
  // maxTier. Lower tier = rarer, so maxTier is a rarity FLOOR: at 12 you get
  // 10x14 (tier 12) and 12x12 (tier 12) but not 14x14 (tier 14).
  //
  // Additive: reuses nearestCornerstone for classification, touches no frozen
  // path. The sampling walks a disc of points and dedupes the vertices they
  // resolve to, so it is robust to the exact face grid without doing face maths.
  function nearestBaggable(lat, lon, opts) {
    opts = opts || {};
    var maxTier = opts.maxTier != null ? opts.maxTier : 12;
    var probe   = opts.probeOrder != null ? opts.probeOrder : 14;
    var cellM   = Math.sqrt(Math.PI / 3) / Math.pow(2, probe) * 6371008.8;
    var radiusM = opts.radiusM != null ? opts.radiusM : cellM * 8;
    var step    = cellM / 4, seen = {}, best = null;
    for (var r = 0; r <= radiusM; r += step) {
      var n = Math.max(1, Math.ceil(2 * Math.PI * r / step));
      for (var i = 0; i < n; i++) {
        var th = 2 * Math.PI * i / n;
        var dLat = (r * Math.cos(th)) / 111320;
        var dLon = (r * Math.sin(th)) / (111320 * Math.cos(lat * D2R));
        var v;
        try { v = nearestCornerstone(lat + dLat, lon + dLon, probe); }
        catch (e) { continue; }
        if (seen[v.name]) continue;
        seen[v.name] = 1;
        if (v.tierOrder > maxTier) continue;           // too common — skip
        v.distanceM = haversineM(lat, lon, v.lat, v.lon);   // from the QUERY point
        if (!best || v.distanceM < best.distanceM) best = v;
      }
      // Stop early once we have a hit and have searched a full ring past it:
      // the nearest passing vertex cannot be further out than the ring that
      // first contained one, plus one cell of slack for off-centre sampling.
      if (best && r > best.distanceM + cellM) break;
    }
    return best;
  }

  // The four canonical vertex names of a cell — for the "all four corners" bonus.
  function cellCornerstones(quaternary) {
    var H = hp();
    var m = /^f(\d{1,2})\.([0-3]+)$/.exec(String(quaternary).trim());
    if (!m) throw new Error('cellCornerstones: expected f<face>.<base-4 digits>');
    var face = parseInt(m[1], 10), digits = m[2], order = digits.length;
    var q = 0n;
    for (var i = 0; i < digits.length; i++) q = q * 4n + BigInt(digits[i]);
    var ipix = BigInt(face) * (1n << BigInt(2 * order)) + q, nside = Math.pow(2, order);
    return [[0, 0], [1, 0], [1, 1], [0, 1]].map(function (uv) {
      var ll = vec2ll(H._core.pixcoord2vec_nest(nside, ipix, uv[0], uv[1]));
      var inc = incidentCells(H, ll[0], ll[1], order);
      return { name: vertexName(H, inc, order, ll[0], ll[1]), lat: ll[0], lon: ll[1] };
    });
  }

  // Have all four corners of this cell been collected?
  function cellComplete(quaternary, collectedNames) {
    var want = cellCornerstones(quaternary).map(function (c) { return c.name; });
    var have = {};
    (collectedNames || []).forEach(function (n) { have[String(n).trim()] = 1; });
    var missing = want.filter(function (n) { return !have[n]; });
    return { cell: quaternary, corners: want, missing: missing, complete: missing.length === 0 };
  }

  // ── the evaluator ─────────────────────────────────────────────────────────
  //
  // Assessments are DERIVED, never stored. Given a record and whatever the
  // target's coordinates are, this recomputes the verdict from scratch. A
  // better evaluator re-reads history rather than rewriting it, so every
  // result carries the rule versions that produced it.

  // 'V:f9.1112...c0' -> the point. Resolved by naming all four corners of the
  // cell and taking the one whose canonical name matches, so this does not
  // depend on which corner index the HEALPix implementation calls first.
  //
  // LEGACY, kept forever: a v0.2 name carries no corner. Where exactly one
  // corner of the cell canonically names that cell it is unambiguous and
  // decodes; where more than one does it was always ambiguous, and this throws
  // instead of silently returning whichever came first. Old records decode or
  // complain; they never quietly resolve to the wrong ground.
  function cornerstonePoint(name) {
    var s = String(name).trim();
    var m = /^V:(f\d{1,2}\.[0-3]+)(?:c([0-3]))?$/.exec(s);
    if (!m) throw new Error('cornerstonePoint: expected V:f<face>.<base-4 digits>[c<corner>]');
    var corners = cellCornerstones(m[1]);
    if (m[2] != null) {
      var hit = corners.filter(function (c) { return c.name === s; })[0];
      if (!hit) throw new Error('cornerstonePoint: "' + s + '" is not the canonical ' +
                                'name of any corner of ' + m[1]);
      return { lat: hit.lat, lon: hit.lon };
    }
    var own = corners.filter(function (c) { return c.name.indexOf('V:' + m[1] + 'c') === 0; });
    if (own.length === 1) return { lat: own[0].lat, lon: own[0].lon, legacy: own[0].name };
    if (own.length === 0)
      throw new Error('cornerstonePoint: legacy name "' + s + '" names no corner of ' +
                      m[1] + ' \u2014 it was never resolvable');
    throw new Error('cornerstonePoint: legacy name "' + s + '" is ambiguous \u2014 ' +
                    own.length + ' corners of ' + m[1] + ' carried it. Re-record as ' +
                    own.map(function (c) { return c.name; }).join(' or '));
  }

  // Legacy name -> canonical name, for offering a superseding record. Throws on
  // the ambiguous ones rather than choosing for the person.
  function canonicaliseCornerstone(name) {
    var s = String(name).trim();
    if (/c[0-3]$/.test(s)) return s;
    var p = cornerstonePoint(s);
    return p.legacy;
  }

  // opts.point supplies the target for a starpin, whose coordinates come from
  // the catalogue and are not derivable from the record.
  function assessRecord(rec, opts) {
    opts = opts || {};
    if (!rec || !rec.target) throw new Error('assessRecord: not a record');
    var out = { evaluator: 'starpin-eval-v0.1',
                rules: { visit: 'visit-geometry-v1', attendance: 'attendance-v1' } };

    var point = opts.point || null;
    // A starpin record carries the catalogue address it was logged against.
    // That is a FACT about the target at log time, not an assessment, so it
    // belongs in the record — and without it the record cannot be re-assessed
    // on a device that has no catalogue.
    if (!point && rec.target.lat_1e7 != null) {
      point = { lat: rec.target.lat_1e7 / UNIT, lon: rec.target.lon_1e7 / UNIT };
    }
    if (!point && rec.target.cornerstone) {
      try { point = cornerstonePoint(rec.target.cornerstone); }
      catch (e) { out.targetError = e.message; }
    }
    out.target = point;

    if (point && rec.fix) {
      out.visit = assessVisit({
        lat: rec.fix.lat_1e7 / UNIT, lon: rec.fix.lon_1e7 / UNIT,
        accuracy_m: rec.fix.accuracy_m
      }, point, opts);
    } else {
      out.visit = { rule: 'visit-geometry-v1',
                    verdict: point ? 'no-fix-recorded' : 'target-coordinates-unknown' };
    }

    if (rec.event && rec.event.time_ms != null) out.attendance = attendance(rec.event.time_ms);
    return out;
  }

  // Personal best per target, DERIVED. Nothing about "your closest" is stored:
  // log a closer approach and the earlier ones simply stop being your best.
  // Ranked by distance, with a supported visit always beating an unsupported
  // one at the same distance.
  // One target, one key. A cornerstone logged under a v0.2 name and the same
  // cornerstone logged under its canonical name are the same corner of the
  // same cell, and they have to land in the same group or the collection shows
  // the vertex twice and ranks each half separately.
  function targetKey(target) {
    if (!target) return 'unknown';
    if (target.cornerstone) {
      try { return canonicaliseCornerstone(target.cornerstone); }
      catch (e) { return target.cornerstone; }
    }
    return target.starpin || 'unknown';
  }

  function rankByTarget(records, opts) {
    var groups = {}, out = {};
    (records || []).forEach(function (r) {
      if (!r || !r.target) return;
      var k = targetKey(r.target);
      (groups[k] = groups[k] || []).push(r);
    });
    Object.keys(groups).forEach(function (k) {
      var scored = groups[k].map(function (r) {
        var a = null;
        try { a = assessRecord(r, opts); } catch (e) {}
        var d = (a && a.visit && a.visit.distanceM != null) ? a.visit.distanceM : Infinity;
        var supported = !!(a && a.visit && a.visit.verdict === 'well-supported');
        return { record: r, distanceM: d, supported: supported, assessment: a };
      }).sort(function (x, y) {
        if (x.supported !== y.supported) return x.supported ? -1 : 1;
        if (x.distanceM !== y.distanceM) return x.distanceM - y.distanceM;
        return x.record.event.time_ms - y.record.event.time_ms;
      });
      scored.forEach(function (e, i) {
        out[e.record.record_id] = {
          target: k, rank: i, best: i === 0, count: scored.length,
          distanceM: e.distanceM, supported: e.supported,
          bestDistanceM: scored[0].distanceM, assessment: e.assessment
        };
      });
    });
    return out;
  }

  // ── exports ───────────────────────────────────────────────────────────────

  return {
    VERSION: '0.1',
    SELECTION_ORDER: SELECTION_ORDER, M_PER_ARCSEC: M_PER_ARCSEC,
    SIDEREAL_DAY_MS: SIDEREAL_DAY_MS, RELEASES: RELEASES,
    decodeSourceId: decodeSourceId, alias: alias, parseAlias: parseAlias,
    toUnits: toUnits, starpinAddress: starpinAddress,
    phaseDeg: phaseDeg, lstDeg: lstDeg, nextCulmination: nextCulmination, attendance: attendance,
    sunPosition: sunPosition, sunAltitude: sunAltitude, darkness: darkness,
    assessVisit: assessVisit, haversineM: haversineM,
    nearestCornerstone: nearestCornerstone, nearestBaggable: nearestBaggable,
    cellCornerstones: cellCornerstones,
    cellComplete: cellComplete, cornerstonePoint: cornerstonePoint,
    canonicaliseCornerstone: canonicaliseCornerstone, targetKey: targetKey,
    sourceIdOf: sourceIdOf,
    assessRecord: assessRecord, rankByTarget: rankByTarget
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpin;
