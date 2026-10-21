'use strict';
/*
 * Search for a high-scoring portfolio that uses every word of a hand with a
 * given helper set. Builds sentences from coordinated clauses
 *   [Det] (Adj) Noun (Noun) can Verb [Det] (Adj) Noun (Noun) [tonight]
 * with nouns needing determiners getting "the", one adjective per noun where
 * possible (stacks taper), degree adverbs before adjectives. Every candidate
 * sentence is parsed and scored by the real engine; unparsed ones are dropped.
 * Usage: node tools/search_hand.js <challenge-id> [seconds=150] [seed=1]
 */
const {load} = require('../src/load');
const {scoreResult} = require('../src/score');
const e = load();
const C = require('../challenges/retrospective_2026-08_to_10.json').challenges.find(c => c.id === (process.argv[2] || 'retro-2026-08'));
const SECONDS = Number(process.argv[3]) || 150;
let seed = Number(process.argv[4]) || 1;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const HELP = new Set(['the', 'a', 'an', 'and', 'is', 'can']);
const L = e.lexicon.lex, R = w => L.get(w) || [];
const has = (w, f) => R(w).some(f);
const isNc = w => has(w, r => r.cat === 'N' && r.f.num === 'sg' && r.f.cnt === 'count');
const isBareN = w => has(w, r => r.cat === 'N' && (r.f.cnt === 'mass' || r.f.num === 'pl'));
const isN = w => isNc(w) || isBareN(w);
const isAdj = w => has(w, r => r.cat === 'Adj' && r.f.u === 'attr');
const isDeg = w => has(w, r => r.cat === 'AdvDeg');
const isPost = w => has(w, r => r.cat === 'AdvPost');
const isVt = w => has(w, r => r.cat === 'V' && r.f.fr === 'tr' && r.f.vf === 'base');
const isVi = w => has(w, r => r.cat === 'V' && r.f.fr === 'intr' && r.f.vf === 'base');
const hand = C.hand;
const cache = new Map();
function scoreSentence(words) {
  const key = words.join(' ');
  if (cache.has(key)) return cache.get(key);
  const r = e.parseTiles(words.map(w => ({word: w, source: HELP.has(w) ? 'helper' : 'collected'})), {k: 2});
  const v = r.state === 'recognised' ? scoreResult(r).exact : -1;
  cache.set(key, v); return v;
}
// Build an NP from a pool: optional degree+adjective, adjective, 1-2 nouns (head last).
function np(pool, opts) {
  const nouns = pool.filter(isN); if (!nouns.length) return null;
  const head = pick(nouns.filter(w => !opts.needBare || isBareN(w)).length ? nouns.filter(w => !opts.needBare || isBareN(w)) : nouns);
  const words = [head]; take(pool, head);
  if (rnd() < opts.cmp) { const m = pool.filter(isN); if (m.length) { const x = pick(m); words.unshift(x); take(pool, x); } }
  if (rnd() < opts.adj) { const a = pool.filter(isAdj); if (a.length) { const x = pick(a); words.unshift(x); take(pool, x);
      if (rnd() < 0.5) { const d = pool.filter(isDeg); if (d.length) { const y = pick(d); words.unshift(y); take(pool, y); } } } }
  const needDet = isNc(head) && !isBareN(head);
  return (needDet || rnd() < 0.3) ? ['the', ...words] : words;
}
function take(pool, w) { const i = pool.indexOf(w); if (i >= 0) pool.splice(i, 1); }
function clause(pool, opts) {
  const verbs = pool.filter(w => isVt(w) || isVi(w));
  if (!verbs.length) return null;
  // Prefer verbs that can only be verbs, so nouns stay available for NPs.
  const onlyV = verbs.filter(w => !isN(w) && !isAdj(w));
  const v = onlyV.length && rnd() < 0.8 ? pick(onlyV) : pick(verbs);
  take(pool, v);
  const subj = np(pool, opts); if (!subj) return null;
  let words = [...subj, 'can', v];
  if (isVt(v) && (!isVi(v) || rnd() < 0.75)) { const obj = np(pool, opts); if (obj) words.push(...obj); else if (!isVi(v)) return null; }
  if (rnd() < 0.3) { const p = pool.filter(isPost); if (p.length) { const x = pick(p); words.push(x); take(pool, x); } }
  return words;
}
function portfolio() {
  const pool = shuffle(hand);
  const opts = {adj: 0.5 + rnd() * 0.5, cmp: rnd() * 0.7};
  const clauses = [];
  for (let guard = 0; pool.length && guard < 40; guard++) { const c = clause(pool, opts); if (!c) break; clauses.push(c); }
  if (pool.length) {
    // Leftovers: try to attach adjectives/nouns/adverbs into existing clauses.
    for (const w of pool.slice()) {
      const c = pick(clauses); if (!c) return null;
      if (isPost(w)) c.push(w);
      else if (isAdj(w) || isN(w)) { const i = c.findIndex((x, k) => isN(x) && !HELP.has(x) && (k === 0 || HELP.has(c[k - 1]))); if (i < 0) return null; c.splice(i, 0, w); }
      else if (isDeg(w)) { const i = c.findIndex(x => isAdj(x) && !isN(x)); if (i < 0) return null; c.splice(i, 0, w); }
      else return null;
      take(pool, w);
    }
  }
  // Group clauses into sentences of 1-4 clauses joined by "and".
  const sents = []; let i = 0;
  while (i < clauses.length) { const k = 1 + Math.floor(rnd() * Math.min(4, clauses.length - i)); sents.push(clauses.slice(i, i + k).flatMap((c, j) => j ? ['and', ...c] : c)); i += k; }
  let total = 0;
  for (const s of sents) { const v = scoreSentence(s); if (v < 0) return null; total += v; }
  const used = new Set(sents.flat().filter(w => !HELP.has(w)));
  if (used.size !== hand.length) return null;
  return {total, sents};
}
// Local improvement: regroup clauses between sentences.
function improve(p) {
  let best = p;
  const clausesOf = s => { const out = [[]]; for (const w of s) { if (w === 'and' && out[out.length - 1].includes('can')) out.push([]); else out[out.length - 1].push(w); } return out; };
  for (let it = 0; it < 60; it++) {
    const cl = best.sents.flatMap(clausesOf);
    const order = shuffle(cl), sents = []; let i = 0;
    while (i < order.length) { const k = 1 + Math.floor(rnd() * Math.min(4, order.length - i)); sents.push(order.slice(i, i + k).flatMap((c, j) => j ? ['and', ...c] : c)); i += k; }
    let total = 0, ok = true;
    for (const s of sents) { const v = scoreSentence(s); if (v < 0) { ok = false; break; } total += v; }
    if (ok && total > best.total) best = {total, sents};
  }
  return best;
}
const t0 = Date.now(); let best = null, tries = 0, valid = 0;
while (Date.now() - t0 < SECONDS * 1000) {
  tries++; const p = portfolio(); if (!p) continue; valid++;
  const q = improve(p);
  if (!best || q.total > best.total) { best = q; console.log(Math.round(best.total), 'after', tries, 'tries'); }
}
console.log('\nBEST', Math.round(best.total), '| portfolios tried', tries, 'valid', valid);
for (const s of best.sents) { const t = s.join(' '); console.log(Math.round(scoreSentence(s)), '·', t.charAt(0).toUpperCase() + t.slice(1) + '.'); }
require('fs').writeFileSync('/tmp/best_' + C.id + '.json', JSON.stringify(best));
