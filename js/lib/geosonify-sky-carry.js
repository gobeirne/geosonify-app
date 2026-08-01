/*
  geosonify-sky-carry.js  v0.1  — shapes cross the frame boundary, both ways

  Load the Berlin Wall, hit Sky, and see it written on the stars. Draw Orion,
  hit Earth, and see it laid across the globe. The same digits, read twice.

  WHY THIS IS ALLOWED TO BE SIMPLE
  --------------------------------
  Because it converts nothing. A shape is a list of lat/lon vertices; the sky
  reads latitude as declination and longitude as right ascension. There is no
  scale factor, no projection, no datum, no Earth radius anywhere in the path
  from one to the other. The only arithmetic is the RA fold (0..360 against
  +/-180), and even that is cosmetic -- the renderers use cos(ra - centre) and
  sin(ra - centre), for which -0.5 and 359.5 are the same number.

  EVERY SOLUTION TYPE BECOMES VERTICES FIRST. THIS IS THE WHOLE TRICK.
  --------------------------------------------------------------------
  lastSolution comes in five shapes, and two of them carry METRES:

      point       centroid                              no units
      path        points[]                              no units
      graticule   centroid + lonSpanDeg + nsMeters      metres
      circle      centroid + radius (metres)            metres
      rect        centroid + thetaDeg + L + S (metres)  metres

  A circle of radius R metres has no meaning as a direction, and the tempting
  fix -- divide by 111319.9 to get degrees -- reintroduces an Earth radius into
  the celestial frame, which is exactly what geosonify-sky-units.js exists to
  avoid.

  So the metres are never carried. GeoMath.buildCircle, buildRectangle and
  buildGraticule already turn each of those into lat/lon vertex rings, using the
  same geodesic maths that drew them on the Leaflet map in the first place. Once
  they are vertices the units are gone, having been spent on Earth where they
  meant something. What crosses the boundary is a ring of directions.

  A consequence worth stating plainly: a circle carried to the sky is not a
  circle. It is the 64-gon that the Earth circle actually is in lat/lon, and at
  high latitude it will look visibly squashed on the celestial sphere -- because
  it IS squashed, and a circle of constant ground distance is not a circle of
  constant angle. Drawing a true small circle instead would be drawing a
  different shape and quietly claiming it was the same one.

  ROUND-TRIPPING IS LOSSY, AND HONESTLY SO
  ----------------------------------------
  Earth -> sky -> Earth gives back the polygon, not the circle. The radius in
  metres does not survive, because it was never carried. Callers that want the
  original back should keep lastSolution rather than expecting this to
  reconstruct it; the ORIGIN field on every carried shape records what it came
  from so a caller can tell.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';
  var CIRCLE_SEGMENTS = 64;

  function _GeoMath() { return global.GeoMath || null; }
  function _SkyView() { return global.GeosonifySkyView || null; }

  function fold360(lon) { return ((lon % 360) + 360) % 360; }
  function fold180(ra) { var x = ((ra % 360) + 360) % 360; return x > 180 ? x - 360 : x; }

  function asPair(p) {
    if (!p) return null;
    if (Array.isArray(p)) return (typeof p[0] === 'number' && typeof p[1] === 'number') ? [p[0], p[1]] : null;
    if (typeof p === 'object') {
      var lat = p.lat, lon = (p.lon === undefined ? p.lng : p.lon);
      return (typeof lat === 'number' && typeof lon === 'number') ? [lat, lon] : null;
    }
    return null;
  }

  function clean(list) {
    var out = [];
    for (var i = 0; i < (list || []).length; i++) {
      var p = asPair(list[i]);
      if (p && isFinite(p[0]) && isFinite(p[1])) out.push(p);
    }
    return out;
  }

  /*
    lastSolution -> rings of [lat, lon]. Returns { rings, kind, closed } or null.

    Every branch ends in vertices. Where a solution carries metres, the GeoMath
    builder that drew it on Leaflet is reused rather than a second
    implementation, so the sky sees the same polygon the map does -- not a
    lookalike computed a different way.
  */
  function solutionToRings(sol) {
    if (!sol) return null;
    var GM = _GeoMath();

    // Multi-group paths (imported shapes, GPX with several tracks).
    if (sol.groups && sol.groups.length) {
      var groups = [];
      for (var g = 0; g < sol.groups.length; g++) {
        var r = clean(sol.groups[g]);
        if (r.length) groups.push(r);
      }
      if (groups.length) return { rings: groups, kind: sol.type || 'path', closed: false };
    }

    if (sol.points && sol.points.length) {
      var pts = clean(sol.points);
      if (pts.length) return { rings: [pts], kind: sol.type || 'path', closed: false };
    }

    var centroid = asPair(sol.centroid);

    if (sol.type === 'circle' && centroid && typeof sol.radius === 'number' && GM) {
      // Metres are spent HERE, on Earth, where they mean something.
      var ring = clean(GM.buildCircle(centroid, sol.radius, CIRCLE_SEGMENTS));
      if (ring.length) return { rings: [ring], kind: 'circle', closed: true };
    }

    if (sol.type === 'rect' && centroid && GM &&
        typeof sol.L === 'number' && typeof sol.S === 'number') {
      var theta = (typeof sol.thetaDeg === 'number' ? sol.thetaDeg : 0) * Math.PI / 180;
      var corners = clean(GM.buildRectangle(sol.L, sol.S, theta, centroid));
      if (corners.length === 4) {
        // Four corners bow wrong on a sphere; densify the edges so the sky sees
        // the shape rather than a quadrilateral approximating it.
        return { rings: [densifyRing(corners.concat([corners[0]]), 8)], kind: 'rect', closed: true };
      }
    }

    if (sol.type === 'graticule' && centroid && GM && typeof sol.lonSpanDeg === 'number') {
      /*
        Graticules have two modes and the angular one is strictly better here:
        { angular: true, latSpanDeg } needs no metres at all, so nothing is
        spent and nothing is lost. buildGraticule takes latSpanDeg through
        opts and switches to getGraticuleBoundsAngular internally. The metric
        mode is the fallback, where nsMeters is converted to bounds by the same
        function that drew it on the map.
      */
      var grat = null;
      if (sol.angular && typeof sol.latSpanDeg === 'number') {
        grat = clean(GM.buildGraticule(centroid, sol.lonSpanDeg, null, 32, { latSpanDeg: sol.latSpanDeg }));
      } else if (typeof sol.nsMeters === 'number') {
        grat = clean(GM.buildGraticule(centroid, sol.lonSpanDeg, sol.nsMeters, 32));
      }
      if (grat && grat.length) return { rings: [grat], kind: 'graticule', closed: true };
    }

    if (centroid) return { rings: [[centroid]], kind: 'point', closed: false };
    return null;
  }

  // Linear interpolation in lat/lon, which is what the underlying grammar is.
  function densifyRing(ring, per) {
    if (ring.length < 2 || per < 2) return ring;
    var out = [];
    for (var i = 0; i < ring.length - 1; i++) {
      var a = ring[i], b = ring[i + 1];
      for (var s = 0; s < per; s++) {
        var t = s / per;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    out.push(ring[ring.length - 1]);
    return out;
  }

  /*
    EARTH -> SKY. Draws whatever is on the map onto the celestial sphere and
    frames it. Returns the number of rings carried.

    Colour differs from the URL-path blue and the starred-card green so three
    different things on one canvas stay three different things.
  */
  function carryToSky(sol, opts) {
    opts = opts || {};
    var V = _SkyView();
    if (!V || !V.isOpen || !V.isOpen()) return 0;

    var got = solutionToRings(sol);
    if (!got || !got.rings.length) return 0;

    if (opts.replace !== false && V.clearShapes) V.clearShapes();

    var all = [], n = 0;
    got.rings.forEach(function (ring) {
      var verts = ring.map(function (p) { return [p[0], fold360(p[1])]; });
      if (verts.length < 2) return;
      V.addShape({
        type: 'path',
        vertices: verts,
        stroke: opts.stroke || '#f0abfc',
        strokeWidth: opts.strokeWidth || 1.5,
        origin: got.kind
      });
      all = all.concat(verts);
      n++;
    });

    if (n && opts.frame !== false && V.frameOn) V.frameOn(all);
    else if (n && V.redraw) V.redraw();
    return n;
  }

  /*
    SKY -> EARTH. The shapes currently on the sphere, as lat/lon rings ready for
    L.polyline. Longitude is folded back to +/-180 because Leaflet wraps oddly
    past 180 and would draw a line across the whole map.

    Returns rings rather than drawing them: the map has several drawing paths
    (shapeLayer, imported layers, GPX layers) with different lifetimes, and
    picking one for the caller would be guessing.
  */
  function ringsFromSky() {
    var V = _SkyView();
    if (!V || !V.getShapes) return [];
    var shapes = [];
    try { shapes = V.getShapes() || []; } catch (e) { return []; }

    var out = [];
    shapes.forEach(function (s) {
      var verts = s && (s.vertices || s.points);
      if (!verts || verts.length < 2) return;
      var ring = [];
      for (var i = 0; i < verts.length; i++) {
        var v = verts[i];
        if (!Array.isArray(v) || !isFinite(v[0]) || !isFinite(v[1])) continue;
        ring.push([v[0], fold180(v[1])]);        // [dec, ra] -> [lat, lon]
      }
      if (ring.length >= 2) out.push(ring);
    });
    return out;
  }

  /*
    Draw those rings on the Leaflet map. Kept separate from ringsFromSky so a
    caller can have the geometry without the side effect.

    Layers are tracked here and removed on the next call, so switching back and
    forth does not accumulate polylines -- the failure mode that makes a map
    slowly turn into spaghetti.
  */
  var _layers = [];

  function clearEarthShapes(map) {
    _layers.forEach(function (l) { try { map.removeLayer(l); } catch (e) {} });
    _layers = [];
  }

  function carryToEarth(map, opts) {
    opts = opts || {};
    if (!map || !global.L) return 0;
    clearEarthShapes(map);

    var rings = ringsFromSky();
    rings.forEach(function (r) {
      var line = global.L.polyline(r, {
        color: opts.color || '#f0abfc',
        weight: opts.weight || 3,
        opacity: opts.opacity === undefined ? 0.9 : opts.opacity
      });
      line.addTo(map);
      _layers.push(line);
    });
    return _layers.length;
  }

  var API = {
    VERSION: VERSION,
    solutionToRings: solutionToRings,
    densifyRing: densifyRing,
    carryToSky: carryToSky,
    ringsFromSky: ringsFromSky,
    carryToEarth: carryToEarth,
    clearEarthShapes: clearEarthShapes
  };

  global.GeosonifySkyCarry = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  try { console.log('[geosonify] sky-carry ' + VERSION + ' loaded'); } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
