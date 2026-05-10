/**
 * geosonify-piano-roll.js v1.0
 * 
 * Piano roll display for the music card.
 * Subscribes to AudioService note events and renders a scrolling
 * visualization of notes as they play.
 * 
 * Features:
 * - Compact view: collapsed y-axis showing only active notePool pitches
 * - Expanded view: full chromatic range, scrollable
 * - Ghost slots: dashed blocks when pattern expects note but pool is short
 * - GPS change markers: vertical line when notePool changes
 * - Y-axis updates live from notePool at playhead position
 * - Designed for future MIDI output (same event bus)
 * 
 * Usage:
 *   PianoRoll.init({ container, AudioService });
 *   PianoRoll.show();   // Switch from VexFlow to piano roll
 *   PianoRoll.hide();   // Switch back to VexFlow
 *   PianoRoll.destroy(); // Cleanup listeners
 */

(function(global) {
  'use strict';

  const __PIANO_ROLL_VER__ = 'v1.0';
  try { console.log('[geosonify] piano-roll ' + __PIANO_ROLL_VER__ + ' loaded'); } catch(e) {}

  // ============== CONSTANTS ==============

  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const BLACK = new Set([1, 3, 6, 8, 10]);
  const toMidi = (name, octave) => (octave + 1) * 12 + SEMI[name];

  // Sort note names by pitch (C D E F G A B) rather than alphabetically (A B C D E F G)
  function pitchSort(a, b) { return SEMI[a] - SEMI[b]; }

  /**
   * Map an alphabetical slot index to a pitch-ordered row position.
   * AudioService sorts notes alphabetically: [A, B, C, D, E, F, G]
   * Display should order by pitch: [C, D, E, F, G, A, B]
   * 
   * Given the notes in an octave (e.g. ["D", "F", "B"]):
   *   Alphabetical order: B=0, D=1, F=2  (what mapSlotToNote uses)
   *   Pitch order:        D=0, F=1, B=2  (what the display should show)
   * 
   * Returns a mapping: alphabeticalSlot -> pitchRow
   */
  function buildSlotToPitchRow(notes) {
    if (!notes || notes.length === 0) return {};
    const alpha = [...notes].sort(); // Alphabetical — matches mapSlotToNote
    const pitch = [...notes].sort(pitchSort); // Pitch order — for display
    const map = {};
    for (let i = 0; i < alpha.length; i++) {
      // alpha[i] is what slot i resolves to; find its position in pitch order
      map[i] = pitch.indexOf(alpha[i]);
    }
    return map;
  }

  // Kereru palette
  const K = {
    teal: '#325756', blue: '#7d9fc2', pink: '#C582B2',
    green: '#51806a', purple: '#4d5f8e', lavender: '#A092B7',
  };

  const OCT_COLORS = [
    K.green, K.blue, '#6b8db5', K.pink, K.lavender, K.purple, K.teal,
    '#5a8a7a', '#8a7db5', '#b57d8a', // extra for octaves 8-10
  ];

  // ============== STATE ==============

  let audioService = null;
  let container = null;       // The .music-pianoroll div
  let svgEl = null;
  let rafId = null;
  let isVisible = false;
  let isExpanded = false;

  // Ring buffer of recent note events — stored by note name + octave
  const MAX_HISTORY = 300;
  let noteHistory = [];       // { octave, noteName, absoluteBeat, duration, color, time }

  // Current notePool (updated via listener)
  let currentPool = [];
  
  // Number of octaves (set on first pool, never shrinks)
  let numOctaves = 0;

  // GPS change markers (absolute beat positions where pool changed)
  let poolChangeBeats = [];   // [{ beat, time }]

  // Display settings
  const SLOTS_PER_OCTAVE = 3;
  const VISIBLE_BEATS = 16;
  const PLAYHEAD_FRACTION = 0.75;
  const ROW_H = 8;
  const NOTE_FADE_BEATS = 16;

  // ============== NOTE EVENT HANDLER ==============

  let noteEventReceiveCount = 0;

  function onNoteEvent(event) {
    if (!isVisible) return;

    if (noteEventReceiveCount < 3) {
      console.log('[PianoRoll] onNoteEvent:', event.note, 'oct:', event.octave, 'history:', noteHistory.length);
      noteEventReceiveCount++;
    }

    // Need octave from event meta
    const octave = event.octave;
    if (octave === undefined) return;
    
    // Parse note name
    const match = event.note.match(/([A-Ga-g][#b]?)/);
    const noteName = match ? match[1].toUpperCase() : '?';

    // Convert duration from seconds to beats
    const bpm = audioService.getSoundParams?.()?.A?.bpm || 100;
    const beatDuration = typeof event.duration === 'number'
      ? event.duration / (60 / bpm)
      : 1;

    const absoluteBeat = event.bar * 4 + event.beat;

    noteHistory.push({
      octave,
      noteName,
      absoluteBeat,
      duration: beatDuration,
      color: OCT_COLORS[octave] || K.lavender,
      time: Date.now(),
    });

    if (noteHistory.length > MAX_HISTORY) {
      noteHistory = noteHistory.slice(-MAX_HISTORY);
    }
  }

  function onPoolChange(newPool) {
    const oldPool = currentPool;
    currentPool = newPool;

    // Grow octave count if needed (never shrinks)
    if (newPool.length > numOctaves) {
      numOctaves = newPool.length;
    }

    // Record GPS change marker
    if (audioService && isVisible) {
      const bar = audioService.getCurrentBar();
      const beat = audioService.getCurrentBeat();
      const absoluteChangeBeat = bar * 4 + beat;

      const oldStr = oldPool.map(a => (a || []).join('')).join(',');
      const newStr = newPool.map(a => (a || []).join('')).join(',');
      if (oldStr !== newStr && oldStr !== '') {
        poolChangeBeats.push({ beat: absoluteChangeBeat, time: Date.now() });
      }
    }
  }

  // ============== RENDER (scrolling, slot-based) ==============

  let renderCount = 0;

  function render() {
    if (!isVisible || !container || !audioService) {
      if (renderCount < 3) console.log('[PianoRoll] render bail:', { isVisible, hasContainer: !!container, hasAudio: !!audioService });
      return;
    }

    const rect = container.getBoundingClientRect();
    const W = rect.width || container.clientWidth || container.offsetWidth;

    renderCount++;

    if (W < 10) {
      rafId = requestAnimationFrame(render);
      return;
    }

    // Current absolute playhead
    const bar = audioService.getCurrentBar();
    const beat = audioService.getCurrentBeat();
    const nowBeat = bar * 4 + beat;
    const now = Date.now();

    // Get current pool for labels
    const pool = currentPool.length > 0 ? currentPool : audioService.getNotePool();
    if (pool.length > numOctaves) numOctaves = pool.length;

    // Fixed row count: octaves × 3 slots
    const totalRows = numOctaves * SLOTS_PER_OCTAVE;

    if (renderCount <= 5) {
      console.log('[PianoRoll] render #' + (renderCount - 1), { W, octaves: numOctaves, rows: totalRows, history: noteHistory.length });
    }

    if (totalRows === 0) {
      ensureSVG(W, 40);
      svgEl.innerHTML = '<text x="' + (W/2) + '" y="20" text-anchor="middle" fill="rgba(255,255,255,0.3)" font-size="12" font-family="\'SF Mono\', monospace">No notes</text>';
      rafId = requestAnimationFrame(render);
      return;
    }

    // Dynamic row height: use at least ROW_H, but expand to fill container if it's taller
    const H = rect.height || container.clientHeight || container.offsetHeight;
    const minGH = ROW_H * totalRows;
    const rowH = H > minGH ? Math.floor(H / totalRows) : ROW_H;
    const KW = rowH > 12 ? 42 : 32; // Wider label area in fullscreen
    const gW = W - KW;
    const gH = rowH * totalRows;
    const labelFontSize = Math.min(14, Math.max(7, rowH - 2));
    const pixelsPerBeat = gW / VISIBLE_BEATS;
    const phX = KW + gW * PLAYHEAD_FRACTION;

    function beatToX(absBeat) {
      return phX + (absBeat - nowBeat) * pixelsPerBeat;
    }

    // Build per-octave pitch-sorted note lists for row mapping
    // Within each octave group, row 0 (bottom) = lowest pitch, row 2 (top) = highest
    const octPitchLists = [];
    for (let oct = 0; oct < numOctaves; oct++) {
      octPitchLists[oct] = pool[oct] ? [...new Set(pool[oct])].sort(pitchSort) : [];
    }

    // Map a note name + octave to a display row
    // Uses pitch position within that octave's pool
    function noteToRow(octave, noteName) {
      const pitchList = octPitchLists[octave] || [];
      let pitchIdx = pitchList.indexOf(noteName);
      if (pitchIdx < 0) {
        // Note not in current pool (historical) — find where it would go by pitch
        const withNote = [...pitchList, noteName].sort(pitchSort);
        pitchIdx = withNote.indexOf(noteName);
        // Clamp to valid slot range
        pitchIdx = Math.min(pitchIdx, SLOTS_PER_OCTAVE - 1);
      }
      return totalRows - 1 - (octave * SLOTS_PER_OCTAVE + pitchIdx);
    }

    // Simple row index for backgrounds/grid (no note needed)
    function octSlotToRow(octave, slot) {
      return totalRows - 1 - (octave * SLOTS_PER_OCTAVE + slot);
    }

    // Build SVG
    let svg = '';

    // Defs
    svg += '<defs>';
    svg += '<filter id="prglow"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
    svg += '<clipPath id="gridclip"><rect x="' + KW + '" y="0" width="' + gW + '" height="' + gH + '"/></clipPath>';
    svg += '</defs>';

    // Row backgrounds — alternate octaves for visual grouping
    for (let oct = 0; oct < numOctaves; oct++) {
      for (let slot = 0; slot < SLOTS_PER_OCTAVE; slot++) {
        const row = octSlotToRow(oct, slot);
        const isOddOctave = oct % 2 === 1;
        if (isOddOctave) {
          svg += '<rect x="' + KW + '" y="' + (row * rowH) + '" width="' + gW + '" height="' + rowH + '" fill="rgba(255,255,255,0.02)"/>';
        }
      }
    }

    // Horizontal grid lines — thicker at octave boundaries
    for (let i = 0; i <= totalRows; i++) {
      const isOctaveBoundary = i % SLOTS_PER_OCTAVE === 0;
      svg += '<line x1="' + KW + '" y1="' + (i * rowH) + '" x2="' + W + '" y2="' + (i * rowH) + '" stroke="' + (isOctaveBoundary ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)') + '" stroke-width="' + (isOctaveBoundary ? 0.75 : 0.5) + '"/>';
    }

    // Vertical beat/bar lines (scrolling)
    const beatsAhead = VISIBLE_BEATS * (1 - PLAYHEAD_FRACTION);
    const firstBar = Math.floor((nowBeat - VISIBLE_BEATS * PLAYHEAD_FRACTION) / 4);
    const lastBar = Math.ceil((nowBeat + beatsAhead) / 4);
    for (let b = firstBar; b <= lastBar; b++) {
      for (let beatInBar = 0; beatInBar < 4; beatInBar++) {
        const absBeat = b * 4 + beatInBar;
        const x = beatToX(absBeat);
        if (x < KW || x > W) continue;
        const isBar = beatInBar === 0;
        svg += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + gH + '" stroke="' + (isBar ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)') + '" stroke-width="' + (isBar ? 0.75 : 0.5) + '"/>';
        if (isBar) {
          svg += '<text x="' + (x + 3) + '" y="9" fill="rgba(255,255,255,0.15)" font-size="7" font-family="\'SF Mono\', ui-monospace, monospace" font-weight="600">' + (b + 1) + '</text>';
        }
      }
    }

    // GPS change markers
    for (const pc of poolChangeBeats) {
      const x = beatToX(pc.beat);
      if (x >= KW && x <= W) {
        svg += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + gH + '" stroke="' + K.green + '" stroke-width="1" stroke-dasharray="3,3" opacity="0.5"/>';
      }
    }

    // Note blocks (clipped to grid area) — placed by note name pitch within octave
    svg += '<g clip-path="url(#gridclip)">';
    for (const n of noteHistory) {
      const noteStart = beatToX(n.absoluteBeat);
      const noteEnd = beatToX(n.absoluteBeat + n.duration);
      if (noteEnd < KW || noteStart > W) continue;

      const row = noteToRow(n.octave, n.noteName);
      if (row < 0 || row >= totalRows) continue;

      const y = row * rowH + 1;
      const x = Math.max(noteStart, KW) + 0.5;
      const xEnd = Math.min(noteEnd, W);
      const w = Math.max(xEnd - x - 0.5, 2);
      const h = rowH - 2;
      const rx = Math.min(3, h / 2);

      const beatsBehindPlayhead = nowBeat - n.absoluteBeat;
      const isActive = n.absoluteBeat <= nowBeat && n.absoluteBeat + n.duration > nowBeat;
      const isAhead = n.absoluteBeat > nowBeat;

      let opacity = 1;
      if (beatsBehindPlayhead > 0 && !isActive) {
        opacity = Math.max(0, 0.7 * (1 - beatsBehindPlayhead / NOTE_FADE_BEATS));
      } else if (isAhead) {
        opacity = 0.6;
      }
      if (opacity <= 0.01) continue;

      const fill = isActive ? n.color : (n.color + 'cc');
      svg += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + rx + '" fill="' + fill + '" opacity="' + opacity + '"';
      if (isActive) {
        svg += ' stroke="rgba(255,255,255,0.6)" stroke-width="0.75"';
      }
      svg += '/>';
      if (isActive) {
        svg += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + rx + '" fill="none" stroke="' + n.color + '" stroke-width="0.5" filter="url(#prglow)" opacity="1"/>';
      }
    }
    svg += '</g>';

    // Playhead (fixed position)
    svg += '<line x1="' + phX + '" y1="0" x2="' + phX + '" y2="' + gH + '" stroke="' + K.pink + '" stroke-width="1.5" opacity="0.8"/>';
    svg += '<polygon points="' + (phX - 4) + ',0 ' + (phX + 4) + ',0 ' + phX + ',6" fill="' + K.pink + '"/>';

    // Key labels — show current note name for each slot, ordered by pitch
    for (let oct = 0; oct < numOctaves; oct++) {
      const octNotes = pool[oct] ? [...pool[oct]].sort(pitchSort) : [];
      for (let pitchIdx = 0; pitchIdx < SLOTS_PER_OCTAVE; pitchIdx++) {
        // pitchIdx 0 = lowest pitch in octave = bottom row of octave group
        const row = totalRows - 1 - (oct * SLOTS_PER_OCTAVE + pitchIdx);
        const ty = row * rowH + rowH / 2 + labelFontSize * 0.35;
        const noteName = octNotes[pitchIdx]; // May be undefined if pool has < 3 notes
        if (noteName) {
          const label = noteName + (oct + 1);
          svg += '<text x="' + (KW - 3) + '" y="' + ty + '" text-anchor="end" fill="rgba(255,255,255,0.5)" font-size="' + labelFontSize + '" font-family="\'SF Mono\', ui-monospace, monospace" font-weight="400">' + label + '</text>';
        }
      }
    }

    // Apply to SVG element
    ensureSVG(W, gH);
    svgEl.innerHTML = svg;

    // Age out old notes and GPS markers
    noteHistory = noteHistory.filter(n => nowBeat - n.absoluteBeat < NOTE_FADE_BEATS + 4);
    poolChangeBeats = poolChangeBeats.filter(p => nowBeat - p.beat < VISIBLE_BEATS + 4);

    rafId = requestAnimationFrame(render);
  }

  function ensureSVG(w, h) {
    if (!svgEl) {
      svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgEl.style.display = 'block';
      svgEl.style.width = '100%';
      container.appendChild(svgEl);
    }
    svgEl.setAttribute('width', w);
    svgEl.setAttribute('height', h);
    svgEl.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  }

  // ============== LIFECYCLE ==============

  function show() {
    if (isVisible) return;
    isVisible = true;

    // Subscribe to events
    if (audioService) {
      audioService.onNoteEvent(onNoteEvent);
      audioService.onNotePoolChange(onPoolChange);
      currentPool = audioService.getNotePool();
    }

    // Only clear history on genuine first show, not on re-attach
    if (!_preserveHistory) {
      noteHistory = [];
      poolChangeBeats = [];
      numOctaves = 0;
    }
    _preserveHistory = false;
    renderCount = 0;
    noteEventReceiveCount = 0;

    // Set numOctaves from current pool so all rows exist from frame one
    if (currentPool.length > numOctaves) {
      numOctaves = currentPool.length;
    }

    // Show container
    if (container) {
      container.style.display = 'block';
    }

    // Start render loop
    rafId = requestAnimationFrame(render);

    console.log('[PianoRoll] Shown (history:', noteHistory.length, ')');
  }

  // Flag to preserve history across re-attach
  let _preserveHistory = false;

  /**
   * Re-attach to a new container element after DOM rebuild.
   * Preserves note history and pool change markers.
   */
  function reattach(newContainer) {
    // Stop rendering but keep history
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    
    // Unsubscribe from old
    if (audioService && isVisible) {
      audioService.offNoteEvent(onNoteEvent);
      audioService.offNotePoolChange(onPoolChange);
    }

    // Remove old SVG if it exists
    if (svgEl && svgEl.parentNode) {
      svgEl.parentNode.removeChild(svgEl);
    }
    svgEl = null;

    // Point to new container
    container = newContainer;
    isVisible = false; // Will be set true by show()
    _preserveHistory = true; // Tell show() to keep history

    console.log('[PianoRoll] Reattaching (history preserved:', noteHistory.length, ')');
  }

  function hide() {
    if (!isVisible) return;
    isVisible = false;

    // Unsubscribe
    if (audioService) {
      audioService.offNoteEvent(onNoteEvent);
      audioService.offNotePoolChange(onPoolChange);
    }

    // Stop render loop
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    // Hide container
    if (container) {
      container.style.display = 'none';
    }

    console.log('[PianoRoll] Hidden');
  }

  function destroy() {
    hide();
    if (svgEl && svgEl.parentNode) {
      svgEl.parentNode.removeChild(svgEl);
    }
    svgEl = null;
    container = null;
    audioService = null;
    noteHistory = [];
    poolChangeBeats = [];
    currentPool = [];
    numOctaves = 0;
  }

  // ============== PUBLIC API ==============

  const PianoRoll = {
    version: __PIANO_ROLL_VER__,

    /**
     * Initialize the piano roll
     * @param {Object} opts
     * @param {HTMLElement} opts.container - The .music-pianoroll div
     * @param {Object} opts.audioService - AudioService reference
     */
    init(opts) {
      container = opts.container || null;
      audioService = opts.audioService || global.AudioService || null;

      if (!container) {
        console.warn('[PianoRoll] No container provided');
      }
      if (!audioService) {
        console.warn('[PianoRoll] No AudioService available');
      }

      // Hide by default (VexFlow is the default view)
      if (container) {
        container.style.display = 'none';
      }

      console.log('[PianoRoll] Initialized');
    },

    /** Show the piano roll (subscribe to events, start rendering) */
    show,

    /** Hide the piano roll (unsubscribe, stop rendering) */
    hide,

    /** Re-attach to a new container after DOM rebuild (preserves history) */
    reattach,

    /** Full cleanup */
    destroy,

    /** Whether the piano roll is currently visible */
    get isVisible() { return isVisible; },

    /** Get the current note history (for debugging/export) */
    getHistory() { return [...noteHistory]; },

    /** Clear note history */
    clearHistory() {
      noteHistory = [];
      poolChangeBeats = [];
    },
  };

  global.PianoRoll = PianoRoll;

})(typeof window !== 'undefined' ? window : this);
