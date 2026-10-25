# Starpin Word Lab — grammar, scoring and game (Phases 0–3)

A replacement grammar engine and scorer for Word Lab, and the v2.0 game built from them. It does **not** modify the Word Lab game, its HTML, or any saved session. Node ≥ 18, no dependencies.

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

## The game (Phase 3)

`dist/Starpin_Word_Lab_v2_0.html` is the playable single-file game. Rebuild it from the v1.1 file, which is left unchanged:

```
node tools/build_game.js path/to/Starpin_Word_Lab_v1_1_Starpin.html   # -> dist/Starpin_Word_Lab_v2_0.html
python3 tests/browser_game_test.py /tmp/legacy_session.json           # end-to-end check (Playwright + Chromium)
```

What happens on first load:
- The v1.1 browser snapshot (`starpin-word-lab-v1.1-local-snapshot`) is migrated on the device, and is never modified.
- Progress is saved under `starpin-word-lab-v2-local-snapshot`.
- Exported v1.1 and v2 session files both import.

The interface adapter is `src/game_adapter.js`. Each build patch must match the v1.1 source exactly once, so a changed v1.1 file stops the build rather than producing a broken game.

## Challenges

Challenge files live in `challenges/*.json` and are built into the game. To set new ones from a fresh Starpin export:

```
node tools/reconstruct_finds.js starpin-records-YYYY-MM-DD.json path/to/starpin/sources finds.json
```

This gives the dated BIP39 words of every find under find-words-v1 (`GeosonifyStarpin.findWords`, the same rule the Starpin app shows when you tap a starpin or cornerstone). Then set the hands, stretch targets and bot pars for the windows defined in a challenge file:

```
node tools/build_challenges.js finds.json challenges/retrospective_2026-08_to_10.json [challenge-id ...]
```

A hand is every word first found inside the window. The bot par is a floor from a greedy portfolio search (bot-par-v2, recorded in the file as `botParMethod`; about 15 s per challenge); passing ids recomputes only those. In the game, a challenge's hand is used as given.

## Scoring (Phase 2)

`src/score.js` (v0.4) scores one reading (canonical or player-pinned) from the tiles' provenance:
- blue tiles earn role points; adjective stacks taper, noun compounds never do; a saturating size multiplier rewards long sentences;
- each *kind* of construction in a sentence earns points, repeats earn 0.4× the previous, so varied sentences beat repetitive chains;
- construction points scale with the sentence's substance (full from 8 blue tiles);
- conflicts and unrecognised sentences score 0 and are marked pending.

```js
const {scoreResult} = require('./src/score');
const r = engine.parse(tiles);           // or engine.parse(tiles, {pins})
scoreResult(r);                          // {score, status, breakdown: {tiles, links, sizeMultiplier, ...}}
```

`tests/run_scoring.js` tests invariants P1–P6 on real parses, runs a join-versus-split test and compares farming strategies per blue tile. It also runs an adversarial portfolio search on `tests/inventory_v1_1_embedded.json`, the 167-word inventory embedded in v1.1 and not the live browser session.

## Running

| Command | What it does |
|---|---|
| `npm test` | CI gates: probes, exact recovery of generated trees, corruption gates, diagnostic attribution, timing, scoring invariants |
| `npm run probes` | intended-analysis probes → `reports/probe_analyses.md` |
| `npm run generated` | 1,500 generated derivations, typed corruptions, v1.1 differential, timing → `reports/` |
| `npm run stress` | adversarial timing → `reports/stress_timing.json` |
| `npm run scoring` | scoring invariants, strategy table, inventory optimiser → `reports/scoring_report.json` |
| `npm run lexicon-report` | `reports/lexical_policy.md` |
| `npm run erg:prepare` | `erg/phase1_batch.jsonl` for the ERG notebook (refuses to overwrite a batch that has results) |
| `node erg/analyse.js <results> <batch> <tag>` | aggregates ERG output → `reports/<tag>_analysis.md` |
| `node erg/ablate.js <tag> <tiles>` | measures each evidence source and restriction against ERG |
| `node erg/rescore.js <tag> <tiles>` | current engine vs stored ERG results |
| `npm run bench` | rebuilds `bench/wordlab_grammar_bench.html` |
| `npm run report` | regenerates everything and `reports/PHASE0_REPORT.md` |

## ERG cross-check

**First run (2026-10-19).**
- Batch: `erg/phase0_batch.jsonl`.
- Results: `erg/erg_phase0_results.jsonl`, kept in the repo.
- Tiles for re-running the current engine on that batch: `erg/phase0_batch_tiles.jsonl`.

Reproduce the analysis with:

