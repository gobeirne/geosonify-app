# Phase 0 — ERG cross-check analysis

Results: `erg_results.jsonl` · batch `phase0_batch.jsonl` · 1349 items joined.

"Witnessed" means ERG's top-ranked derivation is an analysis type the game recognises (full clause, VP ellipsis with an overt subject, or NP fragment), uses no robust/generic lexical entry, and gives every word its own terminal. ERG's other fragment rules (e.g. subjectless finite VP), capitalised words read as proper names, and merged spans do not count.

## ERG analysis type of the top-ranked derivation

| ERG analysis type | Counts as witness | Items |
|---|---|---:|
| full_clause | yes | 386 |
| np_fragment | yes | 327 |
| no_parse | no | 308 |
| vp_ellipsis | yes | 136 |
| other_fragment | no | 105 |
| robust_lexical | no | 70 |
| inverted_ellipsis | no | 15 |
| merged_span | no | 2 |

## Probes

| Probe | Phase 0 | Expected | ERG |
|---|---|---|---|
| A1 | recognised | recognised | full_clause |
| A2 | recognised | recognised | full_clause |
| B1 | recognised | recognised | full_clause |
| B2 | recognised | recognised | full_clause |
| B3 | recognised | recognised | full_clause |
| C1 | recognised | recognised | full_clause |
| C2 | recognised | recognised | full_clause |
| D1 | recognised | recognised | merged_span |
| D2 | recognised | recognised | np_fragment |
| D3 | invalid_tiles | invalid_tiles | full_clause |
| D4 | recognised | recognised | full_clause |
| E1 | recognised | recognised | vp_ellipsis |
| E2 | recognised | recognised | np_fragment |
| E2b | recognised | recognised | np_fragment |
| E3 | recognised | recognised | no_parse |
| E4 | recognised | recognised | no_parse |
| E5 | recognised | recognised | full_clause |
| E6 | recognised | recognised | robust_lexical |
| E7 | recognised | recognised | np_fragment |
| E8 | recognised | recognised | full_clause |
| U1 | recognised | recognised | robust_lexical |
| U2 | recognised | recognised | no_parse |
| U3 | recognised | recognised | full_clause |
| F1 | recognised | recognised | np_fragment |
| F2 | recognised | recognised | np_fragment |
| F3 | recognised | recognised | full_clause |
| F4 | conflict | conflict | no_parse |
| F5 | recognised | recognised | full_clause |
| F6 | unrecognised | not_recognised | no_parse |
| P1 | recognised | recognised | full_clause |
| P2 | recognised | recognised | full_clause |
| P3 | recognised | recognised | np_fragment |
| P4 | recognised | recognised | full_clause |
| P5 | recognised | recognised | full_clause |
| P6 | recognised | recognised | np_fragment |
| N1 | conflict | conflict | no_parse |
| N2 | conflict | conflict | full_clause |
| N3 | conflict | conflict | full_clause |
| N4 | conflict | conflict | robust_lexical |
| N5 | conflict | conflict | np_fragment |
| N6 | conflict | conflict | robust_lexical |
| N7 | conflict | conflict | no_parse |
| N8 | unrecognised | not_recognised | merged_span |
| N9 | unrecognised | not_recognised | vp_ellipsis |
| N10 | conflict | conflict | no_parse |
| N11 | conflict | conflict | no_parse |
| S1 | recognised | recognised | no_parse |
| S2 | recognised | recognised | vp_ellipsis |
| S3 | recognised | recognised | full_clause |

## Generated positives (Phase 0 recognises all of them)

ERG witnesses 286/400 (71.5%). Families whose witness rate is ≥15 points below that, with n ≥ 15, are flagged as candidate over-generation in our grammar (or ERG coverage gaps) for rule-level review.

