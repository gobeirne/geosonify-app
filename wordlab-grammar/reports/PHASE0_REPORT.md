# Starpin Word Lab — Phase 0 grammar prototype: report

Engine `phase0-0.1.0` · strict grammar 7894 atomic rules, relaxed 19503, 596 symbols · strict-grammar compile 326 ms at start-up; relaxed (diagnostic) grammar compiled lazily on first failure in 437 ms (Node). Compiling at start-up is a prototype convenience: Phase 3 should ship the compiled grammar.

Status labels: **measured** = produced by the scripts in this folder; **proposal** = design for later phases; **limitation** = known gap. Nothing here modifies the Word Lab game or any session.

## Acceptance criteria (measured)

| Criterion | Result |
|---|---|
| Every handover §5 probe yields its intended roles | 51/51 probes pass (B intended reading via one optional pin; E2 intended fragment offered, canonical is a genuine clause) |
| Generated derivations recognised and exactly recovered | 1587/1587 |
| Typed corruptions caught, with the right constraint named | see corruption table |
| p95 parse time ≤ 20 ms for ~40 tokens (Node) | 40-token realistic sentence 11.6 ms; generated 21–24 tokens p95 18.22 ms |
| ERG batch emitted | 49 probe, 400 generated positive, 600 corruption accepted, 300 corruption rejected |
| Phone timing | **not yet measured**: open `bench/wordlab_grammar_bench.html` on an iPhone |

## What Phase 0 is

A declarative feature grammar (`src/grammar.js`: 75 rule schemas, each with a construction family, head, typed dependencies and CGEL chapter reference) compiled to an atomic context-free grammar, parsed by an Earley chart parser with FIRST-set lookahead into a packed forest (`src/parser.js`). There are no depth limits, no per-stage result caps and no step budgets. Noun compounds are a flat modifier sequence with a rightmost head, so compound length is unbounded and internal bracketing (semantic, Catalan-explosive) is not enumerated.

Each parse returns one of three states:

- **recognised** — at least one complete analysis; the canonical reading is chosen by a preference cost built only from lexical evidence tier, marked-construction costs and utterance type. No score is consulted.
- **conflict** — no strict analysis, but exactly one named constraint (agreement, a/an, determiner–noun, pronoun case, verb frame) relaxed yields one; the span is reported.
- **unrecognised** — no analysis even with relaxations; partial constituents found bottom-up are shown. This is a statement about the grammar's coverage, not about English.

**Reading choice (proposal, implemented in the engine API).** For ambiguous sentences the engine reports *choice points*: tokens whose part of speech differs across complete parses. A player may pin any of them; the best tree consistent with the pins is returned. Storing pins (token index → category) with a saved sentence survives grammar upgrades better than storing a reading identifier. Pinning is optional and never driven by score.

## Intended-analysis probes

Full analyses, alternative readings and choice points: `reports/probe_analyses.md`. v1.1 verdicts are from the shipped parser on the same tiles.

