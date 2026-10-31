/*
  geosonify-starpin-next.js v0.1 — "What should I do next?"

  Pure planning, no DOM. Given where you are, your patches and the starpins
  around you, it suggests up to three walks, each a different KIND of goal so
  that efficiency alone never decides what is worth doing:

    finish   corners that advance a patch you have started (2 or 3 of 4), one
             corner or a pair, whichever gives the most per minute
    fresh    the nearest corner of ground you have not touched: no small patch
             through it has a corner yet
    star     a starpin you have not collected, rarer ones worth more

  DISTANCE IS AS THE CROW FLIES (what-next-v0). Walking-network distance is
  the next step; until then every leg is multiplied by DETOUR and walked at
  WALK_KMH, both conservative, and every time includes the walk back to
  where you started. A 30-minute suggestion is a 30-minute outing.

  The value of a corner comes from the patches it touches. Every patch
  (orders 12, 13, 14) with that corner gains one corner; the gain is weighted
  by size and by how close the patch is to lighting:

      step to 4 of 4 (lights it)   4      size   small 1
      step to 3 of 4               1.5           medium 2
      step to 2 of 4               0.6           large 4
      step to 1 of 4               0.25

  These weights only RANK suggestions. They are not a score and are never
  shown or stored.

  Browser: window.GeosonifyStarpinNext.  Node: require('./geosonify-starpin-next.js').
*/
'use strict';

