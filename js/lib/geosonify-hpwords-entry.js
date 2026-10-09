/**
 * geosonify-hpwords-entry.js
 *
 * 📥 RECEIVE and ✓ per-word speaker readout for the HEALPix-words cards
 * (hpbip39*). Same look, colours, flow and emergency-contrast styling as
 * geosonify-bip39-entry.js, which is deliberately NOT modified: the legacy
 * 45×45 cards keep their own proven module untouched.
 *
 * Differences from the legacy entry, all forced by the geometry:
 *   - 1–8 word slots (the card's current word count; ＋/－ in the footer).
 *   - The map shows the TRUE curved HEALPix cell after every word, dashed —
 *     a full diamond after an even count, the exact equal-area half-diamond
 *     after an odd count (never padded to a single child cell).
 *   - Running checksums and candidate search use the healpix-bip39-v1 frozen
 *     weighted checksum (HealpixWords); candidates are algebraic (≤ 3 per slot)
 *     and are only ever SUGGESTED — the receiver must tap to apply.
 *   - Word-1 hints come from reverse geocoding the cell centre (the legacy
 *     static BIP39_GEO_LOOKUP table is built on the 45×45 grid and does not
 *     apply). Suppressed in the sky frame, as in the legacy module.
 *   - Accepts any script in the inputs (the legacy filter is Latin-only).
 *
 * Depends on: HealpixWords, CardRenderer, CARD_GRIDS, Leaflet global `map`.
 */
