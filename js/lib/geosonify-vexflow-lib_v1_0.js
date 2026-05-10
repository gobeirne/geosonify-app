/*
  geosonify-vexflow-lib.v1.0.js
  VexFlow Music Notation Library for Geosonify
  
  Renders musical codes as sheet music using VexFlow.
  Converts geosonify musical grid codes (e.g., "FG,FB,CG,DG,EGB,") to
  notes with octave markers (e.g., "F1,G1,F2,B2,C3,G3,...") and displays
  them on a grand staff (treble + bass clef).
  
  Requires VexFlow 4.x: https://unpkg.com/vexflow@4.0.1/build/cjs/vexflow-debug.js
  
  Usage:
    VexFlowLib.parseMusicalCode(code, octaveBoost?) -> Array of note strings
    VexFlowLib.renderToElement(element, notes, options?) -> void
    VexFlowLib.createRenderer(width, height) -> { div, renderer, context }
*/
(function(global){
  'use strict';
  var __VEXFLOW_LIB_VER__ = 'v1.0';
  try { console.log('[geosonify] vexflow-lib ' + __VEXFLOW_LIB_VER__ + ' loaded'); } catch(e){}

  // Musical grid tokens (7x7 grid)
  // Each cell can contain 1-3 note letters
  var MUSICAL_GRID = [
    'AA', 'AB', 'CA', 'DA', 'EA', 'FA', 'GA',
    'EAB', 'BB', 'CB', 'DB', 'EB', 'FB', 'GB',
    'CEA', 'CBE', 'CC', 'CD', 'CE', 'CF', 'CG',
    'DEA', 'EDB', 'CDE', 'DD', 'DE', 'DF', 'DG',
    'GEA', 'EGB', 'CEF', 'DEG', 'EE', 'EF', 'EG',
    'CFA', 'DFB', 'CFG', 'DFA', 'EFB', 'FF', 'FG',
    'DGA', 'FGB', 'CGA', 'DGB', 'CEG', 'FGA', 'GG'
  ];

  // Check if VexFlow is available
  function hasVexFlow() {
    return typeof Vex !== 'undefined' && Vex.Flow;
  }

  // Tokenize a musical code string into grid tokens
  function tokenizeMusicalCode(code) {
    if (!code || typeof code !== 'string') return [];
    
    // Remove trailing comma if present
    code = code.replace(/,\s*$/, '');
    
    // Split by comma
    var parts = code.split(',');
    var tokens = [];
    
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (part.length > 0) {
        tokens.push(part);
      }
    }
    
    return tokens;
  }

  // Parse a musical code into individual notes with octave numbers
  // e.g., "FG,FB,CG,DG,EGB,DG,DA," -> ["F1","G1","F2","B2","C3","G3","D4","G4","E5","G5","B5","D6","G6","D7","A7"]
  function parseMusicalCode(code, octaveBoost) {
    octaveBoost = octaveBoost || 0;
    var tokens = tokenizeMusicalCode(code);
    var notes = [];
    
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      var octave = octaveBoost + i + 1; // 1-based octave numbering
      
      // Each character in the token is a note letter
      for (var j = 0; j < token.length; j++) {
        var noteLetter = token.charAt(j).toUpperCase();
        // Valid note letters: A, B, C, D, E, F, G
        if (/[A-G]/.test(noteLetter)) {
          notes.push(noteLetter + octave);
        }
      }
    }
    
    return notes;
  }

  // Convert note string (e.g., "F4") to VexFlow format (e.g., "f/4")
  function noteToVexFlow(noteStr) {
    var match = noteStr.match(/([A-Ga-g])(\d+)/);
    if (!match) return null;
    return match[1].toLowerCase() + '/' + match[2];
  }

  // Separate notes into bass (octave < 4) and treble (octave >= 4) clefs
  function separateByClef(notes) {
    var bass = [];
    var treble = [];
    
    for (var i = 0; i < notes.length; i++) {
      var noteStr = notes[i];
      var match = noteStr.match(/([A-Ga-g])(\d+)/);
      if (match) {
        var octave = parseInt(match[2]);
        var vexNote = match[1].toLowerCase() + '/' + octave;
        if (octave < 4) {
          bass.push(vexNote);
        } else {
          treble.push(vexNote);
        }
      }
    }
    
    return { bass: bass, treble: treble };
  }

  // Render notes to a DOM element using VexFlow
  function renderToElement(element, notes, options) {
    if (!hasVexFlow()) {
      console.error('[vexflow-lib] VexFlow not loaded');
      return null;
    }
    
    options = options || {};
    var width = options.width || 160;
    var height = options.height || 340;
    var scale = options.scale || 1;
    var extraTopSpace = options.extraTopSpace || 0;
    var extraBottomSpace = options.extraBottomSpace || 0;
    
    // Clear existing content
    if (typeof element === 'string') {
      element = document.getElementById(element);
    }
    if (!element) return null;
    element.innerHTML = '';
    
    // Separate notes by clef
    var separated = separateByClef(notes);
    
    // Create renderer
    var VF = Vex.Flow;
    var renderer = new VF.Renderer(element, VF.Renderer.Backends.SVG);
    renderer.resize(width * scale, height * scale);
    var context = renderer.getContext();
    context.scale(scale, scale);
    
    // Calculate stave positions - account for extra space needed for high/low notes
    var staveWidth = width - 40;
    var baseY = (height - 120) / 2;
    
    // Shift staves down if we have extra top space (high notes)
    var trebleY = baseY + extraTopSpace;
    var bassY = trebleY + 60;
    
    // Create staves
    var trebleStave = new VF.Stave(20, trebleY, staveWidth);
    trebleStave.addClef('treble');
    trebleStave.setContext(context).draw();
    
    var bassStave = new VF.Stave(20, bassY, staveWidth);
    bassStave.addClef('bass');
    bassStave.setContext(context).draw();
    
    // Draw brace connecting staves
    var brace = new VF.StaveConnector(trebleStave, bassStave).setType(3);
    brace.setContext(context).draw();
    
    // Draw line connecting staves
    var line = new VF.StaveConnector(trebleStave, bassStave).setType(1);
    line.setContext(context).draw();
    
    // Create and draw notes if we have any
    if (separated.treble.length > 0) {
      try {
        var trebleNotes = [
          new VF.StaveNote({ clef: 'treble', keys: separated.treble, duration: 'w' })
        ];
        VF.Formatter.FormatAndDraw(context, trebleStave, trebleNotes);
      } catch(e) {
        console.warn('[vexflow-lib] Error rendering treble notes:', e);
      }
    }
    
    if (separated.bass.length > 0) {
      try {
        var bassNotes = [
          new VF.StaveNote({ clef: 'bass', keys: separated.bass, duration: 'w' })
        ];
        VF.Formatter.FormatAndDraw(context, bassStave, bassNotes);
      } catch(e) {
        console.warn('[vexflow-lib] Error rendering bass notes:', e);
      }
    }
    
    return { renderer: renderer, context: context };
  }

  // Create a standalone renderer (returns DOM element with SVG)
  function createRenderer(width, height) {
    if (!hasVexFlow()) {
      console.error('[vexflow-lib] VexFlow not loaded');
      return null;
    }
    
    var div = document.createElement('div');
    div.style.display = 'inline-block';
    
    var VF = Vex.Flow;
    var renderer = new VF.Renderer(div, VF.Renderer.Backends.SVG);
    renderer.resize(width, height);
    var context = renderer.getContext();
    
    return {
      div: div,
      renderer: renderer,
      context: context
    };
  }

  // Check if a code looks like a musical grid code
  function isMusicalCode(code) {
    if (!code || typeof code !== 'string') return false;
    // Musical codes have commas and contain only A-G letters (plus commas)
    if (code.indexOf(',') === -1) return false;
    var cleaned = code.replace(/,/g, '');
    return /^[A-Ga-g]+$/.test(cleaned);
  }

  // Get note frequency in Hz (for audio playback)
  function noteToFrequency(noteStr) {
    var match = noteStr.match(/([A-Ga-g])(\d+)/);
    if (!match) return null;
    
    var note = match[1].toUpperCase();
    var octave = parseInt(match[2]);
    
    // Semitone offsets from A
    var semitones = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
    var semitone = semitones[note];
    if (semitone === undefined) return null;
    
    // A4 = 440 Hz
    var halfStepsFromA4 = semitone + (octave - 4) * 12;
    return 440 * Math.pow(2, halfStepsFromA4 / 12);
  }

  // Get all frequencies for a set of notes
  function notesToFrequencies(notes) {
    var freqs = [];
    for (var i = 0; i < notes.length; i++) {
      var freq = noteToFrequency(notes[i]);
      if (freq !== null) {
        freqs.push(freq);
      }
    }
    return freqs;
  }

  // Export API
  global.VexFlowLib = {
    version: __VEXFLOW_LIB_VER__,
    hasVexFlow: hasVexFlow,
    tokenizeMusicalCode: tokenizeMusicalCode,
    parseMusicalCode: parseMusicalCode,
    noteToVexFlow: noteToVexFlow,
    separateByClef: separateByClef,
    renderToElement: renderToElement,
    createRenderer: createRenderer,
    isMusicalCode: isMusicalCode,
    noteToFrequency: noteToFrequency,
    notesToFrequencies: notesToFrequencies,
    MUSICAL_GRID: MUSICAL_GRID
  };

})(window);
