# Starpin Word Lab — grammar, scoring and game (Phases 0–3): report

Engine `phase0-0.1.0` · strict grammar 7925 atomic rules, relaxed 19556, 597 symbols · strict-grammar compile 365 ms at start-up; relaxed (diagnostic) grammar compiled lazily on first failure in 506 ms (Node). Compiling at start-up is a prototype convenience: Phase 3 should ship the compiled grammar.

Status labels: **measured** = produced by the scripts in this folder; **proposal** = design for later phases; **limitation** = known gap. Nothing here modifies the Word Lab game or any session.

## Acceptance criteria (measured)

| Criterion | Result |
|---|---|
| Every handover §5 probe yields its intended roles | 63/63 probes pass (B intended reading via one optional pin; E2 intended fragment offered, canonical is a genuine clause) |
| Generated derivations recognised and exactly recovered | 1595/1595 |
| Typed corruptions caught, with the right constraint named | see corruption table |
| p95 parse time ≤ 20 ms for ~40 tokens (Node) | 40-token realistic sentence 16.1 ms; generated 21–24 tokens p95 12.4 ms |
| ERG batch emitted | 49 probe, 400 generated positive, 600 corruption accepted, 300 corruption rejected |
| Phone timing | **not yet measured**: open `bench/wordlab_grammar_bench.html` on an iPhone |

## What Phase 0 is

A declarative feature grammar (`src/grammar.js`: 82 rule schemas, each with a construction family, head, typed dependencies and CGEL chapter reference) compiled to an atomic context-free grammar, parsed by an Earley chart parser with FIRST-set lookahead into a packed forest (`src/parser.js`). There are no depth limits, no per-stage result caps and no step budgets. Noun compounds are a flat modifier sequence with a rightmost head, so compound length is unbounded and internal bracketing (semantic, Catalan-explosive) is not enumerated.

Each parse returns one of three states:

- **recognised** — at least one complete analysis; the canonical reading is chosen by a preference cost built only from lexical evidence tier, marked-construction costs and utterance type. No score is consulted.
- **conflict** — no strict analysis, but exactly one named constraint (agreement, a/an, determiner–noun, pronoun case, verb frame) relaxed yields one; the span is reported.
- **unrecognised** — no analysis even with relaxations; partial constituents found bottom-up are shown. This is a statement about the grammar's coverage, not about English.

**Reading choice (proposal, implemented in the engine API).** For ambiguous sentences the engine reports *choice points*: tokens whose part of speech differs across complete parses. A player may pin any of them; the best tree consistent with the pins is returned. Storing pins (token index → category) with a saved sentence survives grammar upgrades better than storing a reading identifier. Pinning is optional and never driven by score.

## Intended-analysis probes

Full analyses, alternative readings and choice points: `reports/probe_analyses.md`. v1.1 verdicts are from the shipped parser on the same tiles.

