/*
  geosonify-sky-track.js  v0.1  — a journey, re-read as a direction

  WHAT THIS DOES
  --------------
  Takes any Earth track -- a GPX commute, an imported path, a drawn polygon --
  and re-reads it in the celestial frame through the identity sky mode already
  uses everywhere: latitude -> declination, longitude -> right ascension. The
  result is a real figure on the sphere, drawable by GeosonifySkyView.addShape
  exactly like Orion, and reportable against a star catalogue.

  THE SCALE PROBLEM, STATED HONESTLY UP FRONT
  -------------------------------------------
  "Which stars does my commute pass?" has an arithmetic answer most people will
  not guess, and the module reports it rather than quietly returning an empty
  list.

  A track sweeps exactly as many DEGREES of sky as it spans in degrees of
  lat/lon. Commutes are small. Measured against the catalogue in
  geosonify-sky-stars.js:

      6 km commute        spans   0.1 deg   stars within 1 deg:  0
      25 km cross-town    spans   0.5 deg   stars within 1 deg:  0
      400 km road trip    spans   4.0 deg   stars within 1 deg:  0
      London -> Sydney    spans 151.6 deg   stars within 1 deg:  6
      Cape Town -> Cairo  spans  64.0 deg   stars within 1 deg:  6

  That is not a bug in the search. At magnitude 6.5 the whole sky holds 8,920
  stars, a density of 0.216 per square degree; a 6 km commute sweeps roughly
  0.003 square degrees, so the expected count inside it is 0.0007. Essentially
  never.

  So the report is built the other way round. Rather than "which stars are in
  your track" -- a question whose answer is almost always none -- it answers:

    * which constellations the track lies in          (always answerable)
    * the nearest catalogued star, at whatever distance it happens to be
    * anything within a radius the caller chooses

  "Your commute sits in Centaurus, 4.0 deg from HR 4546" is true and satisfying.
  "Your commute passes Alnilam" would be neither.

  And the flip side is the good news: a flight, a coastline, a long drive DOES
  sweep meaningful sky. London to Sydney crosses nine constellations and passes
  within an arcminute of named stars. The feature gets better the further you go.

  EARTH READOUTS MUST BE SUPPRESSED, NOT CONVERTED
  ------------------------------------------------
  A GPX track carries distance, duration, elevation, speed. Those are facts about
  a walk on the ground. Re-read as a direction they describe nothing: "12.4 km"
  against a celestial path is the same error as BIP39_GEO_LOOKUP reporting
  "Tasman Sea" for a patch of Ophiuchus. earthReadouts() returns the list of
  quantities a caller must hide, rather than this module trying to translate
  them into something they are not.

  The one honest conversion is angular: a track's EXTENT on the sky is a real
  angle, and spanDeg reports it.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';
  var D2R = Math.PI / 180;

  function _Stars() {
    try { if (typeof GeosonifySkyStars !== 'undefined' && GeosonifySkyStars) return GeosonifySkyStars; } catch (e) {}
    return (global && global.GeosonifySkyStars) || null;
  }

  /*
    Accepts the several shapes the app already passes tracks around in:
      [lat, lon]           plain pair, as parseGPX and the path grammar produce
      {lat, lon}           AppState-style
      {lat, lon, ele, ...} GPX point with extras -- extras ignored, not converted
    Returns [dec, ra] vertices, RA folded to 0..360.

    RA folding is cosmetic: the renderers only ever use cos(ra - centre) and
    sin(ra - centre), so -0.46 and 359.54 project identically. Folded anyway so
    the reported numbers read as right ascension rather than as longitude.
  */
  function toVertices(coords) {
    if (!coords || !coords.length) return [];
    var out = [];
    for (var i = 0; i < coords.length; i++) {
      var c = coords[i], lat, lon;
      if (Array.isArray(c)) { lat = c[0]; lon = c[1]; }
      else if (c && typeof c === 'object') { lat = c.lat; lon = c.lon === undefined ? c.lng : c.lon; }
      else continue;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      if (!isFinite(lat) || !isFinite(lon)) continue;
      out.push([lat, ((lon % 360) + 360) % 360]);
    }
    return out;
  }

  /*
    Bounds and true angular extent.

    spanDeg is the greatest separation between any two vertices, by haversine --
    never arccos, whose precision floor is coarser than a HEALPix cell above
    order 22. O(n^2), so decimated above a few hundred points: for an extent
    quoted to two decimals, sampling 200 of 20,000 track points cannot move the
    answer meaningfully, and the alternative is a visible stall on a long GPX.
  */
  function extent(vertices) {
    if (!vertices.length) return null;
    var S = _Stars();
    var minDec = 90, maxDec = -90, decSum = 0;
    var sx = 0, sy = 0;                       // circular mean for RA

    for (var i = 0; i < vertices.length; i++) {
      var d = vertices[i][0], r = vertices[i][1];
      if (d < minDec) minDec = d;
      if (d > maxDec) maxDec = d;
      decSum += d;
      sx += Math.cos(r * D2R); sy += Math.sin(r * D2R);
    }

    var step = Math.max(1, Math.ceil(vertices.length / 200));
    var span = 0;
    if (S) {
      for (var a = 0; a < vertices.length; a += step) {
        for (var b = a + step; b < vertices.length; b += step) {
          var s = S.sepDeg(vertices[a][1], vertices[a][0], vertices[b][1], vertices[b][0]);
          if (s > span) span = s;
        }
      }
    }

    var raCentre = Math.atan2(sy, sx) / D2R;
    if (raCentre < 0) raCentre += 360;

    return {
      points: vertices.length,
      minDec: minDec, maxDec: maxDec,
      decCentre: decSum / vertices.length,
      raCentre: raCentre,
      spanDeg: span
    };
  }

  /*
    The full report. opts.radiusDeg limits "near"; opts.maxMag caps faintness;
    opts.limit caps the list.

    nearest is filled in even when the radius search comes back empty -- for a
    commute that is the ONLY thing that will be populated, and returning a report
    with nothing in it would read as a failure rather than as a fact about the
    size of a commute.
  */
  function report(coords, opts) {
    opts = opts || {};
    var S = _Stars();
    var vertices = toVertices(coords);
    if (!vertices.length) return null;

    var ext = extent(vertices);
    var radius = opts.radiusDeg === undefined ? 1 : opts.radiusDeg;

    var near = [], constellations = [], nearest = null;
    if (S) {
      near = S.nearTrack(vertices, radius, { maxMag: opts.maxMag, limit: opts.limit || 8 });
      nearest = S.nearest(ext.raCentre, ext.decCentre, { maxMag: opts.maxMag });

      // Constellations are taken from the catalogue's own per-star field, so
      // this is "the constellations the nearby stars belong to", NOT an IAU
      // boundary lookup. Honest label, and it degrades gracefully: a track with
      // no star within the wider radius simply reports none.
      var seen = {};
      var wide = S.nearTrack(vertices, Math.max(radius, 3), { maxMag: 5 });
      for (var i = 0; i < wide.length; i++) {
        if (wide[i].con && !seen[wide[i].con]) { seen[wide[i].con] = 1; constellations.push(wide[i].con); }
      }
      if (!constellations.length && nearest && nearest.con) constellations.push(nearest.con);
    }

    return {
      vertices: vertices,
      extent: ext,
      radiusDeg: radius,
      near: near,
      nearest: nearest,
      constellations: constellations,
      constellationsAreApproximate: true,
      note: near.length ? null
        : 'Nothing catalogued within ' + radius + '\u00b0. A track this small sweeps '
          + ext.spanDeg.toFixed(3) + '\u00b0 of sky, and the naked-eye sky holds only '
          + '0.22 stars per square degree \u2014 so this is the expected result, not a miss.'
    };
  }

  /*
    A shape spec for GeosonifySkyView.addShape. Same [dec, ra] vertex order
    GeosonifySkyFigures.toPaths() produces, so a commute is drawn by exactly the
    path that draws Orion.
  */
  function toShape(coords, opts) {
    opts = opts || {};
    var vertices = toVertices(coords);
    if (vertices.length < 2) return null;
    return {
      type: 'path',
      vertices: vertices,
      stroke: opts.stroke || '#fbbf24',
      strokeWidth: opts.strokeWidth || 1.6
    };
  }

  /*
    Quantities a caller MUST hide while a track is shown in the sky frame.
    Ground truths that describe nothing about a direction.
  */
  function earthReadouts() {
    return ['distance', 'duration', 'elevation', 'speed', 'pace', 'ascent', 'descent'];
  }

  function summary(rep) {
    if (!rep) return '';
    var S = _Stars();
    var bits = [];
    bits.push(rep.extent.spanDeg.toFixed(2) + '\u00b0 of sky');
    if (rep.constellations.length) bits.push('in ' + rep.constellations.slice(0, 4).join(', '));
    if (rep.near.length) {
      bits.push('passing ' + rep.near.slice(0, 3).map(function (h) {
        return h.name + ' (' + (S ? S.formatSep(h.sepDeg) : h.sepDeg.toFixed(2)) + ')';
      }).join(', '));
    } else if (rep.nearest) {
      bits.push('nearest catalogued star ' + rep.nearest.name + ' at ' +
                (S ? S.formatSep(rep.nearest.sepDeg) : rep.nearest.sepDeg.toFixed(2)));
    }
    return bits.join(', ');
  }

  var API = {
    VERSION: VERSION,
    toVertices: toVertices,
    extent: extent,
    report: report,
    toShape: toShape,
    summary: summary,
    earthReadouts: earthReadouts
  };

  global.GeosonifySkyTrack = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  try { console.log('[geosonify] sky-track ' + VERSION + ' loaded'); } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
