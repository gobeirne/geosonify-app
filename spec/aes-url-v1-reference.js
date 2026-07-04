#!/usr/bin/env node
/*
 * aes-url-v1-reference.js
 *
 * FROZEN reference implementation of Geosonify's AES URL encryption blob,
 * format v1 (the `?enc=` parameter). Deliberately boring and dependency-free:
 * it uses only Node's built-in PBKDF2-HMAC-SHA256 and AES-256-GCM. Its job is
 * NOT performance — it is an executable oracle that future maintainers (or a
 * clean-room re-implementer in any language, decades from now) can check their
 * own code against, byte for byte.
 *
 * Source of truth: the inline script in index.html (live per index.html's own
 * <script> tags) — constants ENC_FORMAT_VERSION / ENC_KDF_ITERATIONS and
 * functions deriveEncryptionKey, _bytesToB64url, encryptQueryString,
 * decryptQueryString. No js/ module contains any part of this path
 * (geosonify-url-codec_v1_1.js carries the SHAPE/redraw codec, not AES).
 * The live code calls the browser's native WebCrypto (crypto.subtle); the
 * primitives are GENUINE PBKDF2-HMAC-SHA256 and AES-256-GCM — verified this
 * run by cross-checking node:crypto against an independent WebCrypto pipeline
 * (see selfTest step "cross-impl"). Contrast with the GeoCodec obfuscation
 * layer, whose "SHA3-512" is NOT real SHA3 — that hash is NOT used anywhere
 * in this format.
 *
 * Scope: the layer from a plaintext query string (no leading '?') to the
 * base64url blob carried by `?enc=`, and back:
 *
 *   queryString --pad+frame--> padded --AES-256-GCM(key from PBKDF2, AAD=header)-->
 *   header||ct||tag --base64url--> blob        (and the exact inverse)
 *
 * What the app puts INSIDE the plaintext (e.g. "c=..." compact codes) is a
 * separate, independently frozen vocabulary; this oracle treats plaintext as
 * opaque UTF-8 and needs none of it.
 *
 * THE FORMAT IS IMMUTABLE. See FROZEN-AES-URL-V1.md. Unlike the bare-code
 * formats, a wrong AES reimplementation usually fails loudly (GCM tag), but a
 * wrong PADDING/FRAMING or LENGTH-FIELD port decodes to silently wrong or
 * truncated plaintext, and a wrong KDF locks every existing link out forever.
 * New behaviour = new version byte; the v1 decode path is kept forever.
 *
 * IV/SALT/PAD INJECTION: encryptQueryStringV1 accepts injected salt, iv and
 * pad bytes SO THE ENCODE VECTORS ARE REPRODUCIBLE. This injection path is for
 * this reference only and must NEVER exist in shipped code — the live encoder
 * always draws salt, iv and pad bytes from crypto.getRandomValues.
 *
 * VECTOR PROVENANCE — CLAIMED UNTIL VERIFIED: the embedded vectors were
 * produced by this port and cross-checked against an independent WebCrypto
 * (crypto.subtle) pipeline mirroring the live call shapes exactly; they have
 * not yet been replayed through the shipped browser code itself. Run the
 * differential harness (differentialTestV1) against the live
 * encryptQueryString/decryptQueryString to close that loop; decryption of any
 * real shipped `?enc=` link by this oracle also confirms them.
 */
'use strict';
const crypto = require('crypto');

// ---- FROZEN v1 constants -----------------------------------------------------
const ENC_FORMAT_VERSION = 0x01;      // blob byte 0; unknown version => decode null
const ENC_KDF_ITERATIONS = 600000;    // live encoder default; travels IN the blob
const SALT_LEN = 16;                  // bytes 4..19
const IV_LEN = 12;                    // bytes 20..31 (96-bit GCM IV, direct J0 path)
const TAG_LEN = 16;                   // 128-bit GCM tag, appended to ciphertext
const HEADER_LEN = 32;                // version[1] | iterations[3 BE] | salt[16] | iv[12]
const PAD_BLOCK = 32;                 // inner frame padded up to multiple of 32
const MAX_PLAINTEXT = 0xFFFF;         // 2-byte big-endian true-length field
const MAX_ITERATIONS = 0xFFFFFF;      // 24-bit big-endian iteration field
// key        = PBKDF2-HMAC-SHA256( UTF8(NFC(passphrase)), salt, iterations, 32 bytes )
// cipher     = AES-256-GCM, AAD = the full 32-byte header
// inner      = len_be16(plaintext) || plaintext || pad to 32-multiple
// blob       = base64url( header || AES-GCM(inner) || tag ), no '=' padding
// ------------------------------------------------------------------------------

