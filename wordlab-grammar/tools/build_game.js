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

// ================================================================ UI clean-up (v2.0, 2026-10-20)
function between(text, startMarker, endMarker, code, label) {
  const a = text.indexOf(startMarker), b = text.indexOf(endMarker, a);
  if (a < 0 || b < 0 || text.indexOf(startMarker, a + 1) >= 0) throw new Error('patch "' + label + '": markers not unique');
  return text.slice(0, a) + code + text.slice(b);
}
function lineStarting(text, prefix, code, label) {
  const lines = text.split('\n'); const idx = lines.map((l, i) => l.startsWith(prefix) ? i : -1).filter(i => i >= 0);
  if (idx.length !== 1) throw new Error('patch "' + label + '": expected 1 line, found ' + idx.length);
  lines[idx[0]] = code; return lines.join('\n');
}
// Word tray: show every word; no "Show all" button; no search box (part-of-speech filter kept).
ui = once(ui, "const visible=state.bankExpanded?filtered:filtered.slice(0,64);", "const visible=filtered;", 'bank all');
ui = lineStarting(ui, "  $('bankMore').innerHTML=", "  $('bankMore').innerHTML='';scrollCue($('wordBank'));", 'bank more');
ui = once(ui, "const limit=state.composeBankExpanded?matching.length:70;", "const limit=matching.length;", 'compose all');
ui = lineStarting(ui, "  $('composeBankMore').innerHTML=", "  $('composeBankMore').innerHTML='';scrollCue($('composeWordBank'));", 'compose more');
// A fade at the bottom of a word tray when more words are hidden below.
ui = once(ui, "\nfunction renderBank(){", `
function scrollCue(el){if(!el)return;const upd=()=>el.classList.toggle('more-below',el.scrollTop+el.clientHeight<el.scrollHeight-2);
  if(!el.dataset.cue){el.dataset.cue='1';el.addEventListener('scroll',upd,{passive:true});}requestAnimationFrame(upd);}
function renderBank(){`, 'scroll cue');
// Static "suggestions, not guarantees" picks: removed.
ui = replaceFunction(ui, 'renderSmartPicks', "function renderSmartPicks(){$('smartPicks').innerHTML='';}");

