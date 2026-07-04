# Geosonify AES URL encryption — FROZEN FORMAT SPECIFICATION v1 (minimal)

**Purpose.** An encrypted Geosonify link (`?enc=…`) generated today must remain
decryptable in 30–100 years. That holds only if a future implementation can
reproduce the *exact* key derivation, cipher invocation, framing and encoding
the blob used. This document pins every input, byte for byte, so a clean-room
reimplementation in any language, decades from now, produces identical output.
The reference oracle (`spec/aes-url-v1-reference.js`) and the vectors below let
anyone verify it. Source of truth: **the inline script in `index.html`**
(live per `index.html`'s own `<script>` tags) — `ENC_FORMAT_VERSION`,
`ENC_KDF_ITERATIONS`, `deriveEncryptionKey`, `_bytesToB64url`,
`encryptQueryString`, `decryptQueryString`, plus the `?enc=` branch of
`parseURLParameters` and the share-URL builders. No `js/` module contains any
part of this path; `js/lib/geosonify-url-codec_v1_1.js`, despite its name,
carries the SHAPE/redraw codec and grid-param map, **not** AES. (Verified this
run; `ARCHITECTURE.md`'s description of the blob agrees with the shipped code —
no doc/code conflict was found on this layer.)

**Design stance.** AES URL mode is the project's *real confidentiality* layer —
the answer whenever grid-passphrase mode's "casual observer" privacy is not
enough. It hides coordinates, grid type, point count and structure behind
standard, honest cryptography: PBKDF2-HMAC-SHA256 and AES-256-GCM, both invoked
through the browser's **native WebCrypto** (`crypto.subtle`), not a JavaScript
implementation. Unlike the bare-code formats, this blob is **self-describing**:
byte 0 is a version and the KDF cost travels inside the blob, so the format can
evolve by *adding versions* while every old link keeps decoding.

**The core rule.** Everything in section 1 is immutable **for version byte
`0x01`**. New behaviour (different KDF, cost encoding, padding, cipher, layout)
takes a **new version byte**; the v1 decode path is kept forever. Changing v1
in place does not "upgrade" the scheme: a wrong KDF or AAD locks every existing
link out permanently (GCM refuses), and a wrong *framing/length/padding* port
is worse — the tag still verifies and the decoder silently returns wrong or
truncated plaintext. The only v1 parameter that may change **at the encoder**
is the default iteration count (it is data inside the blob, bounded by 24 bits);
everything a *decoder* needs is frozen.

---

## 1. Frozen format v1 (immutable)

### 1.1 Constants
| Element | Value (exact) |
|---|---|
| Version byte | `0x01` (blob byte 0) |
| KDF | PBKDF2-HMAC-SHA256 (RFC 2898 / 8018), output **32 bytes** |
| Iterations | 24-bit **big-endian** unsigned in blob bytes 1–3; encoder default currently **600 000** (`0x09 0x27 0xC0`); range 1‥16 777 215 |
| Passphrase normalisation | Unicode **NFC**, then UTF-8. Non-empty (see §4.3) |
| Salt | 16 bytes, fresh cryptographically random per encryption, blob bytes 4–19 |
| IV | 12 bytes (96-bit), fresh cryptographically random per encryption, blob bytes 20–31; used directly as the GCM 96-bit IV (standard J0 path) |
| Cipher | **AES-256-GCM** (NIST SP 800-38D), tag **128 bits**, tag appended after ciphertext |
| AAD | the full 32-byte header (bytes 0–31) |
| Inner framing | `len_be16(plaintext) ‖ plaintext ‖ pad`, padded with **random** bytes up to a multiple of **32** |
| Plaintext length | 0‥65 535 UTF-8 bytes (2-byte length field; see hazard §4.1) |
| Text encoding | canonical **base64url** (RFC 4648 §5): standard base64 with `+`→`-`, `/`→`_`, **`=` padding stripped** |
| Query parameter | `enc` (see §2) |

### 1.2 Byte layout of the blob (before base64url)
```
offset  width  field
0       1      version = 0x01
1       3      PBKDF2 iteration count, unsigned 24-bit big-endian
4       16     salt
20      12     IV
32      n      AES-256-GCM ciphertext of the padded inner frame
32+n    16     GCM authentication tag
```
`n = ceil((2 + |plaintext|) / 32) * 32`, so a well-formed blob is
`32 + n + 16` bytes; the minimum (any plaintext of 0‥30 bytes) is **80 bytes**.
The header (bytes 0–31) is bound as GCM additional authenticated data:
tampering with the version, iteration count, salt or IV makes the tag fail
even though those bytes are outside the ciphertext.

### 1.3 Key derivation
```
key = PBKDF2-HMAC-SHA256( password  = UTF8( NFC(passphrase) ),
                          salt      = blob bytes 4..19,
                          iterations= blob bytes 1..3 (BE),
                          dkLen     = 32 bytes )
```
There is **no pepper, no context/info string, no domain-separation prefix** in
this layer (contrast grid-passphrase v1). The passphrase is *not* trimmed by
the derivation — see quirk §4.3.

### 1.4 Encryption (encoder algorithm)
```
pt      = UTF8(queryString)                    # no leading '?'
inner   = [ |pt| >> 8, |pt| & 0xFF ] ‖ pt      # 2-byte BE true length
padded  = inner ‖ random bytes, to ceil(|inner|/32)*32
header  = [0x01] ‖ iterations_be24 ‖ salt(16) ‖ iv(12)
ct‖tag  = AES-256-GCM-Encrypt( key, iv, AAD = header, padded )   # tag 16 bytes
blob    = base64url( header ‖ ct ‖ tag )                          # no '=' padding
```
Padding blurs plaintext length to a 32-byte band; it does **not** hide it (a
long route still yields a bigger blob than a point). The pad bytes carry no
information and are never inspected on decode — only the framed length counts.
The salt, IV and pad bytes MUST come from a cryptographically secure RNG
(live: `crypto.getRandomValues`). The reference oracle's salt/IV/pad injection
exists solely to make the vectors reproducible and MUST never ship.

### 1.5 Decryption (decoder algorithm and null-semantics)
The decoder returns the plaintext string or **null on any failure**, without
distinguishing causes (no "getting warmer" oracle). In live order:
```
1. base64url-decode ( '-'→'+', '_'→'/', forgiving base64 )   fail → null
2. if total length < 48 → null                                # header + min tag
3. if byte0 ≠ 0x01 → null                                     # unknown version
4. iterations = be24(bytes 1..3); derive key per §1.3         # KDF error → null
5. AES-256-GCM-Decrypt( key, iv = bytes 20..31,
        AAD = bytes 0..31, ct‖tag = bytes 32.. )              # tag fail → null
6. actualLen = be16(plain[0..1]); if actualLen > |plain| − 2 → null
7. return UTF8-decode( plain[2 .. 2+actualLen) )
```
Notes pinned from the shipped code:
- Step 2's threshold is 48 (the live check), although no well-formed v1 blob is
  shorter than 80; blobs of 48–79 bytes always fail later (tag or length check).
  When GCM yields an empty plaintext, the live JS computes
  `(undefined<<8)|undefined = 0` and `0 > −2` rejects it — equivalent to an
  explicit `|plain| < 2 → null` guard, which is what the oracle writes.
- Step 3 makes versioning **append-only**: a v1 decoder returns null for any
  other version byte; future decoders dispatch on byte 0 and keep this path.
- The live UTF-8 decoder is a default (lenient) `TextDecoder`. Well-formed
  blobs always frame valid UTF-8, so lenient vs strict never differs for them;
  a clean-room decoder MAY be strict.
- The live base64 decoder is *forgiving*: after the character swap it accepts
  standard-alphabet or `=`-padded input too. That leniency is **non-normative**;
  the canonical blob uses only `[A-Za-z0-9_-]`, unpadded, and canonical
  encoders MUST emit exactly that (it survives `URLSearchParams`, which would
  turn a literal `+` into a space — see §2).

---

## 2. URL grammar (public, append-only contract)

- The blob travels as the value of the query parameter **`enc`**:
  `https://…/?enc=<blob>`. The value is read with `URLSearchParams.get('enc')`;
  the base64url alphabet needs no percent-encoding and contains no `+`, so it
  round-trips URL parsing byte-identically.
- The **plaintext is itself a query string without the leading `?`** — in the
  shipped app, exactly one `param=value` pair built as
  `getURLParamForActiveCard(...) + '=' + compactOutput` (grid key + flags per
  `geosonify-url-codec_v1_1.js`, value possibly `~`-suffixed with shape/delta
  data). The *format* does not depend on that: v1 encrypts any UTF-8 string of
  ≤ 65 535 bytes, and on successful decryption the app replaces the whole
  query string with `'?' + plaintext` and re-parses.
- When `enc` is present the live parser handles it **first and returns**;
  other parameters in the same URL are ignored by the decode path. (The share
  builder can append `&display…` options after `?enc=…`; under the current
  decoder these are dropped after decryption. If a future version wants
  display params to survive encryption, they belong *inside* the plaintext or
  in a new parameter — never a repurposed one.)
- Per the project-wide rule: parameters are only ever **added**, never
  repurposed. `enc` is permanently reserved for this blob family, versioned by
  blob byte 0 — a future format v2 still ships under `?enc=` with byte 0 = 0x02.

---

## 3. What is deliberately NOT fixed

- **Salt, IV, and pad bytes are random per encryption** — two encryptions of
  the same plaintext with the same passphrase are different blobs by design.
  Only decode is deterministic.
- **The encoder's default iteration count** (currently 600 000, an OWASP-era
  floor for PBKDF2-HMAC-SHA256) may be raised in future *without* a version
  bump, because the count travels in bytes 1–3 and is AAD-bound. Decoders MUST
  honour whatever count the blob declares (within 24 bits). See hazard §4.2.
