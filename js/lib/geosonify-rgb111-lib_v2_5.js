/*
  geosonify-rgb111-lib.v2.1.js
  RGB111 Image Encoder Library
  
  Generates RGB111 encoded images from hex strings.
  Based on RGB111 Encoder v15 (4-notch CRC-8)
  
  Features:
  - 4x4 grid encoding (16 cells x 3 bits = 48 bits = 12 hex chars)
  - Black/white border (configurable width)
  - CRC-8 checksum encoded as 4 triangular notches (one per edge)
  - Black (000) and White (111) cells split diagonally, BOTH halves inherit
  - Robust rotation detection via 4-notch validation
*/
(function(global){
  'use strict';
  var __RGB111_LIB_VER__ = 'v2.5';
  try { console.log('[geosonify] rgb111-lib ' + __RGB111_LIB_VER__ + ' loaded'); } catch(e){}

  var COLORS = [
    [0, 0, 0], [0, 0, 255], [0, 255, 0], [0, 255, 255],
    [255, 0, 0], [255, 0, 255], [255, 255, 0], [255, 255, 255]
  ];

  function hexToBits(hex) {
    var bits = '';
    hex = (hex || '').toUpperCase().replace(/[^0-9A-F]/g, '');
    for (var i = 0; i < hex.length; i++) {
      bits += parseInt(hex[i], 16).toString(2).padStart(4, '0');
    }
    return bits;
  }

  function crc8(bits) {
    var crc = 0;
    for (var i = 0; i < bits.length; i++) {
      var bit = bits[i] === '1' ? 1 : 0;
      var msb = (crc >> 7) & 1;
      crc = ((crc << 1) | bit) & 0xFF;
      if (msb) crc ^= 0x07;
    }
    for (var j = 0; j < 8; j++) {
      var msb2 = (crc >> 7) & 1;
      crc = (crc << 1) & 0xFF;
      if (msb2) crc ^= 0x07;
    }
    return crc;
  }

  function crcToNotches(crc) {
    return { top: (crc >> 6) & 0x03, right: (crc >> 4) & 0x03, bottom: (crc >> 2) & 0x03, left: crc & 0x03 };
  }

  function notchesToCrc(n) {
    return ((n.top & 0x03) << 6) | ((n.right & 0x03) << 4) | ((n.bottom & 0x03) << 2) | (n.left & 0x03);
  }

  function getColorIndex(bits, row, col) {
    var bitIndex = (row * 4 + col) * 3;
    if (bitIndex + 3 > bits.length) return 0;
    return parseInt(bits.substr(bitIndex, 3), 2);
  }

  function generateCanvas(hexString, options) {
    var opts = options || {};
    if (typeof options === 'number') opts = { size: options };
    var size = opts.size || 1200;
    var borderWidth = opts.borderWidth !== undefined ? opts.borderWidth : 0.5;
    var notchSize = opts.notchSize !== undefined ? opts.notchSize : 0.5; // Default 50%
    var bgBlack = opts.background !== 'white';
    var showChecksum = opts.showChecksum !== false;
    var compact = !!opts.compact;
    // Codec variant marker. 'healpix' draws a solid black diamond at the grid
    // centre — the only black in the data area (K/W cells render as diagonal
    // colour splits, never literal black), so it reads unambiguously as "not
    // data" and identifies the swatch as a HEALPix ChromaCoord (order-22 hphex)
    // rather than a standard one. Costs zero payload/notch bits; the diamond sits
    // at the four-cell junction, clear of every cell-centre sampling point.
    var variant = opts.variant || 'standard';
    if (compact) { borderWidth = 0.25; showChecksum = false; }

    var hex = (hexString || '000000000000').toUpperCase().replace(/[^0-9A-F]/g, '').padEnd(12, '0').slice(0, 12);
    var bits = hexToBits(hex);
    var notches = crcToNotches(crc8(bits));
    // Round gridSize to nearest multiple of 4 for clean integer cell boundaries
    var gridSize = Math.round(size * 0.8);
    gridSize = gridSize - (gridSize % 4);
    var cellSize = gridSize / 4;
    var borderSize = Math.round(cellSize * borderWidth);
    var gridLeft = Math.round((size - gridSize) / 2), gridTop = Math.round((size - gridSize) / 2);
    // Sub-pixel overlap to eliminate hairline gaps on mobile renderers
    var overlap = 0.5;

    var canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = bgBlack ? '#000' : '#fff';
    ctx.fillRect(0, 0, size, size);

    var colorGrid = [], triangleColors = {}, colorUsage = [0,0,0,0,0,0,0,0];
    for (var r = 0; r < 4; r++) { colorGrid[r] = []; for (var c = 0; c < 4; c++) { colorGrid[r][c] = getColorIndex(bits, r, c); } }
    for (var r2 = 0; r2 < 4; r2++) for (var c2 = 0; c2 < 4; c2++) { var idx2 = colorGrid[r2][c2]; if (idx2 !== 0 && idx2 !== 7) colorUsage[idx2] += 2; }

    function getLeastUsed(ex1, ex2) {
      var best = -1, cnt = 1e9;
      for (var i = 1; i < 7; i++) { if (i === ex1 || i === ex2) continue; if (colorUsage[i] > 0 && colorUsage[i] < cnt) { cnt = colorUsage[i]; best = i; } }
      if (best === -1) for (var j = 1; j < 7; j++) if (j !== ex1 && j !== ex2) return j;
      return best === -1 ? 5 : best;
    }

    function getEdgeColor(row, col, edge) {
      if (row < 0 || row >= 4 || col < 0 || col >= 4) return 3;
      var idx = colorGrid[row][col];
      if (idx !== 0 && idx !== 7) return idx;
      var tc = triangleColors[row + ',' + col];
      if (tc) {
        if (idx === 7) return (edge === 'left' || edge === 'top') ? tc.tl : tc.br;
        else return (edge === 'right' || edge === 'top') ? tc.tr : tc.bl;
      }
      return 3;
    }

    for (var r3 = 0; r3 < 4; r3++) {
      for (var c3 = 0; c3 < 4; c3++) {
        var idx3 = colorGrid[r3][c3];
        if (idx3 === 7 || idx3 === 0) {
          var left = getEdgeColor(r3, c3-1, 'right'), above = getEdgeColor(r3-1, c3, 'bottom');
          var below = getEdgeColor(r3+1, c3, 'top'), right = getEdgeColor(r3, c3+1, 'left');
          var color1, color2;
          if (idx3 === 7) {
            var tlOpts = [left, above].filter(function(v){ return v > 0 && v < 7; });
            var brOpts = [below, right].filter(function(v){ return v > 0 && v < 7; });
            if (tlOpts.length > 0 && brOpts.length > 0) { color1 = tlOpts[0]; color2 = brOpts.filter(function(v){ return v !== color1; })[0] || getLeastUsed(color1); }
            else if (tlOpts.length > 0) { color1 = tlOpts[0]; color2 = getLeastUsed(color1); }
            else if (brOpts.length > 0) { color2 = brOpts[0]; color1 = getLeastUsed(color2); }
            else { color1 = 5; color2 = 3; }
            triangleColors[r3+','+c3] = {tl: color1, br: color2};
          } else {
            var trOpts = [right, above].filter(function(v){ return v > 0 && v < 7; });
            var blOpts = [left, below].filter(function(v){ return v > 0 && v < 7; });
            if (trOpts.length > 0 && blOpts.length > 0) { color1 = trOpts[0]; color2 = blOpts.filter(function(v){ return v !== color1; })[0] || getLeastUsed(color1); }
            else if (trOpts.length > 0) { color1 = trOpts[0]; color2 = getLeastUsed(color1); }
            else if (blOpts.length > 0) { color2 = blOpts[0]; color1 = getLeastUsed(color2); }
            else { color1 = 5; color2 = 3; }
            triangleColors[r3+','+c3] = {tr: color1, bl: color2};
          }
          colorUsage[color1]++; colorUsage[color2]++;
        }
      }
    }

    for (var row = 0; row < 4; row++) {
      for (var col = 0; col < 4; col++) {
        var colorIndex = colorGrid[row][col];
        var x = gridLeft + col * cellSize - overlap, y = gridTop + row * cellSize - overlap;
        var drawSize = cellSize + overlap * 2;
        if (colorIndex === 7) {
          var tc = triangleColors[row+','+col];
          ctx.fillStyle = 'rgb(' + COLORS[tc.tl].join(',') + ')';
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + drawSize, y); ctx.lineTo(x, y + drawSize); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgb(' + COLORS[tc.br].join(',') + ')';
          ctx.beginPath(); ctx.moveTo(x + drawSize, y); ctx.lineTo(x + drawSize, y + drawSize); ctx.lineTo(x, y + drawSize); ctx.closePath(); ctx.fill();
        } else if (colorIndex === 0) {
          var tc2 = triangleColors[row+','+col];
          ctx.fillStyle = 'rgb(' + COLORS[tc2.tr].join(',') + ')';
          ctx.beginPath(); ctx.moveTo(x + drawSize, y); ctx.lineTo(x, y); ctx.lineTo(x + drawSize, y + drawSize); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgb(' + COLORS[tc2.bl].join(',') + ')';
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + drawSize); ctx.lineTo(x + drawSize, y + drawSize); ctx.closePath(); ctx.fill();
        } else {
          ctx.fillStyle = 'rgb(' + COLORS[colorIndex].join(',') + ')';
          ctx.fillRect(x, y, drawSize, drawSize);
        }
      }
    }

    ctx.fillStyle = bgBlack ? '#000' : '#fff';
    ctx.fillRect(gridLeft - borderSize, gridTop - borderSize, gridSize + 2 * borderSize, borderSize);
    ctx.fillRect(gridLeft - borderSize, gridTop + gridSize, gridSize + 2 * borderSize, borderSize);
    ctx.fillRect(gridLeft - borderSize, gridTop, borderSize, gridSize);
    ctx.fillRect(gridLeft + gridSize, gridTop, borderSize, gridSize);

    if (showChecksum) {
      var notchBase = cellSize * notchSize, notchHeight = notchBase / 2;
      function drawNotch(edge, position) {
        var cellRow, cellCol, pts;
        if (edge === 'top') { cellRow = 0; cellCol = position; var cx = gridLeft + cellCol * cellSize + cellSize/2, cy = gridTop; pts = [[cx - notchBase/2, cy], [cx + notchBase/2, cy], [cx, cy + notchHeight]]; }
        else if (edge === 'right') { cellRow = position; cellCol = 3; var cx = gridLeft + gridSize, cy = gridTop + cellRow * cellSize + cellSize/2; pts = [[cx, cy - notchBase/2], [cx, cy + notchBase/2], [cx - notchHeight, cy]]; }
        else if (edge === 'bottom') { cellRow = 3; cellCol = 3 - position; var cx = gridLeft + cellCol * cellSize + cellSize/2, cy = gridTop + gridSize; pts = [[cx - notchBase/2, cy], [cx + notchBase/2, cy], [cx, cy - notchHeight]]; }
        else { cellRow = 3 - position; cellCol = 0; var cx = gridLeft, cy = gridTop + cellRow * cellSize + cellSize/2; pts = [[cx, cy - notchBase/2], [cx, cy + notchBase/2], [cx + notchHeight, cy]]; }
        var cellIdx = colorGrid[cellRow][cellCol], notchColor;
        if (cellIdx === 0 || cellIdx === 7) {
          var tc3 = triangleColors[cellRow + ',' + cellCol];
          if (cellIdx === 7) notchColor = (edge === 'top' || edge === 'left') ? COLORS[tc3.br] : COLORS[tc3.tl];
          else notchColor = (edge === 'top' || edge === 'right') ? COLORS[tc3.bl] : COLORS[tc3.tr];
        } else { var rgb = COLORS[cellIdx]; notchColor = [255 - rgb[0], 255 - rgb[1], 255 - rgb[2]]; }
        ctx.fillStyle = 'rgb(' + notchColor.join(',') + ')';
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.lineTo(pts[2][0], pts[2][1]); ctx.closePath(); ctx.fill();
      }
      drawNotch('top', notches.top); drawNotch('right', notches.right); drawNotch('bottom', notches.bottom); drawNotch('left', notches.left);
    }

    // HEALPix variant marker: solid black diamond at the exact grid centre.
    // Half-diagonal tied to the notch base (cellSize * notchSize, default 0.5
    // cell) so it shares the notches' dimension; full diagonal ≈ one cell. The
    // grid centre is the meeting point of the four inner cells and is rotation-
    // invariant, so the mark survives the notch-based rotation search and is read
    // by a single centre-pixel sample at decode time.
    if (variant === 'healpix') {
      var diamondR = cellSize * notchSize;           // half-diagonal (≈0.5 cell)
      var dcx = gridLeft + 2 * cellSize, dcy = gridTop + 2 * cellSize;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(dcx, dcy - diamondR);
      ctx.lineTo(dcx + diamondR, dcy);
      ctx.lineTo(dcx, dcy + diamondR);
      ctx.lineTo(dcx - diamondR, dcy);
      ctx.closePath();
      ctx.fill();
    }
    return canvas;
  }

  function generateDataURL(hex, opts) { return generateCanvas(hex, opts).toDataURL('image/png'); }
  function generateBlob(hex, opts) { return new Promise(function(res, rej) { try { generateCanvas(hex, opts).toBlob(function(b) { b ? res(b) : rej(new Error('Failed')); }, 'image/png'); } catch(e) { rej(e); } }); }
  function isValidHexCode(h) { return h && typeof h === 'string' && h.toUpperCase().replace(/[^0-9A-F]/g, '').length === 12; }

  function rotateHex90(hexString) {
    var hex = (hexString || '').toUpperCase().replace(/[^0-9A-F]/g, '').padEnd(12, '0').slice(0, 12);
    var bits = hexToBits(hex), grid = [], newGrid = [];
    for (var r = 0; r < 4; r++) { grid[r] = []; for (var c = 0; c < 4; c++) grid[r][c] = bits.substr((r * 4 + c) * 3, 3); }
    for (var r2 = 0; r2 < 4; r2++) { newGrid[r2] = []; for (var c2 = 0; c2 < 4; c2++) newGrid[r2][c2] = grid[3 - c2][r2]; }
    var newBits = '';
    for (var r3 = 0; r3 < 4; r3++) for (var c3 = 0; c3 < 4; c3++) newBits += newGrid[r3][c3];
    var newHex = '';
    for (var i = 0; i < 48; i += 4) newHex += parseInt(newBits.substr(i, 4), 2).toString(16).toUpperCase();
    return newHex;
  }

  function rotateNotches90(n) { return { top: n.left, right: n.top, bottom: n.right, left: n.bottom }; }
  function validateChecksum(hex, detected) {
    var h = (hex || '').toUpperCase().replace(/[^0-9A-F]/g, '').padEnd(12, '0').slice(0, 12);
    var expected = crcToNotches(crc8(hexToBits(h)));
    var matches = 0, comparisons = 0;
    if (detected.top >= 0) { comparisons++; if (detected.top === expected.top) matches++; }
    if (detected.right >= 0) { comparisons++; if (detected.right === expected.right) matches++; }
    if (detected.bottom >= 0) { comparisons++; if (detected.bottom === expected.bottom) matches++; }
    if (detected.left >= 0) { comparisons++; if (detected.left === expected.left) matches++; }
    return { valid: matches === comparisons && comparisons >= 2, matches: matches, comparisons: comparisons };
  }

  function findCorrectRotation(hex, detected) {
    var currentHex = hex, currentNotches = detected;
    for (var rotation = 0; rotation < 360; rotation += 90) {
      var result = validateChecksum(currentHex, currentNotches);
      if (result.valid) return { hex: currentHex, rotation: rotation, valid: true, matches: result.matches };
      currentHex = rotateHex90(currentHex);
      currentNotches = rotateNotches90(currentNotches);
    }
    return { hex: hex, rotation: 0, valid: false };
  }

  // === DECODER FUNCTIONS ===
  function nearestColorIndex(r, g, b) {
    // Map RGB to nearest 3-bit color index (0-7)
    var rBit = r >= 128 ? 1 : 0;
    var gBit = g >= 128 ? 1 : 0;
    var bBit = b >= 128 ? 1 : 0;
    return (rBit << 2) | (gBit << 1) | bBit;
  }

  function detectGridBounds(canvas) {
    // Find the inner colored grid by scanning for non-border pixels
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var data = ctx.getImageData(0, 0, w, h).data;
    
    // Scan from edges to find colored area
    var left = 0, right = w, top = 0, bottom = h;
    
    // Simple approach: assume border is ~10-15% of size
    var borderEst = Math.floor(Math.min(w, h) * 0.12);
    left = borderEst;
    top = borderEst;
    right = w - borderEst;
    bottom = h - borderEst;
    
    return { left: left, top: top, right: right, bottom: bottom, width: right - left, height: bottom - top };
  }

  function sampleCellColor(canvas, bounds, row, col, gridSize) {
    var ctx = canvas.getContext('2d');
    var cellW = bounds.width / gridSize;
    var cellH = bounds.height / gridSize;
    
    // Sample center of cell — but for the four INNER cells, bias the point
    // outward (toward the cell's outer corner), away from the grid centre where
    // the HEALPix ChromaCoord's black diamond sits. A centred sample on an inner
    // cell sits right at the diamond's reach; the outward bias gives clean cell
    // colour with margin. Outer cells unaffected; standard (no-diamond) cards are
    // unharmed since the biased point stays well within the cell.
    var mid = (gridSize - 1) / 2;
    var fx = col + 0.5, fy = row + 0.5;
    var inner = (gridSize === 4) && (row === 1 || row === 2) && (col === 1 || col === 2);
    if (inner) {
      fx += (col < mid ? -1 : 1) * 0.22;
      fy += (row < mid ? -1 : 1) * 0.22;
    }
    var cx = Math.floor(bounds.left + fx * cellW);
    var cy = Math.floor(bounds.top + fy * cellH);
    
    var pixel = ctx.getImageData(cx, cy, 1, 1).data;
    return nearestColorIndex(pixel[0], pixel[1], pixel[2]);
  }

  // Sample the exact grid centre. On a HEALPix card a solid black diamond sits
  // there; on a standard card the centre is the seam where four data cells meet
  // (never black, since K/W render as colour-split diagonals — the data area
  // contains no black). So black-at-centre ⇒ HEALPix. Sample a small cluster and
  // require the majority to be near-black, for robustness against JPEG ringing.
  function detectCentreVariant(canvas, bounds) {
    try {
      var ctx = canvas.getContext('2d');
      var cx = bounds.left + bounds.width / 2;
      var cy = bounds.top + bounds.height / 2;
      // Sample the diamond's four body lobes along the axes, NOT the dead centre
      // (a targeting dot / notch line can sit there and read non-black even on a
      // HEALPix card). Diamond half-diagonal ≈ gridSize/8; sample at ~45% of it.
      var halfDiag = Math.min(bounds.width, bounds.height) / 8;
      var r = halfDiag * 0.45;
      function blackAt(x, y) {
        var px = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        return px[0] < 70 && px[1] < 70 && px[2] < 70;
      }
      var hits = 0;
      var s1 = blackAt(cx + r, cy), s2 = blackAt(cx - r, cy), s3 = blackAt(cx, cy + r), s4 = blackAt(cx, cy - r);
      hits = (s1?1:0) + (s2?1:0) + (s3?1:0) + (s4?1:0);
      try {
        var dbg = function(x,y){ var p=ctx.getImageData(Math.floor(x),Math.floor(y),1,1).data; return '['+p[0]+','+p[1]+','+p[2]+']'; };
        console.log('[RGB111 variant] bounds c=('+Math.round(cx)+','+Math.round(cy)+') r='+r.toFixed(1)+
          ' lobes E'+dbg(cx+r,cy)+' W'+dbg(cx-r,cy)+' S'+dbg(cx,cy+r)+' N'+dbg(cx,cy-r)+
          ' centre'+dbg(cx,cy)+' -> hits='+hits+' => '+((hits>=3)?'healpix':'standard'));
      } catch(e){}
      return (hits >= 3) ? 'healpix' : 'standard';
    } catch (e) {
      return 'standard';
    }
  }

  function decodeFromCanvas(canvas, options) {
    options = options || {};
    var gridSize = options.gridSize || 4;
    
    try {
      var bounds = detectGridBounds(canvas);
      var variant = detectCentreVariant(canvas, bounds);
      
      // Read all cells
      var bits = '';
      for (var row = 0; row < gridSize; row++) {
        for (var col = 0; col < gridSize; col++) {
          var colorIdx = sampleCellColor(canvas, bounds, row, col, gridSize);
          bits += colorIdx.toString(2).padStart(3, '0');
        }
      }
      
      // Convert bits to hex (48 bits = 12 hex chars)
      var hex = '';
      for (var i = 0; i < bits.length; i += 4) {
        var nibble = bits.substring(i, i + 4);
        if (nibble.length === 4) {
          hex += parseInt(nibble, 2).toString(16).toUpperCase();
        }
      }
      
      // Validate and try rotations
      var result = findCorrectRotation(hex, { top: 0, right: 0, bottom: 0, left: 0 });
      if (result.valid) {
        return { hex: result.hex, rotation: result.rotation, valid: true, variant: variant };
      }
      
      // Try without checksum validation
      return { hex: hex, rotation: 0, valid: false, raw: true, variant: variant };
    } catch (e) {
      return null;
    }
  }

  // === COLOUR-STRING <-> HEX ===
  // The 8 palette colours, in binary RGB111 order, double as an alphabet.
  // Each cell (3 bits) is one letter; 16 cells = one 12-char hex code.
  //   index = (R<<2)|(G<<1)|B
  //   0 K(black) 1 B 2 G 3 C 4 R 5 M 6 Y 7 W(white)
  // The "ink" form spells black/white as K and W (URL-safe, plain letters).
  // The "slash" form substitutes \ for K (000) and / for W (111) — visually
  // suggestive on a card but NOT URL-safe (browsers fold \ into /), so the
  // slash form is for display/manual entry only, never for URLs.
  var COLOR_LETTERS = ['K', 'B', 'G', 'C', 'R', 'M', 'Y', 'W']; // index 0..7

  // Map any accepted input character to its palette index.
  var CHAR_TO_INDEX = (function () {
    var m = {};
    for (var i = 0; i < 8; i++) m[COLOR_LETTERS[i]] = i;
    m['\\'] = 0; // slash form: backslash = K = black = 000
    m['/'] = 7;  // slash form: forward slash = W = white = 111
    return m;
  })();

  // hex (12 chars) -> colour string. style 'slash' (default) uses \ and /,
  // style 'ink' uses K and W (use 'ink' anywhere the string goes in a URL).
  function hexToColorString(hexString, style, group) {
    var hex = (hexString || '').toUpperCase().replace(/[^0-9A-F]/g, '').padEnd(12, '0').slice(0, 12);
    var bits = hexToBits(hex);
    var useSlash = style !== 'ink';
    var out = '';
    for (var c = 0; c < 16; c++) {
      var idx = parseInt(bits.substr(c * 3, 3), 2);
      if (useSlash && idx === 0) out += '\\';
      else if (useSlash && idx === 7) out += '/';
      else out += COLOR_LETTERS[idx];
    }
    // Optional readability grouping: "RMGW YYWW GMKB RCYK". Strictly cosmetic —
    // colorStringToHex / looksLikeColorString already strip whitespace, and URL
    // emit must pass group=false so links stay space-free.
    if (group) out = out.replace(/(.{4})(?=.)/g, '$1 ');
    return out;
  }

  // colour string (any accepted spelling, case-insensitive) -> 12-char hex.
  // Returns null if it isn't a valid 16-symbol colour string.
  function colorStringToHex(str) {
    if (!str || typeof str !== 'string') return null;
    var s = str.toUpperCase().replace(/\s+/g, '');
    // tolerate a trailing .checksum suffix if one was copied along
    var dot = s.indexOf('.');
    if (dot !== -1) s = s.slice(0, dot);
    if (s.length !== 16) return null;
    var bits = '';
    for (var i = 0; i < 16; i++) {
      var idx = CHAR_TO_INDEX[s[i]];
      if (idx === undefined) return null;
      bits += idx.toString(2).padStart(3, '0');
    }
    var hex = '';
    for (var b = 0; b < 48; b += 4) hex += parseInt(bits.substr(b, 4), 2).toString(16).toUpperCase();
    return hex;
  }

  // Does this string look like a colour-string (vs hex)? True only if every
  // character is an accepted colour symbol AND it isn't also valid hex — i.e.
  // it contains a slash or one of the colour-only letters (K W G M Y).
  function looksLikeColorString(str) {
    if (!str || typeof str !== 'string') return false;
    var s = str.toUpperCase().replace(/\s+/g, '');
    var dot = s.indexOf('.'); if (dot !== -1) s = s.slice(0, dot);
    if (s.length !== 16) return false;
    var hasColorOnly = false;
    for (var i = 0; i < 16; i++) {
      var ch = s[i];
      if (CHAR_TO_INDEX[ch] === undefined) return false;
      // characters that can't appear in a hex string
      if (ch === '\\' || ch === '/' || ch === 'K' || ch === 'W' || ch === 'G' || ch === 'M' || ch === 'Y') hasColorOnly = true;
    }
    return hasColorOnly;
  }

  global.RGB111Lib = {
    version: __RGB111_LIB_VER__,
    generateCanvas: generateCanvas, generateDataURL: generateDataURL, generateBlob: generateBlob,
    isValidHexCode: isValidHexCode, crc8: crc8, hexToBits: hexToBits,
    crcToNotches: crcToNotches, notchesToCrc: notchesToCrc,
    rotateHex90: rotateHex90, rotateNotches90: rotateNotches90,
    validateChecksum: validateChecksum, findCorrectRotation: findCorrectRotation,
    decodeFromCanvas: decodeFromCanvas,
    hexToColorString: hexToColorString, colorStringToHex: colorStringToHex,
    looksLikeColorString: looksLikeColorString,
    COLOR_LETTERS: COLOR_LETTERS,
    COLORS: COLORS
  };
})(typeof window !== 'undefined' ? window : this);
