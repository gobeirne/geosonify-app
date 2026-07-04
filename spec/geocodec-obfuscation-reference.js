#!/usr/bin/env node
/*
 * geocodec-obfuscation-reference.js
 *
 * FROZEN reference implementation of Geosonify's GeoCodec obfuscation derivation
 * (the "🔀 Obfuscated" toggle), as shipped in
 * js/lib/geosonify-codec-engine_v11_8a.js. Deliberately boring and dependency-free:
 * it uses only Node's built-in SHA3-512 (FIPS 202). Its job is NOT performance — it
 * is an executable oracle that future maintainers (or a clean-room re-implementer in
 * any language, decades from now) can check their own code against.
 *
 * Scope: this file specifies the OBFUSCATION layer only —
 *   (vocabulary flat[], code string)  →  obfuscated code string, and back.
 * That layer is: a seed string derived from (N, index of the code's FINAL token in
 * flat), SHA3-512 hash-extension, a chunked-hex sort producing a shuffle order, and
 * a position-based index shift in which the FINAL token is never changed.
 * Composing it with the hierarchical lat/lon <-> code subdivision and with the
 * grid-passphrase keyed permutation is covered by the end-to-end vectors below and
 * by FROZEN-GEOCODEC-OBFUSCATION.md; the grid-passphrase derivation itself is
 * specified separately (FROZEN-FORMAT-SPEC.md / grid-passphrase-v1-reference.js).
 *
 * THE DERIVATION IS IMMUTABLE. See FROZEN-GEOCODEC-OBFUSCATION.md. Do not change
 * any constant, string, chunk width, the sort, or the final-token rule. A wrong
 * derivation does not error — it silently decodes old codes to a different,
 * plausible-looking location.
 */
'use strict';
const crypto = require('crypto');

// ---- FROZEN constants ---------------------------------------------------------
// seed string  = "0,1,2,...,N-1" + "|" + String(lastIndexFlat)      (decimal, ASCII)
// hash         = the engine's CUSTOM Keccak-variant (NOT FIPS SHA3-512 — see below),
//                over UTF-8, as LOWERCASE hex (128 chars)
// seed target  = exactly 3*N hex chars, built by hash-extension (see below)
// chunk width  = floor(seedLen / N)  (= 3 whenever seedLen = 3*N)
// sort         = ascending by chunk value parseInt(chunk, 16); ties broken by
//                smaller original index (JS stable sort — ties DO occur; see spec)
// final token  = NEVER shifted; it both keys the shuffle and survives it verbatim
// --------------------------------------------------------------------------------

/* ---- The GeoCodec hash: NOT FIPS-202 SHA3-512 -----------------------------------
 * ⚠ CRITICAL, verified against the shipped engine: geosonify-codec-engine_v11_8a.js
 * names this function sha3_512_hex and its header says "Includes SHA3-512", but the
 * hand-rolled implementation deviates from FIPS 202 in two load-bearing ways:
 *   1. NONSTANDARD iota round constants: a 38-entry table covers only rounds 0-18;
 *      rounds 19-23 XOR zero (undefined>>>0). The table itself does not match the
 *      Keccak round constants.
 *   2. NONSTANDARD sponge: each 32-bit little-endian message word w is absorbed
 *      into the LOW half of lane w (state slot a[2w]); the HIGH halves of lanes
 *      never receive message or padding bytes, and the squeeze likewise reads only
 *      the low halves of lanes 0-15. Rate 72 bytes, pad 0x06 ... 0x80 as in SHA-3.
 *   (theta / rho / pi / chi and the rho offset table ARE standard Keccak-f[1600].)
 * Sanity anchor: over the preimage "0,1,...,35|0", REAL SHA3-512 gives
 *   2a7a062c1314c05c... whereas this function gives b0e83a15b65bd221... .
 * Every obfuscated Geosonify code in the wild depends on THIS hash, so it is frozen
 * exactly as shipped. The port below is line-for-line faithful to the engine.
 * -------------------------------------------------------------------------------- */
