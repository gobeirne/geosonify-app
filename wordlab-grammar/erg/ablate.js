'use strict';
/*
 * Measure each Phase 0 policy switch against stored ERG results: for each
 * switch, turning it ON (vs all-off baseline) newly rejects some items. Gain =
 * newly rejected items ERG does NOT witness; cost = newly rejected items ERG
 * DOES witness (full clause, VP ellipsis or NP fragment).
 * Usage: node erg/ablate.js [tag=erg_phase0] [tiles=erg/phase0_batch_tiles.jsonl]
 * Also reports a length-controlled ratio: ERG witnesses among the sentences a
 * source admits, divided by the number expected at the curated-only rate for
 * sentences of the same length. Rule used in Phase 0: keep a source enabled
 * if the ratio is >= 0.8. Runs with WL_ALL_FRAMES=1 so that demoted verb-frame
 * types are measured as if enabled (reproducing the decision).
 */
const {execFileSync} = require('child_process');
const path = require('path');
// Switches defined in src/grammar.js (OFF set). Add new candidate policies there.
const TAG = process.argv[2] || 'erg_phase0', TILES = process.argv[3] || 'erg/phase0_batch_tiles.jsonl';
const SW = ['COLL', 'MASS', 'IDIOM', 'VF_intr', 'VF_tr', 'VF_ditr', 'VF_cop', 'VF_toinf', 'VF_clause'];
const run = off => JSON.parse(execFileSync(process.execPath, ['-e', `
  const fs=require('fs'),path=require('path');const {load}=require('./src/load');const e=load();
  const rj=f=>fs.readFileSync(f,'utf8').trim().split('\\n').map(JSON.parse);
  const T=new Map(rj(process.env.WL_TILES).map(t=>[t.id,t.tiles]));
  const an=JSON.parse(fs.readFileSync('reports/'+process.env.WL_TAG+'_analysis.json','utf8'));const o={};
  for(const it of an.items){if(it.kind==='probe')continue;const t=T.get(it.id);if(!t)continue;o[it.id]=e.parseTiles(t,{k:2}).state==='recognised'}
  process.stdout.write(JSON.stringify(o));`], {cwd: path.join(__dirname, '..'), env: {...process.env, WL_OFF: off.join(','), WL_TAG: TAG, WL_TILES: TILES, WL_ALL_FRAMES: '1'}, encoding: 'utf8', maxBuffer: 1 << 26}));
const an = require('../reports/' + TAG + '_analysis.json');
const W = new Set(['full_clause', 'vp_ellipsis', 'np_fragment']);
const erg = Object.fromEntries(an.items.map(i => [i.id, W.has(i.erg)]));
// Baseline: everything ON (current policy); for each switch, measure what
// turning it ON adds by comparing against a run with only that switch OFF.
const allOn = run([]);

const res = {};
for (const s of SW) {
  const off = run([s]);
  // items accepted only because the switch is on are the switch's contribution
  const newly = Object.keys(allOn).filter(id => off[id] && !allOn[id]);  // rejections the switch adds
  const added = Object.keys(allOn).filter(id => allOn[id] && !off[id]);  // acceptances the switch adds
  // A restricting switch (COLL) adds rejections; an evidence switch adds acceptances.
  const rejGain = newly.filter(id => !erg[id]).length, rejCost = newly.filter(id => erg[id]).length;
  const accAgree = added.filter(id => erg[id]).length, accDisagree = added.filter(id => !erg[id]).length;
  res[s] = {addsRejections: newly.length, rejAgree: rejGain, rejDisagree: rejCost, addsAcceptances: added.length, accAgree, accDisagree,
    costIds: newly.filter(id => erg[id]), accDisagreeIds: added.filter(id => !erg[id])};
  console.log(s.padEnd(10) + ' | rejects +' + String(newly.length).padStart(4) + ' (ERG agrees ' + rejGain + ', disagrees ' + rejCost + ') | accepts +' + String(added.length).padStart(4) + ' (ERG witnesses ' + accAgree + ', not ' + accDisagree + ')');
}
// Length-controlled ratio for evidence sources.
const len = Object.fromEntries(an.items.map(i => [i.id, (i.text.match(/[A-Za-z']+/g) || []).length]));
const bucket = l => l <= 6 ? 'a' : l <= 12 ? 'b' : l <= 18 ? 'c' : 'd';
const curated = run(SW.filter(s => s !== 'COLL'));
const curR = {};
for (const id of Object.keys(curated)) if (curated[id]) { const k = bucket(len[id]); curR[k] = curR[k] || [0, 0]; curR[k][1]++; if (erg[id]) curR[k][0]++; }
for (const s of SW.filter(x => x !== 'COLL')) {
  const off = run([s]);
  const added = Object.keys(allOn).filter(id => allOn[id] && !off[id]);
  const exp = added.reduce((a, id) => { const r = curR[bucket(len[id])]; return a + (r ? r[0] / r[1] : 0); }, 0);
  const obs = added.filter(id => erg[id]).length;
  res[s].lengthControlledRatio = exp ? +(obs / exp).toFixed(2) : null;
  console.log(s.padEnd(10) + ' length-controlled ratio ' + res[s].lengthControlledRatio + ' (n ' + added.length + ')');
}
require('fs').writeFileSync(path.join(__dirname, '..', 'reports', TAG + '_ablation.json'), JSON.stringify(res, null, 1));
