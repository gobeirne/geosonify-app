#!/usr/bin/env node
/*
  core-profile-v1-reference.js — reference decoder for spec/CORE-PROFILE-V1.md
  (Base64 and HEALPix points, paths, groups, shape suffixes and annotations). Independent of the app:
  no app code is loaded. Run:  node spec/core-profile-v1-reference.js --selftest
  The vectors below were produced by the live app (15 Nov 2026).
*/
'use strict';
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function decodeCode(code) {                       // §2
  let la0 = -90, la1 = 90, lo0 = -180, lo1 = 180;
  for (const ch of code) {
    const i = A.indexOf(ch); if (i < 0) throw new Error('not Base64: ' + ch);
    const dl = (la1 - la0) / 8, dn = (lo1 - lo0) / 8;
    la1 = la1 - dl * (i >> 3); la0 = la1 - dl; lo0 = lo0 + dn * (i & 7); lo1 = lo0 + dn;
  }
  return [(la0 + la1) / 2, (lo0 + lo1) / 2];
}

function decodePath(value, rFlag, decodeOne) {    // §3; decodeOne defaults to the Base64 grid
  const parts = value.split('~'), first = parts[0], L = first.length;
  const codes = [first], R = [];
  let global = !!rFlag, p = parts[1];
  if (p && /^R[0-9a-f]/i.test(p)) { global = true; parts[1] = p = p.slice(1); }
  const legacy = (() => { const m = p.match(/^([0-9A-Fa-f])(.+)$/); if (!m) return 0;
    const n = parseInt(m[1], 16); return (n > 0 && n < L && !p.includes('=') && m[2].length >= n && m[2].length % n === 0) ? n : 0; })();
  if (/^[0-9A-Fa-f]=/.test(p)) {                                         // fixed width
    const w = parseInt(p[0], 16); let rest = parts.slice(1).join('').slice(2);
    while (rest.length) { let d;
      if (rest[0] === '*') { const k = +rest[1]; if (!(k > 0)) break; d = rest.substr(2, k); rest = rest.slice(2 + k); }
      else { if (!(w > 0)) break; d = rest.slice(0, w); rest = rest.slice(w); }
      codes.push(first.slice(0, L - d.length) + d); R.push(false); }
  } else if ((/^d[0-9A-Fa-f]/.test(p) && !p.includes('=')) || legacy) {   // gear (and legacy gear)
    let cur = first;
    for (const s of parts.slice(1)) {
      let N, pay;
      if (s[0] === 'd') { let K = 0; while (s[K] === 'd') K++; N = parseInt(s.slice(K, 2 * K), 16); pay = s.slice(2 * K);
        if (!(N > 0)) continue; }
      else { const m = s.match(/^([0-9A-Fa-f])(.+)$/); const n = m ? parseInt(m[1], 16) : 0;
        if (m && n > 0 && n < L && m[2].length % n === 0) { N = n; pay = m[2]; }
        else { cur = cur.slice(0, L - s.length) + s; codes.push(cur); R.push(false); continue; } }  // relative to PREVIOUS
      for (let j = 0; j < pay.length; j += N) { cur = cur.slice(0, L - N) + pay.slice(j, j + N); codes.push(cur); R.push(false); }
    }
  } else {                                                               // variable
    for (const s0 of parts.slice(1)) { let s = s0, r = false;
      if (s[0] === 'R' && s.length > 1) { r = true; s = s.slice(1); }
      codes.push(first.slice(0, L - s.length) + s); R.push(r); }
  }
  const pts = codes.map(decodeOne || decodeCode);
  const modes = pts.map(() => global ? 'R' : 'G');
  R.forEach((r, i) => { if (r) modes[i] = 'R'; });                       // R on delta for vertex i+1 = segment i → i+1
  return { pts, modes };
}

