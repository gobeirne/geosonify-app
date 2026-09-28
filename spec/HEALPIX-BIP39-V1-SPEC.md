# healpix-bip39-v1 — HEALPix addresses encoded with BIP39 wordlists

**Document status: sections 2–6 FROZEN on 2026-09-29.** Sections are marked individually:

| Section | Status |
|---|---|
| 2 Spatial bitstream, 3 Word counts & half levels | **FROZEN** |
| 4 Word lists | **FROZEN** (pinned by SHA-256) |
| 5 Checksum | **FROZEN** |
| 6 Parsing & normalisation | **FROZEN** |
| 7 Passphrase layer (healpix-bip39-pass-v1) | **Beta — not frozen** |
| 8 Spoken profiles | **Framework only; no approved vocabulary** |
| 9 URL parameter | **Not defined** (none exists in the beta) |

Once a section is frozen it never changes: new behaviour gets a new identifier,
and decoders for frozen versions are kept forever. A wrong derivation does not
error — it silently decodes to a plausible wrong place.

Reference implementation: `js/lib/geosonify-hpwords.js`
(`node js/lib/geosonify-hpwords.js --selftest`). Evidence for §5:
`node spec/hpwords-checksum-eval.js`.

## 1. Scope

The format names an equal-area cell on a sphere — Earth (latitude/longitude) or
sky (declination/right ascension). It does not name objects, and it carries no
frame, epoch, observer or distance: those belong in the surrounding record.
Two objects may share a cell; a moving object changes cell over time.

It reuses BIP39's vocabularies and 11-bit word indexing. It is **not** a BIP39
mnemonic: it uses none of BIP39's entropy, checksum or key-derivation rules.

## 2. Spatial bitstream

Start from a HEALPix NESTED address: base face `f` (0 ≤ f < 12) and a root-first
list of child digits `d = (yBit << 1) | xBit` (the convention of
`geosonify-healpix.js`; `x` is the pixel-local NE axis, `y` the NW axis).

```
bitstream = f as 4 bits | y1 x1 | y2 x2 | y3 x3 | …
```

For N words take exactly the first `11·N` bits (leading zeros kept), split them
left to right into N big-endian 11-bit integers `x_0 … x_{N-1}`, and look each
up in the chosen list. The **indices** are canonical; words are a rendering.

Faces 12–15 do not exist, so `x_0` must be `< 1536`. A first index ≥ 1536 is an
invalid address, not a spare cell.

## 3. Word counts and half levels

`N` ranges over **1–8**. Path bits `p = 11N − 4`; effective order `(11N − 4)/2`.

| N | order | angular width | Earth width |
|---|---|---|---|
| 1 | 3½ | 5.18° | 576 km |
| 2 | 9 | 6.87′ | 12.7 km |
| 3 | 14½ | 9.11″ | 281 m |
| 4 | 20 | 0.201″ | 6.22 m |
| 5 | 25½ | 4.45 mas | 13.7 cm |
| 6 | 31 | 98.3 µas | 3.04 mm |
| 7 | 36½ | 2.17 µas | 67 µm |
| 8 | 42 | 0.048 µas | 1.48 µm |

Widths are square-equivalent (√area) on the HEALPix reference sphere
(Earth: mean surface area 5.10072 × 10¹⁴ m², as in `geosonify-healpix.js`). Every two words add exactly 11 orders.

**Odd N** ends after the `yBit` `b` of the next level. With complete parent
NESTED index `I` at order `k`, the region is exactly the two order-(k+1) cells
`4I + 2b` and `4I + 2b + 1` — contiguous, equal-area, half the parent. It must
never be padded with an `xBit` and decoded as one child.

Dropping the last word always yields the containing parent region.

"Exactly equal-area" holds on the reference sphere. Feeding geodetic latitude
into the spherical projection does not make physical areas on the WGS84
ellipsoid exactly equal.

The implementation uses `PROJECTION_EXACT_ORDER = 26` as its coordinate-conversion
threshold. This is an implementation policy, not a guarantee of correct cell
assignment for every floating-point coordinate near a boundary. Address
serialization and parent/child operations use exact integer arithmetic;
coordinate-conversion accuracy is evaluated separately and is **not** part of
this format. Deeper digits derived from an ordinary coordinate are a
contained-cell refinement, not additional measured information.

## 4. Word lists

Ten official BIP-0039 lists, unmodified, in published order, from
`github.com/bitcoin/bips` commit `3a10b5b5f0a7586df8928d580a3009744ebb2079`,
plus one community list:

