/*
  geosonify-sky-zoom.js  v0.1  — the same amount of world, either way

  THE POINT
  ---------
  Flipping between Earth and Sky should teach you the scale. It cannot do that if
  the two views show wildly different amounts: a map at street level next to a
  sky at 60 degrees says nothing about how 50 milliarcseconds relates to 50
  metres. Carry the zoom across and the flip becomes the lesson -- your suburb is
  that patch, that cell is that big.

  WHICH AXIS, AND WHY IT MUST BE THE VERTICAL
  --------------------------------------------
  The two projections cannot agree on both axes at once, so one has to be chosen,
  and only one of them is free of a fudge factor.

  Declination IS latitude -- the same number, no scaling, no cos anywhere. A
  viewport spanning 0.01 degrees of latitude and a sky field spanning 0.01
  degrees of declination cover the identical angular extent, exactly.

  The horizontal cannot do this. Right ascension is longitude numerically, but a
  degree of longitude is a degree of ANGLE only at the equator; elsewhere it is
  cos(dec) smaller on the sphere while Mercator draws it full width. Matching
  horizontally would need a factor that is right in one place and wrong
  everywhere else. So: match the vertical exactly, and let the horizontal fall
  where the projections put it. That is also the axis unaffected by the east-west
  handedness flip, which makes it the one a person can actually compare by eye.

  THE VERTICAL SPAN IS COMPUTED, NOT ASSUMED
  ------------------------------------------
  The sky renderer's fovDeg spans the SMALLER viewport dimension (scale() uses
  min(width, height)), so on a landscape map pane it is the height and on a
  portrait one it is the width. Taking fovDeg as "the vertical field" would be
  right half the time. It is derived from the projection instead:

      a point h/2 pixels above centre sits at sin(c) = (h/2) / scale
      so the half-field is asin((h/2)/scale), exactly, at any field size.

  Leaflet's side needs no such care: getBounds() reports north and south
  directly, so the latitude span is read rather than modelled -- which also means
  it is correct across Mercator's varying vertical scale without this module
  knowing anything about Mercator.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';
  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;

  // The sky view refuses to go below this; matching a deep Earth zoom can ask
  // for less, and clamping silently is better than failing to switch.
  var MIN_FOV_DEG = 1e-9;

  function earthVerticalSpanDeg(map) {
    if (!map || !map.getBounds) return null;
    try {
      var b = map.getBounds();
      var span = b.getNorth() - b.getSouth();
      return (isFinite(span) && span > 0) ? span : null;
    } catch (e) { return null; }
  }

  /*
    ============================================================================
    MATCH THE CELL, NOT THE FIELD.
    ============================================================================

    The first version computed an angular span on one side and asked the other
    side to adopt it. That is modelling, and it kept losing to things the model
    did not know: the two renderers disagreed about which axis fovDeg names,
    Aladin applies its own clamps, and the pane is a different height when the
    sky opens (546 px) from when it closes (493 px).

    So stop asking. MEASURE THE CELL IN PIXELS in the frame you are leaving, and
    then adjust the frame you are entering until its cell measures the same. The
    cell is the one object both views draw, it has the same corners in both, and
    pixels are the thing the eye actually compares -- which is the whole point of
    flipping back and forth.

    This is immune, by construction, to every failure above. It does not care
    what setFovDeg means, whether a renderer clamps, or what the pane height is,
    because it looks at the result rather than trusting the request. If a
    renderer refuses to go where it is asked, the loop stops converging and says
    so instead of silently landing somewhere else.

    PRE-CALCULATED, AND INDEPENDENT OF IMAGERY LOADING.

    The target is computed from the Earth map before the sky opens, and applied
    to whichever renderer is live at the time -- the built-in one, immediately,
    with no network involved. When Aladin arrives seconds later the same
    correction runs again against Aladin. Neither depends on the other, so a slow
    or failed download costs imagery, never scale.
  */

  var MAX_PASSES = 6;
  var TOLERANCE = 0.005;              // 0.5% of the target height; sub-pixel

  function _Sky() {
    try { if (typeof GeosonifySky !== 'undefined' && GeosonifySky) return GeosonifySky; } catch (e) {}
    return (global && global.GeosonifySky) || null;
  }
  function _HP() {
    try { if (typeof HealpixGrids !== 'undefined' && HealpixGrids) return HealpixGrids; } catch (e) {}
    return (global && global.HealpixGrids) || null;
  }

  /*
    The cell to measure: whatever the sky view is marking, at its current order.
    Corners rather than the full boundary -- four points are enough for a
    bounding height and cost nothing.

    Returns [[dec, ra], ...] or null.
  */
  function cellCorners(decDeg, raDeg, order) {
    var S = _Sky(), HP = _HP();
    if (!S || !HP || !S.cellCorners4) return null;
    try {
      var ipix = HP.nestIndex(decDeg, raDeg, order);
      var c = S.cellCorners4(order, ipix);
      return (c && c.length >= 3) ? c : null;
    } catch (e) { return null; }
  }

  // Vertical pixel extent of a set of [dec, ra] points under an arbitrary
  // projection. Vertical, because declination is latitude exactly -- see the
  // note at the top of the file.
  function spanPx(points, projectFn) {
    if (!points || !points.length || typeof projectFn !== 'function') return null;
    var lo = Infinity, hi = -Infinity, seen = 0;
    for (var i = 0; i < points.length; i++) {
      var p;
      try { p = projectFn(points[i][0], points[i][1]); } catch (e) { p = null; }
      if (!p) continue;
      var y = (typeof p.y === 'number') ? p.y : p[1];
      if (!isFinite(y)) continue;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
      seen++;
    }
    if (seen < 2 || !isFinite(lo) || !isFinite(hi)) return null;
    return hi - lo;
  }

  function earthProjector(map) {
    if (!map || !map.latLngToContainerPoint) return null;
    return function (dec, ra) {
      var lon = ra > 180 ? ra - 360 : ra;
      try { return map.latLngToContainerPoint([dec, lon]); } catch (e) { return null; }
    };
  }

  function skyProjector(renderer) {
    if (!renderer || !renderer.project) return null;
    return function (dec, ra) {
      try { return renderer.project(ra, dec); } catch (e) { return null; }
    };
  }

  /*
    ONE FLAT STRING, NOT AN OBJECT.

    console.log(tag, obj) renders as "... Object" in any console that does not
    auto-expand -- Edge and Safari both collapse it, and a log you have to click
    to read is a log nobody reads. Everything worth seeing goes in the line
    itself, with numbers formatted short enough to scan.
  */
  function num(v) {
    if (v === null || v === undefined || !isFinite(v)) return String(v);
    var a = Math.abs(v);
    if (a === 0) return '0';
    if (a < 1e-3 || a >= 1e6) return v.toExponential(4);
    return String(Math.round(v * 1e4) / 1e4);
  }

  function report(tag, obj) {
    var bits = [];
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var v = obj[k];
      bits.push(k + '=' + (typeof v === 'number' ? num(v) : String(v)));
    }
    try { console.log('[geosonify] zoom ' + tag + '  ' + bits.join('  ')); } catch (e) {}
  }

  /*
    EARTH -> SKY. Adjust the sky field until the cell is the same height on
    screen as it was on the map.

    Pixel height goes as roughly 1/fov at small fields, so scaling the field by
    (measured / target) converges geometrically -- typically two passes to well
    under a pixel. Iterating rather than solving is what makes it renderer-blind.
  */
  function matchCellEarthToSky(map, renderer, decDeg, raDeg, order) {
    var corners = cellCorners(decDeg, raDeg, order);
    var eProj = earthProjector(map), sProj = skyProjector(renderer);
    if (!corners || !eProj || !sProj || !renderer.setFovDeg) {
      report('earth->sky ABORT', {
        reason: 'cannot measure', hasCorners: !!corners,
        hasEarthProjector: !!eProj, hasSkyProjector: !!sProj
      });
      return null;
    }

    var target = spanPx(corners, eProj);
    if (!target || target <= 0) {
      // The cell is sub-pixel or off-screen on the map: nothing to match to.
      // Fall back to the angular span, which is still better than the default.
      var span = earthVerticalSpanDeg(map);
      if (span) { try { renderer.setFovDeg(span); } catch (e) {} }
      report('earth->sky fallback', { reason: 'cell not measurable on map', span: span });
      return span || null;
    }

    var passes = 0, got = null;
    for (; passes < MAX_PASSES; passes++) {
      got = spanPx(corners, sProj);
      if (!got || got <= 0) break;
      if (Math.abs(got - target) / target <= TOLERANCE) break;
      var next = renderer.getFovDeg() * (got / target);
      if (!isFinite(next) || next <= 0) break;
      try { renderer.setFovDeg(next); } catch (e) { break; }
    }

    report('earth->sky', {
      targetCellPx: target,
      achievedCellPx: got,
      errorPct: (got && target) ? ((got - target) / target * 100) : null,
      passes: passes,
      fov: renderer.getFovDeg(),
      order: order
    });
    return renderer.getFovDeg();
  }

  /*
    SKY -> EARTH. Same idea, solving Leaflet's zoom instead.

    Pixel size doubles per zoom level, so the correction is a log2 of the ratio
    -- again applied and re-measured rather than trusted.
  */
  function matchCellSkyToEarth(renderer, map, decDeg, raDeg, order) {
    var corners = cellCorners(decDeg, raDeg, order);
    var eProj = earthProjector(map), sProj = skyProjector(renderer);
    if (!corners || !eProj || !sProj || !map.setView || !map.getZoom) {
      report('sky->earth ABORT', { reason: 'cannot measure' });
      return null;
    }

    var target = spanPx(corners, sProj);
    if (!target || target <= 0) {
      report('sky->earth ABORT', { reason: 'cell not measurable in sky' });
      return null;
    }

    var lon = raDeg > 180 ? raDeg - 360 : raDeg;
    var passes = 0, got = null, z = map.getZoom();
    for (; passes < MAX_PASSES; passes++) {
      got = spanPx(corners, eProj);
      if (!got || got <= 0) break;
      if (Math.abs(got - target) / target <= TOLERANCE) break;
      var delta = Math.log(target / got) / Math.LN2;
      if (!isFinite(delta)) break;
      z = z + delta;
      try { map.setView([decDeg, lon], z, { animate: false }); } catch (e) { break; }
    }

    report('sky->earth', {
      targetCellPx: target,
      achievedCellPx: got,
      errorPct: (got && target) ? ((got - target) / target * 100) : null,
      passes: passes,
      zoom: map.getZoom ? map.getZoom() : null,
      order: order
    });
    return map.getZoom ? map.getZoom() : null;
  }

  var API = {
    VERSION: VERSION,
    earthVerticalSpanDeg: earthVerticalSpanDeg,
    cellCorners: cellCorners,
    spanPx: spanPx,
    earthProjector: earthProjector,
    skyProjector: skyProjector,
    matchCellEarthToSky: matchCellEarthToSky,
    matchCellSkyToEarth: matchCellSkyToEarth,
    // Kept under the old names so callers do not need to know this changed.
    carryEarthZoomToSky: matchCellEarthToSky,
    carrySkyZoomToEarth: matchCellSkyToEarth
  };

  global.GeosonifySkyZoom = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  try { console.log('[geosonify] sky-zoom ' + VERSION + ' loaded'); } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
