# Vendored crypto — `starpin-crypto-noble-h1.8.0-c1.3.0.js`

Self-contained browser build of the two crypto primitives Starpin's sealing
module needs, so the real app has **no runtime CDN dependency** for crypto. The
trial page (`starpin-groups-trial.html`) may still load Noble from esm.sh; the
main app loads this vendored file. Both produce byte-identical conformance
output — a useful independent packaging cross-check.

## What it exposes

Exactly one global, nothing else:

```js
window.StarpinCrypto = {
  argon2id(pw, salt, {t, m, p, dkLen}) -> Uint8Array,
  xchacha20poly1305(key, nonce, aad)   -> { encrypt(pt), decrypt(ct) },
  _vendor: { hashes: '1.8.0', ciphers: '1.3.0', bundledFor: 'starpin' }
}
```

This is the shape the sealing module's injected-primitive contract expects
(`geosonify-starpin-group.js`), identical to how the trial page and the
integration glue wrap the raw Noble functions.

## Exact dependencies (do not bump without re-freezing)

- `@noble/hashes@1.8.0`  → `argon2id`
- `@noble/ciphers@1.3.0` → `xchacha20poly1305`

These are the versions the Node oracle (`group-v1-reference.js`) and the
conformance suite were proven against. Changing either version can change sealed
bytes; treat a bump as a format change requiring fresh conformance vectors.

## How to reproduce the bundle

From the repo root, with the two deps installed at the exact versions above:

```sh
npm install @noble/hashes@1.8.0 @noble/ciphers@1.3.0
npm install --no-save esbuild@0.24        # 0.24.2 used for the committed build

./node_modules/.bin/esbuild _vendor-crypto-entry.js \
  --bundle --format=iife --global-name=__StarpinCryptoBundle \
  --minify --target=es2018 \
  --footer:js="if(typeof window!=='undefined'&&__StarpinCryptoBundle&&__StarpinCryptoBundle.default){window.StarpinCrypto=window.StarpinCrypto||__StarpinCryptoBundle.default;}" \
  --outfile=vendor/starpin-crypto-noble-h1.8.0-c1.3.0.js
```

Then prepend the licence banner (see the top of the committed file) and verify:

```sh
node scratch-vendored-crypto-check.js     # byte-equality vs oracle + surface scan
```

- Entry source: `_vendor-crypto-entry.js` (10 lines; the only hand-written input).
- esbuild version used for the committed artifact: **0.24.2**.
- Minification is safe here (no reliance on function/identifier names at runtime;
  the only external contract is the `window.StarpinCrypto` key names, set explicitly).

## Integrity

The committed artifact's SHA-256 is recorded in `vendor/SHA256SUMS`. A rebuilt
bundle may differ only by the banner/toolchain; the **crypto equivalence** is what
`scratch-vendored-crypto-check.js` guarantees, not byte-identical rebuilds.

## Licence

Both dependencies are MIT © Paul Miller. Full texts:
`LICENSE.noble-hashes-1.8.0`, `LICENSE.noble-ciphers-1.3.0`. The banner at the top
of the bundle carries the attribution inline.
