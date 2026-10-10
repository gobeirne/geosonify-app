// Scratch: Sky mode gating, the lattice on both faces, hold-to-peek, scale bar.
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const H = require('./harness.js');
const OUT = __dirname + '/out';
let pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n, '--', JSON.stringify(d)); } }
const inkOf = sel => `(() => { var c = document.querySelector('${sel}'); if (!c || !c.width) return 0;
  var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, n = 0;
  for (var i = 3; i < d.length; i += 4) if (d[i] > 20) n++; return n; })()`;

(async () => {
  const srv = await H.startServer();
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errs = []; pg.on('pageerror', e => { if (!/fetch|HiPS|CDS ID/i.test(e.message)) errs.push(e.message); });
  await H.route(pg);
  await pg.goto('http://127.0.0.1:' + H.PORT + '/index.html');
  await pg.waitForFunction(() => window.__geosonifyMap && window.GeosonifySkyFlip);
  await pg.evaluate(() => { GeosonifySkyAladin.isAvailable = () => false; __geosonifyMap.setView([-43.5309, 172.6365], 14, { animate: false }); });
  await pg.waitForTimeout(1500);
  ok('normal mode: no Sky button on the map', await pg.evaluate(() => !document.querySelector('.gs-skyflip-btn')));
  ok('normal mode: no lattice', await pg.evaluate(() => !document.querySelector('.gs-lattice-earth')));
  await pg.screenshot({ path: OUT + '/mode-0-normal.png' });

  // FAQ tab, choose Sky
  await pg.evaluate(() => { var t = Array.from(document.querySelectorAll('button, a, div')).find(e => /^\s*FAQ\s*$/.test(e.textContent)); t && t.click(); });
  await pg.waitForTimeout(600);
  await pg.click('.basemap-chip[data-basemap="sky"]');
  await pg.waitForFunction(() => GeosonifySkyView.isOpen() && !GeosonifySkyFlip.isBusy(), null, { timeout: 15000 });
  await pg.waitForTimeout(800);
  ok('Sky chip: Sky mode on and the sky showing', await pg.evaluate(() => GeosonifySkyFlip.isSkyMode() && GeosonifySkyView.isOpen()));
  ok('Sky chip lit', await pg.evaluate(() => document.querySelector('.basemap-chip[data-basemap="sky"]').classList.contains('active')));
  const skyInk = await pg.evaluate(inkOf('.gs-lattice-sky'));
  ok('lattice drawn on the sky (' + skyInk + ' px of ink)', skyInk > 500, skyInk);
  const scale = await pg.evaluate(() => GeosonifySkyView.getHost().innerText.match(/^\s*[\d.]+\s*(″|′|°|mas|µas)\s*$/m));
  ok('sky scale bar shows an angle only (' + (scale && scale[0].trim()) + ')', !!scale && !/m on Earth/.test(await pg.evaluate(() => GeosonifySkyView.getHost().innerText)), scale);
  await pg.waitForFunction(() => !document.querySelector('.gs-skyflip-streets'), null, { timeout: 20000 });
  await pg.screenshot({ path: OUT + '/mode-1-sky.png' });

  // Hold Earth: streets fade in over the sky; release: they go; still in the sky
  const btn = await pg.evaluateHandle(() => GeosonifySkyView.getHost().querySelector('[aria-label^="Earth"]'));
  const box = await btn.boundingBox();
  await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pg.mouse.down();
  await pg.waitForTimeout(900);
  const held = await pg.evaluate(() => ({ peek: GeosonifySkyFlip.isPeeking(), open: GeosonifySkyView.isOpen(),
    op: (document.querySelector('.gs-skyflip-streets') || {}).style ? getComputedStyle(document.querySelector('.gs-skyflip-streets')).opacity : null }));
  const streetInk = await pg.evaluate(inkOf('.gs-skyflip-streets'));
  ok('holding Earth shows the streets over the sky (' + streetInk + ' px of ink, opacity ' + held.op + ')', held.peek && held.open && streetInk > 500 && +held.op > 0.9, held);
  await pg.screenshot({ path: OUT + '/mode-2-hold.png' });
  await pg.mouse.up();
  await pg.waitForTimeout(700);
  ok('releasing hides them again and stays in the sky', await pg.evaluate(() => !GeosonifySkyFlip.isPeeking() && GeosonifySkyView.isOpen() && !document.querySelector('.gs-skyflip-streets')));

  // Tap Earth: back to the map, Sky mode stays, button + lattice on the ground
  await pg.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await pg.waitForFunction(() => !GeosonifySkyView.isOpen() && !GeosonifySkyFlip.isBusy(), null, { timeout: 15000 });
  await pg.waitForTimeout(600);
  ok('tap Earth: back on the map, zoom 14', await pg.evaluate(() => Math.abs(__geosonifyMap.getZoom() - 14) < 1e-6));
  ok('Sky mode stays on, Sky button on the map', await pg.evaluate(() => GeosonifySkyFlip.isSkyMode() && !!document.querySelector('.gs-skyflip-btn')));
  const earthInk = await pg.evaluate(inkOf('.gs-lattice-earth'));
  ok('lattice drawn on the map (' + earthInk + ' px of ink)', earthInk > 500, earthInk);
  ok('Sky chip still lit on the Earth face', await pg.evaluate(() => document.querySelector('.basemap-chip[data-basemap="sky"]').classList.contains('active')));
  await pg.screenshot({ path: OUT + '/mode-3-earth-skymode.png' });

  // Back to Standard: everything goes
  await pg.click('.basemap-chip[data-basemap="osm"]');
  await pg.waitForTimeout(500);
  ok('Standard: Sky mode off, no button, no lattice', await pg.evaluate(() => !GeosonifySkyFlip.isSkyMode() && !document.querySelector('.gs-skyflip-btn') && !document.querySelector('.gs-lattice-earth')));
  ok('Standard chip lit', await pg.evaluate(() => document.querySelector('.basemap-chip[data-basemap="osm"]').classList.contains('active')));

  // Standard while the sky is showing closes it too
  await pg.click('.basemap-chip[data-basemap="sky"]');
  await pg.waitForFunction(() => GeosonifySkyView.isOpen() && !GeosonifySkyFlip.isBusy(), null, { timeout: 15000 });
  await pg.click('.basemap-chip[data-basemap="aerial"]');
  await pg.waitForTimeout(500);
  ok('Aerial from the sky: sky closed, Sky mode off, zoom 14', await pg.evaluate(() => !GeosonifySkyView.isOpen() && !GeosonifySkyFlip.isSkyMode() && Math.abs(__geosonifyMap.getZoom() - 14) < 1e-6 && !document.querySelector('.gs-lattice-sky')));
  ok('no page errors', errs.length === 0, errs.slice(0, 3));

  // A sky link lands in Sky mode
  const pg2 = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await H.route(pg2);
  await pg2.goto('http://127.0.0.1:' + H.PORT + '/index.html?radec=10.684708,41.26875');
  await pg2.waitForFunction(() => window.GeosonifySkyFlip && GeosonifySkyView.isOpen(), null, { timeout: 15000 });
  await pg2.waitForTimeout(500);
  ok('a sky link turns Sky mode on', await pg2.evaluate(() => GeosonifySkyFlip.isSkyMode()));
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
