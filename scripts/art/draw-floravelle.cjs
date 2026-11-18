#!/usr/bin/env node
'use strict';
/* キラシード (id floravelle, formerly フロラヴェール) — the operator's mythical: a slender
 * four-legged creature that sprouted from a glittering seed and still wears its husk.
 * The top of the split seed sits on its head as a helm with a cracked rim; from the
 * crack a glowing tendril climbs to a star-shaped bud. Its ears are two seed leaves,
 * a scarf of seed fluff circles its neck, plates of the lacquered husk guard its chest,
 * shoulders, hips and shins, small star dapples speckle its back, its hooves are husk,
 * and its tail ends in a round puff of glittering seed fluff.
 *
 * Both views are painted as shapes on a 1200-pixel canvas (soft key light from the
 * upper left, warm bounce light from below, a thin rim light on the far edges,
 * ambient occlusion where forms meet), then reduced to a 300-pixel grid: each cell
 * takes the nearest colour (CIELAB) from hue-shifted ramps of 5–8 tones per material,
 * a one-pixel outline closes the figure, and the result is enlarged 4x.
 *
 *   CANVAS_MODULE=<path>/node_modules/@napi-rs/canvas node scripts/art/draw-floravelle.cjs [out.png] [--preview dir]
 *
 * Writes assets/floravelle.png (front | back, 2400x1200). © 2026 KASAI SOLUTIONS INC. */
const fs = require('node:fs'), path = require('node:path');
let canvasModule = null;
for (const name of [process.env.CANVAS_MODULE, '@napi-rs/canvas'].filter(Boolean)) { try { canvasModule = require(name); break; } catch (_) {} }
if (!canvasModule) { console.error('Install @napi-rs/canvas or set CANVAS_MODULE.'); process.exit(1); }
const { createCanvas } = canvasModule;
const ROOT = path.join(__dirname, '..', '..');
const S = 1200, GRID = 300, K = S / GRID, TAU = Math.PI * 2;

// ── Ramps, light to dark. Shadows lean cool and violet, lights lean warm.
const R = {
  fur: ['#fffdf7', '#fdf5e4', '#f6e8cf', '#ecd8b9', '#dbc0a0', '#bfa08b', '#927a7c', '#665364'],
  husk: ['#fff5de', '#ffe1a8', '#f8c47a', '#eaa456', '#d08243', '#a76137', '#77432b'],
  leaf: ['#f4ffc9', '#d5f597', '#aee172', '#81c962', '#5bab59', '#418c52', '#2f6c48', '#1f4d3a'],
  glow: ['#ffffff', '#f1fff0', '#d2fbd6', '#a4eeb9', '#74d69b'],
  gold: ['#fffbe2', '#ffefb2', '#fbd874', '#efbb4c', '#d4973b', '#aa7230', '#7b5126'],
  fluff: ['#ffffff', '#fbfaf7', '#efedf2', '#dcd8e4', '#bdb7cc', '#948dab'],
  jade: ['#f2fffb', '#cbf7e8', '#9be7cd', '#69cfae', '#45ad93', '#30887b', '#22655e'],
  eye: ['#ffffff', '#a6dccb', '#559f8e', '#316265', '#1f3142', '#140f22'],
  blush: ['#ffe2e8', '#ffbdcc', '#f495af', '#d06c8a', '#9c4a68'],
  ink: ['#2c1f31']
};
const INK = R.ink[0];
const PALETTE = [...new Set(Object.values(R).flat())];

