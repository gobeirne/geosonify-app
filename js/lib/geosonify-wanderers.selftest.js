/*
  geosonify-wanderers.selftest.js — run: node geosonify-wanderers.selftest.js

  Gates the wander-v1 request grammar, the label rules, the parameter-name
  audit, and agreement with JPL DE421 for both mappings.

  Needs vendor/astronomy-engine-2.1.19.browser.min.js beside this file (the
  same file the page loads), or `npm i astronomy-engine@2.1.19`.

  REFERENCE VECTORS. Each row is [body, unix ms, astrometric RA deg, Dec deg,
  sub-point geodetic lat deg, lon deg], from JPL DE421 via Skyfield 1.55:
    astrometric  earth.at(t).observe(body).radec()        (ICRS, light time)
    sub-point    wgs84.subpoint_of(earth.at(t).observe(body).apparent())
  Planets other than Mercury and Venus are their system barycentres in DE421;
  the offset from the planet centre is under 0.1" at these distances.

  Two things the zenith rows measure that are not ephemeris error:
    - Before 1972 "UTC" is not defined. Skyfield extends TAI - UTC = 10 s back,
      so its 1950 UTC is UT1 - 13 s; Astronomy Engine reads the time as UT.
      13 s is 195" of longitude, so the 1950 rows are checked in pin mode only.
    - After the present, UT1 is a prediction (DeltaT). The two libraries
      disagree by about 2 s in 2049: 33" of longitude, about 0.9 km.
*/
'use strict';
var W = require('./geosonify-wanderers.js');
var A;
try { A = require('./vendor/astronomy-engine-2.1.19.browser.min.js'); }
catch (e) { A = require('astronomy-engine'); }
W.setEngine(A);

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }
function throwsWith(fn, re) { try { fn(); return false; } catch (e) { return re ? re.test(e.message) : true; } }
var D = Math.PI / 180;
function sepArcsec(ra1, d1, ra2, d2) {
  var c = Math.sin(d1 * D) * Math.sin(d2 * D) + Math.cos(d1 * D) * Math.cos(d2 * D) * Math.cos((ra1 - ra2) * D);
  return Math.acos(Math.min(1, c)) / D * 3600;
}
var NOW = Date.UTC(2026, 9, 24, 7, 30);       // a fixed "today" for the defaults
var P = function (v) { return W.parseRequest(v, { nowMs: NOW }); };

