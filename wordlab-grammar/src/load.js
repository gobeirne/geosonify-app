'use strict';
const fs = require('fs'), path = require('path');
const {createEngine} = require('./engine');
function load(opts = {}) {
  const d = path.join(__dirname, '..', 'data');
  const v11 = JSON.parse(fs.readFileSync(path.join(d, 'v1_1_lexicon.json'), 'utf8'));
  const oewn = JSON.parse(fs.readFileSync(path.join(d, 'oewn_evidence.json'), 'utf8'));
  return createEngine(v11, oewn, opts);
}
module.exports = {load};
