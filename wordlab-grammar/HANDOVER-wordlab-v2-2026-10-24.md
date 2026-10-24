# Starpin Word Lab v2 — handover (2026-10-24)

For a new Claude chat continuing Word Lab work. Read this first, then `wordlab-grammar/reports/PHASE0_REPORT.md` (generated, authoritative numbers) and `wordlab-grammar/README.md`.

## 1. What Word Lab is

A word game attached to Starpin, in the `gobeirne/geosonify-app` repo. Each Starpin find (star pin or cornerstone) yields the 4-word BIP39 HEALPix address of the place (`healpix-bip39-v1`, `HealpixWords.encodeIndices(lat, lon, 4)`). Each collected word is a **blue tile** usable in one committed sentence. **Gold helpers** (47 function-word candidates) are unlimited and earn no word points. **Purple tiles** are previews (uncollected, or owned but used elsewhere) and cannot be committed. Players build grammatical English sentences, however semantically surreal, and score points.

## 2. Status

| Phase | State |
|---|---|
| 0 Grammar engine | Done; validated by three ERG runs |
| 1 Grammar additions (ellipsis, ERG verb frames, two-conflict diagnosis) | Done |
| 2 Scoring | v0.4 (`phase2-0.4.0`), done |
| 3 Game integration (`dist/Starpin_Word_Lab_v2_0.html`) | Done; current build stamp `1021·7e48ba` |
| Challenge mode + helper simulation | Done |

Last delivery: `wordlab-grammar-scoring-v0_4.zip` (changed files only). All 9 gates pass (`npm test`); the browser test has 47 checks, all passing; 63 probes pass.

## 3. Repository layout (`wordlab-grammar/`)

```
src/        grammar.js (82 rule schemas), parser.js (feature-CFG compiler + Earley + packed forest),
            lexicon.js (evidence tiers), engine.js (API), score.js (v0.4), game_adapter.js (browser bridge), load.js
data/       v1_1_lexicon.json, oewn_evidence.json (OEWN 2025), erg_verb_evidence.json + ERG_LICENSE.txt
tests/      probes.json (63 intended analyses), run_probes.js, generate.js, run_generated.js, stress.js,
            run_scoring.js, run_all.js (gates), browser_game_test.py (Playwright), inventory_v1_1_embedded.json
erg/        Starpin_ERG_Phase0.ipynb, prepare.js, analyse.js, ablate.js, rescore.js, batches + results (.gz)
tools/      build_game.js (builds v2.0 from the v1.1 HTML), build_report.js, build_bench.js, extract_oewn.py,
            extract_erg_lexicon.py, extract_v11.js, report_lexicon.js, reconstruct_finds.js, search_hand.js
challenges/ retrospective_2026-08_to_10.json
reference/  v1_1/ (old parser and scorer, verbatim; used for differential tests and v1.1 score history)
dist/       Starpin_Word_Lab_v2_0.html
reports/    PHASE0_REPORT.md and generated results (large .jsonl files are git-ignored)
```

**Build the game:** `node tools/build_game.js path/to/Starpin_Word_Lab_v1_1_Starpin.html`. The v1.1 file is never modified. Every patch must match the v1.1 source exactly once, otherwise the build fails loudly. The v1.1 file uses CRLF line endings, which the build normalises. The build stamp (`MMDD·hash`) appears in the header.

## 4. Grammar engine (established)

- **Declarative feature grammar.** Features: number (including `mix` for mixed-number *or*), person, case (including `refl`), countability (`count`/`mass`/`coll`), onset (for *a/an*), verb form, verb frame, coordination type. Compiled to an atomic CFG (about 7,900 rules; the relaxed grammar compiles lazily).
- **Parser.** Earley with FIRST-set lookahead and a packed forest, with no depth limits or result caps. Noun compounds are a flat chain, so their bracketing isn't enumerated.
- **Three result states:**
  - recognised;
  - **conflict**, with one or two named violations (`agreement`, `article`, `det_noun`, `case`, `verb_frame`) and their spans;
  - unrecognised, with partial constituents.
