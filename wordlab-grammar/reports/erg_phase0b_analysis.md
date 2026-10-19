# Phase 0 — ERG cross-check analysis

Results: `erg_phase0b_results.jsonl.gz` · batch `phase0b_batch.jsonl` · 1349 items joined.

"Witnessed" means ERG's top-ranked derivation is an analysis type the game recognises (full clause, VP ellipsis with an overt subject, or NP fragment), uses no robust/generic lexical entry, and gives every word its own terminal. ERG's other fragment rules (e.g. subjectless finite VP), capitalised words read as proper names, and merged spans do not count.

## ERG analysis type of the top-ranked derivation

| ERG analysis type | Counts as witness | Items |
|---|---|---:|
| full_clause | yes | 583 |
| np_fragment | yes | 269 |
| vp_ellipsis | yes | 198 |
| no_parse | no | 188 |
| other_fragment | no | 69 |
| robust_lexical | no | 27 |
| inverted_ellipsis | no | 12 |
| merged_span | no | 3 |

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
| D1 | recognised | recognised | full_clause |
| D2 | recognised | recognised | full_clause |
| D3 | invalid_tiles | invalid_tiles | full_clause |
| D4 | recognised | recognised | full_clause |
| E1 | recognised | recognised | vp_ellipsis |
| E2 | recognised | recognised | np_fragment |
| E2b | recognised | recognised | np_fragment |
| E3 | recognised | recognised | no_parse |
| E4 | recognised | recognised | no_parse |
| E5 | recognised | recognised | full_clause |
| E6 | recognised | recognised | robust_lexical |
| E7 | recognised | recognised | full_clause |
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
| P3 | recognised | recognised | full_clause |
| P4 | recognised | recognised | full_clause |
| P5 | recognised | recognised | full_clause |
| P6 | recognised | recognised | np_fragment |
| N1 | conflict | conflict | no_parse |
| N2 | conflict | conflict | full_clause |
| N3 | conflict | conflict | full_clause |
| N4 | conflict | conflict | np_fragment |
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

ERG witnesses 349/400 (87.3%). Families whose witness rate is ≥15 points below that, with n ≥ 15, are flagged as candidate over-generation in our grammar (or ERG coverage gaps) for rule-level review.

| Family | n | ERG parsed | ERG witnessed | Flag |
|---|---:|---:|---:|---|
| postverbal_adverb | 11 | 90.9% | 54.5% |  |
| imperative_declarative_coordination | 5 | 80.0% | 60.0% |  |
| infinitive | 20 | 75.0% | 70.0% | **review** |
| subordinate_clause | 57 | 86.0% | 70.2% | **review** |
| verb_coordination | 110 | 83.6% | 71.8% | **review** |
| clause_coordination | 70 | 87.1% | 74.3% |  |
| lexical_copula | 36 | 83.3% | 75.0% |  |
| clause | 113 | 85.8% | 75.2% |  |
| imperative | 78 | 89.7% | 76.9% |  |
| modal | 18 | 77.8% | 77.8% |  |
| present_tense | 99 | 87.9% | 78.8% |  |
| intransitive | 184 | 88.0% | 78.8% |  |
| preverbal_adverb | 10 | 100.0% | 80.0% |  |
| causal_for_coordination | 5 | 80.0% | 80.0% |  |
| past_tense | 116 | 90.5% | 80.2% |  |
| complement_clause | 41 | 90.2% | 82.9% |  |
| degree_modifier | 61 | 88.5% | 83.6% |  |
| negation | 32 | 84.4% | 84.4% |  |
| pronoun | 280 | 90.7% | 84.6% |  |
| focus_modifier | 73 | 91.8% | 84.9% |  |
| question | 81 | 90.1% | 85.2% |  |
| copula | 14 | 92.9% | 85.7% |  |
| bare_np | 175 | 90.9% | 86.3% |  |
| predicate_adjective | 39 | 92.3% | 87.2% |  |
| adjective | 122 | 94.3% | 88.5% |  |
| verb_object | 18 | 88.9% | 88.9% |  |
| prepositional_verb | 9 | 88.9% | 88.9% |  |
| do_support | 9 | 88.9% | 88.9% |  |
| np_premodifier | 282 | 92.6% | 89.0% |  |
| noun_head | 282 | 92.6% | 89.0% |  |
| predicate_coordination | 83 | 95.2% | 89.2% |  |
| noun_coordination | 160 | 94.4% | 90.0% |  |
| relative_clause | 73 | 97.3% | 90.4% |  |
| adjective_modifier | 97 | 94.8% | 90.7% |  |
| bare_idiomatic_pp | 36 | 94.4% | 91.7% |  |
| prepositional_phrase | 119 | 95.0% | 92.4% |  |
| predicate_prepositional | 14 | 92.9% | 92.9% |  |
| determiner | 170 | 95.3% | 92.9% |  |
| nominal_utterance | 88 | 96.6% | 93.2% |  |
| noun_compound | 91 | 97.8% | 95.6% |  |
| modal_ellipsis | 99 | 97.0% | 96.0% |  |
| predicate_nominal | 16 | 100.0% | 100.0% |  |
| ditransitive | 9 | 100.0% | 100.0% |  |
| fused_head | 6 | 100.0% | 100.0% |  |
| perfect | 17 | 100.0% | 100.0% |  |

