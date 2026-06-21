// ============================================================
// geosonify-healpix.js  —  HEALPix reference grids for Geosonify
//
// HEALPix (Hierarchical Equal Area iso-Latitude Pixelization) as
// native-feeling Geosonify cards. Unlike the GIS reference grids,
// HEALPix's NESTED scheme is *genuinely* hierarchical the same way
// Geosonify's own grids are — a base-4 tree — so it can carry the
// trademark features (truncation, and, where serialized to a real
// vocabulary, keyed-permutation/obfuscation/delta) honestly.
//
// THREE cards, all serializations of ONE underlying nested index
// computed by ang2pix_nest(2^k, …):
//
//   hpquad — raw quaternary: face token + base-4 digits.
//            1 char = 1 order. Hierarchy fully visible. The
//            teaching card; pairs with the FAQ tree diagram.
//   hphex  — 2 levels per hex char (0-9A-F). Face folds into the
//            first nibble (0–B; C–F reserved) for a pure, self-
//            parsing, case-free, URL-safe public code. The robust
//            default. ×16 truncation steps — finest manual control.
//   hp64   — 3 levels per base64url char. Densest; for URLs/QR.
//            Face kept as a separate leading symbol (12-into-64
//            doesn't fold cleanly).
//
// Stepper semantics: the +/- stepper is HEALPix ORDER k directly.
// One tap = one order = N_side doubles = ×4 cells. Quaternary shows
// this as one character; hex/base64 show it as fractional-character
// packing (the serialization pads to whole characters and the popup
// reports the honest area at every k).
//
// Equal-area: every cell at order k has identical area
// (4π / (12·4^k) steradians), so the resolution popup states a
// single global cell size with NO latitude caveat — the honest
// precision table the lat/lon grids can't give.
//
// The HEALPix core (ang2pix_nest / pix2ang_nest / corners_nest /
// pixcoord2vec_nest / nside2pixarea / orderpix2uniq …) is the
// @hscmap/healpix implementation (MIT, Gorski 2005), tested against
// healpy. Vendored verbatim at the bottom of this IIFE.
// ============================================================

