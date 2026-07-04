#!/usr/bin/env node
/*
 * healpix-pass-v1-reference.js
 *
 * FROZEN reference implementation of Geosonify's geosonify-healpix-pass-v1
 * format: the keyed permutation (passphrase), the position-based obfuscation
 * shift, and the three serializations (hpquad / hphex / hp64) applied to a
 * HEALPix NESTED token stream, exactly as shipped in js/lib/geosonify-healpix.js.
 * Deliberately boring and dependency-free (Node's built-in SHA3-512 only). It is
 * an executable oracle for future maintainers and clean-room re-implementers.
 *
 * Scope: the layer from a TRUE token stream (face 0..11, then `order` child
 * digits 0..3) to the final code string and back:
 *
 *   (f, digits) --permutePath--> displayed --obfuscatePath--> shifted --ser*--> code
 *   code --deser*--> shifted --obfuscatePath(decode)--> displayed --unpermutePath--> (f, digits)
 *
 * Producing (f, digits) from lat/lon is HEALPix NESTED ang2pix (Górski 2005), a
 * published standard vendored separately in geosonify-healpix.js; the end-to-end
 * vectors below record the true token stream captured from that shipped code so
 * this oracle needs no spherical geometry.
 *
 * The keyed permutation is grid-passphrase v1 (FROZEN-FORMAT-SPEC.md) applied to
 * a 1x12 "grid" for the face and 1x4 "grids" for the levels; that derivation uses
 * GENUINE SHA3-512 (FIPS 202) and is embedded below. (Contrast: the GeoCodec
 * obfuscation layer for vocabulary grids uses a DIFFERENT, custom hash — see
 * geocodec-obfuscation-reference.js. Do not conflate the two.)
 *
 * THE FORMAT IS IMMUTABLE. See FROZEN-HEALPIX-PASS-V1.md. A wrong reimplementation
 * does not error — it silently decodes existing codes to plausible WRONG places.
 */
'use strict';
const crypto = require('crypto');

/* ================= grid-passphrase v1 (embedded; frozen elsewhere) =============
 * order[] for N cells: key_i = SHA3-512( UTF8("geosonify-grid-pass-v1|" + NFC(pass)
 * + "|chain:" + chain) || LE32(i) ); sort indices by key bytes lexicographically,
 * ties (impossible in practice) by smaller index. Empty pass → identity.
 * Identical to grid-passphrase-v1-reference.js; duplicated so this file stays
 * single and dependency-free. healpix-pass-v1 uses ONLY the order (the injected
 * shuffleGridAndOrder's grid VALUES are irrelevant here: _row(n) grids hold
 * 0..n-1 and only N, pass and chain enter the derivation). */
const GRID_V1_PREFIX = 'geosonify-grid-pass-v1|';
function u32le(n) { return Buffer.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]); }
function sha3_512(buf) { return crypto.createHash('sha3-512').update(buf).digest(); }
function gridPassphraseOrderV1(N, passphrase, chain) {
  if (typeof passphrase !== 'string' || passphrase.length === 0) return Array.from({ length: N }, (_, i) => i);
  const preimage = Buffer.from(GRID_V1_PREFIX + passphrase.normalize('NFC') + '|chain:' + String(chain == null ? '' : chain), 'utf8');
  const keys = new Array(N);
  for (let i = 0; i < N; i++) keys[i] = sha3_512(Buffer.concat([preimage, u32le(i)]));
  const idx = Array.from({ length: N }, (_, i) => i);
  idx.sort((a, b) => { const c = Buffer.compare(keys[a], keys[b]); return c !== 0 ? c : a - b; });
  return idx;   // order[p] = original index now sitting at position p
}
/** The injected shuffle exactly as healpix-pass-v1 consumes it. */
function shuffleFn(grid, pass, chainPrefix) {
  return { order: gridPassphraseOrderV1(grid.flat().length, pass, chainPrefix) };
}
function _row(n) { const r = new Array(n); for (let i = 0; i < n; i++) r[i] = i; return [r]; }

