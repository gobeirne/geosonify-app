'use strict';
/*
 * Starpin Word Lab — Phase 0 declarative grammar.
 *
 * Each rule is data: LHS/RHS categories with feature constraints, an optional
 * `when` predicate whose checks are NAMED (so they can be relaxed for
 * diagnosis), a construction family `fam`, a head child, typed dependency
 * relations `deps`, a display label and a small preference cost.
 *
 * Preference costs NEVER consult any game score. They encode only: prefer a
 * full clause to a fragment; prefer a common reading to a marked construction.
 *
 * References are to Huddleston & Pullum (2002), The Cambridge Grammar of the
 * English Language (CGEL), at chapter level.
 */

// Time adverbs (CGEL ch. 8): 'day' today/tonight, 'fday' tomorrow (future
// only), 'later', 'gen' now/soon/then/once; 'no' = not a time-locating adverb.
const TM_LEX = ['no', 'day', 'fday', 'later', 'gen'];
const CATS = {
  // preterminals
  N: {num: ['sg', 'pl'], cnt: ['count', 'mass', 'coll'], on: ['v', 'c', 'x']},
  NIdiom: {p: 'PREP'}, PropN: {}, Adj: {u: ['attr', 'pred'], on: ['v', 'c', 'x']}, AdjFused: {},
  AdvDeg: {pa: ['both', 'pred'], on: ['v', 'c', 'x']}, AdvPre: {tm: ['no', 'y']}, AdvPost: {tm: TM_LEX}, AdvFocus: {}, AdvFront: {tm: TM_LEX}, AdvLink: {},
  V: {fr: ['intr', 'tr', 'ditr', 'cop', 'toinf', 'clause'], vf: ['base', 'past', 'ppart', 'pres3']},
  VPrep: {p: 'PREP', vf: ['base', 'past', 'ppart', 'pres3']},
  Det: {d: ['the', 'any', 'a', 'an', 'sg_count', 'pl', 'pl_mass', 'mass', 'dem_sg']},
  Pron: {num: ['sg', 'pl'], per: ['1', '2', '3'], case: ['nom', 'acc', 'any', 'refl']},
  P: {p: 'PREP'}, Modal: {}, Cop: {ct: ['is', 'are', 'was', 'were']}, Be: {}, Do: {dt: ['does', 'do', 'did']},
  HaveAux: {ht: ['has', 'have']}, Not: {}, To: {}, Conj: {cj: ['and', 'or', 'but']}, ForCoord: {},
  Sub: {}, Comp: {}, Rel: {},
  // phrasal
  Nom: {num: ['sg', 'pl'], cnt: ['count', 'mass', 'coll'], on: ['v', 'c', 'x']},
  NomN: {num: ['sg', 'pl'], cnt: ['count', 'mass', 'coll'], on: ['v', 'c', 'x']},
  AdjP: {u: ['attr', 'pred'], on: ['v', 'c', 'x']},
  NP: {num: ['sg', 'pl', 'mix'], per: ['1', '2', '3'], case: ['nom', 'acc', 'any', 'refl'], co: ['n', 'and', 'or']},
  NPx: {num: ['sg', 'pl', 'mix'], per: ['1', '2', '3'], case: ['nom', 'acc', 'any', 'refl'], co: ['and', 'or']},
  NPTail: {num: ['sg', 'pl', 'mix'], cj: ['and', 'or'], case: ['nom', 'acc', 'any', 'refl']},
  PP: {}, Pred: {tm: ['n', 'y', 'f'], pk: ['a', 'n', 'p']},
  VP: {vf: ['base', 'past', 'ppart', 'pres3'], co: ['n', 'y'], tm: ['n', 'y', 'f']}, VPx: {vf: ['base', 'past', 'ppart', 'pres3']},
  VPTail: {vf: ['base', 'past', 'ppart', 'pres3']},
  FP: {num: ['sg', 'pl', 'mix'], per: ['1', '2', '3'], co: ['n', 'y'], pt: ['n', 'p', 'y']}, FPx: {num: ['sg', 'pl', 'mix'], per: ['1', '2', '3'], pt: ['n', 'p', 'y']},
  FPTail: {num: ['sg', 'pl', 'mix'], per: ['1', '2', '3']},
  S: {co: ['n', 'y'], fa: ['n', 'y'], fp: ['n', 'y'], pt: ['n', 'p', 'y']}, Sx: {}, STail: {}, SubCl: {}, Imp: {fa: ['n', 'y']}, Q: {}, Core: {}, Utt: {},
};
// Unspecified LHS features take these defaults. 'co' marks a constituent that
// is itself an unbracketed coordination, so coordinations stay flat.
// 'tm' (VP, Pred): has a time adverb already ('y'), one that is 'tomorrow'
// ('f'), or none ('n'). 'fa'/'fp' (S, Imp): a fronted adverb / PP is already
// present. 'pt' (FP, S): past tense ('p'), past tense with 'tomorrow' ('y').
const DEFAULTS = {co: 'n', tm: 'n', fa: 'n', fp: 'n', pt: 'n'};
// One time adverb per position: a second one may not stack on a VP or
// predicate that already has one ("*today later soon"). 'later' + a day word
// is one phrase ("later today"). Returns the resulting 'tm', or null.
const TM_ADD = (t, a) => a === 'no' ? t : t !== 'n' ? null : a === 'fday' ? 'f' : 'y';
// Past tense with 'tomorrow' (CGEL ch. 3: preterite in a main clause locates
// the situation in past time). Hypothetical and backshifted past ("if it left
// tomorrow", "she said it left tomorrow") occur only in subordinate and
// content clauses, which are exempt: the check is applied to main clauses.
const PT_OF = (past, tm) => !past ? 'n' : tm === 'f' ? 'y' : 'p';

