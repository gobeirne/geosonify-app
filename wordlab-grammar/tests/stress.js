'use strict';
// Adversarial timing: ambiguity explosions and very long inputs.
const {load} = require('../src/load');
const e = load();
const nouns0 = ['prison', 'patient', 'parrot', 'menu', 'banana', 'garden', 'fence', 'table', 'stairs', 'ketchup', 'output', 'script', 'soldier', 'steel', 'salad', 'canvas', 'autumn', 'october', 'symbol', 'journey', 'pepper', 'kitchen', 'castle', 'rocket', 'island', 'jungle', 'winter', 'summer', 'school', 'office', 'pencil', 'carpet', 'window', 'mirror', 'rabbit', 'monkey', 'tiger', 'eagle', 'donkey', 'horse', 'lion', 'dolphin', 'elephant', 'mouse', 'piano', 'violin', 'guitar', 'battery', 'cable', 'engine', 'bridge', 'tunnel', 'harbor', 'village'];
const nouns = [...new Set(nouns0)].filter(w => e.lexicon.byWord.has(w));
const preps = ['in', 'on', 'at', 'with', 'from', 'by', 'inside', 'near', 'under', 'behind', 'beyond', 'above'];
const cases = [];
for (const n of [10, 20, 40, Math.min(nouns.length, 50)]) cases.push({name: n + '-noun compound subject', text: 'The ' + nouns.slice(0, n).join(' ') + ' is bitter.'});
for (const n of [4, 6, 8, 10]) {
  let s = 'Put the cat'; for (let i = 0; i < n; i++) s += ' ' + preps[i % preps.length] + ' the ' + nouns[i + 20];
  cases.push({name: n + ' stacked PPs (attachment ambiguity)', text: s + '.'});
}
for (const n of [8, 16]) {
  const vs = ['run', 'jump', 'swim', 'dance', 'fly', 'float', 'shiver', 'blossom', 'crumble', 'arrive', 'climb', 'bounce', 'chuckle', 'argue', 'whisper', 'travel', 'wander', 'wait', 'work', 'vote', 'yell', 'rest', 'retire', 'relax'];
  cases.push({name: n + ' coordinated clauses', text: Array.from({length: n}, (_, i) => 'the ' + nouns[i + 30] + ' can ' + vs[i]).join(' and ') + '.'});
}
cases.push({name: '40-token realistic', text: 'Fix the fossil figure in the favorite filter and forget the grid gadget in the garage, for staff on stage sign steel soldier script output because the vivid autumn blossom and the famous canvas cat bag can crumble on the inner coast.'});
cases.push({name: 'mixed subordination + coordination', text: 'The dog can run because the cat can jump and the fish can swim when the bird can sing because the lion can dance and the horse can fly.'});
// Explicit tiles, as the game supplies them: the first occurrence of a BIP39
// word is blue, later occurrences gold (only if that word is a helper).
const {HELPER_CANDIDATES} = require('../src/lexicon');
function tiles(text) {
  const seen = new Set();
  return text.toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).map(w => {
    if (e.lexicon.byWord.has(w) && !seen.has(w) && !(HELPER_CANDIDATES.includes(w) && w === 'can')) { seen.add(w); return {word: w, source: 'collected'}; }
    return {word: w, source: 'helper'};
  });
}
for (const c of cases) c.tiles = tiles(c.text);
const out = [];
for (const c of cases) {
  for (let i = 0; i < 2; i++) e.parseTiles(c.tiles); // warm
  const t0 = process.hrtime.bigint(); let r; const reps = 5;
  for (let i = 0; i < reps; i++) r = e.parseTiles(c.tiles);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / reps;
  out.push({name: c.name, tokens: r.tiles.length, state: r.state, trees: r.treeCount, ms: +ms.toFixed(1)});
}
console.table(out);
module.exports = out;
if (require.main === module) require('fs').writeFileSync(require('path').join(__dirname, '..', 'reports', 'stress_timing.json'), JSON.stringify(out, null, 1));
