/*
  geojson-export.js — a Geosonify shape as RFC 7946 GeoJSON (Nov 2026)

  Pure functions, no DOM: index.html turns lastSolution into "parts" and hands
  them here; Node can run the same code against GeographicLib.

  WHAT A GEOSONIFY EDGE MEANS, AND WHAT GEOJSON CAN SAY
    A Geosonify edge between two vertices is a geodesic on WGS84 (the default)
    or a rhumb line (segment mode 'R'). A GeoJSON edge is a straight line in
    longitude/latitude (RFC 7946 §3.1.1). So every geodesic and rhumb edge is
    densified: midpoints are inserted until the straight lon/lat chord is
    within `toleranceM` (default 1 m) of the true curve, tested at each
    midpoint, recursively. Edges that are already straight in lon/lat (mode
    'L': graticule sides, cell outlines that come pre-drawn) are kept as they
    are. Original vertices are always kept unchanged, so re-importing the file
    puts every vertex exactly where the shape had it.

    The rhumb line is the true one: straight in (isometric latitude, longitude),
    i.e. straight on Mercator, on the WGS84 ellipsoid. It is NOT straight in
    lon/lat (it differs from that by ~200 m on a 141 km diagonal at 47° N).

  THE ANTIMERIDIAN AND THE POLES (RFC 7946 §3.1.9)
    Longitudes are unwrapped along each part, so an edge always takes the short
    way round (|Δlon| < 180° per edge, as the app draws it).
    - A line that crosses ±180° is cut there into a MultiLineString.
    - A ring that crosses ±180° is cut there and its pieces closed along the
      meridian, giving one polygon per piece (a MultiPolygon). The ring is made
      counter-clockwise first (RFC 7946 §3.1.6) so the pieces can be joined
      without guessing.
    - A ring whose longitudes wind once round the globe encloses a pole. It is
      closed through that pole along ±180°. Which pole: the one on the side of
      the ring's mean latitude (northern rings the North Pole). That convention
      is stated in the output properties (pole_enclosed).

  HOLES
    Not representable yet (Geosonify links have no ring role until core
    profile v1.1); every ring is an outer ring, and the output says so.

  Input parts: [{ kind: 'point'|'line'|'polygon', coords: [[lat, lon], ...],
                  modes: ['G'|'R'|'L', ...] | null   (mode i = edge i → i+1;
                  missing = 'G'), linear: bool (all edges 'L') }]
  Or { kind: 'circle', center: [lat, lon], radius: metres }.
*/
(function (global) {
  'use strict';

  var DEFAULT_TOL_M = 1;
  var MAX_DEPTH = 24;
  var DECIMALS = 8;                        // ~1.1 mm: finer than any cell

  // WGS84 (matches geodesic.Geodesic.WGS84)
  var WGS84_F = 1 / 298.257223563;
  var E2 = WGS84_F * (2 - WGS84_F), E = Math.sqrt(E2);
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;

  function wrap180(x) { x = ((x + 180) % 360 + 360) % 360 - 180; return x === -180 ? 180 : x; }
  function dlonShort(a, b) { var d = wrap180(b - a); return d; }
  function round(x) { var m = Math.pow(10, DECIMALS); return Math.round(x * m) / m; }

  // Isometric latitude ψ(φ) and its inverse, on the ellipsoid.
  function psiOf(latDeg) {
    var phi = Math.max(-89.9999999, Math.min(89.9999999, latDeg)) * D2R;
    var s = Math.sin(phi);
    return Math.atanh(s) - E * Math.atanh(E * s);
  }
  function latOfPsi(psi) {
    var chi = Math.atan(Math.sinh(psi));            // conformal latitude
    var phi = chi;
    for (var i = 0; i < 12; i++) {
      var s = Math.sin(phi);
      var next = Math.asin(Math.tanh(psi + E * Math.atanh(E * s)));
      if (Math.abs(next - phi) < 1e-15) { phi = next; break; }
      phi = next;
    }
    return phi * R2D;
  }

  // A point a fraction t along an edge, in unwrapped longitude (lon1 + t·Δ).
  function geodesicLine(geod, p, q) {
    var line = geod.InverseLine(p[0], p[1], q[0], q[1]);
    var total = line.s13;
    var dl = dlonShort(p[1], q[1]);
    return function (t) {
      if (t <= 0) return [p[0], p[1]];
      if (t >= 1) return [q[0], p[1] + dl];
      var r = line.Position(total * t);
      // Keep the longitude continuous with p (GeographicLib may wrap it).
      var lon = p[1] + dlonShort(p[1], r.lon2);
      return [r.lat2, lon];
    };
  }
  function rhumbLine(p, q) {
    var dl = dlonShort(p[1], q[1]);
    var psi1 = psiOf(p[0]), psi2 = psiOf(q[0]);
    var dpsi = psi2 - psi1;
    return function (t) {
      if (t <= 0) return [p[0], p[1]];
      if (t >= 1) return [q[0], p[1] + dl];
      var lat = Math.abs(dpsi) < 1e-15 ? p[0] : latOfPsi(psi1 + t * dpsi);
      return [lat, p[1] + t * dl];
    };
  }

  // Densify one edge p→q (q's longitude already unwrapped to be within 180°
  // of p's). Returns the inserted points, not p or q.
  function densifyEdge(geod, p, q, mode, tolM) {
    if (mode === 'L') return [];
    var f = mode === 'R' ? rhumbLine(p, q) : geodesicLine(geod, p, q);
    var out = [];
    function rec(t0, a, t1, b, depth) {
      var tm = (t0 + t1) / 2;
      var m = f(tm);
      var chord = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      var dev = geod.Inverse(m[0], m[1], chord[0], chord[1]).s12;
      if (dev > tolM && depth < MAX_DEPTH) {
        rec(t0, a, tm, m, depth + 1);
        out.push(m);
        rec(tm, m, t1, b, depth + 1);
      }
    }
    rec(0, p, 1, [q[0], q[1]], 0);
    return out;
  }

  // Densify a sequence; returns unwrapped coordinates (continuous longitudes).
  function densify(geod, coords, modes, linear, tolM) {
    if (!coords.length) return [];
    var out = [[coords[0][0], coords[0][1]]];
    for (var i = 1; i < coords.length; i++) {
      var prev = out[out.length - 1];
      var q = [coords[i][0], prev[1] + dlonShort(prev[1], coords[i][1])];
      var mode = linear ? 'L' : ((modes && modes[i - 1]) || 'G');
      var ins = densifyEdge(geod, prev, q, mode, tolM);
      for (var k = 0; k < ins.length; k++) out.push(ins[k]);
      out.push(q);
    }
    return out;
  }

  // ── antimeridian ──────────────────────────────────────────────────────
  function shiftIntoRange(seq) {
    var k = Math.floor((seq[0][1] + 180) / 360);
    if (!k) return seq;
    return seq.map(function (p) { return [p[0], p[1] - 360 * k]; });
  }
  function latAtLon(a, b, lon) {
    var t = (lon - a[1]) / (b[1] - a[1]);
    return a[0] + t * (b[0] - a[0]);
  }

  // Line: cut wherever it leaves [-180, 180]; returns parts as [lon, lat].
  function splitLine(seq) {
    seq = shiftIntoRange(seq);
    var parts = [], cur = [], off = 0;
    for (var i = 0; i < seq.length; i++) {
      var p = [seq[i][0], seq[i][1] - off];
      if (i > 0) {
        var a = [seq[i - 1][0], seq[i - 1][1] - off];
        if (p[1] > 180 || p[1] < -180) {
          var edge = p[1] > 180 ? 180 : -180;
          var lat = latAtLon(a, p, edge);
          cur.push([lat, edge]);
          parts.push(cur);
          off += edge > 0 ? 360 : -360;
          cur = [[lat, -edge]];
          p = [seq[i][0], seq[i][1] - off];
        }
      }
      cur.push(p);
    }
    parts.push(cur);
    return parts.filter(function (pt) { return pt.length >= 2; });
  }

  function signedArea(ring) {                // planar, lon=x lat=y; >0 = CCW
    var a = 0;
    for (var i = 0; i < ring.length - 1; i++) a += ring[i][1] * ring[i + 1][0] - ring[i + 1][1] * ring[i][0];
    return a / 2;
  }
  function closeRing(r) {
    var f = r[0], l = r[r.length - 1];
    if (f[0] !== l[0] || f[1] !== l[1]) r.push([f[0], f[1]]);
    return r;
  }

  /*
    Cut a CCW ring (unwrapped, spanning the meridian X = 180 in its own frame)
    along X into closed pieces. Walking a CCW ring, the interior is on the
    left: a west-side chain reaching X heads east, so its piece continues
    NORTH along X to the next west chain that starts there; an east-side chain
    reaching X heads west, so its piece continues SOUTH.
  */
  function cutRing(ring, X) {
    // Rotate so the ring starts strictly off the line, then walk the edges.
    var n = ring.length - 1, start = -1;
    for (var s = 0; s < n; s++) if (ring[s][1] !== X) { start = s; break; }
    if (start < 0) return { west: [], east: [] };
    var pts = [];
    for (var j = 0; j <= n; j++) pts.push(ring[(start + j) % n]);
    var chains = [], cur = [pts[0]], side = pts[0][1] < X ? 'W' : 'E';
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var sb = b[1] < X ? 'W' : (b[1] > X ? 'E' : side);
      if (sb !== side) {
        var lat = (b[1] === X) ? b[0] : latAtLon(a, b, X);
        cur.push([lat, X]);
        chains.push({ side: side, pts: cur });
        cur = [[lat, X]];
        side = sb;
      }
      cur.push(b);
    }
    // The walk began mid-chain: join the last open chain onto the first.
    if (chains.length && chains[0].side === side) {
      chains[0].pts = cur.slice(0, -1).concat(chains[0].pts);
    } else {
      chains.push({ side: side, pts: cur });
    }
    function assemble(sd) {
      var cs = chains.filter(function (c) { return c.side === sd; });
      var used = cs.map(function () { return false; });
      var polys = [];
      for (var c0 = 0; c0 < cs.length; c0++) {
        if (used[c0]) continue;
        var ringOut = [], ci = c0, guard = 0;
        while (!used[ci] && guard++ <= cs.length) {
          used[ci] = true;
          ringOut = ringOut.concat(cs[ci].pts);
          var endLat = cs[ci].pts[cs[ci].pts.length - 1][0];
          // next chain start along X: north for W, south for E
          var best = -1, bestLat = null;
          for (var k = 0; k < cs.length; k++) {
            var sl = cs[k].pts[0][0];
            if (sd === 'W' ? sl >= endLat : sl <= endLat) {
              if (best < 0 || (sd === 'W' ? sl < bestLat : sl > bestLat)) { best = k; bestLat = sl; }
            }
          }
          if (best < 0) break;
          ci = best;
        }
        polys.push(closeRing(ringOut));
      }
      return polys;
    }
    return { west: assemble('W'), east: assemble('E') };
  }

  // Ring → array of rings in [lon, lat] space, all within [-180, 180].
  function splitPolygon(seq) {
    var r = closeRing(seq.slice());
    var winding = r[r.length - 1][1] - r[0][1];
    // A ring that winds once round the globe: the densified chain ends 360°
    // from where it began. Close it through the enclosed pole.
    var unclosedNet = 0;
    for (var i = 1; i < seq.length; i++) unclosedNet += seq[i][1] - seq[i - 1][1];
    var polar = Math.abs(Math.abs(unclosedNet) - 360) < 1e-6;
    if (polar) return { rings: [polarRing(seq)], pole: polarPole(seq) };
    if (Math.abs(winding) > 1e-9) r[r.length - 1] = [r[0][0], r[0][1]];
    if (signedArea(r) < 0) r.reverse();
    // Put the ring's west edge inside [-180, 180).
    var minLon = Infinity, maxLon = -Infinity;
    r.forEach(function (p) { if (p[1] < minLon) minLon = p[1]; if (p[1] > maxLon) maxLon = p[1]; });
    var k = Math.floor((minLon + 180) / 360);
    if (k) { r = r.map(function (p) { return [p[0], p[1] - 360 * k]; }); maxLon -= 360 * k; }
    if (maxLon <= 180) return { rings: [r] };
    var cut = cutRing(r, 180);
    var east = cut.east.map(function (ring) { return ring.map(function (p) { return [p[0], p[1] - 360]; }); });
    return { rings: cut.west.concat(east), split: true };
  }
  function polarPole(seq) {
    var s = 0; seq.forEach(function (p) { s += p[0]; });
    return s >= 0 ? 'north' : 'south';
  }
  function polarRing(seq) {
    var pole = polarPole(seq) === 'north' ? 90 : -90;
    var parts = splitLine(seq);                 // cut at ±180 into arcs
    // Order: the arcs, in walking order, already continue across ±180; join
    // them, dropping the duplicate crossing points, into one -180..180 sweep.
    var sweep = [];
    // Rotate so the sweep starts at a crossing: last part then the first parts.
    var ordered = parts.length > 1 ? parts.slice(1).concat([parts[0]]) : parts;
    ordered.forEach(function (pt, idx) {
      pt.forEach(function (p, j) {
        if (idx > 0 && j === 0) return;          // the matching crossing point
        sweep.push(p);
      });
    });
    // sweep runs from one side of ±180 to the other; close via the pole.
    var a = sweep[0], b = sweep[sweep.length - 1];
    var ring = sweep.concat([[pole, b[1]], [pole, a[1]], [a[0], a[1]]]);
    if (signedArea(ring) < 0) ring.reverse();
    return ring;
  }

  // ── circle ─────────────────────────────────────────────────────────────
  function circleCoords(geod, center, radius, tolM) {
    // Chord sag r(1 - cos(π/n)) ≤ tol  →  n ≥ π / acos(1 - tol/r)
    var n = 64;
    if (radius > tolM) n = Math.max(64, Math.ceil(Math.PI / Math.acos(1 - tolM / radius)));
    n = Math.min(n, 4096);
    var pts = [];
    for (var i = 0; i < n; i++) {
      var d = geod.Direct(center[0], center[1], 360 * i / n, radius);
      pts.push([d.lat2, d.lon2]);
    }
    pts.push([pts[0][0], pts[0][1]]);
    return { coords: pts, vertices: n };
  }

  // ── assembly ───────────────────────────────────────────────────────────
  function toPos(p) { return [round(wrap180Keep(p[1])), round(p[0])]; }
  function wrap180Keep(lon) {                 // keep exact ±180 on cut edges
    if (lon === 180 || lon === -180) return lon;
    return wrap180(lon);
  }

  function build(parts, opts) {
    opts = opts || {};
    var geod = opts.geod;
    var tol = opts.toleranceM || DEFAULT_TOL_M;
    var props = {};
    var polys = [], lines = [], points = [];
    var stats = { split: false, poles: [], circleVertices: null };

    parts.forEach(function (part) {
      if (part.kind === 'circle') {
        var c = circleCoords(geod, part.center, part.radius, tol);
        stats.circleVertices = c.vertices;
        part = { kind: 'polygon', coords: c.coords, linear: true };
      }
      if (part.kind === 'point') {
        part.coords.forEach(function (p) { points.push(toPos(p)); });
        return;
      }
      var seq = densify(geod, part.coords, part.modes, part.linear, tol);
      if (part.kind === 'line' || seq.length < 4) {
        splitLine(seq).forEach(function (l) {
          if (l.length >= 2) lines.push(l.map(toPos));
        });
        return;
      }
      var res = splitPolygon(seq);
      if (res.split) stats.split = true;
      if (res.pole) stats.poles.push(res.pole);
      res.rings.forEach(function (ring) {
        if (ring.length >= 4) polys.push([ring.map(toPos)]);
      });
    });

    var geoms = [];
    if (polys.length === 1) geoms.push({ type: 'Polygon', coordinates: polys[0] });
    else if (polys.length > 1) geoms.push({ type: 'MultiPolygon', coordinates: polys });
    if (lines.length === 1) geoms.push({ type: 'LineString', coordinates: lines[0] });
    else if (lines.length > 1) geoms.push({ type: 'MultiLineString', coordinates: lines });
    if (points.length === 1) geoms.push({ type: 'Point', coordinates: points[0] });
    else if (points.length > 1) geoms.push({ type: 'MultiPoint', coordinates: points });
    var geometry = geoms.length === 1 ? geoms[0]
      : (geoms.length ? { type: 'GeometryCollection', geometries: geoms } : null);

    props.edges = 'Geodesic (WGS84) and rhumb edges densified so each straight lon/lat segment is within ' +
      tol + ' m of the true edge; original vertices unchanged.';
    props.densify_tolerance_m = tol;
    props.holes = 'not represented: every ring is an outer ring';
    if (stats.split) props.antimeridian = 'split at 180° (RFC 7946 §3.1.9)';
    if (stats.poles.length) props.pole_enclosed = stats.poles.join(',') +
      ' (convention: a ring that winds round the globe encloses the pole on the side of its mean latitude)';
    if (stats.circleVertices) props.circle_vertices = stats.circleVertices;
    var extra = opts.properties || {};
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k) && extra[k] != null) props[k] = extra[k];

    return { type: 'FeatureCollection',
             features: [{ type: 'Feature', properties: props, geometry: geometry }] };
  }

  var api = {
    build: build,
    // exposed for tests
    _densify: densify, _splitLine: splitLine, _splitPolygon: splitPolygon,
    _circle: circleCoords, _psiOf: psiOf, _latOfPsi: latOfPsi
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.GeosonifyGeoJSON = api;
})(typeof window !== 'undefined' ? window : this);
