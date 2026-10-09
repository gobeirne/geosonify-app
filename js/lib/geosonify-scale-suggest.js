/**
 * geosonify-scale-suggest.js — chooses the scale for the "Suggested (…)" card.
 *
 * Pure scoring and choosing: it never encodes or decodes a coordinate itself.
 * card-renderer hands it, per candidate scale, the cell tokens that scale's
 * card really produces, and gets back the chosen candidate.
 *
 * NO FORMAT OF ITS OWN. The suggested card is a presentation of whichever
 * scale card is chosen, the way Chessboard presents HexByte. Its code IS that
 * card's code and it shares with that card's existing param (?mdorian=…), so
 * nothing here is frozen and no URL grammar is added. A receiver decodes the
 * link with that scale's card and never runs this choice at all — which is
 * the only workable design: a code whose alphabet depended on the location
 * could not be decoded without already knowing the location.
 *
 * ── HOW A SCALE IS SCORED ────────────────────────────────────────────────
 * The first LEVELS cells of the scale's code, one octave band per level as
 * the scale cards voice them, each note given 6 harmonic partials at 1/n
 * amplitude, and the Plomp–Levelt roughness curve (Sethares' constants)
 * summed over every partial pair and divided by the number of pairs. Lower is
 * smoother.
 *
 * Every scale is scored AS IF ROOTED ON C: each note sits at its interval
 * from its own tonic (cents[]), ignoring tonicPc. Roughness depends on
 * absolute pitch, so scoring at the played pitch made scales rooted on D or E
 * look smoother just for sitting higher (Miyako Bushi won 27% of places).
 * This changes only which scale is suggested; the card still plays and
 * encodes that scale exactly as its own card does.
 *
 * ── HOW THE SCALE IS CHOSEN ──────────────────────────────────────────────
 * "Smoothest here" alone is not what the card wants: some scales are simply
 * smoother on average (Ryukyu won 23% of places, Dorian 0.3%, seven scales
 * never). The card wants every scale to have neighbourhoods of its own, and
 * never to sound rough. So a scale is ELIGIBLE at a place when both hold:
 *
 *   1. It is at its own best here — in the smoothest quarter of all places
 *      for that scale (OWN_BEST of its own score distribution, from the
 *      THRESHOLDS table below). Dorian qualifies wherever Dorian sounds
 *      unusually sweet, whatever Ryukyu does.
 *   2. It is in the smoother half of all scales at this place. A rough scale
 *      at its own best still loses to the field.
 *
 * Among eligible scales THE PLACE CHOOSES, by rendezvous hashing: each scale
 * gets FNV-1a(dice + '|' + scaleId) and the highest wins. The dice is the
 * C-major ('music') candidate's own LEVELS-cell code, so it is a function of
 * the place and of exactly what the ranked codes already show — with a
 * passphrase on, it is the permuted code, so it reveals nothing new about the
 * place. Rendezvous hashing keeps the choice stable: if the eligible set
 * changes but the chosen scale is still in it, it stays unless a newcomer
 * outranks it. If nothing is eligible (rare), the smoothest scale here is
 * used.
 *
 * ── WHY 5 LEVELS ─────────────────────────────────────────────────────────
 * Every candidate is scored at the SAME octave depth (fair). The depth sets
 * how local the flavour is, because a region is the overlap of every
 * candidate's LEVELS-deep cell (5- to 12-note grids, so the regions are
 * irregular, not one grid's squares):
 *   depth 3  city-scale: one change per ~60-80 km.
 *   depth 4  neighbourhood: 6.5 km per change, median stretch 4.5 km. Too
 *            coarse in practice — a whole Christchurch ride stayed on one
 *            scale.
 *   depth 5  block-scale (this): see the measurements below. A ride hears a
 *            new scale every few streets.
 * Depth 5 is what makes GPS jitter on a region edge matter, so the CHOICE
 * here stays memoryless (same place, same answer, whichever way you arrive)
 * and the smoothing lives where the motion is: card-renderer holds a winner
 * until the new one has been seen consistently or the fix is clearly inside
 * the new region (regionMarginMetres below), and the audio layer applies a
 * change only between lead phrases.
 *
 * Measured at depth 5, no passphrase, 4,000 random places and 750 km of
 * simulated rides (25 x 30 km, 25 m steps), against depth 4:
 *                         depth 4              depth 5
 *   most common scale     Bebop Dominant 8.5%  Bebop Dominant 9.3%,
 *                                              Chromatic 8.6%, Ryukyu 7.6%
 *   scales never chosen   0 of 37              0 of 37 (least: Altered 0.8%)
 *   Dorian; seven modes   1.3%; 10.2%          1.3%; 10.5%
 *   rougher than smoothest  median +2.4%       median +1.5%, p90 +12.5%
 *   along a ride          ~7 km per change     805 m per change, median
 *                                              stretch 550 m, 37 heard
 * Fair share would be 2.7% each. (Before the follower below; with it, a
 * ride hears slightly fewer changes, because slivers under 40 m are
 * skipped.)
 *
 * ── THE THRESHOLDS TABLE ─────────────────────────────────────────────────
 * THRESHOLDS[id] is the OWN_BEST quantile of that scale's score over SAMPLE_N
 * uniformly random cell paths (uniform paths = uniform places), drawn from a
 * generator seeded by FNV-1a(id), so each entry depends only on that scale's
 * own grid and tuning. buildThreshold() is the exact procedure. Each entry
 * also stores a fingerprint of the grid, tuning and constants it was built
 * from; a scale that is missing, or whose fingerprint no longer matches, is
 * computed on first use instead (~0.3 s desktop, ~1.5 s phone, once per
 * scale). After editing a scale or these constants, regenerate the table
 * with buildThresholdTable(GeoScales) and paste it in to skip that cost.
 * Comparisons allow a 1e-9 relative tolerance so a score that lands exactly
 * on a threshold is treated the same on every JS engine.
 *
 * WHAT IT IS NOT: a model of the app's actual synth. It ignores the timbre,
 * octave compression, the lead line and the drone. It is a reasonable
 * ordering heuristic, and the FAQ describes it as one.
 */