| key | source | SHA-256 of file |
|---|---|---|
| english | bip-0039/english.txt | `2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda` |
| spanish | bip-0039/spanish.txt | `46846a5a0139d1e3cb77293e521c2865f7bcdb82c44e8d0a06a2cd0ecba48c0b` |
| french | bip-0039/french.txt | `ebc3959ab7801a1df6bac4fa7d970652f1df76b683cd2f4003c941c63d517e59` |
| italian | bip-0039/italian.txt | `d392c49fdb700a24cd1fceb237c1f65dcc128f6b34a8aacb58b59384b5c648c2` |
| portuguese | bip-0039/portuguese.txt | `2685e9c194c82ae67e10ba59d9ea5345a23dc093e92276fc5361f6667d79cd3f` |
| czech | bip-0039/czech.txt | `7e80e161c3e93d9554c2efb78d4e3cebf8fc727e9c52e03b83b94406bdcc95fc` |
| japanese | bip-0039/japanese.txt | `2eed0aef492291e061633d7ad8117f1a2b03eb80a29d0e4e3117ac2528d05ffd` |
| korean | bip-0039/korean.txt | `9e95f86c167de88f450f0aaf89e87f6624a57f973c67b516e338e8e8b8897f60` |
| chinese_simplified | bip-0039/chinese_simplified.txt | `5c5942792bd8340cb8b27cd592f1015edf56a8c5b26276ee18a482428e7c5726` |
| chinese_traditional | bip-0039/chinese_traditional.txt | `417b26b3d8500a4ae3d59717d7011952db6fc2fb84b807f3f94ac734e89c1b5f` |
| german | dys2p/wordlists-de `de-2048-v1.txt` @ `6ef31b9aefb8735a7b066592393d12843ec502cd` — **community BIP39-format list, not official BIP39** (Unlicense/CC0/BSD-3) | `7965dc8c6b413ccb635d3021043365e18df0367bf5413a50a069a98addfe4e1d` |

Changing language keeps the indices and swaps the rendering; it is not
translation. Checksums are identical across languages.

## 5. Checksum (FROZEN)

For zero-based indices `x_0 … x_{N-1}`, 1 ≤ N ≤ 8:

```
C = ( D + 101·N + Σ_{i=0}^{N-1} w_i · x_i ) mod 997
w = [1, 140, 819, 343, 884, 825, 620, 515]
D = CRC32C( UTF-8 "healpix-bip39-v1" ) mod 997 = 120
```

CRC32C: reflected polynomial `0x82F63B78`, init `0xFFFFFFFF`, final XOR
`0xFFFFFFFF`; check value `CRC32C("123456789") = 0xE3069283`;
`CRC32C("healpix-bip39-v1") = 1459096659`. No trailing newline.

- Displayed as exactly three decimal digits with leading zeros, after `.`
  (`。` for the Chinese renderings).
- Values 997–999 never occur; a stated checksum in that range is invalid.
- The checksum of a truncated code is recomputed with the shorter N. Running
  checksums (after each word) are exactly these truncation checksums.
- N > 8 is not defined by this version.
- With a passphrase (§7) the checksum is computed over the **displayed** indices.

The checksum detects transcription errors. It does not correct them, does not
authenticate an address, and does not confirm a passphrase. A suggested
correction must be confirmed by a person (read-back); it is never applied
silently.

**Test vectors (English):**

| HEALPix hex (order 20) | indices | code |
|---|---|---|
| `95625281C9B` | 1195, 148, 1283, 1179 | `nice-barely-parrot-nature.059` |
| `95625281C9E` | 1195, 148, 1283, 1182 | `nice-barely-parrot-need.091` |

Running checksums for the second: `nice.419`, `nice-barely.303`,
`nice-barely-parrot.343`, `nice-barely-parrot-need.091`.
Half cells of the second: 1 word = `956@4 + 957@4`; 3 words =
`956252818@15 + 95625281C@15`.

**Proven properties** (for these weights, N ≤ 8; `spec/hpwords-checksum-eval.js` §A):
- a single substitution is missed only when the index difference is ±997 or ±1994;
- a swap of two different words is missed only when their index difference is a
  multiple of 997 (any two positions — the weights are distinct mod 997);
- every error in two positions with both index shifts within ±15 is detected
  (25 200 combinations). The bound is tight: shifts (−16 at position 1, −11 at
  position 4, zero-based) cancel, since 140·(−16) + 884·(−11) = −12·997.

**Measured on confusion table v0** (the confusion pairs behind the legacy 2025-word
grids, `spec/hpwords-spoken-profiles-draft.js`; seed 20260929; results describe
this test set only, not optimality):

| test | weighted (exhaustive, context-free) | CRC32C mod 1000 (sampled, 16 contexts/case) |
|---|---|---|
| one known confusion | 0 / 640 missed | 10 / 10 240 (0.098 %) |
| two known confusions, 4 words | 12 / 64 920 (0.018 %) | 983 / 1 038 720 (0.095 %) |

The weighted checksum's outcome depends only on positions and index changes, so
it is enumerated exactly; CRC depends on the surrounding words, so it is sampled.