// 'coll' = notional plural of a collective noun (the army are): plural
// agreement, but not countable-plural, so no numerals/'many'/'all' and no
// bare use (*six army, *army sign). CGEL ch. 5.
const DET_OK = (d, num, cnt, on) => {
  if (cnt === 'coll' && !OFF.has('COLL')) return d === 'the' || d === 'any';
  switch (d) {
    case 'the': case 'any': return true;
    case 'a': return num === 'sg' && cnt === 'count';
    case 'an': return num === 'sg' && cnt === 'count';
    case 'sg_count': return num === 'sg' && cnt === 'count';
    case 'pl': return num === 'pl';
    case 'pl_mass': return num === 'pl' || cnt === 'mass';
    case 'mass': return cnt === 'mass';
    case 'dem_sg': return num === 'sg';
    default: return false;
  }
};
const ONSET_OK = (d, on) => d === 'a' ? on !== 'v' : d === 'an' ? on !== 'c' : true;
// Subject–verb agreement (CGEL ch. 3, 18). 'base' = present tense plain form.
// A mixed-number 'or' coordination ("the cat or the dogs") has no agreed
// number: it is fine after a modal or past verb, but cannot control present
// agreement. Agreement with mixed 'or' is variable in English, so we do not
// legislate a proximity rule.
const AGREE = (form, num, per) => {
  if (num === 'mix') return form === 'modal' || form === 'past' || form === 'did';
  const third_sg = num === 'sg' && per === '3';
  switch (form) {
    case 'is': case 'does': case 'has': case 'pres3': return third_sg;
    case 'are': case 'were': return num === 'pl' || per === '2';
    case 'was': return num === 'sg' && per !== '2';
    case 'do': case 'have': case 'base': return !third_sg;
    case 'did': case 'past': case 'modal': return true;
    default: return false;
  }
};
const SUBJ = c => c === 'nom' || c === 'any';
const OBJ = c => c === 'acc' || c === 'any';
// Reflexives ('myself') need a binding antecedent, which this grammar does
// not model (no binding theory; 'I' is not an available tile). They are
// therefore licensed only in non-sentential utterances ("Just myself.").
// Fragments accept any case. (Banning nominative fragments such as "They."
// cost 43 ERG-analysed sentences to catch 27, so it is not applied.)
const FRAG_CASE = c => c !== null;

// Policy switches that can be turned off (env WL_OFF=COLL,...) so each can be
// measured against stored ERG results with erg/ablate.js.
const OFF = new Set(String((typeof process !== 'undefined' && process.env && process.env.WL_OFF) || '').split(',').filter(Boolean));
const R = [];
function rule(id, lhs, rhs, o = {}) { R.push({id, lhs, rhs, ...o}); }
const L = (cat, f = {}) => [cat, f];

// ---------------------------------------------------------------- nominals
// Flat modifier sequence before a head noun (CGEL ch. 5; compounds ch. 19).
// Each modifier is an attributive adjective phrase or a noun adjunct; the
// rightmost noun is the head. Internal bracketing of compounds is deliberately
// NOT represented: it is semantic, not syntactic, and enumerating it is
// Catalan-explosive. There is no length ceiling.
// Premodifiers: a flat chain of attributive adjective phrases and noun
// modifiers in any order, ending in the head noun (CGEL ch. 5, ch. 19). The
// ERG cross-check (2026-10-19) showed that requiring adjectives to precede
// noun modifiers rejected 33 ERG-analysed sentences to catch 14, so the order
// is free. Compound bracketing is not enumerated; there is no length ceiling.
rule('nom_head', L('NomN', {num: '?n', cnt: '?c', on: '?o'}), [L('N', {num: '?n', cnt: '?c', on: '?o'})],
  {fam: 'noun_head', head: 0, disp: null});
rule('nom_compound', L('NomN', {num: '?n', cnt: '?c', on: '?o'}), [L('N', {on: '?o', cnt: '?m'}), L('NomN', {num: '?n', cnt: '?c'})],
  {fam: 'noun_compound', head: 1, deps: [[0, 'compound']], disp: null, cost: 0.15, when: (v) => v.m !== 'coll'}); // a word that is also an adjective is canonically read as one
rule('nom_adj', L('NomN', {num: '?n', cnt: '?c', on: '?o'}), [L('AdjP', {u: 'attr', on: '?o'}), L('NomN', {num: '?n', cnt: '?c'})],
  {fam: 'adjective_modifier', head: 1, deps: [[0, 'amod']], disp: null});
