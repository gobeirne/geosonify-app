# Geosonify core profile v1 — points, paths, shapes and annotations

Status: draft, 15 November 2026. Describes the live code with the B13 (segment modes) and B14 (shape suffixes) fixes. Reference decoder: `spec/core-profile-v1-reference.js` (`node spec/core-profile-v1-reference.js --selftest`), which loads no app code. Everything in this document is covered by the reference decoder's vectors.

The `?enc=` carrier is already specified, byte for byte, in FROZEN-AES-URL-V1.md; the core profile adopts it unchanged. Obfuscation, grid passphrases, BIP39 words and the other grids are outside the core profile.

## 1. The query

A point or path is carried in one query parameter whose name is the grid code `b64` followed by zero or more flag letters, each at most once, in any order:

| Flag | Meaning |
|---|---|
| `d` | the value is a path (first code, then a delta payload) |
| `r` | every segment of the path is a rhumb line |
| `o` | obfuscated (outside the core profile; a core decoder must refuse it) |
| `c` | sonification only; never affects decoding |

Examples: `b64=`, `b64d=`, `b64dr=`. Parameters are only ever added to the grammar, never repurposed; a decoder ignores parameters it does not know.

## 2. The Base64 grid

The alphabet is laid out as 8 rows × 8 columns, row 0 northernmost, column 0 westernmost:

```
A B C D E F G H
I J K L M N O P
Q R S T U V W X
Y Z a b c d e f
g h i j k l m n
o p q r s t u v
w x y z 0 1 2 3
4 5 6 7 8 9 - _
```

So the character with index i (0–63 in the string `A…Z a…z 0…9 - _`) is row ⌊i/8⌋, column i mod 8.

Decoding a code of n characters: start with latitude [−90, 90] and longitude [−180, 180]. For each character, split the current box into 8 equal rows and 8 equal columns and keep the cell at that row and column. The decoded point is the centre of the final box. Each level divides the box by 8 in both directions, so at n levels a cell is 180/8ⁿ degrees of latitude by 360/8ⁿ degrees of longitude (8 levels: 1.07 × 10⁻⁵ by 2.15 × 10⁻⁵ degrees, about 1.2 × 1.5 m at Berlin). All these bounds are exact in binary floating point.

Encoding is the same descent: at each level take row ⌊(latMax − lat)/(latMax − latMin) × 8⌋ and column ⌊(lon − lonMin)/(lonMax − lonMin) × 8⌋, each clamped to 0–7. A point therefore decodes to within half a cell of where it was encoded.

## 3. Paths

The value of a `d` parameter is the first vertex's code, then `~`, then a payload in one of the forms below. Every vertex code in one path has the same length L as the first.

If the first payload part begins with `R` followed by a hexadecimal digit, that `R` is a **global rhumb flag**: remove it; every segment is a rhumb line (as with the `r` flag).

The payload form is decided by the first payload part p (after removing a global `R`), in this order:

1. **Fixed width**: p begins with one hexadecimal digit w and `=`. Join all payload parts and drop the `w=`. Read the rest as consecutive deltas: normally w characters each; a delta written `*k…` is an escape of length k (one decimal digit) instead. Each delta replaces the last (its length) characters of the **first** code.
2. **Gear**: p begins with `d` followed by a hexadecimal digit and contains no `=`. Each payload part is a segment `d…d` (K letters `d`), then K hexadecimal digits giving a width N > 0, then a run of deltas N characters each. Each delta replaces the last N characters of the **previous** vertex's code. A segment with N = 0 or an unreadable N is skipped.
3. **Legacy gear** (decode only; never written now): p begins with a hexadecimal digit n with 0 < n < L, contains no `=`, and the rest of p has a length that is a positive multiple of n. It is read like the gear form, each payload part being either a `d` segment, or a legacy segment (one hexadecimal digit n, then deltas n characters each), or — when it is neither — a single delta. In this form every delta, including a single one, replaces the end of the **previous** code.
4. **Variable**: anything else. Each payload part is one delta, optionally prefixed with `R`; the delta replaces the last (its length) characters of the **first** code.

### 3.1 Segment modes

Segment i joins vertex i to vertex i + 1. It is a geodesic on the WGS84 ellipsoid unless marked as a rhumb line:

- all segments, by the `r` flag or a global `R`;
- one segment, by an `R` before a delta in the variable form: **the `R` on the delta for vertex k marks segment k − 1 → k, the segment arriving at that vertex.** This is how the encoder has always written it. Until 15 November 2026 the app's decoder applied it one segment later (B13); links decode as their creator drew them from that date.