// Coach: tips from the actual analysis; closes when the sentence changes.
ui = replaceFunction(ui, 'getCoachHints', `
function getCoachHints(info){
  if(!state.draft.length)return [{head:'Start small',body:'A noun and a verb make a sentence: for example a collected noun, a gold “can”, and a verb.',terms:['noun phrase','verb phrase']}];
  if(!info.valid&&info.pending){
    if(info.reason==='grammar_conflict')return [{head:'One fix away',body:info.diagnostic.detail,terms:[]}];
    return [{head:'Connect the pieces',body:info.diagnostic.detail+' A verb, or a joining word such as “and” or “because”, can link the pieces into one sentence.',terms:['clause']}];}
  if(!info.valid)return [{head:'Check the tiles',body:reasonText(info),terms:[]}];
  const b=info.score.breakdown,tips=[],types=new Set(b.distinctLinkTypes),kind=info.parse?.kind;
  if(kind==='fragment')tips.push({head:'Make it a sentence',body:'This is a phrase, so it scores at 0.6×. Add a verb (with a gold “can” if you like) to make a full sentence.',terms:['verb phrase']});
  if(b.unanchoredLinks.length)tips.push({head:'Give the joined part more weight',body:'The link to “'+b.unanchoredLinks[0].dep+'” is not scored yet: each linked part needs at least two blue words.',terms:['clause']});
  if(!types.size&&kind!=='fragment')tips.push({head:'Join a second idea',body:'Add a second clause with its own blue subject and verb, joined by “and” or “because”. Links between substantial clauses earn bonuses.',terms:['coordination','subordinate clause']});
  else if(types.size&&types.size<3)tips.push({head:'Try a different kind of link',body:'You have '+[...types].map(t=>t.replace(/_/g,' ')).join(' and ')+'. A new kind of link — a reason (because …), a relative clause (that …) or an infinitive (decide to …) — earns far more than another “and”.',terms:['subordinate clause']});
  if(b.tiles.some(t=>/stack/.test(t.note||'')))tips.push({head:'Swap an adjective for a noun',body:'Each extra adjective on one noun earns less. Noun compounds (“banana menu output”) keep paying for longer.',terms:['noun compound']});
  if(b.tiles.some(t=>t.note==='list item'))tips.push({head:'Lists taper',body:'Plain lists earn less from the third item. Give the items words of their own instead.',terms:['coordination']});
  if(b.blueTiles<6&&kind!=='fragment')tips.push({head:'Longer sentences pay more per word',body:'Your size bonus is ×'+b.sizeMultiplier.toFixed(2)+'; it rises towards ×1.6 as you add blue words.',terms:['complexity']});
  if(!tips.length)tips.push({head:'A strong sentence',body:'Nothing obvious to add. Check the reading in the Syntax view, or save it and start another.',terms:[]});
  return tips;
}`);
ui = replaceFunction(ui, 'renderCoach', `
function renderCoach(info){
  const sig=state.draft.map(t=>t.word+'/'+t.source).join(' ');
  if(state.coachOpen&&state.coachSig!==undefined&&state.coachSig!==sig){state.coachOpen=false;state.hintIndex=0;}
  state.coachSig=sig;
  const hints=getCoachHints(info);
  if(state.coachOpen&&state.hintIndex>=hints.length){state.coachOpen=false;state.hintIndex=0;}
  const panel=$('coachPanel');panel.hidden=!state.coachOpen;
  $('coachButton').setAttribute('aria-expanded',String(state.coachOpen));
  $('coachButton').textContent=!state.coachOpen?'Get a tip ✨':state.hintIndex+1<hints.length?'Next tip ›':'Close tip';
  if(!state.coachOpen)return;
  const hint=hints[state.hintIndex];
  panel.innerHTML='<strong>'+htmlEscape(hint.head)+'</strong><p>'+htmlEscape(hint.body)+'</p>'+(hints.length>1?'<p class="tiny muted">Tip '+(state.hintIndex+1)+' of '+hints.length+'</p>':'')+(hint.terms.length?'<p class="tiny muted">Learn: '+hint.terms.map(t=>termLink(t)).join(' · ')+'</p>':'');
}`);

// Sentence tiles: just the word; one small bar on the selected tile only.
ui = between(ui, "  if(!draft.length)s='<div class=\"empty-message\">", "  $('builder').innerHTML=s;", `  if(!draft.length)s='<div class="empty-message">Type below, or tap a word in the tray, to begin.<br>Blue words score; gold helpers are unlimited.</div>';
  for(let i=0;i<=draft.length;i++){
    s+=\`<button class="insert-slot \${state.insertIndex===i?'selected':''}" data-insert="\${i}" aria-label="Insert a word at position \${i+1}" title="Insert here">+</button>\`;
    if(i===draft.length)continue;
    const t=draft[i],both=state.inventory.has(t.word)&&state.unlocked.has(t.word),sel=state.selectedTile===i;
    const kind=t.source==='helper'?'gold helper, unlimited':t.source==='hypothetical'?'try tile, not collected':'collected word';
    const ew=htmlEscape(t.word);
    s+=\`<div class="tile \${t.source==='helper'?'gold':t.source==='hypothetical'?'ghost':''} \${sel?'selected-tile':''}" data-tile="\${i}" tabindex="0" role="button" aria-label="\${ew}, \${kind}. Arrow keys move; Delete removes." aria-pressed="\${sel}" draggable="true" title="\${ew} — \${kind}\${both?' · ↔ switches blue/gold':''}"><span class="tile-word">\${displayWord(t.word,i)}</span>\`
      +(sel?\`<span class="tile-bar">\${both?\`<button class="tile-op" data-swap="\${i}" aria-label="Switch \${ew} between blue and gold">↔</button>\`:''}<button class="tile-op" data-move="\${i}" data-dir="-1" aria-label="Move \${ew} left">‹</button><button class="tile-op" data-move="\${i}" data-dir="1" aria-label="Move \${ew} right">›</button><button class="tile-op" data-remove="\${i}" aria-label="Remove \${ew}">×</button></span>\`:'')+'</div>';
  }
`, 'tiles');
// Capitalise proper names in the sentence display, using the reading.
ui = once(ui, "$('sentenceText').textContent=draft.length?formatSentence(draft,getDraftInfo().parse?.kind):'Start adding tiles…';",
  "$('sentenceText').textContent=draft.length?(i=>formatSentence(draft,i.parse?.kind,i.reading))(getDraftInfo()):'Start adding tiles…';", 'sentence caps');