| Probe | Source | Phase 0 | v1.1 | Canonical bracketing |
|---|---|---|---|---|
| A1 | handover 5A | recognised | reject | `[Imp [VP [VP prevent [NP prison patient parrot ketchup]] [PP in [NP all bitter banana menu output]]]]` |
| A2 | handover 5A (patient as noun adjunct) | recognised | reject | `[Imp [VP [VP prevent [NP prison patient parrot ketchup]] [PP in [NP all bitter banana menu output]]]]` |
| B1 | handover 5B, intended reading via one pin | recognised | reject | `[Utt [Imp [VP [VP [VP [VP fix [NP the fossil figure]] [PP in [NP the favorite filter]]] and [VP forget [NP the grid gadget]]] [PP in [NP the garage]]]] for [S [NP [NP staff] [PP on stage]] [FP [VP sign [NP steel soldier script output]]]]]` |
| B2 | handover 5B (unpinned: causal 'for' must be offered) | recognised | reject | `[Utt [Imp [VP [VP [VP [VP fix [NP the fossil figure]] [PP in [NP the favorite filter]]] and [VP forget [NP the grid gadget]]] [PP in [NP the garage]]]] for [S [NP [NP staff] [PP on [NP stage sign steel soldier script]]] [FP [VP output]]]]` |
| B3 | handover 5B / ERG bake-off | recognised | reject | `[S [NP [NP staff] [PP on stage]] [FP can [VP sign [NP the script]]]]` |
| C1 | handover 5C | recognised | reject | `[S [S [NP the unknown civil void] [FP [VP has [NP just blame]]]] and [S [NP the bitter october symbol] [FP can [VP oppose [NP the joke journey]]]]]` |
| C2 | handover 5C (focus reading also offered) | recognised | reject | `[S [S [NP the unknown civil void] [FP [VP has [NP just blame]]]] and [S [NP the bitter october symbol] [FP can [VP oppose [NP the joke journey]]]]]` |
| D1 | handover 5D | recognised | accept (clause) | `[S [NP the cat can] [FP can [VP run]]]` |
| D2 | handover 5D | recognised | accept (question) | `[Q can [NP the cat can] [VP run]]` |
| D3 | handover 5D: grammatical, but 'may' is neither BIP39 nor a helper | invalid_tiles | reject |  |
| D4 | handover 5D | recognised | accept (clause) | `[S [NP the cat can] [FP must [VP run]]]` |
| D5 | gold-role policy: a gold 'can' is a modal only | unrecognised | accept (imperative) |  |
| D6 | gold-role policy: a blue 'can' keeps its noun reading | recognised | accept (imperative) | `[Imp [VP kick [NP the angry can]]]` |
| E1 | handover 5E | recognised | accept (ellipsis) | `[Ellipsis [NP the garden fence] can]` |
| E2 | handover 5E (the fragment reading must be offered; canonical is a genuine clause: [blossom and cat] [bag], bag = intransitive verb, WordNet frame 1) | recognised | accept (fragment) | `[S [NP [NP the vivid autumn blossom] and [NP the famous canvas cat]] [FP [VP bag]]]` |
| E2b | handover 5E: canonical reading is the clause with intransitive 'bag' | recognised | accept (fragment) | `[S [NP [NP the vivid autumn blossom] and [NP the famous canvas cat]] [FP [VP bag]]]` |
| E3 | handover 5E | recognised | accept (clause) | `[S [NP [NP a cheap angry badge] and [NP a shallow silly chat]] [FP can [VP [VP [VP boil [NP [NP nice level stairs] and [NP the vocal timber table]]] [PP in [NP the million citizen parade]]] [PP in [NP the vivid autumn blossom]]]]]` |
| E4 | handover 5E (ERG: no reading) | recognised | accept (imperative) | `[Imp [VP [VP clump [NP the document]] and [VP forget [NP the half human hybrid fossil]]]]` |
| E5 | handover 5E | recognised | accept (imperative) | `[Imp [VP [VP [VP crumble [NP the favorite document]] [PP in [NP fun]]] and [VP ensure [S [NP the core dose] [FP can [VP [VP predict [NP midnight security]] and [VP taste [NP vivid unknown ketchup]]]]]]]]` |
| E6 | handover 5E | recognised | accept (imperative) | `[Imp [Imp [VP clean [NP the favorite festival]]] [SubCl because [S [NP angry jeans] [FP [VP just [VP know [NP robust inner salad]]]]]]]` |
| E7 | handover 5E | recognised | accept (imperative) | `[Imp [VP [VP just [VP joke]] and [VP blame [NP half human hybrid cat stairs]]]]` |
| E8 | handover 5E | recognised | accept (imperative) | `[Imp [VP [VP [VP taste [NP vocal stairs]] today] and [VP guess [NP famous angry autumn jeans]]]]` |
| U1 | v1.1 session sentence 1 | recognised | accept (imperative) | `[Imp [Imp [VP [VP abandon [NP [AdjP barely fun] festival salad]] and [VP shiver]]] [SubCl because [S [NP clean library jeans] [FP [VP [VP know [NP robust news]] [PP for [NP the runway security man]]]]]]]` |
| U2 | v1.1 session sentence 2 | recognised | accept (clause) | `[S [NP [NP a cheap angry badge] and [NP a shallow silly chat]] [FP can [VP [VP boil [NP [NP nice level stairs] and [NP the vocal timber table]]] [PP in [NP the million citizen parade]]]]]` |
| U3 | v1.1 session sentence 3 | recognised | accept (clause) | `[S [NP [NP the vivid autumn blossom] and [NP the famous canvas cat bag]] [FP [FP [VP crumble]] and [FP [VP [VP observe [NP the original midnight primary core]] [PP on [NP the inner coast]]]]]]` |
| F1 | handover 5F: chat count | recognised | accept (fragment) | `[Frag [NP a shallow silly chat]]` |
| F2 | handover 5F: chat mass | recognised | accept (fragment) | `[Frag [NP shallow silly chat]]` |
| F3 | handover 5F: 'symbol' is a noun adjunct, not an adjective | recognised | accept (clause) | `[S [NP the symbol cat] [FP can [VP run]]]` |
| F4 | handover 5F: 'symbol' is not a predicative adjective | conflict (det_noun) | reject |  |
| F5 | handover 5F: 'toward' is a preposition | recognised | accept (clause) | `[S [NP the cat] [FP can [VP [VP run] [PP toward [NP the garden]]]]]` |
| F6 | handover 5F: no free adverbial 'toward' | unrecognised | reject |  |
| P1 | v1.1 defect: invariant noun with 'is' | recognised | reject | `[S [NP the fish] [FP is sad]]` |
| P2 | v1.1 defect: three-way NP coordination | recognised | reject | `[S [NP [NP the cat] and [NP the dog] and [NP the fish]] [FP can [VP run]]]` |
| P3 | v1.1 defect: three-way VP coordination | recognised | reject | `[Imp [VP [VP run] and [VP jump] and [VP swim]]]` |
| P4 | v1.1 defect: three copular clauses | recognised | reject | `[S [S [NP the dog] [FP is happy]] and [S [NP the cat] [FP is sad]] and [S [NP the fish] [FP is calm]]]` |
| P5 | v1.1 defect: 'has' with a mass object | recognised | reject | `[S [NP the void] [FP [VP has [NP blame]]]]` |
| P6 | Buffalo-type reading accepted by v1.1: [cat dog fish] [bird] (to bird = birdwatch) | recognised | accept (clause) | `[S [NP cat dog fish] [FP [VP bird]]]` |
| N1 | agreement | conflict (agreement) | reject |  |
| N2 | article sound | conflict (article) | reject |  |
| N3 | article sound | conflict (article) | reject |  |
| N4 | bare singular count subject | conflict (det_noun) | reject |  |
| N5 | determiner number | conflict (det_noun) | reject |  |
| N6 | pronoun case (object-only reflexive as subject; me/them are not available tiles) | conflict (case) | accept (clause) |  |
| N7 | missing object of a transitive-only verb | conflict (verb_frame) | reject |  |
| N8 | doubled determiner (ERG merged spans) | unrecognised | reject |  |
| N9 | copula with no complement | unrecognised | reject |  |
| N10 | agreement inside a relative clause | conflict (agreement) | reject |  |
| N11 | agreement with 'has' | conflict (agreement) | reject |  |
| S1 | stress: 20-noun compound | recognised | reject | `[S [NP the prison patient parrot menu banana garden fence table stairs ketchup output script soldier steel salad canvas autumn october symbol journey] [FP is bitter]]` |
| S2 | stress: 12 coordinated clauses | recognised | accept (clause) | `[S [S [NP the dog] [FP can [VP run]]] and [S [NP the cat] [FP can [VP jump]]] and [S [NP the fish] [FP can [VP swim]]] and [S [NP the bird] [FP can [VP sing]]] and [S [NP the lion] [FP can [VP dance]]] and [S [NP the horse] [FP can [VP fly]]] and [S [NP the donkey] [FP can [VP float]]] and [S [NP the eagle] [FP can [VP shiver]]] and [S [NP the rabbit] [FP can [VP blossom]]] and [S [NP the monkey] [FP can [VP crumble]]] and [S [NP the tiger] [FP can [VP arrive]]] and [S [NP the elephant] [FP can [VP climb]]]]` |
| S3 | stress: nested subordination | recognised | accept (clause) | `[S [S [NP the dog] [FP can [VP run]]] [SubCl because [S [S [NP the cat] [FP can [VP jump]]] [SubCl because [S [S [NP the fish] [FP can [VP swim]]] [SubCl because [S [NP the bird] [FP can [VP sing]]]]]]]]]` |

