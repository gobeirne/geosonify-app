/* Geosonify Chessboard Explainer — visual playback. MPL-2.0. */
(function () {
  'use strict';

  const DEFAULTS = { healpix: '95625281C9B5', standard: 'BFDAEB6AA077' };
  const UNICODE = ['', '♔','♕','♖','♗','♘','♙','♚','♛','♜','♝','♞','♟'];
  const CHAPTERS = [
    { key: 'number', text: '01  The number', phases: ['intro','packing','whitening'] },
    { key: 'tree', text: '02  The choice tree', phases: ['tree'] },
    { key: 'pawns', text: '03  Pawns', phases: ['pawns'] },
    { key: 'bishops', text: '04  Bishops', phases: ['bishops'] },
    { key: 'material', text: '05  Other pieces', phases: ['material'] },
    { key: 'kings', text: '06  Safe kings', phases: ['kings'] },
    { key: 'decode', text: '07  Read it back', phases: ['decode'] },
    { key: 'finish', text: '08  The proof', phases: ['finish'] }
  ];
  const $ = id => document.getElementById(id);
  const el = {
    form: $('codeForm'), input: $('hexInput'), validation: $('validation'), board: $('chessboard'),
    nav: $('chapterNav'), title: $('storyTitle'), description: $('storyDescription'),
    phase: $('phaseTag'), stepCount: $('stepCount'), pieces: $('pieceCount'),
    hexSpotlight: $('hexSpotlight'), hexDigits: $('heroHexDigits'),
    hexMode: $('hexModeLabel'), hexCaption: $('hexSpotlightCaption'),
    hexBreakdown: $('hexBreakdown'), hexTerms: $('hexTerms'), hexTermCount: $('hexTermCount'),
    hexDecimalValue: $('hexDecimalValue'),
    candidates: $('candidateBlock'), choices: $('candidateList'), strips: $('intervalStrip'),
    candidateTotal: $('candidateTotal'), intervalDescription: $('intervalDescription'),
    intervalRows: $('candidateIntervalRows'),
    hexOrigin: $('hexOrigin'), emptiesLabel: $('emptiesLabel'),
    rankCarry: $('rankCarry'), rankBoxes: $('rankBoxes'), rankNote: $('rankNote'), fullDigits: $('fullDigits'),
    decisionBlock: $('decisionBlock'), decisionList: $('decisionList'), decisionCount: $('decisionCount'),
    treeLesson: $('treeLesson'), treeDiagram: $('treeDiagram'), treeArithmetic: $('treeArithmetic'),
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
  // 'guided' groups the trace into ~16 steps; 'full' shows every decision. Both
  // read the same verified trace: grouping is presentation only.
  let view = 'guided', guidedSteps = [], showAllDigits = false, origin = null;

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
    el.trust.innerHTML = error ? 'Not verified' : 'Checked against the codec <span aria-hidden="true">✓</span>';
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
    el.intervalRows.replaceChildren();
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
    el.intervalDescription.textContent = `Each segment is one choice, as wide as the number of finished boards beneath it. The dark line is the incoming rank; the green segment is the one choice whose range contains it, with ${step.picked} earlier choice${step.picked === 1 ? '' : 's'} to its left. Hover or tap a choice to see its squares.`;
    buildIntervalRows(step);

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

  // Every candidate corresponds to a contiguous interval of finished boards.
  // The rank is repeatedly rebased within the interval that contains it.
  function branchRange(step) {
    const choices = step.choices || [];
    if (step.picked < 0 || step.picked >= choices.length) return null;
    const before = BigInt(step.before);
    const skipped = choices.slice(0, step.picked).reduce((n, c) => n + BigInt(c.count), 0n);
    const count = BigInt(choices[step.picked].count);
    return {
      label: choices[step.picked].label,
      incoming: before, start: skipped, end: skipped + count - 1n,
      count, local: before - skipped, earlier: step.picked,
      later: choices.length - step.picked - 1
    };
  }
  function makeTextNode(tag, className, content) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    e.textContent = String(content);
    return e;
  }
  function teachingLine(parent, number, title, expression, detail) {
    const row = document.createElement('div'); row.className = 'walk-row';
    row.append(makeTextNode('span','walk-number',number));
    const body = document.createElement('div'); body.className = 'walk-body';
    body.append(makeTextNode('strong','walk-title',title));
    if (expression) body.append(makeTextNode('code','walk-expression',expression));
    if (detail) body.append(makeTextNode('p','walk-detail',detail));
    row.append(body); parent.append(row);
  }

  // Long integers read as 1.1357 × 10²⁹ unless the reader asks for every digit.
  const SUPERSCRIPT = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹' };
  function num(value) {
    const s = String(value);
    if (!/^\d+$/.test(s) || showAllDigits || s.length <= 12) return comma(s);
    // Non-breaking spaces: a shortened number wraps as one unit, never as "10²⁶" alone.
    return `${s[0]}.${s.slice(1, 5)}\u00A0×\u00A010${[...String(s.length - 1)].map(c => SUPERSCRIPT[c]).join('')}`;
  }
  function rankBox(label, value, sub, cls) {
    const box = document.createElement('div');
    box.className = 'rank-box' + (cls ? ' ' + cls : '');
    box.append(makeTextNode('span', 'rank-label', label));
    const v = makeTextNode('code', 'rank-value', typeof value === 'bigint' || /^\d+$/.test(String(value)) ? num(value) : value);
    if (/^\d+$/.test(String(value))) v.title = comma(value);
    box.append(v);
    if (sub) box.append(makeTextNode('small', 'rank-sub', sub));
    return box;
  }
  function rankChainFor(step) {
    const t = trace;
    if (step.combined && step.before !== null && step.after !== null) {
      const n = step.parts.filter(p => p.choices && p.choices.length).length;
      return { boxes: [rankBox('Rank coming in', step.before), rankBox(`${n} forks`, 'each as before', 'pick, subtract, pass on'), rankBox('Rank going out', step.after, 'to the next step', 'out')],
        note: 'The same rule at every fork. The decisions list in the walkthrough shows the rank entering and leaving each one.' };
    }
    const r = branchRange(step);
    if (r) {
      return { boxes: [
          rankBox('Incoming rank n', r.incoming),
          rankBox(`Skip ${r.earlier} earlier`, '− ' + num(r.start), 'boards in earlier branches'),
          rankBox('Falls in ' + r.label, `${num(r.start)} …\n… ${num(r.end)}`, `${num(r.count)} boards`),
          rankBox('New rank', r.local, 'passed to the next fork', 'out')],
        note: `${num(r.start)} ≤ ${num(r.incoming)} ≤ ${num(r.end)}, so the choice is ${r.label}. Subtracting the earlier branches renumbers this one from 0.` };
    }
    switch (step.phase) {
      case 'intro': return { boxes: [rankBox('Code', t.code), rankBox('Becomes', 'one integer', 'next two steps', 'out')],
        note: 'Every piece on the board is chosen by one integer made from this code. The panel follows that integer from step to step.' };
      case 'packing': return { boxes: [rankBox('Hex value V', t.value), rankBox('+ length offset', '+ ' + num(t.offset)), rankBox('Payload P', t.payload, 'remembers the digit count', 'out')],
        note: 'P differs for 96E, 096E and 0096E, so leading zeros survive the trip.' };
      case 'whitening': return { boxes: [rankBox('Payload P', t.payload), rankBox('× M, mod C', 'permute', 'reversible'), rankBox('Rank N', t.whitened, 'enters the tree', 'out')],
        note: 'N is a position in the list of all C boards. From here on, only this number decides.' };
      case 'tree': return { boxes: [rankBox('Rank N', t.whitened), rankBox('Root holds', t.capacity, 'finished boards'), rankBox('First fork', 'file h', '14 pawn pairs', 'out')],
        note: 'The next steps follow N down the tree, one fork at a time.' };
      case 'material': return { boxes: [rankBox('Rank left', '0', 'all used', 'out')],
        note: 'The last piece used up the rest of the rank. Nothing is left over for the kings.' };
      case 'kings': return { boxes: [rankBox('Rank left', '0'), rankBox('Kings', 'fixed rule', 'first safe pair', 'out')],
        note: 'The kings carry none of the rank. A fixed safety rule puts them down, so the decoder just lifts them off again.' };
      case 'decode': return { boxes: [rankBox('Board', 'read back'), rankBox('Rank N', t.recoveredRank), rankBox('Payload P', t.recoveredPayload), rankBox('Code', t.scanned.hex, '', 'out')],
        note: 'Run backwards: the board gives back N, the inverse of M gives back P, and P gives back the digits and their count.' };
      case 'finish': return { boxes: [rankBox('Code in', t.code), rankBox('Board', '64 squares'), rankBox('Code out', t.scanned.hex, 'identical', 'out')],
        note: 'The app’s scanner read the board and re-encoded the result. All 64 squares matched.' };
    }
    return null;
  }
  function renderRank(step) {
    const chain = rankChainFor(step);
    el.rankCarry.hidden = !chain;
    el.rankBoxes.replaceChildren();
    if (!chain) return;
    for (const b of chain.boxes) el.rankBoxes.append(b);
    // 4 boxes read as two rows of two; 3 or fewer sit in one row.
    el.rankBoxes.dataset.n = String(chain.boxes.length);
    el.rankBoxes.style.setProperty('--cols', String(chain.boxes.length === 4 ? 2 : chain.boxes.length));
    el.rankCarry.classList.toggle('all-digits', showAllDigits);
    el.rankNote.textContent = chain.note;
  }

  function showDecisions(step) {
    const parts = step.combined ? step.parts.filter(p => p.choices && p.choices.length) : [];
    el.decisionBlock.hidden = !parts.length;
    el.decisionList.replaceChildren();
    if (!parts.length) return;
    const empties = parts.filter(p => p.optional).length;
    el.decisionCount.textContent = empties ? `${parts.length} forks · ${empties} empty` : `${parts.length} forks`;
    for (const p of parts) {
      const li = document.createElement('li');
      if (p.optional) li.className = 'is-empty';
      li.append(makeTextNode('span', 'decision-title', p.title));
      li.append(makeTextNode('code', 'decision-rank', `${num(p.before)} → ${num(p.after)}`));
      el.decisionList.append(li);
    }
  }

  // Where the code is on the map, using the app's own decoders and frozen grid.
  // Only meaningful for a plain code: a passphrase or obfuscation would put the
  // same digits somewhere else, and the board never depends on which.
  function locate(mode, code) {
    try {
      if (mode === 'healpix') {
        if (typeof HealpixGrids === 'undefined') return null;
        const ll = HealpixGrids.decode('hphex', code, null);
        if (!ll || !isFinite(ll[0]) || !isFinite(ll[1])) return null;
        return { lat: ll[0], lon: ll[1], what: `HEALPix order-${HealpixGrids.inferOrder('hphex', code)} cell`, href: './?hphex=' + code };
      }
      if (typeof GeoCodec === 'undefined' || typeof hexByteArray === 'undefined') return null;
      const ll = GeoCodec.decodeHierarchical(code, hexByteArray);
      if (!ll || !isFinite(ll[0]) || !isFinite(ll[1])) return null;
      return { lat: ll[0], lon: ll[1], what: `${code.length / 2}-pair HexByte cell`, href: './?h=' + code };
    } catch (_) { return null; }
  }
  function coord(v) { return v.toFixed(6).replace('-', '−'); }
  function showOrigin(step) {
    el.hexOrigin.hidden = step.phase !== 'intro';
    if (step.phase !== 'intro') return;
    el.hexOrigin.replaceChildren();
    const card = trace.mode === 'healpix' ? 'HEALPix' : 'HexByte';
    if (!origin) {
      el.hexOrigin.textContent = `These digits are not a plain ${card} code, so there is no place to show. The board does not need one: it is built from the digits alone.`;
      return;
    }
    const isExample = trace.code === DEFAULTS[trace.mode];
    const lead = isExample
      ? `Where it came from: the office example, −43.524136, 172.584394, as a ${origin.what} (centre ${coord(origin.lat)}, ${coord(origin.lon)}). `
      : `Read as a plain code, this is the ${origin.what} centred on ${coord(origin.lat)}, ${coord(origin.lon)}. `;
    el.hexOrigin.append(document.createTextNode(lead));
    const a = document.createElement('a');
    a.href = origin.href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Show on the map';
    el.hexOrigin.append(a);
    if (!isExample) el.hexOrigin.append(document.createTextNode('. With a passphrase or obfuscation the same digits belong to a different place; the board is the same either way.'));
    else el.hexOrigin.append(document.createTextNode('.'));
  }

  function combine(group, extra) {
    const first = group[0], last = group[group.length - 1];
    return Object.assign({
      phase: first.phase, board: last.board, eligible: [], unsafe: [], choices: [], picked: -1,
      highlight: [...new Set(group.flatMap(s => s.highlight || []))],
      before: first.before, after: last.after, optional: false, combined: true, parts: group, math: []
    }, extra);
  }
  function buildGuided(steps) {
    const by = ph => steps.filter(s => s.phase === ph);
    const pawns = by('pawns'), bishops = by('bishops'), kings = by('kings'), decode = by('decode');
    const material = by('material');
    const ranked = material.filter(s => s.choices.length);
    const trailing = material.find(s => !s.choices.length);
    const restMat = ranked.slice(1);
    const pieces = restMat.filter(s => !s.optional).length;
    return [
      ...by('intro'), ...by('packing'), ...by('whitening'), ...by('tree'),
      pawns[0], pawns[1],
      combine(pawns.slice(2), {
        title: 'Files f to a: the same fork six more times',
        description: 'Each file works exactly like h and g: the rank coming in falls inside one pawn pair’s range, the earlier ranges are subtracted, and what is left goes to the next file. The list below shows the rank entering and leaving each file.',
        math: [['Rank entering this group', pawns[2].before], ['Rank leaving this group', pawns[7].after], ['Decisions in this group', '6']]
      }),
      bishops[0],
      combine(bishops.slice(1), {
        title: 'The other three bishops',
        description: 'White’s dark-square bishop, then Black’s light-square and dark-square bishops, each chosen the same way from the free squares of its colour. Only squares still empty are candidates, so every choice narrows the next.',
        math: [['Rank entering this group', bishops[1].before], ['Rank leaving this group', bishops[3].after], ['Decisions in this group', '3']]
      }),
      ranked[0],
      combine(restMat.concat(trailing ? [trailing] : []), {
        title: 'The rest of the pieces',
        description: `The remaining free squares are decided the same way, one square at a time from a1 upwards: ${pieces} more pieces and ${restMat.length - pieces} empty squares, where “empty” is a choice with its own range. ${trailing ? trailing.description : ''}`,
        before: restMat[0].before, after: restMat[restMat.length - 1].after,
        highlight: trailing ? trailing.highlight : [],
        math: [['Rank entering this group', restMat[0].before], ['Rank leaving this group', restMat[restMat.length - 1].after], ['Decisions in this group', String(restMat.length)]].concat(trailing ? trailing.math : [])
      }),
      kings[0], kings[2], kings[3],
      combine(decode, {
        title: 'Read it back',
        description: 'Lift the two kings off: they carry nothing. Ranking the pawns, bishops and other pieces in reverse gives back the same rank N. Multiplying by the inverse of M gives back the payload P, and P gives back the digits, including how many there were.',
        board: decode[0].board, highlight: decode[0].highlight,
        before: null, after: null, math: decode.flatMap(d => d.math)
      }),
      ...by('finish')
    ];
  }

  function buildIntervalRows(step) {
    let start = 0n;
    for (let i = 0; i < step.choices.length; i++) {
      const c = step.choices[i];
      const size = BigInt(c.count);
      const end = start + size - 1n;
      const row = document.createElement('tr');
      if (i === step.picked) row.className = 'selected';
      for (const value of [
        `${i === step.picked ? '✓ ' : ''}${c.label}`,
        comma(size),
        size > 0n ? `${comma(start)} … ${comma(end)}` : '(no completions)'
      ]) {
        row.append(makeTextNode('td','',value));
      }
      el.intervalRows.append(row);
      start += size;
    }
  }

  function treeItem(title, subtitle, className) {
    const li = document.createElement('li');
    if (className) li.className = className;
    const node = document.createElement('div'); node.className = 'tree-node';
    node.append(makeTextNode('strong','tree-node-title',title));
    node.append(makeTextNode('small','tree-node-detail',subtitle));
    li.append(node);
    return li;
  }
  function summarizeOtherChoices(count, side, skipped) {
    const noun = count === 1 ? 'branch' : 'branches';
    return `${count} ${side} ${noun} · ${skipped} complete arrangements`;
  }
  function showTree(step) {
    el.treeLesson.hidden = step.phase !== 'tree';
    if (step.phase !== 'tree') return;
    el.treeDiagram.replaceChildren();
    el.treeArithmetic.replaceChildren();
    const pawnSteps = trace.steps.filter(s => s.phase === 'pawns');
    if (pawnSteps.length < 2) return;
    const h = branchRange(pawnSteps[0]), g = branchRange(pawnSteps[1]);
    if (!h || !g) return;
    const hTotal = sumCounts(pawnSteps[0].choices);
    const gTotal = sumCounts(pawnSteps[1].choices);
    const root = document.createElement('ul'); root.className = 'tree-list tree-root';
    const rootNode = treeItem('ROOT · All possible non-king boards',
      `${comma(hTotal)} complete arrangements; one has whitened rank ${comma(h.incoming)}.`, 'root-node');
    root.append(rootNode);
    const hBranches = document.createElement('ul'); hBranches.className = 'tree-list tree-children';
    if (h.earlier) hBranches.append(treeItem(`Other h-file choices before ${h.label}`,
      summarizeOtherChoices(h.earlier,'earlier',comma(h.start)), 'collapsed-node'));
    const hNode = treeItem(`BRANCH · h-file pawns ${h.label} ✓`,
      `SUBTREE · ${comma(h.count)} finished boards; local rank ${comma(h.local)}`, 'chosen-node');
    hBranches.append(hNode);
    const gBranches = document.createElement('ul'); gBranches.className = 'tree-list tree-children';
    if (g.earlier) gBranches.append(treeItem(`Other g-file choices before ${g.label}`,
      summarizeOtherChoices(g.earlier,'earlier',comma(g.start)), 'collapsed-node'));
    const gNode = treeItem(`BRANCH · g-file pawns ${g.label} ✓`,
      `SMALLER SUBTREE · ${comma(g.count)} finished boards; local rank ${comma(g.local)}`, 'chosen-node');
    gBranches.append(gNode);
    const continuation = document.createElement('ul'); continuation.className = 'tree-list tree-children';
    continuation.append(treeItem('Continue: f → e → d → c → b → a',
      'Then bishops, other pieces, and finally one complete board (a leaf).', 'future-node'));
    gNode.append(continuation);
    if (g.later) gBranches.append(treeItem(`Other g-file choices after ${g.label}`,
      summarizeOtherChoices(g.later,'later',comma(gTotal - g.end - 1n)), 'collapsed-node'));
    hNode.append(gBranches);
    if (h.later) hBranches.append(treeItem(`Other h-file choices after ${h.label}`,
      summarizeOtherChoices(h.later,'later',comma(hTotal - h.end - 1n)), 'collapsed-node'));
    rootNode.append(hBranches);
    el.treeDiagram.append(root);
    el.treeDiagram.setAttribute('aria-label',
      `Decision tree: root ${comma(hTotal)} boards. Rank ${comma(h.incoming)} chooses h pawns ${h.label}, then local rank ${comma(h.local)} chooses g pawns ${g.label}.`);
    const note = makeTextNode('p','tree-path-title','Follow the actual index through the first two forks');
    el.treeArithmetic.append(note);
    teachingLine(el.treeArithmetic,'H',`File h: locate ${h.label}`,
      `${comma(h.start)} ≤ ${comma(h.incoming)} ≤ ${comma(h.end)}`,
      `The ${h.earlier} earlier h-file options account for ${comma(h.start)} completed boards. Subtract them: ${comma(h.incoming)} − ${comma(h.start)} = ${comma(h.local)}. This is the rank entering file g.`);
    teachingLine(el.treeArithmetic,'G',`File g: locate ${g.label}`,
      `${comma(g.start)} ≤ ${comma(g.incoming)} ≤ ${comma(g.end)}`,
      `Now count only boards inside the already-chosen h-file subtree. At file g, ${g.earlier} earlier options account for ${comma(g.start)} completions. Subtract again: ${comma(g.incoming)} − ${comma(g.start)} = ${comma(g.local)}. That rank continues to file f.`);
    if (h.local !== g.incoming)
      el.treeArithmetic.append(makeTextNode('p','walk-warning','The sample trace does not link these two local ranks correctly.'));
  }

  // Teaching notes accompany EVERY number shown by the trace. They explain
  // the mathematical object, not just the arithmetic operation. A single
  // dictionary avoids diverging explanations between chapters.
  const MATH_HELP = Object.freeze({
    'Hex digits (L)': 'L is the number of hexadecimal characters in the original string. Leading zeros count: 0B and B are different Geosonify codes even though they have the same numerical value.',
    'Hex value (V, decimal)': 'V is the base-10 integer represented by the hexadecimal characters. Each character contributes its numerical value (0–15) multiplied by 16 to the power of its position from the right. The expansion above shows every contribution.',
    'Length offset (16ᴸ − 1) / 15': 'There are 16 possible one-digit strings, 16² two-digit strings, and so forth. This offset is 1 + 16 + ⋯ + 16^(L−1): a reserved initial slot plus all shorter nonempty strings. Adding it prevents codes with different lengths from collapsing to the same integer.',
    'Packed payload (P = offset + V)': 'P is the unique integer assigned to this exact string, including its length. From P, the decoder can work out L, subtract the corresponding offset, and write V back as exactly L hex digits—restoring leading zeros.',
    'Board capacity (C)': 'C is the exact number of distinct non-king arrangements in this fixed-material chessboard family. They can be numbered from 0 to C−1. The two kings are not counted as data: their safe squares are chosen deterministically afterwards. This is not a count of all legal chess positions.',
    'Coprime multiplier (M)': 'M is a fixed integer sharing no factor greater than 1 with C (their greatest common divisor is 1). That guarantees M has a modular inverse: multiplying ranks by M and taking the remainder modulo C permutes them without collisions.',
    'Whitened rank (P × M mod C)': 'A rank is a zero-based index in an agreed ordering of all the possible complete non-king boards—not a chess rating. The remainder after division by C is the starting index n. The next step walks a decision tree: n selects one of 14 blocks for file h, then its local remainder selects a block for file g, and so on. M spreads neighbouring inputs across this index range, but changes no boards or information.',
    'Starting rank (N)': 'This is exactly the whitened rank from the preceding step, carried unchanged to the root of the decision tree. The first pawn-file choice uses N to locate one of 14 consecutively counted branches.',
    'First fork': 'The tree is split by the position of the white and black pawns on the h-file. Each legal pawn pair corresponds to a branch with a potentially different number of possible complete boards beneath it. The rank determines the branch by falling inside its block of indices.',
    'Previous rank': 'This is the incoming local index n just before this decision. At file h it equals the whitened rank N. At file g it equals the number shown as “rank within selected branch” after file h; the same hand-off continues through subsequent files, bishops, and other material. “Previous” means before THIS choice, not an unrelated previous board.',
    'Skipped earlier completions': 'Call the sum of the branch sizes before the chosen option S. Each branch size counts ALL complete non-king boards possible after fixing that choice, not the number of empty squares or the number of pawns. Since n falls beyond those preceding blocks, subtract S to make the chosen branch start at 0.',
    'Skipped earlier arrangements': 'The same tree method now applies to the remaining multiset of pieces. At the current square, candidate symbols (including “empty”) are tried in fixed order. Each symbol represents every possible arrangement of the remaining pieces; subtract the counts of symbols before the chosen one.',
    'Rank within selected branch': 'This is n(next) = n(previous) − S, where S is the total number of full-board continuations in branches before the selected option. We have not made the code smaller or thrown away information: we merely renumbered the chosen subtree from 0. This exact integer is carried into the NEXT decision.',
    'Selected interval size': 'This counts how many complete boards remain possible beneath the chosen branch. If there are c completions, their local indices are 0 through c−1 inclusive, and the newly rebased rank must lie in this range. This count is also called the size of the selected subtree.',
    'Material decisions': 'How many free squares the material ranking decides, each as queen, rook, knight or empty. It stops two short of the free squares, so two are always left unranked.',
    'Trailing empty squares': 'The two free squares the material ranking never reaches, so they stay empty. They make room for two more pieces, but the kings are placed separately and take the first safe pair of empty squares from a1 up, not these.',
    'Rank entering this group': 'The local rank handed over by the step before, exactly as it would enter the first of these decisions in Every decision view.',
    'Rank leaving this group': 'What is left after the last decision in the group, after each fork has subtracted the boards in its earlier branches. It goes on to the next step unchanged.',
    'Decisions in this group': 'How many forks this guided step bundles together. Every decision view shows them one at a time.',
    'White-king candidates considered': 'The source algorithm checks empty squares in ascending index order (a1, b1, …, h8). This counts the white-square attempts through the first one that also allows a safe black-king partner.',
    'First viable white square': 'The earliest empty square not attacked by Black for which the algorithm can also find a different, non-adjacent, unattacked square for the Black king. Its choice encodes no new information.',
    'White king': 'The White king goes onto that canonical first safe square. Because the rule is fixed, the decoder can remove both kings before ranking the information-bearing pieces.',
    'Black-king square chosen': 'For the chosen white square, the encoder takes the first empty square that Black can occupy safely, without adjacency to White. It is determined by the other pieces rather than by additional coordinate bits.',
    'King pair': 'These are the deterministic safe king squares. They complete a recognisable chess position while leaving the reversible code wholly in the other thirty pieces.',
    'Recovered board rank (N)': 'The reverse ranking calculations read pawns, bishops and the remaining material to reconstruct the same whitened integer that the forward encoder used.',
    'Matches forward rank?': 'This checks exact integer equality with the rank computed before the board was constructed. Equal ranks show that the placement and reverse-counting steps agree.',
    'Modular inverse (M⁻¹)': 'This is the integer whose product with M leaves remainder 1 when divided by C. Multiplying the whitened rank by M⁻¹ and taking “mod C” undoes the scrambling; it is not ordinary floating-point division.',
    'Recovered payload (N × M⁻¹ mod C)': 'This reverses whitening and gives the same length-aware integer P calculated in Step 2. The decoder then determines the original digit length, subtracts the length offset and formats the hexadecimal digits.',
    'Recovered code': 'The resulting hexadecimal string, including its original leading zeros. It must match the original input character for character, not merely as a numerical value.',
    'Recovered hex': 'The original hexadecimal code reconstructed from the board. It carries the same coordinate because its characters and length are exactly preserved.',
    'FEN': 'Forsyth–Edwards Notation: letters identify chess pieces, digits count consecutive empty squares, and slashes separate the eight ranks. The card uses the piece-placement field; it does not claim a particular history of legal moves.',
    '64-square scan': 'The scanner decodes the board and then re-encodes the recovered code. All 64 squares must match the supplied canonical position, so a hand-edited board is not accepted as though it were a Geosonify card.'
  });
  const MATH_CONTEXT = Object.freeze({
    packing: 'The first task is to turn a string into a single integer without losing how many digits it had. This uses positional value plus a length offset.',
    whitening: 'Whitening gives us N, an exact index between 0 and C−1. The very next step uses this SAME number to choose a branch of the decision tree. There is no random or hidden mapping between the two steps.',
    tree: 'Read the diagram from the root. Every branch restricts which complete boards are still possible. A rank belongs to one branch interval; after entering it, subtract the sizes of all earlier branches and pass the new local rank to the next fork.',
    pawns: 'The whitened rank N is used unchanged at file h; each subsequent file gets the local rank left by the preceding file. The encoder does not turn individual hex digits into pawn coordinates. It compares one integer with precisely counted intervals of complete-board possibilities.',
    bishops: 'After the a-file pawn decision, the SAME carried-forward local rank chooses the white light-square bishop, then white dark-square, black light-square, and black dark-square. Candidate square intervals again represent counts of all compatible finished boards.',
    material: 'The local rank remaining after the last bishop selects what occupies each remaining square. Candidate symbols form branches just as pawn pairs did: each is weighted by the number of ways to complete the multiset, and “empty” is a genuine option.',
    kings: 'King placement is an entirely separate deterministic safety check. No encoded digits or rank information are consumed at this stage.',
    decode: 'The reversible steps are now performed in the opposite order. Modular inverses and length-aware packing make the precise original code recoverable.',
    finish: 'This is a source-verified round trip: the decoded code produces exactly the same arrangement when re-encoded.'
  });

  function showHexSteps(step) {
    const shown = step.phase === 'intro' || step.phase === 'packing';
    el.hexSpotlight.hidden = !shown;
    el.hexBreakdown.hidden = step.phase !== 'packing';
    if (!shown) return;
    const digits = trace.code;
    el.hexMode.textContent = trace.mode === 'healpix' ? 'HEALPix' : 'LAT / LON HEXBYTE';
    el.hexDigits.replaceChildren();
    for (const digit of digits) {
      const chip = document.createElement('span');
      chip.className = 'hex-digit';
      chip.textContent = digit;
      el.hexDigits.appendChild(chip);
    }
    el.hexDigits.setAttribute('aria-label', digits.split('').join(' '));
    el.hexCaption.textContent = step.phase === 'intro'
      ? `This complete ${digits.length}-character code is the input. Watch it become a chessboard without changing or losing a single digit.`
      : 'The same exact string, now interpreted as a base-16 number. The characters are unchanged; the calculation below assigns them a numerical value.';
    if (step.phase !== 'packing') return;
    el.hexDecimalValue.textContent = comma(trace.value);
    el.hexTermCount.textContent = `${digits.length} DIGITS`;
    el.hexTerms.replaceChildren();
    let check = 0n;
    for (let i = 0; i < digits.length; ++i) {
      const char = digits[i];
      const power = digits.length - 1 - i;
      const numeric = BigInt(parseInt(char, 16));
      const weight = 16n ** BigInt(power);
      const contribution = numeric * weight;
      check += contribution;
      const row = document.createElement('li');
      const term = document.createElement('span'); term.className = 'hex-term-equation';
      const digit = document.createElement('strong'); digit.className = 'hex-term-digit'; digit.textContent = char;
      const exponent = document.createElement('span');
      exponent.append(document.createTextNode(' × 16'));
      const sup = document.createElement('sup'); sup.textContent = String(power);
      exponent.append(sup);
      const expanded = document.createElement('small');
      expanded.textContent = /[A-F]/.test(char) ? `(${char} = ${numeric.toString()})` : '';
      term.append(digit, exponent, expanded);
      const answer = document.createElement('code'); answer.textContent = comma(contribution);
      row.append(term, answer);
      el.hexTerms.appendChild(row);
    }
    if (check !== trace.value) throw new Error('Displayed hex expansion failed its exact-integer check.');
  }

  function showMath(step) {
    const rows = (step.math || []).slice();
    if (step.choices && step.choices.length) {
      rows.push(['Selected interval size', step.choices[step.picked].count]);
    }
    el.numbers.hidden = rows.length === 0;
    el.math.replaceChildren();
    if (!rows.length) return;
    const context = document.createElement('p');
    context.className = 'math-context';
    context.textContent = MATH_CONTEXT[step.phase] || 'The quantities used by the source codec for this step are explained below.';
    el.math.appendChild(context);
    for (const [key, value] of rows) {
      const row = document.createElement('div'); row.className = 'math-row';
      const heading = document.createElement('div'); heading.className = 'math-row-heading';
      const label = document.createElement('span'); label.className = 'key'; label.textContent = key;
      const output = document.createElement('code'); output.textContent = comma(value);
      heading.append(label, output);
      const help = document.createElement('p'); help.className = 'math-help';
      help.textContent = MATH_HELP[key] || 'A source-code value used to reproduce this exact deterministic step.';
      row.append(heading, help);
      el.math.appendChild(row);
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
    showHexSteps(step);
    showOrigin(step);
    showTree(step);
    el.timeline.value = String(stepIndex);
    el.timeline.setAttribute('aria-valuetext', `Step ${stepIndex + 1}: ${step.title}`);
    el.back.disabled = stepIndex === 0;
    el.next.disabled = stepIndex === visibleSteps.length - 1;
    el.next.innerHTML = stepIndex === visibleSteps.length - 2 ? '<span>Finish</span> →' : '<span>Next</span> →';
    paintBoard(step);
    showCandidates(step);
    showDecisions(step);
    renderRank(step);
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
    visibleSteps = view === 'guided' ? guidedSteps
      : trace.steps.filter(step => !step.optional || el.showEmpties.checked);
    // Keep the reader's place when switching views: a grouped step maps to its first
    // decision, a single decision to the group that contains it.
    let old = visibleSteps.indexOf(anchor);
    if (old < 0 && anchor.combined) old = visibleSteps.indexOf(anchor.parts.find(p => visibleSteps.includes(p)));
    if (old < 0) old = visibleSteps.findIndex(s => s.combined && s.parts.includes(anchor));
    stepIndex = old >= 0 ? old : Math.max(0, visibleSteps.findIndex(s => s.phase === anchor.phase));
    el.timeline.max = String(visibleSteps.length - 1);
    rebuildNav();
    render();
  }
  function positionUrl() {
    if (!trace) return '#';
    // Same-site link, so a local or staging copy opens its own app. The FEN keeps its
    // slashes, as the app's own share links do (index.html CHESS_PARAM_MAP: fen / hpfen).
    const key = trace.mode === 'healpix' ? 'hpfen' : 'fen';
    return `./?${key}=${encodeURIComponent(trace.fen).replace(/%2F/g, '/')}`;
  }
  function explainerUrl() {
    const url = new URL(window.location.href);
    url.search = pageQuery(getMode(), el.input.value.trim().toUpperCase());
    url.hash = '';
    return url.toString();
  }

  // mode / code / view are this page's own parameters, not the app's URL grammar.
  function pageQuery(mode, code) {
    const q = new URLSearchParams({ mode, code });
    if (view === 'full') q.set('view', 'full');
    return q.toString();
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
      guidedSteps = buildGuided(result.steps);
      origin = locate(mode, result.code);
      el.input.value = result.code;
      visibleSteps = [];
      stepIndex = 0;
      lastPieces = new Array(64).fill(-1);
      hoveredSquares = null; pinnedSquares = null;
      el.openPosition.href = positionUrl();
      rebuildVisible();
      if (window.history && window.history.replaceState)
        window.history.replaceState(null, '', '?' + pageQuery(mode, result.code));
    } catch (error) {
      pause();
      setStatus(error && error.message ? error.message : String(error));
      trace = null; visibleSteps = []; stepIndex = 0;
      el.title.textContent = 'Could not build this position';
      el.description.textContent = 'Correct the code and try again. The encoder does not shorten invalid or over-precise codes.';
      el.phase.textContent = 'INPUT ERROR';
      el.stepCount.textContent = '';
      el.candidates.hidden = true; el.rejectedBlock.hidden = true; el.numbers.hidden = true;
      el.hexSpotlight.hidden = true; el.hexBreakdown.hidden = true; el.treeLesson.hidden = true;
      el.decisionBlock.hidden = true; el.rankCarry.hidden = true;
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
    for (const input of document.querySelectorAll('input[name="view"]')) {
      input.addEventListener('change', event => {
        view = event.target.value;
        el.emptiesLabel.hidden = view !== 'full';
        pause(); rebuildVisible();
        if (trace && window.history && window.history.replaceState)
          window.history.replaceState(null, '', '?' + pageQuery(trace.mode, trace.code));
      });
    }
    el.fullDigits.addEventListener('click', () => {
      showAllDigits = !showAllDigits;
      el.fullDigits.setAttribute('aria-pressed', String(showAllDigits));
      el.fullDigits.textContent = showAllDigits ? 'Shorten numbers' : 'Show all digits';
      render();
    });
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
    if (query.get('view') === 'full') {
      view = 'full';
      const radio = document.querySelector('input[name="view"][value="full"]');
      if (radio) radio.checked = true;
      el.emptiesLabel.hidden = false;
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
