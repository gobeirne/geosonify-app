/**
 * geosonify-audio-ui.js v3.6
 * 
 * Audio playback controls for BPM-clock-driven location sonification.
 * 
 * v3.6 features:
 * - FIX: the per-octave instrument binding loop selected by bare class
 *   ('.octave-instrument-select'), which #leadStyleSelect and
 *   #leadEngineSelect reuse for styling only - it OVERWROTE their handlers
 *   (bound earlier), so changing lead style/voice silently called
 *   setOctaveInstrument(NaN, ...) and did nothing. Loop is now scoped to
 *   '.octave-instrument-select[data-octave]'. This was very likely the
 *   remaining root cause of "style changes seem to do nothing".
 * - Lead voice section gains "New melody" (reroll the tune) and "Next
 *   section" (skip through the A A' B A'' plan) buttons - fast A/B steering
 *   of the melodic composer (audio-service v6.3)
 * - Lead hint text describes the composer (tune plan, question/answer
 *   phrasing, single climax, resolution); version log line now reports the
 *   real version (was stuck at v3.4)
 * 
 * v3.5 features:
 * - Stationary-fade sliders now initialize from getStationaryFadeTiming() with
 *   extended ranges (hold 5-120s, fade 5-90s)
 * - "Staggered idle entrances" toggle in Drone Mode Settings
 * - "Per-octave instruments" section: master toggle, per-octave instrument
 *   selects, and a live deferral status line
 * - "Retro drums" section: enable toggle, kit select, volume, follow-movement
 *   and evolve toggles
 * - "Sub-bass tuning" controls (sweep depth, base freq, attack, low-pass)
 * - Stagger count + rotate-interval sliders; drum drop-out toggle + interval;
 *   random per-octave instrument-swap toggle + period/duration sliders
 * - Drum kit selector includes "randomize" (default); return busy-ness slider.
 *   10 kits total.
 * - Lead voice: added a "Variant" selector (voice flavours for 80s Lead and
 *   Analog Mono; other engines show only Classic), an "Effect" selector (manual
 *   override: straight/delay/double-track/wide/phaser/flanger), and an "Auto"
 *   tickbox that pairs voice+style and switches on each drum change.
 * - "Lead voice" section: enable, style (flowing/sparse/rhythmic/lyrical),
 *   voice (80s/theremin/FM/mono), replace/layer, phrase/rest/intro bars,
 *   volume, follow-movement, fade-when-stationary
 * - Fix: per-octave instrument rows no longer collide with the octave
 *   intensity/fraction binding loop (which had left the Close button unbound)
 * 
 * v3.4 features:
 * - Piano roll auto-switch: show roll on play, revert to VexFlow on stop
 * - switchMusicCardView('staff'|'roll') public API method
 * 
 * v3.3 features:
 * - Max melodic octaves slider (limits how many octaves have patterns)
 * - Pocket mode button integration
 * 
 * v3.2 features:
 * - Pattern Evolution UI controls
 * - Evolution bars, octave selection mode, max pattern bars settings
 * - Beat-align notes toggle
 * - Reset patterns button
 * 
 * v3.1 fixes:
 * - BPM, filter, reverb, attack, release sliders now call AudioService methods
 * - Settings persist during session and apply immediately
 * - Fixed preset save "already exists" bug
 * 
 * v3.0 features:
 * - Drone mode enhancements UI
 * - Logarithmic journey crossfade toggle
 */