- **What the app chooses to put in the plaintext** (which param key, which code
  vocabulary) is governed by the other frozen specs, not this one.

---

## 4. Hazards and observed live quirks (code wins; pinned here)

### 4.1 The live encoder does not enforce the 65 535-byte plaintext limit
`encryptQueryString` writes `|pt| & 0xFFFF` into the length field without
checking. A plaintext over 65 535 bytes does **not** error: the stored length
wraps mod 65 536 and a later decrypt silently returns wrong/truncated text (or
null). No realistic Geosonify query string approaches 64 KiB, but the limit is
part of the frozen format: **conforming encoders MUST refuse |pt| > 65 535**
(the reference oracle throws) and the live encoder should gain the same guard.
Likewise the 24-bit iteration field: encoders MUST refuse counts > 16 777 215.

### 4.2 Attacker-chosen KDF cost (accepted, bounded)
The AAD binds the header to the *derived key*, so a tampered iteration count is
always rejected — but only **after** the decoder has performed the PBKDF2 work
the forged header demanded. A hostile blob can therefore cost a decoder up to
16 777 215 iterations (~28× the current default) before failing. This is a
bounded, accepted nuisance, noted so nobody "fixes" it by capping decode below
24 bits (which would strand honest future blobs encoded at higher cost).

### 4.3 Passphrase whitespace: a UI trim asymmetry, not a format rule
The derivation (§1.3) uses the passphrase exactly as given (NFC only, no trim).
However, the live **encode** prompt submits `input.value.trim()` while the live
**decode** prompt submits `input.value` untrimmed. Consequence: a passphrase
with leading/trailing whitespace can never have been used to *create* a v1 blob
through the shipped UI, but typing trailing whitespace at *decode* time will
fail against a blob whose passphrase was trimmed at encode. The format is
frozen without trimming; the asymmetry is a UI quirk documented so a future
"fix" on either side is made knowingly.

