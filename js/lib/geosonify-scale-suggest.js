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
 * the neighbourhood (~8 km cells) and of exactly what the ranked codes
 * already show — with a passphrase on, it is the permuted code, so it reveals
 * nothing new about the place. Rendezvous hashing keeps the choice stable:
 * if the eligible set changes but the chosen scale is still in it, it stays
 * unless a newcomer outranks it. If nothing is eligible (rare), the
 * smoothest scale here is used.
 *
 * Measured on 2,000 random places and 750 km of simulated rides (25 x 30 km,
 * 50 m steps), no passphrase, against the earlier "smoothest wins" rule:
 *                         smoothest wins     this rule
 *   most common scale     Ryukyu 22%         Bebop Dominant 8.7%, Ryukyu 8.1%
 *   scales never chosen   7 of 37            0 of 37 (least: Altered 0.7%)
 *   Dorian                0.3%               1.7%; the seven modes 10.9%
 *   rougher than smoothest  —                median +2.5%, p90 +12.4%
 *   along a ride          ~8 km per change   6.5 km per change, median
 *                                            stretch 4.5 km, 34 scales heard
 * Fair share would be 2.7% each. Weighting the hash to flatten the shares
 * further was tried: it moved Dorian only to 2.2% and needed per-scale
 * weights from 0 to 274, too fragile to keep.
 *
 * ── WHY 4 LEVELS ─────────────────────────────────────────────────────────
 * Every candidate is scored at the SAME octave depth (fair), and depth 4 is
 * neighbourhood-scale, so a ride across town passes through suburbs with
 * their own scales. Depth 3 is city-scale (one change per ~60-80 km); depth 5
 * is block-scale (median stretch 550 m), too twitchy. The choice is
 * deliberately memoryless (no hysteresis): the same place always gets the
 * same suggestion whichever way you arrive.
 *
 * ── THE THRESHOLDS TABLE ─────────────────────────────────────────────────
 * THRESHOLDS[id] is the OWN_BEST quantile of that scale's score over SAMPLE_N
 * uniformly random cell paths (uniform paths = uniform places), drawn from a
 * generator seeded by FNV-1a(id), so each entry depends only on that scale's
 * own grid and tuning. buildThreshold() is the exact procedure. Each entry
 * also stores a fingerprint of the grid, tuning and constants it was built
 * from; a scale that is missing, or whose fingerprint no longer matches, is
 * computed on first use instead (~0.2 s desktop, ~1 s phone, once per
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

  var LEVELS = 4;
  var PARTIALS = 6;
  var OWN_BEST = 0.25;      // eligible when in the smoothest quarter of its own places
  var SAMPLE_N = 4000;      // random cell paths per scale for THRESHOLDS
  var EPS = 1e-9;           // relative tolerance on threshold comparisons

  // Generated by buildThresholdTable(GeoScales) — see header.
  // id: [threshold, fingerprint of the grid + tuning + method it was built from]
  var THRESHOLDS = {
    cmajor:          [0.0090049861303519788, '7a446996'],
    ionian:          [0.0091054887912955552, '6627b23d'],
    dorian:          [0.0092024164898918664, '384c50da'],
    phrygian:        [0.0094133728130063165, '56aa9a2e'],
    lydian:          [0.0090712649943995773, '14b02d34'],
    mixolydian:      [0.0093884163824147198, 'cfc1d51'],
    aeolian:         [0.0091178691103636616, '9f284df8'],
    locrian:         [0.0094634727154865872, 'd2f2ba0e'],
    harmonicminor:   [0.0091735585609617441, 'a3a8ef28'],
    melodicminor:    [0.0091635100326566514, '59694f38'],
    neapolitanminor: [0.0092467046962693596, '58532ce0'],
    majpenta:        [0.0092662992855940506, '9a9a2b0c'],
    minpenta:        [0.0089656360111959807, '6c1b0df'],
    egyptian:        [0.0091148028895495330, '9fe6f645'],
    ryukyu:          [0.0087523191263779304, 'a413f1eb'],
    hirajoshi:       [0.0094046741865018418, '913456e8'],
    insen:           [0.0091003346274551294, '5544be6c'],
    iwato:           [0.0091594249162683800, '5eb80265'],
    majblues:        [0.0094420675176866819, '978ae1c1'],
    minblues:        [0.0090353946364541381, '3061886'],
    wholetone:       [0.0092773904335417146, 'dff42500'],
    prometheus:      [0.0092212846418130243, 'a1c8286b'],
    diminished:      [0.0091284535724868807, '6da38aac'],
    bebopdominant:   [0.0090757246522922361, 'e922e628'],
    spanish:         [0.0093606182998782483, '540bf56f'],
    romani:          [0.0090694275244757021, 'fd325515'],
    arabian:         [0.0092191502208614131, '6d3a135b'],
    persian:         [0.0091954139033195732, '87fe3051'],
    acoustic:        [0.0091890460762613733, 'e7c27442'],
    altered:         [0.0095663297511019065, 'bc7d1481'],
    chromatic:       [0.0093384971733060842, 'e1a8c2f9'],
    rast:            [0.0091319191442876726, '7597dbdc'],
    bayati:          [0.0091059197922887039, 'f8e9c860'],
    saba:            [0.0093483917468371539, '8ff2636e'],
    hijaz:           [0.0093190941802511265, '2449e1fa'],
    miyako:          [0.0093064906264279310, '2ec43c86'],
    gongdiao:        [0.0092454009882323336, 'f22c0a4d']
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
    THRESHOLDS: THRESHOLDS
  };
  try { console.log('[geosonify] scale-suggest loaded'); } catch (e) {}
})(typeof window !== 'undefined' ? window : this);
