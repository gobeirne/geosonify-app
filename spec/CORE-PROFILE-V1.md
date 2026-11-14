# Geosonify core profile v1 — Part A: points and paths in the Base64 grid

Status: draft, 15 November 2026. Describes the behaviour of the live code at commit ebf27e3 plus the B13 decoder fix delivered with this document. Part B (shape suffixes, HEALPix `hphex`/`hp64`, annotations `lbl=`/`sty=`, the legacy gear form, `~~~` group vectors, and an independent reference decoder in `spec/`) follows.

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
3. **Legacy gear** (decode only; never written now): p begins with a hexadecimal digit n with 0 < n < L, contains no `=`, and the rest of p has a length that is a positive multiple of n. Specified in Part B.
4. **Variable**: anything else. Each payload part is one delta, optionally prefixed with `R`; the delta replaces the last (its length) characters of the **first** code.

### 3.1 Segment modes

Segment i joins vertex i to vertex i + 1. It is a geodesic on the WGS84 ellipsoid unless marked as a rhumb line:

- all segments, by the `r` flag or a global `R`;
- one segment, by an `R` before a delta in the variable form: **the `R` on the delta for vertex k marks segment k − 1 → k, the segment arriving at that vertex.** This is how the encoder has always written it. Until 15 November 2026 the app's decoder applied it one segment later (B13); links decode as their creator drew them from that date.

The encoder uses the variable form whenever a path mixes geodesic and rhumb segments, because the fixed and gear forms have no per-segment flag.

### 3.2 Polygons and groups

A path whose last vertex is within 1 m of its first is a polygon (a closed ring); otherwise it is a line. A value may carry several groups separated by `~~~`; each group after the first is a self-contained path (its own first code and payload). Each group is a polygon, a line or (one vertex) a point on its own. Holes are not yet representable: every ring is an outer ring.

## 4. Test vectors (generated from the live code, Base64, 8 levels)

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

Decoded values are cell centres, given to 9 decimal places. A decoder written from this document alone reproduced all four (to 5 × 10⁻¹⁰°, the rounding of this table) before it was published.

## 5. Compatibility policy

A link that decodes today decodes to the same vertices forever. New behaviour is a new flag, parameter or payload form that older decoders either ignore or refuse; it never changes the meaning of an existing link. The one exception made so far is B13, which corrected the decoder to match what the encoder had always written; it moves no vertex, only which segment of a mixed path is drawn as a rhumb line.
