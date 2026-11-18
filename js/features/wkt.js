/*
  wkt.js — Well-Known Text <-> GeoJSON geometry (WP2.4, Nov 2026)

  Pure functions, no DOM. Import turns WKT into a GeoJSON geometry, which then
  takes the same path as pasted or uploaded GeoJSON; export writes the geometry
  that js/features/geojson-export.js builds (edges already densified, 180°
  already split), so a WKT file says exactly what the GeoJSON file says.

  Read: POINT, MULTIPOINT, LINESTRING, MULTILINESTRING, POLYGON, MULTIPOLYGON,
  GEOMETRYCOLLECTION; any case; Z, M and ZM coordinates (extra values dropped);
  EMPTY; an EWKT "SRID=4326;" prefix. Coordinates are x y = longitude latitude,
  as in GeoJSON. Another SRID is refused, since only WGS84 longitude/latitude
  can be read without a projection library. MULTIPOINT accepts both
  "(1 2, 3 4)" and "((1 2), (3 4))".
*/
(function (global) {
  'use strict';

  function WKTError(msg) { var e = new Error(msg); e.name = 'WKTError'; return e; }

  function parse(text) {
    var s = String(text || '').trim();
    var srid = /^SRID=(\d+);/i.exec(s);
    if (srid) {
      if (srid[1] !== '4326') throw WKTError('Only SRID 4326 (WGS84 longitude/latitude) can be read; this is SRID ' + srid[1] + '.');
      s = s.slice(srid[0].length);
    }
    var i = 0;
    function ws() { while (i < s.length && /\s/.test(s[i])) i++; }
    function word() { ws(); var m = /^[A-Za-z]+/.exec(s.slice(i)); if (!m) throw WKTError('Expected a geometry type at character ' + (i + 1)); i += m[0].length; return m[0].toUpperCase(); }
    function peek(c) { ws(); return s[i] === c; }
    function eat(c) { ws(); if (s[i] !== c) throw WKTError('Expected "' + c + '" at character ' + (i + 1)); i++; }
    function num() { ws(); var m = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s.slice(i)); if (!m) throw WKTError('Expected a number at character ' + (i + 1)); i += m[0].length; return parseFloat(m[0]); }
    function position() {
      var p = [num(), num()];
      ws(); while (i < s.length && /[-+.\d]/.test(s[i])) { num(); ws(); }   // drop Z / M
      if (!(Math.abs(p[1]) <= 90 && Math.abs(p[0]) <= 540)) throw WKTError('Coordinate out of range (longitude latitude expected): ' + p[0] + ' ' + p[1]);
      return p;
    }
    function list(item) { eat('('); var out = [item()]; while (peek(',')) { i++; out.push(item()); } eat(')'); return out; }
    function isEmpty() { ws(); if (/^EMPTY\b/i.test(s.slice(i))) { i += 5; return true; } return false; }
    function dims() { ws(); var m = /^(ZM|Z|M)\b/i.exec(s.slice(i)); if (m) i += m[0].length; }
    function ring() { return list(position); }
    function geometry() {
      var type = word(); dims();
      if (type === 'POINT') { if (isEmpty()) return { type: 'Point', coordinates: [] }; eat('('); var p = position(); eat(')'); return { type: 'Point', coordinates: p }; }
      if (type === 'LINESTRING') return isEmpty() ? { type: 'LineString', coordinates: [] } : { type: 'LineString', coordinates: ring() };
      if (type === 'POLYGON') return isEmpty() ? { type: 'Polygon', coordinates: [] } : { type: 'Polygon', coordinates: list(ring) };
      if (type === 'MULTIPOINT') {
        if (isEmpty()) return { type: 'MultiPoint', coordinates: [] };
        return { type: 'MultiPoint', coordinates: list(function () { if (peek('(')) { eat('('); var q = position(); eat(')'); return q; } return position(); }) };
      }
      if (type === 'MULTILINESTRING') return isEmpty() ? { type: 'MultiLineString', coordinates: [] } : { type: 'MultiLineString', coordinates: list(ring) };
      if (type === 'MULTIPOLYGON') return isEmpty() ? { type: 'MultiPolygon', coordinates: [] } : { type: 'MultiPolygon', coordinates: list(function () { return list(ring); }) };
      if (type === 'GEOMETRYCOLLECTION') return isEmpty() ? { type: 'GeometryCollection', geometries: [] } : { type: 'GeometryCollection', geometries: list(geometry) };
      throw WKTError('Unknown geometry type ' + type);
    }
    var g = geometry(); ws();
    if (s[i] === ';') i++;
    ws(); if (i < s.length) throw WKTError('Unexpected text after the geometry at character ' + (i + 1));
    return g;
  }

  function looksLikeWKT(text) {
    return /^\s*(SRID=\d+;\s*)?(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\b/i.test(String(text || ''));
  }

  function stringify(geom, decimals) {
    var d = decimals == null ? 8 : decimals;
    function n(x) { var v = +x.toFixed(d); return String(v === 0 ? 0 : v); }
    function pos(p) { return n(p[0]) + ' ' + n(p[1]); }
    function seq(a) { return '(' + a.map(pos).join(', ') + ')'; }
    function rings(r) { return '(' + r.map(seq).join(', ') + ')'; }
    if (!geom) return 'GEOMETRYCOLLECTION EMPTY';
    switch (geom.type) {
      case 'Point': return geom.coordinates.length ? 'POINT (' + pos(geom.coordinates) + ')' : 'POINT EMPTY';
      case 'MultiPoint': return geom.coordinates.length ? 'MULTIPOINT (' + geom.coordinates.map(function (p) { return '(' + pos(p) + ')'; }).join(', ') + ')' : 'MULTIPOINT EMPTY';
      case 'LineString': return geom.coordinates.length ? 'LINESTRING ' + seq(geom.coordinates) : 'LINESTRING EMPTY';
      case 'MultiLineString': return geom.coordinates.length ? 'MULTILINESTRING (' + geom.coordinates.map(seq).join(', ') + ')' : 'MULTILINESTRING EMPTY';
      case 'Polygon': return geom.coordinates.length ? 'POLYGON ' + rings(geom.coordinates) : 'POLYGON EMPTY';
      case 'MultiPolygon': return geom.coordinates.length ? 'MULTIPOLYGON (' + geom.coordinates.map(rings).join(', ') + ')' : 'MULTIPOLYGON EMPTY';
      case 'GeometryCollection': return geom.geometries.length ? 'GEOMETRYCOLLECTION (' + geom.geometries.map(function (g) { return stringify(g, d); }).join(', ') + ')' : 'GEOMETRYCOLLECTION EMPTY';
    }
    throw WKTError('Cannot write geometry type ' + geom.type);
  }

  var api = { parse: parse, stringify: stringify, looksLikeWKT: looksLikeWKT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.GeosonifyWKT = api;
})(typeof window !== 'undefined' ? window : this);
