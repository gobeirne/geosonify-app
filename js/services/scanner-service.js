/**
 * geosonify-scanner-service.js v2.0
 * 
 * ChromaCoord scanner service - improved decoding.
 * Decodes RGB111 color codes from images using ray-casting.
 * 
 * Improvements in v2.0:
 * - Upscale small detected regions to minimum 400px for better decoding
 * - CIELAB-based color classification
 * - Diagonal pattern detection for black/white cells
 * - Alternative assignment tries when validation fails
 * - Better saturation thresholds for edge detection
 * - Larger sample regions for color averaging
 * 
 * Usage:
 *   const result = await ScannerService.decode(canvas, x, y);
 *   if (result.valid) {
 *     console.log(result.hex); // e.g., "A1B2C3D4"
 *   }
 */

(function(global) {
  'use strict';

  // ============== CONSTANTS ==============

  const GRID_SIZE = 4;
  const NUM_RAYS = 360;
  const MIN_OUTPUT_SIZE = 400; // Minimum size for perspective-corrected output
  const SAMPLE_RADIUS_RATIO = 0.2; // Sample 20% of cell size

  // RGB111 color definitions
  const COLORS = {
    BLACK:   { r: 0,   g: 0,   b: 0,   bits: '000', name: 'Black' },
    BLUE:    { r: 0,   g: 0,   b: 255, bits: '001', name: 'Blue' },
    GREEN:   { r: 0,   g: 255, b: 0,   bits: '010', name: 'Green' },
    CYAN:    { r: 0,   g: 255, b: 255, bits: '011', name: 'Cyan' },
    RED:     { r: 255, g: 0,   b: 0,   bits: '100', name: 'Red' },
    MAGENTA: { r: 255, g: 0,   b: 255, bits: '101', name: 'Magenta' },
    YELLOW:  { r: 255, g: 255, b: 0,   bits: '110', name: 'Yellow' },
    WHITE:   { r: 255, g: 255, b: 255, bits: '111', name: 'White' }
  };

  const COLOR_TO_BITS = {
    'Black': '000', 'Blue': '001', 'Green': '010', 'Cyan': '011',
    'Red': '100', 'Magenta': '101', 'Yellow': '110', 'White': '111'
  };

  const BITS_TO_COLOR = {
    '000': 'Black', '001': 'Blue', '010': 'Green', '011': 'Cyan',
    '100': 'Red', '101': 'Magenta', '110': 'Yellow', '111': 'White'
  };

  // ============== PIXEL ACCESS ==============

  function getPixel(imageData, x, y) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || x >= imageData.width || y < 0 || y >= imageData.height) {
      return [0, 0, 0, 0];
    }
    const idx = (y * imageData.width + x) * 4;
    return [
      imageData.data[idx],
      imageData.data[idx + 1],
      imageData.data[idx + 2],
      imageData.data[idx + 3]
    ];
  }

  function sampleRegion(imageData, cx, cy, radius) {
    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    radius = Math.max(1, Math.floor(radius));
    
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          const c = getPixel(imageData, cx + dx, cy + dy);
          sumR += c[0];
          sumG += c[1];
          sumB += c[2];
          count++;
        }
      }
    }
    
    return count > 0 
      ? [sumR / count, sumG / count, sumB / count]
      : [0, 0, 0];
  }

  // ============== COLOR SPACE CONVERSIONS ==============

  // Convert RGB to CIELAB for perceptual color comparison
  function rgbToLab(r, g, b) {
    // RGB to XYZ
    let rr = r / 255, gg = g / 255, bb = b / 255;
    
    rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
    gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
    bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;
    
    let x = (rr * 0.4124 + gg * 0.3576 + bb * 0.1805) / 0.95047;
    let y = (rr * 0.2126 + gg * 0.7152 + bb * 0.0722) / 1.00000;
    let z = (rr * 0.0193 + gg * 0.1192 + bb * 0.9505) / 1.08883;
    
    x = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
    y = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
    z = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;
    
    return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)];
  }

  // Calculate CIE76 color difference
  function colorDeltaE(lab1, lab2) {
    return Math.sqrt(
      Math.pow(lab1[0] - lab2[0], 2) +
      Math.pow(lab1[1] - lab2[1], 2) +
      Math.pow(lab1[2] - lab2[2], 2)
    );
  }

  // ============== RAY CASTING ==============

  function castRays(imageData, cx, cy, numRays) {
    const maxDist = Math.max(imageData.width, imageData.height) * 0.7;
    const points = [];
    
    for (let i = 0; i < numRays; i++) {
      const angle = (i / numRays) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      
      let lastSaturatedDist = 0;
      let saturatedCount = 0;
      let nonSaturatedCount = 0;
      
      for (let dist = 5; dist < maxDist; dist++) {
        const px = cx + dx * dist;
        const py = cy + dy * dist;
        
        if (px < 0 || px >= imageData.width || py < 0 || py >= imageData.height) break;
        
        const color = getPixel(imageData, px, py);
        const sat = Math.max(color[0], color[1], color[2]) - Math.min(color[0], color[1], color[2]);
        const maxC = Math.max(color[0], color[1], color[2]);
        const lum = 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2];
        
        // Improved grid color detection - more tolerant of printed colors
        const isGridColor = (sat > 40 && maxC > 80) || // Saturated color
                           (sat > 30 && lum > 60 && lum < 245); // Slightly desaturated
        
        if (isGridColor) {
          lastSaturatedDist = dist;
          saturatedCount++;
          nonSaturatedCount = 0;
        } else {
          nonSaturatedCount++;
        }
        
        // Stop if we've had enough saturated pixels AND now see a gap
        if (saturatedCount > 5 && nonSaturatedCount > 15) {
          break;
        }
      }
      
      const edgeDist = lastSaturatedDist > 10 ? lastSaturatedDist + 2 : 0;
      
      points.push({
        angle,
        rawDist: edgeDist,
        dist: edgeDist,
        x: cx + dx * edgeDist,
        y: cy + dy * edgeDist,
        isOutlier: false
      });
    }
    
    return medianFilterDistances(points, cx, cy);
  }

  function medianFilterDistances(points, cx, cy) {
    const n = points.length;
    let windowSize = Math.floor(n / 24);
    if (windowSize < 3) windowSize = 3;
    
    const filteredDists = [];
    
    for (let i = 0; i < n; i++) {
      const windowDists = [];
      for (let j = -windowSize; j <= windowSize; j++) {
        const idx = (i + j + n) % n;
        if (points[idx].rawDist > 0) {
          windowDists.push(points[idx].rawDist);
        }
      }
      
      if (windowDists.length > 0) {
        windowDists.sort((a, b) => a - b);
        filteredDists[i] = windowDists[Math.floor(windowDists.length / 2)];
      } else {
        filteredDists[i] = points[i].rawDist;
      }
    }
    
    // Mark outliers
    for (let k = 0; k < n; k++) {
      const rawDist = points[k].rawDist;
      const medianDist = filteredDists[k];
      const diff = Math.abs(rawDist - medianDist);
      points[k].isOutlier = (rawDist > 0 && diff > medianDist * 0.25) || rawDist < 10;
    }
    
    return points;
  }

  // ============== CORNER DETECTION ==============

  function fitQuadrilateral(points) {
    const hull = convexHull(points.filter(p => !p.isOutlier && p.dist > 0));
    if (hull.length < 4) return null;
    return findBestQuadFromHull(hull);
  }

  function convexHull(points) {
    if (points.length < 3) return points;
    
    const pts = points.map(p => ({ x: p.x, y: p.y }));
    pts.sort((a, b) => a.x - b.x || a.y - b.y);
    
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }
    
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }
    
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function findBestQuadFromHull(hull) {
    const n = hull.length;
    if (n < 4) return null;
    if (n === 4) return orderCorners(hull);
    
    // For larger hulls, find 4 points that maximize area
    let bestArea = 0;
    let bestQuad = null;
    
    // Limit iterations for performance
    const step = n > 20 ? Math.ceil(n / 20) : 1;
    
    for (let i = 0; i < n; i += step) {
      for (let j = i + 1; j < n; j += step) {
        for (let k = j + 1; k < n; k += step) {
          for (let l = k + 1; l < n; l += step) {
            const quad = [hull[i], hull[j], hull[k], hull[l]];
            const area = quadArea(quad);
            if (area > bestArea) {
              bestArea = area;
              bestQuad = quad;
            }
          }
        }
      }
    }
    
    return bestQuad ? orderCorners(bestQuad) : null;
  }

  function quadArea(quad) {
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      area += quad[i].x * quad[j].y;
      area -= quad[j].x * quad[i].y;
    }
    return Math.abs(area) / 2;
  }

  function orderCorners(corners) {
    // Find centroid
    const cx = corners.reduce((s, c) => s + c.x, 0) / 4;
    const cy = corners.reduce((s, c) => s + c.y, 0) / 4;
    
    // Sort by angle from centroid
    const withAngles = corners.map(c => ({
      ...c,
      angle: Math.atan2(c.y - cy, c.x - cx)
    }));
    
    withAngles.sort((a, b) => a.angle - b.angle);
    
    // Find top-left (smallest x+y among top two)
    // First, identify which two are "top" (smaller y)
    const sorted = [...withAngles].sort((a, b) => a.y - b.y);
    const top = [sorted[0], sorted[1]].sort((a, b) => a.x - b.x);
    const bottom = [sorted[2], sorted[3]].sort((a, b) => a.x - b.x);
    
    return {
      TL: { x: top[0].x, y: top[0].y },
      TR: { x: top[1].x, y: top[1].y },
      BR: { x: bottom[1].x, y: bottom[1].y },
      BL: { x: bottom[0].x, y: bottom[0].y }
    };
  }

  // ============== DIAGONAL DETECTION ==============

  function detectDiagonal(imageData, cx, cy, cellSize) {
    // Check if cell has a diagonal pattern (black or white)
    const sampleSize = cellSize * 0.3;
    
    // Sample corners of the cell
    const topLeft = sampleRegion(imageData, cx - sampleSize, cy - sampleSize, 3);
    const topRight = sampleRegion(imageData, cx + sampleSize, cy - sampleSize, 3);
    const bottomLeft = sampleRegion(imageData, cx - sampleSize, cy + sampleSize, 3);
    const bottomRight = sampleRegion(imageData, cx + sampleSize, cy + sampleSize, 3);
    
    const lumTL = 0.299 * topLeft[0] + 0.587 * topLeft[1] + 0.114 * topLeft[2];
    const lumTR = 0.299 * topRight[0] + 0.587 * topRight[1] + 0.114 * topRight[2];
    const lumBL = 0.299 * bottomLeft[0] + 0.587 * bottomLeft[1] + 0.114 * bottomLeft[2];
    const lumBR = 0.299 * bottomRight[0] + 0.587 * bottomRight[1] + 0.114 * bottomRight[2];
    
    // Check for diagonal patterns
    // White diagonal (↘): TL and BR are bright, TR and BL are dark
    const whiteDiag = (lumTL > 180 && lumBR > 180 && lumTR < 100 && lumBL < 100);
    // Black diagonal (↙): TR and BL are bright, TL and BR are dark
    const blackDiag = (lumTR > 180 && lumBL > 180 && lumTL < 100 && lumBR < 100);
    
    // Also check saturation - diagonals should be low saturation
    const center = sampleRegion(imageData, cx, cy, cellSize * 0.15);
    const sat = Math.max(center[0], center[1], center[2]) - Math.min(center[0], center[1], center[2]);
    
    if (whiteDiag && sat < 60) {
      return { type: 'white', confidence: 0.9 };
    } else if (blackDiag && sat < 60) {
      return { type: 'black', confidence: 0.9 };
    }
    
    return { type: 'none', confidence: 0 };
  }

  // ============== COLOR CLASSIFICATION ==============

  function classifyColorLab(r, g, b) {
    const sampleLab = rgbToLab(r, g, b);
    
    let bestColor = 'Black';
    let bestDist = Infinity;
    let secondBest = 'Black';
    let secondDist = Infinity;
    
    for (const [name, def] of Object.entries(COLORS)) {
      const refLab = rgbToLab(def.r, def.g, def.b);
      const dist = colorDeltaE(sampleLab, refLab);
      
      if (dist < bestDist) {
        secondBest = bestColor;
        secondDist = bestDist;
        bestColor = name.charAt(0) + name.slice(1).toLowerCase();
        bestDist = dist;
      } else if (dist < secondDist) {
        secondBest = name.charAt(0) + name.slice(1).toLowerCase();
        secondDist = dist;
      }
    }
    
    // Check if ambiguous (second best is close)
    const ambiguous = (secondDist - bestDist) < 15;
    
    return {
      color: bestColor,
      bits: COLOR_TO_BITS[bestColor],
      confidence: Math.max(0, 1 - bestDist / 100),
      ambiguous: ambiguous,
      alternatives: ambiguous ? [secondBest] : []
    };
  }

  function classifyColorsAdaptive(samples, imageData, size) {
    // First pass: detect diagonals
    const cellSize = size / GRID_SIZE;
    
    samples.forEach(s => {
      const diag = detectDiagonal(imageData, s.cx, s.cy, cellSize);
      if (diag.type === 'white') {
        s.bits = '111';
        s.name = 'White';
        s.isDiagonal = true;
        s.confidence = diag.confidence;
      } else if (diag.type === 'black') {
        s.bits = '000';
        s.name = 'Black';
        s.isDiagonal = true;
        s.confidence = diag.confidence;
      } else {
        s.isDiagonal = false;
      }
    });
    
    // Second pass: classify non-diagonal cells using CIELAB
    samples.forEach(s => {
      if (!s.isDiagonal) {
        const result = classifyColorLab(s.r, s.g, s.b);
        s.bits = result.bits;
        s.name = result.color;
        s.confidence = result.confidence;
        s.ambiguous = result.ambiguous;
        s.alternatives = result.alternatives;
      }
    });
    
    return samples;
  }

  // ============== CRC VALIDATION ==============

  function crc8(bits) {
    const poly = 0x07;
    let crc = 0;
    
    for (let i = 0; i < bits.length; i++) {
      const bit = bits[i] === '1' ? 1 : 0;
      const msb = (crc >> 7) & 1;
      crc = ((crc << 1) | bit) & 0xFF;
      if (msb) crc ^= poly;
    }
    
    for (let i = 0; i < 8; i++) {
      const msb = (crc >> 7) & 1;
      crc = (crc << 1) & 0xFF;
      if (msb) crc ^= poly;
    }
    
    return crc;
  }

  function validateCRC(bits, expectedCRC) {
    const computed = crc8(bits);
    return computed === expectedCRC;
  }

  // ============== GRID SAMPLING ==============

  function sampleGrid(imageData, size) {
    const samples = [];
    const cellSize = size / GRID_SIZE;
    const sampleRadius = cellSize * SAMPLE_RADIUS_RATIO;
    
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const cx = (col + 0.5) * cellSize;
        const cy = (row + 0.5) * cellSize;
        const color = sampleRegion(imageData, cx, cy, sampleRadius);
        
        samples.push({
          row, col,
          cx, cy,
          r: color[0],
          g: color[1],
          b: color[2]
        });
      }
    }
    
    return samples;
  }

  // ============== ALTERNATIVE ASSIGNMENT TRIES ==============

  function tryAlternativeAssignments(samples, maxTries = 32) {
    // Find ambiguous cells
    const ambiguousCells = [];
    samples.forEach((s, idx) => {
      if (s.ambiguous && s.alternatives && s.alternatives.length > 0) {
        ambiguousCells.push({ idx, original: s.bits, alternatives: s.alternatives });
      }
    });
    
    if (ambiguousCells.length === 0) return null;
    
    const numTries = Math.min(maxTries, Math.pow(2, ambiguousCells.length));
    
    for (let tryNum = 1; tryNum < numTries; tryNum++) {
      const testSamples = samples.map(s => ({ ...s }));
      
      for (let i = 0; i < ambiguousCells.length; i++) {
        const useAlt = (tryNum >> i) & 1;
        if (useAlt) {
          const cell = ambiguousCells[i];
          const altColor = cell.alternatives[0];
          const altBits = COLOR_TO_BITS[altColor];
          if (altBits) {
            testSamples[cell.idx].bits = altBits;
            testSamples[cell.idx].name = altColor;
          }
        }
      }
      
      // Build bit string and validate
      const bits = testSamples.map(s => s.bits).join('');
      const dataBits = bits.slice(0, -8);
      const crcBits = bits.slice(-8);
      const expectedCRC = parseInt(crcBits, 2);
      
      if (validateCRC(dataBits, expectedCRC)) {
        return { samples: testSamples, bits, valid: true };
      }
    }
    
    return null;
  }

  // ============== DECODE LOGIC ==============

  function decodeFromCorrectedImage(imageData) {
    const size = imageData.width; // Should be square (400x400)
    
    // Sample and classify
    let samples = sampleGrid(imageData, size);
    samples = classifyColorsAdaptive(samples, imageData, size);
    
    // Build bit string
    let bits = samples.map(s => s.bits).join('');
    
    // Validate CRC
    const dataBits = bits.slice(0, -8);
    const crcBits = bits.slice(-8);
    const expectedCRC = parseInt(crcBits, 2);
    let valid = validateCRC(dataBits, expectedCRC);
    
    // If invalid, try alternative assignments
    if (!valid) {
      const altResult = tryAlternativeAssignments(samples);
      if (altResult) {
        samples = altResult.samples;
        bits = altResult.bits;
        valid = true;
      }
    }
    
    // Convert to hex
    let hex = '';
    for (let i = 0; i + 4 <= bits.length; i += 4) {
      hex += parseInt(bits.substr(i, 4), 2).toString(16).toUpperCase();
    }
    
    return {
      bits,
      hex,
      valid,
      samples,
      confidence: samples.reduce((sum, s) => sum + (s.confidence || 0), 0) / samples.length
    };
  }

  function tryAllRotations(imageData, size) {
    // Create rotated versions and try each
    const rotations = [0, 90, 180, 270];
    
    for (const rotation of rotations) {
      const rotatedData = rotation === 0 ? imageData : rotateImageData(imageData, rotation);
      const result = decodeFromCorrectedImage(rotatedData);
      
      if (result.valid) {
        return { ...result, rotation };
      }
    }
    
    // Return rotation 0 result if none valid
    return { ...decodeFromCorrectedImage(imageData), rotation: 0 };
  }

  function rotateImageData(imageData, degrees) {
    const size = imageData.width;
    const rotated = new ImageData(size, size);
    const steps = Math.floor(degrees / 90) % 4;
    
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const srcIdx = (y * size + x) * 4;
        let newX, newY;
        
        switch (steps) {
          case 1: // 90° CW
            newX = size - 1 - y;
            newY = x;
            break;
          case 2: // 180°
            newX = size - 1 - x;
            newY = size - 1 - y;
            break;
          case 3: // 270° CW
            newX = y;
            newY = size - 1 - x;
            break;
          default:
            newX = x;
            newY = y;
        }
        
        const dstIdx = (newY * size + newX) * 4;
        rotated.data[dstIdx] = imageData.data[srcIdx];
        rotated.data[dstIdx + 1] = imageData.data[srcIdx + 1];
        rotated.data[dstIdx + 2] = imageData.data[srcIdx + 2];
        rotated.data[dstIdx + 3] = imageData.data[srcIdx + 3];
      }
    }
    
    return rotated;
  }

  // ============== PUBLIC API ==============

  const ScannerService = {
    version: 'v2.0',
    
    get isAvailable() {
      return true;
    },

    /**
     * Cast rays from a point to find code edges
     */
    castRays(imageData, x, y, numRays = NUM_RAYS) {
      return castRays(imageData, x, y, numRays);
    },

    /**
     * Fit a quadrilateral to edge points
     */
    fitQuadrilateral(points) {
      return fitQuadrilateral(points);
    },

    /**
     * Decode from a perspective-corrected image
     * @param {ImageData} imageData - Should be square, ideally 400x400
     * @returns {Object} Result with { valid, hex, bits, confidence, samples }
     */
    decodeFromCorrectedImage(imageData) {
      return tryAllRotations(imageData, imageData.width);
    },

    /**
     * Get the minimum recommended output size for perspective correction
     */
    getMinOutputSize() {
      return MIN_OUTPUT_SIZE;
    },

    /**
     * Draw debug visualization on canvas
     */
    drawDebug(ctx, result) {
      if (!result.samples) return;
      
      const size = ctx.canvas.width;
      const cellSize = size / GRID_SIZE;
      
      // Draw grid
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
      ctx.lineWidth = 1;
      for (let i = 1; i < GRID_SIZE; i++) {
        ctx.beginPath();
        ctx.moveTo(i * cellSize, 0);
        ctx.lineTo(i * cellSize, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * cellSize);
        ctx.lineTo(size, i * cellSize);
        ctx.stroke();
      }
      
      // Draw sample points
      result.samples.forEach(s => {
        ctx.fillStyle = s.valid === false ? '#f00' : '#0f0';
        ctx.beginPath();
        ctx.arc(s.cx, s.cy, 4, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw color name
        ctx.fillStyle = '#fff';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(s.name || '', s.cx, s.cy + cellSize * 0.3);
      });
    }
  };

  // ============== EXPORT ==============

  global.ScannerService = ScannerService;
  
  // Also export as RGB111Scanner for compatibility
  global.RGB111Scanner = ScannerService;

  console.log('[geosonify] scanner-service v2.0 loaded (improved decoding)');

})(typeof window !== 'undefined' ? window : this);
