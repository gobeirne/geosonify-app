/*
  geosonify-starpin-selfsync.js v0.1 — personal cross-device log sync (NOT FROZEN)

  Keeps YOUR OWN log in sync across your own devices — phone, laptop, iPad —
  without accounts. It is a "group of one": a personal append-log under a single
  handle derived from a self-key that all your devices share (the self-key rides
  in the portable identity bundle, so porting your identity also joins the new
  device to your personal channel).

  WHY THIS SHAPE (and why NOT a central "flag"):
    - The personal channel is ONE bucket of immutable, content-addressed record
      blobs. Sync = "list my bucket, open the ones I haven't seen, merge." Merge
      is set-union by record_id, which is CONFLICT-FREE: records are immutable and
      addressed by record_id, so two devices adding different finds, or the same
      find, converge regardless of order or timing. No locking, no coordination.
    - A central mutable "new stuff!" flag is deliberately NOT used: it's a hot
      mutable doc (concurrency pain at 3+ devices) and only says THAT something
      changed, not what — you'd re-list anyway. A bounded list of the immutable
      log already returns only-what's-new, and returns nothing (one cheap read)
      when nothing changed. A high-water counter could shave that read later; it
      is an optimisation, not the mechanism.

  HOW MANY DEVICES: any reasonable number (tens). There is NO per-device rekeying
  in normal use — unlike group member removal — because you don't churn your own
  devices. Each device pulls O(total personal records) once, then incrementally.
  Three, five, ten devices all converge by the same set-union; cost grows with
  your history, not the square of your devices.

  HONEST LIMITS (documented, not solved here):
    - Re-list cost: sync re-lists the personal bucket and opens unseen blobs.
      Fine at beta scale (hundreds of records = hundreds of doc reads, well under
      the free tier); grows with history. A monotonic-sequence index would make
      it truly incremental later.
    - Lost device: its copy of the self-key can read/write your personal log
      forever. Revoking it means rotating the self-key and re-uploading under a
      new personal handle (O(history), and old blobs stay readable to the lost
      device) — the same "rotation revokes future, not past" rule as groups.
    - Operator linkage: the personal bucket links all your own records together
      (you WANT that — they're all yours). It does not link to your group
      activity (separate keys/handles) or identify you.

  Reuses the sealing module and storage adapter unchanged; the personal channel
  is a group_key + a single fixed target.
*/
'use strict';

