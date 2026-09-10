/*
  geosonify-starpin-portable.js v0.1 — portable identity vault (NOT FROZEN)

  Moves "who you are" — your group memberships, per-group identity, optionally
  your finds — to another device, or back onto THIS device after the browser
  loses localStorage (cache-bust, cleared data, a version change, iOS eviction).

  The bearer-code model has no accounts, so there is no "log in as the same
  person." Instead you carry a BUNDLE. This module encrypts that bundle under a
  passphrase into a VAULT, and offers three ways to move it:

    - FILE   : download / import a .json file. Survives anything localStorage
               doesn't — the robust backup path.
    - STRING : one copy-paste blob. Same content, clipboard transport.
    - RELAY  : device A pushes the vault to the shared storage backend under a
               one-time high-entropy TRANSFER CODE; device B enters the code and
               pulls it. The "generate a code, enter it" flow, for phone→laptop.

  ── Why the vault is SELF-DESCRIBING (important) ─────────────────────────────
  Unlike the frozen group-v1 profile (whose Argon2 params are a placeholder that
  WILL change), the vault carries its OWN kdf params in its header. So a vault
  made today stays decryptable by any future version that understands
  'starpin.portable-vault/1' and has Argon2id + XChaCha20 — the whole point of
  "survives version changes." The backup is deliberately decoupled from the
  group profile's evolving constants.

  ── Two different codes, different jobs (don't confuse them) ─────────────────
    group code    : human, sayable, LOW entropy. Membership. (FAMILY-7Q2X)
    transfer code : generated, HIGH entropy, one-time. Moves your WHOLE identity
                    (every group key you hold), so it must not be guessable and
                    is meant to be copied/scanned, never memorised.

  Primitives are injected (argon2id, xchacha20poly1305, and a hash for the relay
  handle), exactly as elsewhere.
*/
'use strict';