ui = once(ui, "htmlEscape(formatSentence(entry.tiles,r.parse?.kind))", "htmlEscape(formatSentence(entry.tiles,r.parse?.kind,r.reading))", 'row caps');
ui = once(ui, "const formatSentence=(tiles,kind=null)=>{\n  if(!tiles.length)return '';\n  const words=tiles.map(t=>t.word);",
  "const formatSentence=(tiles,kind=null,reading=null)=>{\n  if(!tiles.length)return '';\n  const words=tiles.map((t,i)=>nameCase(t.word,reading&&reading.roles[i]));", 'formatSentence');
ui = once(ui, "const formatSentence=", `// Months and Latin are always capitalised; satoshi and march only when the
// reading uses them as names (a satoshi, the march stay lower-case).
const ALWAYS_CAP=new Set(['april','december','february','latin','october']);
function nameCase(w,role){return ALWAYS_CAP.has(w)||(role&&role.pos==='PropN')?w.charAt(0).toUpperCase()+w.slice(1):w;}
function displayWord(w,i){return htmlEscape(ALWAYS_CAP.has(w)?nameCase(w):w);}
const formatSentence=`, 'name case');

// Removal with undo (tile bar ×, mobile remove, drag to remove zone, Delete key).
ui = once(ui, "const rm=e.target.closest('[data-remove]');if(rm){const i=Number(rm.dataset.remove);state.draft.splice(i,1);",
  "const rm=e.target.closest('[data-remove]');if(rm){const i=Number(rm.dataset.remove);showUndo(state.draft[i],i);state.draft.splice(i,1);", 'remove undo');
ui = once(ui, "mobileRemoveTile').addEventListener('click',()=>{const i=state.selectedTile;if(i===null)return;state.draft.splice(i,1);",
  "mobileRemoveTile').addEventListener('click',()=>{const i=state.selectedTile;if(i===null)return;showUndo(state.draft[i],i);state.draft.splice(i,1);", 'mobile remove undo');
