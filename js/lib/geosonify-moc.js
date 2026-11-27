/*
  geosonify-moc.js  v1.0  — sky areas as MOCs (IVOA MOC 2.0, space only)

  A MOC ("Multi-Order Coverage map") says which part of the sky an area covers
  as a set of NESTED HEALPix cells of mixed sizes: big cells where the area is
  solid, small ones along its edge. Astronomers' tools (Aladin, MOCPy, the CDS
  MocServer, survey archives) read and write them, so a Geosonify sky shape
  written as a MOC can be used there, and a MOC from there can be read here.

  What this file does (pure functions; no DOM, no URL, no frozen format):

    fromCells(cells, maxOrder)       cells [{order, ipix}] → MOC
    fromPolygon(rings, opts)         closed [dec, ra] rings → the MOC of the area
                                     they enclose (holes subtract)
    union / intersection / difference
    toASCII(moc) / toJSON(moc)       MOC 2.0 serialisations, canonical form
    parse(text)                      ASCII or JSON → MOC (either form accepted)
    cells(moc)                       the canonical cells, coarsest first
    areaDeg2(moc), cellCount(moc)

  CANONICAL FORM. A MOC is held as sorted, merged, half-open ranges of
  order-29 cell indices (BigInt), plus its maximum order. Written out, every
  run of cells is the fewest, largest cells that tile it (four siblings are
  always written as their parent), orders ascend, indices ascend, consecutive
  indices of one order fold into a-b, and when no cell sits at the maximum
  order a bare "max/" says what it is. Two MOCs covering the same cells at the
  same maximum order therefore serialise identically, byte for byte. This is
  what MOCPy 0.21 writes; spec/moc-vectors.json holds MOCPy's own output for
  each case and the self-test requires the same bytes.

  ICRS only: a sky MOC is in ICRS by definition (MOC 2.0 §2), and Geosonify's
  sky shapes are ICRS [dec, ra] already. HEALPix is the standard NESTED scheme
  with theta = 90° − dec, phi = ra, as in healpy, cdshealpix and MOCPy.

  POLYGON COVERAGE (fromPolygon). Each ring is a closed spherical polygon with
  great-circle sides; its inside is the smaller of the two regions it bounds,
  as in MOCPy ("the default polygon is the smallest one"). Cells are refined
  from order 0: a cell wholly inside is kept whole, one wholly outside is
  dropped, and one the boundary passes through is split, down to maxOrder,
  where any cell the area touches is kept (an "inclusive" MOC: it contains
  the whole area, with at most a ring of edge cells extra). Polygon coverage
  stops at order 24 (cells of about 12 milliarcseconds), the deepest order at
  which the HEALPix engine's index arithmetic is exact in a Number; reading,
  writing and combining MOCs go to order 29, the standard's limit.

  How close to MOCPy: MOCPy (cdshealpix) also keeps every cell the polygon
  overlaps, by its own edge arithmetic, so the two agree on every cell except
  occasionally one that only grazes the boundary. The self-test reports the
  difference for each MOCPy polygon vector and requires it to stay within a
  small fraction of the edge cells; see the vectors file for the numbers.

  Limits: a ring must fit within a hemisphere (its inside is found from a
  point opposite its centre), and its sides must not cross each other.

  `node js/lib/geosonify-moc.js --selftest` runs the checks against the
  stored MOCPy vectors (it loads geosonify-healpix.js for the engine).
*/
(function (global) {
  'use strict';

  var VERSION = 'v1.0';
  var MAX_ORDER = 29;              // the standard's limit
  var POLY_MAX_ORDER = 24;         // exact Number index arithmetic in the engine
  var D2R = Math.PI / 180;

  // ── engine (HealpixGrids is a bare top-level const in the browser) ───────
  var _engine = null;
  function setEngine(hp) { _engine = hp || null; return _engine; }
  function HP() {
    if (_engine) return _engine;
    try { if (typeof HealpixGrids !== 'undefined' && HealpixGrids) return HealpixGrids; } catch (e) {}
    if (global && global.HealpixGrids) return global.HealpixGrids;
    return null;
  }

  // ── ranges of order-29 indices ──────────────────────────────────────────
  function shift(order) { return BigInt(2 * (MAX_ORDER - order)); }
  function checkOrder(o) {
    if (!(Number.isInteger(o) && o >= 0 && o <= MAX_ORDER)) throw new Error('MOC: order must be 0–29, got ' + o);
    return o;
  }
  function big(v) {
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
    if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
    throw new Error('MOC: bad cell index ' + v);
  }
  // sort + merge [lo, hi) pairs (BigInt), in place-safe
  function normalise(ranges) {
    var r = ranges.filter(function (x) { return x[0] < x[1]; })
      .sort(function (a, b) { return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0); });
    var out = [];
    for (var i = 0; i < r.length; i++) {
      var last = out[out.length - 1];
      if (last && r[i][0] <= last[1]) { if (r[i][1] > last[1]) last[1] = r[i][1]; }
      else out.push([r[i][0], r[i][1]]);
    }
    return out;
  }
  function make(ranges, maxOrder) { return { maxOrder: checkOrder(maxOrder), ranges: normalise(ranges) }; }
  function empty(maxOrder) { return make([], maxOrder === undefined ? 0 : maxOrder); }

  function cellRange(order, ipix) {
    var s = shift(order), ip = big(ipix);
    if (ip < 0n || ip >= 12n << BigInt(2 * order)) throw new Error('MOC: cell ' + order + '/' + ip + ' out of range');
    return [ip << s, (ip + 1n) << s];
  }

  function fromCells(cells, maxOrder) {
    var top = 0;
    var r = (cells || []).map(function (c) {
      checkOrder(c.order); if (c.order > top) top = c.order;
      return cellRange(c.order, c.ipix);
    });
    return make(r, maxOrder === undefined ? top : Math.max(checkOrder(maxOrder), top));
  }

  // Degrading to a coarser maximum order widens partial cells outward.
  function degrade(moc, order) {
    checkOrder(order);
    if (order >= moc.maxOrder) return make(moc.ranges, moc.maxOrder);
    var s = shift(order), unit = 1n << s;
    return make(moc.ranges.map(function (x) {
      return [(x[0] >> s) << s, ((x[1] + unit - 1n) >> s) << s];
    }), order);
  }

  // ── set operations (result at the larger maximum order) ─────────────────
  function union(a, b) { return make(a.ranges.concat(b.ranges), Math.max(a.maxOrder, b.maxOrder)); }
  function intersection(a, b) {
    var out = [], i = 0, j = 0;
    while (i < a.ranges.length && j < b.ranges.length) {
      var lo = a.ranges[i][0] > b.ranges[j][0] ? a.ranges[i][0] : b.ranges[j][0];
      var hi = a.ranges[i][1] < b.ranges[j][1] ? a.ranges[i][1] : b.ranges[j][1];
      if (lo < hi) out.push([lo, hi]);
      if (a.ranges[i][1] < b.ranges[j][1]) i++; else j++;
    }
    return make(out, Math.max(a.maxOrder, b.maxOrder));
  }
  function difference(a, b) {
    var out = [], j = 0;
    a.ranges.forEach(function (x) {
      var lo = x[0], hi = x[1];
      while (j < b.ranges.length && b.ranges[j][1] <= lo) j++;
      var k = j;
      while (k < b.ranges.length && b.ranges[k][0] < hi) {
        if (b.ranges[k][0] > lo) out.push([lo, b.ranges[k][0]]);
        if (b.ranges[k][1] > lo) lo = b.ranges[k][1];
        if (lo >= hi) break;
        k++;
      }
      if (lo < hi) out.push([lo, hi]);
    });
    return make(out, Math.max(a.maxOrder, b.maxOrder));
  }

  // ── canonical cells ─────────────────────────────────────────────────────
  // Each range split into the fewest, largest aligned cells (never deeper than
  // the maximum order, which the ranges are aligned to by construction).
  function cells(moc) {
    var out = [];
    moc.ranges.forEach(function (x) {
      var a = x[0], b = x[1];
      while (a < b) {
        var t = MAX_ORDER;                         // try the largest cell first
        while (t > 0) {
          var size = 1n << BigInt(2 * t);
          if (a % size === 0n && a + size <= b) break;
          t--;
        }
        var order = MAX_ORDER - t;
        out.push({ order: order, ipix: a >> BigInt(2 * t) });
        a += 1n << BigInt(2 * t);
      }
    });
    out.sort(function (p, q) {
      return p.order - q.order || (p.ipix < q.ipix ? -1 : (p.ipix > q.ipix ? 1 : 0));
    });
    return out;
  }
  function byOrder(moc) {
    var m = {};
    cells(moc).forEach(function (c) { (m[c.order] = m[c.order] || []).push(c.ipix); });
    return m;
  }

  function cellCount(moc) { return cells(moc).length; }
  // Exact share of the sphere, then square degrees.
  function areaDeg2(moc) {
    var n = 0n;
    moc.ranges.forEach(function (x) { n += x[1] - x[0]; });
    var whole = 12n << BigInt(2 * MAX_ORDER);
    var frac = Number(n * 1000000000000n / whole) / 1e12;
    return frac * 4 * Math.PI / (D2R * D2R);
  }

  // ── MOC 2.0 ASCII ───────────────────────────────────────────────────────
  function runs(list) {                           // sorted BigInts → "a-b c"
    var parts = [];
    for (var i = 0; i < list.length;) {
      var j = i;
      while (j + 1 < list.length && list[j + 1] === list[j] + 1n) j++;
      parts.push(i === j ? String(list[i]) : list[i] + '-' + list[j]);
      i = j + 1;
    }
    return parts.join(' ');
  }
  function toASCII(moc) {
    var m = byOrder(moc), orders = Object.keys(m).map(Number).sort(function (a, b) { return a - b; });
    var parts = orders.map(function (o) { return o + '/' + runs(m[o]); });
    if (!m[moc.maxOrder]) parts.push(moc.maxOrder + '/');
    return parts.join(' ');
  }
  function toJSON(moc) {
    var m = byOrder(moc), orders = Object.keys(m).map(Number).sort(function (a, b) { return a - b; });
    var lines = orders.map(function (o) { return '  "' + o + '": [' + m[o].map(String).join(', ') + ']'; });
    if (!m[moc.maxOrder]) lines.push('  "' + moc.maxOrder + '": []');
    return '{\n' + lines.join(',\n') + '\n}';
  }

  function parseASCII(text) {
    var s = String(text).trim();
    if (/^t/i.test(s)) throw new Error('MOC: a time MOC ("t…") is not a sky area');
    s = s.replace(/^s(?=\d)/i, '');               // MOC 2.0 space prefix
    var tokens = s.split(/[\s,]+/).filter(Boolean);
    var order = null, top = -1, r = [];
    tokens.forEach(function (tok) {
      var m = /^(\d+)\/(.*)$/.exec(tok);
      if (m) {
        order = checkOrder(parseInt(m[1], 10)); if (order > top) top = order;
        tok = m[2];
        if (!tok) return;
      }
      if (order === null) throw new Error('MOC: "' + tok + '" before any order/');
      var rm = /^(\d+)(?:-(\d+))?$/.exec(tok);
      if (!rm) throw new Error('MOC: cannot read "' + tok + '"');
      var a = BigInt(rm[1]), b = rm[2] !== undefined ? BigInt(rm[2]) : a;
      if (b < a) throw new Error('MOC: range ' + tok + ' runs backwards');
      var lo = cellRange(order, a)[0], hi = cellRange(order, b)[1];
      r.push([lo, hi]);
    });
    if (top < 0) throw new Error('MOC: no order/ found');
    return make(r, top);
  }
  function parseJSON(obj) {
    if (typeof obj === 'string') obj = JSON.parse(obj);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('MOC: JSON must be an object of order: [cells]');
    var top = -1, r = [];
    Object.keys(obj).forEach(function (k) {
      if (!/^\d+$/.test(k)) throw new Error('MOC: JSON key "' + k + '" is not an order');
      var o = checkOrder(parseInt(k, 10)); if (o > top) top = o;
      var list = obj[k];
      if (!Array.isArray(list)) throw new Error('MOC: JSON order ' + k + ' is not a list');
      list.forEach(function (ip) { r.push(cellRange(o, big(typeof ip === 'number' ? ip : String(ip)))); });
    });
    if (top < 0) throw new Error('MOC: empty JSON');
    return make(r, top);
  }
  // Either serialisation; JSON is recognised by its brace.
  function parse(text) {
    var s = String(text || '').trim();
    if (!s) throw new Error('MOC: nothing to read');
    if (s[0] === '{') {
      // Indices past 2^53 must not pass through Number: quote them first.
      return parseJSON(JSON.parse(s.replace(/(\d{16,})/g, '"$1"')));
    }
    return parseASCII(s);
  }

  // ── geometry on the unit sphere ─────────────────────────────────────────
  function vec(dec, ra) {
    var d = dec * D2R, a = ra * D2R, c = Math.cos(d);
    return [c * Math.cos(a), c * Math.sin(a), Math.sin(d)];
  }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function unit(a) { var n = Math.sqrt(dot(a, a)); return n ? [a[0] / n, a[1] / n, a[2] / n] : null; }

  // Does the minor arc a→b cross the minor arc c→d?
  function arcsCross(a, b, n1, c, d, n2) {
    var t = unit(cross(n1, n2));
    if (!t) return false;                          // same great circle
    for (var s = 0; s < 2; s++) {
      var x = s ? [-t[0], -t[1], -t[2]] : t;
      if (dot(cross(a, x), n1) >= 0 && dot(cross(x, b), n1) >= 0 &&
          dot(cross(c, x), n2) >= 0 && dot(cross(x, d), n2) >= 0) return true;
    }
    return false;
  }

  function prepRing(ring) {
    var pts = ring.slice();
    if (pts.length > 2) {
      var a = pts[0], z = pts[pts.length - 1];
      if (Math.abs(a[0] - z[0]) < 1e-12 && Math.abs(a[1] - z[1]) < 1e-12) pts.pop();
    }
    if (pts.length < 3) throw new Error('MOC: a ring needs at least 3 corners');
    var V = pts.map(function (p) { return vec(p[0], p[1]); });
    var E = V.map(function (v, i) { var w = V[(i + 1) % V.length]; return { a: v, b: w, n: cross(v, w) }; });
    var sum = V.reduce(function (s, v) { return [s[0] + v[0], s[1] + v[1], s[2] + v[2]]; }, [0, 0, 0]);
    var c = unit(sum);
    if (!c) throw new Error('MOC: a ring must fit within a hemisphere');
    var out = [-c[0], -c[1], -c[2]];               // a point outside the ring
    V.forEach(function (v) {
      if (dot(v, c) <= 1e-12) throw new Error('MOC: a ring must fit within a hemisphere');
    });
    return { pts: pts, V: V, E: E, out: out };
  }
  // Inside by parity of crossings on the arc from the point to the outside point.
  function inside(R, p) {
    var n = cross(p, R.out), k = 0;
    for (var i = 0; i < R.E.length; i++) if (arcsCross(p, R.out, n, R.E[i].a, R.E[i].b, R.E[i].n)) k++;
    return (k & 1) === 1;
  }

  // ── polygon → MOC ───────────────────────────────────────────────────────
  function cellVecs(core, order, ip, step) {
    var nside = Math.pow(2, order), pts = [];
    var corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (var e = 0; e < 4; e++) {
      var a = corners[e], b = corners[(e + 1) % 4];
      for (var s = 0; s < step; s++) {
        var t = s / step;
        pts.push(core.pixcoord2vec_nest(nside, ip, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t));
      }
    }
    return pts;
  }

  // Suggest the deepest order whose edge cells stay within `budget` (perimeter
  // over cell side), capped at POLY_MAX_ORDER.
  function suggestOrder(rings, budget) {
    budget = budget || 3000;
    var per = 0;
    rings.forEach(function (ring) {
      var R = prepRing(ring);
      R.V.forEach(function (v, i) {
        var w = R.V[(i + 1) % R.V.length];
        per += Math.atan2(Math.sqrt(dot(cross(v, w), cross(v, w))), dot(v, w));
      });
    });
    var k = 0;
    while (k < POLY_MAX_ORDER && per / (1.0233267079464885 / Math.pow(2, k + 1)) <= budget) k++;
    return k;
  }

  /*
    rings: closed [dec, ra] rings (the area is their union); opts.holes:
    rings subtracted afterwards; opts.maxOrder (default suggestOrder, at most
    24); opts.budget (edge cells for the default). Returns the MOC.
  */
  function fromPolygon(rings, opts) {
    opts = opts || {};
    if (!rings || !rings.length) throw new Error('MOC: no closed ring to cover');
    var hp = HP();
    if (!hp || !hp._core || !hp._core.pixcoord2vec_nest || !hp.nestIndex) throw new Error('MOC: HEALPix engine needed');
    var maxOrder = opts.maxOrder === undefined ? suggestOrder(rings.concat(opts.holes || []), opts.budget) : opts.maxOrder;
    if (!(Number.isInteger(maxOrder) && maxOrder >= 0 && maxOrder <= POLY_MAX_ORDER)) {
      throw new Error('MOC: polygon order must be 0–' + POLY_MAX_ORDER);
    }
    function one(ring) { return cover(hp, prepRing(ring), maxOrder); }
    var moc = empty(maxOrder);
    rings.forEach(function (r) { moc = union(moc, one(r)); });
    // A hole removes only the cells wholly inside it, so the result still
    // contains every part of the area (edge cells of the hole stay).
    (opts.holes || []).forEach(function (h) { moc = difference(moc, interior(hp, prepRing(h), maxOrder)); });
    return moc;
  }

  // Angular distance from p to the minor arc of edge E (radians).
  function arcDist(p, E) {
    var nn = unit(E.n);
    if (nn) {
      var s = dot(p, nn);
      var q = unit([p[0] - s * nn[0], p[1] - s * nn[1], p[2] - s * nn[2]]);
      if (q && dot(cross(E.a, q), E.n) >= 0 && dot(cross(q, E.b), E.n) >= 0) return Math.asin(Math.min(1, Math.abs(s)));
    }
    return Math.min(Math.acos(Math.max(-1, Math.min(1, dot(p, E.a)))), Math.acos(Math.max(-1, Math.min(1, dot(p, E.b)))));
  }

  /*
    inclusive (keepPartial): every cell the ring touches; otherwise only cells
    wholly inside. A cell is "near" the boundary when a side of the ring passes
    within the cell's circumradius of its centre, or a corner of the ring lies
    in it; a cell that is not near is wholly inside or wholly outside, decided
    by its centre. Near cells are split, so the curved HEALPix sides never need
    to be traced exactly above the maximum order; at the maximum order a near
    cell is tested against its traced boundary (sides sampled finely enough
    that the sampling error is far below the cell size).
  */
  function walk(hp, R, maxOrder, keepPartial) {
    var core = hp._core, ranges = [];
    var vIp = R.pts.map(function (p) { return Number(hp.nestIndex(p[0], ((p[1] % 360) + 360) % 360, maxOrder)); });
    var stack = [];
    for (var f = 11; f >= 0; f--) stack.push([0, f]);
    while (stack.length) {
      var it = stack.pop(), k = it[0], ip = it[1];
      var nside = Math.pow(2, k);
      var C = core.pixcoord2vec_nest(nside, ip, 0.5, 0.5);
      var K = cellVecs(core, k, ip, 2);
      var rad = 0;
      K.forEach(function (p) { var a = Math.acos(Math.max(-1, Math.min(1, dot(p, C)))); if (a > rad) rad = a; });
      rad = rad * 1.05 + 1e-12;
      var near = false;
      var div = Math.pow(4, maxOrder - k);
      for (var i = 0; i < vIp.length && !near; i++) if (Math.floor(vIp[i] / div) === ip) near = true;
      for (var e = 0; e < R.E.length && !near; e++) if (arcDist(C, R.E[e]) <= rad) near = true;
      if (!near) {
        if (inside(R, C)) ranges.push(cellRange(k, ip));
        continue;
      }
      if (k < maxOrder) {
        for (var c = 3; c >= 0; c--) stack.push([k + 1, ip * 4 + c]);
        continue;
      }
      // maximum order, near the boundary
      var vertexIn = false;
      for (var vi = 0; vi < vIp.length; vi++) if (vIp[vi] === ip) { vertexIn = true; break; }
      var B = cellVecs(core, k, ip, k < 6 ? 16 : (k < 12 ? 4 : 2));
      var crosses = false;
      for (var j = 0; j < B.length && !crosses; j++) {
        var a = B[j], b = B[(j + 1) % B.length], n = cross(a, b);
        for (var ee = 0; ee < R.E.length; ee++) {
          if (arcsCross(a, b, n, R.E[ee].a, R.E[ee].b, R.E[ee].n)) { crosses = true; break; }
        }
      }
      var cIn = inside(R, C);
      if (keepPartial) {
        if (vertexIn || crosses || cIn) ranges.push(cellRange(k, ip));
      } else if (!vertexIn && !crosses && cIn) {
        ranges.push(cellRange(k, ip));
      }
    }
    return make(ranges, maxOrder);
  }
  function cover(hp, R, maxOrder) { return walk(hp, R, maxOrder, true); }
  function interior(hp, R, maxOrder) { return walk(hp, R, maxOrder, false); }

  // Does the MOC contain this direction?
  function contains(moc, dec, ra) {
    var hp = HP();
    if (!hp || !hp.nestIndex) throw new Error('MOC: HEALPix engine needed');
    var ip = BigInt(hp.nestIndex(dec, ((ra % 360) + 360) % 360, MAX_ORDER));
    for (var i = 0; i < moc.ranges.length; i++) {
      if (ip < moc.ranges[i][0]) return false;
      if (ip < moc.ranges[i][1]) return true;
    }
    return false;
  }

  var API = {
    VERSION: VERSION, MAX_ORDER: MAX_ORDER, POLY_MAX_ORDER: POLY_MAX_ORDER,
    setEngine: setEngine,
    fromCells: fromCells, fromPolygon: fromPolygon, suggestOrder: suggestOrder,
    union: union, intersection: intersection, difference: difference, degrade: degrade,
    cells: cells, cellCount: cellCount, areaDeg2: areaDeg2, contains: contains,
    toASCII: toASCII, toJSON: toJSON, parse: parse, parseASCII: parseASCII, parseJSON: parseJSON,
    empty: empty
  };
  global.GeosonifyMOC = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

  // ── self-test (Node) ────────────────────────────────────────────────────
  if (typeof require !== 'undefined' && typeof process !== 'undefined' &&
      require.main === module && process.argv.indexOf('--selftest') >= 0) {
    selftest();
  }
  function selftest() {
    var fs = require('fs'), path = require('path'), vm = require('vm');
    var hpSrc = fs.readFileSync(path.join(__dirname, 'geosonify-healpix.js'), 'utf8');
    var ctx = { console: console, BigInt: BigInt, Math: Math };
    vm.createContext(ctx);
    vm.runInContext(hpSrc + '\n;this.__HP = HealpixGrids;', ctx);
    setEngine(ctx.__HP);
    var V = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'spec', 'moc-vectors.json'), 'utf8'));
    var fails = 0, n = 0;
    function ok(name, cond, info) {
      n++;
      if (!cond) { fails++; console.log('FAIL ' + name + (info ? '  ' + info : '')); }
    }
    // 1. Round trip: MOCPy's ASCII and JSON → us → the same bytes, both ways.
    V.roundtrip.forEach(function (t) {
      var a = parse(t.ascii), j = parse(t.json);
      ok(t.name + ': ASCII → ASCII', toASCII(a) === t.ascii, toASCII(a));
      ok(t.name + ': JSON → JSON', toJSON(j) === t.json);
      ok(t.name + ': ASCII → JSON', toJSON(a) === t.json);
      ok(t.name + ': JSON → ASCII', toASCII(j) === t.ascii);
      if (t.input) ok(t.name + ': non-canonical input → MOCPy canonical', toASCII(parse(t.input)) === t.ascii, toASCII(parse(t.input)));
    });
    // 2. Set operations against MOCPy.
    V.ops.forEach(function (t) {
      var A = parse(t.a), B = parse(t.b);
      ok(t.name + ': union', toASCII(union(A, B)) === t.union, toASCII(union(A, B)));
      ok(t.name + ': intersection', toASCII(intersection(A, B)) === t.intersection, toASCII(intersection(A, B)));
      ok(t.name + ': difference', toASCII(difference(A, B)) === t.difference, toASCII(difference(A, B)));
    });
    // 3. Polygons against MOCPy's from_polygon. Computed independently, so
    //    compared rather than required equal: every cell where the two differ
    //    must be a maximum-order cell on the polygon's edge (centre within 1.5
    //    cell radii of a side). Counts are printed with --verbose.
    V.polygons.forEach(function (t) {
      var mine = fromPolygon([t.ring], { maxOrder: t.maxOrder });
      var theirs = parse(t.ascii);
      var R = prepRing(t.ring), core = HP()._core, nside = Math.pow(2, t.maxOrder);
      var diff = union(difference(mine, theirs), difference(theirs, mine));
      var off = 0, total = 0;
      diff.ranges.forEach(function (x) {
        var s = shift(t.maxOrder);
        for (var q = x[0] >> s; q < x[1] >> s; q++) {
          total++;
          var ip = Number(q), C = core.pixcoord2vec_nest(nside, ip, 0.5, 0.5), rad = 0;
          cellVecs(core, t.maxOrder, ip, 1).forEach(function (p) { rad = Math.max(rad, Math.acos(Math.min(1, dot(p, C)))); });
          var d = Math.min.apply(null, R.E.map(function (E) { return arcDist(C, E); }));
          if (d > 1.5 * rad) off++;
        }
      });
      var edge = countAt(theirs, t.maxOrder);
      ok(t.name + ': differs from MOCPy only on the edge (' + total + ' edge cells differ, ' + off + ' off the edge)', off === 0);
      ok(t.name + ': same maximum order', mine.maxOrder === theirs.maxOrder);
      if (process.argv.indexOf('--verbose') >= 0) {
        console.log('  ' + t.name + ': order ' + t.maxOrder + ', ' + total + ' of MOCPy\'s ' + edge +
                    ' maximum-order cells differ; area ' + areaDeg2(mine).toPrecision(6) + ' vs ' + areaDeg2(theirs).toPrecision(6) + ' deg²');
      }
    });
    function countAt(moc, order) {
      var c = 0n;
      moc.ranges.forEach(function (x) { c += (x[1] - x[0]) >> shift(order); });
      return Number(c);
    }
    // 4. Things MOCPy can't tell us: order 29 indices past 2^53 survive.
    var deep = '29/' + (12n * (1n << 58n) - 1n);
    ok('order-29 last cell survives ASCII', toASCII(parse(deep)) === deep);
    ok('order-29 last cell survives JSON', toASCII(parse(toJSON(parse(deep)))) === deep);
    console.log((fails ? 'self-test: FAIL' : 'self-test: PASS') + ' (' + (n - fails) + ' of ' + n + ' checks)');
    process.exitCode = fails ? 1 : 0;
  }
})(typeof window !== 'undefined' ? window : globalThis);
