/*
  geosonify-sky-figures.js  v0.1  — constellation stick figures

  A constellation figure is a set of line segments between named stars. In
  Geosonify terms that is exactly a PATH: an ordered vertex list, which needs no
  units, already delta-compresses, and already survives truncation. So "plot a
  constellation in a URL" needs no new format — it is the path machinery pointed
  at the sky.

  HONESTY ABOUT THE DATA
  ----------------------
  These are approximate J2000/ICRS positions for bright naked-eye stars, given to
  about a tenth of an arcsecond, and the joining lines are one of several
  traditional stick figures — there is no single official version. SIMBAD is
  authoritative for positions; the IAU defines constellation BOUNDARIES, not
  these figures.

  Proper motion is ignored, and for these stars over a human lifetime that is
  fine: the largest here moves a few arcseconds per century, far below the
  arcminute scale at which a stick figure means anything. A code minted from one
  of these at order 20 would be over-claiming; at order 10-14 it is honest.

  This is a demonstration set, deliberately small. It is not a catalogue and
  should never be presented as one.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';

  // [name, RA hours, RA min, RA sec, Dec sign, deg, arcmin, arcsec]
  function ra(h, m, s) { return (h + m / 60 + s / 3600) * 15; }
  function dec(sign, d, m, s) { return sign * (d + m / 60 + s / 3600); }

  var STARS = {
    // Orion
    betelgeuse: { name: 'Betelgeuse', ra: ra(5, 55, 10.3), dec: dec(+1, 7, 24, 25) },
    rigel:      { name: 'Rigel',      ra: ra(5, 14, 32.3), dec: dec(-1, 8, 12, 6) },
    bellatrix:  { name: 'Bellatrix',  ra: ra(5, 25, 7.9),  dec: dec(+1, 6, 20, 59) },
    mintaka:    { name: 'Mintaka',    ra: ra(5, 32, 0.4),  dec: dec(-1, 0, 17, 57) },
    alnilam:    { name: 'Alnilam',    ra: ra(5, 36, 12.8), dec: dec(-1, 1, 12, 7) },
    alnitak:    { name: 'Alnitak',    ra: ra(5, 40, 45.5), dec: dec(-1, 1, 56, 34) },
    saiph:      { name: 'Saiph',      ra: ra(5, 47, 45.4), dec: dec(-1, 9, 40, 11) },
    // Crux
    acrux:      { name: 'Acrux',      ra: ra(12, 26, 35.9), dec: dec(-1, 63, 5, 57) },
    mimosa:     { name: 'Mimosa',     ra: ra(12, 47, 43.3), dec: dec(-1, 59, 41, 19) },
    gacrux:     { name: 'Gacrux',     ra: ra(12, 31, 9.9),  dec: dec(-1, 57, 6, 48) },
    imai:       { name: 'Imai',       ra: ra(12, 15, 8.7),  dec: dec(-1, 58, 44, 56) }
  };

  var FIGURES = {
    orion: {
      name: 'Orion',
      note: 'shoulders, belt, knees — one of several traditional figures',
      segments: [
        ['betelgeuse', 'bellatrix'],                 // shoulders
        ['bellatrix', 'mintaka'],
        ['mintaka', 'alnilam', 'alnitak'],           // the belt
        ['alnitak', 'betelgeuse'],
        ['mintaka', 'rigel'],
        ['alnitak', 'saiph']
      ]
    },
    crux: {
      name: 'Crux',
      note: 'the Southern Cross: long axis and cross-piece',
      segments: [
        ['gacrux', 'acrux'],
        ['mimosa', 'imai']
      ]
    }
  };

  function star(key) {
    var s = STARS[key];
    if (!s) throw new Error('unknown star "' + key + '"');
    return s;
  }

  /* Each segment as a vertex list of [dec, ra], the shape modules' convention. */
  function toPaths(figureName) {
    var f = FIGURES[figureName];
    if (!f) throw new Error('unknown figure "' + figureName + '"');
    return f.segments.map(function (seg) {
      return seg.map(function (k) { var s = star(k); return [s.dec, s.ra]; });
    });
  }

  /* Distinct stars, in a stable order — for encoding as a point set. */
  function vertices(figureName) {
    var f = FIGURES[figureName];
    if (!f) throw new Error('unknown figure "' + figureName + '"');
    var seen = {}, out = [];
    f.segments.forEach(function (seg) {
      seg.forEach(function (k) { if (!seen[k]) { seen[k] = 1; out.push(k); } });
    });
    return out.map(function (k) { var s = star(k); return { key: k, name: s.name, ra: s.ra, dec: s.dec }; });
  }

  function bounds(figureName) {
    var v = vertices(figureName);
    var ras = v.map(function (s) { return s.ra; }), decs = v.map(function (s) { return s.dec; });
    // figures here do not straddle RA 0, so a plain min/max is safe; a general
    // implementation would need to unwrap first.
    var raMin = Math.min.apply(null, ras), raMax = Math.max.apply(null, ras);
    var decMin = Math.min.apply(null, decs), decMax = Math.max.apply(null, decs);
    var decCentre = (decMin + decMax) / 2;
    var raSpan = (raMax - raMin) * Math.cos(decCentre * Math.PI / 180);
    return {
      raCentre: (raMin + raMax) / 2, decCentre: decCentre,
      spanDeg: Math.max(raSpan, decMax - decMin),
      stars: v.length
    };
  }

  var API = {
    VERSION: VERSION,
    STARS: STARS, FIGURES: FIGURES,
    toPaths: toPaths, vertices: vertices, bounds: bounds, star: star,
    list: function () { return Object.keys(FIGURES); }
  };

  global.GeosonifySkyFigures = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