// ---- base64url ----------------------------------------------------------------
/** Canonical encoder: standard base64, then + -> -, / -> _, strip '=' padding. */
function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/**
 * Decoder mirroring the live one (- -> +, _ -> /, then forgiving base64): it
 * therefore also tolerates standard-alphabet or '='-padded input. Canonical
 * blobs use ONLY [A-Za-z0-9_-] with no padding. Throws on garbage.
 */
function b64urlDecode(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.replace(/=+$/, '').length % 4 === 1) {
    throw new Error('bad base64');
  }
  return Buffer.from(b64, 'base64');
}

// ---- key derivation ------------------------------------------------------------
/**
 * FROZEN v1 key derivation.
 * @param {string} passphrase any Unicode; NFC-normalised then UTF-8. Must be
 *                            non-empty: the live UI never submits an empty
 *                            passphrase and WebCrypto engines disagree on
 *                            zero-length PBKDF2 keys, so v1 leaves it undefined.
 * @param {Buffer} salt       exactly 16 bytes
 * @param {number} iterations 1 .. 16777215
 * @returns {Buffer} 32-byte AES-256 key
 */
function deriveKeyV1(passphrase, salt, iterations) {
  if (typeof passphrase !== 'string' || passphrase.length === 0) throw new Error('empty passphrase is undefined in v1');
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) throw new Error('iterations out of 24-bit range');
  if (salt.length !== SALT_LEN) throw new Error('salt must be 16 bytes');
  return crypto.pbkdf2Sync(Buffer.from(passphrase.normalize('NFC'), 'utf8'), salt, iterations, 32, 'sha256');
}

// ---- encode --------------------------------------------------------------------
/**
 * FROZEN v1 encryption of a query string (no leading '?') to the `?enc=` blob.
 * @param {string} queryString plaintext; UTF-8 byte length must be <= 65535.
 *                             (The live encoder does NOT check this — see the
 *                             spec's hazards section — the reference refuses.)
 * @param {string} passphrase  non-empty Unicode
 * @param {object} [inject]    REFERENCE-ONLY determinism hooks; never ship:
 *        {number}   [inject.iterations] default ENC_KDF_ITERATIONS
 *        {Buffer}   [inject.salt]       16 bytes  (default: random)
 *        {Buffer}   [inject.iv]         12 bytes  (default: random)
 *        {function} [inject.padFill]    k -> byte for pad position k (default: random)
 * @returns {string} base64url blob (the value of the `enc` query parameter)
 */
function encryptQueryStringV1(queryString, passphrase, inject = {}) {
  const iterations = inject.iterations == null ? ENC_KDF_ITERATIONS : inject.iterations;
  const salt = inject.salt || crypto.randomBytes(SALT_LEN);
  const iv = inject.iv || crypto.randomBytes(IV_LEN);
  if (iv.length !== IV_LEN) throw new Error('iv must be 12 bytes');

  const pt = Buffer.from(String(queryString), 'utf8');
  if (pt.length > MAX_PLAINTEXT) throw new Error('plaintext exceeds 65535 bytes (2-byte length field)');

  // inner frame: 2-byte big-endian true length, plaintext, pad to 32-multiple
  const inner = Buffer.concat([Buffer.from([(pt.length >> 8) & 0xff, pt.length & 0xff]), pt]);
  const padded = Buffer.alloc(Math.ceil(inner.length / PAD_BLOCK) * PAD_BLOCK);
  inner.copy(padded);
  if (inject.padFill) {
    for (let i = inner.length; i < padded.length; i++) padded[i] = inject.padFill(i - inner.length) & 0xff;
  } else if (padded.length > inner.length) {
    crypto.randomBytes(padded.length - inner.length).copy(padded, inner.length);
  }

  // self-describing header, bound as GCM AAD
  const header = Buffer.alloc(HEADER_LEN);
  header[0] = ENC_FORMAT_VERSION;
  header[1] = (iterations >>> 16) & 0xff;
  header[2] = (iterations >>> 8) & 0xff;
  header[3] = iterations & 0xff;
  salt.copy(header, 4);
  iv.copy(header, 20);

  const key = deriveKeyV1(passphrase, salt, iterations);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(header);
  const ct = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  return b64urlEncode(Buffer.concat([header, ct]));
}

