#!/usr/bin/env python3
"""
moc-vectors-generate.py — reference vectors for js/lib/geosonify-moc.js

Generates spec/moc-vectors.json with MOCPy, once. The JSON is the stored
reference; this script is kept so anyone can see how it was made and
regenerate it with a later MOCPy (pip install mocpy; tested with 0.21.0).

    python3 spec/moc-vectors-generate.py > spec/moc-vectors.json

Three kinds of vector:
  roundtrip  MOCPy's canonical ASCII and JSON for a MOC; Geosonify must read
             either and write both back byte for byte. `input`, where given,
             is a deliberately non-canonical spelling that must come out as
             MOCPy's canonical ASCII. (MOCPy refuses overlapping cells in its
             input; Geosonify accepts and merges them, tested separately.)
  ops        union, intersection and difference of two MOCs, as MOCPy writes
             them.
  polygons   MOCPy's from_polygon at a given max_depth. Geosonify's polygon
             coverage is computed independently, so it is compared, not
             required to be identical: every cell where the two differ must be
             a cell of the maximum order lying on the polygon's edge (its
             centre within 1.5 cell radii of a side). In practice they differ
             only in tie cases (a cell touching the polygon at a single point,
             as when a side runs along HEALPix cell corners at RA 0 or Dec 0)
             and where MOCPy keeps a cell just clear of the edge.
"""
import json, sys
import astropy.units as u
from astropy.coordinates import Angle
import mocpy
from mocpy import MOC


def ascii_of(m):
    return m.to_string(format="ascii")


def json_of(m):
    return m.to_string(format="json")


def rt(name, m, inp=None):
    d = {"name": name, "ascii": ascii_of(m), "json": json_of(m)}
    if inp is not None:
        d["input"] = inp
    return d


roundtrip = []
for name, s in [
    ("mixed orders with ranges", "3/1-3 5 4/40-41 9/"),
    ("four siblings collapse to parent", "3/0-3 3/"),
    ("whole sky", "0/0-11"),
    ("one deep cell, order 29", "29/3458764513820540927"),
    ("empty at order 5", "5/"),
    ("unsorted, orders out of order", "4/45 41 44 46 3/9 2/"),
    ("siblings spread across orders", "4/120-123 3/31 2/6 3/28-29"),
]:
    m = MOC.from_string(s, format="ascii")
    roundtrip.append(rt(name, m, s if ascii_of(m) != s else None))

ops = []
pairs = [
    ("overlapping blocks", "3/1-20 6/", "4/40-120 5/1000-1100"),
    ("disjoint", "2/0-3", "2/40-47 7/"),
    ("nested", "1/2", "4/520-530 8/"),
]
for name, a, b in pairs:
    A = MOC.from_string(a, format="ascii")
    B = MOC.from_string(b, format="ascii")
    ops.append({
        "name": name, "a": a, "b": b,
        "union": ascii_of(A.union(B)),
        "intersection": ascii_of(A.intersection(B)),
        # MOCPy 0.21's A.difference(B) returns an empty MOC when A and B are
        # disjoint or one is inside the other (checked: "2/0-3" minus
        # "2/40-47" gives "2/"). A ∩ complement(B) is the set difference and
        # gives the right answer, so it is the reference here.
        "difference": ascii_of(A.intersection(B.complement())),
        "mocpy_difference": ascii_of(A.difference(B)),
    })

polygons = []
shapes = [
    # name, [(dec, ra)...], max_depth
    ("MOCPy docstring square", [(0, 0), (0, 10), (10, 10), (10, 0)], 5),
    ("Orion-sized quadrilateral", [(-10, 75), (-12, 90), (8, 92), (10, 78)], 9),
    ("concave L-shape", [(20, 150), (20, 160), (24, 160), (24, 154), (30, 154), (30, 150)], 10),
    ("triangle near the north pole", [(80, 0), (82, 120), (78, 240)], 10),
    ("straddling RA 0", [(-5, 355), (-5, 5), (5, 5), (5, 355)], 9),
    ("small region near M31", [(41.2, 10.6), (41.2, 10.75), (41.35, 10.75), (41.35, 10.6)], 14),
    ("large region, 40 degrees", [(-60, 200), (-60, 250), (-20, 250), (-20, 200)], 7),
]
for name, ring, depth in shapes:
    dec = [p[0] for p in ring]
    ra = [p[1] for p in ring]
    m = MOC.from_polygon(Angle(ra, unit="deg"), Angle(dec, unit="deg"), max_depth=depth)
    polygons.append({
        "name": name, "ring": [list(p) for p in ring], "maxOrder": depth,
        "ascii": ascii_of(m),
        "areaDeg2": float(m.sky_fraction * 41252.96124941927),
    })

json.dump({
    "generator": "spec/moc-vectors-generate.py",
    "mocpy": mocpy.__version__,
    "note": "Reference vectors for js/lib/geosonify-moc.js. Regenerate only on purpose.",
    "roundtrip": roundtrip, "ops": ops, "polygons": polygons,
}, sys.stdout, indent=1)
sys.stdout.write("\n")
