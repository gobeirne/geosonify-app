/*
  geosonify-starpin-place.js v0.1 — "St Martins, Christchurch, New Zealand"

  Browser: window.GeosonifyStarpinPlace.   Node: require('./geosonify-starpin-place.js')

  Coordinates say exactly where; a place name says where to a PERSON. This turns
  a point into the line a local would write, for the cards.

  WHERE THE NAMES COME FROM
  -------------------------
  OpenStreetMap's Nominatim, reverse geocoding. It answers with the parts the
  point is actually INSIDE (suburb, city, state, country), which a "nearest
  label on the map" guess gets wrong near every boundary. Its usage policy is
  modest and this keeps to it: one request at a time, at most one a second,
  the browser's own Referer identifies the app, and every answer is cached on
  the device, so a find is looked up once. Nothing here goes into a record:
  records are frozen and hashed, and a place name is display, derivable again
  at any time.

  AT SEA
  ------
  Plenty of stars land offshore, where there is no address. Then the map's own
  vector tiles (already cached for the streets) supply the nearest named sea
  and the nearest settlement: "Pegasus Bay, off Sumner". Never a blank.

  THE CONVENTION
  --------------
  Most specific place first, then the town or city, then the state or region
  where people say it as part of a place (Australia, the US, India, Canada,
  Brazil...), and always the country, because cards travel and the country is
  what orients a stranger. Empty or repeated parts are dropped.
*/
'use strict';

