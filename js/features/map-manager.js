/**
 * geosonify-map-manager.js v1.13
 *
 * v1.13 (2026-11-08): tapping the divider's round handle turns the divider
 *   between vertical and horizontal, keeping its position (30% across becomes
 *   30% down); the handle shows ⇆ or ⇅. A touch that moves less than 6 px and
 *   lasts under 300 ms is a tap; anything else drags, and a drag now starts
 *   only once the pointer has moved, so a tap no longer nudges the divider.
 * v1.12 (2026-11-08): imageryLabel(source) is public (the compare button's
 *   title uses it).
 * v1.11 (2026-11-08): COMPARISON UNDER A SWIPE DIVIDER. setCompare(source,
 *   { swipe: 'v50' | 'h40' }) shows a second imagery in its own pane above the
 *   basemap and below the shapes, clipped to the left (top) of a draggable
 *   divider, each side labelled; getCompare() and clearCompare(). Built by the
 *   same code as setBasemap (options.target = 'compare'), so every kind of
 *   source, and the enlarging of v1.10, works on either side. Comparison
 *   requests have their own sequence (negative numbers), so neither side's
 *   late answers can cancel or replace the other's.
 * v1.10 (2026-11-08): A MAP IS SHOWN WHEREVER ITS DATA EXISTS, enlarged if need
 *   be, rather than failing. Three parts:
 *   - Tiled imagery (XYZ templates and ArcGIS tile caches) is drawn by an
 *     OverzoomTiles layer: a tile that fails to load is replaced by the
 *     matching quarter (eighth, ...) of its parent tile, up to OVERZOOM_LEVELS
 *     levels up, so zooming past a server's last level, or into a gap in a
 *     sparse cache, shows the most detailed picture there is, enlarged.
 *   - A zoom range known in advance (a WMTS 'PM_<min>_<max>' tile-matrix set,
 *     or a catalogue layer's zr from the service's scale limits) sets
 *     maxNativeZoom for every kind of layer, including WMS and ArcGIS /export,
 *     whose servers return a blank picture outside their scale range rather
 *     than an error; Leaflet then asks for the last level and enlarges it.
 *   - Below the first level the first level is shrunk (minNativeZoom) for two
 *     zoom levels (one for server-drawn layers, which redraw every request);
 *     further out nothing is drawn, which keeps the number of requests sane.
 *   v1.9's minZoom cut-off (nothing shown below the first level) is gone.
 * v1.9 (2026-11-07): an XYZ template only asks for the zoom levels its server
 *   has. A WMTS GetTile template that names a limited tile-matrix set
 *   (TILEMATRIXSET=PM_6_14, as IGN's Géoplateforme does for its historical maps)
 *   now gets its zoom range from that name (maxNativeZoom; nothing drawn
 *   below the first level), and a catalogue layer
 *   with a recorded zoom range (zr) uses it. Beyond the last level the tiles
 *   are enlarged, as Leaflet does for every source past its native zoom.
 *   Before, every zoom up to 19 was requested; a Cassini or État-major map
 *   (z6-14 / z6-15) returned nothing at street zoom, and the layer fell back.
 * v1.8 (2026-10-25): a tile layer falls back only once every tile asked for
 * has failed with nothing drawn (not after any three), and falls back to
 * options.fallback (Aerial, for a dated Aerial or a local layer), not always
 * Standard. Picking a Christchurch layer could drop to Standard when a few of
 * the first server-drawn tiles failed while the rest were still coming.
 *
 * v1.7 (2026-10-24): a fused cache in another projection whose service has
 * dynamic layers enabled and lists no picture layer (only survey outlines)
 * is declined: its exports draw those outlines, not the cached photographs.
 * (v1.7a, 2026-10-25: the "no picture layer" condition added; services
 * listing their raster draw fine and are no longer declined.)
 *
 * v1.6 (2026-10-24): services drawn by their server (MapServer /export,
 * ImageServer /exportImage) are requested tile by tile (512 px), not as one
 * image per view: panning fetches only what's newly in view, tiles appear as
 * they arrive, nothing is requested outside the coverage, and Esri Leaflet is
 * no longer needed.
 *
 * v1.5 (2026-10-24): imagery goes back to Standard only after three failed
 * requests with nothing drawn (not the first), and failures outside a curated
 * layer's coverage don't count. A link to slow-server imagery sometimes came
 * up on Standard because one early request failed while the map was still
 * moving to the shape.
 *
 * v1.4 (2026-10-24): ArcGIS image services (…/ImageServer, through
 * /exportImage) and WMS layers (any address with ?layers=<name>, optionally
 * TIME=) can be shown, so every kind of layer in the curated imagery
 * catalogue (js/lib/geosonify-imagery-catalogue.js) can be linked and pasted.
 *
 * v1.3 (2026-10-24): one layer of an ArcGIS map service (…/MapServer/<n>) can
 * be pasted or linked: it is drawn through /export with layers=show:<n>. A
 * service whose layers are all off by default (one layer per year) is
 * declined with a list of its layers rather than drawn blank.
 *
 * v1.2 (2026-10-23): 'aerial@YYYY-MM-DD' shows that day's edition of Esri
 * World Imagery (Wayback, via js/lib/geosonify-wayback.js); MapServer results
 * carry the service's own title as `label`.
 *
 * v1.1 (2026-10-23): a pasted ArcGIS …/MapServer URL is inspected (?f=json)
 * before drawing. Standard Web Mercator caches load as tiles; caches in any
 * other projection, and dynamic services, are drawn through the server's
 * /export operation (Esri Leaflet dynamicMapLayer, loaded on demand), which
 * reprojects to Web Mercator. A source now falls back to OSM only if it never
 * loads anything.
 * 
 * Leaflet map management module for Geosonify.
 * Handles map initialization, markers, layers, shape drawing, and resize controls.
 * 
 * Dependencies:
 * - Leaflet (L)
 * - geodesic (geographiclib)
 * 
 * Usage:
 *   MapManager.init({ container, center, zoom, onMapClick, onMarkerDrag });
 *   MapManager.setView([lat, lon], zoom);
 *   MapManager.updatePin(lat, lon);
 */

