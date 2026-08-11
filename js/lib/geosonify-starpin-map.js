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
    // Kākāpō (Manu). Bark reads on a street map where moss would be lost in
    // parkland; yellow carries on aerial where bark would sink into soil.
    light:   { grid: '#775B24', highlight: '#CD8862', bagged: '#7D9D33',
               baggedRing: '#ffffff', you: '#CD8862', halo: '205,136,98',
               star: '#DCC949', starRing: '#4a3d08',
               under: 'rgba(255,255,255,.78)' },
    imagery: { grid: '#DCC949', highlight: '#CD8862', bagged: '#CED38C',
               baggedRing: '#1d2410', you: '#CED38C', halo: '206,211,140',
               star: '#ffffff', starRing: '#1b1b1b',
               under: 'rgba(0,0,0,.6)' }
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

  // THREE KNOBS, exposed on screen so the values can be found in the field and
  // then hard-coded here.
  //
  //   WEIGHT   overall multiplier
  //   FALLOFF  the ratio between one order and the next finer one
  //   PERSIST  how much extra a line gets for being coarser than the view
  //
  // The ramp is anchored to the VIEW, not to a fixed order. It used to hang off
  // REF_ORDER = 8, which meant orders 3 to 8 all computed 10-25 px, clipped to
  // the same cap, and drew as six identical fat lattices on top of each other —
  // fine at city scale where only one of them is in frame, an unreadable mess at
  // country scale where they all are.
  //
  // The quantity that actually matters is CELLS ACROSS THE VIEW. One cell across
  // means a rare boundary worth shouting about; forty means clutter. Because each
  // order doubles that number, log2 of it steps by exactly one per order, so the
  // geometric falloff survives — it just measures from the right place now, and
  // self-normalises at every zoom.
  var BASE_W = 3.0, BASE_A = 0.85;
  var WEIGHT = 1.1, FALLOFF = 0.50, PERSIST = 0.50;

  function num(v, dflt) { v = Number(v); return isFinite(v) ? v : dflt; }
  function setWeight(w) { WEIGHT = Math.max(0.3, Math.min(8, num(w, 1.1))); return WEIGHT; }
  function weight() { return WEIGHT; }
  function setFalloff(f) { FALLOFF = Math.max(0.5, Math.min(0.98, num(f, 0.5))); return FALLOFF; }
  function falloff() { return FALLOFF; }
  function setPersist(p) { PERSIST = Math.max(0, Math.min(1.5, num(p, 0.5))); return PERSIST; }
  function persist() { return PERSIST; }

  var MAX_W = 9, MIN_W = 0.45, MAX_ACROSS = 44;
  // Six orders coarser than the view is the practical floor. Beyond that a cell
  // is 64x the frame and its edge is almost never in it — and when it is, the
  // finer boundaries lying on top of it are drawn anyway, because a coarse
  // HEALPix edge IS also an edge at every finer order. Coincident passes stack,
  // so a genuinely rare boundary comes out heaviest without being special-cased.
  var MIN_ACROSS = 1 / 64;

  // spanM: the width of the view in metres.
  function strokeFor(order, spanM) {
    var across = (spanM || 1600) / cellWidthM(order);
    var lod = Math.log(Math.max(1, across)) / Math.LN2;      // 0 when it fills the view
    var w = BASE_W * WEIGHT * Math.pow(FALLOFF, lod);
    var a = BASE_A * Math.pow(FALLOFF, lod * 0.6);
    if (across < 1) {
      // Coarser than the view: at most a line or two, and the rarest on screen.
      var over = Math.min(3, Math.log(1 / across) / Math.LN2);
      var boost = 1 + PERSIST * over;
      w *= boost; a *= boost;
    }
    return {
      width: Math.min(MAX_W, w),
      alpha: Math.max(0.05, Math.min(0.95, a)),
      across: across,
      // Stop at a smudge, and stop before an order can only add clutter.
      visible: w >= MIN_W && across <= MAX_ACROSS && across >= MIN_ACROSS
    };
  }

  function dotRadius(order) {
    var t = Math.max(0, Math.min(1, (15 - order) / 9));
    return 3 + t * t * 11;
  }
  function orderOfName(name) {
    // The trailing cN is the corner, not an order digit. Without this the
    // regex missed entirely and every cornerstone silently drew as order 12.
    var m = /\.([0-3]+)(?:c[0-3])?$/.exec(String(name || ''));
    return m ? m[1].length : 12;
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

    var fix = null, bagged = [], finds = [], highlight = null, cache = {};
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

      for (var order = 0; order <= 20; order++) {
        var cw = cellWidthM(order);
        // No coarse skip: a cell 60x the view still has an edge that may run
        // straight through the street you are standing in, and that edge is
        // the rarest line on screen. strokeFor() is anchored to CELLS ACROSS
        // THE VIEW, so it already handles both ends and there is no second
        // boost to apply here.
        var st = strokeFor(order, spanM);
        if (st.across < MIN_ACROSS) continue;                 // too coarse to matter
        if (st.across > MAX_ACROSS || !st.visible) break;     // too fine to help
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

      // Starpins you have bagged, drawn from the LOG and therefore at every
      // zoom, everywhere. The VizieR star layer is a lookup around the current
      // view and stops entirely above an 8 km span, so before this a find in
      // Christchurch was invisible from a map of India, and a find you were
      // looking straight at was drawn identically to one you had never seen.
      // A collection you cannot see is not a collection.
      // Keyed on the source id, not the display name, because the lookup layer
      // and the log spell the same star differently ("Gaia DR3 5382..." vs
      // "starpin:gdr3:5382..."). S.sourceIdOf is the ONE helper for the
      // trailing digit run; do not open-code it, the naive \D strip turns
      // "Gaia DR3 5382" into "35382" and this bug has shipped three times.
      var found = {};
      finds.forEach(function (f) {
        var k = f.id || (S.sourceIdOf ? S.sourceIdOf(f.name) : null);
        if (k) found[k] = 1;
      });

      // Stars first, so a bagged cornerstone on the same spot sits on top.
      stars.forEach(function (st) {
        if (st.lat == null || st.lon == null) return;
        var stKey = st.id || (S.sourceIdOf ? S.sourceIdOf(st.name) : null);
        if (stKey && found[stKey]) return;              // drawn as a find below
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

      finds.forEach(function (f) {
        if (f.lat == null || f.lon == null) return;
        var xy = pt(f.lat, f.lon);
        if (xy[0] < -40 || xy[0] > size.x + 40 || xy[1] < -40 || xy[1] > size.y + 40) return;
        // Deliberately NOT scaled by magnitude. This dot answers "have I been
        // here", not "how bright is it", and at world zoom a faint find has to
        // stay as findable as a bright one.
        var r = 6;
        g.beginPath(); g.arc(xy[0], xy[1], r + 3, 0, 6.2832);
        g.fillStyle = 'rgba(' + pal.halo + ',.30)'; g.fill();
        g.beginPath(); g.arc(xy[0], xy[1], r, 0, 6.2832);
        g.fillStyle = pal.bagged; g.fill();
        g.lineWidth = 2; g.strokeStyle = pal.baggedRing; g.stroke();
        // The tick. A bagged starpin must not read as just another star.
        g.beginPath();
        g.moveTo(xy[0] - r * 0.45, xy[1]);
        g.lineTo(xy[0] - r * 0.1, xy[1] + r * 0.4);
        g.lineTo(xy[0] + r * 0.5, xy[1] - r * 0.45);
        g.lineWidth = 2; g.strokeStyle = pal.baggedRing;
        g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
        if (selected && selected.kind === 'star' && selected.id === f.id) {
          var fr = r + 6 + Math.sin(phase * 6.2832) * 5;
          g.beginPath(); g.arc(xy[0], xy[1], fr, 0, 6.2832);
          g.strokeStyle = pal.highlight; g.lineWidth = 2.5;
          g.globalAlpha = 0.35 + 0.5 * (1 - Math.abs(Math.sin(phase * 3.1416)));
          g.stroke(); g.globalAlpha = 1;
        }
        hits.push({ x: xy[0], y: xy[1], r: r + 12, kind: 'star',
                    data: f.star || { name: f.name, lat: f.lat, lon: f.lon } });
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
      // [{ id, name, lat, lon, star? }] — bagged starpins, from the log.
      setFinds: function (list) { finds = (list || []).slice(); redraw(); },
      finds: function () { return finds.slice(); },
      // Fit everything you have bagged, starpins and cornerstones together.
      // Returns how many points it found, so the caller can say something
      // useful when there are none.
      fitFinds: function (padPx) {
        var pts = [];
        finds.forEach(function (f) {
          if (f.lat != null && f.lon != null) pts.push([f.lat, f.lon]);
        });
        bagged.forEach(function (n) {
          var p = resolve(n); if (p) pts.push([p.lat, p.lon]);
        });
        if (!pts.length) return 0;
        if (pts.length === 1) { map.setView(pts[0], Math.min(17, map.getZoom())); return 1; }
        map.fitBounds(pts, { padding: [padPx || 28, padPx || 28] });
        return pts.length;
      },
      setStars: function (list) { stars = (list || []).slice(); redraw(); },
      clearPin: function () { pin = null; selected = null; redraw(); },
      dropPin: function (lat, lon) {
        pin = { lat: lat, lon: lon }; selected = { kind: 'pin', id: 'pin' }; redraw();
      },
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
           setPersist: setPersist, persist: persist };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpinMap;
