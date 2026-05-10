/**
 * geosonify-gps-tracking.js v1.0
 * 
 * GPS tracking module for Geosonify.
 * Handles geolocation watch, tracking state, and GPS position updates.
 * 
 * Dependencies:
 * - MapManager (optional but recommended)
 * - AppState (optional for reactive state)
 * 
 * Usage:
 *   GPSTracking.init({ onPosition, onError, onTrackingChange });
 *   GPSTracking.startTracking();
 *   GPSTracking.stopTracking();
 *   GPSTracking.toggle();
 */

(function(global) {
  'use strict';

  // ============== STATE ==============

  let isTracking = false;
  let trackWatchId = null;
  let lastPosition = null;
  let permissionState = null; // 'granted' | 'denied' | 'prompt' | null
  
  // Tracking options
  const DEFAULT_OPTIONS = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0
  };
  
  // Callbacks
  let callbacks = {
    onPosition: null,      // (lat, lon, accuracy) => void
    onError: null,         // (error) => void
    onTrackingChange: null,// (isTracking) => void
    onFirstFix: null,      // (lat, lon) => void - called on first GPS fix only
    showToast: null        // (message) => void
  };
  
  // Reference to map manager (optional)
  let mapManager = null;
  
  // First fix flag
  let firstFix = true;

  // ============== INITIALIZATION ==============

  /**
   * Initialize GPS tracking module
   */
  function init(options = {}) {
    // Store callbacks
    if (options.onPosition) callbacks.onPosition = options.onPosition;
    if (options.onError) callbacks.onError = options.onError;
    if (options.onTrackingChange) callbacks.onTrackingChange = options.onTrackingChange;
    if (options.onFirstFix) callbacks.onFirstFix = options.onFirstFix;
    if (options.showToast) callbacks.showToast = options.showToast;
    
    // Store MapManager reference
    if (options.mapManager) mapManager = options.mapManager;
    if (!mapManager && typeof global.MapManager !== 'undefined') {
      mapManager = global.MapManager;
    }
    
    // Check permission state (without prompting)
    checkPermissionState();
    
    // Setup UI if elements exist
    setupUI();
    
    console.log('[geosonify] gps-tracking initialized');
  }

  /**
   * Check current geolocation permission state
   */
  async function checkPermissionState() {
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const result = await navigator.permissions.query({ name: 'geolocation' });
        permissionState = result.state;
        
        // Listen for permission changes
        result.addEventListener('change', () => {
          permissionState = result.state;
          console.log('[geosonify] Geolocation permission changed:', permissionState);
        });
        
        return permissionState;
      } catch (e) {
        console.log('[geosonify] Permissions API not supported');
        return null;
      }
    }
    return null;
  }

  // ============== TRACKING CONTROL ==============

  /**
   * Start GPS tracking
   * @param {Object} [options] - Geolocation options override
   * @returns {boolean} True if tracking started
   */
  function startTracking(options = {}) {
    if (!navigator.geolocation) {
      if (callbacks.showToast) {
        callbacks.showToast('Geolocation not supported');
      }
      return false;
    }
    
    if (isTracking) {
      return true; // Already tracking
    }
    
    isTracking = true;
    firstFix = true;
    
    // Merge options with defaults
    const geoOptions = { ...DEFAULT_OPTIONS, ...options };
    
    // Start watching position
    trackWatchId = navigator.geolocation.watchPosition(
      handlePositionSuccess,
      handlePositionError,
      geoOptions
    );
    
    // Update UI
    updateTrackingUI(true);
    
    // Notify callback
    if (callbacks.onTrackingChange) {
      callbacks.onTrackingChange(true);
    }
    
    // Sync with AppState if available
    if (typeof global.AppState !== 'undefined') {
      global.AppState.set('map.tracking', true);
    }
    
    console.log('[geosonify] GPS tracking started');
    return true;
  }

  /**
   * Stop GPS tracking
   */
  function stopTracking() {
    if (trackWatchId !== null) {
      navigator.geolocation.clearWatch(trackWatchId);
      trackWatchId = null;
    }
    
    isTracking = false;
    firstFix = true;
    
    // Update UI
    updateTrackingUI(false);
    
    // Notify callback
    if (callbacks.onTrackingChange) {
      callbacks.onTrackingChange(false);
    }
    
    // Sync with AppState if available
    if (typeof global.AppState !== 'undefined') {
      global.AppState.set('map.tracking', false);
    }
    
    console.log('[geosonify] GPS tracking stopped');
  }

  /**
   * Toggle tracking on/off
   * @returns {boolean} New tracking state
   */
  function toggle() {
    if (isTracking) {
      stopTracking();
    } else {
      startTracking();
    }
    return isTracking;
  }

  // ============== POSITION HANDLERS ==============

  /**
   * Handle successful position update
   */
  function handlePositionSuccess(position) {
    const lat = position.coords.latitude;
    const lon = position.coords.longitude;
    const accuracy = position.coords.accuracy;
    
    lastPosition = {
      lat,
      lon,
      accuracy,
      timestamp: position.timestamp
    };
    
    // Update blue GPS dot on map
    if (mapManager) {
      mapManager.updateGPSDot(lat, lon);
    }
    
    // Notify main callback
    if (callbacks.onPosition) {
      callbacks.onPosition(lat, lon, accuracy);
    }
    
    // First fix handling
    if (firstFix) {
      firstFix = false;
      
      if (callbacks.onFirstFix) {
        callbacks.onFirstFix(lat, lon);
      }
      
      // Zoom to street level on first fix
      if (mapManager) {
        mapManager.setView([lat, lon], 17, { animate: true });
      }
    }
    
    // Sync with AppState if available
    if (typeof global.AppState !== 'undefined') {
      global.AppState.set('map.gpsPosition', { lat, lon, accuracy });
    }
  }

  /**
   * Handle position error
   */
  function handlePositionError(error) {
    console.error('[geosonify] GPS error:', error.message);
    
    if (callbacks.onError) {
      callbacks.onError(error);
    }
    
    if (callbacks.showToast) {
      callbacks.showToast('Location error: ' + error.message);
    }
    
    // Stop tracking on error
    stopTracking();
  }

  // ============== SINGLE POSITION ==============

  /**
   * Get current position once (no tracking)
   * @returns {Promise<{lat, lon, accuracy}>}
   */
  function getCurrentPosition(options = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      
      const geoOptions = { ...DEFAULT_OPTIONS, ...options };
      
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const result = {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp
          };
          lastPosition = result;
          resolve(result);
        },
        (error) => {
          reject(error);
        },
        geoOptions
      );
    });
  }

  /**
   * Try to get position silently (only if permission already granted)
   * @returns {Promise<{lat, lon, accuracy}|null>}
   */
  async function getPositionIfPermitted() {
    // Check permission first
    const perm = await checkPermissionState();
    
    if (perm === 'granted') {
      try {
        return await getCurrentPosition({ timeout: 5000, maximumAge: 60000 });
      } catch (e) {
        console.log('[geosonify] GPS error despite permission:', e.message);
        return null;
      }
    }
    
    return null;
  }

  // ============== UI INTEGRATION ==============

  /**
   * Setup UI event handlers
   */
  function setupUI() {
    const trackBtn = document.getElementById('trackBtn');
    
    if (trackBtn) {
      trackBtn.addEventListener('click', toggle);
    }
  }

  /**
   * Update tracking button UI
   */
  function updateTrackingUI(tracking) {
    const trackBtn = document.getElementById('trackBtn');
    
    if (trackBtn) {
      if (tracking) {
        trackBtn.classList.add('active');
        trackBtn.textContent = '⏹ Stop';
      } else {
        trackBtn.classList.remove('active');
        trackBtn.textContent = '📍 Track';
      }
    }
  }

  // ============== UTILITY FUNCTIONS ==============

  /**
   * Calculate distance between two points (Haversine approximation)
   */
  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  /**
   * Check if position has changed significantly (by distance threshold)
   */
  function hasMovedSignificantly(newLat, newLon, thresholdMeters = 1) {
    if (!lastPosition) return true;
    
    const distance = haversineDistance(
      lastPosition.lat, lastPosition.lon,
      newLat, newLon
    );
    
    return distance >= thresholdMeters;
  }

  // ============== PUBLIC API ==============

  const GPSTracking = {
    /**
     * Initialize the GPS tracking module
     */
    init,

    /**
     * Start GPS tracking
     */
    startTracking,

    /**
     * Stop GPS tracking
     */
    stopTracking,

    /**
     * Toggle tracking on/off
     */
    toggle,

    /**
     * Get current position once
     */
    getCurrentPosition,

    /**
     * Get position only if already permitted (no prompt)
     */
    getPositionIfPermitted,

    /**
     * Check if currently tracking
     */
    get isTracking() {
      return isTracking;
    },

    /**
     * Get last known position
     */
    get lastPosition() {
      return lastPosition ? { ...lastPosition } : null;
    },

    /**
     * Get permission state
     */
    get permissionState() {
      return permissionState;
    },

    /**
     * Check permission state (refreshes cached state)
     */
    checkPermissionState,

    /**
     * Utility: calculate distance between two points
     */
    haversineDistance,

    /**
     * Utility: check if position changed significantly
     */
    hasMovedSignificantly,

    /**
     * Set callback functions after init
     */
    setCallbacks(newCallbacks) {
      if (newCallbacks.onPosition) callbacks.onPosition = newCallbacks.onPosition;
      if (newCallbacks.onError) callbacks.onError = newCallbacks.onError;
      if (newCallbacks.onTrackingChange) callbacks.onTrackingChange = newCallbacks.onTrackingChange;
      if (newCallbacks.onFirstFix) callbacks.onFirstFix = newCallbacks.onFirstFix;
      if (newCallbacks.showToast) callbacks.showToast = newCallbacks.showToast;
    },

    /**
     * Set map manager reference
     */
    setMapManager(mm) {
      mapManager = mm;
    }
  };

  // ============== EXPORT ==============

  global.GPSTracking = GPSTracking;

  console.log('[geosonify] gps-tracking v1.0 loaded');

})(typeof window !== 'undefined' ? window : this);
