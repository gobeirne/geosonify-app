# geosonify-decode (JavaScript)

Decode [Geosonify](https://geosonify.org) links to coordinates, with no dependencies. It implements the [core profile v1](https://github.com/gobeirne/geosonify-app/blob/main/spec/CORE-PROFILE-V1.md): Base64-grid and HEALPix (`hphex`, `hp64`) points and paths in every payload form, `~~~` groups, circle, rectangle and graticule suffixes, and `lbl=`/`sty=` annotations. Obfuscated, passphrase-protected and encrypted links are outside the core profile and throw.

```js
const { decodeLink, parseAnnotations } = require('geosonify-decode');

decodeLink('https://geosonify.org/?b64=v-dzcFN-');   // a whole link or just its query
// { point: [-43.52250516414642, 172.58110642433167] }      (latitude, longitude, WGS84)

decodeLink('b64d=v-dr27bv~egtwv~RLWjLn~V-AVgf');
// { groups: [{ pts: [[...], ...], modes: ['G', 'R', 'G', 'G'] }] }   G geodesic, R rhumb segment
```

A point is the centre of its cell. A path's `modes[i]` is the kind of segment from vertex `i` to `i + 1`. This file is the specification's own reference decoder; `npm test` runs its self-test and the shared vectors (`vectors.json`). Licence: MPL 2.0.