/* ======================= keyed permutation (frozen) ============================
 * Face permutes as a 1x12 grid with chainPrefix ''.  Each level permutes as a
 * 1x4 grid with chainPrefix = comma-joined TRUE indices chosen so far (decimal:
 * face first, then each TRUE child). shuffleGridAndOrder returns order[] where
 * order[p] = original index at position p, so:
 *   encode:  displayed = order.indexOf(true)
 *   decode:  true      = order[displayed]
 * The chain is ALWAYS built from TRUE indices — available in both directions. */
function permutePath(f, digits, pass, shuffle) {
  shuffle = shuffle || shuffleFn;
  if (!pass || !shuffle) return { f, digits: digits.slice() };
  const chain = [];
  const fo = shuffle(_row(12), pass, '').order;
  const dispF = fo.indexOf(f);
  chain.push(String(f));                    // TRUE face into chain
  const out = new Array(digits.length);
  for (let i = 0; i < digits.length; i++) {
    const lo = shuffle(_row(4), pass, chain.join(',')).order;
    out[i] = lo.indexOf(digits[i]);         // displayed child
    chain.push(String(digits[i]));          // TRUE child into chain
  }
  return { f: dispF, digits: out };
}
function unpermutePath(dispF, dispDigits, pass, shuffle) {
  shuffle = shuffle || shuffleFn;
  if (!pass || !shuffle) return { f: dispF, digits: dispDigits.slice() };
  const chain = [];
  const fo = shuffle(_row(12), pass, '').order;
  const trueF = fo[dispF];
  chain.push(String(trueF));
  const out = new Array(dispDigits.length);
  for (let i = 0; i < dispDigits.length; i++) {
    const lo = shuffle(_row(4), pass, chain.join(',')).order;
    const trueChild = lo[dispDigits[i]];
    out[i] = trueChild;
    chain.push(String(trueChild));
  }
  return { f: trueF, digits: out };
}

/* ===================== obfuscation shift (frozen) ==============================
 * Token sequence [face, level0, level1, ...]; alphabet sizes [12, 4, 4, ...].
 * Every token EXCEPT the FINAL one (the deepest level) is shifted by its
 * distance-from-end d (1 for 2nd-last, ... — so with order >= 1 the FACE is
 * always shifted, by d = order):
 *   encode: out = ((v - d) % N + N) % N      ← DOUBLE-mod TRUE modulo
 *   decode: out = (v + d) % N
 * The double-mod on encode is LOAD-BEARING: d routinely exceeds N (levels have
 * N = 4 and d runs up to order, default 22). The single-+N variant used by the
 * vocabulary-grid obfuscation, (v - d + N) % N, goes NEGATIVE here and is WRONG
 * — the obf_long vector below detects that mistake. */
function obfuscatePath(f, digits, mode) {
  const sizes = [12].concat(digits.map(() => 4));
  const vals = [f].concat(digits.slice());
  const n = vals.length;
  const out = vals.slice();
  for (let i = 0; i < n - 1; i++) {
    const posFromEnd = (n - 1) - i;
    const N = sizes[i];
    if (mode === 'encode') out[i] = ((vals[i] - posFromEnd) % N + N) % N;
    else                   out[i] = (vals[i] + posFromEnd) % N;
  }
  return { f: out[0], digits: out.slice(1) };
}

