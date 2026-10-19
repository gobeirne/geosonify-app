'use strict';
// Extract the v1.1 parser and scorer from the shipped single-file game, for
// differential testing only. Usage: node tools/extract_v11.js <game.html>
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(process.argv[2], 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const grammar = scripts.find(s => s.includes("VERSION = '1.1.0-long-sentences-and-utterances'"));
const score = scripts.find(s => s.includes("VERSION = '1.1.0-nonlinear-complexity'"));
if (!grammar || !score) throw new Error('v1.1 grammar/scorer not found in ' + process.argv[2]);
const out = path.join(__dirname, '..', 'reference', 'v1_1');
fs.mkdirSync(out, {recursive: true});
fs.writeFileSync(path.join(out, 'starpin_grammar_v1_1.js'), '// Extracted verbatim from ' + path.basename(process.argv[2]) + ' for differential tests. Not modified.\n' + grammar);
fs.writeFileSync(path.join(out, 'starpin_score_v1_1.js'), '// Extracted verbatim from ' + path.basename(process.argv[2]) + ' for differential tests. Not modified.\n' + score);
console.log('wrote reference/v1_1/*.js');
