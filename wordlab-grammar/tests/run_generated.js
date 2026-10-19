'use strict';
/*
 * Automated streams that need no human judgement:
 *   1. generated positives  — exact recovery of the generating tree;
 *   2. typed corruptions    — acceptance rate per corruption type;
 *   3. differential vs v1.1 — same items through the shipped v1.1 parser;
 *   4. timing               — parse time by sentence length.
 * Writes reports/generated_summary.json and reports/corruption_acceptances.jsonl,
 * and the ERG batch input erg/phase0_batch.jsonl.
 *
 * Usage: node tests/run_generated.js [count=1500] [seed=20261019]
 */
const fs = require('fs'), path = require('path');
const {load} = require('../src/load');
const {buildGenerator} = require('./generate');

const COUNT = Number(process.argv[2]) || 1500, SEED = Number(process.argv[3]) || 20261019;
const engine = load();
const gen = buildGenerator(engine, SEED);
const root = path.join(__dirname, '..');

// v1.1 reference (differential only)
const v11G = require('../reference/v1_1/starpin_grammar_v1_1.js');
const v11Lex = JSON.parse(fs.readFileSync(path.join(root, 'data', 'v1_1_lexicon.json'), 'utf8'));
const v11 = v11G.createEngine(v11Lex);
const V11_HELPERS = Object.keys(v11G.HELPER_POS).concat(['can', 'because', 'will', 'must', 'they', 'this', 'that', 'before', 'when', 'where', 'inside', 'into', 'toward', 'all']);
const ALL_BIP = v11Lex.entries.map(e => e.word);
function v11Parse(tiles) {
  try {
    const r = v11.parse(tiles.map(t => t.word), {owned: ALL_BIP, helpers: V11_HELPERS, tokenTypes: tiles.map(t => t.source === 'helper' ? 'helper' : 'collected')});
    return r.valid ? 'accept' : (r.reason === 'helper_not_unlocked' || r.reason === 'unknown_word' ? 'n/a' : 'reject');
  } catch (e) { return 'error'; }
}
const text = tiles => tiles.map(t => t.word).join(' ');

const pos = [], famUse = {}, famRecovered = {}, timing = [];
let recovered = 0, recognised = 0, failures = [];
const seen = new Set();
function runItem(item, targeted) {
  if (!item) return;
  const key = text(item.tiles); if (seen.has(key)) return; seen.add(key);
  const t0 = process.hrtime.bigint();
  const res = engine.parseTiles(item.tiles, {returnForest: true, k: 4});
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  timing.push({len: item.tiles.length, ms});
  const fams = new Set(); (function walk(x) { if (x.leaf) return; if (x.rule.spec.fam) fams.add(x.rule.spec.fam); x.kids.forEach(walk); })(item.tree);
  for (const f of fams) famUse[f] = (famUse[f] || 0) + 1;
  const ok = res.state === 'recognised' && gen.inForest(res.forest, item.tree);
  if (res.state === 'recognised') recognised++;
  if (ok) { recovered++; for (const f of fams) famRecovered[f] = (famRecovered[f] || 0) + 1; }
  else failures.push({text: key, state: res.state});
  pos.push({item, fams: [...fams], targeted, v11: v11Parse(item.tiles), state: res.state, canonical: res.canonical ? res.canonical.bracket : null, utype: res.canonical ? res.canonical.utteranceType : null});
}
for (let n = 0; pos.length < COUNT && n < COUNT * 20; n++) runItem(gen.generate({maxTokens: 24, depth: 6 + Math.floor(gen.rnd() * 4)}), false);
// Targeted top-up: every construction family gets at least MIN_PER_FAMILY items.
const MIN_PER_FAMILY = 40;
const specByFam = {};
for (const r of engine.strict.rules) if (r.spec.fam) (specByFam[r.spec.fam] = specByFam[r.spec.fam] || new Set()).add(r.spec.id);
let targetedCount = 0;
for (const [fam, specs] of Object.entries(specByFam)) {
  for (let tries = 0; (famUse[fam] || 0) < MIN_PER_FAMILY && tries < 400; tries++) {
    const before = pos.length;
    runItem(gen.generate({maxTokens: 24, depth: 6 + Math.floor(gen.rnd() * 3), forceSpec: [...specs][tries % specs.size]}), true);
    if (pos.length > before) targetedCount++;
  }
}

