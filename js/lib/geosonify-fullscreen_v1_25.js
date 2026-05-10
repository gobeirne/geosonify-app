/*
  geosonify-fullscreen.v1.24.js - WITH 3x3 GRID VIEW + ANIMATIONS
  - UPDATED: RGB111 with 50% notch width and 50% border by default
  - NEW: Long-press any cell to copy that code (with fade-out toast)
  - Position dot showing GPS location within center cell
  - Cell width/height dimensions with arrows in center cell
  - Direction labels at far edges of outer cells
  - 3x3 grid view showing adjacent codes
  - Animated transitions when moving between cells (400ms slide)
  - Blur transition for large jumps
  - FIXES: Proper orientation switching cleanup
  - FIXES: Double overlay prevention  
  - FIXES: Portrait/landscape mode routing
  - Provides "Full screen" overlay for Hierarchical/Obfuscated codes
  - Adds "Settings" button (background colour + show/hide coordinates)
  - Tap/click to exit, long-press to copy the code
  - Auto-injects fullscreen buttons into UI
*/

(function(){
  'use strict';
  const __GEOSONIFY_FULLSCREEN_VER__ = 'v1.25';
  try { console.log('[geosonify] fullscreen ' + __GEOSONIFY_FULLSCREEN_VER__ + ' loaded'); } catch(e){}

  // ---------------- DOM helpers ----------------
  function $(sel, root){ return (root||document).querySelector(sel); }
  function $all(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }
  
  // Scroll lock for immovable fullscreen
  let __fs_scrollY = 0, __fs_locked = false;
  function fsLockScroll(){
    if (__fs_locked) return;
    __fs_scrollY = window.scrollY || window.pageYOffset || 0;
    
    const html = document.documentElement;
    const body = document.body;
    
    html.style.scrollBehavior = 'auto';
    body.style.position = 'fixed';
    body.style.top = (-__fs_scrollY) + 'px';
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.height = '100vh';
    body.style.overflow = 'hidden';
    body.style.touchAction = 'none';
    
    html.style.overflow = 'hidden';
    html.style.height = '100%';
    
    __fs_locked = true;
  }
  
  function fsUnlockScroll(){
    if (!__fs_locked) return;
    
    const html = document.documentElement;
    const body = document.body;
    
    body.style.position = '';
    body.style.top = '';
    body.style.left = '';
    body.style.right = '';
    body.style.width = '';
    body.style.height = '';
    body.style.overflow = '';
    body.style.touchAction = '';
    
    html.style.overflow = '';
    html.style.height = '';
    
    window.scrollTo(0, __fs_scrollY||0);
    html.style.scrollBehavior = '';
    
    __fs_locked = false;
  }

  // CRITICAL: Global cleanup to remove ALL overlays
  function cleanupAllOverlays(){
    const existing = document.querySelectorAll('.fs-overlay');
    existing.forEach(el => {
      try {
        if (el._fsCleanup) el._fsCleanup();
        if (el._fsCleanupVertical) el._fsCleanupVertical();
        if (el._cleanupViewport) el._cleanupViewport();
        if (el._fsCleanupOrientation) el._fsCleanupOrientation();
        el.remove();
      } catch(e){
        console.error('Cleanup error:', e);
      }
    });
    try { fsUnlockScroll(); } catch(e){}
  }

  function setVal(id, v){ const el=document.getElementById(id); if(!el) return false; el.value=v; return true; }
  
  // Mini helper to derive the current shuffled grid
  function _fs_getActiveGrid2D(){
    try {
      if (typeof window.loadBaseGrid !== 'function' || typeof window.shuffleGridAndOrder !== 'function') return null;
      const sel = document.getElementById('gridSelect');
      const gridKey = (sel && sel.value) || undefined;
      const tuple = window.loadBaseGrid(gridKey, true);
      const base = tuple && tuple[0] ? tuple[0] : null;
      if (!base) return null;
      const passEl = document.getElementById('passphrase');
      const pass = passEl ? passEl.value : '';
      const shuffled = window.shuffleGridAndOrder(base, pass);
      return (shuffled && shuffled.grid) ? shuffled.grid : null;
    } catch(e){ return null; }
  }

  function getActiveLineInfo(textarea){
    if (!textarea) return { line: 0, text: '' };
    const val = textarea.value||'';
    let start = 0, i = 0, sel = textarea.selectionStart|0;
    const lines = val.split(/\n/);
    for (i=0, start=0; i<lines.length; i++){
      const end = start + lines[i].length + 1;
      if (sel <= end || i === lines.length-1) break;
      start = end;
    }
    return { line: i, text: lines[i]||'', all: lines };
  }

  // ---------------- Settings storage ----------------
  const FS_STORE = {
    bgKey: 'geo_fs_bg',
    showCoordsKey: 'geo_fs_showCoords',
    vertPortraitKey: 'geo_fs_vertPortrait',
  };
  
  function readFSSetting(key, fallback){
    try{
      const v = localStorage.getItem(key);
      if (v===null) return fallback;
      if (v==='true') return true;
      if (v==='false') return false;
      return v;
    }catch(e){ return fallback; }
  }
  
  function writeFSSetting(key, val){
    try{ localStorage.setItem(key, String(val)); }catch(e){}
  }

  // ---------------- Styles ----------------
  function ensureFSStyles(){
    if (document.getElementById('fsStyles')) return;
    const s = document.createElement('style');
    s.id = 'fsStyles';
    s.textContent = `
      .fs-overlay { 
        position: fixed; 
        top: 0; left: 0; right: 0; bottom: 0;
        width: 100vw; width: 100dvw;
        height: 100vh; height: 100dvh;
        min-height: 100vh; min-height: 100dvh;
        max-height: 100vh; max-height: 100dvh;
        padding: env(safe-area-inset-top, 0) env(safe-area-inset-right, 0) env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 0);
        z-index: 999999;
        display: grid; 
        grid-template-rows: 1fr auto; 
        align-items: center;
        background: var(--fs-bg, #000); 
        color: var(--fs-fg, #fff);
        overscroll-behavior: none; 
        touch-action: none;
        overflow: hidden;
        isolation: isolate;
      }
      .fs-center {
        display:flex; 
        align-items:center; 
        justify-content:center;
        width:100%; 
        height:100%; 
        padding: 0 4vw; 
        box-sizing: border-box; 
        user-select: text;
        overflow: hidden;
      }
      .fs-code {
        line-height: 1; 
        white-space: nowrap; 
        font-family: 'Source Code Pro', ui-monospace, system-ui, monospace;
        font-weight: 600; 
        text-align:center; 
        width:100%;
        -webkit-tap-highlight-color: transparent;
      }
      .fs-footer {
        padding: 10px 14px 14px; 
        text-align:center; 
        font-size: 12px; 
        opacity: .65;
        font-family: system-ui, sans-serif;
        padding-bottom: max(14px, env(safe-area-inset-bottom, 14px));
      }
      .fs-toast {
        position: fixed; 
        bottom: 22px; 
        left: 50%; 
        transform: translateX(-50%);
        background: rgba(0,0,0,.75); 
        color: #fff; 
        padding: 8px 12px; 
        border-radius: 8px;
        font: 600 12px system-ui, sans-serif; 
        z-index: 1000000; 
        pointer-events:none;
      }
      .fs-dialog-backdrop {
        position: fixed; 
        inset: 0; 
        background: rgba(0,0,0,.4); 
        z-index: 999990;
        display:flex; 
        align-items:center; 
        justify-content:center;
      }
      .fs-dialog {
        background: #fff; 
        color: #111; 
        border-radius: 12px; 
        padding: 16px; 
        width: min(92vw, 420px);
        font-family: system-ui, sans-serif; 
        box-shadow: 0 10px 28px rgba(0,0,0,.2);
      }
      .fs-dialog h3 { margin: 0 0 8px; font-size: 18px; }
      .fs-dialog label { display:flex; align-items:center; gap:8px; margin: 10px 0 6px; font-size: 14px; }
      .fs-row { display:flex; gap:8px; align-items:center; }
      .fs-dialog input[type="text"] { flex:1 1 auto; padding:8px; font-size:14px; }
      .fs-actions { display:flex; gap:8px; justify-content:flex-end; margin-top: 14px; }
      .fs-actions button { padding: 8px 10px; border-radius: 8px; border: 1px solid #ccc; background: #f6f6f6; cursor: pointer; }
      .fs-mini-btn {
        margin-left: 8px; padding: 4px 8px; font-size: 12px; line-height: 1; cursor: pointer;
        border-radius: 6px; border: 1px solid #ccc; background: #f6f6f6;
      }
      .fs-vertical {
        display:flex;
        flex-direction:column;
        align-items:center;
        width:100%;
      }
      .fs-vline {
        text-align:center;
      }
      
      /* 3x3 Grid Styles */
      .fs-grid-3x3 {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        grid-template-rows: repeat(3, 1fr);
        gap: 2px;
        width: 100%;
        height: 100%;
        max-width: min(95vw, 95vh);
        max-height: min(95vw, 95vh);
        aspect-ratio: 1;
        margin: auto;
        position: relative;
        overflow: hidden;
      }
      .fs-grid-cell {
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(255,255,255,0.2);
        border-radius: 4px;
        padding: 4px;
        overflow: hidden;
        font-family: 'Source Code Pro', ui-monospace, system-ui, monospace;
        font-weight: 500;
        text-align: center;
        word-break: break-all;
        background: rgba(255,255,255,0.03);
        position: relative;
      }
      .fs-grid-cell.center {
        background: rgba(255,255,255,0.15);
        border: 2px solid rgba(255,255,255,0.5);
        font-weight: 700;
      }
      .fs-grid-cell .cell-content {
        line-height: 1.1;
      }
      .fs-grid-cell.edge {
        opacity: 0.6;
        font-style: italic;
      }
      .fs-grid-cell::before {
        content: attr(data-direction);
        position: absolute;
        font-size: 0.5em;
        opacity: 0.4;
        font-family: system-ui, sans-serif;
        font-weight: 400;
      }
      /* Position direction labels at far edges */
      .fs-grid-cell:nth-child(1)::before { top: 2px; left: 4px; }
      .fs-grid-cell:nth-child(2)::before { top: 2px; left: 50%; transform: translateX(-50%); }
      .fs-grid-cell:nth-child(3)::before { top: 2px; right: 4px; left: auto; }
      .fs-grid-cell:nth-child(4)::before { top: 50%; left: 4px; transform: translateY(-50%); }
      .fs-grid-cell:nth-child(5)::before { display: none; }
      .fs-grid-cell:nth-child(6)::before { top: 50%; right: 4px; left: auto; transform: translateY(-50%); }
      .fs-grid-cell:nth-child(7)::before { bottom: 2px; left: 4px; top: auto; }
      .fs-grid-cell:nth-child(8)::before { bottom: 2px; left: 50%; top: auto; transform: translateX(-50%); }
      .fs-grid-cell:nth-child(9)::before { bottom: 2px; right: 4px; left: auto; top: auto; }
      
      @keyframes fs-blur-in {
        0% { opacity: 0; filter: blur(8px); }
        100% { opacity: 1; filter: blur(0); }
      }
      .fs-blur-transition {
        animation: fs-blur-in 0.6s ease-out forwards;
      }
      .fs-grid-content-layer {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
        overflow: hidden;
      }
      .fs-floating-code {
        position: absolute;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: 'Source Code Pro', ui-monospace, system-ui, monospace;
        font-weight: 500;
        text-align: center;
        word-break: break-word;
        overflow-wrap: break-word;
        hyphens: none;
        padding: 4px;
        box-sizing: border-box;
        line-height: 1.2;
      }
      .fs-floating-code.is-center {
        font-weight: 700;
      }
      .fs-floating-code.word-code {
        word-break: normal;
      }
      
      /* RGB111 Image Styles */
      .fs-image-container {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
        padding: 20px;
        box-sizing: border-box;
      }
      .fs-image-single {
        max-width: 95%;
        max-height: 95%;
        object-fit: contain;
        border-radius: 8px;
      }
      .fs-image-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        grid-template-rows: repeat(3, 1fr);
        gap: 8px;
        width: min(95vw, 95vh);
        height: min(95vw, 95vh);
        max-width: 100%;
        max-height: 100%;
      }
      .fs-image-cell {
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        overflow: hidden;
        position: relative;
      }
      .fs-image-cell canvas,
      .fs-image-cell img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .fs-image-cell.center {
        box-shadow: 0 0 0 3px rgba(255,255,255,0.5);
      }
      .fs-image-cell.empty {
        background: rgba(255,255,255,0.05);
        opacity: 0.4;
      }
      .fs-image-cell::before {
        content: attr(data-direction);
        position: absolute;
        font-size: 10px;
        opacity: 0.5;
        font-family: system-ui, sans-serif;
        z-index: 1;
        padding: 2px 4px;
        background: rgba(0,0,0,0.5);
        border-radius: 2px;
      }
      .fs-image-cell:nth-child(1)::before { top: 4px; left: 4px; }
      .fs-image-cell:nth-child(2)::before { top: 4px; left: 50%; transform: translateX(-50%); }
      .fs-image-cell:nth-child(3)::before { top: 4px; right: 4px; left: auto; }
      .fs-image-cell:nth-child(4)::before { top: 50%; left: 4px; transform: translateY(-50%); }
      .fs-image-cell:nth-child(5)::before { display: none; }
      .fs-image-cell:nth-child(6)::before { top: 50%; right: 4px; left: auto; transform: translateY(-50%); }
      .fs-image-cell:nth-child(7)::before { bottom: 4px; left: 4px; top: auto; }
      .fs-image-cell:nth-child(8)::before { bottom: 4px; left: 50%; top: auto; transform: translateX(-50%); }
      .fs-image-cell:nth-child(9)::before { bottom: 4px; right: 4px; left: auto; top: auto; }
    `;
    document.head.appendChild(s);
  }

  function pickTextColor(bg){
    const tmp = document.createElement('canvas').getContext('2d');
    tmp.fillStyle = bg || '#000';
    const c = tmp.fillStyle;
    const m = /^#?([0-9a-f]{6})$/i.exec(c);
    if (!m) return '#fff';
    const r = parseInt(m[1].slice(0,2),16), g=parseInt(m[1].slice(2,4),16), b=parseInt(m[1].slice(4,6),16);
    const L = 0.2126*r + 0.7152*g + 0.0722*b;
    return (L < 140) ? '#fff' : '#111';
  }

  function fitTextToWidth(el, maxPx){
    el.style.fontSize = '18vw';
    const measure = () => {
      el.style.display = 'inline-block';
      const w = el.scrollWidth;
      el.style.display = 'block';
      if (!w || !isFinite(w)) return;
      const cur = parseFloat(getComputedStyle(el).fontSize)||16;
      const ratio = maxPx / w;
      const next = Math.max(8, Math.floor(cur * ratio));
      el.style.fontSize = next + 'px';
    };
    measure(); 
    requestAnimationFrame(measure);
  }

  function toast(msg){
    const t = document.createElement('div');
    t.className = 'fs-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(()=>{ t.remove(); }, 1200);
  }

  // ========== 3x3 GRID HELPERS ==========
  
  function getAdjacentCodeViaCoords(code, dRow, dCol, grid2D, iterations) {
    if (!code || !grid2D || !window.GeoCodec) return null;
    
    var center = window.GeoCodec.decodeHierarchical(code, grid2D, iterations);
    if (!center) return null;
    
    var flat = window.GeoCodec.flattenGrid(grid2D);
    var tokens = window.GeoCodec.tokenizeCode(code, flat);
    if (!tokens || !tokens.length) return null;
    
    // For center cell (dRow=0, dCol=0), still re-encode to ensure consistency
    if (dRow === 0 && dCol === 0) {
      return window.GeoCodec.encodeHierarchical(center[0], center[1], grid2D, tokens.length);
    }
    
    var dims = window.GeoCodec.gridDims(grid2D);
    var rows = dims.rows;
    var cols = dims.cols;
    
    var cellLatSize = 180 / Math.pow(rows, tokens.length);
    var cellLonSize = 360 / Math.pow(cols, tokens.length);
    
    var newLat = center[0] - (dRow * cellLatSize);
    var newLon = center[1] + (dCol * cellLonSize);
    
    if (newLat < -90 || newLat > 90) return null;
    
    if (newLon < -180) newLon += 360;
    if (newLon >= 180) newLon -= 360;
    
    return window.GeoCodec.encodeHierarchical(newLat, newLon, grid2D, tokens.length);
  }
  
  function get3x3Codes(centerCode, grid2D, iterations) {
    var directions = [
      { dRow: -1, dCol: -1, label: 'NW' },
      { dRow: -1, dCol: 0, label: 'N' },
      { dRow: -1, dCol: 1, label: 'NE' },
      { dRow: 0, dCol: -1, label: 'W' },
      { dRow: 0, dCol: 0, label: 'C' },
      { dRow: 0, dCol: 1, label: 'E' },
      { dRow: 1, dCol: -1, label: 'SW' },
      { dRow: 1, dCol: 0, label: 'S' },
      { dRow: 1, dCol: 1, label: 'SE' }
    ];
    
    return directions.map(function(d) {
      return {
        code: getAdjacentCodeViaCoords(centerCode, d.dRow, d.dCol, grid2D, iterations),
        label: d.label,
        isCenter: d.dRow === 0 && d.dCol === 0
      };
    });
  }
  
  function maybeObfuscate(code, grid2D, isObfMode) {
    if (!isObfMode || !code || !window.GeoCodec) return code;
    var flat = window.GeoCodec.flattenGrid(grid2D);
    return window.GeoCodec.obfuscateUpToValid('encode', code, flat) || code;
  }

  // ========== GEODESIC HELPERS ==========
  function calcGeodesicDistance(lat1, lon1, lat2, lon2) {
    if (window.GeoCore && window.GeoCore.geodesicInverse) {
      try {
        var result = window.GeoCore.geodesicInverse(lat1, lon1, lat2, lon2);
        if (result && typeof result.s12 === 'number') return result.s12;
      } catch(e) {}
    }
    // Fallback to Haversine
    var R = 6371000;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  function formatDistance(meters) {
    if (meters >= 1000) return (meters / 1000).toFixed(1) + ' km';
    if (meters >= 100) return meters.toFixed(0) + ' m';
    if (meters >= 1) return meters.toFixed(1) + ' m';
    if (meters >= 0.01) return (meters * 100).toFixed(1) + ' cm';
    if (meters >= 0.001) return (meters * 1000).toFixed(1) + ' mm';
    return (meters * 1000000).toFixed(1) + ' µm';
  }

  function detectDirectionFromCoords(oldLat, oldLon, newLat, newLon) {
    var dLat = newLat - oldLat;
    var dLon = newLon - oldLon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    if (Math.abs(dLat) < 0.0000001 && Math.abs(dLon) < 0.0000001) return null;
    var ns = dLat > 0 ? 'n' : (dLat < 0 ? 's' : '');
    var ew = dLon > 0 ? 'e' : (dLon < 0 ? 'w' : '');
    if (Math.abs(dLat) > Math.abs(dLon) * 3) return ns;
    if (Math.abs(dLon) > Math.abs(dLat) * 3) return ew;
    return ns + ew;
  }

  // ========== 3x3 GRID FULLSCREEN ==========
  function show3x3Grid(centerCode, opts) {
    cleanupAllOverlays();
    ensureFSStyles();
    
    var bg = (opts && opts.bg) || readFSSetting(FS_STORE.bgKey, '#000000') || '#000000';
    var fg = pickTextColor(bg);
    var showCoords = !!readFSSetting(FS_STORE.showCoordsKey, true);
    var footerText = (opts && opts.footerText) || '';
    var isObfMode = opts && opts.isObfMode;
    
    var grid2D = _fs_getActiveGrid2D();
    if (!grid2D) {
      toast('Grid not available');
      return;
    }
    
    var iterInput = document.getElementById('iterInput');
    var iterations = iterInput ? parseInt(iterInput.value) || 9 : 9;
    
    var wrap = document.createElement('div');
    wrap.className = 'fs-overlay';
    wrap.style.setProperty('--fs-bg', bg);
    wrap.style.setProperty('--fs-fg', fg);

    var centerDiv = document.createElement('div'); 
    centerDiv.className = 'fs-center';
    var footer = document.createElement('div'); 
    footer.className = 'fs-footer';
    
    var gridContainer = document.createElement('div');
    gridContainer.className = 'fs-grid-3x3';
    
    var contentLayer = document.createElement('div');
    contentLayer.className = 'fs-grid-content-layer';
    
    var dirLabels = ['NW', 'N', 'NE', 'W', 'C', 'E', 'SW', 'S', 'SE'];
    var previousCodes = null;
    var lastCenterCode = null;
    var isAnimating = false;
    var currentFontSize = 16;
    
    // Movement map: when we move in direction X, codes visually shift in direction Y
    var movementMap = {
      'n':  { dx: 0, dy: 1 },
      's':  { dx: 0, dy: -1 },
      'e':  { dx: -1, dy: 0 },
      'w':  { dx: 1, dy: 0 },
      'ne': { dx: -1, dy: 1 },
      'nw': { dx: 1, dy: 1 },
      'se': { dx: -1, dy: -1 },
      'sw': { dx: 1, dy: -1 }
    };
    
    function detectMovementDirection(oldCodes, newCenterCode) {
      if (!oldCodes || !newCenterCode) return null;
      // If new center was at position X in old grid, we moved in direction X
      // e.g., if new center was at old N position, we moved North
      var directionFromOldPosition = {
        0: 'nw', 1: 'n', 2: 'ne',
        3: 'w',  4: null, 5: 'e',
        6: 'sw', 7: 's', 8: 'se'
      };
      for (var i = 0; i < oldCodes.length; i++) {
        if (oldCodes[i] && oldCodes[i].code === newCenterCode) {
          return directionFromOldPosition[i];
        }
      }
      return null;
    }
    
    function indexToXY(idx) {
      return { x: idx % 3, y: Math.floor(idx / 3) };
    }
    
    function buildGridCells() {
      gridContainer.innerHTML = '';
      for (var i = 0; i < 9; i++) {
        var cell = document.createElement('div');
        cell.className = 'fs-grid-cell';
        if (i === 4) cell.classList.add('center');
        cell.setAttribute('data-direction', dirLabels[i]);
        gridContainer.appendChild(cell);
      }
    }
    
    function isWordBasedCode(code) {
      if (!code) return false;
      // Has spaces or hyphens
      if (code.indexOf(' ') !== -1 || code.indexOf('-') !== -1) return true;
      // PascalCase detection: has multiple capital letters (word boundaries)
      var caps = (code.match(/[A-Z]/g) || []).length;
      return caps >= 2;
    }
    
    function formatCodeForDisplay(code) {
      if (!code) return code;
      // If already has spaces/hyphens, leave it
      if (code.indexOf(' ') !== -1 || code.indexOf('-') !== -1) return code;
      // Insert zero-width spaces before capital letters for word wrapping
      // But not at the start
      return code.replace(/([a-z])([A-Z])/g, '$1\u200B$2');
    }
    
    function calculateFontSize(codes, isWordBased) {
      var cellWidth = gridContainer.offsetWidth / 3 - 16;
      var cellHeight = gridContainer.offsetHeight / 3 - 16;
      
      if (isWordBased) {
        // For word-based codes, calculate based on longest "word segment"
        var maxSegmentLen = 1;
        var maxTotalLen = 1;
        codes.forEach(function(c) {
          if (c.displayCode) {
            // Split on capitals or spaces/hyphens
            var segments = c.displayCode.split(/(?=[A-Z])|\s+|-+/).filter(Boolean);
            segments.forEach(function(seg) {
              if (seg.length > maxSegmentLen) maxSegmentLen = seg.length;
            });
            if (c.displayCode.length > maxTotalLen) maxTotalLen = c.displayCode.length;
          }
        });
        // Size based on fitting ~2-3 segments per line
        var charsPerLine = Math.max(maxSegmentLen, Math.ceil(maxTotalLen / 3));
        var fontSize = Math.min(cellHeight * 0.28, cellWidth / (charsPerLine * 0.6));
        return Math.max(10, Math.min(fontSize, 24));
      } else {
        // Original logic for symbol codes
        var maxLen = 1;
        codes.forEach(function(c) {
          if (c.displayCode && c.displayCode.length > maxLen) maxLen = c.displayCode.length;
        });
        var targetWidth = cellWidth * 0.85;
        var fontSize = Math.min(cellHeight * 0.25, targetWidth / (maxLen * 0.55));
        return Math.max(8, Math.min(fontSize, cellHeight * 0.4));
      }
    }
    
    function renderInstant(codes, gpsLat, gpsLon) {
      contentLayer.innerHTML = '';
      var cellWidth = gridContainer.offsetWidth / 3;
      var cellHeight = gridContainer.offsetHeight / 3;
      var isWordBased = codes.some(function(c) { return isWordBasedCode(c.displayCode); });
      
      codes.forEach(function(c, idx) {
        var pos = indexToXY(idx);
        var el = document.createElement('div');
        el.className = 'fs-floating-code';
        if (idx === 4) el.classList.add('is-center');
        if (isWordBased) el.classList.add('word-code');
        // Format for display (add zero-width spaces for wrapping)
        el.textContent = isWordBased ? formatCodeForDisplay(c.displayCode) : c.displayCode;
        el.style.fontSize = currentFontSize + 'px';
        el.style.width = cellWidth + 'px';
        el.style.height = cellHeight + 'px';
        el.style.left = (pos.x * cellWidth) + 'px';
        el.style.top = (pos.y * cellHeight) + 'px';
        if (!c.code) el.style.opacity = '0.6';
        contentLayer.appendChild(el);
      });
      
      // Add position dot and dimensions
      addCenterOverlay(gpsLat, gpsLon, cellWidth, cellHeight);
    }
    
    function addCenterOverlay(gpsLat, gpsLon, cellWidth, cellHeight) {
      if (!window.GeoCodec || gpsLat === undefined || gpsLon === undefined) return;
      
      var dims = window.GeoCodec.gridDims(grid2D);
      var cellLatSize = 180 / Math.pow(dims.rows, iterations);
      var cellLonSize = 360 / Math.pow(dims.cols, iterations);
      
      // Find cell boundaries
      var cellCenterLat = Math.floor((gpsLat + 90) / cellLatSize) * cellLatSize + cellLatSize/2 - 90;
      var cellCenterLon = Math.floor((gpsLon + 180) / cellLonSize) * cellLonSize + cellLonSize/2 - 180;
      var northBorder = cellCenterLat + cellLatSize/2;
      var southBorder = cellCenterLat - cellLatSize/2;
      var eastBorder = cellCenterLon + cellLonSize/2;
      var westBorder = cellCenterLon - cellLonSize/2;
      
      // Cell dimensions in meters
      var widthMeters = calcGeodesicDistance(cellCenterLat, westBorder, cellCenterLat, eastBorder);
      var heightMeters = calcGeodesicDistance(southBorder, cellCenterLon, northBorder, cellCenterLon);
      
      // GPS position within cell (0-1)
      var xRatio = Math.max(0, Math.min(1, (gpsLon - westBorder) / cellLonSize));
      var yRatio = Math.max(0, Math.min(1, 1 - (gpsLat - southBorder) / cellLatSize));
      
      // Center cell screen position
      var centerX = cellWidth;
      var centerY = cellHeight;
      
      // Position dot - subtle grey, BEHIND text (z-index: 1, codes are higher)
      var dot = document.createElement('div');
      dot.style.cssText = 'position:absolute;width:10px;height:10px;background:rgba(160,160,160,0.5);border-radius:50%;border:1px solid rgba(200,200,200,0.7);transform:translate(-50%,-50%);z-index:1;pointer-events:none;';
      dot.style.left = (centerX + xRatio * cellWidth) + 'px';
      dot.style.top = (centerY + yRatio * cellHeight) + 'px';
      contentLayer.insertBefore(dot, contentLayer.firstChild);
      
      // Height label - top left of center cell, close to border, rotated
      var heightLabel = document.createElement('div');
      heightLabel.style.cssText = 'position:absolute;display:flex;align-items:center;justify-content:center;font-size:0.4em;opacity:0.5;font-family:system-ui,sans-serif;white-space:nowrap;pointer-events:none;z-index:10;';
      heightLabel.innerHTML = 'â†' + formatDistance(heightMeters) + '→';
      heightLabel.style.left = (centerX + 3) + 'px';
      heightLabel.style.top = (centerY + 6) + 'px';
      heightLabel.style.transformOrigin = 'left top';
      heightLabel.style.transform = 'rotate(-90deg) translateX(-100%)';
      contentLayer.appendChild(heightLabel);
      
      // Width label - top left, below height label area
      var widthLabel = document.createElement('div');
      widthLabel.style.cssText = 'position:absolute;display:flex;align-items:center;justify-content:center;font-size:0.4em;opacity:0.5;font-family:system-ui,sans-serif;white-space:nowrap;pointer-events:none;z-index:10;';
      widthLabel.innerHTML = 'â†' + formatDistance(widthMeters) + '→';
      widthLabel.style.left = (centerX + 18) + 'px';
      widthLabel.style.top = (centerY + 4) + 'px';
      contentLayer.appendChild(widthLabel);
    }
    
    function animateTransition(oldCodes, newCodes, direction, gpsLat, gpsLon) {
      isAnimating = true;
      var move = movementMap[direction];
      var cellWidth = gridContainer.offsetWidth / 3;
      var cellHeight = gridContainer.offsetHeight / 3;
      var isWordBased = newCodes.some(function(c) { return isWordBasedCode(c.displayCode); });
      
      contentLayer.innerHTML = '';
      
      // Create sliding layer
      var slidingLayer = document.createElement('div');
      slidingLayer.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;transition:transform 0.4s ease-out;';
      
      // Add NEW codes at their final positions
      newCodes.forEach(function(c, idx) {
        var pos = indexToXY(idx);
        var el = document.createElement('div');
        el.className = 'fs-floating-code';
        if (idx === 4) el.classList.add('is-center');
        if (isWordBased) el.classList.add('word-code');
        el.textContent = isWordBased ? formatCodeForDisplay(c.displayCode) : c.displayCode;
        el.style.fontSize = currentFontSize + 'px';
        el.style.width = cellWidth + 'px';
        el.style.height = cellHeight + 'px';
        el.style.left = (pos.x * cellWidth) + 'px';
        el.style.top = (pos.y * cellHeight) + 'px';
        if (!c.code) el.style.opacity = '0.6';
        slidingLayer.appendChild(el);
      });
      
      // Add OLD codes that will EXIT (slide off-screen)
      oldCodes.forEach(function(c, idx) {
        var oldPos = indexToXY(idx);
        var exitX = oldPos.x + move.dx;
        var exitY = oldPos.y + move.dy;
        
        if (exitX < 0 || exitX > 2 || exitY < 0 || exitY > 2) {
          var el = document.createElement('div');
          el.className = 'fs-floating-code';
          if (isWordBased) el.classList.add('word-code');
          el.textContent = isWordBased ? formatCodeForDisplay(c.displayCode) : c.displayCode;
          el.style.fontSize = currentFontSize + 'px';
          el.style.width = cellWidth + 'px';
          el.style.height = cellHeight + 'px';
          el.style.left = (exitX * cellWidth) + 'px';
          el.style.top = (exitY * cellHeight) + 'px';
          if (!c.code) el.style.opacity = '0.6';
          slidingLayer.appendChild(el);
        }
      });
      
      // Start with layer offset (codes appear to come from direction of movement)
      slidingLayer.style.transform = 'translate(' + (-move.dx * cellWidth) + 'px, ' + (-move.dy * cellHeight) + 'px)';
      
      contentLayer.appendChild(slidingLayer);
      
      // Force reflow
      void slidingLayer.offsetHeight;
      
      // Slide to origin (final position)
      requestAnimationFrame(function() {
        slidingLayer.style.transform = 'translate(0, 0)';
        setTimeout(function() {
          isAnimating = false;
        }, 400);
      });
      
      // Add overlay (doesn't slide with codes)
      addCenterOverlay(gpsLat, gpsLon, cellWidth, cellHeight);
    }
    
    function blurTransition(codes, direction, gpsLat, gpsLon) {
      isAnimating = true;
      var cellWidth = gridContainer.offsetWidth / 3;
      var cellHeight = gridContainer.offsetHeight / 3;
      var isWordBased = codes.some(function(c) { return isWordBasedCode(c.displayCode); });
      
      contentLayer.innerHTML = '';
      
      var slidingLayer = document.createElement('div');
      slidingLayer.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;';
      slidingLayer.className = 'fs-blur-transition';
      
      if (direction && movementMap[direction]) {
        var move = movementMap[direction];
        slidingLayer.style.transform = 'translate(' + (-move.dx * cellWidth * 0.3) + 'px, ' + (-move.dy * cellHeight * 0.3) + 'px)';
        slidingLayer.style.transition = 'transform 0.6s ease-out';
      }
      
      codes.forEach(function(c, idx) {
        var pos = indexToXY(idx);
        var el = document.createElement('div');
        el.className = 'fs-floating-code';
        if (idx === 4) el.classList.add('is-center');
        if (isWordBased) el.classList.add('word-code');
        el.textContent = isWordBased ? formatCodeForDisplay(c.displayCode) : c.displayCode;
        el.style.fontSize = currentFontSize + 'px';
        el.style.width = cellWidth + 'px';
        el.style.height = cellHeight + 'px';
        el.style.left = (pos.x * cellWidth) + 'px';
        el.style.top = (pos.y * cellHeight) + 'px';
        if (!c.code) el.style.opacity = '0.6';
        slidingLayer.appendChild(el);
      });
      
      contentLayer.appendChild(slidingLayer);
      addCenterOverlay(gpsLat, gpsLon, cellWidth, cellHeight);
      
      if (direction && movementMap[direction]) {
        void slidingLayer.offsetHeight;
        requestAnimationFrame(function() {
          slidingLayer.style.transform = 'translate(0, 0)';
        });
      }
      
      setTimeout(function() { isAnimating = false; }, 600);
    }
    
    var lastCoords = null;
    
    function renderCodes(rawCode, animate, gpsLat, gpsLon) {
      var codes = get3x3Codes(rawCode, grid2D, iterations);
      codes.forEach(function(c) {
        c.displayCode = c.code ? maybeObfuscate(c.code, grid2D, isObfMode) : '—';
      });
      
      var isWordBased = codes.some(function(c) { return isWordBasedCode(c.displayCode); });
      currentFontSize = calculateFontSize(codes, isWordBased);
      
      // Get cell center for direction detection
      var cellCenter = null;
      if (window.GeoCodec) {
        cellCenter = window.GeoCodec.decodeHierarchical(rawCode, grid2D, iterations);
      }
      
      var direction = null;
      var isLargeJump = false;
      if (animate && previousCodes && rawCode !== lastCenterCode && !isAnimating) {
        direction = detectMovementDirection(previousCodes, rawCode);
        if (!direction && lastCoords && cellCenter) {
          direction = detectDirectionFromCoords(lastCoords[0], lastCoords[1], cellCenter[0], cellCenter[1]);
          isLargeJump = true;
        }
      }
      
      if (isLargeJump && direction) {
        blurTransition(codes, direction, gpsLat, gpsLon);
      } else if (direction && movementMap[direction]) {
        animateTransition(previousCodes, codes, direction, gpsLat, gpsLon);
      } else {
        renderInstant(codes, gpsLat, gpsLon);
      }
      
      previousCodes = codes.map(function(c) { return { code: c.code, displayCode: c.displayCode, label: c.label }; });
      lastCenterCode = rawCode;
      lastCoords = cellCenter;
    }
    
    // Build grid
    buildGridCells();
    
    // centerCode is already raw hierarchical (caller decodes if needed)
    var initialRawCode = centerCode;
    
    centerDiv.appendChild(gridContainer);
    gridContainer.appendChild(contentLayer);
    wrap.appendChild(centerDiv);
    wrap.appendChild(footer);
    document.body.appendChild(wrap);
    
    // Parse initial GPS coords
    var initialGpsLat, initialGpsLon;
    if (footerText) {
      var parts = footerText.split(/[,\s]+/).map(function(s) { return parseFloat(s.trim()); });
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        initialGpsLat = parts[0];
        initialGpsLon = parts[1];
      }
    }
    
    requestAnimationFrame(function() {
      renderCodes(initialRawCode, false, initialGpsLat, initialGpsLon);
    });
    
    try{ fsLockScroll(); }catch(e){}
    footer.textContent = showCoords ? footerText : '';
    footer.style.display = showCoords ? '' : 'none';
    
    // Orientation/resize handler
    function handleResize() {
      requestAnimationFrame(function() {
        renderCodes(lastCenterCode || initialRawCode, false);
      });
    }
    window.addEventListener('orientationchange', handleResize, { passive: true });
    window.addEventListener('resize', handleResize, { passive: true });
    wrap._fsCleanupOrientation = function() {
      window.removeEventListener('orientationchange', handleResize);
      window.removeEventListener('resize', handleResize);
    };

    // Live updates
    function onUpdate() {
      try {
        var ctx = window._geo_fs_last || null;
        if (ctx && ctx.mode) {
          var ta = document.getElementById(ctx.mode === 'raw' ? 'rawBox' : 'obfBox');
          if (ta) {
            var lines = (ta.value||'').split(/\n+/).map(function(s){return s.trim();}).filter(Boolean);
            var idx = Math.min(Math.max(0, ctx.line|0), Math.max(0, lines.length-1));
            var str = lines[idx] || '';
            
            if (isObfMode && window.GeoCodec) {
              var flat = window.GeoCodec.flattenGrid(grid2D);
              str = window.GeoCodec.obfuscateUpToValid('decode', str, flat) || str;
            }
            
            // Parse GPS coordinates
            var gpsLat, gpsLon;
            var ci = document.getElementById('coordInput');
            if (ci && ci.value) {
              var parts = ci.value.split(/[,\s]+/).map(function(s) { return parseFloat(s.trim()); });
              if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                gpsLat = parts[0];
                gpsLon = parts[1];
              }
            }
            
            renderCodes(str, true, gpsLat, gpsLon);
            
            if (showCoords && ci) {
              footer.textContent = ci.value || '';
            }
          }
        }
      } catch(err){}
    }
    window.addEventListener('geosonify:updateCode', onUpdate);

    var obs = new MutationObserver(function(){
      if (!document.body.contains(wrap)) {
        window.removeEventListener('geosonify:updateCode', onUpdate);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // Exit handling with long-press to copy any cell
    var pressTimer = null, copied = false, pressX = 0, pressY = 0;
    
    function showCellToast(text, x, y) {
      var t = document.createElement('div');
      t.textContent = text + ' copied';
      t.style.cssText = 'position:fixed;padding:6px 12px;background:rgba(0,0,0,0.8);color:#fff;border-radius:4px;font-size:14px;font-family:system-ui,sans-serif;pointer-events:none;z-index:100001;opacity:1;transition:opacity 0.5s ease-out;';
      t.style.left = x + 'px';
      t.style.top = (y - 40) + 'px';
      t.style.transform = 'translateX(-50%)';
      document.body.appendChild(t);
      setTimeout(function() { t.style.opacity = '0'; }, 500);
      setTimeout(function() { t.remove(); }, 1000);
    }
    
    function getCellIndexFromPoint(x, y) {
      var rect = gridContainer.getBoundingClientRect();
      var cellW = rect.width / 3;
      var cellH = rect.height / 3;
      var col = Math.floor((x - rect.left) / cellW);
      var row = Math.floor((y - rect.top) / cellH);
      if (col < 0 || col > 2 || row < 0 || row > 2) return -1;
      return row * 3 + col;
    }
    
    function startPress(e){
      // Prevent touches from reaching content underneath
      e.preventDefault();
      e.stopPropagation();
      
      copied = false;
      var touch = e.touches ? e.touches[0] : e;
      pressX = touch.clientX;
      pressY = touch.clientY;
      
      pressTimer = setTimeout(function(){
        try {
          // Clear any accidental text selection
          window.getSelection().removeAllRanges();
          
          var cellIdx = getCellIndexFromPoint(pressX, pressY);
          if (cellIdx >= 0 && previousCodes && previousCodes[cellIdx]) {
            var code = previousCodes[cellIdx].displayCode || previousCodes[cellIdx].code;
            if (code && code !== '—') {
              navigator.clipboard.writeText(code);
              showCellToast(code, pressX, pressY);
              copied = true;
            }
          }
        } catch(e){}
      }, 600);
    }
    function cancelPress(){ if (pressTimer){ clearTimeout(pressTimer); pressTimer=null; } }
    function exit(){ if (!copied) cleanupAllOverlays(); }

    wrap.addEventListener('mousedown', startPress);
    wrap.addEventListener('touchstart', startPress, { passive: false });
    wrap.addEventListener('mouseup', function(e){ e.preventDefault(); cancelPress(); exit(); });
    wrap.addEventListener('touchend', function(e){ e.preventDefault(); cancelPress(); exit(); }, { passive: false });
  }

  // ========== MUSIC NOTATION FULLSCREEN ==========
  
  // Check if we're in Music grid mode
  function isMusicGridMode() {
    var sel = document.getElementById('gridSelect');
    return sel && sel.value === 'music';
  }
  
  // Show music notation fullscreen
  function showMusicNotation(code, opts) {
    cleanupAllOverlays();
    ensureFSStyles();
    
    if (!window.VexFlowLib) {
      toast('VexFlow library not loaded');
      return;
    }
    
    if (!window.VexFlowLib.hasVexFlow()) {
      toast('VexFlow not available - add vexflow script');
      return;
    }
    
    // Music notation always uses white background for readability
    var bg = '#ffffff';
    var fg = '#000000';
    var showCoords = !!readFSSetting(FS_STORE.showCoordsKey, true);
    var footerText = (opts && opts.footerText) || '';
    var isObfMode = opts && opts.isObfMode;
    
    var wrap = document.createElement('div');
    wrap.className = 'fs-overlay';
    wrap.style.setProperty('--fs-bg', bg);
    wrap.style.setProperty('--fs-fg', fg);
    
    var container = document.createElement('div');
    container.className = 'fs-music-container';
    container.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:20px;box-sizing:border-box;';
    
    var musicDiv = document.createElement('div');
    musicDiv.id = 'fs-music-notation';
    musicDiv.style.cssText = 'background:#fff;border-radius:12px;padding:20px;max-width:95vw;max-height:85vh;overflow:auto;box-shadow:0 4px 20px rgba(0,0,0,0.15);';
    
    var footer = document.createElement('div');
    footer.className = 'fs-footer';
    footer.style.color = '#333';
    footer.textContent = showCoords ? footerText : '';
    footer.style.display = showCoords ? '' : 'none';
    
    var currentCode = code;
    
    function renderMusic(musicalCode) {
      // Parse the code to notes with octaves
      var notes = window.VexFlowLib.parseMusicalCode(musicalCode);
      if (notes.length === 0) {
        musicDiv.innerHTML = '<p style="color:#666;text-align:center;padding:40px;">No notes to display</p>';
        return;
      }
      
      // Find the octave range to determine if we need extra height
      var minOctave = 10, maxOctave = 0;
      for (var i = 0; i < notes.length; i++) {
        var match = notes[i].match(/[A-Ga-g](\d+)/);
        if (match) {
          var oct = parseInt(match[1]);
          if (oct < minOctave) minOctave = oct;
          if (oct > maxOctave) maxOctave = oct;
        }
      }
      
      // Calculate height based on octave range
      // Base height handles octaves 1-8 well (340px)
      // Add extra height for notes above octave 8 or below octave 1
      var baseHeight = 340;
      var extraTopSpace = Math.max(0, maxOctave - 8) * 40;
      var extraBottomSpace = Math.max(0, 1 - minOctave) * 40;
      var totalHeight = baseHeight + extraTopSpace + extraBottomSpace;
      
      // Calculate size based on viewport
      var vw = Math.min(window.innerWidth * 0.9, 400);
      var vh = Math.min(window.innerHeight * 0.75, 600);
      var scale = Math.min(vw / 160, vh / totalHeight, 2.5);
      
      musicDiv.innerHTML = '';
      window.VexFlowLib.renderToElement(musicDiv, notes, {
        width: 160,
        height: totalHeight,
        scale: scale,
        extraTopSpace: extraTopSpace,
        extraBottomSpace: extraBottomSpace
      });
    }
    
    container.appendChild(musicDiv);
    wrap.appendChild(container);
    wrap.appendChild(footer);
    document.body.appendChild(wrap);
    
    try { fsLockScroll(); } catch(e) {}
    
    // Initial render
    renderMusic(currentCode);
    
    // Live updates - read directly from the correct textarea (raw or obf)
    function onUpdate() {
      try {
        var ctx = window._geo_fs_last || null;
        if (ctx && ctx.mode) {
          // Always read from the textarea that matches the mode we opened with
          var ta = document.getElementById(ctx.mode === 'raw' ? 'rawBox' : 'obfBox');
          if (ta) {
            var lines = (ta.value || '').split(/\n+/).map(function(s) { return s.trim(); }).filter(Boolean);
            var idx = Math.min(Math.max(0, ctx.line | 0), Math.max(0, lines.length - 1));
            var str = lines[idx] || '';
            
            if (str !== currentCode) {
              currentCode = str;
              renderMusic(str);
            }
            
            if (showCoords) {
              var ci = document.getElementById('coordInput');
              if (ci) footer.textContent = ci.value || '';
            }
          }
        }
      } catch(err) {}
    }
    window.addEventListener('geosonify:updateCode', onUpdate);
    
    // Handle resize
    function handleResize() {
      requestAnimationFrame(function() {
        renderMusic(currentCode);
      });
    }
    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('orientationchange', handleResize, { passive: true });
    
    var obs = new MutationObserver(function() {
      if (!document.body.contains(wrap)) {
        window.removeEventListener('geosonify:updateCode', onUpdate);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('orientationchange', handleResize);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    
    // Exit handling
    var pressTimer = null, copied = false;
    function startPress() {
      copied = false;
      pressTimer = setTimeout(function() {
        try {
          // Copy the notes with octaves
          var notes = window.VexFlowLib.parseMusicalCode(currentCode);
          navigator.clipboard.writeText(notes.join(', '));
          toast('Notes copied: ' + notes.join(', '));
        } catch(e) {}
        copied = true;
      }, 600);
    }
    function cancelPress() { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }
    function exit() { if (!copied) cleanupAllOverlays(); }
    
    wrap.addEventListener('mousedown', startPress);
    wrap.addEventListener('touchstart', startPress, { passive: true });
    wrap.addEventListener('mouseup', function() { cancelPress(); exit(); });
    wrap.addEventListener('touchend', function() { cancelPress(); exit(); }, { passive: true });
  }
  
  // Open music notation from textarea
  function openMusicNotationFromTextarea(which) {
    var ta = (which === 'raw') ? document.getElementById('rawBox') : document.getElementById('obfBox');
    var coordsTA = document.getElementById('coordInput');
    var info = getActiveLineInfo(ta);
    var coordsInfo = getActiveLineInfo(coordsTA);
    var footer = (coordsInfo.all && info.line < coordsInfo.all.length) ? (coordsInfo.all[info.line] || '') : (coordsInfo.text || '');
    
    window._geo_fs_last = { mode: which, line: info.line, textarea: ta };
    showMusicNotation(info.text, { footerText: footer, isObfMode: which === 'obf' });
  }

  // ========== RGB111 IMAGE FULLSCREEN ==========
  
  // Check if we're in HexByte grid mode
  function isHexByteGridMode() {
    var sel = document.getElementById('gridSelect');
    return sel && sel.value === 'hexbyte';
  }
  
  // Convert hex byte code to RGB111 format (12 hex chars for 6 iterations of 16x16 grid)
  function hexByteCodeToRGB111(code) {
    if (!code || typeof code !== 'string') return null;
    // Remove any separators and normalize to uppercase
    var clean = code.toUpperCase().replace(/[^0-9A-F]/g, '');
    // Must be exactly 12 hex chars for 4x4 RGB111 grid
    if (clean.length !== 12) return null;
    return clean;
  }
  
  // Show single RGB111 image fullscreen
  function showRGB111Image(hexCode, opts) {
    cleanupAllOverlays();
    ensureFSStyles();
    
    if (!window.RGB111Lib || !window.RGB111Lib.generateCanvas) {
      toast('RGB111 library not loaded');
      return;
    }
    
    var rgb111Hex = hexByteCodeToRGB111(hexCode);
    if (!rgb111Hex) {
      toast('Invalid hex code for RGB111 (need 12 hex chars)');
      return;
    }
    
    var bg = (opts && opts.bg) || readFSSetting(FS_STORE.bgKey, '#000000') || '#000000';
    var fg = pickTextColor(bg);
    var showCoords = !!readFSSetting(FS_STORE.showCoordsKey, true);
    var footerText = (opts && opts.footerText) || '';
    var isObfMode = opts && opts.isObfMode;
    
    var wrap = document.createElement('div');
    wrap.className = 'fs-overlay';
    wrap.style.setProperty('--fs-bg', bg);
    wrap.style.setProperty('--fs-fg', fg);
    
    var container = document.createElement('div');
    container.className = 'fs-image-container';
    
    var footer = document.createElement('div');
    footer.className = 'fs-footer';
    footer.textContent = showCoords ? footerText : '';
    footer.style.display = showCoords ? '' : 'none';
    
    // Generate the canvas with 50% notch width and 50% border
    var canvas = window.RGB111Lib.generateCanvas(rgb111Hex, { 
      size: 600, 
      borderWidth: 0.5,
      showChecksum: true
    });
    canvas.className = 'fs-image-single';
    canvas.style.maxWidth = '90vmin';
    canvas.style.maxHeight = '90vmin';
    
    var currentCode = hexCode;
    
    container.appendChild(canvas);
    wrap.appendChild(container);
    wrap.appendChild(footer);
    document.body.appendChild(wrap);
    
    try { fsLockScroll(); } catch(e) {}
    
    // Live updates
    function onUpdate() {
      try {
        var ctx = window._geo_fs_last || null;
        if (ctx && ctx.mode) {
          var ta = document.getElementById(ctx.mode === 'raw' ? 'rawBox' : 'obfBox');
          if (ta) {
            var lines = (ta.value || '').split(/\n+/).map(function(s) { return s.trim(); }).filter(Boolean);
            var idx = Math.min(Math.max(0, ctx.line | 0), Math.max(0, lines.length - 1));
            var str = lines[idx] || '';
            
            if (str !== currentCode) {
              currentCode = str;
              var newRgb111Hex = hexByteCodeToRGB111(str);
              if (newRgb111Hex) {
                var newCanvas = window.RGB111Lib.generateCanvas(newRgb111Hex, { 
                  size: 600, 
                  borderWidth: 0.5,
                  showChecksum: true
                });
                newCanvas.className = 'fs-image-single';
                newCanvas.style.maxWidth = '90vmin';
                newCanvas.style.maxHeight = '90vmin';
                container.replaceChild(newCanvas, canvas);
                canvas = newCanvas;
              }
            }
            
            if (showCoords) {
              var ci = document.getElementById('coordInput');
              if (ci) footer.textContent = ci.value || '';
            }
          }
        }
      } catch(err) {}
    }
    window.addEventListener('geosonify:updateCode', onUpdate);
    
    var obs = new MutationObserver(function() {
      if (!document.body.contains(wrap)) {
        window.removeEventListener('geosonify:updateCode', onUpdate);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    
    // Exit handling
    var pressTimer = null, copied = false;
    function startPress() {
      copied = false;
      pressTimer = setTimeout(function() {
        try {
          navigator.clipboard.writeText(currentCode || '');
          toast('Code copied: ' + currentCode);
        } catch(e) {}
        copied = true;
      }, 600);
    }
    function cancelPress() { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }
    function exit() { if (!copied) cleanupAllOverlays(); }
    
    wrap.addEventListener('mousedown', startPress);
    wrap.addEventListener('touchstart', startPress, { passive: true });
    wrap.addEventListener('mouseup', function() { cancelPress(); exit(); });
    wrap.addEventListener('touchend', function() { cancelPress(); exit(); }, { passive: true });
  }
  
  // Show 3x3 grid of RGB111 images
  function showRGB111Grid(centerCode, opts) {
    cleanupAllOverlays();
    ensureFSStyles();
    
    if (!window.RGB111Lib || !window.RGB111Lib.generateCanvas) {
      toast('RGB111 library not loaded');
      return;
    }
    
    var grid2D = _fs_getActiveGrid2D();
    if (!grid2D) {
      toast('Grid not available');
      return;
    }
    
    var bg = (opts && opts.bg) || readFSSetting(FS_STORE.bgKey, '#000000') || '#000000';
    var fg = pickTextColor(bg);
    var showCoords = !!readFSSetting(FS_STORE.showCoordsKey, true);
    var footerText = (opts && opts.footerText) || '';
    var isObfMode = opts && opts.isObfMode;
    
    var iterInput = document.getElementById('iterInput');
    var iterations = iterInput ? parseInt(iterInput.value) || 6 : 6;
    
    var wrap = document.createElement('div');
    wrap.className = 'fs-overlay';
    wrap.style.setProperty('--fs-bg', bg);
    wrap.style.setProperty('--fs-fg', fg);
    
    var container = document.createElement('div');
    container.className = 'fs-image-container';
    
    var gridEl = document.createElement('div');
    gridEl.className = 'fs-image-grid';
    gridEl.style.position = 'relative';
    
    var footer = document.createElement('div');
    footer.className = 'fs-footer';
    footer.textContent = showCoords ? footerText : '';
    footer.style.display = showCoords ? '' : 'none';
    
    var dirLabels = ['NW', 'N', 'NE', 'W', 'C', 'E', 'SW', 'S', 'SE'];
    var displayCodes = [];
    var lastCenterCode = centerCode;
    var locationDot = null;
    
    // Create cells
    for (var i = 0; i < 9; i++) {
      var cell = document.createElement('div');
      cell.className = 'fs-image-cell';
      cell.setAttribute('data-direction', dirLabels[i]);
      if (i === 4) cell.classList.add('center');
      gridEl.appendChild(cell);
    }
    
    // Create location dot (above everything)
    locationDot = document.createElement('div');
    locationDot.style.cssText = 'position:absolute;width:12px;height:12px;background:rgba(255,100,100,0.9);border-radius:50%;border:2px solid rgba(255,255,255,0.9);transform:translate(-50%,-50%);z-index:100;pointer-events:none;box-shadow:0 0 8px rgba(255,100,100,0.8);display:none;';
    gridEl.appendChild(locationDot);
    
    function renderGrid(rawCode, gpsLat, gpsLon) {
      var codes = get3x3Codes(rawCode, grid2D, iterations);
      displayCodes = [];
      var cells = gridEl.querySelectorAll('.fs-image-cell');
      
      codes.forEach(function(c, idx) {
        var cell = cells[idx];
        cell.innerHTML = '';
        cell.classList.remove('empty');
        
        if (c.code) {
          var displayCode = isObfMode ? maybeObfuscate(c.code, grid2D, true) : c.code;
          displayCodes.push({ code: c.code, displayCode: displayCode, label: c.label });
          
          var rgb111Hex = hexByteCodeToRGB111(displayCode);
          if (rgb111Hex) {
            var canvas = window.RGB111Lib.generateCanvas(rgb111Hex, { 
              size: 400, 
              borderWidth: 0.5,
              showChecksum: true
            });
            cell.appendChild(canvas);
          } else {
            cell.classList.add('empty');
            cell.textContent = '—';
          }
        } else {
          cell.classList.add('empty');
          displayCodes.push({ code: null, displayCode: null, label: c.label });
        }
        
        // Re-add direction label
        cell.setAttribute('data-direction', dirLabels[idx]);
        if (idx === 4) cell.classList.add('center');
      });
      
      // Update location dot position
      updateLocationDot(gpsLat, gpsLon);
      lastCenterCode = rawCode;
    }
    
    function updateLocationDot(gpsLat, gpsLon) {
      if (!window.GeoCodec || gpsLat === undefined || gpsLon === undefined) {
        locationDot.style.display = 'none';
        return;
      }
      
      var dims = window.GeoCodec.gridDims(grid2D);
      var cellLatSize = 180 / Math.pow(dims.rows, iterations);
      var cellLonSize = 360 / Math.pow(dims.cols, iterations);
      
      // Find cell boundaries for center cell
      var cellCenterLat = Math.floor((gpsLat + 90) / cellLatSize) * cellLatSize + cellLatSize / 2 - 90;
      var cellCenterLon = Math.floor((gpsLon + 180) / cellLonSize) * cellLonSize + cellLonSize / 2 - 180;
      var northBorder = cellCenterLat + cellLatSize / 2;
      var southBorder = cellCenterLat - cellLatSize / 2;
      var eastBorder = cellCenterLon + cellLonSize / 2;
      var westBorder = cellCenterLon - cellLonSize / 2;
      
      // GPS position within cell (0-1)
      var xRatio = Math.max(0, Math.min(1, (gpsLon - westBorder) / cellLonSize));
      var yRatio = Math.max(0, Math.min(1, 1 - (gpsLat - southBorder) / cellLatSize));
      
      // Grid dimensions
      var gridRect = gridEl.getBoundingClientRect();
      var cellWidth = gridRect.width / 3;
      var cellHeight = gridRect.height / 3;
      
      // Center cell is at position (1,1) in the 3x3 grid
      var dotX = cellWidth + (xRatio * cellWidth);
      var dotY = cellHeight + (yRatio * cellHeight);
      
      locationDot.style.left = dotX + 'px';
      locationDot.style.top = dotY + 'px';
      locationDot.style.display = 'block';
    }
    
    // Parse initial GPS coords
    var initialGpsLat, initialGpsLon;
    if (footerText) {
      var parts = footerText.split(/[,\s]+/).map(function(s) { return parseFloat(s.trim()); });
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        initialGpsLat = parts[0];
        initialGpsLon = parts[1];
      }
    }
    
    container.appendChild(gridEl);
    wrap.appendChild(container);
    wrap.appendChild(footer);
    document.body.appendChild(wrap);
    
    try { fsLockScroll(); } catch(e) {}
    
    // Initial render
    requestAnimationFrame(function() {
      renderGrid(centerCode, initialGpsLat, initialGpsLon);
    });
    
    // Live updates
    function onUpdate() {
      try {
        var ctx = window._geo_fs_last || null;
        if (ctx && ctx.mode) {
          var ta = document.getElementById(ctx.mode === 'raw' ? 'rawBox' : 'obfBox');
          if (ta) {
            var lines = (ta.value || '').split(/\n+/).map(function(s) { return s.trim(); }).filter(Boolean);
            var idx = Math.min(Math.max(0, ctx.line | 0), Math.max(0, lines.length - 1));
            var str = lines[idx] || '';
            
            // Decode if obfuscated
            var rawCode = str;
            if (isObfMode && window.GeoCodec) {
              var flat = window.GeoCodec.flattenGrid(grid2D);
              rawCode = window.GeoCodec.obfuscateUpToValid('decode', str, flat) || str;
            }
            
            // Parse GPS coordinates
            var gpsLat, gpsLon;
            var ci = document.getElementById('coordInput');
            if (ci && ci.value) {
              var coordParts = ci.value.split(/[,\s]+/).map(function(s) { return parseFloat(s.trim()); });
              if (coordParts.length >= 2 && !isNaN(coordParts[0]) && !isNaN(coordParts[1])) {
                gpsLat = coordParts[0];
                gpsLon = coordParts[1];
              }
            }
            
            // Re-render grid if code changed
            if (rawCode !== lastCenterCode) {
              renderGrid(rawCode, gpsLat, gpsLon);
            } else {
              // Just update location dot
              updateLocationDot(gpsLat, gpsLon);
            }
            
            if (showCoords && ci) {
              footer.textContent = ci.value || '';
            }
          }
        }
      } catch(err) {}
    }
    window.addEventListener('geosonify:updateCode', onUpdate);
    
    // Handle resize
    function handleResize() {
      requestAnimationFrame(function() {
        var ci = document.getElementById('coordInput');
        var gpsLat, gpsLon;
        if (ci && ci.value) {
          var coordParts = ci.value.split(/[,\s]+/).map(function(s) { return parseFloat(s.trim()); });
          if (coordParts.length >= 2 && !isNaN(coordParts[0]) && !isNaN(coordParts[1])) {
            gpsLat = coordParts[0];
            gpsLon = coordParts[1];
          }
        }
        updateLocationDot(gpsLat, gpsLon);
      });
    }
    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('orientationchange', handleResize, { passive: true });
    
    var obs = new MutationObserver(function() {
      if (!document.body.contains(wrap)) {
        window.removeEventListener('geosonify:updateCode', onUpdate);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('orientationchange', handleResize);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    
    // Exit handling with long-press to copy cell
    var pressTimer = null, copied = false, pressX = 0, pressY = 0;
    
    function getCellIndexFromPoint(x, y) {
      var rect = gridEl.getBoundingClientRect();
      var cellW = rect.width / 3;
      var cellH = rect.height / 3;
      var col = Math.floor((x - rect.left) / cellW);
      var row = Math.floor((y - rect.top) / cellH);
      if (col < 0 || col > 2 || row < 0 || row > 2) return -1;
      return row * 3 + col;
    }
    
    function startPress(e) {
      e.preventDefault();
      copied = false;
      var touch = e.touches ? e.touches[0] : e;
      pressX = touch.clientX;
      pressY = touch.clientY;
      
      pressTimer = setTimeout(function() {
        try {
          window.getSelection().removeAllRanges();
          var cellIdx = getCellIndexFromPoint(pressX, pressY);
          if (cellIdx >= 0 && displayCodes[cellIdx] && displayCodes[cellIdx].displayCode) {
            var code = displayCodes[cellIdx].displayCode;
            navigator.clipboard.writeText(code);
            toast('Code copied: ' + code);
            copied = true;
          }
        } catch(e) {}
      }, 600);
    }
    function cancelPress() { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }
    function exit() { if (!copied) cleanupAllOverlays(); }
    
    wrap.addEventListener('mousedown', startPress);
    wrap.addEventListener('touchstart', startPress, { passive: false });
    wrap.addEventListener('mouseup', function(e) { e.preventDefault(); cancelPress(); exit(); });
    wrap.addEventListener('touchend', function(e) { e.preventDefault(); cancelPress(); exit(); }, { passive: false });
  }
  
  // Open RGB111 image from textarea
  function openRGB111ImageFromTextarea(which) {
    var ta = (which === 'raw') ? document.getElementById('rawBox') : document.getElementById('obfBox');
    var coordsTA = document.getElementById('coordInput');
    var info = getActiveLineInfo(ta);
    var coordsInfo = getActiveLineInfo(coordsTA);
    var footer = (coordsInfo.all && info.line < coordsInfo.all.length) ? (coordsInfo.all[info.line] || '') : (coordsInfo.text || '');
    
    window._geo_fs_last = { mode: which, line: info.line, textarea: ta };
    showRGB111Image(info.text, { footerText: footer });
  }
  
  // Open RGB111 3x3 grid from textarea
  function openRGB111GridFromTextarea(which) {
    var ta = (which === 'raw') ? document.getElementById('rawBox') : document.getElementById('obfBox');
    var coordsTA = document.getElementById('coordInput');
    var info = getActiveLineInfo(ta);
    var coordsInfo = getActiveLineInfo(coordsTA);
    var footer = (coordsInfo.all && info.line < coordsInfo.all.length) ? (coordsInfo.all[info.line] || '') : (coordsInfo.text || '');
    
    window._geo_fs_last = { mode: which, line: info.line, textarea: ta };
    
    var codeForGrid = info.text;
    var isObfMode = which === 'obf';
    
    // For obfuscated mode, decode first to get raw code for grid calculation
    if (isObfMode && window.GeoCodec) {
      var grid2D = _fs_getActiveGrid2D();
      if (grid2D) {
        var flat = window.GeoCodec.flattenGrid(grid2D);
        codeForGrid = window.GeoCodec.obfuscateUpToValid('decode', info.text, flat) || info.text;
      }
    }
    
    showRGB111Grid(codeForGrid, { footerText: footer, isObfMode: isObfMode });
  }

  // ========== HORIZONTAL FULLSCREEN ==========
  function showFullscreen(content, opts){
    cleanupAllOverlays();
    
    try{
      var vertEnabled = readFSSetting(FS_STORE.vertPortraitKey, true);
      var isPortrait = window.matchMedia && window.matchMedia('(orientation: portrait)').matches;
      if (vertEnabled && isPortrait && window.GeoFullscreen && window.GeoFullscreen.showVertical && typeof content === 'string') {
        var tokens = [];
        try {
          var grid2D = _fs_getActiveGrid2D();
          if (grid2D && window.GeoCodec && window.GeoCodec.flattenGrid && window.GeoCodec.tokenizeCode) {
            var flat = window.GeoCodec.flattenGrid(grid2D);
            tokens = window.GeoCodec.tokenizeCode(content, flat) || [];
          }
        } catch(e){}
        return window.GeoFullscreen.showVertical(tokens, content, opts);
      }
    } catch(e){}
    
    ensureFSStyles();
    var bg = (opts && opts.bg) || readFSSetting(FS_STORE.bgKey, '#000000') || '#000000';
    var fg = pickTextColor(bg);
    var showCoords = !!readFSSetting(FS_STORE.showCoordsKey, true);
    var footerText = (opts && opts.footerText) || '';

    var wrap = document.createElement('div');
    wrap.className = 'fs-overlay';
    wrap.style.setProperty('--fs-bg', bg);
    wrap.style.setProperty('--fs-fg', fg);

    var center = document.createElement('div'); 
    center.className = 'fs-center';
    var footer = document.createElement('div'); 
    footer.className = 'fs-footer';
    var codeBox = document.createElement('div'); 
    codeBox.className = 'fs-code';

    if (content && content.nodeType === 1) {
      codeBox.appendChild(content);
    } else {
      codeBox.textContent = String(content||'');
    }

    center.appendChild(codeBox);
    wrap.appendChild(center);
    wrap.appendChild(footer);
    document.body.appendChild(wrap);
    
    try{ fsLockScroll(); }catch(e){}

    footer.textContent = showCoords ? footerText : '';
    
    var handleOrientation = function() {
      var vertEnabled = readFSSetting(FS_STORE.vertPortraitKey, true);
      var isPortrait = window.matchMedia && window.matchMedia('(orientation: portrait)').matches;
      
      if (vertEnabled && isPortrait && window.GeoFullscreen && window.GeoFullscreen.showVertical) {
        try {
          cleanupAllOverlays();
          var tokens = [];
          var grid2D = _fs_getActiveGrid2D();
          if (grid2D && window.GeoCodec && window.GeoCodec.flattenGrid && window.GeoCodec.tokenizeCode) {
            var flat = window.GeoCodec.flattenGrid(grid2D);
            tokens = window.GeoCodec.tokenizeCode(content, flat) || [];
          }
          window.GeoFullscreen.showVertical(tokens, content, opts);
        } catch(e){}
      }
    };
    
    window.addEventListener('orientationchange', handleOrientation, { passive: true });
    wrap._fsCleanupOrientation = function() {
      window.removeEventListener('orientationchange', handleOrientation);
    };
    
    function onUpdate(e){
      try {
        var ctx = window._geo_fs_last || null;
        if (ctx && (ctx.mode==='raw' || ctx.mode==='obf')) {
          var ta = document.getElementById(ctx.mode==='raw' ? 'rawBox' : 'obfBox');
          if (ta) {
            var lines = (ta.value||'').split(/\n+/).map(function(s){return s.trim();}).filter(Boolean);
            var idx = Math.min(Math.max(0, ctx.line|0), Math.max(0, lines.length-1));
            var str = lines[idx] || '';
            codeBox.textContent = String(str||'');
            if (showCoords) { try { var ci = document.getElementById('coordInput'); if (ci) footer.textContent = ci.value || ''; } catch(e){} }
            if (!codeBox.firstElementChild) {
              fitTextToWidth(codeBox, window.innerWidth - Math.round(window.innerWidth*0.08));
            }
            return;
          }
        }
      } catch(err){}
      try {
        if (e && e.detail) {
          var ctx2 = window._geo_fs_last || null;
          var isObfMode = ctx2 && ctx2.mode === 'obf';
          var str2 = isObfMode 
            ? (e.detail.obfCopyText || (e.detail.obfTokens||[]).join(''))
            : (e.detail.copyText || (e.detail.tokens||[]).join(''));
          codeBox.textContent = String(str2||'');
          if (showCoords) { try { var ci = document.getElementById('coordInput'); if (ci) footer.textContent = ci.value || ''; } catch(e){} }
          if (!codeBox.firstElementChild) {
            fitTextToWidth(codeBox, window.innerWidth - Math.round(window.innerWidth*0.08));
          }
        }
      } catch(err){}
    }
    window.addEventListener('geosonify:updateCode', onUpdate);

    var obs = new MutationObserver(function(){
      if (!document.body.contains(wrap)) {
        window.removeEventListener('geosonify:updateCode', onUpdate);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    if (!codeBox.firstElementChild) {
      fitTextToWidth(codeBox, window.innerWidth - Math.round(window.innerWidth*0.08));
    }

    var pressTimer = null, copied = false;
    function startPress(){
      copied = false;
      pressTimer = setTimeout(function(){
        try { navigator.clipboard.writeText(codeBox.textContent || ''); toast('Copied'); } catch(e){}
        copied = true;
      }, 600);
    }
    function cancelPress(){ if (pressTimer){ clearTimeout(pressTimer); pressTimer=null; } }
    function exit(){ if (!copied) cleanupAllOverlays(); }

    wrap.addEventListener('mousedown', startPress);
    wrap.addEventListener('touchstart', startPress, { passive: true });
    wrap.addEventListener('mouseup', function(){ cancelPress(); exit(); });
    wrap.addEventListener('touchend', function(){ cancelPress(); exit(); }, { passive: true });
  }

  // ========== VERTICAL FULLSCREEN ==========
  function showVertical(tokens, copyText, opts){
    cleanupAllOverlays();
    ensureFSStyles();
    
    var bg = (opts && opts.bg) || readFSSetting(FS_STORE.bgKey, '#000000') || '#000000';
    var fg = pickTextColor(bg);
    var showCoords = !!readFSSetting(FS_STORE.showCoordsKey, true);
    var footerText = (opts && opts.footerText) || '';

    var wrap = document.createElement('div');
    wrap.className = 'fs-overlay';
    wrap.style.setProperty('--fs-bg', bg);
    wrap.style.setProperty('--fs-fg', fg);

    var center = document.createElement('div'); 
    center.className = 'fs-center';
    var footer = document.createElement('div'); 
    footer.className = 'fs-footer';

    function buildVerticalBox(toks, copyStr){
      var box = document.createElement('div');
      box.className = 'fs-vertical';
      box.setAttribute('aria-label', copyStr || toks.join(''));
      
      if (!toks || !toks.length){
        var single = document.createElement('div');
        single.className = 'fs-vline';
        single.textContent = copyStr || '';
        box.appendChild(single);
        return box;
      }
      
      toks.forEach(function(tok) {
        var line = document.createElement('div');
        line.className = 'fs-vline';
        line.textContent = tok;
        box.appendChild(line);
      });
      return box;
    }

    var box = buildVerticalBox(tokens, copyText);
    center.appendChild(box);
    wrap.appendChild(center);
    wrap.appendChild(footer);
    document.body.appendChild(wrap);
    
    try{ fsLockScroll(); }catch(e){}

    footer.textContent = showCoords ? footerText : '';
    footer.style.display = showCoords ? '' : 'none';
    
    function refit(){
      var lines = box.querySelectorAll('.fs-vline');
      if (!lines.length) return;
      var availH = wrap.clientHeight - footer.offsetHeight - 40;
      var perLine = availH / lines.length;
      var fontSize = Math.max(12, Math.floor(perLine * 0.85));
      lines.forEach(function(ln) { ln.style.fontSize = fontSize + 'px'; });
    }
    refit();
    window.addEventListener('resize', refit);
    wrap._fsCleanupVertical = function() { window.removeEventListener('resize', refit); };

    var handleOrientation = function() {
      var vertEnabled = readFSSetting(FS_STORE.vertPortraitKey, true);
      var isLandscape = window.matchMedia && window.matchMedia('(orientation: landscape)').matches;
      
      if (vertEnabled && isLandscape) {
        try {
          cleanupAllOverlays();
          var content = copyText || tokens.join('');
          showFullscreen(content, opts);
        } catch(e){}
      }
    };
    
    window.addEventListener('orientationchange', handleOrientation, { passive: true });
    wrap._fsCleanupOrientation = function() {
      window.removeEventListener('orientationchange', handleOrientation);
    };

    function onUpdate(e){
      try {
        var ctx = window._geo_fs_last || null;
        if (ctx && (ctx.mode==='raw' || ctx.mode==='obf')) {
          var ta = document.getElementById(ctx.mode==='raw' ? 'rawBox' : 'obfBox');
          var grid2D = _fs_getActiveGrid2D();
          if (ta && grid2D && window.GeoCodec && window.GeoCodec.flattenGrid && window.GeoCodec.tokenizeCode) {
            var lines = (ta.value||'').split(/\n+/).map(function(s){return s.trim();}).filter(Boolean);
            var idx = Math.min(Math.max(0, ctx.line|0), Math.max(0, lines.length-1));
            var str = lines[idx] || '';
            var flat = window.GeoCodec.flattenGrid(grid2D);
            var toks = window.GeoCodec.tokenizeCode(str, flat) || [];
            var newBox = buildVerticalBox(toks, str);
            center.replaceChild(newBox, box);
            box = newBox;
            if (showCoords) { try { var ci = document.getElementById('coordInput'); if (ci) footer.textContent = ci.value || ''; } catch(e){} }
            refit();
            return;
          }
        }
      } catch(err){}
      if (!e || !e.detail) return;
      try {
        var ctx2 = window._geo_fs_last || null;
        var isObfMode = ctx2 && ctx2.mode === 'obf';
        var tokens2 = isObfMode ? (e.detail.obfTokens || []) : (e.detail.tokens || []);
        var copyText2 = isObfMode ? (e.detail.obfCopyText || tokens2.join('')) : (e.detail.copyText || tokens2.join(''));
        if (tokens2.length || copyText2) {
          var newBox = buildVerticalBox(tokens2, copyText2);
          center.replaceChild(newBox, box);
          box = newBox;
          if (showCoords) { try { var ci = document.getElementById('coordInput'); if (ci) footer.textContent = ci.value || ''; } catch(e){} }
          refit();
        }
      } catch(err){}
    }
    window.addEventListener('geosonify:updateCode', onUpdate);

    var obs = new MutationObserver(function(){
      if (!document.body.contains(wrap)) {
        window.removeEventListener('geosonify:updateCode', onUpdate);
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    var pressTimer = null, copied = false;
    function startPress(){
      copied = false;
      pressTimer = setTimeout(function(){
        try { navigator.clipboard.writeText(box.getAttribute('aria-label') || ''); toast('Copied'); } catch(e){}
        copied = true;
      }, 600);
    }
    function cancelPress(){ if (pressTimer){ clearTimeout(pressTimer); pressTimer=null; } }
    function exit(){ if (!copied) cleanupAllOverlays(); }

    wrap.addEventListener('mousedown', startPress);
    wrap.addEventListener('touchstart', startPress, { passive: true });
    wrap.addEventListener('mouseup', function(){ cancelPress(); exit(); });
    wrap.addEventListener('touchend', function(){ cancelPress(); exit(); }, { passive: true });
  }

  // ========== UI INJECTION ==========
  function openFullscreenFromTextarea(which){
    var ta = (which==='raw') ? document.getElementById('rawBox') : document.getElementById('obfBox');
    var coordsTA = document.getElementById('coordInput');
    var info = getActiveLineInfo(ta);
    var coordsInfo = getActiveLineInfo(coordsTA);
    var footer = (coordsInfo.all && info.line < coordsInfo.all.length) ? (coordsInfo.all[info.line]||'') : (coordsInfo.text||'');
    
    window._geo_fs_last = { mode: which, line: info.line, textarea: ta };
    showFullscreen(info.text, { footerText: footer });
  }
  
  function open3x3FromTextarea(which){
    var ta = (which==='raw') ? document.getElementById('rawBox') : document.getElementById('obfBox');
    var coordsTA = document.getElementById('coordInput');
    var info = getActiveLineInfo(ta);
    var coordsInfo = getActiveLineInfo(coordsTA);
    var footer = (coordsInfo.all && info.line < coordsInfo.all.length) ? (coordsInfo.all[info.line]||'') : (coordsInfo.text||'');
    
    window._geo_fs_last = { mode: which, line: info.line, textarea: ta };
    
    var codeForGrid = info.text;
    var isObfMode = which === 'obf';
    
    if (isObfMode && window.GeoCodec) {
      var grid2D = _fs_getActiveGrid2D();
      if (grid2D) {
        var flat = window.GeoCodec.flattenGrid(grid2D);
        codeForGrid = window.GeoCodec.obfuscateUpToValid('decode', info.text, flat) || info.text;
      }
    }
    
    show3x3Grid(codeForGrid, { footerText: footer, isObfMode: isObfMode });
  }

  function openSettingsDialog(){
    ensureFSStyles();
    var bgInit = readFSSetting(FS_STORE.bgKey, '#000000');
    var showInit = !!readFSSetting(FS_STORE.showCoordsKey, true);

    var back = document.createElement('div'); back.className = 'fs-dialog-backdrop';
    var dlg  = document.createElement('div'); dlg.className = 'fs-dialog';
    back.appendChild(dlg);

    dlg.innerHTML = '<h3>Full screen settings</h3>' +
      '<label>Background colour (hex or name)</label>' +
      '<div class="fs-row">' +
      '  <input id="fsColorText" type="text" placeholder="#000000 or #FFFFFF or black"/>' +
      '  <input id="fsColorPicker" type="color" />' +
      '</div>' +
      '<label><input id="fsShowCoords" type="checkbox"> Show coordinates on full screen</label>' +
      '<label><input id="fsVertPortrait" type="checkbox"> Vertical code in portrait</label>' +
      '<div class="fs-actions">' +
      '  <button id="fsCancelBtn">Cancel</button>' +
      '  <button id="fsSaveBtn">Save</button>' +
      '</div>';

    document.body.appendChild(back);

    var t = dlg.querySelector('#fsColorText');
    var p = dlg.querySelector('#fsColorPicker');
    var c = dlg.querySelector('#fsShowCoords');
    var v = dlg.querySelector('#fsVertPortrait');
    t.value = bgInit || '#000000';
    try { if (/^#([0-9a-f]{6})$/i.test(bgInit)) p.value = bgInit; } catch(e){}
    c.checked = !!showInit;
    if (v) v.checked = !!readFSSetting(FS_STORE.vertPortraitKey, true);

    p.addEventListener('input', function(){ t.value = p.value; });

    dlg.querySelector('#fsCancelBtn').addEventListener('click', function(){ back.remove(); });
    dlg.querySelector('#fsSaveBtn').addEventListener('click', function(){
      var color = (t.value||'').trim() || '#000000';
      writeFSSetting(FS_STORE.bgKey, color);
      writeFSSetting(FS_STORE.showCoordsKey, c.checked);
      try { if (v) writeFSSetting(FS_STORE.vertPortraitKey, v.checked); } catch(e){}
      try {
        var ov = document.querySelector('.fs-overlay');
        if (ov) {
          ov.style.setProperty('--fs-bg', color);
          var footerEl = ov.querySelector('.fs-footer');
          if (footerEl) footerEl.style.display = c.checked ? '' : 'none';
        }
      } catch(e){}
      back.remove();
      toast('Saved');
    });

    back.addEventListener('click', function(e){ if (e.target === back) back.remove(); });
  }

  function findAndAddButtons(){
    var rawBox = $('#rawBox');
    var obfBox = $('#obfBox');

    function addButton(afterEl, id, text, handler){
      if (!afterEl) return;
      var parent = afterEl.parentElement;
      if (!parent) return;
      if (parent.querySelector('#'+id)) return;
      
      var btns = $all('button', parent);
      var refBtn = btns.find(function(b){ return /copy/i.test(b.textContent||''); }) || btns[0];
      
      var btn = document.createElement('button');
      btn.id = id;
      btn.textContent = text;
      btn.className = (refBtn && refBtn.className) ? refBtn.className : '';
      btn.style.marginLeft = '8px';
      
      // Safely insert - check that refBtn is actually a child of parent
      if (refBtn && refBtn.parentNode === parent && refBtn.nextSibling) {
        parent.insertBefore(btn, refBtn.nextSibling);
      } else {
        parent.appendChild(btn);
      }
      btn.addEventListener('click', handler);
    }
    
    function add3x3Button(fullBtnId, newBtnId, mode) {
      var fullBtn = $('#' + fullBtnId);
      if (!fullBtn) return;
      if ($('#' + newBtnId)) return;
      var parent = fullBtn.parentNode;
      if (!parent) return;
      
      var btn = document.createElement('button');
      btn.id = newBtnId;
      btn.textContent = '3\u00d73';
      btn.title = 'Show 3x3 grid of adjacent codes';
      btn.className = fullBtn.className || '';
      btn.style.marginLeft = '8px';
      
      // Safely insert
      if (fullBtn.parentNode === parent) {
        if (fullBtn.nextSibling) {
          parent.insertBefore(btn, fullBtn.nextSibling);
        } else {
          parent.appendChild(btn);
        }
      } else {
        parent.appendChild(btn);
      }
      btn.addEventListener('click', function(){ open3x3FromTextarea(mode); });
    }
    
    // Add Image buttons for HexByte mode
    function addImageButton(afterBtnId, newBtnId, mode) {
      var afterBtn = $('#' + afterBtnId);
      if (!afterBtn) return;
      
      var existingBtn = $('#' + newBtnId);
      var inHexByteMode = isHexByteGridMode();
      
      // If not in HexByte mode, remove existing button if present
      if (!inHexByteMode) {
        if (existingBtn) existingBtn.remove();
        return;
      }
      
      // Check if RGB111Lib is available
      if (!window.RGB111Lib) {
        if (existingBtn) existingBtn.remove();
        return;
      }
      
      // Already exists
      if (existingBtn) return;
      
      var parent = afterBtn.parentNode;
      if (!parent) return;
      
      var btn = document.createElement('button');
      btn.id = newBtnId;
      btn.textContent = 'Image';
      btn.title = 'Show RGB111 encoded image';
      btn.className = afterBtn.className || '';
      btn.style.marginLeft = '8px';
      
      // Insert after the reference button
      if (afterBtn.nextSibling) {
        parent.insertBefore(btn, afterBtn.nextSibling);
      } else {
        parent.appendChild(btn);
      }
      btn.addEventListener('click', function() { openRGB111ImageFromTextarea(mode); });
    }
    
    // Add Image 3x3 buttons for HexByte mode
    function addImage3x3Button(afterBtnId, newBtnId, mode) {
      var afterBtn = $('#' + afterBtnId);
      if (!afterBtn) return;
      
      var existingBtn = $('#' + newBtnId);
      var inHexByteMode = isHexByteGridMode();
      
      // If not in HexByte mode, remove existing button if present
      if (!inHexByteMode) {
        if (existingBtn) existingBtn.remove();
        return;
      }
      
      // Check if RGB111Lib is available
      if (!window.RGB111Lib) {
        if (existingBtn) existingBtn.remove();
        return;
      }
      
      // Already exists
      if (existingBtn) return;
      
      var parent = afterBtn.parentNode;
      if (!parent) return;
      
      var btn = document.createElement('button');
      btn.id = newBtnId;
      btn.textContent = 'Img 3\u00d73';
      btn.title = 'Show 3x3 grid of RGB111 images';
      btn.className = afterBtn.className || '';
      btn.style.marginLeft = '8px';
      
      // Insert after the reference button
      if (afterBtn.nextSibling) {
        parent.insertBefore(btn, afterBtn.nextSibling);
      } else {
        parent.appendChild(btn);
      }
      btn.addEventListener('click', function() { openRGB111GridFromTextarea(mode); });
    }
    
    // Add Music Notes button for Music mode
    function addMusicNotesButton(afterBtnId, newBtnId, mode) {
      var afterBtn = $('#' + afterBtnId);
      if (!afterBtn) return;
      
      var existingBtn = $('#' + newBtnId);
      var inMusicMode = isMusicGridMode();
      
      // If not in Music mode, remove existing button if present
      if (!inMusicMode) {
        if (existingBtn) existingBtn.remove();
        return;
      }
      
      // Check if VexFlowLib is available
      if (!window.VexFlowLib || !window.VexFlowLib.hasVexFlow()) {
        if (existingBtn) existingBtn.remove();
        return;
      }
      
      // Already exists
      if (existingBtn) return;
      
      var parent = afterBtn.parentNode;
      if (!parent) return;
      
      var btn = document.createElement('button');
      btn.id = newBtnId;
      btn.textContent = 'Notes';
      btn.title = 'Show musical notation';
      btn.className = afterBtn.className || '';
      btn.style.marginLeft = '8px';
      
      // Insert after the reference button
      if (afterBtn.nextSibling) {
        parent.insertBefore(btn, afterBtn.nextSibling);
      } else {
        parent.appendChild(btn);
      }
      btn.addEventListener('click', function() { openMusicNotationFromTextarea(mode); });
    }

    if (rawBox) {
      addButton(rawBox, 'fullRawBtn', 'Full screen', function(){ openFullscreenFromTextarea('raw'); });
      add3x3Button('fullRawBtn', 'grid3x3RawBtn', 'raw');
      addImageButton('grid3x3RawBtn', 'imageRawBtn', 'raw');
      addImage3x3Button('imageRawBtn', 'image3x3RawBtn', 'raw');
      addMusicNotesButton('grid3x3RawBtn', 'notesRawBtn', 'raw');
    }
    
    if (obfBox) {
      addButton(obfBox, 'fullObfBtn', 'Full screen', function(){ openFullscreenFromTextarea('obf'); });
      add3x3Button('fullObfBtn', 'grid3x3ObfBtn', 'obf');
      addImageButton('grid3x3ObfBtn', 'imageObfBtn', 'obf');
      addImage3x3Button('imageObfBtn', 'image3x3ObfBtn', 'obf');
      addMusicNotesButton('grid3x3ObfBtn', 'notesObfBtn', 'obf');
    }

    var toolbar = $('#codecToolbar') || $('.toolbar');
    if (toolbar && !$('#codecSettingsBtn')){
      var btn = document.createElement('button');
      btn.id = 'codecSettingsBtn';
      btn.className = 'fs-mini-btn';
      btn.textContent = 'Settings';
      toolbar.appendChild(btn);
      btn.addEventListener('click', openSettingsDialog);
    }
  }

  function init(){
    ensureFSStyles();
    findAndAddButtons();
    var obs = new MutationObserver(function(){ findAndAddButtons(); });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }
  
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  try {
    window.GeoFullscreen = window.GeoFullscreen || {};
    window.GeoFullscreen.show = showFullscreen;
    window.GeoFullscreen.showVertical = showVertical;
    window.GeoFullscreen.show3x3 = show3x3Grid;
    window.GeoFullscreen.showRGB111Image = showRGB111Image;
    window.GeoFullscreen.showRGB111Grid = showRGB111Grid;
    window.GeoFullscreen.showMusicNotation = showMusicNotation;
    window.GeoFullscreen.cleanupAll = cleanupAllOverlays;
    window.GeoFullscreen.isHexByteGridMode = isHexByteGridMode;
    window.GeoFullscreen.isMusicGridMode = isMusicGridMode;
  } catch(e){}
})();