function GeoCodecSha3(){ this.state = new Uint32Array(50); this.pos = 0; this.blockLen = 72; this.finished = false; }
GeoCodecSha3.prototype._keccakf = (function(){
  var R=[0,36,3,41,18,1,44,10,45,2,62,6,43,15,61,28,55,25,21,56,27,20,39,8,14];
  var RC=[1,0,0,89,0,28,0,169,0,2,0,7,0,0x8000000a,0,0x80000008,0,0x80000001,0,0x80000080,0,0x8b,0,0x8a,0,0x81,0,0x80000081,0,0x80000008,0,0x83,0,0x8000000b,0,0x8000001b,0,0x1b];
  function ROTL64(hi, lo, n){ n&=63; if(n===0) return [hi,lo]; if(n<32){ var nhi=(hi<<n)|(lo>>>(32-n)); var nlo=(lo<<n)|(hi>>>(32-n)); return [nhi>>>0,nlo>>>0]; } n-=32; var nhi2=(lo<<n)|(hi>>>(32-n)); var nlo2=(hi<<n)|(lo>>>(32-n)); return [nhi2>>>0,nlo2>>>0]; }
  return function(a){
    for(var round=0; round<24; round++){
      var C=new Uint32Array(10), D=new Uint32Array(10), B=new Uint32Array(50);
      for(var x=0;x<5;x++){ var lo=0,hi=0; for(var y=0;y<5;y++){ var i=2*(x+5*y); lo^=a[i]; hi^=a[i+1]; } C[2*x]=lo; C[2*x+1]=hi; }
      for(var x2=0;x2<5;x2++){ var r=(x2+4)%5,s=(x2+1)%5; var rot=ROTL64(C[2*s+1],C[2*s],1); D[2*x2]=C[2*r]^rot[1]; D[2*x2+1]=C[2*r+1]^rot[0]; }
      for(var y2=0;y2<5;y2++){ for(var x3=0;x3<5;x3++){ var idx=2*(x3+5*y2); a[idx]^=D[2*x3]; a[idx+1]^=D[2*x3+1]; } }
      for(var y3=0;y3<5;y3++){ for(var x4=0;x4<5;x4++){ var i2=x4+5*y3; var j=y3+((2*x4+3*y3)%5)*5; var off=R[i2]; var r2=ROTL64(a[2*i2+1],a[2*i2],off); B[2*j]=r2[1]; B[2*j+1]=r2[0]; } }
      for(var y4=0;y4<5;y4++){ for(var x5=0;x5<5;x5++){ var i3=2*(x5+5*y4), iN=2*(((x5+1)%5)+5*y4), iNN=2*(((x5+2)%5)+5*y4); a[i3]=B[i3]^((~B[iN])&B[iNN]); a[i3+1]=B[i3+1]^((~B[iN+1])&B[iNN+1]); } }
      a[0]^=RC[2*round]>>>0; a[1]^=RC[2*round+1]>>>0;
    }
  };
})();
GeoCodecSha3.prototype.update=function(data){ if(this.finished) throw new Error("sha3_512: already finalized"); var a=this.state,i=0,len=data.length|0; while(i<len){ var b=Math.min(this.blockLen-this.pos,len-i); for(var j=0;j<b;j++){ var t=data[i+j],wi=(this.pos>>2),sh=(this.pos&3)*8; a[wi*2]^=(t&0xff)<<sh; this.pos++; if(this.pos===this.blockLen){ this._keccakf(a); this.pos=0; } } i+=b; } return this; };
GeoCodecSha3.prototype.finalize=function(){ if(this.finished) return this; var a=this.state,pad=0x06,wi=(this.pos>>2),sh=(this.pos&3)*8; a[wi*2]^=pad<<sh; a[((this.blockLen-1)>>2)*2]^=0x80<<(((this.blockLen-1)&3)*8); this._keccakf(a); this.finished=true; return this; };
GeoCodecSha3.prototype.hex=function(){ if(!this.finished) this.finalize(); var a=this.state,out='',bytesNeeded=64,p=0; while(bytesNeeded>0){ var wi=(p>>2),sh=(p&3)*8,b=(a[wi*2]>>>sh)&0xff; out+=(b<16?'0':'')+b.toString(16); p++; bytesNeeded--; if(p===this.blockLen&&bytesNeeded>0){ this._keccakf(a); p=0; } } return out; };

