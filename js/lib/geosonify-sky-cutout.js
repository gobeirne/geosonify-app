/*
  geosonify-sky-cutout.js v0.1 — sky thumbnails made on the device.

  Star cards used CDS's hips2fits service for their little sky pictures: one
  <img src> per card, rendered in Strasbourg. During the October-November 2026
  CDS outage hips2fits was down and every card window was blank, while three
  independent copies of the same DSS2 survey (CSIRO, ESA, MAST) still served
  their tiles to the app.

  So this makes the same picture here: it fetches the HiPS tiles of whichever
  DSS2 copy is answering (chosen by GeosonifySkyAladin.surveyBaseUrl, the same
  mirror list the sky view uses), and resamples them onto a gnomonic (TAN)
  image exactly as hips2fits would: centred on (ra, dec), FIELD = fov across the
  width, NORTH UP and EAST LEFT. The result is a data: URL, which also means a
  card can draw it into a canvas without tainting it (hips2fits images did).

  Callers do not change their URLs. src(url) takes the hips2fits URL they
  already build and resolves to a picture: the device-made one when it can,
  otherwise the original URL, so with Strasbourg up nothing is lost.

  HOW A SKY POINT FINDS ITS TILE PIXEL. HEALPix (the repo's own library) gives
  the base face f and the continuous face coordinates p (north-east axis) and q
  (north-west axis). At tile order k the tile is (floor(p*2^k), floor(q*2^k))
  and the point lies at (p*2^k mod 1, q*2^k mod 1) inside it.

  How those two axes sit in a JPEG or PNG tile is the one convention this
  depends on. It follows the astropy-affiliated "hips" package (0.2,
  hips/draw/paint.py, tile_corner_pixel_coordinates), which maps tile corners
  N, W, S, E to FITS pixels (w,0), (w,w), (0,w), (0,0) after flipping JPEG/PNG
  rows. In the image as stored that is: south corner top-left, west corner
  top-right, north bottom-right, east bottom-left. So the COLUMN runs along
  the north-west axis (q) and the ROW along the north-east axis (p).
  UNVERIFIED against a live tile from the sandbox this was written in; a
  wrong guess would show as a rotated or mirrored picture, never a wrong star
  position on the card's markers, and is a one-line change (swapCols below).

  Browser: window.GeosonifySkyCutout.  Needs HealpixGrids (with _core.za2tu,
  _core.tu2fpq, _core.fxy2nest) and, for mirror choice, GeosonifySkyAladin.
*/
(function (root) {
  'use strict';
  var VERSION = 'v0.1';
  var D2R = Math.PI / 180;
  var HIPS_IDS = { 'CDS/P/DSS2/color': 'P/DSS2/color' };   // hips2fits name -> survey id
  var TILE_CACHE_MAX = 48;
  var MAX_PX = 480;
  var swapCols = false;          // if the tile layout guess is ever wrong: true

  var _props = {};               // base -> Promise<{ order, ext, width }>
  var _tiles = {};               // url -> Promise<ImageData|null>
  var _tileOrder = [];

  function core() {
    // geosonify-healpix.js declares HealpixGrids with const at top level,
    // which makes a global binding but NOT a property of window.
    var H = (typeof HealpixGrids !== 'undefined') ? HealpixGrids : root.HealpixGrids;
    var C = H && H._core;
    return C && C.za2tu && C.tu2fpq && C.fxy2nest ? C : null;
  }

  function properties(base) {
    if (_props[base]) return _props[base];
    _props[base] = fetch(base + '/properties').then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (t) {
        function get(k) { var m = new RegExp('^\\s*' + k + '\\s*=\\s*(.+)$', 'm').exec(t); return m ? m[1].trim() : null; }
        var fmt = (get('hips_tile_format') || 'jpeg').toLowerCase();
        return {
          order: parseInt(get('hips_order'), 10) || 9,
          ext: /jpe?g/.test(fmt) ? 'jpg' : /png/.test(fmt) ? 'png' : 'jpg',
          width: parseInt(get('hips_tile_width'), 10) || 512
        };
      })
      .catch(function () { delete _props[base]; return null; });
    return _props[base];
  }

  function tileUrl(base, order, ipix, ext) {
    return base + '/Norder' + order + '/Dir' + (Math.floor(ipix / 10000) * 10000) +
           '/Npix' + ipix + '.' + ext;
  }

  // A tile's pixels, or null if it cannot be had (missing, or not CORS-readable).
  function tile(url) {
    if (_tiles[url]) return _tiles[url];
    _tileOrder.push(url);
    if (_tileOrder.length > TILE_CACHE_MAX) delete _tiles[_tileOrder.shift()];
    _tiles[url] = fetch(url).then(function (r) { return r.ok ? r.blob() : null; })
      .then(function (b) { return b ? createImageBitmap(b) : null; })
      .then(function (bm) {
        if (!bm) return null;
        var c = document.createElement('canvas');
        c.width = bm.width; c.height = bm.height;
        var g = c.getContext('2d');
        g.drawImage(bm, 0, 0);
        return g.getImageData(0, 0, bm.width, bm.height);
      })
      .catch(function () { return null; });
    return _tiles[url];
  }

  // The sky position of output pixel (i, j): inverse gnomonic about (ra0, dec0),
  // north up, east LEFT (x grows westward), as hips2fits draws it.
  function skyAt(i, j, px, py, scale, ra0, dec0) {
    var xi = -((i + 0.5) - px / 2) * scale;      // east-positive
    var eta = (py / 2 - (j + 0.5)) * scale;      // north-positive
    var rho = Math.hypot(xi, eta);
    if (rho === 0) return { ra: ra0, dec: dec0 };
    var c = Math.atan(rho), sc = Math.sin(c), cc = Math.cos(c);
    var sd = Math.sin(dec0), cd = Math.cos(dec0);
    var dec = Math.asin(cc * sd + eta * sc * cd / rho);
    var ra = ra0 + Math.atan2(xi * sc, rho * cd * cc - eta * sd * sc);
    return { ra: ra, dec: dec };
  }

  // Where (ra, dec) [radians] falls: tile index and the continuous pixel in it.
  function locate(C, nsideK, width, ra, dec) {
    var a = ((ra % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    var tu = C.za2tu(Math.sin(dec), a);
    var fpq = C.tu2fpq(tu.t, tu.u);
    var P = fpq.p * nsideK, Q = fpq.q * nsideK;
    var tx = Math.min(nsideK - 1, Math.floor(P)), ty = Math.min(nsideK - 1, Math.floor(Q));
    var ipix = Number(C.fxy2nest(nsideK, fpq.f, tx, ty));
    var row = (P - tx) * width, col = (Q - ty) * width;    // row along NE, column along NW
    return swapCols ? { ipix: ipix, col: row, row: col } : { ipix: ipix, col: col, row: row };
  }

  // Smallest order whose tile pixels are no coarser than one output pixel.
  function orderFor(scaleRad, width, maxOrder) {
    for (var k = 3; k < maxOrder; k++) {
      var pix = Math.sqrt(4 * Math.PI / (12 * Math.pow(4, k))) / width;
      if (pix <= scaleRad) return k;
    }
    return maxOrder;
  }

  function sample(img, col, row, out, o) {
    var w = img.width, h = img.height, d = img.data;
    var x = Math.min(w - 1.001, Math.max(0, col - 0.5)), y = Math.min(h - 1.001, Math.max(0, row - 0.5));
    var x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    var i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
    for (var ch = 0; ch < 3; ch++) {
      out[o + ch] = (d[i00 + ch] * (1 - fx) + d[i10 + ch] * fx) * (1 - fy) +
                    (d[i01 + ch] * (1 - fx) + d[i11 + ch] * fx) * fy;
    }
    out[o + 3] = 255;
  }

  /*
    cutout({ survey, ra, dec, fovDeg, width, height }) -> Promise<data URL|null>
    survey is a survey id (P/DSS2/color). null when no copy of it answers.
  */
  function cutout(o) {
    var C = core(), SA = root.GeosonifySkyAladin;
    if (!C || !SA || !SA.surveyBaseUrl || typeof createImageBitmap !== 'function') return Promise.resolve(null);
    return SA.surveyBaseUrl(o.survey).then(function (base) {
      if (!base) return null;
      return properties(base).then(function (pr) {
        if (!pr) return null;
        // Work at no more than MAX_PX across: a 900 px background costs 3.5x
        // the pixels of 480 for no visible gain once it is scaled to a phone.
        var shrink = Math.min(1, MAX_PX / Math.max(o.width, o.height || o.width));
        var px = Math.round(o.width * shrink), py = Math.round((o.height || o.width) * shrink);
        var scale = o.fovDeg * D2R / px;
        var k = orderFor(scale, pr.width, pr.order), nsideK = Math.pow(2, k);
        var ra0 = o.ra * D2R, dec0 = o.dec * D2R;
        // First pass: where every pixel lands, and which tiles that needs.
        var where = new Array(px * py), need = {};
        for (var j = 0; j < py; j++) for (var i = 0; i < px; i++) {
          var s = skyAt(i, j, px, py, scale, ra0, dec0);
          var L = locate(C, nsideK, pr.width, s.ra, s.dec);
          where[j * px + i] = L;
          need[L.ipix] = 1;
        }
        var ids = Object.keys(need);
        return Promise.all(ids.map(function (ip) { return tile(tileUrl(base, k, +ip, pr.ext)); }))
          .then(function (imgs) {
            var byIp = {}, any = false;
            ids.forEach(function (ip, n) { byIp[ip] = imgs[n]; if (imgs[n]) any = true; });
            if (!any) return null;
            var c = document.createElement('canvas');
            c.width = px; c.height = py;
            var g = c.getContext('2d'), out = g.createImageData(px, py);
            for (var n = 0; n < where.length; n++) {
              var L = where[n], im = byIp[L.ipix];
              if (im) sample(im, L.col, L.row, out.data, n * 4);
              else { out.data[n * 4 + 3] = 255; }
            }
            g.putImageData(out, 0, 0);
            return c.toDataURL('image/jpeg', 0.88);
          });
      });
    }).catch(function (e) {
      try { console.warn('[geosonify] sky cutout failed:', e && e.message || e); } catch (x) {}
      return null;
    });
  }

  // A hips2fits URL -> its parameters, or null if it is not one we can make.
  function parseHips2fits(url) {
    var m = /hips2fits\?(.*)$/.exec(String(url || ''));
    if (!m) return null;
    var q = {};
    m[1].split('&').forEach(function (kv) {
      var i = kv.indexOf('='); if (i > 0) q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    var survey = HIPS_IDS[q.hips];
    var w = +q.width, h = +(q.height || q.width), ra = +q.ra, dec = +q.dec, fov = +q.fov;
    if (!survey || !(w > 0) || !isFinite(ra) || !isFinite(dec) || !(fov > 0)) return null;
    if (q.projection && q.projection !== 'TAN') return null;
    return { survey: survey, width: w, height: h, ra: ra, dec: dec, fovDeg: fov };
  }

  var _made = {};                 // url -> Promise<string>
  /*
    src(hips2fitsUrl) -> Promise<string>: a picture made here when a mirror
    has the survey, else the URL itself. Same URL, same promise.
  */
  function src(url) {
    if (_made[url]) return _made[url];
    var p = parseHips2fits(url);
    _made[url] = !p ? Promise.resolve(url)
      : cutout(p).then(function (d) { if (!d) delete _made[url]; return d || url; });
    return _made[url];
  }
  // Point an <img> at the picture for a hips2fits URL.
  function setImg(img, url) {
    return src(url).then(function (u) { img.src = u; return u; });
  }

  var API = { VERSION: VERSION, cutout: cutout, src: src, setImg: setImg,
              parseHips2fits: parseHips2fits,
              _test: { skyAt: skyAt, locate: locate, orderFor: orderFor, tileUrl: tileUrl,
                       setSwap: function (v) { swapCols = !!v; } } };
  root.GeosonifySkyCutout = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