var REF = [
  ["sun", -626054400000, 342.0409973, -7.615826, -7.8824671, -176.8983293],
  ["sun", 946728000000, 281.288984, -23.0332511, -23.0324361, 0.8198341],
  ["sun", 1792800000000, 208.1261227, -11.5488956, -11.6801289, 176.0655529],
  ["sun", 1793448000000, 215.3471601, -14.0779581, -14.199638, -4.0982841],
  ["sun", 1847847360000, 121.6014521, 20.2641314, 20.1813117, 137.6212243],
  ["sun", 2507394600000, 83.9077573, 23.3146056, 23.3408848, -97.3127932],
  ["moon", -626054400000, 118.9810327, 25.8528493, 25.9901424, -40.0546824],
  ["moon", 946728000000, 222.4589255, -10.9033838, -10.9017829, -58.0063405],
  ["moon", 1792800000000, 0.634449, 3.3973215, 3.5499761, -31.4303516],
  ["moon", 1793448000000, 112.1195267, 24.9301414, 24.8769975, -107.2750425],
  ["moon", 1847847360000, 121.4113579, 19.6848728, 19.604623, 137.4296813],
  ["moon", 2507394600000, 263.3629506, -21.9101632, -21.9418665, 82.146499],
  ["mercury", -626054400000, 322.8735521, -16.5425593, -16.7661702, 163.8958224],
  ["mercury", 946728000000, 272.0852168, -24.4203814, -24.4189067, -8.3839037],
  ["mercury", 1792800000000, 227.3050595, -20.8192218, -20.920948, -164.7282322],
  ["mercury", 1793448000000, 223.8559074, -18.4840691, -18.5919727, 4.4232745],
  ["mercury", 1847847360000, 117.6724, 22.3702087, 22.2968326, 133.7001173],
  ["mercury", 2507394600000, 62.5988389, 18.9412704, 19.0653607, -118.6548806],
  ["venus", -626054400000, 305.8750612, -12.8278563, -12.9927921, 146.8965399],
  ["venus", 946728000000, 239.9011821, -18.4518534, -18.4489235, -40.5657817],
  ["venus", 1792800000000, 205.966624, -17.7519216, -17.8856197, 173.9123142],
  ["venus", 1793448000000, 202.3610377, -14.7276032, -14.8650637, -17.0910207],
  ["venus", 1847847360000, 74.8034768, 18.3772529, 18.4196125, 90.825917],
  ["venus", 2507394600000, 38.3126958, 12.3320043, 12.5466014, -142.9862911],
  ["mars", -626054400000, 190.5220597, -0.658894, -0.3881865, 31.6036443],
  ["mars", 946728000000, 330.5246009, -13.1804993, -13.1824832, 50.0582583],
  ["mars", 1792800000000, 137.0212544, 17.966586, 17.8581777, 104.984082],
  ["mars", 1793448000000, 140.9420455, 16.9492202, 16.8337019, -78.4912174],
  ["mars", 1847847360000, 90.5119989, 23.8925944, 23.8914616, 106.5529794],
  ["mars", 2507394600000, 100.7077141, 24.0773113, 24.0234035, -80.5103103],
  ["jupiter", -626054400000, 323.6873429, -15.1000969, -15.3261292, 164.7150324],
  ["jupiter", 946728000000, 23.8698355, 8.5958959, 8.5942596, 103.4093018],
  ["jupiter", 1792800000000, 145.4719352, 14.5070352, 14.3849833, 113.4228081],
  ["jupiter", 1793448000000, 146.4369529, 14.2068179, 14.0829449, -73.0046785],
  ["jupiter", 1847847360000, 174.4783972, 3.6674141, 3.5087588, -169.5485329],
  ["jupiter", 2507394600000, 98.6877653, 23.1984533, 23.1540646, -82.5344612],
  ["saturn", -626054400000, 169.1259288, 7.0776245, 7.3482712, 10.2022638],
  ["saturn", 946728000000, 38.766012, 12.6162782, 12.6147645, 118.3068584],
  ["saturn", 1792800000000, 9.7352403, 1.2564323, 1.4066915, -22.328608],
  ["saturn", 1793448000000, 9.2665041, 1.0721549, 1.2225772, 149.8101793],
  ["saturn", 1847847360000, 38.4050178, 12.532808, 12.65898, 54.4013161],
  ["saturn", 2507394600000, 297.4230441, -20.9986636, -20.8676287, 116.1882525],
  ["uranus", -626054400000, 91.8204741, 23.7047, 23.7142921, -67.2215004],
  ["uranus", 946728000000, 317.4838216, -17.018832, -17.0203211, 37.016277],
  ["uranus", 1792800000000, 62.6352381, 20.9005978, 20.971993, 30.6216441],
  ["uranus", 1793448000000, 62.3637092, 20.8538831, 20.9259587, -157.0417458],
  ["uranus", 1847847360000, 70.9814453, 22.2383319, 22.2905536, 87.0146664],
  ["uranus", 2507394600000, 163.1842914, 7.9738929, 7.7084687, -18.1395187],
  ["neptune", -626054400000, 196.8553976, -5.3883433, -5.124716, 37.929629],
  ["neptune", 946728000000, 305.4426512, -19.2124268, -19.2132355, 24.9742903],
  ["neptune", 1792800000000, 2.2890773, -0.5527553, -0.4007552, -29.7756778],
  ["neptune", 1793448000000, 2.1340821, -0.6171557, -0.4651717, 142.6768762],
  ["neptune", 1847847360000, 8.3533648, 2.0087725, 2.1688828, 24.3311071],
  ["neptune", 2507394600000, 52.1168684, 17.1507968, 17.3175994, -129.1531018],
  ["pluto", -626054400000, 142.3561165, 23.5883865, 23.8074295, -16.6348493],
  ["pluto", 946728000000, 251.428117, -11.3964416, -11.3942973, -29.0393731],
  ["pluto", 1792800000000, 306.0520885, -23.7141164, -23.6275183, -85.9633127],
  ["pluto", 1793448000000, 306.0950826, -23.6991252, -23.612433, 86.6867738],
  ["pluto", 1847847360000, 311.2537507, -23.504509, -23.3971505, -32.7128008],
  ["pluto", 2507394600000, 345.3756665, -20.1338274, -19.8634003, 164.0677399]];