var GeosonifyStarpinPlace = (function () {

  var root = (typeof window !== 'undefined') ? window : {};
  var NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
  var STORE_KEY = 'starpin.place.v1';
  var MAX_CACHED = 600;
  var GAP_MS = 1100;                                   // Nominatim: at most 1 request a second

  // Countries where the state or region is part of how a place is said.
  var SAYS_STATE = { au: 1, us: 1, in: 1, ca: 1, br: 1, mx: 1, my: 1, ng: 1, ar: 1, ve: 1,
                     ru: 1, ae: 1, pk: 1, za: 0 };

  var DROP_CITY_WITH_SUBURB = { au: 1 };

  function first(a) { for (var i = 0; i < a.length; i++) if (a[i]) return a[i]; return null; }

  // Nominatim's address object -> the line. Pure, so it is tested directly.
  function compose(addr, fallbackName) {
    if (!addr) return fallbackName || null;
    var cc = String(addr.country_code || '').toLowerCase();
    var local = first([addr.suburb, addr.neighbourhood, addr.quarter, addr.city_district, addr.borough,
                       addr.village, addr.hamlet, addr.locality, addr.isolated_dwelling]);
    // The next wider place: skip whatever already served as the local part, so
    // a village falls through to its district rather than repeating itself.
    var town = first([addr.city, addr.town, addr.municipality, addr.village, addr.county]
                     .filter(function (x) { return x && x !== local; }));
    // Australians say "East Fremantle, Western Australia": the suburb and the
    // state, not the metropolis the suburb sits in.
    if (DROP_CITY_WITH_SUBURB[cc] && local) town = null;
    var state = SAYS_STATE[cc] ? first([addr.state, addr.province, addr.region, addr.state_district]) : null;
    var parts = [local, town, state, addr.country], out = [];
    parts.forEach(function (p) {
      if (!p) return;
      p = String(p).trim();
      if (!p || out.some(function (q) { return q.toLowerCase() === p.toLowerCase(); })) return;
      out.push(p);
    });
    return out.length ? out.join(', ') : (fallbackName || null);
  }

  // The reader's language, for Nominatim's accept-language and the tiles' name:xx.
  function langs() {
    var n = root.navigator || {};
    var l = (n.languages && n.languages.length) ? Array.prototype.slice.call(n.languages) : [n.language || 'en'];
    return l.filter(Boolean);
  }
  function nameIn(names, ls) {
    for (var i = 0; i < ls.length; i++) {
      var base = String(ls[i]).toLowerCase().split('-')[0];
      if (names['name:' + base]) return names['name:' + base];
    }
    return names['name:latin'] || names.name_en || names['name:en'] || names.name;
  }

  // ── at sea: the map's own names ─────────────────────────────────────────────
  var D2R = Math.PI / 180;
  function distKm(a, b, c, d) {
    var x = (d - b) * D2R * Math.cos((a + c) / 2 * D2R), y = (c - a) * D2R;
    return Math.sqrt(x * x + y * y) * 6371;
  }
  // From tiles already in hand (the shared store), the nearest named water and
  // the nearest settlement. Waits briefly for the tiles if it must.
  function seaLine(lat, lon, ms) {
    var T = root.GeosonifyStarpinTiles, st = T && T.shared && T.shared();
    if (!st) return Promise.resolve(null);
    var zs = [10, 8, 6], wanted = [];
    zs.forEach(function (z) {
      var d = 0.35 * Math.pow(2, 10 - z);
      T.tilesFor({ s: lat - d, n: lat + d, w: lon - d, e: lon + d }, z, 0).forEach(function (t) {
        wanted.push(t); st.request(t.z, t.x, t.y, { priority: true });
      });
    });
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var all = wanted.every(function (t) { return st.has(t.z, t.x, t.y); });
        if (!all && Date.now() - t0 < (ms || 4000)) { setTimeout(poll, 150); return; }
        var ls = langs(), bestP = null, bestW = null;
        wanted.forEach(function (t) {
          var g = st.peek(t.z, t.x, t.y);
          if (!g) return;
          (g.places || []).forEach(function (p) {
            if (!/^(city|town|village|suburb|hamlet)$/.test(p.cls)) return;
            var dk = distKm(lat, lon, p.lat, p.lon);
            if (dk < 60 && (!bestP || dk < bestP.d)) bestP = { d: dk, name: nameIn(p.names, ls) };
          });
          (g.waterNames || []).forEach(function (w) {
            if (!/^(ocean|sea|bay|strait|gulf|lagoon)$/.test(w.cls)) return;
            var dk = distKm(lat, lon, w.lat, w.lon);
            if (!bestW || dk < bestW.d) bestW = { d: dk, name: nameIn(w.names, ls) };
          });
        });
        var bits = [];
        if (bestW) bits.push(bestW.name);
        if (bestP) bits.push('off ' + bestP.name);
        resolve(bits.length ? bits.join(', ') : 'At sea');
      })();
    });
  }

  // ── cache ──────────────────────────────────────────────────────────────────
  var mem = null;
  function load() {
    if (mem) return mem;
    try { mem = JSON.parse(root.localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { mem = {}; }
    return mem;
  }
  function save() {
    try {
      var keys = Object.keys(mem);
      if (keys.length > MAX_CACHED) {
        keys.sort(function (a, b) { return (mem[a].at || 0) - (mem[b].at || 0); });
        keys.slice(0, keys.length - MAX_CACHED).forEach(function (k) { delete mem[k]; });
      }
      root.localStorage.setItem(STORE_KEY, JSON.stringify(mem));
    } catch (e) {}
  }
  // ~11 m cells: a find and its card agree, and nearby finds share a lookup.
  function key(lat, lon, lang) { return lat.toFixed(4) + ',' + lon.toFixed(4) + '|' + lang; }

  // ── the polite queue ───────────────────────────────────────────────────────
  var chain = Promise.resolve(), lastAt = 0, inflight = {};
  function politely(fn) {
    var p = chain.then(function () {
      var wait = Math.max(0, lastAt + GAP_MS - Date.now());
      return new Promise(function (r) { setTimeout(r, wait); });
    }).then(function () { lastAt = Date.now(); return fn(); });
    chain = p.catch(function () {});
    return p;
  }

  // The line for a point. Cached answers come back at once (a resolved promise);
  // otherwise one polite lookup. Resolves to a string, or null if even the
  // fallback has nothing.
  function lookup(lat, lon, opts) {
    opts = opts || {};
    if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon)) return Promise.resolve(null);
    var ls = langs(), lang = String(ls[0] || 'en').toLowerCase().split('-')[0], k = key(lat, lon, lang);
    var c = load()[k];
    if (c && c.text) return Promise.resolve(c.text);
    if (inflight[k]) return inflight[k];
    var fetchFn = opts.fetch || (root.fetch ? root.fetch.bind(root) : null);
    if (!fetchFn) return Promise.resolve(null);
    var url = (opts.endpoint || NOMINATIM) + '?format=jsonv2&addressdetails=1&zoom=16' +
              '&lat=' + lat.toFixed(6) + '&lon=' + lon.toFixed(6) +
              '&accept-language=' + encodeURIComponent(ls.join(','));
    inflight[k] = politely(function () {
      return fetchFn(url, { headers: { 'Accept': 'application/json' } }).then(function (r) { return r.json(); });
    }).then(function (j) {
      var text = (j && !j.error) ? compose(j.address, j.name) : null;
      return text || seaLine(lat, lon);
    }).catch(function () {
      return seaLine(lat, lon);
    }).then(function (text) {
      delete inflight[k];
      if (text) { load()[k] = { text: text, at: Date.now() }; save(); }
      return text;
    });
    return inflight[k];
  }
  // Cached only, synchronously: for drawing a card without waiting.
  function cached(lat, lon) {
    if (lat == null || lon == null) return null;
    var lang = String(langs()[0] || 'en').toLowerCase().split('-')[0];
    var c = load()[key(lat, lon, lang)];
    return c ? c.text : null;
  }

  return { VERSION: '0.1', lookup: lookup, cached: cached, compose: compose, SAYS_STATE: SAYS_STATE,
           _reset: function () { mem = {}; } };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpinPlace;
