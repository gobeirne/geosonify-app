'use strict';
/*
 * Starpin Word Lab — scorer v0.4 (2026-10-21).
 *
 * scoreReading(reading, tiles) -> {score, preview, breakdown}
 * Scores ONE reading: the canonical reading, or the one the player pinned.
 *
 * Design (user decision 2026-10-21): reward varied, satisfying sentences, not
 * repetitive clause chains, and never penalise long noun compounds.
 *  - Word points: blue tiles only. Core roles 10; blue tiles in closed-class
 *    roles 4; adjective/adverb modifiers of one head 10, 7, 4.9 … (stacks
 *    taper); noun-compound modifiers a flat 10 each (no taper); bare one-word
 *    list items taper from the third.
 *  - Size multiplier on word points: 1 + 0.6·(1 − 0.85^(B−1)), B = blue tiles.
 *  - Construction points: each kind of construction present earns points;
 *    each repeat of the same kind in a sentence earns 0.4× the previous one.
 *    A construction counts only when anchored by blue tiles; clause-level
 *    constructions need at least two blue tiles on each side.
 *  - Nominal fragments ×0.6. No fixed per-sentence bonus.
 * Invariants (tests/run_scoring.js): P1 recognised + blue tile ⇒ score > 0;
 * P2 adding a blue tile in a new role never lowers the score; P3′ gold-only
 * material earns nothing; P4′ repeated constructions converge, a new kind
 * beats another repeat; P5 adjective stacks are bounded, noun compounds always
 * out-score adjective stacks of the same length; P6 score from one reading.
 */
const SCORE_VERSION = 'phase2-0.4.0';
const G = require('./grammar');
const FAM = Object.fromEntries(G.RULES.map(r => [r.id, r.fam]));

const P = Object.freeze({
  CORE: 10, FUNCTION: 4,
  ADJ: 10, ADJ_R: 0.7,          // adjective/adverb stacks per head
  CMP: 10,                       // noun-compound modifiers: flat
  LIST_R: 0.7,
  SIZE: 0.6, SIZE_R: 0.85,
  REPEAT: 0.4,                   // each repeat of a construction kind earns 0.4× the previous
  CLAUSE_MIN_BLUE: 2,            // clause-level constructions: blue tiles needed on each side
  EMBED: 8, EMBED_MAX: 3,
  FRAGMENT: 0.6,
  // Construction points scale with the sentence's substance: full value from
  // CONS_FULL blue tiles, proportionally less below (none for one blue tile),
  // so short sentences cannot farm structure.
  CONS_FULL: Number((typeof process !== 'undefined' && process.env && process.env.WL_CONS_FULL) || 8),
});
// First-instance points per construction kind.
const W = Object.freeze({
  subordinate_clause: 48, relative_clause: 48, complement_clause: 48, causal_for_coordination: 48, infinitive: 42,
  question: 18, imperative_declarative_coordination: 36,
  clause_coordination: 30, predicate_coordination: 30, ditransitive: 30,
  verb_coordination: 24, noun_coordination: 24, copula: 24, lexical_copula: 24, prepositional_phrase: 24,
  vp_ellipsis: 24, perfect: 24, prepositional_verb: 24, bare_idiomatic_pp: 24,
  focus_modifier: 18, degree_modifier: 18, postverbal_adverb: 18, preverbal_adverb: 18, negation: 18,
  proper_noun: 12, do_support: 12,
  verb_object: 9, adjective_modifier: 6, noun_compound: 6, modal: 6,
});
const LABEL = {
  subordinate_clause: 'subordinate clause', relative_clause: 'relative clause', complement_clause: 'complement clause',
  causal_for_coordination: 'causal “for”', infinitive: 'infinitive', question: 'question', imperative_declarative_coordination: 'instruction + statement',
  imperative: 'instruction', clause_coordination: 'joined clauses', predicate_coordination: 'shared-subject predicates', ditransitive: 'two objects',
  verb_coordination: 'joined verbs', noun_coordination: 'joined nouns', copula: '“is/are” predicate', lexical_copula: 'linking verb',
  prepositional_phrase: 'prepositional phrase', vp_ellipsis: 'ellipsis', perfect: 'perfect (“has …”)', prepositional_verb: 'verb + preposition',
  bare_idiomatic_pp: 'idiomatic phrase', focus_modifier: 'focus word', degree_modifier: 'degree word', postverbal_adverb: 'adverb', preverbal_adverb: 'adverb',
  negation: 'negation', proper_noun: 'proper name', do_support: 'emphatic “do”', verb_object: 'verb + object', adjective_modifier: 'adjective',
  noun_compound: 'noun compound', modal: 'modal',
};
const CLAUSE_LEVEL = new Set(['subordinate_clause', 'relative_clause', 'complement_clause', 'causal_for_coordination', 'infinitive',
  'imperative_declarative_coordination', 'clause_coordination', 'predicate_coordination', 'verb_coordination']);