| Probe | Source | Phase 0 | v1.1 | Score | Canonical bracketing |
|---|---|---|---|---:|---|
| A1 | handover 5A | recognised | reject | 134 | `[Imp [VP [VP prevent [NP prison patient parrot ketchup]] [PP in [NP all bitter banana menu output]]]]` |
| A2 | handover 5A (patient as noun adjunct) | recognised | reject | 134 | `[Imp [VP [VP prevent [NP prison patient parrot ketchup]] [PP in [NP all bitter banana menu output]]]]` |
| B1 | handover 5B, intended reading via one pin | recognised | reject | 297 | `[Utt [Imp [VP [VP [VP [VP fix [NP the fossil figure]] [PP in [NP the favorite filter]]] and [VP forget [NP the grid gadget]]] [PP in [NP the garage]]]] for [S [NP [NP staff] [PP on stage]] [FP [VP sign [NP steel soldier script output]]]]]` |
| B2 | handover 5B (unpinned: causal 'for' must be offered) | recognised | reject | 294 | `[Utt [Imp [VP [VP [VP [VP fix [NP the fossil figure]] [PP in [NP the favorite filter]]] and [VP forget [NP the grid gadget]]] [PP in [NP the garage]]]] for [S [NP [NP staff] [PP on [NP stage sign steel soldier script]]] [FP [VP output]]]]` |
| B3 | handover 5B / ERG bake-off | recognised | reject | 57 | `[S [NP [NP staff] [PP on stage]] [FP can [VP sign [NP the script]]]]` |
| C1 | handover 5C | recognised | reject | 188 | `[S [S [NP the unknown civil void] [FP [VP has [NP just blame]]]] and [S [NP the bitter october symbol] [FP can [VP oppose [NP the joke journey]]]]]` |
| C2 | handover 5C (focus reading also offered) | recognised | reject | 188 | `[S [S [NP the unknown civil void] [FP [VP has [NP just blame]]]] and [S [NP the bitter october symbol] [FP can [VP oppose [NP the joke journey]]]]]` |
| D1 | handover 5D | recognised | accept (clause) | 35 | `[S [NP the cat can] [FP can [VP run]]]` |
| D2 | handover 5D | recognised | accept (question) | 35 | `[Q can [NP the cat can] [VP run]]` |
| D3 | handover 5D: grammatical, but 'may' is neither BIP39 nor a helper | invalid_tiles | reject | — |  |
| D4 | handover 5D | recognised | accept (clause) | 42 | `[S [NP the cat can] [FP must [VP run]]]` |
| D5 | gold-role policy: a gold 'can' is a modal only | unrecognised | accept (imperative) | — |  |
| D6 | gold-role policy: a blue 'can' keeps its noun reading | recognised | accept (imperative) | 35 | `[Imp [VP kick [NP the angry can]]]` |
| E1 | handover 5E | recognised | accept (ellipsis) | 28 | `[S [NP the garden fence] [FP can]]` |
| E2 | handover 5E (the fragment reading must be offered; canonical is a genuine clause: [blossom and cat] [bag], bag = intransitive verb, WordNet frame 1) | recognised | accept (fragment) | 57 | `[Frag [NP [NP the vivid autumn blossom] and [NP the famous canvas cat bag]]]` |
| E2b | handover 5E: canonical is the intended fragment (intransitive bag came only from a WordNet frame, demoted after ERG run 3) | recognised | accept (fragment) | 57 | `[Frag [NP [NP the vivid autumn blossom] and [NP the famous canvas cat bag]]]` |
| E3 | handover 5E | recognised | accept (clause) | 289 | `[S [NP [NP a cheap angry badge] and [NP a shallow silly chat]] [FP can [VP [VP [VP boil [NP [NP nice level stairs] and [NP the vocal timber table]]] [PP in [NP the million citizen parade]]] [PP in [NP the vivid autumn blossom]]]]]` |
| E4 | handover 5E (ERG: no reading) | recognised | accept (imperative) | 107 | `[Imp [VP [VP clump [NP the document]] and [VP forget [NP the half human hybrid fossil]]]]` |
| E5 | handover 5E | recognised | accept (imperative) | 239 | `[Imp [VP [VP [VP crumble [NP the favorite document]] [PP in [NP fun]]] and [VP ensure [S [NP the core dose] [FP can [VP [VP predict [NP midnight security]] and [VP taste [NP vivid unknown ketchup]]]]]]]]` |
| E6 | handover 5E | recognised | accept (imperative) | 172 | `[Imp [Imp [VP clean [NP the favorite festival]]] [SubCl because [S [NP angry jeans] [FP [VP just [VP know [NP robust inner salad]]]]]]]` |
| E7 | handover 5E | recognised | accept (imperative) | 123 | `[Imp [VP [VP just [VP joke]] and [VP blame [NP half human hybrid cat stairs]]]]` |
| E8 | handover 5E | recognised | accept (imperative) | 147 | `[Imp [VP [VP [VP taste [NP vocal stairs]] today] and [VP guess [NP famous angry autumn jeans]]]]` |
| U1 | v1.1 session sentence 1 | recognised | accept (imperative) | 259 | `[Imp [Imp [VP [VP abandon [NP [AdjP barely fun] festival salad]] and [VP shiver]]] [SubCl because [S [NP clean library jeans] [FP [VP [VP know [NP robust news]] [PP for [NP the runway security man]]]]]]]` |
| U2 | v1.1 session sentence 2 | recognised | accept (clause) | 240 | `[S [NP [NP a cheap angry badge] and [NP a shallow silly chat]] [FP can [VP [VP boil [NP [NP nice level stairs] and [NP the vocal timber table]]] [PP in [NP the million citizen parade]]]]]` |
| U3 | v1.1 session sentence 3 | recognised | accept (clause) | 239 | `[S [NP [NP the vivid autumn blossom] and [NP the famous canvas cat bag]] [FP [FP [VP crumble]] and [FP [VP [VP observe [NP the original midnight primary core]] [PP on [NP the inner coast]]]]]]` |
| F1 | handover 5F: chat count | recognised | accept (fragment) | 19 | `[Frag [NP a shallow silly chat]]` |
| F2 | handover 5F: chat mass | recognised | accept (fragment) | 19 | `[Frag [NP shallow silly chat]]` |
| F3 | handover 5F: 'symbol' is a noun adjunct, not an adjective | recognised | accept (clause) | 42 | `[S [NP the symbol cat] [FP can [VP run]]]` |
| F4 | handover 5F: 'symbol' is not a predicative adjective | conflict (det_noun) | reject | — |  |
| F5 | handover 5F: 'toward' is a preposition | recognised | accept (clause) | 49 | `[S [NP the cat] [FP can [VP [VP run] [PP toward [NP the garden]]]]]` |
| F6 | handover 5F: no free adverbial 'toward' | unrecognised | reject | — |  |
| P1 | v1.1 defect: invariant noun with 'is' | recognised | reject | 22 | `[S [NP the fish] [FP is sad]]` |
| P2 | v1.1 defect: three-way NP coordination | recognised | reject | 57 | `[S [NP [NP the cat] and [NP the dog] and [NP the fish]] [FP can [VP run]]]` |
| P3 | v1.1 defect: three-way VP coordination | recognised | reject | 31 | `[Imp [VP [VP run] and [VP jump] and [VP swim]]]` |
| P4 | v1.1 defect: three copular clauses | recognised | reject | 109 | `[S [S [NP the dog] [FP is happy]] and [S [NP the cat] [FP is sad]] and [S [NP the fish] [FP is calm]]]` |
| P5 | v1.1 defect: 'has' with a mass object | recognised | reject | 22 | `[S [NP the void] [FP [VP has [NP blame]]]]` |
| P6 | Buffalo-type reading accepted by v1.1: [cat dog fish] [bird] (to bird = birdwatch) | recognised | accept (clause) | 48 | `[S [NP cat dog fish] [FP [VP bird]]]` |
| N1 | agreement | conflict (agreement) | reject | — |  |
| N2 | article sound | conflict (article) | reject | — |  |
| N3 | article sound | conflict (article) | reject | — |  |
| N4 | bare singular count subject | conflict (det_noun) | reject | — |  |
| N5 | determiner number | conflict (det_noun) | reject | — |  |
| N6 | pronoun case (object-only reflexive as subject; me/them are not available tiles) | conflict (case) | accept (clause) | — |  |
| N7 | missing object of a transitive-only verb | conflict (verb_frame) | reject | — |  |
| N8 | doubled determiner (ERG merged spans) | unrecognised | reject | — |  |
| N9 | post-auxiliary ellipsis (Phase 1): "Who is happy? The cat is." — ERG analyses it the same way | recognised | reject | 10 | `[S [NP the cat] [FP is]]` |
| N10 | agreement inside a relative clause | conflict (agreement) | reject | — |  |
| N11 | agreement with 'has' | conflict (agreement) | reject | — |  |
| L1 | Phase 1: ellipsis after has | recognised | reject | 10 | `[S [NP the void] [FP has]]` |
| L2 | Phase 1: negated do-ellipsis | recognised | reject | 0 | `[S [NP she] [FP did not]]` |
| L3 | Phase 1: ellipsis inside a subordinate clause | recognised | reject | 71 | `[S [S [NP the cat] [FP can [VP run]]] [SubCl because [S [NP the dog] [FP did]]]]` |
| L4 | Phase 1: agreement still applies under ellipsis | conflict (agreement) | reject | — |  |
| L5 | Phase 1: ERG optional object (detect := v_np*_le) | recognised | reject | 10 | `[Imp [VP detect]]` |
| L6 | Phase 1: ERG object required (bless := v_np_le) | conflict (verb_frame) | reject | — |  |
| L7 | Phase 1: ERG optional object in coordination | recognised | reject | 35 | `[Imp [VP [VP bless [NP the cat]] or [VP decide]]]` |
| L8 | Phase 1: ERG to-infinitive frame (decide := v_vp_seq_le) | recognised | accept (clause) | 42 | `[S [NP the cat] [FP can [VP decide to [VP run]]]]` |
| PN1 | proper name (v1.1 proper_name_reading) | recognised | accept (clause) | 28 | `[S [NP satoshi] [FP can [VP run]]]` |
| PN2 | proper name in a PP | recognised | accept (clause) | 42 | `[S [NP the cat] [FP can [VP [VP run] [PP in [NP april]]]]]` |
| PN3 | common-noun reading kept (a satoshi = unit) | recognised | accept (clause) | 28 | `[S [NP a satoshi] [FP can [VP run]]]` |
| PN4 | no proper-name reading for ordinary nouns | conflict (det_noun) | reject | — |  |
| S1 | stress: 20-noun compound | recognised | reject | 190 | `[S [NP the prison patient parrot menu banana garden fence table stairs ketchup output script soldier steel salad canvas autumn october symbol journey] [FP is bitter]]` |
| S2 | stress: 12 coordinated clauses | recognised | accept (clause) | 427 | `[S [S [NP the dog] [FP can [VP run]]] and [S [NP the cat] [FP can [VP jump]]] and [S [NP the fish] [FP can [VP swim]]] and [S [NP the bird] [FP can [VP sing]]] and [S [NP the lion] [FP can [VP dance]]] and [S [NP the horse] [FP can [VP fly]]] and [S [NP the donkey] [FP can [VP float]]] and [S [NP the eagle] [FP can [VP shiver]]] and [S [NP the rabbit] [FP can [VP blossom]]] and [S [NP the monkey] [FP can [VP crumble]]] and [S [NP the tiger] [FP can [VP arrive]]] and [S [NP the elephant] [FP can [VP climb]]]]` |
| S3 | stress: nested subordination | recognised | accept (clause) | 162 | `[S [S [NP the dog] [FP can [VP run]]] [SubCl because [S [S [NP the cat] [FP can [VP jump]]] [SubCl because [S [S [NP the fish] [FP can [VP swim]]] [SubCl because [S [NP the bird] [FP can [VP sing]]]]]]]]]` |

