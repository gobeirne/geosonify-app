/*
  sw.js  v1.0  — Geosonify offline (WP2.7, 28 November 2026)

  After one visit with a connection, the app's own code stays on the device,
  so a Geosonify link opens and decodes in the field with no coverage: the
  cards, the codes, the words, the sounds. Map tiles, sky imagery and lookups
  still need the network and are never stored here.

  WHAT IS HANDLED, AND HOW
    The page itself (/ or /index.html, with any query): network first, with
      NAV_TIMEOUT_MS to answer; if the network fails or is slow, the stored
      copy. The stored copy is kept under the bare path only: the query (the
      place a link names) is never written to the cache.
    Files the page refers to (index.html is read for every js/ and css/ path
      and every script or stylesheet it loads from a CDN), and any other file
      the app itself asks for from this site or from a CDN:
        - versioned (?v=…) or pinned (a CDN path with @version or /x.y.z/):
          cache first. A new version is a new address, so these never go stale.
        - otherwise: network first, the stored copy if the network fails.
    Everything else (map tiles, imagery, Wikipedia, search, other pages of the
      site such as starpin.html) is not touched: no respondWith, no caching.

  KEEPING IT CURRENT
    Each time the page is fetched from the network, the list it refers to is
    read again: new files are fetched, and cached files of this site whose
    path is still referred to but at a different ?v= are deleted.

  KILL SWITCH
    Set KILL = true and upload this file: every visitor's worker then deletes
    its cache and unregisters itself at the next visit (browsers check sw.js
    for changes at least once a day, and on each navigation here because the
    page registers it with updateViaCache 'none').
*/
'use strict';

