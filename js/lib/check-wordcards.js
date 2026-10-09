// Scratch check: language mapping, one-time auto-add, sizes. Not for the repo.
const fs = require('fs');
const src = fs.readFileSync('/home/claude/work/card-renderer.js', 'utf8');
const grab = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
const code = grab('  const LANG_TO_HPWORDS', '  /*\n    `!def.sky`') ;
const mapSrc = grab('  const LANG_TO_HPWORDS', '  /**');
const addSrc = grab('  function autoAddWordCardsByLanguage', '  function loadCardState');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };

eval(mapSrc);
const cases = { 'en-NZ':'hpbip39english','es-ES':'hpbip39spanish','de-AT':'hpbip39german','pt_BR':'hpbip39portuguese',
  'zh':'hpbip39chinesesimplified','zh-CN':'hpbip39chinesesimplified','zh-Hans-HK':'hpbip39chinesesimplified',
  'zh-TW':'hpbip39chinesetraditional','zh-HK':'hpbip39chinesetraditional','zh-MO':'hpbip39chinesetraditional',
  'zh-Hant':'hpbip39chinesetraditional','zh-Hant-HK':'hpbip39chinesetraditional','ja-JP':'hpbip39japanese',
  'mi-NZ':null,'':null };
for (const [t, w] of Object.entries(cases)) ok(hpWordsKeyForLanguage(t) === w, `map ${t} → ${hpWordsKeyForLanguage(t)}`);

function run(langs, state, store) {
  Object.defineProperty(globalThis, 'navigator', { value: { languages: langs, language: langs[0] }, configurable: true, writable: true });
  global.localStorage = { getItem: k => store[k] || null, setItem: (k, v) => store[k] = v };
  const CARD_GRIDS = {}; ['english','spanish','german','japanese'].forEach(l => CARD_GRIDS['hpbip39' + l] = {});
  const cardState = state, saveCardState = () => {};
  eval(mapSrc + addSrc + '; autoAddWordCardsByLanguage();');
  return state;
}
const vis = s => s.order.filter(k => s.visible.includes(k));
// new user, Spanish phone
let s = run(['es-ES','en'], { order:['a','hpbip39english','hpbip39spanish','bip39english'], visible:['a','hpbip39english'] }, {});
ok(JSON.stringify(vis(s)) === '["a","hpbip39spanish","hpbip39english"]', 'new Spanish user: ' + vis(s));
// existing user with legacy English + legacy Spanish visible, hp keys appended at end
s = run(['es'], { order:['a','bip39english','bip39spanish','x','hpbip39english','hpbip39spanish'], visible:['a','bip39english','bip39spanish'] }, {});
ok(JSON.stringify(vis(s)) === '["a","hpbip39spanish","hpbip39english","bip39english","bip39spanish"]', 'existing user keeps legacy: ' + vis(s));
// English phone: single card
s = run(['en-GB'], { order:['a','hpbip39english'], visible:['a','hpbip39english'] }, {});
ok(JSON.stringify(vis(s)) === '["a","hpbip39english"]', 'English only');
// runs once: hidden card stays hidden
const store = {};
s = run(['de'], { order:['hpbip39english'], visible:['hpbip39english'] }, store);
s.visible = []; run(['de'], s, store);
ok(s.visible.length === 0, 'second run does nothing');
// unsupported language falls through to the next preference
s = run(['mi-NZ','ja'], { order:['hpbip39english'], visible:['hpbip39english'] }, {});
ok(JSON.stringify(vis(s)) === '["hpbip39japanese","hpbip39english"]', 'second preference used: ' + vis(s));

// sizes: arcsec and metres per word count
globalThis.HealpixGrids = require('/home/claude/work/geosonify-healpix.js');
const HW = require('/home/claude/work/geosonify-hpwords.js');
const want = [[1, 5.18 * 3600, 576.3e3], [2, 6.87 * 60, 12.7e3], [3, 9.11, 281.4], [4, 0.201, 6.22]];
for (const [n, as, m] of want) {
  ok(Math.abs(HW.cellArcsec(n) / as - 1) < 0.003, `${n} words arcsec ${HW.cellArcsec(n)}`);
  ok(Math.abs(HW.cellMetres(n).w / m - 1) < 0.003, `${n} words metres ${HW.cellMetres(n).w}`);
  console.log(n, 'words:', HW.cellArcsec(n).toPrecision(4), 'arcsec,', HW.cellMetres(n).w.toPrecision(4), 'm');
}
ok(HW.cardDefs().hpbip39english.name === 'HEALPix · words EN', 'card name');
console.log(fails ? fails + ' FAILURE(S)' : 'ALL PASS');
