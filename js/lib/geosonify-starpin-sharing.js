/*
  geosonify-starpin-sharing.js v0.1 — group-v1 sharing layer (NOT FROZEN)

  Turns "I have a find" into "my family can see it," and back. This is the layer
  that sits between the record log, the sealing module, and the storage adapter.

  Scope: the BEARER-CODE group-v1 profile — family and friends who share one code.
  No owner keys, no roster, no signatures (that is group-mod/1, later). Authorship
  here is self-asserted: anyone with the code can write a share claiming any member
  handle. That is fine for a trusted circle and is stated plainly to the user.

  Three things live here:

    1. group-share/1 WRAPPER — what actually gets sealed. It carries the whole
       immutable record plus how it was presented to this group:
         { schema:'starpin.group-share/1',
           publication_id,          // random; identifies THIS share into THIS group
           record,                  // the complete starpin.record/1 (incl. record_id)
           member: { member_id, handle },   // self-asserted display identity
           comment }                // optional plain text (rendered via textContent)
       Identifier discipline (frozen intent from the design):
         - record_id   → the EVENT. Sealed. Readers dedup on it. Never a storage
                         key, never a public identifier.
         - publication_id → THIS publication into THIS group. Random, group-specific.
                         What moderation/campaign overrides would name later.
         - content_hash → the BLOB bytes. The storage key + idempotency token.

    2. LOCAL STORES (localStorage; the app's own, not the shared backend):
         starpin.groups.v1  group_uuid -> { epoch, endpoint, label, group_key_b64 }
         starpin.sync.v1    record_id  -> [ { group_uuid, epoch, content_hash,
                                              publication_id, dir:'out'|'in' } ]
       groups.v1 caches the derived group_key so Argon2 runs once per unlock, not
       per share (per the addendum). sync.v1 is what makes re-sharing idempotent
       and powers "shared to: Family, Class 4B" without touching the record.

    3. TARGET-SCOPED SYNC — the read loop. group-v1 handles are per-target, and
       handle enumeration is (deliberately) impossible, so you sync a target when
       you look at it: derive its handle, bounded-list, open the new blobs, merge
       into the log. This matches "you reach a starpin and see who came before."
       A cross-target "everything my family shared" feed needs a shared target
       index — NOT built here; see DISCOVERY LIMIT below.

  Everything is async (sealing + storage are). Primitives (Argon2/XChaCha) are
  injected into the sealing module by the caller, exactly as elsewhere.
*/
'use strict';

