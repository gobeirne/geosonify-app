/*
  geosonify-sky-units.js  v0.1  — angular resolution readout for sky mode

  ONE JOB. Answer "how big is this card's cell?" as an ANGLE when the frame is
  celestial, and return null otherwise so every existing Earth path runs exactly
  as it did. Additive: card-renderer.js gains a single early-out, nothing else.

  WHY NOT CONVERT METRES TO ARCSECONDS
  ------------------------------------
  The obvious shim -- take the metres the card already computes and divide by
  111319.9 -- is wrong twice over. It reintroduces an Earth radius as a
  round-trip constant into a readout that has nothing to do with Earth, and it
  drags along the cos(lat) term that getPrecisionText() applies to the longitude
  extent, silently turning a declination-dependent projection factor into part
  of a celestial answer.

  The angle was never derived from the metres. It is the other way round: every
  card's cell is an angular subdivision, and the metres are what you get after
  multiplying by an Earth radius. Sky mode does not convert the number. It
  declines to perform the multiplication. That is why this module reads the grid
  geometry directly rather than accepting a length.

  WHAT IT COVERS  (the card taxonomy from SKY-HANDOVER.md §9)
  ----------------------------------------------------------
    6  frame-agnostic HEALPix cards   -> GeosonifySky.cellSize(order).text
   22  frame-portable graticules      -> computed here from rows/cols
    8  Earth-only GIS cards           -> returns null; they are hidden in sky
                                         mode, and inventing an angle for a
                                         projected metric grid would be a lie

  DEPENDENCIES
  ------------
  GeosonifySky (formatAngle, cellSize) and HealpixGrids. HealpixGrids is a bare
  top-level const, NOT window.HealpixGrids, so it is resolved by the same probe
  used in geosonify-sky.js. Every dependency is optional: if one is missing this
  returns null and the Earth readout stands, which is the correct degradation --
  a card showing metres in sky mode is wrong but legible; a card showing
  "undefined" is neither.

  TWO CONVENTIONS THAT ARE DECISIONS, NOT DEFAULTS  (see CONFIG below)
  -------------------------------------------------------------------
  1. raFirst. Cards currently print "lat x lon". Astronomy prints RA first.
     SKY-HANDOVER.md §9 already quotes BIP39 as 0.32" x 0.16", which is RA-first
     (the computed values are 0.3160" x 0.1580"), so the doc has already adopted
     the convention informally. Default true makes it deliberate.
  2. onSkyRA. An RA extent can be quoted as coordinate span (dRA) or as true
     angle on the sphere (dRA cos dec). Astronomers write "Dalpha cos delta"
     precisely because the two differ and the difference is not small away from
     the equator. Default true = true angle on the sphere, which is what a
     "how big is this cell" readout should mean and what the HEALPix branch
     already reports.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';

  var CONFIG = {
    raFirst: true,    // print RA x Dec rather than Dec x RA
    onSkyRA: true     // apply cos(dec) so the RA extent is a real angle
  };

  var ARCSEC_PER_DEG = 3600;

  // ---- HealpixGrids resolution (bare top-level const, NOT window.*) --------
  // Mirrors the probe in geosonify-sky.js / geosonify-precision.js.
  var _engine = null;                       // explicit override, for Node/tests

  function _HP() {
    if (_engine) return _engine;
    try { if (typeof HealpixGrids !== 'undefined' && HealpixGrids) return HealpixGrids; } catch (e) {}
    if (global && global.HealpixGrids) return global.HealpixGrids;
    return null;
  }

  function setEngine(hp) { _engine = hp || null; return _engine; }

  function _Sky() {
    try { if (typeof GeosonifySky !== 'undefined' && GeosonifySky) return GeosonifySky; } catch (e) {}
    return (global && global.GeosonifySky) || null;
  }

  /*
    Absent frame means earth, forever. AppState has no `frame` key in
    DEFAULT_STATE, so a fresh load returns undefined here -- which must read as
    Earth, not as "unknown, guess". Anything that is not explicitly the sky
    sphere is the Earth.
  */
  function isSky() {
    try {
      var f = global.AppState && global.AppState.get ? global.AppState.get('frame') : null;
      return !!(f && f.sphere === 'sky');
    } catch (e) { return false; }
  }

  function fmt(arcsec) {
    var S = _Sky();
    if (S && typeof S.formatAngle === 'function') return S.formatAngle(arcsec);
    return null;                            // no ladder, no answer -- caller falls back
  }

  /*
    HEALPix cells are diamonds, not lat/lon boxes, so cellSize() reports the
    side of the equal-area square. That is latitude-free by construction, which
    is why this branch needs no declination and never applies cos(dec).
  */
  function healpixText(scheme, iterations) {
    var S = _Sky(), HP = _HP();
    if (!S || typeof S.cellSize !== 'function') return null;
    var k = (HP && typeof HP.clampOrder === 'function') ? HP.clampOrder(iterations) : iterations;
    var size;
    try { size = S.cellSize(k); } catch (e) { return null; }
    if (!size || !size.text) return null;
    return size.text + ' \u00d7 ' + size.text;
  }

  /*
    Graticule vocabularies. The cell is (span / base^iterations) in each axis.
    At deep iterations base^iterations overflows a double, so this stays in
    log space exactly as getPrecisionText() does for the metric version -- the
    only change is that the Earth radius is never introduced.

    dec is needed only for the cos(dec) term, and only when onSkyRA is set.
  */
  function graticuleText(grid, iterations, dec) {
    if (!grid || !grid.length || !grid[0] || !grid[0].length) return null;
    var rows = grid.length, cols = grid[0].length;
    if (!(iterations > 0)) return null;

    var decArcsec = Math.exp(Math.log(180 * ARCSEC_PER_DEG) - iterations * Math.log(rows));
    var raArcsec  = Math.exp(Math.log(360 * ARCSEC_PER_DEG) - iterations * Math.log(cols));

    if (CONFIG.onSkyRA) {
      var d = (typeof dec === 'number' && isFinite(dec)) ? dec : 0;
      // Clamp: at |dec| = 90 the RA extent collapses to zero and the readout
      // would claim infinite resolution in RA. cos is honest right up to the
      // pole; the floor only stops the formatter printing 0.
      raArcsec *= Math.max(Math.cos(d * Math.PI / 180), 1e-12);
    }

    var ra = fmt(raArcsec), de = fmt(decArcsec);
    if (!ra || !de) return null;
    return CONFIG.raFirst ? (ra + ' \u00d7 ' + de) : (de + ' \u00d7 ' + ra);
  }

  /*
    The single entry point card-renderer calls.

      gridKey    -- card key, for future per-card overrides (unused today)
      gridDef    -- the CARD_GRIDS entry (already resolved through
                    presentationOf() by the caller, so borrowed cards arrive
                    as their sibling)
      iterations -- order for HEALPix, subdivision depth for graticules
      coord      -- {lat, lon} read as {dec, ra}; may be null

    Returns a formatted string, or null meaning "not my business, use the
    existing Earth path". Every failure mode returns null.
  */
  function cellText(gridKey, gridDef, iterations, coord) {
    if (!isSky() || !gridDef) return null;

    // Earth-only projected schemes. These are hidden in sky mode; if one is
    // somehow visible, metres are still the truthful answer for it.
    if (gridDef.gis) return null;

    if (gridDef.healpix) return healpixText(gridDef.healpix, iterations);

    return graticuleText(gridDef.grid, iterations, coord ? coord.lat : 0);
  }

  var API = {
    VERSION: VERSION,
    CONFIG: CONFIG,
    isSky: isSky,
    cellText: cellText,
    healpixText: healpixText,
    graticuleText: graticuleText,
    formatAngle: fmt,
    setEngine: setEngine
  };

  global.GeosonifySkyUnits = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  try { console.log('[geosonify] sky-units ' + VERSION + ' loaded'); } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
