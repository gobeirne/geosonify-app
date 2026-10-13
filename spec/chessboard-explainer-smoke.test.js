/* Run from the Geosonify repo root: node spec/chessboard-explainer-smoke.test.js */
'use strict';
const assert = require('node:assert/strict');
const { ChessboardLib } = require('../js/lib/geosonify-chessboard-lib_v1_0.js');
const Trace = require('../js/lib/chessboard-explainer-trace.js');

const CASES = [
  ['healpix', '95625281C9B5', 'NBB5/p3p1pp/2p2p2/1P2Pnn1/1pPp2PP/qbb1Q3/P1RPKPrN/k1r4R'],
  ['standard', 'BFDAEB6AA077', '3r4/n1Rpp3/1Q6/PNp1PpPp/ppr2Pp1/BbPB1q1P/1PnPNR2/1K1kb3'],
];

for (const [mode, code, expectedFen] of CASES) {
  const codec = ChessboardLib.makeCodec(mode);
  const actual = Trace.trace(codec, code);
  assert.equal(actual.fen, expectedFen, `${mode}: known reference FEN`);
  assert.equal(ChessboardLib.toFEN(code, mode), expectedFen);
  assert.equal(actual.steps[0].board.filter(Boolean).length, 0);
  assert.equal(actual.steps.at(-1).board.filter(Boolean).length, 32);
  assert.equal(actual.steps.at(-1).math.at(-1)[1], 'PASS');
  assert.equal(actual.steps.filter(step => step.phase === 'pawns').length, 8);
  assert.equal(actual.steps.filter(step => step.phase === 'bishops').length, 4);
  assert.equal(actual.steps.filter(step => step.phase === 'material' && !step.optional).length, 11);
  assert.equal(actual.steps.filter(step => step.phase === 'kings').length, 4);
  assert.equal(actual.recoveredPayload, actual.payload);
  assert.equal(actual.recoveredRank, actual.whitened);
  assert.equal(actual.scanned.hex, code);
  assert.equal(actual.scanned.ok, true);
  console.log(`PASS ${mode}: ${code} → ${actual.fen} (${actual.steps.length} full-detail steps)`);
}

const distinct = new Set();
for (const code of ['96E','096E','0096E','0','00','0000','000000','abcdef','01234ABC']) {
  const result = Trace.trace(ChessboardLib.makeCodec('healpix'), code);
  assert.equal(result.code, code.toUpperCase(), 'exact hex round trip');
  assert.equal(result.steps.at(-1).board.filter(Boolean).length, 32);
  distinct.add(result.fen);
}
assert.equal(distinct.size, 9, 'distinct leading-zero inputs yield distinct boards');
console.log('PASS leading-zero and mixed-length round trips');

assert.throws(() => Trace.trace(ChessboardLib.makeCodec('healpix'), 'G'), /hexadecimal/i);
assert.throws(() => Trace.trace(ChessboardLib.makeCodec('healpix'), 'F'.repeat(25)), /capacity/i);
console.log('PASS invalid-input and excessive-precision refusal');
