# Geosonify · Chessboard explained

A standalone, responsive and reversible walkthrough of the **existing** Geosonify Chessboard and HEALPix · Chessboard encoders. It is an *additive patch*: no existing Geosonify file needs to be replaced or modified.

## Install in `gobeirne/geosonify-app`

Copy the folders/files from this package **into the repository root**, preserving their paths:

```
chessboard-explainer.html
css/chessboard-explainer.css
js/chessboard-explainer.js
js/lib/chessboard-explainer-trace.js
spec/chessboard-explainer-smoke.test.js
```

The HTML loads `js/lib/geosonify-chessboard-lib_v1_0.js` from your **existing repository**. That original source is **not included or changed** here; the page will not work if you open the HTML outside the Geosonify directory without that dependency.

From the repo root, serve the site normally, or for a local preview run:

```sh
python3 -m http.server 8000
```

Then visit:

`http://localhost:8000/chessboard-explainer.html?mode=healpix&code=95625281C9B5`

Standard HexByte example:

`http://localhost:8000/chessboard-explainer.html?mode=standard&code=BFDAEB6AA077`

**Optional FAQ link** (place it alongside the written Chessboard explanation in your existing FAQ):

```html
<a href="/chessboard-explainer.html?mode=healpix&amp;code=95625281C9B5">
  Watch a HEALPix address become a chessboard, step by step →
</a>
```

## Test

From the **Geosonify repository root** after copying these files:

```sh
node spec/chessboard-explainer-smoke.test.js
```

This exercises both published office FENs, source encoder-versus-trace comparison, the reverse decoding check, leading-zero preservation, and input failure paths. **The tests are provided but were not run against the original library in this delivery environment** because the container could not download GitHub source. JavaScript syntax and the visual page shell were checked locally. Run this test before publishing.

## What it shows

- The exact hex length-offset packing and reversible modular whitening, using real BigInt numbers.
- Pawns: eight file decisions, h through a, with *actual source-computed subtree counts* for all 14 candidate pairs.
- Bishops: one light and one dark square per side, with conditioned exact continuation counts.
- Queen/rook/knight multiset unranking, including optional empty-square choices and the two reserved trailing squares of the **present implemented encoder**.
- Canonically selected safe king pair, with unsafe and excluded candidates highlighted.
- Reverse rank, inverse whitening, restored hex, source FEN, and a verified 64-square `scan` round-trip.
- Play/pause, step/chapters/timeline, adjustable speed, keyboard arrows/space, reduced-motion support, responsive layout, shareable URL, FEN copying and link to the actual Geosonify card.

## Design and compatibility decisions

- The original `ChessboardLib` remains the authority: its `_rankPawns`, `_rankBishops`, `_remainingBishopPlacements`, `decode`, and `scan` are invoked from the trace, not replaced by a second codec.
- The two methods used for instrumentation on the cached, per-mode codec instance are restored with `finally`; fresh array snapshots are recorded for each display step.
- The trace refuses to present a result unless the calculated full board **exactly matches** `ChessboardLib.toBoard`, the FEN agrees, the decoded rank and payload agree, and the official scanner accepts the board.
- Existing FEN links and production encoding are unchanged.
- The current source has some inherited comments that predate the kings-out-of-rank approach. The explanation follows the **executed source**, notably the `free.length - 2` multiset allocation with two unranked trailing squares. A discrepancy throws a visible error rather than showing a misleading trace.
- The existing codec source specifies a ~78-bit capacity and guaranteed 19 hex digits, which differ from the FAQ's current ~96-bit/23-digit claim. Consider reconciling the public FAQ separately; this package does **not** change that text or the codec.

## License

MPL-2.0, like the rest of Geosonify. New standalone visual and tracing modules are intended for integration into the Geosonify source repository.
