'use strict';
/*
 * Build bench/wordlab_grammar_bench.html: a single offline file bundling the
 * Phase 0 engine, slimmed evidence data and benchmark cases, for timing on a
 * real phone (Safari on iPhone). No network requests.
 * Usage: node tools/build_bench.js   (after tests/run_generated.js)
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// Slim data: only the fields the compiler reads.
const v11 = JSON.parse(read('data/v1_1_lexicon.json'));
const slimV11 = {metadata: {version: v11.metadata.version, bip39_sha256: v11.metadata.bip39_sha256}, entries: v11.entries.map(e => ({
  word: e.word, pronunciation_onset: e.pronunciation_onset ? {class: e.pronunciation_onset.class} : undefined,
  readings: e.readings.map(r => ({pos: r.pos, attributes: r.attributes, proposed_for_parser: r.proposed_for_parser,
    evidence: r.evidence ? {wiktionary_noun_attestations: r.evidence.wiktionary_noun_attestations, wordnet_verb_frame_ids: r.evidence.wordnet_verb_frame_ids, wiktionary_verb_usage_tags: r.evidence.wiktionary_verb_usage_tags} : undefined}))}))};
const oewn = JSON.parse(read('data/oewn_evidence.json'));
const slimOewn = {source: oewn.source, licence: oewn.licence, noun_lexfiles: oewn.noun_lexfiles, noun_first_sense_lexfile: oewn.noun_first_sense_lexfile,
  noun_first_group_sense_ancestors: oewn.noun_first_group_sense_ancestors, closed_form_prep_noun: oewn.closed_form_prep_noun, prep_noun_mwe: oewn.prep_noun_mwe,
  bare_prep_noun_usage: Object.fromEntries(Object.entries(oewn.bare_prep_noun_usage).map(([k, v]) => [k, {count: v.count, with_determiner: v.with_determiner}]))};

const probes = JSON.parse(read('tests/probes.json')).probes.map(p => ({id: p.id, text: p.text, tiles: p.tiles, expect: p.expect.state}));
const gen = read('reports/generated_positives.jsonl').trim().split('\n').map(JSON.parse).slice(0, 300).map(g => g.tiles);
const stressDef = [
  {name: '20-noun compound', text: 'The prison patient parrot menu banana garden fence table stairs ketchup output script soldier steel salad canvas autumn october symbol journey is bitter.'},
  {name: '10 stacked PPs', text: 'Put the cat in the pepper on the kitchen at the castle with the rocket from the island by the jungle inside the winter near the summer under the school behind the office.'},
  {name: '12 coordinated clauses', text: 'The dog can run and the cat can jump and the fish can swim and the bird can sing and the lion can dance and the horse can fly and the donkey can float and the eagle can shiver and the rabbit can blossom and the monkey can crumble and the tiger can arrive and the elephant can climb.'},
  {name: '40-token realistic', text: 'Fix the fossil figure in the favorite filter and forget the grid gadget in the garage, for staff on stage sign steel soldier script output because the vivid autumn blossom and the famous canvas cat bag can crumble on the inner coast.'},
];

const modules = ['lexicon', 'grammar', 'parser', 'engine'];
const bundle = modules.map(m => `__mods['./${m}'] = function (module, exports, require) {\n${read('src/' + m + '.js')}\n};`).join('\n');
const loader = `const __mods = {}, __cache = {};
function __req(name) { if (__cache[name]) return __cache[name].exports; const module = {exports: {}}; __cache[name] = module; __mods[name](module, module.exports, __req); return module.exports; }`;

const html = `<!doctype html>
<html lang="en-NZ">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Word Lab grammar — phone benchmark</title>
<style>
:root {
  --bg: #dfe5d3; --surface: #eef1e7; --ink: #1d2a1b; --muted: #4c5e48; --moss: #2f4a2c;
  --blue: #2f6690; --gold: #b8901c; --line: #b9c4a8; --bad: #9b2f22;
  color-scheme: light;
  box-sizing: border-box; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --bg: #172116; --surface: #1f2c1d; --ink: #dfe6d4; --muted: #a7b69d; --moss: #8fb385;
    --blue: #7fb0d8; --gold: #dcb64a; --line: #34452f; --bad: #e08a7c; color-scheme: dark; }
}
:root[data-theme="dark"] { --bg: #172116; --surface: #1f2c1d; --ink: #dfe6d4; --muted: #a7b69d; --moss: #8fb385;
  --blue: #7fb0d8; --gold: #dcb64a; --line: #34452f; --bad: #e08a7c; color-scheme: dark; }
*, *::before, *::after { box-sizing: inherit; }
html { scroll-padding-top: env(safe-area-inset-top, 0px); }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
main { max-width: 44rem; margin: 0 auto; padding: 1.5rem 1.1rem 3rem; }
h1 { font-size: 1.55rem; line-height: 1.2; margin: 0 0 .4rem; color: var(--moss); font-weight: 650; }
h2 { font-size: 1.08rem; margin: 2rem 0 .5rem; font-weight: 650; }
p { margin: .4rem 0; max-width: 38rem; }
.muted { color: var(--muted); }
button { font: inherit; font-weight: 600; background: var(--moss); color: var(--bg); border: 0; border-radius: .6rem; padding: .75rem 1.2rem; cursor: pointer; }
button:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px; }
button[disabled] { opacity: .55; cursor: default; }
.strip { display: flex; flex-wrap: wrap; gap: .3rem; min-height: 2.4rem; margin: 1.1rem 0; padding: .55rem; background: var(--surface); border-radius: .7rem; }
.tile { padding: .15rem .5rem; border-radius: .35rem; font-size: .9rem; font-weight: 600; color: #fff; background: var(--blue); }
.tile.g { background: var(--gold); color: #1d1a0c; }
.status { font-variant-numeric: tabular-nums; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; font-size: .93rem; }
th, td { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid var(--line); white-space: nowrap; }
td.n, th.n { text-align: right; }
textarea { width: 100%; min-height: 9rem; font: .8rem/1.4 ui-monospace, Menlo, monospace; background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: .5rem; padding: .6rem; }
.bad { color: var(--bad); font-weight: 600; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body>
<main>
<h1>Word Lab grammar: phone benchmark</h1>
<p class="muted">Phase 0 prototype engine, fully offline. Times start-up, ${gen.length} generated sentences, ${probes.length} probes and ${stressDef.length} stress sentences on this device. Nothing is sent anywhere.</p>
<div class="strip" id="strip" aria-live="polite"><span class="muted">Sentences appear here as they are parsed.</span></div>
<button id="run">Run benchmark</button>
<p class="status muted" id="status"></p>
<div id="out"></div>
</main>
<script>
${loader}
${bundle}
const DATA_V11 = ${JSON.stringify(slimV11)};
const DATA_OEWN = ${JSON.stringify(slimOewn)};
const PROBES = ${JSON.stringify(probes)};
const GEN = ${JSON.stringify(gen)};
const STRESS = ${JSON.stringify(stressDef)};
(function () {
  const $ = id => document.getElementById(id);
  const tick = () => new Promise(r => setTimeout(r, 0));
  const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const fmt = x => x.toFixed(1);
  function showTiles(tiles) {
    $('strip').innerHTML = tiles.map(t => '<span class="tile' + (t.source === 'helper' ? ' g' : '') + '">' + t.word.replace(/[<&]/g, '') + '</span>').join('');
  }
  function stressTiles(engine, text) {
    const seen = new Set();
    return text.toLowerCase().replace(/[.,]/g, ' ').split(/\\s+/).filter(Boolean).map(w => {
      if (engine.lexicon.byWord.has(w) && !seen.has(w) && w !== 'can') { seen.add(w); return {word: w, source: 'collected'}; }
      return {word: w, source: 'helper'};
    });
  }
  async function run() {
    $('run').disabled = true; $('out').innerHTML = '';
    const res = {userAgent: navigator.userAgent, when: new Date().toISOString()};
    $('status').textContent = 'Compiling lexicon and grammar…'; await tick();
    const t0 = performance.now();
    const {createEngine} = __req('./engine');
    const engine = createEngine(DATA_V11, DATA_OEWN);
    res.startupMs = performance.now() - t0; res.strictCompileMs = engine.compileMs;
    const t1 = performance.now(); engine.parse('The cat are happy.'); res.relaxedFirstUseMs = performance.now() - t1;
    for (let i = 0; i < 20; i++) engine.parseTiles(GEN[i % GEN.length]);
    const buckets = {};
    for (let i = 0; i < GEN.length; i++) {
      const tiles = GEN[i];
      if (i % 10 === 0) { showTiles(tiles); $('status').textContent = 'Generated sentence ' + (i + 1) + ' of ' + GEN.length; await tick(); }
      const t = performance.now(); engine.parseTiles(tiles); const ms = performance.now() - t;
      const b = tiles.length <= 8 ? '1–8' : tiles.length <= 14 ? '9–14' : tiles.length <= 20 ? '15–20' : '21–24';
      (buckets[b] = buckets[b] || []).push(ms);
    }
    res.generated = Object.fromEntries(['1–8', '9–14', '15–20', '21–24'].filter(b => buckets[b]).map(b => [b, {n: buckets[b].length, p50: q(buckets[b], .5), p95: q(buckets[b], .95), max: Math.max(...buckets[b])}]));
    res.stress = [];
    for (const s of STRESS) {
      const tiles = stressTiles(engine, s.text); showTiles(tiles); $('status').textContent = 'Stress: ' + s.name; await tick();
      engine.parseTiles(tiles); const reps = 3, t = performance.now(); let r; for (let i = 0; i < reps; i++) r = engine.parseTiles(tiles);
      res.stress.push({name: s.name, tokens: tiles.length, state: r.state, trees: r.treeCount, ms: (performance.now() - t) / reps});
    }
    let agree = 0; const disagree = [];
    for (const p of PROBES) {
      const input = p.tiles ? p.tiles.map(([word, source]) => ({word, source})) : p.text;
      const r = engine.parse(input);
      const ok = p.expect === 'not_recognised' ? r.state !== 'recognised' : r.state === p.expect;
      if (ok) agree++; else disagree.push(p.id + ': ' + r.state);
    }
    res.probes = {stateAgree: agree, n: PROBES.length, disagree};
    const r1 = x => typeof x === 'number' ? Math.round(x * 10) / 10 : x;
    (function round(o) { for (const k in o) { if (o[k] && typeof o[k] === 'object') round(o[k]); else o[k] = r1(o[k]); } })(res);
    render(res);
    $('status').textContent = 'Done.'; $('run').disabled = false;
  }
  function render(res) {
    const g = Object.entries(res.generated).map(([b, s]) => '<tr><td>' + b + ' tokens</td><td class="n">' + s.n + '</td><td class="n">' + fmt(s.p50) + '</td><td class="n">' + fmt(s.p95) + '</td><td class="n">' + fmt(s.max) + '</td></tr>').join('');
    const st = res.stress.map(s => '<tr><td>' + s.name + '</td><td class="n">' + s.tokens + '</td><td>' + s.state + '</td><td class="n">' + (s.trees || '—') + '</td><td class="n">' + fmt(s.ms) + '</td></tr>').join('');
    $('out').innerHTML =
      '<h2>Start-up</h2><p>Lexicon and strict grammar: <b>' + fmt(res.startupMs) + ' ms</b> (grammar ' + fmt(res.strictCompileMs) + ' ms). First diagnosis of a failed sentence, including the lazy relaxed-grammar compile: ' + fmt(res.relaxedFirstUseMs) + ' ms.</p>' +
      '<h2>Generated sentences</h2><div class="scroll"><table><tr><th>Length</th><th class="n">n</th><th class="n">p50 ms</th><th class="n">p95 ms</th><th class="n">max ms</th></tr>' + g + '</table></div>' +
      '<h2>Stress sentences</h2><div class="scroll"><table><tr><th>Case</th><th class="n">Tokens</th><th>State</th><th class="n">Trees</th><th class="n">ms</th></tr>' + st + '</table></div>' +
      '<h2>Probes</h2><p>' + res.probes.stateAgree + ' of ' + res.probes.n + ' probes reach the expected state on this device.' + (res.probes.disagree.length ? ' <span class="bad">Different: ' + res.probes.disagree.join(', ') + '</span>' : '') + '</p>' +
      '<h2>Results to send back</h2><p class="muted">Copy this and paste it into the chat.</p><textarea id="json" readonly>' + JSON.stringify(res, null, 1) + '</textarea><p><button id="copy">Copy results</button></p>';
    $('copy').onclick = async () => {
      try { await navigator.clipboard.writeText($('json').value); $('copy').textContent = 'Copied'; }
      catch (e) { $('json').select(); $('copy').textContent = 'Select-all done: copy manually'; }
    };
  }
  $('run').onclick = run;
})();
</script>
</body>
</html>
`;
fs.mkdirSync(path.join(root, 'bench'), {recursive: true});
fs.writeFileSync(path.join(root, 'bench', 'wordlab_grammar_bench.html'), html);
console.log('wrote bench/wordlab_grammar_bench.html', (html.length / 1024).toFixed(0) + ' KiB');
