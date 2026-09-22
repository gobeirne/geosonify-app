/*
  geosonify-starpin-canonical.js — the ONE JSON canonicaliser (RFC 8785 / JCS)

  This is a frozen protocol constant. The AAD, every content hash, every export
  integrity hash, and the Node-oracle<->browser conformance vectors all depend on
  it producing EXACTLY these bytes, unchanged, in every implementation for as long
  as any record exists. Do not "improve" it.

  It has ONE definition and no fallbacks. The log, sharing and selfsync modules
  all consume this — there is deliberately no second copy to drift from. Load this
  <script> BEFORE those three in the page (same liveness rule as the rest of the
  app: order is decided by the <script> tags in the host file).

  Why this is strict RFC 8785 and not the old "sorted-keys-no-whitespace"
  stand-in — and why "strict" means REJECTING inputs, not just ordering keys:

    OBJECT KEYS  sorted ascending by UTF-16 code unit. JavaScript's default
                 Array.prototype.sort() on strings IS UTF-16 code-unit order,
                 exactly what RFC 8785 §3.2.3 mandates. (Code unit, not code
                 point; they differ above the BMP and JCS wants code unit.)

    STRINGS      JSON.stringify escaping is JCS-compliant on every engine this
                 app runs on: only " \ and U+0000..U+001F are escaped; U+007F and
                 all other printable characters are emitted literally. Proven on
                 the RFC's own string vectors in the self-test.

    NUMBERS      the ECMAScript Number::toString shortest-round-trip form. For
                 every value shape a record holds (lat/lon as *_1e7 integers, ms
                 timestamps, 1-dp accuracy/altitude, and source ids STORED AS
                 STRINGS precisely because a bare Number would lose precision),
                 JSON.stringify(n) already equals String(n) === the JCS form.

    INPUT DOMAIN this is the part the stand-in ignored. JCS is a spec about which
                 inputs are legal, not only how legal ones serialise. Everything
                 JavaScript would otherwise serialise SURPRISINGLY is refused, so
                 a malformed or hostile value fails loudly rather than hashing to
                 a plausible lie:
                   undefined / function / symbol : dropped or nulled by stringify.
                   BigInt                        : not an IEEE-754 JSON number.
                   NaN / +/-Infinity             : become "null".
                   Date / RegExp / Map / class instance / anything with toJSON :
                       a Date stringifies to "{}" (its state isn't enumerable!),
                       a class instance loses its type, and a toJSON could inject
                       arbitrary content behind the canonicaliser. Only ordinary
                       {} and [] are data.
                   sparse array                  : holes emit ",," — not valid JSON.
                   lone UTF-16 surrogate         : RFC 8785 §3.2.2.2 requires
                       invalid Unicode to ERROR; stringify would emit "\ud800".

  Export note: files already written carry the integrity tag "fnv1a64-jcs-ish/1".
  That tag is NOT changed retroactively — the bytes it described are unchanged, so
  it is still accurate for them. The "-ish" may be dropped at the NEXT export-
  format version, never on existing files.
*/
'use strict';

var GeosonifyStarpinCanonical = (function () {

  function isLoneSurrogate(s) {
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {                 // high surrogate
        var n = (i + 1 < s.length) ? s.charCodeAt(i + 1) : 0;
        if (n < 0xDC00 || n > 0xDFFF) return true;      // not followed by a low
        i++;                                            // valid pair; skip the low
      } else if (c >= 0xDC00 && c <= 0xDFFF) {
        return true;                                    // low surrogate with no high
      }
    }
    return false;
  }

  function canonical(value) {
    if (value === null) return 'null';
    var t = typeof value;
    if (t === 'boolean') return value ? 'true' : 'false';
    if (t === 'bigint')
      throw new Error('canonical(): cannot represent a BigInt — '
                      + 'numbers outside IEEE-754 double are not a JSON value');
    if (t === 'number') {
      if (!isFinite(value))
        throw new Error('canonical(): cannot represent a non-finite number '
                        + '(NaN/Infinity) — the value is corrupt');
      return JSON.stringify(value);   // === String(value) === JCS form
    }
    if (t === 'string') {
      if (isLoneSurrogate(value))
        throw new Error('canonical(): refuses a lone UTF-16 surrogate '
                        + '(invalid Unicode — RFC 8785 §3.2.2.2 requires an error)');
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      var parts = [];
      for (var i = 0; i < value.length; i++) {
        if (!(i in value))            // a hole in a sparse array — not a JSON value
          throw new Error('canonical(): refuses a sparse array (hole at ' + i + ')');
        parts.push(canonical(value[i]));
      }
      return '[' + parts.join(',') + ']';
    }
    if (t === 'object') {
      var proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null)
        throw new Error('canonical(): accepts only ordinary objects — a '
                        + (value.constructor && value.constructor.name || 'non-plain')
                        + ' instance can carry hidden or custom serialisation');
      if (typeof value.toJSON === 'function')
        throw new Error('canonical(): refuses an object with a toJSON method '
                        + '(it would substitute content behind the canonicaliser)');
      var keys = Object.keys(value).sort();   // UTF-16 code-unit order = JCS §3.2.3
      return '{' + keys.map(function (k) {
        return JSON.stringify(k) + ':' + canonical(value[k]);
      }).join(',') + '}';
    }
    // undefined / function / symbol have no JSON representation.
    throw new Error('canonical(): cannot represent a value of type ' + t);
  }

  return { canonical: canonical };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeosonifyStarpinCanonical;
}
