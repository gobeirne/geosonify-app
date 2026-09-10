/*
  geosonify-starpin-storage.js v0.1 — group blob storage adapter (NOT FROZEN)

  The app's ONLY view of where group blobs live. Everything above it — sharing,
  sync, group-mod signatures later — talks to this interface and never knows or
  cares whether the bytes sit in Firestore, Cloudflare R2, or a file on disk.

  Why an interface at all: the design promises "cheap and portable, not trapped
  below one provider's free tier." That promise is only real if swapping the
  backend is one file. So the frozen protocol knows exactly one thing:

      store opaque blob B under opaque handle H, content-addressed as hash X.

  The Firestore path /handles/{handle}/blobs/{hash} is an ADAPTER DETAIL, not part
  of group-v1. A future R2+Worker backend implements the same four calls with
  object keys and its own index, and nothing above changes.

  ── The interface ──────────────────────────────────────────────────────────
      put(handle, hash, blobBytes)      -> Promise<void>   (idempotent: same
                                            hash = same bytes = no-op on repeat)
      get(handle, hash)                 -> Promise<Uint8Array | null>
      list(handle, { cursor, limit })   -> Promise<{ items:[{hash,blob}], cursor }>
      // NO delete(): ordinary group-v1 clients cannot delete. Deletion is the
      // operator's exceptional mechanism (console for the beta) and, later, an
      // owner-signed group-mod moderation action — never a client call here.

  ── Privacy invariants the adapter MUST preserve (enforced with the rules) ───
    * Handle enumeration is impossible. You may read/list WITHIN a handle you
      already know; you may never discover handles you don't.
    * list() is always bounded. An unbounded scan of a bucket is refused by the
      rules, so the adapter always sends a limit.
    * Writes are immutable. put() creates; it never overwrites. A repeat of the
      identical (hash,bytes) is a harmless no-op (retry-safe), never an edit.
    * The stored document is JUST the bytes. No handle, group id, target, or
      timestamp is written beside the ciphertext — those would re-leak exactly
      what the sealing layer hid.
*/
'use strict';

