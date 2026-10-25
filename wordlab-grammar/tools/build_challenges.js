'use strict';
/*
 * Set challenge hands and bot pars from dated finds.
 *   node tools/build_challenges.js <finds.json> <challenges.json> [id ...]
 * <finds.json>       output of tools/reconstruct_finds.js
 * <challenges.json>  read for the definitions (id, title, window, note) and
 *                    rewritten in place with fresh hands and bot pars. With
 *                    ids given, only those challenges are recomputed (bot par
 *                    takes ~1 min each; this keeps every run under 5 min).
 *
 * Hand: every word FIRST found inside the window (NZ local dates, inclusive).
 * A word found earlier belongs to the earlier window, even if found again.
 * Stretch: ceil(90% of the hand).
 * Bot par (bot-par-v2): a floor, not a ceiling. The 2026-10-21 method (which
 * reproduces the original published pars exactly with seed 7 alone), run over
 * seeds 1-5 to damp seed luck: one seed alone ranges ~591-713 on August.
 * Per seed: buildGenerator(engine, seed, {allowedBlue: hand, helpers}) from
 * tests/generate.js; up to 7000 draws or 2200 distinct sentences, each
 *   generate({maxTokens: 22, depth: 5 + floor(rnd * 5)}), parseTiles k = 2,
 *   kept if recognised and scoreReading(canonical) > 0 (exact score kept);
 * packed greedily into disjoint-blue-tile portfolios two ways (exact per blue
 * tile, exact). Par = best total over seeds x packings, rounded once.
 * Helpers: a fixed recorded set (botParHelpers in the file; default the 8
 * unlocked in Greg's session), so pars don't move when unlocks change.
 * Deterministic for a given hand, helper set, grammar, scorer and generator.
 */
const fs = require('fs'), path = require('path');
const {load} = require('../src/load');
const {scoreReading} = require('../src/score');
const {buildGenerator} = require('../tests/generate');

const [findsPath, chPath, ...only] = process.argv.slice(2);
if (!findsPath || !chPath) { console.error('usage: node tools/build_challenges.js <finds.json> <challenges.json> [id ...]'); process.exit(2); }
const finds = JSON.parse(fs.readFileSync(findsPath, 'utf8'));
const file = JSON.parse(fs.readFileSync(chPath, 'utf8'));
const engine = load();

const DEFAULT_HELPERS = ['the', 'is', 'in', 'and', 'a', 'can', 'for', 'on'];
const HELPERS = file.botParMethod && file.botParMethod.helpers || DEFAULT_HELPERS;
// BOTPAR_SEEDS=7 with the old-rule finds reproduces the 2026-10-21 pars (815/942/1086/779).
const SEEDS = process.env.BOTPAR_SEEDS ? process.env.BOTPAR_SEEDS.split(',').map(Number) : [1, 2, 3, 4, 5], DRAWS = 7000, CANDIDATES = 2200, K = 2;

const first = new Map();
for (const f of finds.slice().sort((a, b) => a.time_ms - b.time_ms))
  for (const w of f.words) if (!first.has(w)) first.set(w, f.nzDate);

const words = t => t.map(x => x.word).join(' ');
function botPar(hand) {
  let best = null;
  for (const seed of SEEDS) {
    const g = buildGenerator(engine, seed, {allowedBlue: new Set(hand), helpers: new Set(HELPERS)});
    const cands = new Map();
    for (let i = 0; i < DRAWS && cands.size < CANDIDATES; i++) {
      const it = g.generate({maxTokens: 22, depth: 5 + Math.floor(g.rnd() * 5)}); if (!it) continue;
      const k = words(it.tiles); if (cands.has(k)) continue;
      const r = engine.parseTiles(it.tiles, {k: K}); if (r.state !== 'recognised') continue;
      const s = scoreReading(r.canonical, it.tiles); if (!s || !s.score) continue;
      cands.set(k, {score: s.exact, blue: it.tiles.filter(t => t.source === 'collected').map(t => t.word)});
    }
    const L = [...cands.values()];
    for (const order of [(a, b) => b.score / b.blue.length - a.score / a.blue.length, (a, b) => b.score - a.score]) {
      const used = new Set(), ch = [];
      for (const c of L.slice().sort(order)) { if (c.blue.some(w => used.has(w))) continue; c.blue.forEach(w => used.add(w)); ch.push(c); }
      const total = ch.reduce((a, c) => a + c.score, 0);
      if (!best || total > best.total) best = {total, seed, sentences: ch.length, tiles: ch.reduce((a, c) => a + c.blue.length, 0)};
    }
  }
  return best;
}

for (const c of file.challenges) {
  if (only.length && !only.includes(c.id)) continue;
  const hand = [...first].filter(([, d]) => d >= c.window.from && d <= c.window.to).map(([w]) => w).sort();
  c.hand = hand; c.handSize = hand.length; c.stretchTiles = Math.ceil(0.9 * hand.length);
  const t0 = Date.now(), b = botPar(hand);
  c.botPar = Math.round(b.total); c.botParSentences = b.sentences; c.botParTilesUsed = b.tiles; c.botParSeed = b.seed;
  console.log(`${c.id}: hand ${hand.length}, stretch ${c.stretchTiles}, bot par ${c.botPar} (seed ${b.seed}, ${b.sentences} sentences, ${b.tiles} tiles) ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
delete file.botParHelpers;
file.botParMethod = {id: 'bot-par-v2', helpers: HELPERS, seeds: SEEDS, draws: DRAWS, distinctSentences: CANDIDATES, parseK: K,
  generate: {maxTokens: 22, depth: '5 + floor(rnd * 5)'}, keep: 'recognised, scoreReading(canonical) > 0',
  packing: ['exact per blue tile, desc', 'exact, desc'], par: 'best total over seeds x packings, rounded once',
  versions: file.versions, computed: new Date().toISOString().slice(0, 10)};
fs.writeFileSync(chPath, JSON.stringify(file, null, 1) + '\n');
