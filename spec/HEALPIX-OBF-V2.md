# healpix-obf-v2 and healpix-bip39-obf-v1 — HEALPix obfuscation that actually jumbles

**Status: FROZEN 2026-09-30.** Never change anything here: new behaviour gets a
new version and these decoders are kept forever. A wrong derivation does not
error — it silently decodes to a plausible wrong place. Independent oracle:
`node spec/healpix-obf-v2-reference.js --selftest` (written from this document
and HEALPIX-BIP39-V1-SPEC.md only; must reproduce every vector below).

## 1. Why v2 exists

Geosonify's obfuscation model (GeoCodec, `FROZEN-GEOCODEC-OBFUSCATION.md`) has
two parts: a shuffle of the vocabulary **keyed by the final token**, then a
position shift of each earlier token. Because the key is the final token, a
change at the fine end re-jumbles the whole code.

healpix-pass-v1 (`FROZEN-HEALPIX-PASS-V1.md` §5.3) copied only the position
shift. Neighbouring cells therefore receive identical shifts and keep
identical-looking prefixes:

```
plain   956250B0092   956250B0090
v1      1B241676CFE   1B241676CFC     ← only the end differs: not obfuscation
v2      4B882919386   4E4A16801D8     ← everything before the end re-jumbled
```

healpix-pass-v1 obfuscation is **withdrawn for encoding** and **kept for
decoding forever** (legacy `…o` URL params, matrix signifier `P`). Its
passphrase layer is unaffected.

## 2. healpix-obf-v2 (hpquad / hphex / hp64 and their presentations)

Tokens: `[face, d1, …, dk]`, alphabet sizes `12, 4, …, 4`. Input = the path
after the passphrase layer (if any): **permute first, then obfuscate**, as for
every other card.

```
encode:  out[n−1] = in[n−1]                       (final token unchanged)
         for i = n−2 … 0:
           order  = GPV1_ORDER(size_i, P, "healpix-obf-v2:" + join(",", in[i+1 … n−1]))
           out[i] = position of in[i] in order
decode:  in[n−1] = out[n−1]
         for i = n−2 … 0:
           order  = GPV1_ORDER(size_i, P, "healpix-obf-v2:" + join(",", in[i+1 … n−1]))
           in[i]  = order[out[i]]
```

- `GPV1_ORDER(N, pass, chain)` is the frozen grid-passphrase v1 shuffle
  (`FROZEN-FORMAT-SPEC.md`), used unchanged; tokens are decimal integers.
- `P` = `"geosonify-public-obfuscation"` — a **public** constant. This is
  casual-observer obfuscation, not encryption; keyed privacy is the passphrase,
  confidentiality is AES URL mode.
- Every earlier token depends on **all** later tokens, so any change at the
  fine end changes every earlier token's permutation (a stronger form of the
  GeoCodec model, whose key is only the final token — with a 4-symbol final
  token that would allow just four jumbles).
- Obfuscated codes cannot be truncated (as for every obfuscated code).

**Vectors** (lat −43.5321, lon 172.6362, order 10):

| scheme | obfuscated | + passphrase `Back Bay` |
|---|---|---|
| hphex | `8A7958` | `B7E9F6` |
| hpquad | `f8.2213211120` | `f11.1332213312` |
| hp64 | `8p5WA` | `Bfp9g` |

Office, order 20: plain `95625281C9E` → v2 `A845ACC2A1E`.

**URL / signifiers (additions only; nothing repurposed):**

| carrier | v2 (emitted) | legacy v1 (decode only) |
|---|---|---|
| hphex / hpquad / hp64 flag | `j` (e.g. `?hphexj=`) | `o` |
| HEALPix Chessboard | `?hpchsj=` | `?hpchso=` |
| HEALPix ChromaCoord | `?hpcj=` | `?hpco=` |
| HEALPix Data Matrix signifier | `Q` | `P` |

`o` and `j` together are invalid. Non-HEALPix carriers (`chso`, `co`, `O`)
are GeoCodec and unchanged.

## 3. healpix-bip39-obf-v1 (HEALPix BIP39 cards)

Same construction on **word indices** (see `HEALPIX-BIP39-V1-SPEC.md`):
slot 0 is permuted over 1536 (so a face word stays a face word), later slots
over 2048; chain `"healpix-bip39-obf-v1:"` + comma-joined input indices
`i+1 … N−1`; same public `P`; last word unchanged; pipeline
true → passphrase (healpix-bip39-pass-v1) → obfuscation → displayed.

- The checksum is computed over the **displayed** indices.
- The first-word rule (< 1536) applies to the **true** first index after
  de-obfuscation; a displayed obfuscated first word may be any of the 2048.
- A location can be placed only when every word is known (RECEIVE shows the
  map once the code is complete).

**Vectors (English):** office `nice-barely-parrot-need.091` →
obfuscated `best-permit-knee-need.198`; with passphrase
`correct horse battery staple` → `match-high-puzzle-cabin.995`.

URL links: `?hpw<lang>j=` (see HEALPIX-BIP39-V1-SPEC.md §9).

## 4. Verification

`node spec/healpix-obf-v2-reference.js --selftest` reproduces every vector in
§§2–3 independently; `node js/lib/geosonify-hpwords.js --selftest` covers §3 in
the shipped module; the frozen v1
vectors are still reproduced by `node spec/healpix-pass-v1-reference.js
--selftest` and by the module with `obfV: 1`.
