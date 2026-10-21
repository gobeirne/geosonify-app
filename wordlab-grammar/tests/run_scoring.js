'use strict';
/*
 * Phase 2 scoring tests, all on real parses (no hand-labelled sentences):
 *   P1  recognised + any blue tile -> score > 0               (generated corpus)
 *   P2  inserting a blue adjective / noun modifier never lowers the score
 *   P3' gold-only material earns nothing; unanchored links earn nothing
 *   P4' clause-link chains converge; extending by alternating conjunctions
 *       never beats adding a new relation type
 *   P5  compound stack bound >> adjective stack bound
 *   P6  score spread across alternative readings (tracked metric)
 *   J   joining two sentences with a clause link >= their separate sum
 *   S   points per blue tile for typical farming strategies vs rich sentences
 *   O   adversarial portfolio search on a real inventory
 * Writes reports/scoring_report.json. Usage: node tests/run_scoring.js [n=800]
 */
const fs = require('fs'), path = require('path');
const {load} = require('../src/load');
const {scoreReading, PARAMS} = require('../src/score');
const {buildGenerator} = require('./generate');
const engine = load();
const N = Number(process.argv[2]) || 800;
const FAST = process.argv[3] === 'fast'; // skip the inventory optimiser (CI)
const out = {params: PARAMS, failures: []};
const fail = (k, x) => out.failures.push({check: k, ...x});
const words = tiles => tiles.map(t => t.word).join(' ');
const sc = tiles => { const r = engine.parseTiles(tiles, {k: 8}); return r.state === 'recognised' ? {r, s: scoreReading(r.canonical, tiles)} : {r, s: null}; };
const T = (text, gold = []) => { const seen = new Set(); return text.toLowerCase().replace(/[.,?]/g, ' ').split(/\s+/).filter(Boolean).map(w => {
  const isGold = gold.includes(w) || !engine.lexicon.byWord.has(w) || seen.has(w); if (!isGold) seen.add(w); return {word: w, source: isGold ? 'helper' : 'collected'}; }); };

// ------------------------------------------------------------ P1 + P6
const gen = buildGenerator(engine, 777);
const corpus = [];
for (let i = 0; corpus.length < N && i < N * 20; i++) {
  const it = gen.generate({maxTokens: 22, depth: 6 + Math.floor(gen.rnd() * 3)}); if (!it) continue;
  const {r, s} = sc(it.tiles); if (!s) continue;
  corpus.push({tiles: it.tiles, r, s});
}
let p1 = 0;
const spreads = [];
for (const c of corpus) {
  const hasBlue = c.tiles.some(t => t.source === 'collected');
  if (hasBlue && !(c.s.score > 0)) { p1++; fail('P1', {text: words(c.tiles)}); }
  const alt = c.r.readings.slice(0, 4).map(rd => scoreReading(rd, c.tiles).exact);
  if (alt.length > 1) spreads.push((Math.max(...alt) - Math.min(...alt)) / Math.max(1, alt[0]));
}
spreads.sort((a, b) => a - b);
out.P1 = {n: corpus.length, violations: p1};
out.P6 = {sentencesWithAlternatives: spreads.length, medianRelativeSpread: +(spreads[spreads.length >> 1] || 0).toFixed(3), p90RelativeSpread: +(spreads[Math.floor(spreads.length * 0.9)] || 0).toFixed(3)};

