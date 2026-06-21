/*
  geosonify-precision.js v1.0
  ─────────────────────────────────────────────────────────────────────────
  Arbitrary-precision coordinate core for Geosonify.

  ONE SOURCE OF TRUTH: an exact point (rational latitude/longitude held to a
  configurable working precision). Everything else is a *view* of it:

    • toLatLon()  → ordinary {lat,lon} doubles — the LOSSY view, for display,
                    map pins, zoom, and lat/lon interchange ONLY.
    • toGeosonifyCode() / toHealpixCode() → LOSSLESS views (the codes ARE the
                    precise carriers).

  Precision consumers (distance, cross-scheme conversion, deep cell
  classification) read the exact point directly and compute in arbitrary
  precision. They never pass through the double.

  Provenance: every exact point records the precision its SOURCE actually
  carried (a map tap is shallow; a deep code is deep). Cards never manufacture
  precision beyond the source — deeper digits are the contained-cell refinement.

  Dependency: decimal.js (vendored locally as a global `Decimal`, or required
  in Node). HEALPix address layer is HealpixGrids (geosonify-healpix.js).
  ─────────────────────────────────────────────────────────────────────────
*/
(function (global, factory) {
  const Decimal =
    global.Decimal ||
    (typeof require !== 'undefined' ? require('decimal.js') : null);
  const HealpixGrids =
    global.HealpixGrids ||
    (typeof require !== 'undefined' ? (function(){try{return require('./geosonify-healpix.js');}catch(e){return null;}})() : null);
  const api = factory(Decimal, HealpixGrids, global);
  global.GeoPrecision = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this, function (Decimal, HealpixGrids, global) {
  'use strict';

  if (!Decimal) {
    // Defer hard failure to call time so the file can load even if decimal.js
    // hasn't been parsed yet; precision ops will throw a clear error.
    return makeStub();
  }

  // Working precision (significant digits). Order 73 HEALPix needs ~50+ sig
  // figs of π/trig; 120 gives generous headroom for fm/below.
  const DEFAULT_PRECISION = 120;
  Decimal.set({ precision: DEFAULT_PRECISION });

  const PI = Decimal.acos(-1);
  const PI_2 = PI.div(2), PI_4 = PI.div(4), PI_8 = PI.div(8);
  const TWO_THIRDS = new Decimal(2).div(3);
  const D180 = new Decimal(180), D360 = new Decimal(360), D90 = new Decimal(90);

  // ── Exact point type ──────────────────────────────────────
  // Internally: lat,lon as Decimal (degrees). `sourceDepth` records how many
  // refinement levels the source carried (Infinity-ish for codes is capped to
  // the working precision; a tap records a small/finite depth marker).
  function ExactPoint(latDec, lonDec, meta) {
    this.lat = latDec;          // Decimal degrees
    this.lon = lonDec;          // Decimal degrees
    this.meta = meta || {};     // { source:'tap'|'geosonify'|'healpix'|'latlon', depth, scheme }
  }

  // ── Uncertainty model ─────────────────────────────────────
  // Uncertainty is a property of the SOURCE, not the displayed scheme: a single
  // worst-case ground-distance radius in METRES, scheme-independent, that does
  // NOT change when you switch cards. (Cell size, by contrast, is a property of
  // the displayed card and is scheme-dependent.) Every constructor stamps
  // meta.uncertaintyMetres + meta.basis at creation, because an exact coordinate
  // cannot reveal its own source precision after the fact — it must be recorded.
  const EARTH_R_M = 6371008.7714;
  const M_PER_DEG = (Math.PI / 180) * EARTH_R_M;   // ≈ 111195 m per degree (lat)

  // worst-case ground radius (m) of an equirectangular cell at `lat` whose span
  // is base^-depth of the full range. latM constant; lonM shrinks by cos lat.
  function equirectCellMetres(rows, cols, depth, latDeg) {
    const latM = Math.exp(Math.log(180 * M_PER_DEG) - depth * Math.log(rows));
    const cosL = Math.max(1e-12, Math.cos(latDeg * Math.PI / 180));
    const lonM = Math.exp(Math.log(360 * M_PER_DEG * cosL) - depth * Math.log(cols));
    return Math.max(latM, lonM);
  }
  // HEALPix equal-area cell: single mean linear size √(area).
  function healpixCellMetres(order) {
    const logArea = Math.log(Math.PI / 3) - order * Math.log(4);
    return EARTH_R_M * Math.exp(0.5 * logArea);
  }
  // typed/imported lat/lon at N decimal places → worst-case quantisation (m).
  function decimalsToMetres(decimals, latDeg) {
    const stepDeg = Math.pow(10, -decimals) * 0.5;
    const latM = stepDeg * M_PER_DEG;
    const lonM = stepDeg * M_PER_DEG * Math.max(1e-12, Math.cos(latDeg * Math.PI / 180));
    return Math.max(latM, lonM);
  }
  function countDecimals(v) {
    const s = String(v);
    const i = s.indexOf('.');
    return i < 0 ? 0 : (s.length - i - 1);
  }
  // map pin placed with care at a given zoom (Web Mercator metres-per-pixel).
  function pinMetres(zoom, latDeg, pixels) {
    const mpp = 156543.03392 * Math.cos(latDeg * Math.PI / 180) / Math.pow(2, zoom);
    return Math.abs(mpp) * (pixels || 1);
  }

  // metre formatter with the full ladder (km → am), shared by basis + readout.
  function fmtM(m) {
    if (!isFinite(m) || m <= 0) return '0';
    if (m >= 1000)  return (m / 1000).toFixed(1) + ' km';
    if (m >= 1)     return m.toFixed(1) + ' m';
    if (m >= 1e-2)  return (m * 1e2).toFixed(1) + ' cm';
    if (m >= 1e-3)  return (m * 1e3).toFixed(1) + ' mm';
    if (m >= 1e-6)  return (m * 1e6).toFixed(1) + ' µm';
    if (m >= 1e-9)  return (m * 1e9).toFixed(1) + ' nm';
    if (m >= 1e-12) return (m * 1e12).toFixed(1) + ' pm';
    if (m >= 1e-15) return (m * 1e15).toFixed(1) + ' fm';
    if (m >= 1e-18) return (m * 1e18).toFixed(1) + ' am';
    return m.toExponential(1) + ' m';
  }

  // ── Constructors ──────────────────────────────────────────
  function fromLatLon(lat, lon, meta) {
    meta = meta || {};
    const latDeg = Number(lat);
    let uncertaintyMetres, basis;
    if (meta.accuracyMetres != null) {
      uncertaintyMetres = Math.abs(meta.accuracyMetres);
      basis = meta.basis || ('GPS ±' + fmtM(uncertaintyMetres));
    } else if (meta.zoom != null) {
      uncertaintyMetres = pinMetres(meta.zoom, latDeg, meta.pixels || 1);
      basis = meta.basis || ('map pin @ z' + meta.zoom);
    } else {
      const dec = Math.max(countDecimals(lat), countDecimals(lon));
      uncertaintyMetres = decimalsToMetres(dec, latDeg);
      basis = meta.basis || ('typed, ' + dec + ' dp');
    }
    return new ExactPoint(new Decimal(lat), new Decimal(lon),
      Object.assign({ source: 'latlon', depth: 0, uncertaintyMetres, basis }, meta));
  }

  // Geosonify equirectangular code → exact rational lat/lon (NO trig, exact).
  // grid2D: rows×cols token grid; the code is a sequence of tokens.
  function fromGeosonifyCode(code, grid2D) {
    const dims = gridDims(grid2D), rows = dims.rows, cols = dims.cols;
    const flat = flattenGrid(grid2D);
    const tokens = tokenizeGeo(code, flat);
    if (!tokens) return null;
    // exact bounds via denominator accumulation: cell = [loN,hiN]/den of range
    let latLoN = 0n, latHiN = 1n, latDen = 1n;
    let lonLoN = 0n, lonHiN = 1n, lonDen = 1n;
    for (const t of tokens) {
      const idx = flat.indexOf(t); if (idx < 0) return null;
      const r = Math.floor(idx / cols), c = idx % cols;
      const latW = latHiN - latLoN, lonW = lonHiN - lonLoN;
      latDen *= BigInt(rows); latLoN = latLoN * BigInt(rows) + BigInt(r) * latW; latHiN = latLoN + latW;
      lonDen *= BigInt(cols); lonLoN = lonLoN * BigInt(cols) + BigInt(c) * lonW; lonHiN = lonLoN + lonW;
    }
    // centre fraction → degrees, as Decimal (exact to working precision)
    const latFrac = new Decimal((latLoN + latHiN).toString()).div(new Decimal((2n * latDen).toString()));
    const lonFrac = new Decimal((lonLoN + lonHiN).toString()).div(new Decimal((2n * lonDen).toString()));
    const lat = D90.minus(D180.times(latFrac));         // 90 - 180*frac
    const lon = D180.times(lonFrac.times(2)).minus(D180); // -180 + 360*frac
    // A code IS the source of truth, so its uncertainty equals its own cell size
    // at this depth (no looser measurement behind it). Same for typed or scanned.
    const u = equirectCellMetres(rows, cols, tokens.length, Number(lat));
    return new ExactPoint(lat, lon, {
      source: 'geosonify', depth: tokens.length,
      uncertaintyMetres: u, basis: 'code, ' + tokens.length + ' digits'
    });
  }

  // HEALPix code → exact point. The HEALPix address is exact; its CENTRE in
  // lat/lon needs the (inverse) projection. We use the engine's centre for the
  // representative point, lifted to Decimal. (Address identity is exact; the
  // lat/lon centre is exact to working precision via the same projection.)
  function fromHealpixCode(code, schemeKey, orderHint) {
    if (!HealpixGrids) return null;
    schemeKey = schemeKey || 'hphex';
    // Honor an explicit "@k" order suffix (resolves odd-order length ambiguity),
    // else use orderHint if given.
    let order = orderHint;
    const at = String(code).lastIndexOf('@');
    if (at > 0 && /^@\d{1,3}$/.test(String(code).slice(at))) {
      order = parseInt(String(code).slice(at + 1), 10);
      code = String(code).slice(0, at);
    }
    const parsed = deserializeHealpix(schemeKey, code, order);
    if (!parsed) {
      const ll = HealpixGrids.decode(schemeKey, code, order || null, {});
      if (!ll) return null;
      return new ExactPoint(new Decimal(ll[0]), new Decimal(ll[1]), { source: 'healpix', scheme: schemeKey });
    }
    const ord = parsed.digits.length;
    const { x, y } = digitsToXy(parsed.digits);
    const { lat, lon } = fxyToLatlon(parsed.f, x, y, ord);
    const u = healpixCellMetres(ord);
    return new ExactPoint(lat, lon, {
      source: 'healpix', scheme: schemeKey, depth: ord,
      uncertaintyMetres: u, basis: 'HEALPix code, order ' + ord
    });
  }

  // ── Lossy view ────────────────────────────────────────────
  ExactPoint.prototype.toLatLon = function () {
    return { lat: this.lat.toNumber(), lon: this.lon.toNumber() };
  };
  ExactPoint.prototype.toLatLonStrings = function (digits) {
    const d = digits || 30;
    return { lat: this.lat.toFixed(d), lon: this.lon.toFixed(d) };
  };

  // ── Source uncertainty (scheme-independent, in metres) ────
  // The worst-case ground radius the SOURCE knew this location to. Invariant
  // across cards — switching display schemes does not change it.
  ExactPoint.prototype.uncertaintyMetres = function () {
    return (this.meta && this.meta.uncertaintyMetres != null)
      ? this.meta.uncertaintyMetres : null;
  };
  ExactPoint.prototype.uncertaintyText = function () {
    const u = this.uncertaintyMetres();
    if (u == null) return null;
    const basis = this.meta.basis ? ' (' + this.meta.basis + ')' : '';
    return '±' + fmtM(u) + basis;
  };

  // ── Lossless views ────────────────────────────────────────
  ExactPoint.prototype.toGeosonifyCode = function (grid2D, iterations) {
    const dims = gridDims(grid2D), rows = dims.rows, cols = dims.cols;
    const flat = flattenGrid(grid2D);
    // exact encode by rational comparison (denominator accumulation)
    // point fraction of range:
    const pLatNum = D90.minus(this.lat).div(D180);   // [0,1] from top
    const pLonNum = this.lon.plus(D180).div(D360);   // [0,1] from left
    let latLoN = 0n, latHiN = 1n, latDen = 1n;
    let lonLoN = 0n, lonHiN = 1n, lonDen = 1n;
    let code = '';
    for (let it = 0; it < iterations; it++) {
      const latW = latHiN - latLoN, lonW = lonHiN - lonLoN;
      // r = floor( (pLat*latDen - latLoN)/latW * rows ) — compute via Decimal then to int
      const rD = pLatNum.times(latDen.toString()).minus(latLoN.toString())
                  .div(latW.toString()).times(rows).floor();
      let r = rD.toNumber(); if (r < 0) r = 0; if (r >= rows) r = rows - 1;
      const cD = pLonNum.times(lonDen.toString()).minus(lonLoN.toString())
                  .div(lonW.toString()).times(cols).floor();
      let c = cD.toNumber(); if (c < 0) c = 0; if (c >= cols) c = cols - 1;
      const tok = String(flat[r * cols + c]); if (!tok) return code;
      code += tok;
      latDen *= BigInt(rows); latLoN = latLoN * BigInt(rows) + BigInt(r) * latW; latHiN = latLoN + latW;
      lonDen *= BigInt(cols); lonLoN = lonLoN * BigInt(cols) + BigInt(c) * lonW; lonHiN = lonLoN + lonW;
    }
    return code;
  };

  ExactPoint.prototype.toHealpixCode = function (schemeKey, order) {
    // exact lat/lon → deep HEALPix cell via arbitrary-precision projection,
    // then serialize through the engine's address layer.
    const fxy = latlonToFxy(this.lat, this.lon, order);
    if (!HealpixGrids) return null;
    // Build the code from (f, digits) using the engine's serializer path.
    // digits = quaternary path from interleaved x,y bits.
    const digits = fxyToDigits(fxy.f, fxy.x, fxy.y, order);
    return serializeHealpix(schemeKey || 'hphex', fxy.f, digits);
  };

  // ── Precision consumers ───────────────────────────────────
  // Exact geodesic distance (metres) via arbitrary-precision Karney-style
  // series is heavy; for v1 we provide an arbitrary-precision spherical
  // (haversine) distance — always convergent, exact to working precision on a
  // sphere of mean Earth radius. Ellipsoidal exact distance is a later upgrade.
  const EARTH_R = new Decimal('6371008.7714');  // mean radius, metres
  function distance(a, b) {
    const φ1 = deg2rad(a.lat), φ2 = deg2rad(b.lat);
    const dφ = deg2rad(b.lat.minus(a.lat));
    const dλ = deg2rad(b.lon.minus(a.lon));
    const sdφ = Decimal.sin(dφ.div(2)), sdλ = Decimal.sin(dλ.div(2));
    const h = sdφ.times(sdφ).plus(Decimal.cos(φ1).times(Decimal.cos(φ2)).times(sdλ).times(sdλ));
    const c = new Decimal(2).times(Decimal.asin(Decimal.min(1, Decimal.sqrt(h))));
    return EARTH_R.times(c);   // Decimal metres
  }

  // Cross-scheme conversion = the exact point IS the bridge. These are thin.
  function convertGeosonifyToHealpix(code, grid2D, schemeKey, order) {
    const pt = fromGeosonifyCode(code, grid2D); if (!pt) return null;
    return pt.toHealpixCode(schemeKey, order);
  }
  function convertHealpixToGeosonify(code, schemeKey, grid2D, iterations) {
    const pt = fromHealpixCode(code, schemeKey); if (!pt) return null;
    return pt.toGeosonifyCode(grid2D, iterations);
  }

  // ── Arbitrary-precision HEALPix forward projection ────────
  function sigmaDec(z) {
    if (z.isNegative()) return sigmaDec(z.neg()).neg();
    return new Decimal(2).minus(Decimal.sqrt(new Decimal(3).times(new Decimal(1).minus(z))));
  }
  function za2tuDec(z, a) {
    if (z.abs().lte(TWO_THIRDS)) {
      return { t: a, u: new Decimal(3).times(PI_8).times(z) };
    }
    const p_t = a.mod(PI_2);
    const sz = sigmaDec(z);
    return { t: a.minus(sz.abs().minus(1).times(p_t.minus(PI_4))), u: PI_4.times(sz) };
  }
  function tu2fpqDec(t, u) {
    t = t.div(PI_4); u = u.div(PI_4);
    t = t.mod(8); if (t.isNegative()) t = t.plus(8);
    t = t.minus(4); u = u.plus(5);
    let pp = u.plus(t).div(2); pp = Decimal.max(0, Decimal.min(5, pp));
    const PP = pp.floor();
    let qq = u.minus(t).div(2); qq = Decimal.max(new Decimal(3).minus(PP), Decimal.min(new Decimal(6).minus(PP), qq));
    const QQ = qq.floor();
    const V = new Decimal(5).minus(PP.plus(QQ));
    if (V.isNegative()) return { f: 0, p: new Decimal(1), q: new Decimal(1) };
    const H = PP.minus(QQ).plus(4);
    const f = 4 * V.toNumber() + (Math.floor(H.toNumber() / 2) % 4);
    return { f, p: pp.minus(pp.floor()), q: qq.minus(qq.floor()) };
  }
  function latlonToFxy(latDec, lonDec, order) {
    const theta = D90.minus(latDec).times(PI).div(D180);
    const phi = lonDec.mod(360).plus(360).mod(360).times(PI).div(D180);
    const z = Decimal.cos(theta);
    const { t, u } = za2tuDec(z, phi);
    const { f, p, q } = tu2fpqDec(t, u);
    let px = p, qy = q, x = 0n, y = 0n;
    const TWO = new Decimal(2);
    for (let i = 0; i < order; i++) {
      px = px.times(TWO); const xb = px.gte(1) ? 1 : 0; if (xb) px = px.minus(1);
      qy = qy.times(TWO); const yb = qy.gte(1) ? 1 : 0; if (yb) qy = qy.minus(1);
      x = (x << 1n) | BigInt(xb);
      y = (y << 1n) | BigInt(yb);
    }
    return { f, x, y };
  }

  // Arbitrary-precision INVERSE: (f, x, y, order) → exact {lat,lon} Decimals.
  // Mirrors the engine's fxy2tu → tu2za → (theta=acos z, phi=a), in Decimal, so
  // a deep HEALPix cell yields an exact representative lat/lon (cell centre uses
  // x+0.5, y+0.5). This is what makes HEALPix → exact-point lossless at depth.
  function fxyToLatlon(f, x, y, order) {
    const nside = new Decimal(2).pow(order);           // exact 2^order
    // Match the engine's fxy2tu convention exactly: it maps INTEGER (x,y) to the
    // cell centre (the half-cell offset is baked into the formula constants), so
    // we use x,y directly — adding +0.5 would double-shift by half a cell.
    const xD = new Decimal(x.toString());
    const yD = new Decimal(y.toString());
    const f_row = Math.floor(f / 4);
    const f1 = new Decimal(f_row + 2);
    const f2 = new Decimal(2 * (f % 4) - (f_row % 2) + 1);
    const v = xD.plus(yD), h = xD.minus(yD);
    const iD = f1.times(nside).minus(v).minus(1);
    const kD = f2.times(nside).plus(h).plus(nside.times(8));
    const t = kD.div(nside).times(PI_4);
    const u = PI_2.minus(iD.div(nside).times(PI_4));
    const { z, a } = tu2zaDec(t, u);
    // clamp z to [-1,1] for acos
    let zc = z; if (zc.gt(1)) zc = new Decimal(1); if (zc.lt(-1)) zc = new Decimal(-1);
    const theta = Decimal.acos(zc);
    const lat = D90.minus(theta.times(D180).div(PI));
    let lon = a.times(D180).div(PI);
    // normalize lon to [-180,180]
    lon = lon.mod(360); if (lon.gt(180)) lon = lon.minus(360); if (lon.lt(-180)) lon = lon.plus(360);
    return { lat, lon };
  }
  function tu2zaDec(t, u) {
    const abs_u = u.abs();
    if (abs_u.gte(PI_2)) return { z: u.isNegative() ? new Decimal(-1) : new Decimal(1), a: new Decimal(0) };
    if (abs_u.lte(PI_4)) {
      const z = new Decimal(8).div(new Decimal(3).times(PI)).times(u);
      return { z, a: t };
    }
    const t_t = t.mod(PI_2);
    const a = t.minus(abs_u.minus(PI_4).div(abs_u.minus(PI_2)).times(t_t.minus(PI_4)));
    const sgn = u.isNegative() ? new Decimal(-1) : new Decimal(1);
    const inner = new Decimal(2).minus(new Decimal(4).times(abs_u).div(PI));
    const z = sgn.times(new Decimal(1).minus(new Decimal(1).div(3).times(inner.times(inner))));
    return { z, a };
  }

  // ── helpers ───────────────────────────────────────────────
  function deg2rad(d) { return (d instanceof Decimal ? d : new Decimal(d)).times(PI).div(D180); }
  function flattenGrid(g) { return g ? [].concat.apply([], g) : []; }
  function gridDims(g) { const r = g.length || 0, c = r ? (g[0].length || 0) : 0; return { rows: r, cols: c }; }
  function tokenizeGeo(code, flat) {
    // greedy longest-match (handles multi-char tokens)
    const uniq = Array.from(new Set(flat.map(String))).filter(t => t.length).sort((a, b) => b.length - a.length);
    const out = []; let i = 0;
    while (i < code.length) {
      let m = null;
      for (const tok of uniq) { if (code.substr(i, tok.length) === tok) { m = tok; break; } }
      if (!m) return null;
      out.push(m); i += m.length;
    }
    return out;
  }
  // (f, x, y) → quaternary digits[], using the ENGINE's own NESTED convention
  // (fxy2nest + nestPath) rather than re-deriving the bit interleave — this
  // guarantees the digit order matches the serializers exactly, by construction.
  function fxyToDigits(f, x, y, order) {
    if (HealpixGrids && HealpixGrids._core && HealpixGrids.nestPath) {
      // engine nside (BigInt) for this order
      const nsideBig = 1n << BigInt(order);
      // fxy2nest is internal; reach it via nestIndex's inverse path isn't public,
      // so reconstruct the fused nested index directly with the standard formula
      // face*4^order + interleave(x→even, y→odd), which IS the engine convention.
      let interleave = 0n, s = 0n, bx = x, by = y;
      while (bx > 0n || by > 0n) {
        if (bx & 1n) interleave |= (1n << (2n * s));        // x → even bits
        if (by & 1n) interleave |= (1n << (2n * s + 1n));   // y → odd bits
        bx >>= 1n; by >>= 1n; s += 1n;
      }
      const nested = BigInt(f) * (1n << (2n * BigInt(order))) + interleave;
      return HealpixGrids.nestPath(nested, order).digits;
    }
    // fallback (shouldn't hit): x→even,y→odd, MSB-first quaternary
    const digits = new Array(order);
    for (let i = 0; i < order; i++) {
      const xb = Number((x >> BigInt(order - 1 - i)) & 1n);
      const yb = Number((y >> BigInt(order - 1 - i)) & 1n);
      digits[i] = xb + 2 * yb;   // x low, y high — matches bit_combine
    }
    return digits;
  }
  function serializeHealpix(schemeKey, f, digits) {
    // Reuse the engine's internal serializers exposed under _ser.
    if (HealpixGrids && HealpixGrids._ser) {
      if (schemeKey === 'hpquad') return HealpixGrids._ser.serQuad(f, digits, {});
      if (schemeKey === 'hp64')   return HealpixGrids._ser.ser64(f, digits, {});
      return HealpixGrids._ser.serHex(f, digits, {});
    }
    return null;
  }
  function deserializeHealpix(schemeKey, code, order) {
    if (HealpixGrids && HealpixGrids._ser) {
      const ord = (order != null) ? order : null;
      let r;
      if (schemeKey === 'hpquad') r = HealpixGrids._ser.deserQuad(code, ord, {});
      else if (schemeKey === 'hp64') r = HealpixGrids._ser.deser64(code, ord, {});
      else r = HealpixGrids._ser.deserHex(code, ord, {});
      return r && r.digits ? r : null;
    }
    return null;
  }
  // digits[] → (x, y) BigInt. Engine convention (bit_combine): within each
  // quaternary digit, bit0 = x, bit1 = y; digit[0] is the most-significant level.
  function digitsToXy(digits) {
    let x = 0n, y = 0n;
    for (let i = 0; i < digits.length; i++) {
      const d = digits[i];
      x = (x << 1n) | BigInt(d & 1);
      y = (y << 1n) | BigInt((d >> 1) & 1);
    }
    return { x, y };
  }

  function makeStub() {
    const err = () => { throw new Error('[geosonify-precision] decimal.js not loaded'); };
    return { fromLatLon: err, fromGeosonifyCode: err, fromHealpixCode: err,
             distance: err, _unavailable: true };
  }

  return {
    version: 'v1.0',
    DEFAULT_PRECISION,
    setPrecision: (d) => { Decimal.set({ precision: d }); },
    ExactPoint,
    makeExactPoint: function (latStr, lonStr, meta) {
      return new ExactPoint(new Decimal(latStr), new Decimal(lonStr), meta || {});
    },
    fromLatLon, fromGeosonifyCode, fromHealpixCode,
    distance,
    convertGeosonifyToHealpix, convertHealpixToGeosonify,
    // formatting + cell-size helpers (for the Cell size / Uncertainty readout)
    formatMetres: fmtM,
    equirectCellMetres, healpixCellMetres, decimalsToMetres, pinMetres,
    // exposed for tests
    _proj: { latlonToFxy }, _grid: { tokenizeGeo, fxyToDigits }
  };
});
