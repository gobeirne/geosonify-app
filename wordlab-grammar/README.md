# Starpin Word Lab — Phase 0 grammar prototype

A standalone Node prototype of a replacement grammar engine for Word Lab. It does **not** modify the Word Lab game, its HTML, or any saved session. Node ≥ 18, no dependencies.

Start with `reports/PHASE0_REPORT.md` (results), then `reports/probe_analyses.md` (actual analyses) and `reports/lexical_policy.md` (every lexical change and its evidence).

## What it does

- **Declarative grammar** (`src/grammar.js`). 75 rule schemas, each with feature constraints, a construction family, head and typed dependencies, a display label and a small preference cost. Constraint checks are *named* (`agreement`, `article`, `det_noun`, `case`, `verb_frame`), so they can be relaxed for diagnosis.
- **Compiler and parser** (`src/parser.js`). Features range over finite domains, so the grammar compiles to an atomic CFG. An Earley parser with FIRST-set lookahead builds a packed forest. There are no depth limits, result caps or step budgets. Noun compounds are a flat modifier sequence with a rightmost head, so length is unbounded and internal bracketing is not enumerated.
- **Engine** (`src/engine.js`). `parse(tiles)` returns one of three states:
  - `recognised`: readings, a canonical reading, a tree count and choice points;
  - `conflict`: exactly one named constraint fails, with its span;
  - `unrecognised`: no analysis even with relaxations; partial constituents are shown.

  The canonical reading uses a preference cost (evidence tier, marked constructions, utterance type) and never a score. `opts.pins = {tokenIndex: 'V'}` constrains readings, so a player can say which reading they mean.
- **Lexicon compiler** (`src/lexicon.js`). Builds readings from the v1.1 BIP39 lexicon and Open English WordNet 2025 evidence. Every reading has an evidence tier:
  - **curated**: enabled in v1.1;
  - **attested**: a source states it directly;
  - **derived**: all premises attested, plus a cited grammatical rule;
  - **inferred**: heuristic; recorded but never enabled by default.

  Gold tiles get closed-class roles only, with two explicit exceptions: *has* as a lexical verb, and *for* as both preposition and coordinator. Only the 47 helper candidates can be gold.

```js
const {load} = require('./src/load');
const engine = load();
engine.parse('The cat can can run.');                       // string: BIP39 words blue, others gold
engine.parse([{word: 'kick', source: 'collected'}, {word: 'the', source: 'helper'},
              {word: 'angry', source: 'collected'}, {word: 'can', source: 'helper'}]);
engine.parse(text, {pins: {20: 'V'}});                       // choose a reading
```

## Running

| Command | What it does |
|---|---|
| `npm test` | CI gates: probes, exact recovery of generated trees, corruption gates, diagnostic attribution, timing |
| `npm run probes` | intended-analysis probes → `reports/probe_analyses.md` |
| `npm run generated` | 1,500 generated derivations, typed corruptions, v1.1 differential, timing → `reports/` |
| `npm run stress` | adversarial timing → `reports/stress_timing.json` |
| `npm run lexicon-report` | `reports/lexical_policy.md` |
| `npm run erg:prepare` | `erg/phase0_batch.jsonl` for the ERG notebook |
| `npm run erg:analyse -- results.jsonl` | aggregates ERG output → `reports/erg_phase0_analysis.md` |
| `npm run bench` | rebuilds `bench/wordlab_grammar_bench.html` |
| `npm run report` | regenerates everything and `reports/PHASE0_REPORT.md` |

## ERG cross-check (one Colab run)

1. Open `erg/Starpin_ERG_Phase0.ipynb` in Colab.
2. Set `ERG_DAT_URL` to the ERG 2025 grammar image used on 19 October, or upload the `.dat` file when asked.
3. Upload `erg/phase0_batch.jsonl` when asked, then Runtime → Run all.
4. Return the downloaded `erg_phase0_results.jsonl`.

The notebook records whether each ERG reading is a *clean witness*: every word has its own lexical entry (or a genuine multiword entry), with no merged spans and no generic/unknown entries. The analysis is by construction family, corruption type and lexical evidence tier; no sentence needs individual judgement. The notebook has not been run by its author, because the ACE/ERG host is not reachable from the build environment.

## Phone benchmark

`bench/wordlab_grammar_bench.html` is a single offline file, with no network requests. iOS Quick Look does not run JavaScript, so open it in Safari from a web address, for example by committing it to a GitHub Pages branch. Tap *Run benchmark*, then copy the results back.

## Layout

```
src/        engine, grammar, parser, lexicon compiler, loader
data/       v1_1_lexicon.json (extracted from the v1.1 game), oewn_evidence.json (extracted from OEWN 2025)
tests/      probes.json, run_probes.js, generate.js, run_generated.js, stress.js, run_all.js
erg/        prepare.js, Starpin_ERG_Phase0.ipynb, analyse.js, phase0_batch.jsonl
tools/      extract_oewn.py, extract_v11.js, report_lexicon.js, build_report.js, build_bench.js
reference/  v1_1/ — v1.1 parser and scorer extracted verbatim, for differential tests only
bench/      wordlab_grammar_bench.html
reports/    generated results (regenerate with npm run report)
```

## Rebuilding the evidence files

- `python3 tools/extract_oewn.py english-wordnet-2025.xml.gz data/v1_1_lexicon.json data/oewn_evidence.json` uses the release from github.com/globalwordnet/english-wordnet. The SHA-256 is recorded in the output.
- `node tools/extract_v11.js Starpin_Word_Lab_v1_1_Starpin.html` re-extracts `reference/v1_1/`.

## Data and licences (review before any public release)

- **Open English WordNet 2025:** CC BY 4.0, which requires attribution. Lexicographer files, sense order, hypernyms, multiword and closed-form lemmas, and definition/example text counts are used.
- **Simple English Wiktionary** (via Kaikki, inside the v1.1 lexicon's evidence fields): Wiktionary content is CC BY-SA 4.0 and GFDL. Whether derived count/mass flags carry share-alike obligations needs checking before redistribution.
- **WordNet verb-frame IDs and VerbNet matches:** inherited from the v1.1 lexicon evidence. VerbNet's licence should be confirmed.
- **The v1.1 lexicon itself:** the handover already flags that its redistribution terms need review.