rule('nom_n', L('Nom', {num: '?n', cnt: '?c', on: '?o'}), [L('NomN', {num: '?n', cnt: '?c', on: '?o'})], {fam: 'np_premodifier', head: 0, disp: null});
rule('adjp', L('AdjP', {u: '?u', on: '?o'}), [L('Adj', {u: '?u', on: '?o'})], {fam: 'adjective', head: 0, disp: null});
rule('adjp_deg', L('AdjP', {u: '?u', on: '?o'}), [L('AdvDeg', {pa: '?pa', on: '?o'}), L('Adj', {u: '?u'})],
  {fam: 'degree_modifier', head: 1, deps: [[0, 'advmod']], disp: 'AdjP', when: (v, C) => v.pa === 'both' || v.u === 'pred'});

// NP from a determiner and nominal (CGEL ch. 5).
rule('np_det', L('NP', {num: '?n', per: '3', case: 'any'}), [L('Det', {d: '?d'}), L('Nom', {num: '?n', cnt: '?c', on: '?o'})],
  {fam: 'determiner', head: 1, deps: [[0, 'det']], disp: 'NP',
   when: (v, C) => C('det_noun', DET_OK(v.d, v.n, v.c)) && C('article', ONSET_OK(v.d, v.o))});
// Bare NP: plural or mass head (CGEL ch. 5). Singular count nouns need a determiner.
rule('np_bare', L('NP', {num: '?n', per: '3', case: 'any'}), [L('Nom', {num: '?n', cnt: '?c'})],
  {fam: 'bare_np', head: 0, disp: 'NP', when: (v, C) => C('det_noun', (v.n === 'pl' && (v.c !== 'coll' || OFF.has('COLL'))) || v.c === 'mass')});
rule('np_pron', L('NP', {num: '?n', per: '?p', case: '?k'}), [L('Pron', {num: '?n', per: '?p', case: '?k'})],
  {fam: 'pronoun', head: 0, disp: 'NP'});
// Proper names (CGEL ch. 5): a bare singular NP needing no determiner
// ("Satoshi can run", "in April"). Lexically licensed: only nouns the v1.1
// lexicon marks with a proper-name reading.
rule('np_name', L('NP', {num: 'sg', per: '3', case: 'any'}), [L('PropN')], {fam: 'proper_noun', head: 0, disp: 'NP'});
rule('np_fused', L('NP', {num: 'pl', per: '3', case: 'any'}), [L('Det', {d: 'the'}), L('AdjFused')],
  {fam: 'fused_head', head: 1, deps: [[0, 'det']], disp: 'NP'});
// Postmodification: PP and subject relative clause.
// Postmodifiers keep the head's case, so pronouns can be postmodified
// ("we in New Zealand") without laundering case ("*they about industry" as
// an object stays out). ERG cross-check: restricting this to case-neutral
// NPs cost 121 analysed sentences to catch 48.
rule('np_pp', L('NP', {num: '?n', per: '?p', case: '?k'}), [L('NP', {num: '?n', per: '?p', case: '?k'}), L('PP')],
  {fam: 'prepositional_phrase', head: 0, deps: [[1, 'nmod_pp']], disp: 'NP'});
rule('np_rel', L('NP', {num: '?n', per: '?p', case: '?k'}), [L('NP', {num: '?n', per: '?p', case: '?k'}), L('Rel'), L('FP', {num: '?n', per: '?p'})],
  {fam: 'relative_clause', head: 0, deps: [[1, 'mark'], [2, 'relcl']], disp: 'NP'});
// Focusing modifier of an NP: "just blame", "only the cat" (CGEL ch. 6).
rule('np_focus', L('NP', {num: '?n', per: '?p', case: '?k'}), [L('AdvFocus'), L('NP', {num: '?n', per: '?p', case: '?k'})],
  {fam: 'focus_modifier', head: 1, deps: [[0, 'advmod']], disp: 'NP', cost: 0.1});
// NP coordination, flat and n-ary (CGEL ch. 15). 'and' makes the whole plural;
// pure 'or'/'but' chains take the number of the last conjunct.
// Case: every conjunct must be usable in the coordination's position, so the
// coordination's case is the most restrictive of its conjuncts' cases
// (standard English: *"me and he can run"). 'but' does not coordinate NPs
// here: NP-level 'but' needs a negative contrast (not X but Y), CGEL ch. 15.
const CASE_MEET = (a, b) => a === 'any' ? b : b === 'any' ? a : a === b ? a : null; // 'refl' meets only 'refl'/'any'
// A chain uses one conjunction throughout ("A and B and C"); mixing nests
// explicitly ("[A and B] or C" vs "A and [B or C]"), because number depends
// on the bracketing: 'and' gives plural, 'or' takes the nearest conjunct.
rule('np_coord', L('NP', {num: '?m', per: '3', case: '?k', co: '?j'}), [L('NPx', {num: '?f', case: '?x', co: '?j'}), L('NPTail', {num: '?n', cj: '?j', case: '?y'})],
  {fam: 'noun_coordination', head: 0, deps: [[1, 'conj']], disp: 'NP', when: (v, C) => v.j !== 'n' && v.m === (v.j === 'and' ? 'pl' : v.f === v.n ? v.n : 'mix') && C('case', CASE_MEET(v.x, v.y) !== null) && v.k === (CASE_MEET(v.x, v.y) || v.x)});
