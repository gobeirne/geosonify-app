#!/usr/bin/env node
/* Every vector decodes exactly as recorded in vectors.json. */
'use strict';
const D = require('./index.js');
const V = require('./vectors.json').vectors;
let bad = 0;
for (const v of V) {
  const a = JSON.stringify([D.decodeLink(v.link), D.parseAnnotations(v.link)]);
  const b = JSON.stringify([v.decoded, v.annotations]);
  if (a !== b) { bad++; console.log('FAIL ' + v.link); }
}
console.log(bad ? `${V.length - bad} passed, ${bad} failed` : `ALL PASS  (${V.length} vectors)`);
process.exit(bad ? 1 : 0);
