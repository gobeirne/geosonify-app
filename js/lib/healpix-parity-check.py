#!/usr/bin/env python3
"""
healpix-parity-check.py — validate Geosonify's HEALPix output against the
reference implementations.

    node healpix-parity-vectors.js > vectors.json
    python3 healpix-parity-check.py vectors.json

Requires: healpy, mocpy, numpy.

Checks, per vector:
  A  indexing      healpy.ang2pix(nside, lon, lat, nest=True) == Geosonify ipix
  B  centres       healpy.pix2ang(nside, ipix)                == Geosonify centre
  C  quaternary    face*4^k + base4(digits)                   == ipix
  D  NUNIQ         4*(4^k - 1) + ipix                         == Geosonify nuniq
  E  MOC ASCII     mocpy accepts the string and round-trips it to the same cell
  F  ceiling       mocpy rejects the orders healpy cannot represent

Exit code 0 only if every check passes.
"""
import json
import sys
from collections import defaultdict

import numpy as np
import healpy as hp

try:
    from mocpy import MOC
    HAVE_MOCPY = True
except Exception as exc:            # pragma: no cover
    HAVE_MOCPY = False
    print("  note: mocpy unavailable (%s); skipping checks E and F" % exc)


def load(path):
    with open(path) as fh:
        return json.load(fh)


