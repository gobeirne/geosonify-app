/*
  geosonify-starpin-group.js v0.1 — group-v1 sealing layer (NOT FROZEN)

  The browser-side implementation of Starpin's `group-v1` group-encrypted visit
  log. It is the shared substrate under both the bearer-code private-group profile
  and the moderated `group-mod/1` profile: everything those add (signatures,
  rosters, receipts, campaigns) sits ABOVE the sealed object this module produces.

  This module is the twin of the Node oracle `group-v1-reference.js`. Its ONE job
  is to produce byte-identical output: same group_key, target_handle, AAD, record
  key, padded plaintext, ciphertext, tag, blob and content_hash — so a blob sealed
  in the browser opens in the oracle and vice versa, this decade or next.

  A WRONG DERIVATION DOES NOT ERROR. It silently makes a group's history
  undecryptable or unfindable. That is why this file mirrors the oracle line for
  line and ships with a conformance suite carrying the oracle's own vectors.

  ── Primitives ─────────────────────────────────────────────────────────────
  The browser has HKDF-SHA256 and SHA-256 natively (WebCrypto). It has NEITHER
  Argon2id NOR XChaCha20-Poly1305. Rather than bundle a megabyte of crypto into a
  module that must stay auditable and byte-exact, the primitives are INJECTED:

      var G = GeosonifyStarpinGroup.create({
        argon2id:          fn(passwordBytes, saltBytes, {t,m,p,dkLen}) -> Uint8Array,
        xchacha20poly1305: fn(keyBytes, nonce24) -> { encrypt(pt,aad), decrypt(ct,aad) },
        hkdfSha256:        fn(ikm, salt, info, len) -> Uint8Array,   // optional; WebCrypto used if absent
        sha256:            fn(bytes) -> Uint8Array | Promise<Uint8Array>, // optional; WebCrypto used if absent
      });

  This keeps the byte constructions — the part that must never drift — in one
  small reviewable place, and lets the SAME file be tested in Node against the
  SAME @noble primitives the oracle uses (that is how conformance is proven) and
  run in the browser against a chosen XChaCha20/Argon2 build.

  Everything is async, because WebCrypto is. The oracle is sync; the conformance
  suite bridges the two by awaiting.
*/
'use strict';