// ------------------------------------------------------------ P2 insertion
const lex = engine.lexicon.lex;
const onlyAdj = [...lex].filter(([w, rs]) => rs.some(r => r.cat === 'Adj' && r.f.u === 'attr') && !rs.some(r => r.cat === 'N' || r.cat === 'V')).map(([w]) => w);
const onlyNoun = [...lex].filter(([w, rs]) => rs.some(r => r.cat === 'N' && r.f.num === 'sg' && r.tier === 'curated') && !rs.some(r => r.cat !== 'N')).map(([w]) => w);
let p2n = 0, p2v = 0;
for (const c of corpus.slice(0, 400)) {
  const used = new Set(c.tiles.map(t => t.word));
  c.r.canonical.roles.forEach((ro, i) => {
    if (ro.pos !== 'N' || !['nsubj', 'obj', 'pobj', 'root', 'conj'].includes(ro.role) || c.tiles[i].source !== 'collected') return;
    for (const pool of [onlyAdj, onlyNoun]) {
      const w = pool.find(x => !used.has(x)); if (!w) continue;
      const tiles = [...c.tiles.slice(0, i), {word: w, source: 'collected'}, ...c.tiles.slice(i)];
      // Hold every other word's category fixed (a genuine NEW role only).
      const pins = {}; c.r.canonical.roles.forEach((x, j) => { pins[j < i ? j : j + 1] = x.pos; });
      const pr = engine.parseTiles(tiles, {k: 8, pins}); if (pr.state !== 'recognised') continue;
      // Same structure for the old words? (map old token j to new j or j+1)
      const mapT = j => j < i ? j : j + 1;
      const key = r => r.type + ':' + r.head + '>' + r.dep;
      const want = c.r.canonical.relations.map(r => r.type + ':' + mapT(r.head) + '>' + mapT(r.dep));
      const rd = pr.readings.find(x => { const have = new Set(x.relations.map(key)); return want.every(k => have.has(k)); });
      if (!rd) { out.P2readingChanges = (out.P2readingChanges || 0) + 1; continue; }
      const after = {r: {canonical: rd}, s: scoreReading(rd, tiles)};
      const role = after.r.canonical.roles[i];
      if (!(role.role === 'amod' || role.role === 'compound')) continue; // only genuine modifier insertions
      p2n++;
      if (after.s.exact < c.s.exact - 1e-9) { p2v++; fail('P2', {before: words(c.tiles), after: words(tiles), from: c.s.exact, to: after.s.exact}); }
    }
  });
}
out.P2 = {insertions: p2n, violations: p2v, insertionsThatChangeStructure: out.P2readingChanges || 0};

// ------------------------------------------------------------ P3'
const g0 = buildGenerator(engine, 31, {allowedBlue: new Set()});
let goldOnly = 0, goldOnlyNonzero = 0;
for (let i = 0; i < 3000 && goldOnly < 150; i++) {
  const it = g0.generate({maxTokens: 12, depth: 5}); if (!it) continue;
  const {s} = sc(it.tiles); if (!s) continue;
  goldOnly++; if (s.score !== 0) { goldOnlyNonzero++; fail("P3'", {text: words(it.tiles), score: s.score}); }
}
const anchorCases = [
  {text: 'The cat can run because the dog did.', gold: ['can'], expectLinks: 1},
  {text: 'The cat can run because he did.', gold: ['can'], expectLinks: 0},
  {text: 'It can run because he did.', gold: ['can'], expectLinks: 0},
];
out.P3 = {goldOnlySentences: goldOnly, goldOnlyNonzero, anchorCases: anchorCases.map(a => {
  const {s} = sc(T(a.text, a.gold)); const got = s ? s.breakdown.links.length : null;
  if (got !== a.expectLinks) fail("P3'", {text: a.text, links: got, expected: a.expectLinks});
  return {text: a.text, scoringLinks: got, expected: a.expectLinks};
})};