Denominator note: an earlier ad-hoc run reported 66 444 double-confusion cases.
It excluded a case only when the *original* first word was ≥ 1536; the
reproducible script also excludes cases where the *confused* first word is
≥ 1536, because such a code is rejected by the first-word rule (§2) before any
checksum is computed — a different detection mechanism. That removes 1 524
cases (77 904 unfiltered → 64 920). The weighted miss count is 12 under both
rules.

Not yet measured: native-speaker confusions beyond table v0, spelling and
autocomplete slips, misheard checksum digits, per-language listening tests.

## 6. Parsing and normalisation

Two conforming decoders must agree on whether an input is valid. Rules:

1. **Language is required.** The decoder is told which list to use (card,
   record field or explicit user choice). This version defines no automatic
   language detection. An application that offers detection for bare input must
   present every list that yields a valid decode and must not pick one silently.
2. **All-or-nothing.** Any rule failure rejects the whole input. No partial
   decode, no guessing, no silent correction.
3. **Separators.** After NFC normalisation and trimming, tokens are separated by
   one or more of: whitespace, `-` `_` `,` `、` `・` `·` `/` `|`, ideographic
   space. Repeated and mixed separators are accepted.
4. **Checksum suffix.** Optional. If present it is `.`, `。` or `．`, optional
   whitespace, then **exactly three ASCII digits**, at the very end. Any other
   digit count is malformed and rejected; digits without the separator are an
   unknown token and rejected.
5. **Checksum outcome** is one of:
   - *verified* — stated value equals the computed value → valid;
   - *absent* — no suffix → valid but **unchecked**; must never be reported as
     verified;
   - *mismatch* — values differ → **invalid** (rejected). An application may
     offer error-finding tools, but must not present the address as decoded.
   A stated value 997–999 is invalid.
6. **Word count.** Zero words or more than eight → rejected.
7. **Tokens.** Every token must match one entry of the given list (rules below).
   An unknown token or an ambiguous prefix → rejected. Tokens from other lists
   are unknown tokens.
8. **First index** ≥ 1536 → rejected (§2).

Matching and normalisation:

- Input is NFC-normalised before splitting.
- Matching key: NFKD, remove U+0300–U+036F, lower-case. Keys are unique within
  every pinned list (verified). Japanese and Korean lists are stored in NFD as
  published; comparison is always on keys.
- Latin-script lists (english, spanish, french, italian, portuguese, czech,
  german) also accept a **unique** prefix of ≥ 4 key characters. CJK lists match
  whole tokens only.
- Codes are rendered in NFC.

## 7. Passphrase layer — healpix-bip39-pass-v1 (BETA)

Each index is permuted by the frozen grid-passphrase v1 shuffle
(`FROZEN-FORMAT-SPEC.md`), used unchanged as a primitive:

- slot 0: a 1×1536 row; slots 1…: a 1×2048 row;
- chain string = `"healpix-bip39-pass-v1:"` + comma-joined **true** preceding indices;
- displayed = position of the true index in the shuffled order; decode inverts.

The chain tag keeps these permutations apart from grid-pass v1 and
healpix-pass-v1 chains (digits and commas only). Note for the threat model: the
frozen shuffle's per-index keys do not include the list size, so existing
formats that share a passphrase and an empty chain share the relative order of
their common indices.

Beta vector: office (`95625281C9E`) + passphrase `correct horse battery staple`
→ `injury-moon-combine-cabin.521`. A wrong passphrase still yields a
valid checksum and a different place.

## 8. Spoken profiles (framework; no approved vocabulary)

A profile is explicit and versioned; decoders use it only when told to, and
records carry its id. Accepting substitutes does not by itself remove ambiguity:
the sender's spoken rendering and the receiver's interpretation must use the
same profile.

- **aliases** — heard-as token → official word, for confusions whose partner is
  not in the list (e.g. "to" → *two*). Typed in full. A registered alias maps
  deterministically; that is not proof of what the speaker meant.
- **substitutes** — official word → spoken token, for confusions where both words
  are in the list (e.g. *right*/*write*). The sender speaks the token; the
  receiver accepts it for that index.
- **confusionGroups** — the speech confusions the profile addresses.

Machine checks (`validateProfile`): exact-token collisions with the list and
within the profile; for Latin-script lists, 4-letter prefix collisions of
substitutes (errors) and aliases (warnings: type in full); aliases inside a
confusion group that still has unsubstituted list words (errors); on-list groups
with more than one unsubstituted word (block approval). Whether a substitute is
actually easy to hear is **not** machine-checkable and needs native-speaker
listening tests. Published entries are accepted forever.

## 9. Not defined yet

URL parameter; obfuscation; N > 8; ellipsoidal (authalic) mapping; celestial
frame/epoch fields (belong to the enclosing record).
