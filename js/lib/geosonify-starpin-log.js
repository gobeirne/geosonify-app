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
    var storage = null;
    try { storage = (opts.storage !== undefined) ? opts.storage
                  : (typeof localStorage !== 'undefined' ? localStorage : null); } catch (e) {}

    if (storage) {
      try {
        var raw = storage.getItem(key);
        if (raw) JSON.parse(raw).records.forEach(function (r) { mem[r.record_id] = r; });
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

    // Superseded records stay in the store — history is added to, never
    // rewritten — but they are not the current view.
    function current() {
      var dead = {};
      all().forEach(function (r) { if (r.supersedes) dead[r.supersedes] = 1; });
      return all().filter(function (r) { return !dead[r.record_id]; });
    }

    function exportString() {
      return JSON.stringify({
        schema: 'starpin.export/1',
        exported_ms: Date.now(),
        records: all()
      }, null, 0);
    }

    return {
      add: function (rec) {
        if (!rec || rec.schema !== SCHEMA) throw new Error('record-v1: not a record');
        mem[rec.record_id] = rec; save(); return rec;
      },
      get: function (id) { return mem[id] || null; },
      all: all,
      current: current,
      count: function () { return Object.keys(mem).length; },
      has: function (id) { return !!mem[id]; },

      // Immutability makes this a set union. No later-wins, no lost branch.
      merge: function (json) {
        var data = (typeof json === 'string') ? JSON.parse(json) : json;
        var recs = (data && data.records) || [];
        var added = 0, seen = 0;
        recs.forEach(function (r) {
          if (!r || r.schema !== SCHEMA || !r.record_id) return;
          if (mem[r.record_id]) { seen++; return; }
          mem[r.record_id] = r; added++;
        });
        save();
        return { added: added, alreadyHeld: seen, total: Object.keys(mem).length };
      },

      export: exportString,
      persisted: function () { return !!storage; },
      clear: function () { mem = {}; save(); }
    };
  }

  return {
    VERSION: '0.1', SCHEMA: SCHEMA,
    build: build, visit: visit, approach: approach, observation: observation,
    canonical: canonical, digest: digest, open: open, _uuid: uuid
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpinLog;
