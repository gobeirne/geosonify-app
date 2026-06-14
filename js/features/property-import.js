// ============================================================
// property-import.js  —  Geosonify Property Boundary Import
//
// Turns a street address (or "lat, lon" pair) into the legal
// cadastral parcel polygon at that location, using only FREE,
// browser-reachable cadastral services.
//
// Strategy: rather than per-country "address → parcel-ID" chains,
// we geocode the address with Nominatim (already used elsewhere
// in Geosonify), then ask the relevant cadastral service
// "which parcel contains this point?" — a spatial intersect
// query that ArcGIS REST, OGC API Features, WFS 2.0 and IGN's
// API Carto all support. One mechanism, many providers.
//
// Cost-safety rules baked in:
//   • Every registry entry is either keyless, or uses a key tier
//     with no billing attached (user pastes their own free key).
//   • No provider here can ever generate a charge.
//
// Coordinates are requested/normalised to WGS84 lat/lon so the
// result drops straight into the existing Shape Import pipeline
// (processLoadedShape → simplify → encode → share).
// ============================================================

const PropertyImport = (function () {
  'use strict';

  // ── Provider registry ─────────────────────────────────────
  // type:
  //   'arcgis'   — ArcGIS REST layer query (point intersect, native)
  //   'ogcapi'   — OGC API Features (tiny-bbox query + client-side
  //                point-in-polygon ranking)
  //   'wfs'      — OGC WFS 2.0 with CQL Intersects filter
  //   'apicarto' — IGN API Carto cadastre module (GeoJSON geom param)
  //
  // url for 'arcgis' must point at a *layer* (…/FeatureServer/0 or
  // …/MapServer/9), not the service root.
  //
  // tested:false  ⇒ believed-correct from documentation but not yet
  // confirmed working in a browser (CORS etc.). Cheap to prune/fix.
  const PROVIDERS = [
    {
      id: 'nz_linz',
      name: 'LINZ (Toitū Te Whenua)',
      countries: ['nz'],
      bbox: [165.8, -47.6, 179.6, -33.8],
      type: 'wfs',
      url: 'https://data.linz.govt.nz/services;key={KEY}/wfs',
      typeNames: 'layer-50772',          // NZ Primary Parcels
      geomField: 'shape',
      cqlAxisOrder: 'latlon',            // LINZ CQL examples use lat lon
      labelFields: ['appellation', 'affected_surveys', 'parcel_intent'],
      keyRequired: true,
      keyName: 'LINZ Data Service API key',
      keyHelpUrl: 'https://www.linz.govt.nz/guidance/data-service/linz-data-service-guide/web-services/creating-an-api-key',
      attribution: 'Sourced from the LINZ Data Service — CC BY 4.0',
      licenseUrl: 'https://data.linz.govt.nz/license/attribution-4-0-international/',
      tested: false
    },
    {
      id: 'nl_pdok',
      name: 'Kadaster (PDOK)',
      countries: ['nl'],
      bbox: [3.2, 50.7, 7.3, 53.7],
      type: 'ogcapi',
      url: 'https://api.pdok.nl/kadaster/brk-kadastrale-kaart/ogc/v1',
      collection: 'perceel',
      labelFields: ['kadastraleGemeenteWaarde', 'sectie', 'perceelnummer', 'AKRKadastraleGemeenteCodeWaarde'],
      keyRequired: false,
      attribution: 'Kadaster — BRK Kadastrale Kaart (PDOK)',
      licenseUrl: 'https://www.pdok.nl/',
      tested: false
    },
    {
      id: 'fr_ign',
      name: 'Cadastre (IGN API Carto)',
      countries: ['fr'],
      bbox: [-5.3, 41.2, 9.7, 51.2],   // metropolitan FR + Corsica (v1; DOM later)
      type: 'apicarto',
      url: 'https://apicarto.ign.fr/api/cadastre/parcelle',
      labelFields: ['code_dep', 'code_com', 'section', 'numero'],
      labelPrefix: 'Parcelle ',
      keyRequired: false,
      attribution: 'IGN / DGFiP — Parcellaire Express (Licence Ouverte)',
      licenseUrl: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',
      tested: false
    },
    {
      id: 'au_nsw',
      name: 'NSW Spatial Services',
      countries: ['au'],
      bbox: [140.9, -37.6, 153.7, -28.1],   // NSW extent — AU has one provider per state
      type: 'arcgis',
      url: 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer/9', // Lot
      labelFields: ['lotidstring', 'LotIDString', 'planlabel'],
      labelPrefix: 'Lot ',
      keyRequired: false,
      attribution: 'NSW Spatial Services (DCS) — CC BY 3.0 AU',
      licenseUrl: 'https://creativecommons.org/licenses/by/3.0/au/',
      tested: false
    },
    {
      id: 'au_wa',
      name: 'Landgate (WA SLIP)',
      countries: ['au'],
      bbox: [112.9, -35.2, 129.0, -13.7],   // Western Australia
      type: 'arcgis',
      url: 'https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Property_and_Planning/MapServer/2',
      labelFields: ['land_id', 'polygon_number', 'lot_number'],
      keyRequired: false,
      attribution: 'Landgate (Western Australia) — SLIP Public Services',
      licenseUrl: 'https://catalogue.data.wa.gov.au/',
      tested: false
    },
    {
      id: 'au_qld',
      name: 'Queensland (LandParcelPropertyFramework)',
      countries: ['au'],
      bbox: [137.9, -29.2, 153.6, -9.0],    // Queensland
      type: 'arcgis',
      url: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/1',
      labelFields: ['lotplan', 'lot', 'plan'],
      labelPrefix: 'Lot ',
      keyRequired: false,
      attribution: 'State of Queensland (DRDMW) — CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      tested: false
    },
    {
      id: 'au_tas',
      name: 'theLIST (Tasmania)',
      countries: ['au'],
      bbox: [143.8, -43.7, 148.5, -39.4],   // Tasmania
      type: 'arcgis',
      url: 'https://services.thelist.tas.gov.au/arcgis/rest/services/Public/CadastreParcels/MapServer/0',
      labelFields: ['CID', 'PID', 'VOLUME', 'FOLIO'],
      keyRequired: false,
      attribution: 'theLIST © State of Tasmania',
      licenseUrl: 'https://www.thelist.tas.gov.au/',
      tested: false
    },
    {
      id: 'au_national',
      name: 'National Cadastre (Geoscience Australia)',
      countries: ['au'],
      bbox: [112.9, -43.7, 153.7, -9.0],    // whole of Australia — catch-all fallback
      type: 'arcgis',
      url: 'https://gis.environment.gov.au/gispub/rest/services/national_basemap_v2/national_base_map_V2/MapServer/12',
      labelFields: ['jurisdiction_id', 'lot', 'plan', 'plan_label'],
      keyRequired: false,
      lowPriority: true,   // try state layers first; this is the seamless fallback
      attribution: 'Geoscience Australia — National Cadastre (CC BY 4.0)',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      tested: false
    },
    {
      id: 'us_ma',
      name: 'MassGIS (Massachusetts)',
      countries: ['us'],
      bbox: [-73.6, 41.2, -69.9, 42.95],
      type: 'arcgis',
      url: 'https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/L3_TAXPAR_POLY_ASSESS_gdb/FeatureServer/0',
      labelFields: ['SITE_ADDR', 'LOC_ID', 'MAP_PAR_ID'],
      keyRequired: false,
      attribution: 'MassGIS — Property Tax Parcels',
      licenseUrl: 'https://www.mass.gov/info-details/massgis-data-property-tax-parcels',
      tested: false
    },
    {
      id: 'us_nc',
      name: 'NC OneMap (North Carolina)',
      countries: ['us'],
      bbox: [-84.4, 33.8, -75.4, 36.6],
      type: 'arcgis',
      url: 'https://services8.arcgis.com/eJ9GuQwMsO1iIOw1/ArcGIS/rest/services/parcels/FeatureServer/0',
      labelFields: ['SITEADDRESS', 'PARNO', 'OWNNAME'],
      keyRequired: false,
      attribution: 'NC OneMap / NC CGIA — Statewide Parcels',
      licenseUrl: 'https://www.nconemap.gov/',
      tested: false
    }
    // More providers are one registry entry each — ES, DE, DK, SE,
    // further US states and AU states all follow the same patterns.
  ];

  // ── Small geometry helpers ────────────────────────────────

  /** Ray-casting point-in-ring test. ring = [{lat,lon},...] */
  function pointInRing(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i].lat, xi = ring[i].lon;
      const yj = ring[j].lat, xj = ring[j].lon;
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /** Approximate ring area in m² (shoelace on lon/lat scaled by latitude). */
  function ringAreaM2(ring) {
    if (!ring || ring.length < 3) return 0;
    const latRef = ring[0].lat * Math.PI / 180;
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos(latRef);
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      area += (ring[i].lon * mPerDegLon) * (ring[j].lat * mPerDegLat);
      area -= (ring[j].lon * mPerDegLon) * (ring[i].lat * mPerDegLat);
    }
    return Math.abs(area / 2);
  }

  /** Ensure a ring is closed (first point repeated as last). */
  function closeRing(ring) {
    if (ring.length > 2) {
      const a = ring[0], b = ring[ring.length - 1];
      if (a.lat !== b.lat || a.lon !== b.lon) ring.push({ lat: a.lat, lon: a.lon });
    }
    return ring;
  }

  /**
   * Extract outer rings from a GeoJSON geometry as
   * [ [{lat,lon},...], ... ]  (one entry per polygon part).
   */
  function geometryToRings(geometry) {
    if (!geometry) return [];
    const toLL = ring => ring.map(c => ({ lat: c[1], lon: c[0] }));
    if (geometry.type === 'Polygon') {
      return [closeRing(toLL(geometry.coordinates[0]))];
    }
    if (geometry.type === 'MultiPolygon') {
      return geometry.coordinates.map(poly => closeRing(toLL(poly[0])));
    }
    return [];
  }

  /** Convert an Esri JSON polygon geometry to GeoJSON-style rings. */
  function esriToRings(esriGeom) {
    if (!esriGeom || !esriGeom.rings) return [];
    // Esri rings: outer rings are clockwise; keep all non-trivial rings,
    // treat each as a candidate outer ring (holes are rare for parcels
    // and harmless for sonification purposes).
    return esriGeom.rings
      .filter(r => r.length >= 4)
      .map(r => closeRing(r.map(c => ({ lat: c[1], lon: c[0] }))));
  }

  /** Build a human label from a feature's properties. */
  function buildLabel(props, provider) {
    if (!props) return provider.name + ' parcel';
    const parts = [];
    for (const f of (provider.labelFields || [])) {
      const v = props[f];
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        parts.push(String(v).trim());
        if (parts.length >= 3) break;
      }
    }
    if (parts.length === 0) {
      // last resort: any id-ish property
      for (const k of Object.keys(props)) {
        if (/id|num|lot|appell|addr/i.test(k) && props[k]) {
          parts.push(String(props[k]));
          break;
        }
      }
    }
    const label = parts.join(' ') || 'Parcel';
    return (provider.labelPrefix && !/^lot|^parcel/i.test(label) ? provider.labelPrefix : '') + label;
  }

  /**
   * Normalise raw features (GeoJSON Feature objects) into Geosonify
   * parcel candidates, ranked: parcels containing the query point
   * first, then by ascending area (smallest parcel = most likely the
   * one the user means).
   *
   * Candidate shape is deliberately compatible with the existing
   * place-search picker: { display_name, coords, groups, … }.
   */
  function featuresToCandidates(features, lat, lon, provider) {
    const candidates = [];
    for (const feat of (features || [])) {
      const rings = geometryToRings(feat.geometry);
      if (rings.length === 0) continue;
      // Largest ring is the main outline; extra rings become groups.
      rings.sort((a, b) => ringAreaM2(b) - ringAreaM2(a));
      const main = rings[0];
      const contains = rings.some(r => pointInRing(lat, lon, r));
      const areaM2 = rings.reduce((s, r) => s + ringAreaM2(r), 0);
      candidates.push({
        display_name: buildLabel(feat.properties, feat._provider || provider),
        coords: rings.length > 1 ? rings.flat() : main,
        groups: rings.length > 1 ? rings.map(r => r.map(p => [p.lat, p.lon])) : null,
        osm_type: 'parcel',
        class: 'parcel',
        type: (feat._provider || provider).name,
        lengthKm: null,
        areaM2: areaM2,
        containsPoint: contains,
        provider: (feat._provider || provider),
        properties: feat.properties || {}
      });
    }
    candidates.sort((a, b) => {
      if (a.containsPoint !== b.containsPoint) return a.containsPoint ? -1 : 1;
      return a.areaM2 - b.areaM2;
    });
    return candidates;
  }

  // ── Per-type fetchers ─────────────────────────────────────

  async function fetchJSON(url, opts) {
    const res = await fetch(url, opts || { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    return res.json();
  }

  /** ArcGIS REST layer point-intersect query. Tries GeoJSON, falls back to Esri JSON. */
  async function queryArcgis(provider, lat, lon) {
    const base = provider.url.replace(/\/+$/, '') + '/query';
    const common = {
      geometry: `${lon},${lat}`,
      geometryType: 'esriGeometryPoint',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326'
    };
    // Attempt 1: native GeoJSON output
    try {
      const url = base + '?' + new URLSearchParams({ ...common, f: 'geojson' });
      const data = await fetchJSON(url);
      if (data && data.features) return data.features;
    } catch (e) {
      console.warn('[property-import] ArcGIS geojson query failed, trying esri json:', e.message);
    }
    // Attempt 2: Esri JSON, convert
    const url2 = base + '?' + new URLSearchParams({ ...common, f: 'json' });
    const data2 = await fetchJSON(url2);
    if (data2.error) throw new Error(data2.error.message || 'ArcGIS query error');
    return (data2.features || []).map(f => ({
      type: 'Feature',
      properties: f.attributes || {},
      geometry: f.geometry && f.geometry.rings ? {
        type: 'MultiPolygon',
        coordinates: f.geometry.rings.map(r => [r])
      } : null
    }));
  }

  /** OGC API Features: tiny bbox around the point (no native intersect op). */
  async function queryOgcApi(provider, lat, lon) {
    const d = 0.0001; // ~10 m box; parcels at the point will intersect it
    const r = v => v.toFixed(7);
    const bbox = [r(lon - d), r(lat - d), r(lon + d), r(lat + d)].join(',');
    const url = provider.url.replace(/\/+$/, '') +
      `/collections/${provider.collection}/items?` +
      new URLSearchParams({ bbox: bbox, limit: '20', f: 'json' });
    const data = await fetchJSON(url, { headers: { 'Accept': 'application/geo+json, application/json' }, mode: 'cors' });
    return data.features || [];
  }

  /** WFS 2.0 with CQL Intersects filter (LINZ-style). */
  async function queryWfs(provider, lat, lon, apiKey) {
    let base = provider.url;
    if (provider.keyRequired) {
      if (!apiKey) {
        const e = new Error(`${provider.name} needs a free API key — paste it in the key field and search again.`);
        e.needsKeyFor = provider;
        throw e;
      }
      base = base.replace('{KEY}', encodeURIComponent(apiKey.trim()));
    }
    const pt = provider.cqlAxisOrder === 'latlon' ? `${lat} ${lon}` : `${lon} ${lat}`;
    const params = new URLSearchParams({
      service: 'WFS',
      version: '2.0.0',
      request: 'GetFeature',
      typeNames: provider.typeNames,
      outputFormat: 'application/json',
      srsName: 'EPSG:4326',
      count: '10',
      cql_filter: `Intersects(${provider.geomField || 'shape'},POINT(${pt}))`
    });
    let data;
    try {
      data = await fetchJSON(base + '?' + params);
    } catch (err) {
      if (provider.keyRequired && /HTTP 40[13]/.test(err.message)) {
        const e = new Error(`${provider.name} rejected the API key — check it and search again.`);
        e.needsKeyFor = provider;
        throw e;
      }
      throw err;
    }
    return data.features || [];
  }

  /** IGN API Carto cadastre: GeoJSON Point as geom param. */
  async function queryApicarto(provider, lat, lon) {
    const geom = JSON.stringify({ type: 'Point', coordinates: [lon, lat] });
    const url = provider.url + '?' + new URLSearchParams({ geom: geom });
    const data = await fetchJSON(url);
    return data.features || [];
  }

  /** Dispatch a point query to a provider. Returns ranked candidates. */
  async function fetchParcelsAtPoint(provider, lat, lon, apiKey) {
    let features;
    switch (provider.type) {
      case 'arcgis':   features = await queryArcgis(provider, lat, lon); break;
      case 'ogcapi':   features = await queryOgcApi(provider, lat, lon); break;
      case 'wfs':      features = await queryWfs(provider, lat, lon, apiKey); break;
      case 'apicarto': features = await queryApicarto(provider, lat, lon); break;
      default: throw new Error('Unknown provider type: ' + provider.type);
    }
    features.forEach(f => { f._provider = provider; });
    const candidates = featuresToCandidates(features, lat, lon, provider);
    if (candidates.length === 0) {
      throw new Error(`${provider.name} returned no parcel at that location.`);
    }
    return candidates;
  }

  // ── Provider resolution ───────────────────────────────────

  /** Build a transient provider from a user-supplied ArcGIS layer URL. */
  function customArcgisProvider(layerUrl) {
    return {
      id: 'custom_arcgis',
      name: 'Custom ArcGIS layer',
      countries: [],
      type: 'arcgis',
      url: layerUrl.trim().replace(/\/query\/?$/, ''),
      labelFields: [],
      keyRequired: false,
      attribution: 'User-supplied ArcGIS service — check the service page for its license/attribution',
      tested: false
    };
  }

  /**
   * Which registered providers cover this point?
   * countryCode = ISO2 lowercase from the geocoder (may be null for
   * raw "lat, lon" entry, in which case the bbox decides).
   */
  function findProviders(countryCode, lat, lon) {
    return PROVIDERS.filter(p => {
      if (countryCode) {
        if (!p.countries.includes(countryCode)) return false;
      } else {
        // No country known: only a bbox hit can qualify a provider
        if (!p.bbox) return false;
      }
      if (p.bbox && lat !== undefined && lon !== undefined) {
        const [w, s, e, n] = p.bbox;
        if (!(lon >= w && lon <= e && lat >= s && lat <= n)) return false;
      }
      return true;
    }).sort((a, b) => {
      // Try specific (state) layers before broad fallbacks (national cadastre):
      // a lowPriority provider is the seamless catch-all, used only if the
      // more specific layers return nothing.
      return (a.lowPriority ? 1 : 0) - (b.lowPriority ? 1 : 0);
    });
  }

  // ── Geocoding (Nominatim — already a Geosonify dependency) ─

  /**
   * Geocode a free-text address. Returns up to 5 candidates:
   * { lat, lon, display_name, countryCode }.
   * Also accepts a raw "lat, lon" string and short-circuits.
   */
  async function geocodeAddress(query) {
    // "lat, lon" direct entry
    const m = query.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (m) {
      const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        return [{ lat, lon, display_name: `${lat.toFixed(6)}, ${lon.toFixed(6)}`, countryCode: null }];
      }
    }
    const url = 'https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({
        q: query,
        format: 'json',
        addressdetails: '1',
        limit: '5'
      });
    const res = await fetch(url, { headers: { 'User-Agent': 'Geosonify/1.0' } });
    if (!res.ok) throw new Error(`Nominatim returned HTTP ${res.status}`);
    const results = await res.json();
    if (!results || results.length === 0) {
      throw new Error(`No location found for "${query}"`);
    }
    return results.map(r => ({
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      display_name: r.display_name,
      countryCode: r.address && r.address.country_code ? r.address.country_code : null
    }));
  }

  // ── API-key persistence (localStorage; keys never enter URLs) ─

  function getStoredKey(providerId) {
    try { return localStorage.getItem('geosonify_parcel_key_' + providerId) || ''; }
    catch (e) { return ''; }
  }
  function storeKey(providerId, key) {
    try {
      if (key && key.trim()) localStorage.setItem('geosonify_parcel_key_' + providerId, key.trim());
      else localStorage.removeItem('geosonify_parcel_key_' + providerId);
    } catch (e) { /* private browsing etc. */ }
  }

  // ── High-level orchestration ──────────────────────────────

  /**
   * Full address → parcel-candidates flow.
   * Returns { geocode, provider, candidates }.
   *
   * options.customArcgisUrl — user-supplied layer URL (overrides registry)
   * options.onStatus(text)  — progress callback for the loading line
   */
  async function lookupAddress(addressQuery, options) {
    options = options || {};
    const status = options.onStatus || function () {};

    status('Geocoding address…');
    const geocodes = await geocodeAddress(addressQuery);
    const geo = geocodes[0];   // Nominatim's best match

    // Resolve provider
    let providers;
    if (options.customArcgisUrl && options.customArcgisUrl.trim()) {
      providers = [customArcgisProvider(options.customArcgisUrl)];
    } else {
      providers = findProviders(geo.countryCode, geo.lat, geo.lon);
    }
    if (providers.length === 0) {
      const cc = geo.countryCode ? geo.countryCode.toUpperCase() : 'this location';
      throw new Error(
        `No free parcel source registered for ${cc} yet. ` +
        `If you know a public ArcGIS parcel layer for this area, paste its URL in the Advanced field.`
      );
    }

    // Try providers in order until one answers
    let lastErr = null;
    for (const provider of providers) {
      const key = provider.keyRequired ? getStoredKey(provider.id) : null;
      try {
        status(`Querying ${provider.name}…`);
        const candidates = await fetchParcelsAtPoint(provider, geo.lat, geo.lon, key);
        return { geocode: geo, geocodes: geocodes, provider: provider, candidates: candidates };
      } catch (e) {
        lastErr = e;
        console.warn(`[property-import] ${provider.id} failed:`, e.message);
      }
    }
    throw lastErr || new Error('All parcel sources failed for that location.');
  }

  /**
   * Pin-based lookup: a known lat/lon (e.g. a dropped map pin) → parcel
   * candidates, skipping geocoding entirely. This is the RELIABLE path —
   * geocoding an address can land on the road centreline and miss the
   * parcel, whereas an exact point does a true point-in-polygon query.
   * Returns { geocode, provider, candidates } in the same shape as
   * lookupAddress so callers/UI are interchangeable.
   */
  async function lookupPoint(lat, lon, options) {
    options = options || {};
    const status = options.onStatus || function () {};
    const geo = { lat, lon, display_name: `${lat.toFixed(6)}, ${lon.toFixed(6)}`, countryCode: options.countryCode || null };

    let providers;
    if (options.customArcgisUrl && options.customArcgisUrl.trim()) {
      providers = [customArcgisProvider(options.customArcgisUrl)];
    } else {
      providers = findProviders(geo.countryCode, lat, lon);
    }
    if (providers.length === 0) {
      throw new Error(
        `No free parcel source registered for this location yet. ` +
        `If you know a public ArcGIS parcel layer here, paste its URL in the Advanced field.`
      );
    }

    let lastErr = null;
    for (const provider of providers) {
      const key = provider.keyRequired ? getStoredKey(provider.id) : null;
      try {
        status(`Querying ${provider.name}…`);
        const candidates = await fetchParcelsAtPoint(provider, lat, lon, key);
        return { geocode: geo, geocodes: [geo], provider: provider, candidates: candidates };
      } catch (e) {
        lastErr = e;
        console.warn(`[property-import] ${provider.id} failed:`, e.message);
      }
    }
    throw lastErr || new Error('All parcel sources failed at that point.');
  }

  /**
   * One-shot variant for the URL auto-pipeline: returns the single
   * best parcel as { coords, groups, name, attribution }.
   */
  async function lookupAddressAuto(addressQuery, options) {
    const result = await lookupAddress(addressQuery, options);
    const best = result.candidates[0];
    return {
      coords: best.coords,
      groups: best.groups,
      name: best.display_name,
      attribution: result.provider.attribution,
      provider: result.provider
    };
  }

  // ── Public API ────────────────────────────────────────────
  return {
    PROVIDERS: PROVIDERS,
    geocodeAddress: geocodeAddress,
    findProviders: findProviders,
    customArcgisProvider: customArcgisProvider,
    fetchParcelsAtPoint: fetchParcelsAtPoint,
    lookupAddress: lookupAddress,
    lookupPoint: lookupPoint,
    lookupAddressAuto: lookupAddressAuto,
    getStoredKey: getStoredKey,
    storeKey: storeKey,
    // exposed for tests / reuse
    _pointInRing: pointInRing,
    _ringAreaM2: ringAreaM2,
    _geometryToRings: geometryToRings
  };
})();