The encoder uses the variable form whenever a path mixes geodesic and rhumb segments, because the fixed and gear forms have no per-segment flag.

### 3.2 Polygons and groups

A path whose last vertex is within 1 m of its first is a polygon (a closed ring); otherwise it is a line. A value may carry several groups separated by `~~~`; each group after the first is a self-contained path (its own first code and payload). Each group is a polygon, a line or (one vertex) a point on its own. Holes are not yet representable: every ring is an outer ring.

## 4. Shape suffixes

A circle or rectangle is written as the centre's code, `~`, then a payload; a graticule as the centre's code, `~~`, then a payload (`b64=CODE~PAYLOAD`, `b64=CODE~~PAYLOAD`; no `d` flag). The centre is the decoded code (§2). Emoji payloads are outside the core profile.

### 4.1 Circles (decided first, by exact length; decision D7)

Radius r in metres, a geodesic circle round the centre. In order:

1. Two characters, the second `A`–`P`: Base64url, r = (index₁ × 16) + index₂ (r ≤ 1023). A two-character Base36 circle can match this pattern too; such a payload is read as Base64url.
2. Two Base36 characters `0-9A-Z` including a letter: Base36, r = the number in base 36. (Two digits only are a raw radius: rule 4.)
3. p padding characters (`.`, or `~` in older links) then p + 2 Base36 digits: Base36, r = those digits in base 36. **This is the form written now** (`.0DW` = 500 m, `.3UW` = 5,000 m): it matches no other rule and every earlier app version reads it.
4. Raw: digits, optionally followed by `m` (`500m`).
5. After `~~` (a graticule marker): t × `~` then t + 3 Base36 digits is a circle written by an older encoder with `~` padding (`~~3UW` = 5,000 m). No graticule has this form.

### 4.2 Length fields (Base36 forms)

A length field is: optionally `!` and one resolution character giving the unit (`2` 1 mm, `1` 1 cm, `0` 10 cm, `7` 1 m, `4` 10 m, `5` 100 m, `6` 1 km; default 1 m), then p padding characters (`.`, or `~` in older links), then p + 2 Base36 digits. The value is the number times the unit.

### 4.3 Checksum

A payload may end in one checksum character: the sum of the character codes of the rest of the payload, mod 36, as a digit of `0-9A-Z`. When the last character of a payload longer than 3 characters equals the checksum of the others, it is removed. Circles (§4.1) are decided before this step.

### 4.4 Rectangles

Centre, rotation θ in whole degrees, and side lengths L and S in metres. θ is the bearing of side L, clockwise from north. With east/north offsets in metres u = (sin θ, cos θ) along L and v = (cos θ, −sin θ) along S, the corners are the points ±(L/2)u ± (S/2)v, each placed by a geodesic from the centre at bearing atan2(east, north) and distance √(east² + north²). Encodings:

- Raw: `θdeg_L_S` with units on the lengths (`30deg_500m_200m`; `deg` and `m` may be omitted).
- Base64url: 5 characters = 30 bits; drop the last (padding) bit; then θ = bits 28–20, L = bits 19–10, S = bits 9–0 (L, S ≤ 1023 m).
- Base36: θ as 2 Base36 digits, then L and S as length fields (§4.2) (`0UDW5K` = 30°, 500 m, 200 m; `0U!45K5K` = 30°, 2,000 m, 200 m). One extra trailing character is a checksum.

### 4.5 Graticules

Centre, longitude span in degrees, and north–south extent in metres:

- Angular: both fields are angles, each `Ndeg`, `N'` or `Nmin` (`7deg_4deg`, `20'_15'`): a longitude span and a latitude span, both in degrees. Tried before the metric form.
- Raw: `Xdeg_Y` with a unit on Y (`1.5deg_100km`).
- Base64url: 7 characters = 42 bits; drop the last (padding) bit; longitude span = bits 40–25 in units of 0.01°, extent = bits 24–0 in metres. Implementations must use 64-bit or arbitrary-precision integers.
- Base36: two length fields (§4.2): the longitude span in units of 0.001°, then the extent in metres.

The encoder never writes a value its chosen form cannot hold: a circle over 1023 m or a rectangle side over 1023 m in Base64url is written in Base36, and an out-of-range graticule raw.

## 5. Test vectors (generated from the live code, Base64, 8 levels)

