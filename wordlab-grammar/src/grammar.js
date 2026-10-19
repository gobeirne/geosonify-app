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

const CATS = {
  // preterminals
  N: {num: ['sg', 'pl'], cnt: ['count', 'mass', 'coll'], on: ['v', 'c', 'x']},
  NIdiom: {p: 'PREP'}, Adj: {u: ['attr', 'pred'], on: ['v', 'c', 'x']}, AdjFused: {},
  AdvDeg: {pa: ['both', 'pred'], on: ['v', 'c', 'x']}, AdvPre: {}, AdvPost: {}, AdvFocus: {},
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
  PP: {}, Pred: {},
  VP: {vf: ['base', 'past', 'ppart', 'pres3'], co: ['n', 'y']}, VPx: {vf: ['base', 'past', 'ppart', 'pres3']},
  VPTail: {vf: ['base', 'past', 'ppart', 'pres3']},
  FP: {num: ['sg', 'pl', 'mix'], per: ['1', '2', '3'], co: ['n', 'y']}, FPx: {num: ['sg', 'pl', 'mix'], per: ['1', '2', '3']},
  FPTail: {num: ['sg', 'pl', 'mix'], per: ['1', '2', '3']},
  S: {co: ['n', 'y']}, Sx: {}, STail: {}, SubCl: {}, Imp: {}, Q: {}, Core: {}, Utt: {},
};
// Unspecified LHS features take these defaults. 'co' marks a constituent that
// is itself an unbracketed coordination, so coordinations stay flat.
const DEFAULTS = {co: 'n'};

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
rule('vp_pp', L('VP', {vf: '?f'}), [L('VP', {vf: '?f'}), L('PP')], {fam: 'prepositional_phrase', head: 0, deps: [[1, 'obl']], disp: 'VP'});
rule('vp_post', L('VP', {vf: '?f'}), [L('VP', {vf: '?f'}), L('AdvPost')], {fam: 'postverbal_adverb', head: 0, deps: [[1, 'advmod']], disp: 'VP'});
rule('vp_pre', L('VP', {vf: '?f'}), [L('AdvPre'), L('VP', {vf: '?f'})], {fam: 'preverbal_adverb', head: 1, deps: [[0, 'advmod']], disp: 'VP'});
// VP coordination, flat n-ary.
rule('vp_coord', L('VP', {vf: '?f', co: 'y'}), [L('VPx', {vf: '?f'}), L('VPTail', {vf: '?f'})],
  {fam: 'verb_coordination', head: 0, deps: [[1, 'conj']], disp: 'VP'});
rule('vpx', L('VPx', {vf: '?f'}), [L('VP', {vf: '?f', co: 'n'})], {head: 0, disp: null});
rule('vptail1', L('VPTail', {vf: '?f'}), [L('Conj'), L('VPx', {vf: '?f'})], {head: 1, deps: [[0, 'cc']], disp: null});
rule('vptail2', L('VPTail', {vf: '?f'}), [L('Conj'), L('VPx', {vf: '?f'}), L('VPTail', {vf: '?f'})], {head: 1, deps: [[0, 'cc'], [2, 'conj']], disp: null});

// ---------------------------------------------------------------- predicates
rule('pred_adj', L('Pred'), [L('AdjP', {u: 'pred'})], {fam: 'predicate_adjective', head: 0, disp: null});
rule('pred_np', L('Pred'), [L('NP', {case: '?k'})], {fam: 'predicate_nominal', head: 0, disp: null, when: (v, C) => C('case', OBJ(v.k))});
rule('pred_pp', L('Pred'), [L('PP')], {fam: 'predicate_prepositional', head: 0, disp: null});

// ---------------------------------------------------------------- finite predicates
// FP carries subject agreement features. Each agreement check is named.
rule('fp_modal', L('FP', {num: '?n', per: '?p'}), [L('Modal'), L('VP', {vf: 'base'})],
  {fam: 'modal', head: 1, deps: [[0, 'aux']], disp: 'FP'});
rule('fp_modal_neg', L('FP', {num: '?n', per: '?p'}), [L('Modal'), L('Not'), L('VP', {vf: 'base'})],
  {fam: 'negation', head: 2, deps: [[0, 'aux'], [1, 'neg']], disp: 'FP'});
rule('fp_modal_be', L('FP', {num: '?n', per: '?p'}), [L('Modal'), L('Be'), L('Pred')],
  {fam: 'copula', head: 2, deps: [[0, 'aux'], [1, 'cop']], disp: 'FP'});
rule('fp_cop', L('FP', {num: '?n', per: '?p'}), [L('Cop', {ct: '?c'}), L('Pred')],
  {fam: 'copula', head: 1, deps: [[0, 'cop']], disp: 'FP', when: (v, C) => C('agreement', AGREE(v.c, v.n, v.p))});