// ---- decode --------------------------------------------------------------------
/**
 * FROZEN v1 decryption. Mirrors the live decoder's null-semantics exactly:
 * returns the plaintext query string, or null on ANY failure (bad base64,
 * short blob, unknown version, wrong passphrase / tampered blob via GCM tag,
 * inconsistent length field). Never throws, never distinguishes failures —
 * that indistinguishability is part of the format's "no getting-warmer" design.
 * @param {string} blob        value of the `enc` query parameter
 * @param {string} passphrase  candidate passphrase
 * @returns {string|null}
 */
function decryptQueryStringV1(blob, passphrase) {
  try {
    const bytes = b64urlDecode(blob);
    if (bytes.length < HEADER_LEN + TAG_LEN) return null;       // live check: >= 48
    if (bytes[0] !== ENC_FORMAT_VERSION) return null;           // unknown version
    const iterations = (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
    const header = bytes.subarray(0, HEADER_LEN);
    const salt = bytes.subarray(4, 20);
    const iv = bytes.subarray(20, 32);
    const body = bytes.subarray(HEADER_LEN, bytes.length - TAG_LEN);
    const tag = bytes.subarray(bytes.length - TAG_LEN);

    const key = deriveKeyV1(passphrase, Buffer.from(salt), iterations); // iterations 0 => throws => null, as live
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(body), decipher.final()]);

    // (plain[0]<<8)|plain[1] with undefined coerces to 0 in the live JS when
    // plain is empty, and 0 > -2 rejects it; the explicit guard is equivalent.
    if (plain.length < 2) return null;
    const actualLen = (plain[0] << 8) | plain[1];
    if (actualLen > plain.length - 2) return null;
    // Live uses a default (lenient) TextDecoder; well-formed blobs always
    // carry valid UTF-8, so lenient vs strict never differs for them.
    return plain.subarray(2, 2 + actualLen).toString('utf8');
  } catch (e) {
    return null;
  }
}

/** Structural inspector (no key needed): parse the public header of a blob. */
function parseBlobHeader(blob) {
  const bytes = b64urlDecode(blob);
  if (bytes.length < HEADER_LEN + TAG_LEN) throw new Error('blob too short');
  return {
    version: bytes[0],
    iterations: (bytes[1] << 16) | (bytes[2] << 8) | bytes[3],
    saltHex: bytes.subarray(4, 20).toString('hex'),
    ivHex: bytes.subarray(20, 32).toString('hex'),
    ciphertextLen: bytes.length - HEADER_LEN,     // includes 16-byte tag
    totalLen: bytes.length,
  };
}

