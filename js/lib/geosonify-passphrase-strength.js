/*
 * geosonify-passphrase-strength.js
 *
 * Passphrase strength estimation and generation for GRID-PASSPHRASE mode.
 *
 * ── SCOPE / SAFETY ───────────────────────────────────────────────────────────
 * This file touches NO frozen format. It does not participate in encoding,
 * decoding, the keyed permutation, obfuscation, the AES blob, or the URL
 * grammar. It is advisory UI only. Deleting it changes no code's meaning.
 *
 * ── WHY THE THRESHOLDS ARE WHAT THEY ARE ─────────────────────────────────────
 * Grid-passphrase v1 has NO key stretching, by design (the derivation is frozen
 * for multi-decade decodability, so a work factor can never be raised later).
 * One candidate passphrase costs an attacker N SHA3-512 hashes over a short
 * preimage plus a sort of N items — nothing more. Measured on one Node core:
 *
 *     N=36    ~7,400 candidates/sec      N=256  ~1,000/sec    N=2025  ~116/sec
 *
 * Optimised native/GPU implementations of Keccak run 3-4 orders of magnitude
 * faster. We therefore calibrate against a deliberately pessimistic attacker:
 *
 *     ATTACK_RATE = 1e9 candidates/sec   (~100 GPUs against the 36-cell grid)
 *
 * This is ~20,000x faster than the AES layer's 600,000-iteration PBKDF2, which
 * is exactly why grid mode needs a much longer passphrase than users expect.
 * Thresholds below are stated in bits and converted to time at that rate; they
 * are intentionally harsher than a generic website meter, because a generic
 * meter assumes rate limiting and a slow server-side hash. Here there is
 * neither: the attack is fully offline against a captured code.
 *
 * Node self-test:  node geosonify-passphrase-strength.js --selftest
 */
