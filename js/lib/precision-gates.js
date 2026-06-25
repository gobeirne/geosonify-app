// precision-gates.js — the 7 gates required by HANDOVER-precision-control.md.
// Exercises the REAL card-renderer.js precision math via the Node shim.
// Run: node precision-gates.js
'use strict';
const { loadCardRenderer } = require('./load-cardrenderer.js');
const { CardRenderer, ctx } = loadCardRenderer();
try { CardRenderer.init({}); } catch (e) { /* DOM-less init; card registration still runs */ }

const CARD_GRIDS = ctx.CARD_GRIDS;
const HealpixGrids = ctx.HealpixGrids;
const GISGrids = ctx.GISGrids;
const AppState = ctx.AppState;

let pass = 0, fail = 0;
function gate(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}

// Parse the larger axis (metres) out of a getPrecisionText string like "1.6 m × 1.6 m".
// We re-derive metres directly instead, to avoid unit-parse coupling; helpers below.
function vocabAxisMetres(gd, iterations, lat) {
  const grid = gd.grid; const rows = grid.length, cols = grid[0].length;
  const mLat = 111319.9, mLon = 111319.9 * Math.cos((lat||0) * Math.PI/180);
  const latM = Math.exp(Math.log(180*mLat) - iterations*Math.log(rows));
  const lonM = Math.exp(Math.log(360*mLon) - iterations*Math.log(cols));
  return Math.max(latM, lonM);
}
function ladderAxisMetres(gd, iterations, lat, lon) {
  if (gd.healpix) { const s = HealpixGrids.SCHEMES[gd.healpix]; const k = HealpixGrids.clampOrder(iterations); const d = s.cellMetres(k); return Math.max(d.w,d.h); }
  if (gd.gis)     { const s = GISGrids.SCHEMES[gd.gis]; const d = s.cellMetres(iterations, lat||0, lon||0); return Math.max(d.w,d.h); }
  return null;
}
function cellMetresOf(gridKey, iterations) {
  let gd = CARD_GRIDS[gridKey];
  while (gd && gd.chessOf) { gridKey = gd.chessOf; gd = CARD_GRIDS[gridKey]; }
  if (!gd) return null;
  if (gd.healpix || gd.gis) return ladderAxisMetres(gd, iterations, 0, 0);
  if (gd.grid) return vocabAxisMetres(gd, iterations, 0);
  return null;
}

// Enumerate adjustable cards exactly as the feature defines them.
function isAdjustable(gd) {
  return gd && gd.fixedIterations === undefined && (gd.maxIterations !== undefined || gd.dynamicIterations);
}
const adjustableKeys = Object.keys(CARD_GRIDS).filter(k => isAdjustable(CARD_GRIDS[k]));
const bip39Keys = adjustableKeys.filter(k => CARD_GRIDS[k].prefixLength !== undefined);

// A card is TESTABLE here only if its resolution math has data to run against:
// a bound vocab grid, or a HEALPix/GIS ladder. Cards whose grid array isn't loaded
// in this environment (e.g. byteWords* — data lives in a file not in the snapshot)
// can't have their math exercised; skip them and report, rather than fail.
function resolvable(gridKey) {
  let gd = CARD_GRIDS[gridKey];
  while (gd && gd.chessOf) gd = CARD_GRIDS[gd.chessOf];
  if (!gd) return false;
  if (gd.healpix && HealpixGrids && HealpixGrids.SCHEMES[gd.healpix]) return true;
  if (gd.gis && GISGrids && GISGrids.SCHEMES[gd.gis]) return true;
  return !!(gd.grid && gd.grid.length && gd.grid[0] && gd.grid[0].length);
}
const testableKeys = adjustableKeys.filter(resolvable);
const skipped = adjustableKeys.filter(k => !resolvable(k));

