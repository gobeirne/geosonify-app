/*
  geosonify-sky-aladin.js  v0.1  — Aladin Lite as a backend viewport

  Implements the SAME contract as the built-in renderer (geosonify-sky-renderer.js),
  so nothing above the seam knows or cares which one is live. Aladin supplies sky
  imagery and answers "where on screen is this (ra, dec)?". Geosonify keeps the
  layout, the chrome, the cards, the URL grammar, the encryption, the sonification
  and — importantly — draws its own cells into its own SVG layer on top.

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

  var VERSION = 'v0.1';
  var SVGNS = 'http://www.w3.org/2000/svg';

  var CDN_URL = 'https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js';

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
    _modulePromise = new Function('u', 'return import(u);')(url)
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

      return loadAladin(opts.src).then(function (mod) {
        if (destroyed) return false;
        A = mod;
        var options = {};
        for (var k in CHROME_OFF) options[k] = CHROME_OFF[k];
        options.target = pendingRa + ' ' + pendingDec;
        options.fov = pendingFov;
        options.cooFrame = opts.cooFrame || 'ICRS';
        options.backgroundColor = opts.background || '#0b0f19';
        options.survey = opts.survey || 'P/DSS2/color';
        if (opts.aladinOptions) {
          for (var j in opts.aladinOptions) options[j] = opts.aladinOptions[j];
        }

        aladin = A.aladin(inner, options);

        aladin.on('positionChanged', function (p) {
          emit('move', { ra: p && p.ra, dec: p && p.dec, dragging: !!(p && p.dragging) });
        });
        aladin.on('zoomChanged', function () { emit('zoom', { fovDeg: getFovDeg() }); });
        aladin.on('resizeChanged', function () { syncOverlaySize(); emit('resize', size()); });
        aladin.on('click', function (e) {
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
        if (Array.isArray(f)) return Math.min(f[0], f[1]);
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
      setFovDeg: function (d) {
        pendingFov = Math.max(1e-5, Math.min(180, d));
        if (aladin) { try { aladin.setFoV(pendingFov); } catch (e) {} }   // capital V
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
    CHROME_OFF: CHROME_OFF,
    isAvailable: isAvailable,
    webgl2Available: webgl2Available,
    createAladinRenderer: createAladinRenderer
  };

  global.GeosonifySkyAladin = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