// Bare coordinated pair of singular count nouns ("knife and fork", "sword and
// symbol"; CGEL ch. 5): exactly two unmodified nouns joined by 'and', plural.
// A modified noun still needs its determiner (*sad august symbol and ...).
// Marked 'and'-coordinated so it does not nest inside a flat 'and' chain.
rule('np_bare_pair', L('NP', {num: 'pl', per: '3', case: 'any', co: 'and'}), [L('N', {num: 'sg', cnt: 'count'}), L('Conj', {cj: 'and'}), L('N', {num: 'sg', cnt: 'count'})],
  {fam: 'noun_coordination', head: 0, deps: [[2, 'conj'], [1, 'cc']], disp: 'NP', cost: 0.3});
rule('npx', L('NPx', {num: '?n', per: '?p', case: '?k', co: '?j'}), [L('NP', {num: '?n', per: '?p', case: '?k', co: '?c'})], {head: 0, disp: null, when: (v) => v.j !== 'n' && v.c !== v.j});
rule('nptail1', L('NPTail', {num: '?n', cj: '?j', case: '?k'}), [L('Conj', {cj: '?j'}), L('NPx', {num: '?n', case: '?k', co: '?j'})],
  {head: 1, deps: [[0, 'cc']], disp: null, when: (v) => v.j !== 'but'});
rule('nptail2', L('NPTail', {num: '?m', cj: '?j', case: '?k'}), [L('Conj', {cj: '?j'}), L('NPx', {num: '?f', case: '?x', co: '?j'}), L('NPTail', {num: '?n', cj: '?j', case: '?y'})],
  {head: 1, deps: [[0, 'cc'], [2, 'conj']], disp: null, when: (v, C) => v.j !== 'but' && v.m === (v.f === v.n ? v.n : 'mix') && C('case', CASE_MEET(v.x, v.y) !== null) && v.k === (CASE_MEET(v.x, v.y) || v.x)});

// ---------------------------------------------------------------- PPs
rule('pp', L('PP'), [L('P', {p: '?p'}), L('NP', {case: '?k'})],
  {fam: 'prepositional_phrase', head: 0, deps: [[1, 'pobj']], disp: 'PP', when: (v, C) => C('case', OBJ(v.k))});
// Idiomatic bare-noun PP licensed lexically: "on stage", "in fun" (CGEL ch. 5, 7).
rule('pp_idiom', L('PP'), [L('P', {p: '?p'}), L('NIdiom', {p: '?p'})],
  {fam: 'bare_idiomatic_pp', head: 0, deps: [[1, 'pobj']], disp: 'PP', cost: 0.1});

// ---------------------------------------------------------------- VPs
// Complementation by verb frame (CGEL ch. 4). The frame check is named so
// that a missing or extra object can be diagnosed rather than misattributed.
rule('vp_intr', L('VP', {vf: '?f'}), [L('V', {fr: '?r', vf: '?f'})],
  {fam: 'intransitive', head: 0, disp: 'VP', when: (v, C) => C('verb_frame', v.r === 'intr')});
rule('vp_tr', L('VP', {vf: '?f'}), [L('V', {fr: '?r', vf: '?f'}), L('NP', {case: '?k'})],
  {fam: 'verb_object', head: 0, deps: [[1, 'obj']], disp: 'VP', when: (v, C) => C('verb_frame', v.r === 'tr') && C('case', OBJ(v.k))});
rule('vp_ditr', L('VP', {vf: '?f'}), [L('V', {fr: 'ditr', vf: '?f'}), L('NP', {case: '?k'}), L('NP', {case: '?l'})],
  {fam: 'ditransitive', head: 0, deps: [[1, 'iobj'], [2, 'obj']], disp: 'VP', when: (v, C) => C('case', OBJ(v.k) && OBJ(v.l))});
rule('vp_cop', L('VP', {vf: '?f'}), [L('V', {fr: 'cop', vf: '?f'}), L('AdjP', {u: 'pred'})],
  {fam: 'lexical_copula', head: 0, deps: [[1, 'xcomp_adj']], disp: 'VP'});
rule('vp_inf', L('VP', {vf: '?f'}), [L('V', {fr: 'toinf', vf: '?f'}), L('To'), L('VP', {vf: 'base'})],
  {fam: 'infinitive', head: 0, deps: [[1, 'mark'], [2, 'xcomp']], disp: 'VP'});
// Content-clause complement, with or without 'that' (CGEL ch. 11: 'that' is
// usually omissible after verbs taking declarative content clauses).
rule('vp_that', L('VP', {vf: '?f'}), [L('V', {fr: 'clause', vf: '?f'}), L('Comp'), L('S')],
  {fam: 'complement_clause', head: 0, deps: [[1, 'mark'], [2, 'ccomp']], disp: 'VP'});
rule('vp_zero_that', L('VP', {vf: '?f'}), [L('V', {fr: 'clause', vf: '?f'}), L('S')],
  {fam: 'complement_clause', head: 0, deps: [[1, 'ccomp']], disp: 'VP', cost: 0.1});
rule('vp_prep', L('VP', {vf: '?f'}), [L('VPrep', {p: '?p', vf: '?f'}), L('P', {p: '?p'}), L('NP', {case: '?k'})],
  {fam: 'prepositional_verb', head: 0, deps: [[1, 'case'], [2, 'obl']], disp: 'VP', when: (v, C) => C('case', OBJ(v.k))});
