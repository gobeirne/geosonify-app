/**
 * geosonify-map-manager.js v1.7
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
  function _exportTileLayer(urlFor, attribution, bounds) {
    const opts = { tileSize: EXPORT_TILE, maxZoom: _basemapMaxZoom, attribution: attribution };
    if (bounds) opts.bounds = bounds;
    return new (_defineExportTiles())(urlFor, opts);
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
    if (seq !== _basemapSeq) return { ok: false, stale: true };
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
    if (w.time || cw.time) opts.TIME = w.time || cw.time;          // unknown options become WMS parameters
    const layer = L.tileLayer.wms(cw.base || w.base, opts);
    _installBasemap(layer, true, false, options, _tileWatch(layer));
    return { ok: true, mode: 'wms', url: w.raw, label: entry ? entry.r + ' ' + entry.l : '' };
  }

  async function _applyImageServer(is, attribution, options, seq) {
    const entry = await _catalogueEntry(is.root);
    if (seq !== _basemapSeq) return { ok: false, stale: true };
    const tok = is.token ? '&token=' + encodeURIComponent(is.token) : '';
    const layer = _exportTileLayer((b, w, h) => is.root + '/exportImage?bbox=' + _bbox(b) +
      '&bboxSR=3857&imageSR=3857&size=' + w + ',' + h + '&format=jpgpng&f=image' + tok,
      attribution || _catAttrib(entry, 'Imagery © its provider'), _coverBounds(null, entry));
    _installBasemap(layer, true, false, options, _tileWatch(layer));
    return { ok: true, mode: 'image', url: is.root, label: entry ? entry.r + ' ' + entry.l : '' };
  }

  const FAIL_LIMIT = 3;     // failed requests, with nothing drawn, before going back to Standard

  // Install a new basemap layer: swap layers, fallback-on-failure, recolour.
  // `watch` wires the layer's success/failure events: it receives
  // (onLoad, onFail) and must call them as the layer reports.
  function _installBasemap(newLayer, isImagery, isOSM, options, watch) {
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
    if (!isOSM) {
      let loadedAny = false, failed = false, fails = 0;
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
      watch(
        () => { loadedAny = true; fails = 0; },
        () => {
          if (loadedAny || failed) return;
          if (_basemapLayer !== newLayer) return;      // already replaced
          if (!expectedHere()) return;
          if (++fails < FAIL_LIMIT) return;
          failed = true;
          try { console.warn('[geosonify] imagery failed ' + fails + ' times with nothing drawn: ' + (srcUrl || '(preset)')); } catch (e) {}
          if (typeof options.onError === 'function') {
            options.onError('That imagery source didn’t load — back on the standard map.');
          }
          setBasemap('osm');
        }
      );
    }

    newLayer.addTo(map);
    if (_basemapLayer) map.removeLayer(_basemapLayer);
    _basemapLayer = newLayer;

    // Adapt shape contrast colour to the basemap and recolour any live shape.
    _shapeColor = isImagery ? SHAPE_COLOR_IMAGERY : SHAPE_COLOR_DEFAULT;
    _areaColor  = isImagery ? AREA_COLOR_IMAGERY  : AREA_COLOR_DEFAULT;
    _recolourActiveShape();
    // Let the host recolour shapes it owns (index.html draws its own layers).
    if (typeof callbacks.onBasemapChange === 'function') {
      try { callbacks.onBasemapChange(_shapeColor, _areaColor); } catch (e) { /* non-fatal */ }
    }
  }

  function _tileWatch(layer) {
    return (onLoad, onFail) => {
      layer.on('tileload', onLoad);
      layer.on('tileerror', onFail);
    };
  }

  async function _applyMapServer(ms, attribution, options, seq) {
    const fetched = await _fetchMapServerMeta(ms.root, ms.token);
    if (seq !== _basemapSeq) return { ok: false, stale: true };

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
      const layer = L.tileLayer(tileUrl, opts);
      _installBasemap(layer, true, false, options, _tileWatch(layer));
      return { ok: true, mode: 'tiles', url: tileUrl, label: plan.label };
    }

    // Export mode: tiled /export requests (see ExportTiles), f=image so each
    // tile is a plain <img> (no JSON, no output directory, no CORS needed).
    const entry = await _catalogueEntry(ms.layer != null ? ms.root + '/' + ms.layer : ms.root);
    if (seq !== _basemapSeq) return { ok: false, stale: true };
    const lyr = ms.layer != null ? '&layers=show:' + ms.layer : '';
    const layer = _exportTileLayer((b, w, h) => ms.root + '/export?bbox=' + _bbox(b) +
      '&bboxSR=3857&imageSR=3857&size=' + w + ',' + h + '&dpi=96&format=' + plan.format +
      '&transparent=true&f=image' + lyr + tokenQS.replace('?', '&'),
      attrib, _coverBounds(plan.bounds, entry));
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

  // ---- Esri World Imagery Wayback ('aerial@YYYY-MM-DD') --------------------
  // Resolved through GeosonifyWayback (js/lib/geosonify-wayback.js) to the
  // release published on that date or the latest before it. The catalogue is
  // fetched once; the current imagery stays while it loads.
  const WAYBACK_ATTRIB = 'Imagery © Esri, Maxar, Earthstar Geographics · World Imagery Wayback';

  async function _applyWayback(date, options, seq) {
    const W = global.GeosonifyWayback;
    await W.load();
    if (seq !== _basemapSeq) return { ok: false, stale: true };
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
    const seq = ++_basemapSeq;
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

    const newLayer = L.tileLayer(tileUrl, {
      attribution: attrib,
      maxNativeZoom: 19,
      maxZoom: _basemapMaxZoom
    });
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

  console.log('[geosonify] map-manager v1.7 loaded');

})(typeof window !== 'undefined' ? window : this);
