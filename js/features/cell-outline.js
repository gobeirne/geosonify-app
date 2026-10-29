/*
  geosonify cell outline  (&cell)

  A point link says "here". A cell link (the same link plus &cell) says "this
  whole cell": the area the code itself names, drawn as a shape. Useful for
  "tonight we're surveying this HEALPix cell", or "the find is somewhere in
  this square".

  ADDITIVE ONLY. Without &cell nothing here runs, and no existing link changes.

  THE CELL COMES FROM THE CODE, never from the receiver's card settings:
    - lat/lon grids (?a= ?e= ?h= ?bip= ?c= scale cards, custom z.…): depth =
      the code's own symbol count; the cell is the R×C subdivision box at that
      depth around the decoded centre (exact: subdivision is uniform from
      ±90 / ±180, so height = 180/R^d and width = 360/C^d).
    - HEALPix (?hphex= ?hpquad= ?hp64=): order = an explicit "@k", else the
      order the code's length implies — the same rule the share writer uses
      when it decides whether to append "@k" (withHealpixOrder). prepareDecode()
      sets the card to that order BEFORE the decode, so the decoded centre is
      the centre of THAT cell (otherwise a 9-char order-16 hphex code decodes
      at the receiver's stepper order, e.g. 22, into a corner sub-cell).
    - HEALPix words (?hpw<lang>[j]=): the word count; odd counts are the exact
      half cells HealpixWords traces.
  Not offered for GIS codes (external standards with their own precision
  rules), shapes, raw coordinates, or presentation cards (boards, swatches).

  Coordinates here are only for DRAWING at map scale, so the decoded doubles
  are enough; nothing is re-encoded from them.

  Public: GeosonifyCell.supports(gridDef), prepareDecode(gridKey, code, cardState),
  show(gridKey, code, lat, lon, opts), clear(), info(), isOn().
*/
(function (global) {
  'use strict';

  // Same sphere as HealpixGrids.cellAreaM2 (mean Earth surface area), so a
  // lat/lon cell and a HEALPix cell of the same place report comparable areas.
  var EARTH_AREA_M2 = 5.10072e14;
  var SKY_STROKE = '#ffd400';

  var state = null;   // { gridKey, kind, depth, lat, lon, ring, areaM2, layer, skyId }

  function grids() {
    return global.CARD_GRIDS || null;   // card-renderer.js publishes its registry here
  }
  function HG() { try { return (typeof HealpixGrids !== 'undefined') ? HealpixGrids : null; } catch (e) { return null; } }
  function HW() { try { return (typeof HealpixWords !== 'undefined') ? HealpixWords : null; } catch (e) { return null; } }
  function theMap() {
    if (global.__geosonifyMap) return global.__geosonifyMap;
    try { if (typeof MapManager !== 'undefined' && MapManager.getMap) return MapManager.getMap(); } catch (e) {}
    return null;
  }
  function kindOf(gd) {
    if (!gd) return null;
    if (gd.chessOf || gd.chromaOf || gd.gis || gd.dynamicIterations) return null;
    if (gd.hpwords) return 'hpwords';
    if (gd.healpix) return 'healpix';
    if (Array.isArray(gd.grid) && gd.grid.length && Array.isArray(gd.grid[0])) return 'grid';
    return null;
  }
  function supports(gd) { return !!kindOf(gd); }

  // Symbol count of a lat/lon-grid code, read exactly as the URL path reads it
  // (layer-1 shuffled grid; deobfuscated first; grouping hyphens and word
  // delimiters stripped). null if it cannot be tokenised.
  function gridDepth(gridKey, gd, code, obf) {
    try {
      if (gd.fixedIterations) return gd.fixedIterations;
      var c = String(code);
      if (typeof CardRenderer !== 'undefined' && CardRenderer.normaliseGroupedInput) c = CardRenderer.normaliseGroupedInput(gd, c);
      if (gd.prefixLength && c.indexOf('.') >= 0) c = c.split('.')[0];          // BIP39 checksum word
      var sh = CardRenderer.getShuffledGrid(gridKey, '');
      var flat = (sh && sh.grid ? sh.grid : gd.grid).flat();
      if (gd.delimiter) {
        var parts = c.split(gd.delimiter).filter(Boolean);
        if (gd.prefixLength) {
          // Prefix-matched words: count the words that resolve.
          var ok = parts.filter(function (w) {
            var p = w.slice(0, gd.prefixLength).toLowerCase();
            return flat.some(function (f) { return String(f).toLowerCase().slice(0, gd.prefixLength) === p; });
          });
          return ok.length === parts.length ? parts.length : null;
        }
        c = parts.join('');
      }
      if (obf && typeof GeoCodec !== 'undefined' && GeoCodec.applyObfuscation) c = GeoCodec.applyObfuscation('decode', c, flat);
      var t = (typeof GeoCodec !== 'undefined' && GeoCodec.tokenizeCode) ? GeoCodec.tokenizeCode(c, flat) : null;
      if (!t || !t.length) return null;
      var n = t.length;
      // GeoCodec.decodeHierarchical stops at 20 symbols on the no-passphrase path,
      // so the decoded centre is the 20-symbol cell's: draw that cell.
      var pass = (typeof CardRenderer !== 'undefined' && CardRenderer.getPassphrase) ? CardRenderer.getPassphrase() : '';
      if (!pass && n > 20) n = 20;
      return n;
    } catch (e) { return null; }
  }

  /*
    Call BEFORE decoding a &cell link. HEALPix: put the card at the code's own
    order so the decode lands on that cell (a lat/lon-grid decode already reads
    every symbol, so those cards are left as the URL path sets them). Only ever
    called for &cell links.
  */
  function prepareDecode(gridKey, code, cardState) {
    var G = grids(), gd = G && G[gridKey], kind = kindOf(gd);
    if (!kind || !cardState || !cardState.iterations) return;
    try {
      if (kind === 'healpix' && HG()) {
        var k = HG().inferOrder(gd.healpix, String(code).trim());
        if (k) cardState.iterations[gridKey] = k;
      }
    } catch (e) {}
  }

  function rectRing(gd, depth, lat, lon) {
    var R = gd.grid.length, C = gd.grid[0].length;
    var h = 180 / Math.pow(R, depth), w = 360 / Math.pow(C, depth);
    var s = Math.max(-90, lat - h / 2), n = Math.min(90, lat + h / 2);
    var west = lon - w / 2, east = lon + w / 2;
    // Edges are parallels and meridians, straight on the map; densify the
    // parallels only for very wide cells so the sky view (great circles) follows them.
    var steps = w > 10 ? Math.ceil(w / 2) : 1, ring = [], i;
    for (i = 0; i <= steps; i++) ring.push([s, west + (east - west) * i / steps]);
    for (i = 0; i <= steps; i++) ring.push([n, east - (east - west) * i / steps]);
    ring.push(ring[0].slice());
    var area = EARTH_AREA_M2 / (4 * Math.PI) * (w * Math.PI / 180) *
      (Math.sin(n * Math.PI / 180) - Math.sin(s * Math.PI / 180));
    return { ring: ring, areaM2: area };
  }

  function compute(gridKey, code, lat, lon, opts) {
    var G = grids(), gd = G && G[gridKey], kind = kindOf(gd);
    if (!kind || !isFinite(lat) || !isFinite(lon)) return null;
    var depth, ring = null, area = null;
    if (kind === 'grid') {
      depth = gridDepth(gridKey, gd, code, opts && opts.obf);
      if (!depth) return null;
      var r = rectRing(gd, depth, lat, lon);
      ring = r.ring; area = r.areaM2;
    } else if (kind === 'healpix') {
      var H = HG(); if (!H) return null;
      depth = (opts && opts.order) || H.inferOrder(gd.healpix, String(code).trim());
      ring = H.cellCorners(gd.healpix, lat, lon, depth, depth < 6 ? 48 : 18);
      area = H.cellAreaM2(depth);
    } else if (kind === 'hpwords') {
      var W = HW(); if (!W) return null;
      depth = opts && opts.words;
      if (!depth) return null;
      ring = W.ringAt(lat, lon, depth, 18);
      var m = W.cellMetres(depth); area = m.w * m.h;
    }
    if (!ring || ring.length < 4) return null;
    return { gridKey: gridKey, kind: kind, depth: depth, lat: lat, lon: lon, ring: ring, areaM2: area };
  }

  function colour() {
    try { if (typeof MapManager !== 'undefined' && MapManager.getShapeColor) return MapManager.getShapeColor(); } catch (e) {}
    return 'purple';
  }

  function drawMap() {
    var m = theMap();
    if (!m || !state || typeof L === 'undefined') return;
    if (state.layer) { try { m.removeLayer(state.layer); } catch (e) {} }
    var c = colour();
    state.layer = L.polygon(state.ring, {
      color: c, fillColor: c, weight: 2.5, opacity: 0.95, fillOpacity: 0.15,
      interactive: false, className: 'geosonify-cell-outline'
    }).addTo(m);
  }

  function drawSky() {
    var SV = (typeof GeosonifySkyView !== 'undefined') ? GeosonifySkyView : null;
    if (!SV || !SV.addShape || !state) return;
    try {
      var verts = state.ring.map(function (p) { return [p[0], ((p[1] % 360) + 360) % 360]; });
      state.skyId = SV.addShape({ type: 'path', vertices: verts, stroke: SKY_STROKE, strokeWidth: 2, fromMap: true });
      if (SV.frameOn) SV.frameOn(verts, { pad: 5 }); else if (SV.redraw) SV.redraw();
    } catch (e) { console.warn('[geosonify] cell outline on the sky:', e); }
  }

  /*
    Draw the cell. opts: { obf, order, words, sky, fit }.
    fit (default true): frame the cell on the map.
  */
  function show(gridKey, code, lat, lon, opts) {
    opts = opts || {};
    clear();
    var c = compute(gridKey, code, lat, lon, opts);
    if (!c) { console.warn('[geosonify] &cell: no cell for this code', gridKey, code); return null; }
    state = c;
    drawMap();
    var m = theMap();
    if (m && opts.fit !== false && state.layer) {
      try { m.fitBounds(state.layer.getBounds(), { padding: [40, 40] }); } catch (e) {}
    }
    if (opts.sky) setTimeout(drawSky, 450);   // after openSkyAt (300 ms) has opened the view
    return info();
  }

  function clear() {
    if (!state) return;
    var m = theMap();
    if (state.layer && m) { try { m.removeLayer(state.layer); } catch (e) {} }
    state = null;
  }

  function info() {
    return state ? { gridKey: state.gridKey, kind: state.kind, depth: state.depth,
      lat: state.lat, lon: state.lon, ring: state.ring.map(function (p) { return p.slice(); }),
      areaM2: state.areaM2 } : null;
  }

  // The outline belongs to the place the link named: once the point moves
  // (map tap, drag, typed code), it goes. Re-stamping the same point keeps it.
  function watch() {
    try {
      if (typeof AppState === 'undefined' || !AppState.subscribe) return;
      AppState.subscribe('coordinate', function (c) {
        if (!state || !c) return;
        if (Math.abs(c.lat - state.lat) > 1e-9 || Math.abs(c.lon - state.lon) > 1e-9) clear();
      });
    } catch (e) {}
  }
  // New imagery: recolour (purple on light maps, yellow on aerial), after
  // MapManager has switched its own colour.
  try {
    global.addEventListener('geosonify:basemap', function () { setTimeout(function () { if (state) drawMap(); }, 0); });
  } catch (e) {}
  if (global.document && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();

  global.GeosonifyCell = {
    supports: supports,
    prepareDecode: prepareDecode,
    compute: compute,
    show: show,
    clear: clear,
    info: info,
    isOn: function () { return !!state; }
  };
})(typeof window !== 'undefined' ? window : this);
