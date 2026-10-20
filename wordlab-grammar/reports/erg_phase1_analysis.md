# Phase 0 — ERG cross-check analysis

Results: `erg_phase1_results.jsonl.gz` · batch `phase1_batch.jsonl` · 1357 items joined.

"Witnessed" means ERG's top-ranked derivation is an analysis type the game recognises (full clause, VP ellipsis with an overt subject, or NP fragment), uses no robust/generic lexical entry, and gives every word its own terminal. ERG's other fragment rules (e.g. subjectless finite VP), capitalised words read as proper names, and merged spans do not count.

## ERG analysis type of the top-ranked derivation

| ERG analysis type | Counts as witness | Items |
|---|---|---:|
| full_clause | yes | 409 |
| vp_ellipsis | yes | 331 |
| np_fragment | yes | 291 |
| no_parse | no | 210 |
| other_fragment | no | 62 |
| robust_lexical | no | 28 |
| inverted_ellipsis | no | 22 |
| merged_span | no | 4 |

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
| N9 | recognised | recognised | vp_ellipsis |
| N10 | conflict | conflict | no_parse |
| N11 | conflict | conflict | no_parse |
| L1 | recognised | recognised | vp_ellipsis |
| L2 | recognised | recognised | vp_ellipsis |
| L3 | recognised | recognised | full_clause |
| L4 | conflict | conflict | no_parse |
| L5 | recognised | recognised | full_clause |
| L6 | conflict | conflict | no_parse |
| L7 | recognised | recognised | full_clause |
| L8 | recognised | recognised | full_clause |
| S1 | recognised | recognised | no_parse |
| S2 | recognised | recognised | vp_ellipsis |
| S3 | recognised | recognised | full_clause |

## Generated positives (Phase 0 recognises all of them)

ERG witnesses 335/400 (83.8%). Families whose witness rate is ≥15 points below that, with n ≥ 15, are flagged as candidate over-generation in our grammar (or ERG coverage gaps) for rule-level review.

| Family | n | ERG parsed | ERG witnessed | Flag |
|---|---:|---:|---:|---|
| postverbal_adverb | 10 | 70.0% | 60.0% |  |
| negation | 34 | 76.5% | 67.6% | **review** |
| modal | 16 | 75.0% | 68.8% |  |
| lexical_copula | 29 | 75.9% | 69.0% |  |
| do_support | 10 | 80.0% | 70.0% |  |
| preverbal_adverb | 14 | 71.4% | 71.4% |  |
| infinitive | 30 | 90.0% | 73.3% |  |
| imperative_declarative_coordination | 4 | 75.0% | 75.0% |  |
| verb_coordination | 112 | 83.9% | 75.9% |  |
| predicate_adjective | 34 | 82.4% | 76.5% |  |
| question | 81 | 90.1% | 77.8% |  |
| fused_head | 9 | 88.9% | 77.8% |  |
| perfect | 19 | 89.5% | 78.9% |  |
| bare_idiomatic_pp | 39 | 92.3% | 79.5% |  |
| intransitive | 201 | 88.1% | 79.6% |  |
| focus_modifier | 65 | 86.2% | 80.0% |  |
| noun_coordination | 166 | 88.6% | 81.3% |  |
| predicate_coordination | 125 | 87.2% | 81.6% |  |
| prepositional_phrase | 104 | 89.4% | 81.7% |  |
| degree_modifier | 55 | 83.6% | 81.8% |  |
| pronoun | 305 | 89.2% | 82.6% |  |
| bare_np | 188 | 88.8% | 83.0% |  |
| past_tense | 86 | 88.4% | 83.7% |  |
| imperative | 80 | 88.8% | 83.8% |  |
| relative_clause | 78 | 92.3% | 84.6% |  |
| predicate_nominal | 13 | 92.3% | 84.6% |  |
| adjective | 98 | 89.8% | 84.7% |  |
| verb_object | 21 | 90.5% | 85.7% |  |
| clause | 198 | 88.9% | 85.9% |  |
| vp_ellipsis | 222 | 90.5% | 86.0% |  |
| np_premodifier | 280 | 92.1% | 86.4% |  |
| noun_head | 280 | 92.1% | 86.4% |  |
| nominal_utterance | 91 | 93.4% | 87.9% |  |
| complement_clause | 50 | 92.0% | 88.0% |  |
| present_tense | 52 | 94.2% | 88.5% |  |
| prepositional_verb | 20 | 95.0% | 90.0% |  |
| adjective_modifier | 82 | 92.7% | 90.2% |  |
| clause_coordination | 104 | 93.3% | 90.4% |  |
| determiner | 142 | 95.8% | 90.8% |  |
| subordinate_clause | 79 | 94.9% | 92.4% |  |
| noun_compound | 93 | 94.6% | 92.5% |  |
| copula | 17 | 94.1% | 94.1% |  |
| predicate_prepositional | 18 | 100.0% | 94.4% |  |
| ditransitive | 9 | 100.0% | 100.0% |  |
| causal_for_coordination | 8 | 100.0% | 100.0% |  |

