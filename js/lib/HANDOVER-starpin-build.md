# Starpin — handover, build phase

Written 2026-08-11, at the end of a very long build session. Companion to the two
earlier handovers (`HANDOVER-starpin.md` and its backend/licensing addendum), which
remain accurate on the concept, naming and philosophy. **This one covers the code.**

Read §7 before writing a single patch. It is short and it will save you a day.

---

## 1. Where the project actually is

There is a **working app**. It is not a mock. Greg has bagged real starpins and real
cornerstones with it, in Christchurch, on an iPhone, in the field.

What works today:

- the culmination clock (global countdown, sidereal phase dial, sun altitude, darkness)
- a Leaflet map with the HEALPix lattice drawn over OSM / Esri topo / Esri aerial
- live star lookup from VizieR around wherever the map or your feet are
- a two-target compass (nearest starpin + nearest cornerstone) with cardinal marks,
  device-heading compass mode, and an audio proximity guide
- logging visits and closest approaches to `record-v1`, stored locally, exportable
- claim cards for both starpins and cornerstones, on screen and as shareable PNGs
- the Geosonify vocabularies as a first-class position notation, encode **and** decode
- 190 passing tests across three suites

**Three suites, all green:**

```
geosonify-starpin_selftest.js       99 passed
geosonify-starpin-log_selftest.js   66 passed
geosonify-starpin-map_selftest.js   25 passed
```

Run all three before and after any change. They exist because each one caught a real
bug that had already shipped.

---

## 2. File manifest

**New modules — these go in `js/lib/`:**

| File | What it owns |
|---|---|
| `geosonify-starpin.js` | the engine: identity, BigInt handling, the address transform, `culmination-v1`, `attendance-v1`, the sun, `visit-geometry-v1`, cornerstones, `assessRecord`, `rankByTarget` |
| `geosonify-starpin-log.js` | `record-v1`: building, storing, merging, retracting, content hashing |
| `geosonify-starpin-map.js` | the Leaflet lattice map, basemaps, markers, tap hit-testing |
| `geosonify-starpin-feedback.js` | rarity tiers, the proximity dial, the pulse, confetti, the Dorian lead |
| `geosonify-starpin-card.js` | claim cards, DOM and canvas, light/dark, share |
| `geosonify-starpin-clock.js` | the culmination clock panel |
| `geosonify-starpin-readout.js` | position notation: encode, decode, format picker |

**Self-tests** — same folder as the other `*_selftest.js` files:
`geosonify-starpin_selftest.js`, `geosonify-starpin-log_selftest.js`,
`geosonify-starpin-map_selftest.js`.

**The app** — `starpin-demo.html` at the **repo root**, beside `index.html`.

**Edited Geosonify files** (the ByteWords purge, §6): `card-renderer.js`, `index.html`,
`geosonify-geo-core_v11_8o.js`, `geosonify-url-codec_v1_1.js`, `load-cardrenderer.js`,
`precision-gates.js`.

**Design documents:** `starpin-protocol-v1-draft.md`, `starpin-infrastructure.md`,
`starpin-proposal-0.2.md`. Proposal 0.2 supersedes §§1–5 of the protocol draft.

---

## 3. Decisions settled in this session

These were argued out and should not be relitigated without new information.

**Cross-order rarity.** A vertex sits at lattice point (x, y); the line x = const
survives to order `i − v₂(x)` where v₂ is the 2-adic valuation, likewise y. So
`intrinsic = i − min(v₂)` and `cross = i − max(v₂)`, and the class "order-c line
crossing an order-i line" has an **exact** density: 1 in 4 when c = i, else
1 in 2^(i−c+1). Quoting the plain order figure understated a mixed crossing by up to
64×. `F.crossShare / crossCount / crossSpacingM`.

**Spacing figures are means.** HEALPix cells are equal-*area*, not equal-*shape*, so
neighbour distances vary around the pitch. The copy says "on average" and must keep
saying so.

**Arrival ≠ acceptance.** R (`visit-geometry-v1`, 3 arcsec ≈ 92.8 m) is generous on
purpose so a starpin behind a fence can be logged from the footpath. *Arrival* is
within 15 m with a fix better than ±30 m. Conflating them made the app claim "you're
standing on it" from 60 m away.

**Verdict vocabulary is protocol; UI speaks sentences.** `not-supported` stays in the
record; the person reads "too far from where you are".

**Collectible floor at order 12.** Order 14 puts ~50,000 cornerstones within 50 km and
17% of all ground within R of one. Finer orders still log, but get an honest tier and
no celebration.

**Content hashes detect damage and disagreement, never dishonesty.** The algorithm is
in the source; anyone editing a record can recompute it. A self-hash proves a record
*undamaged*, never *true*. There is a test asserting that limitation deliberately.

