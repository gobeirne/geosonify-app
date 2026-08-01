/*
  geosonify-sky-cards.js  v0.1  — the starred card, drawn on the sphere

  THE PROBLEM
  -----------
  Star a card on the Earth map and MapManager.updateHierarchicalGrid() draws that
  card's cell: a HEALPix diamond, a GIS footprint, or a graticule box, plus faded
  parent levels. Star a card in sky mode and nothing changes, because
  geosonify-sky-view.js draw() is unconditional --

      var ipix = BigInt(HP.nestIndex(mark.dec, mark.ra, order));

  -- it draws a HEALPix cell at its own internal `order`, whatever is starred. It
  never reads cardState.active. So it is not that non-HEALPix cards fail; it is
  that no card is consulted at all, and HEALPix cards only appear to work because
  the sky view happens to draw HEALPix natively.

  This module supplies the missing half: the ring geometry for a graticule card's
  cell in the celestial frame, in the [dec, ra] vertex order GeosonifySkyOverlay
  already projects.

  WHY THE GRATICULE MATHS TRANSFERS UNCHANGED
  -------------------------------------------
  map-manager.js:525 walks the world down by (rows x cols) per iteration, in pure
  lat/lon arithmetic. There is no Earth radius, no projection, no datum -- only a
  recursive subdivision of a 180 x 360 degree span. Those same numbers read as
  declination and right ascension without conversion, which is exactly why the 22
  graticule vocabularies are "frame-portable" in the card taxonomy. Four BIP39
  words are 316 mas x 158 mas on the sky for the same reason they are 4.9 m x
  9.8 m on the ground: one subdivision, two readings.

  So the walk below is deliberately the same arithmetic as map-manager's, not a
  clever re-derivation. If that one is ever fixed, fix this one to match.

  WHAT IS DIFFERENT: A BOX IS NOT FOUR CORNERS
  --------------------------------------------
  Leaflet draws a lat/lon box from four corners because Web Mercator maps
  constant latitude to a straight horizontal line. On the sphere it is a small
  circle, so an orthographic projection of a four-corner ring bows visibly wrong
  at wide fields -- the same reason Sky.cellBoundary takes a `step` rather than
  returning corners. Edges are therefore densified before projection, adaptively:
  a 4-degree level-1 box needs the points, a 158 mas level-4 box does not.

  Meridian edges (constant RA) are great-circle arcs and would survive with two
  points; they are densified anyway so a clipped ring breaks into segments at the
  same resolution on all four sides.

  NOT COVERED: GIS CARDS
  ----------------------
  Returns null for them. MGRS, Plus Code and friends are projected Earth
  reference systems -- a UTM zone has no celestial meaning, and the cards are
  hidden in sky mode anyway. Drawing something plausible would be worse than
  drawing nothing.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';

  // Match map-manager.js:563 — innermost plus up to 4 faded ancestors.
  var DEFAULT_LEVELS = 5;

  function _CR() {
    try { if (typeof CardRenderer !== 'undefined' && CardRenderer) return CardRenderer; } catch (e) {}
    return (global && global.CardRenderer) || null;
  }

  function _GRIDS() {
    var CR = _CR();
    if (CR && typeof CR.getGridDefinitions === 'function') {
      try { var g = CR.getGridDefinitions(); if (g) return g; } catch (e) {}
    }
    try { if (typeof CARD_GRIDS !== 'undefined' && CARD_GRIDS) return CARD_GRIDS; } catch (e) {}
    return (global && global.CARD_GRIDS) || null;
  }

  /*
    Which card is starred, resolved through presentation cards.

    Chessboard and HEALPix ChromaCoord are views of a sibling's code
    (card-renderer.js presentationOf: chessOf || chromaOf), so they must resolve
    to the sibling before anything asks about geometry -- the board is a
    rendering of the sibling's cell, not a cell of its own. The guard counter
    stops a malformed definition looping.
  */
  function activeCard() {
    var CR = _CR(), GRIDS = _GRIDS();
    if (!CR || !GRIDS || typeof CR.getCardState !== 'function') return null;

    var st;
    try { st = CR.getCardState(); } catch (e) { return null; }
    if (!st || !st.active) return null;                  // raw-coordinate mode

    var key = st.active, def = GRIDS[key], guard = 0;
    while (def && (def.chessOf || def.chromaOf) && guard++ < 8) {
      key = def.chessOf || def.chromaOf;
      def = GRIDS[key];
    }
    if (!def) return null;

    var iterations = (st.iterations && st.iterations[key]) || def.defaultIterations || 9;
    if (def.fixedIterations) iterations = def.fixedIterations;

    return {
      key: key,
      def: def,
      name: def.name || key,
      iterations: iterations,
      kind: def.healpix ? 'healpix' : (def.gis ? 'gis' : (def.grid ? 'graticule' : 'unknown'))
    };
  }

  /*
    The nested cell bounds containing (dec, ra), coarsest first.

    Identical in form to map-manager.js:525. Kept in degrees throughout: the
    numbers are the subdivision, and turning them into anything else is what
    makes a readout Earth-specific.
  */
  function boxChain(decDeg, raDeg, rows, cols, iterations) {
    var minDec = -90, maxDec = 90, minRa = -180, maxRa = 180;
    var out = [];

    // The graticule model spans -180..180. project() only ever uses
    // cos(ra - centre) and sin(ra - centre), so a 0..360 input needs no wrap.
    var ra = raDeg;
    while (ra > 180) ra -= 360;
    while (ra < -180) ra += 360;

    for (var i = 0; i < iterations; i++) {
      var decStep = (maxDec - minDec) / rows;
      var raStep = (maxRa - minRa) / cols;
      var r = Math.min(Math.floor((decDeg - minDec) / decStep), rows - 1);
      var c = Math.min(Math.floor((ra - minRa) / raStep), cols - 1);
      if (r < 0) r = 0;
      if (c < 0) c = 0;

      minDec = minDec + r * decStep; maxDec = minDec + decStep;
      minRa = minRa + c * raStep;    maxRa = minRa + raStep;

      out.push({ level: i + 1, minDec: minDec, maxDec: maxDec, minRa: minRa, maxRa: maxRa });
    }
    return out;
  }

  /*
    A box as a densified closed ring of [dec, ra], ready for
    GeosonifySkyOverlay.projectRing (which reads ring[i][1] as RA).

    Step count scales with the box's angular size: a level-1 cell spanning
    degrees earns points, a level-4 cell spanning milliarcseconds is a
    straight-edged quadrilateral to any precision the screen can show.
  */
  function boxRing(box, opts) {
    opts = opts || {};
    var spanDec = box.maxDec - box.minDec;
    var spanRa = box.maxRa - box.minRa;
    var span = Math.max(spanDec, spanRa);

    var n = opts.steps || Math.max(1, Math.min(48, Math.ceil(span * 2)));
    var ring = [], i;

    for (i = 0; i <= n; i++) ring.push([box.minDec, box.minRa + spanRa * (i / n)]);
    for (i = 1; i <= n; i++) ring.push([box.minDec + spanDec * (i / n), box.maxRa]);
    for (i = 1; i <= n; i++) ring.push([box.maxDec, box.maxRa - spanRa * (i / n)]);
    for (i = 1; i <= n; i++) ring.push([box.maxDec - spanDec * (i / n), box.minRa]);

    return ring;
  }

  /*
    The starred card's cell rings at (dec, ra), coarsest first.

    Returns null -- meaning "nothing of mine to draw, carry on" -- for HEALPix
    (the sky view already draws those natively and better, with real equal-area
    boundaries), for GIS, and whenever the card cannot be resolved. Never throws:
    a failure here must cost a decoration, not the view.
  */
  function activeCardRings(decDeg, raDeg, opts) {
    opts = opts || {};
    var card = opts.card || activeCard();
    if (!card || card.kind !== 'graticule') return null;

    var grid = card.def.grid;
    if (!grid || !grid.length || !grid[0] || !grid[0].length) return null;

    var rows = grid.length, cols = grid[0].length;
    var levels = opts.levels === undefined ? DEFAULT_LEVELS : opts.levels;

    var chain;
    try { chain = boxChain(decDeg, raDeg, rows, cols, card.iterations); } catch (e) { return null; }
    if (!chain.length) return null;

    var from = Math.max(0, chain.length - levels);
    var out = [];
    for (var i = from; i < chain.length; i++) {
      out.push({
        level: chain[i].level,
        deepest: i === chain.length - 1,
        box: chain[i],
        ring: boxRing(chain[i], opts)
      });
    }
    return { card: card, rings: out };
  }

  var API = {
    VERSION: VERSION,
    DEFAULT_LEVELS: DEFAULT_LEVELS,
    activeCard: activeCard,
    activeCardRings: activeCardRings,
    boxChain: boxChain,
    boxRing: boxRing
  };

  global.GeosonifySkyCards = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  try { console.log('[geosonify] sky-cards ' + VERSION + ' loaded'); } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
