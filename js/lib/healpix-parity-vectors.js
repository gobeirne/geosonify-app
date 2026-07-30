/*
  healpix-parity-vectors.js — emit HEALPix test vectors as JSON for external checking.

    node healpix-parity-vectors.js > vectors.json
    python3 healpix-parity-check.py vectors.json

  Needs geosonify-healpix.js and geosonify-sky.js alongside it.

  This exists because the FAQ claims the engine is bit-identical to healpy at
  every shared order. That is an interoperability claim now that Geosonify emits
  MOC, so it should be checked by machine against the reference libraries rather
  than asserted. The Python side validates against healpy (indexing and centres)
  and mocpy (MOC ASCII round-trip and the order-29 ceiling).

  Emits, for each vector: the input lat/lon, the order, and everything Geosonify
  derives from them — so the checker can verify the whole chain independently
  rather than trusting any intermediate value.
*/
'use strict';

var HP = require('./geosonify-healpix.js');
var Sky = require('./geosonify-sky.js');

var MAX_HEALPY_ORDER = 29;          // healpy caps nside at 2^29
var SAMPLES_PER_ORDER = 60;

// Deterministic PRNG so a failure is reproducible.
var seed = 20260730;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

/*
  TIE-PRONE INPUTS -- reported separately, never counted as failures.

  Verified with 60-digit mpmath arithmetic: on 500 generic random points at
  order 26, Geosonify, healpy, cdshealpix and astropy_healpix ALL agree with the
  exact truth. Divergence appears only for degenerate inputs:

    - exact poles, where longitude is undefined;
    - face-boundary meridians and the equator;
    - coordinates that are exactly a cell centre at some coarser order, which
      therefore sit exactly ON a boundary at finer orders (393 of 500 order-22
      centres diverge when re-encoded at order 26).

  At an exact tie, implementations round differently by formulation: Geosonify
  and astropy_healpix use the tu/fpq projection; healpy and cdshealpix use the
  classic jp/jm integer-line method. Neither is wrong; the input is ambiguous.

  PRACTICAL CONSEQUENCE: never round-trip a coordinate through a displayed cell
  CENTRE and re-encode it at a deeper order. That is the one operation where a
  tie is guaranteed rather than unlikely.
*/
var TIE_PRONE_POINTS = [
  [90, 0], [-90, 0], [90, 180], [-90, -180],
  [0, 0], [0, 180], [0, -180], [0, 90], [0, -90],
  [89.9999999, 45], [-89.9999999, -45],
  [45, 0], [-45, 0], [45, 179.9999999], [45, -179.9999999],
  [0, 359.9999999], [0, 360], [0, -0.0000001],
  [41.81031489, 45], [-41.81031489, 135],   // near HEALPix face corners
  // The Appendix A vector. Exact at order 22 (it IS that cell's centre), and
  // therefore deliberately tie-prone at every deeper order.
  [-43.55548056777462, 172.6509186643265]
];

// Generic points: awkward magnitudes, but not degenerate. These MUST match the
// reference implementations exactly at every order.
var GENERIC_POINTS = [
  [51.4779433, -0.0014869],     [-33.8567844, 151.2152967],
  [35.6894875, 139.6917064],    [-22.9068467, -43.1728965],
  [64.1265206, -21.8174392],    [-54.8019432, -68.3029511],
  [1.3520830, 103.8198360],     [-0.0000001, 0.0000001],
  [78.2231667, 15.6469444],     [-77.8463000, 166.6683000]
];

function vector(lat, lon, order, tag) {
  var ipix = HP.nestIndex(lat, lon, order);          // BigInt
  var path = HP.nestPath(ipix, order);
  var centre = HP.nestCentre(ipix, order);           // [lat, lon]
  return {
    tag: tag || 'random',
    order: order,
    lat: lat,
    lon: lon,
    ipix: ipix.toString(),
    face: path.f,
    digits: path.digits.join(''),
    quaternary: 'f' + path.f + '.' + path.digits.join(''),
    nuniq: Sky.nuniq(order, ipix).toString(),
    moc: order + '/' + ipix.toString(),
    centreLat: centre[0],
    centreLon: centre[1],
    cellArcsec: Sky.cellSize(order).arcsec
  };
}

var out = [];

for (var k = 0; k <= MAX_HEALPY_ORDER; k++) {
  TIE_PRONE_POINTS.forEach(function (p) { out.push(vector(p[0], p[1], k, 'tie-prone')); });
  GENERIC_POINTS.forEach(function (p) { out.push(vector(p[0], p[1], k, 'generic')); });
  for (var i = 0; i < SAMPLES_PER_ORDER; i++) {
    // Uniform on the sphere, so cells near the poles are sampled fairly.
    var lat = Math.asin(2 * rnd() - 1) * 57.29577951308232;
    var lon = rnd() * 360 - 180;
    out.push(vector(lat, lon, k, 'random'));
  }
}

// A few beyond healpy's reach, for the mocpy ceiling check only.
[30, 34, 40].forEach(function (k) {
  out.push(vector(51.4779433, -0.0014869, k, 'beyond-healpy'));
});

process.stdout.write(JSON.stringify({
  generator: 'healpix-parity-vectors.js',
  engine: 'geosonify-healpix.js',
  maxHealpyOrder: MAX_HEALPY_ORDER,
  count: out.length,
  vectors: out
}, null, 1));
