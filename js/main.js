/**
 * geosonify-main.js v1.0
 * 
 * Application bootstrap and initialization.
 * Wires together all modules and handles startup.
 * 
 * Load order:
 * 1. Core libraries (external)
 * 2. Core modules (geo-math, compact-codec, app-state, lazy-load)
 * 3. Services (audio-service, scanner-service)
 * 4. UI modules (scanner-ui, audio-ui)
 * 5. Legacy app code
 * 6. This file (main.js) - ties it all together
 */

(function(global) {
  'use strict';

  // ============== INITIALIZATION ==============

  const Main = {
    initialized: false,
    
    /**
     * Initialize the application
     * Called after DOM is ready
     */
    async init() {
      if (this.initialized) return;
      
      console.log('[geosonify] Initializing application...');
      
      try {
        // 1. Initialize state system
        this.initState();
        
        // 2. Initialize UI modules
        this.initUI();
        
        // 3. Set up event bridges (legacy code integration)
        this.setupEventBridges();
        
        // 4. Restore persisted state
        this.restoreState();
        
        // 5. Parse URL parameters
        this.parseURL();
        
        // 6. Set up auto-save
        this.setupAutoSave();
        
        this.initialized = true;
        console.log('[geosonify] Initialization complete');
        
      } catch (err) {
        console.error('[geosonify] Initialization failed:', err);
      }
    },
    
    /**
     * Initialize state system
     */
    initState() {
      // AppState should already be loaded
      if (typeof AppState === 'undefined') {
        console.warn('[geosonify] AppState not found, some features may not work');
        return;
      }
      
      // Set up logging for debugging (can be disabled in production)
      if (global.location?.search?.includes('debug=state')) {
        AppState.subscribe('*', (value, path) => {
          console.log(`[State] ${path}:`, value);
        });
      }
    },
    
    /**
     * Initialize UI modules
     */
    initUI() {
      // Scanner UI - just needs decode callback, no init required
      if (typeof ScannerUI !== 'undefined') {
        // ScannerUI.onDecode is set up in index.html where decodeChromaResult is defined
        console.log('[geosonify] ScannerUI ready');
      }
      
      // Audio UI
      if (typeof AudioUI !== 'undefined' && typeof AppState !== 'undefined') {
        AudioUI.init(AppState);
        console.log('[geosonify] AudioUI initialized');
      }
    },
    
    /**
     * Bridge between new state system and legacy code
     */
    setupEventBridges() {
      if (typeof AppState === 'undefined') return;
      
      // When coordinate changes in state, update legacy global
      AppState.subscribe('coordinate', (coord) => {
        if (typeof global.currentCardCoord !== 'undefined') {
          global.currentCardCoord = coord.lat !== null 
            ? { lat: coord.lat, lon: coord.lon }
            : null;
        }
        
        // Trigger legacy update functions if they exist
        if (typeof global.updateCoordDisplay === 'function') {
          global.updateCoordDisplay();
        }
        if (typeof global.updateMapPin === 'function') {
          global.updateMapPin();
        }
        if (typeof global.renderCards === 'function') {
          global.renderCards();
        }
      });
      
      // When cards.active changes, update legacy state
      AppState.subscribe('cards.active', (gridKey) => {
        if (typeof global.cardState !== 'undefined') {
          global.cardState.active = gridKey;
        }
      });
      
      // When encoding options change
      AppState.subscribe('encoding.obfuscated', (obf) => {
        if (typeof global.obfuscated !== 'undefined') {
          global.obfuscated = obf;
        }
      });
      
      AppState.subscribe('encoding.passphrase', (pass) => {
        if (typeof global.passphrase !== 'undefined') {
          global.passphrase = pass;
        }
      });
      
      // Listen for ChromaCoord decode events from scanner
      document.addEventListener('chromacoord-decoded', (e) => {
        if (e.detail && e.detail.hex && typeof global.decodeChromaResult === 'function') {
          global.decodeChromaResult(e.detail.hex);
        }
      });
    },
    
    /**
     * Restore state from localStorage
     */
    restoreState() {
      if (typeof AppState === 'undefined') return;
      
      try {
        const saved = localStorage.getItem('geosonify-app-state');
        if (saved) {
          AppState.restore(saved, false); // Don't notify yet
          console.log('[geosonify] State restored from localStorage');
        }
      } catch (err) {
        console.warn('[geosonify] Could not restore state:', err);
      }
    },
    
    /**
     * Parse URL parameters
     */
    parseURL() {
      // Let the legacy parseURLParameters handle this for now
      // Future: Move URL parsing into the new architecture
    },
    
    /**
     * Set up auto-save of state
     */
    setupAutoSave() {
      if (typeof AppState === 'undefined') return;
      
      // Debounce saves to avoid excessive writes
      let saveTimeout;
      
      AppState.subscribe('*', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
          try {
            // Only save specific parts of state (not transient UI state)
            const toSave = {
              cards: AppState.get('cards'),
              encoding: AppState.get('encoding'),
              audio: {
                volume: AppState.get('audio.volume')
              }
            };
            localStorage.setItem('geosonify-app-state', JSON.stringify(toSave));
          } catch (err) {
            console.warn('[geosonify] Could not save state:', err);
          }
        }, 1000);
      });
    },
    
    // ============== PUBLIC UTILITIES ==============
    
    /**
     * Open the ChromaCoord scanner
     * @param {string} mode - 'photo' or 'camera'
     */
    openScanner(mode = 'photo') {
      if (typeof ScannerUI === 'undefined') {
        console.warn('[geosonify] ScannerUI not available');
        return;
      }
      
      if (mode === 'camera') {
        ScannerUI.showCameraScanner();
      } else {
        ScannerUI.showPhotoScanner();
      }
    },
    
    /**
     * Toggle audio playback
     */
    async toggleAudio() {
      if (typeof AudioUI !== 'undefined') {
        if (AudioUI.isPlaying) {
          AudioUI.stop();
        } else {
          await AudioUI.play();
        }
      }
    },
    
    /**
     * Set coordinate (updates state and triggers UI updates)
     * @param {number} lat
     * @param {number} lon
     * @param {object} [meta] optional provenance for the exact-point truth:
     *        { accuracyMetres } GPS · { zoom, pixels } map pin ·
     *        { exactPoint } a pre-built GeoPrecision.ExactPoint (from a code/scan)
     *        When omitted, precision is derived from the lat/lon decimals (typed).
     */
    setCoordinate(lat, lon, meta) {
      if (typeof AppState !== 'undefined') {
        AppState.set('coordinate', { lat, lon });

        // Source-of-truth: store an exact point with provenance when the
        // precision module is available. The double above stays as the derived
        // view every legacy consumer reads; this is the lossless truth + its
        // measurement uncertainty, used by the ℹ️ box and cross-card movement.
        try {
          if (typeof GeoPrecision !== 'undefined' && !GeoPrecision._unavailable) {
            let pt = (meta && meta.exactPoint) ? meta.exactPoint : null;
            if (!pt) pt = GeoPrecision.fromLatLon(lat, lon, meta || {});
            AppState.set('exact', {
              latStr: pt.lat.toString(),
              lonStr: pt.lon.toString(),
              meta: pt.meta || {}
            });
            // Verbose: prove provenance is being calculated (not on drag spam —
            // callers pass meta.quiet for high-frequency updates like dragging).
            if (!(meta && meta.quiet)) {
              const u = pt.meta && pt.meta.uncertaintyMetres;
              console.log(
                '%c[provenance]%c stamped exact point',
                'color:#ffd54f;font-weight:bold', 'color:inherit',
                {
                  lat: lat, lon: lon,
                  uncertainty: pt.uncertaintyText ? pt.uncertaintyText() : (u + ' m'),
                  basis: pt.meta && pt.meta.basis,
                  source: pt.meta && pt.meta.source,
                  exactLat: pt.lat.toString().slice(0, 24) + '…'
                }
              );
            }
          } else {
            console.warn('[provenance] GeoPrecision unavailable — no exact point stored. ' +
              'Check decimal.min.js + geosonify-precision.js are loaded before main.js.');
          }
        } catch (e) {
          console.warn('[provenance] exact-point stamp failed:', e && e.message);
        }
      }
      
      // Also update legacy global for backwards compatibility
      if (typeof global.currentCardCoord !== 'undefined') {
        global.currentCardCoord = { lat, lon };
      }
    },
    
    /**
     * Get current coordinate
     * @returns {{lat: number, lon: number}|null}
     */
    getCoordinate() {
      if (typeof AppState !== 'undefined') {
        return AppState.get('coordinate');
      }
      if (typeof global.currentCardCoord !== 'undefined') {
        return global.currentCardCoord;
      }
      return null;
    },

    /**
     * Get the source-of-truth exact point (lossless, with provenance/​uncertainty),
     * rehydrated as a GeoPrecision.ExactPoint. Returns null if unavailable.
     * Use this for cross-card movement, distance, conversion, and the ℹ️ box —
     * NOT getCoordinate(), which is the lossy derived double for display/export.
     */
    getExact() {
      if (typeof AppState === 'undefined' || typeof GeoPrecision === 'undefined') return null;
      const ex = AppState.get('exact');
      if (!ex || ex.latStr == null) return null;
      try {
        return GeoPrecision.makeExactPoint(ex.latStr, ex.lonStr, ex.meta || {});
      } catch (e) { return null; }
    }
  };

  // ============== AUTO-INIT ==============

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Main.init());
  } else {
    // DOM already ready (script loaded with defer or at end of body)
    setTimeout(() => Main.init(), 0);
  }

  // ============== EXPORT ==============

  global.GeosonifyMain = Main;

  // One-time wiring check so you can see in the console whether the precision
  // stack actually loaded (the thing that powers provenance + ℹ️ uncertainty).
  setTimeout(function () {
    try {
      const gp = (typeof GeoPrecision !== 'undefined') && !GeoPrecision._unavailable;
      const dec = (typeof Decimal !== 'undefined');
      const hpx = (typeof HealpixGrids !== 'undefined');
      console.log(
        '%c[geosonify precision]%c ' +
        'Decimal=' + (dec ? '\u2713' : '\u2717') + '  ' +
        'GeoPrecision=' + (gp ? '\u2713 live' : '\u2717 MISSING') + '  ' +
        'HealpixGrids=' + (hpx ? '\u2713' : '\u2717') + '  ' +
        'getExact=' + (typeof Main.getExact === 'function' ? '\u2713' : '\u2717'),
        'color:#4fc3f7;font-weight:bold', 'color:inherit'
      );
      if (!gp) console.warn('[geosonify precision] GeoPrecision NOT live \u2014 provenance/uncertainty will not appear. Check load order / missing files.');
    } catch (e) { /* ignore */ }
  }, 0);
  
  // Also expose convenient shortcuts
  global.geosonify = {
    openScanner: (mode) => Main.openScanner(mode),
    toggleAudio: () => Main.toggleAudio(),
    setCoordinate: (lat, lon) => Main.setCoordinate(lat, lon),
    getCoordinate: () => Main.getCoordinate(),
    getExact: () => Main.getExact(),
    get state() { return typeof AppState !== 'undefined' ? AppState : null; }
  };

  console.log('[geosonify] main v1.0 loaded');

})(typeof window !== 'undefined' ? window : this);