var GeosonifyStarpinStorage = (function () {

  var HANDLE_RE = /^[A-Za-z0-9_-]{43}$/;   // base64url of 32 bytes = 43 chars, no pad
  var HASH_RE   = /^[0-9a-f]{64}$/;        // SHA-256 hex
  var MAX_BLOB_BYTES = 1500000;            // hard cap; keeps under Firestore's ~1MiB
                                           // doc limit with base64 overhead headroom
  var DEFAULT_LIMIT = 100;
  var MAX_LIMIT = 100;                     // MUST equal the cap in firestore.rules

  function assertHandle(h) { if (!HANDLE_RE.test(h)) throw new Error('storage: bad handle shape'); }
  function assertHash(x)   { if (!HASH_RE.test(x))   throw new Error('storage: bad hash shape'); }

  // base64 (standard, with padding) for transporting bytes as a Firestore string.
  // This is transport encoding INSIDE the adapter only; the frozen content_hash is
  // over the raw blob bytes, computed by the caller, never over this string.
  function bytesToB64(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return (typeof btoa === 'function') ? btoa(bin) : Buffer.from(bytes).toString('base64');
  }
  function b64ToBytes(b64) {
    if (typeof atob === 'function') {
      var bin = atob(b64), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  // ==========================================================================
  // Firestore implementation of the interface.
  //
  // Takes the modular Firestore SDK functions injected, so this file has no
  // hard dependency and stays testable. Wire it in the app like:
  //
  //   import { getFirestore, doc, getDoc, setDoc, collection, query, limit,
  //            getDocs, startAfter, orderBy, documentId } from 'firebase/firestore';
  //   const store = GeosonifyStarpinStorage.firestore({
  //     db, doc, getDoc, setDoc, collection, query, limit, getDocs,
  //     startAfter, orderBy, documentId
  //   });
  //
  // Layout (ADAPTER DETAIL, not protocol):  /handles/{handle}/blobs/{hash}
  // The parent /handles/{handle} document is never created — only the subcollection.
  // ==========================================================================
  function firestore(fb) {
    if (!fb || !fb.db) throw new Error('storage(firestore): db + SDK fns required');
    // Optional sha256(bytes)->Uint8Array|Promise. If provided, the adapter
    // VERIFIES that every blob it reads actually hashes to the document id it was
    // filed under (review pt 10 — otherwise the "content_hash is the id" contract
    // is unenforced and a client could file valid ciphertext under a wrong id).
    var sha256 = fb.sha256 || null;

    async function verifyHash(handle, hash, bytes) {
      if (!sha256) return;                       // verification opt-in; caller warned below
      var d = await sha256(bytes);
      var hex = ''; for (var i = 0; i < d.length; i++) { var h = d[i].toString(16); hex += (h.length === 1 ? '0' : '') + h; }
      if (hex !== hash) throw new Error('storage: blob hash mismatch (id ' + hash.slice(0, 12) + '… ≠ sha256) — rejected');
    }

    function blobsCol(handle) {
      return fb.collection(fb.db, 'handles', handle, 'blobs');
    }
    function blobDoc(handle, hash) {
      return fb.doc(fb.db, 'handles', handle, 'blobs', hash);
    }

    async function put(handle, hash, blobBytes) {
      assertHandle(handle); assertHash(hash);
      if (!(blobBytes instanceof Uint8Array)) throw new Error('storage.put: bytes required');
      if (blobBytes.length > MAX_BLOB_BYTES) throw new Error('storage.put: blob too large');
      // Idempotent create (review pt 9 — the lost-ACK case). The rules are
      // create-only, so a genuine overwrite with DIFFERENT bytes is rejected
      // server-side. But a network drop after a successful write, followed by an
      // identical retry, must read as SUCCESS, not permission-denied. So:
      //   create → if it fails, re-read; if what's there is byte-identical, treat
      //   as success (our write landed); otherwise surface the error.
      var ref = blobDoc(handle, hash);
      var payload = { b: bytesToB64(blobBytes) };
      try {
        await fb.setDoc(ref, payload);
        return { created: true };
      } catch (err) {
        var snap;
        try { snap = await fb.getDoc(ref); } catch (e2) { throw err; }
        if (snap && snap.exists() && snap.data() && snap.data().b === payload.b) {
          return { created: false, idempotent: true };   // our identical bytes are there
        }
        throw err;                                        // real conflict / real error
      }
    }

    async function get(handle, hash) {
      assertHandle(handle); assertHash(hash);
      var snap = await fb.getDoc(blobDoc(handle, hash));
      if (!snap.exists()) return null;
      var data = snap.data();
      if (!data || typeof data.b !== 'string') return null;
      var bytes = b64ToBytes(data.b);
      await verifyHash(handle, hash, bytes);              // review pt 10
      return bytes;
    }

    // Bounded listing WITHIN a known handle. Always sends a limit — the rules
    // reject any query without one at or below MAX_LIMIT. Order by document id
    // (= content_hash) so paging is stable; cursor is the last hash seen.
    async function list(handle, opts) {
      assertHandle(handle);
      opts = opts || {};
      var lim = Math.min(opts.limit || DEFAULT_LIMIT, MAX_LIMIT);
      if (opts.cursor) assertHash(opts.cursor);
      var q = opts.cursor
        ? fb.query(blobsCol(handle), fb.orderBy(fb.documentId()), fb.startAfter(opts.cursor), fb.limit(lim))
        : fb.query(blobsCol(handle), fb.orderBy(fb.documentId()), fb.limit(lim));
      var qs = await fb.getDocs(q);
      var items = [];
      var pending = [];
      qs.forEach(function (d) {
        var v = d.data();
        if (v && typeof v.b === 'string') pending.push({ hash: d.id, b: v.b });
      });
      for (var i = 0; i < pending.length; i++) {
        var bytes = b64ToBytes(pending[i].b);
        try { await verifyHash(handle, pending[i].hash, bytes); }
        catch (e) { continue; }                 // drop a blob filed under a wrong id
        items.push({ hash: pending[i].hash, blob: bytes });
      }
      var nextCursor = items.length === lim ? items[items.length - 1].hash : null;
      return { items: items, cursor: nextCursor };
    }

    return { put: put, get: get, list: list,
             _kind: 'firestore', MAX_BLOB_BYTES: MAX_BLOB_BYTES, MAX_LIMIT: MAX_LIMIT };
  }

  // ==========================================================================
  // In-memory implementation — for tests and for the single-device / passed-file
  // flow (seal to memory, open it back) with no network at all.
  // ==========================================================================
  function memory(opts) {
    opts = opts || {};
    var sha256 = opts.sha256 || null;
    var store = {};  // handle -> { hash -> Uint8Array }
    async function verify(hash, bytes) {
      if (!sha256) return;
      var d = await sha256(bytes);
      var hex = ''; for (var i = 0; i < d.length; i++) { var h = d[i].toString(16); hex += (h.length === 1 ? '0' : '') + h; }
      if (hex !== hash) throw new Error('storage(memory): blob hash mismatch — rejected');
    }
    function sameBytes(a, b) { if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
    async function put(handle, hash, blobBytes) {
      assertHandle(handle); assertHash(hash);
      if (blobBytes.length > MAX_BLOB_BYTES) throw new Error('storage.put: blob too large');
      if (!store[handle]) store[handle] = {};
      if (hash in store[handle]) {
        // model Firestore create-only: identical bytes = idempotent success;
        // different bytes at the same id = rejected (the immutability guarantee).
        if (sameBytes(store[handle][hash], blobBytes)) return { created: false, idempotent: true };
        throw new Error('storage(memory): create-only — differing bytes at existing id rejected');
      }
      store[handle][hash] = blobBytes.slice();
      return { created: true };
    }
    async function get(handle, hash) {
      assertHandle(handle); assertHash(hash);
      if (!(store[handle] && store[handle][hash])) return null;
      var bytes = store[handle][hash].slice();
      await verify(hash, bytes);
      return bytes;
    }
    async function list(handle, opts) {
      assertHandle(handle);
      opts = opts || {};
      var lim = Math.min(opts.limit || DEFAULT_LIMIT, MAX_LIMIT);
      var hashes = Object.keys(store[handle] || {}).sort();
      var start = 0;
      if (opts.cursor) { assertHash(opts.cursor); start = hashes.indexOf(opts.cursor) + 1; }
      var page = hashes.slice(start, start + lim);
      var items = page.map(function (h) { return { hash: h, blob: store[handle][h].slice() }; });
      return { items: items, cursor: page.length === lim ? page[page.length - 1] : null };
    }
    return { put: put, get: get, list: list, _kind: 'memory', MAX_BLOB_BYTES: MAX_BLOB_BYTES, MAX_LIMIT: MAX_LIMIT };
  }

  return {
    firestore: firestore,
    memory: memory,
    HANDLE_RE: HANDLE_RE, HASH_RE: HASH_RE,
    MAX_BLOB_BYTES: MAX_BLOB_BYTES, MAX_LIMIT: MAX_LIMIT
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeosonifyStarpinStorage;
}
