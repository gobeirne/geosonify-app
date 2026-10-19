'use strict';
/*
 * Re-run the CURRENT engine on the exact tiles behind each ERG batch item and
 * cross-tabulate against the stored ERG analysis types. Shows whether grammar
 * changes moved Phase 0 towards or away from ERG, without a new Colab run.
 * Usage: node erg/rescore.js [tag=erg_phase0] [tiles=erg/phase0_batch_tiles.jsonl]
 * (a batch built by prepare.js carries its own tiles: pass the batch file).
 */
const fs = require('fs'), path = require('path');
const {load} = require('../src/load');
const root = path.join(__dirname, '..');
const engine = load();
const readJsonl = f => fs.readFileSync(path.join(root, f), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const norm = s => s.toLowerCase().replace(/[.,?]/g, ' ').split(/\s+/).filter(Boolean).join(' ');
// Tiles per batch item: from the batch itself, or the archived tiles file.
const TAG = process.argv[2] || 'erg_phase0';
const TILES = process.argv[3] || 'erg/phase0_batch_tiles.jsonl';
const tilesById = new Map(readJsonl(TILES).map(t => [t.id, t.tiles]));
const an = JSON.parse(fs.readFileSync(path.join(root, 'reports', TAG + '_analysis.json'), 'utf8'));
const W = new Set(['full_clause', 'vp_ellipsis', 'np_fragment']);
const tab = {}, changes = [];
for (const it of an.items) {
  if (it.kind === 'probe') continue;
  const tiles = tilesById.get(it.id);
  if (!tiles) continue;
  const now = engine.parseTiles(tiles, {k: 4}).state === 'recognised' ? 'accept' : 'reject';
  const before = it.ours === 'recognised' ? 'accept' : 'reject';
  const erg = W.has(it.erg) ? 'ERG witness' : 'ERG no';
  const k = it.kind.replace('corruption_', '') + ' | ' + erg;
  const t = tab[k] = tab[k] || {n: 0, before: 0, now: 0};
  t.n++; if (before === 'accept') t.before++; if (now === 'accept') t.now++;
  if (before !== now) changes.push({kind: it.kind, type: it.type, text: it.text, erg: it.erg, before, now});
}
const md = ['| Item set | ERG | n | Phase 0 accepted (ERG run) | Phase 0 accepts now |', '|---|---|---:|---:|---:|'];
for (const [k, v] of Object.entries(tab).sort()) { const [a, b] = k.split(' | '); md.push(`| ${a} | ${b} | ${v.n} | ${v.before} | ${v.now} |`); }
const out = {table: tab, changes};
fs.writeFileSync(path.join(root, 'reports', TAG + '_rescore.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(root, 'reports', TAG + '_rescore.md'), ['# Current engine vs stored ERG results', '', ...md, '', '## Verdicts that changed', '', ...changes.map(c => `- ${c.before}→${c.now} [${c.type || c.kind}] ${c.text} (ERG: ${c.erg})`)].join('\n'));
console.log(md.join('\n'));
console.log('\nchanged verdicts:', changes.length);
for (const c of changes.filter(c => c.now === 'reject' && W.has(c.erg)).slice(0, 25)) console.log('  NEW REJECT, ERG witnessed: [' + (c.type || c.kind) + '] ' + c.text + ' (' + c.erg + ')');