/** The engine's hash of a string: UTF-8 encode, then the custom sponge above. */
function geoCodecHashHex(str) {
  const h = new GeoCodecSha3();
  h.update(Buffer.from(String(str), 'utf8'));
  return h.hex();   // 128 lowercase hex chars
}

/** "0,1,...,N-1|<lastIndexFlat>" — exact preimage of the seed hash. */
function buildIndexSeedString(N, lastIndexFlat) {
  const parts = new Array(N);
  for (let i = 0; i < N; i++) parts[i] = String(i);
  return parts.join(',') + '|' + String(lastIndexFlat);
}

/**
 * Hash-extension: h = geoCodecHashHex(seedString); while h.length < 3N:
 * h += geoCodecHashHex(h)  — NOTE: each round hashes the ENTIRE accumulated hex
 * string (as ASCII/UTF-8 text), not just the previous block. Guard: if the
 * accumulated length exceeds 10000 the loop breaks (unreachable for N <= 3333;
 * all shipped grids have N <= 2048... the largest shipped grid is 45*45 = 2025).
 * Returns exactly the first 3N chars.
 */
function generateStrongSeedFromIndices(N, lastIndexFlat) {
  let h = geoCodecHashHex(buildIndexSeedString(N, lastIndexFlat));
  const minLen = N * 3;
  while (h.length < minLen) { h += geoCodecHashHex(h); if (h.length > 10000) break; }
  return h.substring(0, minLen);
}

/**
 * Shuffle order from the seed: split the seed into N chunks of
 * floor(len/N) hex chars (with len = 3N this is exactly 3 chars, values
 * 0x000..0xfff), sort indices ascending by chunk value, ties broken by smaller
 * original index. order[p] = original flat index now at shuffled position p.
 */
function generateShuffleOrderFromHash(N, seedHash) {
  const chunkSize = Math.floor(seedHash.length / N) || 1;
  const items = [];
  for (let i = 0; i < N; i++) {
    const chunk = seedHash.substr(i * chunkSize, chunkSize);
    let key = parseInt(chunk, 16);
    if (!Number.isFinite(key)) key = 0;   // shipped code's try/catch fallback; unreachable for valid hex
    items.push({ i, k: key });
  }
  // Shipped code sorts with (a,b) => a.k - b.k under JS's spec-guaranteed STABLE
  // sort (ES2019+): equal keys keep insertion order = ascending original index.
  // We make the tie-break explicit so this oracle is engine-independent.
  items.sort((a, b) => (a.k - b.k) || (a.i - b.i));
  return items.map(it => it.i);
}

function applyShuffle(flat, order) {
  return order.map(i => flat[i]);   // shuffled[p] = flat[order[p]]
}

/** Greedy longest-token-first tokenizer over the unique tokens of flat. */
function tokenizeCode(code, flat) {
  const uniq = Array.from(new Set(flat.map(String))).filter(t => t.length > 0);
  uniq.sort((a, b) => b.length - a.length);
  const out = []; let i = 0;
  while (i < code.length) {
    let matched = null;
    for (const tok of uniq) { if (code.substr(i, tok.length) === tok) { matched = tok; break; } }
    if (!matched) return null;
    out.push(matched); i += matched.length;
  }
  return out;
}

function sanitizeNoUndefined(str) {
  const i = String(str).indexOf('undefined');
  return i === -1 ? String(str) : String(str).slice(0, i);
}

/**
 * The frozen obfuscation. mode = 'encode' | 'decode'.
 * flat is the vocabulary IN THE ORDER THE CODE WAS ENCODED WITH:
 *   - no passphrase  → the base grid, flattened row-major;
 *   - with passphrase → the LAYER-1 (empty-chain) grid-passphrase shuffle of the
 *     base grid — NOT any per-level chained shuffle. (Call-site contract; see spec.)
 *
 * Faithful port of applyIndexObfuscation in geosonify-codec-engine_v11_8a.js,
 * including its exact JS remainder semantics on encode (single +N, not a true
 * mod — see the domain caveat in the spec: token count must be <= N+1).
 */