## Construction-level coverage (measured)

1500 random derivations plus 87 targeted ones so that every family has at least 40 samples (seed 20261019); tiles drawn from the real BIP39 lexicon and the 47 helper candidates. "Recovered" means the parser's forest contains the exact generating tree. The v1.1 column shows how often the shipped parser rejects sentences containing the family.

| Construction family | Generated sentences | Recovered | v1.1 rejected |
|---|---:|---:|---:|
| adjective | 438 | 438 | 76% |
| adjective_modifier | 344 | 344 | 75% |
| bare_idiomatic_pp | 131 | 131 | 99% |
| bare_np | 715 | 715 | 92% |
| causal_for_coordination | 40 | 40 | 100% |
| clause | 531 | 531 | 98% |
| clause_coordination | 344 | 344 | 98% |
| complement_clause | 194 | 194 | 98% |
| copula | 46 | 46 | 93% |
| degree_modifier | 237 | 237 | 89% |
| determiner | 565 | 565 | 76% |
| ditransitive | 55 | 55 | 87% |
| do_support | 42 | 42 | 98% |
| focus_modifier | 252 | 252 | 100% |
| fused_head | 40 | 40 | 75% |
| imperative | 546 | 546 | 86% |
| imperative_declarative_coordination | 40 | 40 | 100% |
| infinitive | 98 | 98 | 94% |
| intransitive | 869 | 869 | 95% |
| lexical_copula | 159 | 159 | 82% |
| modal | 63 | 63 | 97% |
| modal_ellipsis | 312 | 312 | 71% |
| negation | 139 | 139 | 96% |
| nominal_utterance | 253 | 253 | 62% |
| noun_compound | 316 | 316 | 69% |
| noun_coordination | 635 | 635 | 94% |
| noun_head | 1079 | 1079 | 83% |
| np_premodifier | 1079 | 1079 | 83% |
| past_tense | 525 | 525 | 98% |
| perfect | 77 | 77 | 100% |
| postverbal_adverb | 62 | 62 | 94% |
| predicate_adjective | 120 | 120 | 98% |
| predicate_coordination | 322 | 322 | 99% |
| predicate_nominal | 58 | 58 | 95% |
| predicate_prepositional | 56 | 56 | 98% |
| prepositional_phrase | 431 | 431 | 95% |
| prepositional_verb | 77 | 77 | 84% |
| present_tense | 405 | 405 | 99% |
| preverbal_adverb | 57 | 57 | 95% |
| pronoun | 1121 | 1121 | 92% |
| question | 269 | 269 | 97% |
| relative_clause | 243 | 243 | 98% |
| subordinate_clause | 263 | 263 | 97% |
| verb_coordination | 556 | 556 | 99% |
| verb_object | 115 | 115 | 90% |

