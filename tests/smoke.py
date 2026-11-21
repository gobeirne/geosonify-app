#!/usr/bin/env python3
"""
tests/smoke.py — the app itself, in a real browser (WP2.9, Nov 2026)

  pip install playwright==1.48.0 && python -m playwright install --with-deps chromium
  python tests/smoke.py

Serves the repo locally and checks, in headless Chromium at phone size:
  1. the home page loads with its cards and no script errors;
  2. every point and path vector of the core profile decodes in the app to the
     same place as spec/core-profile-v1-reference.js (the app and the spec agree);
  3. the Wikipedia landing (?r=) appears;
  4. a display link of a route shows its length;
  5. the introductory tour finds and highlights every control it points at.
Libraries load from their CDNs, so this needs the network (GitHub Actions has it).
Exit status 1 if anything fails.
"""
import functools, http.server, json, os, socket, subprocess, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
IGNORE = ('Failed to fetch', 'HiPS', 'NetworkError', 'Load failed')   # imagery, not our code

def serve():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]; s.close()
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Q, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return 'http://127.0.0.1:%d/' % port

def reference_vectors():
    js = ("const R=require('./spec/core-profile-v1-reference.js');"
          "const out=R.VECTORS.filter(([q,w])=>w.point||w.n).map(([q,w])=>{const g=R.decodeLink(q);"
          "const pts=g.point?[g.point]:g.groups[0].pts;return {q:q.split('&')[0],n:pts.length,first:pts[0],last:pts[pts.length-1]};});"
          "console.log(JSON.stringify(out));")
    return json.loads(subprocess.check_output(['node', '-e', js], cwd=ROOT))

failures = []
def check(name, ok, detail=''):
    print(('ok    ' if ok else 'FAIL  ') + name + ('' if ok else '   ' + str(detail)))
    if not ok: failures.append(name)