## Corruptions

Accepted by Phase 0 but not witnessed by ERG = **over-acceptance candidates**. Rejected by Phase 0 but witnessed by ERG = **false-rejection candidates** (or ERG over-acceptance: ERG is known to accept, e.g., *a angry cat*).

| Type | Phase 0 accepted: n | …ERG witnessed | Phase 0 rejected: n | …ERG witnessed |
|---|---:|---:|---:|---:|
| adjacent_swap | 180 | 82.8% | 47 | 44.7% |
| agreement | 78 | 74.4% | 47 | 46.8% |
| article | 0 | — | 36 | 86.1% |
| case | 109 | 86.2% | 47 | 53.2% |
| det_drop | 44 | 77.3% | 47 | 46.8% |
| object_drop | 9 | 77.8% | 29 | 65.5% |
| token_delete | 180 | 88.9% | 47 | 27.7% |

### Over-acceptance candidates by construction family

98 candidates. A family is suspicious when its share among candidates clearly exceeds its share among all accepted corruptions.

| Family | Candidates | All accepted | Ratio |
|---|---:|---:|---:|
| imperative_declarative_coordination | 3 | 7 | 2.62 |
| preverbal_adverb | 7 | 24 | 1.79 |
| fused_head | 3 | 11 | 1.67 |
| postverbal_adverb | 4 | 15 | 1.63 |
| lexical_copula | 10 | 39 | 1.57 |
| do_support | 4 | 16 | 1.53 |
| negation | 10 | 41 | 1.49 |
| subordinate_clause | 13 | 59 | 1.35 |
| predicate_prepositional | 10 | 46 | 1.33 |
| clause_coordination | 16 | 74 | 1.32 |
| verb_coordination | 20 | 94 | 1.30 |
| intransitive | 47 | 228 | 1.26 |
| perfect | 2 | 10 | 1.22 |
| bare_idiomatic_pp | 13 | 66 | 1.21 |
| modal | 4 | 21 | 1.17 |
| predicate_coordination | 27 | 142 | 1.16 |
| question | 27 | 142 | 1.16 |
| focus_modifier | 15 | 79 | 1.16 |
| causal_for_coordination | 3 | 16 | 1.15 |
| prepositional_phrase | 38 | 203 | 1.15 |
| present_tense | 25 | 136 | 1.13 |
| clause | 34 | 188 | 1.11 |
| degree_modifier | 17 | 94 | 1.11 |
| adjective_modifier | 42 | 246 | 1.05 |
| adjective | 46 | 270 | 1.04 |
| pronoun | 68 | 403 | 1.03 |
| noun_head | 80 | 482 | 1.02 |
| np_premodifier | 80 | 482 | 1.02 |
| bare_np | 57 | 349 | 1.00 |
| noun_compound | 34 | 212 | 0.98 |
| relative_clause | 21 | 131 | 0.98 |
| determiner | 39 | 246 | 0.97 |
| vp_ellipsis | 31 | 197 | 0.96 |
| imperative | 19 | 124 | 0.94 |
| noun_coordination | 38 | 249 | 0.93 |
| predicate_nominal | 9 | 63 | 0.87 |
| predicate_adjective | 8 | 56 | 0.87 |
| nominal_utterance | 30 | 211 | 0.87 |
| copula | 6 | 49 | 0.75 |
| verb_object | 11 | 91 | 0.74 |
| past_tense | 7 | 60 | 0.71 |
| complement_clause | 5 | 47 | 0.65 |
| ditransitive | 1 | 11 | 0.56 |
| infinitive | 1 | 20 | 0.31 |

### Over-acceptance candidates by non-curated lexical reading

Readings added in Phase 0 (attested/derived) that the canonical analysis relied on. Repeated offenders are lexical-policy suspects.