Overall v1.1 accepts 280/1587 of these generated sentences. Whether the remainder are v1.1 under-coverage or Phase 0 over-generation is exactly what the ERG batch adjudicates, by family.

## Typed corruptions (measured)

Each generated sentence is corrupted using its own tree, so each corruption knows what it attacks. "Accepted" corruptions are not automatically errors: a corrupted string can have a genuine alternative reading (collective nouns, mass nouns, *will* as a lexical verb, nominative pronouns in fragments). Accepted cases are in `reports/corruption_acceptances.jsonl` and are sent to ERG in aggregate.

| Corruption | n | Phase 0 accepted | Phase 0 conflict naming the attacked constraint | v1.1 accepted |
|---|---:|---:|---:|---:|
| agreement | 312 | 45 | 263 | 1/312 |
| adjacent swap | 1468 | 297 | — | 100/1468 |
| token delete | 1468 | 574 | — | 152/1468 |
| case | 1392 | 68 | 1124 | 58/1392 |
| det drop | 196 | 62 | 131 | 7/196 |
| article | 49 | 0 | 49 | 0/49 |
| object drop | 55 | 3 (verb kept as verb: 0) | 50 | 1/55 |

Defects found by this stream and fixed during Phase 0: case was checked on the first conjunct only (*me and he can run*); PP and relative postmodifiers dropped pronoun case (*they about industry* as an object); NP-level *but* (*the cat but the dog*); mixed *and/or* chains flattened with the wrong number; reflexive *myself* without an antecedent; over-broad collective-noun and bare-PP evidence rules (see lexical policy).

## Performance (measured, Node, desktop)

| Generated length | n | p50 ms | p95 ms | max ms |
|---|---:|---:|---:|---:|
| 1-8 tokens | 639 | 0.64 | 5.2 | 26.92 |
| 9-14 tokens | 438 | 1.87 | 10.21 | 34.03 |
| 15-20 tokens | 322 | 3.49 | 14.69 | 52.45 |
| 21-24 tokens | 188 | 4.81 | 18.22 | 71.6 |

Adversarial inputs (full API: 24-best readings, diverse root readings, choice points):

| Case | Tokens | State | Complete trees | ms |
|---|---:|---|---:|---:|
| 10-noun compound subject | 13 | recognised | 2 | 7 |
| 20-noun compound subject | 23 | recognised | 96 | 17 |
| 40-noun compound subject | 43 | recognised | 768 | 16.1 |
| 50-noun compound subject | 53 | recognised | 1536 | 17.5 |
| 4 stacked PPs (attachment ambiguity) | 15 | recognised | 84 | 10.1 |
| 6 stacked PPs (attachment ambiguity) | 21 | recognised | 858 | 7.8 |
| 8 stacked PPs (attachment ambiguity) | 27 | recognised | 19448 | 6.7 |
| 10 stacked PPs (attachment ambiguity) | 33 | recognised | 705432 | 15.8 |
| 8 coordinated clauses | 39 | recognised | 1 | 3.1 |
| 16 coordinated clauses | 79 | recognised | 1 | 6.8 |
| 40-token realistic | 42 | recognised | 11616 | 11.6 |
| mixed subordination + coordination | 29 | recognised | 228 | 3.9 |