function applyIndexObfuscation(mode, code, flat) {
  const tokens = tokenizeCode(code, flat);
  if (!tokens || !tokens.length) return code;
  const N = flat.length;
  const lastToken = tokens[tokens.length - 1];
  const lastIndexFlat = flat.indexOf(lastToken);
  if (lastIndexFlat < 0) return '';           // maxSafePrefixLength() === 0 in shipped code
  const order = generateShuffleOrderFromHash(N, generateStrongSeedFromIndices(N, lastIndexFlat));
  const shuffled = applyShuffle(flat, order);
  const idxs = tokens.map(t => shuffled.indexOf(t));
  if (idxs.some(x => x < 0)) return '';       // cannot happen for tokens drawn from flat
  const lastIdx = idxs.pop();
  const outIdxs = new Array(idxs.length);
  for (let j = 0; j < idxs.length; j++) {
    const posFromEnd = idxs.length - j;       // 1 for 2nd-last, 2 for 3rd-last, ...
    if (mode === 'encode') outIdxs[j] = (idxs[j] - posFromEnd + N) % N;  // JS remainder: single +N
    else                   outIdxs[j] = (idxs[j] + posFromEnd) % N;
  }
  // indexTokensToCode: any out-of-range index (possible on encode only when
  // posFromEnd > N + idxs[j], i.e. token count > N+1) makes the whole left part ''.
  let left = '';
  for (const x of outIdxs) { if (x < 0 || x >= N) { left = null; break; } }
  if (left !== null) left = outIdxs.map(x => shuffled[x]).join('');
  else left = '';
  const tail = (lastIdx >= 0 && lastIdx < N) ? shuffled[lastIdx] : '';   // === lastToken, unchanged
  return sanitizeNoUndefined(left + tail);
}

// ---- Hierarchical codec (for the end-to-end vectors only) ---------------------
// Equirectangular row-major subdivision of [-90,90]x[-180,180]; row 0 is the
// NORTHERNMOST row. Ported VERBATIM from the engine (boundsForCell / encode /
// decode) — including the exact floating-point expression order, because a
// different-but-algebraically-equal expression (e.g. latMax - dLat*r - dLat
// instead of latMax - dLat*(r+1)) drifts by ULPs and can flip a deep cell.
// NOTE: the passphrase-CHAINED path in card-renderer.js uses a slightly
// different (also frozen) bounds expression; see the spec, section 3.
function boundsForCell(rows, cols, r, c, latMin, latMax, lonMin, lonMax) {
  const dLat = (latMax - latMin) / rows, dLon = (lonMax - lonMin) / cols;
  return { latMin: latMax - dLat * (r + 1), latMax: latMax - dLat * r,
           lonMin: lonMin + dLon * c,       lonMax: lonMin + dLon * (c + 1) };
}
function encodeHierarchical(lat, lon, grid2D, iterations) {
  iterations = Math.max(1, iterations | 0);
  const rows = grid2D.length, cols = grid2D[0].length, flat = grid2D.flat();
  if (!rows || !cols || flat.length !== rows * cols) return '';
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180, code = '';
  for (let it = 0; it < iterations; it++) {
    const rFrac = (latMax - lat) / (latMax - latMin), cFrac = (lon - lonMin) / (lonMax - lonMin);
    let r = Math.floor(rFrac * rows); if (r < 0) r = 0; if (r >= rows) r = rows - 1;
    let c = Math.floor(cFrac * cols); if (c < 0) c = 0; if (c >= cols) c = cols - 1;
    const tok = String(flat[r * cols + c]); if (!tok) return code;
    code += tok;
    const b = boundsForCell(rows, cols, r, c, latMin, latMax, lonMin, lonMax);
    latMin = b.latMin; latMax = b.latMax; lonMin = b.lonMin; lonMax = b.lonMax;
  }
  return code;
}
function decodeHierarchical(code, grid2D, iterations) {
  const rows = grid2D.length, cols = grid2D[0].length, flat = grid2D.flat();
  if (!rows || !cols || flat.length !== rows * cols) return null;
  let tokens = tokenizeCode(code, flat); if (!tokens || !tokens.length) return null;
  if (iterations && tokens.length > iterations) tokens = tokens.slice(0, iterations);
  let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
  for (const t of tokens) {
    const idx = flat.indexOf(t); if (idx < 0) return null;
    const r = Math.floor(idx / cols), c = idx % cols;
    const b = boundsForCell(rows, cols, r, c, latMin, latMax, lonMin, lonMax);
    latMin = b.latMin; latMax = b.latMax; lonMin = b.lonMin; lonMax = b.lonMax;
  }
  return [(latMin + latMax) / 2, (lonMin + lonMax) / 2];
}