// Adjuncts.
rule('vp_pp', L('VP', {vf: '?f', tm: '?t'}), [L('VP', {vf: '?f', tm: '?t'}), L('PP')], {fam: 'prepositional_phrase', head: 0, deps: [[1, 'obl']], disp: 'VP'});
rule('vp_post', L('VP', {vf: '?f', tm: '?u'}), [L('VP', {vf: '?f', tm: '?t'}), L('AdvPost', {tm: '?a'})], {fam: 'postverbal_adverb', head: 0, deps: [[1, 'advmod']], disp: 'VP',
  when: (v) => TM_ADD(v.t, v.a) === v.u});
rule('vp_post_later', L('VP', {vf: '?f', tm: '?u'}), [L('VP', {vf: '?f', tm: 'n'}), L('AdvPost', {tm: 'later'}), L('AdvPost', {tm: '?a'})],
  {fam: 'postverbal_adverb', head: 0, deps: [[1, 'advmod'], [2, 'advmod']], disp: 'VP', when: (v) => (v.a === 'day' || v.a === 'fday') && TM_ADD('n', v.a) === v.u});
rule('vp_pre', L('VP', {vf: '?f', tm: '?u'}), [L('AdvPre', {tm: '?a'}), L('VP', {vf: '?f', tm: '?t'})], {fam: 'preverbal_adverb', head: 1, deps: [[0, 'advmod']], disp: 'VP',
  when: (v) => (v.a === 'no' ? v.t : v.t === 'n' ? 'y' : null) === v.u});
// VP coordination, flat n-ary.
rule('vp_coord', L('VP', {vf: '?f', co: 'y'}), [L('VPx', {vf: '?f'}), L('VPTail', {vf: '?f'})],
  {fam: 'verb_coordination', head: 0, deps: [[1, 'conj']], disp: 'VP'});
rule('vpx', L('VPx', {vf: '?f'}), [L('VP', {vf: '?f', co: 'n', tm: '?t'})], {head: 0, disp: null, when: (v, C) => C('time_reference', !(v.f === 'past' && v.t === 'f'))});
rule('vptail1', L('VPTail', {vf: '?f'}), [L('Conj'), L('VPx', {vf: '?f'})], {head: 1, deps: [[0, 'cc']], disp: null});
rule('vptail2', L('VPTail', {vf: '?f'}), [L('Conj'), L('VPx', {vf: '?f'}), L('VPTail', {vf: '?f'})], {head: 1, deps: [[0, 'cc'], [2, 'conj']], disp: null});

// ---------------------------------------------------------------- predicates
rule('pred_adj', L('Pred', {pk: 'a'}), [L('AdjP', {u: 'pred'})], {fam: 'predicate_adjective', head: 0, disp: null});
rule('pred_np', L('Pred', {pk: 'n'}), [L('NP', {case: '?k'})], {fam: 'predicate_nominal', head: 0, disp: null, when: (v, C) => C('case', OBJ(v.k))});
rule('pred_pp', L('Pred', {pk: 'p'}), [L('PP')], {fam: 'predicate_prepositional', head: 0, disp: null});
// Adjuncts after a predicative complement ("was safe today", "is safe in the
// garden"). A PP adjunct follows only an adjective: after a nominal it is
// already an NP modifier, after a PP it would only re-bracket.
rule('pred_post', L('Pred', {tm: '?u', pk: '?k'}), [L('Pred', {tm: '?t', pk: '?k'}), L('AdvPost', {tm: '?a'})],
  {fam: 'postverbal_adverb', head: 0, deps: [[1, 'advmod']], disp: null, when: (v) => TM_ADD(v.t, v.a) === v.u});
rule('pred_post_later', L('Pred', {tm: '?u', pk: '?k'}), [L('Pred', {tm: 'n', pk: '?k'}), L('AdvPost', {tm: 'later'}), L('AdvPost', {tm: '?a'})],
  {fam: 'postverbal_adverb', head: 0, deps: [[1, 'advmod'], [2, 'advmod']], disp: null, when: (v) => (v.a === 'day' || v.a === 'fday') && TM_ADD('n', v.a) === v.u});
rule('pred_pp_adj', L('Pred', {tm: '?t', pk: 'a'}), [L('Pred', {tm: '?t', pk: 'a'}), L('PP')], {fam: 'prepositional_phrase', head: 0, deps: [[1, 'obl']], disp: null});

// ---------------------------------------------------------------- finite predicates
// FP carries subject agreement features. Each agreement check is named.
rule('fp_modal', L('FP', {num: '?n', per: '?p'}), [L('Modal'), L('VP', {vf: 'base'})],
  {fam: 'modal', head: 1, deps: [[0, 'aux']], disp: 'FP'});
rule('fp_modal_neg', L('FP', {num: '?n', per: '?p'}), [L('Modal'), L('Not'), L('VP', {vf: 'base'})],
  {fam: 'negation', head: 2, deps: [[0, 'aux'], [1, 'neg']], disp: 'FP'});
rule('fp_modal_be', L('FP', {num: '?n', per: '?p'}), [L('Modal'), L('Be'), L('Pred')],
  {fam: 'copula', head: 2, deps: [[0, 'aux'], [1, 'cop']], disp: 'FP'});
