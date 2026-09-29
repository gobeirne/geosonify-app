#!/usr/bin/env python3
"""
hpwords-displacement-study.py — how often corrupted word codes pass validation,
and where the ones that pass land.

    pip install astropy-healpix ordloc starhash numpy
    python3 spec/hpwords-displacement-study.py [--points N] [--seed S]

Designs (each through its own published rules):
  hpbip39      healpix-bip39-v1, 4 words (HEALPix NESTED order 20), English BIP39,
               checksum verified (sender's .NNN held fixed).
  hpbip39-nocs same words, checksum ignored (only the first-word rule rejects).
  ordloc       ordloc 0.2 STANDARD, 5 BIP39 words, embedded CRC-8 (check == 'ok');
               codes whose 3 face bits are 6 or 7 are counted as rejected.
  ordloc-nocrc same, CRC ignored.
  starhash     StarHash 1.1.1 reference (3 words, 7,971-word list, FF3); a code is
               rejected when decoding raises or yields an out-of-range pixel.

Error classes, applied to the WORD INDICES of a correct code:
  sub-random   one word replaced by a uniformly random other word of the same list
  sub-near     one word replaced by an alphabetical neighbour (|Δindex| ≤ 3)
  swap-adj     two adjacent different words exchanged
  confusion    one word replaced by its partner from confusion table v0, where both
               words are in that design's list (English only)

Metrics per design × class: trials, passed (undetected), pass rate, and for passed
errors the great-circle displacement from the true cell centre: median, and the
share within 300 m / 10 km / 1000 km (Earth sphere, mean radius from area
5.10072e14 m²; StarHash uses the same angles, so its figures are Earth-equivalent).

Sampling: points uniform on the sphere from a seeded generator; each trial picks
the position/word with the same generator. Everything is reproducible from --seed.
These are results for THIS error model and these parameters, not general claims.
"""
import argparse, math, sys, random
import numpy as np
import astropy.units as u
from astropy_healpix import HEALPix

ap = argparse.ArgumentParser()
ap.add_argument('--points', type=int, default=20000)
ap.add_argument('--seed', type=int, default=20260930)
ap.add_argument('--hp-trials', type=int, default=2_000_000, help='trials per class for hpbip39 (checksum passes are rare)')
ap.add_argument('--ordloc-trials', type=int, default=200_000)
ap.add_argument('--starhash-trials', type=int, default=40_000)
args = ap.parse_args()
R = math.sqrt(5.10072e14 / (4 * math.pi))

# ── this format ──────────────────────────────────────────────
import os
HERE = os.path.dirname(os.path.abspath(__file__))
EN = open(os.path.join(HERE, '..', 'spec', 'english.txt')).read().split() if os.path.exists(os.path.join(HERE, '..', 'spec', 'english.txt')) else None
if EN is None:
    import ordloc as _o
    EN = open(os.path.join(os.path.dirname(_o.__file__), 'wordlist_2048.txt')).read().split()   # = BIP39 English, unmodified
assert len(EN) == 2048 and EN[1195] == 'nice'
W = np.array([1, 140, 819, 343, 884, 825, 620, 515][:4], dtype=np.int64)
D = 120
hp20 = HEALPix(nside=2**20, order='nested')

def hp_encode(lon, lat):
    v = hp20.lonlat_to_healpix(lon * u.deg, lat * u.deg).astype(np.int64)
    return np.stack([(v >> 33) & 2047, (v >> 22) & 2047, (v >> 11) & 2047, v & 2047], axis=1)
def hp_value(idx):
    return (idx[:, 0] << 33) | (idx[:, 1] << 22) | (idx[:, 2] << 11) | idx[:, 3]
def hp_cs(idx):
    return (D + 101 * 4 + (idx * W).sum(axis=1)) % 997
def hp_centre(idx):
    lon, lat = hp20.healpix_to_lonlat(hp_value(idx))
    return lon.to_value(u.deg), lat.to_value(u.deg)

