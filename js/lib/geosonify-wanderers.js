/*
  geosonify-wanderers.js  v0.1  — the Sun, Moon and planets as paths

  WHAT IT DOES
  ------------
  Turns a request such as

      ?wander=jupiter,from:2026-10-24,for:7d,step:1d

  into a sampled path with a label on each tick, which index.html then hands to
  its ordinary import pipeline. The pipeline encodes it as a normal Geosonify
  path, with lbl= ticks and (for a moving starpin) frame=icrs, and redirects to
  that link. So the request link is live (it is recomputed every time it is
  opened) and the link it turns into is plain data (it never changes).

  TWO MAPPINGS, NEVER MIXED SILENTLY
  ----------------------------------
    pin     The moving starpin. The body's astrometric ICRS right ascension and
            declination, through the Starpin address mapping: latitude =
            declination, longitude = right ascension wrapped to [-180, 180).
            The same numbers are the body's track on the sky, so the result is
            a sky path (frame=icrs, epoch=J2000) that also reads as starpins on
            the ground. Default.

    zenith  The sub-body point: where the body is at the geodetic zenith at
            that instant (WGS84; the ellipsoid normal points at it). An Earth
            path. It circles the globe once a day.

  Astrometric here means what JPL Horizons calls astrometric RA/Dec: light
  time applied, aberration and deflection not, in the barycentric sense
  (body at t - lt minus Earth at t). That is the place comparable with catalogue
  star positions, which is what a starpin needs. Astronomy Engine's own
  GeoVector(body, t, false) is NOT that for the Moon (it ignores light time for
  the Moon, about 20" off), so the light-time loop is done here from BaryState.

  The zenith point uses the apparent direction (astrometric plus annual
  aberration, first order; the second-order term is about 2 mas), rotated to
  the equator of date and then to the Earth by Greenwich apparent sidereal
  time. Its geodetic latitude and longitude come from an iteration that
  converges at any height: Astronomy Engine's VectorObserver() throws for the
  Sun ("inverse_terra failed to converge"), so it is not used. Polar motion
  (under 15 m) and UT1 - UTC (under 0.9 s, under 0.4 km in longitude) are
  ignored.

  ACCURACY
  --------
  Positions come from Astronomy Engine 2.1.19 (MIT, Don Cross), which documents
  about 1 arcminute. Checked against JPL DE421 (Skyfield 1.55) in the selftest,
  Sun to Pluto: the moving starpin agrees to 22" or better from 1950 to 2049;
  the sub-point to 36" from 2000 to 2049, most of that in 2049 being the two
  libraries' different predictions of UT1 (about 2 s). Before 1972 a time is
  read as UT, since UTC did not exist. 1' on the sky is 1.85 km on the ground:
  good for exploring and 20 times too coarse to catch a starpin (3", 92.8 m),
  and the toast says so.

  THE REQUEST GRAMMAR (wander-v1)
  -------------------------------
  One URL parameter, `wander`, so only one new name enters the query grammar.
  Its value is comma-separated tokens in any order:

      <body>              sun moon mercury venus mars jupiter saturn uranus
                          neptune pluto                          (required)
      pin | zenith        which mapping                          (default pin)
      from:<date>         YYYY-MM-DD or YYYY-MM-DDTHH:MM, in the utc: offset
                          (default: today 00:00 in that offset)
      to:<date>           end, inclusive if a tick lands on it
      for:<n><unit>       span instead of to:. unit m, h or d
                          (default 7d for pin, 1d for zenith)
      step:<n><unit>      sample and label interval (default 1d pin, 1h zenith)
      utc:<offset>        offset for from:/to: and the labels: 13, -5, 5:30.
                          A '+' would arrive as a space, so the sign is
                          optional and a space counts as '+'. (default 0)
      wander-v1           the calculation version (the only one there is)

  A token this version does not understand is an error with a readable
  message, never ignored: a request that silently drops "zenith" would draw
  the other mapping. Limits: 2000 samples; dates in 1900-2100.

  Name check: `wander` is not a HEALPix scheme prefix (checkParamName in
  geosonify-sky-url.js), not an exact GIS or HEALPix scheme key, and starts
  with no base of parseURLParam()'s vocabulary map, so no existing parameter
  reads it. The selftest repeats the check.

  ENGINE
  ------
  Astronomy Engine is not loaded with the page. loadEngine() injects
  js/lib/vendor/astronomy-engine-2.1.19.browser.min.js the first time a
  wander request arrives, so nobody else pays for its 116 kB.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';
  var CALC = 'wander-v1';
  var ENGINE_VERSION = '2.1.19';
  var ENGINE_SRC = 'js/lib/vendor/astronomy-engine-2.1.19.browser.min.js';

  var BODIES = {
    sun:     { engine: 'Sun',     name: 'Sun' },
    moon:    { engine: 'Moon',    name: 'Moon' },
    mercury: { engine: 'Mercury', name: 'Mercury' },
    venus:   { engine: 'Venus',   name: 'Venus' },
    mars:    { engine: 'Mars',    name: 'Mars' },
    jupiter: { engine: 'Jupiter', name: 'Jupiter' },
    saturn:  { engine: 'Saturn',  name: 'Saturn' },
    uranus:  { engine: 'Uranus',  name: 'Uranus' },
    neptune: { engine: 'Neptune', name: 'Neptune' },
    pluto:   { engine: 'Pluto',   name: 'Pluto' }
  };

  var MODES = { pin: true, zenith: true };
  var DEFAULTS = {
    pin:    { spanMs: 7 * 86400000, stepMs: 86400000 },
    zenith: { spanMs: 86400000,     stepMs: 3600000 }
  };
  var MAX_SAMPLES = 2000;
  var MAX_LABELS = 32;
  var MIN_MS = Date.UTC(1900, 0, 1), MAX_MS = Date.UTC(2101, 0, 1);
  var UNIT_MS = { m: 60000, h: 3600000, d: 86400000 };

  var DEG = 180 / Math.PI, RAD = Math.PI / 180;
  var AU_KM = 149597870.7;
  var WGS84_A_AU = 6378.137 / AU_KM;
  var WGS84_F = 1 / 298.257223563;
  var E2 = WGS84_F * (2 - WGS84_F);
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ── engine ──────────────────────────────────────────────────────────────

  var _engine = null;
  function setEngine(A) { _engine = A || null; return _engine; }
  function getEngine() {
    if (_engine) return _engine;
    if (global && global.Astronomy && global.Astronomy.BaryState) return global.Astronomy;
    return null;
  }

  var _loading = null;
  function loadEngine(src) {
    var have = getEngine();
    if (have) return Promise.resolve(have);
    if (_loading) return _loading;
    if (typeof document === 'undefined') {
      return Promise.reject(new Error('Astronomy Engine is not loaded (setEngine it under Node)'));
    }
    _loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src || API.ENGINE_SRC;
      s.async = true;
      s.onload = function () {
        var A = getEngine();
        if (A) resolve(A);
        else { _loading = null; reject(new Error('Astronomy Engine loaded but did not define Astronomy')); }
      };
      s.onerror = function () { _loading = null; reject(new Error('could not load Astronomy Engine from ' + s.src)); };
      document.head.appendChild(s);
    });
    return _loading;
  }

  // ── the request ─────────────────────────────────────────────────────────

  function fail(msg) { throw new Error('wander: ' + msg); }

  function parseOffset(v) {
    var s = String(v).replace(/^ /, '+');                   // '+' arrives as a space
    var m = /^([+-]?)(\d{1,2})(?::(\d{2}))?$/.exec(s);
    if (!m) fail('utc: wants an offset like 13, -5 or 5:30, not "' + v + '"');
    var h = parseInt(m[2], 10), mi = m[3] ? parseInt(m[3], 10) : 0;
    if (h > 14 || mi > 59 || (h === 14 && mi > 0)) fail('utc: offset out of range: "' + v + '"');
    return (m[1] === '-' ? -1 : 1) * (h * 60 + mi);
  }

  function parseDate(v, offMin, what) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(v);
    if (!m) fail(what + ' wants YYYY-MM-DD or YYYY-MM-DDTHH:MM, not "' + v + '"');
    var y = +m[1], mo = +m[2], d = +m[3], hh = m[4] ? +m[4] : 0, mm = m[5] ? +m[5] : 0;
    var ms = Date.UTC(y, mo - 1, d, hh, mm);
    var back = new Date(ms);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d ||
        hh > 23 || mm > 59) fail(what + ' is not a real date and time: "' + v + '"');
    return ms - offMin * 60000;
  }

  function parseDuration(v, what) {
    var m = /^(\d+(?:\.\d+)?)([mhd])$/.exec(v);
    if (!m) fail(what + ' wants a number and m, h or d (e.g. 7d, 6h, 30m), not "' + v + '"');
    var ms = parseFloat(m[1]) * UNIT_MS[m[2]];
    if (!(ms >= 60000)) fail(what + ' must be at least 1 minute: "' + v + '"');
    return Math.round(ms);
  }

  function startOfDay(ms, offMin) {
    var local = ms + offMin * 60000;
    return local - (((local % 86400000) + 86400000) % 86400000) - offMin * 60000;
  }

  /*
    Parse a wander= value. opts.nowMs sets "today" (default Date.now()).
    Returns { body, mode, fromMs, toMs, stepMs, offsetMin, calc, n }.
  */
  function parseRequest(value, opts) {
    opts = opts || {};
    if (value === null || value === undefined || !String(value).trim()) fail('nothing to draw: name a body, e.g. wander=jupiter');
    var raw = String(value).split(',');
    var seen = {}, body = null, mode = null, calc = null, kv = {};
    function once(k, what) { if (seen[k]) fail('more than one ' + what); seen[k] = true; }

    raw.forEach(function (r) {
      var t = r.trim();
      if (!t) fail('an empty item between commas');
      var low = t.toLowerCase();
      var c = low.indexOf(':');
      if (c > 0) {
        var key = low.slice(0, c);
        // utc: keeps a leading space, which is a '+' the query string decoded
        var val = key === 'utc' ? r.slice(r.indexOf(':') + 1).replace(/\s+$/, '') : t.slice(c + 1);
        if (['from', 'to', 'for', 'step', 'utc'].indexOf(key) < 0) {
          fail('did not understand "' + t + '". ' + HELP);
        }
        once(key, key + ':');
        kv[key] = val;
      } else if (BODIES.hasOwnProperty(low)) {
        if (body) fail('more than one body ("' + body + '" and "' + low + '"); one path per link');
        body = low;
      } else if (MODES.hasOwnProperty(low)) {
        once('mode', 'mode (pin or zenith)');
        mode = low;
      } else if (/^wander-v\d+$/.test(low)) {
        once('calc', 'calculation version');
        if (low !== CALC) fail('"' + low + '" was made by a newer Geosonify; this one knows ' + CALC);
        calc = low;
      } else {
        fail('did not understand "' + t + '". ' + HELP);
      }
    });
    if (!body) fail('no body named. ' + HELP);
    mode = mode || 'pin';
    var offsetMin = kv.utc !== undefined ? parseOffset(kv.utc) : 0;
    var nowMs = opts.nowMs !== undefined ? opts.nowMs : Date.now();
    var fromMs = kv.from !== undefined ? parseDate(kv.from, offsetMin, 'from:') : startOfDay(nowMs, offsetMin);
    var stepMs = kv.step !== undefined ? parseDuration(kv.step, 'step:') : DEFAULTS[mode].stepMs;
    if (kv.to !== undefined && kv.for !== undefined) fail('give to: or for:, not both');
    var toMs = kv.to !== undefined ? parseDate(kv.to, offsetMin, 'to:')
             : fromMs + (kv['for'] !== undefined ? parseDuration(kv['for'], 'for:') : DEFAULTS[mode].spanMs);
    if (!(toMs > fromMs)) fail('the end must come after the start');
    if (fromMs < MIN_MS || toMs >= MAX_MS) fail('dates must lie between 1900 and 2100');
    var n = Math.floor((toMs - fromMs) / stepMs + 1e-9) + 1;
    if (n < 2) fail('step: is longer than the whole span, so there is only one point');
    if (n > MAX_SAMPLES) fail(n + ' samples is too many (the limit is ' + MAX_SAMPLES + '); use a longer step: or a shorter span');
    return { body: body, mode: mode, fromMs: fromMs, toMs: toMs, stepMs: stepMs,
             offsetMin: offsetMin, calc: CALC, n: n };
  }

  var HELP = 'Expected a body (' + Object.keys(BODIES).join(', ') + '), pin or zenith, ' +
             'from:YYYY-MM-DD, to:YYYY-MM-DD or for:7d, step:1d, utc:13.';

  // ── positions ───────────────────────────────────────────────────────────

  function needEngine(A) {
    A = A || getEngine();
    if (!A) throw new Error('wander: Astronomy Engine is not loaded');
    return A;
  }

  /*
    Astrometric geocentric direction, EQJ (J2000 mean equator, which is ICRS to
    about 0.02"). Body at t - lt minus Earth at t, both barycentric; three or
    four light-time passes converge to well under a microsecond.
    Returns { x, y, z } in AU (the geometric distance at emission) and Earth's
    barycentric velocity in AU/day.
  */
  function astrometricVector(bodyKey, ms, A) {
    A = needEngine(A);
    var b = BODIES[bodyKey];
    if (!b) throw new Error('wander: unknown body "' + bodyKey + '"');
    var t = A.MakeTime(new Date(ms));
    var E = A.BaryState('Earth', t);
    var lt = 0, dx = 0, dy = 0, dz = 0;
    for (var i = 0; i < 4; i++) {
      var B = A.BaryState(b.engine, lt ? t.AddDays(-lt) : t);
      dx = B.x - E.x; dy = B.y - E.y; dz = B.z - E.z;
      lt = Math.sqrt(dx * dx + dy * dy + dz * dz) / A.C_AUDAY;
    }
    return { x: dx, y: dy, z: dz, vx: E.vx, vy: E.vy, vz: E.vz, time: t };
  }

  function wrap360(d) { return ((d % 360) + 360) % 360; }
  function to1e7(x) { return Math.round(x * 1e7) / 1e7; }

  // Astrometric ICRS RA/Dec, and the starpin address it maps to.
  function pinOf(bodyKey, ms, A) {
    var v = astrometricVector(bodyKey, ms, A);
    var r = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    var ra = wrap360(Math.atan2(v.y, v.x) * DEG);
    var dec = Math.asin(v.z / r) * DEG;
    var raU = to1e7(ra); if (raU >= 360) raU -= 360;
    var lon = raU >= 180 ? to1e7(raU - 360) : raU;
    return { ms: ms, raDeg: ra, decDeg: dec, lat: to1e7(dec), lon: lon, distAu: r };
  }

  // Geodetic latitude and longitude of an Earth-fixed point at any height.
  function geodetic(x, y, z) {
    var p = Math.sqrt(x * x + y * y);
    var lon = Math.atan2(y, x) * DEG;
    if (p < 1e-15) return { lat: z >= 0 ? 90 : -90, lon: 0 };
    var phi = Math.atan2(z, p * (1 - E2));
    for (var i = 0; i < 8; i++) {
      var s = Math.sin(phi), N = WGS84_A_AU / Math.sqrt(1 - E2 * s * s);
      var h = p / Math.cos(phi) - N;
      var next = Math.atan2(z, p * (1 - E2 * N / (N + h)));
      if (Math.abs(next - phi) < 1e-14) { phi = next; break; }
      phi = next;
    }
    return { lat: phi * DEG, lon: lon };
  }

  // The sub-body point: where the body is at the geodetic zenith.
  function zenithOf(bodyKey, ms, A) {
    A = needEngine(A);
    var v = astrometricVector(bodyKey, ms, A);
    var r = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    var ux = v.x / r, uy = v.y / r, uz = v.z / r;
    var c = A.C_AUDAY, bx = v.vx / c, by = v.vy / c, bz = v.vz / c;
    var ub = ux * bx + uy * by + uz * bz;
    var ax = ux + bx - ux * ub, ay = uy + by - uy * ub, az = uz + bz - uz * ub;  // aberration, first order
    var an = Math.sqrt(ax * ax + ay * ay + az * az);
    var app = new A.Vector(ax / an * r, ay / an * r, az / an * r, v.time);
    var q = A.RotateVector(A.Rotation_EQJ_EQD(v.time), app);
    var th = A.SiderealTime(v.time) * 15 * RAD;
    var x = q.x * Math.cos(th) + q.y * Math.sin(th);
    var y = -q.x * Math.sin(th) + q.y * Math.cos(th);
    var g = geodetic(x, y, q.z);
    var raApp = wrap360(Math.atan2(q.y, q.x) * DEG);
    var decApp = Math.asin(q.z / Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z)) * DEG;
    var lon = g.lon >= 180 ? g.lon - 360 : (g.lon < -180 ? g.lon + 360 : g.lon);
    return { ms: ms, lat: to1e7(g.lat), lon: to1e7(lon), raDeg: raApp, decDeg: decApp, distAu: r };
  }

  function sample(req, A) {
    A = needEngine(A);
    var fn = req.mode === 'zenith' ? zenithOf : pinOf;
    var out = [];
    for (var i = 0; i < req.n; i++) out.push(fn(req.body, req.fromMs + i * req.stepMs, A));
    return out;
  }

  // ── labels ──────────────────────────────────────────────────────────────

  function offsetText(offMin) {
    if (!offMin) return 'UTC';
    var a = Math.abs(offMin), h = Math.floor(a / 60), m = a % 60;
    return 'UTC' + (offMin < 0 ? '\u2212' : '+') + h + (m ? ':' + (m < 10 ? '0' : '') + m : '');
  }

  function parts(ms, offMin) {
    var d = new Date(ms + offMin * 60000);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(),
             hh: d.getUTCHours(), mm: d.getUTCMinutes() };
  }
  function two(n) { return (n < 10 ? '0' : '') + n; }

  // Label every k-th tick, k chosen so the labelled interval is a round one
  // (1 h, 6 h, 1 d, 7 d ...) whenever the step allows it.
  var ROUND_MS = [1, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080, 20160, 40320]
    .map(function (m) { return m * 60000; });
  function labelEvery(stepMs, n) {
    var cap = MAX_LABELS - 1;                          // room for the last tick
    for (var i = 0; i < ROUND_MS.length; i++) {
      var iv = ROUND_MS[i];
      if (iv < stepMs || iv % stepMs !== 0) continue;
      var k = iv / stepMs;
      if (Math.ceil(n / k) <= cap) return k;
    }
    return Math.max(1, Math.ceil(n / cap));
  }

  /*
    One label per tick, thinned to at most MAX_LABELS (every k-th tick, plus the
    last). The first label names the body and carries the year and, when times
    are shown, the offset; later labels add the date only when it changes and
    the year only when that changes.
  */
  function labelsFor(req, points) {
    var n = points.length;
    var k = labelEvery(req.stepMs, n);
    var p0 = parts(req.fromMs, req.offsetMin);
    var showTime = req.mode === 'zenith' || req.stepMs % 86400000 !== 0 || p0.hh !== 0 || p0.mm !== 0;
    var name = BODIES[req.body].name;
    var out = {}, prev = null;
    for (var i = 0; i < n; i++) {
      if (i % k !== 0 && i !== n - 1) continue;
      var p = parts(points[i].ms, req.offsetMin);
      var bits = [];
      var dayChanged = !prev || p.d !== prev.d || p.mo !== prev.mo || p.y !== prev.y;
      if (dayChanged) bits.push(p.d + ' ' + MONTHS[p.mo] + (!prev || p.y !== prev.y ? ' ' + p.y : ''));
      if (showTime) bits.push(two(p.hh) + ':' + two(p.mm));
      var text = bits.join(' ');
      // The first label also says how good the position is, because it is the
      // one thing that travels with the link (the toast does not survive the
      // redirect): 1' on the sky, which is 1.85 km on the ground.
      if (!prev) text = name + (req.mode === 'zenith' ? ' overhead ' : ' ') + text +
                        (showTime ? ' ' + offsetText(req.offsetMin) : '') +
                        (req.mode === 'zenith' ? ' \u00b7 \u00b12 km' : ' \u00b7 \u00b11\u2032');
      out[i] = text;
      prev = p;
    }
    return out;
  }

  function dayText(ms, offMin, withYear) {
    var p = parts(ms, offMin);
    return p.d + ' ' + MONTHS[p.mo] + (withYear ? ' ' + p.y : '');
  }

  function nameFor(req) {
    var lastMs = req.fromMs + (req.n - 1) * req.stepMs;
    var a = parts(req.fromMs, req.offsetMin), b = parts(lastMs, req.offsetMin);
    var range = dayText(req.fromMs, req.offsetMin, a.y !== b.y) + ' \u2013 ' + dayText(lastMs, req.offsetMin, true);
    var body = BODIES[req.body].name;
    return req.mode === 'zenith' ? body + ' overhead, ' + range : body + ' (moving starpin), ' + range;
  }

  var NOTE = 'Positions from Astronomy Engine, good to about 1\u2032 (1.85 km on the ground): ' +
             'for exploring, not for catching a starpin.';

  /*
    The whole job, for index.html. Loads the engine if needed.
    Resolves to { calc, request, frame, coords, labels, name, note, points }.
      frame   'icrs' for pin (the caller sets frame=icrs, epoch=J2000), 'earth' for zenith.
      coords  [[lat, lon], ...] in sample order.
      labels  { index: text }, ready for GeosonifyAnnotations.
  */
  function build(value, opts) {
    opts = opts || {};
    var req;
    try { req = parseRequest(value, opts); } catch (e) { return Promise.reject(e); }
    return loadEngine(opts.engineSrc).then(function (A) {
      var pts = sample(req, A);
      return {
        calc: CALC, request: req,
        frame: req.mode === 'zenith' ? 'earth' : 'icrs',
        coords: pts.map(function (p) { return [p.lat, p.lon]; }),
        labels: labelsFor(req, pts),
        name: nameFor(req),
        note: NOTE,
        points: pts
      };
    });
  }

  var API = {
    VERSION: VERSION, CALC: CALC, ENGINE_VERSION: ENGINE_VERSION, ENGINE_SRC: ENGINE_SRC,
    BODIES: BODIES, MAX_SAMPLES: MAX_SAMPLES, MAX_LABELS: MAX_LABELS, NOTE: NOTE,
    setEngine: setEngine, getEngine: getEngine, loadEngine: loadEngine,
    parseRequest: parseRequest,
    astrometricVector: astrometricVector, pinOf: pinOf, zenithOf: zenithOf, geodetic: geodetic,
    sample: sample, labelsFor: labelsFor, labelEvery: labelEvery, nameFor: nameFor, offsetText: offsetText,
    build: build
  };

  global.GeosonifyWanderers = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  try { if (typeof window !== 'undefined') console.log('[geosonify] wanderers ' + VERSION + ' loaded'); } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