rule('fp_cop_neg', L('FP', {num: '?n', per: '?p'}), [L('Cop', {ct: '?c'}), L('Not'), L('Pred')],
  {fam: 'negation', head: 2, deps: [[0, 'cop'], [1, 'neg']], disp: 'FP', when: (v, C) => C('agreement', AGREE(v.c, v.n, v.p))});
rule('fp_do', L('FP', {num: '?n', per: '?p'}), [L('Do', {dt: '?d'}), L('Not'), L('VP', {vf: 'base'})],
  {fam: 'negation', head: 2, deps: [[0, 'aux'], [1, 'neg']], disp: 'FP', when: (v, C) => C('agreement', AGREE(v.d, v.n, v.p))});
rule('fp_do_emph', L('FP', {num: '?n', per: '?p'}), [L('Do', {dt: '?d'}), L('VP', {vf: 'base'})],
  {fam: 'do_support', head: 1, deps: [[0, 'aux']], disp: 'FP', cost: 0.2, when: (v, C) => C('agreement', AGREE(v.d, v.n, v.p))});
rule('fp_perfect', L('FP', {num: '?n', per: '?p'}), [L('HaveAux', {ht: '?h'}), L('VP', {vf: 'ppart'})],
  {fam: 'perfect', head: 1, deps: [[0, 'aux']], disp: 'FP', when: (v, C) => C('agreement', AGREE(v.h, v.n, v.p))});
// Lexical verbs: plain present (non-3sg), 3sg present ('has'), and past.
rule('fp_present', L('FP', {num: '?n', per: '?p'}), [L('VP', {vf: 'base'})],
  {fam: 'present_tense', head: 0, disp: 'FP', when: (v, C) => C('agreement', AGREE('base', v.n, v.p))});
rule('fp_pres3', L('FP', {num: '?n', per: '?p'}), [L('VP', {vf: 'pres3'})],
  {fam: 'present_tense', head: 0, disp: 'FP', when: (v, C) => C('agreement', AGREE('pres3', v.n, v.p))});
rule('fp_past', L('FP', {num: '?n', per: '?p'}), [L('VP', {vf: 'past'})], {fam: 'past_tense', head: 0, disp: 'FP'});
// Coordination of finite predicates sharing one subject.
rule('fp_coord', L('FP', {num: '?n', per: '?p', co: 'y'}), [L('FPx', {num: '?n', per: '?p'}), L('FPTail', {num: '?n', per: '?p'})],
  {fam: 'predicate_coordination', head: 0, deps: [[1, 'conj']], disp: 'FP'});
rule('fpx', L('FPx', {num: '?n', per: '?p'}), [L('FP', {num: '?n', per: '?p', co: 'n'})], {head: 0, disp: null});
rule('fptail1', L('FPTail', {num: '?n', per: '?p'}), [L('Conj'), L('FPx', {num: '?n', per: '?p'})], {head: 1, deps: [[0, 'cc']], disp: null});
rule('fptail2', L('FPTail', {num: '?n', per: '?p'}), [L('Conj'), L('FPx', {num: '?n', per: '?p'}), L('FPTail', {num: '?n', per: '?p'})], {head: 1, deps: [[0, 'cc'], [2, 'conj']], disp: null});

// ---------------------------------------------------------------- clauses
rule('s_subj', L('S'), [L('NP', {num: '?n', per: '?p', case: '?k'}), L('FP', {num: '?n', per: '?p'})],
  {fam: 'clause', head: 1, deps: [[0, 'nsubj']], disp: 'S', when: (v, C) => C('case', SUBJ(v.k))});
// Adverbial subordinate clauses, final or fronted (CGEL ch. 8, 11).
rule('subcl', L('SubCl'), [L('Sub'), L('S')], {fam: 'subordinate_clause', head: 1, deps: [[0, 'mark']], disp: 'SubCl'});
rule('s_sub_final', L('S'), [L('S'), L('SubCl')], {fam: 'subordinate_clause', head: 0, deps: [[1, 'advcl']], disp: 'S'});
rule('s_sub_front', L('S'), [L('SubCl'), L('S')], {fam: 'subordinate_clause', head: 1, deps: [[0, 'advcl']], disp: 'S', cost: 0.1});
// Clause coordination, flat n-ary (CGEL ch. 15). A coordinate is any clause
// that is not itself an unbracketed coordination, so chains stay flat.
rule('s_coord', L('S', {co: 'y'}), [L('Sx'), L('STail')], {fam: 'clause_coordination', head: 0, deps: [[1, 'conj']], disp: 'S'});
rule('sx', L('Sx'), [L('S', {co: 'n'})], {head: 0, disp: null});
rule('stail1', L('STail'), [L('Conj'), L('Sx')], {head: 1, deps: [[0, 'cc']], disp: null});
rule('stail2', L('STail'), [L('Conj'), L('Sx'), L('STail')], {head: 1, deps: [[0, 'cc'], [2, 'conj']], disp: null});

