/*
  geosonify-starpin-replay_selftest.js — node geosonify-starpin-replay_selftest.js

  Pins three things:
    1. runs: which records chain into a drive-by run, and which never do
    2. replay parity: the log asks feedback for EXACTLY the sound the bag played
    3. replay plumbing: routed through a stoppable bus, one at a time
  Needs geosonify-starpin-feedback.js (patched) beside it. No browser.
*/
'use strict';
var path = require('path');
function load(name) {
  var tries = ['./' + name, './js/lib/' + name, '../lib/' + name];
  for (var i = 0; i < tries.length; i++) {
    try { return require(path.resolve(__dirname, tries[i])); } catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND') throw e;
    }
  }
  throw new Error('cannot find ' + name);
}

// ── a WebAudio stand-in that records the graph ───────────────────────────────
function Param(v) { return { value: v, setValueAtTime: function (x) { this.value = x; },
  exponentialRampToValueAtTime: function () {}, linearRampToValueAtTime: function (x) { this.value = x; },
  cancelScheduledValues: function () {} }; }
function MockCtx() {
  var self = this;
  this.state = 'running'; this.currentTime = 0; this.nodes = [];
  this.destination = { name: 'destination', inputs: [] };
  function node(kind, extra) {
    var n = { kind: kind, outs: [], disconnected: false,
      connect: function (t) { this.outs.push(t); if (t.inputs) t.inputs.push(this); return t; },
      disconnect: function () { this.disconnected = true; } };
    Object.keys(extra || {}).forEach(function (k) { n[k] = extra[k]; });
    n.inputs = [];
    self.nodes.push(n); return n;
  }
  this.createGain = function () { return node('gain', { gain: Param(1) }); };
  this.createOscillator = function () { return node('osc', { frequency: Param(440), detune: Param(0),
    type: 'sine', start: function () {}, stop: function () {} }); };
  this.createBiquadFilter = function () { return node('filter', { frequency: Param(350), Q: Param(1), type: 'lowpass' }); };
  this.createDelay = function () { return node('delay', { delayTime: Param(0) }); };
  this.resume = function () { self.state = 'running'; return Promise.resolve(); };
}
global.window = global.window || {};
var lastCtx = null;
global.window.AudioContext = function () { lastCtx = new MockCtx(); return lastCtx; };

var F = load('geosonify-starpin-feedback.js');
var R = load('geosonify-starpin-replay.js');

var pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) pass++; else { fail++; console.log('FAIL ' + label); }
}
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label + '\n   got  ' + JSON.stringify(a) + '\n   want ' + JSON.stringify(b)); }

// ── 1. runs ─────────────────────────────────────────────────────────────────
var T0 = Date.UTC(2026, 9, 5, 18, 0, 0);
var n = 0;
function rec(tMin, lat, lon, extra) {
  var r = { record_id: 'r' + (++n), kind: 'visit', target: { cornerstone: 'V:x' + n },
            event: { time_ms: T0 + tMin * 60000 },
            fix: { lat_1e7: Math.round(lat * 1e7), lon_1e7: Math.round(lon * 1e7), time_ms: T0 + tMin * 60000 } };
  Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
  return r;
}
// 1 km of latitude is 1/111.2 degree
var KM = 1 / 111.195;
// A motorway: a pin every 3 min at 100 km/h (5 km apart).
var drive = [0, 3, 6, 9].map(function (m, i) { return rec(60 + m, -43.5 - i * 5 * KM, 172.5); });
// A bike ride: 15 km/h, pins every 8 min (2 km apart).
var bike = [0, 8, 16].map(function (m, i) { return rec(m, -43.4 - i * 2 * KM, 172.6); });
// A flight: 1700 km in 3 hours (~570 km/h).
var fly = [rec(300, 28.5, 77.1), rec(480, 13.2, 77.7)];
// The same motorway with a 46-minute stop in the middle at 75 km/h overall.
var gap = [rec(600, -44.0, 171.5), rec(601, -44.0 - 1.5 * KM, 171.5),
           rec(647, -44.0 - 59 * KM, 171.5), rec(648, -44.0 - 60.5 * KM, 171.5)];

