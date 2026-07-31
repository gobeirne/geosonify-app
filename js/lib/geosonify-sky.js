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
  var _engine = null;                       // explicit override, for Node/tests

  function _HP() {
    if (_engine) return _engine;
    try { if (typeof HealpixGrids !== 'undefined' && HealpixGrids) return HealpixGrids; } catch (e) {}
    if (global && global.HealpixGrids) return global.HealpixGrids;
    return null;
  }

  /*
    In the browser geosonify-healpix.js declares a bare top-level const, so the
    probe above finds it. Under Node, `require` binds it to a local instead, so
    tests must inject it. Geometry has no pure-JS fallback -- it needs the real
    projection -- so injection is the honest way to make it testable rather than
    silently degrading.
  */
  function setEngine(hp) { _engine = hp || null; return _engine; }

  /* The resolved engine, however it was found. Consumers should use this rather
     than re-probing the bare top-level const themselves: the probe is fragile
     outside a browser, and one place to get it wrong is better than many. */
  function getEngine() { return _HP(); }

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

  // ---- cell geometry ----------------------------------------------------
  /*
    The engine has pixelBoundary(nside, ipix, step) internally and it takes the
    INDEX directly -- but it is private, and the public cellCorners() only accepts
    lat/lon, forcing a needless re-projection. _core.pixcoord2vec_nest IS exported,
    so the geometry is rebuilt here on top of it and geosonify-healpix.js is left
    untouched.

    Corners are sampled in the cell's own (u,v) unit square, so the result is
    exact for the index given -- no round trip through a projected centre, which
    is the operation that goes wrong near boundaries (see PARITY-FINDINGS.md).
  */

  function vecToLatLon(v) {
    var lat = Math.asin(Math.max(-1, Math.min(1, v[2]))) * DEG_PER_RAD;
    var lon = Math.atan2(v[1], v[0]) * DEG_PER_RAD;
    return [lat, lon];
  }

  /*
    Trace a cell's boundary.

      order, ipix        the cell (ipix BigInt / string / safe Number)
      opts.step          samples per edge. 1 = the 4 corners. Edges are CURVED on
                         a sphere, so straight lines between corners bulge wrong
                         at low orders; 8-16 looks right for order < 6, and 1 is
                         plenty above ~order 10 where a cell is a few arcsec.
      opts.close         repeat the first point to close the ring (default true)
      opts.unwrap        keep longitude continuous across the +/-180 seam
                         (default true). Leaflet needs this or the polygon smears
                         across the entire map; Aladin does not care.
      opts.frame         'earth' -> [lat, lon] with lon in (-180, 180]
                         'sky'   -> [dec, ra]  with ra in [0, 360)
  */
  function cellBoundary(order, ipix, opts) {
    checkOrder(order);
    opts = opts || {};
    if (opts.engine) setEngine(opts.engine);
    var step = Math.max(1, opts.step === undefined ? 1 : opts.step | 0);
    var close = opts.close !== false;
    var unwrap = opts.unwrap !== false;
    var sky = opts.frame === 'sky';

    var hp = _HP();
    if (!hp || !hp._core || !hp._core.pixcoord2vec_nest) {
      throw new Error('cellBoundary needs HealpixGrids._core.pixcoord2vec_nest');
    }
    var ip = toBig(ipix, 'ipix');
    if (ip < 0n || ip >= cellsPerSphere(order)) {
      throw new Error('ipix ' + ip + ' out of range for order ' + order);
    }
    var nside = Math.pow(2, order);
    var f = hp._core.pixcoord2vec_nest;

    // walk the unit square anticlockwise: (0,0) -> (1,0) -> (1,1) -> (0,1)
    var edges = [[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 1]], [[0, 1], [0, 0]]];
    var pts = [];
    for (var e = 0; e < 4; e++) {
      var a = edges[e][0], b = edges[e][1];
      for (var s = 0; s < step; s++) {
        var t = s / step;
        pts.push(vecToLatLon(f(nside, ip, a[0] + (b[0] - a[0]) * t,
                                          a[1] + (b[1] - a[1]) * t)));
      }
    }

    if (unwrap) {
      // Make longitude continuous. A cell straddling the seam then has
      // longitudes outside (-180, 180], which is what polygon renderers want.
      for (var i = 1; i < pts.length; i++) {
        var d = pts[i][1] - pts[i - 1][1];
        if (d > 180) pts[i][1] -= 360;
        else if (d < -180) pts[i][1] += 360;
      }
    }

    if (sky) {
      pts = pts.map(function (p) {
        var ra = p[1] % 360; if (ra < 0) ra += 360;
        return [p[0], ra];
      });
    }

    if (close) pts.push(pts[0].slice());
    return pts;
  }

  function cellCorners4(order, ipix, opts) {
    var o = {};
    for (var kk in (opts || {})) o[kk] = opts[kk];
    o.step = 1; o.close = false;
    return cellBoundary(order, ipix, o);
  }

  /*
    The chain of ancestors of a cell, coarsest first.

    This is the visual proof of graceful truncation: each ancestor is one
    quaternary digit shorter and exactly 4x the area, so plotting the chain draws
    nested diamonds, each containing the next. Every digit you drop is one ring
    outward.
  */
  function ancestry(order, ipix, opts) {
    checkOrder(order);
    opts = opts || {};
    var from = opts.fromOrder === undefined ? 0 : checkOrder(opts.fromOrder);
    var ip = toBig(ipix, 'ipix');
    var out = [];
    for (var k = from; k <= order; k++) {
      var anc = ip >> BigInt(2 * (order - k));
      var cell = ipixToCell(k, anc);
      out.push({
        order: k, ipix: anc, quaternary: cell.quaternary,
        face: cell.face, digits: cell.digits,
        moc: k + '/' + anc.toString(),
        sizeArcsec: cellSize(k).arcsec,
        sizeText: cellSize(k).text
      });
    }
    return out;
  }

  // ---- click provenance -------------------------------------------------
  /*
    The finest order whose cell is still at least as big as a given angle.

    This is the sky twin of the Earth rule that a map pin cannot be more precise
    than the pixel you clicked. A click at a 60-degree field of view resolves
    arcminutes, not microarcseconds, and a code that claims otherwise is a lie
    told in a very confident-looking format.

    Returns the COARSER of the two neighbouring orders, deliberately: claiming
    less than you measured is honest, claiming more is not.
  */
  function orderForAngle(arcsec, opts) {
    opts = opts || {};
    if (!(arcsec > 0)) return opts.max === undefined ? 52 : opts.max;
    var rad = arcsec / ARCSEC_PER_RAD;
    var k = Math.floor(Math.log2(SQRT_PI_OVER_3 / rad));
    var lo = opts.min === undefined ? 0 : opts.min;
    var hi = opts.max === undefined ? 52 : opts.max;
    return Math.max(lo, Math.min(hi, k));
  }

  /*
    What a click at this zoom actually justifies.

      fovDeg        field of view across the SHORTER viewport dimension
      viewportPx    that dimension, in pixels
      pixels        pointer accuracy: 1 for a mouse, ~10 for a fingertip

    Returns { arcsec, order, text, basis } — everything the UI needs to state the
    provenance honestly, in the sky's own units rather than pretending metres
    mean something on the celestial sphere.
  */
  function clickProvenance(fovDeg, viewportPx, pixels) {
    var px = pixels === undefined ? 1 : Math.max(0.25, pixels);
    var vp = Math.max(1, viewportPx || 1);
    var arcsec = (fovDeg * 3600 / vp) * px;
    var order = orderForAngle(arcsec);
    return {
      arcsec: arcsec,
      order: order,
      cellArcsec: cellSize(order).arcsec,
      text: formatAngle(arcsec),
      basis: 'sky-click',
      pixels: px,
      fovDeg: fovDeg
    };
  }

  /*
    Is a chosen order claiming more than the view can support?
    Used to warn rather than to forbid: the user may know something the pointer
    does not, and Geosonify's habit is to say so rather than to prevent.
  */
  function overclaims(order, provenance) {
    if (!provenance) return null;
    if (order <= provenance.order) return null;
    var levels = order - provenance.order;
    return {
      levels: levels,
      factor: Math.pow(2, levels),
      text: 'order ' + order + ' claims ' + Math.pow(2, levels) +
            '\u00d7 finer than this zoom justifies (' + provenance.text + ' click)'
    };
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

    TWO MODES, because naming a cell and REPRODUCING it are different jobs.
    Measured over 3,000 random points per order: display a position at the s/2
    precision below, paste it back, and you land in the same cell only ~85% of
    the time -- a point near a boundary rounds across it. Adding decimals:

        extra   order 16   order 22   order 26   order 29
          +0      83.0%      90.4%      82.5%      87.2%
          +1      98.6%      98.9%      98.4%      98.3%
          +2      99.9%      99.9%      99.8%      99.8%
          +3     100.0%     100.0%     100.0%     100.0%

    It can never be 100% guaranteed -- a point arbitrarily close to a boundary
    always flips -- so ROUNDTRIP_EXTRA is a pragmatic choice, not a proof. Use
    the display precision for reading, and the +2 form for anything that will be
    parsed again (the copy button, exports, comparisons).
  */
  var ROUNDTRIP_EXTRA = 2;

  function autoDecimals(order, decDeg) {
    checkOrder(order);
    var s = cellSideRad(order) * ARCSEC_PER_RAD;          // cell side, arcsec
    var dDec = Math.ceil(Math.log10(2 / s));
    // cos(dec) collapses at the poles, where RA is nearly meaningless; floor it
    // so the decimal count stays finite rather than exploding.
    var cosd = Math.max(Math.abs(Math.cos((decDeg || 0) * RAD_PER_DEG)), 1e-3);
    var dRA = Math.ceil(Math.log10(30 * cosd / s));
    var ra = Math.max(0, Math.min(7, dRA));
    var dec = Math.max(0, Math.min(7, dDec));
    return {
      ra: ra, dec: dec,
      raRoundTrip: Math.min(9, ra + ROUNDTRIP_EXTRA),
      decRoundTrip: Math.min(9, dec + ROUNDTRIP_EXTRA),
      cellArcsec: s
    };
  }

  /*
    Parse a combined "RA Dec" string in any spelling a sky tool is likely to hand
    you. Returns { raDeg, decDeg, spelling }.

      "11 30 36.219 -43 33 19.60"     six whitespace tokens, sexagesimal
      "11:30:36.219 -43:33:19.60"     colon form
      "11h30m36.219s -43d33m19.60s"   letter form
      "18 36 56.336 +38 47 01.28"     explicit + on the declination
      "172.6509 -43.5554"             decimal degrees, both axes
      "172.6509, -43.5554"            comma separated

    The hard part is knowing where RA stops and Dec starts, since a bare
    "11 30 36 43 33 19" is ambiguous about sign. Rule: split on an explicit
    declination sign when there is one, otherwise split the token list in half.
    Six tokens -> 3 and 3. Two tokens -> decimal degrees unless they contain
    sexagesimal punctuation.
  */
  function parsePosition(str) {
    var raw = String(str || '').trim();
    if (!raw) throw new Error('empty position');

    var t = raw
      .replace(/[\u2212\u2013\u2014]/g, '-')
      .replace(/,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    var raPart = null, decPart = null;

    // An explicit sign after the first character marks the declination.
    var m = t.match(/^(.*?[^\s+-])\s*([+-].*)$/);
    if (m) {
      raPart = m[1].trim();
      decPart = m[2].trim();
    } else {
      var toks = t.split(' ');
      if (toks.length === 6) { raPart = toks.slice(0, 3).join(' '); decPart = toks.slice(3).join(' '); }
      else if (toks.length === 2) { raPart = toks[0]; decPart = toks[1]; }
      else if (toks.length === 4) {
        throw new Error('ambiguous: 4 values could be hh mm / dd mm or hh mm ss / dd. ' +
                        'Add a sign on the declination, or use colons.');
      } else {
        throw new Error('cannot tell where RA ends and Dec begins in "' + raw + '"');
      }
    }

    // Sexagesimal if it has internal separators or multiple numbers.
    var sexaRA = /[\s:hm]/.test(raPart.replace(/^[+-]/, ''));
    var raDeg = parseSexagesimal(raPart, sexaRA);
    var decDeg = parseSexagesimal(decPart, false);

    if (!isFinite(raDeg) || !isFinite(decDeg)) throw new Error('unparseable position "' + raw + '"');
    if (decDeg < -90 || decDeg > 90) throw new Error('declination out of range: ' + decDeg);

    return {
      raDeg: wrap360(raDeg),
      decDeg: decDeg,
      spelling: sexaRA ? 'sexagesimal' : 'degrees'
    };
  }

  /*
    How many leading quaternary digits do two cells share?

    This is the comparison that sexagesimal cannot give you. Two positions inside
    the same order-n cell share exactly n digits, so the shared prefix length IS
    the resolution at which they agree -- no mixed-radix arithmetic, no cos(dec)
    factor, just a string comparison. Faces differing means they share nothing.
  */
  function separationDeg(ra1, dec1, ra2, dec2) {
    // Haversine, not arccos: arccos has a sqrt(eps) floor of ~0.003 arcsec,
    // which is coarser than a cell above order 22 and would report nonsense.
    var p1 = dec1 * RAD_PER_DEG, p2 = dec2 * RAD_PER_DEG;
    var dp = p2 - p1, dl = (ra2 - ra1) * RAD_PER_DEG;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * DEG_PER_RAD;
  }

  function sharedPrefix(quadA, quadB) {
    var a = parseQuaternary(quadA), b = parseQuaternary(quadB);
    if (a.face !== b.face) {
      return { digits: 0, sameFace: false, order: null, withinArcsec: null,
               text: 'different base faces' };
    }
    var n = 0;
    var len = Math.min(a.digits.length, b.digits.length);
    while (n < len && a.digits[n] === b.digits[n]) n++;
    var size = cellSize(n);
    return {
      digits: n, sameFace: true, order: n,
      withinArcsec: size.arcsec,
      identical: n === a.digits.length && n === b.digits.length,
      text: n === len
        ? 'identical to order ' + n
        : 'same cell to order ' + n + ' (within ' + size.text + ')'
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
    setEngine: setEngine, getEngine: getEngine,
    toBig: toBig, pow4: pow4, cellsPerSphere: cellsPerSphere,
    parseQuaternary: parseQuaternary, formatQuaternary: formatQuaternary,
    cellToIpix: cellToIpix, ipixToCell: ipixToCell,
    toMoc: toMoc, fromMoc: fromMoc, mocApprox: mocApprox,
    nuniq: nuniq, fromNuniq: fromNuniq,
    cellSize: cellSize, cellSideRad: cellSideRad, formatAngle: formatAngle,
    cellBoundary: cellBoundary, cellCorners4: cellCorners4, ancestry: ancestry,
    orderForAngle: orderForAngle, clickProvenance: clickProvenance, overclaims: overclaims,
    vecToLatLon: vecToLatLon,
    formatRA: formatRA, formatDec: formatDec, parseSexagesimal: parseSexagesimal,
    autoDecimals: autoDecimals, ROUNDTRIP_EXTRA: ROUNDTRIP_EXTRA,
    parsePosition: parsePosition, sharedPrefix: sharedPrefix,
    separationDeg: separationDeg,
    designation: designation,
    julianDay: julianDay, gmstDeg: gmstDeg, lstDeg: lstDeg, zenith: zenith,
    readout: readout
  };

  global.GeosonifySky = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