// ------------------------------------------------------------ P4' chains
const subj = ['dog', 'cat', 'fish', 'bird', 'lion', 'horse', 'donkey', 'eagle', 'rabbit', 'monkey', 'tiger', 'elephant'];
const verb = ['run', 'jump', 'swim', 'sing', 'dance', 'fly', 'float', 'shiver', 'blossom', 'crumble', 'arrive', 'climb'];
const clause = i => 'the ' + subj[i] + ' can ' + verb[i];
function chain(k, pattern) {
  let s = clause(0);
  for (let i = 1; i < k; i++) s += ' ' + pattern[(i - 1) % pattern.length] + ' ' + clause(i);
  return sc(T(s + '.', ['can']));
}
const pats = {and: ['and'], because: ['because'], alternating: ['and', 'because'], 'and/because/while/before': ['and', 'because', 'while', 'before']};
out.P4 = {};
for (const [name, p] of Object.entries(pats)) {
  const rows = [];
  for (let k = 1; k <= 10; k++) { const {s} = chain(k, p); rows.push(s ? {clauses: k, score: s.score, structural: s.breakdown.structural} : {clauses: k, score: null}); }
  out.P4[name] = rows;
}
// Extending an alternating chain by one link vs adding a new relation type.
{
  const base = 'the dog can run and the cat can jump because the fish can swim';
  const sameType = sc(T(base + ' and the bird can sing.', ['can']));
  // (the relative clause 'that can chase the bird' is substantive: chase + bird)
  const newType = sc(T('the dog that can chase the bird can run and the cat can jump because the fish can swim.', ['can']));
  const b = sc(T(base + '.', ['can']));
  const dSame = sameType.s.breakdown.structural - b.s.breakdown.structural, dNew = newType.s.breakdown.structural - b.s.breakdown.structural;
  out.P4.extension = {base: b.s.breakdown.structural, addAnotherAnd: +dSame.toFixed(2), addRelativeClause: +dNew.toFixed(2)};
  if (!(dNew > dSame)) fail("P4'", {msg: 'alternating extension beat a new relation type', dSame, dNew});
}
for (const name of Object.keys(pats)) {
  const rows = out.P4[name].filter(r => r.score !== null);
  const s = rows.map(r => r.structural);
  if (s.some((x, i) => i > 0 && x < s[i - 1] - 1e-9)) fail("P4'", {msg: 'structural points decreased along chain', name});
  // Convergence: over the last three clauses of a 10-clause chain, structural
  // points may grow by at most 8% of the total (alternating patterns zig-zag
  // as each kind returns at its next, smaller repeat value).
  const growth = s[s.length - 1] - s[s.length - 4];
  if (growth > 0.08 * s[s.length - 1]) fail("P4'", {msg: 'chain not converging', name, lastThreeGrowth: growth, total: s[s.length - 1]});
}

// Splitting a long homogeneous chain: joined vs split into two halves.
out.split = [];
for (const k of [4, 6, 8, 10, 12]) {
  const joined = chain(k, ['and']).s.exact;
  const h = k / 2;
  let a = 'the ' + subj[0] + ' can ' + verb[0], b = 'the ' + subj[h] + ' can ' + verb[h];
  for (let i = 1; i < h; i++) { a += ' and ' + clause(i); b += ' and ' + clause(h + i); }
  const sa = sc(T(a + '.', ['can'])).s.exact, sb = sc(T(b + '.', ['can'])).s.exact;
  out.split.push({clauses: k, joined: +joined.toFixed(1), splitInTwo: +(sa + sb).toFixed(1), splitGainPct: +(100 * (sa + sb - joined) / joined).toFixed(1)});
}

// ------------------------------------------------------------ P5 stacks
const adjs = onlyAdj.slice(0, 10), nouns = onlyNoun.filter(w => w !== 'ketchup').slice(0, 10);
out.P5 = [];
for (let k = 1; k <= 8; k++) {
  const a = sc(T('prevent the ' + adjs.slice(0, k).join(' ') + ' ketchup.'));
  const c = sc(T('prevent the ' + nouns.slice(0, k).join(' ') + ' ketchup.'));
  const mod = x => x.s ? x.s.breakdown.tiles.filter(t => t.class === 'modifier' || t.class === 'compound').reduce((p, t) => p + t.points, 0) : null;
  out.P5.push({modifiers: k, adjectiveStack: a.s && +mod(a).toFixed(2), compoundStack: c.s && +mod(c).toFixed(2)});
  if (k >= 2 && a.s && c.s && !(mod(c) > mod(a))) fail('P5', {k});
}
// v0.4: adjective stacks are bounded; noun compounds grow linearly (flat 10 per modifier, by decision).
out.P5bounds = {adjective: PARAMS.ADJ / (1 - PARAMS.ADJ_R), compound: 'linear (10 per modifier)'};
if (out.P5.some((r, i) => i > 0 && r.adjectiveStack > PARAMS.ADJ / (1 - PARAMS.ADJ_R) + 1e-9)) fail('P5', {msg: 'adjective stack exceeds its bound'});

