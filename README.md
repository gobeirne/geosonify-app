# Geosonify

**One location, many languages.** Geosonify separates *where a place is* from *how you write it down*. The same point on Earth can be expressed as letters and numbers, words and phrases, blocks of colour, musical notation, emoji, QR codes, or a vocabulary you invent yourself. The geography stays fixed. Only the representation changes.

🌍 **Live app: [geosonify.org](https://geosonify.org)**

Everything runs in your browser. There is no server lookup and no account, so your coordinates never leave your device unless you choose to share the resulting code.

## What it does

Most location systems give you one way to describe a place. Geosonify gives you many, all describing the same geography:

- **Alphanumeric** coordinates, on a compact 6×6 grid
- **Words and phrases**, from BIP39 word lists in ten languages
- **Blocks of colour** (ChromaCoord)
- **Musical notation** you can actually play
- **Emoji**
- **QR codes and Data Matrix** symbols
- **HEALPix** equal-area sphere codes, in hex, quaternary, or base64
- **Standard GIS grids**: Plus Codes, MGRS, Geohash, UTM, and several national grids
- **Chessboards**, where a coordinate becomes a legal-looking board position
- **Custom vocabularies** you define yourself

Drop a pin, type coordinates, take a GPS fix, or paste a code, and every vocabulary encodes it at once.

## The core idea: hierarchical codes that truncate gracefully

Every Geosonify coordinate is hierarchical. The first character identifies a broad region, and each character after it narrows things further. That gives the codes a property worth dwelling on:

> Remove characters from the right and you don't get the *wrong* location. You get the *same* location at lower precision.

`thp9dahrg` and `thp9dah` describe the same point. The shorter code is just the larger enclosing cell. Truncating never moves the location, it only enlarges the cell. Because of this, codes are strict prefixes of one another, nearby places share common prefixes, and the encoding is deterministic and entirely client-side: the same coordinate always produces the same code for a given grid, with no randomness and no lookup.

The grid doesn't have to be 6×6. The same recursive subdivision works for any dimension, and Geosonify uses different grids for different vocabularies: 6×6 (36 cells) for alphanumeric, 28×28 (784 cells) for emoji, 45×45 (2025 cells) for the BIP39 word lists. Each character adds log₂(grid size) bits of precision.

### How it compares

Plus Codes, Geohash, and OS grid references are hierarchical too. Where Geosonify differs is in what the hierarchy is made of. A Plus Code expresses its hierarchy through a fixed alphanumeric code. Geosonify lets the same hierarchical coordinate be expressed as letters, words, colours, music, QR codes, emoji, or a custom vocabulary, so you can use words for radio, colour for a printed tag, and music for a journey while the underlying geography stays identical.

## Features

### Words built for speech

The word vocabularies are arranged into a 45x45 grid, using lists derived from BIP39 lists with confusable words removed. The coordinates stay hierarchical, so nearby places share prefixes and are easier to recognise, remember, and read aloud. Available in English, Spanish, French, Italian, Portuguese, Czech, Japanese, Korean, Simplified Chinese, and Traditional Chinese.

### Precision modes

A Precision control sits beside the encoding controls and rotates through three modes:

- **Match** keeps exactly the precision your measurement carries, and no more code than that needs. Each grid comes in discrete steps, so Match picks the coarsest step whose cell still holds your measurement. It never goes coarser than the source, which would throw away precision you have, and never needlessly finer. A pin from a GPS fix good to about 3 m settles near 3 m. Refine the fix and the codes follow it down.
- **Human** uses fixed presets per card, roughly arms-width, a metre or two, independent of the measurement. Word cards always land on four words, which is the friendly unit for saying a place out loud.
- **Custom** gives each card its own +/− stepper, so you set the level yourself.

A live readout shows your current measurement uncertainty and where it came from (`map pin @ z21`, `device fix`, `decoded code`, `typed, 6 dp`, and so on). Tap the value to switch between metric and US units everywhere at once.

### Standard GIS grids, side by side

Plus Codes (OLC), MGRS, Geohash, and UTM all work anywhere. National grids appear where they apply: NZTM2000 in New Zealand, OS grid references in Great Britain, MGA2020 in Australia. A Local Grid card picks whichever national grid fits your current location and falls back to UTM elsewhere. The projections are computed in the app and match the official EPSG definitions to the centimetre. Each card's ℹ️ button shows its cell size at every level next to your active Geosonify card, so you can compare them directly.

### HEALPix with no depth ceiling

Geosonify implements the standard HEALPix NESTED scheme, in which the sphere is split into 12 equal-area base cells and each cell is recursively quartered. Reference libraries stop near order 29 because they pack the cell index into a 64-bit integer. That is a storage limit, not a property of the tessellation. Geosonify carries the whole address layer in arbitrary-precision BigInt, so it can represent a cell as finely as you like, down to nanometre and femtometre scales, exactly. The construction is verified bit-identical to the reference implementation (healpy) at every shared order.

### Sonification

Geographic movement becomes music. A musical grid built specifically for this maps each character of a code to a pitch, so a full code becomes a chord across several octaves. Stand still and you hear a sustained harmony. Travel and the upper voices move into a melodic line over a slowly shifting foundation. The same hierarchy that makes nearby places share prefixes makes nearby places sound similar.

### Shapes, routes, and compression

Points are only the start. You can also encode rectangles, circles, paths, polygons, and graticules. A rectangle reduces to a centroid plus three numbers: its orientation, length, and width. Those three numbers can be written as readable text, as two compact code styles, or as emoji, and all four spellings describe the identical rectangle. The prefix-sharing structure also drives delta compression across multi-point routes.

### Obfuscation, passphrases, and encryption

Geosonify has three separate privacy layers, and each one does a different job.

**Obfuscation** is a reversible visual scramble that hides a code's tell-tale hierarchical pattern (`thp9dahrg` becomes `hw8n0s8wg`). No key is involved, so anyone with the app can reverse it. It is camouflage rather than security, and the app says so plainly.

**Passphrase mode** turns the code into a keyed coordinate language. Add a passphrase and the symbol-to-cell mapping depends on it, so the same nine characters name a different point on Earth for every passphrase. People who share the passphrase decode to the intended spot. Everyone else decodes to somewhere else entirely, and the result still looks like an ordinary valid coordinate, so there is nothing to flag it as protected. This lets a group publish locations openly while keeping their meaning to themselves, which suits geocaching groups, treasure hunts, and field survey crews. It is deliberately simple, built from a Unicode-normalised passphrase and chained SHA3-512 permutations, not an encryption scheme: it protects the coordinate value, but a strong passphrase is the whole of its security, and it does not hide metadata such as a code's length or grid.

**AES URL encryption** is the real thing when you need it. A share link can be wrapped with a passphrase using AES-256-GCM, with the key derived through PBKDF2 (HMAC-SHA-256, 600,000 iterations, a fresh random salt per link). This hides everything: the coordinates, the grid type, the number of waypoints, and the path length, so an observer cannot even tell what kind of thing is being shared. A wrong passphrase fails the authentication tag cleanly rather than producing plausible-looking garbage.

All three run entirely in your browser, and the code that does the work is unminified and readable in the page source.

### Custom grids

The framework is open. Define your own vocabulary and the same recursive subdivision applies to it.

## Running it

Visit **[geosonify.org](https://geosonify.org)**. It is a static client-side web app, with nothing to install.

To run it locally, serve the repository root with any static file server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

There is no build step. The in-app FAQ explains every feature in detail.

## Project status and contributing

Geosonify is an open framework with public rules and free tools. Researchers, artists, educators, emergency responders, surveyors, geocachers, and developers are welcome to build new vocabularies and find new uses for it. Issues and pull requests are welcome. The most interesting use of Geosonify may be something nobody has thought of yet.

## Licence

© 2012–2026 Greg O'Beirne. Licensed under the **[Mozilla Public License 2.0](LICENSE.txt)**.

## Credits and attribution

Geosonify builds on a lot of open work:

- **Map data**: © OpenStreetMap contributors (ODbL); tiles from OpenStreetMap
- **Geocoding**: Nominatim (OpenStreetMap Foundation)
- **Boundaries**: Overpass API and Wikidata SPARQL
- **Property parcels**: LINZ Data Service (CC BY 4.0), Kadaster via PDOK, IGN API Carto / DGFiP (Licence Ouverte), NSW Spatial Services (CC BY 3.0 AU), MassGIS, NC OneMap
- **Map library**: [Leaflet](https://leafletjs.com/) (BSD-2-Clause)
- **Geodesic maths**: GeographicLib by Charles Karney (MIT)
- **Music notation**: [VexFlow](https://www.vexflow.com/) (MIT)
- **SHA3-512**: js-sha3 by Yi-Cyuan Chen
- **Palette**: Kererū by Geoffrey Thomson
- **BIP39 word lists**: from the BIP-39 specification
- **German (DE-2048) word list**: [dys2p/wordlists-de](https://github.com/dys2p/wordlists-de) by dys2p (Unlicense / CC0 / BSD-3)
- **NATO phonetic alphabet**: per ICAO Annex 10

*Created and developed by Greg O'Beirne, 2012–2026.*