## Construction-level coverage (measured)

1500 random derivations plus 95 targeted ones so that every family has at least 40 samples (seed 20261019); tiles drawn from the real BIP39 lexicon and the 47 helper candidates. "Recovered" means the parser's forest contains the exact generating tree. The v1.1 column shows how often the shipped parser rejects sentences containing the family.

| Construction family | Generated sentences | Recovered | v1.1 rejected |
|---|---:|---:|---:|
| adjective | 436 | 436 | 83% |
| adjective_modifier | 316 | 316 | 83% |
| bare_idiomatic_pp | 142 | 142 | 100% |
| bare_np | 703 | 703 | 95% |
| causal_for_coordination | 41 | 41 | 100% |
| clause | 636 | 636 | 99% |
| clause_coordination | 377 | 377 | 100% |
| complement_clause | 209 | 209 | 100% |
| copula | 40 | 40 | 93% |
| degree_modifier | 274 | 274 | 91% |
| determiner | 517 | 517 | 82% |
| ditransitive | 58 | 58 | 97% |
| do_support | 40 | 40 | 98% |
| focus_modifier | 250 | 250 | 100% |
| fused_head | 40 | 40 | 88% |
| imperative | 582 | 582 | 87% |
| imperative_declarative_coordination | 40 | 40 | 100% |
| infinitive | 148 | 148 | 99% |
| intransitive | 785 | 785 | 96% |
| lexical_copula | 200 | 200 | 84% |
| modal | 41 | 41 | 100% |
| negation | 103 | 103 | 97% |
| nominal_utterance | 352 | 352 | 68% |
| noun_compound | 333 | 333 | 77% |
| noun_coordination | 625 | 625 | 97% |
| noun_head | 1058 | 1058 | 88% |
| np_premodifier | 1058 | 1058 | 88% |
| past_tense | 260 | 260 | 100% |
| perfect | 41 | 41 | 100% |
| postverbal_adverb | 57 | 57 | 96% |
| predicate_adjective | 152 | 152 | 99% |
| predicate_coordination | 360 | 360 | 100% |
| predicate_nominal | 47 | 47 | 98% |
| predicate_prepositional | 66 | 66 | 97% |
| prepositional_phrase | 427 | 427 | 98% |
| prepositional_verb | 90 | 90 | 86% |
| present_tense | 150 | 150 | 100% |
| preverbal_adverb | 73 | 73 | 95% |
| pronoun | 1149 | 1149 | 96% |
| question | 369 | 369 | 96% |
| relative_clause | 260 | 260 | 99% |
| subordinate_clause | 291 | 291 | 100% |
| verb_coordination | 545 | 545 | 99% |
| verb_object | 120 | 120 | 89% |
| vp_ellipsis | 726 | 726 | 99% |