/* ========================= serializations (frozen) =============================
 * hpquad: 'f' + face + '.' + digits             — lowercase 'f' REQUIRED on parse
 * hphex : leading nibble '0123456789AB'[face], then 2 levels per hex char
 * hp64  : leading face token '0123456789AB'[face], then 3 levels per b64url char
 * Packing groups digits FROM THE LEFT; a short final group is padded on the
 * RIGHT with zero-children (so shorter codes are prefixes of deeper ones and the
 * caller's order — or an '@k' suffix — recovers the true depth on decode).
 * deserHex uppercases its input (case-insensitive); deser64 does NOT (base64url
 * is case-sensitive). serHex has an opt.separateFace branch that NO shipped
 * caller activates; the folded form below is the only live form. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const MIN_ORDER = 1, MAX_ORDER = 73;
function clampOrder(k) { k = parseInt(k, 10) || MIN_ORDER; return Math.max(MIN_ORDER, Math.min(MAX_ORDER, k)); }
function faceToken12(f) { return '0123456789AB'[f]; }
function parseToken12(ch) { return '0123456789AB'.indexOf(String(ch || '').toUpperCase()); }

function packBase(digits, levels, radix, alpha) {
  let str = '';
  for (let i = 0; i < digits.length; i += levels) {
    let v = 0;
    for (let j = 0; j < levels; j++) v = v * 4 + (digits[i + j] || 0);   // RIGHT zero-pad
    str += alpha[v];
  }
  return { str };
}
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
    while (digits.length > order) digits.pop();   // trim RIGHT padding
    while (digits.length < order) digits.push(0);
  }
  return digits;
}

function serQuad(f, digits) { return 'f' + f + '.' + (digits.length ? digits.join('') : ''); }
function deserQuad(str) {
  const m = String(str).trim().match(/^f(\d{1,2})\.?([0-3]*)$/);
  if (!m) return null;
  const f = parseInt(m[1], 10);
  if (!(f >= 0 && f <= 11)) return null;
  const digits = (m[2] || '').split('').map(Number);
  return { f, digits, order: digits.length };
}
function serHex(f, digits) { return '0123456789AB'[f] + packBase(digits, 2, 16, '0123456789ABCDEF').str; }
function deserHex(str, order) {
  str = String(str).trim().toUpperCase();
  const f = '0123456789AB'.indexOf(str[0]);
  if (!(f >= 0 && f <= 11)) return null;
  const digits = unpackBase(str.slice(1), 2, '0123456789ABCDEF', order);
  if (!digits) return null;
  return { f, digits, order: digits.length };
}
function ser64(f, digits) { return faceToken12(f) + packBase(digits, 3, 64, B64).str; }
function deser64(str, order) {
  str = String(str).trim();
  const f = parseToken12(str[0]);
  if (!(f >= 0 && f <= 11)) return null;
  const digits = unpackBase(str.slice(1), 3, B64, order);
  if (!digits) return null;
  return { f, digits, order: digits.length };
}

/* Pipeline helpers mirroring the shipped SCHEMES exactly:
 * encode: permute (if pass) FIRST, then obfuscate (if obf), then serialize.
 * decode: deserialize, un-obfuscate, un-permute. */
const SER = { hpquad: [serQuad, (s, k) => deserQuad(s)], hphex: [serHex, deserHex], hp64: [ser64, deser64] };
function encodeFromPath(scheme, f, digits, opt) {
  opt = opt || {};
  let cur = { f, digits: digits.slice() };
  if (opt.pass) cur = permutePath(cur.f, cur.digits, opt.pass, opt.shuffleFn);
  if (opt.obf) cur = obfuscatePath(cur.f, cur.digits, 'encode');
  return SER[scheme][0](cur.f, cur.digits);
}
function decodeToPath(scheme, code, order, opt) {
  opt = opt || {};
  const p = SER[scheme][1](code, order);
  if (!p) return null;
  let cur = { f: p.f, digits: p.digits };
  if (opt.obf) cur = obfuscatePath(cur.f, cur.digits, 'decode');
  if (opt.pass) cur = unpermutePath(cur.f, cur.digits, opt.pass, opt.shuffleFn);
  return cur;
}