(function(global) {
  'use strict';

  // ============== STATE ==============

  let state = null;
  let speakerButtons = new Map(); // gridKey → button element

  // ============== STYLES ==============

  const STYLES = `
    .audio-speaker-btn {
      background: none;
      border: none;
      font-size: 18px;
      cursor: pointer;
      padding: 4px 8px;
      margin-left: 8px;
      border-radius: 6px;
      transition: background 0.2s, transform 0.1s;
      opacity: 0.7;
    }
    
    .audio-speaker-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      opacity: 1;
    }
    
    .audio-speaker-btn:active {
      transform: scale(0.9);
    }
    
    .audio-speaker-btn.playing {
      opacity: 1;
      animation: audio-pulse 1.5s infinite;
    }
    
    @keyframes audio-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    .audio-volume-control {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 8px;
      margin-top: 8px;
    }
    
    .audio-volume-slider {
      flex: 1;
      height: 4px;
      -webkit-appearance: none;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 2px;
      outline: none;
    }
    
    .audio-volume-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 16px;
      height: 16px;
      background: #fff;
      border-radius: 50%;
      cursor: pointer;
    }
    
    .audio-volume-slider::-moz-range-thumb {
      width: 16px;
      height: 16px;
      background: #fff;
      border-radius: 50%;
      cursor: pointer;
      border: none;
    }
    
    .audio-volume-label {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.7);
      min-width: 45px;
      text-align: right;
    }
    
    .audio-preset-selector {
      display: flex;
      gap: 6px;
      margin-top: 8px;
      flex-wrap: wrap;
    }
    
    .audio-preset-btn {
      padding: 4px 10px;
      font-size: 12px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: transparent;
      color: rgba(255, 255, 255, 0.7);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .audio-preset-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }
    
    .audio-preset-btn.active {
      background: rgba(255, 255, 255, 0.2);
      border-color: #fff;
      color: #fff;
    }
    
    .audio-controls-panel {
      display: none;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      background: linear-gradient(135deg, rgba(100, 50, 150, 0.3), rgba(50, 100, 150, 0.3));
      border-radius: 8px;
      margin-top: 12px;
    }
    
    .audio-controls-panel.visible {
      display: flex;
    }
    
    .audio-controls-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #fff;
      font-size: 14px;
    }
    
    .audio-note-display {
      font-family: monospace;
      font-size: 16px;
      color: rgba(255, 255, 255, 0.9);
      text-align: center;
      padding: 8px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 6px;
    }
    
    .audio-design-modal {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    
    .audio-design-panel {
      background: linear-gradient(135deg, #1a1a2e, #16213e);
      border-radius: 16px;
      padding: 24px;
      max-width: 440px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .audio-design-title {
      font-size: 20px;
      color: #fff;
      margin-bottom: 20px;
      text-align: center;
    }
    
    .audio-design-section {
      margin-bottom: 16px;
    }
    
    .audio-design-section-title {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.4);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 12px;
      padding-bottom: 4px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .audio-design-label {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.6);
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
    }
    
    .audio-design-slider {
      width: 100%;
      height: 6px;
      -webkit-appearance: none;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      outline: none;
    }
    
    .audio-design-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 18px;
      height: 18px;
      background: linear-gradient(135deg, #0ff, #0af);
      border-radius: 50%;
      cursor: pointer;
    }
    
    .audio-design-slider::-moz-range-thumb {
      width: 18px;
      height: 18px;
      background: linear-gradient(135deg, #0ff, #0af);
      border-radius: 50%;
      cursor: pointer;
      border: none;
    }
    
    .audio-design-btns {
      display: flex;
      gap: 12px;
      margin-top: 20px;
    }
    
    .audio-design-btn {
      flex: 1;
      padding: 12px;
      border-radius: 8px;
      border: none;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .audio-design-btn.primary {
      background: linear-gradient(135deg, #0ff, #0af);
      color: #000;
    }
    
    .audio-design-btn.secondary {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }
    
    .audio-design-btn.pocket {
      flex: 0;
      width: 48px;
      background: #111;
      color: #666;
      border: 1px solid #333;
      font-size: 18px;
    }
    
    .audio-design-btn.pocket:hover {
      background: #222;
      border-color: #444;
      color: #888;
    }
  `;

  // Inject styles
  function injectStyles() {
    if (document.getElementById('audio-ui-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'audio-ui-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  // ============== SPEAKER BUTTON ==============

  function createSpeakerButton(gridKey) {
    injectStyles();
    
    const btn = document.createElement('button');
    btn.className = 'audio-speaker-btn';
    btn.innerHTML = '🔇';
    btn.title = 'Play location audio';
    btn.setAttribute('data-grid', gridKey);
    
    btn.onclick = async (e) => {
      e.stopPropagation();
      e.preventDefault();
      await togglePlayback(btn);
    };
    
    speakerButtons.set(gridKey, btn);
    return btn;
  }

  async function togglePlayback(btn) {
    if (!global.AudioService) {
      console.warn('[AudioUI] AudioService not available');
      return;
    }
    
    const AudioService = global.AudioService;
    
    if (AudioService.isPlaying) {
      AudioService.stop();
      updateAllButtons(false);
      // Auto-switch back to VexFlow notation when stopping
      switchMusicCardView('staff');
    } else {
      try {
        await AudioService.play();
        updateAllButtons(true);
        updateNotesFromCurrentLocation();
        // Auto-switch to piano roll when starting playback
        switchMusicCardView('roll');
      } catch (err) {
        console.error('[AudioUI] Error starting audio:', err);
      }
    }
  }

  /**
   * Switch the music card between VexFlow staff and piano roll views
   * @param {'staff'|'roll'} view - Which view to show
   */
  function switchMusicCardView(view) {
    // Find the music card in the DOM
    const card = document.querySelector('[data-grid-key="music"]');
    if (!card) return;
    
    const notation = card.querySelector('.music-notation');
    const pianoroll = card.querySelector('.music-pianoroll');
    const toggle = card.querySelector('.piano-roll-toggle');
    if (!notation || !pianoroll) return;
    
    if (view === 'roll' && typeof PianoRoll !== 'undefined') {
      notation.style.display = 'none';
      pianoroll.style.display = 'block';
      if (!PianoRoll.isVisible) {
        PianoRoll.init({ container: pianoroll, audioService: global.AudioService });
      }
      PianoRoll.show();
      if (toggle) {
        toggle.innerHTML = '🎼';
        toggle.title = 'Show grand staff';
        toggle.classList.add('active');
      }
    } else {
      if (typeof PianoRoll !== 'undefined') PianoRoll.hide();
      notation.style.display = '';
      pianoroll.style.display = 'none';
      // Re-render the VexFlow notation with current code
      if (typeof VexFlowLib !== 'undefined' && typeof renderMusicNotation === 'function') {
        const rawEl = card.querySelector('.music-raw');
        if (rawEl) renderMusicNotation(rawEl.textContent + ',', notation);
      }
      if (toggle) {
        toggle.innerHTML = '▦';
        toggle.title = 'Show piano roll';
        toggle.classList.remove('active');
      }
    }
  }

  function updateAllButtons(playing) {
    for (const btn of speakerButtons.values()) {
      btn.innerHTML = playing ? '🔊' : '🔇';
      btn.classList.toggle('playing', playing);
    }
  }

  function updateNotesFromCurrentLocation() {
    if (!state || !global.AudioService || !global.AudioService.isPlaying) return;
    
    const coord = state.get('coordinate');
    if (!coord || coord.lat === null) return;
    
    // Get music code for this coordinate
    if (typeof global.encodeCardCoordinate === 'function') {
      const code = global.encodeCardCoordinate('music', coord.lat, coord.lon);
      if (code) {
        global.AudioService.setMusicalCode(code);
      }
    }
    
    // Update speed for acceleration tracking
    if (coord.speed !== undefined && coord.speed !== null) {
      global.AudioService.updateSpeed(coord.speed);
    }
    
    // Update journey if active - apply lerped preset
    if (window.JourneyService && window.JourneyService.isActive()) {
      const result = window.JourneyService.updatePosition(coord.lat, coord.lon);
      if (result && result.applied) {
        console.log('[AudioUI] Journey progress:', Math.round(result.totalProgress * 100) + '%');
      }
    }
  }

  // ============== VOLUME CONTROLS ==============

  function createVolumeControl() {
    const container = document.createElement('div');
    container.className = 'audio-volume-control';
    
    const icon = document.createElement('span');
    icon.textContent = '🔈';
    
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'audio-volume-slider';
    slider.min = '-40';
    slider.max = '0';
    slider.value = '-12';
    
    const label = document.createElement('span');
    label.className = 'audio-volume-label';
    label.textContent = '-12 dB';
    
    slider.oninput = () => {
      const db = parseInt(slider.value);
      label.textContent = db + ' dB';
      
      if (global.AudioService) {
        global.AudioService.setVolume(db);
      }
      
      if (state) {
        state.set('audio.volume', db);
      }
    };
    
    container.appendChild(icon);
    container.appendChild(slider);
    container.appendChild(label);
    
    return container;
  }

  // ============== PRESET SELECTOR ==============

  function createPresetSelector() {
    const container = document.createElement('div');
    container.className = 'audio-preset-selector';
    
    const presets = global.AudioService?.getPresets() || ['ambient', 'warm', 'crystal', 'pad'];
    
    presets.forEach((preset, i) => {
      const btn = document.createElement('button');
      btn.className = 'audio-preset-btn' + (preset === 'crystal' ? ' active' : '');
      btn.textContent = preset.charAt(0).toUpperCase() + preset.slice(1);
      btn.onclick = async () => {
        container.querySelectorAll('.audio-preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        if (global.AudioService) {
          await global.AudioService.setPreset(preset);
        }
      };
      container.appendChild(btn);
    });
    
    return container;
  }

  // ============== FULL CONTROLS PANEL ==============

  function createControlsPanel() {
    const panel = document.createElement('div');
    panel.className = 'audio-controls-panel';
    
    const header = document.createElement('div');
    header.className = 'audio-controls-header';
    header.innerHTML = '<span>🎵 Audio Settings</span>';
    panel.appendChild(header);
    
    const noteDisplay = document.createElement('div');
    noteDisplay.className = 'audio-note-display';
    noteDisplay.textContent = 'No notes playing';
    panel.appendChild(noteDisplay);
    
    panel.appendChild(createVolumeControl());
    
    const presetLabel = document.createElement('div');
    presetLabel.style.cssText = 'font-size: 12px; color: rgba(255,255,255,0.6); margin-top: 4px;';
    presetLabel.textContent = 'Sound:';
    panel.appendChild(presetLabel);
    panel.appendChild(createPresetSelector());
    
    if (state) {
      state.subscribe('audio.currentNotes', (notes) => {
        if (notes && notes.length > 0) {
          noteDisplay.textContent = notes.join(' • ');
        } else {
          noteDisplay.textContent = 'No notes playing';
        }
      });
    }
    
    return panel;
  }

  // ============== SOUND DESIGN MODAL ==============

  let designModal = null;

  function showSoundDesignModal() {
    injectStyles();
    
    if (designModal) {
      designModal.remove();
      designModal = null;
      return;
    }
    
    designModal = document.createElement('div');
    designModal.className = 'audio-design-modal';
    
    const AudioService = global.AudioService;
    const params = AudioService?.getSoundParams() || {
      presetA: 'crystal',
      presetB: 'pad',
      crossfade: 0,
      masterVolume: -12,
      transpose: 0,
      droneMode: true,
      accelerationSensitivity: 0.3,
      patternRefreshBars: 4,
      patternRefreshRandom: false,
      octaves: {}
    };
    
    // Get lerped values for display
    const displayVolume = AudioService?.getMasterVolume?.() ?? params.masterVolume ?? -12;
    const displayBPM = AudioService?.getBPM?.() ?? 100;
    const displayHumanize = AudioService?.getHumanize?.() ?? 0.1;
    const displayHPF = AudioService?.getHPF?.() ?? 20;
    const displayLPF = AudioService?.getLPF?.() ?? 20000;
    const displayReverb = AudioService?.getReverbWet?.() ?? 0.7;
    const displayAttack = AudioService?.getAttack?.() ?? 0.3;
    const displayRelease = AudioService?.getRelease?.() ?? 3.0;
    const currentCrossfade = params.crossfade ?? 0;
    const ft = AudioService?.getStationaryFadeTiming?.() || { startMs: 60000, fadeMs: 30000 };
    const startS = Math.round(ft.startMs / 1000), fadeS = Math.round(ft.fadeMs / 1000);
    
    const presets = AudioService?.getPresets() || ['crystal', 'ambient', 'warm', 'pad', 'frenetic', 'meditation', 'glitch', 'ethereal'];
    
    // Log scale helpers for frequency
    function freqToLog(freq) {
      const minLog = Math.log10(20);
      const maxLog = Math.log10(20000);
      const logFreq = Math.log10(Math.max(20, Math.min(20000, freq)));
      return ((logFreq - minLog) / (maxLog - minLog)) * 100;
    }
    
    function logToFreq(slider) {
      const minLog = Math.log10(20);
      const maxLog = Math.log10(20000);
      const logFreq = minLog + (slider / 100) * (maxLog - minLog);
      return Math.pow(10, logFreq);
    }
    
    // Generate octave controls HTML
    let octaveControlsHTML = '';
    for (let oct = 1; oct <= 8; oct++) {
      const octSettings = params.octaves?.[oct] || { intensity: 0, updateFraction: 2, mode: 'random', duration: 'random' };
      octaveControlsHTML += `
        <div class="octave-row" data-octave="${oct}">
          <span class="octave-label">Oct ${oct}</span>
          <div class="octave-controls">
            <div class="octave-control">
              <span class="control-label">Vol</span>
              <input type="range" class="mini-slider intensity-slider" min="-30" max="6" value="${octSettings.intensity}" step="1">
              <span class="control-value intensity-value">${octSettings.intensity}dB</span>
            </div>
            <div class="octave-control">
              <span class="control-label">1/n</span>
              <input type="range" class="mini-slider fraction-slider" min="1" max="20" value="${octSettings.updateFraction}" step="1">
              <span class="control-value fraction-value">${octSettings.updateFraction}</span>
            </div>
          </div>
        </div>
      `;
    }
    
    // Generate per-octave instrument selector rows (matches the 1-8 range the
    // rest of the octave UI uses; octaves 0 and 9 keep their default mapping).
    const perOctaveEnabled = AudioService?.getPerOctaveEnabled?.() || false;
    const octaveInstMap = AudioService?.getOctaveInstrumentMap?.() || {};
    const presetOptionsFor = (selected) => presets.map(p =>
      `<option value="${p}" ${p === selected ? 'selected' : ''}>${p}</option>`).join('');
    let perOctaveRowsHTML = '';
    for (let oct = 1; oct <= 8; oct++) {
      perOctaveRowsHTML += `
        <div class="octave-instrument-row" data-octave="${oct}">
          <span class="octave-label">Oct ${oct}</span>
          <select class="octave-instrument-select" data-octave="${oct}">
            ${presetOptionsFor(octaveInstMap[oct])}
          </select>
        </div>
      `;
    }
    
    // Retro drums UI data
    const drumEnabled = AudioService?.getDrumEnabled?.() || false;
    const drumKit = AudioService?.getDrumKit?.() || 'arcade';
    const drumVolumeDb = AudioService?.getDrumVolume?.() ?? -10;
    const drumFollow = AudioService?.getDrumFollowMovement?.() ?? true;
    const drumEvolve = AudioService?.getDrumEvolveEnabled?.() ?? true;
    const drumKitNames = AudioService?.getDrumKitNames?.() || ['arcade', 'boombap', 'minimal'];
    const drumKitOptions = drumKitNames.map(k =>
      `<option value="${k}" ${k === drumKit ? 'selected' : ''}>${k}</option>`).join('');
    const drumFillStart = AudioService?.getDrumFillStart?.() ?? 3;
    // Lead / melody composer prep
    const leadEnabled = AudioService?.getLeadEnabled?.() ?? false;
    const leadEngine = AudioService?.getLeadEngine?.() ?? 'eighties';
    const leadEngineNames = AudioService?.getLeadEngineNames?.() ?? ['eighties', 'theremin', 'fm', 'mono'];
    const leadStyle = AudioService?.getLeadStyle?.() ?? 'flowing';
    const leadStyleNames = AudioService?.getLeadStyleNames?.() ?? ['flowing', 'sparse', 'rhythmic', 'lyrical'];
    const leadMode = AudioService?.getLeadMode?.() ?? 'layer';
    const leadPhraseBars = AudioService?.getLeadPhraseBars?.() ?? 4;
    const leadRestBars = AudioService?.getLeadRestBars?.() ?? 4;
    const leadIntroBars = AudioService?.getLeadIntroBars?.() ?? 4;
    const leadVolumeDb = AudioService?.getLeadVolume?.() ?? -6;
    const leadFollow = AudioService?.getLeadFollowMovement?.() ?? true;
    const leadFadeStationary = AudioService?.getLeadFadeWhenStationary?.() ?? false;
    const leadEngineLabels = { eighties: '80s Lead', theremin: 'Theremin', fm: 'FM Bell', mono: 'Analog Mono' };
    const leadEngineOpts = leadEngineNames.map(e => `<option value="${e}" ${e === leadEngine ? 'selected' : ''}>${leadEngineLabels[e] || e.toUpperCase()}</option>`).join('');
    const leadStyleOpts = leadStyleNames.map(s => `<option value="${s}" ${s === leadStyle ? 'selected' : ''}>${s}</option>`).join('');
    // Voice variant (flavour) selector - only meaningful for engines with >1 variant.
    const leadVariant = AudioService?.getLeadVariant?.(leadEngine) ?? 'default';
    const leadVariantNames = AudioService?.getLeadVariantNames?.(leadEngine) ?? ['default'];
    const leadVariantLabels = AudioService?.getLeadVariantLabels?.(leadEngine) ?? { default: 'Classic' };
    const leadVariantOpts = leadVariantNames.map(v => `<option value="${v}" ${v === leadVariant ? 'selected' : ''}>${leadVariantLabels[v] || v}</option>`).join('');
    const leadVariantHasChoices = leadVariantNames.length > 1;
    const leadAutoPair = AudioService?.getLeadAutoPair?.() ?? false;
    const leadEffect = AudioService?.getLeadEffect?.() ?? 'straight';
    const leadEffectNames = AudioService?.getLeadEffectNames?.() ?? ['straight'];
    const leadEffectLabels = AudioService?.getLeadEffectLabels?.() ?? { straight: 'Straight (none)' };
    const leadEffectOpts = leadEffectNames.map(e => `<option value="${e}" ${e === leadEffect ? 'selected' : ''}>${leadEffectLabels[e] || e}</option>`).join('');
    
    // Sub-bass tuning params
    const sb = AudioService?.getSubBassParams?.() || { baseFrequency: 50, octaves: 3.2, attack: 0.04, lpFreq: 1200 };
    
    // Stagger controls
    const staggerCount = AudioService?.getStaggerCount?.() ?? 1;
    const staggerBars = AudioService?.getStaggerReshuffleBars?.() ?? 16;
    // Drum dropout
    const drumDropout = AudioService?.getDrumDropoutEnabled?.() ?? true;
    const drumDropoutBars = AudioService?.getDrumDropoutBars?.() ?? 64;
    // Octave swap
    const octaveSwap = AudioService?.getOctaveSwapEnabled?.() ?? false;
    const octaveSwapPeriod = AudioService?.getOctaveSwapPeriodBars?.() ?? 32;
    const octaveSwapDuration = AudioService?.getOctaveSwapDurationBars?.() ?? 8;
    
    designModal.innerHTML = `
      <div class="audio-design-panel">
        <div class="audio-design-title">🎛️ Sound Design</div>
        
        <!-- DUAL PRESET SELECTOR -->
        <div class="audio-design-section">
          <div class="audio-design-section-title">🎨 Dual Presets</div>
          
          <div class="dual-preset-row">
            <div class="preset-column">
              <div class="audio-design-label"><span>Preset A</span></div>
              <div class="audio-preset-selector compact" id="designPresetsA"></div>
            </div>
            <div class="preset-column">
              <div class="audio-design-label"><span>Preset B</span></div>
              <div class="audio-preset-selector compact" id="designPresetsB"></div>
            </div>
          </div>
        </div>
        
        <!-- CROSSFADE CONTROL -->
        <div class="audio-design-section">
          <div class="audio-design-label">
            <span>Crossfade A ↔ B</span>
            <span id="crossfadeValue">${Math.round(currentCrossfade * 100)}%</span>
          </div>
          <input type="range" class="audio-design-slider" id="crossfadeSlider" 
                 min="0" max="100" value="${Math.round(currentCrossfade * 100)}" step="1">
          <div class="crossfade-labels">
            <span>100% A</span>
            <span id="journeyModeIndicator" style="color:#666;font-size:11px;"></span>
            <span>100% B</span>
          </div>
        </div>
        
        <!-- EDIT TABS -->
        <div class="audio-design-section">
          <div class="edit-tabs">
            <button class="edit-tab active" data-tab="A">✏️ Edit Preset A</button>
            <button class="edit-tab" data-tab="B">✏️ Edit Preset B</button>
          </div>
          
          <!-- PRESET A EDITOR -->
          <div class="preset-editor" id="editorA">
            <div class="audio-design-label">
              <span>Oscillator</span>
              <span id="oscTypeValueA">${params.A?.oscillator?.type || 'fatsine'}</span>
            </div>
            <div class="osc-type-selector" id="oscTypeSelectorA"></div>
            
            <div class="audio-design-label" style="margin-top:12px;">
              <span>Spread (fat osc)</span>
              <span id="oscSpreadValueA">${params.A?.oscillator?.spread || 20}</span>
            </div>
            <input type="range" class="audio-design-slider" id="oscSpreadSliderA" 
                   min="0" max="100" value="${params.A?.oscillator?.spread || 20}" step="1">
            
            <div class="audio-design-label" style="margin-top:12px;">
              <span>Attack</span>
              <span id="attackValueA">${(params.A?.envelope?.attack || 0.3).toFixed(2)}s</span>
            </div>
            <input type="range" class="audio-design-slider" id="attackSliderA" 
                   min="0.001" max="3" value="${params.A?.envelope?.attack || 0.3}" step="0.01">
            
            <div class="audio-design-label" style="margin-top:12px;">
              <span>Release</span>
              <span id="releaseValueA">${(params.A?.envelope?.release || 3.0).toFixed(1)}s</span>
            </div>
            <input type="range" class="audio-design-slider" id="releaseSliderA" 
                   min="0.1" max="10" value="${params.A?.envelope?.release || 3.0}" step="0.1">
            
            <div class="audio-design-label" style="margin-top:12px;">
              <span>High-Pass</span>
              <span id="hpfValueA">${Math.round(params.A?.hpFreq || 20)} Hz</span>
            </div>
            <input type="range" class="audio-design-slider" id="hpfSliderA" 
                   min="0" max="100" value="${freqToLog(params.A?.hpFreq || 20)}" step="1">
            
            <div class="audio-design-label" style="margin-top:12px;">
              <span>Low-Pass</span>
              <span id="lpfValueA">${Math.round(params.A?.lpFreq || 20000)} Hz</span>
            </div>
            <input type="range" class="audio-design-slider" id="lpfSliderA" 
                   min="0" max="100" value="${freqToLog(params.A?.lpFreq || 20000)}" step="1">
            
            <div class="audio-design-label" style="margin-top:12px;">
              <span>Reverb</span>
              <span id="reverbValueA">${Math.round((params.A?.reverbWet || 0.7) * 100)}%</span>
            </div>
            <input type="range" class="audio-design-slider" id="reverbSliderA" 
                   min="0" max="100" value="${Math.round((params.A?.reverbWet || 0.7) * 100)}" step="5">
            
            <div class="audio-design-label" style="margin-top:12px;">
              <span>BPM</span>
              <span id="bpmValueA">${params.A?.bpm || 100}</span>
            </div>
            <input type="range" class="audio-design-slider" id="bpmSliderA" 
                   min="40" max="200" value="${params.A?.bpm || 100}" step="1">
            
            <div class="audio-design-label" style="margin-top:12px;">
              <span>Humanize</span>
              <span id="humanizeValueA">${Math.round((params.A?.humanize || 0.1) * 100)}%</span>
            </div>
            <input type="range" class="audio-design-slider" id="humanizeSliderA" 
                   min="0" max="100" value="${Math.round((params.A?.humanize || 0.1) * 100)}" step="1">
          </div>
          
          <!-- PRESET B EDITOR (hidden by default) -->
          <div class="preset-editor" id="editorB" style="display:none;">
            <div class="audio-design-label">
              <span>Oscillator</span>
              <span id="oscTypeValueB">${params.B?.oscillator?.type || 'fatsine'}</span>
            </div>
            <div class="osc-type-selector" id="oscTypeSelectorB"></div>
            
            <div class="audio-design-label" style="margin-top:12px;">
              <span>Spread (fat osc)</span>
              <span id="oscSpreadValueB">${params.B?.oscillator?.spread || 20}</span>
            </div>
            <input type="range" class="audio-design-slider" id="oscSpreadSliderB" 
                   min="0" max="100" value="${params.B?.oscillator?.spread || 20}" step="1">
            
            <div class="audio-design-label" style="margin-top:12px;">
              <span>Attack</span>
              <span id="attackValueB">${(params.B?.envelope?.attack || 0.3).toFixed(2)}s</span>
            </div>
            <input type="range" class="audio-design-slider" id="attackSliderB" 
                   min="0.001" max="3" value="${params.B?.envelope?.attack || 0.3}" step="0.01">
            
            <div class="audio-design-label" style="margin-top:12px;">
              <span>Release</span>
              <span id="releaseValueB">${(params.B?.envelope?.release || 3.0).toFixed(1)}s</span>
            </div>
            <input type="range" class="audio-design-slider" id="releaseSliderB" 
                   min="0.1" max="10" value="${params.B?.envelope?.release || 3.0}" step="0.1">
            
            <div class="audio-design-label" style="margin-top:12px;">
              <span>High-Pass</span>
              <span id="hpfValueB">${Math.round(params.B?.hpFreq || 20)} Hz</span>
            </div>
            <input type="range" class="audio-design-slider" id="hpfSliderB" 
                   min="0" max="100" value="${freqToLog(params.B?.hpFreq || 20)}" step="1">
            
            <div class="audio-design-label" style="margin-top:12px;">
              <span>Low-Pass</span>
              <span id="lpfValueB">${Math.round(params.B?.lpFreq || 20000)} Hz</span>
            </div>
            <input type="range" class="audio-design-slider" id="lpfSliderB" 
                   min="0" max="100" value="${freqToLog(params.B?.lpFreq || 20000)}" step="1">
            
            <div class="audio-design-label" style="margin-top:12px;">
              <span>Reverb</span>
              <span id="reverbValueB">${Math.round((params.B?.reverbWet || 0.7) * 100)}%</span>
            </div>
            <input type="range" class="audio-design-slider" id="reverbSliderB" 
                   min="0" max="100" value="${Math.round((params.B?.reverbWet || 0.7) * 100)}" step="5">
            
            <div class="audio-design-label" style="margin-top:12px;">
              <span>BPM</span>
              <span id="bpmValueB">${params.B?.bpm || 100}</span>
            </div>
            <input type="range" class="audio-design-slider" id="bpmSliderB" 
                   min="40" max="200" value="${params.B?.bpm || 100}" step="1">
            
            <div class="audio-design-label" style="margin-top:12px;">
              <span>Humanize</span>
              <span id="humanizeValueB">${Math.round((params.B?.humanize || 0.1) * 100)}%</span>
            </div>
            <input type="range" class="audio-design-slider" id="humanizeSliderB" 
                   min="0" max="100" value="${Math.round((params.B?.humanize || 0.1) * 100)}" step="1">
          </div>
        </div>
        
        <!-- MODE -->
        <div class="audio-design-section">
          <div class="audio-design-label"><span>Mode</span></div>
          <div style="display:flex;gap:8px;">
            <button class="mode-btn ${!params.droneMode ? 'active' : ''}" id="intermittentBtn">✨ BPM Clock</button>
            <button class="mode-btn ${params.droneMode ? 'active' : ''}" id="droneBtn">〰️ Drone</button>
          </div>
        </div>
        
        <!-- DRONE MODE SETTINGS (only visible when drone mode active) -->
        <div class="audio-design-section drone-settings-section" id="droneSettingsSection" style="display:${params.droneMode ? 'block' : 'none'};">
          <div class="audio-design-section-title">〰️ Drone Mode Settings</div>
          
          <!-- BPM Sync -->
          <div class="drone-setting-row">
            <label class="drone-toggle-label">
              <input type="checkbox" id="droneBPMEnabled" ${params.droneBPMEnabled ? 'checked' : ''}>
              <span>🎵 BPM-synced updates</span>
            </label>
            <div class="drone-setting-detail" id="droneBPMDetail" style="display:${params.droneBPMEnabled ? 'block' : 'none'};">
              <div class="audio-design-label">
                <span>Update every</span>
                <span id="droneBPMDivisorValue">${params.droneBPMDivisor || 4} beats</span>
              </div>
              <input type="range" class="audio-design-slider" id="droneBPMDivisorSlider" 
                     min="1" max="16" value="${params.droneBPMDivisor || 4}" step="1">
            </div>
          </div>
          
          <!-- Octave Decay -->
          <div class="drone-setting-row">
            <label class="drone-toggle-label">
              <input type="checkbox" id="droneDecayEnabled" ${params.droneDecayEnabled ? 'checked' : ''}>
              <span>📉 Octave decay (background older notes)</span>
            </label>
            <div class="drone-setting-detail" id="droneDecayDetail" style="display:${params.droneDecayEnabled ? 'block' : 'none'};">
              <div class="audio-design-label">
                <span>Decay over</span>
                <span id="droneDecayBarsValue">${params.droneDecayBars || 8} bars</span>
              </div>
              <input type="range" class="audio-design-slider" id="droneDecayBarsSlider" 
                     min="1" max="32" value="${params.droneDecayBars || 8}" step="1">
              <div class="audio-design-label" style="margin-top:8px;">
                <span>Decay to</span>
                <span id="droneDecayTargetValue">${params.droneDecayTargetDb !== undefined ? params.droneDecayTargetDb : 0} dB</span>
              </div>
              <input type="range" class="audio-design-slider" id="droneDecayTargetSlider" 
                     min="-48" max="0" value="${params.droneDecayTargetDb !== undefined ? params.droneDecayTargetDb : 0}" step="1">
            </div>
          </div>
          
          <!-- Movement Fade -->
          <div class="drone-setting-row">
            <label class="drone-toggle-label">
              <input type="checkbox" id="droneMovementFade" ${params.droneMovementFade ? 'checked' : ''}>
              <span>🚶 Fade when stationary</span>
            </label>
            <div class="drone-setting-detail" id="droneMovementDetail" style="display:${params.droneMovementFade ? 'block' : 'none'};">
              <div class="audio-design-label">
                <span>Start fade after</span>
                <span id="droneStationaryStartValue">${startS}s</span>
              </div>
              <input type="range" class="audio-design-slider" id="droneStationaryStartSlider" 
                     min="5" max="120" value="${startS}" step="5">
              <div class="audio-design-label" style="margin-top:8px;">
                <span>Fade duration</span>
                <span id="droneStationaryFadeValue">${fadeS}s</span>
              </div>
              <input type="range" class="audio-design-slider" id="droneStationaryFadeSlider" 
                     min="5" max="90" value="${fadeS}" step="5">
            </div>
          </div>
          
          <div class="drone-setting-row">
            <label class="drone-toggle-label">
              <input type="checkbox" id="droneStaggeredIdle" ${AudioService?.getStaggeredIdleEntrances?.() ? 'checked' : ''}>
              <span>🌊 Staggered idle entrances</span>
            </label>
            <div class="audio-design-label" style="margin-top:6px;">
              <span>Octaves staggered at once</span><span id="staggerCountValue">${staggerCount}</span>
            </div>
            <input type="range" class="audio-design-slider" id="staggerCountSlider" min="0" max="5" value="${staggerCount}" step="1">
            <div class="audio-design-label" style="margin-top:6px;">
              <span>Rotate every</span><span id="staggerBarsValue">${staggerBars} bars</span>
            </div>
            <input type="range" class="audio-design-slider" id="staggerBarsSlider" min="4" max="64" value="${staggerBars}" step="4">
          </div>
          
          <!-- Pattern Evolution (only visible when BPM sync enabled) -->
          <div class="drone-setting-row" id="patternEvolutionSection" style="display:${params.droneBPMEnabled ? 'block' : 'none'};">
            <div class="audio-design-section-title" style="margin-top:12px;">🎼 Pattern Evolution</div>
            
            <label class="drone-toggle-label">
              <input type="checkbox" id="patternEvolutionEnabled" ${params.patternEvolutionEnabled !== false ? 'checked' : ''}>
              <span>Enable pattern evolution</span>
            </label>
            
            <div class="drone-setting-detail" id="patternEvolutionDetail" style="display:${params.patternEvolutionEnabled !== false ? 'block' : 'none'};">
              <div class="audio-design-label">
                <span>Evolve every</span>
                <span id="patternEvolutionBarsValue">${params.patternEvolutionBars || 8} bars</span>
              </div>
              <input type="range" class="audio-design-slider" id="patternEvolutionBarsSlider" 
                     min="1" max="32" value="${params.patternEvolutionBars || 8}" step="1">
              
              <div class="audio-design-label" style="margin-top:8px;">
                <span>Max melodic octaves</span>
                <span id="maxMelodicOctavesValue">${params.maxMelodicOctaves || 3}</span>
              </div>
              <input type="range" class="audio-design-slider" id="maxMelodicOctavesSlider" 
                     min="1" max="10" value="${params.maxMelodicOctaves || 3}" step="1">
              
              <div class="audio-design-label" style="margin-top:8px;">
                <span>Octave selection</span>
              </div>
              <div style="display:flex;gap:8px;margin-bottom:8px;">
                <button class="octave-sel-btn ${(params.octaveSelectionMode || 'adjacent') === 'adjacent' ? 'active' : ''}" id="octaveSelAdjacent">Adjacent</button>
                <button class="octave-sel-btn ${params.octaveSelectionMode === 'random' ? 'active' : ''}" id="octaveSelRandom">Random</button>
              </div>
              
              <div class="audio-design-label" style="margin-top:8px;">
                <span>Max pattern length</span>
                <span id="maxPatternBarsValue">${params.maxPatternBars || 4} bars</span>
              </div>
              <input type="range" class="audio-design-slider" id="maxPatternBarsSlider" 
                     min="1" max="8" value="${params.maxPatternBars || 4}" step="1">
              
              <label class="drone-toggle-label" style="margin-top:8px;">
                <input type="checkbox" id="beatAlignNotes" ${params.beatAlignNotes ? 'checked' : ''}>
                <span>Beat-align notes</span>
              </label>
              
              <div class="audio-design-label" style="margin-top:12px;">
                <span>Reset when octave changes</span>
                <span id="resetAnchorOctaveValue">${params.resetAnchorOctave !== undefined ? params.resetAnchorOctave : 4}</span>
              </div>
              <input type="range" class="audio-design-slider" id="resetAnchorOctaveSlider" 
                     min="0" max="9" value="${params.resetAnchorOctave !== undefined ? params.resetAnchorOctave : 4}" step="1">
              
              <button class="pattern-reset-btn" id="resetPatternsBtn" style="margin-top:12px;">↺ Reset to Whole Notes</button>
            </div>
          </div>
        </div>
        
        <!-- JOURNEY CROSSFADE MODE -->
        <div class="audio-design-section">
          <label class="drone-toggle-label">
            <input type="checkbox" id="journeyLogCrossfade" ${params.journeyCrossfadeLogarithmic !== false ? 'checked' : ''}>
            <span>🗺️ Logarithmic journey crossfade (more gradual blend)</span>
          </label>
        </div>
        
        <!-- GLOBAL SETTINGS -->
        <div class="audio-design-section">
          <div class="audio-design-section-title">🌐 Global Settings</div>
          
          <div class="audio-design-label">
            <span>Master Volume</span>
            <span id="volumeValue">${displayVolume} dB</span>
          </div>
          <input type="range" class="audio-design-slider" id="volumeSlider" 
                 min="-60" max="0" value="${displayVolume}" step="1">
          
          <div class="audio-design-label" style="margin-top:12px;">
            <span>Transpose</span>
            <span id="transposeValue">${params.transpose >= 0 ? '+' : ''}${params.transpose} oct</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button class="transpose-btn" id="transposeDown">−</button>
            <input type="range" class="audio-design-slider" id="transposeSlider" 
                   min="-3" max="3" value="${params.transpose}" step="1" style="flex:1;">
            <button class="transpose-btn" id="transposeUp">+</button>
          </div>
          
          <div class="audio-design-label" style="margin-top:12px;">
            <span>Pattern Refresh</span>
            <span id="refreshValue">${params.patternRefreshBars} bars</span>
          </div>
          <input type="range" class="audio-design-slider" id="refreshSlider" 
                 min="1" max="16" value="${params.patternRefreshBars}" step="1">
          
          <div class="audio-design-label" style="margin-top:12px;">
            <span>Acceleration Sensitivity</span>
            <span id="accelValue">${Math.round(params.accelerationSensitivity * 100)}%</span>
          </div>
          <input type="range" class="audio-design-slider" id="accelSlider" 
                 min="0" max="100" value="${Math.round(params.accelerationSensitivity * 100)}" step="5">
        </div>
        
        <!-- OCTAVE CONTROLS -->
        <div class="audio-design-section">
          <div class="audio-design-section-title">🎼 Octave Controls</div>
          <div class="octave-controls-container" id="octaveControls">
            ${octaveControlsHTML}
          </div>
        </div>
        
        <!-- PER-OCTAVE INSTRUMENTS -->
        <div class="audio-design-section" id="perOctaveSection">
          <div class="audio-design-section-title">🎹 Per-octave instruments</div>
          <label class="drone-toggle-label">
            <input type="checkbox" id="perOctaveEnabled" ${perOctaveEnabled ? 'checked' : ''}>
            <span>Enable per-octave instruments</span>
          </label>
          <div class="per-octave-status" id="perOctaveStatus" style="font-size:12px;opacity:0.7;margin:4px 0 8px;"></div>
          <div class="per-octave-container" id="perOctaveControls" style="opacity:${perOctaveEnabled ? '1' : '0.5'};">
            ${perOctaveRowsHTML}
          </div>
          <div class="subbass-tuning" style="margin-top:12px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1);">
            <div class="audio-design-label"><span>🔊 Sub-bass tuning</span></div>
            <div class="audio-design-label" style="margin-top:6px;">
              <span>Sweep depth</span><span id="sbOctavesValue">${sb.octaves}</span>
            </div>
            <input type="range" class="audio-design-slider" id="sbOctavesSlider" min="0.5" max="6" value="${sb.octaves}" step="0.1">
            <div class="audio-design-label" style="margin-top:6px;">
              <span>Base frequency</span><span id="sbBaseFreqValue">${sb.baseFrequency}Hz</span>
            </div>
            <input type="range" class="audio-design-slider" id="sbBaseFreqSlider" min="20" max="200" value="${sb.baseFrequency}" step="1">
            <div class="audio-design-label" style="margin-top:6px;">
              <span>Attack</span><span id="sbAttackValue">${sb.attack}s</span>
            </div>
            <input type="range" class="audio-design-slider" id="sbAttackSlider" min="0.005" max="1" value="${sb.attack}" step="0.005">
            <div class="audio-design-label" style="margin-top:6px;">
              <span>Low-pass ceiling</span><span id="sbLpFreqValue">${sb.lpFreq}Hz</span>
            </div>
            <input type="range" class="audio-design-slider" id="sbLpFreqSlider" min="200" max="4000" value="${sb.lpFreq}" step="50">
          </div>
          <div class="octave-swap-tuning" style="margin-top:12px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1);">
            <label class="drone-toggle-label">
              <input type="checkbox" id="octaveSwapEnabled" ${octaveSwap ? 'checked' : ''}>
              <span>🎷 Instrument solos (melodic octave)</span>
            </label>
            <div class="audio-design-label" style="margin-top:6px;">
              <span>Swap every</span><span id="octaveSwapPeriodValue">${octaveSwapPeriod} bars</span>
            </div>
            <input type="range" class="audio-design-slider" id="octaveSwapPeriodSlider" min="8" max="128" value="${octaveSwapPeriod}" step="8">
            <div class="audio-design-label" style="margin-top:6px;">
              <span>Swap lasts</span><span id="octaveSwapDurationValue">${octaveSwapDuration} bars</span>
            </div>
            <input type="range" class="audio-design-slider" id="octaveSwapDurationSlider" min="2" max="32" value="${octaveSwapDuration}" step="2">
          </div>
        </div>
        
        <!-- RETRO DRUMS -->
        <div class="audio-design-section" id="drumSection">
          <div class="audio-design-section-title">🥁 Retro drums</div>
          <label class="drone-toggle-label">
            <input type="checkbox" id="drumEnabled" ${drumEnabled ? 'checked' : ''}>
            <span>Enable drum track</span>
          </label>
          <div class="drum-controls" id="drumControls" style="opacity:${drumEnabled ? '1' : '0.5'};margin-top:8px;">
            <div class="audio-design-label" style="margin-top:8px;"><span>Kit</span></div>
            <select id="drumKitSelect" class="octave-instrument-select" style="width:100%;">
              ${drumKitOptions}
            </select>
            <div class="audio-design-label" style="margin-top:8px;">
              <span>Volume</span><span id="drumVolumeValue">${drumVolumeDb}dB</span>
            </div>
            <input type="range" class="audio-design-slider" id="drumVolumeSlider"
                   min="-30" max="0" value="${drumVolumeDb}" step="1">
            <label class="drone-toggle-label" style="margin-top:8px;">
              <input type="checkbox" id="drumFollowMovement" ${drumFollow ? 'checked' : ''}>
              <span>Follow movement (density + ebb)</span>
            </label>
            <label class="drone-toggle-label">
              <input type="checkbox" id="drumEvolveEnabled" ${drumEvolve ? 'checked' : ''}>
              <span>Evolve (flip one hit every 8 bars)</span>
            </label>
            <label class="drone-toggle-label">
              <input type="checkbox" id="drumDropoutEnabled" ${drumDropout ? 'checked' : ''}>
              <span>Drop out &amp; return busier</span>
            </label>
            <div class="audio-design-label" style="margin-top:6px;">
              <span>Drop out every</span><span id="drumDropoutBarsValue">${drumDropoutBars} bars</span>
            </div>
            <input type="range" class="audio-design-slider" id="drumDropoutBarsSlider" min="8" max="128" value="${drumDropoutBars}" step="8">
            <div class="audio-design-label" style="margin-top:6px;">
              <span>Return busy-ness</span><span id="drumFillStartValue">${drumFillStart} extra hats</span>
            </div>
            <input type="range" class="audio-design-slider" id="drumFillStartSlider" min="0" max="8" value="${drumFillStart}" step="1">
            <div class="audio-design-hint" style="font-size:11px;opacity:0.6;margin-top:6px;">
              Kit "randomize" switches to a different kit on each return.
            </div>
          </div>
        </div>
        
        <!-- LEAD / ARRANGER -->
        <div class="audio-design-section" id="leadSection">
          <div class="audio-design-section-title">🎺 Lead voice (foreground melody)</div>
          <label class="drone-toggle-label">
            <input type="checkbox" id="leadEnabled" ${leadEnabled ? 'checked' : ''}>
            <span>Enable lead</span>
          </label>
          <div class="lead-controls" id="leadControls" style="opacity:${leadEnabled ? '1' : '0.5'};margin-top:8px;">
            <div class="audio-design-label" style="margin-top:6px;"><span>Style</span></div>
            <select id="leadStyleSelect" class="octave-instrument-select" style="width:100%;">${leadStyleOpts}</select>
            <div class="audio-design-label" style="margin-top:8px;"><span>Voice</span></div>
            <select id="leadEngineSelect" class="octave-instrument-select" style="width:100%;">${leadEngineOpts}</select>
            <div class="audio-design-label" id="leadVariantLabel" style="margin-top:8px;display:${leadVariantHasChoices ? 'flex' : 'none'};"><span>Variant</span></div>
            <select id="leadVariantSelect" class="octave-instrument-select" style="width:100%;display:${leadVariantHasChoices ? 'block' : 'none'};">${leadVariantOpts}</select>
            <div class="audio-design-label" style="margin-top:8px;"><span>Effect</span></div>
            <select id="leadEffectSelect" class="octave-instrument-select" style="width:100%;">${leadEffectOpts}</select>
            <div class="audio-design-label" style="margin-top:8px;">
              <span>Mode</span>
            </div>
            <div style="display:flex;gap:12px;margin-top:4px;">
              <label class="drone-toggle-label" style="margin:0;"><input type="radio" name="leadMode" value="replace" ${leadMode === 'replace' ? 'checked' : ''}> <span>Replace</span></label>
              <label class="drone-toggle-label" style="margin:0;"><input type="radio" name="leadMode" value="layer" ${leadMode === 'layer' ? 'checked' : ''}> <span>Layer</span></label>
            </div>
            <div class="audio-design-label" style="margin-top:8px;">
              <span>Phrase length</span><span id="leadPhraseBarsValue">${leadPhraseBars} bars</span>
            </div>
            <input type="range" class="audio-design-slider" id="leadPhraseBarsSlider" min="1" max="16" value="${leadPhraseBars}" step="1">
            <div class="audio-design-label" style="margin-top:8px;">
              <span>Rest between phrases</span><span id="leadRestBarsValue">${leadRestBars} bars</span>
            </div>
            <input type="range" class="audio-design-slider" id="leadRestBarsSlider" min="0" max="16" value="${leadRestBars}" step="1">
            <div class="audio-design-label" style="margin-top:8px;">
              <span>Enter after</span><span id="leadIntroBarsValue">${leadIntroBars} bars</span>
            </div>
            <input type="range" class="audio-design-slider" id="leadIntroBarsSlider" min="0" max="16" value="${leadIntroBars}" step="1">
            <div class="audio-design-label" style="margin-top:8px;">
              <span>Volume</span><span id="leadVolumeValue">${leadVolumeDb}dB</span>
            </div>
            <input type="range" class="audio-design-slider" id="leadVolumeSlider" min="-30" max="0" value="${leadVolumeDb}" step="1">
            <label class="drone-toggle-label" style="margin-top:6px;">
              <input type="checkbox" id="leadFollowMovement" ${leadFollow ? 'checked' : ''}>
              <span>Phrasing follows movement</span>
            </label>
            <label class="drone-toggle-label">
              <input type="checkbox" id="leadFadeWhenStationary" ${leadFadeStationary ? 'checked' : ''}>
              <span>Fade out when stationary</span>
            </label>
            <label class="drone-toggle-label">
              <input type="checkbox" id="leadAutoPair" ${leadAutoPair ? 'checked' : ''}>
              <span>Auto: pair voice + style, switch on drum change</span>
            </label>
            <div style="display:flex;gap:8px;margin-top:8px;">
              <button type="button" id="leadNewMelodyBtn" class="pattern-reset-btn" style="flex:1;margin-top:0;">🎲 New melody</button>
              <button type="button" id="leadNextSectionBtn" class="pattern-reset-btn" style="flex:1;margin-top:0;">⏭ Next section</button>
            </div>
            <div class="audio-design-hint" style="font-size:11px;opacity:0.6;margin-top:6px;">
              Composes a tune (A A&#8242; B A&#8243;) from the exact notes the place gives,
              across all their octaves &mdash; question/answer phrases, one climax,
              resolving home. New melody rerolls the tune; Next section skips ahead.
            </div>
          </div>
        </div>
        
        <!-- GPS STATUS -->
        <div class="audio-design-section">
          <div class="gps-status" id="gpsStatus">
            <span class="gps-dot"></span>
            <span class="gps-text">GPS: --</span>
          </div>
        </div>
        
        <!-- JOURNEY SECTION -->
        <div class="audio-design-section">
          <div class="audio-design-section-title">🗺️ Sound Journey</div>
          <div class="journey-controls">
            <div class="journey-status" id="journeyStatus">No active journey</div>
            <div class="journey-buttons">
              <button class="journey-btn" id="journeyNewBtn" title="Create new journey">➕ New</button>
              <button class="journey-btn" id="journeyManageBtn" title="Manage journeys">📋 Manage</button>
            </div>
            <div class="journey-active" id="journeyActive" style="display:none;">
              <div class="journey-progress-bar">
                <div class="journey-progress-fill" id="journeyProgressFill"></div>
              </div>
              <div class="journey-waypoints" id="journeyWaypoints"></div>
              <button class="journey-btn danger" id="journeyStopBtn">⏹ Stop Journey</button>
            </div>
          </div>
        </div>
        
        <!-- PRESET SAVE -->
        <div class="audio-design-section">
          <div style="display:flex;gap:8px;">
            <button class="preset-action-btn" id="savePresetBtn" title="Save current A settings as new preset">💾 Save Preset</button>
            <button class="preset-action-btn" id="deletePresetBtn" title="Delete selected user preset" style="display:none;">🗑️ Delete</button>
          </div>
        </div>
        
        <div class="audio-design-btns">
          <button class="audio-design-btn secondary" id="designClose">Close</button>
          <button class="audio-design-btn pocket" id="pocketModeBtn" title="Pocket mode - lock screen while playing">⬛</button>
          <button class="audio-design-btn primary" id="designPlay">▶ Test</button>
        </div>
      </div>
    `;
    
    // Add extra styles
    const extraStyles = document.createElement('style');
    extraStyles.textContent = `
      .dual-preset-row {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .preset-column {
        flex: 1;
        min-width: 0;
      }
      .audio-preset-selector.compact {
        max-height: 120px;
        overflow-y: auto;
      }
      .audio-preset-selector.compact .audio-preset-btn {
        padding: 4px 8px;
        font-size: 11px;
      }
      .crossfade-labels {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: #666;
        margin-top: 4px;
      }
      .edit-tabs {
        display: flex;
        gap: 4px;
        margin-bottom: 12px;
      }
      .edit-tab {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid rgba(0,255,255,0.3);
        background: rgba(0,0,0,0.3);
        color: #888;
        border-radius: 6px 6px 0 0;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      }
      .edit-tab:hover {
        background: rgba(0,255,255,0.1);
      }
      .edit-tab.active {
        background: rgba(0,255,255,0.15);
        border-color: cyan;
        border-bottom-color: transparent;
        color: cyan;
      }
      .preset-editor {
        background: rgba(0,255,255,0.05);
        border: 1px solid rgba(0,255,255,0.2);
        border-top: none;
        border-radius: 0 0 6px 6px;
        padding: 12px;
      }
      .mode-btn {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid rgba(0,255,255,0.3);
        background: rgba(0,0,0,0.3);
        color: #aaa;
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        transition: all 0.2s;
      }
      .mode-btn:hover {
        background: rgba(0,255,255,0.1);
      }
      .mode-btn.active {
        background: rgba(0,255,255,0.2);
        border-color: cyan;
        color: cyan;
      }
      .drone-settings-section {
        background: rgba(0,255,255,0.05);
        border: 1px solid rgba(0,255,255,0.2);
        border-radius: 8px;
        padding: 12px;
      }
      .drone-setting-row {
        margin-bottom: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      .drone-setting-row:last-child {
        margin-bottom: 0;
        padding-bottom: 0;
        border-bottom: none;
      }
      .drone-toggle-label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        color: #ccc;
        font-size: 13px;
      }
      .drone-toggle-label input[type="checkbox"] {
        width: 18px;
        height: 18px;
        accent-color: cyan;
        cursor: pointer;
      }
      .drone-toggle-label:hover {
        color: #fff;
      }
      .drone-setting-detail {
        margin-top: 10px;
        margin-left: 26px;
        padding: 8px;
        background: rgba(0,0,0,0.2);
        border-radius: 6px;
      }
      .octave-sel-btn {
        flex: 1;
        padding: 6px 12px;
        border: 1px solid rgba(0,255,255,0.3);
        background: rgba(0,0,0,0.3);
        color: #aaa;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      }
      .octave-sel-btn:hover {
        background: rgba(0,255,255,0.1);
      }
      .octave-sel-btn.active {
        background: rgba(0,255,255,0.2);
        border-color: cyan;
        color: cyan;
      }
      .pattern-reset-btn {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid rgba(255,150,0,0.5);
        background: rgba(255,150,0,0.1);
        color: #ffa;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      }
      .pattern-reset-btn:hover {
        background: rgba(255,150,0,0.2);
        border-color: rgba(255,150,0,0.7);
      }
      .pattern-reset-btn:active {
        background: rgba(255,150,0,0.3);
      }
      .transpose-btn {
        width: 36px;
        height: 36px;
        border: 1px solid rgba(0,255,255,0.3);
        background: rgba(0,0,0,0.3);
        color: cyan;
        border-radius: 6px;
        cursor: pointer;
        font-size: 20px;
        font-weight: bold;
      }
      .transpose-btn:active {
        background: rgba(0,255,255,0.2);
      }
      .time-sig-selector {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      .time-sig-btn {
        padding: 6px 12px;
        border: 1px solid rgba(0,255,255,0.3);
        background: rgba(0,0,0,0.3);
        color: #aaa;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-family: monospace;
        transition: all 0.2s;
      }
      .time-sig-btn:hover {
        background: rgba(0,255,255,0.1);
      }
      .time-sig-btn.active {
        background: rgba(0,255,255,0.2);
        border-color: cyan;
        color: cyan;
      }
      .octave-controls-container {
        background: rgba(0,0,0,0.3);
        border-radius: 8px;
        padding: 8px;
      }
      .octave-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      .octave-row:last-child {
        border-bottom: none;
      }
      .octave-label {
        width: 40px;
        font-size: 12px;
        color: #888;
      }
      .per-octave-container {
        background: rgba(0,0,0,0.3);
        border-radius: 8px;
        padding: 8px;
        transition: opacity 0.2s;
      }
      .octave-instrument-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }
      .octave-instrument-row:last-child {
        border-bottom: none;
      }
      .octave-instrument-select {
        flex: 1;
        background: rgba(0,0,0,0.4);
        color: #ddd;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 12px;
      }
      .octave-controls {
        flex: 1;
        display: flex;
        gap: 12px;
      }
      .octave-control {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 1;
      }
      .control-label {
        font-size: 10px;
        color: #666;
        width: 24px;
      }
      .mini-slider {
        flex: 1;
        height: 4px;
        -webkit-appearance: none;
        background: linear-gradient(to right, #333, #666);
        border-radius: 2px;
        max-width: 60px;
      }
      .mini-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 12px;
        height: 12px;
        background: cyan;
        border-radius: 50%;
        cursor: pointer;
      }
      .control-value {
        font-size: 10px;
        color: cyan;
        width: 32px;
        text-align: right;
      }
      .gps-status {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: rgba(0,0,0,0.3);
        border-radius: 6px;
        font-size: 12px;
      }
      .gps-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #666;
      }
      .gps-dot.fresh {
        background: #0f0;
        animation: gps-pulse 1s infinite;
      }
      .gps-dot.stale {
        background: #f80;
      }
      @keyframes gps-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      .gps-text {
        color: #888;
      }
      .preset-action-btn {
        padding: 6px 12px;
        border: 1px solid rgba(0,255,255,0.3);
        background: rgba(0,0,0,0.3);
        color: #aaa;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      }
      .preset-action-btn:hover {
        background: rgba(0,255,255,0.1);
        color: cyan;
      }
      .audio-preset-btn.user-preset {
        border-style: dashed;
      }
      .audio-preset-btn.user-preset.active {
        border-style: solid;
      }
      .osc-type-selector {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .osc-type-btn {
        padding: 4px 8px;
        border: 1px solid rgba(0,255,255,0.3);
        background: rgba(0,0,0,0.3);
        color: #aaa;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        transition: all 0.2s;
      }
      .osc-type-btn:hover {
        background: rgba(0,255,255,0.1);
      }
      .osc-type-btn.active {
        background: rgba(0,255,255,0.2);
        border-color: cyan;
        color: cyan;
      }
      .osc-type-btn.fat {
        border-style: dashed;
      }
      .osc-type-btn.fat.active {
        border-style: solid;
      }
      .journey-controls {
        background: rgba(0,0,0,0.3);
        border-radius: 8px;
        padding: 12px;
      }
      .journey-status {
        color: #888;
        font-size: 12px;
        margin-bottom: 8px;
      }
      .journey-buttons {
        display: flex;
        gap: 8px;
      }
      .journey-btn {
        padding: 6px 12px;
        border: 1px solid rgba(0,255,255,0.3);
        background: rgba(0,0,0,0.3);
        color: #aaa;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      }
      .journey-btn:hover {
        background: rgba(0,255,255,0.1);
        color: cyan;
      }
      .journey-btn.danger {
        border-color: rgba(255,100,100,0.3);
      }
      .journey-btn.danger:hover {
        background: rgba(255,100,100,0.1);
        color: #f88;
      }
      .journey-active {
        margin-top: 12px;
      }
      .journey-progress-bar {
        height: 8px;
        background: rgba(255,255,255,0.1);
        border-radius: 4px;
        overflow: hidden;
        margin-bottom: 8px;
      }
      .journey-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, cyan, #0f0);
        width: 0%;
        transition: width 0.3s;
      }
      .journey-waypoints {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .journey-waypoint {
        font-size: 10px;
        color: #666;
        text-align: center;
        flex: 1;
      }
      .journey-waypoint.active {
        color: cyan;
      }
      .journey-waypoint.passed {
        color: #0f0;
      }
      .journey-modal {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.9);
        z-index: 10001;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .journey-modal-content {
        background: linear-gradient(135deg, #1a1a2e, #16213e);
        border-radius: 16px;
        padding: 24px;
        max-width: 500px;
        width: 100%;
        max-height: 80vh;
        overflow-y: auto;
        border: 1px solid rgba(0,255,255,0.2);
      }
      .journey-modal-title {
        font-size: 18px;
        color: cyan;
        margin-bottom: 16px;
      }
      .waypoint-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        background: rgba(0,0,0,0.3);
        border-radius: 6px;
        margin-bottom: 8px;
      }
      .waypoint-number {
        width: 24px;
        height: 24px;
        background: cyan;
        color: #000;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: bold;
      }
      .waypoint-info {
        flex: 1;
      }
      .waypoint-label {
        color: #fff;
        font-size: 13px;
      }
      .waypoint-coords {
        color: #666;
        font-size: 10px;
      }
      .waypoint-preset {
        color: cyan;
        font-size: 11px;
        padding: 2px 6px;
        background: rgba(0,255,255,0.1);
        border-radius: 4px;
      }
      .waypoint-actions {
        display: flex;
        gap: 4px;
      }
      .waypoint-actions button {
        background: none;
        border: none;
        color: #888;
        cursor: pointer;
        padding: 4px;
      }
      .waypoint-actions button:hover {
        color: #fff;
      }
    `;
    designModal.appendChild(extraStyles);
    
    document.body.appendChild(designModal);
    
    // ===== Setup event handlers =====
    
    // Track current preset names for A and B
    let currentPresetA = params.presetA || 'crystal';
    let currentPresetB = params.presetB || 'pad';
    
    // Preset containers for A and B
    const presetContainerA = designModal.querySelector('#designPresetsA');
    const presetContainerB = designModal.querySelector('#designPresetsB');
    const deletePresetBtn = designModal.querySelector('#deletePresetBtn');
    
    function createPresetButtons(container, side, activePreset) {
      container.innerHTML = '';
      const allPresets = AudioService?.getPresets() || presets;
      const builtInPresets = AudioService?.getBuiltInPresets() || presets;
      
      allPresets.forEach((preset) => {
        const btn = document.createElement('button');
        const isUserPreset = !builtInPresets.includes(preset);
        btn.className = 'audio-preset-btn' + 
          (preset === activePreset ? ' active' : '') +
          (isUserPreset ? ' user-preset' : '');
        btn.textContent = preset.charAt(0).toUpperCase() + preset.slice(1);
        btn.title = isUserPreset ? 'User preset' : 'Built-in preset';
        btn.onclick = async () => {
          container.querySelectorAll('.audio-preset-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          
          if (side === 'A') {
            currentPresetA = preset;
            if (AudioService) await AudioService.setPresetA(preset);
          } else {
            currentPresetB = preset;
            if (AudioService) await AudioService.setPresetB(preset);
          }
          
          // Update delete button visibility (based on preset A)
          const isCurrentUserPreset = AudioService && !AudioService.isBuiltInPreset(currentPresetA);
          deletePresetBtn.style.display = isCurrentUserPreset ? 'inline-block' : 'none';
          
          // Update display values
          updateBlendedDisplay();
        };
        container.appendChild(btn);
      });
    }
    
    function refreshAllPresetButtons() {
      createPresetButtons(presetContainerA, 'A', currentPresetA);
      createPresetButtons(presetContainerB, 'B', currentPresetB);
    }
    
    refreshAllPresetButtons();
    
    // Show delete button if preset A is user preset
    const isCurrentUserPreset = AudioService && !AudioService.isBuiltInPreset(currentPresetA);
    deletePresetBtn.style.display = isCurrentUserPreset ? 'inline-block' : 'none';
    
    // Tab switching
    designModal.querySelectorAll('.edit-tab').forEach(tab => {
      tab.onclick = () => {
        designModal.querySelectorAll('.edit-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const which = tab.dataset.tab;
        designModal.querySelector('#editorA').style.display = which === 'A' ? 'block' : 'none';
        designModal.querySelector('#editorB').style.display = which === 'B' ? 'block' : 'none';
      };
    });
    
    // Crossfade slider
    const crossfadeSlider = designModal.querySelector('#crossfadeSlider');
    const journeyIndicator = designModal.querySelector('#journeyModeIndicator');
    
    function updateCrossfadeUI() {
      const isJourneyActive = window.JourneyService?.isActive();
      crossfadeSlider.disabled = isJourneyActive;
      journeyIndicator.textContent = isJourneyActive ? '🗺️ Journey Mode' : '';
      if (isJourneyActive) {
        crossfadeSlider.style.opacity = '0.5';
      } else {
        crossfadeSlider.style.opacity = '1';
      }
    }
    
    updateCrossfadeUI();
    
    crossfadeSlider.oninput = function() {
      if (window.JourneyService?.isActive()) return; // Ignore during journey
      const value = parseInt(this.value) / 100;
      designModal.querySelector('#crossfadeValue').textContent = this.value + '%';
      AudioService?.setCrossfade(value);
    };
    
    // Create oscillator type buttons for both A and B
    function createOscTypeSelector(container, side, currentType) {
      const oscTypes = AudioService?.getOscillatorTypes() || ['sine', 'triangle', 'sawtooth', 'square', 'fatsine', 'fattriangle', 'fatsawtooth', 'fatsquare'];
      container.innerHTML = '';
      
      oscTypes.forEach(type => {
        const btn = document.createElement('button');
        const isFat = type.startsWith('fat');
        btn.className = 'osc-type-btn' + (type === currentType ? ' active' : '') + (isFat ? ' fat' : '');
        btn.textContent = type.replace('fat', 'fat ');
        btn.onclick = async () => {
          container.querySelectorAll('.osc-type-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          designModal.querySelector(`#oscTypeValue${side}`).textContent = type;
          
          // Rebuild the synth chain with new oscillator
          if (side === 'A') {
            await AudioService?.setPresetA(currentPresetA);
          } else {
            await AudioService?.setPresetB(currentPresetB);
          }
          
          // Update spread slider state
          const spreadSlider = designModal.querySelector(`#oscSpreadSlider${side}`);
          spreadSlider.disabled = !isFat;
          spreadSlider.parentElement.style.opacity = isFat ? '1' : '0.4';
        };
        container.appendChild(btn);
      });
    }
    
    createOscTypeSelector(designModal.querySelector('#oscTypeSelectorA'), 'A', params.A?.oscillator?.type || 'fatsine');
    createOscTypeSelector(designModal.querySelector('#oscTypeSelectorB'), 'B', params.B?.oscillator?.type || 'fatsine');
    
    // Preset A parameter handlers
    designModal.querySelector('#oscSpreadSliderA').oninput = function() {
      designModal.querySelector('#oscSpreadValueA').textContent = this.value;
      // Would need AudioService method to update spread on specific chain
    };
    
    designModal.querySelector('#hpfSliderA').oninput = function() {
      const freq = logToFreq(parseFloat(this.value));
      designModal.querySelector('#hpfValueA').textContent = Math.round(freq) + ' Hz';
      AudioService?.setHPF(freq, 'A');
    };
    
    designModal.querySelector('#lpfSliderA').oninput = function() {
      const freq = logToFreq(parseFloat(this.value));
      designModal.querySelector('#lpfValueA').textContent = Math.round(freq) + ' Hz';
      AudioService?.setLPF(freq, 'A');
    };
    
    designModal.querySelector('#reverbSliderA').oninput = function() {
      designModal.querySelector('#reverbValueA').textContent = this.value + '%';
      AudioService?.setReverbWet(parseInt(this.value) / 100, 'A');
    };
    
    designModal.querySelector('#bpmSliderA').oninput = function() {
      designModal.querySelector('#bpmValueA').textContent = this.value;
      AudioService?.setBPM(parseInt(this.value), 'A');
    };
    
    designModal.querySelector('#humanizeSliderA').oninput = function() {
      designModal.querySelector('#humanizeValueA').textContent = this.value + '%';
      AudioService?.setHumanize(parseInt(this.value) / 100, 'A');
    };
    
    designModal.querySelector('#attackSliderA').oninput = function() {
      designModal.querySelector('#attackValueA').textContent = parseFloat(this.value).toFixed(2) + 's';
      AudioService?.setAttack(parseFloat(this.value), 'A');
    };
    
    designModal.querySelector('#releaseSliderA').oninput = function() {
      designModal.querySelector('#releaseValueA').textContent = parseFloat(this.value).toFixed(1) + 's';
      AudioService?.setRelease(parseFloat(this.value), 'A');
    };
    
    // Preset B parameter handlers
    designModal.querySelector('#oscSpreadSliderB').oninput = function() {
      designModal.querySelector('#oscSpreadValueB').textContent = this.value;
    };
    
    designModal.querySelector('#attackSliderB').oninput = function() {
      designModal.querySelector('#attackValueB').textContent = parseFloat(this.value).toFixed(2) + 's';
      AudioService?.setAttack(parseFloat(this.value), 'B');
    };
    
    designModal.querySelector('#releaseSliderB').oninput = function() {
      designModal.querySelector('#releaseValueB').textContent = parseFloat(this.value).toFixed(1) + 's';
      AudioService?.setRelease(parseFloat(this.value), 'B');
    };
    
    designModal.querySelector('#hpfSliderB').oninput = function() {
      const freq = logToFreq(parseFloat(this.value));
      designModal.querySelector('#hpfValueB').textContent = Math.round(freq) + ' Hz';
      AudioService?.setHPF(freq, 'B');
    };
    
    designModal.querySelector('#lpfSliderB').oninput = function() {
      const freq = logToFreq(parseFloat(this.value));
      designModal.querySelector('#lpfValueB').textContent = Math.round(freq) + ' Hz';
      AudioService?.setLPF(freq, 'B');
    };
    
    designModal.querySelector('#reverbSliderB').oninput = function() {
      designModal.querySelector('#reverbValueB').textContent = this.value + '%';
      AudioService?.setReverbWet(parseInt(this.value) / 100, 'B');
    };
    
    designModal.querySelector('#bpmSliderB').oninput = function() {
      designModal.querySelector('#bpmValueB').textContent = this.value;
      AudioService?.setBPM(parseInt(this.value), 'B');
    };
    
    designModal.querySelector('#humanizeSliderB').oninput = function() {
      designModal.querySelector('#humanizeValueB').textContent = this.value + '%';
      AudioService?.setHumanize(parseInt(this.value) / 100, 'B');
    };
    
    // Save preset button (saves A's settings)
    designModal.querySelector('#savePresetBtn').onclick = () => {
      const name = prompt('Enter a name for this preset:', '');
      if (!name || !name.trim()) return;
      
      const trimmedName = name.trim().toLowerCase().replace(/\s+/g, '_');
      
      if (AudioService?.isBuiltInPreset(trimmedName)) {
        alert('Cannot overwrite a built-in preset. Choose a different name.');
        return;
      }
      
      // Only ask to overwrite if it's an existing USER preset
      if (AudioService?.isUserPreset?.(trimmedName)) {
        if (!confirm(`Preset "${trimmedName}" already exists. Overwrite?`)) {
          return;
        }
      }
      
      if (AudioService?.saveUserPreset(trimmedName)) {
        currentPresetA = trimmedName;
        refreshAllPresetButtons();
        deletePresetBtn.style.display = 'inline-block';
        alert(`Preset "${trimmedName}" saved!`);
      } else {
        alert('Failed to save preset.');
      }
    };
    
    // Delete preset button
    deletePresetBtn.onclick = () => {
      if (!currentPresetA || AudioService?.isBuiltInPreset(currentPresetA)) {
        return;
      }
      
      if (!confirm(`Delete preset "${currentPresetA}"?`)) {
        return;
      }
      
      if (AudioService?.deleteUserPreset(currentPresetA)) {
        currentPresetA = 'crystal';
        AudioService?.setPresetA('crystal');
        refreshAllPresetButtons();
        deletePresetBtn.style.display = 'none';
        updateBlendedDisplay();
      }
    };
    
    // Mode buttons
    designModal.querySelector('#intermittentBtn').onclick = () => {
      AudioService?.setDroneMode(false);
      designModal.querySelector('#intermittentBtn').classList.add('active');
      designModal.querySelector('#droneBtn').classList.remove('active');
      designModal.querySelector('#droneSettingsSection').style.display = 'none';
    };
    
    designModal.querySelector('#droneBtn').onclick = () => {
      AudioService?.setDroneMode(true);
      designModal.querySelector('#droneBtn').classList.add('active');
      designModal.querySelector('#intermittentBtn').classList.remove('active');
      designModal.querySelector('#droneSettingsSection').style.display = 'block';
    };
    
    // Drone mode settings handlers
    
    // BPM sync toggle
    designModal.querySelector('#droneBPMEnabled').onchange = function() {
      AudioService?.setDroneBPMEnabled(this.checked);
      designModal.querySelector('#droneBPMDetail').style.display = this.checked ? 'block' : 'none';
      // Also show/hide pattern evolution section
      const patternSection = designModal.querySelector('#patternEvolutionSection');
      if (patternSection) {
        patternSection.style.display = this.checked ? 'block' : 'none';
      }
    };
    
    // BPM divisor slider
    designModal.querySelector('#droneBPMDivisorSlider').oninput = function() {
      designModal.querySelector('#droneBPMDivisorValue').textContent = this.value + ' beats';
      AudioService?.setDroneBPMDivisor(parseInt(this.value));
    };
    
    // Decay toggle
    designModal.querySelector('#droneDecayEnabled').onchange = function() {
      AudioService?.setDroneDecayEnabled(this.checked);
      designModal.querySelector('#droneDecayDetail').style.display = this.checked ? 'block' : 'none';
    };
    
    // Decay bars slider
    designModal.querySelector('#droneDecayBarsSlider').oninput = function() {
      designModal.querySelector('#droneDecayBarsValue').textContent = this.value + ' bars';
      AudioService?.setDroneDecayBars(parseInt(this.value));
    };
    
    // Decay target dB slider
    designModal.querySelector('#droneDecayTargetSlider').oninput = function() {
      designModal.querySelector('#droneDecayTargetValue').textContent = this.value + ' dB';
      AudioService?.setDroneDecayTargetDb(parseInt(this.value));
    };
    
    // Movement fade toggle
    designModal.querySelector('#droneMovementFade').onchange = function() {
      AudioService?.setDroneMovementFade(this.checked);
      designModal.querySelector('#droneMovementDetail').style.display = this.checked ? 'block' : 'none';
    };
    
    // Staggered idle entrances toggle
    designModal.querySelector('#droneStaggeredIdle').onchange = function() {
      AudioService?.setStaggeredIdleEntrances(this.checked);
    };
    const staggerCountSlider = designModal.querySelector('#staggerCountSlider');
    if (staggerCountSlider) {
      staggerCountSlider.oninput = function() {
        designModal.querySelector('#staggerCountValue').textContent = this.value;
        AudioService?.setStaggerCount(parseInt(this.value, 10));
      };
    }
    const staggerBarsSlider = designModal.querySelector('#staggerBarsSlider');
    if (staggerBarsSlider) {
      staggerBarsSlider.oninput = function() {
        designModal.querySelector('#staggerBarsValue').textContent = this.value + ' bars';
        AudioService?.setStaggerReshuffleBars(parseInt(this.value, 10));
      };
    }
    const drumDropoutEl = designModal.querySelector('#drumDropoutEnabled');
    if (drumDropoutEl) {
      drumDropoutEl.onchange = function() { AudioService?.setDrumDropoutEnabled(this.checked); };
    }
    const drumDropoutBarsSlider = designModal.querySelector('#drumDropoutBarsSlider');
    if (drumDropoutBarsSlider) {
      drumDropoutBarsSlider.oninput = function() {
        designModal.querySelector('#drumDropoutBarsValue').textContent = this.value + ' bars';
        AudioService?.setDrumDropoutBars(parseInt(this.value, 10));
      };
    }
    const drumFillStartSlider = designModal.querySelector('#drumFillStartSlider');
    if (drumFillStartSlider) {
      drumFillStartSlider.oninput = function() {
        designModal.querySelector('#drumFillStartValue').textContent = this.value + ' extra hats';
        AudioService?.setDrumFillStart(parseInt(this.value, 10));
      };
    }
    // Lead / arranger handlers
    const leadEnabledEl = designModal.querySelector('#leadEnabled');
    if (leadEnabledEl) {
      leadEnabledEl.onchange = async function() {
        const on = this.checked;
        const c = designModal.querySelector('#leadControls');
        if (c) c.style.opacity = on ? '1' : '0.5';
        await AudioService?.setLeadEnabled(on);
      };
    }
    const leadStyleSelect = designModal.querySelector('#leadStyleSelect');
    if (leadStyleSelect) leadStyleSelect.onchange = function() { AudioService?.setLeadStyle(this.value); };
    const leadEngineSelect = designModal.querySelector('#leadEngineSelect');
    if (leadEngineSelect) leadEngineSelect.onchange = async function() {
      await AudioService?.setLeadEngine(this.value);
      // Rebuild the variant selector for the newly selected engine.
      const vSel = designModal.querySelector('#leadVariantSelect');
      const vLbl = designModal.querySelector('#leadVariantLabel');
      if (vSel && vLbl) {
        const names = AudioService?.getLeadVariantNames?.(this.value) ?? ['default'];
        const labels = AudioService?.getLeadVariantLabels?.(this.value) ?? { default: 'Classic' };
        const cur = AudioService?.getLeadVariant?.(this.value) ?? 'default';
        vSel.innerHTML = names.map(v => `<option value="${v}" ${v === cur ? 'selected' : ''}>${labels[v] || v}</option>`).join('');
        const show = names.length > 1;
        vSel.style.display = show ? 'block' : 'none';
        vLbl.style.display = show ? 'flex' : 'none';
      }
    };
    const leadVariantSelect = designModal.querySelector('#leadVariantSelect');
    if (leadVariantSelect) leadVariantSelect.onchange = async function() {
      await AudioService?.setLeadVariant(this.value);
    };
    const leadEffectSelect = designModal.querySelector('#leadEffectSelect');
    if (leadEffectSelect) leadEffectSelect.onchange = async function() {
      await AudioService?.setLeadEffect(this.value);
    };
    designModal.querySelectorAll('input[name="leadMode"]').forEach(radio => {
      radio.onchange = function() { if (this.checked) AudioService?.setLeadMode(this.value); };
    });
    const leadPhraseBarsSlider = designModal.querySelector('#leadPhraseBarsSlider');
    if (leadPhraseBarsSlider) {
      leadPhraseBarsSlider.oninput = function() {
        designModal.querySelector('#leadPhraseBarsValue').textContent = this.value + ' bars';
        AudioService?.setLeadPhraseBars(parseInt(this.value, 10));
      };
    }
    const leadRestBarsSlider = designModal.querySelector('#leadRestBarsSlider');
    if (leadRestBarsSlider) {
      leadRestBarsSlider.oninput = function() {
        designModal.querySelector('#leadRestBarsValue').textContent = this.value + ' bars';
        AudioService?.setLeadRestBars(parseInt(this.value, 10));
      };
    }
    const leadIntroBarsSlider = designModal.querySelector('#leadIntroBarsSlider');
    if (leadIntroBarsSlider) {
      leadIntroBarsSlider.oninput = function() {
        designModal.querySelector('#leadIntroBarsValue').textContent = this.value + ' bars';
        AudioService?.setLeadIntroBars(parseInt(this.value, 10));
      };
    }
    const leadVolumeSlider = designModal.querySelector('#leadVolumeSlider');
    if (leadVolumeSlider) {
      leadVolumeSlider.oninput = function() {
        designModal.querySelector('#leadVolumeValue').textContent = this.value + 'dB';
        AudioService?.setLeadVolume(parseInt(this.value, 10));
      };
    }
    const leadFollowEl = designModal.querySelector('#leadFollowMovement');
    if (leadFollowEl) leadFollowEl.onchange = function() { AudioService?.setLeadFollowMovement(this.checked); };
    const leadFadeEl = designModal.querySelector('#leadFadeWhenStationary');
    if (leadFadeEl) leadFadeEl.onchange = function() { AudioService?.setLeadFadeWhenStationary(this.checked); };
    const leadAutoPairEl = designModal.querySelector('#leadAutoPair');
    if (leadAutoPairEl) leadAutoPairEl.onchange = function() { AudioService?.setLeadAutoPair(this.checked); };
    const leadNewMelodyBtn = designModal.querySelector('#leadNewMelodyBtn');
    if (leadNewMelodyBtn) leadNewMelodyBtn.onclick = function() { AudioService?.newLeadMelody?.(); };
    const leadNextSectionBtn = designModal.querySelector('#leadNextSectionBtn');
    if (leadNextSectionBtn) leadNextSectionBtn.onclick = function() { AudioService?.nextLeadSection?.(); };
    const octaveSwapEl = designModal.querySelector('#octaveSwapEnabled');
    if (octaveSwapEl) {
      octaveSwapEl.onchange = async function() { await AudioService?.setOctaveSwapEnabled(this.checked); };
    }
    const octaveSwapPeriodSlider = designModal.querySelector('#octaveSwapPeriodSlider');
    if (octaveSwapPeriodSlider) {
      octaveSwapPeriodSlider.oninput = function() {
        designModal.querySelector('#octaveSwapPeriodValue').textContent = this.value + ' bars';
        AudioService?.setOctaveSwapPeriodBars(parseInt(this.value, 10));
      };
    }
    const octaveSwapDurationSlider = designModal.querySelector('#octaveSwapDurationSlider');
    if (octaveSwapDurationSlider) {
      octaveSwapDurationSlider.oninput = function() {
        designModal.querySelector('#octaveSwapDurationValue').textContent = this.value + ' bars';
        AudioService?.setOctaveSwapDurationBars(parseInt(this.value, 10));
      };
    }
    
    // Per-octave instruments: master toggle
    designModal.querySelector('#perOctaveEnabled').onchange = async function() {
      const on = this.checked;
      const container = designModal.querySelector('#perOctaveControls');
      if (container) container.style.opacity = on ? '1' : '0.5';
      await AudioService?.setPerOctaveEnabled(on);
    };
    
    // Per-octave instruments: per-octave instrument selects. Scoped to
    // [data-octave] because #leadStyleSelect / #leadEngineSelect /
    // #drumKitSelect reuse the class for STYLING only - binding by bare
    // class here overwrote the lead handlers (bound earlier), so changing
    // lead style/voice silently called setOctaveInstrument(NaN, ...) instead.
    designModal.querySelectorAll('.octave-instrument-select[data-octave]').forEach(sel => {
      sel.onchange = async function() {
        const oct = parseInt(this.getAttribute('data-octave'), 10);
        await AudioService?.setOctaveInstrument(oct, this.value);
      };
    });
    
    // Retro drums handlers
    const drumEnabledEl = designModal.querySelector('#drumEnabled');
    if (drumEnabledEl) {
      drumEnabledEl.onchange = function() {
        const on = this.checked;
        const container = designModal.querySelector('#drumControls');
        if (container) container.style.opacity = on ? '1' : '0.5';
        AudioService?.setDrumEnabled(on);
      };
    }
    const drumKitSelect = designModal.querySelector('#drumKitSelect');
    if (drumKitSelect) {
      drumKitSelect.onchange = function() { AudioService?.setDrumKit(this.value); };
    }
    const drumVolumeSlider = designModal.querySelector('#drumVolumeSlider');
    if (drumVolumeSlider) {
      drumVolumeSlider.oninput = function() {
        designModal.querySelector('#drumVolumeValue').textContent = this.value + 'dB';
        AudioService?.setDrumVolume(parseInt(this.value, 10));
      };
    }
    const drumFollowEl = designModal.querySelector('#drumFollowMovement');
    if (drumFollowEl) {
      drumFollowEl.onchange = function() { AudioService?.setDrumFollowMovement(this.checked); };
    }
    const drumEvolveEl = designModal.querySelector('#drumEvolveEnabled');
    if (drumEvolveEl) {
      drumEvolveEl.onchange = function() { AudioService?.setDrumEvolveEnabled(this.checked); };
    }
    
    // Sub-bass tuning sliders (guarded; rebuild chains using sub-bass on change)
    const sbOctavesSlider = designModal.querySelector('#sbOctavesSlider');
    if (sbOctavesSlider) {
      sbOctavesSlider.oninput = function() {
        designModal.querySelector('#sbOctavesValue').textContent = this.value;
        AudioService?.setSubBassParam('octaves', parseFloat(this.value));
      };
    }
    const sbBaseFreqSlider = designModal.querySelector('#sbBaseFreqSlider');
    if (sbBaseFreqSlider) {
      sbBaseFreqSlider.oninput = function() {
        designModal.querySelector('#sbBaseFreqValue').textContent = this.value + 'Hz';
        AudioService?.setSubBassParam('baseFrequency', parseFloat(this.value));
      };
    }
    const sbAttackSlider = designModal.querySelector('#sbAttackSlider');
    if (sbAttackSlider) {
      sbAttackSlider.oninput = function() {
        designModal.querySelector('#sbAttackValue').textContent = this.value + 's';
        AudioService?.setSubBassParam('attack', parseFloat(this.value));
      };
    }
    const sbLpFreqSlider = designModal.querySelector('#sbLpFreqSlider');
    if (sbLpFreqSlider) {
      sbLpFreqSlider.oninput = function() {
        designModal.querySelector('#sbLpFreqValue').textContent = this.value + 'Hz';
        AudioService?.setSubBassParam('lpFreq', parseFloat(this.value));
      };
    }
    
    // Stationary start delay slider
    designModal.querySelector('#droneStationaryStartSlider').oninput = function() {
      designModal.querySelector('#droneStationaryStartValue').textContent = this.value + 's';
      const fadeMs = parseInt(designModal.querySelector('#droneStationaryFadeSlider').value) * 1000;
      AudioService?.setStationaryFadeTiming(parseInt(this.value) * 1000, fadeMs);
    };
    
    // Stationary fade duration slider
    designModal.querySelector('#droneStationaryFadeSlider').oninput = function() {
      designModal.querySelector('#droneStationaryFadeValue').textContent = this.value + 's';
      const startMs = parseInt(designModal.querySelector('#droneStationaryStartSlider').value) * 1000;
      AudioService?.setStationaryFadeTiming(startMs, parseInt(this.value) * 1000);
    };
    
    // ===== PATTERN EVOLUTION HANDLERS =====
    
    // Pattern evolution toggle
    const patternEvolutionCheckbox = designModal.querySelector('#patternEvolutionEnabled');
    if (patternEvolutionCheckbox) {
      patternEvolutionCheckbox.onchange = function() {
        AudioService?.setPatternEvolutionEnabled(this.checked);
        designModal.querySelector('#patternEvolutionDetail').style.display = this.checked ? 'block' : 'none';
      };
    }
    
    // Pattern evolution bars slider
    const patternEvoBarsSlider = designModal.querySelector('#patternEvolutionBarsSlider');
    if (patternEvoBarsSlider) {
      patternEvoBarsSlider.oninput = function() {
        designModal.querySelector('#patternEvolutionBarsValue').textContent = this.value + ' bars';
        AudioService?.setPatternEvolutionBars(parseInt(this.value));
      };
    }
    
    // Octave selection mode buttons
    const octaveSelAdjacentBtn = designModal.querySelector('#octaveSelAdjacent');
    const octaveSelRandomBtn = designModal.querySelector('#octaveSelRandom');
    if (octaveSelAdjacentBtn && octaveSelRandomBtn) {
      octaveSelAdjacentBtn.onclick = function() {
        AudioService?.setOctaveSelectionMode('adjacent');
        this.classList.add('active');
        octaveSelRandomBtn.classList.remove('active');
      };
      octaveSelRandomBtn.onclick = function() {
        AudioService?.setOctaveSelectionMode('random');
        this.classList.add('active');
        octaveSelAdjacentBtn.classList.remove('active');
      };
    }
    
    // Max melodic octaves slider
    const maxMelodicOctavesSlider = designModal.querySelector('#maxMelodicOctavesSlider');
    if (maxMelodicOctavesSlider) {
      maxMelodicOctavesSlider.oninput = function() {
        designModal.querySelector('#maxMelodicOctavesValue').textContent = this.value;
        AudioService?.setMaxMelodicOctaves(parseInt(this.value));
      };
    }
    
    // Max pattern bars slider
    const maxPatternBarsSlider = designModal.querySelector('#maxPatternBarsSlider');
    if (maxPatternBarsSlider) {
      maxPatternBarsSlider.oninput = function() {
        designModal.querySelector('#maxPatternBarsValue').textContent = this.value + ' bars';
        AudioService?.setMaxPatternBars(parseInt(this.value));
      };
    }
    
    // Beat align notes checkbox
    const beatAlignCheckbox = designModal.querySelector('#beatAlignNotes');
    if (beatAlignCheckbox) {
      beatAlignCheckbox.onchange = function() {
        AudioService?.setBeatAlignNotes(this.checked);
      };
    }
    
    // Reset anchor octave slider
    const resetAnchorSlider = designModal.querySelector('#resetAnchorOctaveSlider');
    if (resetAnchorSlider) {
      resetAnchorSlider.oninput = function() {
        designModal.querySelector('#resetAnchorOctaveValue').textContent = this.value;
        AudioService?.setResetAnchorOctave(parseInt(this.value));
      };
    }
    
    // Reset patterns button
    const resetPatternsBtn = designModal.querySelector('#resetPatternsBtn');
    if (resetPatternsBtn) {
      resetPatternsBtn.onclick = function() {
        AudioService?.resetPatternsToDefault();
        // Show brief feedback
        this.textContent = '✓ Reset!';
        this.style.borderColor = 'rgba(0,255,0,0.5)';
        this.style.color = '#afa';
        setTimeout(() => {
          this.textContent = '↺ Reset to Whole Notes';
          this.style.borderColor = 'rgba(255,150,0,0.5)';
          this.style.color = '#ffa';
        }, 1500);
      };
    }
    
    // Journey logarithmic crossfade toggle
    designModal.querySelector('#journeyLogCrossfade').onchange = function() {
      AudioService?.setJourneyCrossfadeLogarithmic(this.checked);
    };
    
    // Pattern refresh (still editable)
    designModal.querySelector('#refreshSlider').oninput = function() {
      designModal.querySelector('#refreshValue').textContent = this.value + ' bars';
      AudioService?.setPatternRefreshBars(parseInt(this.value));
    };
    
    // Acceleration sensitivity (still editable)
    designModal.querySelector('#accelSlider').oninput = function() {
      designModal.querySelector('#accelValue').textContent = this.value + '%';
      AudioService?.setAccelerationSensitivity(parseInt(this.value) / 100);
    };
    
    // Transpose controls (still editable)
    const transposeSlider = designModal.querySelector('#transposeSlider');
    const updateTranspose = (val) => {
      designModal.querySelector('#transposeValue').textContent = (val >= 0 ? '+' : '') + val + ' oct';
      AudioService?.setTranspose(val);
    };
    
    transposeSlider.oninput = () => updateTranspose(parseInt(transposeSlider.value));
    designModal.querySelector('#transposeDown').onclick = () => {
      const val = Math.max(-3, parseInt(transposeSlider.value) - 1);
      transposeSlider.value = val;
      updateTranspose(val);
    };
    designModal.querySelector('#transposeUp').onclick = () => {
      const val = Math.min(3, parseInt(transposeSlider.value) + 1);
      transposeSlider.value = val;
      updateTranspose(val);
    };
    
    // Master volume (still editable)
    designModal.querySelector('#volumeSlider').oninput = function() {
      designModal.querySelector('#volumeValue').textContent = this.value + ' dB';
      AudioService?.setMasterVolume(parseFloat(this.value));
    };
    
    // Octave controls
    designModal.querySelectorAll('.octave-row').forEach(row => {
      const octave = parseInt(row.dataset.octave);
      
      row.querySelector('.intensity-slider').oninput = function() {
        row.querySelector('.intensity-value').textContent = this.value + 'dB';
        AudioService?.setOctaveIntensity(octave, parseInt(this.value));
      };
      
      row.querySelector('.fraction-slider').oninput = function() {
        row.querySelector('.fraction-value').textContent = this.value;
        AudioService?.setOctaveUpdateFraction(octave, parseInt(this.value));
      };
    });
    
    // Close button
    designModal.querySelector('#designClose').onclick = () => {
      clearInterval(gpsStatusInterval);
      // Disable test mode when closing
      AudioService?.setTestMode(false);
      designModal.remove();
      designModal = null;
    };
    
    // Pocket mode button
    const pocketModeBtn = designModal.querySelector('#pocketModeBtn');
    if (pocketModeBtn) {
      pocketModeBtn.onclick = () => {
        if (typeof PocketMode !== 'undefined') {
          // Close the modal first
          clearInterval(gpsStatusInterval);
          designModal.remove();
          designModal = null;
          // Then enable pocket mode
          PocketMode.enable();
        } else {
          console.warn('[AudioUI] PocketMode not loaded');
          alert('Pocket mode not available. Make sure pocket-mode.js is loaded.');
        }
      };
    }
    
    // Test play button - enable test mode to bypass GPS freshness
    designModal.querySelector('#designPlay').onclick = async () => {
      const btn = designModal.querySelector('#designPlay');
      if (AudioService?.isPlaying) {
        AudioService.setTestMode(false);
        AudioService.stop();
        btn.textContent = '▶ Test';
      } else {
        AudioService?.setTestMode(true);
        await AudioService?.play();
        // Play a realistic music code: 8 groups = octaves 1-8
        AudioService?.setMusicalCode('CEG,CEG,CEG,CEG,CEG,CEG,CEG,CEG,');
        btn.textContent = '⏹ Stop';
      }
    };
    
    // Click outside to close
    designModal.onclick = (e) => {
      if (e.target === designModal) {
        clearInterval(gpsStatusInterval);
        designModal.remove();
        designModal = null;
      }
    };
    
    // GPS status updater
    const gpsStatusInterval = setInterval(() => {
      if (!designModal) {
        clearInterval(gpsStatusInterval);
        return;
      }
      
      const dot = designModal.querySelector('.gps-dot');
      const text = designModal.querySelector('.gps-text');
      
      if (AudioService?.isGPSFresh()) {
        dot.className = 'gps-dot fresh';
        const accel = AudioService.getAcceleration();
        const accelText = accel > 0.1 ? '↑' : accel < -0.1 ? '↓' : '→';
        text.textContent = `GPS: Fresh ${accelText}`;
      } else {
        dot.className = 'gps-dot stale';
        text.textContent = 'GPS: Stale (no new notes)';
      }
      
      // Update journey progress if active
      updateJourneyDisplay();
      
      // Update crossfade UI (disabled during journey, show current position)
      updateCrossfadeUI();
      if (window.JourneyService?.isActive() && AudioService) {
        const xfade = AudioService.getCrossfade();
        crossfadeSlider.value = Math.round(xfade * 100);
        designModal.querySelector('#crossfadeValue').textContent = Math.round(xfade * 100) + '%';
      }
      
      // Per-octave instruments deferral status
      const poStatus = designModal.querySelector('#perOctaveStatus');
      const poContainer = designModal.querySelector('#perOctaveControls');
      if (poStatus && AudioService?.getPerOctaveEnabled?.()) {
        const journeyOn = window.JourneyService?.isActive?.();
        const xfade = AudioService.getCrossfade?.() ?? 0;
        const midCrossfade = xfade > 0.01 && xfade < 0.99;
        if (journeyOn || midCrossfade) {
          poStatus.textContent = '⏸ deferring to journey/crossfade — using A/B';
          if (poContainer) poContainer.style.opacity = '0.4';
        } else {
          poStatus.textContent = '● active';
          if (poContainer) poContainer.style.opacity = '1';
        }
      } else if (poStatus) {
        poStatus.textContent = '';
      }
    }, 500);
    
    // Journey UI functions
    function updateJourneyDisplay() {
      const JourneyService = window.JourneyService;
      if (!JourneyService) {
        designModal.querySelector('#journeyStatus').textContent = 'Load journey-service.js to enable';
        return;
      }
      
      const statusEl = designModal.querySelector('#journeyStatus');
      const activeEl = designModal.querySelector('#journeyActive');
      
      if (JourneyService.isActive()) {
        const journeyName = JourneyService.getActiveJourney();
        const journey = JourneyService.getJourney(journeyName);
        
        statusEl.textContent = `Active: ${journeyName}`;
        activeEl.style.display = 'block';
        
        // Get current coordinate from AppState if available
        if (window.AppState) {
          const coord = window.AppState.get('coordinate');
          if (coord && coord.lat !== null) {
            const progress = JourneyService.getProgress(coord.lat, coord.lon);
            if (progress) {
              designModal.querySelector('#journeyProgressFill').style.width = 
                `${progress.totalProgress * 100}%`;
              
              // Update waypoint indicators
              const waypointsEl = designModal.querySelector('#journeyWaypoints');
              waypointsEl.innerHTML = journey.waypoints.map((wp, i) => {
                const isPassed = i < progress.segment;
                const isActive = i === progress.segment || i === progress.segment + 1;
                return `<div class="journey-waypoint ${isPassed ? 'passed' : ''} ${isActive ? 'active' : ''}">${wp.label || i + 1}</div>`;
              }).join('');
            }
          }
        }
      } else {
        statusEl.textContent = 'No active journey';
        activeEl.style.display = 'none';
      }
    }
    
    function showJourneyModal(mode = 'new', existingJourney = null) {
      const JourneyService = window.JourneyService;
      if (!JourneyService) {
        alert('JourneyService not loaded. Add this to your HTML:\n\n<script src="js/services/journey-service.js"></script>');
        return;
      }
      
      const modal = document.createElement('div');
      modal.className = 'journey-modal';
      modal.id = 'journeyEditModal';
      
      const presets = AudioService?.getPresets() || [];
      const presetOptions = presets.map(p => `<option value="${p}">${p}</option>`).join('');
      
      const savedWaypoints = JourneyService.getAllSavedWaypoints();
      const savedWaypointNames = Object.keys(savedWaypoints);
      
      const isEdit = mode === 'edit' && existingJourney;
      const journey = isEdit ? JourneyService.getJourney(existingJourney) : null;
      
      modal.innerHTML = `
        <div class="journey-modal-content">
          <div class="journey-modal-title">${isEdit ? '✏️ Edit' : '➕ New'} Sound Journey</div>
          
          <div class="audio-design-label">
            <span>Journey Name</span>
          </div>
          <input type="text" id="journeyName" value="${journey?.name || ''}" 
                 placeholder="e.g., Morning Commute" 
                 style="width:100%;padding:10px;background:#111;border:1px solid #333;color:#fff;border-radius:6px;margin-bottom:16px;font-size:16px;">
          
          ${savedWaypointNames.length === 0 ? `
            <div style="background:rgba(255,200,0,0.1);border:1px solid rgba(255,200,0,0.3);padding:12px;border-radius:8px;margin-bottom:16px;">
              <div style="color:#fc0;font-weight:bold;margin-bottom:4px;">📍 No saved waypoints yet!</div>
              <div style="color:#aa8;font-size:12px;">Save locations from the Music card using the 📌 button in the header, then come back here to build your journey.</div>
            </div>
          ` : `
            <div class="audio-design-label" style="margin-bottom:8px;">
              <span>Waypoints</span>
              <button id="addWaypointBtn" style="background:cyan;color:#000;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-weight:bold;">+ Add</button>
            </div>
            
            <div id="waypointsList" style="margin-bottom:16px;">
              ${isEdit ? journey.waypoints.map((wp, i) => createWaypointHTML(i, wp, presetOptions, savedWaypoints)).join('') : ''}
            </div>
            
            ${!isEdit ? `<div style="color:#888;font-size:12px;margin-bottom:12px;">Add waypoints from your saved locations to build your journey route.</div>` : ''}
          `}
          
          <div class="audio-design-btns">
            <button class="audio-design-btn secondary" id="journeyCancel">Cancel</button>
            ${savedWaypointNames.length > 0 ? `<button class="audio-design-btn primary" id="journeySave">${isEdit ? 'Update' : 'Create'} Journey</button>` : ''}
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      
      function createWaypointHTML(index, wp, presetOptions, savedWps) {
        const savedOptions = Object.entries(savedWps).map(([name, data]) => {
          const isSelected = (Math.abs(data.lat - wp.lat) < 0.0001 && Math.abs(data.lon - wp.lon) < 0.0001);
          return `<option value="${name}" ${isSelected ? 'selected' : ''}>${name} (${data.lat.toFixed(4)}, ${data.lon.toFixed(4)})</option>`;
        }).join('');
        
        return `
          <div class="waypoint-item" data-index="${index}">
            <div class="waypoint-number">${index + 1}</div>
            <div class="waypoint-info" style="flex:1;">
              <select class="waypoint-location-select" style="width:100%;padding:8px;background:#1a1a2e;border:1px solid cyan;color:cyan;border-radius:4px;margin-bottom:6px;font-size:13px;">
                <option value="">-- Select saved location --</option>
                ${savedOptions}
              </select>
              <div style="display:flex;gap:6px;align-items:center;">
                <span style="color:#666;font-size:11px;">Sound:</span>
                <select class="waypoint-preset" style="flex:1;padding:6px;background:#222;border:1px solid #444;color:cyan;border-radius:4px;font-size:12px;">
                  ${presetOptions.replace(`value="${wp.preset}"`, `value="${wp.preset}" selected`)}
                </select>
              </div>
            </div>
            <button class="waypoint-remove" title="Remove waypoint" 
                    style="background:#333;border:1px solid #553333;color:#f88;padding:8px 12px;border-radius:4px;cursor:pointer;font-size:14px;margin-left:8px;">🗑️</button>
          </div>
        `;
      }
      
      function updateWaypointNumbers() {
        modal.querySelectorAll('.waypoint-item').forEach((item, i) => {
          item.dataset.index = i;
          item.querySelector('.waypoint-number').textContent = i + 1;
        });
      }
      
      // Add waypoint button
      const addBtn = modal.querySelector('#addWaypointBtn');
      if (addBtn) {
        addBtn.onclick = () => {
          const list = modal.querySelector('#waypointsList');
          const count = list.querySelectorAll('.waypoint-item').length;
          list.insertAdjacentHTML('beforeend', createWaypointHTML(count, { preset: presets[0] }, presetOptions, savedWaypoints));
          updateWaypointNumbers();
          attachWaypointHandlers();
        };
      }
      
      function attachWaypointHandlers() {
        // Remove waypoint buttons
        modal.querySelectorAll('.waypoint-remove').forEach(btn => {
          btn.onclick = () => {
            const list = modal.querySelector('#waypointsList');
            if (list.querySelectorAll('.waypoint-item').length > 2) {
              btn.closest('.waypoint-item').remove();
              updateWaypointNumbers();
            } else if (list.querySelectorAll('.waypoint-item').length <= 2) {
              btn.closest('.waypoint-item').remove();
              updateWaypointNumbers();
            }
          };
        });
      }
      
      attachWaypointHandlers();
      
      // Cancel button
      modal.querySelector('#journeyCancel').onclick = () => modal.remove();
      
      // Save button
      const saveBtn = modal.querySelector('#journeySave');
      if (saveBtn) {
        saveBtn.onclick = () => {
          const name = modal.querySelector('#journeyName').value.trim();
          if (!name) {
            alert('Please enter a journey name');
            return;
          }
          
          const waypoints = [];
          let hasErrors = false;
          
          modal.querySelectorAll('.waypoint-item').forEach((item, i) => {
            const locationSelect = item.querySelector('.waypoint-location-select');
            const selectedWaypointName = locationSelect?.value;
            const preset = item.querySelector('.waypoint-preset').value;
            
            if (!selectedWaypointName) {
              hasErrors = true;
              locationSelect.style.borderColor = '#f44';
              return;
            }
            
            const savedWp = savedWaypoints[selectedWaypointName];
            if (savedWp) {
              waypoints.push({
                lat: savedWp.lat,
                lon: savedWp.lon,
                label: selectedWaypointName,
                preset
              });
              locationSelect.style.borderColor = 'cyan';
            }
          });
          
          if (hasErrors) {
            alert('Please select a location for all waypoints');
            return;
          }
          
          if (waypoints.length < 2) {
            alert('Journey needs at least 2 waypoints. Add more waypoints using the + Add button.');
            return;
          }
          
          if (isEdit) {
            JourneyService.updateJourney(name, waypoints);
          } else {
            JourneyService.createJourney(name, waypoints);
          }
          
          modal.remove();
          updateJourneyDisplay();
          
          // Show confirmation toast
          const toast = document.createElement('div');
          toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(0,255,255,0.9);color:#000;padding:12px 24px;border-radius:8px;z-index:10003;font-weight:bold;';
          toast.textContent = `Journey "${name}" ${isEdit ? 'updated' : 'created'}!`;
          document.body.appendChild(toast);
          setTimeout(() => toast.remove(), 2000);
        };
      }
      
      // Click outside to close
      modal.onclick = (e) => {
        if (e.target === modal) modal.remove();
      };
    }
    
    function showJourneyManageModal() {
      const JourneyService = window.JourneyService;
      if (!JourneyService) {
        alert('JourneyService not loaded. Add this to your HTML:\n\n<script src="js/services/journey-service.js"></script>');
        return;
      }
      
      const modal = document.createElement('div');
      modal.className = 'journey-modal';
      
      const journeyNames = JourneyService.getJourneyNames();
      const activeJourney = JourneyService.getActiveJourney();
      
      modal.innerHTML = `
        <div class="journey-modal-content">
          <div class="journey-modal-title">📋 Manage Journeys</div>
          
          <div id="journeyList" style="margin-bottom:12px;">
            ${journeyNames.length === 0 ? '<div style="color:#888;text-align:center;padding:20px;">No journeys yet</div>' :
              journeyNames.map(name => {
                const journey = JourneyService.getJourney(name);
                const distance = JourneyService.getJourneyDistance(name);
                const isActive = name === activeJourney;
                return `
                  <div class="waypoint-item" style="${isActive ? 'border:1px solid cyan;' : ''}">
                    <div class="waypoint-info">
                      <div class="waypoint-label">${name} ${isActive ? '(Active)' : ''}</div>
                      <div class="waypoint-coords">${journey.waypoints.length} waypoints • ${(distance/1000).toFixed(1)} km</div>
                    </div>
                    <div style="display:flex;gap:4px;">
                      ${!isActive ? `<button class="journey-start-btn" data-name="${name}" style="background:cyan;color:#000;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;">▶</button>` : ''}
                      <button class="journey-edit-btn" data-name="${name}" style="background:#333;border:none;color:#fff;padding:4px 8px;border-radius:4px;cursor:pointer;">✏️</button>
                      <button class="journey-delete-btn" data-name="${name}" style="background:#333;border:none;color:#f88;padding:4px 8px;border-radius:4px;cursor:pointer;">🗑️</button>
                    </div>
                  </div>
                `;
              }).join('')}
          </div>
          
          <div class="audio-design-btns">
            <button class="audio-design-btn secondary" id="manageClose">Close</button>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      
      // Start journey buttons
      modal.querySelectorAll('.journey-start-btn').forEach(btn => {
        btn.onclick = () => {
          JourneyService.startJourney(btn.dataset.name);
          modal.remove();
          updateJourneyDisplay();
        };
      });
      
      // Edit journey buttons
      modal.querySelectorAll('.journey-edit-btn').forEach(btn => {
        btn.onclick = () => {
          modal.remove();
          showJourneyModal('edit', btn.dataset.name);
        };
      });
      
      // Delete journey buttons
      modal.querySelectorAll('.journey-delete-btn').forEach(btn => {
        btn.onclick = () => {
          if (confirm(`Delete journey "${btn.dataset.name}"?`)) {
            JourneyService.deleteJourney(btn.dataset.name);
            modal.remove();
            showJourneyManageModal(); // Refresh
          }
        };
      });
      
      modal.querySelector('#manageClose').onclick = () => modal.remove();
      modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    }
    
    // Journey button handlers
    designModal.querySelector('#journeyNewBtn').onclick = () => showJourneyModal('new');
    designModal.querySelector('#journeyManageBtn').onclick = () => showJourneyManageModal();
    designModal.querySelector('#journeyStopBtn').onclick = () => {
      window.JourneyService?.stopJourney();
      updateJourneyDisplay();
    };
  }

  // ============== PUBLIC API ==============

  const AudioUI = {
    /**
     * Initialize with app state
     * @param {Object} appState - AppState instance
     */
    init(appState) {
      injectStyles();
      state = appState;
      
      if (state) {
        state.subscribe('coordinate', () => {
          updateNotesFromCurrentLocation();
        });
        
        const savedVolume = state.get('audio.volume');
        if (savedVolume !== null && global.AudioService) {
          global.AudioService.setVolume(savedVolume);
        }
      }
    },

    /**
     * Create a speaker button for a card header
     * @param {string} gridKey - The grid key (should be 'music')
     * @returns {HTMLElement} Button element
     */
    createSpeakerButton,

    /**
     * Attach speaker button to an existing card element
     * @param {HTMLElement} cardElement - Card container
     * @param {string} gridKey - Grid key
     */
    attachToCard(cardElement, gridKey) {
      if (gridKey !== 'music') return;
      
      const header = cardElement.querySelector('.card-header, .card-title, [class*="header"]');
      if (header) {
        const btn = createSpeakerButton(gridKey);
        header.appendChild(btn);
      }
    },

    /**
     * Create full controls panel
     * @returns {HTMLElement} Controls panel element
     */
    createControlsPanel,

    /**
     * Show/hide controls panel
     * @param {HTMLElement} panel - Panel from createControlsPanel()
     * @param {boolean} visible
     */
    toggleControlsPanel(panel, visible) {
      panel.classList.toggle('visible', visible);
    },

    /**
     * Update notes display from current location
     */
    updateFromLocation: updateNotesFromCurrentLocation,

    /**
     * Check if audio is currently playing
     * @returns {boolean}
     */
    get isPlaying() {
      return global.AudioService?.isPlaying || false;
    },

    /**
     * Start playback
     */
    async play() {
      if (global.AudioService) {
        await global.AudioService.play();
        updateAllButtons(true);
        updateNotesFromCurrentLocation();
      }
    },

    /**
     * Stop playback
     */
    stop() {
      if (global.AudioService) {
        global.AudioService.stop();
        updateAllButtons(false);
      }
    },

    /**
     * Show the sound design modal
     */
    showSoundDesign: showSoundDesignModal,

    /**
     * Switch music card between VexFlow staff and piano roll
     * @param {'staff'|'roll'} view
     */
    switchMusicCardView
  };

  // ============== EXPORT ==============

  global.AudioUI = AudioUI;

  /**
   * Create a "Save Waypoint" button for adding to card headers
   * Call this to get a button that saves the current location as a waypoint
   * @returns {HTMLButtonElement}
   */
  global.createWaypointButton = function() {
    const btn = document.createElement('button');
    btn.className = 'waypoint-save-btn';
    btn.innerHTML = '📌';
    btn.title = 'Save this location as a waypoint';
    btn.style.cssText = 'background:#4a5568;border:none;color:#fff;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:16px;';
    
    btn.onclick = (e) => {
      e.stopPropagation();
      
      const JourneyService = window.JourneyService;
      if (!JourneyService) {
        alert('JourneyService not loaded');
        return;
      }
      
      // Get current coordinate
      let coord = null;
      if (window.AppState) {
        coord = window.AppState.get('coordinate');
      } else if (window.currentCardCoord) {
        coord = window.currentCardCoord;
      }
      
      if (!coord || coord.lat === null || coord.lat === undefined) {
        alert('No location available to save');
        return;
      }
      
      // Get current preset if available
      const currentPreset = window.AudioService?.getSoundParams()?.preset || 'crystal';
      
      // Prompt for name
      const name = prompt('Name this waypoint:', '');
      if (!name || !name.trim()) return;
      
      const trimmedName = name.trim();
      
      // Check if exists
      if (JourneyService.getWaypoint(trimmedName)) {
        if (!confirm(`Waypoint "${trimmedName}" already exists. Overwrite?`)) {
          return;
        }
      }
      
      // Save it
      if (JourneyService.saveWaypoint(trimmedName, coord.lat, coord.lon, currentPreset)) {
        // Show toast
        const toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);background:rgba(0,255,0,0.9);color:#000;padding:12px 24px;border-radius:8px;z-index:10003;font-weight:bold;';
        toast.textContent = `📌 Saved "${trimmedName}"`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
      } else {
        alert('Failed to save waypoint');
      }
    };
    
    return btn;
  };

  console.log('[geosonify] audio-ui v3.6 loaded (lead composer controls)');

})(typeof window !== 'undefined' ? window : this);