- **Readings.** The canonical reading is chosen by a preference cost (evidence tier, marked constructions, utterance type). **It never uses score.**
- **Choice points and pins.** The engine lists the tokens whose part of speech differs across readings; the player pins one (`opts.pins`). Pins are keyed to the exact word sequence, so editing a sentence drops them.
- **Key constructions:**
  - flat n-ary coordination, with homogeneous chains; mixing *and*/*or* nests;
  - subordinate clauses, final or fronted;
  - causal *for*;
  - subject relative clauses;
  - complement clauses, with or without *that*;
  - infinitives;
  - modals, copulas, *do*-support, perfect *has*;
  - post-auxiliary ellipsis after modals, *has/have*, *do/does/did*, *is/are/was/were*;
  - focus modifiers;
  - idiomatic bare PPs (*on stage*);
  - proper names: April, December, February, Latin, March, October, Satoshi.
- **Gold-tile roles.** Gold tiles get closed-class roles only, except lexical *has* and *for* (preposition and coordinator), by explicit decision. Only the 47 helper candidates can be gold.
- **Known gaps:**
  - no wh-questions, object relatives, passives, comparatives, existential *there*, or AdjP/PP fragments;
  - no binding theory, so reflexives work only in fragments;
  - no morphology (*-s*, *-ed*, *-ing*);
  - person is not tracked through coordination.

## 5. Lexical policy (established)

Evidence tiers on every reading:
- **curated:** from v1.1;
- **attested:** a source states it directly;
- **derived:** all premises attested, plus a cited rule;
- **inferred:** recorded, but **never enabled by default**.

Currently enabled additions:

| Source | Readings |
|---|---:|
| Wiktionary mass readings | 260 |
| OEWN bare idiomatic PPs (189 preposition + noun pairs) | 189 |
| ERG lexicon verb frames, including optional objects (`v_np*_le`) | 388 |
| Collective nouns with plural agreement (OEWN first sense `noun.group` under social group, animal group, gathering or people) | 45 |
| *half*, *pretty* as degree words | 2 |

Collectives can't take plural determiners (*\*six army*) or appear bare. *staff* is curated as a zero-plural noun.

**Demoted to inferred after ERG validation:** all WordNet/Wiktionary verb frames.
- In run 1, transitive, ditransitive, copula, *to*-infinitive and clause frames scored 0.33–0.70.
- In the held-out run 3, intransitive frames scored 0.68.
- **Validation rule:** an attested source stays enabled if its sentences are ERG-witnessed at ≥ 0.8 of the length-matched curated rate, judged on held-out data. ERG-sourced frames can't be validated against ERG (that would be circular); they're checked by the corruption gates and probes instead.

## 6. ERG cross-checks (done)

Three Colab runs (ERG 2025, ACE 0.9.34): `phase0`, `phase0b` (held out) and `phase1` (held out). Results are stored compressed in `erg/`.

**Witness rule.** A sentence counts as ERG-witnessed only if a top-5 ERG reading is a full clause, VP ellipsis with a subject, or an NP fragment, with no robust or generic entries and one terminal per word. ERG's other fragment rules and capitalised-word-as-name readings don't count. Results:

- **Run 3:** ERG witnesses 83.8% of generated sentences.
- **Remaining disagreements are deliberate policy differences.** ERG grinds any count noun to mass, ignores *a/an*, doesn't check reflexive binding, allows mixed-number *or* agreement, accepts headline-style bare nouns, and reads *do*/*will* as main verbs.
- **Restrictions rejected on ERG evidence:** adjective-before-noun ordering, no postmodified pronouns, and no nominative fragments.

## 7. Scoring v0.4 (`src/score.js`, established 2026-10-21)

The player's explicit goal: reward varied, satisfying long sentences, not "X can V Y and X can V Y…" chains, and never penalise noun compounds.

- **Word points (blue tiles only):**
  - core role: 10;
  - blue tile in a closed-class role: 4;
  - adjective/adverb stack on one head: 10, 7, 4.9… (bound about 33);
  - **noun-compound modifiers: flat 10, no taper**;
  - bare one-word list items: taper from the third.