head('grammar: defaults');
var r = P('jupiter');
ok('body', r.body === 'jupiter');
ok('mode defaults to pin', r.mode === 'pin');
ok('from defaults to today 00:00 UTC', r.fromMs === Date.UTC(2026, 9, 24));
ok('pin spans 7 days in 1 day steps: 8 samples', r.n === 8 && r.stepMs === 86400000);
r = P('jupiter,zenith');
ok('zenith spans 1 day in 1 hour steps: 25 samples', r.n === 25 && r.stepMs === 3600000);
ok('calc is wander-v1', r.calc === 'wander-v1' && W.CALC === 'wander-v1');
r = P('jupiter,utc:13');
ok('"today" follows utc: (24 Oct 07:30 UTC is 24 Oct in NZDT)', r.fromMs === Date.UTC(2026, 9, 23, 11));
r = W.parseRequest('jupiter,utc:13', { nowMs: Date.UTC(2026, 9, 24, 12) });
ok('...and 24 Oct 12:00 UTC is already 25 Oct there', r.fromMs === Date.UTC(2026, 9, 24, 11));

head('grammar: tokens');
r = P('Moon, ZENITH ,from:2026-10-24T06:00,for:12h,step:30m');
ok('case and spaces do not matter', r.body === 'moon' && r.mode === 'zenith');
ok('from: with a time', r.fromMs === Date.UTC(2026, 9, 24, 6));
ok('for: and step: in h and m', r.toMs - r.fromMs === 12 * 3600000 && r.stepMs === 1800000 && r.n === 25);
r = P('mars,from:2026-01-01,to:2026-12-31');
ok('to: is inclusive when a tick lands on it', r.n === 365);
r = P('venus,from:2026-10-24,utc: 13');
ok('a "+" that arrived as a space still means +', r.offsetMin === 780 && r.fromMs === Date.UTC(2026, 9, 23, 11));
ok('utc:5:30 and utc:-5', P('venus,utc:5:30').offsetMin === 330 && P('venus,utc:-5').offsetMin === -300);
ok('order does not matter', JSON.stringify(P('step:1d,from:2026-10-24,saturn')) === JSON.stringify(P('saturn,from:2026-10-24,step:1d')));
ok('wander-v1 is accepted', P('pluto,wander-v1').calc === 'wander-v1');
ok('the URL layer delivers the value it decoded', (function () {
  var u = new URLSearchParams('wander=jupiter,zenith,utc:+13&auto=1');
  return W.parseRequest(u.get('wander'), { nowMs: NOW }).offsetMin === 780;
})());

head('grammar: errors are readable, never silent');
ok('no body', throwsWith(function () { P('zenith'); }, /no body/));
ok('two bodies', throwsWith(function () { P('moon,mars'); }, /more than one body/));
ok('unknown word', throwsWith(function () { P('jupiter,zenth'); }, /did not understand "zenth"/));
ok('unknown key', throwsWith(function () { P('jupiter,start:2026-10-24'); }, /did not understand/));
ok('pin and zenith together', throwsWith(function () { P('jupiter,pin,zenith'); }, /more than one mode/));
ok('a newer calc', throwsWith(function () { P('jupiter,wander-v2'); }, /newer Geosonify/));
ok('bad date', throwsWith(function () { P('jupiter,from:2026-02-30'); }, /not a real date/));
ok('bad duration', throwsWith(function () { P('jupiter,step:1w'); }, /m, h or d/));
ok('to: and for:', throwsWith(function () { P('jupiter,from:2026-10-24,to:2026-10-30,for:3d'); }, /not both/));
ok('end before start', throwsWith(function () { P('jupiter,from:2026-10-24,to:2026-10-20'); }, /after the start/));
ok('too many samples', throwsWith(function () { P('moon,for:100d,step:1h'); }, /too many/));
ok('one point only', throwsWith(function () { P('moon,for:1d,step:2d'); }, /only one point/));
ok('out of range', throwsWith(function () { P('moon,from:1850-01-01'); }, /1900 and 2100/));
ok('empty item', throwsWith(function () { P('moon,,zenith'); }, /empty item/));
ok('empty value', throwsWith(function () { P(''); }, /name a body/));
ok('bad offset', throwsWith(function () { P('moon,utc:15'); }, /out of range/));

