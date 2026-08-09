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
    '.spc-card{--ink:#0A0E1C;--paper:#E9E4D6;--brass:#C6A15B;--verdigris:#6E9C8F;',
    '  --silver:#B7C0CC;--violet:#C9C3EC;--pewter:#7C8494;--text:#E9E4D6;--muted:#8891A8;',
    '  --green:#4ade80;',
    '  position:relative;width:min(92vw,340px);padding:20px 22px 18px;border-radius:14px;',
    '  background:linear-gradient(168deg,#141A2E 0%,#0C1120 60%,#0A0E1C 100%);',
    '  color:var(--text);font-family:"IBM Plex Sans",system-ui,sans-serif;',
    '  box-shadow:0 24px 60px rgba(0,0,0,.55);display:flex;flex-direction:column;',
    '  border:1px solid rgba(198,161,91,.28);overflow:hidden}',
    '.spc-card .bg{position:absolute;inset:0;opacity:.5;pointer-events:none}',
    '.spc-card .inner{position:relative}',
    '.spc-kicker{font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.18em;',
    '  text-transform:uppercase;color:var(--brass);text-align:center}',
    '.spc-rule{height:1px;background:linear-gradient(90deg,transparent,var(--brass),transparent);',
    '  margin:8px 0 14px}',
    '.spc-title{text-align:center;margin-bottom:12px}',
    '.spc-title .cat{font-family:"IBM Plex Mono",monospace;font-size:10px;color:var(--muted);',
    '  letter-spacing:.1em;text-transform:uppercase}',
    '.spc-title .id{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:19px;',
    '  line-height:1.25;margin-top:3px;word-break:break-word}',
    '.spc-med{display:flex;justify-content:center;margin:2px 0 10px}',
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
    '.spc-card.mini .spc-title .id{font-size:14px}',
    '.spc-card.mini .spc-med{margin:0 0 6px}',
    // full-screen presentation
    '.spc-stage{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;',
    '  justify-content:center;padding:16px;background:rgba(5,7,14,.86);',
    '  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;',
    '  transition:opacity .35s}',
    '.spc-stage.on{opacity:1}',
    '.spc-stage .wrap{transform:scale(.94) translateY(10px);transition:transform .45s cubic-bezier(.2,.9,.25,1)}',
    '.spc-stage.on .wrap{transform:none}',
    '.spc-close{margin-top:14px;display:block;width:100%;font:inherit;font-size:13px;',
    '  padding:.6rem 1rem;border-radius:10px;border:1px solid rgba(198,161,91,.5);',
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
  var COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  function compass(b) { return COMPASS[Math.round(b / 22.5) % 16]; }
  function fmtDate(ms) {
    try {
      return new Date(ms).toLocaleDateString(undefined,
        { year: 'numeric', month: 'short', day: 'numeric' }) + ' \u00B7 ' +
        new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return new Date(ms).toISOString().slice(0, 16).replace('T', ' '); }
  }

  // Deterministic: the same star always draws the same medallion.
  function seeded(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return function () { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  }
  function colourForBpRp(c) {
    if (c == null || !isFinite(c)) return '#B7C0CC';
    if (c < 0.3) return '#AFC8FF'; if (c < 0.7) return '#DCE6FF';
    if (c < 1.1) return '#FFF3D6'; if (c < 1.7) return '#FFD9A8';
    return '#FFB08A';
  }

  // ── the star medallion ────────────────────────────────────────────────────
  function medallionSVG(d) {
    var rng = seeded(String(d.id || d.name || 'x'));
    var col = colourForBpRp(d.bpRp), R = 46, cx = 56, cy = 56, out = [];
    out.push('<svg width="112" height="112" viewBox="0 0 112 112" aria-hidden="true">');
    out.push('<defs><radialGradient id="g1"><stop offset="0" stop-color="' + col +
             '" stop-opacity=".95"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></radialGradient></defs>');
    out.push('<circle cx="56" cy="56" r="52" fill="none" stroke="#C6A15B" stroke-opacity=".45"/>');
    out.push('<circle cx="56" cy="56" r="47" fill="none" stroke="#C6A15B" stroke-opacity=".18"/>');
    // a fixed field of faint neighbours, seeded so it never changes
    for (var i = 0; i < 34; i++) {
      var a = rng() * 6.2832, r = Math.sqrt(rng()) * (R - 6);
      out.push('<circle cx="' + (cx + Math.cos(a) * r).toFixed(1) + '" cy="' +
               (cy + Math.sin(a) * r).toFixed(1) + '" r="' + (0.5 + rng() * 1.1).toFixed(2) +
               '" fill="#B7C0CC" opacity="' + (0.18 + rng() * 0.4).toFixed(2) + '"/>');
    }
    out.push('<circle cx="56" cy="56" r="13" fill="url(#g1)"/>');
    out.push('<circle cx="56" cy="56" r="4.2" fill="' + col + '"/>');
    // the bearing notch: a real compass bearing, not decoration
    if (d.bearingDeg != null) {
      var t = (d.bearingDeg - 90) * D2R;
      out.push('<line x1="' + (cx + Math.cos(t) * 44).toFixed(1) + '" y1="' +
               (cy + Math.sin(t) * 44).toFixed(1) + '" x2="' + (cx + Math.cos(t) * 51).toFixed(1) +
               '" y2="' + (cy + Math.sin(t) * 51).toFixed(1) +
               '" stroke="#C6A15B" stroke-width="2.5" stroke-linecap="round"/>');
    }
    out.push('</svg>');
    return out.join('');
  }

  // ── the cornerstone grid background ───────────────────────────────────────
  // The real lattice at that point, at the real angle. HEALPix cells sit at a
  // rotation that varies with position, so a stylised diamond would be a lie
  // about the one thing this card is documenting.
  function gridSVG(lat, lon, order, w, h) {
    var H = HP();
    if (!H) return '';
    w = w || 340; h = h || 300;
    var spanM = Math.sqrt(510.1e12 / (12 * Math.pow(4, order))) * 2.6;   // ~2.6 cells across
    var mPerDeg = 111319.9, cosLat = Math.cos(lat * D2R);
    function pt(la, lo) {
      return [w / 2 + (lo - lon) * mPerDeg * cosLat / (spanM / w),
              h / 2 - (la - lat) * mPerDeg / (spanM / w)];
    }
    var out = ['<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="100%" ' +
               'preserveAspectRatio="xMidYMid slice" aria-hidden="true">'];
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
      out.push('<path d="' + d.join(' ') + '" fill="none" stroke="#6E9C8F" stroke-opacity="' +
               (idx ? 0.55 : 0.2) + '" stroke-width="' + (idx ? 1.6 : 0.7) + '"/>');
    });
    // the vertex itself
    out.push('<circle cx="' + (w / 2) + '" cy="' + (h / 2) +
             '" r="7" fill="none" stroke="#4ade80" stroke-width="2"/>');
    out.push('<circle cx="' + (w / 2) + '" cy="' + (h / 2) + '" r="2.6" fill="#4ade80"/>');
    out.push('</svg>');
    return out.join('');
  }

  // ── rendering ─────────────────────────────────────────────────────────────
  function row(k, v, cls) {
    return '<div class="row"><span class="k">' + k + '</span><span class="v' +
           (cls ? ' ' + cls : '') + '">' + v + '</span></div>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // opts: { kind, mini, star:{id,name,ra,dec,mag,bpRp,distLy}, cornerstone:{...},
  //         visit:{distanceM,bearingDeg,accuracyM,verdict,whenMs}, findNumber }
  function html(opts) {
    var v = opts.visit || {}, mini = opts.mini ? ' mini' : '';
    var body, bg = '';

    if (opts.kind === 'cornerstone') {
      var c = opts.cornerstone || {};
      var tier = F ? F.tierOf(c.tierOrder != null ? c.tierOrder : c.order, c.degree) : null;
      bg = c.lat != null ? '<div class="bg">' +
           gridSVG(c.lat, c.lon, Math.round(c.order || 12)) + '</div>' : '';
      body =
        '<div class="spc-kicker">Cornerstone</div><div class="spc-rule"></div>' +
        '<div class="spc-title"><div class="cat">HEALPix vertex</div>' +
        '<div class="id">' + esc(c.name) + '</div></div>' +
        (c.lat != null ? '<div class="spc-coords"><b>LAT</b> ' + c.lat.toFixed(6) +
          ' &nbsp; <b>LON</b> ' + c.lon.toFixed(6) + '</div>' : '') +
        '<div class="spc-ledger">' +
          row('Lines', 'order ' + c.crossOrder + ' \u00D7 order ' + c.intrinsicOrder) +
          row('Tier', (c.tierOrder != null ? c.tierOrder.toFixed(1) : '\u2014') +
              (tier ? ' \u00B7 ' + tier.key : '')) +
          (tier ? row('Frequency', esc(tier.label)) : '') +
          (v.distanceM != null ? row('Approach',
            v.distanceM.toFixed(1) + ' m ' + (v.bearingDeg != null ? compass(v.bearingDeg) : ''),
            'mono') : '') +
        '</div>' +
        '<div class="spc-stub"><div class="spc-perf"></div>' +
          row('Visited', v.whenMs ? fmtDate(v.whenMs) : '\u2014') +
          row('Accuracy', v.accuracyM != null ? '\u00B1' + Math.round(v.accuracyM) + ' m' : '\u2014') +
          row('Geometry', esc(v.verdict || '\u2014'),
              v.verdict === 'well-supported' ? 'yes' : '') +
        '</div>';

    } else {
      var d = opts.star || {};
      var tierS = F ? F.starTier(d.mag) : null;
      body =
        '<div class="spc-kicker">Geosonify \u00B7 Starpin Record</div><div class="spc-rule"></div>' +
        '<div class="spc-title"><div class="cat">' + esc(d.catalogue || 'Gaia DR3') + '</div>' +
        '<div class="id">' + esc((d.name || d.id || '').replace(/^Gaia DR3\s*/, '')) + '</div></div>' +
        '<div class="spc-med">' + medallionSVG({ id: d.id || d.name, bpRp: d.bpRp,
            bearingDeg: v.bearingDeg }) + '</div>' +
        (d.ra != null ? '<div class="spc-coords"><b>RA</b> ' + raToHMS(d.ra) +
          ' &nbsp; <b>DEC</b> ' + decToDMS(d.dec) + '</div>' : '') +
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
        '<div class="spc-note">Nothing was hidden or placed here. This point exists ' +
        'because of the star\u2019s coordinates.</div>' +
        '<div class="spc-stub"><div class="spc-perf"></div>' +
          row('Visited', v.whenMs ? fmtDate(v.whenMs) : '\u2014') +
          row('Accuracy', v.accuracyM != null ? '\u00B1' + Math.round(v.accuracyM) + ' m' : '\u2014') +
          row('Geometry', esc(v.verdict || '\u2014'),
              v.verdict === 'well-supported' ? 'yes' : '') +
        '</div>';
    }

    return '<div class="spc-card' + mini + '">' + bg + '<div class="inner">' + body + '</div></div>';
  }

  function render(opts, doc) {
    doc = doc || document;
    injectCss(doc);
    var wrap = doc.createElement('div');
    wrap.innerHTML = html(opts);
    return wrap.firstChild;
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
    close.type = 'button'; close.className = 'spc-close'; close.textContent = 'Keep it';
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

  return { VERSION: '0.1', render: render, show: show, html: html,
           medallionSVG: medallionSVG, gridSVG: gridSVG };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpinCard;
