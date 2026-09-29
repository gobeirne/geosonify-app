#!/usr/bin/env node
/**
 * healpix-obf-v2-reference.js — clean-room reference for
 *   healpix-obf-v2        (HEALPIX-OBF-V2.md §2)
 *   healpix-bip39-pass-v1 (HEALPIX-BIP39-V1-SPEC.md §7)
 *   healpix-bip39-obf-v1  (HEALPIX-OBF-V2.md §3)
 * written from those documents only. It does NOT load js/lib/geosonify-healpix.js
 * or js/lib/geosonify-hpwords.js; the only shared code is other FROZEN oracles
 * (grid-passphrase v1 shuffle, healpix-pass-v1 permutation + serializers) and the
 * pinned word-list DATA, whose SHA-256 is checked here.
 *
 *   node spec/healpix-obf-v2-reference.js --selftest
 */
'use strict';
const path = require('path');
const crypto = require('crypto');
const { gridPassphraseOrderV1: GPV1 } = require('./grid-passphrase-v1-reference.js');
const HP1 = require('./healpix-pass-v1-reference.js');          // frozen: permutePath + serializers
const WL = require(path.join(__dirname, '..', 'js', 'lib', 'bip39-official-wordlists.js'));

const P = 'geosonify-public-obfuscation';

// ── healpix-obf-v2 (§2) — tokens [face, d1…dk], sizes 12,4,…,4 ────────────────
function obfV2Encode(f, digits) {
  const inp = [f, ...digits], size = [12, ...digits.map(() => 4)], out = inp.slice();
  for (let i = inp.length - 2; i >= 0; i--) {
    const order = GPV1(size[i], P, 'healpix-obf-v2:' + inp.slice(i + 1).join(','));
    out[i] = order.indexOf(inp[i]);
  }
  return { f: out[0], digits: out.slice(1) };
}
function obfV2Decode(f, digits) {
  const disp = [f, ...digits], size = [12, ...digits.map(() => 4)], inp = disp.slice();
  for (let i = disp.length - 2; i >= 0; i--) {
    const order = GPV1(size[i], P, 'healpix-obf-v2:' + inp.slice(i + 1).join(','));
    inp[i] = order[disp[i]];
  }
  return { f: inp[0], digits: inp.slice(1) };
}
// pipeline: true path → passphrase (healpix-pass-v1 permutation, frozen) → obf-v2 → serialize
function hpEncode(scheme, f, digits, pass) {
  let p = { f, digits };
  if (pass) p = HP1.permutePath(p.f, p.digits, pass, HP1.shuffleFn);
  p = obfV2Encode(p.f, p.digits);
  return scheme === 'hphex' ? HP1.serHex(p.f, p.digits)
       : scheme === 'hpquad' ? HP1.serQuad(p.f, p.digits)
       : HP1.ser64(p.f, p.digits);
}
function hpDecode(scheme, code, order, pass) {
  const d = scheme === 'hphex' ? HP1.deserHex(code, order)
          : scheme === 'hpquad' ? HP1.deserQuad(code) : HP1.deser64(code, order);
  let p = obfV2Decode(d.f, d.digits);
  if (pass) p = HP1.unpermutePath(p.f, p.digits, pass, HP1.shuffleFn);
  return p;
}

