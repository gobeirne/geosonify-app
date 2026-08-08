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
  // LOWEST nested index among them. The corner suffix is then redundant,
  // because the lowest-indexed cell always meets the vertex at the same corner.
  // Consequence, and it is unavoidable for any such rule: only ONE of a cell's
  // four corners carries that cell's own name.

  function hp() {
    var H = (typeof HealpixGrids !== 'undefined') ? HealpixGrids
          : (typeof require === 'function' ? (function () {
              try { return require('./geosonify-healpix.js'); } catch (e) { return null; } })() : null);
    if (!H) throw new Error('cornerstones need geosonify-healpix.js (HealpixGrids)');
    return H;
  }

  function vec2ll(v) {
    var x = v.x != null ? v.x : v[0], y = v.y != null ? v.y : v[1], z = v.z != null ? v.z : v[2];
    return [Math.asin(z / Math.hypot(x, y, z)) * R2D, Math.atan2(y, x) * R2D];
  }
  function pathStr(H, ipix, order) {
    var p = H.nestPath(ipix, order);
    return 'f' + (p.f != null ? p.f : p.face) + '.' + p.digits.join('');
  }

  // The four (or three) cells meeting at a vertex, at a given order.
  function incidentCells(H, lat, lon, order) {
    var d = 5 / 6371008.8 * R2D, cosLat = Math.cos(lat * D2R), seen = {};
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (s) {
      seen[H.nestIndex(lat + s[0] * d, lon + s[1] * d / cosLat, order).toString()] = 1;
    });
    return Object.keys(seen).map(BigInt).sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
  }

  // Nearest vertex to a point at a given order, canonically named, with the
  // intrinsic (coarsest) order at which the point is still a vertex.
  function nearestCornerstone(lat, lon, order) {
    var H = hp(), nside = Math.pow(2, order);
    var ipix = H.nestIndex(lat, lon, order);
    var best = null;
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(function (uv) {
      var ll = vec2ll(H._core.pixcoord2vec_nest(nside, ipix, uv[0], uv[1]));
      var dm = haversineM(lat, lon, ll[0], ll[1]);
      if (!best || dm < best.distanceM) best = { lat: ll[0], lon: ll[1], distanceM: dm };
    });
    var intrinsic = order;
    for (var k = 1; k <= order; k++) {
      if (incidentCells(H, best.lat, best.lon, k).length >= 3) { intrinsic = k; break; }
    }
    var inc = incidentCells(H, best.lat, best.lon, intrinsic);
    return {
      lat: best.lat, lon: best.lon, distanceM: best.distanceM,
      intrinsicOrder: intrinsic,
      degree: inc.length,                                   // 3 => one of the exceptional eight
      name: 'V:' + pathStr(H, inc[0], intrinsic),
      incident: inc.map(function (i) { return pathStr(H, i, intrinsic); })
    };
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
      return { name: 'V:' + pathStr(H, inc[0], order), lat: ll[0], lon: ll[1] };
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
    nearestCornerstone: nearestCornerstone, cellCornerstones: cellCornerstones,
    cellComplete: cellComplete
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpin;
