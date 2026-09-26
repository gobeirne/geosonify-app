"""
starpin-flip_browsertest.py -- the flip, in a real browser.

  pip install playwright && python -m playwright install chromium
  npm i leaflet@1.9.4 aladin-lite@3.9.0-beta        (in the repo root)
  python starpin-flip_browsertest.py               (from the repo root)

Aladin needs WebGL2, which headless Chromium provides through SwiftShader. No
network is used: Overpass is answered with a synthetic street grid and every
other request is refused, so sky TILES never load -- imagery is not what is under
test. What is: that the turn lands pixel for pixel on both renderers, that our
street projection is the renderer's projection, that round trips return to the
exact zoom, and that a renderer drifting on its own never moves the ground.
Screenshots go to test-out/.
"""
import json, re, math, os, threading, http.server, functools, urllib.parse
from playwright.sync_api import sync_playwright

PORT = 8765
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Q, directory=os.getcwd()))
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.makedirs('test-out', exist_ok=True)

def synth_streets(body):
    q = urllib.parse.parse_qs(body)['data'][0]
    s, w, n, e = map(float, re.search(r'\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\);out', q).groups())
    classes = re.search(r'\^\(([^)]*)\)', q).group(1).split('|')
    els, wid = [], 1
    def way(hw, pts):
        nonlocal wid
        els.append({'type': 'way', 'id': wid, 'tags': {'highway': hw},
                    'geometry': [{'lat': a, 'lon': b} for a, b in pts]}); wid += 1
    # A street grid tilted like Christchurch's, 110 m blocks, with a park.
    lat0, lon0 = (s + n) / 2, (w + e) / 2
    k = math.cos(math.radians(lat0))
    dlat, dlon = 110 / 111320, 110 / (111320 * k)
    if 'residential' in classes:
        i0 = math.floor((s - lat0) / dlat); i1 = math.ceil((n - lat0) / dlat)
        for i in range(i0, i1 + 1):
            la = lat0 + i * dlat
            if -3 <= i <= 3 and 'footway' in classes: pass
            way('residential', [(la, w), (la, e)])
        j0 = math.floor((w - lon0) / dlon); j1 = math.ceil((e - lon0) / dlon)
        for j in range(j0, j1 + 1):
            lo = lon0 + j * dlon
            way('residential', [(s, lo), (n, lo)])
    if 'primary' in classes:
        way('primary', [(s, w), (n, e)])
        way('secondary', [(s + (n - s) * 0.3, w), (s + (n - s) * 0.3, e)])
    if 'footway' in classes:
        for t in range(12):
            a = t / 12 * 2 * math.pi
            way('footway', [(lat0 + 3 * dlat * math.sin(a + u / 8), lon0 + 3 * dlon * math.cos(a + u / 8)) for u in range(9)])
    return json.dumps({'elements': els})

errs = []; pass_ = [0]; fail_ = [0]
def ok(name, cond, detail=''):
    if cond: pass_[0] += 1; print('  PASS ', name)
    else: fail_[0] += 1; print('  FAIL ', name, '--', detail)

def page(p, q, dpr=2):
    b = p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=dpr)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)) if ('HiPS' not in str(e) and 'fetch' not in str(e).lower()) else None)
    pg.route('**/*', lambda r: r.continue_() if r.request.url.startswith('http://127.0.0.1')
             else (r.fulfill(status=200, content_type='application/json', body=synth_streets(r.request.post_data))
                   if 'overpass' in r.request.url else r.abort()))
    pg.goto(f'http://127.0.0.1:{PORT}/starpin-flip_testpage.html?' + q)
    pg.wait_for_timeout(1500)
    if 'noal=1' not in q:
        # Imagery arrives when it arrives; the built-in renderer is live until then.
        try: pg.wait_for_function("flip.rendererKind() === 'aladin'", timeout=20000)
        except Exception: pass
    pg.wait_for_timeout(1000)
    return b, pg

CMP = '''() => { var r = flip.renderer(), v = flip.view(), out = 0;
  var pts = []; for (var i = -2; i <= 2; i++) for (var j = -2; j <= 2; j++) pts.push([v.lat + i * 0.004, v.lon + j * 0.005]);
  // our drawing projection, as the module uses it
  var P = (function () { var A = (function(){ var c=r.getCenter(); return c; })(); return null; })();
  pts.forEach(function (q) {
    var a = r.project(((q[1] % 360) + 360) % 360, q[0]);
    var b = flip._test.project(q[0], q[1]);
    if (a && b) out = Math.max(out, Math.abs(a[0]-b[0]), Math.abs(a[1]-b[1]));
  });
  return { worst: out, kind: flip.rendererKind() }; }'''