## Corruptions

Accepted by Phase 0 but not witnessed by ERG = **over-acceptance candidates**. Rejected by Phase 0 but witnessed by ERG = **false-rejection candidates** (or ERG over-acceptance: ERG is known to accept, e.g., *a angry cat*).

| Type | Phase 0 accepted: n | …ERG witnessed | Phase 0 rejected: n | …ERG witnessed |
|---|---:|---:|---:|---:|
| adjacent_swap | 211 | 76.3% | 43 | 48.8% |
| agreement | 45 | 80.0% | 43 | 41.9% |
| article | 0 | — | 43 | 95.3% |
| case | 68 | 77.9% | 43 | 65.1% |
| det_drop | 62 | 74.2% | 43 | 53.5% |
| object_drop | 3 | 100.0% | 42 | 69.0% |
| token_delete | 211 | 88.2% | 43 | 48.8% |

### Over-acceptance candidates by construction family

115 candidates. A family is suspicious when its share among candidates clearly exceeds its share among all accepted corruptions.

| Family | Candidates | All accepted | Ratio |
|---|---:|---:|---:|
| imperative_declarative_coordination | 2 | 4 | 2.61 |
| infinitive | 6 | 15 | 2.09 |
| bare_idiomatic_pp | 14 | 44 | 1.66 |
| focus_modifier | 27 | 87 | 1.62 |
| lexical_copula | 9 | 29 | 1.62 |
| verb_coordination | 49 | 162 | 1.58 |
| do_support | 7 | 25 | 1.46 |
| prepositional_verb | 3 | 11 | 1.42 |
| postverbal_adverb | 7 | 26 | 1.40 |
| negation | 10 | 39 | 1.34 |
| complement_clause | 13 | 51 | 1.33 |
| prepositional_phrase | 48 | 194 | 1.29 |
| relative_clause | 24 | 101 | 1.24 |
| subordinate_clause | 17 | 72 | 1.23 |
| question | 29 | 123 | 1.23 |
| modal | 4 | 17 | 1.23 |
| past_tense | 29 | 125 | 1.21 |
| degree_modifier | 17 | 76 | 1.17 |
| pronoun | 88 | 396 | 1.16 |
| imperative | 27 | 122 | 1.15 |
| present_tense | 39 | 178 | 1.14 |
| intransitive | 58 | 269 | 1.12 |
| predicate_coordination | 25 | 118 | 1.11 |
| ditransitive | 4 | 19 | 1.10 |
| clause | 40 | 191 | 1.09 |
| verb_object | 22 | 106 | 1.08 |
| clause_coordination | 18 | 89 | 1.06 |
| predicate_adjective | 11 | 55 | 1.04 |
| noun_coordination | 48 | 248 | 1.01 |
| predicate_nominal | 8 | 42 | 0.99 |
| noun_head | 96 | 505 | 0.99 |
| np_premodifier | 96 | 505 | 0.99 |
| adjective_modifier | 48 | 254 | 0.99 |
| adjective | 52 | 276 | 0.98 |
| bare_np | 69 | 372 | 0.97 |
| preverbal_adverb | 5 | 27 | 0.97 |
| nominal_utterance | 31 | 169 | 0.96 |
| predicate_prepositional | 5 | 28 | 0.93 |
| noun_compound | 40 | 231 | 0.90 |
| perfect | 3 | 18 | 0.87 |
| determiner | 39 | 239 | 0.85 |
| causal_for_coordination | 1 | 7 | 0.75 |
| modal_ellipsis | 10 | 72 | 0.72 |
| copula | 4 | 31 | 0.67 |
| fused_head | 1 | 11 | 0.47 |

### Over-acceptance candidates by non-curated lexical reading

Readings added in Phase 0 (attested/derived) that the canonical analysis relied on. Repeated offenders are lexical-policy suspects.

