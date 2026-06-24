/**
 * geosonify-card-renderer.js v1.2
 * 
 * Card rendering and interaction system for Geosonify.
 * Handles encoding modes, card display, and user interactions.
 * 
 * v1.2 Changes:
 * - Chinese BIP39 grids now use Chinese punctuation delimiters:
 *   Word delimiter: 、 (Chinese comma U+3001) [formerly ， (Chinese fullwidth comma U+FF0C)]
 *   Checksum delimiter: 。 (Chinese period U+3002)
 *   Example: 填、模、枪、衡。290
 * - ASCII fallbacks supported for decoding: comma (,) and period (.)
 * - Fullscreen landscape mode now breaks CJK codes at delimiters
 * - Japanese uses middle dot (・ U+30FB), Korean uses hyphen (-)
 * 
 * Dependencies:
 * - GeoCodec (geosonify-codec-engine)
 * - RGB111Lib (geosonify-rgb111-lib)
 * - VexFlowLib (geosonify-vexflow-lib)
 * - sha3_512 (js-sha3)
 * 
 * Usage:
 *   CardRenderer.init({ map, onCoordChange, onCompactUpdate });
 *   CardRenderer.setCoordinate(lat, lon);
 *   CardRenderer.render();
 */

(function(global) {
  'use strict';

  // ============== CARD ACTION ICONS ==============
  // Inline SVG line icons, matching the app's native tab-bar style
  // (viewBox 0 0 24 24, fill:none, stroke:currentColor) so they inherit the
  // button's white colour and stay crisp at any scale — replacing the old emoji
  // glyphs (📤📋📷🖼️🔗) which rendered inconsistently across platforms.
  const _svg = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15" aria-hidden="true">${paths}</svg>`;
  const ICONS = {
    share:  _svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),
    copy:   _svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    camera: _svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
    image:  _svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>'),
    link:   _svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
    decode: _svg('<circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
    key:    _svg('<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M16 7l3 3M14 9l2 2"/>'),
    shuffle:_svg('<path d="M16 3h5v5M21 3l-7 7M4 20l7-7M21 16v5h-5M15 15l6 6M4 4l5 5"/>'),
    settings:_svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    info:   _svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
    pin:    _svg('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'),
    map:    _svg('<path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2zM9 3v16M15 5v16"/>')
  };

  // ============== GRID DEFINITIONS ==============
  
  const CARD_GRIDS = {
    alphanumeric: { 
      name: 'Alphanumeric', 
      grid: typeof alphanumericArray !== 'undefined' ? alphanumericArray : null, 
      defaultIterations: 9, 
      maxIterations: 21, 
      isEmoji: false 
    },
    emoji: { 
      name: 'Emoji', 
      grid: typeof emojiArray !== 'undefined' ? emojiArray : null, 
      defaultIterations: 5, 
      maxIterations: 12, 
      display: 'emoji', 
      isEmoji: true 
    },
    chromacoord: { 
      name: 'ChromaCoord', 
      grid: typeof hexByteArray !== 'undefined' ? hexByteArray : null, 
      fixedIterations: 6, 
      display: 'chroma', 
      isEmoji: false 
    },
    music: { 
      name: 'Music', 
      grid: typeof musicalArray !== 'undefined' ? musicalArray : null, 
      defaultIterations: 8, 
      maxIterations: 20, 
      display: 'music', 
      isEmoji: false 
    },
    hexbyte: { 
      name: 'HexByte', 
      grid: typeof hexByteArray !== 'undefined' ? hexByteArray : null, 
      defaultIterations: 6, 
      maxIterations: 14, 
      isEmoji: false 
    },
    nato: { 
      name: 'NATO', 
      grid: typeof NATOArray !== 'undefined' ? NATOArray : null, 
      defaultIterations: 9, 
      maxIterations: 21, 
      isEmoji: false 
    },
    bip39english: { 
      name: 'BIP39 EN', 
      grid: typeof BIP39EnglishArray !== 'undefined' ? BIP39EnglishArray : null, 
      defaultIterations: 4, 
      maxIterations: 9, 
      isEmoji: false,
      prefixLength: 4,
      delimiter: '-',  // Hyphen between words
      link: 'https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki'
    },
    bip39spanish: { 
      name: 'BIP39 ES', 
      grid: typeof BIP39SpanishArray !== 'undefined' ? BIP39SpanishArray : null, 
      defaultIterations: 4, 
      maxIterations: 9, 
      isEmoji: false,
      prefixLength: 4,
      delimiter: '-',  // Hyphen between words
      link: 'https://github.com/bitcoin/bips/blob/master/bip-0039/spanish.txt'
    },
    bip39french: { 
      name: 'BIP39 FR', 
      grid: typeof BIP39FrenchArray !== 'undefined' ? BIP39FrenchArray : null, 
      defaultIterations: 4, 
      maxIterations: 9, 
      isEmoji: false,
      prefixLength: 4,
      delimiter: '-',  // Hyphen between words
      link: 'https://github.com/bitcoin/bips/blob/master/bip-0039/french.txt'
    },
    bip39italian: { 
      name: 'BIP39 IT', 
      grid: typeof BIP39ItalianArray !== 'undefined' ? BIP39ItalianArray : null, 
      defaultIterations: 4, 
      maxIterations: 9, 
      isEmoji: false,
      prefixLength: 4,
      delimiter: '-',  // Hyphen between words
      link: 'https://github.com/bitcoin/bips/blob/master/bip-0039/italian.txt'
    },
    bip39portuguese: { 
      name: 'BIP39 PT', 
      grid: typeof BIP39PortugueseArray !== 'undefined' ? BIP39PortugueseArray : null, 
      defaultIterations: 4, 
      maxIterations: 9, 
      isEmoji: false,
      prefixLength: 4,
      delimiter: '-',  // Hyphen between words
      link: 'https://github.com/bitcoin/bips/blob/master/bip-0039/portuguese.txt'
    },
    bip39czech: { 
      name: 'BIP39 CS', 
      grid: typeof BIP39CzechArray !== 'undefined' ? BIP39CzechArray : null, 
      defaultIterations: 4, 
      maxIterations: 9, 
      isEmoji: false,
      prefixLength: 4,
      delimiter: '-',  // Hyphen between words
      link: 'https://github.com/bitcoin/bips/blob/master/bip-0039/czech.txt'
    },
    bip39japanese: { 
      name: 'BIP39 JA', 
      grid: typeof BIP39JapaneseArray !== 'undefined' ? BIP39JapaneseArray : null, 
      defaultIterations: 4, 
      maxIterations: 9, 
      isEmoji: false,
      prefixLength: 4,
      delimiter: '\u30FB',  // Middle dot ・ for Japanese
      link: 'https://github.com/bitcoin/bips/blob/master/bip-0039/japanese.txt'
    },
    bip39korean: { 
      name: 'BIP39 KO', 
      grid: typeof BIP39KoreanArray !== 'undefined' ? BIP39KoreanArray : null, 
      defaultIterations: 4, 
      maxIterations: 9, 
      isEmoji: false,
      prefixLength: 4,
      delimiter: '-',  // Hyphen between words
      link: 'https://github.com/bitcoin/bips/blob/master/bip-0039/korean.txt'
    },
    bip39chinesesimplified: { 
      name: 'BIP39 ZH-S', 
      grid: typeof BIP39ChineseSimplifiedArray !== 'undefined' ? BIP39ChineseSimplifiedArray : null, 
      defaultIterations: 4, 
      maxIterations: 9, 
      isEmoji: false,
      prefixLength: 4,
      delimiter: '、',  // Chinese dùnhào comma between words
      checksumDelimiter: '。',  // Chinese period before checksum (e.g., 填、模、枪、衡。290)
      link: 'https://github.com/bitcoin/bips/blob/master/bip-0039/chinese_simplified.txt'
    },
    bip39chinesetraditional: { 
      name: 'BIP39 ZH-T', 
      grid: typeof BIP39ChineseTraditionalArray !== 'undefined' ? BIP39ChineseTraditionalArray : null, 
      defaultIterations: 4, 
      maxIterations: 9, 
      isEmoji: false,
      prefixLength: 4,
      delimiter: '、',  // Chinese dùnhào comma between words
      checksumDelimiter: '。',  // Chinese period before checksum (e.g., 填、模、槍、衡。290)
      link: 'https://github.com/bitcoin/bips/blob/master/bip-0039/chinese_traditional.txt'
    },
    base64: { 
      name: 'Base64', 
      grid: typeof base64Array !== 'undefined' ? base64Array : null, 
      defaultIterations: 8, 
      maxIterations: 19, 
      isEmoji: false 
    },
    // Mono barcode cards (hexByteArray-based, like ChromaCoord)
    qrhex: {
      name: 'QR Hex',
      grid: typeof hexByteArray !== 'undefined' ? hexByteArray : null,
      defaultIterations: 8,
      minIterations: 3,   // 6 hex chars
      maxIterations: 12,  // 24 hex chars — QR V1 byte-mode limit
      display: 'qrhex',
      isEmoji: false
    },
    qrbin: {
      name: 'QR Binary',
      grid: typeof hexByteArray !== 'undefined' ? hexByteArray : null,
      defaultIterations: 12,
      minIterations: 3,   // 6 hex chars / 3 raw bytes
      maxIterations: 17,  // 34 hex chars / 17 raw bytes — QR V1-L byte cap
      display: 'qrbin',
      isEmoji: false
    },
    qrurl: {
      name: 'QR URL',
      grid: typeof hexByteArray !== 'undefined' ? hexByteArray : null,
      // Default/max computed dynamically from URL length — see getQRUrlIterations()
      // User can reduce with − button; max is the dynamic cap
      defaultIterations: 7,
      minIterations: 3,
      display: 'qrurl',
      isEmoji: false,
      dynamicIterations: true // flag for adaptive max iteration logic
    },
    datamatrix: {
      name: 'Data Matrix',
      grid: typeof hexByteArray !== 'undefined' ? hexByteArray : null,
      defaultIterations: 8,
      minIterations: 3,   // 6 hex chars / 3 bytes — fits 10×10 ECC 200
      maxIterations: 12,  // 24 hex chars / 12 bytes — fits 16×16 ECC 200
      display: 'datamatrix',
      isEmoji: false
    },
    // Deprecated but kept for backwards compatibility decoding
    bytewords: { 
      name: 'ByteWords', 
      grid: typeof byteWordsArray !== 'undefined' ? byteWordsArray : null, 
      defaultIterations: 6, 
      maxIterations: 14, 
      isEmoji: false,
      deprecated: true
    },
    bytewordsmin: { 
      name: 'ByteWordsMin', 
      grid: typeof byteWordsMinimalArray !== 'undefined' ? byteWordsMinimalArray : null, 
      defaultIterations: 6, 
      maxIterations: 14, 
      isEmoji: false,
      deprecated: true
    },
    byteemoji: { 
      name: 'ByteEmoji', 
      grid: typeof byteEmojiArray !== 'undefined' ? byteEmojiArray : null, 
      defaultIterations: 6, 
      maxIterations: 14, 
      display: 'emoji', 
      isEmoji: true,
      deprecated: true
    }
  };

  // ============== INTERNAL STATE ==============
  
  let cardState = {
    visible: ['alphanumeric', 'chromacoord', 'emoji', 'music', 'datamatrix', 'qrhex', 'bip39english', 'hphex'],
    order: ['alphanumeric', 'chromacoord', 'emoji', 'music', 'datamatrix', 'qrhex', 'qrbin', 'qrurl', 'bip39english', 'bip39spanish', 'bip39french', 'bip39italian', 'bip39portuguese', 'bip39czech', 'bip39japanese', 'bip39korean', 'bip39chinesesimplified', 'bip39chinesetraditional', 'hexbyte', 'nato', 'base64', 'bytewords', 'bytewordsmin', 'byteemoji', 'hphex', 'hpquad', 'hp64', 'hpmatrix', 'chessboard', 'hpchessboard'],
    iterations: {},
    active: 'alphanumeric',
    checksumEnabled: {}  // Track which grids have checksum enabled (currently just bip39english)
  };

  // Chessboard cards: render pieces as Unicode symbols (false) or letters K/Q/R/B/N/P (true).
  let chessUseLetters = false;
  
  // Initialize default iterations
  Object.keys(CARD_GRIDS).forEach(key => {
    if (CARD_GRIDS[key].dynamicIterations) {
      // Dynamic iteration cards (e.g. qrurl) — computed at render time
      // Set a sensible default; actual value comes from getQRUrlIterations()
      cardState.iterations[key] = CARD_GRIDS[key].defaultIterations || 7;
    } else {
      cardState.iterations[key] = CARD_GRIDS[key].fixedIterations || CARD_GRIDS[key].defaultIterations;
    }
  });
  
  let passphrase = '';
  let obfuscated = false;
  let rawModeActive = false;
  let currentCardCoord = null;
  
  const gridCache = new Map();
  
  // ============== CRC32C (Castagnoli) ==============
  // Used for BIP39 checksum words
  
  const CRC32C_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let crc = i;
      for (let j = 0; j < 8; j++) {
        crc = (crc & 1) ? (0x82F63B78 ^ (crc >>> 1)) : (crc >>> 1);
      }
      table[i] = crc;
    }
    return table;
  })();
  
  function crc32c(str) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < str.length; i++) {
      crc = CRC32C_TABLE[(crc ^ str.charCodeAt(i)) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  
  /**
   * Convert a (possibly delimited/prefixed) code to a comma-separated string of
   * base-grid flat indices.  This is grid-vocabulary-agnostic — the same location
   * encoded in English BIP39 and Spanish BIP39 will produce identical index strings,
   * so checksums computed from this value are cross-grid consistent.
   * Falls back to the raw code string if tokenization fails (legacy safety).
   */
  function codeToIndexString(code, gridKey) {
    const gridDef = CARD_GRIDS[gridKey];
    if (!gridDef || !gridDef.grid) return code;
    const baseGrid = gridDef.grid;
    const flat = baseGrid.flat();

    // Strip delimiters (native and ASCII fallbacks for CJK)
    let normalized = code;
    if (gridDef.delimiter) {
      normalized = normalized.split(gridDef.delimiter).join('');
      if (gridDef.delimiter === '、') normalized = normalized.split(',').join('');
    }

    // Normalize prefix-match grids (BIP39) to canonical full-word form
    if (gridDef.prefixLength) {
      const canon = normalizeByPrefix(normalized, flat, gridDef.prefixLength, null);
      if (canon) normalized = canon;
    }

    // Tokenize to symbols, then map each to its flat index in the base grid
    let tokens;
    if (typeof GeoCodec !== 'undefined' && GeoCodec.tokenizeCode) {
      tokens = GeoCodec.tokenizeCode(normalized, flat);
    }
    if (!tokens || !tokens.length) return code; // fallback: raw string

    const indices = tokens.map(sym => flat.indexOf(sym));
    if (indices.some(i => i < 0)) return code; // fallback if any symbol not found
    return indices.join(',');
  }

  /**
   * Compute numeric checksum (3-digit number like CVC on credit card).
   * When gridKey is supplied, hashes the index sequence (cross-grid consistent).
   * @param {string} code
   * @param {string} [gridKey]
   * @returns {string} 3-digit string "000" to "999"
   */
  function computeChecksumNumeric(code, gridKey) {
    const input = gridKey ? codeToIndexString(code, gridKey) : code;
    const checksum = crc32c(input) % 1000;
    return checksum.toString().padStart(3, '0');
  }

  function computeChecksumWord(code, gridKey) {
    const gridDef = CARD_GRIDS[gridKey];
    if (!gridDef || !gridDef.grid) return null;
    const flat = gridDef.grid.flat();
    const indexString = codeToIndexString(code, gridKey);
    const checksum = crc32c(indexString) % flat.length;
    return flat[checksum];
  }
  
  function validateChecksum(codeWithChecksum, gridKey) {
    // Returns { valid: boolean, code: string (without checksum), checksumWord: string|null }
    const gridDef = CARD_GRIDS[gridKey];
    
    // Find the checksum separator - could be ASCII period (.) or Chinese period (。)
    let dotIdx = codeWithChecksum.lastIndexOf('.');
    let checksumSep = '.';
    
    // Check for Chinese period (。) as checksum separator
    const chinesePeriodIdx = codeWithChecksum.lastIndexOf('。');
    if (chinesePeriodIdx > dotIdx) {
      dotIdx = chinesePeriodIdx;
      checksumSep = '。';
    }
    
    if (dotIdx < 0) {
      return { valid: null, code: codeWithChecksum, checksumWord: null }; // No checksum present
    }
    
    let code = codeWithChecksum.slice(0, dotIdx);
    const providedChecksum = codeWithChecksum.slice(dotIdx + checksumSep.length);
    
    // Strip delimiter from code for checksum calculation
    // Handle both native delimiter AND ASCII fallbacks
    let normalizedCode = code;
    if (gridDef && gridDef.delimiter) {
      normalizedCode = code.split(gridDef.delimiter).join('');
      // Also strip ASCII fallback delimiters for Chinese
      if (gridDef.delimiter === '、') {
        normalizedCode = normalizedCode.split(',').join('');
      }
    }
    
    // If grid uses prefix matching, normalize code to canonical form
    if (gridDef && gridDef.prefixLength && gridDef.grid) {
      const flat = gridDef.grid.flat();
      const normalized = normalizeByPrefix(normalizedCode, flat, gridDef.prefixLength, null);
      if (normalized) {
        normalizedCode = normalized;
      } else {
        return { valid: false, code: code, checksumWord: providedChecksum };
      }
    }
    
    // Check if checksum is numeric (3 digits) or word
    const isNumericChecksum = /^\d{3}$/.test(providedChecksum);
    
    let isValid;
    if (isNumericChecksum) {
      const expectedNumeric = computeChecksumNumeric(normalizedCode, gridKey);
      isValid = providedChecksum === expectedNumeric;
    } else if (gridDef && gridDef.prefixLength) {
      // Word checksum with prefix matching
      const expectedWord = computeChecksumWord(normalizedCode, gridKey);
      const prefixLen = gridDef.prefixLength;
      const providedPrefix = normalizeAccents(providedChecksum.slice(0, prefixLen).toLowerCase());
      const expectedPrefix = expectedWord ? normalizeAccents(expectedWord.slice(0, prefixLen).toLowerCase()) : '';
      isValid = providedPrefix === expectedPrefix;
    } else {
      const expectedWord = computeChecksumWord(normalizedCode, gridKey);
      isValid = providedChecksum === expectedWord;
    }
    
    return {
      valid: isValid,
      code: normalizedCode,  // Return normalized code for decoding (without delimiters)
      checksumWord: providedChecksum
    };
  }
  
  // Refresh grid references - call this at init in case arrays weren't available at load time
  function refreshGridReferences() {
    const gridArrayMap = {
      alphanumeric: 'alphanumericArray',
      emoji: 'emojiArray',
      chromacoord: 'hexByteArray',
      music: 'musicalArray',
      hexbyte: 'hexByteArray',
      nato: 'NATOArray',
      // BIP39 wordlists - all languages
      bip39english: 'BIP39EnglishArray',
      bip39spanish: 'BIP39SpanishArray',
      bip39french: 'BIP39FrenchArray',
      bip39italian: 'BIP39ItalianArray',
      bip39portuguese: 'BIP39PortugueseArray',
      bip39czech: 'BIP39CzechArray',
      bip39japanese: 'BIP39JapaneseArray',
      bip39korean: 'BIP39KoreanArray',
      bip39chinesesimplified: 'BIP39ChineseSimplifiedArray',
      bip39chinesetraditional: 'BIP39ChineseTraditionalArray',
      base64: 'base64Array',
      // Barcode cards (all use hexByteArray)
      qrhex: 'hexByteArray',
      qrurl: 'hexByteArray',
      datamatrix: 'hexByteArray',
      bytewords: 'byteWordsArray',
      bytewordsmin: 'byteWordsMinimalArray',
      byteemoji: 'byteEmojiArray'
    };
    
    for (const [gridKey, arrayName] of Object.entries(gridArrayMap)) {
      if (CARD_GRIDS[gridKey] && !CARD_GRIDS[gridKey].grid && typeof window[arrayName] !== 'undefined') {
        CARD_GRIDS[gridKey].grid = window[arrayName];
        console.log(`[CardRenderer] Late-bound grid: ${gridKey} from ${arrayName}`);
      }
    }
  }
  
  // External dependencies (set via init)
  let callbacks = {
    onCoordChange: null,
    onCompactUpdate: null,
    getMap: null
  };

  // ============== STATE PERSISTENCE ==============
  
  // Language code to BIP39 grid mapping
  const LANG_TO_BIP39 = {
    'en': 'bip39english',
    'es': 'bip39spanish',
    'fr': 'bip39french',
    'it': 'bip39italian',
    'pt': 'bip39portuguese',
    'cs': 'bip39czech',
    'ja': 'bip39japanese',
    'ko': 'bip39korean',
    'zh': 'bip39chinesesimplified',  // Default Chinese to simplified
    'zh-CN': 'bip39chinesesimplified',
    'zh-TW': 'bip39chinesetraditional',
    'zh-HK': 'bip39chinesetraditional',
    'zh-Hans': 'bip39chinesesimplified',
    'zh-Hant': 'bip39chinesetraditional',
  };
  
  /**
   * Auto-add BIP39 card based on device language (first load only)
   */
  // Register GIS reference grids into CARD_GRIDS. All GIS cards (incl. Plus
  // Code) are available via "+ Add Mode"; none are surfaced by default.
  function registerGISCards() {
    if (typeof GISGrids === 'undefined') return;
    const defs = GISGrids.cardDefs();
    const order = ['pluscode', 'mgrs', 'geohash', 'utm', 'nztm', 'bng', 'mga', 'localgrid'];
    for (const key of order) {
      if (!defs[key]) continue;
      CARD_GRIDS[key] = defs[key];
      if (cardState.iterations[key] === undefined) {
        cardState.iterations[key] = defs[key].defaultIterations;
      }
      if (!cardState.order.includes(key)) cardState.order.push(key);
    }
  }

  // Register HEALPix reference grids (equal-area, hierarchical). Three
  // serializations of one nested index: hphex (default-visible, robust),
  // hpquad and hp64 (added via "+ Add Mode"). Marked `healpix:<key>` so the
  // renderer routes encode/decode to HealpixGrids while keeping them eligible
  // for the trademark features the `gis` flag disables.
  function registerHealpixCards() {
    if (typeof HealpixGrids === 'undefined') return;
    const defs = HealpixGrids.cardDefs();
    const order = ['hphex', 'hpquad', 'hp64'];
    for (const key of order) {
      if (!defs[key]) continue;
      CARD_GRIDS[key] = defs[key];
      if (cardState.iterations[key] === undefined) {
        cardState.iterations[key] = defs[key].defaultIterations;
      }
      if (!cardState.order.includes(key)) cardState.order.push(key);
    }

    // HEALPix Matrix (hpmatrix): the SAME hphex code, rendered as a Data Matrix
    // barcode instead of text. It reuses the hphex engine wholesale via
    // `healpix:'hphex'` (so passphrase + obfuscation + encode/decode all work
    // identically) and `display:'datamatrix'` (so every existing
    // display==='datamatrix' render/scan path picks it up). hphex is case-free
    // and URL-safe, so it sits cleanly in the symbol with no case hazard.
    //
    // EVERY ORDER 1..73 is reachable (femtometre-scale at the deep end). hphex
    // left-pads when packing, so ODD orders are length-ambiguous; the symbol
    // therefore carries an "@k" order suffix ONLY when the order is odd (even
    // orders are self-describing and stay clean). This lets someone address an
    // EXACT cell at any order — including odd ones — while the common, even-order
    // case shows no suffix. HealpixGrids.decode/inferOrder strip "@k" natively.
    if (defs.hphex) {
      CARD_GRIDS.hpmatrix = {
        name: 'HEALPix Matrix',
        healpix: 'hphex',
        grid: null,
        defaultIterations: 22,           // even → 1.6 m, clean (no suffix)
        minIterations: 1,
        // Data Matrix capacity cap: order 46 → 24 hex chars, the most this
        // symbol size holds. Beyond 46 the encoder silently caps the data and
        // the rendered image stops changing, so clicking deeper is meaningless
        // (and would imply precision the symbol can't carry). 46 is even, so the
        // code stays clean with no @k order suffix.
        maxIterations: 46,
        display: 'datamatrix',
        link: defs.hphex.link,
        isEmoji: false,
        curvedCell: true
      };
      if (cardState.iterations.hpmatrix === undefined) {
        cardState.iterations.hpmatrix = CARD_GRIDS.hpmatrix.defaultIterations;
      }
      if (!cardState.order.includes('hpmatrix')) cardState.order.push('hpmatrix');
    }
  }

  // Register the two Chessboard cards. Like hpmatrix, these are PRESENTATIONS of an existing
  // hex code (chessOf: which sibling supplies the hex) rendered as a chess board, NOT new
  // coordinate encoders. `display:'chessboard'` routes render/scan to the chessboard paths.
  //   - chessboard      : standard Geosonify hex   (chessOf: 'hexbyte')
  //   - hpchessboard    : HEALPix hex              (chessOf: 'hphex')
  // Both reuse the sibling's encode/decode/passphrase/obfuscation untouched. The chess engine
  // (ChessboardLib) caps usable precision at 23 hex (session 8 bishop fix restored the bishop
  // layer's entropy: maxHex 19→23); the sibling's iterations are clamped so a card never asks
  // for a code the board can't hold (refused-not-truncated is the backstop).
  function registerChessboardCards() {
    if (typeof ChessboardLib === 'undefined') return;
    // Per-card precision caps — set to the MAXIMUM that still fits the board with zero
    // round-trip failures (verified 20k samples/length, 0 corrupt at the cap, refusal just past it).
    //   standard Chessboard: HexByte is a 16×16 grid (256 symbols) — each iteration emits one
    //     BYTE = 2 hex chars, so output length is always EVEN. 11 iterations = 22 hex, the
    //     largest even length that fits the 23-hex board (~1.65 µm × 1.14 µm cell). 12 iters = 24
    //     hex exceeds the board and would be refused, so 11 is the guaranteed-fit ceiling.
    //   HEALPix Chessboard: the stepper is HEALPix order k directly; hphex packs 2 levels/hex char
    //     (hex length = ceil(k/2)+1, validated vs order 36→19 and order 46→24 elsewhere). Order 44
    //     = 23 hex (~5.9 µm cell), the deepest order that fits; order 45 = 24 hex would be refused.
    // ChessboardLib's refusal remains the hard backstop if a sibling ever exceeds these.
    CARD_GRIDS.chessboard = {
      name: 'Chessboard',
      chessOf: 'hexbyte',
      chessFormat: 'standard',
      grid: null,
      defaultIterations: 9,
      minIterations: 1,
      maxIterations: 11,
      display: 'chessboard',
      isEmoji: false
    };
    CARD_GRIDS.hpchessboard = {
      name: 'HEALPix · Chessboard',
      chessOf: 'hphex',
      chessFormat: 'healpix',
      healpixLabel: true,
      grid: null,
      defaultIterations: 36,
      minIterations: 1,
      maxIterations: 44,
      display: 'chessboard',
      link: (typeof HealpixGrids !== 'undefined' && HealpixGrids.cardDefs && HealpixGrids.cardDefs().hphex)
        ? HealpixGrids.cardDefs().hphex.link : null,
      isEmoji: false
    };
    for (const key of ['chessboard', 'hpchessboard']) {
      if (cardState.iterations[key] === undefined) {
        cardState.iterations[key] = CARD_GRIDS[key].defaultIterations;
      }
      if (!cardState.order.includes(key)) cardState.order.push(key);
    }
  }

  // One-time: surface the HEALPix hex card by default (incl. existing users
  // whose saved state predates it). Runs AFTER loadCardState so it doesn't get
  // overwritten by the restore. hpquad/hp64 stay add-on only.
  function surfaceHealpixDefault() {
    if (typeof HealpixGrids === 'undefined') return;
    try {
      if (!localStorage.getItem('geosonify_hphex_default_added')) {
        if (!cardState.visible.includes('hphex')) cardState.visible.push('hphex');
        localStorage.setItem('geosonify_hphex_default_added', '1');
        saveCardState();
      }
    } catch (e) { /* private mode */ }
  }

  // One-time: surface the standard Chessboard card by default for existing users whose saved
  // state predates it. New users get it from the default `visible` array above. HEALPix
  // Chessboard stays add-on only ("+ Add Mode").
  function surfaceChessboardDefault() {
    if (typeof ChessboardLib === 'undefined') return;
    try {
      if (!localStorage.getItem('geosonify_chessboard_default_added')) {
        if (CARD_GRIDS.chessboard && !cardState.visible.includes('chessboard')) {
          cardState.visible.push('chessboard');
        }
        localStorage.setItem('geosonify_chessboard_default_added', '1');
        saveCardState();
      }
    } catch (e) { /* private mode */ }
  }

  function autoAddBIP39ByLanguage() {    const STORAGE_KEY = 'geosonify_bip39_lang_checked';
    
    // Only run once per device
    if (localStorage.getItem(STORAGE_KEY)) {
      return;
    }
    
    try {
      const lang = navigator.language || navigator.userLanguage || '';
      
      // Try exact match first (e.g., "zh-CN")
      let bip39Key = LANG_TO_BIP39[lang];
      
      // Try base language (e.g., "es" from "es-ES")
      if (!bip39Key && lang.includes('-')) {
        const baseLang = lang.split('-')[0];
        bip39Key = LANG_TO_BIP39[baseLang];
      }
      
      // Also check navigator.languages for preferences
      if (!bip39Key && navigator.languages) {
        for (const l of navigator.languages) {
          bip39Key = LANG_TO_BIP39[l];
          if (bip39Key) break;
          if (l.includes('-')) {
            bip39Key = LANG_TO_BIP39[l.split('-')[0]];
            if (bip39Key) break;
          }
        }
      }
      
      // If we found a matching BIP39 grid and it's not already visible, add it
      if (bip39Key && CARD_GRIDS[bip39Key] && !cardState.visible.includes(bip39Key)) {
        cardState.visible.push(bip39Key);
        // Add to order if not present
        if (!cardState.order.includes(bip39Key)) {
          // Insert after bip39english if present, otherwise at start of BIP39 section
          const enIdx = cardState.order.indexOf('bip39english');
          if (enIdx >= 0) {
            cardState.order.splice(enIdx + 1, 0, bip39Key);
          } else {
            cardState.order.push(bip39Key);
          }
        }
        saveCardState();
        console.log(`[CardRenderer] Auto-added ${bip39Key} based on device language: ${lang}`);
      }
      
      // Mark as checked so we don't run again
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch (e) {
      console.warn('[CardRenderer] Failed to auto-add BIP39 by language:', e);
      // Still mark as checked to avoid repeated errors
      localStorage.setItem(STORAGE_KEY, 'true');
    }
  }
  
  function loadCardState() {
    try {
      const saved = localStorage.getItem('geosonify_card_state');
      if (saved) {
        const p = JSON.parse(saved);
        if (p.visible) cardState.visible = p.visible;
        if (p.order) cardState.order = p.order;
        if (p.iterations) Object.assign(cardState.iterations, p.iterations);
        if (p.active && CARD_GRIDS[p.active]) cardState.active = p.active;
        if (p.checksumEnabled) cardState.checksumEnabled = p.checksumEnabled;
        
        // Ensure any built-in grids missing from saved order get added
        // (handles new grids added after user's state was first saved)
        Object.keys(CARD_GRIDS).forEach(key => {
          if (!cardState.order.includes(key)) {
            cardState.order.push(key);
          }
        });
      }
      
      // Default speaker (per-word) view OFF for BIP39 grids, so cards open in
      // the compact view. The ✓ tick switches to the per-word view.
      Object.keys(CARD_GRIDS).forEach(key => {
        if (CARD_GRIDS[key].prefixLength && cardState.checksumEnabled[key] === undefined) {
          cardState.checksumEnabled[key] = false;
        }
      });
    } catch (e) {
      console.warn('[CardRenderer] Failed to load card state:', e);
    }
  }
  
  function saveCardState() {
    try { 
      localStorage.setItem('geosonify_card_state', JSON.stringify(cardState)); 
    } catch (e) {
      console.warn('[CardRenderer] Failed to save card state:', e);
    }
  }

  // ============== GRID SHUFFLING (PASSPHRASE) — FROZEN FORMAT v1 ==============
  //
  // ⚠ FROZEN — DO NOT CHANGE, EVER. A passphrase code generated today must still
  // decode decades from now, and a bare code carries no version field, so a wrong
  // derivation yields a different valid-looking location rather than an error.
  // Permanently immutable: this prefix string (exact spelling/case/hyphens/trailing
  // pipe), NFC normalisation, the "|chain:" join, the comma-joined chain indices,
  // SHA3-512 as the hash, the little-endian u32 index, the sort + tie-break, and the
  // base grids in geosonify-grids-data.js. To strengthen privacy, use AES URL mode
  // (which carries its own version + parameters); never mutate this. See
  // grid-passphrase-v1-reference.js and FROZEN-FORMAT-SPEC.md.
  const GRID_V1_PREFIX = 'geosonify-grid-pass-v1|';

  function shuffleGridAndOrder(grid, pass, chainPrefix = '') {
    if (!pass || pass.length === 0) {
      return { grid, order: grid.flat().map((_, i) => i) };
    }
    
    const enc = new TextEncoder();
    // Frozen v1 preimage: prefix + NFC(passphrase) + "|chain:" + chain.
    // NFC makes visually identical passphrases (accents, Māori macrons, CJC) decode
    // the same on any device/OS; the prefix domain-separates this SHA3 use from any
    // other. The "|chain:" marker is always present (even for the empty first chain).
    const seedString = GRID_V1_PREFIX + pass.normalize('NFC') + '|chain:' + chainPrefix;
    const passBytes = enc.encode(seedString);
    
    function u32le(n) { 
      return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); 
    }
    
    const w = grid[0].length;
    const flat = grid.flat().map((val, idx) => ({ val, idx }));
    const N = flat.length;
    const keys = new Array(N);
    
    for (let i = 0; i < N; i++) { 
      const h = sha3_512.create(); 
      h.update(passBytes); 
      h.update(u32le(i)); 
      keys[i] = new Uint8Array(h.arrayBuffer()); 
    }
    
    function cmpKey(aIdx, bIdx) { 
      const ka = keys[aIdx], kb = keys[bIdx]; 
      for (let j = 0; j < ka.length; j++) { 
        if (ka[j] !== kb[j]) return ka[j] - kb[j]; 
      } 
      return 0; 
    }
    
    flat.sort((a, b) => cmpKey(a.idx, b.idx) || a.idx - b.idx);
    const order = flat.map(o => o.idx);
    const out = [];
    
    for (let i = 0; i < N; i += w) {
      out.push(flat.slice(i, i + w).map(o => o.val));
    }
    
    return { grid: out, order };
  }
  
  function getShuffledGrid(gridKey, chainPrefix = '') {
    const gridDef = CARD_GRIDS[gridKey];
    const base = gridDef?.grid;
    if (!base) return null;
    
    // For position-dependent shuffling, include chainPrefix in cache key
    const cacheKey = `${gridKey}|${passphrase}|${chainPrefix}`;
    if (gridCache.has(cacheKey)) return gridCache.get(cacheKey);
    
    const result = shuffleGridAndOrder(base, passphrase, chainPrefix);
    gridCache.set(cacheKey, result);
    return result;
  }
  
  function clearGridCache() { 
    gridCache.clear(); 
  }

  // ============== ENCODING/DECODING ==============
  
  function _encodeCardCoordinateInternal(gridKey, lat, lon, iterations) {
    const gridDef = CARD_GRIDS[gridKey];
    // Chessboard / HEALPix-Chessboard: a PRESENTATION of a sibling's hex code (chessOf), not a
    // coordinate encoder of its own. Encode the sibling's hex (reusing its passphrase/obfuscation
    // pipeline wholesale); the board itself is produced at render time by ChessboardLib. We store
    // and round-trip the HEX here — the board is a view of it, exactly as hpmatrix is a Data
    // Matrix view of hphex. iterations is interpreted in the sibling's terms.
    if (gridDef && gridDef.chessOf) {
      return _encodeCardCoordinateInternal(gridDef.chessOf, lat, lon, iterations);
    }
    // HEALPix reference grids (hphex/hpquad/hp64) — own engine, hierarchical.
    // Tier 2: keyed permutation (passphrase) + position-shift (obfuscation),
    // both at the quaternary tree level, conforming to the vocabulary-grid
    // model. Passphrase permutes via the injected frozen shuffle; obfuscation
    // is the same index-shift principle as GeoCodec.applyObfuscation, adapted
    // to HEALPix's per-position alphabets (face=12, levels=4).
    if (gridDef && gridDef.healpix && typeof HealpixGrids !== 'undefined') {
      const opt = {};
      if (passphrase) { opt.pass = passphrase; opt.shuffleFn = shuffleGridAndOrder; }
      if (obfuscated) { opt.obf = true; }
      return HealpixGrids.encode(gridDef.healpix, lat, lon, iterations, opt);
    }
    // GIS reference grids (Plus Codes, MGRS, UTM, NZTM, …) — own engine, no shuffle/obfuscation
    if (gridDef && gridDef.gis && typeof GISGrids !== 'undefined') {
      return GISGrids.encode(gridDef.gis, lat, lon, iterations);
    }
    const baseGrid = gridDef?.grid;
    if (!baseGrid) return '';
    
    const rows = baseGrid.length;
    const cols = baseGrid[0].length;
    
    // No passphrase: use original single-shuffle approach (fast path)
    if (!passphrase) {
      const shuffled = getShuffledGrid(gridKey);
      if (!shuffled) return '';
      
      const grid = shuffled.grid;
      
      if (typeof GeoCodec !== 'undefined' && GeoCodec.encodeHierarchical) {
        let code = GeoCodec.encodeHierarchical(lat, lon, grid, iterations);
        if (obfuscated && code) {
          const flat = grid.flat();
          code = GeoCodec.applyObfuscation('encode', code, flat);
        }
        
        // For CJK grids with delimiter, insert delimiter between tokens
        if (code && gridDef && gridDef.delimiter) {
          const flat = grid.flat();
          const tokens = GeoCodec.tokenizeCode(code, flat);
          if (tokens && tokens.length > 0) {
            code = tokens.join(gridDef.delimiter);
          }
        }
        
        return code;
      }
      return '';
    }
    
    // Position-dependent shuffle: encode one iteration at a time
    // Each iteration's permutation depends on all previous encoded flat indices
    let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
    let code = '';
    let chainPrefix = '';  // Index-based chain — grid-vocabulary-independent
    
    for (let it = 0; it < iterations; it++) {
      // Get shuffled grid for THIS iteration, based on flat indices so far
      const shuffled = getShuffledGrid(gridKey, chainPrefix);
      const grid = shuffled.grid;
      const flat = grid.flat();
      
      // Find cell for current position
      const rFrac = (latMax - lat) / (latMax - latMin);
      const cFrac = (lon - lonMin) / (lonMax - lonMin);
      const r = Math.min(rows - 1, Math.floor(rFrac * rows));
      const c = Math.min(cols - 1, Math.floor(cFrac * cols));
      
      // Get symbol from shuffled grid
      const flatIdx = r * cols + c;
      const symbol = flat[flatIdx];
      code += symbol;
      
      // Append flat index to chain (comma-separated to avoid e.g. 2+9 == 29 collision)
      chainPrefix += (chainPrefix ? ',' : '') + String(flatIdx);
      
      // Update bounds for next iteration
      const dLat = (latMax - latMin) / rows;
      const dLon = (lonMax - lonMin) / cols;
      latMax = latMax - dLat * r;
      latMin = latMax - dLat;
      lonMin = lonMin + dLon * c;
      lonMax = lonMin + dLon;
    }
    
    // Apply obfuscation if enabled (using layer-1 shuffle for consistency)
    if (obfuscated && code && typeof GeoCodec !== 'undefined') {
      const shuffled = getShuffledGrid(gridKey, '');
      const flat = shuffled.grid.flat();
      code = GeoCodec.applyObfuscation('encode', code, flat);
    }
    
    // For CJK grids with delimiter, insert delimiter between tokens
    if (code && gridDef && gridDef.delimiter) {
      const shuffled = getShuffledGrid(gridKey, '');
      const flat = shuffled.grid.flat();
      const tokens = GeoCodec.tokenizeCode(code, flat);
      if (tokens && tokens.length > 0) {
        code = tokens.join(gridDef.delimiter);
      }
    }
    
    return code;
  }
  
  function encodeCardCoordinate(gridKey, lat, lon, iterations) {
    return _encodeCardCoordinateInternal(gridKey, lat, lon, iterations);
  }
  
  function decodeCardCoordinate(gridKey, code, iterations) {
    const gridDef = CARD_GRIDS[gridKey];
    if (gridDef && gridDef.chessOf) {
      return decodeCardCoordinate(gridDef.chessOf, code, iterations);
    }
    if (gridDef && gridDef.healpix && typeof HealpixGrids !== 'undefined') {
      const opt = {};
      if (passphrase) { opt.pass = passphrase; opt.shuffleFn = shuffleGridAndOrder; }
      if (obfuscated) { opt.obf = true; }
      return HealpixGrids.decode(gridDef.healpix, code, iterations, opt);
    }
    if (gridDef && gridDef.gis && typeof GISGrids !== 'undefined') {
      return GISGrids.decode(gridDef.gis, code);
    }
    const baseGrid = gridDef?.grid;
    if (!baseGrid || !code) return null;
    
    const rows = baseGrid.length;
    const cols = baseGrid[0].length;
    
    // No passphrase: use original single-shuffle approach (fast path)
    if (!passphrase) {
      const shuffled = getShuffledGrid(gridKey);
      if (!shuffled) return null;
      
      const grid = shuffled.grid;
      let codeToUse = code;
      
      if (obfuscated && typeof GeoCodec !== 'undefined') {
        const flat = grid.flat();
        codeToUse = GeoCodec.applyObfuscation('decode', code, flat);
      }
      
      if (typeof GeoCodec !== 'undefined' && GeoCodec.decodeHierarchical) {
        return GeoCodec.decodeHierarchical(codeToUse, grid, iterations);
      }
      return null;
    }
    
    // Handle obfuscation first if enabled (using layer-1 shuffle)
    let codeToUse = code;
    if (obfuscated && typeof GeoCodec !== 'undefined') {
      const shuffled = getShuffledGrid(gridKey, '');
      const flat = shuffled.grid.flat();
      codeToUse = GeoCodec.applyObfuscation('decode', code, flat);
    }
    
    // Tokenize the code using base grid
    const baseFlat = baseGrid.flat();
    let tokens;
    if (typeof GeoCodec !== 'undefined' && GeoCodec.tokenizeCode) {
      tokens = GeoCodec.tokenizeCode(codeToUse, baseFlat);
    }
    if (!tokens || tokens.length < iterations) {
      return null;
    }
    
    // Position-dependent decode: decode one iteration at a time
    // Each iteration's permutation depends on all previous encoded symbols
    let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
    let chainPrefix = '';
    
    for (let it = 0; it < iterations; it++) {
      // Get shuffled grid for THIS iteration
      const shuffled = getShuffledGrid(gridKey, chainPrefix);
      const grid = shuffled.grid;
      const flat = grid.flat();
      
      // Find the symbol in the shuffled grid
      const symbol = tokens[it];
      const idx = flat.indexOf(symbol);
      if (idx < 0) return null;
      
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      
      // Update bounds
      const dLat = (latMax - latMin) / rows;
      const dLon = (lonMax - lonMin) / cols;
      latMax = latMax - dLat * r;
      latMin = latMax - dLat;
      lonMin = lonMin + dLon * c;
      lonMax = lonMin + dLon;
      
      // Build chain for next iteration using flat index (grid-vocabulary-independent)
      chainPrefix += (chainPrefix ? ',' : '') + String(idx);
    }
    
    // Return center of final cell
    const lat = (latMin + latMax) / 2;
    const lon = (lonMin + lonMax) / 2;
    return [lat, lon];
  }
  
  function decodeCardCode(gridKey, code, deobfuscate) {
    const gridDef = CARD_GRIDS[gridKey];
    if (gridDef && gridDef.chessOf) {
      return decodeCardCode(gridDef.chessOf, code, deobfuscate);
    }
    if (gridDef && gridDef.healpix && typeof HealpixGrids !== 'undefined') {
      const opt = {};
      if (passphrase) { opt.pass = passphrase; opt.shuffleFn = shuffleGridAndOrder; }
      if (obfuscated) { opt.obf = true; }
      // Prefer the card's CURRENT order over inferring from the string: bare
      // hex/base64 codes are order-ambiguous (packing rounds up to whole chars),
      // so the known stepper value is exact where inference might over-read.
      // Fall back to inference only if no order is on record (e.g. pasted code).
      const knownOrder = (cardState.iterations && cardState.iterations[gridKey]) ||
                         gridDef.defaultIterations;
      const order = knownOrder || HealpixGrids.inferOrder(gridDef.healpix, code);
      return HealpixGrids.decode(gridDef.healpix, code, order, opt);
    }
    if (gridDef && gridDef.gis && typeof GISGrids !== 'undefined') {
      return GISGrids.decode(gridDef.gis, code);
    }
    if (!gridDef || !gridDef.grid) return null;
    
    const baseGrid = gridDef.grid;
    const rows = baseGrid.length;
    const cols = baseGrid[0].length;
    
    try {
      // Handle checksum if present (BIP39 codes with .ChecksumWord)
      let workingCode = code;
      let checksumValidation = null;
      let alreadyNormalized = false;
      
      if (gridDef.prefixLength && code.includes('.')) {
        checksumValidation = validateChecksum(code, gridKey);
        workingCode = checksumValidation.code;
        alreadyNormalized = true;  // validateChecksum already normalized
      }
      
      // Get layer-1 shuffled grid for normalization (always use empty chainPrefix for this)
      const shuffled = getShuffledGrid(gridKey, '');
      const grid2D = shuffled.grid;
      const flat = grid2D.flat();
      
      // If grid uses prefix matching and not already normalized, normalize words to canonical forms
      if (!alreadyNormalized) {
        if (gridDef.prefixLength) {
          workingCode = normalizeByPrefix(workingCode, flat, gridDef.prefixLength, gridDef.delimiter);
          if (!workingCode) return null; // Invalid word found
        } else if (gridDef.delimiter) {
          // Non-prefix grid with delimiter: just strip the delimiter
          workingCode = workingCode.split(gridDef.delimiter).join('');
        }
      }
      
      // Handle deobfuscation (always uses layer-1 shuffle)
      if (deobfuscate && typeof GeoCodec !== 'undefined' && GeoCodec.applyObfuscation) {
        workingCode = GeoCodec.applyObfuscation('decode', workingCode, flat);
      }
      
      // If no passphrase, use fast path with GeoCodec
      if (!passphrase) {
        if (typeof GeoCodec !== 'undefined' && GeoCodec.decodeHierarchical) {
          const result = GeoCodec.decodeHierarchical(workingCode, grid2D, 20);
          if (result && checksumValidation) {
            result.checksumValid = checksumValidation.valid;
            result.checksumWord = checksumValidation.checksumWord;
          }
          return result;
        }
        return null;
      }
      
      // Position-dependent decode with passphrase
      // Tokenize the code using base grid symbols
      const baseFlat = baseGrid.flat();
      let tokens;
      if (typeof GeoCodec !== 'undefined' && GeoCodec.tokenizeCode) {
        tokens = GeoCodec.tokenizeCode(workingCode, baseFlat);
      }
      if (!tokens || tokens.length === 0) {
        return null;
      }
      
      // Decode one iteration at a time with position-dependent shuffling
      let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
      let chainPrefix = '';
      
      for (let it = 0; it < tokens.length; it++) {
        // Get shuffled grid for THIS iteration
        const iterShuffled = getShuffledGrid(gridKey, chainPrefix);
        const iterFlat = iterShuffled.grid.flat();
        
        // Find the symbol in the shuffled grid
        const symbol = tokens[it];
        const idx = iterFlat.indexOf(symbol);
        if (idx < 0) return null;
        
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        
        // Update bounds
        const dLat = (latMax - latMin) / rows;
        const dLon = (lonMax - lonMin) / cols;
        latMax = latMax - dLat * r;
        latMin = latMax - dLat;
        lonMin = lonMin + dLon * c;
        lonMax = lonMin + dLon;
        
        // Build chain for next iteration using flat index (grid-vocabulary-independent)
        chainPrefix += (chainPrefix ? ',' : '') + String(idx);
      }
      
      // Return center of final cell as array with optional checksum info
      const lat = (latMin + latMax) / 2;
      const lon = (lonMin + lonMax) / 2;
      const result = [lat, lon];
      
      if (checksumValidation) {
        result.checksumValid = checksumValidation.valid;
        result.checksumWord = checksumValidation.checksumWord;
      }
      return result;
    } catch (e) {
      console.error('[CardRenderer] Decode error:', e);
    }
    return null;
  }
  
  /**
   * Normalize accented characters to their base form for prefix matching.
   * E.g., "ábaco" → "abaco", "éléphant" → "elephant"
   */
  function normalizeAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  
  /**
   * Normalize words in a code to their canonical forms using prefix matching.
   * E.g., "abando" → "abandon" (matches on first 4 chars)
   * 
   * INPUT TOLERANCE: Handles various input formats:
   * - "sand-gas-cash-number" (hyphen-delimited)
   * - "sand gas cash number" (space-separated)
   * - "sandgascashnumber" (concatenated)
   * - "ひろい・つけね・せめる" (middle-dot delimited Japanese)
   * - "出就分對" (concatenated Chinese)
   * 
   * @param {string} code - Input code (various formats accepted)
   * @param {string[]} flat - Flat array of canonical words
   * @param {number} prefixLen - Number of prefix characters that are unique
   * @param {string} [delimiter] - The grid's canonical delimiter (for reference)
   * @returns {string|null} - Normalized code (concatenated for codec), or null if invalid
   */
  function normalizeByPrefix(code, flat, prefixLen, delimiter) {
    // Build prefix lookup (lazy, could cache)
    const prefixMap = new Map();
    for (const word of flat) {
      // Normalize accents for prefix matching (Spanish, French)
      const prefix = normalizeAccents(word.slice(0, prefixLen).toLowerCase());
      if (!prefixMap.has(prefix)) {
        prefixMap.set(prefix, word);
      }
    }
    
    let words;
    
    // STEP 1: Try to split input into words using various delimiters
    // Try common delimiters: hyphen, space, middle dot, ideographic space, Chinese punctuation
    // Also handle ASCII fallbacks for Chinese (comma and period)
    if (code.includes('-')) {
      words = code.split('-').filter(w => w.length > 0);
    } else if (code.includes('、')) {  // Chinese dùnhào comma (primary Chinese delimiter)
      words = code.split('，').filter(w => w.length > 0);
    } else if (code.includes('，')) {  // Chinese fullwidth comma (primary Chinese delimiter)
      words = code.split('，').filter(w => w.length > 0);
    } else if (code.includes(',') && !code.match(/^\d+\.\d+,\d+\.\d+/)) {  // ASCII comma fallback (but not coordinates)
      words = code.split(',').filter(w => w.length > 0);
    } else if (code.includes(' ')) {
      words = code.split(/\s+/).filter(w => w.length > 0);
    } else if (code.includes('\u30FB')) {  // Middle dot ・ (Japanese)
      words = code.split('\u30FB').filter(w => w.length > 0);
    } else if (code.includes('\u3000')) {  // Ideographic space
      words = code.split('\u3000').filter(w => w.length > 0);
    } else if (delimiter && delimiter !== '' && code.includes(delimiter)) {
      words = code.split(delimiter).filter(w => w.length > 0);
    } else {
      // No delimiter found - try codec tokenization for concatenated input
      if (typeof GeoCodec !== 'undefined') {
        words = GeoCodec.tokenizeCode(code, flat);
      }
    }
    
    if (!words || words.length === 0) return null;
    
    // STEP 2: Normalize each word to canonical form via prefix matching
    const normalized = [];
    for (const word of words) {
      // Normalize accents and case for matching
      const prefix = normalizeAccents(word.slice(0, prefixLen).toLowerCase());
      const canonical = prefixMap.get(prefix);
      if (!canonical) {
        console.warn(`[CardRenderer] Unknown word prefix: "${word}" (prefix: "${prefix}")`);
        return null;
      }
      normalized.push(canonical);
    }
    
    // STEP 3: Return concatenated (no delimiters) for codec
    return normalized.join('');
  }

  // ============== HELPERS ==============
  
  /**
   * Open coordinates in the device's native maps application
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude  
   * @param {string} label - Optional label for the pin
   */
  function openInMaps(lat, lon, label = 'Decoded Location') {
    const encodedLabel = encodeURIComponent(label);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isMac = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 0; // iPad in desktop mode
    
    if (isIOS || isMac) {
      // Apple Maps - use maps: protocol
      window.location.href = `maps://maps.apple.com/?q=${encodedLabel}&ll=${lat},${lon}`;
    } else {
      // Google Maps - works on Android and as web fallback
      window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`, '_blank');
    }
  }
  
  function showToast(msg, style = 'default') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    
    // Apply style-specific colors
    if (style === 'success') {
      t.style.background = '#4CAF50';
    } else if (style === 'error') {
      t.style.background = '#f44336';
    }
    
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2000);
  }
  
  function formatMetric(m) {
    if (!isFinite(m) || m <= 0) return '0';
    if (m >= 1000) return (m/1000).toFixed(1) + ' km';
    if (m >= 1) return m.toFixed(1) + ' m';
    if (m >= 1e-2) return (m*1e2).toFixed(1) + ' cm';
    if (m >= 1e-3) return (m*1e3).toFixed(1) + ' mm';
    if (m >= 1e-6) return (m*1e6).toFixed(1) + ' µm';
    if (m >= 1e-9) return (m*1e9).toFixed(1) + ' nm';
    if (m >= 1e-12) return (m*1e12).toFixed(1) + ' pm';
    if (m >= 1e-15) return (m*1e15).toFixed(1) + ' fm';
    if (m >= 1e-18) return (m*1e18).toFixed(1) + ' am';
    return m.toExponential(1) + ' m';
  }
  
  // Build the "Measurement uncertainty" line for the ℹ️ box from the source-of-
  // truth exact point's provenance. Returns null if no exact point / no module,
  // so callers simply omit the line. Scheme-independent (a property of how the
  // location was captured, not how it's displayed).
  function buildUncertaintyLine() {
    try {
      const getEx = (typeof GeosonifyMain !== 'undefined' && GeosonifyMain.getExact)
        ? GeosonifyMain.getExact
        : (typeof geosonify !== 'undefined' && geosonify.getExact ? geosonify.getExact : null);
      if (!getEx) {
        console.warn('[provenance] ℹ️ open: GeosonifyMain.getExact not available — uncertainty line skipped.');
        return null;
      }
      const pt = getEx();
      if (!pt || typeof pt.uncertaintyText !== 'function') {
        console.warn('[provenance] ℹ️ open: no exact point stored yet (drop a pin / get GPS first).');
        return null;
      }
      const txt = pt.uncertaintyText();
      console.log('%c[provenance]%c ℹ️ uncertainty line:', 'color:#ffd54f;font-weight:bold', 'color:inherit', txt);
      return txt ? ('Measurement uncertainty: ' + txt) : null;
    } catch (e) {
      console.warn('[provenance] buildUncertaintyLine error:', e && e.message);
      return null;
    }
  }

  function getPrecisionText(gridKey, iterations) {
    const gd = CARD_GRIDS[gridKey];
    // Chess cards are a presentation of a sibling code: their resolution is the sibling's.
    if (gd && gd.chessOf) {
      return getPrecisionText(gd.chessOf, iterations);
    }
    if (gd && gd.healpix && typeof HealpixGrids !== 'undefined') {
      return HealpixGrids.precisionText(gd.healpix, iterations, currentCardCoord);
    }
    if (gd && gd.gis && typeof GISGrids !== 'undefined') {
      return GISGrids.precisionText(gd.gis, iterations, currentCardCoord);
    }
    const grid = CARD_GRIDS[gridKey]?.grid;
    if (!grid) return '';
    const rows = grid.length, cols = grid[0].length;
    const lat = currentCardCoord ? currentCardCoord.lat : 0;
    const metersPerDegLat = 111319.9;
    const metersPerDegLon = 111319.9 * Math.cos(lat * Math.PI / 180);
    // Cell size = (degrees span / base^iterations) × metres-per-degree. At deep
    // iterations base^iterations overflows a double, so compute in log-space and
    // exponentiate — finite and accurate to fm and far below. The address itself
    // is exact (BigInt codec); this is just the on-screen measurement.
    const latM = Math.exp(Math.log(180 * metersPerDegLat) - iterations * Math.log(rows));
    const lonM = Math.exp(Math.log(360 * metersPerDegLon) - iterations * Math.log(cols));

    return `${formatMetric(latM)} × ${formatMetric(lonM)}`;
  }
  
  function getActiveEncoding(lat, lon) {
    if (rawModeActive) {
      return `${lat.toFixed(6)},${lon.toFixed(6)}`;
    }
    
    const gridKey = cardState.active;
    if (!gridKey || !CARD_GRIDS[gridKey]) {
      return `${lat.toFixed(6)},${lon.toFixed(6)}`;
    }
    
    const gridDef = CARD_GRIDS[gridKey];
    // GIS reference cards can't be privacy-transformed → redact under any privacy mode.
    // HEALPix now PERMUTES (passphrase) and OBFUSCATES (index-shift) properly, so it
    // never redacts — it emits a real transformed code that decodes back with the key.
    if (gridDef.gis && (passphrase || obfuscated)) {
      return '████████';
    }
    const isBarcodeCard = (gridDef.display === 'qrhex' || gridDef.display === 'qrbin' || gridDef.display === 'qrurl' || gridDef.display === 'datamatrix');
    const iterations = isBarcodeCard ? getBarcodeIterations(gridKey)
      : (gridDef.fixedIterations !== undefined ? gridDef.fixedIterations 
        : (cardState.iterations[gridKey] || gridDef.defaultIterations));
    let code = encodeCardCoordinate(gridKey, lat, lon, iterations);
    
    // Add numeric checksum for BIP39 grids (always shown; tick button controls speaker readout only)
    if (CARD_GRIDS[gridKey]?.prefixLength && code) {
      // Strip delimiter for checksum calculation
      const gridDef = CARD_GRIDS[gridKey];
      const codeForChecksum = gridDef?.delimiter ? code.split(gridDef.delimiter).join('') : code;
      const checksumNum = computeChecksumNumeric(codeForChecksum, gridKey);
      // Use checksumDelimiter if defined (Chinese uses 。), otherwise use ASCII period
      const checksumSep = gridDef?.checksumDelimiter || '.';
      code = `${code}${checksumSep}${checksumNum}`;
    }
    
    return code;
  }
  
  function isActiveCardEmoji() {
    if (rawModeActive) return false;
    return CARD_GRIDS[cardState.active]?.isEmoji || false;
  }

  // ============== TEXT BALANCING ==============
  
  function parseEmoji(str) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
      return Array.from(segmenter.segment(str), s => s.segment);
    }
    return [...str];
  }
  
  function splitIntoBalancedLines(items, maxPerLine) {
    const total = items.length;
    if (total <= maxPerLine) return [items];
    
    const numLines = Math.ceil(total / maxPerLine);
    const lines = [];
    let index = 0;
    
    for (let line = 0; line < numLines && index < total; line++) {
      const remaining = total - index;
      const linesLeft = numLines - line;
      const lineLength = Math.ceil(remaining / linesLeft);
      lines.push(items.slice(index, index + lineLength));
      index += lineLength;
    }
    return lines;
  }
  
  /**
   * Format a code for display with checksum.
   * Code has delimiters (hyphens, middle dots, Chinese commas, etc.)
   * If wrapping needed, break at middle delimiter for symmetry.
   * @param {string} code - The code with delimiters
   * @param {string} gridKey - Grid key
   * @param {string} checksumValue - The checksum (numeric)
   * @returns {string} HTML string
   */
  function formatCodeForDisplay(code, gridKey, checksumValue) {
    const gridDef = CARD_GRIDS[gridKey];
    const delimiter = gridDef?.delimiter;
    const checksumSep = gridDef?.checksumDelimiter || '.';
    
    // For grids with no delimiter, just display as-is with checksum
    if (delimiter === '' || delimiter === undefined || delimiter === null) {
      if (checksumValue) {
        return `${code}<span style="font-size:0.85em;opacity:0.5">${checksumSep}${checksumValue}</span>`;
      }
      return code;
    }
    
    // Split into segments
    const segments = code.split(delimiter);
    
    // If short enough, just display on one line
    const fullText = checksumValue ? `${code}${checksumSep}${checksumValue}` : code;
    if (fullText.length <= 28) {
      if (checksumValue) {
        return `${code}<span style="font-size:0.85em;opacity:0.5">${checksumSep}${checksumValue}</span>`;
      }
      return code;
    }
    
    // Need to wrap - find middle break point for symmetry
    // Include checksum as part of second half
    const midPoint = Math.ceil(segments.length / 2);
    const firstHalf = segments.slice(0, midPoint);
    const secondHalf = segments.slice(midPoint);
    
    // Build first line with trailing delimiter
    const firstLine = firstHalf.join(delimiter) + delimiter;
    
    // Build second line
    let secondLine = secondHalf.join(delimiter);
    if (checksumValue) {
      secondLine += `<span style="font-size:0.85em;opacity:0.5">${checksumSep}${checksumValue}</span>`;
    }
    
    return `${firstLine}<br>${secondLine}`;
  }
  
  function renderBalancedCode(container, code, gridKey) {
    const gridDef = CARD_GRIDS[gridKey];
    const isEmoji = gridDef?.display === 'emoji';
    const isMusic = gridDef?.display === 'music';
    // PascalCase word-based grids (BIP39 grids have prefixLength)
    const isWordBased = gridDef?.prefixLength || gridKey === 'nato' || gridKey === 'bytewords';
    const delimiter = gridDef?.delimiter;
    
    // Check if checksum should be displayed
    const supportsChecksum = gridDef?.prefixLength;
    const checksumOn = supportsChecksum;
    let checksumValue = null;
    if (checksumOn && code) {
      // Strip delimiter for checksum calculation
      const codeForChecksum = delimiter ? code.split(delimiter).join('') : code;
      checksumValue = computeChecksumNumeric(codeForChecksum, gridKey);
    }
    
    if (isEmoji) {
      const emojis = parseEmoji(code);
      let maxPerLine;
      if (emojis.length <= 3) maxPerLine = emojis.length;
      else if (emojis.length <= 6) maxPerLine = 3;
      else if (emojis.length <= 9) maxPerLine = 4;
      else maxPerLine = 5;
      
      const lines = splitIntoBalancedLines(emojis, maxPerLine);
      const widest = Math.max(...lines.map(l => l.length));
      const fontSize = Math.min(18, 85 / widest);
      
      container.style.fontSize = fontSize + 'vw';
      container.style.lineHeight = '1.2';
      container.style.textAlign = 'center';
      container.innerHTML = lines.map(line => `<div>${line.join('')}</div>`).join('');
      
    } else if (isMusic) {
      const notes = code.split(',').filter(n => n.trim());
      let notesPerLine;
      if (notes.length <= 3) notesPerLine = notes.length;
      else if (notes.length <= 6) notesPerLine = 3;
      else notesPerLine = 4;
      
      const lines = splitIntoBalancedLines(notes, notesPerLine);
      const lineStrings = lines.map(line => line.join(','));
      const maxLen = Math.max(...lineStrings.map(l => l.length));
      const fontSize = Math.min(10, 50 / Math.max(1, maxLen / 8));
      
      container.style.fontSize = fontSize + 'vw';
      container.style.lineHeight = '1.3';
      container.style.textAlign = 'center';
      container.innerHTML = lineStrings.map(line => `<div>${line}</div>`).join('');
      
    } else if (isWordBased) {
      // Split into words using delimiter or tokenization
      let words;
      if (delimiter) {
        // Has delimiter (hyphen, middle dot, Chinese comma)
        words = code.split(delimiter).filter(w => w.length > 0);
      } else if (typeof GeoCodec !== 'undefined') {
        // No delimiter - use tokenization with shuffled grid
        const shuffled = getShuffledGrid(gridKey);
        if (shuffled && shuffled.grid) {
          const flat = shuffled.grid.flat();
          words = GeoCodec.tokenizeCode(code, flat);
        }
        if (!words || words.length === 0) {
          words = [code];
        }
      } else {
        words = [code];
      }
      
      // Check orientation - portrait means each word on its own line
      const isPortrait = window.innerHeight > window.innerWidth;
      
      // Determine checksum separator for display
      const checksumSep = gridDef?.checksumDelimiter || '.';
      
      // Check if this is a CJK script (Japanese, Korean, Chinese)
      const isCJK = gridKey.startsWith('bip39japanese') || 
                    gridKey.startsWith('bip39korean') || 
                    gridKey.startsWith('bip39chinese');
      
      if (isPortrait && words.length > 1) {
        // Portrait: each word on its own line
        const fontSize = Math.min(12, 80 / Math.max(1, Math.max(...words.map(w => w.length))));
        
        container.style.fontSize = fontSize + 'vw';
        container.style.lineHeight = '1.4';
        container.style.textAlign = 'center';
        
        let html = words.map(w => `<div>${w}</div>`).join('');
        
        // Add checksum on its own line, smaller and grey
        if (checksumValue) {
          html += `<div style="font-size:0.7em;opacity:0.5;margin-top:0.3em">${checksumValue}</div>`;
        }
        
        container.innerHTML = html;
      } else {
        // Landscape mode
        const displayDelim = delimiter || '';
        const displayCode = words.join(displayDelim);
        const fullCode = checksumValue ? `${displayCode}${checksumSep}${checksumValue}` : displayCode;
        
        // For CJK scripts, check if we need to break into multiple lines
        // Break at delimiter positions if code is too long
        const maxCharsPerLine = isCJK ? 12 : 30;  // CJK characters are wider
        
        if (isCJK && displayCode.length > maxCharsPerLine && words.length > 1) {
          // Find middle break point for balanced lines
          const midPoint = Math.ceil(words.length / 2);
          const firstHalf = words.slice(0, midPoint);
          const secondHalf = words.slice(midPoint);
          
          const firstLine = firstHalf.join(displayDelim) + (displayDelim || '');
          let secondLine = secondHalf.join(displayDelim);
          
          const maxLen = Math.max(firstLine.length, secondLine.length + (checksumValue ? checksumValue.length + 1 : 0));
          const fontSize = Math.min(10, 70 / Math.max(1, maxLen / 6));
          
          container.style.fontSize = fontSize + 'vw';
          container.style.lineHeight = '1.4';
          container.style.textAlign = 'center';
          
          let html = `<div>${firstLine}</div><div>${secondLine}`;
          if (checksumValue) {
            html += `<span style="font-size:0.85em;opacity:0.5">${checksumSep}${checksumValue}</span>`;
          }
          html += '</div>';
          
          container.innerHTML = html;
        } else {
          // Single line
          const fontSize = Math.min(10, 70 / Math.max(1, fullCode.length / 10));
          
          container.style.fontSize = fontSize + 'vw';
          container.style.lineHeight = '1.3';
          container.style.textAlign = 'center';
          
          let html = displayCode;
          if (checksumValue) {
            html += `<span style="font-size:0.85em;opacity:0.5">${checksumSep}${checksumValue}</span>`;
          }
          
          container.innerHTML = html;
        }
      }
      
    } else {
      let fontSize, charsPerLine;
      if (code.length > 60) { fontSize = 5; charsPerLine = 12; }
      else if (code.length > 40) { fontSize = 7; charsPerLine = 10; }
      else if (code.length > 25) { fontSize = 9; charsPerLine = 8; }
      else { fontSize = Math.min(14, 80 / Math.max(1, code.length / 12)); charsPerLine = 20; }
      
      if (code.length <= charsPerLine) {
        container.style.fontSize = fontSize + 'vw';
        container.textContent = code;
      } else {
        const numLines = Math.ceil(code.length / charsPerLine);
        const perLine = Math.ceil(code.length / numLines);
        const lines = [];
        for (let i = 0; i < code.length; i += perLine) {
          lines.push(code.slice(i, i + perLine));
        }
        container.style.fontSize = fontSize + 'vw';
        container.style.lineHeight = '1.3';
        container.style.textAlign = 'center';
        container.innerHTML = lines.map(line => `<div>${line}</div>`).join('');
      }
    }
  }
  
  function balanceCodeForCell(code, gridKey, maxCharsPerLine) {
    if (!code) return '';
    const gridDef = CARD_GRIDS[gridKey];
    const isEmoji = gridDef?.display === 'emoji';
    const isMusic = gridDef?.display === 'music';
    // PascalCase word-based grids (BIP39 grids have prefixLength)
    const isWordBased = gridDef?.prefixLength || gridKey === 'nato' || gridKey === 'bytewords';
    const delimiter = gridDef?.delimiter;
    
    if (isEmoji) {
      const emojis = parseEmoji(code);
      if (emojis.length <= 3) return code;
      const lines = splitIntoBalancedLines(emojis, Math.min(maxCharsPerLine, 3));
      return lines.map(line => line.join('')).join('\n');
    } else if (isMusic) {
      const notes = code.split(',').filter(n => n.trim());
      if (notes.length <= 2) return notes.join(',');
      const lines = splitIntoBalancedLines(notes, 3);
      return lines.map(line => line.join(',')).join('\n');
    } else if (isWordBased) {
      // Code already has delimiters - just return as-is
      return code;
    } else {
      if (code.length <= maxCharsPerLine) return code;
      const numLines = Math.ceil(code.length / maxCharsPerLine);
      const perLine = Math.ceil(code.length / numLines);
      const lines = [];
      for (let i = 0; i < code.length; i += perLine) {
        lines.push(code.slice(i, i + perLine));
      }
      return lines.join('\n');
    }
  }

  // ============== SPECIAL RENDERERS ==============
  
  function renderChromaCoord(hexCode, container) {
    if (!container) return;
    container.innerHTML = '';
    if (typeof RGB111Lib !== 'undefined' && RGB111Lib.generateCanvas) {
      const canvas = RGB111Lib.generateCanvas(hexCode, { size: 120, borderWidth: 0.5, notchSize: 0.5 });
      canvas.className = 'chroma-canvas';
      container.appendChild(canvas);
    }
  }

  // ============== BARCODE RENDERERS ==============

  /**
   * Get QR-URL iteration count from BarcodeLib, with fallback
   */
  function getQRUrlIterations() {
    if (typeof BarcodeLib !== 'undefined' && BarcodeLib.getQRUrlIterations) {
      return BarcodeLib.getQRUrlIterations();
    }
    // Fallback: calculate locally
    const loc = window.location;
    const baseUrl = (loc.origin === 'null' || !loc.origin)
      ? loc.href.split('?')[0] + '?'
      : loc.origin + loc.pathname + '?';
    const worstPrefix = baseUrl + 'oh=';
    const caps = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271];
    for (let v = 1; v <= 10; v++) {
      const spare = caps[v] - worstPrefix.length;
      const iters = Math.floor(spare / 2);
      if (iters >= 6) return iters;
    }
    return 6;
  }

  /**
   * Get iterations for a barcode card (handles dynamic qrurl)
   */
  // HEALPix Matrix payload helper. hphex left-pads when packing, so ODD orders
  // produce the same character count as the next even order — the bare code is
  // length-ambiguous. Append "@k" (which HealpixGrids.decode/inferOrder strip
  // natively) ONLY when the bare code's inferred order disagrees with the true
  // order, i.e. for odd orders. Even orders are self-describing and stay clean,
  // so the common case shows no suffix; the suffix appears only when a user
  // deliberately addresses an exact cell at an odd order.
  function withHealpixBarcodeOrder(gridKey, code) {
    const gd = CARD_GRIDS[gridKey];
    if (!gd || !gd.healpix || typeof HealpixGrids === 'undefined') return code;
    if (typeof code !== 'string' || !code || code.indexOf('@') !== -1) return code;
    const k = cardState.iterations[gridKey] || gd.defaultIterations;
    if (!k) return code;
    try {
      if (HealpixGrids.inferOrder(gd.healpix, code) === k) return code; // even: clean
    } catch (e) { /* fall through to suffixed form */ }
    return code + '@' + k;
  }

  function getBarcodeIterations(gridKey) {
    const gridDef = CARD_GRIDS[gridKey];
    if (!gridDef) return 6;
    if (gridDef.dynamicIterations) {
      // QR-URL: max is computed from URL length, user can reduce with ±
      const dynMax = getQRUrlIterations();
      const userIter = cardState.iterations[gridKey];
      const min = gridDef.minIterations || 3;
      if (userIter !== undefined && userIter < dynMax) {
        return Math.max(min, userIter);
      }
      return dynMax;
    }
    return gridDef.fixedIterations || cardState.iterations[gridKey] || gridDef.defaultIterations || 6;
  }

  /**
   * Render a QR code barcode into a container element
   * @param {string} content - Text to encode (hex for qrhex, URL for qrurl)
   * @param {HTMLElement} container
   * @param {string} gridKey - 'qrhex' or 'qrurl'
   */
  async function renderBarcodeQR(content, container, gridKey) {
    if (!container) return;
    container.innerHTML = '';

    if (typeof BarcodeLib === 'undefined') {
      container.innerHTML = '<div style="color:#888;font-size:11px;padding:20px;">BarcodeLib not loaded</div>';
      return;
    }

    // Ensure QR generator is loaded
    try {
      await BarcodeLib.ensureQRGenLoaded();
    } catch (e) {
      container.innerHTML = '<div style="color:#888;font-size:11px;padding:20px;">QR lib loading...</div>';
      return;
    }

    const canvas = BarcodeLib.generateQRCanvas(content, { size: 160, eccLevel: 'L' });
    canvas.className = 'barcode-canvas';
    canvas.style.cssText = 'display:block;border-radius:4px;';
    container.appendChild(canvas);
  }

  /**
   * Render a Data Matrix barcode into a container element
   * @param {string} hex - 16 hex characters
   * @param {HTMLElement} container
   */
  async function renderBarcodeDataMatrix(hex, container) {
    if (!container) return;
    container.innerHTML = '';

    if (typeof BarcodeLib === 'undefined') {
      container.innerHTML = '<div style="color:#888;font-size:11px;padding:20px;">BarcodeLib not loaded</div>';
      return;
    }

    // Try to load bwip-js for ISO-compliant DM (commercial scanner readable)
    try { await BarcodeLib.ensureBwipLoaded(); } catch(e) { /* native fallback */ }

    const canvas = BarcodeLib.generateDataMatrixCanvas(hex, { size: 160 });
    canvas.className = 'barcode-canvas';
    canvas.style.cssText = 'display:block;border-radius:4px;';
    container.appendChild(canvas);
  }

  /**
   * Render a QR Binary barcode — packs hex as raw bytes for smaller QR codes.
   * 12 hex chars = 6 raw bytes (fits QR V1-L which holds 17 bytes).
   * Compare: QR Hex sends "BFDAEC83DA32" as 12 ASCII chars = 12 bytes.
   * @param {string} hex - Hex string (variable length)
   * @param {HTMLElement} container
   */
  async function renderBarcodeQRBinary(hex, container) {
    if (!container) return;
    container.innerHTML = '';

    if (typeof BarcodeLib === 'undefined') {
      container.innerHTML = '<div style="color:#888;font-size:11px;padding:20px;">BarcodeLib not loaded</div>';
      return;
    }

    try {
      await BarcodeLib.ensureQRGenLoaded();
    } catch (e) {
      container.innerHTML = '<div style="color:#888;font-size:11px;padding:20px;">QR lib loading...</div>';
      return;
    }

    // Convert hex string to raw binary string (each pair of hex chars → one byte)
    const canvas = BarcodeLib.generateQRBinaryCanvas(hex, { size: 160, eccLevel: 'L' });
    canvas.className = 'barcode-canvas';
    canvas.style.cssText = 'display:block;border-radius:4px;';
    container.appendChild(canvas);
  }

  /**
   * Shared handler for barcode scan results
   * Extracts hex, validates length, decodes coordinate, sets map position
   */
  function decodeBarcodeResult(rawText, gridKey) {
    let hex = rawText;

    // For QR-URL, extract hex from URL
    if (gridKey === 'qrurl') {
      if (typeof BarcodeLib !== 'undefined') {
        const parsed = BarcodeLib.parseGeosonifyURL(rawText);
        if (!parsed) { showToast('Not a Geosonify URL'); return; }
        hex = parsed.hex;
        // Note: parsed.obfuscated could be used to auto-toggle, but we rely on current state
      } else {
        showToast('BarcodeLib not loaded'); return;
      }
    }

    // For QR Binary, the scanned result is raw bytes — convert back to hex
    if (gridKey === 'qrbin') {
      if (typeof BarcodeLib !== 'undefined' && BarcodeLib.rawBytesToHex) {
        hex = BarcodeLib.rawBytesToHex(rawText);
      } else {
        // Fallback: try to interpret as already-hex
        hex = rawText;
      }
    }

    const gridDefEarly = CARD_GRIDS[gridKey];

    // ── HEALPix Matrix (hpmatrix) ─────────────────────────────
    // The scanned symbol carries a plain hphex string (face nibble 0–B + hex
    // levels). It is NOT the byte model below: hphex codes are legitimately
    // odd-length (odd orders), and order ≠ length/2 — it's recovered by
    // HealpixGrids.inferOrder. So we skip the even-nibble drop and the ÷2
    // mapping entirely and decode the raw code at its own precision, with the
    // active passphrase + obfuscation (decodeCardCoordinate handles those via
    // the card's `healpix` flag). A scanned symbol is treated as HEALPix purely
    // because THIS card's scanner produced it; the symbol itself is unmarked.
    if (gridDefEarly && gridDefEarly.healpix && typeof HealpixGrids !== 'undefined') {
      // hphex alphabet is 0-9 A-B (case-free). Preserve an optional "@k" order
      // suffix: even-order codes are self-describing and carry none, but ODD
      // orders are length-ambiguous and carry "@k" so an EXACT cell at any order
      // round-trips. Keep [0-9A-F] plus a trailing "@<digits>"; strip the rest
      // (scanner noise / quiet-zone artefacts).
      const raw = String(rawText).toUpperCase();
      const m = raw.match(/^[^0-9A-F]*([0-9A-F]+(?:@\d{1,3})?)/);
      let code = m ? m[1] : raw.replace(/[^0-9A-F@]/g, '');
      if (!code) { showToast('No HEALPix code found in symbol'); return; }
      let order;
      try { order = HealpixGrids.inferOrder(gridDefEarly.healpix, code); }
      catch (e) { order = null; }
      if (!order || order < 1) { showToast('Code too short to decode'); return; }
      const maxK = gridDefEarly.maxIterations || 73;
      if (order > maxK) order = maxK;
      const result = decodeCardCoordinate(gridKey, code, order);
      if (result) {
        setCoordinate(result[0], result[1]);
        const map = callbacks.getMap ? callbacks.getMap() : null;
        if (map) map.setView(result, 16, { animate: true });
        const prec = getPrecisionText(gridKey, order);
        showToast(prec ? `✓ Decoded — ${prec}` : '✓ Decoded', 'success');
        // banner shows the clean code without the @k machinery
        showDecodeBanner(gridKey, code.replace(/@\d+$/, ''), result[0], result[1]);
      } else {
        showToast('Invalid code (wrong passphrase?)');
      }
      return;
    }

    // Normalize
    hex = hex.toUpperCase().replace(/[^0-9A-F]/g, '');
    // Drop a dangling nibble — each cell is exactly 2 hex chars
    if (hex.length % 2 !== 0) hex = hex.slice(0, -1);

    const gridDef = CARD_GRIDS[gridKey];

    // The scanned code is self-describing: its length IS its precision.
    // Decode at the code's own precision rather than forcing the card's
    // current iteration setting. The card setting governs what the user
    // GENERATES; a one-off scan shouldn't override it (and isn't changed here).
    const minIter = gridDef.minIterations || 3;
    const maxIter = gridDef.dynamicIterations
      ? getQRUrlIterations()
      : (gridDef.maxIterations || 12);

    let scannedIterations = hex.length / 2;

    if (scannedIterations < minIter) {
      showToast(`Code too short to decode (${hex.length} hex chars)`);
      return;
    }
    // Clamp to the grid's supported precision (beyond this the coordinate
    // math loses meaning); the reported precision reflects the clamped value.
    if (scannedIterations > maxIter) {
      scannedIterations = maxIter;
      hex = hex.slice(0, maxIter * 2);
    }

    // Decode using existing pipeline (handles passphrase + obfuscation)
    const result = decodeCardCoordinate(gridKey, hex, scannedIterations);
    if (result) {
      setCoordinate(result[0], result[1]);
      const map = callbacks.getMap ? callbacks.getMap() : null;
      if (map) map.setView(result, 16, { animate: true });
      // Name the resolved precision in human units — the whole point of the
      // scan is "where does this point", so say how precisely we landed.
      const prec = getPrecisionText(gridKey, scannedIterations);
      showToast(prec ? `✓ Decoded — ${prec}` : '✓ Decoded', 'success');
      showDecodeBanner(gridKey, hex, result[0], result[1]);
    } else {
      showToast('Invalid code (wrong passphrase?)');
    }
  }

  /**
   * Show barcode scan modal (camera or photo upload)
   * @param {string} mode - 'camera' or 'upload'
   * @param {string} gridKey - 'qrhex', 'qrurl', or 'datamatrix'
   */
  function showBarcodeScanModal(mode, gridKey) {
    console.log('[CardRenderer] showBarcodeScanModal called:', mode, gridKey);
    const isDataMatrix = (gridKey === 'datamatrix' || gridKey === 'hpmatrix');
    const cardName = CARD_GRIDS[gridKey]?.name || gridKey;
    
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:2000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;';

    if (mode === 'camera') {
      modal.innerHTML = `
        <div style="color:white;text-align:center;margin-bottom:16px;">Point camera at ${cardName}</div>
        <video id="bcScanVideo" autoplay playsinline style="max-width:90vw;max-height:60vh;border-radius:12px;"></video>
        <canvas id="bcScanCanvas" style="display:none;"></canvas>
        <div id="bcScanStatus" style="color:#aaa;margin-top:12px;font-size:14px;">Initializing camera...</div>
        <button id="bcCloseScanBtn" style="margin-top:20px;padding:12px 24px;border-radius:10px;border:none;background:#333;color:white;font-size:16px;">Cancel</button>
      `;
      document.body.appendChild(modal);

      const video = modal.querySelector('#bcScanVideo');
      const canvas = modal.querySelector('#bcScanCanvas');
      const status = modal.querySelector('#bcScanStatus');
      let stream = null;
      let scanning = true;

      // Load decoder libs
      const loadPromise = (typeof BarcodeLib !== 'undefined')
        ? (isDataMatrix 
            ? BarcodeLib.ensureZxingLoaded()
            : BarcodeLib.ensureJsQRLoaded())
        : Promise.reject('No BarcodeLib');

      Promise.all([
        loadPromise,
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      ]).then(([_, s]) => {
        stream = s;
        video.srcObject = stream;
        if (isDataMatrix && typeof ZXingBrowser === 'undefined') {
          status.textContent = 'DM decoder failed to load — check connection';
          status.style.color = '#f44';
        } else {
          status.textContent = isDataMatrix
            ? 'Point at Data Matrix — will lock on when decoded'
            : 'Scanning...';
        }
        scanLoop();
      }).catch(err => {
        console.error('[CardRenderer] Scan modal error:', err);
        status.textContent = isDataMatrix
          ? 'DM decoder library failed to load'
          : 'Error: ' + (err.message || err);
        status.style.color = '#f44';
      });

      var scanBusy = false; // prevent async scan stacking
      
      async function scanLoop() {
        if (!scanning) return;
        if (video.videoWidth === 0) {
          requestAnimationFrame(scanLoop);
          return;
        }
        
        // Don't start a new decode if the previous async one is still running
        if (scanBusy) {
          requestAnimationFrame(scanLoop);
          return;
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        let decoded = null;
        if (typeof BarcodeLib !== 'undefined') {
          if (isDataMatrix) {
            // Use STRICT zxing-js decoder for DM camera scanning
            // Only returns a result when zxing genuinely finds a valid DM with correct ECC
            scanBusy = true;
            try {
              const dmResult = await BarcodeLib.decodeDataMatrixStrict(imageData);
              if (dmResult && dmResult.hex) {
                decoded = dmResult.hex;
              }
            } catch (e) {
              // decode error — keep scanning
            }
            scanBusy = false;
          }
          // Try QR decode (jsQR, synchronous — for qrhex/qrurl)
          if (!decoded && !isDataMatrix) {
            const qrResult = BarcodeLib.decodeQRFromImageData(imageData);
            if (qrResult) decoded = qrResult.text;
          }
        }

        if (decoded) {
          scanning = false;
          if (stream) stream.getTracks().forEach(t => t.stop());
          modal.remove();
          decodeBarcodeResult(decoded, gridKey);
          return;
        }

        if (scanning) requestAnimationFrame(scanLoop);
      }

      modal.querySelector('#bcCloseScanBtn').onclick = () => {
        scanning = false;
        if (stream) stream.getTracks().forEach(t => t.stop());
        modal.remove();
      };

    } else {
      // Photo upload mode
      modal.innerHTML = `
        <div style="color:white;text-align:center;margin-bottom:16px;">Select ${cardName} image</div>
        <input type="file" id="bcFileInput" accept="image/*" style="display:none;">
        <button id="bcSelectFileBtn" style="padding:16px 32px;border-radius:10px;border:none;background:#007AFF;color:white;font-size:16px;cursor:pointer;">Choose Image</button>
        <canvas id="bcUploadCanvas" style="display:none;"></canvas>
        <div id="bcUploadStatus" style="color:#aaa;margin-top:12px;font-size:14px;"></div>
        <button id="bcCloseUploadBtn" style="margin-top:20px;padding:12px 24px;border-radius:10px;border:none;background:#333;color:white;font-size:16px;">Cancel</button>
      `;
      document.body.appendChild(modal);

      const fileInput = modal.querySelector('#bcFileInput');
      const canvas = modal.querySelector('#bcUploadCanvas');
      const status = modal.querySelector('#bcUploadStatus');

      modal.querySelector('#bcSelectFileBtn').onclick = () => fileInput.click();
      modal.querySelector('#bcCloseUploadBtn').onclick = () => modal.remove();

      fileInput.onchange = async () => {
        const file = fileInput.files[0];
        if (!file) return;

        status.textContent = 'Loading decoder...';

        try {
          if (typeof BarcodeLib !== 'undefined') {
            if (isDataMatrix) {
              await BarcodeLib.ensureZxingLoaded();
            } else {
              await BarcodeLib.ensureJsQRLoaded();
            }
          }
        } catch (e) {
          status.textContent = 'Failed to load decoder';
          return;
        }

        status.textContent = 'Processing...';
        const img = new Image();
        img.onload = async () => {
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          let decoded = null;
          if (typeof BarcodeLib !== 'undefined') {
            if (isDataMatrix) {
              // Async zxing-js decode for DM
              const dmResult = await BarcodeLib.decodeDataMatrixFromImageData(imageData);
              if (dmResult && dmResult.hex) decoded = dmResult.hex;
            }
            if (!decoded) {
              // Try async multi-format decode (QR + DM)
              const anyResult = await BarcodeLib.decodeBarcodesFromImageData(imageData);
              if (anyResult && anyResult.text) decoded = anyResult.text;
            }
            if (!decoded) {
              // Synchronous jsQR fallback
              const qrResult = BarcodeLib.decodeQRFromImageData(imageData);
              if (qrResult) decoded = qrResult.text;
            }
          }

          if (decoded) {
            modal.remove();
            decodeBarcodeResult(decoded, gridKey);
          } else {
            status.textContent = isDataMatrix
              ? 'Could not decode Data Matrix'
              : 'Could not decode image';
          }
        };
        img.src = URL.createObjectURL(file);
      };
    }
  }
  
  function renderMusicNotation(code, container) {
    if (!container) return;
    container.innerHTML = '';
    const whiteBox = document.createElement('div');
    whiteBox.style.cssText = 'background:white;border-radius:6px;padding:4px;width:fit-content;margin:0 auto;';
    container.appendChild(whiteBox);
    
    if (typeof VexFlowLib !== 'undefined' && VexFlowLib.renderToElement) {
      const notes = VexFlowLib.parseMusicalCode(code);
      if (notes.length === 0) {
        whiteBox.innerHTML = '<div style="color:#888;font-size:11px;padding:20px;">No notes</div>';
        return;
      }
      VexFlowLib.renderToElement(whiteBox, notes, { width: 140, height: 280, scale: 0.45 });
    }
  }

  // ============== CARD REORDERING ==============
  
  function reorderCards(fromKey, toKey) {
    if (fromKey === toKey) return;
    const fromIdx = cardState.order.indexOf(fromKey);
    const toIdx = cardState.order.indexOf(toKey);
    if (fromIdx < 0 || toIdx < 0) return;
    cardState.order.splice(fromIdx, 1);
    cardState.order.splice(toIdx, 0, fromKey);
    saveCardState();
    renderCards();
  }

  // ============== MAIN RENDER FUNCTION ==============
  
  // ============== LIGHTWEIGHT CODE-ONLY UPDATE ==============
  // Updates just the code text/canvas on existing cards without rebuilding DOM.
  // Keeps all event handlers, hover states, and button states intact.
  // Used during GPX playback and high-frequency coordinate changes.
  
  function updateCardCodes() {
    const container = document.getElementById('cardsContainer');
    if (!container || !currentCardCoord) return;
    
    const cards = container.querySelectorAll('[data-grid-key]');
    if (cards.length === 0) return;
    
    cards.forEach(card => {
      const gridKey = card.dataset.gridKey;
      if (!gridKey) return;
      const gridDef = CARD_GRIDS[gridKey];
      if (!gridDef || (!gridDef.grid && !gridDef.gis && !gridDef.healpix && !gridDef.chessOf)) return;
      // Redacted GIS card under privacy mode: leave the blurred block alone.
      // HEALPix now transforms properly under both passphrase and obfuscation,
      // so it always re-renders (never skipped for privacy).
      if (gridDef.gis && (passphrase || obfuscated)) return;
      
      const isBarcodeCard = (gridDef.display === 'qrhex' || gridDef.display === 'qrbin' || gridDef.display === 'qrurl' || gridDef.display === 'datamatrix');
      const isFixed = gridDef.fixedIterations !== undefined;
      const iterations = isBarcodeCard ? getBarcodeIterations(gridKey)
        : (gridDef.fixedIterations !== undefined ? gridDef.fixedIterations : (cardState.iterations[gridKey] || gridDef.defaultIterations));
      const code = encodeCardCoordinate(gridKey, currentCardCoord.lat, currentCardCoord.lon, iterations);
      if (!code) return;
      
      const isActive = cardState.active === gridKey;
      card.classList.toggle('active-card', isActive);
      
      const supportsChecksum = !!gridDef.prefixLength;
      const checksumOn = supportsChecksum;
      let checksumValue = null;
      if (checksumOn) {
        const delimiter = gridDef.delimiter;
        const codeForChecksum = delimiter ? code.split(delimiter).join('') : code;
        checksumValue = computeChecksumNumeric(codeForChecksum, gridKey);
      }
      const isWordBased = gridDef.prefixLength || gridKey === 'nato' || gridKey === 'bytewords';
      const isBarcodeDisplay = (gridDef.display === 'qrhex' || gridDef.display === 'qrbin' || gridDef.display === 'qrurl' || gridDef.display === 'datamatrix');
      
      // Update code display
      if (gridDef.display === 'music') {
        const el = card.querySelector('.music-raw');
        const newText = code.replace(/,\s*$/, '');
        if (el && el.textContent !== newText) {
          el.textContent = newText;
          // Only re-render VexFlow notation if piano roll isn't active
          // (piano roll updates itself via AudioService event bus)
          if (typeof PianoRoll === 'undefined' || !PianoRoll.isVisible) {
            renderMusicNotation(code, card.querySelector('.music-notation'));
          }
        }
      } else if (gridDef.display === 'chroma') {
        const hexEl = card.querySelector('.chroma-hex');
        const chromaStr = (typeof RGB111Lib !== 'undefined' && RGB111Lib.hexToColorString)
          ? RGB111Lib.hexToColorString(code, 'ink') : code;
        if (hexEl && hexEl.dataset.code !== code) {
          hexEl.dataset.code = code;
          hexEl.innerHTML = checksumValue
            ? `${chromaStr}<span style="font-size:0.85em;opacity:0.5">.${checksumValue}</span>`
            : chromaStr;
          const ctrEl = card.querySelector('.chroma-container');
          if (ctrEl) {
            ctrEl.dataset.code = code;
            renderChromaCoord(code, ctrEl);
          }
        }
      } else if (isBarcodeDisplay) {
        const hexEl = card.querySelector('.barcode-hex');
        if (hexEl && hexEl.textContent !== code) {
          hexEl.textContent = code;
          const ctrEl = card.querySelector('.barcode-container');
          if (ctrEl) {
            ctrEl.dataset.code = code;
            if (gridDef.display === 'qrhex') {
              renderBarcodeQR(code, ctrEl, 'qrhex');
            } else if (gridDef.display === 'qrbin') {
              renderBarcodeQRBinary(code, ctrEl);
            } else if (gridDef.display === 'qrurl') {
              const qrUrlContent = (typeof BarcodeLib !== 'undefined')
                ? BarcodeLib.buildGeosonifyURL(code, null, obfuscated)
                : code;
              renderBarcodeQR(qrUrlContent, ctrEl, 'qrurl');
            } else if (gridDef.display === 'datamatrix') {
              renderBarcodeDataMatrix(withHealpixBarcodeOrder(gridKey, code), ctrEl);
            }
          }
        }
      } else if (gridDef.display === 'chessboard') {
        const disp = card.querySelector('.chess-display');
        if (disp && disp.dataset.code !== code) {
          const fmt = disp.dataset.fmt || gridDef.chessFormat || 'standard';
          disp.dataset.code = code;
          const fenEl = card.querySelector('.chess-fen');
          const linkEl = card.querySelector('.chess-fen-link');
          const asciiEl = card.querySelector('.chess-ascii-pre');
          const ctrEl = card.querySelector('.chess-board-container');
          try {
            const fen = ChessboardLib.toFEN(code, fmt);
            if (fenEl) fenEl.textContent = fen;
            if (linkEl) linkEl.setAttribute('href', 'https://lichess.org/editor/' + fen);
            if (asciiEl) asciiEl.textContent = ChessboardLib.toASCII(code, fmt);
            if (ctrEl) ChessboardLib.renderBoard(code, ctrEl, { format: fmt, letters: chessUseLetters });
            disp.classList.remove('chess-toobig');
          } catch (e) {
            if (ctrEl) ctrEl.innerHTML = '';
            if (fenEl) fenEl.textContent = '(code too precise — reduce precision)';
            if (linkEl) linkEl.removeAttribute('href');
          }
        }
      } else {
        const el = card.querySelector('.code-display');
        if (el) {
          const newHTML = isWordBased 
            ? `<span>${formatCodeForDisplay(code, gridKey, checksumValue)}</span>`
            : (checksumValue 
                ? `${code}<span style="font-size:0.85em;opacity:0.5">.${checksumValue}</span>` 
                : code);
          el.innerHTML = newHTML;
        }
      }
      
      // Update precision text
      const precEl = card.querySelector('.precision-display');
      if (precEl) precEl.textContent = getPrecisionText(gridKey, iterations);
      
      // Dispatch fullscreen update
      if (document.getElementById('fs-overlay')) {
        window.dispatchEvent(new CustomEvent('geosonify:coordUpdate', {
          detail: { gridKey, code }
        }));
      }
    });
  }

  function renderCards() {
    const container = document.getElementById('cardsContainer');
    if (!container || !currentCardCoord) return;
    
    const visibleCards = cardState.order.filter(k => 
      cardState.visible.includes(k) && CARD_GRIDS[k] && (CARD_GRIDS[k].grid || CARD_GRIDS[k].gis || CARD_GRIDS[k].healpix || CARD_GRIDS[k].chessOf)
    );
    
    container.innerHTML = '';
    
    visibleCards.forEach((gridKey, cardIndex) => {
      const gridDef = CARD_GRIDS[gridKey];
      const isBarcodeCard = (gridDef.display === 'qrhex' || gridDef.display === 'qrbin' || gridDef.display === 'qrurl' || gridDef.display === 'datamatrix');
      const isFixed = gridDef.fixedIterations !== undefined;
      const iterations = isBarcodeCard ? getBarcodeIterations(gridKey)
        : (gridDef.fixedIterations !== undefined ? gridDef.fixedIterations : (cardState.iterations[gridKey] || gridDef.defaultIterations));
      let code = encodeCardCoordinate(gridKey, currentCardCoord.lat, currentCardCoord.lon, iterations);
      // GIS reference cards are real, interoperable standards (Plus Code, MGRS, …)
      // that can't be privacy-transformed → redact under any privacy mode.
      // HEALPix transforms properly (permute + obfuscate) so it is NEVER redacted.
      const gisRedacted = !!(gridDef.gis && (passphrase || obfuscated));
      if (gisRedacted) {
        code = '████████';
      }
      const isActive = cardState.active === gridKey;
      const isChroma = gridDef.display === 'chroma';
      const supportsChecksum = !!gridDef.prefixLength;  // BIP39 grids have prefixLength
      const checksumOn = supportsChecksum;
      
      // Build display code with grey numeric checksum if enabled
      let checksumValue = null;
      if (checksumOn && code) {
        // Strip delimiter for checksum calculation
        const delimiter = gridDef.delimiter;
        const codeForChecksum = delimiter ? code.split(delimiter).join('') : code;
        checksumValue = computeChecksumNumeric(codeForChecksum, gridKey);
      }
      
      const card = document.createElement('div');
      card.className = `format-card ${isActive ? 'active-card' : ''}`;
      
      const lockIcon = passphrase ? `<span class="card-title-icon">${ICONS.key}</span>` : '';
      const obfIcon = obfuscated ? `<span class="card-title-icon">${ICONS.shuffle}</span>` : '';
      const precision = getPrecisionText(gridKey, iterations);
      
      // Format display with grey checksum (smaller font)
      const codeWithChecksum = checksumValue 
        ? `${code}<span style="font-size:0.85em;opacity:0.5">.${checksumValue}</span>`
        : code;
      const plainCodeWithChecksum = checksumValue ? `${code}.${checksumValue}` : code;
      
      // For word-based grids, use formatted HTML with line breaks
      const isWordBased = gridDef.prefixLength || gridKey === 'nato' || gridKey === 'bytewords';
      const formattedCode = isWordBased 
        ? formatCodeForDisplay(code, gridKey, checksumValue)
        : codeWithChecksum;
      
      let bodyContent = '';
      const isBarcode = (gridDef.display === 'qrhex' || gridDef.display === 'qrbin' || gridDef.display === 'qrurl' || gridDef.display === 'datamatrix');
      if (gridDef.display === 'emoji') {
        bodyContent = `<div class="code-display emoji" data-editable="true" title="Click to edit">${codeWithChecksum}</div>`;
      } else if (isChroma) {
        // Show the colour-string spelling (slash form) rather than raw hex —
        // it's the natural way to read the colours in and out. Hex still lives
        // in data-code / URLs. Fall back to hex if the lib isn't present.
        const chromaStr = (typeof RGB111Lib !== 'undefined' && RGB111Lib.hexToColorString)
          ? RGB111Lib.hexToColorString(code, 'ink') : code;
        const chromaText = checksumValue
          ? `${chromaStr}<span style="font-size:0.85em;opacity:0.5">.${checksumValue}</span>`
          : chromaStr;
        bodyContent = `<div class="chroma-display"><div class="chroma-container" data-code="${code}"></div><div class="chroma-hex" data-editable="true" title="Click to edit">${chromaText}</div></div>`;
      } else if (isBarcode) {
        bodyContent = `<div class="barcode-display"><div class="barcode-container" data-code="${code}" data-grid="${gridKey}"></div><div class="barcode-hex" data-editable="true" title="Click to edit">${code}</div></div>`;
      } else if (gridDef.display === 'music') {
        bodyContent = `<div class="music-display"><div class="music-notation"></div><div class="music-pianoroll" style="display:none;"></div><div class="music-raw" data-editable="true" title="Click to edit">${code.replace(/,\s*$/, '')}</div></div>`;
      } else if (isWordBased) {
        // Wrap in span so flex treats code+checksum as single item, not separate columns
        bodyContent = `<div class="code-display" data-editable="true" title="Click to edit"><span>${formattedCode}</span></div>`;
      } else if (gridDef.display === 'chessboard') {
        // Chess board view of the hex `code`, plus FEN (as a lichess link) + an inline ASCII
        // board, both copyable and decodable. data-code carries the hex; board/FEN/ASCII are
        // (re)rendered in updateCardCodes. The ASCII <pre> is collapsed by default and toggled
        // inline (NOT below the card edge).
        const fmt = gridDef.chessFormat || 'standard';
        let fen = '', ascii = '', tooBig = false;
        try { fen = ChessboardLib.toFEN(code, fmt); ascii = ChessboardLib.toASCII(code, fmt); }
        catch (e) { tooBig = true; }
        if (tooBig) {
          bodyContent = `<div class="chess-display chess-toobig" data-code="${code}" data-grid="${gridKey}">` +
            `<div class="chess-error">Code too precise for a chess board (max ${ChessboardLib.maxHexDigits(fmt)} hex digits). Reduce precision.</div></div>`;
        } else {
          const lichess = 'https://lichess.org/editor/' + fen;
          bodyContent = `<div class="chess-display" data-code="${code}" data-grid="${gridKey}" data-fmt="${fmt}">` +
            `<div class="chess-board-container"></div>` +
            `<div class="chess-textforms">` +
              `<div class="chess-row">` +
                `<a class="chess-label chess-fen-link" href="${lichess}" target="_blank" rel="noopener" title="Open in lichess board editor">FEN ↗</a>` +
                `<code class="chess-fen">${fen}</code>` +
                `<button class="card-btn chess-edit-fen" title="Edit / paste a FEN to decode">✎</button>` +
                `<button class="card-btn chess-copy-fen" title="Copy FEN">${ICONS.copy}</button></div>` +
              `<div class="chess-row">` +
                `<button class="chess-label chess-ascii-toggle" title="Show / hide ASCII board">ASCII ▾</button>` +
                `<button class="card-btn chess-copy-ascii" title="Copy ASCII board">${ICONS.copy}</button></div>` +
              `<pre class="chess-ascii-pre" style="display:none;">${ascii}</pre>` +
            `</div></div>`;
        }
      } else if (gisRedacted) {
        // Redacted GIS card: show blurred block, not editable, not copyable
        bodyContent = `<div class="code-display gis-redacted" title="Hidden while privacy mode is active" style="filter:blur(4px);user-select:none;opacity:0.55;letter-spacing:2px;cursor:not-allowed;">████████</div>`;
      } else {
        bodyContent = `<div class="code-display" data-editable="true" title="Click to edit">${formattedCode}</div>`;
      }
      
      const chromaActions = isChroma ? `
        <button class="card-btn camera-btn" title="Scan with camera">${ICONS.camera}</button>
        <button class="card-btn photo-btn" title="Decode from image">${ICONS.image}</button>
      ` : '';
      
      const barcodeActions = isBarcode ? `
        <button class="card-btn bc-camera-btn" title="Scan with camera">${ICONS.camera}</button>
        <button class="card-btn bc-photo-btn" title="Decode from image">${ICONS.image}</button>
      ` : '';
      
      const chessActions = (gridDef.display === 'chessboard') ? `
        <button class="card-btn card-btn-wide chess-decode-btn" title="Decode a board (FEN or ASCII) to its code"><span class="card-btn-icon">${ICONS.decode}</span><span class="card-btn-text">DECODE</span></button>
      ` : '';

      const checksumBtn = supportsChecksum ? `
        <button class="card-btn checksum-btn ${checksumOn ? 'checksum-active' : ''}" title="Toggle checksum word">✓</button>
      ` : '';
      
      const linkIcon = gridDef.link ? `<a href="${gridDef.link}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;text-decoration:none;opacity:0.6;margin-left:4px;color:currentColor;" title="About ${gridDef.name}">${ICONS.link}</a>` : '';
      
      card.innerHTML = `
        <div class="card-header-row">
          <div class="card-nav-btns">
            <button class="card-nav-btn move-up-btn" title="Move up">^</button>
            <button class="card-nav-btn move-down-btn" title="Move down">⌄</button>
          </div>
          <div class="card-title">${lockIcon}${obfIcon}${gridDef.name}${linkIcon}</div>
          <div class="card-actions">
            <button class="card-btn active-btn ${isActive ? 'active-indicator' : ''}" title="Set active">★</button>
            ${chromaActions}
            ${barcodeActions}
            ${chessActions}
            ${checksumBtn}
            <button class="card-btn share-btn" title="Share">${ICONS.share}</button>
            <button class="card-btn copy-btn" title="Copy">${ICONS.copy}</button>
            <button class="card-btn close-btn" title="Hide">×</button>
          </div>
        </div>
        <div class="card-body-inner">${bodyContent}</div>
        <div class="card-footer-row">
          <div class="precision-row">
            <span class="precision-display">${precision}</span>
            ${isFixed ? '' : `
              <div class="precision-controls">
                <button class="precision-btn minus-btn" ${iterations <= (gridDef.minIterations || 1) ? 'disabled' : ''}>−</button>
                <button class="precision-btn plus-btn" ${iterations >= (gridDef.dynamicIterations ? getQRUrlIterations() : gridDef.maxIterations) ? 'disabled' : ''}>+</button>
              </div>
            `}
          </div>
          <div class="footer-buttons">
            <button class="action-btn info-btn" title="Cell info">${ICONS.info}</button>
            ${gridDef.display === 'chessboard' ? `<button class="action-btn chess-letters-btn" title="Toggle Symbols / Letters">${chessUseLetters ? 'Aa' : '♟'}</button>` : ''}
            ${(gridDef.gis || gridDef.healpix || gridDef.display === 'chessboard') ? '' : '<button class="action-btn grid3x3 grid3x3-btn">3×3</button>'}
            <button class="action-btn fullscreen-btn">Full</button>
          </div>
        </div>
      `;
      
      // Enable drag and drop
      card.draggable = true;
      card.dataset.gridKey = gridKey;
      
      card.ondragstart = (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', gridKey);
        e.dataTransfer.effectAllowed = 'move';
      };
      card.ondragend = () => card.classList.remove('dragging');
      card.ondragover = (e) => e.preventDefault();
      card.ondrop = (e) => {
        e.preventDefault();
        const fromKey = e.dataTransfer.getData('text/plain');
        reorderCards(fromKey, gridKey);
      };
      
      // Event handlers
      card.querySelector('.active-btn').onclick = () => {
        cardState.active = gridKey;
        rawModeActive = false;
        updateRawModeUI();
        saveCardState();
        renderCards();
        // Switching the active card is a deliberate re-encode — release the
        // URL-suppress flag (set true on URL load) so the shareable URL updates
        // to the newly-selected format (e.g. switching to a HEALPix card with
        // delta on must let the ?hphexd=… URL be written).
        if (callbacks.onUserInteraction) callbacks.onUserInteraction();
        if (callbacks.onCompactUpdate) callbacks.onCompactUpdate();
        // Active card changed but the pin didn't move, so the map's grid box
        // won't refresh on its own — nudge it directly.
        if (typeof MapManager !== 'undefined' && MapManager.refreshHierarchicalGrid) {
          MapManager.refreshHierarchicalGrid();
        }
      };
      
      card.querySelector('.copy-btn').onclick = async () => {
        if (gisRedacted) {
          showToast('Hidden while privacy mode is active', 'error');
          return;
        }
        if (gridDef?.display === 'chroma' && typeof RGB111Lib !== 'undefined') {
          const canvas = RGB111Lib.generateCanvas(code, { size: 400, borderWidth: 0.5, notchSize: 0.5 });
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          
          if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
            try {
              await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
              showToast('Image copied!');
              return;
            } catch (e) {
              console.log('[CardRenderer] Clipboard write failed:', e);
            }
          }
          
          if (navigator.share && navigator.canShare) {
            const file = new File([blob], `chromacoord-${code}.png`, { type: 'image/png' });
            const shareData = { files: [file] };
            if (navigator.canShare(shareData)) {
              try {
                await navigator.share(shareData);
                return;
              } catch (e) {
                if (e.name !== 'AbortError') {
                  console.log('[CardRenderer] Share failed:', e);
                }
              }
            }
          }
          
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `chromacoord-${code}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast('Image downloaded');
          return;
        }
        // Barcode cards: copy barcode image (hi-res, matching ChromaCoord)
        if (isBarcode && typeof BarcodeLib !== 'undefined') {
          let bcCanvas;
          try {
            if (gridDef.display === 'datamatrix') {
              await BarcodeLib.ensureBwipLoaded();
              bcCanvas = BarcodeLib.generateDataMatrixCanvas(withHealpixBarcodeOrder(gridKey, code), { size: 1024 });
            } else {
              await BarcodeLib.ensureQRGenLoaded();
              let content = code;
              if (gridDef.display === 'qrurl') {
                content = BarcodeLib.buildGeosonifyURL(code, null, obfuscated);
              }
              bcCanvas = BarcodeLib.generateQRCanvas(content, { size: 1024, eccLevel: 'L' });
            }
          } catch (e) {
            console.log('[CardRenderer] Barcode canvas error:', e);
          }
          if (bcCanvas) {
            const blob = await new Promise(resolve => bcCanvas.toBlob(resolve, 'image/png'));
            
            if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
              try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                showToast('Image copied!');
                return;
              } catch (e) {
                console.log('[CardRenderer] Clipboard write failed:', e);
              }
            }
            
            if (navigator.share && navigator.canShare) {
              const file = new File([blob], `${gridKey}-${code.slice(0,8)}.png`, { type: 'image/png' });
              const shareData = { files: [file] };
              if (navigator.canShare(shareData)) {
                try {
                  await navigator.share(shareData);
                  return;
                } catch (e) {
                  if (e.name !== 'AbortError') {
                    console.log('[CardRenderer] Share failed:', e);
                  }
                }
              }
            }
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${gridKey}-${code.slice(0,8)}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('Image downloaded');
            return;
          }
        }
        navigator.clipboard.writeText(plainCodeWithChecksum);
        showToast('Copied!');
      };
      
      card.querySelector('.share-btn').onclick = () => {
        if (gisRedacted) {
          showToast('Hidden while privacy mode is active', 'error');
          return;
        }
        shareCard(gridKey, plainCodeWithChecksum);
      };
      
      // Checksum toggle button (BIP39 only)
      const checksumBtnEl = card.querySelector('.checksum-btn');
      if (checksumBtnEl) {
        checksumBtnEl.onclick = () => {
          cardState.checksumEnabled[gridKey] = !cardState.checksumEnabled[gridKey];
          saveCardState();
          renderCards();
          if (callbacks.onCompactUpdate) callbacks.onCompactUpdate();
        };
      }
      
      card.querySelector('.close-btn').onclick = () => {
        cardState.visible = cardState.visible.filter(k => k !== gridKey);
        saveCardState();
        renderCards();
      };
      
      card.querySelector('.fullscreen-btn').onclick = () => {
        if (gisRedacted) {
          showToast('Hidden while privacy mode is active', 'error');
          return;
        }
        showCardFullscreen(gridKey, code);
      };
      const g3 = card.querySelector('.grid3x3-btn');
      if (g3) g3.onclick = () => show3x3Grid(gridKey, code);
      card.querySelector('.info-btn').onclick = () => {
        if (gisRedacted) {
          showToast('Hidden while privacy mode is active', 'error');
          return;
        }
        // Measurement uncertainty line — read from the source-of-truth exact
        // point's provenance (scheme-independent, invariant across cards). Shown
        // in the ℹ️ box only; the clicker stays clean (cell size only).
        const uncertaintyLine = buildUncertaintyLine();
        // Chess cards present a sibling code — show the sibling's info (HEALPix dialog or cell info).
        const infoDef = (gridDef.chessOf && CARD_GRIDS[gridDef.chessOf]) ? CARD_GRIDS[gridDef.chessOf] : gridDef;
        const infoKey = gridDef.chessOf || gridKey;
        if (infoDef.healpix && typeof HealpixGrids !== 'undefined') {
          let compareLine = null;
          const activeKey = cardState.active;
          const activeDef = CARD_GRIDS[activeKey];
          if (activeDef && activeDef.grid && currentCardCoord) {
            const aIter = activeDef.fixedIterations !== undefined
              ? activeDef.fixedIterations
              : (cardState.iterations[activeKey] || activeDef.defaultIterations);
            const aPrec = getPrecisionText(activeKey, aIter);
            compareLine = `Your active ${activeDef.name} card at ${aIter} iterations: ${aPrec} cell`;
          }
          HealpixGrids.showInfo(infoDef.healpix, iterations, currentCardCoord, { compareLine, uncertaintyLine });
        } else if (infoDef.gis && typeof GISGrids !== 'undefined') {
          let compareLine = null;
          const activeKey = cardState.active;
          const activeDef = CARD_GRIDS[activeKey];
          if (activeDef && activeDef.grid && currentCardCoord) {
            const aIter = activeDef.fixedIterations !== undefined
              ? activeDef.fixedIterations
              : (cardState.iterations[activeKey] || activeDef.defaultIterations);
            const aPrec = getPrecisionText(activeKey, aIter);
            compareLine = `Your active ${activeDef.name} card at ${aIter} iterations: ${aPrec} cell`;
          }
          GISGrids.showInfo(infoDef.gis, iterations, currentCardCoord, { compareLine, uncertaintyLine });
        } else {
          showCellInfo(infoKey, code, iterations, uncertaintyLine);
        }
      };
      
      // Move up/down buttons
      const moveUpBtn = card.querySelector('.move-up-btn');
      const moveDownBtn = card.querySelector('.move-down-btn');
      
      if (cardIndex === 0) moveUpBtn.disabled = true;
      if (cardIndex === visibleCards.length - 1) moveDownBtn.disabled = true;
      
      moveUpBtn.onclick = (e) => {
        e.stopPropagation();
        if (cardIndex > 0) {
          const prevKey = visibleCards[cardIndex - 1];
          reorderCards(gridKey, prevKey);
        }
      };
      
      moveDownBtn.onclick = (e) => {
        e.stopPropagation();
        if (cardIndex < visibleCards.length - 1) {
          const nextKey = visibleCards[cardIndex + 1];
          const currentIdx = cardState.order.indexOf(gridKey);
          const nextIdx = cardState.order.indexOf(nextKey);
          if (currentIdx >= 0 && nextIdx >= 0) {
            cardState.order.splice(currentIdx, 1);
            const insertIdx = cardState.order.indexOf(nextKey) + 1;
            cardState.order.splice(insertIdx, 0, gridKey);
            saveCardState();
            renderCards();
          }
        }
      };
      
      // ChromaCoord camera/photo buttons
      if (isChroma) {
        card.querySelector('.camera-btn')?.addEventListener('click', () => {
          showChromaScanModal('camera');
        });
        card.querySelector('.photo-btn')?.addEventListener('click', () => {
          if (typeof ScannerUI !== 'undefined') {
            ScannerUI.showPhotoScanner();
          } else {
            showChromaScanModal('upload');
          }
        });
      }
      
      // Barcode card camera/photo buttons
      if (isBarcode) {
        const camBtn = card.querySelector('.bc-camera-btn');
        const photoBtn = card.querySelector('.bc-photo-btn');
        if (camBtn) {
          camBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('[CardRenderer] Barcode camera btn clicked, gridKey:', gridKey);
            showBarcodeScanModal('camera', gridKey);
          });
        } else {
          console.warn('[CardRenderer] No .bc-camera-btn found for', gridKey);
        }
        if (photoBtn) {
          photoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('[CardRenderer] Barcode photo btn clicked, gridKey:', gridKey);
            showBarcodeScanModal('upload', gridKey);
          });
        } else {
          console.warn('[CardRenderer] No .bc-photo-btn found for', gridKey);
        }
      }
      
      // Music card speaker and settings
      if (gridKey === 'music' && typeof AudioUI !== 'undefined') {
        const titleEl = card.querySelector('.card-title');
        if (titleEl) {
          const speakerBtn = AudioUI.createSpeakerButton('music');
          speakerBtn.style.marginLeft = '8px';
          titleEl.appendChild(speakerBtn);
          
          const settingsBtn = document.createElement('button');
          settingsBtn.className = 'audio-speaker-btn';
          settingsBtn.innerHTML = ICONS.settings;
          settingsBtn.title = 'Sound Design Settings';
          settingsBtn.style.marginLeft = '4px';
          settingsBtn.onclick = (e) => {
            e.stopPropagation();
            AudioUI.showSoundDesign();
          };
          titleEl.appendChild(settingsBtn);
          
          // Piano roll toggle button (▦ / 🎼)
          if (typeof PianoRoll !== 'undefined') {
            const rollToggle = document.createElement('button');
            rollToggle.className = 'audio-speaker-btn piano-roll-toggle';
            rollToggle.innerHTML = '▦';
            rollToggle.title = 'Toggle piano roll view';
            rollToggle.style.marginLeft = '4px';
            rollToggle.style.fontFamily = "'SF Mono', ui-monospace, monospace";
            rollToggle.style.fontWeight = '700';
            rollToggle.style.fontSize = '16px';
            rollToggle.onclick = (e) => {
              e.stopPropagation();
              const notation = card.querySelector('.music-notation');
              const pianoroll = card.querySelector('.music-pianoroll');
              if (!notation || !pianoroll) return;
              
              if (PianoRoll.isVisible) {
                // Switch to VexFlow staff
                PianoRoll.hide();
                notation.style.display = '';
                rollToggle.innerHTML = '▦';
                rollToggle.title = 'Show piano roll';
              } else {
                // Switch to piano roll
                notation.style.display = 'none';
                pianoroll.style.display = 'block';
                // Init if not yet done
                if (!PianoRoll.isVisible) {
                  PianoRoll.init({
                    container: pianoroll,
                    audioService: global.AudioService
                  });
                }
                PianoRoll.show();
                rollToggle.innerHTML = '🎼';
                rollToggle.title = 'Show grand staff';
              }
            };
            titleEl.appendChild(rollToggle);
          }
          
          if (typeof createWaypointButton === 'function') {
            const waypointBtn = createWaypointButton();
            waypointBtn.style.marginLeft = '4px';
            waypointBtn.style.padding = '4px 8px';
            waypointBtn.style.fontSize = '14px';
            waypointBtn.style.background = 'transparent';
            titleEl.appendChild(waypointBtn);
          }
        }
      }
      
      // Editable code on click
      const editableEl = card.querySelector('[data-editable="true"]');
      if (editableEl) {
        editableEl.style.cursor = 'pointer';
        editableEl.onclick = () => showEditCodeModal(gridKey, code);
      }
      
      // Precision controls
      if (!isFixed) {
        card.querySelector('.minus-btn')?.addEventListener('click', () => {
          const min = gridDef.minIterations || 1;
          const step = gridDef.iterStep || 1;
          cardState.iterations[gridKey] = Math.max(min, (cardState.iterations[gridKey] || gridDef.defaultIterations) - step);
          saveCardState();
          // Persist iterations for custom grids
          if (gridDef.isCustom && typeof CustomGridLoader !== 'undefined' && CustomGridLoader.updateStoredIterations) {
            CustomGridLoader.updateStoredIterations(gridKey, cardState.iterations[gridKey]);
          }
          renderCards();
          if (cardState.active === gridKey && typeof MapManager !== 'undefined' && MapManager.refreshHierarchicalGrid) {
            MapManager.refreshHierarchicalGrid();
          }
        });
        card.querySelector('.plus-btn')?.addEventListener('click', () => {
          const step = gridDef.iterStep || 1;
          const newIter = (cardState.iterations[gridKey] || gridDef.defaultIterations) + step;
          const max = gridDef.dynamicIterations ? getQRUrlIterations() : gridDef.maxIterations;
          cardState.iterations[gridKey] = max ? Math.min(max, newIter) : newIter;
          saveCardState();
          // Persist iterations for custom grids
          if (gridDef.isCustom && typeof CustomGridLoader !== 'undefined' && CustomGridLoader.updateStoredIterations) {
            CustomGridLoader.updateStoredIterations(gridKey, cardState.iterations[gridKey]);
          }
          renderCards();
          if (cardState.active === gridKey && typeof MapManager !== 'undefined' && MapManager.refreshHierarchicalGrid) {
            MapManager.refreshHierarchicalGrid();
          }
        });
      }
      
      container.appendChild(card);
      
      // Render special displays
      if (gridDef.display === 'chroma') {
        renderChromaCoord(code, card.querySelector('.chroma-container'));
      } else if (gridDef.display === 'music') {
        renderMusicNotation(code, card.querySelector('.music-notation'));
      } else if (gridDef.display === 'qrhex') {
        renderBarcodeQR(code, card.querySelector('.barcode-container'), 'qrhex');
      } else if (gridDef.display === 'qrbin') {
        renderBarcodeQRBinary(code, card.querySelector('.barcode-container'));
      } else if (gridDef.display === 'qrurl') {
        // Build URL for QR-URL card
        const qrUrlContent = (typeof BarcodeLib !== 'undefined')
          ? BarcodeLib.buildGeosonifyURL(code, null, obfuscated)
          : code;
        renderBarcodeQR(qrUrlContent, card.querySelector('.barcode-container'), 'qrurl');
      } else if (gridDef.display === 'datamatrix') {
        renderBarcodeDataMatrix(withHealpixBarcodeOrder(gridKey, code), card.querySelector('.barcode-container'));
      } else if (gridDef.display === 'chessboard') {
        const fmt = gridDef.chessFormat || 'standard';
        const ctrEl = card.querySelector('.chess-board-container');
        if (ctrEl) {
          try { ChessboardLib.renderBoard(code, ctrEl, { format: fmt, letters: chessUseLetters }); }
          catch (e) { ctrEl.innerHTML = ''; }
        }
        // Copy FEN
        card.querySelector('.chess-copy-fen')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          try { await navigator.clipboard.writeText(ChessboardLib.toFEN(code, fmt)); showToast("Copied!"); }
          catch (err) { /* clipboard unavailable */ }
        });
        // Copy ASCII board
        card.querySelector('.chess-copy-ascii')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          try { await navigator.clipboard.writeText(ChessboardLib.toASCII(code, fmt)); showToast("Copied!"); }
          catch (err) { /* clipboard unavailable */ }
        });
        // Decode a pasted board (FEN or ASCII) back to its hex code, then jump the map there.
        card.querySelector('.chess-decode-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          showChessDecodeModal(gridKey);
        });
        // Edit/paste FEN (the ✎ button) — opens the same decode modal, pre-seeded with the FEN.
        card.querySelector('.chess-edit-fen')?.addEventListener('click', (e) => {
          e.stopPropagation();
          let seed = ''; try { seed = ChessboardLib.toFEN(code, fmt); } catch (_) {}
          showChessDecodeModal(gridKey, seed);
        });
        // ASCII show/hide toggle (inline, never below the card edge)
        card.querySelector('.chess-ascii-toggle')?.addEventListener('click', (e) => {
          e.stopPropagation();
          const pre = card.querySelector('.chess-ascii-pre');
          const btn = e.currentTarget;
          if (!pre) return;
          const showing = pre.style.display !== 'none';
          pre.style.display = showing ? 'none' : 'block';
          btn.textContent = showing ? 'ASCII ▾' : 'ASCII ▴';
        });
        // Symbols / Letters toggle (applies to all chess cards at once)
        card.querySelector('.chess-letters-btn')?.addEventListener('click', (e) => {
          e.stopPropagation();
          chessUseLetters = !chessUseLetters;
          renderCards();
        });
      }
	  
	  // BIP39 entry view (like piano roll for music)
