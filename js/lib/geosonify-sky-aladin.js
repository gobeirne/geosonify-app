/*
  geosonify-sky-aladin.js  v0.6  — Aladin Lite as a backend viewport

  Implements the SAME contract as the built-in renderer (geosonify-sky-renderer.js),
  so nothing above the seam knows or cares which one is live. Aladin supplies sky
  imagery and answers "where on screen is this (ra, dec)?". Geosonify keeps the
  layout, the chrome, the cards, the URL grammar, the encryption, the sonification
  and — importantly — draws its own cells into its own SVG layer on top.

  v0.3: two OPTIONAL methods beyond the contract, getRotationDeg() and
  setRotationDeg(deg), wrapping Aladin's own getRotation() / setRotation()
  (verified in the shipped 3.9.0-beta bundle; the older names
  getViewCenter2NorthPoleAngle / setViewCenter2NorthPoleAngle are aliases of
  the same functions). Aladin lets the person rotate the sky; these let
  geosonify-sky-flip.js turn it back to north-up before the way down to Earth.
  Callers must test for them (the built-in renderer cannot rotate and has
  neither) and must MEASURE the result rather than assume the sign convention.

  v0.6: THE BEST PICTURE WHEREVER THERE IS ONE, AND THE OTHERS ON REQUEST.
  DSS2 colour stays the base (whole sky, ~1 arcsec, with the mirrors below).
  Over it, bottom to top (IMAGERY_SOURCES, read top-down):

      Webb outreach            ESA/Webb press images          CDS/P/JWST/EPO
      Hubble outreach          NASA/ESA press images, 25 mas  CDS/P/HST/EPO
      ESO outreach             ESO press images               CDS/P/ESO/EPO
      Pan-STARRS1 DR1 colour   ~0.25 arcsec, dec > -29.5      CDS/P/PanSTARRS/DR1/color-z-zg-g

  setImagery('best') shows every source that has a picture in the field, in
  that order, once the field is narrower than IMAGERY_ON_FOV_DEG. setImagery(
  key) shows that one source alone over DSS2, at any field, so two sources can
  be compared at the same place. getImagery() reports, for each source, whether
  it has a picture HERE ('here', 'not-here', 'unknown', 'unavailable'), which
  is what the Map imagery card lists. 'imagery' is emitted when that changes.

  Facts read from the Aladin Lite source that decide how this is built:

    * A layer whose tiles are JPEG (no alpha) at opacity 1 is treated as
      covering the sky, and every layer BENEATH it is skipped (renderable/
      mod.rs, `full_covering_hips`). Pan-STARRS colour is JPEG-only, so outside
      its footprint it would paint black over DSS2: it is shown only when the
      whole field lies north of its floor. A sparse layer that turns out to
      serve JPEG is never shown, for the same reason.
    * Layers at opacity 0 still fetch tiles (app.rs, look_for_new_tiles loops
      over every HiPS), so a hidden layer is not free. The overlays are created
      only when first needed.
    * Stacking order is creation order (each layer's add waits on every earlier
      layer's query), so all four are created together, once, bottom to top;
      after that, showing and hiding is opacity only.
    * A HiPS constructor reads `opacity || 1`, so a layer cannot be created
      hidden: it is hidden immediately after.

  Which sparse sources have a picture in the field comes from the CDS
  MocServer (one cone query per settled view, reused while the view stays
  roughly put). These four sources and the MocServer all live in Strasbourg,
  which was down for days in late October 2026. So nothing is assumed: an
  unanswered coverage query leaves the sparse sources 'unknown', which Best
  does not show or credit, and a layer Aladin fails to load is 'unavailable'.
  In an outage the view is exactly the DSS2 (mirror) view it was before.

  The coverage query sends the field's centre and size to Strasbourg, which is
  also a place on Earth; opts.coverageAllowed() returning false (the sky view
  passes its privacy check) stops it, and the sparse sources stay 'unknown'.

  Not part of the renderer contract: setImagery / getImagery and the
  'imagery' event. The built-in renderer has none of them; callers test.

  WHY WE DO NOT USE aladin.addMOC()
  ---------------------------------
  Aladin's MOC renderer stops at order 29, because MOC does. We compute cell
  boundaries ourselves (verified against healpy.boundaries to 0.45 nanoarcsec),
  so that ceiling does not apply to what we can DRAW. An order-40 cell renders
  fine here and in no other astronomy tool. Handing geometry to Aladin would
  throw away the one thing this can do that nothing else can.

  FACTS VERIFIED BY READING THE SHIPPED BUNDLE (aladin-lite@3.9.0-beta), not recalled:

    * It is an ES MODULE — `export{f as default}`. A <script src> tag will NOT
      work. It must be loaded with dynamic import().
    * `A.init` is a PROMISE created at module load, and it THROWS if WebGL2 is
      unavailable. It must be awaited before A.aladin() is called.
    * `setFoV` has a capital V. `setFov` does not exist.
    * `getFov()` returns an ARRAY [fovX, fovY], not a scalar.
    * `pix2world(x, y, "icrs")` takes a lowercase frame string.
    * `world2pix(ra, dec)` takes two arguments.
    * backgroundColor defaults to "rgb(60,60,60)" — must be overridden or the
      viewport announces itself as a foreign panel.
    * Events: positionChanged {ra, dec, dragging}, zoomChanged, resizeChanged,
      click, plus fifteen others we do not use.
    * `setRotation(deg)` / `getRotation()` exist on the instance; setRotation
      ignores a non-number with a console warning.

  LICENSING
  ---------
  Aladin Lite is LGPL-3.0-or-later; Geosonify is MPL-2.0. They coexist only if
  aladin.js stays a SEPARATE, UNMODIFIED file loaded at runtime — never bundled,
  never patched. Dynamic import is exactly that arrangement. Its licence text
  must ship or be linked, and CDS must be credited visibly: attribution() below
  is not decorative, and the caller is expected to display it.

  OFFLINE
  -------
  The bundle inlines its WASM as a base64 data URI, so there is no second binary
  fetch — but HiPS tiles come from alasky.cds.unistra.fr. Sky imagery therefore
  requires network. When it is unavailable this adapter fails cleanly and the
  caller falls back to the built-in renderer, which needs nothing.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.6';
  var SVGNS = 'http://www.w3.org/2000/svg';

  var CDN_URL = 'https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js';
  /*
    MIRRORS, for when Strasbourg is down (it was, for days, after a security
    incident in late October 2026). Both lists are tried in order and the
    first that answers wins; with Strasbourg up, behaviour is exactly as
    before.

    The library: the same LGPL bundle CDS publishes to npm, served by jsDelivr,
    PINNED to the version this adapter was verified against (3.9.0-beta: see
    the module-shape note below), not a mutable "latest". Still a separate,
    unmodified file loaded at runtime, so the licensing arrangement holds.
    Since 1 Nov 2026 it is tried FIRST, ahead of the CDS "latest" build: on a
    phone the CDS request took the browser's full connection timeout to fail
    (a long blank wait), and a pinned copy is the better default anyway. A
    page's own src, when it gives one, still comes first.

    The imagery: the IVOA registry record for ivo://CDS/P/DSS2/color lists
    these mirrors. Each is probed with its HiPS "properties" file (a few
    hundred bytes); the first that answers is handed to Aladin as a URL. The
    primary answering means the survey ID is used unchanged, as before.
    UNVERIFIED from the sandbox this was written in: whether each mirror sends
    CORS headers, which WebGL tiles need. A mirror that does not is skipped by
    the probe, because the probe is itself a cross-origin fetch.
  */
  var LIB_FALLBACKS = ['https://cdn.jsdelivr.net/npm/aladin-lite@3.9.0-beta/dist/aladin.js'];
  var SURVEY_MIRRORS = {
    'P/DSS2/color': [
      'https://alasky.cds.unistra.fr/DSS/DSSColor',               // CDS, Strasbourg (primary)
      /*
        In the order they answered an iPhone and a desktop in NZ, 1 Nov 2026,
        all with tiles readable from geosonify.org (sky-check.html).
        Removed after the same check: IRSA (irsa.ipac.caltech.edu) sends no
        CORS header; IAS (healpix.ias.u-psud.fr) did not answer at all.
      */
      'https://casda.csiro.au/hips/DSS2/color',                   // CSIRO, Australia
      'https://cdn.skies.esac.esa.int/DSSColor',                  // ESA, ESAC
      // MAST (STScI, where DSS was made), on AWS open data; its registry
      // record says it is for use "through Aladin or Aladin-lite"
      'https://stpubdata.s3.us-east-1.amazonaws.com/mast/skybackgrounds/DSSColor'
    ]
  };
  var PROBE_MS = 4000, SURVEY_CACHE_MS = 30 * 60 * 1000;
  var LIB_TIMEOUT_MS = 10000;     // give up on one library copy, try the next
  var STICKY_MS = 6 * 3600 * 1000, STICKY_KEY = 'geosonify.hips.good.';
  var _surveyCache = {};          // id -> { use, ms }
  // The mirror that worked last time (on this device, for STICKY_MS) is
  // preferred over the list order, so a known-good copy is not kept waiting
  // behind a primary that is timing out.
  function stickyGet(id) {
    try {
      var v = JSON.parse(localStorage.getItem(STICKY_KEY + id) || 'null');
      return v && Date.now() - v.ms < STICKY_MS ? v.url : null;
    } catch (e) { return null; }
  }
  function stickySet(id, url) {
    try { localStorage.setItem(STICKY_KEY + id, JSON.stringify({ url: url, ms: Date.now() })); } catch (e) {}
  }

  function probe(url) {
    if (typeof fetch !== 'function') return Promise.resolve(false);
    var ctl = null, timer = null;
    try { ctl = new AbortController(); } catch (e) {}
    if (ctl) timer = setTimeout(function () { ctl.abort(); }, PROBE_MS);
    return fetch(url + '/properties', ctl ? { signal: ctl.signal } : undefined)
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (t) { if (timer) clearTimeout(timer); return /hips_/.test(String(t)); })
      .catch(function () { if (timer) clearTimeout(timer); return false; });
  }

  /*
    id -> what to hand Aladin: the id itself when the primary answers (or the
    survey has no mirrors listed), else the first mirror URL that answers.
    Never rejects. When nothing answers it returns the id, and Aladin fails
    exactly as it would have before.

    All mirrors are probed AT ONCE (one PROBE_MS wait at most, not one per
    mirror), and the earliest in the list that answered wins, so the order
    above is still the preference order.
  */
  function resolveSurvey(id) {
    var list = SURVEY_MIRRORS[id];
    if (!list) return Promise.resolve(id);
    var c = _surveyCache[id];
    if (c && Date.now() - c.ms < SURVEY_CACHE_MS) return Promise.resolve(c.use);
    return firstGood(id).then(function (k) {
      if (k < 0) return id;
      var use = k === 0 ? id : list[k];
      _surveyCache[id] = { use: use, ms: Date.now() };
      return use;
    });
  }

  // The index in SURVEY_MIRRORS[id] of the copy to use, or -1 if none answers.
  // One probe round per id at a time, shared by every caller (the sky view and
  // every thumbnail asking at once cost one set of requests).
  var _firstGood = {};
  function firstGood(id) {
    var list = SURVEY_MIRRORS[id];
    if (!list) return Promise.resolve(-1);
    var held = _firstGood[id];
    if (held && Date.now() - held.ms < SURVEY_CACHE_MS) return held.p;
    var probes = list.map(probe);
    var order = list.map(function (u, k) { return k; });
    var good = stickyGet(id), gk = list.indexOf(good);
    if (gk > 0) { order.splice(gk, 1); order.unshift(gk); }
    var i = 0;
    function next() {
      if (i >= order.length) return Promise.resolve(-1);
      var k = order[i++];
      return probes[k].then(function (ok) {
        if (!ok) return next();
        stickySet(id, list[k]);
        if (k > 0 && typeof console !== 'undefined')
          console.info('[geosonify] sky imagery from mirror ' + list[k]);
        return k;
      });
    }
    var p = next().then(function (k) { if (k < 0) delete _firstGood[id]; return k; });
    _firstGood[id] = { p: p, ms: Date.now() };
    return p;
  }

  /*
    The BASE URL of a working copy of survey id (the primary's included), for
    code that fetches tiles itself, such as the device-made thumbnails in
    geosonify-sky-cutout.js. null when no copy answers or id has no list.
  */
  function surveyBaseUrl(id) {
    var list = SURVEY_MIRRORS[id];
    if (!list) return Promise.resolve(null);
    return firstGood(id).then(function (k) { return k < 0 ? null : list[k]; });
  }

  // The last resolution for id, synchronously (the id itself if none yet).
  function surveyFor(id) {
    var c = _surveyCache[id];
    return c ? c.use : id;
  }

  // Every visible Aladin control, off. The reticle and coordinate readout go too:
  // those are precisely the elements a user would read as "this is Aladin".
  var CHROME_OFF = {
    showZoomControl: false,
    showLayersControl: false,
    expandLayersControl: false,
    showFullscreenControl: false,
    showSimbadPointerControl: false,
    showCooGridControl: false,
    showSettingsControl: false,
    showSelectionModeControl: false,
    showColorPickerControl: false,
    showShareControl: false,
    showProjectionControl: false,
    showContextMenu: false,
    showStatusBar: false,
    showReticle: false,
    showFrame: false,
    showFov: false,
    showCooLocation: false
  };

  var _modulePromise = null;

  function webgl2Available() {
    try {
      var c = document.createElement('canvas');
      return !!(c.getContext && c.getContext('webgl2'));
    } catch (e) { return false; }
  }

  /*
    Load the module once. `src` may be a self-hosted path (preferred: no
    third-party runtime dependency, and the file caches) or the CDN.

    Uses new Function('return import(u)') so that this file remains a CLASSIC
    script: a bare `import()` would make some bundlers and older parsers treat
    the whole file as a module.
  */
  /*
    Report what was actually seen, and allow a retry.

    'unexpected Aladin module shape' threw away the only evidence. The probe
    checks mod.default || mod.A || mod, which is correct for the bundle this was
    written against (verified: aladin-lite@3.9.0-beta exports `export{f as
    default}` with f.aladin a function). If it fails, the thing served at the URL
    is not that bundle -- and `latest` is a mutable pointer, so it can move
    without warning. The message now carries the namespace keys, the typeof of
    each candidate, and whether a global `A` appeared, which distinguishes a
    moved ESM build from a side-effecting classic script the probe cannot see.

    _modulePromise also used to cache the REJECTION for the life of the page, so
    one transient network failure permanently disabled useAladin(). Cleared on
    failure so a retry is possible.
  */
  function _shapeReport(mod) {
    var bits = [];
    try { bits.push('keys=[' + Object.keys(mod || {}).join(',') + ']'); } catch (e) { bits.push('keys=?'); }
    ['default', 'A'].forEach(function (k) {
      var v = null;
      try { v = mod ? mod[k] : undefined; } catch (e) {}
      bits.push(k + '=' + (typeof v) + (v && typeof v.aladin === 'function' ? '(has aladin)' : ''));
    });
    try {
      var g = (typeof window !== 'undefined') ? window : null;
      bits.push('window.A=' + (g ? typeof g.A : 'n/a'));
    } catch (e) {}
    return bits.join(' ');
  }

  function loadAladin(src) {
    if (_modulePromise) return _modulePromise;
    if (!webgl2Available()) {
      _modulePromise = Promise.reject(new Error('WebGL2 not available'));
      return _modulePromise;
    }
    var url = src || CDN_URL;
    /*
      A self-hosted src must be ABSOLUTE. The import() below runs in code made
      by new Function, which has no script URL of its own, so a relative path
      does not resolve against the page as a <script src> would (trap found in
      Starpin). Resolve it against the document first.
    */
    try {
      if (typeof document !== 'undefined' && document.baseURI) url = new URL(url, document.baseURI).href;
    } catch (e) {}
    // The page's own src if it gave one, then the pinned npm copy, then the
    // CDS "latest" build. Each gets LIB_TIMEOUT_MS: a dynamic import cannot
    // be cancelled, but it can be stopped from holding everything up.
    var tries = (src ? [url] : []).concat(LIB_FALLBACKS, [CDN_URL])
      .filter(function (u, i, a) { return a.indexOf(u) === i; });
    function importOne(k) {
      return new Function('u', 'return import(u);')(tries[k]);
    }
    function importFirst(k, lastErr) {
      if (k >= tries.length) return Promise.reject(lastErr || new Error('Aladin Lite could not be loaded'));
      var late = new Promise(function (res, rej) {
        setTimeout(function () { rej(new Error('timed out loading ' + tries[k])); }, LIB_TIMEOUT_MS);
      });
      return Promise.race([importOne(k), late])
        .then(function (mod) { url = tries[k]; return mod; },
              function (e) { return importFirst(k + 1, e); });
    }
    _modulePromise = importFirst(0, null)
      .then(function (mod) {
        // A side-effecting classic build assigns a global instead of exporting.
        var g = (typeof window !== 'undefined') ? window : null;
        var A = mod && (mod.default || mod.A || mod);
        if (!A || typeof A.aladin !== 'function') {
          if (g && g.A && typeof g.A.aladin === 'function') A = g.A;
        }
        if (!A || typeof A.aladin !== 'function') {
          throw new Error('unexpected Aladin module shape from ' + url + ' -- ' + _shapeReport(mod));
        }
        // A.init is a promise made at module load; it rejects without WebGL2.
        return Promise.resolve(A.init).then(function () { return A; });
      })
      .catch(function (err) {
        _modulePromise = null;          // do not cache the failure forever
        throw err;
      });
    return _modulePromise;
  }

  function isAvailable() { return webgl2Available(); }

  /*
    The imagery sources, top to bottom (see the header). `key` is what a link
    carries (?skyimg=); `sparse` sources are islands with transparent tiles
    around them; `decFloor` is a survey's southern limit. DSS2 is the base and
    is always present.
  */
  var IMAGERY_SOURCES = [
    { key: 'jwst', id: 'CDS/P/JWST/EPO', label: 'Webb', credit: 'ESA/Webb', sparse: true,
      about: 'James Webb Space Telescope press images (ESA/Webb), near-infrared and mid-infrared' },
    { key: 'hst',  id: 'CDS/P/HST/EPO',  label: 'Hubble', credit: 'NASA/ESA Hubble', sparse: true,
      about: 'Hubble Space Telescope press images (NASA/ESA), visible light' },
    { key: 'eso',  id: 'CDS/P/ESO/EPO',  label: 'ESO', credit: 'ESO', sparse: true,
      about: 'European Southern Observatory press images (VLT, VISTA, VST and others)' },
    { key: 'ps1',  id: 'CDS/P/PanSTARRS/DR1/color-z-zg-g', label: 'Pan-STARRS1', credit: 'Pan-STARRS1',
      sparse: false, decFloor: -29.5,
      about: 'Pan-STARRS1 survey colour (University of Hawai\u02bbi), the sky north of declination \u221230\u00b0' },
    { key: 'dss',  id: 'P/DSS2/color', label: 'DSS2', credit: 'DSS2', base: true,
      about: 'Digitized Sky Survey 2 colour (STScI), the whole sky from photographic plates' }
  ];
  var IMAGERY_MODES = ['best'].concat(IMAGERY_SOURCES.map(function (s) { return s.key; }));
  function imageryMode(v) {
    var k = String(v == null ? '' : v).trim().toLowerCase();
    return IMAGERY_MODES.indexOf(k) >= 0 ? k : null;
  }
  function imagerySource(key) {
    for (var i = 0; i < IMAGERY_SOURCES.length; i++) if (IMAGERY_SOURCES[i].key === key) return IMAGERY_SOURCES[i];
    return null;
  }
  // Best engages below the first field (smaller side, degrees) and releases
  // above the second: hysteresis, so a field near the line does not flicker.
  var IMAGERY_ON_FOV_DEG = 3, IMAGERY_OFF_FOV_DEG = 4;
  // Coverage is asked about fields up to this size (no tiles: one small query).
  var COVERAGE_MAX_FOV_DEG = 30;
  var IMAGERY_SETTLE_MS = 350;
  var MOCSERVER_URLS = ['https://alasky.unistra.fr/MocServer/query',
                        'https://alaskybis.unistra.fr/MocServer/query'];
  var MOCSERVER_TIMEOUT_MS = 6000;

  /*
    Create an Aladin-backed renderer.

    Asynchronous, unlike the built-in one, because the module must load first.
    init() returns a Promise; the caller should await it and fall back to the
    built-in renderer if it rejects.
  */
  function createAladinRenderer(container, opts) {
    opts = opts || {};
    var aladin = null, A = null;
    var svg = null, gOverlay = null, inner = null;
    var listeners = { move: [], zoom: [], resize: [], click: [], imagery: [] };
    var ro = null, destroyed = false;

    var pendingRa = opts.ra === undefined ? 0 : opts.ra;
    var pendingDec = opts.dec === undefined ? 0 : opts.dec;
    var pendingFov = opts.fovDeg === undefined ? 60 : opts.fovDeg;

    function emit(evt, payload) {
      listeners[evt].slice().forEach(function (cb) {
        try { cb(payload); } catch (e) { /* a bad listener must not break a redraw */ }
      });
    }

    function size() {
      if (!inner) return { width: 0, height: 0 };
      var r = inner.getBoundingClientRect();
      return { width: Math.round(r.width) || inner.clientWidth || 0,
               height: Math.round(r.height) || inner.clientHeight || 0 };
    }

    function syncOverlaySize() {
      if (!svg) return;
      var s = size();
      svg.setAttribute('width', s.width);
      svg.setAttribute('height', s.height);
      svg.setAttribute('viewBox', '0 0 ' + s.width + ' ' + s.height);
    }

    function init() {
      // Aladin wants a plain div of its own; the overlay goes over it, not in it.
      inner = document.createElement('div');
      inner.className = 'gs-aladin-host';
      inner.setAttribute('style', 'position:absolute; inset:0;');
      container.appendChild(inner);

      svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('class', 'gs-sky-svg');
      // pointer-events:none so drags and clicks reach Aladin underneath; our
      // cells are decoration over its canvas, not an interaction layer.
      svg.setAttribute('style',
        'position:absolute; inset:0; pointer-events:none; z-index:2; display:block;');
      gOverlay = document.createElementNS(SVGNS, 'g');
      gOverlay.setAttribute('class', 'gs-sky-overlay');
      svg.appendChild(gOverlay);
      container.appendChild(svg);

      var wantSurvey = opts.survey || 'P/DSS2/color';
      return Promise.all([loadAladin(opts.src), resolveSurvey(wantSurvey)]).then(function (got) {
        var mod = got[0];
        if (destroyed) return false;
        A = mod;
        var options = {};
        for (var k in CHROME_OFF) options[k] = CHROME_OFF[k];
        options.target = pendingRa + ' ' + pendingDec;
        options.fov = pendingFov;
        options.cooFrame = opts.cooFrame || 'ICRS';
        options.backgroundColor = opts.background || '#0b0f19';
        options.survey = got[1];                 // the id, or a mirror's URL
        if (opts.aladinOptions) {
          for (var j in opts.aladinOptions) options[j] = opts.aladinOptions[j];
        }

        aladin = A.aladin(inner, options);

        /*
          A DRAG IS NOT A CLICK. Aladin raises 'click' on pointer-up even after
          a pan, so the end of every drag moved the pin there. A click counts
          only if the pointer stayed within DRAG_PX of where it went down and
          Aladin did not report a drag in between. Capture phase, so Aladin's
          own handlers cannot stop us seeing the pointer.
        */
        var DRAG_PX = 6, downAt = null, dragged = false;
        inner.addEventListener('pointerdown', function (ev) {
          downAt = [ev.clientX, ev.clientY]; dragged = false;
        }, true);
        inner.addEventListener('pointermove', function (ev) {
          if (downAt && !dragged &&
              Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > DRAG_PX) dragged = true;
        }, true);
        aladin.on('positionChanged', function (p) {
          if (p && p.dragging && downAt) dragged = true;
          emit('move', { ra: p && p.ra, dec: p && p.dec, dragging: !!(p && p.dragging) });
          scheduleImagery();
        });
        aladin.on('zoomChanged', function () { emit('zoom', { fovDeg: getFovDeg() }); scheduleImagery(); });
        aladin.on('resizeChanged', function () { syncOverlaySize(); emit('resize', size()); scheduleImagery(); });
        aladin.on('click', function (e) {
          var wasDrag = dragged;
          downAt = null; dragged = false;
          if (wasDrag) return;
          // Aladin's click payload varies by version; derive from pixels, which
          // is stable, rather than trusting a field name.
          var c = null;
          try {
            if (e && e.x !== undefined && e.y !== undefined) c = aladin.pix2world(e.x, e.y, 'icrs');
            else if (e && e.ra !== undefined) c = [e.ra, e.dec];
          } catch (err) {}
          if (c) emit('click', { ra: c[0], dec: c[1] });
        });

        if (global.ResizeObserver) {
          ro = new global.ResizeObserver(function () { syncOverlaySize(); emit('resize', size()); });
          ro.observe(container);
        }
        syncOverlaySize();
        scheduleImagery();
        return true;
      });
    }

    /* ── the imagery sources (v0.6) ───────────────────────────────────── */

    var mode = imageryMode(opts.imagery) || 'best';
    var stack = null;          // {key: entry} once created; entry = {src, layer, shown, failed}
    var engaged = false;       // Best: field narrow enough for the overlays
    var covered = {};          // sparse key -> true / false; absent = not known
    var coverCone = null;      // the cone `covered` answers for
    var coverGen = 0;          // drops answers to superseded questions
    var settleTimer = null;
    var lastSig = '';          // what was last reported through 'imagery'
    var pendingPolls = 0, MAX_PENDING_POLLS = 60;    // ~20 s of waiting for layers

    function scheduleImagery() {
      if (destroyed || !aladin) return;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(function () { settleTimer = null; updateImagery(); }, IMAGERY_SETTLE_MS);
    }

    // The field as a cone: centre, and the radius that reaches its corners.
    function fieldCone() {
      var c = null, f = null;
      try { c = aladin.getRaDec(); } catch (e) {}
      try { f = aladin.getFov(); } catch (e) {}
      if (!c || !isFinite(c[0]) || !isFinite(c[1])) return null;
      var fx = Array.isArray(f) ? f[0] : f, fy = Array.isArray(f) ? f[1] : f;
      if (!isFinite(fx)) return null;
      if (!isFinite(fy) || fy >= 179.999) {
        var sz = size();
        fy = (sz.width && sz.height) ? fx * sz.height / sz.width : fx;
      }
      return { ra: +c[0], dec: +c[1], r: Math.min(90, 0.5 * Math.sqrt(fx * fx + fy * fy)) };
    }

    // Create the four overlays once, bottom to top, all hidden. False if this
    // Aladin build lacks the calls (the test mock does; that is fine).
    function ensureStack() {
      if (stack) return true;
      if (!A || !aladin || typeof aladin.setOverlayImageLayer !== 'function') return false;
      var make = (typeof A.HiPS === 'function') ? A.HiPS
               : (typeof A.imageHiPS === 'function') ? A.imageHiPS : null;
      if (!make) return false;
      stack = {};
      IMAGERY_SOURCES.slice().reverse().forEach(function (src) {
        if (src.base) return;
        var entry = { src: src, layer: null, shown: false, failed: false };
        stack[src.key] = entry;
        try {
          var hips = make(src.id, {
            name: src.label,
            errorCallback: function () { entry.failed = true; scheduleImagery(); }
          });
          entry.layer = aladin.setOverlayImageLayer(hips, 'gs-' + src.key) || hips;
          if (entry.layer && typeof entry.layer.setOpacity === 'function') entry.layer.setOpacity(0);
        } catch (e) {
          entry.failed = true;
          console.warn('[geosonify] sky layer ' + src.id + ' not added:', e && e.message);
        }
      });
      return true;
    }

    function loaded(entry) { return !!(entry && entry.layer && entry.layer.added && !entry.failed); }

    // A sparse layer is usable only with transparent tiles (see the header).
    function transparentOk(entry) {
      if (!entry.src.sparse) return true;
      var fmt = String(entry.layer && entry.layer.imgFormat || '').toLowerCase();
      if (fmt === 'png' || fmt === 'webp') return true;
      if (!entry.warned) {
        entry.warned = true;
        console.warn('[geosonify] ' + entry.src.id + ' serves ' + (fmt || 'no') +
                     ' tiles, not PNG; kept hidden so it cannot black out the sky beneath');
      }
      return false;
    }

    function sameCone(a, b) {
      if (!a || !b) return false;
      var cosd = Math.cos(a.dec * Math.PI / 180);
      var dra = ((a.ra - b.ra + 540) % 360) - 180;
      var sep = Math.sqrt(Math.pow(dra * cosd, 2) + Math.pow(a.dec - b.dec, 2));
      return sep < 0.25 * Math.min(a.r, b.r) && Math.abs(a.r / b.r - 1) < 0.2;
    }

    /*
      Which sparse sources have any picture inside the cone, from the CDS
      MocServer. Resolves to {key: true|false}, or null when it could not be
      asked or did not answer -- never to a guess.
    */
    function queryCoverage(cone) {
      if (typeof fetch !== 'function') return Promise.resolve(null);
      var sparse = IMAGERY_SOURCES.filter(function (s) { return s.sparse; });
      var qs = 'expr=' + encodeURIComponent('ID=' + sparse.map(function (s) { return s.id; }).join(',')) +
               '&RA=' + cone.ra.toFixed(6) + '&DEC=' + cone.dec.toFixed(6) +
               '&SR=' + Math.max(cone.r, 1e-4).toFixed(6) +
               '&get=record&fmt=json&fields=ID';
      function attempt(i) {
        if (i >= MOCSERVER_URLS.length) return Promise.reject(new Error('MocServer unreachable'));
        var ctl = null, t = null;
        try { ctl = new AbortController(); } catch (e) {}
        if (ctl) t = setTimeout(function () { ctl.abort(); }, MOCSERVER_TIMEOUT_MS);
        return fetch(MOCSERVER_URLS[i] + '?' + qs, ctl ? { signal: ctl.signal } : undefined)
          .then(function (r) { if (t) clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .catch(function () { if (t) clearTimeout(t); return attempt(i + 1); });
      }
      return attempt(0).then(function (rows) {
        if (!Array.isArray(rows)) return null;
        var found = {};
        sparse.forEach(function (s) { found[s.key] = false; });
        rows.forEach(function (row) {
          var id = String(row && typeof row === 'object' ? (row.ID || row.id || '') : row).replace(/^ivo:\/\//, '');
          sparse.forEach(function (s) { if (id === s.id) found[s.key] = true; });
        });
        return found;
      }, function () { return null; });
    }

    function updateImagery() {
      if (destroyed || !aladin) return;
      var fov = getFovDeg();
      if (!engaged && fov <= IMAGERY_ON_FOV_DEG) engaged = true;
      else if (engaged && fov > IMAGERY_OFF_FOV_DEG) engaged = false;
      if (engaged || mode !== 'best') ensureStack();

      var cone = fieldCone();
      // The caller may forbid sending the position anywhere (privacy on).
      var mayAsk = !(typeof opts.coverageAllowed === 'function' && !opts.coverageAllowed());
      if (!mayAsk) { covered = {}; coverCone = null; coverGen++; }
      else if (cone && cone.r * 2 <= COVERAGE_MAX_FOV_DEG && !sameCone(cone, coverCone)) {
        var gen = ++coverGen, asked = cone;
        coverCone = asked;                 // asked: do not ask again for this view
        queryCoverage(cone).then(function (found) {
          if (destroyed || gen !== coverGen) return;
          covered = found || {};
          if (!found) coverCone = null;    // no answer: ask again when the view moves
          applyImagery();
        });
      } else if (!cone || cone.r * 2 > COVERAGE_MAX_FOV_DEG) {
        covered = {}; coverCone = null; coverGen++;
      }
      applyImagery();
      // Layers finish loading after they are created: look again until they
      // have (or have failed), but not forever.
      if (stack && pendingPolls < MAX_PENDING_POLLS &&
          Object.keys(stack).some(function (k) { var e = stack[k]; return !e.failed && !(e.layer && e.layer.added); })) {
        pendingPolls++;
        scheduleImagery();
      }
    }

    // 'here' | 'not-here' | 'unknown' | 'unavailable' for one source, now.
    function statusOf(src, cone) {
      if (src.base) return 'here';
      var entry = stack && stack[src.key];
      if (entry && entry.failed) return 'unavailable';
      if (src.decFloor !== undefined) {
        if (!cone) return 'unknown';
        return (cone.dec - cone.r) > src.decFloor ? 'here' : 'not-here';
      }
      if (entry && loaded(entry) && !transparentOk(entry)) return 'unavailable';
      if (covered[src.key] === true) return 'here';
      if (covered[src.key] === false) return 'not-here';
      return 'unknown';
    }

    function applyImagery() {
      var cone = fieldCone();
      var report = IMAGERY_SOURCES.map(function (src) {
        var st = statusOf(src, cone), show = false;
        if (!src.base) {
          var entry = stack && stack[src.key];
          if (mode === 'best') show = engaged && st === 'here';
          else if (mode === src.key) show = st === 'here' || (src.sparse && st === 'unknown');
          if (show && !loaded(entry)) show = false;
          if (entry && entry.layer && entry.shown !== show) {
            entry.shown = show;
            try { entry.layer.setOpacity(show ? 1 : 0); } catch (e) {}
          }
        }
        return { key: src.key, status: st, showing: show };
      });
      // DSS2 is seen unless Pan-STARRS covers the whole field over it.
      var ps1 = report.filter(function (r) { return r.key === 'ps1'; })[0];
      report.forEach(function (r) { if (r.key === 'dss') r.showing = !(ps1 && ps1.showing); });
      var sig = mode + '|' + report.map(function (r) { return r.key + ':' + r.status + ':' + (r.showing ? 1 : 0); }).join(',');
      if (sig !== lastSig) {
        lastSig = sig;
        emit('imagery', imageryState());
      }
    }

    function imageryState() {
      var cone = aladin ? fieldCone() : null;
      var sources = IMAGERY_SOURCES.map(function (src) {
        var entry = stack && stack[src.key];
        var showing = src.base ? !(stack && stack.ps1 && stack.ps1.shown) : !!(entry && entry.shown);
        return { key: src.key, label: src.label, credit: src.credit, about: src.about,
                 status: statusOf(src, cone), showing: showing };
      });
      // Top of the stack first, as the eye meets it.
      var credits = sources.filter(function (s) { return s.showing; }).map(function (s) { return s.credit; });
      return { mode: mode, sources: sources, credits: credits };
    }

    function project(raDeg, decDeg) {
      if (!aladin) return null;
      try {
        var p = aladin.world2pix(raDeg, decDeg);
        if (!p || !isFinite(p[0]) || !isFinite(p[1])) return null;
        return [p[0], p[1]];
      } catch (e) { return null; }
    }

    function unproject(x, y) {
      if (!aladin) return null;
      try {
        var c = aladin.pix2world(x, y, 'icrs');
        if (!c || !isFinite(c[0]) || !isFinite(c[1])) return null;
        return [c[0], c[1]];
      } catch (e) { return null; }
    }

    function getFovDeg() {
      if (!aladin) return pendingFov;
      try {
        var f = aladin.getFov();               // ARRAY [fovX, fovY]
        if (Array.isArray(f)) {
          /*
            Aladin 3.9.0-beta reports fovY = 180 until it has drawn its first
            frame (trap found in Starpin). min() would then return the WIDTH, so
            a field read straight after init -- exactly when the zoom carry
            measures it -- came back too wide by the pane's aspect ratio.
            Derive fovY from fovX and the pane shape until it is real.
          */
          var fx = f[0], fy = f[1];
          if (isFinite(fx) && (!isFinite(fy) || fy >= 179.999) && fx < 179.999) {
            var sz = size();
            fy = (sz.width && sz.height) ? fx * sz.height / sz.width : fx;
          }
          return Math.min(fx, fy);
        }
        return f;
      } catch (e) { return pendingFov; }
    }

    return {
      init: init,
      destroy: function () {
        destroyed = true;
        if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
        if (ro) { try { ro.disconnect(); } catch (e) {} ro = null; }
        if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
        if (inner && inner.parentNode) inner.parentNode.removeChild(inner);
        svg = gOverlay = inner = aladin = null;
        listeners = { move: [], zoom: [], resize: [], click: [], imagery: [] };
      },
      project: project,
      unproject: unproject,
      getCenter: function () {
        if (!aladin) return [pendingRa, pendingDec];
        try { return aladin.getRaDec(); } catch (e) { return [pendingRa, pendingDec]; }
      },
      setCenter: function (ra, dec) {
        pendingRa = ra; pendingDec = dec;
        if (aladin) { try { aladin.gotoRaDec(ra, dec); } catch (e) {} }
      },
      getFovDeg: getFovDeg,
      /*
        SET AND GET MUST MEAN THE SAME AXIS.

        getFovDeg returns min(fovX, fovY) -- the smaller dimension, matching the
        built-in renderer's convention. But Aladin's setFoV sets fovX, the WIDTH.
        On a pane 1060 x 800 that means

            setFovDeg(x)  ->  fovX = x,  fovY = 0.755x
            getFovDeg()   ->  min      = 0.755x

        so setting and reading back disagreed by the aspect ratio, and any code
        that computed a field and applied it -- the Earth/Sky zoom carry, the
        +/- buttons, useAladin() handing the field over during the renderer
        swap -- landed 1.33x off on a landscape pane, and did so silently.

        Compensated here rather than at the call sites, because the contract is
        what the call sites are entitled to rely on: setFovDeg(d) must make
        getFovDeg() return d.
      */
      setFovDeg: function (d) {
        var want = Math.max(1e-5, Math.min(180, d));
        pendingFov = want;
        if (aladin) {
          try {
            var sz = size();
            // fovY = fovX * h/w, so min(fovX, fovY) = fovX * min(1, h/w).
            // Invert that to get the fovX which yields the requested minimum.
            var ratio = (sz.width && sz.height) ? Math.min(1, sz.height / sz.width) : 1;
            aladin.setFoV(Math.min(180, want / (ratio || 1)));    // capital V
          } catch (e) {}
        }
      },
      /*
        OPTIONAL (not in the contract): the sky's rotation, in degrees, as
        Aladin keeps it. null / false when Aladin is not ready or lacks the
        method. The sign convention is Aladin's; callers measure the effect.
      */
      getRotationDeg: function () {
        if (!aladin || typeof aladin.getRotation !== 'function') return null;
        try { var v = +aladin.getRotation(); return isFinite(v) ? v : null; } catch (e) { return null; }
      },
      setRotationDeg: function (d) {
        if (!aladin || typeof aladin.setRotation !== 'function' || !isFinite(d)) return false;
        try { aladin.setRotation(+d); return true; } catch (e) { return false; }
      },
      getSize: size,
      on: function (evt, cb) { if (listeners[evt]) listeners[evt].push(cb); },
      off: function (evt, cb) {
        if (!listeners[evt]) return;
        listeners[evt] = listeners[evt].filter(function (f) { return f !== cb; });
      },
      overlayGroup: function () { return gOverlay; },
      // Not decorative. LGPL plus plain courtesy: the imagery and the projection
      // engine are CDS's work and the caller is expected to show this.
      // v0.6: the sources on screen follow CDS, top of the stack first, and
      // change as the view moves; 'imagery' is emitted when they do.
      attribution: function () {
        var credits = aladin ? imageryState().credits : [];
        return {
          text: 'Sky imagery: Aladin Lite / CDS, Strasbourg' +
                (credits.length ? ' \u00b7 ' + credits.join(' \u00b7 ') : ''),
          href: 'https://aladin.cds.unistra.fr/'
        };
      },
      /*
        OPTIONAL (not in the contract): which imagery to show. 'best', or one
        source's key (IMAGERY_SOURCES) to see it alone over DSS2. Returns the
        mode now in force; an unknown value changes nothing.
      */
      setImagery: function (m) {
        var k = imageryMode(m);
        if (!k) return mode;
        if (k !== mode) { mode = k; pendingPolls = 0; scheduleImagery(); }
        return mode;
      },
      getImagery: function () { return imageryState(); },
      capabilities: function () {
        return {
          name: 'Aladin Lite',
          imagery: true,
          offline: false,               // HiPS tiles need the network
          handedness: 'sky',
          projection: 'aladin',
          maxResolvableOrder: 29,       // conservative: Aladin's own limit
          licence: 'LGPL-3.0-or-later'
        };
      },
      redrawChrome: function () { syncOverlaySize(); },
      _aladin: function () { return aladin; }    // escape hatch, for debugging only
    };
  }

  var API = {
    VERSION: VERSION,
    CDN_URL: CDN_URL,
    LIB_FALLBACKS: LIB_FALLBACKS,
    SURVEY_MIRRORS: SURVEY_MIRRORS,
    resolveSurvey: resolveSurvey,
    surveyFor: surveyFor,
    surveyBaseUrl: surveyBaseUrl,
    CHROME_OFF: CHROME_OFF,
    isAvailable: isAvailable,
    webgl2Available: webgl2Available,
    createAladinRenderer: createAladinRenderer,
    IMAGERY_SOURCES: IMAGERY_SOURCES,
    imageryMode: imageryMode,
    imagerySource: imagerySource
  };

  global.GeosonifySkyAladin = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