- **Size multiplier on word points:** 1 + 0.6·(1 − 0.85^(B−1)), where B is the number of blue tiles; it saturates at ×1.6.
- **Constructions.** Each *kind* earns its weight (relative or subordinate or complement clause and causal *for* 48; infinitive 42; instruction + statement 36; clause or predicate coordination and ditransitive 30; copula, PP, joined nouns or verbs, ellipsis 24; adverbs, degree and focus words, negation 18; question and proper noun 12–18; verb + object 9; adjective, compound, modal 6).
  - **Each repeat in a sentence earns 0.4× the previous instance.**
  - Constructions must be anchored by blue tiles; joined clauses need at least 2 blue tiles on each side.
- **Substance scaling.** Construction points × min(1, (B−1)/7), so they reach full value at 8 blue tiles. This prevents short, construction-dense sentences from winning.
- **Other rules:** a nominal fragment scores ×0.6; there is no per-sentence bonus; the portfolio score is a plain sum.
- **Invariants tested** (`tests/run_scoring.js`, all passing):
  - P1: recognised + a blue tile ⇒ score > 0;
  - P2: adding a blue modifier never lowers the score (with structure held fixed);
  - P3′: gold-only material earns nothing;
  - P4′: repeated constructions converge, and a new kind beats a repeat;
  - P5: adjective stacks are bounded, and compounds always beat adjective stacks;
  - P6: score spread across readings is tracked;
  - the join-versus-split test;
  - an adversarial portfolio search on the 167-word inventory.
- **Evidence.** On the August hand with starter helpers, the player's portfolio scores 923; the best chain portfolio found by `tools/search_hand.js` scores 909.
- **Known residual.** Splitting a very long homogeneous chain gains about 5%. That's the price of the plain-sum decision.

## 8. The game, v2.0 (`dist/Starpin_Word_Lab_v2_0.html`)

**Migration and history:**
- **Migration on device.** On first load, the v1.1 snapshot (`starpin-word-lab-v1.1-local-snapshot`) is imported and left untouched; v2 saves to `starpin-word-lab-v2-local-snapshot`. Exported v1/v2 session files both import.
- **Version history.** Each sentence records its score under every grammar/scorer version, including its v1.1 score, shown as "was … under …".

**Building sentences:**
- **Pending sentences.** Grammar-level failures can be saved and committed; they reserve their tiles, score 0, and are re-checked on every update. Tile problems still block saving.
- **Typed entry.** Nothing is accepted until Space, Enter or punctuation; **Space accepts the highlighted word**. Four letters identify any BIP39 word. A pasted sentence is processed whole and stops at an unusable word, keeping the rest in the field. Owned words already used elsewhere become purple previews. Helper-capable BIP39 words (*can*, *because*…) default to gold when that helper is unlocked.
- **Tiles.** Tiles show only the word; gold helpers have dashed borders. Controls appear only on the selected tile.
- **Moving and removing.** Long-press drag on touch (pointer events); drop onto the floating remove zone, which sits above the mobile dock, to delete. Keyboard arrows and Delete work. Every removal offers Undo.
- **Score panel.** Word chips and construction chips, with explanatory notes.

**Tray and coach:**
- The word tray shows every word, with a fade cue when more are below the fold. The search box and static suggestions were removed; the part-of-speech filter stays.
- The coach gives tips from the actual analysis. Its button reads "Next tip ›" while more tips remain, then "Close tip", and the coach closes when the sentence changes.

**Challenges and simulation:**
- **Challenge mode** (Play selector). Each challenge is a separate slot; its collection is the hand (only words actually found), **with out-of-hand words hidden**. Free play is saved and restored untouched. A status line shows words placed out of the hand, the stretch target (90%), score, bot par, and pending count.
- **Helper simulation** (Helpers selector): the helpers N completed cells would give under the proposed schedule; "Actual unlocks" restores the real set.

