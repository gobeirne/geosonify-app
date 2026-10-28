'use strict';
/*
 * Feedback quality (G7). Generated sentences are corrupted by type (article
 * swap, agreement change, determiner drop); for each corruption the engine
 * reports as a conflict, the feedback module's tested repairs are checked:
 *   offered  — at least one repair makes the sentence recognised;
 *   restored — the best repair gives back exactly the original sentence.
 * All gold tiles are treated as unlocked. Usage: node tests/run_feedback.js [count=400] [seed]
 */
const {load} = require('../src/load');
const {buildGenerator} = require('./generate');
const {scoreReading} = require('../src/score');
const {explainConflict} = require('../src/feedback');
const engine = load();
const COUNT = Number(process.argv[2]) || 400, SEED = Number(process.argv[3]) || 20261028;
const gen = buildGenerator(engine, SEED);
const text = tiles => tiles.map(t => t.word).join(' ');
const st = {};
let n = 0, ms = [];
for (let i = 0; n < COUNT && i < COUNT * 20; i++) {
  const item = gen.generate({maxTokens: 20, depth: 5 + Math.floor(gen.rnd() * 4)});
  if (!item || engine.parseTiles(item.tiles, {k: 2}).state !== 'recognised') continue;
  n++;
  for (const c of gen.corrupt(item)) {
    if (!['article', 'agreement', 'det_drop'].includes(c.type)) continue;
    const r = engine.parseTiles(c.tiles, {k: 4});
    if (r.state !== 'conflict') continue;
    const s = st[c.type] = st[c.type] || {conflicts: 0, offered: 0, restored: 0};
    s.conflicts++;
    const t0 = Date.now();
    const f = explainConflict(engine, r, {score: x => scoreReading(x.canonical, x.tiles).score});
    ms.push(Date.now() - t0);
    if (f.fixes.length) s.offered++;
    if (f.fixes.length && f.fixes.some(x => x.words.join(' ') === text(item.tiles))) s.restored++;
  }
}
ms.sort((a, b) => a - b);
const out = {sentences: n, byType: st, msP95: ms.length ? ms[Math.floor(0.95 * (ms.length - 1))] : 0};
console.log(JSON.stringify(out));
module.exports = out;
