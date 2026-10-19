'use strict';
/*
 * Random derivations from the compiled strict grammar, with tiles drawn from
 * the real BIP39 lexicon and gold helper tables. Each generated item carries
 * its own derivation tree, so recovery can be checked exactly (the parser's
 * forest must contain that tree), with no human labelling.
 *
 * Typed corruptions are derived from the tree, so each one knows which rule
 * and which constraint it attacks.
 */
const {readingsFor, HELPER_CANDIDATES} = require('../src/lexicon');

function makeRng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

function buildGenerator(engine, seed = 1, opts = {}) {
  // opts.allowedBlue: Set of collected words available; opts.helpers: Set of unlocked gold helpers.
  const cg = engine.strict, lexicon = engine.lexicon, rnd = makeRng(seed);
  const pick = a => a[Math.floor(rnd() * a.length)];
  // preterminal symbol -> candidate tiles
  const bySym = new Map();
  const addTile = (sym, tile) => { if (!bySym.has(sym)) bySym.set(sym, []); bySym.get(sym).push(tile); };
  const symOf = (cat, f) => { const decl = cg.cats[cat]; if (!decl) return undefined; const keys = Object.keys(decl).sort(); return cg.symbols.get(keys.length ? cat + '[' + keys.map(k => k + '=' + f[k]).join(',') + ']' : cat); };
  for (const [word] of lexicon.lex) if (!opts.allowedBlue || opts.allowedBlue.has(word)) for (const r of readingsFor(lexicon, word, 'collected')) { const s = symOf(r.cat, r.f); if (s !== undefined) addTile(s, {word, source: 'collected'}); }
  for (const word of HELPER_CANDIDATES) if (!opts.helpers || opts.helpers.has(word)) for (const r of readingsFor(lexicon, word, 'helper')) { const s = symOf(r.cat, r.f); if (s !== undefined) addTile(s, {word, source: 'helper'}); }
  // minimum yield length per symbol, to steer termination
  const minLen = new Map();
  for (const s of bySym.keys()) minLen.set(s, 1);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of cg.rules) {
      if (!r.rhs.every(x => minLen.has(x))) continue;
      const L = r.rhs.reduce((a, x) => a + minLen.get(x), 0);
      if (!minLen.has(r.lhs) || L < minLen.get(r.lhs)) { minLen.set(r.lhs, L); changed = true; }
    }
  }
  const ruleLen = r => r.rhs.reduce((a, x) => a + (minLen.get(x) || 99), 0);

  // Sampling weights (test-side only; the grammar is unaffected). Common
  // structures more often, marked ones less, so corruption types are balanced.
  const W = {np_det: 5, np_bare: 2, np_pron: 0.6, np_fused: 0.1, np_pp: 1.2, np_rel: 0.5, np_focus: 0.3, np_coord: 0.6,
    utt_frag: 0.5, utt_ellipsis: 0.3, utt_ellipsis_neg: 0.1, utt_q: 0.6, utt_for: 1.5, pp_idiom: 0.15, vp_ditr: 1.5, fp_perfect: 1.5, fp_do_emph: 0.4, nom_mod: 1.2, s_coord: 0.6, vp_coord: 0.6, fp_coord: 0.3,
    vp_focus: 0.3, vp_pre: 0.4, vp_post: 0.4, s_sub_front: 0.3, imp_sub_front: 0.2, imp_and_s: 0.3};
  function weighted(ids) { const ws = ids.map(i => W[i] === undefined ? 1 : W[i]); let x = rnd() * ws.reduce((a, b) => a + b, 0); for (let i = 0; i < ids.length; i++) { x -= ws[i]; if (x <= 0) return ids[i]; } return ids[ids.length - 1]; }
  function generate({maxTokens = 26, depth = 7, startSym = cg.start, forceSpec = null} = {}) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const tiles = [], usedBlue = new Set();
      let ok = true, forced = !forceSpec;
      const gen = (sym, d) => {
        if (!ok) return null;
        if (cg.isPre(sym)) {
          const cands = (bySym.get(sym) || []).filter(t => t.source === 'helper' || !usedBlue.has(t.word));
          if (!cands.length) { ok = false; return null; }
          const t = pick(cands);
          if (t.source === 'collected') usedBlue.add(t.word);
          tiles.push(t);
          return {leaf: true, tok: tiles.length - 1, sym};
        }
        const rules = (cg.byLhs.get(sym) || []).filter(r => r.rhs.every(x => minLen.has(x)));
        if (!rules.length) { ok = false; return null; }
        let chosen;
        if (!forced && rules.some(r => r.spec.id === forceSpec) && rnd() < 0.5) { forced = true; chosen = pick(rules.filter(r => r.spec.id === forceSpec)); }
        else if (d <= 0) { const m = Math.min(...rules.map(ruleLen)); chosen = pick(rules.filter(r => ruleLen(r) === m)); }
        else { const specs = [...new Set(rules.map(r => r.spec.id))]; const sid = weighted(specs); chosen = pick(rules.filter(r => r.spec.id === sid)); }
        const kids = chosen.rhs.map(x => gen(x, d - 1));
        if (!ok) return null;
        return {rule: chosen, kids};
      };
      const tree = gen(startSym, depth);
      if (!ok || !forced || tiles.length > maxTokens) continue;
      // assign spans/keys bottom-up
      (function key(n) { if (n.leaf) return [n.tok, n.tok + 1]; const sp = n.kids.map(key); n.key = n.rule.lhs + ':' + sp[0][0] + ':' + sp[sp.length - 1][1]; return [sp[0][0], sp[sp.length - 1][1]]; })(tree);
      return {tiles, tree};
    }
    return null;
  }

  // Exact membership of a derivation in a packed forest.
  function inForest(forest, n) {
    if (n.leaf) return true;
    const alts = forest.nodes.get(n.key);
    if (!alts) return false;
    return alts.some(a => a.rule.id === n.rule.id && a.kids.length === n.kids.length && a.kids.every((c, i) => {
      const k = n.kids[i];
      if (typeof c === 'string') return !k.leaf && c === k.key && inForest(forest, k);
      return k.leaf && c.tok === k.tok && c.sym === k.sym;
    }));
  }

  // ---------------------------------------------------------- corruptions
  const name = s => cg.names[s];
  function nodes(t, acc = []) { acc.push(t); if (!t.leaf) t.kids.forEach(k => nodes(k, acc)); return acc; }
  function span(n) { if (n.leaf) return [n.tok, n.tok + 1]; const [, i, j] = n.key.split(':').map(Number); return [i, j]; }
  const SWAP = {is: 'are', are: 'is', was: 'were', were: 'was', does: 'do', do: 'does', a: 'an', an: 'a'};
  function corrupt(item) {
    const {tiles, tree} = item, out = [];
    const all = nodes(tree);
    const leaves = all.filter(n => n.leaf);
    const replace = (i, word) => tiles.map((t, j) => j === i ? {word, source: 'helper'} : t);
    const remove = ([a, b]) => tiles.filter((t, j) => j < a || j >= b);
    for (const lf of leaves) {
      const cat = name(lf.sym).split('[')[0], w = tiles[lf.tok].word;
      if ((cat === 'Cop' || cat === 'Do') && SWAP[w]) out.push({type: 'agreement', tiles: replace(lf.tok, SWAP[w]), target: w + '→' + SWAP[w]});
      if (cat === 'Det' && (w === 'a' || w === 'an')) out.push({type: 'article', tiles: replace(lf.tok, SWAP[w]), target: w + '→' + SWAP[w]});
      if (cat === 'Pron') {
        // Only words a player can actually place: 'myself' (blue, object-only)
        // is the one accusative form available; 'he' is a gold helper.
        if (['he', 'she', 'we', 'they', 'it'].includes(w) && !tiles.some(t => t.word === 'myself')) out.push({type: 'case', tiles: tiles.map((t, j) => j === lf.tok ? {word: 'myself', source: 'collected'} : t), target: w + '→myself'});
        if (w === 'myself') out.push({type: 'case', tiles: replace(lf.tok, 'he'), target: 'myself→he'});
      }
    }
    for (const n of all) {
      if (n.leaf) continue;
      const id = n.rule.spec.id;
      if (id === 'np_det') {
        const nom = name(n.kids[1].rule ? n.kids[1].rule.lhs : n.kids[1].sym);
        if (/cnt=count/.test(nom) && /num=sg/.test(nom)) out.push({type: 'det_drop', tiles: remove(span(n.kids[0])), target: 'drop "' + tiles[n.kids[0].tok].word + '"'});
      }
      if (id === 'vp_tr') {
        const verb = tiles[n.kids[0].tok];
        const canBeIntr = readingsFor(engine.lexicon, verb.word, verb.source).some(r => r.cat === 'V' && r.f.fr === 'intr');
        // The object follows the verb, so the verb keeps its token index.
        if (!canBeIntr) out.push({type: 'object_drop', tiles: remove(span(n.kids[1])), target: 'drop object of "' + verb.word + '"', verbIndex: n.kids[0].tok});
      }
    }
    if (tiles.length >= 3) {
      const i = Math.floor(rnd() * (tiles.length - 1));
      if (tiles[i].word !== tiles[i + 1].word) { const t = tiles.slice(); [t[i], t[i + 1]] = [t[i + 1], t[i]]; out.push({type: 'adjacent_swap', tiles: t, target: tiles[i].word + '↔' + tiles[i + 1].word}); }
      const k = Math.floor(rnd() * tiles.length);
      out.push({type: 'token_delete', tiles: tiles.filter((_, j) => j !== k), target: 'delete "' + tiles[k].word + '"'});
    }
    return out;
  }

  return {generate, inForest, corrupt, rnd};
}

module.exports = {buildGenerator, makeRng};
