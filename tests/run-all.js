#!/usr/bin/env node
/*
  tests/run-all.js — every Node test in the repo, one command (WP2.9, Nov 2026)

    node tests/run-all.js            run all; exit 1 if any fails
    node tests/run-all.js --list     just list them

  Needs, for the jsdom-based and vector-tile tests (CI installs these, pinned):
    npm install --no-save jsdom@24.1.3 geojson-vt@3.2.1 vt-pbf@3.1.3 \
      @mapbox/vector-tile@1.3.1 pbf@3.3.0 geographiclib-geodesic@2.2.0

  A test passes when it exits 0 AND its last line reports a pass ("PASS",
  "N passed, 0 failed", "all passed"). Anything else is a failure, so a test
  that crashes or prints nothing cannot slip through.
*/
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const TESTS = [
  // Frozen formats and the core profile: these must never change.
  ['Core profile v1 (reference decoder)', 'spec/core-profile-v1-reference.js', ['--selftest']],
  ['Grid passphrase v1 (frozen)',          'spec/grid-passphrase-v1-reference.js', ['--selftest']],
  ['GeoCodec obfuscation (frozen)',        'spec/geocodec-obfuscation-reference.js', ['--selftest']],
  ['HEALPix pass v1 (frozen)',             'spec/healpix-pass-v1-reference.js', ['--selftest']],
  ['HEALPix obfuscation v2',               'spec/healpix-obf-v2-reference.js', ['--selftest']],
  ['AES URL v1 (frozen)',                  'spec/aes-url-v1-reference.js', ['--selftest']],
  ['Chessboard explainer smoke',           'spec/chessboard-explainer-smoke.test.js', []],
  // App modules.
  ['GeoJSON export',                       'tests/geojson-export.test.js', []],
  ['WKT import and export',                'tests/wkt.test.js', []],
  ['Sky maths',                            'js/lib/geosonify-sky.selftest.js', []],
  ['Sky URL',                              'js/lib/geosonify-sky-url.selftest.js', []],
  ['Sky overlay',                          'js/lib/geosonify-sky-overlay.selftest.js', []],
  ['Sky panel',                            'js/lib/geosonify-sky-panel.selftest.js', []],
  ['Sky shapes',                           'js/lib/geosonify-sky-shapes.selftest.js', []],
  ['Sky renderer (jsdom)',                 'js/lib/geosonify-sky-renderer.selftest.js', []],
  ['Sky cutout',                           'js/lib/geosonify-sky-cutout_selftest.js', []],
  ['CDS mirrors',                          'js/lib/geosonify-cds-mirrors_selftest.js', []],
  ['Star-neighbour mirrors',               'js/lib/geosonify-sky-neighbour-mirrors_selftest.js', []],
  ['Wanderers',                            'js/lib/geosonify-wanderers.selftest.js', []],
  ['Starpin',                              'js/lib/geosonify-starpin_selftest.js', []],
  ['Starpin flip',                         'js/lib/geosonify-starpin-flip_selftest.js', []],
  ['Starpin log',                          'js/lib/geosonify-starpin-log_selftest.js', []],
  ['Starpin next',                         'js/lib/geosonify-starpin-next_selftest.js', []],
  ['Starpin replay',                       'js/lib/geosonify-starpin-replay_selftest.js', []],
  ['Starpin map (jsdom)',                  'js/lib/geosonify-starpin-map_selftest.js', []],
  ['Starpin map wrap (jsdom)',             'js/lib/geosonify-starpin-map-wrap_selftest.js', []],
  ['Starpin vector tiles',                 'js/lib/geosonify-starpin-vtiles_selftest.js', []],
];

if (process.argv.includes('--list')) { TESTS.forEach(t => console.log(t[1])); process.exit(0); }

const PASS_LINE = /\bPASS\b|\b\d+ passed, 0 failed\b|\ball passed\b/i;
let failed = 0;
const env = Object.assign({}, process.env, {
  NODE_PATH: [path.join(ROOT, 'node_modules'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter)
});
for (const [name, file, args] of TESTS) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, file)].concat(args), { cwd: ROOT, env, encoding: 'utf8', timeout: 180000 });
  const out = ((r.stdout || '') + (r.stderr || '')).trim().split('\n').filter(l => l.trim());
  const last = out.length ? out[out.length - 1].trim() : '(no output)';
  const ok = r.status === 0 && PASS_LINE.test(last);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(38)} ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s  ${ok ? '' : '\n      ' + out.slice(-8).join('\n      ')}`);
}
console.log(`\n${TESTS.length - failed} of ${TESTS.length} passed`);
process.exit(failed ? 1 : 0);
