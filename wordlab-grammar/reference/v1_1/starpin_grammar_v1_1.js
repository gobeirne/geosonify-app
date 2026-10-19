// Extracted verbatim from Starpin_Word_Lab_v1_1_Starpin.html for differential tests. Not modified.

/* Starpin experimental English grammar v0.2 (browser-compatible, no external runtime deps).
   IMPORTANT: deliberately bounded *subset* of English, not a general grammar checker.
   Source lexicon: Starpin BIP39 English grammar v0.1.
   Licence of underlying lexicon data requires review before publication.
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StarpinGrammarV02 = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '1.1.0-long-sentences-and-utterances';
  const HELPER_POS = {
    the: ['determiner'], a:['determiner'], an:['determiner'],
    is:['copula'], are:['copula'], was:['copula'], were:['copula'], be:['copula'],
    and:['coordinator'], or:['coordinator'], but:['coordinator'],
    not:['negator'], has:['possession'], does:['do_aux'], do:['do_aux'], did:['do_aux'],
    in:['preposition'], on:['preposition'], at:['preposition'], of:['preposition'],
    with:['preposition'], to:['infinitive','preposition'], from:['preposition'],
    for:['preposition'], by:['preposition'], without:['preposition'],
    some:['determiner'], every:['determiner'], each:['determiner'], many:['determiner'],
    no:['determiner'], my:['determiner'], his:['determiner'], their:['determiner'],
    he:['pronoun'], she:['pronoun'], it:['pronoun'], we:['pronoun'],
    i:['pronoun'], me:['pronoun'], them:['pronoun'],
    if:['subordinator'], while:['subordinator'],
    that:['determiner','relativizer'],who:['relativizer'],which:['determiner','relativizer'],
    too:['adverb'], so:['adverb'],
  };
  const SUBORDINATORS = new Set(['because','before','until','since','when','where','if','while']);
  const DEGREE_ADV = new Set(['barely','very','too','so','quite','rather','extremely','really']);
  const PREVERB_ADV = new Set(['barely','never','always','just','often','rarely','still','also','only','really','again','almost','already','easily','truly']);
  const TEMPORAL_ADV = new Set(['today','tonight','tomorrow','yesterday','later','now','soon','always','never','again','already','then','once','twice','ahead','alone','apart','away','easily','there','together','truly']);
  // Non-temporal manner, direction and place adverbs: distinct syntactic family.
  // This list is deliberately conservative; do not permit every listed adverb.
  const POSTVERBAL_ADV = new Set(['about','around','best','better','early','east','first','forward','hard','home','inside','left','next','north','off','outside','right','round','slow','south','west','wrong','online']);
  // English fused-head human-group adjectives: the sick, the wise, etc.
  // Do NOT add unrestricted adjective-as-noun readings (or indefinite a sick).
  const THE_HUMAN_GROUP_ADJECTIVES = new Set(['sick','wise','innocent','young','old','rich','blind']);
  const TRANSITIVE_PARTICLES = Object.freeze({squirrel:['away'], curtain:['off']});
  const CONNECTORS = new Set(['and','or','but']);
  // Only attested verbs may omit 'that' before a finite complement. Keep this
  // deliberately small: a blanket zero-'that' rule overaccepts English.
  const ZERO_THAT_COMPLEMENT = new Set(['ensure','say','think','know','believe','hope']);
  const MAX_SENTENCE_TOKENS = 256; // safety bound, not a game rule (longer inputs report resource limit)
  const MAX_PARSE_RESULTS_PER_STAGE = 160;
  const MAX_NP_MODIFIERS = 9; // combine adjectives, compound adjectives and attributive nouns
  const MAX_STEPS = 120000; // per-call computation budget; increases for long input
  // Lexical corrections are incorporated into the canonical lexicon JSON v0.7.
  // Do not shadow them with another hand-maintained override table.
  const LEXICAL_OVERRIDES = Object.freeze({});
  const norm = w => (typeof w === 'string' ? w.toLowerCase().trim() : '');
  function newNode(kind, end, children, features, number, extras) {
    return {kind, end, children: children || [], features: features || [], ...(number ? {number} : {}), ...(extras || {})};
  }
  function addFeat(children, extras) {
    const set = new Set(extras || []);
    for (const ch of children) for (const f of ch.features || []) set.add(f);
    return [...set];
  }
  function uniq(nodes) {
    const seen = new Set(); const out=[];
    for(const a of nodes) {
      if(!a || !Number.isInteger(a.end))continue;
      const key=a.end+'|'+a.kind+'|'+(a.number||'')+'|'+(a.features||[]).slice().sort().join(':');
      if(seen.has(key))continue;
      seen.add(key); out.push(a);
      if(out.length>=MAX_PARSE_RESULTS_PER_STAGE)break;
    }
    return out;
  }
  function createEngine(lexicon, options={}) {
    const rows = Array.isArray(lexicon) ? lexicon : lexicon.entries;
    if(!Array.isArray(rows) || rows.length!==2048) throw new Error('Expected complete 2,048-word BIP39 lexicon');
    const entries=new Map(rows.map(x=>[x.word,x]));
    const bip39=new Set(entries.keys());
    const lexical=new Map();
    for(const e of rows){
      const rs=e.readings.filter(r=>r.proposed_for_parser).map(r=>({pos:r.pos,attributes:r.attributes||{},confidence:r.confidence}));
      for(const extra of LEXICAL_OVERRIDES[e.word]||[]) {
        const existing=rs.find(r=>r.pos===extra.pos && (!extra.attributes.lemma || r.attributes.lemma===extra.attributes.lemma));
        if(existing && extra.pos==='verb') {
          existing.attributes.candidate_frames=[...new Set([...(existing.attributes.candidate_frames||[]),...(extra.attributes.candidate_frames||[])])];
        } else if (!existing)rs.push(extra);
      }
      lexical.set(e.word,rs);
    }
    function readings(w,pos){return (lexical.get(w)||[]).filter(r=>r.pos===pos);}
    function has(w,pos){return readings(w,pos).length>0 || (HELPER_POS[w]||[]).includes(pos);}
    function nounData(w){return readings(w,'noun').map(r=>r.attributes);}
    function pronounData(w){
      if (HELPER_POS[w]?.includes('pronoun')) {
        const d={i:[1,'singular','subject'],me:[1,'singular','object'],we:[1,'plural','subject'],them:[3,'plural','object'],he:[3,'singular','subject'],she:[3,'singular','subject'],it:[3,'singular','subject_or_object']}[w];
        return d ? [{person:d[0],number:d[1],case:d[2]}]:[];
      }
      return readings(w,'pronoun').map(r=>r.attributes);
    }
    function parse(input, opts={}) {
      const raw=Array.isArray(input) ? input.map(t=>typeof t==='string'?t:t.word) : String(input).replace(/[.!?]+\s*$/,'').split(/\s+/);
      const words=raw.map(norm).filter(Boolean), N=words.length;
      const helpers=new Set((opts.helpers||[]).map(norm));
      const owned=new Set((opts.owned||[]).map(norm));
      const requireOwned=opts.requireOwned!==false;
      const limit=Math.min(MAX_SENTENCE_TOKENS, Math.max(1, Number(opts.maxTokens)||MAX_SENTENCE_TOKENS));
      const unavailable=words.filter(w=>!bip39.has(w) && !helpers.has(w));
      const notOwned=requireOwned ? words.filter(w=>bip39.has(w) && !owned.has(w) && !helpers.has(w)) : [];
      const tokenTypes=Array.isArray(opts.tokenTypes)?opts.tokenTypes:null;
      if (tokenTypes && tokenTypes.length!==N) return {valid:false,reason:'token_type_length_mismatch',tokens:words};
      const unrecognized=words.filter(w=>!bip39.has(w) && !Object.hasOwn(HELPER_POS,w));
      if(N===0)return {valid:false,reason:'empty_sentence',tokens:words};
      if(N>limit)return {valid:false,reason:'analysis_resource_limit',tokens:words,limit};
      if(unrecognized.length)return {valid:false,reason:'unknown_word',words:[...new Set(unrecognized)],tokens:words};
      if(unavailable.length)return {valid:false,reason:'helper_not_unlocked',words:[...new Set(unavailable)],tokens:words};
      if(notOwned.length)return {valid:false,reason:'collected_word_not_available',words:[...new Set(notOwned)],tokens:words};
      if (tokenTypes) {
        const ct=new Set(),ht=new Set();
        for(let i=0;i<N;i++) {
          const t=tokenTypes[i],w=words[i];
          if(t==='helper'){if(!helpers.has(w))return {valid:false,reason:'helper_not_unlocked',words:[w],tokens:words};ht.add(w);}
          else if(t==='collected'){
            if(!bip39.has(w)||!owned.has(w))return {valid:false,reason:'collected_word_not_available',words:[w],tokens:words};
            if(ct.has(w))return {valid:false,reason:'duplicate_collected_word',words:[w],tokens:words};
            ct.add(w);
          } else return {valid:false,reason:'unknown_tile_type',tokens:words};
        }
      } else if (requireOwned) {
        // Even without tile provenance, no collected BIP39 word can occur twice unless its helper is unlocked.
        const counts={};
        for(const w of words){
          if(!bip39.has(w))continue;
          counts[w]=(counts[w]||0)+1;
          if(counts[w]>1 && !helpers.has(w)) return {valid:false,reason:'duplicate_collected_word',words:[w],tokens:words};
        }
      }
      let steps=0, maxSteps=Math.max(1000,Math.min(700000,Number(opts.maxSteps)||MAX_STEPS+N*1500));
      function tick(){steps++;if(steps>maxSteps)throw new Error('parse_budget_exceeded');}
      const memo=new Map(), chart=[];
      function cached(key,fn){
        tick();if(memo.has(key))return memo.get(key);
        const out=uniq(fn());memo.set(key,out);
        // Memoized phrases form a partial parse chart, retained even if the
        // complete sentence has no parse. Diagnostic candidates use actual ASTs,
        // not made-up constituent trees.
        const match=/^[a-z]+:(\d+)/.exec(key);
        if(match){const start=Number(match[1]);for(const node of out){
          if(node.end>start && node.end<=N && chart.length<8000)
            chart.push({start,end:node.end,kind:node.kind,node});
        }}
        return out;
      }
      function allowed(w){return bip39.has(w)||helpers.has(w);}
      function wordIs(i,w){return words[i]===w && allowed(w);}
      function is(i,p){return i<N && allowed(words[i]) && has(words[i],p);}
      function compatibleDet(d,attr){
        const num=attr.number||'singular',ct=attr.countability||'count_provisional';
        const singular=num==='singular'||num==='singular_or_plural';
        const plural=num==='plural'||num==='singular_or_plural'||num==='either';
        const mass=ct==='mass'||ct==='uncountable'; // count_and_mass supports both 'a chat' and bare 'chat'
        if(d==='a'||d==='an'||d==='another'||d==='each'||d==='every'||d==='this'||d==='that')return singular && !mass;
        if(d==='many'||d==='few')return plural;
        if(d==='much')return mass;
        if(d==='all')return plural||mass;
        if(readings(d,'numeral').length)return d==='one'?singular&&!mass:plural;
        return true;
      }
      function agrees(sub, cop){
        // 'you' is 2nd person even when singular; copular present requires are.
        if(sub.person===1 && sub.number==='singular')return cop==='was'; // 'am' not supported in this version
        if(sub.person===2)return cop==='are'||cop==='were';
        if(sub.number==='singular')return cop==='is'||cop==='was';
        return cop==='are'||cop==='were';
      }
      function detAt(i){return is(i,'determiner')? [{end:i+1,word:words[i]}]:[];}
      function adjSpan(i,usage='attributive'){
        return cached('adj:'+i+':'+usage,()=>{
          const usable=(at)=>readings(at,'adjective').some(r=>{
            const p=r.attributes.position||'attributive_and_predicative_provisional';
            return usage==='attributive'?p!=='predicative_only':p!=='attributive_only';
          });
          let res=[];
          // Two independently collected tiles form a productive hyphenated
          // modifier. The display supplies punctuation; both tiles stay distinct.
          if(words[i]==='half' && words[i+1]==='human' && usable('human'))
            res.push(newNode('adjective',i+2,[],['compound_adjective'],null,{head:'half-human',headIndex:i+1,compound:true}));
          if(i<N && usable(words[i]))res.push(newNode('adjective',i+1,[],[],null,{head:words[i],headIndex:i}));
          if(i+1<N && DEGREE_ADV.has(words[i]) && is(i,'adverb') && usable(words[i+1]))
            res.push(newNode('adjective',i+2,[],['degree_modifier'],null,{head:words[i+1],headIndex:i+1,degreeIndex:i}));
          return res;
        });
      }
      function nounAt(i,det){
        // Noun phrases can have interleaved ordinary adjectives, compound
        // adjectives and *noun* adjuncts. "the garden fence", "autumn jeans",
        // "half-human hybrid cat stairs" are not three missing adjective
        // dictionary entries. All these patterns use the same productive rule.
        const out=[];
        let frontier=[{end:i,features:[],modifierSpans:[],nounModifierSpans:[],adjCount:0,nounCount:0}];
        for(let modifierCount=0;modifierCount<=MAX_NP_MODIFIERS && frontier.length;modifierCount++){
          const next=[];
          for(const st of frontier){
            const k=st.end;
            if(is(k,'noun'))for(const nd of nounData(words[k])){
              if(det && !compatibleDet(det,nd))continue;
              if(!det && !['plural','singular_or_plural'].includes(nd.number) &&
                  !['mass','count_and_mass','uncountable'].includes(nd.countability) && !nd.proper_name_reading) continue;
              if(det==='a'||det==='an'){
                const first=words[i]||words[k],onset=entries.get(first)?.pronunciation_onset?.class;
                if(onset && onset!=='mixed' && (det==='an')!==(onset==='vowel'))continue;
              }
              const number=(det==='all'||det==='many'||det==='few')?'plural':nd.number==='singular_or_plural'?'either':nd.number||'singular';
              out.push(newNode('noun_phrase',k+1,[],st.features,number,
                {countability:nd.countability,head:words[k],headIndex:k,
                 modifierSpans:st.modifierSpans,nounModifierSpans:st.nounModifierSpans,person:3}));
            }
            if(modifierCount===MAX_NP_MODIFIERS || k>=N-1)continue;
            // Attribute noun modifiers must be followed by a final head noun
            // (or another modifier). This does NOT licence a bare singular
            // count noun as a complete noun phrase.
            if(st.adjCount<7)for(const a of adjSpan(k,'attributive')){
              next.push({...st,end:a.end,adjCount:st.adjCount+1,
                features:[...new Set([...st.features,...(a.features||[]),'adjective_modifier'])],
                modifierSpans:[...st.modifierSpans,
                  {start:k,end:a.end,adjectiveIndex:a.headIndex,
                   degreeIndex:a.degreeIndex??null,compound:!!a.compound}]});
            }
            if(st.nounCount<5 && is(k,'noun')){
              next.push({...st,end:k+1,nounCount:st.nounCount+1,
                features:[...new Set([...st.features,'noun_compound'])],
                nounModifierSpans:[...st.nounModifierSpans,{start:k,end:k+1}]});
            }
          }
          const seen=new Set();frontier=[];
          // Never let the modifier combinatorics consume the parse budget.
          for(const st of next){
            const id=[st.end,st.adjCount,st.nounCount,st.features.slice().sort().join(','),
              st.modifierSpans.map(m=>m.start+':'+m.end).join('/')].join('|');
            if(seen.has(id))continue;
            seen.add(id);frontier.push(st);
            if(frontier.length>=160)break;
          }
        }
        return uniq(out);
      }
      function prepAt(i,depth){
        return cached('pp:'+i+':'+depth,()=>{
          if(!is(i,'preposition') && !(['in','on','at','of','to','with','by','from','for','without'].includes(words[i])&&allowed(words[i])))return [];
          let out=[];
          for(const obj of npAt(i+1,'object',depth+1,true))out.push(newNode('prepositional_phrase',obj.end,[obj],addFeat([obj],['prepositional_phrase']),null,{prepositionIndex:i}));
          return out;
        });
      }
      function npAt(i,role='subject',depth=0,allowExpand=true){
        if(depth>12)return [];
        return cached('np:'+i+':'+role+':'+depth+':'+allowExpand,()=>{
          let out=[];
          if(i>=N)return out;
          for(const rd of pronounData(words[i])){
            const c=rd.case||'subject_or_object';
            if((role==='subject' && c==='object')||(role==='object' && c==='subject'))continue;
            out.push(newNode('noun_phrase',i+1,[],[],rd.number==='either'?'singular_or_plural':rd.number||'singular',{head:words[i],headIndex:i,person:rd.person||3}));
          }
          // Restricted 'the + adjective' functioning as a plural human-group NP.
          // 'the sick can retire' is NOT evidence that 'sick' is a count noun.
          if(wordIs(i,'the') && THE_HUMAN_GROUP_ADJECTIVES.has(words[i+1]) && is(i+1,'adjective'))
            out.push(newNode('noun_phrase',i+2,[],['determiner','fused_head_adjective'],'plural',
              {head:words[i+1],headIndex:i+1,person:3,fusedHead:true}));
          for(const nd of nounAt(i,null))out.push(nd);
          for(const det of detAt(i))for(const nd of nounAt(det.end,det.word))out.push(newNode('noun_phrase',nd.end,[nd],addFeat([nd],['determiner']),nd.number,{head:nd.head,person:3}));
          if(is(i,'numeral'))for(const nd of nounAt(i+1,words[i]))out.push(newNode('noun_phrase',nd.end,[nd],addFeat([nd],['numeral_determiner']),words[i]==='one'?'singular':'plural',{head:nd.head,person:3}));
          if(allowExpand){
            const basics=[...out];
            for(const np of basics){
              if(depth<=9){
                for(const pp of prepAt(np.end,depth+1))out.push(newNode('noun_phrase',pp.end,[np,pp],addFeat([np,pp]),np.number,{head:np.head,person:np.person}));
              }
              if(CONNECTORS.has(words[np.end]) && allowed(words[np.end])){
                for(const other of npAt(np.end+1,'object',depth+1,false))out.push(newNode('noun_phrase',other.end,[np,other],addFeat([np,other],['noun_coordination']),'plural',{person:3}));
              }
              // Subject-relative clauses: "the cat that can chase the dog".
              // The following finite predicate agrees with the noun being modified.
              // This does not invent an unrestricted relative object-gap parser.
              if(depth<=7 && ['that','who','which'].includes(words[np.end]) && allowed(words[np.end])){
                for(const pred of finiteVPAt(np.end+1,np,depth+1))
                  out.push(newNode('noun_phrase',pred.end,[np,pred],addFeat([np,pred],['relative_clause']),np.number,
                    {head:np.head,person:np.person,headIndex:np.headIndex,relativeMarker:np.end}));
              }
            }
          }
          return out;
        });
      }
      function baseVerbAt(i){
        const out=[];
        if(!is(i,'verb'))return out;
        for(const r of readings(words[i],'verb')){
          if(!(r.attributes.surface_forms||[]).includes('base'))continue;
          const fs=r.attributes.candidate_frames||[];
          for(const f of fs)out.push({frame:f,word:words[i],end:i+1,requiredPreps:r.attributes.requires_particle_or_preposition||[]});
        }
        return out;
      }
      function bareVPAt(i,depth=0,allowCoord=true){
        if(depth>10)return [];
        return cached('bare:'+i+':'+depth+':'+allowCoord,()=>{
          let out=[];
          let starts=[{end:i,features:[]}];
          if(i<N && PREVERB_ADV.has(words[i]) && is(i,'adverb'))starts.push({end:i+1,features:['verb_adverb']});
          for(const st of starts){
            for(const b of baseVerbAt(st.end)){
              if(b.frame==='intransitive')out.push(newNode('verb_phrase',b.end,[],st.features,null,{verbIndex:st.end,adverbIndex:st.end>i?i:null}));
              if(b.frame==='prepositional_object' && b.requiredPreps.includes(words[b.end]) && allowed(words[b.end])){
                for(const obj of npAt(b.end+1,'object',depth+1,true))
                  out.push(newNode('verb_phrase',obj.end,[obj],addFeat([obj],st.features.concat('required_prepositional_object')),null,{verbIndex:st.end}));
              }

              if(b.frame==='transitive'){
                const particles=TRANSITIVE_PARTICLES[b.word]||[];
                if(particles.includes(words[b.end]) && allowed(words[b.end]))
                  for(const obj of npAt(b.end+1,'object',depth+1,true))
                    out.push(newNode('verb_phrase',obj.end,[obj],addFeat([obj],st.features.concat('phrasal_transitive')),null,{verbIndex:st.end}));

                for(const obj of npAt(b.end,'object',depth+1,true))out.push(newNode('verb_phrase',obj.end,[obj],addFeat([obj],st.features.concat('verb_object')),null,{verbIndex:st.end,adverbIndex:st.end>i?i:null}));
                for(const obj of npAt(b.end,'object',depth+1,true))
                  if(particles.includes(words[obj.end]) && allowed(words[obj.end]))
                    out.push(newNode('verb_phrase',obj.end+1,[obj],addFeat([obj],st.features.concat('phrasal_transitive')),null,{verbIndex:st.end}));

                // Small explicitly documented speech formula (not open quotation
                // or permission to concatenate opaque words for points).
                if(b.word==='say' && is(b.end,'interjection') && ['hello','please','okay'].includes(words[b.end]))
                  out.push(newNode('verb_phrase',b.end+1,[newNode('interjection',b.end+1,[],[],null,{headIndex:b.end,head:words[b.end]})],st.features.concat('speech_formula'),null,{verbIndex:st.end}));
              }
              if(b.frame==='copular'){
                // Taste/smell/feel/sound can link to a predicative ADJECTIVE.
                // They do not share the unrestricted nominal/PP complements of
                // 'be'. E.g. "taste sweet" versus transitive "taste stairs".
                for(const adj of adjSpan(b.end,'predicative')){
                  const pred=newNode('predicate',adj.end,[adj],addFeat([adj],['predicate_adjective']));
                  out.push(newNode('verb_phrase',pred.end,[pred],addFeat([pred],st.features.concat('lexical_copula')),null,{verbIndex:st.end,adverbIndex:st.end>i?i:null}));
                }
              }
              if(b.frame==='ditransitive'){
                for(const indirect of npAt(b.end,'object',depth+1,false)){
                  for(const direct of npAt(indirect.end,'object',depth+1,true))
                    out.push(newNode('verb_phrase',direct.end,[indirect,direct],addFeat([indirect,direct],st.features.concat('ditransitive','verb_object')),null,{verbIndex:st.end,adverbIndex:st.end>i?i:null}));
                }
              }
              if(b.frame==='to_infinitive_complement'&&wordIs(b.end,'to')){
                for(const vp of bareVPAt(b.end+1,depth+1,false))out.push(newNode('verb_phrase',vp.end,[vp],addFeat([vp],st.features.concat('infinitive')),null,{verbIndex:st.end,adverbIndex:st.end>i?i:null}));
              }
              if(b.frame==='finite_clause_complement'){
                // English permits zero-'that' complements after selected verbs,
                // e.g. 'ensure [the dose can predict ...]'. The overt form
                // 'ensure that [the dose can predict ...]' remains supported.
                const starts=[];
                if(wordIs(b.end,'that'))starts.push(b.end+1);
                if(ZERO_THAT_COMPLEMENT.has(b.word))starts.push(b.end);
                for(const clauseStart of starts){
                  for(const cl of clauseAt(clauseStart,depth+1,false))
                    out.push(newNode('verb_phrase',cl.end,[cl],addFeat([cl],st.features.concat('complement_clause')),null,{verbIndex:st.end,adverbIndex:st.end>i?i:null}));
                }
              }
            }
          }
          const basics=[...out];
          const extended=[];
          for(const vp of basics){
            if(depth<=9){
              for(const pp of prepAt(vp.end,depth+1))extended.push(newNode('verb_phrase',pp.end,[vp,pp],addFeat([vp,pp])));
              if(TEMPORAL_ADV.has(words[vp.end]) && is(vp.end,'adverb'))extended.push(newNode('verb_phrase',vp.end+1,[vp],addFeat([vp],['temporal_modifier']),null,{temporalIndex:vp.end}));
              if(POSTVERBAL_ADV.has(words[vp.end]) && is(vp.end,'adverb'))
                extended.push(newNode('verb_phrase',vp.end+1,[vp,newNode('adverbial',vp.end+1,[],['postverbal_modifier'],null,{headIndex:vp.end,head:words[vp.end]})],addFeat([vp],['postverbal_modifier'])));
            }
          }
          out.push(...extended);
          if(allowCoord && depth<=9) {
            for(const vp of [...basics,...extended]){
              if(wordIs(vp.end,'and')) {
                for(const vp2 of bareVPAt(vp.end+1,depth+1,false))out.push(newNode('verb_phrase',vp2.end,[vp,vp2],addFeat([vp,vp2],['verb_coordination'])));
              }
            }
          }
          return out;
        });
      }
      function pastVPAt(i,depth=0){
        return cached('past:'+i+':'+depth,()=>{
          let out=[];
          if(!is(i,'verb'))return out;
          for(const r of readings(words[i],'verb')){
            if(!(r.attributes.surface_forms||[]).includes('past'))continue;
            for(const f of r.attributes.candidate_frames||[]){
              if(f==='intransitive')out.push(newNode('verb_phrase',i+1,[],['past_tense'],null,{verbIndex:i}));
              if(f==='transitive')for(const obj of npAt(i+1,'object',depth+1,true))out.push(newNode('verb_phrase',obj.end,[obj],addFeat([obj],['past_tense','verb_object']),null,{verbIndex:i}));
            }
          }
          return out;
        });
      }
      function predAt(i,depth=0){
        let out=[];
        for(const ad of adjSpan(i,'predicative'))out.push(newNode('predicate',ad.end,[ad],addFeat([ad],['predicate_adjective'])));
        for(const np of npAt(i,'object',depth+1,true))out.push(newNode('predicate',np.end,[np],addFeat([np],['predicate_nominal'])));
        for(const pp of prepAt(i,depth+1))out.push(newNode('predicate',pp.end,[pp],addFeat([pp],['predicate_prepositional'])));
        return uniq(out);
      }
      function finiteVPAt(i,sub,depth=0){
        if(depth>9)return [];
        return cached('finite:'+i+':'+sub.number+':'+sub.person+':'+depth,()=>{
          let out=[];
          if(i>=N)return out;
          if(is(i,'modal')){
            const k=wordIs(i+1,'not')?i+2:i+1;
            const neg=k!==i+1;
            for(const vp of bareVPAt(k,depth+1,true))out.push(newNode('finite_predicate',vp.end,[vp],addFeat([vp],['modal',...(neg?['negation']:[])])));
            if(wordIs(k,'be'))for(const pred of predAt(k+1,depth+1))out.push(newNode('finite_predicate',pred.end,[pred],addFeat([pred],['modal','copula',...(neg?['negation']:[])])));
          }
          if(['is','are','was','were'].includes(words[i]) && allowed(words[i]) && agrees(sub,words[i])){
            const neg=wordIs(i+1,'not');
            for(const pred of predAt(i+1+(neg?1:0),depth+1))out.push(newNode('finite_predicate',pred.end,[pred],addFeat([pred],['copula',...(neg?['negation']:[]),...(['was','were'].includes(words[i])?['past_tense']:[])])));
          }
          if(['do','does','did'].includes(words[i]) && allowed(words[i])){
            const good=words[i]==='did'||(words[i]==='does' && sub.number==='singular' && sub.person===3)||(words[i]==='do' && (sub.number!=='singular'||sub.person===2||sub.person===1));
            if(good){const neg=wordIs(i+1,'not');
              for(const vp of bareVPAt(i+1+(neg?1:0),depth+1,true))out.push(newNode('finite_predicate',vp.end,[vp],addFeat([vp],['do_support',...(neg?['negation']:[])])));}
          }
          if(wordIs(i,'has') && sub.number==='singular' && sub.person===3){
            for(const obj of npAt(i+1,'object',depth+1,true))out.push(newNode('finite_predicate',obj.end,[obj],addFeat([obj],['possession'])));
          }
          if(sub.number!=='singular'||sub.person===2||sub.person===1) {
            for(const vp of bareVPAt(i,depth+1,true))out.push(newNode('finite_predicate',vp.end,[vp],addFeat([vp],['present_tense'])));
          }
          for(const vp of pastVPAt(i,depth+1))out.push(newNode('finite_predicate',vp.end,[vp],addFeat([vp])));
          return out;
        });
      }
      function clauseAt(i,depth=0,allowLinks=true){
        if(depth>9)return [];
        return cached('clause:'+i+':'+depth+':'+allowLinks,()=>{
          let out=[];
          for(const subj of npAt(i,'subject',depth+1,true)) {
            for(const pred of finiteVPAt(subj.end,subj,depth+1))
              out.push(newNode('clause',pred.end,[subj,pred],addFeat([subj,pred]),null,{subject:subj.head}));
          }
          if(allowLinks){
            const basics=out.slice();
            // Iteratively assemble multiple clauses. A single 'and' should not
            // be a grammatical ceiling, but each join must add a full clause.
            let frontier=basics;
            for(let join=0;join<20 && frontier.length;join++){
              const nextFrontier=[];
              for(const cl of frontier){
                if(SUBORDINATORS.has(words[cl.end]) && allowed(words[cl.end])){
                  for(const next of clauseAt(cl.end+1,depth+1,false))nextFrontier.push(newNode('clause',next.end,[cl,next],addFeat([cl,next],['subordinate_clause'])));
                }
                if(CONNECTORS.has(words[cl.end]) && allowed(words[cl.end])){
                  for(const next of clauseAt(cl.end+1,depth+1,false))nextFrontier.push(newNode('clause',next.end,[cl,next],addFeat([cl,next],['clause_coordination'])));
                }
              }
              frontier=uniq(nextFrontier);out.push(...frontier);
            }
          }
          return out;
        });
      }
      function makeDiagnostic(){
        // An explanation of OUR parser's current coverage, not a grammaticality
        // verdict. Parsed fragments are genuine AST constituents from chart.
        // Ask for phrase islands only on failure, protecting the normal path.
        for(let i=0;i<N && steps<Math.min(maxSteps-250,20000);i++){
          try {npAt(i,'object',0,false);bareVPAt(i,0,false);} catch(_){break;}
        }
        const ranks={clause:7,imperative:7,question:7,finite_predicate:6,
          verb_phrase:5,noun_phrase:4,prepositional_phrase:3,predicate:3,adjective:2};
        const viable=chart.filter(x=>x.end>x.start && x.start>=0 && x.end<=N);
        const byStart=new Map();for(const sp of viable){
          if(!byStart.has(sp.start))byStart.set(sp.start,[]);
          byStart.get(sp.start).push(sp);
        }
        const choose=list=>(list||[]).slice().sort((a,b)=>
           (b.end-b.start)-(a.end-a.start)||
           (ranks[b.kind]||0)-(ranks[a.kind]||0))[0];
        const prefix=choose(byStart.get(0));
        const fragments=[];let i=0;
        while(i<N && fragments.length<22){
          const fragment=choose(byStart.get(i));
          if(fragment){fragments.push({...fragment,recognized:true});i=fragment.end;}
          else {fragments.push({start:i,end:i+1,kind:'unresolved',recognized:false});i++;}
        }
        const issueIndex=Math.max(0,Math.min(prefix?.end||0,N-1));
        const around=words[issueIndex];
        const roles=w=>{
          const labels=[...(lexical.get(w)||[]).map(r=>r.pos),...(HELPER_POS[w]||[])];
          return [...new Set(labels)].filter(Boolean);
        };
        let summary='',detail='',hint='';
        const pluralCopulas=new Set(['are','were']);
        const singularCopulas=new Set(['is','was']);
        // Agreement failure is a high-confidence explanation: no valid branch
        // can match a singular subject to 'are', or a plural subject to 'is'.
        const npPrefix=(byStart.get(0)||[]).filter(x=>x.kind==='noun_phrase').sort((a,b)=>b.end-a.end)[0];
        if(npPrefix && npPrefix.end<N && (pluralCopulas.has(words[npPrefix.end])||singularCopulas.has(words[npPrefix.end]))){
          const cop=words[npPrefix.end],num=npPrefix.node.number;
          if((num==='singular' && pluralCopulas.has(cop))||(num==='plural'&&singularCopulas.has(cop))){
            summary='Possible subject–verb agreement problem near “'+cop+'”.';
            detail='I read “'+words.slice(0,npPrefix.end).join(' ')+'” as a '+num+' noun phrase, but “'+cop+'” normally agrees with a '+(num==='singular'?'plural':'singular')+' subject.';
            hint='Try an agreeing form, or check whether the intended subject has a different number.';
          }
        }
        // High-confidence failure classes before giving a general chart-frontier
        // explanation. Never infer grammaticality from a single POS label.
        if(!summary)for(let k=0;k<N-1;k++){
          if(!['a','an'].includes(words[k]))continue;
          const next=words[k+1],onset=entries.get(next)?.pronunciation_onset?.class;
          if(onset && onset!=='mixed' && (words[k]==='an')!==(onset==='vowel')){
            summary='Possible article mismatch: “'+words[k]+' '+next+'”.';
            detail='The first pronounced word after this article starts with a '+(onset==='vowel'?'vowel':'consonant')+' sound, so my article rule expects “'+(onset==='vowel'?'an':'a')+'”.';
            hint='The decision depends on sound, not spelling (for example, “an hour” and “a uniform”).';
            return {summary,detail,hint,issueIndex:k,parsedUpTo:prefix?.end||0,
              fragments,wordRoles:roles(words[k]),confidence:'phonological_rule'};
          }
        }
        const modalSubject=(byStart.get(0)||[]).filter(x=>x.kind==='noun_phrase' &&
          x.end<N && is(x.end,'modal')).sort((a,b)=>b.end-a.end)[0];
        if(!summary && (modalSubject||npPrefix) && (modalSubject||npPrefix).end<N){
          const pos=(modalSubject||npPrefix).end,word=words[pos];
          const after=words[pos+1];
          if(is(pos,'modal') && (pos+1===N || !is(pos+1,'verb') && !wordIs(pos+1,'be') &&
             !PREVERB_ADV.has(after))){
            summary='After “'+word+'” I expect a base-form verb phrase.';
            detail='I recognise “'+words.slice(0,pos).join(' ')+'” as a subject. “'+word+'” can be a modal, but I cannot recognise a base verb phrase after it'+(after?' starting at “'+after+'”':' because the sentence ends')+'.';
            hint=after?'“'+after+'” is labelled '+(roles(after).join(' / ')||'unknown')+' in the current lexicon.':'The sentence needs a predicate to be complete.';
            const modalFragments=[{...modalSubject,recognized:true}];
            for(let t=modalSubject.end;t<N;t++)modalFragments.push({start:t,end:t+1,kind:'unresolved',recognized:false});
            return {summary,detail,hint,issueIndex:Math.min(pos+1,N-1),parsedUpTo:modalSubject.end,
              fragments:modalFragments,wordRoles:roles(after||word),confidence:'parser_supported_modal_frame'};
          }
          if(['is','are','was','were'].includes(word) && pos+1>=N){
            summary='“'+word+'” needs a complement here.';
            detail='I recognise the preceding noun phrase as the subject, but a copula normally needs something after it: an adjective, a noun phrase or a prepositional phrase.';
            hint='For example, “is nice”, “is a cat”, or “is in the garden”.';
            return {summary,detail,hint,issueIndex:pos,parsedUpTo:prefix?.end||0,
              fragments,wordRoles:roles(word),confidence:'parser_supported_copular_frame'};
          }
        }
        if(!summary && N===1 && is(0,'verb')){
          const rs=readings(words[0],'verb').filter(r=>(r.attributes.surface_forms||[]).includes('base'));
          const transitive=rs.some(r=>(r.attributes.candidate_frames||[]).includes('transitive'));
          const intransitive=rs.some(r=>(r.attributes.candidate_frames||[]).includes('intransitive'));
          if(transitive && !intransitive){
            summary='“'+words[0]+'” is listed as a transitive verb here, but there is no object.';
            detail='This lexicon currently licenses “'+words[0]+'” followed by a noun phrase, not an objectless imperative.';
            hint='That is a restriction of the documented reading, not a claim about every possible dialect or rare use.';
            return {summary,detail,hint,issueIndex:0,parsedUpTo:0,fragments,
              wordRoles:roles(words[0]),confidence:'lexicon_verb_frame'};
          }
        }
        if(!summary && prefix){
          const labels={imperative:'imperative',clause:'clause',noun_phrase:'noun phrase',verb_phrase:'verb phrase',finite_predicate:'verb phrase',prepositional_phrase:'prepositional phrase'};
          const prefixText=words.slice(0,prefix.end).join(' ');
          if(prefix.end<N){
            summary='I can analyse “'+prefixText+'” as a '+(labels[prefix.kind]||'phrase')+', but I cannot complete the sentence from “'+around+'”.';
            const needed=prefix.kind==='noun_phrase'?'a finite verb phrase':
              prefix.kind==='verb_phrase' && CONNECTORS.has(around)?'another verb phrase after the coordinator':
              prefix.kind==='imperative' && SUBORDINATORS.has(around)?'a finite dependent clause':
              'a continuation consistent with this construction';
            detail='At “'+around+'” I expected '+needed+' but could not build one. This only identifies the current parser’s limit; it does not establish that this word order is wrong in English.';
          }else{
            summary='I recognised the words as a phrase, but not as a complete sentence.';
            detail='The phrase structure I found does not satisfy any complete sentence pattern in this version.';
          }
        }
        if(!summary){
          summary='I could not find a complete sentence structure starting at “'+words[0]+'”.';
          detail='The partial tree shows any smaller phrases that I could recognise. A missing grammar rule is one possible explanation.';
        }
        const nearRoles=roles(around);
        if(!hint){
          hint=nearRoles.length?'“'+around+'” is currently labelled '+nearRoles.join(' / ')+'. Check the partial tree below to see what combined successfully.':'I have no enabled grammatical reading for “'+around+'” at this position.';
        }
        return {summary,detail,hint,issueIndex,parsedUpTo:prefix?.end||0,
          fragments,wordRoles:nearRoles,confidence:'parser_diagnostic_not_english_grammar_verdict'};
      }
      try {
        const parses=[...clauseAt(0,0,true)];
        if(SUBORDINATORS.has(words[0]) && allowed(words[0])){
          for(const leading of clauseAt(1,1,false)){
            for(const main of clauseAt(leading.end,1,true))
              parses.push(newNode('clause',main.end,[leading,main],addFeat([leading,main],['subordinate_clause'])));
          }
        }
        for(const vp of bareVPAt(0,0,true)){
          parses.push(newNode('imperative',vp.end,[vp],addFeat([vp],['imperative'])));
          // Reasons, conditions and time clauses can modify imperatives:
          // "Clean the festival because the jeans know salad."
          if(SUBORDINATORS.has(words[vp.end]) && allowed(words[vp.end])){
            for(const dependent of clauseAt(vp.end+1,1,false))
              parses.push(newNode('imperative',dependent.end,[vp,dependent],
                addFeat([vp,dependent],['imperative','subordinate_clause'])));
          }
        }
        // Polar questions invert the modal and subject ("Can the cat chat?").
        if(is(0,'modal')){
          for(const subject of npAt(1,'subject',0,true)){
            for(const vp of bareVPAt(subject.end,0,true))
              parses.push(newNode('question',vp.end,[subject,vp],addFeat([subject,vp],['question','modal'])));
          }
        }
        // Limited locative wh-questions: where [else] + modal + subject + base verb phrase.
        if(wordIs(0,'where')) {
          const headEnd=wordIs(1,'else')?2:1;
          if(is(headEnd,'modal'))for(const subject of npAt(headEnd+1,'subject',0,true)) {
            for(const vp of bareVPAt(subject.end,0,true))
              parses.push(newNode('question',vp.end,[subject,vp],addFeat([subject,vp],['question','modal'])));
          }
        }
        // English also has felicitous standalone nominal utterances (captions,
        // answers, titles) and context-dependent VP ellipsis after a modal.
        // They are explicitly typed: neither is an ordinary complete clause,
        // and the scoring engine gives them a smaller structural reward.
        for(const np of npAt(0,'subject',0,true)){
          if(np.end===N)parses.push(newNode('fragment',N,[np],addFeat([np],['nominal_utterance']),null,{utteranceType:'nominal'}));
          if(np.end===N-1 && is(np.end,'modal'))
            parses.push(newNode('ellipsis',N,[np],addFeat([np],['modal_ellipsis']),null,{modalIndex:np.end,utteranceType:'context_required'}));
        }
        const complete=parses.filter(p=>p.end===N);
        // Choose the best analysis, not just any accepted structure.
        // A word that really can be an adjective (e.g. "favorite") should
        // ordinarily be treated as Adj before a noun, not as an exotic noun
        // adjunct merely to add a distinct feature bonus. This is a lexical
        // preference, NOT a restriction on whether the phrase is accepted.
        function parsePlausibility(root){
          let penalty=0;
          function visit(node){
            if(node.kind==='noun_phrase' && Array.isArray(node.nounModifierSpans)){
              for(const span of node.nounModifierSpans){
                if(readings(words[span.start],'adjective').some(r=>r.attributes.position!=='predicative_only'))penalty+=3;
              }
            }
            for(const child of node.children||[])visit(child);
          }
          visit(root);return penalty;
        }
        const scoreStruct=p=>p.features.length*2 + (p.kind==='question'?9:p.kind==='clause'?4:p.kind==='imperative'?3:p.kind==='ellipsis'?-3:p.kind==='fragment'?-4:0)
           + (p.features.includes('adjective_modifier')?0.3:0)
           - (p.features.includes('noun_compound')?0.1:0)
           - (p.features.includes('lexical_copula')?0.2:0)
           - parsePlausibility(p);
        complete.sort((a,b)=>scoreStruct(b)-scoreStruct(a)||a.features.join(',').localeCompare(b.features.join(',')));
        const best=complete[0];
        if(!best) {
          const maxEnd=Math.max(0,...parses.map(p=>p.end));
          const diagnostic=makeDiagnostic();
          return {valid:false,reason:'outside_supported_grammar',maxParsedPrefix:maxEnd,
            tokens:words,steps,diagnostic};
        }
        return {valid:true,reason:'accepted',tokens:words,features:best.features,parse:best,alternatives:complete.length,steps};
      } catch(e) {return {valid:false,reason:String(e.message||e),tokens:words,steps,resourceLimited:String(e.message||e)==='parse_budget_exceeded'};}
    }
    function checkSentenceSet(sentences, ownedWords, unlockedHelpers){
      const owned=new Set([...ownedWords].map(norm)),helpers=new Set([...unlockedHelpers].map(norm));
      const used=new Set(); const reports=[];
      for(const item of sentences){
        const tiles=Array.isArray(item) ? item : item.tiles;
        const words=tiles.map(t=>typeof t==='string'?t:t.word);
        const types=tiles.map(t=>typeof t==='string'?(owned.has(norm(t))?'collected':'helper'):t.source);
        const r=parse(words,{owned:[...owned],helpers:[...helpers],tokenTypes:types});
        if(r.valid){
          const local=words.filter((w,j)=>types[j]==='collected').map(norm);
          const collision=local.find(w=>used.has(w));
          if(collision){r.valid=false;r.reason='allocated_to_other_sentence';r.words=[collision];}
          else for(const w of local)used.add(w);
        }
        reports.push(r);
      }
      return {valid:reports.every(x=>x.valid),reports,usedWords:[...used]};
    }
    return {version:VERSION, parse, checkSentenceSet, entries, bip39, helpers:HELPER_POS, lexicalOverrides:LEXICAL_OVERRIDES};
  }
  return {createEngine,VERSION,HELPER_POS,LEXICAL_OVERRIDES};
});

