'use strict';
/*
 * Starpin Word Lab — Phase 0 lexicon compiler.
 *
 * Turns the v1.1 BIP39 lexicon (plus Open English WordNet 2025 evidence) into
 * preterminal readings for the grammar. Every reading carries an evidence tier:
 *
 *   curated  — enabled in the v1.1 lexicon (proposed_for_parser: true).
 *   attested — added because an independent source directly states it
 *              (e.g. Wiktionary marks the noun as uncountable; a WordNet verb
 *              frame shows an intransitive use; OEWN uses "on stage" bare).
 *   derived  — added by a stated rule whose premises are all attested facts
 *              plus a cited grammatical generalisation (collective nouns).
 *   inferred — a plausible possibility from a heuristic premise (e.g. a
 *              substance noun "is probably" mass). Recorded and reported, but
 *              NEVER enabled in the default profile.
 *
 * Readings disabled in v1.1 stay disabled: no blanket POS promotion.
 */

const TIER_COST = Object.freeze({curated: 0, attested: 0.3, derived: 0.6, inferred: 1.5});

// Closed-class words that are not in BIP39 (the gold helper candidates).
// Their grammatical roles are defined here, not inferred.
const NON_BIP39_FUNCTION_WORDS = Object.freeze({
  the: [['Det', {d: 'the'}]],
  a: [['Det', {d: 'a'}]],
  an: [['Det', {d: 'an'}]],
  some: [['Det', {d: 'any'}]],
  every: [['Det', {d: 'sg_count'}]],
  each: [['Det', {d: 'sg_count'}]],
  many: [['Det', {d: 'pl'}]],
  no: [['Det', {d: 'any'}]],
  my: [['Det', {d: 'any'}]],
  his: [['Det', {d: 'any'}]],
  their: [['Det', {d: 'any'}]],
  is: [['Cop', {ct: 'is'}]],
  are: [['Cop', {ct: 'are'}]],
  was: [['Cop', {ct: 'was'}]],
  were: [['Cop', {ct: 'were'}]],
  be: [['Be', {}]],
  and: [['Conj', {cj: 'and'}]],
  or: [['Conj', {cj: 'or'}]],
  but: [['Conj', {cj: 'but'}]],
  not: [['Not', {}]],
  has: [['V', {fr: 'tr', vf: 'pres3'}], ['HaveAux', {ht: 'has'}]],
  does: [['Do', {dt: 'does'}]],
  do: [['Do', {dt: 'do'}]],
  did: [['Do', {dt: 'did'}]],
  in: [['P', {p: 'in'}]], on: [['P', {p: 'on'}]], at: [['P', {p: 'at'}]],
  of: [['P', {p: 'of'}]], with: [['P', {p: 'with'}]], from: [['P', {p: 'from'}]],
  by: [['P', {p: 'by'}]], without: [['P', {p: 'without'}]],
  to: [['To', {}], ['P', {p: 'to'}]],
  // CGEL ch. 15: 'for' is a (marginal) coordinator meaning 'because', joining
  // a final finite clause; it is also an ordinary preposition.
  for: [['P', {p: 'for'}], ['ForCoord', {}]],
  he: [['Pron', {num: 'sg', per: '3', case: 'nom'}]],
  she: [['Pron', {num: 'sg', per: '3', case: 'nom'}]],
  it: [['Pron', {num: 'sg', per: '3', case: 'any'}]],
  we: [['Pron', {num: 'pl', per: '1', case: 'nom'}]],
  i: [['Pron', {num: 'sg', per: '1', case: 'nom'}]],
  me: [['Pron', {num: 'sg', per: '1', case: 'acc'}]],
  them: [['Pron', {num: 'pl', per: '3', case: 'acc'}]],
  if: [['Sub', {}]], while: [['Sub', {}]],
  who: [['Rel', {}]], which: [['Rel', {}]],
  // 'too' and 'so' modify predicative adjectives only (*a too happy cat).
  too: [['AdvDeg', {pa: 'pred', on: 'c'}]], so: [['AdvDeg', {pa: 'pred', on: 'c'}]],
});

