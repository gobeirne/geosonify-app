# Starpin `sealed-v1` — the sealed field set (protocol design, NOT yet frozen)

Written 2026-09-22. This is the plaintext that goes **inside** the group-share
ciphertext: the exact bytes `canonical()` serialises and `seal()` encrypts. It is
the last thing to pin before the submission service, because **its shape becomes
permanent at first upload** — it is the plaintext input to the frozen format, and
changing it later changes every record's size class and every conformance vector.

This document is deliberately a *specification*, not a description of the current
object. Where the code and the design docs disagree, the disagreement is resolved
here explicitly and the code is to be made to conform afterwards — never the
reverse. **Six** real discrepancies were found (two in the first pass, four in two
rounds of hostile-input / protocol-lawyer review); see Part 6.

Status: **proposal for review (revision 3, post protocol-lawyer pass).** Nothing here
is frozen and no code has been
changed to match it yet. Argon2id params and padding classes remain placeholders;
this schema is independent of both and can be frozen first.

---

## Part 1 — What is being sealed, and what is not

A share is one `group-share/1` **wrapper** sealed under a per-record key. The
wrapper carries the whole immutable record plus how it was presented to one group.

```
canonical payload  =  UTF-8( JCS(wrapper) )        ← THIS document defines these bytes. No BOM.
AEAD plaintext     =  uint32be(len) ‖ canonical payload ‖ zero-fill to size class   ← added by seal()
blob               =  record_salt(32) ‖ nonce(24) ‖ XChaCha20-Poly1305(rk, nonce, AAD).encrypt(AEAD plaintext)
```

**This schema defines the *canonical payload* — the exact bytes
`UTF-8(JCS(wrapper))`.** It does **not** define the AEAD plaintext: `seal()` frames
the payload with a 4-byte big-endian true-length prefix and zero-fills to a padding
size class before encrypting (the framing is frozen; the size classes are not yet —
group-v1 crypto spec). So "the bytes XChaCha encrypts" ≠ "the canonical payload";
the payload is the prefix-and-pad's input. The schema is frozen independently of the
padding classes precisely because the payload bytes are all it specifies. The
canonical payload is `UTF-8` of the JCS canonical form, **no byte-order mark, no
trailing newline**; a reader that, after stripping the length prefix and padding,
finds bytes which are not exactly `UTF-8(JCS(parse(bytes)))` — a BOM, non-canonical
ordering, non-minimal escapes, non-NFC where NFC is required (Part 9) — rejects.

**The AAD (reconstructed by the reader, never stored):**

```
AAD binds:  schema | target_handle | group_uuid | epoch | kdf | cipher
```

`target_handle` **is** in the AAD (confirmed in `aadFor()` and the frozen crypto
profile). Folder-binding is therefore **cryptographic**: a blob physically moved to
another folder fails to decrypt, because the reader reconstructs the AAD from the
handle it actually opened and the auth tag will not verify against a different
handle. This is the primary relocation defence. The Part 4 post-decrypt check is
**defence in depth** on top of it, and additionally binds the *record's own
semantic target* to that folder — which the AAD alone does not do.

**Outside the ciphertext, deliberately** (stated so no future change smuggles any
of it in):

- `target_handle`, `group_uuid`, `epoch`, `schema`, `kdf`, `cipher` — in the AAD,
  reconstructed by the reader, never stored beside the blob. The AAD *binds*; it is
  not part of the sealed plaintext.
- `content_hash` — SHA-256 of the blob bytes. The storage key and idempotency
  token. A property of the ciphertext, never inside it.
- Everything in the local stores (`starpin.groups.v1`, `starpin.sync.v1`,
  `starpin.self.v1`): keys, endpoints, labels, sync markers, ledgers. Local sync
  state, never sealed, never uploaded.

**Inside the ciphertext**: the wrapper below, in full.

---

## Part 1a — Universal v1 rules (apply to every object, string and number below)

These are the hostile-input defaults. Every field contract in Parts 2–5 is read as
*in addition to* these; where a field says nothing, these govern.

1. **Exact key sets — reject unknown keys everywhere.** Every object in sealed-v1
   (`wrapper`, `member`, `record`, `event`, `fix`, `target`, each `evidence`
   element, `provenance`) has **exactly** the keys listed for it — no more. A
   reader that finds any key not in the field table **rejects the whole wrapper**.
   This is the rule that stops a client sealing `record.foo = {...}` to smuggle
   arbitrary material past the size/field discipline. There is no "ignore unknown
   keys" leniency in a hashed format: an unknown key changed the bytes that were
   hashed, so it is by definition not a v1 object. The **only** way v1 ever gains a
   field is a new schema version (`record/2`, `group-share/2`), never an additive
   key inside v1.

