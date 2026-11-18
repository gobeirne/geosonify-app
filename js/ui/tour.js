/*
  tour.js — guided tours on the real controls (Nov 2026)

  A tour is a list of steps. Each step points at one real control (or none, for
  a centred message), says what the person is about to discover, and can wait
  for them to do it. Everything around the control is dimmed; the control
  itself stays live, so people learn by tapping, not by reading.

  NON-DESTRUCTIVE: before a tour starts, localStorage and the page address are
  snapshotted. However the tour ends (Done, Skip, Escape, an error), the
  snapshot is put back and the page reloads at the address it had, so the
  person's cards, settings and place are exactly as before. A reload is the
  only way to be sure in-memory state the tour touched is gone too.

  ROBUST: a step whose control is missing or hidden falls back to a centred
  message instead of breaking. Steps that wait for an action can always be
  passed with Next. Escape skips; Enter / Space press the focused button.

  API
    GeosonifyTour.register(id, { title, steps: [step, ...] })
    GeosonifyTour.start(id)            run a tour (one at a time)
    GeosonifyTour.list()               ids and titles, for a Help menu
    GeosonifyTour.check(id)            for tests: which step targets are visible
  step = {
    target: CSS selector or function returning an element (optional),
    title, text,                       strings (plain text, never markup)
    before(): run when the step opens (may scroll, open a tab…)
    done(): true once the person has done the thing (polled); optional
    primary / secondary: { label, action: 'next'|'end'|'skip' } for centred steps
  }
*/
(function (global) {
  'use strict';

  var tours = {}, active = null;
  var SNAP_KEY = 'gsTourSnapshot', DONE_KEY = 'gsTourJustEnded';

  function injectCSS() {
    if (document.getElementById('gs-tour-css')) return;
    var st = document.createElement('style');
    st.id = 'gs-tour-css';
    st.textContent = [
      '.gs-tour-shade{position:fixed;background:rgba(10,14,18,.62);z-index:30000;transition:all .2s ease;}',
      '.gs-tour-ring{position:fixed;z-index:30001;border-radius:12px;box-shadow:0 0 0 3px #5fd4c8,0 0 0 9px rgba(95,212,200,.35);pointer-events:none;transition:all .2s ease;}',
      '.gs-tour-tip{position:fixed;z-index:30002;max-width:min(340px,calc(100vw - 24px));background:#fff;color:#111;border-radius:14px;',
      'box-shadow:0 10px 30px rgba(0,0,0,.35);padding:14px 14px 10px;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
      '.gs-tour-tip h3{margin:0 0 4px;font-size:17px;}',
      '.gs-tour-tip p{margin:0 0 10px;}',
      '.gs-tour-row{display:flex;align-items:center;gap:8px;}',
      '.gs-tour-dots{flex:1;display:flex;gap:5px;}',
      '.gs-tour-dots i{width:7px;height:7px;border-radius:50%;background:#c9cfd4;display:block;}',
      '.gs-tour-dots i.on{background:#325756;}',
      '.gs-tour-tip button{font:inherit;border:0;border-radius:9px;padding:8px 12px;cursor:pointer;background:#eef1f3;color:#111;}',
      '.gs-tour-tip button.pri{background:#325756;color:#fff;font-weight:600;}',
      '.gs-tour-tip button.link{background:none;color:#555;padding:8px 4px;}',
      '.gs-tour-tip button:focus-visible{outline:3px solid #5fd4c8;outline-offset:2px;}',
      '.gs-tour-hint{font-size:13px;color:#2f6f69;margin:-4px 0 8px;}',
      '@media (prefers-color-scheme: dark){.gs-tour-tip{background:#1f2226;color:#f1f3f4;}.gs-tour-tip button{background:#2c3035;color:#f1f3f4;}',
      '.gs-tour-tip button.link{color:#a7adb3;}.gs-tour-hint{color:#7fd0c7;}.gs-tour-dots i{background:#4a5057;}.gs-tour-dots i.on{background:#5fa39f;}}'
    ].join('');
    document.head.appendChild(st);
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05;
  }
  function resolve(t) {
    try { return typeof t === 'function' ? t() : (t ? document.querySelector(t) : null); } catch (e) { return null; }
  }

  // ── snapshot / restore ──────────────────────────────────────────────
  function snapshot() {
    var data = {};
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k !== SNAP_KEY) data[k] = localStorage.getItem(k); } } catch (e) {}
    var snap = { href: location.href, data: data };
    try { sessionStorage.setItem(SNAP_KEY, JSON.stringify(snap)); } catch (e) {}
    return snap;
  }
  function restoreAndReload(snap) {
    try {
      var keep = {}; keep[SNAP_KEY] = 1;
      var keys = []; for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      keys.forEach(function (k) { if (!keep[k]) localStorage.removeItem(k); });
      Object.keys(snap.data).forEach(function (k) { localStorage.setItem(k, snap.data[k]); });
      sessionStorage.removeItem(SNAP_KEY);
      sessionStorage.setItem(DONE_KEY, '1');
    } catch (e) {}
    location.replace(snap.href);
  }
  // A tour interrupted by a reload or a crash: put things back on the next load.
  try {
    var pending = sessionStorage.getItem(SNAP_KEY);
    if (pending) restoreAndReload(JSON.parse(pending));
  } catch (e) {}

  // ── running a tour ───────────────────────────────────────────────────
  function Run(tour) {
    this.tour = tour; this.i = 0; this.els = {}; this.poll = null; this.snap = snapshot();
    var self = this;
    this.onKey = function (e) { if (e.key === 'Escape') { e.preventDefault(); self.end(); } };
    this.onMove = function () { self.place(true); };   // scrolling moves the highlight, not the callout
  }
  Run.prototype.build = function () {
    injectCSS();
    var e = this.els;
    ['t', 'r', 'b', 'l'].forEach(function (k) { e[k] = document.createElement('div'); e[k].className = 'gs-tour-shade'; document.body.appendChild(e[k]); });
    e.ring = document.createElement('div'); e.ring.className = 'gs-tour-ring'; document.body.appendChild(e.ring);
    e.tip = document.createElement('div'); e.tip.className = 'gs-tour-tip';
    e.tip.setAttribute('role', 'dialog'); e.tip.setAttribute('aria-modal', 'false'); e.tip.setAttribute('aria-live', 'polite');
    document.body.appendChild(e.tip);
    document.addEventListener('keydown', this.onKey);
    global.addEventListener('resize', this.onMove);
    global.addEventListener('scroll', this.onMove, true);
  };
  Run.prototype.teardown = function () {
    clearInterval(this.poll);
    document.removeEventListener('keydown', this.onKey);
    global.removeEventListener('resize', this.onMove);
    global.removeEventListener('scroll', this.onMove, true);
    var e = this.els; Object.keys(e).forEach(function (k) { if (e[k] && e[k].remove) e[k].remove(); });
  };
  Run.prototype.end = function () {
    this.teardown(); active = null;
    // Nothing can have changed if the person left at the first step.
    if (this.i === 0 && !this.touched) { try { sessionStorage.removeItem(SNAP_KEY); } catch (e) {} return; }
    restoreAndReload(this.snap);
  };
  Run.prototype.go = function (i) {
    var self = this, steps = this.tour.steps;
    clearInterval(this.poll);
    if (i >= steps.length) return this.end();
    this.i = Math.max(0, i);
    if (this.i > 0) this.touched = true;
    var s = steps[this.i];
    try { if (s.before) s.before(); } catch (e) { console.warn('[tour]', e); }
    // Give layout a moment (tabs, scrolling) before measuring.
    setTimeout(function () { self.render(); }, s.delay || 250);
  };
  Run.prototype.render = function () {
    var self = this, s = this.tour.steps[this.i], tip = this.els.tip;
    var el = resolve(s.target);
    if (el && !visible(el)) { try { el.scrollIntoView({ block: 'center' }); } catch (e) {} }
    this.target = (el && visible(el)) ? el : null;
    tip.innerHTML = '';
    var h = document.createElement('h3'); h.textContent = s.title || ''; tip.appendChild(h);
    var p = document.createElement('p'); p.textContent = (typeof s.text === 'function' ? s.text() : s.text) || ''; tip.appendChild(p);
    var hint = null;
    if (s.done) { hint = document.createElement('div'); hint.className = 'gs-tour-hint'; hint.textContent = s.hint || ''; tip.appendChild(hint); }
    var row = document.createElement('div'); row.className = 'gs-tour-row';
    var dots = document.createElement('div'); dots.className = 'gs-tour-dots';
    var n = this.tour.steps.length;
    for (var k = 0; k < n; k++) { var d = document.createElement('i'); if (k === this.i) d.className = 'on'; dots.appendChild(d); }
    row.appendChild(dots);
    function btn(label, cls, fn) { var b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (cls) b.className = cls; b.onclick = fn; row.appendChild(b); return b; }
    var act = function (a) { return a === 'end' || a === 'skip' ? function () { self.end(); } : function () { self.go(self.i + 1); }; };
    if (s.secondary) btn(s.secondary.label, 'link', act(s.secondary.action));
    else if (this.i < n - 1) btn(s.skipLabel || 'Skip tour', 'link', function () { self.end(); });
    if (this.i > 0 && !s.primary) btn('Back', '', function () { self.go(self.i - 1); });
    var main = s.primary
      ? btn(s.primary.label, 'pri', act(s.primary.action))
      : btn(this.i === n - 1 ? 'Done' : 'Next', 'pri', function () { self.go(self.i + 1); });
    tip.appendChild(row);
    this.place();
    try { main.focus({ preventScroll: true }); } catch (e) {}
    if (s.done) {
      var base = null; try { base = s.snapshot ? s.snapshot() : null; } catch (e) {}
      this.poll = setInterval(function () {
        var ok = false; try { ok = s.done(base); } catch (e) {}
        if (ok) {
          clearInterval(self.poll);
          if (hint) hint.textContent = s.doneText || '✓ Nicely done';
          if (s.autoAdvance !== false) setTimeout(function () { if (self.tour.steps[self.i] === s) self.go(self.i + 1); }, s.pause || 1200);
        }
      }, 250);
    }
  };
  Run.prototype.place = function (ringOnly) {
    var e = this.els, el = this.target, W = innerWidth, H = innerHeight, pad = 6;
    var r = el ? el.getBoundingClientRect() : null;
    if (r) {
      var x = Math.max(0, r.left - pad), y = Math.max(0, r.top - pad), x2 = Math.min(W, r.right + pad), y2 = Math.min(H, r.bottom + pad);
      set(e.t, 0, 0, W, y); set(e.b, 0, y2, W, H - y2); set(e.l, 0, y, x, y2 - y); set(e.r, x2, y, W - x2, y2 - y);
      set(e.ring, x, y, x2 - x, y2 - y); e.ring.style.display = '';
    } else {
      set(e.t, 0, 0, W, H); set(e.b, 0, 0, 0, 0); set(e.l, 0, 0, 0, 0); set(e.r, 0, 0, 0, 0); e.ring.style.display = 'none';
    }
    if (ringOnly) return;
    var tip = e.tip, tw = tip.offsetWidth, th = tip.offsetHeight, left, top;
    if (!r) { left = (W - tw) / 2; top = (H - th) / 2; }
    else {
      left = Math.min(Math.max(12, r.left + r.width / 2 - tw / 2), W - tw - 12);
      top = (r.bottom + 14 + th < H - 12) ? r.bottom + 14 : (r.top - 14 - th > 12 ? r.top - 14 - th : Math.max(12, H - th - 12));
      top = Math.min(Math.max(12, top), Math.max(12, H - th - 12));   // always fully on screen
    }
    tip.style.left = left + 'px'; tip.style.top = top + 'px';
    function set(d, x, y, w, h) { d.style.left = x + 'px'; d.style.top = y + 'px'; d.style.width = Math.max(0, w) + 'px'; d.style.height = Math.max(0, h) + 'px'; }
  };

  var API = {
    register: function (id, def) { tours[id] = def; },
    list: function () { return Object.keys(tours).map(function (k) { return { id: k, title: tours[k].title }; }); },
    start: function (id) {
      if (active || !tours[id]) return false;
      active = new Run(tours[id]); active.build(); active.go(0); return true;
    },
    isRunning: function () { return !!active; },
    justEnded: function () { try { var v = sessionStorage.getItem(DONE_KEY); sessionStorage.removeItem(DONE_KEY); return !!v; } catch (e) { return false; } },
    check: function (id) {
      var t = tours[id]; if (!t) return null;
      return t.steps.map(function (s) { var el = resolve(s.target); return { title: s.title, target: !!s.target, found: !!el, visible: visible(el) }; });
    }
  };
  global.GeosonifyTour = API;

  // ── the introductory tour: what Geosonify is for ─────────────────────
  // Four interactive steps between a welcome and a finish. It shows a result
  // before naming anything, and uses the visitor's own place when a link
  // brought them here.
  function cards() { return document.querySelector('#cardsContainer .format-card'); }
  function card(key) { return document.querySelector('#cardsContainer .format-card[data-grid-key="' + key + '"]'); }
  function show(key) { var c = card(key); if (c) try { c.scrollIntoView({ block: 'start' }); } catch (e) {} }
  function speaker() { return document.querySelector('.audio-speaker-btn[data-grid="music"]') || document.querySelector('.audio-speaker-btn'); }
  function coordKey() { try { return currentCardCoord ? currentCardCoord.lat.toFixed(7) + ',' + currentCardCoord.lon.toFixed(7) : ''; } catch (e) { return ''; } }
  function home() { try { if (typeof switchToTab === 'function') switchToTab('home'); } catch (e) {} }

  API.register('intro', {
    title: 'What Geosonify does',
    steps: [
      { title: 'Welcome to Geosonify!',
        text: 'Turn any place on Earth into words, colours, music or a code you can share.',
        primary: { label: 'Show me how', action: 'next' },
        secondary: { label: 'Explore myself', action: 'end' } },
      { title: 'Choose a place',
        text: function () { return global.__geohackLanding
          ? 'This is your place from Wikipedia. Tap anywhere on the map to try somewhere else.'
          : 'Tap anywhere on the map. Try somewhere you know.'; },
        hint: 'Waiting for a tap on the map…',
        before: function () { home(); try { global.scrollTo(0, 0); } catch (e) {} },
        target: function () { try { return map.getContainer(); } catch (e) { return document.querySelector('.leaflet-container'); } },
        snapshot: coordKey,
        done: function (was) { var now = coordKey(); return now && now !== was; },
        doneText: '✓ That place is now in every card below.' },
      { title: 'In letters and numbers',
        text: 'Every card is this same place, written a different way. Here it is in letters and numbers.',
        before: function () { show('alphanumeric'); }, target: function () { return card('alphanumeric'); } },
      { title: 'As words',
        text: 'Here it is as four ordinary words, easy to say over the phone. The same place can be written in eleven languages.',
        before: function () { show('hpbip39english'); }, target: function () { return card('hpbip39english'); } },
      { title: 'As emoji',
        text: 'And as a row of emoji.',
        before: function () { show('emoji'); }, target: function () { return card('emoji'); } },
      { title: 'As music',
        text: 'And as music: these notes are your place. Every place has its own tune.',
        before: function () { show('music'); }, target: function () { return card('music'); } },
      { title: 'Hear it',
        text: 'Tap the speaker to play it, and tap again to stop. No sound? Check your device isn’t on mute.',
        // The speaker is on the music card just shown: move only the highlight,
        // so it is clear the button belongs to that card. Scroll only if the
        // speaker is somehow off screen.
        before: function () {
          var b = speaker(); if (!b) return;
          var r = b.getBoundingClientRect();
          if (r.top < 0 || r.bottom > innerHeight) try { b.scrollIntoView({ block: 'nearest' }); } catch (e) {}
        },
        delay: 50,
        target: speaker },
      { title: 'Share your place',
        text: 'Tap share on a card. The link opens exactly this place for anyone you send it to.',
        hint: 'Waiting for the share button…',
        before: function () { show('alphanumeric'); },
        target: function () { var c = card('alphanumeric') || cards(); return c && c.querySelector('.share-btn'); },
        snapshot: function () { return null; },
        done: function () { return !!global.__gsTourShared; },
        doneText: '✓ Shared. That is the heart of Geosonify.' },
      { title: 'That’s Geosonify!',
        text: 'Now try a place of your own. You can take this tour again from the FAQ tab.',
        primary: { label: 'Start exploring', action: 'end' } }
    ]
  });
  // Note any share press while a tour runs (the card's own handler still runs).
  document.addEventListener('click', function (e) {
    if (!active || !e.target || !e.target.closest) return;
    if (e.target.closest('.share-btn')) global.__gsTourShared = true;
  }, true);

  // A first visit to the plain home page: offer the introduction once. The
  // flag is set before the tour starts, so the snapshot keeps it.
  function offerOnce() {
    try {
      if (location.search || localStorage.getItem('gsIntroOffered') || API.justEnded()) return;
      localStorage.setItem('gsIntroOffered', '1');
      setTimeout(function () { if (!active && !location.search) API.start('intro'); }, 1500);
    } catch (e) {}
  }
  if (document.readyState === 'complete') offerOnce(); else global.addEventListener('load', offerOnce);

})(typeof window !== 'undefined' ? window : this);
