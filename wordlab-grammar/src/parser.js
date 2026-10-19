'use strict';
/*
 * Feature-grammar compiler + Earley chart parser + packed forest.
 *
 * Feature constraints range over small finite domains, so the grammar is
 * compiled into an equivalent atomic context-free grammar by enumerating
 * variable bindings. Named checks inside `when` can be relaxed: a relaxed
 * grammar keeps violating instantiations as separate rules tagged with the
 * violated constraint and a large cost, which is how specific conflicts are
 * diagnosed without guessing.
 *
 * The parser has no depth limits, no per-stage result caps and no step
 * budgets. Ambiguity is held in a packed forest; trees are only enumerated
 * (k-best by preference cost) on demand.
 */

function symName(cat, f, catDecl) {
  const keys = Object.keys(catDecl).sort();
  return keys.length ? cat + '[' + keys.map(k => k + '=' + f[k]).join(',') + ']' : cat;
}

function compileGrammar(G, {preps, idiomPreps, relax = []} = {}) {
  const relaxSet = new Set(relax);
  const cats = {};
  for (const [c, decl] of Object.entries(G.CATS)) {
    cats[c] = {};
    for (const [k, dom] of Object.entries(decl)) cats[c][k] = dom === 'PREP' ? (c === 'NIdiom' ? idiomPreps : preps) : dom;
  }
  const symbols = new Map(), names = [];
  const intern = n => { if (!symbols.has(n)) { symbols.set(n, names.length); names.push(n); } return symbols.get(n); };
  const rules = [];
  for (const spec of G.RULES) {
    // Collect variables and their domains.
    const vars = new Map(); let anon = 0;
    const items = [spec.lhs, ...spec.rhs].map(([cat, f], idx) => {
      const decl = cats[cat]; if (!decl) throw new Error('Unknown category ' + cat + ' in ' + spec.id);
      const out = {};
      for (const [k, dom] of Object.entries(decl)) {
        let val = f[k];
        if (val === undefined) {
          if (idx === 0) { if (G.DEFAULTS && G.DEFAULTS[k] !== undefined) val = G.DEFAULTS[k]; else throw new Error(spec.id + ': LHS ' + cat + ' must set ' + k); }
          else val = '?_' + (anon++);
        }
        if (typeof val === 'string' && val.startsWith('?')) {
          const name = val.slice(1);
          const d = vars.has(name) ? vars.get(name).filter(x => dom.includes(x)) : dom.slice();
          vars.set(name, d);
        } else if (!dom.includes(val)) throw new Error(spec.id + ': bad value ' + k + '=' + val);
        out[k] = val;
      }
      for (const k of Object.keys(f)) if (!(k in decl)) throw new Error(spec.id + ': ' + cat + ' has no feature ' + k);
      return [cat, out];
    });
    const names_ = [...vars.keys()];
    const bind = {};
    const emit = () => {
      const violations = [];
      const C = (name, ok) => {
        if (ok) return true;
        if (relaxSet.has(name)) { violations.push(name); return true; }
        return false;
      };
      if (spec.when && !spec.when(bind, C)) return;
      const inst = items.map(([cat, f]) => {
        const g = {};
        for (const [k, v] of Object.entries(f)) g[k] = typeof v === 'string' && v.startsWith('?') ? bind[v.slice(1)] : v;
        return intern(symName(cat, g, cats[cat]));
      });
      rules.push({lhs: inst[0], rhs: inst.slice(1), spec, violations, cost: (spec.cost || 0) + 100 * violations.length});
    };
    const rec = i => {
      if (i === names_.length) return emit();
      for (const v of vars.get(names_[i])) { bind[names_[i]] = v; rec(i + 1); }
    };
    rec(0);
  }
  // Remove useless rules: keep productive (derives terminals) and reachable.
  const preterminalCats = new Set(['N', 'NIdiom', 'Adj', 'AdjFused', 'AdvDeg', 'AdvPre', 'AdvPost', 'AdvFocus', 'V', 'VPrep', 'Det', 'Pron', 'P',
    'Modal', 'Cop', 'Be', 'Do', 'HaveAux', 'Not', 'To', 'Conj', 'ForCoord', 'Sub', 'Comp', 'Rel']);
  const preFlag = new Uint8Array(names.length);
  names.forEach((n, i) => { preFlag[i] = preterminalCats.has(n.split('[')[0]) ? 1 : 0; });
  const isPre = id => preFlag[id] === 1;
  const productive = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of rules) if (!productive.has(r.lhs) && r.rhs.every(s => isPre(s) || productive.has(s))) { productive.add(r.lhs); changed = true; }
  }
  let live = rules.filter(r => r.rhs.every(s => isPre(s) || productive.has(s)));
  const start = symbols.get('Utt');
  const reach = new Set([start]); changed = true;
  while (changed) {
    changed = false;
    for (const r of live) if (reach.has(r.lhs)) for (const s of r.rhs) if (!reach.has(s)) { reach.add(s); changed = true; }
  }
  live = live.filter(r => reach.has(r.lhs));
  live.forEach((r, i) => { r.id = i; });
  const byLhs = new Map();
  for (const r of live) { if (!byLhs.has(r.lhs)) byLhs.set(r.lhs, []); byLhs.get(r.lhs).push(r); }
  // FIRST sets (no empty rules): which preterminals can begin each symbol.
  const first = new Map();
  for (let i = 0; i < names.length; i++) if (preFlag[i]) first.set(i, new Set([i]));
  changed = true;
  while (changed) {
    changed = false;
    for (const r of live) {
      const f0 = first.get(r.rhs[0]); if (!f0) continue;
      if (!first.has(r.lhs)) first.set(r.lhs, new Set());
      const fl = first.get(r.lhs), before = fl.size;
      for (const x of f0) fl.add(x);
      if (fl.size !== before) changed = true;
    }
  }
  for (const r of live) r.first = first.get(r.rhs[0]) || new Set();
  return {rules: live, byLhs, symbols, names, start, isPre, cats, relax: [...relaxSet], first};
}