Overall v1.1 accepts 209/1595 of these generated sentences. Whether the remainder are v1.1 under-coverage or Phase 0 over-generation is exactly what the ERG batch adjudicates, by family.

## Typed corruptions (measured)

Each generated sentence is corrupted using its own tree, so each corruption knows what it attacks. "Accepted" corruptions are not automatically errors: a corrupted string can have a genuine alternative reading (collective nouns, mass nouns, *will* as a lexical verb, nominative pronouns in fragments). Accepted cases are in `reports/corruption_acceptances.jsonl` and are sent to ERG in aggregate.

| Corruption | n | Phase 0 accepted | Phase 0 conflict naming the attacked constraint | v1.1 accepted |
|---|---:|---:|---:|---:|
| agreement | 1208 | 75 | 1103 | 0/1208 |
| case | 1434 | 104 | 1300 | 19/1434 |
| adjacent swap | 1477 | 266 | — | 81/1477 |
| token delete | 1477 | 522 | — | 90/1477 |
| article | 35 | 0 | 35 | 0/35 |
| det drop | 174 | 42 | 131 | 3/174 |
| object drop | 60 | 9 (verb kept as verb: 0) | 50 | 0/60 |

Defects found by this stream and fixed during Phase 0: case was checked on the first conjunct only (*me and he can run*); PP and relative postmodifiers dropped pronoun case (*they about industry* as an object); NP-level *but* (*the cat but the dog*); mixed *and/or* chains flattened with the wrong number; reflexive *myself* without an antecedent; over-broad collective-noun and bare-PP evidence rules (see lexical policy).

## Performance (measured, Node, desktop)

| Generated length | n | p50 ms | p95 ms | max ms |
|---|---:|---:|---:|---:|
| 1-8 tokens | 571 | 0.61 | 4.77 | 29.77 |
| 9-14 tokens | 465 | 1.58 | 7.33 | 21.29 |
| 15-20 tokens | 387 | 2.45 | 10.01 | 36.31 |
| 21-24 tokens | 172 | 3.33 | 12.4 | 37.42 |

Adversarial inputs (full API: 24-best readings, diverse root readings, choice points):

| Case | Tokens | State | Complete trees | ms |
|---|---:|---|---:|---:|
| 10-noun compound subject | 13 | recognised | 2 | 7.3 |
| 20-noun compound subject | 23 | recognised | 96 | 16.1 |
| 40-noun compound subject | 43 | recognised | 768 | 18.5 |
| 50-noun compound subject | 53 | recognised | 1536 | 26.7 |
| 4 stacked PPs (attachment ambiguity) | 15 | recognised | 84 | 13.4 |
| 6 stacked PPs (attachment ambiguity) | 21 | recognised | 858 | 14.7 |
| 8 stacked PPs (attachment ambiguity) | 27 | recognised | 19448 | 9.1 |
| 10 stacked PPs (attachment ambiguity) | 33 | recognised | 705432 | 38.6 |
| 8 coordinated clauses | 39 | recognised | 1 | 3.5 |
| 16 coordinated clauses | 79 | recognised | 1 | 8.6 |
| 40-token realistic | 42 | recognised | 11616 | 16.1 |
| mixed subordination + coordination | 29 | recognised | 258 | 11.4 |

The largest single-sentence time in the generated run was 37.42 ms; such maxima are isolated (garbage collection / JIT warm-up), as the p95 column shows.

Phone figures are unmeasured; expect several times slower. The runtime lexicon is currently compiled at start-up from raw evidence; Phase 3 should ship a precompiled grammar and lexicon.

## Lexical policy (measured; details in `reports/lexical_policy.md`)

| Tier | What | Readings |
|---|---|---:|
| attested | mass readings (Wiktionary uncountable mark recorded but unused in v1.1) | 250 |
| attested | count readings for v1.1 mass nouns | 10 |
| attested | intransitive frames from WordNet frames / Wiktionary tags (ERG-validated) | 388 |
| attested | bare idiomatic PPs (189 preposition + noun pairs) | 189 |
| attested | degree modifiers *half*, *pretty* | 2 |
| derived | collective nouns with notional plural agreement | 45 |
| inferred | recorded, **not enabled** (includes 598 verb-frame readings that failed ERG validation) | 869 |

Two first-draft evidence rules were too permissive and were tightened before this report: collective nouns originally required only *some* OEWN `noun.group` sense (admitting *run*, *table*, *matrix*), and the bare-PP miner originally counted ordinary mass uses and complex prepositions (850 readings; now 189). Both stories are why evidence tiers are recorded on every reading.

## ERG cross-check (measured: 2026-10-19 Colab run, ERG 2025 + ACE 0.9.34)

1349 items (batch `erg/phase0_batch.jsonl`, built from the engine *before* the changes below). A sentence counts as ERG-witnessed only if ERG's top-ranked derivation is a full clause, VP ellipsis with an overt subject, or an NP fragment, with no robust/generic lexical entry and every word its own terminal. A bare ERG parse is not enough: ERG also returns subjectless finite-VP fragments, capitalised words read as proper names, and other robustness analyses. Full detail: `reports/erg_phase0_analysis.md`.

| ERG analysis type (top-ranked derivation) | Witness | Items |
|---|---|---:|
| full_clause | yes | 386 |
| np_fragment | yes | 327 |
| no_parse | no | 308 |
| vp_ellipsis | yes | 136 |
| other_fragment | no | 105 |
| robust_lexical | no | 70 |
| inverted_ellipsis | no | 15 |
| merged_span | no | 2 |

**Where ERG analyses what Phase 0 rejects**, the causes are policy differences visible in ERG's own rule names, not missed grammar:

| Cause | Items |
|---|---:|
| ERG count→mass coercion ("grinding") | 76 |
| ERG verb object omission (optional complement) | 48 |
| ERG does not check a/an | 29 |
| ERG does not check reflexive binding | 16 |
| ERG bare N-bar fragment (headline style) | 14 |
| ellipsis after has/do/be (Phase 0: modals only) | 9 |
| lexical do/will (gold do is auxiliary-only) | 7 |
| ERG agreement with or-coordination | 6 |
| other | 3 |