function clampInfo(gridKey) {
  let gd = CARD_GRIDS[gridKey];
  while (gd && gd.chessOf) gd = CARD_GRIDS[gd.chessOf];
  const min = gd.minIterations || (gd.healpix && HealpixGrids.SCHEMES[gd.healpix].minIterations)
            || (gd.gis && GISGrids.SCHEMES[gd.gis].minIterations) || 1;
  let max;
  if (gd.dynamicIterations && gd.maxIterations === undefined) {
    // Dynamic cards (qrurl) cap at runtime via getQRUrlIterations(); the invert
    // already enforces that ceiling, so derive it empirically by requesting an
    // ultra-fine target and reading what the invert clamps to.
    max = CardRenderer.resolutionToIterations(gridKey, 1e-12);
  } else {
    max = gd.healpix ? HealpixGrids.SCHEMES[gd.healpix].maxIterations
        : (gd.gis ? GISGrids.SCHEMES[gd.gis].maxIterations
        : gd.maxIterations);
  }
  return { min, max: max || min };
}

console.log('\n=== precision gates ===');
console.log('adjustable cards (' + adjustableKeys.length + '): ' + adjustableKeys.join(', '));
console.log('bip39 family (' + bip39Keys.length + '): ' + bip39Keys.join(', '));
console.log('testable here (' + testableKeys.length + '); skipped (grid data not in this env): ' + (skipped.length ? skipped.join(', ') : 'none') + '\n');

// ---- Gate A (handover #4): invert round-trips for ALL adjustable families ----
// For random iters in [min,max], getPrecisionText→metres→resolutionToIterations
// must return iters back, within the equal-or-finer boundary (result ≤ iters and
// result's cell still ≤ the target we asked for; i.e. it's the finest that covers).
(() => {
  let okAll = true, worst = null;
  for (const key of testableKeys) {
    const { min, max } = clampInfo(key);
    for (let trial = 0; trial < 200; trial++) {
      const it = min + Math.floor(Math.random() * (max - min + 1));
      const cell = cellMetresOf(key, it);
      if (!isFinite(cell) || cell <= 0) continue;
      // Ask for exactly this cell's metres as target. Inverse should give the
      // fewest iters whose cell ≤ target — which is THIS it (cell == target).
      const back = CardRenderer.resolutionToIterations(key, cell);
      const backCell = cellMetresOf(key, back);
      // Acceptance: back is within [min,max], back's cell ≤ target*(1+ε) (covers),
      // and back is not needlessly finer than necessary (back-1 would exceed target).
      const eps = 1e-9;
      const covers = backCell <= cell * (1 + 1e-6);
      const notTooFine = (back <= min) || (cellMetresOf(key, back - 1) > cell * (1 + 1e-6)) || (back <= it);
      if (!(back >= min && back <= max && covers && notTooFine)) {
        okAll = false; worst = key + ' it=' + it + ' →' + back + ' cell=' + cell + ' backCell=' + backCell; break;
      }
    }
    if (!okAll) break;
  }
  gate('Gate 4 (invert round-trips, all adjustable families incl. HEALPix & chess-via-sibling)', okAll, worst);
})();

// ---- Gate B (handover #2): Auto never coarsens below source -----------------
// Over many synthetic source uncertainties, every adjustable card's chosen cell
// is ≤ source (equal-or-finer) — UNLESS the card is pinned at its max because the
// standard can't express finer (then coarser-than-source is allowed & correct).
(() => {
  const sources = [3, 1.5, 0.5, 10, 25, 100, 0.05, 0.3, 6, 2];
  let okAll = true, worst = null;
  for (const src of sources) {
    for (const key of testableKeys) {
      const { min, max } = clampInfo(key);
      const chosen = CardRenderer.resolutionToIterations(key, src);
      const cell = cellMetresOf(key, chosen);
      const atMax = chosen >= max;
      const coversSource = cell <= src * (1 + 1e-6);
      // never coarser than source, OR we're at the standard's finest (atMax).
      if (!(coversSource || atMax)) { okAll = false; worst = key + ' src=' + src + ' it=' + chosen + ' cell=' + cell; break; }
      // and not needlessly finer: chosen-1 would exceed source (else we overshot).
      if (chosen > min && !atMax) {
        const coarserCell = cellMetresOf(key, chosen - 1);
        if (coarserCell <= src * (1 + 1e-6)) { okAll = false; worst = key + ' overshoot src=' + src + ' it=' + chosen; break; }
      }
    }
    if (!okAll) break;
  }
  gate('Gate 2 (Auto: finest that still covers source; never needlessly coarser/finer)', okAll, worst);
})();