// ---------------------------------------------------------------- Earley
function earley(cg, tokenSyms, seeds = null) {
  const N = tokenSyms.length;
  const sets = Array.from({length: N + 1}, () => ({items: [], seen: new Set(), waiting: new Map(), predicted: new Set()}));
  const done = new Map(); // key (sym,i,j) -> true ; endsFrom: sym*... -> Set of j
  const endsFrom = new Map();
  const R = cg.rules;
  const key = (r, d, o) => (r * 16 + d) * (N + 1) + o;
  function add(k, r, d, o) {
    const s = sets[k], kk = key(r, d, o);
    if (s.seen.has(kk)) return;
    s.seen.add(kk); s.items.push([r, d, o]);
  }
  // Lookahead filter: only predict a rule if its FIRST set meets token k.
  const canStart = (r, k) => { for (const t of tokenSyms[k]) if (r.first.has(t)) return true; return false; };
  if (N) for (const r of cg.byLhs.get(cg.start) || []) if (canStart(r, 0)) add(0, r.id, 0, 0);
  sets[0].predicted.add(cg.start);
  for (let k = 0; k <= N; k++) {
    const s = sets[k];
    if (seeds && k < N) for (const B of seeds) if (!s.predicted.has(B)) { s.predicted.add(B); for (const r2 of cg.byLhs.get(B) || []) if (canStart(r2, k)) add(k, r2.id, 0, k); }
    for (let x = 0; x < s.items.length; x++) {
      const [r, d, o] = s.items[x];
      const rule = R[r];
      if (d === rule.rhs.length) {
        // completion
        const A = rule.lhs, dk = (A * (N + 1) + o) * (N + 1) + k;
        if (!done.has(dk)) {
          done.set(dk, true);
          const ek = A * (N + 1) + o;
          if (!endsFrom.has(ek)) endsFrom.set(ek, new Set());
          endsFrom.get(ek).add(k);
          const w = sets[o].waiting.get(A);
          if (w) for (const [r2, d2, o2] of w) add(k, r2, d2 + 1, o2);
        }
        continue;
      }
      const B = rule.rhs[d];
      if (cg.isPre(B)) {
        if (k < N && tokenSyms[k].has(B)) add(k + 1, r, d + 1, o);
        continue;
      }
      if (!s.waiting.has(B)) s.waiting.set(B, []);
      s.waiting.get(B).push([r, d, o]);
      // If B already completed from k (cannot happen without empty rules), skip.
      if (!s.predicted.has(B)) {
        s.predicted.add(B);
        if (k < N) for (const r2 of cg.byLhs.get(B) || []) if (canStart(r2, k)) add(k, r2.id, 0, k);
      }
    }
  }
  const accepted = done.has((cg.start * (N + 1) + 0) * (N + 1) + N);
  const items = sets.reduce((a, s) => a + s.items.length, 0);
  return {accepted, done, endsFrom, N, items};
}

