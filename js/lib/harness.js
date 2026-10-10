// Scratch harness: serves the build of Geosonify with synthetic vector tiles,
// local Leaflet/Aladin, and a placeholder raster tile. No real network.
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.env.ROOT || '/home/claude/build';
const HERE = __dirname;
const T = require('./testtiles.js');
const PORT = +(process.env.PORT || 8765);
const NM = path.join(HERE, 'node_modules');

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/json' };

function startServer() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const u = new URL(req.url, 'http://x');
      const m = u.pathname.match(/^\/vt\/(\d+)\/(-?\d+)\/(\d+)\.pbf$/);
      if (m) {
        const buf = T.tile(+m[1], +m[2], +m[3]);
        rsp.writeHead(buf.length ? 200 : 204, { 'content-type': 'application/x-protobuf' });
        return rsp.end(buf);
      }
      const f = path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
      fs.readFile(f, (err, data) => {
        if (err) { rsp.writeHead(404); return rsp.end(); }
        rsp.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
        rsp.end(data);
      });
    });
    srv.listen(PORT, '127.0.0.1', () => res(srv));
  });
}

const STATS = { vt: 0, aborted: [] };
async function route(page) {
  await page.route('**/*', async r => {
    const url = r.request().url();
    if (url.startsWith('http://127.0.0.1')) { if (url.includes('/vt/')) STATS.vt++; return r.continue(); }
    const file = (p, type) => r.fulfill({ status: 200, contentType: type, body: fs.readFileSync(p) });
    if (/unpkg\.com\/leaflet\/dist\/leaflet\.js/.test(url)) return file(path.join(NM, 'leaflet/dist/leaflet.js'), 'application/javascript');
    if (/unpkg\.com\/leaflet\/dist\/leaflet\.css/.test(url)) return file(path.join(NM, 'leaflet/dist/leaflet.css'), 'text/css');
    if (/unpkg\.com\/leaflet\/dist\/images\/(.*)$/.test(url)) return file(path.join(NM, 'leaflet/dist/images', url.match(/images\/(.*)$/)[1]), 'image/png');
    if (/js-sha3/.test(url)) return file(path.join(NM, 'js-sha3/build/sha3.min.js'), 'application/javascript');
    if (/vexflow/.test(url)) return file(path.join(NM, 'vexflow/build/cjs/vexflow.js'), 'application/javascript');
    if (/geographiclib/.test(url)) return file(path.join(NM, 'geographiclib-geodesic/geographiclib-geodesic.min.js'), 'application/javascript');
    if (/aladin\.cds\.unistra\.fr\/AladinLite\/api\/v3\/.*aladin\.js/.test(url)) return file(path.join(NM, 'aladin-lite/dist/aladin.js'), 'application/javascript');
    if (/tiles\.openfreemap\.org\/planet$/.test(url))
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ tiles: ['http://127.0.0.1:' + PORT + '/vt/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 }) });
    if (/tile\.openstreetmap\.org|arcgisonline/.test(url)) return file(path.join(HERE, 'tile.png'), 'image/png');
    STATS.aborted.push(url.slice(0, 90));
    return r.abort();
  });
}

module.exports = { startServer, route, STATS, PORT };
