// Scratch: does the turn land the streets on the stars, at suburb, city and
// continent scale, on both renderers; and does the way back restore the map?
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const H = require('./harness.js');
let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, '--', JSON.stringify(detail)); } }

async function page(b, opts) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => { if (!/fetch|HiPS|CDS ID/i.test(e.message)) errs.push(e.message); });
  await H.route(pg);
  await pg.goto('http://127.0.0.1:' + H.PORT + '/index.html');
  await pg.waitForFunction(() => window.__geosonifyMap && document.querySelector('.gs-skyflip-btn'));
  if (!opts.aladin) await pg.evaluate(() => { GeosonifySkyAladin.isAvailable = () => false; });
  await pg.evaluate(() => GeosonifySkyFlip._test.setTimings({ hold: 200, streetsOut: 300, imageryWait: 25000 }));
  pg._errs = errs;
  return pg;
}

// Worst disagreement, in px, between where the module draws a ground point in
// the sky and where the renderer puts the star with the same coordinates.
const SKYCHECK = `(spread) => {
  var F = GeosonifySkyFlip._test, r = GeosonifySkyView.getRenderer(), g = F.wrapGeom();
  var c = r.getCenter(), worst = 0, n = 0;
  for (var i = -3; i <= 3; i++) for (var j = -3; j <= 3; j++) {
    var lat = c[1] + i * spread, lon = c[0] + j * spread / Math.cos(c[1] * Math.PI / 180);
    var a = r.project(((lon % 360) + 360) % 360, lat);
    var b = F.project(lat, lon > 180 ? lon - 360 : lon, 'sky');
    if (!a || !b) continue;
    var x = a[0] + g.left, y = a[1] + g.top;
    if (x < g.left || x > g.left + g.w || y < g.top || y > g.top + g.h) continue;
    worst = Math.max(worst, Math.hypot(x - b[0], y - b[1])); n++;
  }
  return { worst: worst, n: n };
}`;
// Before the turn: how far does a ground point move from Mercator to the
// orthographic ground view (the morph), at the edges of the picture?
const MORPHCHECK = `() => {
  var F = GeosonifySkyFlip._test, m = __geosonifyMap, g = F.wrapGeom(), worst = 0;
  [[0,0],[1,0],[0,1],[1,1],[.5,.5]].forEach(function (u) {
    var ll = m.containerPointToLatLng([g.left + u[0] * g.w, g.top + u[1] * g.h]);
    var a = F.project(ll.lat, ll.lng, 'merc'), b = F.project(ll.lat, ll.lng, 'ortho');
    if (a && b) worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]));
  });
  return worst;
}`;