// Imperatives (CGEL ch. 10): a base-form VP with no subject.
rule('imp', L('Imp'), [L('VP', {vf: 'base'})], {fam: 'imperative', head: 0, disp: 'Imp'});
rule('imp_sub', L('Imp'), [L('Imp'), L('SubCl')], {fam: 'subordinate_clause', head: 0, deps: [[1, 'advcl']], disp: 'Imp'});
rule('imp_sub_front', L('Imp'), [L('SubCl'), L('Imp')], {fam: 'subordinate_clause', head: 1, deps: [[0, 'advcl']], disp: 'Imp', cost: 0.1});
// Imperative coordinated with a declarative ("Open it and the cat can run").
rule('imp_and_s', L('Imp'), [L('Imp'), L('Conj', {cj: 'and'}), L('S')],
  {fam: 'imperative_declarative_coordination', head: 0, deps: [[1, 'cc'], [2, 'conj']], disp: 'Imp', cost: 0.2});

// Polar interrogatives (CGEL ch. 10).
rule('q_modal', L('Q'), [L('Modal'), L('NP', {num: '?n', per: '?p', case: '?k'}), L('VP', {vf: 'base'})],
  {fam: 'question', head: 2, deps: [[0, 'aux'], [1, 'nsubj']], disp: 'Q', when: (v, C) => C('case', SUBJ(v.k))});
rule('q_do', L('Q'), [L('Do', {dt: '?d'}), L('NP', {num: '?n', per: '?p', case: '?k'}), L('VP', {vf: 'base'})],
  {fam: 'question', head: 2, deps: [[0, 'aux'], [1, 'nsubj']], disp: 'Q', when: (v, C) => C('agreement', AGREE(v.d, v.n, v.p)) && C('case', SUBJ(v.k))});
rule('q_cop', L('Q'), [L('Cop', {ct: '?c'}), L('NP', {num: '?n', per: '?p', case: '?k'}), L('Pred')],
  {fam: 'question', head: 2, deps: [[0, 'cop'], [1, 'nsubj']], disp: 'Q', when: (v, C) => C('agreement', AGREE(v.c, v.n, v.p)) && C('case', SUBJ(v.k))});

// ---------------------------------------------------------------- utterances
rule('core_s', L('Core'), [L('S')], {head: 0, disp: null, utype: 'declarative'});
rule('core_imp', L('Core'), [L('Imp')], {head: 0, disp: null, utype: 'imperative'});
rule('utt_core', L('Utt'), [L('Core')], {head: 0, disp: null, inheritType: true});
rule('utt_q', L('Utt'), [L('Q')], {head: 0, disp: null, utype: 'question'});
// Causal coordinator 'for' (CGEL ch. 15): final position, finite clause only,
// not itself coordinated with a preceding 'and'. Punctuation is orthographic.
rule('utt_for', L('Utt'), [L('Core'), L('ForCoord'), L('S')],
  {fam: 'causal_for_coordination', head: 0, deps: [[1, 'cc'], [2, 'conj_for']], disp: 'Utt', inheritType: true, cost: 0.1});
// Non-sentential utterances: nominal (caption/answer) and modal VP ellipsis.
rule('utt_frag', L('Utt'), [L('NP', {case: '?k'})], {fam: 'nominal_utterance', head: 0, disp: 'Frag', utype: 'fragment', cost: 2, when: (v) => FRAG_CASE(v.k)});
rule('utt_ellipsis', L('Utt'), [L('NP', {num: '?n', per: '?p', case: '?k'}), L('Modal')],
  {fam: 'modal_ellipsis', head: 1, deps: [[0, 'nsubj']], disp: 'Ellipsis', utype: 'ellipsis', cost: 1, when: (v, C) => C('case', SUBJ(v.k))});
rule('utt_ellipsis_neg', L('Utt'), [L('NP', {num: '?n', per: '?p', case: '?k'}), L('Modal'), L('Not')],
  {fam: 'modal_ellipsis', head: 1, deps: [[0, 'nsubj'], [2, 'neg']], disp: 'Ellipsis', utype: 'ellipsis', cost: 1, when: (v, C) => C('case', SUBJ(v.k))});

const RELAXABLE = ['agreement', 'article', 'det_noun', 'case', 'verb_frame'];
const RELAX_TEXT = {
  agreement: 'subject–verb agreement',
  article: 'a/an before a vowel or consonant sound',
  det_noun: 'determiner and noun number/countability (including a singular count noun with no determiner)',
  case: 'pronoun case (subject versus object form)',
  verb_frame: 'what the verb needs after it (an object, or no object)',
};

module.exports = {CATS, DEFAULTS, RULES: R, RELAXABLE, RELAX_TEXT, DET_OK, ONSET_OK, AGREE};
