/*
  geosonify-barcode-lib_v1_0.js
  Mono Barcode Encoder/Decoder Library

  Generates and decodes monochrome barcodes (QR codes and Data Matrix)
  from hex strings, for use with hexByteArray (16×16 = 256 symbols).

  Card types:
  - QR-Hex (V1, 21×21): 3–12 iterations, hex as ASCII text
  - QR-Binary (V1, 21×21): 3–17 iterations, hex packed as raw bytes (smaller QR)
  - QR-URL (Adaptive): iterations depend on URL prefix length
  - Data Matrix (10×10 to 16×16, ECC 200): 3–12 iterations, auto-sized

  Dependencies (CDN, lazy-loaded):
  - qrcode-generator: QR encoding
  - jsQR 1.4.0: QR decoding
  - @aspect-build/aspect-dm (or manual ECC200): Data Matrix encoding
  - zxing-js: Data Matrix decoding

  Usage:
    await BarcodeLib.ensureQRLoaded();
    const canvas = BarcodeLib.generateQRCanvas(text, { size: 200 });
    const result = BarcodeLib.decodeQRFromImageData(imageData);
*/
(function(global) {
  'use strict';

  var __BARCODE_LIB_VER__ = 'v1.0';
  try { console.log('[geosonify] barcode-lib ' + __BARCODE_LIB_VER__ + ' loaded'); } catch(e) {}

  // ============== CDN URLS ==============

  var QRCODE_GEN_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
  var JSQR_CDN = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
  var ZXING_CDN = 'https://unpkg.com/@zxing/browser@latest';

  // ============== LAZY LOADING ==============

  var qrGenLoaded = false;
  var jsQRLoaded = false;
  var zxingLoaded = false;

  /**
   * Ensure QR code generator library is loaded
   */
  async function ensureQRGenLoaded() {
    if (qrGenLoaded && typeof qrcode !== 'undefined') return;
    if (typeof LazyLoad !== 'undefined') {
      await LazyLoad.script(QRCODE_GEN_CDN, { global: 'qrcode' });
    } else {
      await _loadScript(QRCODE_GEN_CDN);
    }
    qrGenLoaded = true;
  }

  /**
   * Ensure jsQR decoder is loaded (for QR camera/photo scanning)
   */
  async function ensureJsQRLoaded() {
    if (jsQRLoaded && typeof jsQR !== 'undefined') return;
    if (typeof LazyLoad !== 'undefined') {
      await LazyLoad.script(JSQR_CDN, { global: 'jsQR' });
    } else {
      await _loadScript(JSQR_CDN);
    }
    jsQRLoaded = true;
  }

  /**
   * Ensure zxing-js browser library is loaded.
   * Provides ZXingBrowser global with BrowserDatamatrixCodeReader,
   * BrowserMultiFormatReader, etc.
   */
  async function ensureZxingLoaded() {
    if (zxingLoaded && typeof ZXingBrowser !== 'undefined') return;
    if (typeof ZXingBrowser !== 'undefined') { zxingLoaded = true; return; }
    if (typeof LazyLoad !== 'undefined') {
      await LazyLoad.script(ZXING_CDN, { global: 'ZXingBrowser' });
    } else {
      await _loadScript(ZXING_CDN);
      for (var i = 0; i < 100 && typeof ZXingBrowser === 'undefined'; i++) {
        await new Promise(function(r) { setTimeout(r, 100); });
      }
    }
    zxingLoaded = (typeof ZXingBrowser !== 'undefined');
    if (zxingLoaded) console.log('[BarcodeLib] zxing-js/browser loaded');
  }

  /**
   * Ensure both QR encode + decode libs are loaded
   */
  async function ensureQRLoaded() {
    await Promise.all([ensureQRGenLoaded(), ensureJsQRLoaded()]);
  }

  /** Simple fallback script loader */
  function _loadScript(url) {
    return new Promise(function(resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = resolve;
      s.onerror = function() { reject(new Error('Failed to load: ' + url)); };
      document.head.appendChild(s);
    });
  }

  // ============== QR CODE GENERATION ==============

  /**
   * Generate a QR code canvas element
   * @param {string} text - Text to encode (hex string or URL)
   * @param {Object} opts
   * @param {number} opts.size - Canvas pixel size (default 200)
   * @param {string} opts.eccLevel - Error correction: 'L','M','Q','H' (default 'L')
   * @param {number} opts.version - Force QR version (0 = auto, default 0)
   * @returns {HTMLCanvasElement}
   */
  function generateQRCanvas(text, opts) {
    opts = opts || {};
    var size = opts.size || 200;
    var eccLevel = opts.eccLevel || 'L';
    var version = opts.version || 0;

    if (typeof qrcode === 'undefined') {
      console.warn('[BarcodeLib] qrcode-generator not loaded');
      return _placeholderCanvas(size, 'QR not loaded');
    }

    try {
      // qrcode-generator API: qrcode(typeNumber, errorCorrectionLevel)
      // typeNumber: 0 = auto, 1-40 = fixed
      // errorCorrectionLevel: 'L', 'M', 'Q', 'H' (must be string)
      var qr = qrcode(version, eccLevel);
      qr.addData(text, 'Byte');
      qr.make();

      var moduleCount = qr.getModuleCount();
      var canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext('2d');

      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);

      // Quiet zone: 4 modules
      var quietZone = 4;
      var totalModules = moduleCount + quietZone * 2;
      var cellSize = size / totalModules;

      ctx.fillStyle = '#000000';
      for (var r = 0; r < moduleCount; r++) {
        for (var c = 0; c < moduleCount; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect(
              Math.round((c + quietZone) * cellSize),
              Math.round((r + quietZone) * cellSize),
              Math.ceil(cellSize),
              Math.ceil(cellSize)
            );
          }
        }
      }

      return canvas;
    } catch (e) {
      console.error('[BarcodeLib] QR generation error:', e);
      return _placeholderCanvas(size, 'QR error');
    }
  }

  /**
   * Decode QR code from ImageData
   * @param {ImageData} imageData - From canvas.getContext('2d').getImageData()
   * @returns {{ text: string, valid: boolean } | null}
   */
  /**
   * Decode a barcode from a canvas using zxing-js/browser.
   * Handles QR codes, Data Matrix, and other formats.
   * @param {HTMLCanvasElement} canvas
   * @returns {Promise<{ text: string, format: string } | null>}
   */
  async function decodeFromCanvasZxing(canvas) {
    if (typeof ZXingBrowser === 'undefined') return null;
    try {
      // BrowserMultiFormatReader handles QR + DataMatrix + more
      var reader = new ZXingBrowser.BrowserMultiFormatReader();
      var result = await reader.decodeFromCanvas(canvas);
      if (result && result.getText()) {
        return { text: result.getText(), format: result.getBarcodeFormat ? result.getBarcodeFormat().toString() : 'unknown' };
      }
    } catch (e) {
      // Not found or decode error — expected for non-barcode images
    }
    return null;
  }

  /**
   * Decode a barcode from an image element using zxing-js/browser.
   * @param {HTMLImageElement} img
   * @returns {Promise<{ text: string, format: string } | null>}
   */
  async function decodeFromImageZxing(img) {
    if (typeof ZXingBrowser === 'undefined') return null;
    try {
      var reader = new ZXingBrowser.BrowserMultiFormatReader();
      var result = await reader.decodeFromImageElement(img);
      if (result && result.getText()) {
        return { text: result.getText(), format: result.getBarcodeFormat ? result.getBarcodeFormat().toString() : 'unknown' };
      }
    } catch (e) {
      // Not found
    }
    return null;
  }

  /**
   * Decode barcode from ImageData using zxing-js/browser.
   * Creates a temporary canvas from the ImageData and decodes.
   */
  async function _decodeZxingFromImageData(imageData) {
    if (typeof ZXingBrowser === 'undefined') return null;
    try {
      // Create temp canvas from ImageData
      var tempCanvas = document.createElement('canvas');
      tempCanvas.width = imageData.width;
      tempCanvas.height = imageData.height;
      var ctx = tempCanvas.getContext('2d');
      ctx.putImageData(imageData, 0, 0);
      return await decodeFromCanvasZxing(tempCanvas);
    } catch (e) {
      return null;
    }
  }

  /**
   * Decode QR code from ImageData.
   * Tries zxing-js first (if loaded), falls back to jsQR.
   * @param {ImageData} imageData
   * @returns {{ text: string, valid: boolean } | null}
   */
  function decodeQRFromImageData(imageData) {
    // Try jsQR first (synchronous, fast for QR-only)
    if (typeof jsQR !== 'undefined') {
      var result = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      });
      if (result && result.data) {
        return { text: result.data, valid: true };
      }
    }
    
    // zxing-js is async — for the synchronous scan loop we can't await it here.
    // The caller should use decodeBarcodesFromImageData() for async decode.
    return null;
  }
  
  /**
   * Async barcode decode from ImageData — tries zxing-js (QR + DM + more),
   * then falls back to jsQR for QR codes.
   * @param {ImageData} imageData
   * @returns {Promise<{ text: string, valid: boolean } | null>}
   */
  async function decodeBarcodesFromImageData(imageData) {
    // Try zxing-js first (handles QR + DM + many formats)
    var zxResult = await _decodeZxingFromImageData(imageData);
    if (zxResult && zxResult.text) {
      return { text: zxResult.text, valid: true, format: zxResult.format };
    }
    
    // Fall back to jsQR (synchronous, QR-only)
    if (typeof jsQR !== 'undefined') {
      var result = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      });
      if (result && result.data) {
        return { text: result.data, valid: true, format: 'qr' };
      }
    }
    
    return null;
  }

  // ============== BWIP-JS LOADER ==============
  
  var BWIPJS_CDN = 'https://cdn.jsdelivr.net/npm/bwip-js@4.3.0/dist/bwip-js-min.js';
  var bwipLoaded = false;
  
  async function ensureBwipLoaded() {
    if (bwipLoaded && typeof bwipjs !== 'undefined') return true;
    if (typeof bwipjs !== 'undefined') { bwipLoaded = true; return true; }
    try {
      if (typeof LazyLoad !== 'undefined') {
        await LazyLoad.script(BWIPJS_CDN, { global: 'bwipjs' });
      } else {
        await _loadScript(BWIPJS_CDN);
        for (var i = 0; i < 50 && typeof bwipjs === 'undefined'; i++) {
          await new Promise(function(r) { setTimeout(r, 100); });
        }
      }
      bwipLoaded = (typeof bwipjs !== 'undefined');
      if (bwipLoaded) console.log('[BarcodeLib] bwip-js loaded');
      return bwipLoaded;
    } catch (e) {
      console.warn('[BarcodeLib] bwip-js load failed:', e);
      return false;
    }
  }

  // ============== DATA MATRIX GENERATION ==============

  /**
   * Generate a Data Matrix canvas using bwip-js (ISO 16022 compliant).
   * Encodes the hex string as ASCII text — commercial scanners read the hex directly.
   * bwip-js must be loaded first via ensureBwipLoaded().
   * Accepts variable-length hex (auto-selects DM symbol size):
   *   6 hex chars (3 bytes) → 10×10,  10 hex (5 bytes) → 12×12,
   *   16 hex (8 bytes) → 14×14,  24 hex (12 bytes) → 16×16
   *
   * @param {string} hex - Hex characters (even count, 6-24 chars typical)
   * @param {Object} opts
   * @param {number} opts.size - Canvas pixel size (default 200)
   * @returns {HTMLCanvasElement}
   */
  function generateDataMatrixCanvas(hex, opts) {
    opts = opts || {};
    var size = opts.size || 200;
    
    hex = (hex || '').toUpperCase().replace(/[^0-9A-F]/g, '');
    // Ensure even length (each byte = 2 hex chars)
    if (hex.length % 2 !== 0) hex = hex + '0';
    // Minimum 6 hex chars (3 bytes for 10×10), max 24 hex chars (12 bytes for 16×16)
    if (hex.length < 6) hex = hex.padEnd(6, '0');
    if (hex.length > 24) hex = hex.slice(0, 24);
    
    if (typeof bwipjs === 'undefined') {
      console.warn('[BarcodeLib] bwip-js not loaded — call ensureBwipLoaded() first');
      return _placeholderCanvas(size, 'Loading DM...');
    }
    
    try {
      var canvas = document.createElement('canvas');
      var moduleScale = Math.max(2, Math.floor(size / 28));
      bwipjs.toCanvas(canvas, {
        bcid: 'datamatrix',
        text: hex,
        scale: moduleScale,
        padding: 2,
        backgroundcolor: 'FFFFFF'
      });
      // Resize to requested square
      if (canvas.width !== size || canvas.height !== size) {
        var resized = document.createElement('canvas');
        resized.width = size;
        resized.height = size;
        var ctx = resized.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        var scale = Math.min(size / canvas.width, size / canvas.height) * 0.92;
        var dw = canvas.width * scale, dh = canvas.height * scale;
        ctx.drawImage(canvas, (size - dw) / 2, (size - dh) / 2, dw, dh);
        return resized;
      }
      return canvas;
    } catch (e) {
      console.error('[BarcodeLib] DM generation failed:', e);
      return _placeholderCanvas(size, 'DM error');
    }
  }

  // ============== DATA MATRIX DECODING (via zxing-js) ==============
  //
  // All DM decoding uses zxing-js/browser — a full ISO 16022 decoder
  // with built-in Reed-Solomon ECC validation. No native decoder needed.
  //
  // Strict mode (camera): only accepts result when zxing genuinely finds a valid DM.
  // Lenient mode (photo): tries zxing, then jsQR as fallback for QR codes.

  /**
   * Decode Data Matrix from ImageData — STRICT mode for camera scanning.
   * Only uses zxing-js (proper ISO 16022 decoder with ECC validation).
   * Will NOT return false positives from random camera frames.
   * @param {ImageData} imageData
   * @returns {Promise<{ hex: string, valid: boolean } | null>}
   */
  async function decodeDataMatrixStrict(imageData) {
    // zxing-js only — it has built-in RS ECC validation
    var zxResult = await _decodeZxingFromImageData(imageData);
    if (zxResult && zxResult.text) {
      var hex = zxResult.text.toUpperCase().replace(/[^0-9A-F]/g, '');
      // Accept any even-length hex from 6 to 24 chars (variable DM sizes)
      if (hex.length >= 6 && hex.length <= 24 && hex.length % 2 === 0) {
        return { hex: hex, valid: true };
      }
    }
    return null;
  }

  /**
   * Decode Data Matrix from ImageData — LENIENT mode for photo uploads.
   * Tries zxing-js first, then jsQR, then native decoder as fallback.
   * @param {ImageData} imageData
   * @returns {Promise<{ hex: string, valid: boolean } | null>}
   */
  async function decodeDataMatrixFromImageData(imageData) {
    // Try zxing-js first — handles all standard DM symbols
    var zxResult = await _decodeZxingFromImageData(imageData);
    if (zxResult && zxResult.text) {
      var hex = zxResult.text.toUpperCase().replace(/[^0-9A-F]/g, '');
      if (hex.length >= 12) {
        return { hex: hex, valid: true };
      }
      return { hex: zxResult.text, valid: true };
    }
    
    // Try jsQR as fallback (synchronous, QR-only)
    if (typeof jsQR !== 'undefined') {
      var qrResult = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      });
      if (qrResult && qrResult.data) {
        return { hex: qrResult.data, valid: true };
      }
    }

    return null;
  }
  // ============== URL PARSING / BUILDING ==============

  /**
   * Parse a Geosonify URL to extract hex and obfuscation flag
   * Supports: ?h=HEX, ?oh=HEX, and future parameter styles
   * @param {string} url
   * @returns {{ hex: string, obfuscated: boolean } | null}
   */
  function parseGeosonifyURL(url) {
    if (!url) return null;

    var qIdx = url.indexOf('?');
    if (qIdx < 0) return null;

    var query = url.slice(qIdx + 1);
    var params = query.split('&');

    // Recognised single-point params → which barcode CODEC decodes them, and
    // whether the value is obfuscated. h/oh are the legacy Geosonify-hex forms
    // (standard Data Matrix codec). HEALPix uses base + suffix flags, matching the
    // app's own convention: hphex / hphexo (obfuscated) / hp64 / hp64o / hpquad /
    // hpquado — the trailing 'o' is the obfuscation flag (same as ?ao=…). These
    // route to the hpmatrix codec, not the byte model, since hphex is length-self-
    // describing and order ≠ length/2. The caller uses .gridKey to pick the
    // decoder and .obfuscated to set mode.
    var HP_BASES = ['hphex', 'hp64', 'hpquad'];

    for (var i = 0; i < params.length; i++) {
      var parts = params[i].split('=');
      var key = decodeURIComponent(parts[0] || '');
      var val = decodeURIComponent(parts[1] || '');

      // Legacy Geosonify hex (standard Data Matrix codec).
      if (key === 'h')  return { hex: val, obfuscated: false, gridKey: 'datamatrix' };
      if (key === 'oh') return { hex: val, obfuscated: true,  gridKey: 'datamatrix' };

      // HEALPix: base + optional [o] flag suffix → hpmatrix codec.
      for (var b = 0; b < HP_BASES.length; b++) {
        var base = HP_BASES[b];
        if (key === base || (key.indexOf(base) === 0)) {
          var suffix = key.slice(base.length);
          // Only the obfuscation flag is meaningful for a single-point scan;
          // accept o/d/r in any order (no repeats) as the app does, read 'o'.
          if (/^[odr]{0,3}$/.test(suffix) && new Set(suffix.split('')).size === suffix.length) {
            return { hex: val, obfuscated: suffix.indexOf('o') !== -1, gridKey: 'hpmatrix' };
          }
        }
      }
    }

    // Also check the existing URL codec param format
    if (typeof GeoURLCodec !== 'undefined' && GeoURLCodec.parseShareURL) {
      var parsed = GeoURLCodec.parseShareURL(url);
      if (parsed && parsed.shape && parsed.shape.coordCode) {
        return {
          hex: parsed.shape.coordCode,
          obfuscated: !!parsed.obfuscated,
          gridKey: 'datamatrix'
        };
      }
    }

    return null;
  }

  /**
   * Build a Geosonify URL from hex string
   * @param {string} hex - Hex string to encode
   * @param {string} baseUrl - URL base (e.g., "https://geosonify.org/?")
   * @param {boolean} isObfuscated - Whether the hex is obfuscated
   * @returns {string}
   */
  function buildGeosonifyURL(hex, baseUrl, isObfuscated) {
    if (!baseUrl) {
      var loc = window.location;
      // On file:// protocol, origin is "null" string — use href up to filename
      if (loc.origin === 'null' || !loc.origin) {
        baseUrl = loc.href.split('?')[0] + '?';
      } else {
        baseUrl = loc.origin + loc.pathname + '?';
      }
    }
    // Ensure baseUrl ends with '?'
    if (baseUrl.charAt(baseUrl.length - 1) !== '?') {
      baseUrl += '?';
    }
    var paramKey = isObfuscated ? 'oh' : 'h';
    return baseUrl + paramKey + '=' + hex;
  }

  // ============== ADAPTIVE QR-URL CAPACITY ==============

  // QR byte-mode capacities at ECC-L by version (index = version number)
  var QR_BYTE_CAPS_ECC_L = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271,
    321, 367, 425, 458, 520, 586, 644, 718, 792, 858];

  /**
   * Calculate QR-URL capacity and iterations for given base URL
   * @param {string} [baseUrl] - Optional base URL override
   * @returns {{ maxHexChars: number, maxIterations: number, qrVersion: number, precision: string, worstPrefix: string }}
   */
  function getQRUrlCapacity(baseUrl) {
    if (!baseUrl) {
      var loc = window.location;
      if (loc.origin === 'null' || !loc.origin) {
        baseUrl = loc.href.split('?')[0] + '?';
      } else {
        baseUrl = loc.origin + loc.pathname + '?';
      }
    }
    // Ensure baseUrl ends with '?'
    if (baseUrl.charAt(baseUrl.length - 1) !== '?') {
      baseUrl += '?';
    }

    // Worst case: obfuscated prefix is 1 char longer (oh= vs h=)
    var worstPrefix = baseUrl + 'oh=';

    // Find smallest version where obfuscated URL fits with >= 6 iterations
    for (var v = 1; v <= 20; v++) {
      var cap = QR_BYTE_CAPS_ECC_L[v];
      if (!cap) continue;
      var spare = cap - worstPrefix.length;
      var iters = Math.floor(spare / 2);
      if (iters >= 6) {
        var hexChars = iters * 2;
        return {
          maxHexChars: hexChars,
          maxIterations: iters,
          qrVersion: v,
          precision: _calcPrecisionStr(iters),
          worstPrefix: worstPrefix
        };
      }
    }

    // Fallback
    return {
      maxHexChars: 12,
      maxIterations: 6,
      qrVersion: 4,
      precision: '~1.2 m',
      worstPrefix: worstPrefix
    };
  }

  /**
   * Get current QR-URL iteration count
   * @returns {number}
   */
  function getQRUrlIterations() {
    return getQRUrlCapacity().maxIterations;
  }

  /**
   * Calculate precision string for a given iteration count (16×16 grid)
   */
  function _calcPrecisionStr(iterations) {
    // hexByteArray is 16×16
    var latDeg = 180 / Math.pow(16, iterations);
    var metersPerDegLat = 111319.9;
    var m = latDeg * metersPerDegLat;

    if (m >= 1000) return '~' + (m / 1000).toFixed(1) + ' km';
    if (m >= 1) return '~' + m.toFixed(1) + ' m';
    var cm = m * 100;
    if (cm >= 1) return '~' + cm.toFixed(1) + ' cm';
    var mm = m * 1000;
    if (mm >= 1) return '~' + mm.toFixed(1) + ' mm';
    var um = m * 1e6;
    if (um >= 1) return '~' + um.toFixed(1) + ' µm';
    var nm = m * 1e9;
    return '~' + nm.toFixed(1) + ' nm';
  }

  // ============== QR BINARY GENERATION ==============

  /**
   * Convert hex string to raw binary string (byte characters).
   * "BFDAEC" → "\xBF\xDA\xEC" (3 bytes instead of 6 ASCII chars)
   * This halves QR payload vs sending hex as ASCII text.
   */
  function hexToRawBytes(hex) {
    hex = (hex || '').toUpperCase().replace(/[^0-9A-F]/g, '');
    if (hex.length % 2 !== 0) hex += '0';
    var bytes = '';
    for (var i = 0; i < hex.length; i += 2) {
      bytes += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return bytes;
  }

  /**
   * Convert raw byte string back to hex.
   * Used when decoding a scanned QR Binary code.
   * @param {string} rawText - Raw byte string from QR decode
   * @returns {string} Uppercase hex string
   */
  function rawBytesToHex(rawText) {
    var hex = '';
    for (var i = 0; i < rawText.length; i++) {
      hex += ('0' + rawText.charCodeAt(i).toString(16)).slice(-2);
    }
    return hex.toUpperCase();
  }

  /**
   * Generate a QR Binary canvas — packs hex as raw bytes for smaller QR codes.
   * At 12 iterations (24 hex chars), this is 12 raw bytes vs 24 ASCII chars,
   * fitting comfortably in QR V1-L (17 byte cap).
   * Max: 17 iterations = 34 hex chars = 17 raw bytes = QR V1-L limit.
   *
   * @param {string} hex - Hex characters (variable length)
   * @param {Object} opts
   * @param {number} opts.size - Canvas pixel size (default 200)
   * @param {string} opts.eccLevel - Error correction: 'L','M','Q','H' (default 'L')
   * @returns {HTMLCanvasElement}
   */
  function generateQRBinaryCanvas(hex, opts) {
    opts = opts || {};
    var size = opts.size || 200;
    var eccLevel = opts.eccLevel || 'L';

    hex = (hex || '').toUpperCase().replace(/[^0-9A-F]/g, '');
    if (hex.length % 2 !== 0) hex += '0';

    if (typeof qrcode === 'undefined') {
      console.warn('[BarcodeLib] qrcode-generator not loaded');
      return _placeholderCanvas(size, 'QR not loaded');
    }

    try {
      var binaryData = hexToRawBytes(hex);
      // version 0 = auto-select smallest version that fits
      var qr = qrcode(0, eccLevel);
      qr.addData(binaryData, 'Byte');
      qr.make();

      var moduleCount = qr.getModuleCount();
      var canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext('2d');

      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);

      // Quiet zone: 4 modules
      var quietZone = 4;
      var totalModules = moduleCount + quietZone * 2;
      var cellSize = size / totalModules;

      ctx.fillStyle = '#000000';
      for (var r = 0; r < moduleCount; r++) {
        for (var c = 0; c < moduleCount; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect(
              Math.round((c + quietZone) * cellSize),
              Math.round((r + quietZone) * cellSize),
              Math.ceil(cellSize),
              Math.ceil(cellSize)
            );
          }
        }
      }

      return canvas;
    } catch (e) {
      console.error('[BarcodeLib] QR Binary generation error:', e);
      return _placeholderCanvas(size, 'QR error');
    }
  }

  // ============== PLACEHOLDER ==============

  function _placeholderCanvas(size, text) {
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#999';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text || 'Loading...', size / 2, size / 2);
    return canvas;
  }

  // ============== EXPORTS ==============

  global.BarcodeLib = {
    version: __BARCODE_LIB_VER__,

    // QR generation & decoding
    generateQRCanvas: generateQRCanvas,
    generateQRBinaryCanvas: generateQRBinaryCanvas,
    decodeQRFromImageData: decodeQRFromImageData,
    decodeBarcodesFromImageData: decodeBarcodesFromImageData,
    decodeFromCanvasZxing: decodeFromCanvasZxing,

    // QR Binary helpers
    rawBytesToHex: rawBytesToHex,
    hexToRawBytes: hexToRawBytes,

    // Data Matrix generation & decoding
    generateDataMatrixCanvas: generateDataMatrixCanvas,
    decodeDataMatrixFromImageData: decodeDataMatrixFromImageData,
    decodeDataMatrixStrict: decodeDataMatrixStrict,

    // URL helpers
    parseGeosonifyURL: parseGeosonifyURL,
    buildGeosonifyURL: buildGeosonifyURL,

    // Adaptive capacity
    getQRUrlCapacity: getQRUrlCapacity,
    getQRUrlIterations: getQRUrlIterations,

    // Lazy loading
    ensureQRGenLoaded: ensureQRGenLoaded,
    ensureJsQRLoaded: ensureJsQRLoaded,
    ensureQRLoaded: ensureQRLoaded,
    ensureBwipLoaded: ensureBwipLoaded,
    ensureZxingLoaded: ensureZxingLoaded,

    // Internal helpers (exposed for testing)
    _calcPrecisionStr: _calcPrecisionStr,
    _placeholderCanvas: _placeholderCanvas
  };

})(typeof window !== 'undefined' ? window : this);
