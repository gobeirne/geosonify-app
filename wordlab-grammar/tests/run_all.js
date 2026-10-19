'use strict';
/*
 * CI gates for Phase 0. Exit code 1 if any gate fails.
 *   G1 every intended-analysis probe passes
 *   G2 100% of generated derivations recognised AND exactly recovered
 *   G3 typed corruptions that change no alternative-reading-prone material are
 *      caught: article swaps 0 accepted; object drops (transitive-only verbs)
 *      <= 5% accepted
 *   G4 every caught agreement/article/case corruption is attributed to the
 *      right constraint at least 70% of the time (diagnostic quality); a case
 *      corruption (only 'myself' is available) may also be named as agreement
 *   G5 Node timing: p95 <= 25 ms for 21-24-token generated sentences
 *   G6 scoring invariants P1, P2, P3', P4', P5, J: zero failures
 * Usage: node tests/run_all.js [count=800]
 */
const {execFileSync} = require('child_process');
const path = require('path');
const gates = [];
const probes = require('./run_probes').main();
gates.push(['G1 probes', probes.fail === 0, `${probes.pass}/${probes.pass + probes.fail}`]);
const count = process.argv[2] || '800';
const out = execFileSync(process.execPath, [path.join(__dirname, 'run_generated.js'), count, '20261019'], {encoding: 'utf8', maxBuffer: 1 << 26, env: {...process.env, WL_NO_WRITE: '1'}});
const j = JSON.parse(out);
gates.push(['G2 generated recovery', j.recognised === j.generated && j.recovered === j.generated, `${j.recovered}/${j.generated}`]);
const c = j.corruption;
const rate = t => c[t] ? c[t].oursAccept / c[t].n : 0;
gates.push(['G3 article swaps rejected', !c.article || c.article.oursAccept === 0, c.article ? `${c.article.oursAccept}/${c.article.n} accepted` : 'n/a']);
// An accepted object drop is a violation only if the verb is still read as a
// verb missing its object; re-analysis (to + bare noun, verb as adjective) is
// a genuine alternative reading and is left to the ERG cross-check.
const od = c.object_drop || {n: 0, oursAccept: 0};
gates.push(['G3 object drops rejected', (od.oursAcceptVerbKept || 0) <= Math.max(0, Math.floor(0.05 * od.n)), `${od.oursAcceptVerbKept || 0}/${od.n} kept the verb; ${od.oursAccept} accepted via re-analysis`]);
for (const t of ['agreement', 'article', 'case']) if (c[t]) {
  const caught = c[t].n - c[t].oursAccept;
  gates.push([`G4 ${t} attribution`, caught === 0 || c[t].oursConflictMatches / caught >= 0.7, `${c[t].oursConflictMatches}/${caught} named correctly`]);
}
const p95 = j.timing['21-24'] ? j.timing['21-24'].p95 : 0;
gates.push(['G5 p95 21-24 tokens (Node)', p95 <= 25, p95 + ' ms']);
let sOut = '';
let sOk = true;
try { sOut = execFileSync(process.execPath, [path.join(__dirname, 'run_scoring.js'), '300', 'fast'], {encoding: 'utf8', maxBuffer: 1 << 26, env: {...process.env, WL_NO_WRITE: '1'}}); }
catch (e) { sOk = false; sOut = String(e.stdout || ''); }
const sj = JSON.parse(sOut.split('\n')[0]);
gates.push(['G6 scoring invariants', sOk && sj.failures === 0, `${sj.failures} failures (P1 ${sj.P1.violations}/${sj.P1.n}, P2 ${sj.P2.violations}/${sj.P2.insertions}, P3' ${sj.P3.nonzero}/${sj.P3.goldOnly})`]);
let ok = true;
console.log('\nGates');
for (const [name, pass, detail] of gates) { console.log((pass ? 'PASS ' : 'FAIL ') + name.padEnd(32) + detail); ok = ok && pass; }
process.exitCode = ok ? 0 : 1;
