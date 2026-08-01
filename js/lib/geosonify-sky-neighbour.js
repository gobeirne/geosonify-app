/*
  geosonify-sky-neighbour.js  v0.1  — the star standing at your address

  THE IDEA
  --------
  Your latitude and longitude, read as declination and right ascension, point
  somewhere on the celestial sphere. Something is usually there. This finds it
  and describes it in a way that connects the two readings.

  NAMING: "NEAREST STAR" IS THE ONE THING THIS MUST NOT BE CALLED
  ---------------------------------------------------------------
  The nearest star is the Sun, then Proxima Centauri, and no amount of context
  overrides that for an astronomer reading the label. What this finds is the star
  whose ICRS coordinates COINCIDE with your terrestrial ones -- a coincidence of
  address, not of proximity. The two are unrelated: the coincident star is
  typically thousands of light years away, and there is no sense in which it is
  near you.

  So the module talks about a star being AT an address, never NEAR you, and the
  distance it reports is the star's true distance from the Sun -- which is the
  only distance to it that means anything.

  THE OFFSET IS IN METRES, AND THAT IS CORRECT HERE
  -------------------------------------------------
  Everywhere else in sky mode, converting to metres is a mistake: a cell's
  resolution is an angle and multiplying by an Earth radius invents an Earth that
  is not involved. This runs the other way. The star's coordinates, read back as
  lat/lon, name a POINT ON THE EARTH -- and the distance from you to that point
  is an ordinary terrestrial distance, correctly measured in metres with a
  compass bearing. "870 m north-east" is a fact about two places on the ground.

  That symmetry is the whole appeal: the star has an Earth address, you are
  standing near it, and you can walk there.

  HOW CLOSE CAN IT ACTUALLY BE? THE ANSWER DECIDES THE FEATURE.
  ------------------------------------------------------------
  Mean nearest-neighbour separation is 0.5/sqrt(density), and 1 degree of
  declination is 111,320 m of latitude, so:

      catalogue            stars          nearest star      as Earth distance
      embedded (mag<=5)    1,765            8702"                269 km
      HYG v3.8             119,626          1057"                 33 km
      UCAC4                113.8 million      34.3"              1,060 m
      Gaia DR3             1.81 billion        8.6"                266 m

  So the embedded catalogue CANNOT answer this question -- 269 km away is not
  "your" star in any useful sense. A metre-scale answer needs a deep catalogue,
  and a deep catalogue cannot be shipped: even Gaia only gets to ~266 m, and a
  star within 50 m would need 6.5e10 stars, thirty-six times Gaia.

  Hence two tiers, and the module is explicit about which one answered:

    LOCAL   the embedded catalogue. Always available, offline, no request.
            Answers "which bright star is roughly here" -- degrees away.
    REMOTE  a VizieR/SIMBAD cone search. Answers "which star is exactly here"
            -- hundreds of metres away, with a real catalogue identifier.

  ON MAKING A NETWORK REQUEST AT ALL
  ----------------------------------
  There is precedent and it is exact. The Earth side already calls Nominatim from
  reverseGeocodeAddress() to turn a pin into a place name. This is the same
  gesture in the other frame, and it is subject to the same rule from the other
  direction: reverseGeocodeAddress returns null when the frame is sky, and
  lookupRemote() must never run when the frame is earth. Neither service should
  ever see the other frame's coordinates.

  It is also strictly optional. The address still lives in the URL with no server
  and no account; this enriches it, exactly as the Earth-side reverse geocode
  does.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';
  var D2R = Math.PI / 180;
  var M_PER_DEG = 111319.9;              // metres per degree of latitude
  var COMPASS = ['north', 'north-east', 'east', 'south-east',
                 'south', 'south-west', 'west', 'north-west'];

  function _Stars() { return global.GeosonifySkyStars || null; }

  function isSky() {
    try {
      var f = global.AppState && global.AppState.get ? global.AppState.get('frame') : null;
      return !!(f && f.sphere === 'sky');
    } catch (e) { return false; }
  }

  /*
    Where the star's coordinates land ON THE EARTH, relative to you.

    Plane approximation, deliberately: these offsets are hundreds of metres to a
    few kilometres, over which the difference from a geodesic is millimetres. The
    cos(lat) on the longitude term is not optional though -- at 52 degrees it is
    a 62% error, which is the difference between "north-east" and "north".
  */
  function earthOffset(fromLat, fromLon, starDec, starRa) {
    var toLat = starDec;
    var toLon = starRa > 180 ? starRa - 360 : starRa;

    var dLat = toLat - fromLat;
    var dLon = toLon - fromLon;
    while (dLon > 180) dLon -= 360;
    while (dLon < -180) dLon += 360;

    var north = dLat * M_PER_DEG;
    var east = dLon * M_PER_DEG * Math.cos(fromLat * D2R);
    var metres = Math.sqrt(north * north + east * east);

    var bearing = (Math.atan2(east, north) / D2R + 360) % 360;
    return {
      metres: metres,
      bearingDeg: bearing,
      compass: COMPASS[Math.round(bearing / 45) % 8],
      northMetres: north,
      eastMetres: east
    };
  }

  function formatDistance(m) {
    if (m < 1000) return Math.round(m) + ' m';
    if (m < 100000) return (m / 1000).toFixed(1) + ' km';
    return Math.round(m / 1000) + ' km';
  }

  function formatLightYears(ly) {
    if (ly === null || ly === undefined) return null;
    if (ly < 100) return ly.toFixed(1) + ' light years';
    return Math.round(ly).toLocaleString('en-US') + ' light years';
  }

  /*
    Links. SIMBAD resolves an identifier; its coordinate query resolves a
    position, which is what we have when the star has no name worth typing.
    Aladin takes the same position and shows the sky around it.
  */
  function links(star) {
    var out = {};
    var coo = star.ra.toFixed(6) + (star.dec < 0 ? '' : '+') + star.dec.toFixed(6);
    if (star.name && !/^H[RD] /.test(star.name)) {
      out.simbad = 'https://simbad.cds.unistra.fr/simbad/sim-id?Ident=' +
                   encodeURIComponent(star.name);
    }
    out.simbadCoord = 'https://simbad.cds.unistra.fr/simbad/sim-coo?Coord=' +
                      encodeURIComponent(coo) + '&Radius=2&Radius.unit=arcmin';
    out.aladin = 'https://aladin.cds.unistra.fr/AladinLite/?target=' +
                 encodeURIComponent(coo) + '&fov=0.1';
    out.vizier = 'https://vizier.cds.unistra.fr/viz-bin/VizieR-4?-c=' +
                 encodeURIComponent(coo) + '&-c.rs=10';
    return out;
  }

  /*
    LOCAL tier. Always works, offline, and honest that it is answering a coarser
    question than the one asked -- `tier` and `coarse` say so, and a caller that
    shows the offset without them will report a star 269 km away as though it
    were on the next street.
  */
  function lookupLocal(lat, lon, opts) {
    opts = opts || {};
    var S = _Stars();
    if (!S) return null;
    var ra = ((lon % 360) + 360) % 360;
    var star = S.nearest(ra, lat, { maxMag: opts.maxMag });
    if (!star) return null;

    var off = earthOffset(lat, lon, star.dec, star.ra);
    return {
      tier: 'local',
      coarse: off.metres > 5000,
      star: star,
      offset: off,
      distLy: star.distLy === undefined ? null : star.distLy,
      links: links(star)
    };
  }

  /*
    REMOTE tier — UNVERIFIED. Read this before trusting it.

    The query below follows the documented VizieR cone-search form, but it has
    NOT been run: the sandbox this was written in cannot reach
    vizier.cds.unistra.fr (403 at the egress proxy), so the response shape is
    from the specification rather than from an observed reply. Treat the first
    browser run as the test. If the parse fails it returns null and the caller
    falls back to the local tier, which is the correct failure -- a wrong star
    identifier would be worse than none.

    Defaults to UCAC4 (113.8 million stars, ~1 km typical) rather than Gaia
    (1.8 billion, ~266 m) because UCAC4 rows are small and the identifiers are
    short enough to read aloud, which is the point of the card. `opts.catalogue`
    switches it.
  */
  var CATALOGUES = {
    ucac4: { source: 'I/322A/out', idCol: 'UCAC4', label: 'UCAC4' },
    gaia:  { source: 'I/355/gaiadr3', idCol: 'Source', label: 'Gaia DR3' }
  };

  /*
    UCAC4 identifiers carry their own declination, which makes them
    self-checking.

    The format is ZZZ-NNNNNN, where ZZZ is a 0.2-degree declination zone counted
    from the south pole: zone 1 spans -90.0 to -89.8, so zone z spans
    -90 + (z-1)*0.2 to -90 + z*0.2. UCAC4 233-054580 therefore claims a
    declination between -43.6 and -43.4 -- and St Martins sits at -43.5839,
    inside it.

    This matters more than a curiosity. The VizieR parse in lookupRemote() has
    never been run against a live response, and the way a column-order mistake
    would present is a plausible identifier attached to the wrong position. The
    zone is an independent witness: if the parsed dec and the parsed id disagree,
    something is wrong with the parse and the result is discarded rather than
    shown. Silent wrong answers are the failure mode this project cares about
    most.

    Returns null for anything that is not a UCAC4 id, so it never rejects the
    Gaia tier by accident.
  */
  function ucac4Zone(id) {
    var m = /(?:UCAC4\s+)?(\d{3})-(\d{6})/.exec(String(id || ''));
    if (!m) return null;
    var z = parseInt(m[1], 10);
    if (!(z >= 1 && z <= 900)) return null;
    return { zone: z, decMin: -90 + (z - 1) * 0.2, decMax: -90 + z * 0.2 };
  }

  function ucac4Agrees(id, decDeg) {
    var z = ucac4Zone(id);
    if (!z) return true;                     // not a UCAC4 id: nothing to check
    // One zone of slack: a star exactly on a boundary can be catalogued either
    // side, and rejecting a correct result would be worse than accepting a
    // near-miss.
    return decDeg >= z.decMin - 0.2 && decDeg <= z.decMax + 0.2;
  }

  function lookupRemote(lat, lon, opts) {
    opts = opts || {};
    if (!isSky()) return Promise.resolve(null);      // never leak Earth coords
    if (typeof fetch !== 'function') return Promise.resolve(null);

    var cat = CATALOGUES[opts.catalogue || 'ucac4'] || CATALOGUES.ucac4;
    var ra = ((lon % 360) + 360) % 360;
    var radiusArcmin = opts.radiusArcmin || 1;

    var url = 'https://vizier.cds.unistra.fr/viz-bin/asu-tsv' +
      '?-source=' + encodeURIComponent(cat.source) +
      '&-c=' + encodeURIComponent(ra.toFixed(6) + (lat < 0 ? '' : '+') + lat.toFixed(6)) +
      '&-c.rm=' + radiusArcmin +
      '&-out.max=1&-sort=_r&-out.add=_r';

    return fetch(url).then(function (r) { return r.ok ? r.text() : null; })
      .then(function (text) {
        if (!text) return null;
        var row = parseTsv(text);
        if (!row) return null;

        var name = cat.label + ' ' + row.id;

        // Independent witness on an unverified parse. See ucac4Zone above.
        if (!ucac4Agrees(row.id, row.dec)) {
          try {
            console.warn('[geosonify] star lookup discarded: ' + name +
                         ' claims a declination zone that disagrees with ' +
                         row.dec.toFixed(4) + ' — the VizieR parse is wrong');
          } catch (e) {}
          return null;
        }

        var star = {
          ra: row.ra, dec: row.dec, mag: row.mag,
          name: name, con: null, distLy: null,
          sepDeg: row.sepArcmin === null ? null : row.sepArcmin / 60
        };
        return {
          tier: 'remote',
          coarse: false,
          catalogue: cat.label,
          star: star,
          offset: earthOffset(lat, lon, star.dec, star.ra),
          distLy: null,                  // astrometric catalogues carry parallax, not distance
          links: links(star)
        };
      })
      .catch(function () { return null; });
  }

  /*
    VizieR's TSV form: comment lines start with '#', then a header block, then
    data. Written defensively because the exact column order is a property of the
    catalogue rather than of the format.
  */
  function parseTsv(text) {
    var lines = text.split('\n').filter(function (l) {
      return l && l.charAt(0) !== '#';
    });
    var header = null, cols = null;
    for (var i = 0; i < lines.length; i++) {
      var parts = lines[i].split('\t');
      if (!header) {
        if (parts.length > 2 && /RA|_RAJ2000|RAJ2000/i.test(lines[i])) { header = parts; }
        continue;
      }
      if (/^-+\t/.test(lines[i]) || /^-+$/.test(parts[0])) continue;   // rule line
      cols = parts;
      break;
    }
    if (!header || !cols) return null;

    function col(re) {
      for (var i = 0; i < header.length; i++) {
        if (re.test(header[i].trim())) {
          var v = (cols[i] || '').trim();
          return v === '' ? null : v;
        }
      }
      return null;
    }
    var ra = parseFloat(col(/^_?RAJ?2000$|^RA_ICRS$/i));
    var dec = parseFloat(col(/^_?DEJ?2000$|^DE_ICRS$/i));
    if (!isFinite(ra) || !isFinite(dec)) return null;

    var mag = parseFloat(col(/^(f\.)?mag$|^Gmag$|^Vmag$|^rmag$/i));
    var sep = parseFloat(col(/^_r$/));
    var id = col(/^UCAC4$|^Source$|^DR3Name$/i);

    return {
      ra: ra, dec: dec,
      mag: isFinite(mag) ? mag : null,
      sepArcmin: isFinite(sep) ? sep : null,
      id: id || (ra.toFixed(5) + (dec < 0 ? '' : '+') + dec.toFixed(5))
    };
  }

  /*
    One sentence, the way a person would say it. Deliberately never uses the word
    "nearest": see the naming note at the top.
  */
  function describe(result) {
    if (!result) return '';
    var s = result.star, o = result.offset;
    var bits = [s.name];

    if (o.metres < 1) bits.push('exactly at your coordinates');
    else bits.push(formatDistance(o.metres) + ' ' + o.compass + ' of you, on the ground');

    var ly = formatLightYears(result.distLy);
    if (ly) bits.push(ly + ' away');
    else if (result.tier === 'local') bits.push('distance unmeasured');

    // The caveat belongs once per card, not once per line -- three neighbours
    // each repeating it drowns the answer. describe() marks the line briefly;
    // a caller showing a list should render coarseNote() beneath it.
    if (result.coarse) bits.push('brightest here, not closest');
    return bits.join(' \u2014 ');
  }

  /*
    UP TO N NEIGHBOURS, not one.

    Three is a good ceiling: enough that a suburb-sized outline usually has
    company, few enough to read at a glance. Sorted by angular separation, which
    is the same ordering as ground distance -- the two differ only by cos(dec) on
    the RA component, and that is a monotonic scaling within one small patch.

    Each carries its own Earth offset, so the card can say "170 m NE, 340 m S,
    1.1 km W" and mean it literally.
  */
  function neighbours(lat, lon, opts) {
    opts = opts || {};
    var S = _Stars();
    if (!S) return [];
    var ra = ((lon % 360) + 360) % 360;
    var limit = opts.limit || 3;

    // Widen until the LIMIT is met, not until the first hit: at mag<=5 the
    // typical separation is 2.4 degrees, so the radius that finds one star
    // usually holds only that one. Stopping there returned a single neighbour
    // where three were asked for.
    var r = opts.radiusDeg || 2, hits = [];
    for (var i = 0; i < 9; i++) {
      hits = S.near(ra, lat, r, { maxMag: opts.maxMag, limit: limit });
      if (hits.length >= limit) break;
      if (r > 180) break;
      r *= 2;
    }

    return hits.map(function (star) {
      var off = earthOffset(lat, lon, star.dec, star.ra);
      return {
        tier: 'local',
        coarse: off.metres > 5000,
        star: star,
        offset: off,
        distLy: star.distLy === undefined ? null : star.distLy,
        links: links(star)
      };
    });
  }

  /*
    A THUMBNAIL OF THE ACTUAL SKY THERE.

    CDS runs hips2fits, which returns a rendered cutout of any HiPS survey at any
    position as a plain image. That means the card needs no library and no
    canvas: one <img src>, and the markers go on top as absolutely positioned
    elements or a small SVG.

    Default field is 20 arcsec, which at these latitudes is about 620 m of
    ground -- a few streets. Wide enough that a neighbour star is usually in
    frame, tight enough that your own dot means something.

    UNVERIFIED, same caveat as the VizieR query: this sandbox cannot reach
    alasky.cds.unistra.fr (403 at the egress proxy), so the parameter names come
    from the service documentation rather than from an observed response. An
    <img> that 404s renders as a broken image, so the card should hide the
    element on error rather than leave a gap.
  */
  var SURVEYS = {
    dss: 'CDS/P/DSS2/color',
    panstarrs: 'CDS/P/PanSTARRS/DR1/color-z-zg-g',
    twomass: 'CDS/P/2MASS/color'
  };

  function thumbnailUrl(decDeg, raDeg, opts) {
    opts = opts || {};
    var px = opts.px || 96;
    var fovDeg = (opts.fovArcsec || 20) / 3600;
    return 'https://alasky.cds.unistra.fr/hips-image-services/hips2fits' +
      '?hips=' + encodeURIComponent(SURVEYS[opts.survey || 'dss'] || SURVEYS.dss) +
      '&width=' + px + '&height=' + px +
      '&fov=' + fovDeg +
      '&projection=TAN&coordsys=icrs&format=jpg' +
      '&ra=' + raDeg.toFixed(6) + '&dec=' + decDeg.toFixed(6);
  }

  /*
    Where each marker goes inside that thumbnail, in pixels from the top-left.

    Tangent-plane, and at a 20 arcsec field the difference from a rigorous
    gnomonic projection is nanoarcseconds -- the small-angle approximation is not
    a shortcut here, it is exact to far beyond the pixel. cos(dec) on the RA
    term is still required.

    x grows east-to-WEST because right ascension increases leftward on the sky,
    which is the same handedness flip the sky renderer applies.
  */
  function thumbnailMarkers(decDeg, raDeg, list, opts) {
    opts = opts || {};
    var px = opts.px || 96;
    var fovArcsec = opts.fovArcsec || 20;
    var scale = px / fovArcsec;
    var out = [{ x: px / 2, y: px / 2, self: true, label: 'you' }];

    (list || []).forEach(function (n) {
      var s = n.star || n;
      var dRa = (s.ra - raDeg);
      while (dRa > 180) dRa -= 360;
      while (dRa < -180) dRa += 360;
      var eastArcsec = dRa * 3600 * Math.cos(decDeg * D2R);
      var northArcsec = (s.dec - decDeg) * 3600;

      var x = px / 2 - eastArcsec * scale;
      var y = px / 2 - northArcsec * scale;
      out.push({
        x: x, y: y, self: false, label: s.name,
        inFrame: x >= 0 && x <= px && y >= 0 && y <= px
      });
    });
    return out;
  }
  /*
    Remote first when the frame allows it, local as the fallback. lookupLocal()
    returns synchronously so a caller can render something at once and upgrade
    when the request lands -- the same progressive pattern the sky view uses for
    Aladin imagery.
  */
  function lookup(lat, lon, opts) {
    opts = opts || {};
    var local = lookupLocal(lat, lon, opts);
    if (opts.remote === false) return Promise.resolve(local);
    return lookupRemote(lat, lon, opts).then(function (remote) {
      return remote || local;
    });
  }

  /*
    The one-time footnote for a coarse list. Says plainly why the distances are
    hundreds of kilometres rather than hundreds of metres, so nobody reads the
    embedded catalogue as a failure of the lookup.
  */
  function coarseNote() {
    return 'From the built-in bright-star catalogue (1,765 stars), where the ' +
           'typical gap is about 2.4\u00b0 \u2014 269 km read as ground distance. ' +
           'A deep-catalogue lookup finds one within about a kilometre.';
  }

  var API = {
    VERSION: VERSION,
    coarseNote: coarseNote,
    CATALOGUES: CATALOGUES,
    earthOffset: earthOffset,
    formatDistance: formatDistance,
    formatLightYears: formatLightYears,
    links: links,
    ucac4Zone: ucac4Zone,
    ucac4Agrees: ucac4Agrees,
    lookupLocal: lookupLocal,
    lookupRemote: lookupRemote,
    lookup: lookup,
    neighbours: neighbours,
    SURVEYS: SURVEYS,
    thumbnailUrl: thumbnailUrl,
    thumbnailMarkers: thumbnailMarkers,
    describe: describe,
    parseTsv: parseTsv
  };

  global.GeosonifySkyNeighbour = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  try { console.log('[geosonify] sky-neighbour ' + VERSION + ' loaded'); } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
