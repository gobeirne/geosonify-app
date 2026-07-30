/*
  sky-url-integration.test.js — run: node sky-url-integration.test.js

  Extracts the frame/epoch block from the PATCHED index.html and runs it against
  mocked showToast / AppState / urlParams. Tests what is actually in the file,
  not a re-typed copy of it, so the test cannot drift from the shipped code.
*/
'use strict';
var fs = require('fs');
var U = require('./geosonify-sky-url.js');
global.GeosonifySkyUrl = U;

var html = fs.readFileSync('index.html', 'utf8');
var start = html.indexOf('      // ── Sky frame (?frame=, ?epoch=) ');
var end = html.indexOf('      // Check for ?enc= (encrypted URL)');
if (start < 0 || end < 0) { console.log('FAIL: could not locate the block in index.html'); process.exit(1); }
var block = html.slice(start, end);
console.log('extracted ' + block.split('\n').length + ' lines from index.html\n');

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }

// Run the extracted block as the body of parseURLParameters, with the same
// surroundings it has in the app.
function run(query) {
  var toasts = [], stored = null, aborted = true;
  var showToast = function (m, s) { toasts.push({ msg: m, style: s }); };
  var setTimeout_ = function (fn) { fn(); };
  var AppState = { set: function (k, v) { stored = { key: k, value: v }; } };
  var urlParams = new URLSearchParams(query);
  var body = 'return (function(){ var setTimeout = arguments[0];' + block +
             ' aborted = false; return { urlFrame: urlFrame }; })(setTimeout_);';
  var fn = new Function('urlParams', 'showToast', 'setTimeout_', 'AppState', 'GeosonifySkyUrl',
    'var aborted = true;' + body.replace('aborted = false;', 'aborted = false;'));
  var result;
  try {
    result = fn(urlParams, showToast, setTimeout_, AppState, U);
    aborted = result === undefined;
  } catch (e) { return { threw: e.message }; }
  return { toasts: toasts, stored: stored, aborted: aborted, frame: result && result.urlFrame };
}

console.log('no frame param (every URL in the wild)');
var r = run('hphex=956250B00862');
ok('does not abort', !r.aborted);
ok('records earth', r.stored && r.stored.value.key === 'earth', JSON.stringify(r.stored));
ok('marked not explicit', r.stored.value.explicit === false);
ok('no toast', r.toasts.length === 0, JSON.stringify(r.toasts));

console.log('\nvalid sky frame');
r = run('frame=icrs&hphex=956250B00862');
ok('does not abort', !r.aborted);
ok('records icrs', r.stored.value.key === 'icrs');
ok('sphere is sky', r.stored.value.sphere === 'sky');
ok('epoch defaulted to J2000', r.stored.value.epoch === 'J2000');
ok('marked explicit', r.stored.value.explicit === true);

console.log('\nunknown frame must ABORT, not fall back to earth');
r = run('frame=mars&hphex=956250B00862');
ok('aborts the decode', r.aborted);
ok('error toast shown', r.toasts.length === 1 && r.toasts[0].style === 'error', JSON.stringify(r.toasts));
ok('message names the valid frames', r.toasts[0].msg.indexOf('icrs') > 0, r.toasts[0].msg);
ok('nothing stored', r.stored === null);

console.log('\nwarnings surface without aborting');
r = run('epoch=J2000&hphex=956250B00862');
ok('does not abort', !r.aborted);
ok('still earth', r.stored.value.key === 'earth');
ok('epoch dropped', r.stored.value.epoch === null);
ok('one warning toast, not an error', r.toasts.length === 1 && r.toasts[0].style === undefined,
   JSON.stringify(r.toasts));

console.log('\nmodule absent -> block is inert');
var saved = global.GeosonifySkyUrl;
delete global.GeosonifySkyUrl;
var fn2 = new Function('urlParams', 'showToast', 'setTimeout_', 'AppState',
  'var GeosonifySkyUrl = (typeof globalThis.GeosonifySkyUrl !== "undefined") ? globalThis.GeosonifySkyUrl : undefined;' +
  'var setTimeout = setTimeout_;' + block + ' return "reached-end";');
var out = fn2(new URLSearchParams('frame=icrs'), function () {}, function (f) { f(); }, { set: function () {} });
ok('no module means no crash and no abort', out === 'reached-end', String(out));
global.GeosonifySkyUrl = saved;

console.log('\ncollision guard on the two new names');
ok('frame is safe in the existing grammar', U.checkParamName('frame').safe);
ok('epoch is safe in the existing grammar', U.checkParamName('epoch').safe);

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
