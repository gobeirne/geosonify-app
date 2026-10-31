// node geosonify-cds-mirrors_selftest.js -- SIMBAD/Sesame and DSS2 imagery mirror fallback
'use strict';
var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}
var plan = {}, calls = [];
function hostOf(url) { var m = /^https:\/\/[^/]+(\/simbad)?/.exec(url); return m ? m[0] : url; }
global.fetch = function (url, o) {
  calls.push(url);
  var key = Object.keys(plan).filter(function (k) { return url.indexOf(k) === 0; })
                .sort(function (a, b) { return b.length - a.length; })[0];
  var b = key ? plan[key] : 'err';
  if (b === 'hang') return new Promise(function (res, rej) {
    if (o && o.signal) o.signal.addEventListener('abort', function () {
      var e = new Error('aborted'); e.name = 'AbortError'; rej(e); });
  });
  if (b === 'err') return Promise.reject(new TypeError('Failed to fetch'));
  return Promise.resolve({ ok: true, status: 200,
    text: function () { return Promise.resolve(typeof b === 'string' ? b : JSON.stringify(b)); },
    json: function () { return typeof b === 'string' ? Promise.reject(new Error('not json')) : Promise.resolve(b); } });
};
global.GeosonifySkyStars = require('./geosonify-sky-stars.js');
var L = require('./geosonify-sky-lookup.js');
var A = require('./geosonify-sky-aladin.js');
var TAPJSON = { metadata: [{ name: 'main_id' }], data: [['* alf Lyr']] };
var CDS = 'https://simbad.cds.unistra.fr/simbad', CFA = 'https://simbad.cfa.harvard.edu/simbad',
    IDIA = 'https://simbad.idia.ac.za/simbad', IDIA0 = 'https://simbad.idia.ac.za';

function tapCase(name, setup, check) {
  return function () {
    plan = setup; calls = [];
    return L._test.tap('SELECT 1').then(function (rows) { ok(name, check(rows, null), calls.map(hostOf).join(' ')); },
                                        function (e) { ok(name, check(null, e), (e && e.message) + ' ' + calls.map(hostOf).join(' ')); });
  };
}
var DSS = A.SURVEY_MIRRORS['P/DSS2/color'];
var PROPS = 'hips_service_url = x\nhips_order = 9\n';
var steps = [
  function () { console.log('\nSIMBAD TAP'); },
  tapCase('Strasbourg answers', { [CDS]: TAPJSON }, function (r) { return r && r[0].main_id === '* alf Lyr' && calls.length === 1; }),
  tapCase('Strasbourg down: Harvard answers', { [CDS]: 'err', [CFA]: TAPJSON }, function (r) { return r && calls.length === 2; }),
  tapCase('...and Harvard goes first next time', { [CDS]: 'err', [CFA]: TAPJSON }, function (r) { return r && hostOf(calls[0]) === CFA && calls.length === 1; }),
  tapCase('an HTML page from a mirror is not an answer', { [CDS]: 'err', [CFA]: '<html>mirror home</html>', [IDIA]: TAPJSON },
          function (r) { return r && hostOf(calls[calls.length - 1]) === IDIA; }),
  tapCase('IDIA at its root is tried too', { [CDS]: 'err', [CFA]: 'err', [IDIA]: 'err', [IDIA0]: TAPJSON },
          function (r) { return !!r; }),
  tapCase('all down: rejects, so the panel says it could not reach SIMBAD', { [CDS]: 'err', [CFA]: 'err', [IDIA]: 'err', [IDIA0]: 'err' },
          function (r, e) { return !r && !!e; }),
  function () {
    plan = { [CDS]: 'hang' }; calls = [];
    var ctl = new AbortController(), t0 = Date.now();
    var p = L._test.viaMirrors('simbad', L.SIMBAD_BASES, '/sim-tap/sync', function (r) { return r.json(); }, ctl.signal);
    setTimeout(function () { ctl.abort(); }, 200);
    return p.then(function () { ok('a caller abort stops the run', false); },
      function (e) { ok('a caller abort stops the run, without trying the rest', e.name === 'AbortError' && calls.length < L.SIMBAD_BASES.length && Date.now() - t0 < 2000, calls.length); });
  },
  function () {
    console.log('\nbuilt-in names');
    var N = L._test.localName;
    function near(h, ra, dec) { return h && Math.abs(h.ra - ra) < 0.1 && Math.abs(h.dec - dec) < 0.1; }
    ok('Vega is found offline', near(N('Vega'), 279.2346, 38.7837));
    ok('M31, "m 31", "Messier 31" and "NGC 224" are all Andromeda',
       ['M31', 'm 31', 'Messier 31', 'NGC 224'].every(function (q) { return near(N(q), 10.68, 41.27); }));
    ok('"Andromeda Galaxy" finds it by its common name', near(N('Andromeda Galaxy'), 10.68, 41.27));
    ok('"Orion Nebula" is M42', near(N('Orion Nebula'), 83.85, -5.45));
    ok('"the Pleiades" is M45', near(N('the Pleiades'), 56.75, 24.12));
    ok('M13 is at RA 250.4, not -109.6', near(N('M13'), 250.42, 36.47));
    ok('all 110 Messier objects are in the table', L._test.MESSIER.length === 110 &&
       L._test.MESSIER.every(function (m, i) { return m[0] === i + 1 && m[1] >= 0 && m[1] < 360; }));
    ok('an unknown name is left for Sesame', N('HD 172167') === null);
  },
  function () { console.log('\nDSS2 imagery'); },
  function () {
    plan = { [DSS[0]]: PROPS };
    return A.resolveSurvey('P/DSS2/color').then(function (u) { ok('Strasbourg answers: the survey id is used as before', u === 'P/DSS2/color', u); });
  },
  function () {
    // a fresh copy of the module, so the cache from the case above is gone
    delete require.cache[require.resolve('./geosonify-sky-aladin.js')];
    A = require('./geosonify-sky-aladin.js');
    plan = { [DSS[0]]: 'err', [DSS[1]]: '<html>not a HiPS</html>', [DSS[2]]: PROPS };
    return A.resolveSurvey('P/DSS2/color').then(function (u) {
      ok('Strasbourg down, CASDA wrong shape: the IRSA mirror URL is used', u === DSS[2], u);
      ok('...and surveyFor() remembers it for a survey switch', A.surveyFor('P/DSS2/color') === DSS[2]);
    });
  },
  function () {
    delete require.cache[require.resolve('./geosonify-sky-aladin.js')];
    A = require('./geosonify-sky-aladin.js');
    plan = {};
    return A.resolveSurvey('P/DSS2/color').then(function (u) { ok('nothing answers: falls back to the id (Aladin fails as before)', u === 'P/DSS2/color'); });
  },
  function () {
    return A.resolveSurvey('P/PanSTARRS/DR1/color-z-zg-g').then(function (u) { ok('a survey with no mirrors listed is passed through untouched', u === 'P/PanSTARRS/DR1/color-z-zg-g'); });
  },
  function () { ok('the library fallback is pinned, not "latest"', A.LIB_FALLBACKS.every(function (u) { return /@\d+\.\d+\.\d+/.test(u) && !/latest/.test(u); })); }
];
steps.reduce(function (p, f) { return p.then(f); }, Promise.resolve()).then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