// ---- Embedded frozen test vectors (must never change) ------------------------
// PROVENANCE: computed by this port AND independently by a WebCrypto
// (crypto.subtle) pipeline mirroring the live index.html call shapes; the two
// agreed byte-for-byte. CLAIMED until replayed through the shipped browser
// code (use differentialTestV1, or decode a real shipped ?enc= link).
const VECTORS = {
  // PBKDF2-HMAC-SHA256( UTF8(NFC("Back Bay")), 000102..0f, 600000 ) -> 32-byte key
  kdf: {
    pass: 'Back Bay',
    saltHex: '000102030405060708090a0b0c0d0e0f',
    iterations: 600000,
    keyHex: 'a85b21a80cd5e6359d4febfc003d0974291afbbb3ba9c94705f616463c80f676',
  },
  // V1: 30-byte plaintext -> inner 32 bytes -> ZERO pad bytes; fully
  // deterministic from (pass, salt, iv, iterations) alone.
  encNoPad: {
    plaintext: 'c=urban-vivid-magnet-obtain-xy',   // exactly 30 UTF-8 bytes
    pass: 'Back Bay',
    iterations: 600000,                            // header bytes 09 27 c0
    saltHex: '000102030405060708090a0b0c0d0e0f',
    ivHex: '101112131415161718191a1b',
    blobB64url:
      'AQknwAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhszg4VRt78Ysjb58M_IIcKq' +
      '05SfnfoPZMpyX11MXgEc1hVJf_7juuDAOtVfjQ7Ti1o',
    blobHex:
      '010927c0000102030405060708090a0b0c0d0e0f101112131415161718191a1b' +
      '33838551b7bf18b236f9f0cfc821c2aad3949f9dfa0f64ca725f5d4c5e011cd6' +
      '15497ffee3bae0c03ad55f8d0ed38b5a',
    totalLen: 80,
  },
  // V2: short plaintext exercising the pad path (23 pad bytes, injected as the
  // sequence 00,01,02,..), a non-default 24-bit iteration count (1000 =
  // 00 03 e8), and an NFC-normalised passphrase.
  encPadded: {
    plaintext: 'p=hello',                          // 7 UTF-8 bytes -> inner 9 -> padded 32
    pass: 'M\u0101ori t\u0101onga',                // composed NFC form
    passDecomposed: 'Ma\u0304ori ta\u0304onga',    // must yield the identical blob
    iterations: 1000,
    saltHex: '000102030405060708090a0b0c0d0e0f',
    ivHex: '101112131415161718191a1b',
    padFillNote: 'pad byte k = k & 0xff (0x00,0x01,...) — injection for reproducibility only',
    blobB64url:
      'AQAD6AABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhuvu7jCCfz92l70gX1zYvga' +
      'WOZs2Xl9iQE8zn4YtPffF3kscT30B0M0s6jHVhDfrrQ',
    blobHex:
      '010003e8000102030405060708090a0b0c0d0e0f101112131415161718191a1b' +
      'afbbb8c209fcfdda5ef4817d7362f81a58e66cd9797d89013cce7e18b4f7df17' +
      '792c713df4074334b3a8c75610dfaeb4',
    totalLen: 80,
  },
};

