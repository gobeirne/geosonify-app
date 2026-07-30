/*
  geosonify-sky.js  v0.1  — S1 read-only sky readout layer

  PURE FUNCTIONS ONLY. No DOM, no state, no URL emission, no card registration.
  Nothing here defines a shareable format, so nothing here is frozen yet.
  (See geosonify-scales-v1.js: "once its card ships publicly it is frozen too.")

  Provides:
    sexagesimal RA/Dec formatting + parsing
    IAU-style J designations
    quaternary <-> MOC ASCII (order/ipix)  -- BigInt, no order ceiling
    NUNIQ pack/unpack                      -- BigInt, no order ceiling
    angular cell size / area for an order
    GMST -> local sidereal time -> zenith of an Earth position

  BIGINT POLICY (the point of this file):
    Every quantity that indexes a cell -- ipix, 4^order, 12*4^order, NUNIQ --
    is BigInt from the first line. Reference HEALPix libraries pack the fused
    index into a uint64, which caps them at order 29. Nothing here caps.
      order 29 ipix  needs 62 bits   (fits u64; MOC 2.0's ceiling)
      order 34 ipix  needs 72 bits   (does NOT fit; we handle it)
      order 34 NUNIQ needs 74 bits   (does NOT fit; we handle it)
    Anything at order > 29 is NOT standard MOC. mocApprox() exists to hand back
    the order-29 ancestor for tools that can only read the standard, and it is
    LOSSY BY 4^(order-29) IN AREA -- it must be labelled wherever it is shown.

    Angles stay double. That is deliberate: a double carries ~1 nanoarcsecond
    across 360deg (~order 45), and frame/epoch ambiguity is ~0.35deg, so BigInt
    would buy nothing. Indices are exact; directions are as good as the input.

  NUMBER SAFETY:
    toBig() REFUSES a Number that is non-integer or above Number.MAX_SAFE_INTEGER
    rather than coercing it. A silently rounded ipix decodes to a plausible wrong
    cell, which is the failure mode this codebase exists to avoid. Callers past
    order 26 must pass a BigInt or a decimal string.

  Cross-checked in geosonify-sky.selftest.js against HealpixGrids (convention
  agreement), against healpy (index agreement), and against astropy (sidereal
  time). Prefers HealpixGrids for quaternary work when it is loaded, so there is
  one source of truth in the browser; the local fallback exists for Node.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';

  var ARCSEC_PER_RAD = 206264.80624709636;
  var DEG_PER_RAD = 57.29577951308232;
  var RAD_PER_DEG = 0.017453292519943295;
  var SQRT_PI_OVER_3 = 1.0233267079464885;      // sqrt(pi/3)
  var JD_J2000 = 2451545.0;

  // ---- HealpixGrids resolution (bare top-level const, NOT window.*) --------
  // Mirrors the probe in geosonify-healpix-path.js / geosonify-precision.js.
  function _HP() {
    try { if (typeof HealpixGrids !== 'undefined' && HealpixGrids) return HealpixGrids; } catch (e) {}
    if (global && global.HealpixGrids) return global.HealpixGrids;
    return null;
  }

  // ---- BigInt hygiene ------------------------------------------------------

  function toBig(v, what) {
    what = what || 'value';
    if (typeof v === 'bigint') return v;
    if (typeof v === 'string') {
      if (!/^\d+$/.test(v.trim())) throw new Error(what + ': expected a non-negative integer string');
      return BigInt(v.trim());
    }
    if (typeof v === 'number') {
      if (!Number.isInteger(v)) throw new Error(what + ': got a non-integer Number (' + v + ')');
      if (!Number.isSafeInteger(v)) {
        throw new Error(what + ': Number ' + v + ' exceeds MAX_SAFE_INTEGER and may already be rounded. ' +
                        'Pass a BigInt or a decimal string.');
      }
      return BigInt(v);
    }
    throw new Error(what + ': expected BigInt, integer Number, or decimal string');
  }

  function pow4(order) { return 1n << (2n * BigInt(order)); }        // 4^order, exact
  function cellsPerSphere(order) { return 12n * pow4(order); }        // 12*4^order

  function checkOrder(order) {
    if (!Number.isInteger(order) || order < 0 || order > 200) {
      throw new Error('order: expected integer 0..200, got ' + order);
    }
    return order;
  }

  // ---- quaternary <-> (face, digits) --------------------------------------

  function parseQuaternary(str) {
    var hp = _HP();
    if (hp && hp._ser && hp._ser.deserQuad) {
      var r = hp._ser.deserQuad(str);
      if (!r) throw new Error('quaternary: unparseable "' + str + '"');
      return { face: r.f, digits: r.digits.slice() };
    }
    var m = String(str).trim().match(/^f(\d{1,2})\.?([0-3]*)$/);
    if (!m) throw new Error('quaternary: expected f<face>.<base-4 digits>, got "' + str + '"');
    var face = parseInt(m[1], 10);
    if (face < 0 || face > 11) throw new Error('quaternary: face must be 0..11, got ' + face);
    var digits = m[2].split('').map(Number);
    return { face: face, digits: digits };
  }

  function formatQuaternary(face, digits) {
    return 'f' + face + '.' + digits.join('');
  }

  // ---- (face, digits) <-> ipix -------------------------------------------
  // ipix = face * 4^order + (digits read MSB-first in base 4).
  // Prefers the engine's own pathToNest/nestPath so the convention cannot drift.

  function cellToIpix(face, digits) {
    var order = digits.length;
    var hp = _HP();
    if (hp && hp.pathToNest) return { order: order, ipix: BigInt(hp.pathToNest(face, digits)) };
    var local = 0n;
    for (var i = 0; i < digits.length; i++) local = local * 4n + BigInt(digits[i]);
    return { order: order, ipix: BigInt(face) * pow4(order) + local };
  }

  function ipixToCell(order, ipix) {
    checkOrder(order);
    var ip = toBig(ipix, 'ipix');
    if (ip < 0n || ip >= cellsPerSphere(order)) {
      throw new Error('ipix ' + ip + ' out of range for order ' + order +
                      ' (valid 0..' + (cellsPerSphere(order) - 1n) + ')');
    }
    var hp = _HP();
    if (hp && hp.nestPath) {
      var r = hp.nestPath(ip, order);
      return { order: order, face: r.f, digits: r.digits.slice(),
               quaternary: formatQuaternary(r.f, r.digits) };
    }
    var span = pow4(order);
    var face = Number(ip / span);
    var rest = ip - BigInt(face) * span;
    var digits = new Array(order);
    for (var i = order - 1; i >= 0; i--) { digits[i] = Number(rest & 3n); rest >>= 2n; }
    return { order: order, face: face, digits: digits, quaternary: formatQuaternary(face, digits) };
  }

  // ---- MOC ASCII (single cell) -------------------------------------------

  function toMoc(quaternaryOrCell) {
    var cell = (typeof quaternaryOrCell === 'string')
      ? parseQuaternary(quaternaryOrCell)
      : quaternaryOrCell;
    var r = cellToIpix(cell.face, cell.digits);
    return {
      order: r.order,
      ipix: r.ipix,
      moc: r.order + '/' + r.ipix.toString(),
      standard: r.order <= 29,
      nuniq: nuniq(r.order, r.ipix)
    };
  }

  function fromMoc(str) {
    var m = String(str).trim().match(/^(\d{1,3})\s*\/\s*(\d+)$/);
    if (!m) throw new Error('MOC: expected <order>/<ipix>, got "' + str + '"');
    var order = checkOrder(parseInt(m[1], 10));
    var ipix = BigInt(m[2]);                  // BigInt from the string; never parseInt
    var cell = ipixToCell(order, ipix);
    cell.ipix = ipix;
    cell.moc = order + '/' + ipix.toString();
    cell.standard = order <= 29;
    return cell;
  }

  // Order-29 ancestor, for tools that can only read standard MOC.
  // LOSSY: the returned cell covers 4^(order-29) times the area.
  function mocApprox(order, ipix, maxOrder) {
    checkOrder(order);
    var cap = (maxOrder === undefined) ? 29 : checkOrder(maxOrder);
    var ip = toBig(ipix, 'ipix');
    if (order <= cap) return { order: order, ipix: ip, moc: order + '/' + ip, degraded: false, areaFactor: 1n };
    var drop = order - cap;
    var anc = ip >> BigInt(2 * drop);
    return {
      order: cap, ipix: anc, moc: cap + '/' + anc.toString(),
      degraded: true, areaFactor: 1n << BigInt(2 * drop),
      note: 'order ' + cap + ' ancestor of an order-' + order + ' cell; covers ' +
            (1n << BigInt(2 * drop)).toString() + 'x the area'
    };
  }

  // ---- NUNIQ -------------------------------------------------------------
  // uniq = 4 * (4^order - 1) + ipix  ==  (4 + ipix/4^order-ish) packed.
  // The vendored uniq2orderpix in geosonify-healpix.js is Number-based and
  // asserts uniq <= 0x7fffffff, so it breaks past order ~15. This does not.

  function nuniq(order, ipix) {
    checkOrder(order);
    return 4n * (pow4(order) - 1n) + toBig(ipix, 'ipix');
  }

  function fromNuniq(uniq) {
    var u = toBig(uniq, 'nuniq');
    if (u < 4n) throw new Error('nuniq: must be >= 4, got ' + u);
    // order = floor(log4(u/4)); find it by BigInt bit length, no Number shifts.
    var order = 0;
    while (u >= 4n * pow4(order + 1)) order++;
    var ipix = u - 4n * (pow4(order) - 1n);
    return { order: order, ipix: ipix, standard: order <= 29 };
  }

  // ---- angular scale ----------------------------------------------------

  function cellSideRad(order) { checkOrder(order); return SQRT_PI_OVER_3 / Math.pow(2, order); }

  function cellSize(order) {
    var rad = cellSideRad(order);
    var arcsec = rad * ARCSEC_PER_RAD;
    var deg2 = (4 * Math.PI / Number(cellsPerSphere(order))) * DEG_PER_RAD * DEG_PER_RAD;
    return { rad: rad, arcsec: arcsec, areaDeg2: deg2, text: formatAngle(arcsec) };
  }

  function formatAngle(arcsec) {
    if (arcsec >= 3600) return (arcsec / 3600).toFixed(2) + ' deg';
    if (arcsec >= 60) return (arcsec / 60).toFixed(2) + ' arcmin';
    if (arcsec >= 1) return arcsec.toFixed(2) + ' arcsec';
    if (arcsec >= 1e-3) return (arcsec * 1e3).toFixed(1) + ' mas';
    if (arcsec >= 1e-6) return (arcsec * 1e6).toFixed(2) + ' uas';
    return (arcsec * 1e9).toFixed(2) + ' nas';
  }

  // ---- sexagesimal ------------------------------------------------------

  function wrap360(d) { return ((d % 360) + 360) % 360; }

  /*
    truncate=false (display): round the seconds, the normal way to show a
      measured coordinate.
    truncate=true (designations): TRUNCATE. A designation names a box, and
      truncating is what keeps a short name a strict PREFIX of a longer one --
      J113036.2-433319 refines to ...19.6, whereas rounding would give
      ...-433320, which contradicts 19.6 rather than refining it. Same reason
      the IAU specifies truncation for source designations, and the same
      graceful-truncation property the rest of Geosonify relies on.
  */
  function splitSexa(value, decimals, truncate) {
    var v = Math.abs(value);
    var a = Math.floor(v);
    var rem = (v - a) * 60;
    var b = Math.floor(rem);
    var c = (rem - b) * 60;
    var cs;
    if (truncate) {
      var scale = Math.pow(10, decimals);
      // guard the case where c is 59.999... within float noise of 60
      var t = Math.floor(c * scale + 1e-9) / scale;
      cs = t.toFixed(decimals);
    } else {
      cs = c.toFixed(decimals);
    }
    // carry, so 59.9999 -> next unit rather than "60.00"
    if (parseFloat(cs) >= 60) { cs = (0).toFixed(decimals); b += 1; }
    if (b >= 60) { b -= 60; a += 1; }
    return { a: a, b: b, c: cs };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function padNum(s, intDigits) {
    var dot = s.indexOf('.');
    var whole = dot === -1 ? s : s.slice(0, dot);
    while (whole.length < intDigits) { s = '0' + s; whole = '0' + whole; }
    return s;
  }

  // opts: { decimals, unicode, delimiter: 'letters' | 'colons' | 'spaces' }
  function formatRA(raDeg, opts) {
    opts = opts || {};
    var dec = opts.decimals === undefined ? 2 : opts.decimals;
    var p = splitSexa(wrap360(raDeg) / 15, dec);
    var s = padNum(p.c, 2);
    var d = opts.delimiter || 'letters';
    if (d === 'colons') return pad2(p.a) + ':' + pad2(p.b) + ':' + s;
    if (d === 'spaces') return pad2(p.a) + ' ' + pad2(p.b) + ' ' + s;
    return pad2(p.a) + 'h ' + pad2(p.b) + 'm ' + s + 's';
  }

  function formatDec(decDeg, opts) {
    opts = opts || {};
    var dec = opts.decimals === undefined ? 1 : opts.decimals;
    if (decDeg < -90 || decDeg > 90) throw new Error('declination out of range: ' + decDeg);
    var sign = decDeg < 0 ? '-' : '+';
    var p = splitSexa(decDeg, dec);
    var s = padNum(p.c, 2);
    var d = opts.delimiter || 'letters';
    if (d === 'colons') return sign + pad2(p.a) + ':' + pad2(p.b) + ':' + s;
    if (d === 'spaces') return sign + pad2(p.a) + ' ' + pad2(p.b) + ' ' + s;
    if (opts.unicode) return (decDeg < 0 ? '\u2212' : '+') + pad2(p.a) + '\u00b0 ' + pad2(p.b) + '\u2032 ' + s + '\u2033';
    return sign + pad2(p.a) + 'd ' + pad2(p.b) + 'm ' + s + 's';
  }

  // Accepts "11h30m36.2s", "11 30 36.2", "11:30:36.2", "172.6509" (degrees),
  // "172.6509deg". Returns degrees. isRA=true treats bare sexagesimal as hours.
  function parseSexagesimal(str, isRA) {
    var s = String(str).trim()
      .replace(/[\u2212\u2013\u2014]/g, '-')
      .replace(/[\u00b0\u2032\u2033\u2019\u201d'"]/g, ' ')
      .replace(/deg(?:rees)?/gi, ' ')
      .replace(/[hdms]/gi, ' ')
      .replace(/:/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    var neg = /^-/.test(s);
    s = s.replace(/^[+-]/, '');
    var parts = s.split(' ').filter(function (x) { return x.length; }).map(Number);
    if (!parts.length || parts.some(isNaN)) throw new Error('cannot parse angle "' + str + '"');
    var val;
    if (parts.length === 1) {
      val = parts[0];                                   // already degrees
    } else {
      val = parts[0] + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;
      if (isRA) val *= 15;                              // hours -> degrees
    }
    return neg ? -val : val;
  }

  /*
    Truncating split. Designations must TRUNCATE, never round.

    A designation is an identifier for a box, and Geosonify's whole premise is
    that dropping precision yields a box that still CONTAINS the point. Rounding
    breaks that: Dec -43 33 19.55" rounds to "...433320", naming a box the point
    is not inside. Truncation gives "...433319", which contains it. This is also
    the IAU convention for coordinate-derived source names.

    No carry logic is needed, because truncation can never push a unit over 60.
    The 1e-9 guard absorbs float representation error at the truncation digit
    (1 nanoarcsecond, far below anything meaningful here).
  */
  function splitSexaTrunc(value, decimals) {
    var v = Math.abs(value);
    var a = Math.floor(v);
    var rem = (v - a) * 60;
    var b = Math.floor(rem);
    var c = (rem - b) * 60;
    var f = Math.pow(10, decimals);
    return { a: a, b: b, c: (Math.floor(c * f + 1e-9) / f).toFixed(decimals) };
  }

  /*
    How many decimal places does a given order actually justify?

    A cell of side s arcsec is only pinned down if the display quantum is at
    most s/2. For declination the quantum is 10^-d arcsec. For right ascension
    it is 15*cos(dec) arcsec per second of TIME, so RA always needs more
    decimals than Dec -- typically one more, and more still near the poles.

    Worked example, order 22 at dec -43.6 (cell 0.0503"):
      Dec needs 2 decimals (0.01" quantum)
      RA  needs 3 decimals (0.001s = 0.0109" at this declination)
    Two decimals of RA seconds -- the old fixed default -- is a 0.109" quantum,
    TWICE the cell width. The panel was naming a cell it could not resolve.

    Capped at 7: beyond that a double coordinate has nothing left to say, and it
    matches the ingestion limit noted in the panel.
  */
  function autoDecimals(order, decDeg) {
    checkOrder(order);
    var s = cellSideRad(order) * ARCSEC_PER_RAD;          // cell side, arcsec
    var dDec = Math.ceil(Math.log10(2 / s));
    // cos(dec) collapses at the poles, where RA is nearly meaningless; floor it
    // so the decimal count stays finite rather than exploding.
    var cosd = Math.max(Math.abs(Math.cos((decDeg || 0) * RAD_PER_DEG)), 1e-3);
    var dRA = Math.ceil(Math.log10(30 * cosd / s));
    return {
      ra: Math.max(0, Math.min(7, dRA)),
      dec: Math.max(0, Math.min(7, dDec)),
      cellArcsec: s
    };
  }

  // ---- IAU-style designation -------------------------------------------
  // Jhhmmss.s+ddmmss  -- truncatable: fewer digits = coarser, same place.
  // Truncates (see splitSexaTrunc). Pass { round: true } only if you have a
  // specific reason to want the non-containing behaviour.
  function designation(raDeg, decDeg, opts) {
    opts = opts || {};
    var rd = opts.raDecimals === undefined ? 1 : opts.raDecimals;
    var dd = opts.decDecimals === undefined ? 0 : opts.decDecimals;
    var split = opts.round ? splitSexa : splitSexaTrunc;
    var r = split(wrap360(raDeg) / 15, rd);
    var d = split(decDeg, dd);
    return 'J' + pad2(r.a) + pad2(r.b) + padNum(r.c, 2) +
           (decDeg < 0 ? '-' : '+') + pad2(d.a) + pad2(d.b) + padNum(d.c, 2);
  }

  // ---- sidereal time and zenith ---------------------------------------

  function julianDay(date) {
    var t = (date instanceof Date) ? date.getTime() : new Date(date).getTime();
    if (isNaN(t)) throw new Error('julianDay: invalid date');
    return t / 86400000 + 2440587.5;
  }

  // Mean sidereal time at Greenwich, degrees. IAU 1982 series.
  // Omits nutation (equation of the equinoxes, up to ~1.1s of time / 17"),
  // so this is MEAN, and the zenith below is labelled apparent-ish accordingly.
  function gmstDeg(jd) {
    var d = jd - JD_J2000;
    var T = d / 36525;
    var g = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000;
    return wrap360(g);
  }

  function lstDeg(jd, lonEastDeg) { return wrap360(gmstDeg(jd) + lonEastDeg); }

  /*
    The sky position directly overhead an Earth position at a given time.
      RA  = local sidereal time
      Dec = geodetic latitude   (the zenith IS the local vertical, so this is exact)

    FRAME: equator and equinox OF DATE, mean (no nutation). This is NOT ICRS/J2000.
    Verified against astropy 8.0.1 for 2026-07-30:
      vs apparent of-date : 9.3 arcsec in RA (nutation), 0.3 arcsec in Dec
      vs ICRS / J2000     : 0.354 deg  -- precession since 2000, about 21 arcmin
    Label it. Converting to ICRS needs precession rotations and is a later step.
  */
  function zenith(latDeg, lonDeg, date) {
    var jd = julianDay(date || new Date());
    var lst = lstDeg(jd, lonDeg);
    return {
      raDeg: lst, decDeg: latDeg,
      ra: formatRA(lst), dec: formatDec(latDeg, { unicode: true }),
      lstHours: lst / 15, jd: jd,
      frame: 'mean equator and equinox of date',
      caveat: 'not ICRS/J2000: differs by ~0.35 deg (precession) in 2026'
    };
  }

  // ---- convenience: one call for the whole readout panel ----------------
  function readout(latDeg, lonDeg, quaternary, date) {
    var cell = parseQuaternary(quaternary);
    var m = toMoc(cell);
    var size = cellSize(m.order);
    return {
      order: m.order,
      quaternary: formatQuaternary(cell.face, cell.digits),
      // the same cell read as a celestial address (frame swap: lat->Dec, lon->RA)
      skyRA: formatRA(lonDeg), skyDec: formatDec(latDeg, { unicode: true }),
      skyRADeg: wrap360(lonDeg), skyDecDeg: latDeg,
      designation: designation(lonDeg, latDeg),
      cellSize: size.text, cellAreaDeg2: size.areaDeg2,
      moc: m.moc, nuniq: m.nuniq.toString(), standard: m.standard,
      mocStandard: m.standard ? null : mocApprox(m.order, m.ipix),
      zenith: zenith(latDeg, lonDeg, date)
    };
  }

  var API = {
    VERSION: VERSION,
    toBig: toBig, pow4: pow4, cellsPerSphere: cellsPerSphere,
    parseQuaternary: parseQuaternary, formatQuaternary: formatQuaternary,
    cellToIpix: cellToIpix, ipixToCell: ipixToCell,
    toMoc: toMoc, fromMoc: fromMoc, mocApprox: mocApprox,
    nuniq: nuniq, fromNuniq: fromNuniq,
    cellSize: cellSize, cellSideRad: cellSideRad, formatAngle: formatAngle,
    formatRA: formatRA, formatDec: formatDec, parseSexagesimal: parseSexagesimal,
    autoDecimals: autoDecimals,
    designation: designation,
    julianDay: julianDay, gmstDeg: gmstDeg, lstDeg: lstDeg, zenith: zenith,
    readout: readout
  };

  global.GeosonifySky = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