**Where Phase 0 accepts what ERG does not**, each lexical evidence source and restriction was measured by switching it off and on (`erg/ablate.js`). For evidence sources, the length-controlled ratio is ERG witnesses among the sentences the source alone admits, divided by the number expected at the curated-only rate for sentences of the same length. Rule: keep a source enabled if the ratio is ≥ 0.8.

| Source / restriction | Adds acceptances | …ERG-witnessed | Adds rejections | …ERG agrees | Length-controlled ratio | Phase 0 decision |
|---|---:|---:|---:|---:|---:|---|
| collective nouns: no plural determiners, not bare | 0 | 0 | 208 | 130 | — | keep (most disagreements are ERG grinding) |
| Wiktionary mass readings | 285 | 206 | 0 | 0 | 0.87 | keep |
| OEWN bare idiomatic PPs | 57 | 48 | 0 | 0 | 1.01 | keep |
| WordNet/Wiktionary intransitive frames | 110 | 65 | 0 | 0 | 0.72 | keep, borderline (held-out 0.81; see below) |
| WordNet/Wiktionary transitive frames | 6 | 2 | 0 | 0 | 0.39 | demoted to inferred |
| WordNet/Wiktionary ditransitive frames | 5 | 1 | 0 | 0 | 0.24 | demoted to inferred |
| WordNet/Wiktionary lexical-copula frames | 42 | 23 | 0 | 0 | 0.66 | demoted to inferred |
| WordNet/Wiktionary to-infinitive frames | 16 | 7 | 0 | 0 | 0.52 | demoted to inferred |
| WordNet/Wiktionary clause frames | 37 | 24 | 0 | 0 | 0.78 | demoted to inferred |

This table is re-measured with the current (Phase 1) engine, so each WordNet/Wiktionary frame source is measured by what it adds *beyond* curated and ERG-lexicon frames. ERG now supplies most well-supported intransitive uses, so the residual WordNet/Wiktionary intransitive frames score 0.72 on run 1 but 0.81 on the held-out run 2: kept under the rule (decisions rest on held-out data), flagged as the first candidate to drop if a later run falls below 0.8.

Three grammar restrictions tried after the ERG run were measured the same way and **not** adopted, because ERG evidence ran against them: adjectives only before noun modifiers (would reject 33 ERG-analysed sentences to catch 14), no postmodification of case-marked pronouns (121 vs 48), no nominative-pronoun fragments (43 vs 27).

**Current engine against the same ERG results** (`erg/rescore.js`):

| Items | ERG | n | Accepted by engine at ERG run | Accepted now |
|---|---|---:|---:|---:|
| accepted | ERG no | 186 | 186 | 93 |
| accepted | ERG witness | 414 | 414 | 330 |
| generated_positive | ERG no | 114 | 114 | 47 |
| generated_positive | ERG witness | 286 | 286 | 238 |
| rejected | ERG no | 184 | 0 | 8 |
| rejected | ERG witness | 116 | 0 | 4 |

The engine now rejects most of the generated sentences ERG could not analyse, at the cost of some ERG-analysed sentences that depend on ERG grinding or on the demoted verb frames. Agreement with ERG is a signal, not ground truth: ERG ignores a/an, grinds any count noun to mass, and does not check reflexive binding.

## ERG held-out check (measured: second Colab run, same ERG/ACE)

A fresh batch (`erg/phase0b_batch.jsonl`, 1349 items) generated by the engine *after* the run-1 decisions, so this tests those decisions on data they were not tuned on. The notebook stored a derivation for each of ERG's top five readings; an item is witnessed if any of them is a full clause, VP ellipsis with an overt subject, or an NP fragment. ACE was reproducible: re-running gave identical top derivations for 1,347 of 1,349 items.

ERG witnesses **87.3%** of the engine's generated sentences (run 1, curated-only baseline: 85.7%).

| Evidence source | Sentences it alone admits | Length-controlled ratio (held out) | Run-1 ratio |
|---|---:|---:|---:|
| Wiktionary mass readings | 287 | 0.92 | 0.87 |
| OEWN bare idiomatic PPs | 82 | 0.94 | 1.01 |
| attested intransitive frames | 128 | 0.81 | 0.72 |

All three retained sources pass the 0.8 rule again on held-out data. The demoted verb-frame types cannot be re-tested on this batch (it was generated without them); their demotion rests on run 1.

Where ERG analyses what Phase 0 rejects (held out), read from the ERG reading that actually witnesses the sentence:

| Cause | Items | Status |
|---|---:|---|
| ERG count→mass coercion ("grinding") | 99 | policy: excluded (decided 2026-10-19) |
| ERG verb object omission (optional complement) | 95 | Phase 1 candidate: ERG marks optional objects per verb |
| ERG does not check a/an | 41 | policy: Phase 0 checks a/an |
| ERG does not check reflexive binding | 28 | policy: reflexives only in fragments |
| ellipsis after has/do/be (Phase 0: modals only) | 16 | Phase 1 candidate: coverage gap |
| other | 14 | residual |
| ERG agreement with or-coordination | 14 | policy: mixed-number or does not agree |
| ERG bare N-bar fragment (headline style) | 12 | policy: excluded |
| lexical do/will (gold do is auxiliary-only) | 2 | policy: gold-role rule |

## ERG held-out check of Phase 1 (measured: third Colab run)

Batch `erg/phase1_batch.jsonl` (1357 items) from the Phase 1 engine. ERG witnesses **83.8%** of generated sentences.

