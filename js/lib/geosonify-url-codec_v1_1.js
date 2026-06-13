/*
  geosonify-url-codec.v1.0.js
  URL Parameter Encoding/Decoding with Delta Compression
  
  Handles:
  - URL query parameter scheme (?a=, ?oa=, ?e=, ?oe=, ?h=, etc.)
  - Hierarchical coordinate encoding using active grid
  - Obfuscation (suffix-preserving) support
  - Delta compression for paths/polygons
  - Shape parameters (circles, rectangles) with encoded coordinates
  
  Format examples:
  - Point: ?oa=gr8zs35ha
  - Circle: ?oa=gr8zs35ha~1000m
  - Rectangle: ?oa=gr8zs35ha~151deg_45m_15m
  - Path (delta): ?oad=gr8zs35ha~ljlx6~ljw1k
  - Path (fixed-width delta): ?oad5=gr8zs35ha~mwu166mmkkas89z...
  - Polygon: same as path, but last code === first code
  
  Coordinate portion (before ~) uses grid encoding.
  Shape params (after ~) remain in existing format.
*/

(function(global){
  'use strict';
  const __URL_CODEC_VER__ = 'v1.1';
  try { console.log('[geosonify] url-codec ' + __URL_CODEC_VER__ + ' loaded'); } catch(e){}

  // tokenizeCode is used throughout this module with a 2D grid argument,
  // but GeoCodec.tokenizeCode expects a FLAT token array. This local
  // wrapper adapts the signature (flattening a 2D grid if given one) and
  // delegates, so the many bare tokenizeCode(code, grid2D) calls below
  // resolve correctly. Without it the module throws ReferenceError at load.
  function tokenizeCode(code, gridOrFlat) {
    if (typeof GeoCodec === 'undefined' || !GeoCodec.tokenizeCode) return null;
    if (!gridOrFlat) return null;
    const flat = Array.isArray(gridOrFlat[0]) ? gridOrFlat.flat() : gridOrFlat;
    return GeoCodec.tokenizeCode(code, flat);
  }

  // ============== URL PARAMETER DEFINITIONS ==============
  // Query parameter prefixes and their meanings:
  // First character(s): encoding type
  // 'o' prefix: obfuscated
  // 'd' suffix: delta mode (variable width)
  // 'd{n}' suffix: fixed-width delta (n chars per delta)
  
  const PARAM_GRID_MAP = {
    // Hierarchical (non-obfuscated)
    'a': { grid: 'alphanumeric', obfuscated: false },
    'e': { grid: 'emoji', obfuscated: false },
    'h': { grid: 'hexbyte', obfuscated: false },
    'c': { grid: 'chromacoord', obfuscated: false },
    'm': { grid: 'music', obfuscated: false },
    'n': { grid: 'nato', obfuscated: false },
    'b': { grid: 'bytewords', obfuscated: false },
    'w': { grid: 'bytewordsmin', obfuscated: false },
    'y': { grid: 'byteemoji', obfuscated: false },
    '6': { grid: 'base64', obfuscated: false },
    
    // Obfuscated
    'oa': { grid: 'alphanumeric', obfuscated: true },
    'oe': { grid: 'emoji', obfuscated: true },
    'oh': { grid: 'hexbyte', obfuscated: true },
    'oc': { grid: 'chromacoord', obfuscated: true },
    'om': { grid: 'music', obfuscated: true },
    'on': { grid: 'nato', obfuscated: true },
    'ob': { grid: 'bytewords', obfuscated: true },
    'ow': { grid: 'bytewordsmin', obfuscated: true },
    'oy': { grid: 'byteemoji', obfuscated: true },
    'o6': { grid: 'base64', obfuscated: true },
    
    // Raw coordinates (no grid encoding)
    'r': { grid: null, obfuscated: false }
  };

  // Reverse map: grid -> param key
  const GRID_PARAM_MAP = {};
  Object.entries(PARAM_GRID_MAP).forEach(([key, val]) => {
    if (val.grid && key.length <= 2) {
      const prefix = val.obfuscated ? 'o' : '';
      if (!GRID_PARAM_MAP[val.grid]) GRID_PARAM_MAP[val.grid] = {};
      GRID_PARAM_MAP[val.grid][val.obfuscated ? 'obfuscated' : 'hierarchical'] = key;
    }
  });

  // ============== HELPER FUNCTIONS ==============
  
  /**
   * Parse URL query string into parameter map
   */
  function parseQueryString(url) {
    const queryStart = url.indexOf('?');
    if (queryStart === -1) return {};
    
    const params = {};
    const query = url.slice(queryStart + 1);
    query.split('&').forEach(pair => {
      const [key, value] = pair.split('=');
      if (key) params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
    });
    return params;
  }

  /**
   * Detect parameter type from key
   * Returns: { gridKey, obfuscated, deltaMode, deltaWidth, rhumb }
   *
   * Flag suffixes (appended after the grid base in any order):
   *   'o' = obfuscated
   *   'd' = delta mode (optionally followed by digits for fixed width)
   *   'r' = rhumb line mode
   *
   * Examples: a, ad, adr, aod, oad5, ad5r, oar
   */
  function parseParamKey(key) {
    let gridKey = null;
    let obfuscated = false;
    let deltaMode = false;
    let deltaWidth = null;
    let rhumb = false;
    
    // Strategy: try progressively shorter prefixes as the grid base,
    // checking whether the remainder is a valid flag suffix.
    // Longest matching base wins (e.g. 'oa' before 'o').
    
    for (let i = key.length; i >= 1; i--) {
      const candidate = key.slice(0, i);
      const suffix = key.slice(i);
      
      // Validate suffix: optional flags [o,r] + optional 'd' with optional digits + optional [r]
      // Valid suffixes: '', 'o', 'd', 'r', 'od', 'or', 'dr', 'odr', 'd5', 'd5r', 'od5', 'od5r', etc.
      const suffixMatch = suffix.match(/^([or]*)(?:(d)(\d*))?([r]?)$/);
      if (!suffixMatch) continue;
      
      // Check no duplicate flags
      const preFlags = suffixMatch[1] || '';
      const hasDelta = !!suffixMatch[2];
      const digits = suffixMatch[3] || '';
      const postR = suffixMatch[4] || '';
      
      // Disallow duplicate 'r' (one in preFlags and one in postR)
      if (preFlags.includes('r') && postR === 'r') continue;
      // Disallow duplicate chars in preFlags
      if (new Set(preFlags).size !== preFlags.length) continue;
      
      const info = PARAM_GRID_MAP[candidate];
      if (info) {
        gridKey = info.grid;
        obfuscated = info.obfuscated || preFlags.includes('o');
        deltaMode = hasDelta;
        deltaWidth = digits ? parseInt(digits) : null;
        rhumb = preFlags.includes('r') || postR === 'r';
        return { gridKey, obfuscated, deltaMode, deltaWidth, rhumb };
      }
    }
    
    // Direct lookup (no flags recognized)
    const info = PARAM_GRID_MAP[key];
    if (info) {
      gridKey = info.grid;
      obfuscated = info.obfuscated;
    }
    
    return { gridKey, obfuscated, deltaMode, deltaWidth, rhumb };
  }

  /**
   * Build URL parameter key for given options
   */
  function buildParamKey(gridKey, obfuscated, deltaMode, deltaWidth, rhumb) {
    const gridParams = GRID_PARAM_MAP[gridKey];
    if (!gridParams) return null;
    
    let key = obfuscated ? gridParams.obfuscated : gridParams.hierarchical;
    if (!key) return null;
    
    if (deltaMode) {
      key += 'd';
      if (deltaWidth) key += deltaWidth;
    }
    if (rhumb) key += 'r';
    
    return key;
  }

  // ============== COORDINATE ENCODING ==============
  
  /**
   * Encode a single coordinate to grid code
   * Requires GeoCodec and grid data to be available
   */
  function encodeCoordinate(lat, lon, grid2D, iterations, obfuscate) {
    if (!grid2D || typeof GeoCodec === 'undefined') return null;
    
    let code = GeoCodec.encodeHierarchical(lat, lon, grid2D, iterations);
    
    if (obfuscate && code) {
      const flat = grid2D.flat();
      code = GeoCodec.applyObfuscation('encode', code, flat);
    }
    
    return code;
  }

  /**
   * Decode a single code to coordinates
   */
  function decodeCoordinate(code, grid2D, iterations, deobfuscate) {
    if (!grid2D || typeof GeoCodec === 'undefined') return null;
    
    let codeToUse = code;
    if (deobfuscate) {
      const flat = grid2D.flat();
      codeToUse = GeoCodec.applyObfuscation('decode', code, flat);
    }
    
    return GeoCodec.decodeHierarchical(codeToUse, grid2D, iterations);
  }

  // ============== DELTA ENCODING (DELTA WITH GEAR CHANGES) ==============
  //
  // New (v2) delta format (self-delimiting hex gear headers):
  //   firstCode~d<hexN><payload>~dd<hex2><payload>~ddd<hex3><payload>...
  //
  // Where:
  //   - After "~", a segment begins with 1+ "d" characters (let that count be K).
  //   - Then EXACTLY K hex digits follow, giving N = parseInt(hexDigits, 16).
  //   - The remainder of the segment is the payload: concatenated token chunks, each chunk = N TOKENS.
  //
  // Examples:
  //   ~d6...      => N=6
  //   ~dH...      => N=15
  //   ~dd10...    => N=16
  //   ~ddHH...    => N=255
  //
  // This section:
  //   - Encodes deltas RELATIVE TO PREVIOUS point (better compression).
  //   - Packs gear runs optimally (tiny DP).
  //   - Decodes both:
  //       (a) new gear-run hex header format
  //       (b) your legacy formats:
  //           - variable-width "~"-separated deltas (relative to firstCode)
  //           - fixedWidth mode with "*" escape (relative to firstCode)
  //           - legacy "dN=payload" runs (relative to previous), if you ever emitted those

  function _deobfuscateIfNeeded(code, grid2D, isObfuscated) {
    if (!isObfuscated || typeof GeoCodec === 'undefined') return code;
    const flat = grid2D.flat();
    return GeoCodec.applyObfuscation('decode', code, flat);
  }

  function _tokenCountCommonPrefix(tokensA, tokensB) {
    const minLen = Math.min(tokensA.length, tokensB.length);
    let common = 0;
    for (let i = 0; i < minLen; i++) {
      if (tokensA[i] === tokensB[i]) common++;
      else break;
    }
    return common;
  }

  // --- New header helpers: d{K}{HEX_K} ---
  function _encodeGearHeaderHex(N) {
    // Return string like "d6" or "dH" or "dd10" or "ddHH"
    if (!Number.isFinite(N) || N <= 0) throw new Error('Gear N must be positive');
    const hex = N.toString(16).toUpperCase(); // use 0-9A-F
    const K = hex.length;
    return 'd'.repeat(K) + hex;
  }

  function _parseGearHeaderHex(seg) {
    // seg starts with 'd'. Parse leading d-run and exactly that many hex digits.
    // Returns { N, payload } or null if not matching.
    let k = 0;
    while (k < seg.length && seg[k] === 'd') k++;
    if (k === 0) return null;
    if (k + k > seg.length) return null; // need k hex digits
    const hex = seg.slice(k, k + k);
    if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
    if (hex[0] === '0') return null; // forbid leading zero (dd0F etc.)
    const N = parseInt(hex, 16);
    if (!Number.isFinite(N) || N <= 0) return null; // forbid 0
    const payload = seg.slice(k + k);
    return { N, payload };
  }

  // --- Legacy header parser: d<digits>=payload ---
  function _parseGearHeaderLegacyEq(seg) {
    if (seg[0] !== 'd') return null;
    const eq = seg.indexOf('=');
    if (eq === -1) return null;
    const nStr = seg.slice(1, eq);
    if (!/^\d+$/.test(nStr)) return null;
    const N = parseInt(nStr, 10);
    if (!Number.isFinite(N) || N <= 0) return null;
    const payload = seg.slice(eq + 1);
    return { N, payload };
  }

  function _parseGearSegments(deltaString) {
    // Split by "~" and parse each as new-hex header first, else legacy dN=.
    const segs = (deltaString || '').split('~').filter(Boolean);
    if (!segs.length) return null;

    const runs = [];
    for (const seg of segs) {
      if (seg[0] !== 'd') return null;
      let parsed = _parseGearHeaderHex(seg);
      if (!parsed) parsed = _parseGearHeaderLegacyEq(seg);
      if (!parsed) return null;
      runs.push(parsed);
    }
    return runs;
  }

  function _expandRunsToDeltaTokenGroups(runs, grid2D) {
    // Each run has payload containing concatenated token chunks of size N tokens.
    const groups = [];
    for (const run of runs) {
      const { N, payload } = run;
      const payloadTokens = tokenizeCode(payload, grid2D);
      if (!payloadTokens) throw new Error('Failed to tokenize gear payload');
      if (payloadTokens.length % N !== 0) {
        throw new Error(`Gear payload token count ${payloadTokens.length} not divisible by N=${N}`);
      }
      for (let i = 0; i < payloadTokens.length; i += N) {
        groups.push(payloadTokens.slice(i, i + N));
      }
    }
    return groups;
  }

  function _applyDeltaTokensToHier(prevHierCode, deltaTokens, grid2D) {
    const prevTokens = tokenizeCode(prevHierCode, grid2D);
    if (!prevTokens) return null;
    const N = deltaTokens.length;
    const prefixLen = prevTokens.length - N;
    if (prefixLen < 0) return null;
    return prevTokens.slice(0, prefixLen).concat(deltaTokens).join('');
  }

  function _encodeDeltaGearRunsOptimal(codes, grid2D, obfuscate) {
    // Work in hierarchical space for delta math
    const hier = codes.map(c => _deobfuscateIfNeeded(c, grid2D, obfuscate));
    const tokenLists = hier.map(hc => tokenizeCode(hc, grid2D));
    if (tokenLists.some(t => !t)) return null;

    const L = tokenLists[0].length;
    if (tokenLists.some(t => t.length !== L)) return null; // should be constant for given iterations

    // need[i] = min tokens to replace for transition i-1 -> i
    const need = new Array(hier.length).fill(0);

    // suffixStr[i][g] = string for last g tokens of tokenLists[i]
    const suffixStr = Array.from({ length: hier.length }, () => new Array(L + 1).fill(''));
    const suffixStrLen = Array.from({ length: hier.length }, () => new Array(L + 1).fill(Infinity));

    for (let i = 1; i < hier.length; i++) {
      const a = tokenLists[i - 1];
      const b = tokenLists[i];
      const common = _tokenCountCommonPrefix(a, b);
      const needN = L - common;
      need[i] = needN;

      for (let g = needN; g <= L; g++) {
        const s = b.slice(L - g).join('');
        suffixStr[i][g] = s;
        suffixStrLen[i][g] = s.length;
      }
    }

    // DP: dp[i][g] = min cost for encoding transitions up to i (i is token index),
    // ending with gear g for transition to i.
    // Cost counts deltaString only, assuming segments are separated by "~".
    const INF = 1e15;
    const dp = Array.from({ length: hier.length }, () => new Array(L + 1).fill(INF));
    const back = Array.from({ length: hier.length }, () => new Array(L + 1).fill(null));

    // First transition (to i=1): start a segment with header + chunk (no leading "~" inside deltaString)
    for (let g = need[1]; g <= L; g++) {
      if (g <= 0) continue;
      const headerLen = _encodeGearHeaderHex(g).length; // e.g. "d6" or "dd10"
      dp[1][g] = headerLen + suffixStrLen[1][g];
      back[1][g] = { prevG: 0, switched: true };
    }

    for (let i = 2; i < hier.length; i++) {
      for (let gPrev = 1; gPrev <= L; gPrev++) {
        const prevCost = dp[i - 1][gPrev];
        if (prevCost >= INF) continue;

        // Continue same segment if allowed
        if (gPrev >= need[i]) {
          const cost = prevCost + suffixStrLen[i][gPrev];
          if (cost < dp[i][gPrev]) {
            dp[i][gPrev] = cost;
            back[i][gPrev] = { prevG: gPrev, switched: false };
          }
        }

        // Switch segment: pay "~" + header + chunk
        for (let gNew = Math.max(1, need[i]); gNew <= L; gNew++) {
          const headerLen = _encodeGearHeaderHex(gNew).length;
          const cost = prevCost + 1 + headerLen + suffixStrLen[i][gNew]; // +1 for "~"
          if (cost < dp[i][gNew]) {
            dp[i][gNew] = cost;
            back[i][gNew] = { prevG: gPrev, switched: true };
          }
        }
      }
    }

    // Pick best ending gear
    let bestG = 1;
    let bestCost = INF;
    for (let g = 1; g <= L; g++) {
      if (dp[hier.length - 1][g] < bestCost) {
        bestCost = dp[hier.length - 1][g];
        bestG = g;
      }
    }
    if (bestCost >= INF) return null;

    // Reconstruct chosen gear per step
    const gearAt = new Array(hier.length).fill(0);
    let g = bestG;
    for (let i = hier.length - 1; i >= 1; i--) {
      gearAt[i] = g;
      const b = back[i][g];
      if (!b) return null;
      g = b.prevG;
    }

    // Build segments: ["d6<payload>", "d4<payload>", ...]
    const segments = [];
    let currentGear = 0;
    let payload = '';

    function flush() {
      if (!currentGear) return;
      segments.push(_encodeGearHeaderHex(currentGear) + payload);
      payload = '';
    }

    for (let i = 1; i < hier.length; i++) {
      const gi = gearAt[i];
      const chunk = suffixStr[i][gi];
      if (gi !== currentGear) {
        flush();
        currentGear = gi;
      }
      payload += chunk;
    }
    flush();

    return segments;
  }

  /**
   * Calculate delta suffix between two codes (legacy helper)
   * Returns the minimum suffix that differs, based on TOKEN comparison.
   *
   * IMPORTANT: For obfuscated codes, deobfuscate FIRST, then calculate delta,
   * because obfuscation preserves last char (anchors hash).
   */
  function calculateDelta(firstCode, nextCode, grid2D, isObfuscated) {
    let code1 = firstCode;
    let code2 = nextCode;

    if (isObfuscated && typeof GeoCodec !== 'undefined') {
      const flat = grid2D.flat();
      code1 = GeoCodec.applyObfuscation('decode', firstCode, flat);
      code2 = GeoCodec.applyObfuscation('decode', nextCode, flat);
    }

    const tokens1 = tokenizeCode(code1, grid2D);
    const tokens2 = tokenizeCode(code2, grid2D);
    if (!tokens1 || !tokens2) return null;

    let commonPrefix = 0;
    const minLen = Math.min(tokens1.length, tokens2.length);
    for (let i = 0; i < minLen; i++) {
      if (tokens1[i] === tokens2[i]) commonPrefix++;
      else break;
    }

    const deltaSuffix = tokens2.slice(commonPrefix).join('');
    return {
      prefixLength: commonPrefix,
      suffix: deltaSuffix,
      suffixTokens: tokens2.slice(commonPrefix)
    };
  }

  /**
   * Apply delta to reconstruct a code (legacy helper, relative to FIRST code)
   */
  function applyDelta(firstCode, deltaSuffix, grid2D, isObfuscated) {
    let baseCode = firstCode;

    if (isObfuscated && typeof GeoCodec !== 'undefined') {
      const flat = grid2D.flat();
      baseCode = GeoCodec.applyObfuscation('decode', firstCode, flat);
    }

    const tokens = tokenizeCode(baseCode, grid2D);
    const deltaTokens = tokenizeCode(deltaSuffix, grid2D);
    if (!tokens || !deltaTokens) return null;

    const prefixLen = tokens.length - deltaTokens.length;
    if (prefixLen < 0) return null;

    const newTokens = tokens.slice(0, prefixLen).concat(deltaTokens);
    return newTokens.join('');
  }

  /**
   * Encode multiple coordinates with delta compression
   *
   * If useFixedWidth is true: keep LEGACY fixed-width scheme (relative to firstCode).
   * Else: NEW optimal gear-run scheme (relative to previous code).
   *
   * Returns: { firstCode, deltas: [...segments], fixedWidth: number|null }
   */
  function encodePath(coords, grid2D, iterations, obfuscate, useFixedWidth) {
    if (!coords || coords.length === 0) return null;

    const codes = coords.map(([lat, lon]) =>
      encodeCoordinate(lat, lon, grid2D, iterations, obfuscate)
    );

    if (codes.some(c => !c)) return null;
    if (codes.length === 1) return { firstCode: codes[0], deltas: [], fixedWidth: null };

    // ---- LEGACY fixed-width mode (unchanged) ----
    if (useFixedWidth) {
      const deltas = [];
      for (let i = 1; i < codes.length; i++) {
        const delta = calculateDelta(codes[0], codes[i], grid2D, obfuscate);
        if (!delta) return null;
        deltas.push(delta.suffix);
      }

      let fixedWidth = null;
      if (deltas.length > 1) {
        const maxLen = Math.max(...deltas.map(d => d.length));
        let bestWidth = maxLen;
        let bestTotal = Infinity;

        for (let w = 3; w <= Math.min(maxLen + 2, 10); w++) {
          let total = 0;
          for (const d of deltas) {
            if (d.length <= w) total += w;
            else total += 1 + String(d.length).length + d.length; // *{len}{delta}
          }
          if (total < bestTotal) {
            bestTotal = total;
            bestWidth = w;
          }
        }
        fixedWidth = bestWidth;
      }

      return { firstCode: codes[0], deltas, fixedWidth };
    }

    // ---- NEW optimal gear-run mode (relative to previous) ----
    const segments = _encodeDeltaGearRunsOptimal(codes, grid2D, obfuscate);
    if (!segments) return null;

    return { firstCode: codes[0], deltas: segments, fixedWidth: null };
  }

  /**
   * Decode a path from delta-encoded string
   *
   * Supports:
   *  - NEW gear-run hex-header format (relative to previous)
   *      d<hexN><payload>~dd<hex2><payload>...
   *  - Legacy dN=payload runs (relative to previous)
   *  - Legacy variable-width "~"-separated deltas (relative to firstCode)
   *  - Legacy fixedWidth (relative to firstCode)
   */
  function decodePath(firstCode, deltaString, grid2D, iterations, isObfuscated, fixedWidth) {
    const coords = [];

    // Decode first coordinate
    const firstCoord = decodeCoordinate(firstCode, grid2D, iterations, isObfuscated);
    if (!firstCoord) return null;
    coords.push(firstCoord);

    if (!deltaString) return coords;

    // ---- LEGACY fixed-width mode (unchanged) ----
    if (fixedWidth) {
      let deltas = [];
      let pos = 0;
      while (pos < deltaString.length) {
        if (deltaString[pos] === '*') {
          pos++;
          const lenMatch = deltaString.slice(pos).match(/^(\d+)/);
          if (!lenMatch) break;
          const len = parseInt(lenMatch[1]);
          pos += lenMatch[1].length;
          deltas.push(deltaString.slice(pos, pos + len));
          pos += len;
        } else {
          deltas.push(deltaString.slice(pos, pos + fixedWidth));
          pos += fixedWidth;
        }
      }

      for (const delta of deltas) {
        const fullCode = applyDelta(firstCode, delta, grid2D, isObfuscated);
        if (!fullCode) continue;
        const coord = decodeCoordinate(fullCode, grid2D, iterations, false);
        if (coord) coords.push(coord);
      }
      return coords;
    }

    // ---- Try NEW gear-run formats first ----
    const runs = _parseGearSegments(deltaString);
    if (runs) {
      let prevHier = _deobfuscateIfNeeded(firstCode, grid2D, isObfuscated);

      let groups;
      try {
        groups = _expandRunsToDeltaTokenGroups(runs, grid2D);
      } catch (e) {
        // If parsing/tokenization fails, fall back to legacy
        groups = null;
      }

      if (groups) {
        for (const deltaTokens of groups) {
          const nextHier = _applyDeltaTokensToHier(prevHier, deltaTokens, grid2D);
          if (!nextHier) continue;
          prevHier = nextHier;

          const coord = decodeCoordinate(nextHier, grid2D, iterations, false);
          if (coord) coords.push(coord);
        }
        return coords;
      }
    }

    // ---- Fallback: legacy variable-width "~" separated deltas (relative to firstCode) ----
    const deltas = deltaString.split('~').filter(Boolean);
    for (const delta of deltas) {
      const fullCode = applyDelta(firstCode, delta, grid2D, isObfuscated);
      if (!fullCode) continue;

      const coord = decodeCoordinate(fullCode, grid2D, iterations, false);
      if (coord) coords.push(coord);
    }

    return coords;
  }


  // ============== SHAPE PARSING ==============
  
  /**
   * Parse a shape string (coordinate + optional shape params)
   * Format: CODE~PARAMS or CODE (point only)
   * 
   * Shape params examples:
   * - Circle: 1000m
   * - Rectangle: 151deg_45m_15m
   * - Path deltas: code2~code3~code4
   */
  function parseShapeString(value) {
    // Split on first ~ to separate coordinate from rest
    const tildePos = value.indexOf('~');
    
    if (tildePos === -1) {
      // Just a coordinate code (point)
      return {
        type: 'point',
        coordCode: value,
        params: null
      };
    }
    
    const coordCode = value.slice(0, tildePos);
    const rest = value.slice(tildePos + 1);
    
    // Check if it's a shape param or more coordinates (delta)
    // Circle: ends with 'm' and is numeric
    // Rectangle: contains 'deg'
    // Delta path: contains more ~ or looks like grid codes
    
    if (/^\d+(\.\d+)?m$/.test(rest)) {
      // Circle: radius in meters
      return {
        type: 'circle',
        coordCode: coordCode,
        params: { radius: parseFloat(rest) }
      };
    }
    
    if (rest.includes('deg')) {
      // Rectangle: angle_length_width
      const parts = rest.split('_');
      const angle = parseFloat(parts[0]);
      const length = parseFloat(parts[1] || '0');
      const width = parseFloat(parts[2] || '0');
      return {
        type: 'rectangle',
        coordCode: coordCode,
        params: { angle, length, width }
      };
    }
    
    // Assume delta path
    return {
      type: 'path',
      coordCode: coordCode,
      deltaString: rest
    };
  }

  /**
   * Build a shape string from components
   */
  function buildShapeString(type, coordCode, params) {
    if (type === 'point') {
      return coordCode;
    }
    
    if (type === 'circle') {
      return `${coordCode}~${params.radius}m`;
    }
    
    if (type === 'rectangle') {
      return `${coordCode}~${params.angle}deg_${params.length}m_${params.width}m`;
    }
    
    if (type === 'path' && params.deltas) {
      if (params.fixedWidth) {
        // Fixed width: no tildes between deltas
        return `${coordCode}~${params.deltas.join('')}`;
      } else {
        // Variable width: tilde-separated
        return `${coordCode}~${params.deltas.join('~')}`;
      }
    }
    
    return coordCode;
  }

  // ============== URL BUILDING/PARSING ==============
  
  /**
   * Build a shareable URL for a shape
   */
  function buildShareURL(baseUrl, options) {
    const {
      gridKey,
      obfuscated = false,
      deltaMode = false,
      deltaWidth = null,
      shapeType = 'point',
      coordCode,
      shapeParams = null,
      passphrase = null
    } = options;
    
    // Build parameter key
    const paramKey = buildParamKey(gridKey, obfuscated, deltaMode, deltaWidth);
    if (!paramKey) return null;
    
    // Build value
    const value = buildShapeString(shapeType, coordCode, shapeParams);
    
    // Build URL
    let url = baseUrl + '?' + paramKey + '=' + encodeURIComponent(value);
    
    // Add passphrase hint if needed
    if (passphrase) {
      url += '&p=1'; // Just indicate passphrase is needed, don't expose it
    }
    
    return url;
  }

  /**
   * Parse a geosonify URL
   * Returns: { gridKey, obfuscated, deltaMode, deltaWidth, shape, needsPassphrase }
   */
  function parseShareURL(url) {
    const params = parseQueryString(url);
    const needsPassphrase = params.p === '1';
    
    // Find the encoding parameter
    for (const [key, value] of Object.entries(params)) {
      if (key === 'p') continue;
      
      const paramInfo = parseParamKey(key);
      if (paramInfo.gridKey || paramInfo.gridKey === null) {
        const shape = parseShapeString(value);
        return {
          ...paramInfo,
          shape,
          needsPassphrase,
          rawValue: value
        };
      }
    }
    
    return null;
  }

  // ============== HIGH-LEVEL API ==============
  
  /**
   * Encode a point/shape to shareable format
   */
  function encodeForShare(options) {
    const {
      coords,           // [lat, lon] or array of coords for path
      gridKey,
      grid2D,
      iterations,
      obfuscate = false,
      shapeType = 'point',
      shapeParams = null, // { radius } for circle, { angle, length, width } for rect
      useDeltaEncoding = false,
      useFixedWidthDelta = false
    } = options;
    
    if (!coords || !grid2D) return null;
    
    // Single point or shape with single centroid
    if (!Array.isArray(coords[0])) {
      const coordCode = encodeCoordinate(coords[0], coords[1], grid2D, iterations, obfuscate);
      return {
        paramKey: buildParamKey(gridKey, obfuscate, false, null),
        value: buildShapeString(shapeType, coordCode, shapeParams),
        coordCode,
        shapeType
      };
    }
    
    // Multiple coords (path/polygon)
    if (useDeltaEncoding) {
      const encoded = encodePath(coords, grid2D, iterations, obfuscate, useFixedWidthDelta);
      if (!encoded) return null;
      
      return {
        paramKey: buildParamKey(gridKey, obfuscate, true, encoded.fixedWidth),
        value: buildShapeString('path', encoded.firstCode, { 
          deltas: encoded.deltas, 
          fixedWidth: encoded.fixedWidth 
        }),
        coordCode: encoded.firstCode,
        deltas: encoded.deltas,
        fixedWidth: encoded.fixedWidth,
        shapeType: 'path'
      };
    } else {
      // Full codes separated by ~
      const codes = coords.map(([lat, lon]) => 
        encodeCoordinate(lat, lon, grid2D, iterations, obfuscate)
      );
      return {
        paramKey: buildParamKey(gridKey, obfuscate, false, null),
        value: codes.join('~'),
        codes,
        shapeType: coords.length > 2 && 
          coords[0][0] === coords[coords.length-1][0] && 
          coords[0][1] === coords[coords.length-1][1] ? 'polygon' : 'path'
      };
    }
  }

  /**
   * Decode from shareable format
   */
  function decodeFromShare(parsed, grid2D, iterations) {
    if (!parsed || !grid2D) return null;
    
    const { shape, obfuscated, deltaMode, deltaWidth } = parsed;
    
    if (shape.type === 'point') {
      const coord = decodeCoordinate(shape.coordCode, grid2D, iterations, obfuscated);
      return coord ? { type: 'point', coords: [coord] } : null;
    }
    
    if (shape.type === 'circle') {
      const coord = decodeCoordinate(shape.coordCode, grid2D, iterations, obfuscated);
      return coord ? { type: 'circle', coords: [coord], params: shape.params } : null;
    }
    
    if (shape.type === 'rectangle') {
      const coord = decodeCoordinate(shape.coordCode, grid2D, iterations, obfuscated);
      return coord ? { type: 'rectangle', coords: [coord], params: shape.params } : null;
    }
    
    if (shape.type === 'path') {
      const coords = decodePath(
        shape.coordCode, 
        shape.deltaString, 
        grid2D, 
        iterations, 
        obfuscated, 
        deltaWidth
      );
      
      if (!coords) return null;
      
      // Check if polygon (first == last)
      const isPolygon = coords.length > 2 &&
        coords[0][0] === coords[coords.length-1][0] &&
        coords[0][1] === coords[coords.length-1][1];
      
      return {
        type: isPolygon ? 'polygon' : 'path',
        coords
      };
    }
    
    return null;
  }

  // ============== EXPORTS ==============
  
  global.GeoURLCodec = {
    version: __URL_CODEC_VER__,
    
    // Parameter handling
    PARAM_GRID_MAP,
    GRID_PARAM_MAP,
    parseParamKey,
    buildParamKey,
    parseQueryString,
    
    // Coordinate encoding
    encodeCoordinate,
    decodeCoordinate,
    tokenizeCode,
    
    // Delta encoding
    calculateDelta,
    applyDelta,
    encodePath,
    decodePath,
    
    // Shape handling
    parseShapeString,
    buildShapeString,
    
    // URL handling
    buildShareURL,
    parseShareURL,
    
    // High-level API
    encodeForShare,
    decodeFromShare
  };

})(typeof window !== 'undefined' ? window : this);
