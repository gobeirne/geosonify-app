# Starpin Word Lab — Phase 0 grammar prototype: report

Engine `phase0-0.1.0` · strict grammar 7639 atomic rules, relaxed 19200, 569 symbols · strict-grammar compile 392 ms at start-up; relaxed (diagnostic) grammar compiled lazily on first failure in 497 ms (Node). Compiling at start-up is a prototype convenience: Phase 3 should ship the compiled grammar.

Status labels: **measured** = produced by the scripts in this folder; **proposal** = design for later phases; **limitation** = known gap. Nothing here modifies the Word Lab game or any session.

## Acceptance criteria (measured)

| Criterion | Result |
|---|---|
| Every handover §5 probe yields its intended roles | 51/51 probes pass (B intended reading via one optional pin; E2 intended fragment offered, canonical is a genuine clause) |
| Generated derivations recognised and exactly recovered | 1600/1600 |
| Typed corruptions caught, with the right constraint named | see corruption table |
| p95 parse time ≤ 20 ms for ~40 tokens (Node) | 40-token realistic sentence 11.9 ms; generated 21–24 tokens p95 15.6 ms |
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
| B2 | handover 5B (unpinned: causal 'for' must be offered) | recognised | reject | `[Imp [VP [VP [VP [VP [VP fix [NP the fossil figure]] [PP in [NP the favorite filter]]] and [VP forget [NP the grid gadget]]] [PP in [NP the garage]]] [PP for [NP [NP staff] [PP on [NP stage sign steel soldier script output]]]]]]` |
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

1500 random derivations plus 100 targeted ones so that every family has at least 40 samples (seed 20261019); tiles drawn from the real BIP39 lexicon and the 47 helper candidates. "Recovered" means the parser's forest contains the exact generating tree. The v1.1 column shows how often the shipped parser rejects sentences containing the family.

| Construction family | Generated sentences | Recovered | v1.1 rejected |
|---|---:|---:|---:|
| adjective | 369 | 369 | 88% |
| adjective_modifier | 268 | 268 | 83% |
| bare_idiomatic_pp | 131 | 131 | 100% |
| bare_np | 740 | 740 | 97% |
| causal_for_coordination | 40 | 40 | 100% |
| clause | 546 | 546 | 98% |
| clause_coordination | 355 | 355 | 99% |
| complement_clause | 195 | 195 | 99% |
| copula | 49 | 49 | 98% |
| degree_modifier | 221 | 221 | 92% |
| determiner | 583 | 583 | 79% |
| ditransitive | 47 | 47 | 100% |
| do_support | 41 | 41 | 98% |
| focus_modifier | 249 | 249 | 100% |
| fused_head | 40 | 40 | 75% |
| imperative | 541 | 541 | 92% |
| imperative_declarative_coordination | 40 | 40 | 100% |
| infinitive | 117 | 117 | 99% |
| intransitive | 879 | 879 | 97% |
| lexical_copula | 173 | 173 | 95% |
| modal | 66 | 66 | 98% |
| modal_ellipsis | 331 | 331 | 76% |
| negation | 138 | 138 | 97% |
| nominal_utterance | 273 | 273 | 69% |
| noun_compound | 314 | 314 | 82% |
| noun_coordination | 659 | 659 | 96% |
| noun_head | 1121 | 1121 | 87% |
| np_premodifier | 432 | 432 | 82% |
| past_tense | 542 | 542 | 99% |
| perfect | 69 | 69 | 100% |
| postverbal_adverb | 52 | 52 | 98% |
| predicate_adjective | 117 | 117 | 97% |
| predicate_coordination | 315 | 315 | 100% |
| predicate_nominal | 52 | 52 | 98% |
| predicate_prepositional | 53 | 53 | 100% |
| prepositional_phrase | 437 | 437 | 96% |
| prepositional_verb | 84 | 84 | 85% |
| present_tense | 389 | 389 | 99% |
| preverbal_adverb | 53 | 53 | 98% |
| pronoun | 1109 | 1109 | 94% |
| question | 244 | 244 | 98% |
| relative_clause | 227 | 227 | 99% |
| subordinate_clause | 267 | 267 | 99% |
| verb_coordination | 523 | 523 | 99% |
| verb_object | 102 | 102 | 92% |

Overall v1.1 accepts 224/1600 of these generated sentences. Whether the remainder are v1.1 under-coverage or Phase 0 over-generation is exactly what the ERG batch adjudicates, by family.

## Typed corruptions (measured)