var all = drive.concat(bike, fly, gap);
var got = R.findRuns(all);
eq(got.runs.map(function (r) { return r.records.length; }), [4, 2, 2], 'runs: motorway(4) + both halves of the stop (2,2)');
ok(got.runOf[drive[0].record_id] === 0 && got.runOf[drive[3].record_id] === 0, 'runs: whole motorway is one run');
ok(bike.every(function (r) { return got.runOf[r.record_id] == null; }), 'runs: bike pace never chains');
ok(fly.every(function (r) { return got.runOf[r.record_id] == null; }), 'runs: a flight never chains');
ok(Math.abs(got.runs[0].avgKmh - 100) < 1, 'runs: average speed is reported (' + got.runs[0].avgKmh.toFixed(1) + ')');
ok(Math.abs(got.runs[0].km - 15) < 0.1, 'runs: distance sums the legs');
eq(R.findRuns(gap, { maxGapMs: 50 * 60000 }).runs.map(function (r) { return r.records.length; }), [4],
   'runs: a longer gap allowance joins the stop');
eq(R.findRuns(drive.slice().reverse()).runs.length, 1, 'runs: input order does not matter');
eq(R.findRuns([]).runs, [], 'runs: empty log');
eq(R.findRuns([{ record_id: 'x', target: {}, event: { time_ms: 1 }, fix: null }]).runs, [], 'runs: a record with no fix is skipped');

// A find belongs to a run only if every record of it is in that run.
eq(R.runForGroup([drive[1]], got.runOf), 0, 'group: one record in a run');
eq(R.runForGroup([drive[1], bike[0]], got.runOf), null, 'group: walked back to it later -> standalone');
eq(R.runForGroup([drive[1], gap[0]], got.runOf), null, 'group: in two different runs -> standalone');

// ── 2. replay parity ─────────────────────────────────────────────────────────
// A stand-in engine: just enough of S for a cornerstone.
var S = {
  cornerstonePoint: function () { return { lat: -43.55, lon: 172.63 }; },
  nearestCornerstone: function (lat, lon, order) {
    eq(order, 11, 'parity: probes at the name\'s own order');
    return { tierOrder: 10.5, degree: 4, intrinsicOrder: 11, crossOrder: 10 };
  }
};
function sourceIdOf(v) { return (String(v == null ? '' : v).match(/(\d{5,})\s*$/) || [])[1] || ''; }
var deps = { F: F, S: S, csName: function (x) { return x; }, sourceIdOf: sourceIdOf };

// What bagStar passes to F.celebrate for a starpin…
var star = { name: 'Gaia DR3 5382128178381506048', mag: 12.34 };
var bagStarOpts = { kind: 'starpin', name: star.name, mag: star.mag, digits: sourceIdOf(star.name),
                    kicker: 'starpin bagged' };
var starRec = { record_id: 's1', kind: 'visit', event: { time_ms: T0 },
  target: { starpin: 'starpin:gdr3:5382128178381506048', mag_g: 12.34 } };
eq(F.soundOf(R.celebrateOptsFor(starRec, deps)), F.soundOf(bagStarOpts), 'parity: starpin tune');
// …and a starpin logged before magnitudes were stored plays the mag-unknown tune.
var oldStar = { record_id: 's2', target: { starpin: 'starpin:gdr3:5382128178381506048' } };
eq(F.soundOf(R.celebrateOptsFor(oldStar, deps)),
   F.soundOf({ kind: 'starpin', name: star.name, mag: null, digits: '5382128178381506048' }),
   'parity: starpin without a stored magnitude');
ok(F.soundOf(R.celebrateOptsFor(starRec, deps)).seed === '5382128178381506048',
   'parity: the tune is seeded by the source_id, not "Gaia DR3 …"');

// What bagCornerstone passes for a cornerstone.
var csName = 'V:f9.11032010321c3';
var bagCsOpts = { kind: 'cornerstone', name: csName, order: 10.5, degree: 4,
                  digits: csName.replace(/\D/g, '') };
