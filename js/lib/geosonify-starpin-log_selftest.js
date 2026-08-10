/*
  geosonify-starpin-log_selftest.js — run: node geosonify-starpin-log_selftest.js

  Gates the record model. Most of these exist because the WRONG behaviour is
  silent data loss rather than an error.
*/
'use strict';
var L = require('./geosonify-starpin-log.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }

function mem() {                       // a localStorage stand-in
  var m = {};
  return { getItem: function (k) { return m[k] || null; },
           setItem: function (k, v) { m[k] = v; },
           removeItem: function (k) { delete m[k]; } };
}
var TARGET = { starpin: 'starpin:gdr3:5382127323687128576' };
var FIX = { lat: -43.5554470, lon: 172.6508430, accuracy_m: 7, source: 'web-geolocation' };

head('1: records are immutable');
var r = L.visit({ target: TARGET, fix: FIX });
ok('frozen', Object.isFrozen(r));
ok('assignment THROWS in strict mode', throws(function () { r.kind = 'observation'; }));
ok('and the value is unchanged', r.kind === 'visit');
ok('no edited_ms field exists at all', !('edited_ms' in r));
ok('a correction is a new record', L.visit({ target: TARGET, fix: FIX, supersedes: r.record_id })
   .supersedes === r.record_id);

head('2: identity');
ok('record_id is a v4 uuid',
   /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.record_id));
ok('two records differ', L.visit({ target: TARGET }).record_id !== r.record_id);
ok('no time is embedded in the id (not v7)', r.record_id[14] === '4');

head('3: three distinct times');
var r3 = L.visit({ target: TARGET, fix: { lat: 1, lon: 2, time_ms: 1000, accuracy_m: 5 },
                   eventMs: 2000, createdMs: 3000 });
ok('fix acquisition time', r3.fix.time_ms === 1000);
ok('event time', r3.event.time_ms === 2000);
ok('record creation time', r3.created_ms === 3000);
ok('they are allowed to differ', r3.fix.time_ms !== r3.event.time_ms &&
   r3.event.time_ms !== r3.created_ms);

head('4: no assessments are stored');
var json = JSON.stringify(r);
ok('no verdict', !/verdict/.test(json));
ok('no badge', !/badge/.test(json));
ok('no score or points', !/score|points/.test(json));
ok('no attended flag', !/attended/.test(json));
ok('membership may be null (not a manifest target)', r.membership === null);

head('5: the fix does not lie about its provenance');
ok('defaults to web-geolocation', r.fix.source === 'web-geolocation');
ok('rejects an invented source', throws(function () {
  L.visit({ target: TARGET, fix: { lat: 1, lon: 2, source: 'gps' } }); }));
ok('accepts manual', L.visit({ target: TARGET, fix: { lat: 1, lon: 2, source: 'manual' } })
   .fix.source === 'manual');
ok('missing accuracy is null, never zero', L.visit({ target: TARGET, fix: { lat: 1, lon: 2 } })
   .fix.accuracy_m === null);
ok('datum is always stated', r.fix.datum === 'WGS84');
ok('coordinates stored as integer 1e-7 degrees', r.fix.lat_1e7 === -435554470);
ok('no float coordinates leak in', r.fix.lat === undefined);

head('6: validation');
ok('rejects an unknown kind', throws(function () { L.build('teleport', { target: TARGET }); }));
ok('rejects a record with no target', throws(function () { L.visit({}); }));
ok('rejects a fix with no lon', throws(function () {
  L.visit({ target: TARGET, fix: { lat: 1 } }); }));

head('7: canonical form');
ok('keys sorted by code point',
   L.canonical({ b: 1, a: 2, C: 3 }) === '{"C":3,"a":2,"b":1}');
ok('stable across key insertion order',
   L.canonical({ x: { q: 1, p: 2 } }) === L.canonical({ x: { p: 2, q: 1 } }));
