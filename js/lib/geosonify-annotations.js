/*
  geosonify-annotations.js  v0.2  — labels, colours and widths on a shape

  Two new, repeatable URL parameters. Neither lives inside a code, so neither
  can move a point:

      lbl=<i>:<text>                          a label on point i
      sty=p<i>[-j]:<colour>[,w<n>][,dash]     points i..j
      sty=s<i>[-j]:<colour>[,w<n>][,dash]     sides i..j (side i joins points i and i+1)

  i counts from 0 across the WHOLE shape, in the order the link's points
  decode (a multi-part shape counts straight through its parts).

  <colour> is one palette letter (below) or six hex digits, no '#'. w<n> is a
  line width in pixels, 0.5 to 12. dash makes the line dashed.

      ?hphexd=…&frame=icrs&lbl=0:Dubhe&lbl=6:Alkaid&sty=s0-6:y,w3

  THE RULES (all of them enforced here, so every caller gets them):
    - A bad entry is ignored on its own; the rest of the link still applies.
    - Text is plain text: callers must put it in the page with textContent
      (never innerHTML). It is cut to 60 characters, and control characters,
      bidirectional overrides and zero-width characters are removed, so a label
      cannot reorder or hide the text around it.
    - Values are written with strict percent-encoding: '+', '#', '&', '%' and
      spaces are always escaped, so a label can never end the parameter or
      start another one.
    - Limits: 500 labels and 500 style entries per link; a range covers at most
      5000 indices.

  The name check: `lbl` and `sty` were run through the real parseURLParam()
  in index.html and neither is a grid prefix plus flags, so neither collides
  with an existing parameter (see HANDOVER-sky-links-labels.md).

  Annotations are BOUND to the shape they arrived with: bind() records its
  vertices, and sync() is called whenever the shape changes. Reversing remaps
  them (point i -> n-1-i). Any other change keeps a label only if its own
  vertex is still there (the same to 1e-9 degrees, longitude compared round
  the circle; so simplifying keeps the labels on the points it keeps), and
  otherwise drops it: a label must never slide onto another point.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.2';

  var PALETTE = {
    r: '#ef4444',   // red
    o: '#f97316',   // orange
    y: '#facc15',   // yellow
    g: '#22c55e',   // green
    c: '#06b6d4',   // cyan
    b: '#3b82f6',   // blue
    v: '#8b5cf6',   // violet
    m: '#d946ef',   // magenta
    p: '#f9a8d4',   // pink
    n: '#9ca3af',   // grey (neutral)
    k: '#111827',   // black
    w: '#f9fafb'    // white
  };

  var MAX_LABEL = 60, MAX_ENTRIES = 500, MAX_RANGE = 5000, MAX_INDEX = 1e6;
  var MIN_W = 0.5, MAX_W = 12;

  // Control characters, bidi embeddings/overrides/isolates and marks, and
  // zero-width characters. Removed outright rather than replaced.
  var STRIP = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

  function sanitizeLabel(text) {
    if (text === null || text === undefined) return '';
    var s = String(text).replace(STRIP, '').replace(/\s+/g, ' ').trim();
    var cps = Array.from(s);
    if (cps.length > MAX_LABEL) s = cps.slice(0, MAX_LABEL).join('').trim();
    return s;
  }

  function parseColour(tok) {
    tok = String(tok || '').trim();
    if (tok.length === 1 && Object.prototype.hasOwnProperty.call(PALETTE, tok.toLowerCase())) {
      return { css: PALETTE[tok.toLowerCase()], token: tok.toLowerCase() };
    }
    if (/^[0-9a-fA-F]{6}$/.test(tok)) return { css: '#' + tok.toLowerCase(), token: tok.toLowerCase() };
    return null;
  }

  function parseIndex(s) {
    if (!/^\d{1,7}$/.test(s)) return null;
    var n = parseInt(s, 10);
    return n <= MAX_INDEX ? n : null;
  }

  // "3" or "3-9" -> [3, 9]; null if malformed, reversed or too wide.
  function parseRange(s) {
    var m = /^(\d{1,7})(?:-(\d{1,7}))?$/.exec(String(s || ''));
    if (!m) return null;
    var a = parseIndex(m[1]), b = m[2] !== undefined ? parseIndex(m[2]) : a;
    if (a === null || b === null || b < a || b - a >= MAX_RANGE) return null;
    return [a, b];
  }

  // "y,w3,dash" -> { color, colorToken, width, dash }; null if any part is bad.
  function parseStyle(s) {
    var bits = String(s || '').split(',');
    var col = parseColour(bits[0]);
    if (!col) return null;
    var out = { color: col.css, colorToken: col.token, width: null, dash: false };
    for (var i = 1; i < bits.length; i++) {
      var b = bits[i].trim();
      if (!b) return null;
      if (b === 'dash') { if (out.dash) return null; out.dash = true; continue; }
      var w = /^w(\d{1,2}(?:\.\d)?)$/.exec(b);
      if (w && out.width === null) {
        var n = parseFloat(w[1]);
        if (!(n >= MIN_W && n <= MAX_W)) return null;
        out.width = n;
        continue;
      }
      return null;
    }
    return out;
  }

  function empty() { return { labels: {}, points: {}, segments: {} }; }

  function isEmpty(a) {
    return !a || (!Object.keys(a.labels).length && !Object.keys(a.points).length && !Object.keys(a.segments).length);
  }

  // One lbl= value into ann; false (and ann untouched) when it is bad.
  function addLabel(ann, raw) {
    var s = String(raw === null || raw === undefined ? '' : raw);
    var c = s.indexOf(':');
    if (c < 1) return false;
    var i = parseIndex(s.slice(0, c));
    if (i === null) return false;
    var text = sanitizeLabel(s.slice(c + 1));
    if (!text) return false;
    ann.labels[i] = text;
    return true;
  }

  // One sty= value into ann; false (and ann untouched) when it is bad.
  function addStyle(ann, raw) {
    var s = String(raw === null || raw === undefined ? '' : raw);
    var m = /^([ps])([0-9-]+):(.+)$/.exec(s);
    if (!m) return false;
    var r = parseRange(m[2]);
    var st = parseStyle(m[3]);
    if (!r || !st) return false;
    var into = m[1] === 'p' ? ann.points : ann.segments;
    for (var k = r[0]; k <= r[1]; k++) into[k] = st;
    return true;
  }

  // Read both parameters from a URLSearchParams. null when neither is present
  // (or nothing in them was usable).
  function parseParams(urlParams) {
    if (!urlParams || !urlParams.getAll) return null;
    var ann = empty();
    var L = urlParams.getAll('lbl').slice(0, MAX_ENTRIES);
    var S = urlParams.getAll('sty').slice(0, MAX_ENTRIES);
    L.forEach(function (v) { addLabel(ann, v); });
    S.forEach(function (v) { addStyle(ann, v); });
    return isEmpty(ann) ? null : ann;
  }

  // Strict percent-encoding: encodeURIComponent, then ':' and ',' (which the
  // grammar uses and which are safe inside a query value) put back for
  // readability. '+', '#', '&', '%', '=' and spaces stay escaped.
  function enc(s) {
    return encodeURIComponent(s).replace(/%3A/gi, ':').replace(/%2C/gi, ',');
  }

  function styleKey(st) {
    return st.colorToken + (st.width !== null ? ',w' + st.width : '') + (st.dash ? ',dash' : '');
  }

  // Indices sorted, consecutive indices with the same style folded into a range.
  function foldRanges(map, prefix) {
    var idx = Object.keys(map).map(Number).sort(function (a, b) { return a - b; });
    var out = [];
    for (var i = 0; i < idx.length;) {
      var a = idx[i], key = styleKey(map[a]), j = i;
      while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1 && styleKey(map[idx[j + 1]]) === key &&
             idx[j + 1] - a < MAX_RANGE) j++;
      var b = idx[j];
      out.push('sty=' + enc(prefix + (a === b ? a : a + '-' + b) + ':' + key));
      i = j + 1;
    }
    return out;
  }

  // ann -> ['lbl=0:Dubhe', 'sty=s0-6:y,w3', ...] (already encoded).
  function serialize(ann) {
    if (isEmpty(ann)) return [];
    var out = [];
    Object.keys(ann.labels).map(Number).sort(function (a, b) { return a - b; }).forEach(function (i) {
      out.push('lbl=' + enc(i + ':' + ann.labels[i]));
    });
    return out.concat(foldRanges(ann.points, 'p'), foldRanges(ann.segments, 's'));
  }

  function clone(ann) {
    var c = empty();
    ['labels', 'points', 'segments'].forEach(function (k) {
      Object.keys(ann[k]).forEach(function (i) { c[k][i] = ann[k][i]; });
    });
    return c;
  }

  // Reversal of an n-point shape: point i -> n-1-i, side i (i..i+1) -> n-2-i.
  function reversed(ann, n) {
    var c = empty();
    Object.keys(ann.labels).forEach(function (i) { var j = n - 1 - i; if (j >= 0) c.labels[j] = ann.labels[i]; });
    Object.keys(ann.points).forEach(function (i) { var j = n - 1 - i; if (j >= 0) c.points[j] = ann.points[i]; });
    Object.keys(ann.segments).forEach(function (i) { var j = n - 2 - i; if (j >= 0) c.segments[j] = ann.segments[i]; });
    return c;
  }

  /*
    The same vertex? Within 1e-9 degrees (about 0.1 mm on Earth, 4 microarcsec
    in the sky), and longitude compared round the circle: one shape is read as
    -153.1 on the map, 206.9 as right ascension, and -513.1 where a line has
    been unwrapped across the date line, and a value folded by a different
    formula differs in the last bits. Exact equality dropped labels on that.
  */
  var SAME_EPS = 1e-9;
  function same(a, b) {
    if (Math.abs(a[0] - b[0]) >= SAME_EPS) return false;
    var d = ((a[1] - b[1]) % 360 + 540) % 360 - 180;
    return Math.abs(d) < SAME_EPS;
  }

  function sameList(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }

  /*
    Carry ann from oldVerts to newVerts by vertex identity: each old index is
    matched to the first equal vertex at or after the previous match (so a
    repeated closing vertex maps in order). Unmatched entries are dropped. A
    side survives only if both its ends survive as neighbours.
  */
  function rebind(ann, oldVerts, newVerts) {
    var map = {}, from = 0;
    for (var i = 0; i < oldVerts.length; i++) {
      for (var j = from; j < newVerts.length; j++) {
        if (same(oldVerts[i], newVerts[j])) { map[i] = j; from = j + 1; break; }
      }
    }
    var c = empty();
    Object.keys(ann.labels).forEach(function (i) { if (map[i] !== undefined) c.labels[map[i]] = ann.labels[i]; });
    Object.keys(ann.points).forEach(function (i) { if (map[i] !== undefined) c.points[map[i]] = ann.points[i]; });
    Object.keys(ann.segments).forEach(function (i) {
      var a = map[i], b = map[+i + 1];
      if (a !== undefined && b !== undefined && b === a + 1) c.segments[a] = ann.segments[i];
    });
    return c;
  }

  // ── The live annotations, bound to one shape ───────────────────────────
  var state = { ann: null, bound: null };

  function set(ann) { state.ann = isEmpty(ann) ? null : ann; state.bound = null; }
  function clear() { state.ann = null; state.bound = null; }
  function get() { return state.ann; }
  // Bound to a shape yet? (A link's labels wait for the shape it draws.)
  function isBound() { return !!(state.ann && state.bound); }

  /*
    Call with the shape's vertices (flattened, in decode order) whenever the
    shape may have changed. The first call after set() binds to that shape.
    Later calls: same vertices -> unchanged; reversed -> remapped; otherwise
    carried by vertex identity (labels on vertices that are gone are dropped).
    Returns the current annotations (or null).
  */
  function sync(verts) {
    if (!state.ann) return null;
    if (!verts || !verts.length) return state.ann;
    if (!state.bound) { state.bound = verts.map(function (p) { return [p[0], p[1]]; }); return state.ann; }
    if (sameList(state.bound, verts)) return state.ann;
    var rev = state.bound.slice().reverse();
    var next = sameList(rev, verts) ? reversed(state.ann, verts.length) : rebind(state.ann, state.bound, verts);
    state.ann = isEmpty(next) ? null : next;
    state.bound = state.ann ? verts.map(function (p) { return [p[0], p[1]]; }) : null;
    return state.ann;
  }

  // The query fragment for the live annotations: '' or '&lbl=…&sty=…'.
  function querySuffix() {
    var s = serialize(state.ann);
    return s.length ? '&' + s.join('&') : '';
  }

  var API = {
    VERSION: VERSION,
    PALETTE: PALETTE,
    MAX_LABEL: MAX_LABEL,
    sanitizeLabel: sanitizeLabel,
    parseColour: parseColour,
    parseStyle: parseStyle,
    parseRange: parseRange,
    addLabel: addLabel,
    addStyle: addStyle,
    parseParams: parseParams,
    serialize: serialize,
    reversed: reversed,
    rebind: rebind,
    clone: clone,
    empty: empty,
    isEmpty: isEmpty,
    set: set,
    get: get,
    clear: clear,
    isBound: isBound,
    sync: sync,
    querySuffix: querySuffix
  };

  global.GeosonifyAnnotations = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  try { console.log('[geosonify] annotations ' + VERSION + ' loaded'); } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
