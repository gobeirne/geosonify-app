/*
  geosonify-starpin-log.js v0.1 — record-v1

  The player's records. Local, portable, and owned by them.

  Governing principle: RAW FACTS ARE DURABLE, ASSESSMENTS ARE DERIVED.
  A record stores what the device measured and what the person reported.
  Nothing here stores a verdict, a badge, a tier or a score — those are
  recomputed from the record by a versioned evaluator, so a better evaluator
  re-reads history instead of rewriting it.

  Records are IMMUTABLE. A correction is a new record with `supersedes` set.
  That is not pedantry: sharing with a friend means merging two collections,
  and immutable records make merge a set union by record_id. The mutable
  version silently destroys a branch the first time two devices both edit an
  imported record, and `edited_ms` is a user-controlled device clock.

  Storage note: browser storage is EVICTABLE. Manifest tiles are a disposable
  cache; records are durable user data. This module requests persistent
  storage where available and treats export as the real backup.

      var log = GeosonifyStarpinLog.open();
      log.add(GeosonifyStarpinLog.visit({ target: {...}, fix: {...} }));
      log.export();                      // a JSON string the person owns
      log.merge(otherJsonString);        // set union, no data loss
*/
'use strict';

var GeosonifyStarpinLog = (function () {

  var SCHEMA  = 'starpin.record/1';
  var STORE   = 'starpin.records.v1';
  var UNIT    = 10000000;

  var KINDS   = { 'visit': 1, 'closest-approach': 1, 'observation': 1, 'culmination-attempt': 1 };
  // The Web Geolocation API is deliberately agnostic about the provider. It
  // reports coordinates, accuracy and acquisition time — never a trustworthy
  // "this came from GPS". A web implementation must not claim otherwise.
  var SOURCES = { 'web-geolocation': 1, 'manual': 1, 'native-gnss': 1, 'imported': 1 };

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      var b = new Uint8Array(16);
      crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40;                 // version 4
      b[8] = (b[8] & 0x3f) | 0x80;                 // variant
      var h = [].map.call(b, function (x) { return (x + 0x100).toString(16).slice(1); }).join('');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' +
             h.slice(16, 20) + '-' + h.slice(20);
    }
    throw new Error('record-v1: needs a cryptographic random source. Math.random ' +
                    'is not acceptable for record_id.');
  }

  function units(deg) {
    if (deg == null) return null;
    return Math.round(Number(deg) * UNIT);         // display-path only; the
  }                                                // generator does exact decimals

  // ── building records ──────────────────────────────────────────────────────

  // target: { starpin } or { cornerstone } — the thing the record is about.
  function build(kind, o) {
    if (!KINDS[kind]) throw new Error('record-v1: unknown kind "' + kind + '"');
    o = o || {};
    if (!o.target) throw new Error('record-v1: a record must name its target');
    var now = (o.createdMs != null) ? o.createdMs : Date.now();
    var fix = o.fix || null;
    if (fix) {
      if (fix.lat == null || fix.lon == null) throw new Error('record-v1: fix needs lat and lon');
      var src = fix.source || 'web-geolocation';
      if (!SOURCES[src]) throw new Error('record-v1: unknown fix source "' + src + '"');
      fix = {
        lat_1e7: units(fix.lat), lon_1e7: units(fix.lon),
        datum: 'WGS84',
        accuracy_m: fix.accuracy_m == null ? null : Math.round(Number(fix.accuracy_m) * 10) / 10,
        altitude_m: fix.altitude_m == null ? null : Number(fix.altitude_m),
        altitude_accuracy_m: fix.altitude_accuracy_m == null ? null : Number(fix.altitude_accuracy_m),
        time_ms: fix.time_ms == null ? now : Math.floor(fix.time_ms),
        source: src
      };
    }
    var rec = {
      schema: SCHEMA,
      record_id: o.record_id || uuid(),
      supersedes: o.supersedes || null,
      kind: kind,
      target: o.target,                                  // {starpin:"..."} | {cornerstone:"V:f9..."}
      membership: o.membership || null,                  // null = not a manifest target
      event: {
        time_ms: o.eventMs == null ? now : Math.floor(o.eventMs),
        time_uncertainty_ms: o.eventUncertaintyMs == null ? null : Math.floor(o.eventUncertaintyMs)
      },
      fix: fix,
      approach_reason: o.approachReason || null,
      observation: o.observation || null,
      evidence: o.evidence || [],
      created_ms: Math.floor(now),
      provenance: o.provenance || null
    };
    return Object.freeze(rec);
  }

  function visit(o)     { return build('visit', o); }
  function approach(o)  { return build('closest-approach', o); }
  function observation(o) { return build('observation', o); }

  // ── canonical form ────────────────────────────────────────────────────────
  // Keys sorted by code point, no insignificant whitespace. This is a stand-in
  // for RFC 8785 (JCS); adopt JCS proper before any hash is published or
  // exchanged between implementations.
  function canonical(value) {
    if (value === null || typeof value === 'number' || typeof value === 'boolean')
      return JSON.stringify(value);
    if (typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    var keys = Object.keys(value).sort();
    return '{' + keys.map(function (k) {
      return JSON.stringify(k) + ':' + canonical(value[k]);
    }).join(',') + '}';
  }

  // ── content hashing ───────────────────────────────────────────────────────
  //
  // WHAT THIS IS FOR, precisely, because it is easy to overclaim:
  //
  //   IT DETECTS   damage (a truncated download, a mangled encoding) and
  //                DISAGREEMENT (two files carrying the same record_id with
  //                different contents, which merge would otherwise resolve
  //                silently in favour of whichever it saw first).
  //
  //   IT DOES NOT  prove honesty. The algorithm is right here; anyone editing
  //                a record can recompute its hash. A self-hash makes a record
  //                verifiably UNDAMAGED, never verifiably TRUE. Making it
  //                self-authenticating would need a key the owner does not
  //                hold, and the owner holds every key on their own device.
  //
  // That is the same wall as GNSS spoofing, and the same answer applies: the
  // records are a hobby log, first-find confers nothing, and there is nothing
  // to forge. The hash is here for corruption and conflicts, not for cheats.
  //
  // FNV-1a over the canonical form, 64-bit, computed with 32-bit halves so it
  // is exact in JavaScript and identical in every implementation. Synchronous,
  // because merge cannot wait for a promise.
  function contentHash(rec) {
    var s = canonical(rec);
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      h1 = (h1 ^ c) >>> 0; h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 = (h2 + c) >>> 0; h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
      h2 = (h2 ^ (h2 >>> 13)) >>> 0;
    }
    return ('00000000' + h1.toString(16)).slice(-8) +
           ('00000000' + h2.toString(16)).slice(-8);
  }

  // SHA-256 of the canonical form. Async because that is what the platform
  // offers; the digest lives OUTSIDE the record it describes, so there is no
  // rule about omitting a field while hashing it.
  function digest(rec) {
    if (typeof crypto === 'undefined' || !crypto.subtle)
      return Promise.reject(new Error('record-v1: no crypto.subtle for digests'));
    var bytes = new TextEncoder().encode(canonical(rec));
    return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      return [].map.call(new Uint8Array(buf), function (x) {
        return (x + 0x100).toString(16).slice(1); }).join('');
    });
  }

  // ── the store ─────────────────────────────────────────────────────────────

  function open(opts) {
    opts = opts || {};
    var key = opts.storeKey || STORE;
    var mem = {};                                       // record_id -> record
    var gone = {};                                      // record_id -> deleted_ms
    var storage = null;
    try { storage = (opts.storage !== undefined) ? opts.storage
                  : (typeof localStorage !== 'undefined' ? localStorage : null); } catch (e) {}

    if (storage) {
      try {
        var raw = storage.getItem(key);
        if (raw) {
          var parsed = JSON.parse(raw);
          (parsed.records || []).forEach(function (r) { mem[r.record_id] = r; });
          gone = parsed.deleted || {};
        }
      } catch (e) { /* corrupt or absent; start empty rather than throw away the app */ }
    }
    // Browser storage is evictable. Ask to keep it, but never rely on the answer.
    try {
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist)
        navigator.storage.persist();
    } catch (e) {}

    function save() {
      if (!storage) return false;
      try { storage.setItem(key, exportString()); return true; }
      catch (e) { return false; }
    }

    function all() {
      return Object.keys(mem).map(function (k) { return mem[k]; })
        .sort(function (a, b) { return b.event.time_ms - a.event.time_ms; });
    }

    // A supersession chain: root -> ... -> head. Built once, used by current()
    // and by remove(), which have to agree about what "this record" means.
    function chains() {
      var recs = all(), byId = {}, kids = {};
      recs.forEach(function (r) { byId[r.record_id] = r; });
      recs.forEach(function (r) {
        if (r.supersedes && byId[r.supersedes])
          (kids[r.supersedes] = kids[r.supersedes] || []).push(r);
      });
      return { recs: recs, byId: byId, kids: kids };
    }

    // Two devices can supersede the same record independently — a backfill run
    // on the phone and again on the laptop — and immutability guarantees they
    // get different record_ids, so merge sees no conflict and BOTH children
    // survive. Without a rule, current() returned two heads for one starpin and
    // the collection counted it twice. Pick deterministically, so every device
    // that holds the same records shows the same collection: latest created_ms,
    // then record_id ascending. The branch not taken is not deleted; it stays
    // in the store like every other superseded record.
    function preferred(a, b) {
      var ca = a.created_ms || 0, cb = b.created_ms || 0;
      if (ca !== cb) return cb - ca;
      return a.record_id < b.record_id ? -1 : a.record_id > b.record_id ? 1 : 0;
    }

    // Superseded records stay in the store — history is added to, never
    // rewritten — but they are not the current view.
    function current() {
      var c = chains(), out = [];
      c.recs.forEach(function (r) {
        if (r.supersedes && c.byId[r.supersedes]) return;      // not a chain root
        var node = r, guard = 0;
        while (c.kids[node.record_id] && guard++ < 4096)
          node = c.kids[node.record_id].slice().sort(preferred)[0];
        out.push(node);
      });
      return out.sort(function (a, b) { return b.event.time_ms - a.event.time_ms; });
    }

    function exportString() {
      var recs = all();
      // A per-record hash plus one over all of them. The file hash catches a
      // truncated or mangled download; the per-record hashes let a merge tell
      // "I already have this" apart from "this claims to be that record and
      // is not".
      var hashes = {};
      recs.forEach(function (r) { hashes[r.record_id] = contentHash(r); });
      var ids = Object.keys(hashes).sort();
      var fileHash = contentHash(ids.map(function (i) { return i + ':' + hashes[i]; }));
      return JSON.stringify({
        schema: 'starpin.export/1',
        exported_ms: Date.now(),
        integrity: { alg: 'fnv1a64-jcs-ish/1', records: hashes, file: fileHash },
        records: recs,
        // Tombstones travel with the export. Records are immutable, but the
        // person still owns their collection and may retract something logged
        // by mistake; without this, one merge with a friend hands it straight
        // back. An id and a timestamp reveal nothing about what was deleted.
        deleted: gone
      }, null, 0);
    }

    return {
      add: function (rec) {
        if (!rec || rec.schema !== SCHEMA) throw new Error('record-v1: not a record');
        mem[rec.record_id] = rec; save(); return rec;
      },
      get: function (id) { return mem[id] || null; },

      // A retraction. The record leaves the collection and stays out, even
      // across merges.
      //
      // It takes the WHOLE supersession chain, not the one id. A record and its
      // corrections describe one event at one place at one time; deleting only
      // the head left the original sitting in the store with the same target,
      // the same fix and the same timestamp, and it still went out in the next
      // export. For a retraction made on privacy grounds — where you were and
      // when — that is not a deletion at all. So: walk to the root, tombstone
      // every record below it, and let merge keep doing the same for branches
      // that arrive later.
      remove: function (id) {
        if (!mem[id]) return false;
        var c = chains(), node = c.byId[id], now = Date.now();
        while (node.supersedes && c.byId[node.supersedes]) node = c.byId[node.supersedes];
        var stack = [node];
        while (stack.length) {
          var n = stack.pop();
          delete mem[n.record_id];
          gone[n.record_id] = now;
          (c.kids[n.record_id] || []).forEach(function (k) { stack.push(k); });
        }
        save(); return true;
      },
      deleted: function () { return Object.keys(gone); },
      undelete: function (id) {
        if (!gone[id]) return false;
        delete gone[id]; save(); return true;
      },
      all: all,
      current: current,
      count: function () { return Object.keys(mem).length; },
      has: function (id) { return !!mem[id]; },

      // Immutability makes this a set union. No later-wins, no lost branch.
      merge: function (json) {
        var data = (typeof json === 'string') ? JSON.parse(json) : json;
        var recs = (data && data.records) || [];
        var added = 0, seen = 0;
        var refused = 0, conflicts = [], damaged = false;

        // Was the file itself damaged in transit?
        var integ = data && data.integrity;
        if (integ && integ.records && integ.file) {
          var ids2 = Object.keys(integ.records).sort();
          var expect = contentHash(ids2.map(function (i) { return i + ':' + integ.records[i]; }));
          if (expect !== integ.file) damaged = true;
        }

        Object.keys((data && data.deleted) || {}).forEach(function (id) {
          if (!gone[id]) gone[id] = data.deleted[id];
        });
        recs.forEach(function (r) {
          if (!r || r.schema !== SCHEMA || !r.record_id) return;
          if (gone[r.record_id]) { refused++; return; }      // retracted, stays out
          if (mem[r.record_id]) {
            // Same id, different content: not a duplicate, a DISAGREEMENT.
            // Keeping the one we happened to see first, silently, would be the
            // one place this design loses information.
            if (contentHash(mem[r.record_id]) !== contentHash(r))
              conflicts.push(r.record_id);
            seen++; return;
          }
          if (integ && integ.records && integ.records[r.record_id] &&
              integ.records[r.record_id] !== contentHash(r)) { damaged = true; }
          mem[r.record_id] = r; added++;
        });
        Object.keys(gone).forEach(function (id) { delete mem[id]; });

        // A retraction covers the chain, including branches that arrive after
        // it. Without this, merging with a friend who still holds a correction
        // superseding a record you deleted hands the deleted event straight
        // back under a new id. Run to a fixed point: a record whose parent is
        // tombstoned is tombstoned too.
        var moved = true;
        while (moved) {
          moved = false;
          Object.keys(mem).forEach(function (rid) {
            var sup = mem[rid].supersedes;
            if (sup && gone[sup] && !gone[rid]) {
              gone[rid] = gone[sup]; delete mem[rid]; refused++; moved = true;
            }
          });
        }
        save();
        return { added: added, alreadyHeld: seen, retracted: refused,
                 conflicts: conflicts, damaged: damaged,
                 total: Object.keys(mem).length };
      },

      export: exportString,
      contentHash: contentHash,
      // Every record's hash, for anything that wants to reference one — a
      // photo, a plate-solve, or a future server signing what it received.
      hashes: function () {
        var out = {};
        all().forEach(function (r) { out[r.record_id] = contentHash(r); });
        return out;
      },
      persisted: function () { return !!storage; },
      clear: function () { mem = {}; gone = {}; save(); }
    };
  }

  return {
    VERSION: '0.1', SCHEMA: SCHEMA,
    build: build, visit: visit, approach: approach, observation: observation,
    canonical: canonical, digest: digest, contentHash: contentHash,
    open: open, _uuid: uuid
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpinLog;