**No universal score.** Separate counts, separate collections. The tally is starpins /
cornerstones / rare finds.

**Starpins are not vertices.** Star rarity comes from magnitude via `F.starTier`, hedged
with `G ≈` and never promising a sighting. Grep-level tests stop lattice language
leaking into star copy — it has leaked twice.

---

## 4. Things the code does that look odd but are deliberate

- **`sourceIdOf()` takes the trailing digit run.** `replace(/\D/g,'')` on
  "Gaia DR3 5382…" yields "35382…" — the 3 from "DR3". That bug shipped **three
  times** in different places. There is now one helper; use it.
- **`decodeSourceId` throws on a `Number`.** A rounded source_id still yields the right
  HEALPix cell, so cell maths passes while identity is silently wrong.
- **Records are frozen and never edited.** Corrections and backfills add a superseding
  record; the original stays. Merge is a set union, so this is what keeps two devices
  convergent.
- **`fix.source` is `web-geolocation`, never `gps`.** The Web Geolocation API does not
  tell you the provider.
- **The map's coarse orders are drawn even when a cell is 60× the view.** A coarse edge
  through your street is the rarest line on screen. Dropping it was a bug.
- **`strokeFor(order, spanM)` is anchored to cells-across-the-view**, not to a fixed
  order. The old fixed anchor made six orders clip to the same cap and stack.
- **Card exports are drawn natively on canvas**, not screenshotted. The sky cutout is
  cross-origin and taints the canvas.

---

## 5. Bugs that recurred — patterns to watch

1. **Silent no-op patches.** A `str_replace`-style edit whose anchor had drifted did
   nothing, while a *related* edit landed — producing `ReferenceError: MUTED` and, on
   another occasion, a map that drew no grid at all for a whole release. **Assert every
   replacement.** See §7.
2. **`node --check` is not a test.** It passed on a build whose `draw()` threw on every
   frame. `geosonify-starpin-map_selftest.js` exists because of that.
3. **Copy deleted "successfully" but still on screen** — the sentence wrapped across two
   source lines and only one was matched. Check the rendered output, not the diff.
4. **My own test expectations were wrong three times**, and in each case the code was
   right. When a test fails, work out which side is wrong before "fixing" it.

---

## 6. ByteWords / ByteEmoji: deleted, permanently

They had never been public, so no codes existed in the wild and the frozen-format rule
had nothing to protect. Removed outright — 69 references across six files, including
the URL-codec prefixes `b`/`w`/`y`/`ob`/`ow`/`oy`, the `cardState.order` entries, and
117 lines of ByteWordsMin sentence-mnemonic code in `geosonify-geo-core`. Zero
references remain. **If `byteWordsArray`, `byteWordsMinimalArray` or `byteEmojiArray`
still exist in a data file outside the snapshot I had, delete those too.**

---

## 7. Working rules for the next chat

- **Read `ARCHITECTURE.md` before non-trivial edits**, and the Geosonify traps: liveness
  is decided only by `<script>` tags in `index.html`; `scanner-service.js` stays
  disabled; frozen formats never change; the URL grammar is add-only; most core logic is
  in the inline script in `index.html`; coordinate truth is `GeosonifyMain.getExact()`.
- **Assert every patch.** Wrap edits so a failed anchor match is loud:
  ```python
  def rep(old, new, label):
      assert old in text, 'NO-OP: ' + label
  ```
  Two shipped regressions came from silent no-ops.
- **Run all three suites** before and after. Add a test for any bug you fix.
- **Verify against the repo, not memory.** `thumbnailUrl` takes arcminutes not arcsec;
  `CardRenderer.decode` exists; `index.html` loads sky-neighbour *before* sky-stars.
  All three were assumed wrongly first.
- **Check the field screenshots.** Several bugs were only visible on a phone: markers
  offset by a caption inside the positioned box, a compass that could not be turned
  off, a card claiming rarity it did not have.

---

## 8. TO DO

### 8.1 Culmination attendance — BUILT 13 Aug 2026, see the note at the end

**The gap:** you cannot currently be *at* a starpin *at* culmination and have the app
know. The clock lives on the Sky tab, bagging lives on Go, and the moment passes while
you are looking at the wrong screen.

**The design:**

**A global countdown bar.** At **T−15 minutes**, a single-line bar appears locked to the
top of the viewport on **every tab** — it must not be dismissible by switching tabs,
because the whole failure mode is being on the wrong screen. One line: time remaining,
and the nearest starpin with its distance, so you know whether it is worth running.
It should say plainly whether you are close enough to count.

