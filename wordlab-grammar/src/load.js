'use strict';
const fs = require('fs'), path = require('path');
const {createEngine} = require('./engine');
function load(opts = {}) {
  const d = path.join(__dirname, '..', 'data');
  const v11 = JSON.parse(fs.readFileSync(path.join(d, 'v1_1_lexicon.json'), 'utf8'));
  const oewn = JSON.parse(fs.readFileSync(path.join(d, 'oewn_evidence.json'), 'utf8'));
  const ergPath = path.join(d, 'erg_verb_evidence.json');
  const erg = fs.existsSync(ergPath) ? JSON.parse(fs.readFileSync(ergPath, 'utf8')) : null;
  return createEngine(v11, oewn, {...opts, erg});
}
module.exports = {load};
