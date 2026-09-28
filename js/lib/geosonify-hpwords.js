/**
 * geosonify-hpwords.js  —  HEALPix addresses encoded with BIP39 wordlists
 * Format id: healpix-bip39-v1   ·   STATUS: BETA (not frozen)
 *
 * WHAT IS STABLE IN THE BETA
 *   The spatial meaning of the words. N words = the first 11N bits of
 *   [4-bit face | root-first NESTED path, 2 bits/level, digit = (yBit<<1)|xBit],
 *   read as N big-endian 11-bit indices into an OFFICIAL 2048-word BIP39 list.
 *   That is pure HEALPix arithmetic and is not expected to change.
 *
 * WHAT MAY CHANGE BEFORE FREEZE
 *   The three checksum digits. Beta candidate:
 *     C = (D + 101·N + Σ w_i·x_i) mod 997,  D = CRC32C("healpix-bip39-v1") mod 997 = 120
 *     w = [1, 140, 819, 343, 884, 825, 620, 515]   (supports 1–8 words)
 *   Running checksum after k words = C over those k words (N = k).
 *   Values 997–999 never occur. The checksum DETECTS errors; it never corrects.
 *
 * Geometry
 *   Even N → canonical HEALPix cell at order (11N−4)/2.
 *   Odd  N → the final bit is the yBit of the next level: an exact equal-area
 *            half of the parent = the two children {2b, 2b+1}. It is NEVER padded
 *            to a single child. Drawn by tracing the parent with nw ∈ [b/2,(b+1)/2]
 *            (verified: pixcoord ne = x = digit bit 0, nw = y = digit bit 1).
 *
 * Passphrase (beta, healpix-bip39-pass-v1): each WORD INDEX is permuted with the
 * FROZEN grid-passphrase v1 shuffle, used unchanged as a primitive —
 *   slot 0: 1×1536 row (valid first words stay valid; faces C–F stay invalid),
 *   slot i: 1×2048 row,
 *   chain  = "healpix-bip39-pass-v1:" + comma-joined TRUE preceding indices.
 * The tagged chain domain-separates this use from legacy grid-pass and
 * healpix-pass-v1 (whose chains are digits/commas only, so can never collide).
 * Because each slot depends only on the TRUE prefix, displayed prefixes stay
 * consistent (drop a word → the displayed parent). The checksum is computed over
 * the DISPLAYED indices, so anyone can check a transcription without the
 * passphrase — and therefore a valid checksum does NOT confirm the passphrase.
 *
 * Not in the beta (deliberately): obfuscation, URL parameter, spoken substitute
 * profiles. The first word index must be < 1536 (faces 0–B).
 *
 * Depends on: HealpixGrids (geosonify-healpix.js), BIP39_OFFICIAL_WORDLISTS.
 * Node self-test:  node geosonify-hpwords.js --selftest
 */
