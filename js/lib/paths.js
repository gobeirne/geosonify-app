const { chromium } = require('/opt/node-tools/node_modules/playwright');
const H = require('./harness.js');
let pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n, '--', JSON.stringify(d)); } }
async function page(b, q, w) {
  const pg = await (await b.newContext({ viewport: { width: w || 390, height: 844 } })).newPage();
  pg._errs = []; pg.on('pageerror', e => pg._errs.push(e.message));
  await H.route(pg);
  await pg.goto('http://127.0.0.1:' + H.PORT + '/index.html' + (q || ''));
  await pg.waitForFunction(() => window.__geosonifyMap && window.GeosonifySkyFlip);
  await pg.waitForTimeout(800);
  await pg.evaluate(() => { GeosonifySkyAladin.isAvailable = () => false; GeosonifySkyFlip._test.setTimings({ hold: 100, streetsOut: 100 }); });
  return pg;
}
const settled = pg => pg.waitForFunction(() => !GeosonifySkyFlip.isBusy(), null, { timeout: 15000 });
(async () => {
  const srv = await H.startServer();
  const b = await chromium.launch({ args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  let pg = await page(b);
  await pg.evaluate(() => __geosonifyMap.setView([-43.5309, 172.6365], 13, { animate: false }));
  for (const [label, how] of [['the ✕ button', "GeosonifySkyView.getHost().querySelector('[aria-label=\"Back to the Earth map\"]').click()"],
                              ['the Earth button', "GeosonifySkyView.getHost().querySelector('[aria-label^=\"Earth\"]').click()"],
                              ['Escape', null]]) {
    await pg.click('.gs-skyflip-btn'); await settled(pg);
    ok('Sky button opens the sky (' + label + ' test)', await pg.evaluate(() => GeosonifySkyView.isOpen()));
    if (how) await pg.evaluate(how); else await pg.keyboard.press('Escape');
    await pg.waitForTimeout(100); await settled(pg);
    ok(label + ' goes back through the flip, to zoom 13', await pg.evaluate(() => !GeosonifySkyView.isOpen() && Math.abs(__geosonifyMap.getZoom() - 13) < 1e-6), await pg.evaluate(() => __geosonifyMap.getZoom()));
  }
  // double-click during the flip does nothing extra
  await pg.evaluate(() => { GeosonifySkyFlip.toSky(); GeosonifySkyFlip.toSky(); GeosonifySkyFlip.toEarth(); });
  await settled(pg);
  ok('repeated presses during a flip are ignored', await pg.evaluate(() => GeosonifySkyView.isOpen() && document.querySelectorAll('.gs-skyflip-streets').length <= 1));
  await pg.evaluate(() => GeosonifySkyFlip.toEarth()); await settled(pg);
  // Earth pressed during the streets' fade (the tail)
  await pg.evaluate(() => GeosonifySkyFlip._test.setTimings({ hold: 3000 }));
  await pg.click('.gs-skyflip-btn'); await settled(pg);
  ok('streets still showing in the tail', await pg.evaluate(() => !!document.querySelector('.gs-skyflip-streets')));
  await pg.evaluate(() => GeosonifySkyView.requestClose()); await pg.waitForTimeout(50); await settled(pg);
  ok('Earth during the tail works, back to 13', await pg.evaluate(() => !GeosonifySkyView.isOpen() && Math.abs(__geosonifyMap.getZoom() - 13) < 1e-6));
  ok('no page errors', pg._errs.length === 0, pg._errs);
  await pg.context().close();

  // FAQ chips (desktop width so the FAQ tab and map coexist or not)
  pg = await page(b, '', 1280);
  await pg.evaluate(() => __geosonifyMap.setView([-43.5309, 172.6365], 13, { animate: false }));
  await pg.evaluate(() => { var t = Array.from(document.querySelectorAll('button, a, div')).find(e => /^\s*FAQ\s*$/.test(e.textContent)); t && t.click(); });
  await pg.waitForTimeout(800);
  const chip = await pg.$('.basemap-chip[data-basemap="sky"]');
  ok('Sky chip present in FAQ', !!chip);
  if (chip) {
    await chip.click(); await pg.waitForTimeout(100); await settled(pg);
    ok('Sky chip opens the sky', await pg.evaluate(() => GeosonifySkyView.isOpen()));
    ok('Sky chip lit', await pg.evaluate(() => document.querySelector('.basemap-chip[data-basemap="sky"]').classList.contains('active')));
    await (await pg.$('.basemap-chip[data-basemap="aerial"]')).click(); await pg.waitForTimeout(100); await settled(pg);
    ok('Aerial chip leaves the sky, zoom 13', await pg.evaluate(() => !GeosonifySkyView.isOpen() && Math.abs(__geosonifyMap.getZoom() - 13) < 1e-6), await pg.evaluate(() => __geosonifyMap.getZoom()));
    ok('Aerial chip lit', await pg.evaluate(() => document.querySelector('.basemap-chip[data-basemap="aerial"]').classList.contains('active')));
  }
  ok('no page errors (FAQ)', pg._errs.length === 0, pg._errs);
  await pg.context().close();

  // a sky link opens the sky directly; Earth goes back
  pg = await page(b, '?radec=10.684708,41.26875');
  ok('?radec link opens the sky without a flip', await pg.evaluate(() => GeosonifySkyView.isOpen()));
  await pg.evaluate(() => GeosonifySkyView.requestClose()); await pg.waitForTimeout(50); await settled(pg);
  ok('...and Earth closes it', await pg.evaluate(() => !GeosonifySkyView.isOpen() && AppState.get('frame').key === 'earth'));
  ok('no page errors (link)', pg._errs.length === 0, pg._errs);
  await pg.context().close();

  // display links get no button
  pg = await page(b, '?address_a=thp9el4j1&display');
  ok('no Sky button on a display link', await pg.evaluate(() => !document.querySelector('.gs-skyflip-btn')));
  await pg.context().close();
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
