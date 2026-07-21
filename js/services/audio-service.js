/**
 * geosonify-audio-service.js v6.10
 *
 * v6.10 changes:
 * - Auto-pair now defaults ON (leadAutoPair: true). Returning users with a
 *   saved geosonify_lead keep their own setting.
 *
 * geosonify-audio-service.js v6.9
 *
 * v6.9 changes (real fix for the auto-switch click):
 * - The lead now PLANS phrases around the known drum-drop schedule instead of
 *   just deferring the switch. barsUntilNextDrop() reads the dropout counter;
 *   before entering a phrase the lead caps its length so the phrase ENDS a
 *   decay-margin (>=2 bars, tempo-scaled to the ~3.5s reverb tail) before the
 *   next drop, and if it's already too close it stays silent until after the
 *   drop. So when the voice/effect rebuilds at the drop, the tail has faded to
 *   silence - no click, not merely a delayed one. Cap is one-shot per phrase.
 *
 * geosonify-audio-service.js v6.8
 *
 * v6.8 changes:
 * - Effect selector exposed: getLeadEffectNames/getLeadEffectLabels/
 *   setLeadEffect for a manual override (UI dropdown). Manual pick applies now;
 *   auto resumes choosing at the next drum change.
 * - Effects made stronger/more obvious: deeper phaser (Q8, 4 oct, wet .7),
 *   pronounced flanger (feedback .7, depth .9), fuller double-track (depth .7,
 *   wet .7), and 'wide' fixed - width 0.7 was collapsing the lead toward one
 *   ear; 0.85 with centred mid/side now widens without panning. Delay a touch
 *   wetter (.32).
 * - Effect selection reworked: even mix (no more 2x 'straight'); a 4-round
 *   NO-STRAIGHT window right after unlock; and forced dotted-8th delay whenever
 *   the style is 'flowing' or the engine is 'fm' (user favourites - flowing
 *   only sits right with the delay, and FM bell + delay is loved).
 *
 * geosonify-audio-service.js v6.7
 *
 * v6.7 changes:
 * - Lead EFFECTS (auto-pair only): each voice-round can carry one effect,
 *   spliced before the reverb in the lead chain - 'straight' (none), dotted-8th
 *   'delay', 'adt' (double-track), 'wide' (stereo), 'phaser', 'flanger'.
 *   'straight' is weighted 2x so the plain voice still dominates. The opening
 *   is always theremin + straight; effects stay locked for the first four
 *   dropout voice-rounds and only enter from round 5 (LEAD_ROUNDS_BEFORE_
 *   EFFECTS). Never repeats the current effect. Delay time locks to the tempo
 *   (dotted 8th). All built on Tone 14.8.49 effect classes (verified present).
 *
 * geosonify-audio-service.js v6.6
 *
 * v6.6 changes:
 * - 'flowing' refined again: measurement showed it was busy but SQUARE (onsets
 *   mostly on-beat), which read as leaden. The 'running' cells are now lilting
 *   (off-beat push), lifting flowing's off-beat share into the musical range
 *   alongside lyrical while staying distinct (more onsets, rising contours,
 *   wider range, step cadence).
 * - Auto-pair no longer clicks: the drum dropout doesn't silence the LEAD, so
 *   rebuilding the voice at the dropout return could cut a ringing note. The
 *   switch is now QUEUED (leadPendingPair) and applied by leadBar at the next
 *   lead rest (when nothing is sounding). If the lead is already silent when
 *   auto-pair fires, it switches immediately. Voice + style always move
 *   together via applyLeadPair().
 *
 * geosonify-audio-service.js v6.5
 *
 * v6.5 changes:
 * - Chosen variant defaults: 80s Lead = 'hollow', Analog Mono = 'round'
 *   (persisted per-engine choices still override).
 * - 'flowing' style reworked - it read as leaden: dropped the plain-quarter
 *   'straight' family, added a 'running' 8th-note cell family, raised leap
 *   0.16->0.24, span 0.75->0.85, varProb 0.35->0.40, lowered restProb
 *   0.10->0.08, and swapped the drooping 'archtail' contour for rising 'asc'.
 *   Still distinct from lyrical/rhythmic.
 *
 * geosonify-audio-service.js v6.4
 *
 * v6.4 changes:
 * - Voice VARIANTS: 80s Lead and Analog Mono each expose 6 auditionable synth
 *   flavours (default + 5); 'default' reproduces the original sound
 *   byte-for-byte. theremin/fm keep a single 'default'. getLeadVariant/
 *   setLeadVariant/getLeadVariantNames/getLeadVariantLabels; persisted under
 *   geosonify_lead.variants. Only synth params change - notes/timing/routing
 *   are identical.
 * - AUTO-PAIR (leadAutoPair, off by default): on each drum-change return, the
 *   lead jumps to a random engine+style pair (theremin/sparse, fm/rhythmic,
 *   mono/lyrical, eighties/flowing), never the pair currently active. Rebuild
 *   happens during the silent drop-out, so it's click-safe.
 * - Per-engine loudness trim (LEAD_ENGINE_TRIM) added to leadVolumeDb wherever
 *   the lead volume node is set (build, per-bar ebb, setLeadVolume): theremin
 *   -3 dB, FM bell +9 dB, 80s lead and Analog mono unchanged. Trim only - the
 *   user's leadVolumeDb still governs overall lead level.
 * - Lead defaults changed: ON by default, theremin engine, sparse style, layer
 *   mode, 8-bar phrase / 12-bar rest / enter after 16 bars, follow-movement on.
 *   Persisted settings still override these for returning users.
 *
 * v6.3 changes (Lead becomes a real melodic composer):
 * - PITCHED LADDER: the lead's palette is now the exact set of (pitch-class,
 *   octave) pairs the place specifies in notePool - deduped, sorted by midi -
 *   NOT pitch-classes voiced at a chosen register. The pair is decode-critical
 *   data, so a pc is never voiced at an octave the place didn't give it.
 *   Stepwise motion = adjacent rung, which crosses octave boundaries only
 *   through real rungs. The tonal centre is itself a real rung (most common
 *   pc at its most mid-register occurrence). getLeadLadder() exposes it.
 * - COMPOSER: motif + development. A tune = a 2-5 note pitch motif, a rhythm
 *   cell (its rhythmic motif) and a contour, arranged in a small A A' B A''
 *   song plan. Each phrase entry plays one section: A' = inversion or
 *   rhythmic variation, B = fresh contrasting motif/contour/rhythm family,
 *   A'' = sequence-lifted or retrograde return. New tune after the plan
 *   completes, on style change, or when the place's notes change (palette
 *   signature check). Old evolve-20%-of-notes drift is gone.
 * - PHRASING: period form (antecedent ends off-tonic = question, consequent
 *   cadences onto the tonic = answer, approached by step or - for 'leap'
 *   cadence styles - a same-pc octave jump between real rungs). Contours
 *   (arch/invarch/asc/desc/archtail/wave) give one clear climax, forced onto
 *   a strong beat; velocity follows the tension curve; passing/neighbour
 *   tones on weak short slots; gap-fill after leaps; no pitch >2x in a row.
 * - RHYTHM: each phrase repeats ONE rhythm cell with recognizable variation
 *   (split/merge a value); cadence bars end long. New 'sixteenth' and
 *   'anacrusis' (pickup) families; styles retuned to be audibly distinct.
 * - REPLACE mode now mutes a drone note only while the lead is actually
 *   sounding in that octave (time-span overlap), not every octave the whole
 *   phrase visits - octave-spanning melodies no longer silence the background.
 * - Follow-movement now does something: when parked, ornament notes are
 *   thinned. Style changes restart the form so they're audible within a bar.
 * - New API: newLeadMelody(), getLeadPhrase(), getLeadLadder(),
 *   getLeadSection(). Settings/persistence unchanged (geosonify_lead).
 *
 * v6.2 changes:
 * - Lead / Melody Composer (off by default): COMPOSES a melody from the place's
 *   available pitch-classes (a palette across all octaves), voicing them in a
 *   sensible register with real rhythm (RHYTHM_PHRASES: quarters/8ths/dotted/
 *   triplet/syncopated/long), preferring stepwise motion, resolving to the
 *   tonal center. Pitches ALWAYS from notePool - never invented. Four styles
 *   (flowing/sparse/rhythmic/lyrical) and four voices (80s/theremin/FM/mono).
 *   FORM: enters after an intro, plays a phrase for N bars, rests, returns
 *   EVOLVED (varies ~20% of notes, recomposes after 3 evolutions or palette
 *   change). replace/layer routing. Persisted under geosonify_lead. Background
 *   byte-identical when off.
 * - Stagger reworked to a rotating active set: at most staggerCount idle
 *   octaves are staggered at once (default 1), rotating every
 *   staggerReshuffleBars (default 16); promoting a new octave demotes the
 *   oldest back to the downbeat. Both settable.
 * - Drums: 10 kits (arcade, boombap, minimal, techno, breakbeat, chiptune,
 *   lofi, shuffle, halftime, dnb); voicings are data-driven per kit. Kit
 *   selector has a "randomize" option (the default) that starts on arcade and
 *   switches to a different kit on each drop-out return (never repeats); a
 *   specific kit just plays that. Drop-out returns with a TAPERING fill
 *   (drumFillStart extra hats/bar shedding one per bar to zero).
 * - Stagger now ON by default: 2 octaves, rotating every 16 bars.
 * - Per-octave: optional random instrument "solo" (octaveSwapEnabled) routes a
 *   MELODIC octave (an evolving-pattern voice) to a pre-built spare chain for
 *   octaveSwapDurationBars every octaveSwapPeriodBars (default 48, sparing),
 *   then reverts. Skips when no octave is melodic. Click-free (pointer swap,
 *   no rebuild); yields to journeys/crossfade via perOctaveActive().
 * - New 'sub-bass' preset built on Tone.MonoSynth with a per-note filter
 *   envelope (defined low end for the bottom octaves). createSynthChain now
 *   honors an optional synthType:'mono' field; presets without it are
 * *   unchanged. Default per-octave mapping routes octaves 0-1 to sub-bass.
 *   getSubBassParams/setSubBassParam expose live filter-envelope tuning.
 * - Retro drum track (ON by default): kick/snare/hat on the drone's own eighth
 *   clock (no second transport). Three kits (arcade 4-bar, boombap 3-bar,
 *   minimal 2-bar) phase differently against octave cycles. Density follows
 *   movement, the kit ebbs with the stationary fade, and one optional hit flips
 *   every 8 bars. All drum settings persist under geosonify_drums.
 * - Per-octave instruments (off by default): each octave can route through its
 *   own preset chain instead of the shared A/B pair. Stateless per-trigger
 *   gating yields to journeys and mid-crossfade automatically. Enable state +
 *   octave->instrument map persist under geosonify_octave_instruments.
 * - Fixed stationary movement-fade being applied twice (drone faded to silence
 *   ~2x too fast). Fade is now applied exactly once, inside triggerNote().
 *   Legacy (non-pattern) path unchanged - it applies the fade once already.
 * - Default stationary fade timing relaxed to 60s hold / 30s fade (was 10s/15s);
 *   UI slider ranges extended (hold 5-120s, fade 5-90s).
 * - Staggered idle entrances (off by default): non-melodic ("idle") octaves can
 *   enter off the downbeat with evolving, unpredictable offsets. One octave's
 *   offset re-rolls every 16 bars, always-running (drifts while moving OR
 *   stationary). At least 2 octaves stay anchored on beat 1. Melodic octaves
 *   are never touched; flag off = byte-identical to prior behavior.
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

  // Per-octave instrument chains (optional; off by default)
  let octaveChains = {};          // octave -> { synth, hpFilter, lpFilter, reverb, volume, params, preset }
  let octaveInstrumentMap = {};   // octave -> presetName (user overrides of the default mapping)
  const OCTAVE_INSTRUMENTS_KEY = 'geosonify_octave_instruments';

  // Temporary per-octave instrument swap (idea 3): pre-built spare chains keyed
  // by preset name, so a swap is a routing-pointer change (click-free) rather
  // than an audio-graph rebuild. octaveSwap holds the currently swapped octave.
  const OCTAVE_SWAP_PRESETS = ['crystal', 'glitch', 'ethereal']; // contrasting swap-in voices
  let octaveSwapChains = {};      // presetName -> chain (spare pool)
  let octaveSwap = null;          // { octave, preset } or null
  let octaveSwapBarsLeft = 0;     // bars remaining before revert
  let octaveSwapCounter = 0;      // bars since last swap event

  // ============== LEAD / MELODY COMPOSER ==============
  // A monophonic foreground voice that COMPOSES a melody over the pitched
  // "ladder" the place supplies: the exact (pitch-class, octave) pairs in
  // notePool, and NOTHING else - the pair is decode-critical data, so a
  // pitch-class is never voiced at an octave the place didn't give. The
  // composer selects and orders from that real set using motif + development,
  // period (question/answer) phrasing, contour with a single climax, and
  // step-approached cadences. FORM: intro -> play a section -> rest -> return
  // with the NEXT section of a small A A' B A'' tune; new tune after the plan
  // completes or when the place's notes change. Off by default; the crystal
  // background is byte-identical when off.
  let leadSynth = null;
  let leadHp = null, leadLp = null, leadReverb = null, leadVolume = null;
  // The realized phrase for the CURRENT section:
  // array of { pc, octave, startBeat (absolute in phrase), durBeats, vel, ornament }
  let leadPhrase = null;
  let leadPhraseBars = 4;         // length of the current phrase in bars
  let leadPhraseCapBars = 0;      // if >0, cap the NEXT composed phrase to this many bars (drop-aware fit); 0 = no cap
  let leadFormState = 'intro';    // 'intro' | 'playing' | 'resting'
  let leadFormBar = 0;            // bar counter within the current form segment
  let leadTune = null;            // { signature, plan: [{label, degrees, cell, contour, lift}], pos }
  let leadNoteSpans = [];         // { octave, start, end } of scheduled lead notes (replace-mode muting)
  let leadPendingPair = null;     // { engine, style } queued by auto-pair; applied at the next lead rest to avoid a mid-phrase click
  let leadRoundCount = 0;         // how many auto-pair voice switches have happened this session
  let leadEffect = 'straight';    // current lead effect: 'straight'|'delay'|'adt'|'wide'|'phaser'|'flanger'
  let leadFx = null;              // the active effect node(s) in the chain (disposed with the chain)
  const LEAD_SETTINGS_KEY = 'geosonify_lead';

  // Retro drum track (optional; off by default)
  let drumKick = null, drumSnare = null, drumHat = null, drumVolume = null;
  let drumMutations = new Set();  // hitKeys whose optional-state is currently flipped
  let drumEvolveCounter = 0;      // bars since last evolution flip
  let drumDropoutCounter = 0;     // bars since last dropout event
  let drumDropoutBarsLeft = 0;    // bars remaining in the current silent dropout
  let drumFillBarsLeft = 0;       // bars remaining in the post-dropout busy fill (= extra hats/bar this bar)
  let drumFillHatsThisBar = 0;    // extra hats already injected in the current fill bar
  const DRUM_SETTINGS_KEY = 'geosonify_drums';

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
  
  // Staggered idle entrances (evolving, unpredictable offsets for non-melodic octaves)
  const STAGGER_OFFSET_POOL = [1, 1.5, 2, 2.5, 3]; // nonzero beats; a staggered octave picks one
  let staggerActive = [];              // ordered octaves currently staggered (oldest first); max = settings.staggerCount
  let staggerOffsets = {};             // octave -> offset in beats (only for octaves in staggerActive)
  let staggerBarCounter = 0;           // bars since last rotation
  
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
    staggeredIdleEntrances: true, // Stagger idle-octave entrances (rotating active set)
    staggerCount: 2,             // how many idle octaves are staggered at once
    staggerReshuffleBars: 16,    // bars between rotations (promote new, demote oldest)
    perOctaveEnabled: false,     // Route each octave through its own instrument chain
    octaveSwapEnabled: false,    // Occasionally give a melodic octave a "solo" in a new instrument
    octaveSwapPeriodBars: 48,    // bars between solos (sparing by default)
    octaveSwapDurationBars: 8,   // how long a solo lasts before reverting
    drumEnabled: true,           // Retro drum track (on by default)
    drumKitSelection: 'randomize', // 'randomize' or a specific kit name; randomize switches kit each drop-out return
    drumKit: 'arcade',           // the kit currently playing (in randomize mode this changes on each return)
    drumVolumeDb: -10,           // drumVolume node level
    drumFollowMovement: true,    // density + volume follow movement/stationary state
    drumEvolveEnabled: true,     // flip one optional hit every 8 bars
    drumDropoutEnabled: true,    // periodic drop-out + busier return
    drumDropoutBars: 64,         // period between drop-outs
    drumFillStart: 3,            // extra hats/bar at the start of the return (tapers -1/bar to 0)
    // Lead / arranger (off by default; place-fixed pitches, composed timing)
    leadEnabled: true,           // master toggle for the foreground lead voice
    leadEngine: 'theremin',      // '80s'|'theremin'|'fm'|'mono'
    leadStyle: 'sparse',         // melodic character: 'flowing'|'sparse'|'rhythmic'|'lyrical'
    leadPhraseBars: 8,           // phrase length in bars
    leadRestBars: 12,            // bars of rest between phrases
    leadIntroBars: 16,           // bars before the lead first enters
    leadMode: 'layer',           // 'replace' (mute the melody's octave) | 'layer' (over the top)
    leadVolumeDb: -6,            // lead output level
    leadFollowMovement: true,    // denser phrasing when moving, sparser when still
    leadFadeWhenStationary: false, // ebb the lead with the drone when parked
    leadAutoPair: true,          // on by default: on each drum change, switch to a random engine+style pair (never repeat current)
    
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
    },
    'sub-bass': {
      synthType: 'mono',
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.02, decay: 0.35, sustain: 0.85, release: 1.4 },
      filter: { Q: 3, type: 'lowpass', rolloff: -24 },
      filterEnvelope: {
        attack: 0.04, baseFrequency: 50, octaves: 3.2,
        decay: 0.5, sustain: 0.35, release: 1.2, exponent: 2
      },
      hpFreq: 20, lpFreq: 1200, reverbDecay: 2.0, reverbWet: 0.15, volume: -4,
      bpm: 80, humanize: 0.05, timeSignature: [4, 4]
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

  // Per-octave instruments persist BOTH the enable flag and the assignment map
  // under one key (option chosen deliberately; assignments are hand-tuned and
  // worth keeping across reloads).
  function loadOctaveInstruments() {
    try {
      const stored = localStorage.getItem(OCTAVE_INSTRUMENTS_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (data && typeof data === 'object') {
          octaveInstrumentMap = data.map && typeof data.map === 'object' ? data.map : {};
          settings.perOctaveEnabled = !!data.enabled;
          if (typeof data.swapEnabled === 'boolean') settings.octaveSwapEnabled = data.swapEnabled;
          if (typeof data.swapPeriodBars === 'number') settings.octaveSwapPeriodBars = data.swapPeriodBars;
          if (typeof data.swapDurationBars === 'number') settings.octaveSwapDurationBars = data.swapDurationBars;
        }
      }
    } catch (e) {
      console.warn('[AudioService] Failed to load octave instruments:', e);
    }
  }

  function saveOctaveInstruments() {
    try {
      localStorage.setItem(OCTAVE_INSTRUMENTS_KEY, JSON.stringify({
        enabled: !!settings.perOctaveEnabled,
        map: octaveInstrumentMap,
        swapEnabled: !!settings.octaveSwapEnabled,
        swapPeriodBars: settings.octaveSwapPeriodBars,
        swapDurationBars: settings.octaveSwapDurationBars
      }));
    } catch (e) {
      console.warn('[AudioService] Failed to save octave instruments:', e);
    }
  }

  // Drums persist everything (enable + kit + volume + follow/evolve toggles)
  // under one key, matching the per-octave persistence choice.
  function loadDrumSettings() {
    try {
      const stored = localStorage.getItem(DRUM_SETTINGS_KEY);
      if (stored) {
        const d = JSON.parse(stored);
        if (d && typeof d === 'object') {
          if (typeof d.enabled === 'boolean') settings.drumEnabled = d.enabled;
          if (typeof d.kitSelection === 'string') {
            settings.drumKitSelection = d.kitSelection;
            // A randomize session restarts on arcade; a fixed selection plays itself.
            settings.drumKit = (d.kitSelection === 'randomize') ? 'arcade' : d.kitSelection;
          }
          if (typeof d.volumeDb === 'number') settings.drumVolumeDb = d.volumeDb;
          if (typeof d.followMovement === 'boolean') settings.drumFollowMovement = d.followMovement;
          if (typeof d.evolveEnabled === 'boolean') settings.drumEvolveEnabled = d.evolveEnabled;
          if (typeof d.dropoutEnabled === 'boolean') settings.drumDropoutEnabled = d.dropoutEnabled;
          if (typeof d.dropoutBars === 'number') settings.drumDropoutBars = d.dropoutBars;
          if (typeof d.fillStart === 'number') settings.drumFillStart = d.fillStart;
        }
      }
    } catch (e) {
      console.warn('[AudioService] Failed to load drum settings:', e);
    }
  }

  function saveDrumSettings() {
    try {
      localStorage.setItem(DRUM_SETTINGS_KEY, JSON.stringify({
        enabled: !!settings.drumEnabled,
        kitSelection: settings.drumKitSelection,
        volumeDb: settings.drumVolumeDb,
        followMovement: !!settings.drumFollowMovement,
        evolveEnabled: !!settings.drumEvolveEnabled,
        dropoutEnabled: !!settings.drumDropoutEnabled,
        dropoutBars: settings.drumDropoutBars,
        fillStart: settings.drumFillStart
      }));
    } catch (e) {
      console.warn('[AudioService] Failed to save drum settings:', e);
    }
  }

  function loadLeadSettings() {
    try {
      const stored = localStorage.getItem(LEAD_SETTINGS_KEY);
      if (stored) {
        const d = JSON.parse(stored);
        if (d && typeof d === 'object') {
          if (typeof d.enabled === 'boolean') settings.leadEnabled = d.enabled;
          if (typeof d.engine === 'string') settings.leadEngine = d.engine;
          if (typeof d.style === 'string') settings.leadStyle = d.style;
          if (typeof d.phraseBars === 'number') settings.leadPhraseBars = d.phraseBars;
          if (typeof d.restBars === 'number') settings.leadRestBars = d.restBars;
          if (typeof d.introBars === 'number') settings.leadIntroBars = d.introBars;
          if (typeof d.mode === 'string') settings.leadMode = d.mode;
          if (typeof d.volumeDb === 'number') settings.leadVolumeDb = d.volumeDb;
          if (typeof d.followMovement === 'boolean') settings.leadFollowMovement = d.followMovement;
          if (typeof d.fadeWhenStationary === 'boolean') settings.leadFadeWhenStationary = d.fadeWhenStationary;
          if (typeof d.autoPair === 'boolean') settings.leadAutoPair = d.autoPair;
          if (d.variants && typeof d.variants === 'object') {
            for (const eng of Object.keys(leadEngineVariant)) {
              const v = d.variants[eng];
              if (typeof v === 'string' && LEAD_ENGINE_VARIANTS[eng] && LEAD_ENGINE_VARIANTS[eng][v]) {
                leadEngineVariant[eng] = v;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('[AudioService] Failed to load lead settings:', e);
    }
  }

  function saveLeadSettings() {
    try {
      localStorage.setItem(LEAD_SETTINGS_KEY, JSON.stringify({
        enabled: !!settings.leadEnabled,
        engine: settings.leadEngine,
        style: settings.leadStyle,
        phraseBars: settings.leadPhraseBars,
        restBars: settings.leadRestBars,
        introBars: settings.leadIntroBars,
        mode: settings.leadMode,
        volumeDb: settings.leadVolumeDb,
        followMovement: !!settings.leadFollowMovement,
        fadeWhenStationary: !!settings.leadFadeWhenStationary,
        autoPair: !!settings.leadAutoPair,
        variants: Object.assign({}, leadEngineVariant)
      }));
    } catch (e) {
      console.warn('[AudioService] Failed to save lead settings:', e);
    }
  }

  loadUserPresets();
  loadOctaveInstruments();
  loadDrumSettings();
  loadLeadSettings();

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

  async function createSynthChain(preset, label, maxPolyphony = 64) {
    const p = getPreset(preset);
    
    // Most presets are plain Synth (oscillator + amp envelope). A preset may
    // opt into MonoSynth by setting synthType:'mono', which adds a per-note
    // filter envelope (a "filter sweep") - the key to defined bass. Presets
    // without synthType take the original Synth path unchanged (byte-identical).
    let synth;
    if (p.synthType === 'mono') {
      synth = new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: createOscillatorConfig(p.oscillator || { type: 'triangle' }),
        envelope: p.envelope || { attack: 0.02, decay: 0.3, sustain: 0.8, release: 1.5 },
        filter: p.filter || { Q: 2, type: 'lowpass', rolloff: -24 },
        filterEnvelope: p.filterEnvelope || {
          attack: 0.03, baseFrequency: 60, octaves: 3.5,
          decay: 0.4, sustain: 0.4, release: 1.2, exponent: 2
        },
        maxPolyphony: maxPolyphony
      });
    } else if (p.synthType === 'fm') {
      synth = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: p.harmonicity || 3,
        modulationIndex: p.modulationIndex || 10,
        oscillator: createOscillatorConfig(p.oscillator || { type: 'sine' }),
        envelope: p.envelope || { attack: 0.02, decay: 0.3, sustain: 0.6, release: 1.2 },
        modulation: p.modulation || { type: 'square' },
        modulationEnvelope: p.modulationEnvelope || { attack: 0.05, decay: 0.2, sustain: 0.3, release: 0.5 },
        maxPolyphony: maxPolyphony
      });
    } else {
      synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: createOscillatorConfig(p.oscillator || { type: 'sine' }),
        envelope: p.envelope || { attack: 0.3, decay: 0.5, sustain: 0.7, release: 3.0 },
        maxPolyphony: maxPolyphony  // 64 for A/B dual chains; lower for per-octave chains
      });
    }
    
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

  // ============== PER-OCTAVE INSTRUMENT CHAINS ==============

  /**
   * Default octave->preset mapping when the user hasn't overridden an octave.
   * 0-2 -> meditation (dark/slow sub bed), 3-6 -> snapshot of presetA at build
   * time (keeps the loved center timbre), 7-9 -> crystal (bell-like top).
   */
  function resolveOctavePreset(octave) {
    if (octaveInstrumentMap[octave]) return octaveInstrumentMap[octave];
    if (octave <= 1) return 'sub-bass';
    if (octave === 2) return 'meditation';
    if (octave <= 6) return presetA;
    return 'crystal';
  }

  /**
   * Whether per-octave routing is active for THIS trigger. Stateless and
   * evaluated per note so journeys/crossfades reclaim A/B routing instantly
   * and hand it back on completion. Yields whenever a journey is active or
   * the crossfade is anywhere mid-range.
   */
  function perOctaveActive() {
    return settings.perOctaveEnabled &&
           (crossfade <= 0.01 || crossfade >= 0.99) &&
           !(global.JourneyService && global.JourneyService.isActive && global.JourneyService.isActive());
  }

  /**
   * Build all ten per-octave chains lazily. Tolerates Tone === null (pre-init):
   * if Tone isn't ready, do nothing now - buildOctaveChains is called again on
   * the next enable after initialize.
   */
  async function buildOctaveChains() {
    if (typeof Tone === 'undefined' || Tone === null) return;
    disposeOctaveChains(); // ensure clean slate
    for (let oct = 0; oct <= 9; oct++) {
      const preset = resolveOctavePreset(oct);
      const chain = await createSynthChain(preset, 'oct' + oct, 8);
      // Per-octave chains have no crossfade; lift out of the -60 start volume.
      chain.volume.volume.value = chain.params.volume || 0;
      chain.preset = preset;
      octaveChains[oct] = chain;
    }
    console.log('[AudioService] Built per-octave instrument chains');
  }

  /**
   * Dispose all per-octave chains (mirrors rebuildChain's dispose ordering).
   */
  function disposeOctaveChains() {
    for (const oct of Object.keys(octaveChains)) {
      const c = octaveChains[oct];
      if (!c) continue;
      try { c.synth?.dispose(); } catch (e) {}
      try { c.hpFilter?.dispose(); } catch (e) {}
      try { c.lpFilter?.dispose(); } catch (e) {}
      try { c.reverb?.dispose(); } catch (e) {}
      try { c.volume?.dispose(); } catch (e) {}
    }
    octaveChains = {};
  }

  /**
   * Rebuild a single octave's chain (used when its instrument is reassigned).
   */
  async function rebuildOctaveChain(octave) {
    if (typeof Tone === 'undefined' || Tone === null) return;
    const existing = octaveChains[octave];
    if (existing) {
      try { existing.synth?.dispose(); } catch (e) {}
      try { existing.hpFilter?.dispose(); } catch (e) {}
      try { existing.lpFilter?.dispose(); } catch (e) {}
      try { existing.reverb?.dispose(); } catch (e) {}
      try { existing.volume?.dispose(); } catch (e) {}
    }
    const preset = resolveOctavePreset(octave);
    const chain = await createSynthChain(preset, 'oct' + octave, 8);
    chain.volume.volume.value = chain.params.volume || 0;
    chain.preset = preset;
    octaveChains[octave] = chain;
  }

  /**
   * Build the spare swap-chain pool (one chain per OCTAVE_SWAP_PRESETS entry).
   * These sit idle until a swap routes an octave's triggers to one, making the
   * swap a pointer change rather than a rebuild (click-free).
   */
  async function buildOctaveSwapChains() {
    if (typeof Tone === 'undefined' || Tone === null) return;
    disposeOctaveSwapChains();
    for (const preset of OCTAVE_SWAP_PRESETS) {
      const chain = await createSynthChain(preset, 'swap-' + preset, 8);
      chain.volume.volume.value = chain.params.volume || 0;
      chain.preset = preset;
      octaveSwapChains[preset] = chain;
    }
    console.log('[AudioService] Built octave swap spare pool');
  }

  function disposeOctaveSwapChains() {
    for (const preset of Object.keys(octaveSwapChains)) {
      const c = octaveSwapChains[preset];
      if (!c) continue;
      try { c.synth?.dispose(); } catch (e) {}
      try { c.hpFilter?.dispose(); } catch (e) {}
      try { c.lpFilter?.dispose(); } catch (e) {}
      try { c.reverb?.dispose(); } catch (e) {}
      try { c.volume?.dispose(); } catch (e) {}
    }
    octaveSwapChains = {};
    octaveSwap = null;
    octaveSwapBarsLeft = 0;
  }

  /**
   * Bar-boundary swap scheduler. Runs only when per-octave routing is active.
   * Picks a random idle octave whose normal preset differs from the swap-in,
   * routes it to a spare chain for octaveSwapDurationBars, then reverts.
   */
  function tickOctaveSwap() {
    if (!settings.octaveSwapEnabled || !perOctaveActive()) {
      // If routing isn't active (journey/crossfade) drop any pending swap so we
      // don't resume a stale one later.
      octaveSwap = null;
      octaveSwapBarsLeft = 0;
      return;
    }
    if (octaveSwapBarsLeft > 0) {
      octaveSwapBarsLeft--;
      if (octaveSwapBarsLeft === 0) octaveSwap = null; // revert to default chain
      return;
    }
    octaveSwapCounter++;
    if (octaveSwapCounter < Math.max(4, settings.octaveSwapPeriodBars | 0)) return;
    octaveSwapCounter = 0;
    // Choose a MELODIC octave (one playing an evolving pattern - the "soloist")
    // so the swap reads like a lead voice stepping forward in a new timbre.
    // Falls through silently if nothing is melodic yet.
    const candidates = [];
    for (const oct of melodicOctaveQueue) {
      if (octaveChains[oct]) candidates.push(oct);
    }
    if (candidates.length === 0) return;
    const octave = candidates[Math.floor(Math.random() * candidates.length)];
    const normal = resolveOctavePreset(octave);
    const options = OCTAVE_SWAP_PRESETS.filter(p => p !== normal && octaveSwapChains[p]);
    if (options.length === 0) return;
    const preset = options[Math.floor(Math.random() * options.length)];
    octaveSwap = { octave, preset };
    octaveSwapBarsLeft = Math.max(1, settings.octaveSwapDurationBars | 0);
  }

  // ============== LEAD / ARRANGER ==============

  // Lead voices. portamento is kept small (or zero) so distinct notes actually
  // ARTICULATE - large glide on a mono synth merges rapid notes into one pitch.
  // Only the theremin leans into glide, because there the slide IS the sound.
  // Voice VARIANTS for auditioning. Each engine has a named set of synth
  // recipes; 'default' MUST reproduce the original sound byte-for-byte so an
  // untouched install is unchanged. The other variants only differ in synth
  // params (oscillator/filter/envelope) - notes, timing and routing are
  // identical. leadEngineVariant (per engine) selects which recipe make() uses.
  // Currently only eighties and mono expose alternates (the two the user wants
  // to improve); theremin and fm have a single 'default'.
  const LEAD_ENGINE_VARIANTS = {
    eighties: {
      // Original: bright detuned saw, resonant filter, fast attack.
      default:  () => new Tone.MonoSynth({
        oscillator: { type: 'fatsawtooth', spread: 20, count: 3 },
        envelope: { attack: 0.008, decay: 0.25, sustain: 0.7, release: 0.5 },
        filter: { Q: 4, type: 'lowpass', rolloff: -24 },
        filterEnvelope: { attack: 0.01, baseFrequency: 600, octaves: 3.5, decay: 0.25, sustain: 0.5, release: 0.6, exponent: 2 },
        portamento: 0.0
      }),
      // Wider, glassier - more detuning + higher open filter.
      hyperwide: () => new Tone.MonoSynth({
        oscillator: { type: 'fatsawtooth', spread: 40, count: 4 },
        envelope: { attack: 0.006, decay: 0.22, sustain: 0.75, release: 0.6 },
        filter: { Q: 3, type: 'lowpass', rolloff: -24 },
        filterEnvelope: { attack: 0.008, baseFrequency: 900, octaves: 3.2, decay: 0.22, sustain: 0.6, release: 0.7, exponent: 2 },
        portamento: 0.0
      }),
      // Screaming resonant lead - high Q, big filter sweep.
      screamer:  () => new Tone.MonoSynth({
        oscillator: { type: 'fatsawtooth', spread: 24, count: 3 },
        envelope: { attack: 0.004, decay: 0.3, sustain: 0.6, release: 0.5 },
        filter: { Q: 8, type: 'lowpass', rolloff: -24 },
        filterEnvelope: { attack: 0.015, baseFrequency: 400, octaves: 4.5, decay: 0.3, sustain: 0.35, release: 0.6, exponent: 2 },
        portamento: 0.0
      }),
      // Soft-attack pad-lead - slower onset, rounder, mellower top.
      softpad:   () => new Tone.MonoSynth({
        oscillator: { type: 'fatsawtooth', spread: 16, count: 3 },
        envelope: { attack: 0.06, decay: 0.3, sustain: 0.8, release: 0.9 },
        filter: { Q: 2, type: 'lowpass', rolloff: -24 },
        filterEnvelope: { attack: 0.08, baseFrequency: 500, octaves: 2.8, decay: 0.4, sustain: 0.6, release: 1.0, exponent: 2 },
        portamento: 0.02
      }),
      // Hollow square-ish PWM feel via narrow saw stack + tighter filter.
      hollow:    () => new Tone.MonoSynth({
        oscillator: { type: 'fatsquare', spread: 14, count: 2 },
        envelope: { attack: 0.006, decay: 0.2, sustain: 0.65, release: 0.5 },
        filter: { Q: 3, type: 'lowpass', rolloff: -24 },
        filterEnvelope: { attack: 0.01, baseFrequency: 700, octaves: 3, decay: 0.22, sustain: 0.5, release: 0.55, exponent: 2 },
        portamento: 0.0
      }),
      // Punchy plucked-lead - short decay, low sustain, snappy filter.
      pluck:     () => new Tone.MonoSynth({
        oscillator: { type: 'fatsawtooth', spread: 22, count: 3 },
        envelope: { attack: 0.004, decay: 0.18, sustain: 0.3, release: 0.35 },
        filter: { Q: 5, type: 'lowpass', rolloff: -24 },
        filterEnvelope: { attack: 0.005, baseFrequency: 800, octaves: 3.8, decay: 0.16, sustain: 0.2, release: 0.4, exponent: 2 },
        portamento: 0.0
      })
    },
    theremin: {
      // Floating theremin: pure sine, heavy glide, deep slow vibrato. Continuous.
      default: () => new Tone.DuoSynth({
        vibratoAmount: 0.5, vibratoRate: 5.5, harmonicity: 1.0, portamento: 0.18,
        voice0: { oscillator: { type: 'sine' }, envelope: { attack: 0.15, decay: 0.1, sustain: 0.9, release: 1.8 } },
        voice1: { oscillator: { type: 'sine' }, envelope: { attack: 0.2, decay: 0.1, sustain: 0.85, release: 1.8 } }
      })
    },
    fm: {
      // FM bell/reed lead - metallic, distinctive, articulate.
      default: () => new Tone.FMSynth({
        harmonicity: 2, modulationIndex: 8,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.006, decay: 0.3, sustain: 0.4, release: 0.6 },
        modulation: { type: 'triangle' },
        modulationEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.2, release: 0.4 },
        portamento: 0.0
      })
    },
    mono: {
      // Original: warm analog mono lead, gentle.
      default:  () => new Tone.MonoSynth({
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.01, decay: 0.25, sustain: 0.6, release: 0.7 },
        filter: { Q: 2, type: 'lowpass', rolloff: -24 },
        filterEnvelope: { attack: 0.02, baseFrequency: 400, octaves: 3, decay: 0.3, sustain: 0.4, release: 0.7 },
        portamento: 0.02
      }),
      // Fatter, rounder - triangle-ish body, lower filter, more sustain.
      round:    () => new Tone.MonoSynth({
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.9 },
        filter: { Q: 1, type: 'lowpass', rolloff: -24 },
        filterEnvelope: { attack: 0.03, baseFrequency: 300, octaves: 2.5, decay: 0.35, sustain: 0.5, release: 0.9 },
        portamento: 0.03
      }),
      // Reedy/nasal - square oscillator, resonant midrange emphasis.
      reedy:    () => new Tone.MonoSynth({
        oscillator: { type: 'square' },
        envelope: { attack: 0.012, decay: 0.22, sustain: 0.6, release: 0.6 },
        filter: { Q: 4, type: 'lowpass', rolloff: -24 },
        filterEnvelope: { attack: 0.02, baseFrequency: 600, octaves: 2.8, decay: 0.28, sustain: 0.45, release: 0.6 },
        portamento: 0.02
      }),
      // Bright & vocal - open filter, more octaves of sweep, keeps saw body.
      vocal:    () => new Tone.MonoSynth({
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.015, decay: 0.25, sustain: 0.65, release: 0.7 },
        filter: { Q: 3, type: 'lowpass', rolloff: -24 },
        filterEnvelope: { attack: 0.02, baseFrequency: 700, octaves: 3.5, decay: 0.3, sustain: 0.5, release: 0.7 },
        portamento: 0.04
      }),
      // Woody/muted - low filter, gentle Q, short-ish body, soft top.
      woody:    () => new Tone.MonoSynth({
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.02, decay: 0.28, sustain: 0.5, release: 0.6 },
        filter: { Q: 1.5, type: 'lowpass', rolloff: -24 },
        filterEnvelope: { attack: 0.03, baseFrequency: 250, octaves: 2.2, decay: 0.3, sustain: 0.35, release: 0.6 },
        portamento: 0.02
      }),
      // Singing portamento lead - heavier glide, longer release, expressive.
      glider:   () => new Tone.MonoSynth({
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.02, decay: 0.3, sustain: 0.7, release: 1.1 },
        filter: { Q: 2.5, type: 'lowpass', rolloff: -24 },
        filterEnvelope: { attack: 0.03, baseFrequency: 450, octaves: 3, decay: 0.35, sustain: 0.5, release: 1.0 },
        portamento: 0.10
      })
    }
  };

  // Human-facing labels for the variant selector (per engine).
  const LEAD_VARIANT_LABELS = {
    eighties: { default: 'Classic', hyperwide: 'Hyper-wide', screamer: 'Screamer', softpad: 'Soft pad', hollow: 'Hollow', pluck: 'Pluck' },
    theremin: { default: 'Classic' },
    fm:       { default: 'Classic' },
    mono:     { default: 'Classic', round: 'Round', reedy: 'Reedy', vocal: 'Vocal', woody: 'Woody', glider: 'Glider' }
  };

  // Per-engine glide (portamento at the composer level). Kept identical to the
  // original per-engine glide values so timing/articulation is unchanged.
  const LEAD_ENGINE_GLIDE = { eighties: 0.0, theremin: 0.18, fm: 0.0, mono: 0.02 };

  // The selected variant name per engine (persisted). Defaults keep the
  // original sound for every engine.
  // Chosen defaults: 80s Lead = hollow, Analog Mono = round. theremin/fm have
  // only 'default'. (Persisted per-engine choices still override these.)
  let leadEngineVariant = { eighties: 'hollow', theremin: 'default', fm: 'default', mono: 'round' };

  // Auto-pair sets: each drum change picks one of these (engine + matching
  // style), never the pair currently active, so it always audibly changes.
  const LEAD_AUTO_PAIRS = [
    { engine: 'theremin', style: 'sparse' },
    { engine: 'fm',       style: 'rhythmic' },
    { engine: 'mono',     style: 'lyrical' },
    { engine: 'eighties', style: 'flowing' }
  ];
  // Pick a pair that differs from the currently active engine+style.
  function pickNextLeadPair() {
    const options = LEAD_AUTO_PAIRS.filter(p =>
      !(p.engine === settings.leadEngine && p.style === settings.leadStyle));
    const pool = options.length ? options : LEAD_AUTO_PAIRS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function leadVariantNames(engine) {
    return Object.keys(LEAD_ENGINE_VARIANTS[engine] || { default: 1 });
  }
  function leadVariantMakeFor(engine) {
    const variants = LEAD_ENGINE_VARIANTS[engine] || LEAD_ENGINE_VARIANTS.fm;
    const name = leadEngineVariant[engine] || 'default';
    return variants[name] || variants.default;
  }

  // Back-compat facade: existing code reads LEAD_ENGINES[name].make()/.glide.
  // make() dispatches to the currently-selected variant FOR THAT engine key.
  const LEAD_ENGINES = {
    eighties: { glide: LEAD_ENGINE_GLIDE.eighties, make: () => leadVariantMakeFor('eighties')() },
    theremin: { glide: LEAD_ENGINE_GLIDE.theremin, make: () => leadVariantMakeFor('theremin')() },
    fm:       { glide: LEAD_ENGINE_GLIDE.fm,       make: () => leadVariantMakeFor('fm')() },
    mono:     { glide: LEAD_ENGINE_GLIDE.mono,     make: () => leadVariantMakeFor('mono')() }
  };

  // Per-engine loudness trim (dB) added to leadVolumeDb so the four voices sit
  // at a matched foreground level. Trim only - the user's leadVolumeDb still
  // sets the overall lead level; this just compensates the engines' intrinsic
  // loudness against each other. eighties/mono are the reference (0 dB).
  const LEAD_ENGINE_TRIM = {
    theremin: -3,   // pure sine reads loud - pull back
    fm:        9,   // metallic bell is intrinsically quiet - lift
    eighties:  0,
    mono:      0
  };
  function leadEngineTrim() {
    return LEAD_ENGINE_TRIM[settings.leadEngine] || 0;
  }

  /**
   * Phrasing rulesets. Each returns, for a given bar, an array of "speak"
   * The composer builds a melody from the place's pitch-classes and sets it to
   * a rhythm phrase. RHYTHM_PHRASES are per-bar rhythms (durations in beats that
   * sum to 4); the composer assigns pitches to these slots. A style picks which
   * rhythm family and how dense/ornamented the line is.
   */
  // Rhythm cells: arrays of note durations in beats (each sums to 4 = one bar).
  // The composer picks ONE cell as the phrase's rhythmic MOTIF and repeats it
  // with recognizable variation (split/merge one value), so rhythm is
  // composed, not sprinkled. 'sixteenth' adds 16th figures; 'anacrusis' cells
  // end in a pickup pair that leads into the next downbeat.
  const RHYTHM_PHRASES = {
    straight:   [[1, 1, 1, 1], [1, 1, 2]],                    // quarters
    flowing:    [[1, 0.5, 0.5, 1, 1], [1, 1, 0.5, 0.5, 1], [0.5, 0.5, 1, 1, 0.5, 0.5]], // mixed 8ths/4ths
    running:    [[0.5, 1, 0.5, 0.5, 1, 0.5], [0.75, 0.75, 0.5, 1, 1], [1, 0.5, 0.5, 1, 0.5, 0.5], [0.5, 0.5, 1, 0.75, 0.75, 0.5]], // lilting 8ths with off-beat push, not square
    dotted:     [[1.5, 0.5, 1.5, 0.5], [1.5, 0.5, 2], [1, 0.5, 1.5, 1]],   // dotted lilt
    triplet:    [[0.667, 0.667, 0.667, 1, 1], [2, 0.667, 0.667, 0.667]],   // triplet figure
    syncopated: [[0.5, 1, 0.5, 1, 1], [1, 0.5, 1, 0.5, 1], [0.5, 1, 1, 1.5]], // off-beat push / tied feel
    sixteenth:  [[0.5, 0.25, 0.25, 0.5, 0.5, 1, 1], [1, 0.25, 0.25, 0.5, 1, 1], [0.25, 0.25, 0.5, 1, 0.5, 0.5, 1]],
    anacrusis:  [[2, 1, 0.5, 0.5], [1, 1, 1, 0.5, 0.5]],      // ends with a pickup into the next bar
    long:       [[2, 2], [3, 1], [4]]                          // sustained / ambient
  };
  // Cadence bars end on a long, settled value (agogic weight on the landing).
  const LEAD_CADENCE_CELLS = [[1, 1, 2], [2, 2], [1, 3], [0.5, 0.5, 3]];

  // Style = rhythmic vocabulary + melodic temperament, tuned to be AUDIBLY
  // different: sparse = long tones and wide leaps over most of the ladder;
  // rhythmic = busy syncopation/16ths in a narrow band with a leaping cadence;
  // lyrical = dotted singing arcs; flowing = the balanced default.
  // span = fraction of the ladder a phrase may roam; varProb = chance a bar
  // varies the rhythm motif; motifLen = pitch-motif length in notes.
  const LEAD_STYLES = {
    flowing:  { rhythms: ['running', 'flowing', 'dotted'],         leap: 0.24, restProb: 0.08, motifLen: 4, contours: ['arch', 'wave', 'asc'],       cadence: 'step', span: 0.85, varProb: 0.40 },
    sparse:   { rhythms: ['long', 'dotted'],                       leap: 0.35, restProb: 0.28, motifLen: 3, contours: ['desc', 'invarch', 'arch'],   cadence: 'step', span: 0.95, varProb: 0.25 },
    rhythmic: { rhythms: ['syncopated', 'sixteenth', 'anacrusis'], leap: 0.22, restProb: 0.05, motifLen: 5, contours: ['wave', 'asc', 'arch'],       cadence: 'leap', span: 0.55, varProb: 0.50 },
    lyrical:  { rhythms: ['dotted', 'flowing', 'triplet'],         leap: 0.28, restProb: 0.12, motifLen: 4, contours: ['arch', 'archtail', 'desc'],  cadence: 'step', span: 0.85, varProb: 0.30 }
  };

  // ---- Lead effects ---------------------------------------------------------
  // An occasional effect on the lead adds surprise without pushing it forward.
  // Each factory returns a Tone node (or null for 'straight') spliced into the
  // lead chain BEFORE the reverb, so the effect feeds the shared space. The
  // node is disposed with the rest of the chain. wet levels are kept modest so
  // the lead stays a background "visitor", never a spotlight.
  const LEAD_EFFECTS = {
    straight: null,
    // Dotted-eighth feedback delay - the classic "ambient lead" ping. Time is
    // set per-build from the current tempo so it locks to a dotted 8th.
    delay:   () => new Tone.FeedbackDelay({ delayTime: leadDottedEighthSeconds(), feedback: 0.38, wet: 0.32 }),
    // ADT (artificial double-tracking): doubled/thickened, now deeper and wider
    // so it clearly reads as two voices rather than a hint.
    adt:     () => new Tone.Chorus({ frequency: 0.8, delayTime: 12, depth: 0.7, spread: 120, wet: 0.7 }).start(),
    // Wider stereo field. width is normalRange 0..1 where 0.5 = neutral; going
    // to 0.7 collapsed the lead toward one side. 0.85 with the mid/side balance
    // kept centred gives an obvious WIDE image without pushing it to one ear.
    wide:    () => new Tone.StereoWidener({ width: 0.85 }),
    // Slow phaser - now a deep, sweeping notch that's clearly audible.
    phaser:  () => new Tone.Phaser({ frequency: 0.5, octaves: 4, baseFrequency: 350, stages: 10, Q: 8, wet: 0.7 }),
    // Flanger via a short heavily-modulated feedback Chorus - now a pronounced
    // jet-sweep rather than a subtle shimmer.
    flanger: () => new Tone.Chorus({ frequency: 0.3, delayTime: 4.5, depth: 0.9, spread: 0, feedback: 0.7, wet: 0.6 }).start()
  };
  // Human-facing labels for the effect selector.
  const LEAD_EFFECT_LABELS = {
    straight: 'Straight (none)',
    delay:    'Dotted-8th delay',
    adt:      'Double-track',
    wide:     'Wide stereo',
    phaser:   'Phaser',
    flanger:  'Flanger'
  };
  // Effects that may appear once unlocked, in an EVEN mix (no weighting).
  const LEAD_EFFECT_POOL = ['straight', 'delay', 'adt', 'wide', 'phaser', 'flanger'];
  // Non-straight effects only - used during the "no straight" window and as a
  // fallback whenever straight must be excluded.
  const LEAD_EFFECT_POOL_NOSTRAIGHT = ['delay', 'adt', 'wide', 'phaser', 'flanger'];
  const LEAD_ROUNDS_BEFORE_EFFECTS = 4; // rounds 1-4 stay straight; effects may enter from round 5
  // After effects unlock, this many rounds are guaranteed non-straight (so the
  // ear hears the effect palette before 'straight' can reappear).
  const LEAD_ROUNDS_NOSTRAIGHT = 4;
  // Styles / engines that always take the dotted-eighth delay (user favourites:
  // flowing only sits right with the delay, and the FM bell + delay is loved).
  const LEAD_FORCE_DELAY_STYLES = new Set(['flowing']);
  const LEAD_FORCE_DELAY_ENGINES = new Set(['fm']);

  function leadDottedEighthSeconds() {
    // Dotted eighth = 0.75 beat. secondsPerBeat = 60 / bpm.
    const bpm = (typeof getCurrentBPM === 'function') ? getCurrentBPM() : (settings.bpm || 100);
    return (60 / Math.max(1, bpm)) * 0.75;
  }

  // Pick the effect for a voice-round given the engine+style about to play.
  // Order of rules:
  //  1) before unlock -> straight.
  //  2) favourites (flowing style, or fm engine) -> always delay.
  //  3) during the no-straight window right after unlock -> non-straight mix.
  //  4) otherwise -> even mix, never immediately repeating the current effect.
  function pickLeadEffect(engine, style) {
    if (leadRoundCount <= LEAD_ROUNDS_BEFORE_EFFECTS) return 'straight';
    if (LEAD_FORCE_DELAY_STYLES.has(style) || LEAD_FORCE_DELAY_ENGINES.has(engine)) return 'delay';
    const inNoStraightWindow =
      leadRoundCount <= LEAD_ROUNDS_BEFORE_EFFECTS + LEAD_ROUNDS_NOSTRAIGHT;
    const base = inNoStraightWindow ? LEAD_EFFECT_POOL_NOSTRAIGHT : LEAD_EFFECT_POOL;
    const pool = base.filter(e => e !== leadEffect);
    const src = pool.length ? pool : base;
    return src[Math.floor(Math.random() * src.length)];
  }

  async function buildLeadChain() {
    if (typeof Tone === 'undefined' || Tone === null) return;
    disposeLeadChain();
    const engine = LEAD_ENGINES[settings.leadEngine] || LEAD_ENGINES.fm;
    leadSynth = engine.make();
    leadHp = new Tone.Filter(120, 'highpass');
    leadLp = new Tone.Filter(9000, 'lowpass');
    leadReverb = new Tone.Reverb({ decay: 3.5, wet: 0.3 });
    leadVolume = new Tone.Volume(settings.leadVolumeDb + leadEngineTrim());
    // Optional effect, spliced before the reverb. 'straight' = no node.
    const fxFactory = LEAD_EFFECTS[leadEffect];
    leadFx = null;
    if (fxFactory) { try { leadFx = fxFactory(); } catch (e) { leadFx = null; } }
    if (leadFx) {
      leadSynth.chain(leadHp, leadLp, leadFx, leadReverb, leadVolume, masterVolume);
    } else {
      leadSynth.chain(leadHp, leadLp, leadReverb, leadVolume, masterVolume);
    }
    await leadReverb.ready;
    console.log('[AudioService] Built lead chain:', settings.leadEngine, '| fx:', leadEffect);
  }

  function disposeLeadChain() {
    try { leadSynth?.dispose(); } catch (e) {}
    try { leadHp?.dispose(); } catch (e) {}
    try { leadLp?.dispose(); } catch (e) {}
    try { leadFx?.dispose(); } catch (e) {}
    try { leadReverb?.dispose(); } catch (e) {}
    try { leadVolume?.dispose(); } catch (e) {}
    leadSynth = leadHp = leadLp = leadFx = leadReverb = leadVolume = null;
  }

  /**
   * Whether the lead is currently active for routing. Mirrors perOctaveActive's
   * deferral so the lead yields during journeys/crossfade.
   */
  function leadActive() {
    return settings.leadEnabled && leadSynth &&
           (crossfade <= 0.01 || crossfade >= 0.99) &&
           !(global.JourneyService && global.JourneyService.isActive && global.JourneyService.isActive());
  }

  // ---- Pitched ladder ------------------------------------------------------
  const LEAD_PC_ORDER = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  function leadNormPc(pc) {
    return pc.replace('Db','C#').replace('Eb','D#').replace('Gb','F#').replace('Ab','G#').replace('Bb','A#');
  }

  /**
   * Build the pitched palette: one ladder rung per concrete (pitch-class,
   * octave) pair the place actually specified in notePool - and NOTHING else.
   * The (pc, octave) PAIR is data (it decodes back to a location), so a
   * pitch-class is never voiced at an octave the place didn't give it.
   * Rungs are deduped and sorted by midi, so "stepwise" = adjacent rung -
   * which naturally crosses octave boundaries wherever the place supplied
   * consecutive-enough pitches, but only ever through real rungs.
   * The tonal centre is itself a REAL rung: the most common pitch-class,
   * taken at its occurrence closest to the ladder's midpoint (mid-register).
   */
  function leadLadder() {
    const seen = new Set();
    const rungs = [];
    const counts = {};
    for (let oct = 0; oct < notePool.length; oct++) {
      for (const raw of (notePool[oct] || [])) {
        const pc = leadNormPc(raw);
        const semi = LEAD_PC_ORDER.indexOf(pc);
        if (semi < 0) continue;
        counts[pc] = (counts[pc] || 0) + 1;
        const key = pc + oct;
        if (seen.has(key)) continue;
        seen.add(key);
        rungs.push({ pc, octave: oct, midi: 12 * (oct + 1) + semi });
      }
    }
    if (rungs.length === 0) return null;
    rungs.sort((a, b) => a.midi - b.midi);
    let centerPc = rungs[0].pc, best = -1;
    for (const pc in counts) { if (counts[pc] > best) { best = counts[pc]; centerPc = pc; } }
    const midMidi = rungs[Math.floor(rungs.length / 2)].midi;
    let tonicIdx = 0, bestDist = Infinity;
    for (let i = 0; i < rungs.length; i++) {
      if (rungs[i].pc !== centerPc) continue;
      const d = Math.abs(rungs[i].midi - midMidi);
      if (d < bestDist) { bestDist = d; tonicIdx = i; }
    }
    return { rungs, tonicIdx, signature: rungs.map(r => r.pc + r.octave).join(' ') };
  }

  // ---- Melodic material ----------------------------------------------------
  // Contour = the phrase's overall shape: 0..1 of phrase time -> 0..1 of the
  // usable ladder window. Each has ONE clear high (or low) point, not many.
  const LEAD_CONTOURS = {
    arch:     t => Math.sin(Math.PI * Math.pow(t, 1.6)),        // single peak ~65% in
    invarch:  t => 1 - Math.sin(Math.PI * Math.pow(t, 1.6)),    // dip and return
    asc:      t => t,                                           // climbing line
    desc:     t => 1 - t,                                       // falling line
    archtail: t => t < 0.7 ? Math.sin(Math.PI * t / 1.4) : Math.max(0.35, 1 - (t - 0.7) * 2.2),
    wave:     t => 0.5 + 0.45 * Math.sin(Math.PI * 2.5 * t)
  };

  /**
   * Generate a short pitch motif as RELATIVE ladder degrees (offsets from an
   * anchor rung): mostly stepwise, at most one leap, and after a leap the line
   * steps back the other way (gap fill).
   */
  function leadRandomMotif(style, maxSpan) {
    const len = Math.max(2, Math.min(style.motifLen, maxSpan + 1));
    const degrees = [0];
    let leapUsed = false, prevMove = 0;
    for (let i = 1; i < len; i++) {
      let move;
      if (!leapUsed && Math.random() < style.leap) {
        move = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.floor(Math.random() * 2)); // 2-3 rung leap
        leapUsed = true;
      } else if (Math.abs(prevMove) >= 2) {
        move = prevMove > 0 ? -1 : 1;                            // gap fill after the leap
      } else {
        move = (Math.random() < 0.85 ? 1 : 0) * (Math.random() < 0.5 ? -1 : 1); // step, rarely repeat
      }
      degrees.push(degrees[degrees.length - 1] + move);
      prevMove = move;
    }
    return degrees;
  }

  /**
   * A recognizable variation of a rhythm cell: merge its two shortest
   * neighbours into one value (augmentation of a figure) or split its longest
   * value into two (diminution). The cell stays the same length in beats.
   */
  function leadVaryCell(cell) {
    const out = cell.slice();
    if (out.length >= 3 && Math.random() < 0.5) {
      let bi = 0, bsum = Infinity;
      for (let i = 0; i + 1 < out.length; i++) {
        if (out[i] + out[i + 1] < bsum) { bsum = out[i] + out[i + 1]; bi = i; }
      }
      out.splice(bi, 2, bsum);
    } else {
      let bi = 0;
      for (let i = 1; i < out.length; i++) if (out[i] > out[bi]) bi = i;
      if (out[bi] >= 0.5) out.splice(bi, 1, out[bi] / 2, out[bi] / 2);
    }
    return out;
  }

  /**
   * Compose a new TUNE: a pitch motif + rhythm cell + contour arranged in a
   * small song plan A A' B A''. Each section becomes one phrase entry
   * (realized by composeLeadPhrase), so over successive returns the listener
   * hears statement, development, contrast, and a lifted/reversed return -
   * the tune GROWING rather than drifting. Development devices: inversion,
   * retrograde, rhythmic variation, sequence-lift. A fresh tune is composed
   * after the plan completes or when the place's notes change.
   */
  function composeLeadTune() {
    const lad = leadLadder();
    if (!lad) { leadTune = null; return; }
    const style = LEAD_STYLES[settings.leadStyle] || LEAD_STYLES.flowing;
    const maxSpan = Math.max(2, lad.rungs.length - 1);
    const degrees = leadRandomMotif(style, maxSpan);
    const family = style.rhythms[Math.floor(Math.random() * style.rhythms.length)];
    const cells = RHYTHM_PHRASES[family] || RHYTHM_PHRASES.straight;
    const cell = cells[Math.floor(Math.random() * cells.length)];
    const contour = style.contours[Math.floor(Math.random() * style.contours.length)];

    // Developments for the later sections.
    const inversion = degrees.map(d => -d);
    const retro = degrees.slice().reverse().map(d => d - degrees[degrees.length - 1]);
    const dev1 = Math.random() < 0.5
      ? { label: "A'",  degrees: inversion, cell, contour, lift: 0 }               // melodic inversion
      : { label: "A'",  degrees, cell: leadVaryCell(cell), contour, lift: 0 };     // rhythmic variation
    // Contrast section: fresh motif, different contour, different rhythm family.
    const bContourPool = Object.keys(LEAD_CONTOURS).filter(c => c !== contour);
    const bContour = bContourPool[Math.floor(Math.random() * bContourPool.length)];
    const bFams = style.rhythms.filter(f => f !== family);
    const bFam = bFams.length ? bFams[Math.floor(Math.random() * bFams.length)] : family;
    const bCells = RHYTHM_PHRASES[bFam] || RHYTHM_PHRASES.straight;
    const bSection = { label: 'B', degrees: leadRandomMotif(style, maxSpan),
                       cell: bCells[Math.floor(Math.random() * bCells.length)],
                       contour: bContour, lift: 0 };
    // Return: the original motif lifted one rung (sequence up - arrival), or
    // its retrograde coming back home.
    const dev2 = Math.random() < 0.6
      ? { label: "A''", degrees, cell, contour, lift: 1 }
      : { label: "A''", degrees: retro, cell, contour, lift: 0 };

    leadTune = {
      signature: lad.signature,
      plan: [{ label: 'A', degrees, cell, contour, lift: 0 }, dev1, bSection, dev2],
      pos: 0
    };
  }

  /**
   * Realize the tune's current section as a concrete phrase over the ladder.
   * Period form: the first half (antecedent) ends OFF the tonic - a musical
   * question - and the second half (consequent) cadences ONTO it - the
   * answer. Motif statements are anchored along the section's contour, which
   * yields automatic SEQUENCES (the figure restated higher/lower as the line
   * rises/falls); stepwise passing tones connect statements; weak short slots
   * become neighbour-style ornaments; there is one velocity/metric climax;
   * the final tonic is approached by step (or, for 'leap'-cadence styles, by
   * an octave jump between two REAL rungs of the same pitch-class, when the
   * place supplies one). Every pitch is chosen as a ladder INDEX, so by
   * construction the melody plays only (pc, octave) pairs the place gave.
   */
  function composeLeadPhrase() {
    const lad = leadLadder();
    if (!lad) { leadPhrase = null; return; }
    if (!leadTune || leadTune.signature !== lad.signature) composeLeadTune();
    if (!leadTune) { leadPhrase = null; return; }
    const style = LEAD_STYLES[settings.leadStyle] || LEAD_STYLES.flowing;
    const sec = leadTune.plan[leadTune.pos % leadTune.plan.length];
    const wanted = Math.max(1, settings.leadPhraseBars | 0);
    // If a drop-aware cap is set, shorten this phrase so it lands (with a decay
    // gap) before the next drum break. 0 = no cap.
    const bars = leadPhraseCapBars > 0 ? Math.min(wanted, leadPhraseCapBars) : wanted;
    leadPhraseBars = bars;

    // Usable ladder window: a span fraction of the ladder, kept around the tonic.
    const N = lad.rungs.length;
    const spanRungs = Math.min(N, Math.max(3, Math.round(N * style.span)));
    let lo = Math.max(0, lad.tonicIdx - (spanRungs >> 1));
    const hi = Math.min(N - 1, lo + spanRungs - 1);
    lo = Math.max(0, hi - spanRungs + 1);
    const range = Math.max(1, hi - lo);
    const clampIdx = (i) => Math.max(lo, Math.min(hi, i));

    // ---- Rhythm: repeat the section's cell with variation; the antecedent's
    // last bar and the final bar become cadence bars (long settled ending).
    const half = Math.max(1, Math.floor(bars / 2));
    const slots = [];
    for (let bar = 0; bar < bars; bar++) {
      const halfCadence = bars >= 4 && bar === half - 1;
      const finalCadence = bar === bars - 1;
      let cell;
      if (finalCadence || halfCadence) {
        cell = LEAD_CADENCE_CELLS[Math.floor(Math.random() * LEAD_CADENCE_CELLS.length)];
      } else if (bar === 0 || Math.random() > style.varProb) {
        cell = sec.cell;
      } else {
        cell = leadVaryCell(sec.cell);
      }
      let beat = 0;
      for (const raw of cell) {
        if (beat >= 4 - 1e-6) break;
        const dur = Math.min(raw, 4 - beat);
        slots.push({ startBeat: bar * 4 + beat, durBeats: dur, bar,
                     strong: (beat % 2) < 0.01, halfCadence, finalCadence });
        beat += dur;
      }
    }
    if (slots.length === 0) { leadPhrase = null; return; }

    // ---- Pitches: motif statements anchored on the contour + passing tones.
    const contourF = LEAD_CONTOURS[sec.contour] || LEAD_CONTOURS.arch;
    const deg = sec.degrees;
    // Anchor bounds that let a whole statement fit inside the window, so the
    // motif's interval shape survives intact instead of flattening at the
    // ladder's edges (falls back to plain clamping on very narrow windows).
    const degMin = Math.min.apply(null, deg);
    const degMax = Math.max.apply(null, deg);
    const aLo = lo - degMin, aHi = hi - degMax;
    const anchorFit = (a) => (aLo <= aHi) ? Math.max(aLo, Math.min(aHi, a)) : clampIdx(a);
    const totalBeats = bars * 4;
    const notes = [];
    let i = 0, prevIdx = null;
    while (i < slots.length) {
      const s = slots[i];
      const t = Math.min(1, s.startBeat / totalBeats);
      const anchorRaw = lo + Math.round(contourF(t) * range) + (sec.lift || 0);
      const anchor = clampIdx(anchorRaw);
      const inCadenceBar = s.halfCadence || s.finalCadence;
      if (!inCadenceBar && (i === 0 || Math.random() < 0.75)) {
        // State the motif (as much of it as fits before the next cadence
        // bar), anchored so its interval shape stays intact in the window.
        const a = anchorFit(anchorRaw);
        for (let k = 0; k < deg.length && i < slots.length; k++, i++) {
          const sl = slots[i];
          if (sl.halfCadence || sl.finalCadence) break;
          const idx = clampIdx(a + deg[k]);
          notes.push({ idx, slot: sl, ornament: false });
          prevIdx = idx;
        }
      } else {
        // Connective tissue: step toward the anchor (passing tone) or, on
        // weak short slots, a neighbour-style ornament. In cadence bars this
        // walks toward the tonic; the rewrite below pins the actual landing.
        const target = inCadenceBar ? lad.tonicIdx : anchor;
        let idx;
        if (prevIdx === null) idx = target;
        else {
          const dirTo = Math.sign(target - prevIdx);
          idx = prevIdx + (dirTo !== 0 ? dirTo : (Math.random() < 0.5 ? -1 : 1));
        }
        idx = clampIdx(idx);
        notes.push({ idx, slot: s, ornament: !s.strong && s.durBeats <= 0.5 && !inCadenceBar });
        prevIdx = idx;
        i++;
      }
    }
    if (notes.length === 0) { leadPhrase = null; return; }

    // ---- Rests: thin some weak, non-cadence notes (space is phrasing too).
    const thinned = notes.filter((n, j) => {
      if (j === 0 || n.slot.finalCadence || n.slot.halfCadence) return true;
      const p = n.slot.strong ? style.restProb * 0.5 : style.restProb;
      return Math.random() >= p;
    });
    const line = thinned.length >= 2 ? thinned : notes;

    // ---- Cadence rewrite: antecedent ends OFF-tonic (question); the phrase
    // ends ON the tonic (answer), approached by step or same-pc octave leap.
    const lastInBar = (barIdx) => {
      for (let j = line.length - 1; j >= 0; j--) if (line[j].slot.bar === barIdx) return j;
      return -1;
    };
    if (bars >= 4) {
      const q = lastInBar(half - 1);
      if (q >= 0) {
        let idx = clampIdx(lad.tonicIdx + (Math.random() < 0.5 ? 1 : 2));
        if (idx === lad.tonicIdx) idx = clampIdx(lad.tonicIdx - 1);
        line[q].idx = idx;
        line[q].ornament = false;
      }
    }
    const fin = lastInBar(bars - 1) >= 0 ? lastInBar(bars - 1) : line.length - 1;
    line[fin].idx = lad.tonicIdx;
    line[fin].ornament = false;
    if (fin - 1 >= 0) {
      let ap = null;
      if (style.cadence === 'leap') {
        // Same pitch-class at another REAL octave, if the place gave one.
        for (let j = 0; j < lad.rungs.length; j++) {
          if (j !== lad.tonicIdx && j >= lo && j <= hi &&
              lad.rungs[j].pc === lad.rungs[lad.tonicIdx].pc) { ap = j; break; }
        }
      }
      if (ap === null) {
        const from = line[fin - 1].idx;
        ap = clampIdx(lad.tonicIdx + (from >= lad.tonicIdx ? 1 : -1));
        if (ap === lad.tonicIdx) ap = clampIdx(lad.tonicIdx === lo ? lo + 1 : lad.tonicIdx - 1);
      }
      line[fin - 1].idx = ap;
      line[fin - 1].ornament = false;
    }

    // ---- One clear climax on a strong beat: if the highest pitch fell on a
    // weak slot, swap pitches with the highest strong-beat note. (Runs BEFORE
    // repeat elimination, since a swap can itself create a repeated run.)
    let maxJ = 0;
    for (let j = 1; j < line.length; j++) if (line[j].idx > line[maxJ].idx) maxJ = j;
    if (!line[maxJ].slot.strong) {
      let sw = -1;
      for (let j = 0; j < line.length; j++) {
        if (!line[j].slot.strong || j === fin || j === fin - 1) continue;
        if (sw < 0 || line[j].idx > line[sw].idx) sw = j;
      }
      if (sw >= 0) {
        const tmp = line[sw].idx; line[sw].idx = line[maxJ].idx; line[maxJ].idx = tmp;
      }
    }

    // ---- No pitch more than twice in a row: nudge one member of each run a
    // step, looping until stable (a nudge can create a new run downstream).
    // The cadence landing and its approach are pinned; pick another member.
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (let j = 2; j < line.length; j++) {
        if (!(line[j].idx === line[j - 1].idx && line[j].idx === line[j - 2].idx)) continue;
        let target = -1;
        for (const c of [j, j - 1, j - 2]) {
          if (c !== fin && c !== fin - 1) { target = c; break; }
        }
        if (target < 0) continue;
        // Prefer nudging DOWN so the fix can never mint a new melodic peak
        // (which the climax pass just placed on a strong beat).
        const dir = line[target].idx - 1 >= lo ? -1 : 1;
        let cand = clampIdx(line[target].idx + dir);
        if (cand === line[target].idx) cand = clampIdx(line[target].idx - dir);
        if (cand !== line[target].idx) { line[target].idx = cand; changed = true; }
      }
      if (!changed) break;
    }

    // ---- Dynamics: velocity follows the tension curve (ladder height +
    // proximity to the climax) with metric and climax accents.
    maxJ = 0;
    for (let j = 1; j < line.length; j++) if (line[j].idx > line[maxJ].idx) maxJ = j;
    const peakBeat = line[maxJ].slot.startBeat;
    for (let j = 0; j < line.length; j++) {
      const n = line[j];
      const height = (n.idx - lo) / range;
      const near = 1 - Math.min(1, Math.abs(n.slot.startBeat - peakBeat) / totalBeats * 2);
      let vel = 0.40 + 0.14 * height + 0.08 * near + (n.slot.strong ? 0.06 : 0);
      if (j === maxJ) vel += 0.10;
      if (sec.lift) vel += 0.03;
      n.vel = Math.min(0.88, vel);
    }

    leadPhrase = line.map(n => ({
      pc: lad.rungs[n.idx].pc,
      octave: lad.rungs[n.idx].octave,
      startBeat: n.slot.startBeat,
      durBeats: n.slot.durBeats,
      vel: n.vel,
      ornament: !!n.ornament
    }));
    leadPhraseCapBars = 0; // one-shot: the cap applied to this phrase only
  }

  /**
   * Advance to the tune's next section (A -> A' -> B -> A''), composing a
   * fresh tune after the last section. composeLeadPhrase also recomposes
   * automatically if the place's notes changed (palette signature check).
   */
  function advanceLeadSection() {
    if (leadTune) {
      leadTune.pos++;
      if (leadTune.pos >= leadTune.plan.length) leadTune = null;
    }
    composeLeadPhrase();
  }

  /**
   * Called once per bar from the drone clock. Manages the FORM (intro -> play
   * a section -> rest -> return with the tune's NEXT section; new tune after
   * the plan completes or when the place changes) and, during playing bars,
   * schedules the portion of the composed melody that falls in this bar.
   */
  // Apply a queued (or immediate) auto-pair switch. Only rebuilds the voice
  // when the engine actually changes; always refreshes style + tune so the
  // next composed phrase takes on the new character. Callers must ensure the
  // lead is silent (resting/intro) before invoking, to avoid a click.
  function applyLeadPair(pair) {
    if (!pair) return;
    settings.leadStyle = pair.style;
    leadTune = null;                 // new character = new tune next phrase
    // This is a voice-round: count it, then pick this round's effect. The first
    // LEAD_ROUNDS_BEFORE_EFFECTS rounds stay 'straight'; after that, effects may
    // enter. Effect is chosen here so the rebuilt chain includes it.
    leadRoundCount++;
    const nextEffect = pickLeadEffect(pair.engine, pair.style);
    const effectChanged = (nextEffect !== leadEffect);
    leadEffect = nextEffect;
    const engineChanged = (pair.engine !== settings.leadEngine);
    if (engineChanged) settings.leadEngine = pair.engine;
    saveLeadSettings();
    if (engineChanged || effectChanged) {
      buildLeadChain();              // rebuild while silent (async, fire-and-forget)
    }
  }

  // ---- Drop-aware phrase fitting -------------------------------------------
  // How many whole bars from the START of the NEXT bar until the next drum
  // drop-out begins. The scheduler fires a drop when, on a played bar,
  // drumDropoutCounter+1 >= drumDropoutBars (it increments then tests). So from
  // the next bar onward the drop lands after (period - counter) bars. Returns a
  // large number when drops are disabled or currently suppressed, so the lead
  // just uses its normal phrase length.
  function barsUntilNextDrop() {
    if (!settings.drumDropoutEnabled) return 9999;
    if (typeof shouldSkipEvolution === 'function' && shouldSkipEvolution()) return 9999; // parked: no drops
    const period = Math.max(4, settings.drumDropoutBars | 0);
    // If we're mid-dropout or in the post-drop fill, the counter is paused; the
    // safest read is "not right now" - let the phrase run normally.
    if (drumDropoutBarsLeft > 0 || drumFillBarsLeft > 0) return 9999;
    const remaining = period - drumDropoutCounter;
    return remaining > 0 ? remaining : period; // guard against off-by-one at the boundary
  }

  // Bars of silence to leave after a phrase so its reverb/delay tail decays
  // before the drop and the voice rebuild. Reverb decay is ~3.5s; scale to the
  // tempo (minimum 2 bars) so faster tempos still clear the tail.
  function leadDecayMarginBars() {
    const bpm = (typeof getCurrentBPM === 'function') ? getCurrentBPM() : (settings.bpm || 100);
    const secPerBar = (60 / Math.max(1, bpm)) * 4;
    const tailBars = Math.ceil(3.5 / Math.max(0.1, secPerBar));
    return Math.max(2, tailBars);
  }

  // Given we're about to enter a playing phrase, decide its capped length so it
  // finishes with a decay gap before the next drop. Returns:
  //   >=1  -> enter and cap the phrase to this many bars
  //    0   -> don't enter yet; too close to the drop, keep resting
  function leadPhraseFitBars() {
    const until = barsUntilNextDrop();
    if (until >= 9999) return Math.max(1, settings.leadPhraseBars | 0); // no drop soon: full phrase
    const room = until - leadDecayMarginBars();
    if (room < 1) return 0;                     // too close - wait past the drop
    return Math.min(Math.max(1, settings.leadPhraseBars | 0), room);
  }

  function leadBar(barStartTime, secondsPerBeat) {
    if (!leadActive()) return;

    // Ebb with the drone when stationary, if enabled (once per bar).
    if (leadVolume) {
      const ebb = settings.leadFadeWhenStationary ? currentDroneVolumeReduction : 0;
      leadVolume.volume.rampTo(settings.leadVolumeDb + leadEngineTrim() + ebb, 0.5);
    }

    // FORM state machine.
    // Apply a queued auto-pair switch now IF the lead is silent this bar
    // (resting or intro). Deferring to here means a switch requested mid-phrase
    // waits for the phrase to finish, so the voice rebuild never cuts a ringing
    // note. One extra guard: only switch on a resting bar that still has room
    // before the next entry, so the rebuilt voice is audibly the new one.
    if (leadPendingPair && leadFormState !== 'playing') {
      applyLeadPair(leadPendingPair);
      leadPendingPair = null;
    }

    if (leadFormState === 'intro') {
      leadFormBar++;
      if (leadFormBar >= Math.max(0, settings.leadIntroBars | 0)) {
        const fit = leadPhraseFitBars();
        if (fit <= 0) return; // too close to the next drop - hold silent one more bar
        leadPhraseCapBars = fit;
        leadFormState = 'playing'; leadFormBar = 0;
        composeLeadPhrase();
      }
      return; // silent during intro
    }

    if (leadFormState === 'resting') {
      leadFormBar++;
      if (leadFormBar >= Math.max(1, settings.leadRestBars | 0)) {
        const fit = leadPhraseFitBars();
        if (fit <= 0) return; // too close to the next drop - stay resting this bar
        leadPhraseCapBars = fit;
        leadFormState = 'playing'; leadFormBar = 0;
        // Return with the tune's next section (A -> A' -> B -> A'').
        advanceLeadSection();
      }
      return; // silent during rest
    }

    // playing: schedule the slice of the phrase that lands in this bar.
    if (!leadPhrase) { composeLeadPhrase(); if (!leadPhrase) return; }
    const barStartBeatAbs = leadFormBar * 4;
    const barEndBeatAbs = barStartBeatAbs + 4;

    // Prune replace-mode spans that ended before this bar.
    if (leadNoteSpans.length) {
      leadNoteSpans = leadNoteSpans.filter(sp => sp.end > barStartTime - 0.5);
    }

    // Follow movement: when parked, thin the ornaments (sparser line).
    const thinOrnaments = settings.leadFollowMovement && currentDroneVolumeReduction < -3;

    for (const note of leadPhrase) {
      if (note.startBeat < barStartBeatAbs || note.startBeat >= barEndBeatAbs) continue;
      if (thinOrnaments && note.ornament) continue;
      const beatInBar = note.startBeat - barStartBeatAbs;
      const when = barStartTime + beatInBar * secondsPerBeat;
      const dur = Math.max(0.08, note.durBeats * secondsPerBeat - 0.03);
      const octave = note.octave + settings.transpose;
      const fullNote = `${note.pc}${octave}`;
      try { leadSynth.triggerAttackRelease(fullNote, dur, when, note.vel); } catch (e) {}
      leadNoteSpans.push({ octave: note.octave, start: when, end: when + dur });
      emitNoteEvent(fullNote, dur, note.vel, when, { octave: note.octave, slotIndex: 0, lead: true });
    }

    leadFormBar++;
    if (leadFormBar >= leadPhraseBars) {
      // Phrase finished -> rest.
      leadFormState = 'resting'; leadFormBar = 0;
    }
  }


  // ============== RETRO DRUM TRACK ==============

  /**
   * Drum patterns as data. beat values are on the eighth grid (0,0.5,...,3.5).
   * Downbeat kicks (beat 0) are never optional. Pattern length per kit is the
   * phasing knob: 4-bar arcade locks with 4-bar octave cycles; 3-bar boombap
   * drifts and realigns every 12 bars; 2-bar minimal is a sparse kick+hat.
   */
  const DRUM_KITS = {
    arcade: {
      lengthBars: 4,
      voicing: {
        kick: { pitchDecay: 0.05, octaves: 6, envelope: { attack: 0.001, decay: 0.2, sustain: 0 } },
        snare: { noise: 'white', envelope: { attack: 0.001, decay: 0.15, sustain: 0 } },
        hat: { decay: 0.05, release: 0.01, harmonicity: 5.1, resonance: 6000 }
      },
      hits: [
        { inst: 'kick', bar: 0, beat: 0, vel: 1.0 },
        { inst: 'hat',  bar: 0, beat: 1, vel: 0.5 },
        { inst: 'snare',bar: 0, beat: 2, vel: 0.8 },
        { inst: 'hat',  bar: 0, beat: 3, vel: 0.5 },
        { inst: 'hat',  bar: 0, beat: 1.5, vel: 0.4, optional: true },
        { inst: 'kick', bar: 1, beat: 0, vel: 1.0 },
        { inst: 'hat',  bar: 1, beat: 1, vel: 0.5 },
        { inst: 'snare',bar: 1, beat: 2, vel: 0.8 },
        { inst: 'hat',  bar: 1, beat: 3, vel: 0.5 },
        { inst: 'kick', bar: 1, beat: 2.5, vel: 0.7, optional: true },
        { inst: 'kick', bar: 2, beat: 0, vel: 1.0 },
        { inst: 'hat',  bar: 2, beat: 1, vel: 0.5 },
        { inst: 'snare',bar: 2, beat: 2, vel: 0.8 },
        { inst: 'hat',  bar: 2, beat: 3, vel: 0.5 },
        { inst: 'hat',  bar: 2, beat: 3.5, vel: 0.4, optional: true },
        { inst: 'kick', bar: 3, beat: 0, vel: 1.0 },
        { inst: 'hat',  bar: 3, beat: 1, vel: 0.5 },
        { inst: 'snare',bar: 3, beat: 2, vel: 0.8 },
        { inst: 'snare',bar: 3, beat: 3.5, vel: 0.6, optional: true },
        { inst: 'hat',  bar: 3, beat: 3, vel: 0.5 }
      ]
    },
    boombap: {
      lengthBars: 3,
      voicing: {
        kick: { pitchDecay: 0.05, octaves: 5, envelope: { attack: 0.001, decay: 0.4, sustain: 0 } },
        snare: { noise: 'pink', envelope: { attack: 0.001, decay: 0.25, sustain: 0 } },
        hat: { decay: 0.08, release: 0.02, harmonicity: 5.1, resonance: 4000 }
      },
      hits: [
        { inst: 'kick', bar: 0, beat: 0, vel: 1.0 },
        { inst: 'snare',bar: 0, beat: 2, vel: 0.9 },
        { inst: 'hat',  bar: 0, beat: 0.5, vel: 0.4 },
        { inst: 'hat',  bar: 0, beat: 1.5, vel: 0.4 },
        { inst: 'hat',  bar: 0, beat: 2.5, vel: 0.4, optional: true },
        { inst: 'kick', bar: 0, beat: 2.5, vel: 0.7, optional: true },
        { inst: 'kick', bar: 1, beat: 0, vel: 1.0 },
        { inst: 'kick', bar: 1, beat: 0.5, vel: 0.6, optional: true },
        { inst: 'snare',bar: 1, beat: 2, vel: 0.9 },
        { inst: 'hat',  bar: 1, beat: 1, vel: 0.4 },
        { inst: 'hat',  bar: 1, beat: 3, vel: 0.4 },
        { inst: 'kick', bar: 2, beat: 0, vel: 1.0 },
        { inst: 'snare',bar: 2, beat: 2, vel: 0.9 },
        { inst: 'snare',bar: 2, beat: 3.5, vel: 0.5, optional: true },
        { inst: 'hat',  bar: 2, beat: 1.5, vel: 0.4 },
        { inst: 'hat',  bar: 2, beat: 2.5, vel: 0.4, optional: true }
      ]
    },
    minimal: {
      lengthBars: 2,
      voicing: {
        kick: { pitchDecay: 0.04, octaves: 6, envelope: { attack: 0.001, decay: 0.3, sustain: 0 } },
        snare: null,
        hat: { decay: 0.05, release: 0.01, harmonicity: 5.1, resonance: 5000 }
      },
      hits: [
        { inst: 'kick', bar: 0, beat: 0, vel: 1.0 },
        { inst: 'hat',  bar: 0, beat: 2, vel: 0.5 },
        { inst: 'hat',  bar: 0, beat: 3, vel: 0.4, optional: true },
        { inst: 'kick', bar: 1, beat: 0, vel: 1.0 },
        { inst: 'hat',  bar: 1, beat: 2, vel: 0.5 },
        { inst: 'kick', bar: 1, beat: 2.5, vel: 0.6, optional: true }
      ]
    },
    // ---- Genre kits ----
    techno: {
      lengthBars: 2,
      voicing: {
        kick: { pitchDecay: 0.03, octaves: 4, envelope: { attack: 0.001, decay: 0.35, sustain: 0 } },
        snare: { noise: 'white', envelope: { attack: 0.001, decay: 0.1, sustain: 0 } },
        hat: { decay: 0.03, release: 0.005, harmonicity: 5.1, resonance: 8000 }
      },
      hits: [
        { inst: 'kick', bar: 0, beat: 0, vel: 1.0 },
        { inst: 'kick', bar: 0, beat: 1, vel: 1.0 },
        { inst: 'kick', bar: 0, beat: 2, vel: 1.0 },
        { inst: 'kick', bar: 0, beat: 3, vel: 1.0 },
        { inst: 'hat',  bar: 0, beat: 0.5, vel: 0.5 },
        { inst: 'hat',  bar: 0, beat: 1.5, vel: 0.5 },
        { inst: 'hat',  bar: 0, beat: 2.5, vel: 0.5 },
        { inst: 'hat',  bar: 0, beat: 3.5, vel: 0.5, optional: true },
        { inst: 'kick', bar: 1, beat: 0, vel: 1.0 },
        { inst: 'kick', bar: 1, beat: 1, vel: 1.0 },
        { inst: 'kick', bar: 1, beat: 2, vel: 1.0 },
        { inst: 'kick', bar: 1, beat: 3, vel: 1.0 },
        { inst: 'snare',bar: 1, beat: 2, vel: 0.7, optional: true },
        { inst: 'hat',  bar: 1, beat: 0.5, vel: 0.5 },
        { inst: 'hat',  bar: 1, beat: 1.5, vel: 0.5 },
        { inst: 'hat',  bar: 1, beat: 2.5, vel: 0.5 },
        { inst: 'hat',  bar: 1, beat: 3.5, vel: 0.5, optional: true }
      ]
    },
    breakbeat: {
      lengthBars: 2,
      voicing: {
        kick: { pitchDecay: 0.04, octaves: 5, envelope: { attack: 0.001, decay: 0.25, sustain: 0 } },
        snare: { noise: 'white', envelope: { attack: 0.001, decay: 0.18, sustain: 0 } },
        hat: { decay: 0.04, release: 0.01, harmonicity: 4.8, resonance: 7000 }
      },
      hits: [
        { inst: 'kick', bar: 0, beat: 0, vel: 1.0 },
        { inst: 'snare',bar: 0, beat: 1, vel: 0.85 },
        { inst: 'hat',  bar: 0, beat: 0.5, vel: 0.4 },
        { inst: 'kick', bar: 0, beat: 1.5, vel: 0.7, optional: true },
        { inst: 'snare',bar: 0, beat: 2.5, vel: 0.8 },
        { inst: 'hat',  bar: 0, beat: 2, vel: 0.4 },
        { inst: 'snare',bar: 0, beat: 3, vel: 0.6, optional: true },
        { inst: 'hat',  bar: 0, beat: 3.5, vel: 0.4, optional: true },
        { inst: 'kick', bar: 1, beat: 0, vel: 1.0 },
        { inst: 'kick', bar: 1, beat: 0.5, vel: 0.6, optional: true },
        { inst: 'snare',bar: 1, beat: 1, vel: 0.85 },
        { inst: 'hat',  bar: 1, beat: 1.5, vel: 0.4 },
        { inst: 'snare',bar: 1, beat: 2.5, vel: 0.8 },
        { inst: 'kick', bar: 1, beat: 3, vel: 0.7, optional: true },
        { inst: 'hat',  bar: 1, beat: 3.5, vel: 0.4, optional: true }
      ]
    },
    // ---- Retro flavors ----
    chiptune: {
      lengthBars: 4,
      voicing: {
        kick: { pitchDecay: 0.02, octaves: 8, envelope: { attack: 0.001, decay: 0.12, sustain: 0 } },
        snare: { noise: 'white', envelope: { attack: 0.001, decay: 0.08, sustain: 0 } },
        hat: { decay: 0.02, release: 0.005, harmonicity: 6.0, resonance: 9000 }
      },
      hits: [
        { inst: 'kick', bar: 0, beat: 0, vel: 1.0 },
        { inst: 'hat',  bar: 0, beat: 0.5, vel: 0.4 },
        { inst: 'snare',bar: 0, beat: 2, vel: 0.7 },
        { inst: 'hat',  bar: 0, beat: 2.5, vel: 0.4 },
        { inst: 'hat',  bar: 0, beat: 3.5, vel: 0.3, optional: true },
        { inst: 'kick', bar: 1, beat: 0, vel: 1.0 },
        { inst: 'kick', bar: 1, beat: 1.5, vel: 0.6, optional: true },
        { inst: 'snare',bar: 1, beat: 2, vel: 0.7 },
        { inst: 'hat',  bar: 1, beat: 0.5, vel: 0.4 },
        { inst: 'hat',  bar: 1, beat: 3, vel: 0.4 },
        { inst: 'kick', bar: 2, beat: 0, vel: 1.0 },
        { inst: 'snare',bar: 2, beat: 2, vel: 0.7 },
        { inst: 'hat',  bar: 2, beat: 1, vel: 0.4 },
        { inst: 'hat',  bar: 2, beat: 3, vel: 0.4, optional: true },
        { inst: 'kick', bar: 3, beat: 0, vel: 1.0 },
        { inst: 'snare',bar: 3, beat: 2, vel: 0.7 },
        { inst: 'snare',bar: 3, beat: 3, vel: 0.5, optional: true },
        { inst: 'hat',  bar: 3, beat: 3.5, vel: 0.4, optional: true }
      ]
    },
    lofi: {
      lengthBars: 4,
      voicing: {
        kick: { pitchDecay: 0.06, octaves: 4, envelope: { attack: 0.002, decay: 0.45, sustain: 0 } },
        snare: { noise: 'brown', envelope: { attack: 0.002, decay: 0.2, sustain: 0 } },
        hat: { decay: 0.06, release: 0.03, harmonicity: 3.5, resonance: 3000 }
      },
      hits: [
        { inst: 'kick', bar: 0, beat: 0, vel: 0.9 },
        { inst: 'snare',bar: 0, beat: 2, vel: 0.75 },
        { inst: 'hat',  bar: 0, beat: 1, vel: 0.35 },
        { inst: 'hat',  bar: 0, beat: 3, vel: 0.35 },
        { inst: 'hat',  bar: 0, beat: 2.5, vel: 0.3, optional: true },
        { inst: 'kick', bar: 1, beat: 0, vel: 0.9 },
        { inst: 'kick', bar: 1, beat: 2.5, vel: 0.55, optional: true },
        { inst: 'snare',bar: 1, beat: 2, vel: 0.75 },
        { inst: 'hat',  bar: 1, beat: 1, vel: 0.35 },
        { inst: 'hat',  bar: 1, beat: 3, vel: 0.35 },
        { inst: 'kick', bar: 2, beat: 0, vel: 0.9 },
        { inst: 'snare',bar: 2, beat: 2, vel: 0.75 },
        { inst: 'hat',  bar: 2, beat: 1, vel: 0.35 },
        { inst: 'hat',  bar: 2, beat: 3, vel: 0.35 },
        { inst: 'hat',  bar: 2, beat: 1.5, vel: 0.3, optional: true },
        { inst: 'kick', bar: 3, beat: 0, vel: 0.9 },
        { inst: 'snare',bar: 3, beat: 2, vel: 0.75 },
        { inst: 'kick', bar: 3, beat: 3, vel: 0.5, optional: true },
        { inst: 'hat',  bar: 3, beat: 1, vel: 0.35 }
      ]
    },
    shuffle: {
      lengthBars: 2,
      voicing: {
        kick: { pitchDecay: 0.05, octaves: 5, envelope: { attack: 0.001, decay: 0.3, sustain: 0 } },
        snare: { noise: 'pink', envelope: { attack: 0.001, decay: 0.2, sustain: 0 } },
        hat: { decay: 0.05, release: 0.02, harmonicity: 5.0, resonance: 5500 }
      },
      hits: [
        // Swung feel: hats land on the "and" with a shuffle lilt
        { inst: 'kick', bar: 0, beat: 0, vel: 1.0 },
        { inst: 'hat',  bar: 0, beat: 0.5, vel: 0.45 },
        { inst: 'snare',bar: 0, beat: 1, vel: 0.8 },
        { inst: 'hat',  bar: 0, beat: 1.5, vel: 0.35, optional: true },
        { inst: 'kick', bar: 0, beat: 2, vel: 0.85 },
        { inst: 'hat',  bar: 0, beat: 2.5, vel: 0.45 },
        { inst: 'snare',bar: 0, beat: 3, vel: 0.8 },
        { inst: 'hat',  bar: 0, beat: 3.5, vel: 0.35, optional: true },
        { inst: 'kick', bar: 1, beat: 0, vel: 1.0 },
        { inst: 'hat',  bar: 1, beat: 0.5, vel: 0.45 },
        { inst: 'snare',bar: 1, beat: 1, vel: 0.8 },
        { inst: 'kick', bar: 1, beat: 2, vel: 0.85 },
        { inst: 'hat',  bar: 1, beat: 2.5, vel: 0.45 },
        { inst: 'snare',bar: 1, beat: 3, vel: 0.8 },
        { inst: 'kick', bar: 1, beat: 3.5, vel: 0.55, optional: true }
      ]
    },
    halftime: {
      lengthBars: 2,
      voicing: {
        kick: { pitchDecay: 0.08, octaves: 3, envelope: { attack: 0.002, decay: 0.6, sustain: 0 } },
        snare: { noise: 'brown', envelope: { attack: 0.002, decay: 0.35, sustain: 0 } },
        hat: { decay: 0.07, release: 0.03, harmonicity: 4.0, resonance: 4000 }
      },
      hits: [
        // Heavy, spacious: snare lands on beat 3 only, big gaps
        { inst: 'kick', bar: 0, beat: 0, vel: 1.0 },
        { inst: 'hat',  bar: 0, beat: 1, vel: 0.35 },
        { inst: 'hat',  bar: 0, beat: 2, vel: 0.35 },
        { inst: 'snare',bar: 0, beat: 3, vel: 0.95 },
        { inst: 'kick', bar: 0, beat: 2.5, vel: 0.6, optional: true },
        { inst: 'kick', bar: 1, beat: 0, vel: 1.0 },
        { inst: 'hat',  bar: 1, beat: 1, vel: 0.35 },
        { inst: 'kick', bar: 1, beat: 1.5, vel: 0.55, optional: true },
        { inst: 'hat',  bar: 1, beat: 2, vel: 0.35 },
        { inst: 'snare',bar: 1, beat: 3, vel: 0.95 },
        { inst: 'hat',  bar: 1, beat: 3.5, vel: 0.3, optional: true }
      ]
    },
    dnb: {
      lengthBars: 2,
      voicing: {
        kick: { pitchDecay: 0.03, octaves: 5, envelope: { attack: 0.001, decay: 0.2, sustain: 0 } },
        snare: { noise: 'white', envelope: { attack: 0.001, decay: 0.14, sustain: 0 } },
        hat: { decay: 0.025, release: 0.005, harmonicity: 5.5, resonance: 8500 }
      },
      hits: [
        // Fast two-step: kick on 1 and the "and" of 2, snare on 2 and 4
        { inst: 'kick', bar: 0, beat: 0, vel: 1.0 },
        { inst: 'hat',  bar: 0, beat: 0.5, vel: 0.35 },
        { inst: 'snare',bar: 0, beat: 1, vel: 0.9 },
        { inst: 'hat',  bar: 0, beat: 1.5, vel: 0.35 },
        { inst: 'kick', bar: 0, beat: 2.5, vel: 0.8 },
        { inst: 'hat',  bar: 0, beat: 2, vel: 0.35 },
        { inst: 'snare',bar: 0, beat: 3, vel: 0.9 },
        { inst: 'hat',  bar: 0, beat: 3.5, vel: 0.35, optional: true },
        { inst: 'kick', bar: 1, beat: 0, vel: 1.0 },
        { inst: 'snare',bar: 1, beat: 1, vel: 0.9 },
        { inst: 'kick', bar: 1, beat: 1.5, vel: 0.7, optional: true },
        { inst: 'hat',  bar: 1, beat: 0.5, vel: 0.35 },
        { inst: 'kick', bar: 1, beat: 2.5, vel: 0.8 },
        { inst: 'snare',bar: 1, beat: 3, vel: 0.9 },
        { inst: 'hat',  bar: 1, beat: 2, vel: 0.35 },
        { inst: 'snare',bar: 1, beat: 3.5, vel: 0.5, optional: true }
      ]
    }
  };

  /**
   * Pick a random kit name different from the current one (never repeats).
   */
  function pickDifferentKit() {
    const names = Object.keys(DRUM_KITS).filter(k => k !== settings.drumKit);
    if (names.length === 0) return settings.drumKit;
    return names[Math.floor(Math.random() * names.length)];
  }

  /**
   * Voicing per kit, read from the kit's `voicing` data (falls back to arcade's
   * if absent). Guarded on Tone === null by the caller.
   */
  function buildDrums() {
    if (typeof Tone === 'undefined' || Tone === null) return;
    disposeDrums();
    drumVolume = new Tone.Volume(settings.drumVolumeDb).connect(masterVolume);

    const kitDef = DRUM_KITS[settings.drumKit] || DRUM_KITS.arcade;
    const v = kitDef.voicing || DRUM_KITS.arcade.voicing;

    drumKick = new Tone.MembraneSynth({
      pitchDecay: v.kick.pitchDecay, octaves: v.kick.octaves, envelope: v.kick.envelope
    }).connect(drumVolume);

    drumSnare = v.snare
      ? new Tone.NoiseSynth({ noise: { type: v.snare.noise }, envelope: v.snare.envelope }).connect(drumVolume)
      : null;

    drumHat = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: v.hat.decay, release: v.hat.release },
      harmonicity: v.hat.harmonicity, resonance: v.hat.resonance
    }).connect(drumVolume);

    console.log('[AudioService] Built drum kit:', settings.drumKit);
  }

  function disposeDrums() {
    try { drumKick?.dispose(); } catch (e) {}
    try { drumSnare?.dispose(); } catch (e) {}
    try { drumHat?.dispose(); } catch (e) {}
    try { drumVolume?.dispose(); } catch (e) {}
    drumKick = drumSnare = drumHat = drumVolume = null;
  }

  /**
   * Density gate: when movement-follow is on, drop optional hits while quiet.
   * Returns true if the (optional) hit should sound this cycle.
   */
  function drumDensityAllows() {
    if (!settings.drumFollowMovement) return true;
    // Floor hard when stationary (past the fade-start threshold)
    if (Date.now() - lastCoordChangeTime > stationaryFadeStartMs) return false;
    const density = Math.max(0, Math.min(1, 0.5 + getAcceleration() * settings.accelerationSensitivity));
    return Math.random() < density;
  }

  /**
   * Fire one drum instrument.
   */
  function fireDrum(inst, time, vel) {
    try {
      if (inst === 'kick' && drumKick) drumKick.triggerAttackRelease('C1', '8n', time, vel);
      else if (inst === 'snare' && drumSnare) drumSnare.triggerAttackRelease('8n', time, vel);
      else if (inst === 'hat' && drumHat) drumHat.triggerAttackRelease('C4', '32n', time, vel);
    } catch (e) {}
  }

  /**
   * Called once per eighth from the drone clock. subBeat is 0,0.5,...,3.5.
   * No second transport - rides the drone clock's sample-accurate time.
   */
  function drumTick(time, subBeat) {
    if (!settings.drumEnabled || !drumKick) return;
    const kit = DRUM_KITS[settings.drumKit] || DRUM_KITS.arcade;
    const patternBar = droneCurrentBar % kit.lengthBars;

    // During a drop-out, suppress ALL hits (silent bar or two).
    const inDropout = drumDropoutBarsLeft > 0;
    const inFill = drumFillBarsLeft > 0;

    if (!inDropout) {
      for (const hit of kit.hits) {
        if (hit.bar !== patternBar || hit.beat !== subBeat) continue;
        const hitKey = hit.inst + ':' + hit.bar + ':' + hit.beat;
        const effectiveOptional = drumMutations.has(hitKey) ? !hit.optional : hit.optional;
        // In the post-dropout fill, optional hits ignore the density gate so
        // the return feels busier; otherwise gate optional hits on movement.
        if (effectiveOptional && !inFill && !drumDensityAllows()) continue;
        fireDrum(hit.inst, time, hit.vel);
      }
      // Tapering fill injection: add extra hats on off-beats ("ands"), but only
      // up to drumFillBarsLeft per bar - which decreases by one each fill bar,
      // so the return sheds one extra hat per bar until it's back to normal.
      if (inFill && (subBeat % 1 === 0.5) && drumFillHatsThisBar < drumFillBarsLeft) {
        const alreadyHatHere = kit.hits.some(h =>
          h.inst === 'hat' && h.bar === patternBar && h.beat === subBeat);
        if (!alreadyHatHere) {
          fireDrum('hat', time, 0.35);
          drumFillHatsThisBar++;
        }
      }
    }

    // Bar-boundary housekeeping: run once, on the downbeat.
    if (subBeat === 0) {
      // Ebb drums with the drone when stationary (once per bar)
      if (drumVolume) {
        const ebb = settings.drumFollowMovement ? currentDroneVolumeReduction : 0;
        drumVolume.volume.rampTo(settings.drumVolumeDb + ebb, 0.5);
      }

      // Decrement active dropout/fill windows
      if (drumDropoutBarsLeft > 0) {
        drumDropoutBarsLeft--;
        if (drumDropoutBarsLeft === 0) {
          // Dropout just ended. In randomize mode, switch to a different kit so
          // the return is re-voiced; in fixed mode keep the chosen kit. Then
          // start a tapering fill (drumFillStart extra hats/bar, -1/bar to 0).
          if (settings.drumKitSelection === 'randomize') {
            const nextKit = pickDifferentKit();
            if (nextKit !== settings.drumKit) {
              settings.drumKit = nextKit;
              drumMutations = new Set(); // patterns differ; old mutation keys are meaningless
              saveDrumSettings();
              buildDrums(); // rebuild voicing for the new kit (happens during silence)
            }
          } else {
            drumMutations = new Set();
          }
          // Auto-pair: on this drum-change return, move the lead to a random
          // engine+style pair (never the current one). The drum dropout does
          // NOT silence the lead, so rebuilding the voice here could cut a
          // ringing note (a click). Instead we QUEUE the switch and let leadBar
          // apply it at the next rest, when nothing is sounding. If the lead is
          // already silent (resting/intro), apply it right away.
          if (settings.leadAutoPair && settings.leadEnabled) {
            const pair = pickNextLeadPair();
            if (leadFormState === 'playing') {
              leadPendingPair = pair;            // defer to the next phrase boundary
            } else {
              applyLeadPair(pair);               // silent now - safe to switch immediately
            }
          }
          drumFillBarsLeft = Math.max(0, settings.drumFillStart | 0);
          drumFillHatsThisBar = 0;
        }
      } else if (drumFillBarsLeft > 0) {
        drumFillBarsLeft--;
        drumFillHatsThisBar = 0; // reset per-bar injected-hat count
      }

      // Dropout scheduler: every drumDropoutBars, trigger a 1-2 bar dropout.
      // Skipped while stationary (nothing much is playing anyway).
      if (settings.drumDropoutEnabled && !inFill && drumDropoutBarsLeft === 0) {
        drumDropoutCounter++;
        if (drumDropoutCounter >= Math.max(4, settings.drumDropoutBars | 0)) {
          drumDropoutCounter = 0;
          if (!shouldSkipEvolution()) {
            drumDropoutBarsLeft = 1 + Math.floor(Math.random() * 2); // 1 or 2 bars
          }
        }
      }

      // Evolution: flip one optional hit every 8 bars, skipped while stationary
      // and paused during dropout/fill so the two systems don't fight.
      if (settings.drumEvolveEnabled && !inDropout && !inFill) {
        drumEvolveCounter++;
        if (drumEvolveCounter >= 8) {
          drumEvolveCounter = 0;
          if (!shouldSkipEvolution()) {
            const optionalHits = kit.hits.filter(h => h.optional);
            if (optionalHits.length > 0) {
              const pick = optionalHits[Math.floor(Math.random() * optionalHits.length)];
              const key = pick.inst + ':' + pick.bar + ':' + pick.beat;
              if (drumMutations.has(key)) drumMutations.delete(key);
              else drumMutations.add(key);
            }
          }
        }
      }
    }
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
    
    // Lead REPLACE mode: mute a drone note only while the lead is ACTUALLY
    // SOUNDING a note in that octave (time-span overlap) - not for every
    // octave the whole phrase visits, which with octave-spanning melodies
    // would silence most of the background. The lead's own notes bypass
    // triggerNote (meta.lead). LAYER mode does nothing here.
    if (leadActive() && settings.leadMode === 'replace' && leadFormState === 'playing' &&
        meta && !meta.lead && leadNoteSpans.length) {
      for (let li = 0; li < leadNoteSpans.length; li++) {
        const sp = leadNoteSpans[li];
        if (sp.octave === meta.octave && t >= sp.start - 0.02 && t < sp.end + 0.02) return;
      }
    }
    // Per-octave instrument routing: if active and this note carries an octave
    // that maps to a built chain, play it there INSTEAD of A/B, then emit and
    // return. All other paths (no meta, mid-crossfade, journeys) fall through
    // to the unchanged A/B block below.
    if (perOctaveActive() && meta && meta.octave !== undefined && octaveChains[meta.octave]) {
      // If this octave is currently swapped, route to the spare chain instead.
      const swapChain = (octaveSwap && octaveSwap.octave === meta.octave)
        ? octaveSwapChains[octaveSwap.preset] : null;
      const target = swapChain || octaveChains[meta.octave];
      try {
        target.synth.triggerAttackRelease(note, duration, t, adjustedVelocity);
      } catch (e) {
        // Note already playing or other issue
      }
      emitNoteEvent(note, duration, adjustedVelocity, t, meta);
      return;
    }
    
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
   * Rotate the stagger set: promote one new idle octave to a random nonzero
   * offset, and if the active set now exceeds settings.staggerCount, demote the
   * oldest (revert it to the downbeat). "In moderation" - at most staggerCount
   * octaves are ever off the beat, and the set rotates every reshuffle period.
   */
  function rotateStagger() {
    // Eligible = idle octaves not already staggered
    const eligible = [];
    for (let oct = 0; oct <= 9; oct++) {
      if (isIdleOctave(oct) && !staggerActive.includes(oct)) eligible.push(oct);
    }
    if (eligible.length > 0) {
      const oct = eligible[Math.floor(Math.random() * eligible.length)];
      staggerOffsets[oct] = STAGGER_OFFSET_POOL[Math.floor(Math.random() * STAGGER_OFFSET_POOL.length)];
      staggerActive.push(oct);
    }
    // Demote oldest until within the count limit
    const limit = Math.max(0, settings.staggerCount | 0);
    while (staggerActive.length > limit) {
      const demoted = staggerActive.shift();
      delete staggerOffsets[demoted];
    }
  }

  /**
   * Clear all stagger state (used on disable and re-seed).
   */
  function clearStagger() {
    staggerActive = [];
    staggerOffsets = {};
    staggerBarCounter = 0;
  }

  /**
   * Whether an octave is "idle" (eligible for staggering): not melodic AND
   * still default-shaped. The default-shape test matters because
   * updatePatternForNoteCount can regenerate an octave to a non-default
   * shape without ever adding it to melodicOctaveQueue.
   */
  function isIdleOctave(octave) {
    if (melodicOctaveQueue.includes(octave)) return false;
    const p = octavePatterns[octave];
    if (!p) return true; // uninitialized = will be built as default
    return p.lengthBars === p.noteCount &&
           p.slots.every(s => s.type === 'note' && s.duration === 4);
  }

  /**
   * Re-apply the current stagger offsets to all idle octaves by rebuilding
   * their default patterns. Melodic octaves are untouched. Octaves not in the
   * active set rebuild flat (offset 0).
   */
  function applyStaggerToIdleOctaves() {
    for (let oct = 0; oct <= 9; oct++) {
      if (!isIdleOctave(oct)) continue;
      const noteCount = notePool[oct]?.length || 2;
      octavePatterns[oct] = getDefaultPattern(noteCount, oct);
    }
  }

  /**
   * Get the default pattern for a given note count
   * Matches the original drone behavior: one whole note per bar, cycling through notes
   */
  function getDefaultPattern(noteCount = 3, octave = null) {
    const count = Math.max(1, Math.min(3, noteCount));
    const slots = [];
    for (let i = 0; i < count; i++) {
      const startBeat = (settings.staggeredIdleEntrances && octave !== null)
        ? (staggerOffsets[octave] ?? 0)
        : 0;
      slots.push({ type: 'note', slotIndex: i, duration: 4, startBeat, bar: i });
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
    // Build the pattern for octave 0 first (needed so isIdleOctave sees defaults
    // during seeding below), then seed the stagger set to staggerCount octaves
    // so a default-on stagger is active from the very start rather than waiting
    // for the first rotation. Seed only if empty (survives re-init mid-drift).
    for (let i = 0; i < 10; i++) {
      const noteCount = notePool[i]?.length || 2;
      octavePatterns[i] = getDefaultPattern(noteCount, i);
    }
    if (settings.staggeredIdleEntrances && staggerActive.length === 0) {
      const target = Math.max(0, settings.staggerCount | 0);
      for (let k = 0; k < target; k++) rotateStagger();
      applyStaggerToIdleOctaves(); // rebuild the seeded octaves with their offsets
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
      octavePatterns[i] = getDefaultPattern(noteCount, i);
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
      octavePatterns[octaveToReset] = getDefaultPattern(resetNoteCount, octaveToReset);
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
          
          // Staggered idle entrances: rotate the active set every
          // settings.staggerReshuffleBars. Promotes one new idle octave and
          // demotes the oldest, keeping at most settings.staggerCount off the
          // beat. Always-running (not gated by movement) so it keeps rotating
          // whether moving or stationary. Melodic octaves are never touched.
          if (settings.staggeredIdleEntrances && settings.patternEvolutionEnabled) {
            staggerBarCounter++;
            if (staggerBarCounter >= Math.max(1, settings.staggerReshuffleBars | 0)) {
              staggerBarCounter = 0;
              rotateStagger();
              applyStaggerToIdleOctaves();
            }
          }
          
          // Temporary per-octave instrument swap (once per bar)
          if (settings.octaveSwapEnabled) {
            tickOctaveSwap();
          }
          
          // Lead / arranger: schedule this bar's phrase at the downbeat.
          // `time` is the bar's start; events place themselves at beat offsets.
          if (settings.leadEnabled) {
            const secondsPerBeat = 60 / getCurrentBPM();
            leadBar(time, secondsPerBeat);
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
      } else {
        // Pattern evolution off: still mark the "and" so drums can hit it
        droneIsEighth = true;
      }
      
      // Retro drum track: one call per eighth. subBeat is the current beat on
      // the eighth grid - droneBeatCount already reflects the increment/barline
      // wrap on downbeats; +0.5 on the "and". No second transport.
      const drumSubBeat = droneIsEighth ? droneBeatCount + 0.5 : droneBeatCount;
      drumTick(time, drumSubBeat);
      
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
      for (const oct of Object.keys(octaveChains)) {
        try { octaveChains[oct]?.synth?.releaseAll(); } catch (e) {}
      }
      for (const p of Object.keys(octaveSwapChains)) {
        try { octaveSwapChains[p]?.synth?.releaseAll(); } catch (e) {}
      }
      try { leadSynth?.triggerRelease?.(); } catch (e) {}
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
      
      // If per-octave instruments were left enabled (persisted), build the
      // chains now that Tone and A/B exist.
      if (settings.perOctaveEnabled) {
        try { await buildOctaveChains(); } catch (e) {
          console.warn('[AudioService] Failed to build octave chains at init:', e);
        }
        if (settings.octaveSwapEnabled) {
          try { await buildOctaveSwapChains(); } catch (e) {
            console.warn('[AudioService] Failed to build octave swap pool at init:', e);
          }
        }
      }
      
      // If drums were left enabled (persisted), build the kit now.
      if (settings.drumEnabled) {
        try { buildDrums(); } catch (e) {
          console.warn('[AudioService] Failed to build drums at init:', e);
        }
      }
      
      // If the lead was left enabled (persisted), build its voice now.
      if (settings.leadEnabled) {
        try { await buildLeadChain(); } catch (e) {
          console.warn('[AudioService] Failed to build lead chain at init:', e);
        }
      }
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
     * Enable/disable staggered idle-octave entrances.
     * On enable: start with a clean set and immediately stagger one octave.
     * On disable: clear the set and rebuild idle octaves flat (byte-identical).
     */
    setStaggeredIdleEntrances(enabled) {
      settings.staggeredIdleEntrances = !!enabled;
      clearStagger();
      if (enabled) {
        rotateStagger(); // seed with the first staggered octave right away
      }
      if (Object.keys(octavePatterns).length > 0) {
        applyStaggerToIdleOctaves();
      }
    },

    getStaggeredIdleEntrances() {
      return settings.staggeredIdleEntrances;
    },

    setStaggerCount(n) {
      settings.staggerCount = Math.max(0, Math.min(9, n | 0));
      // Trim the active set down immediately if the new limit is lower
      while (staggerActive.length > settings.staggerCount) {
        const demoted = staggerActive.shift();
        delete staggerOffsets[demoted];
      }
      if (settings.staggeredIdleEntrances && Object.keys(octavePatterns).length > 0) {
        applyStaggerToIdleOctaves();
      }
    },

    getStaggerCount() {
      return settings.staggerCount;
    },

    setStaggerReshuffleBars(bars) {
      settings.staggerReshuffleBars = Math.max(1, Math.min(128, bars | 0));
    },

    getStaggerReshuffleBars() {
      return settings.staggerReshuffleBars;
    },

    /**
     * Enable/disable per-octave instruments. Builds chains lazily on enable
     * (tolerates Tone not yet loaded - chains build on the next enable after
     * initialize). Disposes chains on disable. Persists enable state + map.
     */
    async setPerOctaveEnabled(enabled) {
      settings.perOctaveEnabled = !!enabled;
      saveOctaveInstruments();
      if (enabled) {
        await buildOctaveChains();
        if (settings.octaveSwapEnabled) await buildOctaveSwapChains();
      } else {
        disposeOctaveChains();
        disposeOctaveSwapChains();
      }
    },

    getPerOctaveEnabled() {
      return settings.perOctaveEnabled;
    },

    async setOctaveSwapEnabled(enabled) {
      settings.octaveSwapEnabled = !!enabled;
      octaveSwapCounter = 0;
      saveOctaveInstruments();
      if (enabled) {
        // Build the spare pool if per-octave is already running; otherwise it
        // builds when per-octave is enabled.
        if (settings.perOctaveEnabled && Object.keys(octaveSwapChains).length === 0) {
          await buildOctaveSwapChains();
        }
      } else {
        // Revert any active swap immediately; keep the spare pool (cheap) unless
        // per-octave is off.
        octaveSwap = null;
        octaveSwapBarsLeft = 0;
        if (!settings.perOctaveEnabled) disposeOctaveSwapChains();
      }
    },

    getOctaveSwapEnabled() {
      return settings.octaveSwapEnabled;
    },

    setOctaveSwapPeriodBars(bars) {
      settings.octaveSwapPeriodBars = Math.max(4, Math.min(256, bars | 0));
      saveOctaveInstruments();
    },

    getOctaveSwapPeriodBars() {
      return settings.octaveSwapPeriodBars;
    },

    setOctaveSwapDurationBars(bars) {
      settings.octaveSwapDurationBars = Math.max(1, Math.min(64, bars | 0));
      saveOctaveInstruments();
    },

    getOctaveSwapDurationBars() {
      return settings.octaveSwapDurationBars;
    },

    /**
     * Assign an instrument (preset name) to an octave. Persists, and if chains
     * are currently built, rebuilds just that octave's chain.
     */
    async setOctaveInstrument(octave, presetName) {
      const oct = Math.max(0, Math.min(9, octave));
      octaveInstrumentMap[oct] = presetName;
      saveOctaveInstruments();
      if (octaveChains[oct]) {
        await rebuildOctaveChain(oct);
      }
    },

    /**
     * Get the effective instrument for an octave (user override or default).
     */
    getOctaveInstrument(octave) {
      return resolveOctavePreset(Math.max(0, Math.min(9, octave)));
    },

    /**
     * Get the full effective octave->instrument map (0-9).
     */
    getOctaveInstrumentMap() {
      const map = {};
      for (let oct = 0; oct <= 9; oct++) map[oct] = resolveOctavePreset(oct);
      return map;
    },

    // ===== RETRO DRUMS =====

    setDrumEnabled(enabled) {
      settings.drumEnabled = !!enabled;
      saveDrumSettings();
      if (enabled) buildDrums();
      else disposeDrums();
    },

    getDrumEnabled() {
      return settings.drumEnabled;
    },

    /**
     * Set the kit selection. 'randomize' starts on arcade and switches to a
     * different kit on each drop-out return; a specific kit name just plays that.
     */
    setDrumKit(selection) {
      if (selection === 'randomize') {
        settings.drumKitSelection = 'randomize';
        settings.drumKit = 'arcade'; // randomize sessions start on arcade
      } else if (DRUM_KITS[selection]) {
        settings.drumKitSelection = selection;
        settings.drumKit = selection;
      } else {
        return;
      }
      drumMutations = new Set(); // fresh phasing on kit change
      drumEvolveCounter = 0;
      saveDrumSettings();
      if (settings.drumEnabled) buildDrums(); // rebuild voicing for the current kit
    },

    // What the UI selector shows: 'randomize' or a specific kit name.
    getDrumKit() {
      return settings.drumKitSelection;
    },

    // The kit actually playing right now (in randomize mode, the current one).
    getDrumCurrentKit() {
      return settings.drumKit;
    },

    // 'randomize' first, then the real kits.
    getDrumKitNames() {
      return ['randomize', ...Object.keys(DRUM_KITS)];
    },

    setDrumVolume(db) {
      settings.drumVolumeDb = Math.max(-30, Math.min(0, db));
      saveDrumSettings();
      if (drumVolume) drumVolume.volume.rampTo(settings.drumVolumeDb, 0.1);
    },

    getDrumVolume() {
      return settings.drumVolumeDb;
    },

    setDrumFollowMovement(enabled) {
      settings.drumFollowMovement = !!enabled;
      saveDrumSettings();
    },

    getDrumFollowMovement() {
      return settings.drumFollowMovement;
    },

    setDrumEvolveEnabled(enabled) {
      settings.drumEvolveEnabled = !!enabled;
      saveDrumSettings();
    },

    getDrumEvolveEnabled() {
      return settings.drumEvolveEnabled;
    },

    setDrumDropoutEnabled(enabled) {
      settings.drumDropoutEnabled = !!enabled;
      saveDrumSettings();
    },

    getDrumDropoutEnabled() {
      return settings.drumDropoutEnabled;
    },

    setDrumDropoutBars(bars) {
      settings.drumDropoutBars = Math.max(4, Math.min(256, bars | 0));
      saveDrumSettings();
    },

    getDrumDropoutBars() {
      return settings.drumDropoutBars;
    },

    setDrumFillStart(n) {
      settings.drumFillStart = Math.max(0, Math.min(8, n | 0));
      saveDrumSettings();
    },

    getDrumFillStart() {
      return settings.drumFillStart;
    },

    // ===== LEAD / ARRANGER =====

    async setLeadEnabled(enabled) {
      settings.leadEnabled = !!enabled;
      saveLeadSettings();
      if (enabled) {
        leadFormState = 'intro'; leadFormBar = 0; leadPhrase = null; leadTune = null; leadNoteSpans = [];
        await buildLeadChain();
      } else {
        disposeLeadChain();
      }
    },

    getLeadEnabled() { return settings.leadEnabled; },

    async setLeadEngine(engine) {
      if (!LEAD_ENGINES[engine]) return;
      settings.leadEngine = engine;
      saveLeadSettings();
      if (settings.leadEnabled) await buildLeadChain(); // rebuild the voice
    },

    getLeadEngine() { return settings.leadEngine; },
    getLeadEngineNames() { return Object.keys(LEAD_ENGINES); },

    /** Variant (voice flavour) API for auditioning within an engine. */
    getLeadVariantNames(engine) { return leadVariantNames(engine || settings.leadEngine); },
    getLeadVariantLabels(engine) {
      const e = engine || settings.leadEngine;
      return Object.assign({}, LEAD_VARIANT_LABELS[e] || {});
    },
    getLeadVariant(engine) { return leadEngineVariant[engine || settings.leadEngine] || 'default'; },
    async setLeadVariant(variant, engine) {
      const e = engine || settings.leadEngine;
      if (!LEAD_ENGINE_VARIANTS[e] || !LEAD_ENGINE_VARIANTS[e][variant]) return;
      leadEngineVariant[e] = variant;
      saveLeadSettings();
      if (settings.leadEnabled && e === settings.leadEngine) await buildLeadChain(); // reaudition now
    },

    /** Auto-pair: on each drum change, jump to a random engine+style pair
     *  (never the current one). Toggle + read. */
    setLeadAutoPair(enabled) {
      const on = !!enabled;
      settings.leadAutoPair = on;
      saveLeadSettings();
      // Reset the progression so the arc (theremin straight -> 4 rounds ->
      // effects unlock) restarts cleanly. Turning it off returns the lead to a
      // plain (straight) voice so it isn't stuck with an effect.
      leadRoundCount = 0;
      if (leadEffect !== 'straight') {
        leadEffect = 'straight';
        if (settings.leadEnabled) buildLeadChain();
      }
    },
    getLeadAutoPair() { return settings.leadAutoPair; },
    getLeadEffect() { return leadEffect; },
    getLeadEffectNames() { return Object.keys(LEAD_EFFECTS); },
    getLeadEffectLabels() { return Object.assign({}, LEAD_EFFECT_LABELS); },
    /** Manual effect override. Sets the effect now and rebuilds the chain. In
     *  auto mode this takes effect immediately; auto will resume choosing at the
     *  next drum change. */
    async setLeadEffect(effect) {
      if (!(effect in LEAD_EFFECTS)) return;
      if (effect === leadEffect) return;
      leadEffect = effect;
      if (settings.leadEnabled) await buildLeadChain();
    },

    setLeadStyle(style) {
      if (!LEAD_STYLES[style]) return;
      settings.leadStyle = style;
      leadTune = null;             // new character = new tune
      composeLeadPhrase();
      if (settings.leadEnabled) {  // audible within a bar, not at the next entry
        leadFormState = 'playing'; leadFormBar = 0;
      }
      saveLeadSettings();
    },

    getLeadStyle() { return settings.leadStyle; },
    getLeadStyleNames() { return Object.keys(LEAD_STYLES); },

    /** Discard the current tune and compose a fresh one immediately (A/B aid). */
    newLeadMelody() {
      leadTune = null;
      composeLeadPhrase();
      if (settings.leadEnabled) {
        leadFormState = 'playing'; leadFormBar = 0;
      }
    },

    /** Skip ahead to the tune's next section (A -> A' -> B -> A'' -> new tune). */
    nextLeadSection() {
      advanceLeadSection();
      if (settings.leadEnabled) {
        leadFormState = 'playing'; leadFormBar = 0;
      }
    },

    /** Copy of the current realized phrase (debug / piano-roll aid). */
    getLeadPhrase() {
      return leadPhrase ? leadPhrase.map(n => Object.assign({}, n)) : null;
    },

    /** The derived pitched ladder: real (pc, octave) rungs + the tonic rung. */
    getLeadLadder() {
      const lad = leadLadder();
      return lad ? {
        rungs: lad.rungs.map(r => Object.assign({}, r)),
        tonicIdx: lad.tonicIdx,
        signature: lad.signature
      } : null;
    },

    /** Which section of the tune's plan is current (e.g. A, A', B, A''). */
    getLeadSection() {
      if (!leadTune) return null;
      const sec = leadTune.plan[leadTune.pos % leadTune.plan.length];
      return { label: sec.label, contour: sec.contour, pos: leadTune.pos, planLength: leadTune.plan.length };
    },

    setLeadMode(mode) {
      if (mode !== 'replace' && mode !== 'layer') return;
      settings.leadMode = mode;
      saveLeadSettings();
    },

    getLeadMode() { return settings.leadMode; },

    setLeadPhraseBars(n) {
      settings.leadPhraseBars = Math.max(1, Math.min(16, n | 0));
      composeLeadPhrase();
      if (leadFormState === 'playing') leadFormBar = 0; // restart the phrase at the new length
      saveLeadSettings();
    },

    getLeadPhraseBars() { return settings.leadPhraseBars; },

    setLeadRestBars(n) {
      settings.leadRestBars = Math.max(0, Math.min(16, n | 0));
      saveLeadSettings();
    },

    getLeadRestBars() { return settings.leadRestBars; },

    setLeadIntroBars(n) {
      settings.leadIntroBars = Math.max(0, Math.min(32, n | 0));
      saveLeadSettings();
    },

    getLeadIntroBars() { return settings.leadIntroBars; },

    setLeadVolume(db) {
      settings.leadVolumeDb = Math.max(-30, Math.min(0, db));
      saveLeadSettings();
      if (leadVolume) leadVolume.volume.rampTo(settings.leadVolumeDb + leadEngineTrim(), 0.1);
    },

    getLeadVolume() { return settings.leadVolumeDb; },

    setLeadFollowMovement(enabled) {
      settings.leadFollowMovement = !!enabled;
      saveLeadSettings();
    },

    getLeadFollowMovement() { return settings.leadFollowMovement; },

    setLeadFadeWhenStationary(enabled) {
      settings.leadFadeWhenStationary = !!enabled;
      saveLeadSettings();
    },

    getLeadFadeWhenStationary() { return settings.leadFadeWhenStationary; },

    // ===== SUB-BASS TWEAKS =====
    // Live-edit the built-in 'sub-bass' preset's filter-envelope character and
    // rebuild any octave chains currently using it. These mutate audio params
    // only - no frozen format or decode path is involved.

    getSubBassParams() {
      const p = PRESETS['sub-bass'];
      return {
        baseFrequency: p.filterEnvelope.baseFrequency,
        octaves: p.filterEnvelope.octaves,
        attack: p.filterEnvelope.attack,
        lpFreq: p.lpFreq
      };
    },

    async setSubBassParam(key, value) {
      const p = PRESETS['sub-bass'];
      if (key === 'baseFrequency') p.filterEnvelope.baseFrequency = Math.max(20, Math.min(200, value));
      else if (key === 'octaves') p.filterEnvelope.octaves = Math.max(0.5, Math.min(6, value));
      else if (key === 'attack') p.filterEnvelope.attack = Math.max(0.005, Math.min(1, value));
      else if (key === 'lpFreq') p.lpFreq = Math.max(200, Math.min(4000, value));
      else return;
      // Rebuild any per-octave chains that resolve to sub-bass so the change is audible
      for (let oct = 0; oct <= 9; oct++) {
        if (octaveChains[oct] && resolveOctavePreset(oct) === 'sub-bass') {
          await rebuildOctaveChain(oct);
        }
      }
      // If A or B is currently sub-bass, rebuild that chain too
      if (presetA === 'sub-bass') await rebuildChain('A', 'sub-bass');
      if (presetB === 'sub-bass') await rebuildChain('B', 'sub-bass');
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
        octavePatterns[octaveToReset] = getDefaultPattern(noteCount, octaveToReset);
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

  console.log('[geosonify] audio-service v6.10 loaded (auto-pair on by default; drop-aware phrase fitting; effect selector)');

})(typeof window !== 'undefined' ? window : this);
