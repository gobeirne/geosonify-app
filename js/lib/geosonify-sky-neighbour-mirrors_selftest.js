// node geosonify-sky-neighbour-mirrors_selftest.js -- catalogue sources: VizieR, its mirrors, GAVO
'use strict';
var store = {};
global.localStorage = { getItem: function (k) { return store[k] || null; }, setItem: function (k, v) { store[k] = v; } };
var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')); }
}
var TSV = '#INFO\nRA_ICRS\tDE_ICRS\tSource\tPlx\tGmag\t_r\n--\t--\t--\t--\t--\t--\n' +
          '172.637\t-43.534\t5000000000000000001\t8.2\t9.2\t0.1\n';
var CSV = 'source_id,ra,dec,parallax,phot_g_mean_mag,sep\n5000000000000000001,172.637,-43.534,8.2,9.2,0.001\n';
var plan = {}, calls = [];
var P = 'https://vizier.cds.unistra.fr', C = 'https://vizier.cfa.harvard.edu',
    I = 'https://vizier.idia.ac.za', G = 'https://dc.g-vo.org/tap';
function hostOf(u) { return u.indexOf(G) === 0 ? G : u.split('/viz-bin')[0]; }
function short(h) { return { [P]: 'cds', [C]: 'cfa', [I]: 'idia', [G]: 'gavo' }[h]; }
global.fetch = function (url, o) {
  var h = hostOf(url); calls.push(h); var b = plan[h];
  if (b === 'hang' || (typeof b === 'number')) return new Promise(function (res, rej) {
    if (typeof b === 'number') setTimeout(function () { res({ ok: true, text: function () { return Promise.resolve(h === G ? CSV : TSV); } }); }, b);
    if (o && o.signal) o.signal.addEventListener('abort', function () { rej(new Error('abort')); });
  });
  if (!b || b === 'err') return Promise.reject(new TypeError('Failed to fetch'));
  return Promise.resolve({ ok: true, text: function () { return Promise.resolve(b); } });
};
var SN = require('./geosonify-sky-neighbour.js');
function look() { return SN.lookupRemote(-43.53, 172.63, { radiusArcmin: 1 }); }
function fresh() { store = {}; delete require.cache[require.resolve('./geosonify-sky-neighbour.js')]; SN = require('./geosonify-sky-neighbour.js'); }
function c(name, setup, check, before) {
  return function () {
    if (before) before();
    plan = setup; calls = []; var t0 = Date.now();
    return look().then(function (r) {
      var s = (Date.now() - t0) / 1000;
      ok(name, check(r, s), calls.map(short).join(',') + ' ' + s.toFixed(1) + ' s');
    });
  };
}
var one = function (r) { return r && r.length === 1 && r[0].star.name === 'Gaia DR3 5000000000000000001' && Math.abs(r[0].star.mag - 9.2) < 1e-9; };
var steps = [
  c('Strasbourg answers: one star, read as before', { [P]: TSV }, one, fresh),
  c('Strasbourg down, GAVO answers in the same wave: same star, same name', { [P]: 'err', [G]: CSV },
    function (r) { return one(r) && r[0].distLy > 390 && r[0].distLy < 400; }, fresh),
  c('...and next time GAVO is asked first, alone', { [P]: TSV, [G]: CSV },
    function (r) { return one(r) && calls[0] === G && calls.length === 1; }),
  c('Strasbourg and GAVO together: the faster one wins without waiting for the other',
    { [P]: 'hang', [G]: 300 }, function (r, s) { return one(r) && s < 1; }, fresh),
  c('Strasbourg and GAVO both down: Harvard, then IDIA', { [P]: 'err', [G]: 'err', [C]: 'err', [I]: TSV },
    function (r) { return one(r) && calls.slice(-2).join() === [C, I].join(); }, fresh),
  c('a mirror without the catalogue is not believed', { [P]: 'err', [G]: 'err', [C]: '#INFO no table\n', [I]: TSV },
    function (r) { return one(r); }, fresh),
  c('GAVO answering with an error page is not believed', { [P]: 'err', [G]: '<html>oops</html>', [C]: TSV },
    function (r) { return one(r); }, fresh),
  c('everything down: null (could not look), not []', { [P]: 'err', [G]: 'err', [C]: 'err', [I]: 'err' },
    function (r) { return r === null; }, fresh),
  c('Strasbourg answering an empty cone is believed ([])', { [P]: '#\n#   VizieR Astronomical Server\n#INFO nothing\n', [G]: 'hang' },
    function (r) { return Array.isArray(r) && r.length === 0; }, fresh),
  c('...but a Strasbourg outage page is not, so GAVO\'s stars still win', { [P]: '<html><body>Service unavailable</body></html>', [G]: 200 },
    function (r) { return one(r); }, fresh),
  function () {
    var t = SN._gavoToTsv(CSV).split('\n')[0].split('\t');
    ok('GAVO columns are renamed to VizieR\'s', t.join() === 'Source,RA_ICRS,DE_ICRS,Plx,Gmag,sep');
  }
];
steps.reduce(function (p, f) { return p.then(f); }, Promise.resolve()).then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
