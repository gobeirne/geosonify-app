"""
geosonify-decode: decode Geosonify links (core profile v1) in Python.

A faithful port of spec/core-profile-v1-reference.js
(https://github.com/gobeirne/geosonify-app). It reads the core profile only:
Base64-grid and HEALPix (hphex, hp64) points and paths in every payload form,
groups, circle/rectangle/graticule suffixes, and lbl=/sty= annotations.
Obfuscated, passphrase and encrypted links are outside the core profile and
raise ValueError. Coordinates are [latitude, longitude] in degrees, WGS84.

    >>> from geosonify_decode import decode_link
    >>> decode_link('b64=v-dzcFN-')['point']
    [-43.52250516414642, 172.58110642433167]
"""
import math
import re
from urllib.parse import unquote

__all__ = ['decode_link', 'decode_code', 'decode_path', 'decode_shape', 'decode_healpix',
           'healpix_centre', 'parse_annotations']
__version__ = '1.0.0'

A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
HEX = '0123456789abcdefABCDEF'


def _hex_digit(ch):
    return ch is not None and ch != '' and ch in HEX


def decode_code(code):
    """A Base64-grid code to the centre of its cell (spec section 2)."""
    la0, la1, lo0, lo1 = -90.0, 90.0, -180.0, 180.0
    for ch in code:
        i = A.find(ch)
        if i < 0:
            raise ValueError('not Base64: ' + ch)
        dl, dn = (la1 - la0) / 8, (lo1 - lo0) / 8
        la1 = la1 - dl * (i >> 3); la0 = la1 - dl
        lo0 = lo0 + dn * (i & 7); lo1 = lo0 + dn
    return [(la0 + la1) / 2, (lo0 + lo1) / 2]


def decode_path(value, r_flag=False, decode_one=None):
    """A path value: first code, then a payload in any of the four forms (section 3)."""
    parts = value.split('~')
    first = parts[0]; L = len(first)
    codes = [first]; R = []
    glob = bool(r_flag)
    p = parts[1] if len(parts) > 1 else ''
    if p and re.match(r'^R[0-9a-f]', p, re.I):
        glob = True; p = p[1:]; parts[1] = p
    legacy = 0
    m = re.match(r'^([0-9A-Fa-f])(.+)$', p or '', re.S)
    if m:
        n = int(m.group(1), 16)
        if 0 < n < L and '=' not in p and len(m.group(2)) >= n and len(m.group(2)) % n == 0:
            legacy = n
    if re.match(r'^[0-9A-Fa-f]=', p or ''):                                  # fixed width
        w = int(p[0], 16); rest = ''.join(parts[1:])[2:]
        while rest:
            if rest[0] == '*':
                k = int(rest[1]) if len(rest) > 1 and rest[1].isdigit() else 0
                if not k > 0:
                    break
                d = rest[2:2 + k]; rest = rest[2 + k:]
            else:
                if not w > 0:
                    break
                d = rest[:w]; rest = rest[w:]
            codes.append(first[:L - len(d)] + d); R.append(False)
    elif (re.match(r'^d[0-9A-Fa-f]', p or '') and '=' not in p) or legacy:   # gear (and legacy gear)
        cur = first
        for s in parts[1:]:
            if s[:1] == 'd':
                K = 0
                while K < len(s) and s[K] == 'd':
                    K += 1
                try:
                    N = int(s[K:2 * K], 16)
                except ValueError:
                    N = 0
                pay = s[2 * K:]
                if not N > 0:
                    continue
            else:
                m = re.match(r'^([0-9A-Fa-f])(.+)$', s, re.S)
                n = int(m.group(1), 16) if m else 0
                if m and 0 < n < L and len(m.group(2)) % n == 0:
                    N = n; pay = m.group(2)
                else:                                                        # relative to the PREVIOUS code
                    cur = cur[:L - len(s)] + s; codes.append(cur); R.append(False); continue
            for j in range(0, len(pay), N):
                cur = cur[:L - N] + pay[j:j + N]; codes.append(cur); R.append(False)
    else:                                                                    # variable
        for s in parts[1:]:
            r = False
            if s[:1] == 'R' and len(s) > 1:
                r = True; s = s[1:]
            codes.append(first[:L - len(s)] + s); R.append(r)
    pts = [(decode_one or decode_code)(c) for c in codes]
    modes = ['R' if glob else 'G' for _ in pts]
    for i, r in enumerate(R):                    # R on the delta for vertex i+1 = segment i -> i+1
        if r:
            modes[i] = 'R'
    return {'pts': pts, 'modes': modes}


UNIT = {'mm': 0.001, 'cm': 0.01, 'm': 1, 'km': 1000, 'ft': 0.3048, 'mi': 1609.344}
RES = {'2': 0.001, '1': 0.01, '0': 0.1, '7': 1, '4': 10, '5': 100, '6': 1000}


def _len(s):
    m = re.match(r'^([\d.]+)\s*(mm|cm|km|ft|mi|m)?$', str(s))
    return float(m.group(1)) * UNIT[m.group(2) or 'm'] if m else float('nan')