# office vector sanity check
_o = hp_encode(np.array([172.5843699489044]), np.array([-43.524092539467176]))
assert list(_o[0]) == [1195, 148, 1283, 1182] and hp_cs(_o)[0] == 91, 'office vector mismatch'

# ── comparators ─────────────────────────────────────────────
import ordloc
from starhash.core import StarHash
SH = StarHash()
SHW = SH.wordlist
ORD_IDX = {w: i for i, w in enumerate(ordloc.W2048)}

def gc(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dl = np.radians(np.asarray(lon2) - np.asarray(lon1))
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * R * np.arcsin(np.sqrt(np.clip(a, 0, 1)))

CONF = [('right', 'write'), ('where', 'wear'), ('pear', 'pair'), ('peace', 'piece'), ('two', 'too'), ('two', 'to'),
        ('one', 'won'), ('know', 'no'), ('sun', 'son'), ('deer', 'dear'), ('flee', 'flea'), ('sail', 'sale'),
        ('steak', 'stake'), ('steel', 'steal'), ('scene', 'seen'), ('wait', 'weight'), ('waste', 'waist'),
        ('way', 'weigh'), ('mail', 'male'), ('sell', 'cell'), ('night', 'knight'), ('cereal', 'serial'),
        ('inquiry', 'enquiry')]
def conf_map(words):
    ix = {w: i for i, w in enumerate(words)}
    m = {}
    for a, b in CONF:
        if a in ix and b in ix:
            m.setdefault(ix[a], []).append(ix[b]); m.setdefault(ix[b], []).append(ix[a])
    return m

rng = np.random.default_rng(args.seed)
pyr = random.Random(args.seed)

def points(n):
    lat = np.degrees(np.arcsin(rng.uniform(-1, 1, n)))
    lon = rng.uniform(-180, 180, n)
    return lat, lon

def corrupt(idx, cls, nlist, cmap):
    """idx: list of ints (a copy is modified). Returns corrupted list or None if not applicable."""
    k = len(idx); v = list(idx)
    if cls == 'sub-random':
        p = pyr.randrange(k); x = pyr.randrange(nlist - 1); v[p] = x if x < v[p] else x + 1
    elif cls == 'sub-near':
        p = pyr.randrange(k)
        while True:
            d = pyr.choice([-3, -2, -1, 1, 2, 3])
            if 0 <= v[p] + d < nlist: break
        v[p] += d
    elif cls == 'swap-adj':
        p = pyr.randrange(k - 1)
        if v[p] == v[p + 1]: return None
        v[p], v[p + 1] = v[p + 1], v[p]
    elif cls == 'confusion':
        cand = [p for p in range(k) if v[p] in cmap]
        if not cand: return None
        p = pyr.choice(cand); v[p] = pyr.choice(cmap[v[p]])
    return v

CLASSES = ['sub-random', 'sub-near', 'swap-adj', 'confusion']
rows = []

def report(design, cls, trials, dists):
    dists = np.asarray(dists)
    n = len(dists)
    row = [design, cls, trials, n, n / trials if trials else float('nan')]
    if n:
        row += [float(np.median(dists)), float((dists <= 300).mean()), float((dists <= 1e4).mean()), float((dists <= 1e6).mean())]
    else:
        row += [None] * 4
    rows.append(row)

# ── hpbip39 (vectorised) ─────────────────────────────────────
HP_CONF = conf_map(EN)
def hp_run(cls, trials, use_cs):
    lat, lon = points(trials)
    idx = hp_encode(lon, lat)
    cs = hp_cs(idx)
    bad = idx.copy()
    keep = np.ones(trials, bool)
    for t in range(trials):
        c = corrupt(list(idx[t]), cls, 2048, HP_CONF)
        if c is None: keep[t] = False
        else: bad[t] = c
    idx, bad, cs = idx[keep], bad[keep], cs[keep]
    ok = bad[:, 0] < 1536
    if use_cs: ok &= (hp_cs(bad) == cs)
    lo1, la1 = hp_centre(idx[ok]); lo2, la2 = hp_centre(bad[ok])
    return keep.sum(), gc(la1, lo1, la2, lo2)

for cls in CLASSES:
    n = args.hp_trials if cls != 'confusion' else args.hp_trials
    t, d = hp_run(cls, n, True);  report('hpbip39', cls, int(t), d)
    t, d = hp_run(cls, min(n, 200_000), False); report('hpbip39-nocs', cls, int(t), d)

# ── ordloc STANDARD ──────────────────────────────────────────
OR_CONF = conf_map(ordloc.W2048)
def ord_idx(lat, lon):
    return [ORD_IDX[w] for w in ordloc.encode_standard(lat, lon).split('.')]
def ord_decode(ix, use_crc):
    val = 0
    for x in ix: val = val << 11 | x
    p, chk = val >> 8, val & 0xFF
    if (p >> 44) >= 6: return None                     # invalid S2 face
    if use_crc and ordloc._crc8(p, 47) != chk: return None
    la, lo, _, _ = ordloc._cell(p, 44)
    return la, lo
for cls in CLASSES:
    for use_crc, name, n in ((True, 'ordloc', args.ordloc_trials), (False, 'ordloc-nocrc', min(args.ordloc_trials, 50_000))):
        lat, lon = points(n); dists = []; tried = 0
        for a, b in zip(lat, lon):
            ix = ord_idx(a, b); c = corrupt(ix, cls, 2048, OR_CONF)
            if c is None: continue
            tried += 1
            r = ord_decode(c, use_crc)
            if r is None: continue
            t0 = ord_decode(ix, False)
            dists.append(float(gc(t0[0], t0[1], r[0], r[1])))
        report(name, cls, tried, dists)

# ── StarHash ────────────────────────────────────────────────
SH_CONF = conf_map(SHW)
SH_IX = {w: i for i, w in enumerate(SHW)}
def sh_decode(ix):
    try:
        ra, dec = SH.words_to_coordinate(SH.word_separator.join(SHW[i] for i in ix))
        if not (np.isfinite(ra) and np.isfinite(dec)): return None
        return float(dec), float(ra)
    except Exception:
        return None
for cls in CLASSES:
    lat, lon = points(args.starhash_trials); dists = []; tried = 0
    for a, b in zip(lat, lon):
        name = SH.coordinate_to_words(b % 360, a)
        ix = [SH_IX[w] for w in name.split(SH.word_separator)]
        c = corrupt(ix, cls, len(SHW), SH_CONF)
        if c is None: continue
        tried += 1
        r = sh_decode(c)
        if r is None: continue
        t0 = sh_decode(ix)
        dists.append(float(gc(t0[0], t0[1], r[0], r[1])))
    report('starhash', cls, tried, dists)

# ── output ──────────────────────────────────────────────────
print(f'# displacement study · seed {args.seed} · numpy {np.__version__} · python {sys.version.split()[0]}')
print(f'# confusion pairs present: hpbip39/ordloc {sum(len(v) for v in HP_CONF.values())//2}, starhash {sum(len(v) for v in SH_CONF.values())//2}')
print(f"{'design':13} {'class':10} {'trials':>9} {'passed':>8} {'pass rate':>10} {'median':>11} {'≤300m':>6} {'≤10km':>6} {'≤1000km':>7}")
def fm(m):
    if m is None: return '—'
    return f'{m/1000:.0f} km' if m >= 1e4 else f'{m:.0f} m'
for d, c, t, n, pr, med, a, b, cc in rows:
    pct = lambda x: '—' if x is None else f'{100*x:.1f}%'
    print(f'{d:13} {c:10} {t:9d} {n:8d} {100*pr:9.3f}% {fm(med):>11} {pct(a):>6} {pct(b):>6} {pct(cc):>7}')