**Bugs fixed during testing:**
- the undo notice never hid (author CSS overrode `[hidden]`);
- the remove zone was in the page flow and under the dock;
- `cancelDraft` wasn't exposed on the page API, so test drafts accumulated tiles.

## 9. Challenges (data in `challenges/`)

Reconstructed from the Starpin record export of 2026-10-20 by `tools/reconstruct_finds.js` (needs the Starpin sources):
- **Exact match:** 74 effective records give 154 distinct words, all in the Word Lab inventory.
- **Non-find words:** the other 13 inventory words (*can*, *because*, *cat*…) were prototype additions, not finds.

| Challenge | Hand | Stretch | Bot par (v0.4) |
|---|---:|---:|---:|
| August 2026 | 41 | 37 | 815 |
| September 2026 | 44 | 40 | 942 |
| October 2026 (to 8 Oct) | 69 | 63 | 1086 |
| 6 October sprint | 44 | 40 | 779 |

The bot par is a floor from a weak automated search (idea 3 replaces it). The player completed August with the starter helpers: 41/41 words placed, 923 points under v0.4.

## 10. Decisions by Greg (binding)

- Grinding (count→mass coercion) stays out of the default grammar.
- Unrecognised sentences may be saved with reserved tiles, score 0, and are rescored on updates.
- Creative mode is rescored with version history; competitions freeze grammar and scorer versions (competitions aren't built yet).
- Gold tiles have function roles only, except lexical *has* and *for* (both roles).
- Challenges use a time window's finds; out-of-hand words are hidden ("you get what you get").
- **Helpers never expire.**
- Typing: Space accepts the suggestion; nothing auto-accepts at four letters.
- Scoring: reward variety; never penalise compounds (v0.4).

## 11. Proposals not yet ratified

- **Helper schedule.**
  - 0 cells: *the, a, an, and, is, can*.
  - Then +3 per cell, in this order: in/on/to · are/not/of · with/for/but · or/was/has · because/that/it · do/does/did · were/at/from · when/if/while · will/must/this · he/she/we · they/some/all · by/before/where · each/many/inside · into/toward.
  - Open question: should the starter set include a subordinator, so varied link kinds exist from the start?
- **Window-end behaviour** in live challenges (archive versus carry-over), and a completion bonus.
- **Competition mode:** frozen versions, and leaderboard verification against Starpin's collection log.

## 12. Saved-up ideas (Greg's queue, not yet scheduled)

1. A finder for nearby star pins or cornerstones whose 4-word address contains a needed word type (adjective, verb…). Addresses are deterministic, so this can be computed before visiting.
2. A tappable challenge status line showing the unplaced words as tiles ("N left" past halfway), because words below the tray fold were missed.
3. A par set as a fraction of the score ceiling (e.g. 85%) instead of the weak bot par.

Also not built: morphology helpers (*-s*, *-ed*, *-ing*).

## 13. Working conventions (from Greg's preferences)

- NZ English.
- Be technically rigorous, and label things as established, proposed or implemented.
- Critical review before building specs; hold ideas until he says go.
- Ask only one clear question when a decision is genuinely needed.
- **Code delivery:**
  - read the current file from the project or repo;
  - deliver complete files only, with no patches or diffs;
  - put multi-file changes in one zip with paths relative to the repo root (here, `wordlab-grammar/...`);
  - include only changed files;
  - never push or commit;
  - list the files and the remaining steps after each delivery.
- Public-facing text should read as a synthesis, not a diary.
- Greg uploads to GitHub himself, often via the web uploader (25 MB limit), so keep large data compressed. Desktop and iPhone caching is aggressive; the build stamp identifies the running copy.

## 14. Environment notes for the next Claude

- ACE/ERG binaries can't be reached from the sandbox; ERG runs go through Greg's Colab notebook. The ERG *lexicon* source is reachable via raw.githubusercontent.com.
- OEWN 2025 can be downloaded from its GitHub release.
- Playwright and Chromium are available; the browser test seeds storage explicitly, because `file://` pages are opaque origins in Chromium.
- Commands have a 300-second limit; long suites have fast modes (`run_scoring.js N fast`).
