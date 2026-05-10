/*
  geosonify-scanner-lib_v2_0.js
  RGB111 Image Scanner/Decoder Library
  
  COMPLETE FAITHFUL EXTRACTION from RGB111_Decoder_v65.html
  
  Features:
  - Ray-casting edge detection with median filter outlier detection
  - Convex hull corner finding with refinement
  - Perspective correction (requires OpenCV.js)
  - CIELAB color clustering with relative position assignment
  - Diagonal (black/white) pattern detection
  - 4-notch CRC-8 validation with grayscale fallback
  - Automatic rotation correction (tries all 4 orientations)
  - Alternative assignment tries for ambiguous cells
  
  Usage:
    // Full scan from click point
    var result = RGB111Scanner.scanFromClick(imageData, clickX, clickY, options);
    
    // Just detect corners
    var corners = RGB111Scanner.detectCorners(imageData, clickX, clickY, options);
    
    // Decode from perspective-corrected image
    var result = RGB111Scanner.decodeFromCorrectedImage(correctedImageData);
*/
(function(global) {
  'use strict';
  
  var __SCANNER_VERSION__ = 'v2.1';
  
  // Logging function - can be overridden
  var _logFn = function(msg) { 
    try { console.log('[RGB111Scanner] ' + msg); } catch(e) {} 
  };
  
  function log(msg) {
    if (_logFn) _logFn(msg);
  }

  // ========== PIXEL & COLOR HELPERS ==========
  
  function getPixel(imageData, x, y) {
    x = Math.floor(x); 
    y = Math.floor(y);
    if (x < 0 || x >= imageData.width || y < 0 || y >= imageData.height) return [0, 0, 0];
    var i = (y * imageData.width + x) * 4;
    return [imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]];
  }
  
  function getLuminance(c) { 
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; 
  }
  
  function isBlackOrWhite(c) {
    var lum = getLuminance(c);
    var saturation = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
    if (lum < 50 && saturation < 60) return true;
    if (lum > 200 && saturation < 60) return true;
    return false;
  }
  
  function isGridColor(c) {
    var r = c[0], g = c[1], b = c[2];
    var maxC = Math.max(r, g, b);
    var minC = Math.min(r, g, b);
    var saturation = maxC - minC;
    var luminance = getLuminance(c);
    if (saturation > 60 && maxC > 80) return true;
    if (saturation > 40 && luminance > 60 && luminance < 245) return true;
    return false;
  }
  
  function sampleRegion(imageData, cx, cy, radius) {
    var sumR = 0, sumG = 0, sumB = 0, count = 0;
    radius = Math.max(1, Math.floor(radius));
    for (var dy = -radius; dy <= radius; dy++) {
      for (var dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          var c = getPixel(imageData, cx + dx, cy + dy);
          sumR += c[0]; sumG += c[1]; sumB += c[2]; count++;
        }
      }
    }
    return count > 0 ? [sumR / count, sumG / count, sumB / count] : [0, 0, 0];
  }
  
  function colorDistance(c1, c2) {
    return Math.sqrt(Math.pow(c1[0]-c2[0],2) + Math.pow(c1[1]-c2[1],2) + Math.pow(c1[2]-c2[2],2));
  }

  // ========== RAY CASTING ==========
  
  function castRays(imageData, cx, cy, numRays) {
    var maxDist = Math.max(imageData.width, imageData.height) * 0.7;
    var points = [];
    
    for (var i = 0; i < numRays; i++) {
      var angle = (i / numRays) * Math.PI * 2;
      var dx = Math.cos(angle);
      var dy = Math.sin(angle);
      
      var lastSaturatedDist = 0;
      var saturatedCount = 0;
      var nonSaturatedCount = 0;
      
      for (var dist = 5; dist < maxDist; dist += 1) {
        var px = cx + dx * dist;
        var py = cy + dy * dist;
        
        if (px < 0 || px >= imageData.width || py < 0 || py >= imageData.height) break;
        
        var color = getPixel(imageData, px, py);
        var sat = Math.max(color[0], color[1], color[2]) - Math.min(color[0], color[1], color[2]);
        var maxC = Math.max(color[0], color[1], color[2]);
        
        if (sat > 45 && maxC > 50) {
          lastSaturatedDist = dist;
          saturatedCount++;
          nonSaturatedCount = 0;
        } else {
          nonSaturatedCount++;
        }
        
        if (saturatedCount > 5 && nonSaturatedCount > 15) break;
      }
      
      var edgeDist = lastSaturatedDist > 10 ? lastSaturatedDist + 2 : 0;
      
      points.push({
        angle: angle,
        rawDist: edgeDist,
        dist: edgeDist,
        x: cx + dx * edgeDist,
        y: cy + dy * edgeDist,
        isOutlier: false
      });
    }
    
    log('Cast ' + numRays + ' rays');
    return medianFilterDistances(points, cx, cy);
  }
  
  function medianFilterDistances(points, cx, cy) {
    var n = points.length;
    var windowSize = Math.floor(n / 24);
    if (windowSize < 3) windowSize = 3;
    
    var filteredDists = [];
    
    for (var i = 0; i < n; i++) {
      var windowDists = [];
      for (var j = -windowSize; j <= windowSize; j++) {
        var idx = (i + j + n) % n;
        if (points[idx].rawDist > 0) {
          windowDists.push(points[idx].rawDist);
        }
      }
      
      if (windowDists.length > 0) {
        windowDists.sort(function(a, b) { return a - b; });
        filteredDists[i] = windowDists[Math.floor(windowDists.length / 2)];
      } else {
        filteredDists[i] = points[i].rawDist;
      }
    }
    
    var outlierCount = 0;
    for (var k = 0; k < n; k++) {
      var rawDist = points[k].rawDist;
      var medianDist = filteredDists[k];
      var diff = Math.abs(rawDist - medianDist);
      points[k].isOutlier = (rawDist > 0 && diff > medianDist * 0.25) || rawDist < 10;
      if (points[k].isOutlier) outlierCount++;
    }
    
    log('Outlier detection: ' + outlierCount + ' outliers found');
    return points;
  }

  // ========== CONVEX HULL ==========
  
  function cross(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }
  
  function convexHull(points) {
    if (points.length < 3) return points.slice();
    
    var start = 0;
    for (var i = 1; i < points.length; i++) {
      if (points[i].y < points[start].y || 
          (points[i].y === points[start].y && points[i].x < points[start].x)) {
        start = i;
      }
    }
    
    var pivot = points[start];
    
    var sorted = points.slice().sort(function(a, b) {
      var angleA = Math.atan2(a.y - pivot.y, a.x - pivot.x);
      var angleB = Math.atan2(b.y - pivot.y, b.x - pivot.x);
      if (Math.abs(angleA - angleB) < 1e-10) {
        var distA = (a.x - pivot.x) * (a.x - pivot.x) + (a.y - pivot.y) * (a.y - pivot.y);
        var distB = (b.x - pivot.x) * (b.x - pivot.x) + (b.y - pivot.y) * (b.y - pivot.y);
        return distA - distB;
      }
      return angleA - angleB;
    });
    
    var hull = [];
    for (var i = 0; i < sorted.length; i++) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], sorted[i]) <= 0) {
        hull.pop();
      }
      hull.push(sorted[i]);
    }
    
    return hull;
  }

  // ========== CORNER DETECTION ==========
  
  function findBestQuadFromHull(hull) {
    var n = hull.length;
    if (n < 4) return null;
    
    var angles = [];
    for (var i = 0; i < n; i++) {
      var prev = hull[(i - 1 + n) % n];
      var curr = hull[i];
      var next = hull[(i + 1) % n];
      
      var angle1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
      var angle2 = Math.atan2(next.y - curr.y, next.x - curr.x);
      var turn = Math.abs(angle2 - angle1);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      
      angles.push({ index: i, turn: turn, point: curr });
    }
    
    angles.sort(function(a, b) { return b.turn - a.turn; });
    
    var corners = [angles[0]];
    var minSeparation = n / 6;
    
    for (var i = 1; i < angles.length && corners.length < 4; i++) {
      var tooClose = false;
      for (var j = 0; j < corners.length; j++) {
        var gap = Math.abs(angles[i].index - corners[j].index);
        gap = Math.min(gap, n - gap);
        if (gap < minSeparation) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) corners.push(angles[i]);
    }
    
    if (corners.length < 4) {
      corners = [];
      for (var i = 0; i < 4; i++) {
        var idx = Math.floor(i * n / 4);
        corners.push({ index: idx, point: hull[idx] });
      }
    }
    
    corners.sort(function(a, b) { return a.index - b.index; });
    return corners.map(function(c) { return c.point; });
  }
  
  function pointToSegmentDist(p, a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var lenSq = dx * dx + dy * dy;
    
    if (lenSq === 0) {
      return Math.sqrt((p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y));
    }
    
    var t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    var projX = a.x + t * dx;
    var projY = a.y + t * dy;
    
    return Math.sqrt((p.x - projX) * (p.x - projX) + (p.y - projY) * (p.y - projY));
  }
  
  function fitLineLeastSquares(points) {
    if (points.length < 2) return null;
    
    var sumX = 0, sumY = 0, sumXX = 0, sumXY = 0, sumYY = 0;
    var n = points.length;
    
    for (var i = 0; i < n; i++) {
      sumX += points[i].x;
      sumY += points[i].y;
      sumXX += points[i].x * points[i].x;
      sumXY += points[i].x * points[i].y;
      sumYY += points[i].y * points[i].y;
    }
    
    var dX = n * sumXX - sumX * sumX;
    var dY = n * sumYY - sumY * sumY;
    
    if (Math.abs(dX) > Math.abs(dY)) {
      var m = (n * sumXY - sumX * sumY) / dX;
      var b = (sumY - m * sumX) / n;
      return { a: -m, b: 1, c: -b };
    } else {
      var m = (n * sumXY - sumX * sumY) / dY;
      var b = (sumX - m * sumY) / n;
      return { a: 1, b: -m, c: -b };
    }
  }
  
  function lineIntersection(line1, line2) {
    if (!line1 || !line2) return null;
    var det = line1.a * line2.b - line2.a * line1.b;
    if (Math.abs(det) < 1e-10) return null;
    var x = (line1.b * line2.c - line2.b * line1.c) / det;
    var y = (line2.a * line1.c - line1.a * line2.c) / det;
    return { x: x, y: y };
  }
  
  function refineCorners(points, corners) {
    var edges = [[], [], [], []];
    
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var bestEdge = 0;
      var bestDist = Infinity;
      
      for (var e = 0; e < 4; e++) {
        var c1 = corners[e];
        var c2 = corners[(e + 1) % 4];
        var dist = pointToSegmentDist(p, c1, c2);
        if (dist < bestDist) {
          bestDist = dist;
          bestEdge = e;
        }
      }
      
      if (!p.isOutlier && p.dist > 10) {
        edges[bestEdge].push(p);
      }
    }
    
    log('Points per edge (refined): ' + edges.map(function(e) { return e.length; }).join(', '));
    
    var lines = [];
    for (var e = 0; e < 4; e++) {
      if (edges[e].length < 5) {
        lines.push(null);
      } else {
        lines.push(fitLineLeastSquares(edges[e]));
      }
    }
    
    var refined = [];
    for (var c = 0; c < 4; c++) {
      var line1 = lines[c];
      var line2 = lines[(c + 1) % 4];
      
      if (line1 && line2) {
        var intersection = lineIntersection(line1, line2);
        if (intersection) {
          refined.push(intersection);
        } else {
          refined.push(corners[(c + 1) % 4]);
        }
      } else {
        refined.push(corners[(c + 1) % 4]);
      }
    }
    
    return refined;
  }
  
  function labelCorners(corners) {
    if (corners.length !== 4) return null;
    
    var centroid = {
      x: (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4,
      y: (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4
    };
    
    var top = corners.filter(function(c) { return c.y < centroid.y; })
                     .sort(function(a, b) { return a.x - b.x; });
    var bottom = corners.filter(function(c) { return c.y >= centroid.y; })
                        .sort(function(a, b) { return a.x - b.x; });
    
    if (top.length !== 2 || bottom.length !== 2) {
      corners.sort(function(a, b) { return a.y - b.y; });
      top = corners.slice(0, 2).sort(function(a, b) { return a.x - b.x; });
      bottom = corners.slice(2, 4).sort(function(a, b) { return a.x - b.x; });
    }
    
    var tl = top[0], tr = top[1], bl = bottom[0], br = bottom[1];
    
    if (!tl || !tr || !br || !bl) {
      log('Could not classify corners');
      return null;
    }
    
    log('Corners detected:');
    log('  TL: (' + Math.round(tl.x) + ',' + Math.round(tl.y) + ')');
    log('  TR: (' + Math.round(tr.x) + ',' + Math.round(tr.y) + ')');
    log('  BR: (' + Math.round(br.x) + ',' + Math.round(br.y) + ')');
    log('  BL: (' + Math.round(bl.x) + ',' + Math.round(bl.y) + ')');
    
    return { TL: tl, TR: tr, BR: br, BL: bl };
  }
  
  function fitQuadrilateralByAngle(points) {
    var n = points.length;
    var edges = [[], [], [], []];
    
    for (var i = 0; i < n; i++) {
      var angle = points[i].angle;
      if (angle < 0) angle += Math.PI * 2;
      var deg = angle * 180 / Math.PI;
      
      var edgeIndex;
      if (deg >= 315 || deg < 45) edgeIndex = 0;
      else if (deg >= 45 && deg < 135) edgeIndex = 1;
      else if (deg >= 135 && deg < 225) edgeIndex = 2;
      else edgeIndex = 3;
      
      if (points[i].rawDist > 10) {
        edges[edgeIndex].push(points[i]);
      }
    }
    
    log('Fallback - Points per edge: R=' + edges[0].length + ', B=' + edges[1].length + ', L=' + edges[2].length + ', T=' + edges[3].length);
    
    var lines = [];
    for (var e = 0; e < 4; e++) {
      if (edges[e].length < 5) return null;
      edges[e].sort(function(a, b) { return a.angle - b.angle; });
      var trimCount = Math.floor(edges[e].length * 0.2);
      var trimmed = edges[e].slice(trimCount, edges[e].length - trimCount);
      if (trimmed.length < 3) trimmed = edges[e];
      lines.push(fitLineLeastSquares(trimmed));
    }
    
    var BR = lineIntersection(lines[0], lines[1]);
    var BL = lineIntersection(lines[1], lines[2]);
    var TL = lineIntersection(lines[2], lines[3]);
    var TR = lineIntersection(lines[3], lines[0]);
    
    if (!TL || !TR || !BR || !BL) return null;
    
    log('Corners (angle fallback):');
    log('  TL: (' + Math.round(TL.x) + ',' + Math.round(TL.y) + ')');
    log('  TR: (' + Math.round(TR.x) + ',' + Math.round(TR.y) + ')');
    log('  BR: (' + Math.round(BR.x) + ',' + Math.round(BR.y) + ')');
    log('  BL: (' + Math.round(BL.x) + ',' + Math.round(BL.y) + ')');
    
    return { TL: TL, TR: TR, BR: BR, BL: BL };
  }
  
  function fitQuadrilateral(points) {
    var n = points.length;
    if (n < 20) return null;
    
    var validPoints = points.filter(function(p) { return !p.isOutlier && p.dist > 10; });
    
    var hull = convexHull(validPoints);
    log('Convex hull has ' + hull.length + ' points');
    
    if (hull.length < 4) {
      log('Hull too small');
      return fitQuadrilateralByAngle(points);
    }
    
    var corners = findBestQuadFromHull(hull);
    
    if (!corners || corners.length !== 4) {
      log('Could not find 4 corners from hull');
      return fitQuadrilateralByAngle(points);
    }
    
    var refined = refineCorners(validPoints, corners);
    return labelCorners(refined);
  }
  
  function getGridCorners(corners, borderRatio) {
    // v65 returns corners directly - the line-fitting gives grid edges
    return {
      TL: { x: corners.TL.x, y: corners.TL.y },
      TR: { x: corners.TR.x, y: corners.TR.y },
      BR: { x: corners.BR.x, y: corners.BR.y },
      BL: { x: corners.BL.x, y: corners.BL.y }
    };
  }

  // ========== CRC-8 ==========
  
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
    return {
      top: (crc >> 6) & 0x03,
      right: (crc >> 4) & 0x03,
      bottom: (crc >> 2) & 0x03,
      left: crc & 0x03
    };
  }
  
  function notchesToCrc(notches) {
    return ((notches.top & 0x03) << 6) |
           ((notches.right & 0x03) << 4) |
           ((notches.bottom & 0x03) << 2) |
           (notches.left & 0x03);
  }

  // ========== NOTCH DETECTION ==========
  
  function detectNotchOnEdge(imageData, size, edge) {
    var cellSize = size / 4;
    var scanDepth = cellSize * 0.15;
    
    var samples = [];
    var numSamples = Math.floor(size);
    
    for (var i = 0; i < numSamples; i++) {
      var t = i / (numSamples - 1);
      var x, y;
      
      if (edge === 'top') {
        x = t * size;
        y = scanDepth;
      } else if (edge === 'right') {
        x = size - scanDepth;
        y = t * size;
      } else if (edge === 'bottom') {
        x = (1 - t) * size;
        y = size - scanDepth;
      } else {
        x = scanDepth;
        y = (1 - t) * size;
      }
      
      var color = getPixel(imageData, Math.floor(x), Math.floor(y));
      samples.push({
        pos: t * 4,
        r: color[0],
        g: color[1],
        b: color[2]
      });
    }
    
    var cellResults = [];
    
    for (var cell = 0; cell < 4; cell++) {
      var cellStart = cell;
      var cellEnd = cell + 1;
      
      var cellSamples = samples.filter(function(s) {
        return s.pos >= cellStart && s.pos < cellEnd;
      });
      
      if (cellSamples.length < 10) continue;
      
      var leftSamples = cellSamples.filter(function(s) { return s.pos < cellStart + 0.33; });
      var midSamples = cellSamples.filter(function(s) { return s.pos >= cellStart + 0.33 && s.pos < cellStart + 0.67; });
      var rightSamples = cellSamples.filter(function(s) { return s.pos >= cellStart + 0.67; });
      
      function avgColor(arr) {
        if (arr.length === 0) return [128, 128, 128];
        var r = 0, g = 0, b = 0;
        arr.forEach(function(s) { r += s.r; g += s.g; b += s.b; });
        return [r / arr.length, g / arr.length, b / arr.length];
      }
      
      var leftColor = avgColor(leftSamples);
      var midColor = avgColor(midSamples);
      var rightColor = avgColor(rightSamples);
      
      var edgeAvg = [(leftColor[0] + rightColor[0]) / 2, 
                     (leftColor[1] + rightColor[1]) / 2, 
                     (leftColor[2] + rightColor[2]) / 2];
      
      var bumpContrast = colorDistance(midColor, edgeAvg);
      var edgeSimilarity = colorDistance(leftColor, rightColor);
      var score = bumpContrast - (edgeSimilarity * 0.3);
      
      cellResults.push({
        cell: cell,
        bumpContrast: bumpContrast,
        edgeSimilarity: edgeSimilarity,
        score: score
      });
    }
    
    if (cellResults.length === 0) return -1;
    
    cellResults.sort(function(a, b) { return b.score - a.score; });
    
    var best = cellResults[0];
    var second = cellResults[1] || { score: 0, bumpContrast: 0 };
    
    log('  ' + edge + ' notch scores: ' + cellResults.map(function(r) { 
      return r.cell + ':' + r.score.toFixed(0) + '(b=' + r.bumpContrast.toFixed(0) + ')'; 
    }).join(' '));
    
    var maxBump = Math.max.apply(null, cellResults.map(function(r) { return r.bumpContrast; }));
    var avgBump = cellResults.reduce(function(s, r) { return s + r.bumpContrast; }, 0) / cellResults.length;
    var adaptiveThreshold = Math.max(12, avgBump * 1.5);
    
    if (best.bumpContrast > adaptiveThreshold && best.score >= second.score * 1.1 && best.score > 8) {
      return best.cell;
    }
    
    if (best.bumpContrast > avgBump * 1.3 && Math.abs(best.score - second.score) < best.score * 0.1) {
      if (best.bumpContrast > second.bumpContrast) {
        return best.cell;
      }
    }
    
    if (best.bumpContrast > 12 && best.bumpContrast > second.bumpContrast * 1.3) {
      return best.cell;
    }
    
    if (maxBump > 8 && best.bumpContrast === maxBump && best.bumpContrast > avgBump * 1.8) {
      return best.cell;
    }
    
    return -1;
  }
  
  function detectNotchOnEdgeGrayscale(grayscale, size, edge) {
    var cellSize = size / 4;
    var scanDepth = Math.floor(cellSize * 0.15);
    
    var samples = [];
    var numSamples = size;
    
    for (var i = 0; i < numSamples; i++) {
      var t = i / (numSamples - 1);
      var x, y;
      
      if (edge === 'top') {
        x = Math.floor(t * (size - 1));
        y = scanDepth;
      } else if (edge === 'right') {
        x = size - 1 - scanDepth;
        y = Math.floor(t * (size - 1));
      } else if (edge === 'bottom') {
        x = Math.floor((1 - t) * (size - 1));
        y = size - 1 - scanDepth;
      } else {
        x = scanDepth;
        y = Math.floor((1 - t) * (size - 1));
      }
      
      var idx = y * size + x;
      samples.push({ pos: t * 4, val: grayscale[idx] || 0 });
    }
    
    var cellResults = [];
    
    for (var cell = 0; cell < 4; cell++) {
      var cellSamples = samples.filter(function(s) {
        return s.pos >= cell && s.pos < cell + 1;
      });
      
      if (cellSamples.length < 10) continue;
      
      var leftSamples = cellSamples.filter(function(s) { return s.pos < cell + 0.33; });
      var midSamples = cellSamples.filter(function(s) { return s.pos >= cell + 0.33 && s.pos < cell + 0.67; });
      var rightSamples = cellSamples.filter(function(s) { return s.pos >= cell + 0.67; });
      
      function avgVal(arr) {
        if (arr.length === 0) return 128;
        var sum = 0;
        arr.forEach(function(s) { sum += s.val; });
        return sum / arr.length;
      }
      
      var leftVal = avgVal(leftSamples);
      var midVal = avgVal(midSamples);
      var rightVal = avgVal(rightSamples);
      
      var edgeAvg = (leftVal + rightVal) / 2;
      var bumpContrast = Math.abs(midVal - edgeAvg);
      var edgeSimilarity = Math.abs(leftVal - rightVal);
      var score = bumpContrast - (edgeSimilarity * 0.3);
      
      cellResults.push({ cell: cell, bumpContrast: bumpContrast, score: score });
    }
    
    if (cellResults.length === 0) return -1;
    
    cellResults.sort(function(a, b) { return b.score - a.score; });
    
    var best = cellResults[0];
    var second = cellResults[1] || { score: 0, bumpContrast: 0 };
    var maxBump = Math.max.apply(null, cellResults.map(function(r) { return r.bumpContrast; }));
    var avgBump = cellResults.reduce(function(s, r) { return s + r.bumpContrast; }, 0) / cellResults.length;
    
    if (best.bumpContrast > Math.max(8, avgBump * 1.3) && best.score >= second.score * 1.1 && best.score > 6) {
      return best.cell;
    }
    if (best.bumpContrast > avgBump * 1.2 && Math.abs(best.score - second.score) < best.score * 0.15) {
      if (best.bumpContrast > second.bumpContrast) return best.cell;
    }
    if (best.bumpContrast > 6 && best.bumpContrast > second.bumpContrast * 1.3) {
      return best.cell;
    }
    if (maxBump > 5 && best.bumpContrast === maxBump && best.bumpContrast > avgBump * 1.6) {
      return best.cell;
    }
    
    return -1;
  }
  
  function detectAllNotches(imageData, size) {
    var notches = {
      top: detectNotchOnEdge(imageData, size, 'top'),
      right: detectNotchOnEdge(imageData, size, 'right'),
      bottom: detectNotchOnEdge(imageData, size, 'bottom'),
      left: detectNotchOnEdge(imageData, size, 'left')
    };
    
    var detected = 0;
    if (notches.top >= 0) detected++;
    if (notches.right >= 0) detected++;
    if (notches.bottom >= 0) detected++;
    if (notches.left >= 0) detected++;
    
    if (detected < 4) {
      log('Trying grayscale notch detection fallback...');
      var grayscale = new Uint8Array(size * size);
      for (var i = 0; i < size * size; i++) {
        var r = imageData.data[i * 4];
        var g = imageData.data[i * 4 + 1];
        var b = imageData.data[i * 4 + 2];
        grayscale[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }
      
      var grayNotches = {
        top: detectNotchOnEdgeGrayscale(grayscale, size, 'top'),
        right: detectNotchOnEdgeGrayscale(grayscale, size, 'right'),
        bottom: detectNotchOnEdgeGrayscale(grayscale, size, 'bottom'),
        left: detectNotchOnEdgeGrayscale(grayscale, size, 'left')
      };
      
      if (notches.top < 0 && grayNotches.top >= 0) { notches.top = grayNotches.top; detected++; log('  top: recovered via grayscale → ' + grayNotches.top); }
      if (notches.right < 0 && grayNotches.right >= 0) { notches.right = grayNotches.right; detected++; log('  right: recovered via grayscale → ' + grayNotches.right); }
      if (notches.bottom < 0 && grayNotches.bottom >= 0) { notches.bottom = grayNotches.bottom; detected++; log('  bottom: recovered via grayscale → ' + grayNotches.bottom); }
      if (notches.left < 0 && grayNotches.left >= 0) { notches.left = grayNotches.left; detected++; log('  left: recovered via grayscale → ' + grayNotches.left); }
    }
    
    log('Notches detected: T=' + notches.top + ', R=' + notches.right + 
        ', B=' + notches.bottom + ', L=' + notches.left + ' (' + detected + '/4)');
    
    return { notches: notches, count: detected };
  }

  // ========== DIAGONAL DETECTION ==========
  
  function detectDiagonal(imageData, cx, cy, cellSize) {
    var margin = 0.3;
    var sR = Math.max(3, cellSize * 0.12);
    var offset = cellSize * (0.5 - margin);
    
    var tl = sampleRegion(imageData, cx - offset, cy - offset, sR);
    var tr = sampleRegion(imageData, cx + offset, cy - offset, sR);
    var bl = sampleRegion(imageData, cx - offset, cy + offset, sR);
    var br = sampleRegion(imageData, cx + offset, cy + offset, sR);
    
    var tlbrDist = colorDistance(tl, br);
    var trblDist = colorDistance(tr, bl);
    var tltrDist = colorDistance(tl, tr);
    var tlblDist = colorDistance(tl, bl);
    var maxDist = Math.max(tlbrDist, trblDist, tltrDist, tlblDist);
    
    // More conservative: require higher contrast for diagonal detection
    // This helps with printed images where solid colors may have gradients
    if (maxDist < 80) return { type: 'solid' };
    
    // For a true diagonal, one diagonal pair should be similar (low distance)
    // and the other should be very different (high distance)
    var minDiagDist = Math.min(tlbrDist, trblDist);
    var maxDiagDist = Math.max(tlbrDist, trblDist);
    
    // The similar diagonal should be very similar (corners are same color)
    // The different diagonal should be very different (corners are opposite colors)
    // More strict ratio and absolute thresholds for printed images
    var ratio = minDiagDist / Math.max(maxDiagDist, 1);
    
    // Require: low ratio (diagonals very different), high max, low min
    // Note: maxDiagDist lowered from 120 to 90 for printed image support
    if (ratio > 0.35 || minDiagDist > 40 || maxDiagDist < 90) {
      return { type: 'solid' };
    }
    
    // Additional check: the cross-diagonal distances (tl-tr, tl-bl) should be moderate
    // For a true diagonal split, these should be between the two diagonal distances
    var avgCross = (tltrDist + tlblDist) / 2;
    if (avgCross < minDiagDist * 0.5 || avgCross > maxDiagDist * 1.2) {
      return { type: 'solid' };
    }
    
    return tlbrDist < trblDist ? { type: 'black' } : { type: 'white' };
  }

  // ========== CIELAB COLOR SPACE ==========
  
  function rgbToXyz(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    r *= 100; g *= 100; b *= 100;
    var x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
    var y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
    var z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
    return [x, y, z];
  }
  
  function xyzToLab(x, y, z) {
    var refX = 95.047, refY = 100.0, refZ = 108.883;
    x /= refX; y /= refY; z /= refZ;
    x = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + (16/116);
    y = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + (16/116);
    z = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + (16/116);
    var L = (116 * y) - 16;
    var a = 500 * (x - y);
    var bVal = 200 * (y - z);
    return [L, a, bVal];
  }
  
  function rgbToLab(r, g, b) {
    var xyz = rgbToXyz(r, g, b);
    return xyzToLab(xyz[0], xyz[1], xyz[2]);
  }
  
  function labDistance(lab1, lab2) {
    var dL = (lab1[0] - lab2[0]) * 0.5;
    var da = lab1[1] - lab2[1];
    var db = lab1[2] - lab2[2];
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  // ========== COLOR CONSTANTS ==========
  
  var TARGET_COLORS_RGB = {
    R: [255, 0, 0],
    G: [0, 255, 0],
    B: [0, 0, 255],
    C: [0, 255, 255],
    M: [255, 0, 255],
    Y: [255, 255, 0]
  };
  
  var TARGET_COLORS_LAB = {};
  Object.keys(TARGET_COLORS_RGB).forEach(function(k) {
    var rgb = TARGET_COLORS_RGB[k];
    TARGET_COLORS_LAB[k] = rgbToLab(rgb[0], rgb[1], rgb[2]);
  });
  
  var COLOR_TO_BITS = { R: '100', G: '010', B: '001', C: '011', M: '101', Y: '110' };
  var BITS_TO_COLOR = { '100': 'R', '010': 'G', '001': 'B', '011': 'C', '101': 'M', '110': 'Y' };

  // ========== ADAPTIVE COLOR CLUSTERING ==========
  
  function clusterColors(samples) {
    if (samples.length === 0) return [];
    
    var clusters = [];
    var clusterThreshold = 25;
    
    samples.forEach(function(s) {
      var nearestCluster = null;
      var nearestDist = Infinity;
      
      clusters.forEach(function(c) {
        var dist = labDistance(s.lab, c.centroid);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestCluster = c;
        }
      });
      
      if (nearestCluster && nearestDist < clusterThreshold) {
        nearestCluster.members.push(s);
        var n = nearestCluster.members.length;
        nearestCluster.centroid = [
          nearestCluster.members.reduce(function(sum, m) { return sum + m.lab[0]; }, 0) / n,
          nearestCluster.members.reduce(function(sum, m) { return sum + m.lab[1]; }, 0) / n,
          nearestCluster.members.reduce(function(sum, m) { return sum + m.lab[2]; }, 0) / n
        ];
      } else {
        clusters.push({
          centroid: s.lab.slice(),
          members: [s],
          assignedColor: null
        });
      }
    });
    
    return clusters;
  }
  
  function assignColorsToClustersByRelativePosition(clusters) {
    if (clusters.length === 0) return;
    
    clusters.forEach(function(c) {
      c.colorDistances = {};
      c.colorRankings = [];
      
      Object.keys(TARGET_COLORS_LAB).forEach(function(colorName) {
        var dist = labDistance(c.centroid, TARGET_COLORS_LAB[colorName]);
        c.colorDistances[colorName] = dist;
        c.colorRankings.push({ color: colorName, dist: dist });
      });
      
      c.colorRankings.sort(function(a, b) { return a.dist - b.dist; });
    });
    
    var assignedColors = {};
    var assignedClusters = {};
    
    // First pass: assign clear winners
    clusters.forEach(function(c, idx) {
      var best = c.colorRankings[0];
      var second = c.colorRankings[1];
      
      if (best.dist < 50 && (second.dist - best.dist) > 20) {
        if (!assignedColors[best.color]) {
          c.assignedColor = best.color;
          c.avgDistFromIdeal = best.dist;
          assignedColors[best.color] = true;
          assignedClusters[idx] = true;
        }
      }
    });
    
    // Second pass: assign remaining
    clusters.forEach(function(c, idx) {
      if (assignedClusters[idx]) return;
      
      for (var i = 0; i < c.colorRankings.length; i++) {
        var candidate = c.colorRankings[i];
        if (!assignedColors[candidate.color]) {
          c.assignedColor = candidate.color;
          c.avgDistFromIdeal = candidate.dist;
          assignedColors[candidate.color] = true;
          assignedClusters[idx] = true;
          
          if (i === 0 && c.colorRankings[1] && c.colorRankings[1].dist - candidate.dist < 15) {
            c.ambiguous = true;
            c.alternatives = [c.colorRankings[1].color];
          }
          break;
        }
      }
    });
    
    // Special handling for shifted colors
    clusters.forEach(function(c) {
      if (c.assignedColor === 'C' && c.centroid[2] > 10) {
        if (!assignedColors['G']) {
          log('  Reassigning cluster from C to G (positive b*)');
          assignedColors['C'] = false;
          c.assignedColor = 'G';
          assignedColors['G'] = true;
        } else {
          c.ambiguous = true;
          c.alternatives = ['G'];
        }
      }
      
      if (c.assignedColor === 'M' && c.centroid[1] < 60 && c.centroid[2] > -30) {
        if (!assignedColors['R']) {
          c.ambiguous = true;
          c.alternatives = ['R'];
        }
      }
    });
  }
  
  function findNearestColor(lab) {
    var best = null;
    var bestDist = Infinity;
    
    Object.keys(TARGET_COLORS_LAB).forEach(function(colorName) {
      var dist = labDistance(lab, TARGET_COLORS_LAB[colorName]);
      if (dist < bestDist) {
        bestDist = dist;
        best = colorName;
      }
    });
    
    return { color: best, dist: bestDist };
  }
  
  function findSecondNearestColor(lab, excludeColor) {
    var best = null;
    var bestDist = Infinity;
    
    Object.keys(TARGET_COLORS_LAB).forEach(function(colorName) {
      if (colorName === excludeColor) return;
      var dist = labDistance(lab, TARGET_COLORS_LAB[colorName]);
      if (dist < bestDist) {
        bestDist = dist;
        best = colorName;
      }
    });
    
    return best ? { color: best, dist: bestDist } : null;
  }
  
  function calibrateColorsFromGrid(samples, imageData, size) {
    var labSamples = [];
    samples.forEach(function(s, idx) {
      if (s.isDiagonal) {
        labSamples.push({ sample: s, isDiagonal: true, idx: idx });
      } else {
        var lab = rgbToLab(s.r, s.g, s.b);
        labSamples.push({ 
          sample: s, 
          lab: lab, 
          idx: idx,
          isDiagonal: false,
          rgb: [s.r, s.g, s.b]
        });
      }
    });
    
    var nonDiagonalSamples = labSamples.filter(function(ls) { return !ls.isDiagonal; });
    var clusters = clusterColors(nonDiagonalSamples);
    
    log('=== Color Clustering ===');
    log('Found ' + clusters.length + ' distinct color clusters');
    clusters.forEach(function(c, i) {
      log('  Cluster ' + i + ': ' + c.assignedColor + ' (n=' + c.members.length + 
          ', centroid L=' + c.centroid[0].toFixed(1) + ' a=' + c.centroid[1].toFixed(1) + ' b=' + c.centroid[2].toFixed(1) + ')');
    });
    
    assignColorsToClustersByRelativePosition(clusters);
    
    log('=== Cluster Assignments ===');
    clusters.forEach(function(c) {
      log('  ' + c.assignedColor + ': cells ' + c.members.map(function(m) { 
        return '[' + Math.floor(m.idx/4) + ',' + (m.idx%4) + ']'; 
      }).join(', '));
    });
    
    var assignments = labSamples.map(function(ls) {
      if (ls.isDiagonal) {
        return {
          sample: ls.sample,
          color: ls.sample.bits === '111' ? 'W' : 'K',
          bits: ls.sample.bits,
          confidence: 100,
          ambiguous: false,
          alternatives: []
        };
      }
      
      var myCluster = null;
      clusters.forEach(function(c) {
        c.members.forEach(function(m) {
          if (m.idx === ls.idx) myCluster = c;
        });
      });
      
      if (myCluster) {
        return {
          sample: ls.sample,
          lab: ls.lab,
          color: myCluster.assignedColor,
          bits: COLOR_TO_BITS[myCluster.assignedColor],
          confidence: 100 - myCluster.avgDistFromIdeal,
          ambiguous: myCluster.ambiguous || false,
          alternatives: myCluster.alternatives || []
        };
      }
      
      var best = findNearestColor(ls.lab);
      var secondBest = findSecondNearestColor(ls.lab, best.color);
      var isAmbiguous = (secondBest && (secondBest.dist - best.dist) < 20);
      
      return {
        sample: ls.sample,
        lab: ls.lab,
        color: best.color,
        bits: COLOR_TO_BITS[best.color],
        confidence: 100 - best.dist,
        ambiguous: isAmbiguous,
        alternatives: isAmbiguous && secondBest ? [secondBest.color] : []
      };
    });
    
    log('=== Final Assignments ===');
    assignments.forEach(function(a, idx) {
      if (!labSamples[idx].isDiagonal) {
        var row = Math.floor(idx / 4), col = idx % 4;
        log('Cell [' + row + ',' + col + ']: ' + a.color + ' (' + a.bits + ')' + 
            (a.ambiguous ? ' ⚠️' : ''));
      }
    });
    
    return assignments;
  }

  // ========== GRID DECODING ==========
  
  function decodeGridWithValidation(imageData, size) {
    var cellSize = size / 4;
    var samples = [];
    
    for (var row = 0; row < 4; row++) {
      for (var col = 0; col < 4; col++) {
        var cx = (col + 0.5) * cellSize;
        var cy = (row + 0.5) * cellSize;
        var color = sampleRegion(imageData, cx, cy, cellSize * 0.2);
        var diagonal = detectDiagonal(imageData, cx, cy, cellSize);
        samples.push({ row: row, col: col, cx: cx, cy: cy, r: color[0], g: color[1], b: color[2], diagonal: diagonal });
      }
    }
    
    samples.forEach(function(s) {
      if (s.diagonal.type === 'white') {
        s.bits = '111'; s.name = 'White ↘'; s.isDiagonal = true;
      } else if (s.diagonal.type === 'black') {
        s.bits = '000'; s.name = 'Black ↙'; s.isDiagonal = true;
      } else {
        s.isDiagonal = false;
      }
    });
    
    var assignments = calibrateColorsFromGrid(samples, imageData, size);
    
    assignments.forEach(function(a, idx) {
      if (!samples[idx].isDiagonal) {
        samples[idx].bits = a.bits;
        samples[idx].name = a.color;
        samples[idx].confidence = a.confidence;
        samples[idx].ambiguous = a.ambiguous;
        samples[idx].alternatives = a.alternatives;
      }
    });
    
    var bits = samples.map(function(s) { return s.bits; }).join('');
    
    var notchResult = detectAllNotches(imageData, size);
    var expectedCrc = crc8(bits);
    var expectedNotches = crcToNotches(expectedCrc);
    
    var matches = 0, comparisons = 0;
    if (notchResult.notches.top >= 0) { comparisons++; if (notchResult.notches.top === expectedNotches.top) matches++; }
    if (notchResult.notches.right >= 0) { comparisons++; if (notchResult.notches.right === expectedNotches.right) matches++; }
    if (notchResult.notches.bottom >= 0) { comparisons++; if (notchResult.notches.bottom === expectedNotches.bottom) matches++; }
    if (notchResult.notches.left >= 0) { comparisons++; if (notchResult.notches.left === expectedNotches.left) matches++; }
    
    var valid = (matches === 4 && comparisons === 4);
    
    log('Detected notches: T=' + notchResult.notches.top + ' R=' + notchResult.notches.right + 
        ' B=' + notchResult.notches.bottom + ' L=' + notchResult.notches.left + ' (' + notchResult.count + '/4)');
    log('Expected notches: T=' + expectedNotches.top + ' R=' + expectedNotches.right + 
        ' B=' + expectedNotches.bottom + ' L=' + expectedNotches.left);
    log('Validation: ' + matches + '/' + comparisons + ' match → ' + (valid ? 'VALID ✓' : 'invalid'));
    
    if (!valid && comparisons >= 2) {
      log('=== Trying alternative assignments ===');
      var altResult = tryAlternativeAssignments(samples, notchResult);
      if (altResult) return altResult;
    }
    
    return {
      bits: bits,
      samples: samples,
      notchResult: notchResult,
      expectedNotches: expectedNotches,
      valid: valid,
      matches: matches,
      comparisons: comparisons,
      rotation: 0
    };
  }
  
  function tryAlternativeAssignments(samples, notchResult) {
    var ambiguousCells = [];
    samples.forEach(function(s, idx) {
      if (s.ambiguous && s.alternatives && s.alternatives.length > 0) {
        ambiguousCells.push({ idx: idx, original: s.bits, alternatives: s.alternatives });
      }
    });
    
    if (ambiguousCells.length === 0) {
      log('No ambiguous cells to try');
      return null;
    }
    
    log('Found ' + ambiguousCells.length + ' ambiguous cells');
    
    var maxTries = Math.min(32, Math.pow(2, ambiguousCells.length));
    
    for (var tryNum = 1; tryNum < maxTries; tryNum++) {
      var testSamples = samples.map(function(s) { return Object.assign({}, s); });
      var changes = [];
      
      for (var i = 0; i < ambiguousCells.length; i++) {
        var useAlt = (tryNum >> i) & 1;
        if (useAlt) {
          var cell = ambiguousCells[i];
          var altColor = cell.alternatives[0];
          var altBits = COLOR_TO_BITS[altColor];
          if (altBits) {
            testSamples[cell.idx].bits = altBits;
            testSamples[cell.idx].name = altColor;
            changes.push('[' + Math.floor(cell.idx/4) + ',' + (cell.idx%4) + ']→' + altColor);
          }
        }
      }
      
      var testBits = testSamples.map(function(s) { return s.bits; }).join('');
      var testCrc = crc8(testBits);
      var testExpected = crcToNotches(testCrc);
      
      var testMatches = 0, testComparisons = 0;
      if (notchResult.notches.top >= 0) { testComparisons++; if (notchResult.notches.top === testExpected.top) testMatches++; }
      if (notchResult.notches.right >= 0) { testComparisons++; if (notchResult.notches.right === testExpected.right) testMatches++; }
      if (notchResult.notches.bottom >= 0) { testComparisons++; if (notchResult.notches.bottom === testExpected.bottom) testMatches++; }
      if (notchResult.notches.left >= 0) { testComparisons++; if (notchResult.notches.left === testExpected.left) testMatches++; }
      
      if (testMatches === 4 && testComparisons === 4) {
        log('✓ Found valid alternative: ' + changes.join(', '));
        return {
          bits: testBits,
          samples: testSamples,
          notchResult: notchResult,
          expectedNotches: testExpected,
          valid: true,
          matches: testMatches,
          comparisons: testComparisons,
          rotation: 0
        };
      }
    }
    
    log('No valid alternatives found');
    return null;
  }
  
  function rotateImageData90(imageData) {
    var size = imageData.width;
    var rotated = new ImageData(size, size);
    
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var srcIdx = (y * size + x) * 4;
        var newX = size - 1 - y;
        var newY = x;
        var dstIdx = (newY * size + newX) * 4;
        rotated.data[dstIdx] = imageData.data[srcIdx];
        rotated.data[dstIdx + 1] = imageData.data[srcIdx + 1];
        rotated.data[dstIdx + 2] = imageData.data[srcIdx + 2];
        rotated.data[dstIdx + 3] = imageData.data[srcIdx + 3];
      }
    }
    
    return rotated;
  }
  
  function bitsToHex(bits) {
    var hex = '';
    for (var i = 0; i + 4 <= bits.length; i += 4) {
      hex += parseInt(bits.substr(i, 4), 2).toString(16).toUpperCase();
    }
    return hex;
  }

  // ========== HIGH-LEVEL API ==========
  
  function decodeFromCorrectedImage(correctedImageData) {
    var size = correctedImageData.width;
    var result = null;
    var firstResult = null;
    var currentData = correctedImageData;
    
    for (var rotation = 0; rotation < 360; rotation += 90) {
      if (rotation > 0) {
        log('Rotated to ' + rotation + '°');
        currentData = rotateImageData90(currentData);
      }
      
      result = decodeGridWithValidation(currentData, size);
      
      if (rotation === 0) firstResult = result;
      
      if (result.valid) {
        result.rotation = rotation;
        result.hex = bitsToHex(result.bits);
        return result;
      }
    }
    
    log('No valid rotation found, returning to original orientation');
    firstResult.rotation = 0;
    firstResult.hex = bitsToHex(firstResult.bits);
    return firstResult;
  }
  
  function detectCorners(imageData, clickX, clickY, options) {
    options = options || {};
    var numRays = options.numRays || 360;
    
    var edgePoints = castRays(imageData, clickX, clickY, numRays);
    
    if (edgePoints.length < 20) {
      log('Not enough edge points');
      return null;
    }
    
    var corners = fitQuadrilateral(edgePoints);
    if (!corners) {
      log('Could not fit quadrilateral');
      return null;
    }
    
    corners.edgePoints = edgePoints;
    corners.grid = getGridCorners(corners, options.borderRatio || 0.08);
    
    return corners;
  }
  
  function scanFromClick(imageData, clickX, clickY, options) {
    options = options || {};
    var outputSize = options.outputSize || 400;
    
    log('Click at (' + Math.round(clickX) + ',' + Math.round(clickY) + ')');
    
    var corners = detectCorners(imageData, clickX, clickY, options);
    if (!corners) {
      return { error: 'Could not detect corners', corners: null };
    }
    
    if (typeof cv === 'undefined' || !cv.imread) {
      return { 
        error: 'OpenCV not available for perspective correction', 
        corners: corners,
        needsOpenCV: true
      };
    }
    
    try {
      var tempCanvas = document.createElement('canvas');
      tempCanvas.width = imageData.width;
      tempCanvas.height = imageData.height;
      var tempCtx = tempCanvas.getContext('2d');
      tempCtx.putImageData(imageData, 0, 0);
      
      var src = cv.imread(tempCanvas);
      var dst = new cv.Mat();
      
      var gc = corners.grid;
      var srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        gc.TL.x, gc.TL.y,
        gc.TR.x, gc.TR.y,
        gc.BR.x, gc.BR.y,
        gc.BL.x, gc.BL.y
      ]);
      var dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0, outputSize, 0, outputSize, outputSize, 0, outputSize
      ]);
      
      var M = cv.getPerspectiveTransform(srcPts, dstPts);
      cv.warpPerspective(src, dst, M, new cv.Size(outputSize, outputSize));
      
      log('Perspective correction applied');
      
      var outCanvas = document.createElement('canvas');
      outCanvas.width = outputSize;
      outCanvas.height = outputSize;
      cv.imshow(outCanvas, dst);
      
      var correctedData = outCanvas.getContext('2d').getImageData(0, 0, outputSize, outputSize);
      
      src.delete(); dst.delete(); srcPts.delete(); dstPts.delete(); M.delete();
      
      var result = decodeFromCorrectedImage(correctedData);
      result.corners = corners;
      result.correctedImageData = correctedData;
      
      return result;
      
    } catch (e) {
      log('Error: ' + e.message);
      return { error: 'Perspective correction failed: ' + e.message, corners: corners };
    }
  }

  // ========== EXPORT ==========
  
  global.RGB111Scanner = {
    version: __SCANNER_VERSION__,
    
    // High-level API
    scanFromClick: scanFromClick,
    detectCorners: detectCorners,
    decodeFromCorrectedImage: decodeFromCorrectedImage,
    
    // Low-level utilities
    castRays: castRays,
    fitQuadrilateral: fitQuadrilateral,
    convexHull: convexHull,
    getGridCorners: getGridCorners,
    decodeGridWithValidation: decodeGridWithValidation,
    detectAllNotches: detectAllNotches,
    detectDiagonal: detectDiagonal,
    
    // Color utilities
    rgbToLab: rgbToLab,
    labDistance: labDistance,
    clusterColors: clusterColors,
    calibrateColorsFromGrid: calibrateColorsFromGrid,
    findNearestColor: findNearestColor,
    
    // CRC utilities
    crc8: crc8,
    crcToNotches: crcToNotches,
    notchesToCrc: notchesToCrc,
    bitsToHex: bitsToHex,
    
    // Pixel utilities
    getPixel: getPixel,
    sampleRegion: sampleRegion,
    colorDistance: colorDistance,
    
    // Constants
    TARGET_COLORS_RGB: TARGET_COLORS_RGB,
    TARGET_COLORS_LAB: TARGET_COLORS_LAB,
    COLOR_TO_BITS: COLOR_TO_BITS,
    BITS_TO_COLOR: BITS_TO_COLOR,
    
    // Logging control
    setLogFunction: function(fn) { _logFn = fn; },
    disableLogging: function() { _logFn = null; }
  };
  
  try { console.log('[geosonify] scanner-lib ' + __SCANNER_VERSION__ + ' loaded (v65 extraction + printed image support)'); } catch(e) {}

})(typeof window !== 'undefined' ? window : this);