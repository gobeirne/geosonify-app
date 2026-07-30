/*
  sky-figure.js — render nested HEALPix cell boundaries to a standalone SVG.

    node sky-figure.js <lat> <lon> [deepestOrder] [shallowestOrder] > figure.svg

  Example (Christchurch, orders 9-14):
    node sky-figure.js -43.555444 172.650913 14 9 > figure.svg

  Scratch / demo tool, not part of the app. It exists to prove the geometry API
  works end to end and to make the truncation property visible: every quaternary
  digit you drop is one ring outward, each ring twice as wide and four times the
  area of the one inside it.

  Needs geosonify-sky.js and geosonify-healpix.js alongside.
*/
'use strict';

var Sky = require('./geosonify-sky.js');
var HP = require('./geosonify-healpix.js');
Sky.setEngine(HP);

var lat = parseFloat(process.argv[2]);
var lon = parseFloat(process.argv[3]);
var deep = parseInt(process.argv[4] || '14', 10);
var shallow = parseInt(process.argv[5] || String(Math.max(0, deep - 5)), 10);

if (!isFinite(lat) || !isFinite(lon)) {
  process.stderr.write('usage: node sky-figure.js <lat> <lon> [deepest] [shallowest]\n');
  process.exit(1);
}

var W = 770, H = 620, PAD = 40;
var RAMP = ['#d4d4d8', '#a1a1aa', '#8b8b93', '#71717a', '#52525b', '#3f3f46'];
var HILITE = '#dc2626';

var ipix = HP.nestIndex(lat, lon, deep);
var chain = Sky.ancestry(deep, ipix, { fromOrder: shallow });
var centre = HP.nestCentre(ipix, deep);
var lat0 = centre[0], lon0 = centre[1];
var cosd = Math.cos(lat0 * Math.PI / 180);

// Local tangent plane in arcsec offsets from the deepest cell's centre. Fine at
// these scales; a gnomonic projection would matter only for degree-scale cells.
function project(ring) {
  return ring.map(function (p) {
    return [(p[1] - lon0) * cosd * 3600, (p[0] - lat0) * 3600];
  });
}

var rings = chain.map(function (c) {
  // step 6 samples each curved edge; straight corner-to-corner lines bulge
  // visibly wrong below about order 6.
  return { cell: c, pts: project(Sky.cellBoundary(c.order, c.ipix, { step: 6, close: true })) };
});

function fit(list, w, h, pad) {
  var xs = [], ys = [];
  list.forEach(function (r) { r.pts.forEach(function (p) { xs.push(p[0]); ys.push(p[1]); }); });
  var minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs);
  var miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
  var sc = Math.min((w - 2 * pad) / (maxx - minx || 1), (h - 2 * pad) / (maxy - miny || 1));
  var cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  return {
    sc: sc,
    tx: function (p) {
      return (w / 2 + (p[0] - cx) * sc).toFixed(1) + ' ' + (h / 2 - (p[1] - cy) * sc).toFixed(1);
    }
  };
}

function pathOf(pts, f) { return 'M' + pts.map(f.tx).join(' L') + ' Z'; }

// A round scale bar length that occupies a sensible slice of the frame.
function niceBar(arcsecPerPx, targetPx) {
  var raw = arcsecPerPx * targetPx;
  var pow = Math.pow(10, Math.floor(Math.log10(raw)));
  var candidates = [1, 2, 5, 10].map(function (m) { return m * pow; });
  var best = candidates[0];
  candidates.forEach(function (c) { if (Math.abs(c - raw) < Math.abs(best - raw)) best = c; });
  return best;
}

function barLabel(arcsec) {
  if (arcsec >= 3600) return (arcsec / 3600) + '\u00b0';
  if (arcsec >= 60) return (arcsec / 60) + '\u2032';
  return arcsec + '\u2033';
}

var main = fit(rings, W - 240, H - 90, PAD);
var inner = rings.slice(-3);
var ins = fit(inner, 190, 190, 14);

var out = [];
out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" font-family="ui-sans-serif,system-ui,sans-serif">');
out.push('<rect width="' + W + '" height="' + H + '" fill="#fafaf9"/>');
out.push('<text x="16" y="26" font-size="14" font-weight="600" fill="#18181b">Every quaternary digit you drop is one ring outward</text>');
out.push('<text x="16" y="44" font-size="11" fill="#71717a">' +
  chain[chain.length - 1].quaternary + ' &#183; orders ' + shallow + '&#8211;' + deep +
  ' &#183; boundaries from geosonify-healpix.js</text>');

