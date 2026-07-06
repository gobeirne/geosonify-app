/**
 * geosonify-audio-service.js v6.1
 * 
 * v6.1 features:
 * - Note Event Bus: onNoteEvent/offNoteEvent for piano roll display and MIDI output
 * - NotePool Change Bus: onNotePoolChange/offNotePoolChange for y-axis updates
 * - State accessors: getNotePool, getCurrentBar, getCurrentBeat, getOctavePatterns
 * 
 * PATTERN EVOLUTION SYSTEM FOR DRONE MODE
 * 
 * v6.0 features:
 * - Pattern Evolution: Each octave maintains its own rhythmic pattern that evolves over time
 * - Polyrhythmic phasing: Patterns of different lengths (1-N bars) cycle independently
 * - Organic texture: Complexity builds gradually as octaves receive new patterns
 * - Dynamic slot count: Pattern slots match available GPS notes (2 or 3)
 * 
 * v5.5 fixes:
 * - Added setBPM, setHPF, setLPF, setReverbWet, setAttack, setRelease, setHumanize methods
 * - Settings now apply immediately when sliders change
 * - Default pad preset now uses 20Hz HPF and 20000Hz LPF
 * - Added isUserPreset() method for proper preset existence check
 * 
 * v5.4 fixes:
 * - Fixed initialization: now handles missing LazyLoad, falls back to window.Tone
 * - Fixed BPM sync: drone rhythm now actually follows BPM setting
 * 
 * Features:
 * 1. BPM-controlled update rate in drone mode
 * 2. Octave decay over time
 * 3. Movement detection for drone mode (fade out when stationary)
 * 4. Logarithmic (dB-based) crossfade for journeys
 * 5. Pattern evolution system with polyrhythmic phasing
 */