/* ==================== embedded frozen test vectors =============================
 * Every value below was captured from the SHIPPED geosonify-healpix.js running
 * unmodified (internals observed via a spliced copy; public HealpixGrids.encode/
 * decode cross-checked). See the spec's verification note. */
const VECTORS = {
  pass: 'Back Bay',
  faceOrder: [1, 10, 7, 4, 6, 0, 5, 9, 8, 2, 11, 3],          // gridPassphraseOrderV1(12,'Back Bay','')
  levelOrder_chain5: [2, 1, 0, 3],                             // gridPassphraseOrderV1(4,'Back Bay','5')
  levelOrder_chain5_2: [0, 2, 1, 3],                           // chain '5,2'
  permute: { f: 5, digits: [2, 3, 0, 1, 2],
             out: { f: 6, digits: [0, 3, 1, 0, 3] } },
  obf_short: { f: 5, digits: [2, 3, 0, 1, 2],
               out: { f: 0, digits: [2, 0, 2, 0, 2] } },       // face d=5: ((5-5)%12+12)%12=0
  // d up to 12 (> N+v for several levels): detects the single-+N mistake.
  obf_long: { f: 1, digits: [3, 1, 0, 2, 2, 1, 3, 0, 0, 1, 2, 3],
              out: { f: 1, digits: [0, 3, 3, 2, 3, 3, 2, 0, 1, 3, 1, 3] } },
  // End-to-end at lat -43.5321, lon 172.6362 (Christchurch NZ), pass 'Back Bay',
  // obfuscation ON. truePath is HEALPix NESTED ang2pix output from shipped code.
  e2e_K10: {
    order: 10,
    truePath: { f: 9, digits: [1, 1, 1, 2, 0, 2, 1, 1, 0, 0] },
    permuted: { f: 7, digits: [3, 2, 0, 0, 3, 3, 2, 2, 0, 2] },
    obfuscated: { f: 9, digits: [2, 2, 1, 2, 2, 3, 3, 0, 3, 2] },
    codes: { hpquad: 'f9.2212233032', hphex: '9A6BCE', hp64: '9przg' },
    plainCodes: { hpquad: 'f9.1112021100', hphex: '956250', hp64: '9ViUA' },
    decodedCentre: [-43.55603886743859, 172.67441860465112]
  },
  // Odd order exercises hphex right-padding of the half-filled final nibble.
  e2e_K7: {
    order: 7,
    truePath: { f: 9, digits: [1, 1, 1, 2, 0, 2, 1] },
    codes: { hphex: '05168' },
    plainCodes: { hphex: '95624' }
  }
};