| Reading | Candidates |
|---|---:|
| shed:V(attested) | 7 |
| upset:N(attested) | 6 |
| staff:N(attested) | 4 |
| oyster:N(attested) | 4 |
| april:NIdiom(attested) | 3 |
| top:V(attested) | 2 |
| elite:N(attested) | 2 |
| stool:N(attested) | 2 |
| erosion:N(attested) | 2 |
| account:N(attested) | 2 |
| face:V(attested) | 2 |
| chair:V(attested) | 2 |
| swamp:V(attested) | 2 |
| artwork:N(attested) | 2 |
| help:N(attested) | 2 |
| toast:N(attested) | 2 |
| glass:V(attested) | 2 |
| build:V(attested) | 2 |
| conduct:N(attested) | 2 |
| odor:N(attested) | 2 |
| film:N(attested) | 2 |
| will:N(attested) | 1 |
| order:N(attested) | 1 |
| fish:N(attested) | 1 |
| quality:N(attested) | 1 |
| divorce:NIdiom(attested) | 1 |
| base:V(attested) | 1 |
| town:NIdiom(attested) | 1 |
| uniform:N(attested) | 1 |
| race:NIdiom(attested) | 1 |
| worry:NIdiom(attested) | 1 |
| assault:V(attested) | 1 |
| base:NIdiom(attested) | 1 |
| risk:NIdiom(attested) | 1 |
| scrap:V(attested) | 1 |
| exercise:N(attested) | 1 |
| orange:NIdiom(attested) | 1 |
| alarm:N(attested) | 1 |
| success:N(attested) | 1 |
| flower:N(attested) | 1 |

### Why ERG analyses sentences Phase 0 rejects

| Cause | Items |
|---|---:|
| ERG count→mass coercion ("grinding") | 99 |
| ERG verb object omission (optional complement) | 95 |
| ERG does not check a/an | 41 |
| ERG does not check reflexive binding | 28 |
| ellipsis after has/do/be (Phase 0: modals only) | 16 |
| other | 14 |
| ERG agreement with or-coordination | 14 |
| ERG bare N-bar fragment (headline style) | 12 |
| lexical do/will (gold do is auxiliary-only) | 2 |

### Samples (for rule-level triage, not for sentence adjudication)

Over-acceptance candidates:

- [case] Myself or you on april of course will. — ERG: no_parse
- [det_drop] Just we that have mixed or shed and ladder or blossom but multiply but castle but tumble upon order vote. — ERG: no_parse
- [agreement] Is axis rather dynamic dice electric pill fish quality? — ERG: robust_lexical
- [adjacent_swap] Were any oil future electric artwork scissors almost fragile? — ERG: other_fragment
- [det_drop] Lunar upset or you must. — ERG: no_parse
- [token_delete] Choose hand much art oxygen and all. — ERG: no_parse
- [agreement] Were only he for divorce around you off series and media that bid inside all or art or one? — ERG: other_fragment
- [adjacent_swap] While lyrics split you but sleep where she mixed and fat left join or point or top. — ERG: other_fragment
- [case] Just he among some club toward enough acid police. — ERG: other_fragment
- [agreement] Does any half unable annual elite grow oval but slam between you? — ERG: no_parse
- [token_delete] Economy or that almost east oxygen wet age or you that exit and draw that must not whale and rice or like will. — ERG: robust_lexical
- [case] Any still alien armor deer or myself that base that must not shift until you across someone or order. — ERG: no_parse
- [adjacent_swap] Outer drastic pretty antique must art. — ERG: no_parse
- [case] He. — ERG: no_parse
- [adjacent_swap] Was only she on elite you? — ERG: no_parse

False-rejection candidates:

- [adjacent_swap] Were you into rather ethics hollow attitude staff by surprise aware. — ours: unrecognised
- [det_drop] Almost obscure idle address or spice or the energy or an auto from you that left but are not sorry can. — ours: conflict (det_noun)
- [article] Will junk flavor or an swift fuel but stay worth. — ours: conflict (article)
- [case] Rally all when all spread but we burst and all or you cost or myself mixed. — ours: conflict (case)
- [det_drop] Will face or she that was not barely junior already right or live but report that all burst but she quit but glide. — ours: conflict (det_noun)
- [article] Only just an census or people or you will. — ours: conflict (article)
- [token_delete] Grow almost slender and he and series the rich did camp and shrug but cave. — ours: unrecognised
- [case] Only myself that mixed but curve that do not craft or ball inside either or staff and all and neither above you will. — ours: conflict (case)
- [article] An barely obvious bid must not. — ours: conflict (article)
- [agreement] All is you and have thought he mixed. — ours: conflict (agreement)
- [adjacent_swap] Or another she that rose or just energy or we did not pluck and cluster but left and hurt or spread. — ours: unrecognised
- [det_drop] Inspire you or crush but essay but return for zone valid rack did not guard but design. — ours: conflict (det_noun)
- [article] Will an rapid icon assume that if he quit or she shed they burst and lyrics diet. — ours: conflict (article)
- [object_drop] Predict around you that are elegant. — ours: conflict (verb_frame)
- [adjacent_swap] If they or we do crash but canoe or we shadow before you rose want to claim or attitude snow or frost from error. — ours: conflict (det_noun)
