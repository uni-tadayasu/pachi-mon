#!/usr/bin/env node
'use strict';
/* キラシード (id floravelle, formerly フロラヴェール) — the operator's mythical: a sacred white elephant of spring.
 * Great young-leaf ears, faceted jade tusks, a twin-domed brow crowned with leaves
 * and the flower of creation, a leaf-green saddle cloth embroidered in gold with a
 * petal hem and tassels, engraved gold anklets, and a trunk that carries a sprout.
 *
 * Both views are painted as shapes on a 1200-pixel canvas (soft key light from the
 * upper left, cool bounce light from below, a thin rim light on the far edges,
 * ambient occlusion where forms meet), then reduced to a 300-pixel grid: each cell
 * takes the nearest colour (CIELAB) from hue-shifted ramps of 7–8 tones per material,
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
  skin: ['#fffdf8', '#fbf5eb', '#f3e9db', '#e8d9cc', '#d6c3ba', '#bba5a6', '#968190', '#6f5d70'],
  leaf: ['#f4ffc9', '#d5f597', '#aee172', '#81c962', '#5bab59', '#418c52', '#2f6c48', '#1f4d3a'],
  cloth: ['#dcf5c6', '#acdf9d', '#7cc27e', '#58a26a', '#3f835a', '#2e644b', '#20473b'],
  petal: ['#fffafc', '#ffe8f0', '#ffcadc', '#ffa8c4', '#f582a9', '#d95f8e', '#ad4473', '#7c2f57'],
  gold: ['#fffbe2', '#ffefb2', '#fbd874', '#efbb4c', '#d4973b', '#aa7230', '#7b5126'],
  jade: ['#f2fffb', '#cbf7e8', '#9be7cd', '#69cfae', '#45ad93', '#30887b', '#22655e'],
  eye: ['#ffffff', '#a6dccb', '#559f8e', '#316265', '#1f3142', '#140f22'],
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
const rect = (x, y, w, h) => c => c.rect(x, y, w, h);
const circle = (x, y, r) => c => ell(c, x, y, r, r);
const ellipse = (x, y, rx, ry, rot = 0) => c => ell(c, x, y, rx, ry, rot);
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
// A tapering tube along a spline (trunk, tail, tusks, stems).
function tube(points, w0, w1, steps = 16, ease = t => t) {
  const mid = spline(points, steps), left = [], right = [];
  mid.forEach((p, i) => {
    const a = mid[Math.max(0, i - 1)], b = mid[Math.min(mid.length - 1, i + 1)], ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2;
    const w = (w0 + (w1 - w0) * ease(i / (mid.length - 1))) / 2;
    left.push([p[0] + Math.cos(ang) * w, p[1] + Math.sin(ang) * w]); right.push([p[0] - Math.cos(ang) * w, p[1] - Math.sin(ang) * w]);
  });
  const ring = [...left, ...[...right].reverse()];
  return { mid, left, right, path: poly(ring), width: i => w0 + (w1 - w0) * ease(i / (mid.length - 1)) };
}
// A soft elliptical shadow (occlusion) or light pool: full at the centre, fading to nothing at the rim.
function soft(c, x, y, rx, ry, color, a = .7, rot = 0) {
  c.save(); c.translate(x, y); c.rotate(rot); c.scale(1, ry / rx);
  c.fillStyle = radial(c, 0, 0, rx, [[0, alpha(color, a)], [.55, alpha(color, a * .6)], [1, alpha(color, 0)]]); c.beginPath(); c.arc(0, 0, rx, 0, TAU); c.fill(); c.restore();
}
// Outline the two sides of a tube (not its root), so it grows out of what it joins.
function tubeSides(c, tb, color, width, skip = 4) {
  for (const edge of [tb.left, tb.right]) line(c, cc => edge.slice(skip).forEach((p, i) => i ? cc.lineTo(p[0], p[1]) : cc.moveTo(p[0], p[1])), color, width);
  const a = tb.left.at(-1), b = tb.right.at(-1), m = tb.mid.at(-1), d = [m[0] - tb.mid.at(-2)[0], m[1] - tb.mid.at(-2)[1]], k = Math.hypot(d[0], d[1]) || 1;
  line(c, cc => { cc.moveTo(a[0], a[1]); cc.quadraticCurveTo(m[0] + d[0] / k * 14, m[1] + d[1] / k * 14, b[0], b[1]); }, color, width);
}
// Soft volume shading inside a closed form.
function shade(c, pathFn, box, ramp, { base = 3, light = 1, dark = 5, lx = -.38, ly = -.46, rim = null, ao = null, glow = .55 } = {}) {
  const { x, y, rx, ry } = box, r = Math.max(rx, ry);
  fill(c, pathFn, ramp[base]);
  clip(c, pathFn, () => {
    c.fillStyle = radial(c, x + rx * .55, y + ry * .62, r * 1.25, [[0, alpha(ramp[dark], .95)], [.45, alpha(ramp[dark - 1], .55)], [1, alpha(ramp[dark - 1], 0)]]); c.fillRect(x - rx * 2, y - ry * 2, rx * 4, ry * 4);
    c.fillStyle = radial(c, x + rx * lx, y + ry * ly, r * 1.05, [[0, alpha(ramp[light - 1 < 0 ? 0 : light - 1], glow + .4)], [.35, alpha(ramp[light], glow)], [.7, alpha(ramp[base - 1], glow * .45)], [1, alpha(ramp[base], 0)]]); c.fillRect(x - rx * 2, y - ry * 2, rx * 4, ry * 4);
    if (ao) ao();
    if (rim) { c.lineWidth = rim.width || 14; c.strokeStyle = linear(c, x + rx * (rim.from ?? .2), y, x + rx * (rim.to ?? 1), y + ry * .3, [[0, alpha(rim.color, 0)], [1, alpha(rim.color, rim.alpha ?? .9)]]); c.beginPath(); pathFn(c); c.stroke(); }
  });
}
// A leaf: base → tip, width at its widest, bend curls the midrib. Returns geometry.
function leafShape(x0, y0, x1, y1, width, bend = 0, fat = .8, wave = 0) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len, w = width / 2;
  // Profile: widest early, a drawn-out drip tip, optional gentle waves along the edge.
  const prof = t => Math.sin(Math.PI * Math.pow(t, fat)) * (1 - .12 * t) * (wave ? (1 - .55 * Math.pow(t, 6)) * (1 + wave * Math.sin(t * Math.PI * 7)) : 1);
  const at = (t, side) => { const b = bend * Math.sin(Math.PI * t), s = side * w * prof(t); return [x0 + dx * t + nx * (s + b), y0 + dy * t + ny * (s + b)]; };
  const L = [], Rr = []; for (let i = 0; i <= 32; i++) { L.push(at(i / 32, 1)); Rr.push(at(i / 32, -1)); }
  return { at, mid: t => at(t, 0), path: poly([...L, ...Rr.reverse()]), len, nx, ny, dx, dy };
}
function leaf(c, x0, y0, x1, y1, width, { bend = 0, tone = 0, fat = .8, veins = 4, line: lw = 4, edge = true, back = false, wave = 0 } = {}) {
  const lf = leafShape(x0, y0, x1, y1, width, bend, fat, wave), ramp = R.leaf, t = Math.min(2, tone);
  const half = side => c => { for (let i = 0; i <= 32; i++) { const p = lf.at(i / 32, side); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); } for (let i = 32; i >= 0; i--) { const p = lf.mid(i / 32); c.lineTo(p[0], p[1]); } c.closePath(); };
  fill(c, lf.path, ramp[3 + t]);
  clip(c, lf.path, () => {
    // Light half and shaded half, a glow toward the tip, a darker base.
    fill(c, half(1), linear(c, x0, y0, x1, y1, [[0, ramp[4 + t]], [.55, ramp[2 + t]], [1, ramp[1 + t]]]));
    fill(c, half(-1), linear(c, x0, y0, x1, y1, [[0, ramp[5 + t]], [.6, ramp[4 + t]], [1, ramp[3 + t]]]));
    if (veins) {
      const vc = back ? ramp[1 + t] : ramp[Math.max(0, t)], vw = Math.max(4, width / 26);
      line(c, cc => { for (let i = 1; i <= 30; i++) { const p = lf.mid(i / 31); i === 1 ? cc.moveTo(p[0], p[1]) : cc.lineTo(p[0], p[1]); } }, vc, vw);
      for (let k = 1; k <= veins; k++) {
        const s = .1 + .78 * k / (veins + .5);
        for (const side of [1, -1]) {
          const m = lf.mid(s), e = lf.at(Math.min(.97, s + .16), side), q = lf.at(Math.min(.95, s + .06), side * .55);
          line(c, cc => { cc.moveTo(m[0], m[1]); cc.quadraticCurveTo(q[0], q[1], m[0] + (e[0] - m[0]) * .86, m[1] + (e[1] - m[1]) * .86); }, side > 0 ? ramp[Math.max(0, t)] : ramp[2 + t], Math.max(3, vw * .62));
        }
      }
    }
    if (edge) line(c, cc => { for (let i = 2; i <= 30; i++) { const p = lf.at(i / 32, 1); i === 2 ? cc.moveTo(p[0], p[1]) : cc.lineTo(p[0], p[1]); } }, ramp[Math.max(0, t)], 5);
  });
  if (lw) line(c, lf.path, R.leaf[7], lw);
  return lf;
}
// A five-petal blossom with notched petals, veins and a golden heart.
function blossom(c, x, y, r, rot = 0, { petals = 5, deep = 4, line: lw = 4, heart = true, glow = false } = {}) {
  if (glow) fill(c, circle(x, y, r * 1.55), radial(c, x, y, r * 1.55, [[0, alpha(R.petal[1], .9)], [.6, alpha(R.petal[1], .45)], [1, alpha(R.petal[1], 0)]]));
  for (let i = 0; i < petals; i++) {
    const a = rot + i * TAU / petals, ca = Math.cos(a), sa = Math.sin(a), px = x + ca * r * .5, py = y + sa * r * .5;
    const tip = [x + ca * r * 1.02, y + sa * r * 1.02], side = (s, k) => [x + ca * r * k + -sa * s * r * .44 * Math.sin(Math.PI * Math.min(1, k)), y + sa * r * k + ca * s * r * .44 * Math.sin(Math.PI * Math.min(1, k))];
    const pth = c => { const a0 = side(1, .08), a1 = side(1, .55), a2 = side(1, .92), b2 = side(-1, .92), b1 = side(-1, .55), b0 = side(-1, .08);
      c.moveTo(x + ca * r * .06, y + sa * r * .06); c.quadraticCurveTo(a0[0], a0[1], a1[0], a1[1]); c.quadraticCurveTo(a2[0], a2[1], tip[0] + -sa * r * .1, tip[1] + ca * r * .1);
      c.lineTo(x + ca * r * .9, y + sa * r * .9); c.lineTo(tip[0] - -sa * r * .1, tip[1] - ca * r * .1); c.quadraticCurveTo(b2[0], b2[1], b1[0], b1[1]); c.quadraticCurveTo(b0[0], b0[1], x + ca * r * .06, y + sa * r * .06); c.closePath(); };
    fill(c, pth, R.petal[2]);
    clip(c, pth, () => {
      fill(c, circle(x, y, r * 1.1), radial(c, x, y, r * 1.05, [[0, R.petal[0]], [.35, R.petal[1]], [.75, R.petal[2]], [1, R.petal[deep - 1]]]));
      fill(c, circle(px - sa * r * .12, py + ca * r * .12, r * .42), alpha(R.petal[deep], .55));
      for (const k of [-.18, 0, .18]) line(c, cc => { cc.moveTo(x + ca * r * .22, y + sa * r * .22); cc.lineTo(x + ca * r * .78 + -sa * r * k, y + sa * r * .78 + ca * r * k); }, alpha(R.petal[deep], .7), 3);
    });
    if (lw) line(c, pth, R.petal[7], lw);
  }
  if (heart) {
    fill(c, circle(x, y, r * .3), radial(c, x - r * .06, y - r * .08, r * .3, [[0, R.gold[0]], [.5, R.gold[2]], [1, R.gold[4]]]));
    for (let i = 0; i < 10; i++) { const a = rot + i * TAU / 10 + .3, s = r * (.38 + (i % 2) * .08); line(c, cc => { cc.moveTo(x + Math.cos(a) * r * .18, y + Math.sin(a) * r * .18); cc.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); }, R.gold[4], 3); fill(c, circle(x + Math.cos(a) * s, y + Math.sin(a) * s, r * .055 + 1), R.gold[1]); }
    line(c, circle(x, y, r * .3), R.gold[6], 3);
  }
}
function bud(c, x, y, r, rot = 0) {
  fill(c, ellipse(x, y, r * .62, r, rot), linear(c, x, y - r, x, y + r, [[0, R.petal[1]], [1, R.petal[4]]]));
  line(c, ellipse(x, y, r * .62, r, rot), R.petal[7], 3);
  leaf(c, x, y + r * .8, x - r * .9, y + r * .1, r * .7, { veins: 0, edge: false, line: 3, tone: 1 });
}
function sparkle(c, x, y, r, color = R.gold[0], core = '#ffffff') {
  const star = (s, col) => fill(c, cc => { cc.moveTo(x, y - s); cc.quadraticCurveTo(x + s * .14, y - s * .14, x + s, y); cc.quadraticCurveTo(x + s * .14, y + s * .14, x, y + s); cc.quadraticCurveTo(x - s * .14, y + s * .14, x - s, y); cc.quadraticCurveTo(x - s * .14, y - s * .14, x, y - s); }, col);
  star(r, color); star(r * .45, core);
}
function petalFlake(c, x, y, r, rot) {
  const pth = c => { c.save(); c.translate(x, y); c.rotate(rot); c.moveTo(0, -r); c.quadraticCurveTo(r * .8, -r * .3, 0, r); c.quadraticCurveTo(-r * .8, -r * .3, 0, -r); c.restore(); };
  fill(c, pth, linear(c, x, y - r, x, y + r, [[0, R.petal[1]], [1, R.petal[3]]])); line(c, pth, R.petal[6], 3);
}
// Gold: a band with an engraved leaf scroll and polished highlights.
function goldBand(c, pathFn, box, { engrave = true } = {}) {
  const { x, y, w, h } = box;
  fill(c, pathFn, linear(c, x, y, x, y + h, [[0, R.gold[1]], [.3, R.gold[2]], [.55, R.gold[3]], [.8, R.gold[4]], [1, R.gold[5]]]));
  clip(c, pathFn, () => {
    line(c, cc => { cc.moveTo(x, y + h * .2); cc.lineTo(x + w, y + h * .2); }, alpha(R.gold[0], .9), 3);
    if (engrave) for (let i = 0; i < w / 26; i++) { const sx = x + 8 + i * 26; line(c, cc => { cc.moveTo(sx, y + h * .72); cc.quadraticCurveTo(sx + 8, y + h * .25, sx + 18, y + h * .62); }, R.gold[5], 3); }
  });
  line(c, pathFn, R.gold[6], 4);
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
// A faceted jade tusk along a curve, with a gold collar at its root.
function tusk(c, points, w0, w1, { far = false } = {}) {
  const tb = tube(points, w0, w1, 12, t => Math.pow(t, .8));
  fill(c, tb.path, far ? R.jade[4] : R.jade[3]);
  clip(c, tb.path, () => {
    fill(c, poly([...tb.left, ...[...tb.mid].reverse()]), far ? R.jade[3] : R.jade[2]);
    line(c, cc => tb.mid.forEach((p, i) => i ? cc.lineTo(p[0], p[1]) : cc.moveTo(p[0], p[1])), alpha(R.jade[far ? 2 : 1], .9), 4);
    line(c, cc => tb.left.slice(2, -3).forEach((p, i) => i ? cc.lineTo(p[0] + 3, p[1]) : cc.moveTo(p[0] + 3, p[1])), far ? R.jade[2] : R.jade[0], 4);
  });
  line(c, tb.path, R.jade[6], 4);
  return tb;
}
// A sturdy leg: knee, ankle, round foot, toenails, engraved anklet with a jade stone and a leaf charm.
function leg(c, x, top, bottom, w, { far = false, side = 1, nails = 3 } = {}) {
  const knee = top + (bottom - top) * .48, ankle = bottom - 92, foot = w * 1.1, aw = w * .86;
  const pth = c => { c.moveTo(x - w / 2, top); c.bezierCurveTo(x - w / 2 - 6, knee - 30, x - w / 2 - 8, knee + 20, x - aw / 2, ankle);
    c.bezierCurveTo(x - foot / 2 - 4, bottom - 46, x - foot / 2 - 2, bottom - 8, x - foot / 2 + 16, bottom); c.lineTo(x + foot / 2 - 16, bottom);
    c.bezierCurveTo(x + foot / 2 + 2, bottom - 8, x + foot / 2 + 4, bottom - 46, x + aw / 2, ankle); c.bezierCurveTo(x + w / 2 + 8, knee + 20, x + w / 2 + 6, knee - 30, x + w / 2, top); c.closePath(); };
  const ramp = R.skin, lift = far ? 1 : 0;
  shade(c, pth, { x, y: (top + bottom) / 2, rx: w * .62, ry: (bottom - top) * .55 }, ramp, { base: 2 + lift, light: 1 + lift, dark: 5 + lift, lx: -side * .55, ly: -.3,
    rim: far ? null : { color: R.skin[0], from: side > 0 ? .1 : -.1, to: side > 0 ? 1.1 : -1.1, width: 12, alpha: .7 },
    ao: () => {
      fill(c, rect(x - w, top, w * 2, bottom - top), linear(c, x - side * w * .6, 0, x + side * w * .6, 0, [[0, alpha(ramp[0 + lift], .55)], [.3, alpha(ramp[1 + lift], .25)], [.62, alpha(ramp[3 + lift], 0)], [1, alpha(ramp[5 + lift], .7)]]));
      fill(c, rect(x - w, top, w * 2, 110), linear(c, x, top, x, top + 110, [[0, alpha(R.skin[6], .8)], [1, alpha(R.skin[6], 0)]]));
    } });
  clip(c, pth, () => {
    // Knee creases and skin folds.
    for (const [k, s] of [[-.03, .7], [.035, 1], [.1, .8]]) { const yy = knee + k * (bottom - top) * 2.2; line(c, cc => { cc.moveTo(x - w * .38 * s, yy + 4); cc.quadraticCurveTo(x, yy + 16, x + w * .36 * s, yy); }, ramp[5 + lift], 4); line(c, cc => { cc.moveTo(x - w * .32 * s, yy + 9); cc.quadraticCurveTo(x, yy + 20, x + w * .3 * s, yy + 6); }, ramp[1 + lift], 3); }
    // Foot pad and toenails.
    fill(c, ellipse(x, bottom + 10, foot * .62, 26), alpha(ramp[6], .8));
    for (let i = 0; i < nails; i++) {
      const nx = x + (i - (nails - 1) / 2) * w * .31, ny = bottom - 14;
      fill(c, ellipse(nx, ny, w * .115, 13), linear(c, nx, ny - 13, nx, ny + 13, [[0, ramp[0]], [1, ramp[3 + lift]]]));
      line(c, ellipse(nx, ny, w * .115, 13), ramp[6], 3); fill(c, ellipse(nx - 3, ny - 5, 4, 3), '#ffffff');
    }
  });
  line(c, pth, INK, 5);
  // Anklet.
  const ay = ankle - 4, band = c => { c.moveTo(x - aw / 2 - 6, ay); c.quadraticCurveTo(x, ay + 12, x + aw / 2 + 6, ay); c.lineTo(x + aw / 2 + 6, ay + 26); c.quadraticCurveTo(x, ay + 38, x - aw / 2 - 6, ay + 26); c.closePath(); };
  goldBand(c, band, { x: x - aw / 2 - 6, y: ay, w: aw + 12, h: 34 });
  jadeStone(c, x - side * w * .06, ay + 18, 13, 14);
  if (!far) { line(c, cc => { cc.moveTo(x - side * w * .06, ay + 32); cc.lineTo(x - side * w * .06, ay + 44); }, R.gold[4], 3); leaf(c, x - side * w * .06, ay + 42, x - side * w * .06 - side * 10, ay + 74, 22, { veins: 0, edge: false, line: 3, tone: 1 }); }
}

// ── The saddle cloth: woven green, a gold-embroidered vine border, a pink band with a petal hem, tassels and a jade medallion.
function saddle(c, bodyPath, cloth, hem, medal, { sheen = null } = {}) {
  clip(c, bodyPath, () => {
    fill(c, cloth, R.cloth[3]);
    clip(c, cloth, () => {
      const [x0, x1] = [Math.min(...hem.map(p => p[0])), Math.max(...hem.map(p => p[0]))], top = Math.min(...hem.map(p => p[1])) - 230, bottom = Math.max(...hem.map(p => p[1]));
      // Fold shading (vertical drape) and a weave of fine diagonals.
      for (let i = 0; i < 9; i++) { const x = x0 + (x1 - x0) * (i + .5) / 9; fill(c, rect(x - 18, top, 36, bottom - top + 40), linear(c, x - 18, 0, x + 18, 0, [[0, alpha(R.cloth[5], .0)], [.5, alpha(R.cloth[i % 2 ? 4 : 2], .5)], [1, alpha(R.cloth[5], 0)]])); }
      for (let x = x0 - 300; x < x1 + 300; x += 22) { line(c, cc => { cc.moveTo(x, top); cc.lineTo(x + 260, bottom + 40); }, alpha(R.cloth[2], .22), 3); line(c, cc => { cc.moveTo(x + 260, top); cc.lineTo(x, bottom + 40); }, alpha(R.cloth[5], .18), 3); }
      fill(c, rect(x0 - 40, top, x1 - x0 + 80, 120), linear(c, 0, top, 0, top + 120, [[0, alpha(R.cloth[1], .9)], [1, alpha(R.cloth[1], 0)]]));
      if (sheen) fill(c, circle(sheen[0], sheen[1], 170), radial(c, sheen[0], sheen[1], 170, [[0, alpha(R.cloth[1], .7)], [.5, alpha(R.cloth[2], .35)], [1, alpha(R.cloth[2], 0)]]));
      fill(c, rect(x0 - 40, bottom - 120, x1 - x0 + 80, 160), linear(c, 0, bottom - 120, 0, bottom + 20, [[0, alpha(R.cloth[5], 0)], [1, alpha(R.cloth[5], .55)]]));
      // Embroidered gold vine above the hem.
      const vine = spline(hem.map(([x, y]) => [x, y - 64]), 12);
      line(c, cc => vine.forEach((p, i) => i ? cc.lineTo(p[0], p[1]) : cc.moveTo(p[0], p[1])), R.gold[3], 5);
      vine.forEach((p, i) => { if (i % 6 === 3) { const s = i % 12 === 3 ? 1 : -1; leaf(c, p[0], p[1], p[0] + 14, p[1] + s * 26, 16, { veins: 0, edge: false, line: 0, tone: 0 }); fill(c, leafShape(p[0], p[1], p[0] + 14, p[1] + s * 26, 16).path, alpha(R.gold[2], .95)); } });
      // Pink band along the hem.
      const band = spline(hem.map(([x, y]) => [x, y - 20]), 12);
      line(c, cc => band.forEach((p, i) => i ? cc.lineTo(p[0], p[1]) : cc.moveTo(p[0], p[1])), R.petal[3], 26);
      line(c, cc => band.forEach((p, i) => i ? cc.lineTo(p[0], p[1] - 8) : cc.moveTo(p[0], p[1] - 8)), R.petal[2], 6);
    });
    line(c, cloth, R.cloth[6], 5);
  });
  // Gold cord along the hem, a petal fringe and tassels at both corners.
  const cord = spline(hem, 12);
  line(c, cc => cord.forEach((p, i) => i ? cc.lineTo(p[0], p[1]) : cc.moveTo(p[0], p[1])), INK, 18);
  line(c, cc => cord.forEach((p, i) => i ? cc.lineTo(p[0], p[1]) : cc.moveTo(p[0], p[1])), R.gold[3], 11);
  line(c, cc => cord.forEach((p, i) => i ? cc.lineTo(p[0], p[1] - 2) : cc.moveTo(p[0], p[1] - 2)), R.gold[1], 4);
  for (let i = 4; i < cord.length - 3; i += 7) { const p = cord[i]; blossom(c, p[0], p[1] + 20, 19, i * .7, { heart: false, line: 3, deep: 4 }); fill(c, circle(p[0], p[1] + 20, 6), R.gold[2]); }
  for (const end of [cord[0], cord.at(-1)]) {
    line(c, cc => { cc.moveTo(end[0], end[1]); cc.lineTo(end[0], end[1] + 30); }, R.gold[4], 4);
    fill(c, ellipse(end[0], end[1] + 34, 10, 9), R.gold[2]); line(c, ellipse(end[0], end[1] + 34, 10, 9), R.gold[6], 3);
    const tassel = c => { c.moveTo(end[0] - 9, end[1] + 40); c.lineTo(end[0] + 9, end[1] + 40); c.lineTo(end[0] + 14, end[1] + 92); c.quadraticCurveTo(end[0], end[1] + 100, end[0] - 14, end[1] + 92); c.closePath(); };
    fill(c, tassel, linear(c, end[0] - 14, 0, end[0] + 14, 0, [[0, R.gold[2]], [.5, R.gold[1]], [1, R.gold[4]]]));
    clip(c, tassel, () => { for (let k = -2; k <= 2; k++) line(c, cc => { cc.moveTo(end[0] + k * 4, end[1] + 46); cc.lineTo(end[0] + k * 6, end[1] + 96); }, R.gold[4], 2); });
    line(c, tassel, R.gold[6], 3);
  }
  // Medallion: gold filigree rosette around a large jade.
  const [mx, my] = medal;
  for (let i = 0; i < 12; i++) { const a = i * TAU / 12; fill(c, ellipse(mx + Math.cos(a) * 40, my + Math.sin(a) * 44, 13, 9, a), R.gold[i % 2 ? 2 : 3]); line(c, ellipse(mx + Math.cos(a) * 40, my + Math.sin(a) * 44, 13, 9, a), R.gold[6], 3); }
  fill(c, ellipse(mx, my, 38, 42), radial(c, mx - 10, my - 12, 44, [[0, R.gold[0]], [.5, R.gold[2]], [1, R.gold[4]]])); line(c, ellipse(mx, my, 38, 42), R.gold[6], 4);
  jadeStone(c, mx, my + 2, 25, 29);
  for (const s of [-1, 1]) leaf(c, mx + s * 34, my + 48, mx + s * 78, my + 70, 26, { veins: 0, edge: false, line: 3, tone: 0, bend: s * 4 });
}

// A trunk: wrinkle rings, a paler underside, nostril lips at the tip.
function trunk(c, points, w0, w1, { far = false } = {}) {
  const tb = tube(points, w0, w1, 18, t => 1 - Math.pow(1 - t, 1.25)), ramp = R.skin, lift = far ? 1 : 0;
  fill(c, tb.path, ramp[2 + lift]);
  clip(c, tb.path, () => {
    // The far side in shade, the near side lit, a soft pink underside.
    fill(c, poly([...tb.right, ...[...tb.mid].reverse()]), ramp[3 + lift]);
    fill(c, poly([...tb.right, ...tb.mid.map((p, i) => [p[0] * .4 + tb.right[i][0] * .6, p[1] * .4 + tb.right[i][1] * .6]).reverse()]), ramp[4 + lift]);
    line(c, cc => tb.left.slice(3, -6).forEach((p, i) => i ? cc.lineTo(p[0], p[1]) : cc.moveTo(p[0], p[1])), ramp[0], 10);
    // Rings: dark crease with a light ridge, fading toward the tip.
    let gap = 4;
    // The root fades into the face it grows from.
    const r0 = tb.mid[0], r1 = tb.mid[Math.min(tb.mid.length - 1, 14)];
    fill(c, tb.path, linear(c, r0[0], r0[1], r1[0], r1[1], [[0, ramp[2 + lift]], [.6, alpha(ramp[2 + lift], .6)], [1, alpha(ramp[2 + lift], 0)]]));
    for (let i = 9; i < tb.mid.length - 14; i += gap) {
      const rnd = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1, s0 = .12 + rnd * .22, s1 = .78 + (1 - rnd) * .14, bow = 6 + rnd * 6;
      const at = (t, side) => { const a = tb.left[i], b = tb.right[i]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t + side]; };
      const p0 = at(s0, 0), p1 = at(s1, 0), m = at((s0 + s1) / 2, bow);
      line(c, cc => { cc.moveTo(p0[0], p0[1]); cc.quadraticCurveTo(m[0], m[1], p1[0], p1[1]); }, ramp[5 + lift], 3);
      line(c, cc => { cc.moveTo(p0[0] + 2, p0[1] + 5); cc.quadraticCurveTo(m[0], m[1] + 5, p1[0] - 2, p1[1] + 5); }, alpha(ramp[1], .75), 2);
      gap = 4 + Math.round(rnd * 3);
    }
  });
  tubeSides(c, tb, INK, 5, 5);
  return tb;
}
function eye(c, x, y, rx, ry, { look = -1, outer = 1 } = {}) {
  // White sclera rim, deep iris with a teal ring, pupil, two highlights, lashes and a lower lid.
  fill(c, ellipse(x, y, rx * 1.12, ry * 1.08), R.skin[4]);
  fill(c, ellipse(x, y, rx, ry), radial(c, x + look * rx * .1, y + ry * .25, ry * 1.1, [[0, R.eye[2]], [.45, R.eye[3]], [.75, R.eye[4]], [1, R.eye[5]]]));
  clip(c, ellipse(x, y, rx, ry), () => {
    fill(c, ellipse(x + look * rx * .08, y + ry * .05, rx * .52, ry * .56), R.eye[5]);
    fill(c, ellipse(x + look * rx * .1, y + ry * .58, rx * .7, ry * .32), alpha(R.eye[1], .55));
    fill(c, ellipse(x, y - ry * .95, rx * 1.1, ry * .45), alpha(R.eye[5], .8));
  });
  fill(c, ellipse(x - rx * .3, y - ry * .32, rx * .34, ry * .27, -.4), '#ffffff');
  fill(c, ellipse(x + rx * .34, y + ry * .3, rx * .15, ry * .12), '#ffffff');
  fill(c, circle(x + rx * .05, y - ry * .55, rx * .07), alpha('#ffffff', .9));
  line(c, ellipse(x, y, rx, ry), R.eye[5], 4);
  // Upper lid and lashes.
  line(c, cc => { cc.moveTo(x - rx * 1.15, y - ry * .35); cc.quadraticCurveTo(x - rx * .1, y - ry * 1.45, x + rx * 1.18, y - ry * .3); }, INK, 7);
  // Lashes: three short strokes sweeping up and out from the outer corner of the lid.
  const ox = x + outer * rx * 1.12, oy = y - ry * .4;
  for (const [k, len, ang] of [[0, 18, -.35], [.22, 15, -.9], [.42, 12, -1.35]]) {
    const px = ox - outer * rx * k * 1.3, py = oy - ry * k * 1.05, a = outer > 0 ? ang : Math.PI - ang;
    line(c, cc => { cc.moveTo(px, py); cc.quadraticCurveTo(px + Math.cos(a) * len * .6, py + Math.sin(a) * len * .6 - 3, px + Math.cos(a) * len, py + Math.sin(a) * len); }, INK, 4);
  }
  line(c, cc => { cc.moveTo(x - rx * .7, y + ry * 1.05); cc.quadraticCurveTo(x, y + ry * 1.3, x + rx * .75, y + ry * 1.0); }, R.skin[5], 3);
}

// ── Front view: facing left, the head turned three-quarters toward the viewer.
function front(c) {
  const ground = 1146;
  // Far legs and tail behind the body.
  leg(c, 506, 860, ground - 30, 128, { far: true, side: 1 });
  leg(c, 880, 860, ground - 28, 130, { far: true, side: 1 });
  const tail = tube([[1062, 716], [1104, 778], [1116, 862], [1104, 930]], 30, 15, 12);
  shade(c, tail.path, { x: 1100, y: 830, rx: 30, ry: 120 }, R.skin, { base: 3, light: 2, dark: 6 }); line(c, tail.path, INK, 5);
  goldBand(c, rect(1088, 902, 32, 22), { x: 1088, y: 902, w: 32, h: 22 }, { engrave: false });
  leaf(c, 1104, 920, 1064, 1046, 60, { bend: -10, tone: 1, veins: 3 }); leaf(c, 1106, 922, 1158, 1034, 54, { bend: 10, tone: 2, veins: 3 });
  blossom(c, 1104, 936, 34, .4, { line: 3 });
  // Near legs under the body.
  leg(c, 616, 826, ground, 150, { side: 1 });
  leg(c, 972, 828, ground, 152, { side: 1 });
  // Body: high shoulder, sloping back, round rump.
  const bodyPts = [[580, 640], [700, 556], [860, 540], [1010, 580], [1100, 680], [1104, 800], [1050, 930], [900, 990], [720, 990], [600, 930], [560, 800]];
  const body = smoothPath(bodyPts);
  shade(c, body, { x: 830, y: 770, rx: 290, ry: 230 }, R.skin, { base: 2, light: 1, dark: 5, lx: -.45, ly: -.55, rim: { color: R.skin[0], from: .3, to: 1.05, width: 14, alpha: .55 },
    ao: () => { soft(c, 860, 1000, 330, 120, R.skin[6], .8); soft(c, 600, 790, 110, 230, R.skin[5], .5); soft(c, 1080, 840, 90, 200, R.skin[5], .35); } });
  clip(c, body, () => {
    for (const [x, y, d, s] of [[612, 860, 1, 1], [636, 892, 1, .8], [1030, 860, -1, 1], [1010, 896, -1, .8], [880, 960, 1, .9], [760, 962, -1, .7]]) {
      line(c, cc => { cc.moveTo(x, y); cc.quadraticCurveTo(x + d * 30 * s, y - 24 * s, x + d * 56 * s, y - 14 * s); }, R.skin[5], 4);
      line(c, cc => { cc.moveTo(x + d * 4, y + 7); cc.quadraticCurveTo(x + d * 32 * s, y - 15 * s, x + d * 58 * s, y - 6 * s); }, alpha(R.skin[0], .8), 3);
    }
  });
  line(c, body, INK, 5);
  saddle(c, body, smoothPath([[668, 548], [820, 520], [960, 540], [1050, 600], [1040, 760], [960, 790], [800, 800], [680, 780], [660, 640]]),
    [[680, 786], [770, 806], [870, 808], [960, 796], [1038, 764]], [850, 666], { sheen: [800, 600] });
  // Far ear: flaring out to the left behind the head.
  leaf(c, 336, 470, 140, 700, 238, { bend: -30, tone: 1, veins: 5, back: false, wave: .035 });
  // Near ear: behind the right cheek, over the shoulder.
  const ear = leaf(c, 620, 470, 770, 800, 240, { bend: 34, tone: 0, veins: 5, wave: .035 });
  clip(c, ear.path, () => fill(c, ellipse(632, 500, 70, 90, -.5), radial(c, 632, 500, 90, [[0, alpha(R.petal[2], .75)], [.6, alpha(R.petal[1], .4)], [1, alpha(R.petal[1], 0)]])));
  // Head: twin-domed brow, full cheeks, trunk base.
  const headPts = [[300, 520], [312, 420], [372, 352], [442, 344], [470, 362], [500, 346], [574, 360], [628, 430], [640, 530], [612, 640], [540, 708], [450, 726], [370, 696], [318, 620]];
  const head = smoothPath(headPts);
  shade(c, head, { x: 470, y: 520, rx: 180, ry: 190 }, R.skin, { base: 2, light: 0, dark: 5, lx: -.42, ly: -.5, rim: { color: R.skin[0], from: .3, to: 1.05, width: 14, alpha: .75 },
    ao: () => { soft(c, 560, 712, 170, 80, R.skin[5], .7); soft(c, 330, 520, 60, 150, R.skin[4], .35); } });
  clip(c, head, () => {
    // Brow ridges over the eyes, the twin domes, cheek fullness.
    fill(c, ellipse(420, 420, 70, 40, -.2), alpha(R.skin[0], .9)); fill(c, ellipse(540, 414, 64, 36, .2), alpha(R.skin[1], .9));
    line(c, cc => { cc.moveTo(400, 488); cc.quadraticCurveTo(440, 468, 470, 486); }, R.skin[4], 4);
    line(c, cc => { cc.moveTo(520, 492); cc.quadraticCurveTo(560, 470, 600, 494); }, R.skin[4], 4);
    fill(c, ellipse(368, 640, 64, 44), alpha(R.petal[2], .55)); fill(c, ellipse(588, 640, 70, 46), alpha(R.petal[2], .55));
  });
  line(c, head, INK, 5);
  // Crown of leaves and blossoms, the flower of creation on the brow.
  const crown = [];
  for (let i = 0; i < 15; i++) {
    const a = Math.PI * (1.03 + i * .067), r = 186 + (i % 2) * 8, x = 470 + Math.cos(a) * r * .98, y = 520 + Math.sin(a) * r * .95;
    crown.push([x, y, a]);
  }
  crown.forEach(([x, y, a], i) => { if (i % 2) return; leaf(c, x, y, x + Math.cos(a - 1.1) * 74, y + Math.sin(a - 1.1) * 74 - 10, 42, { bend: 6, tone: 1 + (i % 3 === 0), veins: 2, line: 3 }); });
  crown.forEach(([x, y, a], i) => { if (!(i % 2)) return; leaf(c, x, y, x + Math.cos(a - .7) * 66, y + Math.sin(a - .7) * 66 - 16, 38, { bend: -5, tone: 0, veins: 2, line: 3 }); });
  for (const [x, y, r] of [[318, 448, 22], [594, 392, 22], [546, 356, 18], [632, 452, 16]]) blossom(c, x, y, r, x * .02, { line: 3 });
  for (const [x, y, r, rot] of [[352, 394, 12, -.6], [612, 420, 11, .7]]) bud(c, x, y, r, rot);
  for (const [x, y] of [[380, 372], [520, 344], [456, 340]]) { fill(c, circle(x, y, 6), R.gold[2]); fill(c, circle(x - 2, y - 2, 2.5), R.gold[0]); }
  blossom(c, 434, 382, 76, -.3, { glow: true, line: 4, deep: 5 });
  // Face.
  eye(c, 402, 562, 24, 31, { look: -1, outer: -1 }); eye(c, 544, 574, 28, 37, { look: -1, outer: 1 });
  tusk(c, [[400, 706], [372, 742], [338, 762]], 26, 7, { far: true });
  const tr = trunk(c, [[472, 596], [466, 690], [454, 774], [430, 836], [384, 874], [334, 868], [304, 830], [306, 788], [330, 770]], 118, 46);
  // Nostril lips at the curled tip.
  const tip = tr.mid.at(-1); fill(c, ellipse(tip[0] + 6, tip[1] + 4, 16, 11, -.4), R.skin[5]); line(c, ellipse(tip[0] + 6, tip[1] + 4, 16, 11, -.4), INK, 3); fill(c, ellipse(tip[0] + 8, tip[1] + 6, 6, 4, -.4), R.skin[6]);
  tusk(c, [[546, 716], [520, 770], [478, 806]], 32, 8);
  goldBand(c, poly([[528, 702], [566, 712], [560, 734], [522, 724]]), { x: 522, y: 702, w: 44, h: 32 }, { engrave: false });
  // The sprout held in the curl.
  line(c, cc => { cc.moveTo(326, 772); cc.quadraticCurveTo(316, 726, 334, 690); }, R.leaf[6], 9); line(c, cc => { cc.moveTo(326, 772); cc.quadraticCurveTo(316, 726, 334, 690); }, R.leaf[3], 4);
  leaf(c, 334, 692, 282, 650, 52, { bend: -8, tone: 0, veins: 2, line: 3, fat: .7 }); leaf(c, 334, 692, 388, 656, 50, { bend: 8, tone: 1, veins: 2, line: 3, fat: .7 });
  fill(c, circle(298, 660, 7), alpha('#ffffff', .95)); line(c, circle(298, 660, 7), R.jade[3], 2);
  // Pollen and drifting petals.
  for (const [x, y, r] of [[220, 700, 20], [196, 812, 13], [256, 600, 12], [300, 312, 11], [676, 330, 14]]) sparkle(c, x, y, r);
  for (const [x, y, r, rot] of [[236, 760, 12, .8], [652, 300, 11, -.6]]) petalFlake(c, x, y, r, rot);
}

// ── Back view: facing right, seen from behind and to the left.
function back(c) {
  const ground = 1146;
  // Far legs (the front pair, toward the right) behind the body.
  leg(c, 728, 860, ground - 32, 128, { far: true, side: -1 });
  leg(c, 392, 860, ground - 28, 132, { far: true, side: -1 });
  // Far ear and the trunk beyond the head.
  leaf(c, 900, 470, 1090, 686, 220, { bend: 30, tone: 2, veins: 5, back: true, wave: .035 });
  const tr = trunk(c, [[924, 660], [976, 742], [1036, 772], [1086, 730], [1080, 668]], 84, 36, { far: true });
  leaf(c, 1080, 672, 1126, 618, 48, { bend: 7, tone: 0, veins: 2, line: 3, fat: .7 });
  // Near legs: the hind pair in front.
  leg(c, 372, 826, ground, 156, { side: -1 });
  leg(c, 676, 826, ground, 150, { side: -1 });
  // Body from behind.
  const bodyPts = [[280, 700], [340, 590], [480, 540], [640, 548], [790, 600], [840, 700], [830, 820], [770, 940], [600, 990], [420, 990], [300, 930], [258, 820]];
  const body = smoothPath(bodyPts);
  shade(c, body, { x: 560, y: 770, rx: 300, ry: 230 }, R.skin, { base: 2, light: 1, dark: 5, lx: -.5, ly: -.5, rim: { color: R.skin[0], from: .2, to: 1.05, width: 14, alpha: .55 },
    ao: () => { soft(c, 560, 1000, 330, 120, R.skin[6], .8); soft(c, 820, 800, 100, 220, R.skin[5], .45); } });
  clip(c, body, () => {
    // The rump faces the viewer: a soft cleft and creases.
    line(c, cc => { cc.moveTo(330, 640); cc.quadraticCurveTo(300, 770, 344, 900); }, R.skin[4], 5);
    line(c, cc => { cc.moveTo(338, 646); cc.quadraticCurveTo(310, 772, 352, 898); }, alpha(R.skin[0], .9), 3);
    for (const [x, y, d, s] of [[392, 868, -1, 1], [410, 900, -1, .8], [726, 860, 1, 1], [712, 896, 1, .8], [560, 962, 1, .8]]) {
      line(c, cc => { cc.moveTo(x, y); cc.quadraticCurveTo(x + d * 30 * s, y - 24 * s, x + d * 56 * s, y - 14 * s); }, R.skin[5], 4);
      line(c, cc => { cc.moveTo(x + d * 4, y + 7); cc.quadraticCurveTo(x + d * 32 * s, y - 15 * s, x + d * 58 * s, y - 6 * s); }, alpha(R.skin[0], .8), 3);
    }
  });
  line(c, body, INK, 5);
  saddle(c, body, smoothPath([[336, 600], [460, 540], [620, 546], [770, 600], [790, 760], [700, 792], [540, 800], [390, 786], [330, 700]]),
    [[346, 786], [440, 806], [560, 810], [670, 798], [780, 764]], [560, 668], { sheen: [540, 596] });
  // Tail toward the viewer on the left, with its cuff and tuft.
  const tail = tube([[318, 690], [276, 730], [234, 790], [212, 866], [214, 934]], 34, 16, 12);
  shade(c, tail.path, { x: 240, y: 820, rx: 40, ry: 130 }, R.skin, { base: 2, light: 1, dark: 5 });
  clip(c, tail.path, () => fill(c, circle(318, 690, 60), radial(c, 318, 690, 60, [[0, R.skin[2]], [.6, alpha(R.skin[2], .7)], [1, alpha(R.skin[2], 0)]])));
  tubeSides(c, tail, INK, 5, 6);
  goldBand(c, rect(198, 904, 34, 22), { x: 198, y: 904, w: 34, h: 22 }, { engrave: false });
  leaf(c, 214, 922, 166, 1050, 62, { bend: -10, tone: 1, veins: 3 }); leaf(c, 216, 924, 266, 1046, 56, { bend: 10, tone: 2, veins: 3 });
  blossom(c, 214, 940, 36, .2, { line: 3 });
  // Near ear (its back), hanging beside the head over the shoulder.
  leaf(c, 724, 486, 636, 810, 214, { bend: -26, tone: 1, veins: 5, back: true, wave: .035 });
  // Head from behind, turned right.
  const headPts = [[650, 520], [660, 420], [720, 360], [800, 344], [868, 356], [930, 410], [960, 500], [948, 600], [900, 680], [820, 716], [730, 700], [670, 630]];
  const head = smoothPath(headPts);
  shade(c, head, { x: 810, y: 530, rx: 170, ry: 180 }, R.skin, { base: 2, light: 1, dark: 5, lx: -.5, ly: -.55, rim: { color: R.skin[0], from: .2, to: 1.05, width: 14, alpha: .75 },
    ao: () => { soft(c, 740, 700, 150, 80, R.skin[5], .7); } });
  clip(c, head, () => {
    fill(c, ellipse(760, 420, 80, 44, .1), alpha(R.skin[0], .9));
    line(c, cc => { cc.moveTo(700, 470); cc.quadraticCurveTo(760, 440, 820, 452); }, R.skin[4], 4);
    fill(c, ellipse(912, 640, 50, 34), alpha(R.petal[2], .5));
  });
  line(c, head, INK, 5);
  eye(c, 924, 548, 18, 26, { look: 1, outer: -1 });
  tusk(c, [[930, 706], [960, 748], [984, 778]], 26, 7);
  // Crown from behind and the flower rising over the brow.
  const crown = [];
  for (let i = 0; i < 15; i++) { const a = Math.PI - Math.PI * (1.03 + i * .067), r = 178 + (i % 2) * 8; crown.push([806 + Math.cos(a) * r * .98, 516 - Math.abs(Math.sin(a)) * r * .93, a]); }
  crown.forEach(([x, y, a], i) => { if (i % 2) return; const d = -a + 1.1 + Math.PI; leaf(c, x, y, x - Math.cos(d) * 74, y - Math.abs(Math.sin(d)) * 74 - 10, 42, { bend: -6, tone: 1 + (i % 3 === 0), veins: 2, line: 3 }); });
  crown.forEach(([x, y, a], i) => { if (!(i % 2)) return; const d = -a + .7 + Math.PI; leaf(c, x, y, x - Math.cos(d) * 66, y - Math.abs(Math.sin(d)) * 66 - 16, 38, { bend: 5, tone: 0, veins: 2, line: 3 }); });
  for (const [x, y, r] of [[952, 452, 20], [682, 392, 22], [730, 356, 17], [650, 456, 16]]) blossom(c, x, y, r, x * .02, { line: 3 });
  for (const [x, y, r, rot] of [[922, 396, 12, .6], [664, 420, 11, -.7]]) bud(c, x, y, r, rot);
  for (const [x, y] of [[896, 372], [758, 344], [820, 340]]) { fill(c, circle(x, y, 6), R.gold[2]); fill(c, circle(x - 2, y - 2, 2.5), R.gold[0]); }
  blossom(c, 884, 372, 66, .2, { glow: true, line: 4, deep: 5 });
  for (const [x, y, r] of [[1060, 560, 16], [1140, 520, 13], [1168, 410, 12], [984, 300, 12]]) sparkle(c, x, y, r);
  petalFlake(c, 1110, 470, 12, .5);
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
