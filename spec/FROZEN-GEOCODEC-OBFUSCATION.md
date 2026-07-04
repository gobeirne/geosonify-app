# Geosonify GeoCodec obfuscation — FROZEN FORMAT SPECIFICATION (minimal)

**Purpose.** An obfuscated Geosonify code (the "🔀 Obfuscated" toggle) generated
today must remain decodable in 30–100 years. That holds only if a future
implementation can reproduce the *exact* seed derivation, shuffle, and index
shift the code used. This document pins every input, byte for byte, so a
clean-room reimplementation in any language, decades from now, produces
identical results. The reference oracle (`spec/geocodec-obfuscation-reference.js`)
and the vectors below let anyone verify it. Source of truth:
`js/lib/geosonify-codec-engine_v11_8a.js` (live per `index.html`), with the
call-site contract in `js/card-renderer.js`.

**Design stance.** Obfuscation is a *casual-observer* privacy layer, not
encryption. Its keying material is public (the code's own final token), so it
hides nothing from anyone holding this spec. Its goals, in order: decodability
for a century, reproducibility from a spec, zero configuration (no passphrase
needed), and last, privacy against shoulder-surfing. Real confidentiality lives
in AES URL mode; keyed privacy lives in grid-passphrase mode.

**The core rule.** Everything in sections 1–3 is immutable. Changing any
constant, the hash, the chunk width, the sort, the final-token rule, or which
grid the call sites pass does not "upgrade" the scheme — it silently decodes
every existing obfuscated code to a *different valid-looking location*, not an
error. A bare obfuscated code carries no version field, so versions cannot
coexist. **This derivation is frozen forever.** New behaviour requires a new,
explicitly named mode.

---

## 1. Frozen derivation (immutable)

### 1.0 ⚠ CRITICAL: the hash is NOT SHA3-512, despite its name

The engine's header says "Includes SHA3-512" and the function is named
`sha3_512_hex`, but the hand-rolled implementation **deviates from FIPS 202**
in two load-bearing ways (verified this run against Node's and js-sha3's
genuine SHA3-512 — see §5.1):

1. **Nonstandard ι (iota) round constants.** A 38-entry table
   `[1,0, 0,89, 0,28, 0,169, 0,2, 0,7, 0,0x8000000a, 0,0x80000008,
   0,0x80000001, 0,0x80000080, 0,0x8b, 0,0x8a, 0,0x81, 0,0x80000081,
   0,0x80000008, 0,0x83, 0,0x8000000b, 0,0x8000001b, 0,0x1b]`
   supplies (lo, hi) pairs XORed into lane 0 for rounds 0–18 only; rounds
   19–23 XOR **zero** (`undefined >>> 0`). The table does not match the Keccak
   round constants.
2. **Nonstandard sponge.** Each 32-bit little-endian message word *w* is
   absorbed into the **low half of lane w** (state slot `a[2w]`); the high
   halves of lanes never receive message or padding bytes, and the squeeze
   likewise reads only the low halves of lanes 0–15. Rate is 72 bytes and the
   pad bytes are `0x06 … 0x80` as in SHA-3, but placed under the same
   low-half-only mapping.

θ/ρ/π/χ and the ρ offset table **are** standard Keccak-f[1600]. The result is a
deterministic, Keccak-shaped custom hash — which is all the derivation needs —
but a re-implementer who reaches for a stock SHA3-512 library will produce
wrong codes with no error. **Code wins over comments: the custom hash is the
frozen truth.** The oracle contains a line-for-line faithful port
(`GeoCodecSha3` / `geoCodecHashHex`); its output is 128 lowercase hex chars.
Blast radius: this hash is used **only** inside the codec engine for this
derivation (verified by grep); grid-passphrase and AES URL mode use genuine
SHA3-512 (js-sha3 / WebCrypto).

### 1.1 Constants
| Element | Value (exact) |
|---|---|
| Seed preimage | `"0,1,2,…,N-1" + "\|" + String(lastIndexFlat)` — decimal, ASCII, comma-joined, single pipe |
| Hash | the engine's custom Keccak-variant (§1.0), UTF-8 input, 128-char lowercase hex output |
| Seed length | exactly `3·N` hex chars, via hash-extension (§1.2) |
| Chunk width | `floor(seedLen / N)` = **3** hex chars (values `0x000`–`0xfff`) |
| Sort | ascending by chunk value; **ties broken by smaller original index** |
| Final token | **never shifted**; it both keys the shuffle and survives verbatim |

`N` is the vocabulary size (flattened grid length); `lastIndexFlat` is the
index of the code's **final token** in the flat vocabulary the code was encoded
with (§3 says which flat that is).

### 1.2 Seed derivation (hash-extension)
```
h = hash( "0,1,…,N-1" + "|" + lastIndexFlat )          // 128 hex chars
while h.length < 3·N:
    h = h + hash(h)          // hashes the ENTIRE accumulated hex string
                             // (as ASCII text), not just the last block
    if h.length > 10000: break        // unreachable for N ≤ 3333;
                                      // largest shipped grid is 45×45 = 2025
seed = first 3·N chars of h
```

### 1.3 Shuffle order
```
for i in 0 .. N-1:  key[i] = parseInt(seed[3i .. 3i+2], 16)      // 0..4095
order = [0 .. N-1] sorted ascending by key[i], ties by smaller i
shuffled[p] = flat[order[p]]
```
The shipped comparator is `a.k - b.k` under JavaScript's spec-guaranteed stable
sort (ES2019+); the explicit tie-break by smaller `i` is the engine-independent
statement of the same total order. **Ties are real**, not theoretical: keys
live in 0..4095, so any N ≳ 75 collides with high probability and N > 4096
collides always. §5.2 pins a concrete tie.

### 1.4 The obfuscation map
Given a code and the flat vocabulary it was encoded with:
1. Tokenize the code greedily, longest-token-first, over the unique tokens of
   `flat` (multi-character vocabularies like NATO/BIP39 depend on this).
2. `lastToken` = final token; `lastIndexFlat = flat.indexOf(lastToken)`;
   derive `order` and `shuffled` per §§1.2–1.3.
3. Map each token to its index in `shuffled`. Let the token count be `n`.
4. The **final token is emitted unchanged** (`shuffled[indexOf(t)] = t`).
5. Every non-final token at distance-from-end `d` (1 for 2nd-last, 2 for
   3rd-last, …) has its shuffled index `p` shifted:
   - **encode:** `p' = (p − d + N) % N`  — a **single** `+N` under JavaScript
     remainder semantics (see caveat below)
   - **decode:** `p' = (p + d) % N`
6. Output token = `shuffled[p']`; concatenate; finally truncate at the literal
   substring `undefined` if present (defensive `sanitizeNoUndefined`; inert for
   valid input).

**Domain caveat (single `+N`, verified in code).** The encode formula is a true
modulo only while `d ≤ N + p`. If a code ever had more than `N+1` tokens, the
earliest tokens would produce negative indices, the shipped
`indexTokensToCode` would return `null`, and the engine would emit **only the
final token**. No shipped grid/iteration combination reaches that regime
(iteration caps ≪ N), but a re-implementation must reproduce the formula
as written, not "fix" it — contrast healpix-pass-v1, whose shift is a
double-mod true modulo (`FROZEN-HEALPIX-PASS-V1.md`).

Because decode re-tokenizes the obfuscated code and its final token equals the
plain code's final token, `lastIndexFlat` — the entire key — is recoverable
from the code itself. That is the design: self-keying, zero configuration.

### 1.5 Why this is engine- and century-stable
- The sort is a strict total order once the tie-break is stated; the oracle
  states it and pins a real tie (§5.2).
- The seed preimage is pure ASCII; no locale, float, or Unicode normalization
  enters the derivation anywhere.
- The custom hash is frozen by a faithful reference port plus anchor vectors
  (§5.1) — re-implementable from the oracle in any language. It must **never**
  be "corrected" to real SHA3-512.
- `parseInt(chunk, 16)` on exactly-3 hex chars is integer-exact everywhere.

---

## 2. What the derivation composes with (also frozen)

- **The hierarchical codec.** Plain codes come from equirectangular row-major
  subdivision of `[-90,90]×[-180,180]` (row 0 = northernmost). The engine's
  bounds arithmetic is `boundsForCell`: `latMin = latMax − dLat·(r+1)`,
  `latMax = latMax − dLat·r`, `lonMin = lonMin + dLon·c`,
  `lonMax = lonMin + dLon·(c+1)`. This exact floating-point expression order is
  part of the freeze: the algebraically equal `latMax = latMax − dLat·r;
  latMin = latMax − dLat` drifts by ULPs and can flip a deep cell (observed on
  the 45×45 BIP39 grid at iteration 10 during this run's differential testing).
  Note the passphrase-chained path in `card-renderer.js`
  (`_encodeCardCoordinateInternal`) uses that second expression — both are
  shipped, each frozen for its own path.
- **The base grids** (`geosonify-grids-data.js`) — already frozen; see
  `FROZEN-FORMAT-SPEC.md` §2.
- **The grid-passphrase permutation** — frozen in `FROZEN-FORMAT-SPEC.md`;
  needed here only to construct the layer-1 flat (§3).

---

## 3. Call-site contract (which `flat` keys the shuffle) — immutable

Verified in `card-renderer.js` (`_encodeCardCoordinateInternal`,
`decodeCardCoordinate`) and the inline `index.html` delta paths:

- **No passphrase:** `flat` = the base grid, flattened row-major.
- **With passphrase:** `flat` = the **layer-1 (empty-chain)** grid-passphrase
  shuffle of the base grid — `getShuffledGrid(gridKey, '')` — even though the
  hierarchical encoding itself used per-level *chained* shuffles. The per-level
  chained grids are **never** used for obfuscation. §5.4 pins a wrong-grid
  sentinel that any reimplementation making this mistake will hit.
- **Pipeline order:** encode = chained hierarchical encode **first**, then
  obfuscate over the layer-1 flat. Decode = de-obfuscate over the layer-1 flat
  **first**, then chained hierarchical decode.
- **Deltas:** the inline-script delta paths obfuscate each delta chunk
  independently as its own code over the same flat. A delta is a suffix of the
  full code ending at the same final token, so the shuffle key — and the
  preserved final character — are identical.

The engine banner reads `v11.7a` while the live filename is `_v11_8a`; a
comment-level discrepancy only — the code text is the truth and is what this
spec pins. (Similarly, the header's "SHA3-512" claim is overruled by §1.0.)

---

## 4. What this protects (and doesn't)

The key (`lastIndexFlat`) is printed in the code itself; anyone with this spec
decodes any obfuscated code instantly. Obfuscation defeats casual reading and
accidental correlation of nearby codes, nothing more. For keyed privacy use
grid-passphrase mode; for confidentiality use AES URL mode. Never advertise
obfuscation as security.

---

## 5. Reference oracle & test vectors

Run `node spec/geocodec-obfuscation-reference.js --selftest` (exits non-zero on
any failure). All vectors below were captured from the **shipped, unmodified**
code this run.

### 5.1 Anchor hashes (pin the custom hash — and prove it's nonstandard)
Preimage (ASCII): `0,1,2,…,35|0` (i.e. `buildIndexSeedString(36, 0)`).
```
engine hash  = b0e83a15b65bd2211ac48165392f95905f2945c4f598e390b9a1cc855bda3aac
               7166951fb6f14ad07b0e025920c80131066b0a06e978a15dec709d20ce7adb4a
REAL SHA3-512 = 2a7a062c1314c05cba42fb8ea617626dde1547cfbab6e38c7c1a4e83490c42ba
               296806beb9603e43c2554bc5d2598c486110e2e073c9bbab6dc1541851e53b4e   (must NOT match)
```
`seed(36, 0)` = the first 108 chars of the engine hash (no extension round for
N = 36, since 3·36 = 108 ≤ 128).

### 5.2 Tie vector (pins the stable tie-break)
In `seed(36, 0)`, chunks `i = 0` and `i = 27` are both `b0e` (= 2830). The
order **must** place original index 0 before 27 (they land at shuffled
positions 24 and 25 — see §5.3).

### 5.3 Shuffle orders — `order[]`
```
N=36, lastIndexFlat=0:
28,32,34,5,31,25,2,7,17,15,8,20,12,13,23,3,22,1,18,10,29,35,14,33,0,27,24,16,19,6,21,30,26,4,11,9

N=36, lastIndexFlat=20:
5,20,1,2,35,17,4,12,33,9,26,14,23,31,24,15,22,13,32,19,29,11,10,0,6,16,30,25,21,8,18,28,27,7,3,34
```
A 256-element vector (`N=256, lastIndexFlat=171`, exercising two extension
rounds) is embedded in the oracle.

### 5.4 End-to-end vectors (alphanumeric 6×6; lat −43.5321, lon 172.6362; 9 iterations)
**Plain (no passphrase):**
```
plain code   thp9enl5q
obfuscated   yjkbmtanq        ← final 'q' unchanged; all others shifted
decodes to   [-43.53210198045268, 172.63619184385]   (bit-exact doubles)
```
**Passphrase `Back Bay` + obfuscation:**
```
layer-1 flat (base flat permuted by gridPassphraseOrderV1(36,'Back Bay','')):
             l1eaqokmt7rxysh46f0zuijnwdvc598pg2b3
chained plain code (TRUE-index chain 29,17,25,9,14,23,21,5,26):
             9lco0qd8t
obfuscated over the LAYER-1 flat:      x4hpzbhot     ← the correct, shipped code
WRONG-GRID SENTINEL — obfuscated over the final-level chained shuffle
(chain 29,17,25,9,14,23,21,5) instead: siefxz3kt     ← a per-level-grid
                                                        reimplementation
                                                        produces this and FAILS
```

### Verification performed this run
The oracle's `--selftest` reproduces every vector above (including the tie and
the real-SHA3 ≠ engine-hash assertion). A differential harness additionally ran
the **shipped, unmodified** engine (`GeoCodec.applyObfuscation`,
`encodeHierarchical`, `decodeHierarchical`) and the shipped
`CardRenderer` passphrase path in Node across **1,860 randomized cases** —
grids alphanumeric (36), hexByte (256), base64 (64), NATO (36, multi-char
tokens), BIP39-English (2,025, hash-extension + real key ties); random codes
encode/decode/round-trip plus random lat/lon end-to-end — with **0 mismatches**
against the oracle. The `Back Bay` end-to-end code above was produced by the
shipped `encodeCardCoordinate` with passphrase and obfuscation state set, and
decoded back by the shipped `CardRenderer.decode`.