async function scenario(b, label, z, opts) {
  console.log('\n== ' + label + ' (zoom ' + z + (opts.aladin ? ', Aladin' : ', built-in') + (opts.reduced ? ', reduced motion' : '') + ')');
  const pg = await page(b, opts);
  await pg.evaluate((z) => __geosonifyMap.setView([-43.5309, 172.6365], z, { animate: false }), z);
  await pg.waitForTimeout(400);
  const before = await pg.evaluate(() => ({ z: __geosonifyMap.getZoom(), c: __geosonifyMap.getCenter() }));
  // Watch the mode during the run, and measure the morph and the alignment when they happen.
  await pg.evaluate((MORPH) => {
    window.__seen = {}; window.__morph = null;
    var mf = eval('(' + MORPH + ')');
    (function tick() {
      var m = GeosonifySkyFlip._test.mode();
      if (m) __seen[m] = 1;
      if (m === 'ortho' && __morph === null) { try { __morph = mf(); } catch (e) { __morph = 'err ' + e.message; } }
      if (GeosonifySkyFlip.isBusy() || !window.__doneUp) setTimeout(tick, 16);
    })();
    GeosonifySkyFlip.toSky().then(function () { window.__doneUp = true; });
  }, MORPHCHECK);
  await pg.waitForFunction(() => window.__doneUp, null, { timeout: 20000 });
  const seen = await pg.evaluate(() => Object.keys(__seen));
  const turned = seen.includes('sky');
  ok('went up ' + (opts.expectTurn ? 'with the turn' : 'with a crossfade'), turned === !!opts.expectTurn, seen);
  if (turned) {
    const mo = await pg.evaluate(() => __morph);
    console.log('     morph moves edge points by', typeof mo === 'number' ? mo.toFixed(2) + ' px' : mo);
  }
  await pg.waitForTimeout(400);
  ok('sky view open and visible', await pg.evaluate(() => GeosonifySkyView.isOpen() && getComputedStyle(GeosonifySkyView.getHost()).opacity === '1'));
  ok('frame is ICRS', await pg.evaluate(() => AppState.get('frame').key === 'icrs'));
  const F = await pg.evaluate(() => GeosonifySkyFlip._test.liveAffine());
  const asp = 206264.806 / Math.hypot(F.ax, F.ay);
  const aspMap = await pg.evaluate((d) => GeosonifyStarpinFlip.aspForZoom(__geosonifyMap.getZoom(), d), F.dec0);
  if (opts.aladin) {
    await pg.waitForFunction(() => GeosonifySkyView.getRendererKind() === 'aladin', null, { timeout: 25000 }).catch(() => {});
  }
  const kind = await pg.evaluate(() => GeosonifySkyView.getRendererKind());
  console.log('     renderer', kind, ' sky asp', asp.toPrecision(5), ' map asp', aspMap.toPrecision(5));
  const spread = asp * 15 / 3600;
  const al = await pg.evaluate(`(${SKYCHECK})(${spread})`);
  ok('streets sit on their stars (worst ' + al.worst.toFixed(3) + ' px over ' + al.n + ' points)', al.n > 10 && al.worst < 0.5, al);
  if (opts.aladin && kind === 'aladin') {
    // wait for the tail (pull-back) to finish
    await pg.waitForFunction(() => !document.querySelector('.gs-skyflip-streets'), null, { timeout: 30000 }).catch(() => {});
    const a2 = await pg.evaluate(() => GeosonifySkyFlip._test.affineAsp(GeosonifySkyFlip._test.liveAffine()));
    const fl = await pg.evaluate(() => GeosonifySkyFlip._test.FLOOR_ASP);
    if (asp < fl) ok('pulled back to 3x the survey pixel (' + a2.toPrecision(4) + ' vs ' + fl.toPrecision(4) + ')', Math.abs(a2 / fl - 1) < 0.02, { a2, fl });
    else ok('no pull-back needed at this scale', Math.abs(a2 / asp - 1) < 0.02, { a2, asp });
    const al2 = await pg.evaluate(`(${SKYCHECK})(${a2 * 15 / 3600})`);
    ok('still aligned after pull-back (worst ' + al2.worst.toFixed(3) + ' px)', al2.worst < 0.5, al2);
  }
  if (opts.userZoom) {
    await pg.evaluate(() => { var r = GeosonifySkyView.getRenderer(); r.setFovDeg(r.getFovDeg() / 2); });
    await pg.evaluate(() => { var z = GeosonifySkyView.getHost().querySelector('[aria-label="Zoom out"]'); z.click(); z.click(); });   // net x2 out, flagged as the person's
  }
  await pg.waitForFunction(() => !document.querySelector('.gs-skyflip-streets'), null, { timeout: 30000 }).catch(() => {});
  await pg.evaluate(() => { window.__doneDown = false; GeosonifySkyView.requestClose(); var t = setInterval(function () { if (!GeosonifySkyFlip.isBusy()) { clearInterval(t); window.__doneDown = true; } }, 30); });
  await pg.waitForFunction(() => window.__doneDown && !GeosonifySkyView.isOpen(), null, { timeout: 20000 });
  const after = await pg.evaluate(() => ({ z: __geosonifyMap.getZoom(), c: __geosonifyMap.getCenter(), pane: getComputedStyle(__geosonifyMap.getPane('mapPane')).opacity,
    bg: document.getElementById('mapContainerMobile').style.background, cv: !!document.querySelector('.gs-skyflip-streets'), frame: AppState.get('frame').key }));
  const wantZ = before.z + (opts.userZoom ? -1 : 0);
  ok('back to zoom ' + wantZ + ' (got ' + after.z.toFixed(6) + ')', Math.abs(after.z - wantZ) < 1e-3, after);
  const midNow = await pg.evaluate(() => { var g = GeosonifySkyFlip._test.wrapGeom(); var ll = __geosonifyMap.containerPointToLatLng([g.cx, g.cy]); return ll; });
  if (opts.userZoom) console.log('     (zoom changed: the middle of the picture is what is kept)');
  if (!opts.userZoom) ok('back to the same place (' + (Math.abs(after.c.lat - before.c.lat) * 111320).toFixed(2) + ' m, ' + (Math.abs(after.c.lng - before.c.lng) * 111320 * Math.cos(0.76)).toFixed(2) + ' m)',
     Math.abs(after.c.lat - before.c.lat) * 111320 < 2 * 111320 * GeosonifyLike(after.z) && Math.abs(after.c.lng - before.c.lng) * 80000 < 2 * 111320 * GeosonifyLike(after.z), { before, after });
  ok('map fully restored (pane opacity 1, no streets canvas, frame earth)', after.pane === '1' && !after.cv && after.frame === 'earth', after);
  ok('no page errors', pg._errs.length === 0, pg._errs.slice(0, 3));
  await pg.context().close();
}
// metres-per-pixel/111320 at zoom z (so "within 2 px")
function GeosonifyLike(z) { return 156543 * 0.725 / Math.pow(2, z) / 111320; }

(async () => {
  const srv = await H.startServer();
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  await scenario(b, 'suburb', 16, { expectTurn: true });
  await scenario(b, 'city', 12, { expectTurn: true });
  await scenario(b, 'region', 8, { expectTurn: true });
  await scenario(b, 'continent', 5, { expectTurn: true });
  await scenario(b, 'whole Earth', 1, { expectTurn: false });
  await scenario(b, 'suburb, reduced motion', 16, { expectTurn: false, reduced: true });
  await scenario(b, 'suburb, the person zooms out in the sky', 15, { expectTurn: true, userZoom: true });
  await scenario(b, 'suburb', 16, { expectTurn: true, aladin: true });
  await scenario(b, 'continent', 5, { expectTurn: true, aladin: true });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close(); srv.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