var GeosonifyStarpinSharing = (function () {

  var SHARE_SCHEMA = 'starpin.group-share/1';
  var GROUPS_STORE = 'starpin.groups.v1';
  var SYNC_STORE   = 'starpin.sync.v1';

  // ---- canonical target: the ONE stable string a handle is derived from ----
  // A record's target is {starpin:"..."} or {cornerstone:"..."} plus noisy
  // coordinate/brightness fields. The handle must derive identically on every
  // device, so it uses ONLY the identifier, never the noisy fields.
  // FROZEN forms: "starpin:<id>" and "cornerstone:<id>" (the id already carries
  // its own prefix in the data, e.g. "starpin:gdr3:…", "V:f9…"; we prepend the
  // kind so the two namespaces can never collide).
  function canonicalTarget(target) {
    if (!target || typeof target !== 'object')
      throw new Error('sharing: record has no target');
    if (typeof target.starpin === 'string')     return 'starpin|' + target.starpin;
    if (typeof target.cornerstone === 'string') return 'cornerstone|' + target.cornerstone;
    throw new Error('sharing: target names neither a starpin nor a cornerstone');
  }

  // ---- canonical JSON (sorted keys, no whitespace) — same shape as the log ---
  // NOTE: like the log module's canonical(), this is a stand-in for RFC 8785
  // (JCS). It MUST be pinned to JCS before any cross-implementation exchange is
  // frozen; for a single-app beta it is self-consistent.
  function canonical(v) {
    if (v === null || typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ':' + canonical(v[k]);
    }).join(',') + '}';
  }

  // ---- small utils ---------------------------------------------------------
  var te = new TextEncoder(), td = new TextDecoder();
  function rand(n) {
    var b = new Uint8Array(n);
    (typeof crypto !== 'undefined' ? crypto : require('crypto').webcrypto).getRandomValues(b);
    return b;
  }
  function b64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var s = (typeof btoa === 'function') ? btoa(bin) : Buffer.from(bytes).toString('base64');
    return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    if (typeof atob === 'function') {
      var bin = atob(s), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(s, 'base64'));
  }

  // ---- localStorage shim (works in Node tests via an injected store) --------
  function ls() {
    if (typeof localStorage !== 'undefined') return localStorage;
    throw new Error('sharing: no localStorage; inject one for tests');
  }
  function readJSON(store, key, fallback) {
    try { var raw = store.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch (_) { return fallback; }
  }
  function writeJSON(store, key, val) { store.setItem(key, JSON.stringify(val)); }

  // ==========================================================================
  // create() — bind the sealing module (G), the storage adapter (store), the
  // record log (log, for merge), and optionally a localStorage-like object.
  // ==========================================================================
  function create(deps) {
    deps = deps || {};
    var G = deps.group;        // a GeosonifyStarpinGroup.create({...}) instance
    var store = deps.store;    // a GeosonifyStarpinStorage backend (put/get/list)
    var log = deps.log;        // the record log (needs merge(jsonString))
    var storage = deps.localStorage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!G) throw new Error('sharing: group sealing module required');
    if (!store) throw new Error('sharing: storage adapter required');
    if (!storage) throw new Error('sharing: localStorage (or injected) required');

    // ---- group registry ---------------------------------------------------
    function listGroups() { return readJSON(storage, GROUPS_STORE, {}); }
    function getGroup(groupUuid) { return listGroups()[groupUuid] || null; }

    // Join / create a group: derive the group_key ONCE (Argon2) and cache it.
    // groupUuid is 16 bytes (b64url in storage); code is the bearer secret; epoch
    // starts at 1. For the beta, "create" and "join" are the same operation — you
    // either invent the code+uuid or receive them.
    async function joinGroup(opts) {
      var groupUuidBytes = opts.groupUuidBytes || b64urlToBytes(opts.groupUuid);
      var epoch = opts.epoch || 1;
      var gk = await G.groupKey(opts.code, groupUuidBytes, epoch);   // Argon2 — once
      var groups = listGroups();
      var uuidKey = b64url(groupUuidBytes);
      groups[uuidKey] = {
        epoch: epoch,
        endpoint: opts.endpoint || null,
        label: opts.label || '',
        group_key_b64: b64url(gk)          // cached; code itself is NOT stored
      };
      writeJSON(storage, GROUPS_STORE, groups);
      return { groupUuid: uuidKey, epoch: epoch };
    }

    function createGroup(opts) {
      // invent a fresh uuid; caller supplies/ää generates the code and shares it.
      var uuid = rand(16);
      return joinGroup({
        groupUuidBytes: uuid, code: opts.code, epoch: 1,
        endpoint: opts.endpoint, label: opts.label
      }).then(function (r) { return { groupUuid: r.groupUuid, groupUuidBytes: uuid, epoch: 1 }; });
    }

    function groupKeyBytes(groupUuid) {
      var g = getGroup(groupUuid);
      if (!g) throw new Error('sharing: unknown group ' + groupUuid);
      return b64urlToBytes(g.group_key_b64);
    }

    // ---- sync registry ----------------------------------------------------
    function syncIndex() { return readJSON(storage, SYNC_STORE, {}); }
    function recordSharedTo(recordId, entry) {
      var idx = syncIndex();
      var arr = idx[recordId] || [];
      // idempotency: don't double-record the same (record, group, dir)
      var dup = arr.some(function (e) {
        return e.group_uuid === entry.group_uuid && e.dir === entry.dir &&
               (e.content_hash === entry.content_hash || e.publication_id === entry.publication_id);
      });
      if (!dup) { arr.push(entry); idx[recordId] = arr; writeJSON(storage, SYNC_STORE, idx); }
    }
    function sharesOf(recordId) { return syncIndex()[recordId] || []; }
    function isSharedOut(recordId, groupUuid) {
      return sharesOf(recordId).some(function (e) { return e.group_uuid === groupUuid && e.dir === 'out'; });
    }

    // ---- AAD (must match the sealing module's fixed field order) ----------
    function aadFor(groupUuid, handle) {
      return {
        schema: G.FROZEN.SCHEMA,               // 'starpin.group/1' (the sealed-object schema)
        target_handle: handle,
        group_uuid: groupUuid,                 // b64url of the 16 uuid bytes
        epoch: getGroup(groupUuid).epoch,
        kdf: G.FROZEN.KDF_MARKER,
        cipher: G.FROZEN.CIPHER_MARKER
      };
    }

    // ======================================================================
    // SHARE (write side)
    // ======================================================================
    async function shareRecord(groupUuid, record, opts) {
      opts = opts || {};
      var g = getGroup(groupUuid);
      if (!g) throw new Error('sharing: unknown group ' + groupUuid);

      // idempotent: already shared this exact record to this group? no-op.
      if (isSharedOut(record.record_id, groupUuid)) {
        return { skipped: true, reason: 'already shared to this group' };
      }

      var gk = groupKeyBytes(groupUuid);
      var ct = canonicalTarget(record.target);
      var handle = await G.targetHandle(gk, ct);

      var wrapper = {
        schema: SHARE_SCHEMA,
        publication_id: b64url(rand(16)),      // random; NOT the record_id
        record: record,                        // full immutable record (incl. record_id)
        member: {
          member_id: opts.memberId || 'local', // self-asserted in bearer-code group-v1
          handle: opts.handle || 'me'
        }
      };
      if (typeof opts.comment === 'string' && opts.comment.length) wrapper.comment = opts.comment;

      var plaintext = te.encode(canonical(wrapper));
      var recordSalt = rand(32), nonce = rand(24);
      var aad = aadFor(groupUuid, handle);
      var sealed = await G.seal(gk, aad, recordSalt, nonce, plaintext);

      await store.put(handle, sealed.content_hash, sealed.blob);
      recordSharedTo(record.record_id, {
        group_uuid: groupUuid, epoch: g.epoch,
        content_hash: sealed.content_hash, publication_id: wrapper.publication_id,
        dir: 'out'
      });
      return { skipped: false, handle: handle, content_hash: sealed.content_hash,
               publication_id: wrapper.publication_id };
    }

    // ======================================================================
    // SYNC (read side) — target-scoped. Derive the handle for ONE target in ONE
    // group, page through its blobs, open the new ones, merge into the log.
    // Returns the group-share wrappers newly seen (for UI: comments, who shared).
    // ======================================================================
    async function syncTarget(groupUuid, target, opts) {
      opts = opts || {};
      var g = getGroup(groupUuid);
      if (!g) throw new Error('sharing: unknown group ' + groupUuid);
      var gk = groupKeyBytes(groupUuid);
      var ct = (typeof target === 'string') ? target : canonicalTarget(target);
      var handle = await G.targetHandle(gk, ct);
      var aad = aadFor(groupUuid, handle);

      var seenHashes = {};
      sharesInAtHandle(groupUuid, handle).forEach(function (h) { seenHashes[h] = true; });

      var fresh = [];
      var cursor = null, guard = 0;
      do {
        var page = await store.list(handle, { limit: 100, cursor: cursor });
        for (var i = 0; i < page.items.length; i++) {
          var item = page.items[i];
          if (seenHashes[item.hash]) continue;         // already have it
          var plaintext;
          try {
            plaintext = await G.open(gk, aad, item.blob);   // throws on bad tag/AAD
          } catch (e) { continue; }                     // not ours / corrupt: skip
          var wrapper;
          try { wrapper = JSON.parse(td.decode(plaintext)); } catch (e) { continue; }
          if (!wrapper || wrapper.schema !== SHARE_SCHEMA || !wrapper.record) continue;

          // merge the record into the log (set-union by record_id) unless it's
          // our own coming back. dir:'in' so the UI can distinguish.
          if (log && typeof log.merge === 'function') {
            log.merge(JSON.stringify({ schema: 'starpin.export/1', records: [wrapper.record] }));
          }
          recordSharedTo(wrapper.record.record_id, {
            group_uuid: groupUuid, epoch: g.epoch,
            content_hash: item.hash, publication_id: wrapper.publication_id, dir: 'in'
          });
          fresh.push({ wrapper: wrapper, content_hash: item.hash });
        }
        cursor = page.cursor;
      } while (cursor && ++guard < 20);

      return { handle: handle, fresh: fresh, count: fresh.length };
    }

    // which content_hashes at a given handle have we already processed for this
    // group (in either direction)? derived from the sync index.
    function sharesInAtHandle(groupUuid, handle) {
      var out = [];
      var idx = syncIndex();
      Object.keys(idx).forEach(function (rid) {
        idx[rid].forEach(function (e) {
          if (e.group_uuid === groupUuid && e.content_hash) out.push(e.content_hash);
        });
      });
      return out;
    }

    // Convenience: sync the same target across every known group.
    async function syncTargetAllGroups(target) {
      var res = [];
      var groups = listGroups();
      for (var uuid in groups) if (groups.hasOwnProperty(uuid)) {
        res.push({ groupUuid: uuid, result: await syncTarget(uuid, target) });
      }
      return res;
    }

    return {
      // groups
      createGroup: createGroup, joinGroup: joinGroup,
      listGroups: listGroups, getGroup: getGroup,
      // sharing
      shareRecord: shareRecord,
      syncTarget: syncTarget, syncTargetAllGroups: syncTargetAllGroups,
      // introspection for UI ("shared to: …")
      sharesOf: sharesOf,
      // exposed for tests / advanced callers
      canonicalTarget: canonicalTarget, canonical: canonical
    };
  }

  return { create: create, SHARE_SCHEMA: SHARE_SCHEMA,
           GROUPS_STORE: GROUPS_STORE, SYNC_STORE: SYNC_STORE,
           canonicalTarget: canonicalTarget };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeosonifyStarpinSharing;
}

/*
  ── DISCOVERY LIMIT (read this before wiring a "family feed") ────────────────
  group-v1 handles are per-target and handle enumeration is impossible by design.
  So syncTarget() only finds shares at a target you already name. That is exactly
  right for "reach a starpin, see who's been here." It does NOT give "show me
  everywhere my family has been" — that needs a shared, per-group target index
  (an encrypted list of targets the group has touched), which is a deliberate
  future addition, not a bug. Keep the feed scoped to targets the user browses
  until that index exists.

  ── AUTHORSHIP LIMIT (say this to the user) ─────────────────────────────────
  In bearer-code group-v1 the member handle is self-asserted: anyone with the
  code can write a share as any name, and can copy anything they can read. Fine
  for family/friends. Real attribution + moderation is group-mod/1.
*/
