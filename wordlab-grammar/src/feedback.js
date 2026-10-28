'use strict';
/*
 * Starpin Word Lab — feedback for a sentence the grammar rejects with a named
 * conflict. Two parts:
 *
 *   messages  plain-language explanations, one per conflict, naming the words
 *             involved and why they clash (built from the nearest analysis the
 *             relaxed grammar found, so they describe that analysis, not a
 *             verdict on English);
 *   fixes     small repairs (add or change a determiner, swap is/are, a/an)
 *             that are TESTED: each candidate is re-parsed with the strict
 *             grammar, and only repairs that make the whole sentence
 *             recognised are offered, best score first. A repair only uses a
 *             gold tile the player has unlocked.
 *
 * Wording for verb frames is deliberately soft: dictionaries list "bless" as
 * transitive, but context can license an object-less use ("Yes, I can
 * bless"), so the message says what the grammar expects, not what English
 * forbids.
 */

const DETS = ['a', 'an', 'the'];
const VERB_PAIRS = {is: 'are', are: 'is', was: 'were', were: 'was', has: 'have', have: 'has', does: 'do', do: 'does'};
const MAX_CANDIDATES = 12;

const q = w => '“' + w + '”';
const feat = (cat, k) => { const m = new RegExp('[\\[,]' + k + '=([^,\\]]+)').exec(cat || ''); return m ? m[1] : null; };
const listOr = ws => ws.length === 1 ? ws[0] : ws.slice(0, -1).join(', ') + ' or ' + ws[ws.length - 1];

function lastIndex(roles, from, to, test) { for (let i = to - 1; i >= from; i--) if (test(roles[i], i)) return i; return -1; }
function firstIndex(roles, from, to, test) { for (let i = from; i < to; i++) if (test(roles[i], i)) return i; return -1; }

// One plain-language message per conflict, plus the candidate edits to try.
function describe(c, roles, words) {
  const [a, b] = c.span, out = {message: null, edits: []};
  if (c.constraint === 'det_noun') {
    const h = lastIndex(roles, a, b, r => r.pos === 'N');
    const head = h >= 0 ? words[h] : words[b - 1];
    const num = h >= 0 ? feat(roles[h].cat, 'num') : null, cnt = h >= 0 ? feat(roles[h].cat, 'cnt') : null;
    const d = firstIndex(roles, a, b, r => r.pos === 'Det');
    if (c.rule === 'np_bare' || d < 0) {
      out.message = `${q(head)} is a single countable thing here, so it needs a word such as “a”, “the” or “this” in front` +
        (b - a > 1 ? ` (${q(words.slice(a, b).join(' '))})` : '') + '.';
      if (words[b] === 'and' || words[a - 1] === 'and')
        out.message += ' Two plain nouns joined by “and” can go without one (“sword and symbol”), but not once either has describing words.';
      out.edits = DETS.map(w => [{at: a, insert: w}]);
      out.bareHead = head;
    } else {
      const det = words[d];
      const why = num === 'pl' ? 'is plural here' : cnt === 'mass' ? 'is uncountable here' : num === 'sg' && cnt === 'count' ? 'is a single countable thing here' : 'does not suit it';
      out.message = `${q(det)} does not go with ${q(head)}, which ${why}.`;
      out.edits = DETS.filter(w => w !== det).map(w => [{at: d, replace: w}]);
    }
  } else if (c.constraint === 'agreement') {
    const v = firstIndex(roles, a, b, r => ['Cop', 'Do', 'HaveAux', 'V', 'Modal'].includes(r.pos));
    const s = lastIndex(roles, 0, a, r => r.role === 'nsubj');
    const verb = v >= 0 ? words[v] : words[a], alt = VERB_PAIRS[verb];
    let subj = s >= 0 ? words[s] : null, number = null;
    if (s >= 0) { const n = feat(roles[s].cat, 'num'); number = n === 'pl' ? 'plural' : n === 'sg' ? 'singular' : null; }
    // A coordinated subject ("sword and symbol") is plural: name all of it.
    if (s >= 0 && firstIndex(roles, s + 1, a, r => r.role === 'conj') >= 0) { number = 'plural'; subj = words.slice(s, lastIndex(roles, s, a, r => r.role === 'conj') + 1).join(' '); }
    out.message = `${q(verb)} does not match its subject` + (subj ? ` ${q(subj)}` : '') + (number ? `, which is ${number}` : '') + '.' + (alt ? ` Try ${q(alt)}.` : '');
    if (alt && v >= 0) out.edits = [[{at: v, replace: alt}]];
  } else if (c.constraint === 'article') {
    const d = firstIndex(roles, a, b, r => r.word === 'a' || r.word === 'an');
    const det = d >= 0 ? words[d] : 'a', next = words[(d >= 0 ? d : a) + 1];
    const alt = det === 'a' ? 'an' : 'a';
    out.message = `“an” goes before a vowel sound and “a” before a consonant sound, so ${q(det + ' ' + next)} should be ${q(alt + ' ' + next)}.`;
    if (d >= 0) out.edits = [[{at: d, replace: alt}]];
  } else if (c.constraint === 'case') {
    const p = firstIndex(roles, a, b, r => r.pos === 'Pron');
    out.message = (p >= 0 ? `${q(words[p])} is the wrong form of the pronoun for its place here` : 'A pronoun has the wrong form for its place here') +
      ' (compare “she” as a subject with “her” as an object).';
  } else if (c.constraint === 'verb_frame') {
    const v = firstIndex(roles, a, b, r => r.pos === 'V' || r.pos === 'VPrep');
    const verb = v >= 0 ? words[v] : words[a];
    if (c.rule === 'vp_intr') out.message = `${q(verb)} is listed as taking an object (${q(verb + ' something')}), and this grammar does not yet accept it on its own. Some contexts allow it (“Can you bless?” “Yes, I can bless.”): if this is one, save it as pending.`;
    else if (c.rule === 'vp_tr') out.message = `${q(verb)} is listed as not taking an object, so ${q(words.slice(v + 1, b).join(' '))} has no role after it.`;
    else out.message = `${q(verb)} is not followed by the kind of words it needs here.`;
  } else if (c.constraint === 'time_reference') {
    const p = firstIndex(roles, a, b, r => feat(r.cat, 'vf') === 'past' || /ct=(was|were)/.test(r.cat || '') || /dt=did/.test(r.cat || ''));
    out.message = (p >= 0 ? `${q(words[p])} is past tense` : 'The verb is past tense') + ', but “tomorrow” is in the future. Use a present or future form (“will …”, “can …”), or a different time word.';
  } else {
    out.message = c.explanation ? c.explanation[0].toUpperCase() + c.explanation.slice(1) + '.' : 'Conflict.';
  }
  return out;
}