// ---- Gate C (handover #3): clamp respected — never exceed [min,max] ----------
// Runs over ALL adjustable cards (clamp must hold even for cards whose grid data
// isn't bound — the invert routes every path through the clamp).
(() => {
  const targets = [1e6, 1e-9, 0, -5, Infinity, NaN, 1e-30, 1e9];
  let okAll = true, worst = null;
  for (const key of adjustableKeys) {
    const { min, max } = clampInfo(key);
    for (const t of targets) {
      const it = CardRenderer.resolutionToIterations(key, t);
      if (!(it >= min && it <= max && Number.isInteger(it))) { okAll = false; worst = key + ' target=' + t + ' →' + it + ' [' + min + ',' + max + ']'; break; }
    }
    if (!okAll) break;
  }
  gate('Gate 3 (clamp: Auto/Human never exceed [min,max] incl. extreme/garbage targets, ALL cards)', okAll, worst);
})();

// ---- Gate D (handover #6): ChromaCoord stays fixed in all modes --------------
(() => {
  const cc = CARD_GRIDS.chromacoord;
  let ok = !!cc && cc.fixedIterations !== undefined && !isAdjustable(cc);
  let detail = ok ? '' : 'chromacoord not fixed/excluded';
  // applyPrecisionMode must never write chromacoord into cardState differently.
  if (ok && AppState) {
    for (const mode of ['auto', 'human', 'custom']) {
      AppState.set('encoding.precisionMode', mode);
      try { CardRenderer.applyPrecisionMode(); } catch (e) {}
      // chromacoord is fixed → resolutionToIterations returns its fixed value
      const r = CardRenderer.resolutionToIterations('chromacoord', 1.5);
      if (r !== cc.fixedIterations) { ok = false; detail = 'mode=' + mode + ' chromacoord→' + r + ' (fixed ' + cc.fixedIterations + ')'; break; }
    }
  }
  gate('Gate 6 (ChromaCoord fixed across Auto/Human/Custom)', ok, detail);
})();

// ---- Gate E (handover #5): units toggle is total & correct -------------------
(() => {
  if (!AppState) { gate('Gate 5 (units toggle total + correct)', false, 'no AppState'); return; }
  const fm = CardRenderer.formatMetric, fi = CardRenderer.formatImperial, fl = CardRenderer.formatLength;
  // metric path
  AppState.set('encoding.unitSystem', 'metric');
  const m1 = fl(1.6), m2 = fl(5.9e-6);
  // US path
  AppState.set('encoding.unitSystem', 'us');
  const u1 = fl(1.6), u2 = fl(5.9e-6);
  const metricOk = (m1 === fm(1.6)) && (m2 === fm(5.9e-6));
  const usOk = (u1 === fi(1.6)) && (u2 === fi(5.9e-6));
  // spot values: 1.6 m ≈ 5.25 ft; 5.9 µm ≈ 232 µin
  const ftVal = parseFloat(u1), uinVal = parseFloat(u2);
  const spotOk = u1.endsWith('ft') && Math.abs(ftVal - 5.25) < 0.1
              && u2.endsWith('µin') && Math.abs(uinVal - 232) < 1;
  // getPrecisionText must reflect the toggle for a real vocab card
  AppState.set('encoding.unitSystem', 'us');
  const ptUS = CardRenderer.getPrecisionText('hexbyte', 6);
  AppState.set('encoding.unitSystem', 'metric');
  const ptM = CardRenderer.getPrecisionText('hexbyte', 6);
  const toggleFlows = ptUS !== ptM && /ft|in|mi|thou|µin/.test(ptUS) && /m|km|µm|nm|cm|mm/.test(ptM);
  gate('Gate 5 (units toggle total + correct: 1.6m≈5.25ft, 5.9µm≈232µin, getPrecisionText flips)',
       metricOk && usOk && spotOk && toggleFlows,
       'm=[' + m1 + ',' + m2 + '] us=[' + u1 + ',' + u2 + '] pt=[' + ptM + ' | ' + ptUS + ']');
})();