var GeosonifyStarpinNext = (function () {
  var RULE = 'what-next-v0';
  var WALK_KMH = 4, DETOUR = 1.3;
  var ORDERS = [12, 13, 14];
  var SIZE_W = { 12: 4, 13: 2, 14: 1 };
  var STEP_W = { 1: 0.25, 2: 0.6, 3: 1.5, 4: 4 };
  var SIZE_WORD = { 12: 'large', 13: 'medium', 14: 'small' };
  var PAIR_POOL = 10;              // best single corners considered for pairs

  function minutesFor(metres) { return metres * DETOUR / (WALK_KMH * 1000 / 60); }
  function metresFor(minutes) { return minutes * (WALK_KMH * 1000 / 60) / DETOUR; }

  // cell path -> corners held, from S.cellProgress at orders 12-14.
  function haveMap(progress) {
    var m = {};
    if (!progress) return m;
    (progress.complete || []).forEach(function (e) { m[e.cell] = 4; });
    (progress.partial || []).forEach(function (e) { m[e.cell] = e.have; });
    return m;
  }

  // What collecting this vertex does, given the corners held so far.
  function effectsAt(S, v, have) {
    var out = [];
    S.cellsAtVertex(v.lat, v.lon, ORDERS).forEach(function (c) {
      var from = have[c.cell] || 0;
      if (from >= 4) return;
      out.push({ cell: c.cell, order: c.order, from: from, to: from + 1 });
    });
    return out;
  }
  function valueOf(effects) {
    return effects.reduce(function (s, e) { return s + SIZE_W[e.order] * STEP_W[e.to]; }, 0);
  }

  // "Lights a medium patch · a small patch to 3 of 4"
  function describe(effects) {
    var lights = {}, nearly = {}, parts = [];
    effects.forEach(function (e) {
      if (e.to === 4) lights[e.order] = (lights[e.order] || 0) + 1;
      else if (e.to === 3) nearly[e.order] = (nearly[e.order] || 0) + 1;
    });
    function phrase(n, order) {
      return (n === 1 ? 'a ' : n + ' ') + SIZE_WORD[order] + ' patch' + (n === 1 ? '' : 'es');
    }
    var L = ORDERS.filter(function (o) { return lights[o]; }).map(function (o) { return phrase(lights[o], o); });
    var N = ORDERS.filter(function (o) { return nearly[o]; }).map(function (o) { return phrase(nearly[o], o); });
    if (L.length) parts.push('Lights ' + L.join(' and '));
    if (N.length) parts.push((L.length ? 'takes ' : 'Takes ') + N.join(' and ') + ' to 3 of 4');
    if (!parts.length) {
      var started = effects.filter(function (e) { return e.from > 0; }).length;
      return started ? 'Adds a corner to ' + started + ' patch' + (started === 1 ? '' : 'es')
                     : 'Starts ' + effects.length + ' new patch' + (effects.length === 1 ? '' : 'es');
    }
    return parts.join(', ');
  }

  function trip(kind, stops, fix, S, extra) {
    var m = 0, at = fix;
    stops.forEach(function (s) { m += S.haversineM(at.lat, at.lon, s.lat, s.lon); at = s; });
    m += S.haversineM(at.lat, at.lon, fix.lat, fix.lon);
    var t = { kind: kind, rule: RULE, stops: stops, metres: m, minutes: minutesFor(m),
              outM: S.haversineM(fix.lat, fix.lon, stops[0].lat, stops[0].lon) };
    for (var k in extra) t[k] = extra[k];
    t.perMin = t.value / Math.max(1, t.minutes);
    return t;
  }

  // The corners worth finishing: every missing corner of a patch you have
  // started, scored against what you hold now.
  function finishCandidates(S, fix, progress, isCollected) {
    var have = haveMap(progress), seen = {}, out = [];
    (progress && progress.partial || []).forEach(function (e) {
      if (ORDERS.indexOf(e.order) < 0) return;
      e.corners.forEach(function (c) {
        if (c.have) return;
        // cellProgress names only the corners you HOLD; a missing one has a
        // position and no name, so name it here from the lattice.
        var key = c.lat.toFixed(7) + ',' + c.lon.toFixed(7);
        if (seen[key]) return;
        seen[key] = 1;
        var name = c.name;
        if (!name) { try { name = S.nearestCornerstone(c.lat, c.lon, 14).name; } catch (x) { return; } }
        if (isCollected(name)) return;
        var eff = effectsAt(S, c, have);
        if (!eff.length) return;
        out.push({ name: name, lat: c.lat, lon: c.lon, effects: eff, value: valueOf(eff),
                   advances: eff.some(function (x) { return x.from >= 2; }) });
      });
    });
    return out;
  }

  // Collect A, then B: B's effects are counted AFTER A, so two corners of the
  // same patch add up to lighting it.
  function pairValue(S, a, b, progress) {
    var have = haveMap(progress);
    a.effects.forEach(function (e) { have[e.cell] = e.to; });
    var eb = effectsAt(S, b, have);
    return { effects: a.effects.concat(eb), value: a.value + valueOf(eb) };
  }

  function bestFinish(S, fix, progress, isCollected, budgetMin) {
    var cands = finishCandidates(S, fix, progress, isCollected)
      .filter(function (c) { return c.advances; });
    if (!cands.length) return null;
    var trips = cands.map(function (c) {
      return trip('finish', [c], fix, S, { value: c.value, effects: c.effects });
    });
    var pool = trips.slice().sort(function (x, y) { return y.perMin - x.perMin; }).slice(0, PAIR_POOL);
    for (var i = 0; i < pool.length; i++) for (var j = 0; j < pool.length; j++) {
      if (i === j) continue;
      var a = pool[i].stops[0], b = pool[j].stops[0];
      var pv = pairValue(S, { effects: pool[i].effects, value: pool[i].value }, b, progress);
      trips.push(trip('finish', [a, b], fix, S, { value: pv.value, effects: pv.effects }));
    }
    return choose(trips, budgetMin);
  }

  // Best per minute within the budget; failing that, the shortest, flagged.
  function choose(trips, budgetMin) {
    if (!trips.length) return null;
    var fit = trips.filter(function (t) { return t.minutes <= budgetMin; });
    var pick;
    if (fit.length) {
      pick = fit.sort(function (x, y) { return (y.perMin - x.perMin) || (x.minutes - y.minutes); })[0];
    } else {
      pick = trips.sort(function (x, y) { return x.minutes - y.minutes; })[0];
      pick.overBudget = true;
    }
    pick.detail = pick.detail || describe(pick.effects || []);
    return pick;
  }

  // The nearest vertex of untouched ground: no SMALL patch through it has a
  // corner yet. (Medium and large patches are too big for this: once you have
  // walked a suburb, every vertex in it touches a started large patch, and
  // "new ground" would never be offered.) Rings outward, like
  // S.nearestBaggable, and stops one ring past the first hit.
  function bestFresh(S, fix, progress, isCollected, budgetMin) {
    var have = haveMap(progress);
    var cellM = Math.sqrt(Math.PI / 3) / Math.pow(2, 14) * 6371008.8;
    var maxR = Math.min(metresFor(budgetMin) / 2, 2500), step = cellM / 3;
    var seen = {}, best = null;
    for (var r = 0; r <= maxR; r += step) {
      var n = Math.max(1, Math.ceil(2 * Math.PI * r / step));
      for (var i = 0; i < n; i++) {
        var th = 2 * Math.PI * i / n;
        var lat = fix.lat + r * Math.cos(th) / 111320;
        var lon = fix.lon + r * Math.sin(th) / (111320 * Math.cos(fix.lat * Math.PI / 180));
        var v;
        try { v = S.nearestCornerstone(lat, lon, 14); } catch (e) { continue; }
        if (!v || seen[v.name]) continue;
        seen[v.name] = 1;
        if (isCollected(v.name)) continue;
        var eff = effectsAt(S, v, have);
        if (!eff.length || eff.some(function (x) { return x.order === 14 && x.from > 0; })) continue;
        var d = S.haversineM(fix.lat, fix.lon, v.lat, v.lon);
        if (!best || d < best.d) best = { v: v, eff: eff, d: d };
      }
      if (best && r > best.d + cellM) break;
    }
    if (!best) return null;
    var t = trip('fresh', [{ name: best.v.name, lat: best.v.lat, lon: best.v.lon, effects: best.eff }],
                 fix, S, { value: valueOf(best.eff), effects: best.eff });
    if (t.minutes > budgetMin) t.overBudget = true;
    t.detail = describe(best.eff);
    return t;
  }

  // stars: [{ name, lat, lon, mag, ... }]; rarity(mag) -> 0..1.
  function bestStar(S, fix, stars, starHave, rarity, budgetMin) {
    var trips = [];
    (stars || []).forEach(function (st) {
      if (st.lat == null || st.lon == null || starHave(st)) return;
      var r = rarity ? rarity(st.mag) : 0.3;
      trips.push(trip('star', [{ name: st.name, lat: st.lat, lon: st.lon, star: st }], fix, S,
                      { value: 1 + 3 * r, rarity: r, star: st }));
    });
    var t = choose(trips, budgetMin);
    if (t) t.detail = t.star.mag != null ? 'G ' + Number(t.star.mag).toFixed(1) : 'brightness unknown';
    return t;
  }

  // opts: { S, fix, progress, isCollected(name), stars, starHave(star),
  //         rarity(mag), budgetMin }
  function plan(opts) {
    var S = opts.S, fix = opts.fix, budget = opts.budgetMin || 30;
    var isCollected = opts.isCollected || function () { return false; };
    return {
      rule: RULE, budgetMin: budget,
      finish: bestFinish(S, fix, opts.progress, isCollected, budget),
      fresh: bestFresh(S, fix, opts.progress, isCollected, budget),
      star: opts.stars ? bestStar(S, fix, opts.stars, opts.starHave || function () { return false; },
                                  opts.rarity, budget) : undefined
    };
  }

  return { VERSION: '0.1', RULE: RULE, WALK_KMH: WALK_KMH, DETOUR: DETOUR,
           minutesFor: minutesFor, metresFor: metresFor, describe: describe,
           finishCandidates: finishCandidates, plan: plan };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpinNext;
