# Starpin `group-v1` — current-state design (v4)

> **Current implementation document — provisional, not frozen.**
> This describes the code and behaviour as it actually exists in **September 2026**,
> verified against the source, not the history of how it got here. Earlier design
> documents (v1–v3) describe some **superseded** mechanisms — most importantly v3's
> §8 server-sequence index, which the implementation does **not** use. Where an
> older doc and this one disagree, this one describes the running system; where this
> doc and the code disagree, the code wins and this doc is stale — fix it.

This replaces v3 as the normative description. It is a *specification of the present*,
not an annotated evolution. Nothing here is frozen (see §2, §10).

---

## 1. Purpose and scope

Starpin lets a person log an immutable visit to a **starpin** (a place derived from
a star) or a **cornerstone** (a HEALPix grid vertex), and optionally share chosen
visits with a small trusted group.

Three tiers, only the first of which exists in code:

- **group-v1 (this document)** — trusted family/friends sharing via a **bearer
  credential** (descriptor + secret code). No accounts, no admin, no moderation.
  Anyone with the credential can read what's shared and post under any name. This
  is the honest limit of the tier, and it's appropriate only for people you trust.
  **There is no owner in group-v1.** Every credential holder is equal; the device
  that created a group has no protocol authority the others lack (it merely retains
  the code for convenience — §8). A real owner with authority arrives only in
  `group-mod/1`. Do not add an `owner` authorization bit to group-v1 state.
- **group-mod/1** — a separate, future *moderated* profile (owner/member keys,
  invitations, signed writes, moderation). **Designed elsewhere, not built.**
- **Public sharing** — world-readable logs. **Deferred**; needs its own reviewed
  world-readable storage rules and abuse controls.

**The local device log is authoritative for a person's own records.** Sharing is a
copy-out; nothing received through sharing can alter or delete a person's own log.

---

## 2. Current deployed / provisional status

- **Realm / namespace:** `trial-2026-09`. All trial sharing runs under this tag.
- **`PROFILE.frozen === false`** in `geosonify-starpin-group.js`. The sealing fuse
  refuses to seal without either `allowProvisional:true` or a `provisionalTag`, so
  a UI action can never mint a *permanent* blob under placeholder parameters.
- **Provisional data must never silently graduate to production.** The tag is mixed
  into the Argon2 salt prefix, so trial handles/keys can never collide with frozen
  production ones. Every *local* sharing store is also namespace-suffixed (§4).
  Invites carry an explicit realm and are refused across realms (§3, §6).
- **Backend is live** for trial use: Firebase project `geosonify-starpin`,
  Firestore, anonymous auth (§5, §8). The apiKey in the adapter is public by
  design; the security rules protect the data.
- **Vendored crypto:** `@noble/hashes@1.8.0` (argon2id) + `@noble/ciphers@1.3.0`
  (xchacha20poly1305), bundled to `vendor/starpin-crypto-noble-h1.8.0-c1.3.0.js`
  and proven byte-identical to the Node oracle. The main app loads the vendored
  bundle; no runtime CDN for crypto.
- **Invite format:** version **2** (adds the realm field). v1 (realm-less) invites
  are treated as legacy/unknown and refused, never assumed to be production.

---

## 3. Credential and key model

Credential = **descriptor + secret code** (the short human code alone is *not*
sufficient — this is deliberate; there is no global code→group directory).

- **descriptor** — `group_uuid` (16 bytes, b64url), `epoch`, storage endpoint,
  label, and **realm**. Carried in the invite. Not secret on its own.
- **code** — the human bearer secret (two confusable-free words, ~39 bits).

Derivations (frozen forms — must reproduce the oracle byte-for-byte):

```
group_key     = Argon2id(code_normalised, salt = "<salt-prefix>|"+uuid+"|"+epoch, {t,m,p,dkLen})
target_handle = HKDF-SHA256(group_key, info = "starpin-handle-v1|" + canonical_target) → b64url(32)
record_key    = HKDF-SHA256(group_key, salt = record_salt, info = "starpin-record-key-v1")
seal          = XChaCha20-Poly1305(record_key, nonce, AAD) over padded plaintext
AAD           = canonical(schema, target_handle, group_uuid, epoch, kdf, cipher)
padding       = 4-byte BE length prefix + plaintext + zero-fill to a size class
```

