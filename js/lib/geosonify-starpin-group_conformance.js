/*
  geosonify-starpin-group_conformance.js — run: node geosonify-starpin-group_conformance.js

  Proves the browser sealing module (geosonify-starpin-group.js) is BYTE-IDENTICAL
  to the Node oracle (group-v1-reference.js): same group_key, handle, AAD, record
  key, padded plaintext, blob and content_hash — and that a blob sealed by one
  OPENS in the other. This is the test that makes the format reproducible: if it
  passes, the two independent implementations agree on every byte.

  It injects the SAME @noble primitives the oracle imports, so any divergence is
  the module's byte constructions, not the crypto. WebCrypto paths are exercised
  separately (HKDF/SHA-256) against noble to prove the browser defaults also agree.

  Scratch — shown, not proposed for the repo.
*/
'use strict';

var assert = require('assert');
var oracle = require('./group-v1-reference.js');
var Group  = require('./geosonify-starpin-group.js');

// noble primitives (same versions the oracle uses)
var argon2 = require('@noble/hashes/argon2');
var chacha = require('@noble/ciphers/chacha');
var hkdfM  = require('@noble/hashes/hkdf');
var sha2   = require('@noble/hashes/sha2');
var crypto = require('crypto');

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }
function hx(b) { return Buffer.from(b).toString('hex'); }

// ---- primitive adapters: browser-module interface -> noble ------------------
function nobleArgon2id(pw, salt, opts) {
  return argon2.argon2id(pw, salt, { t: opts.t, m: opts.m, p: opts.p, dkLen: opts.dkLen });
}
function nobleXchacha(key, nonce24) {
  var c = chacha.xchacha20poly1305(key, nonce24);
  return {
    encrypt: function (pt, aad) { return chacha.xchacha20poly1305(key, nonce24, aad).encrypt(pt); },
    decrypt: function (ct, aad) { return chacha.xchacha20poly1305(key, nonce24, aad).decrypt(ct); }
  };
}
function nobleHkdf(ikm, salt, info, len) { return hkdfM.hkdf(sha2.sha256, ikm, salt, info, len); }
function nobleSha256(bytes) { return sha2.sha256(bytes); }

// Build the browser module twice: once fully noble-backed, once with WebCrypto
// (Node's) HKDF/SHA-256 to prove the browser defaults also match the oracle.
var Gnoble = Group.create({
  argon2id: nobleArgon2id, xchacha20poly1305: nobleXchacha,
  hkdfSha256: nobleHkdf, sha256: nobleSha256
});
var Gwc = Group.create({
  argon2id: nobleArgon2id, xchacha20poly1305: nobleXchacha
  // hkdfSha256 + sha256 omitted -> module uses global crypto.subtle (Node 20+ WebCrypto)
});

// ---- shared test vectors (identical to the oracle's embedded ones) ----------
var GROUP_UUID = Uint8Array.from('0123456789abcdef0123456789abcdef'.match(/../g).map(function (h) { return parseInt(h, 16); }));
var EPOCH = 1;
var CODE = 'MRSK-7QF2';
var TARGET = 'starpin:gdr3:5382128182680588160';