// ── Colour maths for the reduction (sRGB → CIELAB).
const hexRGB = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
function lab([r, g, b]) {
  const lin = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const x = (lr * .4124 + lg * .3576 + lb * .1805) / .95047, y = lr * .2126 + lg * .7152 + lb * .0722, z = (lr * .0193 + lg * .1192 + lb * .9505) / 1.08883;
  const f = t => t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
const PAL_RGB = PALETTE.map(hexRGB), PAL_LAB = PAL_RGB.map(lab);

// ── Drawing helpers.
const ell = (c, x, y, rx, ry, rot = 0) => c.ellipse(x, y, Math.max(.1, rx), Math.max(.1, ry), rot, 0, TAU);
const poly = pts => c => { pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); };
const polyline = pts => c => pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
const smoothPath = (pts, closed = true) => c => {
  // Quadratic smoothing through midpoints.
  const n = pts.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = closed ? mid(pts[n - 1], pts[0]) : pts[0]; c.moveTo(start[0], start[1]);
  for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) { const m = mid(pts[i], pts[(i + 1) % n]); c.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]); }
  if (closed) c.closePath(); else c.lineTo(pts[n - 1][0], pts[n - 1][1]);
};
function fill(c, pathFn, style) { c.beginPath(); pathFn(c); c.fillStyle = style; c.fill(); }
function line(c, pathFn, color, width, cap = 'round') { c.beginPath(); pathFn(c); c.strokeStyle = color; c.lineWidth = width; c.lineCap = cap; c.lineJoin = 'round'; c.stroke(); }
function clip(c, pathFn, fn) { c.save(); c.beginPath(); pathFn(c); c.clip(); fn(); c.restore(); }
function radial(c, x, y, r, stops, x0 = x, y0 = y, r0 = 0) { const g = c.createRadialGradient(x0, y0, r0, x, y, r); for (const [t, col] of stops) g.addColorStop(t, col); return g; }
function linear(c, x0, y0, x1, y1, stops) { const g = c.createLinearGradient(x0, y0, x1, y1); for (const [t, col] of stops) g.addColorStop(t, col); return g; }
const alpha = (hex, a) => { const [r, g, b] = hexRGB(hex); return `rgba(${r},${g},${b},${a})`; };
const circle = (x, y, r) => c => ell(c, x, y, r, r);
const ellipse = (x, y, rx, ry, rot = 0) => c => ell(c, x, y, rx, ry, rot);
const rnd = n => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
// Catmull-Rom samples through points.
function spline(points, steps = 14) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(k => .5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  out.push(points.at(-1)); return out;
}
// A tapering tube along a spline (neck, legs, tail, tendril).
// w0 may be a list of widths, one per point (w1 is then ignored).
function tube(points, w0, w1, steps = 16, ease = t => t) {
  const mid = spline(points, steps), left = [], right = [], at = Array.isArray(w0)
    ? i => { const seg = Math.min(points.length - 2, Math.floor(i / steps)), t = (i - seg * steps) / steps, e = t * t * (3 - 2 * t); return w0[seg] + (w0[seg + 1] - w0[seg]) * e; }
    : i => w0 + (w1 - w0) * ease(i / (mid.length - 1));
  mid.forEach((p, i) => {
    const a = mid[Math.max(0, i - 1)], b = mid[Math.min(mid.length - 1, i + 1)], ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2;
    const w = at(i) / 2;
    left.push([p[0] + Math.cos(ang) * w, p[1] + Math.sin(ang) * w]); right.push([p[0] - Math.cos(ang) * w, p[1] - Math.sin(ang) * w]);
  });
  return { mid, left, right, path: poly([...left, ...[...right].reverse()]) };
}
// A soft elliptical shadow (occlusion) or light pool: full at the centre, fading to nothing at the rim.
function soft(c, x, y, rx, ry, color, a = .7, rot = 0) {
  c.save(); c.translate(x, y); c.rotate(rot); c.scale(1, ry / rx);
  c.fillStyle = radial(c, 0, 0, rx, [[0, alpha(color, a)], [.55, alpha(color, a * .6)], [1, alpha(color, 0)]]); c.beginPath(); c.arc(0, 0, rx, 0, TAU); c.fill(); c.restore();
}
// Outline the two sides of a tube from index `skip` on, and round off its end.
function tubeSides(c, tb, color, width, skip = 4) {
  for (const edge of [tb.left, tb.right]) line(c, polyline(edge.slice(skip)), color, width);
  const a = tb.left.at(-1), b = tb.right.at(-1), m = tb.mid.at(-1), d = [m[0] - tb.mid.at(-2)[0], m[1] - tb.mid.at(-2)[1]], k = Math.hypot(d[0], d[1]) || 1;
  line(c, cc => { cc.moveTo(a[0], a[1]); cc.quadraticCurveTo(m[0] + d[0] / k * 14, m[1] + d[1] / k * 14, b[0], b[1]); }, color, width);
}
// Soft volume shading inside a closed form.
function shade(c, pathFn, box, ramp, { base = 3, light = 1, dark = 5, lx = -.38, ly = -.46, rim = null, ao = null, glow = .55 } = {}) {
  const { x, y, rx, ry } = box, r = Math.max(rx, ry);
  fill(c, pathFn, ramp[base]);
  clip(c, pathFn, () => {
    c.fillStyle = radial(c, x + rx * .55, y + ry * .62, r * 1.25, [[0, alpha(ramp[dark], .95)], [.45, alpha(ramp[dark - 1], .55)], [1, alpha(ramp[dark - 1], 0)]]); c.fillRect(x - rx * 2, y - ry * 2, rx * 4, ry * 4);
    c.fillStyle = radial(c, x + rx * lx, y + ry * ly, r * 1.05, [[0, alpha(ramp[Math.max(0, light - 1)], glow + .4)], [.35, alpha(ramp[light], glow)], [.7, alpha(ramp[base - 1], glow * .45)], [1, alpha(ramp[base], 0)]]); c.fillRect(x - rx * 2, y - ry * 2, rx * 4, ry * 4);
    if (ao) ao();
    if (rim) { c.lineWidth = rim.width || 14; c.strokeStyle = linear(c, x + rx * (rim.from ?? .2), y, x + rx * (rim.to ?? 1), y + ry * .3, [[0, alpha(rim.color, 0)], [1, alpha(rim.color, rim.alpha ?? .9)]]); c.beginPath(); pathFn(c); c.stroke(); }
  });
}
// Stroke an outline everywhere except inside the given holes (where a limb grows out of the body).
function outlineExcept(c, pathFn, holes, color, width) {
  c.save(); c.beginPath(); c.rect(-10, -10, S + 20, S + 20); for (const h of holes) { c.moveTo(h[0] + h[2], h[1]); ell(c, h[0], h[1], h[2], h[3]); } c.clip('evenodd');
  line(c, pathFn, color, width); c.restore();
}
// Draw onto a scratch canvas, then fade it in along a line (alpha 0 at `from`, full at `to`) so a limb grows out of the body.
function blendIn(c, draw, from, to) {
  const off = createCanvas(S, S), oc = off.getContext('2d'); draw(oc);
  oc.globalCompositeOperation = 'destination-in'; oc.fillStyle = linear(oc, from[0], from[1], to[0], to[1], [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,1)']]); oc.fillRect(0, 0, S, S);
  c.drawImage(off, 0, 0);
}
// A seed-shaped outline: round at one end, tapering toward the other (the taper points along rot + π).
function seedShape(x, y, rx, ry, rot = 0, taper = .3) {
  const pts = [];
  for (let i = 0; i < 40; i++) { const t = i / 40 * TAU, px = rx * Math.cos(t), py = ry * Math.sin(t) * (1 - taper * (1 - Math.cos(t)) / 2); pts.push([x + px * Math.cos(rot) - py * Math.sin(rot), y + px * Math.sin(rot) + py * Math.cos(rot)]); }
  return smoothPath(pts);
}

// ── Materials.
function sparkle(c, x, y, r, color = R.gold[0], core = '#ffffff') {
  const star = (s, col) => fill(c, cc => { cc.moveTo(x, y - s); cc.quadraticCurveTo(x + s * .14, y - s * .14, x + s, y); cc.quadraticCurveTo(x + s * .14, y + s * .14, x, y + s); cc.quadraticCurveTo(x - s * .14, y + s * .14, x - s, y); cc.quadraticCurveTo(x - s * .14, y - s * .14, x, y - s); }, col);
  star(r, color); star(r * .45, core);
}
// A floating sparkle with a dark rim so it reads against any background.
function twinkle(c, x, y, r) { sparkle(c, x, y, r * 1.25, alpha(R.gold[4], .9), R.gold[2]); sparkle(c, x, y, r); }
// The lacquered seed husk: a glossy amber plate with converging ridges like a seed coat,
// a crisp specular streak, warm bounce light, flecks of glitter and a gold rim.
function huskPlate(c, pathFn, box, { ridges = 4, rot = 0, far = false, rim = true, glints = 2, seed = 1, gem = null } = {}) {
  const { x, y, rx, ry } = box, H = R.husk, lift = far ? 1 : 0, r = Math.max(rx, ry);
  fill(c, pathFn, H[2 + lift]);
  clip(c, pathFn, () => {
    c.fillStyle = radial(c, x - rx * .3, y - ry * .42, r * 1.55, [[0, H[1 + lift]], [.35, H[2 + lift]], [.7, H[3 + lift]], [1, H[5]]]); c.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
    const ux = Math.cos(rot), uy = Math.sin(rot), vx = -uy, vy = ux;
    for (let k = -ridges; k <= ridges; k++) {
      if (!k) continue;
      const off = k / (ridges + .6), pts = [];
      for (let i = 0; i <= 18; i++) { const t = -1.2 + 2.4 * i / 18, s = off * ry * (1 - .34 * t * t); pts.push([x + ux * t * rx + vx * s, y + uy * t * rx + vy * s]); }
      line(c, polyline(pts), alpha(H[4], .45), 4);
      line(c, polyline(pts.map(p => [p[0] - vx * 6, p[1] - vy * 6])), alpha(H[0], .35), 3);
    }
    soft(c, x + rx * .15, y + ry * .9, rx * .9, ry * .3, H[1], .4, rot);
    const sx = x - rx * .28 * ux + ry * .4 * vx * -1, sy = y - rx * .28 * uy + ry * .4 * vy * -1;
    fill(c, ellipse(sx, sy, rx * .5, Math.max(6, ry * .16), rot), alpha('#ffffff', .55));
    fill(c, ellipse(sx - ux * rx * .1, sy - uy * rx * .1, rx * .17, Math.max(3, ry * .045), rot), alpha('#ffffff', .95));
    for (let i = 0; i < glints; i++) { const a = rnd(seed * 7 + i) * TAU, d = .2 + rnd(seed * 13 + i) * .5; sparkle(c, x + Math.cos(a) * rx * d, y + Math.sin(a) * ry * d, 8 + rnd(i + seed) * 5); }
  });
  if (rim) { line(c, pathFn, INK, 14); line(c, pathFn, R.gold[4], 9); line(c, pathFn, R.gold[2], 4); }
  else line(c, pathFn, INK, 5);
  if (gem) {
    const [gx, gy, gr] = gem;
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8 - Math.PI / 2, k = i % 2 ? .95 : 1.35; fill(c, circle(gx + Math.cos(a) * gr * k, gy + Math.sin(a) * gr * k, gr * .26), R.gold[i % 2 ? 3 : 2]); line(c, circle(gx + Math.cos(a) * gr * k, gy + Math.sin(a) * gr * k, gr * .26), R.gold[6], 3); }
    fill(c, circle(gx, gy, gr * 1.05), radial(c, gx - gr * .3, gy - gr * .3, gr * 1.1, [[0, R.gold[0]], [.5, R.gold[2]], [1, R.gold[4]]])); line(c, circle(gx, gy, gr * 1.05), R.gold[6], 4);
    jadeStone(c, gx, gy, gr * .72, gr * .8);
  }
}
// Jade: a faceted cabochon with a sharp specular.
function jadeStone(c, x, y, rx, ry, rot = 0) {
  fill(c, ellipse(x, y, rx, ry, rot), radial(c, x - rx * .25, y - ry * .3, Math.max(rx, ry) * 1.1, [[0, R.jade[1]], [.4, R.jade[3]], [.8, R.jade[4]], [1, R.jade[5]]]));
  clip(c, ellipse(x, y, rx, ry, rot), () => {
    line(c, cc => { cc.moveTo(x - rx * .6, y + ry * .1); cc.lineTo(x, y - ry * .2); cc.lineTo(x + rx * .6, y + ry * .12); }, alpha(R.jade[2], .9), 3);
    fill(c, ellipse(x + rx * .2, y + ry * .45, rx * .55, ry * .25, rot), alpha(R.jade[2], .6));
  });
  fill(c, ellipse(x - rx * .35, y - ry * .4, rx * .22, ry * .16, -.5), '#ffffff');
  line(c, ellipse(x, y, rx, ry, rot), R.jade[6], 3);
}
// A seed leaf (cotyledon): thick, smooth and round-ended, with a soft groove down the middle.
function cotyledon(c, x0, y0, x1, y1, width, { tone = 0, bend = 0, back = false, outline = 5 } = {}) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len, w = width / 2, L = R.leaf, t0 = Math.min(2, tone);
  const prof = t => Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, .72))), .5) * (.42 + .58 * Math.min(1, t / .32));
  const at = (t, s) => { const b = bend * Math.sin(Math.PI * t); return [x0 + dx * t + nx * (s * w * prof(t) + b), y0 + dy * t + ny * (s * w * prof(t) + b)]; };
  const side = s => { const p = []; for (let i = 0; i <= 36; i++) p.push(at(i / 36, s)); return p; };
  const A = side(1), B = side(-1), mid = []; for (let i = 0; i <= 36; i++) mid.push(at(i / 36, 0));
  const pathFn = poly([...A, ...[...B].reverse()]);
  // The side whose normal faces the light (upper left) is the lit half.
  const lit = (nx * -.6 + ny * -.8) > 0 ? 1 : -1, litHalf = lit > 0 ? A : B, darkHalf = lit > 0 ? B : A;
  fill(c, pathFn, L[3 + t0]);
  clip(c, pathFn, () => {
    fill(c, poly([...litHalf, ...[...mid].reverse()]), linear(c, x0, y0, x1, y1, [[0, L[4 + t0]], [.5, L[2 + t0]], [1, L[1 + t0]]]));
    fill(c, poly([...darkHalf, ...[...mid].reverse()]), linear(c, x0, y0, x1, y1, [[0, L[5 + t0]], [.55, L[4 + t0]], [1, L[3 + t0]]]));
    // Groove: a dark crease with a light lip beside it, fading toward the round tip.
    line(c, polyline(mid.slice(2, 30)), L[5 + t0], Math.max(4, width / 22));
    line(c, polyline(mid.slice(3, 28).map(p => [p[0] + nx * lit * 7, p[1] + ny * lit * 7])), alpha(L[back ? 2 : 0], .85), 3);
    // Faint side veins.
    for (const k of [.3, .5, .68]) for (const s of [1, -1]) { const m = at(k, 0), e = at(Math.min(.96, k + .2), s * .78), q = at(k + .08, s * .45); line(c, cc => { cc.moveTo(m[0], m[1]); cc.quadraticCurveTo(q[0], q[1], e[0], e[1]); }, alpha(s === lit ? L[1 + t0] : L[5 + t0], .55), 3); }
    // Glossy bulge on the lit half, a rim of light along its edge.
    const g = at(.58, lit * .5); fill(c, ellipse(g[0], g[1], width * .26, width * .09, Math.atan2(dy, dx)), alpha(L[0], back ? .35 : .7));
    line(c, polyline(litHalf.slice(4, 34)), alpha(L[0], .8), 6);
    sparkle(c, at(.78, lit * .2)[0], at(.78, lit * .2)[1], 7);
  });
  if (outline) line(c, pathFn, L[7], outline);
  return { at, path: pathFn };
}
// One tuft of seed fluff: a soft flame shape from its root toward `ang`.
function tuft(c, x, y, len, wid, ang, tone = 0) {
  const ca = Math.cos(ang), sa = Math.sin(ang), nx = -sa, ny = ca, tip = [x + ca * len, y + sa * len], F = R.fluff;
  const pth = cc => { cc.moveTo(x + nx * wid * .5, y + ny * wid * .5); cc.quadraticCurveTo(x + ca * len * .55 + nx * wid * .7, y + sa * len * .55 + ny * wid * .7, tip[0], tip[1]); cc.quadraticCurveTo(x + ca * len * .55 - nx * wid * .7, y + sa * len * .55 - ny * wid * .7, x - nx * wid * .5, y - ny * wid * .5); cc.closePath(); };
  fill(c, pth, linear(c, x, y, tip[0], tip[1], [[0, F[2 + tone]], [.55, F[1 + tone]], [1, F[tone]]]));
  clip(c, pth, () => {
    line(c, cc => { cc.moveTo(x, y); cc.quadraticCurveTo(x + ca * len * .5 + nx * wid * .16, y + sa * len * .5 + ny * wid * .16, x + ca * len * .86, y + sa * len * .86); }, alpha(F[3 + tone], .7), 3);
    line(c, cc => { cc.moveTo(x - nx * wid * .2, y - ny * wid * .2); cc.quadraticCurveTo(x + ca * len * .45 - nx * wid * .3, y + sa * len * .45 - ny * wid * .3, x + ca * len * .7 - nx * wid * .12, y + sa * len * .7 - ny * wid * .12); }, alpha(F[0], .9), 3);
  });
  line(c, pth, F[5], 3);
}
// A scarf of fluff along a curve: a back row of longer tufts, then a front row.
function ruff(c, pts, { len = 66, wid = 48, down = Math.PI / 2, spread = .5 } = {}) {
  const path = spline(pts, 10), n = path.length - 1;
  for (const [row, tone, k] of [[0, 1, 1.15], [1, 0, .9]]) {
    for (let i = row ? 2 : 0; i <= n; i += 5) {
      const p = path[i], t = i / n, a = down + (t - .5) * spread + (rnd(i + row * 31) - .5) * .35, l = len * k * (.82 + rnd(i * 3 + row) * .3);
      tuft(c, p[0] + (row ? 0 : -Math.cos(a) * 10), p[1] + (row ? 0 : -Math.sin(a) * 10), l, wid * (row ? .95 : 1.05), a, tone);
    }
  }
  // A soft band of fluff along the root line hides where the tufts start.
  line(c, polyline(path), R.fluff[5], wid * .9 + 6);
  line(c, polyline(path), R.fluff[2], wid * .9);
  line(c, polyline(path.map(p => [p[0] - 4, p[1] - 8])), R.fluff[0], wid * .45);
  for (let i = 3; i < n; i += 7) { const p = path[i]; line(c, cc => { cc.moveTo(p[0] - 14, p[1] + 6); cc.quadraticCurveTo(p[0], p[1] - 10, p[0] + 16, p[1] + 2); }, alpha(R.fluff[4], .7), 3); }
}
// The tail puff: a cloud of seed fluff built from soft balls, each lit from the upper left,
// with fine wisps and a few seeds on parasols poking out of its edge.
function puff(c, x, y, r, { seed = 1 } = {}) {
  const F = R.fluff, balls = [];
  for (let i = 0; i < 11; i++) { const a = i / 11 * TAU + seed, d = r * (.58 + rnd(i + seed) * .08); balls.push([x + Math.cos(a) * d, y + Math.sin(a) * d * .94, r * (.4 + rnd(i * 3 + seed) * .1)]); }
  for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + seed + .4; balls.push([x + Math.cos(a) * r * .28, y + Math.sin(a) * r * .28, r * .48]); }
  const union = cc => { for (const [bx, by, br] of balls) { cc.moveTo(bx + br, by); ell(cc, bx, by, br, br); } };
  // Parasols first, so the cloud overlaps their stems.
  for (let i = 0; i < 6; i++) {
    const a = rnd(seed * 11 + i) * TAU, e = [x + Math.cos(a) * r * 1.06, y + Math.sin(a) * r * 1.06], tip = [x + Math.cos(a) * r * 1.24, y + Math.sin(a) * r * 1.24];
    line(c, cc => { cc.moveTo(x + Math.cos(a) * r * .8, y + Math.sin(a) * r * .8); cc.lineTo(tip[0], tip[1]); }, F[4], 4);
    for (let k = -2; k <= 2; k++) { const b = a + k * .34; line(c, cc => { cc.moveTo(tip[0], tip[1]); cc.lineTo(tip[0] + Math.cos(b) * r * .13, tip[1] + Math.sin(b) * r * .13); }, F[1], 4); }
    void e;
  }
  for (const [bx, by, br] of balls) fill(c, circle(bx, by, br + 5), F[5]);
  fill(c, union, F[2]);
  clip(c, union, () => {
    fill(c, circle(x, y, r * 1.3), radial(c, x - r * .3, y - r * .36, r * 1.4, [[0, F[0]], [.38, F[1]], [.7, F[2]], [1, F[4]]]));
    // Each ball: a shadow on its lower right, a soft light on its upper left, a seam where it meets the next.
    for (const [bx, by, br] of balls) {
      const lit = 1 - Math.min(1, Math.max(0, ((bx - x) + (by - y)) / (r * 1.4) + .5));
      soft(c, bx + br * .35, by + br * .4, br * .75, br * .55, F[3 + (lit < .4 ? 1 : 0)], .45);
      soft(c, bx - br * .3, by - br * .35, br * .55, br * .42, F[0], .55 + lit * .35);
      line(c, cc => { cc.arc(bx, by, br - 3, .1 * Math.PI, .65 * Math.PI); }, alpha(F[4], .45), 3);
    }
    // Fine wisps running outward.
    for (let i = 0; i < 18; i++) { const a = i / 18 * TAU + seed * .7, r0 = r * (.35 + rnd(i + seed * 9) * .2), r1 = r * (.75 + rnd(i * 2 + seed) * .2); line(c, cc => { cc.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); cc.quadraticCurveTo(x + Math.cos(a + .08) * (r0 + r1) / 2, y + Math.sin(a + .08) * (r0 + r1) / 2, x + Math.cos(a) * r1, y + Math.sin(a) * r1); }, alpha(F[0], .7), 3); }
    for (let i = 0; i < 5; i++) { const a = rnd(seed * 3 + i) * TAU, d = .25 + rnd(seed * 5 + i) * .55; sparkle(c, x + Math.cos(a) * r * d, y + Math.sin(a) * r * d, 9 + rnd(i) * 7); }
  });
}
// A seed drifting on its parasol of fluff.
function driftSeed(c, x, y, s, rot = 0) {
  c.save(); c.translate(x, y); c.rotate(rot);
  line(c, cc => { cc.moveTo(0, 0); cc.lineTo(0, s * 1.4); }, R.fluff[4], 4);
  for (let k = -3; k <= 3; k++) { const a = -Math.PI / 2 + k * .32; line(c, cc => { cc.moveTo(0, 0); cc.lineTo(Math.cos(a) * s, Math.sin(a) * s); }, R.fluff[1], 4); }
  fill(c, ellipse(0, s * 1.55, s * .16, s * .3), R.husk[3]); line(c, ellipse(0, s * 1.55, s * .16, s * .3), R.husk[6], 2);
  c.restore();
}
// The glowing tendril: a green stem with a lit core.
function tendril(c, pts, w0, w1, { steps = 16 } = {}) {
  const tb = tube(pts, w0, w1, steps);
  fill(c, tb.path, R.leaf[3]);
  clip(c, tb.path, () => {
    fill(c, poly([...tb.left, ...[...tb.mid].reverse()]), R.leaf[2]);
    line(c, polyline(tb.mid), alpha(R.glow[2], .95), Math.max(3, w1 * .5));
    line(c, polyline(tb.left.slice(1)), alpha(R.leaf[0], .7), 3);
  });
  line(c, tb.path, R.leaf[7], 4);
  return tb;
}
// The star bud: five rounded points of light-gold petals around a glowing heart.
function starBud(c, x, y, r, rot = -Math.PI / 2) {
  fill(c, circle(x, y, r * 1.9), radial(c, x, y, r * 1.9, [[0, alpha(R.glow[1], .4)], [.5, alpha(R.glow[2], .22)], [1, alpha(R.glow[3], 0)]]));
  const P = []; for (let i = 0; i < 10; i++) { const a = rot + i * Math.PI / 5, rr = i % 2 ? r * .5 : r; P.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); }
  const star = cc => { const m = (a, b, k = .5) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; const s0 = m(P[9], P[0], .8); cc.moveTo(s0[0], s0[1]); for (let i = 0; i < 10; i += 2) { const o = P[i], prev = P[(i + 9) % 10], next = P[(i + 1) % 10], a = m(prev, o, .8), b = m(o, next, .2), n2 = m(next, P[(i + 2) % 10], .8); cc.lineTo(a[0], a[1]); cc.quadraticCurveTo(o[0], o[1], b[0], b[1]); cc.quadraticCurveTo(next[0], next[1], n2[0], n2[1]); } cc.closePath(); };
  fill(c, star, radial(c, x - r * .25, y - r * .3, r * 1.15, [[0, '#ffffff'], [.3, R.gold[0]], [.65, R.gold[1]], [1, R.gold[3]]]));
  clip(c, star, () => {
    for (let i = 0; i < 10; i += 2) { const o = P[i], l = P[(i + 9) % 10], rr = P[(i + 1) % 10]; fill(c, poly([[x, y], o, rr]), alpha(R.gold[3], .45)); line(c, cc => { cc.moveTo(x, y); cc.lineTo(o[0], o[1]); }, alpha('#ffffff', .8), 3); fill(c, poly([[x, y], l, o]), alpha('#ffffff', .25)); }
    fill(c, circle(x, y, r * .34), radial(c, x, y, r * .34, [[0, '#ffffff'], [.6, R.glow[1]], [1, alpha(R.glow[3], .6)]]));
  });
  line(c, star, R.gold[5], 5);
  sparkle(c, x - r * .05, y - r * .05, r * .42, '#ffffff', '#ffffff');
}
// The helm: the top half of the split seed, ridged like a seed coat, with a jagged rim of
// cracked husk, a gold filigree band above the rim, glitter, and a crack at the tip.
function helm(c, dome, brim, tip, { emblem = null, seed = 1 } = {}) {
  const top = spline(dome, 10), base = spline(brim, 3), teeth = [];
  base.forEach((p, i) => { if (i === 0 || i === base.length - 1) return teeth.push(p); const k = i % 2 ? 1 : -.35, amp = 10 + rnd(i * 7 + seed) * 14; teeth.push([p[0] + (rnd(i + seed) - .5) * 8, p[1] + k * amp]); });
  const pathFn = poly([...top, ...teeth]), H = R.husk;
  const xs = top.map(p => p[0]), ys = top.map(p => p[1]), box = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 + 20, rx: (Math.max(...xs) - Math.min(...xs)) / 2, ry: (Math.max(...ys) - Math.min(...ys)) / 2 };
  fill(c, pathFn, H[2]);
  clip(c, pathFn, () => {
    c.fillStyle = radial(c, box.x - box.rx * .35, box.y - box.ry * .6, box.rx * 1.6, [[0, H[0]], [.25, H[1]], [.55, H[2]], [.8, H[3]], [1, H[5]]]); c.fillRect(box.x - box.rx * 2, box.y - box.ry * 3, box.rx * 4, box.ry * 6);
    // Ridges converge on the tip like the lines of a seed coat.
    for (let i = 1; i < base.length - 1; i += 1) {
      const b = base[i], m = [(b[0] + tip[0]) / 2 + (b[0] - box.x) * .18, (b[1] + tip[1]) / 2 - 6];
      line(c, cc => { cc.moveTo(tip[0], tip[1]); cc.quadraticCurveTo(m[0], m[1], b[0], b[1] + 10); }, alpha(H[5], .55), 5);
      line(c, cc => { cc.moveTo(tip[0] - 3, tip[1] + 4); cc.quadraticCurveTo(m[0] - 7, m[1], b[0] - 7, b[1] + 6); }, alpha(H[0], .45), 3);
    }
    // The rim's thickness: a darker lip just above the jagged edge, cream inner husk showing at the breaks.
    line(c, polyline(teeth), H[0], 18); line(c, polyline(teeth.map(p => [p[0], p[1] - 10])), alpha(H[4], .8), 4);
    // Specular arc and a bright glint.
    const arc = top.slice(Math.floor(top.length * .12), Math.floor(top.length * .45)).map(p => [p[0] + (box.x - p[0]) * .12, p[1] + (box.y - p[1]) * .16]);
    line(c, polyline(arc), alpha('#ffffff', .65), 12); line(c, polyline(arc.slice(2, -3)), alpha('#ffffff', .95), 5);
    soft(c, box.x + box.rx * .3, box.y + box.ry * .9, box.rx * .8, box.ry * .3, H[1], .45);
    for (let i = 0; i < 4; i++) { const p = top[Math.floor(top.length * (.2 + .6 * rnd(seed + i * 3)))], k = .35 + rnd(seed * 2 + i) * .35; sparkle(c, p[0] + (box.x - p[0]) * k, p[1] + (box.y + 30 - p[1]) * k, 9 + rnd(i * 5) * 6); }
  });
  // Gold filigree band above the rim, with star rivets.
  const band = base.map(p => [p[0] + (tip[0] - p[0]) * .16, p[1] + (tip[1] - p[1]) * .16 - 4]);
  const bandPts = spline(band, 6);
  clip(c, pathFn, () => { line(c, polyline(bandPts), R.gold[6], 15); line(c, polyline(bandPts), R.gold[3], 10); line(c, polyline(bandPts.map(p => [p[0], p[1] - 2])), R.gold[1], 4); });
  for (let i = 4; i < bandPts.length - 3; i += 9) { const p = bandPts[i]; sparkle(c, p[0], p[1], 11, R.gold[2], '#ffffff'); }
  line(c, pathFn, INK, 6);
  // The crack the tendril grew through.
  line(c, cc => { cc.moveTo(tip[0] - 26, tip[1] + 18); cc.lineTo(tip[0] - 12, tip[1] + 6); cc.lineTo(tip[0] - 16, tip[1] - 2); cc.lineTo(tip[0], tip[1] - 6); cc.lineTo(tip[0] + 14, tip[1] + 2); cc.lineTo(tip[0] + 10, tip[1] + 10); cc.lineTo(tip[0] + 24, tip[1] + 18); }, H[6], 6);
  if (emblem) { const [ex, ey, er] = emblem; fill(c, seedShape(ex, ey, er * 1.3, er, -Math.PI / 2, .35), radial(c, ex - er * .3, ey - er * .4, er * 1.5, [[0, R.gold[0]], [.5, R.gold[2]], [1, R.gold[4]]])); line(c, seedShape(ex, ey, er * 1.3, er, -Math.PI / 2, .35), R.gold[6], 4); jadeStone(c, ex, ey + er * .08, er * .55, er * .8); }
  return pathFn;
}
// Eyes: deep jade irises, two highlights and a tiny gold star glint, lashes on the outer corner.
function eye(c, x, y, rx, ry, { look = -1, outer = 1 } = {}) {
  fill(c, ellipse(x, y, rx * 1.14, ry * 1.08), R.fur[5]);
  fill(c, ellipse(x, y, rx, ry), radial(c, x + look * rx * .1, y + ry * .25, ry * 1.1, [[0, R.eye[2]], [.45, R.eye[3]], [.75, R.eye[4]], [1, R.eye[5]]]));
  clip(c, ellipse(x, y, rx, ry), () => {
    fill(c, ellipse(x + look * rx * .08, y + ry * .05, rx * .52, ry * .56), R.eye[5]);
    fill(c, ellipse(x + look * rx * .1, y + ry * .6, rx * .72, ry * .32), alpha(R.eye[1], .6));
    fill(c, ellipse(x, y - ry * .95, rx * 1.1, ry * .45), alpha(R.eye[5], .8));
  });
  fill(c, ellipse(x - rx * .3, y - ry * .3, rx * .34, ry * .27, -.4), '#ffffff');
  fill(c, ellipse(x + rx * .34, y + ry * .32, rx * .15, ry * .12), '#ffffff');
  sparkle(c, x + rx * .28, y - ry * .5, Math.max(5, rx * .24), R.gold[1], '#ffffff');
  line(c, ellipse(x, y, rx, ry), R.eye[5], 4);
  line(c, cc => { cc.moveTo(x - rx * 1.15, y - ry * .35); cc.quadraticCurveTo(x - rx * .1, y - ry * 1.45, x + rx * 1.18, y - ry * .3); }, INK, 7);
  const ox = x + outer * rx * 1.12, oy = y - ry * .4;
  for (const [k, len, ang] of [[0, 18, -.35], [.22, 15, -.9], [.42, 12, -1.35]]) {
    const px = ox - outer * rx * k * 1.3, py = oy - ry * k * 1.05, a = outer > 0 ? ang : Math.PI - ang;
    line(c, cc => { cc.moveTo(px, py); cc.quadraticCurveTo(px + Math.cos(a) * len * .6, py + Math.sin(a) * len * .6 - 3, px + Math.cos(a) * len, py + Math.sin(a) * len); }, INK, 4);
  }
  line(c, cc => { cc.moveTo(x - rx * .7, y + ry * 1.05); cc.quadraticCurveTo(x, y + ry * 1.3, x + rx * .75, y + ry * 1.0); }, R.fur[5], 3);
}
// A slender leg along its joints (one width per joint): lit front edge, shaded back edge,
// a husk greave on the shin between the third and fourth joints, and a husk hoof.
function limb(c, joints, widths, ground, { far = false, greave = [.15, .8], dir = -1, skip = 5 } = {}) {
  const steps = 12, tb = tube(joints, widths, 0, steps), F = R.fur, lift = far ? 1 : 0;
  fill(c, tb.path, F[2 + lift]);
  clip(c, tb.path, () => {
    fill(c, poly([...tb.right, ...[...tb.mid].reverse()]), alpha(F[4 + lift], .7));
    fill(c, poly([...tb.right, ...tb.mid.map((p, i) => [p[0] * .4 + tb.right[i][0] * .6, p[1] * .4 + tb.right[i][1] * .6]).reverse()]), alpha(F[5 + lift], .55));
    line(c, polyline(tb.left.slice(2, -2).map((p, i) => [p[0] + (tb.mid[i + 2][0] - p[0]) * .18, p[1] + (tb.mid[i + 2][1] - p[1]) * .18])), alpha(F[0], far ? .45 : .85), 8);
    // Creases at the middle joints (knee or hock, fetlock).
    for (const j of [2, 3]) { const i = j * steps, m = tb.mid[i], l = tb.left[i], r = tb.right[i]; line(c, cc => { cc.moveTo(l[0] + (m[0] - l[0]) * .25, l[1] + 3); cc.quadraticCurveTo(m[0], m[1] + 12, r[0] + (m[0] - r[0]) * .25, r[1] + 1); }, alpha(F[5 + lift], .75), 4); }
  });
  tubeSides(c, tb, INK, 5, skip);
  if (greave) {
    // Greave: a husk plate on the shin, pointed toward the hoof, with a gold band at its top.
    const i0 = Math.round((2 + greave[0]) * steps), i1 = Math.round((2 + greave[1]) * steps), out = (p, m, k) => [m[0] + (p[0] - m[0]) * k, m[1] + (p[1] - m[1]) * k];
    const Lp = [], Rp = []; for (let i = i0; i <= i1; i++) { Lp.push(out(tb.left[i], tb.mid[i], 1.2)); Rp.push(out(tb.right[i], tb.mid[i], 1.2)); }
    const m1 = tb.mid[i1], m0 = tb.mid[i1 - 1], dl = Math.hypot(m1[0] - m0[0], m1[1] - m0[1]) || 1, tip = [m1[0] + (m1[0] - m0[0]) / dl * 22, m1[1] + (m1[1] - m0[1]) / dl * 22];
    const pts = [...Lp, tip, ...[...Rp].reverse()], cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const rot = Math.atan2(m1[1] - tb.mid[i0][1], m1[0] - tb.mid[i0][0]);
    huskPlate(c, smoothPath(pts), { x: cx, y: cy, rx: Math.hypot(m1[0] - tb.mid[i0][0], m1[1] - tb.mid[i0][1]) / 2 + 8, ry: widths[3] * .6 }, { ridges: 1, rot, far, rim: false, glints: 1, seed: joints[0][0] });
    const a = Lp[0], b = Rp[0];
    line(c, cc => { cc.moveTo(a[0], a[1]); cc.lineTo(b[0], b[1]); }, INK, 15); line(c, cc => { cc.moveTo(a[0], a[1]); cc.lineTo(b[0], b[1]); }, R.gold[3], 9); line(c, cc => { cc.moveTo(a[0], a[1] - 2); cc.lineTo(b[0], b[1] - 2); }, R.gold[1], 3);
  }
  // Hoof.
  const end = tb.mid.at(-1), w = widths.at(-1) * 1.3, h = Math.max(32, ground - end[1] + 10), x = end[0], y = ground;
  const hp = cc => { cc.moveTo(x - w * .42, y - h); cc.lineTo(x + w * .42, y - h); cc.quadraticCurveTo(x + w * .6, y - h * .45, x + w * (dir > 0 ? .7 : .52), y); cc.lineTo(x - w * (dir < 0 ? .7 : .52), y); cc.quadraticCurveTo(x - w * .6, y - h * .45, x - w * .42, y - h); cc.closePath(); };
  fill(c, hp, linear(c, x - w / 2, 0, x + w / 2, 0, [[0, R.husk[2 + lift]], [.45, R.husk[4]], [1, R.husk[6]]]));
  clip(c, hp, () => {
    line(c, cc => { cc.moveTo(x - w * .26, y - h * .82); cc.lineTo(x - w * .32, y - h * .2); }, alpha(R.husk[0], .9), 5);
    line(c, cc => { cc.moveTo(x + dir * w * .04, y - h * .45); cc.lineTo(x + dir * w * .08, y + 2); }, R.husk[6], 4);
    fill(c, ellipse(x, y + 2, w * .7, 7), alpha(R.husk[6], .8));
  });
  line(c, hp, INK, 5);
  line(c, cc => { cc.moveTo(x - w * .46, y - h); cc.lineTo(x + w * .46, y - h); }, R.gold[5], 9); line(c, cc => { cc.moveTo(x - w * .44, y - h - 1); cc.lineTo(x + w * .44, y - h - 1); }, R.gold[2], 4);
  return tb;
}
// Small four-point star dapples on the coat.
function dapple(c, x, y, r) {
  fill(c, cc => { cc.moveTo(x, y - r); cc.quadraticCurveTo(x + r * .2, y - r * .2, x + r, y); cc.quadraticCurveTo(x + r * .2, y + r * .2, x, y + r); cc.quadraticCurveTo(x - r * .2, y + r * .2, x - r, y); cc.quadraticCurveTo(x - r * .2, y - r * .2, x, y - r); }, alpha(R.gold[1], .95));
  fill(c, circle(x, y, r * .28), '#ffffff');
}
// Fur strokes: a dark crease with a light ridge beside it.
function crease(c, pts, w = 4, lightA = .8, dark = R.fur[5]) {
  line(c, smoothPath(pts, false), dark, w);
  line(c, smoothPath(pts.map(p => [p[0] + 2, p[1] + 6]), false), alpha(R.fur[0], lightA), 3);
}

