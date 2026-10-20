"""End-to-end test of dist/Starpin_Word_Lab_v2_0.html in headless Chromium (phone viewport).
Seeds a v1.1 snapshot in localStorage, then checks migration, scoring, pending saves,
reading pins, autosave/resume and the absence of JavaScript errors.
Usage: python3 tests/browser_game_test.py [legacy_session.json]"""
import json, sys, pathlib
from playwright.sync_api import sync_playwright
root = pathlib.Path(__file__).resolve().parent.parent
game = (root / 'dist' / 'Starpin_Word_Lab_v2_0.html').as_uri()
legacy = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/legacy_session.json').read_text()
results, errors = {}, []
def check(name, ok, detail=''):
    results[name] = {'ok': bool(ok), 'detail': detail}
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(detail) if detail else ''))
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    ctx.add_init_script("""if(!sessionStorage.getItem('seeded')){localStorage.clear();localStorage.setItem('starpin-word-lab-v1.1-local-snapshot',%s);sessionStorage.setItem('seeded','1');}""" % json.dumps(legacy))
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    pg.goto(game); pg.wait_for_function('window.StarpinWordLab && window.StarpinWordLab.getState')
    st = pg.evaluate('window.StarpinWordLab.getState()')
    check('migration keeps inventory, helpers and sentences', len(st['inventory']) == 167 and 'has' in st['unlocked'] and len(st['committed']) == 3, f"{len(st['inventory'])} words, {len(st['unlocked'])} helpers, {len(st['committed'])} sentences")
    hist = [(c.get('history') or [{}])[0].get('score') for c in st['committed']]
    now = [c.get('scored', {}).get('score') for c in st['committed']]
    check('each migrated sentence keeps its v1.1 score in history', all(h is not None for h in hist), f'v1.1 {hist} -> v2 {now}')
    notice = pg.evaluate("document.body.innerText")
    check('migration notice shown', 'Migrated your v1.1 session' in notice)
    check('v1.1 snapshot left untouched', pg.evaluate("localStorage.getItem('starpin-word-lab-v1.1-local-snapshot')") == legacy)
    # live scoring of a draft
    def draft(words):
        pg.evaluate("""ws=>{const L=window.StarpinWordLab;L.cancelDraft&&L.cancelDraft();for(const [w,s] of ws)L.addTile(w,s);}""", words)
        return pg.evaluate("""()=>{const r=window.StarpinWordLab.evaluateDraft();return {valid:r.valid,pending:!!r.pending,reason:r.reason||null,score:r.score&&r.score.score,kind:r.parse&&r.parse.kind,cps:r.wl2&&r.wl2.choicePoints?r.wl2.choicePoints.length:0,pinned:!!r.pinned}}""")
    # Free (unallocated) collected words by part of speech, from the page's lexicon.
    free = pg.evaluate("""()=>{const st=window.StarpinWordLab.getState();const used=new Set(st.committed.flatMap(s=>s.tiles.filter(t=>t.source==='collected').map(t=>t.word)));
      const pos={};for(const e of window.STARPIN_LEXICON.entries){if(!st.inventory.includes(e.word)||used.has(e.word))continue;
        const ps=[...new Set(e.readings.filter(r=>r.proposed_for_parser).map(r=>r.pos))];if(ps.length===1)(pos[ps[0]]=pos[ps[0]]||[]).push(e.word);
        if(ps.includes('noun')&&ps.includes('verb'))(pos.nv=pos.nv||[]).push(e.word);}return pos}""")
    # A known-ambiguous sentence from these free words (found offline with the engine).
    amb_tiles = json.loads((root / 'tests' / 'browser_ambiguous_sentence.json').read_text())
    amb_words = {t['word'] for t in amb_tiles}
    N, A, V = [[w for w in free.get(k, []) if w not in amb_words] for k in ('noun', 'adjective', 'verb')]
    print('free words: nouns', len(N), 'adjectives', len(A), 'verbs', len(V))
    good = None
    for i in range(min(len(N) - 2, 12)):
        for v in V[:8]:
            c = [['the','helper'],[A[i % len(A)],'collected'],[N[i],'collected'],['can','helper'],[v,'collected'],['the','helper'],[N[i+1],'collected'],[N[i+2],'collected']]
            x = draft(c)
            if x['valid']: good = (c, x); break
        if good: break
    check('draft is scored', good is not None and good[1]['score'] > 0, good and (' '.join(w for w, s in good[0]), good[1]))
    # pending: a specific conflict (determiner + mass noun mismatch, or agreement)
    cand = [[['a','helper'],[N[k],'collected'],['is','helper'],[A[k % len(A)],'collected'],['and','helper'],[N[k+1],'collected']] for k in range(3, 9)] + [[[N[k],'collected'],['the','helper'],['the','helper'],[N[k+1],'collected']] for k in range(3, 9)]
    pend = None
    for c in cand:
        x = draft(c)
        if x['pending']: pend = (c, x); break
    check('a grammar-level failure is pending, not blocked', pend is not None, pend and pend[1])
    if pend:
        pg.evaluate("window.StarpinWordLab.saveDraft()"); pg.evaluate("window.StarpinWordLab.commitSandbox()")
        st2 = pg.evaluate('window.StarpinWordLab.getState()')
        check('pending sentence can be saved and committed', len(st2['committed']) == 4, f"{len(st2['committed'])} committed")
        blue = [t['word'] for t in pend[0] if t[1] == 'collected'] if False else [w for w, s in pend[0] if s == 'collected']
        used = pg.evaluate("w=>{const L=window.StarpinWordLab;L.cancelDraft&&L.cancelDraft();L.addTile(w,'collected');return {len:L.getState().draft.length,text:document.body.innerText.includes('already in this draft or another sentence')}}", blue[0])
        check('pending sentence reserves its blue tiles', used['len'] == 0 and used['text'], f'reusing "{blue[0]}" -> refused={used}')
        rows = pg.evaluate("document.getElementById('portfolioList').innerText")
        check('portfolio shows pending and v1.1 history', 'Pending' in rows and 'under v1.1' in rows)
    # reading pins
    x = draft([[t['word'], t['source']] for t in amb_tiles])
    amb = (amb_tiles, x) if x['valid'] and x['cps'] > 0 else None
    r = amb[1] if amb else {'valid': False, 'cps': 0}
    check('ambiguous draft offers choice points', amb is not None, amb and (' '.join(t['word'] for t in amb[0]), r))
    clicked = pg.evaluate("""()=>{const b=[...document.querySelectorAll('[data-pin-index]')].find(x=>!x.classList.contains('on'));if(!b)return null;b.click();return b.dataset.pinPos}""")
    r2 = pg.evaluate("()=>{const r=window.StarpinWordLab.evaluateDraft();return {pinned:!!r.pinned,valid:r.valid,score:r.score&&r.score.score}}")
    check('tapping a reading pins it', clicked is not None and r2['pinned'] and r2['valid'], {'clicked': clicked, **r2})
    pg.evaluate("w=>window.StarpinWordLab.addTile(w,'collected')", N[0])
    r3 = pg.evaluate("()=>{const r=window.StarpinWordLab.evaluateDraft();return {pinned:!!r.pinned}}")
    check('editing the sentence drops stale pins', not r3['pinned'])
    pg.screenshot(path='/tmp/game_build.png', full_page=False)
    pg.wait_for_timeout(800)  # autosave debounce
    v2 = pg.evaluate("localStorage.getItem('starpin-word-lab-v2-local-snapshot')")
    check('autosave writes a version-2 snapshot', v2 is not None and json.loads(v2)['version'] == 2)
    pg.reload(); pg.wait_for_function('window.StarpinWordLab && window.StarpinWordLab.getState')
    st3 = pg.evaluate('window.StarpinWordLab.getState()')
    check('reload resumes v2 snapshot (no re-migration)', len(st3['committed']) == 4 and 'Resumed your previous local snapshot' in pg.evaluate('document.body.innerText'), f"{len(st3['committed'])} committed")
    check('history preserved across reload', all(c.get('history') is not None for c in st3['committed']))
    check('no JavaScript errors', not errors, errors[:5])
    b.close()
(root / 'reports').mkdir(exist_ok=True)
(root / 'reports' / 'browser_game_test.json').write_text(json.dumps(results, indent=1))
sys.exit(0 if all(v['ok'] for v in results.values()) else 1)
