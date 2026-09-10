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

    // keyring: an (epoch -> group_key_b64) map preserving historical keys, so a
    // restore or rotation never loses the ability to decrypt older material.
    // Backward-compatible: a group always keeps its flat current group_key_b64 too.
    function withKeyring(g) {
      var out = {}; for (var k in g) out[k] = g[k];
      out.keys = out.keys || {};
      if (g.group_key_b64 && g.epoch != null) out.keys[String(g.epoch)] = g.group_key_b64;
      return out;
    }
    function mergeKeyrings(a, b) {
      var out = withKeyring(a);
      var bk = withKeyring(b).keys;
      for (var e in bk) if (!out.keys[e]) out.keys[e] = bk[e];
      return out;
    }
    // resolve the key for a specific epoch (for decrypting historical material)
    function keyForEpoch(groupUuid, epoch) {
      var g = getGroup(groupUuid); if (!g) return null;
      if (g.keys && g.keys[String(epoch)]) return g.keys[String(epoch)];
      if (String(g.epoch) === String(epoch)) return g.group_key_b64;
      return null;
    }

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
      var existing = groups[uuidKey] || {};
      var keyring = (existing.keys) ? existing.keys : {};
      keyring[String(epoch)] = b64url(gk);       // preserve/accumulate this epoch's key
      groups[uuidKey] = {
        epoch: epoch,
        endpoint: opts.endpoint || existing.endpoint || null,
        label: opts.label || existing.label || '',
        group_key_b64: b64url(gk),         // current-epoch key (flat, backward-compatible)
        keys: keyring,                     // (epoch -> key) keyring, historical-preserving
        // stable per-group identity. Generated once and then PRESERVED across
        // re-joins on this device, so this device always contributes as the same
        // member. member_id is per-group (never global) to keep the no-cross-group
        // -correlator invariant. Both travel in the portable bundle so a second
        // device can adopt the SAME identity (see snapshotIdentity/restoreIdentity).
        member_id: opts.memberId || existing.member_id || b64url(rand(16)),
        handle: (opts.handle != null ? opts.handle : (existing.handle || ''))
      };
      writeJSON(storage, GROUPS_STORE, groups);
      return { groupUuid: uuidKey, epoch: epoch, member_id: groups[uuidKey].member_id };
    }

    function createGroup(opts) {
      // invent a fresh uuid; caller supplies or generates the code and shares it.
      var uuid = rand(16);
      return joinGroup({
        groupUuidBytes: uuid, code: opts.code, epoch: 1,
        endpoint: opts.endpoint, label: opts.label, handle: opts.handle
      }).then(function (r) { return { groupUuid: r.groupUuid, groupUuidBytes: uuid, epoch: 1, member_id: r.member_id }; });
    }

    // read/update this device's identity within a group
    function getIdentity(groupUuid) {
      var g = getGroup(groupUuid);
      return g ? { member_id: g.member_id, handle: g.handle } : null;
    }
    function setHandle(groupUuid, handle) {
      var groups = listGroups();
      if (!groups[groupUuid]) throw new Error('sharing: unknown group ' + groupUuid);
      groups[groupUuid].handle = handle || '';
      writeJSON(storage, GROUPS_STORE, groups);
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

    // ---- private ownership ledger (content_hash -> {group_uuid, publication_id, record_id})
    // Unforgeable "you": only my own device writes here, keyed by the content_hash
    // it actually produced. Carried in the portable bundle so "you" survives a
    // device move. Never derived from anything an attacker controls.
    var OWNED_STORE = 'starpin.owned.v1';
    function ownedIndex() { return readJSON(storage, OWNED_STORE, {}); }
    function markOwned(contentHash, meta) {
      var idx = ownedIndex();
      if (!idx[contentHash]) { idx[contentHash] = meta; writeJSON(storage, OWNED_STORE, idx); }
    }
    function ownsContentHash(contentHash) { return !!ownedIndex()[contentHash]; }

    // ---- publication ledger (review round 2, pt 1): the multi-device double-
    // publish guard. Keyed "group_uuid|record_id" -> {publication_id, content_hash}.
    // Synced through the personal channel, so a second device that has record R
    // via self-sync learns R was ALREADY published to this group and won't publish
    // a second (different-ciphertext) copy. This is the cross-device extension of
    // shareRecord's local isSharedOut() idempotency.
    var PUB_STORE = 'starpin.published.v1';
    function pubIndex() { return readJSON(storage, PUB_STORE, {}); }
    function pubKey(groupUuid, recordId) { return groupUuid + '|' + recordId; }
    function markPublished(groupUuid, recordId, meta) {
      var idx = pubIndex(); var k = pubKey(groupUuid, recordId);
      if (!idx[k]) { idx[k] = meta; writeJSON(storage, PUB_STORE, idx); }
    }
    function isPublished(groupUuid, recordId) { return !!pubIndex()[pubKey(groupUuid, recordId)]; }

    // ---- group cache (data-safety invariant): a SEPARATE, non-authoritative
    // store for records that arrived from OTHER people's group-shares. Kept apart
    // from the personal log so bearer-code group data can never inject into or
    // delete from your authoritative history. Keyed "group_uuid|record_id".
    // Append-only here too: a differing-bytes collision quarantines, never
    // overwrites.
    var GROUPCACHE_STORE = 'starpin.groupcache.v1';
    function groupCache() { return readJSON(storage, GROUPCACHE_STORE, {}); }
    function cacheGroupRecord(groupUuid, rec) {
      if (!rec || !rec.record_id) return;
      var idx = groupCache(); var k = groupUuid + '|' + rec.record_id;
      var incoming = canonical(rec);
      if (idx[k]) {
        if (idx[k].c !== incoming) {
          // same record_id, different bytes from the group: quarantine, don't clobber
          idx[k].conflicts = idx[k].conflicts || [];
          idx[k].conflicts.push(incoming);
          writeJSON(storage, GROUPCACHE_STORE, idx);
        }
        return;
      }
      idx[k] = { rec: rec, c: incoming };
      writeJSON(storage, GROUPCACHE_STORE, idx);
    }
    function groupRecordsAt(groupUuid) {
      var idx = groupCache(), out = [];
      Object.keys(idx).forEach(function (k) {
        if (k.indexOf(groupUuid + '|') === 0) out.push(idx[k].rec);
      });
      return out;
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
      // Checks BOTH the local out-marker AND the synced publication ledger, so a
      // second device that learned of the publication via personal sync won't
      // double-publish (review round 2, pt 1).
      if (isSharedOut(record.record_id, groupUuid) || isPublished(groupUuid, record.record_id)) {
        return { skipped: true, reason: 'already published to this group' };
      }

      var gk = groupKeyBytes(groupUuid);
      var ct = canonicalTarget(record.target);
      var handle = await G.targetHandle(gk, ct);

      var wrapper = {
        schema: SHARE_SCHEMA,
        publication_id: b64url(rand(16)),      // random; NOT the record_id
        record: record,                        // full immutable record (incl. record_id)
        member: {
          // default to this device's stable per-group identity; opts can override
          member_id: opts.memberId || g.member_id || 'local',
          handle: opts.handle || g.handle || 'me'
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
        member_id: wrapper.member.member_id,
        handle: wrapper.member.handle, comment: wrapper.comment || null,
        dir: 'out'
      });
      // PRIVATE OWNERSHIP LEDGER (review pt 4): record that THIS device produced
      // this exact ciphertext. "You" is decided from this, never from member_id
      // equality — a bearer-code holder can copy your member_id into their own
      // wrapper, but cannot produce different ciphertext under your content_hash.
      markOwned(sealed.content_hash, { group_uuid: groupUuid, publication_id: wrapper.publication_id, record_id: record.record_id });
      markPublished(groupUuid, record.record_id, { publication_id: wrapper.publication_id, content_hash: sealed.content_hash });
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

          // DATA-SAFETY INVARIANT: another person's decrypted group-share must
          // NEVER enter your authoritative personal record store. It goes into a
          // separate, non-authoritative group cache/view. An unauthenticated
          // bearer-code group must not be a route to inject records/tombstones
          // into your personal source of truth.
          cacheGroupRecord(groupUuid, wrapper.record);
          recordSharedTo(wrapper.record.record_id, {
            group_uuid: groupUuid, epoch: g.epoch,
            content_hash: item.hash, publication_id: wrapper.publication_id,
            member_id: (wrapper.member && wrapper.member.member_id) || null,
            handle: (wrapper.member && wrapper.member.handle) || null,
            comment: wrapper.comment || null,
            dir: 'in'
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

    // ---- portability: snapshot / restore this device's identity -----------
    // snapshotIdentity() returns the PLAINTEXT bundle: every group membership
    // (incl. the cached group_key and this device's per-group member_id + handle)
    // and optionally the record log. It is highly sensitive — the caller must
    // encrypt it (see geosonify-starpin-portable.js) before it ever leaves the
    // device. Schema is versioned so a future app can still read today's bundle.
    function snapshotIdentity(opts) {
      opts = opts || {};
      var bundle = {
        schema: 'starpin.portable/1',
        created_ms: Date.now(),
        groups: listGroups(),                 // {uuid -> {epoch,endpoint,label,group_key_b64,member_id,handle}}
        sync: opts.includeSync ? syncIndex() : null,
        owned: opts.includeOwned !== false ? ownedIndex() : null,
        published: opts.includePublished !== false ? pubIndex() : null,
        self: opts.includeSelf !== false ? readJSON(storage, 'starpin.self.v1', null) : null
      };
      if (opts.includeLog && log && typeof log.all === 'function') {
        bundle.log = { schema: 'starpin.export/1', records: log.all() };
      }
      return bundle;
    }

    // restoreIdentity() merges a bundle into this device. mode:
    //   'bundle-wins' (default) — bundle's membership/identity overwrites local
    //                             (what you want when adopting an identity on a
    //                              fresh device);
    //   'keep-local'            — only add groups not already present.
    // Records (if present) always merge via log.merge (set-union, no loss).
    // restoreIdentity() merges a bundle into this device. Default is
    // NON-DESTRUCTIVE / MONOTONIC (review pt 7): importing an OLD vault must never
    // silently downgrade newer local state or detach a working device.
    //   'safe' (default) — union groups; for a group already present, keep the
    //                      HIGHER epoch and never overwrite a newer key; adopt the
    //                      self-key only if none exists locally; conflicts are
    //                      reported, not resolved by clobbering.
    //   'overwrite'      — explicit destructive restore (bundle wins). Only for a
    //                      genuinely fresh device or a deliberate reset.
    // Records always merge via log.merge (set-union, lossless) regardless of mode.
    function restoreIdentity(bundle, opts) {
      opts = opts || {};
      var mode = opts.mode || 'safe';
      if (!bundle || bundle.schema !== 'starpin.portable/1')
        throw new Error('sharing.restoreIdentity: not a starpin.portable/1 bundle');

      var report = { groupsAdded: 0, groupsKept: 0, conflicts: [], records: 0, self: 'unchanged' };
      var local = listGroups();
      var incoming = bundle.groups || {};

      Object.keys(incoming).forEach(function (uuid) {
        var inc = incoming[uuid], cur = local[uuid];
        if (!cur) { local[uuid] = withKeyring(inc); report.groupsAdded++; return; }
        if (mode === 'overwrite') { local[uuid] = mergeKeyrings(withKeyring(inc), cur); report.groupsAdded++; return; }
        // safe mode: monotonic CURRENT epoch, but PRESERVE historical keys as a
        // keyring (review round 2, pt 2) — an old vault's epoch-3 key may be the
        // only thing that can decrypt historical epoch-3 material.
        var incEpoch = inc.epoch || 1, curEpoch = cur.epoch || 1;
        var merged = mergeKeyrings(cur, inc);           // union all (epoch->key) we've ever seen
        // conflict: same epoch, different key
        var ek = String(incEpoch);
        if (cur.keys && cur.keys[ek] && inc.group_key_b64 && cur.keys[ek] !== inc.group_key_b64)
          report.conflicts.push({ group_uuid: uuid, epoch: incEpoch, kind: 'key-differs-same-epoch' });
        if (inc.member_id && cur.member_id && inc.member_id !== cur.member_id)
          report.conflicts.push({ group_uuid: uuid, kind: 'member-id-differs' });
        // current epoch never downgrades
        if (incEpoch > curEpoch) {
          merged.epoch = incEpoch; merged.group_key_b64 = inc.group_key_b64;
          merged.endpoint = inc.endpoint || merged.endpoint; report.groupsAdded++;
        } else { report.groupsKept++; }
        if (!merged.handle && inc.handle) merged.handle = inc.handle;
        local[uuid] = merged;
      });
      writeJSON(storage, GROUPS_STORE, local);

      if (bundle.published) {
        var pidx = pubIndex();
        Object.keys(bundle.published).forEach(function (k) { if (!pidx[k]) pidx[k] = bundle.published[k]; });
        writeJSON(storage, PUB_STORE, pidx);
      }

      if (bundle.sync) {
        var idx = syncIndex();
        Object.keys(bundle.sync).forEach(function (rid) {
          var have = idx[rid] || [];
          bundle.sync[rid].forEach(function (e) {
            var dup = have.some(function (x) {
              return x.group_uuid === e.group_uuid && x.dir === e.dir &&
                     (x.content_hash === e.content_hash || x.publication_id === e.publication_id);
            });
            if (!dup) have.push(e);
          });
          idx[rid] = have;
        });
        writeJSON(storage, SYNC_STORE, idx);
      }

      if (bundle.log && log && typeof log.merge === 'function') {
        log.merge(JSON.stringify(bundle.log));
        report.records = (bundle.log.records || []).length;
      }

      if (bundle.owned) {
        var oidx = ownedIndex();
        Object.keys(bundle.owned).forEach(function (h) { if (!oidx[h]) oidx[h] = bundle.owned[h]; });
        writeJSON(storage, OWNED_STORE, oidx);
      }

      if (bundle.self && bundle.self.self_key_b64) {
        var localSelf = readJSON(storage, 'starpin.self.v1', null);
        if (!localSelf || !localSelf.self_key_b64) {
          writeJSON(storage, 'starpin.self.v1', { self_key_b64: bundle.self.self_key_b64, seen: {}, pushed: {} });
          report.self = 'adopted';
        } else if (localSelf.self_key_b64 === bundle.self.self_key_b64) {
          report.self = 'same';
        } else if (mode === 'overwrite') {
          writeJSON(storage, 'starpin.self.v1', { self_key_b64: bundle.self.self_key_b64, seen: {}, pushed: {} });
          report.self = 'replaced';
        } else {
          // safe mode: DO NOT detach a working device from its live channel.
          report.self = 'conflict-kept-local';
          report.conflicts.push({ kind: 'self-key-differs' });
        }
      }
      return report;
    }

    return {
      // groups
      createGroup: createGroup, joinGroup: joinGroup,
      listGroups: listGroups, getGroup: getGroup,
      getIdentity: getIdentity, setHandle: setHandle,
      // sharing
      shareRecord: shareRecord,
      syncTarget: syncTarget, syncTargetAllGroups: syncTargetAllGroups,
      // portability
      snapshotIdentity: snapshotIdentity, restoreIdentity: restoreIdentity,
      // introspection for UI ("shared to: …")
      sharesOf: sharesOf, ownsContentHash: ownsContentHash,
      keyForEpoch: keyForEpoch, isPublished: isPublished, groupRecordsAt: groupRecordsAt,
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
