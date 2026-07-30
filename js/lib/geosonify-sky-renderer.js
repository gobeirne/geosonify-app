/*
  geosonify-sky-renderer.js  v0.1  — renderer contract + built-in sky renderer

  THE CONTRACT
  ------------
  Everything above the seam talks to a renderer through this surface and nothing
  else. Aladin Lite implements it. So does the built-in renderer below. So could
  Leaflet, or WorldWide Telescope, or anything else.

    init()                      build DOM inside the container
    destroy()                   tear it down, remove listeners
    project(raDeg, decDeg)      -> [x, y] | null      null = not visible
    unproject(x, y)             -> [ra, dec] | null
    getCenter() / setCenter()   -> [ra, dec]
    getFovDeg() / setFovDeg()   -> number             smaller viewport dimension
    getSize()                   -> {width, height}
    on(evt, cb) / off(evt, cb)  'move' | 'zoom' | 'resize' | 'click'
    overlayGroup()              -> an SVG <g> Geosonify draws its cells into
    attribution()               -> {text, href} | null
    capabilities()              -> {name, imagery, offline, ...}

  WHY A BUILT-IN RENDERER AT ALL
  ------------------------------
  Aladin is the right choice for sky IMAGERY. It is a poor choice for being the
  only way Geosonify can draw a sky, because:

    - it is 2.3 MB and needs the network for every tile, so sky mode would be
      dead offline while the rest of the app is a working PWA;
    - it is LGPL, so it must stay a separate lazily-loaded file, which means
      there is always a window where it is not there yet;
    - and if the ONLY sky view is Aladin's, then Aladin is the product surface,
      which is precisely what we decided against.

  So Geosonify has its own sky renderer: orthographic, SVG, no dependencies, no
  network, a few kilobytes. It shows the graticule and our cells. Aladin then
  becomes an IMAGERY UPGRADE that slots into the same contract rather than a
  hard requirement. The sky view is Geosonify's; Aladin is a layer inside it.

  SVG rather than canvas or WebGL is deliberate: it is inspectable, it scales on
  retina without work, it can be styled from CSS alongside the rest of the app,
  and it can be verified in jsdom without a browser.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;

  var CONTRACT = ['init', 'destroy', 'project', 'unproject', 'getCenter', 'setCenter',
                  'getFovDeg', 'setFovDeg', 'getSize', 'on', 'off', 'overlayGroup',
                  'attribution', 'capabilities'];

  /* Does an object implement the renderer contract? Used by the conformance test
     so a future Aladin adapter cannot quietly omit half the surface. */
  function conformsTo(obj) {
    var missing = CONTRACT.filter(function (m) { return typeof obj[m] !== 'function'; });
    return { ok: missing.length === 0, missing: missing };
  }

  function wrap360(d) { return ((d % 360) + 360) % 360; }

  function el(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in (attrs || {})) e.setAttribute(k, attrs[k]);
    return e;
  }

  /*
    Built-in renderer: orthographic projection of the celestial sphere.

    Orthographic is the honest default for this job. It is what a sphere actually
    looks like, it has no seam, it degrades gracefully at any field of view, and
    its inverse is closed-form. All-sky projections (Aitoff, Mollweide) are for
    showing the whole sphere at once, which is a later choice, not a default.

    HANDEDNESS: the sky is seen from inside, so east is LEFT when north is up.
    The x axis is negated to honour that. Get this wrong and every star chart
    disagrees with you; it is the single most common mistake in home-grown sky
    views and it is one minus sign.
  */
  function createBuiltInRenderer(container, opts) {
    opts = opts || {};
    var centerRa = opts.ra === undefined ? 0 : opts.ra;
    var centerDec = opts.dec === undefined ? 0 : opts.dec;
    var fovDeg = opts.fovDeg === undefined ? 60 : opts.fovDeg;
    var background = opts.background || '#0b0f19';
    var gridColor = opts.gridColor || 'rgba(148,163,184,0.28)';
    var showGrid = opts.showGrid !== false;

    var svg = null, gGrid = null, gOverlay = null, gLimb = null;
    var width = 0, height = 0;
    var listeners = { move: [], zoom: [], resize: [], click: [] };
    var drag = null, ro = null;

    function emit(evt, payload) {
      listeners[evt].slice().forEach(function (cb) {
        try { cb(payload); } catch (e) { /* a bad listener must not stop a redraw */ }
      });
    }

    // px per radian, so that fovDeg spans the smaller viewport dimension
    function scale() {
      var minDim = Math.min(width, height) || 1;
      return (minDim / 2) / Math.sin(Math.max(1e-9, fovDeg * D2R / 2));
    }

    function project(raDeg, decDeg) {
      var l0 = centerRa * D2R, p0 = centerDec * D2R;
      var l = raDeg * D2R, p = decDeg * D2R;
      var cosc = Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(l - l0);
      if (cosc <= 0) return null;                       // far hemisphere
      var s = scale();
      var x = Math.cos(p) * Math.sin(l - l0);
      var y = Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l - l0);
      // minus on x: east is left, because we are inside the sphere looking out
      return [width / 2 - x * s, height / 2 - y * s];
    }

    function unproject(px, py) {
      var s = scale();
      var x = -(px - width / 2) / s, y = -(py - height / 2) / s;
      var rho = Math.sqrt(x * x + y * y);
      if (rho > 1) return null;                         // outside the sphere
      var c = Math.asin(Math.min(1, rho));
      var p0 = centerDec * D2R, l0 = centerRa * D2R;
      var sinc = Math.sin(c), cosc = Math.cos(c);
      var dec = Math.asin(cosc * Math.sin(p0) + (rho ? y * sinc * Math.cos(p0) / rho : 0));
      var ra = l0 + Math.atan2(x * sinc, rho * Math.cos(p0) * cosc - y * Math.sin(p0) * sinc);
      return [wrap360(ra * R2D), dec * R2D];
    }

    /* The graticule is drawn through the SAME projection contract the cells use,
       so if the projection is wrong the grid is visibly wrong too. */
    function drawGrid() {
      if (!gGrid) return;
      while (gGrid.firstChild) gGrid.removeChild(gGrid.firstChild);
      if (!showGrid) return;

      var stepDeg = fovDeg > 120 ? 30 : fovDeg > 40 ? 15 : fovDeg > 10 ? 5 : fovDeg > 2 ? 1 : 0.25;
      var d, path, i;

      for (d = -90 + stepDeg; d <= 90 - stepDeg / 2; d += stepDeg) {   // parallels
        path = [];
        for (i = 0; i <= 360; i += 2) {
          var p = project(i, d);
          path.push(p ? (path.length && path[path.length - 1] !== null ? 'L' : 'M') +
                        p[0].toFixed(1) + ' ' + p[1].toFixed(1) : null);
          if (!p) path.push(null);
        }
        var dstr = path.filter(function (x) { return x !== null; }).join(' ');
        if (dstr) gGrid.appendChild(el('path', { d: dstr, fill: 'none', stroke: gridColor, 'stroke-width': 0.7 }));
      }
      for (var r = 0; r < 360; r += stepDeg * 2) {                     // meridians
        path = [];
        for (i = -89; i <= 89; i += 2) {
          var q = project(r, i);
          path.push(q ? (path.length && path[path.length - 1] !== null ? 'L' : 'M') +
                        q[0].toFixed(1) + ' ' + q[1].toFixed(1) : null);
          if (!q) path.push(null);
        }
        var mstr = path.filter(function (x) { return x !== null; }).join(' ');
        if (mstr) gGrid.appendChild(el('path', { d: mstr, fill: 'none', stroke: gridColor, 'stroke-width': 0.7 }));
      }
    }

    function drawLimb() {
      if (!gLimb) return;
      while (gLimb.firstChild) gLimb.removeChild(gLimb.firstChild);
      var s = scale();
      // the sphere's edge, only meaningful when the whole hemisphere fits
      if (s < Math.min(width, height)) {
        gLimb.appendChild(el('circle', {
          cx: width / 2, cy: height / 2, r: s,
          fill: 'none', stroke: 'rgba(148,163,184,0.45)', 'stroke-width': 1
        }));
      }
    }

    function resize() {
      var r = container.getBoundingClientRect ? container.getBoundingClientRect() : { width: 0, height: 0 };
      width = Math.max(1, Math.round(r.width || container.clientWidth || 640));
      height = Math.max(1, Math.round(r.height || container.clientHeight || 480));
      if (svg) {
        svg.setAttribute('width', width);
        svg.setAttribute('height', height);
        svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        var bg = svg.querySelector('.gs-sky-bg');
        if (bg) { bg.setAttribute('width', width); bg.setAttribute('height', height); }
      }
      drawGrid(); drawLimb();
      emit('resize', { width: width, height: height });
    }

    function onPointerDown(ev) {
      var pt = ev.touches ? ev.touches[0] : ev;
      drag = { x: pt.clientX, y: pt.clientY, ra: centerRa, dec: centerDec, moved: false };
    }
    function onPointerMove(ev) {
      if (!drag) return;
      var pt = ev.touches ? ev.touches[0] : ev;
      var dx = pt.clientX - drag.x, dy = pt.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
      var s = scale();
      // minus on dx mirrors the handedness flip in project()
      centerRa = wrap360(drag.ra + (dx / s) * R2D / Math.max(0.15, Math.cos(centerDec * D2R)));
      centerDec = Math.max(-89.9, Math.min(89.9, drag.dec - (dy / s) * R2D));
      drawGrid(); drawLimb();
      emit('move', { ra: centerRa, dec: centerDec, dragging: true });
      if (ev.preventDefault) ev.preventDefault();
    }
    function onPointerUp(ev) {
      if (drag && !drag.moved && ev && ev.clientX !== undefined) {
        var rect = svg.getBoundingClientRect();
        var c = unproject(ev.clientX - rect.left, ev.clientY - rect.top);
        if (c) emit('click', { ra: c[0], dec: c[1] });
      }
      if (drag) emit('move', { ra: centerRa, dec: centerDec, dragging: false });
      drag = null;
    }
    function onWheel(ev) {
      var f = Math.exp((ev.deltaY || 0) * 0.0015);
      setFovDeg(fovDeg * f);
      if (ev.preventDefault) ev.preventDefault();
    }

    /*
      MINIMUM FIELD OF VIEW -- measured, not guessed.

      A vector renderer has no resolution limit, so zooming should keep working
      until the MATHS runs out, not until something looks small. Zooming until an
      order-k cell spans 200 px and checking the outline is still a real
      quadrilateral:

        order 20-48   four distinct corners, sane area   OK
        order 50+     collapses to three corners, zero area   FAILS

      The wall is order ~49, where adjacent cell corners stop being
      distinguishable as doubles: at |longitude| ~ 3 rad the representable step
      is eps*3 = 4.4e-16 rad, and a cell side of 1.0233/2^k rad reaches that at
      k = 51. Same wall as the order-52 ingestion limit, same cause.

      Order 48 needs a 6.7e-13 degree field, so the floor sits just below it.
      The previous value of 1e-7 stopped at order 30 -- nineteen orders early,
      for no reason but a round number.
    */
    var MIN_FOV_DEG = 5e-13;
    var MAX_RESOLVABLE_ORDER = 48;

    function setFovDeg(d) {
      fovDeg = Math.max(MIN_FOV_DEG, Math.min(180, d));
      drawGrid(); drawLimb();
      emit('zoom', { fovDeg: fovDeg });
    }

    function init() {
      svg = el('svg', { xmlns: SVGNS, class: 'gs-sky-svg' });
      svg.setAttribute('style', 'display:block; touch-action:none; user-select:none; cursor:grab;');
      svg.appendChild(el('rect', { class: 'gs-sky-bg', x: 0, y: 0, width: 1, height: 1, fill: background }));
      gGrid = el('g', { class: 'gs-sky-grid' });
      gLimb = el('g', { class: 'gs-sky-limb' });
      gOverlay = el('g', { class: 'gs-sky-overlay' });
      svg.appendChild(gGrid); svg.appendChild(gLimb); svg.appendChild(gOverlay);
      container.appendChild(svg);

      svg.addEventListener('mousedown', onPointerDown);
      svg.addEventListener('touchstart', onPointerDown, { passive: true });
      global.addEventListener('mousemove', onPointerMove);
      svg.addEventListener('touchmove', onPointerMove, { passive: false });
      global.addEventListener('mouseup', onPointerUp);
      svg.addEventListener('touchend', onPointerUp);
      svg.addEventListener('wheel', onWheel, { passive: false });

      if (global.ResizeObserver) {
        ro = new global.ResizeObserver(resize);
        ro.observe(container);
      } else {
        global.addEventListener('resize', resize);
      }
      resize();
      return true;
    }

    function destroy() {
      if (ro) { try { ro.disconnect(); } catch (e) {} ro = null; }
      global.removeEventListener('mousemove', onPointerMove);
      global.removeEventListener('mouseup', onPointerUp);
      global.removeEventListener('resize', resize);
      if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
      svg = gGrid = gLimb = gOverlay = null;
      listeners = { move: [], zoom: [], resize: [], click: [] };
    }

    return {
      init: init,
      destroy: destroy,
      project: project,
      unproject: unproject,
      getCenter: function () { return [centerRa, centerDec]; },
      setCenter: function (ra, dec) {
        centerRa = wrap360(ra);
        centerDec = Math.max(-89.9, Math.min(89.9, dec));
        drawGrid(); drawLimb();
        emit('move', { ra: centerRa, dec: centerDec, dragging: false });
      },
      getFovDeg: function () { return fovDeg; },
      setFovDeg: setFovDeg,
      getSize: function () { return { width: width, height: height }; },
      on: function (evt, cb) { if (listeners[evt]) listeners[evt].push(cb); },
      off: function (evt, cb) {
        if (!listeners[evt]) return;
        listeners[evt] = listeners[evt].filter(function (f) { return f !== cb; });
      },
      overlayGroup: function () { return gOverlay; },
      attribution: function () { return null; },   // nothing borrowed, nothing owed
      capabilities: function () {
        return {
          name: 'Geosonify built-in',
          imagery: false,          // graticule only; no sky survey
          offline: true,           // no network at all
          handedness: 'sky',       // east left, viewed from inside
          projection: 'orthographic',
          minFovDeg: MIN_FOV_DEG,
          maxResolvableOrder: MAX_RESOLVABLE_ORDER   // double-precision wall

        };
      },
      redrawChrome: function () { drawGrid(); drawLimb(); }
    };
  }

  var API = {
    VERSION: VERSION,
    CONTRACT: CONTRACT,
    conformsTo: conformsTo,
    createBuiltInRenderer: createBuiltInRenderer
  };

  global.GeosonifySkyRenderer = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
