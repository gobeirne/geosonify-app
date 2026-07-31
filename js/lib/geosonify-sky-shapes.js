/*
  geosonify-sky-shapes.js  v0.1  — shape primitives on a sphere

  PURE. No DOM, no renderer, no state. Every function returns rings of
  [latOrDec, lonOrRa] in degrees, ready for geosonify-sky-overlay.js to project,
  or for the Earth map to draw.

  WHY THIS IS NOT THE EARTH SHAPE CODE WITH DIFFERENT UNITS
  ---------------------------------------------------------
  On the celestial sphere there is no metre. Every extent is an ANGLE, and that
  is not a limitation to work around — it is what the sphere actually is. Earth
  shapes are angles too; metres are just angles multiplied by a radius nobody
  mentions. So this module works in angle throughout and offers metresToArcsec()
  for callers who think in ground distance.

  That means ellipses arrive on Earth for free, which is the right way round:
  the primitive was always missing, and the sky is what made it obvious.

  THE GEOMETRY, STATED PLAINLY
  ----------------------------
  * CIRCLE is a small circle: every point at exact angular distance r from the
    centre. Not a planar circle projected — the real thing, via the spherical
    offset formula. A 20-degree circle is correct, not merely close.

  * ELLIPSE and RECTANGLE are defined in the TANGENT PLANE at the centre, then
    offset onto the sphere exactly. This is not laziness: it is precisely what an
    error ellipse and a detector footprint ARE. A camera's field is flat in its
    own focal plane; an astrometric error ellipse is a covariance in tangent
    coordinates. Both become visibly non-elliptical on the sky at large sizes,
    and that is correct behaviour, not distortion.

  * POSITION ANGLE is measured from North through East, the astronomical
    convention. PA 0 puts the major axis along the meridian; PA 90 puts it east.
    Get this backwards and every published error ellipse disagrees with you.

  * POLYGON and PATH are vertex lists and need no units at all, which is why
    they already worked before this module existed.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var ARCSEC_PER_RAD = 206264.80624709636;
  var EARTH_R = 6378137;                       // metres, WGS84 equatorial

  function wrap360(d) { return ((d % 360) + 360) % 360; }

  /*
    Exact spherical offset: the point at angular separation rho (radians) from
    (lon0, lat0), at position angle theta (radians, North through East).

      sin(lat) = sin(lat0)cos(rho) + cos(lat0)sin(rho)cos(theta)
      dlon     = atan2(sin(rho)sin(theta),
                       cos(lat0)cos(rho) - sin(lat0)sin(rho)cos(theta))

    No tangent-plane approximation. Correct at any separation, including across
    a pole, which is where naive offset code fails.
  */
  function offset(lonDeg, latDeg, rhoRad, thetaRad) {
    var lat0 = latDeg * D2R, lon0 = lonDeg * D2R;
    var sinLat0 = Math.sin(lat0), cosLat0 = Math.cos(lat0);
    var sinR = Math.sin(rhoRad), cosR = Math.cos(rhoRad);
    var sinLat = sinLat0 * cosR + cosLat0 * sinR * Math.cos(thetaRad);
    sinLat = Math.max(-1, Math.min(1, sinLat));
    var lat = Math.asin(sinLat);
    var dlon = Math.atan2(sinR * Math.sin(thetaRad),
                          cosLat0 * cosR - sinLat0 * sinR * Math.cos(thetaRad));
    return [lat * R2D, wrap360((lon0 + dlon) * R2D)];
  }

  function arcsecToRad(a) { return a / ARCSEC_PER_RAD; }
  function metresToArcsec(m, radius) { return (m / (radius || EARTH_R)) * ARCSEC_PER_RAD; }
  function arcsecToMetres(a, radius) { return arcsecToRad(a) * (radius || EARTH_R); }

  /*
    CIRCLE — a true small circle.
      centre (lon/ra, lat/dec) in degrees, radius in arcsec.
    opts.steps: samples around the ring (default 72; more for large radii).
  */
  function circle(lonDeg, latDeg, radiusArcsec, opts) {
    opts = opts || {};
    var rho = arcsecToRad(radiusArcsec);
    var n = opts.steps || Math.max(36, Math.min(360, Math.round(72 * Math.max(1, radiusArcsec / 3600))));
    var pts = [];
    for (var i = 0; i < n; i++) pts.push(offset(lonDeg, latDeg, rho, (i / n) * 2 * Math.PI));
    if (opts.close !== false) pts.push(pts[0].slice());
    return pts;
  }

  /*
    ELLIPSE — tangent-plane ellipse, offset onto the sphere exactly.
      a, b      semi-major and semi-minor, arcsec
      paDeg     position angle of the MAJOR axis, North through East

    rho(theta) is the ellipse radius at angle theta measured from the major axis:
        rho = a*b / sqrt((b cos t)^2 + (a sin t)^2)
    which is the standard polar form about the centre, not about a focus.
  */
  function ellipse(lonDeg, latDeg, aArcsec, bArcsec, paDeg, opts) {
    opts = opts || {};
    if (!(aArcsec > 0) || !(bArcsec > 0)) throw new Error('ellipse: axes must be positive');
    var A = Math.max(aArcsec, bArcsec), B = Math.min(aArcsec, bArcsec);
    var pa = (paDeg || 0) * D2R;
    var n = opts.steps || Math.max(48, Math.min(360, Math.round(72 * Math.max(1, A / 3600))));
    var pts = [];
    for (var i = 0; i < n; i++) {
      var t = (i / n) * 2 * Math.PI;                 // angle from the major axis
      var rho = arcsecToRad((A * B) / Math.sqrt(Math.pow(B * Math.cos(t), 2) +
                                                Math.pow(A * Math.sin(t), 2)));
      pts.push(offset(lonDeg, latDeg, rho, pa + t)); // theta measured from North
    }
    if (opts.close !== false) pts.push(pts[0].slice());
    return pts;
  }

  /*
    RECTANGLE — a detector footprint. width x height in arcsec, rotated by the
    position angle of the HEIGHT axis (so PA 0 means "tall side along the
    meridian", which is how a camera is described).
    Edges are sampled, not just cornered, because a long edge is a curve on a
    sphere and drawing it straight is wrong at wide fields.
  */
  function rectangle(lonDeg, latDeg, widthArcsec, heightArcsec, paDeg, opts) {
    opts = opts || {};
    var per = opts.stepsPerEdge || 8;
    var pa = (paDeg || 0) * D2R;
    var hw = widthArcsec / 2, hh = heightArcsec / 2;
    // corners in tangent-plane coordinates: xi east, eta north
    var corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    var pts = [];
    for (var e = 0; e < 4; e++) {
      var p0 = corners[e], p1 = corners[(e + 1) % 4];
      for (var s = 0; s < per; s++) {
        var f = s / per;
        var xi = p0[0] + (p1[0] - p0[0]) * f;
        var eta = p0[1] + (p1[1] - p0[1]) * f;
        // rotate by PA, then convert (xi east, eta north) to (rho, theta)
        var xr = xi * Math.cos(pa) + eta * Math.sin(pa);
        var yr = -xi * Math.sin(pa) + eta * Math.cos(pa);
        var rho = arcsecToRad(Math.sqrt(xr * xr + yr * yr));
        var theta = Math.atan2(xr, yr);            // from North through East
        pts.push(rho === 0 ? [latDeg, wrap360(lonDeg)] : offset(lonDeg, latDeg, rho, theta));
      }
    }
    if (opts.close !== false) pts.push(pts[0].slice());
    return pts;
  }

  function polygon(vertices, opts) {
    opts = opts || {};
    var pts = vertices.map(function (v) { return [v[0], wrap360(v[1])]; });
    if (opts.close !== false && pts.length > 2) pts.push(pts[0].slice());
    return pts;
  }

  function path(vertices) {
    return vertices.map(function (v) { return [v[0], wrap360(v[1])]; });
  }

  // ---- measurement ------------------------------------------------------

  function circleAreaDeg2(radiusArcsec) {
    var rho = arcsecToRad(radiusArcsec);
    return 2 * Math.PI * (1 - Math.cos(rho)) * R2D * R2D;    // steradians -> deg^2
  }

  // Tangent-plane area; exact for small shapes, and the quantity astronomers
  // quote for footprints and error ellipses regardless of size.
  function ellipseAreaDeg2(aArcsec, bArcsec) {
    return Math.PI * (aArcsec / 3600) * (bArcsec / 3600);
  }
  function rectangleAreaDeg2(wArcsec, hArcsec) {
    return (wArcsec / 3600) * (hArcsec / 3600);
  }

  /* Angular separation, haversine — arccos has a sqrt(eps) floor of ~0.003
     arcsec, coarser than a cell above order 22, and would report nonsense. */
  function separationArcsec(lon1, lat1, lon2, lat2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R;
    var dp = p2 - p1, dl = (lon2 - lon1) * D2R;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * ARCSEC_PER_RAD;
  }

  /* Position angle from point 1 to point 2, North through East. */
  function positionAngleDeg(lon1, lat1, lon2, lat2) {
    var p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return wrap360(Math.atan2(y, x) * R2D);
  }

  function circleContains(lonC, latC, radiusArcsec, lon, lat) {
    return separationArcsec(lonC, latC, lon, lat) <= radiusArcsec;
  }

  function ellipseContains(lonC, latC, aArcsec, bArcsec, paDeg, lon, lat) {
    var A = Math.max(aArcsec, bArcsec), B = Math.min(aArcsec, bArcsec);
    var rho = separationArcsec(lonC, latC, lon, lat);
    var theta = (positionAngleDeg(lonC, latC, lon, lat) - (paDeg || 0)) * D2R;
    var lim = (A * B) / Math.sqrt(Math.pow(B * Math.cos(theta), 2) +
                                  Math.pow(A * Math.sin(theta), 2));
    return rho <= lim;
  }

  var API = {
    VERSION: VERSION,
    offset: offset,
    circle: circle, ellipse: ellipse, rectangle: rectangle,
    polygon: polygon, path: path,
    circleAreaDeg2: circleAreaDeg2, ellipseAreaDeg2: ellipseAreaDeg2,
    rectangleAreaDeg2: rectangleAreaDeg2,
    separationArcsec: separationArcsec, positionAngleDeg: positionAngleDeg,
    circleContains: circleContains, ellipseContains: ellipseContains,
    arcsecToRad: arcsecToRad, metresToArcsec: metresToArcsec, arcsecToMetres: arcsecToMetres,
    EARTH_R: EARTH_R
  };

  global.GeosonifySkyShapes = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
