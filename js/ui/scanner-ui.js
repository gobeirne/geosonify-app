/**
 * geosonify-scanner-ui.js v2.0
 * 
 * ChromaCoord scanner UI using geosonify-scanner-lib_v1_0.js
 * 
 * Provides photo and camera scanning with:
 * - Ray-casting edge detection
 * - Quadrilateral corner fitting
 * - OpenCV perspective correction
 * - CRC-8 validation
 * 
 * Requires: geosonify-scanner-lib_v1_0.js, OpenCV.js (loaded on demand)
 * 
 * Usage:
 *   ScannerUI.onDecode(callback);
 *   ScannerUI.showPhotoScanner();
 *   ScannerUI.showCameraScanner();
 */

(function(global) {
  'use strict';

  // ============== STATE ==============

  let decodeCallback = null;
  let currentModal = null;
  let currentStream = null;
  let cvReady = false;
  let cvLoading = false;

  // ============== OPENCV LOADER ==============

  function loadOpenCV(callback) {
    if (cvReady) {
      callback(true);
      return;
    }
    
    if (typeof cv !== 'undefined' && cv.Mat) {
      cvReady = true;
      callback(true);
      return;
    }
    
    if (cvLoading) {
      var checkInterval = setInterval(function() {
        if (cvReady) {
          clearInterval(checkInterval);
          callback(true);
        }
      }, 100);
      return;
    }
    
    cvLoading = true;
    
    global.onOpenCvReady = function() {
      cvReady = true;
      cvLoading = false;
      console.log('[ScannerUI] OpenCV ready');
      callback(true);
    };
    
    var script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.x/opencv.js';
    script.async = true;
    script.onerror = function() {
      cvLoading = false;
      console.warn('[ScannerUI] OpenCV failed to load');
      callback(false);
    };
    document.head.appendChild(script);
  }

  // ============== MODAL HELPERS ==============

  function createModal() {
    var modal = document.createElement('div');
    modal.className = 'scanner-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:10000;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;';
    return modal;
  }

  function closeModal() {
    if (currentStream) {
      currentStream.getTracks().forEach(function(t) { t.stop(); });
      currentStream = null;
    }
    if (currentModal) {
      currentModal.remove();
      currentModal = null;
    }
  }

  // ============== VISUALIZATION ==============

  function drawDetection(ctx, clickX, clickY, edgePoints, corners, gridCorners) {
    // Draw rays and edge points
    if (edgePoints && edgePoints.length > 0) {
      for (var i = 0; i < edgePoints.length; i++) {
        var p = edgePoints[i];
        ctx.strokeStyle = p.isOutlier ? 'rgba(255, 0, 0, 0.3)' : 'rgba(0, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(clickX, clickY);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
    
    // Draw click point
    ctx.fillStyle = '#0f0';
    ctx.beginPath();
    ctx.arc(clickX, clickY, 6, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw outer corners (red)
    if (corners) {
      ctx.strokeStyle = '#f00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(corners.TL.x, corners.TL.y);
      ctx.lineTo(corners.TR.x, corners.TR.y);
      ctx.lineTo(corners.BR.x, corners.BR.y);
      ctx.lineTo(corners.BL.x, corners.BL.y);
      ctx.closePath();
      ctx.stroke();
      
      // Corner markers
      ctx.fillStyle = '#f00';
      ['TL', 'TR', 'BR', 'BL'].forEach(function(k) {
        ctx.beginPath();
        ctx.arc(corners[k].x, corners[k].y, 5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    
    // Draw grid corners (cyan)
    if (gridCorners) {
      ctx.strokeStyle = '#0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(gridCorners.TL.x, gridCorners.TL.y);
      ctx.lineTo(gridCorners.TR.x, gridCorners.TR.y);
      ctx.lineTo(gridCorners.BR.x, gridCorners.BR.y);
      ctx.lineTo(gridCorners.BL.x, gridCorners.BL.y);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // ============== CORE DECODING ==============

  function decodeFromCorners(imageData, gridCorners, correctedCanvas, callback) {
    var outputSize = 400;
    correctedCanvas.width = outputSize;
    correctedCanvas.height = outputSize;
    
    if (!cvReady || typeof cv === 'undefined') {
      callback({ error: 'OpenCV not ready' });
      return;
    }
    
    try {
      // Create a canvas from the imageData
      var srcCanvas = document.createElement('canvas');
      srcCanvas.width = imageData.width;
      srcCanvas.height = imageData.height;
      var srcCtx = srcCanvas.getContext('2d');
      srcCtx.putImageData(imageData, 0, 0);
      
      // Perspective transform using OpenCV
      var src = cv.imread(srcCanvas);
      var dst = new cv.Mat();
      
      var srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        gridCorners.TL.x, gridCorners.TL.y,
        gridCorners.TR.x, gridCorners.TR.y,
        gridCorners.BR.x, gridCorners.BR.y,
        gridCorners.BL.x, gridCorners.BL.y
      ]);
      var dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0, outputSize, 0, outputSize, outputSize, 0, outputSize
      ]);
      
      var M = cv.getPerspectiveTransform(srcPts, dstPts);
      cv.warpPerspective(src, dst, M, new cv.Size(outputSize, outputSize));
      cv.imshow(correctedCanvas, dst);
      
      // Get corrected image data
      var corrCtx = correctedCanvas.getContext('2d', { willReadFrequently: true });
      var correctedData = corrCtx.getImageData(0, 0, outputSize, outputSize);
      
      // Use scanner library to decode
      var result = RGB111Scanner.decodeFromCorrectedImage(correctedData);
      
      src.delete(); dst.delete(); srcPts.delete(); dstPts.delete(); M.delete();
      
      callback(result);
      
    } catch (e) {
      console.error('[ScannerUI] Decode error:', e);
      callback({ error: e.message });
    }
  }

  function processClick(imageData, loadedImage, clickX, clickY, mainCanvas, correctedCanvas, statusEl, callback) {
    statusEl.textContent = 'Casting rays...';
    statusEl.style.color = '#ff0';
    
    // Check scanner library is loaded
    if (typeof RGB111Scanner === 'undefined') {
      statusEl.textContent = 'Scanner library not loaded';
      statusEl.style.color = '#f44';
      return;
    }
    
    // Cast rays to find edges
    var edgePoints = RGB111Scanner.castRays(imageData, clickX, clickY, 360);
    
    if (edgePoints.length < 8) {
      statusEl.textContent = 'Not enough border points found. Tap inside the colored grid.';
      statusEl.style.color = '#f44';
      return;
    }
    
    // Check outlier ratio
    var outlierCount = edgePoints.filter(function(p) { return p.isOutlier; }).length;
    var outlierRatio = outlierCount / edgePoints.length;
    
    if (outlierRatio > 0.3) {
      statusEl.textContent = 'Too many edge irregularities. Tap inside the colored grid.';
      statusEl.style.color = '#f44';
      return;
    }
    
    // Fit quadrilateral to find corners
    var validPoints = edgePoints.filter(function(p) { return !p.isOutlier && p.dist > 10; });
    var corners = RGB111Scanner.fitQuadrilateral(validPoints);
    
    if (!corners) {
      statusEl.textContent = 'Could not detect corners. Try tapping more centered.';
      statusEl.style.color = '#f44';
      return;
    }
    
    // Sanity check: corners should form a roughly square shape
    var edgeLengths = [
      Math.sqrt(Math.pow(corners.TR.x - corners.TL.x, 2) + Math.pow(corners.TR.y - corners.TL.y, 2)),
      Math.sqrt(Math.pow(corners.BR.x - corners.TR.x, 2) + Math.pow(corners.BR.y - corners.TR.y, 2)),
      Math.sqrt(Math.pow(corners.BL.x - corners.BR.x, 2) + Math.pow(corners.BL.y - corners.BR.y, 2)),
      Math.sqrt(Math.pow(corners.TL.x - corners.BL.x, 2) + Math.pow(corners.TL.y - corners.BL.y, 2))
    ];
    var minEdge = Math.min.apply(null, edgeLengths);
    var maxEdge = Math.max.apply(null, edgeLengths);
    var edgeRatio = maxEdge / minEdge;
    
    if (edgeRatio > 3) {
      statusEl.textContent = 'Detected shape too irregular. Try tapping more centered.';
      statusEl.style.color = '#f44';
      // Still draw what we found
      var ctx = mainCanvas.getContext('2d');
      if (loadedImage) {
        ctx.drawImage(loadedImage, 0, 0, mainCanvas.width, mainCanvas.height);
      }
      drawDetection(ctx, clickX, clickY, edgePoints, corners, null);
      return;
    }
    
    // Grid corners (detected corners ARE the grid)
    var gridCorners = {
      TL: { x: corners.TL.x, y: corners.TL.y },
      TR: { x: corners.TR.x, y: corners.TR.y },
      BR: { x: corners.BR.x, y: corners.BR.y },
      BL: { x: corners.BL.x, y: corners.BL.y }
    };
    
    // Draw visualization
    var ctx = mainCanvas.getContext('2d');
    if (loadedImage) {
      ctx.drawImage(loadedImage, 0, 0, mainCanvas.width, mainCanvas.height);
    }
    drawDetection(ctx, clickX, clickY, edgePoints, corners, gridCorners);
    
    // Wait for OpenCV before decoding
    statusEl.textContent = 'Loading perspective correction...';
    statusEl.style.color = '#0ff';
    
    loadOpenCV(function(ready) {
      if (!ready) {
        statusEl.textContent = 'Failed to load OpenCV. Try again.';
        statusEl.style.color = '#f44';
        return;
      }
      
      statusEl.textContent = 'Decoding...';
      statusEl.style.color = '#ff0';
      
      // Decode
      decodeFromCorners(imageData, gridCorners, correctedCanvas, function(result) {
        if (result.error) {
          statusEl.textContent = result.error;
          statusEl.style.color = '#f44';
          return;
        }
        
        var hex = result.hex || '';
        
        if (result.valid) {
          statusEl.textContent = 'Decoded: ' + hex + (result.rotation > 0 ? ' (rotated ' + result.rotation + '°)' : '') + ' ✓';
          statusEl.style.color = '#0f0';
          
          // Success! Call callback and close after delay
          setTimeout(function() {
            callback(hex, result);
            closeModal();
          }, 800);
          
        } else {
          statusEl.textContent = 'Partial decode: ' + hex + ' (tap again to retry)';
          statusEl.style.color = '#fa0';
        }
      });
    });
  }

  // ============== PHOTO SCANNER ==============

  function showPhotoScanner() {
    closeModal();
    
    currentModal = createModal();
    currentModal.innerHTML = 
      '<div style="color:#fff;font-size:18px;margin-bottom:16px;">📷 Scan ChromaCoord</div>' +
      '<input type="file" id="scannerFileInput" accept="image/*" style="display:none;">' +
      '<div id="scannerPreview" style="display:none;position:relative;max-width:90vw;max-height:50vh;">' +
        '<canvas id="scannerMainCanvas" style="max-width:100%;max-height:50vh;border-radius:12px;cursor:crosshair;"></canvas>' +
      '</div>' +
      '<canvas id="scannerCorrectedCanvas" width="400" height="400" style="display:none;"></canvas>' +
      '<div style="margin-top:12px;display:flex;gap:12px;">' +
        '<button id="scannerChooseBtn" style="padding:12px 24px;border-radius:10px;border:none;background:#007AFF;color:white;font-size:16px;cursor:pointer;">Choose Image</button>' +
        '<button id="scannerCancelBtn" style="padding:12px 24px;border-radius:10px;border:none;background:#333;color:white;font-size:16px;cursor:pointer;">Cancel</button>' +
      '</div>' +
      '<div id="scannerHint" style="color:#888;font-size:14px;margin-top:12px;">👆 Tap the colored grid</div>' +
      '<div id="scannerStatus" style="color:#aaa;font-size:14px;margin-top:8px;text-align:center;min-height:20px;"></div>';
    
    document.body.appendChild(currentModal);
    
    var fileInput = currentModal.querySelector('#scannerFileInput');
    var previewDiv = currentModal.querySelector('#scannerPreview');
    var mainCanvas = currentModal.querySelector('#scannerMainCanvas');
    var correctedCanvas = currentModal.querySelector('#scannerCorrectedCanvas');
    var hintEl = currentModal.querySelector('#scannerHint');
    var statusEl = currentModal.querySelector('#scannerStatus');
    var chooseBtn = currentModal.querySelector('#scannerChooseBtn');
    
    var loadedImage = null;
    var currentImageData = null;
    
    // Load OpenCV in background
    loadOpenCV(function(ready) {
      if (ready) {
        console.log('[ScannerUI] OpenCV loaded');
      }
    });
    
    chooseBtn.addEventListener('click', function() {
      fileInput.click();
    });
    
    currentModal.querySelector('#scannerCancelBtn').addEventListener('click', closeModal);
    
    fileInput.addEventListener('change', function() {
      var file = fileInput.files[0];
      if (!file) return;
      
      statusEl.textContent = 'Loading...';
      statusEl.style.color = '#aaa';
      
      loadedImage = new Image();
      loadedImage.onload = function() {
        var maxDim = 1200;
        var scale = Math.min(1, maxDim / Math.max(loadedImage.width, loadedImage.height));
        mainCanvas.width = Math.round(loadedImage.width * scale);
        mainCanvas.height = Math.round(loadedImage.height * scale);
        
        var ctx = mainCanvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(loadedImage, 0, 0, mainCanvas.width, mainCanvas.height);
        currentImageData = ctx.getImageData(0, 0, mainCanvas.width, mainCanvas.height);
        
        previewDiv.style.display = 'block';
        chooseBtn.textContent = 'Choose Different';
        hintEl.style.display = 'block';
        statusEl.textContent = '';
      };
      loadedImage.src = URL.createObjectURL(file);
    });
    
    mainCanvas.addEventListener('click', function(e) {
      if (!currentImageData) return;
      
      var rect = mainCanvas.getBoundingClientRect();
      var scaleX = mainCanvas.width / rect.width;
      var scaleY = mainCanvas.height / rect.height;
      var clickX = (e.clientX - rect.left) * scaleX;
      var clickY = (e.clientY - rect.top) * scaleY;
      
      processClick(currentImageData, loadedImage, clickX, clickY, mainCanvas, correctedCanvas, statusEl, function(hex, result) {
        if (decodeCallback) decodeCallback(hex, result);
      });
    });
  }

  // ============== CAMERA SCANNER ==============

  function showCameraScanner() {
    closeModal();
    
    currentModal = createModal();
    currentModal.innerHTML = 
      '<div style="color:#fff;font-size:18px;margin-bottom:16px;">📷 Scan ChromaCoord</div>' +
      '<div style="position:relative;max-width:90vw;max-height:60vh;">' +
        '<video id="scannerVideo" autoplay playsinline muted style="max-width:90vw;max-height:60vh;border-radius:12px;"></video>' +
        '<canvas id="scannerMainCanvas" style="display:none;"></canvas>' +
      '</div>' +
      '<canvas id="scannerCorrectedCanvas" width="400" height="400" style="display:none;"></canvas>' +
      '<div style="margin-top:12px;display:flex;gap:12px;">' +
        '<button id="scannerCaptureBtn" style="padding:12px 24px;border-radius:10px;border:none;background:#34C759;color:white;font-size:16px;cursor:pointer;">📸 Capture</button>' +
        '<button id="scannerCancelBtn" style="padding:12px 24px;border-radius:10px;border:none;background:#333;color:white;font-size:16px;cursor:pointer;">Cancel</button>' +
      '</div>' +
      '<div id="scannerHint" style="color:#888;font-size:14px;margin-top:12px;">Point at ChromaCoord, then tap Capture</div>' +
      '<div id="scannerStatus" style="color:#aaa;font-size:14px;margin-top:8px;text-align:center;min-height:20px;"></div>';
    
    document.body.appendChild(currentModal);
    
    var video = currentModal.querySelector('#scannerVideo');
    var mainCanvas = currentModal.querySelector('#scannerMainCanvas');
    var correctedCanvas = currentModal.querySelector('#scannerCorrectedCanvas');
    var hintEl = currentModal.querySelector('#scannerHint');
    var statusEl = currentModal.querySelector('#scannerStatus');
    var captureBtn = currentModal.querySelector('#scannerCaptureBtn');
    
    var frozen = false;
    var currentImageData = null;
    
    // Load OpenCV in background
    loadOpenCV(function(ready) {
      if (ready) {
        console.log('[ScannerUI] OpenCV loaded');
      }
    });
    
    // Start camera
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    }).then(function(stream) {
      currentStream = stream;
      video.srcObject = stream;
      
      video.onloadedmetadata = function() {
        mainCanvas.width = video.videoWidth;
        mainCanvas.height = video.videoHeight;
        statusEl.textContent = 'Camera ready';
      };
    }).catch(function(err) {
      statusEl.textContent = 'Camera error: ' + err.message;
      statusEl.style.color = '#f44';
    });
    
    captureBtn.addEventListener('click', function() {
      if (frozen) {
        // Unfreeze
        frozen = false;
        video.style.display = 'block';
        mainCanvas.style.display = 'none';
        captureBtn.textContent = '📸 Capture';
        hintEl.textContent = 'Point at ChromaCoord, then tap Capture';
        statusEl.textContent = '';
        return;
      }
      
      // Freeze frame
      frozen = true;
      var ctx = mainCanvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, mainCanvas.width, mainCanvas.height);
      currentImageData = ctx.getImageData(0, 0, mainCanvas.width, mainCanvas.height);
      
      video.style.display = 'none';
      mainCanvas.style.display = 'block';
      mainCanvas.style.maxWidth = '90vw';
      mainCanvas.style.maxHeight = '60vh';
      mainCanvas.style.borderRadius = '12px';
      mainCanvas.style.cursor = 'crosshair';
      
      captureBtn.textContent = '🔄 Retake';
      hintEl.textContent = '👆 Tap the colored grid to decode';
      statusEl.textContent = '';
    });
    
    mainCanvas.addEventListener('click', function(e) {
      if (!frozen || !currentImageData) return;
      
      var rect = mainCanvas.getBoundingClientRect();
      var scaleX = mainCanvas.width / rect.width;
      var scaleY = mainCanvas.height / rect.height;
      var clickX = (e.clientX - rect.left) * scaleX;
      var clickY = (e.clientY - rect.top) * scaleY;
      
      processClick(currentImageData, null, clickX, clickY, mainCanvas, correctedCanvas, statusEl, function(hex, result) {
        if (decodeCallback) decodeCallback(hex, result);
      });
    });
    
    currentModal.querySelector('#scannerCancelBtn').addEventListener('click', closeModal);
  }

  // ============== PUBLIC API ==============

  global.ScannerUI = {
    version: 'v2.0',
    
    onDecode: function(callback) {
      decodeCallback = callback;
    },
    
    showPhotoScanner: showPhotoScanner,
    showCameraScanner: showCameraScanner,
    
    close: closeModal,
    
    isOpenCVReady: function() {
      return cvReady;
    }
  };

})(typeof window !== 'undefined' ? window : this);