2. **No JSON `null` except where the table explicitly lists `T | null`.** A `null`
   in any other position is a reject, not a default.

3. **Types are exact.** A number where a string is specified (or vice-versa) is a
   reject, never coerced. `true`/`false` only where `boolean` is listed (nowhere in
   v1 currently).

4. **All numbers are integers, and safe integers** (|value| ≤ 2^53−1, no fractional
   part, no non-integral exponent form). **sealed-v1 contains no non-integer numbers
   at all** — every measurement is a scaled integer (Part 3.4). A fractional or
   non-safe value in any numeric field is a reject. This removes the JCS
   fractional-number path from the format entirely.

5. **All numbers are finite.** `NaN`/`±Infinity` cannot occur (the canonicaliser
   throws) and a reader rejects any non-finite number defensively.

6. **All strings are valid Unicode scalar sequences** (no lone surrogates — the
   canonicaliser enforces this on both sides) and are bounded by an explicit byte
   cap. **Every string field in v1 has a byte cap**; there are no uncapped strings
   (Part 6.3, Part 8).

7. **Rendering.** Every human-facing free-text field (`handle`, `comment`,
   `observation`, `approach_reason`, evidence `note`) is rendered via `textContent`
   only, never as HTML/markup, on every surface.

A reader applies these **before** trusting any value, and **fails closed**: any
violation rejects the entire wrapper, never a partial accept or a repair.

---

## Part 2 — The wrapper (`starpin.group-share/1`)

| field | type | req? | null/absence | notes |
|-------|------|------|--------------|-------|
| `schema` | string | **required** | never null, never absent | exactly `"starpin.group-share/1"` |
| `publication_id` | string | **required** | never null | base64url of 16 random bytes, **strict grammar + canonical round-trip on read (Part 3.7)**. Identifies THIS publication into THIS group. Random, per-share, NOT the `record_id`. |
| `canonical_target` | string | **required** | never null | The frozen routing identity. Derived-only (Part 4). Grammar in Part 5. **Byte cap: ≤ 320 bytes** (bounds the id inflation route via the target, Part 6.3). |
| `record` | object | **required** | never null | a complete `starpin.record/1`, Part 3. Exact key set (Part 1a.1). |
| `member` | object | **required** | never null | `{ member_id, handle }`, self-asserted. Part 2.1. Exact key set. |
| `comment` | string | optional | **absent when empty** | free text. Present only if non-empty; never `null`, never `""`. `textContent` only. ≤ 2048 bytes (Part 2.2). |

**Five required wrapper fields** (`schema`, `publication_id`, `canonical_target`,
`record`, `member`), always present and never null, **plus one optional field**
(`comment`). `comment` uses *absence* to mean "none" — it is either a non-empty
string or the key is not there. It is never `null` and never `""`, because three
ways to say "no comment" is two too many for a hashed format. No other key may
appear in the wrapper (Part 1a.1).

### 2.1 `member`

| field | type | req? | notes |
|-------|------|------|-------|
| `member_id` | string | **required** | base64url of 16 bytes, **strict grammar + canonical round-trip on read (Part 3.7)** — not merely "what this device emits". Per-group, never global. Self-asserted: in bearer-code group-v1 any code-holder can write any (grammar-valid) value here — this is the authorship limit, not a schema hole. |
| `handle` | string | **required** | display name. May be empty `""` (unnamed device). UTF-8, **NFC required (written NFC, rejected on read if not NFC — Part 9)**, `textContent` only, ≤ 64 bytes (Part 2.2). |

`member` is required as an object even when the handle is empty; `handle: ""` is
the legal "no display name" value (unlike `comment`, which uses absence). The
asymmetry is intentional: a member always exists; a comment may not. Exactly these
two keys, no others.

### 2.2 Length caps (bytes of UTF-8, pre-padding)

- `handle`: ≤ 64 bytes.
- `comment`: ≤ 2048 bytes.
- `canonical_target`: ≤ 320 bytes (Part 2 table).
- every other string field: capped in its own table row. **No string is uncapped.**

Caps exist so the size-class padding is meaningful and so a single share can't be
inflated to grief the folder. They are part of the frozen format: a reader rejects
a wrapper exceeding them rather than truncating.

---

## Part 3 — The record (`starpin.record/1`)

Exactly what `build()` emits today, now with each field's contract pinned. Field
order is irrelevant (canonical sorts keys); this is the authoritative *set*.