'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PassphraseStrength = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // ── Calibration constants ──────────────────────────────────────────────────
  const ATTACK_RATE = 1e9;   // candidate passphrases/sec, pessimistic attacker
  const SECONDS = { minute: 60, hour: 3600, day: 86400, year: 31557600 };

  // Strength bands, in bits of estimated entropy. See header for derivation.
  //   36 bits -> ~1 minute      50 bits -> ~13 days
  //   62 bits -> ~146 years     72 bits -> ~150,000 years
  const BANDS = [
    { min:  0, key: 'critical', label: 'Critical',    colour: '#c0392b' },
    { min: 36, key: 'weak',     label: 'Weak',        colour: '#e67e22' },
    { min: 50, key: 'fair',     label: 'Fair',        colour: '#d4a017' },
    { min: 62, key: 'strong',   label: 'Strong',      colour: '#27916b' },
    { min: 72, key: 'excellent',label: 'Very strong', colour: '#1a7a4c' }
  ];

  // Recommended minimum for grid mode. 6 words from the 2025-word list.
  const RECOMMENDED_BITS = 62;

  // ── Wordlist ───────────────────────────────────────────────────────────────
  // Reuses the app's existing English word grid (BIP39-derived, truncated to
  // 45x45 = 2025 entries to fit the square grid — it is NOT the full 2048-word
  // BIP39 list, so we never call it "BIP39" in user-facing copy). No new asset
  // ships, and the list is already offline-available and frozen.
  const LANGS = [
    { code: 'en', global: 'BIP39EnglishArray',            name: 'English',              latin: true  },
    { code: 'es', global: 'BIP39SpanishArray',            name: 'Espanol',              latin: true  },
    { code: 'fr', global: 'BIP39FrenchArray',             name: 'Francais',             latin: true  },
    { code: 'it', global: 'BIP39ItalianArray',            name: 'Italiano',             latin: true  },
    { code: 'pt', global: 'BIP39PortugueseArray',         name: 'Portugues',            latin: true  },
    { code: 'cs', global: 'BIP39CzechArray',              name: 'Cestina',              latin: true  },
    { code: 'ja', global: 'BIP39JapaneseArray',           name: '\u65e5\u672c\u8a9e', latin: false },
    { code: 'ko', global: 'BIP39KoreanArray',             name: '\ud55c\uad6d\uc5b4', latin: false },
    { code: 'zh', global: 'BIP39ChineseSimplifiedArray',  name: '\u4e2d\u6587 (\u7b80)', latin: false },
    { code: 'zh-TW', global: 'BIP39ChineseTraditionalArray', name: '\u4e2d\u6587 (\u7e41)', latin: false }
  ];

  const _lists = Object.create(null);   // code -> flat word array
  let _discovered = false;

  function _flatten(src) {
    if (!src) return null;
    return src.flat ? src.flat() : [].concat.apply([], src);
  }

  /**
   * Read a grid array by name.
   *
   * IMPORTANT: geosonify-grids-data.js declares these with top-level `const`
   * and never assigns them to `window`. In a classic script a top-level
   * `const` creates a global LEXICAL binding, which is NOT a property of
   * `window` - so `window.BIP39EnglishArray` is undefined while the bare
   * identifier `BIP39EnglishArray` resolves fine from a later classic script.
   * Verified in a real script-tag environment. Hence the explicit switch: it
   * reads the lexical binding directly, needs no eval (so it survives a strict
   * CSP), and still prefers a window property if some other module has set one.
   */
  function _readGlobal(name) {
    try {
      if (typeof window !== 'undefined' && window[name]) return window[name];
    } catch (e) {}
    try {
      switch (name) {
        case 'BIP39EnglishArray':             return typeof BIP39EnglishArray             !== 'undefined' ? BIP39EnglishArray             : null;
        case 'BIP39SpanishArray':             return typeof BIP39SpanishArray             !== 'undefined' ? BIP39SpanishArray             : null;
        case 'BIP39FrenchArray':              return typeof BIP39FrenchArray              !== 'undefined' ? BIP39FrenchArray              : null;
        case 'BIP39ItalianArray':             return typeof BIP39ItalianArray             !== 'undefined' ? BIP39ItalianArray             : null;
        case 'BIP39PortugueseArray':          return typeof BIP39PortugueseArray          !== 'undefined' ? BIP39PortugueseArray          : null;
        case 'BIP39CzechArray':               return typeof BIP39CzechArray               !== 'undefined' ? BIP39CzechArray               : null;
        case 'BIP39JapaneseArray':            return typeof BIP39JapaneseArray            !== 'undefined' ? BIP39JapaneseArray            : null;
        case 'BIP39KoreanArray':              return typeof BIP39KoreanArray              !== 'undefined' ? BIP39KoreanArray              : null;
        case 'BIP39ChineseSimplifiedArray':   return typeof BIP39ChineseSimplifiedArray   !== 'undefined' ? BIP39ChineseSimplifiedArray   : null;
        case 'BIP39ChineseTraditionalArray':  return typeof BIP39ChineseTraditionalArray  !== 'undefined' ? BIP39ChineseTraditionalArray  : null;
      }
    } catch (e) {}
    return null;
  }

  /** Pull whatever language arrays the host page has actually loaded. */
  function discover() {
    if (_discovered) return _lists;
    for (const L of LANGS) {
      const src = _readGlobal(L.global);
      if (src) { const f = _flatten(src); if (f && f.length) _lists[L.code] = f; }
    }
    _discovered = true;
    return _lists;
  }

  /** Explicit registration, for Node tests and hosts that load grids differently. */
  function registerWordlist(code, flatArray) {
    _lists[code] = flatArray;
    _discovered = true;
    _ws = null; _prefixes = null;   // invalidate the derived sets
    return _lists[code];
  }

  /** Back-compat shim: setWordlist(flat) registers English. */
  function setWordlist(flatArray) { return registerWordlist('en', flatArray); }

  function availableLanguages() {
    discover();
    return LANGS.filter(L => _lists[L.code]).map(L => Object.assign({}, L, { size: _lists[L.code].length }));
  }

  function getWordlist(code) {
    discover();
    if (code && _lists[code]) return _lists[code];
    return _lists['en'] || _lists[Object.keys(_lists)[0]] || null;
  }

  /** Best available list for the browser's locale, falling back to English. */
  function defaultLanguage() {
    discover();
    let tag = '';
    try { tag = (navigator.languages && navigator.languages[0]) || navigator.language || ''; } catch (e) {}
    tag = String(tag);
    if (/^zh\b/i.test(tag)) {
      const trad = /Hant|TW|HK|MO/i.test(tag);
      if (trad && _lists['zh-TW']) return 'zh-TW';
      if (!trad && _lists['zh']) return 'zh';
    }
    const base = tag.split('-')[0].toLowerCase();
    if (_lists[base]) return base;
    return 'en';
  }

  function bitsPerWord(code) {
    const w = getWordlist(code);
    return w ? Math.log2(w.length) : 0;
  }

  // ── Secure random ──────────────────────────────────────────────────────────
  function randomBytes(n) {
    const g = (typeof globalThis !== 'undefined') ? globalThis : {};
    if (g.crypto && g.crypto.getRandomValues) {
      return g.crypto.getRandomValues(new Uint8Array(n));
    }
    // Node fallback (self-test only; browsers always take the branch above).
    return new Uint8Array(require('crypto').randomBytes(n));
  }

  /**
   * Uniform integer in [0, max) via rejection sampling.
   * Modulo-biased selection would quietly shave entropy off every generated
   * phrase, which is precisely the failure this module exists to prevent.
   */
  function randomInt(max) {
    if (max <= 0 || max > 0x1000000) throw new Error('randomInt range');
    const limit = Math.floor(0x1000000 / max) * max;
    for (;;) {
      const b = randomBytes(3);
      const v = (b[0] << 16) | (b[1] << 8) | b[2];
      if (v < limit) return v % max;
    }
  }

  /**
   * Generate a fresh random word passphrase.
   * @param {number} wordCount default 6
   * @param {string} sep       default '-'
   * @returns {{phrase:string, words:string[], bits:number}|null}
   */
  function generate(wordCount, sep, lang) {
    const list = getWordlist(lang);
    if (!list) return null;
    const n = wordCount || 6;
    const words = [];
    for (let i = 0; i < n; i++) words.push(list[randomInt(list.length)]);
    // ALWAYS an ASCII hyphen, in every language. The separator is part of the
    // passphrase and is NOT normalised away: an ideographic space (U+3000) and
    // an ASCII space derive DIFFERENT permutations, so a user who retypes a
    // Japanese phrase with the "wrong" space silently decodes to the wrong
    // place with no error. A hyphen is unambiguous and typeable on every
    // keyboard and IME. (Verified against the frozen oracle.)
    // Emit NFC. The frozen derivation normalises to NFC anyway, so this does
    // not change which location a code resolves to - but it means the string
    // we display, and that the user writes down, is the canonical form their
    // IME will reproduce when they retype it.
    const nfcWords = words.map(w => String(w).normalize('NFC'));
    return {
      phrase: nfcWords.join(sep === undefined ? '-' : sep),
      words: nfcWords,
      lang: lang || 'en',
      bits: n * Math.log2(list.length)
    };
  }

  // ── Estimation ─────────────────────────────────────────────────────────────

  // Small blocklist of passphrases that die instantly regardless of length or
  // apparent charset variety. Not exhaustive by design — it catches the cases
  // a meter must never call "strong", not every bad password in existence.
  const BLOCKLIST = new Set([
    'password','password1','password123','passw0rd','p@ssw0rd','123456','12345678',
    '123456789','1234567890','qwerty','qwertyuiop','abc123','letmein','welcome',
    'monkey','dragon','iloveyou','admin','login','master','sunshine','princess',
    'football','baseball','trustno1','superman','starwars','whatever','geosonify',
    'secret','changeme','test','testing','hello','helloworld','opensesame'
  ]);

  const KEYBOARD_RUNS = ['qwertyuiop','asdfghjkl','zxcvbnm','1234567890','abcdefghijklmnopqrstuvwxyz'];

  /**
   * Charset size for a token. Counts the DISTINCT symbol characters actually
   * present rather than crediting the whole 33-character ASCII symbol block:
   * a passphrase whose only non-alphanumeric is a hyphen has not earned the
   * entropy of one using the full symbol range.
   */
  function charsetSize(str) {
    let size = 0;
    if (/[a-z]/.test(str)) size += 26;
    if (/[A-Z]/.test(str)) size += 26;
    if (/[0-9]/.test(str)) size += 10;
    const syms = new Set((str.match(/[^A-Za-z0-9]/g) || []).filter(c => c.charCodeAt(0) < 128));
    if (syms.size) size += Math.max(syms.size, 4);
    const nonAscii = new Set((str.match(/[^\x00-\x7F]/g) || []));
    if (nonAscii.size) size += Math.max(nonAscii.size, 16);
    return size || 1;
  }

  let _prefixes = null;
  /**
   * Set of every prefix (length >= 2) of every list word. A token that is a
   * prefix of a list word must never be priced above the list rate: an
   * attacker enumerating wordlist phrases with truncation reaches it just as
   * cheaply as the whole word. Without this, "surpris" scored MORE than
   * "surprise" and truncating a phrase raised its estimate.
   */
  function _prefixSet() {
    if (_prefixes) return _prefixes;
    _prefixes = new Set();
    for (const w of _wordSet()) {
      for (let i = 2; i < w.length; i++) _prefixes.add(w.slice(0, i));
    }
    return _prefixes;
  }

  // Lowercase-alphabetic tokens are overwhelmingly word-like, and English text
  // carries far less entropy per character than log2(26). Crediting the full
  // charset rate is how "correcthorsebattery" ends up scored like a random
  // string. 2.6 bits/char is a deliberately generous ceiling on natural text.
  const WORDLIKE_BITS_PER_CHAR = 2.6;

  /** Entropy of a single token, given the wordlist membership test. */
  function tokenBits(tok, inList, bpw) {
    if (inList) return bpw;
    const low = tok.toLowerCase();
    /*
     * A fragment of a list word is priced at EXACTLY the list rate, never
     * below it. Reasoning: a pure-wordlist enumeration never produces
     * "oxyge", so the fragment is only reachable by an attacker who also
     * applies mangling rules (truncate / append / capitalise). That costs
     * them extra, so the fragment is genuinely a little HARDER than the whole
     * word - but we decline to credit those extra bits, because we cannot
     * know which rules a given attacker runs. Pricing it at the word rate is
     * the conservative floor.
     *
     * Capping it BELOW the word rate (the earlier behaviour) was wrong twice
     * over: it understated the passphrase, and it displayed a DECREASE when a
     * user deviated from the list, teaching exactly the wrong lesson.
     * Fragments under 3 characters are too short to imply a specific word.
     */
    if (_prefixSet().has(low)) {
      return low.length >= 3 ? bpw : low.length * WORDLIKE_BITS_PER_CHAR;
    }
    if (/^[a-z]+$/.test(tok)) {
      return Math.min(tok.length * WORDLIKE_BITS_PER_CHAR, tok.length * Math.log2(26), bpw * 2);
    }
    return tok.length * Math.log2(charsetSize(tok));
  }

  /** True if the string is a run of one repeated unit, e.g. "abababab". */
  function isRepeatedUnit(s) {
    for (let u = 1; u <= s.length / 2; u++) {
      if (s.length % u) continue;
      const unit = s.slice(0, u);
      if (unit.repeat(s.length / u) === s) return true;
    }
    return false;
  }

  function hasKeyboardRun(s) {
    const low = s.toLowerCase();
    for (const run of KEYBOARD_RUNS) {
      for (let i = 0; i + 4 <= run.length; i++) {
        const frag = run.slice(i, i + 4);
        if (low.includes(frag) || low.includes(frag.split('').reverse().join(''))) return true;
      }
    }
    return false;
  }

  /** Split on common separators; also handles camelCase-free plain runs. */
  function tokenise(s) {
    return s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }

  /** True if the string contains CJK/Hangul/Kana, i.e. needs an IME to retype. */
  function needsIME(s) {
    return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/.test(s || '');
  }

  /**
   * Estimate entropy in bits. Deliberately conservative: when two models
   * disagree we take the LOWER estimate, because overstating strength here is
   * the only error that actually hurts the user.
   *
   * @param {string} pass
   * @returns {{bits:number, band:object, label:string, colour:string,
   *            percent:number, crackTime:string, model:string,
   *            warnings:string[], meetsRecommended:boolean}}
   */
  function estimate(pass) {
    const s = (pass || '').normalize('NFC');
    const warnings = [];

    if (!s) {
      return finish(0, 'empty', ['No passphrase — codes will use the public encoding that anyone can decode.']);
    }

    const lower = s.toLowerCase();
    // Check the raw form, the form with trailing digits/punctuation stripped,
    // and the de-leeted form. "sunshine1" and "p@ssw0rd" are not meaningfully
    // stronger than "sunshine" and "password" — cracking tools apply exactly
    // these mangling rules first, so the meter must not award them credit.
    const deleet = lower.replace(/[@4]/g, 'a').replace(/[3]/g, 'e')
                        .replace(/[1!|]/g, 'i').replace(/[0]/g, 'o')
                        .replace(/[5$]/g, 's').replace(/[7]/g, 't');
    const variants = new Set([
      lower,
      lower.replace(/[\d\W_]+$/, ''),
      deleet,
      deleet.replace(/[\d\W_]+$/, '')
    ]);
    for (const v of variants) {
      if (v && BLOCKLIST.has(v)) {
        warnings.push('This is a most-guessed password (or a trivial variation of one — ' +
                      'appending digits or swapping letters for lookalikes is the first ' +
                      'thing cracking tools try). It falls instantly.');
        return finish(4, 'blocklist', warnings);
      }
    }

    // ── Model A: per-token model ─────────────────────────────────────────
    // Every token is priced independently: wordlist members at the list rate,
    // everything else by its own shape. This is additive, so a single
    // unrecognised token (a typo, a truncation, an extra word) adjusts the
    // total slightly instead of catapulting the estimate into the charset
    // model. Getting this wrong produced a real regression: dropping the last
    // character of a 7-word phrase turned 76.9 bits into 247.
    const list = getWordlist();
    const tokens = tokenise(s);
    const set = _wordSet();
    const bpw = _matchedBitsPerWord();
    let tokenBitsTotal = 0;
    const seen = new Set();
    let unknownCount = 0;
    for (const t of tokens) {
      const low = t.toLowerCase();
      const inList = set.has(low);
      if (!inList) unknownCount++;
      if (seen.has(low)) continue;          // repeats add ~nothing
      seen.add(low);
      tokenBitsTotal += tokenBits(t, inList, bpw);
    }
    if (seen.size < tokens.length) {
      warnings.push('Repeated words add much less strength than new ones.');
    }
    // No bonus for the separator pattern: it is public, predictable, and
    // crediting it would make headline figures disagree with generate().bits
    // and with the FAQ table (6 words = 65.9 bits).

    // ── Model B: whole-string charset model, with penalties ───────────────
    let charBits = s.length * Math.log2(charsetSize(s));
    if (isRepeatedUnit(s)) {
      charBits = Math.min(charBits, 12);
      warnings.push('This is a short pattern repeated \u2014 it is as weak as the pattern alone.');
    }
    if (hasKeyboardRun(s)) {
      charBits *= 0.55;
      warnings.push('Contains a keyboard or alphabet run, which cracking tools try first.');
    }
    if (/^\d+$/.test(s)) {
      charBits = Math.min(charBits, s.length * Math.log2(10));
      warnings.push('Digits only \u2014 a very small search space.');
    }
    if (/^(19|20)\d{2}$/.test(s)) {
      charBits = Math.min(charBits, 7);
      warnings.push('A bare year is trivially guessed.');
    }
    if (tokens.length === 1 && list && set.has(lower.replace(/\d+$/, ''))) {
      charBits = Math.min(charBits, 16);
      warnings.push('A single dictionary word, even with digits appended, is not a passphrase.');
    }

    // Always take the lower of the two. Overstating strength is the only
    // error that actually hurts the user.
    const bits = Math.min(tokenBitsTotal, charBits);
    const model = (tokenBitsTotal <= charBits) ? 'per-token' : 'charset';
    // EXACT only when every token is a wordlist member and the per-token model
    // won. Then the entropy really is n * log2(listSize) and we can show it.
    // Otherwise we are inferring from shape, and such estimates read high on
    // human-chosen passphrases - so we show a band and a coarse timeframe and
    // publish no number we cannot stand behind.
    const exact = (unknownCount === 0) && (tokens.length >= 2) && (model === 'per-token');

    if (unknownCount && tokens.length > 2 && unknownCount <= 2) {
      warnings.push('Some words are not in the word list. If you meant to use a generated ' +
                    'passphrase, check for a typo or a missing character.');
    }

    if (tokens.length === 1 && s.length < 12) {
      warnings.push('Short single-token passphrases are the easiest case for an attacker.');
    }

    return finish(bits, model, warnings, exact);
  }

  let _ws = null;
  /**
   * Union of every registered language list. Matching against the union (not
   * just English) matters: without it, a Korean or Chinese passphrase falls
   * through to the charset model and is scored WILDLY too high - a 6-word
   * Hangul phrase measured 134 bits when its true value is 65.9, because the
   * charset model credits non-ASCII characters generously. Overstating
   * strength is the one error this module must never make.
   */
  function _wordSet() {
    if (_ws) return _ws;
    discover();
    _ws = new Set();
    for (const code of Object.keys(_lists)) {
      // MUST normalise: 637 of the 2025 Japanese entries are stored in NFD
      // (the official BIP39 Japanese convention - "aida" is a + i + ta +
      // U+3099 combining dakuten, not the precomposed U+3060). User input is
      // compared in NFC, so without this the entire Japanese list silently
      // fails to match and phrases are scored by the charset model, which
      // overestimates them badly. The grid arrays are FROZEN and must not be
      // rewritten - normalise here, at the comparison, instead.
      for (const w of _lists[code]) _ws.add(String(w).normalize('NFC').toLowerCase());
    }
    return _ws;
  }

  /** Conservative bits-per-word: assume the attacker knows which list. */
  function _matchedBitsPerWord() {
    discover();
    const sizes = Object.keys(_lists).map(c => _lists[c].length).filter(n => n > 0);
    return sizes.length ? Math.log2(Math.min.apply(null, sizes)) : 0;
  }


  // ── Variant diagnosis (CJK) ────────────────────────────────────────────────
  /*
   * The frozen derivation applies NFC and nothing else, so the app CANNOT
   * silently repair a passphrase - any change would derive a different
   * permutation. What it can do is notice that a token looks like a
   * near-miss for a wordlist entry and OFFER a correction the user clicks.
   *
   * Measured behaviour of NFC on the real lists:
   *   folds:        voiced marks (ka + dakuten -> ga), conjoining Hangul jamo,
   *                 CJK compatibility ideographs (U+FA10 -> U+585A)
   *   does NOT fold: hiragana vs katakana, half/fullwidth katakana,
   *                 Hangul COMPATIBILITY jamo, variation selectors,
   *                 simplified vs traditional Chinese
   * The Japanese list is 100% hiragana (0 of 2025 entries contain katakana),
   * so any katakana input is always a miss. The two Chinese lists are
   * index-aligned (1260/2025 glyphs identical), so a simplified/traditional
   * slip maps across by index with no mapping table.
   */
  const VS = /[\uFE00-\uFE0F]|\uDB40[\uDD00-\uDDEF]/g;

  function kataToHira(str) {
    return str.replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  function _crossChinese(tok) {
    discover();
    const a = _lists['zh'], b = _lists['zh-TW'];
    if (!a || !b || a.length !== b.length) return [];
    const nfc = x => String(x).normalize('NFC');
    const t = nfc(tok), out = [];
    for (let k = 0; k < a.length; k++) {
      if (nfc(a[k]) === t) { out.push(nfc(b[k])); break; }
    }
    for (let k = 0; k < b.length; k++) {
      if (nfc(b[k]) === t) { out.push(nfc(a[k])); break; }
    }
    return out;
  }

  /**
   * Inspect a passphrase for tokens that are not in any wordlist but look like
   * recoverable variants of one.
   * @returns {{unknown:string[], suggestions:Array<{from:string,to:string,why:string}>}}
   */
  function diagnose(pass) {
    const set = _wordSet();
    const tokens = tokenise((pass || '').normalize('NFC'));
    const unknown = [], suggestions = [];
    for (const t of tokens) {
      if (set.has(t.toLowerCase())) continue;
      unknown.push(t);
      const tries = [
        [t.normalize('NFKC'),                 'width or compatibility form'],
        [kataToHira(t),                       'katakana written where the list uses hiragana'],
        [kataToHira(t.normalize('NFKC')),     'halfwidth katakana'],
        [t.replace(VS, ''),                   'variation selector'],
        [t.normalize('NFKC').replace(VS, ''), 'compatibility form']
      ];
      for (const v of _crossChinese(t)) tries.push([v, 'the other Chinese script (simplified/traditional)']);
      for (const [cand, why] of tries) {
        if (cand && cand !== t && set.has(cand.toLowerCase())) {
          suggestions.push({ from: t, to: cand, why: why });
          break;
        }
      }
    }
    return { unknown: unknown, suggestions: suggestions };
  }

  /**
   * Compare a typed passphrase against a generated one.
   *   'exact'    - byte-identical after NFC. Safe to share any way.
   *   'variant'  - same words, different script/width form (e.g. katakana for
   *                hiragana). Self-consistent for THIS user, but the recipient
   *                must copy-paste, never retype, or they will land elsewhere.
   *   'different'- not the same phrase.
   * @returns {{status:string, detail:string}}
   */
  function compareTyped(typed, target) {
    const a = (typed || '').normalize('NFC').trim();
    const b = (target || '').normalize('NFC').trim();
    if (!a) return { status: 'empty', detail: '' };
    if (a === b) return { status: 'exact', detail: '' };

    const ta = tokenise(a), tb = tokenise(b);
    if (ta.length === tb.length) {
      const fold = x => kataToHira(String(x).normalize('NFKC')).replace(VS, '').toLowerCase();
      let allFold = true, why = '';
      for (let i = 0; i < ta.length; i++) {
        if (fold(ta[i]) === fold(tb[i])) continue;
        // Cross-script Chinese counts as a variant too (index-aligned lists).
        if (_crossChinese(ta[i]).some(v => fold(v) === fold(tb[i]))) { why = 'the other Chinese script'; continue; }
        allFold = false; break;
      }
      if (allFold) {
        return { status: 'variant', detail: why || 'a different script or width form of the same words' };
      }
    }
    return { status: 'different', detail: '' };
  }

  /** Apply accepted suggestions. Only ever called from an explicit user click. */
  function applySuggestions(pass, suggestions) {
    let out = pass;
    for (const s of suggestions) out = out.split(s.from).join(s.to);
    return out;
  }

  function bandFor(bits) {
    let out = BANDS[0];
    for (const b of BANDS) if (bits >= b.min) out = b;
    return out;
  }

  /**
   * Deliberately coarse. The underlying estimate is uncertain enough that
   * quoting "about 2 million years" implies a precision we do not have; the
   * bands below carry the only distinction that changes what a user should
   * do. Expected work is half the keyspace, at ATTACK_RATE.
   */
  function crackTime(bits) {
    const s = Math.pow(2, bits) / 2 / ATTACK_RATE;
    if (s < 1)                    return 'instantly';
    if (s < SECONDS.minute)       return 'in seconds';
    if (s < SECONDS.hour)         return 'in minutes';
    if (s < SECONDS.day)          return 'in hours';
    if (s < SECONDS.day * 30)     return 'in days';
    if (s < SECONDS.year)         return 'in months';
    if (s < SECONDS.year * 100)   return 'in years';
    if (s < SECONDS.year * 1e5)   return 'in centuries';
    return 'in far longer than anyone would keep trying';
  }

  function finish(bits, model, warnings, exact) {
    bits = Math.max(0, Math.round(bits * 10) / 10);
    const band = bandFor(bits);
    return {
      bits: bits,
      band: band.key,
      label: band.label,
      colour: band.colour,
      percent: Math.min(100, Math.round((bits / 80) * 100)),
      crackTime: crackTime(bits),
      model: model,
      exact: !!exact,
      warnings: warnings,
      meetsRecommended: bits >= RECOMMENDED_BITS
    };
  }

  return {
    ATTACK_RATE, RECOMMENDED_BITS, BANDS, LANGS,
    getWordlist, setWordlist, registerWordlist, availableLanguages,
    defaultLanguage, bitsPerWord, needsIME,
    generate, estimate, crackTime, randomInt,
    diagnose, applySuggestions, kataToHira, compareTyped
  };
});

