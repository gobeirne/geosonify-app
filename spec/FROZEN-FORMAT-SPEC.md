# Geosonify grid-passphrase — FROZEN FORMAT SPECIFICATION v1 (minimal)

**Purpose.** A passphrase-protected Geosonify code generated today must remain
decodable in 30–100 years. That holds only if a future implementation can
reproduce the *exact* keyed permutation a code used. This document pins every input
to that permutation, byte for byte, so a clean-room reimplementation in any
language, decades from now, produces identical results. The reference oracle
(`grid-passphrase-v1-reference.js`) and the vectors below let anyone verify it.

**Design stance.** Grid-passphrase mode is a *private coordinate language*, not an
encryption system. Its design goals, in order, are: decodability for a century,
reproducibility from a spec, simplicity, and — last — privacy against casual
observers. It is deliberately minimal: NFC + a domain-separation prefix + SHA3-512
+ a deterministic permutation. There is **no PBKDF2, HMAC, salt, or iteration
count** here; that machinery lives in AES URL mode, which is the right tool when
real confidentiality is needed.

**The core rule.** Everything in section 1 and section 2 is immutable. Changing any
constant, byte ordering, or base grid does not "upgrade" the scheme — it silently
breaks every code ever made, because a wrong derivation yields a *different
valid-looking location*, not an error. A bare code (e.g. `surface marble canvas
drift`) has nowhere to carry a version field, so versions cannot coexist and be
told apart by the decoder. Therefore **this is v1 forever.** To strengthen privacy,
use AES URL mode (which carries its own version + parameters). Add new grids or new
explicitly named modes if needed later, but never mutate this one.

---

## 1. Frozen derivation (immutable)

### 1.1 Constants
| Element | Value (exact) |
|---|---|
| Domain-separation prefix | `geosonify-grid-pass-v1\|` (exact spelling, case, hyphens, trailing pipe) |
| Hash | SHA3-512 (FIPS 202), 64-byte output |
| Passphrase normalisation | Unicode **NFC**, then UTF-8 |
| Chain join | decimal cell indices joined with `,` ; always wrapped as `\|chain:` + chain |
| Cell index encoding | unsigned 32-bit **little-endian** (`u32le`) |

### 1.2 The keyed permutation
For a base grid of N cells, a passphrase, and the running `chain`:
```
preimage = UTF-8( "geosonify-grid-pass-v1|" + NFC(passphrase) + "|chain:" + chain )
for i in 0 .. N-1:
    sortKey[i] = SHA3-512( preimage || u32le(i) )
order = [0 .. N-1] sorted ascending by sortKey[i],
        compared lexicographically over the 64 hash bytes (byte 0 first),
        ties broken by smaller i.
```
`order[p]` is the original grid-cell index now at shuffled position `p`. Encoding
selects symbols by shuffled position; decoding inverts `order`. An empty passphrase
means the identity permutation (public encoding).

### 1.3 The chain
`chain` is the comma-joined list of base-grid flat indices chosen for the preceding
iterations: `""` for the first character, then `"3"`, then `"3,17"`, and so on.
Comma-separation is required so 2 then 9 (`"2,9"`) never collides with 29. The
`|chain:` marker is **always present**, including for the empty first chain
(preimage ends `…|chain:`). Chaining couples each iteration to previous choices so
symbols can't be decoded independently.

### 1.4 Why this is engine- and century-stable
- The sort comparator is a strict **total order** (tie-break by `i`), so the result
  is independent of the sort algorithm and of any language's sort stability.
- **NFC** is covered by Unicode's Normalization Stability Policy: a string's NFC
  form never changes in future Unicode versions. (Do not "upgrade" to NFKC — that
  is a different mapping and would change old codes.)
- UTF-8, little-endian `u32le`, and byte comparison are locale- and float-free.
- **SHA3-512** is a FIPS 202 standard, re-implementable from the spec or available
  in essentially every language's standard library — which is exactly why the
  scheme uses nothing more exotic. (Keep a vendored copy of the in-browser SHA3
  library in the repo so the app never depends on a CDN that may vanish.)
- Known, accepted property: a passphrase containing the literal substring
  `|chain:` could in principle collide with a different (passphrase, chain) pair.
  This never affects decodability (a given passphrase+chain is always reproducible)
  and is irrelevant to the threat model; it is noted only for completeness.

---

## 2. The base grids are also frozen

The permutation is applied to a specific base grid (the 6×6 = 36-cell alphanumeric
grid, the 45×45 = 2025-cell BIP39 grids, the 16×16 = 256-cell hex grid, etc.) whose
**cell order is itself an input** — true even with no passphrase. For long-term
decodability the contents and ordering of every shipped grid in
`geosonify-grids-data.js` must be frozen exactly as published. Treat grids like a
dictionary: you may publish new ones, but changing what an existing entry means
(swapping a BIP39 word, reordering cells) makes old codes in that grid decode to
the wrong place. **Add new grids; never edit a shipped one.**

