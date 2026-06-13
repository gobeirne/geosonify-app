// ============================================================
// gis-grids.js  —  Geosonify GIS Reference Grids
//
// Established professional coordinate schemes rendered as cards
// alongside Geosonify's own grids, so users can compare them
// directly (resolution, length, character) and GIS folks feel
// at home.
//
// Schemes:
//   pluscode  — Open Location Code (Google Plus Codes), global,
//               hierarchical base-20: a true cousin of Geosonify
//               grids (every 2 chars ≈ one 20× refinement)
//   mgrs      — Military Grid Reference System (NATO), global
//   geohash   — Geohash, global, hierarchical base-32
//   utm       — Universal Transverse Mercator easting/northing
//   nztm      — NZ Transverse Mercator 2000 (EPSG:2193)
//   bng       — British National Grid references (EPSG:27700,
//               OSGB36 via Helmert — ±~3 m vs OSTN15, fine for
//               everything short of survey work)
//   mga       — Map Grid of Australia 2020 (UTM on GDA2020)
//   localgrid — auto-selects the national grid for the current
//               location (NZTM / BNG / MGA), falling back to UTM
//
// All projection math is self-contained (no proj4 dependency):
// Krüger-series Transverse Mercator to order n⁴ (sub-mm vs PROJ
// for the supported CRSs — verified against EPSG ground truth),
// plus a 7-parameter Helmert for the WGS84↔OSGB36 datum shift.
//
// Every encoder has a decoder, so codes can be pasted/edited on
// the cards just like Geosonify codes.
//
// Iterations semantics (the +/- stepper):
//   pluscode  → code length steps (2,4,6,8,10,11,12,…)
//   mgrs      → 100 km square … 1 m (digit pairs)
//   geohash   → characters
//   bng       → letters-only … 12-figure (100 km … 0.1 m)
//   utm/nztm/mga/localgrid → rounding (10 km … 1 mm)
// ============================================================

