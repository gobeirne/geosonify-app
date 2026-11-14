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
ok('12 km/h by bike: 1 km of crow-flies is 6.5 min', Math.abs(N.minutesFor(1000, N.BIKE_KMH) - 6.5) < 1e-9);
ok('metresFor inverts minutesFor by bike too',
   Math.abs(N.metresFor(N.minutesFor(1234, 12), 12) - 1234) < 1e-6);
ok('the default speed is still walking after a bike plan',
   (N.plan({ S: S, fix: { lat: -43.53, lon: 172.62 }, budgetMin: 15, kmh: 12 }), Math.abs(N.minutesFor(1000) - 19.5) < 1e-9));

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
var best1 = N.plan({ S: S, fix: mid, progress: P2, isCollected: have2, budgetMin: 90 }).finish;
var oneLeg = N.finishCandidates(S, mid, P2, have2).filter(function (c) { return c.advances; })
  .map(function (c) { return N.minutesFor(2 * S.haversineM(mid.lat, mid.lon, c.lat, c.lon)); })
  .sort(function (a, b) { return a - b; })[0];
var tight = N.plan({ S: S, fix: mid, progress: P2, isCollected: have2, budgetMin: oneLeg / 1.5 });
ok('nothing fits, but something is within 2x the time: offered and flagged', tight.finish && tight.finish.overBudget === true,
   oneLeg.toFixed(1) + ' min');
var tiny = N.plan({ S: S, fix: mid, progress: P2, isCollected: have2, budgetMin: oneLeg / 3 });
ok('nothing within 2x the time: no finish card, and it says the patches are far', tiny.finish === null && tiny.finishFar === true);
var paris = N.plan({ S: S, fix: { lat: 48.8584, lon: 2.2945 }, progress: P2, isCollected: have2, budgetMin: 30 });
ok('from a pin on the other side of the world, home patches are never suggested',
   paris.finish === null && paris.finishFar === true);
ok('...and new ground there is still offered', paris.fresh && paris.fresh.minutes < 60);

var bikeP = N.plan({ S: S, fix: fix, progress: P, isCollected: have, budgetMin: 30, kmh: N.BIKE_KMH });
ok('a bike plan reports its speed', bikeP.kmh === 12 && plan.kmh === 4);
ok('the same finish is a third of the time by bike', bikeP.finish && plan.finish &&
   Math.abs(bikeP.finish.minutes * 3 - plan.finish.minutes) < 1e-6);
var farFix = { lat: missing.lat + 0.03, lon: missing.lon };          // ~3.3 km away
ok('a corner out of reach on foot in 30 min is in reach by bike',
   N.plan({ S: S, fix: farFix, progress: P, isCollected: have, budgetMin: 30 }).finishFar === true &&
   !N.plan({ S: S, fix: farFix, progress: P, isCollected: have, budgetMin: 30, kmh: 12 }).finishFar);

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

console.log('\n9: starlit-v1');
(function () {
  var Ps = prog(held3);
  var se = Ps.partial.filter(function (e) { return e.cell === small; })[0];
  var before = N.finishCandidates(S, fix, Ps, have).filter(function (c) {
    return S.haversineM(c.lat, c.lon, missing.lat, missing.lon) < 0.5; })[0];
  se.hasStar = true;
  var after = N.finishCandidates(S, fix, Ps, have).filter(function (c) {
    return S.haversineM(c.lat, c.lon, missing.lat, missing.lon) < 0.5; })[0];
  ok('lighting a patch that holds a star is worth more', after.value > before.value,
     before.value + ' -> ' + after.value);
  var pl = N.plan({ S: S, fix: fix, progress: Ps, isCollected: have, budgetMin: 30 });
  ok('...and the card says so', pl.finish && /you have a star in it/.test(pl.finish.detail),
     pl.finish && pl.finish.detail);
  // a starpin inside a complete patch that is not starlit
  var Pc = prog(names(small));
  var done = Pc.complete.filter(function (e) { return e.cell === small; })[0];
  ok('the test small patch is complete', !!done);
  Pc.complete.forEach(function (e) { e.starlit = false; });
  var cs = names(small).map(function (n) { return S.cornerstonePoint(n); });
  var mid2 = { lat: cs.reduce(function (a, c) { return a + c.lat; }, 0) / 4,
               lon: cs.reduce(function (a, c) { return a + c.lon; }, 0) / 4 };
  var inside = { name: 'Gaia DR3 1', lat: mid2.lat, lon: mid2.lon, mag: 15 };
  var outside = { name: 'Gaia DR3 2', lat: mid2.lat + 0.03, lon: mid2.lon, mag: 15 };
  var pls = N.plan({ S: S, fix: { lat: mid2.lat + 0.015, lon: mid2.lon }, progress: Pc,
                     isCollected: function () { return true; }, budgetMin: 120,
                     stars: [outside, inside], starHave: function () { return false; },
                     rarity: function () { return 0.3; } });
  ok('a star that would starlight a lit patch is preferred', pls.star && pls.star.star === inside,
     pls.star && pls.star.star.name);
  ok('...and the card counts the patches', pls.star && /starlights \d+ patch/.test(pls.star.detail),
     pls.star && pls.star.detail);
  var Pu = prog(names(small));
  var plu = N.plan({ S: S, fix: { lat: mid2.lat + 0.015, lon: mid2.lon }, progress: Pu,
                     isCollected: function () { return true; }, budgetMin: 120,
                     stars: [outside, inside], starHave: function () { return false; },
                     rarity: function () { return 0.3; } });
  ok('without host marks nothing changes', plu.star && !plu.star.starlights);
})();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
