'use strict';
/*
 * Aggregate ERG results against Phase 0 verdicts. No item-by-item judgement:
 * everything is reported by construction family, corruption type and lexical
 * evidence tier.
 *
 * Usage: node erg/analyse.js <results.jsonl> [batch=erg/phase0_batch.jsonl] [tag=erg_phase0]
 * Writes reports/<tag>_analysis.md and .json.
 *
 * Witness classes (per ERG reading):
 *   strict  — every input word is its own lexical terminal, no generic entry;
 *   mwe     — covered, but via a multiword lexical entry of different words
 *             (e.g. "in fun"): acceptable;
 *   merged  — a terminal spans a repeated word ("can can", "the the"): NOT a
 *             satisfactory witness (the 19 Oct finding);
 *   generic — a generic/unknown-word entry was needed: NOT a witness.
 * An item is "ERG-witnessed" if any inspected reading is strict or mwe.
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const resultsPath = process.argv[2];
if (!resultsPath) { console.error('usage: node erg/analyse.js erg_phase0_results.jsonl'); process.exit(2); }
const readJsonl = f => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const batchPath = process.argv[3] || path.join(__dirname, 'phase0_batch.jsonl');
const TAG = process.argv[4] || 'erg_phase0';
const batch = new Map(readJsonl(batchPath).map(b => [b.id, b]));
const results = readJsonl(resultsPath);

const words = s => (s.match(/[A-Za-z']+/g) || []);
function classify(r) {
  if (r.error) return 'error';
  if (r.generic) return 'generic';
  const forms = r.terminal_forms || [];
  const multi = forms.filter(f => words(f).length > 1);
  const merged = multi.some(f => { const w = words(f).map(x => x.toLowerCase()); return new Set(w).size < w.length; });
  if (merged) return 'merged';
  if (r.words_covered !== undefined && r.words_covered < (r.n_words || 0)) return 'merged';
  return multi.length ? 'mwe' : 'strict';
}
// Analysis type of ERG's TOP-RANKED derivation (the 19 Oct notebook output
// stores only the first derivation). A witness must be an analysis type the
// game itself recognises: a full clause (declarative, imperative, polar
// question, coordination), VP ellipsis with an overt subject, or an NP
// fragment. Excluded: other fragment rules (*frg*, e.g. subjectless finite VP
// "Was the innocent of course"), robust/generic lexical entries (e.g. a
// capitalised "Does" read as a proper name), merged spans.
const ruleNames = d => d ? [...d.matchAll(/\((\d+) ([A-Za-z0-9_\-]+) -?[\d.]+ \d+ \d+/g)].map(m => m[2]) : [];
const NP_FRAG = new Set(['np_frg_c', 'np_nb-frg_c', 'np_cnj-frg_c']);
// Type of one reading: derivation string + its inspected lexical record.
function readingType(deriv, insp, nWords) {
  const rules = ruleNames(deriv);
  const first = insp || {};
  const lexClass = classify({...first, n_words: nWords});
  if (lexClass === 'generic' || rules.some(x => /^generic_|^robust_/.test(x))) return 'robust_lexical';
  if (lexClass === 'merged') return 'merged_span';
  const top = rules[0] || '';
  const frag = rules.filter(x => /frg|frag/.test(x));
  if (frag.length) {
    if (NP_FRAG.has(top) || (frag.every(x => NP_FRAG.has(x)) && /^np/.test(top))) return 'np_fragment';
    return 'other_fragment';
  }
  if (rules.some(x => /-sb-inv-ell/.test(x))) return 'inverted_ellipsis';
  if (rules.some(x => /_aux-.*ell/.test(x))) return 'vp_ellipsis';
  return 'full_clause';
}
// Item type: the best type over all stored readings. Results from the
// 2026-10-19 notebook store only the first derivation; later notebooks store
// one per inspected reading.
const TYPE_RANK = ['full_clause', 'vp_ellipsis', 'np_fragment', 'inverted_ellipsis', 'other_fragment', 'merged_span', 'robust_lexical'];
function ergType(r) {
  if (!r.erg_parsed) return r.ace_error ? 'ace_error' : 'no_parse';
  const ins = r.inspected || [];
  const types = ins.some(x => x.derivation) ? ins.filter(x => x.derivation).map(x => readingType(x.derivation, x, r.n_words))
    : [readingType(r.first_derivation, ins[0], r.n_words)];
  return types.sort((x, y) => TYPE_RANK.indexOf(x) - TYPE_RANK.indexOf(y))[0];
}
const WITNESS_TYPES = new Set(['full_clause', 'vp_ellipsis', 'np_fragment']);
const items = [];
for (const r of results) {
  const b = batch.get(r.id); if (!b) continue;
  const t = ergType(r);
  items.push({...b, erg: t, witnessed: WITNESS_TYPES.has(t), parsed: !!r.erg_parsed, readings: r.readings, ms: r.ms,
    topRules: ruleNames(r.first_derivation).slice(0, 6).join(' '), allRules: ruleNames(r.first_derivation)});
}
const pct = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—';
const count = (xs, f) => xs.filter(f).length;
const by = (xs, k) => { const o = {}; for (const x of xs) (o[k(x)] = o[k(x)] || []).push(x); return o; };

const out = {source: path.basename(resultsPath), items: items.length};
const md = ['# Phase 0 — ERG cross-check analysis', '', `Results: \`${path.basename(resultsPath)}\` · batch \`${path.basename(batchPath)}\` · ${items.length} items joined.`, '',
  '"Witnessed" means ERG\'s top-ranked derivation is an analysis type the game recognises (full clause, VP ellipsis with an overt subject, or NP fragment), uses no robust/generic lexical entry, and gives every word its own terminal. ERG\'s other fragment rules (e.g. subjectless finite VP), capitalised words read as proper names, and merged spans do not count.', ''];

// overall
const classes = by(items, x => x.erg);
md.push('## ERG analysis type of the top-ranked derivation', '', '| ERG analysis type | Counts as witness | Items |', '|---|---|---:|');
for (const [k, v] of Object.entries(classes).sort((a, b) => b[1].length - a[1].length)) md.push(`| ${k} | ${WITNESS_TYPES.has(k) ? 'yes' : 'no'} | ${v.length} |`);
md.push('');
out.overall = Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.length]));

// probes
const probes = items.filter(x => x.kind === 'probe');
md.push('## Probes', '', '| Probe | Phase 0 | Expected | ERG |', '|---|---|---|---|');
for (const p of probes) md.push(`| ${p.id.replace('probe:', '')} | ${p.ours} | ${p.expect} | ${p.erg} |`);
md.push('');
out.probes = probes.map(p => ({id: p.id, ours: p.ours, expect: p.expect, erg: p.erg}));

// generated positives by family
const pos = items.filter(x => x.kind === 'generated_positive');
const posRate = count(pos, x => x.witnessed) / (pos.length || 1);
const fams = {};
for (const p of pos) for (const f of p.families || []) { const s = fams[f] = fams[f] || {n: 0, witnessed: 0, parsed: 0}; s.n++; if (p.witnessed) s.witnessed++; if (p.parsed) s.parsed++; }
md.push('## Generated positives (Phase 0 recognises all of them)', '', `ERG witnesses ${count(pos, x => x.witnessed)}/${pos.length} (${pct(count(pos, x => x.witnessed), pos.length)}). Families whose witness rate is ≥15 points below that, with n ≥ 15, are flagged as candidate over-generation in our grammar (or ERG coverage gaps) for rule-level review.`, '',
  '| Family | n | ERG parsed | ERG witnessed | Flag |', '|---|---:|---:|---:|---|');
const famRows = Object.entries(fams).sort((a, b) => a[1].witnessed / a[1].n - b[1].witnessed / b[1].n);
for (const [f, s] of famRows) {
  const flag = s.n >= 15 && s.witnessed / s.n < posRate - 0.15 ? '**review**' : '';
  md.push(`| ${f} | ${s.n} | ${pct(s.parsed, s.n)} | ${pct(s.witnessed, s.n)} | ${flag} |`);
}
md.push('');
out.positivesByFamily = fams; out.positiveWitnessRate = posRate;

// corruptions
const acc = items.filter(x => x.kind === 'corruption_accepted'), rej = items.filter(x => x.kind === 'corruption_rejected');
md.push('## Corruptions', '', 'Accepted by Phase 0 but not witnessed by ERG = **over-acceptance candidates**. Rejected by Phase 0 but witnessed by ERG = **false-rejection candidates** (or ERG over-acceptance: ERG is known to accept, e.g., *a angry cat*).', '',
  '| Type | Phase 0 accepted: n | …ERG witnessed | Phase 0 rejected: n | …ERG witnessed |', '|---|---:|---:|---:|---:|');
const types = [...new Set([...acc, ...rej].map(x => x.type))].sort();
out.corruptions = {};
for (const t of types) {
  const a = acc.filter(x => x.type === t), r = rej.filter(x => x.type === t);
  md.push(`| ${t} | ${a.length} | ${pct(count(a, x => x.witnessed), a.length)} | ${r.length} | ${pct(count(r, x => x.witnessed), r.length)} |`);
  out.corruptions[t] = {accepted: a.length, acceptedWitnessed: count(a, x => x.witnessed), rejected: r.length, rejectedWitnessed: count(r, x => x.witnessed)};
}
md.push('');

// attribution of over-acceptance candidates
const cand = acc.filter(x => !x.witnessed);
const famOver = {};
for (const c of cand) for (const f of c.families || []) famOver[f] = (famOver[f] || 0) + 1;
const famBase = {};
for (const c of acc) for (const f of c.families || []) famBase[f] = (famBase[f] || 0) + 1;
md.push('### Over-acceptance candidates by construction family', '', `${cand.length} candidates. A family is suspicious when its share among candidates clearly exceeds its share among all accepted corruptions.`, '',
  '| Family | Candidates | All accepted | Ratio |', '|---|---:|---:|---:|');
const ratio = f => (famOver[f] / (cand.length || 1)) / ((famBase[f] || 1) / (acc.length || 1));
for (const f of Object.keys(famOver).sort((a, b) => ratio(b) - ratio(a))) md.push(`| ${f} | ${famOver[f]} | ${famBase[f] || 0} | ${ratio(f).toFixed(2)} |`);
md.push('');
const lex = {};
for (const c of cand) for (const n of c.nonCurated || []) lex[n] = (lex[n] || 0) + 1;
md.push('### Over-acceptance candidates by non-curated lexical reading', '', 'Readings added in Phase 0 (attested/derived) that the canonical analysis relied on. Repeated offenders are lexical-policy suspects.', '',
  '| Reading | Candidates |', '|---|---:|');
for (const [k, v] of Object.entries(lex).sort((a, b) => b[1] - a[1]).slice(0, 40)) md.push(`| ${k} | ${v} |`);
md.push('');
out.overAcceptance = {count: cand.length, byFamily: famOver, byLexicalReading: lex, sample: cand.slice(0, 40).map(c => ({type: c.type, text: c.text, erg: c.erg}))};
const frej = rej.filter(x => x.witnessed);
// Why does ERG analyse what Phase 0 rejects? Policy differences, identified
// from ERG's own rule and lexical-entry names in its top derivation.
function causes(x) {
  const rs = x.allRules || [], c = [];
  if (rs.includes('n_ms-cnt_ilr')) c.push('ERG count→mass coercion ("grinding")');
  if (rs.includes('np_nb-frg_c')) c.push('ERG bare N-bar fragment (headline style)');
  if (x.type === 'article') c.push('ERG does not check a/an');
  if (x.type === 'case' && /myself/i.test(x.text)) c.push('ERG does not check reflexive binding');
  if (x.type === 'agreement' && / or /.test(x.text)) c.push('ERG agreement with or-coordination');
  if (rs.some(r => /^do2$|^will_v1$/.test(r))) c.push('lexical do/will (gold do is auxiliary-only)');
  return c.length ? c : ['other'];
}
const causeTally = {};
for (const x of frej) for (const c of causes(x)) causeTally[c] = (causeTally[c] || 0) + 1;
out.falseRejectionCauses = causeTally;
out.falseRejectionOther = frej.filter(x => causes(x)[0] === 'other').map(x => ({type: x.type, text: x.text, ours: x.ours, conflict: x.conflict}));
md.push('### Why ERG analyses sentences Phase 0 rejects', '', '| Cause | Items |', '|---|---:|');
for (const [k, v] of Object.entries(causeTally).sort((p, q) => q[1] - p[1])) md.push(`| ${k} | ${v} |`);
md.push('');
out.items = items.map(x => ({id: x.id, kind: x.kind, type: x.type, text: x.text, ours: x.ours, conflict: x.conflict, expect: x.expect, families: x.families, erg: x.erg, topRules: x.topRules}));
out.falseRejectionCandidates = {count: frej.length, sample: frej.slice(0, 40).map(c => ({type: c.type, text: c.text, ours: c.ours, conflict: c.conflict}))};
md.push('### Samples (for rule-level triage, not for sentence adjudication)', '');
md.push('Over-acceptance candidates:', ''); for (const c of cand.slice(0, 15)) md.push(`- [${c.type}] ${c.text} — ERG: ${c.erg}`);
md.push('', 'False-rejection candidates:', ''); for (const c of frej.slice(0, 15)) md.push(`- [${c.type}] ${c.text} — ours: ${c.ours}${c.conflict ? ' (' + c.conflict + ')' : ''}`);
md.push('');
fs.mkdirSync(path.join(root, 'reports'), {recursive: true});
fs.writeFileSync(path.join(root, 'reports', TAG + '_analysis.md'), md.join('\n'));
fs.writeFileSync(path.join(root, 'reports', TAG + '_analysis.json'), JSON.stringify(out, null, 1));
console.log('wrote reports/' + TAG + '_analysis.{md,json}');