ui = once(ui, "\nbindEvents();attachHelperInsertion();", `
// ---- removal, undo, drag to remove, long-press drag on touch, keyboard ----
let undoTimer=null;
// Float above the mobile action dock (measured, since its height varies).
function placeFloating(el){const d=document.getElementById('mobileActionDock');const r=d&&d.getBoundingClientRect();
  const visible=r&&r.height>0&&getComputedStyle(d).display!=='none'&&r.top<innerHeight;el.style.bottom=(visible?Math.round(innerHeight-r.top)+12:24)+'px';}
function showUndo(tile,index){if(!tile)return;state.lastRemoved={tile:clone(tile),index};const u=$('undoToast');
  u.innerHTML='Removed “'+htmlEscape(tile.word)+'” <button type="button" id="undoRemove">Undo</button>';u.hidden=false;placeFloating(u);
  clearTimeout(undoTimer);undoTimer=setTimeout(()=>{u.hidden=true;},6000);}
function removeTileAt(i){if(i<0||i>=state.draft.length)return;showUndo(state.draft[i],i);state.draft.splice(i,1);state.insertIndex=Math.min(i,state.draft.length);state.selectedTile=null;renderAll();scheduleAutosave();}
document.addEventListener('click',e=>{if(!e.target.closest('#undoRemove'))return;const r=state.lastRemoved;if(!r)return;
  state.draft.splice(Math.min(r.index,state.draft.length),0,r.tile);state.lastRemoved=null;$('undoToast').hidden=true;state.insertIndex=r.index+1;renderAll();scheduleAutosave();});
const bin=$('tileBin');
bin.addEventListener('dragover',e=>{e.preventDefault();bin.classList.add('hot');});
bin.addEventListener('dragleave',()=>bin.classList.remove('hot'));
bin.addEventListener('drop',e=>{e.preventDefault();bin.classList.remove('hot');const p=state.dragPayload;if(p&&p.from==='draft')removeTileAt(p.index);bin.hidden=true;document.body.classList.remove('tile-dragging');});
$('builder').addEventListener('dragstart',e=>{if(e.target.closest('[data-tile]')){bin.hidden=false;$('undoToast').hidden=true;placeFloating(bin);document.body.classList.add('tile-dragging');}});
$('builder').addEventListener('dragend',()=>{bin.hidden=true;document.body.classList.remove('tile-dragging');});
(function touchDrag(){
  const B=$('builder');let lp=null,suppressUntil=0;
  B.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')return;const tile=e.target.closest('[data-tile]');if(!tile||e.target.closest('.tile-op'))return;
    const s={x:e.clientX,y:e.clientY,i:Number(tile.dataset.tile),id:e.pointerId,tile,active:false};
    s.timer=setTimeout(()=>{s.active=true;tile.classList.add('is-dragging','lifted');bin.hidden=false;$('undoToast').hidden=true;placeFloating(bin);document.body.classList.add('tile-dragging');try{tile.setPointerCapture(s.id);}catch(_){}if(navigator.vibrate)navigator.vibrate(10);},320);lp=s;});
  B.addEventListener('touchmove',e=>{if(lp&&lp.active)e.preventDefault();},{passive:false});
  const move=e=>{if(!lp)return;if(!lp.active){if(Math.hypot(e.clientX-lp.x,e.clientY-lp.y)>8){clearTimeout(lp.timer);lp=null;}return;}
    e.preventDefault();lp.tile.style.transform='translate('+(e.clientX-lp.x)+'px,'+(e.clientY-lp.y)+'px)';
    lp.tile.style.pointerEvents='none';const el=document.elementFromPoint(e.clientX,e.clientY);lp.tile.style.pointerEvents='';
    bin.classList.toggle('hot',!!(el&&el.closest('#tileBin')));};
  const end=e=>{if(!lp)return;clearTimeout(lp.timer);const s=lp;lp=null;if(!s.active)return;suppressUntil=Date.now()+450;
    s.tile.style.pointerEvents='none';const el=document.elementFromPoint(e.clientX,e.clientY);s.tile.style.pointerEvents='';
    s.tile.style.transform='';s.tile.classList.remove('is-dragging','lifted');bin.hidden=true;bin.classList.remove('hot');document.body.classList.remove('tile-dragging');
    if(e.type==='pointercancel')return renderAll();
    if(el&&el.closest('#tileBin'))return removeTileAt(s.i);
    const slot=el&&el.closest('[data-insert]'),t2=el&&el.closest('[data-tile]');let at=null;
    if(slot)at=Number(slot.dataset.insert);else if(t2){const r=t2.getBoundingClientRect();at=Number(t2.dataset.tile)+(e.clientX>r.left+r.width/2?1:0);}
    if(at!==null&&at!==s.i&&at!==s.i+1)handleDrop({from:'draft',index:s.i},at);else renderAll();};
  B.addEventListener('pointermove',move);B.addEventListener('pointerup',end);B.addEventListener('pointercancel',end);
  B.addEventListener('click',e=>{if(Date.now()<suppressUntil){e.stopPropagation();e.preventDefault();}},true);
})();
$('builder').addEventListener('keydown',e=>{const tile=e.target.closest('[data-tile]');if(!tile)return;const i=Number(tile.dataset.tile);
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removeTileAt(i);const n=$('builder').querySelector('[data-tile="'+Math.max(0,i-1)+'"]');if(n)n.focus();}
  else if((e.key==='ArrowLeft'||e.key==='ArrowRight')&&(e.altKey||e.shiftKey||state.selectedTile===i)){e.preventDefault();const to=i+(e.key==='ArrowLeft'?-1:1);moveDraft(i,to);const n=$('builder').querySelector('[data-tile="'+to+'"]');if(n)n.focus();}
  else if(e.key==='Enter'||e.key===' '){e.preventDefault();tile.click();}});

// ---- typed entry with BIP39 four-letter completion ----
const typeEl=$('typeEntry');
const HELPER_BIP=new Set(HELPER_CANDIDATES.filter(w=>bip39.has(w)));
const BIP_LIST=[...bip39].sort();
function typedSource(w){
  if(state.unlocked.has(w)&&(!bip39.has(w)||HELPER_BIP.has(w)))return 'helper';
  if(bip39.has(w)){if(state.inventory.has(w))return allocated().has(w)?'taken':'collected';return 'hypothetical';}
  if(HELPER_CANDIDATES.includes(w))return 'locked';
  return null;
}
// Resolve a typed token to a word: exact BIP39/helper word, or a unique
// BIP39 prefix (four letters always suffice).
function resolveTyped(tok){if(bip39.has(tok)||HELPER_CANDIDATES.includes(tok))return tok;const m=BIP_LIST.filter(x=>x.startsWith(tok));return m.length===1?m[0]:null;}
// Insert one typed word without re-rendering (callers render once).
// A collected word already used elsewhere becomes a purple preview tile, as in
// v1.1: you can experiment, and Commit asks you to reallocate it first.
function insertTyped(w){
  let src=typedSource(w);
  if(src==='locked'){setNotice('Unlock the helper “'+w+'” first (Helpers).','bad');return false;}
  if(!src){setNotice('“'+w+'” is not a BIP39 word or a helper.','bad');return false;}
  if(src==='taken'){
    if(state.draft.some(t=>t.word===w&&t.source!=='helper')){setNotice('“'+w+'” is already in this sentence.','bad');return false;}
    src='hypothetical';state.typedPreview=(state.typedPreview||0)+1;}
  if(src==='hypothetical'&&state.draft.some(t=>t.word===w&&t.source!=='helper')){setNotice('“'+w+'” is already in this sentence.','bad');return false;}
  state.draft.splice(state.insertIndex,0,{word:w,source:src});state.insertIndex++;state.selectedTile=null;return true;
}
function completeTyped(w){state.typedPreview=0;const ok=insertTyped(w);if(ok)setNotice(state.typedPreview?'“'+w+'” is already used in another sentence, so it is added as a purple preview tile.':'');renderAll();scheduleAutosave();return ok;}
// Process everything in the field: words followed by a space or punctuation
// become tiles (so a pasted sentence works); a trailing partial word stays.
function processTyped(){
  const raw=typeEl.value.toLowerCase(),endsOpen=/[a-z']$/.test(raw);
  const toks=raw.split(/[^a-z']+/).filter(Boolean);
  const partial=endsOpen?toks.pop():'';
  let added=0,stopAt=-1;state.typedPreview=0;
  for(let i=0;i<toks.length;i++){const w=resolveTyped(toks[i].replace(/'/g,''));
    if(!w){setNotice('“'+toks[i]+'” is not a BIP39 word or a helper.','bad');stopAt=i;break;}
    if(!insertTyped(w)){stopAt=i;break;}added++;}
  let rest=stopAt>=0?toks.slice(stopAt).join(' ')+(partial?' '+partial:''):partial;
  // Nothing is accepted until a space, Enter or punctuation follows it, so
  // touch-typists are never overtaken; Space then takes the highlighted word.
  typeEl.value=rest;
  if(added){if(stopAt<0)setNotice(state.typedPreview?state.typedPreview+' word'+(state.typedPreview===1?' is':'s are')+' already used in another sentence, so '+(state.typedPreview===1?'it was':'they were')+' added as purple preview tiles.':'');renderAll();scheduleAutosave();}
  else if(stopAt>=0)renderAll();
}
function typedCandidates(p){
  if(!p)return [];
  const out=[],seen=new Set(),push=(w,src)=>{if(!seen.has(w)){seen.add(w);out.push([w,src]);}};
  for(const w of [...state.unlocked].sort())if(w.startsWith(p))push(w,'helper');
  for(const w of BIP_LIST)if(w.startsWith(p)){const s=typedSource(w);if(s==='collected'||s==='helper')push(w,s);}
  if(p.length>=2)for(const w of BIP_LIST)if(w.startsWith(p)&&typedSource(w)==='hypothetical')push(w,'hypothetical');
  return out.slice(0,8);
}
function renderTyped(){
  const el=$('typeEntry'),p=el.value.trim().toLowerCase().split(/[^a-z']+/).pop()||'',c=typedCandidates(p),next=p?resolveTyped(p):null;
  // The chip Space would accept is highlighted and listed first.
  if(next&&!c.some(([w])=>w===next))c.unshift([next,typedSource(next)==='taken'?'hypothetical':typedSource(next)||'hypothetical']);
  c.sort((a,b)=>(b[0]===next)-(a[0]===next));
  $('typeSuggest').innerHTML=c.slice(0,8).map(([w,s])=>'<button type="button" class="type-chip '+s+(w===next?' next':'')+'" data-typeword="'+htmlEscape(w)+'">'+htmlEscape(w)+(s==='hypothetical'?' <small>try</small>':'')+(w===next?' <small class="key">space</small>':'')+'</button>').join('');
}
typeEl.addEventListener('input',()=>{processTyped();renderTyped();});
typeEl.addEventListener('keydown',e=>{
  if(e.key==='Backspace'&&typeEl.value===''&&state.insertIndex>0){e.preventDefault();const i=state.insertIndex-1,t=state.draft[i];
    state.draft.splice(i,1);state.insertIndex=i;state.selectedTile=null;typeEl.value=t.word;renderAll();renderTyped();}
  else if(e.key==='Enter'){e.preventDefault();const v=typeEl.value.trim().toLowerCase();if(!v)return;
    if(/\s/.test(v)){typeEl.value=v+' ';processTyped();renderTyped();return;}
    const exact=bip39.has(v)||HELPER_CANDIDATES.includes(v),c=typedCandidates(v),pick=exact?v:(c.length?c[0][0]:null);
    if(pick&&completeTyped(pick))typeEl.value='';renderTyped();}});
$('typeSuggest').addEventListener('click',e=>{const b=e.target.closest('[data-typeword]');if(!b)return;if(completeTyped(b.dataset.typeword))typeEl.value='';renderTyped();typeEl.focus();});
bindEvents();attachHelperInsertion();`, 'interaction');

