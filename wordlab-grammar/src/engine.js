'use strict';
/*
 * Starpin Word Lab — Phase 0 grammar engine (Node prototype).
 *
 * parse(tiles) -> {state: 'recognised'|'conflict'|'unrecognised', readings,
 *                  canonical, readingCount, diagnostic, partial, timing}
 *
 * tiles: [{word, source: 'collected'|'helper'|'hypothetical'}] or a string
 * (string input treats non-BIP39 function words as gold helpers and every
 * BIP39 word as a blue tile).
 *
 * The canonical reading is chosen by preference cost only (lexical evidence
 * tier + marked-construction costs + utterance type), then by a deterministic
 * signature order. No score is consulted at any point.
 */
const G = require('./grammar');
const {compileLexicon, readingsFor} = require('./lexicon');
const {compileGrammar, earley, buildForest, countTrees, kBest, diverseRoots} = require('./parser');

const VERSION = 'phase0-0.1.0';
// Monotonic milliseconds in both Node and browsers.
const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Number(process.hrtime.bigint()) / 1e6;

function createEngine(v11Lexicon, oewnEvidence, options = {}) {
  const lexicon = compileLexicon(v11Lexicon, oewnEvidence, {profile: options.profile || 'default'});
  const gopts = {preps: lexicon.preps, idiomPreps: lexicon.idiomPreps.length ? lexicon.idiomPreps : ['on']};
  const t0 = now();
  const strict = compileGrammar(G, gopts);
  const compileMs = now() - t0;
  // The relaxed grammar is only needed to diagnose a failure: compile lazily.
  let relaxedCache = null, relaxedMs = null;
  const getRelaxed = () => { if (!relaxedCache) { const t = now(); relaxedCache = compileGrammar(G, {...gopts, relax: G.RELAXABLE}); relaxedMs = now() - t; } return relaxedCache; };

  function tokenise(input) {
    if (Array.isArray(input)) return input.map(t => typeof t === 'string' ? {word: t.toLowerCase(), source: null} : {word: String(t.word).toLowerCase(), source: t.source});
    return String(input).toLowerCase().replace(/[.,;:!?"“”]/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(Boolean).map(w => ({word: w, source: null}));
  }
  function defaultSource(w) { return lexicon.byWord.has(w) ? 'collected' : 'helper'; }

  function lexicalise(cg, tiles) {
    const tokenSyms = [], leafInfo = [];
    const unknown = [];
    tiles.forEach((t, i) => {
      const rs = readingsFor(lexicon, t.word, t.source);
      if (!rs.length) unknown.push({index: i, word: t.word, source: t.source});
      const set = new Set(), info = new Map();
      for (const r of rs) {
        let id = cg.symCache && cg.symCache.get(r.key);
        if (id === undefined) { if (!cg.symCache) cg.symCache = new Map(); id = cg.symbols.get(symFor(cg, r.cat, r.f)); cg.symCache.set(r.key, id === undefined ? null : id); }
        if (id === null) id = undefined;
        if (id === undefined) continue; // reading not used by grammar
        set.add(id);
        const prev = info.get(id);
        if (!prev || lexicon.TIER_COST[r.tier] < lexicon.TIER_COST[prev.tier]) info.set(id, r);
      }
      tokenSyms.push(set); leafInfo.push(info);
    });
    return {tokenSyms, leafInfo, unknown};
  }
  function symFor(cg, cat, f) {
    const decl = cg.cats[cat]; if (!decl) return null;
    const keys = Object.keys(decl).sort();
    return keys.length ? cat + '[' + keys.map(k => k + '=' + f[k]).join(',') + ']' : cat;
  }

  // ------------------------------------------------------------ analysis
  function analyse(tree, tiles, leafInfo, cg) {
    const words = tiles.map(t => t.word);
    const rel = [], fam = new Set(), roles = new Array(tiles.length).fill(null), viol = [];
    let utype = null;
    // returns head token index
    function walk(n) {
      if (n.leaf) return n.tok;
      const spec = n.rule.spec;
      if (spec.fam) fam.add(spec.fam);
      for (const v of n.rule.violations) viol.push({constraint: v, rule: spec.id, span: span(n)});
      if (spec.utype && !utype) utype = spec.utype;
      const heads = n.kids.map(walk);
      const h = heads[spec.head || 0];
      for (const [ci, type] of spec.deps || []) {
        const d = heads[ci];
        const t = spec.rel && type === 'mod' ? spec.rel : type;
        rel.push({type: resolveModType(n.kids[ci], t), head: h, dep: d, rule: spec.id});
      }
      return h;
    }
    function resolveModType(kid, t) {
      if (t !== 'mod') return t;
      // Mod -> AdjP (amod) | N (compound)
      return kid.rule && kid.rule.spec.rel ? kid.rule.spec.rel : t;
    }
    function span(n) { if (n.leaf) return [n.tok, n.tok + 1]; const [, i, j] = n.key.split(':').map(Number); return [i, j]; }
    const root = walk(tree);
    // Utterance type: first utype found top-down; Core decides declarative/imperative
    utype = topType(tree) || utype;
    const leaves = [];
    (function collect(n) { if (n.leaf) leaves.push(n); else n.kids.forEach(collect); })(tree);
    for (const lf of leaves) {
      const r = leafInfo[lf.tok].get(lf.sym);
      const cat = cg.names[lf.sym];
      const dep = rel.find(x => x.dep === lf.tok);
      roles[lf.tok] = {word: words[lf.tok], cat, pos: cat.split('[')[0], role: lf.tok === root ? 'root' : dep ? dep.type : 'head-internal',
        tier: r ? r.tier : null, src: r ? r.src : null};
    }
    const bracket = brk(tree, words);
    const prefCost = treeCost(tree, leafInfo);
    return {utteranceType: utype, bracket, roles, relations: rel, families: [...fam].sort(), violations: viol, cost: prefCost,
      signature: bracket + ' | ' + roles.map(r => r.pos + ':' + r.role).join(' ')};
  }
  function topType(n) {
    if (n.leaf) return null;
    const s = n.rule.spec;
    if (s.utype) return s.utype;
    if (s.inheritType) return topType(n.kids[0]);
    return null;
  }
  function treeCost(n, leafInfo) {
    if (n.leaf) { const r = leafInfo[n.tok].get(n.sym); return r ? lexicon.TIER_COST[r.tier] : 0; }
    return n.rule.cost + n.kids.reduce((a, k) => a + treeCost(k, leafInfo), 0);
  }
  // Display bracketing: phrasal labels only; helper categories are spliced.
  function brk(n, words) {
    if (n.leaf) return words[n.tok];
    const inner = n.kids.map(k => brk(k, words)).join(' ');
    const d = n.rule.spec.disp;
    if (!d) return inner;
    return '[' + d + ' ' + inner + ']';
  }

  function leafCostFn(leafInfo) {
    return c => { const r = leafInfo[c.tok].get(c.sym); return r ? lexicon.TIER_COST[r.tier] : 0; };
  }

  function runGrammar(cg, tiles, K, pins) {
    const {tokenSyms, leafInfo, unknown} = lexicalise(cg, tiles);
    if (pins) for (const [i, pos] of Object.entries(pins)) {
      const keep = [...tokenSyms[i]].filter(id => cg.names[id].split('[')[0] === pos);
      tokenSyms[i] = new Set(keep);
    }
    if (unknown.length) return {unknown, tokenSyms, leafInfo};
    const chart = earley(cg, tokenSyms);
    if (!chart.accepted) return {chart, tokenSyms, leafInfo, forest: null};
    const forest = buildForest(cg, chart, tokenSyms);
    const count = countTrees(forest);
    const lc = leafCostFn(leafInfo);
    const best = kBest(forest, lc, K);
    if (K > 8) {
      // A root-level alternative replaces the root of the tree; re-wrap so
      // the chain above it is preserved.
      for (const t of diverseRoots(forest, lc, 2)) best.push(t);
    }
    return {chart, tokenSyms, leafInfo, forest, count, best};
  }

  const SHOW = new Set(['S', 'Imp', 'Q', 'VP', 'NP', 'PP', 'AdjP', 'FP']);
  function partialAnalysis(cg, tokenSyms, tiles) {
    // Bottom-up islands: predict every display category at every position,
    // then cover greedily left to right by the longest constituent.
    const seeds = cg.names.map((n, id) => SHOW.has(n.split('[')[0]) ? id : -1).filter(id => id >= 0 && cg.byLhs.has(id));
    const chart = earley(cg, tokenSyms, seeds);
    const show = SHOW;
    const N = tiles.length, out = [];
    let i = 0;
    while (i < N) {
      let bestEnd = -1, bestCat = null;
      for (const [ek, ends] of chart.endsFrom) {
        const sym = Math.floor(ek / (N + 1)), start = ek % (N + 1);
        if (start !== i) continue;
        const cat = cg.names[sym].split('[')[0];
        if (!show.has(cat)) continue;
        for (const e of ends) if (e > bestEnd || (e === bestEnd && rank(cat) > rank(bestCat))) { bestEnd = e; bestCat = cat; }
      }
      if (bestEnd > i) { out.push({start: i, end: bestEnd, cat: bestCat, text: tiles.slice(i, bestEnd).map(t => t.word).join(' ')}); i = bestEnd; }
      else { out.push({start: i, end: i + 1, cat: null, text: tiles[i].word}); i++; }
    }
    return out;
  }
  const rank = c => ({S: 7, Imp: 7, Q: 7, FP: 6, VP: 5, NP: 4, PP: 3, AdjP: 2}[c] || 0);

  function parse(input, opts = {}) {
    const raw = tokenise(input);
    // String input with a repeated BIP39 word: the game would hold one blue
    // copy and use gold helpers for the rest, but which occurrence is blue is
    // not stated, so try each assignment and keep the best outcome.
    if (!raw.some(t => t.source)) {
      const counts = {};
      raw.forEach(t => { if (lexicon.byWord.has(t.word)) counts[t.word] = (counts[t.word] || 0) + 1; });
      const dup = Object.keys(counts).filter(w => counts[w] > 1);
      if (dup.length === 1) {
        const w = dup[0], idx = raw.map((t, i) => t.word === w ? i : -1).filter(i => i >= 0);
        let bestRes = null;
        for (const blue of idx) {
          const tiles = raw.map((t, i) => ({word: t.word, source: t.word === w ? (i === blue ? 'collected' : 'helper') : defaultSource(t.word)}));
          const r = parseTiles(tiles, opts);
          const rank = x => x.state === 'recognised' ? 0 : x.state === 'conflict' ? 1 : 2;
          if (!bestRes || rank(r) < rank(bestRes) || rank(r) === 0 && rank(bestRes) === 0 && r.canonical.cost < bestRes.canonical.cost) bestRes = r;
        }
        return bestRes;
      }
    }
    return parseTiles(raw, opts);
  }
  function parseTiles(input, opts = {}) {
    const K = opts.k || 24;
    // String/word-list input: BIP39 words are blue, others gold; a repeated
    // BIP39 word becomes gold on its later occurrences (as in the game, where
    // only one blue copy exists). Explicit tile sources are never altered.
    const seenBlue = new Set();
    const tiles = input.map(t => {
      let source = t.source || defaultSource(t.word);
      if (!t.source && source === 'collected') { if (seenBlue.has(t.word)) source = 'helper'; else seenBlue.add(t.word); }
      return {word: t.word, source};
    });
    const t1 = now();
    if (!tiles.length) return {state: 'unrecognised', reason: 'empty', tiles};
    // Provenance check: one blue copy per word within a sentence.
    const seen = new Set();
    for (const t of tiles) if (t.source === 'collected') { if (seen.has(t.word)) return {state: 'invalid_tiles', reason: 'duplicate_collected_word', word: t.word, tiles}; seen.add(t.word); }
    const s = runGrammar(strict, tiles, K, opts.pins);
    const ms = () => now() - t1;
    if (s.unknown) return {state: 'invalid_tiles', reason: 'no_reading_for_tile', words: s.unknown, tiles, ms: ms()};
    if (s.forest) {
      const analyses = s.best.filter(b => b.tree.key === s.forest.root || wrapToRoot(b, s.forest)).map(b => analyse(b.tree.key === s.forest.root ? b.tree : wrapToRoot(b, s.forest).tree, tiles, s.leafInfo, strict));
      // merge identical display signatures, order by cost then signature
      const uniq = new Map();
      for (const a of analyses) { const p = uniq.get(a.signature); if (!p || a.cost < p.cost) uniq.set(a.signature, a); }
      const readings = [...uniq.values()].sort((a, b) => a.cost - b.cost || (a.signature < b.signature ? -1 : 1));
      readings.forEach((r, i) => { r.id = 'R' + (i + 1); });
      return {state: 'recognised', tiles, readings, canonical: readings[0], treeCount: s.count, choicePoints: choicePoints(s.forest, tiles, strict), pins: opts.pins || null, ...(opts.returnForest ? {forest: s.forest} : {}), earleyItems: s.chart.items, ms: ms(), version: VERSION};
    }
    // Not recognised: try the relaxed grammar for a specific conflict.
    const relaxed = getRelaxed();
    const r = runGrammar(relaxed, tiles, 8);
    const partial = partialAnalysis(strict, s.tokenSyms, tiles);
    if (r.forest && r.best.length) {
      const a = analyse(r.best[0].tree, tiles, r.leafInfo, relaxed);
      const kinds = [...new Set(a.violations.map(v => v.constraint))];
      if (a.violations.length === 1) {
        const v = a.violations[0];
        return {state: 'conflict', tiles, conflict: {constraint: v.constraint, explanation: G.RELAX_TEXT[v.constraint], rule: v.rule,
          span: v.span, text: tiles.slice(v.span[0], v.span[1]).map(t => t.word).join(' ')}, nearestReading: a, partial, ms: ms(), version: VERSION};
      }
      return {state: 'unrecognised', tiles, reason: 'needs_' + a.violations.length + '_relaxations', relaxationsNeeded: kinds, partial, ms: ms(), version: VERSION};
    }
    return {state: 'unrecognised', tiles, reason: 'outside_current_grammar', partial, ms: ms(), version: VERSION};
  }

  // Tokens whose part of speech differs across complete parses: the only
  // places a player could usefully say which reading they intend.
  function choicePoints(forest, tiles, cg) {
    const per = tiles.map(() => new Set());
    for (const alts of forest.nodes.values()) for (const a of alts || []) for (const c of a.kids)
      if (typeof c !== 'string') per[c.tok].add(cg.names[c.sym].split('[')[0]);
    return per.map((s, i) => ({index: i, word: tiles[i].word, options: [...s].sort()})).filter(x => x.options.length > 1);
  }

  // Wrap an inner-node tree back up the unary chain to the forest root.
  function wrapToRoot(b, forest) {
    if (b.tree.key === forest.root) return b;
    let tree = b.tree, cost = b.cost, key = b.tree.key;
    for (let guard = 0; guard < 5; guard++) {
      let parent = null;
      for (const [k, alts] of forest.nodes) for (const a of alts || []) if (a.kids.length === 1 && a.kids[0] === key) { parent = {k, a}; break; }
      if (!parent) return null;
      tree = {rule: parent.a.rule, kids: [tree], key: parent.k}; cost += parent.a.rule.cost; key = parent.k;
      if (key === forest.root) return {tree, cost};
    }
    return null;
  }

  // Player-selected reading: stable by signature across sessions.
  function selectReading(result, signature) {
    if (result.state !== 'recognised') return null;
    return result.readings.find(r => r.signature === signature) || null;
  }

  return {VERSION, parse, parseTiles, selectReading, lexicon, strict, compileMs,
    get relaxed() { return getRelaxed(); },
    get relaxedCompileMs() { getRelaxed(); return relaxedMs; },
    get stats() { return {strictRules: strict.rules.length, relaxedRules: getRelaxed().rules.length, symbols: strict.names.length}; }};
}

module.exports = {createEngine, VERSION};
