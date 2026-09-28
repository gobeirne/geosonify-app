#!/usr/bin/env node
/**
 * hpwords-checksum-eval.js — reproducible evidence for the healpix-bip39-v1 checksum.
 *
 *   node spec/hpwords-checksum-eval.js              # guarantees + confusion evaluation
 *   node spec/hpwords-checksum-eval.js --profiles   # also validate the draft spoken profiles
 *
 * Inputs (all pinned, all in the repo):
 *   - word lists:   js/lib/bip39-official-wordlists.js (SHA-256 per list, checked here)
 *   - confusion table v0: confusionGroups in spec/hpwords-spoken-profiles-draft.js
 *   - checksum:     HealpixWords.checksumValue (the candidate for freezing)
 *   - comparator:   CRC32C(UTF-8 "healpix-bip39-v1|N|i1,…,iN") mod 1000
 *
 * Method, stated so results can be quoted precisely:
 *   A. EXHAUSTIVE guarantees of the weighted checksum (context-free — the weighted
 *      sum's change depends only on positions and index deltas).
 *   B. Known single confusions: every on-list pair (both words in the 2048 list) in
 *      confusion table v0, every language. Weighted: exhaustive and context-free
 *      (miss ⇔ 997 | Δindex). CRC: depends on the surrounding words, so it is SAMPLED
 *      with K seeded random contexts per (pair, direction, position).
 *   C. Known double confusions: two on-list pairs (same language) in two distinct
 *      positions of a 4-word code, both directions. Weighted: exhaustive over all such
 *      combinations (context-free). CRC: K seeded random contexts per combination.
 *   Position 0 only receives words with index < 1536, for BOTH the original and the
 *   confused word (a first index ≥ 1536 is rejected before any checksum: a different
 *   detection mechanism, excluded from these counts). An earlier ad-hoc run filtered
 *   only the original word and reported 66,444 double cases; this rule gives 64,920
 *   (77,904 unfiltered). The weighted miss count is 12 under both rules.
 *   Results describe THIS test set; they are not a claim of optimality.
 */
'use strict';
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const lib = f => path.join(ROOT, 'js', 'lib', f);
globalThis.HealpixGrids = require(lib('geosonify-healpix.js'));
globalThis.BIP39_OFFICIAL_WORDLISTS = require(lib('bip39-official-wordlists.js'));
const HW = require(lib('geosonify-hpwords.js'));
const PROFILES = require(path.join(__dirname, 'hpwords-spoken-profiles-draft.js'));
globalThis.HPWORDS_SPOKEN_PROFILES = PROFILES;

const K_CONTEXTS = 16;           // CRC contexts per sampled case
const SEED = 20260929;
let seed = SEED >>> 0;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);

