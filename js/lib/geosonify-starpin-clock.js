/*
  geosonify-starpin-clock.js v0.1 — the culmination clock

  One clock. It is the same clock everywhere on Earth: at culmination, every
  frozen star stands over its own starpin simultaneously. The countdown is
  therefore global and takes no location. Darkness is local, and is shown
  separately for exactly that reason — the two must never be conflated.

  Needs geosonify-starpin.js. Mounts into any element:

      var clock = GeosonifyStarpinClock.mount(document.getElementById('x'), {
        lat: -43.552937, lonEast: 172.652138     // optional; enables darkness
      });
      clock.setPosition(lat, lonEast);           // update later
      clock.destroy();

  Trap this file exists to avoid: a sidereal day is 23h56m04s, so a wall-clock
  culmination time is wrong by ~4 minutes a day. Nothing here is ever cached —
  every tick recomputes from Date.now().
*/
'use strict';

var GeosonifyStarpinClock = (function () {

  var S = (typeof GeosonifyStarpin !== 'undefined') ? GeosonifyStarpin
        : (typeof require === 'function' ? require('./geosonify-starpin.js') : null);

  var NS = 'http://www.w3.org/2000/svg';
  var CSS_ID = 'starpin-clock-css';

  var CSS = [
    '.spc{--spc-ink:var(--ios-text,#000);--spc-dim:var(--ios-secondary,#3C3C43);',
    '  --spc-line:var(--ios-separator,#C6C6C8);--spc-teal:var(--kakapo-moss,#7D9D33);',
    '  --spc-lav:var(--kakapo-lichen,#CED38C);--spc-pink:var(--kakapo-rust,#CD8862);',
    '  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,sans-serif;',
    '  color:var(--spc-ink);display:flex;flex-direction:column;align-items:center;gap:.5rem}',
    '.spc-dial{position:relative;width:min(72vw,260px);aspect-ratio:1}',
    '.spc-dial svg{width:100%;height:100%;display:block;transform:rotate(-90deg)}',
    '.spc-face{position:absolute;inset:0;display:flex;flex-direction:column;',
    '  align-items:center;justify-content:center;gap:.15rem;text-align:center}',
    '.spc-count{font-family:"SF Mono",ui-monospace,monospace;font-size:clamp(1.6rem,7vw,2.1rem);',
    '  font-weight:600;letter-spacing:.02em;font-variant-numeric:tabular-nums}',
    '.spc-eyebrow{font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;',
    '  color:var(--spc-dim);opacity:.75}',
    '.spc-rows{width:100%;max-width:26rem;border-top:1px solid var(--spc-line)}',
    '.spc-row{display:flex;justify-content:space-between;gap:1rem;padding:.5rem .25rem;',
    '  border-bottom:1px solid var(--spc-line);font-size:.85rem}',
    '.spc-row dt{color:var(--spc-dim)}',
    '.spc-row dd{margin:0;font-family:"SF Mono",ui-monospace,monospace;text-align:right}',
    '.spc-dark{color:var(--spc-lav);font-weight:600}',
    '.spc-note{font-size:.7rem;color:var(--spc-dim);max-width:26rem;text-align:center;',
    '  line-height:1.45;margin:.25rem 0 0}',
    '@media (prefers-reduced-motion:reduce){.spc-dial svg *{transition:none!important}}'
  ].join('');

  function injectCss(doc) {
    if (doc.getElementById(CSS_ID)) return;
    var s = doc.createElement('style');
    s.id = CSS_ID; s.textContent = CSS;
    doc.head.appendChild(s);
  }

  function el(doc, tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(doc, tag, attrs) {
    var n = doc.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function pad(n, w) { n = String(Math.floor(n)); while (n.length < (w || 2)) n = '0' + n; return n; }

  function hms(ms) {
    var t = Math.max(0, Math.floor(ms / 1000));
    return pad(t / 3600) + ':' + pad((t / 60) % 60) + ':' + pad(t % 60);
  }

  // A culmination nearly a sidereal day away is usually tomorrow. Showing a
  // bare time invites someone to turn up 24 hours early.
  function whenText(ms, nowMs) {
    var t = localTime(ms), a = new Date(ms), b = new Date(nowMs);
    var days = Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()) -
                           new Date(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);
    if (days === 0) return t;
    if (days === 1) return 'tomorrow ' + t;
    return a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + t;
  }

  function localTime(ms) {
    try {
      return new Date(ms).toLocaleTimeString(undefined,
        { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return new Date(ms).toISOString().substr(11, 5) + 'Z'; }
  }

  function mount(container, opts) {
    if (!S) throw new Error('starpin-clock: geosonify-starpin.js must load first');
    if (!container) throw new Error('starpin-clock: no container');
    var doc = container.ownerDocument || document;
    injectCss(doc);
    opts = opts || {};

    var lat = opts.lat, lonEast = opts.lonEast;

    var root = el(doc, 'div', 'spc');

    // ── the dial. The needle sweeps once per sidereal day; culmination is at
    //    the top. This is the sidereal phase itself, not a progress bar.
    var dial = el(doc, 'div', 'spc-dial');
    var s = svg(doc, 'svg', { viewBox: '0 0 100 100' });
    var R = 44, C = 2 * Math.PI * R;
    s.appendChild(svg(doc, 'circle', {
      cx: 50, cy: 50, r: R, fill: 'none', stroke: 'currentColor',
      'stroke-opacity': .12, 'stroke-width': 3
    }));
    var arc = svg(doc, 'circle', {
      cx: 50, cy: 50, r: R, fill: 'none', stroke: 'var(--spc-teal)',
      'stroke-width': 3, 'stroke-linecap': 'round',
      'stroke-dasharray': C, 'stroke-dashoffset': C
    });
    s.appendChild(arc);
    // the mark at the top: the instant itself
    s.appendChild(svg(doc, 'line', {
      x1: 50 + R - 6, y1: 50, x2: 50 + R + 6, y2: 50,
      stroke: 'var(--spc-pink)', 'stroke-width': 2.5, 'stroke-linecap': 'round'
    }));
    var needle = svg(doc, 'line', {
      x1: 50, y1: 50, x2: 50 + R - 8, y2: 50,
      stroke: 'var(--spc-lav)', 'stroke-width': 1.5, 'stroke-linecap': 'round'
    });
    s.appendChild(needle);
    dial.appendChild(s);

    var face = el(doc, 'div', 'spc-face');
    var eyebrow = el(doc, 'div', 'spc-eyebrow', 'culmination in');
    var count = el(doc, 'div', 'spc-count', '--:--:--');
    face.appendChild(eyebrow); face.appendChild(count);
    dial.appendChild(face);
    root.appendChild(dial);

    var rows = el(doc, 'dl', 'spc-rows');
    function row(label) {
      var r = el(doc, 'div', 'spc-row');
      r.appendChild(el(doc, 'dt', null, label));
      var dd = el(doc, 'dd', null, '—');
      r.appendChild(dd); rows.appendChild(r);
      return { row: r, value: dd };
    }
    var rNext  = row('next culmination');
    var rPhase = row('sidereal phase');
    var rSun   = row('sun here then');
    var rDark  = row('sky here then');
    root.appendChild(rows);

    root.appendChild(el(doc, 'p', 'spc-note',
      'The same instant everywhere on Earth. It arrives 3m 56s earlier each day.'));

    container.appendChild(root);

    // ── the loop. Recomputes from scratch every tick; caches nothing.
    var reduced = false;
    try { reduced = doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) {}
    var raf = null, timer = null, dead = false;

    function tick() {
      if (dead) return;
      var now = Date.now();
      var next = S.nextCulmination(now);
      var phase = S.phaseDeg(now);

      count.textContent = hms(next - now);
      // The needle sits at the current phase; the teal arc is what is LEFT to
      // sweep before it reaches the mark, so it shrinks as culmination nears.
      // (An arc that grows would read as "almost there" at the wrong moment.)
      var remaining = (360 - phase) % 360;
      needle.setAttribute('transform', 'rotate(' + phase.toFixed(3) + ' 50 50)');
      arc.setAttribute('stroke-dashoffset', String(C * (1 - remaining / 360)));
      arc.setAttribute('transform', 'rotate(' + phase.toFixed(3) + ' 50 50)');

      rNext.value.textContent = whenText(next, now);
      rPhase.value.textContent = phase.toFixed(3) + '\u00B0';

      if (lat != null && lonEast != null) {
        var d = S.darkness(next, lat, lonEast);
        rSun.value.textContent = (d.sunAltDeg >= 0 ? '+' : '') + d.sunAltDeg.toFixed(1) + '\u00B0';
        rDark.value.textContent = d.band;
        rDark.value.className = d.dark ? 'spc-dark' : '';
      } else {
        rSun.value.textContent = 'needs your position';
        rDark.value.textContent = '—';
        rDark.value.className = '';
      }
      schedule();
    }

    function schedule() {
      if (dead) return;
      if (reduced || typeof doc.defaultView.requestAnimationFrame !== 'function') {
        timer = doc.defaultView.setTimeout(tick, 1000);
      } else {
        raf = doc.defaultView.requestAnimationFrame(tick);
      }
    }

    tick();

    return {
      setPosition: function (la, lo) { lat = la; lonEast = lo; },
      destroy: function () {
        dead = true;
        if (raf) doc.defaultView.cancelAnimationFrame(raf);
        if (timer) doc.defaultView.clearTimeout(timer);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  return { VERSION: '0.1', mount: mount, _hms: hms };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpinClock;