(function(global) {
  'use strict';

  let Tone = null;
  let isInitialized = false;
  let isPlaying = false;

  // ============== DUAL SYNTH CHAINS ==============
  
  // Chain A
  let synthA = null;
  let hpFilterA = null;
  let lpFilterA = null;
  let reverbA = null;
  let volumeA = null;
  
  // Chain B
  let synthB = null;
  let hpFilterB = null;
  let lpFilterB = null;
  let reverbB = null;
  let volumeB = null;
  
  // Master output
  let masterVolume = null;

  // ============== CROSSFADE STATE ==============
  
  let crossfade = 0;  // 0 = 100% A, 1 = 100% B
  let presetA = 'crystal';
  let presetB = 'pad';
  
  // Cached params for each side
  let paramsA = null;
  let paramsB = null;

  // ============== NOTE POOL & TIMING ==============
  
  let notePool = [];
  let lastGPSTime = 0;
  const GPS_STALE_MS = 7000;
  let testMode = false;
  
  // BPM clock state
  let currentBeat = 0;
  let currentBar = 0;
  let barsUntilRefresh = 4;
  
  // Octave behaviors (randomized per refresh)
  let octaveBehaviors = {};

  // ============== DRONE MODE ENHANCEMENTS ==============
  
  // Per-octave volume nodes for decay control
  let octaveVolumeNodesA = {};
  let octaveVolumeNodesB = {};
  
  // Track active drone notes per octave with their start times
  let droneNotesByOctave = new Map(); // octave -> Map(note -> { startTime, gainNodeA, gainNodeB })
  
  // Drone mode timing
  let droneUpdateScheduleId = null;
  let lastDroneUpdateTime = 0;
  let droneIsEighth = false; // true when we're on the "and" (0.5 beat)
  
  // Movement detection state
  let lastMovementTime = 0;
  let lastCoordChangeTime = 0;  // Track when coordinates last changed
  let lastCoordString = '';      // Track last coordinate string to detect changes
  let movementThresholdMeters = 2; // Minimum movement to count as "moving"
  let stationaryFadeStartMs = 60000; // Start fading after 60 seconds stationary
  let stationaryFadeTimeMs = 30000; // Fully faded after additional 30 seconds
  let currentDroneVolumeReduction = 0; // dB reduction due to being stationary

  // ============== NOTE EVENT BUS ==============
  // Listeners for note triggers (piano roll display, future MIDI output)
  let noteEventListeners = [];
  // Listeners for notePool changes (piano roll y-axis update)
  let notePoolChangeListeners = [];

  let noteEventEmitCount = 0;

  function emitNoteEvent(note, duration, velocity, time, meta) {
    if (noteEventListeners.length === 0) return;
    if (noteEventEmitCount < 3) {
      console.log('[AudioService] emitNoteEvent:', note, 'dur:', duration, 'vel:', velocity, 'listeners:', noteEventListeners.length, 'meta:', meta);
      noteEventEmitCount++;
    }
    const event = { note, duration, velocity, time, bar: droneCurrentBar, beat: droneBeatCount + (droneIsEighth ? 0.5 : 0) };
    if (meta) {
      event.octave = meta.octave;
      event.slotIndex = meta.slotIndex;
    }
    for (let i = 0; i < noteEventListeners.length; i++) {
      try { noteEventListeners[i](event); } catch (e) {
        console.warn('[AudioService] Note event listener error:', e);
      }
    }
  }

  function emitNotePoolChange(pool) {
    if (notePoolChangeListeners.length === 0) return;
    const snapshot = pool.map(arr => arr ? [...arr] : []);
    for (let i = 0; i < notePoolChangeListeners.length; i++) {
      try { notePoolChangeListeners[i](snapshot); } catch (e) {
        console.warn('[AudioService] NotePool change listener error:', e);
      }
    }
  }

  // ============== PATTERN EVOLUTION STATE ==============
  
  // Per-octave pattern state
  let octavePatterns = {};  // octave -> { slots, lengthBars, noteOrder, noteCount }
  
  // Evolution tracking
  let lastChangedOctave = null;     // For adjacent mode selection
  let evolutionBarCounter = 0;       // Counts toward next evolution event
  let pendingPatternChange = null;   // { octave, pattern } to apply at next bar boundary
  
  // Melodic octave queue - FIFO tracking which octaves have non-default patterns
  let melodicOctaveQueue = [];       // Array of octave numbers in order they became melodic
  
  // Duration values in beats
  const DURATION_BEATS = {
    whole: 4,
    half: 2,
    quarter: 1,
    eighth: 0.5
  };
  const DURATION_NAMES = ['whole', 'half', 'quarter', 'eighth'];

  // ============== SETTINGS ==============
  
  // These are the "current" blended settings
  let settings = {
    bpm: 100,
    timeSignature: [4, 4],
    patternRefreshBars: 4,
    patternRefreshRandom: false,
    patternRefreshMin: 2,
    patternRefreshMax: 8,
    humanize: 0.1,
    accelerationSensitivity: 0.3,
    transpose: 0,
    droneMode: true,
    masterVolume: -12,
    
    // Drone mode enhancements
    droneBPMEnabled: true,       // Use BPM to control drone update rate
    droneBPMDivisor: 4,           // Update every N beats (1 = every beat, 4 = every bar in 4/4)
    droneDecayEnabled: true,     // Enable octave decay over time
    droneDecayBars: 8,            // Number of bars for decay
    droneDecayTargetDb: 0,      // Target dB for decayed octaves
    droneMovementFade: true,     // Fade out when stationary
    
    // Pattern evolution settings
    patternEvolutionEnabled: true,    // Enable pattern evolution system
    patternEvolutionBars: 8,          // Bars between evolution events
    octaveSelectionMode: 'adjacent',  // 'adjacent' or 'random'
    maxPatternBars: 4,                // Maximum length of generated patterns (1-8)
    beatAlignNotes: false,            // Quantize note starts to beat boundaries
    maxMelodicOctaves: 3,             // Max octaves with patterns (rest stay whole notes)
    resetAnchorOctave: 4,             // When this octave is selected, reset all to whole notes
    
    // Journey crossfade mode
    journeyCrossfadeLogarithmic: true, // Use dB-based crossfade for journeys
    
    // Per-side settings (updated during crossfade)
    A: {
      oscillator: { type: 'fatsine', spread: 20, count: 3 },
      envelope: { attack: 0.3, decay: 0.5, sustain: 0.7, release: 3.0 },
      hpFreq: 20,
      lpFreq: 20000,
      reverbDecay: 4.0,
      reverbWet: 0.7,
      volume: 0,  // Relative to crossfade
      timeSignature: [4, 4],
      bpm: 100,
      humanize: 0.1
    },
    B: {
      oscillator: { type: 'fatsine', spread: 20, count: 3 },
      envelope: { attack: 0.3, decay: 0.5, sustain: 0.7, release: 3.0 },
      hpFreq: 20,
      lpFreq: 20000,
      reverbDecay: 4.0,
      reverbWet: 0.7,
      volume: 0,
      timeSignature: [4, 4],
      bpm: 100,
      humanize: 0.1
    },
    
    octaves: {
      0: { intensity: 0, updateFraction: 1, mode: 'random', duration: 'random' },
      1: { intensity: 0, updateFraction: 1, mode: 'random', duration: 'random' },
      2: { intensity: 0, updateFraction: 1, mode: 'random', duration: 'random' },
      3: { intensity: 0, updateFraction: 1, mode: 'random', duration: 'random' },
      4: { intensity: 0, updateFraction: 1, mode: 'random', duration: 'random' },
      5: { intensity: 0, updateFraction: 1, mode: 'random', duration: 'random' },
      6: { intensity: 0, updateFraction: 1, mode: 'random', duration: 'random' },
      7: { intensity: 0, updateFraction: 1, mode: 'random', duration: 'random' },
      8: { intensity: 0, updateFraction: 1, mode: 'random', duration: 'random' },
      9: { intensity: 0, updateFraction: 1, mode: 'random', duration: 'random' }
    }
  };

  // ============== PRESETS ==============
  
  const PRESETS = {
    crystal: {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.4, release: 1.5 },
      hpFreq: 20, lpFreq: 20000, reverbDecay: 2.5, reverbWet: 0.3, volume: -8,
      bpm: 120, humanize: 0.05, timeSignature: [4, 4]
    },
    ambient: {
      oscillator: { type: 'fatsine', spread: 15, count: 3 },
      envelope: { attack: 0.5, decay: 0.8, sustain: 0.6, release: 4.0 },
      hpFreq: 20, lpFreq: 20000, reverbDecay: 5.0, reverbWet: 0.5, volume: -10,
      bpm: 90, humanize: 0.15, timeSignature: [4, 4]
    },
    warm: {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.2, decay: 0.4, sustain: 0.5, release: 2.5 },
      hpFreq: 20, lpFreq: 20000, reverbDecay: 3.0, reverbWet: 0.35, volume: -6,
      bpm: 100, humanize: 0.1, timeSignature: [4, 4]
    },
    pad: {
      oscillator: { type: 'fatsine', spread: 20, count: 3 },
      envelope: { attack: 0.3, decay: 0.5, sustain: 0.7, release: 3.0 },
      hpFreq: 20, lpFreq: 20000, reverbDecay: 4.0, reverbWet: 0.4, volume: -8,
      bpm: 100, humanize: 0.1, timeSignature: [4, 4]
    },
    frenetic: {
      oscillator: { type: 'fatsawtooth', spread: 25, count: 4 },
      envelope: { attack: 0.02, decay: 0.2, sustain: 0.3, release: 0.8 },
      hpFreq: 20, lpFreq: 20000, reverbDecay: 1.5, reverbWet: 0.25, volume: -10,
      bpm: 140, humanize: 0.2, timeSignature: [4, 4]
    },
    meditation: {
      oscillator: { type: 'sine' },
      envelope: { attack: 1.0, decay: 1.0, sustain: 0.8, release: 6.0 },
      hpFreq: 20, lpFreq: 20000, reverbDecay: 8.0, reverbWet: 0.6, volume: -12,
      bpm: 60, humanize: 0.05, timeSignature: [3, 4]
    },
    glitch: {
      oscillator: { type: 'fatsquare', spread: 30, count: 2 },
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.2, release: 0.3 },
      hpFreq: 20, lpFreq: 20000, reverbDecay: 1.0, reverbWet: 0.2, volume: -14,
      bpm: 130, humanize: 0.3, timeSignature: [7, 8]
    },
    ethereal: {
      oscillator: { type: 'fattriangle', spread: 35, count: 5 },
      envelope: { attack: 0.8, decay: 1.2, sustain: 0.6, release: 5.0 },
      hpFreq: 20, lpFreq: 20000, reverbDecay: 6.0, reverbWet: 0.55, volume: -10,
      bpm: 75, humanize: 0.08, timeSignature: [6, 8]
    }
  };

  // User presets from localStorage
  let userPresets = {};
  const USER_PRESETS_KEY = 'geosonify_audio_presets';

  function loadUserPresets() {
    try {
      const stored = localStorage.getItem(USER_PRESETS_KEY);
      if (stored) userPresets = JSON.parse(stored);
    } catch (e) {
      console.warn('[AudioService] Failed to load user presets:', e);
    }
  }

  function saveUserPresets() {
    try {
      localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(userPresets));
    } catch (e) {
      console.warn('[AudioService] Failed to save user presets:', e);
    }
  }

  loadUserPresets();

  // ============== OSCILLATOR TYPES ==============
  
  const OSCILLATOR_TYPES = [
    'sine', 'triangle', 'sawtooth', 'square',
    'fatsine', 'fattriangle', 'fatsawtooth', 'fatsquare'
  ];

  // ============== HELPERS ==============

  function isGPSFresh() {
    if (testMode) return true;
    return (Date.now() - lastGPSTime) < GPS_STALE_MS;
  }

  function getPreset(name) {
    return userPresets[name] || PRESETS[name] || PRESETS.pad;
  }

  /**
   * Equal-power crossfade curve (for BPM clock mode)
   * At 0: A=1, B=0
   * At 0.5: A≈0.707, B≈0.707 (equal loudness)
   * At 1: A=0, B=1
   */
  function equalPowerCrossfade(xfade) {
    const angle = xfade * Math.PI / 2;
    return {
      a: Math.cos(angle),
      b: Math.sin(angle)
    };
  }

  /**
   * Logarithmic (dB-based) crossfade for journeys
   * At 0: A = 0dB, B = -144dB (silence)
   * At 0.5: A = -3dB, B = -3dB (both equally attenuated)
   * At 1: A = -144dB (silence), B = 0dB
   * 
   * This gives a more gradual, natural-sounding transition where
   * the destination preset doesn't become apparent until you're
   * closer to the destination.
   */
  function logarithmicCrossfade(xfade) {
    // Use -144dB as effective silence (24-bit noise floor)
    const SILENCE_DB = -144;
    
    // At position 0: A is full (0dB), B is silent (-144dB)
    // At position 0.5: Both are at -3dB
    // At position 1: A is silent (-144dB), B is full (0dB)
    
    // For A: 0dB at xfade=0, -3dB at xfade=0.5, -144dB at xfade=1
    // For B: -144dB at xfade=0, -3dB at xfade=0.5, 0dB at xfade=1
    
    let dbA, dbB;
    
    if (xfade <= 0.5) {
      // First half: A fades from 0 to -3dB, B fades from -144 to -3dB
      const t = xfade * 2; // 0 to 1 over first half
      dbA = 0 + t * (-3 - 0); // 0 to -3
      dbB = SILENCE_DB + t * (-3 - SILENCE_DB); // -144 to -3
    } else {
      // Second half: A fades from -3 to -144dB, B fades from -3 to 0dB
      const t = (xfade - 0.5) * 2; // 0 to 1 over second half
      dbA = -3 + t * (SILENCE_DB - (-3)); // -3 to -144
      dbB = -3 + t * (0 - (-3)); // -3 to 0
    }
    
    return { dbA, dbB };
  }

  /**
   * Apply crossfade volumes to both chains
   */
  function applyCrossfadeVolumes() {
    if (!volumeA || !volumeB) return;
    
    if (settings.journeyCrossfadeLogarithmic) {
      // Use logarithmic crossfade for journeys
      const { dbA, dbB } = logarithmicCrossfade(crossfade);
      volumeA.volume.value = dbA + (paramsA?.volume || 0);
      volumeB.volume.value = dbB + (paramsB?.volume || 0);
    } else {
      // Use equal-power crossfade (original behavior)
      const { a, b } = equalPowerCrossfade(crossfade);
      
      // Convert to dB (with floor to avoid -Infinity)
      const dbA = a > 0.001 ? 20 * Math.log10(a) : -60;
      const dbB = b > 0.001 ? 20 * Math.log10(b) : -60;
      
      volumeA.volume.value = dbA + (paramsA?.volume || 0);
      volumeB.volume.value = dbB + (paramsB?.volume || 0);
    }
  }

  /**
   * Get lerped value
   */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /**
   * Probabilistic time signature selection
   * Returns true if should use A's time signature, false for B's
   */
  function shouldUseTimeSignatureA() {
    return Math.random() > crossfade;
  }

  /**
   * Calculate haversine distance between two lat/lon points
   */
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

  // ============== SYNTH CHAIN CREATION ==============

  function createOscillatorConfig(oscSettings) {
    if (oscSettings.type.startsWith('fat')) {
      return {
        type: oscSettings.type,
        spread: oscSettings.spread || 20,
        count: oscSettings.count || 3
      };
    }
    return { type: oscSettings.type };
  }

  async function createSynthChain(preset, label) {
    const p = getPreset(preset);
    
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: createOscillatorConfig(p.oscillator || { type: 'sine' }),
      envelope: p.envelope || { attack: 0.3, decay: 0.5, sustain: 0.7, release: 3.0 },
      maxPolyphony: 64  // Increased from 32 to handle dual chains
    });
    
    const hpFilter = new Tone.Filter(p.hpFreq || 80, 'highpass');
    const lpFilter = new Tone.Filter(p.lpFreq || 8000, 'lowpass');
    const reverb = new Tone.Reverb({
      decay: p.reverbDecay || 4.0,
      wet: p.reverbWet || 0.4
    });
    const vol = new Tone.Volume(-60); // Start silent
    
    synth.chain(hpFilter, lpFilter, reverb, vol, masterVolume);
    
    await reverb.ready;
    
    console.log(`[AudioService] Created chain ${label} with preset:`, preset);
    
    return { synth, hpFilter, lpFilter, reverb, volume: vol, params: p };
  }

  async function rebuildChain(which, preset) {
    const isA = which === 'A';
    
    // Dispose old chain
    if (isA) {
      synthA?.dispose();
      hpFilterA?.dispose();
      lpFilterA?.dispose();
      reverbA?.dispose();
      volumeA?.dispose();
    } else {
      synthB?.dispose();
      hpFilterB?.dispose();
      lpFilterB?.dispose();
      reverbB?.dispose();
      volumeB?.dispose();
    }
    
    // Create new chain
    const chain = await createSynthChain(preset, which);
    
    if (isA) {
      synthA = chain.synth;
      hpFilterA = chain.hpFilter;
      lpFilterA = chain.lpFilter;
      reverbA = chain.reverb;
      volumeA = chain.volume;
      paramsA = chain.params;
      presetA = preset;
      settings.A = { ...settings.A, ...chain.params };
    } else {
      synthB = chain.synth;
      hpFilterB = chain.hpFilter;
      lpFilterB = chain.lpFilter;
      reverbB = chain.reverb;
      volumeB = chain.volume;
      paramsB = chain.params;
      presetB = preset;
      settings.B = { ...settings.B, ...chain.params };
    }
    
    // Reapply crossfade volumes
    applyCrossfadeVolumes();
  }

  // ============== NOTE TRIGGERING ==============

  /**
   * Trigger a note on BOTH synth chains with precise timing
   * @param {string} note - Note name e.g. "G4"
   * @param {number|string} duration - Duration in seconds
   * @param {number} velocity - 0-1
   * @param {number} [time] - Tone.js time
   * @param {Object} [meta] - Optional metadata for event bus (octave index, slot index)
   */
  function triggerNote(note, duration, velocity = 0.7, time = undefined, meta = undefined) {
    const t = time !== undefined ? time : Tone.now();
    
    // Apply stationary volume reduction if movement fade is enabled
    const stationaryMod = settings.droneMovementFade ? currentDroneVolumeReduction : 0;
    const adjustedVelocity = velocity * Math.pow(10, stationaryMod / 20);
    
    // Trigger on A if audible
    if (crossfade < 0.99 && synthA) {
      try {
        synthA.triggerAttackRelease(note, duration, t, adjustedVelocity);
      } catch (e) {
        // Note already playing or other issue
      }
    }
    
    // Trigger on B if audible
    if (crossfade > 0.01 && synthB) {
      try {
        synthB.triggerAttackRelease(note, duration, t, adjustedVelocity);
      } catch (e) {
        // Note already playing or other issue
      }
    }

    // Emit note event for piano roll display / MIDI output
    emitNoteEvent(note, duration, adjustedVelocity, t, meta);
  }

  /**
   * Trigger chord on both chains
   */
  function triggerChord(notes, duration, velocity = 0.7, time = undefined) {
    notes.forEach(note => triggerNote(note, duration, velocity, time));
  }

  // ============== BPM CLOCK (using Tone.Transport) ==============

  let speedHistory = [];
  let lastSpeed = null;
  let transportScheduleId = null;

  function getAcceleration() {
    if (speedHistory.length < 2) return 0;
    const recent = speedHistory.slice(-5);
    const diffs = [];
    for (let i = 1; i < recent.length; i++) {
      diffs.push(recent[i] - recent[i-1]);
    }
    return diffs.reduce((a, b) => a + b, 0) / diffs.length;
  }

  function randomizeOctaveBehaviors() {
    for (let oct = 0; oct <= 9; oct++) {
      const base = settings.octaves[oct] || { mode: 'random', duration: 'random' };
      
      let mode = base.mode;
      if (mode === 'random') {
        const modes = ['single', 'chord', 'arpeggio'];
        mode = modes[Math.floor(Math.random() * modes.length)];
      }
      
      let duration = base.duration;
      if (duration === 'random') {
        duration = Math.floor(Math.random() * 4) + 1;
      }
      
      octaveBehaviors[oct] = { mode, duration };
    }
  }

  function getCurrentTimeSignature() {
    if (shouldUseTimeSignatureA()) {
      return settings.A.timeSignature || [4, 4];
    } else {
      return settings.B.timeSignature || [4, 4];
    }
  }

  function getCurrentBPM() {
    const bpmA = settings.A.bpm || 100;
    const bpmB = settings.B.bpm || 100;
    return Math.round(lerp(bpmA, bpmB, crossfade));
  }

  function getCurrentHumanize() {
    const humA = settings.A.humanize || 0.1;
    const humB = settings.B.humanize || 0.1;
    return lerp(humA, humB, crossfade);
  }

  function startBPMClock() {
    if (transportScheduleId !== null) return;
    
    randomizeOctaveBehaviors();
    barsUntilRefresh = settings.patternRefreshBars;
    
    // Set initial BPM
    Tone.Transport.bpm.value = getCurrentBPM();
    
    // Schedule repeating beat
    transportScheduleId = Tone.Transport.scheduleRepeat((time) => {
      if (!isPlaying || !isGPSFresh()) return;
      
      const timeSig = getCurrentTimeSignature();
      const beatsPerBar = timeSig[0];
      
      // Apply humanization as slight timing offset
      const humanize = getCurrentHumanize();
      const humanizedOffset = humanize * 0.1 * (Math.random() - 0.5);
      
      // Play the beat with humanized timing
      playBeat(currentBeat, beatsPerBar, time + humanizedOffset);
      
      currentBeat++;
      if (currentBeat >= beatsPerBar) {
        currentBeat = 0;
        currentBar++;
        barsUntilRefresh--;
        
        if (barsUntilRefresh <= 0) {
          randomizeOctaveBehaviors();
          if (settings.patternRefreshRandom) {
            barsUntilRefresh = Math.floor(Math.random() * 
              (settings.patternRefreshMax - settings.patternRefreshMin + 1)) + 
              settings.patternRefreshMin;
          } else {
            barsUntilRefresh = settings.patternRefreshBars;
          }
        }
      }
      
      // Update BPM smoothly (lerp towards target)
      const targetBPM = getCurrentBPM();
      if (Math.abs(Tone.Transport.bpm.value - targetBPM) > 1) {
        Tone.Transport.bpm.rampTo(targetBPM, 0.5);
      }
    }, "4n"); // Quarter note intervals
    
    Tone.Transport.start();
  }

  function stopBPMClock() {
    if (transportScheduleId !== null) {
      Tone.Transport.clear(transportScheduleId);
      transportScheduleId = null;
    }
    Tone.Transport.stop();
    currentBeat = 0;
    currentBar = 0;
  }

  function playBeat(beatIndex, beatsPerBar, time) {
    if (notePool.length === 0) return;
    
    const accel = getAcceleration();
    const accelInfluence = settings.accelerationSensitivity;
    
    // Lerp envelope release for duration calculation
    const releaseA = settings.A.envelope?.release || 3.0;
    const releaseB = settings.B.envelope?.release || 3.0;
    const currentRelease = lerp(releaseA, releaseB, crossfade);
    
    const bpm = getCurrentBPM();
    const beatDuration = 60 / bpm;
    
    for (let octave = 0; octave < notePool.length; octave++) {
      const octaveNotes = notePool[octave];
      if (!octaveNotes || octaveNotes.length === 0) continue;
      
      const octaveSettings = settings.octaves[octave] || {};
      const behavior = octaveBehaviors[octave] || { mode: 'single', duration: 2 };
      const updateFraction = octaveSettings.updateFraction || 2;
      
      // Probability check
      if (Math.random() > (1 / updateFraction)) continue;
      
      // Get notes to play
      let notesToPlay = [];
      const baseOctave = octave + settings.transpose;
      
      if (behavior.mode === 'single') {
        const note = octaveNotes[Math.floor(Math.random() * octaveNotes.length)];
        notesToPlay = [`${note}${baseOctave}`];
      } else if (behavior.mode === 'chord') {
        notesToPlay = octaveNotes.slice(0, 3).map(n => `${n}${baseOctave}`);
      } else if (behavior.mode === 'arpeggio') {
        let idx = beatIndex % octaveNotes.length;
        if (accel * accelInfluence < -0.1) {
          idx = (octaveNotes.length - 1) - idx;
        }
        notesToPlay = [`${octaveNotes[idx]}${baseOctave}`];
      }
      
      // Calculate duration
      const durationBeats = behavior.duration;
      const duration = Math.min(durationBeats * beatDuration, currentRelease * 0.8);
      
      // Intensity (lerp between sides)
      const intensityMod = octaveSettings.intensity || 0;
      const velocity = Math.max(0.1, Math.min(1, 0.7 + (intensityMod / 20)));
      
      // Trigger notes on both chains with precise timing
      notesToPlay.forEach(note => {
        triggerNote(note, duration, velocity, time);
      });
    }
  }

  // ============== ENHANCED DRONE MODE ==============

  let droneNotes = new Map();
  let droneOctaveStartBars = {}; // Track when each octave's current notes started
  let droneCurrentBar = 0;
  let droneBeatCount = 0;

  /**
   * Calculate decay factor for an octave based on how many bars since notes changed
   * Returns a dB reduction (0 = full volume, settings.droneDecayTargetDb = fully decayed)
   */
  function getOctaveDecayDb(octave) {
    if (!settings.droneDecayEnabled) return 0;
    
    const startBar = droneOctaveStartBars[octave] || droneCurrentBar;
    const barsElapsed = droneCurrentBar - startBar;
    
    if (barsElapsed >= settings.droneDecayBars) {
      return settings.droneDecayTargetDb;
    }
    
    // Linear interpolation in dB space
    const progress = barsElapsed / settings.droneDecayBars;
    return progress * settings.droneDecayTargetDb;
  }

  /**
   * Check if coordinates have changed (called from setMusicalCode)
   */
  function checkCoordinateChange(code) {
    if (code !== lastCoordString) {
      lastCoordString = code;
      lastCoordChangeTime = Date.now();
      lastMovementTime = Date.now();
      return true;
    }
    return false;
  }

  /**
   * Calculate volume reduction based on stationary time
   * "Stationary" = coordinates haven't changed in X seconds
   */
  function calculateStationaryVolumeReduction() {
    if (!settings.droneMovementFade) {
      currentDroneVolumeReduction = 0;
      return 0;
    }
    
    const now = Date.now();
    const timeSinceChange = now - lastCoordChangeTime;
    
    if (timeSinceChange < stationaryFadeStartMs) {
      // Still within grace period, no fade
      currentDroneVolumeReduction = 0;
      return 0;
    }
    
    // Calculate fade progress
    const fadeElapsed = timeSinceChange - stationaryFadeStartMs;
    const fadeProgress = Math.min(1, fadeElapsed / stationaryFadeTimeMs);
    
    // Fade to silence (-60dB is effectively silent)
    currentDroneVolumeReduction = fadeProgress * -60;
    return currentDroneVolumeReduction;
  }

  /**
   * Update drone notes - called on each beat tick
   * 
   * PATTERN EVOLUTION STRATEGY:
   * - Each octave has its own rhythmic pattern that loops independently
   * - Patterns define when notes trigger within their cycle
   * - GPS provides the actual pitches; patterns provide rhythm
   * - Notes are triggered with triggerAttackRelease for precise duration control
   * - Triplet patterns use tolerance-based timing to trigger on nearest tick
   */
  function updateDroneNotes() {
    if (!settings.droneMode || notePool.length === 0) return;
    
    // Ensure patterns are initialized
    if (Object.keys(octavePatterns).length === 0) {
      initializeOctavePatterns();
    }
    
    // Refresh currentDroneVolumeReduction; the fade itself is
    // applied exactly once, inside triggerNote()
    if (settings.droneMovementFade) calculateStationaryVolumeReduction();
    
    // Current beat position (0, 1, 2, 3 in quarter note resolution)
    const currentBeat = getCurrentBeatInBar();
    
    // Process each octave's pattern
    for (let octave = 0; octave < notePool.length; octave++) {
      const octaveNotes = notePool[octave];
      if (!octaveNotes || octaveNotes.length === 0) continue;
      
      // Check if note count changed and update pattern if needed
      if (settings.patternEvolutionEnabled) {
        updatePatternForNoteCount(octave, octaveNotes.length);
      }
      
      const pattern = octavePatterns[octave];
      if (!pattern) continue;
      
      // Calculate which bar we're in within this pattern's cycle
      const patternBar = droneCurrentBar % pattern.lengthBars;
      
      const baseOctave = octave + settings.transpose;
      const octaveSettings = settings.octaves[octave] || { intensity: 0 };
      
      // Calculate velocity for this octave
      const intensityDb = octaveSettings.intensity || 0;
      const decayDb = getOctaveDecayDb(octave);
      const totalDb = intensityDb + decayDb;
      const octaveVelocity = 0.6 * Math.pow(10, totalDb / 20);
      const velocity = Math.max(0.05, Math.min(1, octaveVelocity));
      
      // Find slots that should trigger RIGHT NOW
      for (const slot of pattern.slots) {
        if (slot.bar !== patternBar) continue;
        if (slot.type !== 'note') continue;
        
        // Check if this slot triggers on this beat
        // For triplets, use tolerance; for regular notes, exact match
        let shouldTrigger = false;
        
        if (slot.isTriplet) {
          // Triplet: trigger if we're within 0.25 beats of the target
          // This catches triplet times on the nearest eighth-note tick
          const tolerance = 0.25;
          if (Math.abs(slot.startBeat - currentBeat) < tolerance) {
            shouldTrigger = true;
          }
        } else {
          // Regular note: exact match on integer beats
          shouldTrigger = (slot.startBeat === currentBeat);
        }
        
        if (shouldTrigger) {
          const noteName = mapSlotToNote(slot.slotIndex, octaveNotes, pattern);
          if (noteName) {
            const fullNote = `${noteName}${baseOctave}`;
            
            // Calculate duration in seconds based on BPM
            const bpm = getCurrentBPM();
            const beatDuration = 60 / bpm;
            const durationSeconds = slot.duration * beatDuration;
            
            // Trigger note via central function (feeds synths + event bus)
            triggerNote(fullNote, durationSeconds, velocity, undefined, { octave, slotIndex: slot.slotIndex });
          }
        }
      }
    }
    
    // Update octave decay tracking (still based on GPS changes, not pattern changes)
    for (let octave = 0; octave < notePool.length; octave++) {
      const oldNotes = droneNotesByOctave.get(octave);
      const newNotes = notePool[octave];
      if (!oldNotes || !setsEqual(new Set(oldNotes), new Set(newNotes || []))) {
        droneOctaveStartBars[octave] = droneCurrentBar;
      }
      droneNotesByOctave.set(octave, newNotes ? [...newNotes] : []);
    }
  }
  
  /**
   * Legacy updateDroneNotes for non-pattern mode (BPM sync without evolution)
   * Uses the original simple cycling behavior
   */
  function updateDroneNotesLegacy() {
    if (!settings.droneMode || notePool.length === 0) return;
    
    // Calculate stationary volume reduction (only if movement fade enabled)
    let stationaryMod = 1.0;
    if (settings.droneMovementFade) {
      const stationaryDb = calculateStationaryVolumeReduction();
      stationaryMod = Math.pow(10, stationaryDb / 20);
    }
    
    // Build the target notes - ONE note per octave
    const targetNotes = new Map(); // note -> { octave, velocity }
    
    for (let octave = 0; octave < notePool.length; octave++) {
      const octaveNotes = notePool[octave];
      if (!octaveNotes || octaveNotes.length === 0) continue;
      
      const baseOctave = octave + settings.transpose;
      const octaveSettings = settings.octaves[octave] || { intensity: 0 };
      
      // Calculate velocity for this octave
      const intensityDb = octaveSettings.intensity || 0;
      const decayDb = getOctaveDecayDb(octave);
      const totalDb = intensityDb + decayDb;
      const octaveVelocity = 0.6 * Math.pow(10, totalDb / 20) * stationaryMod;
      
      // Pick ONE note from this octave (cycle based on bar)
      const noteIndex = droneCurrentBar % octaveNotes.length;
      const noteName = octaveNotes[noteIndex];
      const fullNote = `${noteName}${baseOctave}`;
      
      targetNotes.set(fullNote, { 
        octave, 
        velocity: Math.max(0.05, Math.min(1, octaveVelocity))
      });
    }
    
    // Find notes to release (playing but not in target)
    const notesToRelease = [];
    droneNotes.forEach((info, note) => {
      if (!targetNotes.has(note)) {
        notesToRelease.push(note);
      }
    });
    
    // Find notes to attack (in target but not playing)
    const notesToAttack = [];
    targetNotes.forEach((info, note) => {
      if (!droneNotes.has(note)) {
        notesToAttack.push({ note, ...info });
      }
    });
    
    // Release old notes
    if (notesToRelease.length > 0) {
      notesToRelease.forEach(note => {
        try {
          synthA?.triggerRelease([note]);
          synthB?.triggerRelease([note]);
        } catch (e) {}
        droneNotes.delete(note);
      });
    }
    
    // Attack new notes
    if (notesToAttack.length > 0) {
      notesToAttack.forEach(({ note, velocity, octave }) => {
        try {
          if (crossfade < 0.99 && synthA) {
            synthA.triggerAttack([note], undefined, velocity);
          }
          if (crossfade > 0.01 && synthB) {
            synthB.triggerAttack([note], undefined, velocity);
          }
          droneNotes.set(note, { startTime: Date.now(), velocity });
          // Emit note event for piano roll (estimate duration as one bar)
          const barDuration = (60 / getCurrentBPM()) * 4;
          // Derive slot index from note position in pool
          const noteLetter = note.replace(/\d+$/, '');
          const octNotes = notePool[octave] || [];
          const slotIndex = [...octNotes].sort().indexOf(noteLetter);
          emitNoteEvent(note, barDuration, velocity, Tone ? Tone.now() : 0, { octave, slotIndex: Math.max(0, slotIndex) });
        } catch (e) {
          console.warn('[AudioService] Failed to attack note:', note, e);
        }
      });
    }
    
    // Update octave decay tracking
    for (let octave = 0; octave < notePool.length; octave++) {
      const oldNotes = droneNotesByOctave.get(octave);
      const newNotes = notePool[octave];
      if (!oldNotes || !setsEqual(new Set(oldNotes), new Set(newNotes || []))) {
        droneOctaveStartBars[octave] = droneCurrentBar;
      }
      droneNotesByOctave.set(octave, newNotes ? [...newNotes] : []);
    }
  }

  /**
   * Helper to compare two Sets for equality
   */
  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const item of a) {
      if (!b.has(item)) return false;
    }
    return true;
  }

  // ============== PATTERN EVOLUTION SYSTEM ==============

  /**
   * Get the default pattern for a given note count
   * Matches the original drone behavior: one whole note per bar, cycling through notes
   */
  function getDefaultPattern(noteCount = 3) {
    const count = Math.max(1, Math.min(3, noteCount));
    const slots = [];
    for (let i = 0; i < count; i++) {
      slots.push({ type: 'note', slotIndex: i, duration: 4, startBeat: 0, bar: i });
    }
    return {
      slots,
      lengthBars: count,
      noteOrder: 'ascending',
      noteCount: count
    };
  }

  /**
   * Initialize all octave patterns to the default
   */
  function initializeOctavePatterns() {
    octavePatterns = {};
    for (let i = 0; i < 10; i++) {
      // Get note count from notePool if available, otherwise default to 2
      const noteCount = notePool[i]?.length || 2;
      octavePatterns[i] = getDefaultPattern(noteCount);
    }
    lastChangedOctave = Math.floor(Math.random() * 10); // Start with random octave
    evolutionBarCounter = 0;
    pendingPatternChange = null;
    melodicOctaveQueue = []; // Clear the melodic queue
    console.log('[AudioService] Initialized octave patterns to defaults');
  }

  /**
   * Reset all patterns to default (called by Reset button)
   */
  function resetAllPatternsToDefault() {
    for (let i = 0; i < 10; i++) {
      const noteCount = notePool[i]?.length || 2;
      octavePatterns[i] = getDefaultPattern(noteCount);
    }
    evolutionBarCounter = 0;
    pendingPatternChange = null;
    melodicOctaveQueue = []; // Clear the melodic queue
    console.log('[AudioService] Reset all patterns to whole notes');
  }

  /**
   * Generate a random duration name
   */
  function randomDuration() {
    return DURATION_NAMES[Math.floor(Math.random() * DURATION_NAMES.length)];
  }

  /**
   * Generate a new pattern for an octave
   * @param {number} noteCount - Number of notes available (2 or 3)
   * @returns {Object} pattern object with slots, lengthBars, noteOrder
   * 
   * For 3-note octaves, randomly selects layout:
   * - 50%: 3-bar layout (notes spread across 3 bars)
   * - 30%: 2-bar compact (all 3 notes squeezed into 2 bars)
   * - 20%: 2-bar triplet (three equal triplet notes)
   */
  function generatePattern(noteCount = 2) {
    const maxBars = settings.maxPatternBars;
    const maxBeats = maxBars * 4;
    const slotCount = Math.max(1, Math.min(3, noteCount)); // 1-3 slots based on available notes
    
    // 1. SELECT NOTE ORDER
    // Roll 1-6: 1=ascending, 2=descending, 3-6=random
    const orderRoll = Math.floor(Math.random() * 6) + 1;
    let noteOrder;
    let randomNoteMapping = null;
    
    if (orderRoll === 1) {
      noteOrder = 'ascending';
    } else if (orderRoll === 2) {
      noteOrder = 'descending';
    } else {
      noteOrder = 'random';
      // Generate stable random mapping for slots
      randomNoteMapping = Array.from({ length: slotCount }, (_, i) => i);
      // Fisher-Yates shuffle
      for (let i = randomNoteMapping.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [randomNoteMapping[i], randomNoteMapping[j]] = [randomNoteMapping[j], randomNoteMapping[i]];
      }
    }
    
    // 2. FOR 3-NOTE OCTAVES: SELECT LAYOUT STYLE
    let layoutStyle = 'normal'; // default for 1-2 notes
    let isTriplet = false;
    
    if (slotCount === 3 && maxBars >= 2) {
      const layoutRoll = Math.random();
      if (layoutRoll < 0.5) {
        layoutStyle = 'spread';    // 50%: spread across 3 bars (or whatever fits)
      } else if (layoutRoll < 0.8) {
        layoutStyle = 'compact';   // 30%: squeeze into 2 bars
      } else {
        layoutStyle = 'triplet';   // 20%: triplet rhythm over 2 bars
        isTriplet = true;
      }
    }
    
    // 3. GENERATE TRIPLET PATTERN (special case)
    if (isTriplet) {
      // Three notes as half-note triplets over 2 bars
      // Each triplet half note = 8/3 beats ≈ 2.667 beats
      // Positions: 0, 2.667, 5.333 (spanning bars 0 and 1)
      const tripletDuration = 8 / 3; // ~2.667 beats
      const placedSlots = [
        { type: 'note', slotIndex: 0, duration: tripletDuration, startBeat: 0, bar: 0, isTriplet: true },
        { type: 'note', slotIndex: 1, duration: tripletDuration, startBeat: 2 + (2/3), bar: 0, isTriplet: true },
        { type: 'note', slotIndex: 2, duration: tripletDuration, startBeat: 1 + (1/3), bar: 1, isTriplet: true }
      ];
      
      const pattern = {
        slots: placedSlots,
        lengthBars: 2,
        noteOrder,
        noteCount: slotCount,
        isTriplet: true
      };
      
      if (randomNoteMapping) {
        pattern.randomNoteMapping = randomNoteMapping;
      }
      
      console.log('[AudioService] Generated triplet pattern for 3-note octave');
      return pattern;
    }
    
    // 4. ASSIGN DURATIONS TO SLOTS (with reroll if exceeds max)
    let slotDurations;
    let totalBeats;
    let attempts = 0;
    const MAX_ATTEMPTS = 50;
    
    // For compact 3-note layout, constrain to 2 bars (8 beats)
    const effectiveMaxBeats = (layoutStyle === 'compact') ? Math.min(8, maxBeats) : maxBeats;
    
    do {
      slotDurations = Array.from({ length: slotCount }, () => randomDuration());
      totalBeats = slotDurations.reduce((sum, d) => sum + DURATION_BEATS[d], 0);
      attempts++;
    } while (totalBeats > effectiveMaxBeats && attempts < MAX_ATTEMPTS);
    
    // Fallback: if can't fit after 50 attempts, use all eighths
    if (totalBeats > effectiveMaxBeats) {
      slotDurations = Array.from({ length: slotCount }, () => 'eighth');
      totalBeats = slotCount * 0.5;
      console.warn('[AudioService] Pattern generation fallback to eighths after', MAX_ATTEMPTS, 'attempts');
    }
    
    // 5. CHECK FOR EXTENSION TRIGGER (only if maxBars > 3 and not compact)
    let extendPattern = false;
    if (maxBars > 3 && layoutStyle !== 'compact') {
      // 1/maxBars probability of extension
      if (Math.floor(Math.random() * maxBars) === 0) {
        extendPattern = true;
      }
    }
    
    // 6. IF EXTENDING: ADD REST SLOTS
    const restSlots = [];
    if (extendPattern) {
      while (totalBeats < maxBeats) {
        const restDuration = randomDuration();
        const restBeats = DURATION_BEATS[restDuration];
        if (totalBeats + restBeats <= maxBeats + 0.5) { // Allow slight overshoot
          restSlots.push({ type: 'rest', duration: restBeats });
          totalBeats += restBeats;
        } else {
          break; // Can't fit more rests
        }
      }
    }
    
    // 7. PLACE ALL SLOTS
    // Create note slots
    const noteSlots = slotDurations.map((d, i) => ({
      type: 'note',
      slotIndex: i,
      duration: DURATION_BEATS[d]
    }));
    
    // Combine and shuffle if we have rests
    let allSlots;
    if (restSlots.length > 0) {
      allSlots = [...noteSlots, ...restSlots];
      // Shuffle all slots together
      for (let i = allSlots.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allSlots[i], allSlots[j]] = [allSlots[j], allSlots[i]];
      }
    } else {
      allSlots = noteSlots;
    }
    
    // Pack sequentially into bars
    let cursor = 0; // Beat position within the pattern
    const placedSlots = [];
    
    for (const slot of allSlots) {
      // If beat-align is on, round cursor to next valid beat boundary
      if (settings.beatAlignNotes && slot.type === 'note') {
        if (slot.duration >= 1) {
          // Quarter note or longer: align to whole beats
          cursor = Math.ceil(cursor);
        } else {
          // Eighth notes: align to half-beats
          cursor = Math.ceil(cursor * 2) / 2;
        }
      }
      
      const bar = Math.floor(cursor / 4);
      const startBeat = cursor % 4;
      
      placedSlots.push({
        ...slot,
        startBeat,
        bar
      });
      
      cursor += slot.duration;
    }
    
    // Calculate actual pattern length in bars
    const lastSlot = placedSlots[placedSlots.length - 1];
    const endPosition = lastSlot.bar * 4 + lastSlot.startBeat + lastSlot.duration;
    const lengthBars = Math.ceil(endPosition / 4);
    
    const pattern = {
      slots: placedSlots,
      lengthBars,
      noteOrder,
      noteCount: slotCount
    };
    
    if (randomNoteMapping) {
      pattern.randomNoteMapping = randomNoteMapping;
    }
    
    if (layoutStyle === 'compact') {
      console.log('[AudioService] Generated compact 2-bar pattern for 3-note octave');
    }
    
    return pattern;
  }

  /**
   * Select which octave should evolve next
   */
  function selectOctaveForEvolution() {
    const totalOctaves = Object.keys(octavePatterns).length;
    
    if (settings.octaveSelectionMode === 'random' || lastChangedOctave === null) {
      return Math.floor(Math.random() * totalOctaves);
    }
    
    // Adjacent mode: pick +1 or -1 from last changed, with wraparound
    const direction = Math.random() < 0.5 ? -1 : 1;
    let next = lastChangedOctave + direction;
    
    if (next < 0) next = totalOctaves - 1;
    if (next >= totalOctaves) next = 0;
    
    return next;
  }

  /**
   * Check if evolution should be skipped due to stationary state
   */
  function shouldSkipEvolution() {
    if (!settings.droneMovementFade) return false;
    
    const timeSinceChange = Date.now() - lastCoordChangeTime;
    return timeSinceChange > stationaryFadeStartMs;
  }

  /**
   * Process a pattern evolution event
   * Called when evolutionBarCounter reaches patternEvolutionBars
   * Manages the melodic octave queue to enforce maxMelodicOctaves limit
   */
  function triggerPatternEvolution() {
    if (shouldSkipEvolution()) {
      console.log('[AudioService] Pattern evolution skipped (stationary)');
      return;
    }
    
    const octave = selectOctaveForEvolution();
    const noteCount = notePool[octave]?.length || 2;
    const newPattern = generatePattern(noteCount);
    
    // Check if this octave is already melodic
    const existingIndex = melodicOctaveQueue.indexOf(octave);
    
    // Determine which octave to reset (if any)
    let octaveToReset = null;
    
    if (existingIndex === -1) {
      // This octave is not currently melodic
      // If we're at capacity, need to reset the oldest melodic octave
      if (melodicOctaveQueue.length >= settings.maxMelodicOctaves) {
        octaveToReset = melodicOctaveQueue[0]; // Oldest in queue
      }
    } else {
      // Octave is already melodic - just update its pattern
      // Move it to the end of the queue (most recent)
      melodicOctaveQueue.splice(existingIndex, 1);
    }
    
    // Queue the change to apply at next bar boundary
    pendingPatternChange = { 
      octave, 
      pattern: newPattern,
      octaveToReset
    };
    
    console.log('[AudioService] Pattern evolution queued for octave', octave, 
      '| noteCount:', noteCount,
      '| lengthBars:', newPattern.lengthBars,
      '| noteOrder:', newPattern.noteOrder,
      '| resetOctave:', octaveToReset);
  }

  /**
   * Apply any pending pattern change (called at bar boundary)
   * Also handles resetting old melodic octaves when at capacity
   */
  function applyPendingPatternChange() {
    if (!pendingPatternChange) return;
    
    const { octave, pattern, octaveToReset } = pendingPatternChange;
    
    // Reset the oldest melodic octave if needed
    if (octaveToReset !== null && octaveToReset !== undefined) {
      const resetNoteCount = notePool[octaveToReset]?.length || 2;
      octavePatterns[octaveToReset] = getDefaultPattern(resetNoteCount);
      melodicOctaveQueue.shift(); // Remove from front of queue
      console.log('[AudioService] Reset octave', octaveToReset, 'to whole notes (queue full)');
    }
    
    // Apply the new pattern
    octavePatterns[octave] = pattern;
    lastChangedOctave = octave;
    
    // Add to melodic queue
    melodicOctaveQueue.push(octave);
    
    pendingPatternChange = null;
    
    console.log('[AudioService] Applied new pattern to octave', octave, 
      '| melodic queue:', melodicOctaveQueue.join(','));
  }

  /**
   * Map a slot index to the actual note from available notes
   * Handles note ordering and missing notes (returns null for rest)
   */
  function mapSlotToNote(slotIndex, availableNotes, pattern) {
    if (!availableNotes || availableNotes.length === 0) return null;
    if (slotIndex >= availableNotes.length) return null; // No note for this slot
    
    let orderedNotes;
    
    switch (pattern.noteOrder) {
      case 'ascending':
        orderedNotes = [...availableNotes].sort();
        break;
      case 'descending':
        orderedNotes = [...availableNotes].sort().reverse();
        break;
      case 'random':
        // Use the stable mapping stored in the pattern
        if (pattern.randomNoteMapping) {
          orderedNotes = pattern.randomNoteMapping
            .map(i => availableNotes[i])
            .filter(n => n !== undefined);
        } else {
          orderedNotes = [...availableNotes];
        }
        break;
      default:
        orderedNotes = [...availableNotes];
    }
    
    return orderedNotes[slotIndex] || null;
  }

  /**
   * Update pattern when note count changes (GPS update with different note count)
   */
  function updatePatternForNoteCount(octave, newNoteCount) {
    const pattern = octavePatterns[octave];
    if (!pattern || pattern.noteCount === newNoteCount) return;
    
    // Note count changed - regenerate pattern with new count
    // This keeps the rhythm interesting but adapts to available notes
    octavePatterns[octave] = generatePattern(newNoteCount);
    console.log('[AudioService] Octave', octave, 'pattern regenerated for note count change:', 
      pattern.noteCount, '->', newNoteCount);
  }

  /**
   * Get the current beat position within the global bar (0-3.5 in eighth note resolution)
   */
  function getCurrentBeatInBar() {
    return droneBeatCount % 4;
  }

  /**
   * Start BPM-controlled drone updates with pattern evolution
   */
  function startDroneBPMClock() {
    if (droneUpdateScheduleId !== null) return;
    
    droneCurrentBar = 0;
    droneBeatCount = 0;
    droneOctaveStartBars = {};
    evolutionBarCounter = 0;
    
    // Initialize patterns if needed
    if (Object.keys(octavePatterns).length === 0) {
      initializeOctavePatterns();
    }
    
    // Initialize movement tracking
    lastCoordChangeTime = Date.now();
    lastMovementTime = Date.now();
    
    Tone.Transport.bpm.value = getCurrentBPM();
    console.log('[AudioService] Starting drone BPM clock at', getCurrentBPM(), 'BPM',
      '| pattern evolution:', settings.patternEvolutionEnabled ? 'ON' : 'OFF');
    
    // Schedule at eighth-note intervals for sub-beat precision
    let eighthCount = 0;
    
    droneUpdateScheduleId = Tone.Transport.scheduleRepeat((time) => {
      if (!isPlaying) return;
      
      eighthCount++;
      
      // Two eighths = one quarter note beat
      if (eighthCount % 2 === 0) {
        droneIsEighth = false;
        droneBeatCount++;
        
        // Check for bar boundary
        if (droneBeatCount >= 4) {
          droneBeatCount = 0;
          droneCurrentBar++;
          
          // Apply any pending pattern change at bar boundary
          if (settings.patternEvolutionEnabled) {
            applyPendingPatternChange();
          }
          
          // Check for pattern evolution trigger
          if (settings.patternEvolutionEnabled && settings.droneBPMEnabled) {
            evolutionBarCounter++;
            if (evolutionBarCounter >= settings.patternEvolutionBars) {
              evolutionBarCounter = 0;
              triggerPatternEvolution();
            }
          }
        }
        
        // Update notes on beats (pattern-based or legacy)
        if (settings.patternEvolutionEnabled) {
          updateDroneNotes();
        } else {
          // Legacy mode: only update on droneBPMDivisor boundaries
          const beatsPerUpdate = settings.droneBPMDivisor || 4;
          if (droneBeatCount % beatsPerUpdate === 0) {
            updateDroneNotesLegacy();
          }
        }
        
        // Update stationary fade calculation
        if (settings.droneMovementFade) {
          calculateStationaryVolumeReduction();
        }
      } else if (settings.patternEvolutionEnabled) {
        // Eighth note boundary (odd eighths) - check for eighth-note slots
        droneIsEighth = true;
        updateDroneNotesEighths();
      }
      
      // Update BPM smoothly if it changed
      const targetBPM = getCurrentBPM();
      if (Math.abs(Tone.Transport.bpm.value - targetBPM) > 1) {
        Tone.Transport.bpm.rampTo(targetBPM, 0.5);
      }
    }, "8n"); // Eighth note intervals
    
    Tone.Transport.start();
  }
  
  /**
   * Handle eighth-note slots and triplets (called on the "and" of each beat)
   */
  function updateDroneNotesEighths() {
    if (!settings.droneMode || notePool.length === 0) return;
    
    // Current position is X.5 beats (the "and")
    const currentBeat = droneBeatCount + 0.5;
    
    // Refresh currentDroneVolumeReduction; the fade itself is
    // applied exactly once, inside triggerNote()
    if (settings.droneMovementFade) calculateStationaryVolumeReduction();
    
    // Process each octave looking for eighth-note slots or triplets on the "and"
    for (let octave = 0; octave < notePool.length; octave++) {
      const octaveNotes = notePool[octave];
      if (!octaveNotes || octaveNotes.length === 0) continue;
      
      const pattern = octavePatterns[octave];
      if (!pattern) continue;
      
      const patternBar = droneCurrentBar % pattern.lengthBars;
      const baseOctave = octave + settings.transpose;
      const octaveSettings = settings.octaves[octave] || { intensity: 0 };
      
      const intensityDb = octaveSettings.intensity || 0;
      const decayDb = getOctaveDecayDb(octave);
      const totalDb = intensityDb + decayDb;
      const octaveVelocity = 0.6 * Math.pow(10, totalDb / 20);
      const velocity = Math.max(0.05, Math.min(1, octaveVelocity));
      
      // Find slots that should trigger on this eighth-note tick
      for (const slot of pattern.slots) {
        if (slot.bar !== patternBar) continue;
        if (slot.type !== 'note') continue;
        
        // Check if this slot triggers now
        let shouldTrigger = false;
        
        if (slot.isTriplet) {
          // Triplet: trigger if we're within 0.25 beats of the target
          const tolerance = 0.25;
          if (Math.abs(slot.startBeat - currentBeat) < tolerance) {
            shouldTrigger = true;
          }
        } else {
          // Regular eighth note: exact match on X.5 beats
          shouldTrigger = (slot.startBeat === currentBeat);
        }
        
        if (shouldTrigger) {
          const noteName = mapSlotToNote(slot.slotIndex, octaveNotes, pattern);
          if (noteName) {
            const fullNote = `${noteName}${baseOctave}`;
            const bpm = getCurrentBPM();
            const beatDuration = 60 / bpm;
            const durationSeconds = slot.duration * beatDuration;
            
            // Trigger note via central function (feeds synths + event bus)
            triggerNote(fullNote, durationSeconds, velocity, undefined, { octave, slotIndex: slot.slotIndex });
          }
        }
      }
    }
  }

  /**
   * Stop BPM-controlled drone updates
   */
  function stopDroneBPMClock() {
    if (droneUpdateScheduleId !== null) {
      Tone.Transport.clear(droneUpdateScheduleId);
      droneUpdateScheduleId = null;
    }
    Tone.Transport.stop();
    droneBeatCount = 0;
    droneCurrentBar = 0;
  }

  function stopDroneNotes() {
    console.log('[AudioService] Stopping drone, releasing', droneNotes.size, 'notes');
    
    // Release all notes on both synths
    droneNotes.forEach((_, note) => {
      try {
        synthA?.triggerRelease([note]);
        synthB?.triggerRelease([note]);
      } catch (e) {
        // Note might not be playing
      }
    });
    
    // Also do a full releaseAll to catch any stragglers
    try {
      synthA?.releaseAll();
      synthB?.releaseAll();
    } catch (e) {}
    
    // Clear all tracking state
    droneNotes.clear();
    droneNotesByOctave.clear();
    droneOctaveStartBars = {};
    stopDroneBPMClock();
  }

  // ============== PUBLIC API ==============

  const AudioService = {
    
    // ===== INITIALIZATION =====
    
    async init() {
      if (isInitialized) return;
      
      // Get Tone.js - try LazyLoad first, then fall back to global
      try {
        if (typeof LazyLoad !== 'undefined' && LazyLoad.tone) {
          Tone = await LazyLoad.tone();
        } else if (typeof window.Tone !== 'undefined') {
          Tone = window.Tone;
        } else {
          throw new Error('Tone.js not available');
        }
      } catch (e) {
        console.error('[AudioService] Failed to load Tone.js:', e);
        return;
      }
      
      // Create master volume
      masterVolume = new Tone.Volume(settings.masterVolume);
      masterVolume.toDestination();
      
      // Create both synth chains with default presets
      const chainA = await createSynthChain(presetA, 'A');
      synthA = chainA.synth;
      hpFilterA = chainA.hpFilter;
      lpFilterA = chainA.lpFilter;
      reverbA = chainA.reverb;
      volumeA = chainA.volume;
      paramsA = chainA.params;
      settings.A = { ...settings.A, ...chainA.params };
      
      const chainB = await createSynthChain(presetB, 'B');
      synthB = chainB.synth;
      hpFilterB = chainB.hpFilter;
      lpFilterB = chainB.lpFilter;
      reverbB = chainB.reverb;
      volumeB = chainB.volume;
      paramsB = chainB.params;
      settings.B = { ...settings.B, ...chainB.params };
      
      // Set initial crossfade (100% A)
      crossfade = 0;
      applyCrossfadeVolumes();
      
      isInitialized = true;
      console.log('[AudioService] Dual-synth initialized. A:', presetA, 'B:', presetB);
    },

    async play() {
      if (!isInitialized) await this.init();
      if (isPlaying) return;
      
      await Tone.start();
      isPlaying = true;
      
      // Initialize coordinate change tracking
      lastCoordChangeTime = Date.now();
      lastMovementTime = Date.now();
      currentDroneVolumeReduction = 0;
      
      // Debug: log current state
      console.log('[AudioService] Play started. Drone mode:', settings.droneMode, 
        '| crossfade:', crossfade,
        '| volumeA:', volumeA?.volume?.value?.toFixed(1),
        '| volumeB:', volumeB?.volume?.value?.toFixed(1),
        '| masterVolume:', masterVolume?.volume?.value);
      
      if (settings.droneMode) {
        if (settings.droneBPMEnabled) {
          startDroneBPMClock();
        }
        updateDroneNotes();
      } else {
        startBPMClock();
      }
      
      console.log('[AudioService] Playing');
    },

    stop() {
      isPlaying = false;
      stopBPMClock();
      stopDroneNotes();
      synthA?.releaseAll();
      synthB?.releaseAll();
      console.log('[AudioService] Stopped');
    },

    get isPlaying() { return isPlaying; },
    get isInitialized() { return isInitialized; },

    // ===== CROSSFADE CONTROL =====

    /**
     * Set crossfade position
     * @param {number} value - 0 (100% A) to 1 (100% B)
     */
    setCrossfade(value) {
      crossfade = Math.max(0, Math.min(1, value));
      applyCrossfadeVolumes();
      this._applyLerpedParams();
    },

    getCrossfade() {
      return crossfade;
    },

    /**
     * Set preset for chain A
     */
    async setPresetA(name) {
      if (presetA === name) return;
      await rebuildChain('A', name);
      this._applyLerpedParams();
    },

    /**
     * Set preset for chain B
     */
    async setPresetB(name) {
      if (presetB === name) return;
      await rebuildChain('B', name);
      this._applyLerpedParams();
    },

    getPresetA() { return presetA; },
    getPresetB() { return presetB; },

    /**
     * Apply lerped continuous parameters based on current crossfade
     */
    _applyLerpedParams() {
      if (!paramsA || !paramsB) return;
      
      hpFilterA?.frequency.rampTo(paramsA.hpFreq || 80, 0.1);
      lpFilterA?.frequency.rampTo(paramsA.lpFreq || 8000, 0.1);
      hpFilterB?.frequency.rampTo(paramsB.hpFreq || 80, 0.1);
      lpFilterB?.frequency.rampTo(paramsB.lpFreq || 8000, 0.1);
      
      const wetA = paramsA.reverbWet || 0.4;
      const wetB = paramsB.reverbWet || 0.4;
      if (reverbA) reverbA.wet.rampTo(wetA, 0.1);
      if (reverbB) reverbB.wet.rampTo(wetB, 0.1);
    },

    // ===== PRESETS =====

    getPresets() {
      return [...Object.keys(PRESETS), ...Object.keys(userPresets)];
    },

    getBuiltInPresets() {
      return Object.keys(PRESETS);
    },

    getUserPresetNames() {
      return Object.keys(userPresets);
    },

    isBuiltInPreset(name) {
      return name in PRESETS;
    },

    isUserPreset(name) {
      return name in userPresets;
    },

    getPresetParams(name) {
      const preset = getPreset(name);
      return preset ? { ...preset } : null;
    },

    /**
     * Set the "current" preset (applies to chain A, resets crossfade to 0)
     */
    async setPreset(name) {
      await this.setPresetA(name);
      crossfade = 0;
      applyCrossfadeVolumes();
    },

    saveUserPreset(name) {
      if (PRESETS[name]) {
        console.warn('[AudioService] Cannot overwrite built-in preset:', name);
        return false;
      }
      
      userPresets[name] = {
        oscillator: { ...settings.A.oscillator },
        envelope: { ...settings.A.envelope },
        hpFreq: paramsA?.hpFreq || 80,
        lpFreq: paramsA?.lpFreq || 8000,
        reverbDecay: paramsA?.reverbDecay || 4.0,
        reverbWet: paramsA?.reverbWet || 0.4,
        volume: paramsA?.volume || -8,
        bpm: settings.A.bpm || 100,
        timeSignature: [...(settings.A.timeSignature || [4, 4])],
        humanize: settings.A.humanize || 0.1,
        createdAt: new Date().toISOString()
      };
      
      saveUserPresets();
      return true;
    },

    deleteUserPreset(name) {
      if (!userPresets[name]) return false;
      delete userPresets[name];
      saveUserPresets();
      return true;
    },

    // ===== NOTE POOL =====

    setMusicalCode(code) {
      if (!code) return;
      
      // Track coordinate changes for stationary fade
      checkCoordinateChange(code);
      
      // Store previous notes for reset anchor check
      const previousAnchorNotes = notePool[settings.resetAnchorOctave] 
        ? [...notePool[settings.resetAnchorOctave]] 
        : null;
      
      const groups = code.split(',').filter(g => g.trim());
      notePool = groups.map(group => {
        const notes = [];
        const noteRegex = /[A-Ga-g][#b]?/g;
        let match;
        while ((match = noteRegex.exec(group)) !== null) {
          notes.push(match[0].toUpperCase());
        }
        return notes;
      });
      
      // Check if reset anchor octave notes changed
      if (settings.patternEvolutionEnabled && previousAnchorNotes !== null) {
        const newAnchorNotes = notePool[settings.resetAnchorOctave] || [];
        const notesChanged = previousAnchorNotes.length !== newAnchorNotes.length ||
          previousAnchorNotes.some((note, i) => note !== newAnchorNotes[i]);
        
        if (notesChanged) {
          console.log('[AudioService] Reset anchor octave', settings.resetAnchorOctave, 
            'notes changed:', previousAnchorNotes.join(','), '->', newAnchorNotes.join(','),
            '- resetting all patterns');
          resetAllPatternsToDefault();
        }
      }
      
      lastGPSTime = Date.now();
      
      // Notify piano roll / MIDI listeners of pool change
      emitNotePoolChange(notePool);
      
      // In drone mode, only update notes immediately if BPM sync is OFF
      // If BPM sync is ON, the BPM clock will handle updates
      if (settings.droneMode && isPlaying) {
        if (!settings.droneBPMEnabled) {
          // No BPM sync - update immediately on every coordinate change
          updateDroneNotes();
        }
        // If BPM enabled, the scheduled clock will call updateDroneNotes
      }
    },

    /**
     * Update position for movement detection (drone mode)
     * Note: This is now secondary to code-change detection
     */
    updatePosition(lat, lon) {
      // Also update GPS time
      lastGPSTime = Date.now();
    },

    updateSpeed(speed) {
      if (speed === null || speed === undefined) return;
      if (lastSpeed !== null) {
        speedHistory.push(speed);
        if (speedHistory.length > 10) speedHistory.shift();
      }
      lastSpeed = speed;
    },

    // ===== SETTINGS =====

    setMasterVolume(db) {
      settings.masterVolume = Math.max(-60, Math.min(0, db));
      if (masterVolume) masterVolume.volume.value = settings.masterVolume;
    },

    getMasterVolume() {
      return settings.masterVolume;
    },

    /**
     * Set BPM for chain A (also updates Transport if playing)
     */
    setBPM(bpm, chain = 'A') {
      const clampedBPM = Math.max(40, Math.min(200, bpm));
      if (chain === 'A') {
        settings.A.bpm = clampedBPM;
        if (paramsA) paramsA.bpm = clampedBPM;
      } else {
        settings.B.bpm = clampedBPM;
        if (paramsB) paramsB.bpm = clampedBPM;
      }
      
      // Update transport BPM if playing
      if (isPlaying && Tone?.Transport) {
        const targetBPM = getCurrentBPM();
        Tone.Transport.bpm.rampTo(targetBPM, 0.1);
        console.log('[AudioService] BPM set to', clampedBPM, 'for chain', chain, '- Transport:', targetBPM);
      }
    },

    /**
     * Set high-pass filter frequency
     */
    setHPF(freq, chain = 'A') {
      const clampedFreq = Math.max(20, Math.min(20000, freq));
      if (chain === 'A') {
        if (paramsA) paramsA.hpFreq = clampedFreq;
        hpFilterA?.frequency.rampTo(clampedFreq, 0.1);
      } else {
        if (paramsB) paramsB.hpFreq = clampedFreq;
        hpFilterB?.frequency.rampTo(clampedFreq, 0.1);
      }
    },

    /**
     * Set low-pass filter frequency
     */
    setLPF(freq, chain = 'A') {
      const clampedFreq = Math.max(20, Math.min(20000, freq));
      if (chain === 'A') {
        if (paramsA) paramsA.lpFreq = clampedFreq;
        lpFilterA?.frequency.rampTo(clampedFreq, 0.1);
      } else {
        if (paramsB) paramsB.lpFreq = clampedFreq;
        lpFilterB?.frequency.rampTo(clampedFreq, 0.1);
      }
    },

    /**
     * Set reverb wet amount (0-1)
     */
    setReverbWet(wet, chain = 'A') {
      const clampedWet = Math.max(0, Math.min(1, wet));
      if (chain === 'A') {
        if (paramsA) paramsA.reverbWet = clampedWet;
        if (reverbA) reverbA.wet.rampTo(clampedWet, 0.1);
      } else {
        if (paramsB) paramsB.reverbWet = clampedWet;
        if (reverbB) reverbB.wet.rampTo(clampedWet, 0.1);
      }
    },

    /**
     * Set envelope attack time
     */
    setAttack(time, chain = 'A') {
      const clamped = Math.max(0.001, Math.min(3, time));
      if (chain === 'A') {
        settings.A.envelope = settings.A.envelope || {};
        settings.A.envelope.attack = clamped;
        if (paramsA) {
          paramsA.envelope = paramsA.envelope || {};
          paramsA.envelope.attack = clamped;
        }
      } else {
        settings.B.envelope = settings.B.envelope || {};
        settings.B.envelope.attack = clamped;
        if (paramsB) {
          paramsB.envelope = paramsB.envelope || {};
          paramsB.envelope.attack = clamped;
        }
      }
    },

    /**
     * Set envelope release time
     */
    setRelease(time, chain = 'A') {
      const clamped = Math.max(0.1, Math.min(10, time));
      if (chain === 'A') {
        settings.A.envelope = settings.A.envelope || {};
        settings.A.envelope.release = clamped;
        if (paramsA) {
          paramsA.envelope = paramsA.envelope || {};
          paramsA.envelope.release = clamped;
        }
      } else {
        settings.B.envelope = settings.B.envelope || {};
        settings.B.envelope.release = clamped;
        if (paramsB) {
          paramsB.envelope = paramsB.envelope || {};
          paramsB.envelope.release = clamped;
        }
      }
    },

    /**
     * Set humanize amount (0-1)
     */
    setHumanize(amount, chain = 'A') {
      const clamped = Math.max(0, Math.min(1, amount));
      if (chain === 'A') {
        settings.A.humanize = clamped;
        if (paramsA) paramsA.humanize = clamped;
      } else {
        settings.B.humanize = clamped;
        if (paramsB) paramsB.humanize = clamped;
      }
    },

    setTranspose(octaves) {
      settings.transpose = Math.max(-3, Math.min(3, Math.floor(octaves)));
    },

    getTranspose() {
      return settings.transpose;
    },

    setDroneMode(enabled) {
      const wasEnabled = settings.droneMode;
      settings.droneMode = enabled;
      
      if (isPlaying) {
        if (enabled && !wasEnabled) {
          stopBPMClock();
          if (settings.droneBPMEnabled) {
            startDroneBPMClock();
          }
          updateDroneNotes();
        } else if (!enabled && wasEnabled) {
          stopDroneNotes();
          startBPMClock();
        }
      }
    },

    getDroneMode() {
      return settings.droneMode;
    },

    // ===== DRONE MODE ENHANCEMENTS =====

    /**
     * Enable/disable BPM-controlled update rate in drone mode
     */
    setDroneBPMEnabled(enabled) {
      const wasEnabled = settings.droneBPMEnabled;
      settings.droneBPMEnabled = enabled;
      
      if (isPlaying && settings.droneMode) {
        if (enabled && !wasEnabled) {
          startDroneBPMClock();
        } else if (!enabled && wasEnabled) {
          stopDroneBPMClock();
        }
      }
    },

    getDroneBPMEnabled() {
      return settings.droneBPMEnabled;
    },

    /**
     * Set how often drone notes update (in beats)
     * @param {number} divisor - Update every N beats (1 = every beat, 4 = every bar in 4/4)
     */
    setDroneBPMDivisor(divisor) {
      const oldDivisor = settings.droneBPMDivisor;
      settings.droneBPMDivisor = Math.max(1, Math.min(32, divisor));
      
      // Restart the clock if it's running and divisor changed
      if (isPlaying && settings.droneMode && settings.droneBPMEnabled && oldDivisor !== settings.droneBPMDivisor) {
        console.log('[AudioService] BPM divisor changed to', settings.droneBPMDivisor, '- restarting clock');
        stopDroneBPMClock();
        startDroneBPMClock();
      }
    },

    getDroneBPMDivisor() {
      return settings.droneBPMDivisor;
    },

    /**
     * Enable/disable octave decay over time
     */
    setDroneDecayEnabled(enabled) {
      settings.droneDecayEnabled = enabled;
      if (!enabled) {
        // Reset decay tracking
        droneOctaveStartBars = {};
      }
    },

    getDroneDecayEnabled() {
      return settings.droneDecayEnabled;
    },

    /**
     * Set number of bars for full decay
     */
    setDroneDecayBars(bars) {
      settings.droneDecayBars = Math.max(1, Math.min(64, bars));
    },

    getDroneDecayBars() {
      return settings.droneDecayBars;
    },

    /**
     * Set target dB for decayed octaves (negative value)
     */
    setDroneDecayTargetDb(db) {
      settings.droneDecayTargetDb = Math.max(-48, Math.min(0, db));
    },

    getDroneDecayTargetDb() {
      return settings.droneDecayTargetDb;
    },

    /**
     * Enable/disable movement-based fade (drone mode)
     */
    setDroneMovementFade(enabled) {
      settings.droneMovementFade = enabled;
      if (enabled) {
        // Reset movement tracking
        lastMovementTime = Date.now();
        currentDroneVolumeReduction = 0;
      }
    },

    getDroneMovementFade() {
      return settings.droneMovementFade;
    },

    /**
     * Set stationary fade timing
     */
    setStationaryFadeTiming(startMs, fadeMs) {
      stationaryFadeStartMs = Math.max(0, startMs);
      stationaryFadeTimeMs = Math.max(100, fadeMs);
    },

    getStationaryFadeTiming() {
      return { startMs: stationaryFadeStartMs, fadeMs: stationaryFadeTimeMs };
    },

    /**
     * Set movement threshold in meters
     */
    setMovementThreshold(meters) {
      movementThresholdMeters = Math.max(0.5, Math.min(50, meters));
    },

    getMovementThreshold() {
      return movementThresholdMeters;
    },

    // ===== PATTERN EVOLUTION =====

    /**
     * Enable/disable pattern evolution system
     */
    setPatternEvolutionEnabled(enabled) {
      settings.patternEvolutionEnabled = enabled;
      if (enabled && Object.keys(octavePatterns).length === 0) {
        initializeOctavePatterns();
      }
    },

    getPatternEvolutionEnabled() {
      return settings.patternEvolutionEnabled;
    },

    /**
     * Set how many bars between evolution events
     */
    setPatternEvolutionBars(bars) {
      settings.patternEvolutionBars = Math.max(1, Math.min(32, bars));
    },

    getPatternEvolutionBars() {
      return settings.patternEvolutionBars;
    },

    /**
     * Set octave selection mode for evolution
     * @param {string} mode - 'adjacent' or 'random'
     */
    setOctaveSelectionMode(mode) {
      if (['adjacent', 'random'].includes(mode)) {
        settings.octaveSelectionMode = mode;
      }
    },

    getOctaveSelectionMode() {
      return settings.octaveSelectionMode;
    },

    /**
     * Set maximum pattern length in bars
     */
    setMaxPatternBars(bars) {
      settings.maxPatternBars = Math.max(1, Math.min(8, bars));
    },

    getMaxPatternBars() {
      return settings.maxPatternBars;
    },

    /**
     * Enable/disable beat alignment for note starts
     */
    setBeatAlignNotes(enabled) {
      settings.beatAlignNotes = enabled;
    },

    getBeatAlignNotes() {
      return settings.beatAlignNotes;
    },

    /**
     * Set maximum number of melodic (non-whole-note) octaves
     * When a new octave becomes melodic and this limit is reached,
     * the oldest melodic octave reverts to whole notes
     */
    setMaxMelodicOctaves(count) {
      settings.maxMelodicOctaves = Math.max(1, Math.min(10, count));
      
      // If current melodic count exceeds new limit, trim the queue
      while (melodicOctaveQueue.length > settings.maxMelodicOctaves) {
        const octaveToReset = melodicOctaveQueue.shift();
        const noteCount = notePool[octaveToReset]?.length || 2;
        octavePatterns[octaveToReset] = getDefaultPattern(noteCount);
        console.log('[AudioService] Reset octave', octaveToReset, 'to whole notes (limit reduced)');
      }
    },

    getMaxMelodicOctaves() {
      return settings.maxMelodicOctaves;
    },

    /**
     * Get current melodic octave queue (for debugging/display)
     */
    getMelodicOctaveQueue() {
      return [...melodicOctaveQueue];
    },

    /**
     * Set the reset anchor octave
     * When evolution selects this octave, all patterns reset to whole notes
     */
    setResetAnchorOctave(octave) {
      settings.resetAnchorOctave = Math.max(0, Math.min(9, octave));
    },

    getResetAnchorOctave() {
      return settings.resetAnchorOctave;
    },

    /**
     * Reset all octave patterns to the default (whole notes)
     */
    resetPatternsToDefault() {
      resetAllPatternsToDefault();
    },

    /**
     * Get current pattern state (for debugging/display)
     */
    getPatternState() {
      return {
        octavePatterns: { ...octavePatterns },
        lastChangedOctave,
        evolutionBarCounter,
        melodicOctaveQueue: [...melodicOctaveQueue],
        currentBar: droneCurrentBar,
        currentBeat: droneBeatCount
      };
    },

    // ===== NOTE EVENT BUS (piano roll display, MIDI output) =====

    /**
     * Subscribe to note trigger events
     * Callback receives: { note, duration, velocity, time, bar, beat }
     * @param {Function} fn - Listener function
     */
    onNoteEvent(fn) {
      if (typeof fn === 'function') noteEventListeners.push(fn);
    },

    /**
     * Unsubscribe from note trigger events
     * @param {Function} fn - Listener to remove
     */
    offNoteEvent(fn) {
      noteEventListeners = noteEventListeners.filter(l => l !== fn);
    },

    /**
     * Subscribe to notePool changes (GPS coordinate change)
     * Callback receives: Array of arrays (copy of notePool)
     * @param {Function} fn - Listener function
     */
    onNotePoolChange(fn) {
      if (typeof fn === 'function') notePoolChangeListeners.push(fn);
    },

    /**
     * Unsubscribe from notePool changes
     * @param {Function} fn - Listener to remove
     */
    offNotePoolChange(fn) {
      notePoolChangeListeners = notePoolChangeListeners.filter(l => l !== fn);
    },

    /**
     * Get current note pool (copy)
     * @returns {Array<Array<string>>} e.g. [["F","G"], ["C","G","B"], ...]
     */
    getNotePool() {
      return notePool.map(arr => arr ? [...arr] : []);
    },

    /**
     * Get current bar number (global, monotonically increasing)
     * @returns {number}
     */
    getCurrentBar() {
      return droneCurrentBar;
    },

    /**
     * Get current beat within bar (0-3)
     * @returns {number}
     */
    getCurrentBeat() {
      return droneBeatCount;
    },

    /**
     * Get deep copy of current octave patterns (for piano roll look-ahead)
     * @returns {Object} octave -> { slots, lengthBars, noteOrder, noteCount }
     */
    getOctavePatterns() {
      return JSON.parse(JSON.stringify(octavePatterns));
    },

    // ===== JOURNEY CROSSFADE MODE =====

    /**
     * Enable/disable logarithmic (dB-based) crossfade for journeys
     * When enabled: 0dB/-144dB at ends, -3dB/-3dB at midpoint
     * When disabled: Equal-power crossfade (original behavior)
     */
    setJourneyCrossfadeLogarithmic(enabled) {
      settings.journeyCrossfadeLogarithmic = enabled;
      applyCrossfadeVolumes(); // Re-apply with new curve
    },

    getJourneyCrossfadeLogarithmic() {
      return settings.journeyCrossfadeLogarithmic;
    },

    // ===== OTHER SETTINGS =====

    setPatternRefreshBars(bars) {
      settings.patternRefreshBars = Math.max(1, Math.min(16, bars));
    },

    setPatternRefreshRandom(enabled, min = 2, max = 8) {
      settings.patternRefreshRandom = enabled;
      settings.patternRefreshMin = min;
      settings.patternRefreshMax = max;
    },

    setAccelerationSensitivity(value) {
      settings.accelerationSensitivity = Math.max(0, Math.min(1, value));
    },

    getAccelerationSensitivity() {
      return settings.accelerationSensitivity;
    },

    // ===== OCTAVE SETTINGS =====

    setOctaveIntensity(octave, db) {
      if (settings.octaves[octave]) {
        settings.octaves[octave].intensity = Math.max(-12, Math.min(6, db));
      }
    },

    setOctaveUpdateFraction(octave, fraction) {
      if (settings.octaves[octave]) {
        settings.octaves[octave].updateFraction = Math.max(1, Math.min(10, fraction));
      }
    },

    setOctaveMode(octave, mode) {
      if (settings.octaves[octave] && ['random', 'single', 'chord', 'arpeggio'].includes(mode)) {
        settings.octaves[octave].mode = mode;
      }
    },

    setOctaveDuration(octave, duration) {
      if (settings.octaves[octave]) {
        settings.octaves[octave].duration = duration;
      }
    },

    getOctaveSettings(octave) {
      return settings.octaves[octave] ? { ...settings.octaves[octave] } : null;
    },

    // ===== TEST MODE =====

    setTestMode(enabled) {
      testMode = enabled;
      if (enabled) lastGPSTime = Date.now();
    },

    getTestMode() {
      return testMode;
    },

    isGPSFresh() {
      return isGPSFresh();
    },

    getAcceleration() {
      return getAcceleration();
    },

    // ===== JOURNEY INTEGRATION =====

    /**
     * Configure for journey lerping
     */
    async setupJourney(fromPreset, toPreset) {
      await this.setPresetA(fromPreset);
      await this.setPresetB(toPreset);
      crossfade = 0;
      applyCrossfadeVolumes();
      console.log('[AudioService] Journey setup:', fromPreset, '->', toPreset);
    },

    /**
     * Update journey progress (call from JourneyService)
     */
    setJourneyProgress(progress) {
      this.setCrossfade(progress);
    },

    /**
     * Get current sound parameters (for preset saving)
     */
    getSoundParams() {
      return {
        crossfade,
        presetA,
        presetB,
        masterVolume: settings.masterVolume,
        transpose: settings.transpose,
        droneMode: settings.droneMode,
        droneBPMEnabled: settings.droneBPMEnabled,
        droneBPMDivisor: settings.droneBPMDivisor,
        droneDecayEnabled: settings.droneDecayEnabled,
        droneDecayBars: settings.droneDecayBars,
        droneDecayTargetDb: settings.droneDecayTargetDb,
        droneMovementFade: settings.droneMovementFade,
        journeyCrossfadeLogarithmic: settings.journeyCrossfadeLogarithmic,
        patternRefreshBars: settings.patternRefreshBars,
        patternRefreshRandom: settings.patternRefreshRandom,
        patternRefreshMin: settings.patternRefreshMin,
        patternRefreshMax: settings.patternRefreshMax,
        accelerationSensitivity: settings.accelerationSensitivity,
        // Pattern evolution settings
        patternEvolutionEnabled: settings.patternEvolutionEnabled,
        patternEvolutionBars: settings.patternEvolutionBars,
        octaveSelectionMode: settings.octaveSelectionMode,
        maxPatternBars: settings.maxPatternBars,
        beatAlignNotes: settings.beatAlignNotes,
        maxMelodicOctaves: settings.maxMelodicOctaves,
        resetAnchorOctave: settings.resetAnchorOctave,
        octaves: JSON.parse(JSON.stringify(settings.octaves)),
        A: paramsA ? { ...paramsA } : null,
        B: paramsB ? { ...paramsB } : null
      };
    },

    // For backward compatibility
    getVolume() { return settings.masterVolume; },
    setVolume(db) { this.setMasterVolume(db); },
    getBPM() { return getCurrentBPM(); },
    getHumanize() { return getCurrentHumanize(); },
    
    getHPF() { return lerp(paramsA?.hpFreq || 80, paramsB?.hpFreq || 80, crossfade); },
    getLPF() { return lerp(paramsA?.lpFreq || 8000, paramsB?.lpFreq || 8000, crossfade); },
    getReverbWet() { return lerp(paramsA?.reverbWet || 0.4, paramsB?.reverbWet || 0.4, crossfade); },
    getAttack() { return lerp(paramsA?.envelope?.attack || 0.3, paramsB?.envelope?.attack || 0.3, crossfade); },
    getRelease() { return lerp(paramsA?.envelope?.release || 3.0, paramsB?.envelope?.release || 3.0, crossfade); },
    
    getOscillatorTypes() { return [...OSCILLATOR_TYPES]; },

    // ===== DEBUG/STATUS =====

    getDroneStatus() {
      return {
        isMoving: (Date.now() - lastMovementTime) < stationaryFadeStartMs,
        timeSinceMovement: Date.now() - lastMovementTime,
        volumeReduction: currentDroneVolumeReduction,
        activeNotes: droneNotes.size,
        currentBar: droneCurrentBar,
        octaveDecay: Object.fromEntries(
          Array.from({ length: 10 }, (_, i) => [i, getOctaveDecayDb(i)])
        )
      };
    }
  };

  // ============== EXPORT ==============

  global.AudioService = AudioService;

  console.log('[geosonify] audio-service v6.1 loaded (note event bus, pattern evolution)');

})(typeof window !== 'undefined' ? window : this);
