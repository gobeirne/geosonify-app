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

  /*
    Whether to re-match after the imagery swaps in.

    The built-in pass is exact (-0.0029% every time, in every log). The Aladin
    pass is the one that regresses, so this exists as a switch you can flip from
    the console while the cause is still being pinned down:

        GeosonifySkyZoom.REMATCH_AFTER_IMAGERY = false

    With it off, the field the built-in renderer converged on is handed to
    Aladin and left alone. If that looks right on screen, the fault is in
    Aladin's world2pix rather than in the matching -- which is exactly what the
    implVertDeg figures in the log are there to confirm.
  */
  var REMATCH_AFTER_IMAGERY = true;

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
  /*
    ============================================================================
    MEASURE THE CELL EACH VIEW IS ACTUALLY DRAWING.
    ============================================================================

    Matching pixels was right; matching them on the wrong cell was not.

    The Earth map draws the ACTIVE CARD's cell, at the card's own depth. The sky
    view was drawing a HEALPix cell at its own `order`, which starts at 16 and
    has nothing to do with the card. Opening ?hphex=956250B00834 -- twelve hex
    characters, two levels each, so order 22 -- put a 1.56 m cell on the map and
    a 99.6 m cell in the sky. Six orders apart is 2^6 = 64x, which is the five to
    six manual zoom stops it took to reconcile them.

    Both measurements were self-consistent and both were of a cell neither view
    had on screen.

    So the geometry to measure is chosen from the active card:

      HEALPix card   the cell at the CARD's order, and the sky view adopts that
                     order so it draws the same one
      graticule card the card's own cell ring, which is identical lat/lon
                     geometry in both frames and needs no order at all
      no card        the sky view's order, as before

    orderForActiveCard() is exported so the view can set its order BEFORE
    drawing, rather than drawing one cell and measuring another.
  */
  function _Cards() { return global.GeosonifySkyCards || null; }

  function orderForActiveCard(fallbackOrder) {
    var Cards = _Cards(), HP = _HP();
    if (!Cards || !Cards.activeCard) return fallbackOrder;
    var card = null;
    try { card = Cards.activeCard(); } catch (e) { return fallbackOrder; }
    if (!card || card.kind !== 'healpix') return fallbackOrder;
    var k = card.iterations;
    if (!(k > 0)) return fallbackOrder;
    return (HP && HP.clampOrder) ? HP.clampOrder(k) : k;
  }

  /*
    The points to measure, and where they came from. Returns
    { points, order, source } or null.
  */
  function targetGeometry(decDeg, raDeg, fallbackOrder) {
    var Cards = _Cards(), card = null;
    if (Cards && Cards.activeCard) {
      try { card = Cards.activeCard(); } catch (e) {}
    }

    if (card && card.kind === 'graticule' && Cards.activeCardRings) {
      try {
        var got = Cards.activeCardRings(decDeg, raDeg, { levels: 1 });
        if (got && got.rings && got.rings.length) {
          var deepest = got.rings[got.rings.length - 1];
          if (deepest && deepest.ring && deepest.ring.length >= 3) {
            return { points: deepest.ring, order: null, source: card.key };
          }
        }
      } catch (e) {}
    }

    var order = orderForActiveCard(fallbackOrder);
    var c = cellCorners(decDeg, raDeg, order);
    return c ? { points: c, order: order, source: (card ? card.key : 'healpix') } : null;
  }

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

  /*
    DEGREES PER PIXEL, STRAIGHT FROM THE PROJECTION.

    Two renderers reported the same 50 px cell at fields differing by 1.59x,
    which is only possible if their projections disagree about how many degrees
    a pixel is worth. Neither the fov number nor the cell measurement can tell
    them apart -- fov is a convention and the cell measurement is what the loop
    optimised. This is the independent third quantity.

    Project two points a known small angle apart in DECLINATION, either side of
    the mark, and read off the pixel separation. Declination because it is
    latitude exactly, with no cos anywhere; small because the projection is only
    locally linear.

    implVertDeg is then the angular height of the whole pane, which is directly
    comparable between renderers, and comparable to the Earth map's latitude
    span. If the built-in and Aladin report different implVertDeg while both
    claim the same cell size, the disagreement is in Aladin's world2pix and no
    amount of matching will fix it.
  */
  function impliedVerticalDeg(renderer, decDeg, raDeg) {
    if (!renderer || !renderer.project || !renderer.getSize) return null;
    var d = 1e-4;                       // 0.36 arcsec; safely inside linearity
    var a, b;
    try {
      a = renderer.project(raDeg, decDeg - d);
      b = renderer.project(raDeg, decDeg + d);
    } catch (e) { return null; }
    if (!a || !b) return null;
    var ay = (typeof a.y === 'number') ? a.y : a[1];
    var by = (typeof b.y === 'number') ? b.y : b[1];
    if (!isFinite(ay) || !isFinite(by)) return null;
    var px = Math.abs(by - ay);
    if (!px) return null;
    var degPerPx = (2 * d) / px;
    var size = renderer.getSize();
    return degPerPx * (size.height || 0);
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
    var geom = targetGeometry(decDeg, raDeg, order);
    var corners = geom ? geom.points : null;
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
      implVertDeg: impliedVerticalDeg(renderer, decDeg, raDeg),
      earthLatSpanDeg: earthVerticalSpanDeg(map),
      pane: renderer.getSize ? (renderer.getSize().width + 'x' + renderer.getSize().height) : null,
      order: geom.order,
      cell: geom.source
    });
    return renderer.getFovDeg();
  }

  /*
    SKY -> EARTH. Same idea, solving Leaflet's zoom instead.

    Pixel size doubles per zoom level, so the correction is a log2 of the ratio
    -- again applied and re-measured rather than trusted.
  */
  function matchCellSkyToEarth(renderer, map, decDeg, raDeg, order) {
    var geom = targetGeometry(decDeg, raDeg, order);
    var corners = geom ? geom.points : null;
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

    /*
      LEAFLET SNAPS ZOOM TO WHOLE LEVELS UNLESS TOLD NOT TO.

      map-manager.js does not set zoomSnap, so it defaults to 1 and setView
      rounds any fractional zoom to an integer. The correction loop therefore
      could not converge: it asked for 16.34, got 16, asked again, got 16 again,
      and exhausted its passes. The console showed it exactly --

          target=113.7154  achieved=100  errorPct=-12.06  passes=6  zoom=16
          target=56.5478   achieved=50   errorPct=-11.58  passes=6  zoom=15

      -- six passes every time, and a zoom landing on a suspiciously round
      number. A whole zoom level is a factor of two, so the error can be
      anything up to 100%; 12% was luck.

      zoomSnap is relaxed only for the duration of this adjustment and then put
      back, because it also governs how the map behaves under the user's own
      pinch and scroll, and that is not this function's business to change.
      zoomDelta is untouched, so the +/- buttons still step by whole levels.
    */
    var hadSnap = (map.options && 'zoomSnap' in map.options) ? map.options.zoomSnap : undefined;
    var relaxed = false;
    try {
      if (map.options) { map.options.zoomSnap = 0; relaxed = true; }
    } catch (e) {}

    var passes = 0, got = null, z = map.getZoom();
    try {
      for (; passes < MAX_PASSES; passes++) {
        got = spanPx(corners, eProj);
        if (!got || got <= 0) break;
        if (Math.abs(got - target) / target <= TOLERANCE) break;
        var delta = Math.log(target / got) / Math.LN2;
        if (!isFinite(delta)) break;
        z = z + delta;
        try { map.setView([decDeg, lon], z, { animate: false }); } catch (e) { break; }
      }
    } finally {
      if (relaxed) {
        try {
          if (hadSnap === undefined) delete map.options.zoomSnap;
          else map.options.zoomSnap = hadSnap;
        } catch (e) {}
      }
    }

    report('sky->earth', {
      zoomSnapWas: (hadSnap === undefined ? 'unset(default 1)' : hadSnap),
      targetCellPx: target,
      achievedCellPx: got,
      errorPct: (got && target) ? ((got - target) / target * 100) : null,
      passes: passes,
      zoom: map.getZoom ? map.getZoom() : null,
      implVertDeg: impliedVerticalDeg(renderer, decDeg, raDeg),
      earthLatSpanDeg: earthVerticalSpanDeg(map),
      order: geom.order,
      cell: geom.source
    });
    return map.getZoom ? map.getZoom() : null;
  }

  var API = {
    VERSION: VERSION,
    get REMATCH_AFTER_IMAGERY() { return REMATCH_AFTER_IMAGERY; },
    set REMATCH_AFTER_IMAGERY(v) { REMATCH_AFTER_IMAGERY = !!v; },
    earthVerticalSpanDeg: earthVerticalSpanDeg,
    cellCorners: cellCorners,
    orderForActiveCard: orderForActiveCard,
    impliedVerticalDeg: impliedVerticalDeg,
    targetGeometry: targetGeometry,
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
