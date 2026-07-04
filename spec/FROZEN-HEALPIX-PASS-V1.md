# Geosonify healpix-pass-v1 — FROZEN FORMAT SPECIFICATION (minimal)

**Purpose.** A passphrase-protected or obfuscated HEALPix code (schemes
`hpquad`, `hphex`, `hp64`) generated today must remain decodable in 30–100
years. That holds only if a future implementation reproduces the *exact* keyed
permutation, index shift, and serialization the code used. This document pins
every input so a clean-room reimplementation in any language, decades from now,
produces identical results. The reference oracle
(`spec/healpix-pass-v1-reference.js`) and the vectors below let anyone verify
it. Source of truth: `js/lib/geosonify-healpix.js` (live per `index.html`),
sections marked `FROZEN FORMAT: geosonify-healpix-pass-v1`.

**Design stance.** healpix-pass-v1 invents no cryptography. It reuses the host
app's frozen keyed shuffle — grid-passphrase v1, `FROZEN-FORMAT-SPEC.md` — on
tiny "grids" (1×12 for the face, 1×4 per level), and mirrors the host's
obfuscation *model* (position-based index shift, final token preserved) with
per-position alphabet sizes. One permutation of the location; the three
serializations are renderings of the same result. Goals in order: decodability
for a century, reproducibility from a spec, structural identity with the
vocabulary-grid machinery, and — last — privacy against casual observers.

**The core rule.** Everything in sections 1–3 is immutable. Changing the chain
semantics, the shift formula, the token order, the pipeline order, or any
serialization does not "upgrade" the scheme — it silently decodes existing
codes to a *different valid-looking cell*, not an error. Bare codes carry no
version field. **This is v1 forever.** New behaviour = a new, explicitly named
scheme.

---

## 1. Frozen derivation (immutable)

### 1.0 Token stream
A HEALPix location at order *k* is the token sequence
```
[ face (0..11), child₁ (0..3), child₂ (0..3), …, child_k (0..3) ]
```
produced by HEALPix NESTED `ang2pix` (Górski 2005 — a published standard,
vendored in `geosonify-healpix.js`; its spherical geometry is outside this
spec's scope but inside the freeze: the vendored implementation must keep
producing identical indices). Orders are clamped to `MIN_ORDER = 1`,
`MAX_ORDER = 73` on both encode and decode.

### 1.1 Keyed permutation (passphrase)
The host's frozen shuffle is injected as
`shuffleFn(grid, pass, chainPrefix) → { order }`. In the app that is
`shuffleGridAndOrder` = **grid-passphrase v1** with **genuine SHA3-512
(FIPS 202)** — verified this run byte-for-byte against the reference
derivation. Only `N`, the passphrase, and the chain enter the derivation; the
grid *values* (the `_row(n)` arrays `[[0..n-1]]`) are irrelevant.
(⚠ Contrast: the vocabulary-grid *obfuscation* layer in the codec engine uses a
different, custom, non-FIPS hash — see `FROZEN-GEOCODEC-OBFUSCATION.md` §1.0.
Do not conflate the two derivations.)

`order[p]` = original index now sitting at position `p`, hence the direction
convention (must match exactly):
```
encode:  displayed = order.indexOf(true)
decode:  true      = order[displayed]
```

Per token:
- **face:** `order = shuffleFn(1×12 grid, pass, '')` — empty chain;
- **each level i:** `order = shuffleFn(1×4 grid, pass, chain)` where `chain` is
  the comma-joined list of **TRUE** indices chosen so far — the TRUE face
  first, then each TRUE child, all in decimal (`"9"`, then `"9,1"`,
  `"9,1,1"`, …).

The chain is always built from TRUE values, which are available in both
directions (encode knows them as input; decode recovers each token before
processing the next), exactly mirroring how the vocabulary grids chain. An
empty passphrase (or no `shuffleFn`) means identity — the plain public code.