const UNIT = { mm: 0.001, cm: 0.01, m: 1, km: 1000, ft: 0.3048, mi: 1609.344 };
const RES = { '2': 0.001, '1': 0.01, '0': 0.1, '7': 1, '4': 10, '5': 100, '6': 1000 };
function len(s) { const m = String(s).match(/^([\d.]+)\s*(mm|cm|km|ft|mi|m)?$/); return m ? parseFloat(m[1]) * UNIT[m[2] || 'm'] : NaN; }
function lenVar(s, i) {                           // §4.2 length field
  let unit = 1; if (s[i] === '!') { unit = RES[s[i + 1]] || 1; i += 2; }
  let p = 0; while (s[i] === '.' || s[i] === '~') { p++; i++; }
  const n = s.slice(i, i + 2 + p); if (n.length < 2 + p) throw new Error('truncated');
  return { value: parseInt(n, 36) * unit, next: i + 2 + p };
}
function checksumChar(t) { let s = 0; for (const c of t) s = (s + c.charCodeAt(0)) % 36; return '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[s]; }

function decodeShape(payload, graticule) {        // §4
  let m;
  if (!graticule) {                               // §4.1 circles first, exact lengths
    if (/^[A-Za-z0-9_-][A-P]$/.test(payload)) return { type: 'circle', radius: (A.indexOf(payload[0]) << 4) | A.indexOf(payload[1]) };
    if (/^[0-9A-Z]{2}$/.test(payload) && /[A-Z]/.test(payload)) return { type: 'circle', radius: parseInt(payload, 36) };
    if ((m = payload.match(/^([.~]+)([0-9A-Z]+)$/)) && m[2].length === 2 + m[1].length) return { type: 'circle', radius: parseInt(m[2], 36) };
  } else if ((m = payload.match(/^(~*)([0-9A-Z]+)$/)) && m[2].length === 3 + m[1].length) {
    return { type: 'circle', radius: parseInt(m[2], 36) };
  }
  if (payload.length > 3 && checksumChar(payload.slice(0, -1)) === payload.slice(-1)) payload = payload.slice(0, -1);
  const f = payload.split('_');
  if (graticule) {
    const ang = x => { let mm = x.match(/^([\d.]+)deg$/i); if (mm) return +mm[1]; mm = x.match(/^([\d.]+)(?:'|’|min)$/i); return mm ? mm[1] / 60 : null; };
    if (f.length === 2 && ang(f[0]) > 0 && ang(f[1]) > 0) return { type: 'graticule', lonSpanDeg: ang(f[0]), latSpanDeg: ang(f[1]) };
    if (f.length === 2 && /deg|^[\d.]+_/.test(payload)) return { type: 'graticule', lonSpanDeg: parseFloat(f[0]), nsMeters: len(f[1]) };
    if (/^[A-Za-z0-9_-]{7}$/.test(payload)) { let v = 0n; for (const c of payload) v = (v << 6n) | BigInt(A.indexOf(c)); v >>= 1n;
      return { type: 'graticule', lonSpanDeg: Number((v >> 25n) & 0xFFFFn) / 100, nsMeters: Number(v & 0x1FFFFFFn) }; }
    const a = lenVar(payload, 0), b = lenVar(payload, a.next);
    return { type: 'graticule', lonSpanDeg: a.value / 1000, nsMeters: b.value };
  }
  if (f.length === 3) return { type: 'rect', thetaDeg: parseFloat(f[0]), L: len(f[1]), S: len(f[2]) };
  if (/^\d+m?$/.test(payload)) return { type: 'circle', radius: parseFloat(payload) };
  if (/^[A-Za-z0-9_-]{5}$/.test(payload)) { const v = [...payload].reduce((x, c) => (x << 6) | A.indexOf(c), 0) >> 1;
    return { type: 'rect', thetaDeg: (v >> 20) & 0x1FF, L: (v >> 10) & 0x3FF, S: v & 0x3FF }; }
  const a = lenVar(payload, 2), b = lenVar(payload, a.next);
  return { type: 'rect', thetaDeg: parseInt(payload.slice(0, 2), 36), L: a.value, S: b.value };
}

// §7 HEALPix: (face, quaternary digits) -> NESTED pixel centre (Górski et al. 2005).
const JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4], JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7];
function healpixCentre(f, digits) {
  const ns = 2 ** digits.length; let x = 0, y = 0;
  for (const d of digits) { x = x * 2 + (d & 1); y = y * 2 + (d >> 1); }   // x in the even bits, y in the odd
  const jr = JRLL[f] * ns - x - y - 1; let nr, z, ks;
  if (jr < ns) { nr = jr; z = 1 - nr * nr / (3 * ns * ns); ks = 0; }
  else if (jr > 3 * ns) { nr = 4 * ns - jr; z = nr * nr / (3 * ns * ns) - 1; ks = 0; }
  else { nr = ns; z = (2 * ns - jr) * 2 / (3 * ns); ks = (jr - ns) & 1; }
  let jp = (JPLL[f] * nr + x - y + 1 + ks) / 2;
  if (jp > 4 * ns) jp -= 4 * ns; if (jp < 1) jp += 4 * ns;
  let lon = (jp - (ks + 1) * 0.5) * (90 / nr); if (lon >= 180) lon -= 360;
  return [90 - Math.acos(z) * 180 / Math.PI, lon];
}
function decodeHealpix(code, scheme, order) {
  let s = code.trim(), k = order;
  const at = s.lastIndexOf('@');
  if (at > 0 && /^@\d{1,2}$/.test(s.slice(at))) { k = +s.slice(at + 1); s = s.slice(0, at); }
  const f = '0123456789AB'.indexOf(s[0].toUpperCase()); if (f < 0) throw new Error('bad face');
  const d = [];
  for (const ch of s.slice(1)) {
    if (scheme === 'hphex') { const n = parseInt(ch, 16); d.push(n >> 2, n & 3); }
    else { const n = A.indexOf(ch); d.push(n >> 4, (n >> 2) & 3, n & 3); }
  }
  if (k == null) k = d.length;                    // no @k: the length's maximum order
  return healpixCentre(f, d.slice(0, k));
}

// §8 annotations: lbl=<i>:<text>, sty=p|s<i>[-j]:<colour>[,w<n>][,dash]
const PALETTE = { r: 'ef4444', o: 'f97316', y: 'facc15', g: '22c55e', c: '06b6d4', b: '3b82f6', v: '8b5cf6', m: 'd946ef', p: 'f9a8d4', n: '9ca3af', k: '111827', w: 'f9fafb' };
const STRIP = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
function parseAnnotations(query) {
  const labels = {}, styles = [];
  for (const kv of query.replace(/^\?/, '').split('&')) {
    const eq = kv.indexOf('='); if (eq < 0) continue;
    const key = kv.slice(0, eq); let val; try { val = decodeURIComponent(kv.slice(eq + 1)); } catch (e) { continue; }
    const c = val.indexOf(':'); if (c < 0) continue;
    const head = val.slice(0, c), body = val.slice(c + 1);
    if (key === 'lbl' && /^\d{1,7}$/.test(head) && Object.keys(labels).length < 500) {
      let t = body.replace(STRIP, '').replace(/\s+/g, ' ').trim(); t = Array.from(t).slice(0, 60).join('').trim();
      if (t) labels[+head] = t;
    } else if (key === 'sty' && styles.length < 500) {
      const m = /^([ps])(\d{1,7})(?:-(\d{1,7}))?$/.exec(head); if (!m) continue;
      const a = +m[2], b = m[3] !== undefined ? +m[3] : a; if (b < a || b - a >= 5000) continue;
      const bits = body.split(','); const col = PALETTE[bits[0].toLowerCase()] || (/^[0-9a-fA-F]{6}$/.test(bits[0]) ? bits[0].toLowerCase() : null);
      if (!col) continue; let w = null, dash = false, ok = true;
      for (const x of bits.slice(1)) { const wm = /^w(\d{1,2}(?:\.\d)?)$/.exec(x);
        if (x === 'dash' && !dash) dash = true; else if (wm && w === null && +wm[1] >= 0.5 && +wm[1] <= 12) w = +wm[1]; else { ok = false; break; } }
      if (ok) styles.push({ on: m[1] === 'p' ? 'points' : 'sides', from: a, to: b, colour: col, width: w, dash });
    }
  }
  return { labels, styles };
}

function decodeLink(query) {                      // §1
  const q = query.replace(/^\?/, ''), eq = q.indexOf('=');
  const name = q.slice(0, eq), value = decodeURIComponent(q.slice(eq + 1).split('&')[0]);
  const hp = name.match(/^(hphex|hp64)([odrcj]*)$/);
  if (hp) {
    if (/[oj]/.test(hp[2])) throw new Error('obfuscated: outside the core profile');
    const first = value.split('~')[0];
    const one = c => decodeHealpix(c, hp[1]);
    if (hp[2].includes('d')) return { groups: value.split('~~~').map(g => decodePath(g, hp[2].includes('r'), one)) };
    return { point: one(value) };
  }
  const m = name.match(/^b64([odrc]*)$/); if (!m) throw new Error('not a core parameter');
  if (m[1].includes('o')) throw new Error('obfuscated: outside the core profile');
  if (m[1].includes('d')) return { groups: value.split('~~~').map(g => decodePath(g, m[1].includes('r'))) };
  const t = value.indexOf('~');
  if (t < 0) return { point: decodeCode(value) };
  const rest = value.slice(t + 1), grat = rest.startsWith('~');
  return { centre: decodeCode(value.slice(0, t)), shape: decodeShape(grat ? rest.slice(1) : rest, grat) };
}

const VECTORS = [
  ['b64=v-dzcFN-', { point: [-43.522505164, 172.581106424] }],
  ['b64d=v-dzcFN-~4=dA8rdpn8lcKRl3Ot', { n: 5, last: [-43.532096744, 172.594989538] }],
  ['b64d=v-dr27bv~egtwv~RLWjLn~V-AVgf', { n: 4, modes: 'GRGG' }],
  ['b64dr=MqSvSsWo~d6Th4BPvTxc2LJSvSsWo', { n: 4, modes: 'RRRR' }],
  ['b64d=MqSvSsWo~3h4B~1Pv', { n: 4 }],                            // legacy gear, built by hand; app's DeltaGear agrees
  ['b64d=v-dzcFN-~4=dA8r~~~MqSvSsWo~d6Th4BPv', { groups: 2 }],
  ['b64=v-d0hZKV~.01I', { shape: { type: 'circle', radius: 54 } }],
  ['b64=v-d0hZKV~.0DW', { shape: { type: 'circle', radius: 500 } }],
  ['b64=v-d0hZKV~.3UW', { shape: { type: 'circle', radius: 5000 } }],
  ['b64=v-d0hZKV~DG', { shape: { type: 'circle', radius: 54 } }],
  ['b64=v-d0hZKV~4E', { shape: { type: 'circle', radius: 900 } }],
  ['b64=v-d0hZKV~DW', { shape: { type: 'circle', radius: 500 } }],   // older Base36 form
  ['b64=v-d0hZKV~~3UW', { shape: { type: 'circle', radius: 5000 } }],// older '~'-padded form
  ['b64=v-d0hZKV~1I', { shape: { type: 'circle', radius: 856 } }],   // D7 tie: Base64url reading
  ['b64=v-d0hZKV~0UDW5K', { shape: { type: 'rect', thetaDeg: 30, L: 500, S: 200 } }],
  ['b64=v-d0hZKV~0U!45K5K', { shape: { type: 'rect', thetaDeg: 30, L: 2000, S: 200 } }],
  ['b64=v-d0hZKV~Dz6GQ', { shape: { type: 'rect', thetaDeg: 30, L: 500, S: 200 } }],
  ['b64=v-d0hZKV~~AJYAw1A', { shape: { type: 'graticule', lonSpanDeg: 1.5, nsMeters: 100000 } }],
  ['b64=v-d0hZKV~~1.5deg_100km', { shape: { type: 'graticule', lonSpanDeg: 1.5, nsMeters: 100000 } }],
  ['b64=v-d0hZKV~~7deg_4deg', { shape: { type: 'graticule', lonSpanDeg: 7, latSpanDeg: 4 } }],
  ['hphex=9562528335F@20', { point: [-43.522490267319796, 172.58105911920643] }],
  ['hp64=3X1ddfS@18', { point: [51.4778150918667, -0.0014871257400272953] }],
  ['hphexd=956250A557F7~d69AAFB9~d4D71667F565925D30~d5B009F9CAEB~d38DBC22656~d5C0B23C09FAC09CD67B1E72895~d3B47BD3EDD~d43806391F5AC459D6~d695FFDFC0AC07C0B131C12A80C07DE3C10D196B6FB0~d46BD73FEC2F3722BA~d58FD578F2F68A284~d63DF5FA6888AE~d5833AF8454E2CDF326950261CF24DD43012F19BC816958028CB~d64A885F4884B41D554417F0FC~d4C0B7C123',
    { n: 55, first: [-43.555686896047234, 172.65106555881766], last: [-43.5775082453695, 172.70808127581552] }],
  ['b64d=v-dzcFN-~4=dA8r&lbl=0:Start&lbl=1:%E2%80%AEEnd&sty=s0:y,w3,dash&sty=p0-1:ff0000&sty=s0:q', { ann: { labels: { 0: 'Start', 1: 'End' }, styles: 2 } }],
];
if (process.argv.includes('--selftest')) {
  let bad = 0;
  for (const [q, want] of VECTORS) {
    const got = decodeLink(q); let ok = true;
    if (want.point) ok = Math.abs(got.point[0] - want.point[0]) < 1e-8 && Math.abs(got.point[1] - want.point[1]) < 1e-8;
    if (want.n) { const g = got.groups[0]; ok = g.pts.length === want.n;
      if (want.first) ok = ok && Math.abs(g.pts[0][0] - want.first[0]) < 1e-9 && Math.abs(g.pts[0][1] - want.first[1]) < 1e-9;
      if (want.last) ok = ok && Math.abs(g.pts[want.n - 1][0] - want.last[0]) < 1e-8 && Math.abs(g.pts[want.n - 1][1] - want.last[1]) < 1e-8;
      if (want.modes) ok = ok && g.modes.join('') === want.modes; }
    if (want.groups) ok = got.groups.length === want.groups;
    if (want.shape) ok = Object.keys(want.shape).every(k => got.shape[k] === want.shape[k]);
    if (want.ann) { const a = parseAnnotations(q); ok = JSON.stringify(a.labels) === JSON.stringify(want.ann.labels) && a.styles.length === want.ann.styles; }
    if (!ok) { bad++; console.log('FAIL', q, JSON.stringify(got)); }
  }
  console.log(bad ? `self-test: FAIL (${bad})` : `self-test: PASS (${VECTORS.length} vectors)`);
  process.exit(bad ? 1 : 0);
}
module.exports = { decodeCode, decodePath, decodeShape, decodeLink, decodeHealpix, healpixCentre, parseAnnotations, VECTORS };