with sync_playwright() as p:
    print('\nA  opening on the sky, imagery swaps in behind the built-in renderer')
    b, pg = page(p, 'z=16')
    st = pg.evaluate('({kind: flip.rendererKind(), face: flip.face(), anchor: flip._test.anchor(), v: flip.view()})')
    ok('face is sky', st['face'] == 'sky')
    ok('Aladin renderer is live', st['kind'] == 'aladin', st['kind'])
    ok('pulled back to the DSS2 floor (0.2667"/px)', abs(st['v']['asp'] - 0.8/3) / (0.8/3) < 0.002, st['v']['asp'])
    ok('anchor remembers the ground scale for zoom 16', abs(st['anchor']['earthAsp'] - 1296000*0.72532/(256*65536)) < 1e-4, st['anchor'])
    pg.screenshot(path='test-out/v2-sky-open.png')
    b.close()

    for q, label in (('z=13&face=earth', 'Aladin'), ('z=13&face=earth&noal=1', 'built-in')):
        print('\nB/C  the turn lands pixel for pixel (' + label + ' renderer)')
        b, pg = page(p, q)
        pts = [[-43.5309 + dy, 172.6365 + dx] for dy in (-0.01, 0, 0.012) for dx in (-0.015, 0, 0.02)]
        before = pg.evaluate('(pts) => pts.map(q => { var e = flip.leaflet.latLngToContainerPoint(q); return [e.x, e.y]; })', pts)
        W = pg.evaluate('flip.view().w')
        pg.evaluate('flip.toSky()')
        if label == 'Aladin':
            pg.wait_for_timeout(330 + 290); pg.screenshot(path='test-out/v2-midturn.png')
        pg.wait_for_timeout(2600)
        info = pg.evaluate('({kind: flip.rendererKind(), asp: flip.view().asp})')
        after = pg.evaluate('(pts) => pts.map(q => flip._test.project(q[0], q[1]))', pts)
        seam = max(max(abs((W - e[0]) - s[0]), abs(e[1] - s[1])) for e, s in zip(before, after))
        ok(label + ': the expected renderer is live', info['kind'] == ('aladin' if label == 'Aladin' else 'builtin'), info)
        ok(label + ': no pull-back needed at zoom 13', info['asp'] > 0.8/3, info)
        ok(label + ': mirrored ground and sky drawing agree to %.3f px' % seam, seam < 1.0)
        cmp = pg.evaluate(CMP)
        ok(label + ': our street projection matches renderer.project to %.2g px' % cmp['worst'], cmp['worst'] < 0.05, cmp)
        if label == 'Aladin': pg.screenshot(path='test-out/v2-sky-z13.png')
        b.close()

    print('\nD  round trips')
    b, pg = page(p, 'z=17')
    pg.evaluate('flip.toEarth()'); pg.wait_for_timeout(3000)
    ok('sky (pulled back) -> look down returns to zoom 17 exactly', abs(pg.evaluate('flip.leaflet.getZoom()') - 17) < 1e-6, pg.evaluate('flip.leaflet.getZoom()'))
    pg.screenshot(path='test-out/v2-earth-z17.png')
    pg.evaluate('flip.toSky()'); pg.wait_for_timeout(3200)
    # Aladin wanders by itself (the 1.77x Geosonify saw). No person zoomed.
    pg.evaluate('(function(){ var r = flip.renderer(); r.setFovDeg(r.getFovDeg() * 1.77); })()')
    pg.evaluate('flip.toEarth()'); pg.wait_for_timeout(3000)
    ok('a renderer drifting on its own does NOT move the ground', abs(pg.evaluate('flip.leaflet.getZoom()') - 17) < 1e-6, pg.evaluate('flip.leaflet.getZoom()'))
    pg.evaluate('flip.toSky()'); pg.wait_for_timeout(3200)
    pg.evaluate('(function(){ flip._test.userZoomed(true); var r = flip.renderer(); r.setFovDeg(r.getFovDeg() * 2); })()')
    pg.evaluate('flip.toEarth()'); pg.wait_for_timeout(3000)
    z = pg.evaluate('flip.leaflet.getZoom()')
    ok('a person zooming out 2x in the sky lands one zoom level out (%.4f)' % z, abs(z - 16) < 0.01)
    for i in range(3):
        pg.evaluate('flip.toSky()'); pg.wait_for_timeout(3000); pg.evaluate('flip.toEarth()'); pg.wait_for_timeout(2600)
    z2 = pg.evaluate('flip.leaflet.getZoom()')
    ok('three more round trips do not drift (%.6f)' % z2, abs(z2 - z) < 1e-6)
    b.close()

    print('\nE  tapping a starpin on the sky')
    b, pg = page(p, 'z=16')
    xy = pg.evaluate('(function(){ var v = flip.view(); var c = flip.stars().map(function (s) { return flip._test.project(s.lat, s.lon); }).filter(function (q) { return q && q[0] > 60 && q[0] < v.w - 60 && q[1] > 120 && q[1] < v.h - 200; }); return c[0]; })()')
    print('   tapping at', xy)
    box = pg.evaluate('(function(){ var r = flip.el.getBoundingClientRect(); return [r.left, r.top]; })()')
    pg.mouse.click(box[0] + xy[0], box[1] + xy[1]); pg.wait_for_timeout(400)
    ok('sheet opened for that star', pg.evaluate("!document.querySelector('.spf-sheet').hidden"))
    pg.screenshot(path='test-out/v2-star-sheet.png')
    b.close()

print('\npage errors:', errs or 'none')
print('%d passed, %d failed' % (pass_[0], fail_[0]))

import sys
sys.exit(1 if fail_[0] else 0)
