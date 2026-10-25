'use strict';
/*
 * Reconstruct dated word finds from a Starpin records export, and set
 * challenge hands from them.
 *   node tools/reconstruct_finds.js <starpin-records.json> <dir-with-geosonify-js> [out.json]
 * <dir> must contain geosonify-healpix.js, bip39-official-wordlists.js,
 * geosonify-hpwords.js and geosonify-starpin.js (the Starpin app sources).
 * Each non-superseded, non-deleted record yields the words of its find under
 * find-words-v1 (GeosonifyStarpin.findWords, the rule the Starpin app shows):
 * the 4-word HEALPix address (healpix-bip39-v1) of the stored starpin address,
 * or, for a cornerstone, of the 4-word cell inside the named cell at the named
 * corner (a vertex is shared by four cells, so its point alone is ambiguous).
 * Output: [{id, kind, time_ms, nzDate, what, words}] by time.
 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const [recPath, dir, out = 'finds.json'] = process.argv.slice(2);
const ctx = {console}; ctx.window = ctx; vm.createContext(ctx);
for (const f of ['geosonify-healpix.js', 'bip39-official-wordlists.js', 'geosonify-hpwords.js', 'geosonify-starpin.js'])
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, {filename: f});
const S = ctx.GeosonifyStarpin;
const d = JSON.parse(fs.readFileSync(recPath, 'utf8'));
const superseded = new Set(d.records.map(r => r.supersedes).filter(Boolean)), deleted = new Set(Object.keys(d.deleted || {}));
const nz = ms => new Intl.DateTimeFormat('en-CA', {timeZone: 'Pacific/Auckland'}).format(new Date(ms));
const finds = [];
for (const r of d.records) {
  if (superseded.has(r.record_id) || deleted.has(r.record_id)) continue;
  const what = r.target.cornerstone || r.target.starpin, fw = S.findWords(r.target);
  if (!fw) throw new Error(`no find words for record ${r.record_id}`);
  finds.push({id: r.record_id, kind: r.kind, time_ms: r.event.time_ms, nzDate: nz(r.event.time_ms), what, words: fw.words});
}
finds.sort((a, b) => a.time_ms - b.time_ms);
fs.writeFileSync(out, JSON.stringify(finds, null, 1));
console.log(`${finds.length} finds, ${new Set(finds.flatMap(f => f.words)).size} distinct words -> ${out}`);
