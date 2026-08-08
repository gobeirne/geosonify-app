/*
  geosonify-starpin-map.js v0.2 — the lattice over a real map

  v0.1 drew the HEALPix grid on a blank canvas and called it "the terrain".
  That was a cop-out: you cannot walk in a straight line across a river, a
  motorway or somebody's paddock, and a map implying you can is unsafe as well
  as unhelpful. This version puts the lattice over OSM, Esri topo or Esri
  aerial exactly as Geosonify does, and keeps a canvas overlay only for the
  grid itself.

  Providers and the contrast convention come straight from map-manager.js so
  the two products agree:

     osm / topo   light maps    -> purple grid, pink highlight
     aerial       dark imagery  -> vivid yellow grid, cyan highlight
                  (purple and blue both sink into aerial photography)

  Coarse orders are drawn boldest, because those are the rare cornerstones;
  hairlines are the commonplace ones. Every line also gets a contrasting halo
  underneath so the grid survives a busy street map and a noisy aerial alike.

  Needs Leaflet, geosonify-healpix.js and geosonify-starpin.js.

      var map = GeosonifyStarpinMap.mount(el);
      map.setFix(lat, lon, accuracyM);
      map.setBagged(names); map.setHighlight(name);
      map.setBasemap('aerial');
*/
'use strict';