out.push('<g fill="none" stroke-linejoin="round">');
rings.forEach(function (r, i) {
  var last = i === rings.length - 1;
  var col = last ? HILITE : RAMP[Math.min(RAMP.length - 1, i)];
  out.push('<path d="' + pathOf(r.pts, main) + '" stroke="' + col + '" stroke-width="' + (last ? 1.7 : 1.5) + '"/>');
});
out.push('</g>');

// centre crosshair
var c = main.tx([0, 0]).split(' ').map(Number);
out.push('<g stroke="' + HILITE + '" stroke-width="1">');
out.push('<line x1="' + (c[0] - 8) + '" y1="' + c[1] + '" x2="' + (c[0] + 8) + '" y2="' + c[1] + '"/>');
out.push('<line x1="' + c[0] + '" y1="' + (c[1] - 8) + '" x2="' + c[0] + '" y2="' + (c[1] + 8) + '"/>');
out.push('</g>');

// scale bar
var barA = niceBar(1 / main.sc, 90);
var barPx = barA * main.sc;
out.push('<g stroke="#52525b" stroke-width="1">');
out.push('<line x1="40" y1="' + (H - 32) + '" x2="' + (40 + barPx) + '" y2="' + (H - 32) + '"/>');
out.push('<line x1="40" y1="' + (H - 36) + '" x2="40" y2="' + (H - 28) + '"/>');
out.push('<line x1="' + (40 + barPx) + '" y1="' + (H - 36) + '" x2="' + (40 + barPx) + '" y2="' + (H - 28) + '"/>');
out.push('</g>');
out.push('<text x="' + (48 + barPx) + '" y="' + (H - 28) + '" font-size="10" fill="#52525b">' + barLabel(barA) + '</text>');

// legend
out.push('<g transform="translate(' + (W - 224) + ',66)">');
out.push('<text x="0" y="0" font-size="10.5" fill="#71717a">order &#183; cell side &#183; digit added</text>');
out.push('<g font-size="10.5" font-family="ui-monospace,monospace">');
rings.forEach(function (r, i) {
  var last = i === rings.length - 1;
  var col = last ? HILITE : RAMP[Math.min(RAMP.length - 1, i)];
  var y = 20 + i * 22;
  var d = r.cell.digits[r.cell.digits.length - 1];
  out.push('<rect x="0" y="' + (y - 6) + '" width="14" height="3" fill="' + col + '"/>');
  out.push('<text x="22" y="' + y + '" fill="' + (last ? HILITE : '#3f3f46') + '">' + r.cell.order + '</text>');
  out.push('<text x="48" y="' + y + '" fill="' + (last ? HILITE : '#71717a') + '">' +
    r.cell.sizeText.replace(' arcmin', '\u2032').replace(' arcsec', '\u2033') + '</text>');
  out.push('<text x="126" y="' + y + '" fill="' + (last ? HILITE : '#a1a1aa') + '">' + (d === undefined ? '' : d) + '</text>');
});
out.push('</g></g>');

// inset
if (inner.length === 3) {
  var iy = 300;
  out.push('<g transform="translate(' + (W - 224) + ',' + iy + ')">');
  out.push('<text x="0" y="-8" font-size="10" fill="#71717a">inset: deepest three, magnified</text>');
  out.push('<rect x="0" y="0" width="190" height="190" fill="#ffffff" stroke="#d4d4d8" rx="6"/>');
  out.push('<g fill="none" stroke-linejoin="round">');
  inner.forEach(function (r, i) {
    var last = i === inner.length - 1;
    out.push('<path d="' + pathOf(r.pts, ins) + '" stroke="' + (last ? HILITE : (i ? '#3f3f46' : '#71717a')) + '" stroke-width="1.5"/>');
  });
  out.push('</g>');
  var ic = ins.tx([0, 0]).split(' ').map(Number);
  out.push('<g stroke="' + HILITE + '" stroke-width="1">');
  out.push('<line x1="' + (ic[0] - 6) + '" y1="' + ic[1] + '" x2="' + (ic[0] + 6) + '" y2="' + ic[1] + '"/>');
  out.push('<line x1="' + ic[0] + '" y1="' + (ic[1] - 6) + '" x2="' + ic[0] + '" y2="' + (ic[1] + 6) + '"/>');
  out.push('</g></g>');
}

out.push('<text x="16" y="' + (H - 10) + '" font-size="9.5" fill="#a1a1aa">' +
  'Cell side halves and area quarters at every step. Orders ' + shallow + '&#8211;' + deep +
  ' span a factor of ' + Math.pow(2, deep - shallow) + ' in width, ' +
  Math.pow(4, deep - shallow) + ' in area.</text>');
out.push('</svg>');

process.stdout.write(out.join('\n') + '\n');
