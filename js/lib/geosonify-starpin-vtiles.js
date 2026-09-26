/*
  geosonify-starpin-vtiles.js v0.1 — the ground's own map, as vector tiles

  Browser: window.GeosonifyStarpinTiles.   Node: require('./geosonify-starpin-vtiles.js')

  WHY TILES AND NOT OVERPASS
  --------------------------
  Asking Overpass for "every street in this box" on each pan is asking a
  database to be a map server, and it choked. Vector tiles are made for this:
  each zoom level carries its own generalised detail (coasts, rivers and
  borders at world scale; main roads at region scale; every street and
  footpath at z14), and each tile is a small fixed file that caches.

  The source is OpenFreeMap (OpenMapTiles schema, OpenStreetMap data): no key,
  no registration, no request limits -- and it runs on donations with no CDN
  in front, so this module is a good citizen about it:

    * only the tiles in view plus a one-tile margin, at the one zoom that fits;
    * nothing fetched twice while it is in memory (an LRU of decoded tiles);
    * everything fetched is kept on the device (Cache Storage) for 30 days,
      keyed by z/x/y rather than by the weekly planet build, so hanging around
      home costs nothing after the first visit and survives a patchy signal;
    * at most four requests in flight;
    * while a tile loads, its nearest cached ancestor stands in for it.

  THE DECODER IS OURS
  -------------------
  Mapbox Vector Tile is a small protobuf. Decoding it is ~120 lines, cheaper
  than loading a map library, and the self-test holds it to @mapbox/vector-tile
  on the same bytes. Geometry leaves this module as lat/lon, so the caller can
  project it any way it likes -- Web Mercator on the ground, the sky's own
  projection when looking up.
*/
'use strict';

