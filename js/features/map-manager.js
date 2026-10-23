/**
 * geosonify-map-manager.js v1.1
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
  //              EPSG:2193, or a dynamic service): Esri Leaflet's
  //              dynamicMapLayer asks the server's /export operation for one
  //              image of the current view with bboxSR = imageSR = 3857, so the
  //              server reprojects and the Leaflet map stays Web Mercator.
  // ArcGIS draws an export of a cached service from its cache tiles unless the
  // service has dynamic layers enabled, so cached imagery comes back as imagery.
  //
  // Security: metadata is read with fetch (CORS) only, never JSONP, because a
  // ?basemap= display link can name any server and JSONP would run that
  // server's script in this page. The export layer uses f=image, so its images
  // are plain <img> loads with no script and no CORS requirement.

  const ESRI_LEAFLET_URL = 'https://unpkg.com/esri-leaflet@3.0.19/dist/esri-leaflet.js';
  const ESRI_LEAFLET_SRI = 'sha384-2EpnechKmjshAhcJgZr0/dexkJdbcRJm+qsQtCjFsfBP/u5HZmrSa9lpmD7u2t5T';
  const META_TIMEOUT_MS = 10000;
  const WEB_MERCATOR_WKIDS = [3857, 102100, 102113, 900913, 3785];
  const WM_HALF = 20037508.342787;            // Web Mercator origin offset (m)
  const WM_RES0 = 156543.03392800014;         // m/px at zoom 0 for 256-px tiles

  let _esriLoad = null;
  function _loadEsriLeaflet() {
    if (global.L && L.esri && L.esri.dynamicMapLayer) return Promise.resolve();
    if (_esriLoad) return _esriLoad;
    _esriLoad = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = ESRI_LEAFLET_URL;
      s.integrity = ESRI_LEAFLET_SRI;
      s.crossOrigin = 'anonymous';
      s.async = true;
      const t = setTimeout(() => { _esriLoad = null; reject(new Error('timeout')); }, 20000);
      s.onload = () => {
        clearTimeout(t);
        if (global.L && L.esri && L.esri.dynamicMapLayer) resolve();
        else { _esriLoad = null; reject(new Error('esri-leaflet did not register')); }
      };
      s.onerror = () => { clearTimeout(t); _esriLoad = null; reject(new Error('load failed')); };
      document.head.appendChild(s);
    });
    return _esriLoad;
  }

  function _escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Split a pasted MapServer URL into its service root and token (if any).
  // Accepts …/MapServer, …/MapServer/, …/MapServer?token=… . Returns null if
  // the URL is not a MapServer service root.
  function _parseMapServerUrl(raw) {
    let u;
    try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const m = u.pathname.match(/^(.*\/MapServer)\/?$/i);
    if (!m) return null;
    return { root: u.origin + m[1], token: u.searchParams.get('token') || '' };
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
            mode: 'tiles', wkid, attrib, bounds,
            tileSize: T, zoomOffset: offset,
            minNativeZoom: Math.max(0, zMin), maxNativeZoom: zMax
          };
        }
      }
    }

    // 2. Anything else is drawn through /export, which needs the Map capability.
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
    return { mode: 'export', wkid, attrib, bounds, format };
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
   * - ArcGIS MapServer root (…/MapServer[?token=…])     → { mapServer:{root,token} }
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
    if (/\/MapServer\/\d+\/?(\?|$)/i.test(url)) {
      return { error: 'That is one layer of an ArcGIS map service. Paste the service itself: the URL up to and including /MapServer.' };
    }
    if (/\/ImageServer\/?(\?|$)/i.test(url) || /\/arcgis\/rest\/?(services\/?)?$/i.test(url)) {
      return { error: 'That looks like an ArcGIS image service or directory. Paste a map service URL ending in /MapServer, or an XYZ template containing {z}/{x}/{y}.' };
    }
    return { error: 'Unrecognised imagery URL. Use an XYZ template (with {z}/{x}/{y}) or an ArcGIS map service URL ending in /MapServer.' };
  }

  // Install a new basemap layer: swap layers, fallback-on-failure, recolour.
  // `watch` wires the layer's success/failure events: it receives
  // (onLoad, onFail) and must call them as the layer reports.
  function _installBasemap(newLayer, isImagery, isOSM, options, watch) {
    // Fallback: if the source never manages to load anything, revert to OSM
    // once. A source that has drawn at least once stays (gaps at the edge of
    // a regional cache are not a reason to throw the whole layer away).
    if (!isOSM) {
      let loadedAny = false, failed = false;
      watch(
        () => { loadedAny = true; },
        () => {
          if (loadedAny || failed) return;
          if (_basemapLayer !== newLayer) return;      // already replaced
          failed = true;
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
      plan = { mode: 'export', wkid: null, attrib: '', bounds: null, format: 'png32', blind: true };
    } else {
      plan = _classifyMapServer(fetched.meta);
      if (plan.error) return { ok: false, error: plan.error };
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
      return { ok: true, mode: 'tiles', url: tileUrl };
    }

    // Export mode.
    try { await _loadEsriLeaflet(); }
    catch (e) {
      if (seq !== _basemapSeq) return { ok: false, stale: true };
      return { ok: false, error: 'This service needs a helper library (Esri Leaflet) that didn’t load. Check your connection and try again.' };
    }
    if (seq !== _basemapSeq) return { ok: false, stale: true };

    const layer = L.esri.dynamicMapLayer({
      url: ms.root,
      token: ms.token || undefined,
      f: 'image',              // plain <img> per view; no JSON request, no output directory
      format: plan.format,
      transparent: true,
      useCors: false,          // the image is only displayed, never read back
      pane: 'tilePane',        // below the HEALPix lattice (350) and every shape (overlayPane 400)
      position: 'back',
      attribution: attrib
    });
    _installBasemap(layer, true, false, options, (onLoad, onFail) => {
      layer.on('load', onLoad);
      layer.on('error', onFail);
    });
    return {
      ok: true, mode: 'export', url: ms.root,
      note: plan.blind
        ? 'Applied. The server doesn’t let a browser read its description, so it is drawn as images on request; if nothing appears, it doesn’t allow that either.'
        : (plan.wkid && WEB_MERCATOR_WKIDS.indexOf(plan.wkid) === -1
            ? 'Applied. This service is in EPSG:' + plan.wkid + ', so its server redraws each view to fit this map.'
            : 'Applied. This service is drawn as an image of each view.')
    };
  }

  /**
   * Swap the basemap. `source` is a raw URL (XYZ template or ArcGIS MapServer
   * root) or a preset name ('osm', 'aerial', 'topo'). If the source never
   * loads, the map falls back to OSM and calls options.onError so the UI can
   * tell the user.
   * Returns { ok, url } or { ok:false, error } at once, except for a MapServer
   * URL, which returns { ok:true, pending:true, promise } — the service is
   * inspected first and the current imagery stays until it is ready. The
   * promise resolves to { ok:true, mode, url, note? } or { ok:false, error }
   * (or { ok:false, stale:true } if another basemap was chosen meanwhile).
   */
  function setBasemap(source, options = {}) {
    if (!map) return { ok: false, error: 'Map not ready.' };
    const seq = ++_basemapSeq;
    const attribution = options.attribution || '';

    let tileUrl, attrib, isImagery;
    const aliasKey = String(source || '').trim().toLowerCase();
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

  console.log('[geosonify] map-manager v1.1 loaded');

})(typeof window !== 'undefined' ? window : this);
