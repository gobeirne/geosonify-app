// ============================================================
// import-accuracy.js — geosonify Import Accuracy
//
// Makes import loss *visible and optimisable* instead of silent.
//
// Two jobs:
//   1. Round-trip error readout — encode the imported shape at the
//      current grid + iterations, decode it back, and report the mean
//      and max per-vertex displacement, plus the iteration count that
//      would bring the worst vertex under a target. Informational:
//      the user drives the +/- stepper themselves.
//
//   2. Representation comparison — for shapes that are (near) a
//      rectangle, compare the general path/poly encoding against the
//      bespoke rectangle encoding on BOTH error and URL length, and
//      against an optional "snap to rectangle" that regularises the
//      corners. All three show their own error so the user chooses
//      with eyes open; nothing is altered silently.
//
// This module is deliberately free of DOM and of geosonify's encoder
// internals: callers inject the real encode→decode round-trip as a
// function, so the numbers reported are the app's actual loss, never
// a reimplementation's approximation.
// ============================================================

const ImportAccuracy = (function () {
  'use strict';

  // Earth radius for quick equirectangular metres; callers may inject a
  // geodesic distance for exactness (see makeDistance).
  const R = 6378137;
  const D2R = Math.PI / 180;

  /**
   * Distance helper. If a geodesic fn is provided (e.g. GeoMath.geodesicDistance
   * taking [lat,lon] pairs), use it; otherwise fall back to equirectangular,
   * which is accurate to <0.5% at the cell scales that matter here.
   */
  function makeDistance(geodesicFn) {
    if (typeof geodesicFn === 'function') {
      return (a, b) => geodesicFn(a, b);
    }
    return (a, b) => {
      const latRef = (a[0] + b[0]) / 2 * D2R;
      const dLat = (b[0] - a[0]) * D2R * R;
      const dLon = (b[1] - a[1]) * D2R * R * Math.cos(latRef);
      return Math.hypot(dLat, dLon);
    };
  }

  /**
   * Per-vertex error between two coordinate lists of equal length.
   * Returns { mean, max, maxIndex, n, perVertex:[…] } in metres.
   *
   * original / roundtrip: arrays of [lat, lon].
   */
  function vertexError(original, roundtrip, geodesicFn) {
    const dist = makeDistance(geodesicFn);
    const n = Math.min(original.length, roundtrip.length);
    if (n === 0) return { mean: 0, max: 0, maxIndex: -1, n: 0, perVertex: [] };
    let sum = 0, max = 0, maxIndex = 0;
    const perVertex = new Array(n);
    for (let i = 0; i < n; i++) {
      const d = dist(original[i], roundtrip[i]);
      perVertex[i] = d;
      sum += d;
      if (d > max) { max = d; maxIndex = i; }
    }
    return { mean: sum / n, max, maxIndex, n, perVertex };
  }

  /**
   * Inherent precision of the source coordinates, inferred from the
   * number of decimal places present. A property at 6 dp carries ~0.1 m
   * of real precision; driving the grid finer than this chases noise.
   * Returns metres (latitude-direction; good enough as a floor).
   */
  function sourcePrecisionMetres(coords) {
    let maxDp = 0;
    const sample = coords.slice(0, Math.min(coords.length, 200));
    for (const c of sample) {
      for (const v of [c[0], c[1]]) {
        const s = String(v);
        const dot = s.indexOf('.');
        if (dot >= 0) {
          const dp = s.length - dot - 1;
          if (dp > maxDp) maxDp = dp;
        }
      }
    }
    // 1 degree of latitude ≈ 111320 m; one dp is a tenth of the previous.
    return 111320 * Math.pow(10, -maxDp);
  }

  /**
   * Suggest the iteration count that brings max vertex error under a
   * target, by probing the injected round-trip across a range.
   *
   * roundTripAt(iterations) -> array of [lat,lon] (the decoded shape)
   * opts:
   *   minIter, maxIter      — search bounds (inclusive)
   *   currentIter           — where the user is now
   *   targetMetres          — desired max error (default: source precision)
   *   original              — source coords for comparison
   *   geodesicFn            — optional exact distance
   *
   * Returns {
   *   current: { iter, mean, max },
   *   suggested: { iter, mean, max } | null,   // smallest iter meeting target
   *   floor: <metres>,        // source precision / unavoidable residual
   *   ladder: [ { iter, mean, max } ],         // full probe, for display
   *   alreadyGood: <bool>
   * }
   */
  function suggestIterations(roundTripAt, opts) {
    const { original, minIter, maxIter, currentIter, geodesicFn } = opts;
    const target = opts.targetMetres != null
      ? opts.targetMetres
      : Math.max(sourcePrecisionMetres(original), 0.01);

    const ladder = [];
    let suggested = null;
    let current = null;

    for (let it = minIter; it <= maxIter; it++) {
      let decoded;
      try { decoded = roundTripAt(it); }
      catch (e) { continue; }
      if (!decoded || decoded.length === 0) continue;
      const err = vertexError(original, decoded, geodesicFn);
      const row = { iter: it, mean: err.mean, max: err.max };
      ladder.push(row);
      if (it === currentIter) current = row;
      if (suggested === null && err.max <= target) suggested = row;
    }

    if (!current && ladder.length) {
      // currentIter outside probe range; use nearest
      current = ladder.reduce((a, b) =>
        Math.abs(b.iter - currentIter) < Math.abs(a.iter - currentIter) ? b : a);
    }

    const alreadyGood = current && suggested && suggested.iter <= current.iter;

    return {
      current,
      suggested,
      floor: target,
      ladder,
      alreadyGood: !!alreadyGood
    };
  }

  // ─────────────────────────────────────────────────────────
  // Rectangle fit
  // ─────────────────────────────────────────────────────────

  /**
   * How well does a polygon match a rectangle? Works in a local ENU
   * frame supplied by the caller (so geosonify's own toLocalENU is the
   * single source of truth for the projection).
   *
   * enuPoints: [{x, y}, …]  — the shape's vertices in local metres
   * rectCorners: [{x, y} ×4] — the fitted rectangle's corners (e.g. from
   *              minimumAreaRectangle2D), same frame
   *
   * Returns {
   *   maxDevM,    // farthest vertex from the rectangle's outline (metres)
   *   meanDevM,
   *   isRectangle // maxDev within a small tolerance of the shape's size
   * }
   *
   * We measure each vertex's distance to the nearest rectangle EDGE
   * (not corner), because a true rectangle's vertices sit exactly on the
   * outline; deviation from the outline is the honest "is this a
   * rectangle?" signal.
   */
  function rectangleFit(enuPoints, rectCorners, toleranceM) {
    const tol = toleranceM != null ? toleranceM : 0.5;
    let maxDev = 0, sum = 0, n = 0;
    // distinct vertices only (drop a repeated closing point)
    const pts = dropClosing(enuPoints);
    for (const p of pts) {
      let best = Infinity;
      for (let i = 0; i < 4; i++) {
        const a = rectCorners[i], b = rectCorners[(i + 1) % 4];
        best = Math.min(best, pointToSegment(p, a, b));
      }
      maxDev = Math.max(maxDev, best);
      sum += best; n++;
    }
    return {
      maxDevM: maxDev,
      meanDevM: n ? sum / n : 0,
      isRectangle: maxDev <= tol
    };
  }

  function dropClosing(pts) {
    if (pts.length > 2) {
      const a = pts[0], b = pts[pts.length - 1];
      const same = (a.x === b.x && a.y === b.y) ||
                   (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9);
      if (same) return pts.slice(0, -1);
    }
    return pts;
  }

  function pointToSegment(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const wx = p.x - a.x, wy = p.y - a.y;
    const len2 = vx * vx + vy * vy;
    let t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * vx, cy = a.y + t * vy;
    return Math.hypot(p.x - cx, p.y - cy);
  }

  // ─────────────────────────────────────────────────────────
  // Representation comparison
  // ─────────────────────────────────────────────────────────

  /**
   * Compare candidate representations on (error, URL length). Each
   * candidate is supplied already-evaluated by the caller (which owns
   * the real encoders); this function just ranks and frames them.
   *
   * candidates: [ {
   *   id,             // 'pathpoly' | 'rect' | 'rect-snap'
   *   label,          // human label
   *   maxErrorM, meanErrorM,
   *   urlLength,      // characters of the encoded payload
   *   altersData      // true for 'rect-snap' (regularises corners)
   * } ]
   *
   * opts.targetMetres — error budget (default: source precision)
   *
   * Returns the same list, sorted best-first, each annotated with:
   *   meetsTarget, recommended (one of them), reason
   *
   * Ranking: among those meeting the target, shortest URL wins; if none
   * meet it, the lowest max-error wins. A data-altering candidate only
   * wins if it both meets the target AND is strictly shorter than every
   * non-altering candidate that also meets it — we never prefer altering
   * the user's data for a marginal gain.
   */
  function compareRepresentations(candidates, opts) {
    opts = opts || {};
    const target = opts.targetMetres != null ? opts.targetMetres : Infinity;
    const annotated = candidates.map(c => ({
      ...c,
      meetsTarget: c.maxErrorM <= target
    }));

    const meeting = annotated.filter(c => c.meetsTarget);
    let recommended = null, reason = '';

    if (meeting.length) {
      // Prefer non-altering candidates; among them, shortest URL.
      const safe = meeting.filter(c => !c.altersData);
      const pool = safe.length ? safe : meeting;
      pool.sort((a, b) => a.urlLength - b.urlLength || a.maxErrorM - b.maxErrorM);
      recommended = pool[0];

      // Only let an altering candidate win if it's strictly shorter than
      // the best safe option by a meaningful margin.
      if (safe.length) {
        const bestSafe = pool[0];
        const altered = meeting.filter(c => c.altersData)
          .sort((a, b) => a.urlLength - b.urlLength)[0];
        if (altered && altered.urlLength < bestSafe.urlLength) {
          // Surface it, but don't auto-recommend — caller shows both.
          reason = `${bestSafe.label} is the shortest faithful option; ` +
                   `${altered.label} is shorter still but changes the corners.`;
        } else {
          reason = `${bestSafe.label} meets the accuracy target with the shortest code.`;
        }
        recommended = bestSafe;
      } else {
        reason = `${recommended.label} meets the accuracy target.`;
      }
    } else {
      // None meet target — recommend the most accurate, flag the shortfall.
      annotated.sort((a, b) => a.maxErrorM - b.maxErrorM);
      recommended = annotated[0];
      reason = `No option reaches the target yet; ${recommended.label} is the most accurate. ` +
               `Try raising iterations.`;
    }

    // Sort the returned list best-first for display: meets-target first,
    // then by URL length, then error.
    annotated.sort((a, b) => {
      if (a.meetsTarget !== b.meetsTarget) return a.meetsTarget ? -1 : 1;
      return a.urlLength - b.urlLength || a.maxErrorM - b.maxErrorM;
    });

    return { candidates: annotated, recommended, reason, target };
  }

  // ─────────────────────────────────────────────────────────
  // Formatting helpers (shared with the UI)
  // ─────────────────────────────────────────────────────────

  function fmtError(m) {
    if (m == null || !isFinite(m)) return '—';
    if (m < 0.01) return '< 1 cm';
    if (m < 1) return (m * 100).toFixed(1) + ' cm';
    if (m < 1000) return m.toFixed(m < 10 ? 2 : 1) + ' m';
    return (m / 1000).toFixed(2) + ' km';
  }

  return {
    vertexError,
    sourcePrecisionMetres,
    suggestIterations,
    rectangleFit,
    compareRepresentations,
    fmtError,
    // exposed for tests
    _pointToSegment: pointToSegment,
    _makeDistance: makeDistance
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ImportAccuracy;