```
node erg/analyse.js erg/erg_phase0_results.jsonl erg/phase0_batch.jsonl erg_phase0
node erg/ablate.js  erg_phase0 erg/phase0_batch_tiles.jsonl   # evidence sources and restrictions vs ERG
node erg/rescore.js erg_phase0 erg/phase0_batch_tiles.jsonl   # current engine vs the stored ERG results
```

A sentence counts as ERG-witnessed only if ERG's top-ranked derivation is all of the following:
- a full clause, VP ellipsis with an overt subject, or an NP fragment;
- free of robust/generic lexical entries;
- giving every word its own terminal.

A bare ERG parse is not enough. ERG also returns subjectless finite-VP fragments, capitalised words read as proper names, and other robustness analyses.

**Second run (held out, 2026-10-19).** Results are stored compressed as `erg/erg_phase0b_results.jsonl.gz` (the raw file is 66 MB); `analyse.js` reads `.gz` directly:

```
node erg/analyse.js erg/erg_phase0b_results.jsonl.gz erg/phase0b_batch.jsonl erg_phase0b
node erg/ablate.js  erg_phase0b erg/phase0b_batch.jsonl
```

**Running it again.**
1. In `erg/Starpin_ERG_Phase0.ipynb`, set `ERG_DAT_URL`, or upload the `.dat` when asked.
2. Upload `erg/phase0b_batch.jsonl`, built from the current engine, which carries its own tiles.
3. Run all, and return `erg_phase0b_results.jsonl`.
4. Run `node erg/analyse.js <results> erg/phase0b_batch.jsonl erg_phase0b`.

The notebook now stores the derivation of every inspected reading, not just the first.

## Phone benchmark

`bench/wordlab_grammar_bench.html` is a single offline file, with no network requests. iOS Quick Look does not run JavaScript, so open it in Safari from a web address, for example by committing it to a GitHub Pages branch. Tap *Run benchmark*, then copy the results back.

## Layout

```
src/        engine, grammar, parser, lexicon compiler, scorer, loader
data/       v1_1_lexicon.json (from the v1.1 game), oewn_evidence.json (OEWN 2025), erg_verb_evidence.json + ERG_LICENSE.txt (ERG)
tests/      probes.json, run_probes.js, generate.js, run_generated.js, stress.js, run_all.js
erg/        prepare.js, analyse.js, ablate.js, rescore.js, Starpin_ERG_Phase0.ipynb,
            phase0_batch.jsonl + phase0_batch_tiles.jsonl (+ your erg_phase0_results.jsonl), phase0b_batch.jsonl
tools/      extract_oewn.py, extract_v11.js, report_lexicon.js, build_report.js, build_bench.js
reference/  v1_1/ — v1.1 parser and scorer extracted verbatim, for differential tests only
bench/      wordlab_grammar_bench.html
reports/    generated results (regenerate with npm run report)
```

## Rebuilding the evidence files

- `python3 tools/extract_erg_lexicon.py lexicon.tdl data/v1_1_lexicon.json data/erg_verb_evidence.json` uses `lexicon.tdl` from github.com/delph-in/erg (MIT licence; `data/ERG_LICENSE.txt`) and gives verb frames, including optional objects (`v_np*_le`).

- `python3 tools/extract_oewn.py english-wordnet-2025.xml.gz data/v1_1_lexicon.json data/oewn_evidence.json` uses the release from github.com/globalwordnet/english-wordnet. The SHA-256 is recorded in the output.
- `node tools/extract_v11.js Starpin_Word_Lab_v1_1_Starpin.html` re-extracts `reference/v1_1/`.

## Policy switches (measurement only)

`WL_OFF=COLL,MASS,IDIOM,VF_intr,...` turns individual restrictions or evidence sources off. `WL_ALL_FRAMES=1` re-enables the verb-frame types demoted after ERG validation. `erg/ablate.js` uses both; normal runs use neither.

## Data and licences (review before any public release)

- **Open English WordNet 2025:** CC BY 4.0, which requires attribution. Lexicographer files, sense order, hypernyms, multiword and closed-form lemmas, and definition/example text counts are used.
- **Simple English Wiktionary** (via Kaikki, inside the v1.1 lexicon's evidence fields): Wiktionary content is CC BY-SA 4.0 and GFDL. Whether derived count/mass flags carry share-alike obligations needs checking before redistribution.
- **WordNet verb-frame IDs and VerbNet matches:** inherited from the v1.1 lexicon evidence. VerbNet's licence should be confirmed.
- **English Resource Grammar lexicon:** MIT licence (`data/ERG_LICENSE.txt`), which requires the copyright notice to be kept with copies.
- **The v1.1 lexicon itself:** the handover already flags that its redistribution terms need review.