Retained evidence sources, held out: Wiktionary mass readings 0.9 (n 306); OEWN idiomatic PPs 0.89 (n 106); residual WordNet/Wiktionary intransitive frames 0.68 (n 92). The residual WordNet/Wiktionary intransitive frames fell below 0.8, so, as committed after run 2, no WordNet/Wiktionary frame type is enabled any longer; ERG lexicon frames (intransitive and optional-object) supply verb frames. One probe changed as a result: the canonical reading of *the vivid autumn blossom and the famous canvas cat bag* is now the intended noun-phrase fragment (intransitive *bag* came only from a WordNet frame).

| Why ERG analyses what the engine rejects (run 3) | Items |
|---|---:|
| ERG count→mass coercion ("grinding") | 96 |
| ERG verb object omission (optional complement) | 58 |
| ERG does not check a/an | 31 |
| ERG does not check reflexive binding | 25 |
| ERG agreement with or-coordination | 20 |
| lexical do/will (gold do is auxiliary-only) | 16 |
| ERG bare N-bar fragment (headline style) | 13 |
| other | 11 |

## Phase 3: the game (`dist/Starpin_Word_Lab_v2_0.html`)

Built from the v1.1 single-file game by `tools/build_game.js`; the v1.1 file is not modified, and every patch must match the v1.1 source exactly once. The interface keeps its layout; the grammar, scorer, score panel, explanation, tree and portfolio rows are replaced, and the v1.1 parser is kept only to record each migrated sentence's v1.1 score.

- **Migration on the device:** on first load, the v1.1 browser snapshot is imported (inventory, helpers including *has*, sentences, sandbox, draft); the v1.1 snapshot is left untouched; a v2 snapshot is written. Exported v1.1 session files import too.
- **Version history:** every sentence records its score under each grammar/scorer version (migrated sentences start with their v1.1 score), shown as “was … under …” in the portfolio.
- **Pending sentences:** a grammar-level failure (named conflict, or outside the grammar) can be saved and committed; it reserves its blue tiles, scores 0, and is re-checked whenever the grammar or scorer changes. Tile problems (uncollected, already used, helper locked) still block saving.
- **Reading choice:** the syntax view lists only the words whose role differs between readings; tapping a role pins it and the score follows. Pins belong to the exact word sequence, so editing drops them.
- **Score panel:** blue tiles, word-role points, size multiplier, clause links, link-type and embedding bonuses, per-word points, and notes when a link is not scored or a list/adjective stack tapers.
- The obsolete “modifiers per noun” setting is hidden (stacks taper instead).
- **Typed entry:** a text field above the tiles; four letters complete a BIP39 word (BIP39 words are unique by their first four letters), shorter words and helpers complete on space or Enter, Backspace on an empty field returns the last word for editing. Collected words become blue tiles and leave the tray; uncollected words become purple “try” tiles; helper words that are also BIP39 words (can, all, because …) default to gold when unlocked (tap ↔ to switch).
- **Cleaner tiles:** tiles show only the word (gold helpers have a dashed border); controls appear only on the selected tile. Drag to reorder (long-press on touch), drag to the floating “Drop here to remove” zone to delete, keyboard arrows/Delete on a focused tile; every removal offers Undo.
- **Word tray:** every available word is shown (no “Show all”), with a fade when more words are below; the search box and the static “suggestions, not guarantees” rows are removed; the part-of-speech filter stays.
- **Coach:** tips come from the actual analysis (conflict to fix, unscored link, missing link type, tapering stack, list, phrase versus sentence, size bonus); the button steps through them and the coach closes when the sentence changes.
- **Challenges:** a Play selector switches between free play and challenge slots. A challenge’s collection is its hand (only words you actually found in the window); the tray, typing and allocation see only the hand; each slot keeps its own sentences; free play is saved and restored untouched. A status line shows words placed, the stretch target (90% of the hand), score and bot par. Challenges are loaded from `challenges/*.json` at build time (currently four retrospective ones, August–October 2026, reconstructed from the Starpin record export by `tools/reconstruct_finds.js`).
- **Helpers never expire; simulated progression for testing:** a Helpers selector sets the unlocked helpers to what N completed cells would give under a proposed schedule (6 starter helpers, then 3 per cell in order of general usefulness: in/on/to, are/not/of, with/for/but, or/was/has, because/that/it, do/does/did, were/at/from, when/if/while, will/must/this, he/she/we, they/some/all, by/before/where, each/many/inside, into/toward). “Actual unlocks” restores the real set. The schedule is a proposal, not a ratified rule.
- **Build stamp:** the header shows `build MMDD·hash` so the running copy can be identified (useful when browser caches serve an old file).
- **Proper names:** the seven nouns the v1.1 lexicon marks as proper names (April, December, February, Latin, March, October, Satoshi) are bare singular NPs (*Satoshi can run*); their common-noun readings stay (*a satoshi*). Months and Latin are always capitalised in display; Satoshi and March when read as names.

End-to-end test (`tests/browser_game_test.py`, headless Chromium, 390×844 phone viewport, seeded with the v1.1 session):

