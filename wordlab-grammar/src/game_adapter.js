'use strict';
/*
 * Starpin Word Lab v2 — adapter between the Phase 0–2 engine/scorer and the
 * Word Lab interface. Exposes window.StarpinWL2:
 *   createGrammar(v11Lexicon) -> {bip39, entries, version, parse(words, opts)}
 *   scorer.scoreParse(parsed)  -> score object (with .score and .breakdown)
 * parse() keeps the interface's result vocabulary (valid, reason, tokens,
 * parse.kind, diagnostic) and adds:
 *   pending  — true for grammar-level failures (conflict / outside grammar):
 *              such sentences may be saved; they reserve their blue tiles and
 *              score 0 until a grammar update recognises them;
 *   wl2      — the full engine result (readings, choice points, conflicts);
 *   reading  — the reading being scored (canonical, or consistent with pins).
 * Pins are {sig, pins}: sig is the word sequence they were made for, so an
 * edited sentence silently drops stale pins.
 */
(function () {
  const req = name => window.__wl2req(name);
  const {createEngine} = req('./engine');
  const {scoreResult, SCORE_VERSION} = req('./score');
  const {HELPER_CANDIDATES} = req('./lexicon');
  const KIND = {declarative: 'clause', imperative: 'imperative', question: 'question', fragment: 'fragment', ellipsis: 'ellipsis'};

  function createGrammar(v11) {
    const engine = createEngine(v11, window.STARPIN_OEWN || null, {erg: window.STARPIN_ERG || null});
    const bip39 = new Set(v11.entries.map(e => e.word));
    const entries = new Map(v11.entries.map(e => [e.word, e]));
    function parse(words, opts = {}) {
      words = words.map(w => String(w).toLowerCase());
      const types = opts.tokenTypes || words.map(w => bip39.has(w) ? 'collected' : 'helper');
      const owned = new Set(opts.owned || []), helpers = new Set(opts.helpers || []);
      // Tile availability (game rules), before any grammar.
      const unknown = words.filter(w => !bip39.has(w) && !HELPER_CANDIDATES.includes(w));
      if (unknown.length) return {valid: false, reason: 'unknown_word', words: unknown, tokens: words};
      const lockedHelpers = words.filter((w, i) => types[i] === 'helper' && !helpers.has(w));
      if (lockedHelpers.length) return {valid: false, reason: 'helper_not_unlocked', words: [...new Set(lockedHelpers)], tokens: words};
      const notOwned = words.filter((w, i) => types[i] === 'collected' && !owned.has(w));
      if (notOwned.length) return {valid: false, reason: 'collected_word_not_available', words: [...new Set(notOwned)], tokens: words};
      const tiles = words.map((w, i) => ({word: w, source: types[i] === 'helper' ? 'helper' : 'collected'}));
      const sig = words.join(' ');
      const pins = opts.pins && opts.pins.sig === sig ? opts.pins.pins : null;
      let res = engine.parseTiles(tiles, {k: 24, pins});
      let pinIgnored = false;
      if (pins && res.state !== 'recognised') { res = engine.parseTiles(tiles, {k: 24}); pinIgnored = true; }
      if (res.state === 'invalid_tiles') {
        if (res.reason === 'duplicate_collected_word') return {valid: false, reason: 'duplicate_collected_word', words: [res.word], tokens: words};
        return {valid: false, reason: 'no_role_for_tile', words: (res.words || []).map(x => x.word), tokens: words, wl2: res};
      }
      if (res.state === 'recognised') {
        return {valid: true, tokens: words, words, parse: {kind: KIND[res.canonical.utteranceType] || 'clause'}, wl2: res, reading: res.canonical,
          pinned: !!pins && !pinIgnored, pinIgnored, version: engine.VERSION};
      }
      // Grammar-level failure: a specific conflict, or outside the grammar.
      const span = c => words.slice(c.span[0], c.span[1]).join(' ');
      if (res.state === 'conflict') {
        const cs = res.conflicts;
        return {valid: false, pending: true, reason: 'grammar_conflict', tokens: words, wl2: res,
          diagnostic: {
            summary: cs.length === 1 ? `Conflict: ${cs[0].explanation}.` : `Two conflicts: ${cs.map(c => c.explanation).join('; and ')}.`,
            detail: cs.map(c => `“${span(c)}” — ${c.explanation}.`).join(' ') + ' Every analysis this grammar can build breaks ' + (cs.length === 1 ? 'this rule.' : 'these rules.'),
            hint: 'Change one of the highlighted words. You can also save it as pending: it keeps its tiles, scores 0 for now, and is re-checked whenever the grammar is updated.',
            issueIndex: cs[0].span[0], issueIndices: cs.map(c => c.span[0])}};
      }
      return {valid: false, pending: true, reason: 'outside_supported_grammar', tokens: words, wl2: res,
        diagnostic: {
          summary: 'Outside what this grammar currently recognises.',
          detail: 'Recognised pieces: ' + (res.partial || []).map(p => p.cat ? `[${p.cat} ${p.text}]` : `“${p.text}”`).join(' ') + '.',
          hint: 'This is a limit of the grammar, not a verdict on English. Save it as pending: it keeps its tiles, scores 0 for now, and is re-checked whenever the grammar is updated.',
          fragments: null}};
    }
    return {bip39, entries, version: engine.VERSION, parse, engine};
  }

  // Coach and display features: construction families plus link types.
  function scoreParse(parsed) {
    const s = scoreResult(parsed.wl2, parsed.reading);
    const fams = new Set(parsed.reading.families);
    if (fams.has('postverbal_adverb') || fams.has('preverbal_adverb')) fams.add('verb_adverb');
    for (const l of s.breakdown.links) fams.add('link_' + l.type);
    return {...s, features: [...fams]};
  }

  window.StarpinWL2 = {createGrammar, scorer: {scoreParse, version: SCORE_VERSION}, SCORE_VERSION};
})();
