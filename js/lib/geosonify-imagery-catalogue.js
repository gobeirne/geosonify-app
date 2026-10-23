/*
  geosonify-imagery-catalogue.js  v1.0  — curated local historical imagery

  Loads js/lib/geosonify-imagery-catalogue.json (written by
  tools/imagery-catalogue-builder.html from tools/imagery-sources.txt) the
  first time it is asked for, and answers two questions fast:

    near(lat, lon)   the layers whose coverage contains that point — a test
                     against at most 16 latitude/longitude boxes per layer,
                     baked into the file; no network, well under a millisecond
    byUrl(url)       the catalogue entry for an imagery URL (as links carry it)

  Each entry: { r: region, l: label, y: year, u: URL, k: kind, b: [[s,w,n,e]…],
  a: attribution, layer, zr: [minZoom, maxZoom], wms: {base, layers, version,
  crs, format, time}, blind }. Kinds: arcgis-tiles, arcgis-export, arcgis-layer,
  arcgis-image, wms, xyz.

  Nothing is fetched until the Aerial date list (or a link carrying one of these
  URLs) needs it. Nothing here touches a code or a frozen format.
*/
(function (global) {
  'use strict';

  var VERSION = 'v1.0';
  // The JSON sits next to this script; work out where that is once, now.
  var SRC = (function () {
    try {
      var s = document.currentScript && document.currentScript.src;
      if (s) return s.replace(/[^\/]*(\?.*)?$/, '') + 'geosonify-imagery-catalogue.json';
    } catch (e) {}
    return 'js/lib/geosonify-imagery-catalogue.json';
  })();
  var CACHE_BUST = '20261024j';

  var entries = null, byKey = null, loading = null;

  function keyOf(u) {
    try { return new URL(String(u).trim()).href.replace(/\/+(\?|$)/, '$1'); } catch (e) { return String(u || '').trim(); }
  }
  function yearOf(e) {
    var m = String(e.l || '').match(/(1[89]\d\d|20\d\d)/);
    if (m) return +m[1];
    return e.y || null;
  }

  function prepare(json) {
    var list = (json && Array.isArray(json.entries)) ? json.entries : [];
    byKey = Object.create(null);
    list.forEach(function (e, i) {
      e.i = i;
      e.year = yearOf(e);
      byKey[keyOf(e.u)] = e;
    });
    entries = list;
    return entries;
  }

  function load() {
    if (entries) return Promise.resolve(entries);
    if (loading) return loading;
    loading = fetch(SRC + '?v=' + CACHE_BUST, { credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(prepare)
      .catch(function (e) { loading = null; entries = null; throw e; });
    return loading;
  }

  function inBoxes(e, lat, lon) {
    var b = e.b || [];
    for (var j = 0; j < b.length; j++) {
      var x = b[j];
      if (lat >= x[0] && lat <= x[2] && lon >= x[1] && lon <= x[3]) return true;
    }
    return false;
  }

  /** Entries covering (lat, lon). Sync; [] until load() has finished. */
  function near(lat, lon) {
    if (!entries) return [];
    var out = [];
    for (var i = 0; i < entries.length; i++) if (inBoxes(entries[i], lat, lon)) out.push(entries[i]);
    return out;
  }

  /** The entry for an imagery URL, or null. Sync; null until loaded. */
  function byUrl(u) {
    if (!byKey || !u) return null;
    return byKey[keyOf(u)] || null;
  }

  // A short name for the source, for list labels: "Canterbury", "Hutt River".
  function regionOf(e) { return String(e.r || '').replace(/\s*\((KiwiRail)\)\s*$/, ' (KiwiRail)'); }

  var API = {
    VERSION: VERSION,
    load: load,
    isLoaded: function () { return !!entries; },
    near: near,
    covers: inBoxes,
    byUrl: byUrl,
    yearOf: yearOf,
    regionOf: regionOf,
    _prepare: prepare,
    _keyOf: keyOf
  };
  global.GeosonifyImageryCatalogue = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
