// ===== bundled Chessboard codec (geochess + catalogue + engine + parse-layer) =====
'use strict';
/*
 * GeoChess-Visible-104 — reference rank/unrank implementation
 * ===========================================================
 *
 * Related work: John Tromp's ChessPositionRanking, https://github.com/tromp/ChessPositionRanking
 *   — invertible ranking of legal chess positions and estimates of how many exist. This Geosonify
 *   Chessboard codec is NOT a port or adaptation of Tromp's code; it ranks one curated,
 *   fixed-material visible-board family to encode Geosonify hex strings, a different problem from
 *   ranking all legal positions. Acknowledged as notable prior work on chess-position ranking and
 *   legal-position capacity (kings-in-check, adjacent kings, monochromatic bishops, and so on).
 *
 * Spec (locked through Claude/ChatGPT design dialogue):
 *
 *   The carrier is a chessboard image. The DECODER sees only square -> {empty + 12 visible
 *   piece types}. No piece identity, no side-to-move, no castling/en-passant, no move history.
 *   So payload lives ONLY in the visible square contents.
 *
 *   Encoding is a pure mixed-radix / combinadic bijection between an integer N in [0, capacity)
 *   and a board in a STATICALLY-FILTERED family. No rejection, no stepping, no lookup table of
 *   boards (binomial tables are math support, not board tables). Every constraint is either
 *   BAKED INTO THE RANK (so the whole integer range maps onto valid boards) or omitted.
 *
 *   v1 family:
 *     - full 32-piece standard material, visible types only
 *     - exactly one pawn per file per side
 *     - white pawns on ranks 2..5, black pawns on ranks 4..7, no same-square collision
 *         -> 16 (w,b) rank combos minus 2 coinciding-rank collisions = 14 states per file
 *     - bishops: each side one light-square + one dark-square bishop, conditioned on the
 *         pawn-determined free-square colour partition (NOT a flat capacity discount)
 *     - two kings non-adjacent (king A over free squares, king B over free-minus-neighbours)
 *     - NO global attack/check filters in v1 (they are globally coupled; baking is hard,
 *         counting is expensive, stepping breaks decode)
 *
 *   LAYER ORDER (encode and decode MUST mirror this exactly, with fixed canonical square
 *   indexing throughout, or the mixed-radix unwinds to a different N):
 *     1. pawns
 *     2. reconstruct free-square set, partition by colour
 *     3. bishops by colour (white pair, then black pair)
 *     4. kings: king A, then king B over (free minus A's neighbours)
 *     5. remaining 10 pieces (Q,R,R,N,N per side) as a multiset permutation over what's left
 *
 * This file builds the SAME rank/unrank primitives once, then instantiates:
 *   - a TOY board small enough to enumerate every code exhaustively (catches conditioned-
 *     counting and indexing desync while the state space is tiny)
 *   - the FULL 8x8 GeoChess-Visible-104 family, tested by randomized round-trip
 */

// ---------------------------------------------------------------------------
// BigInt helpers
// ---------------------------------------------------------------------------
const ZERO = 0n, ONE = 1n;

function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }

// Binomial table C[n][k] as BigInt. This is mathematical support data, NOT a board table.
function buildBinom(maxN) {
  const C = [];
  for (let n = 0; n <= maxN; n++) {
    C[n] = new Array(n + 1);
    C[n][0] = ONE;
    C[n][n] = ONE;
    for (let k = 1; k < n; k++) C[n][k] = C[n - 1][k - 1] + C[n - 1][k];
  }
  return C;
}

// ---------------------------------------------------------------------------
// Combinadic: rank/unrank a k-subset of [0, n) by its sorted-ascending index.
// Bijection between [0, C(n,k)) and sorted k-subsets of {0..n-1}.
// ---------------------------------------------------------------------------
function combRank(subsetSortedAsc, n, C) {
  // subset is sorted ascending. Standard combinatorial number system.
  const k = subsetSortedAsc.length;
  let rank = ZERO;
  for (let i = 0; i < k; i++) {
    const ci = subsetSortedAsc[i];
    if (ci >= i + 1) rank += C[ci][i + 1];
  }
  return rank;
}

function combUnrank(rank, n, k, C) {
  const subset = new Array(k);
  let r = rank;
  let ci = n - 1;
  for (let i = k; i >= 1; i--) {
    // find largest ci with C[ci][i] <= r
    while (ci >= i && C[ci][i] > r) ci--;
    subset[i - 1] = ci;
    if (ci >= i) r -= C[ci][i];
    ci--;
  }
  return subset; // sorted ascending
}

function combCount(n, k, C) {
  if (k < 0 || k > n) return ZERO;
  return C[n][k];
}

// ---------------------------------------------------------------------------
// Multiset permutation rank/unrank.
// Given counts[] of distinct symbols (sum = L slots), bijection between
// [0, L!/prod(counts!)) and arrangements of those symbols into L ordered slots.
// We assign symbols to a FIXED ordered list of slots (canonical square order of the
// remaining free squares). Returns an array of symbol indices, length L.
// ---------------------------------------------------------------------------
function multisetCount(counts) {
  const L = counts.reduce((a, b) => a + b, 0);
  // L! / prod(counts!)
  let num = ONE;
  for (let i = 2; i <= L; i++) num *= BigInt(i);
  for (const c of counts) {
    let d = ONE;
    for (let i = 2; i <= c; i++) d *= BigInt(i);
    num /= d;
  }
  return num;
}

function multisetUnrank(rank, countsInput) {
  const counts = countsInput.slice();
  const L = counts.reduce((a, b) => a + b, 0);
  const out = new Array(L);
  let r = rank;
  let remaining = L;
  for (let pos = 0; pos < L; pos++) {
    // For each symbol in order, the number of arrangements if we place it here is
    // multiset count of the remaining symbols after decrementing this one.
    remaining--;
    for (let s = 0; s < counts.length; s++) {
      if (counts[s] === 0) continue;
      counts[s]--;
      const block = multisetCount(counts); // arrangements of the rest
      if (r < block) { out[pos] = s; break; }
      r -= block;
      counts[s]++; // restore, try next symbol
    }
  }
  return out;
}

function multisetRank(arrangement, countsInput) {
  const counts = countsInput.slice();
  let rank = ZERO;
  for (let pos = 0; pos < arrangement.length; pos++) {
    const sym = arrangement[pos];
    // sum blocks for all symbols ordered before `sym` that are still available
    for (let s = 0; s < sym; s++) {
      if (counts[s] === 0) continue;
      counts[s]--;
      rank += multisetCount(counts);
      counts[s]++;
    }
    counts[sym]--;
  }
  return rank;
}

// ---------------------------------------------------------------------------
// Mixed-radix combiner: combine a sequence of (digit, base) layers into one BigInt
// and split back. Encode order == decode order; this is the spine that keeps the
// whole pipeline a single bijection.
// ---------------------------------------------------------------------------
function mixCombine(layers) {
  // layers: [{value, count}] applied in order; result = ((d0*c1 + d1)*c2 + d2)...
  let acc = ZERO;
  for (const { value, count } of layers) {
    assert(value >= ZERO && value < count, 'layer digit out of range');
    acc = acc * count + value;
  }
  return acc;
}

// We can't split without knowing each base, and bases depend on prior layers
// (conditioned counting). So encode/decode each drive the layer sequence themselves
// rather than calling a generic split. mixCombine is used by encode; decode rebuilds
// the same bases as it consumes the integer from the most-significant side is awkward,
// so instead we combine least-significant-first during encode and peel during decode.
// To keep conditioning clean we use the standard trick: process layers in order,
// encode accumulates big-endian, decode must therefore know total product to peel.
// Simpler and robust: encode stores digits, we fold with running product from the
// LAST layer backward. Implemented explicitly in the family encode/decode below.

// ===========================================================================
// Generic conditioned-layer board family.
// A "family descriptor" defines geometry + material; encode/decode walk the fixed
// layer order. Both toy and full boards share this exact code path.
// ===========================================================================

class GeoChessFamily {
  /*
   * descriptor:
   *   files: number of files (columns)
   *   ranks: number of ranks (rows)
   *   whitePawnRanks: array of 0-based rank indices white pawns may occupy
   *   blackPawnRanks: array of 0-based rank indices black pawns may occupy
   *   nonPawn: { white: {...}, black: {...} } counts of K,Q,R,B,N for placement
   *            (B is split into one light + one dark; others are a multiset)
   * Square index canonical order: idx = rank * files + file (rank 0 = white's first rank).
   * Square colour: (rank + file) % 2  -> 0 = "dark", 1 = "light" (consistent, that's all
   * that matters for parity).
   */
  constructor(descriptor) {
    this.d = descriptor;
    this.nSquares = descriptor.files * descriptor.ranks;
    this.C = buildBinom(this.nSquares + 2);
    // Precompute per-file valid (whiteRank, blackRank) pairs with no same-square collision.
    this.fileStates = this._buildFileStates();
    this.pawnPerFile = BigInt(this.fileStates.length);
  }

  _color(idx) {
    const f = idx % this.d.files;
    const r = Math.floor(idx / this.d.files);
    return (f + r) & 1;
  }

  _buildFileStates() {
    const states = [];
    for (const wr of this.d.whitePawnRanks) {
      for (const br of this.d.blackPawnRanks) {
        if (wr === br) continue; // same square in same file -> collision, forbidden
        states.push([wr, br]);
      }
    }
    // canonical deterministic order
    states.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    return states;
  }

  // ---- capacity ----------------------------------------------------------
  // The encode/decode walk is one bijection onto [0, T). We compute T exactly. The only
  // non-rectangular layer is the kings (ordered non-adjacent pair), whose count depends
  // on the residual square geometry. We handle that with linearity: capacity is computed
  // by summing over pawn colour-splits, and within each split the king contribution uses
  // exact pair counts via the linearity decomposition in _capacityViaColourSplit.
  // Validated against full toy enumeration.
  capacity() {
    if (this._capCache === undefined) this._capCache = this._capacityViaColourSplit();
    return this._capCache;
  }

  // Rectangular capacity (kings counted as rem*(rem-1), no adjacency removal) — an UPPER
  // bound. The walk realizes the exact per-board value; capacityLowerBound() gives a
  // guaranteed floor. Aggregated over pawn colour splits.
  _capacityViaColourSplit() {
    const files = this.d.files;
    let boardLight = 0, boardDark = 0;
    for (let i = 0; i < this.nSquares; i++) (this._color(i) ? boardLight++ : boardDark++);
    const conv = this._pawnColourConvolution();
    const totalPawns = 2 * files;
    let total = 0n;
    for (const [lightPawns, pawnConfigCount] of conv) {
      const freeLight = boardLight - lightPawns;
      const freeDark = boardDark - (totalPawns - lightPawns);
      const perConfig = this._nonPawnCount(freeLight, freeDark, false);
      if (perConfig === ZERO) continue;
      total += pawnConfigCount * perConfig;
    }
    return total;
  }

  // Guaranteed lower bound: subtract the maximum possible adjacency removal from the king
  // term. True capacity (what the walk realizes summed over boards) lies between this and
  // the rectangular value. This is the safe number for "clears 104 bits".
  capacityLowerBound() {
    if (this._capLowCache !== undefined) return this._capLowCache;
    const files = this.d.files;
    let boardLight = 0, boardDark = 0;
    for (let i = 0; i < this.nSquares; i++) (this._color(i) ? boardLight++ : boardDark++);
    const conv = this._pawnColourConvolution();
    const totalPawns = 2 * files;
    let total = 0n;
    for (const [lightPawns, pawnConfigCount] of conv) {
      const freeLight = boardLight - lightPawns;
      const freeDark = boardDark - (totalPawns - lightPawns);
      const perConfig = this._nonPawnCount(freeLight, freeDark, true);
      if (perConfig === ZERO) continue;
      total += pawnConfigCount * perConfig;
    }
    this._capLowCache = total;
    return total;
  }

  _pawnColourConvolution() {
    const files = this.d.files;
    const perFileDists = [];
    for (let f = 0; f < files; f++) {
      const dist = new Map();
      for (const [wr, br] of this.fileStates) {
        const lp = this._color(wr * files + f) + this._color(br * files + f);
        dist.set(lp, (dist.get(lp) || 0n) + 1n);
      }
      perFileDists.push(dist);
    }
    let conv = new Map([[0, 1n]]);
    for (const dist of perFileDists) {
      const next = new Map();
      for (const [lp, cnt] of conv)
        for (const [add, c2] of dist) {
          const k = lp + add;
          next.set(k, (next.get(k) || 0n) + cnt * c2);
        }
      conv = next;
    }
    return conv;
  }

  // Conditioned non-pawn count given free light/dark counts. If `lowerBound`, the king term
  // subtracts the max adjacency removal; else it's rectangular.
  _nonPawnCount(freeLight, freeDark, lowerBound) {
    const w = this.d.nonPawn.white, b = this.d.nonPawn.black;
    let bishopWays = ONE, fl = freeLight, fd = freeDark;
    if (w.B >= 1) { bishopWays *= BigInt(fl); fl -= 1; }
    if (w.B >= 2) { bishopWays *= BigInt(fd); fd -= 1; }
    if (b.B >= 1) { bishopWays *= BigInt(fl); fl -= 1; }
    if (b.B >= 2) { bishopWays *= BigInt(fd); fd -= 1; }
    if (fl < 0 || fd < 0) return ZERO;

    const rem = fl + fd;
    const restCounts = this._restSymbolTable().map(s => s.n);
    const restTotal = restCounts.reduce((a, c) => a + c, 0);
    if (rem - 2 < restTotal) return ZERO;
    const restWays = combCount(rem - 2, restTotal, this.C) * multisetCount(restCounts);

    let kings = BigInt(rem) * BigInt(rem - 1);
    if (lowerBound) {
      kings -= BigInt(this._maxAdjOrderedPairs());
      if (kings <= 0n) return ZERO;
    }
    return bishopWays * kings * restWays;
  }

  _restSymbolTable() {
    const w = this.d.nonPawn.white, b = this.d.nonPawn.black;
    // canonical symbol ordering for the "rest" layer
    return [
      { name: 'WQ', n: w.Q }, { name: 'WR', n: w.R }, { name: 'WN', n: w.N },
      { name: 'BQ', n: b.Q }, { name: 'BR', n: b.R }, { name: 'BN', n: b.N },
    ].filter(s => s.n > 0);
  }

  _maxAdjOrderedPairs() {
    // ordered adjacent (king-move) pairs on the full geometry
    if (this._maxAdj !== undefined) return this._maxAdj;
    let pairs = 0;
    const F = this.d.files, R = this.d.ranks;
    for (let i = 0; i < this.nSquares; i++) {
      const fi = i % F, ri = Math.floor(i / F);
      for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const nf = fi + df, nr = ri + dr;
        if (nf < 0 || nf >= F || nr < 0 || nr >= R) continue;
        pairs++; // ordered
      }
    }
    this._maxAdj = pairs;
    return pairs;
  }

  // ---- encode: N -> board -------------------------------------------------
  // Returns { board: Int8Array of square->code, layers: debug } where code is an index
  // into PIECES (0 = empty).
  encode(N) {
    const cap = this._capacityViaPawnConv();
    assert(N >= ZERO && N < cap, `N out of range: N=${N} cap=${cap}`);
    // Mixed radix peeled LSB-first. Each layer's base becomes known once all less-significant
    // layers are decoded (pawns const; bishop bases from pawn colour split; king/rest bases
    // from residual squares). See _codeFromInteger for the per-layer walk. NOTE: the king
    // layer is split into A then B with B's base conditioned on A — this is a valid mixed
    // radix for round-trip (decode reproduces the same bases), validated by exhaustive toy
    // enumeration below.
    return this._codeFromInteger(N);
  }

  _exactCapacityForEncoding() {
    // Must equal exactly what the tree-rank realizes = sum of pawn-config completion counts.
    if (this._capCache2 !== undefined) return this._capCache2;
    let t = ZERO;
    for (const pc of this._enumeratePawnConfigsWithCounts()) t += pc.count;
    this._capCache2 = t;
    return t;
  }

  // Direct exact count by walking the SAME layer structure in count mode (small boards only).
  _enumerateExactCapacity() {
    const F = this.d.files;
    const w = this.d.nonPawn.white, b = this.d.nonPawn.black;
    let total = 0n;
    // enumerate all pawn configs
    const fileCount = this.fileStates.length;
    const idx = new Array(F).fill(0);
    const restCountsBase = this._restSymbolTable().map(s => s.n);
    const restTotal = restCountsBase.reduce((a, c) => a + c, 0);
    while (true) {
      // build pawn occupancy
      const occupied = new Set();
      let okPawn = true;
      for (let f = 0; f < F; f++) {
        const [wr, br] = this.fileStates[idx[f]];
        occupied.add(wr * F + f); occupied.add(br * F + f);
      }
      // free squares + colours
      const free = [];
      for (let i = 0; i < this.nSquares; i++) if (!occupied.has(i)) free.push(i);
      const light = free.filter(i => this._color(i) === 1);
      const dark = free.filter(i => this._color(i) === 0);
      // bishop ways (count only)
      let bishopWays = ONE; let fl = light.length, fd = dark.length;
      if (w.B >= 1) { bishopWays *= BigInt(fl); fl--; }
      if (w.B >= 2) { bishopWays *= BigInt(fd); fd--; }
      if (b.B >= 1) { bishopWays *= BigInt(fl); fl--; }
      if (b.B >= 2) { bishopWays *= BigInt(fd); fd--; }
      if (fl >= 0 && fd >= 0) {
        // king pairs depend on residual geometry (free minus 4 bishop squares). For an EXACT
        // count we'd sum over bishop placements; but king-pair count varies per placement.
        // For small toy boards we enumerate king pairs over the FULL free set and accept that
        // bishops/rest are placed in the remaining squares — i.e. we treat the walk's actual
        // structure: bishops first (specific squares), then kings over what's left. To stay
        // exact we sum over bishop placements explicitly here.
        total += this._sumOverBishopsKingsRest(free, light, dark, w, b, restCountsBase, restTotal);
      }
      // increment mixed counter
      let p = 0;
      while (p < F) { idx[p]++; if (idx[p] < fileCount) break; idx[p] = 0; p++; }
      if (p === F) break;
    }
    return total;
  }

  _sumOverBishopsKingsRest(free, light, dark, w, b, restCountsBase, restTotal) {
    // Enumerate bishop placements explicitly (small boards), then exact king pairs over the
    // residual free squares, then rest arrangements (with empties).
    const wl = w.B >= 1, wd = w.B >= 2, bl = b.B >= 1, bd = b.B >= 2;
    let sum = 0n;
    const lightArr = light, darkArr = dark;
    const tryPlace = (wlSq, wdSq, blSq, bdSq) => {
      const used = new Set([wlSq, wdSq, blSq, bdSq].filter(x => x !== undefined));
      if (used.size !== [wlSq, wdSq, blSq, bdSq].filter(x => x !== undefined).length) return; // overlap
      const residual = free.filter(x => !used.has(x));
      const pairs = this._orderedNonAdjPairs(residual).length;
      if (pairs === 0) return;
      const afterKings = residual.length - 2;
      if (afterKings < restTotal) return;
      const restCounts = [afterKings - restTotal, ...restCountsBase];
      // kingsOutOfRank: kings carry NO payload — they are placed deterministically after the
      // rest layer (placeKingsSafely). Two squares are still reserved as empties (the -2 in
      // afterKings) so encode/decode agree the king squares are "empty" to the rest layer, but
      // the king pair contributes no multiplier. Old path keeps the BigInt(pairs) factor.
      const kingFactor = this.d.kingsOutOfRank ? 1n : BigInt(pairs);
      sum += kingFactor * multisetCount(restCounts);
    };
    const wlSet = wl ? lightArr : [undefined];
    for (const a of wlSet) {
      const wdSet = wd ? darkArr : [undefined];
      for (const c of wdSet) {
        const blSet = bl ? lightArr.filter(x => x !== a) : [undefined];
        for (const d of blSet) {
          const bdSet = bd ? darkArr.filter(x => x !== c) : [undefined];
          for (const e of bdSet) tryPlace(a, c, d, e);
        }
      }
    }
    return sum;
  }

  // Exact capacity for large boards via linearity (king-pair adjacency correction computed
  // from the free-square adjacency graph). Placeholder: returns the rectangular value; the
  // guaranteed floor is capacityLowerBound(). For the full 8x8 we report the lower bound as
  // the safe figure and note exact lies between bound and rectangular.
  _exactCapacityLinear() {
    return this._capacityViaColourSplit(); // rectangular upper bound
  }

  // ---- count completions from a free-square set: bishops -> kings -> rest ----
  // This is the conditioned subtree-count used by the tree-rank. Returns total boards.
  _completionsFromFree(free) {
    const w = this.d.nonPawn.white, b = this.d.nonPawn.black;
    const light = free.filter(i => this._color(i) === 1);
    const dark = free.filter(i => this._color(i) === 0);
    // bishop placements (count) * for each, kingPairs(residual)*restArrangements.
    // restArrangements depends only on residual SIZE (constant given material & free size),
    // so factor it out; only kingPairs varies with bishop choice.
    const restTbl = this._restSymbolTable();
    const restTotal = restTbl.reduce((a, s) => a + s.n, 0);
    const nBish = (w.B + b.B);
    const residualSize = free.length - nBish - 2; // minus bishops minus 2 kings
    if (residualSize < restTotal) return ZERO;
    const restCounts = [residualSize - restTotal, ...restTbl.map(s => s.n)];
    const restArr = multisetCount(restCounts);
    // sum kingPairs over all bishop placements
    const kingSum = this._sumKingPairsOverBishops(free, light, dark, w, b);
    return kingSum * restArr;
  }

  // Sum of ordered-non-adjacent king-pair counts over every bishop placement.
  //
  // EXACT CLOSED FORM (replaces the old O(L^2·D^2·n^2) quadruple loop, which made every
  // _completionsFromFree call ~15s on the full board). Derivation:
  //
  //   Bishops occupy sL light squares (ordered: white-light if w.B>=1, black-light if b.B>=1)
  //   and sD dark squares (ordered: white-dark if w.B>=2, black-dark if b.B>=2). Let
  //     L = #free light, D = #free dark, n = |free|.
  //     P = perm(L,sL)·perm(D,sD)                          (# bishop placements)
  //   For each placement, residual r = free minus the sL+sD bishop squares, |r| = n-(sL+sD), and
  //     orderedNonAdjPairs(r) = |r|·(|r|-1) - orderedAdjPairs(r).
  //   Summing |r|·(|r|-1) is constant across placements: rect = |r|·(|r|-1)·P.
  //   For the adjacency term, sum over placements of orderedAdjPairs(r)
  //     = Σ_{ordered free adjacent edges (u,v)} #placements removing NEITHER u nor v.
  //   An edge has a light endpoints and b dark endpoints (a+b=2). Placements keeping both
  //   endpoints free choose sL light from the L-a remaining and sD dark from the D-b remaining,
  //   ordered: perm(L-a, sL)·perm(D-b, sD). So
  //     T = Σ_edges perm(L-a,sL)·perm(D-b,sD),   and the answer is rect - T.
  //
  // Verified against the old brute force across all bishop configs (w.B,b.B ∈ {0,1,2}) and
  // hundreds of random free sets — exact match.
  _sumKingPairsOverBishops(free, light, dark, w, b) {
    const F = this.d.files, R = this.d.ranks;
    const sL = (w.B >= 1 ? 1 : 0) + (b.B >= 1 ? 1 : 0);
    const sD = (w.B >= 2 ? 1 : 0) + (b.B >= 2 ? 1 : 0);
    const L = light.length, D = dark.length, n = free.length;
    const perm = (x, k) => { if (x < k || k < 0) return ZERO; let r = ONE; for (let i = 0; i < k; i++) r *= BigInt(x - i); return r; };
    const P = perm(L, sL) * perm(D, sD);
    if (P === ZERO) return ZERO;
    const rsize = n - (sL + sD);
    if (rsize < 0) return ZERO;
    let rect = BigInt(rsize) * BigInt(rsize - 1) * P;
    const freeSet = new Set(free);
    let T = ZERO;
    for (const u of free) {
      const fu = u % F, ru = (u / F) | 0;
      for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const nf = fu + df, nr = ru + dr;
        if (nf < 0 || nf >= F || nr < 0 || nr >= R) continue;
        const v = nr * F + nf;
        if (!freeSet.has(v)) continue;
        let a = 0, bb = 0;
        if (this._color(u) === 1) a++; else bb++;
        if (this._color(v) === 1) a++; else bb++;
        T += perm(L - a, sL) * perm(D - bb, sD);
      }
    }
    return rect - T;
  }

  // Bishop placements in canonical order (white-light, white-dark, black-light, black-dark),
  // each as a list of {squares:[...], residual:[...]} — used to descend the tree.
  _bishopPlacements(free) {
    const w = this.d.nonPawn.white, b = this.d.nonPawn.black;
    const light = free.filter(i => this._color(i) === 1);
    const dark = free.filter(i => this._color(i) === 0);
    const out = [];
    const wl = w.B >= 1, wd = w.B >= 2, bl = b.B >= 1, bd = b.B >= 2;
    const wlSet = wl ? light : [null];
    for (const a of wlSet) {
      const wdSet = wd ? dark : [null];
      for (const c of wdSet) {
        const blSet = bl ? light.filter(x => x !== a) : [null];
        for (const d of blSet) {
          const bdSet = bd ? dark.filter(x => x !== c) : [null];
          for (const e of bdSet) {
            const arr = [a, c, d, e];
            const used = arr.filter(x => x !== null);
            if (new Set(used).size !== used.length) continue;
            out.push({ wl: a, wd: c, bl: d, bd: e, used: new Set(used) });
          }
        }
      }
    }
    return out;
  }

  // =====================================================================
  // CLOSED-FORM BISHOP TREE-RANK (scaling fix companion; session 4)
  // =====================================================================
  // The legacy bishop descent enumerated every placement (~L·D·(L−1)·(D−1) ≈ 3·10^5 on the full
  // board) and ran an O(n²) _orderedNonAdjPairs per placement — the dominant per-call cost once
  // the pawn layer was made O(1)-ish. We replace it with a slot-by-slot descent (white-light,
  // white-dark, black-light, black-dark — the same canonical order as _bishopPlacements). For
  // each candidate square of the current slot, the subtree size is
  //     restArr · Σ_{placements of the REMAINING slots} kingPairs(residual),
  // and that inner sum is exactly _sumKingPairsOverBishops on the reduced free set (current
  // square removed) with the reduced slot set — already an exact O(n) closed form. So a bishop
  // descent costs O(#slots · |free| · |free|) instead of O(placements · |free|²).
  //
  // The closed form depends only on (sL,sD) = (#remaining light slots, #remaining dark slots),
  // independent of which side owns a slot; the black-light-excludes-white-light constraint is
  // enforced automatically because the reduced free set already drops earlier bishop squares.
  // Verified against the enumeration ordering placement-by-placement.

  // Σ kingPairs over all placements of the remaining bishop slots on `free`. slots = {wL,wD,bL,bD}.
  // Count of ways to place the STILL-UNPLACED bishops on the given free set, by colour.
  // `slots` flags which bishop slots remain (wL/wD/bL/bD). On the kingsOutOfRank path the
  // bishop layer's subtree size is (remaining-bishop placements) × restArr — kings carry no
  // payload, so they must NOT weight the bishop digit (doing so froze all four bishops on the
  // lowest squares). Light slots draw from light squares, dark from dark.
  _remainingBishopPlacements(free, slots) {
    const sL = (slots.wL ? 1 : 0) + (slots.bL ? 1 : 0);
    const sD = (slots.wD ? 1 : 0) + (slots.bD ? 1 : 0);
    let L = 0, D = 0; for (const i of free) (this._color(i) ? L++ : D++);
    const perm = (x, k) => { if (x < k || k < 0) return ZERO; let r = ONE; for (let i = 0; i < k; i++) r *= BigInt(x - i); return r; };
    return perm(L, sL) * perm(D, sD);
  }

  _sumKingPairsRemaining(free, slots) {
    const F = this.d.files, R = this.d.ranks;
    const sL = (slots.wL ? 1 : 0) + (slots.bL ? 1 : 0);
    const sD = (slots.wD ? 1 : 0) + (slots.bD ? 1 : 0);
    let L = 0, D = 0; for (const i of free) (this._color(i) ? L++ : D++);
    const n = free.length;
    const perm = (x, k) => { if (x < k || k < 0) return ZERO; let r = ONE; for (let i = 0; i < k; i++) r *= BigInt(x - i); return r; };
    const P = perm(L, sL) * perm(D, sD);
    if (P === ZERO) return ZERO;
    const rsize = n - (sL + sD);
    if (rsize < 0) return ZERO;
    const rect = BigInt(rsize) * BigInt(rsize - 1) * P;
    const set = new Set(free);
    let T = ZERO;
    for (const u of free) {
      const fu = u % F, ru = (u / F) | 0;
      for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const nf = fu + df, nr = ru + dr;
        if (nf < 0 || nf >= F || nr < 0 || nr >= R) continue;
        const v = nr * F + nf;
        if (!set.has(v)) continue;
        let a = 0, bb = 0;
        if (this._color(u) === 1) a++; else bb++;
        if (this._color(v) === 1) a++; else bb++;
        T += perm(L - a, sL) * perm(D - bb, sD);
      }
    }
    return rect - T;
  }

  // ENCODE bishops: descend N, return chosen squares {wl,wd,bl,bd}, residual free set, and rem.
  _rankBishops(free, N, restArr) {
    const w = this.d.nonPawn.white, b = this.d.nonPawn.black;
    const need = { wL: w.B >= 1, wD: w.B >= 2, bL: b.B >= 1, bD: b.B >= 2 };
    const slotOrder = [['wl', 'wL', 1], ['wd', 'wD', 0], ['bl', 'bL', 1], ['bd', 'bD', 0]];
    let curFree = free.slice();
    const placed = { wl: null, wd: null, bl: null, bd: null };
    const remaining = { wL: need.wL, wD: need.wD, bL: need.bL, bD: need.bD };
    for (const [name, flag, col] of slotOrder) {
      if (!need[flag]) { placed[name] = null; continue; }
      remaining[flag] = false; // slots strictly AFTER this one
      const cands = curFree.filter(i => this._color(i) === col).sort((a, bb) => a - bb);
      let picked = null;
      for (const sq of cands) {
        const nf = curFree.filter(x => x !== sq);
        const sub = this.d.kingsOutOfRank
          ? this._remainingBishopPlacements(nf, remaining) * restArr
          : this._sumKingPairsRemaining(nf, remaining) * restArr;
        if (sub === ZERO) continue;
        if (N < sub) { picked = sq; break; }
        N -= sub;
      }
      assert(picked !== null, 'bishop rank overflow at ' + name);
      placed[name] = picked; curFree = curFree.filter(x => x !== picked);
    }
    return { placed, residual: curFree, rem: N };
  }

  // DECODE bishops: given the chosen squares, return the bishop-layer offset (sum of subtree
  // sizes of all canonically-earlier placements). Mirrors _rankBishops exactly.
  _unrankBishops(free, placed, restArr) {
    const w = this.d.nonPawn.white, b = this.d.nonPawn.black;
    const need = { wL: w.B >= 1, wD: w.B >= 2, bL: b.B >= 1, bD: b.B >= 2 };
    const slotOrder = [['wl', 'wL', 1], ['wd', 'wD', 0], ['bl', 'bL', 1], ['bd', 'bD', 0]];
    let curFree = free.slice();
    const remaining = { wL: need.wL, wD: need.wD, bL: need.bL, bD: need.bD };
    let N = ZERO;
    for (const [name, flag, col] of slotOrder) {
      if (!need[flag]) continue;
      remaining[flag] = false;
      const target = placed[name];
      const cands = curFree.filter(i => this._color(i) === col).sort((a, bb) => a - bb);
      for (const sq of cands) {
        if (sq === target) break;
        const nf = curFree.filter(x => x !== sq);
        const sub = this.d.kingsOutOfRank
          ? this._remainingBishopPlacements(nf, remaining) * restArr
          : this._sumKingPairsRemaining(nf, remaining) * restArr;
        N += sub;
      }
      curFree = curFree.filter(x => x !== target);
    }
    return { offset: N, residual: curFree };
  }

  // ---- TREE-RANK encode: integer N -> board ----
  // Layers with VARIABLE subtree sizes (pawns, bishops) are ranked by descending the tree:
  // at each layer, walk candidate choices in canonical order, subtracting each candidate's
  // exact subtree-count until N falls inside one. Layers with constant base given context
  // (kings over a fixed residual, rest multiset) use ordinary base arithmetic. This is a
  // single exact bijection onto [0, T) and never lands on a dead branch.
  _codeFromInteger(Ninput) {
    const F = this.d.files;
    let N = Ninput;
    const board = new Int8Array(this.nSquares).fill(0);

    // ---- layer 1: pawns, ranked by subtree count over file-state combinations ----
    // Descend file by file. For each file we try each fileState; the subtree count is
    // (product of remaining files' pawn freedom) is NOT constant because downstream bishop/
    // king counts depend on the resulting free set. So we must, for each partial pawn
    // assignment, know the count of completions. We compute that by finishing the pawn
    // assignment combinatorially is too expensive; instead we enumerate pawn configs lazily
    // with memoized suffix counts. For tractability on the full board we rank pawns by a
    // DIFFERENT decomposition: pawns are independent of downstream EXCEPT through the free
    // set's colour split and geometry. Two pawn configs giving the same free set have the
    // same completions. But free sets differ per config. So pawn subtree counts genuinely
    // vary and we cannot avoid per-config completion counts.
    //
    // Practical exact method: enumerate pawn configs in canonical order, and for each compute
    // _completionsFromFree(free). Descend N across them. For the full board there are 14^8 ≈
    // 1.5e9 configs — too many to enumerate per encode. THEREFORE we group configs by their
    // completion count, which depends only on the free set's geometry, which in turn for this
    // family depends only on WHICH (rank) each pawn occupies. Distinct geometries are far
    // fewer... but still large. For v1 we accept the toy proves correctness and the full
    // board uses the fast path below (constant-subtree approximation flagged).
    //
    // To keep BOTH correct AND fast we use the key structural fact: king non-adjacency is the
    // ONLY source of subtree variation, and its effect is tiny. We therefore rank pawns/
    // bishops with the rectangular (king = size*(size-1)) tree — which is a clean mixed radix
    // — and then SUBTRACT a king-adjacency correction at the king layer by ranking the king
    // pair within the non-adjacent set while sizing the digit by the rectangular count. This
    // does NOT biject. So we abandon the fast path and use exact enumeration, which is correct
    // for the toy and for any board where pawn-config count is enumerable.
    // Convolution-based pawn tree-rank (no 14^8 enumeration). Descends file by file and returns
    // the chosen per-file states plus the residual N for the downstream layers.
    const { chosen: pawnChoice, rem } = this._rankPawns(N);
    N = rem;
    for (let f = 0; f < F; f++) {
      const [wr, br] = this.fileStates[pawnChoice[f]];
      board[wr * F + f] = PIECE.WP;
      board[br * F + f] = PIECE.BP;
    }
    // reconstruct the free-square set from the chosen pawn placement
    const occupied = new Set();
    for (let f = 0; f < F; f++) {
      const [wr, br] = this.fileStates[pawnChoice[f]];
      occupied.add(wr * F + f); occupied.add(br * F + f);
    }
    let free = [];
    for (let i = 0; i < this.nSquares; i++) if (!occupied.has(i)) free.push(i);

    // ---- layer 2: bishops, ranked by closed-form subtree count (no placement enumeration) ----
    const restTbl = this._restSymbolTable();
    const restTotal = restTbl.reduce((a, s) => a + s.n, 0);
    const nBishTot = this.d.nonPawn.white.B + this.d.nonPawn.black.B;
    const bResidualSize = free.length - nBishTot - 2; // residual after bishops+kings (constant)
    assert(bResidualSize >= restTotal, 'insufficient residual for rest pieces');
    const bRestArr = multisetCount([bResidualSize - restTotal, ...restTbl.map(s => s.n)]);
    const bres = this._rankBishops(free, N, bRestArr);
    N = bres.rem;
    const bchosen = bres.placed;
    if (bchosen.wl !== null) board[bchosen.wl] = PIECE.WB;
    if (bchosen.wd !== null) board[bchosen.wd] = PIECE.WB;
    if (bchosen.bl !== null) board[bchosen.bl] = PIECE.BB;
    if (bchosen.bd !== null) board[bchosen.bd] = PIECE.BB;
    free = bres.residual.slice();

    // ---- layer 3: kings ----
    const pairs = this._orderedNonAdjPairs(free);
    const restCounts = [free.length - 2 - restTotal, ...restTbl.map(s => s.n)];
    const restArr = multisetCount(restCounts);
    if (this.d.kingsOutOfRank) {
      // Kings carry no payload. Reserve two squares as empties (the -2 in restCounts already
      // does this), rank the rest multiset over the FULL free set treating 2 squares as empty,
      // then stamp kings on the canonically-first safe non-adjacent empty pair afterwards.
      // N is entirely the rest arrangement; no king digit is consumed.
      assert(pairs.length > 0, 'no non-adjacent pair for kings (kingsOutOfRank)');
      const codeForSym = [PIECE.EMPTY, ...restTbl.map(s => PIECE[s.name])];
      const arrangement = multisetUnrank(N, restCounts);
      for (let i = 0; i < free.length; i++) board[free[i]] = codeForSym[arrangement[i]];
      this._placeKingsSafely(board);
      return board;
    }
    const kingBase = BigInt(pairs.length);
    const kingDigit = Number(N / restArr);          // MSB part = king choice
    const restRank = N % restArr;                    // LSB part = rest arrangement
    assert(kingDigit < pairs.length, 'king digit overflow');
    const [sqA, sqB] = pairs[kingDigit];
    board[sqA] = PIECE.WK; board[sqB] = PIECE.BK;
    free = free.filter(x => x !== sqA && x !== sqB);

    // ---- layer 4: rest multiset (empty + rest pieces) over remaining free squares ----
    const codeForSym = [PIECE.EMPTY, ...restTbl.map(s => PIECE[s.name])];
    const arrangement = multisetUnrank(restRank, restCounts);
    for (let i = 0; i < free.length; i++) board[free[i]] = codeForSym[arrangement[i]];
    return board;
  }

  // =====================================================================
  // CONVOLUTION-BASED PAWN TREE-RANK (the scaling fix; session 4)
  // =====================================================================
  // Ranks/unranks the pawn layer file-by-file WITHOUT enumerating the 14^8 config space.
  //
  // Key fact (proven, see _completionsFromFree + _sumKingPairsOverBishops closed form):
  //   completions(free) = restArr · ( rect(free) − T(free) )
  // where restArr is constant given material, and both rect and T are exact functions of a
  // small "bucket" derived from the pawn placement only:
  //     bucket = (lightPawns, e20, e11, e02)
  //   lightPawns = # pawn squares of light colour (fixes the free colour split L,D)
  //   e20/e11/e02 = counts of ORDERED free king-adjacent edges by endpoint-colour type
  //                 (a,b) ∈ {(2,0),(1,1),(0,2)} — a = #light endpoints, b = #dark endpoints.
  //   rect = rsize·(rsize−1)·perm(L,sL)·perm(D,sD),  rsize = n−(sL+sD)
  //   T    = e20·perm(L−2,sL)·perm(D,sD) + e11·perm(L−1,sL)·perm(D−1,sD)
  //          + e02·perm(L,sL)·perm(D−2,sD)
  // (sL,sD = # light/dark bishop slots; n = |free| = L+D.)
  //
  // Every free king-adjacent edge is either WITHIN one file (vertical, a function of that file's
  // state) or BETWEEN two adjacent files (a function of the joint state of files f, f+1). So the
  // bucket decomposes additively over files + adjacent-file boundaries, and a 1-D convolution
  // over files — carrying a running bucket and the previous file's state for the boundary edge —
  // yields exact suffix-sums of completions for the tree-rank. completionsOf(bucket) is nonlinear
  // in the bucket, so the convolution carries the full bucket DISTRIBUTION (not a collapsed sum).
  //
  // ORDERING CONTRACT: the legacy enumeration (_enumeratePawnConfigsWithCounts) increments
  // idx[0] fastest, so file 0 is the least-significant digit and file F−1 the most significant.
  // The descent below therefore chooses file F−1 outermost down to file 0, reproducing the SAME
  // canonical config order and hence the SAME integer N. Verified config-by-config against the
  // enumeration offsets on every exhaustive toy family.
  _pawnConvModel() {
    if (this._pcm) return this._pcm;
    const F = this.d.files, R = this.d.ranks;
    const S = this.fileStates.length;
    const color = (i) => { const f = i % F, r = (i / F) | 0; return (f + r) & 1; };
    let boardLight = 0, boardDark = 0;
    for (let i = 0; i < this.nSquares; i++) (color(i) ? boardLight++ : boardDark++);
    const totalPawns = 2 * F;
    const w = this.d.nonPawn.white, b = this.d.nonPawn.black;
    const sL = (w.B >= 1 ? 1 : 0) + (b.B >= 1 ? 1 : 0);
    const sD = (w.B >= 2 ? 1 : 0) + (b.B >= 2 ? 1 : 0);
    const nBish = w.B + b.B;
    const perm = (x, k) => { if (x < k || k < 0) return ZERO; let r = ONE; for (let i = 0; i < k; i++) r *= BigInt(x - i); return r; };
    const restTbl = this._restSymbolTable();
    const restTotal = restTbl.reduce((a, s) => a + s.n, 0);
    const restCountsTail = restTbl.map(s => s.n);

    // per-(file,state): free ranks, light-pawn count, within-file ordered edge tallies
    const fileFree = [], fileLP = [], withinE = [];
    for (let f = 0; f < F; f++) {
      fileFree.push([]); fileLP.push([]); withinE.push([]);
      for (let s = 0; s < S; s++) {
        const [wr, br] = this.fileStates[s];
        const fr = [];
        for (let r = 0; r < R; r++) if (r !== wr && r !== br) fr.push(r);
        fileFree[f][s] = fr;
        let lp = 0; if (color(wr * F + f) === 1) lp++; if (color(br * F + f) === 1) lp++;
        fileLP[f][s] = lp;
        let e20 = 0, e11 = 0, e02 = 0;
        for (let i = 0; i < fr.length; i++) for (let j = 0; j < fr.length; j++) {
          if (i === j) continue;
          if (Math.abs(fr[i] - fr[j]) !== 1) continue; // vertical adjacency within a file
          const c1 = color(fr[i] * F + f), c2 = color(fr[j] * F + f);
          const a = (c1 === 1 ? 1 : 0) + (c2 === 1 ? 1 : 0);
          if (a === 2) e20++; else if (a === 1) e11++; else e02++;
        }
        withinE[f][s] = { e20, e11, e02 };
      }
    }
    // ordered cross-file edges between file f (state s) and file f+1 (state s2)
    const crossCache = new Map();
    const crossE = (f, s, s2) => {
      const ck = f * S * S + s * S + s2;
      let v = crossCache.get(ck);
      if (v) return v;
      const free1 = fileFree[f][s], free2 = fileFree[f + 1][s2];
      const set1 = new Set(free1), set2 = new Set(free2);
      let e20 = 0, e11 = 0, e02 = 0;
      for (const r1 of free1) for (let dr = -1; dr <= 1; dr++) { const r2 = r1 + dr; if (!set2.has(r2)) continue;
        const c1 = color(r1 * F + f), c2 = color(r2 * F + f + 1); const a = (c1 === 1 ? 1 : 0) + (c2 === 1 ? 1 : 0);
        if (a === 2) e20++; else if (a === 1) e11++; else e02++; }
      for (const r2 of free2) for (let dr = -1; dr <= 1; dr++) { const r1 = r2 + dr; if (!set1.has(r1)) continue;
        const c1 = color(r1 * F + f), c2 = color(r2 * F + f + 1); const a = (c1 === 1 ? 1 : 0) + (c2 === 1 ? 1 : 0);
        if (a === 2) e20++; else if (a === 1) e11++; else e02++; }
      v = { e20, e11, e02 }; crossCache.set(ck, v); return v;
    };

    const completionsOf = (lp, e20, e11, e02) => {
      const L = boardLight - lp, D = boardDark - (totalPawns - lp), n = L + D;
      const residualSize = n - nBish - 2;
      if (residualSize < restTotal) return ZERO;
      const restCounts = [residualSize - restTotal, ...restCountsTail];
      const restArr = multisetCount(restCounts);
      const P = perm(L, sL) * perm(D, sD);
      const rk = n - (sL + sD);
      if (rk < 0) return ZERO;
      const rect = BigInt(rk) * BigInt(rk - 1) * P;
      const T = BigInt(e20) * perm(L - 2, sL) * perm(D, sD)
              + BigInt(e11) * perm(L - 1, sL) * perm(D - 1, sD)
              + BigInt(e02) * perm(L, sL) * perm(D - 2, sD);
      const skp = rect - T;
      if (skp <= ZERO) return ZERO;
      // kingsOutOfRank: kings carry NO payload (placed deterministically after the rest layer).
      // Two squares are still reserved as empties (residualSize already subtracts 2), but the
      // king PAIR contributes no multiplier, so the king factor collapses skp -> 1. The skp<=0
      // guard above still rules out pawn configs with no room for a non-adjacent pair at all.
      // Old path keeps skp as the king-pair count. This MUST mirror _sumOverBishopsKingsRest.
      if (this.d.kingsOutOfRank) return restArr;
      return skp * restArr;
    };

    // OPTIMIZATION (affine collapse): completionsOf(lp,e20,e11,e02) is AFFINE in (e20,e11,e02):
    //   completionsOf = base(lp) + d20(lp)·e20 + d11(lp)·e11 + d02(lp)·e02,
    // where base = completionsOf(lp,0,0,0), d2x = completionsOf(lp,unit)−base. Therefore the
    // tree-rank never needs the full bucket distribution — only, per (state,lp), the AGGREGATES
    //   { count, Σe20, Σe11, Σe02 }  over all prefix assignments.
    // This collapses the carried state from O(lp·e20·e11·e02) (~1e5 entries on 8×8) to O(S·lp)
    // (a few hundred), making per-call cost independent of the 14^8 config space AND tiny.
    //
    // distAfter[k]: Map keyed "s|lp" -> {cnt, s20, s11, s02} (BigInt), for files 0..k-1 committed
    // (s = state of file k-1), edges among files 0..k-1 included, boundary to file k NOT added.
    const distAfter = [];
    {
      const d0 = new Map();
      for (let s = 0; s < S; s++) { const wn = withinE[0][s];
        d0.set(`${s}|${fileLP[0][s]}`, { cnt: ONE, s20: BigInt(wn.e20), s11: BigInt(wn.e11), s02: BigInt(wn.e02) }); }
      distAfter[1] = d0;
      for (let k = 2; k <= F; k++) {
        const next = new Map();
        for (const [key, ag] of distAfter[k - 1]) {
          const p = key.split('|'); const ps = +p[0], lp = +p[1];
          for (let s = 0; s < S; s++) {
            const wn = withinE[k - 1][s]; const c = crossE(k - 2, ps, s);
            const addE20 = BigInt(wn.e20 + c.e20), addE11 = BigInt(wn.e11 + c.e11), addE02 = BigInt(wn.e02 + c.e02);
            const nk = `${s}|${lp + fileLP[k - 1][s]}`;
            let na = next.get(nk);
            if (!na) { na = { cnt: ZERO, s20: ZERO, s11: ZERO, s02: ZERO }; next.set(nk, na); }
            na.cnt += ag.cnt;
            na.s20 += ag.s20 + ag.cnt * addE20;
            na.s11 += ag.s11 + ag.cnt * addE11;
            na.s02 += ag.s02 + ag.cnt * addE02;
          }
        }
        distAfter[k] = next;
      }
    }
    // prefixAggFor(k, sk): per-lp aggregates {cnt,s20,s11,s02} added by files 0..k-1, INCLUDING
    // the boundary cross edge to file k (state sk). k===0 => the empty contribution at lp=0.
    const prefixCache = new Map();
    const prefixAggFor = (k, sk) => {
      if (k === 0) return new Map([[0, { cnt: ONE, s20: ZERO, s11: ZERO, s02: ZERO }]]);
      const ck = k * (S + 1) + (sk === null ? S : sk);
      let out = prefixCache.get(ck);
      if (out) return out;
      out = new Map();
      for (const [key, ag] of distAfter[k]) {
        const p = key.split('|'); const ps = +p[0], lp = +p[1];
        let ce = { e20: 0, e11: 0, e02: 0 };
        if (sk !== null) ce = crossE(k - 1, ps, sk);
        let oa = out.get(lp);
        if (!oa) { oa = { cnt: ZERO, s20: ZERO, s11: ZERO, s02: ZERO }; out.set(lp, oa); }
        oa.cnt += ag.cnt;
        oa.s20 += ag.s20 + ag.cnt * BigInt(ce.e20);
        oa.s11 += ag.s11 + ag.cnt * BigInt(ce.e11);
        oa.s02 += ag.s02 + ag.cnt * BigInt(ce.e02);
      }
      prefixCache.set(ck, out);
      return out;
    };

    // affine pieces of completionsOf at a given lp (cached): base + d20,d11,d02
    const affineCache = new Map();
    const affineAt = (lp) => {
      let a = affineCache.get(lp);
      if (a) return a;
      const base = completionsOf(lp, 0, 0, 0);
      a = { base, d20: completionsOf(lp, 1, 0, 0) - base, d11: completionsOf(lp, 0, 1, 0) - base, d02: completionsOf(lp, 0, 0, 1) - base };
      affineCache.set(lp, a);
      return a;
    };

    this._pcm = { F, S, fileLP, withinE, crossE, completionsOf, prefixAggFor, affineAt };
    return this._pcm;
  }

  // Subtree sizes for choosing each state of file `kFile`, given the accumulator from the
  // already-chosen suffix files (kFile+1..F-1) and that suffix's lowest chosen state. Uses the
  // affine collapse: Σ completionsOf over the prefix = Σ_lp [ base·cnt + d20·Σe20 + d11·Σe11
  // + d02·Σe02 ], where the suffix's fixed edge offset is folded into the per-lp aggregates.
  _pawnSubtreeSizes(M, kFile, suffixAcc, prevChosenStateAbove) {
    const sizes = [];
    for (let s = 0; s < M.S; s++) {
      const dlp = M.fileLP[kFile][s];
      let oe20 = suffixAcc.e20 + M.withinE[kFile][s].e20;
      let oe11 = suffixAcc.e11 + M.withinE[kFile][s].e11;
      let oe02 = suffixAcc.e02 + M.withinE[kFile][s].e02;
      if (prevChosenStateAbove !== null) { const c = M.crossE(kFile, s, prevChosenStateAbove);
        oe20 += c.e20; oe11 += c.e11; oe02 += c.e02; }
      const offLp = suffixAcc.lp + dlp;
      const Boe20 = BigInt(oe20), Boe11 = BigInt(oe11), Boe02 = BigInt(oe02);
      const agg = M.prefixAggFor(kFile, kFile > 0 ? s : null);
      let sub = ZERO;
      for (const [plp, ag] of agg) {
        const lp = offLp + plp;
        const af = M.affineAt(lp);
        // Σ completionsOf(lp, off+pe) = base·cnt + d20·(cnt·oe20 + Σpe20) + ... (linearity)
        sub += af.base * ag.cnt
             + af.d20 * (ag.cnt * Boe20 + ag.s20)
             + af.d11 * (ag.cnt * Boe11 + ag.s11)
             + af.d02 * (ag.cnt * Boe02 + ag.s02);
      }
      sizes.push(sub);
    }
    return sizes;
  }

  // ENCODE pawn layer: descend N over files F-1..0, returning chosen state indices and the
  // residual N for the downstream (bishop/king/rest) layers.
  _rankPawns(N) {
    const M = this._pawnConvModel();
    const suffixAcc = { lp: 0, e20: 0, e11: 0, e02: 0 };
    let prevState = null;
    const chosen = new Array(M.F);
    for (let k = M.F - 1; k >= 0; k--) {
      const sizes = this._pawnSubtreeSizes(M, k, suffixAcc, prevState);
      let s = 0;
      while (s < sizes.length && N >= sizes[s]) { N -= sizes[s]; s++; }
      assert(s < sizes.length, 'pawn rank overflow at file ' + k);
      chosen[k] = s;
      suffixAcc.lp += M.fileLP[k][s];
      suffixAcc.e20 += M.withinE[k][s].e20; suffixAcc.e11 += M.withinE[k][s].e11; suffixAcc.e02 += M.withinE[k][s].e02;
      if (prevState !== null) { const c = M.crossE(k, s, prevState); suffixAcc.e20 += c.e20; suffixAcc.e11 += c.e11; suffixAcc.e02 += c.e02; }
      prevState = s;
    }
    return { chosen, rem: N };
  }

  // DECODE pawn layer: given chosen state indices, return the pawn-layer integer offset (sum of
  // completions of all canonically-earlier pawn configs).
  _unrankPawns(chosen) {
    const M = this._pawnConvModel();
    const suffixAcc = { lp: 0, e20: 0, e11: 0, e02: 0 };
    let prevState = null;
    let N = ZERO;
    for (let k = M.F - 1; k >= 0; k--) {
      const sizes = this._pawnSubtreeSizes(M, k, suffixAcc, prevState);
      for (let s = 0; s < chosen[k]; s++) N += sizes[s];
      const s = chosen[k];
      suffixAcc.lp += M.fileLP[k][s];
      suffixAcc.e20 += M.withinE[k][s].e20; suffixAcc.e11 += M.withinE[k][s].e11; suffixAcc.e02 += M.withinE[k][s].e02;
      if (prevState !== null) { const c = M.crossE(k, s, prevState); suffixAcc.e20 += c.e20; suffixAcc.e11 += c.e11; suffixAcc.e02 += c.e02; }
      prevState = s;
    }
    return N;
  }

  // Convolution capacity: Σ completions over all pawn configs, computed without enumeration.
  // Sanity gate — must equal _exactCapacityForEncoding() (enumeration) where enumeration is
  // feasible, and is the only viable capacity for the full 14^8 board.
  _capacityViaPawnConv() {
    if (this._capConvCache !== undefined) return this._capConvCache;
    const M = this._pawnConvModel();
    const suffixAcc = { lp: 0, e20: 0, e11: 0, e02: 0 };
    const sizes = this._pawnSubtreeSizes(M, M.F - 1, suffixAcc, null);
    let t = ZERO; for (const s of sizes) t += s;
    this._capConvCache = t;
    return t;
  }

  // Enumerate pawn configs in canonical order with their exact completion counts.
  // For boards where this is too large the caller should not use it; the toy and any
  // moderately sized family are fine. (Full 8x8 capacity is reported separately; full-board
  // round-trip uses randomized sampling that still enumerates per encode — see note.)
  _enumeratePawnConfigsWithCounts() {
    if (this._pawnConfigCache) return this._pawnConfigCache;
    const F = this.d.files;
    const fileCount = this.fileStates.length;
    const configs = [];
    const idx = new Array(F).fill(0);
    while (true) {
      const occupied = new Set();
      for (let f = 0; f < F; f++) {
        const [wr, br] = this.fileStates[idx[f]];
        occupied.add(wr * F + f); occupied.add(br * F + f);
      }
      const free = [];
      for (let i = 0; i < this.nSquares; i++) if (!occupied.has(i)) free.push(i);
      const count = this._completionsFromFree(free);
      if (count > ZERO) configs.push({ idx: idx.slice(), free, count });
      let p = 0;
      while (p < F) { idx[p]++; if (idx[p] < fileCount) break; idx[p] = 0; p++; }
      if (p === F) break;
    }
    this._pawnConfigCache = configs;
    return configs;
  }

  // ---- TREE-RANK decode: board -> integer N ----
  decode(board) {
    const F = this.d.files;
    const restTbl = this._restSymbolTable();
    const restTotal = restTbl.reduce((a, s) => a + s.n, 0);

    // identify pawn config
    const idx = new Array(F);
    for (let f = 0; f < F; f++) {
      let wr = -1, br = -1;
      for (const r of this.d.whitePawnRanks) if (board[r * F + f] === PIECE.WP) wr = r;
      for (const r of this.d.blackPawnRanks) if (board[r * F + f] === PIECE.BP) br = r;
      assert(wr >= 0 && br >= 0, `pawn missing in file ${f}`);
      let di = -1;
      for (let i = 0; i < this.fileStates.length; i++)
        if (this.fileStates[i][0] === wr && this.fileStates[i][1] === br) { di = i; break; }
      assert(di >= 0, 'pawn state not in family');
      idx[f] = di;
    }
    // pawn-layer offset via convolution unrank (no 14^8 enumeration)
    let N = this._unrankPawns(idx);
    // reconstruct this config's free-square set
    const occ = new Set();
    for (let f = 0; f < F; f++) {
      const [wr, br] = this.fileStates[idx[f]];
      occ.add(wr * F + f); occ.add(br * F + f);
    }
    let myFree = [];
    for (let i = 0; i < this.nSquares; i++) if (!occ.has(i)) myFree.push(i);

    // bishops: closed-form offset of canonically-earlier placements (no enumeration)
    let free = myFree.slice();
    const wbSquares = free.filter(s => board[s] === PIECE.WB);
    const bbSquares = free.filter(s => board[s] === PIECE.BB);
    const w = this.d.nonPawn.white, b = this.d.nonPawn.black;
    const myWL = w.B >= 1 ? wbSquares.find(s => this._color(s) === 1) : null;
    const myWD = w.B >= 2 ? wbSquares.find(s => this._color(s) === 0) : null;
    const myBL = b.B >= 1 ? bbSquares.find(s => this._color(s) === 1) : null;
    const myBD = b.B >= 2 ? bbSquares.find(s => this._color(s) === 0) : null;
    const nBishTot = w.B + b.B;
    const dResidualSize = free.length - nBishTot - 2;
    assert(dResidualSize >= restTotal, 'insufficient residual for rest pieces');
    const dRestArr = multisetCount([dResidualSize - restTotal, ...restTbl.map(s => s.n)]);
    const bdec = this._unrankBishops(free, { wl: myWL, wd: myWD, bl: myBL, bd: myBD }, dRestArr);
    N += bdec.offset;
    const myResidual = bdec.residual;

    // kings: N += kingDigit * restArr  (kingDigit = index in non-adjacent pair list)
    free = myResidual.slice();
    const pairs = this._orderedNonAdjPairs(free);
    const restCounts = [free.length - 2 - restTotal, ...restTbl.map(s => s.n)];
    const restArr = multisetCount(restCounts);

    if (this.d.kingsOutOfRank) {
      // Kings carry no payload. Delete both kings (their squares become EMPTY), then rank the
      // rest multiset over the FULL free set — exactly the square set encode ranked over, with
      // the 2 king squares counted as empties. No king digit is added to N.
      const work = Int8Array.from(board);
      let wk = -1, bk = -1;
      for (const i of free) { if (work[i] === PIECE.WK) wk = i; if (work[i] === PIECE.BK) bk = i; }
      assert(wk >= 0 && bk >= 0, 'king missing (kingsOutOfRank)');
      work[wk] = PIECE.EMPTY; work[bk] = PIECE.EMPTY;
      const codeToSym = new Map([[PIECE.EMPTY, 0], ...restTbl.map((s, i) => [PIECE[s.name], i + 1])]);
      const arrangement = free.map(sq => {
        const sym = codeToSym.get(work[sq]);
        assert(sym !== undefined, `unexpected piece ${work[sq]} on rest square`);
        return sym;
      });
      N += multisetRank(arrangement, restCounts);
      return N;
    }

    let sqA = -1, sqB = -1;
    for (const i of free) { if (board[i] === PIECE.WK) sqA = i; if (board[i] === PIECE.BK) sqB = i; }
    assert(sqA >= 0 && sqB >= 0, 'king missing');
    let kingDigit = -1;
    for (let i = 0; i < pairs.length; i++) if (pairs[i][0] === sqA && pairs[i][1] === sqB) { kingDigit = i; break; }
    assert(kingDigit >= 0, 'king pair not in family');

    // rest arrangement rank
    free = free.filter(x => x !== sqA && x !== sqB);
    const codeToSym = new Map([[PIECE.EMPTY, 0], ...restTbl.map((s, i) => [PIECE[s.name], i + 1])]);
    const arrangement = free.map(sq => {
      const sym = codeToSym.get(board[sq]);
      assert(sym !== undefined, `unexpected piece ${board[sq]} on rest square`);
      return sym;
    });
    const restRank = multisetRank(arrangement, restCounts);

    N += BigInt(kingDigit) * restArr + restRank;
    return N;
  }

  // Is square `sq` attacked by a NON-KING piece of the given side, on `board`?
  // byWhite=true -> attacked by white's Q/R/B/N/P. Kings are NOT attackers here: king-vs-king
  // is fully covered by the non-adjacency constraint, so including kings would never reject a
  // pair non-adjacency didn't already reject, and it keeps the attack mask a pure function of
  // the king-less material (so the scan() verifier reproduces it exactly). 8x8 only.
  _attacked(board, sq, byWhite) {
    const F = this.d.files;
    const r = Math.floor(sq / F), f = sq % F;
    const Q = byWhite ? PIECE.WQ : PIECE.BQ, R = byWhite ? PIECE.WR : PIECE.BR,
          B = byWhite ? PIECE.WB : PIECE.BB, N = byWhite ? PIECE.WN : PIECE.BN,
          P = byWhite ? PIECE.WP : PIECE.BP;
    const kn = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
    for (const [dr,df] of kn) { const rr=r+dr, ff=f+df;
      if (rr>=0&&rr<8&&ff>=0&&ff<8 && board[rr*F+ff]===N) return true; }
    // a WHITE pawn sits one rank BELOW the square it attacks; a black pawn one rank ABOVE.
    const pr = byWhite ? r-1 : r+1;
    if (pr>=0&&pr<8) for (const df of [-1,1]) { const ff=f+df;
      if (ff>=0&&ff<8 && board[pr*F+ff]===P) return true; }
    const orth=[[1,0],[-1,0],[0,1],[0,-1]], diag=[[1,1],[1,-1],[-1,1],[-1,-1]];
    for (const [dr,df] of orth) { let rr=r+dr, ff=f+df;
      while (rr>=0&&rr<8&&ff>=0&&ff<8) { const c=board[rr*F+ff];
        if (c!==0) { if (c===R||c===Q) return true; break; } rr+=dr; ff+=df; } }
    for (const [dr,df] of diag) { let rr=r+dr, ff=f+df;
      while (rr>=0&&rr<8&&ff>=0&&ff<8) { const c=board[rr*F+ff];
        if (c!==0) { if (c===B||c===Q) return true; break; } rr+=dr; ff+=df; } }
    return false;
  }

  // Place WK and BK on the canonically-first ordered (wk,bk) pair of EMPTY squares that is
  // non-adjacent, with wk not attacked by black and bk not attacked by white, on the king-less
  // board. Canonical order = ascending square index, wk outer then bk inner. Deterministic and
  // a pure function of the non-king board, so decode (which deletes the kings) and the scan()
  // re-encode reproduce it identically. Existence is guaranteed for full-material boards.
  _placeKingsSafely(board) {
    const empties = [];
    for (let i = 0; i < this.nSquares; i++) if (board[i] === PIECE.EMPTY) empties.push(i);
    for (let a = 0; a < empties.length; a++) {
      const wk = empties[a];
      if (this._attacked(board, wk, false)) continue;      // wk must not be attacked by black
      for (let b = 0; b < empties.length; b++) {
        if (a === b) continue;
        const bk = empties[b];
        if (this._adjacent(wk, bk)) continue;
        if (this._attacked(board, bk, true)) continue;      // bk must not be attacked by white
        board[wk] = PIECE.WK; board[bk] = PIECE.BK;
        return { wk, bk };
      }
    }
    throw new Error('no safe non-adjacent king pair found (should be impossible for full material)');
  }

  _adjacent(a, b) {
    const F = this.d.files;
    const fa = a % F, ra = Math.floor(a / F);
    const fb = b % F, rb = Math.floor(b / F);
    return Math.abs(fa - fb) <= 1 && Math.abs(ra - rb) <= 1;
  }

  // Ordered non-adjacent king pairs over a free-square list, canonical order:
  // outer loop sqA in ascending list order, inner sqB ascending, skip adjacent/equal.
  _orderedNonAdjPairs(free) {
    const out = [];
    for (let i = 0; i < free.length; i++) {
      for (let j = 0; j < free.length; j++) {
        if (i === j) continue;
        if (this._adjacent(free[i], free[j])) continue;
        out.push([free[i], free[j]]);
      }
    }
    return out;
  }
}

// Piece codes (0 = empty). Visible types only.
const PIECE = {
  EMPTY: 0,
  WK: 1, WQ: 2, WR: 3, WB: 4, WN: 5, WP: 6,
  BK: 7, BQ: 8, BR: 9, BB: 10, BN: 11, BP: 12,
};
const PIECE_CHAR = ['.', 'K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p'];

function boardToString(board, F, R) {
  let out = '';
  for (let r = R - 1; r >= 0; r--) {
    let row = '';
    for (let f = 0; f < F; f++) row += PIECE_CHAR[board[r * F + f]];
    out += row + '\n';
  }
  return out;
}




const ROT_PIECE = {
  [PIECE.EMPTY]: PIECE.EMPTY,
  [PIECE.WK]: PIECE.BK, [PIECE.WQ]: PIECE.BQ, [PIECE.WR]: PIECE.BR,
  [PIECE.WB]: PIECE.BB, [PIECE.WN]: PIECE.BN, [PIECE.WP]: PIECE.BP,
  [PIECE.BK]: PIECE.WK, [PIECE.BQ]: PIECE.WQ, [PIECE.BR]: PIECE.WR,
  [PIECE.BB]: PIECE.WB, [PIECE.BN]: PIECE.WN, [PIECE.BP]: PIECE.WP,
};
function rotateBoard(board, F, R) {
  const out = new Array(F * R);
  for (let i = 0; i < F * R; i++) {
    const f = i % F, r = Math.floor(i / F);
    out[(R - 1 - r) * F + (F - 1 - f)] = ROT_PIECE[board[i]];
  }
  return out;
}
function censusOfBoard(board) {
  const c = new Array(13).fill(0);
  for (const code of board) c[code]++;
  return c.slice(1).join(',');
}
function censusOfFamily(family) {
  const w = family.nonPawn.white, b = family.nonPawn.black, files = family.files;
  const c = new Array(13).fill(0);
  c[PIECE.WK]=w.K; c[PIECE.WQ]=w.Q; c[PIECE.WR]=w.R; c[PIECE.WB]=w.B; c[PIECE.WN]=w.N;
  c[PIECE.BK]=b.K; c[PIECE.BQ]=b.Q; c[PIECE.BR]=b.R; c[PIECE.BB]=b.B; c[PIECE.BN]=b.N;
  c[PIECE.WP]=files; c[PIECE.BP]=files;
  return c.slice(1).join(',');
}
function swapCensus(key) {
  const a = key.split(',').map(Number);
  return [...a.slice(6,12), ...a.slice(0,6)].join(',');
}
function randBig(max){const bits=max.toString(2).length;let x;do{let s='0b';for(let i=0;i<bits;i++)s+=Math.random()<0.5?'0':'1';x=BigInt(s);}while(x>=max);return x;}

function rotationProbe(family, { sampleLimit = 20000, exhaustiveMax = 200000n } = {}) {
  const t = new GeoChessFamily(family);
  const cap = t._capacityViaPawnConv();
  const F = family.files, R = family.ranks;
  const famKey = censusOfFamily(family);
  if (swapCensus(famKey) !== famKey) {
    return { mandatoryBits: 0, mode: 'structural', reason: 'census asymmetric: rotation swaps W/B out of family' };
  }
  const exhaustive = cap <= exhaustiveMax;
  const trials = exhaustive ? Number(cap) : sampleLimit;
  let checked = 0;
  for (let i = 0; i < trials; i++) {
    const n = exhaustive ? BigInt(i) : randBig(cap);
    const board = t.encode(n);
    const rot = rotateBoard(board, F, R);
    let m;
    try { m = t.decode(rot); } catch (e) { checked++; continue; }
    if (m !== n) return { mandatoryBits: 1, mode: exhaustive?'exhaustive':'sampled', reason: `witness N=${n} -> distinct N=${m}` };
    checked++;
  }
  return { mandatoryBits: 0, mode: exhaustive?'exhaustive':'sampled',
    reason: exhaustive?'no case-2 board (full scan)':`no witness in ${checked} samples (not a proof)`, checked };
}

function buildCatalogue(families, opts = {}) {
  return families.map(fam => {
    const t = new GeoChessFamily(fam.descriptor);
    const cap = t._capacityViaPawnConv();
    const bits = cap > 0n ? cap.toString(2).length - 1 : 0;
    const probe = rotationProbe(fam.descriptor, opts);
    const effectiveFloor = bits - probe.mandatoryBits;
    return { name: fam.name, vector: censusOfFamily(fam.descriptor), capacity: cap, bits,
      mandatoryBits: probe.mandatoryBits, probeMode: probe.mode, probeReason: probe.reason,
      effectiveFloor, clears104: effectiveFloor >= 104 };
  });
}


/*
 * engine.js — payload-aware GeoChess encoder/decoder (session 6).
 * Wraps the verified rank/unrank bijection with:
 *   - WHITENING: spreads a small payload across the full capacity so high-order layers
 *     (kings, bishops) match the family's natural distribution instead of freezing.
 *     N = (offset + p*stride) mod cap,  stride = floor(cap / 2^payloadBits).
 *     Proven bijective: (2^pb - 1)*stride < cap (session 6), so distinct p -> distinct N.
 *   - DISPATCH: given payload bits, pick the least-suspicious family whose capacity suffices.
 * Decode is the exact inverse; the dispatch key (visible material vector) tells decode which
 * family/whitening params to use, so no side channel is needed beyond the board itself.
 */

// Fixed irrational-ish offset multiplier (golden ratio fraction). Constant across all families;
// Whitening: a MULTIPLICATIVE permutation of [0, cap). The old scheme (offset + p·stride) had
// stride = cap >> payloadBits ≈ 1 when payloadBits ≈ log2(cap), so it was a pure additive shift
// that left the high-order layers (bishops, deep pawns) constant for small payloads — every
// realistic code froze the four bishops on a1/b1/c1/d1 and most of the pawn skeleton. A
// multiply by a large constant M coprime to cap scatters even a small p across the full range,
// so all layers vary; decode multiplies by M's modular inverse. Both are exact bijections on
// [0, cap), so the round-trip is preserved.
const GOLD_NUM = 6180339887n, GOLD_DEN = 10000000000n;

// extended Euclid -> modular inverse of a mod m (a,m coprime), always returned in [0,m).
function _modInverse(a, m) {
  let [old_r, r] = [((a % m) + m) % m, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) throw new Error('whitening multiplier not coprime to capacity');
  return ((old_s % m) + m) % m;
}
function _gcd(a, b) { while (b) { [a, b] = [b, a % b]; } return a < 0n ? -a : a; }

class GeoChessEngine {
  constructor(descriptor) {
    this.d = descriptor;
    this.fam = new GeoChessFamily(descriptor);
    this.cap = this.fam._capacityViaPawnConv();
    this.capBits = this.cap > 0n ? this.cap.toString(2).length - 1 : 0;
    this.vector = censusOfFamily(descriptor);
    this._whiten = this.cap > 1n ? this._makeWhiten() : null;
  }
  // Build a multiplier M coprime to cap, near cap·φ so the permutation scatters small payloads
  // across the whole range. Search upward from the golden target for the first coprime value.
  _makeWhiten() {
    const cap = this.cap;
    let M = (cap * GOLD_NUM) / GOLD_DEN;
    if (M < 2n) M = 2n;
    // make odd, then step by 2 until coprime to cap (cheap; coprime values are dense)
    if (M % 2n === 0n) M += 1n;
    let guard = 0;
    while (_gcd(M, cap) !== 1n) { M += 2n; if (++guard > 100000) { M = 1n; break; } }
    const Minv = (M === 1n) ? 1n : _modInverse(M, cap);
    return { M, Minv };
  }
  _params(payloadBits) {
    // payloadBits is retained for the range check only; whitening no longer depends on it.
    const pb = BigInt(payloadBits);
    if ((1n << pb) > this.cap && this.cap > 0n) {
      // allowed: codec validates p < usableCap; this guard only catches gross misuse
    }
    return this._whiten || { M: 1n, Minv: 1n };
  }
  encodePayload(p, payloadBits) {
    p = BigInt(p);
    if (p < 0n || p >= this.cap) throw new Error('payload out of range for capacity');
    const { M } = this._params(payloadBits);
    const N = (p * M) % this.cap;          // multiplicative permutation (spreads all layers)
    return this.fam.encode(N);             // board (square -> PIECE code)
  }
  decodePayload(board, payloadBits) {
    const { Minv } = this._params(payloadBits);
    const N = this.fam.decode(board);
    return (N * Minv) % this.cap;          // inverse permutation
  }
}

// Dispatch: choose the least visually suspicious family whose capacity >= payloadBits
// (+ reserved confirmation bits). "Least suspicious" = the ranking order in the catalogue
// (caller supplies families pre-ordered by plausibility preference). Returns the chosen engine.
function selectEngine(families, payloadBits, { reserveBits = 0 } = {}) {
  const need = payloadBits + reserveBits;
  for (const fam of families) {
    const e = new GeoChessEngine(fam.descriptor);
    if (e.capBits >= need) return { engine: e, family: fam };
  }
  throw new Error(`no family in catalogue clears ${need} bits`);
}



/*
 * parse-layer.js — Chessboard / HEALPix-Chessboard hex front-end (session 6).
 *
 * Contract (from Geosonify): the input is a HEX STRING, already passphrased/obfuscated
 * upstream or not — we don't care which. The STRING LENGTH encodes precision, so we must
 * NOT collapse to a bare integer: "096E" and "96E" are different codes and must yield
 * different boards and round-trip back to their exact original string (leading zeros intact).
 *
 * Packing (hex string  <->  payload integer P, a bijection over hex strings up to maxDigits):
 *   Let L = number of hex digits, V = value of those digits (BigInt, base 16).
 *   We need (L, V) packed so distinct (L,V) -> distinct P AND decode recovers L then V.
 *   Self-delimiting form:  P = (offsetForLen[L]) + V
 *     offsetForLen[L] = sum over l < L of 16^l   = (16^L - 1)/15
 *   i.e. P enumerates ALL hex strings ordered by (length, then value):
 *     "" -> 0 ; "0".."F" -> 1..16 ; "00".."FF" -> 17..272 ; ...
 *   This is exactly the bijection N <-> variable-length base-16 string with leading zeros
 *   significant (a.k.a. bijective base-16 offset). Decode: find L with offset[L] <= P <
 *   offset[L+1], then V = P - offset[L], render V as L hex digits zero-padded.
 *
 * The packed P is then handed to GeoChessEngine.encodePayload with payloadBits = bit length
 * of the family capacity's usable range — we size P against the family and refuse if it
 * doesn't fit.
 */

// offset[L] = (16^L - 1)/15  = number of hex strings of length < L
function lenOffset(L) { return ((16n ** BigInt(L)) - 1n) / 15n; }

function hexStringToPayload(hex) {
  const clean = hex.trim().toUpperCase();
  if (clean.length === 0) return 0n;
  if (!/^[0-9A-F]+$/.test(clean)) throw new Error('input is not a hex string');
  const L = clean.length;
  const V = BigInt('0x' + clean);
  return lenOffset(L) + V;
}

function payloadToHexString(P) {
  if (P < 0n) throw new Error('negative payload');
  // find L: largest with lenOffset(L) <= P
  let L = 0;
  while (lenOffset(L + 1) <= P) L++;
  const V = P - lenOffset(L);
  if (L === 0) return '';
  return V.toString(16).toUpperCase().padStart(L, '0');
}

class ChessboardCodec {
  // format: 'standard' | 'healpix' — currently identical hex handling; kept for labelling
  // and future divergence (e.g. different family choice per format).
  constructor(descriptor, format = 'standard') {
    this.format = format;
    this.engine = new GeoChessEngine(descriptor);
    // Whitening is now a multiplicative permutation over [0, cap), which spreads every payload
    // (including short ones) across all board layers — bishops and the deep pawn skeleton vary
    // as they should. We keep the usable payload space at 2^pb (the largest power of two below
    // cap) so maxHexDigits stays at the "every length-L code fits" guarantee; codes above it are
    // cleanly refused. The permutation is bijective on all of [0, cap), so 2^pb is a safe subset.
    this.pb = this.engine.cap.toString(2).length - 1;
    this.usableCap = 1n << BigInt(this.pb);
    this.capBits = this.pb;
  }
  // largest hex length L such that EVERY length-L code fits in the usable payload space.
  // A length-L code's largest payload is lenOffset(L+1)-1; it fully fits iff that < usableCap.
  maxHexDigits() {
    let L = 0;
    while (lenOffset(L + 2) - 1n < this.usableCap) L++;
    return L;
  }
  toBoard(hex) {
    const P = hexStringToPayload(hex);
    if (P >= this.usableCap) {
      throw new Error(`code too precise for this board family: needs > ${this.capBits} bits ` +
        `(max ~${this.maxHexDigits()} hex digits). Use a coarser code or a larger family.`);
    }
    // payloadBits sized so whitening stride is well-defined and bijective for THIS P-range.
    const pb = this.pb;
    const board = this.engine.encodePayload(P, pb);
    return board;
  }
  fromBoard(board) {
    const pb = this.pb;
    const P = this.engine.decodePayload(board, pb);
    return payloadToHexString(P);
  }
}



// ---- text board forms (for cards: FEN + ASCII, both with copy + both decodable) -------------
const _LET = ['','K','Q','R','B','N','P','k','q','r','b','n','p'];
function boardToFEN(board) {            // placement field only (no side-to-move etc.)
  let rows = [];
  for (let r = 7; r >= 0; r--) { let row = '', e = 0;
    for (let f = 0; f < 8; f++) { const c = board[r*8+f];
      if (c === 0) e++; else { if (e) { row += e; e = 0; } row += _LET[c]; } }
    if (e) row += e; rows.push(row);
  }
  return rows.join('/');
}
function fenToBoard(field) {            // accepts placement field (text before first space)
  field = String(field).trim().split(/\s+/)[0];
  const rows = field.split('/'); if (rows.length !== 8) return null;
  const code = {K:1,Q:2,R:3,B:4,N:5,P:6,k:7,q:8,r:9,b:10,n:11,p:12};
  const board = new Array(64).fill(0);
  for (let i = 0; i < 8; i++) { const rank = 7 - i; let f = 0;
    for (const ch of rows[i]) {
      if (/[1-8]/.test(ch)) f += parseInt(ch, 10);
      else if (ch in code) { if (f > 7) return null; board[rank*8+f] = code[ch]; f++; }
      else return null;
    }
    if (f !== 8) return null;
  }
  return board;
}
function boardToASCII(board) {          // fixed-width, bordered, uppercase=White lowercase=black
  let out = '    a b c d e f g h\n  +-----------------+\n';
  for (let r = 7; r >= 0; r--) { out += (r+1) + ' | ';
    for (let f = 0; f < 8; f++) { const c = board[r*8+f]; out += (c === 0 ? '.' : _LET[c]) + ' '; }
    out += '| ' + (r+1) + '\n';
  }
  return out + '  +-----------------+\n    a b c d e f g h';
}
function asciiToBoard(ascii) {          // inverse of boardToASCII; tolerant of the border lines
  const code = {K:1,Q:2,R:3,B:4,N:5,P:6,k:7,q:8,r:9,b:10,n:11,p:12};
  const board = new Array(64).fill(0);
  const lines = String(ascii).split('\n').filter(l => /\|/.test(l)); // only the 8 piece rows
  if (lines.length !== 8) return null;
  for (let i = 0; i < 8; i++) { const rank = 7 - i;
    const inside = lines[i].slice(lines[i].indexOf('|')+1, lines[i].lastIndexOf('|'));
    const cells = inside.trim().split(/\s+/);
    if (cells.length !== 8) return null;
    for (let f = 0; f < 8; f++) { const ch = cells[f]; if (ch === '.') continue;
      if (!(ch in code)) return null; board[rank*8+f] = code[ch]; }
  }
  return board;
}

// add as codec methods too, for the card pipeline
ChessboardCodec.prototype.toFEN   = function(hex){ return boardToFEN(this.toBoard(hex)); };
ChessboardCodec.prototype.toASCII = function(hex){ return boardToASCII(this.toBoard(hex)); };
// decode-with-verification: rejects boards NOT in the encoder's image (the scanner caveat)
ChessboardCodec.prototype.scan = function(board){
  const hex = this.fromBoard(board);
  const reb = this.toBoard(hex);
  for (let i = 0; i < 64; i++) if (reb[i] !== board[i]) return { ok:false, hex:null, reason:'board is not a valid card (re-encode mismatch)' };
  return { ok:true, hex };
};






// Node test hook (ignored in browser where module is undefined). NOT part of the browser bundle.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChessboardCodec, GeoChessFamily, GeoChessEngine, boardToFEN, fenToBoard,
    boardToASCII, asciiToBoard, PIECE, hexStringToPayload, payloadToHexString, lenOffset };
}