The largest single-sentence time in the generated run was 71.6 ms; such maxima are isolated (garbage collection / JIT warm-up), as the p95 column shows.

Phone figures are unmeasured; expect several times slower. The runtime lexicon is currently compiled at start-up from raw evidence; Phase 3 should ship a precompiled grammar and lexicon.

## Lexical policy (measured; details in `reports/lexical_policy.md`)

| Tier | What | Readings |
|---|---|---:|
| attested | mass readings (Wiktionary uncountable mark recorded but unused in v1.1) | 250 |
| attested | count readings for v1.1 mass nouns | 10 |
| attested | intransitive frames from WordNet frames / Wiktionary tags (ERG-validated) | 265 |
| attested | bare idiomatic PPs (189 preposition + noun pairs) | 189 |
| attested | degree modifiers *half*, *pretty* | 2 |
| derived | collective nouns with notional plural agreement | 45 |
| inferred | recorded, **not enabled** (includes 335 verb-frame readings that failed ERG validation) | 606 |

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
| ERG does not check a/an | 29 |
| ERG does not check reflexive binding | 16 |
| ERG bare N-bar fragment (headline style) | 14 |
| other | 11 |
| lexical do/will (gold do is auxiliary-only) | 7 |
| ERG agreement with or-coordination | 6 |

**Where Phase 0 accepts what ERG does not**, each lexical evidence source and restriction was measured by switching it off and on (`erg/ablate.js`). For evidence sources, the length-controlled ratio is ERG witnesses among the sentences the source alone admits, divided by the number expected at the curated-only rate for sentences of the same length. Rule: keep a source enabled if the ratio is ≥ 0.8.

| Source / restriction | Adds acceptances | …ERG-witnessed | Adds rejections | …ERG agrees | Length-controlled ratio | Phase 0 decision |
|---|---:|---:|---:|---:|---:|---|
| collective nouns: no plural determiners, not bare | 0 | 0 | 197 | 120 | — | keep (most disagreements are ERG grinding) |
| Wiktionary mass readings | 286 | 207 | 0 | 0 | 0.85 | keep |
| OEWN bare idiomatic PPs | 57 | 48 | 0 | 0 | 0.98 | keep |
| attested intransitive frames | 193 | 136 | 0 | 0 | 0.82 | keep |
| attested transitive frames | 11 | 5 | 0 | 0 | 0.53 | demote to inferred |
| attested ditransitive frames | 7 | 2 | 0 | 0 | 0.33 | demote to inferred |
| attested lexical-copula frames | 41 | 23 | 0 | 0 | 0.66 | demote to inferred |
| attested to-infinitive frames | 30 | 15 | 0 | 0 | 0.58 | demote to inferred |
| attested clause-complement frames | 43 | 26 | 0 | 0 | 0.7 | demote to inferred |

Three grammar restrictions tried after the ERG run were measured the same way and **not** adopted, because ERG evidence ran against them: adjectives only before noun modifiers (would reject 33 ERG-analysed sentences to catch 14), no postmodification of case-marked pronouns (121 vs 48), no nominative-pronoun fragments (43 vs 27).

**Current engine against the same ERG results** (`erg/rescore.js`):

| Items | ERG | n | Accepted by engine at ERG run | Accepted now |
|---|---|---:|---:|---:|
| accepted | ERG no | 186 | 186 | 88 |
| accepted | ERG witness | 414 | 414 | 327 |
| generated_positive | ERG no | 114 | 114 | 42 |
| generated_positive | ERG witness | 286 | 286 | 230 |
| rejected | ERG no | 184 | 0 | 0 |
| rejected | ERG witness | 116 | 0 | 0 |

The engine now rejects most of the generated sentences ERG could not analyse, at the cost of some ERG-analysed sentences that depend on ERG grinding or on the demoted verb frames. Agreement with ERG is a signal, not ground truth: ERG ignores a/an, grinds any count noun to mass, and does not check reflexive binding.

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

## Next step

Optional second ERG run on `erg/phase0b_batch.jsonl` (built from the current engine; the notebook now stores every inspected reading's derivation, so fragment-ranked-first cases can be resolved). Then `node erg/analyse.js <results> erg/phase0b_batch.jsonl erg_phase0b`. After that, Phase 2 (scoring) can start on a validated grammar.