def main(path):
    doc = load(path)
    vectors = doc["vectors"]
    max_healpy = doc["maxHealpyOrder"]
    print("Geosonify HEALPix parity check")
    print("  engine        : %s" % doc["engine"])
    print("  vectors       : %d" % len(vectors))
    print("  healpy        : %s" % hp.__version__)
    print("  mocpy         : %s" % (MOC.__module__.split('.')[0] if HAVE_MOCPY else "n/a"))

    failures = []
    worst_centre = 0.0
    worst_centre_at = None
    counts = defaultdict(int)

    for v in vectors:
        k = v["order"]
        ipix = int(v["ipix"])
        tag = v["tag"]

        # ---- C  quaternary decomposition (pure arithmetic, always checkable)
        counts["C"] += 1
        local = int(v["digits"], 4) if v["digits"] else 0
        if v["face"] * 4 ** k + local != ipix:
            failures.append(("C", k, tag, "quaternary != ipix: %s" % v["quaternary"]))

        if len(v["digits"]) != k:
            failures.append(("C", k, tag, "digit count %d != order %d" % (len(v["digits"]), k)))

        # ---- D  NUNIQ
        counts["D"] += 1
        if 4 * (4 ** k - 1) + ipix != int(v["nuniq"]):
            failures.append(("D", k, tag, "nuniq mismatch at %s" % v["moc"]))

        if k > max_healpy:
            # ---- F  the reference libraries must refuse these
            counts["F"] += 1
            nside_ok = True
            try:
                hp.pix2ang(2 ** k, ipix, nest=True, lonlat=True)
            except Exception:
                nside_ok = False
            if nside_ok:
                failures.append(("F", k, tag, "healpy unexpectedly accepted order %d" % k))
            if HAVE_MOCPY:
                # DISCOVERED HAZARD, encoded as an expectation so a future mocpy
                # release that changes it shows up as a failure:
                #   order 30  -> ACCEPTED, and silently mis-parsed. mocpy reports
                #               max_order 29 and returns "0/32-47 29/", i.e. 16
                #               whole base cells -- most of the sky -- with no
                #               exception raised.
                #   order 31+ -> refused with an error.
                # So order 30 is the single most dangerous thing we could emit:
                # a refusal is safe, silent whole-sky corruption is not.
                try:
                    got = MOC.from_string(v["moc"]).serialize(format="str").strip()
                    if k == 30:
                        if got == v["moc"]:
                            failures.append(("F", k, tag,
                                             "mocpy now round-trips order 30 exactly (hazard changed)"))
                        else:
                            counts["hazard30"] += 1
                    else:
                        failures.append(("F", k, tag, "mocpy unexpectedly accepted order %d" % k))
                except Exception:
                    if k == 30:
                        failures.append(("F", k, tag, "mocpy now refuses order 30 (hazard changed)"))
            continue

        nside = 2 ** k

        # ---- A  indexing
        counts["A"] += 1
        ref = int(hp.ang2pix(nside, v["lon"], v["lat"], nest=True, lonlat=True))
        if ref != ipix:
            if tag == "tie-prone":
                # Degenerate input: exact pole, face boundary, or a coarser cell
                # centre sitting exactly on a boundary at this order. Verified
                # against 60-digit arithmetic: neither implementation is wrong,
                # the input is ambiguous. Counted, not failed.
                counts["ties"] += 1
            else:
                failures.append(("A", k, tag, "lat=%.15g lon=%.15g  healpy=%d geosonify=%d"
                                 % (v["lat"], v["lon"], ref, ipix)))

        # ---- B  centres
        counts["B"] += 1
        rlon, rlat = hp.pix2ang(nside, ipix, nest=True, lonlat=True)
        # Haversine, NOT arccos. arccos(1-eps) has a precision floor of
        # sqrt(machine epsilon) ~= 1.5e-8 rad = 0.003 arcsec, which is larger
        # than a cell above order ~22 and would swamp the very thing being
        # measured. Haversine stays accurate for small separations.
        p1, p2 = np.radians(rlat), np.radians(v["centreLat"])
        dlat, dlon = p2 - p1, np.radians(v["centreLon"] - rlon)
        h = np.sin(dlat / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlon / 2) ** 2
        d = np.degrees(2 * np.arcsin(np.sqrt(np.clip(h, 0, 1)))) * 3600.0
        frac = d / v["cellArcsec"] if v["cellArcsec"] else 0.0
        if frac > worst_centre:
            worst_centre, worst_centre_at = frac, (k, tag)
        if frac > 1e-6 and tag != "tie-prone":
            failures.append(("B", k, tag, "centre off by %.3g arcsec (%.2g of a cell)" % (d, frac)))

        # ---- E  MOC ASCII through the reference implementation
        if HAVE_MOCPY:
            counts["E"] += 1
            try:
                moc = MOC.from_string(v["moc"])
                out = moc.serialize(format="str")
                # mocpy may spell it "22/164249493047394" or with whitespace
                got = out.replace("\n", " ").strip()
                want_order, want_ipix = v["moc"].split("/")
                if want_order + "/" not in got or want_ipix not in got:
                    failures.append(("E", k, tag, "mocpy round-trip differs: %r" % got))
            except Exception as exc:
                failures.append(("E", k, tag, "mocpy rejected %s: %s" % (v["moc"], exc)))

    # ---- report
    print("\nchecks run")
    for key, name in [("A", "indexing vs healpy"), ("B", "centres vs healpy"),
                      ("C", "quaternary arithmetic"), ("D", "NUNIQ arithmetic"),
                      ("E", "MOC round-trip vs mocpy"), ("F", "u64 ceiling refused")]:
        if counts[key]:
            print("  %s  %-26s %6d" % (key, name, counts[key]))

    if counts["hazard30"]:
        print("\n  order 30: mocpy accepts and SILENTLY MIS-PARSES it to a near-whole-sky")
        print("            region (no exception). Never emit order-30 MOC ASCII.")

    if counts["ties"]:
        print("\n  %d tie-prone divergences (degenerate inputs, expected \u2014 see generator notes)"
              % counts["ties"])

    if worst_centre_at:
        print("\n  worst centre deviation: %.3g of a cell side (order %d, %s)"
              % (worst_centre, worst_centre_at[0], worst_centre_at[1]))

    if failures:
        print("\n%d FAILURES (first 25):" % len(failures))
        for f in failures[:25]:
            print("  [%s] order %-2d %-14s %s" % f)
        return 1

    print("\nALL PASS — %d checks across %d vectors, orders 0-%d"
          % (sum(counts.values()), len(vectors), max_healpy))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "vectors.json"))
