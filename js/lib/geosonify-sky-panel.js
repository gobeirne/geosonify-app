/*
  geosonify-sky-panel.js  v0.1  — S1 read-only sky readout panel

  Self-contained UI. Builds its own DOM inside one empty mount div and reads
  state through published accessors only. Touches no existing render path, no
  card, no URL, no frozen format. Removing it = deleting one script tag and one
  empty div.

  WIRING (the whole integration):
    1. index.html, after the coord-bar div:   <div id="skyPanelMount"></div>
    2. index.html, after geosonify-sky.js:    <script src="js/lib/geosonify-sky-panel.js"></script>

  DEPENDENCIES (all probed defensively; the panel simply doesn't appear if any
  are missing, rather than throwing during startup):
    GeosonifySky   — the pure sky maths
    HealpixGrids   — bare top-level const, NOT window.*; see probe below
    AppState       — coordinate subscription
    CardRenderer   — getPassphrase() / isObfuscated() for privacy redaction

  PRIVACY (load-bearing, do not "simplify"):
    This panel shows the TRUE cell and TRUE RA/Dec derived straight from the
    coordinate. Under passphrase or obfuscation that would leak the real location
    the privacy mode exists to hide, exactly as an un-redacted Plus Code would.
    So it redacts under either mode, mirroring the GIS-card rule in
    card-renderer.js (~line 2880). HEALPix *cards* are never redacted because
    they transform properly; this panel is not a card and does not transform.

  PRECISION:
    Uses HealpixGrids.nestIndex on the AppState double coordinate — the same
    path the HEALPix cards use — so the panel always agrees with the cards.
    The exact point (GeosonifyMain.getExact() / GeoPrecision) would be needed
    for a code that claimed to carry more than the projection resolves; this
    panel only reads, and says so.

  COLLAPSE:
    Deliberately NOT class="collapsible-card". That mechanism attaches its own
    click handler at DOMContentLoaded and only collapses below 1024px, so
    reusing it would double-toggle and leave the panel permanently open on
    desktop. This uses its own key and its own handler, and starts collapsed at
    every width.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.2';
  var MOUNT_ID = 'skyPanelMount';
  var ENABLE_KEY = 'geosonify-sky-enabled';
  var STORAGE_KEY = 'geosonify-sky-panel-open';
  var ORDER_KEY = 'geosonify-sky-panel-order';
  var DEFAULT_ORDER = 22;
  var MIN_ORDER = 1;
  var MAX_ORDER = 73;
  var STANDARD_MOC_MAX = 29;
  var REDACT = '\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588';

  /*
    INGESTION LIMIT (not an address limit).
    nestIndex's deep path extracts one x bit and one y bit per quaternary digit
    by repeatedly doubling a pair of doubles. A double carries ~52 mantissa bits,
    so after 52 digits both values are exactly 0 and every later digit is a
    literal zero -- padding that looks like measurement. Verified: the tail is
    all zeros from digit 52 for every coordinate tested, at every order above it.

    The ADDRESS layer has no ceiling -- an order-66 code handed to us round-trips
    exactly. Only deriving a code from a double coordinate ceilings here.

    Data-dependent by +/-1 (a genuine zero digit at 51 is indistinguishable from
    padding). The real fix is ingesting through GeoPrecision's Decimal path
    (geosonify-precision.js, 120 significant digits); that is deliberate later
    work, not a tweak.
  */
  var INGESTION_ORDER_LIMIT = 52;

  var els = null;
  var order = DEFAULT_ORDER;
  var isOpen = false;
  var clockTimer = null;
  var unsubscribe = null;

  // ---- dependency probes -------------------------------------------------
  function _Sky() {
    try { if (typeof GeosonifySky !== 'undefined' && GeosonifySky) return GeosonifySky; } catch (e) {}
    return global.GeosonifySky || null;
  }
  function _HP() {
    // geosonify-healpix.js exposes a bare top-level const, not window.HealpixGrids.
    try { if (typeof HealpixGrids !== 'undefined' && HealpixGrids) return HealpixGrids; } catch (e) {}
    return global.HealpixGrids || null;
  }
  function _toast(msg, style) {
    try { if (typeof showToast === 'function') { showToast(msg, style); return; } } catch (e) {}
    if (global.showToast) global.showToast(msg, style);
  }
  function _privacyOn() {
    var cr = global.CardRenderer;
    if (!cr) return false;
    var pass = '', obf = false;
    try { pass = cr.getPassphrase ? (cr.getPassphrase() || '') : ''; } catch (e) {}
    try { obf = cr.isObfuscated ? !!cr.isObfuscated() : false; } catch (e) {}
    return !!(pass || obf);
  }
  function _coord() {
    if (global.AppState && global.AppState.get) {
      var c = global.AppState.get('coordinate');
      if (c && c.lat !== null && c.lat !== undefined && c.lon !== null && c.lon !== undefined) return c;
    }
    return null;
  }

  // ---- pure compute (exported for Node testing; no DOM) -----------------
  /*
    Returns everything the panel displays, or { unavailable: reason }.
    Kept pure so the numbers can be gated without a browser.
  */
  function compute(lat, lon, k, date) {
    var Sky = _Sky(), HP = _HP();
    if (!Sky) return { unavailable: 'GeosonifySky not loaded' };
    if (!HP || !HP.nestIndex) return { unavailable: 'HealpixGrids not loaded' };
    if (lat === null || lat === undefined || lon === null || lon === undefined) {
      return { unavailable: 'no coordinate yet' };
    }

    var ipix = BigInt(HP.nestIndex(lat, lon, k));
    var cell = Sky.ipixToCell(k, ipix);
    var moc = Sky.toMoc(cell);
    var size = Sky.cellSize(k);
    var zen = Sky.zenith(lat, lon, date || new Date());

    var out = {
      order: k,
      lat: lat, lon: lon,
      quaternary: cell.quaternary,
      ipix: ipix,
      // The same cell read as a celestial address: lat -> Dec, lon -> RA.
      skyRA: Sky.formatRA(lon),
      skyDec: Sky.formatDec(lat, { unicode: true }),
      designation: Sky.designation(lon, lat),
      cellSize: size.text,
      areaDeg2: size.areaDeg2,
      moc: moc.moc,
      nuniq: moc.nuniq.toString(),
      standard: moc.standard,
      zenithRA: zen.ra,
      zenithDec: zen.dec,
      zenithFrame: zen.frame,
      zenithCaveat: zen.caveat,
      utc: (date || new Date()).toISOString().slice(11, 16) + ' UTC'
    };

    // Past order 29 there is no legal MOC spelling. Offer the standard ancestor
    // and state the area penalty; never present it as equivalent.
    if (!moc.standard) {
      var ap = Sky.mocApprox(k, ipix, STANDARD_MOC_MAX);
      out.approx = {
        moc: ap.moc,
        areaFactor: ap.areaFactor.toString(),
        note: 'order ' + STANDARD_MOC_MAX + ' ancestor, ' + ap.areaFactor.toString() + '\u00d7 the area'
      };
      out.bits = ipix.toString(2).length;
    }

    // Past the double-precision ingestion limit the deep digits are padding.
    // Say so rather than letting a run of zeros pass for measurement.
    if (k > INGESTION_ORDER_LIMIT) {
      out.paddedDigits = k - INGESTION_ORDER_LIMIT;
      out.informativeOrder = INGESTION_ORDER_LIMIT;
    }
    return out;
  }

  // ---- DOM ---------------------------------------------------------------

  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) e.setAttribute('style', style);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  var S = {
    label: 'font-size:11px; color:var(--ios-gray,#8E8E93); margin:0 0 2px;',
    sub: 'font-size:10.5px; color:var(--ios-gray,#8E8E93); margin:0 0 6px;',
    value: 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:14px; color:var(--ios-text,#000);',
    small: 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; color:var(--ios-secondary,#3C3C43);',
    block: 'padding:10px 12px; border-top:1px solid var(--ios-separator,#C6C6C8);',
    row: 'display:flex; align-items:center; gap:8px;',
    copy: 'margin-left:auto; border:none; background:transparent; cursor:pointer; font-size:13px; padding:2px 4px; color:var(--ios-gray,#8E8E93);',
    step: 'width:28px; height:28px; border:1px solid var(--ios-separator,#C6C6C8); border-radius:6px; background:transparent; color:var(--ios-text,#000); cursor:pointer; font-size:15px; line-height:1;'
  };

  function copyRow(labelText, getValue) {
    var wrap = el('div', 'display:flex; align-items:baseline; gap:8px; padding:2px 0;');
    var lab = el('span', 'font-size:11px; color:var(--ios-gray,#8E8E93); flex:0 0 74px;', labelText);
    var val = el('span', S.small + ' word-break:break-all; flex:1 1 auto;');
    var btn = el('button', S.copy, '\u29c9');
    btn.setAttribute('aria-label', 'Copy ' + labelText);
    btn.onclick = function (ev) {
      ev.stopPropagation();
      var v = getValue();
      if (!v || v === REDACT) { _toast('Hidden while privacy mode is active', 'error'); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(v).then(function () { _toast(labelText + ' copied'); },
                                              function () { _toast('Copy failed', 'error'); });
      } else { _toast('Clipboard unavailable', 'error'); }
    };
    wrap.appendChild(lab); wrap.appendChild(val); wrap.appendChild(btn);
    return { wrap: wrap, val: val };
  }

  function build(mount) {
    var card = el('div', 'border:1px solid var(--ios-separator,#C6C6C8); border-radius:10px; ' +
                         'background:var(--ios-card,#fff); margin:0 0 12px; overflow:hidden;');

    var header = el('div', 'display:flex; align-items:center; gap:8px; padding:9px 12px; cursor:pointer; ' +
                           'user-select:none; background:var(--ios-light-gray,#F2F2F7);');
    var chev = el('span', 'font-size:12px; color:var(--ios-gray,#8E8E93); transition:transform .15s;', '\u25b8');
    var title = el('span', 'font-size:14px; font-weight:600; color:var(--ios-text,#000);', 'Sky');
    var badge = el('span', 'margin-left:auto; font-size:11px; color:var(--ios-gray,#8E8E93); ' +
                           'font-family:ui-monospace,monospace;', 'read-only');
    header.appendChild(chev); header.appendChild(title); header.appendChild(badge);

    var body = el('div', 'display:none;');

    // order stepper
    var stepRow = el('div', 'display:flex; align-items:center; gap:8px; padding:10px 12px;');
    var minus = el('button', S.step, '\u2212');
    var plus = el('button', S.step, '+');
    var orderTxt = el('span', 'font-size:13px; color:var(--ios-text,#000); min-width:64px; text-align:center;');
    var sizeTxt = el('span', 'margin-left:auto; font-size:12px; color:var(--ios-gray,#8E8E93); ' +
                             'font-family:ui-monospace,monospace;');
    minus.setAttribute('aria-label', 'Coarser cell');
    plus.setAttribute('aria-label', 'Finer cell');
    stepRow.appendChild(minus); stepRow.appendChild(orderTxt); stepRow.appendChild(plus); stepRow.appendChild(sizeTxt);
    body.appendChild(stepRow);

    // block 1 — the cell as a sky address
    var b1 = el('div', S.block);
    b1.appendChild(el('p', S.label, 'This cell read as a sky address'));
    b1.appendChild(el('p', S.sub, 'frame ICRS \u00b7 same HEALPix cell, celestial sphere'));
    var pos = el('div', S.row);
    var posVal = el('span', S.value);
    var posCopy = el('button', S.copy, '\u29c9');
    posCopy.setAttribute('aria-label', 'Copy sky position');
    pos.appendChild(posVal); pos.appendChild(posCopy);
    b1.appendChild(pos);
    var desig = el('div', S.small + ' margin-top:3px;');
    b1.appendChild(desig);
    body.appendChild(b1);

    // block 2 — interop
    var b2 = el('div', S.block);
    b2.appendChild(el('p', S.label, 'Interoperability'));
    var rMoc = copyRow('MOC', function () { return rMoc.val.textContent; });
    var rNuniq = copyRow('NUNIQ', function () { return rNuniq.val.textContent; });
    var rQuad = copyRow('Quaternary', function () { return rQuad.val.textContent; });
    b2.appendChild(rMoc.wrap); b2.appendChild(rNuniq.wrap); b2.appendChild(rQuad.wrap);
    body.appendChild(b2);

    // block 3 — non-standard depth warning (hidden unless order > 29)
    var warn = el('div', S.block + ' display:none; background:rgba(255,159,10,0.10);');
    var warnTxt = el('p', 'font-size:11.5px; line-height:1.45; margin:0; color:var(--ios-secondary,#3C3C43);');
    var warnRow = copyRow('Std. MOC', function () { return warnRow.val.textContent; });
    warn.appendChild(warnTxt); warn.appendChild(warnRow.wrap);
    body.appendChild(warn);

    // block 3b — ingestion padding notice (hidden unless order > 52)
    var pad = el('div', S.block + ' display:none;');
    var padTxt = el('p', 'font-size:11.5px; line-height:1.45; margin:0; color:var(--ios-secondary,#3C3C43);');
    pad.appendChild(padTxt);
    body.appendChild(pad);

    // block 4 — zenith
    var b4 = el('div', S.block);
    b4.appendChild(el('p', S.label, 'Overhead here, now'));
    var zSub = el('p', S.sub);
    b4.appendChild(zSub);
    var zVal = el('span', S.value);
    b4.appendChild(zVal);
    body.appendChild(b4);

    // footer
    var foot = el('div', S.block + ' background:var(--ios-light-gray,#F2F2F7);');
    foot.appendChild(el('p', 'font-size:10.5px; line-height:1.45; margin:0; color:var(--ios-gray,#8E8E93);',
      'Read-only. Nothing here is shared or encoded \u2014 no format is fixed yet.'));
    body.appendChild(foot);

    card.appendChild(header); card.appendChild(body);
    mount.appendChild(card);

    els = {
      card: card, header: header, chev: chev, body: body, badge: badge,
      minus: minus, plus: plus, orderTxt: orderTxt, sizeTxt: sizeTxt,
      posVal: posVal, posCopy: posCopy, desig: desig,
      rMoc: rMoc, rNuniq: rNuniq, rQuad: rQuad,
      warn: warn, warnTxt: warnTxt, warnRow: warnRow,
      pad: pad, padTxt: padTxt,
      zSub: zSub, zVal: zVal
    };

    header.onclick = function () { setOpen(!isOpen); };
    minus.onclick = function (e) { e.stopPropagation(); setOrder(order - 1); };
    plus.onclick = function (e) { e.stopPropagation(); setOrder(order + 1); };
    posCopy.onclick = function (e) {
      e.stopPropagation();
      var v = posVal.textContent;
      if (!v || v === REDACT) { _toast('Hidden while privacy mode is active', 'error'); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(v).then(function () { _toast('Position copied'); });
    };
  }

  // ---- state -------------------------------------------------------------

  function setOpen(open) {
    isOpen = !!open;
    els.body.style.display = isOpen ? 'block' : 'none';
    els.chev.textContent = isOpen ? '\u25be' : '\u25b8';
    try { localStorage.setItem(STORAGE_KEY, isOpen ? '1' : '0'); } catch (e) {}
    if (isOpen) { render(); startClock(); } else { stopClock(); }
  }

  function setOrder(k) {
    k = Math.max(MIN_ORDER, Math.min(MAX_ORDER, k | 0));
    order = k;
    try { localStorage.setItem(ORDER_KEY, String(k)); } catch (e) {}
    render();
  }

  // The zenith moves; nothing else does. Only tick while expanded.
  function startClock() {
    stopClock();
    clockTimer = setInterval(function () { if (isOpen) render(); }, 60000);
  }
  function stopClock() { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } }

  // ---- render ------------------------------------------------------------

  function render() {
    if (!els || !isOpen) return;

    els.orderTxt.textContent = 'order ' + order;

    var c = _coord();
    if (!c) {
      els.badge.textContent = 'no point yet';
      setAll('\u2014');
      els.sizeTxt.textContent = '';
      els.warn.style.display = 'none';
      els.pad.style.display = 'none';
      els.zSub.textContent = '';
      return;
    }

    // Privacy: this panel reveals the true position, so it redacts like a GIS card.
    if (_privacyOn()) {
      els.badge.textContent = 'hidden \u2014 privacy mode';
      setAll(REDACT);
      els.sizeTxt.textContent = '';
      els.desig.textContent = '';
      els.warn.style.display = 'none';
      els.pad.style.display = 'none';
      els.zSub.textContent = 'Turn off passphrase / obfuscation to show';
      return;
    }

    var r;
    try { r = compute(c.lat, c.lon, order, new Date()); }
    catch (e) { els.badge.textContent = 'error'; setAll('\u2014'); return; }

    if (r.unavailable) { els.badge.textContent = r.unavailable; setAll('\u2014'); return; }

    els.badge.textContent = 'read-only';
    els.sizeTxt.textContent = r.cellSize;
    els.posVal.textContent = r.skyRA + '  ' + r.skyDec;
    els.desig.textContent = r.designation;
    els.rMoc.val.textContent = r.moc;
    els.rNuniq.val.textContent = r.nuniq;
    els.rQuad.val.textContent = r.quaternary;

    if (r.standard) {
      els.warn.style.display = 'none';
    } else {
      els.warn.style.display = 'block';
      var msg = 'Order ' + r.order + ' is beyond the MOC standard\u2019s order-' + STANDARD_MOC_MAX +
        ' ceiling \u2014 this index needs ' + r.bits + ' bits and will not fit the 64-bit integer ' +
        'healpy and mocpy use. The cell above is exact; the fallback below is its ' +
        r.approx.areaFactor + '\u00d7 larger order-' + STANDARD_MOC_MAX + ' ancestor.';
      // Verified against mocpy 0.20.0: order 30 is accepted WITHOUT error and
      // silently mis-parsed to "0/32-47 29/" -- sixteen base cells, most of the
      // sky. Order 31+ is refused cleanly. A refusal is safe; silent whole-sky
      // corruption is not, so order 30 gets its own warning.
      if (r.order === 30) {
        msg += ' Order 30 is the worst case: mocpy accepts it with no error and ' +
               'silently returns a near-whole-sky region. Use the fallback, not this.';
      }
      els.warnTxt.textContent = msg;
      els.warnRow.val.textContent = r.approx.moc;
    }

    if (r.paddedDigits) {
      els.pad.style.display = 'block';
      els.padTxt.textContent =
        'The last ' + r.paddedDigits + ' digit' + (r.paddedDigits === 1 ? '' : 's') +
        ' are padding, not measurement. The coordinate is a double, which carries ' +
        'about ' + r.informativeOrder + ' quaternary digits; past that the code is ' +
        'a valid contained cell but tells you nothing more about where you are.';
    } else {
      els.pad.style.display = 'none';
    }

    els.zSub.textContent = r.zenithFrame + ' \u00b7 ' + r.utc + ' \u00b7 not ICRS (\u22480.35\u00b0 precession)';
    els.zVal.textContent = r.zenithRA + '  ' + r.zenithDec;
  }

  function setAll(text) {
    els.posVal.textContent = text;
    els.rMoc.val.textContent = text;
    els.rNuniq.val.textContent = text;
    els.rQuad.val.textContent = text;
    els.zVal.textContent = text;
  }

  // ---- init --------------------------------------------------------------

  /*
    OPT-IN GATE.
    Hidden unless localStorage['geosonify-sky-enabled'] === '1'. Deliberately NOT
    a URL param: any query param at all suppresses the splash screen and the
    random initial location, so ?sky=1 would silently change startup behaviour.
    A localStorage flag has no such side effect and never reaches a shared link.

    Turn on:   GeosonifySkyPanel.enable()
    Turn off:  GeosonifySkyPanel.disable()
    Both take effect immediately; no reload needed.
  */
  function _enabled() {
    try { return localStorage.getItem(ENABLE_KEY) === '1'; } catch (e) { return false; }
  }

  function enable() {
    try { localStorage.setItem(ENABLE_KEY, '1'); } catch (e) {}
    var built = init({ force: true });
    if (built) setOpen(true);
    console.log('[geosonify] sky panel enabled' + (built ? '' : ' (mount div missing)'));
    return built;
  }

  function disable() {
    try { localStorage.setItem(ENABLE_KEY, '0'); } catch (e) {}
    destroy();
    console.log('[geosonify] sky panel hidden');
    return true;
  }

  function init(opts) {
    opts = opts || {};
    if (!opts.force && !_enabled()) return false;   // muggle-safe default
    var mount = document.getElementById(opts.mountId || MOUNT_ID);
    if (!mount) return false;                 // not wired in; stay silent
    if (els) return true;                     // already built

    if (!_Sky() || !_HP()) {
      console.warn('[geosonify] sky-panel: dependencies missing, panel not shown');
      return false;
    }

    try {
      var k = parseInt(localStorage.getItem(ORDER_KEY), 10);
      if (k >= MIN_ORDER && k <= MAX_ORDER) order = k;
    } catch (e) {}

    build(mount);

    var wasOpen = false;
    try { wasOpen = localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) {}
    setOpen(wasOpen);                          // collapsed unless previously opened

    if (global.AppState && global.AppState.subscribe) {
      unsubscribe = global.AppState.subscribe('coordinate', function () { render(); });
    }
    console.log('[geosonify] sky-panel ' + VERSION + ' ready');
    return true;
  }

  function destroy() {
    stopClock();
    if (unsubscribe) { try { unsubscribe(); } catch (e) {} unsubscribe = null; }
    if (els && els.card && els.card.parentNode) els.card.parentNode.removeChild(els.card);
    els = null;
  }

  var API = {
    VERSION: VERSION,
    init: init, destroy: destroy, render: render,
    enable: enable, disable: disable,
    isEnabled: _enabled,
    INGESTION_ORDER_LIMIT: INGESTION_ORDER_LIMIT,
    setOrder: setOrder, setOpen: setOpen,
    compute: compute,                          // pure, testable without a DOM
    getOrder: function () { return order; }
  };

  global.GeosonifySkyPanel = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { init(); });
    } else {
      init();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