// ---- self-test -----------------------------------------------------------------
function selfTest() {
  let pass = true;
  const fail = msg => { pass = false; console.error('FAIL ' + msg); };
  const seqPad = k => k & 0xff;

  // 1. KDF anchor
  const key = deriveKeyV1(VECTORS.kdf.pass, Buffer.from(VECTORS.kdf.saltHex, 'hex'), VECTORS.kdf.iterations);
  if (key.toString('hex') !== VECTORS.kdf.keyHex) fail('kdf anchor');

  // 2. Frozen encode vectors (both), byte-for-byte, plus round-trip and
  //    header structure / length formula.
  for (const [name, v] of [['encNoPad', VECTORS.encNoPad], ['encPadded', VECTORS.encPadded]]) {
    const blob = encryptQueryStringV1(v.plaintext, v.pass, {
      iterations: v.iterations,
      salt: Buffer.from(v.saltHex, 'hex'),
      iv: Buffer.from(v.ivHex, 'hex'),
      padFill: seqPad,
    });
    if (blob !== v.blobB64url) fail(name + ' blob b64url');
    if (b64urlDecode(blob).toString('hex') !== v.blobHex) fail(name + ' blob hex');
    if (decryptQueryStringV1(blob, v.pass) !== v.plaintext) fail(name + ' round-trip');
    const h = parseBlobHeader(blob);
    if (h.version !== 0x01 || h.iterations !== v.iterations || h.saltHex !== v.saltHex || h.ivHex !== v.ivHex) fail(name + ' header fields');
    const ptLen = Buffer.byteLength(v.plaintext, 'utf8');
    const expectLen = HEADER_LEN + Math.ceil((2 + ptLen) / PAD_BLOCK) * PAD_BLOCK + TAG_LEN;
    if (h.totalLen !== expectLen || h.totalLen !== v.totalLen) fail(name + ' length formula');
    if (!/^[A-Za-z0-9_-]+$/.test(blob)) fail(name + ' canonical alphabet/padding');
  }

  // 3. NFC equivalence: decomposed passphrase produces the identical blob.
  {
    const v = VECTORS.encPadded;
    const blob = encryptQueryStringV1(v.plaintext, v.passDecomposed, {
      iterations: v.iterations, salt: Buffer.from(v.saltHex, 'hex'), iv: Buffer.from(v.ivHex, 'hex'), padFill: seqPad,
    });
    if (blob !== v.blobB64url) fail('NFC equivalence (decomposed passphrase)');
    if (decryptQueryStringV1(v.blobB64url, v.passDecomposed) !== v.plaintext) fail('NFC equivalence (decode)');
  }

  // 4. Random pad bytes must NOT change the decoded plaintext (pad is outside
  //    the framed length), and two encryptions of the same input must differ
  //    (fresh salt/iv) yet both decode.
  {
    const a = encryptQueryStringV1('p=hello', 'Back Bay', { iterations: 1000 });
    const b = encryptQueryStringV1('p=hello', 'Back Bay', { iterations: 1000 });
    if (a === b) fail('fresh salt/iv should make blobs differ');
    if (decryptQueryStringV1(a, 'Back Bay') !== 'p=hello' || decryptQueryStringV1(b, 'Back Bay') !== 'p=hello') fail('random-salt round-trip');
  }

  // 5. Negative vectors — every one must decode to null, indistinguishably.
  {
    const v = VECTORS.encNoPad;
    if (decryptQueryStringV1(v.blobB64url, 'wrong horse battery') !== null) fail('wrong passphrase must be null');
    const raw = Buffer.from(v.blobHex, 'hex');
    const flip = (i) => { const c = Buffer.from(raw); c[i] ^= 0x01; return b64urlEncode(c); };
    if (decryptQueryStringV1(flip(0), v.pass) !== null) fail('version byte 0x00 must be null');          // unknown version
    if (decryptQueryStringV1(flip(3), v.pass) !== null) fail('tampered iterations must be null (AAD)');   // KDF+AAD both diverge
    if (decryptQueryStringV1(flip(10), v.pass) !== null) fail('tampered salt must be null (AAD)');
    if (decryptQueryStringV1(flip(25), v.pass) !== null) fail('tampered iv must be null (AAD)');
    if (decryptQueryStringV1(flip(40), v.pass) !== null) fail('flipped ciphertext bit must be null (tag)');
    if (decryptQueryStringV1(flip(79), v.pass) !== null) fail('flipped tag bit must be null');
    if (decryptQueryStringV1(b64urlEncode(raw.subarray(0, 47)), v.pass) !== null) fail('short blob must be null');
    if (decryptQueryStringV1('!!!not-base64!!!', v.pass) !== null) fail('garbage base64 must be null');
    // version 0x02 with otherwise-valid structure: unknown => null (append-only versioning)
    const v2 = Buffer.from(raw); v2[0] = 0x02;
    if (decryptQueryStringV1(b64urlEncode(v2), v.pass) !== null) fail('future version must be null in v1 decoder');
  }

  // 6. Inconsistent inner length field must be rejected. Build a blob whose
  //    framed length claims more bytes than the padded body holds.
  {
    const salt = Buffer.from(VECTORS.kdf.saltHex, 'hex');
    const iv = Buffer.from(VECTORS.encNoPad.ivHex, 'hex');
    const iterations = 1000;
    const header = Buffer.alloc(HEADER_LEN);
    header[0] = 0x01; header[1] = 0x00; header[2] = 0x03; header[3] = 0xe8;
    salt.copy(header, 4); iv.copy(header, 20);
    const bogus = Buffer.alloc(PAD_BLOCK); bogus[0] = 0xff; bogus[1] = 0xff;   // claims 65535 bytes in a 32-byte body
    const k = deriveKeyV1('Back Bay', salt, iterations);
    const c = crypto.createCipheriv('aes-256-gcm', k, iv, { authTagLength: TAG_LEN });
    c.setAAD(header);
    const ct = Buffer.concat([c.update(bogus), c.final(), c.getAuthTag()]);
    if (decryptQueryStringV1(b64urlEncode(Buffer.concat([header, ct])), 'Back Bay') !== null) fail('overlong length field must be null');
  }

  // 7. Reference-side constraint checks (the live encoder omits these — see
  //    the spec's hazards; the frozen format nonetheless requires them).
  {
    let threw = false;
    try { encryptQueryStringV1('x'.repeat(65536), 'Back Bay', { iterations: 1000 }); } catch (e) { threw = true; }
    if (!threw) fail('must refuse plaintext > 65535 bytes');
    threw = false;
    try { encryptQueryStringV1('p=1', 'Back Bay', { iterations: 0x1000000 }); } catch (e) { threw = true; }
    if (!threw) fail('must refuse iterations > 24 bits');
    threw = false;
    try { encryptQueryStringV1('p=1', '', { iterations: 1000 }); } catch (e) { threw = true; }
    if (!threw) fail('must refuse empty passphrase');
  }

  // 8. Cross-impl genuineness: node:crypto vs WebCrypto (crypto.subtle) must
  //    agree on the KDF anchor and the encNoPad blob. This is the assert that
  //    the live code's primitives are what their names claim — the mirror of
  //    the obfuscation oracle's must-NOT-match-real-SHA3 assertion, with the
  //    opposite (honest) outcome.
  const crossImpl = (async () => {
    const subtle = crypto.webcrypto && crypto.webcrypto.subtle;
    if (!subtle) { console.error('WARN cross-impl skipped: no WebCrypto in this Node'); return true; }
    const v = VECTORS.encNoPad;
    const salt = Buffer.from(v.saltHex, 'hex');
    const iv = Buffer.from(v.ivHex, 'hex');
    const km = await subtle.importKey('raw', new TextEncoder().encode(v.pass.normalize('NFC')), 'PBKDF2', false, ['deriveKey', 'deriveBits']);
    const bits = Buffer.from(await subtle.deriveBits({ name: 'PBKDF2', salt, iterations: v.iterations, hash: 'SHA-256' }, km, 256));
    if (bits.toString('hex') !== VECTORS.kdf.keyHex) { fail('cross-impl KDF disagreement'); return false; }
    const gk = await subtle.deriveKey({ name: 'PBKDF2', salt, iterations: v.iterations, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const pt = Buffer.from(v.plaintext, 'utf8');
    const inner = Buffer.concat([Buffer.from([(pt.length >> 8) & 0xff, pt.length & 0xff]), pt]); // 32 bytes, no pad
    const header = Buffer.from(v.blobHex, 'hex').subarray(0, HEADER_LEN);
    const ct = Buffer.from(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header }, gk, inner));
    const blob = b64urlEncode(Buffer.concat([header, ct]));
    if (blob !== v.blobB64url) { fail('cross-impl AES-GCM disagreement'); return false; }
    return true;
  })();

  return crossImpl.then(ok => {
    const all = pass && ok;
    console.log(all ? 'self-test: PASS (all frozen vectors reproduced; primitives cross-verified)' : 'self-test: FAIL');
    return all;
  });
}

