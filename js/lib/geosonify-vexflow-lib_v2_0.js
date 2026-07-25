/*
  geosonify-vexflow-lib.v2.0.js
  VexFlow Music Notation Library for Geosonify

  WHAT CHANGED FROM v1.0, AND WHY
  v1.0 walked each token one CHARACTER at a time and upper-cased it:

      var noteLetter = token.charAt(j).toUpperCase();
      if (/[A-G]/.test(noteLetter)) notes.push(noteLetter + octave);

  That silently discards anything that is not a bare A-G, so it cannot draw a
  sharp, a flat or a quarter-tone at all. It never mattered while the only
  music card was C major, which has no accidentals. It matters now: a Dorian
  card would render Eb and Bb as E and B naturals — sounding right and
  notating wrong, which is worse than not rendering.

  v2.0 fixes two things:
    1. Tokenising. Tokens are split with the active scale's own alphabet via
       GeoScales.tokenize (greedy longest-match), so 'Eb' is one symbol rather
       than 'E' followed by a stray 'b'. Without a scale it falls back to the
       v1 character walk, so the frozen 'music' card behaves exactly as before.
    2. Accidentals. VexFlow REJECTS accidentals inside key strings —
       new StaveNote({keys:['e+/4']}) throws "Invalid key name: E+" — so they
       must be attached per notehead as modifiers:
           note.addModifier(new Accidental('d'), noteheadIndex)
       Verified against the pinned VexFlow 4.2.3, which carries the full
       Stein-Zimmermann and Turkish/Persian sets: '+' quarter-sharp,
       'd' quarter-flat, '++', 'db', 'bs', 'k' (koron), 'o' (sori).

  Scale symbol modifiers map to VexFlow accidental codes as:
      b -> 'b'   flat            s -> '#'   sharp
      d -> 'd'   half-flat       p -> '+'   half-sharp

  v1.0 is left in the repo untouched. Liveness is decided by the <script> tag
  in index.html, nothing else.

  Usage:
    VexFlowLib.parseMusicalCode(code, octaveBoost?, scaleId?) -> ["Eb4", "F#5", ...]
    VexFlowLib.octaveRange(notes) -> { min, max }
    VexFlowLib.renderToElement(element, notes, options?) -> void
    VexFlowLib.createRenderer(width, height) -> { div, renderer, context }
*/
(function (global) {
  'use strict';
  var __VEXFLOW_LIB_VER__ = 'v2.0';
  try { console.log('[geosonify] vexflow-lib ' + __VEXFLOW_LIB_VER__ + ' loaded'); } catch (e) {}

  // Scale-symbol modifier -> VexFlow accidental code.
  var ACC_CODE = { 'b': 'b', 's': '#', 'd': 'd', 'p': '+' };

  // Accidental characters that may appear in a parsed note string.
  var NOTE_RE = /^([A-Ga-g])(##|bb|\+\+|db|[#bd+])?(-?\d+)$/;

  function hasVexFlow() {
    return typeof Vex !== 'undefined' && Vex.Flow;
  }

  function tokenizeMusicalCode(code) {
    if (!code || typeof code !== 'string') return [];
    code = code.replace(/,\s*$/, '');
    var parts = code.split(',');
    var tokens = [];
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (part.length > 0) tokens.push(part);
    }
    return tokens;
  }

  // Split one token into note symbols. With a scale, use its alphabet so
  // multi-character symbols stay intact. Without one, fall back to v1
  // behaviour exactly.
  function splitToken(token, scaleId) {
    if (scaleId && typeof GeoScales !== 'undefined' && GeoScales.get(scaleId)) {
      var syms = GeoScales.tokenize(scaleId, token);
      if (syms) return syms;
      // Unlexable against this scale: fall through rather than render nothing.
    }
    var out = [];
    for (var j = 0; j < token.length; j++) {
      var c = token.charAt(j).toUpperCase();
      if (/[A-G]/.test(c)) out.push(c);
    }
    return out;
  }

  // Symbol ('Eb') -> note string at an octave ('Eb4'), using VexFlow codes.
  function symbolToNote(sym, octave) {
    var m = /^([A-G])([bsdp])?$/.exec(sym);
    if (!m) {
      // Not a letter-based symbol (degree digits, gong-diao initials...).
      // The scale's render[] table says where it sits on the staff.
      return null;
    }
    var acc = m[2] ? (ACC_CODE[m[2]] || '') : '';
    return m[1] + acc + octave;
  }

  function parseMusicalCode(code, octaveBoost, scaleId) {
    octaveBoost = octaveBoost || 0;
    var tokens = tokenizeMusicalCode(code);
    var notes = [];
    var sc = (scaleId && typeof GeoScales !== 'undefined') ? GeoScales.get(scaleId) : null;

    for (var i = 0; i < tokens.length; i++) {
      var octave = octaveBoost + i + 1;
      var syms = splitToken(tokens[i], scaleId);
      for (var j = 0; j < syms.length; j++) {
        var note = symbolToNote(syms[j], octave);
        if (note === null && sc) {
          // Fall back to the scale's staff-position table for symbols that are
          // not spelled as note letters at all.
          var idx = sc.symbols.indexOf(syms[j]);
          if (idx >= 0 && sc.render && sc.render[idx]) {
            var r = sc.render[idx];
            note = r[0].toUpperCase() + (r[1] || '') + octave;
          }
        }
        if (note) notes.push(note);
      }
    }
    return notes;
  }

  // Octave span of a parsed note list. Exposed so callers do not have to
  // regex the strings themselves — v1 callers did, and their pattern silently
  // failed on any note carrying an accidental.
  function octaveRange(notes) {
    var min = 10, max = 0;
    for (var i = 0; i < notes.length; i++) {
      var m = NOTE_RE.exec(notes[i]);
      if (!m) continue;
      var o = parseInt(m[3], 10);
      if (o < min) min = o;
      if (o > max) max = o;
    }
    if (max === 0 && min === 10) { min = 1; max = 1; }
    return { min: min, max: max };
  }

  // Split into { key, acc } for VexFlow, bucketed by clef.
  function separateByClef(notes) {
    var bass = [], treble = [];
    for (var i = 0; i < notes.length; i++) {
      var m = NOTE_RE.exec(notes[i]);
      if (!m) continue;
      var octave = parseInt(m[3], 10);
      var entry = { key: m[1].toLowerCase() + '/' + octave, acc: m[2] || null };
      (octave < 4 ? bass : treble).push(entry);
    }
    return { bass: bass, treble: treble };
  }

  // Build a chord and hang each accidental on its own notehead.
  function buildChord(VF, clef, entries) {
    var note = new VF.StaveNote({
      clef: clef,
      keys: entries.map(function (e) { return e.key; }),
      duration: 'w'
    });
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].acc) continue;
      try {
        note.addModifier(new VF.Accidental(entries[i].acc), i);
      } catch (e) {
        // An unknown accidental code should cost one glyph, not the whole staff.
        console.warn('[vexflow-lib] unsupported accidental:', entries[i].acc, e);
      }
    }
    return note;
  }

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

    if (typeof element === 'string') element = document.getElementById(element);
    if (!element) return null;
    element.innerHTML = '';

    var separated = separateByClef(notes);
    var VF = Vex.Flow;
    var renderer = new VF.Renderer(element, VF.Renderer.Backends.SVG);
    renderer.resize(width * scale, height * scale);
    var context = renderer.getContext();
    context.scale(scale, scale);

    var staveWidth = width - 40;
    var baseY = (height - 120) / 2;
    var trebleY = baseY + extraTopSpace;
    var bassY = trebleY + 60;

    var trebleStave = new VF.Stave(20, trebleY, staveWidth);
    trebleStave.addClef('treble');
    trebleStave.setContext(context).draw();

    var bassStave = new VF.Stave(20, bassY, staveWidth);
    bassStave.addClef('bass');
    bassStave.setContext(context).draw();

    new VF.StaveConnector(trebleStave, bassStave).setType(3).setContext(context).draw();
    new VF.StaveConnector(trebleStave, bassStave).setType(1).setContext(context).draw();

    if (separated.treble.length > 0) {
      try {
        VF.Formatter.FormatAndDraw(context, trebleStave, [buildChord(VF, 'treble', separated.treble)]);
      } catch (e) {
        console.warn('[vexflow-lib] Error rendering treble notes:', e);
      }
    }
    if (separated.bass.length > 0) {
      try {
        VF.Formatter.FormatAndDraw(context, bassStave, [buildChord(VF, 'bass', separated.bass)]);
      } catch (e) {
        console.warn('[vexflow-lib] Error rendering bass notes:', e);
      }
    }
    return { renderer: renderer, context: context };
  }

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
    return { div: div, renderer: renderer, context: renderer.getContext() };
  }

  // Render a code for display: 'CEb,Fs' -> 'CE\u266d,F\u266f'. Cosmetic only —
  // never feed this back into a decoder, the ASCII form is the real code.
  function prettyCode(code, scaleId) {
    if (!code) return code;
    if (!scaleId || typeof GeoScales === 'undefined' || !GeoScales.get(scaleId)) return code;
    return code.replace(/([A-G])([bsdp])/g, function (_, letter, mod) {
      return letter + ({ b: '\u266d', s: '\u266f', d: '\u{1D132}', p: '\u{1D131}' }[mod] || mod);
    });
  }

  global.VexFlowLib = {
    version: __VEXFLOW_LIB_VER__,
    hasVexFlow: hasVexFlow,
    tokenizeMusicalCode: tokenizeMusicalCode,
    parseMusicalCode: parseMusicalCode,
    octaveRange: octaveRange,
    separateByClef: separateByClef,
    renderToElement: renderToElement,
    createRenderer: createRenderer,
    prettyCode: prettyCode
  };
})(typeof window !== 'undefined' ? window : this);