var GeosonifyStarpinPortable = (function () {

  var VAULT_SCHEMA = 'starpin.portable-vault/1';
  // Vault KDF params: chosen for a ONE-OFF operation (export/import/transfer),
  // so they can be heavier than the per-visit group profile. Self-described in
  // the header, so changing these later doesn't strand old vaults.
  var VAULT_ARGON2 = { t: 3, m: 65536 /* KiB = 64 MiB */, p: 1, dkLen: 32 };

  var te = new TextEncoder(), td = new TextDecoder();
  function rand(n) {
    var b = new Uint8Array(n);
    (typeof crypto !== 'undefined' ? crypto : require('crypto').webcrypto).getRandomValues(b);
    return b;
  }
  function b64(bytes) {
    var bin = ''; for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return (typeof btoa === 'function') ? btoa(bin) : Buffer.from(bytes).toString('base64');
  }
  function ub64(s) {
    if (typeof atob === 'function') { var bin = atob(s), o = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
    return new Uint8Array(Buffer.from(s, 'base64'));
  }
  function b64url(bytes) { return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

  function create(primitives) {
    primitives = primitives || {};
    var argon2id = primitives.argon2id;
    var xchacha  = primitives.xchacha20poly1305;
    var sha256   = primitives.sha256;          // for the relay handle derivation
    if (typeof argon2id !== 'function') throw new Error('portable: argon2id required');
    if (typeof xchacha  !== 'function') throw new Error('portable: xchacha20poly1305 required');

    // ---- VAULT: encrypt / decrypt a bundle under a passphrase -------------
    async function sealVault(bundle, passphrase) {
      if (!passphrase) throw new Error('portable.sealVault: passphrase required');
      var salt = rand(16), nonce = rand(24);
      var key = await argon2id(te.encode(String(passphrase)), salt,
        { t: VAULT_ARGON2.t, m: VAULT_ARGON2.m, p: VAULT_ARGON2.p, dkLen: VAULT_ARGON2.dkLen });
      var plaintext = te.encode(JSON.stringify(bundle));
      // AAD binds the header so params/schema can't be swapped under the tag.
      var header = {
        schema: VAULT_SCHEMA,
        kdf: { alg: 'argon2id', t: VAULT_ARGON2.t, m: VAULT_ARGON2.m, p: VAULT_ARGON2.p, salt: b64(salt) },
        cipher: 'xchacha20poly1305',
        nonce: b64(nonce)
      };
      var aad = te.encode(JSON.stringify(header));
      var ct = await xchacha(key, nonce).encrypt(plaintext, aad);
      header.ct = b64(ct);
      return header;                          // the vault object
    }

    // Hard bounds on KDF params, checked BEFORE running Argon2. The vault header
    // is self-describing but UNAUTHENTICATED until after key derivation (AAD is
    // verified by the AEAD, which needs the key first). So a forged header could
    // request absurd memory/time to turn "open this vault" into a resource-
    // exhaustion attack. Reject out-of-range params before spending any work.
    var KDF_LIMITS = { tMax: 10, mMaxKiB: 1048576 /* 1 GiB */, pMax: 4, saltMin: 8, saltMax: 64 };
    function assertKdfSane(kdf) {
      if (!kdf || kdf.alg !== 'argon2id') throw new Error('portable: unsupported or missing kdf');
      if (!(kdf.t >= 1 && kdf.t <= KDF_LIMITS.tMax)) throw new Error('portable: kdf t out of range');
      if (!(kdf.m >= 8 && kdf.m <= KDF_LIMITS.mMaxKiB)) throw new Error('portable: kdf m out of range');
      if (!(kdf.p >= 1 && kdf.p <= KDF_LIMITS.pMax)) throw new Error('portable: kdf p out of range');
      var saltLen;
      try { saltLen = ub64(kdf.salt).length; } catch (e) { throw new Error('portable: bad kdf salt'); }
      if (saltLen < KDF_LIMITS.saltMin || saltLen > KDF_LIMITS.saltMax) throw new Error('portable: kdf salt length out of range');
    }

    async function openVault(vault, passphrase) {
      if (!vault || vault.schema !== VAULT_SCHEMA) throw new Error('portable.openVault: not a vault');
      assertKdfSane(vault.kdf);                 // BEFORE Argon2 (resource-abuse guard)
      var salt = ub64(vault.kdf.salt), nonce = ub64(vault.nonce);
      var key = await argon2id(te.encode(String(passphrase)), salt,
        { t: vault.kdf.t, m: vault.kdf.m, p: vault.kdf.p, dkLen: 32 });   // params FROM the vault
      var header = { schema: vault.schema, kdf: { alg: vault.kdf.alg, t: vault.kdf.t, m: vault.kdf.m, p: vault.kdf.p, salt: vault.kdf.salt },
                     cipher: vault.cipher, nonce: vault.nonce };
      var aad = te.encode(JSON.stringify(header));
      var pt = await xchacha(key, nonce).decrypt(ub64(vault.ct), aad);    // throws on wrong passphrase
      return JSON.parse(td.decode(pt));
    }

    // ---- TRANSPORTS -------------------------------------------------------
    // file: a vault wrapped with a friendly filename hint.
    function toFile(vault) {
      var name = 'starpin-identity-' + new Date().toISOString().slice(0, 10) + '.json';
      return { filename: name, mime: 'application/json', text: JSON.stringify(vault, null, 2) };
    }
    function fromFileText(text) { return JSON.parse(text); }

    // string: single-line, url-safe-ish, prefixed so it's recognisable.
    function toString(vault) { return 'STARPIN1:' + b64(te.encode(JSON.stringify(vault))); }
    function fromString(s) {
      s = String(s).trim();
      if (s.indexOf('STARPIN1:') === 0) s = s.slice('STARPIN1:'.length);
      return JSON.parse(td.decode(ub64(s)));
    }

    // transfer code: high-entropy, hyphen-grouped for copy/scan (not memorising).
    // 20 chars of a 32-char alphabet ≈ 100 bits.
    var TCODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no confusables
    function generateTransferCode() {
      var buf = rand(20), out = '';
      for (var i = 0; i < 20; i++) {
        out += TCODE_ALPHABET[buf[i] % TCODE_ALPHABET.length];
        if (i % 5 === 4 && i < 19) out += '-';
      }
      return out;
    }

    // ---- RELAY: push/pull a vault through the shared storage backend ------
    // The transfer code is a single high-entropy user-visible secret, but we
    // DOMAIN-SEPARATE it into two subkeys via different HKDF info strings
    // (review pt 6): one derives the storage handle (where to look), a different
    // one is the vault passphrase (how to open). One secret, two cryptographic
    // jobs, not the same bytes doing both.
    //
    // DISPOSABILITY: a "transfer" must not be a permanent recovery key. The relay
    // reuses the blob store, but callers should delete the transfer object after a
    // successful pull. Clients can't delete via the group-v1 rules, so a relay
    // needs either its own rules namespace permitting owner/exact-path delete, or
    // an operator/TTL prune. Until that exists, this is flagged: relay objects
    // linger. See RELAY DISPOSABILITY note below.
    function normCode(transferCode) { return String(transferCode).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
    async function relayHandle(transferCode) {
      if (typeof sha256 !== 'function') throw new Error('portable.relay: sha256 required');
      var d = await sha256(te.encode('starpin-transfer-handle-v1|' + normCode(transferCode)));
      return b64url(d);                        // 43-char handle, adapter-shaped
    }
    async function relayPassphrase(transferCode) {
      if (typeof sha256 !== 'function') throw new Error('portable.relay: sha256 required');
      var d = await sha256(te.encode('starpin-transfer-key-v1|' + normCode(transferCode)));
      return 'relay:' + b64url(d);             // distinct from the handle derivation
    }
    async function relayHash(vaultBytes) {
      if (typeof sha256 !== 'function') throw new Error('portable.relay: sha256 required');
      var d = await sha256(vaultBytes);
      var s = ''; for (var i = 0; i < d.length; i++) { var h = d[i].toString(16); s += (h.length === 1 ? '0' : '') + h; }
      return s;
    }

    // push: seal under the DERIVED passphrase (not the raw code), store under the
    // DERIVED handle. Metadata-only by default (review pt 13): the caller decides
    // whether to include the log; a full-log vault can exceed the document size
    // limit, so includeLog must be a deliberate, size-checked choice upstream.
    async function pushTransfer(store, transferCode, bundle) {
      var pass = await relayPassphrase(transferCode);
      var vault = await sealVault(bundle, pass);
      var bytes = te.encode(JSON.stringify(vault));
      if (bytes.length > 900000)               // stay well under Firestore's ~1MiB doc
        throw new Error('portable.pushTransfer: vault too large for relay — exclude the log (metadata-only) or use file transport');
      var handle = await relayHandle(transferCode);
      var hash = await relayHash(bytes);
      await store.put(handle, hash, bytes);
      return { handle: handle, hash: hash, bytes: bytes.length };
    }

    // pull: find the vault at the derived handle, open with the derived passphrase.
    async function pullTransfer(store, transferCode) {
      var handle = await relayHandle(transferCode);
      var pass = await relayPassphrase(transferCode);
      var page = await store.list(handle, { limit: 10 });
      if (!page.items.length) throw new Error('portable.pullTransfer: no transfer found for that code');
      for (var i = 0; i < page.items.length; i++) {
        try {
          var vault = JSON.parse(td.decode(page.items[i].blob));
          return await openVault(vault, pass);
        } catch (e) { /* try next */ }
      }
      throw new Error('portable.pullTransfer: found data but could not open it (wrong code?)');
    }

    return {
      VAULT_SCHEMA: VAULT_SCHEMA,
      sealVault: sealVault, openVault: openVault,
      toFile: toFile, fromFileText: fromFileText,
      toString: toString, fromString: fromString,
      generateTransferCode: generateTransferCode,
      relayHandle: relayHandle,
      pushTransfer: pushTransfer, pullTransfer: pullTransfer
    };
  }

  return { create: create, VAULT_SCHEMA: VAULT_SCHEMA };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeosonifyStarpinPortable;
}