| field | type | req? | null/absence | representation & range |
|-------|------|------|--------------|------------------------|
| `schema` | string | **required** | never null | exactly `"starpin.record/1"` |
| `record_id` | string | **required** | never null | UUIDv4 with enforced version+variant bits (Part 3.7). The EVENT identity; readers dedup on it (Part 7.2). |
| `supersedes` | string \| null | **required key** | `null` = chain root | UUIDv4 (Part 3.7) of the record this corrects, or `null`. Key always present. **Must not equal `record_id`** (Part 7.2). |
| `kind` | string | **required** | never null | one of the frozen kind enum, Part 3.1. |
| `target` | object | **required** | never null | `{starpin:<id>}` XOR `{cornerstone:<id>}`, Part 3.2. |
| `membership` | string \| null | **required key** | `null` = not a manifest target | manifest membership id, or `null`. **≤ 128 bytes when a string.** NOT group membership (that lives in local sync state, never in the record — see design v4 §5.1). |
| `event` | object | **required** | never null | `{time_ms, time_uncertainty_ms}`, Part 3.3. |
| `fix` | object \| null | **required key** | `null` = no location captured | Part 3.4. |
| `approach_reason` | string \| null | **required key** | `null` = none | free text, **≤ 256 bytes**, `textContent` only. Currently unvalidated in code (Part 6). |
| `observation` | string \| null | **required key** | `null` = none | free text, **≤ 2048 bytes**, `textContent` only. Currently unvalidated (Part 6). |
| `evidence` | array | **required** | **`[]` not null** when none | array of evidence objects, Part 3.5. **v1: constrained to `[]` (Part 3.5).** Currently unvalidated (Part 6). |
| `created_ms` | integer | **required** | never null | device wall clock at creation, ms. Advisory, not trusted for ordering. |
| `provenance` | object \| null | **required key** | `null` = none | Part 3.6. Currently unvalidated (Part 6). |

**Absence vs null rule for the record:** every field above is a **required key** —
it is always present. Optionality is expressed with `null` (or `[]` for
`evidence`), never by omitting the key. This is the opposite convention from the
wrapper's `comment`, and it is deliberate: the record is the frozen, hashed,
long-lived artifact where a stable key set matters most, so it never varies its
shape; the wrapper is the transport where absence reads more naturally. A reader
rejects a record with a missing key rather than defaulting it.

### 3.1 `kind` enum (frozen)

`"visit"`, `"closest-approach"`, `"observation"`, `"culmination-attempt"`.

Note: the code's `KINDS` table already lists all four, but only `visit`,
`closest-approach`, `observation` have named constructor helpers.
`culmination-attempt` is built via `build()` directly. The enum, not the helper
set, is authoritative.

### 3.2 `target` (object)

Exactly one of:

- `{ "starpin": <string id> }`
- `{ "cornerstone": <string id> }`

Never both, never neither, never additional keys (Part 1a.1). The id is an opaque
string that already carries its own internal prefix (e.g. `"starpin:gdr3:5382…"`,
`"V:f9…"`). The id is **not** parsed or re-typed by this layer; it is preserved
verbatim and its exact bytes are part of the record's identity. **Byte cap: id ≤
256 bytes** — this layer does not interpret the id but still bounds it, so it
cannot be an inflation route (and so `canonical_target`, which embeds it, stays
within its own 320-byte cap). A grammar for the id interior is deliberately *not*
imposed by sealed-v1 (it belongs to whatever mints starpin/cornerstone ids); v1
constrains only "non-empty string, ≤ 256 bytes, valid Unicode".

### 3.3 `event` (object)

| field | type | req? | representation |
|-------|------|------|----------------|
| `time_ms` | integer | **required** | epoch ms of the event. Safe integer (Part 1a.4). May be negative (pre-1970 events are legal). |
| `time_uncertainty_ms` | integer \| null | **required key** | ± ms, or `null` if unknown. **When a number: safe integer and ≥ 0** (a negative uncertainty is a reject). |

### 3.4 `fix` (object \| null)

`null` when no location was captured. When present, all keys below are present:

| field | type | req? | representation & range |
|-------|------|------|------------------------|
| `lat_1e7` | integer | **required** | latitude × 10⁷, safe integer. Range −900000000..900000000 inclusive. |
| `lon_1e7` | integer | **required** | longitude × 10⁷, safe integer. Range −1800000000..1800000000 inclusive. |
| `datum` | string | **required** | exactly `"WGS84"` (frozen; the only permitted value). |
| `accuracy_dm` | integer \| null | **required key** | horizontal accuracy in **decimetres** (metres × 10), safe integer **≥ 0**, or `null`. |
| `altitude_dm` | integer \| null | **required key** | altitude in **decimetres**, safe integer (may be negative), or `null`. |
| `altitude_accuracy_dm` | integer \| null | **required key** | vertical accuracy in **decimetres**, safe integer **≥ 0**, or `null`. |
| `time_ms` | integer | **required** | fix acquisition time, epoch ms, safe integer. |
| `source` | string | **required** | one of the source enum, Part 3.4.1. |

**Scaled integers, not decimal numbers (changed in revision 3).** The three
measurement fields were previously `number` limited to 1 decimal place. That form
forces every implementation to agree on "does this IEEE-754 value have ≤ 1
fractional digit?", which is exactly the cross-language ambiguity JCS number
handling is fragile around. Following the precedent already set by `lat_1e7`/
`lon_1e7`, they are now **integer decimetres**: `7.4 m → 74`. This removes the
fractional-number path from the record entirely — **sealed-v1 records contain no
non-integer numbers at all** — so there is nothing to validate about decimal
places and no rounding rule to get subtly wrong. Range caps: a reader may bound
these to sane physical ranges (e.g. `|altitude_dm| ≤ 1e8` ≈ ±10 000 km), but the
hard rule is safe-integer + sign. (Decimetre granularity is finer than any consumer
geolocation actually delivers; no real precision is lost.)

Every field in `fix` is now an integer (coordinates as `*_1e7`, measurements as
`*_dm`) or one of the two fixed strings (`datum`, `source`). **No number in a
sealed-v1 record is fractional**, so the canonicaliser's fractional-number path is
never exercised by a conforming record — one less thing for independent
implementations to agree on.

#### 3.4.1 `source` enum (frozen)

`"web-geolocation"`, `"manual"`, `"native-gnss"`, `"imported"`.

### 3.5 `evidence` (array) — **v1: empty array only**

In `starpin.record/1`, `evidence` is **exactly `[]`**. A non-empty array is a
reject. No element schema is defined for v1.

This is a permanent v1 decision, not a placeholder: because v1 readers are
fail-closed on unknown shapes (Part 1a.1), a future non-empty `evidence` element
**cannot** be added to `record/1` without breaking every existing reader. Support
for evidence elements is therefore a **`starpin.record/2`** matter (or an
explicitly versioned extension mechanism designed at that time), never a
post-freeze widening of v1. See Part 7.1 for the evolution rule.

### 3.6 `provenance` (object \| null) — **v1: null only**

In `starpin.record/1`, `provenance` is **exactly `null`**. Any object is a reject.

Same reasoning as `evidence`: a provenance object shape is a `record/2` matter, not
a v1 widening. The field exists in v1 solely so the key set is stable and a later
version can populate it; in v1 it carries no data.

### 3.7 Identifier grammars (strict, enforced on read)

Opaque identifiers are conceptually fixed-width byte values, not "strings that look
right". A reader validates them by their byte value, canonically, so noncanonical
textual encodings of the same value are rejected rather than silently accepted as
distinct.

**16-byte base64url IDs** — `publication_id`, `member_id`:

```
validate(s):
    s matches ^[A-Za-z0-9_-]{22}$          else reject   # 22 chars, unpadded
    bytes = base64url_decode_no_pad(s)
    len(bytes) == 16                        else reject
    base64url_encode_no_pad(bytes) === s    else reject   # CANONICAL round-trip
```

The round-trip is the point: 16 bytes base64url-encode to 22 chars where the last
char only carries 2 significant bits, so several 22-char strings decode to the same
16 bytes. Only the one whose re-encoding equals the input is canonical; the rest are
rejected. Without this, one 128-bit value has multiple accepted textual forms and
`publication_id` stops being a stable key.

**UUIDv4** — `record_id`, `supersedes` (when non-null):

```
validate(u):
    u matches ^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$
```

Lowercase hex only; the `4` in the third group is the **version** nibble; the
`[89ab]` leading the fourth group is the RFC 4122 **variant**. A UUID-shaped string
with the wrong version/variant bits (or uppercase) is rejected — "looks like a
UUID" is not enough, because the version/variant bits are part of what makes it a
valid v4 and prevent a client minting structured-but-nonrandom ids.

---

## Part 4 — `canonical_target`: derived-only, checked twice (decided)

Resolves the discrepancy in Part 6.1.

**Write (in `shareRecord`):** `canonical_target` is **never caller-supplied**. It
is computed as `canonicalTarget-v1(record.target)` (Part 5) and sealed. Any
`canonical_target` present in caller input is ignored/overwritten.

