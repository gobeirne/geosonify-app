'use strict';
/*
 * Build Starpin Word Lab v2.0 from the v1.1 single-file game.
 *   node tools/build_game.js <Starpin_Word_Lab_v1_1_Starpin.html> [out.html]
 * Keeps the v1.1 file untouched. Every patch must match exactly once, so a
 * different source fails loudly instead of producing a broken game.
 *
 * Inserted: OEWN/ERG evidence, the Phase 0–2 engine and scorer, and an
 * adapter (src/game_adapter.js). The v1.1 parser/scorer stay in the file only
 * to record each migrated sentence's v1.1 score in its history.
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const src = process.argv[2], out = process.argv[3] || path.join(root, 'dist', 'Starpin_Word_Lab_v2_0.html');
// The v1.1 file uses CRLF line endings; normalise so multi-line patches match.
let html = fs.readFileSync(src, 'utf8').replace(/\r\n/g, '\n');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const uiIdx = scripts.findIndex(m => m[1].includes('Starpin Word Lab v1.1. Mobile-first'));
if (uiIdx < 0) throw new Error('v1.1 interface script not found');
let ui = scripts[uiIdx][1];

function once(text, from, to, label) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`patch "${label}": expected 1 match, found ${n}`);
  return text.replace(from, () => to);
}
function all(text, from, to, label, expect) {
  const n = text.split(from).length - 1;
  if (n !== expect) throw new Error(`patch "${label}": expected ${expect} matches, found ${n}`);
  return text.split(from).join(to);
}
function replaceFunction(text, name, code) {
  const start = text.indexOf('\nfunction ' + name + '(');
  if (start < 0 || text.indexOf('\nfunction ' + name + '(', start + 1) >= 0) throw new Error('function ' + name + ' not unique');
  const next = text.indexOf('\nfunction ', start + 1);
  if (next < 0) throw new Error('no function after ' + name);
  return text.slice(0, start) + '\n' + code.trim() + text.slice(next);
}

// ---------------------------------------------------------------- engine wiring
ui = once(ui, "if(!lexicon || !window.StarpinGrammarV02 || !window.StarpinScoreV05){", "if(!lexicon || !window.StarpinWL2){", 'load check');
ui = once(ui, "const grammar=window.StarpinGrammarV02.createEngine(lexicon),scoreEngine=window.StarpinScoreV05;",
  "const grammar=window.StarpinWL2.createGrammar(lexicon),scoreEngine=window.StarpinWL2.scorer;", 'engine');
ui = once(ui, "/* Starpin Word Lab v1.1. Mobile-first browser prototype", "/* Starpin Word Lab v2.0 (grammar/scoring Phases 0–2). Mobile-first browser prototype", 'banner');

// ---------------------------------------------------------------- evaluation, pins, pending
ui = once(ui, "function getDraftInfo(){return evaluate(state.draft,state.editingId);}", "function getDraftInfo(){return evaluate(state.draft,state.editingId,state.draftPins);}", 'draft pins');
ui = once(ui, "function evaluate(tiles,ignoreId=null){", "function evaluate(tiles,ignoreId=null,pins=null){", 'evaluate sig');
ui = once(ui, "const parsed=grammar.parse(words,{owned:[...owned],helpers:[...state.unlocked],tokenTypes:types,maxTokens:256});",
  "const parsed=grammar.parse(words,{owned:[...owned],helpers:[...state.unlocked],tokenTypes:types,pins});", 'evaluate pins');
ui = once(ui, "else r=evaluateIgnoringCollection(sentence.tiles);", "else r=evaluateIgnoringCollection(sentence.tiles,sentence.pins);", 'collection pins');
// Pending sentences reserve their blue tiles and count as committable.
ui = once(ui, "if(r.valid)for(const w of own)used.add(w);", "if(r.valid||r.pending)for(const w of own)used.add(w);", 'reserve pending');
ui = once(ui, "valid:evaluated.every(e=>e.result.valid),", "valid:evaluated.every(e=>e.result.valid||e.result.pending),", 'collection valid');
ui = once(ui, "function evaluateIgnoringCollection(tiles){", "function evaluateIgnoringCollection(tiles,pins=null){", 'eic sig');
ui = once(ui, "const r=grammar.parse(words,{owned:[...owned],helpers:[...state.unlocked],tokenTypes:types});\n  return r.valid?",
  "const r=grammar.parse(words,{owned:[...owned],helpers:[...state.unlocked],tokenTypes:types,pins});\n  return r.valid?", 'eic pins');
ui = once(ui, "case 'empty_sentence':return 'Add some word tiles to begin.';",
  "case 'empty_sentence':return 'Add some word tiles to begin.';\n    case 'grammar_conflict':return info.diagnostic?.summary||'Specific grammatical conflict.';\n    case 'no_role_for_tile':return `No grammatical role for ${w} here. A gold tile has only its function-word roles (a gold “can” is a modal, not a noun).`;",
  'reasons');

// ---------------------------------------------------------------- saving and committing
ui = once(ui, "const result=getDraftInfo();if(!result.valid){setNotice(reasonText(result),'bad');renderAll();return;}",
  "const result=getDraftInfo();if(!result.valid&&!result.pending){setNotice(reasonText(result),'bad');renderAll();return;}", 'save pending');
ui = all(ui, "{id,tiles:clone(state.draft)}", "{id,tiles:clone(state.draft),pins:state.draftPins?clone(state.draftPins):null,origin:'v2'}", 'save pins', 3);
ui = once(ui, "  state.draft=[];state.editingId=null;state.insertIndex=0;state.selectedTile=null;\n  setNotice(ghostCount?",
  "  state.draft=[];state.draftPins=null;state.editingId=null;state.insertIndex=0;state.selectedTile=null;\n  setNotice(result.pending?'Saved as pending: it keeps its blue tiles and scores 0 until a grammar update recognises it.':ghostCount?", 'save notice');
ui = once(ui, "state.editingId=id;state.draft=clone(item.tiles);", "state.editingId=id;state.draft=clone(item.tiles);state.draftPins=item.pins?clone(item.pins):null;", 'edit pins');
ui = once(ui, "const bad=check.evaluated.find(x=>!x.result.valid);", "const bad=check.evaluated.find(x=>!x.result.valid&&!x.result.pending);", 'commit pending');
ui = once(ui, "state.committed=clone(state.sandbox.sentences);state.sandbox=null;", "state.committed=clone(state.sandbox.sentences);state.sandbox=null;refreshHistory();", 'commit history');

// ---------------------------------------------------------------- persistence, migration, history
ui = once(ui, "const SAVE_KEY='starpin-word-lab-v1.1-local-snapshot';", "const SAVE_KEY='starpin-word-lab-v2-local-snapshot',LEGACY_SAVE_KEY='starpin-word-lab-v1.1-local-snapshot';", 'save key');
ui = all(ui, "{format:'starpin-word-lab-session',version:1,", "{format:'starpin-word-lab-session',version:2,", 'session version', 2);
ui = all(ui, "draft:state.draft,editingId:state.editingId,", "draft:state.draft,draftPins:state.draftPins,editingId:state.editingId,", 'save draft pins', 2);
ui = once(ui, "if(obj.format!=='starpin-word-lab-session'||obj.version!==1)", "if(obj.format!=='starpin-word-lab-session'||![1,2].includes(obj.version))", 'import version');
ui = once(ui, "state.draft=clone(obj.draft);state.editingId=obj.editingId??null;", "state.draft=clone(obj.draft);state.draftPins=obj.draftPins||null;state.editingId=obj.editingId??null;", 'import pins');
ui = once(ui, "state.scenario='custom';$('scenarioSelect').value='custom';state.lastFind='Imported saved session';setNotice(",
  "refreshHistory();state.scenario='custom';$('scenarioSelect').value='custom';state.lastFind='Imported saved session';setNotice(", 'import history');
ui = once(ui, "\nfunction scheduleAutosave(){", `
// Version history: each sentence records the score it had under every
// grammar/scorer version it has been scored by. Sentences migrated from v1.1
// also record their v1.1 score (computed once with the embedded v1.1 engine).
function legacyScore(s){
  try{if(!window.StarpinGrammarV02||!window.StarpinScoreV05)return undefined;
    const g=legacyScore.g||(legacyScore.g=window.StarpinGrammarV02.createEngine(lexicon));
    const words=s.tiles.map(t=>t.word),types=s.tiles.map(t=>t.source==='helper'?'helper':'collected');
    const r=g.parse(words,{owned:[...state.inventory],helpers:[...state.unlocked],tokenTypes:types});
    return r.valid?window.StarpinScoreV05.scoreParse(r,types,{maxAdjectivesPerNoun:state.adjectiveLimit}).score:null;}catch(_){return undefined;}
}
function refreshHistory(){
  const key=grammar.version+' / '+scoreEngine.version,now=new Date().toISOString();let n=0;
  for(const s of [...state.committed,...(state.sandbox?state.sandbox.sentences:[])]){
    const r=evaluateIgnoringCollection(s.tiles,s.pins);const score=r.valid?r.score.score:null;
    if(!s.scored){s.history=s.history||[];
      if(s.origin!=='v2'){const old=legacyScore(s);if(old!==undefined){s.history.push({version:'v1.1',score:old,at:now});if(old!==score)n++;}}
      s.scored={key,score,at:now};continue;}
    if(s.scored.key!==key){s.history=s.history||[];s.history.push({version:s.scored.key,score:s.scored.score,at:s.scored.at});if(s.scored.score!==score)n++;s.scored={key,score,at:now};}
  }
  state.lastRescored=n;return n;
}
function historyNote(s){const h=s.history||[];if(!h.length)return '';const last=h[h.length-1];return ' · was '+(last.score===null?'pending':last.score)+' under '+last.version;}
function scheduleAutosave(){`, 'history functions');
ui = once(ui, "try{const saved=localStorage.getItem(SAVE_KEY);if(saved){importState(saved);resumed=true;setNotice('Resumed your previous local snapshot. Export session JSON for a reliable backup.','good');renderAll();}}catch(_){}",
  `try{const saved=localStorage.getItem(SAVE_KEY);
  if(saved){importState(saved);resumed=true;const n=state.lastRescored||0;setNotice('Resumed your previous local snapshot.'+(n?' '+n+' sentence'+(n===1?' was':'s were')+' re-scored after a grammar or scorer update (see each sentence’s history).':'')+' Export session JSON for a reliable backup.','good');renderAll();}
  else{const legacy=localStorage.getItem(LEGACY_SAVE_KEY);
    if(legacy){importState(legacy);resumed=true;const n=state.lastRescored||0;
      setNotice('Migrated your v1.1 session: '+state.inventory.size+' collected words, '+state.unlocked.size+' helpers and '+state.committed.length+' sentences kept. '+n+' sentence'+(n===1?' has':'s have')+' a new score under the v2 grammar; each keeps its v1.1 score in its history. Your v1.1 snapshot is left untouched.','good');renderAll();scheduleAutosave();}}
}catch(err){console.error(err);}`, 'startup migration');

// ---------------------------------------------------------------- score panel
ui = replaceFunction(ui, 'renderScore', `
function renderScore(info){
  renderMobileScore(info);
  const empty=!state.draft.length,kind=info.parse?.kind;
  const verdict=$('verdict');verdict.className='verdict '+(empty?'waiting':info.valid?'valid':info.pending?'invalid pending':'invalid');
  const nRead=info.wl2&&info.wl2.readings?info.wl2.readings.length:0;
  verdict.innerHTML=empty?'<span class="verdict-icon">○</span><div><strong>Ready to experiment</strong><small>Construct or load a sentence.</small></div>'
    :info.valid?'<span class="verdict-icon">✓</span><div><strong>'+(kind==='fragment'?'Well-formed phrase or caption':kind==='ellipsis'?'Valid, with the action understood':kind==='question'?'Well-formed question':kind==='imperative'?'Well-formed instruction':'Well-formed sentence')+'</strong><small>'+(info.pinned?'Using your chosen reading':nRead>1?nRead+(nRead>=24?'+':'')+' readings · choose yours in the tree':'One reading')+'</small></div>'
    :'<span class="verdict-icon">'+(info.pending?'…':'×')+'</span><div><strong>'+htmlEscape(info.pending?(info.reason==='grammar_conflict'?'Specific conflict found':'Not recognised yet'):reasonText(info))+'</strong><small>'+htmlEscape(info.pending?info.diagnostic.summary:'')+'</small></div>';
  $('draftScore').textContent=info.valid?info.score.score:info.pending?'0':'—';
  $('scoreSub').textContent=info.valid?(info.provisional?'Provisional score · commit requires available blue tiles':'Scored on '+(info.pinned?'your chosen':'the preferred')+' reading · scorer '+scoreEngine.version):info.pending?'Can be saved as pending (0 points for now)':'Fix the tiles first.';
  if(!info.valid){$('scoreBreakdown').innerHTML=info.pending?'<p class="muted tiny">Pending sentences keep their blue tiles and are re-checked automatically whenever the grammar is updated. If a later version recognises one, it scores from then on.</p>':'';return;}
  const b=info.score.breakdown,linkPts=b.links.reduce((a,l)=>a+l.points,0);
  const lines=[['Blue tiles',String(b.blueTiles)],['Word roles','+'+b.lexicalBase.toFixed(1)],['Sentence size','× '+b.sizeMultiplier.toFixed(2)],['Clause links',b.links.length?'+'+linkPts.toFixed(1)+' ('+b.links.length+')':'—'],['Different kinds of link',b.typeBonus?'+'+b.typeBonus:'—'],['Clauses inside clauses',b.embedBonus?'+'+b.embedBonus:'—']];
  if(b.fragmentFactor<1)lines.push(['Phrase, not a full sentence','× '+b.fragmentFactor]);
  const tags=b.tiles.filter(t=>t.points>0).map(t=>'<span class="bonus-tag" title="'+htmlEscape(t.class+(t.note?' · '+t.note:''))+'">'+htmlEscape(t.word)+' +'+t.points.toFixed(1)+'</span>').join('')
    +b.links.map(l=>'<span class="bonus-tag" title="Clause link">'+htmlEscape(l.type.replace(/_/g,' '))+' +'+l.points.toFixed(1)+'</span>').join('');
  const notes=[];
  if(b.unanchoredLinks.length)notes.push(b.unanchoredLinks.length+' clause link'+(b.unanchoredLinks.length===1?' is':'s are')+' not scored: each linked part needs at least two blue tiles.');
  if(b.tiles.some(t=>t.note==='list item'))notes.push('Plain lists earn less from the third item on.');
  if(b.tiles.some(t=>/stack/.test(t.note||'')))notes.push('Each extra adjective on the same noun earns less; noun compounds keep paying for longer.');
  $('scoreBreakdown').innerHTML=lines.map(([label,value])=>'<div class="score-line"><span>'+htmlEscape(label)+'</span><b>'+htmlEscape(value)+'</b></div>').join('')+'<div class="score-line total"><span>Potential score</span><b>'+info.score.score+'</b></div><div class="bonus-tags">'+tags+'</div>'+(notes.length?'<p class="muted tiny">'+htmlEscape(notes.join(' '))+'</p>':'');
}`);
ui = once(ui, "$('mobileScore').textContent=valid?info.score.score:'—';", "$('mobileScore').textContent=valid?info.score.score:(info.pending?'0':'—');", 'mobile score');
ui = once(ui, ":'Still building';", ":(info.pending?'Pending':'Still building');", 'mobile label');

// ---------------------------------------------------------------- portfolio rows
ui = once(ui, "<article class=\"sentence-row ${r.valid?'':'invalid'}\">", "<article class=\"sentence-row ${r.valid?'':r.pending?'pending':'invalid'}\">", 'row class');
ui = once(ui, "${r.valid?(hasGhost?'Provisional · reallocate or collect before commit':`${entry.tiles.filter(t=>t.source==='collected').length} collected tiles · valid`):htmlEscape(reasonText(r))}",
  "${r.valid?(hasGhost?'Provisional · reallocate or collect before commit':`${entry.tiles.filter(t=>t.source==='collected').length} collected tiles · ${r.score.score} points${htmlEscape(historyNote(entry))}`):r.pending?'Pending · 0 points for now · re-checked on grammar updates'+htmlEscape(historyNote(entry)):htmlEscape(reasonText(r))}", 'row text');

// ---------------------------------------------------------------- tree + reading choice
ui = replaceFunction(ui, 'renderTree', `
function renderTree(info){
  const POS={N:'noun',NIdiom:'noun (idiom)',V:'verb',VPrep:'verb',Adj:'adjective',AdjFused:'adjective',AdvDeg:'degree word',AdvPre:'adverb',AdvPost:'adverb',AdvFocus:'focus word',P:'preposition',ForCoord:'“for” meaning because',Modal:'modal',Cop:'auxiliary',Be:'auxiliary',Do:'auxiliary',HaveAux:'auxiliary',Det:'determiner',Pron:'pronoun',Conj:'conjunction',Sub:'subordinator',Comp:'complementiser',Rel:'relative word',Not:'not',To:'to'};
  if(!info.valid){
    const res=info.wl2;
    if(!res||!res.partial){$('parseTree').innerHTML='<p class="muted">'+htmlEscape(reasonText(info))+'</p>';return;}
    const banner='<div class="partial-note"><b>'+(info.reason==='grammar_conflict'?'Specific conflict':'Partial analysis')+' — not a complete analysis.</b> '+htmlEscape(info.diagnostic.summary)+'</div>';
    const near=res.nearestReading&&res.nearestReading.tree;
    if(state.treeView==='json'){$('parseTree').innerHTML=banner+'<pre class="json-view">'+htmlEscape(JSON.stringify({conflicts:res.conflicts||null,partial:res.partial},null,2))+'</pre>';return;}
    if(near){$('parseTree').innerHTML=banner+(state.treeView==='brackets'?'<pre class="bracket-view">'+htmlEscape(bracketString(near))+'</pre>':nodeMarkup(near))+'<p class="muted tiny">Nearest analysis, built by relaxing only the named rule'+(res.conflicts&&res.conflicts.length>1?'s':'')+'.</p>';return;}
    $('parseTree').innerHTML=banner+'<div class="bonus-tags">'+res.partial.map(p=>'<span class="bonus-tag">'+htmlEscape((p.cat?p.cat+': ':'? ')+p.text)+'</span>').join('')+'</div>';
    return;
  }
  const res=info.wl2,rd=info.reading,sig=info.tokens.join(' ');
  const pins=(state.draftPins&&state.draftPins.sig===sig)?state.draftPins.pins:{};
  const rows=new Map((res.choicePoints||[]).map(c=>[c.index,c]));
  for(const i of Object.keys(pins))if(!rows.has(Number(i)))rows.set(Number(i),{index:Number(i),word:info.tokens[i],options:[pins[i]]});
  const chooser=rows.size?'<div class="reading-chooser"><p class="tiny"><b>'+res.readings.length+(res.readings.length>=24?'+':'')+' readings.</b> Tap what a word is doing to choose your reading; the score follows your choice.</p>'
    +[...rows.values()].sort((a,b)=>a.index-b.index).map(c=>'<div class="pin-row"><span class="pin-word">'+htmlEscape(c.word)+'</span>'
      +c.options.map(o=>'<button type="button" class="pin-opt'+(rd.roles[c.index]?.pos===o?' on':'')+'" data-pin-index="'+c.index+'" data-pin-pos="'+o+'">'+htmlEscape(POS[o]||o)+'</button>').join('')
      +(pins[c.index]?'<button type="button" class="pin-opt clear" data-pin-index="'+c.index+'" data-pin-pos="">automatic</button>':'')+'</div>').join('')+'</div>':'';
  if(state.treeView==='json'){$('parseTree').innerHTML=chooser+'<pre class="json-view">'+htmlEscape(JSON.stringify({reading:rd.bracket,roles:rd.roles,relations:rd.relations,score:info.score},null,2))+'</pre>';return;}
  $('parseTree').innerHTML=chooser+(state.treeView==='brackets'?'<pre class="bracket-view">'+htmlEscape(bracketString(rd.tree))+'</pre>':nodeMarkup(rd.tree));
}`);
ui = once(ui, "\nbindEvents();attachHelperInsertion();", `
// Reading choice: pin what a word is doing. Pins belong to the exact word
// sequence, so editing the sentence drops them automatically.
document.addEventListener('click',e=>{const b=e.target.closest('[data-pin-index]');if(!b)return;
  const sig=state.draft.map(t=>t.word).join(' ');const prev=(state.draftPins&&state.draftPins.sig===sig)?{...state.draftPins.pins}:{};
  const i=b.dataset.pinIndex,p=b.dataset.pinPos;if(p)prev[i]=p;else delete prev[i];
  state.draftPins=Object.keys(prev).length?{sig,pins:prev}:null;renderAll();scheduleAutosave();});
bindEvents();attachHelperInsertion();`, 'pin handler');

// Expose cancelDraft on the page API (used by tests and automation).
ui = once(ui, "addTile,saveDraft,commitSandbox,cancelSandbox", "addTile,cancelDraft,saveDraft,commitSandbox,cancelSandbox", 'api cancelDraft');

// ---------------------------------------------------------------- coach text
ui = once(ui, "You can add words to any sentence, but new grammatical relationships unlock the biggest complexity rewards. A third modifier on the same noun adds no points.",
  "You can add words to any sentence, but a new kind of link between two substantial clauses earns the biggest rewards. Extra adjectives on one noun earn less each time; noun compounds keep paying for longer.", 'coach');

// ---------------------------------------------------------------- evidence + engine bundle
const v11 = JSON.parse(read('data/v1_1_lexicon.json'));
const oewn = JSON.parse(read('data/oewn_evidence.json'));
const slimOewn = {source: oewn.source, licence: oewn.licence, noun_lexfiles: oewn.noun_lexfiles, noun_first_sense_lexfile: oewn.noun_first_sense_lexfile,
  noun_first_group_sense_ancestors: oewn.noun_first_group_sense_ancestors, closed_form_prep_noun: oewn.closed_form_prep_noun, prep_noun_mwe: oewn.prep_noun_mwe,
  bare_prep_noun_usage: Object.fromEntries(Object.entries(oewn.bare_prep_noun_usage).map(([k, v]) => [k, {count: v.count, with_determiner: v.with_determiner}]))};
const erg = JSON.parse(read('data/erg_verb_evidence.json'));
const slimErg = {source: erg.source, licence: erg.licence, sha256: erg.sha256, verbs: erg.verbs};
const modules = ['lexicon', 'grammar', 'parser', 'engine', 'score'];
const bundle = `(function(){const __mods={},__cache={};
${modules.map(m => `__mods['./${m}']=function(module,exports,require){\n${read('src/' + m + '.js')}\n};`).join('\n')}
window.__wl2req=function req(n){if(__cache[n])return __cache[n].exports;const module={exports:{}};__cache[n]=module;__mods[n](module,module.exports,req);return module.exports;};
})();`;
const ergNotice = '/* English Resource Grammar lexicon data (verb frames), MIT licence: ' + read('data/ERG_LICENSE.txt').replace(/\*\//g, '* /').trim().split('\n').slice(0, 3).join(' ') + ' Full text: data/ERG_LICENSE.txt */';
const inject = `<script>
/* Open English WordNet 2025 evidence (CC BY 4.0, https://github.com/globalwordnet/english-wordnet) */
window.STARPIN_OEWN=${JSON.stringify(slimOewn)};
${ergNotice}
window.STARPIN_ERG=${JSON.stringify(slimErg)};
</script>
<script>
${bundle}
${read('src/game_adapter.js')}
</script>
`;
// Insert just before the interface script; replace the interface script text.
const uiStart = scripts[uiIdx].index;
let body = html.slice(0, uiStart) + inject + '<script>' + ui + '</script>' + html.slice(uiStart + scripts[uiIdx][0].length);
// ---------------------------------------------------------------- page text and styles
body = once(body, '<div class="setting"><label for="adjectiveLimit">Reward how many modifiers per noun?</label>',
  '<div class="setting" hidden><label for="adjectiveLimit">Not used in v2: modifier stacks taper instead</label>', 'hide adjective limit');
