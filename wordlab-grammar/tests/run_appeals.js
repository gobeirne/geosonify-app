'use strict';
/*
 * Player appeals ("I think this is fine") decided by the reviewer, exported
 * from wordlab-appeals.html to tests/appeals.json. Checked against the current
 * grammar, for information (not a gate):
 *   accepted, now recognised   — the grammar has caught up
 *   accepted, still rejected   — known gaps: candidates for the next version
 *   rejected, now recognised   — over-acceptance to look at
 * Usage: node tests/run_appeals.js [path=tests/appeals.json] [--list]
 */
const fs = require('fs'), path = require('path');
const {load} = require('../src/load');
const file = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || path.join(__dirname, 'appeals.json');
const list = process.argv.includes('--list');
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {appeals: []};
const engine = load();
const out = {acceptedRecognised: [], acceptedRejected: [], rejectedRecognised: [], rejectedRejected: []};
for (const a of data.appeals || []) {
  const r = engine.parseTiles((a.words || a.text.split(/\s+/)).map(word => ({word})), {k: 4});
  const ok = r.state === 'recognised';
  const key = (a.status === 'accepted' ? 'accepted' : 'rejected') + (ok ? 'Recognised' : 'Rejected');
  out[key].push({id: a.id, text: a.text, state: r.state, note: a.reviewNote || a.note || ''});
}
const summary = {version: engine.VERSION, appeals: (data.appeals || []).length,
  acceptedRecognised: out.acceptedRecognised.length, acceptedStillRejected: out.acceptedRejected.length,
  rejectedNowRecognised: out.rejectedRecognised.length};
console.log(JSON.stringify(summary));
if (list) for (const k of ['acceptedRejected', 'rejectedRecognised']) for (const x of out[k]) console.log(k.padEnd(20), x.state.padEnd(12), x.text, x.note ? '  // ' + x.note : '');
module.exports = {summary, out};
