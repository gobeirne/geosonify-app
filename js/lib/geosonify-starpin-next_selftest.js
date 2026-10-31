// node geosonify-starpin-next_selftest.js — "What next?" planner (what-next-v0)
'use strict';
global.HealpixGrids = require('./geosonify-healpix.js');
var S = require('./geosonify-starpin.js');
var N = require('./geosonify-starpin-next.js');
var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}
var nid = 0;
function rec(name) {
  var p = S.cornerstonePoint(name);
  return { record_id: 'r' + (++nid), target: { cornerstone: name },
           fix: { lat_1e7: Math.round(p.lat * 1e7), lon_1e7: Math.round(p.lon * 1e7), accuracy_m: 5 },
           event: { time_ms: 1.79e12 } };
}
function names(path) { return S.cellCornerstones(path).map(function (c) { return c.name; }); }
function prog(list) { return S.cellProgress(list.map(rec), { orders: [12, 13, 14] }); }
function setOf(list) { var m = {}; list.forEach(function (n) { m[S.canonicaliseCornerstone(n)] = 1; });
  return function (n) { try { return !!m[S.canonicaliseCornerstone(n)]; } catch (e) { return !!m[n]; } }; }

console.log('\n1: time');
ok('4 km/h with a 1.3 detour: 1 km of crow-flies is 19.5 min', Math.abs(N.minutesFor(1000) - 19.5) < 1e-9);
ok('metresFor inverts minutesFor', Math.abs(N.metresFor(N.minutesFor(1234)) - 1234) < 1e-6);

console.log('\n2: finishing');
var med = 'f9.1112021011333', medC = names(med);
var small = 'f9.11120210113330', smallC = names(small);
var held = [medC[0], medC[1]];                                   // medium at 2 of 4
var held3 = held.concat(smallC.filter(function (n) { return held.indexOf(n) < 0; }).slice(0, 3 - smallC.filter(function (n) { return held.indexOf(n) >= 0; }).length));
var P = prog(held3), have = setOf(held3);
var smallEntry = P.partial.filter(function (e) { return e.cell === small; })[0];
ok('the test small patch is at 3 of 4', smallEntry && smallEntry.have === 3, smallEntry && smallEntry.have);
var missing = smallEntry.corners.filter(function (c) { return !c.have; })[0];
var fix = { lat: missing.lat + 0.0009, lon: missing.lon };        // ~100 m from the last corner
var plan = N.plan({ S: S, fix: fix, progress: P, isCollected: have, budgetMin: 30 });
ok('finish: the corner that lights the small patch comes first',
   plan.finish && plan.finish.stops.length === 1 &&
   S.haversineM(plan.finish.stops[0].lat, plan.finish.stops[0].lon, missing.lat, missing.lon) < 0.5,
   plan.finish && plan.finish.stops.map(function (s) { return s.name; }).join(' '));
ok('a missing corner is named from the lattice', plan.finish && /^V:f9\./.test(plan.finish.stops[0].name));
ok('...and says so', plan.finish && /Lights a small patch/.test(plan.finish.detail), plan.finish && plan.finish.detail);
ok('...with the walk back included', plan.finish &&
   Math.abs(plan.finish.metres - 2 * S.haversineM(fix.lat, fix.lon, missing.lat, missing.lon)) < 0.5);
ok('nothing collected is ever suggested', N.finishCandidates(S, fix, P, have).every(function (c) { return !have(c.name); }));

// A medium patch at 2 of 4 whose two missing corners are both near: the
// pair lights it, which no single corner can.
var P2 = prog(held), have2 = setOf(held);
var medEntry = P2.partial.filter(function (e) { return e.cell === med; })[0];
var mm = medEntry.corners.filter(function (c) { return !c.have; });
var mid = { lat: (mm[0].lat + mm[1].lat) / 2, lon: (mm[0].lon + mm[1].lon) / 2 };
var plan2 = N.plan({ S: S, fix: mid, progress: P2, isCollected: have2, budgetMin: 90 });
ok('a pair that lights a medium patch beats either corner alone',
   plan2.finish && plan2.finish.stops.length === 2 && /Lights a medium patch/.test(plan2.finish.detail),
   plan2.finish && plan2.finish.stops.length + ' ' + plan2.finish.detail);
var tight = N.plan({ S: S, fix: mid, progress: P2, isCollected: have2, budgetMin: 1 });
ok('nothing fits 1 minute: the shortest is offered and flagged', tight.finish && tight.finish.overBudget === true);

console.log('\n3: new ground');
ok('fresh: a corner is offered', !!plan.fresh);
var fr = plan.fresh.stops[0];
ok('...that you do not have', !have(fr.name));
ok('...and that touches no small patch you have started',
   S.cellsAtVertex(fr.lat, fr.lon, [14]).every(function (c) {
     return !P.partial.concat(P.complete).some(function (e) { return e.cell === c.cell; }); }));

console.log('\n4: starpins');
var stars = [
  { name: 'Gaia DR3 1', lat: fix.lat + 0.002, lon: fix.lon, mag: 17.5 },
  { name: 'Gaia DR3 2', lat: fix.lat - 0.002, lon: fix.lon, mag: 9.0 },
  { name: 'Gaia DR3 3', lat: fix.lat, lon: fix.lon + 0.001, mag: 8.0 }
];
function rarity(m) { return m < 6.5 ? 1 : m >= 18 ? 0 : (18 - m) / 11.5; }
var p3 = N.plan({ S: S, fix: fix, progress: P, isCollected: have, budgetMin: 30,
                  stars: stars, starHave: function (s) { return s.name === 'Gaia DR3 3'; }, rarity: rarity });
ok('a collected starpin is skipped', p3.star && p3.star.star.name !== 'Gaia DR3 3');
ok('at equal distance the brighter, rarer one wins', p3.star && p3.star.star.name === 'Gaia DR3 2', p3.star && p3.star.star.name);
ok('with no star list the star card is left undefined (still looking)', plan.star === undefined);
ok('with an empty star list there is no star card', N.plan({ S: S, fix: fix, progress: P, stars: [] }).star === null);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
