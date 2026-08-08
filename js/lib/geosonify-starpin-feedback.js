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

  function tierOf(order, degree) {
    if (degree === 3) return {
      key: 'exceptional', label: 'one of only eight',
      rarity: 1, particles: 400,
      blurb: 'A three-cell vertex. There are eight on the planet, at every ' +
             'order, forever. They are worth no points at all.'
    };
    var n = vertexCount(order), r;
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

  function proximity(container) {
    var doc = container.ownerDocument || document;
    injectCss(doc);
    var wrap = doc.createElement('div'); wrap.className = 'spf-prox';
    var ring = doc.createElement('div'); ring.className = 'spf-ring';
    var halo = doc.createElement('i');   halo.className = 'spf-halo';
    var you  = doc.createElement('i');   you.className  = 'spf-you';
    ring.appendChild(halo); ring.appendChild(you);
    var word = doc.createElement('div'); word.className = 'spf-word';
    var sub  = doc.createElement('div'); sub.className  = 'spf-sub';
    wrap.appendChild(ring); wrap.appendChild(word); wrap.appendChild(sub);
    container.appendChild(wrap);

    var wasHere = false;

    // TWO SEPARATE THINGS, and conflating them is what made arrival feel fake:
    //
    //   ARRIVAL  — you are physically on the point. Tight: within the fix's own
    //              uncertainty, or 10 m, whichever is larger. This is the moment.
    //   ACCEPTED — the record is well-supported under visit-geometry-v1. R is
    //              deliberately generous (~93 m) so a starpin behind a fence can
    //              be logged from the footpath. That is a rule, not a feeling.
    //
    // Saying "you're standing on it" at 60 m would be a lie, and would also
    // devalue the moment when it is true.
    var ARRIVE_FLOOR_M = 10;

    // r: a visit-geometry-v1 result from assessVisit(). compassText optional.
    function update(r, compassText) {
      if (!r || r.distanceM == null) {
        word.textContent = 'no fix yet'; sub.textContent = ''; return false;
      }
      var d = r.distanceM, a = r.accuracyM, R = r.radiusM;
      var arrived = d <= Math.max(a == null ? 0 : a, ARRIVE_FLOOR_M);
      var accepted = r.verdict === 'well-supported';

      // Scale: the halo is R. Beyond 4R everything looks the same, and should.
      var frac = Math.max(0.08, Math.min(1, (4 * R - d) / (4 * R)));
      you.style.width = you.style.height = (10 + frac * 76) + '%';

      if (arrived) {
        wrap.classList.add('spf-here');
        wrap.style.color = 'var(--kereru-green,#51806a)';
        word.textContent = 'You\u2019re standing on it';
        // RULE 1: no metres here. There is nothing left to chase, and shuffling
        // about for the last metre earns exactly nothing.
        sub.textContent = accepted ? 'well-supported' : r.verdict;
      } else if (accepted) {
        wrap.classList.remove('spf-here');
        wrap.style.color = 'var(--kereru-teal,#325756)';
        word.textContent = d.toFixed(0) + ' m' + (compassText ? ' ' + compassText : '');
        sub.textContent = 'already close enough to count';
      } else if (r.verdict === 'fix-too-coarse') {
        wrap.classList.remove('spf-here');
        wrap.style.color = 'var(--kereru-lavender,#A092B7)';
        word.textContent = 'Fix too coarse to tell';
        sub.textContent = '\u00B1' + a.toFixed(0) + ' m, wider than the radius';
      } else {
        wrap.classList.remove('spf-here');
        wrap.style.color = 'var(--kereru-lavender,#A092B7)';
        word.textContent = (d < 1000 ? d.toFixed(0) + ' m' : (d / 1000).toFixed(2) + ' km') +
                           (compassText ? ' ' + compassText : '');
        sub.textContent = r.verdict === 'compatible' ? 'your fix cannot be sure' : 'keep going';
      }

      pulse.lastD = d; pulse.R = R; pulse.arrived = arrived;

      var here = arrived;
      if (here && !wasHere) {
        blip(true);
        try { if (doc.defaultView.navigator.vibrate) doc.defaultView.navigator.vibrate(30); }
        catch (e) {}
      }
      wasHere = here;
      return here;
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

    var COLS = ['#325756', '#7d9fc2', '#C582B2', '#51806a', '#4d5f8e', '#A092B7'];
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
  // opts: { name, order, degree, digits, kicker, doc }
  function celebrate(opts) {
    opts = opts || {};
    var doc = opts.doc || document;
    injectCss(doc);
    var tier = tierOf(opts.order == null ? 14 : opts.order, opts.degree);
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
    ring(opts.digits || (opts.name || '').replace(/\D/g, ''),
         opts.order == null ? 14 : opts.order, tier.rarity);
    try {
      if (doc.defaultView.navigator.vibrate)
        doc.defaultView.navigator.vibrate(tier.rarity > 0.5 ? [40, 60, 90] : [35]);
    } catch (e) {}

    doc.defaultView.setTimeout(function () {
      b.classList.remove('on');
      doc.defaultView.setTimeout(function () {
        if (b.parentNode) b.parentNode.removeChild(b);
      }, 400);
    }, 3600 + tier.rarity * 1800);

    return tier;
  }

  return {
    VERSION: '0.1',
    unlock: unlock, proximity: proximity, celebrate: celebrate,
    setPulse: setPulse, pulseEnabled: pulseEnabled, hapticsAvailable: hapticsAvailable,
    tierOf: tierOf, vertexCount: vertexCount, nearbyCount: nearbyCount,
    spacingM: spacingM, COLLECTIBLE_FLOOR: COLLECTIBLE_FLOOR
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpinFeedback;
