/*
  geosonify-geo-core.v11.8o.js
  - ByteWordsMin sentence mnemonic: generate ChatGPT prompts and parse sentences
  - Shuffler details hidden by default (left-aligned Show/Hide)
  - Hard iteration caps per grid (custom = unlimited)
  - Iterations clamp only after real clip (per grid+pass) + snap UI back
  - Obfuscated token-count == raw token-count (no tail growth)
  - Injects codec UI if missing; responsive; geolocation tap/hold
  - Requires geosonify-codec-engine v11.8+ (GeoCodec.*)
  - FIXED: Event dispatching for fullscreen updates
  - FIXED: Iteration selector as dropdown with "More..." option
*/
(function(){
  'use strict';
  const __GEOSONIFY_CORE_VER__ = 'v11.8o';
  try { console.log('[geosonify] core ' + __GEOSONIFY_CORE_VER__ + ' loaded'); } catch(e){}

  // ---------------- DOM helpers ----------------
  function $(sel, root){ return (root||document).querySelector(sel); }
  function setVal(id, v){ const el = document.getElementById(id); if (el) el.value = v; return !!el; }
  function passEl(){ return $('#passphrase'); }
  function selectEl(){ return $('#gridSelect'); }
  function customEl(){ return $('#customText'); }

  // ---------------- ByteWordsMin sentence helpers ----------------
  function isByteWordsMin(){
    const se = selectEl();
    return se && se.value === 'bytewordsmin';
  }

  function looksLikeSentence(text){
    // Has spaces AND has at least one component that's 2+ chars
    if (!text || !text.includes(' ')) return false;
    const words = text.trim().split(/\s+/);
    return words.some(w => w.length >= 2);
  }

  function sentenceToByteWordsMin(sentence){
    // Extract first letter of each word, apply alternating caps
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    let result = '';
    for (let i = 0; i < words.length; i++){
      const letter = words[i][0];
      // Odd positions (1st, 3rd, 5th...) = uppercase, even = lowercase
      result += (i % 2 === 0) ? letter.toUpperCase() : letter.toLowerCase();
    }
    return result;
  }

  function normalizeByteWordsMinCode(code){
    // Convert all-upper or all-lower to alternating caps
    const clean = code.replace(/\s+/g, '');
    let result = '';
    for (let i = 0; i < clean.length; i++){
      const char = clean[i];
      result += (i % 2 === 0) ? char.toUpperCase() : char.toLowerCase();
    }
    return result;
  }

  function generateChatGPTLink(code){
    const prompt = `Write a simple, natural-sounding English sentence where each word begins with the corresponding letter in this string (one word per letter, in order): ${code}.`;
    return 'https://chat.openai.com/?q=' + encodeURIComponent(prompt);
  }

  function addSentenceButtons(){
    if (!isByteWordsMin()) return;

    const rawBox = $('#rawBox');
    const obfBox = $('#obfBox');
    const copyRawBtn = $('#copyRawBtn');
    const copyObfBtn = $('#copyObfBtn');

    if (rawBox && copyRawBtn && !$('#genSentenceRawBtn')){
      const btn = document.createElement('button');
      btn.id = 'genSentenceRawBtn';
      btn.textContent = 'Generate Sentence';
      btn.style.marginLeft = '8px';
      btn.addEventListener('click', ()=>{
        const code = rawBox.value.trim();
        if (!code) return;
        const normalized = normalizeByteWordsMinCode(code);
        window.open(generateChatGPTLink(normalized), '_blank');
      });
      copyRawBtn.parentNode.insertBefore(btn, copyRawBtn.nextSibling);
    }

    if (obfBox && copyObfBtn && !$('#genSentenceObfBtn')){
      const btn = document.createElement('button');
      btn.id = 'genSentenceObfBtn';
      btn.textContent = 'Generate Sentence';
      btn.style.marginLeft = '8px';
      btn.addEventListener('click', ()=>{
        const code = obfBox.value.trim();
        if (!code) return;
        const normalized = normalizeByteWordsMinCode(code);
        window.open(generateChatGPTLink(normalized), '_blank');
      });
      copyObfBtn.parentNode.insertBefore(btn, copyObfBtn.nextSibling);
    }
  }

  function removeSentenceButtons(){
    const rawBtn = $('#genSentenceRawBtn');
    const obfBtn = $('#genSentenceObfBtn');
    if (rawBtn) rawBtn.remove();
    if (obfBtn) obfBtn.remove();
  }

  function preprocessByteWordsMinInput(text){
    if (!isByteWordsMin() || !text) return text;
    
    // If it looks like a sentence, extract letters
    if (looksLikeSentence(text)){
      return sentenceToByteWordsMin(text);
    }
    
    // If it's a code without spaces, normalize caps
    if (!text.includes(' ')){
      return normalizeByteWordsMinCode(text);
    }
    
    return text;
  }

  // ---------------- Defaults & caps ----------------
  const defaultIterationsByGrid = {
    "alphanumeric": 9,  // 6x6
    "NATO": 9,          // 6x6
    "music": 8,         // 7x7
    "base64": 8,        // 8x8
    "hexbyte": 6,       // 16x16
    "bytewords": 6,     // 16x16
    "bytewordsmin": 6,  // 16x16
    "byteemoji": 6,     // 16x16
    "emoji": 5,         // 28x28
    "custom": 9
  };

  // Hard maximum iterations per grid (Custom = unlimited)
  const maxIterationsByGrid = {
    "alphanumeric": 21,   // 6x6
    "NATO": 21,           // 6x6
    "music": 20,          // 7x7
    "base64": 19,         // 8x8
    "hexbyte": 14,        // 16x16
    "bytewords": 14,      // 16x16
    "bytewordsmin": 14,   // 16x16
    "byteemoji": 14,      // 16x16
    "emoji": 12,          // 28x28
    "custom": Infinity    // unlimited
  };

  function createIterationSelector() {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '8px';
    
    const label = document.createElement('label');
    label.textContent = 'Iterations';
    label.setAttribute('for', 'iterSelect');
    
    const select = document.createElement('select');
    select.id = 'iterSelect';
    select.style.width = '6rem';
    
    // Hidden input for compatibility with existing code
    const hiddenInput = document.createElement('input');
    hiddenInput.id = 'iterInput';
    hiddenInput.type = 'hidden';
    
    const customDialog = document.createElement('div');
    customDialog.id = 'customIterDialog';
    customDialog.style.display = 'none';
    customDialog.style.position = 'fixed';
    customDialog.style.top = '50%';
    customDialog.style.left = '50%';
    customDialog.style.transform = 'translate(-50%, -50%)';
    customDialog.style.background = '#fff';
    customDialog.style.padding = '20px';
    customDialog.style.border = '1px solid #ccc';
    customDialog.style.borderRadius = '8px';
    customDialog.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)';
    customDialog.style.zIndex = '10000';
    
    customDialog.innerHTML = `
      <h3>Custom Iterations</h3>
      <p>Enter number of iterations:</p>
      <input type="number" id="customIterValue" min="1" value="25" style="width: 100px; margin-right: 10px;">
      <button id="customIterOk">OK</button>
      <button id="customIterCancel">Cancel</button>
    `;
    
    container.appendChild(label);
    container.appendChild(select);
    container.appendChild(hiddenInput);
    document.body.appendChild(customDialog);
    
    function populateIterationOptions() {
      const se = selectEl();
      const gridKey = se ? se.value : 'alphanumeric';
      const maxIter = maxIterationsByGrid[gridKey] || 21;
      const isCustomGrid = gridKey === 'custom';
      
      select.innerHTML = '';
      
      // Add standard options (1 to min(20, maxIter))
      const upperLimit = isCustomGrid ? 20 : Math.min(20, maxIter);
      for (let i = 1; i <= upperLimit; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i;
        select.appendChild(option);
      }
      
      // Add "More…" option only for custom grids
      if (isCustomGrid) {
        const moreOption = document.createElement('option');
        moreOption.value = 'more';
        moreOption.textContent = 'More…';
        select.appendChild(moreOption);
      }
      
      // Set default value
      const defaultIter = defaultIterationsByGrid[gridKey] || 9;
      const valueToSet = defaultIter <= upperLimit ? defaultIter : upperLimit;
      select.value = valueToSet;
      hiddenInput.value = valueToSet;
    }
    
    // Handle selection changes
    select.addEventListener('change', () => {
      if (select.value === 'more') {
        // Reset to previous value while dialog is open
        const currentValue = parseInt(hiddenInput.value) || 9;
        customDialog.style.display = 'block';
        const customInput = document.getElementById('customIterValue');
        customInput.value = Math.max(21, currentValue);
        customInput.focus();
      } else {
        hiddenInput.value = select.value;
        // Trigger the existing iteration change handler
        const event = new Event('input', { bubbles: true });
        hiddenInput.dispatchEvent(event);
        const changeEvent = new Event('change', { bubbles: true });
        hiddenInput.dispatchEvent(changeEvent);
      }
    });
    
    // Handle custom dialog
    document.getElementById('customIterOk').addEventListener('click', () => {
      const customValue = parseInt(document.getElementById('customIterValue').value);
      if (customValue && customValue >= 1) {
        // Check if it's within bounds for non-custom grids
        const se = selectEl();
        const gridKey = se ? se.value : 'alphanumeric';
        const maxIter = maxIterationsByGrid[gridKey] || Infinity;
        
        if (gridKey !== 'custom' && customValue > maxIter) {
          alert(`Maximum iterations for ${gridKey} grid is ${maxIter}`);
          // Reset select to current valid value
          select.value = hiddenInput.value;
          return;
        }
        
        hiddenInput.value = customValue;
        
        // Update select to show the custom value
        if (customValue <= 20 && select.querySelector(`option[value="${customValue}"]`)) {
          select.value = customValue;
        } else {
          // Remove any existing custom option
          const existingCustom = select.querySelector('option[data-custom]');
          if (existingCustom) existingCustom.remove();
          
          // Add a new option for the custom value
          const newOption = document.createElement('option');
          newOption.value = customValue;
          newOption.textContent = customValue;
          newOption.setAttribute('data-custom', 'true');
          
          // Insert before "More..." option
          const moreOption = select.querySelector('option[value="more"]');
          if (moreOption) {
            select.insertBefore(newOption, moreOption);
          } else {
            select.appendChild(newOption);
          }
          
          select.value = customValue;
        }
        
        // Trigger the existing iteration change handler
        const event = new Event('input', { bubbles: true });
        hiddenInput.dispatchEvent(event);
        const changeEvent = new Event('change', { bubbles: true });
        hiddenInput.dispatchEvent(changeEvent);
      }
      customDialog.style.display = 'none';
    });
    
    document.getElementById('customIterCancel').addEventListener('click', () => {
      // Reset select to previous valid value
      select.value = hiddenInput.value;
      customDialog.style.display = 'none';
    });
    
    // Close dialog on backdrop click
    customDialog.addEventListener('click', (e) => {
      if (e.target === customDialog) {
        select.value = hiddenInput.value;
        customDialog.style.display = 'none';
      }
    });
    
    // Initialize options
    populateIterationOptions();
    
    return container;
  }

  function applyIterMaxForGrid(){
    const se = selectEl();
    const select = document.getElementById('iterSelect');
    if (!select || !se) return;
    
    // Get the container and re-create the selector to refresh options
    const container = document.getElementById('iterationSelectorContainer');
    if (container) {
      const currentValue = iterationsValue();
      container.innerHTML = '';
      container.appendChild(createIterationSelector());
      // Try to maintain the current value if valid
      const newHiddenInput = document.getElementById('iterInput');
      const newSelect = document.getElementById('iterSelect');
      if (newHiddenInput && newSelect) {
        const gridKey = se.value || 'alphanumeric';
        const maxIter = maxIterationsByGrid[gridKey] || 21;
        if (currentValue <= maxIter) {
          if (currentValue <= 20 && newSelect.querySelector(`option[value="${currentValue}"]`)) {
            newSelect.value = currentValue;
            newHiddenInput.value = currentValue;
          }
        } else {
          // Set to default for this grid
          const defaultIter = defaultIterationsByGrid[gridKey] || 9;
          newSelect.value = defaultIter;
          newHiddenInput.value = defaultIter;
        }
      }
    }
    
    // Update sentence buttons
    if (isByteWordsMin()){
      addSentenceButtons();
    } else {
      removeSentenceButtons();
    }
  }

  // ---------------- Codec panel injector ----------------
  function ensureCodecSection(){
    if (document.getElementById('coordInput')) return; // already present
    const container = document.createElement('div');
    container.id = 'codecSection';
    container.innerHTML = `
      <style>
        #codecSection { margin-top:1em; font-family:sans-serif; }
        .toolbar { display:flex; gap:.75rem; flex-wrap:wrap; align-items:center; margin:.25rem 0 .5rem; }
        .toolbar label { font-size:.9em; opacity:.8; }
        .toolbar input[type="number"], .toolbar select { width:6rem; }
        .codec-grid { display:flex; flex-wrap:wrap; gap:.5em; }
        .codec-col { flex:1 1 30%; min-width:220px; display:flex; flex-direction:column; }
        textarea { width:100%; height:2.5em; font-family:'Source Code Pro', monospace; font-size:1em; }
        button, select, input[type="number"] { width:fit-content; }
        @media(max-width:800px){ .codec-col { flex:1 1 100%; } }
        
        /* Custom iteration dialog styles */
        #customIterDialog {
          font-family: system-ui, sans-serif;
          color: #111;
        }
        #customIterDialog h3 {
          margin-top: 0;
          margin-bottom: 10px;
        }
        #customIterDialog p {
          margin: 10px 0;
        }
        #customIterDialog button {
          margin-left: 5px;
          padding: 6px 12px;
          border: 1px solid #ccc;
          background: #f6f6f6;
          border-radius: 4px;
          cursor: pointer;
        }
        #customIterDialog button:hover {
          background: #e6e6e6;
        }
      </style>

      <div class="toolbar" id="codecToolbar">
        <div id="iterationSelectorContainer"></div>
        <label for="unitSelect">Units</label>
        <select id="unitSelect">
          <option value="metric" selected>Metric</option>
          <option value="us">US</option>
        </select>
      </div>
      <div class="track-status" id="geoTrackStatus" style="font-size:.9em; opacity:.8;">Tracking: <strong>Off</strong></div>

      <div class="codec-grid">
        <div class="codec-col">
          <label>Input Coordinates (lat, lon - one per line)</label>
          <textarea id="coordInput"></textarea>
          <button id="getCurrentBtn">ðŸ“ Get Current (tap) / Hold for tracking</button>
        </div>
        <div class="codec-col">
          <label>Hierarchical Code</label>
          <textarea id="rawBox"></textarea>
          <button id="copyRawBtn">Copy</button>
        </div>
        <div class="codec-col">
          <label>Obfuscated Code</label>
          <textarea id="obfBox"></textarea>
          <button id="copyObfBtn">Copy</button>
        </div>
        <div class="codec-col">
          <label>Output Coordinates</label>
          <textarea id="outCoordBox" readonly></textarea>
          <button id="copyOutBtn">Copy</button>
        </div>
        <div class="codec-col">
          <label>Distance Error</label>
          <textarea id="errorBox" readonly></textarea>
        </div>
      </div>
    `;
    document.body.appendChild(container);
    
    // Add the iteration selector
    const iterContainer = document.getElementById('iterationSelectorContainer');
    if (iterContainer) {
      iterContainer.appendChild(createIterationSelector());
    }
  }

  // ---------------- Precise shuffler-details wrapper (Tip -> codec) ----------------
  function findElementContainingText(root, text){
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    let n; while ((n = walker.nextNode())) {
      if (n.textContent && n.textContent.indexOf(text) !== -1) return n;
    }
    return null;
  }

  function wrapShufflerDetailsBetweenMarkers(){
    const codec = document.getElementById('codecSection');
    if (!codec) return null;

    const tip = findElementContainingText(document.body, 'Tip: Click tabs to compare Original vs Decoded.');
    if (!tip) return null;

    const start = tip.closest('div') || tip; // include the block that contains the Tip
    let wrap = document.getElementById('shufflerDetails');
    if (wrap) return wrap;

    wrap = document.createElement('div');
    wrap.id = 'shufflerDetails';

    const parent = start.parentNode;
    // Collect nodes from Tip through to codec (not including codec)
    const toMove = [];
    let ref = start;
    while (ref && ref !== codec) {
      toMove.push(ref);
      ref = ref.nextSibling;
    }
    if (!toMove.length) return null;

    parent.insertBefore(wrap, codec);
    toMove.forEach(node => wrap.appendChild(node));

    // Left-aligned toggle button (default hidden)
    let btn = document.getElementById('toggleShufflerBtn');
    if (!btn) {
      const bar = document.createElement('div');
      bar.style.display = 'flex';
      bar.style.justifyContent = 'flex-start';
      bar.style.margin = '0.25rem 0 0.5rem 0';

      btn = document.createElement('button');
      btn.id = 'toggleShufflerBtn';
      btn.textContent = 'Show shuffler details'; // default hidden
      btn.style.width = 'fit-content';

      // Hide by default
      wrap.classList.add('is-collapsed');

      btn.addEventListener('click', () => {
        const hidden = wrap.classList.toggle('is-collapsed');
        btn.textContent = hidden ? 'Show shuffler details' : 'Hide shuffler details';
      });

      bar.appendChild(btn);
      parent.insertBefore(bar, wrap);

      const style = document.createElement('style');
      style.textContent = `#shufflerDetails.is-collapsed { display: none; }`;
      document.head.appendChild(style);
    }

    return wrap;
  }

  // ---------------- Grid plumbing ----------------
  function getActiveGrid2D(){
    if (typeof window.loadBaseGrid !== 'function' || typeof window.shuffleGridAndOrder !== 'function') return null;
    const gridKey = (selectEl() && selectEl().value) || undefined;
    const tuple = window.loadBaseGrid(gridKey, true);
    const base = tuple && tuple[0] ? tuple[0] : null;
    if (!base) return null;
    const pass = passEl() ? passEl().value : '';
    const shuffled = window.shuffleGridAndOrder(base, pass);
    return (shuffled && shuffled.grid) ? shuffled.grid : null;
  }

  // ---------------- Formatting helpers ----------------
  function formatCoord(pair){ return pair[0].toFixed(6) + ', ' + pair[1].toFixed(6); }
  function parseCoordLines(text){
    const lines = (text||'').split(/\n+/), out=[];
    for (let i=0;i<lines.length;i++){
      const s=(lines[i]||'').trim(); if(!s) continue;
      const parts=s.replace(/\s+/g,'').split(/,|\s/);
      if (parts.length>=2){
        const la=parseFloat(parts[0]), lo=parseFloat(parts[1]);
        if (isFinite(la)&&isFinite(lo)) out.push([la,lo]);
      }
    }
    return out;
  }
  function stripUndefinedLiteral(s){ return String(s).replace(/undefined/g,''); }

  // ---------------- Token helpers (for obf clamp) ----------------
  function tokenizeWithGrid(str, grid2D){
    const flat = window.GeoCodec.flattenGrid(grid2D);
    return window.GeoCodec.tokenizeCode(str, flat) || [];
  }
  function joinTokens(tokens){ return tokens.join(''); }
  function clampObfToRawTokens(obfStr, rawStr, grid2D){
    const rawToks = tokenizeWithGrid(rawStr, grid2D);
    const obfToks = tokenizeWithGrid(obfStr, grid2D);
    if (!rawToks.length || !obfToks.length) return obfStr;
    if (obfToks.length <= rawToks.length) return obfStr;
    return joinTokens(obfToks.slice(0, rawToks.length));
  }

  // ---------------- Safe-iterations guard (with hard caps) ----------------
  window._geo_safeMaxIter = window._geo_safeMaxIter || {}; // per (grid|pass)
  function activeGridKey(){
    const g = (selectEl() && selectEl().value) || 'unknown';
    const p = (passEl() && passEl().value) || '';
    return g + '|' + p;
  }
  
  function iterationsValue() {
    const hiddenInput = document.getElementById('iterInput');
    if (hiddenInput) {
      return Math.max(1, parseInt(hiddenInput.value) || 1);
    }
    return 9; // fallback
  }

  function enforceSafeIterations(requestedIter, grid2D){
    const se = selectEl();
    const keyGrid = se ? se.value : 'alphanumeric';
    const hardCap = maxIterationsByGrid[keyGrid];
    let req = Math.max(1, requestedIter|0);

    // 1) Apply hard cap immediately
    if (Number.isFinite(hardCap) && req > hardCap) {
      setVal('iterInput', hardCap);
      req = hardCap;
    }

    const key = activeGridKey();
    const stored = window._geo_safeMaxIter[key];

    // 2) If we already observed a logical max, clamp to it (and not above hardCap)
    if (typeof stored === 'number' && req > stored) {
      const eff = Number.isFinite(hardCap) ? Math.min(stored, hardCap) : stored;
      setVal('iterInput', eff);
      return eff;
    }

    // 3) Probe requested (already capped) for logical clipping
    const coordsText = (($('#coordInput')||{}).value) || '';
    const coords = parseCoordLines(coordsText);
    const test = coords.length ? coords[0] : [0,0];

    const code = window.GeoCodec.encodeHierarchical(test[0], test[1], grid2D, req);
    const tokens = tokenizeWithGrid(code, grid2D);
    const observed = tokens.length;

    if (observed < req) {
      // Real clip discovered; remember and snap UI
      const logicalMax = observed;
      window._geo_safeMaxIter[key] = logicalMax;
      const eff = Number.isFinite(hardCap) ? Math.min(logicalMax, hardCap) : logicalMax;
      setVal('iterInput', eff);
      return eff;
    }

    return req; // no clip; allowed
  }

  // ---------------- Distance ----------------
  function updateErrorBox(inputCoords, outputCoords){
    const unitSel = document.getElementById('unitSelect');
    const units = unitSel ? unitSel.value : 'metric';
    function fmtMetric(m){
      if (!isFinite(m)) return '';
      if (m >= 1000) return (m/1000).toFixed(1)+' km';
      if (m >= 1) return m.toFixed(1)+' m';
      const cm=m*100; if (cm>=1) return cm.toFixed(1)+' cm';
      const mm=m*1000; if (mm>=1) return mm.toFixed(1)+' mm';
      const um=m*1e6; if (um>=1) return um.toFixed(1)+' μm';
      const nm=m*1e9; return nm.toFixed(1)+' nm';
    }
    function fmtUS(m){
      if (!isFinite(m)) return '';
      const miles=m/1609.344; if (miles>=0.1) return miles.toFixed(2)+' mi';
      const feet=m/0.3048; if (feet>=3) return feet.toFixed(1)+' ft';
      const inches=m/0.0254; if (inches>=1) return inches.toFixed(1)+' in';
      const thou=inches*1000; return Math.round(thou)+' mil';
    }
    function fmt(m){ return (units==='us')? fmtUS(m) : fmtMetric(m); }

    const lines=[], n=Math.max(inputCoords.length, outputCoords.length);
    for (let i=0;i<n;i++){
      const a=inputCoords[i], b=outputCoords[i];
      if (!a || !b){ lines.push(''); continue; }
      const d = window.GeoCodec.distanceMeters(a[0],a[1],b[0],b[1]);
      lines.push(fmt(d));
    }
    setVal('errorBox', lines.join('\n'));
  }

  // ---------------- State ----------------
  window._geo_internalChange = false;
  window._geo_lastEdited = 'coords';
  function safeObf(code, flat){ return window.GeoCodec.obfuscateUpToValid('encode', code, flat); }
  function formatOut(p){ return p? formatCoord(p): ''; }

  function computeOutputs(raws, grid2D, iterations){
    const outs = new Array(raws.length);
    for (let i=0;i<raws.length;i++){
      outs[i] = window.GeoCodec.decodeHierarchical(raws[i], grid2D, iterations) || null;
    }
    return outs;
  }

  // ---------------- Update flows ----------------
  function updateFromCoords(){
    if (window._geo_internalChange) return; 
    window._geo_lastEdited='coords';
    const grid2D = getActiveGrid2D(); 
    if (!grid2D) return;
    const flat = window.GeoCodec.flattenGrid(grid2D);
    const iter = enforceSafeIterations(iterationsValue(), grid2D);
    const coords = parseCoordLines(($('#coordInput')||{}).value);
    const raws=[], obfs=[];
    for (let i=0;i<coords.length;i++){
      const raw = window.GeoCodec.encodeHierarchical(coords[i][0], coords[i][1], grid2D, iter);
      raws.push(raw);
      const obf = safeObf(raw, flat);
      obfs.push(clampObfToRawTokens(obf, raw, grid2D));
    }
    const outs = computeOutputs(raws, grid2D, iter);
    window._geo_internalChange=true;
    setVal('rawBox', stripUndefinedLiteral(raws.join('\n')));
    setVal('obfBox', stripUndefinedLiteral(obfs.join('\n')));
    setVal('outCoordBox', stripUndefinedLiteral(outs.map(formatOut).join('\n')));
    updateErrorBox(coords, outs);
    window._geo_internalChange=false;

    // Dispatch live update for fullscreen vertical mode
    try {
      const evt = new CustomEvent('geosonify:updateCode', {
        detail: { 
          tokens: raws.length ? tokenizeWithGrid(raws[0], grid2D) : [], 
          copyText: raws[0] || '' 
        }
      });
      window.dispatchEvent(evt);
    } catch(e){}
  }

  function updateFromRaw(){
    if (window._geo_internalChange) return; 
    window._geo_lastEdited='raw';
    const grid2D = getActiveGrid2D(); 
    if (!grid2D) return;
    const flat = window.GeoCodec.flattenGrid(grid2D);
    const iter = enforceSafeIterations(iterationsValue(), grid2D);
    
    let rawText = ($('#rawBox')||{}).value||'';
    const originalRawText = rawText;
    rawText = preprocessByteWordsMinInput(rawText);
    
    // Write back the preprocessed text if it changed
    if (rawText !== originalRawText) {
      const rawBox = $('#rawBox');
      if (rawBox) rawBox.value = rawText;
    }
    
    const raws = rawText.split(/\n+/).map(s=>s.trim()).filter(Boolean);
    const obfs = raws.map(r => clampObfToRawTokens(safeObf(r, flat), r, grid2D));
    const outs = computeOutputs(raws, grid2D, iter);
    const inCoords = (($('#coordInput')||{}).value||'').trim() ? parseCoordLines($('#coordInput').value) : new Array(raws.length).fill(null);
    window._geo_internalChange=true;
    setVal('obfBox', stripUndefinedLiteral(obfs.join('\n')));
    setVal('outCoordBox', stripUndefinedLiteral(outs.map(formatOut).join('\n')));
    updateErrorBox(inCoords, outs);
    window._geo_internalChange=false;

    // Dispatch live update for fullscreen vertical mode
    try {
      const evt = new CustomEvent('geosonify:updateCode', {
        detail: { 
          tokens: raws.length ? tokenizeWithGrid(raws[0], grid2D) : [], 
          copyText: raws[0] || '' 
        }
      });
      window.dispatchEvent(evt);
    } catch(e){}
  }

  function updateFromObf(){
    if (window._geo_internalChange) return; 
    window._geo_lastEdited='obf';
    const grid2D = getActiveGrid2D(); 
    if (!grid2D) return;
    const flat = window.GeoCodec.flattenGrid(grid2D);
    const iter = enforceSafeIterations(iterationsValue(), grid2D);
    
    let obfText = ($('#obfBox')||{}).value||'';
    const originalObfText = obfText;
    obfText = preprocessByteWordsMinInput(obfText);
    
    // Write back the preprocessed text if it changed
    if (obfText !== originalObfText) {
      const obfBox = $('#obfBox');
      if (obfBox) obfBox.value = obfText;
    }
    
    const obfs = obfText.split(/\n+/).map(s=>s.trim()).filter(Boolean);
    const raws=[], normalized=[];
    for (let i=0;i<obfs.length;i++){
      const raw = window.GeoCodec.applyObfuscation('decode', obfs[i], flat);
      raws.push(raw);
      const reobf = safeObf(raw, flat);
      normalized.push(clampObfToRawTokens(reobf, raw, grid2D));
    }
    const outs = computeOutputs(raws, grid2D, iter);
    const inCoords = (($('#coordInput')||{}).value||'').trim() ? parseCoordLines($('#coordInput').value) : new Array(raws.length).fill(null);
    window._geo_internalChange=true;
    setVal('rawBox', stripUndefinedLiteral(raws.join('\n')));
    setVal('obfBox', stripUndefinedLiteral(normalized.join('\n')));
    setVal('outCoordBox', stripUndefinedLiteral(outs.map(formatOut).join('\n')));
    updateErrorBox(inCoords, outs);
    window._geo_internalChange=false;

    // Dispatch live update for fullscreen vertical mode
    try {
      const evt = new CustomEvent('geosonify:updateCode', {
        detail: { 
          tokens: raws.length ? tokenizeWithGrid(raws[0], grid2D) : [], 
          copyText: raws[0] || '' 
        }
      });
      window.dispatchEvent(evt);
    } catch(e){}
  }

  function refreshFromLast(){
    if (window._geo_lastEdited==='raw') updateFromRaw();
    else if (window._geo_lastEdited==='obf') updateFromObf();
    else updateFromCoords();
  }

  // ---------------- Listeners ----------------
  function bindGridListeners(){
    const se = selectEl(), pe = passEl(), ce = customEl();
    function maybeSetDefaultIterations(){
      if (!se) return;
      const key = se.value, iter = defaultIterationsByGrid[key];
      if (typeof iter==='number') setVal('iterInput', iter);
    }
    if (se){
      se.addEventListener('input', ()=>{
        delete window._geo_safeMaxIter[activeGridKey()]; // reset clamp when grid changes
        maybeSetDefaultIterations();
        applyIterMaxForGrid();
        refreshFromLast();
      });
      se.addEventListener('change', ()=>{
        delete window._geo_safeMaxIter[activeGridKey()];
        maybeSetDefaultIterations();
        applyIterMaxForGrid();
        refreshFromLast();
      });
    }
    if (pe){
      pe.addEventListener('input', ()=>{
        delete window._geo_safeMaxIter[activeGridKey()];
        refreshFromLast();
      });
      pe.addEventListener('change', ()=>{
        delete window._geo_safeMaxIter[activeGridKey()];
        refreshFromLast();
      });
    }
    if (ce){ ce.addEventListener('input', refreshFromLast); ce.addEventListener('change', refreshFromLast); }
  }

  function attachListeners(){
    const cI=$('#coordInput'), rB=$('#rawBox'), oB=$('#obfBox'), it=$('#iterInput'), un=$('#unitSelect');
    if (cI) cI.addEventListener('input', updateFromCoords);
    if (rB) rB.addEventListener('input', updateFromRaw);
    if (oB) oB.addEventListener('input', updateFromObf);

    // Iterations: enforce cap, clamp on real clip, refresh
    if (it) {
      const onIterChange = () => {
        applyIterMaxForGrid();                  // enforce hard cap immediately
        const grid2D = getActiveGrid2D(); if (!grid2D) return;
        const req = iterationsValue();
        const eff = enforceSafeIterations(req, grid2D);
        if (eff !== req) setVal('iterInput', eff);   // snap back immediately
        refreshFromLast();
      };
      it.addEventListener('input', onIterChange);
      it.addEventListener('change', onIterChange);
    }

    if (un) un.addEventListener('change', ()=>{
      const inCoords=parseCoordLines(($('#coordInput')||{}).value||'');
      const outs=(($('#outCoordBox')||{}).value||'').split(/\n+/).map(s=>{
        const p=(s||'').split(','); if(p.length<2) return null;
        const la=parseFloat(p[0]), lo=parseFloat(p[1]);
        return (isFinite(la)&&isFinite(lo))?[la,lo]:null;
      });
      updateErrorBox(inCoords, outs);
    });

    // Copy buttons
    const cr=$('#copyRawBtn'); if (cr) cr.addEventListener('click', ()=>navigator.clipboard.writeText(($('#rawBox')||{}).value||''));
    const co=$('#copyObfBtn'); if (co) co.addEventListener('click', ()=>navigator.clipboard.writeText(($('#obfBox')||{}).value||''));
    const cx=$('#copyOutBtn'); if (cx) cx.addEventListener('click', ()=>navigator.clipboard.writeText(($('#outCoordBox')||{}).value||''));

    
    // Geolocation: tap = one-shot; hold ≥600ms = toggle tracking  (reverted to stable v11.6h pattern)
    let watchId=null, holdTimer=null;
    const btn=$('#getCurrentBtn');

    function getCurrent(){
      if(!navigator.geolocation) return alert('Geolocation not supported.');
      navigator.geolocation.getCurrentPosition(pos=>{
        const {latitude,longitude,accuracy}=pos.coords;
        if ($('#coordInput')) $('#coordInput').value=`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        updateTrackBadge(false, accuracy);
        updateFromCoords();
      },err=>alert('Error: '+err.message),{enableHighAccuracy:true, timeout:8000, maximumAge:0});
    }

    function toggleTracking(){
      if(watchId){
        try { navigator.geolocation.clearWatch(watchId); } catch(e){}
        watchId=null;
        if(btn) btn.textContent='ðŸ“ Get Current (tap) / Hold for tracking';
        updateTrackBadge(false);
      } else {
        if(!navigator.geolocation) return alert('Geolocation not supported.');
        try {
          watchId=navigator.geolocation.watchPosition(pos=>{
            const {latitude,longitude,accuracy}=pos.coords;
            if ($('#coordInput')) $('#coordInput').value=`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
            updateTrackBadge(true, accuracy);
            updateFromCoords();
          },err=>alert('Error: '+(err&&err.message?err.message:String(err))),{enableHighAccuracy:true, timeout:8000, maximumAge:0});
          if(btn) btn.textContent='â¹ Stop Tracking';
          updateTrackBadge(true);
        } catch(e){
          alert('Unable to start tracking.');
          updateTrackBadge(false);
        }
      }
    }

    if (btn){
      btn.addEventListener('mousedown', ()=>{ holdTimer=setTimeout(()=>{ holdTimer=null; toggleTracking(); },600); });
      btn.addEventListener('mouseup',   ()=>{ if(holdTimer){ clearTimeout(holdTimer); holdTimer=null; getCurrent(); } });
      btn.addEventListener('mouseleave',()=>{ if(holdTimer){ clearTimeout(holdTimer); holdTimer=null; } });
      btn.addEventListener('touchstart',()=>{ holdTimer=setTimeout(()=>{ holdTimer=null; toggleTracking(); },600); }, {passive:true});
      btn.addEventListener('touchend',  ()=>{ if(holdTimer){ clearTimeout(holdTimer); holdTimer=null; getCurrent(); } }, {passive:true});
    }
  }

  // ---- Robust tracking helpers ----
  let _geo_watchId = null;
  let _geo_lastFixTs = 0;
  let _geo_fallbackTimer = null;

  function setTrackStatus(txt){
    const el = document.getElementById('geoTrackStatus');
    if (el) el.innerHTML = txt;
  }
  function updateTrackBadge(on, acc){
    const accText = (isFinite(acc) ? ` • ${acc.toFixed(0)} m` : '');
    setTrackStatus(`Tracking: <strong>${on ? 'On' : 'Off'}</strong>${on ? accText : ''}`);
  }

  function applyPosition(pos){
    const { latitude, longitude, accuracy } = pos.coords;
    const cI = document.getElementById('coordInput');
    if (cI) cI.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    _geo_lastFixTs = Date.now();
    updateTrackBadge(true, accuracy);
    
    try { 
      updateFromCoords(); 
      
      // Dispatch event for fullscreen updates
      const g = getActiveGrid2D();
      if (g) {
        const rb = (document.getElementById('rawBox') || {}).value || '';
        const first = rb.split(/\n+/).filter(Boolean)[0] || '';
        const evt = new CustomEvent('geosonify:updateCode', {
          detail: { 
            tokens: tokenizeWithGrid(first, g), 
            copyText: first 
          }
        });
        window.dispatchEvent(evt);
      }
    } catch(e){}
  }

  function startTracking(){
    if (!navigator.geolocation) { alert('Geolocation not supported.'); return; }
    stopTracking(true);
    const btn = document.getElementById('getCurrentBtn');
    if (btn) btn.textContent = 'â¹ Stop Tracking';
    try {
      _geo_watchId = navigator.geolocation.watchPosition(applyPosition, onGeoError, {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 0
      });
      updateTrackBadge(true);
      // Fallback ping: if no fix within 15s, force a one-shot getCurrent
      _geo_fallbackTimer = setInterval(()=>{
        if (Date.now() - _geo_lastFixTs > 15000) {
          navigator.geolocation.getCurrentPosition(applyPosition, onGeoError, { enableHighAccuracy: true });
        }
      }, 15000);
    } catch(e){
      onGeoError(e);
    }
  }

  function stopTracking(silent){
    if (_geo_watchId){
      try { navigator.geolocation.clearWatch(_geo_watchId); } catch(e){}
      _geo_watchId = null;
    }
    if (_geo_fallbackTimer){ clearInterval(_geo_fallbackTimer); _geo_fallbackTimer = null; }
    if (!silent){
      const btn = document.getElementById('getCurrentBtn');
      if (btn) btn.textContent='ðŸ“ Get Current (tap) / Hold for tracking';
    }
    updateTrackBadge(false);
  }

  function onGeoError(err){
    console.warn('Geolocation error:', err);
    updateTrackBadge(false);
    const btn = document.getElementById('getCurrentBtn');
    if (btn) btn.textContent='ðŸ“ Get Current (tap) / Hold for tracking';
    // Try a one-shot as a fallback
    try {
      navigator.geolocation.getCurrentPosition(applyPosition, ()=>{}, { enableHighAccuracy: true, timeout: 8000 });
    } catch(e){}
  }

  // ---------------- Init ----------------
  function init(){
    ensureCodecSection();
    wrapShufflerDetailsBetweenMarkers();

    // Default iterations for active grid + apply hard cap
    const se=selectEl();
    const key= se ? se.value : 'alphanumeric';
    const def = (defaultIterationsByGrid[key]!==undefined)? defaultIterationsByGrid[key] : 9;
    if (!setVal('iterInput', def)) {
      // create a tiny fallback if somehow missing
      const tb = document.createElement('div');
      tb.className='toolbar';
      tb.innerHTML = `<label for="iterInput">Iterations</label><input id="iterInput" type="number" min="1" step="1" value="${def}">`;
      const cs = document.getElementById('codecSection');
      if (cs) cs.insertBefore(tb, cs.firstChild);
    }
    applyIterMaxForGrid();

    attachListeners();
    updateTrackBadge(false);
    bindGridListeners();
    refreshFromLast();
  
    try {
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then(st => {
          if (st.state === 'granted') {
            // Prime immediate fix (non-blocking); user can then click to start live tracking
            navigator.geolocation.getCurrentPosition(applyPosition, ()=>{}, { enableHighAccuracy:true, timeout:5000 });
          }
        }).catch(()=>{});
      }
    } catch(e){}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
