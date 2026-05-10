/*
  faq-data.js  —  js/lib/faq-data.js
  Geosonify FAQ content — translatable data file.

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
      {
        id: 'security',
        title: 'Security & Trust',
        items: [

          {
            id: 'is-it-secure',
            q: 'Is Geosonify cryptographically secure? How can I trust it?',
            a: `<p>The honest answer is: it depends on which mode you use, and you should understand the difference clearly.</p>

<h4>The three layers — and what each one actually does</h4>

<p><strong>1. Hierarchical encoding (no passphrase)</strong></p>
<p>Without a passphrase, Geosonify codes are <em>not</em> secret. They are an open, deterministic mapping from coordinates to symbols. Anyone with the app can decode any code instantly. Think of it like a grid reference — it's a notation system, not a cipher. The code <code>thp9dahrg</code> encodes a location in the same way a postcode or what3words address does: publicly, by convention.</p>
<p>Use this when you want a compact, human-readable, grid-type-agnostic location code that you don't mind anyone decoding. The value here is interoperability and readability, not secrecy.</p>

<p><strong>2. Grid passphrase (position-dependent shuffle)</strong></p>
<p>When you add a passphrase, the encoding becomes genuinely cryptographic. At each encoding iteration, the grid is shuffled using a key derived from your passphrase combined with the sequence of cell indices chosen so far (the "chain"). The shuffle uses <strong>SHA3-512</strong> — a 512-bit output hash from the NIST-standardised Keccak family — to generate a per-cell sort key. Each cell gets its own independent SHA3-512 digest, computed from <code>passphrase | chain | cell_index</code>, and cells are sorted by these digests. This is a Fisher-Yates-style keyed permutation with a cryptographic PRF.</p>
<p>The chain makes each iteration's shuffle depend on all previous choices, so the permutation at position <em>n</em> is conditioned on positions 0 through <em>n</em>−1. This is similar in structure to a block cipher in CBC mode — each symbol encrypted depends on all preceding symbols. There is no known shortcut to recovering earlier characters without knowing later ones.</p>
<p>The entropy per iteration is log₂(grid size). For a 6×6 alphanumeric grid that's log₂(36) ≈ 5.17 bits per character. An 8-character code therefore carries roughly 41 bits of location entropy before passphrase-guessing is even considered. With a strong passphrase, brute-forcing the location from the code requires enumerating passphrases, not grid positions.</p>
<p><em>What the grid passphrase does not do:</em> it does not hide metadata. An observer can see the code exists, can see its length (and therefore approximate precision), can see which grid type it's in if they recognise the vocabulary (BIP39 words look like BIP39 words), and can make statistical guesses if they observe many codes from the same passphrase. It is a confidentiality scheme for the coordinate value, not a covert communications channel.</p>

<p><strong>3. Hard URL encryption (AES-256-GCM)</strong></p>
<p>The URL encryption layer is categorically stronger and hides everything — not just the coordinates but the grid type, number of points, path length, and any other structural metadata. It uses:</p>
<ul>
  <li><strong>PBKDF2</strong> with SHA-256, 100,000 iterations, and a random 16-byte salt for key derivation. This makes offline dictionary attacks expensive: each passphrase guess requires 100,000 SHA-256 compressions.</li>
  <li><strong>AES-256-GCM</strong> for authenticated encryption. GCM provides both confidentiality and integrity — a wrong passphrase doesn't just produce garbage, it produces a detectable authentication failure (the 128-bit GCM tag won't verify), so there is no oracle to tell an attacker they're "getting warmer."</li>
  <li>A random 12-byte IV per encryption, meaning two encryptions of identical plaintexts produce different ciphertexts.</li>
  <li>Payload padding to the nearest 32 bytes, which obscures the exact length of the plaintext and prevents an attacker from inferring the number of waypoints or precision level from ciphertext size alone.</li>
</ul>
<p>The output is a single opaque Base64url blob in the URL: <code>?enc=…</code>. Without the passphrase, the URL reveals nothing — not that it's a location, not what app generated it, not how many points it contains.</p>
<p>AES-256 with a random IV and proper key derivation is the same construction used in Signal, 1Password, and most modern TLS. There are no known practical attacks against it.</p>

<h4>The trust question: "how do I verify this?"</h4>
<p>Geosonify is a client-side web application — all the code that runs is the code you can read in your browser. There is no server involved in encoding or decoding; coordinates never leave your device unless you choose to share the code. You can:</p>
<ul>
  <li>Open DevTools → Sources and read every function involved in encryption. The key functions are <code>shuffleGridAndOrder</code> in <code>card-renderer.js</code> (grid passphrase) and <code>deriveEncryptionKey</code> / <code>encryptQueryString</code> in <code>index.html</code> (AES layer). They are unminified and commented.</li>
  <li>Verify that no network requests are made during encode/decode by watching the Network tab.</li>
  <li>Save the page locally and run it offline — it works completely disconnected from the internet.</li>
  <li>Cross-check the cryptographic primitives: SHA3-512 is from the <code>@noble/hashes</code> library (audited, widely used); AES-GCM uses the browser's native <code>crypto.subtle</code> API (WebCrypto), which is implemented in the browser engine itself, not in JavaScript.</li>
</ul>
<p>You are not trusting Geosonify's cryptographic design. You are trusting SHA3-512 (standardised by NIST as FIPS 202), AES-256-GCM (NIST FIPS 197 / SP 800-38D), PBKDF2 (NIST SP 800-132), and your browser's WebCrypto implementation — the same primitives that underpin most of the secure web.</p>

<h4>Honest limitations</h4>
<ul>
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
<p>For most operational use cases where you simply don't want a casual observer to read the location, the grid passphrase is sufficient. For high-stakes use where even the existence of structured location data should be hidden, use AES URL encryption with a strong passphrase. For public, shareable, no-secrets location codes, use no passphrase and enjoy the full interoperability between grid types.</p>`
          }

        ]
      },

      // ================================================================
      {
        id: 'obfuscation',
        title: 'Obfuscation',
        items: [

          {
            id: 'how-obfuscation-works',
            q: 'How does obfuscation work?',
            a: `<p>Obfuscation is a distinct mode from passphrase encryption, and it's important to understand what it does and doesn't do before using it.</p>
<p><strong>The short version:</strong> obfuscation makes a code look like a different valid code, without a key. It is reversible by anyone with the app. It is <em>not</em> an encryption scheme, and the UI says so explicitly. Its purpose is to remove the hierarchical pattern that makes a plain code visually guessable — without requiring a shared secret.</p>

<h4>What obfuscation actually does</h4>
<p>A plain hierarchical code like <code>thp9dahrg</code> has a subtle structural property: the first character constrains you to a large region of the world, the second narrows it, and so on. Someone who knows the grid could in principle narrow down a code's location by recognising common prefixes between nearby codes. The structure is also visually regular in a way that might flag a code as a location reference.</p>
<p>Obfuscation scrambles the characters so that no such structure is visible, while preserving the property that the code can be deterministically reversed to its original. For example: <code>thp9dahrg</code> obfuscates to <code>hw8n0s8wg</code>.</p>
<p>Here's what happens step by step:</p>
<ol>
  <li><strong>The final character is the seed.</strong> The last character — <code>g</code> — is not obfuscated. It stays in place. This is intentional and important: <code>g</code> has a fixed flat index in the grid. That index becomes the seed for everything that follows.</li>
  <li><strong>A SHA3-512 keyed shuffle is generated from that seed.</strong> The seed string is constructed from the full set of cell indices (0 through N−1) combined with the seed index. This string is hashed with SHA3-512, and if the output is too short for the grid size, the hash is extended by hashing its own output iteratively until enough bytes are available. The resulting hash is divided into N equal chunks, each chunk is parsed as a hex integer, and cells are sorted by those integers — producing a deterministic permutation of the grid's N cells. This is the same family of SHA3-512 keyed permutation used in the passphrase mode, just seeded differently.</li>
  <li><strong>Each non-final character is shifted by its distance from the end.</strong> The first 8 characters (<code>thp9dahr</code>) are looked up in the shuffled grid to get their indices. Then each one is shifted modulo N by its distance from the final character: the second-to-last shifts by 1, the third-to-last by 2, and so on. The character in position 0 (furthest from the end) shifts the most. This position-dependent shifting means the same character in two different positions produces two different output characters, which destroys the hierarchical prefix structure.</li>
  <li><strong>Shifted indices are mapped back through the shuffled grid to output symbols.</strong> The final character is appended unchanged.</li>
</ol>
<p>The result is <code>hw8n0s8wg</code>: every character except the last is different, and no prefix relationship between the obfuscated code and any other obfuscated nearby code is preserved.</p>
<p>Reversing it is exactly the same process run backwards: take the final character, regenerate the same shuffle, reverse the position-dependent shifts, and recover <code>thp9dahrg</code>.</p>

<h4>The final character is load-bearing</h4>
<p>This is the most important operational property of obfuscation: <strong>the final character must be intact for the code to be decodable.</strong> In plain hierarchical mode, you can truncate a code from the right and simply lose precision — <code>thp9dahrg</code> becomes <code>thp9dah</code> which is a valid code for a slightly less precise location. This is useful for sharing approximate locations.</p>
<p>Obfuscated codes do not have this property. The final character is the seed that the entire decode depends on. Strip it, and the shuffle used to encode the code can no longer be reconstructed. The remaining characters are meaningless — not a less-precise location, but complete noise. The code is simply broken.</p>
<p>This is a deliberate trade-off: obfuscation buys you pattern-hiding at the cost of the graceful truncation property.</p>

<h4>Obfuscation and delta encoding</h4>
<p>Obfuscation is fully compatible with delta-encoded paths. The key insight that makes this work is the same property already described: the final character of any obfuscated code is always identical to the final character of its unobfuscated counterpart, because it is never shifted. Delta codes are suffixes — they share the same final character as the full code they belong to. This means each delta can be obfuscated and de-obfuscated independently, using its own last character as the seed, without any knowledge of the full code it was derived from. In practice, delta encoding operates on raw unobfuscated codes internally, and obfuscation is applied to the first code and to each delta segment separately as a final step. The recipient reverses this: de-obfuscate each piece independently, then reconstruct the full codes from the deltas.</p>

<h4>What obfuscation doesn't do</h4>
<ul>
  <li>It doesn't require a shared key — anyone with Geosonify can decode any obfuscated code immediately.</li>
  <li>It doesn't hide the fact that a code is a Geosonify code. The length, character set, and structure are all the same.</li>
  <li>It doesn't add any bits of security. Think of it like pig latin: it's not a cipher, it's a reversible cosmetic transform. Useful for making something look less immediately readable to a casual glance, not useful against anyone who knows what they're looking at.</li>
  <li>It doesn't protect against an observer who records the code and later obtains Geosonify — obfuscation provides no forward secrecy.</li>
</ul>

<h4>When obfuscation is and isn't appropriate</h4>
<p>Obfuscation is appropriate when you want codes to not visually resemble each other even when they refer to nearby locations, when you're layering it on top of a passphrase (in which case the passphrase provides the real security and obfuscation adds additional surface scrambling), or when you want to avoid a code looking like an obvious grid reference to a casual observer who doesn't know Geosonify.</p>
<p>Obfuscation is not appropriate when you need actual confidentiality (use a passphrase, or the AES URL encryption), when you're sharing codes that may need to be truncated for precision reduction, or when you're relying on the prefix-sharing property for delta-compressed paths (delta encoding always works on the raw, un-obfuscated code internally, and obfuscation is applied per-delta separately).</p>

<table>
  <tr><th>Property</th><th>Hierarchical</th><th>Obfuscated</th></tr>
  <tr><td>Requires key to decode</td><td>✗</td><td>✗</td></tr>
  <tr><td>Visually reveals prefix structure</td><td>✓</td><td>✗</td></tr>
  <tr><td>Safely truncatable from right</td><td>✓</td><td>✗</td></tr>
  <tr><td>Provides confidentiality</td><td>✗</td><td>✗</td></tr>
  <tr><td>Compatible with delta encoding</td><td>✓</td><td>✓</td></tr>
  <tr><td>Compatible with passphrase</td><td>✓</td><td>✓</td></tr>
</table>`
          }

        ]
      },

      // ================================================================
      {
        id: 'delta',
        title: 'Delta Encoding',
        items: [

          {
            id: 'what-is-delta',
            q: 'What is delta encoding?',
            a: `<p>When you share a single location, the code is self-contained. But when you share a path or polygon — a route, a perimeter, a patrol area — you could have dozens or hundreds of points, each requiring a full code. Delta encoding is the compression scheme Geosonify uses to make multi-point shapes dramatically more compact.</p>

<h4>The core idea</h4>
<p>A full 9-character alphanumeric code like <code>91v91qsxr</code> encodes a location to roughly 2-metre precision. A nearby point — say, 66 metres away — might encode to <code>91v91qz8d</code>. These two codes share a long common prefix: <code>91v91q</code>. The only difference is the final three characters. Delta encoding exploits this: instead of transmitting the full second code, you only transmit what changed — <code>z8d</code>. The receiver, who already has the first code, can reconstruct the second by replacing the last 3 characters of <code>91v91qsxr</code> with <code>z8d</code>.</p>
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
<p>The encoder uses dynamic programming across the whole path to find the gear-run partition that minimises total encoded length, including the overhead of each gear-change header. A header costs characters, so the DP weighs whether breaking a run and changing gear saves more than the header costs. The decoder doesn't need to know any of this — it just reads whatever headers appear.</p>
<p>The encoder always tries all three formats — fixed-width, variable-width tilde-separated, and gear-change — and picks whichever produces the shortest output. For short paths or paths with inconsistent prefix lengths, simple tilde-separated variable-width deltas sometimes win over gear-change.</p>

<h4>What delta encoding doesn't do</h4>
<p>Delta encoding is <strong>lossless</strong>. Every point in the path is encoded to full precision — nothing is approximated or averaged. The first code carries the full location, and every delta reconstructs the full code for its point. Truncating a delta stream loses the trailing points but leaves the earlier ones intact and fully decodable.</p>
<p>Delta encoding is also <strong>grid-agnostic</strong>. The same gear-change mechanism works identically for alphanumeric, NATO, emoji, BIP39, or any other grid — it operates on the token-level suffix of each code, whatever those tokens happen to be. A NATO delta stream compresses by the same logic as an alphanumeric one; the tokens are longer words but the prefix-sharing property is identical.</p>

<h4>Obfuscation and delta encoding</h4>
<p>The two are fully compatible. Because each delta's final character is always identical to the final character of the full code it represents — the one character obfuscation never shifts — each delta carries its own de-obfuscation seed and can be processed independently. In practice, the encoder computes all deltas on raw unobfuscated codes, then obfuscates the first code and each delta segment separately as a final step. The receiver reverses each piece independently before reconstructing the path. The gear-change structure is applied to raw codes before obfuscation, so the gear headers themselves are never obfuscated and the decoder can always parse the stream structure.</p>

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
</table>`
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
        'Created and developed by <a href="https://profiles.canterbury.ac.nz/Greg-O-Beirne" target="_blank">Greg O\'Beirne</a>, <a href="https://gobeirne.github.io/geosonify/b%C2%B2s%C2%B2%20bounding%20box%20shortcut%20scheme.pdf" target="_blank">2012</a>–2026.',
        '<strong>Map Data</strong> — © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors (ODbL)',
        '<strong>Geocoding</strong> — <a href="https://nominatim.org/" target="_blank">Nominatim</a> (OpenStreetMap Foundation)',
        '<strong>Boundaries</strong> — <a href="https://overpass-api.de/" target="_blank">Overpass API</a> &amp; <a href="https://www.wikidata.org/" target="_blank">Wikidata</a> SPARQL',
        '<strong>Map Library</strong> — <a href="https://leafletjs.com/" target="_blank">Leaflet</a> (BSD-2-Clause)',
        '<strong>Geodesic Maths</strong> — <a href="https://geographiclib.sourceforge.io/" target="_blank">GeographicLib</a> by Charles Karney (MIT)',
        '<strong>Music Notation</strong> — <a href="https://www.vexflow.com/" target="_blank">VexFlow</a> (MIT)',
        '<strong>SHA3-512</strong> — <a href="https://github.com/paulmillr/noble-hashes" target="_blank">@noble/hashes</a> by Paul Miller',
        '<strong>Map Tiles</strong> — <a href="https://www.openstreetmap.org/" target="_blank">OpenStreetMap</a>',
        '<strong>Palette</strong> — <a href="https://g-thomson.github.io/Manu/" target="_blank">Kererū</a> by Geoffrey Thomson',
        '<strong>BIP39 word lists</strong> from the <a href="https://github.com/bitcoin/bips/blob/master/bip-0039" target="_blank">BIP-39 specification</a>.',
        '<strong>NATO phonetic alphabet</strong> per ICAO Annex 10.',
      ]
    }

  }; // end GEOSONIFY_FAQ

})(typeof window !== 'undefined' ? window : this);
