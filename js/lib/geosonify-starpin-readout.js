/*
  geosonify-starpin-readout.js v0.1 — one address at a time

  Says where a point is, in one chosen notation. Deliberately ONE AT A TIME:
  a wall of eight encodings of the same place teaches nobody anything, while a
  single line you can read aloud is a fact you can carry.

  Formats come from the modules that own them. Nothing here re-implements an
  encoder, because the grid formats are FROZEN — a plausible-looking
  reimplementation would not error, it would quietly produce codes that decode
  to the wrong place. If a module is absent the format says so and offers the
  ones that are available.

      var r = GeosonifyStarpinReadout.mount(el, { order: 14 });
      r.set(lat, lon);            // repaint in the current format
      r.format();                 // current key
*/
'use strict';

var GeosonifyStarpinReadout = (function () {

  // Geosonify declares its modules with `const HealpixGrids = ...` at the top
  // level of a classic script. A top-level `const` does NOT become a property
  // of window — only `var` and function declarations do. Looking them up as
  // window[name] therefore reports every HEALPix format as "module not loaded"
  // while the module is sitting right there and working.
  // Explicitly registered references win, then window, then a global-scope
  // probe. The registry exists because the probe cannot be TESTED: a
  // `new Function` body evaluates in whichever realm the module was loaded
  // into, so it works in a browser and silently fails under a test harness.
  // Anything this important gets a path that can be proved.
  var REG = {};
  function register(name, ref) { if (ref != null) REG[name] = ref; return !!ref; }

  function mod(name) {
    if (REG[name] != null) return REG[name];
    try { if (typeof window !== 'undefined' && window[name] != null) return window[name]; }
    catch (e) {}
    try {
      return (new Function('try { return typeof ' + name + ' !== "undefined" ? ' +
                           name + ' : null; } catch (e) { return null; }'))();
    } catch (e) { return null; }
  }

  // lead: signs go in FRONT for declination (+43 33 10.6), and hemispheres go
  // BEHIND for latitude (43 33 10.6 S). Getting this backwards is the classic
  // way to make an astronomer distrust an app on sight.
  function dms(v, posChar, negChar, lead) {
    var sign = v < 0 ? negChar : posChar, a = Math.abs(v);
    var d = Math.floor(a), m = Math.floor((a - d) * 60), s = ((a - d) * 60 - m) * 60;
    var body = d + '\u00B0 ' + (m < 10 ? '0' : '') + m + '\u2032 ' +
               (s < 10 ? '0' : '') + s.toFixed(1) + '\u2033';
    return lead ? sign + body : body + ' ' + sign;
  }
  function hms(raDeg) {
    var h = raDeg / 15, hh = Math.floor(h), m = (h - hh) * 60,
        mm = Math.floor(m), ss = (m - mm) * 60;
    return hh + 'h ' + (mm < 10 ? '0' : '') + mm + 'm ' +
           (ss < 10 ? '0' : '') + ss.toFixed(2) + 's';
  }

  // Each HEALPix scheme states its own human-scale depth in SCHEMES.
  // defaultIterations: hphex 22, hpquad 22, hp64 22 -- these are Geosonify's
  // figures and the app should not second-guess them. Starpin was passing a
  // flat order 14 to all of them, which is why the hex readout showed
  // 956250B0 where Geosonify shows 956250B00897: the same point, eight orders
  // shallower, a cell about 250 times wider. A bare `order` here is now only a
  // fallback for schemes that do not declare one.
  function schemeOrder(key, fallback) {
    try {
      var s = mod('HealpixGrids').SCHEMES[key];
      if (s && s.defaultIterations) return s.defaultIterations;
    } catch (e) {}
    return fallback;
  }

  // key -> { label, fn(lat, lon, order) -> string, note }
  var FORMATS = {
    latlon: { label: 'Latitude / Longitude', group: 'geographic',
      fn: function (lat, lon) { return lat.toFixed(7) + ', ' + lon.toFixed(7); } },

    dms: { label: 'Lat / Lon in degrees, minutes, seconds', group: 'geographic',
      fn: function (lat, lon) { return dms(lat, 'N', 'S') + '   ' + dms(lon, 'E', 'W'); } },

    radec: { label: 'RA / Dec (the same numbers, read as sky)', group: 'sky',
      fn: function (lat, lon) {
        var ra = lon < 0 ? lon + 360 : lon;
        return 'RA ' + hms(ra) + '   Dec ' + dms(lat, '+', '\u2212', true);
      } },

    hpquad: { label: 'HEALPix \u00B7 quaternary', group: 'healpix', needs: 'HealpixGrids',
      fn: function (lat, lon, order, explicit) {
        return mod('HealpixGrids').encode('hpquad', lat, lon,
                   explicit ? order : schemeOrder('hpquad', order));
      } },
    hphex: { label: 'HEALPix \u00B7 hex', group: 'healpix', needs: 'HealpixGrids',
      fn: function (lat, lon, order, explicit) {
        return mod('HealpixGrids').encode('hphex', lat, lon,
                   explicit ? order : schemeOrder('hphex', order));
      } },
    hp64: { label: 'HEALPix \u00B7 base64', group: 'healpix', needs: 'HealpixGrids',
      fn: function (lat, lon, order, explicit) {
        return mod('HealpixGrids').encode('hp64', lat, lon,
                   explicit ? order : schemeOrder('hp64', order));
      } },

    localgrid: { label: 'Local Grid', group: 'geographic', needs: 'GISGrids',
      fn: function (lat, lon, order) {
        // Local Grid iterations are metres-of-resolution steps, not HEALPix
        // orders, so map across rather than passing the order straight through.
        var it = Math.max(1, Math.min(8, Math.round((order - 6) / 2)));
        return mod('GISGrids').encode('localgrid', lat, lon, it);
      } },

  };

  // ── Geosonify's own vocabularies ─────────────────────────────────────────
  //
  // card-renderer.js already exposes window.encodeCardCoordinate and
  // window.CARD_GRIDS, so nothing here reimplements an encoder. That matters:
  // these are FROZEN formats, and a plausible reimplementation would not
  // error, it would quietly emit codes that decode to the wrong place.
  //
  // The list is read from CARD_GRIDS at mount time rather than hard-coded, so
  // every vocabulary Geosonify gains — new BIP39 languages, new grids — turns
  // up here for free. Visual and barcode cards are skipped: they render to a
  // picture, not to a line you can read out.
  var SKIP_DISPLAY = { qrhex: 1, qrbin: 1, qrurl: 1, datamatrix: 1,
                       chess: 1, chessboard: 1, staff: 1, swatch: 1 };

  // Vocabularies withdrawn from the project. The list is empty because the
  // current withdrawals were deleted outright rather than deprecated: they had
  // never been public, so no code existed in the wild for a decode path to
  // protect, and the usual keep-old-decoders-forever rule had nothing to
  // defend. The hook stays because a surface that reads CARD_GRIDS dynamically
  // will otherwise resurrect anything left half-retired.
  var RETIRED = {};

  function cardGrids() {
    var G = mod('CARD_GRIDS');
    if (!G || typeof mod('encodeCardCoordinate') !== 'function') return {};
    var out = {};
    Object.keys(G).forEach(function (k) {
      var d = G[k];
      if (!d || RETIRED[k] || (d.display && SKIP_DISPLAY[d.display])) return;
      out['card:' + k] = {
        label: 'Geosonify \u00B7 ' + (d.name || k),
        group: 'geosonify', needs: 'encodeCardCoordinate', gridKey: k,
        // HUMAN SCALE. encodeCardCoordinate already falls back to
        // fixedIterations -> cardState.iterations -> defaultIterations when
        // iterations is omitted, and those defaults ARE the human-scale
        // settings: 4 BIP39 words, 9 alphanumeric characters, 6 emoji.
        // Deriving a count from the HEALPix order instead gave eight-word
        // mouthfuls nobody could read out, which was the whole point of these.
        fn: function (lat, lon) {
          return mod('encodeCardCoordinate')(k, lat, lon);
        },
        defaultIterations: d.fixedIterations || d.defaultIterations || null
      };
    });
    return out;
  }
  var CARD_FORMATS_LOADED = false;
  function ensureCardFormats() {
    if (CARD_FORMATS_LOADED) return;
    var extra = cardGrids();
    if (!Object.keys(extra).length) return;
    Object.keys(extra).forEach(function (k) { FORMATS[k] = extra[k]; });
    CARD_FORMATS_LOADED = true;
  }

  // Reading a code back. Only formats that can round-trip are offered as
  // input: the whole argument for these vocabularies is that a friend can say
  // four words down a phone and you end up in the right paddock, so an input
  // that silently could not decode would be worse than none.
  var PARSERS = {
    latlon: function (t) {
      var m = String(t).match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
      return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
    },
    radec: function (t) {
      var m = String(t).match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
      if (!m) return null;
      var ra = parseFloat(m[1]), dec = parseFloat(m[2]);
      return [dec, ra > 180 ? ra - 360 : ra];
    }
  };
  ['hpquad', 'hphex', 'hp64'].forEach(function (k) {
    PARSERS[k] = function (t) {
      var H = mod('HealpixGrids');
      if (!H || !H.decode) return null;
      try { var r = H.decode(k, String(t).trim()); return r ? [r[0], r[1]] : null; }
      catch (e) { return null; }
    };
  });

  function parse(key, text) {
    if (PARSERS[key]) return PARSERS[key](text);
    var f = FORMATS[key];
    if (f && f.gridKey) {
      var CR = mod('CardRenderer');
      if (!CR || !CR.decode) return null;
      try {
        var r = CR.decode(f.gridKey, String(text).trim());
        return (r && r.length >= 2 && isFinite(r[0])) ? [r[0], r[1]] : null;
      } catch (e) { return null; }
    }
    return null;
  }
  function canParse(key) {
    if (PARSERS[key]) return true;
    var f = FORMATS[key];
    if (!f || !f.gridKey) return false;
    var CR = mod('CardRenderer');
    return !!(CR && typeof CR.decode === 'function');
  }

  function available(key) {
    var f = FORMATS[key];
    if (!f) return false;
    if (!f.needs) return true;
    var m = mod(f.needs);
    if (!m) return false;
    if (f.needs === 'encodeCardCoordinate') return typeof m === 'function';
    return true;
  }

  var CSS_ID = 'starpin-readout-css';
  var CSS = [
    '.spr{display:flex;flex-direction:column;gap:.4rem}',
    '.spr-top{display:flex;gap:.5rem;align-items:center}',
    '.spr select{font:inherit;font-size:.78rem;flex:1;padding:.4rem .5rem;border-radius:8px;',
    '  border:1px solid var(--ios-separator,#C6C6C8);background:transparent;color:inherit}',
    '.spr-val{font-family:"SF Mono",ui-monospace,monospace;font-size:.95rem;',
    '  word-break:break-all;line-height:1.4;padding:.5rem .6rem;border-radius:8px;',
    '  background:color-mix(in srgb,currentColor 6%,transparent);min-height:1.2rem}',
    '.spr-sub{font-size:.68rem;opacity:.65;font-family:"SF Mono",ui-monospace,monospace}',
    '.spr-copy{font-size:.7rem;padding:.35rem .7rem;width:auto;flex:0 0 auto}'
  ].join('');

  function mount(container, opts) {
    opts = opts || {};
    var doc = container.ownerDocument || document;
    if (!doc.getElementById(CSS_ID)) {
      var st = doc.createElement('style'); st.id = CSS_ID; st.textContent = CSS;
      doc.head.appendChild(st);
    }

    ensureCardFormats();
    // An order passed in is an OVERRIDE, not a default: without it each format
    // uses the depth its own scheme declares.
    var order = opts.order || 14, explicitOrder = opts.order != null;
    var lat = null, lon = null;
    var root = doc.createElement('div'); root.className = 'spr';
    var top = doc.createElement('div'); top.className = 'spr-top';
    var sel = doc.createElement('select');
    sel.setAttribute('aria-label', 'address format');

    Object.keys(FORMATS).forEach(function (k) {
      var o = doc.createElement('option');
      o.value = k;
      o.textContent = FORMATS[k].label + (available(k) ? '' : '  (module not loaded)');
      o.disabled = !available(k);
      sel.appendChild(o);
    });
    // The chosen format persists. Picking HEALPix hex and finding lat/lon back
    // on the next visit is not a preference, it is the app forgetting. An
    // explicit opts.format still wins, and a remembered format whose module is
    // no longer loaded falls back rather than showing an empty box.
    var STORE_KEY = opts.storeKey || 'starpin.readout.format';
    var store = null;
    try { store = (opts.storage !== undefined) ? opts.storage
                : (doc.defaultView && doc.defaultView.localStorage) || null; } catch (e) {}
    var remembered = null;
    try { remembered = store && store.getItem(STORE_KEY); } catch (e) {}

    sel.value = available(opts.format) ? opts.format
              : available(remembered) ? remembered
              : 'latlon';

    var copy = doc.createElement('button');
    copy.type = 'button'; copy.className = 'spr-copy'; copy.textContent = 'copy';
    top.appendChild(sel); top.appendChild(copy);

    var val = doc.createElement('div'); val.className = 'spr-val';
    var sub = doc.createElement('div'); sub.className = 'spr-sub';
    root.appendChild(top); root.appendChild(val); root.appendChild(sub);
    container.appendChild(root);

    function paint() {
      if (lat == null) { val.textContent = '\u2014'; sub.textContent = ''; return; }
      var f = FORMATS[sel.value];
      try {
        val.textContent = f.fn(lat, lon, order, explicitOrder) || '\u2014';
      } catch (e) {
        val.textContent = '\u2014';
        sub.textContent = f.needs + ' is not loaded, so this format is unavailable. ' +
                          'It is a frozen format and will not be approximated.';
        return;
      }
      sub.textContent = f.group === 'healpix'
                        ? 'order ' + (explicitOrder ? order : schemeOrder(sel.value, order))
                      : f.group === 'geosonify'
                        ? 'Geosonify vocabulary' + (f.defaultIterations
                            ? ' \u00B7 ' + f.defaultIterations + ' steps, human scale' : '')
                      : f.group;
    }

    sel.addEventListener('change', function () {
      try { if (store) store.setItem(STORE_KEY, sel.value); } catch (e) {}
      paint();
    });
    copy.addEventListener('click', function () {
      try { doc.defaultView.navigator.clipboard.writeText(val.textContent); } catch (e) {}
      copy.textContent = 'copied'; setTimeout(function () { copy.textContent = 'copy'; }, 1200);
    });

    return {
      el: root,
      set: function (la, lo) { lat = la; lon = lo; paint(); },
      setOrder: function (o) { order = o; explicitOrder = (o != null); paint(); },
      format: function () { return sel.value; },
      setFormat: function (k) {
        if (!available(k)) return;
        sel.value = k;
        try { if (store) store.setItem(STORE_KEY, k); } catch (e) {}
        paint();
      },
      destroy: function () { if (root.parentNode) root.parentNode.removeChild(root); }
    };
  }

  return { VERSION: '0.4', mount: mount, FORMATS: FORMATS, available: available,
           ensureCardFormats: ensureCardFormats, RETIRED: RETIRED,
           mod: mod, register: register, parse: parse, canParse: canParse };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpinReadout;
