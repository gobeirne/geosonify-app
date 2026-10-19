"""Extract verb argument-structure evidence for BIP39 words from the English
Resource Grammar lexicon (MIT licence; github.com/delph-in/erg, lexicon.tdl).
Usage: python3 tools/extract_erg_lexicon.py lexicon.tdl data/v1_1_lexicon.json data/erg_verb_evidence.json
Records each single-word verb entry (name, lexical type) for BIP39 words, and
classifies types: optional NP object (v_np*...), intransitive (v_-...)."""
import json, re, sys, hashlib
src, lexpath, out = sys.argv[1:4]
bip = {e['word'] for e in json.load(open(lexpath))['entries']}
text = open(src, encoding='utf-8').read()
ent = re.compile(r'^(\S+) := (v_\S+_le)\s*&\s*\[\s*ORTH < ((?:"[^"]*"\s*,?\s*)+) >', re.M)
verbs = {}
for m in ent.finditer(text):
    name, typ, orth = m.group(1), m.group(2), re.findall(r'"([^"]*)"', m.group(3))
    if len(orth) != 1 or orth[0].lower() not in bip: continue
    verbs.setdefault(orth[0].lower(), []).append({'entry': name, 'type': typ})
# ERG lexical types -> Word Lab frames. '*' after an argument = optional.
def cls(t):
    if t.startswith('v_np*'): return 'optional_object'          # tr + intr
    if t in ('v_-_le', 'v_-_unacc_le'): return 'intransitive'
    if t in ('v_np_le', 'v_np_noger_le'): return 'transitive'
    if t in ('v_np-np_le', 'v_np-np_only_le'): return 'ditransitive'
    if t == 'v_vp_seq_le': return 'to_infinitive'
    if t in ('v_cp_prop_le', 'v_cp_le'): return 'clause'
    return None
out_d = {'source': 'English Resource Grammar lexicon.tdl (github.com/delph-in/erg, main)', 'licence': 'MIT',
         'sha256': hashlib.sha256(open(src, 'rb').read()).hexdigest(),
         'verbs': {w: {'entries': v, 'classes': sorted({c for c in (cls(x['type']) for x in v) if c})} for w, v in sorted(verbs.items())}}
json.dump(out_d, open(out, 'w'), indent=0)
from collections import Counter
c = Counter(x for v in out_d['verbs'].values() for x in v['classes'])
print('BIP39 verbs in ERG:', len(verbs), dict(c))
