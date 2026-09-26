/*
  geosonify-starpin-flip.js v0.2 — one place, two faces

  v0.2: THE MAP STAYS PUT. The default view is now the map, with a Ground/Sky
  switch for what lies beneath it. On Sky, the ground tiles fade and the sky
  imagery shows through UNDER the map's own lattice, dots and pins, mirrored
  east-west: that is the sky as it falls on the ground, so every star sits on
  its starpin and every 3" ring circles its own star. North stays up and east
  stays right, so nobody's mental geography has to turn over. The map drives,
  the sky follows every pan and pinch, and it bows out where Web Mercator and
  the sky's projection stop agreeing (sub-pixel to ~20 km across, measured).
  "Look up" still turns the view over for the sky as it is overhead; when the
  sky is already under the map it turns WITH the streets, arriving the right
  way round without ever being swapped.

  Browser: window.GeosonifyStarpinFlip.   Node: require('./geosonify-starpin-flip.js')
  (Node gets the pure maths only; mount() needs a DOM, Leaflet and, for the sky
  imagery, Aladin Lite v3.)

  The Earth face is the lattice map (geosonify-starpin-map.js). The Sky face is
  Geosonify's own sky renderer (geosonify-sky-renderer.js), with Aladin imagery
  swapped in behind it by geosonify-sky-aladin.js when it arrives -- the same
  contract Geosonify's sky view uses, so both apps share one Aladin set-up. It
  is centred on the sky whose coordinates ARE this ground: declination is
  latitude, right ascension is longitude. Between them sits one canvas of
  OpenStreetMap streets that belongs to neither map. It is drawn in whichever
  projection the visible face uses, and it carries the transition:

    1. the ground fades, leaving only the streets on dark;
    2. the streets turn over about the north-south axis, at EXACTLY the same
       size, which is the true from-below mirror (east on the left);
    3. the sky fades in underneath.

  THE SCALE IS NOT APPROXIMATED. Leaflet shows 360 / (256 * 2^zoom) degrees of
  longitude per CSS pixel, and on the sky a degree of right ascension spans
  cos(dec) degrees of arc. Declination is latitude, so the sky scale is
      arcsec per px = 1 296 000 * cos(lat) / (256 * 2^zoom)
  with no Earth radius anywhere in it. The sky side is then set by MEASURING
  the live renderer's projection (three project() calls give its exact linear
  map) and correcting until it agrees, never by trusting what a field-of-view
  number is said to mean. Metres only appear on the scale bar, through the
  engine's 30.92 m per arcsecond.

  The one place a scale change is honest: close in, sky surveys run out of
  detail (DSS2 is ~0.8"/px, which is ~25 m of ground). When the matched scale
  is finer than a survey can show, the sky pulls back AFTER the flip, visibly,
  with the streets and the two-unit scale bar moving with it. Looking back down
  retraces that zoom first if you have not changed it, so the ground comes back
  exactly as you left it.

  Starpins on the sky are drawn as their visit-geometry-v1 acceptance circle
  (3", 92.8 m). Solid: a mapped street or path passes through it. Dashed: the
  full-detail street data covers it and nothing passes through. Faint: we only
  hold coarse street data there, so we do not say. "A line passes within reach"
  is a hint from OpenStreetMap, never a rule of the game.
*/
'use strict';