(function(global) {
  'use strict';

  // ============== STATE ==============
  
  let map = null;
  
  // Marker references
  let gpsPinMarker = null;      // Main draggable pin for active coordinate
  let gpsBlueMarker = null;     // Blue dot for GPS position
  let lastGPSPosition = null;   // Last known GPS position
  
  // Shape markers
  let markers = [];             // User-placed markers
  let shapeLayer = null;        // Current shape (path, polygon, rect, etc.)
  let centroidMarker = null;    // Draggable centroid marker
  let antipodeLayer = null;     // Antipode shape layer
  let startMarker = null;       // Path start indicator
  let endMarker = null;         // Path end indicator
  
  // Hierarchical grid layers
  let gridLayers = [];          // Array of grid polygon layers
  let gridLayersVisible = true;

  // HEALPix path/polygon per-vertex cell overlays (curved equal-area diamonds
  // drawn at each path vertex; separate from gridLayers so they clear together
  // with the path, not with the single-point hierarchical grid).
  let pathCellLayers = [];

  // Shape contrast colour — adapts to the basemap. Purple reads well on the
  // light OSM/topo maps but disappears on dark aerial photos, so imagery
  // basemaps switch the shape to a high-contrast yellow.
  const SHAPE_COLOR_DEFAULT = 'purple';
  const SHAPE_COLOR_IMAGERY = '#ffd400';   // vivid yellow — pops on aerial
  let _shapeColor = SHAPE_COLOR_DEFAULT;
  function getShapeColor() { return _shapeColor; }

  // Area shapes (rectangles, circles, graticules) use a distinct colour so
  // they read differently from traced paths. Blue on the light basemaps;
  // a bright cyan on aerial (blue, like purple, sinks into dark imagery)
  // chosen to stay distinct from the path yellow.
  const AREA_COLOR_DEFAULT = 'blue';
  const AREA_COLOR_IMAGERY = '#00e5ff';
  let _areaColor = AREA_COLOR_DEFAULT;
  function getAreaColor() { return _areaColor; }
  
  // Callbacks
  let callbacks = {
    onMapClick: null,
    onMarkerDrag: null,
    onMarkerDragEnd: null,
    onCentroidDrag: null,
    getCardState: null,
    getGridDefinitions: null,
    getCurrentCoord: null,
    setCurrentCoord: null,
    renderCards: null,
    updateCompactOutputs: null,
    getLastSolution: null,
    setLastSolution: null,
    showToast: null
  };

  // ============== UTILITIES ==============

  /**
   * Normalize longitude to [-180, 180]
   */
  function normalizeLongitude(lon) {
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    return lon;
  }

  /**
   * Calculate geodesic distance between two points
   */
  function geodesicDistance(p1, p2) {
    const geod = geodesic.Geodesic.WGS84;
    const result = geod.Inverse(p1[0], p1[1], p2[0], p2[1]);
    return result.s12; // meters
  }

  /**
   * Densify a path along great circles
   */
  function densifyPathGreatCircle(coords, maxSegmentKm = 10) {
    const geod = geodesic.Geodesic.WGS84;
    const result = [];
    
    for (let i = 0; i < coords.length; i++) {
      result.push(coords[i]);
      
      if (i < coords.length - 1) {
        const p1 = coords[i];
        const p2 = coords[i + 1];
        const inv = geod.Inverse(p1[0], p1[1], p2[0], p2[1]);
        const dist = inv.s12;
        
        if (dist > maxSegmentKm * 1000) {
          const steps = Math.ceil(dist / (maxSegmentKm * 1000));
          const line = geod.InverseLine(p1[0], p1[1], p2[0], p2[1]);
          
          for (let j = 1; j < steps; j++) {
            const pos = line.Position(dist * j / steps);
            result.push([pos.lat2, pos.lon2]);
          }
        }
      }
    }
    
    return result;
  }

  /**
   * Densify a closed polygon along great circles
   */
  function densifyPolygonGreatCircle(coords, maxSegmentKm = 10) {
    const geod = geodesic.Geodesic.WGS84;
    const result = [];
    const n = coords.length;
    
    for (let i = 0; i < n; i++) {
      result.push(coords[i]);
      
      const p1 = coords[i];
      const p2 = coords[(i + 1) % n];
      const inv = geod.Inverse(p1[0], p1[1], p2[0], p2[1]);
      const dist = inv.s12;
      
      if (dist > maxSegmentKm * 1000) {
        const steps = Math.ceil(dist / (maxSegmentKm * 1000));
        const line = geod.InverseLine(p1[0], p1[1], p2[0], p2[1]);
        
        for (let j = 1; j < steps; j++) {
          const pos = line.Position(dist * j / steps);
          result.push([pos.lat2, pos.lon2]);
        }
      }
    }
    
    return result;
  }

  // ============== MAP INITIALIZATION ==============

  /**
   * Initialize the Leaflet map
   */
  function initMap(options = {}) {
    const {
      container = 'mapContainerMobile',
      center = [51.505, -0.09],
      zoom = 13,
      maxZoom = 22,
      tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution = '© OpenStreetMap contributors'
    } = options;
    
    // Store callbacks
    if (options.onMapClick) callbacks.onMapClick = options.onMapClick;
    if (options.onMarkerDrag) callbacks.onMarkerDrag = options.onMarkerDrag;
    if (options.onMarkerDragEnd) callbacks.onMarkerDragEnd = options.onMarkerDragEnd;
    if (options.onCentroidDrag) callbacks.onCentroidDrag = options.onCentroidDrag;
    if (options.onBasemapChange) callbacks.onBasemapChange = options.onBasemapChange;
    if (options.getCardState) callbacks.getCardState = options.getCardState;
    if (options.getGridDefinitions) callbacks.getGridDefinitions = options.getGridDefinitions;
    if (options.getCurrentCoord) callbacks.getCurrentCoord = options.getCurrentCoord;
    if (options.setCurrentCoord) callbacks.setCurrentCoord = options.setCurrentCoord;
    if (options.renderCards) callbacks.renderCards = options.renderCards;
    if (options.updateCompactOutputs) callbacks.updateCompactOutputs = options.updateCompactOutputs;
    if (options.getLastSolution) callbacks.getLastSolution = options.getLastSolution;
    if (options.setLastSolution) callbacks.setLastSolution = options.setLastSolution;
    if (options.showToast) callbacks.showToast = options.showToast;
    
    // Create map
    map = L.map(container, { 
      zoomControl: true, 
      maxZoom: maxZoom 
    }).setView(center, zoom);
    
    // Add tile layer (tracked so it can be swapped via setBasemap)
    _basemapLayer = L.tileLayer(tileUrl, {
      attribution: attribution,
      maxNativeZoom: 19,
      maxZoom: maxZoom
    }).addTo(map);
    _basemapMaxZoom = maxZoom;
    
    // Invalidate size after init
    setTimeout(() => map.invalidateSize(), 100);
    
    console.log('[geosonify] map-manager initialized');
    return map;
  }

  // ============== BASEMAP SWITCHING ==============

  let _basemapLayer = null;
  let _basemapMaxZoom = 22;
  let _basemapSeq = 0;          // bumps on every setBasemap; late async results for an older call are dropped
  const _OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const _OSM_ATTRIB = '© OpenStreetMap contributors';

  // Named shorthands so share links can say ?basemap=aerial instead of a long
  // encoded URL. Keep keys lowercase; attribution travels with each.
  const BASEMAP_ALIASES = {
    osm: { url: _OSM_URL, attrib: _OSM_ATTRIB },
    aerial: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attrib: 'Imagery © Esri, Maxar, Earthstar Geographics'
    },
    topo: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      attrib: '© Esri — World Topographic Map'
    }
  };

  // ---- ArcGIS MapServer support -------------------------------------------
  //
  // A pasted …/MapServer URL is inspected (…/MapServer?f=json) before it is
  // drawn. Two ways to draw it:
  //   'tiles'  — the service has a fused tile cache on the standard Web
  //              Mercator tiling scheme: plain L.tileLayer on /tile/{z}/{y}/{x}
  //              (with tile size, zoom offset and native zoom range taken from
  //              the cache's levels of detail).
  //   'export' — anything else (a cache in another projection, e.g. NZTM2000
  //              EPSG:2193, or a dynamic service): the server's /export
  //              operation is asked for each map tile with bboxSR = imageSR =
  //              3857 (ExportTiles, below), so the server reprojects and the
  //              Leaflet map stays Web Mercator.
  // ArcGIS draws an export of a cached service from its cache tiles unless the
  // service has dynamic layers enabled, so cached imagery comes back as imagery.
  //
  // Security: metadata is read with fetch (CORS) only, never JSONP, because a
  // ?basemap= display link can name any server and JSONP would run that
  // server's script in this page. The export layer uses f=image, so its images
  // are plain <img> loads with no script and no CORS requirement.

  const META_TIMEOUT_MS = 10000;
  const WEB_MERCATOR_WKIDS = [3857, 102100, 102113, 900913, 3785];
  const WM_HALF = 20037508.342787;            // Web Mercator origin offset (m)
  const WM_RES0 = 156543.03392800014;         // m/px at zoom 0 for 256-px tiles

  /*
    TILED EXPORT (v1.6). An /export (MapServer) or /exportImage (ImageServer)
    request is made per 512 px map tile rather than one image per view, so:
      - panning only asks for the tiles newly in view (one big image per view
        meant nothing appeared in newly exposed areas until a slow server had
        redrawn the whole screen);
      - tiles appear as each arrives, several at once, and the browser can
        reuse them;
      - nothing is asked for outside the layer's coverage (bounds);
      - it is an ordinary Leaflet tile layer, so no helper library (Esri
        Leaflet) has to be fetched.
    urlFor(bbox [xmin, ymin, xmax, ymax] in EPSG:3857, w, h) → URL.
  */
  const EXPORT_TILE = 512;
  let ExportTiles = null;           // defined on first use, so this file never needs Leaflet at load
  const _defineExportTiles = () => ExportTiles || (ExportTiles = L.TileLayer.extend({
    initialize: function (urlFor, options) {
      this._urlFor = urlFor;
      L.TileLayer.prototype.initialize.call(this, '', options);
    },
    getTileUrl: function (coords) {
      const ts = this.getTileSize();
      const nwPx = coords.scaleBy(ts), sePx = nwPx.add(ts);
      const crs = this._map.options.crs;
      const nw = crs.project(this._map.unproject(nwPx, coords.z));
      const se = crs.project(this._map.unproject(sePx, coords.z));
      return this._urlFor([Math.min(nw.x, se.x), Math.min(nw.y, se.y), Math.max(nw.x, se.x), Math.max(nw.y, se.y)], ts.x, ts.y);
    }
  }));
  const _bbox = b => b.map(v => v.toFixed(2)).join(',');
  function _exportTileLayer(urlFor, attribution, bounds, zr) {
    const opts = Object.assign({ tileSize: EXPORT_TILE, maxZoom: _basemapMaxZoom, attribution: attribution },
                               _zoomRangeOpts(zr, 1));
    if (bounds) opts.bounds = bounds;
    return new (_defineExportTiles())(urlFor, opts);
  }

  /*
    v1.10: Leaflet options for a layer whose server has data only between
    zr[0] and zr[1] (either may be null). Past the last level the last level is
    enlarged (maxNativeZoom); below the first, the first is shrunk for
    `shrink` levels (minNativeZoom), and nothing is drawn further out.
  */
  function _zoomRangeOpts(zr, shrink) {
    const o = {};
    if (!Array.isArray(zr)) return o;
    const lo = zr[0], hi = zr[1];
    if (hi != null && hi >= 0) o.maxNativeZoom = Math.min(hi, _basemapMaxZoom);
    if (lo != null && lo > 0 && (hi == null || lo <= hi)) {
      o.minNativeZoom = lo;
      o.minZoom = Math.max(0, lo - (shrink || 0));
    }
    return o;
  }

  /*
    v1.10: tiles that fall back to their ancestors. When a tile fails, the same
    place is taken from the tile one level up (then two, ...), shown at the
    right size and offset, so a server's missing levels or gaps show its most
    detailed picture enlarged instead of nothing. Only when no ancestor within
    OVERZOOM_LEVELS loads does the tile count as failed (which is what the
    fall-back watch in _tileWatch counts).
  */
  const OVERZOOM_LEVELS = 8;
  let OverzoomTiles = null;
  const _defineOverzoomTiles = () => OverzoomTiles || (OverzoomTiles = L.TileLayer.extend({
    createTile: function (coords, done) {
      const ts = this.getTileSize();
      const tile = document.createElement('div');
      tile.style.overflow = 'hidden';
      const img = document.createElement('img');
      img.alt = '';
      img.setAttribute('role', 'presentation');
      if (this.options.crossOrigin || this.options.crossOrigin === '') {
        img.crossOrigin = this.options.crossOrigin === true ? '' : this.options.crossOrigin;
      }
      img.style.position = 'absolute';
      img.style.left = '0'; img.style.top = '0';
      img.style.width = ts.x + 'px'; img.style.height = ts.y + 'px';
      img.style.maxWidth = 'none';
      tile.appendChild(img);
      let k = 0;
      const self = this;
      const urlAt = (lev) => {
        if (lev === 0) return self.getTileUrl(coords);
        const saved = self._tileZoom;
        try {
          self._tileZoom = saved - lev;
          return self.getTileUrl({ x: coords.x >> lev, y: coords.y >> lev, z: coords.z - lev });
        } finally { self._tileZoom = saved; }
      };
      const place = (lev) => {
        const n = 1 << lev;
        img.style.width = (ts.x * n) + 'px';
        img.style.height = (ts.y * n) + 'px';
        img.style.left = (-(coords.x & (n - 1)) * ts.x) + 'px';
        img.style.top = (-(coords.y & (n - 1)) * ts.y) + 'px';
      };
      img.onload = () => done(null, tile);
      img.onerror = (e) => {
        k++;
        const zUrl = (self._tileZoom || 0) - k;
        if (k > OVERZOOM_LEVELS || zUrl < (self.options.minNativeZoom || 0)) { done(e, tile); return; }
        place(k);
        img.src = urlAt(k);
      };
      img.src = urlAt(0);
      return tile;
    }
  }));
  function _overzoomTileLayer(url, opts) {
    return new (_defineOverzoomTiles())(url, opts);
  }
  // Coverage to restrict requests to: the service's own (Web Mercator/WGS84)
  // extent, else the curated catalogue's boxes.
  function _coverBounds(planBounds, entry) {
    try {
      if (planBounds) return L.latLngBounds(planBounds).pad(0.02);
      if (entry && entry.b && entry.b.length) {
        const bb = L.latLngBounds([]);
        entry.b.forEach(b => bb.extend([[b[0], b[1]], [b[2], b[3]]]));
        return bb.isValid() ? bb.pad(0.02) : null;
      }
    } catch (e) {}
    return null;
  }

  function _escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Split a pasted MapServer URL into its service root, layer (if one layer
  // of it: …/MapServer/<n>) and token (if any). Accepts …/MapServer,
  // …/MapServer/, …/MapServer/7, …?token=… . Returns null otherwise.
  function _parseMapServerUrl(raw) {
    let u;
    try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const m = u.pathname.match(/^(.*\/MapServer)(?:\/(\d+))?\/?$/i);
    if (!m) return null;
    return { root: u.origin + m[1], layer: m[2] != null ? +m[2] : null, token: u.searchParams.get('token') || '' };
  }

  function _srWkid(sr) {
    if (!sr) return null;
    return sr.latestWkid || sr.wkid || null;
  }

  /**
   * Decide how to draw a MapServer from its ?f=json metadata. Pure function
   * (no DOM, no network) so it can be tested on its own.
   * Returns { mode:'tiles', tileSize, zoomOffset, minNativeZoom, maxNativeZoom, ... }
   *      or { mode:'export', format, ... }
   *      or { error }.
   * Common fields: wkid, attrib (plain text or ''), bounds ([[s,w],[n,e]] or null).
   */
  function _classifyMapServer(meta) {
    if (!meta || typeof meta !== 'object') {
      return { error: 'That service sent back something that isn\'t an ArcGIS service description.' };
    }
    if (meta.error) {
      const code = meta.error.code;
      if (code === 499 || code === 498 || code === 401 || code === 403) {
        return { error: 'That ArcGIS service needs a sign-in token. Add ?token=… from its owner, or use a public service.' };
      }
      return { error: 'The ArcGIS server said: ' + (meta.error.message || ('error ' + code)) + '.' };
    }

    const attrib = String(meta.copyrightText || '').trim().slice(0, 200);
    const label = String((meta.documentInfo && meta.documentInfo.Title) || meta.mapName || '').trim().slice(0, 80);
    const ti = meta.tileInfo;
    const wkid = _srWkid(ti && ti.spatialReference) || _srWkid(meta.spatialReference);
    const isWM = WEB_MERCATOR_WKIDS.indexOf(wkid) !== -1;

    // Coverage as lat/lon bounds, when the extent is in Web Mercator or WGS84.
    let bounds = null;
    const ext = meta.fullExtent;
    if (ext && isFinite(ext.xmin) && isFinite(ext.ymin) && isFinite(ext.xmax) && isFinite(ext.ymax)) {
      const ew = _srWkid(ext.spatialReference);
      if (WEB_MERCATOR_WKIDS.indexOf(ew) !== -1) {
        const toLL = (x, y) => {
          const lon = x / WM_HALF * 180;
          const lat = (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI;
          return [lat, lon];
        };
        bounds = [toLL(ext.xmin, ext.ymin), toLL(ext.xmax, ext.ymax)];
      } else if (ew === 4326) {
        bounds = [[ext.ymin, ext.xmin], [ext.ymax, ext.xmax]];
      }
      // Whole-world extents are no use as a request filter.
      if (bounds && (bounds[1][1] - bounds[0][1] >= 359)) bounds = null;
    }

    // 1. A fused cache on the standard Web Mercator scheme → plain tiles.
    if (meta.singleFusedMapCache && ti && isWM && ti.origin && Array.isArray(ti.lods) && ti.lods.length) {
      const T = ti.rows;
      const originOK = Math.abs(ti.origin.x + WM_HALF) < 1 && Math.abs(ti.origin.y - WM_HALF) < 1;
      if (originOK && ti.rows === ti.cols && (T === 256 || T === 512)) {
        let offset = null, zMin = Infinity, zMax = -Infinity, consistent = true;
        for (const lod of ti.lods) {
          const zf = Math.log2(WM_RES0 / lod.resolution);
          const z = Math.round(zf);
          if (Math.abs(zf - z) > 1e-3) { consistent = false; break; }
          const off = lod.level - z;
          if (offset === null) offset = off;
          else if (off !== offset) { consistent = false; break; }
          zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
        }
        if (consistent) {
          return {
            mode: 'tiles', wkid, attrib, label, bounds,
            tileSize: T, zoomOffset: offset,
            minNativeZoom: Math.max(0, zMin), maxNativeZoom: zMax
          };
        }
      }
    }

    // 2. A fused cache in another projection whose service has DYNAMIC LAYERS
    //    enabled: ArcGIS then draws /export from the service's source layers
    //    instead of from the cache, and when the photographs exist only in the
    //    cache (the layers being survey outlines, as in ECan's earthquake
    //    services) an export shows only those outlines. Declined until
    //    Geosonify can reproject cache tiles itself.
    //    Only when none of its layers is a picture: services that list their
    //    raster (Kāpiti, Dunedin, Indianapolis…) draw it fine dynamically.
    const svcLayers = Array.isArray(meta.layers) ? meta.layers : [];
    const typed = svcLayers.some(l => l && l.type);
    const OUTLINE = /footprint|extent|boundar|outline|index|coverage|seamline|flight|tile ?index/i;
    const noPicture = svcLayers.length > 0 && (typed
      ? !svcLayers.some(l => /raster|mosaic|image/i.test(String(l.type || '')))
      : svcLayers.every(l => (l.subLayerIds && l.subLayerIds.length) || OUTLINE.test(String(l.name || ''))));
    if (meta.singleFusedMapCache && ti && !isWM && meta.supportsDynamicLayers === true && noPicture) {
      return { error: 'That ArcGIS service keeps its photographs only as ready-made tiles in its own projection' +
        (wkid ? ' (EPSG:' + wkid + ')' : '') + '; drawn on request, it shows just the survey outlines, so it can\u2019t be lined up with this map yet.' };
    }

    // 3. Anything else is drawn through /export, which needs the Map capability.
    const caps = String(meta.capabilities || '');
    if (caps && !/(^|,)\s*Map\s*(,|$)/i.test(caps)) {
      return { error: 'That ArcGIS service only offers ready-made tiles in its own projection' +
        (wkid ? ' (EPSG:' + wkid + ')' : '') + ' and doesn\'t allow map images to be drawn on request, so it can\'t be lined up with this map.' };
    }
    const formats = String(meta.supportedImageFormatTypes || '').toUpperCase().split(',');
    const cacheFmt = String(ti && ti.format || '').toUpperCase();
    // Photographic caches as JPEG (far smaller); everything else keeps transparency.
    const format = ((cacheFmt === 'JPEG' || cacheFmt === 'JPG' || cacheFmt === 'MIXED') && formats.indexOf('JPG') !== -1)
      ? 'jpg' : 'png32';
    return { mode: 'export', wkid, attrib, label, bounds, format };
  }

  async function _fetchMapServerMeta(root, token) {
    const url = root + '?f=json' + (token ? '&token=' + encodeURIComponent(token) : '');
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), META_TIMEOUT_MS) : null;
    try {
      const r = await fetch(url, { credentials: 'omit', signal: ctrl ? ctrl.signal : undefined });
      const text = await r.text();
      try { return { meta: JSON.parse(text) }; }
      catch (e) { return { unreadable: true }; }
    } catch (e) {
      return { unreadable: true };   // network failure, timeout, or CORS refusal
    } finally {
      if (t) clearTimeout(t);
    }
  }

  /**
   * Normalise a user-supplied imagery URL.
   * - Already-templated XYZ ({z}/{x}/{y} in any order)  → { url }
   * - ArcGIS MapServer (…/MapServer[/<layer>][?token=…]) → { mapServer:{root,layer,token} }
   *   (inspected asynchronously by setBasemap)
   * - ArcGIS ImageServer or bare REST root              → { error }
   */
  function _resolveBasemapUrl(raw) {
    const url = String(raw || '').trim();
    if (!url) return { error: 'Paste an imagery URL first.' };
    // Already an XYZ template
    if (/\{z\}/.test(url) && /\{x\}/.test(url) && /\{y\}/.test(url)) {
      return { url };
    }
    const ms = _parseMapServerUrl(url);
    if (ms) return { mapServer: ms };
    const is = _parseImageServerUrl(url);
    if (is) return { imageServer: is };
    const wms = _parseWmsUrl(url);
    if (wms) return { wms };
    if (/\/arcgis\/rest\/?(services\/?)?$/i.test(url)) {
      return { error: 'That looks like an ArcGIS directory. Paste one service from it: a URL ending in /MapServer (or /MapServer/<layer>) or /ImageServer.' };
    }
    return { error: 'Unrecognised imagery URL. Use an XYZ template (with {z}/{x}/{y}), an ArcGIS service ending in /MapServer or /ImageServer, or a WMS address with ?layers=<name>.' };
  }

  // ---- ArcGIS image services and WMS (v1.4) ----------------------------------
  //
  // …/ImageServer: /exportImage per map tile in Web Mercator (the server
  // reprojects), f=image, like the MapServer export path. WMS: any address carrying ?layers=<name> (plus
  // TIME= if the layer is dated), drawn as Leaflet WMS tiles in Web Mercator.
  // Version, format and the exact Web Mercator code (EPSG:3857, or the older
  // EPSG:900913) come from the curated catalogue when the address is one of
  // its layers; otherwise WMS 1.3.0, EPSG:3857, PNG.

  function _parseImageServerUrl(raw) {
    let u;
    try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const m = u.pathname.match(/^(.*\/ImageServer)\/?$/i);
    return m ? { root: u.origin + m[1], token: u.searchParams.get('token') || '' } : null;
  }

  const WMS_RESERVED = ['service', 'request', 'version', 'layers', 'styles', 'crs', 'srs', 'bbox', 'width', 'height', 'format', 'transparent', 'time'];
  function _parseWmsUrl(raw) {
    let u;
    try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    let layers = '', time = '';
    const keep = new URLSearchParams();
    for (const [k, v] of u.searchParams) {
      const kl = k.toLowerCase();
      if (kl === 'layers') layers = v;
      else if (kl === 'time') time = v;
      else if (!WMS_RESERVED.includes(kl)) keep.append(k, v);
    }
    if (!layers || /\/MapServer\/?$/i.test(u.pathname)) return null;
    const q = keep.toString();
    return { base: u.origin + u.pathname + (q ? '?' + q : ''), layers, time, raw: String(raw).trim() };
  }

  // The catalogue entry for a URL, loading the catalogue if need be (quickly:
  // never more than 3 s; without it, defaults are used).
  async function _catalogueEntry(url) {
    const C = global.GeosonifyImageryCatalogue;
    if (!C) return null;
    if (!C.isLoaded()) {
      try { await Promise.race([C.load(), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 3000))]); }
      catch (e) { return null; }
    }
    return C.byUrl(url);
  }
  const _catAttrib = (e, fallback) => (e && e.a) ? _escapeHTML(String(e.a).slice(0, 200)) : fallback;

  async function _applyWms(w, attribution, options, seq) {
    const entry = await _catalogueEntry(w.raw);
    if (_stale(seq)) return { ok: false, stale: true };
    const cw = (entry && entry.wms) || {};
    const code = cw.crs || 'EPSG:3857';
    const crs = code === 'EPSG:3857' ? L.CRS.EPSG3857 : L.Util.extend({}, L.CRS.EPSG3857, { code: code });
    const format = cw.format || 'image/png';
    const opts = {
      layers: w.layers,
      styles: '',
      format: format,
      transparent: format === 'image/png',
      version: cw.version || '1.3.0',
      crs: crs,
      maxZoom: _basemapMaxZoom,
      attribution: attribution || _catAttrib(entry, 'Imagery © its provider')
    };
    Object.assign(opts, _zoomRangeOpts(entry && entry.zr, 1));   // v1.10
    if (w.time || cw.time) opts.TIME = w.time || cw.time;          // unknown options become WMS parameters
    const layer = L.tileLayer.wms(cw.base || w.base, opts);
    _installBasemap(layer, true, false, options, _tileWatch(layer));
    return { ok: true, mode: 'wms', url: w.raw, label: entry ? entry.r + ' ' + entry.l : '' };
  }

  async function _applyImageServer(is, attribution, options, seq) {
    const entry = await _catalogueEntry(is.root);
    if (_stale(seq)) return { ok: false, stale: true };
    const tok = is.token ? '&token=' + encodeURIComponent(is.token) : '';
    const layer = _exportTileLayer((b, w, h) => is.root + '/exportImage?bbox=' + _bbox(b) +
      '&bboxSR=3857&imageSR=3857&size=' + w + ',' + h + '&format=jpgpng&f=image' + tok,
      attribution || _catAttrib(entry, 'Imagery © its provider'), _coverBounds(null, entry), entry && entry.zr);
    _installBasemap(layer, true, false, options, _tileWatch(layer));
    return { ok: true, mode: 'image', url: is.root, label: entry ? entry.r + ' ' + entry.l : '' };
  }

  const FAIL_LIMIT = 3;     // failed requests, with nothing drawn, before going back to Standard

  // Install a new basemap layer: swap layers, fallback-on-failure, recolour.
  // `watch` wires the layer's success/failure events: it receives
  // (onLoad, onFail) and must call them as the layer reports.
  function _installBasemap(newLayer, isImagery, isOSM, options, watch) {
    // v1.11: a comparison layer goes beside the basemap, not in its place.
    if (options && options.target === 'compare') { _installCompare(newLayer); return; }
    _baseSource = (options && options._sourceUrl) || '';
    // Fallback: if the source never manages to load anything, revert to OSM
    // once. A source that has drawn at least once stays (gaps at the edge of
    // a regional cache are not a reason to throw the whole layer away).
    //
    // v1.5: one failed request is not "never loads". A link applies its imagery
    // while the map is still at its starting view, then moves to the shape (and
    // the display viewer re-fits twice more), so a slow council server can fail
    // or time out on one of those early requests and still draw fine a moment
    // later. It now takes FAIL_LIMIT failures with nothing drawn in between, and
    // a failure while the map's centre is outside a curated layer's coverage
    // doesn't count at all (no picture is expected there).
    //
    // v1.8: for tile layers it is not enough that FAIL_LIMIT tiles failed: a
    // screenful of server-drawn tiles is asked for at once, and a slow server
    // can fail a few of the first while the rest are still coming. Now it also
    // takes every tile asked for so far to have failed. And the fallback is
    // options.fallback ('aerial' for a dated Aerial or a local layer chosen from
    // the Aerial list), not always Standard; the console names a failed request.
    if (!isOSM) {
      let loadedAny = false, failed = false, fails = 0, started = 0, lastBad = '';
      const C = global.GeosonifyImageryCatalogue;
      const srcUrl = options._sourceUrl || '';
      const expectedHere = () => {
        try {
          const e = (C && C.isLoaded() && srcUrl) ? C.byUrl(srcUrl) : null;
          if (!e) return true;
          const c = map.getCenter();
          return C.covers(e, c.lat, ((c.lng + 180) % 360 + 360) % 360 - 180);
        } catch (err) { return true; }
      };
      const fallback = options.fallback || 'osm';
      watch(
        () => { loadedAny = true; fails = 0; },
        (ev) => {
          if (loadedAny || failed) return;
          if (_basemapLayer !== newLayer) return;      // already replaced
          if (!expectedHere()) return;
          try { if (ev && ev.tile && ev.tile.src) lastBad = ev.tile.src; } catch (e) {}
          if (++fails < FAIL_LIMIT) return;
          if (started && fails < started) return;      // tiles still on their way
          failed = true;
          try { console.warn('[geosonify] imagery failed ' + fails + ' times with nothing drawn: ' + (srcUrl || '(preset)') + (lastBad ? ' — e.g. ' + lastBad : '')); } catch (e) {}
          if (typeof options.onError === 'function') {
            options.onError(fallback === 'aerial'
              ? 'That imagery didn’t load — back to Aerial.'
              : 'That imagery source didn’t load — back on the standard map.', fallback);
          }
          setBasemap(fallback);
        },
        () => { started++; }
      );
    }

    newLayer.addTo(map);
    if (_basemapLayer) map.removeLayer(_basemapLayer);
    _basemapLayer = newLayer;
    _layoutCompare();                    // the basemap's label follows it

    // Adapt shape contrast colour to the basemap and recolour any live shape.
    _shapeColor = isImagery ? SHAPE_COLOR_IMAGERY : SHAPE_COLOR_DEFAULT;
    _areaColor  = isImagery ? AREA_COLOR_IMAGERY  : AREA_COLOR_DEFAULT;
    _recolourActiveShape();
    // Let the host recolour shapes it owns (index.html draws its own layers).
    if (typeof callbacks.onBasemapChange === 'function') {
      try { callbacks.onBasemapChange(_shapeColor, _areaColor); } catch (e) { /* non-fatal */ }
    }
  }

  // ---- Comparison: a second imagery under a swipe divider (v1.11) ---------
  //
  // setCompare(source, { swipe }) shows `source` (anything setBasemap accepts:
  // 'aerial', 'aerial@YYYY-MM-DD', a catalogue layer's URL, 'osm', 'topo') in
  // its own pane above the basemap and below every shape, clipped to one side
  // of a divider: the LEFT of a vertical divider ('v<percent>'), the TOP of a
  // horizontal one ('h<percent>'). The basemap shows on the other side. The
  // divider's handle can be dragged; only it takes the pointer, so panning,
  // zooming and placing points elsewhere are untouched. Each side is labelled.
  // Without a swipe the source is remembered but nothing is drawn (the
  // hold-to-flick control will use it). Releasing the handle fires
  // 'geosonify:compare' on window so links can follow.
  const COMPARE_PANE = 'gsCompare';
  let _compare = null;          // { source, swipe: { o, p } | null, layer }
  let _compareSeq = 0;
  let _baseSource = '';         // what the basemap is showing (for its label)
  let _cmpEls = null;           // { div, handle, labA, labB }
  let _cmpBound = false;

  function _parseSwipe(s) {
    const m = /^([vh])(\d{1,3}(?:\.\d+)?)?$/i.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    let p = m[2] != null ? parseFloat(m[2]) : 50;
    if (!(p >= 0)) p = 50;
    return { o: m[1].toLowerCase(), p: Math.max(0, Math.min(100, p)) };
  }
  function _swipeString(sw) {
    if (!sw) return null;
    return sw.o + String(Math.round(sw.p / 5) * 5);
  }

  function _imageryLabel(source) {
    const s = String(source || '').trim();
    const k = s.toLowerCase();
    if (!s || k === 'osm') return 'Standard map';
    if (k === 'topo') return 'Topographic';
    if (k === 'aerial') return 'Latest aerial';
    const d = /^aerial@(\d{4}-\d{2}-\d{2})$/.exec(k);
    if (d) return 'Aerial · ' + d[1];
    try {
      const C = global.GeosonifyImageryCatalogue;
      const e = (C && C.isLoaded && C.isLoaded() && C.byUrl) ? C.byUrl(s) : null;
      if (e) return String(e.l || '').replace(/\s*\(map\)\s*$/, '') + ' · ' + e.r;
    } catch (err) {}
    try { return new URL(s).host; } catch (err) { return 'Imagery'; }
  }

  function _compareCSS() {
    if (document.getElementById('gs-compare-css')) return;
    const st = document.createElement('style');
    st.id = 'gs-compare-css';
    st.textContent = [
      '.gs-swipe{position:absolute;z-index:650;touch-action:none;-webkit-user-select:none;user-select:none;}',
      '.gs-swipe.v{top:0;bottom:0;width:44px;margin-left:-22px;cursor:ew-resize;}',
      '.gs-swipe.h{left:0;right:0;height:44px;margin-top:-22px;cursor:ns-resize;}',
      '.gs-swipe .gs-line{position:absolute;background:#fff;box-shadow:0 0 3px rgba(0,0,0,.6);}',
      '.gs-swipe.v .gs-line{top:0;bottom:0;left:20px;width:4px;}',
      '.gs-swipe.h .gs-line{left:0;right:0;top:20px;height:4px;}',
      '.gs-swipe .gs-knob{position:absolute;width:36px;height:36px;border-radius:50%;background:#fff;',
      'box-shadow:0 1px 4px rgba(0,0,0,.5);color:#325756;font:600 16px/36px system-ui,sans-serif;text-align:center;}',
      '.gs-swipe.v .gs-knob{left:4px;top:50%;margin-top:-18px;}',
      '.gs-swipe.h .gs-knob{top:4px;left:50%;margin-left:-18px;}',
      '.gs-swipe-label{position:absolute;z-index:649;max-width:42%;padding:3px 8px;border-radius:10px;',
      'background:rgba(20,24,28,.72);color:#fff;font:500 12px/1.3 system-ui,sans-serif;white-space:nowrap;',
      'overflow:hidden;text-overflow:ellipsis;pointer-events:none;}'
    ].join('');
    document.head.appendChild(st);
  }

  function _ensureComparePane() {
    if (!map.getPane(COMPARE_PANE)) {
      const p = map.createPane(COMPARE_PANE);
      p.style.zIndex = 250;            // above tiles (200), below shapes (400)
      p.style.pointerEvents = 'none';
    }
    return COMPARE_PANE;
  }

  function _ensureDivider() {
    if (_cmpEls) return _cmpEls;
    _compareCSS();
    const c = map.getContainer();
    const div = L.DomUtil.create('div', 'gs-swipe', c);
    L.DomUtil.create('div', 'gs-line', div);
    const knob = L.DomUtil.create('div', 'gs-knob', div);
    const labA = L.DomUtil.create('div', 'gs-swipe-label', c);
    const labB = L.DomUtil.create('div', 'gs-swipe-label', c);
    div.setAttribute('role', 'slider');
    div.setAttribute('aria-label', 'Comparison divider');
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    let dragging = false, hadDrag = true, moved = false, t0 = 0, x0 = 0, y0 = 0, onKnob = false;
    const at = (ev) => {
      const r = c.getBoundingClientRect();
      const pt = (ev.touches && ev.touches[0]) || ev;
      if (!_compare || !_compare.swipe) return;
      const sw = _compare.swipe;
      sw.p = sw.o === 'v' ? (pt.clientX - r.left) / r.width * 100 : (pt.clientY - r.top) / r.height * 100;
      sw.p = Math.max(0, Math.min(100, sw.p));
      _layoutCompare();
    };
    const down = (ev) => {
      dragging = true; moved = false; t0 = Date.now();
      x0 = ev.clientX; y0 = ev.clientY;
      onKnob = !!(ev.target && ev.target.closest && ev.target.closest('.gs-knob'));
      hadDrag = !!(map.dragging && map.dragging.enabled());
      if (hadDrag) map.dragging.disable();
      try { if (ev.pointerId != null) div.setPointerCapture(ev.pointerId); } catch (e) {}
      L.DomEvent.preventDefault(ev); L.DomEvent.stopPropagation(ev);
    };
    const move = (ev) => {
      if (!dragging) return;
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      moved = true;
      at(ev); L.DomEvent.preventDefault(ev); L.DomEvent.stopPropagation(ev);
    };
    const up = (ev) => {
      if (!dragging) return;
      dragging = false;
      if (hadDrag && map.dragging) map.dragging.enable();
      L.DomEvent.stopPropagation(ev);
      // A tap on the handle turns the divider round.
      if (!moved && onKnob && Date.now() - t0 < 300 && _compare && _compare.swipe) {
        _compare.swipe.o = _compare.swipe.o === 'v' ? 'h' : 'v';
        _layoutCompare();
      } else if (!moved) return;
      try { global.dispatchEvent(new CustomEvent('geosonify:compare', { detail: getCompare() })); } catch (e) {}
    };
    div.addEventListener('pointerdown', down);
    div.addEventListener('pointermove', move);
    div.addEventListener('pointerup', up);
    div.addEventListener('pointercancel', up);
    knob.textContent = '\u21c6';
    _cmpEls = { div, knob, labA, labB };
    if (!_cmpBound) {
      map.on('move zoom zoomend resize viewreset', _layoutCompare);
      _cmpBound = true;
    }
    return _cmpEls;
  }

  function _removeDivider() {
    if (!_cmpEls) return;
    ['div', 'labA', 'labB'].forEach(k => { try { _cmpEls[k].remove(); } catch (e) {} });
    _cmpEls = null;
  }

  function _layoutCompare() {
    if (!map || !_compare || !_compare.swipe || !_cmpEls) return;
    const pane = map.getPane(COMPARE_PANE);
    const sw = _compare.swipe;
    const size = map.getSize();
    const nw = map.containerPointToLayerPoint([0, 0]);
    const se = map.containerPointToLayerPoint(size);
    const e = _cmpEls;
    e.div.className = 'gs-swipe ' + sw.o;
    e.knob.textContent = sw.o === 'v' ? '\u21c6' : '\u21c5';
    e.knob.title = sw.o === 'v' ? 'Tap to make the divider horizontal' : 'Tap to make the divider vertical';
    e.div.setAttribute('aria-valuenow', String(Math.round(sw.p)));
    e.labA.textContent = _imageryLabel(_compare.source);
    e.labB.textContent = _imageryLabel(_baseSource);
    if (sw.o === 'v') {
      const x = size.x * sw.p / 100;
      if (pane) pane.style.clip = 'rect(' + nw.y + 'px,' + (nw.x + x) + 'px,' + se.y + 'px,' + nw.x + 'px)';
      e.div.style.left = x + 'px'; e.div.style.top = '';
      // Labels sit low beside the divider, clear of the zoom buttons and the
      // attribution; a side too narrow for its label hides it.
      e.labA.style.cssText = 'bottom:28px;right:' + (size.x - x + 8) + 'px;left:auto;top:auto;';
      e.labB.style.cssText = 'bottom:28px;left:' + (x + 8) + 'px;right:auto;top:auto;';
      e.labA.style.display = x > 70 ? '' : 'none';
      e.labB.style.display = size.x - x > 70 ? '' : 'none';
    } else {
      const y = size.y * sw.p / 100;
      if (pane) pane.style.clip = 'rect(' + nw.y + 'px,' + se.x + 'px,' + (nw.y + y) + 'px,' + nw.x + 'px)';
      e.div.style.top = y + 'px'; e.div.style.left = '';
      e.labA.style.cssText = 'right:8px;bottom:' + (size.y - y + 8) + 'px;left:auto;top:auto;';
      e.labB.style.cssText = 'right:8px;top:' + (y + 8) + 'px;left:auto;bottom:auto;';
      e.labA.style.display = y > 40 ? '' : 'none';
      e.labB.style.display = size.y - y > 60 ? '' : 'none';
    }
  }

  function _installCompare(layer) {
    if (!_compare) return;
    layer.options.pane = _ensureComparePane();
    const old = _compare.layer;
    layer.addTo(map);
    if (old && old !== layer) { try { map.removeLayer(old); } catch (e) {} }
    _compare.layer = layer;
    _layoutCompare();
  }

  /** Show `source` beside the basemap under a swipe divider. See above. */
  function setCompare(source, opts) {
    if (!map) return { ok: false, error: 'Map not ready.' };
    const src = String(source || '').trim();
    if (!src) { clearCompare(); return { ok: true }; }
    const sw = _parseSwipe(opts && opts.swipe);
    const same = _compare && _compare.source === src && _compare.layer;
    if (!_compare) _compare = { source: src, swipe: sw, layer: null };
    _compare.swipe = sw;
    if (!sw) {
      // Remembered, not drawn (for now).
      if (_compare.layer) { try { map.removeLayer(_compare.layer); } catch (e) {} _compare.layer = null; }
      _compare.source = src;
      _removeDivider();
      return { ok: true, stored: true };
    }
    _ensureDivider();
    if (same) { _layoutCompare(); return { ok: true }; }
    _compare.source = src;
    const res = setBasemap(src, { target: 'compare' });
    _layoutCompare();
    return res;
  }

  function clearCompare() {
    _compareSeq++;
    if (_compare && _compare.layer) { try { map.removeLayer(_compare.layer); } catch (e) {} }
    _compare = null;
    _removeDivider();
    const pane = map && map.getPane(COMPARE_PANE);
    if (pane) pane.style.clip = '';
  }

  /** { source, swipe: 'v50' | 'h40' | null } or null. */
  function getCompare() {
    if (!_compare) return null;
    return { source: _compare.source, swipe: _swipeString(_compare.swipe) };
  }

  // Late results of an older request are dropped. Basemap requests carry a
  // positive sequence number, comparison requests a negative one.
  function _stale(seq) { return seq < 0 ? (-seq !== _compareSeq) : (seq !== _basemapSeq); }


  function _tileWatch(layer) {
    return (onLoad, onFail, onStart) => {
      layer.on('tileload', onLoad);
      layer.on('tileerror', onFail);
      if (onStart) layer.on('tileloadstart', onStart);
    };
  }

  async function _applyMapServer(ms, attribution, options, seq) {
    const fetched = await _fetchMapServerMeta(ms.root, ms.token);
    if (_stale(seq)) return { ok: false, stale: true };

    let plan;
    if (fetched.unreadable) {
      // The description can't be read from the browser. /export as an image
      // needs no CORS, and is right in any projection, so try that.
      plan = { mode: 'export', wkid: null, attrib: '', label: '', bounds: null, format: 'png32', blind: true };
    } else {
      plan = _classifyMapServer(fetched.meta);
      if (plan.error) return { ok: false, error: plan.error };
      const meta = fetched.meta, layers = Array.isArray(meta.layers) ? meta.layers : [];
      if (ms.layer != null) {
        // One layer of the service: always drawn through /export with
        // layers=show:<n> (a fused tile cache can't show one layer alone).
        const L = layers.find(l => l.id === ms.layer);
        if (layers.length && !L) return { ok: false, error: 'That map service has no layer ' + ms.layer + '.' };
        if (plan.mode === 'tiles') {
          const caps = String(meta.capabilities || '');
          if (caps && !/(^|,)\s*Map\s*(,|$)/i.test(caps)) return { ok: false, error: 'That service only offers its tiles, all layers together, so a single layer can\u2019t be shown.' };
          plan = Object.assign({}, plan, { mode: 'export', format: 'png32' });
        }
        plan.layerName = L && L.name;
      } else if (plan.mode === 'export' && !meta.singleFusedMapCache && layers.length && !layers.some(l => l.defaultVisibility)) {
        // A dynamic service whose layers are all switched off by default
        // (common for one layer per year) draws nothing as a whole. A cached
        // service is drawn from its cache whatever its layers say, so it is
        // not declined.
        const list = layers.filter(l => !l.subLayerIds || !l.subLayerIds.length).slice(0, 6)
          .map(l => l.id + ' (' + String(l.name || '').slice(0, 40) + ')').join(', ');
        return { ok: false, error: 'That service shows nothing until one of its layers is chosen. Paste a layer instead: the URL followed by /<number>, e.g. …/MapServer/' +
          (layers[0] && layers[0].id) + '. Layers: ' + list + (layers.length > 6 ? ', …' : '') + '.' };
      }
    }

    const attrib = attribution
      || (plan.attrib ? _escapeHTML(plan.attrib) : 'Imagery © its provider');
    const tokenQS = ms.token ? '?token=' + encodeURIComponent(ms.token) : '';

    if (plan.mode === 'tiles') {
      const tileUrl = ms.root + '/tile/{z}/{y}/{x}' + tokenQS;
      const opts = {
        attribution: attrib,
        tileSize: plan.tileSize,
        zoomOffset: plan.zoomOffset,
        minNativeZoom: plan.minNativeZoom,
        maxNativeZoom: Math.min(plan.maxNativeZoom, _basemapMaxZoom),
        maxZoom: _basemapMaxZoom
      };
      if (plan.bounds) opts.bounds = L.latLngBounds(plan.bounds).pad(0.02);
      // Below the first level of the cache, shrink it for two levels only.
      if (opts.minNativeZoom > 0) opts.minZoom = Math.max(0, opts.minNativeZoom - 2);
      const layer = _overzoomTileLayer(tileUrl, opts);
      _installBasemap(layer, true, false, options, _tileWatch(layer));
      return { ok: true, mode: 'tiles', url: tileUrl, label: plan.label };
    }

    // Export mode: tiled /export requests (see ExportTiles), f=image so each
    // tile is a plain <img> (no JSON, no output directory, no CORS needed).
    const entry = await _catalogueEntry(ms.layer != null ? ms.root + '/' + ms.layer : ms.root);
    if (_stale(seq)) return { ok: false, stale: true };
    const lyr = ms.layer != null ? '&layers=show:' + ms.layer : '';
    const layer = _exportTileLayer((b, w, h) => ms.root + '/export?bbox=' + _bbox(b) +
      '&bboxSR=3857&imageSR=3857&size=' + w + ',' + h + '&dpi=96&format=' + plan.format +
      '&transparent=true&f=image' + lyr + tokenQS.replace('?', '&'),
      attrib, _coverBounds(plan.bounds, entry), entry && entry.zr);
    _installBasemap(layer, true, false, options, _tileWatch(layer));
    return {
      ok: true, mode: 'export', url: ms.root, label: plan.layerName ? (plan.label ? plan.label + ' · ' : '') + plan.layerName : plan.label,
      note: plan.blind
        ? 'Applied. The server doesn’t let a browser read its description, so it is drawn as images on request; if nothing appears, it doesn’t allow that either.'
        : (plan.wkid && WEB_MERCATOR_WKIDS.indexOf(plan.wkid) === -1
            ? 'Applied. This service is in EPSG:' + plan.wkid + ', so its server redraws each view to fit this map.'
            : 'Applied. This service is drawn by its server, tile by tile.')
    };
  }

  // v1.9: the zoom levels an XYZ template's server actually has. A WMTS
  // GetTile template naming a limited Web Mercator tile-matrix set
  // ('PM_<min>_<max>') says so itself; otherwise a catalogue layer's recorded
  // zoom range; otherwise 0-19 as before.
  function _nativeZooms(tileUrl, sourceUrl) {
    let min = 0, max = 19;
    const m = /[?&]tilematrixset=PM_(\d{1,2})_(\d{1,2})(?:&|$)/i.exec(String(tileUrl || ''));
    if (m) { min = +m[1]; max = +m[2]; }
    else {
      try {
        const C = global.GeosonifyImageryCatalogue;
        const e = (C && C.isLoaded && C.isLoaded() && C.byUrl) ? C.byUrl(sourceUrl || tileUrl) : null;
        if (e && Array.isArray(e.zr)) {
          if (e.zr[0] != null) min = e.zr[0];
          if (e.zr[1] != null) max = e.zr[1];
        }
      } catch (err) {}
    }
    if (!(min >= 0 && max >= min && max <= 22)) { min = 0; max = 19; }
    return { min, max };
  }

  // ---- Esri World Imagery Wayback ('aerial@YYYY-MM-DD') --------------------
  // Resolved through GeosonifyWayback (js/lib/geosonify-wayback.js) to the
  // release published on that date or the latest before it. The catalogue is
  // fetched once; the current imagery stays while it loads.
  const WAYBACK_ATTRIB = 'Imagery © Esri, Maxar, Earthstar Geographics · World Imagery Wayback';

  async function _applyWayback(date, options, seq) {
    const W = global.GeosonifyWayback;
    await W.load();
    if (_stale(seq)) return { ok: false, stale: true };
    const r = W.resolve(date);
    if (!r) return { ok: false, error: 'No dated World Imagery release is available.' };
    const tileUrl = W.tileUrl(r.release);
    const layer = L.tileLayer(tileUrl, {
      attribution: WAYBACK_ATTRIB + ' ' + r.date,
      maxNativeZoom: 19,
      maxZoom: _basemapMaxZoom
    });
    _installBasemap(layer, true, false, options, _tileWatch(layer));
    return { ok: true, mode: 'wayback', url: tileUrl, date: r.date, release: r.release };
  }

  /**
   * Swap the basemap. `source` is a raw URL (XYZ template or ArcGIS MapServer
   * root), a preset name ('osm', 'aerial', 'topo'), or a dated Aerial
   * ('aerial@YYYY-MM-DD', Esri World Imagery Wayback). If the source never
   * loads, the map falls back to OSM and calls options.onError so the UI can
   * tell the user.
   * Returns { ok, url } or { ok:false, error } at once, except for a MapServer
   * URL or a dated Aerial, which return { ok:true, pending:true, promise } — the service is
   * inspected first and the current imagery stays until it is ready. The
   * promise resolves to { ok:true, mode, url, note? } or { ok:false, error }
   * (or { ok:false, stale:true } if another basemap was chosen meanwhile).
   */
  function setBasemap(source, options = {}) {
    if (!map) return { ok: false, error: 'Map not ready.' };
    options = Object.assign({}, options, { _sourceUrl: String(source || '').trim() });
    const seq = options.target === 'compare' ? -(++_compareSeq) : ++_basemapSeq;
    const attribution = options.attribution || '';

    let tileUrl, attrib, isImagery;
    let aliasKey = String(source || '').trim().toLowerCase();
    const W = global.GeosonifyWayback;
    const wbDate = W ? W.dateOf(aliasKey) : null;
    if (wbDate) {
      const promise = _applyWayback(wbDate, options, seq)
        .catch(e => ({ ok: false, error: 'The dated imagery couldn’t be set up (' + (e && e.message || e) + ').' }));
      return { ok: true, pending: true, promise };
    }
    // A dated Aerial with no Wayback module (or a malformed date): plain Aerial.
    if (/^aerial@/.test(aliasKey)) aliasKey = 'aerial';
    if (!source || BASEMAP_ALIASES[aliasKey]) {
      const alias = BASEMAP_ALIASES[aliasKey] || BASEMAP_ALIASES.osm;
      tileUrl = alias.url;
      attrib = alias.attrib;
      // osm and topo are light maps (purple reads fine); everything else is
      // treated as aerial-style imagery (switch shapes to yellow).
      isImagery = !(aliasKey === 'osm' || aliasKey === 'topo' || !source);
    } else {
      const resolved = _resolveBasemapUrl(source);
      if (resolved.error) return { ok: false, error: resolved.error };
      if (resolved.mapServer) {
        const promise = _applyMapServer(resolved.mapServer, attribution, options, seq)
          .catch(e => ({ ok: false, error: 'That map service couldn’t be set up (' + (e && e.message || e) + ').' }));
        return { ok: true, pending: true, promise };
      }
      if (resolved.imageServer) {
        const promise = _applyImageServer(resolved.imageServer, attribution, options, seq)
          .catch(e => ({ ok: false, error: 'That image service couldn’t be set up (' + (e && e.message || e) + ').' }));
        return { ok: true, pending: true, promise };
      }
      if (resolved.wms) {
        const promise = _applyWms(resolved.wms, attribution, options, seq)
          .catch(e => ({ ok: false, error: 'That WMS layer couldn’t be set up (' + (e && e.message || e) + ').' }));
        return { ok: true, pending: true, promise };
      }
      tileUrl = resolved.url;
      attrib = attribution || 'Imagery © its provider';
      isImagery = true;   // any pasted custom basemap is assumed to be imagery
    }

    const nz = _nativeZooms(tileUrl, options._sourceUrl);
    // v1.10: past the last level enlarge it; a missing tile is taken from
    // its ancestors (OverzoomTiles); below the first level shrink it for two
    // levels, then nothing.
    const newLayer = (isImagery ? _overzoomTileLayer : L.tileLayer)(tileUrl, Object.assign({
      attribution: attrib,
      maxNativeZoom: 19,
      maxZoom: _basemapMaxZoom
    }, _zoomRangeOpts([nz.min || null, nz.max], 2)));
    _installBasemap(newLayer, isImagery, tileUrl === _OSM_URL, options, _tileWatch(newLayer));
    return { ok: true, url: tileUrl };
  }

  // Recolour the currently-drawn shape/centroid to the active _shapeColor,
  // so switching basemaps updates an existing shape without a full redraw.
  function _recolourActiveShape() {
    try {
      if (shapeLayer && shapeLayer.setStyle) {
        shapeLayer.setStyle({ color: _shapeColor });
      }
      if (centroidMarker && centroidMarker.setStyle) {
        // Only circleMarker centroids have setStyle; draggable icon markers don't.
        centroidMarker.setStyle({ color: _shapeColor, fillColor: _shapeColor });
      }
    } catch (e) { /* non-fatal */ }
  }


  // ============== GPS PIN MARKER ==============

  /**
   * Update or create the main GPS pin marker
   */
  function updatePin(lat, lon, options = {}) {
    if (!map) return;
    
    const latlng = [lat, lon];
    const isTracking = options.isTracking || false;
    
    if (gpsPinMarker) {
      gpsPinMarker.setLatLng(latlng);
    } else {
      gpsPinMarker = L.marker(latlng, {
        draggable: true,
        autoPan: true,
        autoPanPadding: [50, 50],
        autoPanSpeed: 10
      }).addTo(map);
      
      // Drag start - stop tracking if active
      gpsPinMarker.on('dragstart', function() {
        if (callbacks.onMarkerDrag) {
          callbacks.onMarkerDrag('dragstart', null);
        }
      });
      
      // Drag - live update
      gpsPinMarker.on('drag', function(e) {
        const pos = e.target.getLatLng();
        const normLng = normalizeLongitude(pos.lng);
        
        if (callbacks.onMarkerDrag) {
          callbacks.onMarkerDrag('drag', { lat: pos.lat, lon: normLng });
        }
        
        // Update hierarchical grid if visible
        if (gridLayersVisible && callbacks.getCardState && callbacks.getGridDefinitions) {
          const cardState = callbacks.getCardState();
          const CARD_GRIDS = callbacks.getGridDefinitions();
          const gridKey = cardState.active;
          const iterations = cardState.iterations[gridKey] || CARD_GRIDS[gridKey]?.defaultIterations || 9;
          updateHierarchicalGrid(pos.lat, normLng, gridKey, iterations);
        }
      });
      
      // Drag end - finalize
      gpsPinMarker.on('dragend', function(e) {
        const pos = e.target.getLatLng();
        const normLng = normalizeLongitude(pos.lng);
        
        if (callbacks.onMarkerDragEnd) {
          callbacks.onMarkerDragEnd({ lat: pos.lat, lon: normLng });
        }
      });
    }
    
    // Update hierarchical grid
    if (gridLayersVisible && callbacks.getCardState && callbacks.getGridDefinitions) {
      const cardState = callbacks.getCardState();
      const CARD_GRIDS = callbacks.getGridDefinitions();
      const gridKey = cardState.active;
      const iterations = cardState.iterations[gridKey] || CARD_GRIDS[gridKey]?.defaultIterations || 9;
      updateHierarchicalGrid(lat, lon, gridKey, iterations);
    }
    
    // Pan map when tracking
    if (isTracking) {
      map.panTo(latlng);
    }
  }

  /**
   * Remove the GPS pin marker
   */
  function removePin() {
    if (gpsPinMarker && map) {
      map.removeLayer(gpsPinMarker);
      gpsPinMarker = null;
    }
  }

  // ============== GPS BLUE DOT ==============

  /**
   * Update the blue GPS position dot
   */
  function updateGPSDot(lat, lon) {
    if (!map) return;
    
    lastGPSPosition = [lat, lon];
    
    if (gpsBlueMarker) {
      gpsBlueMarker.setLatLng([lat, lon]);
    } else {
      gpsBlueMarker = L.circleMarker([lat, lon], {
        radius: 10,
        fillColor: '#007AFF',
        color: 'white',
        weight: 3,
        fillOpacity: 1,
        interactive: false
      }).addTo(map);
    }
  }

  /**
   * Remove the blue GPS dot
   */
  function removeGPSDot() {
    if (gpsBlueMarker && map) {
      map.removeLayer(gpsBlueMarker);
      gpsBlueMarker = null;
    }
    lastGPSPosition = null;
  }

  // ============== HIERARCHICAL GRID ==============

  /**
   * Draw hierarchical grid cells on the map
   */
  function updateHierarchicalGrid(lat, lon, gridKey, iterations) {
    // Clear existing grid layers
    gridLayers.forEach(layer => {
      if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    });
    gridLayers = [];
    
    if (!gridLayersVisible || !gridKey) return;
    
    const CARD_GRIDS = callbacks.getGridDefinitions ? callbacks.getGridDefinitions() : null;
    if (!CARD_GRIDS || !CARD_GRIDS[gridKey]) return;
    
    let gridConfig = CARD_GRIDS[gridKey];

    // Presentation cards (Chessboard, HEALPix Chessboard, HEALPix ChromaCoord)
    // have no cell geometry of their own: they render a SIBLING codec's code
    // (chessOf / chromaOf) as a board or swatch. The `iterations` passed in is
    // already in the sibling's terms (see _encodeCardCoordinateInternal), so we
    // resolve to the sibling's grid config here and draw ITS footprint. Without
    // this the sibling's grid:null falls through to the generic 6×6 world-subdiv
    // fallback below — drawing a ~430×620 m box for a 1.2×1.7 m HexByte cell, and
    // a microscopic 6^36-subdivision speck for a HEALPix order-36 diamond. Mirrors
    // the presentationOf() delegation card-renderer uses for precision/info/encode.
    // Chained just in case a sibling is itself a presentation (guarded).
    let _presGuard = 0;
    while (gridConfig && (gridConfig.chessOf || gridConfig.chromaOf) && _presGuard++ < 4) {
      const sibKey = gridConfig.chessOf || gridConfig.chromaOf;
      if (!CARD_GRIDS[sibKey]) break;
      gridConfig = CARD_GRIDS[sibKey];
    }

    // HEALPix-words cards (beta): iterations are WORD COUNTS. Draw the word
    // hierarchy — the cell after 1…N words (odd counts are exact half cells,
    // traced by HealpixWords), outermost faintest, innermost filled.
    if (gridConfig && gridConfig.hpwords && typeof HealpixWords !== 'undefined') {
      const n = HealpixWords.clampWords(iterations);
      const minN = Math.max(1, n - 5);
      for (let k = minN; k <= n; k++) {
        const ring = HealpixWords.ringAt(lat, lon, k, 18);
        if (!ring) continue;
        const isInnermost = (k === n);
        const opacity = isInnermost ? 0.8 : Math.max(0.05, 0.3 - (n - k) * 0.05);
        const layer = L.polygon(ring, {
          color: '#ff4444', fillColor: '#ff4444',
          weight: isInnermost ? 2 : 1, opacity,
          fillOpacity: isInnermost ? 0.15 : 0,
          interactive: false
        }).addTo(map);
        gridLayers.push(layer);
      }
      return;
    }

    // HEALPix cards: the cell boundary is a curved equal-area diamond, not a
    // lat/lon box. Draw the current order PLUS up to 5 parent orders, each at
    // decreasing prominence — the equal-area equivalent of the multi-level
    // faded grid the vocabulary cards show. cellCorners returns a closed,
    // antimeridian-unwrapped ring; draw it whole (do NOT slice to 4).
    if (gridConfig && gridConfig.healpix && typeof HealpixGrids !== 'undefined') {
      const showLevels = 6;                       // innermost + up to 5 parents
      const minOrder = Math.max(1, iterations - (showLevels - 1));
      // Outermost (faintest) first so the innermost draws on top.
      for (let ord = minOrder; ord <= iterations; ord++) {
        const ring = HealpixGrids.cellCorners(gridConfig.healpix, lat, lon, ord, 18);
        if (!ring) continue;
        const isInnermost = (ord === iterations);
        const levelFromInner = iterations - ord;
        const opacity = isInnermost ? 0.8 : Math.max(0.05, 0.3 - levelFromInner * 0.05);
        const fillOpacity = isInnermost ? 0.15 : 0;
        const weight = isInnermost ? 2 : 1;
        const layer = L.polygon(ring, {
          color: '#ff4444',
          fillColor: '#ff4444',
          weight: weight,
          opacity: opacity,
          fillOpacity: fillOpacity,
          interactive: false
        }).addTo(map);
        gridLayers.push(layer);
      }
      return;
    }

    // GIS reference cards (Plus Code, MGRS, UTM, NZTM, …) don't subdivide
    // the world uniformly, so the generic row/col model below would draw a
    // wrongly-sized box. Use the scheme's true cell footprint instead.
    if (gridConfig && gridConfig.gis && typeof GISGrids !== 'undefined') {
      const corners = GISGrids.cellCorners(gridConfig.gis, lat, lon, iterations);
      if (corners) {
        const ring = corners.slice(0, 4); // drop the repeated closing point for L.polygon
        const layer = L.polygon(ring, {
          color: '#ff4444',
          fillColor: '#ff4444',
          weight: 2,
          opacity: 0.8,
          fillOpacity: 0.15,
          interactive: false
        }).addTo(map);
        gridLayers.push(layer);
      }
      return;
    }

    const gridRows = gridConfig.grid ? gridConfig.grid.length : 6;
    const gridCols = gridConfig.grid && gridConfig.grid[0] ? gridConfig.grid[0].length : 6;
    
    // Start with world bounds
    let minLat = -90, maxLat = 90;
    let minLon = -180, maxLon = 180;
    
    // Calculate bounds for each iteration level
    const bounds = [];
    
    for (let i = 0; i < iterations; i++) {
      const latStep = (maxLat - minLat) / gridRows;
      const lonStep = (maxLon - minLon) / gridCols;
      
      const latIdx = Math.min(Math.floor((lat - minLat) / latStep), gridRows - 1);
      const lonIdx = Math.min(Math.floor((lon - minLon) / lonStep), gridCols - 1);
      
      const newMinLat = minLat + latIdx * latStep;
      const newMaxLat = newMinLat + latStep;
      const newMinLon = minLon + lonIdx * lonStep;
      const newMaxLon = newMinLon + lonStep;
      
      bounds.push({
        level: i,
        corners: [
          [newMinLat, newMinLon],
          [newMinLat, newMaxLon],
          [newMaxLat, newMaxLon],
          [newMaxLat, newMinLon]
        ]
      });
      
      minLat = newMinLat;
      maxLat = newMaxLat;
      minLon = newMinLon;
      maxLon = newMaxLon;
    }
    
    // Draw each level (outermost first)
    const showLevels = Math.min(iterations, 5);
    const startLevel = Math.max(0, iterations - showLevels);
    
    for (let i = startLevel; i < iterations; i++) {
      const b = bounds[i];
      const isInnermost = (i === iterations - 1);
      const levelFromInner = iterations - 1 - i;
      
      const opacity = isInnermost ? 0.8 : Math.max(0.05, 0.3 - levelFromInner * 0.08);
      const fillOpacity = isInnermost ? 0.15 : 0;
      const weight = isInnermost ? 2 : 1;
      
      const layer = L.polygon(b.corners, {
        color: '#ff4444',
        fillColor: '#ff4444',
        weight: weight,
        opacity: opacity,
        fillOpacity: fillOpacity,
        interactive: false
      }).addTo(map);
      
      gridLayers.push(layer);
    }
  }

  /**
   * Redraw the hierarchical grid box from the current coordinate + active card.
   * Call after the active card changes or its iteration count changes (neither
   * moves the pin, so updatePin won't fire). No-op if the grid is hidden.
   */
  function refreshHierarchicalGrid() {
    if (!gridLayersVisible) return;
    if (!callbacks.getCurrentCoord || !callbacks.getCardState || !callbacks.getGridDefinitions) return;
    const coord = callbacks.getCurrentCoord();
    const cardState = callbacks.getCardState();
    const CARD_GRIDS = callbacks.getGridDefinitions();
    if (!coord) return;
    const gridKey = cardState.active;
    const iterations = cardState.iterations[gridKey] || CARD_GRIDS[gridKey]?.defaultIterations || 9;
    updateHierarchicalGrid(coord.lat, coord.lon, gridKey, iterations);
  }

  /**
   * Toggle hierarchical grid visibility
   */
  function toggleHierarchicalGrid() {
    gridLayersVisible = !gridLayersVisible;
    
    if (gridLayersVisible) {
      refreshHierarchicalGrid();
    } else {
      gridLayers.forEach(layer => {
        if (layer && map.hasLayer(layer)) map.removeLayer(layer);
      });
      gridLayers = [];
    }
    
    return gridLayersVisible;
  }

  // ============== SHAPE DRAWING ==============

  /**
   * Clear any HEALPix per-vertex cell overlays.
   */
  function clearHealpixPathCells() {
    pathCellLayers.forEach(layer => {
      if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    });
    pathCellLayers = [];
  }

  /**
   * Overlay each path/polygon vertex's curved equal-area HEALPix cell.
   * @param {Array<Array<number>>} coords - [[lat,lon],…] path vertices
   * @param {string} healpixKey - 'hphex' | 'hpquad' | 'hp64'
   * @param {number} iterations - HEALPix order
   * Cells are drawn faintly so the connecting path/polygon stays dominant.
   */
  function drawHealpixPathCells(coords, healpixKey, iterations) {
    clearHealpixPathCells();
    if (!map || !coords || !coords.length) return;
    if (typeof HealpixGrids === 'undefined' || !HealpixGrids.cellCorners) return;
    // A closed polygon repeats its first vertex last — skip the duplicate so
    // we don't double-draw that cell.
    const n = coords.length;
    const isClosedDup = n > 2 &&
      Math.abs(coords[0][0] - coords[n-1][0]) < 1e-9 &&
      Math.abs(coords[0][1] - coords[n-1][1]) < 1e-9;
    const last = isClosedDup ? n - 1 : n;
    for (let i = 0; i < last; i++) {
      const ring = HealpixGrids.cellCorners(healpixKey, coords[i][0], coords[i][1], iterations, 14);
      if (!ring) continue;
      const layer = L.polygon(ring, {
        color: getShapeColor(),
        fillColor: getShapeColor(),
        weight: 1,
        opacity: 0.7,
        fillOpacity: 0.12,
        interactive: false
      }).addTo(map);
      pathCellLayers.push(layer);
    }
  }

  /**
   * Draw a path or polygon on the map
   */
  function drawPathPoly(coords, centroid, isClosed, options = {}) {
    const { clearPins = false, addDraggable = false, showStartEnd = false } = options;
    
    if (clearPins) {
      markers.forEach(m => map.removeLayer(m));
      markers = [];
    }
    
    if (shapeLayer) map.removeLayer(shapeLayer);
    if (antipodeLayer) { map.removeLayer(antipodeLayer); antipodeLayer = null; }
    if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
    if (endMarker) { map.removeLayer(endMarker); endMarker = null; }
    
    // Densify for great circle display
    const densified = densifyPathGreatCircle(coords);
    
    if (isClosed) {
      shapeLayer = L.polygon(densified, { 
        color: getShapeColor(), 
        weight: 2, 
        fillOpacity: 0.3 
      }).addTo(map);
    } else {
      shapeLayer = L.polyline(densified, { 
        color: getShapeColor(), 
        weight: 3 
      }).addTo(map);
    }
    
    // Add start/end markers if enabled
    if (showStartEnd && coords.length >= 2) {
      startMarker = L.circleMarker(coords[0], {
        radius: 8,
        fillColor: '#22c55e',
        color: 'white',
        weight: 2,
        fillOpacity: 1
      }).addTo(map).bindTooltip('Start', { permanent: false, direction: 'top' });
      
      const lastIdx = coords.length - 1;
      if (lastIdx > 0) {
        endMarker = L.circleMarker(coords[lastIdx], {
          radius: 8,
          fillColor: '#ef4444',
          color: 'white',
          weight: 2,
          fillOpacity: 1
        }).addTo(map).bindTooltip('End', { permanent: false, direction: 'top' });
      }
    }
    
    // Fit bounds
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [50, 50] });
    
    // Add centroid marker
    if (addDraggable) {
      addDraggableCentroid(centroid);
    } else {
      if (centroidMarker) map.removeLayer(centroidMarker);
      centroidMarker = L.circleMarker(centroid, {
        radius: 5,
        fillColor: getShapeColor(),
        color: getShapeColor(),
        fillOpacity: 1
      }).addTo(map);
    }
  }

  /**
   * Draw a graticule (lat/lon bounded rectangle) on the map
   */
  function drawGraticule(points, centroid, options = {}) {
    const { clearPins = false, addDraggable = false } = options;
    
    if (clearPins) {
      markers.forEach(m => map.removeLayer(m));
      markers = [];
    }
    
    if (shapeLayer) map.removeLayer(shapeLayer);
    if (antipodeLayer) { map.removeLayer(antipodeLayer); antipodeLayer = null; }
    
    shapeLayer = L.polygon(points, { color: 'orange', weight: 2 }).addTo(map);
    
    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [50, 50] });
    
    if (addDraggable) {
      addDraggableCentroid(centroid);
    } else {
      if (centroidMarker) map.removeLayer(centroidMarker);
      centroidMarker = L.circleMarker(centroid, {
        radius: 5,
        fillColor: 'red',
        color: 'red',
        fillOpacity: 1
      }).addTo(map);
    }
  }

  /**
   * Draw a rectangle on the map
   */
  function drawRectangle(corners, centroid, options = {}) {
    const { addDraggable = false, isAntipode = false } = options;
    
    if (!isAntipode && shapeLayer) map.removeLayer(shapeLayer);
    
    const densified = densifyPolygonGreatCircle(corners);
    const layer = L.polygon(densified, { 
      color: isAntipode ? 'gray' : 'blue', 
      fillOpacity: 0.3 
    }).addTo(map);
    
    if (isAntipode) {
      antipodeLayer = layer;
    } else {
      shapeLayer = layer;
      
      const bounds = L.latLngBounds(corners);
      map.fitBounds(bounds, { padding: [50, 50] });
      
      if (addDraggable) {
        addDraggableCentroid(centroid);
      }
    }
  }

  /**
   * Draw a circle on the map
   */
  function drawCircle(points, centroid, options = {}) {
    const { addDraggable = false, isAntipode = false } = options;
    
    if (!isAntipode && shapeLayer) map.removeLayer(shapeLayer);
    
    const layer = L.polygon(points, { 
      color: isAntipode ? 'gray' : 'blue', 
      fillOpacity: 0.3 
    }).addTo(map);
    
    if (isAntipode) {
      antipodeLayer = layer;
    } else {
      shapeLayer = layer;
      
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [50, 50] });
      
      if (addDraggable) {
        addDraggableCentroid(centroid);
      }
    }
  }

  /**
   * Add a draggable centroid marker with shape update callbacks
   */
  function addDraggableCentroid(centroid) {
    if (centroidMarker) map.removeLayer(centroidMarker);
    
    centroidMarker = L.marker(centroid, {
      draggable: true,
      autoPan: true,
      autoPanPadding: [50, 50],
      autoPanSpeed: 10
    }).addTo(map);
    
    centroidMarker.on('drag', function(event) {
      const c = event.target.getLatLng();
      const newCentroid = [c.lat, normalizeLongitude(c.lng)];
      
      if (callbacks.onCentroidDrag) {
        callbacks.onCentroidDrag(newCentroid);
      }
    });
  }

  /**
   * Update shape layer directly (for external shape updates)
   */
  function updateShapeLayer(layerType, data) {
    if (shapeLayer) map.removeLayer(shapeLayer);
    
    if (layerType === 'polygon') {
      shapeLayer = L.polygon(data, { 
        color: data.color || 'blue', 
        fillOpacity: data.fillOpacity || 0.3 
      }).addTo(map);
    } else if (layerType === 'polyline') {
      shapeLayer = L.polyline(data, { 
        color: data.color || 'purple', 
        weight: data.weight || 3 
      }).addTo(map);
    }
  }

  // ============== USER MARKERS ==============

  /**
   * Add a user marker at a location
   */
  function addMarker(lat, lon, options = {}) {
    const marker = L.marker([lat, lon], {
      draggable: options.draggable !== false,
      autoPan: true,
      autoPanPadding: [50, 50],
      autoPanSpeed: 10
    }).addTo(map);
    
    if (options.onDragEnd) {
      marker.on('dragend', options.onDragEnd);
    }
    
    markers.push(marker);
    return marker;
  }

  /**
   * Clear all user markers
   */
  function clearMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
  }

  /**
   * Get current markers as coordinate array
   */
  function getMarkerCoords() {
    return markers.map(m => {
      const pos = m.getLatLng();
      return [pos.lat, normalizeLongitude(pos.lng)];
    });
  }

  // ============== CLEAR & RESET ==============

  /**
   * Clear all shapes and markers
   */
  function clearAll() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
    
    if (shapeLayer) { map.removeLayer(shapeLayer); shapeLayer = null; }
    if (centroidMarker) { map.removeLayer(centroidMarker); centroidMarker = null; }
    if (antipodeLayer) { map.removeLayer(antipodeLayer); antipodeLayer = null; }
    if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
    if (endMarker) { map.removeLayer(endMarker); endMarker = null; }
    clearHealpixPathCells();
  }

  /**
   * Clear only shapes (keep markers)
   */
  function clearShapes() {
    if (shapeLayer) { map.removeLayer(shapeLayer); shapeLayer = null; }
    if (centroidMarker) { map.removeLayer(centroidMarker); centroidMarker = null; }
    if (antipodeLayer) { map.removeLayer(antipodeLayer); antipodeLayer = null; }
    if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
    if (endMarker) { map.removeLayer(endMarker); endMarker = null; }
    clearHealpixPathCells();
  }

  // ============== MAP RESIZE HANDLERS ==============

  /**
   * Setup vertical map resize handle
   */
  function setupResizeHandle(handleId, containerId) {
    const handle = document.getElementById(handleId);
    const mapContainer = document.getElementById(containerId);
    
    if (!handle || !mapContainer) return;
    
    let isResizing = false;
    let startY = 0;
    let startHeight = 0;
    
    // Restore saved height
    const savedHeight = localStorage.getItem('mapHeight');
    if (savedHeight) {
      const height = parseInt(savedHeight, 10);
      if (height >= 150 && height <= window.innerHeight * 0.8) {
        mapContainer.style.height = height + 'px';
        setTimeout(() => map.invalidateSize(), 50);
      }
    }
    
    function startResize(e) {
      isResizing = true;
      startY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
      startHeight = mapContainer.offsetHeight;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    }
    
    function doResize(e) {
      if (!isResizing) return;
      const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
      const delta = clientY - startY;
      const newHeight = Math.max(150, Math.min(window.innerHeight * 0.8, startHeight + delta));
      mapContainer.style.height = newHeight + 'px';
      map.invalidateSize();
    }
    
    function stopResize() {
      if (!isResizing) return;
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('mapHeight', mapContainer.offsetHeight);
    }
    
    handle.addEventListener('mousedown', startResize);
    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);
    handle.addEventListener('touchstart', startResize, { passive: false });
    document.addEventListener('touchmove', doResize, { passive: false });
    document.addEventListener('touchend', stopResize);
  }

  /**
   * Setup horizontal map resize handle (for desktop)
   */
  function setupResizeHandleH(handleId, containerId) {
    const handleH = document.getElementById(handleId);
    const mapWrapper = document.getElementById(containerId);
    
    if (!handleH || !mapWrapper) return;
    
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    
    function isDesktopLandscape() {
      return window.innerWidth >= 1024;
    }
    
    // Restore saved width
    const savedWidth = localStorage.getItem('mapWidthH');
    if (savedWidth && isDesktopLandscape()) {
      const width = parseInt(savedWidth, 10);
      const minW = 350;
      const maxW = window.innerWidth - 350;
      if (width >= minW && width <= maxW) {
        mapWrapper.style.width = width + 'px';
        setTimeout(() => { if (map) map.invalidateSize(); }, 50);
      }
    }
    
    function startResizeH(e) {
      if (!isDesktopLandscape()) return;
      isResizing = true;
      startX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
      startWidth = mapWrapper.offsetWidth;
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    }
    
    function doResizeH(e) {
      if (!isResizing) return;
      const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
      const delta = clientX - startX;
      const minW = 350;
      const maxW = window.innerWidth - 350;
      const newWidth = Math.max(minW, Math.min(maxW, startWidth + delta));
      mapWrapper.style.width = newWidth + 'px';
      if (map) map.invalidateSize();
    }
    
    function stopResizeH() {
      if (!isResizing) return;
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('mapWidthH', mapWrapper.offsetWidth);
    }
    
    handleH.addEventListener('mousedown', startResizeH);
    document.addEventListener('mousemove', doResizeH);
    document.addEventListener('mouseup', stopResizeH);
    handleH.addEventListener('touchstart', startResizeH, { passive: false });
    document.addEventListener('touchmove', doResizeH, { passive: false });
    document.addEventListener('touchend', stopResizeH);
    
    // Reset width on portrait
    window.addEventListener('resize', () => {
      if (!isDesktopLandscape()) {
        mapWrapper.style.width = '';
      }
    });
  }

  // ============== PUBLIC API ==============

  const MapManager = {
    /**
     * Initialize the map
     */
    init: initMap,

    /**
     * Get the Leaflet map instance
     */
    getMap: () => map,

    /**
     * Swap the basemap (imagery). source = raw URL or 'osm'.
     */
    setBasemap: setBasemap,
    // v1.11: comparison under a swipe divider.
    setCompare: setCompare,
    clearCompare: clearCompare,
    getCompare: getCompare,
    imageryLabel: _imageryLabel,

    /**
     * Internal, exposed for tests: decide tiles / export / error from a
     * MapServer's ?f=json description.
     */
    _classifyMapServer: _classifyMapServer,

    /**
     * Current shape contrast colour (adapts to basemap).
     */
    getShapeColor: getShapeColor,

    /**
     * Current area-shape colour — rectangles/circles/graticules (adapts to basemap).
     */
    getAreaColor: getAreaColor,

    /**
     * Set map view
     */
    setView(center, zoom, options) {
      if (map) map.setView(center, zoom, options);
    },

    /**
     * Pan to location
     */
    panTo(latlng) {
      if (map) map.panTo(latlng);
    },

    /**
     * Fit bounds
     */
    fitBounds(bounds, options) {
      if (map) map.fitBounds(bounds, options);
    },

    /**
     * Invalidate map size
     */
    invalidateSize() {
      if (map) map.invalidateSize();
    },

    // Pin management
    updatePin,
    removePin,
    
    // GPS dot
    updateGPSDot,
    removeGPSDot,
    getLastGPSPosition: () => lastGPSPosition,
    
    // Hierarchical grid
    updateHierarchicalGrid,
    refreshHierarchicalGrid,
    toggleHierarchicalGrid,
    isGridVisible: () => gridLayersVisible,
    getGridLayers: () => gridLayers.slice(),
    
    // Shape drawing
    drawPathPoly,
    drawHealpixPathCells,
    clearHealpixPathCells,
    drawGraticule,
    drawRectangle,
    drawCircle,
    addDraggableCentroid,
    updateShapeLayer,
    
    // User markers
    addMarker,
    clearMarkers,
    getMarkerCoords,
    getMarkers: () => markers,
    
    // Clear/reset
    clearAll,
    clearShapes,
    
    // Resize handlers
    setupResizeHandle,
    setupResizeHandleH,
    
    // Utilities (exposed for external use)
    normalizeLongitude,
    geodesicDistance,
    densifyPathGreatCircle,
    densifyPolygonGreatCircle,
    
    // Layer access (for advanced use)
    getShapeLayer: () => shapeLayer,
    getCentroidMarker: () => centroidMarker,
    getStartMarker: () => startMarker,
    getEndMarker: () => endMarker
  };

  // ============== EXPORT ==============

  global.MapManager = MapManager;
  
  // For backward compatibility
  global.normalizeLongitude = normalizeLongitude;

  console.log('[geosonify] map-manager v1.13 loaded');

})(typeof window !== 'undefined' ? window : this);
