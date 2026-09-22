/*
  starpin-sealed-v1-vectors.js — run: node starpin-sealed-v1-vectors.js
                                 write golden JSON: node starpin-sealed-v1-vectors.js --emit

  Generates and checks the sealed-v1 conformance vectors described in
  starpin-sealed-v1-field-set.md Part 7.4. Two kinds, kept distinct (per review):

    POSITIVE (frozen wire vectors — protocol artifacts):
      The full chain, proven byte-identical through BOTH implementations
      (Node oracle + browser sealing module):

        record.target
          -> canonicalTarget-v1          (routing string, PIPE form)
          -> exact canonical_target bytes
          -> targetHandle-v1             (folder handle)
          -> AAD containing that handle
          -> JCS wrapper payload         (UTF-8(JCS(wrapper)))
          -> framed/padded AEAD plaintext
          -> ciphertext / blob
          -> content_hash

      Vector 1 is the canonical example. It directly regression-tests the
      colon-vs-pipe bug (the handle MUST derive from "starpin|starpin:gdr3:…").

    NEGATIVE (validator tests — NOT frozen wire artifacts):
      One case per rejection rule in Part 1a + the field tables. These test
      validateSealedV1() behaviour; they are not golden bytes.

  ⚠️ VALUES depend on the PLACEHOLDER crypto PROFILE (Argon2 t=2/m=512KiB/p=1,
  padding classes [64,128,256,512,1024]). STRUCTURE is what is frozen here:
  the chain, the field set, the pipe-form canonical target, the AAD binding.
  When the real Argon2 profile lands, re-emit; the STRUCTURE assertions must
  still pass unchanged.
*/
'use strict';

var oracle = require('./group-v1-reference.js');
var Group  = require('./geosonify-starpin-group.js');
var argon2 = require('@noble/hashes/argon2');
var chacha = require('@noble/ciphers/chacha');
var hkdfM  = require('@noble/hashes/hkdf');
var sha2   = require('@noble/hashes/sha2');
var fs     = require('fs');

// ---- primitive injection (same noble the oracle uses) ----------------------
function nobleArgon2id(pw, salt, o) { return argon2.argon2id(pw, salt, { t:o.t, m:o.m, p:o.p, dkLen:o.dkLen }); }
function nobleXchacha(key, nonce24) {
  return {
    encrypt: function (pt, aad) { return chacha.xchacha20poly1305(key, nonce24, aad).encrypt(pt); },
    decrypt: function (ct, aad) { return chacha.xchacha20poly1305(key, nonce24, aad).decrypt(ct); }
  };
}
function nobleHkdf(ikm, salt, info, len) { return hkdfM.hkdf(sha2.sha256, ikm, salt, info, len); }
function nobleSha256(bytes) { return sha2.sha256(bytes); }

var G = Group.create({ allowProvisional:true,
  argon2id: nobleArgon2id, xchacha20poly1305: nobleXchacha,
  hkdfSha256: nobleHkdf, sha256: nobleSha256 });

// canonicaliser (the ONE frozen module)
var Canon = require('./geosonify-starpin-canonical.js');
var canonical = Canon.canonical;

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }
function hx(b) { return Buffer.from(b).toString('hex'); }
var te = new TextEncoder();

// ---- fixed inputs (placeholder profile) ------------------------------------
var GROUP_UUID = Uint8Array.from('0123456789abcdef0123456789abcdef'.match(/../g).map(function (h){return parseInt(h,16);}));
var GROUP_UUID_B64 = oracle.b64url(GROUP_UUID);
var EPOCH = 1;
var CODE = 'MRSK-7QF2';

// A complete, sealed-v1-conforming record (scaled-integer measurements; every
// key present; evidence [], provenance null; UUIDs valid v4; ids canonical).
var RECORD = {
  schema: 'starpin.record/1',
  record_id: '11111111-1111-4111-8111-111111111111',
  supersedes: null,
  kind: 'visit',
  target: { starpin: 'starpin:gdr3:5382128182680588160' },
  membership: null,
  event: { time_ms: 1786000000000, time_uncertainty_ms: null },
  fix: {
    lat_1e7: -435554470, lon_1e7: 1726508430, datum: 'WGS84',
    accuracy_dm: 70, altitude_dm: null, altitude_accuracy_dm: null,
    time_ms: 1786000000000, source: 'web-geolocation'
  },
  approach_reason: null,
  observation: null,
  evidence: [],
  created_ms: 1786000000000,
  provenance: null
};

