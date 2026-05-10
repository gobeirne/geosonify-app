/*
  geosonify-compact-codec.js v1.0
  Shape parameter encoding/decoding for rectangles, circles, and graticules
  
  Handles compact string representations of shape parameters:
  - Raw format: human-readable (e.g., "45deg_100m_50m")
  - Base36 format: variable-length numeric encoding
  - Base64url format: fixed-width binary encoding
  
  Does NOT handle:
  - Coordinate encoding (handled by GeoCodec)
  - Emoji encoding (depends on EMO array, stays in main file)
  - Delta path encoding (complex, stays in main file for now)
  
  Dependencies:
  - GeoMath (for formatLength, parseLength - or provide own)
  
  Exports (via window.CompactCodec):
  - Constants: UNIT_TO_METERS, B64
  - Unit helpers: pickBestUnit, formatLength, parseLength
  - Base36: toBase36, fromBase36, padBase36, encodeLenFieldAuto, decodeLenVar
  - Base64: b64urlEncodeBits, b64urlDecodeToInt, b64urlEncodeBigBits
  - Encoders: encodeRawShape, encodeBase36Shape, encodeBase64urlShape
  - Decoders: tryDecodeBase36Var, tryDecodeBase36Graticule, tryDecodeBase64Graticule
  - Utility: checksumChar
*/

