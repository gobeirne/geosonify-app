# Tests

Run automatically on every push by GitHub Actions (`.github/workflows/tests.yml`); results are in the repository's **Actions** tab.

**`node tests/run-all.js`** runs every Node test: the frozen-format and core-profile reference vectors in `spec/`, the GeoJSON exporter, and the sky and Starpin self-tests. A few need test-only packages, installed (pinned) with

    npm install --no-save jsdom@24.1.3 geojson-vt@3.2.1 vt-pbf@3.1.3 @mapbox/vector-tile@1.3.1 pbf@3.3.0 geographiclib-geodesic@2.2.0

A test counts as passed only if it exits with status 0 and its last line reports a pass.

**`python tests/smoke.py`** opens the app in headless Chromium at phone size and checks that the home page renders without script errors, that every point and path vector in the core profile decodes in the app to the same place as the reference decoder, that the Wikipedia landing appears, that a route's display link shows its length, and that the introductory tour finds every control it points at. It needs `pip install playwright==1.48.0` and `python -m playwright install chromium`, and the network (the libraries load from their CDNs).

Nothing here is loaded by the site.
