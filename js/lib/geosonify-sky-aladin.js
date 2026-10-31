/*
  geosonify-sky-aladin.js  v0.3  — Aladin Lite as a backend viewport

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

  var VERSION = 'v0.5';
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
      'https://casda.csiro.au/hips/DSS2/color',                   // CSIRO, Australia
      'https://irsa.ipac.caltech.edu/data/hips/CDS/DSS2/color',   // IRSA, Caltech
      'https://cdn.skies.esac.esa.int/DSSColor',                  // ESA, ESAC
      'https://healpix.ias.u-psud.fr/CDS_P_DSS2_color'            // IAS, Paris-Saclay
    ]
  };
  var PROBE_MS = 4000, SURVEY_CACHE_MS = 30 * 60 * 1000;
  var _surveyCache = {};          // id -> { use, ms }

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
  */
  function resolveSurvey(id) {
    var list = SURVEY_MIRRORS[id];
    if (!list) return Promise.resolve(id);
    var c = _surveyCache[id];
    if (c && Date.now() - c.ms < SURVEY_CACHE_MS) return Promise.resolve(c.use);
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.resolve(id);
      var k = i++;
      return probe(list[k]).then(function (ok) {
        if (!ok) return next();
        var use = k === 0 ? id : list[k];
        _surveyCache[id] = { use: use, ms: Date.now() };
        return use;
      });
    }
    return next();
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
    // The page's own src (or the CDS CDN) first, then the pinned npm copy.
    var tries = [url].concat(LIB_FALLBACKS.filter(function (u) { return u !== url; }));
    function importFirst(k, lastErr) {
      if (k >= tries.length) return Promise.reject(lastErr || new Error('Aladin Lite could not be loaded'));
      return new Function('u', 'return import(u);')(tries[k])
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
    Create an Aladin-backed renderer.

    Asynchronous, unlike the built-in one, because the module must load first.
    init() returns a Promise; the caller should await it and fall back to the
    built-in renderer if it rejects.
  */
  function createAladinRenderer(container, opts) {
    opts = opts || {};
    var aladin = null, A = null;
    var svg = null, gOverlay = null, inner = null;
    var listeners = { move: [], zoom: [], resize: [], click: [] };
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
        });
        aladin.on('zoomChanged', function () { emit('zoom', { fovDeg: getFovDeg() }); });
        aladin.on('resizeChanged', function () { syncOverlaySize(); emit('resize', size()); });
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
        return true;
      });
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
        if (ro) { try { ro.disconnect(); } catch (e) {} ro = null; }
        if (svg && svg.parentNode) svg.parentNode.removeChild(svg);
        if (inner && inner.parentNode) inner.parentNode.removeChild(inner);
        svg = gOverlay = inner = aladin = null;
        listeners = { move: [], zoom: [], resize: [], click: [] };
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
      attribution: function () {
        return {
          text: 'Sky imagery: Aladin Lite / CDS, Strasbourg',
          href: 'https://aladin.cds.unistra.fr/'
        };
      },
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
    CHROME_OFF: CHROME_OFF,
    isAvailable: isAvailable,
    webgl2Available: webgl2Available,
    createAladinRenderer: createAladinRenderer
  };

  global.GeosonifySkyAladin = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