### 1.2 Obfuscation (position-based index shift)
Token sequence `[face, child₁ … child_k]`, alphabet sizes `[12, 4, 4, …]`.
Every token **except the final one** (the deepest child; the face is therefore
always shifted whenever k ≥ 1, by `d = k`) is shifted by its distance-from-end
`d` (1 for 2nd-last, 2 for 3rd-last, …) over its **own** alphabet size `N`:
```
encode:  v' = ((v − d) % N + N) % N        ← DOUBLE-mod TRUE modulo
decode:  v' = (v + d) % N
```
The double-mod on encode is **load-bearing**, not style: levels have `N = 4`
while `d` runs up to `k` (default 22), so `v − d + N` is routinely negative.
The vocabulary-grid engine's single-`+N` variant, `(v − d + N) % N`, produces
negative digits here and is **wrong**; the `obf_long` vector (§5.3) detects
that mistake mechanically. (Conversely, do not "fix" the codec engine's
single-`+N` to a double-mod — each formula is frozen for its own format.)

### 1.3 Pipeline order (immutable)
```
encode:  truePath → permutePath (if pass) → obfuscatePath (if obf) → serialize
decode:  deserialize → obfuscatePath decode (if obf) → unpermutePath (if pass)
```
Permute-then-obfuscate, mirroring the vocabulary grids. Both toggles are
independent; either, both, or neither may be active.

### 1.4 Why this is engine- and century-stable
- The permutation inherits grid-passphrase v1's stability arguments verbatim
  (strict total order, NFC, UTF-8, `u32le`, FIPS SHA3-512): see
  `FROZEN-FORMAT-SPEC.md` §1.4.
- The chain is decimal-with-commas, so `2` then `9` (`"2,9"`) never collides
  with `29`; face and child indices share one unambiguous alphabet.
- The shift is pure integer arithmetic with an explicit true modulo — no
  floats, locales, or sort-stability dependence anywhere in this layer.

---

## 2. Serializations (immutable)

Each writes the (possibly permuted/obfuscated) `(face, digits)` pair; each has
an exact inverse given the order *k*.

| Scheme | Form | Parse rules (exact) |
|---|---|---|
| `hpquad` | `'f' + face + '.' + digits` e.g. `f9.2212233032` | regex `^f(\d{1,2})\.?([0-3]*)$` — **lowercase `f` required**, dot optional on parse, face 0–11; self-describing (digit count = order) |
| `hphex` | leading nibble `'0123456789AB'[face]`, then **2 levels per hex char** | input trimmed and **uppercased** (case-insensitive); face nibble 0–B |
| `hp64` | leading face token `'0123456789AB'[face]`, then **3 levels per base64url char** over `A–Z a–z 0–9 - _` | face token case-insensitive; **body case-sensitive** |