// ── Front view: facing left, the head turned three-quarters toward the viewer.
function front(c) {
  const ground = 1142;
  // Tail and its puff of seed fluff, rising behind the rump.
  const tail = tube([[930, 618], [984, 586], [1022, 532], [1034, 480]], 42, 26, 12);
  shade(c, tail.path, { x: 990, y: 550, rx: 60, ry: 70 }, R.fur, { base: 3, light: 1, dark: 6 }); tubeSides(c, tail, INK, 5, 3);
  puff(c, 1032, 408, 92, { seed: 2 });
  // Far ear, reaching out past the brow.
  cotyledon(c, 268, 318, 104, 262, 104, { tone: 1, bend: 10 });
  // Far legs behind the body.
  limb(c, [[648, 660], [628, 800], [620, 930], [612, 1048], [608, 1090]], [100, 66, 42, 32, 32], ground - 16, { far: true });
  limb(c, [[904, 668], [886, 800], [954, 926], [944, 1046], [940, 1088]], [112, 80, 46, 34, 32], ground - 18, { far: true });
  // Body: deep chest, tucked belly, rounded croup.
  const bodyPts = [[462, 612], [526, 552], [620, 528], [722, 534], [822, 546], [902, 562], [952, 608], [972, 676], [956, 744], [904, 772], [810, 768], [712, 758], [626, 776], [548, 792], [486, 766], [452, 696]];
  const body = smoothPath(bodyPts);
  shade(c, body, { x: 710, y: 650, rx: 260, ry: 130 }, R.fur, { base: 2, light: 1, dark: 5, lx: -.45, ly: -.65, rim: { color: R.fur[0], from: .3, to: 1.05, width: 14, alpha: .6 },
    ao: () => { soft(c, 700, 790, 280, 50, R.fur[5], .65); soft(c, 960, 690, 50, 110, R.fur[5], .4); soft(c, 712, 752, 130, 22, R.fur[0], .5); } });
  clip(c, body, () => {
    crease(c, [[640, 724], [690, 738], [742, 732]], 3, .6);
    for (const [x, y] of [[650, 562], [706, 584], [760, 560], [818, 580], [732, 616], [866, 600], [604, 588], [790, 624]]) dapple(c, x, y, 13);
  });
  // Near legs grow out of the body: the hind leg with its thigh, the foreleg from the shoulder.
  blendIn(c, cc => limb(cc, [[884, 640], [852, 800], [922, 932], [904, 1062], [898, 1104]], [166, 98, 52, 38, 38], ground, { skip: 14 }), [884, 640], [866, 742]);
  blendIn(c, cc => limb(cc, [[596, 640], [570, 790], [560, 936], [552, 1064], [548, 1104]], [134, 82, 50, 38, 38], ground, { skip: 12 }), [596, 650], [576, 752]);
  outlineExcept(c, body, [[572, 790, 54, 34], [858, 784, 70, 34]], INK, 5);
  // The flank fold where the thigh meets the belly.
  crease(c, [[818, 728], [806, 764], [812, 800]], 4, .7);
  // Hip plate.
  huskPlate(c, seedShape(888, 652, 66, 46, 2.3, .38), { x: 888, y: 652, rx: 66, ry: 46 }, { ridges: 2, rot: 2.3, seed: 3, glints: 3 });
  // Neck rising to the head.
  blendIn(c, cc => {
    const neck = tube([[548, 664], [506, 572], [458, 486], [424, 436]], [196, 154, 126, 118], 0, 10);
    shade(cc, neck.path, { x: 480, y: 540, rx: 90, ry: 120 }, R.fur, { base: 2, light: 0, dark: 5, lx: -.6, ly: -.3, ao: () => soft(cc, 520, 470, 70, 40, R.fur[5], .6) });
    tubeSides(cc, neck, INK, 5, 10);
  }, [560, 672], [540, 630]);
  // Shoulder plate and the breastplate with its jade.
  huskPlate(c, seedShape(612, 652, 70, 46, 1.75, .42), { x: 612, y: 652, rx: 70, ry: 46 }, { ridges: 2, rot: 1.75, seed: 7, glints: 3 });
  huskPlate(c, smoothPath([[430, 612], [506, 604], [552, 652], [544, 726], [502, 774], [454, 764], [426, 704]]), { x: 488, y: 684, rx: 62, ry: 86 }, { ridges: 2, rot: Math.PI / 2, seed: 11, gem: [484, 676, 24], glints: 2 });
  // Scarf of seed fluff around the base of the neck.
  ruff(c, [[578, 512], [538, 560], [488, 600], [434, 614], [398, 598]], { len: 66, wid: 48, down: 1.85, spread: .9 });
  // Near ear, behind the head toward the back.
  cotyledon(c, 448, 330, 626, 262, 118, { tone: 0, bend: -14 });
  // Head: round skull, short fawn muzzle.
  const headPts = [[456, 364], [444, 300], [372, 268], [286, 284], [238, 330], [212, 382], [190, 420], [180, 446], [194, 472], [232, 494], [300, 502], [382, 490], [440, 452]];
  const head = smoothPath(headPts);
  shade(c, head, { x: 330, y: 390, rx: 140, ry: 120 }, R.fur, { base: 2, light: 0, dark: 5, lx: -.4, ly: -.5, rim: { color: R.fur[0], from: .3, to: 1.05, width: 12, alpha: .8 },
    ao: () => { soft(c, 400, 490, 90, 40, R.fur[5], .6); } });
  clip(c, head, () => {
    fill(c, ellipse(220, 452, 52, 40, -.2), alpha(R.fur[0], .95));
    fill(c, ellipse(370, 452, 44, 20, -.1), alpha(R.blush[1], .6)); fill(c, ellipse(226, 430, 18, 10, -.2), alpha(R.blush[1], .5));
    crease(c, [[402, 460], [432, 430], [440, 392]], 3, .7);
  });
  line(c, head, INK, 5);
  // Face.
  eye(c, 250, 386, 16, 27, { look: -1, outer: -1 });
  eye(c, 338, 394, 27, 34, { look: -1, outer: 1 });
  const nose = cc => { cc.moveTo(178, 436); cc.quadraticCurveTo(186, 424, 202, 428); cc.quadraticCurveTo(212, 438, 204, 452); cc.quadraticCurveTo(190, 458, 180, 452); cc.closePath(); };
  fill(c, nose, linear(c, 180, 426, 204, 456, [[0, R.blush[2]], [1, R.blush[4]]])); fill(c, ellipse(188, 434, 6, 4, -.3), alpha('#ffffff', .9)); line(c, nose, INK, 4);
  line(c, cc => { cc.moveTo(196, 458); cc.quadraticCurveTo(204, 476, 222, 476); cc.quadraticCurveTo(236, 476, 244, 466); }, INK, 4);
  // The helm, the tendril through its crack and the star bud.
  helm(c, [[226, 352], [230, 300], [262, 252], [314, 220], [364, 204], [416, 216], [458, 254], [480, 304], [474, 356]],
    [[474, 356], [420, 338], [360, 330], [300, 332], [252, 340], [226, 352]], [364, 208], { emblem: [292, 290, 22], seed: 4 });
  tendril(c, [[412, 166], [430, 146], [432, 126], [416, 116], [404, 128], [414, 140]], 12, 5, { steps: 10 });
  tendril(c, [[366, 214], [382, 172], [366, 134], [340, 110], [328, 96]], 28, 14);
  cotyledon(c, 372, 178, 322, 160, 34, { tone: 0, bend: -4, outline: 4 });
  cotyledon(c, 376, 172, 420, 184, 30, { tone: 1, bend: 4, outline: 4 });
  starBud(c, 326, 74, 46, -Math.PI / 2 - .12);
  // Glitter and drifting seeds.
  for (const [x, y, r] of [[236, 128, 15], [438, 70, 11], [150, 372, 13], [1136, 300, 12], [1010, 262, 10]]) twinkle(c, x, y, r);
  driftSeed(c, 1128, 540, 24, .5); driftSeed(c, 940, 300, 20, -.4);
}

