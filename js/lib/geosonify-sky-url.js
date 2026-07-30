/*
  geosonify-sky-url.js  v0.1  — frame and epoch URL parameters

  PURE. No DOM, no global state, no side effects. Parses and serialises only;
  the caller decides what to do with the result.

  WHY THIS MUST EXIST BEFORE THE FIRST SHARE BUTTON
  ------------------------------------------------
  Every Geosonify URL ever issued means "Earth, WGS84-ish lon/lat" by SILENT
  CONVENTION. Nothing records it. The moment a sky position can leave the app in
  a URL, that convention becomes ambiguous -- and ambiguous in the worst possible
  way, because a frameless code still decodes, to a plausible wrong SPHERE, with
  no error.

  This is the same failure class as the frozen formats, and it deserves the same
  seriousness: get it in before any sky URL is minted, not after.

  THE RULES, WHICH ARE NOT NEGOTIABLE
  -----------------------------------
    1. Absent frame ALWAYS means earth. Forever. Every URL already in the wild
       is an Earth URL and must stay one.
    2. Never EMIT frame=earth. Earth URLs stay byte-identical to what they are
       today, so nothing that already works starts looking different.
    3. An unknown frame is an ERROR, never a silent fall back to earth. Falling
       back would resurrect exactly the ambiguity this module exists to kill.
    4. Additive only. New keys, no repurposing. The query grammar is a public
       contract.

  EPOCH
  -----
  Frame says WHICH sphere and which orientation; epoch says WHEN that orientation
  was defined. They are different questions and need different keys. Verified
  against astropy: the zenith of a point computed in the equator-of-date frame
  differs from the same direction in ICRS/J2000 by 0.354 degrees in 2026 -- about
  21 arcminutes, from 26 years of precession. That is thousands of times coarser
  than the cells we mint, so a sky position without an epoch is not a position.

  Epoch is OPTIONAL for a fixed direction (a patch of sky does not move) and
  REQUIRED when a code is attached to a named object, because objects have proper
  motion. requiresEpoch() draws that line.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';

  var DEFAULT_FRAME = 'earth';

  var FRAMES = {
    earth:    { key: 'earth',    label: 'Earth',            sphere: 'earth', epoch: null,
                lat: 'latitude',  lon: 'longitude' },
    icrs:     { key: 'icrs',     label: 'ICRS',             sphere: 'sky',   epoch: 'J2000',
                lat: 'declination', lon: 'right ascension' },
    galactic: { key: 'galactic', label: 'Galactic',         sphere: 'sky',   epoch: null,
                lat: 'galactic latitude', lon: 'galactic longitude' },
    ecliptic: { key: 'ecliptic', label: 'Ecliptic',         sphere: 'sky',   epoch: 'J2000',
                lat: 'ecliptic latitude', lon: 'ecliptic longitude' },
    // Equator and equinox of date -- what the cheap sidereal-time zenith
    // calculation actually produces. Named so it can never be mistaken for ICRS.
    date:     { key: 'date',     label: 'Equator of date',  sphere: 'sky',   epoch: 'required',
                lat: 'declination', lon: 'right ascension' }
  };

  var FRAME_PARAM = 'frame';
  var EPOCH_PARAM = 'epoch';

  /*
    Reserved prefixes in the existing grammar. parseURLParam() in index.html
    matches paramName.startsWith(base) for these and then requires the remainder
    to match ^[odrc]{0,4}$ -- so a new key beginning with one of them parses to
    NULL and is SILENTLY IGNORED. No error, no toast. Any new param must be
    checked against this before it is ever shipped.
  */
  var RESERVED_PREFIXES = ['hphex', 'hpquad', 'hp64'];
  var RESERVED_SUFFIX = /^[odrc]{0,4}$/;

  function checkParamName(name) {
    var n = String(name || '');
    if (!n) return { safe: false, reason: 'empty name' };
    for (var i = 0; i < RESERVED_PREFIXES.length; i++) {
      var p = RESERVED_PREFIXES[i];
      if (n.indexOf(p) === 0) {
        var rest = n.slice(p.length);
        if (RESERVED_SUFFIX.test(rest)) {
          return { safe: false, reason: 'collides with the ' + p + ' flag grammar' };
        }
        return {
          safe: false,
          reason: 'begins with "' + p + '" so parseURLParam swallows it and returns null, ' +
                  'silently ignoring the parameter'
        };
      }
    }
    return { safe: true, reason: null };
  }

  // Epoch: J2000, J2016.0, B1950, or a bare year. Deliberately narrow -- a
  // permissive parser here would accept nonsense and hand back a wrong sky.
  var EPOCH_RE = /^([JB])(\d{4}(?:\.\d+)?)$/;

  function parseEpoch(value) {
    if (value === undefined || value === null || value === '') return null;
    var v = String(value).trim();
    var m = v.match(EPOCH_RE);
    if (m) {
      var year = parseFloat(m[2]);
      if (!isFinite(year) || year < 1000 || year > 3000) {
        throw new Error('epoch year out of range: ' + v);
      }
      return { raw: (m[1] + m[2]), system: m[1] === 'J' ? 'Julian' : 'Besselian', year: year };
    }
    if (/^\d{4}(\.\d+)?$/.test(v)) {           // bare year means Julian
      return { raw: 'J' + v, system: 'Julian', year: parseFloat(v) };
    }
    throw new Error('unrecognised epoch "' + v + '" (expected J2000, J2016.0, B1950)');
  }

  /*
    Read frame and epoch from a params object.

      params  URLSearchParams, a plain object, or a Map -- anything with get()
              or plain string properties.

    Returns { frame, frameDef, explicit, epoch, sphere, warnings }.
    Throws on an unknown frame. Never silently defaults a bad value.
  */
  function parse(params) {
    function get(k) {
      if (!params) return undefined;
      if (typeof params.get === 'function') { var v = params.get(k); return v === null ? undefined : v; }
      return params[k];
    }

    var warnings = [];
    var rawFrame = get(FRAME_PARAM);
    var explicit = rawFrame !== undefined && rawFrame !== null && rawFrame !== '';

    var key = DEFAULT_FRAME;
    if (explicit) {
      key = String(rawFrame).trim().toLowerCase();
      if (!FRAMES[key]) {
        throw new Error('unknown frame "' + rawFrame + '" (expected one of: ' +
                        Object.keys(FRAMES).join(', ') + ')');
      }
    }
    var def = FRAMES[key];

    var epoch = null;
    var rawEpoch = get(EPOCH_PARAM);
    if (rawEpoch !== undefined && rawEpoch !== null && rawEpoch !== '') {
      epoch = parseEpoch(rawEpoch);
      if (def.sphere === 'earth') {
        warnings.push('epoch is meaningless in the earth frame and was ignored');
        epoch = null;
      }
    } else if (def.epoch === 'required') {
      warnings.push('frame "' + key + '" is epoch-dependent but no epoch was given');
    } else if (def.epoch) {
      epoch = parseEpoch(def.epoch);
      epoch.assumed = true;
    }

    return {
      frame: key,
      frameDef: def,
      explicit: explicit,
      sphere: def.sphere,
      epoch: epoch,
      warnings: warnings
    };
  }

  /*
    Produce the params to add to a URL. Earth emits NOTHING, so existing URLs are
    unchanged byte for byte.

      opts.forObject  true when the code is attached to a named object rather
                      than a fixed direction. Objects have proper motion, so an
                      epoch stops being optional.
  */
  function serialize(frame, epoch, opts) {
    opts = opts || {};
    var key = String(frame || DEFAULT_FRAME).toLowerCase();
    var def = FRAMES[key];
    if (!def) throw new Error('cannot serialise unknown frame "' + frame + '"');

    var out = {};
    if (key === DEFAULT_FRAME) return out;      // rule 2: never emit frame=earth

    out[FRAME_PARAM] = key;

    if (epoch) {
      out[EPOCH_PARAM] = parseEpoch(epoch).raw;
    } else if (requiresEpoch(key, opts)) {
      throw new Error('frame "' + key + '" requires an epoch' +
                      (opts.forObject ? ' because the code is attached to an object' : ''));
    }
    return out;
  }

  /*
    Does this need an epoch?
      - a fixed direction in a fixed frame does not (a patch of sky stays put);
      - an equator-of-date frame always does, because "of date" IS the epoch;
      - anything attached to a named object does, because objects move. At order
        34 a cell is 12 microarcseconds and a high-proper-motion star leaves it
        within days.
  */
  function requiresEpoch(frame, opts) {
    opts = opts || {};
    var def = FRAMES[String(frame || '').toLowerCase()];
    if (!def || def.sphere === 'earth') return false;
    if (def.epoch === 'required') return true;
    return !!opts.forObject;
  }

  function toQueryString(obj) {
    var parts = [];
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
      }
    }
    return parts.join('&');
  }

  // A human sentence for the UI. Precision culture: say which sphere, say which
  // frame, and never let a sky code look like an Earth one.
  function describe(parsed) {
    if (parsed.sphere === 'earth') return 'Earth coordinates';
    var s = parsed.frameDef.label;
    if (parsed.epoch) s += ' ' + parsed.epoch.raw + (parsed.epoch.assumed ? ' (assumed)' : '');
    return s + ' \u2014 ' + parsed.frameDef.lat + ' / ' + parsed.frameDef.lon;
  }

  var API = {
    VERSION: VERSION,
    DEFAULT_FRAME: DEFAULT_FRAME,
    FRAMES: FRAMES,
    FRAME_PARAM: FRAME_PARAM,
    EPOCH_PARAM: EPOCH_PARAM,
    RESERVED_PREFIXES: RESERVED_PREFIXES,
    parse: parse,
    serialize: serialize,
    parseEpoch: parseEpoch,
    requiresEpoch: requiresEpoch,
    checkParamName: checkParamName,
    toQueryString: toQueryString,
    describe: describe
  };

  global.GeosonifySkyUrl = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