(function (global) {
  'use strict';

  const HW = () => (typeof HealpixWords !== 'undefined' ? HealpixWords : global.HealpixWords);
  const states = new Map();

  // Slot colours: the legacy four, then four deeper shades for 5–8 words.
  const COLORS = ['#3b82f6', '#22d3ee', '#a78bfa', '#22c55e', '#f59e0b', '#f472b6', '#ef4444', '#e2e8f0'];
  const LIGHT  = { '#3b82f6': '#bfdbfe', '#22d3ee': '#a5f3fc', '#a78bfa': '#ddd6fe', '#22c55e': '#bbf7d0',
                   '#f59e0b': '#fde68a', '#f472b6': '#fbcfe8', '#ef4444': '#fecaca', '#e2e8f0': '#f1f5f9' };

  function def(gridKey) { return (typeof CARD_GRIDS !== 'undefined') ? CARD_GRIDS[gridKey] : null; }
  function lang(gridKey) { return def(gridKey)?.hpwords || 'english'; }
  function getMap() { return (typeof map !== 'undefined') ? map : (global.__geosonifyMap || null); }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function cardWords(gridKey) {
    try {
      const cs = CardRenderer.getCardState && CardRenderer.getCardState();
      const n = cs?.iterations?.[gridKey];
      return HW().clampWords(n || def(gridKey)?.defaultIterations || 4);
    } catch (e) { return 4; }
  }

  function getState(gridKey) {
    if (!states.has(gridKey)) {
      states.set(gridKey, {
        active: false, speakerActive: false, n: 4,
        typed: [], locked: [], activeSlot: 0,
        csStatus: 'building', callerCs: '', confirmed: [], interrogateStep: 0,
        errorSearch: null, suggestions: [],
        entryEl: null, speakerEl: null, codeEl: null, toggleBtn: null, speakBtn: null,
        inputEls: [], mapLayers: [], mapPin: null
      });
    }
    return states.get(gridKey);
  }
  function resetArrays(st, n) {
    st.n = n;
    st.typed = new Array(n).fill('');
    st.locked = new Array(n).fill(null);   // indices (numbers) or null
    st.confirmed = new Array(n).fill(false);
  }
  const lockedCount = st => { let k = 0; while (k < st.n && st.locked[k] !== null) k++; return k; };
  const lockedPrefix = st => st.locked.slice(0, lockedCount(st));
  // Passphrase: typed words are DISPLAYED indices; geometry needs the TRUE ones.
  const passOpt = () => { try { return CardRenderer.getHpWordsOpt ? CardRenderer.getHpWordsOpt() : null; } catch (e) { return null; } };
  // With obfuscation every word depends on the words AFTER it, so nothing can be
  // placed until the code is complete: trueOf() returns null for a partial prefix.
  const obfActive = () => !!(passOpt() && passOpt().obf);
  const trueOf = (st, idx) => {
    if (obfActive() && idx.length < st.n) return null;
    return HW().fromDisplayed(idx, passOpt());
  };
  const word = (gridKey, i) => HW().displayWord(lang(gridKey), i);

  function sizeLabel(n) {
    const d = HW().cellMetres(n).w;
    if (isSky()) {
      const a = HW().cellArcsec(n);
      // Same angle ladder as the card's own readout, so a size reads identically.
      try {
        const U = global.GeosonifySkyUnits;
        const s = U && U.formatAngle ? U.formatAngle(a) : null;
        if (s) return s;
      } catch (e) {}
      return a >= 3600 ? (a / 3600).toFixed(2) + '°' : a >= 60 ? (a / 60).toFixed(2) + '′'
           : a >= 1 ? a.toFixed(2) + '″' : a >= 1e-3 ? (a * 1e3).toFixed(2) + ' mas' : (a * 1e6).toFixed(2) + ' µas';
    }
    if (typeof CardRenderer !== 'undefined' && CardRenderer.formatLength) return CardRenderer.formatLength(d);
    return d >= 1000 ? (d / 1000).toFixed(1) + ' km' : d >= 1 ? d.toFixed(1) + ' m' : (d * 100).toFixed(1) + ' cm';
  }

  // ── geo hints (Earth only) ────────────────────────────────
  function isSky() {
    try { const f = AppState?.get?.('frame'); if (f && f.sphere === 'sky') return true; } catch (e) {}
    try { if (global.GeosonifySkyView?.isOpen?.()) return true; } catch (e) {}
    return false;
  }
  const geoCache = new Map();
  async function reverseGeocode(lat, lon) {
    if (isSky()) return null;
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (geoCache.has(key)) return geoCache.get(key);
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=18&addressdetails=1&accept-language=en`;
      const r = await fetch(url);
      if (!r.ok) return null;
      const d = await r.json();
      const res = d && !d.error ? { address: d.address || {} } : null;
      geoCache.set(key, res);
      return res;
    } catch (e) { return null; }
  }
  function describe(res, depth) {
    if (!res) return null;
    const a = res.address;
    const city = a.city || a.town || a.village || a.municipality || a.hamlet || '';
    const region = a.state || a.region || a.county || '';
    const suburb = a.suburb || a.neighbourhood || a.quarter || '';
    const road = a.road || a.pedestrian || a.path || '';
    const country = a.country || '';
    if (depth <= 1) return [region, country].filter(Boolean).join(', ') || null;
    if (depth === 2) return city && country ? `${city}, ${country}` : (region || country || city || null);
    if (suburb && city) return `Near ${suburb}, ${city}`;
    if (road && city) return `Near ${road}, ${city}`;
    return suburb || city || null;
  }
  async function updateGeoBar(gridKey) {
    const st = getState(gridKey);
    const bar = st.entryEl?.querySelector('.bip39-geo-bar');
    const k = lockedCount(st);
    if (!bar) return;
    if (k === 0 || isSky() || !st.active) { bar.style.display = 'none'; return; }
    const c = (t => t && HW().centreForIndices(t))(trueOf(st, lockedPrefix(st)));
    if (!c) {
      if (obfActive() && k < st.n) { bar.style.display = 'flex'; bar.textContent = `🔀 Obfuscated — the place appears when all ${st.n} words are in`; }
      else bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    bar.textContent = 'Looking up...';
    const res = await reverseGeocode(c[0], c[1]);
    if (lockedCount(st) !== k) return;                   // stale
    bar.textContent = describe(res, k) || `${k} word${k > 1 ? 's' : ''} · ${HW().orderLabel(k)} · ${sizeLabel(k)} (no address here)`;
  }

  // ── map: the dashed curved cell after every word ─────────
  function clearMap(st) {
    const m = getMap(); if (!m) return;
    st.mapLayers.forEach(l => { try { m.removeLayer(l); } catch (e) {} });
    st.mapLayers = [];
    if (st.mapPin) { try { m.removeLayer(st.mapPin); } catch (e) {} st.mapPin = null; }
  }
  function updateMap(gridKey, noFit) {
    const st = getState(gridKey), m = getMap();
    if (!m || typeof L === 'undefined') return;
    clearMap(st);
    if (!st.active) return;                              // only while RECEIVE is open
    const k = lockedCount(st);
    if (k === 0) return;
    const pre = lockedPrefix(st);
    // Faint outline of the parent level for context, then the current cell dashed.
    if (k >= 2) {
      const pr = (t => t && HW().ringForIndices(t, 24))(trueOf(st, pre.slice(0, k - 1)));
      if (pr) st.mapLayers.push(L.polygon(pr, { color: COLORS[(k - 2) % 8], weight: 1, opacity: 0.45, fill: false, interactive: false }).addTo(m));
    }
    const ring = (t => t && HW().ringForIndices(t, 24))(trueOf(st, pre));
    if (!ring) return;
    const color = COLORS[(k - 1) % 8];
    const poly = L.polygon(ring, { color, weight: 2.5, fillOpacity: 0.12, dashArray: '6,4', interactive: false }).addTo(m);
    st.mapLayers.push(poly);
    const maxZ = (typeof m.getMaxZoom === 'function' && isFinite(m.getMaxZoom())) ? m.getMaxZoom() : 19;
    if (!noFit) m.fitBounds(poly.getBounds(), { padding: [20, 20], maxZoom: maxZ });
    if (k === st.n) {
      const c = (t => t && HW().centreForIndices(t))(trueOf(st, pre));
      if (c) st.mapPin = L.marker(c, { title: pre.map(i => word(gridKey, i)).join('-'), zIndexOffset: 1000 }).addTo(m);
    }
  }

  // ── DOM ───────────────────────────────────────────────────
  function buildEntry(card, gridKey) {
    const st = getState(gridKey);
    if (!st.locked.length || st.n !== cardWords(gridKey) && !st.active) resetArrays(st, cardWords(gridKey));

    const entry = document.createElement('div');
    entry.className = 'bip39-entry hpwords-entry';
    entry.style.cssText = 'display:none; padding:8px;';

    // Chinese only: many characters share a pronunciation, so spoken use has not
    // been validated. (The format guarantee lives in the FAQ, not on this panel.)
    if (/^chinese/.test(lang(gridKey))) {
      const zhNote = document.createElement('div');
      zhNote.style.cssText = 'font-size:10px; color:#fbbf24; font-weight:600; margin-bottom:6px; line-height:1.4;';
      zhNote.textContent = 'Not yet validated for reading aloud in Chinese: many characters share a pronunciation.';
      entry.appendChild(zhNote);
    }
    if (obfActive()) {
      const ob = document.createElement('div');
      ob.style.cssText = 'font-size:11px; color:#e9d5ff; background:#2e1065; border:1px solid #a78bfa; border-radius:4px; padding:5px 8px; margin-bottom:6px; font-weight:600; line-height:1.4;';
      ob.textContent = '🔀 Obfuscation on — each word depends on the words after it, so the map shows the place only once the code is complete. Obfuscated codes can’t be shortened.';
      entry.appendChild(ob);
    }
    if (passOpt() && passOpt().pass) {
      const pb = document.createElement('div');
      pb.style.cssText = 'font-size:11px; color:#fde68a; background:#422006; border:1px solid #f59e0b; border-radius:4px; padding:5px 8px; margin-bottom:6px; font-weight:600; line-height:1.4;';
      pb.textContent = '🔑 Passphrase active — enter the words exactly as sent; the map uses your passphrase to place them. ' +
        'A matching checksum only confirms the words were copied correctly, not that the passphrase is right.';
      entry.appendChild(pb);
    }

    const geoBar = document.createElement('div');
    geoBar.className = 'bip39-geo-bar';
    geoBar.style.cssText = 'display:none; font-size:13px; font-weight:600; padding:6px 10px; margin-bottom:6px; border-radius:4px; background:#1e3a5f; border:1px solid #3b82f6; color:#fff;';
    entry.appendChild(geoBar);

    const slots = document.createElement('div');
    slots.className = 'hpwords-slots';
    slots.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
    entry.appendChild(slots);

    const csPanel = document.createElement('div');
    csPanel.className = 'bip39-cs-panel';
    csPanel.style.cssText = 'margin-top:8px; padding:8px 10px; border-radius:5px; background:rgba(13,17,23,0.8); border:1px solid var(--ios-separator, #1e293b); transition:all 0.3s;';
    entry.appendChild(csPanel);

    const errorBox = document.createElement('div');
    errorBox.className = 'bip39-error-box';
    errorBox.style.cssText = 'display:none; margin-top:6px;';
    entry.appendChild(errorBox);

    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top:6px; display:flex; align-items:center; justify-content:space-between; gap:6px;';
    const fcode = document.createElement('div');
    fcode.className = 'bip39-footer-code';
    fcode.style.cssText = 'font-size:10px; color:#64748b; font-variant-numeric:tabular-nums; flex:1; min-width:0; overflow-wrap:anywhere;';
    footer.appendChild(fcode);
    const smallBtn = 'background:transparent; border:1px solid var(--ios-separator, #1e293b); border-radius:3px; padding:2px 6px; cursor:pointer; font-size:8px; color:var(--ios-secondary, #94a3b8); font-family:inherit; font-weight:600;';
    const minus = document.createElement('button'); minus.textContent = '－ WORD'; minus.style.cssText = smallBtn;
    minus.onclick = () => setSlotCount(gridKey, getState(gridKey).n - 1);
    const plus = document.createElement('button'); plus.textContent = '＋ WORD'; plus.style.cssText = smallBtn;
    plus.onclick = () => setSlotCount(gridKey, getState(gridKey).n + 1);
    const clear = document.createElement('button'); clear.textContent = 'CLEAR'; clear.style.cssText = smallBtn;
    clear.onclick = () => resetEntry(gridKey);
    footer.append(minus, plus, clear);
    entry.appendChild(footer);

    const speaker = document.createElement('div');
    speaker.className = 'bip39-speaker hpwords-speaker';
    speaker.style.display = 'none';
    const sp = document.createElement('div');
    sp.className = 'bip39-speaker-mode';
    sp.style.cssText = 'background:#000; border-radius:8px; padding:16px 12px; text-align:center;';
    speaker.appendChild(sp);
    st._speakerDiv = sp;

    const body = card.querySelector('.card-body-inner');
    if (body) { body.appendChild(entry); body.appendChild(speaker); }
    st.entryEl = entry; st.speakerEl = speaker;
    st.codeEl = body?.querySelector('.code-display');
    buildSlots(gridKey);
    refreshAll(gridKey, true);                           // rebuilds never re-zoom the map
  }

  function buildSlots(gridKey) {
    const st = getState(gridKey);
    const box = st.entryEl.querySelector('.hpwords-slots');
    box.innerHTML = '';
    st.inputEls = [];
    for (let i = 0; i < st.n; i++) {
      const row = document.createElement('div');
      row.className = 'bip39-slot-row';
      row.style.cssText = 'display:flex; align-items:center; gap:5px; position:relative;';

      const pip = document.createElement('div');
      pip.className = 'bip39-pip'; pip.dataset.slot = i;
      pip.style.cssText = 'width:8px; height:8px; border-radius:2px; flex-shrink:0; border:2px solid #334155; transition:all 0.2s;';
      row.appendChild(pip);

      const input = document.createElement('input');
      input.type = 'text'; input.className = 'bip39-word-input'; input.dataset.slot = i;
      input.placeholder = `word ${i + 1} · ${sizeLabel(i + 1)}`;
      input.autocomplete = 'off'; input.autocorrect = 'off'; input.autocapitalize = 'off'; input.spellcheck = false;
      input.style.cssText = 'flex:1; padding:4px 8px; background:var(--ios-light-gray, #131620); border:1px solid var(--ios-separator, #1e293b); border-radius:4px; color:var(--ios-text, #e2e8f0); font-size:13px; font-weight:500; font-family:inherit; outline:none;';
      row.appendChild(input);
      st.inputEls.push(input);

      const lockedEl = document.createElement('div');
      lockedEl.className = 'bip39-locked'; lockedEl.dataset.slot = i;
      lockedEl.style.cssText = 'display:none; flex:1; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:13px; font-weight:600; border:1px solid transparent; transition:all 0.2s;';
      row.appendChild(lockedEl);

      const cs = document.createElement('div');
      cs.className = 'bip39-running-cs'; cs.dataset.slot = i;
      cs.style.cssText = 'font-size:10px; font-weight:700; font-variant-numeric:tabular-nums; color:#1e293b; min-width:28px; text-align:center;';
      cs.textContent = '···';
      row.appendChild(cs);

      const dd = document.createElement('div');
      dd.className = 'bip39-autocomplete'; dd.dataset.slot = i;
      dd.style.cssText = 'display:none; position:absolute; left:13px; right:34px; top:100%; z-index:20; margin-top:2px; background:var(--ios-card, #1a1f2e); border:1px solid var(--ios-separator, #334155); border-radius:4px; max-height:160px; overflow-y:auto; box-shadow:0 6px 20px rgba(0,0,0,0.5);';
      row.appendChild(dd);

      box.appendChild(row);

      const onWordInput = () => {
        if (st.locked[i] !== null) { input.value = ''; return; }
        // Any script: letters + combining marks only (CJK, kana, Hangul, accents).
        st.typed[i] = input.value.replace(/[^\p{L}\p{M}]/gu, '');
        if (input.value !== st.typed[i]) input.value = st.typed[i];
        updateAutocomplete(gridKey, i);
      };
      // Never rewrite the field while an IME is composing (it cancels the candidate).
      input.addEventListener('input', e => { if (e.isComposing) return; onWordInput(); });
      input.addEventListener('compositionend', onWordInput);
      input.addEventListener('keydown', e => {
        if (e.isComposing || e.keyCode === 229) return;   // Space/Enter belong to the IME
        if ((e.key === ' ' || e.key === 'Tab' || e.key === 'Enter') && st.suggestions.length && st.typed[i].length) {
          e.preventDefault(); lockWord(gridKey, i, st.suggestions[0]);
        }
        if (e.key === 'Backspace' && st.typed[i] === '' && i > 0 && st.locked[i - 1] !== null) unlockWord(gridKey, i - 1);
      });
      input.addEventListener('focus', () => {
        if (st.locked[i] !== null) return;
        st.activeSlot = i; updateAutocomplete(gridKey, i); updateSlots(gridKey);
      });
    }
  }

  function updateAutocomplete(gridKey, slot) {
    const st = getState(gridKey);
    const dd = st.entryEl.querySelector(`.bip39-autocomplete[data-slot="${slot}"]`);
    const t = st.typed[slot] || '';
    st.suggestions = t ? HW().suggest(lang(gridKey), t, slot, 8) : [];
    // A complete word typed in full (or a unique ≥4-char prefix) is always offered first.
    const exact = t ? HW().wordToIndex(lang(gridKey), t) : -1;
    if (exact >= 0 && !(slot === 0 && exact >= HW().FIRST_WORD_LIMIT)) {
      st.suggestions = [exact].concat(st.suggestions.filter(x => x !== exact)).slice(0, 8);
    }
    if (!dd) return;
    if (!st.suggestions.length || st.locked[slot] !== null || !t) { dd.style.display = 'none'; return; }
    dd.style.display = 'block'; dd.innerHTML = '';
    st.suggestions.forEach((idx, si) => {
      const w = word(gridKey, idx);
      const item = document.createElement('div');
      item.style.cssText = `padding:7px 10px; cursor:pointer; font-size:15px; font-weight:${si === 0 ? 700 : 500}; color:#fff; background:${si === 0 ? '#334155' : '#1e293b'}; border-bottom:1px solid rgba(255,255,255,0.08);`;
      const ml = Math.min(t.length, w.length);
      item.innerHTML = `<span style="color:#fbbf24; font-weight:700;">${esc(w.slice(0, ml))}</span><span style="color:#e2e8f0;">${esc(w.slice(ml))}</span>`;
      item.onmouseenter = () => item.style.background = '#475569';
      item.onmouseleave = () => item.style.background = si === 0 ? '#334155' : '#1e293b';
      item.onclick = () => lockWord(gridKey, slot, idx);
      dd.appendChild(item);
    });
  }
  function hideDropdowns(st) { st.entryEl?.querySelectorAll('.bip39-autocomplete').forEach(d => d.style.display = 'none'); }

  // ── state transitions ─────────────────────────────────────
  function lockWord(gridKey, slot, idx) {
    const st = getState(gridKey);
    st.locked[slot] = idx; st.typed[slot] = word(gridKey, idx);
    st.suggestions = []; st.errorSearch = null;
    hideDropdowns(st);
    if (lockedCount(st) === st.n && st.csStatus === 'building') st.csStatus = 'confirm';
    refreshAll(gridKey);
    if (slot < st.n - 1 && st.locked[slot + 1] === null) {
      st.activeSlot = slot + 1;
      const next = st.inputEls[slot + 1];
      if (next) { next.value = ''; st.typed[slot + 1] = ''; requestAnimationFrame(() => { next.focus(); updateSlots(gridKey); }); }
    }
  }
  function unlockWord(gridKey, slot) {
    const st = getState(gridKey);
    for (let i = slot; i < st.n; i++) { st.locked[i] = null; st.typed[i] = ''; if (st.inputEls[i]) st.inputEls[i].value = ''; }
    st.csStatus = 'building'; st.callerCs = ''; st.confirmed.fill(false); st.interrogateStep = 0; st.errorSearch = null;
    st.activeSlot = slot;
    refreshAll(gridKey);
    setTimeout(() => st.inputEls[slot]?.focus(), 50);
  }
  function resetEntry(gridKey) {
    const st = getState(gridKey);
    resetArrays(st, st.n);
    st.activeSlot = 0; st.csStatus = 'building'; st.callerCs = ''; st.interrogateStep = 0; st.errorSearch = null; st.suggestions = [];
    st.inputEls.forEach(i => i.value = '');
    hideDropdowns(st);
    refreshAll(gridKey);
    setTimeout(() => st.inputEls[0]?.focus(), 50);
  }
  function setSlotCount(gridKey, n) {
    const st = getState(gridKey);
    n = HW().clampWords(n);
    if (n === st.n) return;
    const keep = st.locked.slice(0, n), keepT = st.typed.slice(0, n);
    resetArrays(st, n);
    keep.forEach((v, i) => { st.locked[i] = v; st.typed[i] = keepT[i] || ''; });
    // keep only a contiguous locked prefix
    const k = lockedCount(st); for (let i = k; i < n; i++) st.locked[i] = null;
    st.csStatus = lockedCount(st) === n ? 'confirm' : 'building';
    st.callerCs = ''; st.errorSearch = null; st.interrogateStep = 0;
    st.activeSlot = Math.min(lockedCount(st), n - 1);
    buildSlots(gridKey);
    refreshAll(gridKey);
  }

  function refreshAll(gridKey, noFit) {
    updateSlots(gridKey); updatePanel(gridKey); updateErrorBox(gridKey);
    updateFooter(gridKey); updateMap(gridKey, noFit); updateGeoBar(gridKey);
  }

  function updateSlots(gridKey) {
    const st = getState(gridKey);
    if (!st.entryEl) return;
    const rc = HW().runningChecksums(lockedPrefix(st));
    for (let i = 0; i < st.n; i++) {
      const pip = st.entryEl.querySelector(`.bip39-pip[data-slot="${i}"]`);
      const lockedEl = st.entryEl.querySelector(`.bip39-locked[data-slot="${i}"]`);
      const csEl = st.entryEl.querySelector(`.bip39-running-cs[data-slot="${i}"]`);
      const input = st.inputEls[i];
      if (!pip || !lockedEl || !input) continue;
      const isLocked = st.locked[i] !== null;
      const isActive = i === st.activeSlot && !isLocked;
      const isError = st.errorSearch?.slot === i;
      const color = COLORS[i % 8];
      pip.style.background = isError ? '#ef4444' : isLocked ? color : 'transparent';
      pip.style.borderColor = isError ? '#ef4444' : isLocked ? color : isActive ? 'var(--accent, #f59e0b)' : '#334155';
      if (isLocked) {
        input.style.display = 'none';
        lockedEl.style.display = 'flex';
        lockedEl.style.background = isError ? '#fecaca' : LIGHT[color];
        lockedEl.style.borderColor = isError ? '#dc2626' : color;
        lockedEl.style.color = isError ? '#991b1b' : '#1e293b';
        lockedEl.style.fontWeight = '700'; lockedEl.style.fontSize = '15px';
        lockedEl.textContent = word(gridKey, st.locked[i]);
        lockedEl.title = `${HW().orderLabel(i + 1)} · ${sizeLabel(i + 1)} — tap to re-enter`;
        lockedEl.onclick = () => unlockWord(gridKey, i);
      } else {
        input.style.display = 'block'; lockedEl.style.display = 'none';
        input.style.borderColor = isActive ? 'var(--accent, #f59e0b)' : 'var(--ios-separator, #1e293b)';
      }
      const v = rc[i] || null;
      csEl.textContent = v || '···';
      csEl.style.color = isError ? '#f87171' : (isLocked && v) ? color : '#475569';
      csEl.style.fontSize = v ? '14px' : '10px';
    }
  }

  function mapsLink(lat, lon, label) {
    const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 0;
    return isApple
      ? { url: `maps://maps.apple.com/?q=${encodeURIComponent(label)}&ll=${lat},${lon}`, label: 'Open in Apple Maps' }
      : { url: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`, label: 'Open in Google Maps' };
  }

  function codeString(gridKey, idx) { return HW().format(lang(gridKey), idx); }

  function updatePanel(gridKey) {
    const st = getState(gridKey);
    const panel = st.entryEl?.querySelector('.bip39-cs-panel');
    if (!panel) return;
    const k = lockedCount(st), all = k === st.n;
    const pre = lockedPrefix(st);
    const rc = HW().runningChecksums(pre);
    const finalCs = all ? rc[st.n - 1] : null;
    const colors = { building: '#94a3b8', confirm: '#fbbf24', pass: '#4ade80', mismatch: '#f87171', interrogate: '#60a5fa' };
    const labels = { building: k === 0 ? 'CHECKSUM' : 'BUILDING', confirm: 'CONFIRM WITH SENDER', pass: 'CONFIRMED', mismatch: 'MISMATCH', interrogate: 'CHECKING WORDS' };
    const shown = finalCs || (k ? rc[k - 1] : '---');
    const csColor = st.csStatus === 'pass' ? '#4ade80' : (st.csStatus === 'mismatch' || st.csStatus === 'interrogate') ? '#f87171' : finalCs ? '#fff' : '#94a3b8';

    let html = `
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="flex:1;">
          <div style="font-size:11px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:${colors[st.csStatus]}; margin-bottom:4px;">${labels[st.csStatus]}</div>
          <div style="display:flex; align-items:baseline; gap:4px;">
            <span style="font-size:14px; color:#64748b;">.</span>
            <span style="font-size:32px; font-weight:800; letter-spacing:0.18em; font-variant-numeric:tabular-nums; color:${csColor};">${shown}</span>
            ${!finalCs && k > 0 ? `<span style="font-size:12px; color:#94a3b8; font-weight:500;">${k}/${st.n}</span>` : ''}
          </div>
          ${k > 0 ? `<div style="font-size:10px; color:#64748b; margin-top:2px;">${HW().orderLabel(k)} · ${sizeLabel(k)} equal-area cell${HW().beyondMeasured(k) ? ' · deeper than typical source precision' : ''}</div>` : ''}
        </div>`;
    if (st.csStatus === 'confirm') {
      html += `<div style="display:flex; gap:6px; flex-shrink:0;">
          <button class="bip39-cs-yes" style="background:#166534; border:2px solid #4ade80; color:#fff; font-size:13px; font-weight:700; padding:8px 14px; border-radius:6px; cursor:pointer; font-family:inherit;">YES ✓</button>
          <button class="bip39-cs-no" style="background:#991b1b; border:2px solid #f87171; color:#fff; font-size:13px; font-weight:700; padding:8px 14px; border-radius:6px; cursor:pointer; font-family:inherit;">NO ✗</button>
        </div>`;
    } else if (st.csStatus === 'pass') {
      html += `<span style="font-size:28px; color:#4ade80;">✓</span>`;
    }
    html += `</div>`;

    if (st.csStatus === 'pass' && all) {
      const c = (t => t && HW().centreForIndices(t))(trueOf(st, pre));
      const code = codeString(gridKey, pre);
      if (c) {
        const lat = c[0].toFixed(7), lon = c[1].toFixed(7);
        const ml = mapsLink(lat, lon, code);
        html += `
          <div style="margin-top:8px; padding:6px 0 2px; border-top:1px solid rgba(22,101,52,0.2); text-align:center;">
            <div style="font-size:13px; color:#86efac; font-weight:600; margin-bottom:6px;">${esc(code)}</div>
            ${isSky() ? '' : `<a href="${ml.url}" target="_blank" rel="noopener" style="display:inline-block; padding:8px 16px; background:#166534; border:2px solid #4ade80; border-radius:6px; color:#fff; font-size:12px; font-weight:700; text-decoration:none; font-family:inherit;">📍 ${ml.label}</a>`}
            <div style="font-size:9px; color:#64748b; margin-top:4px;">${lat}, ${lon}</div>
          </div>`;
      }
    }
    if (st.csStatus === 'mismatch') {
      html += `
        <div style="margin-top:8px; display:flex; gap:5px; align-items:center;">
          <span style="font-size:11px; color:#e2e8f0; font-weight:600;">Sender's:</span>
          <input class="bip39-caller-cs" value="${esc(st.callerCs)}" inputmode="numeric" maxlength="3" placeholder="___"
            style="width:52px; padding:4px 6px; text-align:center; background:var(--ios-light-gray, #0d1117); border:1px solid var(--accent, #f59e0b); border-radius:3px; color:var(--accent, #f59e0b); font-size:16px; font-weight:700; font-family:inherit; outline:none; letter-spacing:0.2em; font-variant-numeric:tabular-nums;">
          <button class="bip39-find-error" style="background:var(--accent, #f59e0b); border:none; border-radius:3px; color:#0a0c10; font-size:9px; font-weight:700; padding:5px 8px; cursor:pointer; font-family:inherit;">FIND</button>
          <button class="bip39-cs-back" style="background:transparent; border:1px solid #334155; border-radius:3px; color:#94a3b8; font-size:8px; font-weight:600; padding:5px 6px; cursor:pointer; font-family:inherit;">BACK</button>
        </div>`;
    }
    if (st.csStatus === 'interrogate' && !st.errorSearch) {
      html += '<div style="margin-top:8px;">';
      for (let i = 0; i < st.n; i++) {
        const isConf = st.confirmed[i], isCurr = st.interrogateStep === i && !isConf, isPend = i > st.interrogateStep && !isConf;
        html += `
          <div style="display:flex; align-items:center; gap:8px; padding:8px 4px; ${i ? 'border-top:1px solid rgba(255,255,255,0.1);' : ''} opacity:${isPend ? 0.25 : 1};">
            <div style="width:22px; height:22px; border-radius:4px; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; background:${isConf ? '#166534' : isCurr ? '#78350f' : '#1e293b'}; border:2px solid ${isConf ? '#4ade80' : isCurr ? '#fbbf24' : '#475569'}; color:${isConf ? '#4ade80' : isCurr ? '#fbbf24' : '#64748b'};">${isConf ? '✓' : (i + 1)}</div>
            <div style="flex:1; min-width:0;">
              <span style="font-size:15px; font-weight:700; color:${isConf ? '#4ade80' : '#fff'};">${esc(word(gridKey, st.locked[i]))}</span>
              <span style="font-size:11px; color:#94a3b8; margin-left:6px;">.${rc[i]}</span>
            </div>
            ${isCurr ? `<div style="display:flex; gap:5px; flex-shrink:0;">
                <button class="bip39-word-yes" data-slot="${i}" style="background:#166534; border:2px solid #4ade80; color:#fff; font-size:12px; font-weight:700; padding:6px 12px; border-radius:5px; cursor:pointer; font-family:inherit;">YES</button>
                <button class="bip39-word-no" data-slot="${i}" style="background:#991b1b; border:2px solid #f87171; color:#fff; font-size:12px; font-weight:700; padding:6px 12px; border-radius:5px; cursor:pointer; font-family:inherit;">NO</button>
              </div>` : ''}
          </div>`;
      }
      html += '</div>';
    }
    panel.innerHTML = html;

    panel.querySelector('.bip39-cs-yes')?.addEventListener('click', () => { st.csStatus = 'pass'; updatePanel(gridKey); });
    panel.querySelector('.bip39-cs-no')?.addEventListener('click', () => {
      st.csStatus = 'mismatch'; updatePanel(gridKey);
      setTimeout(() => panel.querySelector('.bip39-caller-cs')?.focus(), 100);
    });
    panel.querySelector('.bip39-cs-back')?.addEventListener('click', () => {
      st.csStatus = 'confirm'; st.callerCs = ''; st.errorSearch = null; updatePanel(gridKey); updateErrorBox(gridKey); updateSlots(gridKey);
    });
    const ci = panel.querySelector('.bip39-caller-cs');
    if (ci) {
      ci.addEventListener('input', () => { st.callerCs = ci.value.replace(/[^0-9]/g, '').slice(0, 3); ci.value = st.callerCs; });
      ci.addEventListener('keydown', e => { if (e.key === 'Enter') startInterrogation(gridKey); });
    }
    panel.querySelector('.bip39-find-error')?.addEventListener('click', () => startInterrogation(gridKey));
    panel.querySelectorAll('.bip39-word-yes').forEach(b => b.addEventListener('click', () => confirmWord(gridKey, +b.dataset.slot)));
    panel.querySelectorAll('.bip39-word-no').forEach(b => b.addEventListener('click', () => rejectWord(gridKey, +b.dataset.slot)));
  }

  function updateFooter(gridKey) {
    const st = getState(gridKey);
    const el = st.entryEl?.querySelector('.bip39-footer-code');
    if (!el) return;
    const k = lockedCount(st);
    el.textContent = k === st.n ? codeString(gridKey, lockedPrefix(st)) : `${k}/${st.n} · ${HW().orderLabel(st.n)} · ${sizeLabel(st.n)}`;
  }

  function startInterrogation(gridKey) {
    const st = getState(gridKey);
    if (st.callerCs.length !== 3) return;
    st.callerCs = st.callerCs.padStart(3, '0');
    st.csStatus = 'interrogate'; st.confirmed.fill(false); st.interrogateStep = 0; st.errorSearch = null;
    updatePanel(gridKey);
  }
  function confirmWord(gridKey, slot) {
    const st = getState(gridKey);
    st.confirmed[slot] = true;
    if (slot < st.n - 1) st.interrogateStep = slot + 1;
    else st.errorSearch = { slot: -1, candidates: [] };
    updatePanel(gridKey); updateErrorBox(gridKey);
  }
  function rejectWord(gridKey, slot) {
    const st = getState(gridKey);
    // Nearest index first: slips between neighbouring words (shared prefixes) are the likeliest.
    const cur = st.locked[slot];
    const cands = HW().candidatesForSlot(lockedPrefix(st), slot, st.callerCs).sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
    st.errorSearch = { slot, candidates: cands };
    updateSlots(gridKey); updatePanel(gridKey); updateErrorBox(gridKey);
  }
  function updateErrorBox(gridKey) {
    const st = getState(gridKey);
    const box = st.entryEl?.querySelector('.bip39-error-box');
    if (!box) return;
    const es = st.errorSearch;
    if (!es) { box.style.display = 'none'; return; }
    if (es.slot >= 0 && es.candidates.length) {
      box.style.cssText = 'display:block; margin-top:8px; padding:10px 12px; border-radius:6px; background:#1c1917; border:2px solid #f59e0b;';
      let html = `<div style="font-size:12px; font-weight:700; color:#fbbf24; margin-bottom:4px;">WORD ${es.slot + 1}: "${esc(word(gridKey, st.locked[es.slot]))}" → POSSIBLE:</div>
        <div style="font-size:10px; color:#94a3b8; margin-bottom:8px;">Matches the sender's checksum. Read it back to the sender before using it.</div>`;
      es.candidates.forEach(c => {
        html += `<div class="bip39-correction-row" data-idx="${c}" style="display:flex; align-items:center; gap:10px; padding:8px 10px; margin-bottom:4px; background:#334155; border:2px solid #64748b; border-radius:6px; cursor:pointer;">
            <span style="font-size:18px; font-weight:800; color:#fff; min-width:80px;">${esc(word(gridKey, c))}</span>
            <span class="bip39-correction-geo" data-idx="${c}" style="font-size:11px; color:#94a3b8; font-weight:500;">${isSky() ? '' : 'looking up...'}</span>
          </div>`;
      });
      box.innerHTML = html;
      box.querySelectorAll('.bip39-correction-row').forEach(row => {
        row.addEventListener('click', () => applyCorrection(gridKey, es.slot, +row.dataset.idx));
        row.addEventListener('mouseenter', () => row.style.borderColor = '#fbbf24');
        row.addEventListener('mouseleave', () => row.style.borderColor = '#64748b');
      });
      lookupCandidates(gridKey, es.slot, es.candidates, box);
    } else if (es.slot === -1) {
      box.style.cssText = 'display:block; margin-top:8px; padding:10px 12px; border-radius:6px; background:#450a0a; border:2px solid #f87171; font-size:13px; color:#fff; font-weight:600;';
      box.textContent = 'All words confirmed but checksum still wrong. Multiple errors likely — re-enter from word 1.';
    } else {
      box.style.cssText = 'display:block; margin-top:8px; padding:10px 12px; border-radius:6px; background:#1c1917; border:2px solid #78350f; font-size:13px; color:#fca5a5; font-weight:600;';
      box.textContent = 'No candidates found. Tap the word above to re-enter manually.';
    }
  }
  async function lookupCandidates(gridKey, slot, cands, box) {
    const st = getState(gridKey);
    for (const c of cands) {
      const test = lockedPrefix(st).slice(); test[slot] = c;
      const depth = Math.min(slot + 1, 3);
      const cen = (t => t && HW().centreForIndices(t))(trueOf(st, obfActive() ? test : test.slice(0, Math.max(depth, slot + 1))));
      const el = box.querySelector(`.bip39-correction-geo[data-idx="${c}"]`);
      if (!cen || !el || isSky()) continue;
      const res = await reverseGeocode(cen[0], cen[1]);
      const d = describe(res, depth);
      el.textContent = d || '(no address)';
      el.style.color = d ? '#93c5fd' : '#64748b';
    }
  }
  function applyCorrection(gridKey, slot, idx) {
    const st = getState(gridKey);
    st.locked[slot] = idx; st.typed[slot] = word(gridKey, idx);
    st.errorSearch = null; st.callerCs = ''; st.csStatus = 'confirm'; st.confirmed.fill(false); st.interrogateStep = 0;
    refreshAll(gridKey);
  }

  // ── speaker readout (per-word running checksums) ─────────
  function updateSpeaker(gridKey) {
    const st = getState(gridKey);
    if (!st._speakerDiv) return;
    const coord = CardRenderer.getCoordinate ? CardRenderer.getCoordinate() : null;
    if (!coord) {
      st._speakerDiv.innerHTML = '<div style="color:#64748b; font-size:12px;">' + (coord ? 'Hidden while privacy mode is active' : 'Move the map to generate a code') + '</div>';
      return;
    }
    const n = cardWords(gridKey);
    const tru = HW().encodeIndices(coord.lat, coord.lon, n);
    if (!tru) return;
    const idx = HW().toDisplayed(tru, passOpt());
    const rc = HW().runningChecksums(idx);
    let html = '';
    idx.forEach((x, i) => {
      html += `<div style="display:flex; align-items:center; justify-content:center; gap:16px; padding:10px 0; ${i ? 'border-top:1px solid #222;' : ''}">
          <span style="font-size:26px; font-weight:800; color:#fff; letter-spacing:0.05em;">${esc(word(gridKey, x))}</span>
          <span style="font-size:18px; font-weight:600; color:#94a3b8; font-variant-numeric:tabular-nums;">${rc[i]}</span>
        </div>`;
    });
    html += `<div style="font-size:10px; color:#64748b; margin-top:6px;">${HW().orderLabel(n)} · ${sizeLabel(n)} equal-area cell${passOpt() && passOpt().pass ? ' · 🔑 passphrase' : ''}${obfActive() ? ' · 🔀 obfuscated' : ''}</div>`;
    st._speakerDiv.innerHTML = html;
  }

  // ── toggles ───────────────────────────────────────────────
  function styleReceive(st) {
    if (!st.toggleBtn) return;
    if (st.active) { st.toggleBtn.innerHTML = '✕ CLOSE'; st.toggleBtn.style.background = '#78350f'; st.toggleBtn.style.color = '#fbbf24'; }
    else { st.toggleBtn.innerHTML = '📥 RECEIVE'; st.toggleBtn.style.background = '#555078'; st.toggleBtn.style.color = '#e2dff0'; }
  }
  function toggleView(gridKey) {
    const st = getState(gridKey);
    st.active = !st.active;
    if (st.active) {
      st.speakerActive = false;
      if (st.speakerEl) st.speakerEl.style.display = 'none';
      if (st.n !== cardWords(gridKey)) { resetArrays(st, cardWords(gridKey)); buildSlots(gridKey); }
      resetEntry(gridKey);
    } else {
      clearMap(st);
    }
    if (st.entryEl) st.entryEl.style.display = st.active ? 'block' : 'none';
    if (st.codeEl) st.codeEl.style.display = (st.active || st.speakerActive) ? 'none' : '';
    styleReceive(st);
  }
  function toggleSpeaker(gridKey) {
    const st = getState(gridKey);
    st.speakerActive = !st.speakerActive;
    if (st.speakerActive && st.active) { st.active = false; if (st.entryEl) st.entryEl.style.display = 'none'; clearMap(st); styleReceive(st); }
    if (st.speakerEl) st.speakerEl.style.display = st.speakerActive ? 'block' : 'none';
    if (st.codeEl) st.codeEl.style.display = st.speakerActive ? 'none' : '';
    if (st.speakBtn) st.speakBtn.style.background = st.speakerActive ? '#166534' : '#555078';
    if (st.speakerActive) updateSpeaker(gridKey);
  }

  const BTN = 'margin-left:4px; background:#555078; border:none; border-radius:6px; color:#e2dff0; font-size:10px; font-weight:700; padding:4px 8px; cursor:pointer; font-family:inherit; letter-spacing:0.04em;';

  global.HPWordsEntry = {
    attach(card, gridKey) {
      const d = def(gridKey);
      if (!d || !d.hpwords || !HW()) return;
      const st = getState(gridKey);
      const title = card.querySelector('.card-title');
      if (title && !title.querySelector('.hpwords-entry-toggle')) {
        const speak = document.createElement('button');
        speak.className = 'audio-speaker-btn hpwords-speak-toggle';
        speak.textContent = '✓';
        speak.title = 'Per-word readout with running checksums (for the sender)';
        speak.style.cssText = BTN + (st.speakerActive ? 'background:#166534;' : '');
        speak.onclick = e => { e.stopPropagation(); toggleSpeaker(gridKey); };
        const recv = document.createElement('button');
        recv.className = 'audio-speaker-btn hpwords-entry-toggle';
        recv.title = 'Enter a code received from sender';
        recv.style.cssText = BTN;
        recv.onclick = e => { e.stopPropagation(); toggleView(gridKey); };
        title.appendChild(speak); title.appendChild(recv);
        st.speakBtn = speak; st.toggleBtn = recv;
      }
      // renderCards() rebuilds the card DOM: carry an open view across the rebuild.
      const wasActive = st.active, wasSpeaker = st.speakerActive;
      buildEntry(card, gridKey);
      styleReceive(st);
      if (wasActive) { st.entryEl.style.display = 'block'; if (st.codeEl) st.codeEl.style.display = 'none'; }
      if (wasSpeaker) { st.speakerEl.style.display = 'block'; if (st.codeEl) st.codeEl.style.display = 'none'; updateSpeaker(gridKey); }
    },
    onCoordUpdate(gridKey) {
      const st = states.get(gridKey);
      if (st && st.speakerActive) updateSpeaker(gridKey);
    },
    isActive(gridKey) { return !!states.get(gridKey)?.active; },
    version: '1.0'
  };
  try { console.log('[geosonify] hpwords-entry 1.0 loaded'); } catch (e) {}
})(typeof window !== 'undefined' ? window : this);