(function(global) {
  'use strict';

  const __COMPACT_CODEC_VER__ = 'v1.0';
  try { console.log('[geosonify] compact-codec ' + __COMPACT_CODEC_VER__ + ' loaded'); } catch(e) {}

  // ============== UNIT CONSTANTS ==============

  const UNIT_TO_METERS = {
    'mm': 0.001,
    'cm': 0.01,
    'm': 1,
    'km': 1000,
    'ft': 0.3048,
    'mi': 1609.344
  };

  // Resolution encoding for Base36 variable format
  const RES_TO_UNIT = { '2': 0.001, '1': 0.01, '0': 0.1, '7': 1, '4': 10, '5': 100, '6': 1000 };
  const UNIT_TO_RES = { 0.001: '2', 0.01: '1', 0.1: '0', 1: '7', 10: '4', 100: '5', 1000: '6' };
  const UNIT_LIST = [0.001, 0.01, 0.1, 1, 10, 100, 1000];

  // ============== UNIT HELPERS ==============

  /**
   * Calculate decimal places from precision value
   */
  function decimalsFromPrecision(p) {
    if (!Number.isFinite(p) || p <= 0) return 0;
    if (p >= 1) return 0;
    const d = Math.round(Math.log10(1 / p));
    return Math.max(0, Math.min(6, d));
  }

  /**
   * Pick best display unit for a length in meters
   */
  function pickBestUnit(meters, precision) {
    precision = precision || 1;
    if (meters < 0.01) return 'mm';
    if (meters < 1) return 'cm';
    if (meters < 1000) return 'm';
    if (meters < 10000 && precision >= 1000) return 'km';
    return 'm';
  }

  /**
   * Format a length in meters to human-readable string
   */
  function formatLength(meters, rounded, precision) {
    precision = precision || 1;
    const unit = pickBestUnit(meters, precision);
    const value = meters / UNIT_TO_METERS[unit];
    const decimals = rounded ? 0 : decimalsFromPrecision(precision * UNIT_TO_METERS[unit]);
    return rounded ? `${Math.round(value)}${unit}` : `${value.toFixed(decimals)}${unit}`;
  }

  /**
   * Parse a length string to meters
   */
  function parseLength(str) {
    const match = String(str).match(/^([\d.]+)(mm|cm|m|km|ft|mi)?$/i);
    if (!match) return parseFloat(str);
    const value = parseFloat(match[1]);
    const unit = match[2] ? match[2].toLowerCase() : 'm';
    return value * UNIT_TO_METERS[unit];
  }

  // ============== BASE36 HELPERS ==============

  function toBase36(n) {
    return n.toString(36).toUpperCase();
  }

  function fromBase36(s) {
    return parseInt(s, 36);
  }

  function padBase36(s, len) {
    return s.length < len ? '0'.repeat(len - s.length) + s : s;
  }

  function nearInt(x) {
    return Math.abs(x - Math.round(x)) < 1e-9;
  }

  /**
   * Encode a length value to compact Base36 format with auto unit selection
   */
  function encodeLenFieldAuto(value) {
    const cands = [];
    for (const unit of UNIT_LIST) {
      const q = value / unit;
      if (!Number.isFinite(q) || !nearInt(q)) continue;
      const count = Math.round(q);
      let digits = 2;
      while (count >= Math.pow(36, digits) && digits < 5) digits++;
      const spill = '.'.repeat(Math.max(0, digits - 2));
      const num = padBase36(toBase36(count), digits);
      const prefix = (unit === 1) ? '' : '!' + UNIT_TO_RES[unit];
      const str = prefix + spill + num;
      cands.push({ str, len: str.length, unit, digits });
    }
    if (cands.length === 0) {
      // Fallback to mm
      const unit = 0.001;
      const count = Math.round(value / unit);
      let digits = 2;
      while (count >= Math.pow(36, digits) && digits < 5) digits++;
      const spill = '.'.repeat(Math.max(0, digits - 2));
      const num = padBase36(toBase36(count), digits);
      const str = '!' + UNIT_TO_RES[unit] + spill + num;
      return str;
    }
    cands.sort((a, b) => a.len - b.len || a.str.split('.').length - b.str.split('.').length || a.unit - b.unit);
    return cands[0].str;
  }

  /**
   * Decode a variable-length Base36 field
   * Returns { value, next } where next is the index after the field
   */
  function decodeLenVar(str, idx) {
    let unit = 1, i = idx;
    if (str[i] === '!') {
      const resChar = str[i + 1];
      unit = RES_TO_UNIT[resChar] || 1;
      i += 2;
    }
    let spillCount = 0;
    while (str[i] === '.') { spillCount++; i++; }
    const digits = 2 + spillCount;
    const numStr = str.slice(i, i + digits);
    if (numStr.length < digits) throw new Error('Truncated Base36 length field');
    const count = fromBase36(numStr);
    const value = count * unit;
    return { value, next: i + digits };
  }

  // ============== BASE64URL HELPERS ==============

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  /**
   * Encode an integer to Base64url with specified bit length
   */
  function b64urlEncodeBits(val, bitLen) {
    let out = '', bits = val, totalBits = bitLen;
    const pad = (6 - (totalBits % 6)) % 6;
    bits <<= pad;
    totalBits += pad;
    for (let i = totalBits - 6; i >= 0; i -= 6) {
      out += B64[(bits >> i) & 63];
    }
    return out;
  }

  /**
   * Decode a Base64url string to integer
   */
  function b64urlDecodeToInt(s) {
    let val = 0;
    for (const ch of s) {
      val = (val << 6) | B64.indexOf(ch);
    }
    return val;
  }

  /**
   * Encode a BigInt to Base64url with specified bit length
   */
  function b64urlEncodeBigBits(val, bitLen) {
    let out = '';
    const pad = (6 - (bitLen % 6)) % 6;
    let bits = val << BigInt(pad);
    const totalBits = bitLen + pad;
    for (let i = totalBits - 6; i >= 0; i -= 6) {
      out += B64[Number((bits >> BigInt(i)) & 63n)];
    }
    return out;
  }

  // ============== CHECKSUM ==============

  /**
   * Generate a single checksum character for a payload
   */
  function checksumChar(payload) {
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let sum = 0;
    for (let i = 0; i < payload.length; i++) {
      sum = (sum + payload.charCodeAt(i)) % 36;
    }
    return alphabet[sum];
  }

  // ============== ANGULAR GRATICULE HELPERS ==============

  /**
   * Normalize iOS smart quotes to ASCII apostrophe
   */
  function normalizeQuotes(str) {
    return str.replace(/[\u2018\u2019\u201C\u201D\u0060\u00B4]/g, "'");
  }

  /**
   * Check if a value in degrees is a clean integer number of arcminutes.
   * Uses generous tolerance to handle floating-point rounding from decimal degree input.
   * @param {number} deg - Value in degrees
   * @returns {number|null} Integer arcminutes, or null if not clean
   */
  function cleanArcminutes(deg) {
    const arcmin = deg * 60;
    if (Math.abs(arcmin - Math.round(arcmin)) < 0.01) {
      return Math.round(arcmin);
    }
    return null;
  }

  /**
   * Check if a value in degrees is a clean integer number of degrees
   * @param {number} deg - Value in degrees
   * @returns {number|null} Integer degrees, or null if not clean
   */
  function cleanDegrees(deg) {
    if (Math.abs(deg - Math.round(deg)) < 0.001 && Math.round(deg) > 0) {
      return Math.round(deg);
    }
    return null;
  }

  /**
   * Try to encode a graticule span as angular (degrees or arcminutes).
   * Prefers 'deg' for whole degrees (more readable), arcminutes for sub-degree values.
   * @param {number} deg - Span in degrees
   * @returns {string|null} e.g. "7deg", "20'", or null
   */
  function formatAngularSpan(deg) {
    const wholeDeg = cleanDegrees(deg);
    const wholeMin = cleanArcminutes(deg);
    
    // Prefer deg notation for whole degrees (e.g. "7deg" not "420'")
    if (wholeDeg !== null) return `${wholeDeg}deg`;
    // Sub-degree: use arcminutes if clean
    if (wholeMin !== null) return `${wholeMin}'`;
    return null;
  }

  /**
   * Parse an angular span string to degrees.
   * Accepts: "7deg", "20'", "20min"
   * @param {string} str - Angular span string
   * @returns {number|null} Degrees, or null if not an angular format
   */
  function parseAngularSpan(str) {
    str = normalizeQuotes(str).trim();
    // Degrees: "7deg" or "7.5deg"
    const degMatch = str.match(/^([\d.]+)deg$/i);
    if (degMatch) return parseFloat(degMatch[1]);
    // Arcminutes: "20'" or "20min"
    const minMatch = str.match(/^([\d.]+)(?:'|min)$/i);
    if (minMatch) return parseFloat(minMatch[1]) / 60;
    return null;
  }

  // ============== SHAPE ENCODERS ==============

  /**
   * Encode a circle to raw format
   * @param {Object} sol - Solution with { centroid: [lat, lon], radius: number }
   * @param {Object} opts - { rounded: boolean, precision: number }
   */
  function encodeRawCircle(sol, opts) {
    opts = opts || {};
    const rounded = opts.rounded !== false;
    const precision = opts.precision || 1;
    const radius = rounded ? Math.round(sol.radius) : sol.radius.toFixed(decimalsFromPrecision(precision));
    return `${sol.centroid[0].toFixed(6)},${sol.centroid[1].toFixed(6)}~${radius}m`;
  }

  /**
   * Encode a circle to Base36 format
   */
  function encodeBase36Circle(sol) {
    const r = Math.round(sol.radius);
    let count = Math.max(0, r | 0);
    let digits = 2;
    while (count >= Math.pow(36, digits) && digits < 5) digits++;
    const spill = '.'.repeat(Math.max(0, digits - 2));
    const num = count.toString(36).toUpperCase().padStart(digits, '0');
    return `${sol.centroid[0].toFixed(6)},${sol.centroid[1].toFixed(6)}~${spill}${num}`;
  }

  /**
   * Encode a circle to Base64url format
   */
  function encodeBase64Circle(sol) {
    const r = Math.round(sol.radius);
    if (r > 1023) return 'ERR: radius exceeds 1023m';
    const code = B64[r >> 4] + B64[r & 15];
    return `${sol.centroid[0].toFixed(6)},${sol.centroid[1].toFixed(6)}~${code}`;
  }

  /**
   * Encode a rectangle shape to raw format
   * @param {Object} sol - Solution with { centroid, thetaDeg, L, S }
   * @param {Object} opts - { rounded, precision, ultraAngle }
   */
  function encodeRawRect(sol, opts) {
    opts = opts || {};
    const rounded = opts.rounded !== false;
    const ultraAngle = opts.ultraAngle || false;
    const precision = opts.precision || 1;
    const degPrec = rounded ? 0 : (ultraAngle ? 5 : 2);

    const a = rounded ? Math.round(sol.thetaDeg) % 360 : Number(sol.thetaDeg).toFixed(degPrec);
    const L = formatLength(sol.L, rounded, precision);
    const S = formatLength(sol.S, rounded, precision);

    return `${sol.centroid[0].toFixed(6)},${sol.centroid[1].toFixed(6)}~${a}deg_${L}_${S}`;
  }

  /**
   * Encode a graticule to raw format.
   * Prefers angular encoding (degrees/arcminutes) when the graticule has
   * a latSpanDeg field (angular mode) or when both spans are clean angular values.
   * Falls back to metric format (lonDeg + nsMeters) otherwise.
   */
  function encodeRawGraticule(sol, opts) {
    opts = opts || {};
    const rounded = opts.rounded !== false;
    const precision = opts.precision || 1;
    const centroidStr = `${sol.centroid[0].toFixed(6)},${sol.centroid[1].toFixed(6)}`;

    // Angular mode: if latSpanDeg is present, always use angular encoding
    if (sol.latSpanDeg != null) {
      const lonStr = formatAngularSpan(sol.lonSpanDeg);
      const latStr = formatAngularSpan(sol.latSpanDeg);
      if (lonStr && latStr) {
        return `${centroidStr}~~${lonStr}_${latStr}`;
      }
      // Fractional angular — use decimal degrees
      const lonDeg = sol.lonSpanDeg.toFixed(2);
      const latDeg = sol.latSpanDeg.toFixed(2);
      return `${centroidStr}~~${lonDeg}deg_${latDeg}deg`;
    }

    // Metric mode: check if nsMeters corresponds to clean angular value
    // Derive latSpanDeg from the metric NS extent for detection
    // latSpan ≈ nsMeters / 111320 (meters per degree of latitude, approximate)
    // But for exact detection, compute from centroid
    const approxLatSpan = sol.nsMeters / 111320;
    const lonAngular = formatAngularSpan(sol.lonSpanDeg);
    const latAngular = formatAngularSpan(approxLatSpan);
    
    if (lonAngular && latAngular) {
      // Both spans are clean angular values — use angular format
      // But verify the approximation: reconstruct and check error
      const derivedLatSpan = parseAngularSpan(latAngular);
      const derivedMeters = derivedLatSpan * 111320;
      const error = Math.abs(derivedMeters - sol.nsMeters);
      // Allow ~100m tolerance (covers latitude-dependent variation of ~1%)
      if (error < 200) {
        return `${centroidStr}~~${lonAngular}_${latAngular}`;
      }
    }

    // Fallback: metric format
    const lonDeg = sol.lonSpanDeg.toFixed(2);
    const ns = formatLength(sol.nsMeters, rounded, precision);
    return `${centroidStr}~~${lonDeg}deg_${ns}`;
  }

  /**
   * Encode a path/polygon to raw format
   */
  function encodeRawPath(sol) {
    return sol.points.map(pt => `${pt[0].toFixed(6)},${pt[1].toFixed(6)}`).join('~');
  }

  /**
   * Encode any shape to raw format
   */
  function encodeRawShape(sol, opts) {
    if (sol.type === 'circle') return encodeRawCircle(sol, opts);
    if (sol.type === 'graticule') return encodeRawGraticule(sol, opts);
    if (sol.type === 'path' || sol.type === 'polygon') return encodeRawPath(sol);
    return encodeRawRect(sol, opts);
  }

  /**
   * Encode a rectangle to Base36 format
   */
  function encodeBase36Rect(sol, opts) {
    opts = opts || {};
    const rounded = opts.rounded !== false;

    const aInt = Math.round(sol.thetaDeg) % 360;
    const A = padBase36(toBase36(aInt), 2);

    if (rounded) {
      const Lm = Math.round(sol.L);
      const Sm = Math.round(sol.S);

      function encodeMetersFixed(n) {
        let count = Math.max(0, n | 0);
        if (count < Math.pow(36, 2)) return padBase36(toBase36(count), 2);
        let digits = 3;
        while (count >= Math.pow(36, digits) && digits < 5) digits++;
        return '~'.repeat(digits - 2) + padBase36(toBase36(count), digits);
      }

      const Lfield = encodeMetersFixed(Lm);
      const Sfield = encodeMetersFixed(Sm);
      return `${sol.centroid[0].toFixed(6)},${sol.centroid[1].toFixed(6)}~${A}${Lfield}${Sfield}`;
    }

    const Lfield = encodeLenFieldAuto(sol.L);
    const Sfield = encodeLenFieldAuto(sol.S);
    return `${sol.centroid[0].toFixed(6)},${sol.centroid[1].toFixed(6)}~${A}${Lfield}${Sfield}`;
  }

  /**
   * Encode a graticule to Base36 format
   */
  function encodeBase36Graticule(sol) {
    const lonUnits = Math.round(sol.lonSpanDeg * 1000); // 0.001° resolution
    const lonField = encodeLenFieldAuto(lonUnits);
    const nsField = encodeLenFieldAuto(sol.nsMeters);
    return `${sol.centroid[0].toFixed(6)},${sol.centroid[1].toFixed(6)}~~${lonField}${nsField}`;
  }

  /**
   * Encode any shape to Base36 format
   */
  function encodeBase36Shape(sol, opts) {
    if (sol.type === 'circle') return encodeBase36Circle(sol);
    if (sol.type === 'graticule') return encodeBase36Graticule(sol);
    if (sol.type === 'path' || sol.type === 'polygon') return encodeRawPath(sol); // Fall back to raw
    return encodeBase36Rect(sol, opts);
  }

  /**
   * Encode a rectangle to Base64url format
   */
  function encodeBase64urlRect(sol) {
    const a = Math.round(sol.thetaDeg) % 360;
    const L = Math.round(sol.L);
    const S = Math.round(sol.S);
    if (L > 1023 || S > 1023) return 'ERR: lengths exceed 1023m';
    const packed = (a << 20) | (L << 10) | S;
    const code = b64urlEncodeBits(packed, 29);
    return `${sol.centroid[0].toFixed(6)},${sol.centroid[1].toFixed(6)}~${code}`;
  }

  /**
   * Encode a graticule to Base64url format
   */
  function encodeBase64urlGraticule(sol) {
    const lonUnits = Math.round(sol.lonSpanDeg * 100); // 0.01° resolution
    const nsMeters = Math.round(sol.nsMeters);
    if (lonUnits > 36000) return 'ERR: lon span exceeds 360°';
    if (nsMeters > 33554431) return 'ERR: NS distance exceeds ~33554km';
    const packed = (BigInt(lonUnits) << 25n) | BigInt(nsMeters);
    const code = b64urlEncodeBigBits(packed, 41);
    return `${sol.centroid[0].toFixed(6)},${sol.centroid[1].toFixed(6)}~~${code}`;
  }

  /**
   * Encode any shape to Base64url format
   */
  function encodeBase64urlShape(sol, opts) {
    if (sol.type === 'circle') return encodeBase64Circle(sol);
    if (sol.type === 'graticule') return encodeBase64urlGraticule(sol);
    if (sol.type === 'path' || sol.type === 'polygon') return encodeRawPath(sol); // Fall back to raw
    return encodeBase64urlRect(sol, opts);
  }

  // ============== SHAPE DECODERS ==============

  /**
   * Try to decode a Base36 variable-length rectangle/circle payload
   * @param {string} payload - The shape suffix (after the ~)
   * @returns {{ type: 'rect'|'circle', angle?, L?, S?, radius? }}
   */
  function tryDecodeBase36Var(payload) {
    if (!/^[0-9A-Z.!~]+$/i.test(payload)) throw new Error('Not base36-var payload');
    if (payload.length < 2) throw new Error('Too short for base36-var');

    // Circle check - starts with . (spill) or 2 alphanumeric digits for small radius
    if (!payload.match(/^[0-9A-Z]{2}/i)) {
      let i = 0;
      let spillCount = 0;
      while (payload[i] === '.') { spillCount++; i++; }
      const digits = 2 + spillCount;
      const numStr = payload.slice(i, i + digits);
      const radius = fromBase36(numStr);
      return { type: 'circle', radius };
    }

    if (payload.length < 6) throw new Error('Too short for rectangle');
    const angle = fromBase36(payload.slice(0, 2));
    let idx = 2;
    const Ld = decodeLenVar(payload, idx);
    idx = Ld.next;
    const Sd = decodeLenVar(payload, idx);
    idx = Sd.next;
    if (idx !== payload.length && idx + 1 !== payload.length) throw new Error('Extra data');
    return { type: 'rect', angle, L: Ld.value, S: Sd.value };
  }

  /**
   * Try to decode a Base36 graticule payload
   */
  function tryDecodeBase36Graticule(payload) {
    if (!/^[0-9A-Z.!]+$/i.test(payload)) throw new Error('Not base36 graticule payload');
    if (payload.length < 4) throw new Error('Too short for graticule');

    let idx = 0;
    const lonDec = decodeLenVar(payload, idx);
    idx = lonDec.next;
    const nsDec = decodeLenVar(payload, idx);

    const lonSpanDeg = lonDec.value / 1000;
    const nsMeters = nsDec.value;

    return { type: 'graticule', lonSpanDeg, nsMeters };
  }

  /**
   * Try to decode a Base64url graticule payload
   */
  function tryDecodeBase64Graticule(payload) {
    if (payload.length !== 7) throw new Error('Base64 graticule must be 7 chars');
    const val = b64urlDecodeToInt(payload);
    const shiftPad = (6 - (41 % 6)) % 6;
    const raw = val >> shiftPad;
    const nsMeters = raw & 0x1FFFFFF; // 25 bits
    const lonUnits = (raw >> 25) & 0xFFFF; // 16 bits
    const lonSpanDeg = lonUnits / 100;
    return { type: 'graticule', lonSpanDeg, nsMeters };
  }

  /**
   * Try to decode an angular graticule payload.
   * Accepts formats like: "7deg_4deg", "20'_15'", "20min_15min", mixed "7deg_240'"
   * @param {string} payload - The graticule payload (after ~~)
   * @returns {{ type: 'graticule', lonSpanDeg, latSpanDeg, angular: true } | null}
   */
  function tryDecodeAngularGraticule(payload) {
    // Normalize iOS smart quotes
    payload = normalizeQuotes(payload);
    
    const fields = payload.split('_');
    if (fields.length !== 2) return null;
    
    const lonDeg = parseAngularSpan(fields[0]);
    const latDeg = parseAngularSpan(fields[1]);
    
    if (lonDeg === null || latDeg === null) return null;
    if (lonDeg <= 0 || latDeg <= 0) return null;
    if (lonDeg > 360 || latDeg > 180) return null;
    
    return { type: 'graticule', lonSpanDeg: lonDeg, latSpanDeg: latDeg, angular: true };
  }

  /**
   * Try to decode a Base64url rectangle payload
   */
  function tryDecodeBase64urlRect(payload) {
    if (payload.length !== 5) throw new Error('Base64url rect must be 5 chars');
    const val = b64urlDecodeToInt(payload);
    // Unpack: 29 bits -> angle (9 bits) | L (10 bits) | S (10 bits)
    const S = val & 0x3FF;
    const L = (val >> 10) & 0x3FF;
    const angle = (val >> 20) & 0x1FF;
    return { type: 'rect', angle, L, S };
  }

  /**
   * Try to decode a Base64url circle payload
   */
  function tryDecodeBase64Circle(payload) {
    if (payload.length !== 2) throw new Error('Base64 circle must be 2 chars');
    const d0 = B64.indexOf(payload[0]);
    const d1 = B64.indexOf(payload[1]);
    const radius = (d0 << 4) | d1;
    return { type: 'circle', radius };
  }

  // ============== EXPORT ==============

  global.CompactCodec = {
    // Version
    version: __COMPACT_CODEC_VER__,

    // Constants
    UNIT_TO_METERS,
    RES_TO_UNIT,
    UNIT_TO_RES,
    UNIT_LIST,
    B64,

    // Unit helpers
    decimalsFromPrecision,
    pickBestUnit,
    formatLength,
    parseLength,

    // Angular graticule helpers
    normalizeQuotes,
    cleanArcminutes,
    cleanDegrees,
    formatAngularSpan,
    parseAngularSpan,
    tryDecodeAngularGraticule,

    // Base36 helpers
    toBase36,
    fromBase36,
    padBase36,
    nearInt,
    encodeLenFieldAuto,
    decodeLenVar,

    // Base64url helpers
    b64urlEncodeBits,
    b64urlDecodeToInt,
    b64urlEncodeBigBits,

    // Checksum
    checksumChar,

    // Encoders
    encodeRawCircle,
    encodeBase36Circle,
    encodeBase64Circle,
    encodeRawRect,
    encodeRawGraticule,
    encodeRawPath,
    encodeRawShape,
    encodeBase36Rect,
    encodeBase36Graticule,
    encodeBase36Shape,
    encodeBase64urlRect,
    encodeBase64urlGraticule,
    encodeBase64urlShape,

    // Decoders
    tryDecodeBase36Var,
    tryDecodeBase36Graticule,
    tryDecodeBase64Graticule,
    tryDecodeBase64urlRect,
    tryDecodeBase64Circle
  };

})(typeof window !== 'undefined' ? window : this);