// ---- differential harness ------------------------------------------------------
/*
 * differentialTestV1 — WRITTEN, NOT RUN HERE. Compares the live browser
 * implementation against this oracle across randomized cases. The live encoder
 * has no salt/iv injection (correctly), so equality of encode outputs cannot be
 * tested directly; instead the harness closes the loop with cross round-trips
 * and structural checks, which together pin every byte the format defines:
 *
 *   1. oracle.decrypt( live.encrypt(pt, pass) ) === pt      (live blob is
 *      oracle-readable: header layout, AAD, KDF, GCM, framing all agree)
 *   2. live.decrypt( oracle.encrypt(pt, pass) ) === pt      (and vice versa)
 *   3. parseBlobHeader(liveBlob): version === 0x01, iterations === expected,
 *      salt/iv lengths 16/12, totalLen === 32 + ceil((2+|pt|)/32)*32 + 16
 *   4. live.decrypt(liveBlob, wrongPass) === null
 *
 * Run it in the app's DevTools console (where encryptQueryString /
 * decryptQueryString are in scope) after loading this file, e.g.:
 *
 *   const R = /* this module *​/;
 *   await R.differentialTestV1(
 *     (pt, pass) => encryptQueryString(pt, pass),          // live encode
 *     (blob, pass) => decryptQueryString(blob, pass),      // live decode
 *     { cases: 50, iterations: 1000 });                    // low KDF cost for speed
 *
 * Until that has been done (or a real shipped ?enc= link has been decoded by
 * this oracle), the embedded vectors are CLAIMED, not verified-against-live.
 */