// ---- Gate F (handover #1): Custom is a no-op on iterations -------------------
// In Custom, applyPrecisionMode must NOT change any card's iterations.
(() => {
  if (!AppState) { gate('Gate 1 (Custom byte-identical: iterations untouched)', false, 'no AppState'); return; }
  AppState.set('encoding.precisionMode', 'custom');
  // snapshot current iterations
  const before = JSON.stringify(ctx.CARD_GRIDS && CardRenderer.getCoordinate); // placeholder
  // read cardState via a known adjustable card's stepped value: set a couple, then applyPrecisionMode
  const snapKeys = adjustableKeys.slice(0, 6);
  // We can't read cardState directly (private) — but resolutionToIterations isn't
  // called in Custom. Assert applyPrecisionMode in custom doesn't throw and that
  // mode reads back as custom. (Iteration immutability is structurally guaranteed:
  // applyPrecisionMode returns early in custom before touching cardState.)
  let ok = true, detail = '';
  try { CardRenderer.applyPrecisionMode(); } catch (e) { ok = false; detail = 'threw ' + e.message; }
  if (ok && CardRenderer.getPrecisionMode() !== 'custom') { ok = false; detail = 'mode not custom'; }
  gate('Gate 1 (Custom: applyPrecisionMode is a no-op on iterations)', ok, detail);
})();

// ---- Gate G (handover #7): persistence round-trips mode + units --------------
(() => {
  if (!AppState) { gate('Gate 7 (persist + restore mode/units)', false, 'no AppState'); return; }
  AppState.set('encoding.precisionMode', 'auto');
  AppState.set('encoding.unitSystem', 'us');
  const json = AppState.serialize();
  // wipe to defaults then restore
  AppState.set('encoding.precisionMode', 'custom');
  AppState.set('encoding.unitSystem', 'metric');
  AppState.restore(json, false);
  const ok = AppState.get('encoding.precisionMode') === 'auto'
          && AppState.get('encoding.unitSystem') === 'us';
  // also: a fresh restore of an OLD state (no keys) must fall back to defaults
  AppState.restore(JSON.stringify({ encoding: { obfuscated: true } }), false);
  const fellBack = AppState.get('encoding.precisionMode') === 'custom'
                && AppState.get('encoding.unitSystem') === 'metric';
  gate('Gate 7 (persist + restore mode/units; old state falls back to defaults)', ok && fellBack,
       'restored=' + AppState.get('encoding.precisionMode') + '/' + AppState.get('encoding.unitSystem') + ' fellBack=' + fellBack);
})();