const EMBEDDING = new Set(['complement_clause', 'infinitive', 'relative_clause']);
// One instance per rule application, counted on the rule's main dependency:
// its first dependency that is not a marker (cc/det/mark/case). For a copula
// the main dependency is 'cop'; for a modal, 'aux'.
const MARKERS = new Set(['cc', 'det', 'mark', 'case']);
const PRIMARY = Object.fromEntries(G.RULES.map(r => [r.id, ((r.deps || []).find(([, t]) => !MARKERS.has(t)) || [])[1] || null]));
const isInstanceRel = r => PRIMARY[r.rule] === r.type;
const FUNCTION_POS = new Set(['Det', 'P', 'Conj', 'Sub', 'Comp', 'Rel', 'Modal', 'Cop', 'Do', 'HaveAux', 'Not', 'To', 'ForCoord', 'Be']);
const MOD_POS = new Set(['AdvDeg', 'AdvPre', 'AdvPost', 'AdvFocus', 'AdvFront']);

function scoreReading(reading, tiles) {
  const n = tiles.length;
  const blue = tiles.map(t => t.source === 'collected' || t.source === 'hypothetical');
  const preview = tiles.some(t => t.source === 'hypothetical');
  const rel = reading.relations;
  const children = new Map();
  for (const r of rel) { if (!children.has(r.head)) children.set(r.head, []); children.get(r.head).push(r); }
  const items = [];
  // ---- word points
  const groups = new Map(), lexClass = new Array(n).fill(null);
  const grp = h => { if (!groups.has(h)) groups.set(h, {adj: [], cmp: []}); return groups.get(h); };
  for (let i = 0; i < n; i++) {
    if (!blue[i]) continue;
    const r = reading.roles[i], d = rel.find(x => x.dep === i);
    if (r.role === 'compound') { grp(d.head).cmp.push(i); lexClass[i] = 'compound'; }
    else if (r.role === 'amod' || (r.role === 'advmod' && MOD_POS.has(r.pos))) { grp(d ? d.head : -1).adj.push(i); lexClass[i] = 'modifier'; }
    else if (FUNCTION_POS.has(r.pos)) lexClass[i] = 'function';
    else lexClass[i] = 'core';
  }
  for (const [, g] of groups) {
    g.adj.sort((a, b) => a - b).forEach((i, k) => items.push({tok: i, word: tiles[i].word, class: 'modifier', points: P.ADJ * Math.pow(P.ADJ_R, k), note: k ? 'stack ' + (k + 1) : ''}));
    g.cmp.forEach(i => items.push({tok: i, word: tiles[i].word, class: 'compound', points: P.CMP, note: ''}));
  }
  const level = rule => /^np|^nptail/.test(rule) ? 'np' : /^vp|^vptail/.test(rule) ? 'vp' : /^fp|^fptail/.test(rule) ? 'fp' : 's';
  const conjOf = new Map();
  for (const r of rel) if (r.type === 'conj') conjOf.set(r.dep, {head: r.head, level: level(r.rule)});
  const chainRoot = i => { const lv = conjOf.get(i).level; let x = i, g = 0; while (conjOf.has(x) && conjOf.get(x).level === lv && g++ < 100) x = conjOf.get(x).head; return x + ':' + lv; };
  const isBare = i => (children.get(i) || []).every(r => r.type === 'cc' || r.type === 'conj');
  const chains = new Map(), listTaper = new Map();
  for (const [dep] of conjOf) { const key = chainRoot(dep); if (!chains.has(key)) chains.set(key, [Number(key.split(':')[0])]); chains.get(key).push(dep); }
  for (const members of chains.values()) { members.sort((a, b) => a - b); let k = 0; for (const m of members) if (isBare(m)) { k++; if (k >= 3) listTaper.set(m, Math.pow(P.LIST_R, k - 2)); } }
  for (let i = 0; i < n; i++) {
    if (!blue[i]) continue;
    if (lexClass[i] === 'core') { const f = listTaper.get(i) || 1; items.push({tok: i, word: tiles[i].word, class: 'core', points: P.CORE * f, note: f < 1 ? 'list item' : ''}); }
    if (lexClass[i] === 'function') items.push({tok: i, word: tiles[i].word, class: 'function', points: P.FUNCTION, note: reading.roles[i].pos});
  }
  // ---- constructions
  const subtree = (i, skip) => { const out = [i], st = [i]; while (st.length) { const x = st.pop(); for (const r of children.get(x) || []) { if (skip && skip(r)) continue; out.push(r.dep); st.push(r.dep); } } return out; };
  const blueIn = toks => toks.filter(t => blue[t]).length;
  const isClauseRel = r => CLAUSE_LEVEL.has(FAM[r.rule]) && isInstanceRel(r);
  const anchoredTok = i => blue[i] || (children.get(i) || []).some(r => (r.type === 'nsubj' || r.type === 'obj') && blue[r.dep]);
  const instances = [], unanchored = [];
  for (const r of rel) {
    const fam = FAM[r.rule];
    if (!fam || !W[fam] || !isInstanceRel(r)) continue;
    let ok;
    if (CLAUSE_LEVEL.has(fam)) {
      const depSide = subtree(r.dep, q => isClauseRel(q)), headSide = subtree(r.head, q => isClauseRel(q));
      ok = anchoredTok(r.head) && anchoredTok(r.dep) && blueIn(depSide) >= P.CLAUSE_MIN_BLUE && blueIn(headSide) >= P.CLAUSE_MIN_BLUE;
    } else ok = blue[r.dep] || blue[r.head];
    (ok ? instances : unanchored).push({fam, head: r.head, dep: r.dep});
  }
  // Kinds that are a property of the whole utterance.
  const anyBlue = blue.some(Boolean);
  // Points: first instance of a kind full value, each repeat REPEAT× the previous.
  const byFam = new Map();
  for (const x of instances.sort((a, b) => a.dep - b.dep)) { if (!byFam.has(x.fam)) byFam.set(x.fam, []); byFam.get(x.fam).push(x); }
  const constructions = [];
  let consPts = 0;
  for (const [fam, xs] of byFam) {
    let pts = 0; xs.forEach((x, k) => { pts += W[fam] * Math.pow(P.REPEAT, k); });
    consPts += pts; constructions.push({family: fam, label: LABEL[fam] || fam.replace(/_/g, ' '), count: xs.length, points: +pts.toFixed(2)});
  }
  constructions.sort((a, b) => b.points - a.points);
  // Embedding depth (argument clauses inside argument clauses).
  const emb = instances.filter(x => EMBEDDING.has(x.fam));
  const dominates = (a, b) => { let x = b, g = 0; while (g++ < 200) { if (x === a) return true; const r = rel.find(q => q.dep === x); if (!r) return false; x = r.head; } return false; };
  const memo = new Map();
  const depthOf = l => { if (memo.has(l.dep)) return memo.get(l.dep); memo.set(l.dep, 1); let d = 1; for (const o of emb) if (o !== l && o.dep !== l.dep && dominates(o.dep, l.head)) d = Math.max(d, 1 + depthOf(o)); memo.set(l.dep, d); return d; };
  const depth = emb.reduce((m, l) => Math.max(m, depthOf(l)), 0);
  const embedBonus = depth > 1 ? P.EMBED * Math.min(depth - 1, P.EMBED_MAX) : 0;
  // ---- total
  const lexicalBase = items.reduce((a, x) => a + x.points, 0);
  const B = blue.filter(Boolean).length;
  const M = B ? 1 + P.SIZE * (1 - Math.pow(P.SIZE_R, B - 1)) : 1;
  const lexical = lexicalBase * M;
  const substance = B <= 1 ? 0 : Math.min(1, (B - 1) / (P.CONS_FULL - 1));
  const structural = (consPts + embedBonus) * substance;
  const factor = reading.utteranceType === 'fragment' ? P.FRAGMENT : 1;
  const raw = (lexical + structural) * factor;
  const tok = i => i >= 0 ? tiles[i].word : '';
  const clauseInst = instances.filter(x => CLAUSE_LEVEL.has(x.fam));
  return {
    score: Math.round(raw), exact: raw, preview, version: SCORE_VERSION,
    breakdown: {
      tiles: items.sort((a, b) => a.tok - b.tok).map(x => ({...x, points: +x.points.toFixed(2)})),
      constructions,
      // compatibility with the interface (clause-level constructions)
      links: clauseInst.map(x => ({type: x.fam, head: tok(x.head), dep: tok(x.dep), points: 0})),
      unanchoredLinks: unanchored.filter(x => CLAUSE_LEVEL.has(x.fam)).map(x => ({type: x.fam, head: tok(x.head), dep: tok(x.dep), reason: 'each joined part needs at least ' + P.CLAUSE_MIN_BLUE + ' blue tiles'})),
      distinctLinkTypes: [...new Set(clauseInst.map(x => x.fam))], typeBonus: 0, embeddingDepth: depth, embedBonus,
      constructionPoints: +(consPts * substance).toFixed(2), substance: +substance.toFixed(3),
      lexicalBase: +lexicalBase.toFixed(2), sizeMultiplier: +M.toFixed(3), blueTiles: B,
      lexical: +lexical.toFixed(2), structural: +structural.toFixed(2), fragmentFactor: factor,
    },
  };
}

function scoreResult(result, chosenReading = null) {
  if (!result || result.state !== 'recognised') return {score: 0, status: result && result.state === 'invalid_tiles' ? 'invalid' : 'pending', version: SCORE_VERSION};
  const reading = chosenReading || result.canonical;
  const s = scoreReading(reading, result.tiles);
  return {...s, status: s.preview ? 'preview' : 'scored', readingId: reading.id, pinned: !!result.pins};
}
function scorePortfolio(sentences) { return {total: sentences.reduce((a, s) => a + (s.score || 0), 0), sentences: sentences.length}; }

module.exports = {scoreReading, scoreResult, scorePortfolio, SCORE_VERSION, PARAMS: P, WEIGHTS: W, LABELS: LABEL};