(async function () {
  head('1: code_normalised is byte-identical across impls');
  var codes = ['MRSK-7QF2', 'mrsk 7qf2', 'e\u0301', 'MA\u0308ORI', 'co\u200bde', '\u1822\u1828', 'MÄORI'];
  for (var i = 0; i < codes.length; i++) {
    var a = oracle.codeNormalised(codes[i]);
    var b = Gnoble.codeNormalised(codes[i]);
    ok('code_normalised("' + JSON.stringify(codes[i]).slice(1, -1) + '")', hx(a) === hx(b), hx(a) + ' vs ' + hx(b));
  }

  head('2: group_key is byte-identical');
  var gkO = oracle.groupKey(CODE, GROUP_UUID, EPOCH);
  var gkM = await Gnoble.groupKey(CODE, GROUP_UUID, EPOCH);
  ok('group_key matches oracle', hx(gkO) === hx(gkM), hx(gkO) + ' vs ' + hx(gkM));

  head('3: target_handle is byte-identical (noble HKDF and WebCrypto HKDF)');
  var hO = oracle.targetHandle(gkO, TARGET);
  var hM = await Gnoble.targetHandle(gkM, TARGET);
  var hW = await Gwc.targetHandle(gkM, TARGET);
  ok('handle matches oracle (noble hkdf)', hO === hM, hO + ' vs ' + hM);
  ok('handle matches oracle (WebCrypto hkdf)', hO === hW, hO + ' vs ' + hW);

  head('4: record_key is byte-identical');
  var salt = new Uint8Array(32).fill(0x11);
  var rkO = oracle.recordKey(gkO, salt);
  var rkM = await Gnoble.recordKey(gkM, salt);
  ok('record_key matches oracle', hx(rkO) === hx(rkM), hx(rkO) + ' vs ' + hx(rkM));

  head('5: canonical AAD is byte-identical');
  var aadFields = {
    schema: Group.FROZEN.SCHEMA, target_handle: hO,
    group_uuid: Group.b64url(GROUP_UUID), epoch: EPOCH,
    kdf: Group.FROZEN.KDF_MARKER, cipher: Group.FROZEN.CIPHER_MARKER
  };
  ok('AAD bytes match oracle', hx(oracle.canonicalAAD(aadFields)) === hx(Gnoble.canonicalAAD(aadFields)));

  head('6: pad/unpad byte-identical, and unpad(pad(x)) == x');
  var probe = Gnoble.utf8('the quick brown fox');
  ok('pad matches oracle', hx(oracle.pad(probe)) === hx(Gnoble.pad(probe)));
  ok('unpad round-trips', hx(Gnoble.unpad(Gnoble.pad(probe))) === hx(probe));

  head('7: SEAL produces the identical blob + content_hash as the oracle');
  var nonce = new Uint8Array(24).fill(0x22);
  var record = Gnoble.utf8(JSON.stringify({
    record_id: '11111111-1111-4111-8111-111111111111',
    kind: 'visit', target: TARGET,
    event: { time_ms: 1786000000000, time_uncertainty_ms: null }
  }));
  var sealedO = oracle.seal(gkO, aadFields, salt, nonce, record);
  var sealedM = await Gnoble.seal(gkM, aadFields, salt, nonce, record);
  var sealedW = await Gwc.seal(gkM, aadFields, salt, nonce, record);
  ok('blob bytes match oracle (noble)', hx(sealedO.blob) === hx(sealedM.blob));
  ok('content_hash matches oracle (noble)', sealedO.content_hash === sealedM.content_hash);
  ok('blob bytes match oracle (WebCrypto sha256)', hx(sealedO.blob) === hx(sealedW.blob));
  ok('content_hash matches oracle (WebCrypto sha256)', sealedO.content_hash === sealedW.content_hash);

  head('8: CROSS-DECRYPT — each impl opens the other\'s blob');
  var openedByOracle = oracle.open(gkO, aadFields, sealedM.blob);
  var openedByModule = await Gnoble.open(gkM, aadFields, sealedO.blob);
  ok('oracle opens module blob', hx(openedByOracle) === hx(record));
  ok('module opens oracle blob', hx(openedByModule) === hx(record));

  head('9: AAD binding — folder-move rejected by the module');
  var moved = Object.assign({}, aadFields, { target_handle: 'DIFFERENT_HANDLE' });
  var threw = false;
  try { await Gnoble.open(gkM, moved, sealedM.blob); } catch (e) { threw = true; }
  ok('module rejects folder-move', threw);

  head('10: wrong code -> different handle, cannot open');
  var gkWrong = await Gnoble.groupKey('WRONG-CODE', GROUP_UUID, EPOCH);
  ok('wrong code different handle', (await Gnoble.targetHandle(gkWrong, TARGET)) !== hM);
  var threw2 = false;
  try { await Gnoble.open(gkWrong, aadFields, sealedM.blob); } catch (e) { threw2 = true; }
  ok('wrong code cannot open', threw2);

  head('11: idempotency — identical inputs -> identical bytes (retry safety)');
  var again = await Gnoble.seal(gkM, aadFields, salt, nonce, record);
  ok('identical blob on retry', hx(again.blob) === hx(sealedM.blob));
  ok('identical content_hash on retry', again.content_hash === sealedM.content_hash);

  console.log('\n' + (fail === 0
    ? 'CONFORMANCE: PASS  (' + pass + '/' + (pass) + ')  — browser module is byte-identical to the oracle'
    : 'CONFORMANCE: FAIL  (' + fail + ' failing, ' + pass + ' passing)'));
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) { console.error('THREW', e); process.exit(2); });