var GeosonifyStarpinMap = (function () {

  var S = (typeof GeosonifyStarpin !== 'undefined') ? GeosonifyStarpin
        : (typeof require === 'function' ? (function () {
            try { return require('./geosonify-starpin.js'); } catch (e) { return null; } })() : null);
  var HP = (typeof HealpixGrids !== 'undefined') ? HealpixGrids
        : (typeof require === 'function' ? (function () {
            try { return require('./geosonify-healpix.js'); } catch (e) { return null; } })() : null);

  var D2R = Math.PI / 180;
  var CSS_ID = 'starpin-map-css';

  // Lifted from map-manager.js so a Starpin map and a Geosonify map match.
  var BASEMAPS = {
    osm: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
           attrib: '\u00A9 OpenStreetMap contributors', imagery: false, label: 'map' },
    topo: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
            attrib: '\u00A9 Esri \u2014 World Topographic Map', imagery: false, label: 'topo' },
    aerial: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
              attrib: 'Imagery \u00A9 Esri, Maxar, Earthstar Geographics', imagery: true, label: 'aerial' }
  };

  // Green stays green in both palettes so "bagged" never changes meaning; on
  // imagery it just brightens and takes a dark outline so it holds against
  // foliage.
  var PALETTE = {
    light:   { grid: '#8e44ad', highlight: '#C582B2', bagged: '#1f7a4d',
               baggedRing: '#ffffff', you: '#4d5f8e', halo: '125,159,194',
               star: '#f4b400', starRing: '#5a3d00',
               under: 'rgba(255,255,255,.75)' },
    imagery: { grid: '#ffd400', highlight: '#00e5ff', bagged: '#3ddc84',
               baggedRing: '#0b1f14', you: '#00e5ff', halo: '0,229,255',
               star: '#ffffff', starRing: '#1b1b1b',
               under: 'rgba(0,0,0,.55)' }
  };

  var CSS = [
    '.spm{position:relative;width:100%;height:min(80vw,360px);border-radius:12px;',
    '  overflow:hidden;border:1px solid var(--ios-separator,#C6C6C8);background:#dcdcdc}',
    '.spm-pane{position:absolute;inset:0}',
    '.spm-bm{position:absolute;right:.5rem;top:.5rem;z-index:600;display:flex;gap:.25rem}',
    '.spm-bm button{font:inherit;font-size:.7rem;padding:.3rem .55rem;border-radius:7px;',
    '  border:1px solid rgba(0,0,0,.25);background:rgba(255,255,255,.93);color:#222;',
    '  cursor:pointer;width:auto}',
    '.spm-bm button[aria-pressed="true"]{background:#325756;color:#fff;border-color:#325756}',
    '.spm-orders{position:absolute;left:.5rem;bottom:1.5rem;z-index:600;pointer-events:none;',
    '  font-family:"SF Mono",ui-monospace,monospace;font-size:.6rem;padding:.15rem .4rem;',
    '  border-radius:5px;background:rgba(255,255,255,.82);color:#333}'
  ].join('');

  function injectCss(doc) {
    if (doc.getElementById(CSS_ID)) return;
    var st = doc.createElement('style'); st.id = CSS_ID; st.textContent = CSS;
    doc.head.appendChild(st);
  }

  function cellWidthM(order) { return Math.sqrt(510.1e12 / (12 * Math.pow(4, order))); }

  // TWO KNOBS, exposed on screen so the right values can be found in the field
  // and then hard-coded here.
  //
  //   WEIGHT   overall multiplier
  //   FALLOFF  the ratio between one order and the next finer one
  //
  // The old ramp was base + t^2, and its floor swamped everything: orders 14
  // through 17 all came out between 0.50 and 0.64 px, which is why 12 and 13
  // were indistinguishable from the hairlines below them. A GEOMETRIC ramp
  // gives every adjacent pair the same visible ratio, so the hierarchy reads
  // at any depth. Alpha falls with it, because thin AND faint separates far
  // better than thin alone.
  var REF_ORDER = 8, BASE_W = 3.0, BASE_A = 0.85;
  var WEIGHT = 2.0, FALLOFF = 0.75;

  // PERSIST: how strongly a coarse line keeps its authority when you zoom in.
  //
  // A cell far larger than the view is a RARE boundary, and at close zoom its
  // edge is the most valuable line on the screen — yet it renders identically
  // to the hairlines around it, so it vanishes. This boosts a line in
  // proportion to how much bigger its cell is than the view, which is exactly
  // the thing that makes it worth noticing.
  var PERSIST = 0.30;
  function setPersist(p) { PERSIST = Math.max(0, Math.min(1.5, Number(p))); return PERSIST; }
  function persist() { return PERSIST; }

  // rel = cellWidth / viewWidth. 1 means the cell fills the view.
  function zoomBoost(rel) {
    if (!(rel > 1)) return 1;
    return 1 + PERSIST * (Math.log(Math.min(rel, 512)) / Math.LN2);
  }

  function setWeight(w) { WEIGHT = Math.max(0.3, Math.min(8, Number(w) || 1)); return WEIGHT; }
  function weight() { return WEIGHT; }
  function setFalloff(f) { FALLOFF = Math.max(0.5, Math.min(0.98, Number(f) || 0.78)); return FALLOFF; }
  function falloff() { return FALLOFF; }

  function strokeFor(order) {
    var k = Math.pow(FALLOFF, order - REF_ORDER);
    return {
      width: Math.max(0.25, BASE_W * k * WEIGHT),
      alpha: Math.max(0.05, Math.min(0.95, BASE_A * Math.pow(FALLOFF, (order - REF_ORDER) * 0.6))),
      rawWidth: BASE_W * Math.pow(FALLOFF, order - REF_ORDER) * WEIGHT,
      // Below this the line is a smudge and only adds clutter, so the draw
      // loop stops. FALLOFF therefore controls DEPTH as well as contrast:
      // one knob, two jobs, and they are the same judgement.
      visible: BASE_W * k * WEIGHT >= 0.45
    };
  }
  function dotRadius(order) {
    var t = Math.max(0, Math.min(1, (15 - order) / 9));
    return 3 + t * t * 11;
  }
  function orderOfName(name) {
    var m = /\.([0-3]+)$/.exec(String(name || '')); return m ? m[1].length : 12;
  }

  function mount(container, opts) {
    if (typeof L === 'undefined') throw new Error('starpin-map v0.2 needs Leaflet');
    if (!S || !HP) throw new Error('starpin-map needs geosonify-healpix.js and geosonify-starpin.js');
    var doc = container.ownerDocument || document;
    injectCss(doc);
    opts = opts || {};

    var root = doc.createElement('div'); root.className = 'spm';
    var pane = doc.createElement('div'); pane.className = 'spm-pane';
    root.appendChild(pane);
    container.appendChild(root);

    var map = L.map(pane, { zoomControl: true, maxZoom: 22 })
                .setView([opts.lat != null ? opts.lat : 0,
                          opts.lon != null ? opts.lon : 0], opts.zoom || 16);

    var key = (opts.basemap && BASEMAPS[opts.basemap]) ? opts.basemap : 'osm';
    var tiles = null, btns = {};

    function applyBasemap(k) {
      key = BASEMAPS[k] ? k : 'osm';
      if (tiles) map.removeLayer(tiles);
      tiles = L.tileLayer(BASEMAPS[key].url, {
        attribution: BASEMAPS[key].attrib, maxNativeZoom: 19, maxZoom: 22
      }).addTo(map);
      Object.keys(btns).forEach(function (b) {
        btns[b].setAttribute('aria-pressed', b === key ? 'true' : 'false');
      });
      redraw();
    }

    var bar = doc.createElement('div'); bar.className = 'spm-bm';
    Object.keys(BASEMAPS).forEach(function (k) {
      var b = doc.createElement('button');
      b.type = 'button'; b.textContent = BASEMAPS[k].label;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function (e) { e.stopPropagation(); applyBasemap(k); });
      btns[k] = b; bar.appendChild(b);
    });
    root.appendChild(bar);
    var orderTag = doc.createElement('div'); orderTag.className = 'spm-orders';
    root.appendChild(orderTag);

    var fix = null, bagged = [], highlight = null, cache = {};
    var stars = [], hits = [];          // hits: screen-space targets for tapping
    var pin = null;                     // a read-only probe, never a claim
    var selected = null;                // {kind, id} -> gets the throb
    var phase = 0, throbTimer = null;
    var onSelect = opts.onSelect || null;
    var onMove = opts.onMove || null;

    function resolve(name) {
      if (cache[name] !== undefined) return cache[name];
      var p = null;
      try { p = S.cornerstonePoint(name); } catch (e) { p = null; }
      if (p) p.order = orderOfName(name);
      cache[name] = p; return p;
    }

    // Cells of an order intersecting the view, found by sampling the viewport.
    // Sampling rather than neighbour-walking because it crosses HEALPix face
    // boundaries with no special cases.
    function cellsInView(order, size, spanM) {
      var cw = cellWidthM(order);
      var step = Math.max(3, Math.round(size.x / (spanM / (cw / 2.5))));
      var seen = {}, out = [];
      for (var px = -step; px <= size.x + step; px += step) {
        for (var py = -step; py <= size.y + step; py += step) {
          var ll = map.containerPointToLatLng([px, py]);
          if (ll.lat > 89.9 || ll.lat < -89.9) continue;
          var ip;
          try { ip = HP.nestIndex(ll.lat, ll.lng, order).toString(); } catch (e) { continue; }
          if (seen[ip]) continue;
          seen[ip] = 1; out.push(ip);
          if (out.length > 700) return out;                  // cap: stay responsive
        }
      }
      return out;
    }

    function draw(cv) {
      if (!cv || !map) return;
      var size = map.getSize();
      var dpr = doc.defaultView.devicePixelRatio || 1;
      cv.width = size.x * dpr; cv.height = size.y * dpr;
      cv.style.width = size.x + 'px'; cv.style.height = size.y + 'px';
      L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));

      var g; try { g = cv.getContext('2d'); } catch (e) { return; }
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size.x, size.y);

      var pal = PALETTE[BASEMAPS[key].imagery ? 'imagery' : 'light'];
      var b = map.getBounds();
      var spanM = map.distance(b.getNorthWest(), b.getNorthEast()) || 1000;
      var mpp = spanM / size.x;
      var drawn = [];

      function pt(lat, lon) { var p = map.latLngToContainerPoint([lat, lon]); return [p.x, p.y]; }

      for (var order = 3; order <= 18; order++) {
        var cw = cellWidthM(order);
        // No coarse skip. A cell 60x the view still has an edge that may run
        // straight through the street you are standing in, and that edge is
        // the rarest line on screen. Dropping it was the bug.
        if (cw < spanM / 26) break;
        var st = strokeFor(order);
        if (!st.visible) break;
        // Width grows sub-linearly and is capped: a coarse line should be
        // unmistakable, not a stripe that hides the street you navigate by.
        // Most of the emphasis goes into opacity, which costs no map.
        var boost = zoomBoost(cw / spanM);
        st = { width: Math.min(9, st.width * (1 + (boost - 1) * 0.45)),
               alpha: Math.min(0.95, st.alpha * boost) };
        var cells = cellsInView(order, size, spanM);
        if (!cells.length) continue;
        drawn.push(order);
        var nside = Math.pow(2, order);

        // Halo first, then the line, so the grid holds on any basemap.
        [[pal.under, st.width + 1.8, st.alpha * 0.85], [pal.grid, st.width, st.alpha]]
        .forEach(function (layer) {
          g.strokeStyle = layer[0]; g.lineWidth = layer[1]; g.globalAlpha = layer[2];
          g.beginPath();
          // Edges are subdivided, not drawn corner to corner. A HEALPix edge
          // bows by about 3 m over a 25 km order-8 cell — invisible when the
          // whole cell is on screen, but at street zoom that same edge is the
          // only line in view and 3 m is metres of pavement.
          var segs = Math.max(1, Math.min(24, Math.round(4 * Math.min(8, cw / spanM) + 1)));
          for (var i = 0; i < cells.length; i++) {
            var ip = BigInt(cells[i]);
            var first = null, started = false;
            for (var e = 0; e < 4; e++) {
              for (var t = 0; t < segs; t++) {
                var f = t / segs;
                var uv = e === 0 ? [f, 0] : e === 1 ? [1, f]
                       : e === 2 ? [1 - f, 1] : [0, 1 - f];
                var v = HP._core.pixcoord2vec_nest(nside, ip, uv[0], uv[1]);
                var x = v.x != null ? v.x : v[0], y = v.y != null ? v.y : v[1],
                    z = v.z != null ? v.z : v[2];
                var q = pt(Math.asin(z / Math.hypot(x, y, z)) / D2R, Math.atan2(y, x) / D2R);
                if (!started) { g.moveTo(q[0], q[1]); first = q; started = true; }
                else g.lineTo(q[0], q[1]);
              }
            }
            if (first) g.lineTo(first[0], first[1]);
          }
          g.stroke();
        });
      }
      g.globalAlpha = 1;

      hits = [];

      // Stars first, so a bagged cornerstone on the same spot sits on top.
      stars.forEach(function (st) {
        if (st.lat == null || st.lon == null) return;
        var xy = pt(st.lat, st.lon);
        if (xy[0] < -30 || xy[0] > size.x + 30 || xy[1] < -30 || xy[1] > size.y + 30) return;
        // Brighter stars draw bigger. Magnitude runs backwards, hence the flip.
        var m = (st.mag == null) ? 14 : st.mag;
        var r = Math.max(3, 9 - (m - 6) * 0.5);
        g.beginPath(); g.arc(xy[0], xy[1], r + 2.5, 0, 6.2832);
        g.fillStyle = 'rgba(' + pal.halo + ',.30)'; g.fill();
        g.beginPath(); g.arc(xy[0], xy[1], r, 0, 6.2832);
        g.fillStyle = pal.star; g.fill();
        g.lineWidth = 1.5; g.strokeStyle = pal.starRing; g.stroke();
        var sid = st.name || (st.ra + ',' + st.dec);
        if (selected && selected.kind === 'star' && selected.id === sid) {
          var pulseR = r + 6 + Math.sin(phase * 6.2832) * 5;
          g.beginPath(); g.arc(xy[0], xy[1], pulseR, 0, 6.2832);
          g.strokeStyle = pal.highlight; g.lineWidth = 2.5;
          g.globalAlpha = 0.35 + 0.5 * (1 - Math.abs(Math.sin(phase * 3.1416)));
          g.stroke(); g.globalAlpha = 1;
        }
        hits.push({ x: xy[0], y: xy[1], r: r + 10, kind: 'star', data: st });
      });

      bagged.forEach(function (name) {
        var p = resolve(name); if (!p) return;
        var xy = pt(p.lat, p.lon);
        if (xy[0] < -40 || xy[0] > size.x + 40 || xy[1] < -40 || xy[1] > size.y + 40) return;
        var r = dotRadius(p.order);
        g.beginPath(); g.arc(xy[0], xy[1], r, 0, 6.2832);
        g.fillStyle = pal.bagged; g.fill();
        g.lineWidth = 2; g.strokeStyle = pal.baggedRing; g.stroke();
        if (selected && selected.kind === 'cornerstone' && selected.id === name) {
          var pr = r + 6 + Math.sin(phase * 6.2832) * 5;
          g.beginPath(); g.arc(xy[0], xy[1], pr, 0, 6.2832);
          g.strokeStyle = pal.highlight; g.lineWidth = 2.5;
          g.globalAlpha = 0.35 + 0.5 * (1 - Math.abs(Math.sin(phase * 3.1416)));
          g.stroke(); g.globalAlpha = 1;
        }
        hits.push({ x: xy[0], y: xy[1], r: r + 12, kind: 'cornerstone',
                    data: { name: name, lat: p.lat, lon: p.lon, order: p.order } });
      });

      if (highlight) {
        var hp = resolve(highlight);
        if (hp) {
          var h = pt(hp.lat, hp.lon);
          g.strokeStyle = pal.highlight; g.lineWidth = 2.5;
          g.beginPath(); g.arc(h[0], h[1], dotRadius(hp.order) + 8, 0, 6.2832); g.stroke();
          g.beginPath();
          g.moveTo(h[0] - 6, h[1]); g.lineTo(h[0] + 6, h[1]);
          g.moveTo(h[0], h[1] - 6); g.lineTo(h[0], h[1] + 6);
          g.stroke();
        }
      }

      // You, with your real uncertainty drawn to scale rather than a dot that lies.
      if (fix) {
        var f = pt(fix.lat, fix.lon);
        if (fix.accuracy_m) {
          g.beginPath(); g.arc(f[0], f[1], Math.max(3, fix.accuracy_m / mpp), 0, 6.2832);
          g.fillStyle = 'rgba(' + pal.halo + ',.22)'; g.fill();
          g.strokeStyle = 'rgba(' + pal.halo + ',.65)'; g.lineWidth = 1; g.stroke();
        }
        g.beginPath(); g.arc(f[0], f[1], 5.5, 0, 6.2832);
        g.fillStyle = pal.you; g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
      }

      if (pin) {
        var q = pt(pin.lat, pin.lon);
        g.strokeStyle = pal.highlight; g.lineWidth = 2;
        g.beginPath(); g.arc(q[0], q[1], 7, 0, 6.2832); g.stroke();
        g.beginPath();
        g.moveTo(q[0], q[1] + 7); g.lineTo(q[0], q[1] + 17);
        g.moveTo(q[0] - 11, q[1]); g.lineTo(q[0] - 4, q[1]);
        g.moveTo(q[0] + 4, q[1]); g.lineTo(q[0] + 11, q[1]);
        g.stroke();
      }

      orderTag.textContent = drawn.length
        ? 'HEALPix orders ' + drawn[0] + '\u2013' + drawn[drawn.length - 1] : '';
    }

    var GridLayer = L.Layer.extend({
      onAdd: function (m) {
        this._cv = L.DomUtil.create('canvas', 'leaflet-zoom-animated');
        this._cv.style.pointerEvents = 'none';
        m.getPanes().overlayPane.appendChild(this._cv);
        m.on('moveend zoomend resize', this._render, this);
        if (m.options.zoomAnimation && L.Browser.any3d) m.on('zoomanim', this._animateZoom, this);
        this._render();
      },
      onRemove: function (m) {
        m.off('moveend zoomend resize', this._render, this);
        m.off('zoomanim', this._animateZoom, this);
        if (this._cv.parentNode) this._cv.parentNode.removeChild(this._cv);
      },
      _animateZoom: function (e) {
        var s = this._map.getZoomScale(e.zoom);
        var o = this._map._latLngBoundsToNewLayerBounds(this._map.getBounds(), e.zoom, e.center).min;
        L.DomUtil.setTransform(this._cv, o, s);
      },
      _render: function () { draw(this._cv); }
    });
    var grid = new GridLayer().addTo(map);
    function redraw() { if (grid && grid._render) grid._render(); }

    function throb() {
      phase = (Date.now() % 1400) / 1400;
      if (selected) redraw();
      throbTimer = setTimeout(throb, selected ? 90 : 400);
    }
    throb();

    map.on('click', function (e) {
      var p = e.containerPoint, best = null, bestD = Infinity;
      hits.forEach(function (h) {
        var d = Math.hypot(h.x - p.x, h.y - p.y);
        if (d <= h.r && d < bestD) { bestD = d; best = h; }
      });
      if (best) {
        selected = { kind: best.kind, id: best.kind === 'star'
          ? (best.data.name || best.data.ra + ',' + best.data.dec) : best.data.name };
        pin = null;
      } else {
        // Empty ground: drop a READ-ONLY pin. Reading what a place is worth is
        // not the same act as claiming it, and must never be confused with one.
        pin = { lat: e.latlng.lat, lon: e.latlng.lng };
        selected = { kind: 'pin', id: 'pin' };
      }
      redraw();
      if (onSelect) onSelect(best ? { kind: best.kind, data: best.data }
                                  : { kind: 'pin', data: pin });
    });
    map.on('moveend zoomend', function () {
      if (onMove) {
        var c = map.getCenter(), b = map.getBounds();
        onMove(c.lat, c.lng, map.distance(b.getNorthWest(), b.getNorthEast()));
      }
    });

    applyBasemap(key);
    setTimeout(function () { map.invalidateSize(); redraw(); }, 60);

    return {
      el: root, leaflet: map,
      setFix: function (lat, lon, acc) {
        var first = !fix;
        fix = { lat: lat, lon: lon, accuracy_m: acc };
        if (first) map.setView([lat, lon], Math.max(map.getZoom(), 17));
        redraw();
      },
      recentre: function () { if (fix) map.setView([fix.lat, fix.lon], map.getZoom()); },
      setBagged: function (n) { bagged = (n || []).slice(); redraw(); },
      setStars: function (list) { stars = (list || []).slice(); redraw(); },
      clearPin: function () { pin = null; selected = null; redraw(); },
      pin: function () { return pin; },
      stars: function () { return stars.slice(); },
      setWeight: function (w) { setWeight(w); redraw(); return weight(); },
      weight: weight,
      setFalloff: function (f) { setFalloff(f); redraw(); return falloff(); },
      falloff: falloff,
      setPersist: function (p) { setPersist(p); redraw(); return persist(); },
      persist: persist,
      centre: function () { var c = map.getCenter(); return { lat: c.lat, lon: c.lng }; },
      spanM: function () {
        var b = map.getBounds(); return map.distance(b.getNorthWest(), b.getNorthEast());
      },
      setHighlight: function (n) { highlight = n || null; redraw(); },
      setBasemap: applyBasemap,
      basemap: function () { return key; },
      invalidate: function () { map.invalidateSize(); redraw(); },
      redraw: redraw,
      destroy: function () {
        if (throbTimer) clearTimeout(throbTimer);
        map.remove(); if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  return { VERSION: '0.3', mount: mount, BASEMAPS: BASEMAPS, PALETTE: PALETTE,
           cellWidthM: cellWidthM, strokeFor: strokeFor, dotRadius: dotRadius,
           orderOfName: orderOfName, setWeight: setWeight, weight: weight,
           setFalloff: setFalloff, falloff: falloff,
           setPersist: setPersist, persist: persist, zoomBoost: zoomBoost };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpinMap;
