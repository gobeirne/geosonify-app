// ============================================================
// shape-import.js  —  Geosonify Shape Import Module
// Supports: Wikidata QID, Place name, OSM Relation ID,
//           GeoJSON (URL/file), KML (URL/file), GPX (URL)
// ============================================================

const ShapeImport = (function () {
  'use strict';

  // ── Helpers ────────────────────────────────────────────────

  /**
   * Convert a flat array of {lat, lon} objects into the format
   * expected by the GPX preview pipeline (gpxOriginalCoords).
   * Populates cumulativeDistance but sets time fields to null.
   */
  function toGpxCoordArray(latLonArray) {
    const coords = [];
    let cumulativeDistance = 0;
    for (let i = 0; i < latLonArray.length; i++) {
      const p = latLonArray[i];
      let segDist = 0;
      if (i > 0 && typeof geodesicDistance === 'function') {
        segDist = geodesicDistance(
          [latLonArray[i - 1].lat, latLonArray[i - 1].lon],
          [p.lat, p.lon]
        );
        cumulativeDistance += segDist;
      }
      coords.push({
        lat: p.lat,
        lon: p.lon,
        time: null,
        cumulativeTime: null,
        cumulativeDistance: cumulativeDistance,
        segmentDistance: segDist
      });
    }
    return coords;
  }

  /**
   * Suggest an epsilon value based on the bounding-box diagonal of
   * a coordinate array.  Larger regions → higher epsilon so the
   * default simplification is visually reasonable.
   */
  function suggestEpsilon(coords) {
    if (!coords || coords.length < 2) return 0.0001;
    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    for (const c of coords) {
      if (c.lat < minLat) minLat = c.lat;
      if (c.lat > maxLat) maxLat = c.lat;
      if (c.lon < minLon) minLon = c.lon;
      if (c.lon > maxLon) maxLon = c.lon;
    }
    const diagDeg = Math.sqrt(
      Math.pow(maxLat - minLat, 2) + Math.pow(maxLon - minLon, 2)
    );
    // Heuristic: epsilon ≈ diagonal / 2000, clamped to slider range
    const eps = Math.max(0.00001, Math.min(0.01, diagDeg / 2000));
    return parseFloat(eps.toPrecision(2));
  }

  /**
   * Extract the largest ring from a GeoJSON geometry.
   * Returns array of {lat, lon}.
   */
  function extractLargestRing(geometry) {
    if (!geometry) return [];

    function ringToLatLon(ring) {
      // GeoJSON rings are [lon, lat] arrays
      return ring.map(c => ({ lat: c[1], lon: c[0] }));
    }

    function ringArea(ring) {
      // Shoelace formula on [lon, lat] for approximate area comparison
      let area = 0;
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        area += ring[i][0] * ring[j][1];
        area -= ring[j][0] * ring[i][1];
      }
      return Math.abs(area / 2);
    }

    let allRings = [];

    switch (geometry.type) {
      case 'Point':
        return [{ lat: geometry.coordinates[1], lon: geometry.coordinates[0] }];

      case 'LineString':
        return geometry.coordinates.map(c => ({ lat: c[1], lon: c[0] }));

      case 'MultiLineString':
        // Concatenate all linestrings, or pick longest
        {
          let best = [];
          for (const line of geometry.coordinates) {
            if (line.length > best.length) best = line;
          }
          return best.map(c => ({ lat: c[1], lon: c[0] }));
        }

      case 'Polygon':
        // Outer ring is index 0
        return ringToLatLon(geometry.coordinates[0]);

      case 'MultiPolygon':
        // Find the outer ring with the largest area
        for (const polygon of geometry.coordinates) {
          allRings.push(polygon[0]); // outer ring of each polygon
        }
        if (allRings.length === 0) return [];
        allRings.sort((a, b) => ringArea(b) - ringArea(a));
        return ringToLatLon(allRings[0]);

      case 'GeometryCollection':
        // Pick the geometry with the most points
        {
          let best = [];
          for (const geom of geometry.geometries) {
            const pts = extractLargestRing(geom);
            if (pts.length > best.length) best = pts;
          }
          return best;
        }

      default:
        return [];
    }
  }

  /**
   * From a full GeoJSON object (FeatureCollection, Feature, or bare Geometry),
   * extract the best geometry's coordinates.
   */
  function extractFromGeoJSON(geojson) {
    if (!geojson) return [];

    let geometry = null;
    if (geojson.type === 'FeatureCollection') {
      // Pick the feature with the richest geometry
      let best = [];
      for (const feature of (geojson.features || [])) {
        const pts = extractLargestRing(feature.geometry);
        if (pts.length > best.length) best = pts;
      }
      return best;
    } else if (geojson.type === 'Feature') {
      geometry = geojson.geometry;
    } else {
      // Bare geometry
      geometry = geojson;
    }
    return extractLargestRing(geometry);
  }

  // ── KML Parser ────────────────────────────────────────────

  function parseKML(kmlText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(kmlText, 'text/xml');

    // Handle KMZ-style namespace or plain KML
    const coords = [];

    function parseCoordinateString(str) {
      // KML coordinates are "lon,lat,alt lon,lat,alt ..."
      const pts = [];
      const parts = str.trim().split(/\s+/);
      for (const part of parts) {
        const c = part.split(',');
        if (c.length >= 2) {
          const lon = parseFloat(c[0]);
          const lat = parseFloat(c[1]);
          if (!isNaN(lat) && !isNaN(lon)) {
            pts.push({ lat, lon });
          }
        }
      }
      return pts;
    }

    // Collect all <coordinates> elements
    const coordElements = xml.querySelectorAll('coordinates');
    let best = [];
    for (const el of coordElements) {
      const pts = parseCoordinateString(el.textContent);
      if (pts.length > best.length) best = pts;
    }
    return best;
  }

  // ── API Fetchers ──────────────────────────────────────────

  /**
   * Fetch the OSM relation ID for a Wikidata QID.
   * Uses the Wikidata SPARQL endpoint to find the linked OSM relation.
   * Falls back to direct Wikidata geometry if available.
   */
  async function fetchWikidataGeometry(qid) {
    // Normalise: accept 'Q123' or '123'
    qid = qid.toUpperCase().trim();
    if (!qid.startsWith('Q')) qid = 'Q' + qid;

    // Strategy 1: SPARQL to find OSM relation linked to this QID
    const sparql = `
      SELECT ?osmRelation WHERE {
        wd:${qid} wdt:P402 ?osmRelation .
      } LIMIT 1`;
    const sparqlUrl = 'https://query.wikidata.org/sparql?format=json&query=' +
      encodeURIComponent(sparql);

    try {
      const res = await fetch(sparqlUrl, {
        headers: { 'Accept': 'application/sparql-results+json' }
      });
      if (res.ok) {
        const data = await res.json();
        const bindings = data.results && data.results.bindings;
        if (bindings && bindings.length > 0 && bindings[0].osmRelation) {
          const osmId = bindings[0].osmRelation.value;
          return await fetchOSMRelation(osmId);
        }
      }
    } catch (e) {
      console.warn('[shape-import] Wikidata SPARQL failed:', e);
    }

    // Strategy 2: Try Nominatim with wikidata extratags
    try {
      const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&extratags=1&limit=1&q=wikidata:${qid}`;
      // Nominatim doesn't support wikidata: prefix in q param.
      // Instead use structured query or lookup
    } catch (e) {
      // Fall through
    }

    // Strategy 3: Nominatim lookup by wikidata tag via Overpass
    try {
      const overpassQuery = `
        [out:json][timeout:30];
        (
          relation["wikidata"="${qid}"];
          way["wikidata"="${qid}"];
        );
        out ids;`;
      const overpassUrl = 'https://overpass-api.de/api/interpreter?data=' +
        encodeURIComponent(overpassQuery);
      const res = await fetch(overpassUrl);
      if (res.ok) {
        const data = await res.json();
        const elements = data.elements || [];
        // Prefer relation over way
        const relation = elements.find(e => e.type === 'relation');
        const way = elements.find(e => e.type === 'way');
        const target = relation || way;
        if (target) {
          if (target.type === 'relation') {
            return await fetchOSMRelation(target.id);
          } else {
            return await fetchOSMWay(target.id);
          }
        }
      }
    } catch (e) {
      console.warn('[shape-import] Overpass QID lookup failed:', e);
    }

    throw new Error(`No geometry found for Wikidata ${qid}. It may not be linked to an OSM feature.`);
  }

  /**
   * Fetch geometry for a place name using Nominatim.
   * Returns the polygon boundary where available.
   */
  async function fetchPlaceGeometry(placeName) {
    const url = 'https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({
        q: placeName,
        format: 'json',
        polygon_geojson: '1',
        limit: '1'
      });

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Geosonify/1.0' }
    });
    if (!res.ok) throw new Error(`Nominatim returned HTTP ${res.status}`);

    const results = await res.json();
    if (!results || results.length === 0) {
      throw new Error(`No results found for "${placeName}"`);
    }

    const result = results[0];
    if (result.geojson) {
      const pts = extractLargestRing(result.geojson);
      if (pts.length > 0) {
        return { coords: pts, name: result.display_name, type: result.type };
      }
    }

    // Fallback: if only a point is returned
    if (result.lat && result.lon) {
      throw new Error(
        `"${placeName}" resolved to a point (${result.type}), not a shape boundary. ` +
        `Try a more specific name or use the OSM Relation ID.`
      );
    }

    throw new Error(`No geometry found for "${placeName}"`);
  }

  /**
   * Fetch multiple candidates for a place name search.
   * Returns an array of candidate objects, sorted with relations first,
   * then by descending point count (longest geometry first).
   * Each candidate: { display_name, osm_type, osm_id, type, pointCount,
   *                   lengthKm, coords, geojson }
   */
  async function fetchPlaceCandidates(placeName) {
    const url = 'https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({
        q: placeName,
        format: 'json',
        polygon_geojson: '1',
        limit: '10'
      });

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Geosonify/1.0' }
    });
    if (!res.ok) throw new Error(`Nominatim returned HTTP ${res.status}`);

    const results = await res.json();
    if (!results || results.length === 0) {
      throw new Error(`No results found for "${placeName}"`);
    }

    // Build candidate list with coords extracted
    const candidates = [];
    for (const r of results) {
      let coords = [];
      if (r.geojson) {
        coords = extractLargestRing(r.geojson);
      }
      // Estimate length in km using bounding box diagonal as a rough proxy
      let lengthKm = null;
      if (coords.length >= 2) {
        let totalDist = 0;
        // Use a sampled sum of segments for a rough linear length
        const step = Math.max(1, Math.floor(coords.length / 200));
        for (let i = 0; i < coords.length - step; i += step) {
          const a = coords[i], b = coords[i + step];
          const dLat = (b.lat - a.lat) * 111320;
          const dLon = (b.lon - a.lon) * 111320 * Math.cos(a.lat * Math.PI / 180);
          totalDist += Math.sqrt(dLat * dLat + dLon * dLon);
        }
        lengthKm = totalDist / 1000;
      }
      candidates.push({
        display_name: r.display_name,
        osm_type: r.osm_type,   // 'relation', 'way', 'node'
        osm_id: r.osm_id,
        type: r.type,            // e.g. 'route', 'path', 'administrative'
        class: r.class,          // e.g. 'highway', 'boundary'
        pointCount: coords.length,
        lengthKm: lengthKm,
        coords: coords,
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon)
      });
    }

    // Sort: relations first, then by descending point count
    candidates.sort((a, b) => {
      if (a.osm_type === 'relation' && b.osm_type !== 'relation') return -1;
      if (b.osm_type === 'relation' && a.osm_type !== 'relation') return 1;
      return b.pointCount - a.pointCount;
    });

    return candidates;
  }

  /**
   * Fetch an OSM relation's geometry via Overpass → GeoJSON.
   */
  async function fetchOSMRelation(relationId) {
    relationId = String(relationId).trim();

    // Use Overpass to get the full geometry
    const query = `
      [out:json][timeout:60];
      relation(${relationId});
      out geom;`;
    const url = 'https://overpass-api.de/api/interpreter?data=' +
      encodeURIComponent(query);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Overpass returned HTTP ${res.status}`);

    const data = await res.json();
    if (!data.elements || data.elements.length === 0) {
      throw new Error(`OSM relation ${relationId} not found`);
    }

    const el = data.elements[0];
    const name = (el.tags && (el.tags.name || el.tags['name:en'])) || `Relation ${relationId}`;

    // Build coordinate array from the relation's members
    const coords = overpassRelationToCoords(el);
    if (coords.length === 0) {
      throw new Error(`OSM relation ${relationId} has no usable geometry`);
    }

    return { coords, name, type: el.tags && el.tags.type };
  }

  /**
   * Fetch an OSM way's geometry via Overpass.
   */
  async function fetchOSMWay(wayId) {
    const query = `
      [out:json][timeout:30];
      way(${wayId});
      out geom;`;
    const url = 'https://overpass-api.de/api/interpreter?data=' +
      encodeURIComponent(query);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Overpass returned HTTP ${res.status}`);

    const data = await res.json();
    if (!data.elements || data.elements.length === 0) {
      throw new Error(`OSM way ${wayId} not found`);
    }

    const el = data.elements[0];
    const name = (el.tags && (el.tags.name || el.tags['name:en'])) || `Way ${wayId}`;
    const coords = (el.geometry || []).map(n => ({ lat: n.lat, lon: n.lon }));

    return { coords, name };
  }

  /**
   * Convert an Overpass relation element (with `out geom`) into a
   * flat coordinate array.  For multipolygons, picks the largest
   * outer ring.  For route relations, concatenates all ways.
   */
  function overpassRelationToCoords(element) {
    const members = element.members || [];
    const relType = element.tags && element.tags.type;

    if (relType === 'multipolygon' || relType === 'boundary') {
      // Collect outer ways
      const outerWays = members
        .filter(m => m.type === 'way' && (m.role === 'outer' || m.role === ''))
        .map(m => (m.geometry || []).map(n => ({ lat: n.lat, lon: n.lon })));

      if (outerWays.length === 0) {
        // Fallback: use any ways
        const anyWays = members
          .filter(m => m.type === 'way' && m.geometry)
          .map(m => m.geometry.map(n => ({ lat: n.lat, lon: n.lon })));
        return mergeWays(anyWays);
      }

      // Try to merge outer ways into closed rings
      const merged = mergeWays(outerWays);
      return merged;

    } else {
      // Route or other relation — concatenate all way geometries
      const allWays = members
        .filter(m => m.type === 'way' && m.geometry)
        .map(m => m.geometry.map(n => ({ lat: n.lat, lon: n.lon })));
      return mergeWays(allWays);
    }
  }

  /**
   * Merge an array of way segments into a single continuous path.
   * Tries to join endpoints where they match.
   */
  function mergeWays(ways) {
    if (ways.length === 0) return [];
    if (ways.length === 1) return ways[0];

    // Deep-copy so we don't mutate
    const segments = ways.map(w => [...w]);
    const result = segments.shift();

    const EPSILON = 0.000001; // ~0.1m tolerance for joining

    function endpointsMatch(a, b) {
      return Math.abs(a.lat - b.lat) < EPSILON &&
             Math.abs(a.lon - b.lon) < EPSILON;
    }

    let maxIterations = segments.length * 2;
    while (segments.length > 0 && maxIterations-- > 0) {
      const tail = result[result.length - 1];
      const head = result[0];
      let found = false;

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (seg.length === 0) { segments.splice(i, 1); found = true; break; }

        const segHead = seg[0];
        const segTail = seg[seg.length - 1];

        if (endpointsMatch(tail, segHead)) {
          // Append seg (skip duplicate first point)
          result.push(...seg.slice(1));
          segments.splice(i, 1);
          found = true;
          break;
        } else if (endpointsMatch(tail, segTail)) {
          // Append reversed seg
          result.push(...seg.reverse().slice(1));
          segments.splice(i, 1);
          found = true;
          break;
        } else if (endpointsMatch(head, segTail)) {
          // Prepend seg
          result.unshift(...seg.slice(0, -1));
          segments.splice(i, 1);
          found = true;
          break;
        } else if (endpointsMatch(head, segHead)) {
          // Prepend reversed seg
          result.unshift(...seg.reverse().slice(0, -1));
          segments.splice(i, 1);
          found = true;
          break;
        }
      }

      if (!found) {
        // Can't connect — just append the next segment with a gap
        const next = segments.shift();
        if (next) result.push(...next);
      }
    }

    return result;
  }

  /**
   * Fetch GeoJSON from a URL and extract coordinates.
   */
  async function fetchGeoJSON(url) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const geojson = await res.json();
    const pts = extractFromGeoJSON(geojson);
    if (pts.length === 0) throw new Error('No usable geometry found in GeoJSON');

    // Try to get a name from properties
    let name = url.split('/').pop().split('?')[0] || 'GeoJSON';
    if (geojson.type === 'Feature' && geojson.properties && geojson.properties.name) {
      name = geojson.properties.name;
    } else if (geojson.type === 'FeatureCollection' && geojson.features) {
      const f = geojson.features.find(f => f.properties && f.properties.name);
      if (f) name = f.properties.name;
    }

    return { coords: pts, name };
  }

  /**
   * Parse GeoJSON text (from file upload).
   */
  function parseGeoJSONText(text) {
    const geojson = JSON.parse(text);
    const pts = extractFromGeoJSON(geojson);
    if (pts.length === 0) throw new Error('No usable geometry found in GeoJSON');

    let name = 'GeoJSON';
    if (geojson.type === 'Feature' && geojson.properties && geojson.properties.name) {
      name = geojson.properties.name;
    }
    return { coords: pts, name };
  }

  /**
   * Fetch KML from a URL and extract coordinates.
   */
  async function fetchKML(url) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const text = await res.text();
    const pts = parseKML(text);
    if (pts.length === 0) throw new Error('No usable geometry found in KML');
    const name = url.split('/').pop().split('?')[0] || 'KML';
    return { coords: pts, name };
  }

  /**
   * Parse KML text (from file upload).
   */
  function parseKMLText(text) {
    const pts = parseKML(text);
    if (pts.length === 0) throw new Error('No usable geometry found in KML');
    return { coords: pts, name: 'KML' };
  }

  /**
   * Fetch GPX from a URL — delegates to the existing GPX parser
   * but wraps in the same interface.
   */
  async function fetchGPX(url) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const text = await res.text();
    // Return raw text so the caller can use the existing parseGPX pipeline
    return { gpxText: text, name: url.split('/').pop().split('?')[0] || 'GPX' };
  }

  // ── Public API ────────────────────────────────────────────

  return {
    // Core utilities
    toGpxCoordArray: toGpxCoordArray,
    suggestEpsilon: suggestEpsilon,
    extractFromGeoJSON: extractFromGeoJSON,
    parseKML: parseKML,

    // API fetchers (all return Promise<{coords, name}> except fetchGPX)
    fetchWikidataGeometry: fetchWikidataGeometry,
    fetchPlaceGeometry: fetchPlaceGeometry,
    fetchPlaceCandidates: fetchPlaceCandidates,
    fetchOSMRelation: fetchOSMRelation,
    fetchGeoJSON: fetchGeoJSON,
    fetchKML: fetchKML,
    fetchGPX: fetchGPX,

    // File parsers (synchronous, return {coords, name})
    parseGeoJSONText: parseGeoJSONText,
    parseKMLText: parseKMLText
  };
})();
