/*
  geosonify-sky-lookup.js  v0.1  — what is that star? where is Vega?

  Two things, both only while the sky view is open:

    1. CLICK TO IDENTIFY. Click the sky and a small panel says what is there:
       the catalogued object nearest the click (brighter objects preferred
       when several are close), its type, its V magnitude, how far it is from
       the click, and a link to its SIMBAD page. If the click falls inside a
       large object (M31, the Orion Nebula) that is said too, since the nearest
       catalogue POINT to a click on a galaxy's disc is usually a field star.

    2. SEARCH BY NAME. The Shape tab's search box finds places on Earth with
       Nominatim. In the sky it finds objects instead: "Vega", "M31",
       "NGC 7000", "Betelgeuse", or a position such as "05 35 17 -05 23 28".
       The view moves there and the cards follow, as a click would.

  WHERE THE ANSWERS COME FROM
  ---------------------------
  SIMBAD (CDS, Strasbourg), through its TAP service, for identification; the
  Sesame name resolver (CDS) for names. Both are free and keyless, which is the
  project's rule for any outside service. When Aladin is the live renderer and
  Sesame cannot be reached, Aladin's own gotoObject() is the fallback, which
  uses the same resolver by its own route. Typed positions never leave the
  device: they are parsed by GeosonifySky.parsePosition.

  PRIVACY. In Geosonify the sky position IS the Earth position (Dec = lat,
  RA = lon), so sending a click to SIMBAD sends a location. That is fine for a
  click the person made on a star, and is why nothing is sent automatically
  (not on open, not on GPS ticks). Under passphrase or obfuscation nothing is
  sent at all, the same rule the sky view uses to redact its readouts. A name
  search sends only the typed name.

  Display only. It reads no code, writes no URL and changes no format.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';
  /*
    MIRRORS. SIMBAD and Sesame live at the CDS in Strasbourg, which went
    offline for days after a security incident in late October 2026. The CDS
    named these mirrors at the time. Each is tried in order, 5 s apiece, and
    whichever answered last goes first next time (for this page's life).

    UNVERIFIED from the sandbox this was written in: whether each mirror
    offers the TAP service (not just the web pages) and sends CORS headers.
    A mirror that fails either way is skipped, and only an answer of the right
    shape counts. The IDIA SIMBAD mirror is listed at its root, so both the
    usual /simbad path and the root are tried there.
  */
  var SIMBAD_BASES = [
    'https://simbad.cds.unistra.fr/simbad',      // CDS, Strasbourg (primary)
    'https://simbad.cfa.harvard.edu/simbad',     // CfA, Harvard
    'https://simbad.idia.ac.za/simbad',          // IDIA, South Africa
    'https://simbad.idia.ac.za'
  ];
  var SESAME_BASES = [
    'https://cds.unistra.fr/cgi-bin/nph-sesame',
    'https://vizier.cfa.harvard.edu/viz-bin/nph-sesame',
    'https://vizier.idia.ac.za/viz-bin/nph-sesame'
  ];
  var PER_HOST_MS = 5000;
  var lastGood = { simbad: 0, sesame: 0 };      // index of the base that answered last
  function SIMBAD_ID_URL() { return SIMBAD_BASES[lastGood.simbad] + '/sim-id?Ident='; }
  var TIMEOUT_MS = 9000;

  // Pick radius bounds (arcsec): below 2" SIMBAD's own astrometry is the limit;
  // above 30' a "nearest object" stops meaning anything.
  var MIN_R = 2, MAX_R = 1800;
  // Extended objects: how far out to look for something the click sits INSIDE.
  var EXT_SEARCH_DEG = 3;

  var PANEL_ID = 'gs-sky-lookup';
  var SEARCH_INPUT = 'placeNameInput';
  var SEARCH_BTN = 'placeNameLoad';

  function SV() { return global.GeosonifySkyView || null; }
  function Sky() {
    try { if (typeof GeosonifySky !== 'undefined' && GeosonifySky) return GeosonifySky; } catch (e) {}
    return global.GeosonifySky || null;
  }
  function skyOpen() { var sv = SV(); return !!(sv && sv.isOpen && sv.isOpen()); }
  function privacyOn() { var sv = SV(); return !!(sv && sv.isPrivacyOn && sv.isPrivacyOn()); }
  function toast(msg, kind) { if (global.showToast) { try { global.showToast(msg, kind); } catch (e) {} } }

  // ── names ────────────────────────────────────────────────────────────────

  // SIMBAD's main identifiers are terse ("* alf Lyr", "M  31", "NAME Orion
  // Nebula"). Tidy them for reading; the SIMBAD link keeps the real one.
  var GREEK = {
    alf: 'α', bet: 'β', gam: 'γ', del: 'δ', eps: 'ε', zet: 'ζ', eta: 'η', tet: 'θ',
    iot: 'ι', kap: 'κ', lam: 'λ', mu: 'μ', nu: 'ν', ksi: 'ξ', omi: 'ο', pi: 'π',
    rho: 'ρ', sig: 'σ', tau: 'τ', ups: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', ome: 'ω'
  };
  function prettyId(id) {
    var s = String(id || '').trim();
    s = s.replace(/^NAME\s+/, '').replace(/^\*{1,2}\s+/, '').replace(/\s{2,}/g, ' ');
    var m = s.match(/^([a-z]{2,3})(\d{0,2})\s+(\w{3})$/);         // "alf Lyr", "tet01 Ori"
    if (m && GREEK[m[1]]) {
      var sup = m[2] ? m[2].replace(/^0/, '').replace(/\d/g, function (d) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]; }) : '';
      s = GREEK[m[1]] + sup + ' ' + m[3];
    }
    return s;
  }

  // A fallback for when the otypedef table cannot be read: the commonest
  // SIMBAD object types. Anything else is shown as its code.
  var OTYPE = {
    '*': 'Star', '**': 'Double or multiple star', 'PM*': 'High proper-motion star',
    'V*': 'Variable star', 'EB*': 'Eclipsing binary', 'SB*': 'Spectroscopic binary',
    'RG*': 'Red giant', 'Y*O': 'Young stellar object', 'WD*': 'White dwarf',
    'Ce*': 'Cepheid', 'RR*': 'RR Lyrae variable', 'C*': 'Carbon star',
    'G': 'Galaxy', 'GiG': 'Galaxy in group', 'GiC': 'Galaxy in cluster', 'AGN': 'Active galactic nucleus',
    'QSO': 'Quasar', 'Sy1': 'Seyfert 1 galaxy', 'Sy2': 'Seyfert 2 galaxy', 'SBG': 'Starburst galaxy',
    'GlC': 'Globular cluster', 'OpC': 'Open cluster', 'Cl*': 'Star cluster',
    'PN': 'Planetary nebula', 'HII': 'HII region', 'RNe': 'Reflection nebula',
    'SNR': 'Supernova remnant', 'MoC': 'Molecular cloud', 'DNe': 'Dark nebula',
    'ClG': 'Cluster of galaxies', 'X': 'X-ray source', 'Rad': 'Radio source', 'IR': 'Infrared source',
    'Psr': 'Pulsar', 'BH': 'Black hole', 'No*': 'Nova', 'SN*': 'Supernova'
  };
  function typeText(code, desc) {
    if (desc) return desc.charAt(0).toUpperCase() + desc.slice(1);
    return OTYPE[code] || (code ? 'Type ' + code : 'Object');
  }

  function fmtArcsec(a) {
    if (!isFinite(a)) return '';
    if (a >= 3600) return (a / 3600).toFixed(a >= 36000 ? 0 : 1) + '°';
    if (a >= 60) return (a / 60).toFixed(a >= 600 ? 0 : 1) + '′';
    if (a >= 1) return a.toFixed(a >= 10 ? 0 : 1) + '″';
    return (a * 1000).toFixed(0) + ' mas';
  }

  // ── network ──────────────────────────────────────────────────────────────

  function fetchWithTimeout(url, signal, ms) {
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms || TIMEOUT_MS);
    if (signal && ctl) {
      if (signal.aborted) ctl.abort();
      else signal.addEventListener('abort', function () { ctl.abort(); });
    }
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    }, function (e) { clearTimeout(timer); throw e; });
  }

  // Each base in turn, the last good one first, until one gives a body that
  // read() turns into a non-null value. A caller's abort stops the whole run.
  function viaMirrors(kind, bases, suffix, read, signal) {
    var order = [lastGood[kind]];
    for (var b = 0; b < bases.length; b++) if (b !== lastGood[kind]) order.push(b);
    var k = 0, lastErr = null;
    function next() {
      if (signal && signal.aborted) {
        var ab = new Error('aborted'); ab.name = 'AbortError'; return Promise.reject(ab);
      }
      if (k >= order.length) return Promise.reject(lastErr || new Error('no mirror answered'));
      var idx = order[k++];
      return fetchWithTimeout(bases[idx] + suffix, signal, PER_HOST_MS)
        .then(read)
        .then(function (v) {
          if (v == null) throw new Error('unexpected answer from ' + bases[idx]);
          lastGood[kind] = idx;
          return v;
        })
        .catch(function (e) {
          if (signal && signal.aborted) throw e;
          lastErr = e; return next();
        });
    }
    return next();
  }

  // SIMBAD TAP, JSON out. The response is {metadata:[{name}], data:[[...]]};
  // rows are returned as objects keyed by column name, so a column added or
  // reordered upstream cannot shift a value into the wrong field.
  function tap(adql, signal) {
    var suffix = '/sim-tap/sync?request=doQuery&lang=adql&format=json&query=' + encodeURIComponent(adql);
    return viaMirrors('simbad', SIMBAD_BASES, suffix, function (r) {
      return r.json().then(function (j) { return j && Array.isArray(j.metadata) ? j : null; },
                           function () { return null; });
    }, signal).then(function (j) {
      var cols = (j && j.metadata || []).map(function (m) { return String(m.name || '').toLowerCase(); });
      return (j && j.data || []).map(function (row) {
        var o = {};
        cols.forEach(function (c, i) { o[c] = row[i]; });
        return o;
      });
    });
  }

  function num(x) { return x === null || x === undefined || x === '' ? null : +x; }
  function lit(x) { return Number(x).toFixed(9); }   // ADQL numeric literal, never exponent form

  // Objects within r arcsec of (ra, dec), nearest first. Tries the full query
  // (type description and V magnitude) and falls back to the bare one, so an
  // upstream schema change costs detail, not the answer.
  function coneQuery(ra, dec, rArcsec, signal) {
    var P = "POINT('ICRS', b.ra, b.dec)", C = "POINT('ICRS', " + lit(ra) + ', ' + lit(dec) + ')';
    var where = "CONTAINS(" + P + ", CIRCLE('ICRS', " + lit(ra) + ', ' + lit(dec) + ', ' + lit(rArcsec / 3600) + ')) = 1';
    var full = 'SELECT TOP 12 b.oid, b.main_id, b.ra, b.dec, b.otype, d.description, f.V, ' +
               'DISTANCE(' + P + ', ' + C + ') AS dist ' +
               'FROM basic AS b LEFT JOIN otypedef AS d ON d.otype = b.otype ' +
               'LEFT JOIN allfluxes AS f ON f.oidref = b.oid WHERE ' + where + ' ORDER BY dist';
    var bare = 'SELECT TOP 12 b.oid, b.main_id, b.ra, b.dec, b.otype, ' +
               'DISTANCE(' + P + ', ' + C + ') AS dist FROM basic AS b WHERE ' + where + ' ORDER BY dist';
    return tap(full, signal).catch(function (e) {
      if (e && e.name === 'AbortError') throw e;
      return tap(bare, signal);
    });
  }

  // Large objects whose catalogued extent contains (ra, dec): the galaxy or
  // nebula the click is ON, even when its centre is far away.
  function containingQuery(ra, dec, signal) {
    var P = "POINT('ICRS', b.ra, b.dec)", C = "POINT('ICRS', " + lit(ra) + ', ' + lit(dec) + ')';
    var q = 'SELECT TOP 3 b.oid, b.main_id, b.otype, b.galdim_majaxis, ' +
            'DISTANCE(' + P + ', ' + C + ') AS dist FROM basic AS b ' +
            "WHERE CONTAINS(" + P + ", CIRCLE('ICRS', " + lit(ra) + ', ' + lit(dec) + ', ' + EXT_SEARCH_DEG + ')) = 1 ' +
            'AND b.galdim_majaxis > 2 ' +
            'AND DISTANCE(' + P + ', ' + C + ') < b.galdim_majaxis / 120.0 ' +
            'ORDER BY b.galdim_majaxis DESC';
    return tap(q, signal).catch(function () { return []; });
  }

  function commonName(oid, signal) {
    if (oid === null || oid === undefined) return Promise.resolve(null);
    var q = "SELECT TOP 1 id FROM ident WHERE oidref = " + Math.round(+oid) + " AND id LIKE 'NAME %'";
    return tap(q, signal).then(function (rows) {
      return rows.length ? String(rows[0].id).replace(/^NAME\s+/, '') : null;
    }).catch(function () { return null; });
  }

  // Nearest isn't always what was meant: a click near Vega would otherwise
  // name a 17th-magnitude field star 3" closer. Distance (as a fraction of the
  // pick radius) plus a brightness term; unknown magnitude counts as faint.
  function rank(rows, rArcsec) {
    return rows.map(function (o) {
      var d = num(o.dist) * 3600, v = num(o.v);
      var faint = v === null ? 1 : Math.max(0, Math.min(1, (v + 1) / 16));
      return { o: o, d: d, v: v, score: d / rArcsec + 0.9 * faint };
    }).sort(function (a, b) { return a.score - b.score; });
  }

  // ── the panel ────────────────────────────────────────────────────────────

  var CSS_ID = 'gs-sky-lookup-css';
  var CSS = [
    '#' + PANEL_ID + '{position:absolute;top:10px;right:10px;z-index:11;max-width:min(270px,calc(100% - 64px));',
    '  background:rgba(11,15,25,.92);border:1px solid #1f2937;border-radius:8px;padding:9px 30px 9px 11px;',
    '  color:#e5e7eb;font:12.5px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;',
    '  box-shadow:0 2px 10px rgba(0,0,0,.5)}',
    '#' + PANEL_ID + ' .t{font-weight:600;font-size:14px;color:#f8fafc}',
    '#' + PANEL_ID + ' .s{color:#94a3b8}',
    '#' + PANEL_ID + ' .in{margin-top:6px;padding-top:6px;border-top:1px solid #1f2937;color:#cbd5e1}',
    '#' + PANEL_ID + ' .alt{margin-top:6px;padding-top:6px;border-top:1px solid #1f2937;color:#94a3b8;font-size:11.5px}',
    '#' + PANEL_ID + ' a{color:#93c5fd;text-decoration:none}',
    '#' + PANEL_ID + ' a:hover{text-decoration:underline}',
    '#' + PANEL_ID + ' button.x{position:absolute;top:5px;right:5px;border:none;background:transparent;',
    '  color:#94a3b8;font-size:13px;line-height:1;padding:4px;cursor:pointer}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style');
    st.id = CSS_ID; st.textContent = CSS;
    document.head.appendChild(st);
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function panel() {
    var sv = SV(), wrap = sv && sv.getCanvasWrap ? sv.getCanvasWrap() : null;
    if (!wrap) return null;
    injectCss();
    var p = document.getElementById(PANEL_ID);
    if (!p || p.parentNode !== wrap) {
      if (p && p.parentNode) p.parentNode.removeChild(p);
      p = document.createElement('div');
      p.id = PANEL_ID;
      p.setAttribute('role', 'status');
      p.setAttribute('aria-live', 'polite');
      // Clicks on the panel must not fall through to the sky (a new lookup).
      ['click', 'pointerdown', 'mousedown', 'touchstart'].forEach(function (t) {
        p.addEventListener(t, function (ev) { ev.stopPropagation(); }, { passive: true });
      });
      wrap.appendChild(p);
    }
    return p;
  }
  function show(html) {
    var p = panel();
    if (!p) return;
    p.innerHTML = html + '<button class="x" type="button" aria-label="Close">✕</button>';
    p.querySelector('button.x').onclick = function () { hide(); };
  }
  function hide() {
    var p = document.getElementById(PANEL_ID);
    if (p && p.parentNode) p.parentNode.removeChild(p);
  }

  function link(id, text) {
    return '<a href="' + SIMBAD_ID_URL() + encodeURIComponent(id) + '" target="_blank" rel="noopener">' + esc(text) + '</a>';
  }

  function render(best, alts, inside, name, rArcsec) {
    if (!best && !inside.length) {
      show('<div class="t">Nothing catalogued here</div>' +
           '<div class="s">No SIMBAD object within ' + esc(fmtArcsec(rArcsec)) +
           ' of your click. Zoom in on a star and try again.</div>');
      return;
    }
    var h = '';
    if (best) {
      var o = best.o, title = name || prettyId(o.main_id);
      h += '<div class="t">' + esc(title) + '</div>';
      var bits = [typeText(o.otype, o.description)];
      if (name && prettyId(o.main_id) !== name) bits.push(prettyId(o.main_id));
      h += '<div>' + esc(bits.join(' · ')) + '</div>';
      var s = [];
      if (best.v !== null) s.push('V ' + best.v.toFixed(2));
      s.push(fmtArcsec(best.d) + ' from your click');
      h += '<div class="s">' + esc(s.join(' · ')) + ' · ' + link(o.main_id, 'SIMBAD') + '</div>';
    }
    inside.forEach(function (x) {
      var nm = x.name || prettyId(x.main_id);
      if (best && x.main_id === best.o.main_id) return;
      h += '<div class="in">Inside ' + link(x.main_id, nm) + ' <span class="s">(' +
           esc(typeText(x.otype, null)) + ', ' + esc(fmtArcsec(num(x.galdim_majaxis) * 60)) + ' across)</span></div>';
    });
    if (alts.length) {
      h += '<div class="alt">Also near: ' + alts.map(function (a) {
        return link(a.o.main_id, prettyId(a.o.main_id)) + ' (' + esc(fmtArcsec(a.d)) + ')';
      }).join(', ') + '</div>';
    }
    h += '<div class="alt">Data: SIMBAD, CDS Strasbourg</div>';
    show(h);
  }

  // ── identify ─────────────────────────────────────────────────────────────

  var inflight = null;

  function identify(ra, dec, rArcsec, opts) {
    opts = opts || {};
    if (!skyOpen()) return Promise.resolve(null);
    if (privacyOn()) {
      show('<div class="t">Object lookup is off</div>' +
           '<div class="s">Privacy mode is active, so the sky position (your location) is not sent anywhere.</div>');
      return Promise.resolve(null);
    }
    if (typeof fetch !== 'function') return Promise.resolve(null);
    var r = Math.max(MIN_R, Math.min(MAX_R, rArcsec || 30));
    if (inflight) { try { inflight.abort(); } catch (e) {} }
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    inflight = ctl;
    var sig = ctl ? ctl.signal : undefined;
    show('<div class="s">Looking up what is here…</div>');

    return Promise.all([coneQuery(ra, dec, r, sig), containingQuery(ra, dec, sig)])
      .then(function (res) {
        if (inflight !== ctl) return null;                    // a newer click took over
        var ranked = rank(res[0], r);
        var best = ranked[0] || null;
        var alts = ranked.slice(1, 3);
        var inside = res[1] || [];
        var names = [best ? commonName(best.o.oid, sig) : Promise.resolve(null)]
          .concat(inside.map(function (x) { return commonName(x.oid, sig); }));
        return Promise.all(names).then(function (n) {
          if (inflight !== ctl) return null;
          inside.forEach(function (x, i) { x.name = n[i + 1]; });
          render(best, alts, inside, opts.name || n[0], r);
          return best ? best.o : null;
        });
      })
      .catch(function (e) {
        if (e && e.name === 'AbortError' && inflight !== ctl) return null;
        if (opts.offline) {
          show('<div class="t">' + esc(opts.offline.oname) + '</div>' +
               '<div class="s">From Geosonify’s built-in catalogue. SIMBAD is not answering, ' +
               'so there are no further details for now.</div>');
          return null;
        }
        show('<div class="t">Couldn’t reach SIMBAD</div>' +
             '<div class="s">The object lookup needs a network connection to CDS. ' +
             esc(e && e.message ? e.message : '') + '</div>');
        return null;
      });
  }

  // ── search by name ───────────────────────────────────────────────────────

  /*
    BUILT-IN NAMES, checked before any network: the named bright stars already
    shipped in geosonify-sky-stars.js (proper names such as Vega, Bayer-style
    labels such as "Kap Cen", HR numbers), and the 110 Messier objects below,
    by M number, "Messier N", NGC designation and common name. So the names
    people actually type work offline and through a CDS outage, which is when
    this was added (late October 2026, when SIMBAD and Sesame were offline and
    "Vega" and "M31" came back "not found").

    Messier positions: d3-celestial data/messier.json, (c) 2015 Olaf Frohn,
    BSD 3-clause. Rounded to about 0.01 degree, ample for pointing the view;
    SIMBAD, when it answers, supplies the exact identification afterwards.
    Rows are [M number, RA deg, Dec deg, NGC designation, common name].
  */
  var MESSIER = [
    [1,83.6250,22.0167,"NGC 1952","Crab Nebula"],[2,323.3750,-0.8167,"NGC 7089",""],
    [3,205.5500,28.3833,"NGC 5272",""],[4,245.9000,-26.5333,"NGC 6121",""],
    [5,229.6500,2.0833,"NGC 5904",""],[6,265.0249,-32.2167,"NGC 6405","Butterfly Cluster"],
    [7,268.4750,-34.8167,"NGC 6475","Ptolemy's Cluster"],
    [8,270.9500,-24.3833,"NGC 6523","Lagoon Nebula"],[9,259.8000,-18.5167,"NGC 6333",""],
    [10,254.2751,-4.1000,"NGC 6254",""],[11,282.7750,-6.2667,"NGC 6705","Wild Duck Cluster"],
    [12,251.8001,-1.9500,"NGC 6218",""],[13,250.4250,36.4667,"NGC 6205","Great Hercules Cluster"],
    [14,264.4001,-3.2500,"NGC 6402",""],[15,322.5000,12.1667,"NGC 7078",""],
    [16,274.7000,-13.7833,"NGC 6611","Eagle Nebula"],
    [17,275.2000,-16.1833,"NGC 6618","Omega Nebula"],[18,274.9751,-17.1333,"NGC 6613",""],
    [19,255.6500,-26.2667,"NGC 6273",""],[20,270.6499,-23.0333,"NGC 6514","Trifid Nebula"],
    [21,271.1501,-22.5000,"NGC 6531",""],[22,279.1001,-23.9000,"NGC 6656",""],
    [23,269.2001,-19.0167,"NGC 6494",""],[24,274.2250,-18.4833,"","Milky Way patch"],
    [25,277.9000,-19.2500,"IC 4725",""],[26,281.2999,-9.4000,"NGC 6694",""],
    [27,299.8999,22.7167,"NGC 6853","Dumbbell Nebula"],[28,276.1250,-24.8667,"NGC 6626",""],
    [29,305.9750,38.5333,"NGC 6913",""],[30,325.0999,-23.1833,"NGC 7099",""],
    [31,10.6751,41.2667,"NGC 224","Andromeda"],[32,10.6751,40.8667,"NGC 221",""],
    [33,23.4750,30.6500,"NGC 598","Triangulum"],[34,40.5000,42.7833,"NGC 1039",""],
    [35,92.2249,24.3333,"NGC 2168",""],[36,84.0251,34.1333,"NGC 1960",""],
    [37,88.1000,32.5500,"NGC 2099",""],[38,82.1750,35.8333,"NGC 1912",""],
    [39,323.0501,48.4333,"NGC 7092",""],[40,185.5999,58.0833,"WN 4",""],
    [41,101.7500,-20.7333,"NGC 2287",""],[42,83.8500,-5.4500,"NGC 1976","Orion Nebula"],
    [43,83.9000,-5.2667,"NGC 1982",""],[44,130.0250,19.9833,"NGC 2632","Praesepe"],
    [45,56.7500,24.1167,"","Pleiades"],[46,115.4501,-14.8167,"NGC 2437",""],
    [47,114.1500,-14.5000,"NGC 2422",""],[48,123.4500,-5.8000,"NGC 2548",""],
    [49,187.4501,8.0000,"NGC 4472",""],[50,105.8000,-8.3333,"NGC 2323",""],
    [51,202.4749,47.2000,"NGC 5194/5","Whirlpool"],[52,351.0500,61.5833,"NGC 7654",""],
    [53,198.2250,18.1667,"NGC 5024",""],[54,283.7749,-30.4833,"NGC 6715",""],
    [55,295.0000,-30.9667,"NGC 6809",""],[56,289.1500,30.1833,"NGC 6779",""],
    [57,283.3999,33.0333,"NGC 6720","Ring Nebula"],[58,189.4250,11.8167,"NGC 4579",""],
    [59,190.5000,11.6500,"NGC 4621",""],[60,190.9250,11.5500,"NGC 4649",""],
    [61,185.4750,4.4667,"NGC 4303",""],[62,255.3000,-30.1167,"NGC 6266",""],
    [63,198.9500,42.0333,"NGC 5055","Sunflower Galaxy"],
    [64,194.1750,21.6833,"NGC 4826","Blackeye Galaxy"],[65,169.7250,13.0833,"NGC 3623",""],
    [66,170.0501,12.9833,"NGC 3627",""],[67,132.6000,11.8167,"NGC 2682",""],
    [68,189.8749,-26.7500,"NGC 4590",""],[69,277.8500,-32.3500,"NGC 6637",""],
    [70,280.8000,-32.3000,"NGC 6681",""],[71,298.4501,18.7833,"NGC 6838",""],
    [72,313.3751,-12.5333,"NGC 6981",""],[73,314.7251,-12.6333,"NGC 6994","4 Star asterism"],
    [74,24.1751,15.7833,"NGC 628",""],[75,301.5250,-21.9167,"NGC 6864",""],
    [76,25.6001,51.5667,"NGC 650/1","Little Dumbbell Nebula"],
    [77,40.6751,-0.0167,"NGC 1068","Cetus A"],[78,86.6750,0.0500,"NGC 2068",""],
    [79,81.1250,-24.5500,"NGC 1904",""],[80,244.2499,-22.9833,"NGC 6093",""],
    [81,148.8996,69.0667,"NGC 3031","Bode's Galaxy"],
    [82,148.9496,69.6833,"NGC 3034","Cigar Galaxy"],
    [83,204.2500,-29.8667,"NGC 5236","Southern Pinwheel"],[84,186.2750,12.8833,"NGC 4374",""],
    [85,186.3500,18.1833,"NGC 4382",""],[86,186.5501,12.9500,"NGC 4406",""],
    [87,187.7000,12.4000,"NGC 4486","Virgo A"],[88,187.9999,14.4167,"NGC 4501",""],
    [89,188.9250,12.5500,"NGC 4552",""],[90,189.2000,13.1667,"NGC 4569",""],
    [91,188.8500,14.5000,"NGC 4548",""],[92,259.2750,43.1333,"NGC 6341",""],
    [93,116.1500,-23.8667,"NGC 2447",""],[94,192.7250,41.1167,"NGC 4736","Cat's Eye Galaxy"],
    [95,161.0000,11.7000,"NGC 3351",""],[96,161.7000,11.8167,"NGC 3368",""],
    [97,168.7001,55.0167,"NGC 3587","Owl Nebula"],[98,183.4500,14.9000,"NGC 4192",""],
    [99,184.7000,14.4167,"NGC 4254",""],[100,185.7251,15.8167,"NGC 4321",""],
    [101,210.8000,54.3500,"NGC 5457","Pinwheel"],[102,226.6226,55.7600,"NGC 5866","Spindle"],
    [103,23.3000,60.7000,"NGC 581",""],[104,190.0000,-11.6167,"NGC 4594","Sombrero"],
    [105,161.9501,12.5833,"NGC 3379",""],[106,184.7501,47.3000,"NGC 4258",""],
    [107,248.1250,-13.0500,"NGC 6171",""],[108,167.8751,55.6667,"NGC 3556",""],
    [109,179.4000,53.3833,"NGC 3992",""],[110,10.1000,41.6833,"NGC 205",""]
  ];
  var _localIndex = null;
  function normName(s) {
    return String(s || '').toLowerCase().replace(/[\u2019\u00b4']/g, '').replace(/[^a-z0-9]+/g, '');
  }
  function localIndex() {
    if (_localIndex) return _localIndex;
    var ix = {};
    function put(k, v) { k = normName(k); if (k && !ix[k]) ix[k] = v; }
    MESSIER.forEach(function (m) {
      var v = { ra: m[1], dec: m[2], oname: 'M ' + m[0] + (m[4] ? ' (' + m[4] + ')' : ''),
                extended: true };
      put('M' + m[0], v); put('Messier ' + m[0], v);
      if (m[3]) put(m[3], v);
      if (m[4]) put(m[4], v);
    });
    var SS = global.GeosonifySkyStars;
    (SS && SS.STARS || []).forEach(function (st) {
      if (!st[3]) return;
      put(st[3], { ra: st[0], dec: st[1], oname: st[3], extended: false });
    });
    if (SS) _localIndex = ix;          // not cached until the star list has loaded
    return ix;
  }
  // "Andromeda Galaxy" finds Andromeda; "Orion Nebula" is listed as it is.
  function localName(q) {
    var ix = localIndex(), k = normName(q);
    if (ix[k]) return ix[k];
    var bare = k.replace(/(galaxy|nebula|cluster|star)$/, '');
    if (bare !== k && ix[bare]) return ix[bare];
    var the = k.replace(/^the/, '');
    return ix[the] || null;
  }

  function sesame(name) {
    return viaMirrors('sesame', SESAME_BASES, '/-ox/~SNV?' + encodeURIComponent(name), function (r) {
      return r.text().then(function (t) { return /<Sesame/i.test(t) ? t : null; });
    })
      .then(function (txt) {
        var doc = new DOMParser().parseFromString(txt, 'text/xml');
        var res = doc.getElementsByTagName('Resolver');
        for (var i = 0; i < res.length; i++) {
          var ra = res[i].getElementsByTagName('jradeg')[0], de = res[i].getElementsByTagName('jdedeg')[0];
          if (!ra || !de) continue;
          var on = res[i].getElementsByTagName('oname')[0], ot = res[i].getElementsByTagName('otype')[0];
          return { ra: +ra.textContent, dec: +de.textContent,
                   oname: on ? on.textContent.trim() : null, otype: ot ? ot.textContent.trim() : null };
        }
        return null;
      });
  }

  // Aladin's own resolver, when Aladin is on screen and Sesame was not reachable.
  function viaAladin(name) {
    var sv = SV(), r = sv && sv.getRenderer ? sv.getRenderer() : null;
    var al = r && r._aladin ? r._aladin() : null;
    if (!al || typeof al.gotoObject !== 'function') return Promise.resolve(null);
    return new Promise(function (resolve) {
      var done = false;
      setTimeout(function () { if (!done) { done = true; resolve(null); } }, TIMEOUT_MS);
      try {
        al.gotoObject(name, {
          success: function (rd) { if (done) return; done = true; resolve(rd ? { ra: +rd[0], dec: +rd[1] } : null); },
          error: function () { if (done) return; done = true; resolve(null); }
        });
      } catch (e) { done = true; resolve(null); }
    });
  }

  function typedPosition(text) {
    var S = Sky();
    if (!S || !S.parsePosition) return null;
    try { var p = S.parsePosition(text); return { ra: p.raDeg, dec: p.decDeg }; } catch (e) { return null; }
  }

  function lookupName(text) {
    var q = String(text || '').trim();
    if (!q) { toast('Type a star, galaxy or nebula — e.g. Vega, M31', 'error'); return Promise.resolve(false); }
    var sv = SV();
    if (!skyOpen()) return Promise.resolve(false);
    var pos = typedPosition(q);
    if (pos) {
      sv.goTo(pos.ra, pos.dec);
      return identify(pos.ra, pos.dec, 30).then(function () { return true; });
    }
    var local = localName(q);
    if (local) {
      sv.goTo(local.ra, local.dec);
      // Identify through SIMBAD if it answers; if not, the built-in entry is
      // still a true answer, so say what it is rather than "couldn't reach".
      return identify(local.ra, local.dec, local.extended ? 120 : 5,
                      { name: local.oname, offline: local }).then(function () { return true; });
    }
    show('<div class="s">Finding “' + esc(q) + '”…</div>');
    var unreachable = false;
    return sesame(q).catch(function () { unreachable = true; return null; })
      .then(function (hit) { return hit || viaAladin(q); })
      .then(function (hit) {
        if (!hit || !isFinite(hit.ra) || !isFinite(hit.dec)) {
          show(unreachable
            ? '<div class="t">Couldn’t reach the name resolver</div><div class="s">Sesame at the CDS ' +
              'and its mirrors are not answering, so “' + esc(q) + '” could not be looked up. Bright-star ' +
              'names and Messier objects (Vega, M31, Orion Nebula) still work, and so does a typed ' +
              'position such as 05 35 17 -05 23 28.</div>'
            : '<div class="t">Not found</div><div class="s">No object called “' + esc(q) +
              '” in SIMBAD, NED or VizieR. Try a catalogue name such as M42 or HD 172167.</div>');
          return false;
        }
        sv.goTo(hit.ra, hit.dec);
        // A name search is the person asking about this object, so identify
        // it (tight radius: Sesame already gave the exact position).
        return identify(hit.ra, hit.dec, 5, { name: hit.oname ? prettyId(hit.oname) : q })
          .then(function () { return true; });
      });
  }

  // ── the Shape tab's search box, in the sky ───────────────────────────────

  var savedPlaceholder = null;
  function updateSearchBox() {
    var input = document.getElementById(SEARCH_INPUT);
    if (!input) return;
    if (savedPlaceholder === null) savedPlaceholder = input.getAttribute('placeholder') || '';
    input.setAttribute('placeholder', skyOpen()
      ? 'Search the sky — e.g. Vega, M31, Orion Nebula, 05 35 17 -05 23 28'
      : savedPlaceholder);
  }

  // Capture phase on the document runs BEFORE the button's own listener in
  // index.html (the Nominatim search), so in the sky that one never runs and
  // no celestial query is ever sent to Nominatim. On Earth this does nothing.
  // Enter in the box calls button.click(), which comes through here too.
  function onSearchClick(ev) {
    var t = ev.target;
    if (!t || !t.closest || !t.closest('#' + SEARCH_BTN) || !skyOpen()) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    var btn = document.getElementById(SEARCH_BTN), input = document.getElementById(SEARCH_INPUT);
    if (!btn || btn.disabled) return;
    var label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Searching...';
    lookupName(input ? input.value : '').then(function (ok) {
      if (!ok) toast('Not found in the sky catalogues', 'error');
    }).catch(function () {}).then(function () {
      btn.disabled = false; btn.textContent = label;
    });
  }

  function boot() {
    var sv = SV();
    if (!sv || !sv.on) return;
    sv.on('click', function (p) {
      if (!p || !isFinite(p.ra) || !isFinite(p.dec)) return;
      identify(p.ra, p.dec, p.radiusArcsec);
    });
    sv.on('open', updateSearchBox);
    sv.on('close', function () {
      if (inflight) { try { inflight.abort(); } catch (e) {} inflight = null; }
      updateSearchBox();
    });
    document.addEventListener('click', onSearchClick, true);
    updateSearchBox();
  }

  var API = {
    VERSION: VERSION,
    identify: identify,
    lookupName: lookupName,
    hide: hide,
    SIMBAD_BASES: SIMBAD_BASES,
    SESAME_BASES: SESAME_BASES,
    _test: { prettyId: prettyId, rank: rank, typeText: typeText, fmtArcsec: fmtArcsec,
             tap: tap, viaMirrors: viaMirrors, localName: localName, MESSIER: MESSIER }
  };
  global.GeosonifySkyLookup = API;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