const GISGrids = (function () {
  'use strict';

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  // ── Ellipsoids ────────────────────────────────────────────
  const GRS80 = { a: 6378137.0, f: 1 / 298.257222101 };
  const WGS84 = { a: 6378137.0, f: 1 / 298.257223563 };
  const AIRY1830 = { a: 6377563.396, f: 1 / 299.3249646 };

  // ── Transverse Mercator (Krüger series, order n⁴) ─────────
  // Forward/inverse between geodetic lat/lon (on the CRS's own
  // datum) and projected E/N. Sub-mm agreement with PROJ within
  // each CRS's domain of use.

  function tmConstants(ell, k0) {
    const n = ell.f / (2 - ell.f);
    const n2 = n * n, n3 = n2 * n, n4 = n3 * n;
    return {
      n,
      A: ell.a / (1 + n) * (1 + n2 / 4 + n4 / 64),
      alpha: [
        n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180,
        13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440,
        61 * n3 / 240 - 103 * n4 / 140,
        49561 * n4 / 161280
      ],
      beta: [
        n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360,
        n2 / 48 + n3 / 15 - 437 * n4 / 1440,
        17 * n3 / 480 - 37 * n4 / 840,
        4397 * n4 / 161280
      ],
      k0
    };
  }

  /** Conformal-sphere ordinate t(φ) — Karney's τ′ via sinh/atanh form. */
  function tOfPhi(phi, n) {
    const s = Math.sin(phi);
    const c = 2 * Math.sqrt(n) / (1 + n);
    return Math.sinh(Math.atanh(s) - c * Math.atanh(c * s));
  }

  /** Rectifying ξ for a point on the central meridian at latitude φ. */
  function xiAtCM(phi, K) {
    const t = tOfPhi(phi, K.n);
    const xip = Math.atan(t);   // η′ = 0 on the CM
    let xi = xip;
    for (let j = 1; j <= 4; j++) xi += K.alpha[j - 1] * Math.sin(2 * j * xip);
    return xi;
  }

  /**
   * Build a TM CRS. lat0/lon0 in degrees.
   * Returns { forward(lat,lon)→{e,n}, inverse(e,n)→{lat,lon} } where
   * lat/lon are on the CRS's own datum.
   */
  function makeTM(ell, lat0, lon0, k0, fe, fn) {
    const K = tmConstants(ell, k0);
    const M0 = k0 * K.A * xiAtCM(lat0 * D2R, K);   // northing of lat0

    function forward(latDeg, lonDeg) {
      const phi = latDeg * D2R;
      let lam = (lonDeg - lon0) * D2R;
      // normalise to (−π, π]
      lam = Math.atan2(Math.sin(lam), Math.cos(lam));
      const t = tOfPhi(phi, K.n);
      const cl = Math.cos(lam);
      const xip = Math.atan2(t, cl);
      const etap = Math.asinh(Math.sin(lam) / Math.sqrt(t * t + cl * cl));
      let xi = xip, eta = etap;
      for (let j = 1; j <= 4; j++) {
        xi  += K.alpha[j - 1] * Math.sin(2 * j * xip) * Math.cosh(2 * j * etap);
        eta += K.alpha[j - 1] * Math.cos(2 * j * xip) * Math.sinh(2 * j * etap);
      }
      return { e: fe + k0 * K.A * eta, n: fn + k0 * K.A * xi - M0 };
    }

    function inverse(E, N) {
      const xi = (N - fn + M0) / (k0 * K.A);
      const eta = (E - fe) / (k0 * K.A);
      let xip = xi, etap = eta;
      for (let j = 1; j <= 4; j++) {
        xip  -= K.beta[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
        etap -= K.beta[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
      }
      const sxip = Math.sin(xip), cxip = Math.cos(xip), shet = Math.sinh(etap);
      const tau = sxip / Math.sqrt(shet * shet + cxip * cxip);  // t at the point
      const lam = Math.atan2(shet, cxip);
      // Invert t(φ) by fixed-point iteration on the conformal latitude
      let phi = Math.atan(tau);
      for (let i = 0; i < 8; i++) {
        const ti = tOfPhi(phi, K.n);
        const dphi = Math.atan(tau) - Math.atan(ti);
        phi += dphi;
        if (Math.abs(dphi) < 1e-14) break;
      }
      return { lat: phi * R2D, lon: lon0 + lam * R2D };
    }

    return { forward, inverse };
  }

  // ── WGS84 ↔ OSGB36 (Helmert 7-parameter) ──────────────────
  // Standard parameters; accuracy ±~3 m vs the definitive OSTN15
  // grid — appropriate here, noted in the info panel.

  function geodeticToXYZ(latDeg, lonDeg, ell) {
    const phi = latDeg * D2R, lam = lonDeg * D2R;
    const e2 = ell.f * (2 - ell.f);
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const nu = ell.a / Math.sqrt(1 - e2 * sp * sp);
    return { x: nu * cp * Math.cos(lam), y: nu * cp * Math.sin(lam), z: nu * (1 - e2) * sp };
  }

  function xyzToGeodetic(x, y, z, ell) {
    const e2 = ell.f * (2 - ell.f);
    const p = Math.sqrt(x * x + y * y);
    let phi = Math.atan2(z, p * (1 - e2));
    for (let i = 0; i < 10; i++) {
      const sp = Math.sin(phi);
      const nu = ell.a / Math.sqrt(1 - e2 * sp * sp);
      const next = Math.atan2(z + e2 * nu * sp, p);
      if (Math.abs(next - phi) < 1e-13) { phi = next; break; }
      phi = next;
    }
    return { lat: phi * R2D, lon: Math.atan2(y, x) * R2D };
  }

  function helmert(p, t) {
    // t = { tx, ty, tz (m), rx, ry, rz (arc-sec), s (ppm) }
    const rx = t.rx / 3600 * D2R, ry = t.ry / 3600 * D2R, rz = t.rz / 3600 * D2R;
    const s = 1 + t.s * 1e-6;
    return {
      x: t.tx + s * (p.x - rz * p.y + ry * p.z),
      y: t.ty + s * (rz * p.x + p.y - rx * p.z),
      z: t.tz + s * (-ry * p.x + rx * p.y + p.z)
    };
  }

  const WGS84_TO_OSGB36 = { tx: -446.448, ty: 125.157, tz: -542.060, rx: -0.1502, ry: -0.2470, rz: -0.8421, s: 20.4894 };
  const OSGB36_TO_WGS84 = { tx: 446.448, ty: -125.157, tz: 542.060, rx: 0.1502, ry: 0.2470, rz: 0.8421, s: -20.4894 };

  function wgs84ToOSGB36(lat, lon) {
    const g = xyzToGeodetic.bind(null);
    const p = helmert(geodeticToXYZ(lat, lon, WGS84), WGS84_TO_OSGB36);
    return xyzToGeodetic(p.x, p.y, p.z, AIRY1830);
  }
  function osgb36ToWGS84(lat, lon) {
    const p = helmert(geodeticToXYZ(lat, lon, AIRY1830), OSGB36_TO_WGS84);
    return xyzToGeodetic(p.x, p.y, p.z, WGS84);
  }

  // ── Concrete CRSs ─────────────────────────────────────────
  const NZTM = makeTM(GRS80, 0, 173, 0.9996, 1600000, 10000000);          // EPSG:2193
  const BNG_TM = makeTM(AIRY1830, 49, -2, 0.9996012717, 400000, -100000); // EPSG:27700 (on OSGB36)

  const _utmCache = {};
  function utmTM(zone, south) {
    const key = zone + (south ? 's' : 'n');
    if (!_utmCache[key]) {
      _utmCache[key] = makeTM(WGS84, 0, zone * 6 - 183, 0.9996, 500000, south ? 10000000 : 0);
    }
    return _utmCache[key];
  }
  function utmZone(lat, lon) {
    let zone = Math.floor((lon + 180) / 6) + 1;
    // Norway / Svalbard exceptions
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
    if (lat >= 72 && lat < 84) {
      if (lon >= 0 && lon < 9) zone = 31;
      else if (lon >= 9 && lon < 21) zone = 33;
      else if (lon >= 21 && lon < 33) zone = 35;
      else if (lon >= 33 && lon < 42) zone = 37;
    }
    return Math.min(60, Math.max(1, zone));
  }

  const LAT_BANDS = 'CDEFGHJKLMNPQRSTUVWX';  // 8° bands from −80; X spans 72..84
  function latBand(lat) {
    if (lat < -80 || lat > 84) return null;
    return LAT_BANDS[Math.min(19, Math.floor((lat + 80) / 8))];
  }

  function wgs84ToUTM(lat, lon) {
    const zone = utmZone(lat, lon);
    const south = lat < 0;
    const { e, n } = utmTM(zone, south).forward(lat, lon);
    return { zone, south, band: latBand(lat), e, n };
  }

  // ── MGRS ──────────────────────────────────────────────────
  const COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];  // by (zone−1) % 3
  const ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';             // 20-letter cycle

  function mgrsEncode(lat, lon, digits) {
    const u = wgs84ToUTM(lat, lon);
    if (!u.band) return null;
    const colSet = COL_SETS[(u.zone - 1) % 3];
    const e100k = Math.floor(u.e / 100000);          // 1..8 within a zone
    const colLetter = colSet[(e100k - 1) % 8];
    const rowOffset = (u.zone % 2 === 0) ? 5 : 0;    // even zones start at F
    const n100k = Math.floor(u.n / 100000) % 20;
    const rowLetter = ROW_LETTERS[(n100k + rowOffset) % 20];
    let s = `${u.zone}${u.band}${colLetter}${rowLetter}`;
    if (digits > 0) {
      const div = Math.pow(10, 5 - digits);
      const eDig = Math.floor((u.e % 100000) / div);
      const nDig = Math.floor((u.n % 100000) / div);
      s += String(eDig).padStart(digits, '0') + String(nDig).padStart(digits, '0');
    }
    return s;
  }

  function mgrsDecode(str) {
    const m = String(str).trim().toUpperCase().replace(/\s+/g, '')
      .match(/^(\d{1,2})([CDEFGHJKLMNPQRSTUVWX])([A-HJ-NP-Z])([A-HJ-NP-V])(\d*)$/);
    if (!m) return null;
    const zone = parseInt(m[1]);
    const band = m[2];
    const colLetter = m[3], rowLetter = m[4], digits = m[5];
    if (digits.length % 2 !== 0) return null;
    const prec = digits.length / 2;
    const colSet = COL_SETS[(zone - 1) % 3];
    const colIdx = colSet.indexOf(colLetter);
    if (colIdx < 0) return null;
    const e100k = (colIdx + 1) * 100000;
    const rowOffset = (zone % 2 === 0) ? 5 : 0;
    let rowIdx = ROW_LETTERS.indexOf(rowLetter);
    if (rowIdx < 0) return null;
    rowIdx = (rowIdx - rowOffset + 20) % 20;
    const div = prec > 0 ? Math.pow(10, 5 - prec) : 100000;
    const eIn = prec > 0 ? parseInt(digits.slice(0, prec)) * div + div / 2 : 50000;
    const nIn = prec > 0 ? parseInt(digits.slice(prec)) * div + div / 2 : 50000;
    const E = e100k + eIn;
    // Resolve the 2,000 km northing ambiguity using the band's range
    const bandIdx = LAT_BANDS.indexOf(band);
    const south = bandIdx < 10;
    const latMin = -80 + bandIdx * 8;
    const tm = utmTM(zone, south);
    // Approximate northing of the band's lower edge in this zone
    const nBase = tm.forward(latMin, zone * 6 - 183).n;
    let N = rowIdx * 100000 + nIn;
    // Lift N by multiples of 2,000,000 until at/above the band base (small slack for edge cells)
    while (N < nBase - 100000) N += 2000000;
    const ll = tm.inverse(E, N);
    return [ll.lat, ll.lon];
  }

  // ── Open Location Code (Plus Codes) ───────────────────────
  // Apache-2.0 spec: https://github.com/google/open-location-code
  const OLC_ALPHABET = '23456789CFGHJMPQRVWX';
  const OLC_GRID_COLS = 4, OLC_GRID_ROWS = 5;

  function olcEncode(lat, lon, length) {
    length = Math.max(2, Math.min(15, length));
    if (length < 10 && length % 2 === 1) length += 1;
    lat = Math.min(90, Math.max(-90, lat));
    lon = lon - Math.floor((lon + 180) / 360) * 360;  // normalise to [-180,180)
    // Special case: lat 90 must encode inside the top cell
    if (lat === 90) {
      let h = 400 / Math.pow(20, Math.min(length, 10) / 2 - 1);
      if (length > 10) h /= Math.pow(OLC_GRID_ROWS, length - 10);
      lat -= h / 2;
    }
    // Work in integer units of the finest resolution to dodge float drift
    let latVal = Math.round((lat + 90) * 8000 * Math.pow(OLC_GRID_ROWS, 5));   // 2.5e-7° units
    let lonVal = Math.round((lon + 180) * 8000 * Math.pow(OLC_GRID_COLS, 5));
    let code = '';
    // Grid digits (positions 11..15), computed least-significant first
    if (length > 10) {
      let grid = '';
      for (let i = 0; i < 5; i++) {
        const latDigit = latVal % OLC_GRID_ROWS;
        const lonDigit = lonVal % OLC_GRID_COLS;
        grid = OLC_ALPHABET[latDigit * OLC_GRID_COLS + lonDigit] + grid;
        latVal = Math.floor(latVal / OLC_GRID_ROWS);
        lonVal = Math.floor(lonVal / OLC_GRID_COLS);
      }
      code = grid.slice(0, length - 10);
    } else {
      latVal = Math.floor(latVal / Math.pow(OLC_GRID_ROWS, 5));
      lonVal = Math.floor(lonVal / Math.pow(OLC_GRID_COLS, 5));
    }
    // Pair digits (positions 1..10), least-significant first
    if (length <= 10) {
      latVal = Math.floor((lat + 90) * 8000);
      lonVal = Math.floor((lon + 180) * 8000);
    } else {
      latVal = Math.floor(Math.round((lat + 90) * 8000 * Math.pow(OLC_GRID_ROWS, 5)) / Math.pow(OLC_GRID_ROWS, 5));
      lonVal = Math.floor(Math.round((lon + 180) * 8000 * Math.pow(OLC_GRID_COLS, 5)) / Math.pow(OLC_GRID_COLS, 5));
    }
    let pairs = '';
    for (let i = 0; i < 5; i++) {
      pairs = OLC_ALPHABET[lonVal % 20] + pairs;
      pairs = OLC_ALPHABET[latVal % 20] + pairs;
      latVal = Math.floor(latVal / 20);
      lonVal = Math.floor(lonVal / 20);
    }
    let full = pairs + (length > 10 ? code : '');
    // Insert '+' after 8 digits; pad short codes
    if (length < 8) {
      full = full.slice(0, length) + '0'.repeat(8 - length) + '+';
    } else {
      full = full.slice(0, 8) + '+' + full.slice(8, Math.min(full.length, length));
    }
    return full;
  }

  function olcDecode(str) {
    let s = String(str).trim().toUpperCase();
    if (!/^[23456789CFGHJMPQRVWX0]+\+?[23456789CFGHJMPQRVWX]*$/.test(s)) return null;
    s = s.replace('+', '');
    const padIdx = s.indexOf('0');
    if (padIdx >= 0) s = s.slice(0, padIdx);
    if (s.length < 2) return null;
    let latLo = -90, lonLo = -180;
    let latRes = 20, lonRes = 20;
    let i = 0;
    // Pairs
    while (i + 1 < Math.min(s.length, 10)) {
      latLo += OLC_ALPHABET.indexOf(s[i]) * latRes;
      lonLo += OLC_ALPHABET.indexOf(s[i + 1]) * lonRes;
      latRes /= 20; lonRes /= 20;
      i += 2;
    }
    // Odd leftover before grid section isn't valid below length 10
    if (i < Math.min(s.length, 10)) return null;
    latRes *= 20; lonRes *= 20;  // step back: res now = size of last decoded cell
    // Grid digits
    let gLatRes = latRes, gLonRes = lonRes;
    for (let g = 10; g < s.length; g++) {
      const idx = OLC_ALPHABET.indexOf(s[g]);
      if (idx < 0) return null;
      gLatRes /= OLC_GRID_ROWS; gLonRes /= OLC_GRID_COLS;
      latLo += Math.floor(idx / OLC_GRID_COLS) * gLatRes;
      lonLo += (idx % OLC_GRID_COLS) * gLonRes;
    }
    const latH = s.length <= 10 ? latRes : gLatRes;
    const lonW = s.length <= 10 ? lonRes : gLonRes;
    return [latLo + latH / 2, lonLo + lonW / 2];
  }

  /** OLC cell dimensions in degrees for a code length. */
  function olcCellDeg(length) {
    const pairSteps = Math.min(length, 10) / 2;
    let latDeg = 20 / Math.pow(20, pairSteps - 1);
    let lonDeg = latDeg;
    if (length > 10) {
      latDeg /= Math.pow(OLC_GRID_ROWS, length - 10);
      lonDeg /= Math.pow(OLC_GRID_COLS, length - 10);
    }
    return { latDeg, lonDeg };
  }

  // ── Geohash ───────────────────────────────────────────────
  const GH_ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';

  function geohashEncode(lat, lon, length) {
    length = Math.max(1, Math.min(12, length));
    let latLo = -90, latHi = 90, lonLo = -180, lonHi = 180;
    let isLon = true, bit = 0, ch = 0, out = '';
    while (out.length < length) {
      if (isLon) {
        const mid = (lonLo + lonHi) / 2;
        if (lon >= mid) { ch = ch * 2 + 1; lonLo = mid; } else { ch = ch * 2; lonHi = mid; }
      } else {
        const mid = (latLo + latHi) / 2;
        if (lat >= mid) { ch = ch * 2 + 1; latLo = mid; } else { ch = ch * 2; latHi = mid; }
      }
      isLon = !isLon;
      if (++bit === 5) { out += GH_ALPHABET[ch]; bit = 0; ch = 0; }
    }
    return out;
  }

  function geohashDecode(str) {
    const s = String(str).trim().toLowerCase();
    if (!/^[0-9b-hj-km-np-z]+$/.test(s)) return null;
    let latLo = -90, latHi = 90, lonLo = -180, lonHi = 180;
    let isLon = true;
    for (const c of s) {
      const idx = GH_ALPHABET.indexOf(c);
      if (idx < 0) return null;
      for (let b = 4; b >= 0; b--) {
        const bit = (idx >> b) & 1;
        if (isLon) {
          const mid = (lonLo + lonHi) / 2;
          if (bit) lonLo = mid; else lonHi = mid;
        } else {
          const mid = (latLo + latHi) / 2;
          if (bit) latLo = mid; else latHi = mid;
        }
        isLon = !isLon;
      }
    }
    return [(latLo + latHi) / 2, (lonLo + lonHi) / 2];
  }

  function geohashCellDeg(length) {
    const bits = length * 5;
    const lonBits = Math.ceil(bits / 2), latBits = Math.floor(bits / 2);
    return { latDeg: 180 / Math.pow(2, latBits), lonDeg: 360 / Math.pow(2, lonBits) };
  }

  // ── British National Grid letter references ───────────────
  const GRID_LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';  // no I

  function bngLettersFromEN(E, N) {
    const e100k = Math.floor(E / 100000), n100k = Math.floor(N / 100000);
    if (e100k < 0 || e100k > 6 || n100k < 0 || n100k > 12) return null;
    const l1 = (19 - n100k) - (19 - n100k) % 5 + Math.floor((e100k + 10) / 5);
    const l2 = (19 - n100k) * 5 % 25 + e100k % 5;
    return GRID_LETTERS[l1] + GRID_LETTERS[l2];
  }

  function bngENFromLetters(pair) {
    const i1 = GRID_LETTERS.indexOf(pair[0]), i2 = GRID_LETTERS.indexOf(pair[1]);
    if (i1 < 0 || i2 < 0) return null;
    const e100k = ((i1 - 2) % 5) * 5 + (i2 % 5);
    const n100k = (19 - Math.floor(i1 / 5) * 5) - Math.floor(i2 / 5);
    return { e: e100k * 100000, n: n100k * 100000 };
  }

  function bngEncode(lat, lon, figures) {
    // figures = digits per axis: 0 (letters only), 1..6 (12-figure = 0.1 m)
    const os = wgs84ToOSGB36(lat, lon);
    const { e, n } = BNG_TM.forward(os.lat, os.lon);
    if (e < 0 || e >= 700000 || n < 0 || n >= 1300000) return null;
    const letters = bngLettersFromEN(e, n);
    if (!letters) return null;
    if (figures === 0) return letters;
    const div = Math.pow(10, 5 - Math.min(figures, 5));
    const scale = figures > 5 ? Math.pow(10, figures - 5) : 1;  // sub-metre digits
    const eDig = Math.floor((e % 100000) / div * scale);
    const nDig = Math.floor((n % 100000) / div * scale);
    return `${letters} ${String(eDig).padStart(figures, '0')} ${String(nDig).padStart(figures, '0')}`;
  }

  function bngDecode(str) {
    const m = String(str).trim().toUpperCase().match(/^([A-HJ-Z]{2})\s*((?:\d+\s*)*)$/);
    if (!m) return null;
    const base = bngENFromLetters(m[1]);
    if (!base) return null;
    const digits = m[2].replace(/\s+/g, '');
    if (digits.length % 2 !== 0) return null;
    const figures = digits.length / 2;
    let e = base.e, n = base.n, half = 50000;
    if (figures > 0) {
      const unit = Math.pow(10, 5 - figures);   // metres per digit step (may be <1)
      e += parseInt(digits.slice(0, figures)) * unit;
      n += parseInt(digits.slice(figures)) * unit;
      half = unit / 2;
    }
    const os = BNG_TM.inverse(e + half, n + half);
    const w = osgb36ToWGS84(os.lat, os.lon);
    return [w.lat, w.lon];
  }

  // ── Numeric E/N formatting helpers ────────────────────────

  /** metres of rounding for iteration step i (1-based) of numeric schemes */
  const EN_RES = [10000, 1000, 100, 10, 1, 0.1, 0.01, 0.001];
  function enRes(iter) { return EN_RES[Math.max(0, Math.min(EN_RES.length - 1, iter - 1))]; }

  function fmtEN(v, res) {
    if (res >= 1) return String(Math.round(v / res) * res);
    const dp = res >= 0.1 ? 1 : (res >= 0.01 ? 2 : 3);
    return v.toFixed(dp);
  }

  function fmtMetres(m) {
    if (m >= 1000) return (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km';
    if (m >= 1) return (m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)) + ' m';
    if (m >= 0.01) return (m * 100).toFixed(0) + ' cm';
    return (m * 1000).toFixed(0) + ' mm';
  }

  // ── Local-grid jurisdiction picker ────────────────────────
  function localScheme(lat, lon) {
    if (lat > -47.8 && lat < -33.7 && lon > 165.5 && lon < 179.7) return 'nztm';
    if (lat > 49.7 && lat < 61.1 && lon > -8.7 && lon < 1.8) return 'bng';
    if (lat > -44.5 && lat < -9.0 && lon > 112 && lon < 154.5) return 'mga';
    return 'utm';
  }

  // ── Scheme registry ───────────────────────────────────────
  // Each: encode(lat,lon,iter)→string, decode(str)→[lat,lon]|null,
  // cellMetres(iter,lat)→{w,h}, levels(lat,lon)→[{iter,label,dims}]

  function degDims(latDeg, lonDeg, atLat) {
    return {
      h: latDeg * 111319.9,
      w: lonDeg * 111319.9 * Math.cos(atLat * D2R)
    };
  }

  const OLC_LENGTHS = [2, 4, 6, 8, 10, 11, 12, 13, 14, 15];

  const SCHEMES = {
    pluscode: {
      name: 'Plus Code',
      link: 'https://maps.google.com/pluscodes/',
      defaultIterations: 5, minIterations: 1, maxIterations: 10,
      iterLabel: i => `${OLC_LENGTHS[i - 1]} digits`,
      encode: (lat, lon, it) => olcEncode(lat, lon, OLC_LENGTHS[Math.min(10, Math.max(1, it)) - 1]),
      decode: olcDecode,
      cellMetres: (it, lat) => {
        const d = olcCellDeg(OLC_LENGTHS[it - 1]);
        return degDims(d.latDeg, d.lonDeg, lat);
      }
    },
    mgrs: {
      name: 'MGRS',
      link: 'https://en.wikipedia.org/wiki/Military_Grid_Reference_System',
      defaultIterations: 6, minIterations: 1, maxIterations: 6,
      iterLabel: i => i === 1 ? '100 km square' : `${(i - 1) * 2}-digit`,
      encode: (lat, lon, it) => mgrsEncode(lat, lon, Math.max(0, Math.min(5, it - 1))) || '— outside MGRS bands —',
      decode: mgrsDecode,
      cellMetres: it => { const r = Math.pow(10, 5 - (it - 1)); return { w: r, h: r }; }
    },
    geohash: {
      name: 'Geohash',
      link: 'https://en.wikipedia.org/wiki/Geohash',
      defaultIterations: 9, minIterations: 1, maxIterations: 12,
      iterLabel: i => `${i} chars`,
      encode: (lat, lon, it) => geohashEncode(lat, lon, it),
      decode: geohashDecode,
      cellMetres: (it, lat) => { const d = geohashCellDeg(it); return degDims(d.latDeg, d.lonDeg, lat); }
    },
    utm: {
      name: 'UTM',
      link: 'https://en.wikipedia.org/wiki/Universal_Transverse_Mercator_coordinate_system',
      defaultIterations: 5, minIterations: 1, maxIterations: 8,
      iterLabel: i => fmtMetres(enRes(i)),
      encode: (lat, lon, it) => {
        const u = wgs84ToUTM(lat, lon);
        if (!u.band) return '— outside UTM bands —';
        const r = enRes(it);
        return `${u.zone}${u.band} ${fmtEN(u.e, r)} E ${fmtEN(u.n, r)} N`;
      },
      decode: str => {
        const m = String(str).trim().toUpperCase()
          .match(/^(\d{1,2})\s*([CDEFGHJKLMNPQRSTUVWX])\s+([\d.]+)\s*E?\s*[, ]\s*([\d.]+)\s*N?$/);
        if (!m) return null;
        const zone = parseInt(m[1]);
        const south = LAT_BANDS.indexOf(m[2]) < 10;
        const ll = utmTM(zone, south).inverse(parseFloat(m[3]), parseFloat(m[4]));
        return [ll.lat, ll.lon];
      },
      cellMetres: it => { const r = enRes(it); return { w: r, h: r }; }
    },
    nztm: {
      name: 'NZTM2000',
      link: 'https://www.linz.govt.nz/guidance/geodetic-system/coordinate-systems-used-new-zealand/projections/new-zealand-transverse-mercator-2000-nztm2000',
      defaultIterations: 5, minIterations: 1, maxIterations: 8,
      iterLabel: i => fmtMetres(enRes(i)),
      encode: (lat, lon, it) => {
        if (!(lat > -48.5 && lat < -33 && lon > 165 && lon < 180)) return '— outside NZTM area —';
        const { e, n } = NZTM.forward(lat, lon);
        const r = enRes(it);
        return `${fmtEN(e, r)} mE ${fmtEN(n, r)} mN`;
      },
      decode: str => {
        const m = String(str).trim().match(/^([\d.]+)\s*(?:mE)?\s*[, ]\s*([\d.]+)\s*(?:mN)?$/i);
        if (!m) return null;
        const e = parseFloat(m[1]), n = parseFloat(m[2]);
        if (e < 1000000 || e > 2200000 || n < 4700000 || n > 6300000) return null;
        const ll = NZTM.inverse(e, n);
        return [ll.lat, ll.lon];
      },
      cellMetres: it => { const r = enRes(it); return { w: r, h: r }; }
    },
    bng: {
      name: 'OS Grid Ref',
      link: 'https://www.ordnancesurvey.co.uk/documents/resources/guide-to-nationalgrid.pdf',
      defaultIterations: 5, minIterations: 1, maxIterations: 7,
      iterLabel: i => i === 1 ? 'letters (100 km)' : `${(i - 1) * 2}-figure`,
      encode: (lat, lon, it) => bngEncode(lat, lon, Math.max(0, Math.min(6, it - 1))) || '— outside OS grid —',
      decode: bngDecode,
      cellMetres: it => { const r = Math.pow(10, 5 - (it - 1)); return { w: r, h: r }; }
    },
    mga: {
      name: 'MGA2020',
      link: 'https://www.icsm.gov.au/datum/grid-coordinates',
      defaultIterations: 5, minIterations: 1, maxIterations: 8,
      iterLabel: i => fmtMetres(enRes(i)),
      encode: (lat, lon, it) => {
        if (!(lat > -44.5 && lat < -9 && lon > 108 && lon < 156)) return '— outside MGA area —';
        const u = wgs84ToUTM(lat, lon);   // MGA2020 = UTM on GDA2020 ≈ WGS84 (cm-level)
        const r = enRes(it);
        return `MGA${u.zone} ${fmtEN(u.e, r)} E ${fmtEN(u.n, r)} N`;
      },
      decode: str => {
        const m = String(str).trim().toUpperCase()
          .match(/^(?:MGA)?\s*(\d{2})\s+([\d.]+)\s*E?\s*[, ]\s*([\d.]+)\s*N?$/);
        if (!m) return null;
        const ll = utmTM(parseInt(m[1]), true).inverse(parseFloat(m[2]), parseFloat(m[3]));
        return [ll.lat, ll.lon];
      },
      cellMetres: it => { const r = enRes(it); return { w: r, h: r }; }
    },
    localgrid: {
      name: 'Local Grid',
      link: 'https://en.wikipedia.org/wiki/Easting_and_northing',
      defaultIterations: 5, minIterations: 1, maxIterations: 8,
      iterLabel: i => fmtMetres(enRes(i)),
      encode: (lat, lon, it) => {
        const key = localScheme(lat, lon);
        const s = SCHEMES[key];
        const code = s.encode(lat, lon, key === 'bng' ? Math.min(it, 7) : it);
        return key === 'utm' || key === 'mga' ? code : `${s.name} ${code}`;
      },
      decode: str => {
        const s = String(str).replace(/^(NZTM2000|OS Grid Ref|MGA2020|Local Grid)\s+/i, '');
        return SCHEMES.nztm.decode(s) || SCHEMES.bng.decode(s) ||
               SCHEMES.mga.decode(s) || SCHEMES.utm.decode(s);
      },
      cellMetres: (it, lat, lon) => {
        const key = localScheme(lat, lon === undefined ? 0 : lon);
        return SCHEMES[key].cellMetres(Math.min(it, SCHEMES[key].maxIterations), lat);
      }
    }
  };

  // ── Card-facing API ───────────────────────────────────────

  function encode(schemeKey, lat, lon, iterations) {
    const s = SCHEMES[schemeKey];
    if (!s || lat === undefined) return '';
    try { return s.encode(lat, lon, iterations) || ''; }
    catch (e) { console.warn('[gis-grids] encode failed:', schemeKey, e); return ''; }
  }

  function decode(schemeKey, str) {
    const s = SCHEMES[schemeKey];
    if (!s || !str) return null;
    try {
      const r = s.decode(str);
      if (r && isFinite(r[0]) && isFinite(r[1]) &&
          Math.abs(r[0]) <= 90 && Math.abs(r[1]) <= 180) return r;
      return null;
    } catch (e) { return null; }
  }

  /**
   * True geographic cell for a scheme at a given iteration, as a closed
   * ring of [lat,lon] corners (NW→NE→SE→SW→NW). Derived from the cell's
   * actual size and the encoded cell's center, so it matches the scheme's
   * real footprint rather than any uniform grid subdivision. Returns null
   * if the point isn't representable in that scheme.
   */
  function cellCorners(schemeKey, lat, lon, iterations) {
    const s = SCHEMES[schemeKey];
    if (!s) return null;
    const code = encode(schemeKey, lat, lon, iterations);
    if (!code || /outside|—/.test(code)) return null;
    const center = decode(schemeKey, code);
    if (!center) return null;
    const dims = s.cellMetres(iterations, center[0], center[1]); // {w,h} metres
    const halfLat = (dims.h / 2) / 111319.9;
    const cosLat = Math.cos(center[0] * D2R) || 1e-6;
    const halfLon = (dims.w / 2) / (111319.9 * cosLat);
    const n = center[0] + halfLat, sLat = center[0] - halfLat;
    const w = center[1] - halfLon, e = center[1] + halfLon;
    return [[n, w], [n, e], [sLat, e], [sLat, w], [n, w]];
  }

  function precisionText(schemeKey, iterations, coord) {
    const s = SCHEMES[schemeKey];
    if (!s) return '';
    const lat = coord ? coord.lat : 0, lon = coord ? coord.lon : 0;
    const d = s.cellMetres(iterations, lat, lon);
    const f = m => {
      if (m >= 1000) return (m / 1000).toFixed(1) + ' km';
      if (m >= 1) return m.toFixed(1) + ' m';
      if (m >= 0.001) return (m * 1000).toFixed(1) + ' mm';
      return (m * 1e6).toFixed(1) + ' µm';
    };
    return `${f(d.h)} × ${f(d.w)}`;
  }

  /**
   * Resolution-comparison info modal. options.compareLine lets the
   * caller (card-renderer) append the active Geosonify card's cell
   * size for direct comparison.
   */
  // Per-scheme descriptive note for the popup header.
  const SCHEME_NOTES = {
    pluscode: 'Open Location Code: base-20 and hierarchical — every 2 digits is a 20×20 refinement, the same principle as geosonify grids.',
    mgrs: 'NATO grid. The letters name a 100 km square; each digit pair adds 10× precision per axis. Standard stops at 1 m.',
    geohash: 'Hierarchical base-32 over interleaved lat/lon bits. Cells are rectangles ~2:1 at most lengths.',
    utm: 'Plain easting/northing in metres within a 6° zone. The stepper changes rounding.',
    nztm: 'EPSG:2193 — the standard NZ projection (Topo50 maps, LINZ data). The stepper changes rounding.',
    bng: 'OS National Grid. Letters name a 100 km square; figures refine 10× per pair — hierarchical, like a geosonify code in disguise. Datum shift here is Helmert (±~3 m vs OSTN15).',
    mga: 'GDA2020 / UTM for Australia. The stepper changes rounding.',
    localgrid: 'Automatically shows the national grid for wherever the pin is: NZTM in NZ, OS grid in Britain, MGA in Australia, UTM elsewhere.'
  };

  // Which schemes enumerate a finite, countable set of cells (so a
  // "1 of N locations" coverage figure is meaningful). Continuous
  // easting/northing schemes are just rounded coordinates — no count.
  const ENUMERABLE = { pluscode: true, geohash: true, mgrs: true, bng: true };

  function fmtMetricFull(m) {
    if (m >= 1000) return (m / 1000).toFixed(m >= 10000 ? 0 : 2) + ' km';
    if (m >= 1) return m.toFixed(2) + ' m';
    if (m >= 0.01) return (m * 100).toFixed(1) + ' cm';
    if (m >= 0.001) return (m * 1000).toFixed(1) + ' mm';
    return (m * 1e6).toFixed(1) + ' µm';
  }

  /**
   * THE shared resolution popup, used by both GIS cards and geosonify
   * grid cards so every ℹ️ looks and behaves identically.
   *
   * data = {
   *   title,            // e.g. "Plus Code" or "Alphanumeric"
   *   note,             // one-line description under the title
   *   levels: [ { label, code, dims, here } ],   // the ladder rows
   *   detail: {         // the current level, expandable section
   *     corners: [[lat,lon] ×4],   // NW,NE,SE,SW  (optional)
   *     widthM, heightM,           // cell dimensions in metres
   *     centroid: [lat,lon],
   *     errorM,                    // pin → centroid distance (optional)
   *     coverage: <number|null>,   // total cells, or null to hide
   *     coverageLabel              // e.g. "9 iterations" / "11 digits"
   *   }
   * }
   */
  // Exact count of globally-distinct cells at a given level, for schemes
  // that enumerate cleanly. Returns null where a clean global count isn't
  // meaningful (MGRS zones, BNG letters, continuous E/N).
  function cellCount(schemeKey, iterations) {
    if (schemeKey === 'pluscode') {
      // OLC: pair digits subdivide 20×20; grid digits (11th+) subdivide 4×5.
      const len = OLC_LENGTHS[Math.min(10, Math.max(1, iterations)) - 1];
      const pairs = Math.min(len, 10) / 2;          // number of 20×20 steps
      let cells = Math.pow(20 * 20, pairs);
      if (len > 10) cells *= Math.pow(4 * 5, len - 10);
      return cells;
    }
    if (schemeKey === 'geohash') {
      return Math.pow(2, iterations * 5);           // 5 bits per char
    }
    return null;
  }

  function renderResolutionPopup(data) {
    const fmtBigNum = n => {
      if (!isFinite(n)) return '—';
      // Beyond safe-integer range the digit-grouping below is unreliable;
      // fall back to a compact "≈ N.N × 10ⁿ" form.
      if (n > Number.MAX_SAFE_INTEGER) {
        const exp = Math.floor(Math.log10(n));
        const mant = (n / Math.pow(10, exp)).toFixed(1);
        return `≈ ${mant} × 10^${exp}`;
      }
      const names = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion'];
      const parts = []; let rem = Math.round(n), idx = 0;
      while (rem > 0 && idx < names.length) {
        const chunk = rem % 1000; rem = Math.floor(rem / 1000);
        if (chunk > 0) parts.unshift(chunk.toLocaleString() + (names[idx] ? ' ' + names[idx] : ''));
        idx++;
      }
      return parts.join(' ') || '0';
    };

    const ladderRows = data.levels.map(l => `
      <tr style="${l.here ? 'background:rgba(0,188,212,0.18);' : ''}">
        <td style="padding:5px 8px;color:${l.here ? '#4fc3f7' : '#aaa'};white-space:nowrap;">${l.label}</td>
        <td style="padding:5px 8px;font-family:'SF Mono',Menlo,monospace;font-size:12px;word-break:break-all;color:${l.here ? '#4fc3f7' : '#ddd'};">${l.code != null ? l.code : ''}</td>
        <td style="padding:5px 8px;color:${l.here ? '#4fc3f7' : '#888'};white-space:nowrap;text-align:right;">${l.dims}</td>
      </tr>`).join('');

    const d = data.detail || {};
    const detailRows = [];
    if (d.corners) {
      detailRows.push(`
        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:#888;margin-bottom:4px;">Cell corners (NW→NE→SE→SW)</div>
          <div style="font-family:'SF Mono',Menlo,monospace;font-size:12px;line-height:1.5;background:#2c2c2e;padding:9px;border-radius:8px;">
            ${d.corners.map(c => `${c[0].toFixed(6)}, ${c[1].toFixed(6)}`).join('<br>')}
          </div>
        </div>`);
    }
    if (d.widthM != null && d.heightM != null) {
      detailRows.push(`
        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:#888;margin-bottom:4px;">Cell dimensions</div>
          <div style="font-size:14px;">
            <span style="color:#4fc3f7;">↔ ${fmtMetricFull(d.widthM)}</span> east-west<br>
            <span style="color:#4fc3f7;">↕ ${fmtMetricFull(d.heightM)}</span> north-south
          </div>
        </div>`);
    }
    if (d.coverage != null) {
      detailRows.push(`
        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:#888;margin-bottom:4px;">Coverage${d.coverageLabel ? ' (' + d.coverageLabel + ')' : ''}</div>
          <div style="font-size:14px;">One of <span style="color:#4fc3f7;">${fmtBigNum(d.coverage)}</span> unique locations</div>
        </div>`);
    }
    if (d.centroid) {
      detailRows.push(`
        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:#888;margin-bottom:4px;">Cell centroid</div>
          <div style="font-family:'SF Mono',Menlo,monospace;font-size:12px;background:#2c2c2e;padding:8px;border-radius:8px;">
            ${d.centroid[0].toFixed(6)}, ${d.centroid[1].toFixed(6)}
          </div>
        </div>`);
    }
    if (d.errorM != null) {
      detailRows.push(`
        <div style="margin-bottom:4px;">
          <div style="font-size:12px;color:#888;margin-bottom:4px;">Error (pin to centroid)</div>
          <div style="font-size:14px;color:#ff9800;">± ${fmtMetricFull(d.errorM)}</div>
        </div>`);
    }

    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;';
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#1c1c1e;border-radius:16px;padding:20px;max-width:92vw;width:440px;max-height:82vh;overflow-y:auto;color:white;';
    dialog.innerHTML = `
      <h3 style="margin:0 0 6px;font-size:18px;color:#00bcd4;">${data.title} — resolution levels</h3>
      ${data.note ? `<div style="font-size:12px;color:#888;margin-bottom:12px;line-height:1.5;">${data.note}</div>` : ''}
      <table style="width:100%;border-collapse:collapse;font-size:13px;background:#2c2c2e;border-radius:8px;overflow:hidden;">
        <tr style="color:#888;font-size:11px;text-align:left;">
          <th style="padding:6px 8px;font-weight:normal;">Level</th><th style="padding:6px 8px;font-weight:normal;">Here</th><th style="padding:6px 8px;font-weight:normal;text-align:right;">Cell size</th>
        </tr>
        ${ladderRows}
      </table>
      ${data.compareLine ? `<div style="margin-top:12px;padding:10px;background:rgba(0,188,212,0.08);border:1px solid rgba(0,188,212,0.25);border-radius:8px;font-size:12px;color:#bbb;">↔ ${data.compareLine}</div>` : ''}
      ${detailRows.length ? `
        <div id="detailToggle" style="margin-top:12px;padding:9px 12px;border:1px solid #3a3a3c;border-radius:8px;font-size:13px;color:#bbb;cursor:pointer;user-select:none;">
          <span id="detailChevron">▸</span> This level in detail
        </div>
        <div id="detailBody" style="display:none;margin-top:10px;">${detailRows.join('')}</div>
      ` : ''}
      <button id="resPopupClose" style="width:100%;margin-top:14px;padding:11px;border-radius:8px;border:none;background:#333;color:white;font-size:15px;cursor:pointer;">Close</button>
    `;
    const toggle = dialog.querySelector('#detailToggle');
    if (toggle) {
      toggle.onclick = () => {
        const body = dialog.querySelector('#detailBody');
        const chev = dialog.querySelector('#detailChevron');
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        chev.textContent = open ? '▸' : '▾';
      };
    }
    dialog.querySelector('#resPopupClose').onclick = () => modal.remove();
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    modal.appendChild(dialog);
    document.body.appendChild(modal);
  }

  // GIS-side adapter: builds the popup data object for a scheme, then
  // hands off to the shared renderer.
  function showInfo(schemeKey, currentIterations, coord, options) {
    options = options || {};
    const s = SCHEMES[schemeKey];
    if (!s || !coord) return;

    const levels = [];
    for (let it = s.minIterations; it <= s.maxIterations; it++) {
      levels.push({
        label: s.iterLabel(it),
        code: encode(schemeKey, coord.lat, coord.lon, it),
        dims: precisionText(schemeKey, it, coord),
        here: it === currentIterations
      });
    }

    // Detail block for the current level
    const corners = cellCorners(schemeKey, coord.lat, coord.lon, currentIterations);
    let detail = null;
    if (corners) {
      const lats = corners.map(c => c[0]), lons = corners.map(c => c[1]);
      const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const cLon = (Math.min(...lons) + Math.max(...lons)) / 2;
      const dims = s.cellMetres(currentIterations, cLat, cLon);
      // pin→centroid distance (simple equirectangular metres; popup is informational)
      const dLat = (cLat - coord.lat) * 111319.9;
      const dLon = (cLon - coord.lon) * 111319.9 * Math.cos(coord.lat * D2R);
      const errorM = Math.sqrt(dLat * dLat + dLon * dLon);
      // corners ring is NW,NE,SE,SW,NW — drop the closing point for display
      detail = {
        corners: corners.slice(0, 4),
        widthM: dims.w, heightM: dims.h,
        centroid: [cLat, cLon],
        errorM,
        coverage: cellCount(schemeKey, currentIterations),
        coverageLabel: s.iterLabel(currentIterations)
      };
    }

    renderResolutionPopup({
      title: s.name,
      note: SCHEME_NOTES[schemeKey] || '',
      levels,
      detail,
      compareLine: options.compareLine || null
    });
  }


  // Card definitions ready for CardRenderer.registerGrid
  function cardDefs() {
    const defs = {};
    for (const [key, s] of Object.entries(SCHEMES)) {
      defs[key] = {
        name: s.name,
        gis: key,                      // marks this as a GIS card
        grid: null,
        defaultIterations: s.defaultIterations,
        minIterations: s.minIterations,
        maxIterations: s.maxIterations,
        link: s.link,
        isEmoji: false
      };
    }
    return defs;
  }

  return {
    SCHEMES, encode, decode, precisionText, cellCorners, showInfo, renderResolutionPopup, cardDefs, localScheme,
    // exposed for tests
    _tm: { NZTM, BNG_TM, utmTM, wgs84ToUTM },
    _datum: { wgs84ToOSGB36, osgb36ToWGS84 },
    _mgrs: { encode: mgrsEncode, decode: mgrsDecode },
    _olc: { encode: olcEncode, decode: olcDecode },
    _geohash: { encode: geohashEncode, decode: geohashDecode },
    _bng: { encode: bngEncode, decode: bngDecode, letters: bngLettersFromEN }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GISGrids;
