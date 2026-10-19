"""Extract BIP39-relevant evidence from Open English WordNet 2025 (CC BY 4.0).
Usage: python3 tools/extract_oewn.py english-wordnet-2025.xml.gz data/v1_1_lexicon.json data/oewn_evidence.json
Outputs, per BIP39 word: noun lexicographer files; multiword lemmas of the form
"<preposition> <word>"; and counts of bare "<preposition> <word>" in OEWN
definitions/examples (the following token must not be a letter-initial word
that could extend the noun, to avoid counting compound premodifiers)."""
import gzip, json, re, sys, collections, hashlib, xml.etree.ElementTree as ET
src, lexpath, out = sys.argv[1:4]
lex = json.load(open(lexpath)); bip = {e['word'] for e in lex['entries']}
PREPS = ['in','on','at','of','with','to','from','for','by','without','into','inside','toward']
DETS = set('the a an this that these those my his her its our their your some any no every each all many much one two three'.split())
FOLLOW_OK = set('and or but in on at with from for by as that when while because before after until if where so than then is are was were'.split())  # not 'of'/'to': those mark complex prepositions (in front of, in order to)
sha = hashlib.sha256(open(src,'rb').read()).hexdigest()
synset_lexfile = {}; entries = []; hyper = {}; synset_lemmas = collections.defaultdict(list)
texts = []
for ev, el in ET.iterparse(gzip.open(src), events=('end',)):
    tag = el.tag
    if tag == 'LexicalEntry':
        lem = el.find('Lemma'); wf = lem.get('writtenForm'); pos = lem.get('partOfSpeech')
        entries.append((wf, pos, [s.get('synset') for s in el.findall('Sense')])); el.clear()
    elif tag == 'Synset':
        synset_lexfile[el.get('id')] = el.get('lexfile')
        hyper[el.get('id')] = [r.get('target') for r in el.findall('SynsetRelation') if r.get('relType') in ('hypernym','instance_hypernym')]
        for d in el.findall('Definition'): texts.append(d.text or '')
        for x in el.findall('Example'): texts.append(x.text or '')
        el.clear()
for wf, pos, syns in entries:
    for s_ in syns: synset_lemmas[s_].append(wf)
def ancestors(sid):
    out, stack, seen = [], [sid], set()
    while stack:
        x = stack.pop()
        for h in hyper.get(x, []):
            if h in seen: continue
            seen.add(h); out.append(h); stack.append(h)
    return out
# Target synsets for collectives of people/animals, identified by their full
# lemma sets (not by a single, possibly ambiguous lemma string).
TARGETS = {}
for sid, lems in synset_lemmas.items():
    L = set(x.lower() for x in lems)
    if 'social group' in L: TARGETS[sid] = 'social group'
    elif 'animal group' in L: TARGETS[sid] = 'animal group'
    elif {'gathering', 'assemblage'} <= L: TARGETS[sid] = 'gathering (of persons)'
    elif L == {'people'} and synset_lexfile.get(sid) == 'noun.group': TARGETS[sid] = 'people'
adv_adj_lemmas = set()
noun_lexfiles = collections.defaultdict(set); mwe = collections.defaultdict(set); first_lexfile = {}; first_group_ancestors = {}
for wf, pos, syns in entries:
    w = wf.lower()
    if pos == 'n' and w in bip:
        for s in syns: noun_lexfiles[w].add(synset_lexfile.get(s))
        if syns and w not in first_lexfile:
            first_lexfile[w] = synset_lexfile.get(syns[0])
            if first_lexfile[w] == 'noun.group':
                hit = [TARGETS[a] for a in ancestors(syns[0]) if a in TARGETS]
                first_group_ancestors[w] = sorted(set(hit))
    if pos in ('r', 'a', 's'): adv_adj_lemmas.add(w)
    parts = w.split(' ')
    if len(parts) == 2 and parts[0] in PREPS and parts[1] in bip:
        mwe[w].add(pos)
bare = collections.Counter(); bare_examples = collections.defaultdict(list); withdet = collections.Counter()
tok = re.compile(r"[A-Za-z']+|[^\sA-Za-z']")
for t in texts:
    toks = tok.findall(t)
    low = [x.lower() for x in toks]
    for i in range(2, len(low)):
        if low[i-2] in PREPS and low[i-1] in DETS and low[i] in bip:
            withdet[low[i-2] + ' ' + low[i]] += 1
    for i in range(1, len(toks)-0):
        p = toks[i-1].lower() if i-1 >= 0 else ''
        # 'to' is excluded: "to try" is usually an infinitive, not P + N.
        if p not in PREPS or p == 'to' or i >= len(toks): continue
        n = toks[i].lower()
        if n not in bip or n in DETS: continue
        nxt = toks[i+1].lower() if i+1 < len(toks) else '.'
        if re.match(r"[a-z]", nxt) and nxt not in FOLLOW_OK: continue
        key = p + ' ' + n; bare[key] += 1
        if len(bare_examples[key]) < 3: bare_examples[key].append(t.strip()[:160])
closed = sorted(p + ' ' + n for p in PREPS for n in bip if (p + n) in adv_adj_lemmas)
json.dump({'source':'Open English WordNet 2025','licence':'CC BY 4.0','url':'https://github.com/globalwordnet/english-wordnet','sha256':sha,
  'noun_lexfiles':{k:sorted(x for x in v if x) for k,v in sorted(noun_lexfiles.items())},
  'noun_first_sense_lexfile':dict(sorted(first_lexfile.items())),
  'noun_first_group_sense_ancestors':dict(sorted(first_group_ancestors.items())),
  'closed_form_prep_noun':closed,
  'prep_noun_mwe':{k:sorted(v) for k,v in sorted(mwe.items())},
  'bare_prep_noun_usage':{k:{'count':c,'with_determiner':withdet.get(k,0),'examples':bare_examples[k]} for k,c in sorted(bare.items())}}, open(out,'w'), indent=0)
print('nouns with lexfiles',len(noun_lexfiles),'mwe',len(mwe),'bare bigrams',len(bare))
