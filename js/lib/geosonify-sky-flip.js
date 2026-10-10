/*
  geosonify-sky-flip.js  v0.2  — the turn from the ground to the sky, and back

  Press "Sky" on the map and the ground turns over:

    1. the street map fades in as lines while the map imagery fades out
    2. the lines turn over, like a page, so the streets are seen from below
    3. the stars fade in underneath, each one lying on its own patch of ground
    4. the streets fade away, leaving the sky

  "Earth" in the sky view runs the same steps backwards.

  WHY IT LINES UP. Sky mode reads latitude as declination and longitude as
  right ascension. Seen from above, east is on the right of a map; seen from
  below, east is on the left of the sky. So the sky is the ground's mirror
  image, and a half turn about the vertical axis is exactly that mirror. Every
  street lands on the stars with the same coordinates.

  BORROWED FROM STARPIN, NOT REINVENTED. The technique is Starpin's
  (geosonify-starpin-flip.js), and so are the parts that took the work:

    GeosonifyStarpinTiles   vector tiles: OpenFreeMap, cached on the device,
                            only what is on screen, coasts and borders far
                            out, every street close in
    GeosonifyStarpinFlip    the pure maths: map zoom <-> arcsec per pixel, the
                            tangent plane, and how to find a position at a
                            given offset from it

  Copied here rather than exported from Starpin, with the same values: the
  street drawing (drawTiles, the night palette, road weights) and the way the
  projection is MEASURED from the live sky renderer (skyAffine, setSkyAsp).

  THE THREE THINGS THAT MAKE IT WORK
  ----------------------------------
  The Leaflet map is never mirrored. A mirrored map would need every tap and
  drag corrected. A separate canvas carries the streets, belongs to neither
  view, and is the only thing that turns.

  The sky's projection is read from the renderer, not modelled. Three
  project() calls give the linear map from the tangent plane to the screen,
  whatever the renderer's scale, handedness or settling. So the streets stay
  on the stars when Aladin swaps in, settles or is panned.

  The map and the sky use different projections. Web Mercator and the sky's
  orthographic view agree at the centre and drift apart with distance from it:
  0.7 px across 22 km, 40 px across 1400 km (measured in Starpin). Starpin
  avoids turning when the view is wider than 60 km. Here, the map imagery is
  already gone before the turn, so each street point is moved smoothly from
  its Mercator position to its orthographic one while the imagery fades. The
  turn therefore works at continent scale too. Past TURN_MAX_FOV_DEG, or with
  reduced motion, it is a plain crossfade.

  THE SCALE ANCHOR (also Starpin's, and geosonify-sky-zoom.js's lesson). On the
  way up we record the ground scale we left and the sky scale we arrived at.
  On the way down the ground returns to that scale, multiplied only by zoom
  the PERSON did in the sky. Aladin quantises and settles by itself, and
  reading that as a user zoom compounds on every flip.

  SKY MODE (v0.2). The Sky button appears on the map only in Sky mode, chosen
  in the FAQ tab's Map imagery panel (or arrived at through a sky link); the
  normal map modes take it away again. Sky mode also switches on the HEALPix
  lattice on both faces (geosonify-healpix-lattice.js). In the sky, HOLDING
  the Earth button fades the Earth's streets in over the sky, and releasing it
  fades them out; a tap still turns back to Earth.

  NOTHING HERE TOUCHES A CODE, A URL OR A FROZEN FORMAT. Opening and closing go
  through GeosonifySkyView, which owns the frame (and so ?frame=icrs).
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.2';
  var D2R = Math.PI / 180;
  var RAD_ARCSEC = 206264.80624709636;
  var BG = '#0b0f19';                       // the sky view's own background
  var MAP_ID = 'mapContainerMobile';

  // Where the streets-and-stars idea lives in full.
  var STARPIN_URL = 'starpin-flip.html';
  var HINT_KEY = 'geosonify_skyflip_starpin_hint_count';
  var HINT_MAX = 3;                        // the first few flips on a device

  // Past three times a survey's native pixel the sky stops reading as a
  // photograph, so after the turn it eases back to that (Starpin's limit).
  // DSS2 is what geosonify-sky-aladin.js shows: 0.8 arcsec per pixel.
  var NATIVE_ASP = 0.8, UPSAMPLE_LIMIT = 3;
  var FLOOR_ASP = NATIVE_ASP / UPSAMPLE_LIMIT;

  // Wider than this (the smaller screen side, in degrees) and an orthographic
  // view of the ground stops looking like a map: crossfade instead.
  var TURN_MAX_FOV_DEG = 60;

  var MS = {
    tilesWait: 900,       // how long we hold the start for ALL the street tiles
    tilesGiveUp: 2500,    // ...and for ANY, before settling for a crossfade
    crossIn: 380,         // streets in, imagery out (and Mercator -> orthographic)
    turn: 560,
    starsIn: 650,
    imageryWait: 6000,    // how long the streets wait for sky photography
    pull: 850,
    hold: 1200,           // streets on the stars, before they go
    streetsOut: 3000,
    retrace: 750,         // back down: the sky returns to the ground's scale
    streetsInBack: 420,
    skyOut: 320,
    earthIn: 500,
    streetsOutBack: 700,
    cross: 450
  };
  var EASE = 'cubic-bezier(.65,0,.35,1)';

  // Starpin's night palette and road weights, unchanged.
  var LOOK = { road: '205,214,228', water: '118,170,226', border: '232,226,246', under: '7,10,20' };
  var ROADS = {
    major:   { w: 1.9, a: 0.85, dash: null },
    minor:   { w: 1.05, a: 0.6, dash: null },
    service: { w: 0.7, a: 0.42, dash: null },
    path:    { w: 0.9, a: 0.55, dash: [2.5, 3] }
  };
  var CREDIT = '© OpenStreetMap · OpenFreeMap';

  function SF() { return global.GeosonifyStarpinFlip || null; }
  function VT() { return global.GeosonifyStarpinTiles || null; }
  function SV() { return global.GeosonifySkyView || null; }
  function lmap() { return global.__geosonifyMap || null; }
  function mapEl() { return document.getElementById(MAP_ID); }

  function reducedMotion() {
    try { return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function tween(ms, fn) {
    return new Promise(function (resolve) {
      if (!ms || ms <= 0) { fn(1); return resolve(); }
      var t0 = null;
      function step(ts) {
        if (t0 === null) t0 = ts;
        var t = Math.min(1, (ts - t0) / ms);
        try { fn(t); } catch (e) {}
        if (t < 1) global.requestAnimationFrame(step); else resolve();
      }
      global.requestAnimationFrame(step);
    });
  }
  function fade(node, to, ms) {
    if (!node) return;
    node.style.transition = 'opacity ' + ms + 'ms ease';
    node.style.opacity = String(to);
  }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  // ── state ─────────────────────────────────────────────────────────────────
  var busy = false;
  var anchor = null;         // { earthAsp, skyAsp, pulled }
  var lastSetAsp = null;     // the sky scale this module last asked for
  var fovCorrection = 1;     // what the last measured match learned
  var tail = 0;              // token for the cancellable end of the way up
  var tailActive = false;

  var cv = null, ctx = null, store = null, unsubTiles = null;
  var mode = null;           // 'merc' | 'morph' | 'ortho' | 'sky'
  var morphK = 0;            // 0 = Mercator, 1 = ground seen orthographically
  var frozenA = null;        // the sky's projection, kept once the renderer is gone
  var tileList = [];
  var lineScale = 1;
  var savedBg = null;
  var mapBtn = null;
  var lastUp = null;         // what the last way up decided (for tests)

  // ── geometry ──────────────────────────────────────────────────────────────

  // The sky picture's box (the sky view's canvas area, between its header and
  // its readouts), in the map container's pixels.
  function wrapGeom() {
    var m = mapEl();
    var mr = m.getBoundingClientRect();
    var sv = SV(), w = sv && sv.getCanvasWrap ? sv.getCanvasWrap() : null;
    if (!w) return { left: 0, top: 0, w: mr.width, h: mr.height, cx: mr.width / 2, cy: mr.height / 2 };
    var r = w.getBoundingClientRect();
    var left = r.left - mr.left, top = r.top - mr.top;
    return { left: left, top: top, w: r.width, h: r.height, cx: left + r.width / 2, cy: top + r.height / 2 };
  }

  function renderer() {
    var sv = SV();
    return sv && sv.getRenderer ? sv.getRenderer() : null;
  }

  // THE PROJECTION IS READ FROM THE RENDERER, NOT MODELLED (Starpin's skyAffine).
  // The centre and two points a small known distance east and north of it give
  // the linear map from the tangent plane to the screen.
  function liveAffine() {
    var r = renderer(), F = SF();
    if (!r || !F) return null;
    var c = r.getCenter(), ra0 = c[0], dec0 = c[1];
    var e = Math.max(1e-12, r.getFovDeg() * D2R * 0.05);
    var p0 = r.project(ra0, dec0);
    var pe = r.project.apply(null, F.fromTangent(ra0, dec0, e, 0));
    var pn = r.project.apply(null, F.fromTangent(ra0, dec0, 0, e));
    if (!p0 || !pe || !pn) return null;
    var g = wrapGeom();
    return { ra0: ra0, dec0: dec0, x0: p0[0] + g.left, y0: p0[1] + g.top,
             ax: (pe[0] - p0[0]) / e, ay: (pe[1] - p0[1]) / e,
             bx: (pn[0] - p0[0]) / e, by: (pn[1] - p0[1]) / e, g: g };
  }
  function affineAsp(A) { return A ? RAD_ARCSEC / Math.hypot(A.ax, A.ay) : null; }

  // The sky position under a pixel (map-container px), by inverting the affine.
  function pixelToSky(A, x, y) {
    var dx = x - A.x0, dy = y - A.y0, det = A.ax * A.by - A.bx * A.ay;
    if (!det) return [A.ra0, A.dec0];
    return SF().fromTangent(A.ra0, A.dec0, (dx * A.by - dy * A.bx) / det, (A.ax * dy - A.ay * dx) / det);
  }

  // Put the star at (lat, lon) under pixel (x, y). A renderer's own centre is
  // not always the middle of its box (Aladin's sits about 16 px off in this
  // layout, measured), so the centre is corrected by measurement, not assumed.
  function pinSkyPoint(lat, lon, x, y) {
    var r = renderer();
    if (!r) return;
    for (var i = 0; i < 3; i++) {
      var A = liveAffine();
      if (!A) return;
      var p = skyProj(A)(lat, lon);
      if (!p || Math.hypot(p[0] - x, p[1] - y) < 0.01) return;
      var c = pixelToSky(A, A.x0 + (p[0] - x), A.y0 + (p[1] - y));
      r.setCenter(c[0], c[1]);
    }
  }

  function skyProj(A) {
    var T = SF().tangentOf(A.ra0, A.dec0);
    return function (lat, lon) {
      var t = T(lat, lon);
      return t ? [A.x0 + t[0] * A.ax + t[1] * A.bx, A.y0 + t[0] * A.ay + t[1] * A.by] : null;
    };
  }
  // The ground seen orthographically from above: the sky's projection mirrored
  // about the vertical line through the picture's centre. Half a turn about
  // that same line maps one onto the other exactly.
  function orthoProj(A) {
    var S = skyProj(A), cx = A.g.cx;
    return function (lat, lon) { var p = S(lat, lon); return p ? [2 * cx - p[0], p[1]] : null; };
  }
  function mercProj() {
    var m = lmap(), ref = m.getCenter().lng, F = SF();
    return function (lat, lon) {
      var p = m.latLngToContainerPoint([lat, F.wrapNear(lon, ref)]);
      return [p.x, p.y];
    };
  }
  function projector() {
    if (mode === 'merc') return mercProj();
    var A = frozenA || liveAffine();
    if (!A) return null;
    if (mode === 'sky') return skyProj(A);
    var O = orthoProj(A);
    if (mode === 'ortho') return O;
    var M = mercProj(), k = morphK;
    return function (lat, lon) {
      var a = M(lat, lon), b = O(lat, lon);
      if (!a || !b) return null;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    };
  }
  function refLon() {
    var m = lmap();
    return m ? m.getCenter().lng : 0;
  }

  // Ask the renderer for a scale, then MEASURE it and correct (Starpin's
  // setSkyAsp; the discipline of geosonify-sky-zoom.js: trust the result, not
  // the request). quick = reuse the learned correction without measuring.
  function fovForAsp(asp, r) {
    var s = r.getSize ? r.getSize() : null;
    var minDim = s ? Math.min(s.width, s.height) : 400;
    var half = minDim / 2 * asp / RAD_ARCSEC;
    return 2 * Math.asin(Math.min(1, half)) / D2R;
  }
  function setSkyAsp(asp, quick) {
    var r = renderer();
    if (!r || !(asp > 0)) return;
    lastSetAsp = asp;
    var base = fovForAsp(asp, r), fov = base * fovCorrection;
    r.setFovDeg(fov);
    if (quick) return;
    for (var i = 0; i < 4; i++) {
      var got = affineAsp(liveAffine());
      if (!got || Math.abs(got / asp - 1) <= 0.001) break;
      fov *= asp / got;
      r.setFovDeg(fov);
    }
    if (base > 0) fovCorrection = fov / base;
  }

  // ── the streets ───────────────────────────────────────────────────────────

  function ensureCanvas() {
    var m = mapEl();
    if (!m || !m.parentNode) return null;
    if (!cv) {
      cv = document.createElement('canvas');
      cv.className = 'gs-skyflip-streets';
      cv.setAttribute('aria-hidden', 'true');
      cv.style.cssText = 'position:absolute; left:0; top:0; z-index:1002; pointer-events:none; opacity:0;';
      ctx = cv.getContext('2d');
    }
    var parent = m.parentNode;
    try {
      var cs = global.getComputedStyle(parent);
      if (cs && cs.position === 'static') parent.style.position = 'relative';
    } catch (e) {}
    if (cv.parentNode !== parent) parent.appendChild(cv);
    var w = m.offsetWidth || 1, h = m.offsetHeight || 1, dpr = global.devicePixelRatio || 1;
    cv.style.left = (m.offsetLeft || 0) + 'px';
    cv.style.top = (m.offsetTop || 0) + 'px';
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    cv.style.transform = 'none';
    cv.style.transition = 'none';
    cv.style.opacity = '0';
    return cv;
  }

  function dropCanvas() {
    mode = null; frozenA = null; tileList = []; lineScale = 1;
    if (unsubTiles) { try { unsubTiles(); } catch (e) {} unsubTiles = null; }
    if (cv && cv.parentNode) cv.parentNode.removeChild(cv);
  }

  var rafPending = false;
  function schedule() {
    if (rafPending || !mode) return;
    rafPending = true;
    global.requestAnimationFrame(function () { rafPending = false; draw(); });
  }

  function draw() {
    if (!cv || !ctx || !mode) return;
    var dpr = global.devicePixelRatio || 1;
    var w = cv.width / dpr, h = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var P = projector();
    if (!P) return;
    // Streets only ever appear inside the sky picture's box, so nothing pops
    // in or out at the header and the readouts when the sky arrives.
    var g = frozenA ? frozenA.g : wrapGeom();
    ctx.save();
    ctx.beginPath(); ctx.rect(g.left, g.top, g.w, g.h); ctx.clip();
    drawTiles(P, refLon());
    ctx.font = '10px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(' + LOOK.road + ',0.7)';
    ctx.fillText(CREDIT, g.left + g.w - 8, g.top + 14);
    ctx.restore();
  }

  // Starpin's drawTiles: one tile's worth of the map, clipped to that tile so
  // neighbours' buffers never double up; a missing tile is stood in for by its
  // nearest cached ancestor, drawn once. The clip follows the tile's edges
  // point by point, because in the sky's projection they are curves.
  function drawTiles(P, ref) {
    if (!store) return;
    var F = SF(), drawn = {}, ls = lineScale;
    tileList.forEach(function (t) {
      var g = store.peek(t.z, t.x, t.y);
      if (!g || !g.bounds) return;
      var k = g.z + '/' + g.x + '/' + g.y;
      if (drawn[k]) return;
      drawn[k] = 1;
      var b = g.bounds, shift = F.wrapNear((b.w + b.e) / 2, ref) - (b.w + b.e) / 2;
      var edge = [], N = 8, i, ok = true;
      for (i = 0; i < N; i++) edge.push(P(b.n, b.w + (b.e - b.w) * i / N + shift));
      for (i = 0; i < N; i++) edge.push(P(b.n + (b.s - b.n) * i / N, b.e + shift));
      for (i = 0; i < N; i++) edge.push(P(b.s, b.e - (b.e - b.w) * i / N + shift));
      for (i = 0; i < N; i++) edge.push(P(b.s - (b.s - b.n) * i / N, b.w + shift));
      edge.forEach(function (p) { if (!p) ok = false; });
      if (!ok) return;
      ctx.save();
      ctx.beginPath();
      edge.forEach(function (p, j) { if (j) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      ctx.closePath(); ctx.clip();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      function path(pts, skip) {
        var on = false;
        for (var j = 0; j < pts.length; j++) {
          var p = P(pts[j][0], pts[j][1] + shift);
          if (!p) { on = false; continue; }
          if (!on || (skip && skip[j - 1])) { ctx.moveTo(p[0], p[1]); on = true; } else ctx.lineTo(p[0], p[1]);
        }
      }
      if (g.water && g.water.length) {
        ctx.beginPath(); g.water.forEach(function (wt) { path(wt.pts); });
        ctx.fillStyle = 'rgba(' + LOOK.water + ',0.09)'; ctx.fill('evenodd');
        ctx.beginPath(); g.water.forEach(function (wt) { path(wt.pts, wt.edge); });
        ctx.strokeStyle = 'rgba(' + LOOK.water + ',0.63)'; ctx.lineWidth = 1.1 * ls; ctx.setLineDash([]); ctx.stroke();
      }
      if (g.waterways && g.waterways.length) {
        [true, false].forEach(function (big) {
          ctx.beginPath(); g.waterways.forEach(function (wt) { if (wt.big === big) path(wt.pts); });
          ctx.strokeStyle = 'rgba(' + LOOK.water + ',' + (big ? 0.63 : 0.4) + ')';
          ctx.lineWidth = (big ? 1.5 : 0.8) * ls; ctx.stroke();
        });
      }
      if (g.borders && g.borders.length) {
        ctx.beginPath(); g.borders.forEach(function (wt) { path(wt.pts); });
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(' + LOOK.border + ',0.45)'; ctx.lineWidth = 1.1 * ls; ctx.stroke();
        ctx.setLineDash([]);
      }
      ['service', 'path', 'minor', 'major'].forEach(function (cls) {
        var st = ROADS[cls];
        ctx.beginPath();
        (g.roads || []).forEach(function (r) { if (r.cls === cls) path(r.pts); });
        ctx.setLineDash(st.dash || []);
        // A dark underlay holds a line over bright stars and bright ground.
        ctx.strokeStyle = 'rgba(' + LOOK.under + ',0.32)'; ctx.lineWidth = (st.w + 1.4) * ls; ctx.stroke();
        ctx.strokeStyle = 'rgba(' + LOOK.road + ',' + (st.a * 0.9) + ')'; ctx.lineWidth = st.w * ls; ctx.stroke();
      });
      ctx.setLineDash([]);
      ctx.restore();
    });
  }

  // The tiles covering a view of (lat, lon) at asp arcsec per pixel, the size
  // of box g. Same box arithmetic as Starpin's viewBox.
  function tilesFor(lat, lon, asp, g, z, margin) {
    var hx = asp * g.w / 2 / 3600 * 1.02, hy = asp * g.h / 2 / 3600 * 1.02;
    var cl = Math.max(0.05, Math.cos(lat * D2R));
    var box = { s: clamp(lat - hy, -85, 85), n: clamp(lat + hy, -85, 85),
                w: lon - Math.min(180, hx / cl), e: lon + Math.min(180, hx / cl) };
    return VT().tilesFor(box, z, margin || 0);
  }

  // Ask for the street tiles of a view, and wait (briefly) for them. Resolves
  // true if at least one is there to draw.
  function prepareTiles(lat, lon, asp, g, mapZoom) {
    if (!VT()) return Promise.resolve(false);
    store = store || VT().shared();
    var z = VT().tileZoomFor(mapZoom);
    var vis = tilesFor(lat, lon, asp, g, z, 0);
    tileList = tilesFor(lat, lon, asp, g, z, 1);
    if (tileList.length > 64) return Promise.resolve(false);       // a degenerate box
    tileList.forEach(function (t) { store.request(t.z, t.x, t.y); });
    if (!unsubTiles) unsubTiles = store.subscribe(function () { schedule(); });
    var t0 = Date.now();
    return new Promise(function (resolve) {
      (function poll() {
        // All of them: go. Some, after a short wait: go, and the rest draw as
        // they land. None: keep waiting a little longer (a busy page can
        // starve the fetches), then settle for a crossfade.
        var all = vis.every(function (t) { return store.has(t.z, t.x, t.y); });
        var some = vis.some(function (t) { return !!store.peek(t.z, t.x, t.y); });
        var el = Date.now() - t0;
        if (all || (some && el >= MS.tilesWait) || el >= MS.tilesGiveUp) return resolve(some);
        setTimeout(poll, 60);
      })();
    });
  }

  function turnCanvas(ms, cx) {
    cv.style.transformOrigin = cx + 'px 50%';
    cv.style.transition = 'none';
    cv.style.transform = 'perspective(1600px) rotateY(0deg)';
    void cv.offsetWidth;                         // commit the start state first
    cv.style.transition = 'transform ' + ms + 'ms ' + EASE;
    cv.style.transform = 'perspective(1600px) rotateY(180deg)';
    return wait(ms + 20).then(function () {
      cv.style.transition = 'none';
      cv.style.transform = 'none';
    });
  }

  // ── the map's own layers ──────────────────────────────────────────────────

  function mapPane() {
    var m = lmap();
    try { return m ? m.getPane('mapPane') : null; } catch (e) { return null; }
  }
  function darkenMapBg() {
    var m = mapEl();
    if (!m) return;
    if (savedBg === null) savedBg = m.style.background || '';
    m.style.background = BG;
  }
  function restoreMap() {
    var p = mapPane();
    if (p) { p.style.transition = ''; p.style.opacity = ''; }
    var m = mapEl();
    if (m && savedBg !== null) { m.style.background = savedBg; savedBg = null; }
  }

  // ── the sky ───────────────────────────────────────────────────────────────

  function host() { var sv = SV(); return sv && sv.getHost ? sv.getHost() : null; }

  function waitImagery(ms) {
    var sv = SV();
    if (!sv || sv.getRendererKind() === 'aladin') return Promise.resolve(true);
    // No WebGL2 (or no imagery module): nothing is coming, so do not wait.
    var Al = global.GeosonifySkyAladin;
    if (!Al || !Al.isAvailable || !Al.isAvailable()) return Promise.resolve(false);
    return new Promise(function (resolve) {
      var done = false, off = null;
      function finish(v) { if (done) return; done = true; if (off) off(); resolve(v); }
      off = sv.on ? sv.on('renderer', function () {
        if (sv.getRendererKind() === 'aladin') finish(true);
      }) : null;
      setTimeout(function () { finish(sv.getRendererKind() === 'aladin'); }, ms);
    });
  }

  // Past what the photography resolves, ease back out (only after a flip, and
  // only once: a deliberate deep link is left where it was put).
  function pullBackIfNeeded(withStreets) {
    var sv = SV();
    if (!anchor || anchor.pulled || !sv || !sv.isOpen() || sv.getRendererKind() !== 'aladin') return Promise.resolve();
    if (sv.isUserZoomed && sv.isUserZoomed()) return Promise.resolve();
    var a0 = affineAsp(liveAffine());
    anchor.pulled = true;
    if (!a0 || a0 >= FLOOR_ASP * 0.999) return Promise.resolve();
    return tween(reducedMotion() ? 0 : MS.pull, function (t) {
      var a = a0 * Math.pow(FLOOR_ASP / a0, ease(t));
      setSkyAsp(a, t < 1);
      // The streets shrink with the ground; thin them so they stay legible.
      lineScale = Math.max(0.4, Math.sqrt(a0 / a));
      if (withStreets) draw();
    }).then(function () { return frames(2); }).then(function () {
      setSkyAsp(FLOOR_ASP);
      return frames(2);
    }).then(function () {
      if (anchor) anchor.skyAsp = affineAsp(liveAffine()) || anchor.skyAsp;
      if (withStreets) draw();
    });
  }

  // When the photography arrives, keep the scale and the picture this module
  // set: the swap hands over a centre and a field as a REQUEST.
  //
  // Measured, and measured again a frame later: Aladin applies a new centre
  // to world2pix only once it has drawn, so a correction computed straight
  // after the swap can be read from the old view and land hundreds of pixels
  // out (seen in testing: 16 px off became 353 px off). And the swap can
  // change the layout (the imagery credit lengthens the header), which moves
  // the middle of the picture. So: wait for frames, then correct, then check.
  function onRendererSwap() {
    var sv = SV(), m = lmap();
    if (!sv || !sv.isOpen() || !anchor) return;
    var r0 = renderer();
    if (!r0) return;
    var c0 = r0.getCenter(), during = busy;
    var keepScale = !(sv.isUserZoomed && sv.isUserZoomed());
    function target() {
      var g = wrapGeom();
      // Mid-turn the sky must agree with the map under the same pixel; once
      // in the sky, keep what was in the middle of the picture there.
      if (during && m) { var ll = m.containerPointToLatLng([g.cx, g.cy]); return [ll.lat, ll.lng, g.cx, g.cy]; }
      return [c0[1], c0[0], g.cx, g.cy];
    }
    var rounds = 0;
    (function settle() {
      frames(2).then(function () {
        if (!sv.isOpen() || renderer() !== r0) return;
        var t = target();
        if (keepScale && lastSetAsp) setSkyAsp(lastSetAsp);
        pinSkyPoint(t[0], t[1], t[2], t[3]);
        schedule();
        return frames(2).then(function () {
          if (!sv.isOpen() || renderer() !== r0) return;
          var A = liveAffine(), t2 = target();
          var p = A ? skyProj(A)(t2[0], t2[1]) : null;
          var off = p ? Math.hypot(p[0] - t2[2], p[1] - t2[3]) : 0;
          var sc = (keepScale && lastSetAsp && A) ? Math.abs(affineAsp(A) / lastSetAsp - 1) : 0;
          if ((off > 0.5 || sc > 0.002) && ++rounds < 5) return settle();
          if (anchor && !anchor.pulled && A) anchor.skyAsp = affineAsp(A) || anchor.skyAsp;
          schedule();
          if (!busy && !tailActive) pullBackIfNeeded(false);
        });
      });
    })();
  }

  // ── the Starpin pointer ──────────────────────────────────────────────────

  function showStarpinHint() {
    var n = 0;
    try { n = parseInt(global.localStorage.getItem(HINT_KEY) || '0', 10) || 0; } catch (e) { return; }
    if (n >= HINT_MAX) return;
    try { global.localStorage.setItem(HINT_KEY, String(n + 1)); } catch (e) {}
    var sv = SV(), wrap = sv && sv.getCanvasWrap ? sv.getCanvasWrap() : null;
    if (!wrap) return;
    var box = document.createElement('div');
    box.className = 'gs-skyflip-hint';
    box.setAttribute('role', 'status');
    var text = document.createElement('span');
    text.textContent = 'Every street sits on its own patch of sky. To explore that further, try ';
    var a = document.createElement('a');
    a.href = STARPIN_URL; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = 'Starpin';
    text.appendChild(a);
    text.appendChild(document.createTextNode('.'));
    var x = document.createElement('button');
    x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Dismiss');
    box.appendChild(text); box.appendChild(x);
    wrap.appendChild(box);
    function gone() { box.style.opacity = '0'; setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 400); }
    x.onclick = function (ev) { ev.stopPropagation(); gone(); };
    box.addEventListener('click', function (ev) { ev.stopPropagation(); });
    void box.offsetWidth;
    box.style.opacity = '1';
    setTimeout(gone, 11000);
  }

  // ── up ────────────────────────────────────────────────────────────────────

  function canAnimate() {
    var m = mapEl();
    if (!m || !SF() || document.hidden) return false;
    if (m.offsetParent === null || !m.offsetWidth || !m.offsetHeight) return false;
    var r = m.getBoundingClientRect();
    return r.bottom > 0 && r.top < (global.innerHeight || 1e9);
  }

  function isAvailable() {
    var sv = SV();
    return !!(sv && sv.isAvailable && sv.isAvailable() && lmap());
  }

  function setBusy(on) {
    busy = on;
    if (mapBtn && mapBtn._btn) mapBtn._btn.disabled = !!on;
  }

  function toSky(o) {
    o = o || {};
    var sv = SV(), m = lmap(), F = SF();
    if (!isAvailable()) {
      if (global.showToast) global.showToast('Sky view could not load', 'error');
      return Promise.resolve(false);
    }
    if (busy) return Promise.resolve(false);
    if (sv.isOpen()) return Promise.resolve(true);

    var animate = !o.instant && canAnimate();
    if (!F) {                                  // no maths: the old way in
      return Promise.resolve(!!sv.open());
    }
    setBusy(true);
    cancelTail();

    var zoom = m.getZoom();
    var c0 = m.getCenter();
    if (!sv.open({ hidden: animate, centre: { ra: F.wrap360(c0.lng), dec: c0.lat },
                   fovDeg: 1, noRematch: true })) {
      setBusy(false);
      return Promise.resolve(false);
    }
    // Let the new view finish laying out first. The renderer reads its box
    // asynchronously (a ResizeObserver), and the readouts below it fill in on
    // the first draw; a scale set before that is a scale for the wrong box.
    return frames(2).then(function () { return upFromOpen(sv, m, F, zoom, animate); });
  }

  function frames(n) {
    return new Promise(function (resolve) {
      (function next(k) { if (k <= 0) return resolve(); global.requestAnimationFrame(function () { next(k - 1); }); })(n);
    });
  }

  function upFromOpen(sv, m, F, zoom, animate) {
    // The ground under the middle of the sky picture becomes the sky's centre,
    // at the map's own scale there.
    var g = wrapGeom();
    var ll = m.containerPointToLatLng([g.cx, g.cy]);
    var asp0 = F.aspForZoom(zoom, ll.lat);
    var r = renderer();
    if (r) r.setCenter(F.wrap360(ll.lng), ll.lat);
    fovCorrection = 1;
    setSkyAsp(asp0);
    pinSkyPoint(ll.lat, ll.lng, g.cx, g.cy);
    anchor = { earthZoom: zoom, earthAsp: asp0, skyAsp: affineAsp(liveAffine()) || asp0, pulled: false };

    if (!animate) {
      setBusy(false);
      return Promise.resolve(true);
    }

    var h = host();
    var fov = r ? r.getFovDeg() : 999;
    var tryTurn = !reducedMotion() && fov <= TURN_MAX_FOV_DEG && !!VT();
    ensureCanvas();
    cv.style.pointerEvents = 'auto';           // the map holds still while it turns
    var ready = tryTurn ? prepareTiles(ll.lat, ll.lng, asp0, g, zoom) : Promise.resolve(false);

    var tWait = Date.now();
    return ready.then(function (haveStreets) {
      lastUp = { tryTurn: tryTurn, haveStreets: haveStreets, fov: fov, waitMs: Date.now() - tWait };
      if (!haveStreets) return crossUp();
      mode = 'merc'; morphK = 0; frozenA = null; lineScale = 1;
      draw();
      darkenMapBg();
      fade(cv, 1, MS.crossIn);
      fade(mapPane(), 0, MS.crossIn);
      return tween(MS.crossIn, function (t) { mode = 'morph'; morphK = ease(t); draw(); })
        .then(function () {
          mode = 'ortho'; draw();
          return turnCanvas(MS.turn, g.cx);
        })
        .then(function () {
          mode = 'sky'; draw();                // the same pixels, now in the sky's projection
          cv.style.pointerEvents = 'none';
          fade(h, 1, MS.starsIn);
          if (h) h.style.pointerEvents = '';
          return wait(MS.starsIn + 10);
        })
        .then(function () {
          restoreMap();                        // behind the sky now; ready for the way back
          setBusy(false);
          runTail(true);
          return true;
        });
    }).catch(function (e) {
      console.warn('[geosonify] sky flip failed, showing the sky directly:', e && e.message);
      dropCanvas(); restoreMap();
      var hh = host(); if (hh) { hh.style.transition = ''; hh.style.opacity = '1'; hh.style.pointerEvents = ''; }
      setBusy(false);
      return true;
    });
  }

  // Too wide to turn, nothing to draw, or reduced motion: crossfade.
  function crossUp() {
    var h = host(), ms = reducedMotion() ? 200 : MS.cross;
    dropCanvas();
    darkenMapBg();
    fade(mapPane(), 0, ms);
    fade(h, 1, ms);
    if (h) h.style.pointerEvents = '';
    return wait(ms + 10).then(function () {
      restoreMap();
      setBusy(false);
      runTail(false);
      return true;
    });
  }

  // The end of the way up: wait for photography, pull back if needed, then let
  // the streets go. Cancellable, so "Earth" works at any point in it.
  function runTail(withStreets) {
    var my = ++tail;
    tailActive = true;
    function alive() { return my === tail; }
    var sv = SV();
    var offView = (withStreets && sv && sv.on) ? sv.on('view', schedule) : null;
    function end() {
      if (offView) { offView(); offView = null; }
      if (alive()) { tailActive = false; if (withStreets) dropCanvas(); }
    }
    waitImagery(MS.imageryWait)
      .then(function () { if (alive()) return pullBackIfNeeded(withStreets); })
      .then(function () { if (alive() && withStreets) return wait(MS.hold); })
      .then(function () {
        if (!alive()) return;
        if (!withStreets) return;
        showStarpinHint();
        fade(cv, 0, MS.streetsOut);
        return wait(MS.streetsOut + 20);
      })
      .then(end, end);
  }
  function cancelTail() {
    if (!tailActive) return;
    tail++;
    tailActive = false;
    dropCanvas();
  }

  // ── down ──────────────────────────────────────────────────────────────────

  function toEarth(o) {
    o = o || {};
    var sv = SV(), m = lmap(), F = SF();
    if (!sv || !sv.isOpen()) return Promise.resolve(true);
    if (busy) return Promise.resolve(false);
    if (peeking) { peeking = false; if (peekOff) { peekOff(); peekOff = null; } }
    cancelTail();
    var A = liveAffine();
    if (!A || !F || !m) { sv.close(); anchor = null; return Promise.resolve(true); }
    setBusy(true);

    // The ground under the middle of the picture (not the renderer's centre,
    // which need not be the middle) goes to the same pixel on the map.
    var s0 = affineAsp(A);
    var mid = pixelToSky(A, A.g.cx, A.g.cy);
    var lat = clamp(mid[1], -85, 85), lon = F.wrapNear(mid[0], m.getCenter().lng);
    // Where the ground should land: the zoom we left, changed only by the
    // person's own zoom in the sky. The zoom, not the scale: Web Mercator's
    // scale varies with latitude, and the middle of the picture can sit at a
    // slightly different latitude on the way back (the header can change
    // height when the imagery credit arrives), which turned a scale anchor
    // into a 1% zoom drift at continent scale.
    var userZoomed = !!(sv.isUserZoomed && sv.isUserZoomed());
    var want = (anchor && anchor.skyAsp > 0 && isFinite(anchor.earthZoom))
      ? anchor.earthZoom - (userZoomed ? Math.log(s0 / anchor.skyAsp) / Math.LN2 : 0)
      : F.zoomForAsp(s0, lat);
    var zoom = clamp(want, m.getMinZoom ? m.getMinZoom() : 0, m.getMaxZoom ? m.getMaxZoom() : 22);
    var target = F.aspForZoom(zoom, lat);
    var g = A.g;

    // The ground point at the middle of the sky picture goes to the same pixel
    // on the map, at an exact (fractional) zoom.
    function placeMap() {
      // Re-read the middle from the settled sky: a retrace scales about the
      // renderer's centre, which can sit a fraction of a pixel off the middle.
      var A2 = renderer() ? liveAffine() : null;
      if (A2) {
        var mm = pixelToSky(A2, A2.g.cx, A2.g.cy);
        lat = clamp(mm[1], -85, 85); lon = F.wrapNear(mm[0], m.getCenter().lng); g = A2.g;
      }
      var snap = m.options.zoomSnap;
      m.options.zoomSnap = 0;
      try {
        m.setView([lat, lon], zoom, { animate: false });
        var sz = m.getSize(), dx = g.cx - sz.x / 2, dy = g.cy - sz.y / 2;
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) m.panBy([-dx, -dy], { animate: false });
      } finally { m.options.zoomSnap = snap; }
    }
    function finish() {
      dropCanvas(); restoreMap();
      anchor = null;
      setBusy(false);
      return true;
    }

    var animate = !o.instant && canAnimate();
    if (!animate) {
      placeMap();
      sv.close({ skipZoomMatch: true });
      return Promise.resolve(finish());
    }

    var h = host();
    var fov = renderer() ? renderer().getFovDeg() : 999;
    var tryTurn = !reducedMotion() && fov <= TURN_MAX_FOV_DEG && !!VT();
    ensureCanvas();
    cv.style.pointerEvents = 'auto';
    var ready = tryTurn ? prepareTiles(lat, lon, target, g, zoom) : Promise.resolve(false);

    return ready.then(function (haveStreets) {
      if (!haveStreets) {
        var ms = reducedMotion() ? 200 : MS.cross;
        dropCanvas();
        placeMap();
        darkenMapBg();
        var p = mapPane();
        if (p) { p.style.transition = 'none'; p.style.opacity = '0'; void p.offsetWidth; }
        fade(h, 0, ms); fade(p, 1, ms);
        if (h) h.style.pointerEvents = 'none';
        return wait(ms + 10).then(function () { sv.close({ skipZoomMatch: true }); return finish(); });
      }
      mode = 'sky'; frozenA = null; lineScale = 1;
      draw();
      fade(cv, 1, MS.streetsInBack);
      var offView = sv.on ? sv.on('view', schedule) : null;
      // Retrace in the sky first, so the turn lands on exactly the map's scale.
      var retrace = Math.abs(target / s0 - 1) > 0.002
        ? tween(MS.retrace, function (t) { setSkyAsp(s0 * Math.pow(target / s0, ease(t)), t < 1); draw(); })
        : wait(MS.streetsInBack);
      // Aladin applies a change only once it has drawn: let it, before the
      // final measured match and before the projection is frozen.
      return retrace.then(function () { return frames(2); }).then(function () {
        setSkyAsp(target);
        return frames(2);
      }).then(function () {
        if (offView) offView();
        setSkyAsp(target);
        draw();
        // Ready the map behind everything, invisible, at the matching view.
        var p = mapPane();
        if (p) { p.style.transition = 'none'; p.style.opacity = '0'; }
        darkenMapBg();
        placeMap();
        if (h) h.style.pointerEvents = 'none';
        fade(h, 0, MS.skyOut);
        return wait(MS.skyOut + 10);
      }).then(function () {
        frozenA = liveAffine() || frozenA;     // keep the projection; the renderer is about to go
        sv.close({ skipZoomMatch: true });
        draw();
        return turnCanvas(MS.turn, frozenA ? frozenA.g.cx : g.cx);
      }).then(function () {
        mode = 'ortho'; draw();
        fade(mapPane(), 1, MS.earthIn);
        return tween(MS.earthIn, function (t) { mode = 'morph'; morphK = 1 - ease(t); draw(); });
      }).then(function () {
        mode = 'merc'; draw();
        cv.style.pointerEvents = 'none';
        fade(cv, 0, MS.streetsOutBack);
        return wait(MS.streetsOutBack + 10);
      }).then(finish);
    }).catch(function (e) {
      console.warn('[geosonify] earth flip failed, closing directly:', e && e.message);
      try { if (sv.isOpen()) { placeMap(); sv.close({ skipZoomMatch: true }); } } catch (e2) {}
      return finish();
    });
  }

  function flip() { var sv = SV(); return sv && sv.isOpen() ? toEarth() : toSky(); }

  // ── the button on the map ─────────────────────────────────────────────────

  var CSS_ID = 'gs-skyflip-css';
  var CSS = [
    '.gs-skyflip-btn{display:flex;align-items:center;gap:6px;height:34px;padding:0 13px 0 10px;',
    '  border:none;border-radius:17px;background:#0b0f19;color:#e5e7eb;cursor:pointer;',
    '  font:600 13px/1 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;',
    '  box-shadow:0 1px 5px rgba(0,0,0,.45);-webkit-tap-highlight-color:transparent}',
    '.gs-skyflip-btn svg{width:16px;height:16px;flex:none;color:#f2de5c}',
    '.gs-skyflip-btn:disabled{opacity:.6;cursor:default}',
    '.gs-skyflip-btn:focus-visible{outline:2px solid #93c5fd;outline-offset:2px}',
    '.gs-skyflip-hint{position:absolute;top:10px;left:54px;right:10px;z-index:11;display:flex;',
    '  gap:10px;align-items:flex-start;padding:8px 10px 8px 12px;border-radius:8px;',
    '  background:rgba(11,15,25,.88);border:1px solid #1f2937;color:#e5e7eb;',
    '  font:12.5px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;',
    '  opacity:0;transition:opacity .4s ease}',
    '.gs-skyflip-hint a{color:#f2de5c;font-weight:600}',
    '.gs-skyflip-hint button{flex:none;border:none;background:transparent;color:#94a3b8;',
    '  font-size:13px;line-height:1;padding:2px;cursor:pointer}',
    '@media (prefers-reduced-motion:reduce){.gs-skyflip-hint{transition:none}}'
  ].join('\n');
  var ICON_SKY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M10 2.5l1.9 5.6 5.6 1.9-5.6 1.9L10 17.5l-1.9-5.6L2.5 10l5.6-1.9z"/>' +
    '<circle cx="18.5" cy="17.5" r="1.6"/><circle cx="19" cy="5" r="1.1"/></svg>';

  function injectCss() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style');
    st.id = CSS_ID; st.textContent = CSS;
    document.head.appendChild(st);
  }

  // Warm the street tiles while a finger or pointer is on its way to the button.
  function prefetch() {
    var m = lmap(), F = SF();
    if (!m || !F || !VT() || busy) return;
    try {
      store = store || VT().shared();
      var sz = m.getSize(), c = m.getCenter();
      var g = { w: sz.x, h: sz.y };
      tilesFor(c.lat, c.lng, F.aspForZoom(m.getZoom(), c.lat), g, VT().tileZoomFor(m.getZoom()), 0)
        .slice(0, 32).forEach(function (t) { store.request(t.z, t.x, t.y); });
    } catch (e) {}
  }

  function isDisplayLink() {
    try { return /(?:^|[?&])display(?:[=&]|$)/.test(global.location.search || ''); }
    catch (e) { return false; }
  }

  function installMapButton() {
    var m = lmap(), L = global.L;
    if (mapBtn || !m || !L || !L.Control || isDisplayLink()) return !!mapBtn;
    injectCss();
    var Ctl = L.Control.extend({
      options: { position: 'bottomleft' },
      onAdd: function () {
        var b = L.DomUtil.create('button', 'gs-skyflip-btn');
        b.type = 'button';
        b.innerHTML = ICON_SKY + '<span>Sky</span>';
        b.title = 'Turn the map over and see the sky';
        b.setAttribute('aria-label', 'Sky: turn the map over and see the sky');
        L.DomEvent.disableClickPropagation(b);
        L.DomEvent.disableScrollPropagation(b);
        L.DomEvent.on(b, 'click', function (e) { L.DomEvent.stop(e); toSky(); });
        b.addEventListener('pointerenter', prefetch);
        b.addEventListener('touchstart', prefetch, { passive: true });
        this._btn = b;
        return b;
      }
    });
    mapBtn = new Ctl();
    mapBtn.addTo(m);
    return true;
  }
  function removeMapButton() {
    if (!mapBtn) return;
    try { mapBtn.remove(); } catch (e) {}
    mapBtn = null;
  }

  // ── Sky mode ──────────────────────────────────────────────────────────────
  //
  // Chosen in the FAQ tab's Map imagery panel. While it is on, the map carries
  // the Sky button (the sky view its Earth button) and the HEALPix lattice is
  // drawn on both faces. The normal map modes turn it off again, and that
  // also leaves the sky. A sky link (?frame=icrs, ?radec=) turns it on, since
  // it lands in the sky. Held in memory, like the basemap choice.
  var skyMode = false;
  function setSkyMode(on) {
    on = !!on;
    var sv = SV(), Lat = global.GeosonifyHealpixLattice;
    if (on === skyMode) { if (on) installWhenReady(); return skyMode; }
    skyMode = on;
    if (on) {
      installWhenReady();
    } else {
      removeMapButton();
      if (prefetchBound) { try { prefetchBound.off('moveend', prefetchOnMove); } catch (e) {} prefetchBound = null; }
      if (sv && sv.isOpen()) toEarth({ instant: true });
    }
    if (Lat && Lat.setEnabled) { try { Lat.setEnabled(on); } catch (e) {} }
    try { global.dispatchEvent(new CustomEvent('geosonify:skymode', { detail: { on: on } })); } catch (e) {}
    return skyMode;
  }
  // The map is created by the page's own start-up; wait for it if need be.
  var installTries = 0, prefetchBound = null;
  // In Sky mode a turn is likely, so the street tiles for wherever the map
  // settles are fetched ahead of it (only in Sky mode: elsewhere nobody
  // should pay for tiles they will not see).
  function prefetchOnMove() {
    var sv = SV();
    if (skyMode && !busy && !(sv && sv.isOpen())) prefetch();
  }
  function installWhenReady() {
    if (!skyMode) return;
    var m = lmap();
    if (m && prefetchBound !== m) { m.on('moveend', prefetchOnMove); prefetchBound = m; prefetch(); }
    if (installMapButton()) {
      var Lat = global.GeosonifyHealpixLattice;
      if (Lat && Lat.isEnabled && !Lat.isEnabled()) { try { Lat.setEnabled(true); } catch (e) {} }
      return;
    }
    if (++installTries > 120) return;
    setTimeout(installWhenReady, 250);
  }

  // ── hold Earth: the streets over the sky ─────────────────────────────────
  //
  // While the sky view's Earth button is held, the Earth's streets fade in
  // over the sky, in the sky's own projection (seen from below, so mirrored),
  // and fade out again on release. Same canvas and drawing as the turn.
  var peeking = false, peekOff = null;
  function peek(on) {
    var sv = SV(), F = SF();
    if (on) {
      if (busy || peeking || !sv || !sv.isOpen() || !F || !VT()) return false;
      cancelTail();
      var A = liveAffine();
      if (!A) return false;
      peeking = true;
      ensureCanvas();
      var mid = pixelToSky(A, A.g.cx, A.g.cy);
      var lat = clamp(mid[1], -85, 85), lon = F.wrapNear(mid[0], 0);
      var asp = affineAsp(A);
      var zoom = clamp(F.zoomForAsp(asp, lat), 0, 22);
      prepareTiles(lat, lon, asp, A.g, zoom);          // draws as tiles arrive
      mode = 'sky'; frozenA = null; lineScale = 1;
      draw();
      fade(cv, 1, reducedMotion() ? 0 : 260);
      if (peekOff) peekOff();
      peekOff = sv.on ? sv.on('view', schedule) : null;
      return true;
    }
    if (!peeking) return false;
    peeking = false;
    if (peekOff) { peekOff(); peekOff = null; }
    fade(cv, 0, reducedMotion() ? 0 : 320);
    setTimeout(function () { if (!peeking && !busy && !tailActive) dropCanvas(); }, 340);
    return true;
  }

  function boot() {
    var sv = SV();
    if (sv && sv.on) {
      sv.on('renderer', onRendererSwap);
      // However the sky opened (a link, the chip, the button), it is Sky mode.
      sv.on('open', function () { setSkyMode(true); });
      if (sv.isOpen && sv.isOpen()) setSkyMode(true);
    }
  }

  var API = {
    VERSION: VERSION,
    isAvailable: isAvailable,
    toSky: toSky,
    toEarth: toEarth,
    flip: flip,
    isBusy: function () { return busy; },
    setSkyMode: setSkyMode,
    isSkyMode: function () { return skyMode; },
    peek: peek,
    isPeeking: function () { return peeking; },
    STARPIN_URL: STARPIN_URL,
    _test: {
      anchor: function () { return anchor; },
      liveAffine: liveAffine,
      affineAsp: affineAsp,
      mode: function () { return mode; },
      project: function (lat, lon, asMode) {
        var keep = mode, keepK = morphK;
        if (asMode) { mode = asMode; if (asMode === 'morph') morphK = 0.5; }
        try { var P = projector(); return P ? P(lat, lon) : null; }
        finally { mode = keep; morphK = keepK; }
      },
      wrapGeom: wrapGeom,
      pinSkyPoint: pinSkyPoint,
      pixelToSky: pixelToSky,
      setTimings: function (o) { for (var k in o) if (k in MS) MS[k] = o[k]; },
      tileCount: function () { return tileList.length; },
      FLOOR_ASP: FLOOR_ASP,
      lastUp: function () { return lastUp; }
    }
  };
  global.GeosonifySkyFlip = API;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
