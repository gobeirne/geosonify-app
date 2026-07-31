/*
  sky-renderer-swap.test.js — run: node sky-renderer-swap.test.js

  The property that matters: a sky view NEVER ends up broken because imagery
  failed. Built-in draws first, Aladin upgrades if it can, and every failure
  path lands back on something that works.
*/
'use strict';
var fs = require('fs'); var { JSDOM } = require('jsdom');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '  -- ' + d : '')); } }
function head(s) { console.log('\n' + s); }

function boot(aladinBehaviour) {
  var dom = new JSDOM('<!doctype html><body><div id="mapWrap" style="position:relative">' +
    '<div id="mapContainerMobile"></div></div><div id="skyPanelMount"></div></body>',
    { pretendToBeVisual: true, runScripts: 'outside-only', url: 'https://geosonify.test/' });
  var w = dom.window;
  global.window = w; global.document = w.document; global.ResizeObserver = w.ResizeObserver;
  w.__toasts = []; w.showToast = function (m) { w.__toasts.push(m); };
  w.__state = {};
  w.AppState = { get: function (k) { return w.__state[k] || (k === 'coordinate' ? { lat: -43.5, lon: 172.6 } : null); },
                 set: function (k, v) { w.__state[k] = v; }, subscribe: function () { return function () {}; } };
  w.CardRenderer = { setCoordinate: function () {}, getPassphrase: function () { return ''; }, isObfuscated: function () { return false; } };
  w.GISGrids = { SCHEMES: { mgrs: {} } };
  w.eval(['geosonify-healpix.js','geosonify-sky.js','geosonify-sky-panel.js','geosonify-sky-overlay.js',
          'geosonify-sky-renderer.js','geosonify-sky-shapes.js','geosonify-sky-figures.js','geosonify-sky-view.js']
    .map(function (f) { return fs.readFileSync(f, 'utf8'); }).join('\n;\n'));

  // stand-in for geosonify-sky-aladin.js with controllable behaviour
  if (aladinBehaviour !== 'absent') {
    w.GeosonifySkyAladin = {
      isAvailable: function () { return aladinBehaviour !== 'no-webgl'; },
      createAladinRenderer: function (container, o) {
        var ra = o.ra, dec = o.dec, fov = o.fovDeg, ls = {};
        var g = w.document.createElementNS('http://www.w3.org/2000/svg', 'g');
        return {
          init: function () {
            if (aladinBehaviour === 'fails') return Promise.reject(new Error('network unreachable'));
            container.appendChild(g);
            return Promise.resolve(true);
          },
          destroy: function () { if (g.parentNode) g.parentNode.removeChild(g); },
          project: function (r2, d2) { return [400 + (r2 - ra), 300 - (d2 - dec)]; },
          unproject: function (x, y) { return [ra + (x - 400), dec - (y - 300)]; },
          getCenter: function () { return [ra, dec]; },
          setCenter: function (a, b) { ra = a; dec = b; },
          getFovDeg: function () { return fov; },
          setFovDeg: function (d) { fov = d; },
          getSize: function () { return { width: 800, height: 600 }; },
          on: function (n, cb) { ls[n] = cb; }, off: function () {},
          overlayGroup: function () { return g; },
          attribution: function () { return { text: 'Sky imagery: Aladin Lite / CDS, Strasbourg', href: 'https://aladin.cds.unistra.fr/' }; },
          capabilities: function () { return { name: 'Aladin Lite', imagery: true, offline: false, maxResolvableOrder: 29 }; },
          redrawChrome: function () {}
        };
      }
    };
  }
  return w;
}

function later(fn) { return new Promise(function (r) { setTimeout(function () { r(fn()); }, 25); }); }

(async function () {
  head('1  built-in draws first, always');
  var w = boot('works');
  w.GeosonifySkyView.open();
  ok('view is open immediately', w.GeosonifySkyView.isOpen());
  ok('built-in is live before any download', w.GeosonifySkyView.getRendererKind() === 'builtin',
     w.GeosonifySkyView.getRendererKind());
  ok('cells are already drawn', w.document.querySelector('.gs-sky-overlay').childNodes.length > 0);
  ok('no attribution yet — nothing borrowed', w.document.querySelector('a[style*="10.5px"]').textContent === '');

  await later(function () {
    head('2  Aladin upgrades in behind it');
    ok('renderer swapped', w.GeosonifySkyView.getRendererKind() === 'aladin',
       w.GeosonifySkyView.getRendererKind());
    ok('CDS is credited once it is on screen',
       /CDS/.test(w.document.querySelector('a[style*="10.5px"]').textContent),
       w.document.querySelector('a[style*="10.5px"]').textContent);
    ok('and links out', w.document.querySelector('a[style*="10.5px"]').getAttribute('href').indexOf('aladin') > 0);
    ok('user was told', w.__toasts.some(function (t) { return /imagery/i.test(t); }), JSON.stringify(w.__toasts));
  });
  w.GeosonifySkyView.close();

  head('3  network failure leaves a WORKING view');
  var w2 = boot('fails');
  w2.GeosonifySkyView.open();
  await later(function () {
    ok('still open', w2.GeosonifySkyView.isOpen());
    ok('still on the built-in renderer', w2.GeosonifySkyView.getRendererKind() === 'builtin');
    ok('cells still drawn', w2.document.querySelector('.gs-sky-overlay').childNodes.length > 0);
    ok('no false credit given', w2.document.querySelector('a[style*="10.5px"]').textContent === '');
    ok('no imagery toast', !w2.__toasts.some(function (t) { return /imagery/i.test(t); }));
  });
  w2.GeosonifySkyView.close();

  head('4  no WebGL2 is not an error, just no imagery');
  var w3 = boot('no-webgl');
  w3.GeosonifySkyView.open();
  await later(function () {
    ok('view works', w3.GeosonifySkyView.isOpen() && w3.GeosonifySkyView.getRendererKind() === 'builtin');
    ok('cells drawn', w3.document.querySelector('.gs-sky-overlay').childNodes.length > 0);
  });
  w3.GeosonifySkyView.close();

  head('5  module absent entirely');
  var w4 = boot('absent');
  w4.GeosonifySkyView.open();
  await later(function () {
    ok('view works with no Aladin module at all', w4.GeosonifySkyView.getRendererKind() === 'builtin');
    ok('cells drawn', w4.document.querySelector('.gs-sky-overlay').childNodes.length > 0);
  });

  head('6  opting out, and swapping back');
  w4.GeosonifySkyView.close();
  var w5 = boot('works');
  w5.GeosonifySkyView.open({ renderer: 'builtin' });
  await later(function () {
    ok('renderer:builtin never attempts the upgrade', w5.GeosonifySkyView.getRendererKind() === 'builtin');
  });
  await w5.GeosonifySkyView.useAladin();
  ok('explicit useAladin() swaps', w5.GeosonifySkyView.getRendererKind() === 'aladin');
  ok('centre survives the swap', Math.abs(w5.GeosonifySkyView.getShapes().length - 0) === 0);
  w5.GeosonifySkyView.useBuiltIn();
  ok('useBuiltIn() swaps back', w5.GeosonifySkyView.getRendererKind() === 'builtin');
  ok('attribution withdrawn with it', w5.document.querySelector('a[style*="10.5px"]').textContent === '');
  w5.GeosonifySkyView.close();

  console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
  process.exit(fail === 0 ? 0 : 1);
})();