| Reading | Candidates |
|---|---:|
| have:V(attested) | 7 |
| staff:N(attested) | 4 |
| elite:N(attested) | 3 |
| fish:N(attested) | 3 |
| pretty:AdvDeg(attested) | 2 |
| emotion:N(attested) | 2 |
| seed:N(attested) | 2 |
| upset:N(attested) | 2 |
| course:NIdiom(attested) | 2 |
| account:N(attested) | 2 |
| will:V(attested) | 2 |
| abuse:N(attested) | 2 |
| home:NIdiom(attested) | 2 |
| crop:V(attested) | 2 |
| field:V(attested) | 2 |
| name:NIdiom(attested) | 2 |
| battle:NIdiom(attested) | 2 |
| anchor:NIdiom(attested) | 2 |
| army:N(derived) | 2 |
| access:N(attested) | 2 |
| book:V(attested) | 1 |
| half:AdvDeg(attested) | 1 |
| arm:V(attested) | 1 |
| inspire:V(attested) | 1 |
| web:N(attested) | 1 |
| output:N(attested) | 1 |
| rent:N(attested) | 1 |
| entry:N(attested) | 1 |
| injury:N(attested) | 1 |
| wire:N(attested) | 1 |
| impact:N(attested) | 1 |
| snack:N(attested) | 1 |
| live:V(attested) | 1 |
| name:V(attested) | 1 |
| pitch:N(attested) | 1 |
| bottom:NIdiom(attested) | 1 |
| evoke:V(attested) | 1 |
| flag:V(attested) | 1 |
| hour:N(attested) | 1 |
| throw:V(attested) | 1 |

### Why ERG analyses sentences Phase 0 rejects

| Cause | Items |
|---|---:|
| ERG count→mass coercion ("grinding") | 96 |
| ERG verb object omission (optional complement) | 58 |
| ERG does not check a/an | 31 |
| ERG does not check reflexive binding | 25 |
| ERG agreement with or-coordination | 20 |
| lexical do/will (gold do is auxiliary-only) | 16 |
| ERG bare N-bar fragment (headline style) | 13 |
| other | 11 |

### Samples (for rule-level triage, not for sentence adjudication)

Over-acceptance candidates:

- [adjacent_swap] She did book. — ERG: no_parse
- [object_drop] The almost afraid online lyrics and the alpha nation and he that has or has elite and you and he or this. — ERG: no_parse
- [token_delete] Three spice affair barely high angry escape people feel half top. — ERG: other_fragment
- [det_drop] Head energy did not arm or inspire but he that did or was can since scissors have or cost. — ERG: robust_lexical
- [adjacent_swap] Just this aerobic exchange universe or the wise. — ERG: robust_lexical
- [case] He inside artwork staff. — ERG: no_parse
- [token_delete] We embark. — ERG: robust_lexical
- [det_drop] Is acid web or you that are above this vague? — ERG: no_parse
- [object_drop] The almost afraid online lyrics and the alpha nation and he that has this or has and you and he or this. — ERG: no_parse
- [token_delete] Is only she that burst or did or she or he that is not acid or can or aerobic output pretty electric? — ERG: robust_lexical
- [agreement] Someone or myself in armor that is and is below this vapor by emotion and advice or you or all that are not same. — ERG: robust_lexical
- [adjacent_swap] The blind have thought she and burst rent mixed and she is. — ERG: no_parse
- [agreement] Was that or someone or entry outside injury or wire and you behind neither from one almost future? — ERG: no_parse
- [adjacent_swap] Bind or cross and power must but he does while impact can drop and has. — ERG: no_parse
- [token_delete] You are not just seed in upset or aim. — ERG: no_parse

False-rejection candidates:

- [case] Do just myself or we and water off any alien deer choose this rather only lemon very usual later earth or appear almost patient. — ours: conflict (case+case)
- [adjacent_swap] Myself among any army inside or you action. — ours: unrecognised
- [article] Did only you or an mosquito obscure arch sound obvious for battle but whale on that mad butter. — ours: conflict (article)
- [det_drop] The rich that did print affair and some cloth. — ours: conflict (det_noun)
- [object_drop] Crew. — ours: conflict (verb_frame)
- [agreement] Whale on enough oil lyrics and she can because people does or we were and soup was and you are. — ours: conflict (agreement)
- [case] Only just myself into battle or you or alcohol or he. — ours: conflict (case)
- [adjacent_swap] Was an hour upset barely novel age olive can that almost master. — ours: unrecognised
- [token_delete] He was but you were when he did or grass was or energy does since denial. — ours: unrecognised
- [article] A oil or aware input or myself that have and did. — ours: conflict (article)
- [object_drop] Bridge or steel. — ours: conflict (verb_frame)
- [agreement] Whale on enough oil lyrics and she can because people do or we were and soup were and you are. — ours: conflict (agreement)
- [token_delete] Fix ball or question before all or you that did but can. — ours: conflict (det_noun)
- [article] Were unfair pretty civil almost express special evidence staff an barrel. — ours: conflict (article)
- [agreement] Breeze but soldier since lyrics or front and gossip and plug behind you that are that is and did. — ours: conflict (det_noun)
