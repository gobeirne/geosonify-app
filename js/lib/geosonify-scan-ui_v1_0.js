/*
  geosonify-scan-ui.v1.0.js
  ChromaCoord Scanner UI Integration
  
  Provides camera and image scanning UI for RGB111 codes.
  Uses RGB111Scanner for robust detection with perspective correction.
  
  Dependencies:
  - geosonify-scanner-lib (RGB111Scanner)
  - OpenCV.js (optional, for perspective correction)
  - geosonify-rgb111-lib (RGB111Lib, for validation)
  
  Usage:
    GeoScanUI.showScanModal('camera', callback);
    GeoScanUI.showScanModal('upload', callback);
*/
(function(global) {
  'use strict';
  var __SCAN_UI_VER__ = 'v1.0';
  try { console.log('[geosonify] scan-ui ' + __SCAN_UI_VER__ + ' loaded'); } catch(e){}

  // ========== STATE ==========
  var cvReady = false;
  var cvLoading = false;
  
  // ========== OPENCV LOADER ==========
  
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
      // Wait for existing load
      var checkInterval = setInterval(function() {
        if (cvReady) {
          clearInterval(checkInterval);
          callback(true);
        }
      }, 100);
      return;
    }
    
    cvLoading = true;
    
    // Set up callback before loading
    global.onOpenCvReady = function() {
      cvReady = true;
      cvLoading = false;
      console.log('[geosonify] OpenCV.js ready');
      callback(true);
    };
    
    var script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.5.5/opencv.js';
    script.async = true;
    script.onerror = function() {
      cvLoading = false;
      console.warn('[geosonify] OpenCV.js failed to load - using basic decoder');
      callback(false);
    };
    document.head.appendChild(script);
  }

  // ========== TOAST HELPER ==========
  
  function showToast(msg, duration) {
    duration = duration || 2000;
    var existing = document.querySelector('.scan-toast');
    if (existing) existing.remove();
    
    var toast = document.createElement('div');
    toast.className = 'scan-toast';
    toast.textContent = msg;
    toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);' +
      'background:rgba(0,0,0,0.85);color:white;padding:12px 24px;border-radius:24px;' +
      'font-size:14px;z-index:10000;pointer-events:none;animation:fadeIn 0.2s;';
    document.body.appendChild(toast);
    
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(function() { toast.remove(); }, 300);
    }, duration);
  }

  // ========== MODAL CREATION ==========
  
  function createModal() {
    var modal = document.createElement('div');
    modal.className = 'scan-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:5000;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;';
    return modal;
  }
  
  function closeModal(modal, stream) {
    if (stream) {
      stream.getTracks().forEach(function(t) { t.stop(); });
    }
    modal.remove();
  }

  // ========== CAMERA SCANNING ==========
  
  function showCameraModal(callback) {
    var modal = createModal();
    modal.innerHTML = 
      '<div style="color:white;text-align:center;margin-bottom:16px;font-size:18px;">Tap on the ChromaCoord to scan</div>' +
      '<div style="position:relative;max-width:90vw;max-height:60vh;">' +
        '<video id="scanVideo" autoplay playsinline style="max-width:90vw;max-height:60vh;border-radius:12px;"></video>' +
        '<canvas id="scanOverlay" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;"></canvas>' +
      '</div>' +
      '<canvas id="scanCanvas" style="display:none;"></canvas>' +
      '<div id="scanStatus" style="color:#aaa;margin-top:12px;font-size:14px;">Initializing camera...</div>' +
      '<div style="display:flex;gap:12px;margin-top:20px;">' +
        '<button id="autoScanBtn" style="padding:12px 24px;border-radius:10px;border:none;background:#007AFF;color:white;font-size:16px;cursor:pointer;">Auto Scan</button>' +
        '<button id="closeScanBtn" style="padding:12px 24px;border-radius:10px;border:none;background:#333;color:white;font-size:16px;cursor:pointer;">Cancel</button>' +
      '</div>';
    
    document.body.appendChild(modal);
    
    var video = modal.querySelector('#scanVideo');
    var canvas = modal.querySelector('#scanCanvas');
    var overlay = modal.querySelector('#scanOverlay');
    var status = modal.querySelector('#scanStatus');
    var stream = null;
    var autoScanning = false;
    var autoScanInterval = null;
    
    // Start camera
    navigator.mediaDevices.getUserMedia({ 
      video: { 
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      } 
    })
    .then(function(s) {
      stream = s;
      video.srcObject = stream;
      video.onloadedmetadata = function() {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
        status.textContent = 'Tap on code to scan, or use Auto Scan';
      };
    })
    .catch(function(err) {
      status.textContent = 'Camera error: ' + err.message;
    });
    
    // Click-to-scan
    video.addEventListener('click', function(e) {
      if (!stream) return;
      
      var rect = video.getBoundingClientRect();
      var scaleX = video.videoWidth / rect.width;
      var scaleY = video.videoHeight / rect.height;
      var clickX = (e.clientX - rect.left) * scaleX;
      var clickY = (e.clientY - rect.top) * scaleY;
      
      // Capture frame
      var ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      status.textContent = 'Processing...';
      
      // Try scanner
      if (typeof RGB111Scanner !== 'undefined') {
        var result = RGB111Scanner.scanFromClick(imageData, clickX, clickY, { outputSize: 400 });
        
        if (result && result.hex) {
          // Draw detection overlay
          drawDetectionOverlay(overlay, result.corners);
          
          if (result.valid) {
            status.textContent = 'Decoded: ' + result.hex;
            setTimeout(function() {
              closeModal(modal, stream);
              callback(result.hex, result);
            }, 500);
            return;
          } else {
            status.textContent = 'Detected but CRC failed - tap to try again';
            showToast('CRC validation failed', 1500);
          }
        } else {
          status.textContent = 'No code detected - tap inside the colored grid';
        }
      } else {
        status.textContent = 'Scanner not loaded';
      }
    });
    
    // Auto-scan mode
    modal.querySelector('#autoScanBtn').addEventListener('click', function() {
      if (autoScanning) {
        autoScanning = false;
        if (autoScanInterval) clearInterval(autoScanInterval);
        this.textContent = 'Auto Scan';
        this.style.background = '#007AFF';
        status.textContent = 'Auto scan stopped';
        return;
      }
      
      autoScanning = true;
      this.textContent = 'Stop';
      this.style.background = '#FF3B30';
      status.textContent = 'Auto scanning...';
      
      autoScanInterval = setInterval(function() {
        if (!autoScanning || !stream) return;
        
        var ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0);
        
        // Try center click
        var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var centerX = canvas.width / 2;
        var centerY = canvas.height / 2;
        
        if (typeof RGB111Scanner !== 'undefined') {
          var result = RGB111Scanner.scanFromClick(imageData, centerX, centerY, { outputSize: 400 });
          
          if (result && result.hex && result.valid) {
            autoScanning = false;
            clearInterval(autoScanInterval);
            status.textContent = 'Decoded: ' + result.hex;
            drawDetectionOverlay(overlay, result.corners);
            
            setTimeout(function() {
              closeModal(modal, stream);
              callback(result.hex, result);
            }, 500);
          }
        }
      }, 200);
    });
    
    // Close
    modal.querySelector('#closeScanBtn').addEventListener('click', function() {
      autoScanning = false;
      if (autoScanInterval) clearInterval(autoScanInterval);
      closeModal(modal, stream);
    });
  }
  
  function drawDetectionOverlay(overlay, corners) {
    if (!corners) return;
    
    var ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    
    // Draw outer corners
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(corners.TL.x, corners.TL.y);
    ctx.lineTo(corners.TR.x, corners.TR.y);
    ctx.lineTo(corners.BR.x, corners.BR.y);
    ctx.lineTo(corners.BL.x, corners.BL.y);
    ctx.closePath();
    ctx.stroke();
    
    // Draw grid corners if available
    if (corners.grid) {
      ctx.strokeStyle = '#00FFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(corners.grid.TL.x, corners.grid.TL.y);
      ctx.lineTo(corners.grid.TR.x, corners.grid.TR.y);
      ctx.lineTo(corners.grid.BR.x, corners.grid.BR.y);
      ctx.lineTo(corners.grid.BL.x, corners.grid.BL.y);
      ctx.closePath();
      ctx.stroke();
    }
    
    // Draw corner markers
    ctx.fillStyle = '#FF0000';
    ['TL', 'TR', 'BR', 'BL'].forEach(function(k) {
      ctx.beginPath();
      ctx.arc(corners[k].x, corners[k].y, 6, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ========== IMAGE UPLOAD SCANNING ==========
  
  function showUploadModal(callback) {
    var modal = createModal();
    modal.innerHTML = 
      '<div style="color:white;text-align:center;margin-bottom:16px;font-size:18px;">Select ChromaCoord Image</div>' +
      '<input type="file" id="chromaFileInput" accept="image/*" style="display:none;">' +
      '<div id="imagePreview" style="max-width:90vw;max-height:50vh;display:none;position:relative;">' +
        '<canvas id="previewCanvas" style="max-width:100%;max-height:50vh;border-radius:12px;cursor:crosshair;"></canvas>' +
        '<canvas id="previewOverlay" style="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;"></canvas>' +
      '</div>' +
      '<div id="uploadButtons" style="display:flex;gap:12px;margin-top:20px;">' +
        '<button id="selectFileBtn" style="padding:16px 32px;border-radius:10px;border:none;background:#007AFF;color:white;font-size:16px;cursor:pointer;">Choose Image</button>' +
      '</div>' +
      '<div id="uploadStatus" style="color:#aaa;margin-top:12px;font-size:14px;text-align:center;"></div>' +
      '<button id="closeUploadBtn" style="margin-top:20px;padding:12px 24px;border-radius:10px;border:none;background:#333;color:white;font-size:16px;cursor:pointer;">Cancel</button>';
    
    document.body.appendChild(modal);
    
    var fileInput = modal.querySelector('#chromaFileInput');
    var previewDiv = modal.querySelector('#imagePreview');
    var canvas = modal.querySelector('#previewCanvas');
    var overlay = modal.querySelector('#previewOverlay');
    var buttons = modal.querySelector('#uploadButtons');
    var status = modal.querySelector('#uploadStatus');
    var loadedImage = null;
    var imageData = null;
    
    modal.querySelector('#selectFileBtn').addEventListener('click', function() {
      fileInput.click();
    });
    
    modal.querySelector('#closeUploadBtn').addEventListener('click', function() {
      closeModal(modal, null);
    });
    
    fileInput.addEventListener('change', function() {
      var file = fileInput.files[0];
      if (!file) return;
      
      status.textContent = 'Loading image...';
      
      loadedImage = new Image();
      loadedImage.onload = function() {
        // Store full resolution image for high-res click processing
        var fullCanvas = document.createElement('canvas');
        fullCanvas.width = loadedImage.width;
        fullCanvas.height = loadedImage.height;
        var fullCtx = fullCanvas.getContext('2d');
        fullCtx.drawImage(loadedImage, 0, 0);
        var fullImageData = fullCtx.getImageData(0, 0, fullCanvas.width, fullCanvas.height);
        
        // Size display canvas appropriately (scaled for display)
        var maxDim = 1200;
        var scale = Math.min(1, maxDim / Math.max(loadedImage.width, loadedImage.height));
        canvas.width = Math.round(loadedImage.width * scale);
        canvas.height = Math.round(loadedImage.height * scale);
        overlay.width = canvas.width;
        overlay.height = canvas.height;
        
        var ctx = canvas.getContext('2d');
        ctx.drawImage(loadedImage, 0, 0, canvas.width, canvas.height);
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // Store full res data and scale for click processing
        canvas._fullImageData = fullImageData;
        canvas._fullScale = 1 / scale;
        canvas._originalWidth = loadedImage.width;
        canvas._originalHeight = loadedImage.height;
        
        previewDiv.style.display = 'block';
        
        // Show image size info and zoom hint
        var sizeInfo = loadedImage.width > 2000 || loadedImage.height > 2000 ? 
          '<div style="font-size:12px;color:#FF9500;margin-bottom:8px;">Large image (' + loadedImage.width + '×' + loadedImage.height + 'px) - tap precisely on code center</div>' : '';
        
        buttons.innerHTML = sizeInfo +
          '<button id="autoDetectBtn" style="padding:12px 24px;border-radius:10px;border:none;background:#34C759;color:white;font-size:16px;cursor:pointer;">Auto Detect</button>' +
          '<button id="selectFileBtn" style="padding:12px 24px;border-radius:10px;border:none;background:#007AFF;color:white;font-size:16px;cursor:pointer;">Choose Different</button>';
        
        status.textContent = 'Click on the code, or use Auto Detect';
        
        // Re-attach file button
        buttons.querySelector('#selectFileBtn').addEventListener('click', function() {
          fileInput.click();
        });
        
        // Auto detect button
        buttons.querySelector('#autoDetectBtn').addEventListener('click', function() {
          tryAutoDetect();
        });
      };
      loadedImage.src = URL.createObjectURL(file);
    });
    
    // Click to scan - use full resolution for large images
    canvas.addEventListener('click', function(e) {
      if (!imageData) return;
      
      var rect = canvas.getBoundingClientRect();
      var scaleX = canvas.width / rect.width;
      var scaleY = canvas.height / rect.height;
      var clickX = (e.clientX - rect.left) * scaleX;
      var clickY = (e.clientY - rect.top) * scaleY;
      
      // Use full resolution image data if available
      var useImageData = imageData;
      var useClickX = clickX;
      var useClickY = clickY;
      
      if (canvas._fullImageData && canvas._fullScale > 1) {
        // Scale click coordinates to full resolution
        useImageData = canvas._fullImageData;
        useClickX = clickX * canvas._fullScale;
        useClickY = clickY * canvas._fullScale;
        status.textContent = 'Processing at full resolution...';
      } else {
        status.textContent = 'Processing...';
      }
      
      if (typeof RGB111Scanner !== 'undefined') {
        var result = RGB111Scanner.scanFromClick(useImageData, useClickX, useClickY, { outputSize: 400 });
        
        if (result && result.hex) {
          drawDetectionOverlay(overlay, result.corners);
          
          if (result.valid) {
            status.textContent = 'Decoded: ' + result.hex + ' ✓';
            status.style.color = '#34C759';
            setTimeout(function() {
              closeModal(modal, null);
              callback(result.hex, result);
            }, 800);
          } else {
            status.textContent = 'Detected: ' + result.hex + ' (CRC failed)';
            status.style.color = '#FF9500';
            
            // Allow accepting invalid result
            var acceptBtn = document.createElement('button');
            acceptBtn.textContent = 'Use Anyway';
            acceptBtn.style.cssText = 'margin-left:12px;padding:8px 16px;border-radius:8px;border:none;background:#FF9500;color:white;font-size:14px;cursor:pointer;';
            acceptBtn.addEventListener('click', function() {
              closeModal(modal, null);
              callback(result.hex, result);
            });
            status.appendChild(acceptBtn);
          }
        } else if (result && result.error) {
          status.textContent = result.error;
          status.style.color = '#FF3B30';
        } else {
          status.textContent = 'No code detected at that location';
          status.style.color = '#FF3B30';
        }
      } else {
        // Fallback to basic decoder
        tryBasicDecode();
      }
    });
    
    function tryAutoDetect() {
      if (!imageData) return;
      
      status.textContent = 'Auto detecting...';
      status.style.color = '#aaa';
      
      // Try multiple points
      var points = [
        [0.5, 0.5],   // Center
        [0.3, 0.3],   // Top-left area
        [0.7, 0.3],   // Top-right area
        [0.3, 0.7],   // Bottom-left area
        [0.7, 0.7]    // Bottom-right area
      ];
      
      for (var i = 0; i < points.length; i++) {
        var px = points[i][0] * canvas.width;
        var py = points[i][1] * canvas.height;
        
        if (typeof RGB111Scanner !== 'undefined') {
          var result = RGB111Scanner.scanFromClick(imageData, px, py, { outputSize: 400 });
          
          if (result && result.hex && result.valid) {
            drawDetectionOverlay(overlay, result.corners);
            status.textContent = 'Decoded: ' + result.hex + ' ✓';
            status.style.color = '#34C759';
            
            setTimeout(function() {
              closeModal(modal, null);
              callback(result.hex, result);
            }, 800);
            return;
          }
        }
      }
      
      // No valid detection
      status.textContent = 'Could not auto-detect. Click on the code to scan.';
      status.style.color = '#FF9500';
    }
    
    function tryBasicDecode() {
      // Fallback using RGB111Lib basic decoder
      if (typeof RGB111Lib !== 'undefined' && RGB111Lib.decodeFromCanvas) {
        var result = RGB111Lib.decodeFromCanvas(canvas, { gridSize: 4 });
        if (result && result.hex) {
          status.textContent = 'Decoded (basic): ' + result.hex;
          status.style.color = result.valid ? '#34C759' : '#FF9500';
          
          setTimeout(function() {
            closeModal(modal, null);
            callback(result.hex, result);
          }, 800);
          return;
        }
      }
      status.textContent = 'Could not decode image';
      status.style.color = '#FF3B30';
    }
  }

  // ========== MAIN API ==========
  
  /**
   * Show scan modal
   * @param {string} mode - 'camera' or 'upload'
   * @param {function} callback - Called with (hexCode, fullResult) on success
   */
  function showScanModal(mode, callback) {
    callback = callback || function() {};
    
    // Ensure scanner is available
    if (typeof RGB111Scanner === 'undefined') {
      console.warn('[geosonify] RGB111Scanner not loaded, using basic decoder');
    }
    
    // Try to load OpenCV in background (non-blocking)
    loadOpenCV(function(loaded) {
      if (loaded) {
        console.log('[geosonify] OpenCV available for perspective correction');
      }
    });
    
    if (mode === 'camera') {
      showCameraModal(callback);
    } else {
      showUploadModal(callback);
    }
  }
  
  /**
   * Check if scanner is fully available
   */
  function isScannerReady() {
    return typeof RGB111Scanner !== 'undefined';
  }
  
  /**
   * Check if OpenCV is loaded
   */
  function isOpenCVReady() {
    return cvReady;
  }

  // ========== EXPORT ==========
  
  global.GeoScanUI = {
    version: __SCAN_UI_VER__,
    showScanModal: showScanModal,
    isScannerReady: isScannerReady,
    isOpenCVReady: isOpenCVReady,
    loadOpenCV: loadOpenCV
  };

})(typeof window !== 'undefined' ? window : this);
