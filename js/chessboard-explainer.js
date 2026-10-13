/* Geosonify Chessboard Explainer — visual playback. MPL-2.0. */
(function () {
  'use strict';

  const DEFAULTS = { healpix: '95625281C9B5', standard: 'BFDAEB6AA077' };
  const UNICODE = ['', '♔','♕','♖','♗','♘','♙','♚','♛','♜','♝','♞','♟'];
  const CHAPTERS = [
    { key: 'number', text: '01  The number', phases: ['intro','packing','whitening'] },
    { key: 'pawns', text: '02  Pawns', phases: ['pawns'] },
    { key: 'bishops', text: '03  Bishops', phases: ['bishops'] },
    { key: 'material', text: '04  Other pieces', phases: ['material'] },
    { key: 'kings', text: '05  Safe kings', phases: ['kings'] },
    { key: 'decode', text: '06  Read it back', phases: ['decode'] },
    { key: 'finish', text: '07  The proof', phases: ['finish'] }
  ];
  const $ = id => document.getElementById(id);
  const el = {
    form: $('codeForm'), input: $('hexInput'), validation: $('validation'), board: $('chessboard'),
    nav: $('chapterNav'), title: $('storyTitle'), description: $('storyDescription'),
    phase: $('phaseTag'), stepCount: $('stepCount'), pieces: $('pieceCount'),
    candidates: $('candidateBlock'), choices: $('candidateList'), strips: $('intervalStrip'),
    candidateTotal: $('candidateTotal'), intervalDescription: $('intervalDescription'),
    rejectedBlock: $('rejectedBlock'), rejectedList: $('rejectedList'),
    numbers: $('numbers'), math: $('mathTable'), timeline: $('timeline'),
    back: $('previous'), next: $('next'), play: $('playPause'), playLabel: $('playLabel'),
    playSymbol: $('playSymbol'), showEmpties: $('showEmpties'), speed: $('speed'),
    fen: $('fenOutput'), copyFen: $('copyFen'), copyLink: $('copyLink'),
    openPosition: $('viewGeosonify'), roundTrip: $('roundTrip'), trust: $('trustIndicator'),
    reset: $('resetExample')
  };
  const squareEls = [];
  let trace = null, visibleSteps = [], stepIndex = 0;
  let playing = false, playTimer = 0, lastPieces = new Array(64).fill(0);
  let hoveredSquares = null, pinnedSquares = null;

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function comma(value) {
    const s = String(value);
    return /^\d{5,}$/.test(s) ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : s;
  }
  function compact(n) {
    const s = String(n);
    return s.length > 11 ? `${s[0]}.${s.slice(1,4)} × 10^${s.length-1}` : comma(s);
  }
  function pct(n, total) {
    if (!total) return 0;
    return Number(BigInt(n) * 100000n / BigInt(total)) / 1000;
  }
  function sumCounts(choices) { return choices.reduce((s, c) => s + c.count, 0n); }
  function getMode() { return document.querySelector('input[name="mode"]:checked').value; }
  function currentChapter(phase) { return CHAPTERS.find(c => c.phases.includes(phase)) || CHAPTERS[0]; }
  function setStatus(error) {
    el.validation.hidden = !error;
    el.validation.textContent = error || '';
    el.trust.classList.toggle('is-error', !!error);
    el.trust.innerHTML = error ? 'TRACE COULD NOT BE VERIFIED' : 'SOURCE-CHECKED TRACE <span aria-hidden="true">✓</span>';
  }

  function makeBoard() {
    for (let rank = 7; rank >= 0; --rank) {
      for (let file = 0; file < 8; ++file) {
        const idx = rank * 8 + file;
        const tile = document.createElement('div');
        tile.className = `chess-square ${(file + rank) % 2 ? 'light' : 'dark'}`;
        tile.dataset.square = String(idx);
        const piece = document.createElement('span');
        piece.className = 'piece';
        piece.setAttribute('aria-hidden', 'true');
        tile.appendChild(piece);
        if (file === 0) {
          const label = document.createElement('span');
          label.className = 'square-coord rank-coordinate';
          label.textContent = rank + 1;
          tile.appendChild(label);
        }
        if (rank === 0) {
          const label = document.createElement('span');
          label.className = 'square-coord file-coordinate';
          label.textContent = String.fromCharCode(97 + file);
          tile.appendChild(label);
        }
        el.board.appendChild(tile);
        squareEls[idx] = { tile, piece };
      }
    }
  }

  function paintBoard(step) {
    const highlight = new Set(step.highlight || []);
    const eligible = new Set(step.eligible || []);
    const unsafe = new Set(step.unsafe || []);
    const preview = new Set(hoveredSquares || pinnedSquares || []);
    const noMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (let i = 0; i < 64; ++i) {
      const slot = squareEls[i];
      if (!slot) continue;
      slot.tile.classList.toggle('highlight', highlight.has(i));
      slot.tile.classList.toggle('eligible', eligible.has(i));
      slot.tile.classList.toggle('unsafe', unsafe.has(i));
      slot.tile.classList.toggle('preview', preview.has(i));
      if (lastPieces[i] !== step.board[i]) {
        slot.piece.textContent = UNICODE[step.board[i]] || '';
        slot.piece.className = 'piece ' + (step.board[i] > 6 ? 'black-piece' : 'white-piece');
        if (step.board[i] && !noMotion) {
          // Restart the appearance animation only when a piece actually enters.
          slot.piece.classList.remove('just-entered');
          void slot.piece.offsetWidth;
          slot.piece.classList.add('just-entered');
        }
      }
    }
    lastPieces = step.board.slice();
    const total = step.board.filter(x => x !== 0).length;
    el.pieces.textContent = `${total} / 32 pieces`;
    el.board.setAttribute('aria-label', `Chessboard: ${total} of 32 pieces placed. ${step.title}.`);
  }

  function showCandidates(step) {
    const choices = step.choices || [];
    el.candidates.hidden = !choices.length;
    el.choices.replaceChildren();
    el.strips.replaceChildren();
    if (!choices.length) return;
    const total = sumCounts(choices);
    el.candidateTotal.textContent = `${compact(total)} continuations`;
    const strip = document.createDocumentFragment();
    choices.forEach((c, i) => {
      const tile = document.createElement('div');
      tile.className = 'interval-piece' + (i === step.picked ? ' selected' : '');
      tile.style.width = `${pct(c.count, total)}%`;
      tile.title = `${c.label}: ${comma(c.count)} arrangements`;
      strip.appendChild(tile);
    });
    const marker = document.createElement('div');
    marker.className = 'interval-marker';
    marker.style.left = `${Math.max(0,Math.min(100,pct(step.before,total)))}%`;
    marker.title = 'The current rank';
    strip.appendChild(marker);
    el.strips.appendChild(strip);
    el.intervalDescription.textContent = `The vertical line marks the current rank; the green interval contains it. ${step.picked} earlier interval${step.picked === 1 ? '' : 's'} were skipped. Hover or tap an alternative to locate its squares.`;

    const fragment = document.createDocumentFragment();
    choices.forEach((candidate, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice' + (i === step.picked ? ' selected' : '');
      button.setAttribute('aria-pressed', 'false');
      button.title = `${candidate.label}: ${comma(candidate.count)} possible continuations. Preview squares.`;
      button.innerHTML = `<span class="choice-name">${escapeHTML(candidate.label)}</span><span class="choice-percent">${pct(candidate.count,total).toFixed(1)}%</span>`;
      const squares = candidate.squares;
      button.addEventListener('mouseenter', () => { hoveredSquares = squares; paintBoard(step); });
      button.addEventListener('mouseleave', () => { hoveredSquares = null; paintBoard(step); });
      button.addEventListener('focus', () => { hoveredSquares = squares; paintBoard(step); });
      button.addEventListener('blur', () => { hoveredSquares = null; paintBoard(step); });
      button.addEventListener('click', () => {
        const wasPinned = button.getAttribute('aria-pressed') === 'true';
        for (const other of el.choices.querySelectorAll('[aria-pressed]')) other.setAttribute('aria-pressed', 'false');
        pinnedSquares = wasPinned ? null : squares;
        if (!wasPinned) button.setAttribute('aria-pressed', 'true');
        paintBoard(step);
      });
      fragment.appendChild(button);
    });
    el.choices.appendChild(fragment);
    // Ensure the selected option remains visible even for 14-pair pawn choices.
    const selected = el.choices.children[step.picked];
    if (selected) {
      // Scroll only the small candidate grid, not the entire document on autoplay.
      const top = selected.offsetTop;
      if (top < el.choices.scrollTop) el.choices.scrollTop = top;
      if (top + selected.offsetHeight > el.choices.scrollTop + el.choices.clientHeight)
        el.choices.scrollTop = top + selected.offsetHeight - el.choices.clientHeight;
    }
  }

  function showMath(step) {
    const rows = step.math || [];
    el.numbers.hidden = rows.length === 0;
    el.math.replaceChildren();
    for (const [key, value] of rows) {
      const row = document.createElement('div');
      row.className = 'math-row';
      const label = document.createElement('span'); label.className = 'key'; label.textContent = key;
      const code = document.createElement('code'); code.textContent = comma(value);
      row.append(label, code);
      el.math.appendChild(row);
    }
    if (step.choices && step.choices.length) {
      const c = step.choices[step.picked];
      const row = document.createElement('div'); row.className = 'math-row';
      const label = document.createElement('span'); label.className = 'key'; label.textContent = 'Selected interval size';
      const output = document.createElement('code'); output.textContent = comma(c.count);
      row.append(label, output); el.math.appendChild(row);
    }
  }

  function showRejected(step) {
    const rejected = step.rejected || [];
    el.rejectedBlock.hidden = !rejected.length;
    el.rejectedList.replaceChildren();
    for (const item of rejected) {
      const chip = document.createElement('span');
      chip.textContent = `${item.square} · ${item.reason}`;
      el.rejectedList.appendChild(chip);
    }
  }

  function renderNav(step) {
    const active = currentChapter(step.phase).key;
    for (const b of el.nav.querySelectorAll('button')) {
      b.classList.toggle('active', b.dataset.chapter === active);
      b.setAttribute('aria-current', b.dataset.chapter === active ? 'step' : 'false');
    }
  }
  function rebuildNav() {
    el.nav.replaceChildren();
    for (const chapter of CHAPTERS) {
      const index = visibleSteps.findIndex(s => chapter.phases.includes(s.phase));
      if (index < 0) continue;
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.chapter = chapter.key;
      button.textContent = chapter.text;
      button.addEventListener('click', () => go(index));
      el.nav.appendChild(button);
    }
  }

  function render() {
    if (!trace || !visibleSteps.length) return;
    const step = visibleSteps[stepIndex];
    const phaseName = currentChapter(step.phase).text.replace(/^\d+\s*/, '');
    el.phase.textContent = phaseName.toUpperCase();
    el.stepCount.textContent = `Step ${stepIndex + 1} of ${visibleSteps.length}`;
    el.title.textContent = step.title;
    el.description.textContent = step.description;
    el.timeline.value = String(stepIndex);
    el.timeline.setAttribute('aria-valuetext', `Step ${stepIndex + 1}: ${step.title}`);
    el.back.disabled = stepIndex === 0;
    el.next.disabled = stepIndex === visibleSteps.length - 1;
    el.next.innerHTML = stepIndex === visibleSteps.length - 2 ? '<span>Finish</span> →' : '<span>Next</span> →';
    paintBoard(step);
    showCandidates(step);
    showRejected(step);
    showMath(step);
    renderNav(step);

    const finished = step.phase === 'finish';
    el.fen.textContent = finished ? trace.fen : 'Revealed on the final step';
    el.copyFen.disabled = !finished;
    el.openPosition.hidden = !finished;
    el.roundTrip.textContent = finished
      ? `${trace.code}  →  ${trace.fen}  →  ${trace.scanned.hex} · PASS`
      : 'Follow the walkthrough to reveal and verify the recovered code.';
  }
  function go(index) {
    if (!visibleSteps.length) return;
    stepIndex = Math.min(visibleSteps.length - 1, Math.max(0, index));
    hoveredSquares = null; pinnedSquares = null;
    render();
  }
  function pause() {
    playing = false;
    if (playTimer) clearInterval(playTimer);
    playTimer = 0;
    el.playSymbol.textContent = '▶';
    el.playLabel.textContent = 'Play';
    el.play.setAttribute('aria-label', 'Play animation');
  }
  function play() {
    if (!visibleSteps.length) return;
    if (playing) return pause();
    if (stepIndex === visibleSteps.length - 1) go(0);
    playing = true;
    el.playSymbol.textContent = 'Ⅱ';
    el.playLabel.textContent = 'Pause';
    el.play.setAttribute('aria-label', 'Pause animation');
    playTimer = setInterval(() => {
      if (stepIndex === visibleSteps.length - 1) { pause(); return; }
      go(stepIndex + 1);
      if (stepIndex === visibleSteps.length - 1) pause();
    }, Number(el.speed.value));
  }
  function rebuildVisible() {
    if (!trace) return;
    const anchor = visibleSteps[stepIndex] || trace.steps[0];
    visibleSteps = trace.steps.filter(step => !step.optional || el.showEmpties.checked);
    const old = visibleSteps.indexOf(anchor);
    stepIndex = old >= 0 ? old : Math.max(0, visibleSteps.findIndex(s => s.phase === anchor.phase));
    el.timeline.max = String(visibleSteps.length - 1);
    rebuildNav();
    render();
  }
  function positionUrl() {
    if (!trace) return '#';
    const key = trace.mode === 'healpix' ? 'hpfen' : 'fen';
    return `https://geosonify.org/?${key}=${encodeURIComponent(trace.fen)}`;
  }
  function explainerUrl() {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams({ mode: getMode(), code: el.input.value.trim().toUpperCase() }).toString();
    url.hash = '';
    return url.toString();
  }

  function generate() {
    pause();
    setStatus('');
    el.form.setAttribute('aria-busy', 'true');
    try {
      const mode = getMode();
      const code = el.input.value.trim().toUpperCase();
      // Instrumentation is synchronous and restored by the trace adapter; the original
      // cached codec remains the authority for generation and verification.
      const codec = ChessboardLib.makeCodec(mode);
      const result = GeosonifyChessTrace.trace(codec, code);
      trace = result;
      el.input.value = result.code;
      visibleSteps = [];
      stepIndex = 0;
      lastPieces = new Array(64).fill(-1);
      hoveredSquares = null; pinnedSquares = null;
      el.openPosition.href = positionUrl();
      rebuildVisible();
      if (window.history && window.history.replaceState)
        window.history.replaceState(null, '', new URLSearchParams({ mode, code: result.code }).toString().replace(/^/, '?'));
    } catch (error) {
      pause();
      setStatus(error && error.message ? error.message : String(error));
      trace = null; visibleSteps = []; stepIndex = 0;
      el.title.textContent = 'Could not build this position';
      el.description.textContent = 'Correct the code and try again. The encoder does not shorten invalid or over-precise codes.';
      el.phase.textContent = 'INPUT ERROR';
      el.stepCount.textContent = '';
      el.candidates.hidden = true; el.rejectedBlock.hidden = true; el.numbers.hidden = true;
      el.fen.textContent = '—'; el.copyFen.disabled = true;
      el.openPosition.hidden = true;
      el.roundTrip.textContent = 'No board was generated from this input.';
      el.nav.replaceChildren();
      paintBoard({ board: new Array(64).fill(0), title: 'Empty chessboard', highlight: [] });
      console.error('Chessboard explainer:', error);
    } finally {
      el.form.removeAttribute('aria-busy');
    }
  }

  async function copyText(value, button) {
    const original = button.textContent;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const input = document.createElement('textarea');
        input.value = value; input.setAttribute('readonly', '');
        input.style.cssText = 'position:fixed;top:-9999px;left:0;';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        input.remove();
        if (!copied) throw new Error('Clipboard unavailable');
      }
      button.textContent = 'Copied ✓';
    } catch (_) {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => { button.textContent = original; }, 1750);
  }
  function init() {
    makeBoard();
    el.form.addEventListener('submit', event => { event.preventDefault(); generate(); });
    el.reset.addEventListener('click', () => { el.input.value = DEFAULTS[getMode()]; generate(); });
    for (const input of document.querySelectorAll('input[name="mode"]')) {
      input.addEventListener('change', event => {
        const code = el.input.value.trim().toUpperCase();
        if (Object.values(DEFAULTS).includes(code)) el.input.value = DEFAULTS[event.target.value];
        generate();
      });
    }
    el.back.addEventListener('click', () => { pause(); go(stepIndex - 1); });
    el.next.addEventListener('click', () => { pause(); go(stepIndex + 1); });
    el.play.addEventListener('click', play);
    el.timeline.addEventListener('input', e => { pause(); go(Number(e.target.value)); });
    el.showEmpties.addEventListener('change', () => { pause(); rebuildVisible(); });
    el.speed.addEventListener('change', () => { if (playing) { pause(); play(); } });
    el.copyFen.addEventListener('click', () => { if (trace && visibleSteps[stepIndex].phase === 'finish') copyText(trace.fen, el.copyFen); });
    el.copyLink.addEventListener('click', () => copyText(explainerUrl(), el.copyLink));
    document.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement.tagName)) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); pause(); go(stepIndex + 1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); pause(); go(stepIndex - 1); }
      if (event.key === ' ') { event.preventDefault(); play(); }
    });

    const query = new URLSearchParams(window.location.search);
    const mode = query.get('mode');
    if (mode === 'healpix' || mode === 'standard') {
      const radio = document.querySelector(`input[name="mode"][value="${mode}"]`);
      if (radio) radio.checked = true;
    }
    const code = query.get('code');
    if (code !== null) el.input.value = code;
    else el.input.value = DEFAULTS[getMode()];
    if (typeof ChessboardLib === 'undefined' || typeof GeosonifyChessTrace === 'undefined') {
      setStatus('Required Geosonify codec files were not found. Serve this page from the repository root.');
      return;
    }
    generate();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
