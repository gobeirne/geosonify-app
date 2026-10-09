// Scratch check: Sky chip + frame follower. Not for the repo.
const { JSDOM } = require('jsdom');
const fs = require('fs');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };

function mkAppState() {
  let state = { frame: null, coordinate: { lat: -43.5, lon: 172.6 } }; const subs = {};
  return { get: k => JSON.parse(JSON.stringify(state[k])), set: (k, v) => { if (JSON.stringify(state[k]) === JSON.stringify(v)) return false; state[k] = v; (subs[k] || []).forEach(f => f(v)); return true; },
           subscribe: (k, f) => { (subs[k] = subs[k] || []).push(f); return () => {}; } };
}

// ---- faq-ui with a stub sky view ----
{
  const dom = new JSDOM('<div id="faq-root"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.AppState = mkAppState();
  w.GEOSONIFY_FAQ = { sections: [], examples: [], credits: { lines: [] } };
  let open = false;
  w.GeosonifySkyView = { isAvailable: () => true, isOpen: () => open,
    open: () => { open = true; w.AppState.set('frame', { sphere: 'sky' }); return true; },
    close: () => { open = false; w.AppState.set('frame', { sphere: 'earth' }); } };
  let applied = null;
  w.MapManager = { setBasemap: s => { applied = s; return { ok: true }; } };
  w.eval(fs.readFileSync('/home/claude/work/faq-ui.js', 'utf8'));
  w.GeosonifyFAQ.init('faq-root');
  const active = () => [...w.document.querySelectorAll('#basemapPresets .basemap-chip.active')].map(c => c.dataset.basemap).join();
  const chip = k => w.document.querySelector(`[data-basemap="${k}"]`);
  ok(active() === 'osm', 'starts on Standard: ' + active());
  ok(!w.document.getElementById('skyRevealLink') && !w.document.getElementById('skyModeCard'), 'old reveal link and Sky card gone');
  chip('aerial').click(); ok(active() === 'aerial' && applied === 'aerial', 'Aerial');
  chip('sky').click(); ok(active() === 'sky' && open, 'Sky opens view: ' + active());
  ok(applied === 'aerial', 'Sky does not touch the Earth basemap');
  w.GeosonifySkyView.close();   // e.g. the view's own close button
  ok(active() === 'aerial', 'closing elsewhere restores the Earth chip: ' + active());
  chip('sky').click(); chip('topo').click();
  ok(!open && active() === 'topo' && applied === 'topo', 'Earth chip leaves the sky');
}

// ---- sky view follows the frame ----
{
  const dom = new JSDOM('<div id="wrap"><div id="mapContainerMobile"></div></div>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://geosonify.org/' });
  const w = dom.window;
  w.AppState = mkAppState();
  const fakeRenderer = () => ({ init(){}, on(){}, getCenter: () => [0, 0], getFovDeg: () => 1, setCenter(){}, setFovDeg(){},
    getSize: () => ({ width: 100, height: 100 }), overlayGroup: () => w.document.createElementNS('http://www.w3.org/2000/svg', 'g'),
    project: () => null, attribution: () => null, capabilities: () => ({}), destroy(){} });
  w.GeosonifySkyRenderer = { createBuiltInRenderer: fakeRenderer };
  w.GeosonifySkyOverlay = { pickVisible: () => ({ draw: [], deepest: null }), legibility: () => '', projectRing: () => ({}), ringToPath: () => '' };
  w.GeosonifySky = { ipixToCell: () => ({ quaternary: 'f0.0' }), toMoc: () => ({ moc: '1/0', standard: true }), ancestry: () => [],
    autoDecimals: () => ({ ra: 1, dec: 1 }), cellSize: () => ({ text: '1"' }), formatRA: () => 'RA', formatDec: () => 'Dec', overclaims: () => null };
  w.HealpixGrids = { nestIndex: () => 0 };
  const st = { order: ['a'], visible: ['a'] }; let rendered = 0;
  w.CardRenderer = { getCardState: () => st, getGridDefinitions: () => ({ sexagesimal: {} }), saveCardState(){}, render(){ rendered++; } };
  w.eval(fs.readFileSync('/home/claude/work/geosonify-sky-view.js', 'utf8'));
  ok(!w.GeosonifySkyView.isOpen(), 'closed at start');
  w.AppState.set('frame', { key: 'icrs', sphere: 'sky', epoch: 'J2000', explicit: true });   // as the URL parser does
  ok(!w.GeosonifySkyView.isOpen(), 'deferred a tick');
  setTimeout(() => {
    ok(w.GeosonifySkyView.isOpen(), 'a sky frame opens the view');
    ok(st.visible.includes('sexagesimal') && rendered === 1, 'RA / Dec card surfaced once');
    w.GeosonifySkyView.close();
    ok(!w.GeosonifySkyView.isOpen() && w.AppState.get('frame').sphere === 'earth', 'close returns to Earth');
    st.visible = ['a']; w.GeosonifySkyView.open();
    ok(!st.visible.includes('sexagesimal'), 'card not re-added after the user hides it');
    console.log(fails ? fails + ' FAILURE(S)' : 'ALL PASS');
  }, 20);
}