// corruptions
const corr = [], corrStats = {};
for (const p of pos) for (const c of gen.corrupt(p.item)) {
  const r = engine.parseTiles(c.tiles, {k: 4});
  const v = v11Parse(c.tiles);
  const st = corrStats[c.type] = corrStats[c.type] || {n: 0, oursAccept: 0, oursConflict: 0, oursConflictMatches: 0, v11Accept: 0, v11Applicable: 0};
  st.n++;
  if (r.state === 'recognised') st.oursAccept++;
  if (r.state === 'recognised' && c.type === 'object_drop') {
    const verb = (c.target.match(/"(.+)"/) || [])[1];
    if (r.canonical.roles.some(x => x.word === verb && x.pos === 'V')) st.oursAcceptVerbKept = (st.oursAcceptVerbKept || 0) + 1;
  }
  if (r.state === 'conflict') { st.oursConflict++; const expect = {agreement: 'agreement', article: 'article', det_drop: 'det_noun', case: 'case', object_drop: 'verb_frame'}[c.type]; if (expect && r.conflict.constraint === expect) st.oursConflictMatches++; }
  if (v !== 'n/a' && v !== 'error') { st.v11Applicable++; if (v === 'accept') st.v11Accept++; }
  corr.push({type: c.type, target: c.target, original: text(p.item.tiles), text: text(c.tiles), tiles: c.tiles, ours: r.state,
    conflict: r.conflict ? r.conflict.constraint : null, canonical: r.canonical ? r.canonical.bracket : null,
    utype: r.canonical ? r.canonical.utteranceType : null, families: r.canonical ? r.canonical.families : [],
    nonCuratedReadings: r.canonical ? r.canonical.roles.filter(x => x.tier && x.tier !== 'curated').map(x => x.word + ':' + x.pos + '(' + x.tier + ')') : [],
    canonicalRoles: r.canonical ? r.canonical.roles.map(x => x.word + '/' + x.pos + ':' + x.role).join(' ') : null, v11: v});
}

// differential on positives
const diff = {v11Accept: 0, v11Reject: 0, v11NA: 0};
for (const p of pos) { if (p.v11 === 'accept') diff.v11Accept++; else if (p.v11 === 'reject') diff.v11Reject++; else diff.v11NA++; }
const v11RejectByFam = {};
for (const p of pos) if (p.v11 === 'reject') for (const f of p.fams) v11RejectByFam[f] = (v11RejectByFam[f] || 0) + 1;

// timing buckets
const buckets = {};
for (const t of timing) { const b = t.len <= 8 ? '1-8' : t.len <= 14 ? '9-14' : t.len <= 20 ? '15-20' : '21-24'; (buckets[b] = buckets[b] || []).push(t.ms); }
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const timingSummary = Object.fromEntries(Object.entries(buckets).map(([b, a]) => [b, {n: a.length, p50: +q(a, 0.5).toFixed(2), p95: +q(a, 0.95).toFixed(2), max: +Math.max(...a).toFixed(2)}]));

const families = [...new Set(engine.strict.rules.map(r => r.spec.fam).filter(Boolean))].sort();
const coverage = families.map(f => ({family: f, generated: famUse[f] || 0, recovered: famRecovered[f] || 0, v11Rejected: v11RejectByFam[f] || 0}));
const summary = {version: engine.VERSION, seed: SEED, generated: pos.length, targeted: targetedCount, minPerFamily: MIN_PER_FAMILY, recognised, recovered, recoveryFailures: failures.slice(0, 20),
  coverage, corruption: corrStats, differentialPositives: diff, timing: timingSummary,
  grammar: engine.stats, compileMs: engine.compileMs};
if (!process.env.WL_NO_WRITE) {
fs.mkdirSync(path.join(root, 'reports'), {recursive: true});
fs.writeFileSync(path.join(root, 'reports', 'generated_summary.json'), JSON.stringify(summary, null, 1));
fs.writeFileSync(path.join(root, 'reports', 'corruption_results.jsonl'), corr.map(c => JSON.stringify(c)).join('\n') + '\n');
fs.writeFileSync(path.join(root, 'reports', 'corruption_acceptances.jsonl'), corr.filter(c => c.ours === 'recognised').map(c => JSON.stringify(c)).join('\n') + '\n');
fs.writeFileSync(path.join(root, 'reports', 'generated_positives.jsonl'), pos.map(p => JSON.stringify({text: text(p.item.tiles), tiles: p.item.tiles, families: p.fams, canonical: p.canonical, utype: p.utype, v11: p.v11})).join('\n') + '\n');
}
module.exports = {summary, pos, corr};
console.log(JSON.stringify({generated: pos.length, targeted: targetedCount, recognised, recovered, corruption: corrStats, differentialPositives: diff, timing: timingSummary}, null, 1));
