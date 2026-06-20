/*
  geosonify-healpix-path.js v1.0
  Tier-3 path / polygon layer for HEALPix cards.

  Turns an array of [lat,lon] points into ONE delta-compressed wire string
  (and back), reusing:
    - HealpixGrids (single-point encode/decode + serializers)
    - DeltaGear.encodeGearPath / decodeGearPath  (forced explicit-gear; NEVER encodeBest)

  Wire design (settled, verified against live production URLs):
    • hphex : each point → folded public hex (dotless, face = leading 0–B nibble).
              Delta the codes DIRECTLY. No fold needed. Order is uniform → one '@k'
              suffix on the whole path string.
    • hp64  : each point → ser64 (face = leading token). Delta DIRECTLY. One '@k'.
    • hpquad: each point → 'f{dec}.{base4}'. FOLD to wire = faceChar + base4digits
              (drop 'f', drop '.'; face 0..11 → '0123456789AB'). Delta the folded
              strings. Quaternary is self-describing (digit count = order) so the
              folded code's length-minus-1 IS the order; no '@k' needed. Unfold on
              decode for display / point recovery.

  Why direct delta is safe: the gear marker is '~' (encoder-inserted separator)
  followed by a segment beginning with 'd'. A literal 'd'/'D' INSIDE a code is never
  preceded by that separator, so it is never read as a gear. Only a code containing
  the substring '~d' could break it, and HEALPix codes never contain '~'.

  Dependencies: geosonify-healpix.js (HealpixGrids), delta-gear.js (DeltaGear)
  Exports (window.HealpixPath): encodePath, decodePath, foldQuad, unfoldQuad,
                                pointsToWire, wireToPoints
*/

(function (global) {
  'use strict';

  function _resolve(globalName, modPath) {
    if (global[globalName]) return global[globalName];
    if (typeof require !== 'undefined') {
      try {
        const m = require(modPath);
        // delta-gear assigns to global (window) rather than module.exports;
        // after require, the global should be populated.
        return global[globalName] || m;
      } catch (e) { return null; }
    }
    return null;
  }
  const HP = _resolve('HealpixGrids', './geosonify-healpix.js');
  const DG = _resolve('DeltaGear',    './delta-gear.js');
  if (!HP || !DG) { try { console.warn('[healpix-path] missing HealpixGrids or DeltaGear'); } catch (e) {} }

  const FACE12 = '0123456789AB';

  // ── quaternary fold/unfold ────────────────────────────────
  // 'f3.113311' <-> '3113311'   (faceChar + base-4 digits)
  // Returns null on malformed input.
  function foldQuad(quadStr) {
    const m = String(quadStr).trim().match(/^f(\d{1,2})\.?([0-3]*)$/);
    if (!m) return null;
    const f = parseInt(m[1], 10);
    if (!(f >= 0 && f <= 11)) return null;
    return FACE12[f] + (m[2] || '');
  }
  function unfoldQuad(wireStr) {
    const s = String(wireStr).trim();
    if (!s) return null;
    const f = FACE12.indexOf(s[0].toUpperCase());
    if (f < 0) return null;
    const digits = s.slice(1);
    if (!/^[0-3]*$/.test(digits)) return null;
    return 'f' + f + '.' + digits;
  }

  // ── per-card point <-> wire-code ──────────────────────────
  // wire code = the string we delta. Self-contained, collision-free.
  function pointToWire(schemeKey, lat, lon, order, opt) {
    if (schemeKey === 'hpquad') {
      const q = HP.encode('hpquad', lat, lon, order, opt || {}); // 'f3.113…'
      return foldQuad(q);
    }
    // hphex/hp64: folded public form (NO separateFace) → self-contained.
    // Pass opt WITHOUT separateFace so the face folds in (hex) / leads (b64).
    const o = Object.assign({}, opt || {});
    delete o.separateFace;
    return HP.encode(schemeKey, lat, lon, order, o);
  }
  function wireToPoint(schemeKey, wire, order, opt) {
    if (schemeKey === 'hpquad') {
      const q = unfoldQuad(wire);
      if (!q) return null;
      return HP.decode('hpquad', q, order, opt || {});
    }
    const o = Object.assign({}, opt || {});
    delete o.separateFace;
    return HP.decode(schemeKey, wire, order, o);
  }

  // ── points -> array of wire codes (and back) ──────────────
  function pointsToWire(schemeKey, points, order, opt) {
    return points.map(p => pointToWire(schemeKey, p[0], p[1], order, opt));
  }
  function wireToPoints(schemeKey, codes, order, opt) {
    return codes.map(c => wireToPoint(schemeKey, c, order, opt));
  }

  // ── full path encode/decode (delta-compressed) ────────────
  // Returns a single delta-compressed string. No order suffix is carried:
  // paths decode using the active card's order (passed to decodePath), exactly
  // like every other Geosonify code. Quaternary is self-describing anyway; for
  // hphex/hp64 at odd orders, a cold decode without the card order may resolve
  // to a neighbouring sub-cell (tens of cm at path precision) — acceptable, and
  // a '@k' can be reintroduced later if exact cold-open ever matters.
  function encodePath(schemeKey, points, order, opt) {
    if (!points || !points.length) return '';
    const codes = pointsToWire(schemeKey, points, order, opt);
    if (codes.some(c => c == null)) return null;
    return DG.encodeGearPath(codes);              // forced explicit-gear, no suffix
  }

  function decodePath(schemeKey, wire, orderHint, opt) {
    if (!wire) return [];
    let str = String(wire).trim();
    let order = orderHint;
    // hpquad: the FIRST code may arrive in display form 'f{dec}.{base4}' (from
    // getActiveEncoding) while the delta payload is folded. Fold the first code
    // so the whole gear string is folded-consistent before decoding.
    if (schemeKey === 'hpquad') {
      const tIdx = str.indexOf('~');
      const head = tIdx < 0 ? str : str.slice(0, tIdx);
      const tail = tIdx < 0 ? ''  : str.slice(tIdx);
      if (head[0] === 'f' && head.indexOf('.') >= 0) {
        const folded = foldQuad(head);
        if (folded) str = folded + tail;
      }
    }
    const codes = DG.decodeGearPath(str);
    if (schemeKey === 'hpquad' && order == null && codes.length) {
      // self-describing: folded code length minus 1 (the face char) = order
      order = Math.max(0, codes[0].length - 1);
    }
    return wireToPoints(schemeKey, codes, order, opt);
  }

  const api = {
    version: 'v1.0',
    foldQuad, unfoldQuad,
    pointToWire, wireToPoint,
    pointsToWire, wireToPoints,
    encodePath, decodePath
  };

  global.HealpixPath = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof window !== 'undefined' ? window : this);