### 4.4 Empty passphrase is undefined in v1
The shipped UI requires a non-empty passphrase on both sides, and WebCrypto
engines have historically disagreed about zero-length PBKDF2 key material. v1
therefore leaves the empty passphrase **undefined**; the oracle refuses it.
Do not pin a behaviour for it retroactively — no conforming v1 blob exists
that used one.

### 4.5 The primitives are genuine (name verified, not trusted)
Following the lesson of the GeoCodec obfuscation layer (whose "SHA3-512" is
NOT real SHA3 — see `FROZEN-GEOCODEC-OBFUSCATION.md` §1.0), the AES layer's
primitives were checked rather than believed: the live code calls the
browser's native `crypto.subtle` with `{name:'PBKDF2', hash:'SHA-256'}` and
`{name:'AES-GCM', length:256}`, and the oracle's self-test cross-verifies a
`node:crypto` pipeline against an independent WebCrypto pipeline on the frozen
vectors (step "cross-impl"). Both agree byte-for-byte: this layer is **real**
PBKDF2-HMAC-SHA256 and **real** AES-256-GCM. The GeoCodec custom hash is not
used anywhere in this format.

---

## 5. Verification

### 5.1 Reference oracle
`spec/aes-url-v1-reference.js` — dependency-free Node port with:
- `--selftest` (exit 0/1): reproduces the frozen vectors byte-for-byte,
  round-trips them, checks the header structure and the blob-length formula,
  NFC equivalence, canonical alphabet, negative vectors (wrong passphrase,
  flipped version/iterations/salt/IV/ciphertext/tag bits, truncation, garbage
  base64, future version byte, over-claiming inner length), the reference-side
  encoder guards of §4.1, and the cross-implementation genuineness check of
  §4.5.