var GeosonifyStarpinTiles = (function () {

  var root = (typeof window !== 'undefined') ? window : {};
  var TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
  var MAX_Z = 14;
  var STORE = 'starpin-vtiles-v1';
  var KEEP_DAYS = 30;

  // ── protobuf ──────────────────────────────────────────────────────────────
  function Reader(buf) { this.b = buf; this.p = 0; }
  Reader.prototype.varint = function () {
    var b = this.b, x = 0, s = 1, c;
    do { c = b[this.p++]; x += (c & 0x7f) * s; s *= 128; } while (c >= 0x80);
    return x;
  };
  Reader.prototype.skip = function (wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.p += 8;
    else if (wire === 2) this.p += this.varint();
    else if (wire === 5) this.p += 4;
    else throw new Error('vtiles: unsupported wire type ' + wire);
  };
  Reader.prototype.bytes = function () { var n = this.varint(), s = this.p; this.p += n; return this.b.subarray(s, s + n); };
  var utf8 = (typeof TextDecoder !== 'undefined') ? new TextDecoder('utf-8') : null;
  function str(bytes) {
    if (utf8) return utf8.decode(bytes);
    var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s;
  }
  function zz(n) { return (n % 2) ? -(n + 1) / 2 : n / 2; }

  function readValue(bytes) {
    var r = new Reader(bytes), v = null, dv;
    while (r.p < bytes.length) {
      var t = r.varint(), f = t >> 3, w = t & 7;
      if (f === 1) v = str(r.bytes());
      else if (f === 2) { dv = new DataView(bytes.buffer, bytes.byteOffset + r.p, 4); v = dv.getFloat32(0, true); r.p += 4; }
      else if (f === 3) { dv = new DataView(bytes.buffer, bytes.byteOffset + r.p, 8); v = dv.getFloat64(0, true); r.p += 8; }
      else if (f === 4 || f === 5) v = r.varint();
      else if (f === 6) v = zz(r.varint());
      else if (f === 7) v = !!r.varint();
      else r.skip(w);
    }
    return v;
  }

  // Geometry command stream -> rings of [x, y] in tile units.
  function readGeometry(bytes) {
    var r = new Reader(bytes), x = 0, y = 0, rings = [], cur = null;
    while (r.p < bytes.length) {
      var ci = r.varint(), cmd = ci & 7, n = ci >> 3;
      if (cmd === 1 || cmd === 2) {
        for (var k = 0; k < n; k++) {
          x += zz(r.varint()); y += zz(r.varint());
          if (cmd === 1) { cur = []; rings.push(cur); }
          cur.push([x, y]);
        }
      } else if (cmd === 7) {
        if (cur && cur.length) cur.push([cur[0][0], cur[0][1]]);
      } else break;
    }
    return rings;
  }

  // Tile bytes -> { layerName: { extent, features: [{ type, props, rings }] } }.
  // Only the named layers are decoded; the rest are skipped unread.
  function decode(buf, wanted) {
    var r = new Reader(buf), out = {};
    while (r.p < buf.length) {
      var t = r.varint(), f = t >> 3, w = t & 7;
      if (f !== 3 || w !== 2) { r.skip(w); continue; }
      var lb = r.bytes(), lr = new Reader(lb);
      var name = null, extent = 4096, keys = [], vals = [], feats = [];
      while (lr.p < lb.length) {
        var lt = lr.varint(), lf = lt >> 3, lw = lt & 7;
        if (lf === 1) name = str(lr.bytes());
        else if (lf === 2) feats.push(lr.bytes());
        else if (lf === 3) keys.push(str(lr.bytes()));
        else if (lf === 4) vals.push(readValue(lr.bytes()));
        else if (lf === 5) extent = lr.varint();
        else lr.skip(lw);
      }
      if (wanted && wanted.indexOf(name) < 0) continue;
      var list = [];
      for (var i = 0; i < feats.length; i++) {
        var fr = new Reader(feats[i]), type = 0, tags = null, geom = null;
        while (fr.p < feats[i].length) {
          var ft = fr.varint(), ff = ft >> 3, fw = ft & 7;
          if (ff === 2) { var tb = fr.bytes(), tr = new Reader(tb); tags = []; while (tr.p < tb.length) tags.push(tr.varint()); }
          else if (ff === 3) type = fr.varint();
          else if (ff === 4) geom = fr.bytes();
          else fr.skip(fw);
        }
        var props = {};
        if (tags) for (var j = 0; j + 1 < tags.length; j += 2) props[keys[tags[j]]] = vals[tags[j + 1]];
        list.push({ type: type, props: props, rings: geom ? readGeometry(geom) : [] });
      }
      out[name] = { extent: extent, features: list };
    }
    return out;
  }

  // ── tile maths (Web Mercator XYZ) ───────────────────────────────────────────
  var D2R = Math.PI / 180;
  function lon2x(lon, z) { return (lon + 180) / 360 * Math.pow(2, z); }
  function lat2y(lat, z) {
    var l = Math.max(-85.05112878, Math.min(85.05112878, lat)) * D2R;
    return (1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2 * Math.pow(2, z);
  }
  function x2lon(x, z) { return x / Math.pow(2, z) * 360 - 180; }
  function y2lat(y, z) { var n = Math.PI * (1 - 2 * y / Math.pow(2, z)); return Math.atan(Math.sinh(n)) / D2R; }
  function tileBounds(z, x, y) {
    return { w: x2lon(x, z), e: x2lon(x + 1, z), n: y2lat(y, z), s: y2lat(y + 1, z) };
  }
  // Tiles covering [s,w,n,e] at zoom z, plus `margin` tiles each way. x may run
  // past the world's edge; wrapX() folds it for fetching, not for placing.
  function tilesFor(box, z, margin) {
    margin = margin || 0;
    var n = Math.pow(2, z);
    var x0 = Math.floor(lon2x(box.w, z)) - margin, x1 = Math.floor(lon2x(box.e, z)) + margin;
    var y0 = Math.max(0, Math.floor(lat2y(box.n, z)) - margin), y1 = Math.min(n - 1, Math.floor(lat2y(box.s, z)) + margin);
    if (x1 - x0 + 1 > n) { x0 = 0; x1 = n - 1; }
    var out = [];
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) out.push({ z: z, x: x, y: y });
    return out;
  }
  function wrapX(x, z) { var n = Math.pow(2, z); return ((x % n) + n) % n; }
  // The vector-tile zoom for a view: tiles are drawn at 512 px, the map counts
  // 256 px tiles, so one level below the map's zoom -- never past the source's max.
  function tileZoomFor(mapZoom) { return Math.max(0, Math.min(MAX_Z, Math.round(mapZoom) - 1)); }

  // ── schema: OpenMapTiles layers -> what we draw ─────────────────────────────
  var LAYERS = ['water', 'waterway', 'boundary', 'transportation'];
  var ROAD = {
    motorway: 'major', trunk: 'major', primary: 'major', secondary: 'major', tertiary: 'major',
    minor: 'minor', residential: 'minor', unclassified: 'minor', living_street: 'minor', pedestrian: 'minor',
    busway: 'minor', service: 'service', track: 'path', path: 'path', footway: 'path', cycleway: 'path',
    bridleway: 'path', steps: 'path'
  };
  function roadClass(props) {
    var c = String((props && props['class']) || '').replace(/_construction$/, '');
    return ROAD[c] || null;                        // rail, ferry, aerialway, raceway: not walkable ground
  }

  // Decoded tile -> geometry in lat/lon, grouped for drawing and for reach.
  // A polygon edge lying ALONG a tile edge is an artefact of cutting the world
  // into tiles, not a coastline; such segments are marked so they are never
  // stroked (they are still filled, clipped to the tile).
  function toGeo(dec, z, x, y) {
    var out = { roads: [], waterways: [], borders: [], water: [] };
    function conv(L) {
      var ext = L.extent, n = Math.pow(2, z);
      return function (p) {
        var fx = x + p[0] / ext, fy = y + p[1] / ext;
        return [y2lat(fy, z), fx / n * 360 - 180];
      };
    }
    function bbox(pts) {
      var s = 90, w = 1e9, nn = -90, e = -1e9;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        if (p[0] < s) s = p[0]; if (p[0] > nn) nn = p[0]; if (p[1] < w) w = p[1]; if (p[1] > e) e = p[1];
      }
      return [s, w, nn, e];
    }
    var L;
    if ((L = dec.transportation)) {
      var cT = conv(L);
      L.features.forEach(function (f) {
        var cls = roadClass(f.props);
        if (!cls || f.type !== 2) return;
        f.rings.forEach(function (r) {
          if (r.length < 2) return;
          var pts = r.map(cT);
          out.roads.push({ cls: cls, pts: pts, bb: bbox(pts) });
        });
      });
    }
    if ((L = dec.waterway)) {
      var cW = conv(L);
      L.features.forEach(function (f) {
        if (f.type !== 2) return;
        var big = /^(river|canal)$/.test(String(f.props['class'] || ''));
        f.rings.forEach(function (r) { if (r.length > 1) out.waterways.push({ big: big, pts: r.map(cW) }); });
      });
    }
    if ((L = dec.boundary)) {
      var cB = conv(L);
      L.features.forEach(function (f) {
        if (f.type !== 2 || f.props.maritime == 1) return;          // coasts already draw the sea's edge
        var lvl = Number(f.props.admin_level);
        if (!(lvl <= 4)) return;                                     // countries and states only
        f.rings.forEach(function (r) { if (r.length > 1) out.borders.push({ level: lvl, pts: r.map(cB) }); });
      });
    }
    if ((L = dec.water)) {
      var cWa = conv(L), ext = L.extent;
      L.features.forEach(function (f) {
        if (f.type !== 3) return;
        f.rings.forEach(function (r) {
          if (r.length < 3) return;
          var edge = [];
          for (var i = 0; i + 1 < r.length; i++) edge.push(onTileEdge(r[i], r[i + 1], ext));
          out.water.push({ pts: r.map(cWa), edge: edge });
        });
      });
    }
    return out;
  }
  // Both ends on the same side of the tile's box (or beyond it, in the buffer):
  // a cut made by tiling, not a shore. A corner belongs to two sides at once.
  function onTileEdge(a, b, ext) {
    return (a[0] <= 0 && b[0] <= 0) || (a[0] >= ext && b[0] >= ext) ||
           (a[1] <= 0 && b[1] <= 0) || (a[1] >= ext && b[1] >= ext);
  }

  // ── the cache and the fetch queue ───────────────────────────────────────────
  function createStore(opts) {
    opts = opts || {};
    var win = opts.window || root;
    var fetchFn = opts.fetch || (win.fetch ? win.fetch.bind(win) : null);
    var mem = new Map(), MEM_MAX = opts.memMax || 400;
    var inflight = {}, queue = [], active = 0, MAX_ACTIVE = 4;
    var template = opts.template || null, templateP = null;
    var onTile = opts.onTile || function () {};
    var stats = { network: 0, device: 0, memory: 0, failed: 0 };
    var cachesApi = (opts.caches !== undefined) ? opts.caches : (win.caches || null);

    function key(z, x, y) { return z + '/' + x + '/' + y; }
    function touch(k, v) { mem.delete(k); mem.set(k, v); while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value); }

    function getTemplate() {
      if (template) return Promise.resolve(template);
      if (templateP) return templateP;
      try {
        var saved = JSON.parse(win.localStorage.getItem('starpin.vtiles.template') || 'null');
        if (saved && saved.url && Date.now() - saved.at < 864e5) { template = saved.url; return Promise.resolve(template); }
      } catch (e) {}
      templateP = fetchFn(opts.tilejson || TILEJSON_URL).then(function (r) { return r.json(); }).then(function (tj) {
        template = tj.tiles[0];
        try { win.localStorage.setItem('starpin.vtiles.template', JSON.stringify({ url: template, at: Date.now() })); } catch (e) {}
        return template;
      }).catch(function (e) { templateP = null; throw e; });
      return templateP;
    }

    // Some tile hosts store gzip and serve it without saying so.
    function inflate(buf) {
      var u8 = new Uint8Array(buf);
      if (u8[0] !== 0x1f || u8[1] !== 0x8b || !win.DecompressionStream) return Promise.resolve(u8);
      var ds = new win.Response(new win.Blob([u8]).stream().pipeThrough(new win.DecompressionStream('gzip')));
      return ds.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }

    function deviceGet(k) {
      if (!cachesApi) return Promise.resolve(null);
      return cachesApi.open(STORE).then(function (c) { return c.match('https://starpin.local/vt/' + k); })
        .then(function (r) {
          if (!r) return null;
          var at = Number(r.headers.get('x-fetched') || 0);
          if (Date.now() - at > KEEP_DAYS * 864e5) return null;       // stale: fetch again
          return r.arrayBuffer();
        }).catch(function () { return null; });
    }
    function devicePut(k, buf) {
      if (!cachesApi) return;
      cachesApi.open(STORE).then(function (c) {
        return c.put('https://starpin.local/vt/' + k, new win.Response(buf, { headers: { 'x-fetched': String(Date.now()) } }));
      }).catch(function () {});
    }

    function pump() {
      while (active < MAX_ACTIVE && queue.length) {
        var job = queue.shift();
        active++;
        job().then(function () { active--; pump(); }, function () { active--; pump(); });
      }
    }

    // Ask for a tile. Returns the decoded geometry if it is in memory now,
    // otherwise null -- and it arrives later through onTile(z, x, y).
    function request(z, x, y) {
      var xw = wrapX(x, z), k = key(z, xw, y);
      if (mem.has(k)) { var v = mem.get(k); touch(k, v); return v; }
      if (inflight[k]) return null;
      inflight[k] = true;
      queue.push(function () {
        return deviceGet(k).then(function (buf) {
          if (buf) { stats.device++; return buf; }
          return getTemplate().then(function (tpl) {
            var url = tpl.replace('{z}', z).replace('{x}', xw).replace('{y}', y);
            return fetchFn(url).then(function (r) {
              if (r.status === 204 || r.status === 404) return new ArrayBuffer(0);   // empty ocean, off the edge
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.arrayBuffer();
            }).then(function (b) { stats.network++; devicePut(k, b); return b; });
          });
        }).then(inflate).then(function (u8) {
          var geo = u8.length ? toGeo(decode(u8, LAYERS), z, xw, y) : { roads: [], waterways: [], borders: [], water: [] };
          geo.z = z; geo.x = xw; geo.y = y; geo.bounds = tileBounds(z, xw, y);
          touch(k, geo);
          delete inflight[k];
          onTile(z, xw, y, geo);
        }).catch(function () { stats.failed++; delete inflight[k]; });
      });
      pump();
      return null;
    }
    // In memory only: the tile, or its nearest cached ancestor (up to 5 levels).
    function peek(z, x, y) {
      var xw = wrapX(x, z), v = mem.get(key(z, xw, y));
      if (v) return v;
      for (var d = 1; d <= 5 && z - d >= 0; d++) {
        var a = mem.get(key(z - d, xw >> d, y >> d));
        if (a) return a;
      }
      return null;
    }
    function has(z, x, y) { return mem.has(key(z, wrapX(x, z), y)); }
    function clearDevice() { return cachesApi ? cachesApi.delete(STORE) : Promise.resolve(false); }

    return { request: request, peek: peek, has: has, stats: stats, clearDevice: clearDevice,
             _mem: mem };
  }

  return {
    VERSION: '0.1', TILEJSON_URL: TILEJSON_URL, MAX_Z: MAX_Z, LAYERS: LAYERS,
    decode: decode, toGeo: toGeo, roadClass: roadClass,
    lon2x: lon2x, lat2y: lat2y, x2lon: x2lon, y2lat: y2lat, tileBounds: tileBounds,
    tilesFor: tilesFor, wrapX: wrapX, tileZoomFor: tileZoomFor, createStore: createStore
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpinTiles;
