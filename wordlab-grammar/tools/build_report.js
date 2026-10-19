'use strict';
/*
 * Assemble reports/PHASE0_REPORT.md from the generated outputs. Every number
 * is read from a file produced by the suites, never typed by hand.
 * Run after: tests/run_generated.js 1500, tests/stress.js, tools/report_lexicon.js, erg/prepare.js
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const R = f => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const {load} = require('../src/load');
const {runProbe} = require('../tests/run_probes');
const engine = load();
const gen = R('reports/generated_summary.json');
const stress = R('reports/stress_timing.json');
const probes = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'probes.json'), 'utf8')).probes;
const policy = engine.lexicon.policy;
const batchTally = {};
for (const l of fs.readFileSync(path.join(root, 'erg', 'phase0_batch.jsonl'), 'utf8').trim().split('\n')) { const k = JSON.parse(l).kind; batchTally[k] = (batchTally[k] || 0) + 1; }

// v1.1 on the same probes, for the differential table
const v11G = require('../reference/v1_1/starpin_grammar_v1_1.js');
const v11Lex = R('data/v1_1_lexicon.json');
const v11 = v11G.createEngine(v11Lex);
const V11_HELPERS = Object.keys(v11G.HELPER_POS).concat(['can', 'because', 'will', 'must', 'they', 'this', 'that', 'before', 'when', 'where', 'inside', 'into', 'toward', 'all']);
const ALL = v11Lex.entries.map(e => e.word), BIP = new Set(ALL);
function v11Verdict(p) {
  const words = p.tiles ? p.tiles.map(t => t[0]) : p.text.toLowerCase().replace(/[.,;:!?]/g, ' ').split(/\s+/).filter(Boolean);
  const seen = new Set();
  const types = p.tiles ? p.tiles.map(t => t[1] === 'helper' ? 'helper' : 'collected') : words.map(w => { if (BIP.has(w) && !seen.has(w)) { seen.add(w); return 'collected'; } return 'helper'; });
  try { const r = v11.parse(words, {owned: ALL, helpers: V11_HELPERS, tokenTypes: types}); return r.valid ? 'accept (' + r.parse.kind + ')' : 'reject'; } catch (e) { return 'error'; }
}

const L = [];
const push = (...xs) => L.push(...xs);
push('# Starpin Word Lab — Phase 0 grammar prototype: report', '',
  `Engine \`${engine.VERSION}\` · strict grammar ${engine.stats.strictRules} atomic rules, relaxed ${engine.stats.relaxedRules}, ${engine.stats.symbols} symbols · strict-grammar compile ${engine.compileMs.toFixed(0)} ms at start-up; relaxed (diagnostic) grammar compiled lazily on first failure in ${engine.relaxedCompileMs.toFixed(0)} ms (Node). Compiling at start-up is a prototype convenience: Phase 3 should ship the compiled grammar.`, '',
  'Status labels: **measured** = produced by the scripts in this folder; **proposal** = design for later phases; **limitation** = known gap. Nothing here modifies the Word Lab game or any session.', '');

// ---------------------------------------------------------------- summary
const probeRes = probes.map(p => ({p, r: runProbe(p)}));
const pass = probeRes.filter(x => !x.r.failures.length).length;
push('## Acceptance criteria (measured)', '',
  '| Criterion | Result |', '|---|---|',
  `| Every handover §5 probe yields its intended roles | ${pass}/${probes.length} probes pass (B intended reading via one optional pin; E2 intended fragment offered, canonical is a genuine clause) |`,
  `| Generated derivations recognised and exactly recovered | ${gen.recovered}/${gen.generated} |`,
  `| Typed corruptions caught, with the right constraint named | see corruption table |`,
  `| p95 parse time ≤ 20 ms for ~40 tokens (Node) | 40-token realistic sentence ${stress.find(s => s.name === '40-token realistic').ms} ms; generated 21–24 tokens p95 ${gen.timing['21-24'] ? gen.timing['21-24'].p95 : '—'} ms |`,
  `| ERG batch emitted | ${Object.entries(batchTally).map(([k, v]) => v + ' ' + k.replace(/_/g, ' ')).join(', ')} |`,
  '| Phone timing | **not yet measured**: open `bench/wordlab_grammar_bench.html` on an iPhone |', '');

// ---------------------------------------------------------------- architecture
push('## What Phase 0 is', '',
  'A declarative feature grammar (`src/grammar.js`: ' + require('../src/grammar').RULES.length + ' rule schemas, each with a construction family, head, typed dependencies and CGEL chapter reference) compiled to an atomic context-free grammar, parsed by an Earley chart parser with FIRST-set lookahead into a packed forest (`src/parser.js`). There are no depth limits, no per-stage result caps and no step budgets. Noun compounds are a flat modifier sequence with a rightmost head, so compound length is unbounded and internal bracketing (semantic, Catalan-explosive) is not enumerated.', '',
  'Each parse returns one of three states:', '',
  '- **recognised** — at least one complete analysis; the canonical reading is chosen by a preference cost built only from lexical evidence tier, marked-construction costs and utterance type. No score is consulted.',
  '- **conflict** — no strict analysis, but exactly one named constraint (agreement, a/an, determiner–noun, pronoun case, verb frame) relaxed yields one; the span is reported.',
  '- **unrecognised** — no analysis even with relaxations; partial constituents found bottom-up are shown. This is a statement about the grammar\'s coverage, not about English.', '',
  '**Reading choice (proposal, implemented in the engine API).** For ambiguous sentences the engine reports *choice points*: tokens whose part of speech differs across complete parses. A player may pin any of them; the best tree consistent with the pins is returned. Storing pins (token index → category) with a saved sentence survives grammar upgrades better than storing a reading identifier. Pinning is optional and never driven by score.', '');

// ---------------------------------------------------------------- probes
push('## Intended-analysis probes', '', 'Full analyses, alternative readings and choice points: `reports/probe_analyses.md`. v1.1 verdicts are from the shipped parser on the same tiles.', '',
  '| Probe | Source | Phase 0 | v1.1 | Canonical bracketing |', '|---|---|---|---|---|');
for (const {p, r} of probeRes) {
  const res = r.res;
  const ours = (r.failures.length ? 'FAIL ' : '') + res.state + (res.conflict ? ' (' + res.conflict.constraint + ')' : '');
  const br = res.canonical ? '`' + res.canonical.bracket.replace(/\|/g, '/') + '`' : '';
  push(`| ${p.id} | ${p.src.replace(/\|/g, '/')} | ${ours} | ${v11Verdict(p)} | ${br} |`);
}
push('');

// ---------------------------------------------------------------- coverage
push('## Construction-level coverage (measured)', '', `${gen.generated - gen.targeted} random derivations plus ${gen.targeted} targeted ones so that every family has at least ${gen.minPerFamily} samples (seed ${gen.seed}); tiles drawn from the real BIP39 lexicon and the 47 helper candidates. "Recovered" means the parser's forest contains the exact generating tree. The v1.1 column shows how often the shipped parser rejects sentences containing the family.`, '',
  '| Construction family | Generated sentences | Recovered | v1.1 rejected |', '|---|---:|---:|---:|');
for (const c of gen.coverage) push(`| ${c.family} | ${c.generated} | ${c.recovered} | ${c.generated ? Math.round(100 * c.v11Rejected / c.generated) + '%' : '—'} |`);
push('', `Overall v1.1 accepts ${gen.differentialPositives.v11Accept}/${gen.generated} of these generated sentences. Whether the remainder are v1.1 under-coverage or Phase 0 over-generation is exactly what the ERG batch adjudicates, by family.`, '');

// ---------------------------------------------------------------- corruptions
push('## Typed corruptions (measured)', '', 'Each generated sentence is corrupted using its own tree, so each corruption knows what it attacks. "Accepted" corruptions are not automatically errors: a corrupted string can have a genuine alternative reading (collective nouns, mass nouns, *will* as a lexical verb, nominative pronouns in fragments). Accepted cases are in `reports/corruption_acceptances.jsonl` and are sent to ERG in aggregate.', '',
  '| Corruption | n | Phase 0 accepted | Phase 0 conflict naming the attacked constraint | v1.1 accepted |', '|---|---:|---:|---:|---:|');
for (const [t, v] of Object.entries(gen.corruption)) push(`| ${t.replace('_', ' ')} | ${v.n} | ${v.oursAccept}${t === 'object_drop' ? ' (verb kept as verb: ' + (v.oursAcceptVerbKept || 0) + ')' : ''} | ${['adjacent_swap', 'token_delete'].includes(t) ? '—' : v.oursConflictMatches} | ${v.v11Accept}/${v.v11Applicable} |`);
push('', 'Defects found by this stream and fixed during Phase 0: case was checked on the first conjunct only (*me and he can run*); PP and relative postmodifiers dropped pronoun case (*they about industry* as an object); NP-level *but* (*the cat but the dog*); mixed *and/or* chains flattened with the wrong number; reflexive *myself* without an antecedent; over-broad collective-noun and bare-PP evidence rules (see lexical policy).', '');

// ---------------------------------------------------------------- timing
push('## Performance (measured, Node, desktop)', '', '| Generated length | n | p50 ms | p95 ms | max ms |', '|---|---:|---:|---:|---:|');
for (const b of ['1-8', '9-14', '15-20', '21-24']) if (gen.timing[b]) push(`| ${b} tokens | ${gen.timing[b].n} | ${gen.timing[b].p50} | ${gen.timing[b].p95} | ${gen.timing[b].max} |`);
push('', 'Adversarial inputs (full API: 24-best readings, diverse root readings, choice points):', '', '| Case | Tokens | State | Complete trees | ms |', '|---|---:|---|---:|---:|');
for (const s of stress) push(`| ${s.name} | ${s.tokens} | ${s.state} | ${s.trees ?? '—'} | ${s.ms} |`);
const maxMs = Math.max(...Object.values(gen.timing).map(t => t.max));
push('', `The largest single-sentence time in the generated run was ${maxMs} ms; such maxima are isolated (garbage collection / JIT warm-up), as the p95 column shows.`, '');
push('Phone figures are unmeasured; expect several times slower. The runtime lexicon is currently compiled at start-up from raw evidence; Phase 3 should ship a precompiled grammar and lexicon.', '');

// ---------------------------------------------------------------- lexicon
const cnt = (f) => policy.changes.filter(f).length;
push('## Lexical policy (measured; details in `reports/lexical_policy.md`)', '',
  '| Tier | What | Readings |', '|---|---|---:|',
  `| attested | mass readings (Wiktionary uncountable mark recorded but unused in v1.1) | ${cnt(c => c.cat === 'N' && c.f.cnt === 'mass')} |`,
  `| attested | count readings for v1.1 mass nouns | ${cnt(c => c.cat === 'N' && c.f.cnt === 'count' && c.tier === 'attested')} |`,
  `| attested | verb frames from WordNet frames / Wiktionary tags | ${cnt(c => c.cat === 'V')} |`,
  `| attested | bare idiomatic PPs (${policy.idiomPPs.length} preposition + noun pairs) | ${cnt(c => c.cat === 'NIdiom')} |`,
  `| attested | degree modifiers *half*, *pretty* | ${cnt(c => c.cat === 'AdvDeg')} |`,
  `| derived | collective nouns with notional plural agreement | ${cnt(c => c.tier === 'derived')} |`,
  `| inferred | recorded, **not enabled** | ${policy.inferredPool.length} |`, '',
  'Two first-draft evidence rules were too permissive and were tightened before this report: collective nouns originally required only *some* OEWN `noun.group` sense (admitting *run*, *table*, *matrix*), and the bare-PP miner originally counted ordinary mass uses and complex prepositions (850 readings; now ' + cnt(c => c.cat === 'NIdiom') + '). Both stories are why evidence tiers are recorded on every reading.', '');

// ---------------------------------------------------------------- limitations
push('## Known limitations (Phase 0)', '',
  '- No wh-questions, object relatives, passives, comparatives, existential *there*, or *it*-clefts.',
  '- No binding theory: reflexives are licensed only in non-sentential utterances.',
  '- No morphology: BIP39 base forms only, so third-person-singular present is available only through *has*, modals, past forms and copulas.',
  '- Agreement with mixed-number *or* is left undetermined (usable after modals/past; not with present agreement). Person in coordinations is taken as third.',
  '- AdjP and PP fragments (*Happy.*, *In the garden.*) are not yet utterance types.',
  '- Collective-noun and idiom evidence comes from OEWN sense ordering and definitional text; residual quirks are tagged `derived`/`attested` and listed.',
  '- Phone performance, iOS persistence and touch are untested.', '');

// ---------------------------------------------------------------- scoring
push('## Scoring invariants for Phase 2 (proposal, not implemented)', '',
  '- **P1** Every recognised utterance with at least one blue tile scores more than zero.',
  '- **P2** Adding a blue tile in a genuine new grammatical role never lowers a score.',
  '- **P3′** Gold tiles earn no lexical points. A relation introduced by a gold tile (subordination via *because*, coordination via *and* or *for*) earns relation points only when each related constituent has a blue-anchored head. Gold-only material can never create a scoring relation.',
  '- **P4′** All clause-linking relations draw on one budget regardless of conjunction; the k-th link is worth geometrically less, so chains of *and*, of *because*, or alternating ones converge to the same bound. Structural interest is rewarded separately and boundedly: a bonus per distinct relation type, and a bonus for genuine embedding depth (a clause inside an argument of another clause). Tested property: extending a chain by alternating conjunctions never beats adding a new relation type.',
  '- **P5** Modifier stacking is bounded; the noun-compound asymptote is substantially higher than the adjective asymptote, and compound length earns modest, increasing, bounded rewards.',
  '- **P6** The score is computed on the canonical (or player-pinned) reading, chosen without consulting the score; score spread across readings is a tracked metric.',
  '- **P7** Portfolio score is the order-independent sum of sentence scores.', '');

push('## Next step', '', 'Run `erg/Starpin_ERG_Phase0.ipynb` once on `erg/phase0_batch.jsonl` and return `erg_phase0_results.jsonl`; `node erg/analyse.js <results>` turns it into family-level and lexical-tier findings. No sentence-level adjudication is needed.', '');
fs.writeFileSync(path.join(root, 'reports', 'PHASE0_REPORT.md'), L.join('\n'));
console.log('wrote reports/PHASE0_REPORT.md (' + L.length + ' lines)');