| Family | n | ERG parsed | ERG witnessed | Flag |
|---|---:|---:|---:|---|
| infinitive | 30 | 66.7% | 36.7% | **review** |
| lexical_copula | 31 | 80.6% | 48.4% | **review** |
| causal_for_coordination | 8 | 75.0% | 50.0% |  |
| do_support | 8 | 62.5% | 50.0% |  |
| verb_object | 27 | 74.1% | 51.9% | **review** |
| predicate_nominal | 15 | 53.3% | 53.3% | **review** |
| perfect | 20 | 70.0% | 55.0% | **review** |
| verb_coordination | 121 | 73.6% | 57.0% |  |
| prepositional_verb | 14 | 78.6% | 57.1% |  |
| postverbal_adverb | 7 | 85.7% | 57.1% |  |
| present_tense | 88 | 67.0% | 58.0% |  |
| imperative | 83 | 79.5% | 59.0% |  |
| negation | 42 | 71.4% | 59.5% |  |
| ditransitive | 10 | 70.0% | 60.0% |  |
| relative_clause | 59 | 71.2% | 61.0% |  |
| intransitive | 199 | 75.4% | 62.3% |  |
| bare_np | 188 | 75.5% | 63.8% |  |
| subordinate_clause | 50 | 74.0% | 64.0% |  |
| adjective | 105 | 80.0% | 64.8% |  |
| clause | 120 | 73.3% | 65.0% |  |
| predicate_coordination | 84 | 72.6% | 65.5% |  |
| past_tense | 119 | 73.9% | 65.5% |  |
| clause_coordination | 71 | 73.2% | 66.2% |  |
| question | 80 | 87.5% | 66.3% |  |
| preverbal_adverb | 9 | 88.9% | 66.7% |  |
| copula | 12 | 75.0% | 66.7% |  |
| bare_idiomatic_pp | 34 | 82.4% | 67.6% |  |
| noun_coordination | 173 | 78.6% | 68.2% |  |
| noun_head | 296 | 79.4% | 69.6% |  |
| prepositional_phrase | 109 | 79.8% | 69.7% |  |
| predicate_adjective | 43 | 79.1% | 69.8% |  |
| predicate_prepositional | 17 | 94.1% | 70.6% |  |
| pronoun | 283 | 79.2% | 70.7% |  |
| np_premodifier | 122 | 81.1% | 71.3% |  |
| adjective_modifier | 77 | 81.8% | 71.4% |  |
| noun_compound | 90 | 80.0% | 72.2% |  |
| modal | 22 | 72.7% | 72.7% |  |
| focus_modifier | 61 | 78.7% | 73.8% |  |
| degree_modifier | 56 | 82.1% | 75.0% |  |
| fused_head | 8 | 87.5% | 75.0% |  |
| determiner | 155 | 83.2% | 75.5% |  |
| complement_clause | 29 | 82.8% | 75.9% |  |
| nominal_utterance | 82 | 80.5% | 78.0% |  |
| imperative_declarative_coordination | 5 | 80.0% | 80.0% |  |
| modal_ellipsis | 91 | 87.9% | 85.7% |  |

## Corruptions

Accepted by Phase 0 but not witnessed by ERG = **over-acceptance candidates**. Rejected by Phase 0 but witnessed by ERG = **false-rejection candidates** (or ERG over-acceptance: ERG is known to accept, e.g., *a angry cat*).

| Type | Phase 0 accepted: n | …ERG witnessed | Phase 0 rejected: n | …ERG witnessed |
|---|---:|---:|---:|---:|
| adjacent_swap | 206 | 67.0% | 43 | 32.6% |
| agreement | 39 | 71.8% | 42 | 19.0% |
| article | 0 | — | 43 | 67.4% |
| case | 83 | 72.3% | 43 | 37.2% |
| det_drop | 60 | 71.7% | 43 | 44.2% |
| object_drop | 5 | 40.0% | 43 | 34.9% |
| token_delete | 207 | 69.1% | 43 | 34.9% |

### Over-acceptance candidates by construction family

186 candidates. A family is suspicious when its share among candidates clearly exceeds its share among all accepted corruptions.

| Family | Candidates | All accepted | Ratio |
|---|---:|---:|---:|
| ditransitive | 7 | 9 | 2.51 |
| perfect | 11 | 21 | 1.69 |
| predicate_nominal | 17 | 34 | 1.61 |
| complement_clause | 23 | 49 | 1.51 |
| infinitive | 8 | 18 | 1.43 |
| subordinate_clause | 29 | 69 | 1.36 |
| imperative | 53 | 127 | 1.35 |
| verb_object | 43 | 105 | 1.32 |
| preverbal_adverb | 9 | 22 | 1.32 |
| negation | 19 | 47 | 1.30 |
| prepositional_verb | 4 | 10 | 1.29 |
| predicate_coordination | 51 | 132 | 1.25 |
| present_tense | 68 | 176 | 1.25 |
| past_tense | 45 | 120 | 1.21 |
| question | 34 | 91 | 1.21 |
| predicate_prepositional | 8 | 22 | 1.17 |
| verb_coordination | 54 | 149 | 1.17 |
| bare_np | 135 | 378 | 1.15 |
| clause | 71 | 202 | 1.13 |
| do_support | 7 | 20 | 1.13 |
| intransitive | 99 | 284 | 1.12 |
| relative_clause | 33 | 95 | 1.12 |
| clause_coordination | 32 | 94 | 1.10 |
| pronoun | 136 | 405 | 1.08 |
| postverbal_adverb | 6 | 18 | 1.08 |
| noun_coordination | 85 | 256 | 1.07 |
| lexical_copula | 12 | 37 | 1.05 |
| predicate_adjective | 16 | 50 | 1.03 |
| noun_head | 161 | 505 | 1.03 |
| noun_compound | 70 | 222 | 1.02 |
| prepositional_phrase | 65 | 208 | 1.01 |
| adjective | 77 | 256 | 0.97 |
| imperative_declarative_coordination | 3 | 10 | 0.97 |
| bare_idiomatic_pp | 13 | 44 | 0.95 |
| np_premodifier | 96 | 325 | 0.95 |
| adjective_modifier | 65 | 224 | 0.94 |
| modal | 6 | 21 | 0.92 |
| nominal_utterance | 47 | 178 | 0.85 |
| focus_modifier | 19 | 76 | 0.81 |
| determiner | 60 | 241 | 0.80 |
| copula | 7 | 30 | 0.75 |
| modal_ellipsis | 20 | 88 | 0.73 |
| fused_head | 1 | 5 | 0.65 |
| degree_modifier | 10 | 54 | 0.60 |
| causal_for_coordination | 2 | 13 | 0.50 |