head('labels');
var req = P('jupiter,from:2026-10-24');
var pts = W.sample(req);
var L = W.labelsFor(req, pts);
ok('one label per daily tick', Object.keys(L).length === 8);
ok('first names the body and year, and says how good it is', L[0] === 'Jupiter 24 Oct 2026 \u00b7 \u00b11\u2032', L[0]);
ok('later ones are short', L[1] === '25 Oct' && L[7] === '31 Oct', L[1] + ' / ' + L[7]);
req = P('jupiter,zenith,from:2026-10-24,utc:13');
L = W.labelsFor(req, W.sample(req));
ok('zenith label carries time, offset and accuracy on the ground', L[0] === 'Jupiter overhead 24 Oct 2026 00:00 UTC+13 \u00b7 \u00b12 km', L[0]);
ok('hours, then the date when it changes', L[1] === '01:00' && L[24] === '25 Oct 00:00', L[1] + ' / ' + L[24]);
ok('negative offsets use a real minus', W.offsetText(-300) === 'UTC\u22125' && W.offsetText(330) === 'UTC+5:30');
req = P('moon,from:2026-10-24,for:30d,step:1h');
L = W.labelsFor(req, W.sample(req));
var keys = Object.keys(L).map(Number);
ok('thinned to at most ' + W.MAX_LABELS, keys.length <= W.MAX_LABELS, keys.length);
ok('thinned to a round interval (daily)', keys.every(function (k) { return k % 24 === 0; }), keys.slice(0, 4));
ok('the last tick is always labelled', L[req.n - 1] !== undefined);
ok('every label fits the 60-character limit', Object.keys(L).every(function (k) { return Array.from(L[k]).length <= 60; }));
req = P('neptune,from:1900-01-01,to:2100-12-31,step:90d');
L = W.labelsFor(req, W.sample(req));
ok('long spans: still capped, years shown when they change', Object.keys(L).length <= W.MAX_LABELS &&
   /\d{4}$/.test(L[Object.keys(L)[1]]), L[Object.keys(L)[1]]);

head('the mappings');
var pj = W.pinOf('jupiter', Date.UTC(2026, 9, 24));
ok('pin: latitude is declination', Math.abs(pj.lat - pj.decDeg) < 1e-7);
ok('pin: longitude is RA, wrapped to [-180, 180)', Math.abs(((pj.raDeg + 180) % 360 - 180) - pj.lon) < 1e-7);
ok('pin: on the 1e-7 degree grid', Math.round(pj.lat * 1e7) === pj.lat * 1e7 && Math.round(pj.lon * 1e7) === pj.lon * 1e7);
var ps = W.pinOf('sun', Date.UTC(2026, 2, 20, 15));        // near the March equinox, RA ~ 0h
ok('pin: RA just under 360 maps just under 0 (never +180)', ps.lon < 1 && ps.lon > -1, ps.lon);
var zj = W.zenithOf('jupiter', Date.UTC(2026, 9, 24));
ok('zenith: latitude is the apparent declination for a distant body (< 1")', Math.abs(zj.lat - zj.decDeg) * 3600 < 1, (zj.lat - zj.decDeg) * 3600);
var z1 = W.zenithOf('sun', Date.UTC(2026, 9, 24, 0)), z2 = W.zenithOf('sun', Date.UTC(2026, 9, 24, 1));
var dl = ((z1.lon - z2.lon) + 360) % 360;
ok('zenith: moves west about 15 degrees an hour', Math.abs(dl - 15) < 0.05, dl);
var zs = W.zenithOf('sun', Date.UTC(2026, 9, 24, 12));
ok('zenith: the Sun is near longitude 0 at 12:00 UTC (equation of time < 4.5 deg)', Math.abs(zs.lon) < 4.5, zs.lon);
var m1 = W.pinOf('moon', Date.UTC(2026, 9, 24, 0)), m2 = W.pinOf('moon', Date.UTC(2026, 9, 24, 1));
var mv = sepArcsec(m1.raDeg, m1.decDeg, m2.raDeg, m2.decDeg) / 3600;
ok('the Moon drifts about half a degree an hour (11-15 degrees a day)', mv > 11 / 24 && mv < 15 / 24, mv);
var g = W.geodetic(0, 0, 1);
ok('geodetic: a point above the pole is at 90', g.lat === 90);
g = W.geodetic(1, 0, 0);
ok('geodetic: on the equator at 0', Math.abs(g.lat) < 1e-12 && g.lon === 0);
var gz = W.geodetic(Math.cos(45 * D), 0, Math.sin(45 * D));   // 1 AU away, 45 deg geocentric
// 1 AU away the ellipsoid normal through the point is tilted from the
// geocentric direction by (e^2/2) sin(2 phi) (a/R) = 0.03": real, and tiny.
ok('geodetic: converges 1 AU out, within 0.1" of the direction', Math.abs(gz.lat - 45) * 3600 < 0.1, (gz.lat - 45) * 3600);

