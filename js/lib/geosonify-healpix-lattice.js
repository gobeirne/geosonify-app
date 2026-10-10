/*
  geosonify-healpix-lattice.js  v0.1  — the HEALPix lattice, on the Earth map and on the sky

  Shown in Sky mode (chosen in the FAQ tab's Map imagery panel), on both
  faces: over the Earth map, and over the sky view. Off again in the normal
  map modes. geosonify-sky-flip.js switches it.

  THE DRAWING IS STARPIN'S (geosonify-starpin-map.js), generalised from one
  Leaflet map to any projection, so the same loop draws the ground and the sky:

    - several orders at once, weighted by CELLS ACROSS THE VIEW (strokeFor,
      used from Starpin as exported): the coarsest boundary on screen is the
      rarest and is drawn heaviest; orders that would only add clutter stop
    - cells found by SAMPLING the view, which crosses HEALPix face boundaries
      with no special cases
    - EACH EDGE ONCE, at the coarsest order that owns it: a nested child shares
      two of its four edges with its parent, read off its last two index bits
    - edges SUBDIVIDED so no straight piece is longer than ~4 px on screen
      (a HEALPix edge bows; at street zoom that bow is metres of pavement)
    - ALL the dark underlays first, then ALL the lines, coarsest on top
    - pole corners and the antimeridian handled by Starpin's ringCopies

  Palettes are Starpin's too: bark on the street and topographic maps, yellow
  on aerial imagery, warm amber on the night sky.

  Ground: a Leaflet layer in the overlay pane, so it pans and zooms with the
  map (and fades with it during the turn). Sky: a canvas inside the sky view's
  picture, drawn through the sky renderer's MEASURED projection (the same
  three-point affine geosonify-sky-flip.js uses), so it lies exactly where the
  renderer puts the same coordinates.

  Display only. It reads no code, writes no URL and changes no format.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';
  var D2R = Math.PI / 180;
  var RAD_ARCSEC = 206264.80624709636;
  var M_PER_ARCSEC = 111319.9 / 3600;
  // Starpin's limits for the ramp (geosonify-starpin-map.js MIN_ACROSS / MAX_ACROSS).
  var MIN_ACROSS = 1 / 64, MAX_ACROSS = 44;
  // Corner vectors are doubles: past order 29 a cell is under 1.2 cm (or 0.4
  // milliarcseconds) and the lattice stops; the cards and the cell overlay go
  // on exactly, through BigInt.
  var MAX_ORDER = 29;
  var MAX_CELLS = 700;

  function SM() { return global.GeosonifyStarpinMap || null; }
  function SF() { return global.GeosonifyStarpinFlip || null; }
  function SV() { return global.GeosonifySkyView || null; }
  function HP() {
    try { if (typeof HealpixGrids !== 'undefined' && HealpixGrids) return HealpixGrids; } catch (e) {}
    return global.HealpixGrids || null;
  }
  function available() {
    var M = SM(), H = HP();
    return !!(M && M.strokeFor && M.cellWidthM && M.ringCopies && H && H._core && H._core.pixcoord2vec_nest && H.nestIndex);
  }

  // ── Starpin's loop, over any projection ──────────────────────────────────
  //
  // v: { w, h, spanM,
  //      sample(x, y)   -> [lat, lon] | null     what is under a pixel
  //      project(lat, lon) -> [x, y] | null      where a point lands
  //      copies(line)   -> [line, ...]           Starpin's ringCopies, bound
  //      pal }                                   { grid, under }
  function cellsInView(order, v, cw) {
    var H = HP();
    var step = Math.max(3, Math.round(v.w / (v.spanM / (cw / 2.5))));
    var seen = {}, out = [];
    for (var px = -step; px <= v.w + step; px += step) {
      for (var py = -step; py <= v.h + step; py += step) {
        var ll = v.sample(px, py);
        if (!ll || ll[0] > 89.9 || ll[0] < -89.9) continue;
        var ip;
        try { ip = H.nestIndex(ll[0], ll[1], order).toString(); } catch (e) { continue; }
        if (seen[ip]) continue;
        seen[ip] = 1; out.push(ip);
        if (out.length > MAX_CELLS) return out;             // stay responsive
      }
    }
    return out;
  }

  function draw(g, v) {
    var M = SM(), H = HP();
    if (!M || !H || !(v.spanM > 0) || !v.w) return [];
    var mpp = v.spanM / v.w, drawn = [], layers = [];
    for (var order = 0; order <= MAX_ORDER; order++) {
      var cw = M.cellWidthM(order);
      var st = M.strokeFor(order, v.spanM);
      if (st.across < MIN_ACROSS) continue;                 // too coarse to matter
      if (st.across > MAX_ACROSS || !st.visible) break;     // too fine to help
      var cells = cellsInView(order, v, cw);
      if (!cells.length) continue;
      drawn.push(order);
      var nside = Math.pow(2, order);
      var segs = Math.max(4, Math.min(64, Math.ceil((cw / mpp) / 4)));
      var parentDrawn = drawn.indexOf(order - 1) >= 0;
      var screenRings = [];
      for (var i = 0; i < cells.length; i++) {
        var ip = BigInt(cells[i]);
        var xb = Number(ip & 1n), yb = Number((ip >> 1n) & 1n);
        var inherited = [yb === 0, xb === 1, yb === 1, xb === 0];   // e0 v=0, e1 u=1, e2 v=1, e3 u=0
        for (var e = 0; e < 4; e++) {
          if (parentDrawn && inherited[e]) continue;
          var line = [];
          for (var t = 0; t <= segs; t++) {
            var f = t / segs;
            var uv = e === 0 ? [f, 0] : e === 1 ? [1, f] : e === 2 ? [1 - f, 1] : [0, 1 - f];
            var q = H._core.pixcoord2vec_nest(nside, ip, uv[0], uv[1]);
            var x = q.x != null ? q.x : q[0], y = q.y != null ? q.y : q[1], z = q.z != null ? q.z : q[2];
            var r3 = Math.hypot(x, y, z);
            line.push([Math.asin(z / r3) / D2R,
                       Math.hypot(x, y) < 1e-12 * r3 ? null : Math.atan2(y, x) / D2R]);
          }
          v.copies(line).forEach(function (rg) {
            // A point the projection cannot place (the far side of the sky)
            // breaks the line rather than joining across it.
            var run = [];
            for (var k = 0; k < rg.length; k++) {
              var p = v.project(rg[k][0], rg[k][1]);
              if (p) { run.push(p); continue; }
              if (run.length > 1) screenRings.push(run);
              run = [];
            }
            if (run.length > 1) screenRings.push(run);
          });
        }
      }
      layers.push({ rings: screenRings, st: st });
    }
    function strokeAll(Ly, colour, width, alpha) {
      g.strokeStyle = colour; g.lineWidth = width; g.globalAlpha = alpha;
      g.beginPath();
      Ly.rings.forEach(function (sr) {
        g.moveTo(sr[0][0], sr[0][1]);
        for (var j = 1; j < sr.length; j++) g.lineTo(sr[j][0], sr[j][1]);
      });
      g.stroke();
    }
    g.lineCap = 'round'; g.lineJoin = 'round';
    layers.forEach(function (Ly) { strokeAll(Ly, v.pal.under, Ly.st.width + 1.8, Ly.st.alpha * 0.85); });
    layers.slice().reverse().forEach(function (Ly) { strokeAll(Ly, v.pal.grid, Ly.st.width, Ly.st.alpha); });
    g.globalAlpha = 1;
    return drawn;
  }

  function sizeCanvas(cv, w, h) {
    var dpr = global.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    var g = cv.getContext('2d');
    if (!g) return null;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return g;
  }

  // ── the ground: a Leaflet layer (Starpin's GridLayer) ────────────────────

  var earthLayer = null, earthMap = null;

  function earthPalette() {
    var M = SM(), k = global.__GEOSONIFY_BASEMAP_ACTIVE;
    return M.PALETTE[k === 'aerial' ? 'imagery' : 'light'];
  }

  function drawEarth(cv, map) {
    if (!cv || !map) return;
    var L = global.L, M = SM();
    var size = map.getSize();
    L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));
    var g = sizeCanvas(cv, size.x, size.y);
    if (!g) return;
    var b = map.getBounds();
    var refLon = map.getCenter().lng;
    var westLon = b.getNorthWest().lng, eastLon = b.getNorthEast().lng;
    draw(g, {
      w: size.x, h: size.y,
      spanM: map.distance(b.getNorthWest(), b.getNorthEast()) || 1000,
      sample: function (x, y) { var ll = map.containerPointToLatLng([x, y]); return [ll.lat, ll.lng]; },
      project: function (lat, lon) { var p = map.latLngToContainerPoint([lat, lon]); return [p.x, p.y]; },
      copies: function (line) { return M.ringCopies(line, refLon, westLon, eastLon); },
      pal: earthPalette()
    });
  }

  function makeEarthLayer() {
    var L = global.L;
    var Layer = L.Layer.extend({
      onAdd: function (m) {
        this._cv = L.DomUtil.create('canvas', 'leaflet-zoom-animated gs-lattice-earth');
        this._cv.style.pointerEvents = 'none';
        m.getPanes().overlayPane.appendChild(this._cv);
        m.on('moveend zoomend resize', this._render, this);
        if (m.options.zoomAnimation && L.Browser.any3d) m.on('zoomanim', this._animateZoom, this);
        this._render();
      },
      onRemove: function (m) {
        m.off('moveend zoomend resize', this._render, this);
        m.off('zoomanim', this._animateZoom, this);
        if (this._cv && this._cv.parentNode) this._cv.parentNode.removeChild(this._cv);
      },
      _animateZoom: function (e) {
        var s = this._map.getZoomScale(e.zoom);
        var o = this._map._latLngBoundsToNewLayerBounds(this._map.getBounds(), e.zoom, e.center).min;
        L.DomUtil.setTransform(this._cv, o, s);
      },
      _render: function () { try { drawEarth(this._cv, this._map); } catch (e) {} }
    });
    return new Layer();
  }

  // ── the sky: a canvas in the sky view's picture ──────────────────────────

  var skyCv = null, skyPending = false, skyOn = false, unsubs = [];

  // The renderer's projection, measured (as geosonify-sky-flip.js does), in
  // the picture's own pixels.
  function skyAffine(r) {
    var F = SF();
    var c = r.getCenter(), ra0 = c[0], dec0 = c[1];
    var e = Math.max(1e-12, r.getFovDeg() * D2R * 0.05);
    var p0 = r.project(ra0, dec0);
    var pe = r.project.apply(null, F.fromTangent(ra0, dec0, e, 0));
    var pn = r.project.apply(null, F.fromTangent(ra0, dec0, 0, e));
    if (!p0 || !pe || !pn) return null;
    return { ra0: ra0, dec0: dec0, x0: p0[0], y0: p0[1],
             ax: (pe[0] - p0[0]) / e, ay: (pe[1] - p0[1]) / e,
             bx: (pn[0] - p0[0]) / e, by: (pn[1] - p0[1]) / e };
  }

  function drawSky() {
    skyPending = false;
    var sv = SV(), M = SM(), F = SF();
    if (!skyOn || !sv || !sv.isOpen() || !M || !F) return;
    var wrap = sv.getCanvasWrap ? sv.getCanvasWrap() : null, r = sv.getRenderer ? sv.getRenderer() : null;
    if (!wrap || !r) return;
    if (!skyCv) {
      skyCv = document.createElement('canvas');
      skyCv.className = 'gs-lattice-sky';
      skyCv.setAttribute('aria-hidden', 'true');
      skyCv.style.cssText = 'position:absolute; left:0; top:0; z-index:5; pointer-events:none;';
    }
    if (skyCv.parentNode !== wrap) wrap.appendChild(skyCv);
    var w = wrap.clientWidth, h = wrap.clientHeight;
    var g = sizeCanvas(skyCv, w, h);
    if (!g || !w || !h) return;
    var A = skyAffine(r);
    if (!A) return;
    var T = F.tangentOf(A.ra0, A.dec0);
    var det = A.ax * A.by - A.bx * A.ay;
    if (!det) return;
    var asp = RAD_ARCSEC / Math.hypot(A.ax, A.ay);
    draw(g, {
      w: w, h: h,
      spanM: asp * w * M_PER_ARCSEC,           // dec is lat: the same identity the cards use
      sample: function (x, y) {
        var dx = x - A.x0, dy = y - A.y0;
        var xi = (dx * A.by - dy * A.bx) / det, eta = (A.ax * dy - A.ay * dx) / det;
        if (Math.hypot(xi, eta) >= 1) return null;          // off the sphere
        var s = F.fromTangent(A.ra0, A.dec0, xi, eta);
        return [s[1], s[0] > 180 ? s[0] - 360 : s[0]];
      },
      project: function (lat, lon) {
        var t = T(lat, lon);
        return t ? [A.x0 + t[0] * A.ax + t[1] * A.bx, A.y0 + t[0] * A.ay + t[1] * A.by] : null;
      },
      // The tangent plane has no seam, so one copy; ringCopies still fills in
      // the longitude of a corner that sits on a pole.
      copies: function (line) { return M.ringCopies(line, A.ra0 > 180 ? A.ra0 - 360 : A.ra0, null, null); },
      pal: M.PALETTE.night
    });
  }
  function scheduleSky() {
    if (skyPending || !skyOn) return;
    skyPending = true;
    global.requestAnimationFrame(drawSky);
  }
  function clearSky() {
    if (skyCv && skyCv.parentNode) skyCv.parentNode.removeChild(skyCv);
  }

  // ── switch ────────────────────────────────────────────────────────────────

  var enabled = false;
  function setEnabled(on) {
    on = !!on;
    if (on && !available()) return false;
    enabled = on;
    var map = global.__geosonifyMap, L = global.L, sv = SV();
    // Ground
    if (on && map && L) {
      if (!earthLayer) earthLayer = makeEarthLayer();
      if (earthMap !== map || !map.hasLayer(earthLayer)) { earthLayer.addTo(map); earthMap = map; }
    } else if (earthLayer && earthMap) {
      try { earthMap.removeLayer(earthLayer); } catch (e) {}
      earthMap = null;
    }
    // Sky
    skyOn = on;
    if (on && sv && sv.on && !unsubs.length) {
      ['view', 'renderer', 'open'].forEach(function (evt) { unsubs.push(sv.on(evt, scheduleSky)); });
      unsubs.push(sv.on('close', clearSky));
    }
    if (!on) {
      unsubs.forEach(function (u) { try { u(); } catch (e) {} });
      unsubs = [];
      clearSky();
    } else {
      scheduleSky();
    }
    return enabled;
  }

  // The ground palette follows the imagery: redraw after a basemap change.
  function refresh() {
    if (!enabled) return;
    if (earthLayer && earthLayer._render) earthLayer._render();
    scheduleSky();
  }

  var API = {
    VERSION: VERSION,
    isAvailable: available,
    setEnabled: setEnabled,
    isEnabled: function () { return enabled; },
    refresh: refresh,
    _draw: draw,
    MAX_ORDER: MAX_ORDER
  };
  global.GeosonifyHealpixLattice = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
