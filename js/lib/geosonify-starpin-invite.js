/*
  geosonify-starpin-invite.js v0.1 — group-v1 invite links (NOT FROZEN)

  Turns a group credential into a shareable link, and back. The credential is
  descriptor + code:
    descriptor = group_uuid, epoch, endpoint, label   (locator; NOT secret)
    code       = the bearer secret                     (membership itself)

  TWO link modes, chosen per invite by the creator:
    - 'descriptor'  : link carries only the descriptor. You send the code by a
                      separate channel. A leaked link alone gets nobody in.
    - 'full'        : link ALSO carries the code, in the URL FRAGMENT (#…), so a
                      one-tap join is possible. Convenient, less safe: the link IS
                      the secret. Use only over a trusted channel.

  WHY the fragment for the code: everything after '#' is never sent to the server
  in an HTTP request, so the endpoint, hosting, CDN and analytics never log it.
  A code in the query string (?) would be written into server logs everywhere the
  link travels. Descriptor (non-secret) goes in the query; code (secret) NEVER
  does — only ever the fragment, and only in 'full' mode.

  URL SHAPE (the param name is an ADDITIVE entry in the app's frozen URL grammar):
    https://HOST/APP?spgroup=<b64url(descriptor-json)>            (descriptor mode)
    https://HOST/APP?spgroup=<b64url(descriptor-json)>#spcode=<code>   (full mode)

  This module does NOT parse the whole app URL — it only reads/writes the spgroup
  param and the spcode fragment. Wiring spgroup into index.html's inline URL
  parser (where all URL parsing lives) is a separate, additive integration.
*/
'use strict';

var GeosonifyStarpinInvite = (function () {

  var PARAM = 'spgroup';        // query param carrying the descriptor (additive)
  var FRAG  = 'spcode';         // fragment key carrying the code (full mode only)
  var VER   = 1;

  // ---- base64url of a UTF-8 JSON string ------------------------------------
  function b64urlEncodeStr(s) {
    var bytes = new TextEncoder().encode(s), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    var b = (typeof btoa === 'function') ? btoa(bin) : Buffer.from(bytes).toString('base64');
    return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecodeStr(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    if (typeof atob === 'function') {
      var bin = atob(s), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(s, 'base64').toString('utf8');
  }

  // ==========================================================================
  // Human code generator — easy to say aloud, hard to confuse.
  // Alphabet excludes the confusable set (no O/0, I/1/L, U). Grouped WORD-WORD
  // for readability. This is the code that becomes the Argon2 password; it is
  // normalised by the sealing module's codeNormalised() before use, so case,
  // spaces and hyphens don't matter to the derived key — the grouping is purely
  // for humans reading it aloud.
  //
  // Entropy: alphabet of 29, default 8 chars => 29^8 ≈ 5e11 ≈ 38.7 bits. Say so
  // plainly: a short human code is a convenience secret, not a fortress. Argon2
  // makes guessing expensive, not impossible (design docs, group-v1 §short-code).
  // ==========================================================================
  var HUMAN_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';   // 29 chars, no O0 I1L U

  function generateHumanCode(opts) {
    opts = opts || {};
    var groups = opts.groups || 2;      // WORD-WORD
    var per = opts.per || 4;            // 4 chars per group  => 8 chars total
    var rng = (typeof crypto !== 'undefined' ? crypto
              : require('crypto').webcrypto);
    var out = [];
    for (var g = 0; g < groups; g++) {
      var word = '';
      var buf = new Uint8Array(per);
      rng.getRandomValues(buf);
      for (var i = 0; i < per; i++) word += HUMAN_ALPHABET[buf[i] % HUMAN_ALPHABET.length];
      out.push(word);
    }
    return out.join('-');
  }

  function estimateBits(code, alphabetSize) {
    var n = 0; for (var i = 0; i < code.length; i++) if (/[A-Za-z0-9]/.test(code[i])) n++;
    return Math.round(n * Math.log2(alphabetSize || HUMAN_ALPHABET.length) * 10) / 10;
  }

  // ==========================================================================
  // Descriptor <-> link
  // ==========================================================================
  // descriptor = { v, group_uuid (b64url of 16 bytes), epoch, endpoint, label }
  function makeInvite(opts) {
    if (!opts || !opts.groupUuid) throw new Error('invite: groupUuid (b64url) required');
    var descriptor = {
      v: VER,
      g: opts.groupUuid,                       // b64url of the 16 uuid bytes
      e: opts.epoch || 1,
      ep: opts.endpoint || null,
      l: opts.label || ''
    };
    var base = opts.baseUrl || '';             // e.g. 'https://gobeirne.github.io/starpin/'
    var q = PARAM + '=' + b64urlEncodeStr(JSON.stringify(descriptor));
    var url = base + (base.indexOf('?') >= 0 ? '&' : '?') + q;

    if (opts.mode === 'full') {
      if (!opts.code) throw new Error('invite: full mode needs the code');
      // code in the FRAGMENT, percent-encoded, never the query.
      url += '#' + FRAG + '=' + encodeURIComponent(opts.code);
    }
    return url;
  }

  // Parse a link (or the current location). Returns:
  //   { descriptor:{groupUuid, epoch, endpoint, label}, code|null, mode }
  // Never throws on a missing code — descriptor mode legitimately has none.
  function parseInvite(url) {
    var qIndex = url.indexOf('?');
    var hIndex = url.indexOf('#');
    var query = '', frag = '';
    if (qIndex >= 0) query = url.slice(qIndex + 1, hIndex >= 0 ? hIndex : undefined);
    if (hIndex >= 0) frag = url.slice(hIndex + 1);

    var enc = paramFrom(query, PARAM);
    if (!enc) return null;                      // not an invite link
    var descriptor;
    try { descriptor = JSON.parse(b64urlDecodeStr(enc)); }
    catch (e) { throw new Error('invite: malformed descriptor'); }
    if (!descriptor || !descriptor.g) throw new Error('invite: descriptor missing group id');

    var code = null;
    var fcode = paramFrom(frag, FRAG);
    if (fcode) code = decodeURIComponent(fcode);

    return {
      descriptor: {
        groupUuid: descriptor.g,
        epoch: descriptor.e || 1,
        endpoint: descriptor.ep || null,
        label: descriptor.l || ''
      },
      code: code,
      mode: code ? 'full' : 'descriptor'
    };
  }

  function paramFrom(qs, key) {
    if (!qs) return null;
    var parts = qs.split('&');
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      var k = eq >= 0 ? parts[i].slice(0, eq) : parts[i];
      if (k === key) return eq >= 0 ? parts[i].slice(eq + 1) : '';
    }
    return null;
  }

  return {
    PARAM: PARAM, FRAG: FRAG,
    generateHumanCode: generateHumanCode, estimateBits: estimateBits,
    HUMAN_ALPHABET: HUMAN_ALPHABET,
    makeInvite: makeInvite, parseInvite: parseInvite
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeosonifyStarpinInvite;
}
