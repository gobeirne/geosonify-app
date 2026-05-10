/*
  geosonify-geo-math.js v1.0
  Pure geodesic and geometry helper functions
  
  Dependencies:
  - GeographicLib (for geodesicDistance)
  
  Exports (via window.GeoMath):
  - Constants: R, deg2rad, rad2deg
  - Basic geo: geodesicDestination, geodesicDistance, getAntipode, normalizeLongitude
  - Coordinate parsing: parseSingleCoord, parseCoords, calculateCentroid
  - Bearings: initialBearing, computeBearingsLengths
  - Shape builders: buildRectangle, buildCircle
  - Graticule: getGraticuleBounds, buildGraticule, buildGraticuleCorners
  - Local coordinates: toLocalENU, fromLocalENU
  - Convex hull: convexHull2D, minimumAreaRectangle2D
  - Rectangle fitting: errorFunctionGeo, refineParametersGeo
  - Completers: completeRectangle3, isBowtie
*/

(function(global) {
  'use strict';
  
  const __GEO_MATH_VER__ = 'v1.0';
  try { console.log('[geosonify] geo-math ' + __GEO_MATH_VER__ + ' loaded'); } catch(e) {}

  // ============== CONSTANTS ==============
  const R = 6371000; // Earth radius in meters
  const deg2rad = d => d * Math.PI / 180;
  const rad2deg = r => r * 180 / Math.PI;

  // ============== BASIC GEODESIC FUNCTIONS ==============
  
  /**
   * Calculate destination point given start point, distance (meters), and bearing (degrees)
   * Uses spherical approximation - good for local distances
   */
  function geodesicDestination(start, distance, bearing) {
    const delta = distance / R, θ = deg2rad(bearing);
    const phi1 = deg2rad(start[0]), lambda1 = deg2rad(start[1]);
    const phi2 = Math.asin(Math.sin(phi1)*Math.cos(delta) + Math.cos(phi1)*Math.sin(delta)*Math.cos(θ));
    const lambda2 = lambda1 + Math.atan2(Math.sin(θ)*Math.sin(delta)*Math.cos(phi1), Math.cos(delta)-Math.sin(phi1)*Math.sin(phi2));
    return [rad2deg(phi2), rad2deg(lambda2)];
  }

  /**
   * Calculate geodesic distance between two points using Karney's algorithm (GeographicLib)
   * High precision for all distances
   */
  function geodesicDistance(a, b) {
    // Use Karney's algorithm (GeographicLib) for high precision
    const geod = geodesic.Geodesic.WGS84;
    const r = geod.Inverse(a[0], a[1], b[0], b[1]);
    return r.s12; // distance in meters
  }

  /**
   * Get the antipodal point (opposite side of Earth)
   */
  function getAntipode(coord) {
    const lat = -coord[0];
    let lon = coord[1] + 180;
    if (lon > 180) lon -= 360;
    return [lat, lon];
  }

  /**
   * Normalize longitude to -180 to 180 range
   */
  function normalizeLongitude(lon) {
    lon = lon % 360;
    if (lon > 180) lon -= 360;
    if (lon < -180) lon += 360;
    return lon;
  }

  // ============== COORDINATE PARSING ==============

  /**
   * Parse coordinate text input into array of [lat, lon] pairs
   */
  /**
   * Parse a single coordinate value that may be in DMS, DM, or decimal format.
   * Supported formats:
   *   26.666667           (decimal degrees)
   *   26° 40' N           (degrees + minutes + hemisphere)
   *   26° 40' 0" N        (degrees + minutes + seconds + hemisphere)
   *   26°40'N             (no spaces)
   *   26d40m0sN           (d/m/s notation)
   *   -26.666667          (negative decimal)
   *   N26° 40'            (hemisphere prefix)
   * @param {string} str - Single coordinate string
   * @returns {number|null} Decimal degrees, or null if unparseable
   */
  function parseSingleCoord(str) {
    str = str.trim();
    if (!str) return null;
    
    // Normalize smart quotes and typographic symbols
    str = str.replace(/[\u2018\u2019\u201C\u201D\u0060\u00B4]/g, "'");
    str = str.replace(/[\u2033\u201D]/g, '"');  // double prime / right double quote → "
    str = str.replace(/\u00B0/g, '°');          // degree symbol normalization
    
    // Try plain decimal first (fastest path)
    if (/^-?[\d.]+$/.test(str)) return parseFloat(str);
    
    // Detect hemisphere indicator — only at the very start or very end of string.
    // End-match: must NOT immediately follow a digit (which would be 's' for seconds in d/m/s).
    // Start-match: letter followed by optional space then digit.
    let hemi = null;
    const hemiEndMatch = str.match(/(?<!\d)([NSEWnsew])\s*$/);
    const hemiStartMatch = str.match(/^([NSEWnsew])\s*(?=\d)/);
    if (hemiEndMatch) {
      hemi = hemiEndMatch[1].toUpperCase();
      str = str.slice(0, hemiEndMatch.index).trim();
    } else if (hemiStartMatch) {
      hemi = hemiStartMatch[1].toUpperCase();
      str = str.slice(hemiStartMatch[0].length).trim();
    }
    
    // Try DMS patterns: 26° 40' 30" or 26°40'30" or 26d40m30s
    const dmsMatch = str.match(/(-?[\d.]+)\s*[°d]\s*([\d.]+)\s*['′m]\s*([\d.]+)\s*["″s]?\s*$/i);
    if (dmsMatch) {
      const deg = parseFloat(dmsMatch[1]);
      const min = parseFloat(dmsMatch[2]);
      const sec = parseFloat(dmsMatch[3]);
      let val = Math.abs(deg) + min / 60 + sec / 3600;
      if (deg < 0) val = -val;
      if (hemi === 'S' || hemi === 'W') val = -Math.abs(val);
      return val;
    }
    
    // Try DM patterns: 26° 40' or 26°40' or 26d40m
    const dmMatch = str.match(/(-?[\d.]+)\s*[°d]\s*([\d.]+)\s*['′m]?\s*$/i);
    if (dmMatch) {
      const deg = parseFloat(dmMatch[1]);
      const min = parseFloat(dmMatch[2]);
      let val = Math.abs(deg) + min / 60;
      if (deg < 0) val = -val;
      if (hemi === 'S' || hemi === 'W') val = -Math.abs(val);
      return val;
    }
    
    // Try degrees only: 26° or 26d
    const dMatch = str.match(/(-?[\d.]+)\s*[°d]\s*$/i);
    if (dMatch) {
      let val = parseFloat(dMatch[1]);
      if (hemi === 'S' || hemi === 'W') val = -Math.abs(val);
      return val;
    }
    
    // Last resort: try plain number (may have had hemisphere stripped)
    const num = parseFloat(str);
    if (!isNaN(num)) {
      if (hemi === 'S' || hemi === 'W') return -Math.abs(num);
      return num;
    }
    
    return null;
  }

  function parseCoords(input) {
    return input.trim().split("\n").filter(Boolean).map(line => {
      // Try to split on comma first (standard format)
      const commaParts = line.split(",");
      if (commaParts.length >= 2) {
        const lat = parseSingleCoord(commaParts[0]);
        const lon = parseSingleCoord(commaParts.slice(1).join(','));
        if (lat !== null && lon !== null) return [lat, normalizeLongitude(lon)];
      }
      
      // Try to split on whitespace with hemisphere indicators
      // e.g. "26° 40' N  056° 20' E" — split on N/S followed by space
      const hemiSplit = line.match(/^(.+[NSns])\s+(.+[EWew].*)$/i);
      if (hemiSplit) {
        const lat = parseSingleCoord(hemiSplit[1]);
        const lon = parseSingleCoord(hemiSplit[2]);
        if (lat !== null && lon !== null) return [lat, normalizeLongitude(lon)];
      }
      
      // Fallback: original simple parse
      const [lat, lon] = line.split(",");
      return [parseFloat(lat), normalizeLongitude(parseFloat(lon))];
    });
  }

  /**
   * Calculate geographic centroid of coordinate array using spherical mean
   */
  function calculateCentroid(coords) {
    let x = 0, y = 0, z = 0;
    coords.forEach(([la, lo]) => {
      const lat = deg2rad(la), lon = deg2rad(lo);
      x += Math.cos(lat) * Math.cos(lon);
      y += Math.cos(lat) * Math.sin(lon);
      z += Math.sin(lat);
    });
    x /= coords.length;
    y /= coords.length;
    z /= coords.length;
    const lon = Math.atan2(y, x);
    const hyp = Math.sqrt(x * x + y * y);
    const lat = Math.atan2(z, hyp);
    return [rad2deg(lat), rad2deg(lon)];
  }

  // ============== BEARING CALCULATIONS ==============

  /**
   * Calculate initial bearing from point p1 to point p2 (degrees, 0-360)
   */
  function initialBearing(p1, p2) {
    const lat1 = deg2rad(p1[0]), lon1 = deg2rad(p1[1]);
    const lat2 = deg2rad(p2[0]), lon2 = deg2rad(p2[1]);
    const dlambda = lon2 - lon1;
    const x = Math.cos(lat2) * Math.sin(dlambda);
    const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dlambda);
    return (rad2deg(Math.atan2(x, y)) + 360) % 360;
  }

  /**
   * Compute bearings and lengths for all edges of a closed polygon
   */
  function computeBearingsLengths(coords) {
    const n = coords.length, bearings = [], lengths = [];
    for (let i = 0; i < n; i++) {
      const p1 = coords[i], p2 = coords[(i + 1) % n];
      bearings.push(initialBearing(p1, p2));
      lengths.push(geodesicDistance(p1, p2));
    }
    return { bearings, lengths };
  }

  // ============== SHAPE BUILDERS ==============

  /**
   * Build a rectangle given long side (L), short side (S), rotation angle (thetaRad), and centroid
   * Returns array of 4 corner coordinates [lat, lon]
   */
  function buildRectangle(L, S, thetaRad, centroid) {
    const halfL = L / 2, halfS = S / 2;
    const vL = [Math.sin(thetaRad), Math.cos(thetaRad)];
    const vS = [Math.cos(thetaRad), -Math.sin(thetaRad)];

    function corner(dx, dy) {
      const d = Math.hypot(dx, dy);
      let br = rad2deg(Math.atan2(dx, dy));
      if (br < 0) br += 360;
      return geodesicDestination(centroid, d, br);
    }

    const dx1 = halfL * vL[0] + halfS * vS[0], dy1 = halfL * vL[1] + halfS * vS[1];
    const dx2 = halfL * vL[0] - halfS * vS[0], dy2 = halfL * vL[1] - halfS * vS[1];
    const c1 = corner(dx1, dy1), c2 = corner(dx2, dy2);
    const c3 = corner(-dx1, -dy1), c4 = corner(-dx2, -dy2);
    return [c1, c2, c3, c4];
  }

  /**
   * Build a circle as array of points given center, radius (meters), and segment count
   */
  function buildCircle(center, radius, segments = 64) {
    const points = [];
    for (let i = 0; i <= segments; i++) {
      const bearing = (i * 360) / segments;
      points.push(geodesicDestination(center, radius, bearing));
    }
    return points;
  }

  // ============== GRATICULE FUNCTIONS ==============

  /**
   * Get bounds of a graticule given centroid, longitude span (degrees), and NS extent (meters)
   */
  function getGraticuleBounds(centroid, lonSpanDeg, nsMeters) {
    const north = geodesicDestination(centroid, nsMeters / 2, 0)[0];
    const south = geodesicDestination(centroid, nsMeters / 2, 180)[0];
    const west = normalizeLongitude(centroid[1] - lonSpanDeg / 2);
    const east = normalizeLongitude(centroid[1] + lonSpanDeg / 2);
    return { north, south, west, east };
  }

  /**
   * Get bounds of an angular graticule — both dimensions defined in degrees.
   * Corners are reconstructed purely in coordinate space (no geodesic projection).
   * Edges are parallels and meridians by definition.
   * @param {number[]} centroid - [lat, lon]
   * @param {number} lonSpanDeg - Longitude span in degrees
   * @param {number} latSpanDeg - Latitude span in degrees
   * @returns {{ north, south, west, east }}
   */
  function getGraticuleBoundsAngular(centroid, lonSpanDeg, latSpanDeg) {
    const north = centroid[0] + latSpanDeg / 2;
    const south = centroid[0] - latSpanDeg / 2;
    const west = normalizeLongitude(centroid[1] - lonSpanDeg / 2);
    const east = normalizeLongitude(centroid[1] + lonSpanDeg / 2);
    return { north, south, west, east };
  }

  /**
   * Build graticule as polygon points for rendering
   * Supports both metric (nsMeters) and angular (latSpanDeg) modes.
   * @param {number[]} centroid - [lat, lon]
   * @param {number} lonSpanDeg - Longitude span in degrees
   * @param {number} nsMeters - N-S distance in meters (metric mode)
   * @param {number} [segments=32] - Number of segments per edge
   * @param {Object} [opts] - Options: { latSpanDeg } for angular mode
   */
  function buildGraticule(centroid, lonSpanDeg, nsMeters, segments = 32, opts) {
    // Support angular mode: if opts.latSpanDeg is provided, use angular bounds
    const bounds = (opts && opts.latSpanDeg != null)
      ? getGraticuleBoundsAngular(centroid, lonSpanDeg, opts.latSpanDeg)
      : getGraticuleBounds(centroid, lonSpanDeg, nsMeters);
    const { north, south, west, east } = bounds;
    const points = [];

    // North edge (west to east)
    for (let i = 0; i <= segments; i++) {
      const lon = west + (east - west) * (i / segments);
      points.push([north, normalizeLongitude(lon)]);
    }

    // East edge (north to south)
    for (let i = 1; i <= segments; i++) {
      const lat = north + (south - north) * (i / segments);
      points.push([lat, east]);
    }

    // South edge (east to west)
    for (let i = 1; i <= segments; i++) {
      const lon = east + (west - east) * (i / segments);
      points.push([south, normalizeLongitude(lon)]);
    }

    // West edge (south to north)
    for (let i = 1; i < segments; i++) {
      const lat = south + (north - south) * (i / segments);
      points.push([lat, west]);
    }

    return points;
  }

  /**
   * Get graticule corner coordinates
   * Supports both metric (nsMeters) and angular (latSpanDeg) modes.
   * @param {number[]} centroid - [lat, lon]
   * @param {number} lonSpanDeg - Longitude span in degrees
   * @param {number} nsMeters - N-S distance in meters (metric mode)
   * @param {Object} [opts] - Options: { latSpanDeg } for angular mode
   */
  function buildGraticuleCorners(centroid, lonSpanDeg, nsMeters, opts) {
    const bounds = (opts && opts.latSpanDeg != null)
      ? getGraticuleBoundsAngular(centroid, lonSpanDeg, opts.latSpanDeg)
      : getGraticuleBounds(centroid, lonSpanDeg, nsMeters);
    const { north, south, west, east } = bounds;
    return [
      [north, west],
      [north, east],
      [south, east],
      [south, west]
    ];
  }

  // ============== LOCAL ENU COORDINATES ==============

  /**
   * Convert lat/lon to local ENU (East-North-Up) coordinates relative to origin
   */
  function toLocalENU(origin, p) {
    const lat = p[0], lon = p[1];
    if (origin[0] === lat && origin[1] === lon) return { x: 0, y: 0 };

    const dist = geodesicDistance(origin, p);
    const bearing = initialBearing(origin, p);
    const bearingRad = deg2rad(bearing);

    // x = East, y = North
    const x = dist * Math.sin(bearingRad);
    const y = dist * Math.cos(bearingRad);
    return { x, y };
  }

  /**
   * Convert local ENU coordinates back to lat/lon
   */
  function fromLocalENU(origin, pt) {
    const x = pt.x, y = pt.y;
    const dist = Math.hypot(x, y);
    if (dist === 0) return [origin[0], origin[1]];

    const bearingRad = Math.atan2(x, y);
    const bearingDeg = rad2deg(bearingRad);
    const dest = geodesicDestination(origin, dist, bearingDeg);
    return dest;
  }

  // ============== CONVEX HULL ==============

  /**
   * 2D Convex Hull using Andrew's monotone chain algorithm
   * Input: array of {x, y} objects
   * Output: array of {x, y} objects forming the convex hull
   */
  function convexHull2D(points) {
    if (points.length <= 1) return points.slice();

    const pts = points.slice().sort((a, b) =>
      a.x === b.x ? a.y - b.y : a.x - b.x
    );

    const cross = (o, a, b) =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    // Build lower hull
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }

    // Build upper hull
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  /**
   * Find minimum area rectangle around convex hull using rotating calipers
   * Input: array of {x, y} objects forming convex hull
   * Output: array of 4 {x, y} corner points, or null
   */
  function minimumAreaRectangle2D(hull) {
    const n = hull.length;
    if (n === 0) return null;
    if (n === 1) {
      const p = hull[0];
      return [p, p, p, p];
    }
    if (n === 2) {
      const p0 = hull[0], p1 = hull[1];
      return [p0, p1, p1, p0];
    }

    let best = {
      area: Infinity, angle: 0,
      minX: 0, maxX: 0, minY: 0, maxY: 0
    };

    // Calculate bounding box for a given rotation angle
    function rectStatsForAngle(angle) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;

      for (const p of hull) {
        const rx = p.x * cos - p.y * sin;
        const ry = p.x * sin + p.y * cos;
        if (rx < minX) minX = rx;
        if (rx > maxX) maxX = rx;
        if (ry < minY) minY = ry;
        if (ry > maxY) maxY = ry;
      }

      const area = (maxX - minX) * (maxY - minY);
      return { area, angle, minX, maxX, minY, maxY };
    }

    // Try each edge of the hull as a potential rectangle side
    for (let i = 0; i < n; i++) {
      const p0 = hull[i];
      const p1 = hull[(i + 1) % n];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const edgeAngle = Math.atan2(dy, dx);
      const angle = -edgeAngle;

      const stats = rectStatsForAngle(angle);
      if (stats.area < best.area) best = stats;
    }

    if (!isFinite(best.area)) return null;

    // Refine the angle with finer steps
    const REFINE_DELTA = Math.PI / 180; // 1 degree
    const REFINE_STEP = REFINE_DELTA / 20; // 0.05 degree steps

    const baseAngle = best.angle;
    for (let a = baseAngle - REFINE_DELTA; a <= baseAngle + REFINE_DELTA; a += REFINE_STEP) {
      const stats = rectStatsForAngle(a);
      if (stats.area < best.area) best = stats;
    }

    // Convert back from rotated coordinates to original ENU coordinates
    const angleBack = -best.angle;
    const cosBack = Math.cos(angleBack);
    const sinBack = Math.sin(angleBack);

    function unrotate(rx, ry) {
      return {
        x: rx * cosBack - ry * sinBack,
        y: rx * sinBack + ry * cosBack
      };
    }

    // Return the four corners of the minimum area rectangle
    return [
      unrotate(best.minX, best.minY),
      unrotate(best.maxX, best.minY),
      unrotate(best.maxX, best.maxY),
      unrotate(best.minX, best.maxY)
    ];
  }

  // ============== RECTANGLE FITTING ==============

  /**
   * Error function for rectangle fitting optimization
   * Calculates sum of squared distances between candidate corners and target corners
   */
  function errorFunctionGeo(L, S, theta, abcd, centroid) {
    const cand = buildRectangle(L, S, theta, centroid);

    // Use Hungarian algorithm approximation: greedy nearest matching
    const used = new Set();
    let totalErr = 0;

    for (let i = 0; i < 4; i++) {
      let bestDist = Infinity;
      let bestJ = -1;

      for (let j = 0; j < 4; j++) {
        if (used.has(j)) continue;
        const d = geodesicDistance(cand[i], abcd[j]);
        if (d < bestDist) {
          bestDist = d;
          bestJ = j;
        }
      }

      used.add(bestJ);
      totalErr += bestDist * bestDist;
    }

    return totalErr;
  }

  /**
   * Refine rectangle parameters using multi-scale hill-climbing optimization
   */
  function refineParametersGeo(abcd, centroid, L0, S0, theta0, allowDegenerate = false) {
    // Ensure L0 >= S0 at start for consistency
    if (S0 > L0) {
      [L0, S0] = [S0, L0];
      theta0 = theta0 + Math.PI / 2;
    }

    // Multi-scale optimization: start with coarse steps, then refine
    let L = L0, S = S0, theta = theta0;
    let cur = errorFunctionGeo(L, S, theta, abcd, centroid);

    const avgLength = (L0 + S0) / 2;
    const minLength = allowDegenerate ? 0 : Math.max(1.0, avgLength * 0.02);

    // Phase 1: Coarse search with larger steps
    let dL = 0.1 * L0;  // 10% steps
    let dS = 0.1 * S0;
    let dT = deg2rad(2);  // 2 degree steps

    for (let phase = 0; phase < 3; phase++) {
      let improved = true;
      let phaseIterations = 0;

      while (improved && phaseIterations < 200) {
        improved = false;
        phaseIterations++;

        // Try more exploratory moves
        const candidates = [
          { L: L + dL, S, theta }, { L: L - dL, S, theta },
          { L, S: S + dS, theta }, { L, S: S - dS, theta },
          { L, S, theta: theta + dT }, { L, S, theta: theta - dT },
          // Also try diagonal moves
          { L: L + dL, S: S + dS, theta }, { L: L - dL, S: S - dS, theta },
          { L: L + dL, S: S - dS, theta }, { L: L - dL, S: S + dS, theta },
          // And combination with angle
          { L: L + dL, S, theta: theta + dT }, { L: L - dL, S, theta: theta - dT },
          { L, S: S + dS, theta: theta + dT }, { L, S: S - dS, theta: theta - dT }
        ];

        for (const c of candidates) {
          // Basic sanity checks
          if (c.L < minLength || c.S < minLength) continue;

          // Prevent extreme aspect ratios
          const aspectRatio = Math.max(c.L, c.S) / Math.min(c.L, c.S);
          if (aspectRatio > 50) continue;

          const e = errorFunctionGeo(c.L, c.S, c.theta, abcd, centroid);
          if (e < cur) {
            cur = e; L = c.L; S = c.S; theta = c.theta;
            improved = true;
          }
        }

        // Reduce step size gradually within phase
        dL *= 0.95; dS *= 0.95; dT *= 0.95;
      }

      // Reduce step size for next phase
      dL *= 0.1;
      dS *= 0.1;
      dT *= 0.1;
    }

    return { L, S, theta, error: cur };
  }

  // ============== RECTANGLE COMPLETERS ==============

  /**
   * Complete a rectangle/parallelogram from 3 corners (A, B, C)
   * Returns all 4 corners [A, B, C, D] where D completes the parallelogram
   */
  function completeRectangle3(coords) {
    const [A, B, C] = coords;

    // For a parallelogram ABCD: vector AB must equal vector DC
    // D is the point such that going from D to C
    // has the same bearing and distance as going from A to B

    const bearingAB = initialBearing(A, B);
    const distAB = geodesicDistance(A, B);

    // Reverse bearing: from B back to A
    const bearingBA = (bearingAB + 180) % 360;

    // D is at the reverse bearing from C
    const D = geodesicDestination(C, distAB, bearingBA);

    return [A, B, C, D];
  }

  /**
   * Check if quadrilateral is self-intersecting (bowtie/hourglass)
   * Returns true if bowtie, false if simple quadrilateral
   */
  function isBowtie(coords) {
    const [A, B, C, D] = coords;

    // Calculate cross product for each turn to see if we're going clockwise or counter-clockwise
    function crossProduct(p1, p2, p3) {
      const v1x = p2[1] - p1[1]; // lon difference
      const v1y = p2[0] - p1[0]; // lat difference
      const v2x = p3[1] - p2[1];
      const v2y = p3[0] - p2[0];
      return v1x * v2y - v1y * v2x;
    }

    const cross1 = crossProduct(A, B, C);
    const cross2 = crossProduct(B, C, D);
    const cross3 = crossProduct(C, D, A);
    const cross4 = crossProduct(D, A, B);

    // For a proper quadrilateral, all cross products should have the same sign
    const signs = [Math.sign(cross1), Math.sign(cross2), Math.sign(cross3), Math.sign(cross4)];
    const positiveCount = signs.filter(s => s > 0).length;
    const negativeCount = signs.filter(s => s < 0).length;

    // If signs are mixed (not all same), it's a bowtie
    return !(positiveCount === 4 || negativeCount === 4);
  }

  // ============== POLYGON/PATH HELPERS ==============

  /**
   * Check if a set of coordinates forms a closed polygon
   * @param {Array} coords - Array of [lat, lon] pairs
   * @returns {boolean} True if first and last points are within 1m
   */
  function isClosedPolygon(coords) {
    if (coords.length < 3) return false;
    const first = coords[0];
    const last = coords[coords.length - 1];
    const dist = geodesicDistance(first, last);
    return dist < 1;
  }

  /**
   * Calculate approximate area of a spherical polygon
   * Uses the shoelace formula adapted for spherical coordinates
   * @param {Array} coords - Array of [lat, lon] pairs forming closed polygon
   * @returns {number} Area in square meters
   */
  function calculatePolygonArea(coords) {
    if (coords.length < 3) return 0;
    
    let total = 0;
    
    for (let i = 0; i < coords.length; i++) {
      const j = (i + 1) % coords.length;
      const lat1 = deg2rad(coords[i][0]);
      const lon1 = deg2rad(coords[i][1]);
      const lat2 = deg2rad(coords[j][0]);
      const lon2 = deg2rad(coords[j][1]);
      
      total += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    
    return Math.abs(total * R * R / 2);
  }

  /**
   * Calculate center of an ENU rectangle
   * @param {Array} rect - Array of {x, y} points
   * @returns {{x: number, y: number}} Center point
   */
  function rectCentre2D(rect) {
    let cx = 0, cy = 0;
    for (const p of rect) { cx += p.x; cy += p.y; }
    return { x: cx / rect.length, y: cy / rect.length };
  }

  /**
   * Calculate total path length
   * @param {Array} coords - Array of [lat, lon] pairs
   * @returns {number} Total length in meters
   */
  function calculatePathLength(coords) {
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      total += geodesicDistance(coords[i], coords[i + 1]);
    }
    return total;
  }

  /**
   * Calculate geographic centroid using appropriate method:
   * - Closed polygons: signed-area weighted centroid via local ENU projection
   * - Open paths: distance-weighted segment midpoint centroid
   * - 1-2 points: simple mean
   */
  function calculateGeographicCentroid(coords) {
    if (!coords || coords.length === 0) return [0, 0];
    if (coords.length === 1) return [coords[0][0], coords[0][1]];
    if (coords.length === 2) return [
      (coords[0][0] + coords[1][0]) / 2,
      (coords[0][1] + coords[1][1]) / 2
    ];

    const closed = isClosedPolygon(coords);

    if (closed) {
      // Polygon centroid via signed-area weighting in local ENU
      const mean = calculateCentroid(coords);
      const enu = coords.map(c => toLocalENU(mean, c));

      let signedArea2 = 0;
      let cx = 0, cy = 0;
      const n = enu.length;

      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const cross = enu[i].x * enu[j].y - enu[j].x * enu[i].y;
        signedArea2 += cross;
        cx += (enu[i].x + enu[j].x) * cross;
        cy += (enu[i].y + enu[j].y) * cross;
      }

      if (Math.abs(signedArea2) < 1e-10) {
        return calculateCentroid(coords);
      }

      cx /= (3 * signedArea2);
      cy /= (3 * signedArea2);

      return fromLocalENU(mean, { x: cx, y: cy });

    } else {
      // Open path centroid via distance-weighted segment midpoints
      let totalWeight = 0;
      let wx = 0, wy = 0, wz = 0;

      for (let i = 0; i < coords.length - 1; i++) {
        const segLen = geodesicDistance(coords[i], coords[i + 1]);
        if (segLen === 0) continue;

        const midLat = (coords[i][0] + coords[i + 1][0]) / 2;
        const midLon = (coords[i][1] + coords[i + 1][1]) / 2;
        const lat = deg2rad(midLat);
        const lon = deg2rad(midLon);

        wx += Math.cos(lat) * Math.cos(lon) * segLen;
        wy += Math.cos(lat) * Math.sin(lon) * segLen;
        wz += Math.sin(lat) * segLen;
        totalWeight += segLen;
      }

      if (totalWeight === 0) return calculateCentroid(coords);

      wx /= totalWeight;
      wy /= totalWeight;
      wz /= totalWeight;

      const lon = Math.atan2(wy, wx);
      const hyp = Math.sqrt(wx * wx + wy * wy);
      const lat = Math.atan2(wz, hyp);

      return [rad2deg(lat), rad2deg(lon)];
    }
  }

  // ============== EXPORT ==============

  global.GeoMath = {
    // Constants
    R,
    deg2rad,
    rad2deg,

    // Basic geodesic
    geodesicDestination,
    geodesicDistance,
    getAntipode,
    normalizeLongitude,

    // Coordinate parsing
    parseSingleCoord,
    parseCoords,
    calculateCentroid,

    // Bearings
    initialBearing,
    computeBearingsLengths,

    // Shape builders
    buildRectangle,
    buildCircle,

    // Graticule
    getGraticuleBounds,
    getGraticuleBoundsAngular,
    buildGraticule,
    buildGraticuleCorners,

    // Local coordinates
    toLocalENU,
    fromLocalENU,

    // Convex hull
    convexHull2D,
    minimumAreaRectangle2D,

    // Rectangle fitting
    errorFunctionGeo,
    refineParametersGeo,

    // Completers
    completeRectangle3,
    isBowtie,

    // Polygon/Path helpers
    isClosedPolygon,
    calculatePolygonArea,
    calculateGeographicCentroid,
    rectCentre2D,
    calculatePathLength
  };

})(typeof window !== 'undefined' ? window : this);