// The frozen 6x6 alphanumeric base grid (geosonify-grids-data.js), used by vectors.
const ALPHANUMERIC = [
  ['0','1','2','3','4','5'],
  ['6','7','8','9','a','b'],
  ['c','d','e','f','g','h'],
  ['i','j','k','l','m','n'],
  ['o','p','q','r','s','t'],
  ['u','v','w','x','y','z']
];

// ---- Embedded frozen test vectors (must never change) --------------------------
// Every value below was captured from the SHIPPED geosonify-codec-engine_v11_8a.js
// and card-renderer.js running unmodified; see the spec's verification note.
const VECTORS = {
  // SHA3-512( "0,1,2,...,35|0" ) — the exact seed-hash preimage for N=36, last=0
  anchorPreimage: buildIndexSeedString(36, 0),
  anchorHashHex:
    'b0e83a15b65bd2211ac48165392f95905f2945c4f598e390b9a1cc855bda3aac' +
    '7166951fb6f14ad07b0e025920c80131066b0a06e978a15dec709d20ce7adb4a',
  // What GENUINE SHA3-512 (FIPS 202) gives for the same preimage — kept as a
  // sanity anchor so a re-implementer immediately sees the hash is nonstandard:
  realSha3OfAnchorPreimage:
    '2a7a062c1314c05cba42fb8ea617626dde1547cfbab6e38c7c1a4e83490c42ba' +
    '296806beb9603e43c2554bc5d2598c486110e2e073c9bbab6dc1541851e53b4e',
  // generateStrongSeedFromIndices(36, 0) — first 108 chars of the anchor hash
  // (N*3 = 108 <= 128, so no extension round occurs for N=36).
  seed_36_0:
    'b0e83a15b65bd2211ac48165392f95905f2945c4f598e390b9a1cc855bda3aac' +
    '7166951fb6f14ad07b0e025920c80131066b0a06e978',
  // TIE CASE (pins the stable tie-break): chunks 0 and 27 of seed_36_0 are both
  // 'b0e' (0xb0e = 2830). The order MUST place original index 0 before 27.
  tie_36_0: { i1: 0, i2: 27, chunkHex: 'b0e' },
  orders: [
    { N: 36, last: 0,
      order: [28,32,34,5,31,25,2,7,17,15,8,20,12,13,23,3,22,1,18,10,29,35,14,33,0,27,24,16,19,6,21,30,26,4,11,9] },
    { N: 36, last: 20,
      order: [5,20,1,2,35,17,4,12,33,9,26,14,23,31,24,15,22,13,32,19,29,11,10,0,6,16,30,25,21,8,18,28,27,7,3,34] },
    { N: 256, last: 171,
      order: [209,247,88,51,205,104,177,113,235,202,13,222,99,219,208,81,196,85,193,16,180,44,211,213,239,191,96,176,169,3,86,74,175,230,150,240,66,87,232,246,19,12,90,26,54,50,71,154,181,14,187,185,75,21,231,39,161,170,174,68,151,166,250,136,216,106,69,10,255,102,200,46,160,35,30,164,4,178,188,241,24,167,101,95,162,197,93,43,60,215,76,0,28,80,55,114,100,163,78,198,158,111,98,70,238,57,142,38,244,72,131,179,67,210,218,124,45,204,82,79,253,147,109,171,52,8,141,223,192,15,233,107,65,17,92,143,49,32,155,61,184,121,251,252,138,203,182,137,2,199,33,42,36,221,64,118,186,195,206,144,130,228,6,110,149,116,29,40,56,153,62,123,190,140,47,105,37,112,225,194,157,173,245,122,117,201,229,22,145,58,220,156,97,127,254,34,227,237,224,236,134,217,25,53,18,73,148,132,108,159,168,23,94,248,7,27,83,9,139,5,165,172,20,242,89,189,84,48,243,125,183,126,41,234,133,226,11,31,128,103,135,115,129,249,63,146,212,120,152,91,1,214,207,119,59,77] }
  ],
  // End-to-end, NO passphrase, alphanumeric 6x6, lat/lon in Christchurch NZ:
  e2e_plain: {
    lat: -43.5321, lon: 172.6362, iterations: 9,
    plainCode: 'thp9enl5q',
    obfCode:   'yjkbmtanq',            // final 'q' unchanged; every other token shifted
    decodedLat: -43.53210198045268, decodedLon: 172.63619184385
  },
  // End-to-end, passphrase 'Back Bay' + obfuscation, alphanumeric 6x6.
  // The per-iteration CHAINED grid-passphrase encode produced chainedPlain (chain of
  // TRUE flat indices '29,17,25,9,14,23,21,5,26'); obfuscation is then applied over
  // the LAYER-1 (empty-chain) shuffled flat, given verbatim below.
  e2e_pass: {
    pass: 'Back Bay', lat: -43.5321, lon: 172.6362, iterations: 9,
    layer1Flat: 'l1eaqokmt7rxysh46f0zuijnwdvc598pg2b3',   // base flat permuted by gridPassphraseOrderV1(36,'Back Bay','')
    chainedPlain: '9lco0qd8t',
    chainedObf:   'x4hpzbhot',
    // WRONG-GRID SENTINEL: obfuscating chainedPlain over the final-level CHAINED
    // shuffle (chain '29,17,25,9,14,23,21,5') yields this DIFFERENT code. A
    // reimplementation that picks the per-level grid will produce it — and fail.
    wrongGridFlat: null,   // computed in selfTest from the chained order below
    wrongGridChain: '29,17,25,9,14,23,21,5',
    wrongGridObf: 'siefxz3kt',
    decodedLat: -43.53210198045268, decodedLon: 172.63619184385
  }
};

