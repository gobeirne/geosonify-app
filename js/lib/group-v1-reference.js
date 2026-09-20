#!/usr/bin/env node
/*
 * group-v1-reference.js
 *
 * ⚠️ NOT FROZEN — placeholder KDF cost params and padding size classes.
 *    Everything ELSE (byte constructions, string prefixes, encodings, ordering,
 *    AAD layout, blob layout, content-hash definition) is written as the
 *    intended frozen form and should not drift. The two measured constants are
 *    isolated in PROFILE below and clearly marked. Regenerate the golden vectors
 *    after measurement, then freeze.
 *
 * Executable oracle for Starpin's `group-v1` group-encrypted visit log, matching
 * the shape of grid-passphrase-v1-reference.js: dependency-light, embedded frozen
 * vectors, `--selftest` reproduces them. Its job is to let two independent
 * implementations (any language, any decade) produce byte-identical group keys,
 * target handles, AAD, record keys, padded plaintext, ciphertext, tags and final
 * blobs — and each decrypt the other's output.
 *
 * A WRONG DERIVATION DOES NOT ERROR. It silently makes a group's history
 * undecryptable or unfindable — the encryption analogue of decoding a code to the
 * wrong location. See starpin-group-v1-design-summary-v3.md and the (forthcoming)
 * byte-level profile.
 *
 * Primitives (audited, dependency-free, RFC-vector-checked):
 *   Argon2id  RFC 9106   @noble/hashes/argon2
 *   XChaCha20-Poly1305   @noble/ciphers/chacha   (24-byte nonce, 16-byte tag)
 *   HKDF-SHA256 RFC 5869 @noble/hashes/hkdf   (cross-checked vs Node crypto.hkdfSync)
 *   SHA-256              @noble/hashes/sha2
 */
'use strict';

const { argon2id } = require('@noble/hashes/argon2');
const { xchacha20poly1305 } = require('@noble/ciphers/chacha');
const { hkdf } = require('@noble/hashes/hkdf');
const { sha256 } = require('@noble/hashes/sha2');

// ============================================================================
// PROFILE — the two constants that are DELIBERATELY NOT FROZEN yet.
// Measure, then freeze, then regenerate vectors. Nothing else here is a knob.
// ============================================================================
const PROFILE = {
  // Argon2id cost. Placeholder = fast, for test determinism only.
  // FREEZE TARGET: benchmark on a real budget Android. RFC 9106 64MiB profile is
  // (t=1..3, m=65536 KiB, p=4). Draft guessed p=1; decide on measurement.
  argon2: { t: 2, m: 512 /* KiB */, p: 1, dkLen: 32 },   // ⚠️ PLACEHOLDER COST

  // Padding size classes (bytes) for the final plaintext before encryption.
  // Placeholder tiny classes so vectors are legible. FREEZE TARGET: measure real
  // starpin.record/1 sizes; pick boring fixed classes (e.g. 1/2/4/8/16 KiB).
  paddingClasses: [2048, 8192, 32768, 131072],           // group-share classes (still provisional; matches browser module)
};

// ============================================================================
// FROZEN byte constructions (intended-final; do not drift)
// ============================================================================
const FROZEN = {
  SCHEMA: 'starpin.group/1',
  // Exact strings: spelling, case, hyphens, trailing '|' where shown.
  ARGON2_SALT_PREFIX: 'starpin-group-v1|',      // + group_uuid + '|' + epoch
  HANDLE_INFO_PREFIX: 'starpin-handle-v1|',     // + canonical_target   (HKDF info)
  ACTIVITY_HANDLE_INFO_PREFIX: 'starpin-group-activity-handle-v1|',  // + epoch + '|' + period
  ACTIVITY_KEY_INFO:  'starpin-group-activity-key-v1',  // HKDF info for per-entry activity seal key
  RECORD_KEY_INFO:    'starpin-record-key-v1',  // HKDF info (no target; per-record salt carries uniqueness)
  KDF_MARKER: 'argon2id',
  CIPHER_MARKER: 'xchacha20poly1305',
  // Encodings: base64url WITHOUT padding for all opaque byte strings in JSON.
  // Integers in AAD/framing: unsigned, decimal ASCII (see canonical()).
  // Padding framing: 4-byte big-endian uint32 true-length prefix, then plaintext,
  //   then zero fill to the chosen class. (BE chosen for human-legible hexdumps.)
  PAD_LEN_PREFIX_BYTES: 4,
};