**The sound.** In the final seconds, a **location-specific ascending arpeggio**, derived
from the coordinates the way Geosonify already derives music from position — so the run-up
is *this place's* arpeggio, not a generic one — climaxing in a **grand chord at the
instant of culmination**. Reuse `geosonify-scales-v1.js` and the existing sonification
path rather than inventing a scale. The Dorian lead in
`geosonify-starpin-feedback.js` (`playDorianLead`) is the model for the synthesis: saws
through a resonant filter into a dotted-eighth delay.

**The moment.** If you are within R of a starpin when the clock hits zero, offer to
record it. `attendance-v1` already exists and derives attendance from the raw timestamp
at ±60 s, so the app only has to capture a record at the right moment; the verdict is
derived as always.

**The record model — my recommendation, since you asked me to figure it out:** a
culmination attendance is a **separate event**, so it is a **separate record** with
`kind: 'culmination-attempt'` (already in `KINDS`) targeting the same starpin. Do **not**
edit the visit record: two events, two records, both durable. The card then *derives*
both dates from the record set for that target — "visited 9 Aug 2026", "culmination
attended 14 Sep 2026". If a visit record already exists, the offer should say so
("add the culmination to Vega") rather than implying a fresh find.

**The designator.** A starpin with a derived attendance gets a **gold border** — on the
record card in the log, on the full-screen card, and in the **downloadable PNG**. Use
`--sun` / `#DCC949` with a heavier stroke and a small "at culmination" mark. It should
be the most conspicuous thing in the log, because it is the hardest thing to get: the
right place, the right instant, and the instant slides 3m 56s earlier every day.

**Watch for:** the countdown must be recomputed, never cached (sidereal day is
23h56m04s); the bar must not fire the sound more than once; and the offer must not
appear if the person already has an attendance record for that starpin at that
culmination.

**BUILT 13 Aug 2026.** The trigger was Greg standing at a starpin at culmination,
tapping bag, and the app writing nothing: `bagStar` returned early on “already
yours”, and since you have to know where a starpin is to be standing on it, the
guard fired precisely when the event mattered. That moment is gone —
attendance-v1 derives from the raw timestamp, so with no record there is nothing
to derive from. What now exists: the T−15 bar on every tab, recomputed each
tick; the place-derived ascending arpeggio into a chord on the instant; a
separate `culmination-attempt` record; and the gold designator in the log.

Extended the same day with **the moment**: for the last ten seconds a
full-screen panel on every tab, the countdown fading as three lines arrive one
at a time — *Look up at the sky. Look down at your feet on the earth. You are
here, now.* — with “now” appearing only at t=0. It does not auto-record. The
button (“Mark this occasion”) is the person’s deliberate act, and it stays
available for the whole 60 s afterwards that attendance-v1 allows, so a slow tap
still counts. The panel shows for anyone, anywhere; only the button needs you
within R, because arrival is not acceptance. The card and the downloadable PNG
now carry both dates and the gold border.

**Field-tested 14 Aug 2026** — Greg marked a culmination, same spot as the day
before, and the ritual landed. Five bugs the field found, all fixed the same
day:
1. the full stop now arrives with “now”, not before it;
2. the arpeggio was silent — the audio context was suspended because nothing in
   the culmination path is a gesture, and the arm window could be skipped by a
   throttled background timer. Now the context is warmed on any earlier touch,
   the run arms on any tick inside the lead, and the bar says so if it still
   could not sound;
3. the card showed the culmination date as the VISIT date, hiding the original
   find. Both dates now derive from the record set (`firstVisitMsFor`,
   `culminationMsFor`), so any card for the star shows both;
4. the attendance row rendered ghosted with the delete backing showing through,
   because rankByTarget ranked it below a closer earlier visit and the row was
   dimmed for “losing” a contest it was never in. A culmination-attempt is now
   never dimmed and never told it was beaten;
5. the moment modal reopened every second after being closed — dismissal is now
   sticky per culmination.

The gold designator frames the whole swipe row (not the inner card, which let
the backing peek), and the downloadable card carries both dates and the gold
border.

**Still watching:** `attendance()` snaps to the NEAREST culmination, so any
arithmetic involving exactly half a sidereal day sits on a knife edge — a test
of mine failed one run in four for that reason before it stepped clear of the
midpoint.

### 8.2 Seeded constellation generator — figures from your own starpins