**Read (fail-closed):** the folder-binding is already enforced **cryptographically**
by the AAD (Part 1: `target_handle` is in the AAD, so a relocated blob fails to
decrypt at all). On top of that, once decrypted, a reader accepts the wrapper only
if **both** of these hold:

1. `targetHandle-v1(sealed.canonical_target) === opened_target_handle`
   — the handle **derived from** the sealed canonical target equals the handle of
   the folder the blob was actually opened from. `canonical_target` is the routing
   *string* (e.g. `"starpin|starpin:gdr3:5382…"`); the *handle* is
   `HKDF(group_key, "starpin-handle-v1|" + canonical_target)`. Check 1 compares
   handles, not the string against a handle. Redundant with the AAD binding by
   design — defence in depth.
2. `sealed.canonical_target === canonicalTarget-v1(sealed.record.target)`
   — the frozen canonical form of the record's own target agrees with the sealed
   routing string — a buggy or malicious client cannot seal a target object and a
   canonical target that disagree.

Disagreement on **either** check ⇒ **invalid data, rejected.** Not repaired, not
preferred-one-over-the-other; rejected.

**Why both, not one:** check 1 alone lets a client seal `record.target = A` while
routing to B's handle (the record would decrypt in B's folder describing A). Check
2 alone lets a client seal a `canonical_target` that matches its `record.target`
but route the blob to an unrelated folder. Together they pin the record's semantic
target, its frozen routing identity, and its physical location to one consistent
story.

**Why derived-only:** a caller-supplied routing string is an injection surface and
a second source of truth. There is exactly one function that turns a target into a
handle; the sealed field records *its output at creation time*, nothing else.