// Closed-class supplements for BIP39 words, beyond what the lexicon records.
const BIP39_FUNCTION_SUPPLEMENTS = Object.freeze({
  that: [['Comp', {}], ['Rel', {}]],
});

// Gold-tile role policy (user decision 2026-10-19): a gold helper supplies only
// the grammatical roles listed here, never an open-class noun/verb/adjective
// reading of the same spelling. 'has' keeps its lexical-verb reading and 'for'
// keeps both prepositional and coordinating readings, by explicit decision.
const GOLD_ROLE_CATS = new Set(['Det', 'Cop', 'Be', 'Conj', 'Not', 'Do', 'HaveAux', 'P', 'To',
  'ForCoord', 'Pron', 'Sub', 'Comp', 'Rel', 'Modal', 'AdvDeg']);
// The 47 helper candidates offered by the v1.1 prototype. Only these can be
// gold tiles; any other word used as 'helper' has no readings.
const HELPER_CANDIDATES = ['the', 'can', 'and', 'in', 'is', 'a', 'are', 'with', 'not', 'to', 'an', 'of', 'was', 'were', 'or', 'but', 'has', 'do', 'does', 'did', 'at', 'on', 'from', 'by', 'for', 'if', 'while', 'he', 'she', 'it', 'we', 'some', 'each', 'many', 'because', 'will', 'must', 'they', 'this', 'that', 'before', 'when', 'where', 'inside', 'into', 'toward', 'all'];
const HELPER_SET = new Set(HELPER_CANDIDATES);
const GOLD_EXPLICIT_EXTRA = Object.freeze({has: [['V', {fr: 'tr', vf: 'pres3'}]]});

const DET_SELECTS = Object.freeze({
  singular: 'sg_count', plural: 'pl', plural_or_mass: 'pl_mass', mass: 'mass',
  any: 'any', mass_or_adjective: 'mass',
});
// Determiners whose v1.1 'selects' value is too vague to license safely.
// 'same' needs 'the'; 'what' is interrogative (no wh-questions yet); ordinals
// and 'only' are not central determiners. Disabled, and reported as such.
const DET_DISABLED = new Set(['same', 'what', 'first', 'second', 'next', 'only', 'half', 'such']);
const DET_OVERRIDE = Object.freeze({this: 'dem_sg', that: 'dem_sg', more: 'pl_mass', zero: 'pl',
  enough: 'pl_mass', other: 'pl_mass'});
const NUMERAL_DET = Object.freeze({one: 'sg_count', two: 'pl', three: 'pl', six: 'pl', seven: 'pl',
  eight: 'pl', ten: 'pl', twelve: 'pl', twenty: 'pl', zero: 'pl'});

// Adverb syntactic classes. From v1.1 class tags plus v1.1's own curated
// position lists for words tagged 'unspecified'. 'half' and 'pretty' are added
// as degree modifiers of adjectives (CGEL ch. 6), a documented curated choice.
const V11_DEGREE = ['barely', 'very', 'too', 'so', 'quite', 'rather', 'extremely', 'really'];
const V11_PREVERB = ['barely', 'never', 'always', 'just', 'often', 'rarely', 'still', 'also', 'only', 'really', 'again', 'almost', 'already', 'easily', 'truly'];
const V11_POST = ['today', 'tonight', 'tomorrow', 'yesterday', 'later', 'now', 'soon', 'always', 'never', 'again', 'already', 'then', 'once', 'twice', 'ahead', 'alone', 'apart', 'away', 'easily', 'there', 'together', 'truly',
  'about', 'around', 'best', 'better', 'early', 'east', 'first', 'forward', 'hard', 'home', 'inside', 'left', 'next', 'north', 'off', 'outside', 'right', 'round', 'slow', 'south', 'west', 'wrong', 'online'];