- The **salt prefix** is the production prefix when frozen and untagged, or
  `"starpin-group-PROVISIONAL-<tag>|"` under a provisional tag — this is the
  namespacing mechanism.
- **KDF profile is a PLACEHOLDER, not the candidate production profile.** The live
  `PROFILE.argon2` is `t:2, m:512 KiB, p:1, dkLen:32` — throwaway cost for trial
  speed. The *candidate* production profile (pending the budget-Android benchmark)
  is roughly **~19 MiB / t=2** with an 8 MiB fallback; v3's `t:3/64 MiB` is
  **not** current and should be treated as an old guess. The real floor is set at
  freeze (§10).
- **canonical_target** uses ONLY the identifier (`starpin:<id>` or
  `cornerstone:<id>`), never the noisy coordinate/brightness fields. Both the
  logging path and the share/view path derive it through the one shared builder
  (`geosonify-starpin-target.js`) so they can never diverge.

**Invariant — key change ⇒ epoch change.** Any change to `group_key` for an existing
`group_uuid` (including "change the group code") MUST allocate a new epoch, because
publication bookkeeping is epoch-keyed (§6). Rotating the key while leaving epoch
unchanged would silently block re-publication under the new key. Neither rotation
nor code-change is implemented yet; this binds whoever builds them.

---

## 4. Local state (device is the source of truth)

All local stores are `localStorage` JSON, and every one is **namespace-suffixed**
under a provisional tag (`…:trial-2026-09`); untagged/production uses the bare key.