// ── HEALPix BIP39 words ────────────────────────────────────────────────────────
// Bitstream (spec §2): 4-bit face | 2 bits per level (y then x), first 11N bits.
function indicesFromPath(f, digits, n) {
  let bits = f.toString(2).padStart(4, '0') + digits.map(d => d.toString(2).padStart(2, '0')).join('');
  bits = bits.slice(0, 11 * n);
  if (bits.length !== 11 * n) throw new Error('path too short');
  const out = [];
  for (let i = 0; i < n; i++) out.push(parseInt(bits.slice(11 * i, 11 * i + 11), 2));
  return out;
}
const slot = i => (i === 0 ? 1536 : 2048);
// healpix-bip39-pass-v1 (spec §7): chain = "healpix-bip39-pass-v1:" + TRUE preceding indices
function passEncode(tru, pass) {
  return tru.map((x, i) => GPV1(slot(i), pass, 'healpix-bip39-pass-v1:' + tru.slice(0, i).join(',')).indexOf(x));
}
function passDecode(disp, pass) {
  const tru = [];
  for (let i = 0; i < disp.length; i++) tru.push(GPV1(slot(i), pass, 'healpix-bip39-pass-v1:' + tru.join(','))[disp[i]]);
  return tru;
}
// healpix-bip39-obf-v1 (OBF §3): chain = "healpix-bip39-obf-v1:" + input indices AFTER i
function wObfEncode(inp) {
  const out = inp.slice();
  for (let i = inp.length - 2; i >= 0; i--)
    out[i] = GPV1(slot(i), P, 'healpix-bip39-obf-v1:' + inp.slice(i + 1).join(',')).indexOf(inp[i]);
  return out;
}
function wObfDecode(disp) {
  const inp = disp.slice();
  for (let i = disp.length - 2; i >= 0; i--)
    inp[i] = GPV1(slot(i), P, 'healpix-bip39-obf-v1:' + inp.slice(i + 1).join(','))[disp[i]];
  return inp;
}
// Checksum (spec §5)
const W = [1, 140, 819, 343, 884, 825, 620, 515];
function crc32c(str) {
  let c = 0xFFFFFFFF;
  for (const b of Buffer.from(str, 'utf8')) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0x82F63B78 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const D = crc32c('healpix-bip39-v1') % 997;
const checksum = idx => String((D + 101 * idx.length + idx.reduce((s, x, i) => s + W[i] * x, 0)) % 997).padStart(3, '0');
function wordsCode(idx) {
  const L = WL.lists.english;
  return idx.map(i => L[i]).join('-') + '.' + checksum(idx);
}
function wordsEncode(tru, { pass, obf } = {}) {
  let d = tru.slice();
  if (pass) d = passEncode(d, pass);
  if (obf) d = wObfEncode(d);
  return d;
}
function wordsDecode(disp, { pass, obf } = {}) {
  let t = disp.slice();
  if (obf) t = wObfDecode(t);
  if (pass) t = passDecode(t, pass);
  return t;
}

// ── self-test: every published vector ─────────────────────────────────────────
function selfTest() {
  let fails = 0;
  const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
  const english = WL.lists.english;
  ok(crypto.createHash('sha256').update(english.join('\n') + '\n', 'utf8').digest('hex') === WL.sha256.english,
     'English list matches its pinned SHA-256');
  ok(D === 120 && crc32c('123456789') === 0xE3069283, 'CRC32C check value, D = 120');

  // healpix-obf-v2 vectors (OBF §2): true path f=9, digits 1,1,1,2,0,2,1,1,0,0 (order 10)
  const f10 = 9, d10 = [1, 1, 1, 2, 0, 2, 1, 1, 0, 0];
  const V = { hphex: ['8A7958', 'B7E9F6'], hpquad: ['f8.2213211120', 'f11.1332213312'], hp64: ['8p5WA', 'Bfp9g'] };
  for (const [sc, [plainObf, passObf]] of Object.entries(V)) {
    const a = hpEncode(sc, f10, d10, null), b = hpEncode(sc, f10, d10, 'Back Bay');
    ok(a === plainObf, `${sc} obf-v2 = ${plainObf} (got ${a})`);
    ok(b === passObf, `${sc} obf-v2 + passphrase "Back Bay" = ${passObf} (got ${b})`);
    const back = hpDecode(sc, b, 10, 'Back Bay');
    ok(back.f === f10 && back.digits.join('') === d10.join(''), `${sc} decodes back to the true path`);
  }
  // Office and the neighbouring pair (order 20)
  const off = HP1.deserHex('95625281C9E', 20);
  ok(hpEncode('hphex', off.f, off.digits, null) === 'A845ACC2A1E', 'office order 20 → A845ACC2A1E');
  for (const [plain, want] of [['956250B0092', '4B882919386'], ['956250B0090', '4E4A16801D8']]) {
    const p = HP1.deserHex(plain, 20);
    ok(hpEncode('hphex', p.f, p.digits, null) === want, `${plain} → ${want}`);
  }
  // Frozen v1 obfuscation still gives its own (different) answer — versions are distinct
  const v1 = HP1.obfuscatePath(off.f, off.digits, 'encode');
  ok(HP1.serHex(v1.f, v1.digits) !== 'A845ACC2A1E', 'v1 and v2 differ');

  // Words (office)
  const tru = indicesFromPath(off.f, off.digits, 4);
  ok(tru.join(',') === '1195,148,1283,1182', 'office indices 1195,148,1283,1182');
  ok(wordsCode(tru) === 'nice-barely-parrot-need.091', 'plain: nice-barely-parrot-need.091');
  const cases = [
    [{ pass: 'correct horse battery staple' }, 'injury-moon-combine-cabin.521'],
    [{ obf: true }, 'best-permit-knee-need.198'],
    [{ pass: 'correct horse battery staple', obf: true }, 'match-high-puzzle-cabin.995'],
  ];
  for (const [opt, want] of cases) {
    const disp = wordsEncode(tru, opt);
    ok(wordsCode(disp) === want, `${JSON.stringify(opt)} → ${want} (got ${wordsCode(disp)})`);
    ok(wordsDecode(disp, opt).join(',') === tru.join(','), `${JSON.stringify(opt)} decodes back`);
    if (opt.obf) ok(disp[3] === (opt.pass ? passEncode(tru, opt.pass)[3] : tru[3]), 'last word unchanged by obfuscation');
    ok(disp[0] < 1536, 'displayed first word stays a face word');
  }
  console.log(fails ? `\nself-test: ${fails} FAILURE(S)` : '\nself-test: PASS (all published vectors reproduced independently)');
  return fails === 0;
}

module.exports = { obfV2Encode, obfV2Decode, hpEncode, hpDecode, indicesFromPath,
  passEncode, passDecode, wObfEncode, wObfDecode, wordsEncode, wordsDecode, checksum, wordsCode, P };
if (require.main === module) process.exit(selfTest() ? 0 : 1);
