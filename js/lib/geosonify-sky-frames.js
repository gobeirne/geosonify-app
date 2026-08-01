/*
  geosonify-sky-frames.js  v0.1  — which cards work in which frame

  REPLACES A STYLESHEET WITH A FACT
  ---------------------------------
  Earth-only cards were hidden in sky mode by injecting

      [data-grid-key="mgrs"],[data-grid-key="pluscode"],... { display:none }

  into <head>. SKY-HANDOVER.md §8.4 flags this as "acceptable only while sky mode
  emits no card-bearing URLs" and names the real fix: a `frames:` field on each
  card definition.

  Sky-only cards (sexagesimal, designation, MOC, NUNIQ) make sky mode emit
  card-bearing URLs, so that condition has expired. Three things the stylesheet
  could never do, which are now needed:

    1  Hide EARTH-only cards in sky AND sky-only cards on Earth. A stylesheet
       keyed on GISGrids.SCHEMES only ever knew about one direction.
    2  Answer "is this card valid in this frame?" to code, not just to CSS. A
       share URL, a decode, or a scan needs the answer before any DOM exists.
    3  Survive re-render. display:none on an element is lost the moment
       renderCards() replaces it; a capability is a property of the DEFINITION,
       so it cannot go stale.

  THE CLASSIFICATION IS DERIVED, NOT LISTED
  -----------------------------------------
  Hard-coding a list of 36 card keys would rot the moment a card is added. Each
  card is classified from what it already declares:

    gis:        -> earth       projected Earth reference systems. A UTM zone has
                               no celestial meaning; MGRS on the sky is nonsense.
    sky:        -> sky         explicitly celestial (the new cards set this).
    healpix:    -> both        HEALPix is a sphere tessellation with no notion of
                               which sphere. Same cell, either reading.
    grid:       -> both        recursive lat/lon subdivision, pure arithmetic --
                               the same reason the 22 vocabularies are
                               "frame-portable" in the card taxonomy.

  Presentation cards (chessOf / chromaOf) inherit from the sibling whose code
  they render, because a board is a rendering of the sibling's cell, not a cell.

  ABSENT FRAME MEANS EARTH, FOREVER
  ---------------------------------
  frameOf(undefined) is 'earth'. Every URL ever issued is an Earth URL and must
  stay one.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';
  var STYLE_ID = 'gs-sky-card-gate';

  function _GRIDS() {
    var CR = global.CardRenderer;
    if (CR && typeof CR.getGridDefinitions === 'function') {
      try { var g = CR.getGridDefinitions(); if (g) return g; } catch (e) {}
    }
    try { if (typeof CARD_GRIDS !== 'undefined' && CARD_GRIDS) return CARD_GRIDS; } catch (e) {}
    return global.CARD_GRIDS || null;
  }

  function currentSphere() {
    try {
      var f = global.AppState && global.AppState.get ? global.AppState.get('frame') : null;
      return (f && f.sphere === 'sky') ? 'sky' : 'earth';
    } catch (e) { return 'earth'; }
  }

  /*
    'earth' | 'sky' | 'both'. An explicit frames: on the definition always wins,
    so a card can override the derivation without this module knowing about it.
  */
  function framesOf(def, grids, guard) {
    if (!def) return 'both';
    if (def.frames) return def.frames;

    var sib = def.chessOf || def.chromaOf;
    if (sib && (guard || 0) < 8) {
      grids = grids || _GRIDS();
      if (grids && grids[sib]) return framesOf(grids[sib], grids, (guard || 0) + 1);
    }

    if (def.sky) return 'sky';
    if (def.gis) return 'earth';
    return 'both';
  }

  function worksIn(key, sphere) {
    var grids = _GRIDS();
    if (!grids || !grids[key]) return true;      // unknown card: do not hide it
    var f = framesOf(grids[key], grids);
    return f === 'both' || f === (sphere || currentSphere());
  }

  function keysFor(sphere) {
    var grids = _GRIDS(), out = [];
    if (!grids) return out;
    sphere = sphere || currentSphere();
    Object.keys(grids).forEach(function (k) { if (worksIn(k, sphere)) out.push(k); });
    return out;
  }

  function hiddenIn(sphere) {
    var grids = _GRIDS(), out = [];
    if (!grids) return out;
    sphere = sphere || currentSphere();
    Object.keys(grids).forEach(function (k) { if (!worksIn(k, sphere)) out.push(k); });
    return out;
  }

  /*
    The stylesheet is kept as the MECHANISM -- it is still the cheapest way to
    hide cards without touching renderCards() -- but it is now generated FROM the
    capability rather than from a hardcoded scheme list, and it works in both
    directions. Same element id, so this is a drop-in for the old gate.
  */
  function applyGate(sphere) {
    var existing = document.getElementById(STYLE_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var hide = hiddenIn(sphere);
    if (!hide.length) return [];

    var sel = hide.map(function (k) { return '[data-grid-key="' + k + '"]'; }).join(',');
    var tag = document.createElement('style');
    tag.id = STYLE_ID;
    tag.textContent = sel + '{display:none !important;}';
    document.head.appendChild(tag);
    return hide;
  }

  function clearGate() {
    var existing = document.getElementById(STYLE_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  var API = {
    VERSION: VERSION,
    STYLE_ID: STYLE_ID,
    currentSphere: currentSphere,
    framesOf: framesOf,
    worksIn: worksIn,
    keysFor: keysFor,
    hiddenIn: hiddenIn,
    applyGate: applyGate,
    clearGate: clearGate
  };

  global.GeosonifySkyFrames = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  try { console.log('[geosonify] sky-frames ' + VERSION + ' loaded'); } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