- `--encrypt <qs> <pass> [iters]` / `--decrypt <blob> <pass>` for manual use —
  decrypting any real shipped `?enc=` link with the oracle is itself a live
  verification.
- `differentialTestV1(liveEncrypt, liveDecrypt, opts)` — a randomized harness
  to run in the app's DevTools console against the shipped
  `encryptQueryString`/`decryptQueryString`: oracle-decodes live blobs,
  live-decodes oracle blobs, checks live header structure and length formula,
  and confirms wrong-passphrase null. Written, deliberately **not run** by the
  spec author; running it (or decoding a real shipped link) is what upgrades
  the vectors below from *claimed* to *verified against live*.

### 5.2 Frozen vectors (claimed until verified against shipped code)
Produced by the oracle and independently reproduced by a second WebCrypto
(`crypto.subtle`) pipeline mirroring the live call shapes exactly; the two
agreed byte-for-byte. Not yet replayed through the shipped browser code.

**KDF anchor** — PBKDF2-HMAC-SHA256, passphrase `Back Bay`, salt
`000102030405060708090a0b0c0d0e0f`, 600 000 iterations, 32-byte key:
```
a85b21a80cd5e6359d4febfc003d0974291afbbb3ba9c94705f616463c80f676
```

**Encode vector 1 (no padding)** — plaintext
`c=urban-vivid-magnet-obtain-xy` (exactly 30 UTF-8 bytes → inner 32, zero pad
bytes; deterministic from passphrase + salt + IV + iterations alone).
Passphrase `Back Bay`, iterations 600 000, salt as above, IV
`101112131415161718191a1b`. Blob (80 bytes), hex:
```
010927c0000102030405060708090a0b0c0d0e0f101112131415161718191a1b
33838551b7bf18b236f9f0cfc821c2aad3949f9dfa0f64ca725f5d4c5e011cd6
15497ffee3bae0c03ad55f8d0ed38b5a
```
base64url (the `enc` value):
```
AQknwAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhszg4VRt78Ysjb58M_IIcKq05SfnfoPZMpyX11MXgEc1hVJf_7juuDAOtVfjQ7Ti1o
```

**Encode vector 2 (pad path + NFC + non-default cost)** — plaintext `p=hello`
(7 bytes → inner 9 → padded 32 with 23 injected pad bytes `00,01,02,…`),
passphrase `Māori tāonga` (composed NFC; the decomposed form
`Ma◌̄ori ta◌̄onga` U+0061 U+0304 must yield the **identical** blob),
iterations 1 000 (header bytes `00 03 e8`), same salt/IV. Blob (80 bytes), hex:
```
010003e8000102030405060708090a0b0c0d0e0f101112131415161718191a1b
afbbb8c209fcfdda5ef4817d7362f81a58e66cd9797d89013cce7e18b4f7df17
792c713df4074334b3a8c75610dfaeb4
```
base64url:
```
AQAD6AABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhuvu7jCCfz92l70gX1zYvgaWOZs2Xl9iQE8zn4YtPffF3kscT30B0M0s6jHVhDfrrQ
```
(The injected sequential pad is a reproducibility device of the reference only;
live pad bytes are random and, per §1.4, never affect the decoded plaintext.)

**Negative vectors** (all must decode to null): wrong passphrase against
vector 1; any single-bit flip in the version byte, iteration bytes, salt, IV,
ciphertext or tag of vector 1; the blob truncated to 47 bytes; non-base64
garbage; vector 1 with byte 0 set to `0x02`; and a crafted blob whose framed
length claims 65 535 bytes inside a 32-byte body (construction in the oracle,
self-test step 6).

### 5.3 Century-stability rationale
Every element is a published, multiply-implemented standard: PBKDF2 (RFC 8018),
HMAC-SHA-256 (FIPS 198/180-4), AES-256-GCM (FIPS 197 + SP 800-38D), base64url
(RFC 4648), UTF-8 and Unicode NFC (covered by the Normalization Stability
Policy). The framing adds only big-endian integers and a fixed byte layout —
no floats, no locale, no engine-dependent ordering. The blob is self-describing
(version + cost), so nothing about a decoder needs out-of-band context beyond
this spec and the passphrase.