// ---- small helpers ----------------------------------------------------------
const te = new TextEncoder();
function utf8(s) { return te.encode(s); }
function b64url(bytes) {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function u32be(n) {
  const b = new Uint8Array(4);
  b[0] = (n >>> 24) & 0xff; b[1] = (n >>> 16) & 0xff; b[2] = (n >>> 8) & 0xff; b[3] = n & 0xff;
  return b;
}
function concat(...arrs) {
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function hex(bytes) { return Buffer.from(bytes).toString('hex'); }

// ============================================================================
// 1. code_normalised  — the single most dangerous function in the format.
//    FROZEN steps: NFC → case-fold → strip format/space set → UTF-8 bytes.
//    Human-typed Unicode codes are first-class; app-generated safe-alphabet
//    codes are the recommended default but normalise through the SAME pipeline.
// ============================================================================
// Characters stripped entirely (whitespace + common invisibles/format chars).
// Frozen set; extend only in a new version.
const STRIP = new Set([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20,   // tab, LF, VT, FF, CR, space
  0xa0,                                  // NBSP
  0x200b, 0x200c, 0x200d,                // ZWSP, ZWNJ, ZWJ
  0x2060,                                // word joiner
  0xfeff,                                // BOM / ZWNBSP
  0x200e, 0x200f,                        // LRM, RLM (bidi)
  0x2d,                                  // '-' hyphen-minus (group codes are hyphen-cosmetic)
]);
function codeNormalised(code) {
  // NFC first so composed/decomposed forms agree, THEN case-fold, THEN strip.
  const nfc = code.normalize('NFC');
  // Unicode case fold: toLowerCase() on the NFC string is the frozen fold.
  // (Documented caveat in the profile: locale-independent; Turkish-i etc. behave
  //  per the default Unicode fold, which is what both impls must match.)
  const folded = nfc.toLowerCase();
  // Re-normalise NFC after folding (folding can denormalise), then strip.
  const foldedNfc = folded.normalize('NFC');
  let out = '';
  for (const ch of foldedNfc) {          // iterate by code point, not UTF-16 unit
    const cp = ch.codePointAt(0);
    if (!STRIP.has(cp)) out += ch;
  }
  return utf8(out);                       // UTF-8 bytes
}

// ============================================================================
// 2. Key schedule
// ============================================================================
function groupKey(code, groupUuidBytes, epoch) {
  const salt = concat(
    utf8(FROZEN.ARGON2_SALT_PREFIX),
    groupUuidBytes,                       // raw 16 bytes (see note in profile)
    utf8('|' + String(epoch))
  );
  const { t, m, p, dkLen } = PROFILE.argon2;
  return argon2id(codeNormalised(code), salt, { t, m, p, dkLen });
}

// canonical_target: the exact target string as it appears sealed in the record,
// e.g. "starpin:gdr3:5382128182680588160" or "cornerstone:V:f9...c3".
function targetHandle(gk, canonicalTarget) {
  const info = utf8(FROZEN.HANDLE_INFO_PREFIX + canonicalTarget);
  const salt = new Uint8Array(0);        // HKDF zero-length salt (RFC 5869, valid)
  const h = hkdf(sha256, gk, salt, info, 32);
  return b64url(h);                       // the flat-namespace folder name
}

// Weekly-sharded activity ("feed") folder handle — domain-separated from target
// handles. period = floor(shared_at_utc_ms / 7 days).
function activityHandle(gk, epoch, period) {
  const info = utf8(FROZEN.ACTIVITY_HANDLE_INFO_PREFIX + epoch + '|' + period);
  return b64url(hkdf(sha256, gk, new Uint8Array(0), info, 32));
}
function activityKey(gk, entrySalt32) {
  return hkdf(sha256, gk, entrySalt32, utf8(FROZEN.ACTIVITY_KEY_INFO), 32);
}

function recordKey(gk, recordSalt32) {
  return hkdf(sha256, gk, recordSalt32, utf8(FROZEN.RECORD_KEY_INFO), 32);
}

// ============================================================================
// 3. AAD — canonical, client-reconstructed at decrypt, NEVER stored.
//    Frozen canonical form: key=value pairs, keys in fixed order, joined by '\n'.
//    Fixed order is authoritative; do not sort, do not add keys without a version.
// ============================================================================
const AAD_KEYS = ['schema', 'target_handle', 'group_uuid', 'epoch', 'kdf', 'cipher'];
function canonicalAAD(fields) {
  const parts = AAD_KEYS.map(k => {
    if (!(k in fields)) throw new Error('group-v1 AAD: missing field ' + k);
    return k + '=' + String(fields[k]);
  });
  return utf8(parts.join('\n'));
}

// ============================================================================
// 4. Padding — 4-byte BE true-length prefix + plaintext + zero fill to class.
//    Smallest class that fits (prefix+plaintext). Decrypt reads prefix, slices.
// ============================================================================
function pad(plaintextBytes) {
  const need = FROZEN.PAD_LEN_PREFIX_BYTES + plaintextBytes.length;
  const cls = PROFILE.paddingClasses.find(c => c >= need);
  if (cls == null) throw new Error('group-v1 pad: plaintext exceeds largest class');
  const out = new Uint8Array(cls);       // zero-filled
  out.set(u32be(plaintextBytes.length), 0);
  out.set(plaintextBytes, FROZEN.PAD_LEN_PREFIX_BYTES);
  return out;
}
function unpad(padded) {
  const len = (padded[0] << 24) | (padded[1] << 16) | (padded[2] << 8) | padded[3];
  return padded.slice(FROZEN.PAD_LEN_PREFIX_BYTES, FROZEN.PAD_LEN_PREFIX_BYTES + len);
}

// ============================================================================
// 5. Seal / open.  Blob = concat(recordSalt32, nonce24, ciphertext+tag).
//    content_hash = SHA-256(final blob bytes EXACTLY as stored). Retry = identical
//    bytes (same salt, nonce, padding, ct, tag) — NOT re-encryption.
// ============================================================================
function seal(gk, aadFields, recordSalt32, nonce24, plaintextBytes) {
  const rk = recordKey(gk, recordSalt32);
  const aad = canonicalAAD(aadFields);
  const padded = pad(plaintextBytes);
  const ct = xchacha20poly1305(rk, nonce24, aad).encrypt(padded);  // ct||tag
  const blob = concat(recordSalt32, nonce24, ct);
  return { blob, content_hash: hex(sha256(blob)) };
}
function open(gk, aadFields, blob) {
  const recordSalt32 = blob.slice(0, 32);
  const nonce24 = blob.slice(32, 56);
  const ct = blob.slice(56);
  const rk = recordKey(gk, recordSalt32);
  const aad = canonicalAAD(aadFields);
  const padded = xchacha20poly1305(rk, nonce24, aad).decrypt(ct);
  return unpad(padded);
}

// ============================================================================
// Embedded vectors. ⚠️ VALUES DEPEND ON PLACEHOLDER PROFILE — not frozen.
// Structure is what's being proven: determinism, cross-decrypt, AAD binding,
// Unicode normalisation equivalence, folder-move rejection.
// ============================================================================
const GROUP_UUID = Uint8Array.from(
  '0123456789abcdef0123456789abcdef'.match(/../g).map(h => parseInt(h, 16)));  // 16 bytes
const EPOCH = 1;
const CODE = 'MRSK-7QF2';
const TARGET = 'starpin:gdr3:5382128182680588160';

function selfTest() {
  let ok = true;
  const check = (cond, msg) => { if (!cond) { ok = false; console.error('FAIL', msg); } };

  // 1. Determinism of the key schedule
  const gk1 = groupKey(CODE, GROUP_UUID, EPOCH);
  const gk2 = groupKey(CODE, GROUP_UUID, EPOCH);
  check(hex(gk1) === hex(gk2), 'group_key deterministic');

  const handle = targetHandle(gk1, TARGET);
  check(handle === targetHandle(gk1, TARGET), 'target_handle deterministic');

  // 2. code_normalised: Unicode equivalence (the dangerous cases)
  //    Composed vs decomposed must fold identically. Non-Latin scripts included.
  const nfcPairs = [
    ['é',           'e\u0301',        'é composed vs decomposed'],
    ['MÄORI',       'MA\u0308ORI',    'Ä composed vs A+diaeresis, with case'],
    ['Мисс',        'Мисс',           'Cyrillic identity (sanity)'],
    ['MRSK-7QF2',   'mrsk 7qf2',      'hyphen/space strip + case fold'],
    ['ᠮᠣᠩᠭᠣᠯ',      'ᠮᠣᠩᠭᠣᠯ',         'Mongolian-script identity (sanity)'],
    ['co\u200bde',  'code',           'zero-width space stripped'],
  ];
  for (const [a, b, note] of nfcPairs) {
    check(hex(codeNormalised(a)) === hex(codeNormalised(b)), 'code_normalised equivalence: ' + note);
  }

  // 3. Round-trip seal/open with a real-ish sealed record
  const record = utf8(JSON.stringify({
    record_id: '11111111-1111-4111-8111-111111111111',
    kind: 'visit', target: TARGET,
    event: { time_ms: 1786000000000, time_uncertainty_ms: null },
  }));
  const salt = new Uint8Array(32).fill(0x11);
  const nonce = new Uint8Array(24).fill(0x22);
  const aadFields = {
    schema: FROZEN.SCHEMA, target_handle: handle,
    group_uuid: b64url(GROUP_UUID), epoch: EPOCH,
    kdf: FROZEN.KDF_MARKER, cipher: FROZEN.CIPHER_MARKER,
  };
  const sealed = seal(gk1, aadFields, salt, nonce, record);
  const opened = open(gk1, aadFields, sealed.blob);
  check(hex(opened) === hex(record), 'seal/open round-trip');

  // 4. Idempotency: identical inputs → identical blob bytes → identical hash
  const sealed2 = seal(gk1, aadFields, salt, nonce, record);
  check(hex(sealed.blob) === hex(sealed2.blob), 'retry: identical bytes');
  check(sealed.content_hash === sealed2.content_hash, 'retry: identical content_hash');

  // 5. AAD binding = folder-move rejection. Move blob to a different handle's
  //    AAD; open MUST throw (ciphertext can't be relocated between folders).
  const movedAad = Object.assign({}, aadFields, { target_handle: 'DIFFERENT_HANDLE' });
  let threw = false;
  try { open(gk1, movedAad, sealed.blob); } catch (e) { threw = true; }
  check(threw, 'AAD binding rejects folder-move');

  // 6. Wrong credential (different code) derives a different handle & can't open
  const gkWrong = groupKey('WRONG-CODE', GROUP_UUID, EPOCH);
  check(targetHandle(gkWrong, TARGET) !== handle, 'wrong code -> different handle');
  let threw2 = false;
  try { open(gkWrong, aadFields, sealed.blob); } catch (e) { threw2 = true; }
  check(threw2, 'wrong code cannot open');

  // 7. Padding hides length: two very different plaintexts in the same class
  //    produce equal-length blobs.
  const short = seal(gk1, aadFields, salt, nonce, utf8('x'));
  const longer = seal(gk1, aadFields, salt, nonce, utf8('x'.repeat(40)));
  check(short.blob.length === longer.blob.length, 'padding equalises length within a class');

  // 8. Epoch/rotation: new epoch -> new key -> new handle (unlinkable)
  const gkEpoch2 = groupKey(CODE, GROUP_UUID, 2);
  check(targetHandle(gkEpoch2, TARGET) !== handle, 'epoch change -> new handle');

  console.log(ok
    ? 'self-test: PASS (structure verified; VALUES use placeholder profile, NOT frozen)'
    : 'self-test: FAIL');
  return ok;
}

module.exports = {
  PROFILE, FROZEN,
  codeNormalised, groupKey, targetHandle, activityHandle, activityKey, recordKey,
  canonicalAAD, pad, unpad, seal, open, b64url,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--selftest' || args.length === 0) {
    process.exit(selfTest() ? 0 : 1);
  } else if (args[0] === '--handle') {
    const gk = groupKey(args[1], GROUP_UUID, EPOCH);
    console.log(targetHandle(gk, args[2] || TARGET));
  } else {
    console.error('usage: group-v1-reference.js [--selftest | --handle CODE TARGET]');
    process.exit(2);
  }
}