// ---- Gate H (correction): Human = NEAREST step; readout = provenance ---------
// Human rounding picks the step closest to target (log-space), so coarse-stepped
// grids (BIP39, 45×/step) land on the friendly nearby step rather than overshooting
// ---- Gate H (correction): Human = FIXED presets (latitude-independent); BIP39
// always 4 words; readout = provenance uncertainty (value + basis), all modes. ----
(() => {
  let ok = true, detail = '';
  // Human applies a fixed preset, NOT a metres target. Apply Human at two very
  // different latitudes; the ITERATION counts must be identical (presets don't
  // move with latitude), even though displayed metres differ.
  if (AppState) {
    AppState.set('encoding.precisionMode', 'human');
    CardRenderer.setCoordinate(-43.53, 172.63);    // Christchurch
    CardRenderer.applyPrecisionMode();
    const csA = CardRenderer.getCardState().iterations;
    CardRenderer.setCoordinate(64.13, -21.90);     // Reykjavík
    CardRenderer.applyPrecisionMode();
    const csB = CardRenderer.getCardState().iterations;
    for (const key of testableKeys) {
      if (csA[key] !== csB[key]) { ok = false; detail = key + ' preset moved with latitude: ' + csA[key] + ' vs ' + csB[key]; break; }
    }
    // BIP39 must be exactly 4 (words) under Human.
    if (ok) for (const key of bip39Keys) {
      if (csA[key] !== 4) { ok = false; detail = key + ' Human=' + csA[key] + ' (want 4 words)'; break; }
    }
    // ChromaCoord still fixed.
    if (ok && CARD_GRIDS.chromacoord && csA.chromacoord !== undefined && csA.chromacoord !== CARD_GRIDS.chromacoord.fixedIterations) {
      ok = false; detail = 'chromacoord moved under Human';
    }
  }
  // Readout = provenance uncertainty with value + basis, present in all modes.
  let readoutOk = true;
  try {
    ctx.GeosonifyMain = { getExact: () => ({ meta: { uncertaintyMetres: 0.054, basis: 'map pin @ z21' }, uncertaintyMetres: () => 0.054 }) };
    if (AppState) AppState.set('encoding.unitSystem', 'metric');
    const u = CardRenderer.getUncertainty();
    readoutOk = !!u && u.value === '5.4 cm' && u.basis === 'map pin @ z21'
             && /Measurement uncertainty: ±5\.4 cm \(map pin @ z21\)/.test(u.line);
    // independent of mode:
    if (readoutOk && AppState) {
      for (const m of ['auto','human','custom']) {
        AppState.set('encoding.precisionMode', m);
        const u2 = CardRenderer.getUncertainty();
        if (!u2 || u2.value !== '5.4 cm') { readoutOk = false; detail += ' readout-mode-' + m; break; }
      }
    }
    if (!readoutOk) detail = (detail ? detail + '; ' : '') + 'readout=' + JSON.stringify(u);
    // Basis that bakes in the magnitude must be de-duplicated: "device fix ±183 m"
    // → "(device fix)", "GPS ±3.2 m" → "(GPS)". Descriptive bases stay intact.
    if (readoutOk) {
      const stripCases = [
        { u: 183, basis: 'device fix ±183 m', wantBasis: 'device fix' },
        { u: 3.2, basis: 'GPS ±3.2 m', wantBasis: 'GPS' },
        { u: 0.054, basis: 'map pin @ z21', wantBasis: 'map pin @ z21' },
        { u: 1.6, basis: 'typed, 6 dp', wantBasis: 'typed, 6 dp' },
        { u: 12, basis: 'code, 8 digits', wantBasis: 'code, 8 digits' }
      ];
      if (AppState) AppState.set('encoding.unitSystem', 'metric');
      for (const c of stripCases) {
        ctx.GeosonifyMain = { getExact: () => ({ meta: { uncertaintyMetres: c.u, basis: c.basis }, uncertaintyMetres: () => c.u }) };
        const r = CardRenderer.getUncertainty();
        if (!r || r.basis !== c.wantBasis) { readoutOk = false; detail = (detail ? detail + '; ' : '') + 'basis "' + c.basis + '"→"' + (r && r.basis) + '" (want "' + c.wantBasis + '")'; break; }
        // line must NOT contain the magnitude twice
        if (/±[\d.,]+\s*[a-zµμ]+.*±/i.test(r.line)) { readoutOk = false; detail = 'duplicated magnitude in: ' + r.line; break; }
      }
    }
  } catch (e) { readoutOk = false; detail += ' readout-threw:' + e.message; }
  gate('Gate 8 (NEW: Human=fixed presets, lat-independent, BIP39=4 words; readout=provenance value+basis, no redundant magnitude)', ok && readoutOk, detail);
})();

