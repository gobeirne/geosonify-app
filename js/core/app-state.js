/**
 * geosonify-app-state.js v1.0
 * 
 * Central state management with pub/sub events.
 * Single source of truth for all application state.
 * 
 * Design principles:
 * - All state in one place
 * - Changes trigger events
 * - Subscribers react to changes
 * - State is serializable for persistence
 * 
 * Usage:
 *   AppState.set('coordinate', { lat: 51.5, lon: -0.1 });
 *   AppState.get('coordinate.lat'); // 51.5
 *   AppState.subscribe('coordinate', (value, path) => { ... });
 *   AppState.subscribe('*', (value, path) => { ... }); // All changes
 */

(function(global) {
  'use strict';

  // ============== STATE STRUCTURE ==============
  
  const DEFAULT_STATE = {
    // Current coordinate (the "pin" location)
    coordinate: {
      lat: null,
      lon: null
    },
    
    // Card system
    cards: {
      active: 'alphanumeric',
      visible: ['alphanumeric', 'emoji', 'chromacoord', 'music'],
      iterations: {},  // gridKey → iteration count
      order: []        // Display order
    },
    
    // Encoding settings
    encoding: {
      obfuscated: false,
      passphrase: '',
      rawMode: false,
      codec: 'raw',      // 'raw' | 'b36' | 'b64' | 'emo3'
      rounded: true,
      precision: 1,
      ultraAngle: false,
      lenExt: false,
      addChecksum: false
    },
    
    // Current shape (rectangle, circle, path, etc.)
    shape: {
      type: null,        // null | 'point' | 'rect' | 'circle' | 'path' | 'polygon' | 'graticule'
      centroid: null,    // [lat, lon]
      params: {}         // Type-specific: { L, S, thetaDeg } | { radius } | { points } | etc.
    },
    
    // Map state
    map: {
      center: [51.505, -0.09],
      zoom: 13,
      gpsPosition: null,   // { lat, lon, accuracy }
      tracking: false
    },
    
    // UI state
    ui: {
      activeTab: 'cards',  // 'cards' | 'shapes' | 'import'
      inputMode: 'single', // 'single' | 'multi'
      showStartEndMarkers: false
    },
    
    // Audio state
    audio: {
      playing: false,
      volume: -12,        // dB
      currentNotes: []
    }
  };

  // ============== INTERNAL STATE ==============
  
  let state = deepClone(DEFAULT_STATE);
  const subscribers = new Map();  // path → Set of callbacks
  const wildcardSubscribers = new Set();
  let batchDepth = 0;
  let batchedChanges = [];

  // ============== UTILITIES ==============

  /**
   * Deep clone an object (JSON-safe)
   */
  function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(deepClone);
    const clone = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clone[key] = deepClone(obj[key]);
      }
    }
    return clone;
  }

  /**
   * Get a value at a dot-separated path
   * @param {Object} obj - Object to traverse
   * @param {string} path - Dot-separated path (e.g., 'cards.active')
   * @returns {*} Value at path, or undefined
   */
  function getPath(obj, path) {
    if (!path) return obj;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }
    return current;
  }

  /**
   * Set a value at a dot-separated path (immutable-ish)
   * @param {Object} obj - Object to update
   * @param {string} path - Dot-separated path
   * @param {*} value - New value
   * @returns {Object} New object with updated value
   */
  function setPath(obj, path, value) {
    if (!path) return value;
    
    const parts = path.split('.');
    const result = deepClone(obj);
    let current = result;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === undefined || current[part] === null) {
        current[part] = {};
      }
      current = current[part];
    }
    
    current[parts[parts.length - 1]] = deepClone(value);
    return result;
  }

  /**
   * Check if two values are deeply equal
   */
  function deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    
    if (keysA.length !== keysB.length) return false;
    
    for (const key of keysA) {
      if (!keysB.includes(key)) return false;
      if (!deepEqual(a[key], b[key])) return false;
    }
    
    return true;
  }

  /**
   * Get all parent paths for a given path
   * 'cards.active' → ['cards.active', 'cards', '']
   */
  function getAncestorPaths(path) {
    const paths = [path];
    const parts = path.split('.');
    while (parts.length > 1) {
      parts.pop();
      paths.push(parts.join('.'));
    }
    paths.push(''); // Root
    return paths;
  }

  // ============== NOTIFICATION ==============

  /**
   * Notify subscribers of a change
   */
  function notifyChange(path, value, oldValue) {
    if (batchDepth > 0) {
      batchedChanges.push({ path, value, oldValue });
      return;
    }
    
    // Notify specific path subscribers
    const ancestorPaths = getAncestorPaths(path);
    for (const p of ancestorPaths) {
      const subs = subscribers.get(p);
      if (subs) {
        for (const callback of subs) {
          try {
            callback(p === path ? value : getPath(state, p), path, oldValue);
          } catch (err) {
            console.error(`[AppState] Subscriber error for "${p}":`, err);
          }
        }
      }
    }
    
    // Notify wildcard subscribers
    for (const callback of wildcardSubscribers) {
      try {
        callback(value, path, oldValue);
      } catch (err) {
        console.error('[AppState] Wildcard subscriber error:', err);
      }
    }
  }

  // ============== PUBLIC API ==============

  const AppState = {
    /**
     * Get value at path
     * @param {string} [path] - Dot-separated path. Omit for entire state.
     * @returns {*} Cloned value (safe to mutate)
     */
    get(path) {
      const value = path ? getPath(state, path) : state;
      return deepClone(value);
    },

    /**
     * Set value at path
     * @param {string} path - Dot-separated path
     * @param {*} value - New value
     * @returns {boolean} True if value changed
     */
    set(path, value) {
      const oldValue = getPath(state, path);
      
      // Skip if unchanged
      if (deepEqual(oldValue, value)) {
        return false;
      }
      
      state = setPath(state, path, value);
      notifyChange(path, value, oldValue);
      return true;
    },

    /**
     * Update multiple values in a path (merge)
     * @param {string} path - Dot-separated path to object
     * @param {Object} updates - Key-value pairs to merge
     */
    merge(path, updates) {
      const current = this.get(path) || {};
      if (typeof current !== 'object' || Array.isArray(current)) {
        throw new Error(`Cannot merge into non-object at "${path}"`);
      }
      this.set(path, { ...current, ...updates });
    },

    /**
     * Subscribe to changes at a path
     * @param {string} path - Path to watch ('' for root, '*' for all changes)
     * @param {Function} callback - (value, path, oldValue) => void
     * @returns {Function} Unsubscribe function
     */
    subscribe(path, callback) {
      if (typeof callback !== 'function') {
        throw new Error('Callback must be a function');
      }
      
      if (path === '*') {
        wildcardSubscribers.add(callback);
        return () => wildcardSubscribers.delete(callback);
      }
      
      if (!subscribers.has(path)) {
        subscribers.set(path, new Set());
      }
      subscribers.get(path).add(callback);
      
      return () => {
        const subs = subscribers.get(path);
        if (subs) {
          subs.delete(callback);
          if (subs.size === 0) {
            subscribers.delete(path);
          }
        }
      };
    },

    /**
     * Batch multiple updates (only notify once at end)
     * @param {Function} fn - Function that calls set/merge
     */
    batch(fn) {
      batchDepth++;
      try {
        fn();
      } finally {
        batchDepth--;
        if (batchDepth === 0 && batchedChanges.length > 0) {
          // Dedupe and notify
          const changes = batchedChanges;
          batchedChanges = [];
          
          // Group by path, keep last value
          const byPath = new Map();
          for (const change of changes) {
            byPath.set(change.path, change);
          }
          
          for (const change of byPath.values()) {
            notifyChange(change.path, change.value, change.oldValue);
          }
        }
      }
    },

    /**
     * Reset state to defaults
     * @param {string} [path] - Path to reset, or omit for full reset
     */
    reset(path) {
      if (path) {
        const defaultValue = getPath(DEFAULT_STATE, path);
        this.set(path, defaultValue);
      } else {
        const oldState = state;
        state = deepClone(DEFAULT_STATE);
        notifyChange('', state, oldState);
      }
    },

    /**
     * Serialize state for persistence
     * @returns {string} JSON string
     */
    serialize() {
      return JSON.stringify(state);
    },

    /**
     * Restore state from serialized form
     * @param {string} json - JSON string from serialize()
     * @param {boolean} [notify=true] - Whether to notify subscribers
     */
    restore(json, notify = true) {
      try {
        const parsed = JSON.parse(json);
        const oldState = state;
        
        // Merge with defaults to handle schema changes
        state = deepMergeWithDefaults(DEFAULT_STATE, parsed);
        
        if (notify) {
          notifyChange('', state, oldState);
        }
      } catch (err) {
        console.error('[AppState] Failed to restore state:', err);
      }
    },

    /**
     * Get subscriber count (for debugging)
     */
    get subscriberCount() {
      let count = wildcardSubscribers.size;
      for (const subs of subscribers.values()) {
        count += subs.size;
      }
      return count;
    }
  };

  /**
   * Deep merge parsed state with defaults (handles schema evolution)
   */
  function deepMergeWithDefaults(defaults, parsed) {
    if (parsed === null || parsed === undefined) return deepClone(defaults);
    if (typeof defaults !== 'object' || defaults === null) return parsed;
    if (Array.isArray(defaults)) return Array.isArray(parsed) ? parsed : defaults;
    
    const result = {};
    for (const key in defaults) {
      if (defaults.hasOwnProperty(key)) {
        result[key] = deepMergeWithDefaults(defaults[key], parsed[key]);
      }
    }
    // Include keys from parsed that aren't in defaults
    for (const key in parsed) {
      if (parsed.hasOwnProperty(key) && !defaults.hasOwnProperty(key)) {
        result[key] = parsed[key];
      }
    }
    return result;
  }

  // ============== EXPORT ==============

  global.AppState = AppState;

  // Log ready
  console.log('[geosonify] app-state v1.0 loaded');

})(typeof window !== 'undefined' ? window : this);
