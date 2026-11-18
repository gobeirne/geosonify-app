#!/usr/bin/env node
/*
  tests/packages.test.js — the npm and PyPI decoders cannot drift from the spec.
  The npm package's index.js must be the reference decoder byte for byte, and
  every copy of the vectors must match spec/core-profile-v1-vectors.json, which
  must itself be up to date with the reference decoder.
*/
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const R = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
let fail = 0;
function check(name, ok) { if (!ok) { fail++; console.log('FAIL ' + name); } }
check('npm index.js is the reference decoder', R('packages/js/geosonify-decode/index.js') === R('spec/core-profile-v1-reference.js'));
check('npm vectors.json is the spec vectors', R('packages/js/geosonify-decode/vectors.json') === R('spec/core-profile-v1-vectors.json'));
check('PyPI vectors.json is the spec vectors', R('packages/python/geosonify-decode/src/geosonify_decode/vectors.json') === R('spec/core-profile-v1-vectors.json'));
const g = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'make-core-vectors.js'), '--check'], { encoding: 'utf8' });
check('spec vectors up to date with the reference decoder', g.status === 0);
const t = spawnSync(process.execPath, ['test.js'], { cwd: path.join(__dirname, '..', 'packages/js/geosonify-decode'), encoding: 'utf8' });
check('npm package passes its vectors', t.status === 0);
console.log(fail ? `${5 - fail} passed, ${fail} failed` : 'ALL PASS  (5 passed)');
process.exit(fail ? 1 : 0);
