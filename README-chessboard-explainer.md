# Chessboard explainer

`chessboard-explainer.html` walks through how the Chessboard and HEALPix · Chessboard cards turn a hex code into a board and back, one decision at a time, using the live codec. The FAQ's Chessboard answer links to it.

## Files

```
chessboard-explainer.html               the page
css/chessboard-explainer.css            styles (app tokens, light and dark)
js/chessboard-explainer.js              playback UI
js/lib/chessboard-explainer-trace.js    records the codec's own counts and replays them
spec/chessboard-explainer-smoke.test.js Node test against the live codec
```

The page loads the same `js/lib/geosonify-chessboard-lib_v1_0.js` that `index.html` loads and does not modify it. The tracer temporarily wraps `_rankPawns`, `_rankBishops` and `_pawnSubtreeSizes` on the cached codec while one encode runs, restores them in `finally`, and refuses to show a walkthrough unless the replayed board equals the codec's board, decodes to the same rank and payload, matches `toFEN`, and passes `scan`.

## What a reader sees

- **Guided** (default, 16 steps): files h and g in full, then f–a as one step; one bishop, then the other three; one material square, then the rest; the kings; the read-back; the proof. A grouped step lists every fork inside it with the rank entering and leaving.
- **Every decision** (`?view=full`): all 35 decisions one at a time, or all 67 with empty squares included.
- **How the rank moves**: a panel under the board that follows the one integer through every step (incoming rank, earlier branches skipped, the range it falls in, the rank passed on). Numbers are shortened to 1.1357 × 10²⁹ until “Show all digits”. It replaces the four-paragraph walkthrough that used to repeat on every step.
- **Where the code came from**: the first step names the place, decoded with the app's own `HealpixGrids` or `GeoCodec` and frozen `hexByteArray` (loaded at the same versions as `index.html`), with a link to it on the map. For a typed code it says “read as a plain code”, since a passphrase or obfuscation puts the same digits elsewhere; the board never depends on which.
- **The place** (step 1): the board's slot shows a map instead, opening five zoom levels out and stepping in one level at a time, with a short pause at each for its tiles (tiles load only when the map is still: six even sets, not a reload at every fraction of a level). The outlines are added on arrival; any press on the map stops the zoom where it is and draws them at once, outlined in red inside its fading parent cells, like the app's own grid overlay. Rings come from `HealpixGrids.cellCorners` (the true curved cell edge) or from walking the HexByte digits with `GeoCodec.boundsForCell`, the decoder's own path, and are moved to the copy of the world nearest the point (the order-1 HEALPix ring comes back 360° west). Map and Aerial use the app's tile sources. Leaflet loads from the same unversioned unpkg URL as `index.html`; if it fails, or the code is not a plain code, step 1 shows the board as before.
- “The exact numbers” starts closed and stays as the reader leaves it.

Grouping is presentation only: both views read the same verified trace, and the tracer's checks are unchanged (only the wording of its “two squares left unranked” step changed).

## Look

Styled to sit inside the app: the teal tab bar, the system font stack, `.card` / `.card-header` / segmented control / button shapes and the iOS grey tokens from `css/geosonify-styles.css`, the FAQ sub-tab look for the chapter strip, and the card's own board colours and glyph styling (`.gschess-*`). Dark mode follows the system, as the app does. No web fonts. The stylesheet copies tokens rather than importing `geosonify-styles.css`, because that file's map-shell layout rules (fixed heights at ≥1024px, tab-bar padding) would fight a long page.

The step controls and the rank panel sit under the board, which stays in view on wide screens; below 900px the controls become a fixed bottom bar. In dark mode the segmented controls and grey buttons use iOS dark fills, because the app's own `#1C1C1E` track and pill vanish on a `#1C1C1E` card (worth fixing in `geosonify-styles.css` too).

## Test

```sh
node spec/chessboard-explainer-smoke.test.js
```

Checks both FAQ example boards, rank hand-off between every decision, the decode and scan round trip, leading zeros (`96E`, `096E`, `0096E` … give nine distinct boards), and refusal of non-hex and over-capacity input.

## Capacity

The family holds 96 bits: up to 23 hex digits, as the FAQ and ARCHITECTURE.md say. The header comment of `geosonify-chessboard-lib_v1_0.js` still says "78-bit capacity; guaranteed max 19 hex", which predates the session-8 bishop fix and is stale.

## Linking

`chessboard-explainer.html?mode=healpix&code=95625281C9B5` (or `mode=standard`, and `&view=full`). `mode`, `code` and `view` belong to this page only; they are not part of the app's URL grammar. The page links out with existing app parameters only (`?hphex=`, `?h=`, `?hpfen=`, `?fen=`).

MPL-2.0, like the rest of Geosonify.
