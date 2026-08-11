#!/usr/bin/env node
/* starpin-migrate-cornerstone-names.js — one-off, 2026-08
 *
 * Rewrites nothing. Reads an export, and for every CURRENT cornerstone record
 * whose target still carries a v0.2 name (no cN corner suffix), adds a
 * superseding record naming the same corner canonically. The original stays
 * exactly as captured, because that is the rule.
 *
 *     node starpin-migrate-cornerstone-names.js in.json [out.json] [--dry-run]
 *
 * WHY A SCRIPT AND NOT APP CODE
 *
 * The app writes canonical names now, so no new legacy record can be created.
 * The population is closed: it is whatever is already on the phone. Shipping a
 * migration into the app would mean carrying start-up code forever for a set
 * that stops growing today, and every user after release would run it against
 * nothing.
 *
 * What DOES stay in the app is the legacy DECODE path — cornerstonePoint() on a
 * suffix-less name, and canonicaliseCornerstone(). That is not migration code,
 * it is archive code: the superseded originals keep their v0.2 names forever by
 * design, so any implementation reading the historical record will meet them,
 * including the online database when it exists. Migrating the heads does not
 * retire the decoder; it just means nothing CURRENT depends on it.
 *
 * THE PROTOCOL STAMP
 *
 * The same records carry protocol: { visit, culmination } — culmination-v1 on a
 * corner of the lattice, which has no star and therefore no culmination. That
 * is a false claim about which rules were applied, and it is in the CURRENT
 * head record, so it is what an implementation reads first. It goes in the same
 * superseding record as the rename, with both changes listed.
 *
 * It removes false claims. It does NOT backfill omissions: the starpin records
 * captured before the fix carry { visit } with no culmination, and that is an
 * absence, not an untruth — assessRecord derives attendance from the timestamp
 * regardless. Superseding eight records to add a stamp nothing reads would be
 * noise in the history for no gain.
 *
 * WHAT IT WILL NOT DO
 *
 * A v0.2 name that was ambiguous — where more than one corner of the cell
 * carried it — is not guessed at. It is reported and skipped. None of the four
 * cornerstones logged in Christchurch are ambiguous, but the check is here
 * because silently picking one would be exactly the failure the corner suffix
 * was added to prevent.
 *
 * The output is a full export, so it merges into the app with "Merge a file"
 * and merges into anything else that speaks starpin.export/1. Hashes are
 * computed by geosonify-starpin-log.js itself rather than reimplemented here.
 */

var path = require('path');
var fs = require('fs');

var DIR = __dirname;
global.HealpixGrids = require(path.join(DIR, 'geosonify-healpix.js'));
var S = require(path.join(DIR, 'geosonify-starpin.js'));
var L = require(path.join(DIR, 'geosonify-starpin-log.js'));

var args = process.argv.slice(2).filter(function (a) { return a !== '--dry-run'; });
var dry = process.argv.indexOf('--dry-run') !== -1;
var inFile = args[0];
var outFile = args[1] || (inFile ? inFile.replace(/(\.json)?$/, '-migrated.json') : null);

if (!inFile) {
  console.error('usage: node starpin-migrate-cornerstone-names.js in.json [out.json] [--dry-run]');
  process.exit(2);
}

var raw = fs.readFileSync(inFile, 'utf8');

// An in-memory store, so the export we write is built by the real module.
var mem = {};
var db = L.open({ storage: {
  getItem: function (k) { return mem[k] || null; },
  setItem: function (k, v) { mem[k] = v; },
  removeItem: function (k) { delete mem[k]; }
} });

var loaded = db.merge(raw);
console.log('read     ' + inFile);
console.log('records  ' + db.count() + ' held, ' + db.current().length + ' current' +
            (loaded.refused ? ', ' + loaded.refused + ' refused' : ''));

// A cornerstone has no star, so culmination-v1 never applied to it. Anything
// else in the block is left exactly as captured.
function protocolFix(r) {
  var p = r.provenance && r.provenance.protocol;
  if (!p || !r.target.cornerstone || !p.culmination) return null;
  var next = {};
  Object.keys(p).forEach(function (k) { if (k !== 'culmination') next[k] = p[k]; });
  return next;
}

function needsWork(r) {
  if (!r.target || !r.target.cornerstone) return false;
  return !/c[0-3]$/.test(r.target.cornerstone) || protocolFix(r) !== null;
}

var legacy = db.current().filter(needsWork);

if (!legacy.length) {
  console.log('\nnothing to migrate — every current cornerstone names its corner ' +
              'and claims only the rules that applied.');
  process.exit(0);
}

console.log('\n' + legacy.length + ' current cornerstone record(s) to supersede:\n');