def _len_var(s, i):
    unit = 1
    if i < len(s) and s[i] == '!':
        unit = RES.get(s[i + 1] if i + 1 < len(s) else '', 1); i += 2
    p = 0
    while i < len(s) and s[i] in '.~':
        p += 1; i += 1
    n = s[i:i + 2 + p]
    if len(n) < 2 + p:
        raise ValueError('truncated')
    return int(n, 36) * unit, i + 2 + p


def _checksum_char(t):
    s = 0
    for c in t:
        s = (s + ord(c)) % 36
    return '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[s]


def _num(x):
    """JS-style number: whole floats become ints (so 500.0 compares as 500)."""
    return int(x) if isinstance(x, float) and x.is_integer() else x


def decode_shape(payload, graticule=False):
    """A shape suffix: circle, rectangle or graticule (section 4)."""
    if not graticule:                                                        # circles first, exact lengths
        if re.match(r'^[A-Za-z0-9_-][A-P]$', payload):
            return {'type': 'circle', 'radius': (A.find(payload[0]) << 4) | A.find(payload[1])}
        if re.match(r'^[0-9A-Z]{2}$', payload) and re.search(r'[A-Z]', payload):
            return {'type': 'circle', 'radius': int(payload, 36)}
        m = re.match(r'^([.~]+)([0-9A-Z]+)$', payload)
        if m and len(m.group(2)) == 2 + len(m.group(1)):
            return {'type': 'circle', 'radius': int(m.group(2), 36)}
    else:
        m = re.match(r'^(~*)([0-9A-Z]+)$', payload)
        if m and len(m.group(2)) == 3 + len(m.group(1)):
            return {'type': 'circle', 'radius': int(m.group(2), 36)}
    if len(payload) > 3 and _checksum_char(payload[:-1]) == payload[-1]:
        payload = payload[:-1]
    f = payload.split('_')
    if graticule:
        def ang(x):
            mm = re.match(r'^([\d.]+)deg$', x, re.I)
            if mm:
                return float(mm.group(1))
            mm = re.match(r"^([\d.]+)(?:'|\u2019|min)$", x, re.I)
            return float(mm.group(1)) / 60 if mm else None
        if len(f) == 2 and (ang(f[0]) or 0) > 0 and (ang(f[1]) or 0) > 0:
            return {'type': 'graticule', 'lonSpanDeg': _num(ang(f[0])), 'latSpanDeg': _num(ang(f[1]))}
        if len(f) == 2 and re.search(r'deg|^[\d.]+_', payload):
            return {'type': 'graticule', 'lonSpanDeg': _num(float(re.match(r'^[\d.]+', f[0]).group(0))), 'nsMeters': _num(_len(f[1]))}
        if re.match(r'^[A-Za-z0-9_-]{7}$', payload):
            v = 0
            for c in payload:
                v = (v << 6) | A.find(c)
            v >>= 1
            return {'type': 'graticule', 'lonSpanDeg': _num(((v >> 25) & 0xFFFF) / 100), 'nsMeters': v & 0x1FFFFFF}
        a, nxt = _len_var(payload, 0); b, _ = _len_var(payload, nxt)
        return {'type': 'graticule', 'lonSpanDeg': _num(a / 1000), 'nsMeters': _num(b)}
    if len(f) == 3:
        return {'type': 'rect', 'thetaDeg': _num(float(re.match(r'^[\d.]+', f[0]).group(0))), 'L': _num(_len(f[1])), 'S': _num(_len(f[2]))}
    if re.match(r'^\d+m?$', payload):
        return {'type': 'circle', 'radius': _num(float(payload.rstrip('m')))}
    if re.match(r'^[A-Za-z0-9_-]{5}$', payload):
        v = 0
        for c in payload:
            v = (v << 6) | A.find(c)
        v >>= 1
        return {'type': 'rect', 'thetaDeg': (v >> 20) & 0x1FF, 'L': (v >> 10) & 0x3FF, 'S': v & 0x3FF}
    a, nxt = _len_var(payload, 2); b, _ = _len_var(payload, nxt)
    return {'type': 'rect', 'thetaDeg': int(payload[:2], 36), 'L': _num(a), 'S': _num(b)}


JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]
JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7]


def healpix_centre(face, digits):
    """Centre of a NESTED HEALPix pixel given its face and quaternary digits (section 7)."""
    ns = 2 ** len(digits); x = y = 0
    for d in digits:                       # x in the even bits, y in the odd
        x = x * 2 + (d & 1); y = y * 2 + (d >> 1)
    jr = JRLL[face] * ns - x - y - 1
    if jr < ns:
        nr = jr; z = 1 - nr * nr / (3 * ns * ns); ks = 0
    elif jr > 3 * ns:
        nr = 4 * ns - jr; z = nr * nr / (3 * ns * ns) - 1; ks = 0
    else:
        nr = ns; z = (2 * ns - jr) * 2 / (3 * ns); ks = (jr - ns) & 1
    jp = (JPLL[face] * nr + x - y + 1 + ks) / 2
    if jp > 4 * ns:
        jp -= 4 * ns
    if jp < 1:
        jp += 4 * ns
    lon = (jp - (ks + 1) * 0.5) * (90 / nr)
    if lon >= 180:
        lon -= 360
    return [90 - math.acos(z) * 180 / math.pi, lon]