const PAST_COP = c => c === 'was' || c === 'were';
rule('fp_cop', L('FP', {num: '?n', per: '?p', pt: '?q'}), [L('Cop', {ct: '?c'}), L('Pred', {tm: '?m'})],
  {fam: 'copula', head: 1, deps: [[0, 'cop']], disp: 'FP', when: (v, C) => v.q === PT_OF(PAST_COP(v.c), v.m) && C('agreement', AGREE(v.c, v.n, v.p))});
rule('fp_cop_neg', L('FP', {num: '?n', per: '?p', pt: '?q'}), [L('Cop', {ct: '?c'}), L('Not'), L('Pred', {tm: '?m'})],
  {fam: 'negation', head: 2, deps: [[0, 'cop'], [1, 'neg']], disp: 'FP', when: (v, C) => v.q === PT_OF(PAST_COP(v.c), v.m) && C('agreement', AGREE(v.c, v.n, v.p))});
rule('fp_do', L('FP', {num: '?n', per: '?p', pt: '?q'}), [L('Do', {dt: '?d'}), L('Not'), L('VP', {vf: 'base', tm: '?m'})],
  {fam: 'negation', head: 2, deps: [[0, 'aux'], [1, 'neg']], disp: 'FP', when: (v, C) => v.q === PT_OF(v.d === 'did', v.m) && C('agreement', AGREE(v.d, v.n, v.p))});
rule('fp_do_emph', L('FP', {num: '?n', per: '?p', pt: '?q'}), [L('Do', {dt: '?d'}), L('VP', {vf: 'base', tm: '?m'})],
  {fam: 'do_support', head: 1, deps: [[0, 'aux']], disp: 'FP', cost: 0.2, when: (v, C) => v.q === PT_OF(v.d === 'did', v.m) && C('agreement', AGREE(v.d, v.n, v.p))});
rule('fp_perfect', L('FP', {num: '?n', per: '?p'}), [L('HaveAux', {ht: '?h'}), L('VP', {vf: 'ppart'})],
  {fam: 'perfect', head: 1, deps: [[0, 'aux']], disp: 'FP', when: (v, C) => C('agreement', AGREE(v.h, v.n, v.p))});
// Post-auxiliary VP ellipsis (Phase 1): an auxiliary with its complement
// left understood ("The fence can.", "He has.", "She did not.", "They were.").
// An ordinary finite predicate, so it also appears in coordination and
// subordinate clauses ("... because she did"). Agreement still applies.
// Slight cost so a full predicate is preferred when both exist.
for (const neg of [false, true]) {
  const N = neg ? [L('Not')] : [], dn = neg ? [[1, 'neg']] : [], sfx = neg ? '_neg' : '';
  rule('fp_ell_modal' + sfx, L('FP', {num: '?n', per: '?p'}), [L('Modal'), ...N], {fam: 'vp_ellipsis', head: 0, deps: dn, disp: 'FP', cost: 0.5});
  rule('fp_ell_cop' + sfx, L('FP', {num: '?n', per: '?p', pt: '?q'}), [L('Cop', {ct: '?c'}), ...N], {fam: 'vp_ellipsis', head: 0, deps: dn, disp: 'FP', cost: 0.5,
    when: (v, C) => v.q === PT_OF(PAST_COP(v.c), 'n') && C('agreement', AGREE(v.c, v.n, v.p))});
  rule('fp_ell_do' + sfx, L('FP', {num: '?n', per: '?p', pt: '?q'}), [L('Do', {dt: '?d'}), ...N], {fam: 'vp_ellipsis', head: 0, deps: dn, disp: 'FP', cost: 0.5,
    when: (v, C) => v.q === PT_OF(v.d === 'did', 'n') && C('agreement', AGREE(v.d, v.n, v.p))});
  rule('fp_ell_have' + sfx, L('FP', {num: '?n', per: '?p'}), [L('HaveAux', {ht: '?h'}), ...N], {fam: 'vp_ellipsis', head: 0, deps: dn, disp: 'FP', cost: 0.5,
    when: (v, C) => C('agreement', AGREE(v.h, v.n, v.p))});
}

// Lexical verbs: plain present (non-3sg), 3sg present ('has'), and past.
rule('fp_present', L('FP', {num: '?n', per: '?p'}), [L('VP', {vf: 'base'})],
  {fam: 'present_tense', head: 0, disp: 'FP', when: (v, C) => C('agreement', AGREE('base', v.n, v.p))});
rule('fp_pres3', L('FP', {num: '?n', per: '?p'}), [L('VP', {vf: 'pres3'})],
  {fam: 'present_tense', head: 0, disp: 'FP', when: (v, C) => C('agreement', AGREE('pres3', v.n, v.p))});
rule('fp_past', L('FP', {num: '?n', per: '?p', pt: '?q'}), [L('VP', {vf: 'past', tm: '?m'})], {fam: 'past_tense', head: 0, disp: 'FP', when: (v) => v.q === PT_OF(true, v.m)});
// Coordination of finite predicates sharing one subject.
rule('fp_coord', L('FP', {num: '?n', per: '?p', co: 'y', pt: '?t'}), [L('FPx', {num: '?n', per: '?p', pt: '?t'}), L('FPTail', {num: '?n', per: '?p'})],
  {fam: 'predicate_coordination', head: 0, deps: [[1, 'conj']], disp: 'FP'});
