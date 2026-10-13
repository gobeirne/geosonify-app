/*
  geosonify-sky-export.js  v0.1  — a sky shape in astronomers' formats

  What a Geosonify sky link names -- a list of directions, perhaps tonight's
  targets -- written out for the tools astronomers already use:

      csv   a target list: index, name, RA/Dec in degrees and sexagesimal
      reg   a SAOImage DS9 region file (ICRS): a point per vertex and a line
            per side, carrying lbl= names and sty= colours, widths and dashes
      moc   the HEALPix cells of the vertices as an ASCII MOC (IVOA MOC 2.0),
            at the HEALPix card's order (MOC stops at order 29)

  And the measurements a display link shows in the sky: lengths as angles
  along great circles, and areas as solid angles. Never metres: no Earth
  radius appears anywhere in this file.

  Pure functions over [dec, ra] vertices (the order the rest of the app uses,
  [lat, lon] read as directions). Callers do the downloading. Nothing here
  touches a code, a URL or a frozen format.

  DS9 syntax checked against ds9.si.edu/doc/ref/region.html: ICRS is a
  coordinate keyword; #rrggbb colours, width=, dash=1 and text={...} are
  properties; there is no polyline, so a path is written one line per side
  (which is also what lets each side keep its own style).
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';
  var D2R = Math.PI / 180;
  var MOC_MAX_ORDER = 29;

  function ra360(ra) { return ((ra % 360) + 360) % 360; }

  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

  // Sexagesimal with fixed decimals; carries rounding up through the fields.
  function hms(raDeg, dec) {
    var t = ra360(raDeg) / 15, f = Math.pow(10, dec);
    var total = Math.round(t * 3600 * f);
    var day = 24 * 3600 * f;
    total = ((total % day) + day) % day;
    var h = Math.floor(total / (3600 * f)); total -= h * 3600 * f;
    var m = Math.floor(total / (60 * f)); total -= m * 60 * f;
    var s = total / f;
    return pad(h, 2) + ':' + pad(m, 2) + ':' + (dec ? pad(s.toFixed(dec), 3 + dec) : pad(s, 2));
  }
  function dms(decDeg, dec) {
    var sign = decDeg < 0 ? '-' : '+', f = Math.pow(10, dec);
    var total = Math.round(Math.abs(decDeg) * 3600 * f);
    var d = Math.floor(total / (3600 * f)); total -= d * 3600 * f;
    var m = Math.floor(total / (60 * f)); total -= m * 60 * f;
    var s = total / f;
    return sign + pad(d, 2) + ':' + pad(m, 2) + ':' + (dec ? pad(s.toFixed(dec), 3 + dec) : pad(s, 2));
  }

  // Degrees to 8 decimals: 0.036 mas, finer than anything a shape carries
  // that matters to a telescope, and short enough to read.
  function deg(x) { return (+x).toFixed(8).replace(/0+$/, '').replace(/\.$/, '.0'); }

  // ── CSV ────────────────────────────────────────────────────────────────
  // One row per vertex. A name that starts with = + - @ would be run as a
  // formula by a spreadsheet, so it is prefixed with an apostrophe.
  function csvField(s) {
    s = String(s === null || s === undefined ? '' : s);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(verts, ann) {
    var labels = (ann && ann.labels) || {};
    var rows = ['index,name,ra_deg,dec_deg,ra_hms,dec_dms'];
    verts.forEach(function (v, i) {
      rows.push([i, csvField(labels[i] || ''), deg(ra360(v[1])), deg(v[0]), hms(v[1], 3), dms(v[0], 2)].join(','));
    });
    return rows.join('\n') + '\n';
  }

  // ── DS9 region ─────────────────────────────────────────────────────────
  function ds9Text(s) {
    // {} delimit the text; drop them (and anything control-like) from a label.
    return String(s || '').replace(/[{}\u0000-\u001F]/g, '').trim();
  }
  function ds9Props(st, extra) {
    var p = [];
    if (st && st.color) p.push('color=' + st.color);
    if (st && st.width) p.push('width=' + Math.max(1, Math.round(st.width)));
    if (st && st.dash) p.push('dash=1');
    if (extra) p.push(extra);
    return p.length ? ' # ' + p.join(' ') : '';
  }

  /*
    groups: [[ [dec, ra], ... ], ...] -- the shape's parts, in order, so the
    flat vertex index (the one lbl= and sty= use) runs straight through them.
    A side joins two vertices of the SAME part.
  */
  function toDS9(groups, ann, opts) {
    opts = opts || {};
    var labels = (ann && ann.labels) || {}, pst = (ann && ann.points) || {}, sst = (ann && ann.segments) || {};
    var out = ['# Region file format: DS9 version 4.1',
               '# Written by Geosonify' + (opts.source ? ' from ' + opts.source : ''),
               'global color=' + (opts.color || 'green') + ' width=1 font="helvetica 10 normal roman"',
               'icrs'];
    var base = 0;
    groups.forEach(function (g) {
      for (var i = 0; i < g.length; i++) {
        var k = base + i, v = g[i];
        var text = labels[k] ? 'text={' + ds9Text(labels[k]) + '}' : '';
        out.push('point(' + deg(ra360(v[1])) + ',' + deg(v[0]) + ')' +
                 ds9Props(pst[k], 'point=circle' + (text ? ' ' + text : '')));
        if (i + 1 < g.length) {
          var w = g[i + 1];
          if (Math.abs(v[0] - w[0]) < 1e-12 && Math.abs(v[1] - w[1]) < 1e-12) continue;
          out.push('line(' + deg(ra360(v[1])) + ',' + deg(v[0]) + ',' + deg(ra360(w[1])) + ',' + deg(w[0]) + ')' +
                   ds9Props(sst[k], ''));
        }
      }
      base += g.length;
    });
    return out.join('\n') + '\n';
  }

  // ── MOC (ASCII, IVOA MOC 2.0) ──────────────────────────────────────────
  // The vertices' own cells at one order: "order/ipix ipix a-b ...". Ranges
  // fold consecutive cells. This is the cells the points are in, not the
  // area the shape encloses.
  function toMOC(verts, order, HP) {
    if (!HP || !HP.nestIndex) throw new Error('HEALPix engine needed for a MOC');
    var k = Math.max(0, Math.min(MOC_MAX_ORDER, Math.round(order)));
    var seen = {}, cells = [];
    verts.forEach(function (v) {
      var ip = BigInt(HP.nestIndex(v[0], ra360(v[1]), k));
      var key = ip.toString();
      if (!seen[key]) { seen[key] = 1; cells.push(ip); }
    });
    cells.sort(function (a, b) { return a < b ? -1 : (a > b ? 1 : 0); });
    var parts = [];
    for (var i = 0; i < cells.length;) {
      var j = i;
      while (j + 1 < cells.length && cells[j + 1] === cells[j] + 1n) j++;
      parts.push(i === j ? cells[i].toString() : cells[i].toString() + '-' + cells[j].toString());
      i = j + 1;
    }
    return k + '/' + parts.join(' ') + '\n';
  }

  // ── Measurements (angles only) ─────────────────────────────────────────
  function vec(v) {
    var d = v[0] * D2R, r = v[1] * D2R, c = Math.cos(d);
    return [c * Math.cos(r), c * Math.sin(r), Math.sin(d)];
  }
  // Great-circle separation in degrees, via the chord (stable at tiny angles).
  function sepDeg(a, b) {
    var A = vec(a), B = vec(b);
    var dx = A[0] - B[0], dy = A[1] - B[1], dz = A[2] - B[2];
    return 2 * Math.asin(Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / 2)) / D2R;
  }

  // Sum of sides, in degrees (closed rings include their closing side).
  function lengthDeg(ring, closed) {
    var s = 0;
    for (var i = 0; i + 1 < ring.length; i++) s += sepDeg(ring[i], ring[i + 1]);
    if (closed && ring.length > 2) {
      var a = ring[0], b = ring[ring.length - 1];
      if (Math.abs(a[0] - b[0]) > 1e-12 || Math.abs(a[1] - b[1]) > 1e-12) s += sepDeg(b, a);
    }
    return s;
  }

  /*
    Solid angle of a simple spherical polygon, in square degrees, by summing
    the signed areas of the triangles (pole-free formula of Van Oosterom &
    Strackee: tan(E/2) = det / (1 + a.b + b.c + c.a)) from the first vertex.
    The smaller of the two regions the ring bounds is returned, which is the
    one a person drawing a shape on the sky means.
  */
  function solidAngleDeg2(ring) {
    var pts = ring.slice();
    if (pts.length > 2) {
      var a0 = pts[0], z = pts[pts.length - 1];
      if (Math.abs(a0[0] - z[0]) < 1e-12 && Math.abs(a0[1] - z[1]) < 1e-12) pts.pop();
    }
    if (pts.length < 3) return 0;
    var V = pts.map(vec), O = V[0], total = 0;
    for (var i = 1; i + 1 < V.length; i++) {
      var B = V[i], C = V[i + 1];
      var det = O[0] * (B[1] * C[2] - B[2] * C[1]) - O[1] * (B[0] * C[2] - B[2] * C[0]) + O[2] * (B[0] * C[1] - B[1] * C[0]);
      var dot = 1 + (O[0] * B[0] + O[1] * B[1] + O[2] * B[2]) + (B[0] * C[0] + B[1] * C[1] + B[2] * C[2]) +
                (C[0] * O[0] + C[1] * O[1] + C[2] * O[2]);
      total += 2 * Math.atan2(det, dot);
    }
    var sr = Math.abs(total);
    if (sr > 2 * Math.PI) sr = 4 * Math.PI - sr;
    return sr / (D2R * D2R);
  }

  // Angles for a person: 2.31°, 14.2′, 3.4″, 120 mas.
  function formatAngleDeg(d) {
    var a = Math.abs(d) * 3600;
    function r(x) { return String(+x.toPrecision(3)); }
    if (a >= 3600) return r(a / 3600) + '°';
    if (a >= 60) return r(a / 60) + '′';
    if (a >= 1) return r(a) + '″';
    if (a >= 1e-3) return r(a * 1e3) + ' mas';
    return r(a * 1e6) + ' µas';
  }
  function formatSolidAngle(deg2) {
    function r(x) { return String(+x.toPrecision(3)); }
    if (!(deg2 > 0)) return '0 deg²';
    var sr = deg2 * D2R * D2R;
    if (deg2 >= 1) return r(deg2) + ' deg² (' + r(sr) + ' sr)';
    if (deg2 * 3600 >= 1) return r(deg2 * 3600) + ' arcmin²';
    if (deg2 * 3600 * 3600 >= 1e-2) return r(deg2 * 3600 * 3600) + ' arcsec²';
    return r(deg2 * 3600 * 3600 * 1e6) + ' mas²';
  }

  /*
    groups as in toDS9; closedFlags[i] says whether part i is a closed ring.
    Returns { text, lengthDeg, areaDeg2 }.
  */
  function measure(groups, closedFlags) {
    var len = 0, area = 0, anyClosed = false;
    groups.forEach(function (g, i) {
      var closed = !!(closedFlags && closedFlags[i]);
      len += lengthDeg(g, closed);
      if (closed && g.length >= 3) { anyClosed = true; area += solidAngleDeg2(g); }
    });
    var bits = [];
    if (anyClosed) bits.push(formatSolidAngle(area));
    if (len > 0) bits.push((anyClosed ? 'perimeter ' : 'length ') + formatAngleDeg(len));
    return { text: bits.join(' · '), lengthDeg: len, areaDeg2: area };
  }

  // The export values a sky display link may carry (export=<value>). Added
  // VALUES of the existing export= parameter; gpx and kml keep their meaning.
  var FORMATS = {
    csv: { label: 'CSV', mime: 'text/csv', ext: 'csv' },
    reg: { label: 'DS9', mime: 'text/plain', ext: 'reg' },
    moc: { label: 'MOC', mime: 'text/plain', ext: 'moc.txt' }
  };

  var API = {
    VERSION: VERSION,
    FORMATS: FORMATS,
    MOC_MAX_ORDER: MOC_MAX_ORDER,
    toCSV: toCSV,
    toDS9: toDS9,
    toMOC: toMOC,
    measure: measure,
    sepDeg: sepDeg,
    solidAngleDeg2: solidAngleDeg2,
    formatAngleDeg: formatAngleDeg,
    formatSolidAngle: formatSolidAngle,
    hms: hms,
    dms: dms
  };

  global.GeosonifySkyExport = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  try { console.log('[geosonify] sky-export ' + VERSION + ' loaded'); } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