Each generated sentence is corrupted using its own tree, so each corruption knows what it attacks. "Accepted" corruptions are not automatically errors: a corrupted string can have a genuine alternative reading (collective nouns, mass nouns, *will* as a lexical verb, nominative pronouns in fragments). Accepted cases are in `reports/corruption_acceptances.jsonl` and are sent to ERG in aggregate.

| Corruption | n | Phase 0 accepted | Phase 0 conflict naming the attacked constraint | v1.1 accepted |
|---|---:|---:|---:|---:|
| adjacent swap | 1462 | 249 | — | 70/1462 |
| token delete | 1462 | 595 | — | 107/1462 |
| case | 1390 | 83 | 1099 | 45/1390 |
| det drop | 210 | 60 | 147 | 7/210 |
| article | 60 | 0 | 60 | 0/60 |
| object drop | 49 | 5 (verb kept as verb: 0) | 43 | 0/49 |
| agreement | 292 | 39 | 234 | 0/292 |

Defects found by this stream and fixed during Phase 0: case was checked on the first conjunct only (*me and he can run*); PP and relative postmodifiers dropped pronoun case (*they about industry* as an object); NP-level *but* (*the cat but the dog*); mixed *and/or* chains flattened with the wrong number; reflexive *myself* without an antecedent; over-broad collective-noun and bare-PP evidence rules (see lexical policy).

## Performance (measured, Node, desktop)

| Generated length | n | p50 ms | p95 ms | max ms |
|---|---:|---:|---:|---:|
| 1-8 tokens | 694 | 0.63 | 4.94 | 34.92 |
| 9-14 tokens | 392 | 2.24 | 9.9 | 38.08 |
| 15-20 tokens | 332 | 3.94 | 15.69 | 65.63 |
| 21-24 tokens | 182 | 5.18 | 15.6 | 55.94 |

Adversarial inputs (full API: 24-best readings, diverse root readings, choice points):

| Case | Tokens | State | Complete trees | ms |
|---|---:|---|---:|---:|
| 10-noun compound subject | 13 | recognised | 2 | 8.9 |
| 20-noun compound subject | 23 | recognised | 96 | 21.2 |
| 40-noun compound subject | 43 | recognised | 1152 | 17.4 |
| 50-noun compound subject | 53 | recognised | 2304 | 22.3 |
| 4 stacked PPs (attachment ambiguity) | 15 | recognised | 84 | 13.1 |
| 6 stacked PPs (attachment ambiguity) | 21 | recognised | 858 | 3.8 |
| 8 stacked PPs (attachment ambiguity) | 27 | recognised | 19448 | 7.3 |
| 10 stacked PPs (attachment ambiguity) | 33 | recognised | 705432 | 21.1 |
| 8 coordinated clauses | 39 | recognised | 1 | 3 |
| 16 coordinated clauses | 79 | recognised | 1 | 8.3 |
| 40-token realistic | 42 | recognised | 11616 | 11.9 |
| mixed subordination + coordination | 29 | recognised | 228 | 4 |

The largest single-sentence time in the generated run was 65.63 ms; such maxima are isolated (garbage collection / JIT warm-up), as the p95 column shows.

Phone figures are unmeasured; expect several times slower. The runtime lexicon is currently compiled at start-up from raw evidence; Phase 3 should ship a precompiled grammar and lexicon.

## Lexical policy (measured; details in `reports/lexical_policy.md`)

| Tier | What | Readings |
|---|---|---:|
| attested | mass readings (Wiktionary uncountable mark recorded but unused in v1.1) | 250 |
| attested | count readings for v1.1 mass nouns | 9 |
| attested | verb frames from WordNet frames / Wiktionary tags | 608 |
| attested | bare idiomatic PPs (189 preposition + noun pairs) | 189 |
| attested | degree modifiers *half*, *pretty* | 2 |
| derived | collective nouns with notional plural agreement | 45 |
| inferred | recorded, **not enabled** | 271 |

Two first-draft evidence rules were too permissive and were tightened before this report: collective nouns originally required only *some* OEWN `noun.group` sense (admitting *run*, *table*, *matrix*), and the bare-PP miner originally counted ordinary mass uses and complex prepositions (850 readings; now 189). Both stories are why evidence tiers are recorded on every reading.

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

Run `erg/Starpin_ERG_Phase0.ipynb` once on `erg/phase0_batch.jsonl` and return `erg_phase0_results.jsonl`; `node erg/analyse.js <results>` turns it into family-level and lexical-tier findings. No sentence-level adjudication is needed.