rule('fpx', L('FPx', {num: '?n', per: '?p', pt: '?t'}), [L('FP', {num: '?n', per: '?p', co: 'n', pt: '?t'})], {head: 0, disp: null, when: (v, C) => C('time_reference', v.t !== 'y')});
rule('fptail1', L('FPTail', {num: '?n', per: '?p'}), [L('Conj'), L('FPx', {num: '?n', per: '?p'})], {head: 1, deps: [[0, 'cc']], disp: null});
rule('fptail2', L('FPTail', {num: '?n', per: '?p'}), [L('Conj'), L('FPx', {num: '?n', per: '?p'}), L('FPTail', {num: '?n', per: '?p'})], {head: 1, deps: [[0, 'cc'], [2, 'conj']], disp: null});

// ---------------------------------------------------------------- clauses
rule('s_subj', L('S', {pt: '?t'}), [L('NP', {num: '?n', per: '?p', case: '?k'}), L('FP', {num: '?n', per: '?p', pt: '?t'})],
  {fam: 'clause', head: 1, deps: [[0, 'nsubj']], disp: 'S', when: (v, C) => C('case', SUBJ(v.k))});
// Adverbial subordinate clauses, final or fronted (CGEL ch. 8, 11).
rule('subcl', L('SubCl'), [L('Sub'), L('S')], {fam: 'subordinate_clause', head: 1, deps: [[0, 'mark']], disp: 'SubCl'});
rule('s_sub_final', L('S', {pt: '?t'}), [L('S', {pt: '?t'}), L('SubCl')], {fam: 'subordinate_clause', head: 0, deps: [[1, 'advcl']], disp: 'S'});
rule('s_sub_front', L('S', {pt: '?t'}), [L('SubCl'), L('S', {pt: '?t'})], {fam: 'subordinate_clause', head: 1, deps: [[0, 'advcl']], disp: 'S', cost: 0.1});
// Fronted adjuncts (CGEL ch. 8). Word Lab has no comma tile, so "Today the
// cargo can ..." is written without one. At most one fronted adverb (or
// "later today") and one fronted PP per clause; a fronted adverb scores as
// the same adverb would at the end. A fronted 'tomorrow' over a past-tense
// clause is a time-reference conflict, checked at main-clause level.
const FRONT_PT = (a, t) => a === 'fday' && t === 'p' ? 'y' : t;
rule('s_adv_front', L('S', {fa: 'y', fp: '?p', pt: '?u'}), [L('AdvFront', {tm: '?a'}), L('S', {co: 'n', fa: 'n', fp: '?p', pt: '?t'})],
  {fam: 'postverbal_adverb', head: 1, deps: [[0, 'advmod']], disp: 'S', when: (v) => FRONT_PT(v.a, v.t) === v.u});
rule('s_adv_front_later', L('S', {fa: 'y', fp: '?p', pt: '?u'}), [L('AdvFront', {tm: 'later'}), L('AdvFront', {tm: '?a'}), L('S', {co: 'n', fa: 'n', fp: '?p', pt: '?t'})],
  {fam: 'postverbal_adverb', head: 2, deps: [[0, 'advmod'], [1, 'advmod']], disp: 'S', when: (v) => (v.a === 'day' || v.a === 'fday') && FRONT_PT(v.a, v.t) === v.u});
rule('s_pp_front', L('S', {fa: '?a', fp: 'y', pt: '?t'}), [L('PP'), L('S', {co: 'n', fa: '?a', fp: 'n', pt: '?t'})],
  {fam: 'prepositional_phrase', head: 1, deps: [[0, 'obl']], disp: 'S'});
// Clause coordination, flat n-ary (CGEL ch. 15). A coordinate is any clause
// that is not itself an unbracketed coordination, so chains stay flat.
rule('s_coord', L('S', {co: 'y'}), [L('Sx'), L('STail')], {fam: 'clause_coordination', head: 0, deps: [[1, 'conj']], disp: 'S'});
rule('sx', L('Sx'), [L('S', {co: 'n', pt: '?t'})], {head: 0, disp: null, when: (v, C) => C('time_reference', v.t !== 'y')});
rule('stail1', L('STail'), [L('Conj'), L('Sx')], {head: 1, deps: [[0, 'cc']], disp: null});
rule('stail2', L('STail'), [L('Conj'), L('Sx'), L('STail')], {head: 1, deps: [[0, 'cc'], [2, 'conj']], disp: null});
// Clauses linked by a sequencing adverb where writing would use a semicolon or
// dash ("the cargo can predict news then the castle can sleep").
rule('s_link', L('S', {co: 'y'}), [L('Sx'), L('AdvLink'), L('Sx')], {fam: 'clause_coordination', head: 0, deps: [[2, 'conj'], [1, 'cc']], disp: 'S'});