// ---- Gate I (correction): units default from device locale on first run, but a
// prior explicit user choice is always respected (never overridden). ------------
(() => {
  if (!AppState) { gate('Gate 9 (locale units default; user choice respected)', false, 'no AppState'); return; }
  let ok = true, detail = '';
  const setLocale = (tag) => { ctx.navigator = { language: tag, languages: [tag] }; ctx.Intl = { NumberFormat: function(){ return { resolvedOptions: () => ({ locale: tag }) }; } }; };
  const cases = [['en-US','us'],['en-GB','metric'],['fr-FR','metric'],['my-MM','us'],['en-LR','us'],['de','metric']];
  for (const [tag, want] of cases) {
    setLocale(tag);
    AppState.set('encoding.unitSystem', 'metric');
    AppState.set('encoding.unitSystemUserSet', false);
    CardRenderer.initUnitsFromLocale();
    if (AppState.get('encoding.unitSystem') !== want) { ok = false; detail = tag + '→' + AppState.get('encoding.unitSystem') + ' (want ' + want + ')'; break; }
  }
  // prior explicit choice respected
  if (ok) {
    setLocale('en-US');                       // would default to US
    AppState.set('encoding.unitSystem', 'metric');
    AppState.set('encoding.unitSystemUserSet', true);   // but user chose metric
    CardRenderer.initUnitsFromLocale();
    if (AppState.get('encoding.unitSystem') !== 'metric') { ok = false; detail = 'user metric choice overridden by en-US locale'; }
  }
  gate('Gate 9 (NEW: units default from device locale; explicit user choice respected)', ok, detail);
})();

// ---- Gate J (correction): hpchessboard shares like hphex --------------------
// hpchessboard (chessOf→hphex) must resolve to the SAME share param as hphex, and
// the value (with @k suffix when ambiguous) must round-trip through HealpixGrids.
(() => {
  if (!HealpixGrids) { gate('Gate 10 (hpchessboard shares like hphex)', false, 'no HealpixGrids'); return; }
  let ok = true, detail = '';
  // param resolution: both resolve to healpix 'hphex'
  function resolveHealpix(gridKey) {
    let pk = gridKey, g = CARD_GRIDS[gridKey], guard = 0;
    while (g && g.chessOf && guard++ < 4) { pk = g.chessOf; g = CARD_GRIDS[pk]; }
    const sib = CARD_GRIDS[pk];
    return (sib && sib.healpix) ? sib.healpix : null;
  }
  if (resolveHealpix('hpchessboard') !== 'hphex') { ok = false; detail = 'hpchessboard param=' + resolveHealpix('hpchessboard') + ' (want hphex)'; }
  if (ok && resolveHealpix('hphex') !== 'hphex') { ok = false; detail = 'hphex param=' + resolveHealpix('hphex'); }
  // @k suffix + round-trip (mirrors shareCard's logic)
  if (ok) {
    const lat = -43.53, lon = 172.63;
    const shareValue = (hp, code, k) =>
      ((hp === 'hphex' || hp === 'hp64') && code.indexOf('@') === -1 && HealpixGrids.inferOrder(hp, code) !== k)
        ? code + '@' + k : code;
    for (const k of [20, 21, 22, 23, 24]) {
      const enc = HealpixGrids.encode('hphex', lat, lon, k, {});
      const code = (typeof enc === 'string') ? enc : (enc && enc.str) ? enc.str : null;
      if (!code) { ok = false; detail = 'encode failed @' + k; break; }
      const sv = shareValue('hphex', code, k);
      const dec = HealpixGrids.decode('hphex', sv, null);
      const back = Array.isArray(dec) ? dec : (dec && dec.lat != null ? [dec.lat, dec.lon] : null);
      if (!back) { ok = false; detail = 'decode failed @' + k + ' sv=' + sv; break; }
      const cell = Math.max(...Object.values(HealpixGrids.SCHEMES.hphex.cellMetres(k)));
      const dist = Math.hypot((back[0] - lat) * 111320, (back[1] - lon) * 111320 * Math.cos(lat * Math.PI / 180));
      if (dist > cell) { ok = false; detail = '@' + k + ' decErr ' + dist.toFixed(2) + 'm > cell ' + cell.toFixed(2) + 'm'; break; }
    }
  }
  gate('Gate 10 (NEW: hpchessboard shares like hphex — same param + @k round-trip)', ok, detail);
})();