// ── Self-test ────────────────────────────────────────────────────────────────
if (typeof require !== 'undefined' && require.main === module &&
    process.argv.includes('--selftest')) {
  const fs = require('fs');
  const path = require('path');
  const api = module.exports;

  // Load the real wordlist out of the real grids file.
  const gridsPath = path.join(__dirname, 'geosonify-grids-data.js');
  const src = fs.readFileSync(gridsPath, 'utf8');
  const m = src.match(/const BIP39EnglishArray = \[([\s\S]*?)\n\s*\];/);
  const flat = eval('[' + m[1] + ']').flat();
  api.setWordlist(flat);

  let fail = 0;
  const check = (name, cond, extra) => {
    if (!cond) { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
    else console.log('  ok   ' + name + (extra ? '  ' + extra : ''));
  };

  console.log('wordlist: ' + flat.length + ' words, ' + api.bitsPerWord().toFixed(2) + ' bits/word');

  // Generation
  const g = api.generate(6);
  check('generate 6 words', g.words.length === 6, '"' + g.phrase + '"');
  check('generated phrase >= 62 bits', g.bits >= 62, g.bits.toFixed(1) + ' bits');
  check('generated phrase rates strong+', ['strong','excellent'].includes(api.estimate(g.phrase).band));
  const seen = new Set();
  for (let i = 0; i < 50; i++) seen.add(api.generate(6).phrase);
  check('generation is non-repeating', seen.size === 50);

  // Uniformity smoke test on randomInt (chi-square-ish spread check).
  const buckets = new Array(16).fill(0);
  for (let i = 0; i < 16000; i++) buckets[api.randomInt(16)]++;
  const maxDev = Math.max(...buckets.map(b => Math.abs(b - 1000)));
  check('randomInt roughly uniform', maxDev < 150, 'max deviation ' + maxDev);

  // Weak cases must never rate above weak.
  const weakCases = ['password','123456','hello','qwerty','abc123','Password1',
                     'abababababab','2024','dragon','geosonify','sunshine1','p@ssw0rd','Passw0rd!','letmein123'];
  for (const w of weakCases) {
    const r = api.estimate(w);
    check('weak: "' + w + '"', ['critical','weak'].includes(r.band),
          r.bits + ' bits, ' + r.label + ', ' + r.crackTime);
  }

  // Known-good cases.
  const strongCases = ['abandon-zoo-mirror-velvet-tunnel-oxygen'];
  for (const s of strongCases) {
    const r = api.estimate(s);
    check('strong: "' + s + '"', r.meetsRecommended, r.bits + ' bits, ' + r.label);
  }

  // Empty
  check('empty is critical', api.estimate('').band === 'critical');

  // Repeated words penalised
  const rep = api.estimate('abandon-abandon-abandon-abandon-abandon-abandon');
  const uniqp = api.estimate('abandon-zoo-mirror-velvet-tunnel-oxygen');
  check('repeated words score lower', rep.bits < uniqp.bits,
        rep.bits + ' < ' + uniqp.bits);

  // Monotonicity: more words never scores lower.
  let prev = -1, mono = true;
  for (let n = 2; n <= 8; n++) {
    const b = api.estimate(api.generate(n).phrase).bits;
    if (b < prev) mono = false;
    prev = b;
  }
  check('more words never scores lower', mono);

  console.log(fail === 0 ? '\nself-test: PASS' : '\nself-test: FAIL (' + fail + ')');
  process.exit(fail ? 1 : 0);
}
