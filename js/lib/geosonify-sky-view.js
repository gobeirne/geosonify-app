/*
  geosonify-sky-view.js  v0.1  — the in-app sky view

  A full-screen overlay. Deliberately NOT a change to the map pane: it mounts
  itself over everything, and closing it leaves the app exactly as it was. One
  script tag, no mount div, no edits to card-renderer.js, no change to layout.

  Composition, not inheritance from anything:
    geosonify-sky-renderer.js   the canvas and the projection
    geosonify-sky-overlay.js    geometry -> screen paths
    geosonify-sky.js            the maths and the cell addresses

  The renderer is behind a contract, so an Aladin-backed renderer can be dropped
  in later without touching a line of this file. Geosonify owns the chrome, the
  readouts, the styling and the depth honesty; a renderer only ever answers
  "where on screen is this (ra, dec)?".

  PRIVACY: the view shows the true cell of the current pin, so it redacts under
  passphrase or obfuscation exactly as the sky panel does. Same rule, same
  reason, and it is the whole reason a "just show the sky" view cannot skip it.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var RAMP = ['#475569', '#64748b', '#94a3b8', '#cbd5e1', '#e2e8f0'];
  var ACCENT = '#f87171';
  var REDACT = '\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588';
  var MIN_ORDER = 1, MAX_ORDER = 52;

  var host = null, renderer = null, els = null;
  var order = 16;
  var mark = null;

  function _Sky() {
    try { if (typeof GeosonifySky !== 'undefined' && GeosonifySky) return GeosonifySky; } catch (e) {}
    return global.GeosonifySky || null;
  }
  function _Overlay() { return global.GeosonifySkyOverlay || null; }
  function _RendererLib() { return global.GeosonifySkyRenderer || null; }
  function _HP() {
    var S = _Sky();
    if (S && S.getEngine && S.getEngine()) return S.getEngine();
    try { if (typeof HealpixGrids !== 'undefined' && HealpixGrids) return HealpixGrids; } catch (e) {}
    return global.HealpixGrids || null;
  }
  function _privacyOn() {
    var cr = global.CardRenderer;
    if (!cr) return false;
    var p = '', o = false;
    try { p = cr.getPassphrase ? (cr.getPassphrase() || '') : ''; } catch (e) {}
    try { o = cr.isObfuscated ? !!cr.isObfuscated() : false; } catch (e) {}
    return !!(p || o);
  }

  function isAvailable() {
    return !!(_Sky() && _Overlay() && _RendererLib() && _HP());
  }

  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) e.setAttribute('style', style);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function build() {
    host = el('div',
      'position:fixed; inset:0; z-index:9999; background:#0b0f19; color:#e5e7eb; ' +
      'display:flex; flex-direction:column; ' +
      'font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;');

    // ── header: Geosonify's chrome, not the renderer's ──
    var bar = el('div', 'display:flex; align-items:center; gap:10px; padding:9px 12px; ' +
                        'border-bottom:1px solid #1f2937; flex:0 0 auto;');
    bar.appendChild(el('span', 'font-weight:600;', 'Sky'));
    var frameTag = el('span', 'font-size:11px; color:#94a3b8;');
    bar.appendChild(frameTag);

    var stepWrap = el('div', 'margin-left:auto; display:flex; align-items:center; gap:6px;');
    var btnStyle = 'width:30px; height:30px; border:1px solid #1f2937; border-radius:6px; ' +
                   'background:transparent; color:#e5e7eb; font-size:16px; line-height:1; cursor:pointer;';
    var minus = el('button', btnStyle, '\u2212');
    var plus = el('button', btnStyle, '+');
    var orderTxt = el('span', 'font-size:12px; min-width:62px; text-align:center; color:#cbd5e1;');
    minus.setAttribute('aria-label', 'Coarser cell');
    plus.setAttribute('aria-label', 'Finer cell');
    stepWrap.appendChild(minus); stepWrap.appendChild(orderTxt); stepWrap.appendChild(plus);
    var close = el('button', btnStyle + ' margin-left:6px;', '\u2715');
    close.setAttribute('aria-label', 'Close sky view');
    stepWrap.appendChild(close);
    bar.appendChild(stepWrap);
    host.appendChild(bar);

    // ── the renderer's container ──
    var canvasWrap = el('div', 'flex:1 1 auto; min-height:0; position:relative;');
    host.appendChild(canvasWrap);

    // ── readouts ──
    var foot = el('div', 'flex:0 0 auto; border-top:1px solid #1f2937; padding:8px 12px; ' +
                         'display:flex; flex-wrap:wrap; gap:4px 18px; align-items:baseline;');
    var mono = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px;';
    var posTxt = el('span', mono);
    var quadTxt = el('span', mono + ' color:' + ACCENT + '; word-break:break-all;');
    var mocTxt = el('span', mono + ' color:#94a3b8;');
    var sizeTxt = el('span', 'font-size:11.5px; color:#94a3b8;');
    var legTxt = el('span', 'font-size:11.5px; color:#94a3b8; flex-basis:100%;');
    [posTxt, quadTxt, mocTxt, sizeTxt, legTxt].forEach(function (n) { foot.appendChild(n); });
    host.appendChild(foot);

    document.body.appendChild(host);

    els = {
      host: host, canvasWrap: canvasWrap, frameTag: frameTag, orderTxt: orderTxt,
      posTxt: posTxt, quadTxt: quadTxt, mocTxt: mocTxt, sizeTxt: sizeTxt, legTxt: legTxt,
      minus: minus, plus: plus, close: close
    };

    minus.onclick = function () { order = Math.max(MIN_ORDER, order - 1); draw(); };
    plus.onclick = function () { order = Math.min(MAX_ORDER, order + 1); draw(); };
    close.onclick = function () { closeView(); };
  }

  function boundaryOf(cell) {
    return _Sky().cellBoundary(cell.order, cell.ipix, { step: 6, close: true, frame: 'sky' });
  }

  function draw() {
    if (!renderer || !els) return;
    var Sky = _Sky(), Overlay = _Overlay(), HP = _HP();
    var g = renderer.overlayGroup();
    while (g.firstChild) g.removeChild(g.firstChild);

    var redact = _privacyOn();

    // Dec -> lat, RA -> lon: the same HEALPix construction, celestial frame.
    var ipix = BigInt(HP.nestIndex(mark.dec, mark.ra, order));
    var cell = Sky.ipixToCell(order, ipix);
    var moc = Sky.toMoc(cell);
    var chain = Sky.ancestry(order, ipix, { fromOrder: Math.max(0, order - 6) });

    var picked = Overlay.pickVisible(chain, boundaryOf, renderer.project,
                                     { viewport: renderer.getSize(), minPx: 5 });

    picked.draw.forEach(function (entry, i) {
      var deepest = entry === picked.deepest;
      var p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', Overlay.ringToPath(entry.projected));
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', deepest ? ACCENT : RAMP[Math.min(RAMP.length - 1, i)]);
      p.setAttribute('stroke-width', deepest ? 1.8 : 1.1);
      p.setAttribute('stroke-linejoin', 'round');
      g.appendChild(p);
    });

    var mp = renderer.project(mark.ra, mark.dec);
    if (mp) {
      ['M' + (mp[0] - 7) + ' ' + mp[1] + 'H' + (mp[0] + 7),
       'M' + mp[0] + ' ' + (mp[1] - 7) + 'V' + (mp[1] + 7)].forEach(function (d) {
        var l = document.createElementNS(SVGNS, 'path');
        l.setAttribute('d', d);
        l.setAttribute('stroke', ACCENT);
        l.setAttribute('stroke-width', '1');
        g.appendChild(l);
      });
    }

    var dp = Sky.autoDecimals(order, mark.dec);
    els.orderTxt.textContent = 'order ' + order;
    els.sizeTxt.textContent = Sky.cellSize(order).text + ' cell';
    els.frameTag.textContent = 'ICRS \u00b7 shown on a Geosonify canvas';

    if (redact) {
      els.posTxt.textContent = REDACT;
      els.quadTxt.textContent = REDACT;
      els.mocTxt.textContent = 'Hidden while privacy mode is active';
      els.legTxt.textContent = '';
      return;
    }

    els.posTxt.textContent = Sky.formatRA(mark.ra, { decimals: dp.ra }) + '  ' +
                             Sky.formatDec(mark.dec, { decimals: dp.dec, unicode: true });
    els.quadTxt.textContent = cell.quaternary;
    els.mocTxt.textContent = moc.moc + (moc.standard ? '' : '  \u2190 past order 29');
    els.legTxt.textContent = Overlay.legibility(picked, order, {
      maxResolvableOrder: renderer.capabilities().maxResolvableOrder
    });
  }

  function openView(opts) {
    opts = opts || {};
    if (!isAvailable()) {
      if (global.showToast) global.showToast('Sky modules not loaded', 'error');
      return false;
    }
    if (host) return true;

    // Start from the current pin, read as a celestial direction.
    var c = (global.AppState && global.AppState.get) ? global.AppState.get('coordinate') : null;
    var lat = opts.dec !== undefined ? opts.dec : (c && c.lat !== null && c.lat !== undefined ? c.lat : 0);
    var lon = opts.ra !== undefined ? opts.ra : (c && c.lon !== null && c.lon !== undefined ? c.lon : 0);
    mark = { ra: ((lon % 360) + 360) % 360, dec: lat };
    if (opts.order) order = Math.max(MIN_ORDER, Math.min(MAX_ORDER, opts.order));

    build();

    renderer = _RendererLib().createBuiltInRenderer(els.canvasWrap, {
      ra: mark.ra, dec: mark.dec, fovDeg: opts.fovDeg || 1.5, background: '#0b0f19'
    });
    renderer.init();
    renderer.on('move', draw);
    renderer.on('zoom', draw);
    renderer.on('resize', draw);
    renderer.on('click', function (p) { mark.ra = p.ra; mark.dec = p.dec; draw(); });

    document.addEventListener('keydown', onKey);
    draw();
    return true;
  }

  function onKey(ev) { if (ev.key === 'Escape') closeView(); }

  function closeView() {
    document.removeEventListener('keydown', onKey);
    if (renderer) { try { renderer.destroy(); } catch (e) {} renderer = null; }
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null; els = null;
    return true;
  }

  function isOpen() { return !!host; }

  var API = {
    VERSION: VERSION,
    isAvailable: isAvailable,
    open: openView,
    close: closeView,
    isOpen: isOpen,
    redraw: draw,
    setOrder: function (k) { order = Math.max(MIN_ORDER, Math.min(MAX_ORDER, k)); draw(); },
    getOrder: function () { return order; }
  };

  global.GeosonifySkyView = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