| # | Case | Link value | Payload form | Vertices | Type |
|---|---|---|---|---|---|
| 1 | point | `b64=v-dzcFN-` | point | 1 | point |
| 2 | geodesic path | `b64d=v-dzcFN-~4=dA8rdpn8lcKRl3Ot` | fixed | 5 | path |
| 3 | mixed rhumb path | `b64d=v-dr27bv~egtwv~RLWjLn~V-AVgf` | variable | 4 | path |
| 4 | all-rhumb polygon | `b64dr=MqSvSsWo~d6Th4BPvTxc2LJSvSsWo` | gear | 4 | polygon |

Vector 1 decodes to: -43.522505164, 172.581106424
Vector 2 decodes to: -43.522505164, 172.581106424; -43.522998691, 172.584990263; -43.526195884, 172.586899996; -43.530004621, 172.590097189; -43.532096744, 172.594989538
Vector 3 decodes to: -43.499996066, 172.600010633; -43.400003314, 172.799996138; -43.299999833, 172.600010633; -43.199996352, 172.799996138 — segment modes GRGG
Vector 4 decodes to: 52.499998212, 13.299990892; 52.519996762, 13.450001478; 52.450001836, 13.499997854; 52.499998212, 13.299990892 — segment modes RRRR

Decoded values are cell centres, given to 9 decimal places. A decoder written from this document alone reproduced all four (to 5 × 10⁻¹⁰°, the rounding of this table) before it was published. The reference decoder carries these and 15 more: a legacy gear path (checked against the app's own `DeltaGear`), two `~~~` groups, every circle form including the older ones and the D7 tie (`~1I` reads as Base64url, 856 m), Base36 and Base64url rectangles, and Base64url and raw graticules.

## 6. Compatibility policy

A link that decodes today decodes to the same vertices forever. New behaviour is a new flag, parameter or payload form that older decoders either ignore or refuse; it never changes the meaning of an existing link. The one exception made so far is B13, which corrected the decoder to match what the encoder had always written; it moves no vertex, only which segment of a mixed path is drawn as a rhumb line. B14 (15 November 2026) made shape suffixes that were refused or misread decode as their encoder meant; the only links whose reading was decided rather than recovered are two-character circles valid in both Base36 and Base64url, which keep the Base64url reading they always had (D7).

## 7. HEALPix codes

`hphex` and `hp64` codes serialize a HEALPix NESTED pixel (Górski et al. 2005), as specified in FROZEN-HEALPIX-PASS-V1.md §2: the first character is the base pixel (face) `0`–`9`, `A`, `B`; then each `hphex` character carries 2 quaternary digits and each `hp64` character 3 (Base64url, case-sensitive), most significant first. An optional `@k` suffix gives the order k; without it the order is the most the length allows (2 or 3 per character), and the digits are cut to k. Within a face, each quaternary digit d contributes bit d & 1 to x and bit d >> 1 to y. The decoded point is the pixel centre, computed with the standard HEALPix formulae (the reference decoder's `healpixCentre`). Flags are `d` and `r` as in §1; `j` and `o` (obfuscation) are outside the core profile. A HEALPix path uses the payload forms of §3 over the code's characters, every vertex at the order of the first code.

Encoders should always write `@k` on single codes: the app decodes a bare point code at an order taken from the receiver's settings (B17), so only `@k` codes decode identically everywhere.

## 8. Annotations

Two repeatable parameters, outside the code, so they never move a point:

- `lbl=<i>:<text>` labels vertex i.
- `sty=p<i>[-j]:<colour>[,w<n>][,dash]` styles vertices i to j; `sty=s<i>[-j]:…` styles sides i to j (side i joins vertices i and i + 1).

Indices count from 0 across the whole value, straight through `~~~` groups, in decode order. A colour is one palette letter (`r` ef4444, `o` f97316, `y` facc15, `g` 22c55e, `c` 06b6d4, `b` 3b82f6, `v` 8b5cf6, `m` d946ef, `p` f9a8d4, `n` 9ca3af, `k` 111827, `w` f9fafb) or six hex digits without `#`; `w<n>` is a width of 0.5–12 px; `dash` makes the line dashed. Label text is plain text (never markup), cut to 60 characters after removing control, bidirectional-override and zero-width characters. Values are percent-encoded (`+ # & %` and spaces always escaped). A malformed entry is ignored on its own. Limits: 500 labels and 500 style entries; a range spans at most 5,000 indices.

## 9. Outside the core profile

Obfuscation, grid passphrases, BIP39 and HEALPix words, emoji payloads, the other grids, and display options (`display`, `area`, `zoom`, `basemap` and the rest), which change how a link is shown, never what it encodes.
