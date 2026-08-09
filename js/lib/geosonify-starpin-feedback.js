/*
  geosonify-starpin-feedback.js v0.1 — arrival, and the reward

  Two jobs, and they are the same job: make being there FEEL like being there.

  Design rules this file follows, in order of importance:

  1. ONCE YOU ARE INSIDE R, STOP SHOWING METRES. A residual distance invites
     someone to shuffle back and forth chasing a number that means nothing —
     and "precision below the safety threshold earns nothing" is a safety rule,
     not a slogan. Inside R the answer is "you are standing on it", full stop.

  2. THE SINGLE THING IS THE REWARD. Bagging one cornerstone must justify the
     walk on its own. A set-completion counter as the headline makes the one
     you just earned feel like 25% of something instead of 100% of itself.

  3. THE CELEBRATION SCALES WITH RARITY, and rarity is a fact, not a mood.
     A vertex's intrinsic order determines exactly how many exist on Earth:
     12*4^n + 2. That number goes in the banner.

  4. The sound is DERIVED FROM THE THING. This is a sonification app; a stock
     chime would be a missed opportunity. The arpeggio comes from the vertex's
     own quaternary digits, and the root pitch drops an octave for every six
     orders coarser — so rarer cornerstones literally sound deeper.

  Call unlock() from a user gesture before any sound is expected (iOS requires
  it). Respects prefers-reduced-motion: no confetti, no motion, banner only.
*/
'use strict';

