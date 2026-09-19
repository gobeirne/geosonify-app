/*
  geosonify-starpin-target.js  — the ONE place a Starpin target string is built.

  Why this exists: the sharing/handle layer keys a group folder on the EXACT
  string in target.starpin / target.cornerstone (see canonicalTarget() in
  geosonify-starpin-sharing.js — it ignores every other field). If the logging
  path and the sharing/viewing path build that string even slightly differently
  ("gaia" vs "gdr3", stripped digits, a different name fallback), a share silently
  keys to the wrong folder or to nothing. starpin-demo.html already hit this once:
  a /^\D+/ regex stopped at the "3" in "Gaia DR3" and mislabelled records as
  starpin:name: instead of starpin:gdr3:. So both paths MUST call this.

  This builds ONLY the identity string(s). Callers attach their own noisy fields
  (lat_1e7, ra_deg, catalogue, …) — those never affect the handle.

  NOTE: the string forms here ("starpin:gdr3:<id>", "starpin:name:<name>",
  cornerstone names) match what starpin-demo.html already writes. They are the
  identities existing provisional records use, so treat them as fixed for the
  provisional era; a change here is a target-format change (new records stop
  matching old ones) and needs the same care as any format change.
*/
(function (root) {
  'use strict';

  // Extract the Gaia DR3 source id from a star-like object. The id is a long
  // trailing digit run in the display name (e.g. "Gaia DR3 5382128182680588160").
  // Require >=5 digits so the "3" in "DR3" can never be mistaken for the id.
  function gaiaIdFrom(star) {
    if (!star) return '';
    if (star.source_id != null && /^\d+$/.test(String(star.source_id))) return String(star.source_id);
    var name = String(star.name || '');
    var m = name.match(/(\d{5,})\s*$/);
    return m ? m[1] : '';
  }

  // The identity string that goes in target.starpin for a star.
  // Numeric id -> "starpin:gdr3:<id>"; otherwise a name identity fallback.
  function starpinIdentity(star) {
    var id = gaiaIdFrom(star);
    if (/^\d+$/.test(id)) return 'starpin:gdr3:' + id;
    return 'starpin:name:' + (String(star && star.name || 'unknown'));
  }

  // Full target object for a star: identity + optional noisy fields the caller
  // passes through (kept out of the handle by canonicalTarget). extra is merged
  // shallowly and never overrides the identity.
  function starTarget(star, extra) {
    var t = { starpin: starpinIdentity(star) };
    if (extra && typeof extra === 'object') {
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k) && k !== 'starpin') t[k] = extra[k];
    }
    return t;
  }

  // Cornerstone target: the identity is the cornerstone name verbatim.
  function cornerstoneTarget(name, extra) {
    if (!name) throw new Error('cornerstoneTarget: name required');
    var t = { cornerstone: String(name) };
    if (extra && typeof extra === 'object') {
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k) && k !== 'cornerstone') t[k] = extra[k];
    }
    return t;
  }

  var api = {
    gaiaIdFrom: gaiaIdFrom,
    starpinIdentity: starpinIdentity,
    starTarget: starTarget,
    cornerstoneTarget: cornerstoneTarget
  };

  root.GeosonifyStarpinTarget = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

})(typeof self !== 'undefined' ? self : this);