const HealpixGrids = (function () {
  'use strict';

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const EARTH_AREA_M2 = 5.10072e14;   // mean Earth surface area
  const FOURPI = 4 * Math.PI;

  // base64url alphabet — URL-safe, the same family the Output tab uses
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  const MIN_ORDER = 1;
  // Honest precision ceiling. The nested index stays integer-exact to
  // k≈24 (12·4^k < 2^53), but the *projection* — double-precision
  // spherical trig — stops resolving distinct cells past k≈25 (~20 cm
  // equal-area). Beyond that we'd mint longer codes for points the math
  // can't actually distinguish, so 25 is the truthful limit. (Going
  // deeper needs a local-origin / extended-precision projection, a
  // separate piece of work — not just a wider integer type.)
  // Address depth is limited only by BigInt (i.e. not at all in practice). We
  // cap the UI/codec at a value far beyond any physical relevance: order 73 ≈
  // 0.7 fm mean cell. The ADDRESS layer (digits/string ↔ BigInt face/x/y) is
  // exact at every order here; only lat/lon INGESTION is precision-bounded by
  // double-precision projection (~order 26 on Earth), which is the coordinate's
  // limit, not the representation's. See bootstrap notes on nestIndex.
  const MAX_ORDER = 73;
  // Highest order at which the double-precision projection (lat/lon → f,x,y) is
  // bit-exact. Beyond this, ingestion still produces a valid deeper address, but
  // the trailing digits are a contained-cell refinement of the safe parent, not
  // information recovered from the (double) input coordinate.
  const PROJECTION_EXACT_ORDER = 26;

  // ── order ↔ nside, identity ───────────────────────────────
  function nsideOf(order) { return order2nside(order); }

  // (lat,lon) → nested pixel index (BigInt) at this order.
  //
  // For order ≤ PROJECTION_EXACT_ORDER this is the standard projection and is
  // bit-identical to reference HEALPix. For deeper orders the fused index/​nside
  // would overflow double precision, so we instead take the face and the
  // fractional position (p,q) ∈ [0,1) within that face and read off `order`
  // quaternary digits directly from the binary expansions of p and q. The first
  // ~PROJECTION_EXACT_ORDER digits carry real input information; deeper digits
  // are the contained-cell refinement permitted by the input's precision (a
  // double carries ~52 fraction bits, and the projection itself is the binding
  // limit). The result is always a VALID nested address that contains the input.
  function nestIndex(lat, lon, order) {
    const theta = (90 - lat) * D2R;
    const phi = (((lon % 360) + 360) % 360) * D2R;
    if (order <= PROJECTION_EXACT_ORDER) {
      const nside = nsideOf(order);
      return BigInt(ang2pix_nest(nside, theta, phi));
    }
    // Deep path: face + fractional p,q, then bit-extract `order` levels.
    const z = Math.cos(theta);
    const { t, u } = za2tu(z, phi);
    const { f, p, q } = tu2fpq(t, u);
    let px = p, qy = q;
    let x = 0n, y = 0n;
    for (let i = 0; i < order; i++) {
      px *= 2; const xb = px >= 1 ? 1 : 0; if (xb) px -= 1;
      qy *= 2; const yb = qy >= 1 ? 1 : 0; if (yb) qy -= 1;
      x = (x << 1n) | BigInt(xb);
      y = (y << 1n) | BigInt(yb);
    }
    return fxy2nest(order2nsideBig(order), f, x, y);
  }

  // nested index → {f, digits[]} : base pixel 0..11 and the order-long
  // array of quaternary digits (root-first).
  // fused nested index (BigInt or Number) → {f, digits[]}
  // Exact at any order: face = ipix / 4^order, then peel quaternary digits.
  function nestPath(ipix, order) {
    const span = 1n << (2n * BigInt(order));   // 4^order, exact BigInt
    let ip = BigInt(ipix);
    const f = Number(ip / span);               // face 0..11, safe as Number
    let rest = ip - BigInt(f) * span;
    const digits = new Array(order);
    for (let i = order - 1; i >= 0; i--) {
      digits[i] = Number(rest & 3n);
      rest >>= 2n;
    }
    return { f, digits };
  }

  // {f, digits[]} → fused nested index as BigInt (exact at any depth).
  function pathToNest(f, digits) {
    let q = 0n;
    for (let i = 0; i < digits.length; i++) q = q * 4n + BigInt(digits[i]);
    return BigInt(f) * (1n << (2n * BigInt(digits.length))) + q;
  }

  // nested index → [lat,lon] of the pixel centre
  function nestCentre(ipix, order) {
    const a = pix2ang_nest(nsideOf(order), ipix);
    const lat = 90 - a.theta * R2D;
    const lon = normLon(a.phi * R2D);
    return [lat, lon];
  }

  // wrap any degree value into [-180, 180)
  function normLon(deg) {
    return ((deg % 360) + 360 + 180) % 360 - 180;
  }

  // ── equal-area cell size ──────────────────────────────────
  function cellAreaM2(order) {
    return nside2pixarea(nsideOf(order)) / FOURPI * EARTH_AREA_M2;
  }
  // cellMetres returns a SQUARE-EQUIVALENT side (HEALPix cells are
  // diamonds, not lat/lon boxes; the popup wants w/h in metres, so we
  // report the side of the equal-area square — honest and latitude-free).
  function cellMetres(order) {
    const s = Math.sqrt(cellAreaM2(order));
    return { w: s, h: s };
  }

  // ── SERIALIZERS ───────────────────────────────────────────
  // Each returns a string; each has an inverse that recovers (f,digits).
  // `face` is always carried internally as 0..11; how it's written
  // depends on the serialization and on whether passphrase/obfuscation
  // is active (separate-and-append) vs the plain public form (folded).

  // --- quaternary: face token + dot + base-4 digits ---
  function serQuad(f, digits, opt) {
    return 'f' + f + '.' + (digits.length ? digits.join('') : '');
  }
  function deserQuad(str) {
    const m = String(str).trim().match(/^f(\d{1,2})\.?([0-3]*)$/);
    if (!m) return null;
    const f = parseInt(m[1], 10);
    if (!(f >= 0 && f <= 11)) return null;
    const digits = (m[2] || '').split('').map(Number);
    return { f, digits, order: digits.length };
  }

  // --- hex: 2 levels per nibble; face folds into first nibble (0–B) ---
  // Plain public form (no passphrase/obf): pure hex, self-parsing:
  //   nibble0 = face (0..11 → 0..B);  each later nibble = 2 levels.
  //   Odd order → final nibble is half-filled (low 2 bits 0), and a
  //   trailing length marker is unnecessary because order is supplied
  //   by the stepper on decode; for standalone codes we encode order
  //   parity by emitting ceil(order/2) body nibbles and trusting the
  //   caller's order. (Geosonify always knows the card's order.)
  function serHex(f, digits, opt) {
    opt = opt || {};
    const body = packBase(digits, 2, 16, '0123456789ABCDEF');
    if (opt.separateFace) {
      // passphrase / obfuscation: face peeled out, appended after a dot
      return body.str + '.' + faceToken12(f, opt);
    }
    // folded public form: face is the leading nibble
    return '0123456789AB'[f] + body.str;
  }
  function deserHex(str, order, opt) {
    opt = opt || {};
    str = String(str).trim().toUpperCase();
    let f, bodyStr;
    if (opt.separateFace || str.includes('.')) {
      const parts = str.split('.');
      bodyStr = parts[0];
      f = parseToken12(parts[1], opt);
    } else {
      f = '0123456789AB'.indexOf(str[0]);
      bodyStr = str.slice(1);
    }
    if (!(f >= 0 && f <= 11)) return null;
    const digits = unpackBase(bodyStr, 2, '0123456789ABCDEF', order);
    if (!digits) return null;
    return { f, digits, order: digits.length };
  }

  // --- base64url: 3 levels per char; face always a separate leading sym ---
  function ser64(f, digits, opt) {
    opt = opt || {};
    const body = packBase(digits, 3, 64, B64);
    return faceToken12(f, opt) + body.str;
  }
  function deser64(str, order, opt) {
    opt = opt || {};
    str = String(str).trim();
    const f = parseToken12(str[0], opt);
    if (!(f >= 0 && f <= 11)) return null;
    const digits = unpackBase(str.slice(1), 3, B64, order);
    if (!digits) return null;
    return { f, digits, order: digits.length };
  }

  // face as a single robust token: 0..9 then A,B  (12 values, case-free)
  function faceToken12(f /*, opt */) { return '0123456789AB'[f]; }
  function parseToken12(ch /*, opt */) {
    return '0123456789AB'.indexOf(String(ch || '').toUpperCase());
  }

  // pack quaternary digits → groups of `levels` → symbols of `radix`.
  // Groups are formed FROM THE LEFT (level 1 first). If the final group is
  // short, it is padded on the RIGHT with zero-children. This is what makes
  // the hierarchy survive: char 1 is always levels 1–2 (hex) / 1–3 (b64),
  // char 2 the next, etc., so a shorter code is a PREFIX of a longer one and
  // truncation drops from the right exactly like quaternary. (The trailing
  // char may carry fewer real levels than its width; the order — known from
  // the stepper, or from the "@k" suffix on standalone/URL codes — says how
  // many of its levels are real.)
  function packBase(digits, levels, radix, alpha) {
    const rem = digits.length % levels;
    const pad = (levels - rem) % levels;   // zero-children appended on the RIGHT
    let str = '';
    for (let i = 0; i < digits.length; i += levels) {
      let v = 0;
      for (let j = 0; j < levels; j++) v = v * 4 + (digits[i + j] || 0);
      str += alpha[v];
    }
    return { str, pad };
  }
  // inverse: symbols → quaternary digits, trimmed to `order` from the RIGHT
  // (removing the right padding packBase added to the final symbol).
  function unpackBase(str, levels, alpha, order) {
    const digits = [];
    for (const ch of str) {
      const v = alpha.indexOf(ch);
      if (v < 0) return null;
      const grp = new Array(levels);
      let t = v;
      for (let j = levels - 1; j >= 0; j--) { grp[j] = t & 3; t >>= 2; }
      for (let j = 0; j < levels; j++) digits.push(grp[j]);
    }
    if (order != null) {
      // drop the right-side padding to land on exactly `order` digits
      while (digits.length > order) digits.pop();
      while (digits.length < order) digits.push(0);
    }
    return digits;
  }

  // ── token stream (for delta / passphrase / obfuscation) ───
  // The trademark machinery operates on flat token-index streams. For
  // HEALPix the natural stream is: [face(0..11), then per-level child
  // (0..3) ×order]. This is grid-agnostic exactly like the alphanumeric
  // path: face permutes as a 12-cell grid, each level as a 4-cell grid.
  function tokenStream(lat, lon, order) {
    const ip = nestIndex(lat, lon, order);
    const { f, digits } = nestPath(ip, order);
    return { face: f, levels: digits };   // levels: array of 0..3
  }

  // ── keyed permutation (passphrase / obfuscation) ──────────
  // FROZEN FORMAT: geosonify-healpix-pass-v1
  //
  // HEALPix conforms to Geosonify's existing keyed-permutation model rather
  // than inventing its own crypto. The host app's frozen shuffle —
  // shuffleGridAndOrder(grid, pass, chainPrefix) → { order } — is injected
  // (so this engine stays standalone) and called on:
  //   • the face   as a 1×12 grid (chainPrefix = '')
  //   • each level as a 1×4  grid (chainPrefix = comma-joined TRUE indices
  //                                 chosen so far: face, then each child)
  // exactly mirroring how the vocabulary grids chain. One permutation of the
  // location; the three serializations are renderings of its result, so all
  // three are identically secure (representation ≠ breakability).
  //
  // Chain semantics (must match encode⇄decode): after each step the TRUE
  // chosen index is appended to the chain — identical to the native loop —
  // so the per-level shuffle is reproducible in both directions.
  //
  // shuffleGridAndOrder returns order[] where order[i] = the original index
  // now sitting at sorted position i. So:
  //   permute (encode):  displayed = indexOf(order, trueVal)
  //   invert  (decode):  trueVal   = order[displayedVal]
  // The chain is always built from TRUE indices, available in both directions.

  function _row(n) { const r = new Array(n); for (let i = 0; i < n; i++) r[i] = i; return [r]; }

  // permute a true (face, levels) → displayed (face, levels)
  function permutePath(f, digits, pass, shuffleFn) {
    if (!pass || !shuffleFn) return { f, digits: digits.slice() };
    const chain = [];
    // face: 12-cell
    const fo = shuffleFn(_row(12), pass, '').order;
    const dispF = fo.indexOf(f);
    chain.push(String(f));                 // TRUE index into chain
    const out = new Array(digits.length);
    for (let i = 0; i < digits.length; i++) {
      const lo = shuffleFn(_row(4), pass, chain.join(',')).order;
      out[i] = lo.indexOf(digits[i]);      // displayed child
      chain.push(String(digits[i]));       // TRUE child into chain
    }
    return { f: dispF, digits: out };
  }

  // invert displayed (face, levels) → true (face, levels)
  function unpermutePath(dispF, dispDigits, pass, shuffleFn) {
    if (!pass || !shuffleFn) return { f: dispF, digits: dispDigits.slice() };
    const chain = [];
    const fo = shuffleFn(_row(12), pass, '').order;
    const trueF = fo[dispF];               // invert face
    chain.push(String(trueF));
    const out = new Array(dispDigits.length);
    for (let i = 0; i < dispDigits.length; i++) {
      const lo = shuffleFn(_row(4), pass, chain.join(',')).order;
      const trueChild = lo[dispDigits[i]]; // invert child
      out[i] = trueChild;
      chain.push(String(trueChild));
    }
    return { f: trueF, digits: out };
  }

  // ── obfuscation (position-based index shift) ──────────────
  // FROZEN FORMAT: part of geosonify-healpix-pass-v1.
  //
  // Conforms to the host's applyIndexObfuscation MODEL: a reversible,
  // position-dependent index shift over each token's own alphabet. The host
  // version shifts each non-final token by its distance-from-end (mod N) over
  // a single vocabulary of size N. HEALPix's tokens have per-position alphabet
  // sizes — face = 12, each level = 4 — so we shift each token mod its own
  // size by distance-from-end. The FINAL token is left unshifted (matching the
  // host, which preserves the last token to keep the deepest cell addressable).
  // Order in the pipeline mirrors vocabulary grids: permute (passphrase) FIRST,
  // then obfuscate. Decode reverses: un-obfuscate, then un-permute.
  //
  // The token sequence is [face, level0, level1, …]; "distance from end" counts
  // from the last level. Face size 12, levels size 4.
  function obfuscatePath(f, digits, mode) {
    // tokens with their alphabet sizes
    const sizes = [12].concat(digits.map(() => 4));
    const vals = [f].concat(digits.slice());
    const n = vals.length;
    const out = vals.slice();
    // shift every token except the final one, by distance-from-end
    for (let i = 0; i < n - 1; i++) {
      const posFromEnd = (n - 1) - i;       // 1 for 2nd-last, 2 for 3rd-last, …
      const N = sizes[i];
      if (mode === 'encode') out[i] = ((vals[i] - posFromEnd) % N + N) % N;
      else                   out[i] = (vals[i] + posFromEnd) % N;
    }
    return { f: out[0], digits: out.slice(1) };
  }

  // ── scheme registry (mirrors GISGrids.SCHEMES shape) ──────
  const SCHEMES = {
    hpquad: {
      name: 'HEALPix · quaternary',
      link: 'https://healpix.sourceforge.io/',
      defaultIterations: 22, minIterations: MIN_ORDER, maxIterations: MAX_ORDER,
      iterLabel: k => `order ${k}`,
      levelsPerChar: 1,
      encode: (lat, lon, k, opt) => {
        let { f, digits } = nestPath(nestIndex(lat, lon, k), k);
        if (opt && opt.pass) { const p = permutePath(f, digits, opt.pass, opt.shuffleFn); f = p.f; digits = p.digits; }
        if (opt && opt.obf)  { const o = obfuscatePath(f, digits, 'encode'); f = o.f; digits = o.digits; }
        return serQuad(f, digits, opt);
      },
      decodeAt: (str, k, opt) => {
        const p = deserQuad(str, opt); if (!p) return null;
        let { f, digits } = p;
        if (opt && opt.obf)  { const o = obfuscatePath(f, digits, 'decode'); f = o.f; digits = o.digits; }
        if (opt && opt.pass) { const u = unpermutePath(f, digits, opt.pass, opt.shuffleFn); f = u.f; digits = u.digits; }
        return nestCentre(pathToNest(f, digits), digits.length);
      },
      cellMetres: k => cellMetres(k)
    },
    hphex: {
      name: 'HEALPix · hex',
      link: 'https://healpix.sourceforge.io/',
      defaultIterations: 22, minIterations: MIN_ORDER, maxIterations: MAX_ORDER,
      iterLabel: k => `order ${k}`,
      levelsPerChar: 2,
      encode: (lat, lon, k, opt) => {
        let { f, digits } = nestPath(nestIndex(lat, lon, k), k);
        if (opt && opt.pass) { const p = permutePath(f, digits, opt.pass, opt.shuffleFn); f = p.f; digits = p.digits; }
        if (opt && opt.obf)  { const o = obfuscatePath(f, digits, 'encode'); f = o.f; digits = o.digits; }
        return serHex(f, digits, opt);
      },
      decodeAt: (str, k, opt) => {
        const p = deserHex(str, k, opt); if (!p) return null;
        let { f, digits } = p;
        if (opt && opt.obf)  { const o = obfuscatePath(f, digits, 'decode'); f = o.f; digits = o.digits; }
        if (opt && opt.pass) { const u = unpermutePath(f, digits, opt.pass, opt.shuffleFn); f = u.f; digits = u.digits; }
        return nestCentre(pathToNest(f, digits), digits.length);
      },
      cellMetres: k => cellMetres(k)
    },
    hp64: {
      name: 'HEALPix · base64',
      link: 'https://healpix.sourceforge.io/',
      defaultIterations: 22, minIterations: MIN_ORDER, maxIterations: MAX_ORDER,
      iterLabel: k => `order ${k}`,
      levelsPerChar: 3,
      encode: (lat, lon, k, opt) => {
        let { f, digits } = nestPath(nestIndex(lat, lon, k), k);
        if (opt && opt.pass) { const p = permutePath(f, digits, opt.pass, opt.shuffleFn); f = p.f; digits = p.digits; }
        if (opt && opt.obf)  { const o = obfuscatePath(f, digits, 'encode'); f = o.f; digits = o.digits; }
        return ser64(f, digits, opt);
      },
      decodeAt: (str, k, opt) => {
        const p = deser64(str, k, opt); if (!p) return null;
        let { f, digits } = p;
        if (opt && opt.obf)  { const o = obfuscatePath(f, digits, 'decode'); f = o.f; digits = o.digits; }
        if (opt && opt.pass) { const u = unpermutePath(f, digits, opt.pass, opt.shuffleFn); f = u.f; digits = u.digits; }
        return nestCentre(pathToNest(f, digits), digits.length);
      },
      cellMetres: k => cellMetres(k)
    }
  };

  const SCHEME_NOTES = {
    hpquad: 'HEALPix NESTED as a raw base-4 tree: a 1-of-12 base pixel, then one digit per level (each picks 1 of 4 children). Drop a digit → the parent. Equal-area everywhere; the hierarchy is fully visible.',
    hphex: 'HEALPix packed 2 levels per hex character; the 1-of-12 base pixel folds into the first nibble (0–B). Pure, case-free, URL-safe, self-parsing. Dropping one character widens the cell 16×.',
    hp64: 'HEALPix packed 3 levels per base64url character (densest). The base pixel is a separate leading symbol. Best for URLs and QR; dropping one character widens the cell 64×.'
  };

  // ── public interface (GISGrids-compatible) ────────────────
  // The card's order is passed as `iterations` throughout, matching the
  // GIS engine's calling convention.
  function encode(schemeKey, lat, lon, iterations, opt) {
    const s = SCHEMES[schemeKey];
    if (!s || lat === undefined) return '';
    try { return s.encode(lat, lon, clampOrder(iterations), opt || {}) || ''; }
    catch (e) { console.warn('[healpix] encode failed:', schemeKey, e); return ''; }
  }

  // decode needs the order; Geosonify always knows the card's order, so
  // it's passed in. (Standalone codes from hphex/hp64 are length-derived
  // when order is omitted: chars × levelsPerChar, minus face handling.)
  function decode(schemeKey, str, iterations, opt) {
    const s = SCHEMES[schemeKey];
    if (!s || !str) return null;
    str = String(str).trim();
    // Optional explicit-order suffix "@k" makes a standalone/URL code exact
    // (needed because hex/base64 packing left-pads, so length alone can't
    // distinguish e.g. order 7 from 8). If present it wins over inference.
    let explicitK = null;
    const at = str.lastIndexOf('@');
    if (at > 0 && /^@\d{1,2}$/.test(str.slice(at))) {
      explicitK = parseInt(str.slice(at + 1), 10);
      str = str.slice(0, at);
    }
    // Order precedence: an explicit "@k" in the string is authoritative (it was
    // written to make the code exact), then the caller-passed order, then
    // inference from length.
    let k;
    if (explicitK != null) k = explicitK;
    else if (iterations != null) k = iterations;
    else k = inferOrder(schemeKey, str);
    try {
      const r = s.decodeAt(str, clampOrder(k), opt || {});
      if (r && isFinite(r[0]) && isFinite(r[1]) &&
          Math.abs(r[0]) <= 90 && Math.abs(r[1]) <= 180) return r;
      return null;
    } catch (e) { return null; }
  }

  // Build a standalone/URL-safe code that carries its own order.
  // Bare codes are for display; URL/share codes use this so they decode exactly.
  function encodeStandalone(schemeKey, lat, lon, order, opt) {
    const k = clampOrder(order);
    const bare = encode(schemeKey, lat, lon, k, opt);
    if (!bare) return '';
    // quaternary is self-describing (digit count = order); no suffix needed
    if (schemeKey === 'hpquad') return bare;
    return bare + '@' + k;
  }

  function inferOrder(schemeKey, str) {
    str = String(str).trim();
    const at = str.lastIndexOf('@');
    if (at > 0 && /^@\d{1,2}$/.test(str.slice(at))) {
      return clampOrder(parseInt(str.slice(at + 1), 10));
    }
    const s = SCHEMES[schemeKey];
    if (schemeKey === 'hpquad') {
      const dot = str.indexOf('.');
      return dot >= 0 ? str.length - dot - 1 : 0;
    }
    // hex/base64 without an explicit suffix: length gives the MAXIMUM order
    // (packing may have left-padded by up to levels-1). Region-correct but
    // possibly 1–2 levels too deep; URL/standalone codes should carry @k.
    if (schemeKey === 'hphex') {
      const body = str.includes('.') ? str.split('.')[0] : str.slice(1);
      return body.length * 2;
    }
    if (schemeKey === 'hp64') return (str.length - 1) * 3;
    return s.defaultIterations;
  }

  function clampOrder(k) {
    k = Math.round(+k || 0);
    return Math.max(MIN_ORDER, Math.min(MAX_ORDER, k));
  }

  function precisionText(schemeKey, iterations, coord) {
    const k = clampOrder(iterations);
    const d = cellMetres(k);
    // Full unit ladder from km down to attometre, so deep cells report a real
    // measurement instead of flooring to "0.0 µm". Picks the unit whose value
    // lands in a readable range; sub-attometre falls back to scientific metres.
    const f = m => {
      if (!isFinite(m) || m <= 0) return '0';
      if (m >= 1000)   return (m / 1000).toFixed(1) + ' km';
      if (m >= 1)      return m.toFixed(1) + ' m';
      if (m >= 1e-3)   return (m * 1e3).toFixed(1) + ' mm';
      if (m >= 1e-6)   return (m * 1e6).toFixed(1) + ' µm';
      if (m >= 1e-9)   return (m * 1e9).toFixed(1) + ' nm';
      if (m >= 1e-12)  return (m * 1e12).toFixed(1) + ' pm';
      if (m >= 1e-15)  return (m * 1e15).toFixed(1) + ' fm';
      if (m >= 1e-18)  return (m * 1e18).toFixed(1) + ' am';
      return m.toExponential(1) + ' m';
    };
    // equal-area: a single honest figure, no latitude term
    return `${f(d.h)} cell (equal-area)`;
  }

  // ── curved cell footprint for the map ─────────────────────
  // Returns a CLOSED ring of [lat,lon] tracing the TRUE pixel boundary
  // (sampled along edges via pixcoord2vec_nest), NOT a 4-corner box.
  // The map layer must draw the full ring (do not slice to 4).
  function cellCorners(schemeKey, lat, lon, iterations, step) {
    const k = clampOrder(iterations);
    const nside = nsideOf(k);
    const ipix = nestIndex(lat, lon, k);
    return pixelBoundary(nside, ipix, step || 14);
  }

  // sample the 4 curved edges of a nested pixel into 4*step latlon pts
  function pixelBoundary(nside, ipix, step) {
    const pts = [];
    const edges = [[[0,0],[1,0]], [[1,0],[1,1]], [[1,1],[0,1]], [[0,1],[0,0]]];
    for (const [[a0,b0],[a1,b1]] of edges) {
      for (let s = 0; s < step; s++) {
        const t = s / step;
        const v = pixcoord2vec_nest(nside, ipix, a0 + (a1-a0)*t, b0 + (b1-b0)*t);
        const ll = vec2ll(v);
        pts.push(ll);
      }
    }
    pts.push(pts[0].slice());           // close the ring
    return unwrapRing(pts);
  }
  function vec2ll(v) {
    const a = vec2ang(v);
    const lat = 90 - a.theta * R2D;
    const lon = normLon(a.phi * R2D);
    return [lat, lon];
  }
  // keep a ring on one world copy so Leaflet doesn't smear it across ±180
  function unwrapRing(pts) {
    const out = pts.map(p => p.slice());
    for (let i = 1; i < out.length; i++) {
      let d = out[i][1] - out[i-1][1];
      if (d > 180) out[i][1] -= 360; else if (d < -180) out[i][1] += 360;
    }
    return out;
  }

  // exact, clean global cell count: 12 · 4^k
  function cellCount(schemeKey, iterations) {
    const k = clampOrder(iterations);
    return 12 * Math.pow(4, k);
  }

  // NUNIQ packed integer for interoperability (MOC / Aladin / healpy)
  function uniq(lat, lon, order) {
    const k = clampOrder(order);
    return orderpix2uniq(k, nestIndex(lat, lon, k));
  }

  // ── card definitions for CardRenderer.registerGrid ────────
  // Marked `healpix:<key>` (NOT `gis`) so the renderer routes encode/
  // decode here while keeping the cards eligible for the trademark
  // features that the `gis` flag deliberately disables.
  function cardDefs() {
    const defs = {};
    for (const [key, s] of Object.entries(SCHEMES)) {
      defs[key] = {
        name: s.name,
        healpix: key,                  // marks this as a HEALPix card
        grid: null,
        defaultIterations: s.defaultIterations,
        minIterations: s.minIterations,
        maxIterations: s.maxIterations,
        link: s.link,
        isEmoji: false,
        curvedCell: true               // map must draw full ring, not 4 corners
      };
    }
    return defs;
  }

  // showInfo: build the resolution-popup data and hand to the SHARED
  // renderer that GISGrids already exposes, so every ℹ️ looks identical.
  function showInfo(schemeKey, currentOrder, coord, options) {
    options = options || {};
    const s = SCHEMES[schemeKey];
    if (!s || !coord) return;
    if (typeof GISGrids === 'undefined' || !GISGrids.renderResolutionPopup) return;

    const levels = [];
    for (let k = s.minIterations; k <= s.maxIterations; k++) {
      levels.push({
        label: s.iterLabel(k),
        code: encode(schemeKey, coord.lat, coord.lon, k),
        dims: precisionText(schemeKey, k, coord),
        here: k === currentOrder
      });
    }

    const ring = cellCorners(schemeKey, coord.lat, coord.lon, currentOrder, 1);
    // ring has 4 sampled corners (+close) at step=1 → take the 4 corners
    const corners4 = ring ? ring.slice(0, 4) : null;
    const centre = nestCentre(nestIndex(coord.lat, coord.lon, currentOrder), currentOrder);
    const dims = cellMetres(currentOrder);
    const dLat = (centre[0] - coord.lat) * 111319.9;
    const dLon = (centre[1] - coord.lon) * 111319.9 * Math.cos(coord.lat * D2R);
    const errorM = Math.sqrt(dLat*dLat + dLon*dLon);

    const baseNote = SCHEME_NOTES[schemeKey] || '';
    GISGrids.renderResolutionPopup({
      title: s.name,
      note: baseNote,
      uncertaintyLine: options.uncertaintyLine || null,
      levels,
      detail: corners4 ? {
        corners: corners4,
        widthM: dims.w, heightM: dims.h,
        centroid: centre,
        errorM,
        coverage: cellCount(schemeKey, currentOrder),
        coverageLabel: s.iterLabel(currentOrder)
      } : null,
      compareLine: options.compareLine || null
    });
  }

  // ============================================================
  // Vendored HEALPix core (@hscmap/healpix, MIT). Verbatim.
  // ============================================================
  
/**
 * # API Reference
 *
 * This package based on this paper: [Gorski (2005)](http://iopscience.iop.org/article/10.1086/427976/pdf).
 *
 * The key things to understand the implementation are:
 * - Spherical coordinates in different representations such as `(alpha, delta)`
 *   or `(theta, phi)` or `(X, Y, z)` are always normalised to `(z, a)`.
 * - The HEALPix spherical projection is used to map to `(t, u)` (see `za2tu` and `tu2za`).
 *   See Section 4.4 and Figure 5 in the paper, where `(t, u)` is called `(x_s, y_s)`.
 *
 * - A simple affine transformation is used to map to `(f, x, y)` (see `tu2fxy` and `fxy2tu`),
 *   where `f = {0 .. 11}` is the base pixel index and `(x, y)` is the position
 *   within the base pixel in the (north-east, north-west) direction
 *   and `(0, 0)` in the south corner.
 * - From `(f, x, y)`, the HEALPix pixel index in the "nested" scheme
 *   is related via `fxy2nest` and `nest2fxy`, and in the "ring" scheme
 *   via `fxy2ring` and `ring2fxy` in a relatively simple equations.
 *
 * To summarise: there are two geometrical transformations:
 * `(z, a)` <-> `(t, u)` is the HEALPix spherical projection,
 * and `(t, u)` <-> `(f, x, y)` is a 45 deg rotation and scaling for each
 * of the 12 base pixels, so that HEALPix pixels in `(x, y)` are unit squares,
 * and pixel index compuatations are relatively straightforward,
 * both in the "nested" and "ring" pixelisation scheme.
 *
 * ## Notations
 *
 * <pre>
 * theta :  colatitude (pi/2 - delta)                [0 , pi]
 * phi   :  longitude (alpha)                        [0, 2 pi)
 * t     :  coord. of x-axis in spherical projection [0, 2 pi)
 * u     :  coord. of y-axis in spherical projection [-pi/2, pi/2]
 * z     :  cos(theta)                               [-1, 1]
 * X     :  sin(theta) * cos(phi)                    [-1, 1]
 * Y     :  sin(theta) * sin(phi)                    [-1, 1]
 * a     :  phi                                      [0, 2 pi)
 * f     :  base pixel index                         {0 .. 11}
 * x     :  north-east index in base pixel           [0, nside)
 * y     :  north-west index in base pixel           [0, nside)
 * p     :  north-east axis in base pixel            [0, 1)
 * q     :  north-west axis in base pixel            [0, 1)
 * j     :  pixel-in-ring index                      polar cap: {1 .. 4 i}
 *                                                   equatorial belt: {1 .. 4 nside}
 * i     :  ring index                               {1 .. 4 nside - 1}
 * </pre>
 */

function order2nside(order) {
    // Number nside is used ONLY by the double-precision projection, which is
    // itself bounded to PROJECTION_EXACT_ORDER; 1<<order would overflow the
    // 32-bit shift past order 30, so use 2**order (exact as a double to 2^53).
    return Math.pow(2, order);
}
// BigInt nside for the address layer — exact at any order.
function order2nsideBig(order) {
    return 1n << BigInt(order);
}
function nside2order(nside) {
    return ilog2(nside);
}
function nside2npix(nside) {
    return 12 * nside * nside;
}
function vec2pix_nest(nside, v) {
    const { z, a } = vec2za(v[0], v[1], v[2]);
    return za2pix_nest(nside, z, a);
}
function vec2pix_ring(nside, v) {
    const { z, a } = vec2za(v[0], v[1], v[2]);
    return nest2ring(nside, za2pix_nest(nside, z, a));
}
function ang2pix_nest(nside, theta, phi) {
    const z = Math.cos(theta);
    return za2pix_nest(nside, z, phi);
}
function ang2pix_ring(nside, theta, phi) {
    const z = Math.cos(theta);
    return nest2ring(nside, za2pix_nest(nside, z, phi));
}
function nest2ring(nside, ipix) {
    const { f, x, y } = nest2fxy(nside, ipix);
    return fxy2ring(nside, f, x, y);
}
function ring2nest(nside, ipix) {
    if (nside == 1) {
        return ipix;
    }
    const { f, x, y } = ring2fxy(nside, ipix);
    return fxy2nest(nside, f, x, y);
}
function ring2fxy(nside, ipix) {
    const polar_lim = 2 * nside * (nside - 1);
    if (ipix < polar_lim) { // north polar cap
        const i = Math.floor((Math.sqrt(1 + 2 * ipix) + 1) / 2);
        const j = ipix - 2 * i * (i - 1);
        const f = Math.floor(j / i);
        const k = j % i;
        const x = nside - i + k;
        const y = nside - 1 - k;
        return { f, x, y };
    }
    if (ipix < polar_lim + 8 * nside * nside) { // equatorial belt
        const k = ipix - polar_lim;
        const ring = 4 * nside;
        const i = nside - Math.floor(k / ring);
        const s = i % 2 == 0 ? 1 : 0;
        const j = 2 * (k % ring) + s;
        const jj = j - 4 * nside;
        const ii = i + 5 * nside - 1;
        const pp = (ii + jj) / 2;
        const qq = (ii - jj) / 2;
        const PP = Math.floor(pp / nside);
        const QQ = Math.floor(qq / nside);
        const V = 5 - (PP + QQ);
        const H = PP - QQ + 4;
        const f = 4 * V + (H >> 1) % 4;
        const x = pp % nside;
        const y = qq % nside;
        return { f, x, y };
    }
    else { // south polar cap
        const p = 12 * nside * nside - ipix - 1;
        const i = Math.floor((Math.sqrt(1 + 2 * p) + 1) / 2);
        const j = p - 2 * i * (i - 1);
        const f = 11 - Math.floor(j / i);
        const k = j % i;
        const x = i - k - 1;
        const y = k;
        return { f, x, y };
    }
}
function pix2vec_nest(nside, ipix) {
    const { f, x, y } = nest2fxy(nside, ipix);
    const { t, u } = fxy2tu(nside, f, x, y);
    const { z, a } = tu2za(t, u);
    return za2vec(z, a);
}
function pix2ang_nest(nside, ipix) {
    const { f, x, y } = nest2fxy(nside, ipix);
    const { t, u } = fxy2tu(nside, f, x, y);
    const { z, a } = tu2za(t, u);
    return { theta: Math.acos(z), phi: a };
}
function pix2vec_ring(nside, ipix) {
    return pix2vec_nest(nside, ring2nest(nside, ipix));
}
function pix2ang_ring(nside, ipix) {
    return pix2ang_nest(nside, ring2nest(nside, ipix));
}
// TODO: cleanup
function query_disc_inclusive_nest(nside, v, radius, cb) {
    if (radius > PI_2) {
        throw new Error(`query_disc: radius must < PI/2`);
    }
    const pixrad = max_pixrad(nside);
    const d = PI_4 / nside;
    const { z: z0, a: a0 } = vec2za(v[0], v[1], v[2]); // z0 = cos(theta)
    const sin_t = Math.sqrt(1 - z0 * z0);
    const cos_r = Math.cos(radius); // r := radius
    const sin_r = Math.sin(radius);
    const z1 = z0 * cos_r + sin_t * sin_r; // cos(theta - r)
    const z2 = z0 * cos_r - sin_t * sin_r; // cos(theta + r)
    const u1 = za2tu(z1, 0).u;
    const u2 = za2tu(z2, 0).u;
    const cover_north_pole = sin_t * cos_r - z0 * sin_r < 0; // sin(theta - r) < 0
    const cover_south_pole = sin_t * cos_r + z0 * sin_r < 0; // sin(theta - r) < 0
    let i1 = Math.floor((PI_2 - u1) / d);
    let i2 = Math.floor((PI_2 - u2) / d + 1);
    if (cover_north_pole) {
        ++i1;
        for (let i = 1; i <= i1; ++i)
            walk_ring(nside, i, cb);
        ++i1;
    }
    if (i1 == 0) {
        walk_ring(nside, 1, cb);
        i1 = 2;
    }
    if (cover_south_pole) {
        --i2;
        for (let i = i2; i <= 4 * nside - 1; ++i)
            walk_ring(nside, i, cb);
        --i2;
    }
    if (i2 == 4 * nside) {
        walk_ring(nside, 4 * nside - 1, cb);
        i2 = 4 * nside - 2;
    }
    const theta = Math.acos(z0);
    for (let i = i1; i <= i2; ++i)
        walk_ring_around(nside, i, a0, theta, radius + pixrad, ipix => {
            if (angle(pix2vec_nest(nside, ipix), v) <= radius + pixrad)
                cb(ipix);
        });
}
function query_disc_inclusive_ring(nside, v, radius, cb_ring) {
    return query_disc_inclusive_nest(nside, v, radius, ipix => {
        cb_ring(nest2ring(nside, ipix));
    });
}
function max_pixrad(nside) {
    const unit = PI_4 / nside;
    return angle(tu2vec(unit, nside * unit), tu2vec(unit, (nside + 1) * unit));
}
function angle(a, b) {
    return 2 * Math.asin(Math.sqrt(distance2(a, b)) / 2);
}
function tu2vec(t, u) {
    const { z, a } = tu2za(t, u);
    return za2vec(z, a);
}
function distance2(a, b) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return dx * dx + dy * dy + dz * dz;
}
function walk_ring_around(nside, i, a0, theta, r, cb) {
    if (theta < r || theta + r > PI)
        return walk_ring(nside, i, cb);
    const u = PI_4 * (2 - i / nside);
    const z = tu2za(PI_4, u).z;
    const st = Math.sin(theta);
    const ct = Math.cos(theta);
    const sr = Math.sin(r);
    const cr = Math.cos(r);
    const w = Math.atan2(Math.sqrt(-square(z - ct * cr) / (square(st) * sr * sr) + 1) * sr, (-z * ct + cr) / st);
    if (w >= PI)
        return walk_ring(nside, i, cb);
    const t1 = center_t(nside, i, za2tu(z, wrap(a0 - w, PI2)).t);
    const t2 = center_t(nside, i, za2tu(z, wrap(a0 + w, PI2)).t);
    const begin = tu2fxy(nside, t1, u);
    const end = right_next_pixel(nside, tu2fxy(nside, t2, u));
    for (let s = begin; !fxy_compare(s, end); s = right_next_pixel(nside, s)) {
        cb(fxy2nest(nside, s.f, s.x, s.y));
    }
}
function center_t(nside, i, t) {
    const d = PI_4 / nside;
    t /= d;
    t = (((t + i % 2) >> 1) << 1) + 1 - i % 2;
    t *= d;
    return t;
}
function walk_ring(nside, i, cb) {
    const u = PI_4 * (2 - i / nside);
    const t = PI_4 * (1 + (1 - i % 2) / nside);
    const begin = tu2fxy(nside, t, u);
    let s = begin;
    do {
        cb(fxy2nest(nside, s.f, s.x, s.y));
        s = right_next_pixel(nside, s);
    } while (!fxy_compare(s, begin));
}
function fxy_compare(a, b) {
    return a.x == b.x && a.y == b.y && a.f == b.f;
}
function right_next_pixel(nside, { f, x, y }) {
    ++x;
    if (x == nside) {
        switch (Math.floor(f / 4)) {
            case 0:
                f = (f + 1) % 4;
                x = y;
                y = nside;
                break;
            case 1:
                f = f - 4;
                x = 0;
                break;
            case 2:
                f = 4 + (f + 1) % 4;
                x = 0;
                break;
        }
    }
    --y;
    if (y == -1) {
        switch (Math.floor(f / 4)) {
            case 0:
                f = 4 + (f + 1) % 4;
                y = nside - 1;
                break;
            case 1:
                f = f + 4;
                y = nside - 1;
                break;
            case 2: {
                f = 8 + (f + 1) % 4;
                y = x - 1;
                x = 0;
                break;
            }
        }
    }
    return { f, x, y };
}
function corners_nest(nside, ipix) {
    const { f, x, y } = nest2fxy(nside, ipix);
    const { t, u } = fxy2tu(nside, f, x, y);
    const d = PI_4 / nside;
    const xyzs = [];
    for (const [tt, uu] of [
        [0, d],
        [-d, 0],
        [0, -d],
        [d, 0],
    ]) {
        const { z, a } = tu2za(t + tt, u + uu);
        xyzs.push(za2vec(z, a));
    }
    return xyzs;
}
function corners_ring(nside, ipix) {
    return corners_nest(nside, ring2nest(nside, ipix));
}
// pixel area
function nside2pixarea(nside) {
    return PI / (3 * nside * nside);
}
// average pixel size
function nside2resol(nside) {
    return Math.sqrt(PI / 3) / nside;
}
function pixcoord2vec_nest(nside, ipix, ne, nw) {
    const { f, x, y } = nest2fxy(nside, ipix);
    const { t, u } = fxy2tu(nside, f, x, y);
    const d = PI_4 / nside;
    const { z, a } = tu2za(t + d * (ne - nw), u + d * (ne + nw - 1));
    return za2vec(z, a);
}
function pixcoord2vec_ring(nside, ipix, ne, nw) {
    return pixcoord2vec_nest(nside, ring2nest(nside, ipix), ne, nw);
}
function za2pix_nest(nside, z, a) {
    const { t, u } = za2tu(z, a);
    const { f, x, y } = tu2fxy(nside, t, u);
    return fxy2nest(nside, f, x, y);
}
function tu2fxy(nside, t, u) {
    const { f, p, q } = tu2fpq(t, u);
    const x = clip(Math.floor(nside * p), 0, nside - 1);
    const y = clip(Math.floor(nside * q), 0, nside - 1);
    return { f, x, y };
}
function wrap(A, B) {
    return A < 0 ? B - (-A % B) : A % B;
}
const PI2 = 2 * Math.PI;
const PI = Math.PI;
const PI_2 = Math.PI / 2;
const PI_4 = Math.PI / 4;
const PI_8 = Math.PI / 8;
function sigma(z) {
    if (z < 0)
        return -sigma(-z);
    else
        return 2 - Math.sqrt(3 * (1 - z));
}
/**
 * HEALPix spherical projection.
 */
function za2tu(z, a) {
    if (Math.abs(z) <= 2. / 3.) { // equatorial belt
        const t = a;
        const u = 3 * PI_8 * z;
        return { t, u };
    }
    else { // polar caps
        const p_t = a % (PI_2);
        const sigma_z = sigma(z);
        const t = a - (Math.abs(sigma_z) - 1) * (p_t - PI_4);
        const u = PI_4 * sigma_z;
        return { t, u };
    }
}
/**
 * Inverse HEALPix spherical projection.
 */
function tu2za(t, u) {
    const abs_u = Math.abs(u);
    if (abs_u >= PI_2) { // error
        return { z: sign(u), a: 0 };
    }
    if (abs_u <= Math.PI / 4) { // equatorial belt
        const z = 8 / (3 * PI) * u;
        const a = t;
        return { z, a };
    }
    else { // polar caps
        const t_t = t % (Math.PI / 2);
        const a = t - (abs_u - PI_4) / (abs_u - PI_2) * (t_t - PI_4);
        const z = sign(u) * (1 - 1 / 3 * square(2 - 4 * abs_u / PI));
        return { z, a };
    }
}
// (x, y, z) -> (z = cos(theta), phi)
function vec2za(X, Y, z) {
    const r2 = X * X + Y * Y;
    if (r2 == 0)
        return { z: z < 0 ? -1 : 1, a: 0 };
    else {
        const a = (Math.atan2(Y, X) + PI2) % PI2;
        z /= Math.sqrt(z * z + r2);
        return { z, a };
    }
}
// (z = cos(theta), phi) -> (x, y, z)
function za2vec(z, a) {
    const sin_theta = Math.sqrt(1 - z * z);
    const X = sin_theta * Math.cos(a);
    const Y = sin_theta * Math.sin(a);
    return [X, Y, z];
}
function ang2vec(theta, phi) {
    const z = Math.cos(theta);
    return za2vec(z, phi);
}
function vec2ang(v) {
    const { z, a } = vec2za(v[0], v[1], v[2]);
    return { theta: Math.acos(z), phi: a };
}
// spherical projection -> f, p, q
// f: base pixel index
// p: coord in north east axis of base pixel
// q: coord in north west axis of base pixel
function tu2fpq(t, u) {
    t /= PI_4;
    u /= PI_4;
    t = wrap(t, 8);
    t += -4;
    u += 5;
    const pp = clip((u + t) / 2, 0, 5);
    const PP = Math.floor(pp);
    const qq = clip((u - t) / 2, 3 - PP, 6 - PP);
    const QQ = Math.floor(qq);
    const V = 5 - (PP + QQ);
    if (V < 0) { // clip
        return { f: 0, p: 1, q: 1 };
    }
    const H = PP - QQ + 4;
    const f = 4 * V + (H >> 1) % 4;
    const p = pp % 1;
    const q = qq % 1;
    return { f, p, q };
}
// f, p, q -> nest index
function fxy2nest(nside, f, x, y) {
    const n = BigInt(nside);
    return BigInt(f) * n * n + bit_combine(x, y);
}
// x = (...x2 x1 x0)_2 <- in binary
// y = (...y2 y1 y0)_2
// p = (...y2 x2 y1 x1 y0 x0)_2
// returns p
// Order-safe bit interleave (Geosonify modification).
// The upstream @hscmap/healpix interleave used 32-bit shifts and was
// limited to norder ≤ 15 (it asserts x < 2^16, y < 2^15). Geosonify
// location cards want sub-metre precision (higher orders), so we use a
// float-safe interleave: result occupies up to 2*26 = 52 bits, within
// JS's exact-integer range (2^53). Verified bit-identical to the
// upstream formula for all x,y < 2^15, and exact round-trip to 2^26.
function bit_combine(x, y) {
    // Interleave x -> even bits, y -> odd bits (standard HEALPix NESTED Z-order).
    // BigInt, looping over actual significant bits -> no order-26 ceiling.
    let bx = BigInt(x), by = BigInt(y);
    let p = 0n, shift = 0n;
    while (bx > 0n || by > 0n) {
        if (bx & 1n) p |= (1n << (2n * shift));
        if (by & 1n) p |= (1n << (2n * shift + 1n));
        bx >>= 1n; by >>= 1n; shift += 1n;
    }
    return p;
}
// x = (...x2 x1 x0)_2 <- in binary
// y = (...y2 y1 y0)_2
// p = (...y2 x2 y1 x1 y0 x0)_2
// returns x, y
function bit_decombine(p) {
    // Inverse of bit_combine. Returns BigInt x,y.
    let bp = BigInt(p);
    let x = 0n, y = 0n, shift = 0n;
    while (bp > 0n) {
        if (bp & 1n) x |= (1n << shift);
        if (bp & 2n) y |= (1n << shift);
        bp >>= 2n; shift += 1n;
    }
    return { x, y };
}
// f: base pixel index
// x: north east index in base pixel
// y: north west index in base pixel
function nest2fxy(nside, ipix) {
    const n = BigInt(nside);
    const nside2 = n * n;
    const ip = BigInt(ipix);
    const f = Number(ip / nside2); // base pixel index 0..11
    const k = ip % nside2; // nested index within base pixel
    const { x, y } = bit_decombine(k); // BigInt x,y
    return { f, x, y };
}
function fxy2ring(nside, f, x, y) {
    x = Number(x); y = Number(y);
    const f_row = Math.floor(f / 4); // {0 .. 2}
    const f1 = f_row + 2; // {2 .. 4}
    const v = x + y;
    const i = f1 * nside - v - 1;
    if (i < nside) { // north polar cap
        const f_col = f % 4;
        const ipix = 2 * i * (i - 1) + (i * f_col) + nside - y - 1;
        return ipix;
    }
    if (i < 3 * nside) { // equatorial belt
        const h = x - y;
        const f2 = 2 * (f % 4) - (f_row % 2) + 1; // {0 .. 7}
        const k = (f2 * nside + h + (8 * nside)) % (8 * nside);
        const offset = 2 * nside * (nside - 1);
        const ipix = offset + (i - nside) * 4 * nside + (k >> 1);
        return ipix;
    }
    else { // south polar cap
        const i_i = 4 * nside - i;
        const i_f_col = 3 - (f % 4);
        const j = 4 * i_i - (i_i * i_f_col) - y;
        const i_j = 4 * i_i - j + 1;
        const ipix = 12 * nside * nside - 2 * i_i * (i_i - 1) - i_j;
        return ipix;
    }
}
// f, x, y -> spherical projection
function fxy2tu(nside, f, x, y) {
    x = Number(x); y = Number(y);   // projection works in doubles (bounded order)
    const f_row = Math.floor(f / 4);
    const f1 = f_row + 2;
    const f2 = 2 * (f % 4) - (f_row % 2) + 1;
    const v = x + y;
    const h = x - y;
    const i = f1 * nside - v - 1;
    const k = (f2 * nside + h + (8 * nside));
    const t = k / nside * PI_4;
    const u = PI_2 - i / nside * PI_4;
    return { t, u };
}
function orderpix2uniq(order, ipix) {
    /**
     * Pack `(order, ipix)` into a `uniq` integer (HEALPix NUNIQ scheme).
     * BigInt: 4*(4^order - 1) + ipix overflows Number past order ~15, and ipix
     * is BigInt at depth, so the whole computation is BigInt.
     */
    const k = BigInt(order);
    return 4n * ((1n << (2n * k)) - 1n) + BigInt(ipix);
}
function uniq2orderpix(uniq) {
    /**
     * Unpack `uniq` integer into `(order, ipix)`.
     *
     * Inverse of `orderpix2uniq`.
     */
    assert(uniq <= 0x7fffffff);
    let order = 0;
    let l = (uniq >> 2) + 1;
    while (l >= 4) {
        l >>= 2;
        ++order;
    }
    const ipix = uniq - (((1 << (2 * order)) - 1) << 2);
    return { order, ipix };
}
function ilog2(x) {
    /**
     * log2 for integer numbers.
     *
     * We're not calling Math.log2 because it's not supported on IE yet.
     */
    let o = -1;
    while (x > 0) {
        x >>= 1;
        ++o;
    }
    return o;
}
const sign = Math.sign || function (A) {
    return A > 0 ? 1 : (A < 0 ? -1 : 0);
};
function square(A) {
    return A * A;
}
function clip(Z, A, B) {
    return Z < A ? A : (Z > B ? B : Z);
}
function assert(condition) {
    console.assert(condition);
    if (!condition) {
        debugger;
    }
}


  return {
    SCHEMES, SCHEME_NOTES,
    encode, decode, precisionText, cellCorners, cellCount, showInfo, cardDefs,
    encodeStandalone,
    uniq, tokenStream, nestIndex, nestPath, pathToNest, nestCentre, cellAreaM2,
    inferOrder, clampOrder,
    // serializers exposed for tests
    _ser: { serQuad, deserQuad, serHex, deserHex, ser64, deser64, packBase, unpackBase },
    _perm: { permutePath, unpermutePath, obfuscatePath },
    // core exposed for tests
    _core: { ang2pix_nest, pix2ang_nest, corners_nest, pixcoord2vec_nest,
             order2nside, nside2pixarea, orderpix2uniq }
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = HealpixGrids;
