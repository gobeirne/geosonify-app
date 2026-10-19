'use strict';
/*
 * Starpin Word Lab — Phase 2 scorer.
 *
 * scoreReading(reading, tiles) -> {score, preview, breakdown}
 *
 * Scores ONE reading: the canonical reading, or the one the player pinned.
 * The reading is chosen by the grammar's preference model, never by score.
 *
 * Invariants (tested in tests/run_scoring.js):
 *  P1  a recognised utterance with at least one blue tile scores > 0;
 *  P2  adding a blue tile in a genuine new role never lowers the score;
 *  P3' gold tiles earn no lexical points; a relation earns points only when
 *      both related constituents are blue-anchored;
 *  P4' all clause-linking relations share one geometrically tapering budget,
 *      whatever the conjunction; distinct relation types and genuine
 *      embedding are rewarded separately and boundedly;
 *  P5  modifier stacks are bounded; the noun-compound bound is far above the
 *      adjective bound;
 *  P6  the score comes from the canonical or pinned reading only;
 *  P7  the portfolio score is the order-independent sum of sentence scores.
 * Joining: the size multiplier increases with blue tiles, so joining never
 * lowers lexical points; because clause links taper per sentence, splitting
 * a very long chain can regain a few link points (measured, bounded).
 */
const SCORE_VERSION = 'phase2-0.3.0';

const P = Object.freeze({
  CORE: 10,               // head of an argument or predicate
  FUNCTION: 4,            // a blue tile used in a closed-class role
  ADJ: 10, ADJ_R: 0.7,    // adjective/adverb modifiers per head: 10, 7, 4.9 ... bound 33
  CMP: 10, CMP_R: 0.9,    // noun-compound modifiers per head: 10, 9, 8.1 ... bound 100
  LIST_R: 0.7,            // bare one-word conjuncts from the third onward
  SIZE: 0.6, SIZE_R: 0.85,// size multiplier M(B) = 1 + SIZE*(1 - SIZE_R^(B-1)), B = blue tiles; bound 1.6
  LINK: 12, LINK_R: 0.6,  // clause links between substantive constituents: bound 30
  LINK_MIN_BLUE: 2,       // each linked constituent must contain >= 2 blue tiles
  TYPE_A: 10, TYPE_B: 6,  // distinct link types T: A*T + B*T*(T-1) = 10, 32, 66, 112, 170, 240; T <= 6
  EMBED: 8, EMBED_MAX: 3, // argument-clause embedding depth bonus
  FRAGMENT: 0.6,          // non-sentential (nominal) utterances
});

const FUNCTION_POS = new Set(['Det', 'P', 'Conj', 'Sub', 'Comp', 'Rel', 'Modal', 'Cop', 'Do', 'HaveAux', 'Not', 'To', 'ForCoord', 'Be']);
const MOD_POS = new Set(['AdvDeg', 'AdvPre', 'AdvPost', 'AdvFocus']);
// Clause-linking relation types, keyed by the grammar rule that creates them.
const LINK_TYPE = {
  s_coord: 'coordination', stail1: 'coordination', stail2: 'coordination', vp_coord: 'coordination', vptail1: 'coordination', vptail2: 'coordination',
  fp_coord: 'coordination', fptail1: 'coordination', fptail2: 'coordination', imp_and_s: 'coordination',
  utt_for: 'causal_for',
  s_sub_final: 'subordination', s_sub_front: 'subordination', imp_sub: 'subordination', imp_sub_front: 'subordination',
  vp_that: 'complement_clause', vp_zero_that: 'complement_clause',
  vp_inf: 'infinitive', np_rel: 'relative_clause',
};
const EMBEDDING = new Set(['complement_clause', 'infinitive', 'relative_clause']);
const LINK_REL = new Set(['conj', 'conj_for', 'advcl', 'ccomp', 'xcomp', 'relcl']);