const T = [...Array(256)].map((_, i) => { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0x82F63B78 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crcStr = s => { let c = ~0 >>> 0; for (const b of Buffer.from(s, 'utf8')) c = T[(c ^ b) & 255] ^ (c >>> 8); return (~c) >>> 0; };
const CRC = v => crcStr(`healpix-bip39-v1|${v.length}|${v.join(',')}`) % 1000;
const W = v => HW.checksumValue(v);
const WT = HW.WEIGHTS, P = 997;

const out = [];
const say = s => { out.push(s); console.log(s); };
say(`healpix-bip39-v1 checksum evaluation · seed ${SEED} · CRC contexts/case ${K_CONTEXTS} · node ${process.version}`);

// ── 0. pinned inputs ──
const WL = BIP39_OFFICIAL_WORDLISTS;
for (const [lang, L] of Object.entries(WL.lists)) {
  const h = crypto.createHash('sha256').update(L.join('\n') + '\n', 'utf8').digest('hex');
  if (h !== WL.sha256[lang]) { console.error('HASH MISMATCH ' + lang); process.exit(2); }
}
say(`lists: ${Object.keys(WL.lists).length} pinned lists verified by SHA-256`);
if (HW.DOMAIN !== 120 || WT.join(',') !== '1,140,819,343,884,825,620,515') { console.error('checksum constants changed'); process.exit(2); }
say('checksum: C = (120 + 101·N + Σ w_i·x_i) mod 997, w = [1,140,819,343,884,825,620,515], N = 1..8');

// ── A. exhaustive guarantees ──
let singleOk = true, swapOk = true, combos = 0, esc = 0;
for (let i = 0; i < 8; i++) for (let d = -2047; d <= 2047; d++) if (d && ((WT[i] * d) % P === 0) !== (d % P === 0)) singleOk = false;
for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
  if ((WT[i] - WT[j]) % P === 0) swapOk = false;
  for (let a = -15; a <= 15; a++) for (let b = -15; b <= 15; b++) {
    if (!a || !b) continue; combos++;
    if (((WT[i] * a + WT[j] * b) % P + P) % P === 0) esc++;
  }
}
say(`A. single substitution missed ⇔ Δ ∈ {±997, ±1994}: ${singleOk ? 'PROVEN' : 'FAILED'} (positions 1–8, all Δ)`);
say(`A. swap of two different words missed ⇔ 997 | Δ: ${swapOk ? 'PROVEN (weights distinct mod 997)' : 'FAILED'}`);
say(`A. two-position errors with both |Δ| ≤ 15: ${combos} combinations, ${esc} undetected`);

// ── B/C. confusion table v0 ──
const pairsByLang = {};
for (const prof of Object.values(PROFILES)) {
  const L = WL.lists[prof.lang].map(w => w.normalize('NFC'));
  const idx = w => L.indexOf(w.normalize('NFC'));
  for (const g of prof.confusionGroups) {
    for (let a = 0; a < g.length; a++) for (let b = a + 1; b < g.length; b++) {
      const ia = idx(g[a]), ib = idx(g[b]);
      if (ia >= 0 && ib >= 0) (pairsByLang[prof.lang] = pairsByLang[prof.lang] || []).push([ia, ib, g[a] + '/' + g[b]]);
    }
  }
}
const ctx = () => [rnd() * 1536 | 0, rnd() * 2048 | 0, rnd() * 2048 | 0, rnd() * 2048 | 0];
let bW = 0, bWn = 0, bC = 0, bCn = 0, cW = 0, cWn = 0, cC = 0, cCn = 0;
const perLang = [];
for (const [lang, ps] of Object.entries(pairsByLang)) {
  let lwMiss = [];
  for (const [a, b, name] of ps) {
    if ((a - b) % P === 0) lwMiss.push(name);
    for (const [x, y] of [[a, b], [b, a]]) for (let p = 0; p < 4; p++) {
      if (p === 0 && (x >= 1536 || y >= 1536)) continue;
      bWn++;                                          // weighted: context-free
      if (((WT[p] * (y - x)) % P + P) % P === 0) bW++;
      for (let k = 0; k < K_CONTEXTS; k++) { const v = ctx(); v[p] = x; const u = v.slice(); u[p] = y; bCn++; if (CRC(u) === CRC(v)) bC++; }
    }
  }
  perLang.push(`${lang}: ${ps.length} on-list pairs, weighted single misses: ${lwMiss.length ? lwMiss.join(' ') : 'none'}`);
  for (let i = 0; i < ps.length; i++) for (let j = 0; j < ps.length; j++)
    for (const [x1, y1] of [[ps[i][0], ps[i][1]], [ps[i][1], ps[i][0]]])
      for (const [x2, y2] of [[ps[j][0], ps[j][1]], [ps[j][1], ps[j][0]]])
        for (let p = 0; p < 4; p++) for (let q = 0; q < 4; q++) {
          if (p === q) continue;
          if ((p === 0 && (x1 >= 1536 || y1 >= 1536)) || (q === 0 && (x2 >= 1536 || y2 >= 1536))) continue;
          cWn++;
          if (((WT[p] * (y1 - x1) + WT[q] * (y2 - x2)) % P + P) % P === 0) cW++;
          for (let k = 0; k < K_CONTEXTS; k++) {
            const v = ctx(); v[p] = x1; v[q] = x2; const u = v.slice(); u[p] = y1; u[q] = y2;
            cCn++; if (CRC(u) === CRC(v)) cC++;
          }
        }
}
perLang.forEach(l => say('B. ' + l));
const pct = (m, n) => (100 * m / n).toFixed(3) + '%';
say(`B. single known confusions — weighted (exhaustive, ${bWn} cases): ${bW} missed (${pct(bW, bWn)}); CRC (sampled, ${bCn}): ${bC} missed (${pct(bC, bCn)})`);
say(`C. double known confusions, 4 words — weighted (exhaustive, ${cWn} cases): ${cW} missed (${pct(cW, cWn)}); CRC (sampled, ${cCn}): ${cC} missed (${pct(cC, cCn)})`);
say('   (Results describe confusion table v0 and these lists only; not a claim of optimality.)');

// ── profiles ──
if (process.argv.includes('--profiles')) {
  for (const [id, prof] of Object.entries(PROFILES)) {
    const v = HW.validateProfile(prof);
    say(`profile ${id}: ${v.errors.length} errors, ${v.warnings.length} warnings, approvable: ${v.approvable}`);
    v.errors.forEach(e => say('   ERROR ' + e));
    v.warnings.slice(0, 6).forEach(w => say('   warn  ' + w));
    if (v.warnings.length > 6) say(`   … ${v.warnings.length - 6} more warnings`);
  }
}
const fail = !singleOk || !swapOk || esc !== 0 || bW !== 0;
process.exit(fail ? 1 : 0);
