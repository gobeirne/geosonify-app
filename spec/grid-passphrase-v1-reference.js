#!/usr/bin/env node
/*
 * grid-passphrase-v1-reference.js
 *
 * FROZEN reference implementation of Geosonify's grid-passphrase keyed permutation,
 * format v1. Deliberately boring and dependency-free: it uses only Node's built-in
 * SHA3-512 (FIPS 202). Its job is NOT performance — it is to be an executable oracle
 * that future maintainers (or a clean-room re-implementer in any language, decades
 * from now) can check their own code against.
 *
 * Scope: this file specifies the *keyed permutation* layer only — the step that
 * turns (grid size N, passphrase, chain) into a permutation of the N grid cells.
 * Composing that permutation with a frozen base grid and the hierarchical
 * lat/lon <-> code subdivision is a separate (also frozen) subsystem; see
 * FROZEN-FORMAT-SPEC.md section on base grids and the end-to-end vectors.
 *
 * THE DERIVATION IS IMMUTABLE. See FROZEN-FORMAT-SPEC.md. Do not change any constant,
 * string, byte order, or the sort. A wrong derivation does not error — it silently
 * decodes to a different, plausible-looking location.
 */
'use strict';
const crypto = require('crypto');

// ---- FROZEN v1 constants -----------------------------------------------------
const PREFIX = 'geosonify-grid-pass-v1|';   // exact: spelling, case, hyphens, trailing '|'
// hash       = SHA3-512 (FIPS 202), 64-byte output
// passphrase = Unicode NFC, then UTF-8
// index      = unsigned 32-bit little-endian
// chain      = decimal grid-cell indices joined with ',', e.g. "" then "3" then "3,17"
// ------------------------------------------------------------------------------

function u32le(n) {
  return Buffer.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}

function sha3_512(buf) {
  return crypto.createHash('sha3-512').update(buf).digest(); // 64-byte Buffer
}

/**
 * Compute the frozen v1 keyed permutation of N grid cells.
 * @param {number} N          number of cells in the base grid (e.g. 36, 256, 2025)
 * @param {string} passphrase the shared passphrase (any Unicode)
 * @param {string} chain      comma-joined decimal indices chosen so far ("" for the first)
 * @returns {number[]} order  order[p] = original cell index now at shuffled position p
 */
function gridPassphraseOrderV1(N, passphrase, chain) {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    // No passphrase => identity permutation (public encoding).
    return Array.from({ length: N }, (_, i) => i);
  }
  const preimage = Buffer.from(PREFIX + passphrase.normalize('NFC') + '|chain:' + chain, 'utf8');
  const keys = new Array(N);
  for (let i = 0; i < N; i++) {
    keys[i] = sha3_512(Buffer.concat([preimage, u32le(i)]));
  }
  const idx = Array.from({ length: N }, (_, i) => i);
  // Total order: lexicographic over the 64 hash bytes (byte 0 first); ties (never,
  // in practice) broken by smaller original index. This makes the result
  // independent of the sort algorithm and of any engine's sort stability.
  idx.sort((a, b) => {
    const c = Buffer.compare(keys[a], keys[b]);
    return c !== 0 ? c : a - b;
  });
  return idx;
}

// The inverse, for decoding: inverse[cellIndex] = shuffled position.
function invertPermutation(order) {
  const inv = new Array(order.length);
  order.forEach((cell, pos) => { inv[cell] = pos; });
  return inv;
}

// ---- Embedded frozen test vectors (must never change) ------------------------
const VECTORS = {
  anchorHashHex:
    '90454924e467af967ed17dee0f09b4aab0d6107f66164f8cf84a50230fa14411' +
    'a8f7cb225b03bcdd385f589c4ead375d187405499a0bbaf9e97508e7736686df',
  orders: [
    { N: 36, pass: 'Back Bay', chain: '',
      order: [21,1,14,10,26,24,20,22,29,7,27,33,34,28,17,4,6,15,0,35,30,18,19,23,32,13,31,12,5,9,8,25,16,2,11,3] },
    { N: 36, pass: 'Patriots', chain: '3,17',
      order: [3,17,34,12,16,7,15,13,31,20,22,33,24,23,0,19,5,18,26,9,10,21,32,27,29,14,1,8,11,6,30,28,35,25,2,4] },
  ],
  // NFC equivalence: each pair must yield identical permutations.
  nfcPairs: [
    { a: '\u00e9',       b: 'e\u0301',       note: 'é  U+00E9  vs  e + U+0301' },
    { a: 'M\u0101ori',   b: 'Ma\u0304ori',   note: 'Māori  U+0101  vs  a + U+0304 (Māori macron)' },
  ],
};

function selfTest() {
  let pass = true;
  const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);

  // anchor: SHA3-512( "geosonify-grid-pass-v1|Back Bay|chain:" || u32le(0) )
  const anchor = sha3_512(Buffer.concat([Buffer.from(PREFIX + 'Back Bay|chain:', 'utf8'), u32le(0)])).toString('hex');
  if (anchor !== VECTORS.anchorHashHex) { pass = false; console.error('FAIL anchor hash'); }

  for (const v of VECTORS.orders) {
    const got = gridPassphraseOrderV1(v.N, v.pass, v.chain);
    if (!eq(got, v.order)) { pass = false; console.error(`FAIL order N=${v.N} pass=${JSON.stringify(v.pass)} chain=${JSON.stringify(v.chain)}`); }
    // round-trip: inverse recovers identity
    const inv = invertPermutation(got);
    if (!got.every((cell, p) => inv[got[p]] === p)) { pass = false; console.error('FAIL round-trip'); }
  }

  for (const p of VECTORS.nfcPairs) {
    if (!eq(gridPassphraseOrderV1(36, p.a, ''), gridPassphraseOrderV1(36, p.b, ''))) {
      pass = false; console.error('FAIL NFC equivalence:', p.note);
    }
  }

  console.log(pass ? 'self-test: PASS (all frozen vectors reproduced)' : 'self-test: FAIL');
  return pass;
}

module.exports = { gridPassphraseOrderV1, invertPermutation, PREFIX };

// ---- CLI ---------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--selftest' || args.length === 0) {
    process.exit(selfTest() ? 0 : 1);
  } else {
    const N = parseInt(args[0], 10);
    const passphrase = args[1] || '';
    const chain = args[2] || '';
    console.log(gridPassphraseOrderV1(N, passphrase, chain).join(','));
  }
}