/* ============================== self-test ===================================== */
function selfTest() {
  let pass = true;
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const fail = m => { pass = false; console.error('FAIL ' + m); };
  const P = VECTORS.pass;

  if (!eq(gridPassphraseOrderV1(12, P, ''), VECTORS.faceOrder)) fail('face order');
  if (!eq(gridPassphraseOrderV1(4, P, '5'), VECTORS.levelOrder_chain5)) fail('level order chain "5"');
  if (!eq(gridPassphraseOrderV1(4, P, '5,2'), VECTORS.levelOrder_chain5_2)) fail('level order chain "5,2"');

  // permute + round-trip
  {
    const v = VECTORS.permute;
    const got = permutePath(v.f, v.digits, P);
    if (!eq(got, v.out)) fail('permutePath');
    if (!eq(unpermutePath(got.f, got.digits, P), { f: v.f, digits: v.digits })) fail('unpermutePath round-trip');
  }
  // obfuscation short + long + round-trips + single-mod sentinel
  for (const key of ['obf_short', 'obf_long']) {
    const v = VECTORS[key];
    const got = obfuscatePath(v.f, v.digits, 'encode');
    if (!eq(got, v.out)) fail(key);
    if (!eq(obfuscatePath(got.f, got.digits, 'decode'), { f: v.f, digits: v.digits })) fail(key + ' round-trip');
  }
  {
    // prove the single-+N (GeoCodec-style) formula is WRONG for this format
    const v = VECTORS.obf_long;
    const sizes = [12].concat(v.digits.map(() => 4));
    const vals = [v.f].concat(v.digits);
    const naive = vals.slice();
    for (let i = 0; i < vals.length - 1; i++) {
      const d = (vals.length - 1) - i;
      naive[i] = (vals[i] - d + sizes[i]) % sizes[i];   // JS remainder: can go negative
    }
    const naiveOut = { f: naive[0], digits: naive.slice(1) };
    if (eq(naiveOut, v.out)) fail('single-+N variant unexpectedly matches (sentinel broken)');
    if (!naive.some(x => x < 0)) fail('single-+N sentinel should produce a negative digit here');
  }
  // final token untouched; face shifted whenever order >= 1
  {
    const v = VECTORS.obf_long;
    const got = obfuscatePath(v.f, v.digits, 'encode');
    if (got.digits[got.digits.length - 1] !== v.digits[v.digits.length - 1]) fail('final level must be unshifted');
  }

  // end-to-end K=10, all three schemes, encode + decode
  {
    const v = VECTORS.e2e_K10, t = v.truePath;
    const perm = permutePath(t.f, t.digits, P);
    if (!eq(perm, v.permuted)) fail('e2e K10 permuted stage');
    const obf = obfuscatePath(perm.f, perm.digits, 'encode');
    if (!eq(obf, v.obfuscated)) fail('e2e K10 obfuscated stage');
    for (const s of ['hpquad', 'hphex', 'hp64']) {
      const code = encodeFromPath(s, t.f, t.digits, { pass: P, obf: true });
      if (code !== v.codes[s]) fail(`e2e K10 ${s} code`);
      const back = decodeToPath(s, code, v.order, { pass: P, obf: true });
      if (!eq(back, t)) fail(`e2e K10 ${s} decode`);
      const plain = encodeFromPath(s, t.f, t.digits, {});
      if (plain !== v.plainCodes[s]) fail(`e2e K10 ${s} plain code`);
    }
  }
  // end-to-end K=7 (odd order → hphex half-filled final nibble)
  {
    const v = VECTORS.e2e_K7, t = v.truePath;
    const code = encodeFromPath('hphex', t.f, t.digits, { pass: P, obf: true });
    if (code !== v.codes.hphex) fail('e2e K7 hphex code');
    const back = decodeToPath('hphex', code, v.order, { pass: P, obf: true });
    if (!eq(back, t)) fail('e2e K7 hphex decode');
    if (encodeFromPath('hphex', t.f, t.digits, {}) !== v.plainCodes.hphex) fail('e2e K7 hphex plain');
    // decoding with the WRONG order (8, plausible from length alone) must differ
    const wrong = decodeToPath('hphex', code, 8, { pass: P, obf: true });
    if (eq(wrong, t)) fail('K7 decoded at order 8 should NOT round-trip (order matters)');
  }

  console.log(pass ? 'self-test: PASS (all frozen vectors reproduced)' : 'self-test: FAIL');
  return pass;
}

module.exports = {
  gridPassphraseOrderV1, shuffleFn, _row,
  permutePath, unpermutePath, obfuscatePath,
  serQuad, deserQuad, serHex, deserHex, ser64, deser64, packBase, unpackBase,
  faceToken12, parseToken12, clampOrder, MIN_ORDER, MAX_ORDER, B64,
  encodeFromPath, decodeToPath
};

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--selftest' || args.length === 0) {
    process.exit(selfTest() ? 0 : 1);
  } else if (args[0] === '--permute') {
    // --permute f d1d2d3... passphrase
    const f = parseInt(args[1], 10), digits = args[2].split('').map(Number);
    console.log(JSON.stringify(permutePath(f, digits, args[3])));
  } else {
    console.error('usage: --selftest | --permute f digits pass');
    process.exit(2);
  }
}