ok('no insignificant whitespace', !/\s/.test(L.canonical(r).replace(/"[^"]*"/g, '')));
ok('nulls preserved, not dropped', /"supersedes":null/.test(L.canonical(r)));

head('8: merge is a set union — the whole reason records are immutable');
var A = L.open({ storage: mem(), storeKey: 'A' });
var B = L.open({ storage: mem(), storeKey: 'B' });
var shared = L.visit({ target: TARGET, fix: FIX });
A.add(shared); B.merge(A.export());
ok('friend receives it', B.count() === 1);
var mine  = A.add(L.visit({ target: TARGET, fix: FIX, eventMs: 111 }));
var yours = B.add(L.visit({ target: TARGET, fix: FIX, eventMs: 222 }));
var m1 = A.merge(B.export());
ok('merge reports what it did', m1.added === 1 && m1.alreadyHeld === 1, JSON.stringify(m1));
ok('both branches survive', A.has(mine.record_id) && A.has(yours.record_id));
ok('NOTHING was silently dropped', A.count() === 3);
ok('merge is idempotent', (A.merge(B.export()), A.count() === 3));
ok('merge is commutative', (B.merge(A.export()), B.count() === A.count()));
ok('round trip through export', (function () {
  var C = L.open({ storage: mem(), storeKey: 'C' });
  C.merge(A.export());
  return L.canonical(C.all()) === L.canonical(A.all());
})());
ok('ignores foreign records', (function () {
  var before = A.count();
  A.merge(JSON.stringify({ records: [{ schema: 'something.else/9', record_id: 'x' }] }));
  return A.count() === before;
})());

head('9: superseding hides but never deletes');
var fixed = L.visit({ target: TARGET, fix: FIX, supersedes: mine.record_id });
A.add(fixed);
ok('the corrected record is still stored', A.has(mine.record_id));
ok('but is not in the current view',
   A.current().every(function (x) { return x.record_id !== mine.record_id; }));
ok('the replacement is', A.current().some(function (x) { return x.record_id === fixed.record_id; }));

head('10: persistence');
var store = mem();
var D = L.open({ storage: store, storeKey: 'D' });
D.add(L.visit({ target: TARGET, fix: FIX }));
ok('survives a reopen', L.open({ storage: store, storeKey: 'D' }).count() === 1);
ok('works with no storage at all', (function () {
  var E = L.open({ storage: null });
  E.add(L.visit({ target: TARGET })); return E.count() === 1 && E.persisted() === false;
})());
ok('corrupt storage does not throw the app away', (function () {
  var s = mem(); s.setItem('F', '{not json');
  return L.open({ storage: s, storeKey: 'F' }).count() === 0;
})());

head('11: retraction — your collection, but not by mutating history');
var G = L.open({ storage: mem(), storeKey: 'G' });
var keep = G.add(L.visit({ target: TARGET, fix: FIX, eventMs: 100 }));
var oops = G.add(L.visit({ target: TARGET, fix: FIX, eventMs: 200 }));
ok('two held', G.count() === 2);
ok('remove reports success', G.remove(oops.record_id) === true);
ok('gone from the collection', G.count() === 1 && !G.has(oops.record_id));
ok('the keeper is untouched', G.has(keep.record_id));
ok('removing twice is harmless', G.remove(oops.record_id) === false);
ok('it is tombstoned, not merely absent', G.deleted().indexOf(oops.record_id) >= 0);

var Friend = L.open({ storage: mem(), storeKey: 'Fr' });
Friend.add(keep); Friend.add(oops);
var mr = Friend.export();
var back = G.merge(mr);
ok('a friend\'s file does NOT hand back a retracted record',
   !G.has(oops.record_id), JSON.stringify(back));
ok('merge says how many it refused', back.retracted === 1);
ok('but still accepts everything else', G.count() === 1);
ok('tombstones survive a reopen', (function () {
  var st = mem(); var X = L.open({ storage: st, storeKey: 'X' });
  var r1 = X.add(L.visit({ target: TARGET, fix: FIX }));
  X.remove(r1.record_id);
  return L.open({ storage: st, storeKey: 'X' }).deleted().length === 1;
})());
ok('undelete is possible', (function () {
  var Y = L.open({ storage: mem(), storeKey: 'Y' });
  var r1 = Y.add(L.visit({ target: TARGET, fix: FIX }));
  Y.remove(r1.record_id); Y.undelete(r1.record_id);
  return Y.merge(JSON.stringify({ records: [r1] })).added === 1;
})());

head('12: content hashes — what they catch, and what they do NOT');
var A2 = L.visit({ target: TARGET, fix: FIX, eventMs: 500 });
ok('same record, same hash', L.contentHash(A2) === L.contentHash(A2));
ok('key order does not matter', (function () {
  var a = { x: 1, y: { p: 1, q: 2 } }, b = { y: { q: 2, p: 1 }, x: 1 };
  return L.canonical(a) === L.canonical(b);
})());
ok('a changed field changes the hash', (function () {
  var c = JSON.parse(JSON.stringify(A2)); c.fix.accuracy_m = 99;
  return L.contentHash(c) !== L.contentHash(A2);
})());
ok('hash is 16 hex characters', /^[0-9a-f]{16}$/.test(L.contentHash(A2)));

var H1 = L.open({ storage: mem(), storeKey: 'H1' });
H1.add(A2); H1.add(L.visit({ target: TARGET, fix: FIX, eventMs: 600 }));
var file = H1.export();
ok('the export carries per-record and file hashes', (function () {
  var d = JSON.parse(file);
  return d.integrity && d.integrity.file &&
         Object.keys(d.integrity.records).length === 2;
})());

ok('a clean file merges without complaint', (function () {
  var X = L.open({ storage: mem(), storeKey: 'H2' });
  var r = X.merge(file);
  return r.added === 2 && !r.damaged && r.conflicts.length === 0;
})());

ok('a MANGLED file is reported as damaged', (function () {
  var d = JSON.parse(file);
  d.records[0].fix.accuracy_m = 12345;          // edited, hash not recomputed
  var X = L.open({ storage: mem(), storeKey: 'H3' });
  return X.merge(JSON.stringify(d)).damaged === true;
})());

ok('SAME id with DIFFERENT content is a conflict, not a duplicate', (function () {
  var X = L.open({ storage: mem(), storeKey: 'H4' });
  X.merge(file);
  var d = JSON.parse(file);
  d.records[0].fix.accuracy_m = 77;
  delete d.integrity;                            // as if re-exported by an editor
  var r = X.merge(JSON.stringify(d));
  return r.conflicts.length === 1 && r.conflicts[0] === d.records[0].record_id;
})());

ok('a conflict does NOT overwrite what you hold', (function () {
  var X = L.open({ storage: mem(), storeKey: 'H5' });
  X.merge(file);
  var before = L.contentHash(X.get(A2.record_id));
  var d = JSON.parse(file);
  d.records.forEach(function (r) { if (r.record_id === A2.record_id) r.fix.accuracy_m = 77; });
  X.merge(JSON.stringify(d));
  return L.contentHash(X.get(A2.record_id)) === before;
})());

// The honest limit, asserted so nobody later mistakes this for anti-cheat.
ok('an edit WITH a recomputed hash is undetectable \u2014 by design', (function () {
  var d = JSON.parse(file);
  d.records[0].fix.accuracy_m = 4242;
  d.integrity.records[d.records[0].record_id] = L.contentHash(d.records[0]);
  var ids = Object.keys(d.integrity.records).sort();
  d.integrity.file = L.contentHash(ids.map(function (i) {
    return i + ':' + d.integrity.records[i]; }));
  var X = L.open({ storage: mem(), storeKey: 'H6' });
  var r = X.merge(JSON.stringify(d));
  return r.damaged === false;
}), 'a self-hash proves a record undamaged, never true');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