function scoreReading(reading, tiles) {
  const n = tiles.length;
  const blue = tiles.map(t => t.source === 'collected' || t.source === 'hypothetical');
  const preview = tiles.some(t => t.source === 'hypothetical');
  const rel = reading.relations;
  const depsOf = i => rel.filter(r => r.head === i);
  const items = [];

  // ---- lexical points (blue tiles only)
  const groups = new Map(); // head -> {adj: [], cmp: []}
  const grp = h => { if (!groups.has(h)) groups.set(h, {adj: [], cmp: []}); return groups.get(h); };
  const lexClass = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (!blue[i]) continue;
    const r = reading.roles[i], d = rel.find(x => x.dep === i);
    if (r.role === 'compound') { grp(d.head).cmp.push(i); lexClass[i] = 'compound'; }
    else if (r.role === 'amod' || (r.role === 'advmod' && MOD_POS.has(r.pos))) { grp(d ? d.head : -1).adj.push(i); lexClass[i] = 'modifier'; }
    else if (FUNCTION_POS.has(r.pos)) lexClass[i] = 'function';
    else lexClass[i] = 'core';
  }
  for (const [h, g] of groups) {
    g.adj.sort((a, b) => a - b).forEach((i, k) => items.push({tok: i, word: tiles[i].word, class: 'modifier', points: P.ADJ * Math.pow(P.ADJ_R, k), note: k ? 'stack ' + (k + 1) : ''}));
    g.cmp.sort((a, b) => a - b).forEach((i, k) => items.push({tok: i, word: tiles[i].word, class: 'compound', points: P.CMP * Math.pow(P.CMP_R, k), note: k ? 'compound ' + (k + 1) : ''}));
  }
  // List-like conjuncts: a coordination chain's bare one-word members (no
  // dependents of their own besides the coordinator) taper from the third.
  // Chains are followed within one coordination level only (NP, VP,
  // predicate or clause), so a clause-level join never merges two lists.
  const listTaper = new Map();
  const level = rule => /^np|^nptail/.test(rule) ? 'np' : /^vp|^vptail/.test(rule) ? 'vp' : /^fp|^fptail/.test(rule) ? 'fp' : 's';
  const conjOf = new Map();
  for (const r of rel) if (r.type === 'conj') conjOf.set(r.dep, {head: r.head, level: level(r.rule)});
  const chainRoot = i => { const lv = conjOf.get(i).level; let x = i, g = 0;
    while (conjOf.has(x) && conjOf.get(x).level === lv && g++ < 100) x = conjOf.get(x).head; return x + ':' + lv; };
  const isBare = i => depsOf(i).every(r => r.type === 'cc' || r.type === 'conj');
  const chains = new Map();
  for (const [dep] of conjOf) { const key = chainRoot(dep); const root = Number(key.split(':')[0]); if (!chains.has(key)) chains.set(key, [root]); chains.get(key).push(dep); }
  for (const members of chains.values()) {
    members.sort((a, b) => a - b);
    let k = 0;
    for (const m of members) { if (isBare(m)) { k++; if (k >= 3) listTaper.set(m, Math.pow(P.LIST_R, k - 2)); } }
  }
  for (let i = 0; i < n; i++) {
    if (!blue[i]) continue;
    if (lexClass[i] === 'core') { const f = listTaper.get(i) || 1; items.push({tok: i, word: tiles[i].word, class: 'core', points: P.CORE * f, note: f < 1 ? 'list item' : ''}); }
    if (lexClass[i] === 'function') items.push({tok: i, word: tiles[i].word, class: 'function', points: P.FUNCTION, note: reading.roles[i].pos});
  }

  // ---- clause links (P3', P4')
  // A constituent is blue-anchored if its head tile is blue, or (for
  // ellipsis, where the head is an auxiliary) its subject's head is blue.
  // A link counts only between SUBSTANTIVE constituents: each side must be
  // blue-anchored (blue head, or for ellipsis a blue subject) and contain at
  // least LINK_MIN_BLUE blue tiles. The head side excludes the subtrees of
  // its other clause links, so a chain is measured clause by clause.
  const anchored = i => blue[i] || rel.some(r => r.head === i && r.type === 'nsubj' && blue[r.dep]);
  const children = new Map();
  for (const r of rel) { if (!children.has(r.head)) children.set(r.head, []); children.get(r.head).push(r); }
  const subtree = (i, skip) => { const outT = [i], st = [i];
    while (st.length) { const x = st.pop(); for (const r of children.get(x) || []) { if (skip && skip(r)) continue; outT.push(r.dep); st.push(r.dep); } }
    return outT; };
  const blueIn = toks => toks.filter(t => blue[t]).length;
  const isLinkRel = r => LINK_REL.has(r.type) && LINK_TYPE[r.rule];
  const links = [];
  for (const r of rel) {
    if (!isLinkRel(r)) continue;
    const type = LINK_TYPE[r.rule];
    const depSide = subtree(r.dep, q => isLinkRel(q));
    const headSide = subtree(r.head, q => isLinkRel(q));
    const substantive = blueIn(depSide) >= P.LINK_MIN_BLUE && blueIn(headSide) >= P.LINK_MIN_BLUE;
    links.push({type, head: r.head, dep: r.dep, anchored: anchored(r.head) && anchored(r.dep) && substantive, substantive});
  }
  const live = links.filter(l => l.anchored).sort((a, b) => a.dep - b.dep);
  const linkPts = live.map((l, k) => P.LINK * Math.pow(P.LINK_R, k));
  const types = new Set(live.map(l => l.type));
  const T = types.size;
  const typeBonus = P.TYPE_A * T + P.TYPE_B * T * (T - 1);
  // Embedding depth: an argument clause (complement, infinitive, relative)
  // has depth 1 + the depth of the deepest argument clause dominating it.
  const emb = live.filter(l => EMBEDDING.has(l.type));
  const memo = new Map();
  const depthOf = l => {
    if (memo.has(l.dep)) return memo.get(l.dep);
    memo.set(l.dep, 1);
    let d = 1;
    for (const o of emb) if (o !== l && o.dep !== l.dep && dominates(rel, o.dep, l.head)) d = Math.max(d, 1 + depthOf(o));
    memo.set(l.dep, d); return d;
  };
  const depth = emb.reduce((m, l) => Math.max(m, depthOf(l)), 0);
  const embedBonus = P.EMBED * Math.min(depth, P.EMBED_MAX);

  const lexicalBase = items.reduce((a, x) => a + x.points, 0);
  // Size multiplier: increasing in the number of blue tiles, so joining two
  // sentences never lowers their lexical total, but saturating, so endless
  // chains gain nothing beyond the words themselves.
  const B = blue.filter(Boolean).length;
  const M = B ? 1 + P.SIZE * (1 - Math.pow(P.SIZE_R, B - 1)) : 1;
  const lexical = lexicalBase * M;
  const structural = linkPts.reduce((a, x) => a + x, 0) + typeBonus + embedBonus;
  const factor = reading.utteranceType === 'fragment' ? P.FRAGMENT : 1;
  const raw = (lexical + structural) * factor;
  return {
    score: Math.round(raw), exact: raw, preview, version: SCORE_VERSION,
    breakdown: {
      tiles: items.sort((a, b) => a.tok - b.tok).map(x => ({...x, points: +x.points.toFixed(2)})),
      links: live.map((l, k) => ({type: l.type, head: tiles[l.head].word, dep: tiles[l.dep].word, points: +linkPts[k].toFixed(2)})),
      unanchoredLinks: links.filter(l => !l.anchored).map(l => ({type: l.type, head: tiles[l.head].word, dep: tiles[l.dep].word, reason: l.substantive ? 'gold head' : 'fewer than ' + P.LINK_MIN_BLUE + ' blue tiles on one side'})),
      distinctLinkTypes: [...types], typeBonus, embeddingDepth: depth, embedBonus,
      lexicalBase: +lexicalBase.toFixed(2), sizeMultiplier: +M.toFixed(3), blueTiles: B,
      lexical: +lexical.toFixed(2), structural: +structural.toFixed(2), fragmentFactor: factor,
    },
  };
}
// Does token a dominate token b through the dependency relations?
function dominates(rel, a, b) {
  let x = b, g = 0;
  while (g++ < 200) { if (x === a) return true; const r = rel.find(q => q.dep === x); if (!r) return false; x = r.head; }
  return false;
}

// Score an engine parse result. Recognised: the canonical reading, or the
// reading the player chose (pass it). Conflict/unrecognised: 0 competitive
// points, status 'pending' (re-scored automatically on grammar updates).
function scoreResult(result, chosenReading = null) {
  if (!result || result.state !== 'recognised') return {score: 0, status: result && result.state === 'invalid_tiles' ? 'invalid' : 'pending', version: SCORE_VERSION};
  const reading = chosenReading || result.canonical;
  const s = scoreReading(reading, result.tiles);
  return {...s, status: s.preview ? 'preview' : 'scored', readingId: reading.id, pinned: !!result.pins};
}

function scorePortfolio(sentences) {
  const total = sentences.reduce((a, s) => a + (s.score || 0), 0);
  return {total, sentences: sentences.length};
}

module.exports = {scoreReading, scoreResult, scorePortfolio, SCORE_VERSION, PARAMS: P};