var added = 0, skipped = 0;
legacy.forEach(function (r) {
  var old = r.target.cornerstone, canon = null, err = null;
  try { canon = S.canonicaliseCornerstone(old); } catch (e) { err = e.message; }

  if (!canon && /c[0-3]$/.test(old)) canon = old;      // already named; here for the stamp

  if (!canon) {
    skipped++;
    console.log('  SKIP  ' + old);
    console.log('        ' + err);
    return;
  }

  // Same ground, or we do not touch it. cornerstonePoint on the legacy name and
  // on the canonical one must agree to the millimetre; if they ever did not,
  // the migration would be moving a find, which is the one thing it must never
  // do.
  var a = S.cornerstonePoint(old), b = S.cornerstonePoint(canon);
  var offM = Math.hypot((a.lat - b.lat) * 111320,
                        (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180));
  if (offM > 0.001) {
    skipped++;
    console.log('  SKIP  ' + old + ' -> ' + canon + '  (' + offM.toFixed(3) +
                ' m apart — refusing to move a find)');
    return;
  }

  var changes = [];
  if (canon !== old)
    changes.push({ field: 'target.cornerstone', from: old, to: canon,
                   why: 'v0.2 names did not say which corner of the cell they meant' });
  var fixedProtocol = protocolFix(r);
  if (fixedProtocol)
    changes.push({ field: 'provenance.protocol.culmination',
                   from: r.provenance.protocol.culmination, to: null,
                   why: 'a cornerstone has no star, so culmination-v1 never applied' });

  var next = {
    target: { cornerstone: canon },
    supersedes: r.record_id,
    eventMs: r.event.time_ms,
    eventUncertaintyMs: r.event.time_uncertainty_ms,
    membership: r.membership,
    approachReason: r.approach_reason,
    observation: r.observation,
    evidence: r.evidence,
    // Capture provenance is the ORIGINAL's, unchanged: this record describes
    // the same walk, assessed by the same rules. What is new is the rename, and
    // that goes in its own field rather than overwriting the note — the
    // catalogue backfills lost their protocol block that way.
    provenance: {
      app: r.provenance && r.provenance.app,
      app_version: r.provenance && r.provenance.app_version,
      protocol: fixedProtocol || (r.provenance && r.provenance.protocol),
      revision: {
        by: 'starpin-migrate-cornerstone-names/1',
        at_ms: Date.now(),
        reason: changes.map(function (c) { return c.field; }).join(', ') + ' corrected',
        changes: changes,
        supersedes_target: old
      }
    }
  };
  if (r.fix) {
    next.fix = {
      lat: r.fix.lat_1e7 / 1e7, lon: r.fix.lon_1e7 / 1e7,
      accuracy_m: r.fix.accuracy_m, altitude_m: r.fix.altitude_m,
      altitude_accuracy_m: r.fix.altitude_accuracy_m,
      time_ms: r.fix.time_ms, source: r.fix.source
    };
  }

  var rec = L.build(r.kind, next);
  if (!dry) db.add(rec);
  added++;
  console.log('  ' + old + '   (' + new Date(r.event.time_ms).toDateString() + ')');
  changes.forEach(function (c) {
    console.log('    ' + c.field + ': ' + JSON.stringify(c.from) + ' -> ' +
                JSON.stringify(c.to));
  });
  console.log('    at ' + a.lat.toFixed(7) + ', ' + a.lon.toFixed(7));
});

console.log('\n' + added + ' superseding record(s)' + (skipped ? ', ' + skipped + ' skipped' : '') +
            (dry ? '  [dry run — nothing written]' : ''));

if (dry) process.exit(skipped ? 1 : 0);

// ── prove it before writing ──────────────────────────────────────────────────
var before = JSON.parse(raw).records.length;
var heads = db.current();
var stillLegacy = heads.filter(function (r) {
  return r.target && r.target.cornerstone && !/c[0-3]$/.test(r.target.cornerstone);
}).length;
// every original record must still be present, byte for byte
var out = JSON.parse(db.export());
var byId = {};
out.records.forEach(function (r) { byId[r.record_id] = r; });
var lost = JSON.parse(raw).records.filter(function (o) {
  return JSON.stringify(byId[o.record_id]) !== JSON.stringify(o);
});

console.log('\ncheck   originals preserved unchanged: ' + (lost.length === 0 ? 'yes' :
            'NO — ' + lost.length + ' differ'));
console.log('check   records ' + before + ' -> ' + out.records.length);
var stillClaiming = heads.filter(function (r) {
  return protocolFix(r) !== null;
}).length;
console.log('check   current cornerstones still on a v0.2 name: ' + stillLegacy);
console.log('check   current cornerstones still claiming a culmination: ' + stillClaiming);
var keys = {};
heads.forEach(function (r) { keys[S.targetKey(r.target)] = (keys[S.targetKey(r.target)] || 0) + 1; });
var dup = Object.keys(keys).filter(function (k) { return keys[k] > 1; });
console.log('check   one head per target: ' + (dup.length ? 'NO — ' + dup.join(', ') : 'yes'));

if (lost.length) { console.error('\nrefusing to write.'); process.exit(1); }

fs.writeFileSync(outFile, db.export());
console.log('\nwrote   ' + outFile);
console.log('        merge it with "Merge a file" — the app will add what it lacks.');