var GeosonifyStarpinGroup = (function () {

  // ==========================================================================
  // PROFILE — the two constants that are DELIBERATELY NOT FROZEN yet.
  // These MUST equal the oracle's PROFILE for vectors to match. When the real
  // values are measured (Argon2 on a budget Android; padding already measured to
  // [2048,8192,32768,131072] per the v4 summary), change BOTH files together and
  // regenerate vectors. Nothing else here is a knob.
  // ==========================================================================
  var PROFILE = {
    argon2: { t: 2, m: 512 /* KiB */, p: 1, dkLen: 32 },   // PLACEHOLDER COST
    paddingClasses: [64, 128, 256, 512, 1024]              // PLACEHOLDER CLASSES
  };

  // ==========================================================================
  // FROZEN byte constructions (intended-final; must match the oracle exactly)
  // ==========================================================================
  var FROZEN = {
    SCHEMA: 'starpin.group/1',
    ARGON2_SALT_PREFIX: 'starpin-group-v1|',       // + group_uuid(raw16) + '|' + epoch
    HANDLE_INFO_PREFIX: 'starpin-handle-v1|',       // + canonical_target  (HKDF info)
    RECORD_KEY_INFO:    'starpin-record-key-v1',    // HKDF info (per-record salt carries uniqueness)
    KDF_MARKER: 'argon2id',
    CIPHER_MARKER: 'xchacha20poly1305',
    PAD_LEN_PREFIX_BYTES: 4
  };

  // ---- small helpers (byte-exact twins of the oracle's) --------------------
  var te = new TextEncoder();
  function utf8(s) { return te.encode(s); }

  function b64url(bytes) {
    // No Buffer in the browser. Build binary string, btoa, then url-safe, strip pad.
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var b64 = (typeof btoa === 'function')
      ? btoa(bin)
      : Buffer.from(bytes).toString('base64');          // Node fallback for testing
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function u32be(n) {
    var b = new Uint8Array(4);
    b[0] = (n >>> 24) & 0xff; b[1] = (n >>> 16) & 0xff; b[2] = (n >>> 8) & 0xff; b[3] = n & 0xff;
    return b;
  }

  function concat() {
    var arrs = Array.prototype.slice.call(arguments);
    var len = 0, i;
    for (i = 0; i < arrs.length; i++) len += arrs[i].length;
    var out = new Uint8Array(len), o = 0;
    for (i = 0; i < arrs.length; i++) { out.set(arrs[i], o); o += arrs[i].length; }
    return out;
  }

  function hex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      s += (h.length === 1 ? '0' : '') + h;
    }
    return s;
  }

  // ==========================================================================
  // create() — bind the injected primitives, return the sealing API.
  // ==========================================================================
  function create(primitives) {
    primitives = primitives || {};
    var argon2idFn = primitives.argon2id;
    var xchachaFn  = primitives.xchacha20poly1305;

    // HKDF-SHA256 and SHA-256: use injected if given, else WebCrypto.
    var hkdfFn   = primitives.hkdfSha256 || webcryptoHkdf;
    var sha256Fn = primitives.sha256     || webcryptoSha256;

    if (typeof argon2idFn !== 'function')
      throw new Error('group-v1: argon2id primitive is required');
    if (typeof xchachaFn !== 'function')
      throw new Error('group-v1: xchacha20poly1305 primitive is required');

    // ---- 1. code_normalised — the single most dangerous function -----------
    // FROZEN steps: NFC -> case-fold -> NFC -> strip format/space set -> UTF-8.
    // Iterate by code point (for..of), not UTF-16 unit. Twin of the oracle.
    var STRIP = {};
    [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0,
     0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x200e, 0x200f, 0x2d
    ].forEach(function (cp) { STRIP[cp] = true; });

    function codeNormalised(code) {
      var nfc = code.normalize('NFC');
      var folded = nfc.toLowerCase();
      var foldedNfc = folded.normalize('NFC');
      var out = '';
      // for..of iterates by code point, matching the oracle's behaviour.
      for (var iter = foldedNfc[Symbol.iterator](), step = iter.next(); !step.done; step = iter.next()) {
        var ch = step.value;
        if (!STRIP[ch.codePointAt(0)]) out += ch;
      }
      return utf8(out);
    }

    // ---- 2. Key schedule ---------------------------------------------------
    // Argon2id is (probably) sync in the injected build; wrap so callers await.
    async function groupKey(code, groupUuidBytes, epoch) {
      var salt = concat(
        utf8(FROZEN.ARGON2_SALT_PREFIX),
        groupUuidBytes,                         // raw 16 bytes
        utf8('|' + String(epoch))
      );
      var a = PROFILE.argon2;
      var gk = await argon2idFn(codeNormalised(code), salt,
                                { t: a.t, m: a.m, p: a.p, dkLen: a.dkLen });
      return gk;
    }

    async function targetHandle(gk, canonicalTarget) {
      var info = utf8(FROZEN.HANDLE_INFO_PREFIX + canonicalTarget);
      var salt = new Uint8Array(0);             // HKDF zero-length salt (RFC 5869)
      var h = await hkdfFn(gk, salt, info, 32);
      return b64url(h);
    }

    async function recordKey(gk, recordSalt32) {
      return await hkdfFn(gk, recordSalt32, utf8(FROZEN.RECORD_KEY_INFO), 32);
    }

    // ---- 3. AAD — fixed key order, joined by '\n', never stored ------------
    var AAD_KEYS = ['schema', 'target_handle', 'group_uuid', 'epoch', 'kdf', 'cipher'];
    function canonicalAAD(fields) {
      var parts = AAD_KEYS.map(function (k) {
        if (!(k in fields)) throw new Error('group-v1 AAD: missing field ' + k);
        return k + '=' + String(fields[k]);
      });
      return utf8(parts.join('\n'));
    }

    // ---- 4. Padding — 4-byte BE true-length prefix + plaintext + zero fill --
    function pad(plaintextBytes) {
      var need = FROZEN.PAD_LEN_PREFIX_BYTES + plaintextBytes.length;
      var cls = null;
      for (var i = 0; i < PROFILE.paddingClasses.length; i++) {
        if (PROFILE.paddingClasses[i] >= need) { cls = PROFILE.paddingClasses[i]; break; }
      }
      if (cls == null) throw new Error('group-v1 pad: plaintext exceeds largest class');
      var out = new Uint8Array(cls);            // zero-filled
      out.set(u32be(plaintextBytes.length), 0);
      out.set(plaintextBytes, FROZEN.PAD_LEN_PREFIX_BYTES);
      return out;
    }
    function unpad(padded) {
      var len = (padded[0] << 24) | (padded[1] << 16) | (padded[2] << 8) | padded[3];
      // >>> 0 guards the sign bit if a top-bit-set length ever appears.
      len = len >>> 0;
      return padded.slice(FROZEN.PAD_LEN_PREFIX_BYTES, FROZEN.PAD_LEN_PREFIX_BYTES + len);
    }

    // ---- 5. Seal / open ----------------------------------------------------
    // blob = concat(recordSalt32, nonce24, ciphertext+tag)
    // content_hash = SHA-256(blob) hex. Retry = identical bytes, NOT re-encrypt.
    async function seal(gk, aadFields, recordSalt32, nonce24, plaintextBytes) {
      var rk = await recordKey(gk, recordSalt32);
      var aad = canonicalAAD(aadFields);
      var padded = pad(plaintextBytes);
      var ct = await xchachaFn(rk, nonce24).encrypt(padded, aad);   // ct||tag
      var blob = concat(recordSalt32, nonce24, ct);
      var digest = await sha256Fn(blob);
      return { blob: blob, content_hash: hex(digest) };
    }
    async function open(gk, aadFields, blob) {
      var recordSalt32 = blob.slice(0, 32);
      var nonce24 = blob.slice(32, 56);
      var ct = blob.slice(56);
      var rk = await recordKey(gk, recordSalt32);
      var aad = canonicalAAD(aadFields);
      var padded = await xchachaFn(rk, nonce24).decrypt(ct, aad);   // throws on bad tag/AAD
      return unpad(padded);
    }

    return {
      PROFILE: PROFILE, FROZEN: FROZEN,
      codeNormalised: codeNormalised,
      groupKey: groupKey,
      targetHandle: targetHandle,
      recordKey: recordKey,
      canonicalAAD: canonicalAAD,
      pad: pad, unpad: unpad,
      seal: seal, open: open,
      b64url: b64url, hex: hex, utf8: utf8, concat: concat
    };
  }

  // ==========================================================================
  // WebCrypto default primitives for the two the browser DOES have.
  // ==========================================================================
  function subtle() {
    if (typeof crypto === 'undefined' || !crypto.subtle)
      throw new Error('group-v1: no crypto.subtle available');
    return crypto.subtle;
  }
  async function webcryptoHkdf(ikm, salt, info, len) {
    var key = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    var bits = await subtle().deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: salt, info: info }, key, len * 8);
    return new Uint8Array(bits);
  }
  async function webcryptoSha256(bytes) {
    var buf = await subtle().digest('SHA-256', bytes);
    return new Uint8Array(buf);
  }

  return { create: create, PROFILE: PROFILE, FROZEN: FROZEN, b64url: b64url, hex: hex };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeosonifyStarpinGroup;
}
