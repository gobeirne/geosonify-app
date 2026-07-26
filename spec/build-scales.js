// SCRATCH BUILD TOOL — generates geosonify-scales-v1.js
// Re-run after editing the scale table. Refuses to emit if validation fails.

const fs = require('fs');

// ---- grid builder (geometry of the frozen musicalArray) --------------------
// THE MUSICAL CONTRACT: stand on any cell, set off in any of eight directions,
// and keep going. After n steps you are back where you started, because moving
// off an edge lands in the neighbouring parent cell with the child index
// wrapped. So adjacency is a TORUS, and a walk is a cycle — every one of the
// 8n^2/2 adjacent pairs is a transition somebody will actually hear.
//
// Two things make that musical, and both are deliberate:
//
// 1. STRUCTURE. Row and column indices are consecutive SCALE DEGREES, so N/S
//    moves one voice by one step, E/W moves the other, and a diagonal moves
//    both. The torus wrap is smooth for free, because scales are cyclic:
//    stepping off the last degree lands on the first, an octave up.
//
// 2. FILLER CHOICE. Lower-triangle cells carry a third note so they stay
//    distinct from their mirrored upper cell. That note is the ONLY free
//    variable in the entire grid, and it decides whether a walk sings or
//    lurches. We anneal it.
//
// Cost is measured in CENTS, not scale steps, so it is correct for quarter-
// tone and non-12-TET scales where "one step" is not a fixed size:
//   voice leading  - how far each voice must travel between adjacent cells
//   dissonance     - how rough each chord is on its own (a tiebreaker only;
//                    motion is what the walker experiences)
const NB8 = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

// Sensory dissonance by interval size in cents, folded to 0..600 (a fifth
// inverts to a fourth, a major 7th to a semitone). Peak roughness sits at the
// semitone; the tritone is a secondary bump.
const DISS_X = [0, 50, 100, 150, 200, 250, 300, 400, 500, 600];
const DISS_Y = [0, 0.70, 1.00, 0.78, 0.45, 0.26, 0.14, 0.10, 0.05, 0.40];
function dissonance(cents) {
  let x = Math.abs(cents) % 1200;
  if (x > 600) x = 1200 - x;
  for (let i = 1; i < DISS_X.length; i++) {
    if (x <= DISS_X[i]) {
      const t = (x - DISS_X[i - 1]) / (DISS_X[i] - DISS_X[i - 1]);
      return DISS_Y[i - 1] + t * (DISS_Y[i] - DISS_Y[i - 1]);
    }
  }
  return DISS_Y[DISS_Y.length - 1];
}
const circ = (a, b) => { const x = Math.abs(a - b) % 1200; return Math.min(x, 1200 - x); };

// Chamfer voice leading, in semitone-equivalents. Common tones cost nothing.
function voiceLead(A, B) {
  let c = 0;
  for (const a of A) { let m = Infinity; for (const b of B) m = Math.min(m, circ(a, b)); c += m; }
  for (const b of B) { let m = Infinity; for (const a of A) m = Math.min(m, circ(a, b)); c += m; }
  return c / 100;
}
function chordDiss(S) {
  let c = 0;
  for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) c += dissonance(circ(S[i], S[j]));
  return c;
}

const W_DISS = 25;    // tuned so output beats the frozen grid on BOTH metrics

