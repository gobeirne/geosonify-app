'use strict';
/*
 * Build the ERG cross-check batch from the Phase 0 outputs. No sentence needs
 * human judgement: the analysis aggregates by construction family and
 * corruption type.
 *
 * Inputs: tests/probes.json, reports/generated_positives.jsonl,
 *         reports/corruption_results.jsonl (run tests/run_generated.js first).
 * Output: erg/phase0_batch.jsonl  — one {id, kind, text, ours…} per line.
 * Usage:  node erg/prepare.js [positives=400] [acceptedCorruptions=600] [rejectedCorruptions=300]
 */
const fs = require('fs'), path = require('path');
const {load} = require('../src/load');
const {makeRng} = require('../tests/generate');
const root = path.join(__dirname, '..');
const [NP = 400, NA = 600, NR = 300] = process.argv.slice(2).map(Number);
const rnd = makeRng(4242);
const engine = load();
const readJsonl = f => fs.readFileSync(path.join(root, f), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function stratified(items, key, n) {
  const groups = {}; for (const x of items) (groups[key(x)] = groups[key(x)] || []).push(x);
  const ks = Object.keys(groups), out = [];
  let i = 0; const pools = Object.fromEntries(ks.map(k => [k, shuffle(groups[k])]));
  while (out.length < n && ks.some(k => pools[k].length)) { const k = ks[i++ % ks.length]; if (pools[k].length) out.push(pools[k].pop()); }
  return out;
}
// Orthography for ERG: capitalise, final punctuation by utterance type, and a
// comma before coordinating 'for' (punctuation is orthographic in the game).
function orth(text, utype, families) {
  let s = text;
  if ((families || []).includes('causal_for_coordination')) s = s.replace(/ for /, ', for ');
  s = s.charAt(0).toUpperCase() + s.slice(1);
  s = s.replace(/\bi\b/g, 'I');
  return s + (utype === 'question' ? '?' : '.');
}
const batch = [];
const probes = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'probes.json'), 'utf8')).probes;
for (const p of probes) {
  if (p.tiles) continue;
  const r = engine.parse(p.text);
  batch.push({id: 'probe:' + p.id, kind: 'probe', text: p.text, ours: r.state, families: r.canonical ? r.canonical.families : [], expect: p.expect.state});
}
const pos = readJsonl('reports/generated_positives.jsonl');
for (const [i, p] of stratified(pos, x => x.utype || '?', NP).entries())
  batch.push({id: 'gen:' + i, kind: 'generated_positive', text: orth(p.text, p.utype, p.families), ours: 'recognised', families: p.families, utype: p.utype});
const corr = readJsonl('reports/corruption_results.jsonl');
const acc = corr.filter(c => c.ours === 'recognised'), rej = corr.filter(c => c.ours !== 'recognised');
for (const [i, c] of stratified(acc, x => x.type, NA).entries())
  batch.push({id: 'corrA:' + i, kind: 'corruption_accepted', type: c.type, target: c.target, text: orth(c.text, c.utype, c.families), original: c.original, ours: c.ours, families: c.families, nonCurated: c.nonCuratedReadings});
for (const [i, c] of stratified(rej, x => x.type, NR).entries())
  batch.push({id: 'corrR:' + i, kind: 'corruption_rejected', type: c.type, target: c.target, text: orth(c.text, null, []), original: c.original, ours: c.ours, conflict: c.conflict});
fs.writeFileSync(path.join(__dirname, 'phase0_batch.jsonl'), batch.map(b => JSON.stringify(b)).join('\n') + '\n');
const tally = {}; for (const b of batch) tally[b.kind] = (tally[b.kind] || 0) + 1;
console.log('wrote erg/phase0_batch.jsonl', tally);
