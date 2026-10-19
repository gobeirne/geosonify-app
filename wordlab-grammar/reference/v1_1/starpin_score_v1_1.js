// Extracted verbatim from Starpin_Word_Lab_v1_1_Starpin.html for differential tests. Not modified.

/* Experimental Starpin score v0.5, research-only.
   Does NOT judge semantics, novelty, style, or literary quality.
   Consumes a v0.2 parser result and explicit tile provenance.
   To be reviewed before production; values illustrative.
*/
(function (root,factory) {
  if (typeof module==='object' && module.exports) module.exports=factory();
  else root.StarpinScoreV05=factory();
})(typeof globalThis!=='undefined' ? globalThis : this, function() {
'use strict';
const VERSION = '1.1.0-nonlinear-complexity';
const WORD_WEIGHTS = [8,8,8,8,8,8,3,3,3,3,1,1,1,1];
// Syntax bonuses apply ONCE per distinct construction family, not once per token/occurrence.
const FEATURE_BONUSES = Object.freeze({
  verb_object:4,
  adjective_modifier:6,
  degree_modifier:2,
  verb_adverb:3,
  temporal_modifier:4,
  prepositional_phrase:7,
  subordinate_clause:14,
  predicate_adjective:7,
  predicate_nominal:4,
  predicate_prepositional:4,
  complement_clause:9,
  clause_coordination:4,
  verb_coordination:3,
  noun_coordination:1,
  negation:4,
  question:3,
  possession:3,
  ditransitive:6,
  past_tense:3,
  infinitive:5,
  do_support:1,
  imperative:1,
  noun_compound:0,
  relative_clause:17
});
const DIVERSITY_FAMILIES = Object.freeze([
  'verb_object','adjective_modifier','prepositional_phrase','subordinate_clause',
  'predicate_adjective','complement_clause','clause_coordination','verb_coordination',
  'noun_coordination','negation','question','ditransitive','infinitive',
  'temporal_modifier','verb_adverb','predicate_nominal','predicate_prepositional',
  'possession','past_tense','relative_clause'
]);
const OPAQUE_KINDS = new Set(['direct_quote','quoted_fragment','opaque_list','unparsed_title','word_mention']);
function marginalWordPoints(k) {return WORD_WEIGHTS.slice(0,Math.max(0,k)).reduce((a,b)=>a+b,0);}
function scoreParse(parseResult, sources, options={}) {
  if (!parseResult?.valid) return {valid:false,score:0,reason:parseResult?.reason||'invalid'};
  if (!Array.isArray(sources) || sources.length!==parseResult.tokens.length) throw new Error('Provide a source for each tile');
  if (options.opaqueWordIndices?.length) {
    // Reject scoring of under-analysed quoted or metalinguistic material.
    return {valid:false,score:0,reason:'opaque_construction_not_supported_in_scoring_v0.4'};
  }
  const collectedIndices=sources.map((x,i)=>x==='collected'?i:-1).filter(i=>i>=0);
  const collectedWords=collectedIndices.map(i=>parseResult.tokens[i]);
  const rawK=collectedWords.length;
  // Require structural annotations for modifier budgeting; in current grammar
  // each base noun phrase carries the exact adjective token indices it licensed.
  // A grammar without this provenance should not run this score in production.
  const modifierGroups=[];
  const walk=(n)=>{
    if(!n||typeof n!=='object')return;
    if(n.kind==='noun_phrase' && Number.isInteger(n.headIndex) && Array.isArray(n.modifierSpans)) {
      modifierGroups.push({headIndex:n.headIndex,
        spans:n.modifierSpans.map(m=>({...m,indices:Array.from({length:m.end-m.start},(_,i)=>m.start+i)})),
        nounSpans:(n.nounModifierSpans||[]).map(m=>({...m,indices:[m.start]}))});
    }
    for(const ch of n.children||[])walk(ch);
  };
  walk(parseResult.parse);
  modifierGroups.sort((a,b)=>a.headIndex-b.headIndex);
  // Per noun phrase, a first modifier can earn normal word points, a
  // second earns a small structural reward, and subsequent modifiers earn
  // zero. This covers adjectives AND noun adjuncts: inserting "project" into
  // "clean library jeans" must not earn free points just by word padding.
  const seenHeads=new Set(),suppressed=new Set();
  const maxPerNoun=Math.min(3,Math.max(1,Number(options.maxAdjectivesPerNoun)||2));
  let secondaryModifierBonus=0;
  const secondaryModifiers=[];
  for(const group of modifierGroups){
    if(seenHeads.has(group.headIndex))continue;
    seenHeads.add(group.headIndex);
    const modifiers=[...(group.spans||[]),...(group.nounSpans||[])].sort((a,b)=>a.start-b.start || a.end-b.end);
    modifiers.forEach((m,j)=>{
      const indices=Array.isArray(m.indices)?m.indices:[m.start];
      if(j===0)return;
      for(const idx of indices)if(sources[idx]==='collected')suppressed.add(idx);
      if(j<maxPerNoun && j===1 && indices.some(idx=>sources[idx]==='collected')){
        secondaryModifierBonus+=2;
        secondaryModifiers.push({index:m.start,word:parseResult.tokens.slice(m.start,m.end).join(' '),bonus:2});
      }
    });
  }
  const credited = i=>Number.isInteger(i) && sources[i]==='collected' && !suppressed.has(i);
  // A syntactic bonus must be anchored by a collected word in the constituent
  // it purports to reward. This blocks e.g. "he is it because she is it" when
  // all its nouns/pronouns/auxiliaries are free helpers and only 'because' is found.
  function anchorIndices(n){
    const ans=new Set();
    function visit(x){
      if(!x || typeof x!=='object')return;
      for(const key of ['headIndex','verbIndex','temporalIndex','adverbIndex','prepositionIndex','degreeIndex']) {
        if(credited(x[key]))ans.add(x[key]);
      }
      for(const ch of x.children||[])visit(ch);
    }
    visit(n);return ans;
  }
  const feat=new Set();
  const rawFeatures=new Set(parseResult.features||[]);
  function earn(feature){if(rawFeatures.has(feature))feat.add(feature);}
  function visitEvents(n){
    if(!n||typeof n!=='object')return;
    const c=n.children||[];
    if(n.kind==='noun_phrase'){
      if(n.features.includes('relative_clause') && c.length===2 && anchorIndices(c[0]).size && anchorIndices(c[1]).size)earn('relative_clause');
      if(Array.isArray(n.modifierSpans) && n.modifierSpans.some(m=>credited(m.adjectiveIndex)))earn('adjective_modifier');
      if(c.length===2 && c.every(ch=>ch.kind==='noun_phrase') && c.every(ch=>anchorIndices(ch).size>0))earn('noun_coordination');
    }
    if(n.kind==='adjective' && credited(n.degreeIndex))earn('degree_modifier');
    if(n.kind==='prepositional_phrase' && (credited(n.prepositionIndex) || (c[0] && anchorIndices(c[0]).size>0)))earn('prepositional_phrase');
    if(n.kind==='predicate' && c[0]) {
      if(n.features.includes('predicate_adjective') && anchorIndices(c[0]).size)earn('predicate_adjective');
      if(n.features.includes('predicate_nominal') && anchorIndices(c[0]).size)earn('predicate_nominal');
      if(n.features.includes('predicate_prepositional') && anchorIndices(c[0]).size)earn('predicate_prepositional');
    }
    if(n.kind==='verb_phrase'){
      if(credited(n.adverbIndex))earn('verb_adverb');
      if(credited(n.temporalIndex))earn('temporal_modifier');
      if(Number.isInteger(n.verbIndex) && c.some(ch=>ch.kind==='noun_phrase' && anchorIndices(ch).size))earn('verb_object');
      if(c.length===2 && c.every(ch=>ch.kind==='verb_phrase') && c.every(ch=>anchorIndices(ch).size>0))earn('verb_coordination');
      if(Number.isInteger(n.verbIndex) && credited(n.verbIndex)) {
        if(n.features.includes('past_tense'))earn('past_tense');
        if(n.features.includes('infinitive') && c[0] && anchorIndices(c[0]).size)earn('infinitive');
        if(n.features.includes('complement_clause') && c[0] && anchorIndices(c[0]).size)earn('complement_clause');
        if(n.features.includes('ditransitive') && c.some(ch=>ch.kind==='noun_phrase' && anchorIndices(ch).size))earn('ditransitive');
      }
    }
    if(n.kind==='clause' && c.length===2 && c.every(ch=>ch.kind==='clause')){
      const linkAt=c[0].end;
      const bothAnchored=anchorIndices(c[0]).size>0 && anchorIndices(c[1]).size>0;
      if(bothAnchored){
        if(['and','or','but'].includes(parseResult.tokens[linkAt]))earn('clause_coordination');
        else earn('subordinate_clause');
      } else {
        // The subordinator itself must not score if it joins only free-helper text.
        if(credited(linkAt))suppressed.add(linkAt);
      }
    }
    if(n.kind==='finite_predicate'){
      if(anchorIndices(n).size){
        if(n.features.includes('negation'))earn('negation');
        if(n.features.includes('do_support'))earn('do_support');
        if(n.features.includes('possession') && c[0] && anchorIndices(c[0]).size)earn('possession');
      }
    }
    if(n.kind==='imperative' && anchorIndices(n).size){
      earn('imperative');
      if(c.length===2 && c[0].kind==='verb_phrase' && c[1].kind==='clause'
          && anchorIndices(c[0]).size && anchorIndices(c[1]).size)earn('subordinate_clause');
    }
    if(n.kind==='question' && anchorIndices(n).size)earn('question');
    for(const ch of c)visitEvents(ch);
  }
  visitEvents(parseResult.parse);
  const K=collectedIndices.filter(i=>!suppressed.has(i)).length;
  // Used even if feature appears repeatedly. An optional feature with no
  // collectible lexical anchor gets zero bonus.
  const rawBonus=Object.entries(FEATURE_BONUSES).filter(([k])=>feat.has(k)).map(([feature,points])=>({feature,points}));
  const constructionBonus=rawBonus.reduce((sum,x)=>sum+x.points,0);
  const distinctFamilies=DIVERSITY_FAMILIES.filter(k=>feat.has(k)).length;
  const diversityBonus=Math.min(8,Math.max(0,distinctFamilies-2)*2);
  const wordPoints=marginalWordPoints(K);
  // Complexity depends on *different* syntactic relationships, not sentence
  // length or the number of modifiers. Formula deliberately tunable/testable.
  const COMPLEXITY_UNITS={
    verb_object:1,adjective_modifier:.5,degree_modifier:.25,verb_adverb:.4,
    temporal_modifier:.6,prepositional_phrase:.8,subordinate_clause:2.7,
    complement_clause:2.3,clause_coordination:2.1,verb_coordination:1.1,
    noun_coordination:.35,predicate_adjective:.8,predicate_nominal:.5,
    predicate_prepositional:.6,negation:.6,question:1.3,ditransitive:1.2,
    infinitive:1.1,relative_clause:2.4,possession:.3,past_tense:.3
  };
  const complexityUnits=[...feat].reduce((a,k)=>a+(COMPLEXITY_UNITS[k]||0),0);
  const complexityMultiplier=1+Math.min(5.8,0.17*Math.pow(complexityUnits,1.55));
  const phraseScale=parseResult.parse.kind==='fragment'?.43:
                    parseResult.parse.kind==='ellipsis'?.62:1;
  const basePoints=wordPoints+constructionBonus+diversityBonus+secondaryModifierBonus;
  // Meaningful achievements are never worth zero, including short phrases.
  const score=K===0?0:Math.max(1,Math.round(basePoints*complexityMultiplier*phraseScale));
  return {
    valid:true, score,
    collectedWords,rawCollectedCount:rawK,creditedCollectedCount:K,
    collectedCount:rawK,
    discountedModifierWords:[...suppressed].sort((a,b)=>a-b).map(i=>parseResult.tokens[i]),
    secondaryModifierBonus,secondaryModifiers,maxAdjectivesPerNoun:maxPerNoun,
    helperUses:sources.filter(x=>x==='helper').length,
    wordPoints, constructionBonus, diversityBonus, basePoints, complexityUnits,complexityMultiplier,phraseScale,utteranceType:parseResult.parse.kind,
    featureBonuses:rawBonus,
    features:[...feat],
    nonCreditingParsedFeatures:[...rawFeatures].filter(f=>!feat.has(f)),
    marginalWordPoints:WORD_WEIGHTS.slice(0,K)
  };
}
// Used to stress-test an imagined wider grammar accepting arbitrarily long lists.
// Not derived from current parser: clearly flagged as synthetic structural oracle.
function scoreStructuralScenario({collectedCount,features=[],opaque=false,helperUses=0}) {
  if(opaque) return {valid:false,score:0,reason:'opaque quoted word dump is not scorable'};
  const feats=new Set(features);const wordPoints=marginalWordPoints(collectedCount);
  const bonus=Object.entries(FEATURE_BONUSES).reduce((a,[k,v])=>a+(feats.has(k)?v:0),0);
  const n=DIVERSITY_FAMILIES.filter(k=>feats.has(k)).length;
  const diversity=Math.min(8,Math.max(0,n-2)*2);
  return {valid:true,score:wordPoints+bonus+diversity,collectedCount,helperUses,wordPoints,constructionBonus:bonus,diversityBonus:diversity,features};
}
return {VERSION,scoreParse,scoreStructuralScenario,WORD_WEIGHTS,FEATURE_BONUSES,DIVERSITY_FAMILIES};
});