// ── Back view: facing right and away, seen from behind and to the left.
function back(c) {
  const ground = 1142;
  // The far end of the animal is foreshortened: shoulders, neck and head sit closer to the haunches.
  const near = fn => { c.save(); c.translate(-44, 0); fn(); c.restore(); };
  // Far ear (the right one), beyond the head.
  near(() => cotyledon(c, 984, 330, 1118, 278, 100, { tone: 2, bend: -10 }));
  // The forelegs, farther away (their hooves sit higher), and the far hind leg under the right haunch.
  near(() => {
    limb(c, [[768, 690], [772, 806], [770, 916], [774, 1022], [776, 1058]], [84, 60, 40, 30, 30], ground - 74, { far: true, dir: 1 });
    limb(c, [[700, 700], [698, 820], [694, 930], [698, 1036], [700, 1072]], [96, 66, 44, 33, 32], ground - 60, { far: true, dir: 1 });
  });
  limb(c, [[530, 660], [536, 810], [520, 934], [526, 1052], [528, 1094]], [170, 100, 52, 38, 36], ground - 8, { far: true, dir: 1 });
  // Body from behind: two round haunches toward the viewer, the back running away to the shoulders.
  const bodyPts = [[236, 690], [252, 600], [318, 536], [420, 508], [536, 500], [626, 508], [700, 536], [756, 590], [768, 660], [738, 716], [664, 746], [596, 772], [540, 806], [450, 826], [350, 822], [270, 780]];
  const body = smoothPath(bodyPts);
  shade(c, body, { x: 490, y: 660, rx: 270, ry: 160 }, R.fur, { base: 2, light: 1, dark: 5, lx: -.55, ly: -.6, rim: { color: R.fur[0], from: .2, to: 1.05, width: 14, alpha: .55 },
    ao: () => { soft(c, 540, 810, 260, 50, R.fur[5], .6); soft(c, 756, 660, 50, 100, R.fur[5], .4); soft(c, 540, 700, 90, 120, R.fur[4], .35); } });
  clip(c, body, () => {
    // Spine running away from the viewer, the cleft between the haunches below the tail.
    line(c, cc => { cc.moveTo(450, 556); cc.quadraticCurveTo(580, 520, 726, 556); }, alpha(R.fur[0], .9), 9);
    line(c, cc => { cc.moveTo(450, 578); cc.quadraticCurveTo(580, 544, 726, 576); }, alpha(R.fur[4], .45), 4);
    crease(c, [[446, 600], [462, 700], [452, 822]], 5, .75);
    for (const [x, y] of [[500, 538], [560, 528], [620, 532], [676, 548], [596, 572], [528, 580], [652, 590]]) dapple(c, x, y, 13);
  });
  // The near hind leg with its round thigh, toward the viewer.
  blendIn(c, cc => limb(cc, [[360, 650], [356, 806], [336, 936], [346, 1064], [350, 1104]], [196, 116, 58, 40, 38], ground, { dir: 1, skip: 14 }), [360, 640], [360, 742]);
  outlineExcept(c, body, [[356, 812, 84, 36]], INK, 5);
  crease(c, [[440, 720], [452, 770], [440, 818]], 4, .6);
  // Hip plate on the near haunch.
  huskPlate(c, seedShape(340, 650, 74, 52, .45, .36), { x: 340, y: 650, rx: 74, ry: 52 }, { ridges: 2, rot: .45, seed: 13, glints: 3 });
  near(() => {
    // Neck rising to the head.
    blendIn(c, cc => {
      const neck = tube([[728, 628], [780, 548], [830, 474], [862, 430]], [166, 146, 124, 118], 0, 10);
      shade(cc, neck.path, { x: 800, y: 540, rx: 90, ry: 120 }, R.fur, { base: 2, light: 1, dark: 5, lx: -.6, ly: -.4, ao: () => soft(cc, 840, 470, 70, 40, R.fur[5], .6) });
      tubeSides(cc, neck, INK, 5, 10);
    }, [726, 648], [744, 604]);
    // Near shoulder plate, seen from behind.
    huskPlate(c, seedShape(712, 650, 62, 42, 1.3, .42), { x: 712, y: 650, rx: 62, ry: 42 }, { ridges: 2, rot: 1.3, seed: 19, glints: 2 });
    // Scarf of seed fluff around the neck, from behind.
    ruff(c, [[684, 596], [726, 552], [786, 518], [852, 506], [910, 518]], { len: 66, wid: 48, down: 1.45, spread: -.7 });
    // The back of the head, turned away: only the cheek's edge and the lashes show on the right.
    const headPts = [[778, 392], [790, 318], [850, 280], [920, 276], [976, 304], [1006, 352], [1014, 400], [994, 440], [944, 468], [880, 478], [820, 464], [786, 432]];
    const head = smoothPath(headPts);
    shade(c, head, { x: 890, y: 380, rx: 125, ry: 105 }, R.fur, { base: 2, light: 1, dark: 5, lx: -.6, ly: -.5, rim: { color: R.fur[0], from: .3, to: 1.05, width: 12, alpha: .85 },
      ao: () => { soft(c, 860, 470, 110, 40, R.fur[5], .6); } });
    clip(c, head, () => {
      fill(c, ellipse(990, 430, 30, 30, .2), alpha(R.blush[1], .45));
      crease(c, [[830, 450], [812, 410], [816, 370]], 3, .7);
    });
    line(c, head, INK, 5);
    // The far side of the face: a sliver of the eye at the cheek's edge, with its lashes.
    clip(c, head, () => {
      fill(c, ellipse(1002, 388, 13, 25, .1), R.eye[4]); fill(c, ellipse(1000, 380, 5, 7), '#ffffff');
      line(c, cc => { cc.moveTo(990, 362); cc.quadraticCurveTo(1004, 352, 1016, 360); }, INK, 6);
    });
    for (const [len, ang] of [[18, -.5], [15, -.05], [12, .4]]) line(c, cc => { cc.moveTo(1010, 362); cc.quadraticCurveTo(1010 + Math.cos(ang) * len * .6, 362 + Math.sin(ang) * len * .6 - 3, 1010 + Math.cos(ang) * len, 362 + Math.sin(ang) * len); }, INK, 4);
    // Soft fur at the nape, under the rim of the helm.
    for (const [x, y, a] of [[812, 388, 2.3], [838, 396, 2.0], [866, 400, 1.75]]) tuft(c, x, y, 34, 26, a, 0);
    // Near ear (the left one), seen from its back, sweeping out over the neck.
    cotyledon(c, 798, 336, 620, 284, 118, { tone: 1, bend: 14, back: true });
    // The helm from behind: its tip, ridges, the band and the cracked rim around the nape.
    helm(c, [[778, 360], [784, 300], [816, 250], [866, 218], [912, 208], [958, 224], [994, 262], [1012, 310], [1008, 354]],
      [[1008, 354], [960, 368], [900, 374], [840, 370], [800, 364], [778, 360]], [908, 212], { seed: 9 });
    tendril(c, [[938, 170], [962, 154], [968, 134], [954, 120], [940, 130], [948, 144]], 12, 5, { steps: 10 });
    tendril(c, [[908, 218], [926, 174], [914, 136], [892, 110], [884, 94]], 28, 14);
    cotyledon(c, 916, 180, 870, 160, 34, { tone: 1, bend: -4, outline: 4 });
    cotyledon(c, 920, 174, 964, 188, 30, { tone: 0, bend: 4, outline: 4 });
    starBud(c, 882, 72, 46, -Math.PI / 2 + .1);
  });
  // Tail toward the viewer, rising from the haunch to its puff.
  const tail = tube([[446, 584], [428, 528], [388, 470], [348, 430]], 46, 28, 12);
  shade(c, tail.path, { x: 400, y: 500, rx: 60, ry: 70 }, R.fur, { base: 2, light: 1, dark: 5 });
  clip(c, tail.path, () => fill(c, circle(446, 584, 52), radial(c, 446, 584, 52, [[0, R.fur[2]], [.6, alpha(R.fur[2], .7)], [1, alpha(R.fur[2], 0)]])));
  tubeSides(c, tail, INK, 5, 4);
  puff(c, 318, 364, 94, { seed: 5 });
  for (const [x, y, r] of [[1010, 120, 14], [790, 96, 11], [1096, 400, 13], [196, 520, 12], [470, 300, 10]]) twinkle(c, x, y, r);
  driftSeed(c, 196, 236, 22, -.5); driftSeed(c, 520, 400, 18, .35);
}

