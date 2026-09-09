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
      // Immutable create. The rules forbid update, so a genuine overwrite attempt
      // is rejected server-side; an identical retry writes identical bytes (no-op
      // in effect). We do not read-before-write: that would cost an extra read and
      // the rules already guarantee no silent edit.
      await fb.setDoc(blobDoc(handle, hash), { b: bytesToB64(blobBytes) });
    }

    async function get(handle, hash) {
      assertHandle(handle); assertHash(hash);
      var snap = await fb.getDoc(blobDoc(handle, hash));
      if (!snap.exists()) return null;
      var data = snap.data();
      return data && typeof data.b === 'string' ? b64ToBytes(data.b) : null;
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
      qs.forEach(function (d) {
        var v = d.data();
        if (v && typeof v.b === 'string') items.push({ hash: d.id, blob: b64ToBytes(v.b) });
      });
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
  function memory() {
    var store = {};  // handle -> { hash -> Uint8Array }
    async function put(handle, hash, blobBytes) {
      assertHandle(handle); assertHash(hash);
      if (blobBytes.length > MAX_BLOB_BYTES) throw new Error('storage.put: blob too large');
      if (!store[handle]) store[handle] = {};
      if (!(hash in store[handle])) store[handle][hash] = blobBytes.slice(); // immutable-ish
    }
    async function get(handle, hash) {
      assertHandle(handle); assertHash(hash);
      return (store[handle] && store[handle][hash]) ? store[handle][hash].slice() : null;
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