def decode_healpix(code, scheme, order=None):
    """An hphex or hp64 code (optionally with @k) to its pixel centre."""
    s = code.strip(); k = order
    at = s.rfind('@')
    if at > 0 and re.match(r'^@\d{1,2}$', s[at:]):
        k = int(s[at + 1:]); s = s[:at]
    face = '0123456789AB'.find(s[0].upper())
    if face < 0:
        raise ValueError('bad face')
    d = []
    for ch in s[1:]:
        if scheme == 'hphex':
            n = int(ch, 16); d += [n >> 2, n & 3]
        else:
            n = A.find(ch); d += [n >> 4, (n >> 2) & 3, n & 3]
    if k is None:
        k = len(d)                      # no @k: the most the length allows
    return healpix_centre(face, d[:k])


PALETTE = {'r': 'ef4444', 'o': 'f97316', 'y': 'facc15', 'g': '22c55e', 'c': '06b6d4', 'b': '3b82f6',
           'v': '8b5cf6', 'm': 'd946ef', 'p': 'f9a8d4', 'n': '9ca3af', 'k': '111827', 'w': 'f9fafb'}
STRIP = re.compile('[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]')


def _uri_decode(s):
    """decodeURIComponent: '+' stays '+', bad escapes raise."""
    if re.search(r'%(?![0-9A-Fa-f]{2})', s):
        raise ValueError('bad escape')
    return unquote(s, errors='strict')


def parse_annotations(query):
    """lbl= and sty= parameters (section 8)."""
    labels, styles = {}, []
    for kv in re.sub(r'^\?', '', query).split('&'):
        eq = kv.find('=')
        if eq < 0:
            continue
        key = kv[:eq]
        try:
            val = _uri_decode(kv[eq + 1:])
        except (ValueError, UnicodeDecodeError):
            continue
        c = val.find(':')
        if c < 0:
            continue
        head, body = val[:c], val[c + 1:]
        if key == 'lbl' and re.match(r'^\d{1,7}$', head) and len(labels) < 500:
            t = re.sub(r'\s+', ' ', STRIP.sub('', body)).strip()
            t = t[:60].strip()
            if t:
                labels[str(int(head))] = t
        elif key == 'sty' and len(styles) < 500:
            m = re.match(r'^([ps])(\d{1,7})(?:-(\d{1,7}))?$', head)
            if not m:
                continue
            a = int(m.group(2)); b = int(m.group(3)) if m.group(3) is not None else a
            if b < a or b - a >= 5000:
                continue
            bits = body.split(',')
            col = PALETTE.get(bits[0].lower()) or (bits[0].lower() if re.match(r'^[0-9a-fA-F]{6}$', bits[0]) else None)
            if not col:
                continue
            w, dash, ok = None, False, True
            for x in bits[1:]:
                wm = re.match(r'^w(\d{1,2}(?:\.\d)?)$', x)
                if x == 'dash' and not dash:
                    dash = True
                elif wm and w is None and 0.5 <= float(wm.group(1)) <= 12:
                    w = _num(float(wm.group(1)))
                else:
                    ok = False; break
            if ok:
                styles.append({'on': 'points' if m.group(1) == 'p' else 'sides', 'from': a, 'to': b,
                               'colour': col, 'width': w, 'dash': dash})
    return {'labels': labels, 'styles': styles}


def decode_link(query):
    """A Geosonify link (or just its query) to a point, groups of paths, or a shape (section 1)."""
    q = query.split('?', 1)[1] if '?' in query else query
    eq = q.find('=')
    name = q[:eq]; value = _uri_decode(q[eq + 1:].split('&')[0])
    hp = re.match(r'^(hphex|hp64)([odrcj]*)$', name)
    if hp:
        if re.search(r'[oj]', hp.group(2)):
            raise ValueError('obfuscated: outside the core profile')
        one = lambda c: decode_healpix(c, hp.group(1))
        if 'd' in hp.group(2):
            return {'groups': [decode_path(g, 'r' in hp.group(2), one) for g in value.split('~~~')]}
        return {'point': one(value)}
    m = re.match(r'^b64([odrc]*)$', name)
    if not m:
        raise ValueError('not a core parameter')
    if 'o' in m.group(1):
        raise ValueError('obfuscated: outside the core profile')
    if 'd' in m.group(1):
        return {'groups': [decode_path(g, 'r' in m.group(1)) for g in value.split('~~~')]}
    t = value.find('~')
    if t < 0:
        return {'point': decode_code(value)}
    rest = value[t + 1:]; grat = rest.startswith('~')
    return {'centre': decode_code(value[:t]), 'shape': decode_shape(rest[1:] if grat else rest, grat)}