// ---- grid-passphrase v1 keyed permutation (embedded for the e2e_pass vector) ---
// Identical to grid-passphrase-v1-reference.js; duplicated here so this oracle
// stays a single dependency-free file. See FROZEN-FORMAT-SPEC.md.
const GRID_V1_PREFIX = 'geosonify-grid-pass-v1|';
function u32le(n) { return Buffer.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]); }
function sha3_512_buf(buf) { return crypto.createHash('sha3-512').update(buf).digest(); }
function gridPassphraseOrderV1(N, passphrase, chain) {
  if (typeof passphrase !== 'string' || passphrase.length === 0) return Array.from({ length: N }, (_, i) => i);
  const preimage = Buffer.from(GRID_V1_PREFIX + passphrase.normalize('NFC') + '|chain:' + chain, 'utf8');
  const keys = new Array(N);
  for (let i = 0; i < N; i++) keys[i] = sha3_512_buf(Buffer.concat([preimage, u32le(i)]));
  const idx = Array.from({ length: N }, (_, i) => i);
  idx.sort((a, b) => { const c = Buffer.compare(keys[a], keys[b]); return c !== 0 ? c : a - b; });
  return idx;
}

// ---- self-test ------------------------------------------------------------------
function selfTest() {
  let pass = true;
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const fail = m => { pass = false; console.error('FAIL ' + m); };

  // anchor hash + seed
  if (geoCodecHashHex(VECTORS.anchorPreimage) !== VECTORS.anchorHashHex) fail('anchor hash');
  // and prove this hash is NOT FIPS-202 SHA3-512 (a real-SHA3 reimplementation must fail):
  const realSha3 = crypto.createHash('sha3-512').update(Buffer.from(VECTORS.anchorPreimage,'utf8')).digest('hex');
  if (realSha3 === VECTORS.anchorHashHex) fail('hash unexpectedly equals FIPS SHA3-512');
  if (realSha3 !== VECTORS.realSha3OfAnchorPreimage) fail('real-SHA3 sanity anchor');
  if (generateStrongSeedFromIndices(36, 0) !== VECTORS.seed_36_0) fail('seed 36/0');
  if (VECTORS.seed_36_0 !== VECTORS.anchorHashHex.substring(0, 108)) fail('seed = anchor prefix');

  // tie: chunks 0 and 27 equal, and order places 0 before 27
  const t = VECTORS.tie_36_0;
  if (VECTORS.seed_36_0.substr(t.i1 * 3, 3) !== t.chunkHex ||
      VECTORS.seed_36_0.substr(t.i2 * 3, 3) !== t.chunkHex) fail('tie chunks');
  const ord360 = generateShuffleOrderFromHash(36, VECTORS.seed_36_0);
  if (ord360.indexOf(t.i1) >= ord360.indexOf(t.i2)) fail('tie-break (stable: smaller index first)');

  // orders
  for (const v of VECTORS.orders) {
    const got = generateShuffleOrderFromHash(v.N, generateStrongSeedFromIndices(v.N, v.last));
    if (!eq(got, v.order)) fail(`order N=${v.N} last=${v.last}`);
    // permutation sanity
    if (new Set(got).size !== v.N) fail(`order N=${v.N} last=${v.last} not a permutation`);
  }

  // e2e plain
  {
    const v = VECTORS.e2e_plain;
    const flat = ALPHANUMERIC.flat();
    const plain = encodeHierarchical(v.lat, v.lon, ALPHANUMERIC, v.iterations);
    if (plain !== v.plainCode) fail('e2e_plain encode');
    const obf = applyIndexObfuscation('encode', plain, flat);
    if (obf !== v.obfCode) fail('e2e_plain obfuscate');
    if (obf[obf.length - 1] !== plain[plain.length - 1]) fail('e2e_plain final token must be unchanged');
    if (obf.slice(0, -1) === plain.slice(0, -1)) fail('e2e_plain non-final tokens must be shifted');
    const back = applyIndexObfuscation('decode', obf, flat);
    if (back !== plain) fail('e2e_plain deobfuscate');
    const dec = decodeHierarchical(back, ALPHANUMERIC, v.iterations);
    if (!dec || dec[0] !== v.decodedLat || dec[1] !== v.decodedLon) fail('e2e_plain decode (must be bit-exact)');
  }

  // e2e passphrase: layer-1 grid, not per-level
  {
    const v = VECTORS.e2e_pass;
    const baseFlat = ALPHANUMERIC.flat();
    const l1 = gridPassphraseOrderV1(36, v.pass, '').map(i => baseFlat[i]);
    if (l1.join('') !== v.layer1Flat) fail('e2e_pass layer-1 flat');
    const obf = applyIndexObfuscation('encode', v.chainedPlain, l1);
    if (obf !== v.chainedObf) fail('e2e_pass obfuscate (layer-1 grid)');
    if (applyIndexObfuscation('decode', obf, l1) !== v.chainedPlain) fail('e2e_pass deobfuscate');
    // wrong-grid sentinel: the per-level chained grid produces a DIFFERENT code
    const wrong = gridPassphraseOrderV1(36, v.pass, v.wrongGridChain).map(i => baseFlat[i]);
    const wrongObf = applyIndexObfuscation('encode', v.chainedPlain, wrong);
    if (wrongObf !== v.wrongGridObf) fail('e2e_pass wrong-grid sentinel value');
    if (wrongObf === v.chainedObf) fail('e2e_pass wrong-grid sentinel must DIFFER from the correct code');
  }

  console.log(pass ? 'self-test: PASS (all frozen vectors reproduced)' : 'self-test: FAIL');
  return pass;
}

module.exports = {
  buildIndexSeedString, generateStrongSeedFromIndices, generateShuffleOrderFromHash,
  applyShuffle, tokenizeCode, applyIndexObfuscation,
  encodeHierarchical, decodeHierarchical, gridPassphraseOrderV1, ALPHANUMERIC
};

// ---- CLI ------------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--selftest' || args.length === 0) {
    process.exit(selfTest() ? 0 : 1);
  } else if (args[0] === '--order') {
    // --order N lastIndexFlat  → print the shuffle order
    const N = parseInt(args[1], 10), last = parseInt(args[2], 10);
    console.log(generateShuffleOrderFromHash(N, generateStrongSeedFromIndices(N, last)).join(','));
  } else {
    console.error('usage: --selftest | --order N lastIndexFlat');
    process.exit(2);
  }
}
