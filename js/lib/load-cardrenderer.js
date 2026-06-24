// Loads the real card-renderer.js (a browser IIFE) inside a minimal Node shim so
// the precision math (getPrecisionText / resolutionToIterations / formatLength)
// can be exercised by gates. We stub just enough DOM/global surface; the grid
// arrays come from the real grid-data if present, else small synthetic stand-ins.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadCardRenderer(opts = {}) {
  const dir = __dirname;
  const sandbox = {};
  sandbox.global = sandbox;
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.console = console;
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.module = { exports: {} };
  sandbox.localStorage = (() => {
    let s = {};
    return { getItem: k => (k in s ? s[k] : null), setItem: (k,v)=>{s[k]=String(v);}, removeItem:k=>{delete s[k];} };
  })();
  // Minimal document: querySelector(All) return inert stubs; createElement returns
  // an object with the props the render path pokes. The gates don't render DOM —
  // they call pure functions — but module top-level may reference document.
  const inert = new Proxy({}, { get: (t,p) => {
    if (p === 'style') return {};
    if (p === 'classList') return { add(){},remove(){},toggle(){},contains(){return false;} };
    if (p === 'querySelector' || p === 'closest') return () => null;
    if (p === 'querySelectorAll' || p === 'getElementsByClassName') return () => [];
    if (p === 'addEventListener' || p === 'removeEventListener' || p === 'appendChild'
        || p === 'append' || p === 'remove' || p === 'setAttribute' || p === 'insertBefore') return () => {};
    if (p === 'children' || p === 'childNodes') return [];
    return undefined;
  }});
  sandbox.document = {
    readyState: 'complete',
    createElement: () => Object.create(inert),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: Object.create(inert),
    head: Object.create(inert)
  };
  sandbox.navigator = { language: 'en', languages: ['en'] };
  sandbox.location = { search: '', href: '', hash: '' };

  const ctx = vm.createContext(sandbox);

  // Load dependency modules + card-renderer as ONE concatenated script. Separate
  // vm.runInContext calls don't share top-level const/let bindings (unlike browser
  // <script> tags), and HealpixGrids/GISGrids publish via bare `const X = (...)()`.
  // Concatenating replicates the browser's shared-global-scope behaviour.
  const deps = [
    'decimal_min.js',
    'app-state.js',
    'geosonify-grids-data.js',
    'geosonify-precision.js',
    'geosonify-healpix.js',
    'gis-grids.js',
    'geosonify-chessboard-lib_v1_0.js'
  ];
  const preamble = '';   // real grid arrays come from geosonify-grids-data.js

  let bundle = preamble;
  for (const f of deps) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) bundle += '\n;' + fs.readFileSync(p, 'utf8') + '\n';
    else if (opts.verbose) console.warn('dep missing', f);
  }
  bundle += '\n;' + fs.readFileSync(path.join(dir, 'card-renderer.js'), 'utf8') + '\n';
  // Re-publish the bare-const modules onto the sandbox global so the harness can
  // reach them after the bundle runs.
  bundle += '\n; if (typeof HealpixGrids !== "undefined") this.HealpixGrids = HealpixGrids;'
          + '\n; if (typeof GISGrids !== "undefined") this.GISGrids = GISGrids;'
          + '\n; if (typeof AppState !== "undefined") this.AppState = AppState;'
          + '\n; if (typeof CARD_GRIDS !== "undefined") this.CARD_GRIDS = CARD_GRIDS;';
  // Publish grid-data arrays onto global so refreshGridReferences()'s window[name]
  // late-binding finds them (top-level consts aren't auto-attached to the global).
  const arrayNames = ['alphanumericArray','emojiArray','emojiNamesArray','musicalArray','hexByteArray',
    'base64Array','NATOArray','byteWordsArray','byteWordsMinimalArray','byteEmojiArray',
    'BIP39EnglishArray','BIP39SpanishArray','BIP39FrenchArray','BIP39ItalianArray','BIP39PortugueseArray',
    'BIP39CzechArray','BIP39JapaneseArray','BIP39KoreanArray','BIP39ChineseSimplifiedArray',
    'BIP39ChineseTraditionalArray','DE2048GermanArray'];
  for (const n of arrayNames) bundle += '\n; if (typeof ' + n + ' !== "undefined") this.' + n + ' = ' + n + ';';

  vm.runInContext(bundle, ctx, { filename: 'bundle.js' });

  return { ctx, CardRenderer: ctx.CardRenderer };
}

module.exports = { loadCardRenderer };