| Check | Result |
|---|---|
| migration keeps inventory, helpers and sentences | pass — 167 words, 9 helpers, 3 sentences |
| each migrated sentence keeps its v1.1 score in history | pass — v1.1 [418, 165, 216] -> v2 [259, 232, 239] |
| migration notice shown | pass |
| v1.1 snapshot left untouched | pass |
| draft is scored | pass |
| a grammar-level failure is pending, not blocked | pass |
| pending sentence can be saved and committed | pass — 4 committed |
| pending sentence reserves its blue tiles | pass — reusing "buyer" -> refused={'len': 0, 'text': True} |
| portfolio shows pending and v1.1 history | pass |
| ambiguous draft offers choice points | pass |
| tapping a reading pins it | pass |
| editing the sentence drops stale pins | pass |
| typing alone never accepts a word (no surprise completion) | pass |
| the word Space would accept is highlighted | pass — affair |
| four letters + Space completes the unique BIP39 word into a blue tile | pass |
| a helper completes on space (gold) | pass |
| a complete helper word is not swallowed by a longer BIP39 word (some/someone) | pass |
| Backspace into a completed word returns it for editing | pass |
| several words typed in a row become tiles | pass |
| no per-tile controls until a tile is selected | pass |
| selecting a tile shows one small bar | pass |
| no found/∞ subscripts on sentence tiles | pass |
| removing shows Undo, and Undo restores the tile | pass |
| the Undo notice actually disappears after Undo | pass |
| long-press drag reorders on touch | pass |
| long-press drag onto the remove zone deletes (with Undo) | pass |
| keyboard Delete removes the focused tile | pass |
| coach opens on request and closes when the sentence changes | pass |
| pasting a sentence turns every word into a tile | pass |
| a paste stops at a locked helper and keeps the rest in the field | pass |
| word tray shows every word; no search box; no static suggestions | pass |
| Satoshi is capitalised as a name | pass — Satoshi can. |
| a challenge shows only its hand (tray and collection) | pass |
| a challenge starts with no sentences | pass |
| challenge status shows placed words and bot par | pass — 0 / 41 words placed (stretch 37) · 0 points (bot par 557) |
| a sentence can be committed inside the challenge | pass — the banana can abandon |
| free play is untouched and restored | pass |
| the challenge keeps its own sentences | pass |
| helper simulation: 0 cells = 6 starter helpers, 3 cells = 15 | pass |
| challenge slot and helper simulation survive a reload | pass |
| "Actual unlocks" restores your real helpers | pass |
| build stamp is visible | pass |
| parser/LLM sentence removed | pass |
| autosave writes a version-2 snapshot | pass |
| reload resumes v2 snapshot (no re-migration) | pass — 4 committed |
| history preserved across reload | pass |
| no JavaScript errors | pass |

## Recorded policy decisions