const DEGREE_ADDITIONS = {half: 'CGEL ch. 6: degree modifier (half empty, half human)', pretty: 'CGEL ch. 6: degree modifier (pretty bitter)'};

// WordNet verb-frame IDs (Princeton/OEWN sentence frames) mapped to frames.
const WN_FRAME_MAP = Object.freeze({
  1: 'intr', 2: 'intr', 3: 'intr', 4: 'intr', 12: 'intr', 13: 'intr', 22: 'intr', 23: 'intr', 27: 'intr',
  8: 'tr', 9: 'tr', 10: 'tr', 11: 'tr', 16: 'tr', 17: 'tr', 18: 'tr', 19: 'tr', 20: 'tr', 21: 'tr', 31: 'tr',
  14: 'ditr', 6: 'cop', 7: 'cop', 26: 'clause', 28: 'toinf',
});
const WIKT_TAG_MAP = Object.freeze({intransitive: ['intr'], transitive: ['tr'], 'transitive & intransitive': ['tr', 'intr']});
const V11_FRAME_MAP = Object.freeze({intransitive: 'intr', transitive: 'tr', ditransitive: 'ditr', copular: 'cop',
  to_infinitive_complement: 'toinf', finite_clause_complement: 'clause', prepositional_object: 'prep'});

// OEWN hypernyms marking a group of people or animals (CGEL ch. 5 collectives).
const COLLECTIVE_ANCESTORS = new Set(['social group', 'animal group', 'gathering (of persons)', 'people']);
// Evidence switches for measurement only (env WL_OFF), see erg/ablate.js.
const LEX_OFF = new Set(String((typeof process !== 'undefined' && process.env && process.env.WL_OFF) || '').split(',').filter(Boolean));
// Attested verb-frame types that passed the ERG validation rule (marginal
// sentences ERG-analysed at >= 0.8 of the length-matched curated rate).
const FRAME_VALIDATED = new Set((typeof process !== 'undefined' && process.env && process.env.WL_ALL_FRAMES) ? ['intr', 'tr', 'ditr', 'cop', 'toinf', 'clause'] : ['intr']);
const ZERO_PLURAL = new Set(['staff']);
const MODAL_WORDS = new Set(['can', 'must', 'will']);
// v1.1 fused-head list ("the sick"): kept as curated, not generalised.
const FUSED_HEAD_ADJ = new Set(['sick', 'wise', 'innocent', 'young', 'old', 'rich', 'blind']);

function onsetOf(entry) {
  const c = entry && entry.pronunciation_onset && entry.pronunciation_onset.class;
  return c === 'vowel' ? 'v' : c === 'consonant' ? 'c' : 'x';
}