---

## 3. What actually protects a code for 100 years

There is no key-stretching here, by choice, and that is fine for the threat model:
- **A strong passphrase carries the century.** Passphrase entropy does not decay —
  a 6-word diceware phrase is as infeasible to brute-force in 2125 as today.
- **A weak passphrase is weak, with or without stretching.** Stretching only helps
  in a narrow band that shrinks as hardware improves, and it cannot be added later
  without breaking the format. So the honest, load-bearing guidance is simply: use
  a high-entropy passphrase. The UI should encourage this.
- **Grid-passphrase mode hides the coordinate value from people outside the
  passphrase group; it does not hide metadata** (that a code exists, its length and
  therefore approximate precision, often its grid vocabulary) and is not
  authenticated. For confidentiality beyond "a casual observer can't read it," use
  AES URL mode.

---

## 4. AES URL mode is future-proof by contrast (not part of this freeze)

AES blobs are self-describing: `version[1] | iterations[3] | salt[16] | iv[12] |
ciphertext+tag`, header bound as GCM AAD. A future decoder reads the iteration count
from the blob, so old links keep decoding after you raise the default for new ones,
and the version byte lets the format evolve. Long-term dependencies are only the
published standards AES-256-GCM, PBKDF2-HMAC-SHA256 and SHA3-512.

---

## 5. Reference oracle & test vectors

`grid-passphrase-v1-reference.js` is a dependency-free Node implementation (uses
only built-in SHA3-512). Run `node grid-passphrase-v1-reference.js --selftest` to
confirm it reproduces the vectors below, or
`node grid-passphrase-v1-reference.js <N> "<passphrase>" "<chain>"` to print any
permutation. js-sha3 (in-browser) and Node's native SHA3-512 were verified to
produce identical output for all vectors.

### 5.1 Anchor hash
`SHA3-512( "geosonify-grid-pass-v1|Back Bay|chain:" || u32le(0) )` =
```
90454924e467af967ed17dee0f09b4aab0d6107f66164f8cf84a50230fa14411
a8f7cb225b03bcdd385f589c4ead375d187405499a0bbaf9e97508e7736686df
```

### 5.2 NFC equivalence (CRITICAL — each pair MUST give the same permutation)
```
"é"     U+00E9            ==  "é"     U+0065 U+0301
"Māori" U+004D U+0101 …   ==  "Māori" U+004D U+0061 U+0304 …   (Māori macron)
```

### 5.3 Permutation order — `order[]`
```
N=36   pass="Back Bay"  chain=""
  21,1,14,10,26,24,20,22,29,7,27,33,34,28,17,4,6,15,0,35,30,18,19,23,
  32,13,31,12,5,9,8,25,16,2,11,3

N=36   pass="Patriots"  chain="3,17"
  3,17,34,12,16,7,15,13,31,20,22,33,24,23,0,19,5,18,26,9,10,21,32,27,
  29,14,1,8,11,6,30,28,35,25,2,4

N=256  pass="Patriots"  chain=""
  232,44,171,216,169,109,16,63,30,168,201,123,55,233,137,132,28,200,124,
  22,99,80,8,251,234,118,36,23,187,243,181,162,4,193,95,7,41,177,175,231,
  254,153,207,154,230,138,119,15,93,3,188,65,84,14,191,92,20,229,66,79,
  167,10,110,47,136,149,46,26,70,158,164,98,12,50,210,133,76,204,240,183,
  155,73,246,173,39,40,2,94,51,78,58,225,1,166,196,148,104,197,34,27,152,
  245,107,239,5,43,29,18,179,248,253,221,212,11,57,129,125,53,38,163,64,
  21,68,194,139,35,165,178,208,228,238,219,176,122,106,199,67,130,215,134,
  140,189,74,185,172,13,9,255,174,213,150,151,90,83,49,236,146,97,72,218,
  241,244,223,235,61,250,32,205,37,81,144,252,115,247,71,102,180,0,42,202,
  6,121,147,117,131,62,198,143,190,88,48,103,91,182,156,141,33,89,192,186,
  145,24,157,211,135,54,126,128,105,116,31,206,45,60,161,17,77,214,242,220,
  226,112,59,160,19,222,85,249,69,56,217,75,227,25,203,96,159,114,237,195,
  108,209,82,86,101,100,127,120,170,113,87,142,111,184,224,52
```
(Generate the 2025-cell BIP39 vector with the reference oracle and commit it too.)

### 5.4 Recommended: also commit END-TO-END vectors
The vectors above lock the keyed-permutation layer (the part hardest to re-derive).
For full coverage, capture a handful of real `lat,lon + grid id + passphrase +
precision → exact code → decoded lat,lon` examples from the shipped app and commit
them, so the regression set also covers the base grids and the hierarchical
encoder. Only ever *add* to this set; never regenerate it.