const VERSION = 'v1.0';
const KILL = false;
const CACHE = 'geosonify-offline-v1';
const NAV_TIMEOUT_MS = 4000;
const PAGE_KEY = '/index.html';
// CDNs the app loads libraries from (pinned versions only are kept).
const CDN_HOSTS = ['unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];
// Loaded at run time by other scripts, so not named in index.html: the sound
// engine's library, the barcode libraries and the sky's ephemerides. Kept so
// sounds, barcodes and planet positions work offline too. A version changed in
// the code is simply fetched and kept on first use.
const EXTRA = [
  'https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/bwip-js@4.3.0/dist/bwip-js-min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js',
  'js/lib/vendor/astronomy-engine-2.1.19.browser.min.js'
];

const scopePath = new URL(self.registration.scope).pathname;          // e.g. '/'
const pageKey = new URL(PAGE_KEY.slice(1), self.registration.scope).href;

function isPagePath(u) {
  return u.origin === self.location.origin &&
    (u.pathname === scopePath || u.pathname === scopePath + 'index.html');
}
function isCdn(u) { return CDN_HOSTS.indexOf(u.hostname) >= 0; }
function isPinned(u) {
  if (u.origin === self.location.origin) return u.searchParams.has('v');
  return /@\d[\w.-]*\//.test(u.pathname) || /\/\d+\.\d+[\w.-]*\//.test(u.pathname);
}
function isAsset(u) {
  return /\.(js|css|json|woff2?|txt)$/i.test(u.pathname);
}

// Every file index.html refers to, as absolute URLs.
function referencedBy(html) {
  const out = new Set();
  const local = /["'`](?:\.\/)?((?:js|css)\/[A-Za-z0-9_.\/-]+\.(?:js|css|json)(?:\?v=[A-Za-z0-9._-]*)?)["'`]/g;
  const remote = /(?:src|href)\s*=\s*["'](https:\/\/[^"']+\.(?:js|css))["']/g;
  let m;
  EXTRA.forEach(x => out.add(new URL(x, self.registration.scope).href));
  while ((m = local.exec(html))) out.add(new URL(m[1], self.registration.scope).href);
  while ((m = remote.exec(html))) {
    try { const u = new URL(m[1]); if (isCdn(u) && isPinned(u)) out.add(u.href); } catch (e) {}
  }
  return out;
}

async function store(cache, url) {
  try {
    const u = new URL(url);
    const req = new Request(url, { mode: u.origin === self.location.origin ? 'same-origin' : 'cors', credentials: 'omit' });
    const res = await fetch(req);
    if (res.ok) await cache.put(url, res);
  } catch (e) { /* offline or refused: try again next time */ }
}

// Bring the cache in line with a freshly fetched index.html.
async function syncTo(html) {
  const cache = await caches.open(CACHE);
  const want = referencedBy(html);
  const keys = await cache.keys();
  const have = new Set(keys.map(r => r.url));
  // A path still referred to, but at another ?v=, is superseded.
  const wantPaths = new Map();
  want.forEach(h => { const u = new URL(h); if (u.origin === self.location.origin) wantPaths.set(u.pathname, h); });
  await Promise.all(keys.map(r => {
    const u = new URL(r.url);
    if (u.origin !== self.location.origin || r.url === pageKey) return null;
    const cur = wantPaths.get(u.pathname);
    return (cur && cur !== r.url) ? cache.delete(r) : null;
  }));
  // With Data Saver on, keep only what the app itself asks for (below), not
  // everything the page refers to.
  if (self.navigator && self.navigator.connection && self.navigator.connection.saveData) return;
  const missing = [...want].filter(h => !have.has(h));
  // A few at a time, so the first visit doesn't swamp a slow connection.
  for (let i = 0; i < missing.length; i += 6) {
    await Promise.all(missing.slice(i, i + 6).map(h => store(cache, h)));
  }
}

self.addEventListener('install', event => {
  if (KILL) { self.skipWaiting(); return; }
  event.waitUntil((async () => {
    try {
      const res = await fetch(new Request(pageKey, { cache: 'no-cache' }));
      if (res.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(pageKey, res.clone());
        await syncTo(await res.text());
      }
    } catch (e) { /* installed offline: fills on the next visit */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('geosonify-offline-') && (KILL || n !== CACHE)).map(n => caches.delete(n)));
    if (KILL) { await self.registration.unregister(); return; }
    await self.clients.claim();
  })());
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

async function page(event) {
  const cache = await caches.open(CACHE);
  const net = fetch(event.request).then(async res => {
    if (res.ok && res.type === 'basic') {
      await cache.put(pageKey, res.clone());
      res.clone().text().then(syncTo).catch(() => {});
    }
    return res;
  });
  try {
    return await Promise.race([net, timeout(NAV_TIMEOUT_MS)]);
  } catch (e) {
    const hit = await cache.match(pageKey);
    if (hit) { net.catch(() => {}); return hit; }
    return net;                                       // nothing stored: wait for the network
  }
}

async function asset(event, u) {
  const cache = await caches.open(CACHE);
  if (isPinned(u)) {
    const hit = await cache.match(event.request, { ignoreVary: true });
    if (hit) return hit;
    // A CDN file is fetched in CORS mode for keeping: an opaque copy can take
    // megabytes of the storage quota each in Chrome.
    if (!(u.origin === self.location.origin) && event.request.mode !== 'cors') {
      try {
        const r = await fetch(new Request(u.href, { mode: 'cors', credentials: 'omit' }));
        if (r.ok) { cache.put(u.href, r.clone()).catch(() => {}); return r; }
      } catch (e) { /* fall through to the page's own request */ }
    }
    const res = await fetch(event.request);
    if (res.ok) cache.put(event.request, res.clone()).catch(() => {});
    return res;
  }
  try {
    const res = await fetch(event.request);
    if (res.ok) cache.put(event.request, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = await cache.match(event.request, { ignoreVary: true });
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener('fetch', event => {
  if (KILL) return;
  const req = event.request;
  if (req.method !== 'GET') return;
  let u;
  try { u = new URL(req.url); } catch (e) { return; }
  if (req.mode === 'navigate') {
    if (isPagePath(u)) event.respondWith(page(event));
    return;                                           // other pages: untouched
  }
  const ours = u.origin === self.location.origin;
  if (!(ours || isCdn(u)) || !isAsset(u)) return;     // tiles, imagery, APIs: untouched
  if (ours && !u.pathname.startsWith(scopePath + 'js/') && !u.pathname.startsWith(scopePath + 'css/')) return;
  event.respondWith((async () => {
    // Only for the app page itself, not for other pages of the site.
    if (event.clientId) {
      const c = await self.clients.get(event.clientId);
      if (c && !isPagePath(new URL(c.url))) return fetch(req);
    }
    return asset(event, u);
  })());
});