// ------------------------------------------------------------ J join vs split
let jn = 0, jv = 0;
const simple = corpus.filter(c => c.r.canonical.utteranceType === 'declarative' && !c.r.canonical.families.includes('clause_coordination') && c.tiles.length <= 9);
for (let i = 0; i + 1 < simple.length && jn < 150; i += 2) {
  const A = simple[i], B = simple[i + 1];
  const blueA = new Set(A.tiles.filter(t => t.source === 'collected').map(t => t.word));
  if (B.tiles.some(t => t.source === 'collected' && blueA.has(t.word))) continue;
  for (const conj of ['and', 'because']) {
    const jt = [...A.tiles, {word: conj, source: 'helper'}, ...B.tiles];
    const pins = {}; A.r.canonical.roles.forEach((x, j) => { pins[j] = x.pos; }); B.r.canonical.roles.forEach((x, j) => { pins[A.tiles.length + 1 + j] = x.pos; });
    const jr = engine.parseTiles(jt, {k: 24, pins}); if (jr.state !== 'recognised') continue;
    // The clause-level join: a reading linking A's root to B's root.
    const aRoot = A.r.canonical.roles.findIndex(x => x.role === 'root'), bRoot = A.tiles.length + 1 + B.r.canonical.roles.findIndex(x => x.role === 'root');
    const rd = jr.readings.find(x => x.relations.some(q => q.head === aRoot && q.dep === bRoot && ['conj', 'advcl'].includes(q.type)));
    if (!rd) continue;
    const js = scoreReading(rd, jt);
    jn++; if (js.exact < A.s.exact + B.s.exact - 1e-9) { jv++; fail('J', {a: words(A.tiles), b: words(B.tiles), conj, joined: js.exact, parts: A.s.exact + B.s.exact}); }
  }
}
out.J = {joins: jn, violations: jv};

// ------------------------------------------------------------ S strategies (points per blue tile)
const strat = [
  ['one-word imperative', 'Run.'],
  ['noun list fragment', 'The cat or the dog or the fish or the bird or the lion or the horse.'],
  ['bare noun list fragment', 'Ketchup or salad or juice or sugar or honey or pepper.'],
  ['adjective stack', 'Prevent the ' + adjs.slice(0, 6).join(' ') + ' ketchup.'],
  ['noun compound', 'Prevent the ' + nouns.slice(0, 6).join(' ') + ' ketchup.'],
  ['compound fragment', 'The ' + nouns.slice(0, 6).join(' ') + ' ketchup.'],
  ['8-clause and-chain', chain(8, ['and']).r.tiles.map(t => t.word).join(' ') + '.'],
  ['8-clause because-chain', chain(8, ['because']).r.tiles.map(t => t.word).join(' ') + '.'],
  ['8-clause alternating chain', chain(8, ['and', 'because']).r.tiles.map(t => t.word).join(' ') + '.'],
  ['handover A', 'Prevent prison patient parrot ketchup in all bitter banana menu output.'],
  ['handover C', 'The unknown civil void has just blame and the bitter October symbol can oppose the joke journey.'],
  ['session sentence 1', 'Abandon barely fun festival salad and shiver because clean library jeans know robust news for the runway security man.'],
  ['embedding + relative', 'The angry cat that can sing can decide to run because the dog can swim.'],
];
out.S = strat.map(([name, text]) => {
  const tiles = T(text, ['can']); const {s} = sc(tiles); const nb = tiles.filter(t => t.source === 'collected').length;
  return {strategy: name, text, blueTiles: nb, score: s ? s.score : null, perBlueTile: s ? +(s.exact / nb).toFixed(2) : null};
});