// ---------------------------------------------------------------- coach text
// (coach text now comes from getCoachHints above)

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
body = once(body, '<input id="bankFilter"', '<input hidden id="bankFilter"', 'hide bank search');
body = once(body, '<input id="composeBankFilter"', '<input hidden id="composeBankFilter"', 'hide compose search');
body = once(body, '<div id="builder" class="builder" aria-label="Sentence tile arrangement" role="group"></div>',
  '<div class="type-entry"><input id="typeEntry" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" autocomplete="off" enterkeyhint="done" placeholder="Type or paste a sentence; Space accepts each word" aria-label="Type or paste a sentence; Space accepts the highlighted word; four letters identify any BIP39 word"><div id="typeSuggest" class="type-suggest" aria-live="polite"></div></div>'
  + '<div id="builder" class="builder" aria-label="Sentence tile arrangement" role="group"></div>'
  + '<div id="tileBin" class="tile-bin" hidden>Drop here to remove</div><div id="undoToast" class="undo-toast" role="status" hidden></div>', 'typing + bin');
const css = `<style>
.tile.gold{border-style:dashed}
.tile-bar{display:inline-flex;gap:3px;margin-left:4px}
.builder .insert-slot{opacity:0;transition:opacity .15s}
.builder:hover .insert-slot,.builder .insert-slot.selected,.builder .insert-slot:focus-visible,body.tile-dragging .builder .insert-slot{opacity:1}
.tile.lifted{z-index:5;box-shadow:0 8px 18px rgba(0,0,0,.2);position:relative}
.tile-bin{position:fixed;left:14px;right:14px;bottom:calc(env(safe-area-inset-bottom,0px) + 92px);z-index:2000;padding:.9rem;border:2px dashed #c98f80;border-radius:.7rem;text-align:center;color:#8a3b2a;font-weight:650;background:#fff8f6;box-shadow:0 6px 18px rgba(0,0,0,.15)}
@media (min-width:871px){.undo-toast{bottom:24px;left:50%;right:auto;transform:translateX(-50%);width:min(420px,90vw)}.tile-bin{bottom:24px;left:50%;right:auto;transform:translateX(-50%);width:min(420px,90vw)}}
.tile-bin.hot{background:#fbe9e5;border-color:#c0533c}
.undo-toast{position:fixed;left:14px;right:14px;bottom:calc(env(safe-area-inset-bottom,0px) + 92px);z-index:2001;padding:.6rem .85rem;box-shadow:0 6px 18px rgba(0,0,0,.2);border-radius:.55rem;background:#20302a;color:#fff;font-size:.92rem;display:flex;gap:.6rem;align-items:center;justify-content:space-between}
.undo-toast[hidden],.tile-bin[hidden],.type-entry [hidden]{display:none!important}
.undo-toast button{font:inherit;font-weight:700;background:transparent;border:0;color:#f1d27a;cursor:pointer;padding:.2rem .3rem}
.type-entry{margin:0 0 .6rem}
#typeEntry{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:.65rem .8rem;border:1px solid #b9c9c4;border-radius:.6rem;background:#fff;color:inherit}
#typeEntry:focus-visible{outline:3px solid #b8901c;outline-offset:1px}
.type-suggest{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.4rem}
.type-chip{font:inherit;font-size:.92rem;padding:.35rem .7rem;border-radius:.5rem;border:1px solid #8ab4c9;background:var(--bluelight,#e7f2f8);color:#1d6281;cursor:pointer;min-height:36px}
.type-chip.helper{border-color:#e2c28c;border-style:dashed;background:var(--goldlight,#fbf1df);color:#8f631e}
.type-chip.hypothetical{border-style:dotted;opacity:.85}
.type-chip.next{outline:2px solid #116d6a;outline-offset:1px;font-weight:700}
.type-chip small.key{font-size:.7rem;font-weight:600;opacity:.7;margin-left:.2rem;text-transform:uppercase;letter-spacing:.04em}
.compose-word-bank{max-height:200px}
.word-bank.more-below,.compose-word-bank.more-below{-webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - 26px),transparent);mask-image:linear-gradient(to bottom,#000 calc(100% - 26px),transparent)}
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