**Three properties bought** (ChatGPT's framing, adopted):
- *self-describing frozen data* — the exact routing identity intended at creation
  survives in the ciphertext, independent of code;
- *independent consistency checking* — target object and canonical target can
  never silently disagree;
- *future-proofing* — a reader years later validates against the sealed string and
  against `canonicalTarget-v1` (which is frozen precisely so old records still
  validate), never against "whatever `canonicalTarget()` means by then".

---

## Part 5 — `canonicalTarget-v1` (frozen grammar)

The one function that maps a `target` object to the routing string. Frozen as v1.

```
canonicalTarget-v1(target):
    # Safe even if a separate schema validator was never run — it re-checks.
    if target is not a plain JSON object      -> reject   # arrays are objects in JS: reject them too
    keys = own enumerable string keys of target
    if keys is not exactly one of {"starpin"}, {"cornerstone"}  -> reject
        # i.e. exactly one key, and it is one of the two permitted names.
        # {starpin:"A", cornerstone:"B"} -> reject (two keys), NOT "first wins".
        # {starpin:"A", foo:1}           -> reject (unknown key present).
    k = that one key
    v = target[k]
    if v is not a string                      -> reject
    if v is empty or byte-length(v) > 256     -> reject
    if v contains a lone surrogate            -> reject   # valid Unicode only
    return k + "|" + v                                    # separator is PIPE
```

- **Plain object only.** An array, `null`, a class instance, or anything with a
  non-`Object.prototype` prototype is rejected — arrays especially, since
  `typeof [] === 'object'` in JavaScript and the old check would have accepted one.
- **Exactly one permitted key.** Not "first branch wins": `{starpin, cornerstone}`
  together is a reject, and any extra key is a reject. This closes the XOR gap that
  the earlier pseudocode had (it returned the starpin form for a two-key object).
- **Separator is the pipe `|`**, not a colon. (The code uses `|`; a stale comment
  in the sharing module and some prose say `:` — the code is authoritative because
  it produced every handle to date. Part 6.2.)
- The id `v` is preserved **verbatim** after the separator — not lowercased, not
  NFC'd, not reparsed — but is bounded (≤ 256 bytes) and must be valid Unicode.
- Written to be **self-sufficient**: it performs its own rejection, so a caller
  that forgot to run the field validator first still cannot get a bad handle out of
  it.
- Frozen means: this function's output for a given target never changes across
  versions. A `canonicalTarget-v2`, if ever needed, is a new named function used
  only by records that declare it; v1 records are always validated with v1.

### 5.1 `targetHandle-v1` is already frozen (referenced, not redefined here)

Part 4's check 1 and the AAD folder-binding both depend on `targetHandle-v1`, which
makes it as protocol-critical as `canonicalTarget-v1`. It is **already frozen in the
group-v1 crypto spec** (the `FROZEN` block of `group-v1-reference.js`), so this
document only references it:

```
targetHandle-v1(canonical_target) =
    base64url_no_pad( HKDF-SHA256( ikm = group_key,
                                   salt = "" (zero length),
                                   info = "starpin-handle-v1|" + canonical_target,
                                   L = 32 ) )
```

Its input string, algorithm, output encoding (43-char unpadded base64url of 32
bytes) and version marker are all pinned there. sealed-v1 adds **no** new
requirement on it beyond: the `canonical_target` fed to it is exactly
`canonicalTarget-v1`'s output (pipe form) — see the discrepancy in Part 6.6.

---

## Part 6 — Discrepancies found (resolved here)

### 6.1 `canonical_target` was never sealed (design vs code)
Design v3/v4 say the canonical target is sealed inside the record ("no plaintext
target anywhere … sealed inside, self-describing"). The code seals only
`record.target` (the semantic object), not the frozen canonical routing string.
**Resolution:** add `canonical_target` as a required wrapper field, derived-only,
checked twice on read (Part 4). *Correction to earlier wording:* the current format
is not "non-self-describing" — `record.target` carries the semantic target; what
was missing is the frozen canonical *routing* representation. That is the thing now
preserved explicitly.

### 6.2 Separator: `|` (code) vs `:` (comment/prose)
`canonicalTarget()` returns `"starpin|"+id`; a comment two lines above it says
`"starpin:<id>"`. **Resolution:** freeze the pipe `|` (code is authoritative); fix
the misleading comment when the code is touched.

### 6.3 Free-form fields are unvalidated (the "what can a client add?" question)
`evidence`, `approach_reason`, `observation`, `provenance` are passed through with
no shape or length checks; more broadly, **no object rejected unknown keys**, so a
client could seal `record.foo = {...}` and bypass the whole discipline.
**Resolution:** Part 1a.1 makes exact-key-set-with-rejection a universal rule;
free-text fields get byte caps and `textContent` rendering; `evidence`/`provenance`
are `[]`/`null`-only in v1 (Parts 3.5–3.6); widening is `record/2` (Part 7.1).

### 6.4 AAD folder-binding was mis-stated (found in review)
An earlier draft of Part 1 listed the AAD fields **without** `target_handle`, then
leaned on a post-decrypt check for relocation defence — implying the binding was
only semantic. In fact `aadFor()` and the frozen crypto profile **already put
`target_handle` in the AAD**, so relocation fails cryptographically. **Resolution:**
Part 1 now states this correctly; the Part 4 check is defence in depth, and check 1
is written as a handle-to-handle comparison (`targetHandle-v1(canonical_target) ===
opened_handle`), not string-to-handle.

### 6.5 `canonicalTarget-v1` XOR gap (found in review)
The earlier pseudocode used `if starpin … else if cornerstone …`, so a two-key
`{starpin, cornerstone}` object returned the starpin form instead of being
rejected, and arrays (JS objects) weren't excluded. **Resolution:** Part 5 now
requires a plain object with **exactly one** permitted key and self-checks, so it
is safe even without a prior validator run.

### 6.6 Oracle golden vectors feed the WRONG canonical_target string (found in review — important)
The crypto oracle's self-test sets `TARGET = 'starpin:gdr3:5382128182680588160'`
(colon form, no `starpin|` prefix) and feeds that straight to `targetHandle()`. But
the actual app derives the handle from `canonicalTarget()`'s output, which is
`'starpin|starpin:gdr3:5382128182680588160'` (pipe-prefixed). So the oracle's handle
vectors are computed over a **different input string than the app produces** — they
prove the crypto is deterministic but not that app and oracle agree on the handle
for a real target. Because `target_handle` is in the AAD and is Part 4's check 1,
this sits on the most protocol-critical byte path there is.
**Resolution:** the frozen `canonical_target` input to `targetHandle-v1` is
unambiguously `canonicalTarget-v1`'s output (pipe form). Before the sealed-v1 /
group-v1 vectors are frozen at real values, the oracle's `TARGET` constant and the
illustrative comment on `targetHandle()` must be updated to the pipe form so the
golden vectors are computed over the string the app actually uses. This is caught
pre-freeze precisely because the vectors are still placeholder-profile and
regenerated; it must not survive to first upload.

---

## Part 7 — v1 evolution rule, and one semantic decision

### 7.1 Frozen means frozen: widening is a new version, never a v1 addition
Because every v1 object rejects unknown keys and unexpected shapes (Part 1a.1,
fail-closed), **nothing can be added to a v1 object after freeze** and still be
read by existing v1 clients. This is deliberate and it has a consequence that must
be stated so no one assumes otherwise later:

- `evidence` (empty-only) and `provenance` (null-only) **cannot be "widened" in
  v1.** The moment a real evidence element or provenance object is needed, that is
  **`starpin.record/2`** (and, if it changes the wrapper, `starpin.group-share/2`)
  — a new `schema` value that old readers reject cleanly and new readers recognise.
- There is **no implied permission to broaden v1** anywhere in this document. If a
  future field is wanted, it is designed as v2 (or via an extension mechanism
  designed *now* and named in v1 — which this version deliberately does **not**
  include; v1 has no extension point).

This is the conservative choice on purpose: additive-only-by-version is easy to
reason about and impossible to get subtly wrong, which is what a frozen hashed
format needs.

### 7.2 Dedup and the same-`record_id`/different-body conflict rule (decided)

The subtle case is a malicious or buggy code-holder **reusing an existing
`record_id` with different event bytes**. Arrival order must never pick a winner.
The full rule, by what two incoming publications share:

1. **Same `publication_id` + identical canonical wrapper** → duplicate / retry.
   One logical publication; keep one. This holds **regardless of differing
   ciphertext salt/nonce** — identity is decided on the canonical *wrapper* bytes,
   not the blob bytes (a re-seal of the same wrapper produces a new salt/nonce and
   therefore a different `content_hash`, but it is still the same publication).
2. **Same `publication_id` + DIFFERENT canonical wrapper** → **publication-id
   conflict.** Two different publications claim the same id. Preserve/quarantine
   both; **never an arrival-order winner.** This applies even when the `record` is
   byte-identical and only `member` or `comment` differs — a `publication_id` names
   one specific publication, so two different contents under it is a collision, not
   a presentation set.
3. **Different `publication_id`, byte-identical `record`** (may differ in
   `member`/`comment`) → **multiple presentations of one event.** Preserve them
   all; group by `record_id` for display ("shared by Alice — 'first light!'; also
   shared by Bob"). Presentation metadata is kept **per publication**, never
   overwritten.
4. **Same `record_id`, DIFFERENT canonical `record` bytes** → **record conflict.**
   Two records claim to be the same event with different content. **Preserve both,
   flag the conflict, and exclude them from normal same-event dedup/merge** (the
   log module already quarantines a `record_id`-collision-with-differing-bytes on
   import — §selfsync). Arrival order never chooses; neither silently wins.
5. **Different `record_id`** → different events (or a supersede chain; see below).
   Ordinary set-union, no conflict.

**`publication_id` uniqueness is scoped to the group, not global.** The same
`publication_id` value appearing in two *different* groups is not a collision (they
are different namespaces, different keys, different handles); cases 1–2 are judged
only within one group's decrypted view.

**Supersession guards (frozen):**
- **`supersedes === record_id` is rejected from the record alone.** This is a
  record-local invariant — knowable from the single record, no set needed — so it
  is a validation reject like any other malformed field.
- **Multi-record cycles are a set-level property and must NOT invalidate a record.**
  A cycle (A supersedes B, B supersedes A; or longer) only becomes knowable when a
  later record arrives that closes the loop. An otherwise-valid immutable record's
  validity must **not** depend on arrival order, so a cycle does **not** retro-
  actively make any member record invalid. Instead: graph traversal is
  **cycle-safe** (a visited-set stops the loop), and the **supersession
  relationship/chain is flagged/quarantined** — the records survive, but the chain
  is surfaced as conflicting rather than silently resolving to an arrival-order
  winner. Same philosophy as case 4: preserve, flag, never let order decide.
- **Frozen traversal depth limit: 4096.** The log module's `current()` already caps
  chain-walking at 4096; sealed-v1 freezes that exact number so two conforming
  readers agree on when a chain is "too long" (over-long ⇒ flag the chain as
  corrupt, halt traversal). The number is part of the frozen format, not an
  implementation choice — an unfrozen limit would let two readers disagree on the
  same data.

**Keying:** the group cache is keyed by **`publication_id`** (the identity of a
publication), grouped for display by `record_id`, with case 3 conflicts held aside.
This preserves the invariant that **nothing a valid member published is silently
lost**, consistent with the log's set-union/no-clobber philosophy, while denying a
hostile client any arrival-order-dependent overwrite.

### 7.2a `content_hash` note
Case 1's byte-identity and case 2's "byte-identical record" are decided on the
canonical bytes (`content_hash` for the blob; canonical record bytes for the record
comparison), never on a field-by-field eyeball. This is why the canonicaliser being
strict (Parts 1, 9) is load-bearing here: "byte-identical" is only meaningful
because there is exactly one byte representation of a given value.

### 7.3 Confirm the free-text caps
`approach_reason` ≤ 256 B, `observation` ≤ 2048 B, `handle` ≤ 64 B, `comment`
≤ 2048 B, `membership` ≤ 128 B, target id ≤ 256 B, `canonical_target` ≤ 320 B.
Proposed here; confirm before freeze.

### 7.4 Conformance vectors
Once 7.1–7.3 are settled, generate sealed-v1 vectors from this schema (canonical
wrapper → exact JCS bytes → seal → `content_hash`), plus **negative vectors** — one
per rejection rule (unknown key, `null` in a non-nullable slot, non-safe integer,
**fractional measurement (e.g. `accuracy_dm: 7.4`)**, non-NFC `handle`, lone
surrogate, two-key `target`, oversized string, non-empty `evidence`, non-null
`provenance`, noncanonical base64url id, wrong-version UUID, `supersedes ===
record_id`, relocated blob) — so both "accepts the right bytes" and "rejects the
wrong ones" are proven.

None of these touch the canonicaliser or the Argon2 params. This schema can be
frozen as soon as 7.1–7.3 are decided; 7.4 follows mechanically.

---

## Part 8 — Build order (after freeze, not before)

Per the standing discipline (finish the description, then conform the code):

1. **Rename the `fix` measurement fields to scaled integers** in `build()`:
   `accuracy_m`/`altitude_m`/`altitude_accuracy_m` (numbers) →
   `accuracy_dm`/`altitude_dm`/`altitude_accuracy_dm` (integer decimetres). This is
   a record-shape change and must land before any real upload.
2. **Fix the oracle's `canonical_target` input (Part 6.6):** update `TARGET` and the
   `targetHandle()` comment in `group-v1-reference.js` to the pipe form, and
   regenerate the placeholder vectors, so app and oracle derive the same handle.
3. Make `shareRecord()` seal `canonical_target` (derived-only).
4. Add the two read-side checks (Part 4), fail-closed, to the open/merge path.
5. Add a single `validateSealedV1(wrapper)` gate enforcing Part 1a + every field
   table (exact keys, types, ranges, caps, NFC, id grammars), used on **both** write
   and read. One validator, two call sites, so write and read cannot diverge.
6. Constrain `evidence`/`provenance` to `[]`/`null`; add the supersedes guards and
   the Part 7.2 conflict handling (reuse the log's existing quarantine path).
7. Generate and freeze the sealed-v1 conformance vectors (positive + negative).

Only then does anything about sealed-v1 become permanent — i.e. only at the first
real upload, which is gated behind the submission service and the Argon2 benchmark,
exactly as the roadmap requires.

---

## Part 9 — Byte and Unicode domain (the primitive floor)

Stated explicitly so a hostile implementation has no larger valid space than the
normal writer.

- **Encoding.** Sealed plaintext is `UTF-8( JCS(wrapper) )`, **no BOM**, no trailing
  newline. A reader that finds a BOM, non-canonical JCS, or trailing bytes rejects.
- **Unicode validity.** Every string is a sequence of valid Unicode scalar values.
  **Lone surrogates are rejected**, on both write and read, by the canonicaliser —
  not "replaced" (no reliance on `TextEncoder`'s U+FFFD substitution, which would
  let malformed input through as valid-looking bytes).
- **NFC.** Human-text fields that are compared or displayed — **`handle`** (and any
  future display field) — are **written in NFC and rejected on read if not already
  NFC**. No silent re-normalisation: re-normalising on read would change the bytes
  under a hash that was supposed to cover them. (This is distinct from the *code*
  normalisation pipeline used for group codes, which is a separate, deliberately
  more aggressive fold; record/display text gets NFC only.)
  - `comment`, `observation`, `approach_reason`, evidence `note`: NFC **not**
    required (they are free prose that may legitimately contain any normalisation);
    they are still valid-Unicode, capped, and `textContent`-rendered. Only fields
    used as stable identifiers or short display names carry the NFC requirement.
- **Opaque ids** (`record_id`, `publication_id`, `member_id`, target ids,
  `membership`): valid Unicode, byte-capped, and (for the base64url ones) grammar-
  checked; **not** NFC-folded — they are machine identifiers whose exact bytes are
  their identity.
- **Numbers.** Integers are safe integers; fractional fields are finite and obey
  their stated decimal-place limit (reject, never round). See Part 1a.4–1a.5 and
  Part 3.4.
