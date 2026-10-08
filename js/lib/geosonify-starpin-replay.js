/*
  geosonify-starpin-replay.js v0.1 — hear a find again; see a drive-by run as one thing

  Two log-view features, both DERIVED from the records and never stored:

  1. REPLAY. Every starpin and cornerstone already has its own sound, made from
     its identity when it was bagged: a starpin's Dorian lead is seeded by its
     source_id and pitched by its magnitude; a cornerstone's arpeggio comes from
     its name's digits and its tier. Nothing about that sound is random, so the
     log can play it again exactly. celebrateOptsFor() rebuilds the SAME opts
     the bag-time call site passed to F.celebrate(), and F.soundOf() turns
     those opts into the sound for both paths, so the two cannot drift apart.

     A culmination-attempt also replays its run-up and chord, derived from the
     spot where the record's fix was taken. The run heard live came from the
     live fix twelve seconds earlier, and the last digits of an order-22
     address change within a metre, so the replay is the run OF THE LOGGED
     SPOT -- close, but not guaranteed note-for-note what played at the time.

  2. RUNS. A run is a chain of records logged in quick succession while moving
     at vehicle speed: consecutive (in time) records joined when they are at
     most 45 minutes apart AND the straight-line speed between them is 25-200
     km/h. 25 sits above bike pace between pins (10-15 km/h in the field
     data); 200 stops a flight joining two pins. A find belongs to a run only
     if EVERY record for it falls inside that run: a pin you later walked back
     to, or bagged on foot first, is its own memory and stays standalone.

  Browser: window.GeosonifyStarpinReplay.   Node: require('./geosonify-starpin-replay.js').
  No dependencies; the app hands in F, S, csName, sourceIdOf and HealpixGrids.
*/
'use strict';

