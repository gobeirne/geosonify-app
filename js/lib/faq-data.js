/*
  faq-data.js  -  js/lib/faq-data.js
  Geosonify FAQ content - translatable data file.

  To translate: copy this file, change GEOSONIFY_FAQ.lang,
  replace all 'q' and 'a' strings, keep the structure identical.
  Load your translated file INSTEAD of this one (not in addition to).

  Structure:
    GEOSONIFY_FAQ = {
      lang: string,           // BCP-47 language tag e.g. 'en', 'fr', 'es'
      sections: [
        {
          id: string,         // unique kebab-case, used as DOM anchor
          title: string,      // section heading
          items: [
            {
              id: string,     // unique kebab-case, used as DOM anchor
              q: string,      // question (plain text)
              a: string,      // answer (HTML allowed)
            }, ...
          ]
        }, ...
      ],
      examples: [
        {
          category: string,
          items: [
            { label: string, href: string, code: string }, ...
          ]
        }, ...
      ],
      credits: {
        lines: [ string, ... ]  // HTML allowed
      }
    }
*/

(function(global) {
  'use strict';

  global.GEOSONIFY_FAQ = {
    lang: 'en',

    sections: [

      // ================================================================
      // The reader sees the plain-language FAQ. Every place where the old
      // version carried precise technical detail, that detail is preserved
      // verbatim inside a collapsible <details> block ("The details are
      // here"), hidden from casual readers but one tap away for the curious.
      // ================================================================

      {
        id: 'about',
        title: 'About Geosonify',
        items: [

          {
            id: 'what-is-geosonify',
            q: 'What is Geosonify?',
            a: `<p>Geosonify is an open framework for representing geographic locations in human-friendly ways. It began in 2012 and is released under the Mozilla Public License 2.0.</p>

<p>Most location systems give you one way to describe a place. Geosonify separates the geography from the representation. The same location can be expressed as letters and numbers, words and phrases, colours and visual patterns, musical notation, emoji, QR codes, or entirely custom vocabularies. The geography stays the same; only the representation changes.</p>

<ul>
  <li>Alphanumeric coordinates</li>
  <li>Words and phrases</li>
  <li>Colour patterns</li>
  <li>Musical notation</li>
  <li>Emoji</li>
  <li>QR codes and Data Matrix symbols</li>
  <li>Custom vocabularies</li>
</ul>`
          },

          {
            id: 'how-does-it-work',
            q: 'How does it work?',
            a: `<p><a href="https://geosonify.org/b%C2%B2s%C2%B2%20bounding%20box%20shortcut%20scheme.pdf">Imagine dividing the Earth into a 6×6 grid.</a> Each cell gets a label. Find the cell containing your location and record its label. Then divide that cell into another 6×6 grid and repeat. Every additional character narrows the location further. After enough iterations, any location on Earth can be represented to metre-level precision or better.</p>

<p>The resulting coordinate is hierarchical. The first character identifies a broad region; each successive character narrows it further. Remove characters from the right and you don't get the wrong location — you get the same location at lower precision. This graceful truncation turns out to be useful in a number of practical ways.</p>

<details class="faq-details" style="margin-top:16px;border:1px solid var(--ios-separator,#c6c6c8);border-radius:8px;overflow:hidden;">
<summary class="faq-details-summary" style="cursor:pointer;padding:11px 14px;font-weight:600;font-size:14px;background:var(--ios-light-gray,#f2f2f7);list-style:none;display:flex;align-items:center;gap:8px;user-select:none;">▸&nbsp;The precise encoding details are here</summary>
<div class="faq-details-body" style="padding:2px 14px 6px;font-size:13.5px;line-height:1.55;">
<p>The grid does not have to be 6×6. The same recursive subdivision works for any grid dimension, and Geosonify uses different grid sizes for different vocabularies — for example a 6×6 (36-cell) grid for the alphanumeric vocabulary, and a 45×45 (2025-cell) grid for the BIP39 word vocabularies. Each iteration selects exactly one cell, so the information added per character is log₂(grid size): for a 6×6 alphanumeric grid that is log₂(36) ≈ 5.17 bits per character, and an 8-character code over a 36-symbol grid corresponds to roughly 41 bits of positional search space.</p>
<p>Because each character selects one cell and the next character subdivides only that cell, codes are strict prefixes of one another. <code>thp9dahrg</code> and <code>thp9dah</code> describe the same point at different precisions — the shorter code is the larger enclosing cell. Truncating a code from the right never moves the location; it only enlarges the cell.</p>
<p>The encoding is purely client-side and deterministic: the same coordinate always produces the same code for a given grid, with no server lookup and no randomness, so coordinates never leave your device unless you choose to share the resulting code.</p>
</div>
</details>`
          }

        ]
      },

      // ================================================================
      {
        id: 'comparisons',
        title: 'How It Compares',
        items: [

          {
            id: 'vs-pluscodes-w3w',
            q: "Don't Plus Codes and what3words already solve this problem?",
            a: `<p>They solve related problems. Latitude/longitude, eastings/northings, Plus Codes and what3words are all valid ways to represent locations. Geosonify differs in two important ways.</p>

<p>First, the coordinate system is hierarchical. Nearby locations produce related coordinates, and broader geographic regions appear naturally within the coordinate structure.</p>

<p>Second, the vocabulary is not fixed. A location can be expressed as letters, words, colours, musical notes, QR codes, emoji, or entirely custom vocabularies. The geography stays the same; only the language changes.</p>`
          },

          {
            id: 'why-hierarchy',
            q: 'Why is hierarchy useful?',
            a: `<p>Because both computers and humans benefit from it, though in different ways.</p>

<p>Computers can use the hierarchy for efficient storage, routing and compression. Humans start recognising patterns.</p>

<p>Someone living in Christchurch, New Zealand, will quickly notice that many local coordinates begin with the same prefix. The same applies to word-based coordinates. An emergency responder might learn that <code>science food…</code> refers to the northern suburbs of Christchurch and <code>science gather…</code> to the southern ones. Instead of remembering four unfamiliar words each time, only the final word or two requires conscious attention. After a while, the prefix becomes familiar enough that it stops requiring attention at all.</p>

<p>The hierarchy lets humans compress information in much the same way computers do. Nearby places feel related because they are related.</p>

<details class="faq-details" style="margin-top:16px;border:1px solid var(--ios-separator,#c6c6c8);border-radius:8px;overflow:hidden;">
<summary class="faq-details-summary" style="cursor:pointer;padding:11px 14px;font-weight:600;font-size:14px;background:var(--ios-light-gray,#f2f2f7);list-style:none;display:flex;align-items:center;gap:8px;user-select:none;">▸&nbsp;The details — how hierarchy enables compression — are here</summary>
<div class="faq-details-body" style="padding:2px 14px 6px;font-size:13.5px;line-height:1.55;">
<p>The shared-prefix property is exactly what Geosonify's path compression exploits. Geographically nearby points tend to share long hierarchical prefixes. A full 9-character alphanumeric code like <code>91v91qsxr</code> encodes a location to roughly 2-metre precision. A nearby point — say, 66 metres away — might encode to <code>91v91qz8d</code>. These two codes share a long common prefix: <code>91v91q</code>. The only difference is the final three characters.</p>
<p>Delta encoding exploits this directly: instead of transmitting the full second code, you only transmit what changed — <code>z8d</code>. The receiver, who already has the first code, reconstructs the second by replacing the last 3 characters of <code>91v91qsxr</code> with <code>z8d</code>. See the Delta Encoding section for the full mechanism.</p>
</div>
</details>`
          },

          {
            id: 'coordinate-languages',
            q: 'What coordinate languages does Geosonify support?',
            a: `<p>Geosonify includes several built-in coordinate vocabularies:</p>
<ul>
  <li>Alphanumeric</li>
  <li>NATO phonetics</li>
  <li>Emoji</li>
  <li>BIP39 words</li>
  <li>ChromaCoord colour grids</li>
  <li>Musical grids</li>
  <li>Hexadecimal</li>
  <li>QR and Data Matrix outputs</li>
</ul>
<p>All of these represent the same underlying geography. The representation changes; the location does not.</p>`
          }

        ]
      },

      // ================================================================
      {
        id: 'words',
        title: 'Words & Speech',
        items: [

          {
            id: 'why-words',
            q: 'Why use words?',
            a: `<p>Some locations need to be spoken rather than displayed. Radio communication, phone calls and emergency situations all present this challenge. Coordinates are sometimes communicated under difficult conditions — a word may be misheard, a character mistyped, or a location copied incorrectly from one system to another. Geosonify's word-based coordinate systems are easier to communicate verbally than raw alphanumeric strings, and the more sophisticated of them are built on BIP39 word lists selected for their spoken-word clarity.</p>`
          },

          {
            id: 'why-bip39',
            q: 'Why BIP39?',
            a: `<p>Geosonify needed a large vocabulary of words that were easy to distinguish when spoken. A custom list could have been built from scratch, but BIP39 already offered something useful: vocabularies designed to be easily distinguished when spoken, available in multiple languages, openly published, and well tested in real-world use.</p>

<p>Geosonify starts with the internationally used BIP39 word lists and removes words more likely to cause confusion. The remaining words are arranged into a 45×45 grid. Unlike what3words, the resulting coordinates remain hierarchical: nearby places share common prefixes, making them easier to recognise, remember and communicate.</p>

<p>Geosonify currently supports BIP39 vocabularies in English, Spanish, French, Italian, Portuguese, Czech, Japanese, Korean, Simplified Chinese and Traditional Chinese.</p>

<details class="faq-details" style="margin-top:16px;border:1px solid var(--ios-separator,#c6c6c8);border-radius:8px;overflow:hidden;">
<summary class="faq-details-summary" style="cursor:pointer;padding:11px 14px;font-weight:600;font-size:14px;background:var(--ios-light-gray,#f2f2f7);list-style:none;display:flex;align-items:center;gap:8px;user-select:none;">▸&nbsp;The details — grid size and entropy — are here</summary>
<div class="faq-details-body" style="padding:2px 14px 6px;font-size:13.5px;line-height:1.55;">
<p>A 45×45 grid contains 2025 cells, so each word contributes log₂(2025) ≈ 10.98 bits — roughly the same information as two alphanumeric characters. This is why BIP39 codes reach metre-level precision in only a handful of words. Because the grid is still a recursive subdivision, BIP39 codes remain strictly hierarchical and gracefully truncatable: dropping the final word enlarges the cell rather than moving it.</p>
<p>The same prefix-sharing structure that makes alphanumeric codes compressible applies to word codes too — delta encoding operates on the token-level suffix of each code, so a NATO or BIP39 delta stream compresses by exactly the same logic as an alphanumeric one; the tokens are longer words but the prefix-sharing property is identical.</p>
</div>
</details>`
          },

          {
            id: 'checksum',
            q: 'What is the checksum used for?',
            a: `<p>Coordinates are sometimes communicated under difficult conditions. A word may be misheard, a character mistyped, or a location copied incorrectly from one system to another. Many Geosonify coordinate systems include a checksum that allows the recipient to verify that the coordinate arrived intact before attempting to use it. This is particularly useful when coordinates are relayed through multiple people or communicated in noisy environments.</p>`
          }

        ]
      },

      // ================================================================
      {
        id: 'visual',
        title: 'Visual & Machine-Readable Codes',
        items: [

          {
            id: 'chromacoord',
            q: 'What is ChromaCoord?',
            a: `<p>ChromaCoord is a visual coordinate system. A location is encoded as hexadecimal values and rendered as a colour pattern. The result resembles abstract artwork rather than a traditional coordinate, but it remains machine-readable: a Geosonify-compatible decoder can recover the original location from the image. Every location produces a distinct visual fingerprint, making ChromaCoord useful in contexts where a scannable image is more convenient than a string of characters.</p>`
          },

          {
            id: 'qr-datamatrix',
            q: 'Can Geosonify generate QR codes and Data Matrix symbols?',
            a: `<p>Yes. Geosonify coordinates can be embedded into standard machine-readable formats including QR codes and Data Matrix symbols. This allows locations to be attached to physical objects — geological samples, museum artefacts, survey markers, field equipment, manufactured components — in a printed symbol only a few millimetres across.</p>`
          }

        ]
      },

      // ================================================================
      {
        id: 'routes',
        title: 'Routes, Shapes & Compression',
        items: [

          {
            id: 'routes-polygons',
            q: 'How are routes and polygons represented?',
            a: `<p>Routes are represented as sequences of coordinates. To keep them compact, Geosonify uses hierarchical delta encoding: nearby points often share long coordinate prefixes, so only the changing suffixes need to be stored rather than each full code in sequence. This reduces the size of route descriptions substantially while preserving full precision at every point. Polygons are simply closed routes — if the final point matches the first, the system recognises the geometry as an area rather than a path.</p>`
          },

          {
            id: 'what-is-delta',
            q: 'What is delta encoding?',
            a: `<p>When you share a single location, the code is self-contained. But when you share a path or polygon — a route, a perimeter, a patrol area — you could have dozens or hundreds of points, each requiring a full code. Delta encoding is the compression scheme Geosonify uses to make multi-point shapes substantially more compact.</p>
<p>The idea is straightforward: nearby points share long prefixes, so instead of repeating the shared part of every code, Geosonify transmits the first code in full and then only the part of each subsequent code that actually changes.</p>

<details class="faq-details" style="margin-top:16px;border:1px solid var(--ios-separator,#c6c6c8);border-radius:8px;overflow:hidden;">
<summary class="faq-details-summary" style="cursor:pointer;padding:11px 14px;font-weight:600;font-size:14px;background:var(--ios-light-gray,#f2f2f7);list-style:none;display:flex;align-items:center;gap:8px;user-select:none;">▸&nbsp;The full delta-encoding details are here</summary>
<div class="faq-details-body" style="padding:2px 14px 6px;font-size:13.5px;line-height:1.55;">
<p>Take two codes 66 metres apart: <code>91v91qsxr</code> and <code>91v91qz8d</code>. Six characters in, they're identical — only the last three differ. Instead of transmitting the second code in full, delta encoding sends only what changed: <code>z8d</code>. The receiver replaces the last 3 characters of the previous code with that suffix and recovers <code>91v91qz8d</code> exactly.</p>
<p>The format looks like this:</p>
<pre>91v91qsxr~z8d~trv~ropf~1x1a2~…</pre>
<p>The first code is transmitted in full. Each subsequent tilde-separated segment is a suffix delta — just the characters that differ from the previous code, always from the right. The receiver reconstructs each full code by taking the appropriate prefix from the previous code and appending the delta.</p>

<h4>Gear changes</h4>
<p>The number of characters that need to change between consecutive points is not fixed. Points very close together might differ by only 1 character (a "high gear" — many points sharing a long prefix). Points further apart might differ by 4 or 5 characters (a "low gear"). If all your waypoints are clustered in a small area, almost every point shares the same long prefix and deltas are tiny. If you have a transcontinental route, gear may change frequently.</p>
<p>Geosonify handles this with a self-describing gear header in the delta stream. Rather than assuming a fixed delta width, each gear run is prefixed with a header indicating how many characters each delta in that run occupies. A <code>d</code> followed by a single hex digit means the deltas in this segment are each that many characters wide: <code>d3</code> = 3 characters each, <code>d4</code> = 4. If the gear value requires two hex digits (16 or above), two <code>d</code>s precede two hex digits: <code>dd10</code> = gear 16. The number of <code>d</code>s always equals the number of hex digits that follow, so the decoder always knows exactly where the header ends and the payload begins.</p>
<p>A real example — 54 full codes compresses to a gear-change stream:</p>
<pre style="font-size:0.8em;word-break:break-all;">91v91qsxr~d4qz8dqtrvropfx1a2x2tzx3qprybix5e9y07dx5lkrziesipt~d3j1ojrsk7rkf4kt1qfyq8zr86m7rhrp~d4t6si~d3d1b8jkksglr7m2obn05yz~d52iuux1nyb9~d3tousmzklmk02edd~d4hm2mhgu8~d2wnm8~d526opn~d3odnkz4fljabi~d40y420snd0myw0hi00s4i6ah06aoh6fr0</pre>
<p>Reading this: the first code is <code>91v91qsxr</code>. Then <code>d4</code> announces a run of 4-character deltas — <code>qz8d</code>, <code>qtrv</code>, <code>ropf</code>, <code>x1a2</code>, <code>x2tz</code>, <code>x3qp</code>, <code>rybi</code>, <code>x5e9</code>, <code>y07d</code>, <code>x5lk</code>, <code>rzie</code>, <code>sipt</code> — 12 points from a single gear-4 run. Then <code>d3</code> announces 3-character deltas for the next cluster, and so on. Each gear change is introduced by a new <code>d</code>-prefixed header; everything between headers is concatenated payload at a fixed width.</p>
<p>54 full codes × 9 characters = 486 characters. The delta-encoded form is around 160 characters — roughly 67% compression, achieved entirely from the prefix-sharing structure of geographically clustered points.</p>

<h4>How gear is chosen</h4>
<p>The encoder uses dynamic programming across the whole path to find the gear-run partition that minimises total encoded length, including the overhead of each gear-change header. Each gear-change header introduces overhead, so the DP weighs whether breaking a run and changing gear saves more than the header costs. The decoder doesn't need to know any of this — it just reads whatever headers appear.</p>
<p>The encoder always tries all three formats — fixed-width, variable-width tilde-separated, and gear-change — and picks whichever produces the shortest output. For short paths or paths with inconsistent prefix lengths, simple tilde-separated variable-width deltas sometimes win over gear-change.</p>

<h4>What delta encoding doesn't do</h4>
<p>Delta encoding is <strong>lossless</strong>. Every point in the path is encoded to full precision — nothing is approximated or averaged. The first code carries the full location, and every delta reconstructs the full code for its point. Truncating a delta stream loses the trailing points but leaves the earlier ones intact and fully decodable.</p>
<p>Delta encoding is also <strong>grid-agnostic</strong>. The same gear-change mechanism works identically for alphanumeric, NATO, emoji, BIP39, or any other grid — it operates on the token-level suffix of each code, whatever those tokens happen to be. A NATO delta stream compresses by the same logic as an alphanumeric one; the tokens are longer words but the prefix-sharing property is identical.</p>

<h4>Obfuscation and delta encoding</h4>
<p>Because each delta's final character is always identical to the final character of the full code it represents — the one character obfuscation never shifts — each delta carries its own de-obfuscation seed and can be processed independently. In practice, the encoder computes all deltas on raw unobfuscated codes, then obfuscates the first code and each delta segment separately as a final step. The receiver reverses each piece independently before reconstructing the path. The gear-change structure is applied to raw codes before obfuscation, so the gear headers themselves are never obfuscated and the decoder can always parse the stream structure.</p>

<table>
  <tr><th>Property</th><th>Value</th></tr>
  <tr><td>Compression method</td><td>Suffix deltas with self-describing gear headers (or variable tilde-separated, whichever is shorter)</td></tr>
  <tr><td>Header format</td><td><code>d</code> × K followed by K hex digits giving delta width</td></tr>
  <tr><td>Gear selection</td><td>Dynamic programming, optimal per path</td></tr>
  <tr><td>Typical saving (dense path)</td><td>60–80% vs full codes</td></tr>
  <tr><td>Precision loss</td><td>None — fully lossless</td></tr>
  <tr><td>Works with obfuscation</td><td>✓ (each delta obfuscated independently)</td></tr>
  <tr><td>Works with passphrase</td><td>✓ (deltas computed on raw codes; passphrase applied at encode/decode)</td></tr>
  <tr><td>Works across grid types</td><td>✓</td></tr>
</table>
</div>
</details>`
          }

        ]
      },

      // ================================================================
      {
        id: 'privacy',
        title: 'Obfuscation, Passphrases & Encryption',
        items: [

          {
            id: 'what-is-obfuscation',
            q: 'What is obfuscation?',
            a: `<p>Hierarchical coordinates intentionally contain visible structure — that's one of their strengths. Obfuscation is a tool for removing that visible structure when you'd rather nearby locations not look related. Two locations separated by only a few metres may appear completely unrelated after obfuscation, making casual pattern recognition much harder.</p>

<p>Obfuscation is reversible and requires no secret key. Anyone with Geosonify can decode an obfuscated code immediately. Think of it as camouflage rather than security: it hides patterns, but it does not protect information.</p>

<details class="faq-details" style="margin-top:16px;border:1px solid var(--ios-separator,#c6c6c8);border-radius:8px;overflow:hidden;">
<summary class="faq-details-summary" style="cursor:pointer;padding:11px 14px;font-weight:600;font-size:14px;background:var(--ios-light-gray,#f2f2f7);list-style:none;display:flex;align-items:center;gap:8px;user-select:none;">▸&nbsp;The full details — how obfuscation works — are here</summary>
<div class="faq-details-body" style="padding:2px 14px 6px;font-size:13.5px;line-height:1.55;">
<p><strong>TL;DR:</strong> Obfuscation removes visible locality patterns from codes, but provides no cryptographic security.</p>

<p>Obfuscation is a visual scrambling layer, not a security boundary. It is reversible by anyone with the app. It is <em>not</em> an encryption scheme, and the UI says so explicitly. Its purpose is to remove the hierarchical pattern that makes a plain code visually guessable — without requiring a shared secret.</p>

<h4>What obfuscation actually does</h4>
<p>A plain hierarchical code like <code>thp9dahrg</code> has a subtle structural property: the first character constrains you to a large region of the world, the second narrows it, and so on. Someone who knows the grid could in principle narrow down a code's location by recognising common prefixes between nearby codes. The structure is also visually regular in a way that might flag a code as a location reference.</p>
<p>Obfuscation scrambles the characters so that no such structure is visible, while preserving the property that the code can be deterministically reversed to its original. For example: <code>thp9dahrg</code> obfuscates to <code>hw8n0s8wg</code>.</p>
<p>Here's what happens step by step:</p>
<ol>
  <li><strong>The final character is the seed.</strong> The last character — <code>g</code> — is not obfuscated. It stays in place. This is intentional and important: <code>g</code> has a fixed flat index in the grid. That index becomes the seed for everything that follows.</li>
  <li><strong>A deterministic SHA3-512-derived shuffle is generated from that seed.</strong> The hash output is expanded deterministically as needed to generate enough material to permute all N cells of the grid. This uses the same SHA3-512-based deterministic shuffling approach as the passphrase mode, but seeded differently.</li>
  <li><strong>Each non-final character is shifted by its distance from the end.</strong> The first 8 characters (<code>thp9dahr</code>) are looked up in the shuffled grid to get their indices. Then each one is shifted modulo N by its distance from the final character: the second-to-last shifts by 1, the third-to-last by 2, and so on. The character in position 0 (furthest from the end) shifts the most. This position-dependent shifting means the same character in two different positions produces two different output characters, which destroys the hierarchical prefix structure.</li>
  <li><strong>Shifted indices are mapped back through the shuffled grid to output symbols.</strong> The final character is appended unchanged.</li>
</ol>
<p>The result is <code>hw8n0s8wg</code>: every character except the last is different, and no prefix relationship between the obfuscated code and any other obfuscated nearby code is preserved.</p>
<p>Reversing it is exactly the same process run backwards: take the final character, regenerate the same shuffle, reverse the position-dependent shifts, and recover <code>thp9dahrg</code>.</p>

<h4>The final character is load-bearing</h4>
<p>This is the most important operational property of obfuscation: <strong>the final character must be intact for the code to be decodable.</strong> In plain hierarchical mode, you can truncate a code from the right and simply lose precision — <code>thp9dahrg</code> becomes <code>thp9dah</code> which is a valid code for a slightly less precise location. This is useful for sharing approximate locations.</p>
<p>Obfuscated codes do not have this property. The final character is the seed that the entire decode depends on. Strip it, and the shuffle used to encode the code can no longer be reconstructed. Without the final character, the original code cannot be reconstructed — it is not a less-precise location, but an undecodable one.</p>
<p>This is a deliberate trade-off: obfuscation buys you pattern-hiding at the cost of the graceful truncation property.</p>

<h4>Obfuscation and delta encoding</h4>
<p>Each delta's final character is always identical to its unobfuscated counterpart's — obfuscation never shifts it. Delta codes are suffixes — they share the same final character as the full code they belong to. This means each delta can be obfuscated and de-obfuscated independently, using its own last character as the seed, without any knowledge of the full code it was derived from. In practice, delta encoding operates on raw unobfuscated codes internally, and obfuscation is applied to the first code and to each delta segment separately as a final step. The recipient reverses this: de-obfuscate each piece independently, then reconstruct the full codes from the deltas.</p>

<h4>What obfuscation is and isn't</h4>
<p>Obfuscation is fully reversible and one-to-one: every valid unobfuscated code maps deterministically to exactly one obfuscated form and back again. It is a permutation, not a lossy encoding or a hash.</p>
<ul>
  <li>It doesn't require a shared key — anyone with Geosonify can decode any obfuscated code immediately.</li>
  <li>It doesn't hide the fact that a code is a Geosonify code. The length, character set, and structure are all the same.</li>
  <li>It doesn't add any bits of security. Think of it like pig latin: it's not a cipher, it's a reversible cosmetic transform. Useful for making something look less immediately readable to a casual glance, not useful against anyone who knows what they're looking at.</li>
  <li>It doesn't protect against an observer who records the code and later obtains Geosonify — obfuscation provides no forward secrecy.</li>
</ul>

<h4>When obfuscation is and isn't appropriate</h4>
<p>Use obfuscation when you want nearby locations to look unrelated, when you're stacking it on top of a passphrase (the passphrase handles the real security; obfuscation adds surface scrambling on top), or when you'd rather a code not look like an obvious grid reference to a casual observer.</p>
<p>Don't use it when you need actual confidentiality — use a passphrase or AES URL encryption instead. Also avoid it when codes may need to be truncated for precision reduction, since obfuscated codes can't be safely truncated. Delta encoding is unaffected: it always operates on raw codes internally and obfuscates each delta segment separately.</p>

<table>
  <tr><th>Property</th><th>Hierarchical</th><th>Obfuscated</th></tr>
  <tr><td>Requires key to decode</td><td>✗</td><td>✗</td></tr>
  <tr><td>Visually reveals prefix structure</td><td>✓</td><td>✗</td></tr>
  <tr><td>Safely truncatable from right</td><td>✓</td><td>✗</td></tr>
  <tr><td>Provides confidentiality</td><td>✗</td><td>✗</td></tr>
  <tr><td>Compatible with delta encoding</td><td>✓</td><td>✓</td></tr>
  <tr><td>Compatible with passphrase</td><td>✓</td><td>✓</td></tr>
</table>
</div>
</details>`
          },

          {
            id: 'what-is-passphrase-mode',
            q: 'What is passphrase mode?',
            a: `<p>Passphrase mode creates a private coordinate language shared by a group. A shared passphrase rearranges the coordinate vocabulary so that people using the same passphrase decode coordinates consistently, while people using a different passphrase — or no passphrase — decode them to entirely different locations.</p>

<p>This lets a group publish coordinates openly while restricting their meaning to members who share the passphrase. Typical uses include geocaching groups, treasure hunts, archaeological projects, field survey crews, and similar teams who need to share locations within a group without broadcasting them to everyone.</p>

<p>Each coordinate produced this way is valid on its own — it's just that only people with the correct passphrase will arrive at the intended location.</p>

<p>For example, a random 2 m × 3 m spot inside Boston City Hall encodes as:</p>

<p><code>7mn810bc2</code></p>

<p>With obfuscation enabled, this becomes:</p>

<p><code>f67jogqn2</code></p>

<p>If someone attempts to decode that obfuscated coordinate as an ordinary hierarchical coordinate, they end up in a dry riverbed in Algeria.</p>

<p>Move only three metres east and the next coordinate becomes:</p>

<p><code>7mn810bc3</code></p>

<p>which obfuscates to:</p>

<p><code>5kd5a5uv3</code></p>

<p>Decoding that as an ordinary hierarchical coordinate places you on Bolshoy Lyakhovsky Island in the Siberian Arctic.</p>

<p>Passphrases create similar effects. Using the passphrase <strong>Cod</strong>, the original Boston location becomes:</p>

<p><code>alknxyvbc</code></p>

<p>which would normally place you beside the G552 National Highway in the Gobi Desert.</p>

<p>Using <strong>Patriots</strong> produces:</p>

<p><code>7dpi6zqle</code></p>

<p>which would normally decode to a dirt track in Yellowstone County, Montana.</p>

<p>Using <strong>Back Bay</strong> produces:</p>

<p><code>9y1bcaq3m</code></p>

<p>which would normally place you near the Tharthar Canal outside Tikrit, Iraq.</p>

<p>People using the same passphrase decode all of these to Boston City Hall. People using a different passphrase decode them to somewhere else entirely.</p>

<details class="faq-details" style="margin-top:16px;border:1px solid var(--ios-separator,#c6c6c8);border-radius:8px;overflow:hidden;">
<summary class="faq-details-summary" style="cursor:pointer;padding:11px 14px;font-weight:600;font-size:14px;background:var(--ios-light-gray,#f2f2f7);list-style:none;display:flex;align-items:center;gap:8px;user-select:none;">▸&nbsp;The details — how the keyed shuffle works — are here</summary>
<div class="faq-details-body" style="padding:2px 14px 6px;font-size:13.5px;line-height:1.55;">
<p>When you add a passphrase, the mapping becomes dependent on a cryptographic key. At each encoding iteration, the grid is shuffled using a key derived from your passphrase combined with the sequence of cell indices chosen so far (the "chain"). The shuffle uses <strong>SHA3-512</strong> — a 512-bit output hash from the NIST-standardised Keccak family — to generate a per-cell sort key. Each cell gets its own independent SHA3-512 digest, computed from <code>passphrase | chain | cell_index</code>, and cells are sorted by these digests. This produces a cryptographically keyed permutation by sorting cells according to SHA3-512-derived values.</p>
<p>The chaining intentionally couples each iteration to previous choices, preventing symbols from being decoded independently in isolation. No practical shortcut is currently known to us, though the scheme has not undergone formal cryptanalysis.</p>
<p>The entropy per iteration is log₂(grid size). For a 6×6 alphanumeric grid that's log₂(36) ≈ 5.17 bits per character. An 8-character code over a 36-symbol grid corresponds to approximately 41 bits of positional search space before passphrase-guessing is even considered. With a strong passphrase, brute-forcing the location from the code requires enumerating passphrases, not grid positions.</p>
<p><em>What the grid passphrase does not do:</em> it does not hide metadata. An observer can see the code exists, can see its length (and therefore approximate precision), can see which grid type it's in if they recognise the vocabulary (BIP39 words look like BIP39 words), and can make statistical guesses if they observe many codes from the same passphrase. It is a confidentiality scheme for the coordinate value, not a covert communications channel.</p>
</div>
</details>`
          },

          {
            id: 'obfuscation-vs-passphrase-vs-encryption',
            q: 'What is the difference between obfuscation, passphrases and encryption?',
            a: `<p>They serve different purposes and provide different guarantees.</p>
<h4>Obfuscation</h4>
<p>Removes visible patterns from coordinates. No key is required to reverse it, and anyone with Geosonify can decode an obfuscated code immediately. Useful when you'd rather nearby locations not look visually related, but not suitable when actual confidentiality is needed.</p>
<h4>Passphrase Mode</h4>
<p>Creates a private coordinate language for a group. Coordinates are valid but only decode to the intended location for people who share the passphrase. Everyone else decodes to somewhere else entirely. Appropriate for geocaching groups, field teams, and similar shared-access use cases.</p>
<h4>Encryption</h4>
<p>Encrypts the entire coordinate payload using AES-256-GCM. Routes, shapes, metadata and coordinates are all protected. This hides not only the location values but the structure of what is being communicated — the number of waypoints, the path length, the grid type.</p>

<details class="faq-details" style="margin-top:16px;border:1px solid var(--ios-separator,#c6c6c8);border-radius:8px;overflow:hidden;">
<summary class="faq-details-summary" style="cursor:pointer;padding:11px 14px;font-weight:600;font-size:14px;background:var(--ios-light-gray,#f2f2f7);list-style:none;display:flex;align-items:center;gap:8px;user-select:none;">▸&nbsp;The full security breakdown — all three layers — is here</summary>
<div class="faq-details-body" style="padding:2px 14px 6px;font-size:13.5px;line-height:1.55;">
<div style="background:var(--ios-light-gray,#f2f2f7);border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:13px;line-height:1.5;">
  <strong>TL;DR</strong><br>
  No passphrase → public encoding, anyone can read it.<br>
  Grid passphrase → cryptographically keyed, protects the coordinate value, not surrounding metadata.<br>
  AES URL encryption → standard authenticated encryption, recommended for sensitive use.
</div>

<p>It depends entirely on which mode you use.</p>

<h4>The three layers — and what each one actually does</h4>

<p><strong>1. Hierarchical encoding (no passphrase)</strong></p>
<p>Without a passphrase, Geosonify codes are <em>not</em> secret. They are an open, deterministic mapping from coordinates to symbols. Anyone with the app can decode any code instantly. Think of it like a grid reference — it's a notation system, not a cipher. The code <code>thp9dahrg</code> encodes a location in the same way a postcode or what3words address does: publicly, by convention.</p>
<p>Use this when you want a compact, human-readable, grid-type-agnostic location code that you don't mind anyone decoding. The value here is interoperability and readability, not secrecy.</p>

<p><strong>2. Grid passphrase (position-dependent shuffle)</strong></p>
<p>When you add a passphrase, the mapping becomes dependent on a cryptographic key. At each encoding iteration, the grid is shuffled using a key derived from your passphrase combined with the sequence of cell indices chosen so far (the "chain"). The shuffle uses <strong>SHA3-512</strong> — a 512-bit output hash from the NIST-standardised Keccak family — to generate a per-cell sort key. Each cell gets its own independent SHA3-512 digest, computed from <code>passphrase | chain | cell_index</code>, and cells are sorted by these digests. This produces a cryptographically keyed permutation by sorting cells according to SHA3-512-derived values.</p>
<p>The chaining intentionally couples each iteration to previous choices, preventing symbols from being decoded independently in isolation. No practical shortcut is currently known to us, though the scheme has not undergone formal cryptanalysis.</p>
<p>The entropy per iteration is log₂(grid size). For a 6×6 alphanumeric grid that's log₂(36) ≈ 5.17 bits per character. An 8-character code over a 36-symbol grid corresponds to approximately 41 bits of positional search space before passphrase-guessing is even considered. With a strong passphrase, brute-forcing the location from the code requires enumerating passphrases, not grid positions.</p>
<p><em>What the grid passphrase does not do:</em> it does not hide metadata. An observer can see the code exists, can see its length (and therefore approximate precision), can see which grid type it's in if they recognise the vocabulary (BIP39 words look like BIP39 words), and can make statistical guesses if they observe many codes from the same passphrase. It is a confidentiality scheme for the coordinate value, not a covert communications channel.</p>

<p><strong>3. Hard URL encryption (AES-256-GCM)</strong></p>
<p>The URL encryption layer hides everything — not just the coordinates but the grid type, number of points, path length, and any other structural metadata. It uses:</p>
<ul>
  <li><strong>PBKDF2</strong> with SHA-256, 100,000 iterations, and a random 16-byte salt for key derivation. This makes offline dictionary attacks expensive: each passphrase guess requires 100,000 PBKDF2-SHA256 iterations.</li>
  <li><strong>AES-256-GCM</strong> for authenticated encryption. GCM provides both confidentiality and integrity — a wrong passphrase doesn't just produce garbage, it produces a detectable authentication failure (the 128-bit GCM tag won't verify), so there is no oracle to tell an attacker they're "getting warmer."</li>
  <li>A random 12-byte IV per encryption, meaning two encryptions of identical plaintexts produce different ciphertexts.</li>
  <li>Payload padding to the nearest 32 bytes, which obscures the exact length of the plaintext and prevents an attacker from inferring the number of waypoints or precision level from ciphertext size alone.</li>
</ul>
<p>The output is a single opaque Base64url blob in the URL: <code>?enc=…</code>. Without the passphrase, the payload appears as an opaque encrypted blob — it reveals no plaintext location or structural metadata about the encoded content.</p>
<p>AES-256-GCM with salted PBKDF2-derived keys is a standard modern authenticated-encryption construction widely used across secure web and password-management systems. There are no known practical attacks against correctly implemented AES-256-GCM with proper key derivation.</p>
<p>For strong security guarantees, the AES URL encryption layer should be preferred. The grid-passphrase mode is best understood as a cryptographically keyed encoding scheme rather than a replacement for standard authenticated encryption.</p>

<h4>The trust question: "how do I verify this?"</h4>
<p>Geosonify is a client-side web application — all the code that runs is the code you can read in your browser. There is no server involved in encoding or decoding; coordinates never leave your device unless you choose to share the code. You can:</p>
<ul>
  <li>Open DevTools → Sources and read every function involved in encryption. The key functions are <code>shuffleGridAndOrder</code> in <code>card-renderer.js</code> (grid passphrase) and <code>deriveEncryptionKey</code> / <code>encryptQueryString</code> in <code>index.html</code> (AES layer). They are unminified and commented.</li>
  <li>Verify that no network requests are made during encode/decode by watching the Network tab.</li>
  <li>Save the page locally and run it offline — it works completely disconnected from the internet.</li>
  <li>Cross-check the cryptographic primitives: SHA3-512 is from the <code>@noble/hashes</code> library (audited, widely used); AES-GCM uses the browser's native <code>crypto.subtle</code> API (WebCrypto), which is implemented in the browser engine itself, not in JavaScript.</li>
</ul>
<p>You are not trusting Geosonify's cryptographic design. You are trusting SHA3-512 (standardised by NIST as FIPS 202), AES-256-GCM (NIST FIPS 197 / SP 800-38D), PBKDF2 (NIST SP 800-132), and your browser's WebCrypto implementation.</p>

<h4>Honest limitations</h4>
<ul>
  <li><strong>The grid-passphrase scheme is experimental.</strong> The AES-based URL encryption relies on widely trusted standard primitives. The Geosonify grid-passphrase scheme, however, is a bespoke construction and has not undergone formal cryptanalysis or independent security audit. It is thoughtful and nontrivial, but it is not a proven cipher.</li>
  <li><strong>Intended threat model.</strong> Geosonify is designed primarily to protect against casual observation, unintended disclosure, and offline interception of shared location data — not against nation-state adversaries or compromised devices.</li>
  <li><strong>Passphrase strength is everything.</strong> A weak passphrase makes any of these schemes weak. "hello" is not a passphrase. A 6-word diceware phrase or a random 20-character string is.</li>
  <li>The grid passphrase alone does not hide that a code exists, its approximate length, or potentially its grid vocabulary. If operational security requires hiding that a location is being communicated, use the AES URL encryption layer.</li>
  <li>Obfuscation mode is explicitly <em>not</em> a security feature — it is cosmetic rearrangement useful for making codes look less obviously geographic. The UI labels it accordingly.</li>
  <li>Key management is your problem. If you share the passphrase over an insecure channel, that's the weakest link. Geosonify cannot protect you from that.</li>
</ul>

<table>
  <tr><th>Mode</th><th>Hides coordinates</th><th>Hides structure</th><th>Cryptographic primitive</th></tr>
  <tr><td>No passphrase</td><td>✗</td><td>✗</td><td>None (public encoding)</td></tr>
  <tr><td>Grid passphrase</td><td>✓</td><td>✗</td><td>SHA3-512 keyed permutation</td></tr>
  <tr><td>AES URL encryption</td><td>✓</td><td>✓</td><td>PBKDF2 + AES-256-GCM</td></tr>
</table>
<p>For most operational use cases where you simply don't want a casual observer to read the location, the grid passphrase is sufficient. For high-stakes use where even the existence of structured location data should be hidden, use AES URL encryption with a strong passphrase. For public, shareable, no-secrets location codes, use no passphrase and enjoy the full interoperability between grid types.</p>
</div>
</details>`
          },

          {
            id: 'how-encryption-works',
            q: 'How does the encryption work?',
            a: `<p>Geosonify uses AES-256-GCM encryption with keys derived from user passphrases. The implementation protects coordinate data, routes and associated metadata when confidentiality is required. Most users will never need this feature — for many applications, passphrase mode provides a simpler and more convenient solution.</p>

<details class="faq-details" style="margin-top:16px;border:1px solid var(--ios-separator,#c6c6c8);border-radius:8px;overflow:hidden;">
<summary class="faq-details-summary" style="cursor:pointer;padding:11px 14px;font-weight:600;font-size:14px;background:var(--ios-light-gray,#f2f2f7);list-style:none;display:flex;align-items:center;gap:8px;user-select:none;">▸&nbsp;The cryptographic details are here</summary>
<div class="faq-details-body" style="padding:2px 14px 6px;font-size:13.5px;line-height:1.55;">
<p>The URL encryption layer hides everything — not just the coordinates but the grid type, number of points, path length, and any other structural metadata. It uses:</p>
<ul>
  <li><strong>PBKDF2</strong> with SHA-256, 100,000 iterations, and a random 16-byte salt for key derivation. This makes offline dictionary attacks expensive: each passphrase guess requires 100,000 PBKDF2-SHA256 iterations.</li>
  <li><strong>AES-256-GCM</strong> for authenticated encryption. GCM provides both confidentiality and integrity — a wrong passphrase doesn't just produce garbage, it produces a detectable authentication failure (the 128-bit GCM tag won't verify), so there is no oracle to tell an attacker they're "getting warmer."</li>
  <li>A random 12-byte IV per encryption, meaning two encryptions of identical plaintexts produce different ciphertexts.</li>
  <li>Payload padding to the nearest 32 bytes, which obscures the exact length of the plaintext and prevents an attacker from inferring the number of waypoints or precision level from ciphertext size alone.</li>
</ul>
<p>The output is a single opaque Base64url blob in the URL: <code>?enc=…</code>. Without the passphrase, the payload appears as an opaque encrypted blob — it reveals no plaintext location or structural metadata about the encoded content.</p>
<p>AES-256-GCM with salted PBKDF2-derived keys is a standard modern authenticated-encryption construction widely used across secure web and password-management systems. There are no known practical attacks against correctly implemented AES-256-GCM with proper key derivation. The key derivation function is <code>deriveEncryptionKey</code> and the encryption entry point is <code>encryptQueryString</code>, both in <code>index.html</code>, and AES-GCM uses the browser's native <code>crypto.subtle</code> (WebCrypto) API rather than a JavaScript implementation.</p>
</div>
</details>`
          }

        ]
      },

      // ================================================================
      {
        id: 'music',
        title: 'Music & Sonification',
        items: [

          {
            id: 'why-music',
            q: 'Why does Geosonify make music?',
            a: `<p>Because Greg wanted <a href="https://youtu.be/hPuu4iEMzdA">a soundtrack for a bike ride</a>.</p>
<p>In 2021, a GoPro timelapse of a bicycle commute prompted the question of whether geographic movement could be converted into sound. To make this possible, Geosonify needed a musical grid that didn't yet exist — one where neighbouring cells were deliberately designed to differ by musically coherent intervals, so that small geographic movements would produce musically related changes rather than arbitrary jumps.</p>

<p>That grid was built from scratch specifically for sonification. The result became the Geosonify sonification engine.</p>`
          },

          {
            id: 'how-sonification-works',
            q: 'How does the sonification work?',
            a: `<p>The hierarchical structure of the coordinate system maps onto musical octaves. Broad geographic regions influence the lower octaves; more precise location details influence the higher ones. As you move, the highest notes change with small movements while the lower notes shift more slowly as larger geographic boundaries are crossed. Standing still produces a sustained chord; moving produces a melodic line in the upper voices over a slower-moving harmonic foundation.</p>

<details class="faq-details" style="margin-top:16px;border:1px solid var(--ios-separator,#c6c6c8);border-radius:8px;overflow:hidden;">
<summary class="faq-details-summary" style="cursor:pointer;padding:11px 14px;font-weight:600;font-size:14px;background:var(--ios-light-gray,#f2f2f7);list-style:none;display:flex;align-items:center;gap:8px;user-select:none;">▸&nbsp;The details — how position maps to pitch — are here</summary>
<div class="faq-details-body" style="padding:2px 14px 6px;font-size:13.5px;line-height:1.55;">
<p>Each character of a code selects one of N cells within its parent cell, so that position's value maps directly onto a pitch within an octave — the cell index becomes a scale degree. Stack the positions across a full code and you get several simultaneous voices at different octaves: a chord whose lower notes hold steady while the upper notes move as you travel. Standing still produces a sustained harmony; moving produces a melodic line in the upper voices over a slowly shifting harmonic foundation. This is a direct consequence of the hierarchical encoding — the same property that makes nearby places share prefixes makes nearby places sound similar.</p>
</div>
</details>`
          }

        ]
      },

      // ================================================================
      {
        id: 'custom',
        title: 'Custom Grids',
        items: [

          {
            id: 'create-own-language',
            q: 'Can I create my own coordinate language?',
            a: `<p>Yes — and this is one of the central ideas behind Geosonify. You can upload your own grid as a CSV file. The symbols can be almost anything: words, emoji, scientific terminology, star names, minerals, educational vocabulary, fictional locations, DNA nucleotides, amino acids. The grid structure provides the geography; the symbols are yours to choose.</p>

<p>A coordinate system built from amino acids, nucleotides, geological periods, Māori vocabulary, or bird species would work just as well as the built-in ones. So would a grid designed for a specific curriculum, research project, or game. The geography comes from the structure; the vocabulary is entirely open.</p>`
          },

          {
            id: 'custom-grid-permission',
            q: 'Do I need permission to create custom grids?',
            a: `<p>No. Custom grids are intended to be created, shared and experimented with freely. Many of Geosonify's existing coordinate systems — the musical grid, the word grids, the colour systems — began as experiments in finding alternative ways to express the same geography. If you can imagine it, you can build it.</p>`
          }

        ]
      },

      // ================================================================
      {
        id: 'project',
        title: 'The Project',
        items: [

          {
            id: 'is-it-free',
            q: 'Is Geosonify free?',
            a: `<p>Yes. Geosonify is free, open source software released under the Mozilla Public License 2.0. The project is intended to remain free and open.</p>`
          },

          {
            id: 'long-term-goal',
            q: 'What is the long-term goal?',
            a: `<p>The website is one implementation of the Geosonify framework. The larger goal is to maintain an open, extensible way of representing location that others can build on.</p>

<p>Researchers, artists, educators, emergency responders, surveyors, geocachers and developers are encouraged to create new vocabularies and explore new applications. The framework is open, the rules are public, and the tools are free. The most interesting use of Geosonify may be something nobody has thought of yet.</p>`
          }

        ]
      }

    ], // end sections

    // ================================================================
    examples: [

      {
        category: 'Circles',
        items: [
          { label: 'Melbourne 1km radius',   href: '?r=-37.814246,144.963170~1000m', code: '~1000m' },
          { label: 'Melbourne (emoji radius)', href: '?r=-37.814246,144.963170~RS',   code: '~RS' },
          { label: 'Mt Taranaki',            href: '?r=-39.296389,174.064722~9656m', code: '~9656m' },
          { label: 'Mt Taranaki (emoji)',    href: '?r=-39.296389,174.064722~🚋🔕',  code: '~🚋🔕' },
        ]
      },
      {
        category: 'Graticules',
        items: [
          { label: 'South Australia',               href: '?r=-32.03,135~~💗💜🔗❎🐡',             code: '~~💗💜🔗❎🐡' },
          { label: 'Colorado',                      href: '?r=39d0m0sN,105d32m48sW~~7deg_4deg',    code: '~~7deg_4deg' },
          { label: 'Colorado (emoji)',               href: '?r=39,-105.546667~~🧰🦮🤲📺',           code: '~~🧰🦮🤲📺' },
          { label: 'Hormuz Exclusion Zone Apr 2026', href: '?r=26d32m30sN,56d30m0sE~~20min_15min', code: '~~20min_15min' },
        ]
      },
      {
        category: 'Rectangles',
        items: [
          { label: 'Aotearoa',        href: '?r=-41.607904,173.046738~200.5deg_1525km_630km',  code: '1525km×630km' },
          { label: 'Four Aves',       href: '?r=-43.530465,172.631455~🤼🐙🍉🦂',              code: '🤼🐙🍉🦂' },
          { label: 'Parthenon',       href: '?r=37.971502,23.726621~257deg_70m_31m',           code: '70×31m' },
          { label: 'Hoddle Grid',     href: '?r=-37.814246,144.963170~🚰🔗🏓🌠',              code: '🚰🔗🏓🌠' },
          { label: 'Central Park',    href: '?r=40.782419,-73.965552~3BN4.36H',                code: '3BN4.36H' },
          { label: 'Brooklyn Bridge', href: '?r=40.706254,-73.997051~136.4deg_1834m_26m',      code: '1834×26m' },
          { label: 'Liberty Island',  href: '?r=40.689938,-74.045241~🌼🧩🍥',                 code: '🌼🧩🍥' },
        ]
      },
      {
        category: 'Paths',
        items: [
          { label: 'CHC → LHR great circle',    href: '?r=-43.489444,172.532222~51.4775,-0.461389', code: '2 pts' },
          { label: 'Taronga Zoo ferry',          href: '?r=-33.846402,151.239590~-33.847842,151.236719~-33.849015,151.235148~-33.849897,151.233537~-33.849969,151.232446~-33.849776,151.229846~-33.849984,151.225897~-33.850233,151.224861~-33.851589,151.222136~-33.853127,151.219880~-33.854819,151.214855~-33.855569,151.213770~-33.857001,151.212539~-33.858268,151.212106~-33.860778,151.211888', code: '15 pts' },
          { label: 'Copenhagen walk',            href: '?r=55.675829,12.567643~55.675653,12.568651~55.675916,12.568841~55.675974,12.569781~55.675041,12.571693~55.674628,12.573288~55.674648,12.573770~55.675622,12.575687~55.674918,12.576417~55.675006,12.577429~55.674776,12.576589~55.675439,12.575957~55.676580,12.577563~55.677005,12.578662~55.676572,12.579266~55.676904,12.580086~55.676865,12.580543~55.676647,12.580872~55.676120,12.580545~55.676226,12.580371~55.676315,12.581449~55.676899,12.582640~55.677220,12.584274~55.677874,12.585765~55.677704,12.586558~55.677988,12.587760~55.676607,12.588467~55.676620,12.589442~55.676996,12.590484~55.678047,12.592403~55.678385,12.592363~55.679016,12.592726~55.679513,12.591206~55.679763,12.591329~55.679871,12.591070~55.680549,12.588242~55.680932,12.587523~55.681327,12.587704~55.684728,12.590617~55.684882,12.590118~55.684844,12.590660~55.685093,12.590951~55.687527,12.593000~55.687739,12.592986~55.688111,12.596409~55.688916,12.597135~55.689782,12.598827~55.691222,12.598681~55.691503,12.598846~55.691877,12.598666~55.692824,12.599023~55.691809,12.598624~55.689724,12.598819~55.689463,12.597921~55.688871,12.597104', code: '55 pts' },
          { label: 'Heathrow taxi',              href: '?r=51.470698,-0.454460~51.471322,-0.454416~51.472343,-0.453250~51.473871,-0.453044~51.481505,-0.453539~51.481993,-0.453395~51.482355,-0.452932~51.485201,-0.452656~51.486509,-0.452727~51.488148,-0.453371~51.490310,-0.453762~51.491457,-0.453824~51.494701,-0.453562~51.495520,-0.454187~51.496048,-0.454226~51.496382,-0.453332~51.495942,-0.451831~51.494318,-0.437461~51.492961,-0.417024~51.492942,-0.410967~51.491844,-0.405482~51.488579,-0.394121~51.488256,-0.392574~51.488022,-0.390133~51.487907,-0.386063~51.488106,-0.382926~51.490308,-0.366970~51.492684,-0.359511~51.493232,-0.358483~51.493911,-0.356620~51.494786,-0.352967~51.495235,-0.348536~51.495881,-0.338340~51.495794,-0.334475~51.495155,-0.331288~51.493789,-0.327256~51.492772,-0.325143~51.491213,-0.320537~51.489982,-0.317570~51.489592,-0.315931~51.489415,-0.313460~51.489492,-0.310984~51.489649,-0.310124~51.490997,-0.306260~51.491342,-0.304736~51.491471,-0.292163~51.492571,-0.289067~51.492888,-0.287157~51.492808,-0.286088~51.492418,-0.284469~51.488960,-0.276002~51.488084,-0.272135~51.488267,-0.271862~51.488277,-0.271300~51.487710,-0.267423~51.487778,-0.266083~51.487596,-0.263100~51.487702,-0.259241~51.487079,-0.254266~51.487226,-0.251966~51.487688,-0.251214~51.490254,-0.245106~51.491432,-0.240234~51.491476,-0.237703~51.491388,-0.235951~51.491044,-0.233982~51.491213,-0.233128~51.491226,-0.231560~51.491037,-0.230350~51.491307,-0.228035~51.491506,-0.221106~51.491332,-0.218692~51.490849,-0.216663~51.490980,-0.215759~51.490571,-0.209026~51.490977,-0.207252~51.491045,-0.205218~51.491597,-0.202544~51.492999,-0.200269~51.494843,-0.195909~51.494427,-0.192876~51.494468,-0.191948~51.494861,-0.191340~51.494586,-0.188757~51.494923,-0.186358~51.495108,-0.183452~51.495245,-0.183131~51.495781,-0.182930~51.496322,-0.183250~51.496728,-0.183191~51.497417,-0.183389~51.497692,-0.183697~51.497935,-0.179690~51.498450,-0.179587~51.499375,-0.180219~51.499714,-0.179359~51.499631,-0.177905~51.500038,-0.175492~51.500047,-0.174345~51.501050,-0.174369~51.501934,-0.174704~51.503171,-0.174737~51.503963,-0.173975~51.504386,-0.173817~51.505210,-0.173249~51.505016,-0.172793', code: '106 pts' },
          { label: 'Büyükada → İstanbul',       href: '?r=40.871787,29.126238~40.871518,29.126116~40.870101,29.121461~40.869877,29.118094~40.868927,29.116371~40.868369,29.115956~40.866683,29.115485~40.866247,29.115657~40.865149,29.116783~40.863312,29.116095~40.861998,29.115797~40.861820,29.115644~40.861663,29.114737~40.861157,29.113585~40.860895,29.113609~40.860709,29.114143~40.860897,29.115326~40.860670,29.116915~40.859605,29.118890~40.858113,29.120031~40.857821,29.119766~40.857912,29.120211~40.857232,29.120790~40.856148,29.121283~40.854997,29.122272~40.854587,29.122751~40.854132,29.123818~40.853273,29.124635~40.855197,29.124603~40.856814,29.124955~40.858096,29.126653~40.860347,29.128363~40.861612,29.130389~40.864471,29.132114~40.865740,29.132711~40.865846,29.133755~40.866202,29.134803~40.866827,29.135605~40.867583,29.136139~40.868310,29.136280~40.869083,29.135909~40.870518,29.134394~40.871236,29.134106~40.872438,29.133210~40.872913,29.131836~40.873368,29.131253~40.873975,29.130839~40.874128,29.129839~40.874251,29.130030~40.874062,29.130203~40.874334,29.130295~40.874381,29.130493~40.874297,29.131060~40.874680,29.131133~40.874711,29.130603~40.874989,29.130329~40.874993,29.129058~40.874868,29.128813~40.873849,29.128462~40.873292,29.127988~40.873281,29.128351~40.873828,29.128446~40.873959,29.128306~40.873810,29.128035~40.873939,29.128224~40.873864,29.128414~40.873075,29.126163~40.873129,29.125794~40.873280,29.126004~40.873183,29.125876~40.873081,29.126020~40.873537,29.125812~40.873176,29.126182~40.873149,29.125869~40.873252,29.126117~40.876527,29.127233~40.877483,29.126154~40.878737,29.124157~40.882349,29.119849~40.883621,29.118736~40.898588,29.102529~40.901242,29.100542~40.923416,29.070419~40.926361,29.066520~40.926457,29.066566~40.928421,29.063181~40.929044,29.061789~40.940430,29.042822~40.951928,29.029826~40.952640,29.029255~40.953843,29.028805~40.956185,29.027111~40.958467,29.026126~40.959538,29.025853~40.960709,29.025912~40.962088,29.025751~40.964399,29.026074~40.965194,29.026366~40.965892,29.026321~40.966391,29.026652~40.966910,29.026574~40.967249,29.026909~40.970064,29.027555~40.980876,29.016636~40.986606,29.012904~40.986866,29.012251~40.988005,29.011815~40.994720,29.006721~41.003579,29.002644~41.005483,29.002087~41.006470,29.001398~41.007406,29.001328~41.007995,29.001099~41.020772,28.999893~41.029241,28.995761~41.029643,28.995869~41.030730,28.995681~41.031078,28.995818~41.034059,28.995845~41.035190,28.995334~41.035479,28.994229', code: '121 pts' },
        ]
      },
      {
        category: 'Countries',
        items: [
          { label: 'Aotearoa',    href: '?r=-41.618972,173.070043~⚓🍰🍏🥔', code: '⚓🍰🍏🥔' },
          { label: 'Iceland',     href: '?r=64.969091,-18.952600~🐴🦁🛀💒',  code: '🐴🦁🛀💒' },
          { label: 'Egypt',       href: '?r=26.852797,31.023946~🧺🍰🧸😚',   code: '🧺🍰🧸😚' },
          { label: 'Montenegro',  href: '?r=42.730933,19.199956~🍆🧒💺🎲',   code: '🍆🧒💺🎲' },
          { label: 'Nigeria',     href: '?r=9.036059,8.627316~🧺🍰👅👟',     code: '🧺🍰👅👟' },
          { label: 'Ireland',     href: '?r=53.406288,-8.147845~🏀🦁💭🧷',   code: '🏀🦁💭🧷' },
          { label: 'Singapore',   href: '?r=1.352223,103.808784~🔰🧙🎽🤠',   code: '🔰🧙🎽🤠' },
          { label: 'Switzerland', href: '?r=46.827204,8.234257~💼💾💟🧓',    code: '💼💾💟🧓' },
          { label: 'Panama',      href: '?r=8.417324,-80.099379~🌿🦁🦦🥰',   code: '🌿🦁🦦🥰' },
          { label: 'Cuba',        href: '?r=21.555788,-79.369509~🤰🍰🌊👃',  code: '🤰🍰🌊👃' },
          { label: 'Turkey',      href: '?r=38.956099,35.595855~🧻🍰🦮🚃',   code: '🧻🍰🦮🚃' },
        ]
      },
      {
        category: 'Shape Import',
        items: [
          { label: 'Budapest',       href: '?place=Budapest',                                   code: 'Place name' },
          { label: 'Lake Geneva',    href: '?place=Lake Geneva',                                code: 'Place name' },
          { label: 'Vatican City',   href: '?place=Vatican City',                               code: 'Place name' },
          { label: 'Bibbulmun Track', href: '?wikidata=Q4902980',                               code: 'Wikidata' },
          { label: 'Stockholm',      href: '?osmrelation=54391',                                code: 'OSM Relation' },
          { label: 'Manhattan',      href: '?place=Manhattan,%20New%20York&auto=1&grid=a&result=s', code: 'Auto pipeline' },
          { label: 'Carkfree',       href: '?place=Carkfree&auto=1&grid=a&result=s',            code: 'Auto pipeline' },
        ]
      },
    ],

    credits: {
      lines: [
        'Created and developed by <a href="https://profiles.canterbury.ac.nz/Greg-O-Beirne" target="_blank">Greg O\'Beirne</a>, <a href="b%C2%B2s%C2%B2%20bounding%20box%20shortcut%20scheme.pdf" target="_blank">2012</a>–2026.',
        '© 2026 Greg O\'Beirne. Licensed under the <a href="https://www.mozilla.org/en-US/MPL/2.0/" target="_blank">Mozilla Public License 2.0</a>.',
        '<strong>Map Data</strong> - © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors (ODbL)',
        '<strong>Geocoding</strong> - <a href="https://nominatim.org/" target="_blank">Nominatim</a> (OpenStreetMap Foundation)',
        '<strong>Boundaries</strong> - <a href="https://overpass-api.de/" target="_blank">Overpass API</a> &amp; <a href="https://www.wikidata.org/" target="_blank">Wikidata</a> SPARQL',
        '<strong>Map Library</strong> - <a href="https://leafletjs.com/" target="_blank">Leaflet</a> (BSD-2-Clause)',
        '<strong>Geodesic Maths</strong> - <a href="https://geographiclib.sourceforge.io/" target="_blank">GeographicLib</a> by Charles Karney (MIT)',
        '<strong>Music Notation</strong> - <a href="https://www.vexflow.com/" target="_blank">VexFlow</a> (MIT)',
        '<strong>SHA3-512</strong> - <a href="https://github.com/paulmillr/noble-hashes" target="_blank">@noble/hashes</a> by Paul Miller',
        '<strong>Map Tiles</strong> - <a href="https://www.openstreetmap.org/" target="_blank">OpenStreetMap</a>',
        '<strong>Palette</strong> - <a href="https://g-thomson.github.io/Manu/" target="_blank">Kererū</a> by Geoffrey Thomson',
        '<strong>BIP39 word lists</strong> from the <a href="https://github.com/bitcoin/bips/blob/master/bip-0039" target="_blank">BIP-39 specification</a>.',
		'<strong>German (DE-2048) word list</strong> - <a href="https://github.com/dys2p/wordlists-de" target="_blank">dys2p/wordlists-de</a> by <a href="https://github.com/dys2p" target="_blank">dys2p</a> (Unlicense / CC0 / BSD-3)',
        '<strong>NATO phonetic alphabet</strong> per ICAO Annex 10.',
      ]
    },
	socialImage: {
  src: 'geosonify.png',
  alt: 'geosonify!'  // ← translators replace this with their language's equivalent
}

  }; // end GEOSONIFY_FAQ

})(typeof window !== 'undefined' ? window : this);
