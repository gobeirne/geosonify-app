/*
  geosonify-sky-url.selftest.js — run: node geosonify-sky-url.selftest.js

  Gates the four non-negotiable rules, plus the collision guard.
*/
'use strict';
var U = require('./geosonify-sky-url.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }
function throws(fn) { try { fn(); return false; } catch (e) { return true; } }

head('rule 1: absent frame always means earth');
ok('empty params -> earth', U.parse({}).frame === 'earth');
ok('unrelated params -> earth', U.parse({ hphex: 'ABC', a: '1' }).frame === 'earth');
ok('null params -> earth', U.parse(null).frame === 'earth');
ok('flagged as not explicit', U.parse({}).explicit === false);
ok('sphere is earth', U.parse({}).sphere === 'earth');

head('rule 2: never emit frame=earth');
ok('earth serialises to nothing', Object.keys(U.serialize('earth')).length === 0);
ok('default serialises to nothing', Object.keys(U.serialize()).length === 0);
ok('earth query string is empty', U.toQueryString(U.serialize('earth')) === '');
ok('icrs does emit', U.serialize('icrs').frame === 'icrs');

head('rule 3: unknown frame is an error, never a silent default');
ok('rejects "mars"', throws(function () { U.parse({ frame: 'mars' }); }));
ok('rejects "j2000"', throws(function () { U.parse({ frame: 'j2000' }); }));
ok('rejects typo "icsr"', throws(function () { U.parse({ frame: 'icsr' }); }));
ok('error names the valid options', (function () {
  try { U.parse({ frame: 'mars' }); } catch (e) { return e.message.indexOf('icrs') > 0; }
})());
ok('accepts case and whitespace', U.parse({ frame: '  ICRS ' }).frame === 'icrs');

head('rule 4: additive only, no collision with the existing grammar');
ok('frame is a safe param name', U.checkParamName('frame').safe);
ok('epoch is a safe param name', U.checkParamName('epoch').safe);
ok('hpquadset is NOT safe', !U.checkParamName('hpquadset').safe);
ok('hphexo is NOT safe (matches the flag grammar)', !U.checkParamName('hphexo').safe);
ok('hp64x is NOT safe', !U.checkParamName('hp64x').safe);
ok('the reason explains the silent failure', U.checkParamName('hpquadset').reason.indexOf('silently') > 0,
   U.checkParamName('hpquadset').reason);

head('epoch');
ok('J2000 parses', U.parseEpoch('J2000').year === 2000 && U.parseEpoch('J2000').system === 'Julian');
ok('J2016.0 parses', U.parseEpoch('J2016.0').year === 2016);
ok('B1950 is Besselian', U.parseEpoch('B1950').system === 'Besselian');
ok('bare year means Julian', U.parseEpoch('2000').raw === 'J2000');
ok('rejects nonsense', throws(function () { U.parseEpoch('yesterday'); }));
ok('rejects year 99', throws(function () { U.parseEpoch('J0099'); }));
ok('icrs assumes J2000', (function () { var p = U.parse({ frame: 'icrs' }); return p.epoch.raw === 'J2000' && p.epoch.assumed; })());
ok('explicit epoch is not marked assumed', !U.parse({ frame: 'icrs', epoch: 'J2016.0' }).epoch.assumed);
ok('epoch ignored on earth, with a warning', (function () {
  var p = U.parse({ epoch: 'J2000' });
  return p.epoch === null && p.warnings.length === 1;
})());
ok('equator-of-date warns when epoch missing', U.parse({ frame: 'date' }).warnings.length === 1);

head('requiresEpoch draws the direction/object line');
ok('fixed direction in icrs does not need one', !U.requiresEpoch('icrs'));
ok('an OBJECT in icrs does', U.requiresEpoch('icrs', { forObject: true }));
ok('equator of date always does', U.requiresEpoch('date'));
ok('earth never does', !U.requiresEpoch('earth', { forObject: true }));
ok('serialise throws for an object with no epoch',
   throws(function () { U.serialize('icrs', null, { forObject: true }); }));
ok('and succeeds with one', U.serialize('icrs', 'J2016.0', { forObject: true }).epoch === 'J2016.0');

head('round trip and description');
['icrs', 'galactic', 'ecliptic'].forEach(function (f) {
  var q = U.serialize(f, 'J2000');
  ok(f + ' round-trips', U.parse(q).frame === f, JSON.stringify(q));
});
ok('URLSearchParams works as input', (function () {
  var p = new URLSearchParams('frame=galactic&epoch=J2000&hphex=ABC');
  return U.parse(p).frame === 'galactic';
})());
console.log('  earth    : ' + U.describe(U.parse({})));
console.log('  icrs     : ' + U.describe(U.parse({ frame: 'icrs' })));
console.log('  galactic : ' + U.describe(U.parse({ frame: 'galactic' })));
console.log('  of date  : ' + U.describe(U.parse({ frame: 'date', epoch: 'J2026.5' })));
ok('sky frames name their axes', U.describe(U.parse({ frame: 'icrs' })).indexOf('right ascension') > 0);
ok('earth says nothing about epochs', U.describe(U.parse({})) === 'Earth coordinates');

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