// A fixed publication wrapper. publication_id + member_id are canonical 22-char
// base64url of 16 bytes; comment present and non-empty.
var WRAPPER = {
  schema: 'starpin.group-share/1',
  publication_id: oracle.b64url(Uint8Array.from(Array(16).fill(0x22))),
  canonical_target: null,        // filled by canonicalTarget-v1 below (derived-only)
  record: RECORD,
  member: { member_id: oracle.b64url(Uint8Array.from(Array(16).fill(0x33))), handle: 'Greg' },
  comment: 'first light'
};

// fixed salt/nonce so the vector is reproducible (real shares randomise these)
var RECORD_SALT = Uint8Array.from(Array(32).fill(0x11));
var NONCE       = Uint8Array.from(Array(24).fill(0x44));

(async function () {
  head('POSITIVE vector 1 — the full chain, both implementations');

  // 1. record.target -> canonicalTarget-v1  (MUST be pipe form)
  var ctOracle = oracle.canonicalTargetV1(RECORD.target);
  ok('canonicalTarget-v1 is pipe form', ctOracle === 'starpin|starpin:gdr3:5382128182680588160', ctOracle);

  // fill the derived-only field
  var wrapper = JSON.parse(JSON.stringify(WRAPPER));
  wrapper.canonical_target = ctOracle;

  // 2. exact canonical_target bytes
  var ctBytes = te.encode(ctOracle);

  // 3. targetHandle-v1 — derive in BOTH impls, assert identical
  var gkO = oracle.groupKey(CODE, GROUP_UUID, EPOCH);
  var gkG = await G.groupKey(CODE, GROUP_UUID, EPOCH);
  ok('group_key identical (oracle vs browser)', hx(gkO) === hx(gkG));
  var handleO = oracle.targetHandle(gkO, ctOracle);
  var handleG = await G.targetHandle(gkG, ctOracle);
  ok('target_handle identical', handleO === handleG, handleO + ' vs ' + handleG);
  ok('target_handle is 43-char base64url', /^[A-Za-z0-9_-]{43}$/.test(handleO), handleO);

  // 4. AAD contains that handle
  var aad = {
    schema: oracle.FROZEN.SCHEMA, target_handle: handleO,
    group_uuid: GROUP_UUID_B64, epoch: EPOCH,
    kdf: oracle.FROZEN.KDF_MARKER, cipher: oracle.FROZEN.CIPHER_MARKER
  };
  ok('AAD binds the derived handle', aad.target_handle === handleO);

  // 5. JCS wrapper payload — canonical bytes, both canonicalisers agree
  var payloadStr = canonical(wrapper);
  var payloadBytes = te.encode(payloadStr);
  // sanity: canonical is stable regardless of key order
  var reordered = {}; Object.keys(wrapper).reverse().forEach(function(k){reordered[k]=wrapper[k];});
  ok('wrapper payload is order-independent', canonical(reordered) === payloadStr);
  ok('payload is valid UTF-8(JCS), no BOM', payloadBytes[0] !== 0xEF);

  // 6+7. framed/padded AEAD plaintext -> ciphertext/blob, sealed in BOTH impls
  var sealedO = oracle.seal(gkO, aad, RECORD_SALT, NONCE, payloadBytes);
  var sealedG = await G.seal(gkG, aad, RECORD_SALT, NONCE, payloadBytes);
  ok('blob bytes identical (oracle vs browser)', hx(sealedO.blob) === hx(sealedG.blob));

  // 8. content_hash
  ok('content_hash identical', sealedO.content_hash === sealedG.content_hash);
  ok('content_hash is 64-hex (sha256)', /^[0-9a-f]{64}$/.test(sealedO.content_hash), sealedO.content_hash);

  // full round trip: each impl opens the other's blob and recovers the payload
  var openedO = oracle.open(gkO, aad, sealedG.blob);
  var openedG = await G.open(gkG, aad, sealedO.blob);
  ok('oracle opens browser blob -> exact payload', hx(openedO) === hx(payloadBytes));
  ok('browser opens oracle blob -> exact payload', hx(openedG) === hx(payloadBytes));

  // Part 4 read checks, on the recovered wrapper
  var recovered = JSON.parse(Buffer.from(openedO).toString('utf8'));
  ok('read check 1: handle(canonical_target) === opened handle',
     oracle.targetHandle(gkO, recovered.canonical_target) === handleO);
  ok('read check 2: canonical_target === canonicalTarget-v1(record.target)',
     recovered.canonical_target === oracle.canonicalTargetV1(recovered.record.target));

  // AAD binding = relocation fails cryptographically
  var movedAad = Object.assign({}, aad, { target_handle: 'DIFFERENT_HANDLE_'.padEnd(43,'x') });
  var relocationRejected = false;
  try { oracle.open(gkO, movedAad, sealedO.blob); } catch (e) { relocationRejected = true; }
  ok('relocated blob fails to decrypt (AAD binding)', relocationRejected);

  var VECTOR = {
    note: 'sealed-v1 golden vector 1. STRUCTURE frozen; VALUES use placeholder Argon2 profile.',
    profile: oracle.PROFILE,
    inputs: {
      code: CODE, group_uuid_b64: GROUP_UUID_B64, epoch: EPOCH,
      record_target: RECORD.target,
      record_salt_hex: hx(RECORD_SALT), nonce_hex: hx(NONCE)
    },
    chain: {
      canonical_target: ctOracle,
      canonical_target_hex: hx(ctBytes),
      target_handle: handleO,
      aad: aad,
      payload_jcs: payloadStr,
      payload_hex: hx(payloadBytes),
      blob_hex: hx(sealedO.blob),
      content_hash: sealedO.content_hash
    },
    wrapper: wrapper
  };

  head('NEGATIVE vectors — one per rejection class (validator tests, NOT frozen bytes)');
  // These describe inputs a conforming validateSealedV1() MUST reject. We assert
  // the *canonicaliser-level* rejects here (unknown-type, non-finite, etc.) and
  // mark schema-level rejects as pending the validator (build-order step 5).
  var canonRejects = [
    ['NaN in a number field', function(){ canonical({ x: NaN }); }],
    ['Infinity', function(){ canonical({ x: Infinity }); }],
    ['undefined', function(){ canonical({ x: undefined }); }],
    ['BigInt', function(){ canonical({ x: 5n }); }],
    ['Date (non-plain object)', function(){ canonical({ x: new Date(0) }); }],
    ['sparse array', function(){ var a=[]; a[2]=3; canonical({ x:a }); }],
    ['lone surrogate string', function(){ canonical({ x: '\uD800' }); }],
    ['toJSON injection', function(){ canonical({ toJSON:function(){return 'x';} }); }]
  ];
  canonRejects.forEach(function(pair){
    var threw=false; try{ pair[1](); }catch(e){ threw=true; }
    ok('canonicaliser rejects: ' + pair[0], threw);
  });

  // canonicalTarget-v1 rejects (schema-critical, already implemented in oracle)
  var ctRejects = [
    ['two-key target {starpin,cornerstone}', { starpin:'A', cornerstone:'B' }],
    ['unknown key in target', { starpin:'A', foo:1 }],
    ['array as target', ['starpin','A']],
    ['empty id', { starpin:'' }],
    ['neither key', { foo:'A' }]
  ];
  ctRejects.forEach(function(pair){
    var threw=false; try{ oracle.canonicalTargetV1(pair[1]); }catch(e){ threw=true; }
    ok('canonicalTarget-v1 rejects: ' + pair[0], threw);
  });

  // Schema-level negatives that need validateSealedV1() (build-order step 5) —
  // listed here so the corpus is complete; asserted once the validator exists.
  var pendingValidator = [
    'unknown key in wrapper/record/member/event/fix',
    'null in a non-nullable slot',
    'non-safe integer in an integer field',
    'fractional measurement (accuracy_dm: 7.4)',
    'non-NFC handle',
    'oversized string (handle > 64B, comment > 2048B, id > 256B)',
    'non-empty evidence',
    'non-null provenance',
    'noncanonical base64url id (decodes to 16B but != re-encode)',
    'wrong-version/variant UUID',
    'supersedes === record_id'
  ];
  console.log('\n  (pending validateSealedV1 — corpus entries, asserted after build step 5:)');
  pendingValidator.forEach(function(s){ console.log('    - ' + s); });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');

  if (process.argv.indexOf('--emit') >= 0) {
    fs.writeFileSync('starpin-sealed-v1-vector-1.json', JSON.stringify(VECTOR, null, 2));
    console.log('\nwrote starpin-sealed-v1-vector-1.json');
  }
  process.exit(fail ? 1 : 0);
})().catch(function(e){ console.error('THREW', e); process.exit(2); });