if (gridDef.prefixLength && typeof BIP39Entry !== 'undefined') {
  BIP39Entry.attach(card, gridKey);
}
      
      // Dispatch update event for fullscreen listeners
      if (document.getElementById('fs-overlay')) {
        window.dispatchEvent(new CustomEvent('geosonify:coordUpdate', {
          detail: { gridKey, code }
        }));
      }
    });
    
    // Add "+Add" card at the bottom
    const addCard = document.createElement('div');
    addCard.className = 'format-card add-card';
    addCard.style.cssText = 'border: 2px dashed rgba(0,255,255,0.4); background: rgba(0,255,255,0.05); display: flex; align-items: center; justify-content: center; cursor: pointer; min-height: 100px;';
    addCard.innerHTML = '<div style="font-size: 24px; color: rgba(0,255,255,0.7); font-weight: 300;">+ Add Mode</div>';
    addCard.onclick = () => showAddFormatModal();
    container.appendChild(addCard);
    
    // Re-attach piano roll if it was active before the DOM rebuild
    // BUT skip if it's currently in a fullscreen overlay (don't yank it out)
    if (typeof PianoRoll !== 'undefined' && PianoRoll.isVisible && !document.getElementById('fs-overlay')) {
      const musicCard = container.querySelector('[data-grid-key="music"]');
      if (musicCard) {
        const notation = musicCard.querySelector('.music-notation');
        const pianoroll = musicCard.querySelector('.music-pianoroll');
        const toggle = musicCard.querySelector('.piano-roll-toggle');
        if (notation && pianoroll) {
          notation.style.display = 'none';
          pianoroll.style.display = 'block';
          // Re-attach to new container, preserving note history
          PianoRoll.reattach(pianoroll);
          PianoRoll.show();
          if (toggle) {
            toggle.innerHTML = '🎼';
            toggle.title = 'Show grand staff';
            toggle.classList.add('active');
          }
        }
      }
    }
  }

  // ============== FULLSCREEN PIANO ROLL ==============

  function showPianoRollFullscreen(code) {
    const overlay = document.createElement('div');
    overlay.id = 'fs-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:#0a0f0f;color:#fff;z-index:2000;display:flex;flex-direction:column;touch-action:none;padding-top:calc(env(safe-area-inset-top, 20px) + 12px);padding-bottom:env(safe-area-inset-bottom, 0px);';

    // Hint (fades out)
    const hint = document.createElement('div');
    hint.style.cssText = 'padding:8px 16px 4px;font-size:11px;color:rgba(255,255,255,0.3);text-align:center;flex-shrink:0;transition:opacity 1s;';
    hint.textContent = 'Tap to close';

    // Status bar
    const status = document.createElement('div');
    status.style.cssText = 'padding:2px 16px 6px;font-size:10px;color:rgba(255,255,255,0.35);font-family:"SF Mono",ui-monospace,monospace;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;text-align:center;';

    // Piano roll container — fills remaining space with explicit height
    const rollContainer = document.createElement('div');
    rollContainer.className = 'music-pianoroll';
    rollContainer.style.cssText = 'flex:1;display:block;background:#0a0f0f;overflow:hidden;min-height:100px;';

    // Footer with code
    const footer = document.createElement('div');
    footer.style.cssText = 'padding:6px 16px;font-size:11px;color:rgba(255,255,255,0.35);font-family:"SF Mono",ui-monospace,monospace;border-top:1px solid rgba(255,255,255,0.06);flex-shrink:0;text-align:center;transition:opacity 1s;';
    footer.textContent = code.replace(/,\s*$/, '');

    overlay.appendChild(hint);
    overlay.appendChild(status);
    overlay.appendChild(rollContainer);
    overlay.appendChild(footer);
    document.body.appendChild(overlay);

    // Fade hint and footer
    setTimeout(() => {
      hint.style.opacity = '0';
      footer.style.opacity = '0.15';
    }, 3000);

    // Move piano roll to the fullscreen container
    PianoRoll.reattach(rollContainer);
    PianoRoll.show();

    // Close function
    function closeFullscreen() {
      clearInterval(statusInterval);
      window.removeEventListener('geosonify:coordUpdate', onCoordUpdate);
      // Restore piano roll to the card container
      const musicCard = document.querySelector('[data-grid-key="music"]');
      if (musicCard) {
        const cardPianoroll = musicCard.querySelector('.music-pianoroll');
        if (cardPianoroll) {
          PianoRoll.reattach(cardPianoroll);
          cardPianoroll.style.display = 'block';
          PianoRoll.show();
        }
      }
      overlay.remove();
    }

    // Tap to close (with long-press guard)
    let pressTimer = null, longPressed = false;
    overlay.addEventListener('mousedown', () => {
      longPressed = false;
      pressTimer = setTimeout(() => { longPressed = true; }, 400);
    });
    overlay.addEventListener('touchstart', (e) => {
      longPressed = false;
      pressTimer = setTimeout(() => { longPressed = true; }, 400);
    }, { passive: true });
    overlay.addEventListener('mouseup', () => {
      if (pressTimer) clearTimeout(pressTimer);
      if (!longPressed) closeFullscreen();
    });
    overlay.addEventListener('touchend', (e) => {
      if (pressTimer) clearTimeout(pressTimer);
      if (!longPressed) closeFullscreen();
    });

    // Update status bar periodically
    const statusInterval = setInterval(() => {
      if (!document.body.contains(overlay)) {
        clearInterval(statusInterval);
        return;
      }
      const AS = global.AudioService;
      if (!AS) return;
      const bar = AS.getCurrentBar();
      const beat = AS.getCurrentBeat();
      const pool = AS.getNotePool();
      const noteCount = pool.reduce((sum, arr) => sum + (arr ? arr.length : 0), 0);
      status.textContent = '♩ ' + (AS.getSoundParams?.()?.A?.bpm || '?') + 
        '   Bar ' + (bar + 1) + '   Beat ' + (beat + 1) +
        '   ' + pool.length + ' octaves   ' + noteCount + ' notes';
    }, 250);

    // Update footer code on coordinate change
    function onCoordUpdate(e) {
      if (e.detail && e.detail.gridKey === 'music' && e.detail.code) {
        footer.textContent = e.detail.code.replace(/,\s*$/, '');
      }
    }
    window.addEventListener('geosonify:coordUpdate', onCoordUpdate);
  }

  // ============== MODALS ==============
  
  function showCardFullscreen(gridKey, code) {
    const gridDef = CARD_GRIDS[gridKey];
    
    // If piano roll is active for music card, show fullscreen piano roll instead
    if (gridKey === 'music' && typeof PianoRoll !== 'undefined' && PianoRoll.isVisible) {
      showPianoRollFullscreen(code);
      return;
    }
    
    let displayCode = gridDef?.display === 'music' ? code.replace(/,\s*$/, '') : code;
    const isBarcodeFS = (gridDef?.display === 'qrhex' || gridDef?.display === 'qrbin' || gridDef?.display === 'qrurl' || gridDef?.display === 'datamatrix');
    const isChessFS = (gridDef?.display === 'chessboard');
    
    const overlay = document.createElement('div');
    overlay.id = 'fs-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:#000;color:#fff;z-index:2000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;touch-action:none;';
    
    const hint = document.createElement('div');
    hint.style.cssText = 'position:absolute;top:40px;font-size:12px;opacity:0.35;transition:opacity 1s;';
    hint.textContent = 'Tap to close • Hold to copy';
    
    let codeEl;
    let fsCanvas = null;
    
    function refreshDisplay(newCode) {
      displayCode = gridDef?.display === 'music' ? newCode.replace(/,\s*$/, '') : newCode;
      
      if (gridDef?.display === 'chroma') {
        codeEl.innerHTML = '';
        if (typeof RGB111Lib !== 'undefined' && RGB111Lib.generateCanvas) {
          const vmin = Math.min(window.innerWidth, window.innerHeight);
          const displaySize = Math.min(Math.floor(vmin * 0.8), 600);
          fsCanvas = RGB111Lib.generateCanvas(displayCode, { 
            size: displaySize, borderWidth: 0.5, notchSize: 0.5, showChecksum: true
          });
          codeEl.appendChild(fsCanvas);
        }
      } else if (isBarcodeFS) {
        codeEl.innerHTML = '';
        const vmin = Math.min(window.innerWidth, window.innerHeight);
        const displaySize = Math.min(Math.floor(vmin * 0.8), 600);
        if (typeof BarcodeLib !== 'undefined') {
          if (gridDef?.display === 'datamatrix') {
            fsCanvas = BarcodeLib.generateDataMatrixCanvas(withHealpixBarcodeOrder(gridKey, displayCode), { size: displaySize });
          } else if (gridDef?.display === 'qrbin') {
            fsCanvas = BarcodeLib.generateQRBinaryCanvas(displayCode, { size: displaySize, eccLevel: 'L' });
          } else {
            let content = displayCode;
            if (gridDef?.display === 'qrurl') {
              content = BarcodeLib.buildGeosonifyURL(displayCode, null, obfuscated);
            }
            fsCanvas = BarcodeLib.generateQRCanvas(content, { size: displaySize, eccLevel: 'L' });
          }
          if (fsCanvas) {
            fsCanvas.style.borderRadius = '8px';
            codeEl.appendChild(fsCanvas);
          }
        }
      } else if (isChessFS) {
        codeEl.innerHTML = '';
        const fmt = gridDef.chessFormat || 'standard';
        try {
          ChessboardLib.renderBoard(displayCode, codeEl, { format: fmt, letters: chessUseLetters });
          const grid = codeEl.querySelector('.gschess-boardgrid');
          if (grid) grid.style.maxWidth = 'none';
        } catch (e) {
          codeEl.innerHTML = '<div style="color:#888;font-size:16px;">Code too precise for a board</div>';
        }
      } else if (gridDef?.display === 'music') {
        codeEl.innerHTML = '';
        if (typeof VexFlowLib !== 'undefined' && VexFlowLib.renderToElement) {
          const notes = VexFlowLib.parseMusicalCode(displayCode);
          if (notes.length > 0) {
            let minOctave = 10, maxOctave = 0;
            for (const note of notes) {
              const match = note.match(/[A-Ga-g](\d+)/);
              if (match) {
                const oct = parseInt(match[1]);
                if (oct < minOctave) minOctave = oct;
                if (oct > maxOctave) maxOctave = oct;
              }
            }
            const baseHeight = 340;
            const extraTopSpace = Math.max(0, maxOctave - 8) * 40;
            const extraBottomSpace = Math.max(0, 1 - minOctave) * 40;
            const totalHeight = baseHeight + extraTopSpace + extraBottomSpace;
            const vw = Math.min(window.innerWidth * 0.85, 400);
            const vh = Math.min(window.innerHeight * 0.6, 500);
            const scale = Math.min(vw / 160, vh / totalHeight, 2.5);
            VexFlowLib.renderToElement(codeEl, notes, { 
              width: 160, height: totalHeight, scale, extraTopSpace, extraBottomSpace
            });
          }
        }
      } else {
        codeEl.innerHTML = '';
        renderBalancedCode(codeEl, displayCode, gridKey);
      }
      
      // Hide coordinates when passphrase is active
      if (currentCardCoord && !passphrase) {
        footer.textContent = `${currentCardCoord.lat.toFixed(6)}, ${currentCardCoord.lon.toFixed(6)}`;
      } else {
        footer.textContent = '';
      }
    }
    
    if (gridDef?.display === 'chroma') {
      codeEl = document.createElement('div');
      codeEl.id = 'fs-chroma';
      codeEl.style.cssText = 'display:flex;align-items:center;justify-content:center;';
      
      setTimeout(() => {
        if (typeof RGB111Lib !== 'undefined' && RGB111Lib.generateCanvas) {
          const vmin = Math.min(window.innerWidth, window.innerHeight);
          const displaySize = Math.min(Math.floor(vmin * 0.8), 600);
          fsCanvas = RGB111Lib.generateCanvas(displayCode, { 
            size: displaySize, borderWidth: 0.5, notchSize: 0.5, showChecksum: true
          });
          codeEl.appendChild(fsCanvas);
        }
      }, 10);
      
    } else if (isBarcodeFS) {
      codeEl = document.createElement('div');
      codeEl.id = 'fs-barcode';
      codeEl.style.cssText = 'display:flex;align-items:center;justify-content:center;';
      
      setTimeout(async () => {
        const vmin = Math.min(window.innerWidth, window.innerHeight);
        const displaySize = Math.min(Math.floor(vmin * 0.8), 600);
        if (gridDef?.display === 'datamatrix') {
          if (typeof BarcodeLib !== 'undefined') {
            fsCanvas = BarcodeLib.generateDataMatrixCanvas(withHealpixBarcodeOrder(gridKey, displayCode), { size: displaySize });
            fsCanvas.style.borderRadius = '8px';
            codeEl.appendChild(fsCanvas);
          }
        } else if (gridDef?.display === 'qrbin') {
          if (typeof BarcodeLib !== 'undefined') {
            try { await BarcodeLib.ensureQRGenLoaded(); } catch(e) {}
            fsCanvas = BarcodeLib.generateQRBinaryCanvas(displayCode, { size: displaySize, eccLevel: 'L' });
            fsCanvas.style.borderRadius = '8px';
            codeEl.appendChild(fsCanvas);
          }
        } else {
          // QR codes
          if (typeof BarcodeLib !== 'undefined') {
            try { await BarcodeLib.ensureQRGenLoaded(); } catch(e) {}
            let content = displayCode;
            if (gridDef?.display === 'qrurl') {
              content = BarcodeLib.buildGeosonifyURL(displayCode, null, obfuscated);
            }
            fsCanvas = BarcodeLib.generateQRCanvas(content, { size: displaySize, eccLevel: 'L' });
            fsCanvas.style.borderRadius = '8px';
            codeEl.appendChild(fsCanvas);
          }
        }
      }, 10);
      
    } else if (gridDef?.display === 'music') {
      codeEl = document.createElement('div');
      codeEl.style.cssText = 'background:white;border-radius:12px;padding:16px;display:flex;align-items:center;justify-content:center;';
      
      setTimeout(() => {
        if (typeof VexFlowLib !== 'undefined' && VexFlowLib.renderToElement) {
          const notes = VexFlowLib.parseMusicalCode(displayCode);
          if (notes.length > 0) {
            let minOctave = 10, maxOctave = 0;
            for (const note of notes) {
              const match = note.match(/[A-Ga-g](\d+)/);
              if (match) {
                const oct = parseInt(match[1]);
                if (oct < minOctave) minOctave = oct;
                if (oct > maxOctave) maxOctave = oct;
              }
            }
            const baseHeight = 340;
            const extraTopSpace = Math.max(0, maxOctave - 8) * 40;
            const extraBottomSpace = Math.max(0, 1 - minOctave) * 40;
            const totalHeight = baseHeight + extraTopSpace + extraBottomSpace;
            const vw = Math.min(window.innerWidth * 0.85, 400);
            const vh = Math.min(window.innerHeight * 0.6, 500);
            const scale = Math.min(vw / 160, vh / totalHeight, 2.5);
            VexFlowLib.renderToElement(codeEl, notes, { 
              width: 160, height: totalHeight, scale, extraTopSpace, extraBottomSpace
            });
          } else {
            codeEl.innerHTML = '<div style="color:#888;font-size:18px;padding:40px;">No valid notes</div>';
          }
        }
      }, 10);
      
    } else if (isChessFS) {
      codeEl = document.createElement('div');
      // Fullscreen board: let the fluid board grow to a large square (override the in-card
      // 340px cap). The board sizes off .gschess-boardgrid width, so we widen that here.
      codeEl.style.cssText = 'display:flex;align-items:center;justify-content:center;width:min(86vw,86vh,560px);';
      setTimeout(() => {
        const fmt = gridDef.chessFormat || 'standard';
        try {
          ChessboardLib.renderBoard(displayCode, codeEl, { format: fmt, letters: chessUseLetters });
          const grid = codeEl.querySelector('.gschess-boardgrid');
          if (grid) grid.style.maxWidth = 'none';   // remove the in-card cap for fullscreen
        }
        catch (e) { codeEl.innerHTML = '<div style="color:#888;font-size:16px;">Code too precise for a board</div>'; }
      }, 10);

    } else {
      codeEl = document.createElement('div');
      codeEl.style.cssText = "font-family:'SF Mono',ui-monospace,monospace;font-weight:600;text-align:center;max-width:90vw;";
      renderBalancedCode(codeEl, displayCode, gridKey);
    }
    
    const footer = document.createElement('div');
    footer.style.cssText = 'position:absolute;bottom:40px;font-size:14px;opacity:0.5;transition:opacity 1s;';
    // Hide coordinates when passphrase is active (would compromise security)
    footer.textContent = (currentCardCoord && !passphrase) ? `${currentCardCoord.lat.toFixed(6)}, ${currentCardCoord.lon.toFixed(6)}` : '';
    
    overlay.appendChild(hint);
    overlay.appendChild(codeEl);
    overlay.appendChild(footer);
    document.body.appendChild(overlay);
    
    function onCoordUpdate(e) {
      if (e.detail && e.detail.gridKey === gridKey && e.detail.code) {
        refreshDisplay(e.detail.code);
      }
    }
    window.addEventListener('geosonify:coordUpdate', onCoordUpdate);
    
    setTimeout(() => {
      hint.style.opacity = '0';
      footer.style.opacity = '0.25';
    }, 5000);
    
    let pressTimer = null, copied = false;
    const startPress = () => {
      copied = false;
      pressTimer = setTimeout(async () => {
        if (gridDef?.display === 'chroma' && fsCanvas && typeof RGB111Lib !== 'undefined') {
          try {
            const hiResCanvas = RGB111Lib.generateCanvas(displayCode, { 
              size: 1024, borderWidth: 0.5, notchSize: 0.5, showChecksum: true 
            });
            hiResCanvas.toBlob(async (blob) => {
              if (blob) {
                try {
                  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                  showToast('Image copied!');
                } catch (e) {
                  await navigator.clipboard.writeText(displayCode);
                  showToast('Code copied');
                }
              }
            }, 'image/png');
          } catch (e) {
            await navigator.clipboard.writeText(displayCode);
            showToast('Copied!');
          }
        } else if (isBarcodeFS && typeof BarcodeLib !== 'undefined') {
          try {
            let hiResCanvas;
            if (gridDef?.display === 'datamatrix') {
              await BarcodeLib.ensureBwipLoaded();
              hiResCanvas = BarcodeLib.generateDataMatrixCanvas(withHealpixBarcodeOrder(gridKey, displayCode), { size: 1024 });
            } else if (gridDef?.display === 'qrbin') {
              await BarcodeLib.ensureQRGenLoaded();
              hiResCanvas = BarcodeLib.generateQRBinaryCanvas(displayCode, { size: 1024, eccLevel: 'L' });
            } else {
              await BarcodeLib.ensureQRGenLoaded();
              let content = displayCode;
              if (gridDef?.display === 'qrurl') {
                content = BarcodeLib.buildGeosonifyURL(displayCode, null, obfuscated);
              }
              hiResCanvas = BarcodeLib.generateQRCanvas(content, { size: 1024, eccLevel: 'L' });
            }
            const blob = await new Promise(resolve => hiResCanvas.toBlob(resolve, 'image/png'));
            if (blob) {
              // Try clipboard
              if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
                try {
                  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                  showToast('Image copied!');
                  return;
                } catch (e) { /* fall through */ }
              }
              // Try share
              if (navigator.share && navigator.canShare) {
                const file = new File([blob], `${gridKey}-${displayCode.slice(0,8)}.png`, { type: 'image/png' });
                const shareData = { files: [file] };
                if (navigator.canShare(shareData)) {
                  try { await navigator.share(shareData); return; } catch (e) { /* fall through */ }
                }
              }
              // Download fallback
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${gridKey}-${displayCode.slice(0,8)}.png`;
              document.body.appendChild(a); a.click(); document.body.removeChild(a);
              URL.revokeObjectURL(url);
              showToast('Image downloaded');
              return;
            }
          } catch (e) {
            await navigator.clipboard.writeText(displayCode);
            showToast('Copied!');
          }
        } else {
          await navigator.clipboard.writeText(displayCode);
          showToast('Copied!');
        }
        copied = true;
      }, 600);
    };
    
    const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    const exit = () => { 
      if (!copied) {
        window.removeEventListener('geosonify:coordUpdate', onCoordUpdate);
        overlay.remove(); 
      }
    };
    
    overlay.addEventListener('mousedown', startPress);
    overlay.addEventListener('touchstart', (e) => { e.stopPropagation(); startPress(); }, { passive: false });
    overlay.addEventListener('mouseup', () => { cancelPress(); exit(); });
    overlay.addEventListener('touchend', (e) => { e.stopPropagation(); cancelPress(); exit(); });
    // Prevent any touch-through
    overlay.addEventListener('click', (e) => { e.stopPropagation(); });
    overlay.addEventListener('touchmove', (e) => { e.stopPropagation(); }, { passive: false });
  }
  
  function show3x3Grid(gridKey, centerCode) {
    const codes = get3x3Codes(gridKey, centerCode);
    const gridDef = CARD_GRIDS[gridKey];
    const isEmoji = gridDef?.display === 'emoji';
    const isChroma = gridDef?.display === 'chroma';
    const isBarcode3x3 = (gridDef?.display === 'qrhex' || gridDef?.display === 'qrbin' || gridDef?.display === 'qrurl' || gridDef?.display === 'datamatrix');
    const isWordBased = gridDef?.prefixLength || gridKey === 'nato' || gridKey === 'bytewords';
    const delimiter = gridDef?.delimiter;
    const checksumOn = !!gridDef?.prefixLength;
    
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:#000;color:#fff;z-index:2000;display:flex;flex-direction:column;align-items:center;justify-content:center;touch-action:none;';
    
    const hint = document.createElement('div');
    hint.style.cssText = 'position:absolute;top:20px;font-size:12px;opacity:0.35;transition:opacity 1s;';
    hint.textContent = 'Tap cell to copy code • Long-press centre for all 9 codes';
    
    const vmin = Math.min(window.innerWidth, window.innerHeight);
    const gridSize = Math.min(vmin * 0.95, 800);
    
    const grid = document.createElement('div');
    grid.style.cssText = `display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:6px;width:${gridSize}px;height:${gridSize}px;position:relative;`;
    
    let baseFontSize = 3;
    let maxCharsPerLine = 6;
    
    if (!isChroma) {
      const maxLen = Math.max(...codes.filter(c => c.code).map(c => c.code.length));
      if (isEmoji) {
        const maxEmoji = Math.max(...codes.filter(c => c.code).map(c => parseEmoji(c.code).length));
        baseFontSize = Math.min(8, Math.max(3.5, 22 / Math.max(1, maxEmoji)));
        maxCharsPerLine = 3;
      } else {
        if (maxLen > 40) { baseFontSize = 1.8; maxCharsPerLine = 12; }
        else if (maxLen > 30) { baseFontSize = 2.0; maxCharsPerLine = 10; }
        else if (maxLen > 20) { baseFontSize = 2.3; maxCharsPerLine = 8; }
        else if (maxLen > 12) { baseFontSize = 2.8; maxCharsPerLine = 7; }
        else { baseFontSize = 3.5; maxCharsPerLine = 6; }
      }
    }
    
    const dirLabels = ['NW', 'N', 'NE', 'W', '', 'E', 'SW', 'S', 'SE'];
    
    codes.forEach((item, idx) => {
      const cell = document.createElement('div');
      const isCenter = item.isCenter;
      cell.style.cssText = `display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,${isCenter ? 0.1 : 0.02});position:relative;overflow:hidden;`;
      if (isCenter) {
        cell.style.outline = '2px solid rgba(255,255,255,0.5)';
        cell.style.outlineOffset = '-2px';
      }
      
      const label = dirLabels[idx];
      if (label) {
        const labelEl = document.createElement('div');
        labelEl.style.cssText = 'position:absolute;font-size:11px;opacity:0.4;';
        if (idx === 0) { labelEl.style.top = '4px'; labelEl.style.left = '4px'; }
        else if (idx === 2) { labelEl.style.top = '4px'; labelEl.style.right = '4px'; }
        else if (idx === 6) { labelEl.style.bottom = '4px'; labelEl.style.left = '4px'; }
        else if (idx === 8) { labelEl.style.bottom = '4px'; labelEl.style.right = '4px'; }
        else if (idx === 1) { labelEl.style.top = '4px'; labelEl.style.left = '50%'; labelEl.style.transform = 'translateX(-50%)'; }
        else if (idx === 7) { labelEl.style.bottom = '4px'; labelEl.style.left = '50%'; labelEl.style.transform = 'translateX(-50%)'; }
        else if (idx === 3) { labelEl.style.left = '4px'; labelEl.style.top = '50%'; labelEl.style.transform = 'translateY(-50%)'; }
        else if (idx === 5) { labelEl.style.right = '4px'; labelEl.style.top = '50%'; labelEl.style.transform = 'translateY(-50%)'; }
        labelEl.textContent = label;
        cell.appendChild(labelEl);
      }
      
      if (item.code) {
        if (isChroma && typeof RGB111Lib !== 'undefined' && RGB111Lib.generateCanvas) {
          const cellSize = Math.floor(gridSize / 3 - 6);
          const canvas = RGB111Lib.generateCanvas(item.code, {
            size: cellSize, borderWidth: 0.5, notchSize: 0.5, showChecksum: true
          });
          canvas.style.width = '100%';
          canvas.style.height = '100%';
          canvas.style.objectFit = 'contain';
          cell.appendChild(canvas);
        } else if (isBarcode3x3 && typeof BarcodeLib !== 'undefined') {
          const cellSize = Math.floor(gridSize / 3 - 6);
          let canvas;
          if (gridDef?.display === 'datamatrix') {
            canvas = BarcodeLib.generateDataMatrixCanvas(withHealpixBarcodeOrder(gridKey, item.code), { size: cellSize });
          } else if (gridDef?.display === 'qrbin') {
            canvas = BarcodeLib.generateQRBinaryCanvas(item.code, { size: cellSize, eccLevel: 'L' });
          } else {
            let content = item.code;
            if (gridDef?.display === 'qrurl') {
              content = BarcodeLib.buildGeosonifyURL(item.code, null, obfuscated);
            }
            canvas = BarcodeLib.generateQRCanvas(content, { size: cellSize, eccLevel: 'L' });
          }
          if (canvas) {
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            canvas.style.objectFit = 'contain';
            cell.appendChild(canvas);
          }
        } else {
          const codeEl = document.createElement('div');
          codeEl.style.cssText = `font-family:'SF Mono',ui-monospace,monospace;font-weight:500;text-align:center;line-height:1.2;`;
          
          // Split into words for vertical display
          let words = [];
          let checksumValue = null;
          
          if (isWordBased && item.code) {
            if (delimiter) {
              words = item.code.split(delimiter).filter(w => w.length > 0);
            } else if (typeof GeoCodec !== 'undefined') {
              // Chinese - tokenize
              const shuffled = getShuffledGrid(gridKey);
              if (shuffled && shuffled.grid) {
                const flat = shuffled.grid.flat();
                words = GeoCodec.tokenizeCode(item.code, flat) || [item.code];
              } else {
                words = [item.code];
              }
            } else {
              words = [item.code];
            }
            
            if (checksumOn) {
              const codeForChecksum = delimiter ? item.code.split(delimiter).join('') : item.code;
              checksumValue = computeChecksumNumeric(codeForChecksum, gridKey);
            }
          } else {
            words = [item.code];
          }
          
          // Calculate font size to fit all words in cell
          // Cell is roughly gridSize/3 - need to fit words.length + 1 lines (if checksum)
          const numLines = words.length + (checksumValue ? 1 : 0);
          const maxWordLen = Math.max(...words.map(w => w.length));
          // Scale font based on number of lines and longest word
          const cellFontSize = Math.min(
            baseFontSize,
            baseFontSize * 4 / numLines,  // Scale down for more lines
            baseFontSize * 8 / maxWordLen  // Scale down for longer words
          );
          codeEl.style.fontSize = `${Math.max(1.2, cellFontSize)}vw`;
          
          // Build vertical display - each word on own line
          let html = words.map(w => `<div>${w}</div>`).join('');
          if (checksumValue) {
            html += `<div style="font-size:0.8em;opacity:0.5;margin-top:2px">${checksumValue}</div>`;
          }
          
          codeEl.innerHTML = html;
          cell.appendChild(codeEl);
        }
      } else {
        const emptyEl = document.createElement('div');
        emptyEl.style.cssText = 'color:#444;font-size:20px;';
        emptyEl.textContent = '—';
        cell.appendChild(emptyEl);
      }
      
      cell.onclick = (e) => {
        e.stopPropagation();
        if (item.code) {
          // Copy full code with checksum if enabled
          let copyCode = item.code;
          if (isWordBased && checksumOn) {
            const codeForChecksum = delimiter ? item.code.split(delimiter).join('') : item.code;
            copyCode = `${item.code}.${computeChecksumNumeric(codeForChecksum, gridKey)}`;
          }
          navigator.clipboard.writeText(copyCode);
          showToast(`Copied ${item.label || 'center'}!`);
        }
      };
      
      grid.appendChild(cell);
    });
    
    // Location dot
    const locationDot = document.createElement('div');
    locationDot.style.cssText = `position:absolute;width:12px;height:12px;background:rgba(255,80,80,0.9);border-radius:50%;border:2px solid rgba(255,255,255,0.9);transform:translate(-50%,-50%);z-index:100;pointer-events:none;box-shadow:0 0 8px rgba(255,80,80,0.8);display:none;`;
    grid.appendChild(locationDot);
    
    // Position dot in center cell
    if (currentCardCoord) {
      const shuffled = getShuffledGrid(gridKey);
      if (shuffled) {
        const grid2D = shuffled.grid;
        const flat = grid2D.flat();
        const tokens = [];
        let remaining = centerCode;
        while (remaining.length > 0) {
          let found = false;
          for (const sym of flat) {
            if (remaining.startsWith(sym)) { tokens.push(sym); remaining = remaining.slice(sym.length); found = true; break; }
          }
          if (!found) break;
        }
        if (tokens.length > 0) {
          const rows = grid2D.length;
          const cols = grid2D[0].length;
          
          let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
          for (const token of tokens) {
            const i = flat.indexOf(token);
            if (i < 0) break;
            const r = Math.floor(i / cols);
            const c = i % cols;
            const dLat = (latMax - latMin) / rows;
            const dLon = (lonMax - lonMin) / cols;
            latMax = latMax - r * dLat;
            latMin = latMax - dLat;
            lonMin = lonMin + c * dLon;
            lonMax = lonMin + dLon;
          }
          
          const xRatio = Math.max(0, Math.min(1, (currentCardCoord.lon - lonMin) / (lonMax - lonMin)));
          const yRatio = Math.max(0, Math.min(1, 1 - (currentCardCoord.lat - latMin) / (latMax - latMin)));
          
          const cellWidth = gridSize / 3;
          const cellHeight = gridSize / 3;
          const dotX = cellWidth + (xRatio * cellWidth);
          const dotY = cellHeight + (yRatio * cellHeight);
          
          locationDot.style.left = dotX + 'px';
          locationDot.style.top = dotY + 'px';
          locationDot.style.display = 'block';
        }
      }
    }
    
    const footer = document.createElement('div');
    footer.style.cssText = 'position:absolute;bottom:20px;font-size:14px;opacity:0.5;transition:opacity 1s;';
    // Hide coordinates when passphrase is active
    footer.textContent = (currentCardCoord && !passphrase) ? `${currentCardCoord.lat.toFixed(6)}, ${currentCardCoord.lon.toFixed(6)}` : '';
    
    overlay.appendChild(hint);
    overlay.appendChild(grid);
    overlay.appendChild(footer);
    document.body.appendChild(overlay);
    
    setTimeout(() => { hint.style.opacity = '0'; }, 5000);
    
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    // Prevent touch-through
    overlay.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: false });
    overlay.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: false });
    overlay.addEventListener('touchend', (e) => e.stopPropagation(), { passive: false });
    
    // Long press center to copy all
    const centerCell = grid.children[4];
    let longTimer = null;
    const startLong = () => {
      longTimer = setTimeout(() => {
        const allCodes = codes.filter(c => c.code).map(c => `${c.label || '•'}: ${c.code}`).join('\n');
        navigator.clipboard.writeText(allCodes);
        showToast('Copied all 9!');
      }, 600);
    };
    const cancelLong = () => { if (longTimer) clearTimeout(longTimer); };
    
    centerCell.addEventListener('mousedown', startLong);
    centerCell.addEventListener('mouseup', cancelLong);
    centerCell.addEventListener('touchstart', startLong, { passive: true });
    centerCell.addEventListener('touchend', cancelLong);
  }
  
  function get3x3Codes(gridKey, centerCode) {
    const directions = [
      { dRow: 1, dCol: -1, label: 'NW' },
      { dRow: 1, dCol: 0, label: 'N' },
      { dRow: 1, dCol: 1, label: 'NE' },
      { dRow: 0, dCol: -1, label: 'W' },
      { dRow: 0, dCol: 0, label: '•' },
      { dRow: 0, dCol: 1, label: 'E' },
      { dRow: -1, dCol: -1, label: 'SW' },
      { dRow: -1, dCol: 0, label: 'S' },
      { dRow: -1, dCol: 1, label: 'SE' }
    ];
    
    return directions.map(d => ({
      code: d.dRow === 0 && d.dCol === 0 ? centerCode : getAdjacentCodeViaCoords(gridKey, centerCode, d.dRow, d.dCol),
      label: d.label,
      isCenter: d.dRow === 0 && d.dCol === 0
    }));
  }
  
  function getAdjacentCodeViaCoords(gridKey, centerCode, dRow, dCol) {
    const gridDef = CARD_GRIDS[gridKey];
    if (!gridDef || !gridDef.grid) return null;
    
    const shuffled = getShuffledGrid(gridKey);
    const grid2D = shuffled.grid;
    const flat = grid2D.flat();
    const rows = grid2D.length;
    const cols = grid2D[0].length;
    
    const tokens = [];
    let remaining = centerCode;
    while (remaining.length > 0) {
      let found = false;
      for (const sym of flat) {
        if (remaining.startsWith(sym)) {
          tokens.push(sym);
          remaining = remaining.slice(sym.length);
          found = true;
          break;
        }
      }
      if (!found) break;
    }
    if (tokens.length === 0) return null;
    
    let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
    for (const token of tokens) {
      const idx = flat.indexOf(token);
      if (idx < 0) return null;
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      const dLat = (latMax - latMin) / rows;
      const dLon = (lonMax - lonMin) / cols;
      latMax = latMax - r * dLat;
      latMin = latMax - dLat;
      lonMin = lonMin + c * dLon;
      lonMax = lonMin + dLon;
    }
    
    const lastDLat = (latMax - latMin);
    const lastDLon = (lonMax - lonMin);
    
    const adjCenterLat = (latMin + latMax) / 2 + dRow * lastDLat;
    const adjCenterLon = (lonMin + lonMax) / 2 + dCol * lastDLon;
    
    const wrappedLon = ((adjCenterLon + 180) % 360 + 360) % 360 - 180;
    const clampedLat = Math.max(-89.999, Math.min(89.999, adjCenterLat));
    
    return encodeCardCoordinate(gridKey, clampedLat, wrappedLon, tokens.length);
  }
  
  function showCellInfo(gridKey, code, iterations, uncertaintyLine) {
    const gridDef = CARD_GRIDS[gridKey];
    if (!gridDef || !gridDef.grid || !currentCardCoord) return;

    const shuffled = getShuffledGrid(gridKey);
    const grid2D = shuffled.grid;
    const dms = GeoCodec.gridDims(grid2D);
    const rows = dms.rows, cols = dms.cols;
    const flat = grid2D.flat();

    // Cell bounds for an arbitrary iteration count, walking from the code's tokens.
    // For levels beyond the current code length we extend by re-encoding the pin.
    function boundsAtLevel(nIter) {
      let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
      // Encode the pin to nIter to get the cell path (raw, obfuscation-independent)
      let raw = '';
      if (typeof GeoCodec !== 'undefined' && GeoCodec.encodeHierarchical) {
        raw = GeoCodec.encodeHierarchical(currentCardCoord.lat, currentCardCoord.lon, grid2D, nIter);
      }
      const toks = GeoCodec.tokenizeCode(raw, flat);
      if (toks) {
        for (let i = 0; i < toks.length && i < nIter; i++) {
          const idx = flat.indexOf(toks[i]);
          if (idx < 0) break;
          const r = Math.floor(idx / cols), c = idx % cols;
          const b = GeoCodec.boundsForCell(rows, cols, r, c, latMin, latMax, lonMin, lonMax);
          latMin = b.latMin; latMax = b.latMax; lonMin = b.lonMin; lonMax = b.lonMax;
        }
      }
      return { latMin, latMax, lonMin, lonMax };
    }

    function dimsText(b) {
      const cLat = (b.latMin + b.latMax) / 2;
      const h = (b.latMax - b.latMin) * 111319.9;
      const w = (b.lonMax - b.lonMin) * 111319.9 * Math.cos(cLat * Math.PI / 180);
      return `${formatMetric(w)} × ${formatMetric(h)}`;
    }

    // Build the ladder: a window of levels around the current one.
    // Fixed-precision grids (e.g. ChromaCoord) have no +/- stepper, so a ladder
    // is misleading — show only the single level the card is locked to.
    const isFixedPrecision = gridDef.fixedIterations !== undefined;
    const maxIter = gridDef.maxIterations || (iterations + 2);
    const minIter = gridDef.minIterations || 1;
    const loadStart = isFixedPrecision ? iterations : Math.max(minIter, iterations - 3);
    const loadEnd = isFixedPrecision ? iterations : Math.min(maxIter, iterations + 2);
    const levels = [];
    for (let it = loadStart; it <= loadEnd; it++) {
      const b = boundsAtLevel(it);
      // Sample code at this level (display form, honouring current obfuscation)
      let sample = encodeCardCoordinate(gridKey, currentCardCoord.lat, currentCardCoord.lon, it);
      // ChromaCoord displays the colour-string spelling, not hex — match it here.
      if (gridDef.display === 'chroma' && typeof RGB111Lib !== 'undefined' && RGB111Lib.hexToColorString
          && /^[0-9A-Fa-f]{12}$/.test((sample || '').split('.')[0])) {
        sample = RGB111Lib.hexToColorString(sample.split('.')[0], 'ink');
      }
      levels.push({
        label: `${it} char${it === 1 ? '' : 's'}`,
        code: sample,
        dims: dimsText(b),
        here: it === iterations
      });
    }

    // Detail for the current level
    const cur = boundsAtLevel(iterations);
    const cLat = (cur.latMin + cur.latMax) / 2, cLon = (cur.lonMin + cur.lonMax) / 2;
    const heightM = (cur.latMax - cur.latMin) * 111319.9;
    const widthM = (cur.lonMax - cur.lonMin) * 111319.9 * Math.cos(cLat * Math.PI / 180);
    let errorM = null;
    if (typeof geodesic !== 'undefined' && geodesic.Geodesic) {
      errorM = geodesic.Geodesic.WGS84.Inverse(currentCardCoord.lat, currentCardCoord.lon, cLat, cLon).s12;
    }
    const totalCells = Math.pow(rows * cols, iterations);

    const detail = {
      corners: [[cur.latMax, cur.lonMin], [cur.latMax, cur.lonMax], [cur.latMin, cur.lonMax], [cur.latMin, cur.lonMin]],
      widthM, heightM,
      centroid: [cLat, cLon],
      errorM,
      coverage: isFinite(totalCells) ? totalCells : null,
      coverageLabel: `${iterations} iteration${iterations === 1 ? '' : 's'}`
    };

    if (typeof GISGrids !== 'undefined' && GISGrids.renderResolutionPopup) {
      const baseNote = isFixedPrecision
          ? 'Fixed precision — ' + (rows * cols) + ' colours, ' + iterations + ' cells. Each cell refines the location ' + (rows * cols) + '× (a ' + cols + '×' + rows + ' split).'
          : 'Hierarchical — each character refines the cell ' + (rows * cols) + '× (a ' + cols + '×' + rows + ' split).';
      GISGrids.renderResolutionPopup({
        title: gridDef.name,
        subtitle: isFixedPrecision ? 'cell size' : 'resolution levels',
        note: baseNote,
        uncertaintyLine: uncertaintyLine || null,
        levels,
        detail
      });
    }
  }
  
  function shareCard(gridKey, code) {
    // GIS reference cards: the code is itself a portable, universal location
    // reference (that's the point of these standards), so share/copy the code.
    const gd = CARD_GRIDS[gridKey];
    if (gd && gd.gis) {
      const label = `${gd.name}: ${code}`;
      if (navigator.share) {
        navigator.share({ title: 'Geosonify Location', text: label })
          .catch(() => navigator.clipboard.writeText(code).then(() => showToast('Code copied!')).catch(() => showToast('Copy failed')));
      } else {
        navigator.clipboard.writeText(code).then(() => showToast('Code copied!')).catch(() => showToast('Copy failed'));
      }
      return;
    }
    // QR-URL card: share the actual Geosonify URL (the whole point of this card)
    if (gridKey === 'qrurl' && typeof BarcodeLib !== 'undefined') {
      const shareURL = BarcodeLib.buildGeosonifyURL(code, null, obfuscated);
      if (navigator.share) {
        navigator.share({ title: 'Geosonify Location', url: shareURL }).catch(() => {
          navigator.clipboard.writeText(shareURL).then(() => showToast('URL copied!')).catch(() => showToast('Copy failed'));
        });
      } else {
        navigator.clipboard.writeText(shareURL).then(() => showToast('URL copied!')).catch(() => showToast('Copy failed'));
      }
      return;
    }

    const prefixMap = {
      alphanumeric: 'a', emoji: 'e', hexbyte: 'h', chromacoord: 'c',
      music: 'm', nato: 'n', bip39english: 'bip', bytewords: 'bw', 
      bytewordsmin: 'bm', byteemoji: 'be', base64: 'b64',
      bip39spanish: 'bipes', bip39french: 'bipfr', bip39italian: 'bipit',
      bip39portuguese: 'bippt', bip39czech: 'bipcs', bip39japanese: 'bipja',
      bip39korean: 'bipko', bip39chinesesimplified: 'bipzhs', bip39chinesetraditional: 'bipzht',
      qrhex: 'h', datamatrix: 'h'  // barcode hex cards use hexbyte param
    };
    let prefix = prefixMap[gridKey];
    if (!prefix) {
      // Custom grid — use z.GridName format
      const gridDef = CARD_GRIDS[gridKey];
      if (gridDef && gridDef.isCustom && gridDef.name) {
        const safeName = gridDef.name.replace(/[^a-zA-Z0-9_\-]/g, '_');
        prefix = 'z.' + safeName;
        const flags = (obfuscated ? 'o' : '');
        if (flags) prefix = prefix + '.' + flags;
      } else {
        prefix = 'r'; // fallback to raw
      }
    } else {
      if (obfuscated) prefix = prefix + 'o';
    }
    
    const baseURL = window.location.origin + window.location.pathname;
    const shareURL = `${baseURL}?${prefix}=${encodeURIComponent(code)}`;
    
    if (navigator.share) {
      navigator.share({
        title: 'Geosonify Location',
        url: shareURL
      }).catch(() => {
        navigator.clipboard.writeText(shareURL).then(() => {
          showToast('URL copied!');
        }).catch(() => {
          showToast('Copy failed');
        });
      });
    } else {
      navigator.clipboard.writeText(shareURL).then(() => {
        showToast('URL copied!');
      }).catch(() => {
        showToast('Copy failed');
      });
    }
  }
  
  function showEditCodeModal(gridKey, currentCode) {
    // GIS reference grids (Plus Codes, MGRS, UTM, …) have their own engine
    // with no grid-shuffle or obfuscation. Deobfuscate / Enter Passphrase
    // are meaningless here and would imply a false sense of security, so
    // they're hidden for GIS cards.
    const _gd = CARD_GRIDS[gridKey];
    const isGis = !!(_gd && _gd.gis);
    
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;';
    // For ChromaCoord, pre-fill the editable field with the colour-string
    // spelling the user sees on the card (they can also paste hex — decode
    // accepts either).
    let prefillCode = currentCode;
    if (_gd && _gd.display === 'chroma' && typeof RGB111Lib !== 'undefined' && RGB111Lib.hexToColorString) {
      const hexOnly = (currentCode || '').toString().split('.')[0];
      if (/^[0-9A-Fa-f]{12}$/.test(hexOnly)) prefillCode = RGB111Lib.hexToColorString(hexOnly, 'ink');
    }
    
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:white;border-radius:12px;padding:20px;max-width:90vw;width:360px;';
    dialog.innerHTML = `
      <h3 style="margin:0 0 12px;font-size:18px;">Edit Code</h3>
      <input type="text" id="editCodeInput" value="${prefillCode}" style="width:100%;padding:10px;font-size:16px;font-family:'SF Mono',monospace;border:1px solid #ccc;border-radius:8px;box-sizing:border-box;">
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button id="decodeBtn" style="flex:1;padding:10px;border-radius:8px;border:1px solid #007AFF;background:#007AFF;color:white;font-size:15px;cursor:pointer;">Decode</button>
        ${isGis ? '' : '<button id="deobfuscateBtn" style="flex:1;padding:10px;border-radius:8px;border:1px solid #5856D6;background:#5856D6;color:white;font-size:15px;cursor:pointer;">Deobfuscate</button>'}
      </div>
      ${isGis ? '' : '<button id="passphraseDecodeBtn" style="width:100%;padding:10px;margin-top:8px;border-radius:8px;border:1px solid #FF9500;background:#FF9500;color:white;font-size:15px;cursor:pointer;">🔑 Enter Passphrase</button>'}
      <button id="cancelEditBtn" style="width:100%;padding:10px;margin-top:8px;border-radius:8px;border:1px solid #ccc;background:#f5f5f5;font-size:15px;cursor:pointer;">Cancel</button>
    `;
    modal.appendChild(dialog);
    document.body.appendChild(modal);
    
    const input = dialog.querySelector('#editCodeInput');
    input.select();
    
    dialog.querySelector('#cancelEditBtn').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    
    const passphraseDecodeBtnEl = dialog.querySelector('#passphraseDecodeBtn');
    if (passphraseDecodeBtnEl) passphraseDecodeBtnEl.onclick = () => {
      const code = input.value.trim();
      if (!code) return;
      modal.remove();
      showPassphraseDecodeModal(gridKey, code);
    };
    
    dialog.querySelector('#decodeBtn').onclick = () => {
      let code = input.value.trim();
      if (!code) return;
      // Music codes use comma-delimited, prefix-ambiguous tokens (F, FG, FGB…);
      // a trailing comma closes off the final token. Normalize so the user
      // doesn't have to remember to type it.
      if (CARD_GRIDS[gridKey]?.display === 'music') code = code.replace(/,\s*$/, '') + ',';
      // ChromaCoord accepts its colour-string spelling (slash or ink form) as
      // well as raw hex; convert to hex before decoding.
      if (CARD_GRIDS[gridKey]?.display === 'chroma' && typeof RGB111Lib !== 'undefined'
          && RGB111Lib.looksLikeColorString(code)) {
        const h = RGB111Lib.colorStringToHex(code);
        if (h) code = h;
      }
      const result = decodeCardCode(gridKey, code, false);
      if (result) {
        if (callbacks.onUserInteraction) callbacks.onUserInteraction();
        setCoordinate(result[0], result[1]);
        const map = callbacks.getMap ? callbacks.getMap() : null;
        if (map) map.panTo([result[0], result[1]]);
        modal.remove();
        
        // Show checksum validation if applicable
        if (result.checksumValid === true) {
          showToast('✓ Checksum valid!', 'success');
        } else if (result.checksumValid === false) {
          showToast('✗ Invalid checksum!', 'error');
        }
        
        showDecodeBanner(gridKey, code, result[0], result[1]);
      } else {
        showToast('Invalid code');
      }
    };
    
    const deobfuscateBtnEl = dialog.querySelector('#deobfuscateBtn');
    if (deobfuscateBtnEl) deobfuscateBtnEl.onclick = () => {
      let code = input.value.trim();
      if (!code) return;
      if (CARD_GRIDS[gridKey]?.display === 'music') code = code.replace(/,\s*$/, '') + ',';
      if (CARD_GRIDS[gridKey]?.display === 'chroma' && typeof RGB111Lib !== 'undefined'
          && RGB111Lib.looksLikeColorString(code)) {
        const h = RGB111Lib.colorStringToHex(code);
        if (h) code = h;
      }
      const result = decodeCardCode(gridKey, code, true);
      if (result) {
        if (callbacks.onUserInteraction) callbacks.onUserInteraction();
        setCoordinate(result[0], result[1]);
        const map = callbacks.getMap ? callbacks.getMap() : null;
        if (map) map.panTo([result[0], result[1]]);
        modal.remove();
        
        // Show checksum validation if applicable
        if (result.checksumValid === true) {
          showToast('✓ Checksum valid!', 'success');
        } else if (result.checksumValid === false) {
          showToast('✗ Invalid checksum!', 'error');
        }
        
        showDecodeBanner(gridKey, code, result[0], result[1]);
      } else {
        showToast('Invalid code');
      }
    };
  }
  
  function showPassphraseDecodeModal(gridKey, code) {
    const tildeIdx = code.indexOf('~');
    const hasTilde = tildeIdx > 0;
    const centroidCode = hasTilde ? code.substring(0, tildeIdx) : code;
    const shapeSuffix = hasTilde ? code.substring(tildeIdx) : '';
    // Detect ALL delta path formats (not just fixed-width d5=)
    const suffixAfterTilde = hasTilde ? code.substring(tildeIdx + 1) : '';
    const isDeltaFixedWidth = /^d\d=/.test(suffixAfterTilde);
    const isGearChange = /^d+[0-9A-Fa-f]/.test(suffixAfterTilde) && !suffixAfterTilde.includes('=');
    const hasMultipleTildes = (shapeSuffix.match(/~/g) || []).length > 1;
    const isDeltaPath = isDeltaFixedWidth || isGearChange || hasMultipleTildes;
    
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;';
    
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:white;border-radius:12px;padding:20px;max-width:90vw;width:360px;';
    dialog.innerHTML = `
      <h3 style="margin:0 0 12px;font-size:18px;">Decode with Passphrase</h3>
      <p style="font-size:14px;color:#666;margin:0 0 12px;">Code: <code style="font-family:monospace;background:#f0f0f0;padding:2px 6px;border-radius:4px;">${centroidCode.length > 20 ? centroidCode.substring(0, 20) + '...' : centroidCode}</code></p>
      <input type="text" id="passphraseDecodeInput" placeholder="Enter passphrase..." style="width:100%;padding:10px;font-size:16px;border:1px solid #ccc;border-radius:8px;box-sizing:border-box;margin-bottom:12px;">
      <button id="decodeWithPassBtn" style="width:100%;padding:10px;border-radius:8px;border:1px solid #FF9500;background:#FF9500;color:white;font-size:15px;cursor:pointer;">Decode</button>
      <button id="cancelPassBtn" style="width:100%;padding:10px;margin-top:8px;border-radius:8px;border:1px solid #ccc;background:#f5f5f5;font-size:15px;cursor:pointer;">Cancel</button>
    `;
    modal.appendChild(dialog);
    document.body.appendChild(modal);
    
    const input = dialog.querySelector('#passphraseDecodeInput');
    input.focus();
    
    dialog.querySelector('#cancelPassBtn').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    
    dialog.querySelector('#decodeWithPassBtn').onclick = () => {
      const tempPassphrase = input.value;
      
      const oldPassphrase = passphrase;
      passphrase = tempPassphrase;
      clearGridCache();
      
      const result = decodeCardCode(gridKey, centroidCode, false);
      
      if (result) {
        if (callbacks.onUserInteraction) callbacks.onUserInteraction();
        setCoordinate(result[0], result[1]);
        updatePassphraseUI();
        
        if (hasTilde) {
          const redrawInput = document.getElementById('redrawString');
          if (redrawInput) {
            if (isDeltaPath) {
              redrawInput.value = code;
            } else {
              const rawCentroid = `${result[0].toFixed(6)},${result[1].toFixed(6)}`;
              redrawInput.value = rawCentroid + shapeSuffix;
            }
            if (typeof redrawFromString === 'function') {
              redrawFromString();
            }
            if (typeof switchToTab === 'function') {
              switchToTab('output');
            }
          }
        } else {
          const map = callbacks.getMap ? callbacks.getMap() : null;
          if (map) map.panTo([result[0], result[1]]);
        }
        modal.remove();
        showDecodeBanner(gridKey, code, result[0], result[1]);
      } else {
        passphrase = oldPassphrase;
        clearGridCache();
        showToast('Decode failed - check code format');
      }
    };
  }
  
  function showDecodeBanner(gridKey = null, code = null, decodedLat = null, decodedLon = null) {
    document.querySelectorAll('.decode-banner').forEach(b => b.remove());
    
    const banner = document.createElement('div');
    banner.className = 'decode-banner';
    
    const switchBtnText = obfuscated ? 'Switch to Hierarchical' : 'Switch to Obfuscated';
    
    // Show coordinates if available, with Open in Maps button
    const hasCoords = decodedLat !== null && decodedLon !== null;
    const coordsHtml = hasCoords 
      ? `<span style="font-family:monospace;font-size:12px;opacity:0.8;">${decodedLat.toFixed(6)}, ${decodedLon.toFixed(6)}</span>
         <button class="open-maps-btn" style="background:#34C759;border:none;color:white;font-size:14px;cursor:pointer;padding:4px 10px;border-radius:12px;margin-left:6px;display:inline-flex;align-items:center;gap:5px;">${ICONS.map}<span>Maps</span></button>`
      : `<span style="display:inline-flex;align-items:center;gap:4px;">${ICONS.pin}<span>Not where you expected? </span></span>`;
    
    banner.innerHTML = `
      ${coordsHtml}
      <button class="try-passphrase-btn" style="background:#FF9500;border:none;color:white;font-size:14px;cursor:pointer;padding:4px 10px;border-radius:12px;margin-left:6px;">Try passphrase</button>
      <button class="switch-mode-btn" style="background:#5856D6;border:none;color:white;font-size:14px;cursor:pointer;padding:4px 10px;border-radius:12px;margin-left:6px;">${switchBtnText}</button>
      <button class="close-btn" style="background:none;border:none;color:white;font-size:18px;cursor:pointer;margin-left:10px;">×</button>
    `;
    banner.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:white;padding:10px 16px;border-radius:20px;font-size:14px;z-index:1500;display:flex;align-items:center;flex-wrap:wrap;gap:6px;justify-content:center;';
    
    banner.querySelector('.close-btn').onclick = () => banner.remove();
    
    // Open in Maps button handler
    const openMapsBtn = banner.querySelector('.open-maps-btn');
    if (openMapsBtn && hasCoords) {
      openMapsBtn.onclick = () => {
        openInMaps(decodedLat, decodedLon, 'Decoded Location');
      };
    }
    
    banner.querySelector('.switch-mode-btn').onclick = () => {
      banner.remove();
      obfuscated = !obfuscated;
      const obfBtn = document.getElementById('obfuscateBtn');
      if (obfBtn) obfBtn.textContent = obfuscated ? '🔀 Obfuscated' : '🔀 Hierarchical';
      const obfWarning = document.getElementById('obfWarning');
      if (obfWarning) obfWarning.style.display = obfuscated ? 'block' : 'none';
      
      if (gridKey && code) {
        // Parse the code to find centroid vs shape suffix
        const tildeIdx = code.indexOf('~');
        const hasTilde = tildeIdx > 0;
        const centroidCode = hasTilde ? code.substring(0, tildeIdx) : code;
        
        const result = decodeCardCode(gridKey, centroidCode, obfuscated);
        if (result) {
          setCoordinate(result[0], result[1]);
          showToast(obfuscated ? 'Decoded as obfuscated' : 'Decoded as hierarchical');
          
          if (hasTilde) {
            // Re-decode the full shape (centroid + deltas)
            const redrawInput = document.getElementById('redrawString');
            if (redrawInput) {
              redrawInput.value = code;
              if (typeof redrawFromString === 'function') {
                redrawFromString();
              }
              if (typeof switchToTab === 'function') {
                switchToTab('output');
              }
            }
          } else {
            const map = callbacks.getMap ? callbacks.getMap() : null;
            if (map) map.setView([result[0], result[1]], 16, { animate: true });
          }
          showDecodeBanner(gridKey, code, result[0], result[1]);
        }
      }
    };
    
    banner.querySelector('.try-passphrase-btn').onclick = () => {
      banner.remove();
      if (gridKey && code) {
        showPassphraseDecodeModal(gridKey, code);
      } else {
        const passphraseModal = document.getElementById('passphraseModal');
        if (passphraseModal) {
          passphraseModal.classList.add('show');
          const passphraseInput = document.getElementById('passphraseInput');
          if (passphraseInput) passphraseInput.focus();
        }
      }
    };
    
    banner.dataset.gridKey = gridKey || '';
    banner.dataset.code = code || '';
    
    document.body.appendChild(banner);
    setTimeout(() => banner.remove(), 12000);  // Extended to 12s since it now has useful actions
  }
  
  function showAddFormatModal() {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;';
    
    const panel = document.createElement('div');
    panel.style.cssText = 'background:#1c1c1e;border-radius:16px;padding:20px;max-width:320px;width:100%;max-height:80vh;overflow-y:auto;';
    
    let html = '<div style="font-size:18px;font-weight:600;margin-bottom:16px;color:white;">Add Mode</div>';
    html += '<div style="font-size:13px;color:#888;margin-bottom:12px;">Select formats to display:</div>';
    
    Object.entries(CARD_GRIDS).forEach(([key, def]) => {
      if ((!def.grid && !def.gis && !def.healpix && !def.chessOf) || def.deprecated) return;
      const isVisible = cardState.visible.includes(key);
      const isCustom = !!def.isCustom;
      const isGis = !!def.gis;
      const isHealpix = !!def.healpix;
      const isChess = !!def.chessOf;
      const tag = isCustom ? ' <span style="font-size:11px;opacity:0.5;">(custom)</span>'
                : isGis ? ' <span style="font-size:11px;opacity:0.5;">(GIS)</span>'
                : isChess ? ' <span style="font-size:11px;opacity:0.5;">(Chess)</span>'
                : isHealpix ? ' <span style="font-size:11px;opacity:0.5;">(HEALPix)</span>' : '';
      const label = def.name + tag;
      html += `
        <div class="format-option" data-key="${key}" style="display:flex;align-items:center;justify-content:space-between;padding:12px;margin:4px 0;background:${isVisible ? 'rgba(0,255,255,0.1)' : 'rgba(255,255,255,0.05)'};border-radius:8px;cursor:pointer;border:1px solid ${isVisible ? 'rgba(0,255,255,0.3)' : 'transparent'};">
          <span style="color:white;">${label}</span>
          <span style="display:flex;align-items:center;gap:8px;">
            ${isCustom ? `<span class="custom-delete-btn" data-key="${key}" style="color:#dc3545;font-size:18px;padding:0 4px;cursor:pointer;" title="Delete custom grid">×</span>` : ''}
            <span class="vis-indicator" style="color:${isVisible ? 'cyan' : '#666'};">${isVisible ? '✓' : ''}</span>
          </span>
        </div>
      `;
    });
    
    html += '<button id="closeAddFormat" style="width:100%;margin-top:16px;padding:12px;border-radius:8px;border:none;background:#333;color:white;font-size:15px;cursor:pointer;">Done</button>';
    
    panel.innerHTML = html;
    modal.appendChild(panel);
    document.body.appendChild(modal);
    
    panel.querySelectorAll('.format-option').forEach(opt => {
      opt.onclick = (e) => {
        // Don't toggle visibility if clicking the delete button
        if (e.target.classList.contains('custom-delete-btn')) return;
        
        const key = opt.dataset.key;
        const isVisible = cardState.visible.includes(key);
        const visInd = opt.querySelector('.vis-indicator');
        if (isVisible) {
          cardState.visible = cardState.visible.filter(k => k !== key);
          opt.style.background = 'rgba(255,255,255,0.05)';
          opt.style.borderColor = 'transparent';
          if (visInd) { visInd.textContent = ''; visInd.style.color = '#666'; }
        } else {
          cardState.visible.push(key);
          opt.style.background = 'rgba(0,255,255,0.1)';
          opt.style.borderColor = 'rgba(0,255,255,0.3)';
          if (visInd) { visInd.textContent = '✓'; visInd.style.color = 'cyan'; }
        }
        saveCardState();
        renderCards();
      };
    });
    
    // Custom grid delete buttons
    panel.querySelectorAll('.custom-delete-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const key = btn.dataset.key;
        const def = CARD_GRIDS[key];
        if (!def) return;
        if (confirm('Delete custom grid "' + def.name + '"?')) {
          // Use CardRenderer's own unregisterGrid to clean everything up
          CardRenderer.unregisterGrid(key);
          // Also remove from CustomGridLoader's localStorage if available
          if (typeof CustomGridLoader !== 'undefined' && CustomGridLoader.unregisterGrid) {
            CustomGridLoader.unregisterGrid(key);
          }
          // Remove the option from the modal
          const optEl = btn.closest('.format-option');
          if (optEl) optEl.remove();
          showToast('"' + def.name + '" removed');
        }
      };
    });
    
    panel.querySelector('#closeAddFormat').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  }
  
  // Decode a chess board (FEN placement field OR the ASCII board form) back to its hex code,
  // then move the map to the decoded coordinate. Uses ChessboardLib.scan, which verifies the
  // board is in the encoder's image (re-encode match) — a hand-edited/illegal board is rejected
  // as "not a valid card" rather than silently mis-read (the scanner caveat from the handover).
  function showChessDecodeModal(gridKey, seedText) {
    const gridDef = CARD_GRIDS[gridKey];
    const fmt = gridDef.chessFormat || 'standard';
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:2000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML = `
      <div style="background:var(--paper,#fff);color:#222;border-radius:14px;padding:20px;max-width:480px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.4);">
        <div style="font-weight:600;margin-bottom:6px;">Decode a ${gridDef.name}</div>
        <div style="font-size:13px;color:#666;margin-bottom:12px;">Paste a FEN placement field or an ASCII board. It will be checked and decoded to its location.</div>
        <textarea id="chessDecodeIn" rows="6" placeholder="e.g. 3R4/2p2pq1/... or the ASCII board" style="width:100%;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;padding:10px;border:1px solid #ccc;border-radius:8px;box-sizing:border-box;resize:vertical;"></textarea>
        <div id="chessDecodeMsg" style="font-size:13px;margin-top:10px;min-height:18px;"></div>
        <div style="margin-top:14px;display:flex;gap:10px;justify-content:flex-end;">
          <button id="chessDecodeCancel" style="padding:10px 18px;border-radius:9px;border:1px solid #ccc;background:#f4f4f4;font-size:14px;cursor:pointer;">Cancel</button>
          <button id="chessDecodeGo" style="padding:10px 18px;border-radius:9px;border:none;background:#2b6;color:white;font-size:14px;cursor:pointer;">Decode</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    const inEl = modal.querySelector('#chessDecodeIn');
    if (seedText) { inEl.value = seedText; setTimeout(() => { try { inEl.focus(); inEl.select && inEl.select(); } catch (_) {} }, 0); }
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    modal.querySelector('#chessDecodeCancel').onclick = close;
    modal.querySelector('#chessDecodeGo').onclick = () => {
      const raw = modal.querySelector('#chessDecodeIn').value;
      const msg = modal.querySelector('#chessDecodeMsg');
      if (!raw || !raw.trim()) { msg.textContent = 'Paste a board first.'; msg.style.color = '#c33'; return; }
      let res;
      try { res = ChessboardLib.scan(raw.trim(), fmt); }
      catch (e) { res = { ok: false, reason: e.message }; }
      if (!res.ok) {
        msg.textContent = res.reason || 'Not a valid card board.';
        msg.style.color = '#c33';
        return;
      }
      // res.hex is the recovered Geosonify hex. Decode it to a coordinate via the sibling engine.
      const coord = decodeCardCode(gridKey, res.hex, false);
      if (!coord || !Array.isArray(coord)) {
        msg.textContent = 'Recovered code ' + res.hex + ' but could not decode to a location.';
        msg.style.color = '#c33';
        return;
      }
      msg.textContent = 'Decoded ' + res.hex + ' → ' + coord[0].toFixed(6) + ', ' + coord[1].toFixed(6);
      msg.style.color = '#2a7';
      setCoordinate(coord[0], coord[1]);
      setTimeout(close, 700);
    };
  }

  function showChromaScanModal(mode) {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:2000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;';
    
    if (mode === 'camera') {
      modal.innerHTML = `
        <div style="color:white;text-align:center;margin-bottom:12px;">Centre the ChromaCoord in the crosshair</div>
        <div id="scanVideoWrap" style="position:relative;display:inline-block;max-width:90vw;max-height:60vh;">
          <video id="scanVideo" autoplay playsinline style="max-width:90vw;max-height:60vh;border-radius:12px;display:block;"></video>
          <div id="scanCrosshair" style="position:absolute;inset:0;pointer-events:none;"></div>
          <canvas id="scanOverlay" style="position:absolute;inset:0;pointer-events:none;border-radius:12px;"></canvas>
        </div>
        <canvas id="scanCanvas" style="display:none;"></canvas>
        <div id="scanStatus" style="color:#aaa;margin-top:12px;font-size:14px;">Initializing camera...</div>
        <div id="scanDebug" style="color:#888;margin-top:6px;font-size:10px;font-family:monospace;max-width:90vw;text-align:left;line-height:1.4;max-height:30vh;overflow-y:auto;display:none;background:rgba(0,0,0,0.6);padding:8px;border-radius:8px;white-space:pre-wrap;"></div>
        <div style="margin-top:12px;display:flex;gap:12px;">
          <button id="closeScanBtn" style="padding:12px 24px;border-radius:10px;border:none;background:#333;color:white;font-size:16px;">Cancel</button>
          <button id="toggleDebugBtn" style="padding:12px 16px;border-radius:10px;border:none;background:#222;color:#666;font-size:12px;">Debug</button>
        </div>
      `;
      document.body.appendChild(modal);
      
      const video = modal.querySelector('#scanVideo');
      const canvas = modal.querySelector('#scanCanvas');
      const overlay = modal.querySelector('#scanOverlay');
      const crosshairDiv = modal.querySelector('#scanCrosshair');
      const status = modal.querySelector('#scanStatus');
      const videoWrap = modal.querySelector('#scanVideoWrap');
      const debugDiv = modal.querySelector('#scanDebug');
      let stream = null;
      let scanning = true;
      let debugMode = false;
      let debugFrameCount = 0;
      let debugLastUpdate = 0;
      
      // Debug toggle
      modal.querySelector('#toggleDebugBtn').onclick = function() {
        debugMode = !debugMode;
        debugDiv.style.display = debugMode ? 'block' : 'none';
        this.style.color = debugMode ? '#0ff' : '#666';
        this.style.background = debugMode ? '#003' : '#222';
      };
      
      // Draw crosshair SVG
      crosshairDiv.innerHTML = `<svg style="width:100%;height:100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <line x1="50" y1="20" x2="50" y2="40" stroke="rgba(0,255,255,0.6)" stroke-width="0.3"/>
        <line x1="50" y1="60" x2="50" y2="80" stroke="rgba(0,255,255,0.6)" stroke-width="0.3"/>
        <line x1="20" y1="50" x2="40" y2="50" stroke="rgba(0,255,255,0.6)" stroke-width="0.3"/>
        <line x1="60" y1="50" x2="80" y2="50" stroke="rgba(0,255,255,0.6)" stroke-width="0.3"/>
        <circle cx="50" cy="50" r="8" fill="none" stroke="rgba(0,255,255,0.4)" stroke-width="0.2"/>
      </svg>`;
      
      // Load OpenCV in background
      let cvReady = (typeof cv !== 'undefined' && typeof cv.Mat !== 'undefined');
      
      if (!cvReady) {
        // Set callback for builds that support it
        window.onOpenCvReady = function() { 
          cvReady = true; 
          console.log('[ChromaScan] OpenCV ready (callback)');
          if (scanning) status.textContent = 'Scanning — or tap the code to decode';
        };
        
        // Load script if needed
        if (!document.querySelector('script[src*="opencv"]')) {
          const cvScript = document.createElement('script');
          cvScript.src = 'https://docs.opencv.org/4.x/opencv.js';
          cvScript.async = true;
          document.head.appendChild(cvScript);
        }
        
        // ALWAYS poll — covers Safari/iOS where onOpenCvReady may not fire,
        // and cases where the script tag existed but cv loaded while we weren't listening.
        // Checks both cv.Mat (WASM ready) and handles cv-as-Promise (module builds).
        var cvPoll = setInterval(function() {
          if (cvReady) { clearInterval(cvPoll); return; } // already detected via callback
          try {
            if (typeof cv !== 'undefined' && cv && typeof cv.Mat === 'function') {
              cvReady = true;
              clearInterval(cvPoll);
              console.log('[ChromaScan] OpenCV detected (poll)');
              if (scanning) status.textContent = 'Scanning — or tap the code to decode';
            }
          } catch(e) { /* cv may be a Promise that throws on property access */ }
        }, 300);
        setTimeout(function() { clearInterval(cvPoll); }, 30000); // give up after 30s
      }
      
      // === Exposure/WB lock for iPhone stability ===
      // Let the camera auto-adjust for a settling period, then lock exposure
      // and white balance so colors stay consistent during scanning.
      var cameraSettled = false;
      var SETTLE_MS = 1500; // let auto-exposure/WB adjust for 1.5s
      
      function tryLockCameraSettings(track) {
        try {
          var capabilities = track.getCapabilities ? track.getCapabilities() : {};
          var constraints = {};
          var locked = [];
          
          // Lock exposure mode if supported
          if (capabilities.exposureMode && capabilities.exposureMode.indexOf('manual') >= 0) {
            constraints.exposureMode = 'manual';
            locked.push('exposure');
          } else if (capabilities.exposureMode && capabilities.exposureMode.indexOf('continuous') >= 0) {
            // 'continuous' is next best — avoids sudden jumps
            constraints.exposureMode = 'continuous';
            locked.push('exposure(continuous)');
          }
          
          // Lock white balance if supported
          if (capabilities.whiteBalanceMode && capabilities.whiteBalanceMode.indexOf('manual') >= 0) {
            constraints.whiteBalanceMode = 'manual';
            locked.push('WB');
          }
          
          // Lock focus if supported (prevents hunting)
          if (capabilities.focusMode && capabilities.focusMode.indexOf('manual') >= 0) {
            constraints.focusMode = 'manual';
            locked.push('focus');
          }
          
          if (Object.keys(constraints).length > 0) {
            track.applyConstraints({ advanced: [constraints] })
              .then(function() { 
                console.log('[ChromaScan] Locked camera: ' + locked.join(', ')); 
              })
              .catch(function(e) { 
                console.log('[ChromaScan] Camera lock partial/failed: ' + e.message);
              });
          } else {
            console.log('[ChromaScan] No lockable camera capabilities detected');
          }
        } catch (e) {
          console.log('[ChromaScan] Camera lock not supported: ' + e.message);
        }
      }
      
      // Manual tap handler — probe from tap point
      videoWrap.style.cursor = 'crosshair';
      videoWrap.addEventListener('click', function(e) {
        if (!scanning) return;
        const rect = video.getBoundingClientRect();
        const scaleX = video.videoWidth / rect.width;
        const scaleY = video.videoHeight / rect.height;
        const tapX = (e.clientX - rect.left) * scaleX;
        const tapY = (e.clientY - rect.top) * scaleY;
        tryDecode(tapX, tapY, true);
      });
      
      // Detect mobile for camera-lock strategy
      var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } })
        .then(s => {
          stream = s;
          video.srcObject = stream;
          video.onloadedmetadata = () => {
            if (cvReady) {
              status.textContent = 'Scanning — or tap the code to decode';
            } else {
              status.textContent = 'Loading perspective engine... point camera at code';
            }
            
            // On mobile: let auto-exposure settle, then lock camera settings.
            // Scanning starts immediately (no blocking delay) but camera lock 
            // helps stabilize colors once the auto-exposure has adapted.
            // On desktop: skip entirely (USB cameras don't benefit from this).
            if (isMobile) {
              cameraSettled = false;
              setTimeout(function() {
                cameraSettled = true;
                var videoTrack = stream.getVideoTracks()[0];
                if (videoTrack) tryLockCameraSettings(videoTrack);
                console.log('[ChromaScan] Camera settled after ' + SETTLE_MS + 'ms — exposure locked');
              }, SETTLE_MS);
            } else {
              cameraSettled = true; // desktop: no settle needed
            }
            
            autoScanLoop();
          };
        })
        .catch(err => {
          status.textContent = 'Camera error: ' + err.message;
        });
      
      var recentDecodes = []; // rolling window for confidence tracking
      
      function tryDecode(probeX, probeY, isManualTap) {
        if (!scanning) return false;
        if (!video.videoWidth) return false;
        
        debugFrameCount++;
        var dbg = []; // collect debug lines
        
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        dbg.push('Frame #' + debugFrameCount + ' | ' + imageData.width + '×' + imageData.height);
        
        const Scanner = window.ScannerService || window.RGB111Scanner;
        if (!Scanner) {
          if (isManualTap) status.textContent = 'Scanner service not loaded';
          dbg.push('⛔ No scanner loaded');
          updateDebug(dbg);
          return false;
        }
        
        try {
          // 1. Cast rays
          const edgePoints = Scanner.castRays(imageData, probeX, probeY, 360);
          const outlierCount = edgePoints.filter(p => p.isOutlier).length;
          const outlierPct = (outlierCount / edgePoints.length * 100).toFixed(0);
          dbg.push('Rays: ' + outlierCount + '/' + edgePoints.length + ' outliers (' + outlierPct + '%)');
          
          if (outlierCount / edgePoints.length > 0.3) {
            if (isManualTap) status.textContent = 'Edge detection unclear — try closer or better lighting';
            dbg.push('⛔ Too many outliers (>30%)');
            updateDebug(dbg);
            return false;
          }
          
          // 2. Fit quad
          const quad = Scanner.fitQuadrilateral(edgePoints);
          if (!quad) {
            if (isManualTap) status.textContent = 'Could not detect grid corners — tap inside the code';
            dbg.push('⛔ No quad fitted');
            updateDebug(dbg);
            return false;
          }
          
          // 3. Sanity checks — reject bad quads early
          const edgeLens = [
            Math.hypot(quad.TR.x - quad.TL.x, quad.TR.y - quad.TL.y),
            Math.hypot(quad.BR.x - quad.TR.x, quad.BR.y - quad.TR.y),
            Math.hypot(quad.BL.x - quad.BR.x, quad.BL.y - quad.BR.y),
            Math.hypot(quad.TL.x - quad.BL.x, quad.TL.y - quad.BL.y)
          ];
          const maxEdge = Math.max(...edgeLens);
          const minEdge = Math.min(...edgeLens);
          const edgeRatio = (maxEdge / minEdge).toFixed(1);
          
          dbg.push('Quad: ' + Math.round(minEdge) + '-' + Math.round(maxEdge) + 'px (ratio ' + edgeRatio + ')');
          dbg.push('  TL(' + Math.round(quad.TL.x) + ',' + Math.round(quad.TL.y) + ') TR(' + Math.round(quad.TR.x) + ',' + Math.round(quad.TR.y) + ')');
          dbg.push('  BL(' + Math.round(quad.BL.x) + ',' + Math.round(quad.BL.y) + ') BR(' + Math.round(quad.BR.x) + ',' + Math.round(quad.BR.y) + ')');
          
          if (maxEdge / minEdge > 2.5) {
            if (isManualTap) status.textContent = 'Detected shape too irregular — try again';
            dbg.push('⛔ Edge ratio too high (>2.5)');
            updateDebug(dbg);
            return false;
          }
          
          if (minEdge < 60) {
            if (isManualTap) status.textContent = 'Card too small — move closer';
            dbg.push('⛔ Edges too small (<60px)');
            updateDebug(dbg);
            return false;
          }
          
          var qCorners = [quad.TL, quad.TR, quad.BR, quad.BL];
          var outOfBounds = qCorners.some(function(c) {
            return c.x < 0 || c.y < 0 || c.x >= imageData.width || c.y >= imageData.height;
          });
          if (outOfBounds) {
            if (isManualTap) status.textContent = 'Card partially outside frame — reposition';
            dbg.push('⛔ Corner(s) out of bounds');
            updateDebug(dbg);
            return false;
          }
          
          // Show detection on overlay
          overlay.width = video.videoWidth;
          overlay.height = video.videoHeight;
          overlay.style.width = video.getBoundingClientRect().width + 'px';
          overlay.style.height = video.getBoundingClientRect().height + 'px';
          const oCtx = overlay.getContext('2d');
          oCtx.clearRect(0, 0, overlay.width, overlay.height);
          oCtx.strokeStyle = 'rgba(0,255,255,0.7)';
          oCtx.lineWidth = 2;
          oCtx.beginPath();
          oCtx.moveTo(quad.TL.x, quad.TL.y);
          oCtx.lineTo(quad.TR.x, quad.TR.y);
          oCtx.lineTo(quad.BR.x, quad.BR.y);
          oCtx.lineTo(quad.BL.x, quad.BL.y);
          oCtx.closePath();
          oCtx.stroke();
          
          // 4. Perspective-correct
          if (!cvReady) {
            try {
              if (typeof cv !== 'undefined' && cv && typeof cv.Mat === 'function') cvReady = true;
            } catch(e) {}
          }
          if (!cvReady) {
            if (isManualTap) status.textContent = 'Perspective engine still loading... try again shortly';
            dbg.push('⛔ OpenCV not ready');
            updateDebug(dbg);
            return false;
          }
          
          const outSize = 400;
          const srcC = document.createElement('canvas');
          srcC.width = imageData.width; srcC.height = imageData.height;
          srcC.getContext('2d').putImageData(imageData, 0, 0);
          const src = cv.imread(srcC);
          const dst = new cv.Mat();
          const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
            quad.TL.x, quad.TL.y, quad.TR.x, quad.TR.y,
            quad.BR.x, quad.BR.y, quad.BL.x, quad.BL.y
          ]);
          const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outSize, 0, outSize, outSize, 0, outSize]);
          const M = cv.getPerspectiveTransform(srcPts, dstPts);
          cv.warpPerspective(src, dst, M, new cv.Size(outSize, outSize));
          const corrC = document.createElement('canvas');
          corrC.width = outSize; corrC.height = outSize;
          cv.imshow(corrC, dst);
          src.delete(); dst.delete(); srcPts.delete(); dstPts.delete(); M.delete();
          
          // 5. Decode with CRC-8 validation
          const corrData = corrC.getContext('2d').getImageData(0, 0, outSize, outSize);
          const result = Scanner.decodeFromCorrectedImage(corrData);
          
          // Build debug info from result
          if (result) {
            var colorGrid = '';
            var nullCount = 0;
            var ambigCount = 0;
            if (result.samples) {
              for (var si = 0; si < result.samples.length; si++) {
                var s = result.samples[si];
                var cName = s.name || s.color || '?';
                if (cName === 'null' || !s.bits) { cName = '·'; nullCount++; }
                if (s.ambiguous) ambigCount++;
                colorGrid += (cName.length > 1 ? cName.charAt(0) : cName);
                if ((si + 1) % 4 === 0 && si < 15) colorGrid += '|';
              }
            }
            
            var nDet = result.notchResult ? result.notchResult.notches : {};
            var nExp = result.expectedNotches || {};
            var notchStr = 'T:' + (nDet.top >= 0 ? nDet.top : '?') + (nDet.top === nExp.top ? '✓' : '✗') +
                           ' R:' + (nDet.right >= 0 ? nDet.right : '?') + (nDet.right === nExp.right ? '✓' : '✗') +
                           ' B:' + (nDet.bottom >= 0 ? nDet.bottom : '?') + (nDet.bottom === nExp.bottom ? '✓' : '✗') +
                           ' L:' + (nDet.left >= 0 ? nDet.left : '?') + (nDet.left === nExp.left ? '✓' : '✗');
            
            dbg.push('Grid: [' + colorGrid + '] (' + nullCount + ' null, ' + ambigCount + ' ambig)');
            dbg.push('Notch: ' + notchStr + ' → ' + (result.matches || 0) + '/' + (result.comparisons || 0));
            dbg.push('Hex: ' + (result.hex || '—') + (result.valid ? ' ✓ VALID' : ' ✗ invalid'));
            
            // Show top-level Lab values for each cluster (compact)
            if (result.samples) {
              var labSummary = [];
              var seen = {};
              for (var li = 0; li < result.samples.length; li++) {
                var ls = result.samples[li];
                var lc = ls.name || ls.color || '?';
                if (lc === 'null' || seen[lc] || !ls.lab) continue;
                seen[lc] = true;
                labSummary.push(lc + ':L' + Math.round(ls.lab[0]) + ',a' + Math.round(ls.lab[1]) + ',b' + Math.round(ls.lab[2]));
              }
              if (labSummary.length > 0) {
                dbg.push('Lab: ' + labSummary.join(' | '));
              }
            }
          } else {
            dbg.push('⛔ No result from decoder');
          }
          
          updateDebug(dbg);
          
          if (result && result.valid && result.hex) {
            const hex = result.hex;
            const now = Date.now();
            
            // Show detection feedback — green quad overlay
            oCtx.strokeStyle = 'rgba(0,255,0,0.8)';
            oCtx.lineWidth = 3;
            oCtx.beginPath();
            oCtx.moveTo(quad.TL.x, quad.TL.y); oCtx.lineTo(quad.TR.x, quad.TR.y);
            oCtx.lineTo(quad.BR.x, quad.BR.y); oCtx.lineTo(quad.BL.x, quad.BL.y);
            oCtx.closePath(); oCtx.stroke();
            
            // Track for logging but accept on first CRC-valid read.
            // CRC-8 with 4 notches is already a strong validation gate — 
            // requiring double-read on top of that causes iPhone failures
            // because auto-exposure shifts colors between frames.
            recentDecodes.push({ hex: hex, time: now });
            console.log('[ChromaScan] CRC-valid decode: ' + hex + 
              (recentDecodes.length > 1 ? ' (read #' + recentDecodes.length + ')' : ''));
            
            scanning = false;
            if (stream) stream.getTracks().forEach(t => t.stop());
            status.textContent = 'Decoded: ' + hex + ' ✓';
            status.style.color = '#0f0';
            setTimeout(function() {
              modal.remove();
              decodeChromaResult(hex);
            }, 400);
            return true;
          } else {
            if (isManualTap) {
              status.textContent = result && result.hex 
                ? 'Partial: ' + result.hex + ' (CRC failed — try again)'
                : 'Could not decode — try better angle/lighting';
            }
          }
        } catch (e) {
          if (isManualTap) status.textContent = 'Decode error — try again';
          dbg.push('⛔ Exception: ' + e.message);
          updateDebug(dbg);
        }
        return false;
      }
      
      function updateDebug(lines) {
        if (!debugMode) return;
        var now = Date.now();
        // Throttle updates to every 200ms to avoid flicker
        if (now - debugLastUpdate < 200) return;
        debugLastUpdate = now;
        debugDiv.textContent = lines.join('\n');
      }
      
      function autoScanLoop() {
        if (!scanning) return;
        if (!video.videoWidth) { requestAnimationFrame(autoScanLoop); return; }
        
        const cx = video.videoWidth / 2, cy = video.videoHeight / 2;
        
        // On mobile during settling: show aiming feedback but don't decode yet
        if (isMobile && !cameraSettled) {
          try {
            const Scanner = window.ScannerService || window.RGB111Scanner;
            if (Scanner && cvReady) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              ctx.drawImage(video, 0, 0);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const edgePoints = Scanner.castRays(imageData, cx, cy, 360);
              const outlierRatio = edgePoints.filter(p => p.isOutlier).length / edgePoints.length;
              if (outlierRatio <= 0.3) {
                const quad = Scanner.fitQuadrilateral(edgePoints);
                if (quad) {
                  overlay.width = video.videoWidth;
                  overlay.height = video.videoHeight;
                  overlay.style.width = video.getBoundingClientRect().width + 'px';
                  overlay.style.height = video.getBoundingClientRect().height + 'px';
                  const oCtx = overlay.getContext('2d');
                  oCtx.clearRect(0, 0, overlay.width, overlay.height);
                  oCtx.strokeStyle = 'rgba(255,255,0,0.5)';
                  oCtx.lineWidth = 2;
                  oCtx.setLineDash([6, 4]);
                  oCtx.beginPath();
                  oCtx.moveTo(quad.TL.x, quad.TL.y);
                  oCtx.lineTo(quad.TR.x, quad.TR.y);
                  oCtx.lineTo(quad.BR.x, quad.BR.y);
                  oCtx.lineTo(quad.BL.x, quad.BL.y);
                  oCtx.closePath();
                  oCtx.stroke();
                  oCtx.setLineDash([]);
                  status.textContent = 'Adjusting camera... hold steady';
                }
              }
            }
          } catch(e) { /* settling preview is best-effort */ }
          requestAnimationFrame(autoScanLoop);
          return;
        }
        
        // Full decode attempt
        tryDecode(cx, cy, false);
        
        // Keep scanning — throttle slightly on mobile to reduce CPU
        if (scanning) {
          if (isMobile) {
            setTimeout(function() { requestAnimationFrame(autoScanLoop); }, 50);
          } else {
            requestAnimationFrame(autoScanLoop);
          }
        }
      }
      
      modal.querySelector('#closeScanBtn').onclick = () => {
        scanning = false;
        if (stream) stream.getTracks().forEach(t => t.stop());
        modal.remove();
      };
    } else {
      modal.innerHTML = `
        <div style="color:white;text-align:center;margin-bottom:16px;">Select ChromaCoord image</div>
        <input type="file" id="chromaFileInput" accept="image/*" style="display:none;">
        <button id="selectFileBtn" style="padding:16px 32px;border-radius:10px;border:none;background:#007AFF;color:white;font-size:16px;cursor:pointer;">Choose Image</button>
        <canvas id="uploadCanvas" style="display:none;"></canvas>
        <div id="uploadStatus" style="color:#aaa;margin-top:12px;font-size:14px;"></div>
        <button id="closeUploadBtn" style="margin-top:20px;padding:12px 24px;border-radius:10px;border:none;background:#333;color:white;font-size:16px;">Cancel</button>
      `;
      document.body.appendChild(modal);
      
      const fileInput = modal.querySelector('#chromaFileInput');
      const canvas = modal.querySelector('#uploadCanvas');
      const status = modal.querySelector('#uploadStatus');
      
      modal.querySelector('#selectFileBtn').onclick = () => fileInput.click();
      modal.querySelector('#closeUploadBtn').onclick = () => modal.remove();
      
      fileInput.onchange = () => {
        const file = fileInput.files[0];
        if (!file) return;
        
        status.textContent = 'Processing...';
        const img = new Image();
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          
          if (typeof RGB111Lib !== 'undefined' && RGB111Lib.decodeFromCanvas) {
            const result = RGB111Lib.decodeFromCanvas(canvas, { gridSize: 4 });
            if (result && result.hex) {
              modal.remove();
              decodeChromaResult(result.hex);
            } else {
              status.textContent = 'Could not decode image';
            }
          } else {
            status.textContent = 'RGB111Lib not available';
          }
        };
        img.src = URL.createObjectURL(file);
      };
    }
  }
  
  function decodeChromaResult(hexCode) {
    const gridKey = 'chromacoord';
    const gridDef = CARD_GRIDS[gridKey];
    if (!gridDef) {
      showToast('ChromaCoord not configured');
      return;
    }
    
    try {
      const shuffled = getShuffledGrid(gridKey);
      const grid2D = shuffled.grid;
      const flat = grid2D.flat();
      
      let workingCode = hexCode.toUpperCase();
      
      if (obfuscated && typeof GeoCodec !== 'undefined' && GeoCodec.applyObfuscation) {
        workingCode = GeoCodec.applyObfuscation('decode', workingCode, flat);
      }
      
      if (typeof GeoCodec !== 'undefined' && GeoCodec.decodeHierarchical) {
        const result = GeoCodec.decodeHierarchical(workingCode, grid2D, gridDef.fixedIterations || gridDef.defaultIterations || 6);
        if (result) {
          setCoordinate(result[0], result[1]);
          
          const map = callbacks.getMap ? callbacks.getMap() : null;
          if (map) map.setView([result[0], result[1]], 16, { animate: true });
          
          showToast('Decoded: ' + hexCode);
          showDecodeBanner(gridKey, hexCode, result[0], result[1]);
          return;
        }
      }
      showToast('Invalid ChromaCoord');
    } catch (e) {
      console.error('[CardRenderer] ChromaCoord decode error:', e);
      showToast('Decode error');
    }
  }

  // ============== RAW MODE UI ==============
  
  function updateRawModeUI() {
    const btn = document.getElementById('rawModeBtn');
    const shareBtn = document.getElementById('rawShareBtn');
    if (btn) btn.classList.toggle('active', rawModeActive);
    if (shareBtn) shareBtn.style.display = rawModeActive ? 'inline-block' : 'none';
  }
  
  function updatePassphraseUI() {
    const btn = document.getElementById('passphraseBtn');
    const reminder = document.getElementById('passphraseReminder');
    if (passphrase) {
      if (btn) btn.textContent = '🔑 Passphrase';
      if (reminder) reminder.style.display = 'block';
    } else {
      if (btn) btn.textContent = '🔓 Passphrase';
      if (reminder) reminder.style.display = 'none';
    }
  }

  // ============== COORDINATE MANAGEMENT ==============
  
  function setCoordinate(lat, lon) {
    currentCardCoord = { lat, lon };
    
    // Update coord display
    const display = document.getElementById('coordDisplay');
    if (display) {
      display.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    }
    
    // Notify external handlers
    if (callbacks.onCoordChange) {
      callbacks.onCoordChange(lat, lon);
    }
    
    // Render cards
    renderCards();
    
    // Update compact outputs if callback provided
    if (callbacks.onCompactUpdate) {
      callbacks.onCompactUpdate();
    }
  }

  // ============== GRID PREVIEW ==============
  
  function updateGridPreview() {
    const preview = document.getElementById('gridPreview');
    if (!preview) return;
    
    const activeKey = cardState.active;
    const gridDef = CARD_GRIDS[activeKey];
    // HEALPix cards have no 2D vocabulary grid to draw. Show what the
    // passphrase actually does to them instead of the (misleading) "No grid".
    if (gridDef && gridDef.healpix) {
      preview.innerHTML =
        '<div style="font-size:11px;color:#888;line-height:1.5;">' +
        '<b>' + gridDef.name + '</b><br>' +
        (passphrase
          ? 'Passphrase active — the location is permuted at the tree level: ' +
            'the base pixel (1 of 12) and every level (1 of 4) are shuffled by your key. ' +
            'The code scrambles; it decodes back only with the same passphrase.'
          : 'Enter a passphrase to permute this HEALPix code. The base pixel and ' +
            'each level shuffle by your key; the same passphrase reverses it.') +
        '</div>';
      return;
    }
    if (!gridDef || !gridDef.grid) {
      preview.innerHTML = '<div style="color:#888;font-size:11px;">No grid selected</div>';
      return;
    }
    
    const shuffled = getShuffledGrid(activeKey);
    const grid = shuffled.grid;
    const cols = grid[0].length, rows = grid.length;
    const cellWidth = Math.max(12, Math.min(24, 180 / cols));
    const fontSize = Math.max(6, Math.min(10, cellWidth * 0.6));
    
    let html = `<div style="font-size:11px;color:#888;margin-bottom:6px;">${gridDef.name} (${passphrase ? 'shuffled' : 'original'}) ${cols}×${rows}:</div>`;
    html += `<table style="border-collapse:collapse;font-size:${fontSize}px;">`;
    grid.forEach(row => {
      html += '<tr>' + row.map(c => {
        const display = String(c).length > 3 ? String(c).substring(0, 2) + '…' : c;
        return `<td style="padding:1px;min-width:${cellWidth}px;max-width:${cellWidth}px;">${display}</td>`;
      }).join('') + '</tr>';
    });
    preview.innerHTML = html + '</table>';
  }

  // ============== PUBLIC API ==============
  
  const CardRenderer = {
    /**
     * Initialize the card renderer
     * @param {Object} options - Configuration options
     * @param {Function} options.onCoordChange - Callback when coordinate changes: (lat, lon) => void
     * @param {Function} options.onCompactUpdate - Callback to update compact outputs
     * @param {Function} options.getMap - Function that returns the Leaflet map instance
     */
    init(options = {}) {
      callbacks.onCoordChange = options.onCoordChange || null;
      callbacks.onCompactUpdate = options.onCompactUpdate || null;
      callbacks.onUserInteraction = options.onUserInteraction || null;
      callbacks.getMap = options.getMap || null;
      
      // Refresh grid references in case arrays weren't available at module load time
      refreshGridReferences();

      // Register reference grids BEFORE loading saved state, so that
      // loadCardState() can reconcile saved order/visibility/active against a
      // fully-populated CARD_GRIDS (otherwise GIS/HEALPix cards aren't known
      // yet and saved additions/ordering for them are dropped on reload).
      registerGISCards();
      registerHealpixCards();
      registerChessboardCards();

      // Load saved state
      loadCardState();

      // One-time HEALPix-hex default visibility (after load so it isn't clobbered)
      surfaceHealpixDefault();
      // Engine fix landed (session 8): bishops vary, all 9 gates green, maxHex now 23.
      surfaceChessboardDefault();

      // Auto-add BIP39 card based on device language (first load only)
      autoAddBIP39ByLanguage();
      
      // Initialize UI elements
      initCardUIHandlers();
      
      console.log('[geosonify] card-renderer v1.0 loaded');
    },
    
    /**
     * Set the current coordinate and re-render
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude
     */
    setCoordinate,
    
    /**
     * Get current coordinate
     * @returns {{ lat: number, lon: number } | null}
     */
    getCoordinate() {
      return currentCardCoord ? { ...currentCardCoord } : null;
    },
    
    /**
     * Re-render all cards
     */
    render: renderCards,

    /**
     * Set a card's iteration count, persist it, and re-render. Used by
     * the import-accuracy readout to flow an accepted resolution through
     * to the active card and the front panel.
     */
    setIterations(gridKey, n) {
      if (!CARD_GRIDS[gridKey]) return;
      cardState.iterations[gridKey] = n;
      saveCardState();
      if (gridKey === cardState.active &&
          typeof MapManager !== 'undefined' && MapManager.refreshHierarchicalGrid) {
        MapManager.refreshHierarchicalGrid();
      }
      renderCards();
    },
    
    /**
     * Lightweight code-only update (no DOM rebuild).
     * Updates code text, checksums, and special displays on existing cards.
     * Use during high-frequency coordinate changes (GPX playback, animations).
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude
     */
    updateCodes(lat, lon) {
      currentCardCoord = { lat, lon };
      updateCardCodes();
    },
    
    /**
     * Register a custom grid (adds to internal CARD_GRIDS and cardState)
     * @param {string} key - Unique grid key
     * @param {Object} gridDef - Grid definition { name, grid, defaultIterations, maxIterations, isCustom, ... }
     * @param {boolean} makeVisible - Whether to make it visible immediately (default true)
     */
    registerGrid(key, gridDef, makeVisible = true) {
      CARD_GRIDS[key] = gridDef;
      if (!cardState.iterations[key]) {
        cardState.iterations[key] = gridDef.fixedIterations || gridDef.defaultIterations || 4;
      }
      if (!cardState.order.includes(key)) {
        cardState.order.push(key);
      }
      if (makeVisible && !cardState.visible.includes(key)) {
        cardState.visible.push(key);
      }
      saveCardState();
      if (currentCardCoord) renderCards();
    },
    
    /**
     * Unregister a custom grid
     * @param {string} key - Grid key to remove
     */
    unregisterGrid(key) {
      cardState.visible = cardState.visible.filter(k => k !== key);
      cardState.order = cardState.order.filter(k => k !== key);
      delete cardState.iterations[key];
      if (cardState.active === key) cardState.active = cardState.visible[0] || 'alphanumeric';
      delete CARD_GRIDS[key];
      saveCardState();
      if (currentCardCoord) renderCards();
    },
    
    /**
     * Get the active grid key
     * @returns {string | null}
     */
    getActiveGridKey() {
      return rawModeActive ? null : cardState.active;
    },
    
    /**
     * Get encoding for current coordinate
     * @param {number} lat
     * @param {number} lon
     * @returns {string}
     */
    getActiveEncoding,
    
    /**
     * Check if active card uses emoji
     * @returns {boolean}
     */
    isActiveCardEmoji,
    
    /**
     * Encode a coordinate with specific grid
     * @param {string} gridKey
     * @param {number} lat
     * @param {number} lon
     * @param {number} [iterations]
     * @returns {string}
     */
    encode(gridKey, lat, lon, iterations) {
      const gridDef = CARD_GRIDS[gridKey];
      const isBarcodeCard = gridDef && (gridDef.display === 'qrhex' || gridDef.display === 'qrbin' || gridDef.display === 'qrurl' || gridDef.display === 'datamatrix');
      const iters = iterations || (isBarcodeCard ? getBarcodeIterations(gridKey)
        : (gridDef?.fixedIterations || cardState.iterations[gridKey] || gridDef?.defaultIterations || 8));
      return _encodeCardCoordinateInternal(gridKey, lat, lon, iters);
    },
    
    /**
     * Decode a code with specific grid
     * @param {string} gridKey
     * @param {string} code
     * @param {number} [iterations]
     * @returns {[number, number] | null}
     */
    decode: decodeCardCoordinate,
    
    /**
     * Encode coordinates to a code WITHOUT obfuscation.
     * Uses passphrase-based position-dependent encode if passphrase is active.
     * This is used by delta encode paths where obfuscation is handled separately.
     */
    encodeRaw(gridKey, lat, lon, iterations) {
      const gridDef = CARD_GRIDS[gridKey];

      // HEALPix schemes encode via projection but otherwise behave exactly like
      // vocabulary grids. HEALPix applies passphrase AND obfuscation at the tree
      // level inside its own encode (position-shift on face/digits, same
      // algorithm as GeoCodec's index obfuscation). Crucially, HEALPix's
      // obfuscation PRESERVES shared prefixes for nearby points, so obfuscated
      // full codes still delta-compress well — we apply obf here and the delta
      // machinery's per-segment string-obfuscation is skipped for HEALPix
      // (its `flat` is null), giving one uniform, correct path.
      if (gridDef && gridDef.healpix && typeof HealpixGrids !== 'undefined') {
        const opt = {};
        if (passphrase) { opt.pass = passphrase; opt.shuffleFn = shuffleGridAndOrder; }
        if (obfuscated) { opt.obf = true; }
        return HealpixGrids.encode(gridDef.healpix, lat, lon, iterations, opt) || '';
      }

      const baseGrid = gridDef?.grid;
      if (!baseGrid) return '';
      
      const rows = baseGrid.length;
      const cols = baseGrid[0].length;
      
      if (!passphrase) {
        // No passphrase: simple encode with shuffled grid (no obfuscation)
        const shuffled = getShuffledGrid(gridKey);
        if (!shuffled) return '';
        if (typeof GeoCodec !== 'undefined' && GeoCodec.encodeHierarchical) {
          return GeoCodec.encodeHierarchical(lat, lon, shuffled.grid, iterations);
        }
        return '';
      }
      
      // Passphrase active: position-dependent encode (no obfuscation applied)
      let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
      let code = '';
      let chainPrefix = '';  // Index-based chain — grid-vocabulary-independent
      
      for (let it = 0; it < iterations; it++) {
        const shuffled = getShuffledGrid(gridKey, chainPrefix);
        const flat = shuffled.grid.flat();
        const rFrac = (latMax - lat) / (latMax - latMin);
        const cFrac = (lon - lonMin) / (lonMax - lonMin);
        const r = Math.min(rows - 1, Math.floor(rFrac * rows));
        const c = Math.min(cols - 1, Math.floor(cFrac * cols));
        const flatIdx = r * cols + c;
        code += flat[flatIdx];
        chainPrefix += (chainPrefix ? ',' : '') + String(flatIdx);
        const dLat = (latMax - latMin) / rows;
        const dLon = (lonMax - lonMin) / cols;
        latMax = latMax - dLat * r;
        latMin = latMax - dLat;
        lonMin = lonMin + dLon * c;
        lonMax = lonMin + dLon;
      }
      
      return code;
    },
    
    /**
     * Decode a code that has ALREADY been de-obfuscated.
     * Uses passphrase-based position-dependent decode if passphrase is active,
     * otherwise falls back to simple hierarchical decode.
     * This is used by delta decode paths where obfuscation was already handled.
     */
    decodeRaw(gridKey, code, iterations) {
      const gridDef = CARD_GRIDS[gridKey];

      // HEALPix: decode via projection, applying passphrase + obfuscation
      // symmetrically to encodeRaw. Mirrors the vocabulary-grid contract.
      if (gridDef && gridDef.healpix && typeof HealpixGrids !== 'undefined') {
        if (!code) return null;
        const opt = {};
        if (passphrase) { opt.pass = passphrase; opt.shuffleFn = shuffleGridAndOrder; }
        if (obfuscated) { opt.obf = true; }
        const ll = HealpixGrids.decode(gridDef.healpix, code, iterations, opt);
        return ll ? [ll[0], ll[1]] : null;
      }

      const baseGrid = gridDef?.grid;
      if (!baseGrid || !code) return null;
      
      const rows = baseGrid.length;
      const cols = baseGrid[0].length;
      
      console.log('[decodeRaw] passphrase:', !!passphrase, 'iterations:', iterations);
      
      if (!passphrase) {
        // No passphrase: simple decode with shuffled grid (no obfuscation step)
        const shuffled = getShuffledGrid(gridKey);
        if (!shuffled) return null;
        if (typeof GeoCodec !== 'undefined' && GeoCodec.decodeHierarchical) {
          return GeoCodec.decodeHierarchical(code, shuffled.grid, iterations);
        }
        return null;
      }
      
      // Passphrase active: position-dependent decode (code already de-obfuscated)
      const baseFlat = baseGrid.flat();
      let tokens;
      if (typeof GeoCodec !== 'undefined' && GeoCodec.tokenizeCode) {
        tokens = GeoCodec.tokenizeCode(code, baseFlat);
      }
      if (!tokens || tokens.length < iterations) return null;
      
      let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;
      let chainPrefix = '';
      
      for (let it = 0; it < iterations; it++) {
        const shuffled = getShuffledGrid(gridKey, chainPrefix);
        const flat = shuffled.grid.flat();
        const symbol = tokens[it];
        const idx = flat.indexOf(symbol);
        if (idx < 0) return null;
        
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        const dLat = (latMax - latMin) / rows;
        const dLon = (lonMax - lonMin) / cols;
        latMax = latMax - dLat * r;
        latMin = latMax - dLat;
        lonMin = lonMin + dLon * c;
        lonMax = lonMin + dLon;
        chainPrefix += (chainPrefix ? ',' : '') + String(idx);
      }
      
      const rawResult = [(latMin + latMax) / 2, (lonMin + lonMax) / 2];
      console.log('[decodeRaw] result for', code, ':', rawResult);
      return rawResult;
    },
    
    /**
     * Set passphrase for grid shuffling
     * @param {string} pass
     */
    setPassphrase(pass) {
      passphrase = pass;
      clearGridCache();
      updatePassphraseUI();
      renderCards();
      if (callbacks.onCompactUpdate) callbacks.onCompactUpdate();
    },
    
    /**
     * Get current passphrase
     * @returns {string}
     */
    getPassphrase() {
      return passphrase;
    },
    
    /**
     * Set obfuscation mode
     * @param {boolean} enabled
     */
    setObfuscated(enabled) {
      obfuscated = enabled;
      const obfBtn = document.getElementById('obfuscateBtn');
      if (obfBtn) obfBtn.textContent = obfuscated ? '🔀 Obfuscated' : '🔀 Hierarchical';
      const obfWarning = document.getElementById('obfWarning');
      if (obfWarning) obfWarning.style.display = obfuscated ? 'block' : 'none';
      renderCards();
      if (callbacks.onCompactUpdate) callbacks.onCompactUpdate();
    },
    
    /**
     * Get obfuscation state
     * @returns {boolean}
     */
    isObfuscated() {
      return obfuscated;
    },
    
    /**
     * Set raw mode
     * @param {boolean} enabled
     */
    setRawMode(enabled) {
      rawModeActive = enabled;
      if (rawModeActive) {
        cardState.active = null;
        saveCardState();
      }
      updateRawModeUI();
      renderCards();
      if (callbacks.onCompactUpdate) callbacks.onCompactUpdate();
    },
    
    /**
     * Get raw mode state
     * @returns {boolean}
     */
    isRawMode() {
      return rawModeActive;
    },
    
    /**
     * Get card state
     * @returns {Object}
     */
    getCardState() {
      return cardState;  // Return live reference — external code may read/write this
    },
    
    /**
     * Persist card state to localStorage
     */
    saveCardState() {
      saveCardState();
    },
    
    /**
     * Get grid definitions
     * @returns {Object}
     */
    getGridDefinitions() {
      return CARD_GRIDS;  // Return live reference
    },
    
    /**
     * Show toast notification
     * @param {string} message
     */
    showToast,
    
    /**
     * Show fullscreen view for a grid
     * @param {string} gridKey
     * @param {string} code
     */
    showFullscreen: showCardFullscreen,
    
    /**
     * Show 3x3 grid view
     * @param {string} gridKey
     * @param {string} code
     */
    show3x3: show3x3Grid,
    
    /**
     * Show cell info modal
     * @param {string} gridKey
     * @param {string} code
     * @param {number} iterations
     */
    showCellInfo,
    
    /**
     * Update grid preview in passphrase modal
     */
    updateGridPreview,
    
    /**
     * Decode ChromaCoord scan result
     * @param {string} hexCode - Hex code from scanner
     */
    decodeChromaResult,
    
    /**
     * Show decode banner with passphrase/mode options
     * @param {string} [gridKey] - Grid key that was decoded
     * @param {string} [code] - Code that was decoded
     * @param {number} [decodedLat] - Decoded latitude
     * @param {number} [decodedLon] - Decoded longitude
     */
    showDecodeBanner,
    
    /**
     * Open coordinates in the device's native maps application
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude
     * @param {string} [label] - Optional label for the pin
     */
    openInMaps,
    
    /**
     * Decode a code with optional deobfuscation (for URL parsing)
     * @param {string} gridKey
     * @param {string} code
     * @param {boolean} deobfuscate
     * @returns {[number, number] | null}
     */
    decodeCardCode,
    
    /**
     * Get shuffled grid for a grid key (used by delta encoding)
     * @param {string} gridKey
     * @param {string} [chainPrefix] - Chain prefix for position-dependent shuffling
     * @returns {{ grid: Array, order: Array } | null}
     */
    getShuffledGrid,
    
    /**
     * Clear the grid cache (used when passphrase changes)
     */
    clearGridCache,
    
    /**
     * Compute numeric checksum for a code (3-digit CVC-style)
     * @param {string} code - The code to compute checksum for
     * @returns {string} 3-digit checksum string "000" to "999"
     */
    computeChecksumNumeric,
    
    /**
     * Compute checksum word for a code
     * @param {string} code - The code to compute checksum for
     * @param {string} gridKey - The grid key (e.g., 'bip39english')
     * @returns {string|null} The checksum word
     */
    computeChecksumWord,
    
    /**
     * Validate checksum in a code
     * @param {string} codeWithChecksum - Code with .ChecksumWord
     * @param {string} gridKey - The grid key
     * @returns {{ valid: boolean|null, code: string, checksumWord: string|null }}
     */
    validateChecksum,
    
    /**
     * Check if checksum is enabled for a grid
     * @param {string} gridKey
     * @returns {boolean}
     */
    isChecksumEnabled(gridKey) {
      return !!cardState.checksumEnabled[gridKey];
    },
    
    /**
     * Set checksum enabled for a grid
     * @param {string} gridKey
     * @param {boolean} enabled
     */
    setChecksumEnabled(gridKey, enabled) {
      cardState.checksumEnabled[gridKey] = enabled;
      saveCardState();
      renderCards();
      if (callbacks.onCompactUpdate) callbacks.onCompactUpdate();
    }
  };
  
  // ============== INTERNAL UI HANDLERS ==============
  
  function initCardUIHandlers() {
    // Obfuscate button
    const obfBtn = document.getElementById('obfuscateBtn');
    if (obfBtn) {
      obfBtn.addEventListener('click', () => {
        obfuscated = !obfuscated;
        obfBtn.textContent = obfuscated ? '🔀 Obfuscated' : '🔀 Hierarchical';
        const obfWarning = document.getElementById('obfWarning');
        if (obfWarning) obfWarning.style.display = obfuscated ? 'block' : 'none';
        renderCards();
        if (callbacks.onCompactUpdate) callbacks.onCompactUpdate();
      });
    }
    
    // Passphrase button
    const passBtn = document.getElementById('passphraseBtn');
    if (passBtn) {
      passBtn.addEventListener('click', () => {
        const modal = document.getElementById('passphraseModal');
        if (modal) {
          modal.classList.add('show');
          const input = document.getElementById('passphraseInput');
          if (input) {
            input.value = passphrase;
            input.focus();
          }
          updateGridPreview();
        }
      });
    }
    
    // Close passphrase modal
    const closePassBtn = document.getElementById('closePassModal');
    if (closePassBtn) {
      closePassBtn.addEventListener('click', () => {
        const modal = document.getElementById('passphraseModal');
        if (modal) modal.classList.remove('show');
      });
    }
    
    // Click outside passphrase modal to close
    const passphraseModal = document.getElementById('passphraseModal');
    if (passphraseModal) {
      passphraseModal.addEventListener('click', (e) => {
        if (e.target.id === 'passphraseModal') {
          passphraseModal.classList.remove('show');
        }
      });
    }
    
    // Passphrase input
    const passInput = document.getElementById('passphraseInput');
    if (passInput) {
      passInput.addEventListener('input', (e) => {
        passphrase = e.target.value;
        clearGridCache();
        updateGridPreview();
        updatePassphraseUI();
        renderCards();
        if (callbacks.onCompactUpdate) callbacks.onCompactUpdate();
      });
    }
    
    // Raw mode button
    const rawBtn = document.getElementById('rawModeBtn');
    if (rawBtn) {
      rawBtn.addEventListener('click', () => {
        rawModeActive = !rawModeActive;
        if (rawModeActive) {
          cardState.active = null;
          saveCardState();
        }
        updateRawModeUI();
        renderCards();
        if (callbacks.onCompactUpdate) callbacks.onCompactUpdate();
      });
    }
    
    // Raw share button
    const rawShareBtn = document.getElementById('rawShareBtn');
    if (rawShareBtn) {
      rawShareBtn.addEventListener('click', () => {
        if (!currentCardCoord) {
          showToast('No coordinates to share');
          return;
        }
        const rawCoords = `${currentCardCoord.lat.toFixed(6)},${currentCardCoord.lon.toFixed(6)}`;
        const shareURL = `${window.location.origin}${window.location.pathname}?r=${rawCoords}`;
        const shareText = `${rawCoords}\n${shareURL}`;
        navigator.clipboard.writeText(shareText).then(() => {
          showToast('Raw coords + URL copied!');
        }).catch(() => {
          showToast('Copy failed');
        });
      });
    }
    
    // Coord display click - enter coordinates
    const coordDisplay = document.getElementById('coordDisplay');
    if (coordDisplay) {
      coordDisplay.addEventListener('click', showEnterCoordsModal);
    }
  }
  
  function showEnterCoordsModal() {
    const currentVal = currentCardCoord ? 
      `${currentCardCoord.lat.toFixed(6)}, ${currentCardCoord.lon.toFixed(6)}` : '';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;';
    
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:white;border-radius:12px;padding:20px;max-width:90vw;width:360px;';
    dialog.innerHTML = `
      <h3 style="margin:0 0 12px;font-size:18px;">Enter Coordinates</h3>
      <input type="text" id="rawCoordsInput" placeholder="lat, lon (e.g. 48.8584, 2.2945)" 
        value="${currentVal}"
        style="width:100%;padding:12px;font-size:16px;border:1px solid #ccc;border-radius:8px;box-sizing:border-box;margin-bottom:12px;">
      <div style="display:flex;gap:8px;">
        <button id="goToCoords" style="flex:1;padding:10px;border-radius:8px;border:none;background:#007AFF;color:white;font-size:15px;cursor:pointer;">Go</button>
        <button id="cancelCoords" style="flex:1;padding:10px;border-radius:8px;border:1px solid #ccc;background:#f5f5f5;font-size:15px;cursor:pointer;">Cancel</button>
      </div>
    `;
    modal.appendChild(dialog);
    document.body.appendChild(modal);
    
    const input = dialog.querySelector('#rawCoordsInput');
    input.focus();
    input.select();
    
    dialog.querySelector('#cancelCoords').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    
    dialog.querySelector('#goToCoords').onclick = () => {
      const val = input.value.trim();
      const match = val.match(/(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/);
      if (match) {
        const lat = parseFloat(match[1]);
        const lon = parseFloat(match[2]);
        if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
          setCoordinate(lat, lon);
          const map = callbacks.getMap ? callbacks.getMap() : null;
          if (map) map.setView([lat, lon], 16, { animate: true });
          modal.remove();
          return;
        }
      }
      showToast('Invalid coordinates');
    };
    
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        dialog.querySelector('#goToCoords').click();
      } else if (e.key === 'Escape') {
        modal.remove();
      }
    });
  }

  // ============== EXPORT ==============
  
  // Expose globally
  global.CardRenderer = CardRenderer;
  
  // Also expose encodeCardCoordinate for AudioUI compatibility
  global.encodeCardCoordinate = function(gridKey, lat, lon, iterations) {
    const gridDef = CARD_GRIDS[gridKey];
    const isBarcodeCard = gridDef && (gridDef.display === 'qrhex' || gridDef.display === 'qrbin' || gridDef.display === 'qrurl' || gridDef.display === 'datamatrix');
    const iters = iterations || (isBarcodeCard ? getBarcodeIterations(gridKey)
      : (gridDef?.fixedIterations || cardState.iterations[gridKey] || gridDef?.defaultIterations || 8));
    return _encodeCardCoordinateInternal(gridKey, lat, lon, iters);
  };
  
  // Expose CARD_GRIDS for external use
  global.CARD_GRIDS = CARD_GRIDS;

})(typeof window !== 'undefined' ? window : this);
