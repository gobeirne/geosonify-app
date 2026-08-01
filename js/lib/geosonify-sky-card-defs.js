/*
  geosonify-sky-cards-register.js  v0.1  — the first sky-only cards

  Until now the card taxonomy read: 6 frame-agnostic, 22 frame-portable, 8
  Earth-only, and 0 sky-only. Sky mode was a viewer borrowing Earth's
  vocabularies. These four are native.

    sexagesimal   11h 30m 36.20s -43d 33m 19.61s   the readable one
    designation   J113036.2-433319                 IAU source identifier
    skymoc        22/164249493047447               MOC, for other tools
    skynuniq      234618237225107                  NUNIQ packing of the same

  ALL FOUR ARE THE SAME CELL. Nothing new is encoded: each takes the HEALPix
  cell the app already has and says it a different way, which is the whole
  premise applied to a second sphere.

  WHY "OVERHEAD HERE, NOW" IS NOT AMONG THEM
  ------------------------------------------
  The sky panel also shows an apparent place -- 13h 25m at 05:15 UTC, mean
  equator of date, ~0.35 degrees from the ICRS position above it. It is a fine
  readout and a terrible card. A Geosonify card is an address you can put in a
  URL and hand to someone; that value is different an hour later, so the
  receiver would decode a direction the sender never meant. Cards must be
  time-invariant. It stays a panel readout, next to the caveat that already
  says "not ICRS".

  Same reasoning that makes frame= mandatory and an unknown frame abort rather
  than fall back.

  PRECISION IS DERIVED FROM THE CELL, NOT FIXED
  ---------------------------------------------
  Decimals scale with order so the text neither hides precision the cell has nor
  implies precision it does not. At order 22 the cell is 50.3 mas and RA gets 4
  decimal places of seconds; at order 6 it is 55 arcmin and 0 would do.
  GeosonifySky.autoDecimals already does exactly this, so it is used rather than
  re-derived.

  DESIGNATIONS TRUNCATE, COORDINATES ROUND
  ----------------------------------------
  Not an inconsistency. A designation NAMES A BOX -- dropping digits must give a
  coarser box containing the same point, which only truncation guarantees. A
  coordinate names a POINT, where rounding is correct. geosonify-sky.js already
  implements both and documents the distinction; this module only has to not
  break it.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';

  function _Sky() { return global.GeosonifySky || null; }
  function _HP() {
    try { if (typeof HealpixGrids !== 'undefined' && HealpixGrids) return HealpixGrids; } catch (e) {}
    return global.HealpixGrids || null;
  }
  function _GRIDS() {
    var CR = global.CardRenderer;
    if (CR && typeof CR.getGridDefinitions === 'function') {
      try { var g = CR.getGridDefinitions(); if (g) return g; } catch (e) {}
    }
    return global.CARD_GRIDS || null;
  }

  // The four share one engine: the cell, at the card's order.
  function cellAt(decDeg, raDeg, order) {
    var HP = _HP(), Sky = _Sky();
    if (!HP || !Sky) return null;
    var ipix;
    try { ipix = HP.nestIndex(decDeg, raDeg, order); } catch (e) { return null; }
    return { order: order, ipix: ipix };
  }

  /*
    Formatters. Each takes (dec, ra, order) and returns a string, or null if a
    dependency is missing -- never throws, because a card that throws takes the
    whole render with it.
  */
  var FORMAT = {
    sexagesimal: function (dec, ra, order) {
      var Sky = _Sky();
      if (!Sky) return null;
      var d;
      // autoDecimals takes the declination too: cos(dec) collapses at the pole,
      // where RA carries less information per digit. Passing it matters.
      try { d = Sky.autoDecimals(order, dec); } catch (e) { d = { ra: 2, dec: 1 }; }
      var raDec = (d && d.ra !== undefined) ? d.ra : 2;
      var decDec = (d && d.dec !== undefined) ? d.dec : 1;
      return Sky.formatRA(ra, { decimals: raDec }) + ' ' +
             Sky.formatDec(dec, { decimals: decDec });
    },

    designation: function (dec, ra, order) {
      var Sky = _Sky();
      if (!Sky) return null;
      // Designation precision is capped by the format itself: Jhhmmss.s+ddmmss
      // carries about 0.05" in RA, so past the order where the cell is finer
      // than that the identifier stops distinguishing cells. Reported as-is
      // rather than padded with digits the format does not define.
      return Sky.designation(ra, dec);
    },

    skymoc: function (dec, ra, order) {
      var c = cellAt(dec, ra, order);
      if (!c) return null;
      /*
        ORDER 30 MUST NEVER BE EMITTED. Verified against mocpy 0.20.0: it is
        accepted WITHOUT error and silently mis-parsed to 0/32-47 29/ -- sixteen
        base cells, most of the sky. Order 31+ is refused cleanly, which makes
        30 more dangerous than 40. Degraded to 29 instead, and the string says
        so, because a MOC is precisely the string someone pastes into another
        tool.
      */
      if (c.order === 30) {
        var d = cellAt(dec, ra, 29);
        return d ? (d.order + '/' + d.ipix.toString() + ' (order 30 not emitted)') : null;
      }
      return c.order + '/' + c.ipix.toString();
    },

    /*
      Synchronous, so it can only ever answer from the embedded catalogue --
      which at 1,765 stars means degrees away, not metres. The remote tier is a
      promise and belongs in the card's own render path, not here.
    */
    skystar: function (dec, ra, order) {
      var N = global.GeosonifySkyNeighbour;
      if (!N) return null;
      var list = N.neighbours(dec, ra > 180 ? ra - 360 : ra, { limit: 3 });
      if (!list.length) return null;
      // One line each, nearest first. describe() carries the coarse-tier caveat
      // itself, so a 269 km "neighbour" cannot be read as a local one.
      return list.map(function (n) { return N.describe(n); }).join('\n');
    },

    skynuniq: function (dec, ra, order) {
      var Sky = _Sky(), c = cellAt(dec, ra, order);
      if (!Sky || !c) return null;
      try { return Sky.nuniq(c.order, c.ipix).toString(); } catch (e) { return null; }
    }
  };

  var DEFS = {
    sexagesimal: {
      name: 'RA / Dec',
      sky: 'sexagesimal',
      frames: 'sky',
      grid: null,
      defaultIterations: 22,
      minIterations: 1,
      maxIterations: 48,
      link: 'https://en.wikipedia.org/wiki/Sexagesimal'
    },
    designation: {
      name: 'IAU designation',
      sky: 'designation',
      frames: 'sky',
      grid: null,
      defaultIterations: 22,
      minIterations: 1,
      maxIterations: 48,
      link: 'https://cds.unistra.fr/Dic/iau-spec.html'
    },
    skymoc: {
      name: 'MOC',
      sky: 'moc',
      frames: 'sky',
      grid: null,
      defaultIterations: 22,
      minIterations: 1,
      // MOC's own ceiling is order 29 = 393 microarcsec. Beyond it the standard
      // has nothing to say, so the card stops rather than inventing.
      maxIterations: 29,
      link: 'https://www.ivoa.net/documents/MOC/'
    },
    skystar: {
      name: 'Sky neighbours',
      sky: 'neighbour',
      frames: 'sky',
      grid: null,
      // Not order-dependent: the star at an address does not change with how
      // finely you name the address. Fixed so the +/- stepper does not imply
      // a precision control that does nothing.
      fixedIterations: 22,
      defaultIterations: 22,
      minIterations: 22,
      maxIterations: 22,
      link: 'https://simbad.cds.unistra.fr/simbad/'
    },
    skynuniq: {
      name: 'NUNIQ',
      sky: 'nuniq',
      frames: 'sky',
      grid: null,
      defaultIterations: 22,
      minIterations: 1,
      maxIterations: 29,
      link: 'https://www.ivoa.net/documents/MOC/'
    }
  };

  /*
    REGISTRATION HAPPENS AT LOAD, NOT ON FIRST SKY OPEN.

    Deferring it until openView() seemed tidy -- why carry sky cards if you never
    find sky mode -- but it makes the "+ Add Mode" list depend on history: the
    cards are absent until you have opened the sky view once, and present
    afterwards, with nothing on screen to explain the difference. A picker that
    changes based on what you did earlier in the session is worse than a picker
    with four entries you cannot currently use.

    Carrying them costs nothing now that the frame capability exists:
    GeosonifySkyFrames marks them `frames: 'sky'`, so showAddFormatModal hides
    them on Earth and the card gate hides any that slip through. Presence in
    CARD_GRIDS is not visibility.

    Deliberately does NOT push to cardState.order. A card needs to be in
    CARD_GRIDS to be OFFERED; it joins the order when the user actually enables
    it. Pushing here would write four keys into the saved state of every user
    who never touches sky mode.

    Additive and idempotent: existing keys are never clobbered, and calling twice
    registers nothing the second time.
  */
  function register() {
    var GRIDS = _GRIDS(), CR = global.CardRenderer;
    if (!GRIDS || !CR || !_Sky() || !_HP()) return 0;

    var st = null;
    try { st = CR.getCardState ? CR.getCardState() : null; } catch (e) {}

    var n = 0;
    Object.keys(DEFS).forEach(function (key) {
      if (GRIDS[key]) return;                       // never clobber
      GRIDS[key] = DEFS[key];
      n++;
      if (st && st.iterations && st.iterations[key] === undefined) {
        st.iterations[key] = DEFS[key].defaultIterations;
      }
    });
    return n;
  }

  /*
    CardRenderer builds CARD_GRIDS during init(), which runs after this file
    loads, so registering immediately would find nothing to register into. Poll
    briefly rather than depend on a load-order guarantee that the script tags do
    not actually make -- ten tries at 200 ms covers a slow first paint and then
    gives up quietly. openView() also calls register(), so a missed window still
    recovers the first time sky mode opens.
  */
  function autoRegister(tries) {
    tries = tries === undefined ? 10 : tries;
    if (register() > 0 || tries <= 0) return;
    if (typeof setTimeout === 'function') {
      setTimeout(function () { autoRegister(tries - 1); }, 200);
    }
  }

  /*
    The value for a card, at a coordinate. Callers pass the EXACT point where
    they have one -- at order 22 the cell is 50 mas and the text quotes to
    fractions of that, so a lossy double would show a different last digit from
    the cell it claims to name.
  */
  function valueFor(key, decDeg, raDeg, order) {
    var def = (_GRIDS() || {})[key];
    if (!def || !def.sky) return null;
    var fn = FORMAT[key];
    if (!fn) return null;
    try { return fn(decDeg, raDeg, order); } catch (e) { return null; }
  }

  var API = {
    VERSION: VERSION,
    DEFS: DEFS,
    FORMAT: FORMAT,
    register: register,
    autoRegister: autoRegister,
    valueFor: valueFor,
    keys: function () { return Object.keys(DEFS); }
  };

  global.GeosonifySkyCardDefs = API;
  autoRegister();
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  try { console.log('[geosonify] sky-card-defs ' + VERSION + ' loaded'); } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