- **Count→mass coercion ("grinding") is excluded from the default grammar** (Greg O'Beirne, 2026-10-19). A singular count noun is used bare only where a mass reading is attested. This keeps determiner choice meaningful; grinding may later become a separately flagged rare reading.
- Gold tiles supply closed-class roles only, plus lexical *has* and causal *for* (2026-10-19).
- Unrecognised sentences may be saved with reserved blue tiles and zero competitive points, and are re-scored on grammar updates (2026-10-19).
- Creative-mode rescoring is allowed with version history; competitions freeze grammar and scoring versions (2026-10-19).

## Phase 1 grammar additions (measured)

- **Post-auxiliary ellipsis** after modals, *has/have*, *does/do/did* and *is/are/was/were*, optionally with *not*, as an ordinary finite predicate, so it also appears inside coordination and subordinate clauses (*The cat can run because the dog did.*). Agreement still applies (*The cat are.* is a conflict). *The cat is.* is now recognised as ellipsis, as ERG analyses it.
- **Verb frames from the ERG lexicon** (MIT licence; `data/erg_verb_evidence.json`, SHA-256 recorded): 388 readings for 331 BIP39 verbs. An optional object (`v_np*_le`, e.g. *detect*, *grant*, *sting*) licenses object omission (*Detect.*); `v_np_le` verbs (*bless*, *oppose*, *ensure*) still require one. ERG also supplies verb-specific ditransitive, *to*-infinitive and clause frames, replacing the WordNet frames demoted after run 1. Validating these against ERG would be circular, so they are checked by the corruption gates and probes instead.
- **Specific conflicts** now report one or two named violations with spans (e.g. *myself … are*: pronoun case and agreement); three or more is reported as outside the grammar.
- **Family review:** with sentence length controlled, every construction family with n ≥ 15 is ERG-witnessed at ≥ 0.79 of its expected rate; the weakest (infinitives) is explained by v1.1 verb readings that ERG does not list (*to friend*, *to hole*). No grammar change.

## Phase 2 scoring (`src/score.js`, version phase2-0.3.0)

A sentence is scored from one reading only: the canonical reading, or the one the player pinned. Conflicts and unrecognised sentences score 0 and are marked pending.

| Component | Rule |
|---|---|
| Blue tile, core role (argument or predicate head) | 10 |
| Blue tile in a closed-class role (e.g. blue *can* as modal) | 4 |
| Adjective/adverb modifiers of one head | 10 × 0.7^k (bound 33) |
| Noun-compound modifiers of one head | 10 × 0.9^k (bound 100) |
| Bare one-word conjuncts (lists), third onward | × 0.7^(k−2) |
| Size multiplier on lexical points, B = blue tiles | 1 + 0.6·(1 − 0.85^(B−1)) (bound 1.6) |
| Clause links (coordination, causal *for*, subordination, complement, infinitive, relative) | 12 × 0.6^k per sentence, whatever the conjunction; each linked side must be blue-anchored and hold ≥ 2 blue tiles |
| Distinct link types T | 10·T + 6·T·(T−1) = 10, 32, 66, 112, 170, 240 |
| Argument-clause embedding depth | 8 per level, up to 3 |
| Nominal fragment | × 0.6 |

Gold tiles earn no lexical points. There is no fixed per-sentence bonus. Portfolio score is the plain sum.

### Invariant tests (measured, `tests/run_scoring.js`, all on real parses)

| Check | Result |
|---|---|
| P1 recognised + blue tile ⇒ score > 0 | 0 violations in 800 generated sentences |
| P2 inserting a blue modifier (other words' structure unchanged) never lowers the score | 0 violations in 717 insertions (23 further insertions re-bracketed the sentence and are a reading change, not a P2 case) |
| P3′ gold-only material earns nothing; unanchored links earn nothing | 0 non-zero of 150 gold-only sentences; anchor cases all as expected |
| P4′ chains converge; another *and* adds 4.32 structural points, a new relation type (relative clause) adds 46.32 | 0 failures |
| P5 compound stack ≫ adjective stack (8 modifiers: 56.94 vs 31.41; bounds 100 vs 33) | 0 failures |
| P6 score spread across alternative readings (tracked) | median 0, 90th percentile 0.269 of the canonical score |
| Join test: clause-level join ≥ separate sum | 0 violations in 10 joins |

Clause chains (same words; scores after 1–10 clauses):

| Pattern | Scores |
|---|---|
| and | 22, 71, 109, 146, 182, 218, 252, 287, 321, 354 |
| because | 22, 79, 117, 154, 190, 225, 260, 294, 328, 361 |
| alternating | 22, 71, 139, 176, 212, 247, 282, 316, 350, 383 |
| and/because/while/before | 22, 71, 139, 176, 220, 255, 290, 324, 357, 390 |

Splitting a long homogeneous chain into two sentences (the residual cost of keeping a plain portfolio sum with per-sentence link tapering):

| Clauses | Joined | Split in two | Split gain |
|---:|---:|---:|---:|
| 4 | 146.1 | 142.5 | -2.5% |
| 6 | 217.6 | 218.5 | 0.4% |
| 8 | 286.8 | 292.3 | 1.9% |
| 10 | 354.2 | 364.4 | 2.9% |
| 12 | 420.5 | 435.2 | 3.5% |

Points per blue tile by strategy:

| Strategy | Blue tiles | Score | Per blue tile |
|---|---:|---:|---:|
| one-word imperative | 1 | 10 | 10 |
| noun list fragment | 6 | 48 | 8 |
| bare noun list fragment | 6 | 30 | 5.03 |
| adjective stack | 8 | 70 | 8.69 |
| noun compound | 8 | 94 | 11.76 |
| compound fragment | 7 | 47 | 6.69 |
| 8-clause and-chain | 16 | 287 | 17.92 |
| 8-clause because-chain | 17 | 294 | 17.31 |
| 8-clause alternating chain | 17 | 316 | 18.6 |
| handover A | 10 | 134 | 13.44 |
| handover C | 11 | 181 | 16.41 |
| session sentence 1 | 16 | 259 | 16.17 |
| embedding + relative | 9 | 134 | 14.89 |

**Adversarial portfolio search** on the 167-word inventory embedded in v1.1 plus helpers the, is, in, and, a, can, for, on, has: 6000 distinct grammar-generated candidate sentences, packed greedily (disjoint blue tiles). Best portfolio: 61 sentences, 141 blue tiles, 1817 points (12.89 per tile); structural points 14% of the total; 2 tapered list items. No degenerate pattern dominates. Points per blue tile rise with sentence size:

| Blue tiles in sentence | Candidates | Median per tile | 90th percentile per tile |
|---|---:|---:|---:|
| 1-2 | 696 | 10 | 10.9 |
| 3-4 | 1782 | 10.5 | 12.3 |
| 5-6 | 1486 | 11.8 | 14.2 |
| 7-9 | 1423 | 12.6 | 16.3 |
| 10+ | 613 | 14.5 | 17.8 |

The first scorer draft (v0.1) failed this search: tiny elliptical or bare-verb structures (*project all can and canvas*: 3 blue tiles, 95 points) collected clause-link and diversity bonuses with almost no content, and *Run.* out-scored the handover sentences per tile. The substantive-link rule and the size multiplier were introduced in response.

### v1.1 score versus Phase 2 score

| Sentence | v1.1 | Phase 2 | Phase 2 breakdown |
|---|---:|---:|---|
| A | — | 134 | lexical 92 × 1.461, links 0, types — |
| C | — | 188 | lexical 111 × 1.5, links 1, types coordination |
| Session 1 | 418 | 259 | lexical 153 × 1.548, links 1, types subordination |
| Session 2 | 166 | 240 | lexical 154 × 1.555, links 0, types — |
| Session 3 | 216 | 239 | lexical 140.9 × 1.538, links 1, types coordination |

Scales differ (v1.1 multiplied up to 6.8×), so compare rankings, not magnitudes.

## Known limitations (Phase 0)

- No wh-questions, object relatives, passives, comparatives, existential *there*, or *it*-clefts.
- No binding theory: reflexives are licensed only in non-sentential utterances.
- No morphology: BIP39 base forms only, so third-person-singular present is available only through *has*, modals, past forms and copulas.
- Agreement with mixed-number *or* is left undetermined (usable after modals/past; not with present agreement). Person in coordinations is taken as third.
- AdjP and PP fragments (*Happy.*, *In the garden.*) are not yet utterance types.
- Collective-noun and idiom evidence comes from OEWN sense ordering and definitional text; residual quirks are tagged `derived`/`attested` and listed.
- Phone performance, iOS persistence and touch are untested.

## Scoring invariants for Phase 2 (proposal, not implemented)

- **P1** Every recognised utterance with at least one blue tile scores more than zero.
- **P2** Adding a blue tile in a genuine new grammatical role never lowers a score.
- **P3′** Gold tiles earn no lexical points. A relation introduced by a gold tile (subordination via *because*, coordination via *and* or *for*) earns relation points only when each related constituent has a blue-anchored head. Gold-only material can never create a scoring relation.
- **P4′** All clause-linking relations draw on one budget regardless of conjunction; the k-th link is worth geometrically less, so chains of *and*, of *because*, or alternating ones converge to the same bound. Structural interest is rewarded separately and boundedly: a bonus per distinct relation type, and a bonus for genuine embedding depth (a clause inside an argument of another clause). Tested property: extending a chain by alternating conjunctions never beats adding a new relation type.
- **P5** Modifier stacking is bounded; the noun-compound asymptote is substantially higher than the adjective asymptote, and compound length earns modest, increasing, bounded rewards.
- **P6** The score is computed on the canonical (or player-pinned) reading, chosen without consulting the score; score spread across readings is a tracked metric.
- **P7** Portfolio score is the order-independent sum of sentence scores.

## Next steps

- Play-test `dist/Starpin_Word_Lab_v2_0.html` on the iPhone (real touch, real storage, the live v1.1 session).
- Not yet built: competition mode with frozen grammar/scorer versions; Starpin collection-log verification for leaderboards; morphology helpers (-s, -ed, -ing).
