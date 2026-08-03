/*
  geosonify-sky-url-formats.js  v0.1  — sky formats as URL parameters

  A URL IS NOT A SHARE LINK. IT IS A CONVERSION.
  ---------------------------------------------
  The previous round treated these four cards as export-only: copy the MOC out,
  paste it into Aladin, done. That missed half of what a Geosonify URL is for.
  A URL is how you hand the app a position in one vocabulary and get it back in
  every other -- no server, no account, no API key. Paste a MOC from a paper and
  read it as BIP39 words, a chessboard, a melody.

  So the four interoperability formats need INPUT parameters, not just a copy
  button:

      ?moc=22/164249493047447          MOC order/ipix
      ?nuniq=234618237225107           NUNIQ packing of the same
      ?radec=11h30m36.2s -43d33m19.6s  sexagesimal or decimal, any spelling
      ?desig=J113036.2-433319          IAU source designation

  All four are ADDITIVE. None repurposes an existing name, which is the rule the
  query grammar lives by.

  THE FRAME QUESTION, WHICH IS THE ONLY HARD PART
  -----------------------------------------------
  "Absent frame= means earth, forever" exists because every URL already issued is
  an Earth URL. A new parameter cannot break that -- no link in the wild contains
  `moc=`. But it does not follow that every new parameter should imply sky, and
  the two halves genuinely differ:

    moc, nuniq        FRAME-FOLLOWING. A MOC token is an order and a HEALPix
                      index. That is exactly what hphex carries, and the same
                      digits are a valid Earth cell -- this is the "a sky code
                      and an Earth code are the SAME digits" trap. So these obey
                      `frame=` and default to earth, identically to hphex.
                      Geosonify always emits `frame=icrs` beside them.

    radec, desig      SKY-IMPLYING. Right ascension in hours has no terrestrial
                      reading; nobody writes a longitude as 11h30m. A designation
                      is an IAU source identifier by construction. There is no
                      Earth interpretation to be ambiguous with, so requiring
                      `frame=` would only make hand-written URLs fail for no
                      safety gain. They set sphere 'sky' themselves.

  The asymmetry is the point: the ambiguous pair stays conservative, the
  unambiguous pair is convenient.

  ROUND-TRIP FIDELITY DIFFERS, AND IS REPORTED
  --------------------------------------------
      moc     exact. order and ipix name the cell exactly.
      nuniq   exact. same cell, different packing.
      radec   exact to the precision printed -- a point, correctly rounded.
      desig   NOT A POINT. The IAU format truncates by design, so
              J113036.2-433319 names a BOX about 1.5" x 0.1", not a position.
              Parsed as the box centre with `approximate: true` and the extent
              reported, because silently treating it as a point would claim a
              precision the format does not carry.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';

  var FRAME_FOLLOWING = ['moc', 'nuniq'];
  var SKY_IMPLYING = ['radec', 'desig'];
  var PARAMS = FRAME_FOLLOWING.concat(SKY_IMPLYING);

  function _Sky() {
    try { if (typeof GeosonifySky !== 'undefined' && GeosonifySky) return GeosonifySky; } catch (e) {}
    return (global && global.GeosonifySky) || null;
  }

  /*
    IAU designation -> position.

    Jhhmmss.ss+ddmmss.s, with the fractional parts optional. The sign is
    mandatory and is the only reliable split between the two halves, since the
    field widths vary with precision.

    TRUNCATED, NOT ROUNDED. The IAU specifies truncation so that dropping digits
    always yields a coarser box containing the same point. Recovering a position
    therefore means taking the centre of the box the digits name, and the box is
    half a unit wide in each printed place. Reporting the centre without the
    extent would imply the identifier is a point, which it is not.
  */
  function parseDesignation(str) {
    var raw = String(str || '').trim();
    var m = /^J\s*(\d{2})(\d{2})(\d{2}(?:\.\d+)?)\s*([+-])\s*(\d{2})(\d{2})(\d{2}(?:\.\d+)?)$/i.exec(raw);
    if (!m) throw new Error('designation: expected Jhhmmss.s+ddmmss.s, got "' + raw + '"');

    var raSecStr = m[3], decSecStr = m[7];
    var raDeg = (parseInt(m[1], 10) + parseInt(m[2], 10) / 60 + parseFloat(raSecStr) / 3600) * 15;
    var decMag = parseInt(m[5], 10) + parseInt(m[6], 10) / 60 + parseFloat(decSecStr) / 3600;
    var decDeg = (m[4] === '-') ? -decMag : decMag;

    // Box width from the number of printed decimals, then half of it to move
    // from the truncated corner to the centre.
    var raDecimals = (raSecStr.split('.')[1] || '').length;
    var decDecimals = (decSecStr.split('.')[1] || '').length;
    var raStepArcsec = Math.pow(10, -raDecimals) * 15;      // seconds of TIME -> arcsec
    var decStepArcsec = Math.pow(10, -decDecimals);

    raDeg += (raStepArcsec / 2) / 3600;
    decDeg += (decDeg < 0 ? -1 : 1) * (decStepArcsec / 2) / 3600;

    return {
      raDeg: raDeg, decDeg: decDeg,
      approximate: true,
      boxArcsec: { ra: raStepArcsec, dec: decStepArcsec },
      spelling: 'designation'
    };
  }

  function buildDesignation(raDeg, decDeg) {
    var S = _Sky();
    return S && S.designation ? S.designation(raDeg, decDeg) : null;
  }

  /*
    Read whichever of the four is present. Returns null when none is, so the
    caller's existing parse continues untouched.

    Throws on a malformed value rather than guessing -- the same discipline as an
    unknown frame aborting the decode. A MOC that fails to parse must not quietly
    become a position somewhere else.
  */
  function parse(urlParams, frameSphere) {
    if (!urlParams || !urlParams.get) return null;
    var S = _Sky();

    for (var i = 0; i < PARAMS.length; i++) {
      var key = PARAMS[i];
      var raw = urlParams.get(key);
      if (raw === null || raw === undefined || raw === '') continue;

      var sphere = (SKY_IMPLYING.indexOf(key) !== -1) ? 'sky' : (frameSphere || 'earth');

      if (key === 'moc' || key === 'nuniq') {
        if (!S) throw new Error(key + '= needs GeosonifySky');
        var cell = (key === 'moc') ? S.fromMoc(raw) : S.fromNuniq(raw);
        var pos = centreOf(cell);
        /*
          THE ORDER TRAVELS WITH THE POSITION, and the caller must use it.

          A MOC carries an index, not a centre -- deliberately, because a
          coordinate that is a cell centre at order k sits exactly on a boundary
          at every deeper order, and re-encoding it is a coin flip (393 of 500
          diverge at order 26). Decoding to the centre is unavoidable, since the
          rest of the app speaks lat/lon; what avoids the coin flip is
          re-encoding AT THE SAME ORDER, which is why `order` is returned and why
          the URL wiring sets the card's iterations from it.
        */
        return { source: key, sphere: sphere, lat: pos[0], lon: pos[1],
                 order: cell.order, exact: true, raw: raw };
      }
      if (key === 'radec') {
        if (!S || !S.parsePosition) throw new Error('radec= needs GeosonifySky');
        var p = S.parsePosition(raw);
        return { source: 'radec', sphere: 'sky', lat: p.decDeg, lon: p.raDeg,
                 order: null, exact: true, raw: raw };
      }
      if (key === 'desig') {
        var d = parseDesignation(raw);
        return { source: 'desig', sphere: 'sky', lat: d.decDeg, lon: d.raDeg,
                 order: null, exact: false, boxArcsec: d.boxArcsec, raw: raw };
      }
    }
    return null;
  }

  /*
    The parameter a card should emit. Paired with frame=icrs by the caller for
    the frame-following two; the sky-implying two carry their own meaning but
    Geosonify emits the frame anyway, so a link is explicit either way.
  */
  function build(cardKey, decDeg, raDeg, order) {
    var S = _Sky();
    if (!S) return null;
    switch (cardKey) {
      case 'skymoc': {
        if (!S.nestIndexFor && !global.HealpixGrids) return null;
        var HP = global.HealpixGrids;
        if (!HP) return null;
        var ipix = HP.nestIndex(decDeg, raDeg, order);
        // Order 30 is never emitted: mocpy accepts it WITHOUT error and
        // silently mis-parses it to sixteen base cells. See the sky handover.
        if (order === 30) return null;
        return { moc: order + '/' + ipix.toString() };
      }
      case 'skynuniq': {
        var HP2 = global.HealpixGrids;
        if (!HP2) return null;
        var ip = HP2.nestIndex(decDeg, raDeg, order);
        return { nuniq: S.nuniq(order, ip).toString() };
      }
      case 'sexagesimal': {
        var d = S.autoDecimals(order, decDeg);
        return { radec: S.formatRA(raGeo(raDeg), { decimals: d.ra }) + ' ' +
                        S.formatDec(decDeg, { decimals: d.dec }) };
      }
      case 'designation':
        return { desig: buildDesignation(raGeo(raDeg), decDeg) };
      default:
        return null;
    }
  }

  /*
    A cell object from fromMoc/fromNuniq carries order + face + digits, not
    coordinates -- so the centre comes from the HEALPix engine, which is the same
    path the rest of the app uses. Returns [dec, ra].
  */
  function centreOf(cell) {
    var HP = global.HealpixGrids;
    if (!HP || !HP.nestCentre || !HP.pathToNest) {
      throw new Error('HealpixGrids is needed to place a MOC/NUNIQ cell');
    }
    var ipix = (cell.ipix !== undefined && cell.ipix !== null)
      ? cell.ipix
      : HP.pathToNest(cell.face, cell.digits, cell.order);
    var c = HP.nestCentre(ipix, cell.order);
    return [c[0], ((c[1] % 360) + 360) % 360];
  }

  function raGeo(raDeg) { return ((raDeg % 360) + 360) % 360; }

  /*
    Collision guard. These four names must not already mean something in the
    query grammar -- the contract is add-only, and a repurposed name silently
    decodes old links to the wrong place.
  */
  function checkParamName(name, existingNames) {
    var taken = (existingNames || []).indexOf(name) !== -1;
    return { name: name, safe: !taken, reason: taken ? 'already in the grammar' : null };
  }

  var API = {
    VERSION: VERSION,
    PARAMS: PARAMS,
    FRAME_FOLLOWING: FRAME_FOLLOWING,
    SKY_IMPLYING: SKY_IMPLYING,
    parse: parse,
    build: build,
    parseDesignation: parseDesignation,
    buildDesignation: buildDesignation,
    checkParamName: checkParamName
  };

  global.GeosonifySkyUrlFormats = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  try { console.log('[geosonify] sky-url-formats ' + VERSION + ' loaded'); } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