(function (global) {
  'use strict';

  var LEVELS = 5;
  var PARTIALS = 6;
  var OWN_BEST = 0.25;      // eligible when in the smoothest quarter of its own places
  var SAMPLE_N = 4000;      // random cell paths per scale for THRESHOLDS
  var EPS = 1e-9;           // relative tolerance on threshold comparisons

  // Generated by buildThresholdTable(GeoScales) — see header.
  // id: [threshold, fingerprint of the grid + tuning + method it was built from]
  var THRESHOLDS = {
    cmajor:          [0.0061769770762183174, 'f6a2c09b'],
    ionian:          [0.0062270562853124550, 'e021e7f0'],
    dorian:          [0.0062674261662697111, '792be15f'],
    phrygian:        [0.0064464376817328665, '34e16713'],
    lydian:          [0.0062518893428462272, 'ae81cfe1'],
    mixolydian:      [0.0064149967806931404, '39b51124'],
    aeolian:         [0.0062405946373697545, '1de74525'],
    locrian:         [0.0065023219191072366, '9bf78e73'],
    harmonicminor:   [0.0062775751402176653, 'e425ee95'],
    melodicminor:    [0.0063168891097953534, 'd826b365'],
    neapolitanminor: [0.0063687607124900255, '999634ed'],
    majpenta:        [0.0063119955191374933, '6887079'],
    minpenta:        [0.0060972729296222931, 'c5e2205a'],
    egyptian:        [0.0061626671449206086, '933ab418'],
    ryukyu:          [0.0059960577672307034, 'd2e0daa6'],
    hirajoshi:       [0.0064767331738506432, 'd1b15655'],
    insen:           [0.0062707010519938156, 'a780d3d9'],
    iwato:           [0.0063626398474165803, 'dffa9e38'],
    majblues:        [0.0064499902304715655, '45e1f114'],
    minblues:        [0.0061941975141180695, '5042f4cb'],
    wholetone:       [0.0064576271907653190, '5e04c88d'],
    prometheus:      [0.0063433212269189809, 'd0951126'],
    diminished:      [0.0062971343943725271, 'bfdfa019'],
    bebopdominant:   [0.0062616840228859058, '299fe595'],
    spanish:         [0.0064544067000046664, '5d0e752a'],
    romani:          [0.0062686293744422406, 'bcb555a8'],
    arabian:         [0.0063593144336396993, 'f0dbbc56'],
    persian:         [0.0063428259956380259, 'b4b72424'],
    acoustic:        [0.0063556332981476206, 'ff4f05c7'],
    altered:         [0.0066352833194356807, '6ad5b6d4'],
    chromatic:       [0.0064726511312624838, '75ba7d8c'],
    rast:            [0.0063211832739394633, '5801b749'],
    bayati:          [0.0063119214797950698, '3a2cd06d'],
    saba:            [0.0064502380357762644, '6e2ac353'],
    hijaz:           [0.0064203542853265815, '5b05f17f'],
    miyako:          [0.0064184463367940132, '7c0118cb'],
    gongdiao:        [0.0062971600542078843, '741cf9c0']
  };

  // Plomp–Levelt dissonance of two partials (Sethares 1993 constants).
  function pairRoughness(f1, f2, a1, a2) {
    var lo = Math.min(f1, f2), hi = Math.max(f1, f2);
    var s = 0.24 / (0.0207 * lo + 18.96);
    var x = s * (hi - lo);
    return Math.min(a1, a2) * (Math.exp(-3.5 * x) - Math.exp(-5.75 * x));
  }

  // Mean roughness over every partial pair of a set of fundamentals.
  function meanRoughness(freqs) {
    var p = [], i, j, n;
    for (i = 0; i < freqs.length; i++) {
      for (n = 1; n <= PARTIALS; n++) p.push([freqs[i] * n, 1 / n]);
    }
    var d = 0, c = 0;
    for (i = 0; i < p.length; i++) {
      for (j = i + 1; j < p.length; j++) {
        d += pairRoughness(p[i][0], p[j][0], p[i][1], p[j][1]);
        c++;
      }
    }
    return c ? d / c : Infinity;
  }

  // Absolute cents above C0 for a symbol, with the scale transposed so its
  // tonic is C: the interval from the tonic, inside the octave band its level
  // selects. Mirrors GeoScales.centsFor with tonicPc taken as 0. (The frozen
  // C-major card's cents are already measured from C.)
  function rootedOnC(GS, scaleId, symbol, octave) {
    var sc = GS.get(scaleId);
    if (!sc) return null;
    var i = sc.symbols.indexOf(symbol);
    if (i < 0) return null;
    var pc = sc.cents[i] % 1200;
    if (pc < 0) pc += 1200;
    return 1200 * (octave + 1) + pc;
  }

  /**
   * Score one scale from its cell tokens.
   * @param {object} GS        GeoScales
   * @param {string} scaleId   GeoScales id ('dorian', 'cmajor', …)
   * @param {string[]} cells   one string per level, e.g. ['CEA','DD','CFG']
   * @returns {number}         mean roughness, or Infinity if unlexable
   */
  function scoreCells(GS, scaleId, cells) {
    var freqs = [];
    for (var lvl = 0; lvl < cells.length; lvl++) {
      var syms = GS.tokenize(scaleId, cells[lvl]);
      if (!syms || !syms.length) return Infinity;   // wrong alphabet: never pick
      var seen = {};
      for (var k = 0; k < syms.length; k++) {
        if (seen[syms[k]]) continue;
        seen[syms[k]] = true;
        var cents = rootedOnC(GS, scaleId, syms[k], lvl);
        if (cents === null) return Infinity;
        freqs.push(GS.centsToHz(cents));
      }
    }
    return meanRoughness(freqs);
  }

  /** Split a music-family code ('CEA,DD,CFG,') into its cells. */
  function cellsOf(code) {
    return String(code || '').split(',').map(function (t) { return t.trim(); })
      .filter(Boolean);
  }

  // FNV-1a, 32-bit. Not a security primitive: a stable, engine-independent
  // way to turn a string into a number for the place's choice.
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  /**
   * The OWN_BEST quantile of one scale's score over SAMPLE_N uniformly random
   * cell paths. Deterministic: Park–Miller generator seeded by FNV-1a(id).
   */
  function buildThreshold(GS, scaleId) {
    var grid = GS.gridFor(scaleId);
    if (!grid) return null;
    var n = grid.length;
    var seed = (fnv1a(scaleId) % 2147483646) + 1;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var xs = [];
    for (var k = 0; k < SAMPLE_N; k++) {
      var cells = [];
      for (var l = 0; l < LEVELS; l++) {
        var r = Math.floor(rnd() * n), c = Math.floor(rnd() * n);
        cells.push(String(grid[r][c]).replace(/,$/, ''));
      }
      xs.push(scoreCells(GS, scaleId, cells));
    }
    xs.sort(function (a, b) { return a - b; });
    return xs[Math.floor(OWN_BEST * SAMPLE_N)];
  }

  // What a threshold depends on: the scale's grid, its tuning, and this
  // method's constants. A table entry whose fingerprint no longer matches
  // (a grid or tuning edited since the table was built) is ignored and
  // recomputed, so a stale table can never silently skew the choice.
  function fingerprint(GS, scaleId) {
    var sc = GS.get(scaleId), grid = GS.gridFor(scaleId);
    if (!sc || !grid) return null;
    return fnv1a(JSON.stringify([grid, sc.symbols, sc.cents,
      LEVELS, PARTIALS, OWN_BEST, SAMPLE_N])).toString(16);
  }

  /** Every scale's [threshold, fingerprint], keyed by id, for THRESHOLDS. */
  function buildThresholdTable(GS) {
    var out = {};
    GS.ids().forEach(function (id) {
      out[id] = [buildThreshold(GS, id), fingerprint(GS, id)];
    });
    return out;
  }

  var _computed = {};
  function thresholdFor(GS, scaleId) {
    var row = THRESHOLDS[scaleId];
    if (row && row[1] === fingerprint(GS, scaleId)) return row[0];
    if (!Object.prototype.hasOwnProperty.call(_computed, scaleId)) {
      _computed[scaleId] = buildThreshold(GS, scaleId);
    }
    return _computed[scaleId];
  }

  /**
   * Score candidates. Each candidate: { key, scaleId, code } where code is
   * that card's code at LEVELS iterations BEFORE obfuscation (see
   * card-renderer). Returns them sorted smoothest-first with `score` added.
   * Stable: equal scores keep their incoming (registry) order.
   */
  function rank(GS, candidates) {
    var scored = candidates.map(function (c, i) {
      var cells = cellsOf(c.code).slice(0, LEVELS);
      var score = cells.length === LEVELS ? scoreCells(GS, c.scaleId, cells) : Infinity;
      return { key: c.key, scaleId: c.scaleId, code: c.code, score: score, _i: i };
    });
    scored.sort(function (a, b) {
      if (a.score !== b.score) return a.score < b.score ? -1 : 1;
      return a._i - b._i;
    });
    return scored;
  }

  /**
   * Choose the suggested scale (see header). Returns the chosen candidate
   * with `score`, `eligible` (how many qualified) and `smoothestHere`, or
   * null if no candidate could be scored.
   */
  function choose(GS, candidates) {
    var ranked = rank(GS, candidates).filter(function (c) { return isFinite(c.score); });
    if (!ranked.length) return null;

    var median = ranked[Math.floor((ranked.length - 1) / 2)].score;
    var eligible = ranked.filter(function (c) {
      var t = thresholdFor(GS, c.scaleId);
      return c.score <= median && t !== null && c.score <= t * (1 + EPS);
    });
    if (!eligible.length) eligible = [ranked[0]];

    // The place's dice: the C-major candidate's ranked code, else the first.
    var diceSrc = null;
    for (var i = 0; i < candidates.length; i++) {
      if (candidates[i].scaleId === 'cmajor') { diceSrc = candidates[i]; break; }
    }
    if (!diceSrc) diceSrc = candidates[0];
    var dice = cellsOf(diceSrc.code).slice(0, LEVELS).join(',');

    var best = null, bestH = -1;
    eligible.forEach(function (c) {
      var h = fnv1a(dice + '|' + c.scaleId);
      if (h > bestH || (h === bestH && c._i < best._i)) { best = c; bestH = h; }
    });
    best.eligible = eligible.length;
    best.smoothestHere = ranked[0].scaleId;
    return best;
  }

  /**
   * How far (metres) a point sits inside the region the choice is made on:
   * the distance to the nearest edge of ANY candidate's LEVELS-deep cell,
   * since crossing any of those edges can change some candidate's score.
   * Geometry only — a passphrase permutes which symbol a cell carries, never
   * where the cell is, so this is the same with or without one.
   * @param {number} lat
   * @param {number} lon
   * @param {number[]} sizes  distinct grid sizes in play (5, 6, 7, 8, 12, …)
   */
  function regionMarginMetres(lat, lon, sizes) {
    var M = 111319.9, best = Infinity;
    var kx = Math.max(1e-9, Math.cos(lat * Math.PI / 180));
    for (var s = 0; s < sizes.length; s++) {
      var n = sizes[s];
      if (!(n > 1)) continue;
      var cells = Math.pow(n, LEVELS);
      var hLat = 180 / cells, wLon = 360 / cells;
      var fy = (90 - lat) / hLat, fx = (lon + 180) / wLon;
      fy -= Math.floor(fy); fx -= Math.floor(fx);
      var dy = Math.min(fy, 1 - fy) * hLat * M;
      var dx = Math.min(fx, 1 - fx) * wLon * M * kx;
      best = Math.min(best, dx, dy);
    }
    return best;
  }

  /**
   * Hysteresis for a MOVING point. choose() is memoryless; at block-scale
   * regions a GPS fix wobbling ±5 m across an edge would flip the scale
   * hundreds of times in ten minutes parked at a junction. A follower holds
   * the current winner and adopts a different one only when:
   *   - it has nothing yet, the passphrase changed, or the point jumped
   *     more than JUMP_M since the last update (a dropped pin, a pan, a
   *     decoded link — not motion, so no reason to hold), or
   *   - the point is at least MARGIN_M inside the region (regionMarginMetres),
   *     or
   *   - the same new winner has been seen on AGREE consecutive updates
   *     (moving slowly along an edge still resolves in ~10 s at 1 Hz GPS).
   * Measured on 96 km of simulated riding at one fix per 5 m with 5 m GPS
   * noise: 190 raw switches against 106 real region changes, 95 with the
   * follower. Parked on a region edge for ten minutes: 289 raw switches per
   * edge, 0.3 with the follower. Typical delay after a real change ~35 m.
   *
   * The cost: within MARGIN_M of an edge, which scale you hear depends on
   * the direction you arrived from. Away from edges the answer is the same
   * whichever way you come, exactly as choose() gives it.
   *
   * @returns {function(best, lat, lon, passKey, sizes): string}
   *   call with choose()'s result (or null); returns the held key.
   */
  var MARGIN_M = 20, AGREE = 10, JUMP_M = 150;
  function makeFollower() {
    var st = { key: null, best: null, lat: null, lon: null, pass: null, pk: null, pc: 0 };
    function update(best, lat, lon, passKey, sizes) {
      if (best && isFinite(best.score)) {
        if (st.key === null || passKey !== st.pass || st.lat === null) {
          st.key = best.key; st.best = best; st.pk = null; st.pc = 0;
        } else if (best.key !== st.key) {
          var M = 111319.9;
          var d = Math.sqrt(Math.pow((lat - st.lat) * M, 2) +
            Math.pow((lon - st.lon) * M * Math.cos(lat * Math.PI / 180), 2));
          if (st.pk === best.key) st.pc++; else { st.pk = best.key; st.pc = 1; }
          if (d > JUMP_M || st.pc >= AGREE ||
              regionMarginMetres(lat, lon, sizes || []) >= MARGIN_M) {
            st.key = best.key; st.best = best; st.pk = null; st.pc = 0;
          }
        } else {
          st.best = best; st.pk = null; st.pc = 0;
        }
      }
      st.lat = lat; st.lon = lon; st.pass = passKey;
      return st.key;
    }
    update.held = function () { return st.best; };
    update.reset = function () { st.key = null; st.best = null; st.lat = st.lon = null; st.pk = null; st.pc = 0; };
    return update;
  }

  /** "Aeolian (natural minor)" → "Aeolian"; the C-major card → "C major". */
  function shortName(GS, scaleId) {
    if (scaleId === 'cmajor') return 'C major';
    var sc = GS.get(scaleId);
    if (!sc) return scaleId;
    return String(sc.name).replace(/\s*\([^)]*\)\s*$/, '') || sc.name;
  }

  global.GeoScaleSuggest = {
    LEVELS: LEVELS,
    OWN_BEST: OWN_BEST,
    choose: choose,
    rank: rank,
    scoreCells: scoreCells,
    meanRoughness: meanRoughness,
    cellsOf: cellsOf,
    shortName: shortName,
    thresholdFor: thresholdFor,
    buildThreshold: buildThreshold,
    buildThresholdTable: buildThresholdTable,
    regionMarginMetres: regionMarginMetres,
    makeFollower: makeFollower,
    THRESHOLDS: THRESHOLDS
  };
  try { console.log('[geosonify] scale-suggest loaded'); } catch (e) {}
})(typeof window !== 'undefined' ? window : this);
