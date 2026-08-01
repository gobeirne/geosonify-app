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
  function gateEarthOnlyCards(on) {
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
  function pushCoordinate(decDeg, raDeg) {
    var lon = raDeg > 180 ? raDeg - 360 : raDeg;
    var pushed = false;
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
    if (!Cards || !Overlay || _privacyOn()) { clear(); return; }   // redacted like a GIS card

    var got;
    try { got = Cards.activeCardRings(mark.dec, mark.ra); } catch (e) { clear(); return; }
    if (!got || !got.rings || !got.rings.length) { clear(); return; }

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
    var chain = Sky.ancestry(order, ipix, { fromOrder: Math.max(0, order - 6) });

    var picked = Overlay.pickVisible(chain, boundaryOf, renderer.project,
                                     { viewport: renderer.getSize(), minPx: 5 });

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

    drawCardCell(g);

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
      if (renderer) { try { renderer.destroy(); } catch (e) {} }
      renderer = candidate;
      rendererKind = 'aladin';
      attachRenderer(renderer);
      renderer.setCenter(centre[0], centre[1]);
      renderer.setFovDeg(fov);
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
    return true;
  }

  function onKey(ev) { if (ev.key === 'Escape') closeView(); }

  function closeView() {
    document.removeEventListener('keydown', onKey);
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
    getProvenance: function () { return provenance; },
    addShape: addShape,
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
