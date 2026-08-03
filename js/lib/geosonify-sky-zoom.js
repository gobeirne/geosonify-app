/*
  geosonify-sky-zoom.js  v0.1  — the same amount of world, either way

  THE POINT
  ---------
  Flipping between Earth and Sky should teach you the scale. It cannot do that if
  the two views show wildly different amounts: a map at street level next to a
  sky at 60 degrees says nothing about how 50 milliarcseconds relates to 50
  metres. Carry the zoom across and the flip becomes the lesson -- your suburb is
  that patch, that cell is that big.

  WHICH AXIS, AND WHY IT MUST BE THE VERTICAL
  --------------------------------------------
  The two projections cannot agree on both axes at once, so one has to be chosen,
  and only one of them is free of a fudge factor.

  Declination IS latitude -- the same number, no scaling, no cos anywhere. A
  viewport spanning 0.01 degrees of latitude and a sky field spanning 0.01
  degrees of declination cover the identical angular extent, exactly.

  The horizontal cannot do this. Right ascension is longitude numerically, but a
  degree of longitude is a degree of ANGLE only at the equator; elsewhere it is
  cos(dec) smaller on the sphere while Mercator draws it full width. Matching
  horizontally would need a factor that is right in one place and wrong
  everywhere else. So: match the vertical exactly, and let the horizontal fall
  where the projections put it. That is also the axis unaffected by the east-west
  handedness flip, which makes it the one a person can actually compare by eye.

  THE VERTICAL SPAN IS COMPUTED, NOT ASSUMED
  ------------------------------------------
  The sky renderer's fovDeg spans the SMALLER viewport dimension (scale() uses
  min(width, height)), so on a landscape map pane it is the height and on a
  portrait one it is the width. Taking fovDeg as "the vertical field" would be
  right half the time. It is derived from the projection instead:

      a point h/2 pixels above centre sits at sin(c) = (h/2) / scale
      so the half-field is asin((h/2)/scale), exactly, at any field size.

  Leaflet's side needs no such care: getBounds() reports north and south
  directly, so the latitude span is read rather than modelled -- which also means
  it is correct across Mercator's varying vertical scale without this module
  knowing anything about Mercator.
*/
(function (global) {
  'use strict';

  var VERSION = 'v0.1';
  var D2R = Math.PI / 180;
  var R2D = 180 / Math.PI;

  // The sky view refuses to go below this; matching a deep Earth zoom can ask
  // for less, and clamping silently is better than failing to switch.
  var MIN_FOV_DEG = 1e-9;

  function earthVerticalSpanDeg(map) {
    if (!map || !map.getBounds) return null;
    try {
      var b = map.getBounds();
      var span = b.getNorth() - b.getSouth();
      return (isFinite(span) && span > 0) ? span : null;
    } catch (e) { return null; }
  }

  /*
    Exact vertical half-field of an orthographic view: the declination offset
    whose projected distance from centre is h/2 pixels.

    Returns null when the top of the viewport falls off the visible hemisphere,
    which happens at very wide fields on a tall pane -- there is no vertical span
    to speak of then, and the caller should leave the other view alone.
  */
  function skyVerticalSpanDeg(renderer) {
    if (!renderer || !renderer.getSize || !renderer.getFovDeg) return null;
    var size = renderer.getSize();
    var h = size.height, w = size.width;
    if (!h || !w) return null;
    var minDim = Math.min(w, h);
    var fov = renderer.getFovDeg();
    var scale = (minDim / 2) / Math.sin(Math.max(1e-12, fov * D2R / 2));
    var s = (h / 2) / scale;
    if (s > 1) return null;                    // beyond the limb
    return 2 * Math.asin(s) * R2D;
  }

  // Inverse: the fovDeg that makes the vertical span equal spanDeg.
  function fovForVerticalSpan(renderer, spanDeg) {
    if (!renderer || !renderer.getSize) return null;
    var size = renderer.getSize();
    var h = size.height, w = size.width;
    if (!h || !w || !(spanDeg > 0)) return null;
    var minDim = Math.min(w, h);
    var s = Math.sin(Math.min(89.999, spanDeg / 2) * D2R);
    if (s <= 0) return null;
    var scale = (h / 2) / s;
    var half = Math.min(1, (minDim / 2) / scale);
    return Math.max(MIN_FOV_DEG, Math.min(180, 2 * Math.asin(half) * R2D));
  }

  /*
    EARTH -> SKY. Called when the sky view opens.
    Returns the fov applied, or null if it could not be determined.
  */
  /*
    Every transition logs its numbers.

    This crosses two projections, two renderers with different fov conventions,
    and Leaflet's zoom arithmetic -- and when it is wrong the symptom is just
    "the view looks off", with no way to tell which stage did it. One line with
    the span asked for and the span achieved makes the wrong stage obvious in a
    glance rather than a bisect.
  */
  function report(tag, obj) {
    try { console.log('[geosonify] zoom carry ' + tag, obj); } catch (e) {}
  }

  function carryEarthZoomToSky(map, renderer) {
    var span = earthVerticalSpanDeg(map);
    if (span === null) { report('earth->sky ABORT', { reason: 'no map bounds' }); return null; }
    var fov = fovForVerticalSpan(renderer, span);
    if (fov === null) { report('earth->sky ABORT', { reason: 'no renderer size', span: span }); return null; }
    try { renderer.setFovDeg(fov); } catch (e) {
      report('earth->sky ABORT', { reason: 'setFovDeg threw' }); return null;
    }
    var size = renderer.getSize ? renderer.getSize() : null;
    report('earth->sky', {
      earthLatSpanDeg: span,
      fovRequested: fov,
      fovReadBack: renderer.getFovDeg ? renderer.getFovDeg() : null,
      skyVertSpanDeg: skyVerticalSpanDeg(renderer),
      pane: size ? (size.width + 'x' + size.height) : null
    });
    return fov;
  }

  /*
    SKY -> EARTH. Called when the sky view closes.

    Leaflet's own getBoundsZoom does the Mercator arithmetic, so this hands it a
    bounds with the desired LATITUDE span and a longitude span small enough never
    to be the binding dimension -- getBoundsZoom fits the larger of the two, so a
    negligible longitude range guarantees latitude decides.
  */
  function carrySkyZoomToEarth(renderer, map, centreLat, centreLon) {
    if (!map || !map.getBoundsZoom || !map.setView || !global.L) {
      report('sky->earth ABORT', {
        reason: 'missing map API',
        hasMap: !!map, hasGetBoundsZoom: !!(map && map.getBoundsZoom),
        hasSetView: !!(map && map.setView), hasL: !!global.L
      });
      return null;
    }
    var span = skyVerticalSpanDeg(renderer);
    if (span === null) { report('sky->earth ABORT', { reason: 'no vertical span (beyond limb?)' }); return null; }

    var lat = (typeof centreLat === 'number') ? centreLat : map.getCenter().lat;
    var lon = (typeof centreLon === 'number') ? centreLon : map.getCenter().lng;
    var half = span / 2;
    // Clamp so the bounds stay inside Mercator's usable latitude range.
    var north = Math.min(85, lat + half), south = Math.max(-85, lat - half);
    if (north <= south) return null;

    try {
      var bounds = global.L.latLngBounds([south, lon - 1e-9], [north, lon + 1e-9]);
      var z = map.getBoundsZoom(bounds);
      if (!isFinite(z)) { report('sky->earth ABORT', { reason: 'getBoundsZoom NaN', span: span }); return null; }
      var before = earthVerticalSpanDeg(map);
      map.setView([lat, lon], z, { animate: false });
      report('sky->earth', {
        skyVertSpanDeg: span,
        fov: renderer.getFovDeg ? renderer.getFovDeg() : null,
        pane: renderer.getSize ? (renderer.getSize().width + 'x' + renderer.getSize().height) : null,
        zoomBefore: map.getZoom ? map.getZoom() : null,
        zoomApplied: z,
        earthSpanBefore: before,
        earthSpanAfter: earthVerticalSpanDeg(map)
      });
      return z;
    } catch (e) { report('sky->earth ABORT', { reason: String(e && e.message) }); return null; }
  }

  var API = {
    VERSION: VERSION,
    earthVerticalSpanDeg: earthVerticalSpanDeg,
    skyVerticalSpanDeg: skyVerticalSpanDeg,
    fovForVerticalSpan: fovForVerticalSpan,
    carryEarthZoomToSky: carryEarthZoomToSky,
    carrySkyZoomToEarth: carrySkyZoomToEarth
  };

  global.GeosonifySkyZoom = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  try { console.log('[geosonify] sky-zoom ' + VERSION + ' loaded'); } catch (e) {}
})(typeof window !== 'undefined' ? window : globalThis);
