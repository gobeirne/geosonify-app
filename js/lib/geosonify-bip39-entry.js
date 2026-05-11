/**
 * geosonify-bip39-entry.js v1.0
 * 
 * BIP39 word-entry UI for the card view.
 * Toggled via ✎ button in card header — same pattern as
 * the piano roll toggle (▦) on the music card.
 * 
 * Normal view: code display (sand-gas-legal-humor.134)
 * Entry view:  word slots + autocomplete + live checksums +
 *              confirm/mismatch/interrogation flow
 * 
 * The Leaflet map (already on screen) zooms to each subdivision
 * rectangle as words lock in. No embedded map needed.
 * 
 * Dependencies:
 * - CardRenderer (card-renderer.js) — CARD_GRIDS, CRC32C, normalizeByPrefix, etc.
 * - BIP39_GEO_LOOKUP (bip39-geo-lookup.js) — word-1 geographic descriptors (optional)
 * - Leaflet map instance via CardRenderer callbacks
 * 
 * Usage:
 *   // In card-renderer.js renderCards(), after creating a BIP39 card:
 *   BIP39Entry.attach(card, gridKey);
 *   
 *   // On coordinate change:
 *   BIP39Entry.onCoordUpdate(gridKey, code);
 */

(function(global) {
  'use strict';

  // ============== STATE PER CARD ==============
  // Each BIP39 grid can have its own entry state
  const entryStates = new Map(); // gridKey → state object

  function getState(gridKey) {
    if (!entryStates.has(gridKey)) {
      entryStates.set(gridKey, {
        active: false,         // entry view visible?
        words: ['', '', '', ''],
        locked: [null, null, null, null],
        activeSlot: 0,
        csStatus: 'building',  // building | confirm | pass | mismatch | interrogate
        callerCs: '',
        confirmedSlots: [false, false, false, false],
        interrogateStep: 0,
        errorSearch: null,     // { slot, candidates, callerFinalCs } | null
        suggestions: [],
        csFilter: '',           // checksum filter string (user types 3 digits to filter autocomplete)
        csFilterSlot: -1,       // which slot the filter is active for (-1 = none)
        entryEl: null,         // DOM ref — receiver entry view
        speakerEl: null,       // DOM ref — speaker readout view
        speakerActive: false,  // speaker view visible?
        codeEl: null,          // DOM ref
        toggleBtn: null,       // DOM ref
        inputEls: [],          // DOM refs to input elements
        mapRect: null,         // Leaflet rectangle overlay
        mapPin: null,          // Leaflet marker for final position
        _swallowNext: -1,     // slot index to swallow stray input from auto-lock
      });
    }
    return entryStates.get(gridKey);
  }

  // ============== GRID HELPERS ==============
  // These mirror card-renderer.js functions but are self-contained
  // so the module works standalone for testing

  function getGridInfo(gridKey) {
    // CARD_GRIDS is exposed as a global by card-renderer.js
    if (typeof CARD_GRIDS !== 'undefined' && CARD_GRIDS[gridKey]) {
      return CARD_GRIDS[gridKey];
    }
    return null;
  }

  function getWordlist(gridKey) {
    const info = getGridInfo(gridKey);
    if (info?.grid) return info.grid.flat();
    // Fallback: try global arrays
    const arrayMap = {
      bip39english: 'BIP39EnglishArray',
      bip39spanish: 'BIP39SpanishArray',
      bip39french: 'BIP39FrenchArray',
      bip39italian: 'BIP39ItalianArray',
      bip39portuguese: 'BIP39PortugueseArray',
      bip39czech: 'BIP39CzechArray',
      bip39japanese: 'BIP39JapaneseArray',
      bip39korean: 'BIP39KoreanArray',
      bip39chinesesimplified: 'BIP39ChineseSimplifiedArray',
      bip39chinesetraditional: 'BIP39ChineseTraditionalArray',
    };
    const arrName = arrayMap[gridKey];
    if (arrName && typeof global[arrName] !== 'undefined') {
      return global[arrName].flat();
    }
    return [];
  }

  function getGridDims(gridKey) {
    const info = getGridInfo(gridKey);
    if (info?.grid) return { rows: info.grid.length, cols: info.grid[0].length };
    return { rows: 45, cols: 45 }; // BIP39 default
  }

  // CRC32C — use CardRenderer's if available, otherwise standalone
  const CRC32C_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let crc = i;
      for (let j = 0; j < 8; j++) crc = (crc & 1) ? (0x82F63B78 ^ (crc >>> 1)) : (crc >>> 1);
      t[i] = crc;
    }
    return t;
  })();

  function crc32c(str) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < str.length; i++)
      crc = CRC32C_TABLE[(crc ^ str.charCodeAt(i)) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function computeChecksum(code, wordlist) {
    // If wordlist provided, hash comma-separated flat indices for cross-grid consistency.
    // Falls back to raw string hash if wordlist unavailable (legacy safety).
    let input = code;
    if (wordlist && wordlist.length > 0) {
      const tokens = [];
      let remaining = code;
      while (remaining.length > 0) {
        const sorted = wordlist.filter(w => remaining.toLowerCase().startsWith(w.toLowerCase()));
        if (sorted.length > 0) {
          sorted.sort((a, b) => b.length - a.length);
          const word = sorted[0];
          const idx = wordlist.findIndex(w => w.toLowerCase() === word.toLowerCase());
          tokens.push(idx);
          remaining = remaining.slice(word.length);
        } else {
          break; // unrecognized token — fall back below
        }
      }
      if (tokens.length > 0 && remaining.length === 0) {
        input = tokens.join(',');
      }
    }
    return (crc32c(input) % 1000).toString().padStart(3, '0');
  }

  function normalizeAccents(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  // ============== GEO LOOKUP ==============

  // Word-1: use static lookup table (instant, no API call)
  function getGeoDescriptorStatic(wordIndex) {
    if (typeof BIP39_GEO_LOOKUP !== 'undefined' && BIP39_GEO_LOOKUP[wordIndex]) {
      return BIP39_GEO_LOOKUP[wordIndex];
    }
    return null;
  }

  // Words 2+: Nominatim reverse geocode of the cell centroid
  // Always zoom=18 with addressdetails=1 for maximum detail.
  // We pick the right fields to display based on how many words are locked.
  const nominatimCache = new Map(); // "lat,lon" → full address object

  async function reverseGeocodeAddress(lat, lon) {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (nominatimCache.has(key)) return nominatimCache.get(key);

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=18&addressdetails=1&accept-language=en`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Geosonify/1.0' }
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data.error) return null;
      const result = {
        address: data.address || {},
        displayName: data.display_name || ''
      };
      nominatimCache.set(key, result);
      return result;
    } catch (e) {
      return null;
    }
  }

  // Format address for display based on word depth
  // Level 4 deliberately reuses level 3 — at ~5m, the map pin is the truth.
  // A reverse-geocoded street address could point to the wrong street/entrance.
  function formatAddressForDepth(addrResult, depth) {
    if (!addrResult) return null;
    const addr = addrResult.address;

    const city = addr.city || addr.town || addr.village || addr.municipality || addr.hamlet || '';
    const suburb = addr.suburb || addr.neighbourhood || addr.quarter || '';
    const road = addr.road || addr.pedestrian || addr.path || '';
    const country = addr.country || '';

    switch (depth) {
      case 2: // City level (~10 km)
        return city && country ? `${city}, ${country}` : country || city || null;

      case 3: // Block level (~300 m)
      case 4: // Door level (~5 m) — same as block; the map pin is precise enough
        if (suburb && city) return `Near ${suburb}, ${city}`;
        if (road && city) return `Near ${road}, ${city}`;
        if (suburb) return `Near ${suburb}`;
        return city || null;

      default:
        return city || country || null;
    }
  }

  // Update the geo bar — called each time a word locks
  async function updateGeoForLockedWords(gridKey) {
    const state = getState(gridKey);
    const wordlist = getWordlist(gridKey);
    const lockedCount = state.locked.filter(w => w !== null).length;
    const geoBar = state.entryEl?.querySelector('.bip39-geo-bar');
    if (!geoBar || lockedCount === 0) {
      if (geoBar) geoBar.style.display = 'none';
      return;
    }

    if (lockedCount === 1 && !hasPassphraseOrObfuscation()) {
      // Word 1, no passphrase: static lookup (instant, base grid index is correct)
      const idx = wordlist.indexOf(state.locked[0]);
      const geo = idx >= 0 ? getGeoDescriptorStatic(idx) : null;
      if (geo) {
        geoBar.style.display = 'flex';
        geoBar.textContent = geo;
      } else {
        geoBar.style.display = 'none';
      }
    } else {
      // Words 2–4 (or word 1 with passphrase): Nominatim call on centroid, format per depth
      const bounds = computeBounds(state.locked, gridKey);
      const lat = (bounds.latMin + bounds.latMax) / 2;
      const lon = (bounds.lonMin + bounds.lonMax) / 2;
      geoBar.style.display = 'flex';
      geoBar.textContent = 'Looking up...';
      const addrResult = await reverseGeocodeAddress(lat, lon);
      // Guard: check user hasn't typed more words while we were fetching
      const currentCount = state.locked.filter(w => w !== null).length;
      if (currentCount !== lockedCount) return; // stale, a newer call will handle it
      const descriptor = formatAddressForDepth(addrResult, lockedCount);
      if (descriptor) {
        geoBar.textContent = descriptor;
      } else {
        // Fallback to word-1 static
        const idx = wordlist.indexOf(state.locked[0]);
        const fallback = idx >= 0 ? getGeoDescriptorStatic(idx) : null;
        geoBar.textContent = fallback || `${lockedCount} words entered`;
      }
    }
  }

  // Get geo for a specific word position (used in interrogation panel)
  function getGeoForPosition(locked, position, gridKey) {
    const wordlist = getWordlist(gridKey);
    if (position === 0 && !hasPassphraseOrObfuscation()) {
      const idx = wordlist.indexOf(locked[0]);
      return idx >= 0 ? getGeoDescriptorStatic(idx) : null;
    }
    // For deeper positions (or word 1 with passphrase): check cache and format at the right depth
    const bounds = computeBounds(locked.slice(0, position + 1), gridKey);
    const lat = (bounds.latMin + bounds.latMax) / 2;
    const lon = (bounds.lonMin + bounds.lonMax) / 2;
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const cached = nominatimCache.get(key);
    return cached ? formatAddressForDepth(cached, position + 1) : null;
  }

  // Check if passphrase or obfuscation is active (affects word→cell mapping)
  function hasPassphraseOrObfuscation() {
    if (typeof CardRenderer === 'undefined') return false;
    if (CardRenderer.getPassphrase && CardRenderer.getPassphrase()) return true;
    if (CardRenderer.isObfuscated && CardRenderer.isObfuscated()) return true;
    return false;
  }

  // Compute bounds for locked words (hierarchical subdivision)
  // With a passphrase or obfuscation, the word→cell mapping is position-dependent
  // and can't be resolved by a simple wordlist.indexOf(). We delegate to
  // CardRenderer.decodeCardCode() which handles delimiter stripping, passphrase,
  // and obfuscation correctly, then derive cell bounds from the centroid.
  function computeBounds(locked, gridKey) {
    const { rows, cols } = getGridDims(gridKey);
    const lockedCount = locked.filter(w => w !== null).length;
    if (lockedCount === 0) return { latMin: -90, latMax: 90, lonMin: -180, lonMax: 180 };

    // If CardRenderer.decodeCardCode is available, use it — it handles
    // delimiter stripping, passphrase, and obfuscation correctly
    if (typeof CardRenderer !== 'undefined' && CardRenderer.decodeCardCode) {
      const gridDef = getGridInfo(gridKey);
      const delimiter = gridDef?.delimiter || '-';
      const code = locked.slice(0, lockedCount).join(delimiter);
      const deobfuscate = typeof CardRenderer.isObfuscated === 'function' && CardRenderer.isObfuscated();
      const result = CardRenderer.decodeCardCode(gridKey, code, deobfuscate);
      if (result) {
        const [lat, lon] = result;
        // Derive cell bounds from centroid + cell dimensions at this depth
        const dLat = 180 / Math.pow(rows, lockedCount);
        const dLon = 360 / Math.pow(cols, lockedCount);
        // Snap to cell edges
        const latMax = 90 - Math.floor((90 - lat) / dLat) * dLat;
        const latMin = latMax - dLat;
        const lonMin = -180 + Math.floor((lon + 180) / dLon) * dLon;
        const lonMax = lonMin + dLon;
        return { latMin, latMax, lonMin, lonMax };
      }
    }

    // Fallback: direct wordlist lookup (works for no-passphrase, no-obfuscation)
    const wordlist = getWordlist(gridKey);
    let latMin = -90, latMax = 90, lonMin = -180, lonMax = 180;

    for (let i = 0; i < locked.length; i++) {
      if (!locked[i]) break;
      const idx = wordlist.indexOf(locked[i]);
      if (idx < 0) break;
      const row = Math.floor(idx / cols);
      const col = idx % cols;
      const dLat = (latMax - latMin) / rows;
      const dLon = (lonMax - lonMin) / cols;
      latMax = latMax - dLat * row;
      latMin = latMax - dLat;
      lonMin = lonMin + dLon * col;
      lonMax = lonMin + dLon;
    }
    return { latMin, latMax, lonMin, lonMax };
  }

  // ============== RESOLUTION INFO ==============

  const RESOLUTION = [
    { label: 'REGION', color: '#3b82f6' },
    { label: 'CITY',   color: '#22d3ee' },
    { label: 'BLOCK',  color: '#a78bfa' },
    { label: 'DOOR',   color: '#22c55e' },
  ];

  // ============== AUTOCOMPLETE ==============

  function getFilteredWords(input, wordlist) {
    if (!input || input.length === 0) return [];
    const norm = normalizeAccents(input.toLowerCase());
    
    // Primary: standard prefix match
    let results = wordlist.filter(w => normalizeAccents(w.toLowerCase()).startsWith(norm));
    
    // If no exact prefix match and input is 4+ chars, try BIP39 4-char prefix match
    // This catches "humour" → "humor" (first 4 chars "humo" match)
    if (results.length === 0 && norm.length >= 4) {
      const prefix4 = norm.slice(0, 4);
      results = wordlist.filter(w => normalizeAccents(w.toLowerCase()).startsWith(prefix4));
    }
    
    // If still no match and input is 3+ chars, try matching words that START with the input
    // OR where the input starts with the word (typed too much)
    if (results.length === 0 && norm.length >= 3) {
      results = wordlist.filter(w => {
        const wn = normalizeAccents(w.toLowerCase());
        return wn.startsWith(norm.slice(0, 3)) || norm.startsWith(wn);
      });
    }
    
    return results.slice(0, 8);
  }

  // ============== RUNNING CHECKSUMS ==============

  function getRunningChecksums(locked, gridKey) {
    const wordlist = gridKey ? getWordlist(gridKey) : null;
    const rc = [];
    let concat = '';
    for (let i = 0; i < 4; i++) {
      if (locked[i]) { concat += locked[i]; rc.push(computeChecksum(concat, wordlist)); }
      else rc.push(null);
    }
    return rc;
  }

  // Compute the running checksum if `word` were placed at `slot`,
  // given the already-locked words before it.
  function checksumForCandidate(locked, slot, word, wordlist) {
    let concat = '';
    for (let i = 0; i <= slot; i++) {
      concat += (i === slot) ? word : (locked[i] || '');
    }
    return computeChecksum(concat, wordlist);
  }

  // ============== MAP INTEGRATION ==============

  function getMap() {
    // 'map' is a global Leaflet instance in index108.html
    return (typeof map !== 'undefined') ? map : null;
  }

  function updateMapRect(state, gridKey) {
    const m = getMap();
    if (!m) return;

    const lockedCount = state.locked.filter(w => w !== null).length;
    if (lockedCount === 0) {
      if (state.mapRect) { m.removeLayer(state.mapRect); state.mapRect = null; }
      if (state.mapPin) { m.removeLayer(state.mapPin); state.mapPin = null; }
      return;
    }

    const bounds = computeBounds(state.locked, gridKey);
    const color = RESOLUTION[Math.min(lockedCount - 1, 3)].color;

    if (state.mapRect) {
      state.mapRect.setBounds([[bounds.latMin, bounds.lonMin], [bounds.latMax, bounds.lonMax]]);
      state.mapRect.setStyle({ color: color, weight: 2.5 });
    } else {
      state.mapRect = L.rectangle(
        [[bounds.latMin, bounds.lonMin], [bounds.latMax, bounds.lonMax]],
        { color: color, weight: 2.5, fillOpacity: 0.12, dashArray: '6,4' }
      ).addTo(m);
    }
    m.fitBounds(state.mapRect.getBounds(), { padding: [20, 20], maxZoom: 18 });

    // Drop a pin at centroid when all 4 words locked
    if (lockedCount === 4) {
      const lat = (bounds.latMin + bounds.latMax) / 2;
      const lon = (bounds.lonMin + bounds.lonMax) / 2;
      if (state.mapPin) {
        state.mapPin.setLatLng([lat, lon]);
      } else {
        state.mapPin = L.marker([lat, lon], {
          title: state.locked.join('-'),
          zIndexOffset: 1000
        }).addTo(m);
      }
    } else if (state.mapPin) {
      m.removeLayer(state.mapPin);
      state.mapPin = null;
    }
  }

  // ============== DOM BUILDING ==============

  /**
   * Build both entry view AND speaker view into the card body.
   * Both hidden by default. ✎ pen toggles entry, ✓ tick toggles speaker.
   */
  function buildEntryDOM(card, gridKey) {
    const state = getState(gridKey);
    const wordlist = getWordlist(gridKey);

    // ═══ RECEIVER ENTRY VIEW (toggled by ✎ pen) ═══
    const entry = document.createElement('div');
    entry.className = 'bip39-entry';
    entry.style.display = 'none';
    entry.style.padding = '8px';
    buildReceiverMode(entry, gridKey, state, wordlist);

    // ═══ SPEAKER READOUT VIEW (toggled by ✓ tick) ═══
    const speaker = document.createElement('div');
    speaker.className = 'bip39-speaker';
    speaker.style.display = 'none';
    buildSpeakerMode(speaker, gridKey, state, wordlist);

    // Insert both into card body
    const bodyInner = card.querySelector('.card-body-inner');
    if (bodyInner) {
      bodyInner.appendChild(entry);
      bodyInner.appendChild(speaker);
    }

    state.entryEl = entry;
    state.speakerEl = speaker;
    state.codeEl = bodyInner?.querySelector('.code-display');

    wireEventHandlers(gridKey, wordlist);
    updateChecksumPanel(gridKey);

    return entry;
  }

  // ── Check if the ✓ checksum toggle is on for this grid ──
  function isChecksumEnabled(gridKey) {
    if (typeof CardRenderer !== 'undefined' && CardRenderer.getCardState) {
      const cs = CardRenderer.getCardState();
      return cs?.checksumEnabled?.[gridKey] || false;
    }
    return false;
  }

  // ═══ SPEAKER MODE (checksum ✓ toggled on) ═══
  // Like the fullscreen display but within the card — big words, running checksums
  function buildSpeakerMode(entry, gridKey, state, wordlist) {
    // This reads the CURRENT code from the card (what the map is showing)
    // and displays it in large format with running checksums for the caller to read

    const speakerDiv = document.createElement('div');
    speakerDiv.className = 'bip39-speaker-mode';
    speakerDiv.style.cssText = 'background:#2D2844; border-radius:8px; padding:6px 0; text-align:left;';

    // We need to get the current code — read from the code display
    // This will be populated by updateSpeakerMode()
    speakerDiv.innerHTML = '<div style="color:#8b80a8; font-size:12px; text-align:center; padding:16px;">Move the map to generate a code</div>';
    entry.appendChild(speakerDiv);

    // Store ref for updates
    state._speakerDiv = speakerDiv;

    // Initial render
    updateSpeakerMode(gridKey);
  }

  function updateSpeakerMode(gridKey) {
    const state = getState(gridKey);
    if (!state._speakerDiv) return;

    // Get the current code from CardRenderer
    const gridDef = getGridInfo(gridKey);
    if (!gridDef?.grid) return;

    const coord = (typeof CardRenderer !== 'undefined' && CardRenderer.getCoordinate)
      ? CardRenderer.getCoordinate() : null;
    if (!coord) {
      state._speakerDiv.innerHTML = '<div style="color:#8b80a8; font-size:12px; text-align:center; padding:16px;">Move the map to generate a code</div>';
      return;
    }

    // Encode the current coordinate
    const code = (typeof encodeCardCoordinate !== 'undefined')
      ? encodeCardCoordinate(gridKey, coord.lat, coord.lon)
      : null;
    if (!code) return;

    // Tokenize into words
    const flat = gridDef.grid.flat();
    let words;
    if (typeof GeoCodec !== 'undefined' && GeoCodec.tokenizeCode) {
      words = GeoCodec.tokenizeCode(code, flat);
    }
    if (!words || words.length === 0) {
      // Try splitting by delimiter
      const delim = gridDef.delimiter || '-';
      words = code.split(delim).filter(w => w.length > 0);
    }
    if (!words || words.length === 0) return;

    // Compute running checksums (index-based for cross-grid consistency)
    const checksums = [];
    let concat = '';
    for (let i = 0; i < words.length; i++) {
      concat += words[i];
      checksums.push(computeChecksum(concat, flat));
    }
    const finalCs = checksums[checksums.length - 1];

    // Kererū palette colours per word position
    const KERERU_COLORS = ['#B5A0C8', '#96AACC', '#C787A8', '#6B8E6B'];
    const SEP = 'border-bottom:1px solid rgba(181,160,200,0.12);';

    // Build the speaker display
    let html = '';
    for (let i = 0; i < words.length; i++) {
      const color = KERERU_COLORS[i] || KERERU_COLORS[0];
      html += `
        <div style="display:flex; align-items:center; gap:14px; padding:12px 16px; ${i < words.length - 1 ? SEP : ''}">
          <div style="width:4px; height:32px; border-radius:2px; flex-shrink:0; background:${color};"></div>
          <span style="font-size:24px; font-weight:600; color:#eee8f4; letter-spacing:0.04em; flex:1;">
            ${words[i].toLowerCase()}
          </span>
          <span style="font-size:17px; font-weight:600; color:${color}; font-variant-numeric:tabular-nums; flex-shrink:0;">
            ${checksums[i]}
          </span>
        </div>`;
    }

    state._speakerDiv.innerHTML = html;
  }

  // ═══ RECEIVER MODE (normal entry — input fields) ═══
  function buildReceiverMode(entry, gridKey, state, wordlist) {

    // Geo feedback bar
    const geoBar = document.createElement('div');
    geoBar.className = 'bip39-geo-bar';
    geoBar.style.cssText = 'display:none; font-size:13px; font-weight:600; padding:6px 10px; margin-bottom:6px; border-radius:4px; background:#1e3a5f; border:1px solid #3b82f6; color:#fff;';
    entry.appendChild(geoBar);

    // Word slots
    const slotsContainer = document.createElement('div');
    slotsContainer.style.cssText = 'display:flex; flex-direction:column; gap:4px;';

    state.inputEls = [];

    for (let i = 0; i < 4; i++) {
      const row = document.createElement('div');
      row.className = 'bip39-slot-row';
      row.style.cssText = 'display:flex; align-items:center; gap:5px; position:relative;';

      // Color pip
      const pip = document.createElement('div');
      pip.className = 'bip39-pip';
      pip.dataset.slot = i;
      pip.style.cssText = `width:8px; height:8px; border-radius:2px; flex-shrink:0; border:2px solid #334155; transition:all 0.2s;`;
      row.appendChild(pip);

      // Input (shown when unlocked)
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'bip39-word-input';
      input.dataset.slot = i;
      input.placeholder = RESOLUTION[i].label.toLowerCase();
      input.autocomplete = 'off';
      input.autocorrect = 'off';
      input.autocapitalize = 'off';
      input.spellcheck = false;
      input.style.cssText = 'flex:1; padding:4px 8px; background:var(--ios-light-gray, #131620); border:1px solid var(--ios-separator, #1e293b); border-radius:4px; color:var(--ios-text, #e2e8f0); font-size:13px; font-weight:500; font-family:inherit; outline:none;';
      row.appendChild(input);
      state.inputEls.push(input);

      // Locked display (hidden initially)
      const locked = document.createElement('div');
      locked.className = 'bip39-locked';
      locked.dataset.slot = i;
      locked.style.cssText = 'display:none; flex:1; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:13px; font-weight:600; border:1px solid transparent; transition:all 0.2s;';
      row.appendChild(locked);

      // Running checksum + filter button container
      const csWrap = document.createElement('div');
      csWrap.style.cssText = 'display:flex; align-items:center; gap:2px; flex-shrink:0;';

      const cs = document.createElement('div');
      cs.className = 'bip39-running-cs';
      cs.dataset.slot = i;
      cs.style.cssText = 'font-size:10px; font-weight:700; font-variant-numeric:tabular-nums; color:#1e293b; min-width:28px; text-align:right;';
      cs.textContent = '···';
      csWrap.appendChild(cs);

      // ⋯ button — opens checksum filter for this slot
      const csFilterBtn = document.createElement('button');
      csFilterBtn.className = 'bip39-cs-filter-btn';
      csFilterBtn.dataset.slot = i;
      csFilterBtn.textContent = '⋯';
      csFilterBtn.title = 'Filter by checksum';
      csFilterBtn.style.cssText = 'display:none; background:transparent; border:1px solid #334155; border-radius:3px; color:#64748b; font-size:12px; font-weight:700; padding:1px 4px; cursor:pointer; font-family:inherit; line-height:1;';
      csWrap.appendChild(csFilterBtn);

      row.appendChild(csWrap);

      // Checksum filter input (hidden, shown when ⋯ tapped)
      const csFilterRow = document.createElement('div');
      csFilterRow.className = 'bip39-cs-filter-row';
      csFilterRow.dataset.slot = i;
      csFilterRow.style.cssText = 'display:none; position:absolute; right:0; top:-2px; z-index:25; background:#1a1f2e; border:1px solid var(--accent, #f59e0b); border-radius:4px; padding:3px 5px; display:none; align-items:center; gap:3px;';
      csFilterRow.innerHTML = `
        <input class="bip39-cs-filter-input" data-slot="${i}" inputmode="numeric" maxlength="3" placeholder="___"
          style="width:38px; padding:2px 4px; text-align:center; background:#0d1117; border:1px solid #475569; border-radius:3px; color:#fbbf24; font-size:13px; font-weight:700; font-family:inherit; outline:none; letter-spacing:0.15em; font-variant-numeric:tabular-nums;">
        <button class="bip39-cs-filter-close" data-slot="${i}" style="background:transparent; border:none; color:#64748b; font-size:14px; cursor:pointer; padding:0 2px;">✕</button>
      `;
      row.appendChild(csFilterRow);

      // Autocomplete dropdown (hidden)
      const dropdown = document.createElement('div');
      dropdown.className = 'bip39-autocomplete';
      dropdown.dataset.slot = i;
      dropdown.style.cssText = 'display:none; position:absolute; left:13px; right:0; top:100%; z-index:20; margin-top:2px; background:var(--ios-card, #1a1f2e); border:1px solid var(--ios-separator, #334155); border-radius:4px; max-height:120px; overflow-y:auto; box-shadow:0 6px 20px rgba(0,0,0,0.5);';
      row.appendChild(dropdown);

      slotsContainer.appendChild(row);
    }
    entry.appendChild(slotsContainer);

    // Checksum readout panel
    const csPanel = document.createElement('div');
    csPanel.className = 'bip39-cs-panel';
    csPanel.style.cssText = 'margin-top:8px; padding:8px 10px; border-radius:5px; background:rgba(13,17,23,0.8); border:1px solid var(--ios-separator, #1e293b); transition:all 0.3s;';
    entry.appendChild(csPanel);

    // Error results container
    const errorBox = document.createElement('div');
    errorBox.className = 'bip39-error-box';
    errorBox.style.cssText = 'display:none; margin-top:6px;';
    entry.appendChild(errorBox);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'bip39-entry-footer';
    footer.style.cssText = 'margin-top:6px; display:flex; align-items:center; justify-content:space-between;';
    
    const footerCode = document.createElement('div');
    footerCode.className = 'bip39-footer-code';
    footerCode.style.cssText = 'font-size:10px; color:#334155; font-variant-numeric:tabular-nums;';
    footer.appendChild(footerCode);
    
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'CLEAR';
    clearBtn.className = 'bip39-clear-btn';
    clearBtn.style.cssText = 'background:transparent; border:1px solid var(--ios-separator, #1e293b); border-radius:3px; padding:2px 6px; cursor:pointer; font-size:8px; color:var(--ios-secondary, #475569); font-family:inherit; font-weight:600;';
    clearBtn.onclick = () => resetEntry(gridKey);
    footer.appendChild(clearBtn);
    
    entry.appendChild(footer);
  }

  // ============== EVENT HANDLERS ==============

  // Character filter for word input — CJK grids need wider Unicode ranges
  function filterInputChars(value, gridKey) {
    const gridDef = getGridInfo(gridKey);
    const isCJK = gridKey && (gridKey.includes('japanese') || gridKey.includes('korean') || 
                   gridKey.includes('chinese'));
    if (isCJK) {
      // Strip delimiters (、。・-, space) but keep CJK, hiragana, katakana, hangul
      return value.replace(/[\s\-,、。・\u30FB\uFF0C]/g, '');
    }
    // Latin grids: keep letters + accented Latin, strip everything else
    return value.replace(/[^a-zA-Z\u00C0-\u024F]/g, '').toLowerCase();
  }

  function wireEventHandlers(gridKey, wordlist) {
    const state = getState(gridKey);

    state.inputEls.forEach((input, i) => {
      input.addEventListener('input', () => {
        if (state.locked[i] !== null) { input.value = ''; return; }
        state.words[i] = filterInputChars(input.value, gridKey);
        input.value = state.words[i];
        updateAutocomplete(gridKey, i, wordlist);
      });

      input.addEventListener('keydown', (e) => {
        // Space, Tab, or Enter = lock top suggestion
        if ((e.key === ' ' || e.key === 'Tab' || e.key === 'Enter') && state.suggestions.length > 0 && state.words[i].length >= 1) {
          e.preventDefault();
          lockWord(gridKey, i, state.suggestions[0], wordlist);
        }
        // Backspace on empty = unlock previous
        if (e.key === 'Backspace' && state.words[i] === '' && i > 0 && state.locked[i - 1] !== null) {
          unlockWord(gridKey, i - 1);
        }
      });

      input.addEventListener('focus', () => {
        if (state.locked[i] !== null) return;
        state.activeSlot = i;
        updateAutocomplete(gridKey, i, wordlist);
        updateSlotVisuals(gridKey);
      });
    });

    // ⋯ checksum filter buttons
    state.entryEl.querySelectorAll('.bip39-cs-filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const slot = parseInt(btn.dataset.slot);
        const filterRow = state.entryEl.querySelector(`.bip39-cs-filter-row[data-slot="${slot}"]`);
        if (filterRow) {
          filterRow.style.display = 'flex';
          const filterInput = filterRow.querySelector('.bip39-cs-filter-input');
          if (filterInput) { filterInput.value = ''; filterInput.focus(); }
        }
      });
    });

    // Checksum filter inputs
    state.entryEl.querySelectorAll('.bip39-cs-filter-input').forEach(filterInput => {
      filterInput.addEventListener('input', () => {
        const slot = parseInt(filterInput.dataset.slot);
        state.csFilter = filterInput.value.replace(/[^0-9]/g, '').slice(0, 3);
        filterInput.value = state.csFilter;
        state.csFilterSlot = slot;
        // When 3 digits entered, filter the autocomplete by checksum
        if (state.csFilter.length === 3) {
          updateAutocomplete(gridKey, slot, wordlist);
        } else if (state.csFilter.length === 0) {
          updateAutocomplete(gridKey, slot, wordlist);
        }
      });
    });

    // Checksum filter close buttons
    state.entryEl.querySelectorAll('.bip39-cs-filter-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const slot = parseInt(btn.dataset.slot);
        state.csFilter = '';
        state.csFilterSlot = -1;
        const filterRow = state.entryEl.querySelector(`.bip39-cs-filter-row[data-slot="${slot}"]`);
        if (filterRow) filterRow.style.display = 'none';
        updateAutocomplete(gridKey, slot, wordlist);
        state.inputEls[slot]?.focus();
      });
    });
  }

  // ============== AUTOCOMPLETE ==============

  function updateAutocomplete(gridKey, slot, wordlist) {
    const state = getState(gridKey);
    let filtered = getFilteredWords(state.words[slot], wordlist);

    // If checksum filter is active for this slot, filter by matching checksum
    if (state.csFilterSlot === slot && state.csFilter.length === 3) {
      const targetCs = state.csFilter;
      // When filtering by checksum, show ALL matching words (not just prefix matches)
      const candidates = state.words[slot].length >= 1 ? filtered : wordlist;
      filtered = candidates.filter(w => checksumForCandidate(state.locked, slot, w, wordlist) === targetCs);
    }

    state.suggestions = filtered;

    const dropdown = state.entryEl.querySelector(`.bip39-autocomplete[data-slot="${slot}"]`);
    if (!dropdown) return;

    const hasFilter = state.csFilterSlot === slot && state.csFilter.length === 3;
    if (filtered.length === 0 || state.locked[slot] !== null || (state.words[slot].length < 1 && !hasFilter)) {
      dropdown.style.display = 'none';
      return;
    }

    // NO auto-lock. User must press Space, Tab, Enter, or click.
    // This prevents "sand" eating the "d" into slot 2.

    dropdown.style.display = 'block';
    dropdown.innerHTML = '';
    filtered.forEach((w, si) => {
      const item = document.createElement('div');
      item.style.cssText = `display:flex; align-items:center; justify-content:space-between; padding:7px 10px; cursor:pointer; font-size:15px; font-weight:${si === 0 ? 700 : 500}; color:#fff; background:${si === 0 ? '#334155' : '#1e293b'}; border-bottom:1px solid rgba(255,255,255,0.08);`;
      
      const matchLen = state.words[slot].length;
      const cs = checksumForCandidate(state.locked, slot, w, wordlist);
      item.innerHTML = `
        <span><span style="color:#fbbf24; font-weight:700;">${w.slice(0, matchLen)}</span><span style="color:#e2e8f0;">${w.slice(matchLen)}</span></span>
        <span style="font-size:11px; font-weight:600; color:#94a3b8; font-variant-numeric:tabular-nums; margin-left:8px;">${cs}</span>`;
      
      item.onmouseenter = () => item.style.background = '#475569';
      item.onmouseleave = () => item.style.background = si === 0 ? '#334155' : '#1e293b';
      item.onclick = () => lockWord(gridKey, slot, w, wordlist);
      dropdown.appendChild(item);
    });
  }

  function hideAllDropdowns(gridKey) {
    const state = getState(gridKey);
    if (!state.entryEl) return;
    state.entryEl.querySelectorAll('.bip39-autocomplete').forEach(d => d.style.display = 'none');
  }

  // ============== LOCK / UNLOCK ==============

  function lockWord(gridKey, slot, word, wordlist) {
    const state = getState(gridKey);
    state.locked[slot] = word;
    state.words[slot] = word;
    state.suggestions = [];
    state.errorSearch = null;
    hideAllDropdowns(gridKey);

    // Check if all locked → confirm
    const allLocked = state.locked.every(w => w !== null);
    if (allLocked && state.csStatus === 'building') {
      state.csStatus = 'confirm';
    }

    updateSlotVisuals(gridKey);
    updateChecksumPanel(gridKey);
    updateGeoBar(gridKey, wordlist);
    updateFooter(gridKey);
    updateMapRect(state, gridKey);

    // Auto-advance to next slot
    if (slot < 3) {
      state.activeSlot = slot + 1;
      // Ensure the next input is visible and ready
      const nextInput = state.inputEls[slot + 1];
      if (nextInput) {
        nextInput.style.display = 'block';
        nextInput.value = '';
        state.words[slot + 1] = '';
        // Use rAF to focus after the DOM has updated from updateSlotVisuals
        requestAnimationFrame(() => {
          nextInput.focus();
          // Update visuals again to highlight the new active slot
          updateSlotVisuals(gridKey);
        });
      }
    }
  }

  function unlockWord(gridKey, slot) {
    const state = getState(gridKey);
    state.locked[slot] = null;
    state.words[slot] = '';
    state.csStatus = 'building';
    state.callerCs = '';
    state.confirmedSlots = [false, false, false, false];
    state.interrogateStep = 0;
    state.errorSearch = null;
    state.activeSlot = slot;

    updateSlotVisuals(gridKey);
    updateChecksumPanel(gridKey);
    updateGeoBar(gridKey, getWordlist(gridKey));
    updateFooter(gridKey);
    updateMapRect(state, gridKey);

    setTimeout(() => {
      const input = state.inputEls[slot];
      if (input) { input.value = ''; input.focus(); }
    }, 50);
  }

  function resetEntry(gridKey) {
    const state = getState(gridKey);
    state.words = ['', '', '', ''];
    state.locked = [null, null, null, null];
    state.activeSlot = 0;
    state.csStatus = 'building';
    state.callerCs = '';
    state.confirmedSlots = [false, false, false, false];
    state.interrogateStep = 0;
    state.errorSearch = null;
    state.suggestions = [];
    state.csFilter = '';
    state.csFilterSlot = -1;

    state.inputEls.forEach(input => { input.value = ''; });
    hideAllDropdowns(gridKey);
    // Hide any open checksum filter rows
    if (state.entryEl) {
      state.entryEl.querySelectorAll('.bip39-cs-filter-row').forEach(r => r.style.display = 'none');
    }
    updateSlotVisuals(gridKey);
    updateChecksumPanel(gridKey);
    updateGeoBar(gridKey, getWordlist(gridKey));
    updateFooter(gridKey);
    updateMapRect(state, gridKey);

    setTimeout(() => state.inputEls[0]?.focus(), 50);
  }

  // ============== VISUAL UPDATES ==============

  function updateSlotVisuals(gridKey) {
    const state = getState(gridKey);
    if (!state.entryEl) return;

    for (let i = 0; i < 4; i++) {
      const pip = state.entryEl.querySelector(`.bip39-pip[data-slot="${i}"]`);
      const input = state.inputEls[i];
      const lockedEl = state.entryEl.querySelector(`.bip39-locked[data-slot="${i}"]`);
      const csEl = state.entryEl.querySelector(`.bip39-running-cs[data-slot="${i}"]`);
      const isLocked = state.locked[i] !== null;
      const isActive = i === state.activeSlot && !isLocked;
      const isError = state.errorSearch?.slot === i;
      const color = RESOLUTION[i].color;

      // Pip
      if (pip) {
        pip.style.background = isError ? '#ef4444' : isLocked ? color : 'transparent';
        pip.style.borderColor = isError ? '#ef4444' : isLocked ? color : isActive ? 'var(--accent, #f59e0b)' : '#334155';
      }

      // Input vs locked display
      if (isLocked) {
        input.style.display = 'none';
        lockedEl.style.display = 'flex';
        // EMERGENCY CONTRAST: solid light background, dark bold text
        lockedEl.style.background = isError ? '#fecaca' : color === '#3b82f6' ? '#bfdbfe' : color === '#22d3ee' ? '#a5f3fc' : color === '#a78bfa' ? '#ddd6fe' : '#bbf7d0';
        lockedEl.style.borderColor = isError ? '#dc2626' : color;
        lockedEl.style.color = isError ? '#991b1b' : '#1e293b';
        lockedEl.style.fontWeight = '700';
        lockedEl.style.fontSize = '15px';
        lockedEl.style.textShadow = 'none';
        lockedEl.textContent = state.locked[i];
        lockedEl.onclick = () => unlockWord(gridKey, i);
      } else {
        input.style.display = 'block';
        lockedEl.style.display = 'none';
        input.style.borderColor = isActive ? 'var(--accent, #f59e0b)' : 'var(--ios-separator, #1e293b)';
      }

      // Running checksum — use the resolution colour so it's visible on any background
      const checksums = getRunningChecksums(state.locked, gridKey);
      if (csEl) {
        csEl.textContent = checksums[i] || '···';
        csEl.style.color = isError ? '#f87171' : (isLocked && checksums[i]) ? color : checksums[i] ? '#94a3b8' : '#475569';
        csEl.style.fontSize = checksums[i] ? '14px' : '10px';
        csEl.style.fontWeight = '700';
      }

      // ⋯ filter button — show for active unlocked slots
      const filterBtn = state.entryEl.querySelector(`.bip39-cs-filter-btn[data-slot="${i}"]`);
      if (filterBtn) {
        filterBtn.style.display = (isActive && !isLocked) ? 'inline-block' : 'none';
      }

      // Hide filter row when slot gets locked
      if (isLocked) {
        const filterRow = state.entryEl.querySelector(`.bip39-cs-filter-row[data-slot="${i}"]`);
        if (filterRow) filterRow.style.display = 'none';
        if (state.csFilterSlot === i) { state.csFilter = ''; state.csFilterSlot = -1; }
      }
    }
  }

  function updateGeoBar(gridKey, wordlist) {
    // Async geo update — word 1 is instant (static), words 2+ hit Nominatim
    updateGeoForLockedWords(gridKey);
  }

  function updateChecksumPanel(gridKey) {
    const state = getState(gridKey);
    const panel = state.entryEl?.querySelector('.bip39-cs-panel');
    if (!panel) return;

    const checksums = getRunningChecksums(state.locked, gridKey);
    const lockedCount = state.locked.filter(w => w !== null).length;
    const allLocked = lockedCount === 4;
    const finalCs = checksums[3];

    // EMERGENCY CONTRAST — bold colours, big text, no ambiguity
    const statusColors = {
      building: '#94a3b8', confirm: '#fbbf24',
      pass: '#4ade80', mismatch: '#f87171', interrogate: '#60a5fa'
    };
    const statusLabels = {
      building: lockedCount === 0 ? 'CHECKSUM' : 'BUILDING',
      confirm: 'CONFIRM WITH SENDER',
      pass: 'CONFIRMED',
      mismatch: 'MISMATCH',
      interrogate: 'CHECKING WORDS'
    };

    const displayCs = finalCs || (lockedCount > 0 ? checksums[lockedCount - 1] : '---');
    const csColor = state.csStatus === 'pass' ? '#4ade80' : state.csStatus === 'mismatch' || state.csStatus === 'interrogate' ? '#f87171' : finalCs ? '#fff' : '#94a3b8';

    let html = `
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="flex:1;">
          <div style="font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:${statusColors[state.csStatus]}; margin-bottom:4px;">
            ${statusLabels[state.csStatus]}
          </div>
          <div style="display:flex; align-items:baseline; gap:4px;">
            <span style="font-size:14px; color:#64748b;">.</span>
            <span style="font-size:32px; font-weight:800; letter-spacing:0.18em; font-variant-numeric:tabular-nums; color:${csColor};">
              ${displayCs}
            </span>
            ${!finalCs && lockedCount > 0 ? `<span style="font-size:12px; color:#94a3b8; font-weight:500;">${lockedCount}/4</span>` : ''}
          </div>
        </div>`;

    // Action buttons — BIG, high contrast
    if (state.csStatus === 'confirm') {
      html += `
        <div style="display:flex; gap:6px; flex-shrink:0;">
          <button class="bip39-cs-yes" style="background:#166534; border:2px solid #4ade80; color:#fff; font-size:13px; font-weight:700; padding:8px 14px; border-radius:6px; cursor:pointer; font-family:inherit;">YES ✓</button>
          <button class="bip39-cs-no" style="background:#991b1b; border:2px solid #f87171; color:#fff; font-size:13px; font-weight:700; padding:8px 14px; border-radius:6px; cursor:pointer; font-family:inherit;">NO ✗</button>
        </div>`;
    } else if (state.csStatus === 'pass') {
      html += `<span style="font-size:28px; color:#4ade80;">✓</span>`;
    }

    html += `</div>`;

    // Pass state: show full code + Open in Maps link
    if (state.csStatus === 'pass') {
      const bounds = computeBounds(state.locked, gridKey);
      const lat = ((bounds.latMin + bounds.latMax) / 2).toFixed(6);
      const lon = ((bounds.lonMin + bounds.lonMax) / 2).toFixed(6);
      const codeStr = state.locked.join('-').toLowerCase() + '.' + finalCs;
      // Detect iOS for dual Apple Maps + Google Maps buttons
      const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 0);
      const googleUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
      const appleUrl = `maps://maps.apple.com/?q=${encodeURIComponent(codeStr)}&ll=${lat},${lon}`;

      let mapsButtons;
      if (isApple) {
        mapsButtons = `
          <div style="display:flex; gap:6px; justify-content:center; flex-wrap:wrap;">
            <a href="${appleUrl}" target="_blank" rel="noopener"
              style="display:inline-block; padding:8px 14px; background:#166534; border:2px solid #4ade80; border-radius:6px; color:#fff; font-size:12px; font-weight:700; text-decoration:none; font-family:inherit;">
              🍎 Apple Maps
            </a>
            <a href="${googleUrl}" target="_blank" rel="noopener"
              style="display:inline-block; padding:8px 14px; background:#1e3a5f; border:2px solid #3b82f6; border-radius:6px; color:#fff; font-size:12px; font-weight:700; text-decoration:none; font-family:inherit;">
              📍 Google Maps
            </a>
          </div>`;
      } else {
        mapsButtons = `
          <a href="${googleUrl}" target="_blank" rel="noopener"
            style="display:inline-block; padding:8px 16px; background:#166534; border:2px solid #4ade80; border-radius:6px; color:#fff; font-size:12px; font-weight:700; text-decoration:none; font-family:inherit;">
            📍 Open in Google Maps
          </a>`;
      }

      html += `
        <div style="margin-top:8px; padding:6px 0 2px; border-top:1px solid rgba(22,101,52,0.2); text-align:center;">
          <div style="font-size:13px; color:#86efac; font-weight:600; margin-bottom:6px;">
            ${codeStr}
          </div>
          ${mapsButtons}
          <div style="font-size:9px; color:#64748b; margin-top:4px;">${lat}, ${lon}</div>
        </div>`;
    }

    // Mismatch: enter caller's checksum
    if (state.csStatus === 'mismatch') {
      html += `
        <div style="margin-top:8px; display:flex; gap:5px; align-items:center;">
          <span style="font-size:11px; color:#e2e8f0; font-weight:600;">Sender's:</span>
          <input class="bip39-caller-cs" value="${state.callerCs}" inputmode="numeric" maxlength="3" placeholder="___"
            style="width:52px; padding:4px 6px; text-align:center; background:var(--ios-light-gray, #0d1117); border:1px solid var(--accent, #f59e0b); border-radius:3px; color:var(--accent, #f59e0b); font-size:16px; font-weight:700; font-family:inherit; outline:none; letter-spacing:0.2em; font-variant-numeric:tabular-nums;">
          <button class="bip39-find-error" style="background:var(--accent, #f59e0b); border:none; border-radius:3px; color:#0a0c10; font-size:9px; font-weight:700; padding:5px 8px; cursor:pointer; font-family:inherit;">FIND</button>
          <button class="bip39-cs-back" style="background:transparent; border:1px solid #334155; border-radius:3px; color:#475569; font-size:8px; font-weight:600; padding:5px 6px; cursor:pointer; font-family:inherit;">BACK</button>
        </div>`;
    }

    // Interrogation
    if (state.csStatus === 'interrogate' && !state.errorSearch) {
      html += '<div style="margin-top:8px;">';
      const wordlist = getWordlist(gridKey);
      const checksums = getRunningChecksums(state.locked, gridKey);
      for (let i = 0; i < 4; i++) {
        const isConf = state.confirmedSlots[i];
        const isCurr = state.interrogateStep === i && !isConf;
        const isPend = i > state.interrogateStep && !isConf;
        const geo = getGeoForPosition(state.locked, i, gridKey);

        html += `
          <div style="display:flex; align-items:center; gap:8px; padding:8px 4px; ${i > 0 ? 'border-top:1px solid rgba(255,255,255,0.1);' : ''} opacity:${isPend ? 0.25 : 1};">
            <div style="width:22px; height:22px; border-radius:4px; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; background:${isConf ? '#166534' : isCurr ? '#78350f' : '#1e293b'}; border:2px solid ${isConf ? '#4ade80' : isCurr ? '#fbbf24' : '#475569'}; color:${isConf ? '#4ade80' : isCurr ? '#fbbf24' : '#64748b'};">
              ${isConf ? '✓' : (i + 1)}
            </div>
            <div style="flex:1; min-width:0;">
              <span style="font-size:15px; font-weight:700; color:${isConf ? '#4ade80' : '#fff'};">${state.locked[i]}</span>
              ${geo ? `<div style="font-size:11px; color:${isConf ? '#86efac' : '#93c5fd'}; font-weight:500; margin-top:1px;">${geo}</div>` : ''}
            </div>
            <span style="font-size:14px; font-weight:700; font-variant-numeric:tabular-nums; color:${isConf ? '#4ade80' : '#94a3b8'}; flex-shrink:0; min-width:32px; text-align:right;">${checksums[i] || ''}</span>
            ${isCurr ? `
              <div style="display:flex; gap:5px; flex-shrink:0;">
                <button class="bip39-word-yes" data-slot="${i}" style="background:#166534; border:2px solid #4ade80; color:#fff; font-size:12px; font-weight:700; padding:6px 12px; border-radius:5px; cursor:pointer; font-family:inherit;">YES</button>
                <button class="bip39-word-no" data-slot="${i}" style="background:#991b1b; border:2px solid #f87171; color:#fff; font-size:12px; font-weight:700; padding:6px 12px; border-radius:5px; cursor:pointer; font-family:inherit;">NO</button>
              </div>` : ''}
          </div>`;
      }
      html += '</div>';
    }

    panel.innerHTML = html;

    // Wire checksum panel buttons
    panel.querySelector('.bip39-cs-yes')?.addEventListener('click', () => {
      state.csStatus = 'pass';
      updateChecksumPanel(gridKey);
    });
    panel.querySelector('.bip39-cs-no')?.addEventListener('click', () => {
      state.csStatus = 'mismatch';
      updateChecksumPanel(gridKey);
      setTimeout(() => panel.querySelector('.bip39-caller-cs')?.focus(), 100);
    });
    panel.querySelector('.bip39-cs-back')?.addEventListener('click', () => {
      state.csStatus = 'confirm';
      state.callerCs = '';
      state.errorSearch = null;
      updateChecksumPanel(gridKey);
    });

    const callerInput = panel.querySelector('.bip39-caller-cs');
    if (callerInput) {
      callerInput.addEventListener('input', () => {
        state.callerCs = callerInput.value.replace(/[^0-9]/g, '').slice(0, 3);
        callerInput.value = state.callerCs;
      });
      callerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') startInterrogation(gridKey);
      });
    }
    panel.querySelector('.bip39-find-error')?.addEventListener('click', () => startInterrogation(gridKey));

    // Interrogation buttons
    panel.querySelectorAll('.bip39-word-yes').forEach(btn => {
      btn.addEventListener('click', () => confirmWordInInterrogation(gridKey, parseInt(btn.dataset.slot)));
    });
    panel.querySelectorAll('.bip39-word-no').forEach(btn => {
      btn.addEventListener('click', () => rejectWordInInterrogation(gridKey, parseInt(btn.dataset.slot)));
    });
  }

  function updateFooter(gridKey) {
    const state = getState(gridKey);
    const footerCode = state.entryEl?.querySelector('.bip39-footer-code');
    if (!footerCode) return;
    const lockedCount = state.locked.filter(w => w !== null).length;
    const checksums = getRunningChecksums(state.locked, gridKey);
    if (lockedCount === 4) {
      footerCode.textContent = `${state.locked.join('-').toLowerCase()}.${checksums[3]}`;
    } else {
      footerCode.textContent = `${lockedCount}/4`;
    }
  }

  // ============== INTERROGATION / ERROR CORRECTION ==============

  function startInterrogation(gridKey) {
    const state = getState(gridKey);
    if (state.callerCs.length !== 3) return;
    state.csStatus = 'interrogate';
    state.confirmedSlots = [false, false, false, false];
    state.interrogateStep = 0;
    state.errorSearch = null;
    updateChecksumPanel(gridKey);
  }

  function confirmWordInInterrogation(gridKey, slot) {
    const state = getState(gridKey);
    state.confirmedSlots[slot] = true;
    if (slot < 3) {
      state.interrogateStep = slot + 1;
    } else {
      state.errorSearch = { slot: -1, candidates: [], callerFinalCs: state.callerCs };
    }
    updateChecksumPanel(gridKey);
    updateErrorBox(gridKey);
  }

  function rejectWordInInterrogation(gridKey, slot) {
    const state = getState(gridKey);
    const wordlist = getWordlist(gridKey);
    const before = state.locked.slice(0, slot).join('');
    const after = state.locked.slice(slot + 1).join('');
    const candidates = [];
    for (const w of wordlist) {
      if (w === state.locked[slot]) continue;
      if (computeChecksum(before + w + after, wordlist) === state.callerCs) candidates.push(w);
    }
    state.errorSearch = { slot, candidates, callerFinalCs: state.callerCs };
    updateSlotVisuals(gridKey);
    updateChecksumPanel(gridKey);
    updateErrorBox(gridKey);
  }

  function updateErrorBox(gridKey) {
    const state = getState(gridKey);
    const box = state.entryEl?.querySelector('.bip39-error-box');
    if (!box) return;
    const wordlist = getWordlist(gridKey);

    if (!state.errorSearch) {
      box.style.display = 'none';
      return;
    }

    box.style.display = 'block';

    if (state.errorSearch.slot >= 0 && state.errorSearch.candidates.length > 0) {
      box.style.cssText = 'display:block; margin-top:8px; padding:10px 12px; border-radius:6px; background:#1c1917; border:2px solid #f59e0b;';
      const slot = state.errorSearch.slot;
      const origCs = checksumForCandidate(state.locked, slot, state.locked[slot], wordlist);
      let html = `<div style="font-size:12px; font-weight:700; color:#fbbf24; margin-bottom:8px;">
        WORD ${slot + 1}: "${state.locked[slot]} <span style="color:#f87171;">${origCs}</span>" → REPLACE WITH:
      </div>`;
      
      // Build candidate buttons — each is a row with word + geo + checksum
      state.errorSearch.candidates.forEach(c => {
        const candCs = checksumForCandidate(state.locked, slot, c, wordlist);
        html += `
          <div class="bip39-correction-row" data-word="${c}" style="display:flex; align-items:center; gap:10px; padding:8px 10px; margin-bottom:4px; background:#334155; border:2px solid #64748b; border-radius:6px; cursor:pointer;">
            <span style="font-size:18px; font-weight:800; color:#fff; min-width:80px;">${c}</span>
            <span class="bip39-correction-geo" data-candidate="${c}" style="flex:1; font-size:11px; color:#94a3b8; font-weight:500;">looking up...</span>
            <span style="font-size:13px; font-weight:700; color:#94a3b8; font-variant-numeric:tabular-nums; flex-shrink:0;">${candCs}</span>
          </div>`;
      });
      
      box.innerHTML = html;

      // Wire click handlers
      box.querySelectorAll('.bip39-correction-row').forEach(row => {
        row.addEventListener('click', () => {
          applyCorrection(gridKey, slot, row.dataset.word);
        });
        row.addEventListener('mouseenter', () => row.style.borderColor = '#fbbf24');
        row.addEventListener('mouseleave', () => row.style.borderColor = '#64748b');
      });

      // Async: look up geo for each candidate
      lookupCandidateGeo(gridKey, state.errorSearch.slot, state.errorSearch.candidates, box);

    } else if (state.errorSearch.slot === -1) {
      box.style.cssText = 'display:block; margin-top:8px; padding:10px 12px; border-radius:6px; background:#450a0a; border:2px solid #f87171; font-size:13px; color:#fff; font-weight:600;';
      box.textContent = 'All words confirmed but checksum still wrong. Multiple errors likely — re-enter from word 1.';
    } else {
      box.style.cssText = 'display:block; margin-top:8px; padding:10px 12px; border-radius:6px; background:#1c1917; border:2px solid #78350f; font-size:13px; color:#fca5a5; font-weight:600;';
      box.textContent = 'No candidates found. Tap the word above to re-enter manually.';
    }
  }

  // Look up geo context for each correction candidate (async, fills in as results arrive)
  async function lookupCandidateGeo(gridKey, slot, candidates, box) {
    const state = getState(gridKey);
    const wordlist = getWordlist(gridKey);

    for (const candidate of candidates) {
      // Build the hypothetical locked array with this candidate in the slot
      const testLocked = [...state.locked];
      testLocked[slot] = candidate;

      // Compute bounds for the 2-word centroid (city level) for a quick meaningful descriptor
      const depth = Math.min(slot + 1, 4);
      const bounds = computeBounds(testLocked.slice(0, depth), gridKey);
      const lat = (bounds.latMin + bounds.latMax) / 2;
      const lon = (bounds.lonMin + bounds.lonMax) / 2;

      let descriptor = null;

      if (slot === 0 && !hasPassphraseOrObfuscation()) {
        // Word 1 candidate, no passphrase — use static lookup
        const idx = wordlist.indexOf(candidate);
        descriptor = idx >= 0 ? getGeoDescriptorStatic(idx) : null;
      } else {
        // Words 2+ (or word 1 with passphrase) — Nominatim
        const addrResult = await reverseGeocodeAddress(lat, lon);
        descriptor = formatAddressForDepth(addrResult, depth);
      }

      // Fill in the geo label (if the box is still showing the same error)
      const geoEl = box.querySelector(`.bip39-correction-geo[data-candidate="${candidate}"]`);
      if (geoEl) {
        geoEl.textContent = descriptor || '(unknown location)';
        geoEl.style.color = descriptor ? '#93c5fd' : '#64748b';
      }
    }
  }

  function applyCorrection(gridKey, slot, word) {
    const state = getState(gridKey);
    const wordlist = getWordlist(gridKey);
    state.locked[slot] = word;
    state.words[slot] = word;
    state.errorSearch = null;
    state.callerCs = '';
    state.csStatus = 'confirm';
    state.confirmedSlots = [false, false, false, false];
    state.interrogateStep = 0;

    updateSlotVisuals(gridKey);
    updateChecksumPanel(gridKey);
    updateErrorBox(gridKey);
    updateGeoBar(gridKey, wordlist);
    updateFooter(gridKey);
    updateMapRect(state, gridKey);
  }

  // ============== TOGGLE VIEW ==============

  // ✎ pen toggle — controls receiver entry view only
  function toggleView(gridKey) {
    const state = getState(gridKey);
    state.active = !state.active;

    // Close speaker view if it was open
    if (state.speakerEl) state.speakerEl.style.display = 'none';
    state.speakerActive = false;

    // Reset to clean slate every time we open entry mode
    if (state.active && state.inputEls.length > 0) {
      resetEntry(gridKey);
    }

    if (state.entryEl) state.entryEl.style.display = state.active ? 'block' : 'none';
    if (state.codeEl) state.codeEl.style.display = state.active ? 'none' : '';
    if (state.toggleBtn) {
      if (state.active) {
        state.toggleBtn.innerHTML = '✕ CLOSE';
        state.toggleBtn.style.background = '#78350f';
        state.toggleBtn.style.color = '#fbbf24';
        state.toggleBtn.title = 'Close entry mode';
      } else {
        state.toggleBtn.innerHTML = '📥 RECEIVE';
        state.toggleBtn.style.background = '#555078';
        state.toggleBtn.style.color = '#e2dff0';
        state.toggleBtn.title = 'Enter a code received from sender';
      }
    }

    if (state.active && state.inputEls.length > 0) {
      setTimeout(() => state.inputEls[0]?.focus(), 100);
    } else if (!state.active) {
      const m = getMap();
      if (m) {
        if (state.mapRect) { m.removeLayer(state.mapRect); state.mapRect = null; }
        if (state.mapPin) { m.removeLayer(state.mapPin); state.mapPin = null; }
      }
    }
  }

  // ✓ tick toggle — handled by card-renderer.js which calls renderCards().
  // When checksumEnabled is toggled, renderCards rebuilds the card, attach() runs again,
  // and the speaker view is rebuilt. We just need to detect when it's on and auto-show
  // the speaker view. This is done via toggleSpeaker(), called from attach().
  function toggleSpeaker(gridKey, show) {
    const state = getState(gridKey);
    state.speakerActive = show;

    // Close entry view if open
    if (show && state.active) {
      state.active = false;
      if (state.entryEl) state.entryEl.style.display = 'none';
      if (state.toggleBtn) {
        state.toggleBtn.innerHTML = '📥 RECEIVE';
        state.toggleBtn.style.background = '#555078';
        state.toggleBtn.style.color = '#e2dff0';
      }
    }

    if (state.speakerEl) state.speakerEl.style.display = show ? 'block' : 'none';
    if (state.codeEl) state.codeEl.style.display = show ? 'none' : '';

    if (show) updateSpeakerMode(gridKey);
  }

  // ============== PUBLIC API ==============

  global.BIP39Entry = {
    /**
     * Attach entry UI to a BIP39 card element.
     * Call from card-renderer.js renderCards() after creating the card DOM.
     * 
     * @param {HTMLElement} card — the .format-card element
     * @param {string} gridKey — e.g. 'bip39english'
     */
    attach(card, gridKey) {
      const gridDef = getGridInfo(gridKey);
      if (!gridDef?.prefixLength) return; // only BIP39 grids

      const state = getState(gridKey);
      card.dataset.gridKey = gridKey;

      // Note: checksumEnabled[gridKey] controls speaker readout only.
      // The .246 checksum suffix always appears in the code display
      // (handled by card-renderer.js). Default is false (speaker hidden).

      // Add 📥 RECEIVE toggle button to card header
      const titleEl = card.querySelector('.card-title');
      if (titleEl && !titleEl.querySelector('.bip39-entry-toggle')) {
        const toggle = document.createElement('button');
        toggle.className = 'audio-speaker-btn bip39-entry-toggle';
        toggle.innerHTML = '📥 RECEIVE';
        toggle.title = 'Enter a code received from sender';
        toggle.style.cssText = "margin-left:4px; background:#555078; border:none; border-radius:6px; color:#e2dff0; font-size:10px; font-weight:700; padding:4px 8px; cursor:pointer; font-family:inherit; letter-spacing:0.04em;";
        toggle.onclick = (e) => { e.stopPropagation(); toggleView(gridKey); };
        titleEl.appendChild(toggle);
        state.toggleBtn = toggle;
      }

      // Build both entry + speaker views
      buildEntryDOM(card, gridKey);

      // If ✓ checksum is toggled on, auto-show the speaker readout
      if (isChecksumEnabled(gridKey)) {
        toggleSpeaker(gridKey, true);
      }
    },

    /**
     * Called when coordinate changes externally (map tap, GPS).
     * Updates the code display if entry view is not active.
     */
    onCoordUpdate(gridKey, code) {
      const state = getState(gridKey);
      if (state.speakerActive && state._speakerDiv) {
        updateSpeakerMode(gridKey);
      }
    },

    /**
     * Check if entry view is active for a grid
     */
    isActive(gridKey) {
      return getState(gridKey).active;
    },

    /**
     * Get version
     */
    version: 'v1.0'
  };

  try { console.log('[geosonify] bip39-entry v1.0 loaded'); } catch(e) {}

  // Listen for coordinate updates to refresh speaker mode
  if (typeof window !== 'undefined') {
    window.addEventListener('geosonify:coordUpdate', (e) => {
      const gridKey = e.detail?.gridKey;
      if (gridKey && entryStates.has(gridKey)) {
        const state = getState(gridKey);
        if (state.speakerActive && state._speakerDiv) {
          updateSpeakerMode(gridKey);
        }
      }
    });
  }
})(typeof window !== 'undefined' ? window : this);