const HealpixWords = (function () {
  'use strict';

  const FORMAT_ID = 'healpix-bip39-v1';
  const MIN_WORDS = 1, MAX_WORDS = 8, DEFAULT_WORDS = 4;
  const WEIGHTS = [1, 140, 819, 343, 884, 825, 620, 515];
  const P = 997;
  const FIRST_WORD_LIMIT = 1536;                    // 12 faces × 128

  // Language key → card suffix, display tag, delimiters (mirror the legacy cards).
  const LANGS = {
    english:             { tag: 'EN',   delim: '-',      csDelim: '.' },
    spanish:             { tag: 'ES',   delim: '-',      csDelim: '.' },
    french:              { tag: 'FR',   delim: '-',      csDelim: '.' },
    italian:             { tag: 'IT',   delim: '-',      csDelim: '.' },
    portuguese:          { tag: 'PT',   delim: '-',      csDelim: '.' },
    czech:               { tag: 'CS',   delim: '-',      csDelim: '.' },
    japanese:            { tag: 'JA',   delim: '\u30FB', csDelim: '.' },
    korean:              { tag: 'KO',   delim: '-',      csDelim: '.' },
    chinese_simplified:  { tag: 'ZH-S', delim: '\u3001', csDelim: '\u3002' },
    chinese_traditional: { tag: 'ZH-T', delim: '\u3001', csDelim: '\u3002' }
  };

  // ── dependencies (bare-identifier probes: these are top-level consts) ──
  function HG() {
    if (typeof HealpixGrids !== 'undefined') return HealpixGrids;
    if (typeof globalThis !== 'undefined' && globalThis.HealpixGrids) return globalThis.HealpixGrids;
    return null;
  }
  function WL() {
    if (typeof BIP39_OFFICIAL_WORDLISTS !== 'undefined') return BIP39_OFFICIAL_WORDLISTS;
    if (typeof globalThis !== 'undefined' && globalThis.BIP39_OFFICIAL_WORDLISTS) return globalThis.BIP39_OFFICIAL_WORDLISTS;
    return null;
  }

  // ── CRC32C (Castagnoli, reflected 0x82F63B78, init/xorout 0xFFFFFFFF), UTF-8 ──
  const CRC_T = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0x82F63B78 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32cUtf8(str) {
    const bytes = [];                                // manual UTF-8 (no TextEncoder dependency)
    for (const ch of String(str)) {
      const c = ch.codePointAt(0);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xC0 | c >> 6, 0x80 | c & 63);
      else if (c < 0x10000) bytes.push(0xE0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
      else bytes.push(0xF0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    }
    let c = 0xFFFFFFFF;
    for (const b of bytes) c = CRC_T[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const DOMAIN = crc32cUtf8(FORMAT_ID) % P;        // = 120 (asserted in self-test)

  // ── checksum ──────────────────────────────────────────────
  function checksumValue(indices) {
    const n = indices.length;
    if (n < MIN_WORDS || n > MAX_WORDS) return null;
    let s = DOMAIN + 101 * n;
    for (let i = 0; i < n; i++) s += WEIGHTS[i] * indices[i];
    return s % P;
  }
  const fmt3 = v => (v == null ? null : String(v).padStart(3, '0'));
  function checksum(indices) { return fmt3(checksumValue(indices)); }
  function runningChecksums(indices) {
    const out = [];
    for (let k = 1; k <= indices.length; k++) out.push(checksum(indices.slice(0, k)));
    return out;
  }
  function modInv(a) {                               // Fermat: a^(p-2) mod p
    let r = 1, b = ((a % P) + P) % P, e = P - 2;
    while (e > 0) { if (e & 1) r = (r * b) % P; b = (b * b) % P; e >>= 1; }
    return r;
  }
  // All indices that could replace `slot` and satisfy a stated final checksum.
  // Algebraic, so at most three candidates (r, r+997, r+1994). Suggestions only:
  // the UI must ask the human to confirm — never auto-apply.
  function candidatesForSlot(indices, slot, targetCs) {
    const n = indices.length, t = parseInt(targetCs, 10);
    if (!(t >= 0 && t < P) || slot < 0 || slot >= n) return [];
    let rest = DOMAIN + 101 * n;
    for (let i = 0; i < n; i++) if (i !== slot) rest += WEIGHTS[i] * indices[i];
    const r = ((((t - rest) % P) + P) % P) * modInv(WEIGHTS[slot]) % P;
    const out = [];
    for (let x = r; x < 2048; x += P) {
      if (x === indices[slot]) continue;
      if (slot === 0 && x >= FIRST_WORD_LIMIT) continue;
      out.push(x);
    }
    return out;
  }

  // ── bitstream ─────────────────────────────────────────────
  function orderForWords(n) { return Math.ceil((11 * n - 4) / 2); }
  function effectiveOrder(n) { return (11 * n - 4) / 2; }
  function orderLabel(n) {
    const e = effectiveOrder(n);
    return Number.isInteger(e) ? `order ${e}` : `order ${Math.floor(e)}\u00BD`;
  }

  // {f, digits} (root-first, ≥ needed depth) → N indices
  function pathToIndices(f, digits, n) {
    const bits = 11 * n;
    let v = BigInt(f), have = 4;
    for (let i = 0; have < bits; i++) {
      v = (v << 2n) | BigInt(digits[i]);
      have += 2;
    }
    if (have > bits) v >>= BigInt(have - bits);    // drop the trailing xBit (odd N)
    const out = new Array(n);
    for (let i = n - 1; i >= 0; i--) { out[i] = Number(v & 2047n); v >>= 11n; }
    return out;
  }

  // N indices → {f, digits (complete levels), half (0|1|null), order (complete), n}
  function indicesToPath(indices) {
    const n = indices.length;
    if (n < MIN_WORDS || n > MAX_WORDS) return null;
    let v = 0n;
    for (const x of indices) {
      if (!(Number.isInteger(x) && x >= 0 && x < 2048)) return null;
      v = (v << 11n) | BigInt(x);
    }
    const total = 11 * n, pathBits = total - 4;
    const f = Number(v >> BigInt(pathBits));
    if (f > 11) return null;                         // first index ≥ 1536
    const full = pathBits >> 1, half = pathBits & 1;
    const digits = new Array(full);
    let rest = v & ((1n << BigInt(pathBits)) - 1n);
    const halfBit = half ? Number(rest & 1n) : null;
    if (half) rest >>= 1n;
    for (let i = full - 1; i >= 0; i--) { digits[i] = Number(rest & 3n); rest >>= 2n; }
    return { f, digits, half: halfBit, order: full, n };
  }

  function encodeIndices(lat, lon, n) {
    const H = HG(); if (!H) return null;
    n = clampWords(n);
    const k = orderForWords(n);
    const { f, digits } = H.nestPath(H.nestIndex(lat, lon, k), k);
    return pathToIndices(f, digits, n);
  }

  // ── words & text ─────────────────────────────────────────
  function clampWords(n) { n = Math.round(+n || DEFAULT_WORDS); return Math.max(MIN_WORDS, Math.min(MAX_WORDS, n)); }
  function list(lang) { const w = WL(); return w && w.lists[lang] ? w.lists[lang] : null; }
  // Matching key: compatibility-decompose, drop Latin combining accents, lowercase.
  // Verified unique for all ten official lists (self-test re-checks).
  const keyOf = s => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const keyCache = {};
  function keyIndex(lang) {
    if (keyCache[lang]) return keyCache[lang];
    const L = list(lang); if (!L) return null;
    const map = new Map(), keys = L.map(keyOf);
    keys.forEach((k, i) => map.set(k, i));
    return (keyCache[lang] = { map, keys });
  }
  function displayWord(lang, idx) { const L = list(lang); return L ? L[idx].normalize('NFC') : '?'; }

  // One token → index, or -1. Exact key match, else a UNIQUE prefix of ≥ 4 key chars.
  function wordToIndex(lang, token) {
    const K = keyIndex(lang); if (!K) return -1;
    const k = keyOf(token);
    if (!k) return -1;
    if (K.map.has(k)) return K.map.get(k);
    if (k.length >= 4) {
      let hit = -1;
      for (let i = 0; i < 2048; i++) {
        if (K.keys[i].startsWith(k)) { if (hit >= 0) return -1; hit = i; }
      }
      return hit;
    }
    return -1;
  }
  // Suggestions for the entry UI (prefix match on keys).
  function suggest(lang, typed, slot, max) {
    const K = keyIndex(lang); if (!K || !typed) return [];
    const k = keyOf(typed), out = [];
    for (let i = 0; i < 2048 && out.length < (max || 8); i++) {
      if (slot === 0 && i >= FIRST_WORD_LIMIT) break;
      if (K.keys[i].startsWith(k)) out.push(i);
    }
    return out;
  }

  function format(lang, indices) {
    const cfg = LANGS[lang] || LANGS.english;
    return indices.map(i => displayWord(lang, i)).join(cfg.delim) + cfg.csDelim + checksum(indices);
  }

  // ── passphrase layer (healpix-bip39-pass-v1, beta) ──────
  const PASS_TAG = 'healpix-bip39-pass-v1';
  const rows = {};
  const rowOf = N => rows[N] || (rows[N] = [Array.from({ length: N }, (_, i) => i)]);
  const permCache = new Map();
  const slotSize = i => (i === 0 ? FIRST_WORD_LIMIT : 2048);
  function perm(opt, i, truePrefix) {
    const N = slotSize(i);
    const chain = PASS_TAG + ':' + truePrefix.join(',');
    const key = opt.pass + '\u0000' + N + '\u0000' + chain;
    let p = permCache.get(key);
    if (!p) {
      const order = opt.shuffleFn(rowOf(N), opt.pass, chain).order;   // order[displayed] = true
      const inv = new Array(N);
      for (let d = 0; d < N; d++) inv[order[d]] = d;
      p = { order, inv };
      if (permCache.size > 256) permCache.clear();
      permCache.set(key, p);
    }
    return p;
  }
  const active = opt => !!(opt && opt.pass && opt.shuffleFn);
  // true indices → displayed indices
  function protect(trueIdx, opt) {
    if (!active(opt)) return trueIdx.slice();
    return trueIdx.map((x, i) => perm(opt, i, trueIdx.slice(0, i)).inv[x]);
  }
  // displayed indices → true indices
  function unprotect(disp, opt) {
    if (!active(opt)) return disp.slice();
    const out = [];
    for (let i = 0; i < disp.length; i++) out.push(perm(opt, i, out).order[disp[i]]);
    return out;
  }

  function encode(lat, lon, n, lang, opt) {
    const idx = encodeIndices(lat, lon, n);
    return idx ? format(lang, protect(idx, opt)) : '';
  }

  // Parse user text. Accepts any common delimiter; checksum optional.
  // → { indices, checksumGiven, checksumOk (true|false|null), error }
  function parse(str, lang) {
    if (!str) return { error: 'empty' };
    let s = String(str).normalize('NFC').trim();
    let given = null;
    const m = s.match(/[.\u3002\uFF0E]\s*(\d{1,3})\s*$/);
    if (m) { given = m[1].padStart(3, '0'); s = s.slice(0, m.index); }
    const toks = s.split(/[\s\-_,\u3001\u30FB\u00B7\u3000/|.\u3002]+/u).filter(Boolean);
    if (toks.length < MIN_WORDS || toks.length > MAX_WORDS) return { error: `need ${MIN_WORDS}–${MAX_WORDS} words` };
    const indices = [];
    for (const t of toks) {
      const i = wordToIndex(lang, t);
      if (i < 0) return { error: `not in the ${lang} list: "${t}"` };
      indices.push(i);
    }
    if (indices[0] >= FIRST_WORD_LIMIT) return { indices, error: 'first word is not a valid HEALPix face' };
    const cs = checksum(indices);
    return { indices, checksumGiven: given, checksum: cs, checksumOk: given == null ? null : given === cs };
  }

  // ── geometry ─────────────────────────────────────────────
  function ll(v) {
    const lat = 90 - Math.acos(Math.max(-1, Math.min(1, v[2]))) * 180 / Math.PI;
    let lon = Math.atan2(v[1], v[0]) * 180 / Math.PI;
    lon = ((lon + 180) % 360 + 360) % 360 - 180;
    return [lat, lon];
  }
  function unwrap(pts) {
    for (let i = 1; i < pts.length; i++) {
      const d = pts[i][1] - pts[i - 1][1];
      if (d > 180) pts[i][1] -= 360; else if (d < -180) pts[i][1] += 360;
    }
    return pts;
  }
  // Region → { ipix (complete parent or cell), order, nwLo, nwHi } in parent-local coords
  function regionOf(indices) {
    const H = HG(); const p = indicesToPath(indices);
    if (!H || !p) return null;
    const ipix = H.pathToNest(p.f, p.digits);
    const nwLo = p.half == null ? 0 : p.half / 2, nwHi = p.half == null ? 1 : (p.half + 1) / 2;
    return { ipix, order: p.order, nwLo, nwHi, path: p };
  }
  // Closed [lat,lon] ring tracing the TRUE curved boundary (full cell, or half cell).
  function ringForIndices(indices, step) {
    const H = HG(); const r = regionOf(indices); if (!r) return null;
    step = step || 16;
    const ns = H._core.order2nside(r.order), pc = H._core.pixcoord2vec_nest;
    const { nwLo, nwHi } = r, pts = [];
    const edges = [[[0, nwLo], [1, nwLo]], [[1, nwLo], [1, nwHi]], [[1, nwHi], [0, nwHi]], [[0, nwHi], [0, nwLo]]];
    for (const [[a0, b0], [a1, b1]] of edges) {
      for (let s = 0; s < step; s++) {
        const t = s / step;
        pts.push(ll(pc(ns, r.ipix, a0 + (a1 - a0) * t, b0 + (b1 - b0) * t)));
      }
    }
    pts.push(pts[0].slice());
    return unwrap(pts);
  }
  function centreForIndices(indices) {
    const H = HG(); const r = regionOf(indices); if (!r) return null;
    const ns = H._core.order2nside(r.order);
    return ll(H._core.pixcoord2vec_nest(ns, r.ipix, 0.5, (r.nwLo + r.nwHi) / 2));
  }
  function ringAt(lat, lon, n, step) { const i = encodeIndices(lat, lon, n); return i ? ringForIndices(i, step) : null; }

  // Two-cell / one-cell NUNIQ-style description for exports & the info box.
  function cellsForIndices(indices) {
    const r = regionOf(indices); if (!r) return null;
    if (r.path.half == null) return [{ order: r.order, ipix: r.ipix }];
    const b = BigInt(r.path.half);
    return [{ order: r.order + 1, ipix: r.ipix * 4n + 2n * b }, { order: r.order + 1, ipix: r.ipix * 4n + 2n * b + 1n }];
  }

  // Square-equivalent width in metres, consistent with the app's HEALPix cards.
  function cellMetres(n) {
    const H = HG(); n = clampWords(n);
    const e = effectiveOrder(n), k = Math.floor(e);
    const a = H ? H.cellAreaM2(k) : NaN;
    const s = Math.sqrt(Number.isInteger(e) ? a : a / 2);
    return { w: s, h: s };
  }
  function cellArcsec(n) {
    const p = 11 * clampWords(n) - 4;
    return Math.sqrt(Math.PI / 3) * Math.pow(2, -p / 2) * 180 / Math.PI * 3600;
  }
  // Is any of this depth beyond the double-precision projection's exact range?
  function beyondMeasured(n) { const H = HG(); return effectiveOrder(clampWords(n)) > (H && H.PROJECTION_EXACT_ORDER || 26); }

  // ── card definitions ────────────────────────────────────
  function cardKey(lang) { return 'hpbip39' + lang.replace('_', ''); }
  function cardDefs() {
    const defs = {};
    for (const [lang, cfg] of Object.entries(LANGS)) {
      defs[cardKey(lang)] = {
        name: `HEALPix BIP39 ${cfg.tag}`,
        hpwords: lang,
        grid: null,
        defaultIterations: DEFAULT_WORDS,
        minIterations: MIN_WORDS,
        maxIterations: MAX_WORDS,
        delimiter: cfg.delim,
        checksumDelimiter: cfg.csDelim,
        link: 'https://github.com/bitcoin/bips/blob/master/bip-0039/' + lang + '.txt',
        isEmoji: false,
        beta: true,
        curvedCell: true
      };
    }
    return defs;
  }

  // ── self-test (Node) ─────────────────────────────────────
  function selftest(log) {
    log = log || console.log;
    let fails = 0;
    const ok = (c, m) => { if (!c) { fails++; log('FAIL ' + m); } };
    const H = HG(), W = WL();
    ok(H && W, 'dependencies loaded');
    ok(DOMAIN === 120 && crc32cUtf8('123456789') === 0xE3069283, 'CRC32C check value and D = 120');

    // Wordlists: hashes, size, uniqueness of matching keys
    if (typeof require === 'function') {
      const crypto = require('crypto');
      for (const lang of Object.keys(LANGS)) {
        const L = W.lists[lang];
        ok(L.length === 2048, lang + ' has 2048');
        const h = crypto.createHash('sha256').update(L.join('\n') + '\n', 'utf8').digest('hex');
        ok(h === W.sha256[lang], lang + ' sha256 matches pinned official file');
        ok(new Set(L.map(keyOf)).size === 2048, lang + ' matching keys unique');
      }
    }

    // Frozen-candidate office vectors
    const V = [['95625281C9B', [1195, 148, 1283, 1179], 'nice-barely-parrot-nature.059'],
               ['95625281C9E', [1195, 148, 1283, 1182], 'nice-barely-parrot-need.091']];
    for (const [hex, idx, words] of V) {
      const p = H._ser.deserHex(hex, 20);
      const got = pathToIndices(p.f, p.digits, 4);
      ok(JSON.stringify(got) === JSON.stringify(idx), 'indices ' + hex);
      ok(format('english', got) === words, 'words+checksum ' + hex + ' → ' + format('english', got));
      const back = indicesToPath(got);
      ok(back && back.f === p.f && back.digits.join('') === p.digits.join('') && back.half === null, 'decode ' + hex);
      const pr = parse(words, 'english');
      ok(pr.checksumOk === true && JSON.stringify(pr.indices) === JSON.stringify(idx), 'parse ' + words);
      const c = H.nestCentre(H.pathToNest(p.f, p.digits), 20);
      ok(encode(c[0], c[1], 4, 'english') === words, 'encode from centre ' + hex);
    }
    // 1- and 3-word half cells of the office
    const office = [1195, 148, 1283, 1182];
    const c1 = cellsForIndices(office.slice(0, 1)), c3 = cellsForIndices(office.slice(0, 3));
    const hx = (o, ip) => { const q = H.nestPath(ip, o); return H._ser.serHex(q.f, q.digits) + '@' + o; };
    ok(c1.map(c => hx(c.order, c.ipix)).join(' ') === '956@4 957@4', '1-word half cell = 956@4 + 957@4');
    ok(c3.map(c => hx(c.order, c.ipix)).join(' ') === '956252818@15 95625281C@15', '3-word half cell = 956252818@15 + 95625281C@15');

    // Round trips across all faces, all word counts, random points; prefix containment
    let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let t = 0; t < 600; t++) {
      const lat = Math.asin(2 * rnd() - 1) * 180 / Math.PI, lon = rnd() * 360 - 180;
      const full = encodeIndices(lat, lon, 8);
      for (let n = 1; n <= 8; n++) {
        const idx = encodeIndices(lat, lon, n);
        ok(JSON.stringify(idx) === JSON.stringify(full.slice(0, n)), `prefix containment n=${n}`);
        const p = indicesToPath(idx);
        ok(p && p.order === Math.floor(effectiveOrder(n)) && (p.half !== null) === (n % 2 === 1), `path shape n=${n}`);
        ok(JSON.stringify(pathToIndices(p.f, p.half == null ? p.digits : p.digits.concat([p.half * 2]), n)) === JSON.stringify(idx), `bit round trip n=${n}`);
        if (n <= 5) {
          const cen = centreForIndices(idx);
          ok(JSON.stringify(encodeIndices(cen[0], cen[1], n)) === JSON.stringify(idx), `centre re-encodes n=${n}`);
        }
      }
    }
    for (let f = 0; f < 12; f++) {
      const idx = [f * 128, 0, 0, 0], p = indicesToPath(idx);
      ok(p && p.f === f && p.digits.every(d => d === 0), 'face ' + f + ' with leading zero bits');
    }
    ok(indicesToPath([1536, 0, 0, 0]) === null && indicesToPath([2047]) === null, 'faces C–F rejected');
    ok(parse('zoo zoo zoo zoo', 'english').error, 'first word ≥1536 reported');

    // Checksum guarantees (exhaustive where claimed)
    const base = [700, 1500, 3, 2047, 1024, 5, 999, 1];
    for (let n = 1; n <= 8; n++) {
      const v = base.slice(0, n), c = checksumValue(v);
      for (let i = 0; i < n; i++) for (let x = 0; x < 2048; x++) {
        if (x === v[i]) continue;
        const d = x - v[i]; const u = v.slice(); u[i] = x;
        const miss = checksumValue(u) === c;
        ok(miss === (d % 997 === 0), `single substitution n=${n} pos=${i}`);
      }
    }
    let combos = 0, esc = 0;
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++)
      for (let a = -15; a <= 15; a++) for (let b = -15; b <= 15; b++) {
        if (!a || !b) continue; combos++;
        if (((WEIGHTS[i] * a + WEIGHTS[j] * b) % P + P) % P === 0) esc++;
      }
    ok(combos === 25200 && esc === 0, 'bounded double errors: 25,200 combos, 0 escapes');
    ok(((WEIGHTS[1] * -16 + WEIGHTS[4] * -11) % P) === 0, 'documented boundary collision (−16, −11)');
    // Candidates for a slot reproduce the truth
    const cs = checksum(office);
    const wrong = office.slice(); wrong[2] = 77;
    ok(candidatesForSlot(wrong, 2, cs).includes(1283), 'slot candidates include the true word');
    ok(runningChecksums(office).length === 4 && runningChecksums(office)[3] === cs, 'running checksum final = checksum');

    // Cross-language: same indices → same checksum; parse round trips in every list
    for (const lang of Object.keys(LANGS)) {
      const s = format(lang, office), pr = parse(s, lang);
      ok(!pr.error && pr.checksumOk === true && JSON.stringify(pr.indices) === JSON.stringify(office), 'round trip ' + lang + ': ' + s);
      ok(s.endsWith(cs), 'checksum language-independent ' + lang);
    }
    ok(JSON.stringify(parse('NICE barely parr NATURE.59', 'english').indices) === JSON.stringify([1195, 148, 1283, 1179]), 'loose input (case, prefix, bare checksum)');

    // Half cell ring is half the area of the parent ring (spherical polygon area)
    const area = ring => { let s = 0; for (let i = 0; i < ring.length - 1; i++) {
      const [la1, lo1] = ring[i], [la2, lo2] = ring[i + 1];
      s += (lo2 - lo1) * Math.PI / 180 * (2 + Math.sin(la1 * Math.PI / 180) + Math.sin(la2 * Math.PI / 180)); }
      return Math.abs(s / 2); };
    const r2 = ringForIndices(office.slice(0, 2), 40), r3 = ringForIndices(office.slice(0, 3), 40);
    const H2 = { order: 14 }; void H2;
    const full14 = H.cellCorners('hphex', ...centreForIndices(office.slice(0, 3)), 14, 40);
    ok(Math.abs(area(r3) / area(full14) - 0.5) < 1e-3, 'odd-word ring = half its parent cell (area ratio ' + (area(r3) / area(full14)).toFixed(5) + ')');
    ok(r2 && r2.length > 10, 'even-word ring drawn');

    // Passphrase layer (needs the frozen-shuffle oracle as shuffleFn)
    const oracle = selftest._oracle;
    if (oracle) {
      const shuffleFn = (grid, pass, chain) => ({ order: oracle.gridPassphraseOrderV1(grid.flat().length, pass, chain) });
      const opt = { pass: 'correct horse battery staple', shuffleFn };
      let s2 = 999;
      const rnd2 = () => ((s2 = (s2 * 1103515245 + 12345) >>> 0) / 4294967296);
      for (let t = 0; t < 40; t++) {
        const lat = Math.asin(2 * rnd2() - 1) * 180 / Math.PI, lon = rnd2() * 360 - 180;
        const tru = encodeIndices(lat, lon, 8), disp = protect(tru, opt);
        ok(disp[0] < FIRST_WORD_LIMIT, 'protected first word stays a valid face word');
        ok(JSON.stringify(unprotect(disp, opt)) === JSON.stringify(tru), 'pass round trip');
        for (let n = 1; n <= 8; n++) ok(JSON.stringify(protect(tru.slice(0, n), opt)) === JSON.stringify(disp.slice(0, n)), 'protected prefix consistency n=' + n);
      }
      const dOffice = protect(office, opt);
      ok(JSON.stringify(dOffice) !== JSON.stringify(office), 'passphrase changes the words');
      ok(JSON.stringify(protect(office, { pass: 'Ma\u0304ori', shuffleFn })) ===
         JSON.stringify(protect(office, { pass: 'M\u0101ori', shuffleFn })), 'NFC/NFD passphrases derive identically');
      ok(JSON.stringify(protect(office, { pass: 'other', shuffleFn })) !== JSON.stringify(dOffice), 'different passphrase → different words');
      log('  pass vector (beta, not frozen): "correct horse battery staple" office → ' + format('english', dOffice));
    } else {
      log('  SKIP passphrase tests (grid-passphrase-v1-reference.js not found)');
    }

    log(fails ? `hpwords selftest: ${fails} FAILURE(S)` : 'hpwords selftest: ALL PASS');
    return fails === 0;
  }

  return {
    FORMAT_ID, MIN_WORDS, MAX_WORDS, DEFAULT_WORDS, WEIGHTS, DOMAIN, FIRST_WORD_LIMIT, LANGS,
    checksum, checksumValue, runningChecksums, candidatesForSlot,
    orderForWords, effectiveOrder, orderLabel,
    pathToIndices, indicesToPath, encodeIndices, encode, format, parse, protect, unprotect, PASS_TAG,
    wordToIndex, displayWord, suggest, keyOf, list,
    ringForIndices, ringAt, centreForIndices, cellsForIndices,
    cellMetres, cellArcsec, beyondMeasured, clampWords,
    cardDefs, cardKey, selftest, _crc32cUtf8: crc32cUtf8
  };
})();

if (typeof window !== 'undefined') window.HealpixWords = HealpixWords;
if (typeof module !== 'undefined' && module.exports) module.exports = HealpixWords;

if (typeof require === 'function' && typeof module !== 'undefined' && require.main === module &&
    process.argv.includes('--selftest')) {
  const path = require('path');
  globalThis.HealpixGrids = require(path.join(__dirname, 'geosonify-healpix.js'));
  globalThis.BIP39_OFFICIAL_WORDLISTS = require(path.join(__dirname, 'bip39-official-wordlists.js'));
  for (const c of ['../../spec/grid-passphrase-v1-reference.js', 'grid-passphrase-v1-reference.js']) {
    try { HealpixWords.selftest._oracle = require(path.join(__dirname, c)); break; } catch (e) {}
  }
  process.exit(HealpixWords.selftest() ? 0 : 1);
}
