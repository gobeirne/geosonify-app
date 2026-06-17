/*
  geosonify-custom-grid.js v1.1
  Custom Grid Upload Module for Geosonify
  
  Features:
  - Upload CSV/TSV grid files or paste directly
  - Auto-detect delimiter (tab, comma, semicolon)
  - Validate grid structure
  - Warn (but allow) duplicate tokens
  - "Treat as musical notes" option for sonification
  - Persists custom grids to localStorage
  - Integrates with CARD_GRIDS and cardState
  
  Usage:
    // Initialize with references to app state
    CustomGridLoader.init({
      CARD_GRIDS: CARD_GRIDS,
      cardState: cardState,
      saveCardState: saveCardState,
      renderCards: renderCards,
      onGridLoaded: (key) => { ... }
    });
    
    // Create UI in a container
    CustomGridLoader.createUI('customGridContainer');
    
    // Grids are auto-loaded from localStorage on init
*/

(function(global) {
  'use strict';

  const __CUSTOM_GRID_VER__ = 'v1.1';
  const STORAGE_KEY = 'geosonify_custom_grids';
  
  try { console.log('[geosonify] custom-grid ' + __CUSTOM_GRID_VER__ + ' loaded'); } catch(e) {}

  // ============== STATE ==============
  let _config = {
    CARD_GRIDS: null,
    cardState: null,
    saveCardState: null,
    renderCards: null,
    onGridLoaded: null
  };

  // ============== PARSING ==============

  function detectDelimiter(text) {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return '\t';
    
    const firstLine = lines[0];
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    
    if (tabCount >= commaCount && tabCount >= semicolonCount && tabCount > 0) return '\t';
    if (commaCount >= semicolonCount && commaCount > 0) return ',';
    if (semicolonCount > 0) return ';';
    return '\t';
  }

  function parseGridText(text, options = {}) {
    const result = {
      valid: false,
      grid: null,
      name: options.name || 'Custom',
      isMusical: !!options.isMusical,
      isWords: !!options.isWords,
      rows: 0,
      cols: 0,
      tokenCount: 0,
      uniqueCount: 0,
      errors: [],
      warnings: []
    };

    if (!text || typeof text !== 'string' || !text.trim()) {
      result.errors.push('No data provided');
      return result;
    }

    const trimmed = text.trim();
    const delimiter = options.delimiter || detectDelimiter(trimmed);
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    
    if (lines.length === 0) {
      result.errors.push('No data lines found');
      return result;
    }

    const grid = [];
    let expectedCols = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const cells = line.split(delimiter).map(s => s.trim()).filter(s => s.length > 0);
      
      if (cells.length === 0) continue;

      if (expectedCols === null) {
        expectedCols = cells.length;
      } else if (cells.length !== expectedCols) {
        result.errors.push(`Row ${i + 1}: Expected ${expectedCols} columns, got ${cells.length}`);
        continue;
      }

      grid.push(cells);
    }

    if (grid.length === 0) {
      result.errors.push('No valid rows found');
      return result;
    }

    result.rows = grid.length;
    result.cols = expectedCols;
    result.grid = grid;

    const flat = grid.flat();
    const tokenSet = new Set(flat);
    result.tokenCount = flat.length;
    result.uniqueCount = tokenSet.size;

    if (tokenSet.size !== flat.length) {
      const seen = new Map();
      const duplicates = [];
      for (const token of flat) {
        seen.set(token, (seen.get(token) || 0) + 1);
      }
      for (const [token, count] of seen) {
        if (count > 1) duplicates.push(`"${token}" (×${count})`);
      }
      result.warnings.push(`Duplicate tokens: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? ` and ${duplicates.length - 5} more` : ''}`);
    }

    if (result.rows < 2 || result.cols < 2) {
      result.errors.push(`Grid too small: ${result.rows}×${result.cols} (minimum 2×2)`);
      return result;
    }

    result.valid = result.errors.length === 0;
    return result;
  }

  function parseGridFile(file, options = {}) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const name = options.name || file.name.replace(/\.[^.]+$/, '') || 'Custom';
        resolve(parseGridText(e.target.result, { ...options, name }));
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  // ============== STORAGE ==============

  function loadStoredGrids() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      return JSON.parse(stored);
    } catch (e) {
      console.warn('[custom-grid] Failed to load stored grids:', e);
      return [];
    }
  }

  function saveStoredGrids(grids) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(grids));
    } catch (e) {
      console.warn('[custom-grid] Failed to save grids:', e);
    }
  }

  function addToStorage(gridData) {
    const grids = loadStoredGrids();
    // Remove any existing grid with same key
    const filtered = grids.filter(g => g.key !== gridData.key);
    filtered.push(gridData);
    saveStoredGrids(filtered);
  }

  function removeFromStorage(key) {
    const grids = loadStoredGrids();
    saveStoredGrids(grids.filter(g => g.key !== key));
  }

  /**
   * Update the stored iterations for a custom grid.
   * Called when user changes iterations via +/- buttons.
   */
  function updateStoredIterations(key, iterations) {
    const grids = loadStoredGrids();
    const grid = grids.find(g => g.key === key);
    if (grid) {
      grid.iterations = iterations;
      saveStoredGrids(grids);
    }
  }

  // ============== REGISTRATION ==============

  function generateKey(name) {
    const base = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 20);
    let key = base;
    let suffix = 1;
    while (_config.CARD_GRIDS && _config.CARD_GRIDS[key]) {
      key = base + '_' + suffix++;
    }
    return key;
  }

  // Characters forbidden in custom grid names (would break URL params)
  const FORBIDDEN_NAME_CHARS = /[.~=&?#/%\\'"<>\s]/g;
  
  function sanitizeGridName(name) {
    return name.replace(FORBIDDEN_NAME_CHARS, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  function registerGrid(parseResult, existingKey = null) {
    if (!parseResult.valid || !parseResult.grid) {
      throw new Error('Invalid grid cannot be registered');
    }

    if (!_config.CARD_GRIDS) {
      throw new Error('CARD_GRIDS not initialized');
    }

    // Sanitize name to be URL-safe
    parseResult.name = sanitizeGridName(parseResult.name) || 'Custom';

    const key = existingKey || generateKey(parseResult.name);
    const totalCells = parseResult.rows * parseResult.cols;
    const bitsPerIter = Math.log2(totalCells);
    const defaultIter = Math.max(4, Math.min(12, Math.floor(28 / bitsPerIter)));

    // Word mode (BIP39-style): prefixLength turns on word display, delimiter
    // joins words, and checksum support. Auto-pick the shortest unique prefix.
    var wordPrefix = null;
    if (parseResult.isWords) {
      wordPrefix = computeWordPrefix(parseResult.grid);
    }

    const gridDef = {
      name: parseResult.name,
      grid: parseResult.grid,
      defaultIterations: defaultIter,
      maxIterations: 12,
      isEmoji: !parseResult.isWords && containsEmoji(parseResult.grid),
      isCustom: true,
      isMusical: parseResult.isMusical,
      display: parseResult.isMusical ? 'music' : ((!parseResult.isWords && containsEmoji(parseResult.grid)) ? 'emoji' : null)
    };
    if (parseResult.isWords && wordPrefix) {
      gridDef.prefixLength = wordPrefix.prefixLength;
      gridDef.delimiter = '-';
    }

    _config.CARD_GRIDS[key] = gridDef;

    if (_config.cardState) {
      if (!_config.cardState.iterations[key]) {
        _config.cardState.iterations[key] = defaultIter;
      }
      if (!_config.cardState.order.includes(key)) {
        _config.cardState.order.push(key);
      }
      if (!_config.cardState.visible.includes(key)) {
        _config.cardState.visible.push(key);
      }
    }

    // Save to localStorage (include user-set iterations if available)
    const storageData = {
      key: key,
      name: parseResult.name,
      grid: parseResult.grid,
      isMusical: parseResult.isMusical,
      isWords: !!parseResult.isWords
    };
    // Preserve any user-modified iterations
    if (_config.cardState && _config.cardState.iterations[key]) {
      storageData.iterations = _config.cardState.iterations[key];
    }
    addToStorage(storageData);

    // Trigger callbacks
    if (_config.saveCardState) _config.saveCardState();
    if (_config.renderCards) _config.renderCards();
    if (_config.onGridLoaded) _config.onGridLoaded(key, gridDef);

    console.log(`[custom-grid] Registered "${key}": ${parseResult.rows}×${parseResult.cols}`);
    return key;
  }

  function unregisterGrid(key) {
    if (!_config.CARD_GRIDS || !_config.CARD_GRIDS[key]) return false;
    if (!_config.CARD_GRIDS[key].isCustom) {
      console.warn('[custom-grid] Cannot remove built-in grid:', key);
      return false;
    }

    // Remove from our own localStorage
    removeFromStorage(key);

    // Delegate to CardRenderer if available — it handles CARD_GRIDS + cardState + saveCardState + renderCards
    if (typeof CardRenderer !== 'undefined' && CardRenderer.unregisterGrid) {
      CardRenderer.unregisterGrid(key);
    } else {
      // Fallback: clean up manually
      delete _config.CARD_GRIDS[key];
      if (_config.cardState) {
        delete _config.cardState.iterations[key];
        _config.cardState.order = _config.cardState.order.filter(k => k !== key);
        _config.cardState.visible = _config.cardState.visible.filter(k => k !== key);
        if (_config.cardState.active === key) {
          _config.cardState.active = _config.cardState.order[0] || 'alphanumeric';
        }
        if (_config.saveCardState) _config.saveCardState();
      }
      if (_config.renderCards) _config.renderCards();
    }
    
    // Update the loaded list UI if it exists
    const loadedDiv = document.getElementById('cgLoaded');
    if (loadedDiv) {
      const container = loadedDiv.closest('[id="customGridContainer"]') || loadedDiv.parentElement;
      if (container && container._updateList) container._updateList();
    }
    
    return true;
  }

  function containsEmoji(grid) {
    const flat = grid.flat().join('');
    return /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(flat);
  }

  // Smallest leading-character count that keeps every word unique (like BIP39's
  // 4). Returns { prefixLength, unique } — unique:false means even full words
  // collide, so prefix-matched entry can't be relied on (caller should warn).
  function computeWordPrefix(grid) {
    const words = grid.flat().map(function (w) { return String(w); });
    const maxLen = words.reduce(function (m, w) { return Math.max(m, w.length); }, 0);
    for (var p = 1; p <= maxLen; p++) {
      var set = new Set();
      for (var i = 0; i < words.length; i++) set.add(words[i].slice(0, p).toLowerCase());
      if (set.size === words.length) return { prefixLength: p, unique: true };
    }
    return { prefixLength: maxLen || 1, unique: false };
  }

  // ============== RESTORE FROM STORAGE ==============

  function restoreGridsFromStorage() {
    const stored = loadStoredGrids();
    let restored = 0;
    
    for (const gridData of stored) {
      try {
        if (_config.CARD_GRIDS[gridData.key]) continue; // Already exists
        
        const parseResult = {
          valid: true,
          grid: gridData.grid,
          name: gridData.name,
          isMusical: gridData.isMusical,
          isWords: !!gridData.isWords,
          rows: gridData.grid.length,
          cols: gridData.grid[0]?.length || 0,
          errors: [],
          warnings: []
        };
        
        registerGrid(parseResult, gridData.key);
        
        // Restore user-modified iterations if saved — do this AFTER registerGrid
        // but BEFORE the final saveCardState, so the correct value persists
        if (gridData.iterations && _config.cardState) {
          _config.cardState.iterations[gridData.key] = gridData.iterations;
          // Also update the CARD_GRIDS definition so the value survives any
          // re-initialization that checks defaultIterations
          if (_config.CARD_GRIDS[gridData.key]) {
            _config.CARD_GRIDS[gridData.key].defaultIterations = gridData.iterations;
          }
        }
        
        restored++;
      } catch (e) {
        console.warn('[custom-grid] Failed to restore grid:', gridData.key, e);
      }
    }
    
    if (restored > 0) {
      console.log(`[custom-grid] Restored ${restored} custom grid(s) from storage`);
      // Save cardState after all iterations are restored, so geosonify_card_state
      // reflects the correct user-set iterations (not the defaults set during registerGrid)
      if (typeof CardRenderer !== 'undefined' && CardRenderer.saveCardState) {
        CardRenderer.saveCardState();
      }
    }
  }

  // ============== UI ==============

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function createGridPreview(parseResult, maxRows = 4, maxCols = 6) {
    if (!parseResult.grid) return '';

    const rows = parseResult.grid.slice(0, maxRows);
    const truncR = parseResult.rows > maxRows;
    const truncC = parseResult.cols > maxCols;

    let html = '<table style="border-collapse:collapse;margin:8px 0;font-size:13px;">';
    for (const row of rows) {
      html += '<tr>';
      for (const cell of row.slice(0, maxCols)) {
        html += `<td style="border:1px solid #ddd;padding:3px 6px;">${escapeHtml(cell)}</td>`;
      }
      if (truncC) html += '<td style="color:#999;">…</td>';
      html += '</tr>';
    }
    if (truncR) {
      html += `<tr><td colspan="${Math.min(parseResult.cols, maxCols) + (truncC ? 1 : 0)}" style="color:#999;text-align:center;">…</td></tr>`;
    }
    html += '</table>';
    html += `<div style="font-size:12px;color:#666;">${parseResult.rows}×${parseResult.cols} = ${parseResult.tokenCount} tokens`;
    if (parseResult.uniqueCount !== parseResult.tokenCount) {
      html += ` (${parseResult.uniqueCount} unique)`;
    }
    html += '</div>';
    return html;
  }

  function createUI(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return null;

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div>
          <label style="display:block;margin-bottom:4px;font-weight:500;">Grid Name</label>
          <input type="text" id="cgName" value="Custom" style="width:100%;padding:6px 8px;border:1px solid #ccc;border-radius:4px;">
        </div>
        
        <div>
          <label style="display:block;margin-bottom:4px;font-weight:500;">Import CSV/TSV File</label>
          <input type="file" id="cgFile" accept=".csv,.tsv,.txt" style="font-size:14px;">
        </div>
        
        <div>
          <label style="display:block;margin-bottom:4px;font-weight:500;">Or Paste Grid Data</label>
          <textarea id="cgText" placeholder="Paste tab or comma separated values..." style="width:100%;height:80px;padding:8px;border:1px solid #ccc;border-radius:4px;font-family:monospace;font-size:12px;resize:vertical;"></textarea>
        </div>
        
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="cgMusical">
          <label for="cgMusical" style="margin:0;cursor:pointer;">Treat as musical notes</label>
        </div>
        
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="cgWords">
          <label for="cgWords" style="margin:0;cursor:pointer;">Treat as words (BIP39-style)</label>
        </div>
        
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button id="cgLoadBtn" style="padding:8px 16px;background:#28a745;color:white;border:none;border-radius:4px;cursor:pointer;">Load Grid</button>
          <button id="cgClearBtn" style="padding:8px 16px;background:#6c757d;color:white;border:none;border-radius:4px;cursor:pointer;">Clear</button>
        </div>
        
        <div id="cgPreview"></div>
        <div id="cgMessages"></div>
        <div id="cgLoaded"></div>
      </div>
    `;

    const fileInput = document.getElementById('cgFile');
    const textArea = document.getElementById('cgText');
    const nameInput = document.getElementById('cgName');
    const musicalCheck = document.getElementById('cgMusical');
    const wordsCheck = document.getElementById('cgWords');
    const loadBtn = document.getElementById('cgLoadBtn');
    const clearBtn = document.getElementById('cgClearBtn');
    const previewDiv = document.getElementById('cgPreview');
    const messagesDiv = document.getElementById('cgMessages');
    const loadedDiv = document.getElementById('cgLoaded');

    // A grid is notes OR words OR neither — never both.
    musicalCheck.addEventListener('change', () => { if (musicalCheck.checked) wordsCheck.checked = false; });
    wordsCheck.addEventListener('change', () => { if (wordsCheck.checked) musicalCheck.checked = false; });

    function showMessages(result, success = false) {
      let html = '';
      for (const err of result.errors || []) {
        html += `<div style="color:#dc3545;margin:2px 0;">❌ ${escapeHtml(err)}</div>`;
      }
      for (const warn of result.warnings || []) {
        html += `<div style="color:#856404;margin:2px 0;">⚠️ ${escapeHtml(warn)}</div>`;
      }
      if (success) {
        html += `<div style="color:#28a745;margin:2px 0;">✓ Grid loaded successfully!</div>`;
      } else if (result.valid && !success) {
        html += `<div style="color:#28a745;margin:2px 0;">✓ Valid grid. Click "Load Grid" to use it.</div>`;
      }
      messagesDiv.innerHTML = html;
    }

    function updateLoadedList() {
      const custom = Object.entries(_config.CARD_GRIDS || {}).filter(([k, v]) => v.isCustom);
      if (custom.length === 0) {
        loadedDiv.innerHTML = '';
        return;
      }
      
      let html = '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #ddd;"><strong>Loaded Custom Grids:</strong>';
      for (const [key, def] of custom) {
        const dims = def.grid ? `${def.grid.length}×${def.grid[0].length}` : '?';
        const flags = [def.isMusical ? '🎵' : '', def.prefixLength ? '🔤' : '', def.isEmoji ? '😀' : ''].filter(Boolean).join('');
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;">
          <span>${escapeHtml(def.name)} (${dims}) ${flags}</span>
          <button onclick="CustomGridLoader.unregisterGrid('${key}')" style="padding:2px 8px;background:#dc3545;color:white;border:none;border-radius:3px;cursor:pointer;font-size:12px;">Remove</button>
        </div>`;
      }
      html += '</div>';
      loadedDiv.innerHTML = html;
    }

    // File input
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      try {
        const result = await parseGridFile(file, {
          name: nameInput.value || file.name.replace(/\.[^.]+$/, ''),
          isMusical: musicalCheck.checked,
          isWords: wordsCheck.checked
        });
        previewDiv.innerHTML = result.grid ? createGridPreview(result) : '';
        showMessages(result);
        
        // Load text for editing
        const reader = new FileReader();
        reader.onload = (e) => { textArea.value = e.target.result; };
        reader.readAsText(file);
      } catch (err) {
        messagesDiv.innerHTML = `<div style="color:#dc3545;">❌ ${escapeHtml(err.message)}</div>`;
      }
    });

    // Text area preview
    let previewTimer = null;
    textArea.addEventListener('input', () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        const text = textArea.value.trim();
        if (!text) {
          previewDiv.innerHTML = '';
          messagesDiv.innerHTML = '';
          return;
        }
        const result = parseGridText(text, {
          name: nameInput.value || 'Custom',
          isMusical: musicalCheck.checked,
          isWords: wordsCheck.checked
        });
        previewDiv.innerHTML = result.grid ? createGridPreview(result) : '';
        showMessages(result);
      }, 300);
    });

    // Load button
    loadBtn.addEventListener('click', () => {
      const text = textArea.value.trim();
      if (!text) {
        messagesDiv.innerHTML = '<div style="color:#dc3545;">❌ Please paste or upload grid data first.</div>';
        return;
      }

      const result = parseGridText(text, {
        name: nameInput.value || 'Custom',
        isMusical: musicalCheck.checked,
        isWords: wordsCheck.checked
      });

      if (!result.valid) {
        showMessages(result);
        return;
      }

      // Word mode relies on words being distinguishable by a leading prefix.
      // If full words still collide, prefix-matched entry won't be reliable.
      if (result.isWords && result.grid) {
        const wp = computeWordPrefix(result.grid);
        if (!wp.unique) {
          result.warnings = result.warnings || [];
          result.warnings.push('Some words are identical — word-entry matching may be unreliable.');
        }
      }

      // Sanitize grid name for URL safety (z.GridName format)
      // Forbid characters that would break URL params: . ~ = & ? # / \ % space
      if (result.name) {
        result.name = result.name.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/^_+|_+$/g, '') || 'Custom';
      }

      try {
        registerGrid(result);
        showMessages(result, true);
        updateLoadedList();
      } catch (err) {
        messagesDiv.innerHTML = `<div style="color:#dc3545;">❌ ${escapeHtml(err.message)}</div>`;
      }
    });

    // Clear button
    clearBtn.addEventListener('click', () => {
      textArea.value = '';
      nameInput.value = 'Custom';
      musicalCheck.checked = false;
      wordsCheck.checked = false;
      fileInput.value = '';
      previewDiv.innerHTML = '';
      messagesDiv.innerHTML = '';
    });

    // Initial list
    updateLoadedList();

    // Expose updateLoadedList for after unregister
    container._updateList = updateLoadedList;

    return container;
  }

  // ============== INIT ==============

  function init(config) {
    _config = { ..._config, ...config };
    
    // Restore grids from localStorage
    if (_config.CARD_GRIDS) {
      restoreGridsFromStorage();
    }
    
    console.log('[custom-grid] Initialized');
  }

  // ============== EXPORT ==============

  global.CustomGridLoader = {
    version: __CUSTOM_GRID_VER__,
    init,
    parseGridText,
    parseGridFile,
    registerGrid,
    unregisterGrid,
    createUI,
    createGridPreview,
    loadStoredGrids,
    restoreGridsFromStorage,
    updateStoredIterations
  };

})(typeof window !== 'undefined' ? window : this);