const css = `<style>
.verdict.pending{border-color:var(--gold,#b8901c)}
.sentence-row.pending{opacity:.85;border-left:3px solid var(--gold,#b8901c)}
.reading-chooser{margin:0 0 .8rem;padding:.6rem .7rem;border:1px solid var(--line,#ccd);border-radius:.6rem}
.reading-chooser p{margin:0 0 .45rem}
.pin-row{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;margin:.3rem 0}
.pin-word{font-weight:650;min-width:5.5rem}
.pin-opt{font:inherit;font-size:.85rem;padding:.25rem .6rem;border-radius:1rem;border:1px solid var(--line,#99a);background:transparent;color:inherit;cursor:pointer}
.pin-opt.on{background:var(--blue,#2f6690);border-color:var(--blue,#2f6690);color:#fff}
.pin-opt.clear{border-style:dashed}
.pin-opt:focus-visible{outline:3px solid var(--gold,#b8901c);outline-offset:2px}
</style>`;
body = once(body, '</head>', css + '</head>', 'css');


body = once(body, '<div class="eyebrow light">STARPiN · WORD LAB 1.1</div>', '<div class="eyebrow light">STARPiN · WORD LAB 2.0</div>', 'header version');
body = body.replace(/<title>([^<]*)<\/title>/, (m, t) => '<title>' + t.replace(/v1\.1/g, 'v2.0') + '</title>');
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, body);
console.log('wrote', out, (body.length / 1024).toFixed(0) + ' KiB');