**Packing (`packBase`/`unpackBase`).** Digits group **from the left** (level 1
first); a short final group is padded on the **right** with zero-children,
each char = big-endian base-4 within its group. Decoding trims right down to
the caller's order (a shorter code is a prefix of a deeper one). ⚠ Comment/code
disagreement, code wins: a comment inside `decode()` says the packing
"left-pads" — the code (and `packBase`'s own comment) pad on the **right**.

**Order on decode.** Precedence: an explicit `@k` suffix on the string
(`/^@\d{1,2}$/` after the last `@`) is authoritative → then the caller-passed
order → then inference from length. `hpquad` needs no suffix;
`encodeStandalone` appends `@k` for `hphex`/`hp64` because length alone cannot
distinguish e.g. order 7 from 8 (§5.4's K=7 vector demonstrates). Decode
rejects results outside lat ±90 / lon ±180.

**Present but unused:** `serHex` contains an `opt.separateFace` branch
(face peeled out after a dot). **No shipped caller ever sets it** (verified by
grep; `geosonify-healpix-path.js` explicitly deletes it). The folded form above
is the only live form; the branch is noted so nobody mistakes it for a live
format. [UNRESOLVED: whether `separateFace` will ever be activated — if so it
must arrive as a new named scheme, not a change to these.]

---

## 3. What composes with this (also frozen)

- **grid-passphrase v1** (`FROZEN-FORMAT-SPEC.md` + oracle) — the injected
  shuffle. `node spec/grid-passphrase-v1-reference.js --selftest` must keep
  passing.
- **HEALPix NESTED** (vendored, Górski 2005) — lat/lon ↔ `(face, digits)`.
- The public `HealpixGrids.encode/decode` wrappers (clamping, `@k` handling,
  bounds check) as quoted in §2.

---

## 4. What this protects (and doesn't)

With a passphrase, privacy rests entirely on grid-passphrase v1 (see its spec's
threat model — a private coordinate language, not encryption). Obfuscation
alone is keyless and defeats only casual reading. All three serializations
render the same permuted stream, so all three are identically private —
representation ≠ breakability.

---

## 5. Reference oracle & test vectors

Run `node spec/healpix-pass-v1-reference.js --selftest` (exits non-zero on any
failure). All vectors were captured from the **shipped, unmodified** code this
run. Passphrase for all keyed vectors: `Back Bay`.

### 5.1 Permutation orders
```
face,  chain ''    (N=12):  1,10,7,4,6,0,5,9,8,2,11,3
level, chain '5'   (N=4):   2,1,0,3
level, chain '5,2' (N=4):   0,2,1,3
```

### 5.2 permutePath
```
true  f=5, digits 2,3,0,1,2   →   displayed f=6, digits 0,3,1,0,3
(face: indexOf(5) in the face order above = 6; chains '5' → '5,2' → '5,2,3' → …)
unpermutePath round-trips exactly.
```

### 5.3 obfuscatePath
```
short: f=5, digits 2,3,0,1,2  → encode →  f=0, digits 2,0,2,0,2
       (face d=5: ((5−5) mod 12) = 0; final child 2 unchanged)

long:  f=1, digits 3,1,0,2,2,1,3,0,0,1,2,3   (k=12; face d=12 ≡ 0 mod 12)
       → encode →  f=1, digits 0,3,3,2,3,3,2,0,1,3,1,3
       SENTINEL: the single-+N formula yields 1, 0,−1,−1,−2,−1,−1,2,0,1,3,1,3 —
       negative digits — and MUST fail here.
Both round-trip exactly under decode.
```

### 5.4 End-to-end (lat −43.5321, lon 172.6362; pass `Back Bay`; obfuscation ON)
**Order k = 10.** True path from shipped `ang2pix`: `f=9`,
digits `1,1,1,2,0,2,1,1,0,0`.
```
permuted    f=7, digits 3,2,0,0,3,3,2,2,0,2
obfuscated  f=9, digits 2,2,1,2,2,3,3,0,3,2     (face: ((7−10) mod 12) = 9)
codes       hpquad f9.2212233032   hphex 9A6BCE   hp64 9przg
plain codes hpquad f9.1112021100   hphex 956250   hp64 9ViUA
all three decode (with k=10, same opts) back to the true path; shipped decode
returns the cell centre [-43.55603886743859, 172.67441860465112] (bit-exact).
```
**Order k = 7 (odd — exercises hphex right-padding of the half-filled final
nibble).** True path `f=9`, digits `1,1,1,2,0,2,1`.
```
hphex code 05168   (plain 95624)
decodes back only with k=7; decoding at k=8 yields a different path (the '@k'
suffix / caller order is load-bearing).
```

### Verification performed this run
The oracle's `--selftest` reproduces every vector above, including the
single-`+N` sentinel. A differential harness additionally ran the **shipped,
unmodified** `geosonify-healpix.js` in Node across **1,350 randomized cases**
with **0 mismatches**: (a) the shipped `shuffleGridAndOrder` extracted verbatim
from `card-renderer.js` and run with js-sha3, vs the oracle's derivation, over
N ∈ {12, 4}, five passphrases (incl. Unicode/NFC pairs) and five chains;
(b) shipped internal `permutePath`/`unpermutePath`/`obfuscatePath` vs the
oracle on random paths up to k = 22; (c) shipped public
`HealpixGrids.encode`/`decode` vs the oracle's pipeline, all three schemes,
random lat/lon/order/pass with each toggle combination, decode centres
cross-checked bit-exactly.