// ── Reduction to the pixel grid.
function pixelate(src) {
  const data = src.getContext('2d').getImageData(0, 0, S, S).data, out = new Uint8ClampedArray(GRID * GRID * 4), cache = new Map();
  for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let y = 0; y < K; y++) for (let x = 0; x < K; x++) { const i = ((gy * K + y) * S + gx * K + x) * 4, w = data[i + 3] / 255; r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; a += w; }
    if (a / (K * K) < .5) continue;
    const key = ((r / a) >> 2) << 12 | ((g / a) >> 2) << 6 | ((b / a) >> 2);
    let best = cache.get(key);
    if (best === undefined) {
      const L = lab([r / a, g / a, b / a]); let dist = Infinity;
      PAL_LAB.forEach((p, i) => { const d = (L[0] - p[0]) ** 2 + (L[1] - p[1]) ** 2 + (L[2] - p[2]) ** 2; if (d < dist) { dist = d; best = i; } });
      cache.set(key, best);
    }
    const o = (gy * GRID + gx) * 4; [out[o], out[o + 1], out[o + 2]] = PAL_RGB[best]; out[o + 3] = 255;
  }
  // One-pixel ink outline around the figure.
  const ink = hexRGB(INK), solid = i => out[i * 4 + 3] === 255, edges = [];
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const i = y * GRID + x; if (solid(i)) continue;
    if ((x > 0 && solid(i - 1)) || (x < GRID - 1 && solid(i + 1)) || (y > 0 && solid(i - GRID)) || (y < GRID - 1 && solid(i + GRID))) edges.push(i);
  }
  for (const i of edges) { [out[i * 4], out[i * 4 + 1], out[i * 4 + 2]] = ink; out[i * 4 + 3] = 255; }
  // Weight on the shadow side: a second pixel to the right of and below the outline where the figure lies left or above.
  const ring = new Set(edges), heavy = [];
  for (const i of edges) { const x = i % GRID; if (x < GRID - 1 && !solid(i + 1) && x > 0 && out[(i - 1) * 4 + 3] === 255 && !ring.has(i - 1)) heavy.push(i + 1); if (i + GRID < GRID * GRID && !solid(i + GRID) && i - GRID >= 0 && !ring.has(i - GRID) && out[(i - GRID) * 4 + 3] === 255) heavy.push(i + GRID); }
  for (const i of heavy) { [out[i * 4], out[i * 4 + 1], out[i * 4 + 2]] = ink; out[i * 4 + 3] = 255; }
  const small = createCanvas(GRID, GRID), sc = small.getContext('2d'), img = sc.createImageData(GRID, GRID); img.data.set(out); sc.putImageData(img, 0, 0);
  const big = createCanvas(S, S), bc = big.getContext('2d'); bc.imageSmoothingEnabled = false; bc.drawImage(small, 0, 0, S, S);
  return big;
}

async function main() {
  const args = process.argv.slice(2), previewAt = args.indexOf('--preview'), preview = previewAt >= 0 ? args[previewAt + 1] : null;
  const outFile = args.find((a, i) => !a.startsWith('--') && (previewAt < 0 || i !== previewAt + 1)) || path.join(ROOT, 'assets', 'floravelle.png');
  const views = [front, back].map(draw => { const cv = createCanvas(S, S), c = cv.getContext('2d'); draw(c); return cv; });
  const sheet = createCanvas(S * 2, S), shc = sheet.getContext('2d');
  views.map(pixelate).forEach((v, i) => shc.drawImage(v, i * S, 0));
  fs.writeFileSync(outFile, await sheet.encode('png'));
  if (preview) { fs.mkdirSync(preview, { recursive: true }); for (const [i, v] of views.entries()) fs.writeFileSync(path.join(preview, `vector-${i ? 'back' : 'front'}.png`), await v.encode('png')); }
  console.log(JSON.stringify({ wrote: outFile, size: [sheet.width, sheet.height], palette: PALETTE.length }));
}
main().catch(error => { console.error(error); process.exit(1); });
