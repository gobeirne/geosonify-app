/*
  geosonify-delta-gear.js v1.0
  Gear-change delta encoding for compact path representation
  
  Uses dynamic programming to find optimal gear (delta width) for each segment,
  minimizing total encoded length. The gear-change format allows variable-width
  deltas within a single encoded string.
  
  Format: firstCode~d{K}{HEX_K}{payload}...
  - K = number of 'd' characters = number of hex digits for the gear value
  - HEX_K = gear value (delta width) in hex
  - payload = concatenated deltas of that width
  
  Example: ABC123~dd05XYZPQR~d3RST
  - First code: ABC123
  - dd05 = gear 5 (2 d's, 2 hex digits "05"), payload XYZPQ R (5 chars each)
  - d3 = gear 3 (1 d, 1 hex digit "3"), payload RST (3 chars)
  
  Dependencies: None
  
  Exports (via window.DeltaGear):
  - encodeGearPath(codes) - Encode array of codes using DP-optimal gear changes
  - decodeGearPath(encoded) - Decode gear-change encoded string to array of codes
  - gearK(N) - Calculate number of hex digits needed for gear value N
  - makeHeader(N) - Create gear header for value N
  - headerLen(N) - Calculate header length for gear N
*/

(function(global) {
  'use strict';

  const __DELTA_GEAR_VER__ = 'v1.0';
  try { console.log('[geosonify] delta-gear ' + __DELTA_GEAR_VER__ + ' loaded'); } catch(e) {}

  // ================= Token model =================
  function tokenize(code) { return Array.from(code); }
  function joinTokens(t) { return t.join(''); }

  function commonPrefixLen(a, b) {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return i;
  }

  /**
   * Calculate number of hex digits needed for gear value N
   * @param {number} N - Gear value (delta width)
   * @returns {number} Number of hex digits
   */
  function gearK(N) {
    return Math.max(1, N.toString(16).length);
  }

  /**
   * Create gear header for value N
   * Format: 'd' repeated K times, followed by K hex digits
   * @param {number} N - Gear value (delta width)
   * @returns {string} Header string like "d5" or "dd10"
   */
  function makeHeader(N) {
    const K = gearK(N);
    const hex = N.toString(16).toUpperCase();
    return 'd'.repeat(K) + hex.padStart(K, '0');
  }

  /**
   * Calculate header length for gear N
   * Header = K d's + K hex chars = 2K chars, plus tilde
   * @param {number} N - Gear value
   * @returns {number} Header length including the tilde prefix
   */
  function headerLen(N) {
    const K = gearK(N);
    return 1 + 2 * K; // tilde + 2K chars
  }

  /**
   * Parse a gear segment (after the tilde)
   * @param {string} seg - Segment string like "d5payload" or "dd10payload"
   * @returns {{ N: number, payload: string }} Parsed gear and payload
   */
  function parseSegment(seg) {
    let K = 0;
    while (seg[K] === 'd') K++;
    const hex = seg.slice(K, K + K);
    const N = parseInt(hex, 16);
    return { N, payload: seg.slice(K + K) };
  }

  // ================= Decoder =================
  
  /**
   * Decode a gear-change encoded path back to array of codes
   * @param {string} encoded - Encoded string like "ABC123~d5XYZPQ~d3RST"
   * @returns {string[]} Array of decoded codes
   */
  function decodeGearPath(encoded) {
    console.log('[delta-gear] decodeGearPath called with:', encoded.substring(0, 80) + '...');
    
    const parts = encoded.split('~').filter(Boolean);
    console.log('[delta-gear] Split into', parts.length, 'parts');
    
    if (parts.length === 0) return [];
    
    const first = parts[0];
    const L = tokenize(first).length;
    let current = first;
    const out = [first];
    
    console.log('[delta-gear] First code:', first, 'L:', L);

    for (let i = 1; i < parts.length; i++) {
      const seg = parts[i];
      
      // New format: gear-change segment starts with 'd'
      if (seg.startsWith('d')) {
        const { N, payload } = parseSegment(seg);
        const p = tokenize(payload);
        
        console.log('[delta-gear] Gear segment:', seg.substring(0, 20), '\u2192 N:', N, 'payload len:', payload.length);
        
        // Process payload in chunks of N tokens
        for (let j = 0; j < p.length; j += N) {
          const ct = tokenize(current);
          current = joinTokens(ct.slice(0, L - N).concat(p.slice(j, j + N)));
          out.push(current);
        }
        continue;
      }
      
      // Old format: single hex digit header + payload (no 'd' prefix)
      // Detect: first char is hex, payload length is divisible by N, and N < L
      const hexMatch = seg.match(/^([0-9A-Fa-f])(.+)$/);
      if (hexMatch) {
        const N = parseInt(hexMatch[1], 16);
        const payload = hexMatch[2];
        if (N > 0 && N < L && payload.length >= N && payload.length % N === 0) {
          const p = tokenize(payload);
          
          console.log('[delta-gear] Old-format gear:', seg.substring(0, 20), '\u2192 N:', N, 'payload len:', payload.length);
          
          // Process payload in chunks of N tokens
          for (let j = 0; j < p.length; j += N) {
            const ct = tokenize(current);
            current = joinTokens(ct.slice(0, L - N).concat(p.slice(j, j + N)));
            out.push(current);
          }
          continue;
        }
      }
      
      // Fallback: variable-width delta suffix
      const delta = seg;
      const ct = tokenize(current);
      const N = delta.length;
      current = joinTokens(ct.slice(0, L - N).concat(tokenize(delta)));
      out.push(current);
      console.log('[delta-gear] Variable delta:', delta, '\u2192', current);
    }
    
    console.log('[delta-gear] Decoded', out.length, 'codes');
    console.log('[delta-gear] First 3 codes:', out.slice(0, 3));
    
    return out;
  }

  // ================= Encoder (DP optimal) =================
  
  /**
   * Encode array of codes using DP-optimal gear-change encoding
   * Minimizes total encoded length by finding optimal gear for each segment
   * @param {string[]} codes - Array of codes to encode
   * @returns {string} Encoded string
   */
  function encodeGearPath(codes) {
    if (!codes || codes.length === 0) return '';
    if (codes.length === 1) return codes[0];
    
    const L = tokenize(codes[0]).length;
    const tok = codes.map(tokenize);
    const S = codes.length - 1; // Number of transitions (deltas)

    // Calculate minimum gear needed for each transition
    // need[s] = minimum delta width for transition s (1-indexed)
    const need = new Array(S + 1);
    for (let s = 1; s <= S; s++) {
      const cp = commonPrefixLen(tok[s - 1], tok[s]);
      need[s] = Math.max(1, L - cp);
    }

    const INF = 1e15;
    
    // dp[s][g] = minimum cost to encode transitions 1..s with gear g at step s
    const dp = Array.from({ length: S + 1 }, () => Array(L + 1).fill(INF));
    const back = Array.from({ length: S + 1 }, () => Array(L + 1).fill(-1));

    // Base case: first transition
    for (let g = need[1]; g <= L; g++) {
      dp[1][g] = headerLen(g) + g; // Header + one delta of width g
    }

    // Fill DP table
    for (let s = 2; s <= S; s++) {
      for (let g = need[s]; g <= L; g++) {
        for (let pg = 1; pg <= L; pg++) {
          if (dp[s - 1][pg] === INF) continue;
          
          // Cost: if same gear, just add delta width
          // If different gear, add header + delta width
          const cost = dp[s - 1][pg] + (pg === g ? g : headerLen(g) + g);
          
          if (cost < dp[s][g]) {
            dp[s][g] = cost;
            back[s][g] = pg;
          }
        }
      }
    }

    // Find optimal final gear
    let gBest = 1;
    for (let g = 1; g <= L; g++) {
      if (dp[S][g] < dp[S][gBest]) gBest = g;
    }

    // Backtrack to find gear sequence
    const gear = new Array(S + 1);
    gear[S] = gBest;
    for (let s = S; s > 1; s--) {
      gear[s - 1] = back[s][gear[s]];
    }

    // Build output
    let out = codes[0];
    let curG = 0;
    let payload = '';

    function flush() {
      if (curG) out += '~' + makeHeader(curG) + payload;
      payload = '';
    }

    for (let s = 1; s <= S; s++) {
      if (gear[s] !== curG) {
        flush();
        curG = gear[s];
      }
      payload += joinTokens(tok[s].slice(L - curG));
    }
    flush();
    
    return out;
  }

  /**
   * Compare gear-change encoding with simple variable-width encoding
   * Returns the shorter of the two
   * @param {string[]} codes - Array of codes to encode
   * @returns {{ encoded: string, method: string, savings: number }}
   */
  function encodeBest(codes) {
    if (!codes || codes.length <= 1) {
      return {
        encoded: codes ? codes[0] || '' : '',
        method: 'none',
        savings: 0
      };
    }
    
    // Variable-width: just tildes between deltas
    const L = tokenize(codes[0]).length;
    const tok = codes.map(tokenize);
    const variableDeltas = [];
    
    for (let i = 1; i < codes.length; i++) {
      const cp = commonPrefixLen(tok[i - 1], tok[i]);
      const delta = codes[i].slice(cp);
      variableDeltas.push(delta || codes[i]); // Full code if no common prefix
    }
    
    const variableResult = codes[0] + '~' + variableDeltas.join('~');
    const gearResult = encodeGearPath(codes);
    
    if (gearResult.length < variableResult.length) {
      return {
        encoded: gearResult,
        method: 'gear',
        savings: variableResult.length - gearResult.length
      };
    } else {
      return {
        encoded: variableResult,
        method: 'variable',
        savings: gearResult.length - variableResult.length
      };
    }
  }

  // ================= EXPORT =================

  global.DeltaGear = {
    // Version
    version: __DELTA_GEAR_VER__,

    // Core functions
    encodeGearPath,
    decodeGearPath,
    encodeBest,
    
    // Helper functions
    gearK,
    makeHeader,
    headerLen,
    parseSegment,
    commonPrefixLen,
    
    // Token utilities (for advanced use)
    tokenize,
    joinTokens
  };

})(typeof window !== 'undefined' ? window : this);
