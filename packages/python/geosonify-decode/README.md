# geosonify-decode (Python)

Decode [Geosonify](https://geosonify.org) links to coordinates, with no dependencies. It implements the [core profile v1](https://github.com/gobeirne/geosonify-app/blob/main/spec/CORE-PROFILE-V1.md): Base64-grid and HEALPix (`hphex`, `hp64`) points and paths in every payload form, `~~~` groups, circle, rectangle and graticule suffixes, and `lbl=`/`sty=` annotations. Obfuscated, passphrase-protected and encrypted links are outside the core profile and raise `ValueError`.

```python
from geosonify_decode import decode_link, parse_annotations

decode_link('https://geosonify.org/?b64=v-dzcFN-')
# {'point': [-43.52250516414642, 172.58110642433167]}      (latitude, longitude, WGS84)

decode_link('b64d=v-dr27bv~egtwv~RLWjLn~V-AVgf')
# {'groups': [{'pts': [[...], ...], 'modes': ['G', 'R', 'G', 'G']}]}   G geodesic, R rhumb segment

decode_link('b64=v-d0hZKV~.0DW')
# {'centre': [...], 'shape': {'type': 'circle', 'radius': 500}}
```

A point is the centre of its cell. A path's `modes[i]` is the kind of segment from vertex `i` to `i + 1`.

It is a port of the JavaScript reference decoder and passes the same vectors (`vectors.json`, generated from that decoder): `python -m unittest discover -s tests`. Licence: MPL 2.0.