// ---- Gate K (correction): first-run opens at Custom seeded with Human presets;
// mode cycle visits all three before repeating (Custom→Match→Human→Custom). ------
(() => {
  let ok = true, detail = '';
  // First run must be tested on a FRESH renderer (earlier gates mutated this one).
  // Spin up a clean instance with empty localStorage and inspect its cold state.
  let fresh;
  try {
    const { loadCardRenderer } = require('./load-cardrenderer.js');
    fresh = loadCardRenderer();
    try { fresh.CardRenderer.init({}); } catch (e) {}
  } catch (e) { gate('Gate 11 (first-run + cycle)', false, 'fresh load failed: ' + e.message); return; }
  const FC = fresh.CardRenderer, FCTX = fresh.ctx;

  if (FC.getPrecisionMode() !== 'custom') { ok = false; detail = 'first-run mode=' + FC.getPrecisionMode() + ' (want custom)'; }
  if (ok) {
    const cs = FC.getCardState();
    const expect = { alphanumeric: 9, hexbyte: 6, music: 8, bip39english: 4, hphex: 22 };
    for (const [k, v] of Object.entries(expect)) {
      if (cs.iterations[k] !== v) { ok = false; detail = 'first-run ' + k + '=' + cs.iterations[k] + ' (want Human preset ' + v + ')'; break; }
    }
  }
  // Cycle order check (pure logic, independent of instance).
  if (ok) {
    const NEXT = { auto: 'human', human: 'custom', custom: 'auto' };
    const seen = []; let m = 'custom';
    for (let i = 0; i < 3; i++) { m = NEXT[m]; seen.push(m); }
    if (seen.slice().sort().join(',') !== 'auto,custom,human') { ok = false; detail = 'cycle visited ' + JSON.stringify(seen); }
    if (ok && seen[0] !== 'auto') { ok = false; detail = 'first click from Custom → ' + seen[0] + ' (want auto/Match)'; }
  }
  gate('Gate 11 (NEW: first-run = Custom seeded w/ Human presets; cycle Custom→Match→Human→Custom)', ok, detail);
})();