var csRec = { record_id: 'c1', kind: 'visit', event: { time_ms: T0 }, target: { cornerstone: csName } };
eq(F.soundOf(R.celebrateOptsFor(csRec, deps)), F.soundOf(bagCsOpts), 'parity: cornerstone chime');

// Determinism: the same opts, the same sound, every time.
eq(F.soundOf(bagStarOpts), F.soundOf(JSON.parse(JSON.stringify(bagStarOpts))), 'determinism: soundOf');
eq(F.composeDorian('5382128178381506048'), F.composeDorian('5382128178381506048'), 'determinism: the tune');

// Culmination spec from the record's fix.
var H = { encode: function (s, lat, lon, o) { eq([s, o], ['hpquad', 22], 'culm: hpquad at order 22'); return 'f9.1032103210321032103210'; } };
var culmRec = rec(0, -43.5, 172.6, { kind: 'culmination-attempt' });
eq(R.culminationSpecFor(culmRec, { H: H }), { kind: 'run', quaternary: '1032103210321032103210', scaleId: 'dorian' },
   'culm: run spec from the logged fix');
eq(R.culminationSpecFor({ fix: null }, { H: H }), null, 'culm: no fix, no run');

// ── 3. replay plumbing ───────────────────────────────────────────────────────
F.unlock();
var ctx = lastCtx;
function freqs(c) { return c.nodes.filter(function (x) { return x.kind === 'osc'; })
  .map(function (x) { return Math.round(x.frequency.value * 1000) / 1000; }); }

// celebrate() and replay() schedule the identical oscillators.
global.document = { body: { appendChild: function () {} },
  createElement: function () { return { classList: { add: function () {}, remove: function () {} },
    setAttribute: function () {}, appendChild: function () {} }; },
  getElementById: function () { return null; }, head: { appendChild: function () {} },
  defaultView: { requestAnimationFrame: function () {}, setTimeout: function () {}, navigator: {},
    matchMedia: function () { return { matches: true }; } } };
ctx.nodes = [];
F.celebrate(Object.assign({ doc: global.document }, bagCsOpts));
var celebrated = freqs(ctx);
ctx.nodes = [];
var h = F.replay(F.soundOf(bagCsOpts));
var replayed = freqs(ctx);
ok(celebrated.length > 0, 'plumbing: celebrate makes sound (' + celebrated.length + ' oscillators)');
eq(replayed, celebrated, 'plumbing: replay schedules the same notes as the bag');
var bus = ctx.nodes[0];
ok(bus.kind === 'gain' && bus.outs[0] === ctx.destination, 'plumbing: replay owns a bus to the speakers');
ok(bus.inputs.length > 0 && ctx.destination.inputs.indexOf(bus) >= 0, 'plumbing: the find plays into that bus');
var direct = ctx.nodes.filter(function (x) { return x !== bus && x.outs.indexOf(ctx.destination) >= 0; });
eq(direct.length, 0, 'plumbing: nothing bypasses the bus (so stop silences everything)');

var ended = 0;
ctx.nodes = [];
var h1 = F.replay(bagStarOpts, function () { ended++; });
var bus1 = ctx.nodes[0];
var h2 = F.replay(bagCsOpts, function () { ended++; });
ok(bus1.gain.value < 0.01, 'plumbing: a second replay silences the first');
h1.stop();   // stale handle: must not stop the second
ok(ctx.nodes.filter(function (x) { return x.kind === 'gain'; }).length > 1, 'plumbing: second replay built');
h2.stop();
eq(ended, 0, 'plumbing: a stopped replay does not report a natural end');

// Live sounds after a replay go straight out again (sink resets).
ctx.nodes = [];
F.playDorianLead('123456789', 261.626);
ok(ctx.nodes.some(function (x) { return x.outs.indexOf(ctx.destination) >= 0; }), 'plumbing: sink resets after replay');

// The run-up plays a run AND the chord through the bus.
ctx.nodes = [];
var hr = F.replay({ kind: 'run', quaternary: '103210321032' });
ok(hr && freqs(ctx).length >= 3 * (12 + 5), 'plumbing: culmination replay schedules the run and the chord');
hr.stop();

console.log((fail ? 'FAILED ' : 'all passed ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