var GeosonifyStarpinSelfSync = (function () {

  var SELF_STORE  = 'starpin.self.v1';
  var SELF_TARGET = 'self-log-v1';        // the fixed "canonical target" for the personal channel
  var SELF_UUID   = 'self';               // fixed AAD marker (no real group uuid here)

  var te = new TextEncoder(), td = new TextDecoder();
  function rand(n) { var b = new Uint8Array(n);
    (typeof crypto !== 'undefined' ? crypto : require('crypto').webcrypto).getRandomValues(b); return b; }
  function b64url(bytes) { var bin = ''; for (var i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i]);
    var s=(typeof btoa==='function')?btoa(bin):Buffer.from(bytes).toString('base64');
    return s.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
  function ub64url(s){ s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='=';
    if(typeof atob==='function'){var bin=atob(s),o=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)o[i]=bin.charCodeAt(i);return o;}
    return new Uint8Array(Buffer.from(s,'base64')); }

  function create(deps) {
    deps = deps || {};
    var G = deps.group, store = deps.store, log = deps.log;
    var storage = deps.localStorage || (typeof localStorage !== 'undefined' ? localStorage : null);
    if (!G) throw new Error('selfsync: sealing module required');
    if (!store) throw new Error('selfsync: storage adapter required');
    if (!log) throw new Error('selfsync: record log required');
    if (!storage) throw new Error('selfsync: localStorage (or injected) required');

    function readSelf() {
      try { var raw = storage.getItem(SELF_STORE); return raw ? JSON.parse(raw) : null; }
      catch (_) { return null; }
    }
    function writeSelf(s) { storage.setItem(SELF_STORE, JSON.stringify(s)); }

    function isEstablished() { var s = readSelf(); return !!(s && s.self_key_b64); }

    // Establish a NEW personal channel (first device). Generates a random 32-byte
    // self-key. Include starpin.self.v1 in your portable bundle so other devices
    // adopt the SAME key and join this channel.
    function establish() {
      var existing = readSelf();
      if (existing && existing.self_key_b64) return existing;
      var s = { self_key_b64: b64url(rand(32)), seen: {}, pushed: {} };
      writeSelf(s);
      return s;
    }

    // Adopt a self-key received via the portable bundle (second/third device).
    function adopt(selfKeyB64) {
      var s = readSelf() || { seen: {}, pushed: {} };
      s.self_key_b64 = selfKeyB64;
      s.seen = s.seen || {}; s.pushed = s.pushed || {};
      writeSelf(s);
      return s;
    }

    function selfKeyBytes() {
      var s = readSelf();
      if (!s || !s.self_key_b64) throw new Error('selfsync: no personal channel (call establish() or adopt())');
      return ub64url(s.self_key_b64);
    }

    function aadFor(handle) {
      return { schema: G.FROZEN.SCHEMA, target_handle: handle, group_uuid: SELF_UUID,
               epoch: 1, kdf: G.FROZEN.KDF_MARKER, cipher: G.FROZEN.CIPHER_MARKER };
    }

    async function personalHandle() {
      return G.targetHandle(selfKeyBytes(), SELF_TARGET);
    }

    // PUSH: seal every local record not yet pushed and put it under the personal
    // handle. Idempotent per record_id (tracked in .pushed), so re-runs are
    // no-ops. Uses log.all() so corrections/tombstones travel too.
    async function push() {
      var s = readSelf(); var gk = selfKeyBytes();
      var handle = await personalHandle();
      var aad = aadFor(handle);
      var records = log.all ? log.all() : (log.current ? log.current() : []);
      var pushed = 0;
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        if (!rec || !rec.record_id) continue;
        if (s.pushed[rec.record_id]) continue;
        var pt = te.encode(canonical(rec));
        var sealed = await G.seal(gk, aad, rand(32), rand(24), pt);
        await store.put(handle, sealed.content_hash, sealed.blob);
        s.pushed[rec.record_id] = sealed.content_hash;
        s.seen[sealed.content_hash] = true;    // we've seen our own upload
        pushed++;
      }
      writeSelf(s);
      return { pushed: pushed, handle: handle };
    }

    // PULL: list the personal bucket, open blobs not seen before, merge into the
    // log. Dedup by content_hash (seen set) so re-lists are cheap and merges are
    // idempotent; the log's own merge() dedups by record_id on top.
    async function pull() {
      var s = readSelf(); var gk = selfKeyBytes();
      var handle = await personalHandle();
      var aad = aadFor(handle);
      var pulled = 0, cursor = null, guard = 0;
      do {
        var page = await store.list(handle, { limit: 100, cursor: cursor });
        for (var i = 0; i < page.items.length; i++) {
          var item = page.items[i];
          // `seen` is only an OPTIMISATION, never an authority (review pt 3): a
          // hash counts as truly seen only if the record it carries is actually
          // present in the durable log. If `seen` says yes but the log lacks it
          // (e.g. a bundle restored `seen` without the payload), RE-PROCESS it.
          if (s.seen[item.hash]) {
            var known = s.seen[item.hash];
            if (known === true || (log.has && log.has(known))) continue;   // genuinely have it
          }
          var rec;
          try {
            var ptBytes = await G.open(gk, aad, item.blob);
            rec = JSON.parse(td.decode(ptBytes));
          } catch (e) { continue; }   // do NOT mark seen on failure — retry next time
          if (rec && rec.record_id) {
            // DATA-SAFETY INVARIANT: validate -> collision-check -> append only.
            // Never replace a local record. If we already hold this record_id with
            // DIFFERENT canonical bytes, quarantine the remote candidate instead of
            // merging (corruption, bug, or malicious same-origin injection).
            var existing = log.get ? log.get(rec.record_id) : null;
            if (existing && canonical(existing) !== canonical(rec)) {
              s.quarantine = s.quarantine || {};
              s.quarantine[item.hash] = { record_id: rec.record_id, reason: 'record_id-collision-differing-bytes' };
              s.seen[item.hash] = rec.record_id;   // seen, but NOT merged
              continue;
            }
            log.merge(JSON.stringify({ schema: 'starpin.export/1', records: [rec] }));
            s.seen[item.hash] = rec.record_id;
            s.pushed[rec.record_id] = s.pushed[rec.record_id] || item.hash;
            pulled++;
          }
        }
        cursor = page.cursor;
      } while (cursor && ++guard < 50);
      writeSelf(s);
      return { pulled: pulled, handle: handle };
    }

    // SYNC: pull first (learn what's already up), then push local-only records.
    async function sync() {
      var pl = await pull();
      var ph = await push();
      return { pulled: pl.pulled, pushed: ph.pushed, handle: ph.handle };
    }

    // canonical JSON — same stand-in as elsewhere (pin to RFC 8785 before freeze).
    function canonical(v) {
      if (v === null || typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
      if (typeof v === 'string') return JSON.stringify(v);
      if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
      return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
    }

    // expose the self-key store so the portable snapshot can carry it
    function exportState() { return readSelf(); }
    function importState(s) { if (s) writeSelf(s); }

    return {
      SELF_STORE: SELF_STORE,
      isEstablished: isEstablished, establish: establish, adopt: adopt,
      personalHandle: personalHandle,
      push: push, pull: pull, sync: sync,
      exportState: exportState, importState: importState
    };
  }

  return { create: create, SELF_STORE: SELF_STORE, SELF_TARGET: SELF_TARGET };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeosonifyStarpinSelfSync;
}