### Over-acceptance candidates by non-curated lexical reading

Readings added in Phase 0 (attested/derived) that the canonical analysis relied on. Repeated offenders are lexical-policy suspects.

| Reading | Candidates |
|---|---:|
| army:N(derived) | 18 |
| axis:N(derived) | 16 |
| enemy:N(derived) | 14 |
| shed:V(attested) | 13 |
| elite:N(attested) | 8 |
| industry:N(attested) | 6 |
| make:V(attested) | 4 |
| hour:N(attested) | 4 |
| describe:V(attested) | 4 |
| school:N(attested) | 4 |
| tribe:N(derived) | 4 |
| orbit:N(attested) | 3 |
| home:NIdiom(attested) | 3 |
| blind:N(derived) | 3 |
| account:N(attested) | 3 |
| guard:NIdiom(attested) | 3 |
| course:NIdiom(attested) | 3 |
| industry:N(derived) | 3 |
| will:N(attested) | 3 |
| iron:N(attested) | 3 |
| artwork:N(attested) | 3 |
| clock:N(attested) | 3 |
| find:V(attested) | 3 |
| rally:N(derived) | 2 |
| quit:V(attested) | 2 |
| force:V(attested) | 2 |
| gas:V(attested) | 2 |
| toast:N(attested) | 2 |
| name:V(attested) | 2 |
| bone:V(attested) | 2 |
| guard:V(attested) | 2 |
| hurt:N(attested) | 2 |
| nation:N(derived) | 2 |
| neglect:N(attested) | 2 |
| fruit:N(attested) | 2 |
| slight:V(attested) | 2 |
| confirm:V(attested) | 2 |
| oblige:V(attested) | 2 |
| forum:N(derived) | 2 |
| stuff:V(attested) | 2 |

### Why ERG analyses sentences Phase 0 rejects

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

### Samples (for rule-level triage, not for sentence adjudication)

Over-acceptance candidates:

- [token_delete] Was you or social output device jazz own? — ERG: no_parse
- [case] Just he above either or you or orbit for rally that recycle or rose. — ERG: other_fragment
- [object_drop] Powder and he or she split and spread. — ERG: robust_lexical
- [token_delete] You anger. — ERG: no_parse
- [adjacent_swap] Were shrimp excess? — ERG: other_fragment
- [agreement] Elite or you was barely sad and quit to humor or reform or force but dice. — ERG: robust_lexical
- [agreement] You that gas toast or that hurt and did not manage to betray but is not industry and burst or cry must not. — ERG: no_parse
- [object_drop] Agree to spice and treat and appear. — ERG: other_fragment
- [adjacent_swap] Almost output wrong. — ERG: other_fragment
- [token_delete] We name. — ERG: no_parse
- [det_drop] You before output or many team toward home. — ERG: no_parse
- [object_drop] Can some fit comic or only glass or she or she by race make to blind? — ERG: other_fragment
- [case] Myself into you about account that will not bone but guard that have hidden but crumble or school that were not vital. — ERG: no_parse
- [adjacent_swap] Will the alarm half simple bulk ostrich output six elite. — ERG: inverted_ellipsis
- [case] Just he. — ERG: other_fragment

False-rejection candidates:

- [case] Before nothing mixed range because he bid until all open but they pledge where he hurt but myself left. — ours: conflict (case)
- [token_delete] Test curious and we anchor turkey shed while they hurt or ivory rose. — ours: conflict (det_noun)
- [article] A arctic iron. — ours: conflict (article)
- [det_drop] Soul elbow special must. — ours: conflict (det_noun)
- [adjacent_swap] All can armor. — ours: conflict (verb_frame)
- [token_delete] We while we quit before she cost but we and he shed and guide. — ours: unrecognised
- [adjacent_swap] Laugh but flock or wrestle when she bid but he cost and elite split for we are you must and sight. — ours: unrecognised
- [token_delete] Expect to but cake but radio but point industry and one you that hurt. — ours: unrecognised
- [article] Only an barely indoor armor abuse issue or she. — ours: conflict (article)
- [adjacent_swap] Some such effort or fat all velvet labor or rally energy can. — ours: unrecognised
- [object_drop] Task. — ours: conflict (verb_frame)
- [article] An glimpse. — ours: conflict (article)
- [det_drop] Almost nasty siren alarm coconut must. — ours: conflict (det_noun)
- [object_drop] Whale on major action apple or rate regular or saddle. — ours: conflict (verb_frame)
- [agreement] Lunch for we that know and cost and quit across odor or blind below neither is about the reason. — ours: conflict (agreement)