// ------------------------------------------------------------ O inventory optimiser
if (!FAST) {
const inv = JSON.parse(fs.readFileSync(path.join(__dirname, 'inventory_v1_1_embedded.json'), 'utf8'));
const helpers = new Set([...inv.unlocked, 'has']);
const gI = buildGenerator(engine, 2026, {allowedBlue: new Set(inv.inventory), helpers});
const cands = new Map();
for (let i = 0; i < 40000 && cands.size < 6000; i++) {
  const it = gI.generate({maxTokens: 22, depth: 5 + Math.floor(gI.rnd() * 5)}); if (!it) continue;
  const key = words(it.tiles); if (cands.has(key)) continue;
  const {r, s} = sc(it.tiles); if (!s || !s.score) continue;
  cands.set(key, {tiles: it.tiles, score: s.exact, blue: it.tiles.filter(t => t.source === 'collected').map(t => t.word), type: r.canonical.utteranceType, fams: r.canonical.families, s});
}
function pack(order) {
  const used = new Set(), chosen = [];
  for (const c of order) { if (c.blue.some(w => used.has(w))) continue; c.blue.forEach(w => used.add(w)); chosen.push(c); }
  return chosen;
}
const list = [...cands.values()];
const byRatio = pack(list.slice().sort((a, b) => b.score / b.blue.length - a.score / a.blue.length));
const byScore = pack(list.slice().sort((a, b) => b.score - a.score));
const summarise = ch => {
  const fam = {}; for (const c of ch) for (const f of c.fams) fam[f] = (fam[f] || 0) + 1;
  const types = {}; for (const c of ch) types[c.type] = (types[c.type] || 0) + 1;
  const total = ch.reduce((a, c) => a + c.score, 0), tiles = ch.reduce((a, c) => a + c.blue.length, 0);
  const structShare = ch.reduce((a, c) => a + c.s.breakdown.structural * c.s.breakdown.fragmentFactor, 0) / total;
  const listItems = ch.reduce((a, c) => a + c.s.breakdown.tiles.filter(t => t.note === 'list item').length, 0);
  return {sentences: ch.length, blueTilesUsed: tiles, total: Math.round(total), perTile: +(total / tiles).toFixed(2), meanBluePerSentence: +(tiles / ch.length).toFixed(1),
    utteranceTypes: types, structuralShare: +structShare.toFixed(2), listItems,
    topFamilies: Object.entries(fam).sort((a, b) => b[1] - a[1]).slice(0, 10), best: ch.slice().sort((a, b) => b.score - a.score).slice(0, 5).map(c => ({score: Math.round(c.score), text: words(c.tiles)}))};
};
// Points per blue tile by sentence size, over all candidates.
const bins = {};
for (const c of list) { const b = c.blue.length, k = b <= 2 ? '1-2' : b <= 4 ? '3-4' : b <= 6 ? '5-6' : b <= 9 ? '7-9' : '10+'; (bins[k] = bins[k] || []).push(c.score / b); }
const perTileBySize = Object.fromEntries(['1-2', '3-4', '5-6', '7-9', '10+'].filter(k => bins[k]).map(k => { const a = bins[k].sort((x, y) => x - y); return [k, {n: a.length, median: +a[a.length >> 1].toFixed(1), p90: +a[Math.floor(a.length * 0.9)].toFixed(1)}]; }));
out.O = {inventory: inv.inventory.length, helpers: [...helpers], candidates: cands.size, perTileBySize, greedyByPointsPerTile: summarise(byRatio), greedyByScore: summarise(byScore)};
}

if (!FAST && !process.env.WL_NO_WRITE) fs.writeFileSync(path.join(__dirname, '..', 'reports', 'scoring_report.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({P1: out.P1, P2: out.P2, P3: {goldOnly: out.P3.goldOnlySentences, nonzero: out.P3.goldOnlyNonzero}, P4ext: out.P4.extension, P6: out.P6, J: out.J, failures: out.failures.length}, null, 0));
for (const [k, rows] of Object.entries(out.P4)) if (Array.isArray(rows)) console.log('P4', k.padEnd(26), rows.map(r => r.score).join(' '));
console.table(out.P5);
console.table(out.split);
console.table(out.S.map(x => ({strategy: x.strategy, blue: x.blueTiles, score: x.score, perTile: x.perBlueTile})));
if (out.O) for (const k of ['greedyByPointsPerTile', 'greedyByScore']) { const o = out.O[k]; console.log(k, JSON.stringify({sentences: o.sentences, tiles: o.blueTilesUsed, total: o.total, perTile: o.perTile, meanBlue: o.meanBluePerSentence, types: o.utteranceTypes, structShare: o.structuralShare, listItems: o.listItems})); console.log('  top families', o.topFamilies.map(f => f.join(':')).join(' ')); o.best.forEach(b => console.log('  ', b.score, b.text)); }
if (out.failures.length) { console.log('FAILURES'); out.failures.slice(0, 12).forEach(f => console.log(' ', JSON.stringify(f).slice(0, 300))); }
process.exitCode = out.failures.length ? 1 : 0;
