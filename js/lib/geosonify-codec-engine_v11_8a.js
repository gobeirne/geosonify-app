/*
  geosonify-codec-engine.v11.7a.js
  - Position-based obfuscation shifting: -1 for 2nd-last, -2 for 3rd-last, etc.
  - Real Karney geodesic (GeographicLib) with fallback to robust Vincenty
  - Obfuscation is safe-prefix & token-based; no 'undefined' ever.
  - Includes SHA3-512 and Karney/Vincenty distance.
  
  USAGE: For nanometre-precision distance calculations, load GeographicLib before this file:
  <script src="https://cdn.jsdelivr.net/npm/geographiclib-geodesic@2.0.0/geographiclib-geodesic.min.js"></script>
  
  If GeographicLib is not available, falls back to robust Vincenty (centimetre precision).
*/
(function(global){
  'use strict';
  const __GEOSONIFY_ENGINE_VER__ = 'v11.7a';
  try { console.log('[geosonify] engine ' + __GEOSONIFY_ENGINE_VER__ + ' loaded'); } catch(e){}

  /* ===== SHA3-512 ===== */
  function Sha3_512(){ this.state = new Uint32Array(50); this.pos = 0; this.blockLen = 72; this.finished = false; }
  Sha3_512.prototype._keccakf = (function(){
    var R=[0,36,3,41,18,1,44,10,45,2,62,6,43,15,61,28,55,25,21,56,27,20,39,8,14];
    var RC=[1,0,0,89,0,28,0,169,0,2,0,7,0,0x8000000a,0,0x80000008,0,0x80000001,0,0x80000080,0,0x8b,0,0x8a,0,0x81,0,0x80000081,0,0x80000008,0,0x83,0,0x8000000b,0,0x8000001b,0,0x1b];
    function ROTL64(hi, lo, n){ n&=63; if(n===0) return [hi,lo]; if(n<32){ var nhi=(hi<<n)|(lo>>>(32-n)); var nlo=(lo<<n)|(hi>>>(32-n)); return [nhi>>>0,nlo>>>0]; } n-=32; var nhi2=(lo<<n)|(hi>>>(32-n)); var nlo2=(hi<<n)|(lo>>>(32-n)); return [nhi2>>>0,nlo2>>>0]; }
    return function(a){
      for(var round=0; round<24; round++){
        var C=new Uint32Array(10), D=new Uint32Array(10), B=new Uint32Array(50);
        for(var x=0;x<5;x++){ var lo=0,hi=0; for(var y=0;y<5;y++){ var i=2*(x+5*y); lo^=a[i]; hi^=a[i+1]; } C[2*x]=lo; C[2*x+1]=hi; }
        for(var x2=0;x2<5;x2++){ var r=(x2+4)%5,s=(x2+1)%5; var rot=ROTL64(C[2*s+1],C[2*s],1); D[2*x2]=C[2*r]^rot[1]; D[2*x2+1]=C[2*r+1]^rot[0]; }
        for(var y2=0;y2<5;y2++){ for(var x3=0;x3<5;x3++){ var idx=2*(x3+5*y2); a[idx]^=D[2*x3]; a[idx+1]^=D[2*x3+1]; } }
        for(var y3=0;y3<5;y3++){ for(var x4=0;x4<5;x4++){ var i2=x4+5*y3; var j=y3+((2*x4+3*y3)%5)*5; var off=R[i2]; var r2=ROTL64(a[2*i2+1],a[2*i2],off); B[2*j]=r2[1]; B[2*j+1]=r2[0]; } }
        for(var y4=0;y4<5;y4++){ for(var x5=0;x5<5;x5++){ var i3=2*(x5+5*y4), iN=2*(((x5+1)%5)+5*y4), iNN=2*(((x5+2)%5)+5*y4); a[i3]=B[i3]^((~B[iN])&B[iNN]); a[i3+1]=B[i3+1]^((~B[iN+1])&B[iNN+1]); } }
        a[0]^=RC[2*round]>>>0; a[1]^=RC[2*round+1]>>>0;
      }
    };
  })();
  Sha3_512.prototype.update=function(data){ if(this.finished) throw new Error("sha3_512: already finalized"); var a=this.state,i=0,len=data.length|0; while(i<len){ var b=Math.min(this.blockLen-this.pos,len-i); for(var j=0;j<b;j++){ var t=data[i+j],wi=(this.pos>>2),sh=(this.pos&3)*8; a[wi*2]^=(t&0xff)<<sh; this.pos++; if(this.pos===this.blockLen){ this._keccakf(a); this.pos=0; } } i+=b; } return this; };
  Sha3_512.prototype.finalize=function(){ if(this.finished) return this; var a=this.state,pad=0x06,wi=(this.pos>>2),sh=(this.pos&3)*8; a[wi*2]^=pad<<sh; a[((this.blockLen-1)>>2)*2]^=0x80<<(((this.blockLen-1)&3)*8); this._keccakf(a); this.finished=true; return this; };
  Sha3_512.prototype.hex=function(){ if(!this.finished) this.finalize(); var a=this.state,out='',bytesNeeded=64,p=0; while(bytesNeeded>0){ var wi=(p>>2),sh=(p&3)*8,b=(a[wi*2]>>>sh)&0xff; out+=(b<16?'0':'')+b.toString(16); p++; bytesNeeded--; if(p===this.blockLen&&bytesNeeded>0){ this._keccakf(a); p=0; } } return out; };
  function sha3_512_hex(str){ var enc=new TextEncoder(); var h=new Sha3_512(); h.update(enc.encode(str)); return h.hex(); }

  /* ===== Geodesic: Real Karney with Vincenty fallback ===== */
  
  // Robust Vincenty implementation (centimetre precision, with simple Vincenty fallback)
  function distanceMetersVincentyRobust(lat1, lon1, lat2, lon2){
    var a=6378137.0,f=1/298.257223563,b=(1-f)*a;
    var φ1=lat1*Math.PI/180, φ2=lat2*Math.PI/180, L=(lon2-lon1)*Math.PI/180;
    var U1=Math.atan((1-f)*Math.tan(φ1)), U2=Math.atan((1-f)*Math.tan(φ2));
    var sinU1=Math.sin(U1),cosU1=Math.cos(U1),sinU2=Math.sin(U2),cosU2=Math.cos(U2);
    var λ=L,λP,sinλ,cosλ,sinσ,cosσ,σ,sinα,cos2α,cos2σm,C;
    for(var iter=0; iter<200; iter++){
      sinλ=Math.sin(λ); cosλ=Math.cos(λ);
      var t1=cosU2*sinλ, t2=cosU1*sinU2 - sinU1*cosU2*cosλ;
      sinσ=Math.hypot(t1,t2); if(sinσ===0) return 0;
      cosσ=sinU1*sinU2 + cosU1*cosU2*cosλ;
      σ=Math.atan2(sinσ,cosσ);
      sinα=cosU1*cosU2*sinλ/sinσ;
      cos2α=1 - sinα*sinα;
      cos2σm=(cos2α!==0)?(cosσ - 2*sinU1*sinU2/cos2α):0;
      C=f/16*cos2α*(4+f*(4-3*cos2α));
      λP=λ; λ=L + (1-C)*f*sinα*(σ + C*sinσ*(cos2σm + C*cosσ*(-1 + 2*cos2σm*cos2σm)));
      if(Math.abs(λ-λP)<1e-13) break;
      if(iter%20===19) λ=(λ+λP)/2;
    }
    if(!isFinite(λ)) return vincentyDistanceMetersSimple(lat1,lon1,lat2,lon2);
    var u2=cos2α*(a*a-b*b)/(b*b);
    var A=1+u2/16384*(4096+u2*(-768+u2*(320-175*u2)));
    var B=u2/1024*(256+u2*(-128+u2*(74-47*u2)));
    var Δσ=B*sinσ*(cos2σm + B/4*(cosσ*(-1+2*cos2σm*cos2σm) - B/6*cos2σm*(-3+4*sinσ*sinσ)*(-3+4*cos2σm*cos2σm)));
    return (1-f)*a * A * (σ - Δσ);
  }
  
  // Simple Vincenty (final fallback, metre precision)
  function vincentyDistanceMetersSimple(lat1, lon1, lat2, lon2){
    var a=6378137.0,f=1/298.257223563,b=(1-f)*a;
    var φ1=lat1=Math.PI*lat1/180, φ2=Math.PI*lat2/180, L=(lon2-lon1)*Math.PI/180;
    var U1=Math.atan((1-f)*Math.tan(φ1)), U2=Math.atan((1-f)*Math.tan(φ2));
    var sinU1=Math.sin(U1),cosU1=Math.cos(U1),sinU2=Math.sin(U2),cosU2=Math.cos(U2);
    var λ=L,λP,iterLimit=100,sinλ,cosλ,sinσ,cosσ,σ,sinα,cos2α,cos2σm,C;
    do{
      sinλ=Math.sin(λ); cosλ=Math.cos(λ);
      sinσ=Math.sqrt((cosU2*sinλ)*(cosU2*sinλ) + (cosU1*sinU2 - sinU1*cosU2*cosλ)*(cosU1*sinU2 - sinU1*cosU2*cosλ));
      if(sinσ===0) return 0;
      cosσ=sinU1*sinU2 + cosU1*cosU2*cosλ;
      σ=Math.atan2(sinσ,cosσ);
      sinα=cosU1*cosU2*sinλ/sinσ;
      cos2α=1 - sinα*sinα;
      cos2σm=(cos2α!==0)?(cosσ - 2*sinU1*sinU2/cos2α):0;
      C=f/16*cos2α*(4+f*(4-3*cos2α));
      λP=λ; λ=L + (1-C)*f*sinα*(σ + C*sinσ*(cos2σm + C*cosσ*(-1 + 2*cos2σm*cos2σm)));
    } while(Math.abs(λ-λP)>1e-12 && --iterLimit>0);
    if(iterLimit===0) return NaN;
    var u2=cos2α*(a*a-b*b)/(b*b);
    var A=1+u2/16384*(4096+u2*(-768+u2*(320-175*u2)));
    var B=u2/1024*(256+u2*(-128+u2*(74-47*u2)));
    var Δσ=B*sinσ*(cos2σm + B/4*(cosσ*(-1+2*cos2σm*cos2σm) - B/6*cos2σm*(-3+4*sinσ*sinσ)*(-3+4*cos2σm*cos2σm)));
    return b*A*(σ-Δσ);
  }

  // Real Karney geodesic (nanometre precision) using GeographicLib
  function distanceMetersKarneyReal(lat1, lon1, lat2, lon2){
    try {
      // Check if GeographicLib is available
      if (typeof GeographicLib !== 'undefined' && 
          GeographicLib.Geodesic && 
          GeographicLib.Geodesic.WGS84) {
        var geod = GeographicLib.Geodesic.WGS84;
        var result = geod.Inverse(lat1, lon1, lat2, lon2);
        if (result && typeof result.s12 === 'number' && isFinite(result.s12)) {
          return result.s12;
        }
      }
    } catch(e) {
      // GeographicLib failed, fall through to Vincenty
    }
    // Fallback to robust Vincenty
    return distanceMetersVincentyRobust(lat1, lon1, lat2, lon2);
  }

  /* ===== Grid + codec + obfuscation ===== */
  function flattenGrid(grid2D){ return grid2D ? [].concat.apply([], grid2D) : []; }
  function gridDims(grid2D){ var r=grid2D.length||0; var c=r?(grid2D[0].length||0):0; return {rows:r, cols:c}; }
  function sanitizeNoUndefined(str){ var i = String(str).indexOf('undefined'); return (i===-1)? String(str) : String(str).slice(0, i); }
  function boundsForCell(rows, cols, r, c, latMin, latMax, lonMin, lonMax){
    var dLat=(latMax-latMin)/rows, dLon=(lonMax-lonMin)/cols;
    return { latMin: latMax - dLat*(r+1), latMax: latMax - dLat*r, lonMin: lonMin + dLon*c, lonMax: lonMin + dLon*(c+1) };
  }
  function tokenizeCode(code, flat){
    var uniq=Array.from(new Set(flat.slice().map(String))).filter(function(t){return t.length>0;});
    uniq.sort(function(a,b){return b.length-a.length;});
    var out=[], i=0;
    while(i<code.length){
      var matched=null;
      for(var k=0;k<uniq.length;k++){ var tok=uniq[k]; if(code.substr(i, tok.length)===tok){ matched=tok; break; } }
      if(!matched) return null;
      out.push(matched); i+=matched.length;
    }
    return out;
  }
  function codeToIndexTokens(tokens, domainFlat){
    var idxs=new Array(tokens.length);
    for(var i=0;i<tokens.length;i++){ var idx=domainFlat.indexOf(tokens[i]); if(idx<0) return null; idxs[i]=idx; }
    return idxs;
  }
  function indexTokensToCode(indices, domainFlat){
    var toks=new Array(indices.length);
    for(var i=0;i<indices.length;i++){ var idx=indices[i]; if(idx<0||idx>=domainFlat.length) return null; toks[i]=domainFlat[idx]; }
    return toks.join('');
  }
  function buildIndexSeedString(N, lastIndexFlat){ var parts=new Array(N); for(var i=0;i<N;i++) parts[i]=String(i); return parts.join(',') + '|' + String(lastIndexFlat); }
  function sha3_512_hex(str){ var enc=new TextEncoder(); var h=new Sha3_512(); h.update(enc.encode(str)); return h.hex(); }
  function generateStrongSeedFromIndices(N, lastIndexFlat){
    var seedString=buildIndexSeedString(N, lastIndexFlat);
    var hashSeed=sha3_512_hex(seedString), minLen=N*3;
    while(hashSeed.length<minLen){ hashSeed+=sha3_512_hex(hashSeed); if(hashSeed.length>10000) break; }
    return hashSeed.substring(0, minLen);
  }
  function generateShuffleOrderFromHash(N, seedHash){
    var chunkSize=Math.floor(seedHash.length/N)||1, items=[];
    for(var i=0;i<N;i++){ var chunk=seedHash.substr(i*chunkSize, chunkSize); var key=0; try{ key=parseInt(chunk,16);}catch(e){key=0;} items.push({i:i,k:key}); }
    items.sort(function(a,b){return a.k-b.k;});
    var order=new Array(N); for(var j=0;j<N;j++) order[j]=items[j].i; return order;
  }
  function applyShuffle(flat, order){ var out=new Array(flat.length); for(var i=0;i<order.length;i++) out[i]=flat[order[i]]; return out; }

  // ===== Obfuscation shuffle cache =====
  // Key: "N|lastIndexFlat" → { order, shuffledByFlat: Map<flatIdentity, shuffled[]> }
  // The order array depends only on (N, lastIndexFlat) — deterministic.
  // The shuffled array depends on order + the specific flat symbols, so we cache per flat identity too.
  var _obfShuffleCache = {};
  var _obfCacheSize = 0;
  var _OBF_CACHE_MAX = 512;  // Max entries before reset (generous; typical use: N entries per grid)
  
  function _getFlatIdentity(flat) {
    // Use first + last + length as a fast identity key for a flat array
    // (Different grids have different symbols/lengths, so this distinguishes them)
    return flat.length + '|' + String(flat[0]) + '|' + String(flat[flat.length-1]);
  }
  
  function _getCachedShuffle(N, lastIndexFlat, flat) {
    var cacheKey = N + '|' + lastIndexFlat;
    var entry = _obfShuffleCache[cacheKey];
    if (!entry) {
      // Compute order (depends only on N and lastIndexFlat)
      var seedHash = generateStrongSeedFromIndices(N, lastIndexFlat);
      var order = generateShuffleOrderFromHash(N, seedHash);
      entry = { order: order, shuffledByFlat: {} };
      _obfShuffleCache[cacheKey] = entry;
      _obfCacheSize++;
      if (_obfCacheSize > _OBF_CACHE_MAX) { _obfShuffleCache = {}; _obfCacheSize = 0; entry = { order: order, shuffledByFlat: {} }; _obfShuffleCache[cacheKey] = entry; _obfCacheSize = 1; }
    }
    var flatId = _getFlatIdentity(flat);
    var shuffled = entry.shuffledByFlat[flatId];
    if (!shuffled) {
      shuffled = applyShuffle(flat, entry.order);
      entry.shuffledByFlat[flatId] = shuffled;
    }
    return { order: entry.order, shuffled: shuffled };
  }

  function maxSafePrefixLength(tokens, flat){
    if(!tokens||!tokens.length) return 0;
    var lastToken=tokens[tokens.length-1], lastIndexFlat=flat.indexOf(lastToken);
    if(lastIndexFlat<0) return 0;
    var N=flat.length;
    var cached=_getCachedShuffle(N, lastIndexFlat, flat);
    var shuffled=cached.shuffled;
    var count=0;
    for(var i=0;i<tokens.length;i++){ if(shuffled.indexOf(tokens[i])<0) break; count++; }
    return count;
  }

  function applyIndexObfuscation(mode, code, flat){
    var tokens=tokenizeCode(code, flat);
    if(!tokens||!tokens.length) return code;
    var safeLen=maxSafePrefixLength(tokens, flat);
    if(safeLen<=0) return '';
    var prefixTokens=tokens.slice(0,safeLen);
    var N=flat.length;
    var lastToken=prefixTokens[prefixTokens.length-1];
    var lastIndexFlat=flat.indexOf(lastToken);
    var cached=_getCachedShuffle(N, lastIndexFlat, flat);
    var shuffled=cached.shuffled;
    var idxs=codeToIndexTokens(prefixTokens, shuffled);
    if(!idxs||!idxs.length) return '';
    var lastIdx=idxs.pop();
    var outIdxs=new Array(idxs.length);
    // Position-based shifting: -1 for 2nd-last, -2 for 3rd-last, etc.
    if(mode==='encode'){ 
      for(var j=0;j<idxs.length;j++) {
        var posFromEnd = idxs.length - j;  // Distance from final char
        outIdxs[j]=(idxs[j] - posFromEnd + N) % N;
      }
    }
    else{ 
      for(var k=0;k<idxs.length;k++) {
        var posFromEnd = idxs.length - k;  // Distance from final char
        outIdxs[k]=(idxs[k] + posFromEnd) % N;
      }
    }
    var left=indexTokensToCode(outIdxs, shuffled) || '';
    var tail=(lastIdx>=0&&lastIdx<N)? shuffled[lastIdx] : '';
    return sanitizeNoUndefined(left + tail);
  }

  function obfuscateUpToValid(mode, code, flat){ return applyIndexObfuscation(mode, code, flat); }

  function encodeHierarchical(lat, lon, grid2D, iterations){
    iterations=Math.max(1, iterations|0);
    var d=gridDims(grid2D), rows=d.rows, cols=d.cols, flat=flattenGrid(grid2D);
    if(!rows||!cols||flat.length!==rows*cols) return '';
    var latMin=-90,latMax=90,lonMin=-180,lonMax=180, code='';
    for(var it=0; it<iterations; it++){
      var rFrac=(latMax-lat)/(latMax-latMin), cFrac=(lon-lonMin)/(lonMax-lonMin);
      var r=Math.floor(rFrac*rows); if(r<0) r=0; if(r>=rows) r=rows-1;
      var c=Math.floor(cFrac*cols); if(c<0) c=0; if(c>=cols) c=cols-1;
      var idx=r*cols+c; var tok=String(flat[idx]); if(!tok){ return code; }
      code+=tok;
      var b=boundsForCell(rows, cols, r, c, latMin, latMax, lonMin, lonMax);
      latMin=b.latMin; latMax=b.latMax; lonMin=b.lonMin; lonMax=b.lonMax;
    }
    return code;
  }
  function decodeHierarchical(code, grid2D, iterations){
    var d=gridDims(grid2D), rows=d.rows, cols=d.cols, flat=flattenGrid(grid2D);
    if(!rows||!cols||flat.length!==rows*cols) return null;
    var tokens=tokenizeCode(code, flat); if(!tokens||!tokens.length) return null;
    if(iterations && tokens.length>iterations) tokens=tokens.slice(0,iterations);
    var latMin=-90,latMax=90,lonMin=-180,lonMax=180;
    for(var i=0;i<tokens.length;i++){
      var idx=flat.indexOf(tokens[i]); if(idx<0) return null;
      var r=Math.floor(idx/cols), c=idx%cols;
      var b=boundsForCell(rows, cols, r, c, latMin, latMax, lonMin, lonMax);
      latMin=b.latMin; latMax=b.latMax; lonMin=b.lonMin; lonMax=b.lonMax;
    }
    return [(latMin+latMax)/2, (lonMin+lonMax)/2];
  }

  global.GeoCodec = {
    sha3_512_hex: sha3_512_hex,
    distanceMeters: distanceMetersKarneyReal,
    distanceMetersVincenty: distanceMetersVincentyRobust,  // Exposed for testing/comparison
    flattenGrid: flattenGrid,
    gridDims: gridDims,
    boundsForCell: boundsForCell,
    tokenizeCode: tokenizeCode,
    codeToIndex: codeToIndexTokens,
    indexToCode: indexTokensToCode,
    applyObfuscation: applyIndexObfuscation,
    obfuscateUpToValid: obfuscateUpToValid,
    encodeHierarchical: encodeHierarchical,
    decodeHierarchical: decodeHierarchical
  };
})(window);