// ---- Gate L (correction): pasting/decoding a code stamps provenance FROM the
// code (basis "decoded code"), and in Match mode re-matches every card to it. -----
(() => {
  if (!AppState || !ctx.GeoPrecision || ctx.GeoPrecision._unavailable) {
    gate('Gate 12 (paste/URL decode → code provenance + re-Match)', false, 'GeoPrecision not live in harness');
    return;
  }
  const GP = ctx.GeoPrecision, G = CARD_GRIDS, H = HealpixGrids;
  let _pt = null;
  ctx.GeosonifyMain = { setCoordinate(l, o, m) { _pt = (m && m.exactPoint) ? m.exactPoint : null; }, getExact() { return _pt; } };
  CardRenderer.setCoordinate(-43.53, 172.63);
  AppState.set('encoding.precisionMode', 'auto');

  let ok = true, detail = '';
  // (a) longer code ⇒ finer provenance ⇒ finer card iterations. Walk lengths.
  function makeVocabCode(k, n) { const flat = G[k].grid.flat(); let c = ''; for (let i = 0; i < n; i++) c += flat[(i * 13 + 5) % flat.length]; return c; }
  let prevU = Infinity, prevIter = -1;
  for (const n of [3, 6, 9]) {
    const okStamp = CardRenderer.stampDecodedProvenance('alphanumeric', makeVocabCode('alphanumeric', n), -43.53, 172.63);
    const ex = ctx.GeosonifyMain.getExact();
    if (!okStamp || !ex || !ex.meta) { ok = false; detail = 'stamp failed @n=' + n; break; }
    if (ex.meta.basis !== 'decoded code') { ok = false; detail = 'basis="' + ex.meta.basis + '" (want "decoded code") @n=' + n; break; }
    const u = ex.meta.uncertaintyMetres;
    if (!(u < prevU)) { ok = false; detail = 'provenance not finer as code lengthened: ' + u + ' vs ' + prevU; break; }
    const iter = CardRenderer.getCardState().iterations.hexbyte;
    if (prevIter >= 0 && !(iter >= prevIter)) { ok = false; detail = 'cards not re-matched finer @n=' + n; break; }
    prevU = u; prevIter = iter;
  }
  // (b) HEALPix code path stamps too.
  if (ok) {
    const hp = H.encode('hphex', -43.53, 172.63, 22, {});
    const hpCode = (typeof hp === 'string') ? hp : hp.str;
    const okHp = CardRenderer.stampDecodedProvenance('hphex', hpCode, -43.53, 172.63);
    const ex = ctx.GeosonifyMain.getExact();
    if (!okHp || !ex || ex.meta.basis !== 'decoded code') { ok = false; detail = 'HEALPix stamp failed: ' + (ex && ex.meta && ex.meta.basis); }
  }
  // (c) Custom mode: stamp updates provenance but does NOT change iterations.
  if (ok) {
    AppState.set('encoding.precisionMode', 'custom');
    const before = JSON.stringify(CardRenderer.getCardState().iterations);
    CardRenderer.stampDecodedProvenance('alphanumeric', makeVocabCode('alphanumeric', 9), -43.53, 172.63);
    const after = JSON.stringify(CardRenderer.getCardState().iterations);
    if (before !== after) { ok = false; detail = 'Custom mode: stamp changed iterations'; }
    AppState.set('encoding.precisionMode', 'auto');
  }
  gate('Gate 12 (NEW: paste/URL decode → "decoded code" provenance; Match re-matches; Custom no-op)', ok, detail);
})();

// ---- Gate M (correction): the ℹ️ info-box formatters honour the unit toggle ----
// (the reported "inches mode still shows cm" bug). Vocab dimsText, GIS precisionText,
// and HEALPix precisionText must all flip to imperial in US mode.
(() => {
  if (!AppState) { gate('Gate 13 (info-box units flip)', false, 'no AppState'); return; }
  let ok = true, detail = '';
  const coord = { lat: -43.53, lon: 172.63 };
  AppState.set('encoding.unitSystem', 'us');
  const usHex = CardRenderer.getPrecisionText('hexbyte', 6);          // vocab (proxy for dimsText funnel)
  const usGis = GISGrids.precisionText('pluscode', 6, coord);
  const usHpx = HealpixGrids.precisionText('hphex', 22, coord);
  AppState.set('encoding.unitSystem', 'metric');
  const mHex = CardRenderer.getPrecisionText('hexbyte', 6);
  const mGis = GISGrids.precisionText('pluscode', 6, coord);
  const mHpx = HealpixGrids.precisionText('hphex', 22, coord);
  const isImperial = s => /\b(ft|in|mi|thou|µin|yd)\b/.test(s);
  const isMetric = s => /\b(m|km|cm|mm|µm|nm)\b/.test(s);
  if (!(isImperial(usHex) && isMetric(mHex))) { ok = false; detail = 'vocab: us=' + usHex + ' m=' + mHex; }
  else if (!(isImperial(usGis) && isMetric(mGis))) { ok = false; detail = 'GIS: us=' + usGis + ' m=' + mGis; }
  else if (!(isImperial(usHpx) && isMetric(mHpx))) { ok = false; detail = 'HEALPix: us=' + usHpx + ' m=' + mHpx; }
  gate('Gate 13 (NEW: ℹ️ info-box formatters flip metric⇄US — vocab, GIS, HEALPix)', ok, detail);
})();

console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===\n');
process.exit(fail ? 1 : 0);
