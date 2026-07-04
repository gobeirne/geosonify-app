---
**READ FIRST — how to use this document**

This is the authoritative architecture reference for this project, distilled from a
full codebase analysis. It is long by design: read it by section, on demand, not
front to back. The project's custom instructions carry a short version of the traps
below and point here for depth — this file is the depth.

**If you only read one thing, read this:** the failure mode this codebase fears most
is a silently different derivation that decodes old codes to *plausible wrong
locations*, possibly years later. Anything near hashing, sorting, normalisation,
prefixes, grid contents, or the frozen formats must reproduce the frozen test vectors
byte-for-byte. New behaviour = a new versioned format; old decode support is forever.

**The five traps that a cold read of this repo gets wrong:**
1. Versioned filenames lie about what's live — the `<script>` tags in `index.html`
   are the only liveness authority (the live scanner is `_v1_0`, not `_v2`).
2. `scanner-service.js` is deliberately disabled; re-enabling it breaks scanning.
3. Frozen formats (grid-shuffle v1, healpix-pass-v1, GeoCodec obfuscation, AES URL
   blob, existing grid arrays) must never change — see "Key Constraints and Invariants".
4. Most core logic and all URL parsing live in the giant inline script in
   `index.html`, not the `js/` modules.
5. Coordinate truth is the exact point (`GeosonifyMain.getExact()`), not the lossy
   doubles in `AppState.coordinate`.

**How to trust this document:** verify surprising claims against the real file before
acting — this doc is known to contain at least one unverified path claim (the
`gates.js` require path). If the doc and the code disagree, surface the conflict; the
doc can go stale as the code moves. Each claim is tagged `[code]`, `[docs]`,
`[inferred]`, or `[unknown]` — weight them accordingly.

**Where to look:** "Module / Component Map" for what a file does and whether it's
live; "Key Constraints and Invariants" and "Non-Obvious Decisions and Load-Bearing
Quirks" before any edit near formats, derivations, or the frozen boundary; "Common
Edit Patterns" for recipes; "Quick Reference for Future Editors" for the one-screen
summary.

Last full distillation: Fable, 2026-07-04. Refreshes since then may be partial.
---


# Architecture Guide

> Last verified against: working copy dated 2026-07-04 (no git metadata was available in the analysis environment; latest cache-bust query strings in `index.html` are `?v=20260703b`) — treat claims as increasingly stale after this point.

## Sources and Gaps

**Actually read this run:** `index.html` (script tags, both inline scripts including the AES block and legacy app structure), `js/main.js`, `js/core/*` (all), `js/services/*` headers + key logic, `js/features/*` headers, `js/ui/card-renderer.js` (CARD_GRIDS registry, frozen shuffle, encode/decode pipeline, checksum, HUMAN_PRESETS), `js/ui/*` headers, `js/lib/*` headers and the frozen-format sections of `geosonify-healpix.js`, `geosonify-codec-engine_v11_8a.js`, `geosonify-url-codec_v1_1.js`, `spec/grid-passphrase-v1-reference.js`, `gates.js`, `precision-gates.js`, `load-cardrenderer.js`, `js/lib/faq-data.js` (mined for rationale), `LICENSE`, `CNAME`, `site.webmanifest`.

**Not available in this environment (real gaps):**
- **Project conversation history was NOT available.** The "why" recorded below comes from unusually rich in-code comments and `js/lib/faq-data.js`, both of which explicitly encode design rationale. `[conversation]` tags are therefore never used.
- `README.md`, `COPYRIGHT`, `spec/FROZEN-FORMAT-SPEC.md`, and `b²s² bounding box shortcut scheme.pdf` exist in the file tree but were not readable this run. `FROZEN-FORMAT-SPEC.md` is referenced by code comments as the normative frozen-format document [code: `js/ui/card-renderer.js` ~line 879, `spec/grid-passphrase-v1-reference.js`]; read it before touching anything marked FROZEN.
- `js/lib/faq-data_old.js` and `js/lib/geosonify-scanner-lib_v2.1.js` (dot variant) were not readable this run; classified from naming + load analysis only.
- The analysis copy was a flat file list, so `js/geosonify-precision.js` (repo root of `js/`) and `js/lib/geosonify-precision.js` could not be diffed against each other. `index.html` loads **only** `js/lib/geosonify-precision.js`; treat `js/geosonify-precision.js` as a suspected stale duplicate and verify by diff before deleting.
- `precision-gates.js` references a `HANDOVER-precision-control.md` that is not in the file tree — its 7 gate definitions are the surviving record of that document.

## Project Overview

