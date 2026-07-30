/*
  geosonify-sky-overlay.js  v0.1  — renderer-agnostic overlay geometry

  PURE. No DOM, no Aladin, no Leaflet, no state. Takes cell geometry from
  geosonify-sky.js plus an injected projection function, and returns screen-space
  paths ready for SVG or canvas.

  WHY THIS EXISTS
  ---------------
  Sky mode should feel like Geosonify using a sky canvas, not like Aladin wearing
  a Geosonify hat. So Geosonify draws its own cells, in its own style, from its
  own exact geometry -- and the renderer is asked only one question:

      where on screen is this (ra, dec)?

  Aladin answers via world2pix. Leaflet answers via latLngToContainerPoint. A
  hand-rolled canvas answers with its own maths. None of them ever sees a
  Geosonify cell, and swapping one for another changes nothing in this file.

  THE PAYOFF THAT ISN'T OBVIOUS
  -----------------------------
  Aladin's own MOC renderer is capped at order 29, because MOC is. Drawing cells
  ourselves means that ceiling does not apply to VISUALISATION at all: we compute
  the boundary of an order-40 cell exactly (verified against healpy.boundaries to
  0.45 nanoarcsec) and merely ask where to put the pixels. Geosonify can show a
  cell no astronomy tool can render.

  PROJECTION CONTRACT
  -------------------
    project(raDeg, decDeg) -> [x, y] | null | undefined

  Return null for anything not currently visible -- behind the sphere in an
  orthographic view, outside an all-sky frame, whatever. This module handles
  partial visibility by splitting a ring into open segments rather than drawing
  a straight line across the gap.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';

  // A jump larger than this fraction of the viewport between CONSECUTIVE ring
  // points means the projection wrapped (Aitoff, Mercator seam) rather than the
  // cell genuinely being that big. Split rather than draw a stripe across the sky.
  var WRAP_FRACTION = 0.5;

  function _num(v) { return typeof v === 'number' && isFinite(v); }

  /*
    Project one cell ring into screen space.

      ring        [[dec, ra], ...]   as returned by Sky.cellBoundary(..., {frame:'sky'})
      project     the contract above
      opts.viewport  {width, height} -- only used for wrap detection
      opts.closed    treat the ring as closed (default true)

    Returns:
      { segments: [[[x,y],...], ...],   one entry per visible run
        visible:  bool,
        complete: bool,                 every vertex projected
        clipped:  bool,                 some vertices were not visible
        wrapped:  bool,                 a projection wrap was detected and split
        bbox:     {x, y, w, h} | null,
        maxPx:    number,               largest screen dimension of the cell
        points:   number }              vertices actually projected
  */
  function projectRing(ring, project, opts) {
    opts = opts || {};
    var vp = opts.viewport || {};
    var wrapLimit = WRAP_FRACTION * Math.max(vp.width || 0, vp.height || 0);

    var segments = [], cur = [];
    var clipped = false, wrapped = false, count = 0;
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    var prev = null;

    for (var i = 0; i < ring.length; i++) {
      var p;
      try { p = project(ring[i][1], ring[i][0]); } catch (e) { p = null; }

      if (!p || !_num(p[0]) || !_num(p[1])) {
        clipped = true;
        if (cur.length) { segments.push(cur); cur = []; }
        prev = null;
        continue;
      }

      // Detect a projection wrap: an implausible jump between adjacent vertices.
      if (prev && wrapLimit > 0) {
        var d = Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1]);
        if (d > wrapLimit) {
          wrapped = true;
          if (cur.length) { segments.push(cur); cur = []; }
        }
      }

      cur.push([p[0], p[1]]);
      count++;
      if (p[0] < minx) minx = p[0];
      if (p[0] > maxx) maxx = p[0];
      if (p[1] < miny) miny = p[1];
      if (p[1] > maxy) maxy = p[1];
      prev = p;
    }
    if (cur.length) segments.push(cur);

    var bbox = count ? { x: minx, y: miny, w: maxx - minx, h: maxy - miny } : null;

    return {
      segments: segments,
      visible: count > 0,
      complete: count === ring.length,
      clipped: clipped,
      wrapped: wrapped,
      bbox: bbox,
      maxPx: bbox ? Math.max(bbox.w, bbox.h) : 0,
      points: count
    };
  }

  /*
    Screen-space SVG path for a projected ring.

    A fully visible ring closes with Z. A clipped or wrapped one becomes open
    polylines: closing a partial ring would draw a chord straight through the
    sphere, which looks like a bug and is a lie about the geometry.
  */
  function ringToPath(projected, opts) {
    opts = opts || {};
    var dp = opts.precision === undefined ? 2 : opts.precision;
    var canClose = projected.complete && !projected.wrapped && opts.close !== false;
    var out = [];
    for (var s = 0; s < projected.segments.length; s++) {
      var seg = projected.segments[s];
      if (seg.length < 2) continue;
      var d = 'M' + seg.map(function (p) {
        return p[0].toFixed(dp) + ' ' + p[1].toFixed(dp);
      }).join(' L');
      if (canClose && projected.segments.length === 1) d += ' Z';
      out.push(d);
    }
    return out.join(' ');
  }

  /*
    Which orders in an ancestry chain are worth drawing at the current zoom?

    At a wide field of view a deep cell is sub-pixel: drawing it is a dot that
    claims a precision the screen cannot show. At a narrow field of view a
    shallow ancestor is larger than the viewport and its outline is off-screen
    noise. So pick the band that is actually legible, and report the rest rather
    than silently dropping it.

      chain      from Sky.ancestry(), coarsest first
      boundaryOf(cellEntry) -> ring   (caller supplies; keeps this file free of
                                       any dependency on geosonify-sky.js)
      opts.minPx      below this a cell is a marker, not an outline (default 6)
      opts.maxPx      above this a cell is bigger than useful (default = viewport
                      diagonal * 3)
      opts.viewport   {width, height}

    Returns:
      { draw: [ {cell, projected, px} ... ],   legible, coarsest first
        deepest: entry | null,                 deepest legible cell
        subPixel: [cell...],                   too small to outline here
        oversized: [cell...],                  too big to be useful here
        marker: cell | null }                  deepest cell overall, for a dot
  */
  function pickVisible(chain, boundaryOf, project, opts) {
    opts = opts || {};
    var vp = opts.viewport || { width: 0, height: 0 };
    var diag = Math.sqrt((vp.width || 0) * (vp.width || 0) + (vp.height || 0) * (vp.height || 0));
    var minPx = opts.minPx === undefined ? 6 : opts.minPx;
    var maxPx = opts.maxPx === undefined ? (diag ? diag * 3 : Infinity) : opts.maxPx;

    var draw = [], subPixel = [], oversized = [], deepest = null;

    for (var i = 0; i < chain.length; i++) {
      var cell = chain[i];
      var pr = projectRing(boundaryOf(cell), project, { viewport: vp });
      if (!pr.visible) continue;
      if (pr.maxPx < minPx) { subPixel.push(cell); continue; }
      if (pr.maxPx > maxPx) { oversized.push(cell); continue; }
      var entry = { cell: cell, projected: pr, px: pr.maxPx };
      draw.push(entry);
      deepest = entry;
    }

    return {
      draw: draw,
      deepest: deepest,
      subPixel: subPixel,
      oversized: oversized,
      marker: chain.length ? chain[chain.length - 1] : null
    };
  }

  /*
    An honest one-line description of what the viewport can and cannot show.
    Geosonify's precision culture says the UI states its limits rather than
    quietly rendering a dot and letting the user infer precision from a code.
  */
  /*
    A vector renderer has no resolution ceiling, so this must never read like
    one. Deeper levels are not "too small to exist" -- they are too small TO DRAW
    AT THIS ZOOM, and zooming in reveals them. The only genuine ceiling is the
    projection's double-precision wall, which the renderer reports through
    capabilities().maxResolvableOrder, and which is stated separately because it
    is a different kind of statement.

    (The earlier wording said "smaller than a pixel", which was wrong twice: the
    threshold is minPx, not one pixel, and it implied a limit where there is none.)
  */
  function legibility(picked, deepestCellOrder, opts) {
    opts = opts || {};
    if (!picked.draw.length) return 'Cell is off screen';

    var d = picked.deepest.cell.order;
    var wall = opts.maxResolvableOrder;

    if (wall && deepestCellOrder > wall) {
      return 'Showing to order ' + d + '; order ' + deepestCellOrder +
             ' is past what double-precision angles can resolve (order ' + wall + ')';
    }
    if (d < deepestCellOrder) {
      var n = deepestCellOrder - d;
      return 'Showing to order ' + d + ' \u2014 zoom in for ' + n + ' more level' +
             (n === 1 ? '' : 's');
    }
    return 'Showing all levels to order ' + d;
  }

  var API = {
    VERSION: VERSION,
    WRAP_FRACTION: WRAP_FRACTION,
    projectRing: projectRing,
    ringToPath: ringToPath,
    pickVisible: pickVisible,
    legibility: legibility
  };

  global.GeosonifySkyOverlay = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
