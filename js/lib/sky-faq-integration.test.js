/*
  sky-faq-integration.test.js — run: node sky-faq-integration.test.js
  Needs jsdom. Exercises the real faq-ui.js against the real faq-data.js.

  Gates the whole secret-door flow:
    1  before reveal, the FAQ looks untouched — no Sky card anywhere
    2  the link is present but visually indistinguishable from prose
    3  clicking it enables sky mode and the Sky card appears in the right place
    4  the Earth/Sky switch opens and closes the sky view
    5  "Hide sky mode" puts everything back
    6  a reload with it already enabled shows the card straight away
*/
'use strict';
var fs = require('fs');
var { JSDOM } = require('jsdom');

var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }

function boot() {
  var dom = new JSDOM('<!doctype html><body><div id="faq-root"></div><div id="skyPanelMount"></div></body>',
                      { pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://geosonify.test/' });
  var w = dom.window;
  global.window = w; global.document = w.document; global.ResizeObserver = w.ResizeObserver;
  w.showToast = function (m, s) { w.__toasts.push({ m: m, s: s }); };
  w.__toasts = [];
  // AppState stub with a pin
  w.AppState = { get: function (k) { return k === 'coordinate' ? { lat: -43.5554, lon: 172.6509 } : null; },
                 set: function () {}, subscribe: function () { return function () {}; } };
  var files = ['geosonify-healpix.js','geosonify-sky.js','geosonify-sky-panel.js',
               'geosonify-sky-overlay.js','geosonify-sky-renderer.js','geosonify-sky-view.js',
               'faq-data.js','faq-ui.js'];
  w.eval(files.map(function (f) { return fs.readFileSync(f, 'utf8'); }).join('\n;\n'));
  return w;
}

var w = boot();
try { w.localStorage.removeItem('geosonify-sky-enabled'); } catch (e) {}
w.GeosonifyFAQ.init('faq-root');
var root = w.document.getElementById('faq-root');

head('1  before reveal the FAQ looks untouched');
ok('no Sky card', !w.document.getElementById('skyModeCard'));
ok('no Earth/Sky switch', !w.document.getElementById('skyModePresets'));
ok('Map imagery card still present', root.innerHTML.indexOf('Map imagery') > 0);
ok('Credits card still present', root.innerHTML.indexOf('Credits') > 0);

head('2  the link is there, and looks like prose');
var link = w.document.getElementById('skyRevealLink');
ok('link exists', !!link);
ok('link text is "skies"', link && link.textContent === 'skies', link && link.textContent);
ok('colour inherits', link.getAttribute('style').indexOf('color:inherit') >= 0);
ok('no underline', link.getAttribute('style').indexOf('text-decoration:none') >= 0);
ok('cursor does not give it away', link.getAttribute('style').indexOf('cursor:inherit') >= 0);
ok('sits inside the imagery note', link.closest('.card').textContent.indexOf('Aerial is satellite') > 0);
ok('reads as a sentence', link.parentNode.textContent.indexOf('look to the skies.') > 0);

head('3  clicking it reveals sky mode');
link.dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
ok('sky panel now enabled', w.GeosonifySkyPanel.isEnabled());
ok('Sky card appeared', !!w.document.getElementById('skyModeCard'));
ok('toast confirmed it', w.__toasts.some(function (t) { return /revealed/i.test(t.m); }),
   JSON.stringify(w.__toasts));
var cards = Array.prototype.map.call(root.querySelectorAll('.card-header'), function (h) { return h.textContent; });
var iImg = cards.indexOf('Map imagery'), iSky = cards.indexOf('Sky'), iCred = cards.findIndex(function (c) { return /Credits/.test(c); });
ok('sits between Map imagery and Credits', iImg >= 0 && iSky === iImg + 1 && iCred === iSky + 1,
   cards.slice(Math.max(0, iImg - 1)).join(' | '));

head('4  the Earth/Sky switch drives the view');
var presets = w.document.getElementById('skyModePresets');
ok('switch rendered', !!presets);
var skyBtn = presets.querySelector('[data-skymode="sky"]');
var earthBtn = presets.querySelector('[data-skymode="earth"]');
ok('Earth is active by default', earthBtn.classList.contains('active'));
ok('sky view module reports available', w.GeosonifySkyView.isAvailable());
skyBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
ok('sky view opened', w.GeosonifySkyView.isOpen());
ok('overlay mounted over everything', !!w.document.querySelector('.gs-sky-svg'));
ok('cells drawn into the overlay', w.document.querySelector('.gs-sky-overlay').childNodes.length > 0,
   String(w.document.querySelector('.gs-sky-overlay').childNodes.length) + ' nodes');
ok('Sky chip is now active', skyBtn.classList.contains('active'));
earthBtn.dispatchEvent(new w.Event('click', { bubbles: true }));
ok('switching back closes the view', !w.GeosonifySkyView.isOpen());
ok('overlay removed from the DOM', !w.document.querySelector('.gs-sky-svg'));

head('5  hide puts everything back');
w.document.getElementById('skyModePresets').querySelector('[data-skymode="sky"]')
  .dispatchEvent(new w.Event('click', { bubbles: true }));
ok('reopened for the test', w.GeosonifySkyView.isOpen());
w.document.getElementById('skyHideLink').dispatchEvent(new w.Event('click', { bubbles: true, cancelable: true }));
ok('view closed', !w.GeosonifySkyView.isOpen());
ok('panel disabled', !w.GeosonifySkyPanel.isEnabled());
ok('Sky card gone', !w.document.getElementById('skyModeCard'));
ok('reveal link still there for next time', !!w.document.getElementById('skyRevealLink'));

head('6  already-enabled reload shows the card immediately');
var w2 = boot();
try { w2.localStorage.setItem('geosonify-sky-enabled', '1'); } catch (e) {}
w2.GeosonifyFAQ.init('faq-root');
ok('Sky card present on first render', !!w2.document.getElementById('skyModeCard'));
ok('no toast needed', w2.__toasts.length === 0, JSON.stringify(w2.__toasts));

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