head('agreement with JPL DE421 (limit 60", the documented accuracy)');
var worst = {};
REF.forEach(function (row) {
  var b = row[0], ms = row[1];
  var p = W.pinOf(b, ms);
  var s = sepArcsec(p.raDeg, p.decDeg, row[2], row[3]);
  var w = worst[b] || (worst[b] = { pin: 0, zen: 0 });
  w.pin = Math.max(w.pin, s);
  if (ms >= Date.UTC(1972, 0, 1)) {
    var z = W.zenithOf(b, ms);
    w.zen = Math.max(w.zen, sepArcsec(z.lon, z.lat, row[5], row[4]));
  }
});
Object.keys(worst).forEach(function (b) {
  ok(b + ': pin ' + worst[b].pin.toFixed(1) + '", zenith ' + worst[b].zen.toFixed(1) + '"', worst[b].pin < 60 && worst[b].zen < 60);
});

head('build()');
W.build('jupiter,from:2026-10-24', { nowMs: NOW }).then(function (o) {
  ok('pin builds a sky path', o.frame === 'icrs' && o.coords.length === 8);
  ok('coords are [lat, lon] in sample order', o.coords[0][0] === o.points[0].lat && o.coords[7][1] === o.points[7].lon);
  ok('a week of Jupiter is a short arc (0.05-0.3 deg a day)', (function () {
    var a = o.points[0], b = o.points[7];
    var d = sepArcsec(a.raDeg, a.decDeg, b.raDeg, b.decDeg) / 3600 / 7;
    return d > 0.05 && d < 0.3;
  })());
  ok('the name says which mapping', /moving starpin/.test(o.name), o.name);
  return W.build('jupiter,zenith,from:2026-10-24', { nowMs: NOW });
}).then(function (o) {
  ok('zenith builds an Earth path', o.frame === 'earth' && o.coords.length === 25 && /overhead/.test(o.name));
  return W.build('jupiter,zenth').then(function () { ok('bad request rejects', false); },
                                        function (e) { ok('bad request rejects with the readable message', /zenth/.test(e.message)); });
}).then(function () {
  head('parameter-name audit');
  var BASES = ['a', 'e', 'h', 'c', 'm', 'n', 'bip', 'bw', 'bm', 'be', 'b64', 'bipes', 'bipfr', 'bipit',
               'bippt', 'bipcs', 'bipja', 'bipko', 'bipzhs', 'bipzht'];   // index.html baseParamMap
  ok('"wander" begins with no vocabulary base of parseURLParam()',
     BASES.every(function (b) { return 'wander'.indexOf(b) !== 0; }));
  var U = null;
  try { U = require('./geosonify-sky-url.js'); } catch (e) {}
  if (U && U.checkParamName) ok('"wander" passes checkParamName (no HEALPix prefix)', U.checkParamName('wander').safe);
  else console.log('  skip  geosonify-sky-url.js not beside this file');
  ok('"wander" is not a custom-grid name (z.)', 'wander'.indexOf('z.') !== 0);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch(function (e) { console.log('  FAIL  threw: ' + (e && e.stack || e)); process.exit(1); });