var GeosonifyStarpinFlip = (function () {

  var root = (typeof window !== 'undefined') ? window : {};
  var S = (typeof GeosonifyStarpin !== 'undefined') ? GeosonifyStarpin
        : (typeof require === 'function' ? (function () {
            try { return require('./geosonify-starpin.js'); } catch (e) { return null; } })() : null);

  var D2R = Math.PI / 180;
  var RAD_ARCSEC = 206264.80624709636;
  var TURN_ARCSEC = 1296000;
  var TILE = 256;
  var M_PER_ARCSEC = (S && S.M_PER_ARCSEC) || 111319.9 / 3600;
  var M_PER_DEG = M_PER_ARCSEC * 3600;
  // visit-geometry-v1. The engine does not export R yet; when it does, it wins.
  var VISIT_R_ARCSEC = (S && S.VISIT_R_ARCSEC) || 3;


  // How far past a survey's native pixel the sky may be magnified before it
  // pulls back. Three times is soft but still reads as a photograph of stars.
  var UPSAMPLE_LIMIT = 3;
  var SURVEYS = [
    { id: 'P/DSS2/color', label: 'DSS2', nativeAsp: 0.8, decMin: -90,
      credit: 'DSS2 (STScI/CDS)', note: 'the whole sky, from photographic plates' },
    { id: 'P/PanSTARRS/DR1/color-z-zg-g', label: 'Pan-STARRS', nativeAsp: 0.25, decMin: -30,
      credit: 'Pan-STARRS DR1 (CDS)', note: 'sharp, but only north of \u221230\u00B0' },
    { id: 'CDS/P/DESI-Legacy-Surveys/DR10/color', label: 'Legacy Surveys', nativeAsp: 0.262, decMin: -90,
      credit: 'DESI Legacy Surveys DR10 (CDS)', note: 'sharp, but patchy: may be blank here' }
  ];
  function floorAsp(sv) { return sv.nativeAsp / UPSAMPLE_LIMIT; }

  // The turn needs the streets canvas and the sky to agree after it lands,
  // which holds to ~60 km across (see alignment() below); wider, it crossfades.
  var TURN_MAX_VIEW_M = 60000;
  // Arrival distance for a cornerstone (the app's 15 m rule): the point is
  // exact, so the only slack is the GPS fix, and the ring shows exactly that.
  var CORNER_BAG_M = 15;
  var STAR_MAX_VIEW_M = 8000;                        // matches the map's star lookup

  // ── pure maths (exported, and held by the self-test) ──────────────────────

  function wrap360(x) { x = x % 360; return x < 0 ? x + 360 : x; }
  function wrapNear(lon, ref) { return lon - 360 * Math.round((lon - ref) / 360); }

  // Arcseconds of sky per CSS pixel on a Leaflet (Web Mercator) map.
  function aspForZoom(zoom, lat) {
    return TURN_ARCSEC * Math.cos(lat * D2R) / (TILE * Math.pow(2, zoom));
  }
  // ...and the (fractional) zoom that shows a given sky scale at that latitude.
  function zoomForAsp(asp, lat) {
    return Math.log(TURN_ARCSEC * Math.cos(lat * D2R) / (TILE * asp)) / Math.LN2;
  }

  // Orthographic (SIN) tangent-plane coordinates about (ra0, dec0), radians:
  // xi east, eta north. Takes ground (lat, lon), because lat is dec and lon is
  // ra, and every street vertex is a ground point. null on the far hemisphere.
  function tangentOf(ra0, dec0) {
    var a0 = ra0 * D2R, s0 = Math.sin(dec0 * D2R), c0 = Math.cos(dec0 * D2R);
    return function (lat, lon) {
      var d = lat * D2R, da = lon * D2R - a0, sd = Math.sin(d), cd = Math.cos(d), cda = Math.cos(da);
      if (s0 * sd + c0 * cd * cda <= 0) return null;
      return [cd * Math.sin(da), c0 * sd - s0 * cd * cda];
    };
  }
  // ...and back: the (ra, dec) at tangent-plane offset (xi, eta).
  function fromTangent(ra0, dec0, xi, eta) {
    var rho = Math.hypot(xi, eta);
    if (!rho) return [ra0, dec0];
    var c = Math.asin(Math.min(1, rho)), sc = Math.sin(c), cc = Math.cos(c);
    var d0 = dec0 * D2R;
    var dec = Math.asin(cc * Math.sin(d0) + eta * sc * Math.cos(d0) / rho);
    var ra = ra0 * D2R + Math.atan2(xi * sc, rho * Math.cos(d0) * cc - eta * Math.sin(d0) * sc);
    return [wrap360(ra / D2R), dec / D2R];
  }

  // The sky as seen from below at a given scale, north up, east on the LEFT --
  // the same convention as geosonify-sky-renderer.js. Used before a renderer
  // exists and in tests; once one is live, the projection is read from it.
  function skyProjector(ra0, dec0, asp, w, h) {
    var T = tangentOf(ra0, dec0), k = RAD_ARCSEC / asp, cx = w / 2, cy = h / 2;
    return function (lat, lon) {
      var t = T(lat, lon);
      return t ? [cx - t[0] * k, cy - t[1] * k] : null;
    };
  }

  // Angular separation, arcseconds.
  function sepArcsec(ra1, dec1, ra2, dec2) {
    var p1 = dec1 * D2R, p2 = dec2 * D2R, dl = (ra2 - ra1) * D2R;
    var a = Math.sin((p2 - p1) / 2), b = Math.sin(dl / 2);
    return 2 * Math.asin(Math.min(1, Math.sqrt(a * a + Math.cos(p1) * Math.cos(p2) * b * b))) * RAD_ARCSEC;
  }

  // A scale bar that says both things. Returns the bar in px and two labels.
  function scaleBar(asp, targetPx) {
    var mpp = asp * M_PER_ARCSEC, raw = (targetPx || 90) * mpp;
    var e = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / e;
    var nice = (f >= 5 ? 5 : f >= 2 ? 2 : 1) * e;
    var arc = nice / M_PER_ARCSEC, arcLabel;
    if (arc < 10) arcLabel = arc.toFixed(1) + '\u2033';
    else if (arc < 60) arcLabel = Math.round(arc) + '\u2033';
    else if (arc < 3600) arcLabel = (arc / 60).toFixed(arc < 600 ? 1 : 0) + '\u2032';
    else arcLabel = (arc / 3600).toFixed(1) + '\u00B0';
    var mLabel = nice >= 1000 ? (nice / 1000) + ' km' : nice + ' m';
    return { px: nice / mpp, metres: nice, arcsec: arc, mLabel: mLabel, arcLabel: arcLabel };
  }

  // Mean spacing of cornerstones of a given rarity: the side of a HEALPix
  // cell of that order, which is how far apart vertices of that population
  // sit. A cornerstone's halo is a sixteenth of it -- a first guess, to iterate:
  // order 12 -> ~100 m, order 10 -> ~400 m, order 8 -> ~1.6 km. Rarer finds are
  // further apart, so they own more ground, and the halo says so at map scale.
  var HALO_FRACTION = 1 / 16;
  function cellSideM(order) { return Math.sqrt(4 * Math.PI / (12 * Math.pow(4, order))) * 6371008.8; }
  function haloM(rarity) { return cellSideM(rarity) * HALO_FRACTION; }

  // Nearest approach, in metres, from a ground point to any way. Local flat
  // metres about the point: fine at the 100 m scale this answers.
  function nearestLineM(lat0, lon0, ways, limitM) {
    var kx = Math.cos(lat0 * D2R) * M_PER_DEG, ky = M_PER_DEG, best = Infinity;
    var dLat = limitM / ky, dLon = limitM / kx;
    for (var i = 0; i < ways.length; i++) {
      var bb = ways[i].bb;
      if (bb[0] > lat0 + dLat || bb[2] < lat0 - dLat) continue;
      var w0 = wrapNear(bb[1], lon0), w1 = w0 + (bb[3] - bb[1]);
      if (w0 > lon0 + dLon || w1 < lon0 - dLon) continue;
      var p = ways[i].pts, ax = null, ay = null;
      for (var j = 0; j < p.length; j++) {
        var x = wrapNear(p[j][1], lon0) - lon0, y = p[j][0] - lat0;
        x *= kx; y *= ky;
        if (ax !== null) {
          var dx = x - ax, dy = y - ay, L2 = dx * dx + dy * dy;
          var t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
          var qx = ax + t * dx, qy = ay + t * dy, d = Math.sqrt(qx * qx + qy * qy);
          if (d < best) best = d;
        }
        ax = x; ay = y;
      }
    }
    return best;
  }

  // Reachability from vector tiles. geos14: the z14 tiles (full detail: every
  // street, service lane, track and path) touching the star's circle; complete:
  // whether ALL of them are loaded. Only complete full-detail data may say
  // 'none'; a partial set can still prove 'near'.
  function reachFromGeos(lat, lon, geos14, complete) {
    var R = VISIT_R_ARCSEC * M_PER_ARCSEC, ways = [];
    for (var i = 0; i < geos14.length; i++) if (geos14[i] && geos14[i].roads) ways = ways.concat(geos14[i].roads);
    if (nearestLineM(lat, lon, ways, R) <= R) return 'near';
    return complete ? 'none' : 'unknown';
  }

  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  // ── styles ────────────────────────────────────────────────────────────────

  var CSS_ID = 'starpin-flip-css';
  var CSS = [
    '.spf{position:relative;width:100%;height:100%;overflow:hidden;background:#070A14;',
    '  color:#E9E4D6;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Rounded","SF Pro Text",',
    '  "Segoe UI",Roboto,sans-serif;-webkit-tap-highlight-color:transparent;',
    '  --spf-chalk:228,233,174;--spf-sun:#F2DE5C;--spf-lichen:#CED38C;--spf-rust:#E79E72;',
    '  --spf-moss:#7D9D33;--spf-ink:#070A14}',
    // A host page's global button styles (width:100%, drop shadows) must not
    // reach in here; every control below sets its own look.
    // :where() keeps this reset at the specificity of a single class, so every
    // control's own rule below still wins over it, while it beats a bare button{}.
    '.spf :where(button){width:auto;margin:0;border:0;box-shadow:none;transform:none}',
    '.spf :where(button):active{transform:none;box-shadow:none}',
    '.spf-layer{position:absolute;inset:0;transition:opacity .32s ease}',
    '.spf .spm{height:100%;border-radius:0;border:0;background:transparent}',
    '.spf .leaflet-container{background:transparent}',
    '.spf .leaflet-tile-pane{transition:opacity .45s ease}',
    '.spf[data-imagery=sky] .leaflet-tile-pane{opacity:0}',
    '.spf[data-imagery=sky] .spm-bm{display:none}',
    '.spf .leaflet-control-zoom{display:none}',
    '.spf .spm-bm{top:calc(.6rem + env(safe-area-inset-top,0px));right:.6rem}',
    // --spf-bottom: a host with its own bottom sheet sets this to the sheet's
    // resting height, and everything that lives at the bottom rides above it.
    '.spf{--spf-b:var(--spf-bottom,env(safe-area-inset-bottom,0px))}',
    '.spf .spm-orders{bottom:calc(5.4rem + var(--spf-b));left:.6rem}',
    '.spf .leaflet-bottom{bottom:var(--spf-bottom,0px)}',
    '.spf-streets{position:absolute;inset:0;pointer-events:none;transform-origin:50% 50%;',
    '  backface-visibility:visible;-webkit-backface-visibility:visible;z-index:500}',
    '.spf-ui{position:absolute;inset:0;pointer-events:none;z-index:700}',
    '.spf-ui>*{pointer-events:auto}',
    '.spf-scale{position:absolute;left:.75rem;top:calc(.75rem + env(safe-area-inset-top,0px));',
    '  pointer-events:none;font-size:.72rem;font-variant-numeric:tabular-nums;letter-spacing:.01em;',
    '  text-shadow:0 1px 2px rgba(0,0,0,.85)}',
    '.spf-scale .bar{height:6px;border:1.5px solid currentColor;border-top:0;margin-bottom:3px;',
    '  box-shadow:0 1px 2px rgba(0,0,0,.6);transition:width .12s linear}',
    '.spf-scale .u1{font-weight:650}.spf-scale .u2{opacity:.72;margin-left:.45em}',
    '.spf[data-face=earth] .spf-scale{color:#fff}',
    '.spf-status{position:absolute;left:50%;transform:translateX(-50%);',
    '  top:calc(.7rem + env(safe-area-inset-top,0px));pointer-events:none;font-size:.72rem;',
    '  padding:.3rem .65rem;border-radius:999px;background:rgba(7,10,20,.72);color:#E9E4D6;',
    '  opacity:0;transition:opacity .4s ease;white-space:nowrap;max-width:62%;overflow:hidden;text-overflow:ellipsis}',
    '.spf-status.on{opacity:1}',
    '.spf-survey{position:absolute;right:.6rem;top:calc(.6rem + env(safe-area-inset-top,0px));',
    '  font:inherit;font-size:.72rem;padding:.4rem .7rem;border-radius:999px;cursor:pointer;',
    '  border:1px solid rgba(233,228,214,.28);background:rgba(7,10,20,.6);color:#E9E4D6}',
    '.spf[data-face=earth][data-imagery=ground] .spf-survey{display:none}',
    '.spf-seg{display:flex;padding:3px;border-radius:999px;background:rgba(7,10,20,.72);',
    '  box-shadow:0 0 0 1px rgba(233,228,214,.22),0 10px 28px -10px rgba(0,0,0,.8)}',
    '.spf-seg button{font:inherit;font-size:.98rem;font-weight:650;border:0;cursor:pointer;',
    '  height:2.9rem;min-width:5.2rem;padding:0 1.1rem;border-radius:999px;background:transparent;',
    '  color:rgba(233,228,214,.8);transition:background .3s ease,color .3s ease}',
    '.spf-seg button[aria-pressed=true]{background:#E9E4D6;color:#070A14;box-shadow:none}',
    '.spf-seg button[data-imagery=sky][aria-pressed=true]{background:var(--spf-moss);color:#fff}',
    '.spf-seg button:focus-visible{outline:3px solid var(--spf-sun);outline-offset:2px}',
    '.spf[data-face=sky] .spf-seg,.spf[data-face=sky] .spf-lookup{display:none}',
    '.spf[data-face=earth] .spf-flip{display:none}',
    '.spf-dock{position:absolute;left:0;right:0;bottom:calc(1rem + var(--spf-b));',
    '  display:flex;align-items:center;justify-content:center;gap:1.1rem;pointer-events:none}',
    '.spf-dock>*{pointer-events:auto}',
    '.spf-flip{font:inherit;font-size:1.02rem;font-weight:650;letter-spacing:.01em;cursor:pointer;',
    '  min-width:9.5rem;height:3.4rem;padding:0 1.4rem;border-radius:999px;display:flex;',
    '  align-items:center;justify-content:center;gap:.6rem;border:0;',
    '  transition:background .5s ease,color .5s ease,transform .15s ease}',
    '.spf-flip:active{transform:scale(.96)}',
    '.spf-flip svg{width:1.35rem;height:1.35rem;transition:transform .6s cubic-bezier(.65,0,.35,1)}',
    '.spf[data-face=earth] .spf-flip{background:#E9E4D6;color:#070A14;',
    '  box-shadow:0 2px 0 rgba(0,0,0,.25),0 10px 28px -10px rgba(0,0,0,.7)}',
    '.spf[data-face=sky] .spf-flip{background:var(--spf-moss);color:#fff;',
    '  box-shadow:0 2px 0 rgba(0,0,0,.35),0 10px 28px -10px rgba(0,0,0,.9)}',
    '.spf[data-face=sky] .spf-flip svg{transform:scaleY(-1)}',
    '.spf[data-busy] .spf-flip{pointer-events:none;opacity:.85}',
    '.spf-round{width:2.9rem;height:2.9rem;border-radius:50%;border:0;cursor:pointer;display:flex;',
    '  align-items:center;justify-content:center;font:inherit;background:rgba(7,10,20,.66);',
    '  color:#E9E4D6;box-shadow:0 0 0 1px rgba(233,228,214,.22)}',
    '.spf-round svg{width:1.25rem;height:1.25rem}',
    '.spf-round[aria-pressed=true]{background:#E9E4D6;color:#070A14}',
    '.spf-flip:focus-visible,.spf-round:focus-visible,.spf-survey:focus-visible,',
    '.spf-sheet button:focus-visible{outline:3px solid var(--spf-sun);outline-offset:3px}',
    '.spf-hint{position:absolute;left:50%;top:22%;transform:translate(-50%,0);pointer-events:none;',
    '  font-size:.95rem;text-align:center;line-height:1.35;padding:.6rem 1rem;border-radius:14px;',
    '  background:rgba(7,10,20,.62);color:#E9E4D6;opacity:0;transition:opacity .6s ease;max-width:80%}',
    '.spf-hint.on{opacity:1}',
    '.spf-credit{position:absolute;left:.6rem;right:.6rem;bottom:calc(.25rem + var(--spf-b));',
    '  font-size:.58rem;opacity:.75;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,.9);color:#fff;',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.spf-credit a{color:inherit;pointer-events:auto}',
    // With the sky under the map, the ground tiles' credit would name imagery that
    // is not on screen; ours replaces it and credits what is.
    '.spf[data-face=earth][data-imagery=sky] .leaflet-control-attribution{display:none}',
    '.spf-sheet{position:absolute;left:.6rem;right:.6rem;bottom:calc(5.4rem + var(--spf-b));',
    '  max-width:26rem;margin:0 auto;padding:1rem 1.1rem .9rem;border-radius:20px;',
    '  background:rgba(12,16,28,.94);color:#E9E4D6;box-shadow:0 0 0 1px rgba(233,228,214,.14),',
    '  0 18px 40px -16px rgba(0,0,0,.9);font-size:.88rem;line-height:1.45}',
    '.spf-sheet[hidden]{display:none}',
    '.spf-sheet h3{margin:0 0 .15rem;font-size:1rem;font-weight:650;color:#fff}',
    '.spf-sheet .sub{color:rgba(233,228,214,.7);font-size:.8rem;margin-bottom:.55rem}',
    '.spf-sheet p{margin:.35rem 0}',
    '.spf-sheet .row{display:flex;gap:.5rem;margin-top:.8rem;flex-wrap:wrap}',
    '.spf-sheet button{font:inherit;font-size:.85rem;font-weight:600;padding:.55rem .95rem;',
    '  border-radius:999px;border:0;cursor:pointer;background:#E9E4D6;color:#070A14}',
    '.spf-sheet button.quiet{background:transparent;color:#E9E4D6;box-shadow:0 0 0 1px rgba(233,228,214,.3)}',
    '.spf-sheet .reach{display:flex;gap:.55rem;align-items:flex-start}',
    '.spf-sheet .reach svg{flex:none;width:1.15rem;height:1.15rem;margin-top:.1rem}',
    '.spf-sheet a{color:var(--spf-lichen)}',
    '.spf-about{max-height:62vh;overflow:auto}',
    '@media (prefers-reduced-motion:reduce){.spf-layer,.spf-flip,.spf-flip svg,.spf-hint,.spf-status{transition:none}}'
  ].join('\n');

  var ICON_FLIP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 15h18"/>' +
    '<path d="M6 15a6 6 0 0 1 12 0"/><path d="M12 3v2.2M5.6 5.6l1.4 1.4M18.4 5.6 17 7"/>' +
    '<path d="M8 19h8"/></svg>';
  var ICON_LOCATE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
  var ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/>' +
    '<circle cx="12" cy="7.6" r=".6" fill="currentColor"/></svg>';
  function reachIcon(kind) {
    if (kind === 'near') return '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" ' +
      'fill="none" stroke="#F2DE5C" stroke-width="2"/><path d="M2 13 18 6" stroke="rgb(228,233,174)" stroke-width="2"/></svg>';
    if (kind === 'none') return '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" ' +
      'fill="none" stroke="#F2DE5C" stroke-width="2" stroke-dasharray="3 3"/></svg>';
    return '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" ' +
      'stroke="#F2DE5C" stroke-opacity=".45" stroke-width="2"/></svg>';
  }
  function reachText(kind) {
    var r = VISIT_R_ARCSEC + '\u2033 (' + Math.round(VISIT_R_ARCSEC * M_PER_ARCSEC) + ' m)';
    if (kind === 'near') return 'A mapped street or path passes within ' + r + '. Looks reachable.';
    if (kind === 'none') return 'No mapped street or path within ' + r + '. It may still be reachable ' +
      'on foot, or it may be behind a fence or in water.';
    return 'Zoom in for street detail to see whether a path passes within ' + r + '.';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ── mount ─────────────────────────────────────────────────────────────────

  function mount(container, opts) {
    opts = opts || {};
    var doc = container.ownerDocument, win = doc.defaultView;
    if (!doc.getElementById(CSS_ID)) {
      var st = doc.createElement('style'); st.id = CSS_ID; st.textContent = CSS; doc.head.appendChild(st);
    }
    var M = opts.mapModule || root.GeosonifyStarpinMap;
    var SN = opts.skyNeighbour !== undefined ? opts.skyNeighbour : (root.GeosonifySkyNeighbour || null);
    var store = null;
    try { store = opts.storage !== undefined ? opts.storage : win.localStorage; } catch (e) {}
    var reducedMotion = !!(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);

    // ── DOM ──
    var el = doc.createElement('div'); el.className = 'spf';
    var earthEl = doc.createElement('div'); earthEl.className = 'spf-layer spf-earth';
    var skyEl = doc.createElement('div'); skyEl.className = 'spf-layer spf-sky';
    var cv = doc.createElement('canvas'); cv.className = 'spf-streets';
    var ui = doc.createElement('div'); ui.className = 'spf-ui';
    ui.innerHTML =
      '<div class="spf-scale" aria-hidden="true"><div class="bar"></div><span class="u1"></span><span class="u2"></span></div>' +
      '<div class="spf-status" role="status" aria-live="polite"></div>' +
      '<button class="spf-survey" type="button"></button>' +
      '<div class="spf-hint" aria-hidden="true"></div>' +
      '<div class="spf-credit"></div>' +
      '<div class="spf-sheet" hidden></div>' +
      '<div class="spf-dock">' +
        '<button class="spf-round spf-locate" type="button" aria-label="Show where I am" aria-pressed="false">' + ICON_LOCATE + '</button>' +
        '<div class="spf-seg" role="group" aria-label="What lies under the map">' +
          '<button type="button" data-imagery="ground" aria-pressed="false">Ground</button>' +
          '<button type="button" data-imagery="sky" aria-pressed="false">Sky</button>' +
        '</div>' +
        '<button class="spf-round spf-lookup" type="button" aria-label="Look up: turn the map over to see the sky as it is overhead">' + ICON_FLIP + '</button>' +
        '<button class="spf-flip" type="button">' + ICON_FLIP + '<span></span></button>' +
        '<button class="spf-round spf-info" type="button" aria-label="About this view">' + ICON_INFO + '</button>' +
      '</div>';
    // The sky sits UNDER the map: with the ground tiles faded out, the map's own
    // lattice, dots and pins are drawn straight over the stars.
    el.appendChild(skyEl); el.appendChild(earthEl); el.appendChild(cv); el.appendChild(ui);
    container.appendChild(el);
    function q(sel) { return ui.querySelector(sel); }
    var flipBtn = q('.spf-flip'), flipLabel = q('.spf-flip span'), surveyBtn = q('.spf-survey'),
        statusEl = q('.spf-status'), hintEl = q('.spf-hint'), sheet = q('.spf-sheet'),
        creditEl = q('.spf-credit'), locBtn = q('.spf-locate'), infoBtn = q('.spf-info'),
        scaleBarEl = q('.spf-scale .bar'), u1 = q('.spf-scale .u1'), u2 = q('.spf-scale .u2'),
        segBtns = ui.querySelectorAll('.spf-seg button'), lookBtn = q('.spf-lookup');

    // ── state ──
    // face: 'earth' is the map, 'sky' is the turned-over view looking up.
    // imagery: what lies under the map on the earth face, 'ground' or 'sky'.
    var face = opts.face === 'sky' ? 'sky' : 'earth';
    var imagery = opts.imagery === 'ground' ? 'ground' : 'sky';
    var softNoted = false, mirrorNoted = false;
    var busy = false, zoomAnimating = false, destroyed = false;
    var sky = { ra: 0, dec: 0, asp: 1 };             // used when Aladin is absent
    var renderer = null, rendererKind = null, imageryTried = false, userZoomed = false;
    var anchor = null;                               // { earthAsp, skyAsp } for this visit to the sky
    var fix = null, stars = [], finds = [], corners = [], bagged = {}, streetsOn = true;
    var surveyIdx = 0, hintShown = false, selectedStar = null;
    try { var sv = store && store.getItem('starpin.flip.survey'); if (sv) surveyIdx = +sv || 0; } catch (e) {}
    try { var im = store && store.getItem('starpin.flip.imagery'); if (!opts.imagery && (im === 'ground' || im === 'sky')) imagery = im; } catch (e) {}

    // ── Earth face ──
    var lat0 = opts.lat != null ? opts.lat : -43.5309, lon0 = opts.lon != null ? opts.lon : 172.6365;
    var earth = M.mount(earthEl, {
      lat: lat0, lon: lon0, zoom: opts.zoom || 16, storage: opts.storage,
      onSelect: function (sel) {
        if (sel && sel.kind === 'star' && sel.data) {
          var mine = stars.filter(function (x) { return x.name === sel.data.name; })[0];
          if (mine) { showStar(mine); return; }
        }
        if (!sel) closeSheet();
        if (opts.onSelect) opts.onSelect(sel);
      },
      onMove: function (la, lo, span) { settle(); if (opts.onMove) opts.onMove(la, lo, span); }
    });
    var lm = earth.leaflet;
    // On the ground, the streets are credited where Leaflet credits the imagery,
    // rather than in a second line fighting it for the same corner.
    try { lm.attributionControl.addAttribution('Streets \u00A9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'); } catch (e) {}
    sky = { ra: wrap360(lon0), dec: lat0, asp: aspForZoom(lm.getZoom(), lat0) };

    function size() { return { w: el.clientWidth || 1, h: el.clientHeight || 1 }; }
    function earthAsp() { return aspForZoom(lm.getZoom(), lm.getCenter().lat); }
    function survey() { return SURVEYS[surveyIdx] || SURVEYS[0]; }

    // ── Sky face: Geosonify's renderer contract ──
    //
    // The sky is not ours to draw. geosonify-sky-renderer.js draws it at once,
    // with nothing to download, and geosonify-sky-aladin.js swaps imagery in
    // behind it when (and if) it arrives -- exactly as Geosonify's own sky view
    // does, so the two apps share one Aladin set-up and one set of fixes.
    var SR = opts.skyRenderer || root.GeosonifySkyRenderer;
    var SA = opts.skyAladin !== undefined ? opts.skyAladin : (root.GeosonifySkyAladin || null);

    function attach(r) {
      r.on('move', onSkyMove); r.on('zoom', onSkyMove); r.on('resize', onSkyMove);
    }
    function startSky() {
      if (renderer || !SR) return;
      var z = size();
      renderer = SR.createBuiltInRenderer(skyEl, {
        ra: sky.ra, dec: sky.dec, fovDeg: fovForAsp(sky.asp, z),
        background: '#070A14', gridColor: 'rgba(228,233,174,.16)'
      });
      renderer.init();
      rendererKind = 'builtin';
      attach(renderer);
      setSkyAsp(sky.asp);
      tryImagery();
    }
    function tryImagery() {
      if (imageryTried || !SA || !SA.isAvailable || !SA.isAvailable()) return;
      imageryTried = true;
      var c0 = renderer.getCenter();
      var cand = SA.createAladinRenderer(skyEl, {
        ra: c0[0], dec: c0[1], fovDeg: renderer.getFovDeg(), background: '#070A14',
        survey: survey().id, src: absoluteUrl(opts.aladinSrc), aladinOptions: opts.aladinOptions
      });
      cand.init().then(function (ok) {
        if (!ok || destroyed) { try { cand.destroy(); } catch (e) {} return; }
        // Re-read the view at swap time: the download can take seconds, and a
        // flip or a pan in the meantime must not be undone by stale values.
        var live = readSky();
        try { renderer.destroy(); } catch (e) {}
        renderer = cand; rendererKind = 'aladin';
        attach(renderer);
        renderer.setCenter(live.ra, live.dec);
        setSkyAsp(live.asp);                       // measured, not requested
        if (anchor && !userZoomed) anchor.skyAsp = live.asp;
        if (face === 'earth' && imagery === 'sky') syncSkyToMap(true);
        applyFace(); drawNow();
      }).catch(function (err) {
        try { cand.destroy(); } catch (e) {}
        status('No sky imagery here, so the streets are shown on plain dark.', 5000);
        if (win.console) win.console.warn('[starpin] sky imagery unavailable:', err && err.message);
      });
    }

    // A self-hosted Aladin path must be made absolute HERE. The adapter imports
    // it with new Function('return import(u)'), and a relative specifier there
    // resolves against the ADAPTER'S OWN URL, not the page: 'lib/aladin.js'
    // from a page at / becomes /js/lib/lib/aladin.js, and './x' is no better.
    function absoluteUrl(src) {
      if (!src) return src;
      try { return new win.URL(src, doc.baseURI).href; } catch (e) { return src; }
    }

    // Field of view for a scale, using the renderer contract's convention:
    // fovDeg spans the SMALLER viewport dimension, orthographically.
    function fovForAsp(asp, z) {
      var half = Math.min(z.w, z.h) / 2 * asp / RAD_ARCSEC;
      return 2 * Math.asin(Math.min(1, half)) / D2R;
    }

    // THE PROJECTION IS READ FROM THE RENDERER, NOT MODELLED.
    // Project the centre and two points a small, known distance away along the
    // tangent-plane axes (east and north), and take the linear map between them.
    // That captures whatever the live renderer does -- its scale, its handedness,
    // any rotation -- in three calls, and it is exact for any orthographic
    // renderer, which both are. Streets then cost arithmetic, not thousands of
    // calls into Aladin per frame.
    function skyAffine() {
      if (!renderer) return null;
      var c = renderer.getCenter(), ra0 = c[0], dec0 = c[1];
      var e = Math.max(1e-12, renderer.getFovDeg() * D2R * 0.05);
      var p0 = renderer.project(ra0, dec0);
      var pe = renderer.project.apply(null, fromTangent(ra0, dec0, e, 0));
      var pn = renderer.project.apply(null, fromTangent(ra0, dec0, 0, e));
      if (!p0 || !pe || !pn) return null;
      return { ra0: ra0, dec0: dec0, x0: p0[0], y0: p0[1],
               ax: (pe[0] - p0[0]) / e, ay: (pe[1] - p0[1]) / e,
               bx: (pn[0] - p0[0]) / e, by: (pn[1] - p0[1]) / e };
    }
    function affineAsp(A) { return A ? RAD_ARCSEC / Math.hypot(A.ax, A.ay) : null; }

    function readSky() {
      var A = skyAffine();
      if (!A) return { ra: sky.ra, dec: sky.dec, asp: sky.asp };
      sky = { ra: wrap360(A.ra0), dec: A.dec0, asp: affineAsp(A) || sky.asp };
      return { ra: sky.ra, dec: sky.dec, asp: sky.asp };
    }
    // Ask for a scale, then MEASURE it and correct -- the same discipline as
    // geosonify-sky-zoom.js: trust the result, not the request.
    var fovCorrection = 1;                           // what the last full match learned
    function setSkyAsp(asp) {
      sky.asp = asp;
      if (!renderer) return;
      var base = fovForAsp(asp, size()), fov = base * fovCorrection;
      renderer.setFovDeg(fov);
      for (var i = 0; i < 4; i++) {
        var got = affineAsp(skyAffine());
        if (!got || Math.abs(got / asp - 1) <= 0.001) break;
        fov *= asp / got;
        renderer.setFovDeg(fov);
      }
      fovCorrection = fov / base;
    }
    // Every frame of a pan or pinch: reuse the learned correction, no measuring.
    // The full match runs again when the map settles.
    function setSkyAspQuick(asp) {
      sky.asp = asp;
      if (renderer) renderer.setFovDeg(fovForAsp(asp, size()) * fovCorrection);
    }
    function positionSky(ra, dec, asp) {
      sky = { ra: wrap360(ra), dec: dec, asp: asp };
      if (renderer) { renderer.setCenter(sky.ra, dec); setSkyAsp(asp); }
    }

    function animateSkyAsp(a0, a1, ms) {
      return new Promise(function (resolve) {
        if (reducedMotion || !ms || !renderer) { setSkyAsp(a1); drawNow(); updateScale(); return resolve(); }
        var t0 = null;
        function step(ts) {
          if (destroyed) return resolve();
          if (t0 === null) t0 = ts;
          var t = Math.min(1, (ts - t0) / ms), e = easeInOut(t);
          setSkyAsp(a0 * Math.pow(a1 / a0, e));
          drawNow(); updateScale();
          if (t < 1) win.requestAnimationFrame(step); else resolve();
        }
        win.requestAnimationFrame(step);
      });
    }

    // ── what is on screen, in ground terms ──
    function viewState() {
      var z = size();
      if (face === 'earth') {
        var c = lm.getCenter();
        return { lat: c.lat, lon: c.lng, asp: earthAsp(), w: z.w, h: z.h };
      }
      var s = readSky();
      return { lat: s.dec, lon: wrapNear(s.ra, lm.getCenter().lng), asp: s.asp, w: z.w, h: z.h };
    }
    function viewBox(v, pad) {
      pad = pad == null ? 0 : pad;
      var hx = v.asp * v.w / 2 / 3600 * (1 + pad), hy = v.asp * v.h / 2 / 3600 * (1 + pad);
      var cl = Math.max(0.05, Math.cos(v.lat * D2R));
      return { s: v.lat - hy, n: v.lat + hy, w: v.lon - hx / cl, e: v.lon + hx / cl };
    }
    function viewWidthM(v) { return v.asp * v.w * M_PER_ARCSEC; }
    function covers(b, vb) {
      if (!b) return false;
      var mid = (b.w + b.e) / 2, w = wrapNear(vb.w, mid), e = w + (vb.e - vb.w);
      return vb.s >= b.s && vb.n <= b.n && w >= b.w && e <= b.e;
    }

    // ── the ground's map: vector tiles ──
    //
    // One source for everything under the lattice: coasts, lakes, rivers and
    // borders at country scale, main roads at region scale, every street and
    // path close in. geosonify-starpin-vtiles.js fetches, caches and decodes;
    // this only asks for what is on screen and draws what has arrived.
    var VT = opts.tiles !== undefined ? opts.tiles : (root.GeosonifyStarpinTiles || null);
    var tiles = VT ? VT.createStore({
      window: win, tilejson: opts.tilejson,
      onTile: function () { restar(); schedule(); }
    }) : null;
    function mapZoomOf(v) { return face === 'earth' ? lm.getZoom() : zoomForAsp(v.asp, v.lat); }
    function viewTiles(v, margin) {
      if (!VT) return [];
      return VT.tilesFor(viewBox(v, 0.02), VT.tileZoomFor(mapZoomOf(v)), margin || 0);
    }
    // Ask for the view plus a one-tile margin, so a short pan is already there.
    function ensureTiles(v) {
      if (!tiles || !streetsOn) return;
      viewTiles(v, 1).forEach(function (t) { tiles.request(t.z, t.x, t.y); });
    }
    function anyTileInView(v) {
      if (!tiles) return false;
      return viewTiles(v, 0).some(function (t) { return !!tiles.peek(t.z, t.x, t.y); });
    }

    // ── stars ──
    var starKey = '', starTimer = null;
    function ensureStars(v) {
      var widthM = viewWidthM(v);
      // lookupStars: false means the host looks stars up itself and hands them
      // over with setStars(); nothing is fetched twice.
      if (opts.lookupStars === false) return;
      var lookup = opts.lookupStars || (SN && SN.lookupRemote ? function (lat, lon, rArcmin) {
        return Promise.resolve(SN.lookupRemote(lat, lon, { radiusArcmin: rArcmin, limit: 40 }))
          .then(function (list) {
            return (list || []).map(function (n) {
              var s2 = n.star || n;
              return { name: s2.name, ra: +s2.ra, dec: +s2.dec, mag: s2.mag, distLy: n.distLy, links: n.links };
            });
          });
      } : null);
      if (!lookup) return;
      if (widthM > STAR_MAX_VIEW_M) { if (stars.length) setStars([]); starKey = ''; return; }
      var k = v.lat.toFixed(4) + ',' + v.lon.toFixed(4) + ',' + Math.round(widthM / 200);
      if (k === starKey) return;
      starKey = k;
      clearTimeout(starTimer);
      starTimer = setTimeout(function () {
        var halfDiagArcsec = v.asp * Math.hypot(v.w, v.h) / 2;
        var rArcmin = Math.min(12, Math.max(0.3, halfDiagArcsec * 1.1 / 60));
        Promise.resolve(lookup(v.lat, wrapNear(v.lon, 0), rArcmin)).then(function (list) {
          if (destroyed || k !== starKey) return;
          setStars(list || []);
        }).catch(function () {});
      }, 450);
    }
    function setStars(list) {
      stars = (list || []).filter(function (s) { return s && isFinite(s.ra) && isFinite(s.dec); })
        .map(function (s) {
          var lat = s.dec, lon = wrapNear(wrap360(s.ra), 0);
          if (S && S.starpinAddress) {
            try { var a = S.starpinAddress(String(s.ra), String(s.dec)); lat = a.lat; lon = a.lon; } catch (e) {}
          }
          return { name: s.name, ra: +s.ra, dec: +s.dec, mag: s.mag, distLy: s.distLy, links: s.links,
                   lat: lat, lon: lon, reach: 'unknown' };
        });
      restar();
      earth.setStars(stars.map(function (s) {
        return { name: s.name, ra: s.ra, dec: s.dec, mag: s.mag, distLy: s.distLy, links: s.links,
                 lat: s.lat, lon: s.lon };
      }));
      drawNow();
    }
    // Each star's circle, against the full-detail (z14) tiles it touches.
    function reachTiles(s) {
      var R = VISIT_R_ARCSEC * M_PER_ARCSEC, dLat = R / M_PER_DEG,
          dLon = dLat / Math.max(0.05, Math.cos(s.lat * D2R));
      return VT.tilesFor({ s: s.lat - dLat, n: s.lat + dLat, w: s.lon - dLon, e: s.lon + dLon }, 14, 0);
    }
    function restar() {
      if (!tiles) return;
      stars.forEach(function (s) {
        var ts = reachTiles(s), geos = [], complete = true;
        ts.forEach(function (t) {
          var g = tiles.has(14, t.x, t.y) ? tiles.peek(14, t.x, t.y) : null;
          if (g) geos.push(g); else complete = false;
        });
        s.reach = reachFromGeos(s.lat, s.lon, geos, complete);
      });
    }
    // Close in, fetch the full-detail tiles under each star so its ring can say
    // whether a street reaches it. Further out the rings ask you to zoom in.
    function ensureReach(v) {
      if (!tiles || viewWidthM(v) > 3000) return;
      stars.forEach(function (s) { reachTiles(s).forEach(function (t) { tiles.request(14, t.x, t.y); }); });
    }

    // ── cornerstones in view, with their rarity ──
    //
    // Every collectible cornerstone (rarity order <= 12) in view, found by
    // enumerating cell corners at a probe order suited to the view and
    // classifying each with the engine's own nearestCornerstone(), so the
    // rarity here is the rarity the log will record. Classification is cached
    // per vertex; enumeration runs when the view settles, never per frame.
    var cornerCache = {};
    function HPg() {
      try { if (typeof HealpixGrids !== 'undefined' && HealpixGrids) return HealpixGrids; } catch (e) {}
      return root.HealpixGrids || null;
    }
    function FB() { return root.GeosonifyStarpinFeedback || null; }
    function findCorners(v) {
      var H = HPg(), width = viewWidthM(v);
      if (!H || !S || !S.nearestCornerstone || width > 120000) { corners = []; return; }
      // The finest probe whose cells are still at least an eighth of the view.
      var k = Math.max(3, Math.min(14, Math.floor(Math.log(cellSideM(0) / (width / 8)) / Math.LN2)));
      var box = viewBox(v, 0.15), stepDeg = cellSideM(k) / 2 / M_PER_DEG;
      var cl = Math.max(0.05, Math.cos(v.lat * D2R)), seen = {}, cells = [], guard = 0;
      for (var la = box.s; la <= box.n + stepDeg && guard < 4000; la += stepDeg) {
        for (var lo = box.w; lo <= box.e + stepDeg / cl && guard < 4000; lo += stepDeg / cl) {
          guard++;
          var ip = H.nestIndex(Math.max(-89.99, Math.min(89.99, la)), lo, k).toString();
          if (!seen[ip]) { seen[ip] = 1; cells.push(BigInt(ip)); }
        }
      }
      var nside = Math.pow(2, k), vs = {}, out = [], F = FB();
      cells.forEach(function (ip) {
        [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (uv) {
          var q = H._core.pixcoord2vec_nest(nside, ip, uv[0], uv[1]);
          var x = q.x != null ? q.x : q[0], y = q.y != null ? q.y : q[1], zq = q.z != null ? q.z : q[2];
          var r3 = Math.hypot(x, y, zq);
          var lat = Math.asin(zq / r3) / D2R, lon = Math.atan2(y, x) / D2R;
          var key = lat.toFixed(7) + ',' + wrapNear(lon, 0).toFixed(7);
          if (vs[key]) return;
          vs[key] = 1;
          var c = cornerCache[key];
          if (!c) {
            try {
              var n = S.nearestCornerstone(lat, lon, k);
              var rar = F && F.rarityOrder ? F.rarityOrder(n.crossOrder, n.intrinsicOrder)
                                           : (n.crossOrder + n.intrinsicOrder) / 2;
              c = cornerCache[key] = { lat: n.lat, lon: n.lon, rarity: rar, degree: n.degree,
                                       cross: n.crossOrder, intrinsic: n.intrinsicOrder, name: n.name };
            } catch (e) { return; }
          }
          if (c.rarity <= 12) out.push(c);
        });
      });
      corners = out;
    }

    // ── drawing ──
    var ctx = cv.getContext ? cv.getContext('2d') : null;
    var rafPending = false;
    function schedule() {
      if (rafPending) return;
      rafPending = true;
      win.requestAnimationFrame(function () { rafPending = false; drawNow(); });
    }
    function projector(v) {
      if (face === 'sky') {
        var A = skyAffine();
        if (!A) return skyProjector(wrap360(v.lon), v.lat, v.asp, v.w, v.h);
        var T = tangentOf(A.ra0, A.dec0);
        return function (lat, lon) {
          var t = T(lat, lon);
          return t ? [A.x0 + t[0] * A.ax + t[1] * A.bx, A.y0 + t[0] * A.ay + t[1] * A.by] : null;
        };
      }
      var ref = lm.getCenter().lng;
      return function (lat, lon) {
        var p = lm.latLngToContainerPoint([lat, wrapNear(lon, ref)]); return [p.x, p.y];
      };
    }
    // ── the look ──
    // Three families, kept apart so the screen reads by meaning:
    //   the ground's own map  cool and quiet: moonlight roads, blue water, pale borders
    //   the lattice           warm amber (the map module's 'night' palette), and
    //                         cornerstones in the same amber: they are its points
    //   stars                 sun-yellow rings and reticles
    // Yours stays green; you are the blue dot.
    var LOOK = {
      night: { road: '205,214,228', water: '118,170,226', border: '232,226,246', under: '7,10,20' },
      light: { road: '44,52,66',   water: '52,110,178',  border: '96,84,120',   under: '255,255,255' }
    };
    var ROADS = {
      major:   { w: 1.9, a: 0.85, dash: null },
      minor:   { w: 1.05, a: 0.6, dash: null },
      service: { w: 0.7, a: 0.42, dash: null },
      path:    { w: 0.9, a: 0.55, dash: [2.5, 3] }
    };
    var AMBER = '240,163,58', GOLD = '255,214,106', MINE = '159,211,106';

    function drawNow() {
      if (!ctx || destroyed || zoomAnimating) return;
      var z = size(), dpr = win.devicePixelRatio || 1;
      if (cv.width !== Math.round(z.w * dpr) || cv.height !== Math.round(z.h * dpr)) {
        cv.width = Math.round(z.w * dpr); cv.height = Math.round(z.h * dpr);
        cv.style.width = z.w + 'px'; cv.style.height = z.h + 'px';
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, z.w, z.h);
      var v = viewState(), P = projector(v);
      var dark = face === 'sky' || imagery === 'sky' || (M.BASEMAPS[earth.basemap()] || {}).imagery;
      var L = dark ? LOOK.night : LOOK.light;
      var faceAlpha = face === 'sky' ? 0.9 : (imagery === 'sky' ? 0.85 : 0.6);

      drawHalos(v, P, 'fill');
      if (streetsOn) drawTiles(v, P, L, faceAlpha, dark);
      drawHalos(v, P, 'marks');
      drawSkyMarks(v, P);
      updateScale(v);
    }

    // One tile's worth of the map, clipped to that tile so neighbours' buffers
    // never double up. A missing tile is stood in for by its nearest cached
    // ancestor, drawn once however many missing children it covers.
    function drawTiles(v, P, L, fa, dark) {
      if (!tiles) return;
      var drawn = {}, ref = face === 'earth' ? lm.getCenter().lng : v.lon;
      viewTiles(v, 0).forEach(function (t) {
        var g = tiles.peek(t.z, t.x, t.y);
        if (!g) return;
        var k = g.z + '/' + g.x + '/' + g.y;
        if (drawn[k]) return;
        drawn[k] = 1;
        var b = g.bounds, shift = wrapNear((b.w + b.e) / 2, ref) - (b.w + b.e) / 2;
        var corners4 = [[b.n, b.w], [b.n, b.e], [b.s, b.e], [b.s, b.w]].map(function (c) { return P(c[0], c[1] + shift); });
        if (corners4.some(function (c) { return !c; })) return;
        ctx.save();
        ctx.beginPath();
        corners4.forEach(function (c, i) { if (i) ctx.lineTo(c[0], c[1]); else ctx.moveTo(c[0], c[1]); });
        ctx.closePath(); ctx.clip();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        function path(pts, skip) {
          var on = false;
          for (var j = 0; j < pts.length; j++) {
            var p = P(pts[j][0], pts[j][1] + shift);
            if (!p) { on = false; continue; }
            if (!on || (skip && skip[j - 1])) { ctx.moveTo(p[0], p[1]); on = true; } else ctx.lineTo(p[0], p[1]);
          }
        }
        // Water: a faint fill, and the shoreline -- never the tile's own cut edges.
        if (g.water.length) {
          ctx.beginPath(); g.water.forEach(function (w) { path(w.pts); });
          ctx.fillStyle = 'rgba(' + L.water + ',' + (0.1 * fa) + ')'; ctx.fill('evenodd');
          ctx.beginPath(); g.water.forEach(function (w) { path(w.pts, w.edge); });
          ctx.strokeStyle = 'rgba(' + L.water + ',' + (0.7 * fa) + ')'; ctx.lineWidth = 1.1; ctx.setLineDash([]); ctx.stroke();
        }
        if (g.waterways.length) {
          [true, false].forEach(function (big) {
            ctx.beginPath(); g.waterways.forEach(function (w) { if (w.big === big) path(w.pts); });
            ctx.strokeStyle = 'rgba(' + L.water + ',' + ((big ? 0.7 : 0.45) * fa) + ')';
            ctx.lineWidth = big ? 1.5 : 0.8; ctx.stroke();
          });
        }
        if (g.borders.length) {
          ctx.beginPath(); g.borders.forEach(function (w) { path(w.pts); });
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = 'rgba(' + L.border + ',' + (0.5 * fa) + ')'; ctx.lineWidth = 1.1; ctx.stroke();
          ctx.setLineDash([]);
        }
        ['service', 'path', 'minor', 'major'].forEach(function (cls) {
          var st = ROADS[cls];
          ctx.beginPath();
          g.roads.forEach(function (r) { if (r.cls === cls) path(r.pts); });
          ctx.setLineDash(st.dash || []);
          if (dark) {                                  // a dark underlay holds a line over bright stars and ground
            ctx.strokeStyle = 'rgba(' + L.under + ',' + (0.35 * fa) + ')'; ctx.lineWidth = st.w + 1.4; ctx.stroke();
          }
          ctx.strokeStyle = 'rgba(' + L.road + ',' + (st.a * fa) + ')'; ctx.lineWidth = st.w; ctx.stroke();
        });
        ctx.setLineDash([]);
        ctx.restore();
      });
    }

    // Cornerstones: a soft amber halo sized by rarity (rarer = further apart =
    // more ground of its own), and a crisp ring at the real 15 m arrival
    // distance, so a rare one shows from far off and you still have to walk
    // right onto it. The halo is never the catch zone and never looks like one.
    function drawHalos(v, P, pass) {
      if (!corners.length) return;
      var mpp = v.asp * M_PER_ARCSEC, bagPx = CORNER_BAG_M / mpp;
      corners.forEach(function (c) {
        var p = P(c.lat, c.lon);
        if (!p || p[0] < -200 || p[1] < -200 || p[0] > v.w + 200 || p[1] > v.h + 200) return;
        var mine = !!(c.name && bagged[c.name]);
        var col = mine ? MINE : (c.degree === 3 || c.rarity <= 6 ? GOLD : AMBER);
        var hPx = haloM(c.rarity) / mpp;
        // Rarer shows stronger, so a glance ranks them.
        var strength = Math.max(0.55, Math.min(1, (14 - c.rarity) / 6));
        if (pass === 'fill') {
          if (hPx < 5) return;
          var g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], hPx);
          g.addColorStop(0, 'rgba(' + col + ',' + (0.38 * strength) + ')');
          g.addColorStop(0.7, 'rgba(' + col + ',' + (0.12 * strength) + ')');
          g.addColorStop(1, 'rgba(' + col + ',0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p[0], p[1], hPx, 0, 6.2832); ctx.fill();
          ctx.strokeStyle = 'rgba(' + col + ',' + (0.35 * strength) + ')'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(p[0], p[1], hPx, 0, 6.2832); ctx.stroke();
          return;
        }
        if (hPx < 5 && c.rarity > 10) return;          // far out, only the rare ones keep a mark
        if (bagPx >= 3) {
          ctx.beginPath(); ctx.arc(p[0], p[1], bagPx, 0, 6.2832);
          ctx.strokeStyle = 'rgba(7,10,20,.55)'; ctx.lineWidth = 3; ctx.stroke();
          ctx.strokeStyle = 'rgba(' + col + ',.95)'; ctx.lineWidth = 1.5; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(2, Math.min(3.5, bagPx * 0.25)), 0, 6.2832);
        ctx.fillStyle = 'rgba(' + col + ',1)'; ctx.fill();
      });
    }

    function drawSkyMarks(v, P) {
      var rPx = VISIT_R_ARCSEC / v.asp;
      // On the ground the map draws dots, finds and your position itself; the
      // rings are added only once they are big enough to say something about size.
      var onGround = face === 'earth';
      if (onGround && rPx < 4) return;
      stars.forEach(function (s) {
        var p = P(s.lat, s.lon);
        if (!p || p[0] < -60 || p[1] < -60 || p[0] > v.w + 60 || p[1] > v.h + 60) return;
        var sel = selectedStar && selectedStar.name === s.name;
        ctx.save();
        if (rPx >= 4) {
          ctx.beginPath(); ctx.arc(p[0], p[1], rPx, 0, 6.2832);
          ctx.setLineDash(s.reach === 'none' ? [4, 4] : []);
          ctx.strokeStyle = 'rgba(7,10,20,.55)'; ctx.lineWidth = sel ? 4.5 : 3.2; ctx.stroke();
          ctx.strokeStyle = s.reach === 'unknown' ? 'rgba(242,222,92,.5)' : '#F2DE5C';
          ctx.lineWidth = sel ? 2.6 : 1.6; ctx.stroke();
          ctx.setLineDash([]);
        }
        // The reticle: open, with a centre gap, like the card's, so it never
        // hides the faint thing it points at.
        var g = Math.max(3, Math.min(7, rPx * 0.28)), L = g + Math.max(4, Math.min(9, rPx * 0.35));
        ctx.beginPath();
        ctx.moveTo(p[0] - L, p[1]); ctx.lineTo(p[0] - g, p[1]);
        ctx.moveTo(p[0] + g, p[1]); ctx.lineTo(p[0] + L, p[1]);
        ctx.moveTo(p[0], p[1] - L); ctx.lineTo(p[0], p[1] - g);
        ctx.moveTo(p[0], p[1] + g); ctx.lineTo(p[0], p[1] + L);
        ctx.strokeStyle = 'rgba(7,10,20,.6)'; ctx.lineWidth = 3; ctx.stroke();
        ctx.strokeStyle = '#F2DE5C'; ctx.lineWidth = 1.4; ctx.stroke();
        ctx.restore();
      });
      if (onGround) return;
      finds.forEach(function (f) {
        var p = P(f.lat, f.lon);
        if (!p || p[0] < -20 || p[1] < -20 || p[0] > v.w + 20 || p[1] > v.h + 20) return;
        ctx.beginPath(); ctx.arc(p[0], p[1], 6, 0, 6.2832);
        ctx.fillStyle = '#CED38C'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#1d2410'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p[0] - 2.8, p[1]); ctx.lineTo(p[0] - 0.8, p[1] + 2.2); ctx.lineTo(p[0] + 3, p[1] - 2.4);
        ctx.stroke();
      });
      if (fix) {
        var fp = P(fix.lat, fix.lon);
        if (fp) {
          if (fix.accuracy_m) {
            ctx.beginPath(); ctx.arc(fp[0], fp[1], Math.max(4, fix.accuracy_m / M_PER_ARCSEC / v.asp), 0, 6.2832);
            ctx.fillStyle = 'rgba(77,163,255,.16)'; ctx.fill();
            ctx.strokeStyle = 'rgba(77,163,255,.6)'; ctx.lineWidth = 1; ctx.stroke();
          }
          ctx.beginPath(); ctx.arc(fp[0], fp[1], 5.5, 0, 6.2832);
          ctx.fillStyle = '#4DA3FF'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        }
      }
    }

    function updateScale(v) {
      v = v || viewState();
      var sb = scaleBar(v.asp, 88);
      scaleBarEl.style.width = Math.round(sb.px) + 'px';
      if (face === 'sky') { u1.textContent = sb.arcLabel; u2.textContent = sb.mLabel; }
      else { u1.textContent = sb.mLabel; u2.textContent = sb.arcLabel; }
    }

    // ── chrome ──
    var statusTimer = null;
    function status(text, ms) {
      clearTimeout(statusTimer);
      statusEl.textContent = text || '';
      statusEl.classList.toggle('on', !!text);
      if (text && ms) statusTimer = setTimeout(function () { statusEl.classList.remove('on'); }, ms);
    }
    function hint(text, ms) {
      hintEl.textContent = text; hintEl.classList.add('on');
      setTimeout(function () { hintEl.classList.remove('on'); }, ms || 4200);
    }
    function applyFace() {
      el.setAttribute('data-face', face);
      el.setAttribute('data-imagery', imagery);
      Array.prototype.forEach.call(segBtns, function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-imagery') === imagery ? 'true' : 'false');
      });
      flipLabel.textContent = face === 'earth' ? 'Look up' : 'Look down';
      flipBtn.setAttribute('aria-label', face === 'earth'
        ? 'Look up: turn the map over to see the sky above these streets'
        : 'Look down: turn back to the ground beneath these stars');
      earthEl.style.pointerEvents = face === 'earth' ? 'auto' : 'none';
      skyEl.style.pointerEvents = face === 'sky' ? 'auto' : 'none';
      earthEl.setAttribute('aria-hidden', face === 'earth' ? 'false' : 'true');
      skyEl.setAttribute('aria-hidden', face === 'sky' ? 'false' : 'true');
      surveyBtn.textContent = 'Sky: ' + survey().label;
      // Credit what is on screen, and only that. The renderer says what it owes:
      // the built-in one owes nothing, Aladin names CDS.
      var skyShownHere = face === 'sky' || imagery === 'sky';
      creditEl.style.display = skyShownHere ? '' : 'none';
      var skyShown = face === 'sky' || imagery === 'sky';
      var att = (skyShown && renderer && renderer.attribution) ? renderer.attribution() : null;
      creditEl.innerHTML = 'Streets \u00A9 <a href="https://www.openstreetmap.org/copyright" ' +
        'target="_blank" rel="noopener">OpenStreetMap</a> contributors' +
        (att ? ' \u00B7 <a href="' + esc(att.href) + '" target="_blank" rel="noopener">' + esc(att.text) +
               '</a> \u00B7 ' + esc(survey().credit) : '');
      if (opts.onFace) opts.onFace(face);
    }
    function wait(ms) { return new Promise(function (r) { setTimeout(r, reducedMotion ? 0 : ms); }); }
    function setOpacity(node, o, ms) {
      node.style.transition = 'opacity ' + (reducedMotion ? 0 : ms) + 'ms ease';
      node.style.opacity = String(o);
    }
    // The turn is only honest when there is something at matched scale to turn.
    function canTurn(v) {
      if (reducedMotion || !streetsOn) return false;
      if (viewWidthM(v) > TURN_MAX_VIEW_M) return false;
      return anyTileInView(v);
    }
    // ── the sky under the map ──
    //
    // On the earth face the sky is the ground's own shadow: centred on the map's
    // centre, at the map's exact scale, and MIRRORED east-west so that every star
    // lies on its starpin and every ring circles its own star. The map drives;
    // the sky follows, and never takes a touch.
    function mirrorTransform() { return 'translateX(' + size().w + 'px) scaleX(-1)'; }
    function mirrorStatic() {
      skyEl.style.transition = 'opacity .45s ease';
      skyEl.style.transformOrigin = '0 0';
      skyEl.style.transform = mirrorTransform();
    }
    function unmirror() { skyEl.style.transformOrigin = '50% 50%'; skyEl.style.transform = 'none'; }
    var skyOpacity = 1;
    // MEASURED, not assumed: the map is Web Mercator and every Aladin projection
    // is centred on the view, so they agree at the centre and drift apart with
    // distance from it. Across the screen: 0.02 px at 700 m wide, 0.7 px at
    // 22 km, 2.5 px at 86 km, 9 px at 345 km, 40 px at 1400 km (Aladin's own
    // MER is no better; it is an oblique Mercator about the view centre). So the
    // sky lies under the map only while it lines up, and bows out beyond that.
    var ALIGN_FULL_M = 60000, ALIGN_GONE_M = 400000;
    var wideNoted = false;
    function alignment(asp) {
      var w = asp * size().w * M_PER_ARCSEC;
      if (w <= ALIGN_FULL_M) return 1;
      if (w >= ALIGN_GONE_M) return 0;
      return 1 - Math.log(w / ALIGN_FULL_M) / Math.log(ALIGN_GONE_M / ALIGN_FULL_M);
    }
    function softness(asp) {
      // Past what the survey can resolve the sky goes soft, and says so once.
      var fl = floorAsp(survey());
      skyOpacity = asp >= fl ? 1 : Math.max(0.45, Math.sqrt(asp / fl));
      var al = alignment(asp);
      if (al < 1 && !wideNoted && imagery === 'sky' && face === 'earth') {
        wideNoted = true;
        status('The sky fades out this far out: map and sky stop lining up', 4000);
      }
      skyOpacity *= al;
      if (skyOpacity < 1 && !softNoted && imagery === 'sky' && face === 'earth') {
        softNoted = true;
        status('The sky is softer than the ground this close in', 3500);
      }
      return skyOpacity;
    }
    function syncSkyToMap(full) {
      if (face !== 'earth' || imagery !== 'sky' || !renderer) return;
      var c = lm.getCenter(), asp = earthAsp();
      renderer.setCenter(wrap360(c.lng), c.lat);
      if (full) setSkyAsp(asp); else setSkyAspQuick(asp);
      if (!busy && !zoomAnimating) skyEl.style.opacity = String(softness(asp));
    }
    function setImagery(k, quiet) {
      imagery = k === 'ground' ? 'ground' : 'sky';
      try { if (store) store.setItem('starpin.flip.imagery', imagery); } catch (e) {}
      earth.setPalette(imagery === 'sky' ? 'night' : null);
      applyFace();
      if (face !== 'earth') return;
      if (imagery === 'sky') {
        startSky();
        mirrorStatic();
        syncSkyToMap(true);
        setOpacity(skyEl, softness(earthAsp()), 450);
        if (!mirrorNoted && !quiet) {
          mirrorNoted = true;
          hint('The sky as it falls on the ground: mirrored east\u2013west, so every star sits on its starpin.', 5200);
        }
      } else {
        setOpacity(skyEl, 0, 450);
      }
      schedule(); settle();
    }

    // The turn. The streets always turn over. When the sky is already lying under
    // the map it turns WITH them: a mirrored layer turned half a revolution about
    // the north-south axis is the sky as seen from below, so the imagery arrives
    // the right way round without ever being swapped.
    function turnLayers(ms, withSky, skyEndsMirrored) {
      if (withSky) {
        skyEl.style.transition = 'none';
        skyEl.style.transformOrigin = '50% 50%';
        skyEl.style.transform = 'perspective(1600px) rotateY(' + (skyEndsMirrored ? 0 : 180) + 'deg)';
        void skyEl.offsetWidth;
        skyEl.style.transition = 'transform ' + ms + 'ms cubic-bezier(.65,0,.35,1), opacity .45s ease';
        skyEl.style.transform = 'perspective(1600px) rotateY(' + (skyEndsMirrored ? 180 : 360) + 'deg)';
      }
      return turnStreets(ms).then(function () {
        if (!withSky) return;
        skyEl.style.transition = 'none';
        if (skyEndsMirrored) mirrorStatic(); else unmirror();
      });
    }

    function turnStreets(ms) {
      cv.style.transformOrigin = '50% 50%';
      cv.style.transition = 'transform ' + ms + 'ms cubic-bezier(.65,0,.35,1)';
      // Force the start state to be committed before the end state is set.
      cv.style.transform = 'perspective(1600px) rotateY(0deg)';
      void cv.offsetWidth;
      cv.style.transform = 'perspective(1600px) rotateY(180deg)';
      return wait(ms + 20).then(function () {
        cv.style.transition = 'none'; cv.style.transform = 'none';
      });
    }

    // ── the flip ──
    //
    // THE ANCHOR. On the way up we record the ground scale we matched from and
    // the sky scale we left the sky at (after any pull-back). On the way down
    // the ground returns to that scale, times whatever zoom the PERSON did in
    // the sky -- never times what a renderer did by itself. geosonify-sky-zoom.js
    // learned this the hard way: Aladin can settle somewhere other than where it
    // was put, and reading that as a user zoom compounds on every flip.
    function toSky(o) {
      o = o || {};
      if (busy || face === 'sky') return Promise.resolve(face);
      busy = true; el.setAttribute('data-busy', '');
      closeSheet();
      if (o.center) { lm.setView([o.center.lat, o.center.lon], lm.getZoom(), { animate: false }); drawNow(); }
      var v = viewState();                            // the ground, matched
      var turn = canTurn(v);
      var skyUnder = imagery === 'sky';               // already lying under the map, mirrored
      startSky();
      positionSky(v.lon, v.lat, v.asp);
      anchor = { earthAsp: v.asp, skyAsp: v.asp };
      userZoomed = false;
      var ready;
      if (turn) {
        setOpacity(earthEl, 0, 320);
        if (skyUnder) setOpacity(skyEl, 1, 320);      // soft or not, it arrives whole
        ready = wait(330).then(function () { return turnLayers(560, skyUnder, false); });
      } else {
        // Nothing to turn: a plain crossfade, and the sky unmirrored while hidden.
        ready = (skyUnder ? (setOpacity(skyEl, 0, 200), wait(210)) : Promise.resolve()).then(function () {
          unmirror();
          setOpacity(earthEl, 0, 450); setOpacity(skyEl, 1, 450);
          return wait(460);
        });
      }
      return ready.then(function () {
        face = 'sky'; applyFace(); drawNow();         // same pixels, now in the sky's projection
        if (turn && !skyUnder) { unmirror(); setOpacity(skyEl, 1, 650); return wait(660); }
      }).then(function () {
        var fl = floorAsp(survey());
        if (v.asp < fl) {
          status('Pulling back to the sharpest sky ' + survey().label + ' has here', 2600);
          return animateSkyAsp(v.asp, fl, 850);
        }
      }).then(function () {
        anchor.skyAsp = readSky().asp;
        if (!hintShown && !o.quiet) { hintShown = true; hint('Seen from below, so east is on the left.'); }
        busy = false; el.removeAttribute('data-busy'); settle(); return face;
      });
    }

    function toEarth(o) {
      o = o || {};
      if (busy || face === 'earth') return Promise.resolve(face);
      busy = true; el.setAttribute('data-busy', '');
      closeSheet();
      var s0 = readSky();
      if (o.center) { positionSky(o.center.lon, o.center.lat, s0.asp); drawNow(); s0 = readSky(); }
      // Where the ground should land: the anchor, scaled by the person's own zoom.
      var target = s0.asp;
      if (anchor && anchor.skyAsp > 0) target = anchor.earthAsp * (userZoomed ? s0.asp / anchor.skyAsp : 1);
      // Retrace in the sky first, so the turn lands on exactly that scale.
      var pre = Math.abs(target / s0.asp - 1) > 0.002 ? animateSkyAsp(s0.asp, target, 750) : Promise.resolve();
      var skyUnder = imagery === 'sky';               // the sky stays, mirrored, under the map
      var v, zoom, turn;
      return pre.then(function () {
        v = viewState();
        var want = zoomForAsp(v.asp, v.lat);
        zoom = Math.max(lm.getMinZoom(), Math.min(lm.getMaxZoom(), want));
        turn = Math.abs(zoom - want) < 1e-6 && canTurn(v);
        var snap = lm.options.zoomSnap;
        lm.options.zoomSnap = 0;                      // an exact, fractional zoom
        lm.setView([v.lat, v.lon], zoom, { animate: false });
        lm.options.zoomSnap = snap;
        if (turn) {
          if (!skyUnder) setOpacity(skyEl, 0, 320);
          return wait(330).then(function () { return turnLayers(560, skyUnder, true); });
        }
        setOpacity(skyEl, 0, 450); setOpacity(earthEl, 1, 450);
        return wait(460);
      }).then(function () {
        face = 'earth'; applyFace(); drawNow();
        if (skyUnder) {
          mirrorStatic(); syncSkyToMap(true);
          setOpacity(skyEl, softness(earthAsp()), 500);
        }
        if (turn) { setOpacity(earthEl, 1, 500); return wait(510); }
      }).then(function () {
        if (o.center && earth.dropPin) earth.dropPin(o.center.lat, o.center.lon);
        anchor = null;
        earth.invalidate();
        busy = false; el.removeAttribute('data-busy'); settle(); return face;
      });
    }
    function flip() { return face === 'earth' ? toSky() : toEarth(); }

    // ── events ──
    function onSkyMove() { if (face === 'sky' && !busy) { schedule(); settleSoon(); } }
    var settleTimer = null;
    function settleSoon() { clearTimeout(settleTimer); settleTimer = setTimeout(settle, 350); }
    function settle() {
      if (destroyed) return;
      var v = viewState();
      ensureTiles(v); ensureStars(v); ensureReach(v); findCorners(v); restar(); schedule();
    }
    lm.on('move', function () { if (face === 'earth' && !busy) { syncSkyToMap(false); schedule(); } });
    lm.on('moveend', function () { if (face === 'earth' && !busy && !zoomAnimating) syncSkyToMap(true); });
    lm.on('zoomanim', function (e) {
      if (face !== 'earth' || busy) return;
      // Ride Leaflet's own zoom animation instead of jumping at the end of it.
      var s = lm.getZoomScale(e.zoom);
      var tl = lm.project(lm.containerPointToLatLng([0, 0]), e.zoom)
                 .subtract(lm.project(e.center, e.zoom)).add(lm.getSize().divideBy(2));
      zoomAnimating = true;
      cv.style.transformOrigin = '0 0';
      cv.style.transition = 'transform .25s cubic-bezier(0,0,.25,1)';
      cv.style.transform = 'translate(' + tl.x + 'px,' + tl.y + 'px) scale(' + s + ')';
      if (imagery === 'sky') {
        // The mirrored sky rides the same animation: zoom applied OUTSIDE the mirror.
        skyEl.style.transformOrigin = '0 0';
        skyEl.style.transition = 'transform .25s cubic-bezier(0,0,.25,1), opacity .45s ease';
        skyEl.style.transform = 'translate(' + tl.x + 'px,' + tl.y + 'px) scale(' + s + ') ' + mirrorTransform();
      }
    });
    lm.on('zoomend', function () {
      if (!zoomAnimating) return;
      zoomAnimating = false;
      cv.style.transition = 'none'; cv.style.transform = 'none'; cv.style.transformOrigin = '50% 50%';
      if (imagery === 'sky') { skyEl.style.transition = 'none'; mirrorStatic(); syncSkyToMap(true); }
      drawNow();
    });

    flipBtn.addEventListener('click', function () { flip(); });
    lookBtn.addEventListener('click', function () { toSky(); });
    Array.prototype.forEach.call(segBtns, function (b) {
      b.addEventListener('click', function () { if (!busy) setImagery(b.getAttribute('data-imagery')); });
    });
    surveyBtn.addEventListener('click', function () {
      surveyIdx = (surveyIdx + 1) % SURVEYS.length;
      var sv2 = survey();
      try { if (store) store.setItem('starpin.flip.survey', String(surveyIdx)); } catch (e) {}
      var al = renderer && renderer._aladin ? renderer._aladin() : null;
      if (al && al.setBaseImageLayer) { try { al.setBaseImageLayer(sv2.id); } catch (e) {} }
      applyFace();
      var v = viewState();
      var warn = v.lat < sv2.decMin ? sv2.label + ' does not reach this far south.' : sv2.note;
      status(sv2.label + ': ' + warn, 4200);
    });
    locBtn.addEventListener('click', function () {
      if (!win.navigator || !win.navigator.geolocation) { status('This browser cannot share a location.', 4000); return; }
      status('Finding you\u2026');
      win.navigator.geolocation.getCurrentPosition(function (pos) {
        setFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        recentre();
        locBtn.setAttribute('aria-pressed', 'true');
        status('');
      }, function () { status('Location was not shared.', 4000); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
    });
    infoBtn.addEventListener('click', function () { if (sheet.hidden || sheet.dataset.kind !== 'about') showAbout(); else closeSheet(); });

    // Taps on the sky pick the nearest starpin. Listening on the layer, with a
    // movement threshold, so Aladin's own dragging is left alone.
    var down = null;
    skyEl.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY, t: Date.now() }; }, true);
    skyEl.addEventListener('pointerup', function (e) {
      if (!down || face !== 'sky' || busy) return;
      var moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = Date.now() - down.t;
      down = null;
      if (moved > 8 || dt > 600) return;
      var r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      var v = viewState(), P = projector(v), best = null, bestD = Infinity;
      var hitR = Math.max(22, VISIT_R_ARCSEC / v.asp);
      stars.forEach(function (s) {
        var p = P(s.lat, s.lon); if (!p) return;
        var d = Math.hypot(p[0] - x, p[1] - y);
        if (d < hitR && d < bestD) { best = s; bestD = d; }
      });
      if (best) showStar(best); else closeSheet();
    }, true);

    // Only a person zooms on purpose. Wheel, pinch and double-tap are the ways
    // they can; anything else that changes the field is the renderer's doing.
    skyEl.addEventListener('wheel', function () { if (face === 'sky' && !busy) userZoomed = true; }, { capture: true, passive: true });
    skyEl.addEventListener('touchstart', function (e) {
      if (face === 'sky' && !busy && e.touches && e.touches.length > 1) userZoomed = true;
    }, { capture: true, passive: true });
    skyEl.addEventListener('dblclick', function () { if (face === 'sky' && !busy) userZoomed = true; }, true);

    // ── sheets ──
    function closeSheet() { sheet.hidden = true; sheet.dataset.kind = ''; if (selectedStar) { selectedStar = null; schedule(); } }
    function showStar(s) {
      selectedStar = s; schedule();
      var mag = (s.mag != null && isFinite(s.mag)) ? 'G \u2248 ' + (+s.mag).toFixed(1) : 'brightness not measured';
      var dist = '';
      if (fix && S && S.haversineM) {
        var dm = S.haversineM(fix.lat, fix.lon, s.lat, s.lon);
        dist = '<p>' + (dm < 1000 ? Math.round(dm) + ' m' : (dm / 1000).toFixed(dm < 10000 ? 1 : 0) + ' km') +
               ' from where you are.</p>';
      }
      sheet.innerHTML = '<h3>' + esc(s.name || 'Starpin') + '</h3>' +
        '<div class="sub">' + esc(mag) + ' \u00B7 on the ground at ' + s.lat.toFixed(5) + ', ' + s.lon.toFixed(5) + '</div>' +
        '<div class="reach">' + reachIcon(s.reach) + '<p>' + reachText(s.reach) + '</p></div>' + dist +
        '<div class="row"><button type="button" data-a="down">' + (face === 'sky' ? 'Look down here' : 'Look up here') + '</button>' +
        (opts.onSelect ? '<button type="button" class="quiet" data-a="pick">Choose this starpin</button>' : '') +
        '<button type="button" class="quiet" data-a="close">Close</button></div>';
      sheet.dataset.kind = 'star'; sheet.hidden = false;
      sheet.querySelector('[data-a=down]').onclick = function () {
        var ctr = { center: { lat: s.lat, lon: s.lon } };
        if (face === 'sky') toEarth(ctr); else toSky(ctr);
      };
      var pk = sheet.querySelector('[data-a=pick]');
      if (pk) pk.onclick = function () { opts.onSelect({ kind: 'star', data: s }); closeSheet(); };
      sheet.querySelector('[data-a=close]').onclick = closeSheet;
    }
    function showAbout() {
      var sv3 = survey();
      sheet.innerHTML = '<div class="spf-about"><h3>One place, two faces</h3>' +
        '<p>The sky and the ground are drawn at one scale: 1\u2033 of sky is ' +
        M_PER_ARCSEC.toFixed(2) + ' m of ground, at every latitude. Declination is latitude and right ' +
        'ascension is longitude, so these streets sit under exactly these stars.</p>' +
        '<p>On the sky the streets are seen from below, the way you would see a map painted on glass ' +
        'overhead, so east is on the left.</p>' +
        '<p>Each ring is a starpin\u2019s ' + VISIT_R_ARCSEC + '\u2033 (' + Math.round(VISIT_R_ARCSEC * M_PER_ARCSEC) +
        ' m) circle. Solid: a mapped street or path passes through it. Dashed: nothing mapped does, so it ' +
        'may be behind a fence or in water. Faint: zoom in for street detail. This comes from OpenStreetMap ' +
        'and is a hint, not a rule.</p>' +
        '<p>Sky surveys run out of detail close in. When the ground is closer than ' + sv3.label +
        ' can show, the sky pulls back, and looking down puts you back where you were.</p>' +
        '<p>What this view sends: the area you are looking at goes to OpenStreetMap\u2019s Overpass server ' +
        'for streets and to CDS Strasbourg for stars and sky images.</p>' +
        '<p style="opacity:.75;font-size:.78rem">Streets \u00A9 OpenStreetMap contributors (ODbL). ' +
        'Sky: Aladin Lite, CDS Strasbourg; ' + esc(sv3.credit) + '.</p>' +
        '<div class="row"><button type="button" class="quiet" data-a="close">Close</button></div></div>';
      sheet.dataset.kind = 'about'; sheet.hidden = false;
      sheet.querySelector('[data-a=close]').onclick = closeSheet;
    }

    // ── public setters ──
    function setFix(lat, lon, acc) {
      fix = { lat: lat, lon: lon, accuracy_m: acc };
      earth.setFix(lat, lon, acc);
      schedule();
    }
    function recentre() {
      if (!fix) return;
      if (face === 'earth') lm.setView([fix.lat, fix.lon], lm.getZoom());
      else { positionSky(fix.lon, fix.lat, readSky().asp); schedule(); }
      settleSoon();
    }

    var ro = null;
    if (win.ResizeObserver) {
      ro = new win.ResizeObserver(function () { earth.invalidate(); if (face === 'earth' && imagery === 'sky') { mirrorStatic(); syncSkyToMap(true); } schedule(); });
      ro.observe(el);
    }

    // ── start ──
    earthEl.style.opacity = face === 'earth' ? '1' : '0';
    skyEl.style.opacity = face === 'sky' ? '1' : '0';
    if (opts.locate === false) locBtn.style.display = 'none';   // the host owns geolocation
    applyFace();
    if (face === 'sky') {
      // Opening on the sky: the matched scale, pulled back if the survey needs
      // it, anchored so the first "Look down" lands on the ground as given.
      var a0 = sky.asp, fl0 = floorAsp(survey());
      startSky();
      positionSky(sky.ra, sky.dec, Math.max(a0, fl0));
      anchor = { earthAsp: a0, skyAsp: readSky().asp };
      drawNow();
    } else {
      // The default: the map, with whatever lies under it -- the sky, unless the
      // person last chose the ground.
      setImagery(imagery, true);
    }
    setTimeout(function () { earth.invalidate(); settle(); }, 60);

    return {
      el: el, earth: earth, leaflet: lm,
      face: function () { return face; },
      flip: flip, toSky: toSky, toEarth: toEarth,
      imagery: function () { return imagery; }, setImagery: function (k) { setImagery(k, true); },
      renderer: function () { return renderer; }, rendererKind: function () { return rendererKind; },
      setFix: setFix, recentre: recentre,
      setStars: setStars, stars: function () { return stars.slice(); },
      setFinds: function (list) { finds = (list || []).slice(); earth.setFinds(finds); schedule(); },
      // Bagged cornerstones by name: the map ticks them, the halos turn green.
      setBagged: function (names) {
        bagged = {}; (names || []).forEach(function (n) { bagged[n] = 1; });
        earth.setBagged(names); schedule();
      },
      setStreets: function (on) { streetsOn = !!on; if (on) settle(); schedule(); },
      view: viewState, redraw: schedule,
      destroy: function () {
        destroyed = true;
        if (ro) ro.disconnect();
        earth.destroy();
        if (el.parentNode) el.parentNode.removeChild(el);
      },
      _test: { tiles: function () { return tiles; }, corners: function () { return corners; }, readSky: readSky, anchor: function () { return anchor; },
               project: function (lat, lon) { return projector(viewState())(lat, lon); },
               userZoomed: function (v) { if (v !== undefined) userZoomed = v; return userZoomed; } }
    };
  }

  return {
    VERSION: '0.4', mount: mount, SURVEYS: SURVEYS, VISIT_R_ARCSEC: VISIT_R_ARCSEC, CORNER_BAG_M: CORNER_BAG_M,
    wrap360: wrap360, wrapNear: wrapNear, aspForZoom: aspForZoom, zoomForAsp: zoomForAsp,
    skyProjector: skyProjector, tangentOf: tangentOf, fromTangent: fromTangent, sepArcsec: sepArcsec, scaleBar: scaleBar, cellSideM: cellSideM, haloM: haloM, reachFromGeos: reachFromGeos,
    nearestLineM: nearestLineM, floorAsp: floorAsp
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpinFlip;
