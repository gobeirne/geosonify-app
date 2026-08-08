/*
  geosonify-starpin-map.js v0.1 — the lattice map

  A map with NO BASEMAP. It draws the HEALPix grid, your fix, and the vertices
  you have bagged. Nothing else, and that is deliberate:

    - zero bytes of map data, so it works on a prepaid connection and offline,
      which is the whole Tier-0 argument;
    - the grid IS the terrain here. A basemap would be scenery behind the thing
      you actually came to see.

  Coarser orders are drawn bolder and finer orders fainter, so the hierarchy is
  legible at a glance: the thick lines are the rare cornerstones, the hairlines
  are the commonplace ones.

  Needs geosonify-healpix.js and geosonify-starpin.js.

      var map = GeosonifyStarpinMap.mount(el);
      map.setFix(lat, lon, accuracyM);
      map.setBagged(['V:f9.111202110020', ...]);   // from the log
      map.setHighlight('V:f9.111202110020');
      map.zoomTo(2000);                            // metres across
*/
'use strict';

var GeosonifyStarpinMap = (function () {

  var S = (typeof GeosonifyStarpin !== 'undefined') ? GeosonifyStarpin
        : (typeof require === 'function' ? require('./geosonify-starpin.js') : null);
  var H = (typeof HealpixGrids !== 'undefined') ? HealpixGrids
        : (typeof require === 'function' ? (function () {
            try { return require('./geosonify-healpix.js'); } catch (e) { return null; } })() : null);

  var M_PER_DEG = 111319.9, D2R = Math.PI / 180;
  var CSS_ID = 'starpin-map-css';

  var CSS = [
    '.spm{position:relative;width:100%;aspect-ratio:1;border-radius:12px;overflow:hidden;',
    '  border:1px solid var(--ios-separator,#C6C6C8);touch-action:none;',
    '  background:var(--ios-bg,#fff)}',
    '.spm canvas{display:block;width:100%;height:100%}',
    '.spm-hud{position:absolute;left:.5rem;bottom:.5rem;right:.5rem;display:flex;',
    '  justify-content:space-between;align-items:flex-end;pointer-events:none;',
    '  font-family:"SF Mono",ui-monospace,monospace;font-size:.62rem;',
    '  color:var(--ios-secondary,#3C3C43)}',
    '.spm-scale{border-left:1px solid currentColor;border-right:1px solid currentColor;',
    '  border-bottom:1px solid currentColor;padding:0 .25rem 1px;text-align:center}',
    '.spm-zoom{position:absolute;right:.5rem;top:.5rem;display:flex;flex-direction:column;gap:.25rem}',
    '.spm-zoom button{width:2rem;height:2rem;padding:0;border-radius:8px;font-size:1rem;',
    '  line-height:1;background:var(--ios-card,#fff);opacity:.92}'
  ].join('');

  // Zoom stops in metres across the viewport. Each roughly doubles, and the
  // set spans "the four corners of an order-12 cell" to "an order-8 cell".
  var STOPS = [200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200, 102400];

  function injectCss(doc) {
    if (doc.getElementById(CSS_ID)) return;
    var st = doc.createElement('style'); st.id = CSS_ID; st.textContent = CSS;
    doc.head.appendChild(st);
  }

  function cellWidthM(order) {
    return Math.sqrt(510.1e12 / (12 * Math.pow(4, order)));
  }

  // Coarse = bold and opaque. Fine = hairline and faint.
  function strokeFor(order) {
    var t = Math.max(0, Math.min(1, (16 - order) / 10));       // 0 at 16, 1 at 6
    return { width: 0.4 + t * t * 3.4, alpha: 0.10 + t * t * 0.72 };
  }
  function dotRadius(order) {
    var t = Math.max(0, Math.min(1, (15 - order) / 9));
    return 3 + t * t * 11;
  }

  function mount(container, opts) {
    if (!S || !H) throw new Error('starpin-map needs geosonify-healpix.js and geosonify-starpin.js');
    var doc = container.ownerDocument || document;
    injectCss(doc);
    opts = opts || {};

    var root = doc.createElement('div'); root.className = 'spm';
    var cv = doc.createElement('canvas');
    root.appendChild(cv);
    var hud = doc.createElement('div'); hud.className = 'spm-hud';
    var scale = doc.createElement('div'); scale.className = 'spm-scale';
    var orders = doc.createElement('div');
    hud.appendChild(scale); hud.appendChild(orders);
    root.appendChild(hud);

    var zoomBox = doc.createElement('div'); zoomBox.className = 'spm-zoom';
    var zin = doc.createElement('button'); zin.type = 'button'; zin.textContent = '+';
    zin.setAttribute('aria-label', 'zoom in');
    var zout = doc.createElement('button'); zout.type = 'button'; zout.textContent = '\u2212';
    zout.setAttribute('aria-label', 'zoom out');
    zoomBox.appendChild(zin); zoomBox.appendChild(zout);
    root.appendChild(zoomBox);
    container.appendChild(root);

    var fix = null, bagged = [], highlight = null, pointCache = {};
    var stop = 3, centre = null, panning = null;

    function resolve(name) {
      if (pointCache[name] !== undefined) return pointCache[name];
      var p = null;
      try { p = S.cornerstonePoint(name); } catch (e) { p = null; }
      // intrinsic order is the digit count of the address
      if (p) { var m = /\.([0-3]+)$/.exec(name); p.order = m ? m[1].length : 12; }
      pointCache[name] = p;
      return p;
    }

    // Local equirectangular about the centre. Good to a fraction of a pixel at
    // these scales, and it keeps the grid square, which is the point.
    function project(lat, lon, w, h, span) {
      var mpp = span / Math.min(w, h);
      return [w / 2 + (lon - centre.lon) * M_PER_DEG * Math.cos(centre.lat * D2R) / mpp,
              h / 2 - (lat - centre.lat) * M_PER_DEG / mpp];
    }
    function unproject(px, py, w, h, span) {
      var mpp = span / Math.min(w, h);
      return [centre.lat - (py - h / 2) * mpp / M_PER_DEG,
              centre.lon + (px - w / 2) * mpp / (M_PER_DEG * Math.cos(centre.lat * D2R))];
    }

    // Collect the cells of an order that intersect the viewport by sampling.
    // Sampling rather than neighbour-walking because it crosses HEALPix face
    // boundaries without any special cases.
    function cellsInView(order, w, h, span) {
      var cw = cellWidthM(order);
      var step = Math.max(2, Math.round(Math.min(w, h) / (span / (cw / 2.5))));
      var seen = {}, out = [];
      for (var px = -step; px <= w + step; px += step) {
        for (var py = -step; py <= h + step; py += step) {
          var ll = unproject(px, py, w, h, span);
          if (ll[0] > 89.9 || ll[0] < -89.9) continue;
          var ip;
          try { ip = H.nestIndex(ll[0], ll[1], order).toString(); } catch (e) { continue; }
          if (seen[ip]) continue;
          seen[ip] = 1; out.push(ip);
          if (out.length > 600) return out;                 // hard cap, keeps it responsive
        }
      }
      return out;
    }

    function draw() {
      var w = root.clientWidth || 320, h = root.clientHeight || 320;
      var dpr = (doc.defaultView.devicePixelRatio || 1);
      cv.width = w * dpr; cv.height = h * dpr;
      var g;
      try { g = cv.getContext('2d'); } catch (e) { return; }
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (!centre) return;

      var span = STOPS[stop];
      var ink = (opts.ink) || getComputedStyle(root).color || '#000';
      var drawn = [];

      // Grid, coarsest first so fine lines sit on top of thick ones.
      for (var order = 6; order <= 16; order++) {
        var cw = cellWidthM(order);
        if (cw > span * 3) continue;                        // too coarse to see
        if (cw < span / 26) break;                          // finer than useful
        var st = strokeFor(order);
        var nside = Math.pow(2, order);
        var cells = cellsInView(order, w, h, span);
        if (!cells.length) continue;
        drawn.push(order);
        g.lineWidth = st.width; g.globalAlpha = st.alpha; g.strokeStyle = ink;
        g.beginPath();
        for (var i = 0; i < cells.length; i++) {
          var ip = BigInt(cells[i]);
          var pts = [[0, 0], [1, 0], [1, 1], [0, 1]].map(function (uv) {
            var v = H._core.pixcoord2vec_nest(nside, ip, uv[0], uv[1]);
            var x = v.x != null ? v.x : v[0], y = v.y != null ? v.y : v[1],
                z = v.z != null ? v.z : v[2];
            return project(Math.asin(z / Math.hypot(x, y, z)) / D2R,
                           Math.atan2(y, x) / D2R, w, h, span);
          });
          g.moveTo(pts[0][0], pts[0][1]);
          for (var k = 1; k < 4; k++) g.lineTo(pts[k][0], pts[k][1]);
          g.closePath();
        }
        g.stroke();
      }
      g.globalAlpha = 1;

      // Bagged vertices: green, and bigger the rarer they are.
      bagged.forEach(function (name) {
        var p = resolve(name); if (!p) return;
        var xy = project(p.lat, p.lon, w, h, span);
        if (xy[0] < -40 || xy[0] > w + 40 || xy[1] < -40 || xy[1] > h + 40) return;
        var r = dotRadius(p.order);
        g.beginPath(); g.arc(xy[0], xy[1], r + 3, 0, 6.2832);
        g.fillStyle = 'rgba(81,128,106,.22)'; g.fill();
        g.beginPath(); g.arc(xy[0], xy[1], r, 0, 6.2832);
        g.fillStyle = '#51806a'; g.fill();
      });

      // The one you are heading for.
      if (highlight) {
        var hp = resolve(highlight);
        if (hp) {
          var hxy = project(hp.lat, hp.lon, w, h, span);
          g.strokeStyle = '#C582B2'; g.lineWidth = 2; g.globalAlpha = 1;
          g.beginPath(); g.arc(hxy[0], hxy[1], dotRadius(hp.order) + 7, 0, 6.2832); g.stroke();
        }
      }

      // You, with your actual uncertainty drawn to scale — not a dot that lies.
      if (fix) {
        var f = project(fix.lat, fix.lon, w, h, span);
        var mpp = span / Math.min(w, h);
        if (fix.accuracy_m) {
          g.beginPath(); g.arc(f[0], f[1], Math.max(3, fix.accuracy_m / mpp), 0, 6.2832);
          g.fillStyle = 'rgba(125,159,194,.25)'; g.fill();
        }
        g.beginPath(); g.arc(f[0], f[1], 5, 0, 6.2832);
        g.fillStyle = '#4d5f8e'; g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
      }

      // Scale bar: a round number of metres, sized to about a quarter of view.
      var target = span / 4, pow = Math.pow(10, Math.floor(Math.log(target) / Math.LN10));
      var nice = [1, 2, 5, 10].map(function (m) { return m * pow; })
                  .filter(function (v) { return v <= target * 1.6; }).pop() || pow;
      scale.style.width = (nice / span * Math.min(w, h)) + 'px';
      scale.textContent = nice < 1000 ? nice + ' m' : (nice / 1000) + ' km';
      orders.textContent = drawn.length ? 'orders ' + drawn[0] + '\u2013' + drawn[drawn.length - 1] : '';
    }

    // ── interaction ───────────────────────────────────────────────────────
    root.addEventListener('pointerdown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      panning = { x: e.clientX, y: e.clientY, lat: centre && centre.lat, lon: centre && centre.lon };
      try { root.setPointerCapture(e.pointerId); } catch (err) {}
    });
    root.addEventListener('pointermove', function (e) {
      if (!panning || !centre) return;
      var w = root.clientWidth, h = root.clientHeight, span = STOPS[stop];
      var mpp = span / Math.min(w, h);
      centre = {
        lat: panning.lat + (e.clientY - panning.y) * mpp / M_PER_DEG,
        lon: panning.lon - (e.clientX - panning.x) * mpp / (M_PER_DEG * Math.cos(panning.lat * D2R))
      };
      draw();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
      root.addEventListener(ev, function () { panning = null; });
    });
    zin.addEventListener('click', function () { stop = Math.max(0, stop - 1); draw(); });
    zout.addEventListener('click', function () { stop = Math.min(STOPS.length - 1, stop + 1); draw(); });

    try {
      new doc.defaultView.ResizeObserver(function () { draw(); }).observe(root);
    } catch (e) { doc.defaultView.addEventListener('resize', draw); }

    return {
      el: root,
      setFix: function (lat, lon, acc) {
        var first = !fix;
        fix = { lat: lat, lon: lon, accuracy_m: acc };
        if (first || !centre) centre = { lat: lat, lon: lon };
        draw();
      },
      recentre: function () { if (fix) { centre = { lat: fix.lat, lon: fix.lon }; draw(); } },
      setBagged: function (names) { bagged = (names || []).slice(); draw(); },
      setHighlight: function (n) { highlight = n || null; draw(); },
      zoomTo: function (metres) {
        var best = 0;
        STOPS.forEach(function (v, i) {
          if (Math.abs(v - metres) < Math.abs(STOPS[best] - metres)) best = i; });
        stop = best; draw();
      },
      span: function () { return STOPS[stop]; },
      redraw: draw,
      destroy: function () { if (root.parentNode) root.parentNode.removeChild(root); }
    };
  }

  return { VERSION: '0.1', mount: mount, cellWidthM: cellWidthM,
           strokeFor: strokeFor, dotRadius: dotRadius, STOPS: STOPS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpinMap;