Geosonify (deployed at `geosonify.org` [code: `CNAME`], MPL-2.0 [code: `LICENSE`], created by Greg O'Beirne 2012–2026 [docs: `js/lib/faq-data.js` credits]) is a **fully client-side, zero-build, static web app** — one `index.html` plus plain `<script>`-tag JS files, no bundler, no package.json, no server component. It is a PWA (`site.webmanifest`, standalone display).

**What it does** [code + docs: `js/lib/faq-data.js`]:
1. **Encodes geographic coordinates as hierarchical codes** by recursive grid subdivision: divide Earth into an R×C grid, record the cell's symbol, subdivide that cell, repeat. Each added character refines the location; truncating from the right gives the *same* place at coarser precision (the "graceful truncation" trademark property).
2. Renders the same location simultaneously in many **"cards"** (vocabularies): alphanumeric 6×6, emoji 28×28, musical notation 7×7 (rendered as sheet music via VexFlow), NATO, HexByte 16×16, Base64 8×8, BIP39 word grids in 10 languages (45×45 = 2025 cells, with CRC32C checksum words), colour swatches (ChromaCoord/RGB111), QR/Data Matrix barcodes, chess-board positions, HEALPix equal-area cells (3 serializations), and professional GIS schemes (Plus Codes, MGRS, Geohash, UTM, NZTM, BNG, MGA).
3. **Privacy layers**: passphrase-keyed grid permutation (frozen format v1), reversible position-shift "obfuscation", and AES-256-GCM whole-URL encryption (`?enc=`).
4. **Shapes and paths**: rectangles, circles, graticules, paths and polygons, delta-compressed into URLs; GPX/KML/GeoJSON/Wikidata/OSM/cadastral-parcel import; GPX playback.
5. **Sonification**: location-driven generative audio (Tone.js), GPS journey mode, piano-roll display, pocket mode.
6. **Scanning**: camera/image decode of ChromaCoord colour codes, QR, Data Matrix, and chess boards.

**Inputs**: map taps, GPS, typed coordinates/codes, URL query parameters, uploaded/linked shape files, camera images, custom CSV/TSV grids. **Outputs**: codes on cards, shareable URLs, GPX/KML exports, audio, rendered barcodes/boards/notation. **Users**: humans via the web UI; other instances of the app via shared URLs (the URL grammar is therefore a public contract).

## Module / Component Map

Load order in `index.html` is the dependency order (plain script tags share one global scope; nothing is ES-module). Roles: **core** (app breaks without it), **support**, **vendored**, **legacy/orphan** (present but NOT loaded by `index.html`), **test** (Node-only), **docs**.

### Loaded by the browser (live), in load order

| Path | Role | Purpose / key exports | Depends on | Edit risk |
|---|---|---|---|---|
| CDN: js-sha3 0.9.2, vexflow 4.2.3, leaflet, geographiclib-geodesic | vendored | `sha3_512` (frozen shuffle!), notation, map, geodesics | — | Pinned versions; js-sha3 is part of the frozen passphrase pipeline |
| `js/lib/geosonify-grids-data.js` | core | All base grid arrays (`alphanumericArray`, `emojiArray`, `hexByteArray`, BIP39 arrays…), as bare `const` globals | — | **FROZEN** — grid contents/order are part of the code format |
| `js/lib/geosonify-codec-engine_v11_8a.js` | core | `GeoCodec`: `encodeHierarchical`/`decodeHierarchical` (lines 247/263), `tokenizeCode`, `applyObfuscation`, own SHA3-512, Karney/Vincenty distance | GeographicLib (optional) | **FROZEN** obfuscation derivation (see Constraints) |
| `js/lib/geosonify-rgb111-lib_v2_5.js` | core | `RGB111Lib`: 4×4 RGB111 image encoder, CRC-8 4-notch | — | Frozen visual format (scanners in the wild) |
| `js/lib/geosonify-barcode-lib_v1_0.js` | support | `BarcodeLib`: QR/Data Matrix encode/decode; lazy-loads qrcode-generator, jsQR, bwip-js from CDN | LazyLoad (indirect) | Capacity caps mirrored in card definitions |
| `js/lib/geosonify-fullscreen_v1_25.js` | support | Fullscreen code overlay, 3×3 neighbour grid view, settings | GeoCodec, DOM | Self-contained UI |
| `js/lib/geosonify-scanner-lib_v1_0.js` | core | **The live scanner.** Exports `window.RGB111Scanner` (line 2277): ray-cast edge detection, perspective correction (OpenCV lazy), CIELAB classification | OpenCV.js (lazy) | See scanner-service quirk below |
| `js/lib/geosonify-vexflow-lib_v1_0.js` | support | `VexFlowLib`: musical-code → grand-staff rendering | VexFlow CDN | Musical grid tokens duplicated here from grids-data |
| `js/lib/geosonify-url-codec_v1_1.js` | core | `URLCodec`: URL param grammar (`PARAM_GRID_MAP`, flag suffixes), delta paths, shape params | GeoCodec, DeltaGear, CompactCodec | **URL grammar is a public contract** |
| `js/lib/geosonify-custom-grid-v1_1.js` | support | `CustomGridLoader`: user CSV/TSV grids → `CARD_GRIDS`; localStorage `geosonify_custom_grids` | CARD_GRIDS (injected) | — |
| `js/core/app-state.js` | core | `AppState`: pub/sub single store. Note `exact` (lossless decimal-string lat/lon + provenance meta) vs `coordinate` (lossy doubles) | — | The exact/coordinate split is load-bearing (see Constraints) |
| `js/core/lazy-load.js` | core | `LazyLoad.script()/opencv()/tone()` CDN loader | — | — |
| `js/core/geo-math.js` | core | `GeoMath`: geodesics, hulls, rectangle fitting, graticules | GeographicLib | Legacy code consumes via aliases (see bridge) |
| `js/core/compact-codec.js` | core | `CompactCodec`: shape-param encodings (raw / base36 / base64url), unit tables | — | Encodings appear in shared URLs — frozen in practice |
| `js/core/delta-gear.js` | core | `DeltaGear`: gear-change delta path format `firstCode~d{K}{HEX_K}{payload}` | — | Wire format in URLs — frozen in practice |
| `js/services/audio-service.js` | support | `AudioService` v6.1: Tone.js synthesis, pattern evolution, note event bus | Tone.js (lazy) | Large; internally versioned changelog in header |
| `js/services/journey-service.js` | support | `JourneyService`: waypoint→preset lerping; localStorage | AudioService | — |
| ~~`js/services/scanner-service.js`~~ | **disabled** | Script tag is **commented out** in `index.html` (~line 631): *"REMOVED: overwrites RGB111Scanner with broken implementation"* | — | **Do not re-enable casually** — it assigns `global.RGB111Scanner = ScannerService` (line 739), clobbering the working scanner |
| `js/features/map-manager.js` | core | `MapManager`: Leaflet map, pin, shape layers, HEALPix path cells | Leaflet | — |
| `js/features/gps-tracking.js` | support | `GPSTracking`: geolocation watch | MapManager, AppState | — |
| `js/features/shape-import.js` | support | `ShapeImport`: Wikidata/place/OSM/GeoJSON/KML/GPX import | Nominatim, Overpass, Wikidata SPARQL, legacy globals (`geodesicDistance`) | Relies on inline-script globals |
| `js/features/property-import.js` | support | `PropertyImport`: address → cadastral parcel via free ArcGIS/OGC/WFS/IGN services | Nominatim + provider registry | **Cost-safety rule**: only keyless or free-key providers, ever [code: header] |
| `js/pocket-mode.js` | support | Black-screen wake-lock overlay | — | — |
| `js/ui/audio-ui.js`, `js/ui/piano-roll.js` | support | Audio controls; scrolling note display | AudioService | — |
| `js/ui/scanner-ui.js` | support | Camera/upload modal for scanning; corner-freeze workflow | `RGB111Scanner` global | — |
| `js/lib/gis-grids.js` | core | `GISGrids`: 8 professional schemes, self-contained Krüger TM + Helmert (no proj4) | — | Projection math verified vs EPSG ground truth [code: header]; sub-mm claims are per-CRS |
| `js/lib/geosonify-healpix.js` | core | `HealpixGrids`: NESTED HEALPix, BigInt address layer, cards `hphex`/`hpquad`/`hp64`, frozen `geosonify-healpix-pass-v1` permutation/obfuscation. Vendors @hscmap/healpix (MIT) verbatim at bottom | shuffle fn injected by card-renderer | **FROZEN** pass format; MAX_ORDER=73, PROJECTION_EXACT_ORDER=26 |
| `js/lib/decimal.min.js` | vendored | decimal.js — do not edit | — | — |
| `js/lib/geosonify-precision.js` | core | `GeoPrecision`: exact rational lat/lon at 120 sig digits; `fromLatLon`/`fromGeosonifyCode`/`fromHealpixCode`; provenance/uncertainty | Decimal, HealpixGrids (TDZ-safe bare-identifier resolution — see Quirks) | — |
| `js/lib/import-accuracy.js` | support | `ImportAccuracy`: round-trip loss readout for imports; injected encode/decode so numbers are the app's real loss | — | — |
| `js/lib/geosonify-chessboard-lib_v1_0.js` | core | `ChessboardLib` (GeoChess-Visible-104): mixed-radix bijection hex↔legal-looking board; kings-out-of-rank ⇒ never in check; max 23 hex; refuses (never truncates) oversize payloads | — | The rank/unrank family definition is a frozen bijection |
| `js/ui/card-renderer.js` | **core (largest, ~6.6k lines)** | `CARD_GRIDS` registry (line 54), card DOM, **frozen `shuffleGridAndOrder`** (lines 869–…), encode/decode dispatch, obfuscation wiring, CRC32C checksums, Data-Matrix mode signifiers, HUMAN_PRESETS, provenance ℹ️ box | Nearly everything above | Highest-risk file in the repo |
| `js/lib/bip39-geo-lookup.js` | generated | `BIP39_GEO_LOOKUP`: word-index → region name, generated 2026-03-24 from Natural Earth + IHO [code: header] | — | Regenerate, don't hand-edit |
| `js/lib/geosonify-bip39-entry.js` | support | `BIP39Entry`: word-slot entry UI with live checksums and map zoom-in | CardRenderer, BIP39_GEO_LOOKUP | — |
| `js/lib/faq-data.js` → `js/ui/faq-ui.js` | docs/support | `GEOSONIFY_FAQ` content (HTML-in-JS, CRLF line endings, translation instructions in header); renderer | — | FAQ documents user-facing contracts — keep in sync with behaviour |
| `index.html` inline script #1 (~line 657) | core | Global **alias bridge** (`const R = GeoMath.R;` etc. for GeoMath/CompactCodec/CardRenderer) + **AES-256-GCM URL encryption format v1** (~line 744) | modules above | Removing an alias breaks the legacy script silently |
| `index.html` inline script #2 (~lines 1501–10008) | core/legacy | The original monolith: map & global state, URL parse/share, shape drawing, OBB fitting, delta path encoding, multi-polygon decode, GPX import/playback/export, display mode (`?display`) | everything | ~8.5k lines, no module boundary; the main refactor debt |
| `js/main.js` | core | `GeosonifyMain`: init order, event bridges legacy↔AppState, `setCoordinate()` (stamps the exact point), `getExact()`, autosave to localStorage `geosonify-app-state` | AppState, GeoPrecision | `parseURL()` is a stub — URL parsing still lives in the legacy inline script [code: `js/main.js` ~line 300] |

### Not loaded by the browser

| Path | Role | Notes |
|---|---|---|
| `js/lib/geosonify-geo-core_v11_8o.js` | legacy/orphan | Predecessor UI layer ("injects codec UI") from before card-renderer; not referenced anywhere loaded. Safe to ignore; verify before delete |
| `js/lib/geosonify-scanner-lib_v2.1.js`, `js/lib/geosonify-scanner-lib_v2_1.js` | legacy/orphan | v2 scanner (dot and underscore filename variants of what appears to be the same lib). **v1_0 is the live one.** The versioned suffix does not mean newest = live |
| `js/lib/geosonify-scan-ui_v1_0.js` | legacy/orphan | Older scan UI superseded by `js/ui/scanner-ui.js` |
| `js/services/scanner-service.js` | disabled | See table above — deliberately commented out |
| `js/lib/geosonify-healpix-path.js` | experimental/orphan | Tier-3 HEALPix path/polygon wire format, design "settled, verified against live production URLs" per header, but **not loaded** and `HealpixPath` is referenced by no loaded file. `map-manager.js`'s `drawHealpixPathCells` is unrelated rendering. Wire design notes in its header are valuable if this ships |
| `js/lib/faq-data_old.js` | legacy/orphan | Superseded FAQ content |
| `js/geosonify-precision.js` | suspected duplicate | `index.html` loads only `js/lib/geosonify-precision.js`. Diff before deleting |
| `js/lib/chessboard-bundle.js`, `gates.js`, `precision-gates.js`, `js/lib/load-cardrenderer.js`, `spec/grid-passphrase-v1-reference.js` | test | Node-only test harness — see Testing |
| `spec/FROZEN-FORMAT-SPEC.md`, `b²s² bounding box shortcut scheme.pdf` | docs | Normative frozen-format spec; original 2012 scheme paper (linked from FAQ) |

## Architecture and Data Flow

**Dual architecture.** The app is mid-migration from a single-file monolith to IIFE modules. Modules publish globals (`window.GeoCodec`, `window.CardRenderer`, `HealpixGrids` as a bare top-level `const`, …). The legacy inline script consumes them through the alias bridge in inline script #1. `js/main.js` runs last and wires `AppState` to legacy globals in both directions (`setupEventBridges()`: `AppState.subscribe('coordinate', …)` calls legacy `updateCoordDisplay`/`updateMapPin`/`renderCards` if defined) [code: `js/main.js` ~lines 98–147]. **Consequence:** module code must tolerate legacy globals being undefined, and legacy code assumes the aliases exist.

**Startup** [code: `index.html`, `js/main.js`]: scripts load in the order tabulated above → legacy inline `DOMContentLoaded` handler (splash unless URL has params; `?display` viewer mode; random initial city from `randominitiallocations` when no params) → `Main.init()`: initState → initUI → event bridges → restore `geosonify-app-state` from localStorage → (URL parsing delegated to legacy) → debounced autosave of `{cards, encoding, audio.volume}`.

**Coordinate flow (the central invariant).** Any input (map tap, GPS, typed code, URL, scan) ends at `GeosonifyMain.setCoordinate(lat, lon, meta)`:
1. `AppState.set('coordinate', {lat, lon})` — the **lossy double view** every legacy consumer reads.
2. A `GeoPrecision` **ExactPoint** is built (from `meta.exactPoint` if the source was a code/scan, else `fromLatLon`) and stored as decimal strings in `AppState 'exact'` with provenance meta `{source, depth, uncertaintyMetres, basis}` [code: `js/main.js` ~lines 244–284; `js/core/app-state.js` lines 26–41].
3. Bridges fire → `renderCards()` re-encodes every visible card from the coordinate.

**Encode pipeline per card** [code: `js/ui/card-renderer.js` `_encodeCardCoordinateInternal`, ~lines 965–1080]:
1. **Presentation cards** (`chessOf`/`chromaOf` via `presentationOf()`) delegate wholesale to their sibling's encoder — chessboard/hpchessboard/HEALPix-ChromaCoord have **no encoder of their own**; the board/swatch is produced at render time.
2. `healpix:` cards route to `HealpixGrids.encode`, injecting the frozen `shuffleGridAndOrder` for passphrase and `obf:true` for obfuscation.
3. `gis:` cards route to `GISGrids.encode` — **no passphrase, no obfuscation, ever** (they are external standards).
4. Vocabulary grids: no passphrase → single shuffled grid + `GeoCodec.encodeHierarchical`; with passphrase → per-iteration re-shuffle where each level's permutation is keyed by the comma-joined chain of *flat indices chosen so far*. Obfuscation is applied **after** encoding using the layer-1 (empty-chain) flat grid. CJK grids then get delimiters inserted.

**URL share/decode flow**: legacy share code + `URLCodec` build `?{param}={code}[~shape][~deltas]` where the param key encodes grid + flags (`o` obfuscated, `d`/`d{n}` delta, `r` rhumb; e.g. `?oad5=`) [code: `js/lib/geosonify-url-codec_v1_1.js` `PARAM_GRID_MAP`, `parseParamKey`]. Optionally the whole query string is AES-encrypted into `?enc=` (inline script #1). Decode reverses: `?enc` prompts for passphrase; params are parsed by the legacy `parseURLParameters` path.

**Scan flow**: `js/ui/scanner-ui.js` modal → `RGB111Scanner` (from `geosonify-scanner-lib_v1_0.js`) ray-casts, corrects perspective (OpenCV lazy), classifies colours, validates CRC-8 notches → dispatches `chromacoord-decoded` → `main.js` listener → legacy `decodeChromaResult(hex)`. Data-Matrix scans read the leading **mode signifier** (see Constraints) to pick codec + obfuscation.

**Audio flow**: coordinate/GPS → `AudioService` note pool → Tone.js synthesis with per-octave pattern evolution → note event bus → `PianoRoll` (and future MIDI). `JourneyService.updatePosition` lerps presets between waypoints.

**Persistence** (all localStorage, all independent): `geosonify-app-state` (main.js autosave), `geosonify_card_state` (card-renderer), `geosonify_custom_grids` (custom grids), `showStartEndMarkers`, plus audio presets and journeys in their services.

## Key Data Structures and Formats

- **`CARD_GRIDS`** [code: `js/ui/card-renderer.js` line 54, exported line 6655]: the card registry. Entry shapes: vocabulary (`grid: 2D array`, `defaultIterations`, `maxIterations`, optional `delimiter`, `prefixLength` (BIP39 marker), `checksumDelimiter`, `display`, `deprecated`), HEALPix (`healpix: schemeKey`), GIS (`gis: schemeKey`), presentation (`chessOf`/`chromaOf`), fixed (`fixedIterations`, e.g. chromacoord=6), dynamic (`dynamicIterations`, qrurl). GIS/HEALPix/chess cards are registered at init by `registerGISCards`/`registerHealpixCards`/`registerChessboardCards` (~lines 578–700), not in the literal.
- **ExactPoint** [code: `js/lib/geosonify-precision.js`]: rational lat/lon at `DEFAULT_PRECISION = 120` significant digits; provenance meta. The doubles in `AppState.coordinate` are a *view*; codes are the *lossless carriers*.
- **Hierarchical code**: symbol sequence from recursive R×C subdivision; row 0 = north, bounds updated top-down [code: encode loop, `js/ui/card-renderer.js` ~lines 1030–1057]. Chain indices are comma-joined *flat* indices ("2,9" ≠ "29" — the comma is deliberate, line 1048).
- **Obfuscated code** (GeoCodec model): each non-final token's flat index shifted by distance-from-end mod N over a deterministic keyed shuffle seeded by SHA3-512 of `"0,1,…,N-1|lastIndexFlat"`; **final token unshifted** so the deepest cell stays addressable. Obfuscation destroys graceful truncation — documented trade-off [docs: `faq-data.js` ~lines 600–618].
- **Delta path wire format** [code: `js/core/delta-gear.js`]: `firstCode~d{K}{HEX_K}{payload}…`; DP-optimal gear selection. Safe because `~` never occurs inside codes.
- **Shape params** [code: `js/core/compact-codec.js`]: raw (`45deg_100m_50m`), base36 variable (unit-switch `!` markers), base64url fixed-width.
- **AES URL blob v1** [code: `index.html` ~744–830]: byte 0 version `0x01`; bytes 1–3 PBKDF2 iteration count 24-bit BE (currently 600 000, embedded so it can rise without breaking old links); bytes 4–19 salt; 20–31 IV; rest AES-256-GCM ciphertext; header bound as AAD; plaintext = 2-byte length + query string + random padding to a 32-byte multiple (length blurred to a band, not hidden); output `?enc=base64url`.
- **HEALPix codes** [code: `js/lib/geosonify-healpix.js`]: one BigInt NESTED index; `hpquad` = face + base-4 digits (self-describing depth), `hphex` = 2 levels/char, face folded into first nibble 0–B, `@k` order suffix **only when order is odd**; `hp64` = 3 levels/char, face as separate leading symbol. `MIN_ORDER=1`, `MAX_ORDER=73`, `PROJECTION_EXACT_ORDER=26` (deeper ingestion digits are contained-cell refinement, not measured information).
- **Data-Matrix mode signifiers** [code: `js/ui/card-renderer.js` ~lines 276–320]: one leading letter outside hex alphabet: `G` standard hex, `O` obfuscated, `H` HEALPix hex, `P` HEALPix obfuscated; **bare hex with no signifier = standard Geosonify hex** (backward compat). Future families take unused G–Z letters.
- **BIP39 checksum**: CRC32C of the comma-joined *base-grid flat index string* (vocabulary-agnostic, so English and Spanish encodings of one place share a checksum) mod 1000, 3 digits [code: `codeToIndexString`, `computeChecksumNumeric`, ~lines 380–427].

## External Dependencies and Integration Points

- **CDN at load**: js-sha3 0.9.2 (`sha3_512` used by the frozen shuffle), VexFlow 4.2.3, Leaflet, geographiclib-geodesic (Karney; GeoCodec falls back to robust Vincenty if absent).
- **CDN lazy** (via `LazyLoad` / `BarcodeLib`): Tone.js 14.8.49, OpenCV.js 4.x, qrcode-generator 1.4.4, jsQR, bwip-js.
- **Web services**: Nominatim geocoding, Overpass API, Wikidata SPARQL (shape import); cadastral providers registry (NZ LINZ, AU state ArcGIS layers, FR IGN API Carto, NL PDOK, US MassGIS/NC, …) [code: `js/features/property-import.js`]. **Hard rule baked into the registry: every provider is keyless or free-key with no billing possible.**
- **Vendored in-repo**: decimal.js (`js/lib/decimal.min.js`), @hscmap/healpix core (bottom of `geosonify-healpix.js`) — don't over-interpret or reformat either.
- **Hosting**: static (GitHub Pages implied by `CNAME`). No API of its own; the URL query grammar *is* the external interface.

## Key Constraints and Invariants

1. **FROZEN: grid-passphrase v1 derivation** [code: `js/ui/card-renderer.js` `shuffleGridAndOrder` + `GRID_V1_PREFIX`, lines 869–928; oracle: `spec/grid-passphrase-v1-reference.js`; spec: `spec/FROZEN-FORMAT-SPEC.md`]. Immutable, permanently: prefix string `'geosonify-grid-pass-v1|'` (exact spelling/case/hyphens/trailing pipe), NFC normalisation of the passphrase, the `'|chain:'` join (present even for the empty first chain), comma-joined decimal chain indices, SHA3-512, little-endian u32 per-cell index appended to the preimage, lexicographic byte sort with original-index tie-break, and the base grids in `geosonify-grids-data.js`. **Why**: a bare code carries no version field; a wrong derivation doesn't error — it silently decodes to a different plausible location, possibly decades from now. Strengthen privacy via AES URL mode (self-versioned) instead — never by mutating this.
2. **FROZEN: geosonify-healpix-pass-v1** [code: `js/lib/geosonify-healpix.js` ~lines 287–380]: face permuted as a 1×12 grid (chain `''`), each level as 1×4 with chain = comma-joined **TRUE** indices chosen so far; obfuscation shifts each token by distance-from-end mod its own alphabet size (12 then 4s), final token unshifted; pipeline order permute-then-obfuscate, decode reverses. Same silent-wrong-location failure mode as #1.
3. **FROZEN: GeoCodec obfuscation derivation** [code: `js/lib/geosonify-codec-engine_v11_8a.js` `buildIndexSeedString`/`generateStrongSeedFromIndices`/`generateShuffleOrderFromHash`]: seed string format, SHA3-512, hash-extension loop, chunked-hex sort. Codes in the wild depend on it.
4. **Base grids are format, not data** [code: `js/lib/geosonify-grids-data.js`; docs: `faq-data.js` line 714]: cell contents *and their row/column positions* define what every published code means. Adding a new grid array is fine; reordering or editing an existing one breaks all existing codes for that card.
5. **URL parameter grammar is a public contract** [code: `js/lib/geosonify-url-codec_v1_1.js` `PARAM_GRID_MAP` + `parseParamKey`]: single-letter grid keys, `o`/`d{n}`/`r` flag suffixes, `~` separators, delta-gear headers, shape-param encodings, `?enc=` blob layout, `?display` options. Only add params; never repurpose.
6. **Graceful truncation** must hold for all hierarchical (non-obfuscated) codes: dropping trailing characters must widen the cell, never move it. Obfuscated codes intentionally sacrifice this (final char must survive) [docs: `faq-data.js` 600–618].
7. **GIS cards never get passphrase/obfuscation** (`gis` flag gates it) — they must remain byte-compatible with external standards [code: `card-renderer.js` ~line 986 comment; registerGISCards].
8. **Presentation cards have no encoder**: chessboard, hpchessboard, hpmatrix, HEALPix ChromaCoord delegate through `presentationOf()`/`healpix:'hphex'`. Adding logic to a presentation card's "encode" path is a category error. Note the standard ChromaCoord is **not** a presentation — it's a real hexByte encoder [code: comment at ~line 949].
9. **Refused, not truncated**: `ChessboardLib` rejects payloads exceeding board capacity (23 hex); card iteration caps (chessboard 11, hpchessboard 44, hpmatrix 46) are set exactly at guaranteed-fit ceilings so refusal is only a backstop [code: `registerChessboardCards` comments; verified 20k samples/length per comment].
10. **Exact point is the source of truth**; `AppState.coordinate` doubles are a lossy view. Precision consumers (distance, cross-scheme conversion, deep classification) must read the exact point (`GeosonifyMain.getExact()`), never round-trip through the double [code: `geosonify-precision.js` header; `main.js` `getExact` docstring]. Provenance rule: cards never manufacture precision beyond the source — deeper digits are contained-cell refinement.
11. **Decimal working precision = 120 sig digits** (order-73 HEALPix needs ~50+ of π/trig; headroom for femtometre scales) [code: `geosonify-precision.js` line 53].
12. **HEALPix order caps**: UI/codec 1..73; projection bit-exact only to order 26; address layer (BigInt) exact at every order. Don't "fix" the 73 cap down to 25/26 — the address layer is deliberately deeper than double-precision ingestion [code: `geosonify-healpix.js` lines 52–71].
13. **NFC normalisation of passphrases** in both the grid shuffle and AES KDF — visually identical passphrases must derive identically across OSes [code: card-renderer line ~892; index.html `deriveEncryptionKey`].
14. **Security honesty**: the passphrase permutation is bespoke, not cryptanalysed; anything needing real confidentiality must use AES mode. Don't market it otherwise [docs: `faq-data.js` line 654].
15. **`~` never appears inside codes** — it is the shape/delta separator; delta-gear parsing relies on it [code: `delta-gear.js`, `geosonify-healpix-path.js` header].
16. **HUMAN preset is a fixed hand-tuned table, not derived** (BIP39 always 4 words as the human-communication unit; ChromaCoord never touched) [code: `HUMAN_PRESETS` ~line 1633].

## Non-Obvious Decisions and Load-Bearing Quirks

- **`scanner-service.js` is deliberately disabled.** The commented-out script tag in `index.html` says it "overwrites RGB111Scanner with broken implementation" — because its last line is `global.RGB111Scanner = ScannerService`. The working scanner is `geosonify-scanner-lib_v1_0.js`, *despite* v2 files existing. Versioned filenames are **not** a reliable liveness signal in this repo; the script tags are. [code]
- **`tokenizeCode` shim in url-codec** [code: `geosonify-url-codec_v1_1.js` lines 29–39]: the module calls `tokenizeCode(code, grid2D)` everywhere, but `GeoCodec.tokenizeCode` takes a flat array. The local wrapper flattens and delegates; *"Without it the module throws ReferenceError at load."* Looks redundant; is load-bearing.
- **`HealpixGrids` is a bare top-level `const`**, so it is NOT `window.HealpixGrids`. `geosonify-precision.js` resolves it via a TDZ-safe bare-identifier probe [code: lines 30–39]. Similarly `load-cardrenderer.js` must concatenate all deps into ONE `vm` script because separate `runInContext` calls don't share top-level `const` bindings. Converting these `const X = (…)()` modules to `window.X =` would ripple; do it everywhere or nowhere.
- **Chain indices are comma-joined specifically to avoid `2+9 == 29` collisions** [code: card-renderer line 1048 comment]. The chain is *flat indices*, making it grid-vocabulary-independent — which is also why cross-language BIP39 checksums agree.
- **Obfuscation of passphrase-chained codes uses the layer-1 (empty-chain) shuffle** "for consistency" [code: ~line 1060] — an implicit encode↔decode contract nothing type-checks.
- **hphex `@k` suffix appears only for odd orders** — even orders are length-self-describing; odd ones are ambiguous after hex packing. hpmatrix caps at 46 because the Data-Matrix symbol silently stops growing beyond 24 hex chars — deeper clicks would imply precision the symbol can't carry [code: registerHealpixCards comments].
- **HEALPix ChromaCoord decode is never redacted** — the hex must transform properly (permute + obfuscate) [code: card-renderer line 2797 comment]; treat any "shortcut" here as a bug.
- **Chess codec bishop fix**: "session 8 bishop fix restored the bishop layer's entropy: maxHex 19→23" [code: registerChessboardCards comment] — the per-card caps (11 / 44) were re-derived from that; changing ChessboardLib capacity requires re-deriving both caps with the 20k-sample verification.
- **Chess codec is original work, not Tromp's** — comment in both chess files pre-empts the assumption; it ranks one curated fixed-material *visible-board* family, boards are never in check by construction [code: headers].
- **Random landing city list** (`randominitiallocations`, inline script #2 ~line 1502) fires only when the URL has no params; URL-bearing loads skip splash and random location — intentional, not a race.
- **`?display` viewer mode** renders a bare embed map (opt-in `&gps &area &export= &zoom= &context= &fixzoom`) [code: inline script #2 ~lines 1525–1545] — an embed contract external pages may rely on.
- **`import-accuracy.js` deliberately has no encoder knowledge** — callers inject the real encode→decode round-trip so reported loss is the app's actual loss, never a reimplementation's [code: header].
- **`gates.js` requires `/home/claude/build/chessboard-bundle.js`** — a hardcoded absolute path from a dev machine. The bundle also exists at `js/lib/chessboard-bundle.js`; adjust the require path before running. [code: `gates.js` line 5]
- **FAQ is code**: `js/lib/faq-data.js` embeds the user-facing specification (obfuscation trade-offs, frozen-format promise, BIP39 math, security honesty). When behaviour changes, this file is part of the change. It has CRLF line endings and a translation mechanism in its header.
- **Legacy alias bridge**: dozens of `const R = GeoMath.R;`-style aliases (inline script #1) exist solely so the monolith could keep its bare names after extraction. Deleting an "unused-looking" alias breaks the inline script at a distance.

## Common Edit Patterns

| Task | Files/functions | Safe approach | Checks | Gotchas |
|---|---|---|---|---|
| Add a new vocabulary card | `js/lib/geosonify-grids-data.js` (new array), `js/ui/card-renderer.js` (`CARD_GRIDS` entry, `initGridsFromGlobals` name map ~line 511, `HUMAN_PRESETS`), `js/lib/geosonify-url-codec_v1_1.js` (`PARAM_GRID_MAP` if URL-shareable), FAQ | New array + new key only; pick an unused single-letter param | Encode/decode round-trip at several iterations, with and without passphrase/obfuscation; truncation check | Never touch existing arrays (constraint 4); rows must be equal length; symbols must tokenize unambiguously (`GeoCodec.tokenizeCode` is greedy longest-match) |
| Change card UI/rendering | `js/ui/card-renderer.js` render paths, `css/geosonify-styles.css` | Keep encode/decode functions untouched; presentation cards render from sibling hex | Visual check of all display types (`chroma`, `music`, `qrhex`, `datamatrix`, `chessboard`, emoji) | The file also hosts the frozen shuffle — stay out of lines 869–1080 unless certain |
| Add a GIS scheme | `js/lib/gis-grids.js` (SCHEMES + `cardDefs`), `registerGISCards` order list in card-renderer | Encoder AND decoder required ("every encoder has a decoder"); self-contained projection math, no proj4 | Round-trip vs EPSG ground-truth points; `precision-gates` ladder | Never enable passphrase/obfuscation for it (constraint 7) |
| Extend URL params | `js/lib/geosonify-url-codec_v1_1.js`, legacy `parseURLParameters` in inline script #2 | Additive only; new keys must survive `parseParamKey`'s longest-base matching | Old production URLs still decode; new URL round-trips | Flag-suffix grammar means a new 2-letter base can shadow `{base}{flag}` parses — test collisions |
| Modify audio behaviour | `js/services/audio-service.js`, `js/ui/audio-ui.js`, `js/ui/piano-roll.js` | Use the note event bus; keep header changelog convention | Play/stop, drone mode, journey lerp, piano-roll sync | Tone.js is lazy — everything must tolerate `Tone === null` pre-init |
| Change iteration caps/defaults | `CARD_GRIDS` entries, `HUMAN_PRESETS` | Respect derivation comments (chess 11/44, hpmatrix 46 are capacity-derived, not taste) | `node precision-gates.js` (after fixing paths); manual +/- stepping at cap | Raising a chess/matrix cap past capacity ⇒ refusal or frozen barcode |
| Update FAQ / docs | `js/lib/faq-data.js` | Edit HTML strings; keep `GEOSONIFY_FAQ` shape and ids (deep-linking) | Render the FAQ tab | CRLF endings; `faq-data_old.js` is dead — don't edit it by mistake |
| Add shape-import provider | `js/features/property-import.js` registry | Fit one of the four provider types; obey the cost-safety rule (keyless/free only) | Live query against provider | Coordinates must be normalised to WGS84 before `processLoadedShape` |
| Anything touching passphrase/obfuscation/AES/base grids | — | **Don't change derivations. Add a new versioned format instead**, and keep v1 decode forever | Reproduce `spec/grid-passphrase-v1-reference.js` self-test vectors; cross-check `FROZEN-FORMAT-SPEC.md` | Failure is silent wrong locations, possibly years later |

## Testing and Validation

- **Node gate suites** (invariant tests, run manually — no CI config in the tree):
  - `gates.js` — 9 chessboard-codec gates: packing bijection (leading zeros significant), round-trips, FEN/ASCII, doctored-board rejection, no-frozen-square invariance (gate 9). **Requires fixing the hardcoded `require('/home/claude/build/chessboard-bundle.js')` to `./js/lib/chessboard-bundle.js` first.** [code]
  - `precision-gates.js` — 7 precision-control gates run against the **real** `card-renderer.js` via the `js/lib/load-cardrenderer.js` vm shim (stubbed DOM/localStorage; deps concatenated into one script for shared top-level consts). [code]
  - `spec/grid-passphrase-v1-reference.js` — self-testing frozen-vector oracle for the keyed permutation (`node spec/grid-passphrase-v1-reference.js` prints PASS/FAIL). [code]
- **Coverage gaps** [inferred]: no automated tests for the URL codec, delta-gear, AES round-trip, GIS projections (header claims EPSG verification was done, but no committed harness), audio, scanner, or the legacy inline script. UI is manual-test only. Comments cite one-off verifications ("20k samples/length", "verified against live production URLs") whose harnesses are not in the repo.
- **Manual validation that matters**: decode an old production URL of each shape type; encode→scan a ChromaCoord and Data Matrix; passphrase round-trip on a vocabulary card, hphex, and chessboard; truncation behaviour with and without obfuscation.

## Ambiguities, Debt, and Risk Areas

| What / where | Why it matters | Blocks work? | Verify before changing |
|---|---|---|---|
| ~8.5k-line legacy inline script in `index.html` (lines ~1501–10008) | Owns URL parsing, share, shapes, GPX, delta paths; global-scope coupling via alias bridge; hardest place to edit safely | Debt; slows every URL/shape change | Grep for a global's name across `index.html` AND all `js/` before renaming anything |
| Orphan/duplicate versioned libs (`geo-core_v11_8o`, scanner v2 ×2 filename variants, `scan-ui`, `faq-data_old`, root `geosonify-precision.js`) | Editors reliably pick the wrong file — the *newest-looking* scanner is dead | Debt + active mistake trap | The `index.html` script tags are the only liveness authority |
| `scanner-service.js` present-but-disabled with a global-name collision | Re-enabling it silently breaks scanning | Trap | Read the removal comment at `index.html` ~line 631 |
| `geosonify-healpix-path.js` designed-but-unwired | Its header claims production-verified wire design, yet nothing loads it — unclear whether shipped elsewhere or shelved | Unclear | Search deployed site / history before implementing HEALPix paths from scratch |
| `main.js parseURL()` is a stub | The "new architecture" never took over URL parsing; state restore vs URL params ordering is handled by legacy conventions | Debt | Trace `parseURLParameters` in inline script #2 before touching startup order |
| `spec/FROZEN-FORMAT-SPEC.md` unread this run | It is the normative spec for constraints 1–4; this guide reconstructs them from code comments | Read it before frozen-adjacent work | — |
| `gates.js` hardcoded require path; `HANDOVER-precision-control.md` missing | Test suites bit-rot silently | Minor | Fix path; treat `precision-gates.js` as the surviving spec |
| Multiple independent localStorage keys | Partial-state restores after schema changes | Debt | Bump/migrate keys deliberately |
| External free cadastral/geo services | Endpoints in `property-import.js`/`shape-import.js` can change or rate-limit without notice | Runtime risk only | — |
| Pinned CDN versions (VexFlow 4.2.3, Tone 14.8.49, js-sha3 0.9.2) | js-sha3 in particular participates in a frozen format; upgrades must be output-identical | Caution | Diff hash outputs against `spec/grid-passphrase-v1-reference.js` vectors |

## Quick Reference for Future Editors

- **Liveness authority**: the `<script>` tags in `index.html` (lines ~607–656, 10009). Versioned filenames lie; the live scanner is `_v1_0`.
- **Never change, ever**: `shuffleGridAndOrder` + `GRID_V1_PREFIX` (`js/ui/card-renderer.js` 869–928), the healpix-pass-v1 block (`js/lib/geosonify-healpix.js` 287–380), GeoCodec's obfuscation seed derivation, the AES v1 blob layout, existing arrays in `js/lib/geosonify-grids-data.js`, existing URL param meanings. New behaviour = new versioned format; old decode support is forever.
- **Coordinate truth**: `GeosonifyMain.getExact()` (lossless) for math; `getCoordinate()` (doubles) for display only.
- **Card taxonomy**: vocabulary (`grid`), HEALPix (`healpix`), GIS (`gis`, no privacy features), presentation (`chessOf`/`chromaOf`, no encoder), fixed (`fixedIterations`), dynamic (`dynamicIterations`).
- **Encode dispatch lives in** `_encodeCardCoordinateInternal` / `decodeCardCoordinate` (`js/ui/card-renderer.js` ~965–1110). URL grammar lives in `js/lib/geosonify-url-codec_v1_1.js` + legacy `parseURLParameters`.
- **Run the tests**: `node spec/grid-passphrase-v1-reference.js`; `node precision-gates.js`; `node gates.js` (fix its require path first).
- **When something "looks removable"** — the url-codec `tokenizeCode` shim, the alias bridge consts, the comma in chain indices, the `@k`-only-when-odd rule, the disabled scanner-service tag — it is documented above as load-bearing. Check here first.
- **The failure mode this codebase fears most**: a silently different permutation/derivation that decodes old codes to *plausible wrong locations*. Any change near hashing, sorting, normalisation, prefixes, or grid contents must reproduce the frozen test vectors byte-for-byte.
