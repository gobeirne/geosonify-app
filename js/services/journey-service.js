/**
 * geosonify-journey-service.js v1.0
 * 
 * Waypoint-based audio preset journey system.
 * Lerps between audio presets as user travels through waypoints.
 * 
 * Features:
 * - Multiple waypoints with associated presets
 * - Distance-based progress calculation (haversine)
 * - Smooth lerping between segments
 * - Persist journeys to localStorage
 * - Support for looping journeys
 * 
 * Usage:
 *   JourneyService.createJourney('commute', [
 *     { lat: 51.5, lon: -0.1, preset: 'calm_morning' },
 *     { lat: 51.51, lon: -0.12, preset: 'energetic' },
 *     { lat: 51.52, lon: -0.15, preset: 'arrival' }
 *   ]);
 *   JourneyService.startJourney('commute');
 *   // On GPS update:
 *   JourneyService.updatePosition(lat, lon);
 */

(function(global) {
  'use strict';

  // ============== STATE ==============

  let journeys = {};           // { name: { waypoints: [...], loop: bool, ... } }
  let activeJourney = null;    // Currently active journey name
  let currentSegment = 0;      // Index of current segment (between waypoints)
  let lastAppliedProgress = -1; // Avoid redundant updates
  let isActive = false;

  // ============== HAVERSINE DISTANCE ==============

  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const toRad = (deg) => deg * Math.PI / 180;
    
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c; // Distance in meters
  }

  // ============== SEGMENT CALCULATIONS ==============

  /**
   * Find which segment the user is on and their progress within it
   * Returns { segment: number, progress: 0-1, totalProgress: 0-1 }
   */
  function calculateProgress(lat, lon, waypoints) {
    if (!waypoints || waypoints.length < 2) {
      return { segment: 0, progress: 0, totalProgress: 0 };
    }

    // Calculate distance to each waypoint
    const distances = waypoints.map(wp => haversineDistance(lat, lon, wp.lat, wp.lon));
    
    // Find the two closest waypoints
    let minDist1 = Infinity, minDist2 = Infinity;
    let closest1 = 0, closest2 = 1;
    
    distances.forEach((d, i) => {
      if (d < minDist1) {
        minDist2 = minDist1;
        closest2 = closest1;
        minDist1 = d;
        closest1 = i;
      } else if (d < minDist2) {
        minDist2 = d;
        closest2 = i;
      }
    });
    
    // Ensure closest1 < closest2 for segment ordering
    if (closest1 > closest2) {
      [closest1, closest2, minDist1, minDist2] = [closest2, closest1, minDist2, minDist1];
    }
    
    // Handle edge cases
    if (closest1 === closest2) closest2 = closest1 + 1;
    if (closest2 >= waypoints.length) closest2 = waypoints.length - 1;
    if (closest1 >= waypoints.length - 1) closest1 = waypoints.length - 2;
    
    // Calculate segment progress
    const wp1 = waypoints[closest1];
    const wp2 = waypoints[closest2];
    const segmentLength = haversineDistance(wp1.lat, wp1.lon, wp2.lat, wp2.lon);
    
    // Project user position onto the segment line
    let segmentProgress;
    if (segmentLength < 1) {
      segmentProgress = 0;
    } else {
      // Use distance ratio with clamping
      const distToStart = haversineDistance(lat, lon, wp1.lat, wp1.lon);
      const distToEnd = haversineDistance(lat, lon, wp2.lat, wp2.lon);
      
      // Simple interpolation based on distances
      segmentProgress = distToStart / (distToStart + distToEnd);
      segmentProgress = Math.max(0, Math.min(1, segmentProgress));
    }
    
    // Calculate total progress through entire journey
    const numSegments = waypoints.length - 1;
    const totalProgress = (closest1 + segmentProgress) / numSegments;
    
    return {
      segment: closest1,
      segmentStart: closest1,
      segmentEnd: closest2,
      progress: segmentProgress,
      totalProgress: Math.max(0, Math.min(1, totalProgress)),
      distanceToNext: minDist2,
      distanceToPrev: minDist1
    };
  }

  /**
   * Get lerped params for current position between two waypoints
   */
  function getLerpedParams(waypoints, segmentIndex, progress) {
    const AudioService = global.AudioService;
    if (!AudioService) return null;
    
    const wp1 = waypoints[segmentIndex];
    const wp2 = waypoints[Math.min(segmentIndex + 1, waypoints.length - 1)];
    
    // Get preset params for each waypoint
    const params1 = AudioService.getPresetParams(wp1.preset) || AudioService.getSoundParams();
    const params2 = AudioService.getPresetParams(wp2.preset) || AudioService.getSoundParams();
    
    // Lerp between them
    return AudioService.lerpParams(params1, params2, progress);
  }

  // ============== SAVED WAYPOINTS (Bookmarks) ==============

  let savedWaypoints = {};

  function loadSavedWaypoints() {
    try {
      const stored = localStorage.getItem('geosonify_waypoints');
      if (stored) {
        savedWaypoints = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('[JourneyService] Failed to load waypoints:', e);
      savedWaypoints = {};
    }
  }

  function saveSavedWaypoints() {
    try {
      localStorage.setItem('geosonify_waypoints', JSON.stringify(savedWaypoints));
    } catch (e) {
      console.warn('[JourneyService] Failed to save waypoints:', e);
    }
  }

  // Load on init
  loadSavedWaypoints();

  // ============== PERSISTENCE ==============

  function saveJourneys() {
    try {
      localStorage.setItem('geosonify_journeys', JSON.stringify(journeys));
    } catch (e) {
      console.warn('[JourneyService] Failed to save journeys:', e);
    }
  }

  function loadJourneys() {
    try {
      const stored = localStorage.getItem('geosonify_journeys');
      if (stored) {
        journeys = JSON.parse(stored);
      }
    } catch (e) {
      console.warn('[JourneyService] Failed to load journeys:', e);
      journeys = {};
    }
  }

  // Load on init
  loadJourneys();

  // ============== PUBLIC API ==============

  const JourneyService = {
    /**
     * Create a new journey with waypoints
     * @param {string} name - Unique journey name
     * @param {Array} waypoints - Array of { lat, lon, preset, label? }
     * @param {Object} options - { loop: bool }
     */
    createJourney(name, waypoints, options = {}) {
      if (!name || !waypoints || waypoints.length < 2) {
        console.warn('[JourneyService] Invalid journey: need name and at least 2 waypoints');
        return false;
      }
      
      // Validate waypoints
      for (const wp of waypoints) {
        if (typeof wp.lat !== 'number' || typeof wp.lon !== 'number' || !wp.preset) {
          console.warn('[JourneyService] Invalid waypoint:', wp);
          return false;
        }
      }
      
      journeys[name] = {
        name,
        waypoints: waypoints.map((wp, i) => ({
          lat: wp.lat,
          lon: wp.lon,
          preset: wp.preset,
          label: wp.label || `Waypoint ${i + 1}`
        })),
        loop: options.loop || false,
        createdAt: new Date().toISOString()
      };
      
      saveJourneys();
      console.log('[JourneyService] Created journey:', name, 'with', waypoints.length, 'waypoints');
      return true;
    },

    /**
     * Update an existing journey
     */
    updateJourney(name, waypoints, options = {}) {
      if (!journeys[name]) {
        return this.createJourney(name, waypoints, options);
      }
      
      journeys[name].waypoints = waypoints.map((wp, i) => ({
        lat: wp.lat,
        lon: wp.lon,
        preset: wp.preset,
        label: wp.label || `Waypoint ${i + 1}`
      }));
      journeys[name].loop = options.loop || false;
      journeys[name].updatedAt = new Date().toISOString();
      
      saveJourneys();
      return true;
    },

    /**
     * Delete a journey
     */
    deleteJourney(name) {
      if (activeJourney === name) {
        this.stopJourney();
      }
      delete journeys[name];
      saveJourneys();
      return true;
    },

    /**
     * Get a journey by name
     */
    getJourney(name) {
      return journeys[name] ? { ...journeys[name] } : null;
    },

    /**
     * Get all journey names
     */
    getJourneyNames() {
      return Object.keys(journeys);
    },

    /**
     * Get all journeys
     */
    getAllJourneys() {
      return JSON.parse(JSON.stringify(journeys));
    },

    /**
     * Add a waypoint to an existing journey
     */
    addWaypoint(journeyName, waypoint, index = -1) {
      const journey = journeys[journeyName];
      if (!journey) return false;
      
      const wp = {
        lat: waypoint.lat,
        lon: waypoint.lon,
        preset: waypoint.preset,
        label: waypoint.label || `Waypoint ${journey.waypoints.length + 1}`
      };
      
      if (index < 0 || index >= journey.waypoints.length) {
        journey.waypoints.push(wp);
      } else {
        journey.waypoints.splice(index, 0, wp);
      }
      
      saveJourneys();
      return true;
    },

    /**
     * Remove a waypoint from a journey
     */
    removeWaypoint(journeyName, index) {
      const journey = journeys[journeyName];
      if (!journey || journey.waypoints.length <= 2) return false;
      
      journey.waypoints.splice(index, 1);
      saveJourneys();
      return true;
    },

    /**
     * Update a waypoint
     */
    updateWaypoint(journeyName, index, waypoint) {
      const journey = journeys[journeyName];
      if (!journey || index < 0 || index >= journey.waypoints.length) return false;
      
      journey.waypoints[index] = {
        ...journey.waypoints[index],
        ...waypoint
      };
      saveJourneys();
      return true;
    },

    /**
     * Start a journey
     */
    async startJourney(name) {
      const journey = journeys[name];
      if (!journey) {
        console.warn('[JourneyService] Journey not found:', name);
        return false;
      }
      
      activeJourney = name;
      currentSegment = 0;
      lastAppliedProgress = -1;
      isActive = true;
      
      // Setup dual-synth for first segment
      const firstPreset = journey.waypoints[0]?.preset || 'pad';
      const secondPreset = journey.waypoints[1]?.preset || firstPreset;
      
      if (global.AudioService) {
        await global.AudioService.setupJourney(firstPreset, secondPreset);
      }
      
      console.log('[JourneyService] Started journey:', name, 'segment 0:', firstPreset, '->', secondPreset);
      return true;
    },

    /**
     * Stop the active journey
     */
    stopJourney() {
      // Set crossfade to final position
      if (activeJourney && journeys[activeJourney] && global.AudioService) {
        const waypoints = journeys[activeJourney].waypoints;
        const lastPreset = waypoints[waypoints.length - 1]?.preset;
        if (lastPreset) {
          global.AudioService.setPresetA(lastPreset);
          global.AudioService.setCrossfade(0);
        }
      }
      
      activeJourney = null;
      currentSegment = 0;
      isActive = false;
      console.log('[JourneyService] Stopped journey');
    },

    /**
     * Check if a journey is active
     */
    isActive() {
      return isActive && activeJourney !== null;
    },

    /**
     * Get the active journey name
     */
    getActiveJourney() {
      return activeJourney;
    },

    /**
     * Update position and apply crossfade
     * Call this on each GPS update
     * @returns {Object} Progress info { segment, progress, totalProgress, applied }
     */
    async updatePosition(lat, lon) {
      if (!isActive || !activeJourney) {
        return null;
      }
      
      const journey = journeys[activeJourney];
      if (!journey) {
        this.stopJourney();
        return null;
      }
      
      // Calculate progress
      const progressInfo = calculateProgress(lat, lon, journey.waypoints);
      
      // Detect segment change - update the synth presets for new segment
      if (progressInfo.segment !== currentSegment) {
        console.log('[JourneyService] Segment changed:', currentSegment, '->', progressInfo.segment);
        currentSegment = progressInfo.segment;
        
        // Get presets for new segment
        const fromPreset = journey.waypoints[progressInfo.segment]?.preset || 'pad';
        const toIdx = Math.min(progressInfo.segment + 1, journey.waypoints.length - 1);
        const toPreset = journey.waypoints[toIdx]?.preset || fromPreset;
        
        // Setup new segment's presets
        if (global.AudioService) {
          await global.AudioService.setupJourney(fromPreset, toPreset);
        }
        
        lastAppliedProgress = progressInfo.totalProgress;
        return { ...progressInfo, applied: true, segmentChanged: true };
      }
      
      // Update crossfade based on segment progress
      // Only update if changed enough (avoid tiny updates)
      const progressDelta = Math.abs(progressInfo.progress - lastAppliedProgress);
      if (progressDelta < 0.01) {
        return { ...progressInfo, applied: false };
      }
      
      // Apply crossfade - this smoothly blends both synths
      if (global.AudioService) {
        global.AudioService.setJourneyProgress(progressInfo.progress);
        lastAppliedProgress = progressInfo.progress;
        
        return { ...progressInfo, applied: true };
      }
      
      return { ...progressInfo, applied: false };
    },

    /**
     * Get current progress info without applying changes
     */
    getProgress(lat, lon) {
      if (!isActive || !activeJourney) return null;
      
      const journey = journeys[activeJourney];
      if (!journey) return null;
      
      return calculateProgress(lat, lon, journey.waypoints);
    },

    /**
     * Preview lerped params at a specific position
     */
    previewAtPosition(journeyName, lat, lon) {
      const journey = journeys[journeyName];
      if (!journey) return null;
      
      const progressInfo = calculateProgress(lat, lon, journey.waypoints);
      const lerpedParams = getLerpedParams(
        journey.waypoints,
        progressInfo.segment,
        progressInfo.progress
      );
      
      return { ...progressInfo, params: lerpedParams };
    },

    /**
     * Preview lerped params at a specific progress (0-1)
     */
    previewAtProgress(journeyName, totalProgress) {
      const journey = journeys[journeyName];
      if (!journey) return null;
      
      const numSegments = journey.waypoints.length - 1;
      const scaledProgress = totalProgress * numSegments;
      const segment = Math.min(Math.floor(scaledProgress), numSegments - 1);
      const segmentProgress = scaledProgress - segment;
      
      const lerpedParams = getLerpedParams(journey.waypoints, segment, segmentProgress);
      
      return {
        segment,
        progress: segmentProgress,
        totalProgress,
        params: lerpedParams
      };
    },

    /**
     * Export journey as JSON
     */
    exportJourney(name) {
      const journey = journeys[name];
      return journey ? JSON.stringify(journey, null, 2) : null;
    },

    /**
     * Import journey from JSON
     */
    importJourney(json, newName = null) {
      try {
        const journey = JSON.parse(json);
        const name = newName || journey.name;
        
        if (!name || !journey.waypoints) {
          return false;
        }
        
        journeys[name] = {
          ...journey,
          name,
          importedAt: new Date().toISOString()
        };
        
        saveJourneys();
        return true;
      } catch (e) {
        console.error('[JourneyService] Import failed:', e);
        return false;
      }
    },

    /**
     * Calculate total journey distance in meters
     */
    getJourneyDistance(name) {
      const journey = journeys[name];
      if (!journey || journey.waypoints.length < 2) return 0;
      
      let total = 0;
      for (let i = 0; i < journey.waypoints.length - 1; i++) {
        const wp1 = journey.waypoints[i];
        const wp2 = journey.waypoints[i + 1];
        total += haversineDistance(wp1.lat, wp1.lon, wp2.lat, wp2.lon);
      }
      
      return total;
    },

    /**
     * Utility: haversine distance between two points
     */
    distance: haversineDistance,

    // ============== SAVED WAYPOINTS (Bookmarks) ==============

    /**
     * Save a location as a named waypoint
     * @param {string} name - Waypoint name
     * @param {number} lat - Latitude
     * @param {number} lon - Longitude  
     * @param {string} [preset] - Optional associated preset
     */
    saveWaypoint(name, lat, lon, preset = null) {
      if (!name || typeof lat !== 'number' || typeof lon !== 'number') {
        console.warn('[JourneyService] Invalid waypoint data');
        return false;
      }
      
      savedWaypoints[name] = {
        name,
        lat,
        lon,
        preset,
        createdAt: new Date().toISOString()
      };
      
      saveSavedWaypoints();
      console.log('[JourneyService] Saved waypoint:', name);
      return true;
    },

    /**
     * Get a saved waypoint by name
     */
    getWaypoint(name) {
      return savedWaypoints[name] ? { ...savedWaypoints[name] } : null;
    },

    /**
     * Get all saved waypoint names
     */
    getSavedWaypointNames() {
      return Object.keys(savedWaypoints);
    },

    /**
     * Get all saved waypoints
     */
    getAllSavedWaypoints() {
      return JSON.parse(JSON.stringify(savedWaypoints));
    },

    /**
     * Delete a saved waypoint
     */
    deleteSavedWaypoint(name) {
      if (!savedWaypoints[name]) return false;
      delete savedWaypoints[name];
      saveSavedWaypoints();
      return true;
    },

    /**
     * Rename a saved waypoint
     */
    renameSavedWaypoint(oldName, newName) {
      if (!savedWaypoints[oldName] || savedWaypoints[newName]) return false;
      savedWaypoints[newName] = { ...savedWaypoints[oldName], name: newName };
      delete savedWaypoints[oldName];
      saveSavedWaypoints();
      return true;
    }
  };

  // ============== EXPORT ==============

  global.JourneyService = JourneyService;

  console.log('[geosonify] journey-service v1.0 loaded');

})(typeof window !== 'undefined' ? window : this);