// ---------------------------------------------------------------- forest
// Node key "sym:i:j". Each node: list of packed alternatives {rule, kids}.
function buildForest(cg, chart, tokenSyms, rootSym = cg.start) {
  const {done, endsFrom, N} = chart;
  const isDone = (A, i, j) => done.has((A * (N + 1) + i) * (N + 1) + j);
  const nodes = new Map();
  function node(A, i, j) {
    const k = A + ':' + i + ':' + j;
    if (nodes.has(k)) return k;
    nodes.set(k, null); // placeholder (forest is acyclic: no unary cycles produce same span? guard anyway)
    const alts = [];
    for (const r of cg.byLhs.get(A) || []) {
      for (const kids of splits(r.rhs, 0, i, j)) alts.push({rule: r, kids});
    }
    nodes.set(k, alts);
    for (const a of alts) for (const c of a.kids) if (typeof c === 'string' && !nodes.has(c)) {
      const [s, a1, b1] = c.split(':').map(Number); node(s, a1, b1);
    }
    return k;
  }
  // Enumerate child sequences covering [i,j) for rhs[p..].
  function splits(rhs, p, i, j) {
    if (p === rhs.length) return i === j ? [[]] : [];
    const B = rhs[p], out = [];
    const remaining = rhs.length - p - 1;
    if (cg.isPre(B)) {
      if (i < j && tokenSyms[i].has(B)) for (const rest of splits(rhs, p + 1, i + 1, j)) out.push([{tok: i, sym: B}, ...rest]);
      return out;
    }
    const ends = endsFrom.get(B * (N + 1) + i);
    if (!ends) return out;
    for (const e of ends) {
      if (e > j || j - e < remaining) continue;
      if (p === rhs.length - 1 && e !== j) continue;
      if (!isDone(B, i, e)) continue;
      for (const rest of splits(rhs, p + 1, e, j)) out.push([B + ':' + i + ':' + e, ...rest]);
    }
    return out;
  }
  if (!isDone(rootSym, 0, N)) return null;
  const root = node(rootSym, 0, N);
  return {root, nodes};
}

// Count trees (as a float; may be large) and k-best by preference cost.
function countTrees(forest) {
  const memo = new Map();
  const cnt = k => {
    if (memo.has(k)) return memo.get(k);
    memo.set(k, 0);
    let total = 0;
    for (const a of forest.nodes.get(k) || []) {
      let prod = 1;
      for (const c of a.kids) prod *= typeof c === 'string' ? cnt(c) : 1;
      total += prod;
    }
    memo.set(k, total); return total;
  };
  return cnt(forest.root);
}

function kBest(forest, leafCost, K = 24, override = null, shared = null) {
  const memo = shared || new Map();
  function best(k) {
    if (memo.has(k) && !(override && k === override.key)) return memo.get(k);
    if (!(override && k === override.key)) memo.set(k, []);
    let all = [];
    for (const a of (override && k === override.key) ? [override.alt] : forest.nodes.get(k) || []) {
      let partial = [{cost: a.rule.cost, kids: []}];
      for (const c of a.kids) {
        const opts = typeof c === 'string' ? best(c) : [{cost: leafCost(c), tree: {leaf: true, tok: c.tok, sym: c.sym}}];
        const next = [];
        for (const p of partial) for (const o of opts) next.push({cost: p.cost + o.cost, kids: [...p.kids, o.tree]});
        next.sort((x, y) => x.cost - y.cost);
        partial = next.slice(0, K);
        if (!partial.length) break;
      }
      for (const p of partial) if (p.kids.length === a.kids.length) all.push({cost: p.cost, tree: {rule: a.rule, kids: p.kids, key: k}});
    }
    all.sort((x, y) => x.cost - y.cost);
    all = all.slice(0, K);
    if (!(override && k === override.key)) memo.set(k, all);
    return all;
  }
  return override ? best(override.key) : best(forest.root);
}

// Best tree(s) under each packed alternative of the root and of its single
// unary chain below (Utt -> Core -> S/Imp): guarantees that structurally
// different top-level analyses (e.g. causal 'for' vs prepositional 'for')
// are offered even when attachment variants of one analysis are cheaper.
function diverseRoots(forest, leafCost, perAlt = 2) {
  const out = [], shared = new Map();
  const visit = (key, depth) => {
    const alts = forest.nodes.get(key) || [];
    for (const a of alts) {
      for (const t of kBest(forest, leafCost, perAlt, {key, alt: a}, shared)) out.push(t);
      if (depth < 3 && a.kids.length === 1 && typeof a.kids[0] === 'string') visit(a.kids[0], depth + 1);
    }
  };
  visit(forest.root, 0);
  return out;
}

module.exports = {compileGrammar, earley, buildForest, countTrees, kBest, diverseRoots};