def main():
    base = serve()
    router = None
    if os.environ.get('GS_SMOKE_ROUTER'):          # optional offline routing for local runs
        sys.path.insert(0, os.path.dirname(os.environ['GS_SMOKE_ROUTER']))
        import harness; router = harness.router
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        def page(q, **kw):
            ctx = b.new_context(viewport={'width': 390, 'height': 760}, **kw); pg = ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            if router: pg.route('**/*', router(base, []))
            pg.goto(base + 'index.html' + (('?' + q) if q else '')); pg.wait_for_timeout(3500)
            return ctx, pg, errs
        def real(errs): return [e for e in errs if not any(i in e for i in IGNORE)]

        # 1. home
        ctx, pg, errs = page('b64=v-dzcFN-')
        n = pg.evaluate("document.querySelectorAll('#cardsContainer .format-card').length")
        check('home: cards render', n >= 5, n)
        check('home: no script errors', not real(errs), real(errs)[:2])
        # 5. tour
        pg.evaluate("GeosonifyTour.start('intro')"); pg.wait_for_timeout(700)
        missing = []
        steps = pg.evaluate("GeosonifyTour.check('intro').length")
        for k in range(steps):
            st = pg.evaluate("(()=>{const t=document.querySelector('.gs-tour-tip'), r=document.querySelector('.gs-tour-ring'); return t ? {title: t.querySelector('h3').textContent, ring: r.style.display !== 'none'} : null})()")
            want = pg.evaluate("i => GeosonifyTour.check('intro')[i].target", k)
            if st and want and not st['ring']: missing.append(st['title'])
            if k < steps - 1: pg.click('.gs-tour-tip button.pri'); pg.wait_for_timeout(700)
        check('tour: every step finds its control', not missing, missing)
        ctx.close()

        # 2. core-profile vectors: app == reference decoder
        for v in reference_vectors():
            ctx, pg, errs = page(v['q'])
            got = pg.evaluate("(()=>{ if (lastSolution && lastSolution.points && lastSolution.points.length > 1) return lastSolution.points; return currentCardCoord ? [[currentCardCoord.lat, currentCardCoord.lon]] : null; })()")
            ok = bool(got) and len(got) == v['n'] and all(abs(a - b) < 1e-9 for a, b in zip(got[0], v['first'])) and all(abs(a - b) < 1e-9 for a, b in zip(got[-1], v['last']))
            check('vector %s: app matches the spec' % v['q'][:40], ok, {'app': got and [len(got), got[0]], 'spec': [v['n'], v['first']]})
            ctx.close()

        # 3. Wikipedia landing
        ctx, pg, errs = page('r=-41.2865,174.7762')
        check('landing: shown for ?r=', pg.evaluate("gsLanding.classList.contains('on')"))
        ctx.close()
        # 6. paste WKT -> import -> link, with a round-trip report (WP2.4)
        ctx, pg, errs = page('b64=v-dzcFN-')
        pg.evaluate("switchToTab('input')"); pg.wait_for_timeout(300)
        pg.click('.import-pill[data-source=paste]')
        pg.fill('#pasteShapeText', 'POLYGON ((172.60 -43.50, 172.70 -43.50, 172.70 -43.55, 172.65 -43.56, 172.60 -43.50))')
        pg.click('#pasteShapeLoad'); pg.wait_for_timeout(2000); pg.click('#importAllBtn'); pg.wait_for_timeout(2500)
        rep = pg.evaluate("roundTripReport.textContent")
        check('paste WKT: becomes a polygon link with a round-trip report', pg.evaluate("lastSolution && lastSolution.type") == 'polygon' and 'Round trip: 5 vertices' in rep, rep)
        ctx.close()
        # 7. ?geohack= (WP2.5): title on the landing, precision from dim:
        ctx, pg, errs = page('geohack=48.8583_N_2.2945_E_type:landmark_region:FR_dim:300&title=Eiffel_Tower')
        r = pg.evaluate("({title: (document.querySelector('#gsLanding .gl-title')||{}).textContent, it: cardState.iterations[cardState.active], active: cardState.active, lat: currentCardCoord && currentCardCoord.lat})")
        check('geohack: title, place and precision from dim:', r['title'] == 'Eiffel Tower' and r['active'] == 'alphanumeric' and r['it'] == 7 and abs((r['lat'] or 0) - 48.8583) < 1e-9, r)
        ctx.close()
        # 8. B1 / D1: a linked path follows the card's precision, never finer than it came
        ctx, pg, errs = page('b64d=v-dzcFN-~4=dA8rdpn8lcKRl3Ot')
        def step(cls):
            pg.evaluate("c=>document.querySelector('#cardsContainer .format-card.active-card').querySelector(c).click()", cls); pg.wait_for_timeout(1000)
            return pg.evaluate("({it: cardState.iterations[cardState.active], first: document.getElementById('compactOutput').textContent.split('~')[0].length, addr: decodeURIComponent(location.search).split('=')[1].split('~')[0].length})")
        a1 = step('.plus-btn'); a2 = step('.minus-btn')
        check('precision: a linked path stays at its level and re-encodes coarser', a1['it'] == 8 and a1['first'] == 8 and a2['it'] == 7 and a2['first'] == 7 and a2['addr'] == 7, [a1, a2])
        ctx.close()
        # 9. B9: an encrypted link opens without the place ever appearing in the address bar
        ctx, pg, errs = page('b64=v-dzcFN-')
        blob = pg.evaluate("q=>encryptQueryString(q,'smoke-pass')", 'b64d=v-dzcFN-~4=dA8rdpn8lcKRl3Ot')
        ctx.close()
        ctx, pg, errs = page('enc=' + blob)
        pg.fill('#encDecryptInput', 'smoke-pass'); pg.click('#encDecryptBtn'); pg.wait_for_timeout(3000)
        r = pg.evaluate("({type: lastSolution && lastSolution.type, href: location.href})")
        check('encrypted link: shape loads, address bar keeps ?enc=', r['type'] == 'path' and '?enc=' in r['href'] and 'b64' not in r['href'], r)
        ctx.close()
        # 10. audio engine on demand (WP1.3): not at start, loaded when the music card is seen
        ctx, pg, errs = page('b64=v-dzcFN-')
        before = pg.evaluate("typeof AudioService.__isStandIn === 'function'")
        pg.evaluate("document.querySelector('#cardsContainer .format-card[data-grid-key=music]').scrollIntoView({block:'center'})"); pg.wait_for_timeout(3000)
        after = pg.evaluate("typeof AudioService.__isStandIn !== 'function' && typeof AudioService.play === 'function'")
        pg.evaluate("AudioUI.showSoundDesign()"); pg.wait_for_timeout(1500)
        check('audio: engine loads on view and the sound panel opens', before and after and pg.evaluate("!!document.querySelector('.audio-design-modal')"), [before, after])
        ctx.close()
        # 11. D3: a new visitor's drawn shape is carried by Base64
        ctx, pg, errs = page('r=-43.5,172.6')
        pg.evaluate("createPathPoly([[-43.50,172.60],[-43.51,172.62],[-43.52,172.61],[-43.50,172.60]], null); updateCompactOutputs()"); pg.wait_for_timeout(800)
        check('D3: a drawn shape uses Base64 by default', pg.evaluate("getURLParamForActiveCard(true)") == 'b64d', pg.evaluate("cardState.active"))
        ctx.close()
        # 12. WP2.1 holes: a ':' group is a hole; area is net; the link round-trips
        ctx, pg, errs = page('b64=v-dzcFN-')
        pg.evaluate("(()=>{const g=[[[-43.50,172.60],[-43.50,172.70],[-43.56,172.70],[-43.56,172.60],[-43.50,172.60]],[[-43.52,172.63],[-43.52,172.67],[-43.54,172.67],[-43.54,172.63],[-43.52,172.63]]]; g._roles=['outer','hole']; createMultiPathPoly(g, null); updateCompactOutputs();})()")
        q = pg.evaluate("getURLParamForActiveCard(true)+'='+document.getElementById('compactOutput').textContent")
        ctx.close()
        ctx, pg, errs = page(q)
        r = pg.evaluate("({roles: lastSolution && lastSolution.groupRoles, text: document.getElementById('results').textContent})")
        check('holes: the marker round-trips and the hole is subtracted', '~~~:' in q and r['roles'] == ['outer', 'hole'] and '1 hole' in r['text'], [q[:40], r['roles']])
        ctx.close()
        # 4. display link of a route shows a length
        ctx, pg, errs = page('b64d=v-dzcFN-~4=dA8rdpn8lcKRl3Ot&display&area')
        txt = pg.evaluate("(document.querySelector('.geosonify-viewer-area')||{}).textContent || ''")
        check('display link: a route shows its length', ' m' in txt or 'km' in txt, txt)
        ctx.close()
        b.close()
    print('\n%s' % ('ALL PASS' if not failures else '%d failed' % len(failures)))
    sys.exit(1 if failures else 0)

if __name__ == '__main__':
    main()
