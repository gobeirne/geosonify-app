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
  /*
    THE CATALOGUE DECIDES WHETHER THE CARD IS ALIVE.

    The test that matters is not "does it name a star" but "does it CHANGE as you
    move". A card that reads the same from one side of the city to the other is
    scenery, not information. Typical neighbour separation, and the walk it takes
    before the answer changes:

        embedded (1,765)      8702"     269 km    never, within one life
        UCAC4 (114 M)           34"     1.06 km   about one suburb
        Gaia DR3 (1.81 B)      8.6"       266 m   a few streets

    Across St Martins, 1.5 km wide, that is 0.0 distinct embedded neighbours,
    1.4 UCAC4 ones, and 5.6 Gaia ones. Only the last is hyperlocal.

    So GAIA IS THE DEFAULT, reversing the earlier choice. UCAC4 identifiers are
    shorter and more sayable, which was the reason before, but a name you can
    pronounce for a star that never changes is the wrong trade. UCAC4 stays
    available for anyone who wants the readable identifier.

    Gaia also carries parallax, so the distance is real rather than absent:
    1000/Plx gives parsecs. That restores the light-years figure the embedded
    catalogue could only supply for bright stars.
  */
  /*
    UCAC4 identifiers carry their own declination, which makes them
    self-checking.

    The format is ZZZ-NNNNNN, where ZZZ is a 0.2-degree declination zone counted
    from the south pole: zone 1 spans -90.0 to -89.8, so zone z spans
    -90 + (z-1)*0.2 to -90 + z*0.2. UCAC4 233-054580 therefore claims a
    declination between -43.6 and -43.4 -- and St Martins sits at -43.5839,
    inside it.

    This is an independent witness on a parse that has never been run live. A
    column mistake would present as a plausible identifier attached to the wrong
    position, and nothing else in the pipeline could catch that. Returns null for
    anything that is not a UCAC4 id, so the Gaia tier is never rejected by
    accident.
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
    if (!z) return true;
    // One zone of slack: a star on a boundary can be catalogued either side, and
    // rejecting a correct result is worse than accepting a near-miss.
    return decDeg >= z.decMin - 0.2 && decDeg <= z.decMax + 0.2;
  }

  var CATALOGUES = {
    gaia: {
      source: 'I/355/gaiadr3', label: 'Gaia DR3',
      cols: 'RA_ICRS,DE_ICRS,Source,Plx,Gmag',
      idCol: 'Source', plxCol: 'Plx', magCol: 'Gmag',
      raCol: 'RA_ICRS', decCol: 'DE_ICRS'
    },
    ucac4: {
      source: 'I/322A/out', label: 'UCAC4',
      cols: 'RAJ2000,DEJ2000,UCAC4,f.mag',
      idCol: 'UCAC4', plxCol: null, magCol: 'f.mag',
      raCol: 'RAJ2000', decCol: 'DEJ2000'
    }
  };

  var PC_TO_LY = 3.2615638;

  /*
    Up to `limit` stars, nearest first.

    UNVERIFIED against a live service: this sandbox cannot reach
    vizier.cds.unistra.fr (403 at the egress proxy), so the request form comes
    from the documentation rather than an observed reply. Two things make that
    less dangerous than it sounds:

      -out= names the columns EXPLICITLY, so the parse does not depend on
      guessing VizieR's default column order for each catalogue -- the failure
      mode I would otherwise be most worried about.

      the UCAC4 zone check (below) is an independent witness on the position,
      and a disagreement discards the row rather than showing it.

    Returns [] on any failure. An empty list is a true statement; a wrong star is
    not.
  */
  function lookupRemote(lat, lon, opts) {
    opts = opts || {};
    if (!isSky()) return Promise.resolve([]);        // never leak Earth coords
    if (typeof fetch !== 'function') return Promise.resolve(null);   // could not look

    var cat = CATALOGUES[opts.catalogue || 'gaia'] || CATALOGUES.gaia;
    var ra = ((lon % 360) + 360) % 360;
    var limit = opts.limit || 3;
    var radiusArcmin = opts.radiusArcmin || 1;

    var url = 'https://vizier.cds.unistra.fr/viz-bin/asu-tsv' +
      '?-source=' + encodeURIComponent(cat.source) +
      '&-c=' + encodeURIComponent(ra.toFixed(6) + (lat < 0 ? '' : '+') + lat.toFixed(6)) +
      '&-c.rm=' + radiusArcmin +
      '&-out=' + encodeURIComponent(cat.cols) +
      '&-out.add=_r&-sort=_r&-out.max=' + limit;

    /*
      null means COULD NOT LOOK; [] means looked and found nothing. Collapsing
      them loses the only distinction the card needs to be honest -- "the
      catalogue is unreachable" and "there is genuinely no star here" are
      different sentences and one of them is not the user's fault.
    */
    return fetch(url).then(function (r) { return r.ok ? r.text() : null; })
      .then(function (text) {
        if (text === null || text === undefined) return null;
        return parseTsv(text, cat).map(function (row) {
          var name = cat.label + ' ' + row.id;
          if (!ucac4Agrees(row.id, row.dec)) {
            try {
              console.warn('[geosonify] star lookup discarded: ' + name +
                           ' declination zone disagrees with ' + row.dec.toFixed(4));
            } catch (e) {}
            return null;
          }
          // Parallax in milliarcseconds -> parsecs -> light years. Negative and
          // tiny parallaxes are noise, not distance, and are reported as absent
          // rather than as an enormous number.
          var ly = null;
          if (row.plx !== null && row.plx > 0.05) {
            ly = Math.round((1000 / row.plx) * PC_TO_LY * 10) / 10;
          }
          var star = {
            ra: row.ra, dec: row.dec, mag: row.mag,
            name: name, con: null, distLy: ly,
            sepDeg: row.sepArcmin === null ? null : row.sepArcmin / 60
          };
          return {
            tier: 'remote', coarse: false, catalogue: cat.label,
            star: star, offset: earthOffset(lat, lon, star.dec, star.ra),
            distLy: ly, links: links(star)
          };
        }).filter(Boolean);
      })
      .catch(function () { return null; });
  }

  /*
    VizieR TSV: comment lines start with '#', then a header line, then a rule
    line of dashes, then data. Columns are looked up BY NAME from the header
    rather than by position, and the request names them explicitly, so a change
    in VizieR's default ordering cannot silently shift the parse.
  */
  function parseTsv(text, cat) {
    var lines = String(text || '').split('\n').filter(function (l) {
      return l && l.charAt(0) !== '#';
    });
    var header = null, out = [];

    for (var i = 0; i < lines.length; i++) {
      var parts = lines[i].split('\t');
      if (!header) {
        if (parts.length > 1 && parts.indexOf(cat.raCol) !== -1) header = parts;
        continue;
      }
      if (/^-+$/.test((parts[0] || '').trim())) continue;      // rule line
      if (parts.length < 2) continue;

      var idx = {};
      for (var h = 0; h < header.length; h++) idx[header[h].trim()] = h;
      function num(name) {
        if (name === null || idx[name] === undefined) return null;
        var v = (parts[idx[name]] || '').trim();
        if (v === '') return null;
        var f = parseFloat(v);
        return isFinite(f) ? f : null;
      }
      function str(name) {
        if (idx[name] === undefined) return null;
        var v = (parts[idx[name]] || '').trim();
        return v === '' ? null : v;
      }

      var ra = num(cat.raCol), dec = num(cat.decCol);
      if (ra === null || dec === null) continue;

      out.push({
        ra: ra, dec: dec,
        mag: num(cat.magCol),
        plx: num(cat.plxCol),
        sepArcmin: num('_r'),
        id: str(cat.idCol) || (ra.toFixed(5) + (dec < 0 ? '' : '+') + dec.toFixed(5))
      });
    }
    return out;
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
  /*
    One line, the way a person would say it. Never uses the word "nearest": the
    nearest star is the Sun.

    The ground offset leads, because that is the part that makes the star yours
    -- "170 m north-east" is a place you can stand. The light-year figure follows
    as the star's real distance, which is the only distance to it that means
    anything.
  */
  function describe(result) {
    if (!result) return '';
    var s = result.star, o = result.offset;
    var bits = [s.name];

    if (o.metres < 1) bits.push('exactly at your coordinates');
    else bits.push(formatDistance(o.metres) + ' ' + o.compass + ' of you, on the ground');

    var ly = formatLightYears(result.distLy);
    if (ly) bits.push(ly + ' away');

    if (result.coarse) bits.push('brightest here, not closest');
    return bits.join(' \u2014 ');
  }

  /*
    REMOTE FIRST, AND NO SILENT SUBSTITUTION.

    The embedded catalogue used to answer when the network could not, and that
    was wrong. A neighbour 450 km away does not change as you cross the city, so
    the card reads identically from one side of a life to the other -- it is
    scenery, not information, and worse, it LOOKS like an answer. Across St
    Martins there are 0.0 distinct embedded neighbours, 1.4 UCAC4 ones and 5.6
    Gaia ones.

    So the local tier is no longer a fallback. It is returned only when asked for
    explicitly, and `status` says plainly which of the three things happened:

      'ok'       real hyperlocal neighbours
      'offline'  the deep catalogue could not be reached
      'none'     it was reached and there is genuinely nothing within the radius

    A caller showing 'offline' should say so rather than filling the space.
    Nothing is better than something meaningless.
  */
  /*
    CACHING, WITH A RULE THAT IS PROVABLE RATHER THAN A GUESS.

    While tracking, the coordinate changes several times a second. Re-querying on
    every tick made the card flip to "Looking up..." and back continuously, which
    is both useless to read and rude to CDS.

    The fix rests on one fact: a cone search of radius R returns EVERY star
    within R of the query point. Move a distance d from that point and you still
    know, with certainty, every star within R - d of where you now stand. So if
    the furthest star you kept is closer than R - d, your list is still provably
    the correct nearest-three -- no unseen star can have slipped inside it.

        re-query when   d  >=  R - sep(last kept star)

    With R = 1 arcmin (1,855 m of ground) and the three stars from your card:

        3rd star at 223 m  ->  1,632 m of walking before a re-query
        3rd star at 448 m  ->  1,407 m
        3rd star at 900 m  ->    955 m

    So a whole suburb on one request. And crucially the card is NOT frozen in
    between: the star positions are fixed, so every offset and bearing is
    recomputed locally on each move. The distances tick down as you walk toward
    one. Only the identity of the stars is cached, and only while it is provably
    unchanged.

    A tiny epsilon keeps a stationary GPS jitter from straddling the boundary.
  */
  var _cache = null;

  function cacheValid(lat, lon, opts) {
    if (!_cache) return false;
    if (_cache.catalogue !== (opts.catalogue || 'gaia')) return false;
    if (_cache.limit !== (opts.limit || 3)) return false;

    var moved = earthOffset(_cache.lat, _cache.lon, lat, ((lon % 360) + 360) % 360).metres;
    return moved < _cache.validForMetres;
  }

  function refreshOffsets(lat, lon) {
    return _cache.entries.map(function (e) {
      var off = earthOffset(lat, lon, e.star.dec, e.star.ra);
      return {
        tier: e.tier, coarse: e.coarse, catalogue: e.catalogue,
        star: e.star, offset: off, distLy: e.distLy, links: e.links
      };
    }).sort(function (a, b) { return a.offset.metres - b.offset.metres; });
  }

  function clearCache() { _cache = null; }

  function lookup(lat, lon, opts) {
    opts = opts || {};
    if (opts.local === true) {
      var l = lookupLocal(lat, lon, opts);
      return Promise.resolve({ status: l ? 'ok' : 'none', tier: 'local',
                               entries: l ? [l] : [] });
    }
    if (cacheValid(lat, lon, opts)) {
      return Promise.resolve({ status: 'ok', tier: 'remote', cached: true,
                               entries: refreshOffsets(lat, lon) });
    }

    var radiusArcmin = opts.radiusArcmin || 1;
    return lookupRemote(lat, lon, opts).then(function (entries) {
      if (entries === null) return { status: 'offline', tier: 'remote', entries: [] };
      if (entries.length) {
        var furthest = entries.reduce(function (m, e) {
          return Math.max(m, e.offset.metres);
        }, 0);
        var radiusMetres = radiusArcmin * 60 / 3600 * M_PER_DEG;
        _cache = {
          lat: lat, lon: ((lon % 360) + 360) % 360,
          catalogue: opts.catalogue || 'gaia', limit: opts.limit || 3,
          entries: entries,
          // Provable validity, minus a metre so GPS jitter cannot straddle it.
          validForMetres: Math.max(0, radiusMetres - furthest - 1)
        };
        return { status: 'ok', tier: 'remote', cached: false, entries: entries };
      }
      _cache = null;
      return { status: 'none', tier: 'remote', entries: [] };
    }).catch(function () {
      return { status: 'offline', tier: 'remote', entries: [] };
    });
  }

  function offlineNote() {
    return 'Could not reach the deep star catalogue. The stars at your exact ' +
           'address are only in Gaia \u2014 the built-in list holds bright stars ' +
           'a few hundred kilometres away, which would not change as you move.';
  }

  function emptyNote(radiusArcmin) {
    return 'Nothing catalogued within ' + (radiusArcmin || 1) + '\u2032 of your ' +
           'coordinates \u2014 about ' + Math.round((radiusArcmin || 1) * 60 / 3600 * 111319.9) +
           ' m on the ground. Try a coarser cell or a wider radius.';
  }

  /*
    Kept for the explicit local tier, which is now an opt-in curiosity rather
    than a fallback.
  */
  function coarseNote() {
    return 'From the built-in bright-star catalogue (1,765 stars). These are ' +
           'hundreds of kilometres away read as ground distance and will not ' +
           'change as you move around a city.';
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
    offlineNote: offlineNote,
    clearCache: clearCache,
    cacheValid: function (lat, lon, o) { return cacheValid(lat, lon, o || {}); },
    emptyNote: emptyNote,
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
