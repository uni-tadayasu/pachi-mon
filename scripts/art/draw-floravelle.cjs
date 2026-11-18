#!/usr/bin/env node
'use strict';
/* キラシード (id floravelle, formerly フロラヴェール) — the operator's mythical, after the owner's
 * design: a sturdy leaf-green creature with long drooping leaf ears and a leaf-shaped tuft on its
 * head. On its back a seed husk has split into two halves; leaves grow from the hollows, and two
 * stems carry cup-shaped apricot flowers, each holding a golden seed. Its paws are brown with a
 * zigzag edge and three toes, and its tail is a thick brown curl.
 *
 * Drawn in the same manner as the other creatures: soft painted shading and a dark brown outline.
 * Both views are painted as shapes on a 1200-pixel canvas (soft key light from the upper left, a
 * rim of light on the far edges, occlusion where forms meet), then reduced to a 200-pixel grid:
 * each cell takes the nearest colour (CIELAB) from hue-shifted ramps per material, a one-pixel
 * outline closes the figure, and the result is enlarged 6x.
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
const S = 1200, GRID = 200, K = S / GRID, TAU = Math.PI * 2;

// ── Ramps, light to dark. Shadows lean cool, lights lean warm.
const R = {
  coat: ['#eef4c6', '#cfe09a', '#adc672', '#8fae58', '#78974a', '#617e3f', '#4b6435', '#384b2c'],
  pale: ['#f9f9e4', '#e7edc6', '#d2dca7', '#b8c68a', '#9caa72'],
  leaf: ['#eef7c8', '#cfe596', '#a9cc6c', '#89b354', '#6f9a45', '#577d39', '#42612f', '#2f4625'],
  husk: ['#fbe8bb', '#f0ce8c', '#ddb069', '#c6914e', '#a6733c', '#7f5530', '#5a3b25', '#3e281b'],
  peach: ['#fff6ea', '#fde3c4', '#f8c896', '#f1aa6c', '#e48e50', '#c4703c', '#93512c'],
  gold: ['#fffbe2', '#ffefb2', '#fbd874', '#efbb4c', '#d4973b', '#aa7230', '#7b5126'],
  paw: ['#f0c3a1', '#dca07a', '#c2815f', '#9f644a', '#774a38'],
  eye: ['#ffffff', '#ffe29a', '#f6b04a', '#dc8526', '#9a4f16', '#2a1508'],
  blush: ['#f9dccb', '#f0bba4', '#e0998a'],
  ink: ['#4d3326']
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

// ── Materials.
// A leaf from base to tip: soft round tip, a midrib, side veins, a lit half and a shaded half.
function leaf(c, x0, y0, x1, y1, width, { bend = 0, tone = 0, veins = 3, outline = 7, back = false, round = .62 } = {}) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len, w = width / 2, L = R.leaf, t = Math.min(2, tone);
  const prof = u => Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(u, .75))), round) * (.5 + .5 * Math.min(1, u / .25));
  const at = (u, s) => { const b = bend * Math.sin(Math.PI * u); return [x0 + dx * u + nx * (s * w * prof(u) + b), y0 + dy * u + ny * (s * w * prof(u) + b)]; };
  const side = s => { const p = []; for (let i = 0; i <= 32; i++) p.push(at(i / 32, s)); return p; };
  const A = side(1), B = side(-1), mid = side(0), pathFn = poly([...A, ...[...B].reverse()]);
  const lit = (nx * -.6 + ny * -.8) > 0 ? 1 : -1, litHalf = lit > 0 ? A : B, darkHalf = lit > 0 ? B : A;
  fill(c, pathFn, L[3 + t]);
  clip(c, pathFn, () => {
    fill(c, poly([...litHalf, ...[...mid].reverse()]), linear(c, x0, y0, x1, y1, [[0, L[3 + t]], [.55, L[2 + t]], [1, L[2 + t]]]));
    fill(c, poly([...darkHalf, ...[...mid].reverse()]), linear(c, x0, y0, x1, y1, [[0, L[5 + t]], [.6, L[4 + t]], [1, L[3 + t]]]));
    line(c, polyline(mid.slice(1, 29)), back ? L[4 + t] : L[0], Math.max(5, width / 18));
    for (let k = 1; k <= veins; k++) {
      const u = .12 + .72 * k / (veins + .5);
      for (const s of [1, -1]) { const m = at(u, 0), e = at(Math.min(.95, u + .18), s * .82); line(c, cc => { cc.moveTo(m[0], m[1]); cc.quadraticCurveTo((m[0] + e[0]) / 2 + (e[0] - m[0]) * .1, (m[1] + e[1]) / 2, e[0], e[1]); }, alpha(back ? L[4 + t] : L[s === lit ? 0 : 1 + t], .85), 5); }
    }
    line(c, polyline(litHalf.slice(4, 29)), alpha(L[0], .55), 7);
  });
  if (outline) line(c, pathFn, L[7], outline);
  return { at, path: pathFn };
}
// One petal from its base toward ang: widest past the middle, a rounded tip.
function petal(c, x, y, ang, len, wid, ramp, { base = 3, tip = 0, rim = true } = {}) {
  const ca = Math.cos(ang), sa = Math.sin(ang), nx = -sa, ny = ca;
  const prof = u => Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(u, .62))), .55) * (.35 + .65 * Math.min(1, u / .4));
  const at = (u, s) => [x + ca * len * u + nx * s * wid / 2 * prof(u), y + sa * len * u + ny * s * wid / 2 * prof(u)];
  const pts = []; for (let i = 0; i <= 24; i++) pts.push(at(i / 24, 1)); for (let i = 24; i >= 0; i--) pts.push(at(i / 24, -1));
  const pathFn = poly(pts), end = at(1, 0);
  fill(c, pathFn, linear(c, x, y, end[0], end[1], [[0, ramp[base]], [.55, ramp[Math.max(tip, base - 2)]], [1, ramp[tip]]]));
  clip(c, pathFn, () => {
    const m = at(.55, -.55); soft(c, m[0], m[1], wid * .35, len * .22, ramp[base + 1], .45, ang + Math.PI / 2);
    if (rim) line(c, polyline(pts.slice(10, 30)), alpha(ramp[0], .9), 6);
    const v0 = at(.15, 0), v1 = at(.7, .1); line(c, cc => { cc.moveTo(v0[0], v0[1]); cc.lineTo(v1[0], v1[1]); }, alpha(ramp[base], .45), 4);
  });
  line(c, pathFn, ramp[6], 6);
}
// The golden seed at the heart of a flower: an upright egg of polished gold with a glint.
function goldSeed(c, x, y, rx, ry) {
  fill(c, ellipse(x, y, rx * 1.9, ry * 1.6), radial(c, x, y, ry * 1.7, [[0, alpha(R.gold[1], .45)], [1, alpha(R.gold[1], 0)]]));
  const pth = ellipse(x, y, rx, ry);
  fill(c, pth, radial(c, x - rx * .35, y - ry * .35, ry * 1.3, [[0, R.gold[0]], [.2, R.gold[1]], [.5, R.gold[2]], [.8, R.gold[3]], [1, R.gold[5]]]));
  clip(c, pth, () => soft(c, x + rx * .45, y + ry * .5, rx * .7, ry * .45, R.gold[4], .6));
  line(c, pth, R.gold[6], 6);
  fill(c, ellipse(x - rx * .35, y - ry * .4, rx * .28, ry * .2, -.5), '#ffffff');
  sparkle(c, x + rx * .55, y - ry * .7, ry * .55, R.gold[0], '#ffffff');
}
// A cup-shaped flower seen from the front: back petals, inner petals, the golden seed, then the front petals.
function cupFlower(c, x, y, r, tilt = 0, squash = .72) {
  c.save(); c.translate(x, y); c.rotate(tilt); c.scale(1, squash);
  const P = R.peach, deg = Math.PI / 180;
  for (const a of [-165, -115, -65, -15]) petal(c, 0, 0, a * deg, r, r * .98, P, { base: 4, tip: 0 });
  for (const a of [-138, -90, -42]) petal(c, 0, -r * .04, a * deg, r * .7, r * .78, P, { base: 5, tip: 2 });
  c.restore();
  goldSeed(c, x + Math.sin(tilt) * r * .04, y - r * .02, r * .19, r * .25);
  c.save(); c.translate(x, y); c.rotate(tilt); c.scale(1, squash);
  for (const a of [158, 22, 90]) petal(c, 0, r * .12, a * deg, r * .78, r * 1.02, P, { base: 3, tip: 0 });
  c.restore();
}
// The same flower from behind: the backs of the petals, a green calyx where the stem holds it.
function cupFlowerBack(c, x, y, r, tilt = 0, squash = .72) {
  c.save(); c.translate(x, y); c.rotate(tilt); c.scale(1, squash);
  const P = R.peach, deg = Math.PI / 180;
  for (const a of [-160, -110, -70, -20]) petal(c, 0, 0, a * deg, r, r * .98, P, { base: 5, tip: 1 });
  // A glimpse of the seed between the far petals.
  c.restore();
  fill(c, ellipse(x, y - r * .26, r * .12, r * .08), R.gold[2]); line(c, ellipse(x, y - r * .26, r * .12, r * .08), R.gold[6], 4);
  c.save(); c.translate(x, y); c.rotate(tilt); c.scale(1, squash);
  for (const a of [145, 35, 90]) petal(c, 0, -r * .08, a * deg, r * .7, r * 1.0, P, { base: 5, tip: 2, rim: false });
  c.restore();
}
// A stem: green, with a lit edge.
function stem(c, pts, w0, w1) {
  const tb = tube(pts, w0, w1, 12), L = R.leaf;
  fill(c, tb.path, L[3]);
  clip(c, tb.path, () => { fill(c, poly([...tb.left, ...[...tb.mid].reverse()]), L[2]); line(c, polyline(tb.left.slice(1)), alpha(L[0], .7), 5); });
  line(c, tb.path, L[7], 6);
}
// Half of the split seed husk: a pointed boat whose hollow faces up. draw() paints the shell
// and its dark hollow; lip() paints the near rim over whatever grows out of it.
function husk(c, x, y, a, b, h, rot) {
  const H = R.husk, enter = () => { c.save(); c.translate(x, y); c.rotate(rot); };
  const lens = cc => { cc.moveTo(-a, -b * .6); cc.quadraticCurveTo(0, -b * 2.2, a, -b * .6); cc.quadraticCurveTo(0, b * 2.2, -a, -b * .6); cc.closePath(); };
  const bowl = cc => { cc.moveTo(-a, -b * .6); cc.bezierCurveTo(-a * .82, h * 1.25, a * .82, h * 1.25, a, -b * .6); cc.quadraticCurveTo(0, b * 2.2, -a, -b * .6); cc.closePath(); };
  return {
    draw() {
      enter();
      fill(c, bowl, H[3]);
      clip(c, bowl, () => {
        fill(c, rect(-a * 1.2, -b * 2, a * 2.4, h * 2), linear(c, -a, 0, a * .6, h, [[0, H[1]], [.45, H[2]], [.8, H[3]], [1, H[5]]]));
        for (const k of [.5, .75]) line(c, cc => { cc.moveTo(-a * .92, h * k * .1); cc.bezierCurveTo(-a * .7, h * k * 1.25, a * .7, h * k * 1.25, a * .92, h * k * .1); }, alpha(H[5], .4), 5);
        soft(c, a * .25, h * .8, a * .6, h * .3, H[5], .45);
        line(c, cc => { cc.moveTo(-a * .8, b * 1.2); cc.quadraticCurveTo(0, b * 2.6 + 10, a * .8, b * 1.2); }, alpha(H[0], .75), 9);
      });
      line(c, bowl, INK, 7);
      // The hollow: dark brown inside, the far inner wall catching a little light.
      fill(c, lens, radial(c, 0, b * .6, a * .9, [[0, H[7]], [.6, H[6]], [1, H[5]]]));
      clip(c, lens, () => line(c, cc => { cc.moveTo(-a * .85, -b * .2); cc.quadraticCurveTo(0, -b * 2.0, a * .85, -b * .2); }, alpha(H[3], .8), 12));
      line(c, lens, INK, 6);
      c.restore();
    },
    lip() {
      enter();
      line(c, cc => { cc.moveTo(-a * .96, -b * .5); cc.quadraticCurveTo(0, b * 2.2, a * .96, -b * .5); }, INK, 18);
      line(c, cc => { cc.moveTo(-a * .94, -b * .5); cc.quadraticCurveTo(0, b * 2.2, a * .94, -b * .5); }, H[1], 10);
      c.restore();
    },
    at: (u, v) => [x + Math.cos(rot) * u * a - Math.sin(rot) * v, y + Math.sin(rot) * u * a + Math.cos(rot) * v]
  };
}
const rect = (x, y, w, h) => c => c.rect(x, y, w, h);
// Big amber eyes: a dark pupil, two highlights and lashes on the outer corner.
function eye(c, x, y, rx, ry, { look = -1, outer = 1 } = {}) {
  fill(c, ellipse(x, y, rx * 1.12, ry * 1.06), '#ffffff');
  fill(c, ellipse(x + look * rx * .12, y + ry * .05, rx * .86, ry * .9), radial(c, x + look * rx * .1, y + ry * .35, ry, [[0, R.eye[1]], [.4, R.eye[2]], [.75, R.eye[3]], [1, R.eye[4]]]));
  fill(c, ellipse(x + look * rx * .16, y + ry * .1, rx * .42, ry * .52), R.eye[5]);
  fill(c, ellipse(x - rx * .18, y - ry * .28, rx * .3, ry * .24, -.4), '#ffffff');
  fill(c, ellipse(x + rx * .3, y + ry * .36, rx * .14, ry * .11), '#ffffff');
  line(c, ellipse(x, y, rx * 1.12, ry * 1.06), INK, 6);
  line(c, cc => { cc.moveTo(x - rx * 1.2, y - ry * .3); cc.quadraticCurveTo(x - rx * .1, y - ry * 1.4, x + rx * 1.22, y - ry * .3); }, INK, 10);
  const ox = x + outer * rx * 1.16, oy = y - ry * .4;
  for (const [k, len, ang] of [[0, 20, -.3], [.26, 16, -.9]]) { const px = ox - outer * rx * k * 1.2, py = oy - ry * k, a = outer > 0 ? ang : Math.PI - ang; line(c, cc => { cc.moveTo(px, py); cc.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); }, INK, 7); }
}
// A sturdy leg (one width per joint) with a brown sock whose top is a zigzag, ending in a three-toed paw.
function pawLimb(c, joints, widths, ground, { far = false, dir = -1, skip = 4, pad = false } = {}) {
  const steps = 12, tb = tube(joints, widths, 0, steps), C = R.coat, P = R.paw, lift = far ? 1 : 0, n = tb.mid.length - 1;
  fill(c, tb.path, C[3 + lift]);
  clip(c, tb.path, () => {
    fill(c, poly([...tb.right, ...[...tb.mid].reverse()]), alpha(C[5 + lift], .65));
    line(c, polyline(tb.left.slice(2, -2).map((p, i) => [p[0] + (tb.mid[i + 2][0] - p[0]) * .2, p[1] + (tb.mid[i + 2][1] - p[1]) * .2])), alpha(C[1 + lift], .8), 10);
    // The sock: from two thirds down, its top edge a zigzag of three points.
    const i0 = Math.round(n * .62), l = tb.left[i0], r = tb.right[i0], zig = [];
    for (let k = 0; k <= 6; k++) { const t = k / 6, up = k % 2 ? -28 : 6; zig.push([l[0] + (r[0] - l[0]) * t, l[1] + (r[1] - l[1]) * t + up]); }
    const sock = poly([...zig, [r[0] + 40, r[1] + 400], [l[0] - 40, l[1] + 400]]);
    fill(c, sock, linear(c, l[0], 0, r[0], 0, [[0, P[1 + lift]], [.55, P[2 + lift]], [1, P[3 + lift]]]));
    line(c, polyline(zig), P[4], 6);
  });
  tubeSides(c, tb, INK, 7, skip);
  // Paw: a rounded foot leaning toward dir, three toes divided at the front.
  const end = tb.mid.at(-1), w = widths.at(-1) * 1.35, x = end[0] + dir * w * .1, y = ground, hgt = Math.max(54, ground - end[1] + 26);
  const foot = smoothPath([[x - w * .48, y - hgt], [x + w * .48, y - hgt], [x + w * (dir > 0 ? .7 : .55), y - hgt * .45], [x + w * (dir > 0 ? .66 : .5), y], [x - w * (dir < 0 ? .66 : .5), y], [x - w * (dir < 0 ? .7 : .55), y - hgt * .45]]);
  fill(c, foot, linear(c, x - w / 2, 0, x + w / 2, 0, [[0, P[1 + lift]], [.5, P[2 + lift]], [1, P[3 + lift]]]));
  clip(c, foot, () => {
    for (const k of [-.2, .2]) { const tx = x + dir * w * .12 + k * w; line(c, cc => { cc.moveTo(tx, y - hgt * .42); cc.quadraticCurveTo(tx + dir * 3, y - hgt * .15, tx, y + 2); }, P[4], 6); }
    soft(c, x - w * .2, y - hgt * .7, w * .3, hgt * .2, P[0], .6);
    if (pad) { fill(c, ellipse(x, y - hgt * .38, w * .3, hgt * .22), R.blush[2]); fill(c, ellipse(x - w * .06, y - hgt * .44, w * .1, hgt * .07), alpha('#ffffff', .6)); }
  });
  line(c, foot, INK, 7);
  return tb;
}
// The tail: a thick brown root-like curl, ringed, tapering to its tip.
function tail(c, pts, w0, w1) {
  const tb = tube(pts, w0, w1, 12, t => 1 - Math.pow(1 - t, 1.4)), P = R.paw;
  fill(c, tb.path, P[2]);
  clip(c, tb.path, () => {
    fill(c, poly([...tb.left, ...[...tb.mid].reverse()]), P[1]);
    line(c, polyline(tb.left.slice(2)), alpha(P[0], .8), 7);
    for (let i = 8; i < tb.mid.length - 4; i += 7) { const a = tb.left[i], b = tb.right[i], m = tb.mid[i], q = tb.mid[Math.min(tb.mid.length - 1, i + 2)]; line(c, cc => { cc.moveTo(a[0], a[1]); cc.quadraticCurveTo(m[0] + (q[0] - m[0]) * 1.2, m[1] + (q[1] - m[1]) * 1.2, b[0], b[1]); }, P[4], 6); }
  });
  tubeSides(c, tb, INK, 7, 3);
}

// ── Front view: facing left, the head turned three-quarters toward the viewer.
function front(c) {
  const ground = 1118;
  // The tail curls up behind the rump; the far legs stand behind the body.
  tail(c, [[960, 742], [1030, 716], [1066, 650], [1052, 594], [1008, 576]], 84, 24);
  pawLimb(c, [[560, 860], [566, 960], [570, 1040], [572, 1080]], [104, 90, 80, 76], ground - 14, { far: true });
  pawLimb(c, [[790, 880], [776, 966], [764, 1030], [760, 1070]], [116, 92, 80, 76], ground - 18, { far: true });
  // Body: long and sturdy, the chest and belly pale.
  const body = smoothPath([[300, 724], [420, 670], [600, 660], [780, 664], [930, 690], [1004, 750], [1020, 830], [984, 904], [898, 934], [760, 930], [620, 924], [480, 914], [360, 880], [286, 820]]);
  shade(c, body, { x: 650, y: 800, rx: 360, ry: 135 }, R.coat, { base: 3, light: 1, dark: 6, lx: -.4, ly: -.65, rim: { color: R.coat[1], from: .3, to: 1.05, width: 16, alpha: .6 },
    ao: () => { soft(c, 660, 930, 340, 50, R.coat[6], .5); soft(c, 1010, 820, 50, 110, R.coat[6], .4); } });
  clip(c, body, () => {
    fill(c, smoothPath([[300, 800], [420, 840], [600, 880], [800, 890], [960, 880], [990, 980], [300, 980]]), linear(c, 0, 840, 0, 940, [[0, alpha(R.pale[1], .0)], [.3, alpha(R.pale[1], .95)], [1, R.pale[2]]]));
    soft(c, 360, 800, 110, 90, R.pale[1], .9);
    line(c, smoothPath([[840, 720], [880, 790], [870, 870]], false), alpha(R.coat[5], .7), 6);
  });
  // Near legs grow out of the body.
  blendIn(c, cc => pawLimb(cc, [[960, 830], [992, 940], [1004, 1030], [1004, 1080]], [150, 104, 92, 86], ground, { skip: 8 }), [960, 830], [976, 892]);
  blendIn(c, cc => pawLimb(cc, [[330, 820], [300, 930], [268, 1020], [254, 1078]], [140, 108, 94, 88], ground, { skip: 8 }), [330, 820], [312, 884]);
  outlineExcept(c, body, [[300, 900, 70, 40], [990, 900, 80, 40]], INK, 7);
  // The split seed husk on the back, the leaves and stems growing from it, then the near rims.
  const right = husk(c, 812, 556, 176, 28, 150, -.48), left = husk(c, 516, 528, 206, 30, 168, .5);
  right.draw(); left.draw();
  stem(c, [[790, 556], [810, 500], [850, 450], [900, 418]], 28, 22);
  for (const [x0, y0, x1, y1, w, b] of [[780, 560, 726, 474, 64, 10], [816, 552, 896, 494, 66, -10]]) leaf(c, x0, y0, x1, y1, w, { bend: b, tone: 1, veins: 2, outline: 6 });
  right.lip();
  stem(c, [[520, 520], [520, 440], [486, 380], [436, 340]], 30, 24);
  for (const [x0, y0, x1, y1, w, b] of [[500, 524, 420, 430, 70, -12], [540, 518, 616, 420, 70, 12]]) leaf(c, x0, y0, x1, y1, w, { bend: b, tone: 1, veins: 2, outline: 6 });
  left.lip();
  cupFlower(c, 948, 338, 180, .22);
  cupFlower(c, 372, 218, 214, -.1);
  // Neck, the far ear, the head and the near ear hanging over the shoulder.
  blendIn(c, cc => {
    const neck = tube([[440, 790], [380, 730], [320, 690]], [230, 220, 210], 0, 10);
    shade(cc, neck.path, { x: 380, y: 740, rx: 110, ry: 100 }, R.coat, { base: 3, light: 1, dark: 6, lx: -.6, ly: -.4 });
    clip(cc, neck.path, () => soft(cc, 330, 780, 90, 80, R.pale[1], .95));
    tubeSides(cc, neck, INK, 7, 6);
  }, [460, 800], [420, 760]);
  leaf(c, 240, 566, 134, 892, 128, { bend: 32, tone: 1, veins: 4, round: .5 });
  const head = smoothPath([[452, 640], [440, 574], [392, 538], [318, 528], [252, 546], [214, 590], [198, 630], [194, 664], [214, 700], [262, 732], [330, 744], [400, 730], [446, 692]]);
  shade(c, head, { x: 320, y: 640, rx: 130, ry: 110 }, R.coat, { base: 3, light: 1, dark: 6, lx: -.4, ly: -.6, rim: { color: R.coat[1], from: .3, to: 1.05, width: 14, alpha: .7 } });
  clip(c, head, () => {
    fill(c, smoothPath([[196, 640], [250, 646], [320, 680], [380, 700], [400, 760], [190, 760]]), R.pale[1]);
    soft(c, 300, 710, 60, 26, R.pale[3], .4);
    fill(c, ellipse(386, 676, 30, 15, -.2), alpha(R.blush[1], .75));
  });
  line(c, head, INK, 7);
  // The leaf-shaped tuft lying back over the top of the head.
  leaf(c, 300, 556, 432, 548, 64, { bend: -10, tone: 0, veins: 2, outline: 6, round: .8 });
  leaf(c, 290, 560, 372, 520, 50, { bend: -6, tone: 0, veins: 1, outline: 6, round: .8 });
  eye(c, 232, 618, 15, 24, { look: -1, outer: -1 });
  eye(c, 340, 626, 26, 31, { look: -1, outer: 1 });
  const nose = cc => { cc.moveTo(208, 650); cc.quadraticCurveTo(222, 640, 244, 646); cc.quadraticCurveTo(248, 662, 230, 674); cc.quadraticCurveTo(212, 668, 208, 650); cc.closePath(); };
  fill(c, nose, linear(c, 210, 642, 244, 672, [[0, R.paw[1]], [1, R.paw[3]]])); fill(c, ellipse(220, 650, 6, 4, -.3), alpha('#ffffff', .85)); line(c, nose, INK, 5);
  line(c, cc => { cc.moveTo(228, 690); cc.quadraticCurveTo(254, 706, 290, 694); }, INK, 6);
  leaf(c, 438, 594, 552, 918, 136, { bend: -24, tone: 0, veins: 4, round: .5 });
  for (const [x, y, r] of [[150, 340, 14], [620, 230, 12], [1110, 470, 11], [660, 420, 10]]) twinkle(c, x, y, r);
}

// ── Back view: facing right and away, seen from behind and to the left.
function back(c) {
  const ground = 1118;
  // The far ear, the forelegs (farther away, so their paws sit higher) and the neck.
  leaf(c, 1010, 586, 1086, 880, 120, { bend: -26, tone: 2, veins: 4, round: .5 });
  pawLimb(c, [[852, 870], [856, 956], [858, 1016], [858, 1046]], [88, 74, 66, 62], ground - 70, { far: true, dir: 1 });
  pawLimb(c, [[784, 880], [788, 966], [790, 1032], [790, 1064]], [98, 82, 72, 68], ground - 52, { far: true, dir: 1 });
  const neck = tube([[820, 800], [866, 730], [900, 680]], [200, 190, 180], 0, 10);
  shade(c, neck.path, { x: 860, y: 740, rx: 100, ry: 100 }, R.coat, { base: 3, light: 1, dark: 6, lx: -.6, ly: -.4 }); tubeSides(c, neck, INK, 7, 4);
  // The back of the head: the leaf tuft, the pale cheek's edge and a lash on the right.
  const head = smoothPath([[1046, 650], [1040, 590], [1000, 548], [936, 532], [870, 544], [828, 584], [818, 640], [836, 696], [884, 732], [948, 740], [1004, 720], [1038, 690]]);
  shade(c, head, { x: 930, y: 640, rx: 120, ry: 104 }, R.coat, { base: 3, light: 1, dark: 6, lx: -.55, ly: -.6, rim: { color: R.coat[1], from: .3, to: 1.05, width: 14, alpha: .7 } });
  clip(c, head, () => { fill(c, ellipse(1040, 690, 34, 40, .2), R.pale[1]); fill(c, ellipse(1024, 664, 22, 13, .3), alpha(R.blush[1], .7)); });
  line(c, head, INK, 7);
  for (const [len, ang] of [[20, -.45], [16, .1]]) line(c, cc => { cc.moveTo(1040, 618); cc.lineTo(1040 + Math.cos(ang) * len, 618 + Math.sin(ang) * len); }, INK, 7);
  leaf(c, 980, 552, 860, 556, 70, { bend: 10, tone: 0, veins: 2, outline: 6, round: .8 });
  leaf(c, 990, 556, 900, 520, 54, { bend: 6, tone: 1, veins: 1, outline: 6, round: .8 });
  // The far hind leg, then the body with its round rump toward the viewer.
  pawLimb(c, [[540, 890], [546, 976], [548, 1040], [548, 1084]], [124, 98, 88, 84], ground - 10, { far: true, dir: 1, pad: true });
  const body = smoothPath([[250, 806], [300, 724], [420, 684], [580, 674], [740, 684], [856, 722], [898, 790], [880, 868], [800, 918], [660, 934], [520, 936], [380, 928], [290, 886]]);
  shade(c, body, { x: 560, y: 800, rx: 330, ry: 135 }, R.coat, { base: 3, light: 1, dark: 6, lx: -.5, ly: -.65, rim: { color: R.coat[1], from: .2, to: 1.05, width: 16, alpha: .6 },
    ao: () => { soft(c, 580, 934, 320, 50, R.coat[6], .5); soft(c, 890, 800, 50, 100, R.coat[6], .4); soft(c, 480, 800, 80, 110, R.coat[5], .3); } });
  clip(c, body, () => {
    fill(c, smoothPath([[600, 890], [760, 880], [880, 860], [900, 960], [560, 960]]), alpha(R.pale[1], .8));
    line(c, smoothPath([[460, 760], [478, 850], [466, 930]], false), alpha(R.coat[6], .7), 7);
    soft(c, 330, 800, 60, 60, R.pale[1], .6);
  });
  blendIn(c, cc => pawLimb(cc, [[350, 860], [340, 960], [334, 1040], [332, 1100]], [156, 112, 98, 92], ground, { dir: 1, skip: 8, pad: true }), [350, 850], [346, 918]);
  outlineExcept(c, body, [[344, 924, 76, 36]], INK, 7);
  // The near ear, hanging down the near side of the neck.
  leaf(c, 866, 588, 770, 920, 150, { bend: 30, tone: 1, veins: 4, back: true, round: .5 });
  // The split seed husk, from behind: the far half first, then the near half; stems, leaves, rims.
  const far = husk(c, 744, 600, 156, 26, 140, -.5), near = husk(c, 486, 590, 180, 28, 156, .5);
  far.draw(); near.draw();
  stem(c, [[744, 596], [772, 520], [808, 450], [846, 400]], 26, 20);
  for (const [x0, y0, x1, y1, w, b] of [[732, 598, 686, 516, 60, 10], [764, 592, 836, 532, 62, -10]]) leaf(c, x0, y0, x1, y1, w, { bend: b, tone: 1, veins: 2, outline: 6 });
  far.lip();
  stem(c, [[486, 584], [470, 500], [430, 430], [388, 380]], 30, 24);
  for (const [x0, y0, x1, y1, w, b] of [[470, 588, 400, 494, 68, -12], [508, 584, 580, 488, 68, 12]]) leaf(c, x0, y0, x1, y1, w, { bend: b, tone: 1, veins: 2, outline: 6 });
  near.lip();
  cupFlowerBack(c, 858, 314, 176, .18);
  cupFlowerBack(c, 372, 262, 212, -.12);
  // The tail toward the viewer, curling up from the rump.
  tail(c, [[312, 770], [238, 730], [196, 664], [206, 604], [252, 584]], 86, 24);
  for (const [x, y, r] of [[1090, 420, 12], [600, 250, 11], [170, 480, 12], [620, 430, 10]]) twinkle(c, x, y, r);
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
