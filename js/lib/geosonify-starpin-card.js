/*
  geosonify-starpin-card.js v0.1 — the claim card

  Two cards, deliberately unequal:

    STARPIN     full screen, on the moment of bagging. A star gave you an
                address and you went there; that deserves the whole display.
    CORNERSTONE quieter, records-only. A lattice vertex is a fine thing to
                collect but nobody travelled to it because of a star.

  Visual grammar is inherited from star-claim-card.html: Fraunces + IBM Plex,
  the brass hairline, the centred medallion, the ledger, the perforated stub.

  TWO DELIBERATE DEPARTURES from that prototype, both settled earlier:

    1. NO SINGLE SCORE. The prototype computed one number and ranked white
       dwarfs above supergiants by fiat. Separate facts, separately stated.
    2. NO INVENTED RARITY TIER. Findability from magnitude is an observing
       statement and is hedged as one; "unknown" beats pretend certainty.

  Needs geosonify-starpin.js. Uses geosonify-healpix.js for the cornerstone
  card's grid background, and degrades to a plain card without it.

      GeosonifyStarpinCard.show({ kind:'starpin', star:{...}, record:{...} });
      var el = GeosonifyStarpinCard.render({ kind:'cornerstone', ... });
*/
'use strict';

var GeosonifyStarpinCard = (function () {

  var S = (typeof GeosonifyStarpin !== 'undefined') ? GeosonifyStarpin
        : (typeof require === 'function' ? (function () {
            try { return require('./geosonify-starpin.js'); } catch (e) { return null; } })() : null);
  var F = (typeof GeosonifyStarpinFeedback !== 'undefined') ? GeosonifyStarpinFeedback
        : (typeof require === 'function' ? (function () {
            try { return require('./geosonify-starpin-feedback.js'); } catch (e) { return null; } })() : null);

  function HP() {
    try { if (typeof HealpixGrids !== 'undefined') return HealpixGrids; } catch (e) {}
    try { if (typeof window !== 'undefined' && window.HealpixGrids) return window.HealpixGrids; }
    catch (e) {}
    try { return require('./geosonify-healpix.js'); } catch (e) { return null; }
  }

  var CSS_ID = 'starpin-card-css';
  var D2R = Math.PI / 180;

  var CSS = [
    '@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap");',
    '.spc-card{--ink:#0A0E1C;--paper:#E9E4D6;--brass:#DCC949;--verdigris:#7D9D33;',
    '  --silver:#B7C0CC;--violet:#C9C3EC;--pewter:#7C8494;--text:#E9E4D6;--muted:#8891A8;',
    '  --green:#7D9D33;',
    '  position:relative;width:min(92vw,340px);padding:20px 22px 18px;border-radius:14px;',
    '  background:linear-gradient(168deg,#141A2E 0%,#0C1120 60%,#0A0E1C 100%);',
    '  color:var(--text);font-family:"IBM Plex Sans",system-ui,sans-serif;',
    '  box-shadow:0 24px 60px rgba(0,0,0,.55);display:flex;flex-direction:column;',
    '  border:1px solid rgba(220,201,73,.30);overflow:hidden}',
    '.spc-card .bg{position:absolute;inset:0;opacity:.5;pointer-events:none}',
    '.spc-card .inner{position:relative;z-index:1}',
    // Legibility over the bright sunrise band: a soft dark halo on the text,
    // and muted labels lifted toward the light ink. On the rarest cards, whole
    // lower zones instead flip to dark navy ink (see zone-flip below) — dark on
    // gold is the naturally legible pairing, so the sunrise stays untouched.
    '.spc-card.spc-sunlit .inner{text-shadow:0 1px 2px rgba(4,8,20,.7),0 0 2px rgba(4,8,20,.85)}',
    '.spc-card.spc-sunlit .spc-ledger .k,.spc-card.spc-sunlit .spc-title .cat,',
    '.spc-card.spc-sunlit .spc-stub .k,',
    '.spc-card.spc-sunlit .spc-note{color:#D6DAE6}',
    // The printable-hint footer is light like the rest on sunlit cards (unless it
    // flips to dark ink over gold — see dark-footer below).
    '.spc-card.spc-sunlit .spc-flip{color:#D6DAE6;opacity:1}',
    // Zone-aware dark ink. When a zone sits on pale gold it flips to navy ink and
    // drops its shadow; each zone flips independently of the other.
    '.spc-card.zone-flip .spc-stub,.spc-card.zone-flip .spc-stub .k,',
    '.spc-card.zone-flip .spc-stub .yes,.spc-card.zone-flip .spc-perf,',
    '.spc-card.zone-flip .spc-flip{transition:color .2s,border-color .2s,opacity .2s}',
    '.spc-card.zone-flip.dark-stub .spc-stub{color:#0A0E1C;text-shadow:none}',
    '.spc-card.zone-flip.dark-stub .spc-stub .k{color:rgba(10,14,28,.68)}',
    '.spc-card.zone-flip.dark-stub .spc-stub .v{color:#0A0E1C}',
    '.spc-card.zone-flip.dark-stub .spc-stub .yes{color:#354A12}',
    '.spc-card.zone-flip.dark-stub .spc-perf{border-color:rgba(10,14,28,.28)}',
    '.spc-card.zone-flip.dark-footer .spc-flip{color:#0A0E1C;text-shadow:none;opacity:.68}',
    '.spc-kicker{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.18em;',
    '  text-transform:uppercase;color:var(--brass);text-align:center}',
    '.spc-brand{font-family:"Source Code Pro","SF Mono",ui-monospace,monospace;',
    '  font-size:18px;font-weight:600;text-align:center;color:var(--brass);',
    '  letter-spacing:-.01em;line-height:1}',
    '.spc-brand i{font-style:normal;color:var(--verdigris)}',
    '.spc-rule{height:1px;background:linear-gradient(90deg,transparent,var(--brass),transparent);',
    '  margin:8px 0 14px}',
    '.spc-title{text-align:center;margin-bottom:12px}',
    '.spc-title .cat{font-family:"IBM Plex Mono",monospace;font-size:10px;color:var(--muted);',
    '  letter-spacing:.1em;text-transform:uppercase}',
    '.spc-title .id{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:19px;',
    '  line-height:1.25;margin-top:3px;word-break:break-word}',
    '.spc-med{display:flex;justify-content:center;margin:2px 0 10px}',
    '.spc-ground{position:relative;width:176px;height:176px;border-radius:16px;overflow:hidden;',
    '  background:#070A14;box-shadow:0 0 0 1px rgba(220,201,73,.4),0 12px 30px -12px rgba(0,0,0,.8)}',
    '.spc-ground img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}',
    '.spc-ground .spc-overlay{position:absolute;inset:0;width:100%;height:100%}',
    '.spc-ground-cap{font-size:10px;line-height:1.3;color:var(--muted);text-align:center;margin-top:4px;letter-spacing:.02em}',
    '.spc-card.light .spc-ground-cap{color:#5C6349}',
    '.spc-card.mini .spc-ground{width:150px;height:150px}',
    '.spc-place{text-align:center;font-size:12.5px;line-height:1.35;margin:-4px 0 10px;color:var(--text);opacity:.88}',
    '.spc-place:empty{display:none}',
    '.spc-card.light .spc-place{color:#22270F}',
    '.spc-osm{text-align:center;font-size:9.5px;opacity:.55;margin-top:6px;letter-spacing:.02em}',
    '.spc-sky{position:relative;width:112px;height:112px}',
    '.spc-sky img{width:100%;height:100%;border-radius:50%;object-fit:cover;background:#070A14;',
    '  display:block}',
    '.spc-ring{position:absolute;inset:0;width:100%;height:100%;overflow:visible}',
    // An OPEN crosshair, not a filled square: the target is often a faint dot
    // and the square hid the very thing you travelled to see. Four ticks with a
    // clear gap in the middle, so the object shows through the centre.
    '.spc-target{position:absolute;left:50%;top:50%;width:26px;height:26px;',
    '  margin:-13px 0 0 -13px;pointer-events:none;',
    '  filter:drop-shadow(0 0 2px rgba(0,0,0,.85))}',
    '.spc-target::before,.spc-target::after{content:"";position:absolute;',
    '  background:#39ff88;box-shadow:0 0 4px rgba(57,255,136,.6)}',
    // vertical pair (gap in the middle) + horizontal pair, via two gradients
    '.spc-target::before{left:50%;top:0;width:2px;height:26px;margin-left:-1px;',
    '  background:linear-gradient(#39ff88 0 9px,transparent 9px 17px,#39ff88 17px 26px)}',
    '.spc-target::after{top:50%;left:0;height:2px;width:26px;margin-top:-1px;',
    '  background:linear-gradient(90deg,#39ff88 0 9px,transparent 9px 17px,#39ff88 17px 26px)}',
    '.spc-coords{text-align:center;font-family:"IBM Plex Mono",monospace;font-size:10.5px;',
    '  color:var(--muted);margin-bottom:12px}',
    '.spc-coords b{color:var(--text);font-weight:500}',
    '.spc-ledger .row{display:flex;justify-content:space-between;align-items:baseline;gap:10px;',
    '  padding:5px 0;border-bottom:1px solid rgba(184,192,212,.10)}',
    '.spc-ledger .k{font-family:"IBM Plex Mono",monospace;font-size:9.5px;letter-spacing:.1em;',
    '  color:var(--muted);text-transform:uppercase;white-space:nowrap}',
    '.spc-ledger .v{font-size:12px;font-weight:500;text-align:right}',
    '.spc-ledger .v.mono{font-family:"IBM Plex Mono",monospace;font-weight:400;font-size:11px}',
    '.spc-note{font-size:10.5px;color:var(--muted);line-height:1.5;margin-top:10px;text-align:center}',
    '.spc-stub{margin-top:14px;padding-top:12px}',
    '.spc-perf{height:1px;border-top:1px dashed #384068;margin-bottom:10px}',
    '.spc-stub .row{display:flex;justify-content:space-between;gap:10px;padding:3px 0}',
    '.spc-stub .k{font-family:"IBM Plex Mono",monospace;font-size:9px;letter-spacing:.1em;',
    '  color:var(--muted);text-transform:uppercase}',
    '.spc-stub .v{font-family:"IBM Plex Mono",monospace;font-size:10.5px}',
    '.spc-stub .yes{color:var(--green)}',
    '.spc-card.mini{width:100%;padding:14px 16px;border-radius:11px}',
    '.spc-card.culm{border:2px solid var(--brass);',
    '  box-shadow:0 0 0 1px rgba(220,201,73,.28),0 10px 40px rgba(220,201,73,.20)}',
    '.spc-card .k.culm,.spc-card .v.culm{color:var(--brass)}',
    // Print variant: the same card on paper. The dark one is for a screen at
    // night; this one is for a printer that would otherwise flood a page.
    '.spc-card.light{--text:#22270F;--muted:#5C6349;--brass:#7A6710;',
    '  --verdigris:#4F6620;--green:#3F6318;',
    '  background:#FCFDF4;border-color:rgba(122,103,16,.45);',
    '  box-shadow:0 10px 30px -18px rgba(34,39,15,.5)}',
    // Printable: black-on-white, coloured header stays high-contrast. The sunrise
    // inline background is stripped on flip (see render click handler), so paper
    // shows through cleanly.
    '.spc-card.light .bg{opacity:.85}',
    '.spc-card{cursor:pointer}',
    '.spc-flip{font-family:"IBM Plex Mono",monospace;font-size:9px;letter-spacing:.12em;',
    '  text-transform:uppercase;color:var(--muted);text-align:center;margin-top:10px;',
    '  opacity:.75}',
    '.spc-card.mini .spc-title .id{font-size:14px}',
    '.spc-card.mini .spc-med{margin:0 0 6px}',
    // full-screen presentation
    // Scrolls when the card is taller than the screen, so its buttons are always
    // reachable. Auto margins centre a short card without clipping a tall one
    // (align-items:center would push its top off-screen, out of scroll's reach).
    '.spc-stage{position:fixed;inset:0;z-index:10000;display:flex;align-items:flex-start;',
    '  justify-content:center;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;',
    '  padding:calc(16px + env(safe-area-inset-top,0px)) 16px calc(24px + env(safe-area-inset-bottom,0px));',
    '  background:rgba(5,7,14,.86);',
    '  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;',
    '  transition:opacity .35s}',
    '.spc-stage.on{opacity:1}',
    '.spc-stage .wrap{margin:auto 0;transform:scale(.94) translateY(10px);transition:transform .45s cubic-bezier(.2,.9,.25,1)}',
    '.spc-stage.on .wrap{transform:none}',
    '.spc-close{margin-top:14px;display:block;width:100%;font:inherit;font-size:13px;',
    '  padding:.6rem 1rem;border-radius:10px;border:1px solid rgba(220,201,73,.55);',
    '  background:transparent;color:#C6A15B;cursor:pointer}',
    '@media (prefers-reduced-motion:reduce){.spc-stage,.spc-stage .wrap{transition:none}}'
  ].join('\n');

  function injectCss(doc) {
    if (doc.getElementById(CSS_ID)) return;
    var st = doc.createElement('style'); st.id = CSS_ID; st.textContent = CSS;
    doc.head.appendChild(st);
  }

  // ── formatting ────────────────────────────────────────────────────────────
  function raToHMS(ra) {
    var h = ra / 15, hh = Math.floor(h), m = (h - hh) * 60, mm = Math.floor(m);
    return hh + 'h ' + (mm < 10 ? '0' : '') + mm + 'm ' +
           ((m - mm) * 60 < 10 ? '0' : '') + ((m - mm) * 60).toFixed(1) + 's';
  }
  function decToDMS(dec) {
    var s = dec < 0 ? '\u2212' : '+', a = Math.abs(dec), d = Math.floor(a);
    var m = (a - d) * 60, mm = Math.floor(m);
    return s + d + '\u00B0 ' + (mm < 10 ? '0' : '') + mm + '\u2032 ' +
           ((m - mm) * 60 < 10 ? '0' : '') + ((m - mm) * 60).toFixed(0) + '\u2033';
  }
  function compass(b) { return COMPASS[Math.round(b / 22.5) % 16]; }
  function fmtDate(ms) {
    try {
      return new Date(ms).toLocaleDateString(undefined,
        { year: 'numeric', month: 'short', day: 'numeric' }) + ' \u00B7 ' +
        new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); }
  }

  var COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];

  // ── the sky window ────────────────────────────────────────────────────────
  //
  // This used to be a seeded random star field: stable per source_id, pretty,
  // and ENTIRELY MADE UP. On a card whose whole claim is that everything on it
  // is true, a decorative constellation was the one dishonest element. It is
  // now the actual DSS cutout centred on the star, with a target square at the
  // centre and a bearing notch on the ring.
  //
  // If the image cannot load there is no fallback field of invented stars —
  // just an empty ring. Better a blank than a fiction.
  function skyWindow(doc, d) {
    var box = doc.createElement('div');
    box.className = 'spc-sky';
    if (d.ra != null && d.dec != null) {
      var img = doc.createElement('img');
      img.alt = 'DSS image of the sky around this source';
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      var fov = d.fovArcsec || 48;
      img.src = 'https://alasky.cds.unistra.fr/hips-image-services/hips2fits' +
        '?hips=' + encodeURIComponent('CDS/P/DSS2/color') +
        '&width=240&height=240&fov=' + (fov / 3600) +
        '&projection=TAN&coordsys=icrs&format=jpg' +
        '&ra=' + Number(d.ra).toFixed(6) + '&dec=' + Number(d.dec).toFixed(6);
      box.appendChild(img);
      var mk = doc.createElement('i'); mk.className = 'spc-target';
      box.appendChild(mk);
    }
    var ring = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 112 112');
    ring.setAttribute('class', 'spc-ring');
    function add(tag, attrs) {
      var n = doc.createElementNS('http://www.w3.org/2000/svg', tag);
      for (var k in attrs) n.setAttribute(k, attrs[k]);
      ring.appendChild(n); return n;
    }
    add('circle', { cx: 56, cy: 56, r: 53, fill: 'none',
                    stroke: '#DCC949', 'stroke-opacity': '.5' });
    if (d.bearingDeg != null) {
      var t = (d.bearingDeg - 90) * D2R;
      add('line', { x1: (56 + Math.cos(t) * 47).toFixed(1), y1: (56 + Math.sin(t) * 47).toFixed(1),
                    x2: (56 + Math.cos(t) * 55).toFixed(1), y2: (56 + Math.sin(t) * 55).toFixed(1),
                    stroke: '#DCC949', 'stroke-width': '3', 'stroke-linecap': 'round' });
    }
    box.appendChild(ring);
    return box;
  }

  // ── the cornerstone grid background ───────────────────────────────────────
  // The real lattice at that point, at the real angle. HEALPix cells sit at a
  // rotation that varies with position, so a stylised diamond would be a lie
  // about the one thing this card is documenting.
  function cornerSpanM(order) { return Math.sqrt(510.1e12 / (12 * Math.pow(4, Math.round(order || 12)))) * 2.6; }
  function gridSVG(lat, lon, order, w, h) {
    var H = HP();
    if (!H) return '';
    w = w || 340; h = h || 300;
    var spanM = cornerSpanM(order);                                       // ~2.6 cells across
    var mPerDeg = 111319.9, cosLat = Math.cos(lat * D2R);
    function pt(la, lo) {
      return [w / 2 + (lo - lon) * mPerDeg * cosLat / (spanM / w),
              h / 2 - (la - lat) * mPerDeg / (spanM / w)];
    }
    var out = ['<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="100%" ' +
               'preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g class="st-g"></g>'];
    [order + 1, order].forEach(function (k, idx) {
      var seen = {}, cells = [];
      var stepDeg = (spanM / 6) / mPerDeg;
      for (var a = -3; a <= 3; a++) {
        for (var b = -3; b <= 3; b++) {
          try {
            var ip = H.nestIndex(lat + a * stepDeg, lon + b * stepDeg / cosLat, k).toString();
            if (!seen[ip]) { seen[ip] = 1; cells.push(ip); }
          } catch (e) {}
        }
      }
      var nside = Math.pow(2, k), d = [];
      cells.forEach(function (c) {
        var ipx = BigInt(c);
        var p = [[0,0],[1,0],[1,1],[0,1]].map(function (uv) {
          var v = H._core.pixcoord2vec_nest(nside, ipx, uv[0], uv[1]);
          var x = v.x != null ? v.x : v[0], y = v.y != null ? v.y : v[1],
              z = v.z != null ? v.z : v[2];
          return pt(Math.asin(z / Math.hypot(x, y, z)) / D2R, Math.atan2(y, x) / D2R);
        });
        d.push('M' + p.map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join('L') + 'Z');
      });
      out.push('<path class="grid" d="' + d.join(' ') + '" fill="none" stroke="#7D9D33" stroke-opacity="' +
               (idx ? 0.55 : 0.2) + '" stroke-width="' + (idx ? 1.6 : 0.7) + '"/>');
    });
    // the vertex itself
    out.push('<circle cx="' + (w / 2) + '" cy="' + (h / 2) +
             '" r="7" fill="none" stroke="#8FBF3F" stroke-width="2"/>');
    out.push('<circle cx="' + (w / 2) + '" cy="' + (h / 2) + '" r="2.6" fill="#8FBF3F"/>');
    out.push('</svg>');
    return out.join('');
  }

  // ── rendering ─────────────────────────────────────────────────────────────
  // ── the ground under the find ────────────────────────────────────────────────
  //
  // Both cards now carry the streets, drawn from the same vector tiles as the
  // map (geosonify-starpin-vtiles.js, shared device cache, so a card for a find
  // near home costs no network at all). The streets are what give a card its
  // scale: a star's 3" circle next to real blocks, a cornerstone's cells over
  // real suburbs. Without the tile module the cards degrade to what they were.
  var M_PER_DEG = 111319.9;
  var M_PER_ARCSEC = (S && S.M_PER_ARCSEC) || M_PER_DEG / 3600;
  var R_ARCSEC = (S && S.VISIT_R_ARCSEC) || 3;          // visit-geometry-v1
  var STAR_FOV_ARCSEC = 40;                              // ~1.2 km of ground

  function placeModule() {
    try { if (typeof GeosonifyStarpinPlace !== 'undefined') return GeosonifyStarpinPlace; } catch (e) {}
    return (typeof window !== 'undefined' && window.GeosonifyStarpinPlace) || null;
  }
  function TL() {
    try { if (typeof GeosonifyStarpinTiles !== 'undefined') return GeosonifyStarpinTiles; } catch (e) {}
    try { if (typeof window !== 'undefined' && window.GeosonifyStarpinTiles) return window.GeosonifyStarpinTiles; }
    catch (e) {}
    return null;
  }
  // The page's ONE tile store, shared with the map: a card over ground the map
  // has already shown draws at once, from memory.
  function tileStore() { var T = TL(); return T ? (T.shared ? T.shared() : T.createStore({})) : null; }

  // The tile zoom that puts about three tiles across the card. A street-scale
  // starpin window gets z14 (every lane); an order-7 cornerstone spanning 130 km
  // gets ~z10 (main roads -- which is also what reads at that scale). Asking
  // for z13 across 130 km meant hundreds of tiles, which then pushed each other
  // out of memory as they arrived: the patch that crept up the card and stopped.
  function cardZoom(lat, spanM) {
    var w = 40075016.7 * Math.max(0.05, Math.cos(lat * D2R));
    return Math.max(0, Math.min(14, Math.round(Math.log(w / (spanM / 3)) / Math.LN2)));
  }
  function cardTiles(lat, lon, spanM) {
    var T = TL(), dLat = spanM / 2 / M_PER_DEG, dLon = dLat / Math.max(0.05, Math.cos(lat * D2R));
    var box = { s: lat - dLat, n: lat + dLat, w: lon - dLon, e: lon + dLon };
    var z = cardZoom(lat, spanM), list = T.tilesFor(box, z, 0);
    while (list.length > 36 && z > 0) list = T.tilesFor(box, --z, 0);   // hard ceiling, whatever the span
    return list;
  }
  // What can be drawn NOW: each wanted tile if it is in memory, otherwise its
  // nearest cached ancestor (coarser, fewer lanes, but the right streets in the
  // right places) -- the same stand-in rule the map uses while it loads.
  function roadsNow(st, list) {
    var out = [], seen = {}, complete = true;
    list.forEach(function (t) {
      if (!st.has(t.z, t.x, t.y)) complete = false;
      var g = st.peek(t.z, t.x, t.y), k = g && (g.z + '/' + g.x + '/' + g.y);
      if (!g || seen[k]) return;
      seen[k] = 1;
      out = out.concat(g.roads);
    });
    return { roads: out, complete: complete };
  }
  // On screen: draw what there is immediately, then redraw as each missing tile
  // lands, until every one is in or the card is gone. Never gives up early,
  // never waits to start. Asked for at the FRONT of the queue.
  function liveRoads(el, lat, lon, spanM, paint) {
    var T = TL(), st = tileStore();
    if (!T || !st || lat == null || lon == null) return;
    var list = cardTiles(lat, lon, spanM), pending = null, unsub = null, t0 = Date.now();
    function ask() { list.forEach(function (t) { st.request(t.z, t.x, t.y, { priority: true }); }); }
    function draw() {
      pending = null;
      var now = roadsNow(st, list);
      paint(now.roads);
      if (now.complete || !el.isConnected && Date.now() - t0 > 1000 || Date.now() - t0 > 120000) {
        if (unsub) { unsub(); unsub = null; }
      }
      return now.complete;
    }
    ask();
    if (draw()) return;
    unsub = st.subscribe(function () { if (!pending) pending = setTimeout(draw, 80); });
    // A tile that failed is asked for again, rather than leaving a hole for good.
    (function retry(n) {
      setTimeout(function () { if (unsub && n < 6) { ask(); retry(n + 1); } }, 4000 * (n + 1));
    })(0);
  }
  // For the exported image: whatever is in memory now, topped up for at most
  // `ms`, then drawn with stand-ins for anything still missing.
  function roadsAround(lat, lon, spanM, ms) {
    var T = TL(), st = tileStore();
    if (!T || !st || lat == null || lon == null) return Promise.resolve([]);
    var list = cardTiles(lat, lon, spanM);
    list.forEach(function (t) { st.request(t.z, t.x, t.y, { priority: true }); });
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() {
        var now = roadsNow(st, list);
        if (now.complete || Date.now() - t0 >= (ms || 3000)) { resolve(now.roads); return; }
        setTimeout(poll, 120);
      })();
    });
  }
  // A local flat projection about (lat, lon), north up, EAST RIGHT: the ground.
  function groundProj(lat, lon, spanM, size, cx, cy) {
    var k = size / spanM, cl = Math.cos(lat * D2R);
    cx = cx == null ? size / 2 : cx; cy = cy == null ? size / 2 : cy;
    return function (la, lo) {
      var d = lo - lon; d -= 360 * Math.round(d / 360);
      return [cx + d * M_PER_DEG * cl * k, cy - (la - lat) * M_PER_DEG * k];
    };
  }
  var ROAD_W = { major: 1.8, minor: 1.05, service: 0.7, path: 0.9 };
  function roadsSVG(roads, P, colour, alpha, scale) {
    scale = scale || 1;
    return ['service', 'path', 'minor', 'major'].map(function (cls) {
      var d = [];
      roads.forEach(function (r) {
        if (r.cls !== cls) return;
        d.push('M' + r.pts.map(function (q) { var p = P(q[0], q[1]); return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join('L'));
      });
      if (!d.length) return '';
      return '<path class="st" d="' + d.join(' ') + '" fill="none" stroke="' + colour + '" stroke-opacity="' + alpha +
        '" stroke-width="' + (ROAD_W[cls] * scale) + '" stroke-linecap="round" stroke-linejoin="round"' +
        (cls === 'path' ? ' stroke-dasharray="' + (2.5 * scale) + ' ' + (3 * scale) + '"' : '') + '/>';
    }).join('');
  }
  function roadsCanvas(g, roads, P, colour, alpha, scale) {
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = colour; g.globalAlpha = alpha;
    ['service', 'path', 'minor', 'major'].forEach(function (cls) {
      g.lineWidth = ROAD_W[cls] * scale;
      g.setLineDash(cls === 'path' ? [2.5 * scale, 3 * scale] : []);
      g.beginPath();
      roads.forEach(function (r) {
        if (r.cls !== cls) return;
        r.pts.forEach(function (q, i) { var p = P(q[0], q[1]); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
      });
      g.stroke();
    });
    g.setLineDash([]); g.restore();
  }
  // A two-unit scale bar, as on the map: metres and the arcseconds they are.
  function niceBar(mPerPx, targetPx) {
    var raw = mPerPx * targetPx, e = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / e;
    var m = (f >= 5 ? 5 : f >= 2 ? 2 : 1) * e, arc = m / M_PER_ARCSEC;
    return { px: m / mPerPx, label: (m >= 1000 ? (m / 1000) + ' km' : m + ' m') + ' \u00B7 ' +
             (arc < 10 ? arc.toFixed(1) : Math.round(arc)) + '\u2033' };
  }

  // THE SKY IMAGE IS MIRRORED. hips2fits returns the sky the standard way,
  // as seen from below: north up, east LEFT. The card's window is the ground,
  // east RIGHT, like the map -- so the image is flipped east-west, exactly as
  // the app's Sky view lays the sky under the streets, and every star in it
  // sits over its own starpin.
  function dssUrl(ra, dec, fovArcsec, px) {
    return 'https://alasky.cds.unistra.fr/hips-image-services/hips2fits' +
      '?hips=' + encodeURIComponent('CDS/P/DSS2/color') +
      '&width=' + px + '&height=' + px + '&fov=' + (fovArcsec / 3600) +
      '&projection=TAN&coordsys=icrs&format=jpg' +
      '&ra=' + Number(ra).toFixed(6) + '&dec=' + Number(dec).toFixed(6);
  }

  // The starpin card's window: the star's own patch of sky, laid on the ground
  // beneath it, with the streets over it, the 3" circle, and the reticle.
  function groundWindow(doc, d) {
    var box = doc.createElement('div');
    box.className = 'spc-ground';
    var fov = d.fovArcsec || STAR_FOV_ARCSEC, spanM = fov * M_PER_ARCSEC, SZ = 200;
    if (d.ra != null && d.dec != null) {
      var img = doc.createElement('img');
      img.alt = 'DSS image of the sky around this star, mirrored to lie on the ground beneath it';
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      img.src = dssUrl(d.ra, d.dec, fov, 400);
      box.appendChild(img);
    }
    var rPx = R_ARCSEC / fov * SZ, gap = Math.max(4, rPx * 0.3), arm = Math.max(6, rPx * 0.45);
    var bar = niceBar(spanM / SZ, 48);
    var svg = ['<svg viewBox="0 0 ' + SZ + ' ' + SZ + '" class="spc-overlay" aria-hidden="true">',
      '<g class="st-g"></g>',
      '<circle cx="100" cy="100" r="' + rPx.toFixed(1) + '" fill="none" stroke="rgba(7,10,20,.6)" stroke-width="3.5"/>',
      '<circle cx="100" cy="100" r="' + rPx.toFixed(1) + '" fill="none" stroke="#F2DE5C" stroke-width="1.8"/>',
      '<path d="M' + (100 - gap - arm) + ',100H' + (100 - gap) + 'M' + (100 + gap) + ',100H' + (100 + gap + arm) +
        'M100,' + (100 - gap - arm) + 'V' + (100 - gap) + 'M100,' + (100 + gap) + 'V' + (100 + gap + arm) +
        '" stroke="#F2DE5C" stroke-width="1.6" stroke-linecap="round"/>',
      '<g class="bar"><path d="M10,' + (SZ - 14) + 'v4h' + bar.px.toFixed(1) + 'v-4" fill="none" stroke="#fff" stroke-width="1.4"/>',
      '<text x="10" y="' + (SZ - 18) + '" fill="#fff" font-size="9" font-family="system-ui,sans-serif">' + bar.label + '</text></g>'];
    if (d.bearingDeg != null) {
      var t = (d.bearingDeg - 90) * D2R;
      svg.push('<line x1="' + (100 + Math.cos(t) * 88).toFixed(1) + '" y1="' + (100 + Math.sin(t) * 88).toFixed(1) +
               '" x2="' + (100 + Math.cos(t) * 99).toFixed(1) + '" y2="' + (100 + Math.sin(t) * 99).toFixed(1) +
               '" stroke="#DCC949" stroke-width="3" stroke-linecap="round"/>');
    }
    svg.push('</svg>');
    var wrap = doc.createElement('div');
    wrap.innerHTML = svg.join('');
    box.appendChild(wrap.firstChild);
    var cap = doc.createElement('div');
    cap.className = 'spc-ground-cap';
    cap.textContent = 'its own sky, laid on the ground below';
    var outer = doc.createElement('div');
    outer.style.cssText = 'display:flex;flex-direction:column;align-items:center';
    outer.appendChild(box); outer.appendChild(cap);
    if (d.lat != null) {
      var P = groundProj(d.lat, d.lon, spanM, SZ);
      liveRoads(box, d.lat, d.lon, spanM * 1.1, function (roads) {
        var g = box.querySelector('.st-g');
        if (g) g.innerHTML = roadsSVG(roads, P, '#CDD6E4', 0.8, 1);
      });
    }
    return outer;
  }

  // The star's own "sunrise", made so it cannot be mistaken for a cornerstone's:
  // light radiating OUT from the star's window, not a dawn rising up the card.
  // How far and how bright it spreads follows the star's rarity.
  //
  // PROVISIONAL: rarity here is a straight ramp in Gaia G (G <= 6.5 full,
  // G >= 18 none) until it is calibrated from Gaia's counts of stars brighter
  // than each magnitude -- the population measure the cornerstones already use.
  function starGlowValue(mag) {
    if (mag == null || !isFinite(mag)) return 0;
    return clamp01((18 - mag) / 11.5);
  }
  var CARD_BASE = 'linear-gradient(168deg,#141A2E 0%,#0C1120 60%,#0A0E1C 100%)';
  function starGlowCss(v) {
    if (!(v > 0)) return null;
    var a = (0.18 + 0.5 * v).toFixed(3), a2 = (0.06 + 0.22 * v).toFixed(3);
    var r1 = Math.round(22 + 40 * v), r2 = Math.round(48 + 70 * v);
    return 'radial-gradient(circle at 50% 33%, rgba(255,238,200,' + a + ') 0%, rgba(242,190,120,' + a2 + ') ' +
           r1 + '%, rgba(20,26,46,0) ' + r2 + '%), ' + CARD_BASE;
  }

  function row(k, v, cls) {
    return '<div class="row"><span class="k">' + k + '</span><span class="v' +
           (cls ? ' ' + cls : '') + '">' + v + '</span></div>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ── the sunrise ────────────────────────────────────────────────────────────
  //
  // A cornerstone card's background rises like a sunrise as the find gets rarer:
  // common cards stay in the dark navy the card has always used; the rarest
  // bloom all the way up through blue into a gold dawn. The amount of sunrise is
  // driven by POPULATION rarity (rarityOrder), the same measure the tier, the
  // sort and the celebration now use — not by (c+i)/2. Stars are left alone;
  // their rarity is not yet calibrated.
  //
  // Legibility is handled by a soft text-shadow on the card's text (see the
  // spc-sunlit CSS and the canvas shadow in toBlob), NOT by darkening the
  // picture. An earlier version laid a dark scrim over the lower card to hold
  // contrast; it muddied the gold into brown and killed exactly the clean
  // sunrise this is meant to be, so the gradient is now sampled straight.
  var SUN = [
    [0, [0, 24, 39]], [0.15, [0, 46, 72]], [0.30, [0, 77, 115]],
    [0.45, [50, 112, 155]], [0.60, [86, 140, 178]], [0.72, [109, 159, 196]],
    [0.82, [134, 174, 200]], [0.90, [179, 195, 191]], [0.96, [201, 196, 147]],
    [1, [204, 186, 102]]
  ];
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function sampleSun(t) {
    t = clamp01(t);
    for (var i = 0; i < SUN.length - 1; i++) {
      var a = SUN[i], b = SUN[i + 1];
      if (t >= a[0] && t <= b[0]) {
        var f = (b[0] - a[0]) ? (t - a[0]) / (b[0] - a[0]) : 0;
        return [0, 1, 2].map(function (j) { return Math.round(a[1][j] + (b[1][j] - a[1][j]) * f); });
      }
    }
    return SUN[SUN.length - 1][1];
  }
  // Rarity -> how much of the sunrise is revealed (0 = flat navy, 1 = full dawn).
  // rarityOrder runs ~6 (rarest collectible: 6x6, 4x7) to 12 (floor). Exceptional
  // finds (<=6) reveal the whole dawn; commoner finds stay nearer the dark end.
  // This is the design-sketch mechanism verbatim: linear map, then smoothstep,
  // and the gradient is sampled cleanly with no scrim or gamma muddying it.
  var RARE_CEIL = 6, RARE_FLOOR = 12;
  function sunriseValue(c) {
    if (!c) return 0;
    if (c.degree === 3) return 1;
    var rr;
    if (F && c.crossOrder != null && c.intrinsicOrder != null) {
      rr = F.rarityOrder(c.crossOrder, c.intrinsicOrder);
    } else if (c.tierOrder != null) { rr = c.tierOrder; }
    else if (c.order != null) { rr = c.order; }
    else return 0;
    var lin = clamp01((RARE_FLOOR - rr) / (RARE_FLOOR - RARE_CEIL));
    return lin * lin * (3 - 2 * lin);              // smoothstep, as in the sketch
  }
  // Build the sunrise gradient, exactly as the design sketch does: at each
  // vertical point y, sample the ramp at source position y*depth. depth = value.
  // No scrim, no gamma — those muddied the gold. The picture is never darkened.
  function sunriseCss(value) {
    var depth = value, N = 24, stops = [];
    for (var i = 0; i <= N; i++) {
      var y = i / N, rgb = sampleSun(y * depth);
      stops.push('rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ') ' + (y * 100).toFixed(1) + '%');
    }
    return { bg: 'linear-gradient(to bottom,' + stops.join(',') + ')' };
  }
  // Zone-aware legibility. Rather than smudge the text with a shadow, we sample
  // the background luminance BEHIND each lower text zone and, only when it turns
  // pale gold, flip that zone to dark navy ink — the naturally legible pairing on
  // gold. The sunrise is left completely untouched; the text adapts to it. Each
  // zone decides independently, because on a very-rare card the footer can be on
  // gold while the stub above it is still on blue.
  function relLum(rgb) {
    function s(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    return 0.2126 * s(rgb[0]) + 0.7152 * s(rgb[1]) + 0.0722 * s(rgb[2]);
  }
  var STUB_Y = 0.885, FOOTER_Y = 0.965, FLIP_LUM = 0.43;
  function zoneFlips(value) {
    return {
      stub:   relLum(sampleSun(STUB_Y * value)) > FLIP_LUM,
      footer: relLum(sampleSun(FOOTER_Y * value)) > FLIP_LUM
    };
  }

  // opts: { kind, mini, star:{id,name,ra,dec,mag,bpRp,distLy}, cornerstone:{...},
  //         visit:{distanceM,bearingDeg,accuracyM,verdict,whenMs}, findNumber }
  function html(opts) {
    var v = opts.visit || {}, mini = opts.mini ? ' mini' : '';
    var body, bg = '';

    if (opts.kind === 'cornerstone') {
      var c = opts.cornerstone || {};
      // Population rarity, consistent with the tier / sort / celebration.
      var rr = (F && c.crossOrder != null && c.intrinsicOrder != null)
        ? F.rarityOrder(c.crossOrder, c.intrinsicOrder)
        : (c.tierOrder != null ? c.tierOrder : c.order);
      var tier = F ? F.tierOf(c.tierOrder != null ? c.tierOrder : c.order, c.degree,
                              c.crossOrder, c.intrinsicOrder) : null;
      var sunVal = sunriseValue(c);
      var sun = sunriseCss(sunVal);
      opts._sunbg = sun.bg;                       // picked up by render()
      opts._sunFlips = zoneFlips(sunVal);
      bg = c.lat != null ? '<div class="bg">' +
           gridSVG(c.lat, c.lon, Math.round(c.order || 12)) + '</div>' : '';
      body =
        '<div class="spc-brand">starpin<i>!</i></div>' +
        '<div class="spc-kicker" style="margin-top:5px">Cornerstone</div>' +
        '<div class="spc-rule"></div>' +
        '<div class="spc-title"><div class="cat">HEALPix vertex</div>' +
        '<div class="id">' + esc(c.name) + '</div></div>' +
        (c.lat != null ? '<div class="spc-coords"><b>LAT</b> ' + c.lat.toFixed(6) +
          ' &nbsp; <b>LON</b> ' + c.lon.toFixed(6) + '</div>' +
          '<div class="spc-place" data-place></div>' : '') +
        '<div class="spc-ledger">' +
          row('Lines', 'order ' + c.crossOrder + ' \u00D7 order ' + c.intrinsicOrder) +
          row('Tier', (rr != null ? rr.toFixed(1) : '\u2014') +
              (tier ? ' \u00B7 ' + tier.key : '')) +
          // The rarity of THIS CROSSING, not of its finer order. Quoting the
          // plain order figure understated a mixed crossing by up to 64x.
          (F ? row('Frequency', F.crossCount(c.crossOrder, c.intrinsicOrder, 50)
                 .toLocaleString() + ' within 50 km') : '') +
          (F ? row('Spacing', (function (m) {
                 return m < 1000 ? '~' + Math.round(m) + ' m apart on average'
                                 : '~' + (m / 1000).toFixed(1) + ' km apart on average';
               })(F.crossSpacingM(c.crossOrder, c.intrinsicOrder))) : '') +
          (F ? row('Share', '1 in ' +
                 Math.round(1 / F.crossShare(c.crossOrder, c.intrinsicOrder)) +
                 ' of order ' + Math.round(c.intrinsicOrder) + ' vertices') : '') +
          (v.distanceM != null ? row('Approach',
            v.distanceM.toFixed(1) + ' m ' + (v.bearingDeg != null ? compass(v.bearingDeg) : ''),
            'mono') : '') +
        '</div>' +
        '<div class="spc-stub"><div class="spc-perf"></div>' +
          row('Visited', v.whenMs ? fmtDate(v.whenMs) : '\u2014') +
          row('Accuracy', v.accuracyM != null ? '\u00B1' + Math.round(v.accuracyM) + ' m' : '\u2014') +
          row('Geometry', esc(v.verdict || '\u2014')) +
        '</div>';

    } else {
      var d = opts.star || {};
      var tierS = F ? F.starTier(d.mag) : null;
      opts._sunbg = starGlowCss(starGlowValue(d.mag));   // stripped for print, like the sunrise
      opts._sunFlips = null;
      body =
        '<div class="spc-brand">starpin<i>!</i></div>' +
        '<div class="spc-kicker" style="margin-top:5px">Starpin Record</div>' +
        '<div class="spc-rule"></div>' +
        '<div class="spc-title"><div class="cat">' + esc(d.catalogue || 'Gaia DR3') + '</div>' +
        '<div class="id">' + esc((d.name || d.id || '').replace(/^Gaia DR3\s*/, '')) + '</div></div>' +
        '<div class="spc-med" data-sky="1"></div>' +
        (d.ra != null ? '<div class="spc-coords"><b>RA</b> ' + raToHMS(d.ra) +
          ' &nbsp; <b>DEC</b> ' + decToDMS(d.dec) + '</div>' : '') +
        (d.lat != null ? '<div class="spc-place" data-place></div>' : '') +
        '<div class="spc-ledger">' +
          (opts.findNumber ? row('Found', '#' + opts.findNumber + ' in your log') : '') +
          (d.lat != null ? row('Starpin', d.lat.toFixed(6) + ', ' + d.lon.toFixed(6), 'mono') : '') +
          (d.address ? row('Address', esc(d.address), 'mono') : '') +
          (v.distanceM != null ? row('Approach', v.distanceM < 1000
            ? v.distanceM.toFixed(0) + ' m ' + (v.bearingDeg != null ? compass(v.bearingDeg) : '')
            : (v.distanceM / 1000).toFixed(2) + ' km ' +
              (v.bearingDeg != null ? compass(v.bearingDeg) : ''), 'mono') : '') +
          row('Brightness', d.mag == null ? 'unknown'
              : 'G \u2248 ' + d.mag.toFixed(2)) +
          (tierS ? row('Findability', esc(tierS.key)) : '') +
          row('Distance', d.distLy == null ? 'unknown parallax'
              : Number(d.distLy).toLocaleString() + ' ly') +
        '</div>' +
        // No score. Separate facts, separately stated — a scalar would rank a
        // white dwarf above a supergiant by fiat, and invite optimising for it.
        '<div class="spc-stub"><div class="spc-perf"></div>' +
          row('Visited', v.whenMs ? fmtDate(v.whenMs) : '\u2014') +
          // Two events, two dates. The culmination is derived from the record
          // SET for this starpin, not from the record the card was opened
          // from, so a visit card and a culmination card agree about the star.
          (opts.culminationMs
            ? row('At culmination', fmtDate(opts.culminationMs), 'culm') : '') +
          row('Accuracy', v.accuracyM != null ? '\u00B1' + Math.round(v.accuracyM) + ' m' : '\u2014') +
          row('Geometry', esc(v.verdict || '\u2014'),
              v.verdict === 'well-supported' ? 'yes' : '') +
        '</div>';
    }

    body += '<div class="spc-flip">tap the card for the printable version</div>' +
            '<div class="spc-osm">streets and place names \u00A9 OpenStreetMap contributors</div>';
    // The sunrise is a per-card background (rarer = more dawn). Only cornerstones,
    // only the dark (screen) face — the printable light variant keeps paper.
    // Legibility over the bright lower band is handled by a text-shadow applied
    // via the spc-sunlit class, NOT by darkening the gradient.
    var sunStyle = (opts._sunbg && !opts.light)
      ? ' style="background-image:' + opts._sunbg + '"' : '';
    var sunlit = (opts._sunbg && !opts.light) ? ' spc-sunlit' : '';
    // Zone-aware dark-ink flips for the bright lower bands (rarest cards only).
    if (opts._sunFlips && !opts.light) {
      sunlit += ' zone-flip';
      if (opts._sunFlips.stub) sunlit += ' dark-stub';
      if (opts._sunFlips.footer) sunlit += ' dark-footer';
    }
    return '<div class="spc-card' + mini + (opts.light ? ' light' : '') +
           (opts.culminationMs ? ' culm' : '') + sunlit + '"' + sunStyle + '>' +
           bg + '<div class="inner">' + body + '</div></div>';
  }

  // The grid background is drawn with explicit stroke colours, so the light
  // variant has to restate them rather than inherit.
  function recolourGrid(card) {
    var light = card.classList.contains('light');
    [].forEach.call(card.querySelectorAll('.bg svg path.st'), function (p) {
      p.setAttribute('stroke', light ? '#2C3442' : '#CDD6E4');
      p.setAttribute('stroke-opacity', light ? 0.34 : 0.28);
    });
    [].forEach.call(card.querySelectorAll('.bg svg path.grid'), function (p, i) {
      p.setAttribute('stroke', light ? '#4F6620' : '#7D9D33');
      p.setAttribute('stroke-opacity', (light ? [0.28, 0.75] : [0.2, 0.55])[i] || 0.4);
    });
    [].forEach.call(card.querySelectorAll('.bg svg circle'), function (c) {
      var f = c.getAttribute('fill');
      c.setAttribute(f && f !== 'none' ? 'fill' : 'stroke', light ? '#3F6318' : '#8FBF3F');
    });
  }

  function render(opts, doc) {
    doc = doc || document;
    injectCss(doc);
    var wrap = doc.createElement('div');
    wrap.innerHTML = html(opts);
    var card = wrap.firstChild;
    card.addEventListener('click', function (e) {
      if (e.target.closest('a,button')) return;
      var toLight = !card.classList.contains('light');
      card.classList.toggle('light');
      if (toLight) {
        // Printable version: black-on-white. The sunrise is an inline background
        // and inline styles beat the .light class, so it must be stripped here or
        // the dark print text lands on the gradient. Stash it to restore on flip
        // back. The sunlit / zone-flip classes come off too.
        card._sun = card.style.backgroundImage;
        card.style.backgroundImage = '';
        card._sunClasses = [];
        ['spc-sunlit', 'zone-flip', 'dark-stub', 'dark-footer'].forEach(function (k) {
          if (card.classList.contains(k)) { card._sunClasses.push(k); card.classList.remove(k); }
        });
      } else if (card._sun != null) {
        card.style.backgroundImage = card._sun;
        (card._sunClasses || []).forEach(function (k) { card.classList.add(k); });
      }
      var g = card.querySelector('.bg svg');
      if (g) g.setAttribute('data-light', card.classList.contains('light') ? '1' : '0');
      recolourGrid(card);
    });
    var slot = card.querySelector('.spc-med[data-sky]');
    if (slot) slot.appendChild(groundWindow(doc, {
      ra: (opts.star || {}).ra, dec: (opts.star || {}).dec,
      lat: (opts.star || {}).lat, lon: (opts.star || {}).lon,
      bearingDeg: (opts.visit || {}).bearingDeg,
      fovArcsec: (opts.star || {}).fovArcsec
    }));
    // Where it is, in words: from the device cache at once, or one polite lookup.
    var slotP = card.querySelector('[data-place]');
    var pl = opts.kind === 'cornerstone' ? (opts.cornerstone || {}) : (opts.star || {});
    var PL = placeModule();
    if (slotP && PL && pl.lat != null) {
      var now = PL.cached(pl.lat, pl.lon);
      if (now) slotP.textContent = now;
      else PL.lookup(pl.lat, pl.lon).then(function (t) { if (t) slotP.textContent = t; });
    }
    // The cornerstone's lattice now sits over real streets.
    var cs = opts.cornerstone || {};
    var stg = opts.kind === 'cornerstone' && card.querySelector('.bg svg .st-g');
    if (stg && cs.lat != null) {
      var sp = cornerSpanM(cs.order);
      var Pc = groundProj(cs.lat, cs.lon, sp, 340, 170, 150);
      liveRoads(card, cs.lat, cs.lon, sp * 1.3, function (roads) {
        var light = card.classList.contains('light');
        stg.innerHTML = roadsSVG(roads, Pc, light ? '#2C3442' : '#CDD6E4', light ? 0.34 : 0.28, 1);
      });
    }
    return card;
  }

  // Full screen, for the moment of bagging.
  function show(opts, doc) {
    doc = doc || document;
    injectCss(doc);
    var stage = doc.createElement('div');
    stage.className = 'spc-stage';
    stage.setAttribute('role', 'dialog');
    stage.setAttribute('aria-label', 'claim card');
    var wrap = doc.createElement('div'); wrap.className = 'wrap';
    wrap.appendChild(render(opts, doc));
    var close = doc.createElement('button');
    close.type = 'button'; close.className = 'spc-close'; close.textContent = 'Close';
    wrap.appendChild(close);
    stage.appendChild(wrap);
    doc.body.appendChild(stage);
    doc.defaultView.requestAnimationFrame(function () { stage.classList.add('on'); });

    function dismiss() {
      stage.classList.remove('on');
      doc.defaultView.setTimeout(function () {
        if (stage.parentNode) stage.parentNode.removeChild(stage);
      }, 400);
    }
    close.addEventListener('click', dismiss);
    stage.addEventListener('click', function (e) { if (e.target === stage) dismiss(); });
    return { dismiss: dismiss, el: stage };
  }

  // ── sharing ───────────────────────────────────────────────────────────────
  //
  // Drawn natively onto a canvas rather than screenshotting the DOM. The sky
  // cutout is cross-origin, and any DOM-to-canvas route taints the canvas and
  // makes toBlob() throw — so the card is redrawn here with the same data,
  // requesting the image with crossOrigin so it can be composited legally.
  // If CDS declines CORS the image is simply omitted and everything else still
  // exports; a card with a blank window beats no card at all.
  // The streets are fetched first (from the device cache, usually), then the
  // card is drawn in one pass so they sit UNDER the lattice and the window.
  function toBlob(opts, doc) {
    doc = doc || document;
    var isStar = opts.kind !== 'cornerstone', d = opts.star || {}, c = opts.cornerstone || {};
    var lat = isStar ? d.lat : c.lat, lon = isStar ? d.lon : c.lon;
    var span = isStar ? (d.fovArcsec || STAR_FOV_ARCSEC) * M_PER_ARCSEC * 1.1
                      : Math.sqrt(510.1e12 / (12 * Math.pow(4, Math.round(c.order || 12)))) * 2.9 * 1.3;
    var PL = placeModule();
    var place = (PL && lat != null) ? (PL.cached(lat, lon) ? Promise.resolve(PL.cached(lat, lon))
      : Promise.race([PL.lookup(lat, lon), new Promise(function (r) { setTimeout(function () { r(null); }, 3000); })]))
      : Promise.resolve(null);
    return Promise.all([roadsAround(lat, lon, span, 3000), place]).then(function (got) {
      return drawCard(opts, doc, got[0] || [], got[1]);
    });
  }
  function drawCard(opts, doc, roads, placeText) {
    // Star cards are taller now: the window is bigger and has a caption.
    // Room for the window, its caption, the place line and the map credit.
    var W = 680, H = opts.kind !== 'cornerstone' ? 1090 : 1040, pad = 46;
    var cv = doc.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    var isStar = opts.kind !== 'cornerstone';
    var d = opts.star || {}, c = opts.cornerstone || {}, v = opts.visit || {};

    var light = !!opts.light;
    if (light) { g.fillStyle = '#FCFDF4'; g.fillRect(0, 0, W, H); }
    else if (!isStar) {
      // Clean sunrise, matching the on-screen card: source position = y*depth,
      // sampled straight from the ramp. No scrim — legibility comes from the
      // text shadow set below.
      var val = sunriseValue(c), depth = val;
      var vgrad = g.createLinearGradient(0, 0, 0, H);
      for (var s = 0; s <= 24; s++) {
        var yy = s / 24, rgb = sampleSun(yy * depth);
        vgrad.addColorStop(yy, 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')');
      }
      g.fillStyle = vgrad; g.fillRect(0, 0, W, H);
    }
    else {
      var grad = g.createLinearGradient(0, 0, W * 0.4, H);
      grad.addColorStop(0, '#141A2E'); grad.addColorStop(0.6, '#0C1120');
      grad.addColorStop(1, '#0A0E1C');
      g.fillStyle = grad; g.fillRect(0, 0, W, H);
      // The star's glow, as on screen: radiating from the window, by rarity.
      var gv = starGlowValue(d.mag);
      if (gv > 0) {
        var rg0 = g.createRadialGradient(W / 2, 340, 0, W / 2, 340, (0.48 + 0.7 * gv) * W);
        rg0.addColorStop(0, 'rgba(255,238,200,' + (0.18 + 0.5 * gv) + ')');
        rg0.addColorStop((22 + 40 * gv) / (48 + 70 * gv), 'rgba(242,190,120,' + (0.06 + 0.22 * gv) + ')');
        rg0.addColorStop(1, 'rgba(20,26,46,0)');
        g.fillStyle = rg0; g.fillRect(0, 0, W, H);
      }
    }
    var INK   = light ? '#22270F' : '#E9E4D6';
    var MUTED = light ? '#5C6349' : '#8891A8';
    var BRASS = light ? '#7A6710' : '#DCC949';
    var GOOD  = light ? '#3F6318' : '#8FBF3F';
    var MOSS  = light ? '#4F6620' : '#7D9D33';

    // The cornerstone card's whole point is the lattice it sits on; exporting
    // it without the grid threw away the only thing that made it a picture.
    var Hh = HP();
    if (!isStar && c.lat != null && Hh) {
      var ord0 = Math.round(c.order || 12);
      var spanM = Math.sqrt(510.1e12 / (12 * Math.pow(4, ord0))) * 2.9;
      var mPerDeg = 111319.9, cosLat = Math.cos(c.lat * D2R), ppm = W / spanM;
      var projX = function (lo) { return W / 2 + (lo - c.lon) * mPerDeg * cosLat * ppm; };
      var projY = function (la) { return H * 0.33 - (la - c.lat) * mPerDeg * ppm; };
      roadsCanvas(g, roads, function (la, lo) {
        var dl = lo - c.lon; dl -= 360 * Math.round(dl / 360);
        return [projX(c.lon + dl), projY(la)];
      }, light ? '#2C3442' : '#CDD6E4', light ? 0.34 : 0.28, 2);
      [[ord0 + 1, 1.2, light ? 0.22 : 0.16], [ord0, 2.6, light ? 0.55 : 0.4]]
      .forEach(function (spec) {
        var k = spec[0], seen = {}, cells = [];
        var stepDeg = (spanM / 6) / mPerDeg;
        for (var a = -3; a <= 3; a++) for (var b = -3; b <= 3; b++) {
          try {
            var ip = Hh.nestIndex(c.lat + a * stepDeg, c.lon + b * stepDeg / cosLat, k).toString();
            if (!seen[ip]) { seen[ip] = 1; cells.push(ip); }
          } catch (e) {}
        }
        g.strokeStyle = MOSS; g.lineWidth = spec[1]; g.globalAlpha = spec[2];
        g.beginPath();
        var nside = Math.pow(2, k);
        cells.forEach(function (cc) {
          var ipx = BigInt(cc);
          var pts = [[0,0],[1,0],[1,1],[0,1]].map(function (uv) {
            var vv = Hh._core.pixcoord2vec_nest(nside, ipx, uv[0], uv[1]);
            var x = vv.x != null ? vv.x : vv[0], y = vv.y != null ? vv.y : vv[1],
                z = vv.z != null ? vv.z : vv[2];
            return [projX(Math.atan2(y, x) / D2R),
                    projY(Math.asin(z / Math.hypot(x, y, z)) / D2R)];
          });
          g.moveTo(pts[0][0], pts[0][1]);
          for (var q = 1; q < 4; q++) g.lineTo(pts[q][0], pts[q][1]);
          g.closePath();
        });
        g.stroke(); g.globalAlpha = 1;
      });
      var vx = projX(c.lon), vy = projY(c.lat);
      g.strokeStyle = GOOD; g.lineWidth = 4;
      g.beginPath(); g.arc(vx, vy, 15, 0, 6.2832); g.stroke();
      g.fillStyle = GOOD;
      g.beginPath(); g.arc(vx, vy, 5.5, 0, 6.2832); g.fill();
    }

    // Cards are drawn natively, not screenshotted -- the sky cutout is
    // cross-origin and would taint the canvas -- so the gold border has to be
    // drawn here as well, or the downloadable PNG quietly loses the rarest
    // thing on the card.
    if (opts.culminationMs) {
      g.strokeStyle = BRASS; g.lineWidth = 6;
      g.strokeRect(3, 3, W - 6, H - 6);
      g.strokeStyle = light ? 'rgba(138,117,19,.35)' : 'rgba(220,201,73,.35)';
      g.lineWidth = 1.5;
      g.strokeRect(13, 13, W - 26, H - 26);
    } else {
      g.strokeStyle = light ? 'rgba(138,117,19,.45)' : 'rgba(220,201,73,.30)';
      g.lineWidth = 2;
      g.strokeRect(1, 1, W - 2, H - 2);
    }

    function text(t, x, y, font, colour, align) {
      g.font = font; g.fillStyle = colour; g.textAlign = align || 'left';
      g.fillText(String(t), x, y);
    }
    var MONO = '"SF Mono",ui-monospace,Menlo,monospace';
    var SANS = 'system-ui,-apple-system,"Segoe UI",sans-serif';

    // the wordmark leads, as it does on screen
    g.font = '600 32px "Source Code Pro",' + MONO; g.textAlign = 'center';
    var ww = g.measureText('starpin').width, bw = g.measureText('!').width;
    g.fillStyle = BRASS; g.fillText('starpin', W / 2 - bw / 2, 58);
    g.fillStyle = MOSS;  g.fillText('!', W / 2 + ww / 2, 58);
    text(isStar ? 'STARPIN RECORD' : 'CORNERSTONE',
         W / 2, 84, '600 16px ' + MONO, BRASS, 'center');

    var rg = g.createLinearGradient(pad, 0, W - pad, 0);
    rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(0.5, BRASS);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(pad, 100, W - pad * 2, 2);

    text(isStar ? (d.catalogue || 'Gaia DR3') : 'HEALPIX VERTEX',
         W / 2, 138, '17px ' + MONO, MUTED, 'center');
    var title = isStar ? String(d.id || d.name || '') : String(c.name || '');
    var size = title.length > 20 ? 30 : 36;
    text(title, W / 2, 180, '600 ' + size + 'px Georgia,serif', INK, 'center');
    if (placeText) {
      var pf = placeText.length > 44 ? 15 : 17;
      text(placeText, W / 2, 208, pf + 'px ' + SANS, INK, 'center');
    }

    var rows = [];
    if (isStar) {
      if (opts.findNumber) rows.push(['FOUND', '#' + opts.findNumber + ' in your log']);
      if (d.lat != null) rows.push(['STARPIN', d.lat.toFixed(6) + ', ' + d.lon.toFixed(6)]);
      if (d.address) rows.push(['ADDRESS', d.address]);
      if (v.distanceM != null) rows.push(['APPROACH', (v.distanceM < 1000
        ? v.distanceM.toFixed(0) + ' m' : (v.distanceM / 1000).toFixed(2) + ' km') +
        (v.bearingDeg != null ? ' ' + compass(v.bearingDeg) : '')]);
      rows.push(['BRIGHTNESS', d.mag == null ? 'unknown' : 'G \u2248 ' + d.mag.toFixed(2)]);
      rows.push(['DISTANCE', d.distLy == null ? 'unknown parallax'
        : Number(d.distLy).toLocaleString() + ' ly']);
    } else {
      rows.push(['LINES', 'order ' + c.crossOrder + ' \u00D7 order ' + c.intrinsicOrder]);
      if (F && c.crossOrder != null && c.intrinsicOrder != null) {
        rows.push(['TIER', F.rarityOrder(c.crossOrder, c.intrinsicOrder).toFixed(1)]);
      } else if (c.tierOrder != null) { rows.push(['TIER', c.tierOrder.toFixed(1)]); }
      if (F) {
        rows.push(['FREQUENCY', F.crossCount(c.crossOrder, c.intrinsicOrder, 50)
          .toLocaleString() + ' within 50 km']);
        var sp = F.crossSpacingM(c.crossOrder, c.intrinsicOrder);
        rows.push(['SPACING', sp < 1000 ? '~' + Math.round(sp) + ' m apart'
                                        : '~' + (sp / 1000).toFixed(1) + ' km apart']);
        rows.push(['SHARE', '1 in ' +
          Math.round(1 / F.crossShare(c.crossOrder, c.intrinsicOrder)) +
          ' of order ' + Math.round(c.intrinsicOrder)]);
      }
      if (v.distanceM != null) rows.push(['APPROACH', v.distanceM.toFixed(1) + ' m' +
        (v.bearingDeg != null ? ' ' + compass(v.bearingDeg) : '')]);
    }
    rows.push(['VISITED', v.whenMs ? fmtDate(v.whenMs) : '\u2014']);
    if (opts.culminationMs) rows.push(['AT CULMINATION', fmtDate(opts.culminationMs)]);
    rows.push(['ACCURACY', v.accuracyM != null ? '\u00B1' + Math.round(v.accuracyM) + ' m' : '\u2014']);
    rows.push(['GEOMETRY', v.verdict || '\u2014']);

    // For the sunrise export, each row picks dark or light ink based on the
    // background luminance directly behind it — the canvas equivalent of the
    // zone-flip on screen, done per row so it is exact.
    var sunlitExport = !light && !isStar;
    var exportDepth = sunlitExport ? sunriseValue(c) : 0;
    function inkAt(yPx, isVerdict) {
      if (!sunlitExport) return isVerdict ? GOOD : INK;
      var bg = sampleSun((yPx / H) * exportDepth);
      var dark = relLum(bg) > FLIP_LUM;
      if (isVerdict) return dark ? '#354A12' : GOOD;
      return dark ? '#0A0E1C' : INK;
    }
    function labelAt(yPx) {
      if (!sunlitExport) return MUTED;
      var bg = sampleSun((yPx / H) * exportDepth);
      // Dark ink on gold; else the LIFTED light label (matches the on-screen
      // .spc-sunlit .k colour) so labels never sink into the blue.
      return relLum(bg) > FLIP_LUM ? 'rgba(10,14,28,0.68)' : '#D6DAE6';
    }
    function paintRows(top) {
      // Turn off the drop shadow where a row flips to dark ink (shadow is only
      // wanted under light text on the darker upper card).
      rows.forEach(function (r, i) {
        var y = top + i * 52;
        // Only star cards colour the verdict green; on cornerstones it reads as
        // ordinary text, same as every other value.
        var isVerdict = isStar && r[1] === 'well-supported';
        var dark = sunlitExport && relLum(sampleSun((y / H) * exportDepth)) > FLIP_LUM;
        if (dark) { g.shadowColor = 'rgba(0,0,0,0)'; g.shadowBlur = 0; }
        else if (sunlitExport) { g.shadowColor = 'rgba(4,8,20,0.6)'; g.shadowBlur = 3; g.shadowOffsetY = 1; }
        text(r[0], pad, y, '16px ' + MONO, labelAt(y));
        text(r[1], W - pad, y, '22px ' + SANS, inkAt(y, isVerdict), 'right');
        g.shadowColor = 'rgba(0,0,0,0)'; g.shadowBlur = 0;   // divider without shadow
        g.fillStyle = light ? 'rgba(34,39,15,.14)' : 'rgba(184,192,212,.12)';
        g.fillRect(pad, y + 16, W - pad * 2, 1);
      });
      text('streets and place names \u00A9 OpenStreetMap contributors', W / 2, H - 58,
           '12px ' + SANS, labelAt(H - 58), 'center');
      text('geosonify.org', W / 2, H - 34, '15px ' + MONO, labelAt(H - 34), 'center');
    }

    return new Promise(function (resolve) {
      function finish() {
        paintRows(isStar ? 520 : 470);
        cv.toBlob(function (b) { resolve(b); }, 'image/png');
      }
      if (!isStar || d.ra == null) { finish(); return; }
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.referrerPolicy = 'no-referrer';
      var done = false;
      function drawSky(ok) {
        if (done) return; done = true;
        // The window: the star's sky, mirrored onto the ground, streets over it.
        var R = 116, cx = W / 2, cy = 340, fov = d.fovArcsec || STAR_FOV_ARCSEC, spanM = fov * M_PER_ARCSEC;
        function box() {
          var r = 26, x0 = cx - R, y0 = cy - R, s2 = 2 * R;
          g.beginPath();
          g.moveTo(x0 + r, y0); g.lineTo(x0 + s2 - r, y0); g.quadraticCurveTo(x0 + s2, y0, x0 + s2, y0 + r);
          g.lineTo(x0 + s2, y0 + s2 - r); g.quadraticCurveTo(x0 + s2, y0 + s2, x0 + s2 - r, y0 + s2);
          g.lineTo(x0 + r, y0 + s2); g.quadraticCurveTo(x0, y0 + s2, x0, y0 + s2 - r);
          g.lineTo(x0, y0 + r); g.quadraticCurveTo(x0, y0, x0 + r, y0); g.closePath();
        }
        g.save(); box(); g.clip();
        g.fillStyle = '#070A14'; g.fillRect(cx - R, cy - R, 2 * R, 2 * R);
        if (ok) {                                        // east-west mirrored: the ground's way round
          g.save(); g.translate(cx + R, cy - R); g.scale(-1, 1);
          g.drawImage(img, 0, 0, 2 * R, 2 * R); g.restore();
        }
        if (d.lat != null) roadsCanvas(g, roads, groundProj(d.lat, d.lon, spanM, 2 * R, cx, cy), '#CDD6E4', 0.8, 2);
        var rPx = R_ARCSEC / fov * 2 * R;
        g.strokeStyle = 'rgba(7,10,20,.6)'; g.lineWidth = 7;
        g.beginPath(); g.arc(cx, cy, rPx, 0, 6.2832); g.stroke();
        g.strokeStyle = '#F2DE5C'; g.lineWidth = 3.6;
        g.beginPath(); g.arc(cx, cy, rPx, 0, 6.2832); g.stroke();
        var gap = Math.max(8, rPx * 0.3), arm = Math.max(12, rPx * 0.45);
        g.lineWidth = 3.2; g.lineCap = 'round'; g.beginPath();
        g.moveTo(cx, cy - gap - arm); g.lineTo(cx, cy - gap);
        g.moveTo(cx, cy + gap); g.lineTo(cx, cy + gap + arm);
        g.moveTo(cx - gap - arm, cy); g.lineTo(cx - gap, cy);
        g.moveTo(cx + gap, cy); g.lineTo(cx + gap + arm, cy);
        g.stroke();
        var bar = niceBar(spanM / (2 * R), 96), bx = cx - R + 18, by = cy + R - 22;
        g.strokeStyle = '#fff'; g.lineWidth = 2.4; g.lineCap = 'butt'; g.beginPath();
        g.moveTo(bx, by - 7); g.lineTo(bx, by); g.lineTo(bx + bar.px, by); g.lineTo(bx + bar.px, by - 7); g.stroke();
        g.font = '15px system-ui,-apple-system,sans-serif'; g.fillStyle = '#fff'; g.textAlign = 'left';
        g.fillText(bar.label, bx, by - 12);
        g.restore();
        g.strokeStyle = BRASS; g.globalAlpha = .75; g.lineWidth = 2;
        box(); g.stroke(); g.globalAlpha = 1;
        if (v.bearingDeg != null) {
          var t = (v.bearingDeg - 90) * D2R, rr = R * 1.18;
          g.strokeStyle = BRASS; g.lineWidth = 5; g.lineCap = 'round';
          g.beginPath();
          g.moveTo(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr);
          g.lineTo(cx + Math.cos(t) * (rr + 14), cy + Math.sin(t) * (rr + 14));
          g.stroke();
        }
        text('its own sky, laid on the ground below',
             cx, cy + R + 34, '15px ' + SANS, MUTED, 'center');
        finish();
      }
      img.onload = function () { drawSky(true); };
      img.onerror = function () { drawSky(false); };
      setTimeout(function () { drawSky(false); }, 6000);
      img.src = dssUrl(d.ra, d.dec, d.fovArcsec || STAR_FOV_ARCSEC, 480);
    });
  }

  // Share sheet where there is one, download where there is not.
  function share(opts, doc) {
    doc = doc || document;
    var name = (opts.kind === 'cornerstone'
      ? String((opts.cornerstone || {}).name || 'cornerstone')
      : 'starpin-' + String((opts.star || {}).id || '')).replace(/[^\w.-]+/g, '-');
    return toBlob(opts, doc).then(function (blob) {
      if (!blob) throw new Error('could not draw the card');
      var file = null;
      try { file = new File([blob], name + '.png', { type: 'image/png' }); } catch (e) {}
      var nav = doc.defaultView.navigator;
      if (file && nav.canShare && nav.canShare({ files: [file] })) {
        return nav.share({ files: [file], title: name });
      }
      var a = doc.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name + '.png';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    });
  }

  return { VERSION: '0.7', render: render, show: show, html: html,
           toBlob: toBlob, share: share,
           skyWindow: skyWindow, groundWindow: groundWindow, gridSVG: gridSVG,
           starGlowValue: starGlowValue, niceBar: niceBar };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpinCard;