// Apply edits to tiles (right to left, so indices stay valid). Inserted and
// replacement words are gold tiles; every other tile keeps its source.
function applyEdits(tiles, edits) {
  const t = tiles.slice();
  for (const e of edits.slice().sort((x, y) => y.at - x.at)) {
    if (e.insert !== undefined) t.splice(e.at, 0, {word: e.insert, source: 'helper'});
    else if (e.replace !== undefined) t[e.at] = {word: e.replace, source: 'helper'};
  }
  return t;
}

// Plain-language messages for a conflict result (cheap: no re-parsing).
const AND_NOTE = ' Two plain nouns joined by “and” can go without one (“sword and symbol”), but not once either has describing words.';
function conflictMessages(res) {
  const words = res.tiles.map(t => t.word), roles = (res.nearestReading && res.nearestReading.roles) || [];
  const parts = res.conflicts.map(c => describe(c, roles, words));
  // Say the "and" note once, after the last message that needs it.
  const withNote = parts.map(p => p.message.endsWith(AND_NOTE));
  const last = withNote.lastIndexOf(true);
  parts.forEach((p, i) => { if (withNote[i] && i !== last) p.message = p.message.slice(0, -AND_NOTE.length); });
  return parts;
}

// Tested repairs (re-parses up to MAX_CANDIDATES variants with the strict
// grammar). opts.canUseHelper(word): is that gold tile available?
// opts.score(result): score for a recognised result (optional).
function findFixes(engine, res, parts, opts = {}) {
  const words = res.tiles.map(t => t.word), can = opts.canUseHelper || (() => true);
  let combos = [[]];
  for (const p of parts) {
    const usable = p.edits.filter(es => es.every(e => can(e.insert !== undefined ? e.insert : e.replace)));
    if (!usable.length) { combos = []; break; }
    const next = [];
    for (const c of combos) for (const es of usable) next.push(c.concat(es));
    combos = next.slice(0, MAX_CANDIDATES);
  }
  const fixes = [], seen = new Set();
  for (const edits of combos) {
    const tiles = applyEdits(res.tiles, edits), key = tiles.map(t => t.word).join(' ');
    if (seen.has(key)) continue; seen.add(key);
    const r = engine.parseTiles(tiles, {k: 8, strictOnly: true});
    if (r.state !== 'recognised') continue;
    fixes.push({words: tiles.map(t => t.word), edits, score: opts.score ? opts.score(r) : null,
      text: edits.map(e => e.insert !== undefined ? `add ${q(e.insert)} before ${q(words[e.at])}` : `change ${q(words[e.at])} to ${q(e.replace)}`).join(' and ')});
  }
  fixes.sort((x, y) => (y.score || 0) - (x.score || 0) || x.edits.length - y.edits.length);
  // Edits that need a gold tile the player has not unlocked (to say so).
  const locked = [...new Set(parts.flatMap(p => p.edits.flat().map(e => e.insert !== undefined ? e.insert : e.replace)).filter(w => !can(w)))];
  return {fixes: fixes.slice(0, 2), tried: seen.size, locked};
}

// One-line summary: first sentence of each message, or one merged sentence
// when every conflict is a missing determiner.
function conflictSummary(parts) {
  if (parts.length > 1 && parts.every(p => p.bareHead))
    return parts.map(p => q(p.bareHead)).join(' and ') + ' each need a word such as “a”, “the” or “this” in front.';
  return parts.map(p => p.message.split(/(?<=\.)\s/)[0]).join(' ');
}

function explainConflict(engine, res, opts = {}) {
  const parts = conflictMessages(res);
  return {messages: parts.map(p => p.message), ...findFixes(engine, res, parts, opts)};
}

module.exports = {conflictMessages, conflictSummary, findFixes, explainConflict};