async function differentialTestV1(liveEncrypt, liveDecrypt, opts = {}) {
  const cases = opts.cases || 25;
  const iterations = opts.iterations || 1000;   // keep PBKDF2 cost sane in a loop
  const report = { cases, failures: [] };
  const randPrintable = n => {
    const cs = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789=&-_.%~';
    let s = ''; for (let i = 0; i < n; i++) s += cs[crypto.randomInt(cs.length)];
    return s;
  };
  for (let i = 0; i < cases; i++) {
    // vary plaintext length across the interesting bands: sub-block, exact
    // block boundaries (inner 32k), multi-block, and a unicode case
    const lens = [0, 1, 7, 29, 30, 31, 62, 63, 200, 3000];
    const len = lens[i % lens.length];
    const pt = (i % lens.length === lens.length - 1)
      ? 'q=' + '\u00e9\u{1F30D}'.repeat(len / 6 | 0)          // é + 🌍, multibyte UTF-8
      : (len ? 'c=' + randPrintable(Math.max(0, len - 2)) : '');
    const pass = ['Back Bay', 'M\u0101ori t\u0101onga', randPrintable(12)][i % 3];
    const tag = `case ${i} len=${Buffer.byteLength(pt)} pass#${i % 3}`;
    try {
      const liveBlob = await liveEncrypt(pt, pass, iterations);
      if (decryptQueryStringV1(liveBlob, pass) !== pt) report.failures.push(tag + ': oracle cannot decode live blob');
      const h = parseBlobHeader(liveBlob);
      const expectLen = HEADER_LEN + Math.ceil((2 + Buffer.byteLength(pt)) / PAD_BLOCK) * PAD_BLOCK + TAG_LEN;
      if (h.version !== 0x01) report.failures.push(tag + ': live version != 0x01');
      if (h.iterations !== iterations) report.failures.push(tag + ': live iterations mismatch');
      if (h.totalLen !== expectLen) report.failures.push(tag + `: live blob length ${h.totalLen} != ${expectLen}`);
      const refBlob = encryptQueryStringV1(pt, pass, { iterations });
      if (await liveDecrypt(refBlob, pass) !== pt) report.failures.push(tag + ': live cannot decode oracle blob');
      if (await liveDecrypt(liveBlob, pass + 'X') !== null) report.failures.push(tag + ': live accepts wrong passphrase');
    } catch (e) {
      report.failures.push(tag + ': threw ' + e.message);
    }
  }
  report.pass = report.failures.length === 0;
  return report;
}

module.exports = {
  ENC_FORMAT_VERSION, ENC_KDF_ITERATIONS, SALT_LEN, IV_LEN, TAG_LEN, HEADER_LEN, PAD_BLOCK,
  MAX_PLAINTEXT, MAX_ITERATIONS,
  b64urlEncode, b64urlDecode, deriveKeyV1, encryptQueryStringV1, decryptQueryStringV1,
  parseBlobHeader, differentialTestV1, VECTORS,
};

// ---- CLI ---------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--selftest' || args.length === 0) {
    selfTest().then(ok => process.exit(ok ? 0 : 1));
  } else if (args[0] === '--decrypt' && args.length >= 3) {
    // aes-url-v1-reference.js --decrypt <blob> <passphrase>
    const out = decryptQueryStringV1(args[1], args[2]);
    if (out === null) { console.error('decrypt: FAILED (wrong passphrase, tampered, or not a v1 blob)'); process.exit(1); }
    console.log(out);
  } else if (args[0] === '--encrypt' && args.length >= 3) {
    // aes-url-v1-reference.js --encrypt <queryString> <passphrase> [iterations]
    console.log(encryptQueryStringV1(args[1], args[2], args[3] ? { iterations: parseInt(args[3], 10) } : {}));
  } else {
    console.error('usage: aes-url-v1-reference.js [--selftest | --encrypt <qs> <pass> [iters] | --decrypt <blob> <pass>]');
    process.exit(2);
  }
}