**The idea (Greg's, 11 Aug):** given the starpins a person has bagged, draw a
plausible constellation joining them. Not one canonical answer — a **seed**, a
**Shuffle** button, and many geometrically sensible readings of the same stars.
A branching tree, not a single path, because that is what constellation figures
actually look like. Saved as a Geosonify display link that toggles between the
Aladin starfield and the aerial view of the ground.

**The part that makes it worth building.** Declination reads as latitude and
right ascension as longitude, so a figure drawn through a person's starpins is
*one* set of vertices rendered in two projections. Sky view and Earth view are
not two figures that have to be kept in agreement — they are the same numbers.
Nothing in the format needs to carry both.

**Reuse, do not invent.** `geosonify-sky-figures.js` already states the case: a
constellation figure is an ordered vertex list, which is exactly a Geosonify
PATH — it needs no units, already delta-compresses, and already survives
truncation. Orion and Crux are in there as segment lists. A generated figure
should be the same shape of object, so it flows through the existing path and
URL machinery untouched.

**Algorithm, recommended.** MST on **true angular separation**, then a seeded
perturbation of the edge weights, re-run, and score. Perturbing weights rather
than rewiring keeps every candidate a valid tree and keeps the whole thing one
deterministic function of (star set, seed). Measured on a synthetic 12-star
patch at Christchurch scale: MST floor 436 arcsec; ±35% jitter gives 12 distinct
trees from 12 seeds at 467 arcsec, about 7% longer. Variety is cheap and does
not require the figure to get ugly. Score on total length, crossings, extreme
edges, awkward angles, balance — but note crossings are nearly free on a tree at
these scales, so length and angle will do most of the work.

**Use spherical separation, never Euclidean in RA/Dec.** On the eight starpins
currently logged, `hypot(dRA, dDec)` is wrong by up to **37.7%** against true
angular separation, because they sit at dec −43.5 where a degree of RA is 0.72
of a degree of sky. The naive version does not fail loudly; it produces a tree
that is merely *wrong*, systematically stretched east–west, and it will look
almost right. Same class of error as `replace(/\D/g,'')` on a source id.

**What is saved is the PATH, not the recipe.** The link carries the vertex list
of the figure the person generated and kept. It is not “regenerate a
constellation from this seed”, so none of the generator — edge ordering,
tie-breaks, PRNG, jitter, scoring — is a frozen format, and adding a starpin
later does not disturb a figure already made. The seed is a label that lets you
say where a figure came from and get it again in the same session; the path is
the artefact. Links are plain enough to edit by hand, and that is a feature.

**Watch for:**

- **One constellation per region, chosen by the person.** Figures are drawn from
  a selected subset, so a Christchurch set and an India set are two figures, not
  one figure spanning 102.5° of sky. The generator should not be handed the
  whole log by default.
- **RA 0/360 and the antimeridian.** `bounds()` in `geosonify-sky-figures.js`
  says outright that its plain min/max is only safe because the demo figures do
  not straddle RA 0. A figure over a person's real travels will.
- **Deterministic tie-breaks** within a session, so Shuffle is repeatable and
  a seed shown next to a figure means something — sort on (weight, lower id,
  higher id), never on insertion order.
- **Two records for one starpin** must not become two vertices; group on the
  canonical target key, as `rankByTarget` does.

**Still open:** whether a figure is a private object or a claimable one. That is
a social-layer question and should stay deferred with the rest of section 9.

### 8.3 Smaller, ready to pick up

- **Star facts still absent for some records.** The backfill fills what the catalogue
  has, but Gaia genuinely lacks magnitude or parallax for some sources. Confirm the copy
  reads honestly when it does.
- **Bright-star tier.** Gaia saturates near G ≈ 3 and is incomplete brighter than G ≈ 6,
  so the naked-eye tier cannot come from Gaia. Needs the IAU-CSN work in proposal 0.2 §7,
  including the frozen cross-match so one physical star is one collectible.
- **Earth/sky mode toggle** (proposal 0.2, deferred): the same HEALPix grid drawn in
  RA/Dec with stars as the primary layer, sharing the 30.92 m ⁄ arcsec scale lock.
- **`canonical()` should become RFC 8785 (JCS)** before any hash is exchanged between
  implementations.
- **Manifest pilot** — still blocked on "what does Starpin mean by a star?" (proposal
  0.2 §11.1). Nothing about manifests should be frozen until that is answered.
- **Cornerstone dot sizes on the map** do not respond to zoom the way the lines do; a
  rare cornerstone is still a small dot at close zoom.
- **`run-sky-tests.sh` looks stale** — it lists `*.selftest.js` with a dot while the
  files on disk use `_selftest.js`. Worth checking before adding the new suites to it.

---

## 9. Still open, from the design phase

Unchanged from proposal 0.2 §11: what counts as a star; N per cell; delivery tile order;
CSN fallback identifiers; satellite-trail catch rate; app licensing (which gates F-Droid
and the CLA question); and the public-projection parameters, deliberately deferred until
a social layer is actually designed.

---

## 10. The sentence all of it exists to protect

> **Every star already has a place on Earth.**

Greg has now stood on several of them. The job of the code is to make that sentence
survive contact with a phone, a paddock, and twenty years of implementations, without
ever becoming false.
