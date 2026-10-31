/*
  GeosonifyNav — hand a decoded point to a maps app.

  Two jobs, one place:

  1. PIN links ("Open in Apple/Google Maps"): the decode banner and the two
     receive panels (legacy BIP39 entry, HEALPix words entry) each built these
     inline with their own platform test. They now all call pinLink/openPin,
     which produce exactly the URLs they produced before.

  2. DIRECTIONS (&nav on a code link): after a link has decoded and the pin is
     on the map, offer() shows a small sheet that hands the destination to
     Google Maps, Apple Maps or (Android) any installed maps app via geo:.
     It never navigates by itself: browsers block app hand-offs without a
     tap, and the tap is also the receiver's consent to give a location to a
     third party. The receiver sees the pin before they choose.

  Directions URLs carry no travel mode, so the maps app asks how to get
  there. The destination is the code's cell centre; when the code is coarse
  the sheet says how coarse.

  URL grammar (additive; see index.html parseURLParameters):
    &nav          offer directions after a point link decodes
    &nav=g|a|geo  the same, with Google, Apple or "other app" listed first
*/
(function (global) {
  'use strict';

  const COARSE_METRES = 1000;   // above this the sheet warns that it is an area

  function ua() { return (global.navigator && global.navigator.userAgent) || ''; }
  function isApple() {
    // iPhone/iPad, or an iPad reporting itself as a Mac (touch points give it away).
    return /iPad|iPhone|iPod/.test(ua()) ||
      (/Macintosh/.test(ua()) && global.navigator && global.navigator.maxTouchPoints > 0);
  }
  function isAndroid() { return /Android/i.test(ua()); }

  // A coordinate as text: strings pass through untouched (callers that already
  // chose their decimals keep them); numbers and Decimals go to `dp` places.
  function asText(v, dp) {
    if (typeof v === 'string') return v;
    if (v && typeof v.toFixed === 'function' && typeof v !== 'number') return v.toFixed(dp);
    return Number(v).toFixed(dp);
  }
  // Directions want a longitude in −180…180; a few decoders hand back 0…360.
  function lonText(v, dp) {
    const n = Number(String(v));
    if (isFinite(n) && (n > 180 || n < -180)) return (((n + 180) % 360 + 360) % 360 - 180).toFixed(dp);
    return asText(v, dp);
  }

  // ── Pin links (unchanged URLs) ────────────────────────────
  function pinLinks(lat, lon, label) {
    return {
      apple: `maps://maps.apple.com/?q=${encodeURIComponent(label || 'Decoded Location')}&ll=${lat},${lon}`,
      google: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
    };
  }
  function pinLink(lat, lon, label) {
    const l = pinLinks(lat, lon, label);
    return isApple()
      ? { url: l.apple, label: 'Open in Apple Maps', app: 'apple' }
      : { url: l.google, label: 'Open in Google Maps', app: 'google' };
  }
  function openPin(lat, lon, label) {
    const l = pinLink(lat, lon, label || 'Decoded Location');
    if (l.app === 'apple') global.location.href = l.url;
    else global.open(l.url, '_blank');
  }

  // ── Directions ────────────────────────────────────────────
  function directionsLinks(lat, lon, label) {
    const la = asText(lat, 7), lo = lonText(lon, 7);
    const tag = label ? `(${encodeURIComponent(label)})` : '';
    return {
      google: `https://www.google.com/maps/dir/?api=1&destination=${la},${lo}`,
      apple: `https://maps.apple.com/?daddr=${la},${lo}`,
      geo: `geo:${la},${lo}?q=${la},${lo}${tag}`,
      lat: la, lon: lo
    };
  }

  // &nav / &nav=g|a|geo → { preferred } or null when absent.
  function parseParam(urlParams) {
    if (!urlParams || !urlParams.has('nav')) return null;
    const v = String(urlParams.get('nav') || '').trim().toLowerCase();
    const map = { g: 'google', google: 'google', a: 'apple', apple: 'apple', geo: 'geo', o: 'geo', other: 'geo' };
    return { preferred: map[v] || null };
  }

  function fmtMetres(m) {
    if (!isFinite(m)) return '';
    if (m < 10) return m.toFixed(1) + ' m';
    if (m < 1000) return Math.round(m) + ' m';
    if (m < 100000) return (m / 1000).toFixed(1).replace(/\.0$/, '') + ' km';
    return Math.round(m / 1000).toLocaleString('en-NZ') + ' km';
  }

  function close() {
    document.querySelectorAll('.geosonify-nav-sheet').forEach(el => el.remove());
  }

  /*
    offer(lat, lon, opts) — the directions sheet.
      opts.label             what the receiver was sent (words, code); shown, and
                             used as the geo: label
      opts.uncertaintyMetres the code's precision, if known
      opts.preferred         'google' | 'apple' | 'geo' to list first
      opts.onRetryPass       if set, a "Re-enter passphrase" action is shown
  */
  function offer(lat, lon, opts) {
    opts = opts || {};
    close();
    // The decode banner sits in the same place; the sheet replaces it.
    document.querySelectorAll('.decode-banner').forEach(b => b.remove());

    const d = directionsLinks(lat, lon, opts.label);
    const apps = [
      { key: 'google', text: 'Google Maps', url: d.google, blank: true },
      { key: 'apple', text: 'Apple Maps', url: d.apple, blank: !isApple() }
    ];
    if (isAndroid()) apps.push({ key: 'geo', text: 'Another app', url: d.geo, blank: false });
    const first = opts.preferred || (isApple() ? 'apple' : 'google');
    apps.sort((x, y) => (y.key === first) - (x.key === first));

    const sheet = document.createElement('div');
    sheet.className = 'geosonify-nav-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Get directions');
    sheet.style.cssText = [
      'position:fixed', 'left:50%', 'transform:translateX(-50%)',
      'bottom:calc(var(--tab-height, 56px) + var(--safe-bottom, 0px) + 12px)',
      'width:calc(100% - 24px)', 'max-width:400px', 'z-index:1600',
      'background:var(--ios-card, #fff)', 'color:var(--ios-text, #000)',
      'border:1px solid var(--ios-separator, #C6C6C8)', 'border-radius:16px',
      'box-shadow:0 10px 32px rgba(0,0,0,0.28)', 'padding:16px 16px 12px',
      'font-family:inherit'
    ].join(';');

    const h = document.createElement('div');
    h.textContent = 'Get directions here';
    h.style.cssText = 'font-size:17px;font-weight:600;margin:0 0 4px;';
    sheet.appendChild(h);

    if (opts.label) {
      const c = document.createElement('div');
      c.textContent = opts.label;
      c.style.cssText = 'font-size:14px;color:var(--ios-secondary, #3C3C43);word-break:break-word;margin-bottom:6px;';
      sheet.appendChild(c);
    }

    const u = Number(opts.uncertaintyMetres);
    if (isFinite(u) && u > 0) {
      const p = document.createElement('div');
      const coarse = u > COARSE_METRES;
      p.textContent = coarse
        ? `This code only narrows it to within about ${fmtMetres(u)}, so directions go to the middle of that area.`
        : `Precise to within about ${fmtMetres(u)}.`;
      p.style.cssText = 'font-size:13px;line-height:1.4;margin:0 0 10px;' +
        (coarse ? 'color:#B45309;font-weight:600;' : 'color:var(--ios-gray, #8E8E93);');
      sheet.appendChild(p);
    }

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 8px;';
    apps.forEach((a, i) => {
      const link = document.createElement('a');
      link.href = a.url;
      link.textContent = a.text;
      if (a.blank) { link.target = '_blank'; link.rel = 'noopener'; }
      link.style.cssText = 'flex:1 1 0;min-width:110px;text-align:center;text-decoration:none;' +
        'padding:11px 10px;border-radius:10px;font-size:15px;font-weight:600;' +
        (i === 0
          ? 'background:var(--primary, #325756);color:#fff;border:1px solid var(--primary, #325756);'
          : 'background:transparent;color:var(--ios-text, #000);border:1px solid var(--ios-separator, #C6C6C8);');
      link.addEventListener('click', () => setTimeout(close, 0));
      row.appendChild(link);
    });
    sheet.appendChild(row);

    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
    const coords = document.createElement('span');
    coords.textContent = d.lat + ', ' + d.lon;
    coords.style.cssText = 'font-size:12px;color:var(--ios-gray, #8E8E93);font-variant-numeric:tabular-nums;';
    foot.appendChild(coords);

    const actions = document.createElement('span');
    actions.style.cssText = 'display:flex;gap:4px;';
    function textButton(label, fn) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'background:none;border:none;color:var(--primary-light, #7d9fc2);font-size:14px;' +
        'font-weight:600;padding:8px 6px;cursor:pointer;font-family:inherit;';
      b.addEventListener('click', fn);
      return b;
    }
    if (typeof opts.onRetryPass === 'function') {
      actions.appendChild(textButton('Re-enter passphrase', () => { close(); opts.onRetryPass(); }));
    }
    actions.appendChild(textButton('Not now', close));
    foot.appendChild(actions);
    sheet.appendChild(foot);

    document.body.appendChild(sheet);
    const firstLink = row.querySelector('a');
    if (firstLink) { try { firstLink.focus({ preventScroll: true }); } catch (e) {} }
    sheet.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    return sheet;
  }

  global.GeosonifyNav = {
    pinLinks, pinLink, openPin,
    directionsLinks, parseParam, offer, close,
    isApple, isAndroid, COARSE_METRES
  };
})(typeof window !== 'undefined' ? window : this);
