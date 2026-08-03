/*
  geosonify-sky-view.js  v0.1  — the in-app sky view

  A full-screen overlay. Deliberately NOT a change to the map pane: it mounts
  itself over everything, and closing it leaves the app exactly as it was. One
  script tag, no mount div, no edits to card-renderer.js, no change to layout.

  Composition, not inheritance from anything:
    geosonify-sky-renderer.js   the canvas and the projection
    geosonify-sky-overlay.js    geometry -> screen paths
    geosonify-sky.js            the maths and the cell addresses

  The renderer is behind a contract, so an Aladin-backed renderer can be dropped
  in later without touching a line of this file. Geosonify owns the chrome, the
  readouts, the styling and the depth honesty; a renderer only ever answers
  "where on screen is this (ra, dec)?".

  PRIVACY: the view shows the true cell of the current pin, so it redacts under
  passphrase or obfuscation exactly as the sky panel does. Same rule, same
  reason, and it is the whole reason a "just show the sky" view cannot skip it.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var RAMP = ['#475569', '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0'];
  var ACCENT = '#f87171';
  // The starred card's cell. Distinct from ACCENT so the graticule box is never
  // mistaken for the HEALPix cell the footer numbers actually describe.
  var CARD_ACCENT = '#4ade80';
  var REDACT = '\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588';
  var D2R = Math.PI / 180;
  var ancestryLevels = 6;          // parents drawn above the deepest cell
  var MIN_ORDER = 1, MAX_ORDER = 52;

  var MAP_CONTAINER_ID = 'mapContainerMobile';

  var host = null, renderer = null, els = null, styleTag = null;
  var order = 16;
  var provenance = null;          // what the last click actually justified
  var shapes = [];                // drawn shapes, in sky coordinates
  var rendererKind = 'builtin';   // 'builtin' | 'aladin'
  var orderIsManual = false;      // did the user override the justified order?
  var mark = null;
  var mapEl = null;

  function _Sky() {
    try { if (typeof GeosonifySky !== 'undefined' && GeosonifySky) return GeosonifySky; } catch (e) {}
    return global.GeosonifySky || null;
  }
  function _Overlay() { return global.GeosonifySkyOverlay || null; }
  function _Shapes() { return global.GeosonifySkyShapes || null; }
  function _Aladin() { return global.GeosonifySkyAladin || null; }
  function _RendererLib() { return global.GeosonifySkyRenderer || null; }
  function _HP() {
    var S = _Sky();
    if (S && S.getEngine && S.getEngine()) return S.getEngine();
    try { if (typeof HealpixGrids !== 'undefined' && HealpixGrids) return HealpixGrids; } catch (e) {}
    return global.HealpixGrids || null;
  }
  function _privacyOn() {
    var cr = global.CardRenderer;
    if (!cr) return false;
    var p = '', o = false;
    try { p = cr.getPassphrase ? (cr.getPassphrase() || '') : ''; } catch (e) {}
    try { o = cr.isObfuscated ? !!cr.isObfuscated() : false; } catch (e) {}
    return !!(p || o);
  }

  function isAvailable() {
    return !!(_Sky() && _Overlay() && _RendererLib() && _HP());
  }

  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) e.setAttribute('style', style);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /*
    Hide the Earth-only cards while the sky is showing.

    A card with gridDef.gis is a GIS scheme -- MGRS, Plus Codes, NZTM and the
    rest -- and those mean nothing on the celestial sphere. Showing them would be
    silently wrong, which is the failure this project exists to avoid.

    Done with an injected stylesheet keyed on [data-grid-key], NOT by editing
    card-renderer.js: the scheme list comes from GISGrids.SCHEMES, so it stays
    correct as schemes are added, and leaving the highest-risk file untouched is
    worth more than the tidiness of doing it "properly".

    Honest caveat: this hides them, it does not remove them from card state. That
    is acceptable only while sky mode emits no URLs. The moment it does, this
    needs to become a real capability flag.
  */
  /*
    Card gating.

    Delegates to GeosonifySkyFrames, which derives each card's valid frames from
    what the definition already declares (gis: -> earth, sky: -> sky, healpix: /
    grid: -> both) rather than from a hardcoded list of GIS scheme names. Three
    things the old stylesheet could not do and now matters: it hides sky-only
    cards on EARTH as well, it can answer "valid here?" to code before any DOM
    exists, and it cannot go stale against a card added later.

    The stylesheet remains the mechanism -- still the cheapest way to hide cards
    without touching renderCards() -- but it is generated from the capability.
    The old GISGrids path is kept as a fallback so this degrades rather than
    failing open if the module is absent.
  */
  function gateEarthOnlyCards(on) {
    var Frames = global.GeosonifySkyFrames;
    if (Frames) {
      if (!on) { Frames.clearGate(); styleTag = null; return; }
      Frames.applyGate('sky');
      styleTag = document.getElementById(Frames.STYLE_ID);
      return;
    }

    if (styleTag) { styleTag.parentNode.removeChild(styleTag); styleTag = null; }
    if (!on) return;
    var keys = [];
    try {
      if (typeof GISGrids !== 'undefined' && GISGrids.SCHEMES) keys = Object.keys(GISGrids.SCHEMES);
      else if (global.GISGrids && global.GISGrids.SCHEMES) keys = Object.keys(global.GISGrids.SCHEMES);
    } catch (e) {}
    if (!keys.length) return;
    var sel = keys.map(function (k) { return '[data-grid-key="' + k + '"]'; }).join(',');
    styleTag = document.createElement('style');
    styleTag.id = 'gs-sky-card-gate';
    styleTag.textContent = sel + '{display:none !important;}';
    document.head.appendChild(styleTag);
  }

  var _mapRO = null;

  /*
    Match the host to the map element's box: same top offset within the wrapper,
    same height. Left/right stay 0 because the map is full-width.

    offsetTop rather than 0: the map is the wrapper's first child today, but
    pinning to its measured position survives anything being inserted above it.
  */
  function syncHostToMap() {
    if (!host || !mapEl) return;
    host.style.top = (mapEl.offsetTop || 0) + 'px';
    var h = mapEl.offsetHeight || mapEl.clientHeight || 0;
    if (h) host.style.height = h + 'px';
  }

  function watchMapSize() {
    if (_mapRO || !mapEl || typeof global.ResizeObserver !== 'function') return;
    try {
      _mapRO = new global.ResizeObserver(function () {
        syncHostToMap();
        // The renderer reads its container's box on resize; tell it the box moved.
        if (renderer && renderer.redrawChrome) { try { renderer.redrawChrome(); } catch (e) {} }
        draw();
      });
      _mapRO.observe(mapEl);
    } catch (e) { _mapRO = null; }
  }

  function unwatchMapSize() {
    if (!_mapRO) return;
    try { _mapRO.disconnect(); } catch (e) {}
    _mapRO = null;
  }

  function build() {
    mapEl = document.getElementById(MAP_CONTAINER_ID);

    /*
      Sit exactly over the map pane rather than over the whole screen. The coord
      bar, the cards, the tabs and the sky panel all stay put and stay usable --
      Geosonify with a sky canvas, rather than a sky app that took the screen.

      Absolute inside the map's own offset parent, so nothing is reparented and
      Leaflet never learns it has been covered. Falls back to full-screen only if
      the map pane cannot be found.
    */
    var mounted = false;
    if (mapEl && mapEl.parentNode) {
      var cs = global.getComputedStyle ? global.getComputedStyle(mapEl.parentNode) : null;
      if (cs && cs.position === 'static') mapEl.parentNode.style.position = 'relative';
      /*
        Size to the MAP, not the wrapper.

        The DOM is

            #sharedMapContainer
              #mapContainerMobile     <- Leaflet
              #mapResizeHandle        <- 12px drag bar, BELOW the map
              #mapResizeHandleH

        so `inset:0` on a child of the wrapper spanned the handle as well and
        buried it. The symptom: the handle vanishes in sky mode, and you have to
        switch to Earth, drag, and switch back -- which worked only because the
        host is rebuilt on open() and re-read the wrapper's new height.

        Pinned to the map's own box instead, and kept in sync with a
        ResizeObserver so dragging the handle resizes the sky view live, exactly
        as it resizes the map.
      */
      host = el('div',
        'position:absolute; left:0; right:0; top:0; background:#0b0f19; color:#e5e7eb; ' +
        'display:flex; flex-direction:column; overflow:hidden; ' +
        'font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;');

      /*
        z-index must clear Leaflet's CONTROLS, not just its panes.

        Leaflet's panes top out at 700 (.leaflet-popup-pane), so 500 looked
        sufficient. But leaflet.css also carries

            .leaflet-top, .leaflet-bottom { position: absolute; z-index: 1000; }

        and .leaflet-container gets position:relative with NO z-index and no
        isolation -- so it does not open a stacking context, and those control
        containers compete directly against this host in the shared parent.
        At 500 they won: the zoom control and the attribution painted straight
        through the sky, giving two overlapping sets of +/- and an OpenStreetMap
        credit on a star field.

        1001 is the smallest value that clears them. The app's own scale jumps
        from 500 to 1200, so this sits in an empty gap and nothing else moves.
      */
      host.style.zIndex = '1001';
      syncHostToMap();
      mapEl.parentNode.appendChild(host);
      watchMapSize();
      mounted = true;
    }
    if (!mounted) {
      host = el('div',
        'position:fixed; inset:0; z-index:9999; background:#0b0f19; color:#e5e7eb; ' +
        'display:flex; flex-direction:column; ' +
        'font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;');
    }

    // ── header: Geosonify's chrome, not the renderer's ──
    var bar = el('div', 'display:flex; align-items:center; gap:10px; padding:9px 12px; ' +
                        'border-bottom:1px solid #1f2937; flex:0 0 auto;');
    bar.appendChild(el('span', 'font-weight:600;', 'Sky'));
    var frameTag = el('span', 'font-size:11px; color:#94a3b8;');
    bar.appendChild(frameTag);
    // Credit appears only when something is actually borrowed.
    var attrib = document.createElement('a');
    attrib.setAttribute('style', 'font-size:10.5px; color:#64748b; text-decoration:none;');
    bar.appendChild(attrib);

    var stepWrap = el('div', 'margin-left:auto; display:flex; align-items:center; gap:6px;');
    var btnStyle = 'width:30px; height:30px; border:1px solid #1f2937; border-radius:6px; ' +
                   'background:transparent; color:#e5e7eb; font-size:16px; line-height:1; cursor:pointer;';
    var minus = el('button', btnStyle, '\u2212');
    var plus = el('button', btnStyle, '+');
    var orderTxt = el('span', 'font-size:12px; min-width:62px; text-align:center; color:#cbd5e1;');
    minus.setAttribute('aria-label', 'Coarser cell');
    plus.setAttribute('aria-label', 'Finer cell');
    stepWrap.appendChild(minus); stepWrap.appendChild(orderTxt); stepWrap.appendChild(plus);
    var close = el('button', btnStyle + ' margin-left:6px;', '\u2715');
    close.setAttribute('aria-label', 'Close sky view');
    stepWrap.appendChild(close);
    bar.appendChild(stepWrap);
    host.appendChild(bar);

    // ── the renderer's container ──
    var canvasWrap = el('div', 'flex:1 1 auto; min-height:0; position:relative;');
    host.appendChild(canvasWrap);

    /*
      Zoom controls.

      The map's own +/- are Leaflet's, inside mapContainerMobile. They sit at
      z-index 1000 (leaflet.css .leaflet-top), so this host must clear that --
      see the z-index note in build(). Once it does they are covered and
      unclickable, and Geosonify draws its own in the same place and the same
      shape, wired to the renderer's field of view. Consistent with the rest of
      this: we own the chrome.

      Zooming IN recentres on the marked cell, because "zoom in" here means
      "look closer at the thing I selected", not "magnify the middle of wherever
      I happen to have dragged to".
    */
    var zoomBox = el('div', 'position:absolute; top:10px; left:10px; z-index:10; ' +
                            'display:flex; flex-direction:column; border-radius:6px; overflow:hidden; ' +
                            'box-shadow:0 1px 5px rgba(0,0,0,.65);');
    var zStyle = 'width:32px; height:32px; border:none; background:#1f2937; color:#e5e7eb; ' +
                 'font-size:19px; line-height:1; cursor:pointer; display:block;';
    var zIn = el('button', zStyle + ' border-bottom:1px solid #374151;', '+');
    var zOut = el('button', zStyle, '\u2212');
    zIn.setAttribute('aria-label', 'Zoom in');
    zOut.setAttribute('aria-label', 'Zoom out');
    zoomBox.appendChild(zIn); zoomBox.appendChild(zOut);
    canvasWrap.appendChild(zoomBox);

    // ── readouts ──
    var foot = el('div', 'flex:0 0 auto; border-top:1px solid #1f2937; padding:8px 12px; ' +
                         'display:flex; flex-wrap:wrap; gap:4px 18px; align-items:baseline;');
    var mono = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px;';
    var posTxt = el('span', mono);
    var quadTxt = el('span', mono + ' color:' + ACCENT + '; word-break:break-all;');
    var mocTxt = el('span', mono + ' color:#94a3b8;');
    var sizeTxt = el('span', 'font-size:11.5px; color:#94a3b8;');
    var legTxt = el('span', 'font-size:11.5px; color:#94a3b8; flex-basis:100%;');
    var cardTxt = el('span', 'font-size:11.5px; color:' + CARD_ACCENT + '; flex-basis:100%;');
    var provTxt = el('span', 'font-size:11.5px; flex-basis:100%;');
    [posTxt, quadTxt, mocTxt, sizeTxt, legTxt, cardTxt, provTxt].forEach(function (n) { foot.appendChild(n); });
    host.appendChild(foot);

    if (!host.parentNode) document.body.appendChild(host);

    els = {
      host: host, canvasWrap: canvasWrap, frameTag: frameTag, orderTxt: orderTxt,
      posTxt: posTxt, quadTxt: quadTxt, mocTxt: mocTxt, sizeTxt: sizeTxt, legTxt: legTxt,
      cardTxt: cardTxt,
      provTxt: provTxt, attrib: attrib,
      minus: minus, plus: plus, close: close, zIn: zIn, zOut: zOut
    };

    zIn.onclick = function (ev) {
      ev.stopPropagation();
      if (!renderer) return;
      renderer.setCenter(mark.ra, mark.dec);      // zoom toward the selected cell
      renderer.setFovDeg(renderer.getFovDeg() / 2);
    };
    zOut.onclick = function (ev) {
      ev.stopPropagation();
      if (renderer) renderer.setFovDeg(renderer.getFovDeg() * 2);
    };

    minus.onclick = function () { orderIsManual = true; order = Math.max(MIN_ORDER, order - 1); draw(); };
    plus.onclick = function () { orderIsManual = true; order = Math.min(MAX_ORDER, order + 1); draw(); };
    close.onclick = function () { closeView(); };
  }

  /*
    Push a sky direction into the app as its coordinate. Dec -> lat, RA -> lon:
    the same numbers the HEALPix construction already uses.

    MUST go through CardRenderer.setCoordinate, NOT AppState.set.

    index.html declares `let currentCardCoord` at the top level of a classic
    script. A top-level `let` creates a binding in the global LEXICAL
    environment, which is not a property of window -- so main.js's
    AppState.subscribe('coordinate') bridge, which does
    `global.currentCardCoord = ...`, writes a DIFFERENT variable that the inline
    script never reads. renderCards() then re-renders from the stale value and
    nothing visibly changes. (This is why the first version of this handler
    appeared correct and did nothing.)

    CardRenderer.setCoordinate fires callbacks.onCoordChange, and the inline
    script's handler assigns the lexical currentCardCoord directly, then updates
    the display, the pin and the cards. That is the path a real map click takes,
    so it is the path a sky click should take too.

    Verified: onCoordChange does not call renderCards, so there is no recursion
    with renderCards -> CardRenderer.setCoordinate -> onCoordChange.
  */
  var _coordUnsub = null;
  var _pushing = false;

  /*
    FOLLOW THE APP'S COORDINATE.

    pushCoordinate below sends sky -> app. Nothing sent app -> sky, so a GPS fix
    or a retyped card code moved the pin and the cards and left the sphere
    sitting exactly where it was.

    Recentres only when the new position falls OUTSIDE the current field. Moving
    the mark always is right -- it is the same cell the cards describe -- but
    yanking the view on every tracking tick would make the sky unusable while
    walking. Following when it needs to is what the Earth map does.

    _pushing guards the echo: a sky click calls pushCoordinate, which sets
    AppState, which fires this. Without the flag every click would re-enter and
    redraw twice.
  */
  function onExternalCoordinate(c) {
    if (_pushing || !host || !renderer || !c) return;
    if (typeof c.lat !== 'number' || typeof c.lon !== 'number') return;
    if (!isFinite(c.lat) || !isFinite(c.lon)) return;

    var ra = ((c.lon % 360) + 360) % 360;
    if (Math.abs(c.lat - mark.dec) < 1e-12 &&
        Math.abs(ra - mark.ra) < 1e-12) return;          // already there

    mark = { ra: ra, dec: c.lat };

    var centre = renderer.getCenter();
    var half = renderer.getFovDeg() / 2;
    var sep = 180;
    try {
      var S = _Sky();
      if (S && S.separationDeg) sep = S.separationDeg(centre[0], centre[1], ra, c.lat);
    } catch (e) {}
    if (sep > half * 0.8) renderer.setCenter(ra, c.lat);

    draw();
  }

  function watchCoordinate() {
    if (_coordUnsub) return;
    try {
      if (global.AppState && global.AppState.subscribe) {
        _coordUnsub = global.AppState.subscribe('coordinate', onExternalCoordinate);
      }
    } catch (e) { _coordUnsub = null; }
  }

  function unwatchCoordinate() {
    if (!_coordUnsub) return;
    try { if (typeof _coordUnsub === 'function') _coordUnsub(); } catch (e) {}
    _coordUnsub = null;
  }

  function pushCoordinate(decDeg, raDeg) {
    var lon = raDeg > 180 ? raDeg - 360 : raDeg;
    var pushed = false;
    _pushing = true;                     // suppress the echo through AppState
    try {
      if (global.CardRenderer && global.CardRenderer.setCoordinate) {
        global.CardRenderer.setCoordinate(decDeg, lon);
        pushed = true;
      }
    } catch (e) {}
    // Keep AppState coherent for anything that reads it directly (the sky panel
    // does). Harmless if CardRenderer already ran; the bridge is idempotent.
    try {
      if (global.AppState && global.AppState.set) {
        global.AppState.set('coordinate', { lat: decDeg, lon: lon });
        pushed = true;
      }
    } catch (e) {}
    _pushing = false;
    return pushed;
  }

  /*
    Declare which sphere we are on, so other modules can stop volunteering
    Earth-specific information. geosonify-bip39-entry.js reads this to suppress
    its region hints and — more importantly — to avoid sending a celestial
    position to Nominatim.

    AppState is the right home for this: the URL parser already writes the same
    shape from ?frame=, so a URL-set frame and a UI-set frame are read
    identically by everything downstream.
  */
  function setFrame(key, sphere) {
    try {
      if (global.AppState && global.AppState.set) {
        global.AppState.set('frame', {
          key: key, sphere: sphere, epoch: sphere === 'sky' ? 'J2000' : null, explicit: false
        });
      }
    } catch (e) {}
  }

  /*
    Shapes.

    Everything here is angular, because on a sphere everything IS. A shape is
    stored as its PARAMETERS, not as a baked vertex list, so it can be re-drawn
    at any zoom without resampling error and so it can later be written to a URL
    as a handful of numbers rather than a polygon.

    Rendering goes through the same overlay projector the cells use, which means
    a shape is clipped at the limb, split at a projection wrap, and never closed
    across a chord — for free, and identically whichever renderer is live.
  */
  function addShape(spec) {
    if (!_Shapes()) return null;
    spec.id = spec.id || ('s' + (shapes.length + 1));
    shapes.push(spec);
    draw();
    return spec.id;
  }

  function clearShapes() { shapes = []; draw(); }

  function shapeRing(spec) {
    var S = _Shapes();
    switch (spec.type) {
      case 'circle':    return S.circle(spec.ra, spec.dec, spec.radiusArcsec, spec);
      case 'ellipse':   return S.ellipse(spec.ra, spec.dec, spec.aArcsec, spec.bArcsec, spec.paDeg, spec);
      case 'rectangle': return S.rectangle(spec.ra, spec.dec, spec.widthArcsec, spec.heightArcsec, spec.paDeg, spec);
      case 'polygon':   return S.polygon(spec.vertices, spec);
      case 'path':      return S.path(spec.vertices);
      case 'point':     return [[spec.dec, spec.ra]];
      default:          return null;
    }
  }

  function drawShapes(g) {
    var Overlay = _Overlay();
    if (!shapes.length || !Overlay) return;
    var vp = renderer.getSize();
    shapes.forEach(function (spec) {
      var ring = shapeRing(spec);
      if (!ring || ring.length < 2) return;
      var pr = Overlay.projectRing(ring, renderer.project, { viewport: vp });
      if (!pr.visible) return;
      var d = Overlay.ringToPath(pr, { close: spec.type !== 'path' });
      if (!d) return;
      var p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', spec.fill || 'none');
      p.setAttribute('stroke', spec.stroke || '#60a5fa');
      p.setAttribute('stroke-width', spec.strokeWidth || 1.4);
      p.setAttribute('stroke-linejoin', 'round');
      p.setAttribute('stroke-linecap', 'round');
      if (spec.dash) p.setAttribute('stroke-dasharray', spec.dash);
      g.appendChild(p);
    });
  }

  function boundaryOf(cell) {
    return _Sky().cellBoundary(cell.order, cell.ipix, { step: 6, close: true, frame: 'sky' });
  }

  function _Cards() { return global.GeosonifySkyCards || null; }

  /*
    The starred card's own cell.

    Star a card on the Earth map and MapManager.updateHierarchicalGrid() draws
    THAT card's grid. In sky mode nothing happened, because draw() below is
    unconditional HEALPix and never reads cardState.active.

    Additive rather than replacing: the HEALPix ancestry stays, because the whole
    footer readout -- order, MOC, cell size, provenance, the overclaim warning --
    is computed from it, and drawing one thing while reporting another is exactly
    the kind of quiet disagreement this project keeps getting bitten by. So the
    graticule cell is drawn in its own colour, and labelled, on top of the
    HEALPix frame it is measured against.

    HEALPix cards need nothing here: their cell IS the drawing already. GIS cards
    return null from the module (no celestial meaning) and are hidden in sky mode
    anyway. Wrapped whole: a decoration must never cost the view.
  */
  function drawCardCell(g) {
    var Cards = _Cards(), Overlay = _Overlay();
    var clear = function () { if (els && els.cardTxt) els.cardTxt.textContent = ''; };

    // Every bail-out clears the label. Leaving the previous card's name and
    // size on screen while drawing a different card's cell is the same class of
    // quiet disagreement this whole feature exists to avoid.
    if (!Cards || !Overlay || _privacyOn()) { clear(); return false; }   // redacted like a GIS card

    var got;
    try { got = Cards.activeCardRings(mark.dec, mark.ra); } catch (e) { clear(); return false; }
    if (!got || !got.rings || !got.rings.length) { clear(); return false; }

    var vp = renderer.getSize();
    var drew = null;

    got.rings.forEach(function (entry, i) {
      var pr;
      try { pr = Overlay.projectRing(entry.ring, renderer.project, { viewport: vp }); }
      catch (e) { return; }
      if (!pr || !pr.visible) return;

      // Sub-pixel cells are a dot claiming a precision the screen cannot show;
      // pickVisible applies the same floor to the HEALPix chain.
      if (!entry.deepest && pr.maxPx < 5) return;

      var p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', Overlay.ringToPath(pr));
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', CARD_ACCENT);
      p.setAttribute('stroke-width', entry.deepest ? 1.6 : 0.9);
      p.setAttribute('stroke-opacity', entry.deepest ? 0.95 : Math.max(0.18, 0.55 - i * 0.1));
      p.setAttribute('stroke-linejoin', 'round');
      g.appendChild(p);
      if (entry.deepest) drew = entry;
    });

    if (els.cardTxt) {
      var label = '';
      if (drew) {
        label = got.card.name + ' \u00b7 ' + got.card.iterations;
        var size = null;
        try {
          if (global.GeosonifySkyUnits) {
            size = global.GeosonifySkyUnits.cellText(got.card.key, got.card.def,
                                                     got.card.iterations, { lat: mark.dec, lon: mark.ra });
          }
        } catch (e) {}
        if (size) label += '  \u2014  ' + size;
      }
      els.cardTxt.textContent = label;
    }
    // Whether a card grid was drawn. The HEALPix chain is skipped when it was,
    // so the sky shows exactly one grid, like the Earth map.
    return !!drew;
  }

  /*
    Frame the view on a set of vertices, rather than on the first of them.

    GeosonifySkyFigures.bounds() does this for NAMED figures, but its own comment
    admits the limitation: "figures here do not straddle RA 0, so a plain min/max
    is safe; a general implementation would need to unwrap first." Anything
    arriving from a URL or a GPX track is not covered by that assumption -- a
    path crossing RA 0 would take a plain min/max of 359 and 1 and centre on 180,
    the opposite side of the sky.

    So the centre is a circular mean of unit vectors, which has no seam, and the
    radius is the greatest haversine separation from it. Haversine, never arccos:
    the precision floor of arccos is coarser than a HEALPix cell above order 22.

    vertices: [[dec, ra], ...] -- the order toPaths() produces and addShape takes.
  */
  function frameOn(vertices, opts) {
    if (!vertices || vertices.length === 0) return false;
    opts = opts || {};

    var sx = 0, sy = 0, sz = 0, i;
    for (i = 0; i < vertices.length; i++) {
      var d = vertices[i][0] * D2R, r = vertices[i][1] * D2R;
      sx += Math.cos(d) * Math.cos(r);
      sy += Math.cos(d) * Math.sin(r);
      sz += Math.sin(d);
    }
    var norm = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (!norm) return false;
    sx /= norm; sy /= norm; sz /= norm;

    var decC = Math.asin(Math.max(-1, Math.min(1, sz))) / D2R;
    var raC = Math.atan2(sy, sx) / D2R;
    if (raC < 0) raC += 360;

    var radius = 0;
    for (i = 0; i < vertices.length; i++) {
      var dp = (vertices[i][0] - decC) * D2R, dl = (vertices[i][1] - raC) * D2R;
      var a = Math.sin(dp / 2) * Math.sin(dp / 2) +
              Math.cos(decC * D2R) * Math.cos(vertices[i][0] * D2R) * Math.sin(dl / 2) * Math.sin(dl / 2);
      var s = 2 * Math.asin(Math.min(1, Math.sqrt(a))) / D2R;
      if (s > radius) radius = s;
    }

    // A single point has no extent; leave the field alone rather than zooming to
    // the floor. Otherwise pad so the outermost vertex is not on the very edge.
    var fov = radius > 0 ? radius * 2 * (opts.pad || 1.6) : null;

    mark.dec = decC; mark.ra = raC;
    if (renderer) {
      renderer.setCenter(raC, decC);
      if (fov) renderer.setFovDeg(Math.max(1e-9, Math.min(180, fov)));
    }
    draw();
    return true;
  }

  function draw() {
    if (!renderer || !els) return;
    var Sky = _Sky(), Overlay = _Overlay(), HP = _HP();
    var g = renderer.overlayGroup();
    while (g.firstChild) g.removeChild(g.firstChild);

    var redact = _privacyOn();

    // Dec -> lat, RA -> lon: the same HEALPix construction, celestial frame.
    var ipix = BigInt(HP.nestIndex(mark.dec, mark.ra, order));
    var cell = Sky.ipixToCell(order, ipix);
    var moc = Sky.toMoc(cell);
    /*
      Ancestry depth. Seven levels by default (order-6 .. order), pruned further
      by pickVisible's 5px floor -- the celestial twin of the Earth map's faded
      parent cells, so the two frames show the same hierarchy the same way.

      Exposed because the canvas got busier: the deepest cell in ACCENT, up to
      six parents in RAMP, the starred card's cell in green, carried shapes in
      pink and the mark cross in red. Someone who wants just the cell and its
      parent can now say so, without the default changing under anyone.
    */
    var chain = Sky.ancestry(order, ipix, { fromOrder: Math.max(0, order - ancestryLevels) });

    /*
      ONE GRID AT A TIME — WHICHEVER CARD IS ACTIVE.

      The Earth map draws only the active card's grid. Sky was drawing the
      HEALPix cell AS WELL AS the card's, so a BIP39 box sat inside a HEALPix
      diamond inside six faded parents, and flipping between the two frames
      compared a cluttered picture with a clean one -- which defeats the whole
      point of flipping, which is to feel the scale.

      So the card cell is drawn FIRST, and it reports whether it drew. If it did,
      the HEALPix chain is suppressed and the two views show the same single
      cell, at the same size, in both frames.

      The footer still reports the HEALPix order, MOC and cell size, because that
      is the sky view's own address and the readout is labelled. What must never
      happen is two grids drawn at once with nothing saying which is which.
    */
    var drewCard = drawCardCell(g);

    /*
      pickVisible runs either way: the legibility readout below reports whether
      the CELL is resolvable at this zoom, which is true of the sky view's own
      address regardless of which grid is drawn. Only the drawing is conditional.
    */
    var picked = Overlay.pickVisible(chain, boundaryOf, renderer.project,
                                     { viewport: renderer.getSize(), minPx: 5 });

    if (!drewCard) {
      picked.draw.forEach(function (entry, i) {
        var deepest = entry === picked.deepest;
        var p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', Overlay.ringToPath(entry.projected));
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', deepest ? ACCENT : RAMP[Math.min(RAMP.length - 1, i)]);
        p.setAttribute('stroke-width', deepest ? 1.8 : 1.1);
        p.setAttribute('stroke-linejoin', 'round');
        g.appendChild(p);
      });
    }

    drawShapes(g);

    var mp = renderer.project(mark.ra, mark.dec);
    if (mp) {
      ['M' + (mp[0] - 7) + ' ' + mp[1] + 'H' + (mp[0] + 7),
       'M' + mp[0] + ' ' + (mp[1] - 7) + 'V' + (mp[1] + 7)].forEach(function (d) {
        var l = document.createElementNS(SVGNS, 'path');
        l.setAttribute('d', d);
        l.setAttribute('stroke', ACCENT);
        l.setAttribute('stroke-width', '1');
        g.appendChild(l);
      });
    }

    var dp = Sky.autoDecimals(order, mark.dec);
    els.orderTxt.textContent = 'order ' + order;
    els.sizeTxt.textContent = Sky.cellSize(order).text + ' cell';
    els.frameTag.textContent = 'ICRS \u00b7 shown on a Geosonify canvas';

    if (redact) {
      els.posTxt.textContent = REDACT;
      els.quadTxt.textContent = REDACT;
      els.mocTxt.textContent = 'Hidden while privacy mode is active';
      els.legTxt.textContent = '';
      return;
    }

    els.posTxt.textContent = Sky.formatRA(mark.ra, { decimals: dp.ra }) + '  ' +
                             Sky.formatDec(mark.dec, { decimals: dp.dec, unicode: true });
    els.quadTxt.textContent = cell.quaternary;
    els.mocTxt.textContent = moc.moc + (moc.standard ? '' : '  \u2190 past order 29');
    els.legTxt.textContent = Overlay.legibility(picked, order, {
      maxResolvableOrder: renderer.capabilities().maxResolvableOrder
    });

    if (!provenance) {
      els.provTxt.textContent = 'Click the sky to place a cell';
      els.provTxt.style.color = '#94a3b8';
    } else {
      var over = Sky.overclaims(order, provenance);
      if (over) {
        els.provTxt.textContent = over.text;
        els.provTxt.style.color = '#fbbf24';        // amber: over-claiming
      } else {
        els.provTxt.textContent = 'Click accurate to ' + provenance.text +
          ' at this zoom \u2014 order ' + provenance.order + ' is what it justifies' +
          (order < provenance.order ? ', showing coarser' : '');
        els.provTxt.style.color = '#94a3b8';
      }
    }
  }

  var opts = {};
  /*
    RENDERER SELECTION — built-in first, Aladin as an upgrade.

    Deliberately NOT "try Aladin, fall back if it fails". Aladin is 2.3 MB over
    the network with an async WASM init, so that ordering means a blank panel
    for however long the download takes, and a blank panel forever if the user
    is offline. Instead the built-in renderer draws immediately — it needs
    nothing and always works — and Aladin swaps in behind it if and when it
    arrives.

    So the failure mode of "no network / no WebGL2 / CDN down / import blocked"
    is not a broken sky view. It is a working sky view without imagery, which is
    what the built-in renderer was for.

    On a successful swap the centre, field of view, marked cell and shapes all
    carry over, and the attribution line appears — CDS's work is credited the
    moment it is on screen, not before.
  */
  function attachRenderer(r) {
    r.on('move', draw);
    r.on('zoom', function () {
      if (provenance) {
        var Sky2 = _Sky();
        var sz = r.getSize();
        provenance = Sky2.clickProvenance(r.getFovDeg(), Math.min(sz.width, sz.height),
                                          opts.pointerPixels || 1);
        if (!orderIsManual) order = Math.max(MIN_ORDER, Math.min(MAX_ORDER, provenance.order));
      }
      draw();
    });
    r.on('resize', draw);
    r.on('click', function (p) {
      mark.ra = p.ra; mark.dec = p.dec;
      var Sky = _Sky();
      var s = r.getSize();
      provenance = Sky.clickProvenance(r.getFovDeg(), Math.min(s.width, s.height),
                                       opts.pointerPixels || 1);
      if (!orderIsManual) order = Math.max(MIN_ORDER, Math.min(MAX_ORDER, provenance.order));
      draw();
      pushCoordinate(p.dec, p.ra);
    });
  }

  function tryAladin() {
    var Al = _Aladin();
    if (!Al || !Al.isAvailable()) return Promise.resolve(false);
    var centre = renderer ? renderer.getCenter() : [mark.ra, mark.dec];
    var fov = renderer ? renderer.getFovDeg() : 1.5;
    var candidate = Al.createAladinRenderer(els.canvasWrap, {
      ra: centre[0], dec: centre[1], fovDeg: fov,
      background: '#0b0f19', src: opts.aladinSrc
    });
    return candidate.init().then(function () {
      if (!host) { candidate.destroy(); return false; }   // view closed while loading

      /*
        RE-READ THE VIEW AT SWAP TIME, NOT AT REQUEST TIME.

        `centre` and `fov` above were captured BEFORE candidate.init(), which
        downloads 2.3 MB of Aladin and can take seconds. Anything that changed
        the view in the meantime was then thrown away when the swap applied the
        stale values.

        That is exactly what broke the Earth/Sky zoom carry. The sequence was:

          openView -> tryAladin captures fov = 1.5 (the default)
          openView -> zoom carry sets the built-in to 0.000607 deg
          ...seconds pass...
          Aladin resolves -> swap applies the captured 1.5 deg

        The console showed it plainly: earth->sky reported fovReadBack 0.000607,
        and the following sky->earth reported skyVertSpanDeg 1.4969574 -- the
        default, restored behind the carry's back. The map then returned at zoom
        8 and every later flip compounded from there.

        The same staleness would also discard a user's own zoom or pan performed
        while the imagery downloaded, which is a long enough window to matter.
      */
      var liveCentre = renderer ? renderer.getCenter() : centre;
      var liveFov = renderer ? renderer.getFovDeg() : fov;

      if (renderer) { try { renderer.destroy(); } catch (e) {} }
      renderer = candidate;
      rendererKind = 'aladin';
      attachRenderer(renderer);
      renderer.setCenter(liveCentre[0], liveCentre[1]);
      renderer.setFovDeg(liveFov);

      /*
        Re-match against Aladin by MEASUREMENT.

        Handing the field across is a request, and Aladin applies its own clamps
        and its own idea of which axis a field names -- the console showed a
        7.4x jump appearing only on flips where Aladin had loaded. Measuring the
        cell after the swap makes the outcome independent of all of that: if
        Aladin lands somewhere else, the loop corrects it; if Aladin refuses to
        move, the log says so rather than the scale silently drifting.
      */
      if (global.GeosonifySkyZoom && global.__geosonifyMap &&
          global.GeosonifySkyZoom.matchCellEarthToSky) {
        try {
          global.GeosonifySkyZoom.matchCellEarthToSky(
            global.__geosonifyMap, renderer, mark.dec, mark.ra, order);
        } catch (e) {}
      }
      showAttribution();
      draw();
      return true;
    }).catch(function (err) {
      try { candidate.destroy(); } catch (e) {}
      console.warn('[geosonify] sky imagery unavailable, staying on the built-in renderer:',
                   err && err.message);
      return false;
    });
  }

  function showAttribution() {
    if (!els || !renderer) return;
    var a = renderer.attribution();
    if (!a) { els.attrib.textContent = ''; els.attrib.removeAttribute('href'); return; }
    els.attrib.textContent = a.text;
    if (a.href) { els.attrib.setAttribute('href', a.href); els.attrib.setAttribute('target', '_blank'); }
  }

  function openView(o) {
    opts = o || {};
    if (!isAvailable()) {
      if (global.showToast) global.showToast('Sky modules not loaded', 'error');
      return false;
    }
    if (host) return true;

    /*
      Register the sky-only cards on first open rather than at load. They are
      meaningless on Earth and the gate would only have to hide them; deferring
      also means a user who never finds sky mode never carries them.
      register() is idempotent and never clobbers an existing key.
    */
    if (global.GeosonifySkyCardDefs) {
      try { global.GeosonifySkyCardDefs.register(); } catch (e) {}
    }

    // Start from the current pin, read as a celestial direction.
    var c = (global.AppState && global.AppState.get) ? global.AppState.get('coordinate') : null;
    var lat = opts.dec !== undefined ? opts.dec : (c && c.lat !== null && c.lat !== undefined ? c.lat : 0);
    var lon = opts.ra !== undefined ? opts.ra : (c && c.lon !== null && c.lon !== undefined ? c.lon : 0);
    mark = { ra: ((lon % 360) + 360) % 360, dec: lat };
    if (opts.order) { order = Math.max(MIN_ORDER, Math.min(MAX_ORDER, opts.order)); orderIsManual = true; }

    build();

    renderer = _RendererLib().createBuiltInRenderer(els.canvasWrap, {
      ra: mark.ra, dec: mark.dec, fovDeg: opts.fovDeg || 1.5, background: '#0b0f19'
    });
    renderer.init();
    rendererKind = 'builtin';
    attachRenderer(renderer);
    showAttribution();

    // Upgrade to sky imagery if we can. Never blocks; never breaks the view.
    if (opts.renderer !== 'builtin') {
      tryAladin().then(function (ok) {
        if (ok && global.showToast) global.showToast('Sky imagery loaded');
      });
    }

    document.addEventListener('keydown', onKey);
    gateEarthOnlyCards(true);
    setFrame('icrs', 'sky');

    // The sky panel is already the honest RA/Dec + MOC readout, so reuse it
    // rather than growing a second one. Canvas above, numbers below.
    try {
      if (global.GeosonifySkyPanel && global.GeosonifySkyPanel.setOpen) {
        if (!global.GeosonifySkyPanel.isEnabled()) global.GeosonifySkyPanel.enable();
        global.GeosonifySkyPanel.setOpen(true);
      }
    } catch (e) {}

    draw();

    /*
      Whatever is drawn on the Earth map comes with you. A shape is a list of
      lat/lon vertices and the sky reads latitude as declination, so nothing is
      converted -- the Berlin Wall, written on the stars.

      After the first draw() deliberately: a working view is already on screen,
      so a failure here costs a decoration rather than the view. lastSolution is
      a LEXICAL binding in index.html's inline script, not a global, so the app
      publishes it as __geosonifyLastSolution rather than this module reaching
      for something that is not there. Absent means nothing to carry, which is
      the common case.
    */
    if (global.GeosonifySkyCarry && global.__geosonifyLastSolution) {
      try { global.GeosonifySkyCarry.carryToSky(global.__geosonifyLastSolution); } catch (e) {}
    }

    /*
      Carry the map's zoom across, so the sky opens showing the same amount of
      sky the map was showing of ground. Matched on the VERTICAL, where
      declination is latitude with no scaling at all -- see geosonify-sky-zoom.js
      for why the horizontal cannot be made to agree.

      After the first draw() so a working view exists first; a failure here costs
      the scale continuity, not the view. An explicit opts.fovDeg wins, since a
      caller that named a field meant it.
    */
    if (!opts.order && global.GeosonifySkyZoom && global.GeosonifySkyZoom.orderForActiveCard) {
      /*
        ADOPT THE ACTIVE CARD'S ORDER BEFORE DRAWING.

        The sky view's `order` defaulted to its own value (16) while the Earth
        map draws the active card's cell at the card's depth. Opening
        ?hphex=956250B00834 -- order 22 -- meant a 1.56 m cell on the map beside a
        99.6 m cell in the sky, 64x apart, which is the five or six manual zoom
        stops it took to reconcile them.

        Set here rather than after, because drawing one cell and then measuring
        another is the mistake that produced a log full of near-zero errors while
        the screen plainly disagreed.
      */
      try {
        var wantOrder = global.GeosonifySkyZoom.orderForActiveCard(order);
        if (wantOrder > 0 && wantOrder !== order) {
          order = Math.max(MIN_ORDER, Math.min(MAX_ORDER, wantOrder));
        }
      } catch (e) {}
    }

    if (!opts.fovDeg && global.GeosonifySkyZoom && global.__geosonifyMap) {
      try {
        if (global.GeosonifySkyZoom.matchCellEarthToSky(
              global.__geosonifyMap, renderer, mark.dec, mark.ra, order) !== null) {
          draw();
        }
      } catch (e) {}
    }

    watchCoordinate();      // GPS fixes and card-code edits move the sphere too
    return true;
  }

  function onKey(ev) { if (ev.key === 'Escape') closeView(); }

  function closeView() {
    document.removeEventListener('keydown', onKey);
    /*
      And the reverse: draw Orion, hit Earth, and Orion is laid across the globe.

      Read the shapes BEFORE the teardown below clears them. Longitude folds
      back to +/-180 inside the carry module, because Leaflet wraps oddly past
      180 and would draw a line across the whole map.
    */
    if (global.GeosonifySkyCarry && global.__geosonifyMap) {
      try { global.GeosonifySkyCarry.carryToEarth(global.__geosonifyMap); } catch (e) {}
    }
    /*
      And zoom back the other way: whatever field you zoomed the sky to, the map
      opens showing the same latitude span. Read BEFORE the teardown below
      destroys the renderer.
    */
    if (global.GeosonifySkyZoom && global.__geosonifyMap && renderer) {
      try {
        global.GeosonifySkyZoom.matchCellSkyToEarth(
          renderer, global.__geosonifyMap, mark.dec, mark.ra, order);
      } catch (e) {}
    }
    unwatchCoordinate();
    unwatchMapSize();          // else the observer outlives the view it feeds
    gateEarthOnlyCards(false);
    setFrame('earth', 'earth');
    if (renderer) { try { renderer.destroy(); } catch (e) {} renderer = null; }
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null; els = null; mapEl = null;
    provenance = null; orderIsManual = false; shapes = [];
    rendererKind = 'builtin';
    return true;
  }

  function isOpen() { return !!host; }

  var API = {
    VERSION: VERSION,
    isAvailable: isAvailable,
    open: openView,
    close: closeView,
    isOpen: isOpen,
    redraw: draw,
    setOrder: function (k) { order = Math.max(MIN_ORDER, Math.min(MAX_ORDER, k)); draw(); },
    pushCoordinate: pushCoordinate,
    /* Move the marked cell to a sky position, recentre on it, and tell the app
       — so the cards follow a "go to Vega" the same way they follow a click. */
    goTo: function (raDeg, decDeg, opts) {
      if (!renderer) return false;
      opts = opts || {};
      mark = { ra: ((raDeg % 360) + 360) % 360, dec: decDeg };
      renderer.setCenter(mark.ra, mark.dec);
      if (opts.fovDeg) renderer.setFovDeg(opts.fovDeg);
      pushCoordinate(mark.dec, mark.ra);
      draw();
      return true;
    },
    getOrder: function () { return order; },
    getAncestryLevels: function () { return ancestryLevels; },
    setAncestryLevels: function (n) {
      ancestryLevels = Math.max(0, Math.min(12, n | 0));
      draw();
      return ancestryLevels;
    },
    getProvenance: function () { return provenance; },
    addShape: addShape,
    frameOn: frameOn,
    clearShapes: clearShapes,
    getShapes: function () { return shapes.slice(); },
    shapeRing: shapeRing,
    /* Draw a named figure and frame it. The figures are stick diagrams, not
       catalogue data — see geosonify-sky-figures.js for the caveat. */
    showFigure: function (name, opts) {
      var F = global.GeosonifySkyFigures;
      if (!F || !F.FIGURES[name]) return false;
      var fig = F.FIGURES[name];
      opts = opts || {};
      F.toPaths(name).forEach(function (seg) {
        addShape({ type: 'path', vertices: seg, stroke: opts.stroke || '#93c5fd', strokeWidth: 1.6 });
      });
      if (opts.frame !== false && renderer) {
        var b = F.bounds(name);
        renderer.setCenter(b.raCentre, b.decCentre);
        renderer.setFovDeg(Math.max(b.spanDeg * 1.4, 0.5));
      }
      draw();
      return true;
    },
    isOrderManual: function () { return orderIsManual; },
    getRendererKind: function () { return rendererKind; },
    getFovDeg: function () { return renderer ? renderer.getFovDeg() : null; },
    getCentre: function () { return renderer ? renderer.getCenter() : [mark.ra, mark.dec]; },
    useAladin: function () { return tryAladin(); },
    useBuiltIn: function () {
      if (rendererKind === 'builtin') return false;
      var centre = renderer.getCenter(), fov = renderer.getFovDeg();
      try { renderer.destroy(); } catch (e) {}
      renderer = _RendererLib().createBuiltInRenderer(els.canvasWrap, {
        ra: centre[0], dec: centre[1], fovDeg: fov, background: '#0b0f19'
      });
      renderer.init();
      rendererKind = 'builtin';
      attachRenderer(renderer);
      showAttribution();
      draw();
      return true;
    }
  };

  global.GeosonifySkyView = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