var GeosonifyStarpinReplay = (function () {

  var RUN_DEFAULTS = { maxGapMs: 45 * 60000, minKmh: 25, maxKmh: 200, minPins: 2 };

  function haversineM(lat1, lon1, lat2, lon2) {
    var D = Math.PI / 180;
    var p = (lat2 - lat1) * D, q = (lon2 - lon1) * D;
    var h = Math.sin(p / 2) * Math.sin(p / 2) +
            Math.cos(lat1 * D) * Math.cos(lat2 * D) * Math.sin(q / 2) * Math.sin(q / 2);
    return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
  }

  // When and where the record was TAKEN. The fix carries its own timestamp;
  // the event time is the fallback for anything older.
  function whenMs(r) {
    if (r && r.fix && r.fix.time_ms != null) return r.fix.time_ms;
    return r && r.event ? r.event.time_ms : null;
  }
  function where(r) {
    if (!r || !r.fix || r.fix.lat_1e7 == null || r.fix.lon_1e7 == null) return null;
    return { lat: r.fix.lat_1e7 / 1e7, lon: r.fix.lon_1e7 / 1e7 };
  }

  // ── runs ──────────────────────────────────────────────────────────────────
  //
  // records: the CURRENT records (superseded ones already removed).
  // Returns { runs: [{ index, records, startMs, endMs, km, avgKmh }],
  //           runOf: { record_id: runIndex } }.
  function findRuns(records, opts) {
    opts = opts || {};
    var o = {};
    Object.keys(RUN_DEFAULTS).forEach(function (k) {
      o[k] = opts[k] != null ? opts[k] : RUN_DEFAULTS[k];
    });
    var pts = (records || []).filter(function (r) {
      return whenMs(r) != null && where(r);
    }).map(function (r) { return { r: r, t: whenMs(r), p: where(r) }; });
    pts.sort(function (a, b) { return a.t - b.t || (a.r.record_id < b.r.record_id ? -1 : 1); });

    // Chains of linked neighbours. Two records at the same instant (a visit and
    // its culmination-attempt, say) share a moment: they never link on speed,
    // but neither do they break a chain -- the second simply rides along.
    var chains = [], cur = pts.length ? [pts[0]] : [];
    for (var i = 1; i < pts.length; i++) {
      var a = cur[cur.length - 1], b = pts[i];
      var dt = (b.t - a.t) / 1000;
      var linked = false;
      if (dt === 0) linked = cur.length > 1 || false;
      else if (dt * 1000 <= o.maxGapMs) {
        var kmh = haversineM(a.p.lat, a.p.lon, b.p.lat, b.p.lon) / dt * 3.6;
        linked = kmh >= o.minKmh && kmh <= o.maxKmh;
      }
      if (linked) cur.push(b);
      else { chains.push(cur); cur = [b]; }
    }
    if (cur.length) chains.push(cur);

    var runs = [], runOf = {};
    chains.forEach(function (c) {
      if (c.length < o.minPins) return;
      var m = 0;
      for (var j = 1; j < c.length; j++)
        m += haversineM(c[j - 1].p.lat, c[j - 1].p.lon, c[j].p.lat, c[j].p.lon);
      var ms = c[c.length - 1].t - c[0].t;
      var run = { index: runs.length, records: c.map(function (x) { return x.r; }),
                  startMs: c[0].t, endMs: c[c.length - 1].t, km: m / 1000,
                  avgKmh: ms > 0 ? (m / 1000) / (ms / 3600000) : null };
      run.records.forEach(function (r) { runOf[r.record_id] = run.index; });
      runs.push(run);
    });
    return { runs: runs, runOf: runOf };
  }

  // The run a FIND belongs to, or null. Every record for the find must sit in
  // the same run; one record outside it and the find stands on its own.
  function runForGroup(records, runOf) {
    var idx = null;
    for (var i = 0; i < records.length; i++) {
      var k = runOf[records[i].record_id];
      if (k == null) return null;
      if (idx == null) idx = k; else if (idx !== k) return null;
    }
    return idx;
  }

  // ── what a find sounds like ───────────────────────────────────────────────
  //
  // Mirrors the bag-time call sites in starpin-demo.html exactly:
  //   starpin      F.celebrate({ kind:'starpin', name, mag, digits: source_id })
  //   cornerstone  F.celebrate({ kind:'cornerstone', name, order: tierOrder,
  //                              degree, digits: name.replace(/\D/g,'') })
  // If either call site changes, change this with it -- the selftest pins it.
  function celebrateOptsFor(rec, deps) {
    var t = rec && rec.target;
    if (!t) return null;
    if (t.starpin) {
      var id = deps.sourceIdOf(t.starpin);
      return { kind: 'starpin', name: 'Gaia DR3 ' + id,
               mag: t.mag_g != null ? Number(t.mag_g) : null, digits: id };
    }
    if (t.cornerstone) {
      var name = deps.csName ? deps.csName(t.cornerstone) : t.cornerstone;
      var pt = deps.S.cornerstonePoint(name);
      var m = /\.([0-3]+)(?:c[0-3])?$/.exec(name);
      var probe = deps.S.nearestCornerstone(pt.lat, pt.lon, m ? m[1].length : 14);
      return { kind: 'cornerstone', name: name, order: probe.tierOrder,
               degree: probe.degree, digits: name.replace(/\D/g, '') };
    }
    return null;
  }

  // The culmination run-up for a culmination-attempt record, from its fix.
  // Same derivation as the live bar: the hpquad digits after the face.
  function culminationSpecFor(rec, deps) {
    var p = where(rec);
    if (!p || !deps.H) return null;
    var q = '';
    try { q = deps.H.encode('hpquad', p.lat, p.lon, 22).split('.')[1] || ''; }
    catch (e) { return null; }
    return { kind: 'run', quaternary: q, scaleId: 'dorian' };
  }

  // ── the log UI ────────────────────────────────────────────────────────────

  var CSS_ID = 'starpin-replay-css';
  var CSS = [
    // The disc IS the find's voice. A small note badge says it can speak.
    '.rec .disc.playable{position:relative;cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.rec .disc.playable::after{content:"\\266A";position:absolute;right:-5px;bottom:-5px;',
    '  width:17px;height:17px;border-radius:50%;display:grid;place-items:center;',
    '  font-size:10px;line-height:1;background:var(--card,#fff);color:var(--ink-2,#5A6348);',
    '  box-shadow:0 0 0 1.5px var(--line,#DFE3CE)}',
    '.rec.common .disc.playable::after{width:13px;height:13px;font-size:8px;right:-4px;bottom:-4px}',
    '.rec .disc.playable:focus-visible{outline:3px solid var(--sun,#DCC949);outline-offset:2px}',
    '@keyframes spr-sing{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--sun,#DCC949) 70%,transparent)}',
    '  100%{box-shadow:0 0 0 14px transparent}}',
    '.rec .disc.playing{animation:spr-sing 1s ease-out infinite}',
    '.rec .disc.playing::after{content:"\\25A0";color:var(--rust-deep,#8E5433)}',
    '.visitline.culm.playable{cursor:pointer}',
    '.visitline.culm.playable .vl-label::after{content:" \\25B6";font-size:.7em}',
    '.visitline.culm.playing .vl-label::after{content:" \\25A0"}',
    // A run: one quiet row standing for many finds; open it to see them.
    '.run{margin-bottom:.6rem;border-radius:18px;border:2px solid color-mix(in srgb,#4E6E8E 40%,var(--line,#DFE3CE));',
    '  background:color-mix(in srgb,#4E6E8E 7%,var(--card,#fff));overflow:hidden}',
    '.run-head{all:unset;box-sizing:border-box;display:flex;gap:.7rem;align-items:center;',
    '  width:100%;padding:.75rem .8rem;cursor:pointer}',
    '.run-head:focus-visible{outline:3px solid var(--sun,#DCC949);outline-offset:-3px}',
    '.run-glyph{flex:0 0 auto;width:44px;height:44px;border-radius:14px;display:grid;',
    '  place-items:center;background:#4E6E8E;color:#fff;font-weight:800;font-size:1rem}',
    '.run-text{flex:1;min-width:0}',
    '.run-title{font-weight:800;font-size:.86rem;line-height:1.3}',
    '.run-meta{font-size:.74rem;color:var(--ink-2,#5A6348);margin-top:.15rem;line-height:1.4}',
    '.run-chev{flex:0 0 auto;font-size:.9rem;color:var(--ink-2,#5A6348);transition:transform .2s}',
    '.run.open .run-chev{transform:rotate(90deg)}',
    '.run-body{padding:0 .5rem .1rem}',
    '.run-body[hidden]{display:none}',
    '.runs-toggle{display:flex;align-items:center;gap:.45rem;font-size:.78rem;font-weight:700;',
    '  color:var(--ink-2,#5A6348);white-space:nowrap;flex:0 0 auto}',
    '.runs-toggle input{width:auto;margin:0;accent-color:#4E6E8E}',
    '@media (prefers-reduced-motion:reduce){.rec .disc.playing{animation:none;',
    '  box-shadow:0 0 0 3px var(--sun,#DCC949)}}'
  ].join('');

  function injectCss(doc) {
    if (doc.getElementById(CSS_ID)) return;
    var st = doc.createElement('style');
    st.id = CSS_ID; st.textContent = CSS;
    doc.head.appendChild(st);
  }

  // One thing plays at a time, app-wide. Tapping another find stops the first.
  var playingEl = null, playingHandle = null;
  function stopPlaying() {
    var el = playingEl, h = playingHandle;
    playingEl = null; playingHandle = null;
    if (el) el.classList.remove('playing');
    if (h && h.stop) h.stop();
  }
  function toggle(el, spec, F) {
    if (playingEl === el) { stopPlaying(); return; }
    stopPlaying();
    if (!spec || !F || !F.replay) return;
    el.classList.add('playing');
    playingEl = el;
    playingHandle = F.replay(spec, function () {
      if (playingEl === el) { el.classList.remove('playing'); playingEl = null; playingHandle = null; }
    });
    if (!playingHandle) { el.classList.remove('playing'); playingEl = null; }
  }

  function makePlayable(el, label, getSpec, F) {
    var doc = el.ownerDocument;
    injectCss(doc);
    el.classList.add('playable');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', label);
    el.title = label;
    function go(e) {
      if (e) { e.stopPropagation(); }
      if (F.unlock) F.unlock();          // a tap is a gesture: wake audio here
      var spec = null;
      try { spec = getSpec(); } catch (err) { spec = null; }
      toggle(el, spec, F);
    }
    el.addEventListener('click', go);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(e); }
    });
  }

  // gp: one collapsed find from collapseByTarget ({ rep, records, ... }).
  function wireDisc(disc, gp, deps) {
    var isStar = !!(gp.rep && gp.rep.target && gp.rep.target.starpin);
    makePlayable(disc, isStar ? 'Play this starpin’s tune' : 'Play this cornerstone’s chime',
      function () { return celebrateOptsFor(gp.rep, deps); }, deps.F);
  }

  // The gold "at culmination" line replays the run-up and the chord.
  function wireCulmLine(rowEl, gp, ms, deps) {
    var rec = (gp.records || []).filter(function (r) {
      return r.kind === 'culmination-attempt' && r.event && r.event.time_ms === ms;
    })[0];
    if (!rec || !deps.H) return;
    makePlayable(rowEl, 'Play the culmination run-up from where you stood',
      function () { return culminationSpecFor(rec, deps); }, deps.F);
  }

  // ── runs in the log ───────────────────────────────────────────────────────
  //
  // runUI(box, groups, deps) returns { place(slot, gp) } or null when grouping
  // is off. place() puts a find either straight into the log, or into its run's
  // row, which is created the first time one of its finds comes past -- so the
  // run sits where its newest (or oldest) find would have sat.
  var PREF = 'starpin.log.runs';
  function grouping() {
    try { return localStorage.getItem(PREF) !== '0'; } catch (e) { return true; }
  }
  function setGrouping(on) {
    try { localStorage.setItem(PREF, on ? '1' : '0'); } catch (e) {}
  }

  function fmtRange(a, b) {
    var d1 = new Date(a), d2 = new Date(b);
    var day = d1.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    var t = function (d) { return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };
    var sameDay = d1.toDateString() === d2.toDateString();
    return day + ', ' + t(d1) + '–' + (sameDay ? '' : d2.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ') + t(d2);
  }

  function runUI(box, groups, deps) {
    if (!grouping()) return null;
    var doc = box.ownerDocument;
    injectCss(doc);
    var all = [];
    groups.forEach(function (g) { all = all.concat(g.records); });
    var found = findRuns(all, deps.runOpts);
    if (!found.runs.length) return null;

    var gRun = new Map(), members = {};
    groups.forEach(function (g) {
      var k = runForGroup(g.records, found.runOf);
      if (k != null) { gRun.set(g, k); members[k] = (members[k] || 0) + 1; }
    });
    var shells = {};
    function shell(k) {
      if (shells[k]) return shells[k];
      var run = found.runs[k];
      var wrap = doc.createElement('div'); wrap.className = 'run';
      var head = doc.createElement('button'); head.type = 'button'; head.className = 'run-head';
      head.setAttribute('aria-expanded', 'false');
      var glyph = doc.createElement('div'); glyph.className = 'run-glyph';
      glyph.textContent = String(members[k]);
      var text = doc.createElement('div'); text.className = 'run-text';
      var title = doc.createElement('div'); title.className = 'run-title';
      title.textContent = 'Drive-by run · ' + members[k] + ' find' + (members[k] === 1 ? '' : 's');
      var meta = doc.createElement('div'); meta.className = 'run-meta';
      meta.textContent = fmtRange(run.startMs, run.endMs) + ' · ' +
        (run.km < 10 ? run.km.toFixed(1) : Math.round(run.km)) + ' km' +
        (run.avgKmh != null ? ' at ' + Math.round(run.avgKmh) + ' km/h' : '');
      text.appendChild(title); text.appendChild(meta);
      var chev = doc.createElement('div'); chev.className = 'run-chev'; chev.textContent = '▸';
      head.appendChild(glyph); head.appendChild(text); head.appendChild(chev);
      var body = doc.createElement('div'); body.className = 'run-body'; body.hidden = true;
      head.addEventListener('click', function () {
        body.hidden = !body.hidden;
        wrap.classList.toggle('open', !body.hidden);
        head.setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
      });
      wrap.appendChild(head); wrap.appendChild(body);
      box.appendChild(wrap);
      shells[k] = body;
      return body;
    }
    return {
      runs: found.runs,
      place: function (slot, gp) {
        var k = gRun.get(gp);
        if (k == null || members[k] < (deps.runOpts && deps.runOpts.minFinds || 2)) {
          box.appendChild(slot); return;
        }
        shell(k).appendChild(slot);
      }
    };
  }

  // The checkbox beside the sort. onChange redraws the log.
  function mountToggle(host, onChange) {
    if (!host || host.querySelector('.runs-toggle')) return;
    var doc = host.ownerDocument;
    injectCss(doc);
    var lab = doc.createElement('label'); lab.className = 'runs-toggle';
    var cb = doc.createElement('input'); cb.type = 'checkbox'; cb.id = 'lg-runs';
    cb.checked = grouping();
    cb.addEventListener('change', function () { setGrouping(cb.checked); if (onChange) onChange(); });
    lab.appendChild(cb);
    lab.appendChild(doc.createTextNode('group drive-by runs'));
    host.appendChild(lab);
  }

  return {
    VERSION: '0.1', RUN_DEFAULTS: RUN_DEFAULTS,
    findRuns: findRuns, runForGroup: runForGroup,
    celebrateOptsFor: celebrateOptsFor, culminationSpecFor: culminationSpecFor,
    wireDisc: wireDisc, wireCulmLine: wireCulmLine, stop: stopPlaying,
    runUI: runUI, mountToggle: mountToggle, grouping: grouping, setGrouping: setGrouping
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GeosonifyStarpinReplay;
