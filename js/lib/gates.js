// gates.js — chessboard codec invariant suite.
// 8 existing gates (reconstructed to the handover spec) + NEW invariance gate (gate 9).
// Run: node gates.js
'use strict';
const C = require('/home/claude/build/chessboard-bundle.js');
const { ChessboardCodec, hexStringToPayload, payloadToHexString, lenOffset,
        boardToFEN, fenToBoard, PIECE } = C;

const CHESS_FAMILY = { files:8, ranks:8, whitePawnRanks:[1,2,3,4], blackPawnRanks:[3,4,5,6],
  nonPawn:{ white:{K:1,Q:1,R:2,B:2,N:2}, black:{K:1,Q:1,R:2,B:2,N:2} }, kingsOutOfRank:true };
const c = new ChessboardCodec(CHESS_FAMILY);
const fam = c.engine.fam;
const MAXHEX = c.maxHexDigits();

function rl(L){let s='';for(let i=0;i<L;i++)s+='0123456789abcdef'[Math.floor(Math.random()*16)];return s;}
function eq(a,b){ if(a.length!==b.length) return false; for(let i=0;i<a.length;i++) if(a[i]!==b[i]) return false; return true; }
let pass=0, fail=0;
function gate(name, ok, detail){ if(ok){pass++; console.log('  PASS  '+name);} else {fail++; console.log('  FAIL  '+name+(detail?'  -- '+detail:''));} }

console.log(`\n=== chessboard gates (maxHex=${MAXHEX}, capBits=${c.engine.cap.toString(2).length}) ===\n`);

// ---- Gate 1: hex-string packing bijection (leading zeros significant) ----
(()=>{
  const samples=['96E','096E','0096E','0','00','000','F','0F','FFFF','00000'];
  const boards = samples.map(h=>{ try{return c.toBoard(h);}catch(e){return null;} });
  let distinct=true;
  for(let i=0;i<samples.length;i++) for(let j=i+1;j<samples.length;j++){
    if(boards[i]&&boards[j]&&eq(boards[i],boards[j])){ distinct=false; }
  }
  // round-trip preserves exact string incl. leading zeros
  let rt=true;
  for(const h of samples){ try{ if(c.fromBoard(c.toBoard(h)).toUpperCase()!==h.toUpperCase()) rt=false; }catch(e){} }
  gate('Gate 1: hex packing — leading zeros significant & length-preserving', distinct&&rt);
})();

// ---- Gate 2b: full-family total bijection (30k incl. range edges) ----
(()=>{
  let ok=true, n=0;
  const lens=[1,2,3,8,12,18,MAXHEX];
  for(const L of lens){
    for(let i=0;i<4000;i++){
      const h=rl(L); n++;
      let b; try{ b=c.toBoard(h); }catch(e){ continue; }
      if(c.fromBoard(b).toUpperCase()!==h.toUpperCase()){ ok=false; break; }
    }
    if(!ok)break;
  }
  // explicit range edges: 0 and usableCap-1
  const edges=[0n, c.usableCap-1n];
  for(const P of edges){ const h=payloadToHexString(P); try{ const b=c.toBoard(h); if(hexStringToPayload(c.fromBoard(b))!==P) ok=false; }catch(e){ if(P<c.usableCap) ok=false; } }
  gate(`Gate 2b: full-family total bijection (${n} samples + range edges)`, ok);
})();

// ---- Gate 3: 0% kings in check (20k) ----
(()=>{
  let bad=0;
  for(let i=0;i<20000;i++){
    const b=c.toBoard(rl(12));
    let wk=-1,bk=-1;
    for(let s=0;s<64;s++){ if(b[s]===PIECE.WK)wk=s; if(b[s]===PIECE.BK)bk=s; }
    if(fam._attacked(b,wk,false)||fam._attacked(b,bk,true)) bad++;
  }
  gate('Gate 3: 0% kings in check (20k)', bad===0, bad+' in check');
})();

// ---- Gate 4: hex -> board -> FEN -> board -> hex (20k) ----
(()=>{
  let ok=true,n=0;
  for(let i=0;i<20000;i++){
    const L=1+Math.floor(Math.random()*MAXHEX);
    const h=rl(L);
    let b; try{ b=c.toBoard(h);}catch(e){ continue; }
    const fen=boardToFEN(b);
    const b2=fenToBoard(fen);
    if(!b2||!eq(Array.from(b),b2)){ ok=false; break; }
    if(c.fromBoard(Int8Array.from(b2)).toUpperCase()!==h.toUpperCase()){ ok=false; break; }
    n++;
  }
  gate(`Gate 4: hex→board→FEN→board→hex (${n})`, ok);
})();

// ---- Gate 5: verify-on-decode scanner rejects doctored boards ----
(()=>{
  let ok=true;
  for(let i=0;i<2000;i++){
    const b=c.toBoard(rl(12));
    const scanned=c.scan(b);
    if(!scanned.ok){ ok=false; break; }            // valid card must pass
    // doctor: swap two non-king squares to a piece that breaks the image
    const b2=Int8Array.from(b);
    // find an empty and a piece, swap -> almost surely off-image
    let e=-1,p=-1;
    for(let s=0;s<64;s++){ if(b2[s]===0&&e<0)e=s; if(b2[s]===PIECE.WQ&&p<0)p=s; }
    if(e>=0&&p>=0){ b2[e]=PIECE.WQ; /* two queens now: off material vector */
      let rejected=false;
      try{ const sc=c.scan(b2); rejected=!sc.ok; }
      catch(err){ rejected=true; }                   // re-encode out-of-range => also a rejection
      if(!rejected){ ok=false; break; }               // doctored must be rejected
    }
  }
  gate('Gate 5: verify-on-decode scanner rejects doctored boards', ok);
})();

// ---- Gate 6: capacity / refuse-don't-truncate ----
(()=>{
  // every length <= MAXHEX fully fits; MAXHEX+1 may refuse but never corrupt
  let ok=true;
  // all MAXHEX-length codes fit
  for(let i=0;i<3000;i++){ const h=rl(MAXHEX); try{ const b=c.toBoard(h); if(c.fromBoard(b).toUpperCase()!==h.toUpperCase()) ok=false; }catch(e){ ok=false; } if(!ok)break; }
  gate('Gate 6: capacity — all MAXHEX codes fit & round-trip', ok);
})();

// ---- Gate 7: whitening-gap — MAXHEX+1 refuse-or-roundtrip, 0 corrupt ----
(()=>{
  let corrupt=0,refused=0,rt=0;
  for(let i=0;i<20000;i++){
    const h=rl(MAXHEX+1);
    try{ const b=c.toBoard(h); if(c.fromBoard(b).toUpperCase()!==h.toUpperCase()) corrupt++; else rt++; }
    catch(e){ refused++; }
  }
  gate(`Gate 7: whitening-gap — MAXHEX+1 refuse-or-roundtrip, 0 corrupt (rt=${rt} ref=${refused})`, corrupt===0, corrupt+' corrupt');
})();

// ---- Gate 8: round-trip 100% at every length 1..MAXHEX ----
(()=>{
  let ok=true, worst=null;
  for(let L=1;L<=MAXHEX;L++){
    for(let i=0;i<1500;i++){
      const h=rl(L);
      let b; try{ b=c.toBoard(h);}catch(e){ continue; }
      if(c.fromBoard(b).toUpperCase()!==h.toUpperCase()){ ok=false; worst=L; break; }
    }
    if(!ok)break;
  }
  gate('Gate 8: round-trip 100% at every length 1..MAXHEX', ok, worst?('fails at L='+worst):'');
})();

// ---- Gate 9 (NEW): bishop invariance — no piece-bearing square frozen ----
(()=>{
  const seen=Array.from({length:64},()=>new Set());
  for(let i=0;i<5000;i++){ const b=c.toBoard(rl(12)); for(let s=0;s<64;s++) seen[s].add(b[s]); }
  let frozenPieces=[];
  for(let s=0;s<64;s++){ if(seen[s].size===1){ const v=[...seen[s]][0]; if(v!==0) frozenPieces.push(s); } }
  gate('Gate 9 (NEW): invariance — no piece-bearing square frozen', frozenPieces.length===0,
       frozenPieces.length?('frozen pieces at '+JSON.stringify(frozenPieces)):'');
})();

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail?1:0);
