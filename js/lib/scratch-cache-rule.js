/*
  SCRATCH ONLY — verification, not for the repo.

  Replays the screenshot-2 -> screenshot-3 move against both cache rules.
  fetch is stubbed with a synthetic Gaia cone so nothing leaves the box.
*/
const path = process.argv[2] || '/home/claude/out/geosonify-sky-neighbour.js';

const M_PER_DEG = 111319.9;
const LAT = -43.5121, LON = 172.6210;
const mToDegLat = m => m / M_PER_DEG;
const mToDegLon = (m, lat) => m / (M_PER_DEG * Math.cos(lat * Math.PI / 180));

// A pool of stars laid out at known ground offsets from the query point.
// Three within ~570 m (what the card showed), plus one 40 m from where the pin
// is about to move to — the star you walk onto.
const POOL = [
  { n: 0,   e: 0,    id: '5382127323687153408' },
  { n: -300, e: 250, id: '5382127323687128320' },
  { n: 100, e: 550,  id: '5382127323687129216' },
  { n: 20,  e: 640,  id: '5382127323687144444' },   // the walked-to star
  { n: 900, e: -700, id: '5382127323687155555' }
];

let served = 0;
global.fetch = function (url) {
  served++;
  // Parse the query centre back out so the stub answers about the right point.
  const c = decodeURIComponent(/[?&]-c=([^&]+)/.exec(url)[1]);
  const m = /^([\d.]+)([+-][\d.]+)$/.exec(c);
  const qRa = parseFloat(m[1]), qDec = parseFloat(m[2]);
  const radiusArcmin = parseFloat(/[&]-c\.rm=([\d.]+)/.exec(url)[1]);
  const R = radiusArcmin * 60 / 3600 * M_PER_DEG;
  const max = parseInt(/-out\.max=(\d+)/.exec(url)[1], 10);

  const rows = POOL.map(s => {
    const dec = LAT + mToDegLat(s.n);
    const ra = ((LON + mToDegLon(s.e, LAT)) % 360 + 360) % 360;
    const dn = (dec - qDec) * M_PER_DEG;
    const de = (((ra - qRa + 540) % 360) - 180) * M_PER_DEG * Math.cos(qDec * Math.PI / 180);
    return { ra, dec, id: s.id, d: Math.hypot(dn, de) };
  }).filter(r => r.d <= R).sort((a, b) => a.d - b.d).slice(0, max);

  const text = '#comment\nRA_ICRS\tDE_ICRS\tSource\tPlx\tGmag\t_r\n---\t---\t---\t---\t---\t---\n' +
    rows.map(r => [r.ra.toFixed(8), r.dec.toFixed(8), r.id, '0.5', '18.2',
                   (r.d / M_PER_DEG * 60).toFixed(5)].join('\t')).join('\n');
  return Promise.resolve({ ok: true, text: () => Promise.resolve(text) });
};

const N = require(path);
const short = e => e.star.name.slice(-6) + ' @ ' + Math.round(e.offset.metres) + ' m';

// Pin A = query point. Pin B = ~660 m east, right on top of the 4th star.
const B_LAT = LAT + mToDegLat(20), B_LON = LON + mToDegLon(640, LAT);

N.lookup(LAT, LON, { limit: 3 }).then(a => {
  console.log('pin A  status=' + a.status + '  requests=' + served);
  a.entries.forEach(e => console.log('   ' + short(e)));

  const moved = N.earthOffset(LAT, LON, B_LAT, ((B_LON % 360) + 360) % 360).metres;
  console.log('\nmove ' + Math.round(moved) + ' m east, onto a star 40 m away');
  console.log('cacheValid at pin B ->', N.cacheValid(B_LAT, B_LON, { limit: 3 }));

  return N.lookup(B_LAT, B_LON, { limit: 3 });
}).then(b => {
  console.log('\npin B  status=' + b.status + '  requests=' + served);
  b.entries.forEach(e => console.log('   ' + short(e)));
  const nearest = b.entries[0];
  console.log('\nnearest is ' + nearest.star.name.slice(-6) +
              ' at ' + Math.round(nearest.offset.metres) + ' m — ' +
              (nearest.star.name.endsWith('144444') ? 'the star walked to. correct.'
                                                    : 'WRONG: stale list retained.'));
});