function compileLexicon(v11, oewn, options = {}) {
  const erg = options.erg || null;
  const profile = options.profile || 'default'; // 'default' | 'exploratory'
  const enableTiers = new Set(profile === 'exploratory' ? ['curated', 'attested', 'derived', 'inferred'] : ['curated', 'attested', 'derived']);
  const entries = v11.entries;
  if (!Array.isArray(entries) || entries.length !== 2048) throw new Error('Expected the 2,048-word BIP39 lexicon');
  const byWord = new Map(entries.map(e => [e.word, e]));
  const lex = new Map();            // word -> readings (blue / hypothetical tiles)
  const policy = {profile, changes: [], disabled: [], inferredPool: [], counts: {}};
  const count = k => { policy.counts[k] = (policy.counts[k] || 0) + 1; };
  const preps = new Set(Object.entries(NON_BIP39_FUNCTION_WORDS).filter(([, rs]) => rs.some(r => r[0] === 'P')).map(([w]) => w));
  for (const e of entries) for (const r of e.readings) if (r.proposed_for_parser && r.pos === 'preposition') preps.add(e.word);

  function add(word, cat, f, tier, src, note) {
    if (!lex.has(word)) lex.set(word, []);
    const list = lex.get(word);
    const key = cat + JSON.stringify(f);
    const prior = list.find(x => x.key === key);
    if (prior) { if (TIER_COST[tier] < TIER_COST[prior.tier]) Object.assign(prior, {tier, src, note}); return; }
    if (!enableTiers.has(tier)) return;
    list.push({key, cat, f, tier, src, note});
    count(tier + ':' + cat);
    if (tier !== 'curated') policy.changes.push({word, cat, f, tier, src, note});
  }

  const lexfiles = (oewn && oewn.noun_lexfiles) || {};
  for (const e of entries) {
    const w = e.word, on = onsetOf(e);
    const rs = e.readings.filter(r => r.proposed_for_parser);
    for (const r of e.readings) if (!r.proposed_for_parser) policy.disabled.push({word: w, pos: r.pos});
    // ---- nouns
    for (const r of rs.filter(r => r.pos === 'noun')) {
      const a = r.attributes || {};
      const nums = a.number === 'plural' ? ['pl'] : a.number === 'singular_or_plural' ? ['sg', 'pl'] : ['sg'];
      const cnts = ['mass', 'uncountable'].includes(a.countability) ? ['mass'] : a.countability === 'count_and_mass' ? ['count', 'mass'] : ['count'];
      for (const n of nums) for (const c of cnts) {
        if (n === 'pl' && c === 'mass') continue;
        add(w, 'N', {num: n, cnt: c, on}, 'curated', 'v1.1');
      }
      const wik = (r.evidence && r.evidence.wiktionary_noun_attestations) || [];
      if (nums.includes('sg') && wik.includes('mass') && !cnts.includes('mass') && !LEX_OFF.has('MASS'))
        add(w, 'N', {num: 'sg', cnt: 'mass', on}, 'attested', 'Simple English Wiktionary (Kaikki) noun marked uncountable', 'mass reading');
      if (nums.includes('sg') && wik.includes('count') && !cnts.includes('count'))
        add(w, 'N', {num: 'sg', cnt: 'count', on}, 'attested', 'Simple English Wiktionary (Kaikki) noun marked countable', 'count reading');
      // Zero-plural nouns (CGEL ch. 5): the singular form is also a true
      // plural ("ten staff", "staff sign"). Curated, short and cited.
      if (ZERO_PLURAL.has(w)) add(w, 'N', {num: 'pl', cnt: 'count', on}, 'attested', 'CGEL ch. 5 zero-plural noun', 'plural form identical to singular');
      const lf = lexfiles[w] || [];
      const first = (oewn && oewn.noun_first_sense_lexfile || {})[w];
      const anc = (oewn && oewn.noun_first_group_sense_ancestors || {})[w] || [];
      const humanOrAnimalGroup = anc.some(a => COLLECTIVE_ANCESTORS.has(a));
      if (nums.includes('sg') && first === 'noun.group' && humanOrAnimalGroup)
        add(w, 'N', {num: 'pl', cnt: 'coll', on}, 'derived', 'OEWN 2025 first-listed noun sense is noun.group + CGEL ch. 5 (collective nouns permit plural agreement in BrE/NZE)', 'collective: notional plural (staff are, many staff)');
      else if (nums.includes('sg') && lf.includes('noun.group'))
        policy.inferredPool.push({word: w, cat: 'N', f: {num: 'pl'}, premise: first === 'noun.group' ? 'first OEWN sense is noun.group but not a group of people or animals (e.g. an arrangement)' : 'a non-primary OEWN sense is noun.group'});
      const massNow = (lex.get(w) || []).some(x => x.cat === 'N' && x.f.cnt === 'mass');
      if (!massNow && nums.includes('sg') && (lf.includes('noun.substance') || lf.includes('noun.food'))) {
        policy.inferredPool.push({word: w, cat: 'N', f: {num: 'sg', cnt: 'mass'}, premise: 'OEWN lexfile ' + lf.filter(x => x === 'noun.substance' || x === 'noun.food').join('+')});
        add(w, 'N', {num: 'sg', cnt: 'mass', on}, 'inferred', 'OEWN substance/food lexfile (heuristic only)', 'possible mass reading');
      }
    }
    // ---- adjectives
    for (const r of rs.filter(r => r.pos === 'adjective')) {
      const p = (r.attributes || {}).position || '';
      if (p !== 'predicative_only') add(w, 'Adj', {u: 'attr', on}, 'curated', 'v1.1');
      if (p !== 'attributive_only' && p !== 'attributive') add(w, 'Adj', {u: 'pred', on}, 'curated', 'v1.1');
      if (FUSED_HEAD_ADJ.has(w)) add(w, 'AdjFused', {}, 'curated', 'v1.1 fused-head list');
    }
    // ---- adverbs
    for (const r of rs.filter(r => r.pos === 'adverb')) {
      const cls = (r.attributes || {}).class || 'unspecified';
      if (cls === 'degree' || V11_DEGREE.includes(w)) add(w, 'AdvDeg', {pa: 'both', on}, 'curated', 'v1.1 class ' + cls);
      if (['frequency', 'focus', 'additive', 'manner'].includes(cls) || V11_PREVERB.includes(w)) add(w, 'AdvPre', {}, 'curated', 'v1.1 class ' + cls);
      if (['time', 'place', 'postverbal_place_or_medium', 'manner'].includes(cls) || V11_POST.includes(w)) add(w, 'AdvPost', {}, 'curated', 'v1.1 class ' + cls);
      if (cls === 'focus') add(w, 'AdvFocus', {}, 'curated', 'v1.1 class focus');
    }
    if (DEGREE_ADDITIONS[w]) add(w, 'AdvDeg', {pa: 'both', on}, 'attested', DEGREE_ADDITIONS[w], 'degree modifier');
    // ---- verbs
    for (const r of rs.filter(r => r.pos === 'verb')) {
      const a = r.attributes || {};
      const forms = a.surface_forms || ['base'];
      const vfs = [];
      if (forms.includes('base')) vfs.push('base');
      if (forms.includes('past')) vfs.push('past');
      if (forms.includes('past_participle')) vfs.push('ppart');
      const curatedFrames = new Set();
      for (const fr of a.candidate_frames || []) {
        const m = V11_FRAME_MAP[fr]; if (!m) continue;
        curatedFrames.add(m);
        for (const vf of vfs) {
          if (m === 'prep') for (const p of a.requires_particle_or_preposition || []) { if (preps.has(p)) add(w, 'VPrep', {p, vf}, 'curated', 'v1.1'); }
          else add(w, 'V', {fr: m, vf}, 'curated', 'v1.1');
        }
      }
      // Attested frames from WordNet sentence frames and Wiktionary usage tags.
      const ev = r.evidence || {};
      const att = new Map();
      for (const id of ev.wordnet_verb_frame_ids || []) { const m = WN_FRAME_MAP[id]; if (m) att.set(m, (att.get(m) || []).concat('WN frame ' + id)); }
      for (const t of ev.wiktionary_verb_usage_tags || []) for (const m of WIKT_TAG_MAP[t] || []) att.set(m, (att.get(m) || []).concat('Wiktionary ' + t));
      // ERG lexicon (hand-built reference grammar): verb-specific frames.
      // An optional object (v_np*_le) licenses both transitive and
      // intransitive use ("Detect the cat." / "Detect."). Phase 1, 2026-10-19.
      const ergV = ((erg && erg.verbs) || {})[w];
      if (ergV && !(a.requires_particle_or_preposition || []).length && !LEX_OFF.has('ERG')) {
        const map = {optional_object: ['tr', 'intr'], intransitive: ['intr'], transitive: ['tr'], ditransitive: ['ditr'], to_infinitive: ['toinf'], clause: ['clause']};
        for (const c of ergV.classes) for (const m of map[c] || []) {
          if (curatedFrames.has(m)) continue;
          const ent = ergV.entries.filter(x => ({optional_object: /^v_np\*/, intransitive: /^v_-_(le|unacc_le)$/, transitive: /^v_np(_noger)?_le$/, ditransitive: /^v_np-np(_only)?_le$/, to_infinitive: /^v_vp_seq_le$/, clause: /^v_cp(_prop)?_le$/})[c].test(x.type)).map(x => x.entry + ' := ' + x.type);
          for (const vf of vfs) add(w, 'V', {fr: m, vf}, 'attested', 'ERG lexicon: ' + ent.join('; '), c === 'optional_object' && m === 'intr' ? 'object omission (optional object)' : 'verb frame ' + m + ' (ERG)');
        }
      }
      for (const [m, srcs] of att) {
        if (curatedFrames.has(m)) continue;
        if (LEX_OFF.has('VF_' + m)) continue;
        // Verbs v1.1 marks as requiring a particle/preposition do not gain a bare frame.
        if ((a.requires_particle_or_preposition || []).length) continue;
        // ERG validation (2026-10-19, length-controlled): sentences admitted only
        // by added intransitive frames were ERG-analysed at 0.82 of the curated
        // rate; added tr/ditr/copular/to-infinitive/clause frames at 0.33-0.70.
        // Those are demoted to 'inferred' (recorded, not enabled by default).
        const tier = FRAME_VALIDATED.has(m) ? 'attested' : 'inferred';
        if (tier === 'inferred') policy.inferredPool.push({word: w, cat: 'V', f: {fr: m}, premise: 'WordNet/Wiktionary ' + m + ' frame failed ERG validation (2026-10-19)'});
        for (const vf of vfs) add(w, 'V', {fr: m, vf}, tier, [...new Set(srcs)].join('; '), 'verb frame ' + m);
      }
    }
    // ---- closed classes recorded in the lexicon
    for (const r of rs) {
      const a = r.attributes || {};
      if (r.pos === 'preposition') add(w, 'P', {p: w}, 'curated', 'v1.1');
      if (r.pos === 'modal' || MODAL_WORDS.has(w) && r.pos === 'modal') add(w, 'Modal', {}, 'curated', 'v1.1');
      if (r.pos === 'subordinator') { if (w === 'that') add(w, 'Comp', {}, 'curated', 'v1.1'); else add(w, 'Sub', {}, 'curated', 'v1.1'); }
      if (r.pos === 'auxiliary' && w === 'have') add(w, 'HaveAux', {ht: 'have'}, 'curated', 'v1.1');
      if (r.pos === 'determiner') {
        if (DET_DISABLED.has(w)) { policy.disabled.push({word: w, pos: 'determiner', reason: 'determiner selection too vague to license'}); continue; }
        const d = DET_OVERRIDE[w] || NUMERAL_DET[w] || DET_SELECTS[a.selects];
        if (d) add(w, 'Det', {d}, 'curated', 'v1.1 selects ' + a.selects);
      }
      if (r.pos === 'numeral' && NUMERAL_DET[w]) add(w, 'Det', {d: NUMERAL_DET[w]}, 'curated', 'v1.1 numeral');
      if (r.pos === 'pronoun') {
        const per = String(a.person || '');
        const nums = a.number === 'singular' ? ['sg'] : a.number === 'plural' || a.number === 'plural_or_mass' ? ['pl'] : a.number === 'either' ? ['sg', 'pl'] : [];
        const kase = a.case === 'subject' ? 'nom' : a.case === 'object' ? 'acc' : a.case === 'reflexive' ? 'refl' : a.case === 'subject_or_object' ? 'any' : null;
        if (!['1', '2', '3'].includes(per) || !nums.length || !kase) { policy.disabled.push({word: w, pos: 'pronoun', reason: 'person/number/case unknown'}); continue; }
        for (const n of nums) add(w, 'Pron', {num: n, per, case: kase}, 'curated', 'v1.1');
      }
    }
    for (const [cat, f] of BIP39_FUNCTION_SUPPLEMENTS[w] || []) add(w, cat, f, 'curated', 'closed-class supplement');
  }
  // ---- idiomatic bare-noun PPs: "on stage", "in fun", "at sea", "by hand".
  // Attested only: an OEWN multiword lemma "<P> <N>" used adverbially or
  // adjectivally, or >= 3 bare uses in OEWN definitions/examples.
  const idioms = [];
  if (oewn) {
    const cand = new Map();
    const closed = new Set(oewn.closed_form_prep_noun || []);
    for (const [k, poss] of Object.entries(oewn.prep_noun_mwe || {})) if (poss.some(p => p === 'r' || p === 'a' || p === 's')) cand.set(k, 'OEWN 2025 multiword lemma "' + k + '"');
    // Usage criterion: >= 3 bare uses AND bare uses at least as frequent as
    // determiner uses with the same preposition ("on foot" vs "on the foot").
    // 'of' is excluded (OEWN definitions use "of N" for mass/genitive senses).
    for (const [k, v] of Object.entries(oewn.bare_prep_noun_usage || {})) {
      if (cand.has(k) || k.startsWith('of ')) continue;
      const det = v.with_determiner || 0;
      if (v.count >= 3 && v.count >= det) cand.set(k, 'OEWN 2025: ' + v.count + ' bare vs ' + det + ' determiner uses in definitions/examples');
      // A lexicalised closed form (onstage, aboard) plus >= 3 bare uses.
      else if (v.count >= 3 && closed.has(k)) cand.set(k, 'OEWN 2025: closed form "' + k.replace(' ', '') + '" (adv/adj) + ' + v.count + ' bare uses');
    }
    for (const [k, src] of cand) {
      const [p, n] = k.split(' ');
      if (!preps.has(p) || !byWord.has(n)) continue;
      const rs = lex.get(n) || [];
      // Only needed (and only added) for nouns with no mass/plural bare use.
      if (!rs.some(x => x.cat === 'N' && x.f.num === 'sg' && x.f.cnt === 'count')) continue;
      if (rs.some(x => x.cat === 'N' && x.f.cnt === 'mass')) continue;
      if (rs.some(x => x.cat === 'Pron')) continue; // 'someone' etc. are already NPs
      if (LEX_OFF.has('IDIOM')) continue;
      add(n, 'NIdiom', {p}, 'attested', src, 'bare noun after "' + p + '"');
      idioms.push(k);
    }
  }
  policy.idiomPPs = idioms.sort();
  // ---- non-BIP39 function words (gold helpers only)
  const helperOnly = new Map();
  for (const [w, rs] of Object.entries(NON_BIP39_FUNCTION_WORDS)) helperOnly.set(w, rs.map(([cat, f]) => ({key: cat + JSON.stringify(f), cat, f, tier: 'curated', src: 'helper table'})));
  const idiomPreps = [...new Set(idioms.map(k => k.split(' ')[0]))];
  return {lex, helperOnly, policy, preps: [...preps].sort(), idiomPreps, byWord, TIER_COST};
}

// Readings available to a tile, given its provenance.
function readingsFor(compiled, word, source) {
  const w = String(word).toLowerCase();
  const blue = compiled.lex.get(w) || [];
  const fn = compiled.helperOnly.get(w) || [];
  if (source === 'helper') {
    if (!(compiled.helperSet || HELPER_SET).has(w)) return [];
    const gold = [...fn, ...blue.filter(r => GOLD_ROLE_CATS.has(r.cat))];
    for (const [cat, f] of GOLD_EXPLICIT_EXTRA[w] || []) if (!gold.some(r => r.cat === cat && JSON.stringify(r.f) === JSON.stringify(f))) gold.push({key: cat + JSON.stringify(f), cat, f, tier: 'curated', src: 'gold role policy'});
    return gold;
  }
  // collected (blue) or hypothetical (purple): every supported reading
  return blue.length ? blue : [];
}

module.exports = {compileLexicon, readingsFor, HELPER_CANDIDATES, TIER_COST, NON_BIP39_FUNCTION_WORDS, GOLD_ROLE_CATS, onsetOf};