| Store | Key | Role | Kind |
|---|---|---|---|
| personal record log | (the app's log module) | the person's own visits | **durable truth** |
| groups registry | `starpin.groups.v1` | groups joined: keys, epoch, member_id, handle | durable |
| publication ledger | `starpin.published.v1` | `(group,epoch,record)` → publication_id, hash | durable (double-publish guard) |
| ownership ledger | `starpin.owned.v1` | `content_hash` → produced-by-this-device | durable (unforgeable "you") |
| group cache | `starpin.groupcache.v1` | others' decrypted shared records | **cache** (re-fetchable) |
| sync markers | `starpin.sync.v1` | `record_id` → per-group in/out share entries | optimisation / provenance |
| identity tombstone | `starpin.idtomb.v1` | `group_uuid` → member_id, handle after Leave | durable (rejoin identity) |

Which is which matters: the **personal log and the ownership ledger are truth**; the
**group cache is disposable** (purged on Leave, rebuilt on rejoin); **sync markers
are an optimisation** and must never outrank durable presence (see `haveRecordFor`,
§5). "You" is decided by the ownership ledger (content this device produced), never
by `member_id` equality.

---

## 5. Remote storage, as actually implemented

This **replaces v3 §8 entirely.** There is no server-side sequence, no monotonic
arrival order, no mutable index.

- **Layout:** Firestore `/handles/{handle}/blobs/{content_hash}`, document `{ b: <base64 ciphertext> }`. `handle` is 43-char base64url (256-bit); `content_hash` is 64 hex (SHA-256 of the blob). *(This layout is an adapter detail, not protocol.)*
- **Immutable creates only.** Rules allow `get`, bounded `list`, and `create`;
  `update` and `delete` are denied for all clients, and a catch-all denies
  everything outside the blobs path. (`firestore.rules`, verified.)
- **Bounded list under an already-known handle is allowed** (`limit ≤ 100`). What
  is forbidden is **handle enumeration**, **collection-group scans**, and any
  "list the buckets on target X" surface. So a credential holder can page the
  blobs beneath a handle they can already derive, but no one can discover unknown
  handles/groups/targets. (The enumeration refusal is a first-class requirement,
  not a courtesy.)
- **Sync = full bounded re-list + durable-state reconciliation.** Because document
  ids are content hashes (not arrival-ordered), `syncTarget` pages the handle,
  skips blobs it already holds, opens the rest, and merges. It deliberately adds
  no plaintext sequence/timing metadata.
- **"Already have it" is decided by durable presence, not sync history**
  (`haveRecordFor`): a blob is skipped only if the record it carries is actually
  in the log or the group cache right now. A surviving sync marker after a reload
  or a Leave never suppresses reconstruction.
- **Hash verification on read**; **idempotent create retry** (a lost-ACK re-create
  of identical bytes is safe — same hash, same path).
- **Per-object robustness:** a corrupt, undecryptable, or malformed blob is skipped
  individually (`continue`), never poisoning the rest of the sync.

---

## 6. Sharing semantics

Three identifiers, kept distinct:

- **`record_id`** — the event. Dedup key. Sealed inside the wrapper; **never** a
  storage key or a public identifier.
- **`publication_id`** — one share of one record into one group. Random.
- **`content_hash`** — the stored bytes. Storage key + idempotency key.

- A **group-share wrapper** (`starpin.group-share/1`) carries the selected
  record(s), the self-asserted member identity (member_id + handle), an optional
  comment, and a random `publication_id`.
- **Publication ledger key = `(namespace, group_uuid, epoch, record_id)`.** No
  legacy/epoch-less fallback: an epoch-less entry can't assert which epoch it
  belonged to, so it's ignored rather than risk a cross-epoch false "already
  shared". (Ties to the §3 key-change⇒epoch invariant.)
- **Same-target grouping uses the authoritative `canonicalTarget`**, exposed to the
  app through the integration layer — not a presentation-layer grouping heuristic.
  Two records share a "find" iff their canonical targets are equal.
- **A find is a set, not a moment.** One place can hold an approach, a closer
  approach, and a culmination; the share UI gathers them and lets the user pick
  which to send. Culminations and supported visits are checked by default; distant
  closest-approaches start unchecked. Nothing is published without an explicit act.
- **Group data never enters the personal log.** Others' decrypted shares go only to
  the group cache. This is enforced, and is the core data-safety invariant.

---

## 7. Leave / rejoin semantics

`leaveGroup(group_uuid)` is **leave/forget on this device**, not a global delete
(immutable create-only storage + no owner means nothing can delete blobs for
everyone). It:

- writes an **identity tombstone** (member_id + handle) *first*, so a crash mid-op
  leaves a harmless tombstone rather than a lost identity;
- removes the group from the registry (keys gone; sync stops);
- **purges the group cache** for that group (non-authoritative; re-fetchable);
- **purges that group's sync markers** (kept entries for other groups are
  preserved; `haveRecordFor` means rejoin reconstructs regardless);
- **preserves the publication and ownership ledgers** (never-destroy; keeps
  unforgeable-you and keeps a later rejoin double-publish-safe);
- **cannot retract already-published remote blobs** — other members may hold them.

**In-flight safety:** a sync that began before a Leave must make no further local
writes for the group. `syncTarget` re-checks membership **and epoch** before every
per-record commit and bails the whole operation if either changed; `cacheGroupRecord`
also refuses to write for a non-member. A Leave-then-rejoin at a new epoch cannot be
repopulated by the stale old-epoch operation.

**Rejoin** recovers the same member identity (tombstone) and reconstructs the group
view from remote storage.

---

## 8. Threat model / residuals (kept here, out of the FAQ)

- **Bearer credential ⇒ no authenticated authorship.** Anyone with descriptor+code
  can read and can post under any name. "You" is locally unforgeable via the
  ownership ledger, but the group cannot cryptographically attribute others' posts.
- **Code-holder target oracle.** A credential holder can derive the handle for any
  target they name and check whether the group has activity there. There is no
  browseable list of all targets a group has touched (a deliberate privacy
  property), but per-target probing by a member is inherent.
- **Firebase anonymous-auth linkage.** The backend uses anonymous auth with
  **LOCAL persistence** (a device keeps its uid across sessions — chosen for
  usability; made explicit in code after a wrong-import bug that had it falling
  back to the default silently). The service therefore sees a stable pseudonymous
  uid across otherwise-unrelated opaque handle accesses from one browser. The uid
  is an infrastructure gate, not a Starpin identity; the finds stay encrypted.