var GeosonifyStarpinFeedback = (function () {

  var CSS_ID = 'starpin-feedback-css';
  var ctx = null;

  // ── rarity ────────────────────────────────────────────────────────────────

  // Vertices on the whole sphere at order n: V = F + 2 = 12*4^n + 2.
  function vertexCount(order) { return 12 * Math.pow(4, order) + 2; }

  var EARTH_KM2 = 510.1e6;

  // How many exist within a given radius of anywhere. This is the number that
  // decides whether a cornerstone is worth walking to, and it is the reason
  // the floor below exists rather than a tighter radius.
  function nearbyCount(order, radiusKm) {
    return Math.round(vertexCount(order) / EARTH_KM2 * Math.PI * radiusKm * radiusKm);
  }
  function spacingM(order) { return Math.sqrt(EARTH_KM2 / (12 * Math.pow(4, order))) * 1000; }

  // Finest order treated as a collectible. At order 14 there are ~50,000
  // within 50 km and 17% of all ground lies within the acceptance radius of
  // one — too common to mean anything. Order 12 puts that at 1.07%, which is
  // less than starpins. Tightening R would have been the wrong lever: R is
  // about GPS uncertainty and about not making anyone climb a fence, and it
  // should stay one rule for every kind of target.
  var COLLECTIBLE_FLOOR = 12;

  // order may be fractional: a crossing of a rare line and a common one sits
  // between the two, so its tier does too.
  function tierOf(order, degree) {
    order = Math.round(Number(order) * 2) / 2;
    if (degree === 3) return {
      key: 'exceptional', label: 'one of only eight',
      rarity: 1, particles: 400,
      blurb: 'A three-cell vertex. There are eight on the planet, at every ' +
             'order, forever. They are worth no points at all.'
    };
    var n = vertexCount(Math.round(order)), r;
    if (order > COLLECTIBLE_FLOOR) return {
      key: 'commonplace', rarity: 0.04, particles: 0,
      label: 'about ' + nearbyCount(order, 50).toLocaleString() + ' within 50 km of here',
      blurb: 'Order ' + order + ', one every ' + Math.round(spacingM(order)) + ' m. ' +
             'Logged, but too common to be worth a walk \u2014 try order ' +
             COLLECTIBLE_FLOOR + ' or coarser.'
    };
    if      (order <= 6)  r = { key: 'exceptional', rarity: 1.00 };
    else if (order <= 8)  r = { key: 'very rare',   rarity: 0.80 };
    else if (order <= 10) r = { key: 'rare',        rarity: 0.58 };
    else if (order <= 12) r = { key: 'uncommon',    rarity: 0.36 };
    else                  r = { key: 'everyday',    rarity: 0.16 };
    return {
      key: r.key, rarity: r.rarity,
      particles: Math.round(20 + r.rarity * 260),
      label: 'one of ' + n.toLocaleString() + ' on Earth',
      blurb: 'Order ' + order + ', about ' + nearbyCount(order, 50).toLocaleString() +
             ' within 50 km. It is a corner at every finer order too, and always will be.'
    };
  }

  // Stars are not vertices, and their rarity is NOT vertex arithmetic. Feeding
  // a starpin a made-up HEALPix order produced sentences like "one every 398 m,
  // try order 12 or coarser" about a Gaia source — true of the lattice,
  // nonsense about a star.
  //
  // What the data actually supports here is OBSERVABILITY, and even that is
  // hedged: Gaia G is a broad passband, not a visual magnitude, and what you
  // can see depends on sky brightness, moon, altitude and eyes. So the wording
  // says "around" and never promises a sighting. No badge is minted here.
  function starTier(mag) {
    if (mag == null || !isFinite(mag)) return {
      key: 'unmeasured', rarity: 0.3, particles: 70,
      label: 'brightness unknown',
      blurb: 'No usable magnitude in the catalogue. The address is exact all the same.'
    };
    if (mag < 6.5) return {
      key: 'unaided', rarity: 1, particles: 300,
      label: 'G \u2248 ' + mag.toFixed(1) + ' \u2014 around the unaided-eye limit',
      blurb: 'Only a few thousand stars on the whole sky are this bright, so ' +
             'their starpins are scattered thousands of kilometres apart. ' +
             'Whether you can actually see it depends on the sky, not the catalogue.'
    };
    if (mag < 10) return {
      key: 'binocular', rarity: 0.65, particles: 190,
      label: 'G \u2248 ' + mag.toFixed(1) + ' \u2014 binocular range',
      blurb: 'Too faint for the unaided eye in most skies, easy in binoculars ' +
             'once you know where to point them.'
    };
    if (mag < 14) return {
      key: 'telescopic', rarity: 0.4, particles: 110,
      label: 'G \u2248 ' + mag.toFixed(1) + ' \u2014 a small telescope',
      blurb: 'A backyard telescope will show it. You are standing on its address ' +
             'either way.'
    };
    return {
      key: 'deep', rarity: 0.22, particles: 60,
      label: 'G \u2248 ' + mag.toFixed(1) + ' \u2014 camera or a serious telescope',
      blurb: 'Far too faint to see by eye. Its place on Earth is no less exact.'
    };
  }

  // ── sound ─────────────────────────────────────────────────────────────────

  function unlock() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    } catch (e) { return false; }
  }

  // Major pentatonic, in semitones. Quaternary digits are 0..3, so four of them.
  var PENT = [0, 2, 4, 7, 9, 12, 14, 16];

  function ring(quaternaryDigits, order, rarity) {
    if (!ctx || ctx.state !== 'running') return;
    var digits = String(quaternaryDigits || '0123').slice(-5).split('')
                   .map(function (d) { return parseInt(d, 10) || 0; });
    // Root drops an octave every six orders coarser. Rare sounds deeper.
    var root = 261.626 / Math.pow(2, (14 - order) / 6);
    var t0 = ctx.currentTime + 0.01;
    var master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    master.gain.setValueAtTime(0.28, t0);

    digits.forEach(function (d, i) {
      var when = t0 + i * 0.075;
      var semis = PENT[(d + i) % PENT.length];
      [1, 2].forEach(function (mult, k) {
        if (k === 1 && rarity < 0.5) return;              // shimmer only when rare
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = k ? 'triangle' : 'sine';
        o.frequency.value = root * mult * Math.pow(2, semis / 12);
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(k ? 0.10 : 0.22, when + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.55 + rarity * 0.8);
        o.connect(g); g.connect(master);
        o.start(when); o.stop(when + 1.6);
      });
    });
  }

  // ── the starpin lead: four bars of Dorian ────────────────────────────────
  //
  // A cornerstone gets a four-note arpeggio. A starpin gets a TUNE, because a
  // star gave you an address and you went there.
  //
  //   * four bars of 4/4 at 112 bpm, melody line only
  //   * Dorian, and every degree of it sounds at least once
  //   * detuned saws through a resonant filter, into a dotted-eighth delay
  //     with feedback — the 1983 lead patch, and the cross-rhythm between
  //     dotted eighths and straight eighths is the whole character of it
  //
  // Deterministic: the same source_id always plays the same tune, so a star's
  // melody is as much its own as its coordinates.

  var DORIAN = [0, 2, 3, 5, 7, 9, 10];        // i ii bIII IV V vi bVII
  var BPM = 112;

  function seededRng(str) {
    var h = 2166136261 >>> 0, t = String(str || 'starpin');
    for (var i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return function () {
      h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0;
      return h / 4294967296;
    };
  }

  // 32 eighth-note slots. Returns [{slot, semis, dur}] with every Dorian
  // degree guaranteed present.
  function composeDorian(seed) {
    var rng = seededRng(seed);
    var SLOTS = 32, chosen = [], used = {};

    // Slot 0 always sounds: a tune that starts on a rest sounds like a bug.
    var picks = [0];
    while (picks.length < 19) {
      var s = Math.floor(rng() * SLOTS);
      // favour on-beat and the and-of-two; skip the last slot so it can ring
      if (s === SLOTS - 1) continue;
      if (picks.indexOf(s) === -1) picks.push(s);
    }
    picks.sort(function (a, b) { return a - b; });

    // Guarantee the whole mode: seven of the picked slots are dealt one
    // degree each, shuffled, before anything else is chosen.
    var order = DORIAN.slice();
    for (var i = order.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1)), tmp = order[i]; order[i] = order[j]; order[j] = tmp;
    }
    var seats = picks.slice();
    for (var k = seats.length - 1; k > 0; k--) {
      var m = Math.floor(rng() * (k + 1)), t2 = seats[k]; seats[k] = seats[m]; seats[m] = t2;
    }
    var assigned = {};
    order.forEach(function (deg, idx) { assigned[seats[idx]] = deg; used[deg] = 1; });

    var last = order[0];
    picks.forEach(function (slot) {
      var semis;
      if (assigned[slot] != null) { semis = assigned[slot]; }
      else {
        // stepwise motion most of the time, with the occasional leap
        var li = DORIAN.indexOf(last);
        var step = rng() < 0.72 ? (rng() < 0.5 ? -1 : 1) : (rng() < 0.5 ? -2 : 3);
        var ni = Math.max(0, Math.min(DORIAN.length - 1, li + step));
        semis = DORIAN[ni];
      }
      last = semis;
      // lift the top of the phrase an octave now and then
      var oct = (rng() < 0.16 && slot > 8) ? 12 : 0;
      chosen.push({ slot: slot, semis: semis + oct });
    });

    // Each note rings until the next one, capped, so the delay does the rest.
    for (var n = 0; n < chosen.length; n++) {
      var next = (n + 1 < chosen.length) ? chosen[n + 1].slot : SLOTS;
      chosen[n].dur = Math.min(3, next - chosen[n].slot);
    }
    return chosen;
  }

  function playDorianLead(seed, rootHz) {
    if (!ctx || ctx.state !== 'running') return 0;
    var eighth = 60 / BPM / 2;
    var dotted = eighth * 1.5;
    var notes = composeDorian(seed);
    var t0 = ctx.currentTime + 0.06;
    var root = rootHz || 261.626;

    var out = ctx.createGain(); out.gain.value = 0.9; out.connect(ctx.destination);

    // dotted-eighth delay with feedback — the signature
    var delay = ctx.createDelay(2.0); delay.delayTime.value = dotted;
    var fb = ctx.createGain(); fb.gain.value = 0.38;
    var wet = ctx.createGain(); wet.gain.value = 0.34;
    var damp = ctx.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2600;
    delay.connect(damp); damp.connect(fb); fb.connect(delay); damp.connect(wet); wet.connect(out);

    var bus = ctx.createGain(); bus.gain.value = 0.26;
    bus.connect(out); bus.connect(delay);

    notes.forEach(function (n) {
      var when = t0 + n.slot * eighth;
      var len = Math.max(0.16, n.dur * eighth * 0.92);
      var hz = root * Math.pow(2, n.semis / 12);

      var amp = ctx.createGain();
      var flt = ctx.createBiquadFilter();
      flt.type = 'lowpass'; flt.Q.value = 6;
      flt.frequency.setValueAtTime(Math.min(9000, hz * 9), when);
      flt.frequency.exponentialRampToValueAtTime(Math.max(320, hz * 2.4), when + len * 0.7);

      amp.gain.setValueAtTime(0.0001, when);
      amp.gain.exponentialRampToValueAtTime(0.55, when + 0.012);
      amp.gain.exponentialRampToValueAtTime(0.22, when + len * 0.45);
      amp.gain.exponentialRampToValueAtTime(0.0001, when + len);

      [[0, 'sawtooth', 1], [7, 'sawtooth', 0.85], [-1200, 'square', 0.28]]
        .forEach(function (v) {
          var o = ctx.createOscillator(), g = ctx.createGain();
          o.type = v[1];
          o.frequency.value = hz;
          o.detune.value = v[0];
          g.gain.value = v[2];
          o.connect(g); g.connect(flt);
          o.start(when); o.stop(when + len + 0.12);
        });
      flt.connect(amp); amp.connect(bus);
    });

    return 32 * eighth;                          // seconds of music
  }

  function blip(good) {                                   // arrival, not logging
    if (!ctx || ctx.state !== 'running') return;
    var t = ctx.currentTime + 0.01;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(good ? 660 : 330, t);
    o.frequency.exponentialRampToValueAtTime(good ? 990 : 300, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.3);
  }

  // ── the pulse: proximity you can feel ─────────────────────────────────────
  //
  // The magnet feeling. Ticks get faster and higher as you close in, and at
  // arrival they fuse into a steady shimmer — the sensation of an invisible
  // thing having presence.
  //
  // PLATFORM TRUTH: navigator.vibrate() does not exist in Safari on iOS, so on
  // an iPhone this is audio only. Haptics are layered on where the platform
  // allows rather than assumed. Audio is the channel that works everywhere,
  // which is also the right channel for a sonification app.

  var pulse = { on: false, timer: null, lastD: null, arrived: false };

  function tick(freq, dur, gain) {
    if (!ctx || ctx.state !== 'running') return;
    var t = ctx.currentTime + 0.005;
    var o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 2;
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain == null ? 0.07 : gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.05));
    o.connect(f); f.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + (dur || 0.05) + 0.05);
  }

  function buzz(ms) {
    try {
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {}
  }

  function schedulePulse() {
    if (!pulse.on) return;
    var d = pulse.lastD, R = pulse.R || 92.77;
    if (d == null || d > 4 * R) {                  // out of range: say nothing
      pulse.timer = setTimeout(schedulePulse, 700);
      return;
    }
    var ratio = Math.max(0, Math.min(1, d / (4 * R)));
    if (pulse.arrived) {
      tick(1180, 0.10, 0.045);                     // fused shimmer, no gaps
      buzz(12);
      pulse.timer = setTimeout(schedulePulse, 110);
      return;
    }
    tick(300 + (1 - ratio) * 780, 0.045, 0.06);
    buzz(10);
    pulse.timer = setTimeout(schedulePulse, 95 + ratio * ratio * 1500);
  }

  function setPulse(on) {
    pulse.on = !!on;
    if (pulse.timer) { clearTimeout(pulse.timer); pulse.timer = null; }
    if (pulse.on) { unlock(); schedulePulse(); }
    return pulse.on;
  }
  function pulseEnabled() { return pulse.on; }

  // True only where the platform actually has a vibration API. iOS Safari does
  // not, and pretending otherwise would make the feature look broken.
  function hapticsAvailable() {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  // ── styles ────────────────────────────────────────────────────────────────

  var CSS = [
    '.spf-prox{display:flex;flex-direction:column;align-items:center;gap:.35rem;',
    '  padding:.75rem 0}',
    '.spf-ring{position:relative;width:min(56vw,190px);aspect-ratio:1;',
    '  display:grid;place-items:center}',
    '.spf-ring i{position:absolute;border-radius:50%;display:block;',
    '  transition:width .45s cubic-bezier(.2,.8,.2,1),height .45s cubic-bezier(.2,.8,.2,1),',
    '  background-color .45s,box-shadow .45s,opacity .45s}',
    '.spf-halo{width:100%;height:100%;background:currentColor;opacity:.10}',
    '.spf-you{width:14%;height:14%;background:currentColor;opacity:.9}',
    '.spf-word{font-size:.95rem;font-weight:600;text-align:center;line-height:1.25}',
    '.spf-dial{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible}',
    '.spf-dial g{transition:transform .35s cubic-bezier(.2,.8,.2,1)}',
    '.spf-card,.spf-card-n{font-family:"SF Mono",ui-monospace,monospace;font-size:8px;',
    '  font-weight:600;fill:currentColor;opacity:.5}',
    '.spf-card-n{opacity:.95;font-size:9.5px}',
    '.spf-here .spf-dial{opacity:.35}',
    '.spf-sub{font-size:.75rem;opacity:.7;font-family:"SF Mono",ui-monospace,monospace}',
    '.spf-here .spf-word{font-size:1.15rem}',
    '@keyframes spf-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}',
    '.spf-here .spf-halo{animation:spf-pulse 1.8s ease-in-out infinite;opacity:.22}',
    '.spf-banner{position:fixed;left:50%;top:22%;transform:translate(-50%,-8px);',
    '  z-index:9999;max-width:min(90vw,22rem);padding:1.1rem 1.25rem;border-radius:16px;',
    '  background:var(--ios-card,#fff);color:var(--ios-text,#000);text-align:center;',
    '  box-shadow:0 18px 50px rgba(0,0,0,.28);opacity:0;pointer-events:none;',
    '  transition:opacity .28s,transform .28s}',
    '.spf-banner.on{opacity:1;transform:translate(-50%,0)}',
    '.spf-kicker{font-size:.6rem;letter-spacing:.16em;text-transform:uppercase;',
    '  opacity:.6;margin-bottom:.35rem}',
    '.spf-name{font-family:"SF Mono",ui-monospace,monospace;font-size:1.05rem;',
    '  font-weight:600;word-break:break-all;line-height:1.3}',
    '.spf-rare{margin-top:.5rem;font-size:.82rem;font-weight:600}',
    '.spf-blurb{margin-top:.4rem;font-size:.72rem;opacity:.7;line-height:1.45}',
    '.spf-canvas{position:fixed;inset:0;z-index:9998;pointer-events:none}',
    '@media (prefers-reduced-motion:reduce){',
    '  .spf-ring i{transition:none}.spf-here .spf-halo{animation:none}',
    '  .spf-banner{transition:opacity .2s}}'
  ].join('');

  function injectCss(doc) {
    if (doc.getElementById(CSS_ID)) return;
    var st = doc.createElement('style');
    st.id = CSS_ID; st.textContent = CSS;
    doc.head.appendChild(st);
  }

  function reduced(doc) {
    try { return doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  // ── the proximity ring ────────────────────────────────────────────────────

  // Multiple targets on one dial, with cardinal marks so an arrow is never
  // mistaken for "up is where I am facing".
  //
  //   heading == null  -> the dial is a MAP: north is up, arrows are true
  //                       bearings, and N/E/S/W sit where they always sit.
  //   heading given    -> the dial is a COMPASS: everything counter-rotates by
  //                       the device heading, so an arrow points at the thing.
  //
  // Without the letters the first mode is a lie by omission, because a bearing
  // arrow on a screen looks exactly like a compass needle.
  function proximity(container, opts) {
    opts = opts || {};
    var doc = container.ownerDocument || document;
    injectCss(doc);
    var NS = 'http://www.w3.org/2000/svg';

    var wrap = doc.createElement('div'); wrap.className = 'spf-prox';
    var ring = doc.createElement('div'); ring.className = 'spf-ring';
    var halo = doc.createElement('i');   halo.className = 'spf-halo';
    var you  = doc.createElement('i');   you.className  = 'spf-you';
    ring.appendChild(halo); ring.appendChild(you);

    var dial = doc.createElementNS(NS, 'svg');
    dial.setAttribute('viewBox', '0 0 100 100');
    dial.setAttribute('class', 'spf-dial');
    var rose = doc.createElementNS(NS, 'g');            // rotates in compass mode
    dial.appendChild(rose);
    var labels = [];
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(function (c) {
      var a = (c[1] - 90) * Math.PI / 180;
      var x = 50 + Math.cos(a) * 44, y = 50 + Math.sin(a) * 44;
      var t = doc.createElementNS(NS, 'text');
      t.setAttribute('x', x.toFixed(2));
      t.setAttribute('y', (y + 2.6).toFixed(2));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('class', c[0] === 'N' ? 'spf-card-n' : 'spf-card');
      t.textContent = c[0];
      rose.appendChild(t);
      // The rose turns; the letters must not. A sideways or upside-down "S" is
      // unreadable exactly when you most need to read it.
      labels.push({ el: t, x: x, y: y });
    });
    var arrows = doc.createElementNS(NS, 'g');
    rose.appendChild(arrows);
    ring.appendChild(dial);

    var word = doc.createElement('div'); word.className = 'spf-word';
    var sub  = doc.createElement('div'); sub.className  = 'spf-sub';
    wrap.appendChild(ring); wrap.appendChild(word); wrap.appendChild(sub);
    container.appendChild(wrap);

    var wasHere = false;
    var ARRIVE_FLOOR_M = 15;      // how close counts as "on it"
    var ARRIVE_MAX_ACC = 30;      // a fix worse than this cannot claim arrival

    function drawArrows(targets, heading) {
      while (arrows.firstChild) arrows.removeChild(arrows.firstChild);
      rose.setAttribute('transform',
        heading == null ? '' : 'rotate(' + (-heading).toFixed(1) + ' 50 50)');
      labels.forEach(function (l) {
        l.el.setAttribute('transform', heading == null ? ''
          : 'rotate(' + heading.toFixed(1) + ' ' + l.x.toFixed(2) + ' ' + l.y.toFixed(2) + ')');
      });
      targets.forEach(function (t, i) {
        if (t.bearingDeg == null) return;
        var g = doc.createElementNS(NS, 'g');
        g.setAttribute('transform', 'rotate(' + t.bearingDeg.toFixed(1) + ' 50 50)');
        var p = doc.createElementNS(NS, 'path');
        var scale = t.primary ? 1 : 0.72;
        var tip = 50 - 26 * scale, base = 50 - 4 * scale, half = 8.5 * scale;
        p.setAttribute('d', 'M50 ' + tip + ' L' + (50 + half) + ' ' + base +
                            ' L50 ' + (base - 5 * scale) + ' L' + (50 - half) + ' ' + base + ' Z');
        p.setAttribute('fill', t.colour || 'currentColor');
        p.setAttribute('opacity', t.primary ? '1' : '.55');
        g.appendChild(p);
        arrows.appendChild(g);
      });
    }

    // targets: [{ key, label, colour, result, bearingDeg, primary }]
    // heading: device heading in degrees, or null for a north-up map dial.
    function update(targets, heading) {
      targets = [].concat(targets || []).filter(Boolean);
      if (!targets.length) {
        word.textContent = 'no fix yet'; sub.textContent = '';
        drawArrows([], heading); return false;
      }
      if (!targets.some(function (t) { return t.primary; })) targets[0].primary = true;
      var main = targets.filter(function (t) { return t.primary; })[0];
      var r = main.result || {};
      drawArrows(targets, heading);
      if (r.distanceM == null) { word.textContent = 'no fix yet'; sub.textContent = ''; return false; }

      var d = r.distanceM, a = r.accuracyM, R = r.radiusM || 92.77;
      var acc = (a == null) ? Infinity : a;
      var arrived = d <= ARRIVE_FLOOR_M && acc <= ARRIVE_MAX_ACC;
      var withinError = !arrived && d <= acc;
      var accepted = r.verdict === 'well-supported';

      var frac = Math.max(0.08, Math.min(1, (4 * R - d) / (4 * R)));
      you.style.width = you.style.height = (10 + frac * 76) + '%';
      wrap.style.setProperty('--spf-accent', main.colour || 'var(--kakapo-bark,#775B24)');

      if (arrived) {
        wrap.classList.add('spf-here');
        wrap.style.color = 'var(--kakapo-moss,#7D9D33)';
        word.textContent = 'You\u2019re standing on it';
        sub.textContent = accepted ? 'well-supported' : r.verdict;
      } else if (withinError) {
        wrap.classList.remove('spf-here');
        wrap.style.color = main.colour || 'var(--kakapo-bark,#775B24)';
        word.textContent = 'Within device error';
        sub.textContent = d.toFixed(0) + ' m away, fix \u00B1' + acc.toFixed(0) + ' m';
      } else {
        wrap.classList.remove('spf-here');
        wrap.style.color = main.colour || 'var(--kakapo-lichen,#CED38C)';
        word.textContent = (d < 1000 ? d.toFixed(0) + ' m' : (d / 1000).toFixed(2) + ' km') +
                           (main.compassText ? ' ' + main.compassText : '');
        sub.textContent = accepted ? 'already close enough to count'
                        : r.verdict === 'fix-too-coarse' ? 'fix too coarse to tell'
                        : r.verdict === 'compatible' ? 'your fix cannot be sure' : 'keep going';
      }

      pulse.lastD = d; pulse.R = R; pulse.arrived = arrived;
      if (arrived && !wasHere) {
        blip(true);
        try { if (doc.defaultView.navigator.vibrate) doc.defaultView.navigator.vibrate(30); }
        catch (e) {}
      }
      wasHere = arrived;
      return arrived;
    }

    return { update: update, el: wrap,
             destroy: function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); } };
  }

  // ── confetti ──────────────────────────────────────────────────────────────

  function confetti(doc, count) {
    var w = doc.defaultView;
    var cv = doc.createElement('canvas');
    cv.className = 'spf-canvas';
    var dpr = w.devicePixelRatio || 1;
    cv.width = w.innerWidth * dpr; cv.height = w.innerHeight * dpr;
    cv.style.width = w.innerWidth + 'px'; cv.style.height = w.innerHeight + 'px';
    doc.body.appendChild(cv);
    var g = null;
    try { g = cv.getContext('2d'); } catch (e) {}
    if (!g) { if (cv.parentNode) cv.parentNode.removeChild(cv); return; }
    g.scale(dpr, dpr);

    var COLS = ['#7D9D33', '#CED38C', '#DCC949', '#BCA888', '#CD8862', '#775B24'];
    var cx = w.innerWidth / 2, cy = w.innerHeight * 0.3, ps = [];
    for (var i = 0; i < count; i++) {
      var ang = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 9;
      ps.push({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 4,
                r: 2 + Math.random() * 4, c: COLS[i % COLS.length],
                rot: Math.random() * 6.3, vr: (Math.random() - .5) * .4, life: 1 });
    }
    var t0 = w.performance ? w.performance.now() : Date.now();
    (function frame(now) {
      var el = ((now || Date.now()) - t0) / 1000;
      g.clearRect(0, 0, w.innerWidth, w.innerHeight);
      var alive = 0;
      ps.forEach(function (p) {
        p.vy += 0.28; p.vx *= 0.995;
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        p.life = Math.max(0, 1 - el / 2.6);
        if (p.life <= 0) return;
        alive++;
        g.save(); g.globalAlpha = p.life; g.translate(p.x, p.y); g.rotate(p.rot);
        g.fillStyle = p.c; g.fillRect(-p.r, -p.r * .6, p.r * 2, p.r * 1.2);
        g.restore();
      });
      if (alive) w.requestAnimationFrame(frame);
      else if (cv.parentNode) cv.parentNode.removeChild(cv);
    })(t0);
  }

  // ── the moment ────────────────────────────────────────────────────────────
  //
  // opts: { kind: 'cornerstone'|'starpin', name, digits, kicker, doc,
  //          order, degree            (cornerstone)
  //          mag                      (starpin) }
  function celebrate(opts) {
    opts = opts || {};
    var doc = opts.doc || document;
    injectCss(doc);
    var isStar = opts.kind === 'starpin';
    var tier = isStar ? starTier(opts.mag)
                      : tierOf(opts.order == null ? 14 : opts.order, opts.degree);
    var quiet = reduced(doc);

    var b = doc.createElement('div');
    b.className = 'spf-banner';
    b.setAttribute('role', 'status');
    function line(cls, text) {
      var d = doc.createElement('div'); d.className = cls; d.textContent = text;
      b.appendChild(d); return d;
    }
    line('spf-kicker', opts.kicker || 'cornerstone bagged');
    line('spf-name', opts.name || '');
    line('spf-rare', tier.label);
    line('spf-blurb', tier.blurb);
    doc.body.appendChild(b);
    doc.defaultView.requestAnimationFrame(function () { b.classList.add('on'); });

    if (!quiet) confetti(doc, tier.particles);
    if (isStar) {
      // Root pitch from brightness: a bright star sounds lower and grander.
      var mg = (opts.mag == null) ? 13 : opts.mag;
      var semis = Math.max(-12, Math.min(7, Math.round((mg - 11) * 1.5)));
      playDorianLead(opts.digits || opts.name || 'starpin',
                     261.626 * Math.pow(2, semis / 12));
    } else {
      ring(opts.digits || (opts.name || '').replace(/\D/g, ''),
           opts.order == null ? 14 : opts.order, tier.rarity);
    }
    try {
      if (doc.defaultView.navigator.vibrate)
        doc.defaultView.navigator.vibrate(tier.rarity > 0.5 ? [40, 60, 90] : [35]);
    } catch (e) {}

    doc.defaultView.setTimeout(function () {
      b.classList.remove('on');
      doc.defaultView.setTimeout(function () {
        if (b.parentNode) b.parentNode.removeChild(b);
      }, 400);
    }, isStar ? 9200 : 3600 + tier.rarity * 1800);

    return tier;
  }

  return {
    VERSION: '0.1',
    unlock: unlock, proximity: proximity, celebrate: celebrate,
    setPulse: setPulse, pulseEnabled: pulseEnabled, hapticsAvailable: hapticsAvailable,
    tierOf: tierOf, starTier: starTier, vertexCount: vertexCount, nearbyCount: nearbyCount,
    composeDorian: composeDorian, playDorianLead: playDorianLead, DORIAN: DORIAN, BPM: BPM,
    spacingM: spacingM, COLLECTIBLE_FLOOR: COLLECTIBLE_FLOOR
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpinFeedback;