function buildGrid(sym, pcCents, opts) {
  opts = opts || {};
  const n = sym.length;
  const grid = Array.from({ length: n }, () => new Array(n));
  const key = a => [...new Set(a)].sort((x, y) => x - y).join(',');
  const reserved = new Set();

  for (let i = 0; i < n; i++) { grid[i][i] = sym[i] + sym[i]; reserved.add(key([i, i])); }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    grid[i][j] = sym[i] + sym[j]; reserved.add(key([i, j]));
  }

  const cells = [];
  for (let i = 1; i < n; i++) for (let j = 0; j < i; j++) cells.push({ i, j });
  const lowerId = new Map();
  cells.forEach((c, k) => lowerId.set(c.i + ',' + c.j, k));

  // pitch content of any cell, given the current filler assignment
  const fill = new Array(cells.length).fill(-1);
  function content(i, j) {
    if (i === j) return [pcCents[i]];
    if (j > i) return [pcCents[i], pcCents[j]];
    const f = fill[lowerId.get(i + ',' + j)];
    return [pcCents[i], pcCents[j], pcCents[f]];
  }

  // TOROIDAL neighbours of a lower cell, and whether each is itself lower
  const nbrs = cells.map(c => NB8.map(([di, dj]) => [(c.i + di + n) % n, (c.j + dj + n) % n]));

  // --- initial feasible assignment: distinct-triad bipartite matching ------
  const cand = cells.map(c => {
    const out = [];
    for (let k = 0; k < n; k++) {
      if (k === c.i || k === c.j) continue;
      if (!reserved.has(key([c.i, c.j, k]))) out.push(k);
    }
    return out;
  });
  const owner = new Map();
  function augment(c, seen) {
    for (const k of cand[c]) {
      const kk = key([cells[c].i, cells[c].j, k]);
      if (seen.has(kk)) continue;
      seen.add(kk);
      if (!owner.has(kk) || augment(owner.get(kk), seen)) {
        const prev = fill[c];
        if (prev >= 0) owner.delete(key([cells[c].i, cells[c].j, prev]));
        owner.set(kk, c); fill[c] = k; return true;
      }
    }
    return false;
  }
  for (let c = 0; c < cells.length; c++) {
    if (!augment(c, new Set())) throw new Error(`n=${n}: no distinct-triad assignment`);
  }

  // --- cost -----------------------------------------------------------------
  const localCost = k => {
    const c = cells[k];
    const me = content(c.i, c.j);
    let t = W_DISS * chordDiss(me);
    for (const [a, b] of nbrs[k]) t += voiceLead(me, content(a, b));
    return t;
  };
  function totalCost() {
    let vl = 0, ds = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const me = content(i, j);
      ds += chordDiss(me);
      for (const [di, dj] of NB8) {
        const a = (i + di + n) % n, b = (j + dj + n) % n;
        if (a < i || (a === i && b < j)) continue;
        vl += voiceLead(me, content(a, b));
      }
    }
    const pairs = 4 * n * n;
    return { vl: vl / pairs, ds: ds / (n * n), score: vl / pairs + W_DISS * ds / (n * n) };
  }

  // --- anneal ---------------------------------------------------------------
  let rng = opts.seed || 987654321;
  const rand = () => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng / 0x7fffffff; };
  const tkey = (k, f) => key([cells[k].i, cells[k].j, f]);

  let best = totalCost().score, bestFill = fill.slice();
  const ITER = opts.iterations || 140000;
  for (let it = 0; it < ITER; it++) {
    const T = 0.9 * (1 - it / ITER) + 0.002;
    const c = Math.floor(rand() * cells.length);
    if (rand() < 0.6) {
      const k = cand[c][Math.floor(rand() * cand[c].length)];
      if (k === undefined || k === fill[c]) continue;
      const nk = tkey(c, k);
      if (owner.has(nk)) continue;
      const oldF = fill[c], ok = tkey(c, oldF);
      const before = localCost(c);
      fill[c] = k;
      const delta = localCost(c) - before;
      if (delta <= 0 || rand() < Math.exp(-delta / T)) { owner.delete(ok); owner.set(nk, c); }
      else fill[c] = oldF;
    } else {
      const c2 = Math.floor(rand() * cells.length);
      if (c2 === c || fill[c] === fill[c2]) continue;
      const k1 = fill[c], k2 = fill[c2];
      if (k2 === cells[c].i || k2 === cells[c].j) continue;
      if (k1 === cells[c2].i || k1 === cells[c2].j) continue;
      const n1 = tkey(c, k2), n2 = tkey(c2, k1);
      if (reserved.has(n1) || reserved.has(n2)) continue;
      const o1 = owner.get(n1), o2 = owner.get(n2);
      if ((o1 !== undefined && o1 !== c2) || (o2 !== undefined && o2 !== c)) continue;
      const before = localCost(c) + localCost(c2);
      const ok1 = tkey(c, k1), ok2 = tkey(c2, k2);
      fill[c] = k2; fill[c2] = k1;
      const delta = localCost(c) + localCost(c2) - before;
      if (delta <= 0 || rand() < Math.exp(-delta / T)) {
        owner.delete(ok1); owner.delete(ok2); owner.set(n1, c); owner.set(n2, c2);
      } else { fill[c] = k1; fill[c2] = k2; }
    }
    if ((it & 511) === 0) {
      const s = totalCost().score;
      if (s < best) { best = s; bestFill = fill.slice(); }
    }
  }
  for (let k = 0; k < fill.length; k++) fill[k] = bestFill[k];

  cells.forEach((c, k) => { grid[c.i][c.j] = sym[c.i] + sym[bestFill[k]] + sym[c.j]; });

  // --- canonical note order -------------------------------------------------
  // Every note in a token sounds in the SAME octave band, so order carries no
  // pitch information — but it should still read the way it sounds. Sort each
  // cell low-to-high by actual sounding pitch (pcCents, i.e. absolute pitch
  // class), which for a C-rooted scale is exactly the scale's own order:
  // C D E F G A B for Ionian. For a scale rooted elsewhere the two differ —
  // Hijaz on D contains a C that sounds BELOW its D — and sounding pitch is
  // the honest reading of "lowest to highest within the octave".
  //
  // Safe to do: cells are already guaranteed distinct as SETS, and sorting is
  // a function of the set, so distinct sets stay distinct strings. Decode is
  // by string match, so this must never be applied to a shipped grid.
  const byPitch = (a, b) => pcCents[a] - pcCents[b] || a - b;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const members = (i === j) ? [i, i]
      : (j > i) ? [i, j]
      : [cells[lowerId.get(i + ',' + j)].i, bestFill[lowerId.get(i + ',' + j)], cells[lowerId.get(i + ',' + j)].j];
    grid[i][j] = members.slice().sort(byPitch).map(x => sym[x]).join('');
  }
  const fin = totalCost();
  grid._vl = fin.vl; grid._ds = fin.ds; grid._score = fin.score;
  return grid;
}

// Score an existing grid (used to measure the frozen C-major grid).
function scoreGrid(grid, sym, pcCents) {
  const n = sym.length;
  const byLen = sym.slice().sort((a, b) => b.length - a.length);
  const tok = s => { const o = []; let i = 0;
    while (i < s.length) { const h = byLen.find(t => s.startsWith(t, i)); if (!h) return null; o.push(h); i += h.length; }
    return o; };
  const content = (i, j) => [...new Set(tok(grid[i][j].replace(/,$/, '')).map(x => sym.indexOf(x)))].map(x => pcCents[x]);
  let vl = 0, ds = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const me = content(i, j);
    ds += chordDiss(me);
    for (const [di, dj] of NB8) {
      const a = (i + di + n) % n, b = (j + dj + n) % n;
      if (a < i || (a === i && b < j)) continue;
      vl += voiceLead(me, content(a, b));
    }
  }
  const pairs = 4 * n * n;
  return { vl: vl / pairs, ds: ds / (n * n), score: vl / pairs + W_DISS * ds / (n * n) };
}

// ---- spelling --------------------------------------------------------------
// Modifiers are single lowercase chars: short, URL-unreserved, and they read
// the way musicians write ASCII ('Eb', 'Fs'). Note letters stay uppercase so
// greedy longest-match can never confuse 'Eb' with 'E'+'B'.
//   b = flat (-100)   s = sharp (+100)
//   d = half-flat (-50, VexFlow's own code)   p = half-sharp (+50, VexFlow '+')
const SHARP = ['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B'];
const FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const ACC = { '': null, 'd': 'd', 'b': 'b', 'p': '+', 's': '#' };
function renderOf(sym) {
  const m = /^([A-G])([bsdp])?$/.exec(sym);
  if (!m) return null;
  return [m[1].toLowerCase(), ACC[m[2] || '']];
}

// ---- scale table -----------------------------------------------------------
const T = [];

const D12 = (id, name, param, semis, spell, tonicPc = 0) => ({
  id, name, param, tonicPc, tet12: true, tonic: (spell === 'flat' ? FLAT : SHARP)[tonicPc % 12],
  symbols: semis.map(s => (spell === 'flat' ? FLAT : SHARP)[(s + tonicPc) % 12]),
  cents: semis.map(s => s * 100)
});

T.push(
  // The seven modes, FIXED-ROOT on C: same root, different interval pattern.
  // This is the convention a synth scale selector uses, and it matches every
  // other scale here. Ionian is C major - the same pitch set as the frozen
  // 'm' card, but with annealed fillers, so it is its own grid and its own
  // decode. The frozen card is untouched.
  D12('ionian','Ionian (major)','mionian',[0,2,4,5,7,9,11],'sharp'),
  D12('dorian','Dorian','mdorian',[0,2,3,5,7,9,10],'flat'),
  D12('phrygian','Phrygian','mphrygian',[0,1,3,5,7,8,10],'flat'),
  D12('lydian','Lydian','mlydian',[0,2,4,6,7,9,11],'sharp'),
  D12('mixolydian','Mixolydian','mmixolydian',[0,2,4,5,7,9,10],'flat'),
  D12('aeolian','Aeolian (natural minor)','maeolian',[0,2,3,5,7,8,10],'flat'),
  D12('locrian','Locrian','mlocrian',[0,1,3,5,6,8,10],'flat'),
  D12('harmonicminor','Harmonic Minor','mharmmin',[0,2,3,5,7,8,11],'flat'),
  D12('melodicminor','Melodic Minor','mmelmin',[0,2,3,5,7,9,11],'flat'),
  D12('neapolitanminor','Neapolitan Minor','mneapmin',[0,1,3,5,7,8,11],'flat'),
  D12('majpenta','Major Pentatonic','mmajpenta',[0,2,4,7,9],'sharp'),
  D12('minpenta','Minor Pentatonic','mminpenta',[0,3,5,7,10],'flat'),
  D12('egyptian','Egyptian (suspended)','megyptian',[0,2,5,7,10],'flat'),
  D12('ryukyu','Ryukyu (Okinawan)','mryukyu',[0,4,5,7,11],'sharp'),
  D12('hirajoshi','Hirajoshi','mhirajoshi',[0,2,3,7,8],'flat'),
  D12('insen','Insen','minsen',[0,1,5,7,10],'flat'),
  D12('iwato','Iwato','miwato',[0,1,5,6,10],'flat'),
  D12('majblues','Major Blues','mmajblues',[0,2,3,4,7,9],'flat'),
  D12('minblues','Minor Blues','mminblues',[0,3,5,6,7,10],'flat'),
  D12('wholetone','Whole Tone','mwholetone',[0,2,4,6,8,10],'sharp'),
  D12('prometheus','Prometheus','mprometheus',[0,2,4,6,9,10],'sharp'),
  D12('diminished','Diminished','mdiminish',[0,2,3,5,6,8,9,11],'flat'),
  D12('bebopdominant','Bebop Dominant','mbebop',[0,2,4,5,7,9,10,11],'flat'),
  D12('spanish','Spanish','mspanish',[0,1,3,4,6,8,9],'sharp',7),
  D12('romani','Romani (Hungarian minor)','mromani',[0,2,3,6,7,8,11],'sharp'),
  D12('arabian','Arabian (double harmonic)','marabian',[0,1,4,5,7,8,11],'flat'),
  D12('persian','Persian','mpersian',[0,1,4,5,6,8,11],'flat'),
  D12('acoustic','Acoustic (Lydian dominant)','macoustic',[0,2,4,6,7,9,10],'sharp'),
  D12('altered','Altered','maltered',[0,1,3,4,6,8,10],'flat'),
  D12('chromatic','Chromatic','mchromatic',[0,1,2,3,4,5,6,7,8,9,10,11],'sharp')
);

// Non-12-TET / quarter-tone: the reason the cents layer exists at all.
T.push(
  { id:'rast', name:'Maqam Rast', param:'mrast', tonicPc:0, tet12:false, tonic:'C',
    symbols:['C','D','Ed','F','G','A','Bd'], cents:[0,200,350,500,700,900,1050] },
  { id:'bayati', name:'Maqam Bayati', param:'mbayati', tonicPc:2, tet12:false, tonic:'D',
    symbols:['D','Ed','F','G','A','Bb','C'], cents:[0,150,300,500,700,800,1000] },
  { id:'saba', name:'Maqam Saba', param:'msaba', tonicPc:2, tet12:false, tonic:'D',
    symbols:['D','Ed','F','Gb','A','Bb','C'], cents:[0,150,300,400,700,800,1000] },
  { id:'hijaz', name:'Maqam Hijaz', param:'mhijaz', tonicPc:2, tet12:true, tonic:'D',
    symbols:['D','Eb','Fs','G','A','Bb','C'], cents:[0,100,400,500,700,800,1000] },
  { id:'miyako', name:'Miyako Bushi', param:'mmiyako', tonicPc:2, tet12:true, tonic:'D',
    symbols:['D','Eb','G','A','Bb'], cents:[0,100,500,700,800] },
  { id:'degung', name:'Degung (Sundanese pelog)', param:'mdegung', tonicPc:2, tet12:false,
    tonic:'1', symbols:['1','2','3','4','5'], cents:[0,115,345,685,800],
    render:[['d',null],['e','b'],['f',null],['a',null],['b','b']] },
  { id:'slendro', name:'Slendro (Javanese)', param:'mslendro', tonicPc:2, tet12:false,
    tonic:'1', symbols:['1','2','3','5','6'], cents:[0,231,474,717,955],
    render:[['d',null],['e',null],['f','+'],['a',null],['b','b']] },
  { id:'gongdiao', name:'Gong Diao', param:'mgong', tonicPc:0, tet12:true, tonic:'G',
    symbols:['G','S','J','Z','Y'], cents:[0,200,400,700,900],
    render:[['c',null],['d',null],['e',null],['g',null],['a',null]] }
);


T.unshift({
  id:'cmajor', name:'Music (C major)', param:'m', mode:true, tonic:null,
  tonicPc:0, tet12:true, symbols:['A','B','C','D','E','F','G'],
  cents:[900,1100,0,200,400,500,700]
});

// ---- validation ------------------------------------------------------------
const FROZEN = [
  ['AA,','AB,','CA,','DA,','EA,','FA,','GA,'],['EAB,','BB,','CB,','DB,','EB,','FB,','GB,'],
  ['CEA,','CBE,','CC,','CD,','CE,','CF,','CG,'],['DEA,','EDB,','CDE,','DD,','DE,','DF,','DG,'],
  ['GEA,','EGB,','CEF,','DEG,','EE,','EF,','EG,'],['CFA,','DFB,','CFG,','DFA,','EFB,','FF,','FG,'],
  ['DGA,','FGB,','CGA,','DGB,','CEG,','FGA,','GG,']
];
const RES = new Set([',','-','~','&','=','?','#','+','/','%']);
const tokFor = a => { const b=[...a].sort((x,y)=>y.length-x.length||(x<y?-1:1));
  return s=>{const o=[];let i=0;while(i<s.length){const h=b.find(t=>s.startsWith(t,i));
  if(!h)return null;o.push(h);i+=h.length;}return o;}; };

// How far the Western staff's drawn pitch sits from what the scale actually
// sounds, in cents. Above a quarter-tone the staff stops being an
// approximation and becomes misinformation — a reader would play a different
// scale — so those cards show the raw token column instead.
const STAFF_LETTER = { c:0, d:2, e:4, f:5, g:7, a:9, b:11 };
const STAFF_ACC = { '#':100, 'b':-100, '+':50, 'd':-50 };
function staffErrorCents(sc) {
  let worst = 0;
  for (let i = 0; i < sc.symbols.length; i++) {
    const actual = (sc.tonicPc * 100 + sc.cents[i]) % 1200;
    const [ltr, acc] = sc.render[i];
    const drawn = ((STAFF_LETTER[ltr] * 100 + (acc ? STAFF_ACC[acc] || 0 : 0)) % 1200 + 1200) % 1200;
    let err = actual - drawn;
    if (err > 600) err -= 1200;
    if (err < -600) err += 1200;
    worst = Math.max(worst, Math.abs(err));
  }
  return worst;
}

let ok = true; const rows = [];
for (const s of T) {
  if (!s.render) s.render = s.symbols.map(renderOf);
  if (s.symbols.length < 5) { console.log(`FAIL ${s.id}: only ${s.symbols.length} symbols (need >=5)`); ok = false; continue; }
  s._pc = s.cents.map(c => { let x=(s.tonicPc*100+c)%1200; if(x<0)x+=1200; return x; });
  s._grid = s.mode ? FROZEN.map(r=>r.map(c=>c.replace(/,$/,''))) : buildGrid(s.symbols, s._pc);
  s._sc = s.mode ? scoreGrid(s._grid, s.symbols, s._pc) : {vl:s._grid._vl, ds:s._grid._ds, score:s._grid._score};
  const tok = tokFor(s.symbols), flat = s._grid.flat();
  const sets = flat.map(t=>{const k=tok(t);return k?[...k].sort().join('\u0000'):null;});
  const unlex = sets.filter(x=>x===null).length;
  const distinct = new Set(sets.filter(Boolean)).size;
  const rt = flat.filter(t=>(tok(t)||[]).join('')!==t).length;
  const unsafe = s.symbols.filter(y=>[...y].some(c=>!/[A-Za-z0-9._~]/.test(c)||RES.has(c)));
  const lens = s.symbols.length===s.cents.length && s.cents.length===s.render.length;
  const badRender = s.render.filter(r=>!r).length;
  const dupSym = new Set(s.symbols).size !== s.symbols.length;
  const tonicOK = !s.tonic || s.symbols.indexOf(s.tonic) >= 0;
  const pass = !unlex&&!rt&&!unsafe.length&&lens&&distinct===flat.length&&!badRender&&!dupSym&&tonicOK;
  if (!pass) { ok=false;
    console.log(`FAIL ${s.id}: unlex=${unlex} rt=${rt} unsafe=${unsafe} lens=${lens} render=${badRender} dup=${dupSym} tonic=${tonicOK}`); }
  s._staffErr = staffErrorCents(s);
  rows.push([s.id, s.symbols.length, flat.length, Math.ceil(44.9/(2*Math.log2(s.symbols.length))),
             s.tet12?'12-TET':'micro', s._sc.vl.toFixed(3), s._staffErr + (s._staffErr > 50 ? 'c COLUMN' : 'c'), pass?'ok':'FAIL']);
}

const slugs = T.map(s=>s.param); const bad = [];
for (const p of slugs) {
  if (/^m[odr]{1,3}$/.test(p)) bad.push(`${p} would hijack m+flags`);
  for (const r of slugs) if (p!==r && p.startsWith(r) && /^[odr]{1,3}$/.test(p.slice(r.length)))
    bad.push(`${p} collides with ${r}+flags`);
}
console.log('slug collisions:', bad.length?bad:'none'); if (bad.length) ok = false;

console.log('\nid                n  cells  iters  tuning  voicelead staff    ');
for (const r of rows) console.log(r[0].padEnd(18)+String(r[1]).padEnd(3)+String(r[2]).padEnd(7)+String(r[3]).padEnd(7)+r[4].padEnd(8)+r[5].padEnd(10)+r[6].padEnd(11)+r[7]);

// ---- emit ------------------------------------------------------------------
const q = a => "['" + a.join("','") + "']";
let out = `/**
 * geosonify-scales-v1.js  — GENERATED by build-scales.js, do not hand-edit.
 *
 * Scale registry: tuning tables + grid arrays for the music card family.
 *
 * FROZEN: entries with grid:null read the frozen \`musicalArray\` from
 * geosonify-grids-data.js, so that format exists in exactly one place. Every
 * other grid here is NEW; once its card ships publicly it is frozen too,
 * because cell positions define what a published code means.
 *
 * WHY THE MODES CARRY NO GRID AND NO TUNING OF THEIR OWN:
 * Ionian, Dorian, Phrygian, Lydian, Mixolydian, Aeolian and Locrian are the
 * same seven pitches — they differ only in which one is home. They therefore
 * sound IDENTICAL frequencies to the C-major card; the only difference is
 * \`tonic\`, which anchors the lead. That makes them the cheapest cards in the
 * suite: no new array, and any existing music code can be heard in any of them.
 *
 * Tuning never travels in a URL. A link carries WHICH scale (via its param);
 * cents come from this table, so retuning stays a versioning decision.
 *
 * cents[]     distance from the scale's OWN tonic
 * tonicPc     semitones from C to that tonic
 * tonic       symbol the lead anchors on (null = infer from the place)
 * render[]    [staffLetter, vexflowAccidental]: 'd' quarter-flat, '+' quarter-
 *             sharp, 'b' flat, '#' sharp — verified present in VexFlow 4.2.3
 * iterations  default iterations to match the C-major card's ~45 bits
 *
 * Symbols use only RFC3986-unreserved characters, avoiding ',' (token
 * delimiter), '-' (BIP39), '~' (shape separator) and '#'/'+' (which corrupt a
 * query string). Modifiers: _ half-flat, __ flat, . half-sharp, .. sharp.
 *
 * GEOMETRY LIMIT: a scale needs at least FIVE symbols. Lower-triangle cells
 * need C(n,2) distinct triads drawn from C(n,3), which only holds for n>=5.
 * Below that the grid cannot be filled with sonically distinct cells at all,
 * so 2-, 3- and 4-note scales need a different cell scheme, not this one.
 */
(function (global) {
  'use strict';

  var SCALES = {
`;
out += T.map(s => {
  const g = s.mode ? `    grid: null,   // frozen musicalArray`
    : `    grid: [\n` + s._grid.map(r=>'      '+q(r.map(c=>c+','))).join(',\n') + `\n    ]`;
  return `    ${s.id}: {
    id: '${s.id}', name: ${JSON.stringify(s.name)}, param: '${s.param}',
    tet12: ${s.tet12}, tonicPc: ${s.tonicPc}, tonic: ${s.tonic?`'${s.tonic}'`:'null'},
    symbols: ${q(s.symbols)},
    cents: [${s.cents.join(', ')}],
    render: [${s.render.map(([l,a])=>`['${l}',${a?`'${a}'`:'null'}]`).join(', ')}],
    iterations: ${Math.ceil(44.9/(2*Math.log2(s.symbols.length)))},
    staffErrorCents: ${s._staffErr},
${g}
  }`; }).join(',\n\n');

out += `
  };

  // Greedy longest-match, matching GeoCodec.tokenizeCode. Returns null on an
  // unlexable string rather than dropping characters, so a code from the wrong
  // scale fails loudly instead of decoding to a plausible wrong place.
  function tokenize(scaleId, str) {
    var sc = SCALES[scaleId];
    if (!sc || typeof str !== 'string') return null;
    if (!sc._byLen) {
      sc._byLen = sc.symbols.slice().sort(function (a, b) {
        return b.length - a.length || (a < b ? -1 : 1);
      });
    }
    var out = [], i = 0;
    while (i < str.length) {
      var hit = null;
      for (var k = 0; k < sc._byLen.length; k++) {
        if (str.lastIndexOf(sc._byLen[k], i) === i) { hit = sc._byLen[k]; break; }
      }
      if (!hit) return null;
      out.push(hit);
      i += hit.length;
    }
    return out;
  }

  // Symbol -> absolute cents above C0 for a given octave index.
  // The tonic offset plus the interval-from-tonic can exceed an octave (e.g.
  // Locrian's A is 1000c above a B tonic, which is 2100c above C). Folding mod
  // 1200 keeps a symbol sounding at the pitch class it is NAMED for, inside
  // the octave band its token index selects — which is exactly what the legacy
  // name-based card does, and what makes the seven modes frequency-identical.
  function centsFor(scaleId, symbol, octave) {
    var sc = SCALES[scaleId];
    if (!sc) return null;
    var i = sc.symbols.indexOf(symbol);
    if (i < 0) return null;
    var pc = (sc.tonicPc * 100 + sc.cents[i]) % 1200;
    if (pc < 0) pc += 1200;
    return 1200 * (octave + 1) + pc;
  }

  // True when the Western staff would misrepresent this tuning by more than a
  // quarter-tone. Such a card shows its raw token column instead: the staff
  // would not be a rough guide but a wrong one, and a reader following it
  // would play a different scale. Slendro is the current case — its third
  // degree sounds 674c where the staff draws 550c, and its fifth sounds 1155c
  // where the staff draws 1000c.
  function usesTokenColumn(id) {
    var sc = SCALES[id];
    return !!sc && sc.staffErrorCents > 50;
  }

  function centsToHz(cents) { return 440 * Math.pow(2, (cents - 6900) / 1200); }
  function get(id) { return SCALES[id] || null; }
  function ids() { return Object.keys(SCALES); }
  function gridFor(id) {
    var sc = SCALES[id];
    if (!sc) return null;
    if (sc.grid) return sc.grid;
    return (typeof musicalArray !== 'undefined') ? musicalArray : null;
  }

  // Card definitions for CardRenderer, mirroring GISGrids.cardDefs() /
  // HealpixGrids.cardDefs(). 'cmajor' is deliberately EXCLUDED: the existing
  // 'music' card already covers it and must not be redefined.
  function cardDefs() {
    var defs = {};
    Object.keys(SCALES).forEach(function (id) {
      if (id === 'cmajor') return;
      var sc = SCALES[id];
      defs['scale_' + id] = {
        name: sc.name,
        grid: gridFor(id),
        defaultIterations: sc.iterations,
        maxIterations: Math.min(24, sc.iterations * 2 + 4),
        display: 'music',
        isEmoji: false,
        scaleId: id
      };
    });
    return defs;
  }

  // Param name -> scale id, for URL wiring.
  function paramMap() {
    var m = {};
    Object.keys(SCALES).forEach(function (id) {
      if (id === 'cmajor') return;
      m[SCALES[id].param] = 'scale_' + id;
    });
    return m;
  }

  global.GeoScales = {
    SCALES: SCALES, get: get, ids: ids, gridFor: gridFor,
    tokenize: tokenize, centsFor: centsFor, centsToHz: centsToHz,
    cardDefs: cardDefs, paramMap: paramMap, usesTokenColumn: usesTokenColumn
  };
  try { console.log('[geosonify] scales-v1 loaded (' + ids().length + ' scales)'); } catch (e) {}
})(typeof window !== 'undefined' ? window : this);
`;

fs.writeFileSync('/home/claude/geosonify-scales-v1.js', out);
const regen = T.find(s=>s.id==='cmajor')._grid.map(r=>r.map(c=>c+','));
const same = JSON.stringify(regen)===JSON.stringify(FROZEN);
console.log(`\ncmajor grid identical to frozen musicalArray: ${same}`);
console.log(`scales: ${T.length}   ${ok&&same?'ALL PASSED':'FAILURES — not emitted cleanly'}`);
process.exit(ok&&same?0:1);