// Imperatives (CGEL ch. 10): a base-form VP with no subject.
rule('imp', L('Imp'), [L('VP', {vf: 'base'})], {fam: 'imperative', head: 0, disp: 'Imp'});
rule('imp_sub', L('Imp', {fa: '?a'}), [L('Imp', {fa: '?a'}), L('SubCl')], {fam: 'subordinate_clause', head: 0, deps: [[1, 'advcl']], disp: 'Imp'});
rule('imp_sub_front', L('Imp', {fa: '?a'}), [L('SubCl'), L('Imp', {fa: '?a'})], {fam: 'subordinate_clause', head: 1, deps: [[0, 'advcl']], disp: 'Imp', cost: 0.1});
// Imperative coordinated with a declarative ("Open it and the cat can run").
rule('imp_and_s', L('Imp', {fa: '?a'}), [L('Imp', {fa: '?a'}), L('Conj', {cj: 'and'}), L('S', {pt: '?t'})],
  {fam: 'imperative_declarative_coordination', head: 0, deps: [[1, 'cc'], [2, 'conj']], disp: 'Imp', cost: 0.2, when: (v, C) => C('time_reference', v.t !== 'y')});
// Fronted adverb before an imperative ("Today inch toward the castle").
rule('imp_adv_front', L('Imp', {fa: 'y'}), [L('AdvFront', {tm: '?a'}), L('Imp', {fa: 'n'})], {fam: 'postverbal_adverb', head: 1, deps: [[0, 'advmod']], disp: 'Imp'});
rule('imp_adv_front_later', L('Imp', {fa: 'y'}), [L('AdvFront', {tm: 'later'}), L('AdvFront', {tm: '?a'}), L('Imp', {fa: 'n'})],
  {fam: 'postverbal_adverb', head: 2, deps: [[0, 'advmod'], [1, 'advmod']], disp: 'Imp', when: (v) => v.a === 'day' || v.a === 'fday'});

// Polar interrogatives (CGEL ch. 10).
rule('q_modal', L('Q'), [L('Modal'), L('NP', {num: '?n', per: '?p', case: '?k'}), L('VP', {vf: 'base'})],
  {fam: 'question', head: 2, deps: [[0, 'aux'], [1, 'nsubj']], disp: 'Q', when: (v, C) => C('case', SUBJ(v.k))});
rule('q_do', L('Q'), [L('Do', {dt: '?d'}), L('NP', {num: '?n', per: '?p', case: '?k'}), L('VP', {vf: 'base'})],
  {fam: 'question', head: 2, deps: [[0, 'aux'], [1, 'nsubj']], disp: 'Q', when: (v, C) => C('agreement', AGREE(v.d, v.n, v.p)) && C('case', SUBJ(v.k))});
rule('q_cop', L('Q'), [L('Cop', {ct: '?c'}), L('NP', {num: '?n', per: '?p', case: '?k'}), L('Pred')],
  {fam: 'question', head: 2, deps: [[0, 'cop'], [1, 'nsubj']], disp: 'Q', when: (v, C) => C('agreement', AGREE(v.c, v.n, v.p)) && C('case', SUBJ(v.k))});

// ---------------------------------------------------------------- utterances
rule('core_s', L('Core'), [L('S', {pt: '?t'})], {head: 0, disp: null, utype: 'declarative', when: (v, C) => C('time_reference', v.t !== 'y')});
rule('core_imp', L('Core'), [L('Imp')], {head: 0, disp: null, utype: 'imperative'});
rule('utt_core', L('Utt'), [L('Core')], {head: 0, disp: null, inheritType: true});
rule('utt_q', L('Utt'), [L('Q')], {head: 0, disp: null, utype: 'question'});
// Causal coordinator 'for' (CGEL ch. 15): final position, finite clause only,
// not itself coordinated with a preceding 'and'. Punctuation is orthographic.
rule('utt_for', L('Utt'), [L('Core'), L('ForCoord'), L('S', {pt: '?t'})],
  {fam: 'causal_for_coordination', head: 0, deps: [[1, 'cc'], [2, 'conj_for']], disp: 'Utt', inheritType: true, cost: 0.1, when: (v, C) => C('time_reference', v.t !== 'y')});
// Non-sentential utterances: nominal (caption/answer) and modal VP ellipsis.
rule('utt_frag', L('Utt'), [L('NP', {case: '?k'})], {fam: 'nominal_utterance', head: 0, disp: 'Frag', utype: 'fragment', cost: 2, when: (v) => FRAG_CASE(v.k)});

const RELAXABLE = ['agreement', 'article', 'det_noun', 'case', 'verb_frame', 'time_reference'];
const RELAX_TEXT = {
  agreement: 'subject–verb agreement',
  article: 'a/an before a vowel or consonant sound',
  det_noun: 'determiner and noun number/countability (including a singular count noun with no determiner)',
  case: 'pronoun case (subject versus object form)',
  verb_frame: 'what the verb needs after it (an object, or no object)',
  time_reference: 'past tense with ‘tomorrow’',
};

// Diagnosis cost per relaxed constraint (default 100). A time-reference clash
// keeps every word in its ordinary class, so it is preferred over a reading
// that turns the time adverb into a noun ("was safe tomorrow" is not a
// determiner error on a noun 'tomorrow').
const RELAX_COST = {time_reference: 90};
module.exports = {CATS, DEFAULTS, RULES: R, RELAXABLE, RELAX_TEXT, RELAX_COST, DET_OK, ONSET_OK, AGREE};
