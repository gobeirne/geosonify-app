// node geosonify-sky-neighbour-mirrors_selftest.js -- VizieR mirror fallback
'use strict';
var path='./';
global.localStorage={_:{},getItem(k){return this._[k]||null},setItem(k,v){this._[k]=v}};
var calls=[];
var TSV='#INFO\nRA_ICRS\tDE_ICRS\tSource\tPlx\tGmag\t_r\n--\t--\t--\t--\t--\t--\n172.637\t-43.534\t5000000000000000001\t8.2\t9.2\t0.1\n';
var plan={};
global.fetch=function(url,o){var host=url.split('/viz-bin')[0];calls.push(host);var b=plan[host];
  if(b==='hang') return new Promise(function(res,rej){o&&o.signal&&o.signal.addEventListener('abort',function(){rej(new Error('abort'))});});
  if(b==='err') return Promise.reject(new TypeError('Failed to fetch (CORS)'));
  return Promise.resolve({ok:true,text:function(){return Promise.resolve(b)}});};
var SN=require(path +'geosonify-sky-neighbour.js');
var P='https://vizier.cds.unistra.fr',C='https://vizier.cfa.harvard.edu',I='https://vizier.idia.ac.za';
function run(name,setup,check){return function(){plan=setup;calls=[];return SN.lookupRemote(-43.53,172.63,{radiusArcmin:1}).then(function(r){var ok=check(r);console.log((ok?'  PASS ':'  FAIL ')+name+'  calls='+calls.map(h=>h.split('//')[1].split('.')[1]).join(','));if(!ok)process.exitCode=1;});};}
var seq=[
 run('primary answers',{[P]:TSV},r=>r&&r.length===1&&calls.length===1),
 run('primary down (CORS/err): Harvard answers',{[P]:'err',[C]:TSV},r=>r&&r.length===1&&calls.length===2),
 run('...and Harvard is tried first next time',{[P]:'err',[C]:TSV},r=>r&&r.length===1&&calls[0]===C&&calls.length===1),
 run('Harvard without the catalogue: falls to IDIA',{[P]:'err',[C]:'#INFO no table\n',[I]:TSV},r=>r&&r.length===1&&calls.join()===[C,P,I].join()),
 run('everything down: null (could not look)',{[P]:'err',[C]:'err',[I]:'err'},r=>r===null),
 run('primary hangs: times out and moves on',{[P]:'hang',[C]:'err',[I]:TSV},r=>r&&r.length===1),
];
localStorage._={};
seq.reduce((p,f)=>p.then(f),Promise.resolve()).then(()=>{
  // primary empty table believed
  localStorage._={}; 
  return run('primary empty cone is believed ([])',{[P]:'#INFO nothing\n'},r=>Array.isArray(r)&&r.length===0)();
});
setTimeout(function(){ localStorage._={}; 
  var SN2; delete require.cache[require.resolve(path+'geosonify-sky-neighbour.js')]; SN2=require(path +'geosonify-sky-neighbour.js');
  plan={[P]:'hang',[C]:TSV}; calls=[]; var t=Date.now();
  SN2.lookupRemote(-43.53,172.63,{radiusArcmin:1}).then(function(r){console.log((r&&r.length===1&&calls.join()===[P,C].join()?'  PASS':'  FAIL')+' Strasbourg hangs: gives up after '+((Date.now()-t)/1000).toFixed(1)+' s, Harvard answers');});
},500);