- **Access-pattern correlation.** The operator can't read blobs but can observe
  when opaque handles are read/written; closely-timed public-target and private-
  handle access can hint at a relationship. Conceded, not mitigated by crypto.
- **No enforced group write capability in direct Firestore.** Rules enforce shape
  and create-only, not "is a member of this group"; membership is bearer-based.
- **App Check / rate-limiting not yet enabled.** The one live hole is write-spam
  DoS (anon users creating junk blobs). On the free plan this is denial-of-service,
  not a bill. App Check (reCAPTCHA v3) is the chosen next step; a rate-limited
  capability endpoint is the real fix.
- **Operator/admin deletion remains possible** despite client create-only rules —
  the project owner or a privileged backend bug can delete data, and the service
  can disappear. The create-only guarantee is about *other clients*, not permanence.
- **Single-bucket / per-target metadata.** A handle-holder sees that handle's
  existence, size and growth.
- **Same-origin hostile JS** is outside the local-storage safety guarantees; the
  "sync never destroys your log" invariant is about the sharing/sync system, not a
  claim against arbitrary code running on the page or the user clearing storage.
- **Retained invitation secret on creator devices.** For usability, a device that
  *creates* a group-v1 group may retain the current epoch's human-readable bearer
  code so it can later reproduce a one-click invitation; devices that merely *join*
  do not retain the code by default. This retained secret confers **no owner/admin
  authority** — group-v1 remains a peer bearer-credential profile, and the retention
  is modelled as a capability ("this device still holds the code"), never as an
  `owner` bit. It is a local security trade-off: malicious same-origin code, or
  other compromise of that device, may recover a reusable group credential. The
  incremental exposure is narrow, though: the group registry *already* persists
  `group_key`, so a device compromise could already read the group's content —
  stealing the key did that. What the retained code adds is a *human-portable*
  credential that can be reused on another device and redistributed. The encrypted
  portable identity vault carries the retained code when the identity is explicitly
  transferred (so a new device can still issue invites); leaving the group removes
  the retained code. Kept per-epoch: a code rotation (new epoch) supersedes it.

---

## 9. Current safety invariants (compact)

1. Remote sync never replaces or deletes a personal record.
2. Malformed/conflicting remote data never overwrites local truth (per-object skip;
   cache conflicts quarantine, never clobber).
3. The provisional realm never becomes production implicitly (salt-prefix + local
   key namespacing + realm-checked invites + the frozen gate).
4. Changing the cryptographic universe (the key) requires a new epoch.
5. No group-level identifier is stored beside the ciphertext (opaque blobs only).
6. No permanent/production live write while `PROFILE.frozen === false` (the fuse).
7. No silent in-memory storage fallback in the real app (fail-closed: no persistent
   store ⇒ sharing unavailable, app still works).
8. "You" is the ownership ledger, never `member_id` equality.

---

## 10. What remains before freeze

- Replace the home-grown `canonical()` with real RFC 8785 (JCS) everywhere that
  hashes/seals.
- Benchmark Argon2id on a budget Android; set the final profile (candidate ~19 MiB
  / t=2, 8 MiB fallback — the Android result is the floor).
- Freeze final padding size classes against the final sealed field set.
- Regenerate oracle + browser conformance vectors with frozen values; confirm
  byte-identical.
- Real-browser verification (crypto smoke test done; a live two-device
  Leave→rejoin/reconstruct test still owed).
- Then, and only then: flip `PROFILE.frozen = true`, drop the provisional tag, and
  cut the first true production namespace/profile.

---

## 11. Explicitly deferred (do not build under group-v1)

- Public / world-readable sharing (needs its own reviewed rules + abuse controls).
- `group-mod/1` (moderated profile: owners, invitations, signed writes, moderation).
- Epoch **rotation** and "change group code" UI (must honour §3's invariant).
- Any everywhere-feed / cross-target index / global ordinal.
- Notifications.
- A stronger rate-limited capability endpoint / possible R2+Worker migration.
- Presence / GPS-near-target verification of shared visits.
