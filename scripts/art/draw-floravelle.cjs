#!/usr/bin/env node
'use strict';
/* Floravelle — the operator's mythical, redrawn as a sacred white elephant of spring:
 * big young-leaf ears, jade tusks, a leaf crown with the flower of creation on its
 * brow, a leaf-and-petal saddle cloth with gold trim, and a trunk that carries a
 * sprout. Both views are drawn as shapes, reduced to a 224-pixel grid with a fixed
 * palette and a one-pixel outline (the game's pixel-art look), then enlarged 4x.
 *
 *   CANVAS_MODULE=<path>/node_modules/@napi-rs/canvas node scripts/art/draw-floravelle.cjs [out.png] [--preview dir]
 *
 * Writes assets/floravelle.png (front | back, 1792x896). © 2026 KASAI SOLUTIONS INC. */
const fs = require('node:fs'), path = require('node:path');
let canvasModule = null;
for (const name of [process.env.CANVAS_MODULE, '@napi-rs/canvas'].filter(Boolean)) { try { canvasModule = require(name); break; } catch (_) {} }
if (!canvasModule) { console.error('Install @napi-rs/canvas or set CANVAS_MODULE.'); process.exit(1); }
const { createCanvas } = canvasModule;
const ROOT = path.join(__dirname, '..', '..');
const S = 896, GRID = 224, K = S / GRID, TAU = Math.PI * 2;

// ── Palette: every colour the art may use after reduction.
const P = {
  ink: '#3a2a3c',
  ivory0: '#fffaf1', ivory1: '#f3eadc', ivory2: '#ddd0c6', ivory3: '#bcaaa9', ivory4: '#8f7c86',
  leaf0: '#d8f59a', leaf1: '#9ad66e', leaf2: '#62ad5c', leaf3: '#3d7f4c', leaf4: '#295a3c',
  pink0: '#ffe3ec', pink1: '#ffb3cb', pink2: '#f27fa5', pink3: '#c75680',
  gold0: '#fff0b8', gold1: '#f5c95a', gold2: '#cf9437', gold3: '#94622a',
  jade0: '#d9fff0', jade1: '#86e2c0', jade2: '#47ad92', jade3: '#2c786c',
  eye0: '#1f1a2e', eye1: '#3d5a4a', white: '#ffffff', blush: '#f7a8bb'
};
const PALETTE = [...new Set(Object.values(P))].map(hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);

// ── Drawing helpers on the 896-pixel canvas.
function begin(c) { c.beginPath(); }
const ell = (c, x, y, rx, ry, rot = 0) => { c.ellipse(x, y, Math.max(.1, rx), Math.max(.1, ry), rot, 0, TAU); };
function fill(c, pathFn, color) { begin(c); pathFn(c); c.fillStyle = color; c.fill(); }
function stroke(c, pathFn, color = P.ink, width = 5) { begin(c); pathFn(c); c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); }
function part(c, pathFn, color, inside, line = 5) {
  fill(c, pathFn, color);
  if (inside) { c.save(); begin(c); pathFn(c); c.clip(); inside(); c.restore(); }
  if (line) stroke(c, pathFn, P.ink, line);
}
// A smooth curve through points (Catmull-Rom), sampled.
function spline(points, steps = 12) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push([.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        .5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
    }
  }
  out.push(points.at(-1)); return out;
}
// A tapering tube along a spline: returns a closed outline path function.
function tube(points, w0, w1, steps = 14) {
  const line = spline(points, steps), left = [], right = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)], ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2;
    const w = (w0 + (w1 - w0) * (i / (line.length - 1))) / 2;
    left.push([line[i][0] + Math.cos(ang) * w, line[i][1] + Math.sin(ang) * w]); right.push([line[i][0] - Math.cos(ang) * w, line[i][1] - Math.sin(ang) * w]);
  }
  const ring = [...left, ...right.reverse()];
  return { line, left, right: right.reverse(), path: c => { ring.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); } };
}
// A leaf from base to tip; width is the widest span, bend curls the midrib.
function leafPath(x0, y0, x1, y1, width, bend = 0) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len, w = width / 2;
  const at = (t, side) => [x0 + dx * t + nx * (side * w * Math.sin(Math.PI * Math.pow(t, .8)) + bend * Math.sin(Math.PI * t)), y0 + dy * t + ny * (side * w * Math.sin(Math.PI * Math.pow(t, .8)) + bend * Math.sin(Math.PI * t))];
  const L = [], R = [];
  for (let i = 0; i <= 24; i++) { L.push(at(i / 24, 1)); R.push(at(i / 24, -1)); }
  const ring = [...L, ...R.reverse()];
  return { mid: t => [x0 + dx * t + nx * bend * Math.sin(Math.PI * t), y0 + dy * t + ny * bend * Math.sin(Math.PI * t)], edge: at,
    path: c => { ring.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); } };
}
function leaf(c, x0, y0, x1, y1, width, { bend = 0, tone = 1, vein = true, line = 4 } = {}) {
  const lf = leafPath(x0, y0, x1, y1, width, bend), ramp = [P.leaf0, P.leaf1, P.leaf2, P.leaf3, P.leaf4];
  part(c, lf.path, ramp[tone], () => {
    // Shade the far half of the blade, light along the near edge.
    begin(c); for (let i = 0; i <= 24; i++) { const p = lf.edge(i / 24, -1); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); } for (let i = 24; i >= 0; i--) { const p = lf.mid(i / 24); c.lineTo(p[0], p[1]); }
    c.closePath(); c.fillStyle = ramp[Math.min(4, tone + 1)]; c.fill();
    if (vein) {
      stroke(c, cc => { for (let i = 1; i <= 20; i++) { const p = lf.mid(i / 21); i === 1 ? cc.moveTo(p[0], p[1]) : cc.lineTo(p[0], p[1]); } }, ramp[Math.min(4, tone + 2)], Math.max(3, width / 22));
      for (let k = 1; k <= 3; k++) { const t = k / 4.2, m = lf.mid(t); for (const side of [1, -1]) { const e = lf.edge(Math.min(.98, t + .14), side); stroke(c, cc => { cc.moveTo(m[0], m[1]); cc.quadraticCurveTo((m[0] + e[0]) / 2, (m[1] + e[1]) / 2 - 4, m[0] + (e[0] - m[0]) * .78, m[1] + (e[1] - m[1]) * .78); }, ramp[Math.min(4, tone + 2)], Math.max(2.5, width / 30)); } }
    }
  }, line);
  return lf;
}
function blossom(c, x, y, r, rot = 0, { petals = 5, colors = [P.pink0, P.pink1, P.pink2], center = true, line = 4 } = {}) {
  for (let i = 0; i < petals; i++) {
    const a = rot + i * TAU / petals, px = x + Math.cos(a) * r * .55, py = y + Math.sin(a) * r * .55;
    part(c, cc => { cc.save(); cc.translate(px, py); cc.rotate(a); ell(cc, 0, 0, r * .52, r * .4); cc.restore(); }, colors[1], () => {
      fill(c, cc => { cc.save(); cc.translate(px, py); cc.rotate(a); ell(cc, -r * .08, -r * .1, r * .32, r * .2); cc.restore(); }, colors[0]);
      fill(c, cc => { cc.save(); cc.translate(px, py); cc.rotate(a); ell(cc, r * .1, r * .22, r * .45, r * .18); cc.restore(); }, colors[2]);
    }, line);
  }
  if (center) {
    part(c, cc => ell(cc, x, y, r * .3, r * .3), P.gold1, () => fill(c, cc => ell(cc, x - r * .08, y - r * .08, r * .14, r * .14), P.gold0), line);
    for (let i = 0; i < petals; i++) { const a = rot + (i + .5) * TAU / petals; fill(c, cc => ell(cc, x + Math.cos(a) * r * .2, y + Math.sin(a) * r * .2, r * .055, r * .055), P.gold2); }
  }
}
function sparkle(c, x, y, r, color = P.gold0) {
  fill(c, cc => { cc.moveTo(x, y - r); cc.quadraticCurveTo(x + r * .18, y - r * .18, x + r, y); cc.quadraticCurveTo(x + r * .18, y + r * .18, x, y + r); cc.quadraticCurveTo(x - r * .18, y + r * .18, x - r, y); cc.quadraticCurveTo(x - r * .18, y - r * .18, x, y - r); }, color);
}
// A sturdy, slightly tapered leg with a rounded foot, toenails and a gold anklet with a jade stone.
function legPath(x, top, bottom, w) {
  const ankle = w * .84, foot = w * 1.06;
  return c => { c.moveTo(x - w / 2, top); c.bezierCurveTo(x - w / 2 - 4, top + (bottom - top) * .45, x - ankle / 2, bottom - 70, x - ankle / 2, bottom - 46);
    c.bezierCurveTo(x - foot / 2, bottom - 30, x - foot / 2 - 2, bottom - 8, x - foot / 2 + 10, bottom); c.lineTo(x + foot / 2 - 10, bottom);
    c.bezierCurveTo(x + foot / 2 + 2, bottom - 8, x + foot / 2, bottom - 30, x + ankle / 2, bottom - 46); c.bezierCurveTo(x + ankle / 2, bottom - 70, x + w / 2 + 4, top + (bottom - top) * .45, x + w / 2, top); c.closePath(); };
}
function leg(c, x, top, bottom, w, { far = false, nails = 3, side = 1 } = {}) {
  const base = far ? P.ivory2 : P.ivory1, shadow = far ? P.ivory3 : P.ivory2;
  part(c, legPath(x, top, bottom, w), base, () => {
    fill(c, cc => ell(cc, x + side * w * .62, (top + bottom) / 2, w * .48, (bottom - top) * .7), shadow);
    if (!far) fill(c, cc => ell(cc, x - side * w * .34, top + (bottom - top) * .38, w * .1, (bottom - top) * .3), P.ivory0);
    for (const k of [.52, .6]) { const y = top + (bottom - top) * k; stroke(c, cc => { cc.moveTo(x - w * .32, y); cc.quadraticCurveTo(x, y + 9, x + w * .3, y - 2); }, far ? P.ivory4 : P.ivory3, 4); }
    for (let i = 0; i < nails; i++) { const nx = x + (i - (nails - 1) / 2) * w * .3; part(c, cc => ell(cc, nx, bottom - 10, w * .1, 9), far ? P.ivory1 : P.ivory0, null, 3); }
    const ay = bottom - 74;
    part(c, cc => cc.rect(x - w, ay, w * 2, 20), far ? P.gold2 : P.gold1, () => { fill(c, cc => cc.rect(x - w, ay, w * 2, 6), far ? P.gold1 : P.gold0); fill(c, cc => cc.rect(x - w, ay + 14, w * 2, 6), P.gold2); }, 4);
    part(c, cc => ell(cc, x - side * w * .06, ay + 10, 11, 12), far ? P.jade2 : P.jade1, () => fill(c, cc => ell(cc, x - side * w * .06 - 4, ay + 5, 4, 4), P.jade0), 3);
  }, 5);
}
// The saddle cloth: leaf-green, a row of leaves, a gold hem with a petal fringe and a jade emblem.
function saddle(c, bodyPath, top, hemPoints, emblem, lightBand) {
  c.save(); begin(c); bodyPath(c); c.clip();
  part(c, top, P.leaf2, () => {
    fill(c, lightBand, P.leaf1);
    const [x0, x1] = [hemPoints[0][0], hemPoints.at(-1)[0]], n = 5;
    for (let i = 0; i < n; i++) { const x = x0 + (x1 - x0) * (i + .5) / n; leaf(c, x - 8, hemPoints[0][1] - 112 + Math.sin(i * 1.3) * 6, x + 10, hemPoints[0][1] - 26, 42, { bend: i % 2 ? 6 : -6, tone: i % 2 ? 1 : 2, line: 3 }); }
  }, 5);
  c.restore();
  const hem = spline(hemPoints, 10);
  stroke(c, cc => hem.forEach((p, i) => i ? cc.lineTo(p[0], p[1]) : cc.moveTo(p[0], p[1])), P.ink, 16);
  stroke(c, cc => hem.forEach((p, i) => i ? cc.lineTo(p[0], p[1]) : cc.moveTo(p[0], p[1])), P.gold1, 9);
  for (let i = 2; i < hem.length - 1; i += 5) { const p = hem[i]; blossom(c, p[0], p[1] + 15, 16, i * .7, { center: false, line: 3 }); fill(c, cc => ell(cc, p[0], p[1] + 15, 5, 5), P.gold1); }
  const [ex, ey] = emblem;
  part(c, cc => ell(cc, ex, ey, 28, 32), P.gold1, () => fill(c, cc => ell(cc, ex - 6, ey - 8, 18, 20), P.gold0), 5);
  part(c, cc => ell(cc, ex, ey + 2, 17, 21), P.jade1, () => { fill(c, cc => ell(cc, ex + 6, ey + 10, 11, 13), P.jade2); fill(c, cc => ell(cc, ex - 6, ey - 8, 6, 7), P.jade0); }, 4);
}
// The trunk: shaded on one side, a few soft creases.
function trunkPart(c, tb, { far = false } = {}) {
  part(c, tb.path, far ? P.ivory2 : P.ivory1, () => {
    begin(c); tb.right.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
    for (let i = tb.line.length - 1; i >= 0; i--) c.lineTo(tb.line[i][0] * .45 + tb.right[i][0] * .55, tb.line[i][1] * .45 + tb.right[i][1] * .55);
    c.closePath(); c.fillStyle = far ? P.ivory3 : P.ivory2; c.fill();
    for (let i = 12; i < tb.line.length - 20; i += 15) { const a = tb.left[i], b = tb.right[i], m = tb.line[i]; stroke(c, cc => { cc.moveTo(a[0] * .7 + m[0] * .3, a[1] * .7 + m[1] * .3); cc.quadraticCurveTo(m[0] + 3, m[1] + 5, b[0] * .7 + m[0] * .3, b[1] * .7 + m[1] * .3); }, far ? P.ivory4 : P.ivory3, 4); }
  }, 5);
}
function eye(c, x, y, rx, ry) {
  part(c, cc => ell(cc, x, y, rx, ry), P.eye0, () => { fill(c, cc => ell(cc, x + rx * .2, y + ry * .45, rx * .75, ry * .45), P.eye1); fill(c, cc => ell(cc, x - rx * .28, y - ry * .32, rx * .4, ry * .32), P.white); fill(c, cc => ell(cc, x + rx * .36, y + ry * .22, rx * .17, ry * .14), P.white); }, 4);
  stroke(c, cc => { cc.moveTo(x - rx * 1.1, y - ry * .5); cc.quadraticCurveTo(x, y - ry * 1.42, x + rx * 1.15, y - ry * .45); }, P.ink, 6);
}

// ── Front view: facing left, head turned three-quarters toward the viewer.
function front(c) {
  const ground = 860;
  // Far legs and the tail sit behind the body.
  leg(c, 372, 640, ground - 24, 92, { far: true, side: 1 });
  leg(c, 650, 640, ground - 22, 94, { far: true, side: 1 });
  const tail = tube([[796, 540], [828, 584], [836, 646], [826, 700]], 22, 12);
  part(c, tail.path, P.ivory2, null, 5);
  leaf(c, 826, 688, 796, 776, 44, { bend: -8, tone: 1 }); leaf(c, 828, 690, 862, 770, 40, { bend: 8, tone: 2 });
  blossom(c, 826, 700, 28, .4);
  // Near legs, tucked under the body.
  leg(c, 456, 620, ground, 112, { side: 1 });
  leg(c, 724, 622, ground, 114, { side: 1 });
  // Body.
  const body = cc => ell(cc, 586, 570, 226, 168, -.03);
  part(c, body, P.ivory1, () => {
    fill(c, cc => ell(cc, 648, 656, 240, 108, -.05), P.ivory2);
    fill(c, cc => ell(cc, 664, 722, 230, 60), P.ivory3);
    fill(c, cc => ell(cc, 540, 462, 130, 46, -.12), P.ivory0);
    for (const [x, y, d] of [[458, 640, 1], [476, 664, 1], [770, 640, -1], [752, 666, -1]]) stroke(c, cc => { cc.moveTo(x, y); cc.quadraticCurveTo(x + d * 22, y - 18, x + d * 40, y - 12); }, P.ivory3, 4);
  }, 5);
  saddle(c, body, cc => { cc.moveTo(500, 400); cc.bezierCurveTo(580, 384, 680, 388, 750, 428); cc.lineTo(752, 560); cc.bezierCurveTo(690, 586, 580, 590, 508, 572); cc.closePath(); },
    [[508, 572], [570, 588], [640, 590], [700, 582], [754, 560]], [630, 496],
    cc => { cc.moveTo(500, 400); cc.bezierCurveTo(580, 388, 680, 394, 750, 434); cc.lineTo(750, 454); cc.bezierCurveTo(680, 414, 580, 410, 500, 428); cc.closePath(); });
  // Far ear, flaring out to the left behind the head; near ear behind the right cheek.
  leaf(c, 236, 344, 96, 500, 164, { bend: -22, tone: 2 });
  leaf(c, 448, 344, 566, 574, 168, { bend: 24, tone: 1 });
  // Head.
  const head = cc => ell(cc, 326, 410, 146, 136, .04);
  part(c, head, P.ivory1, () => {
    fill(c, cc => ell(cc, 400, 486, 118, 82, .3), P.ivory2);
    fill(c, cc => ell(cc, 276, 338, 98, 50, -.2), P.ivory0);
  }, 5);
  // Leaf crown with small flowers, and the flower of creation on the brow.
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (1.08 + i * .1), x = 326 + Math.cos(a) * 132, y = 392 + Math.sin(a) * 120;
    leaf(c, x, y, x + Math.cos(a - .9) * 52, y + Math.sin(a - .9) * 52 - 8, 30, { bend: 4, tone: i % 2 ? 1 : 2, vein: false, line: 3 });
  }
  for (const [x, y, r] of [[228, 326, 17], [414, 312, 17], [370, 280, 14]]) blossom(c, x, y, r, x * .01, { line: 3 });
  fill(c, cc => ell(cc, 302, 292, 70, 62), 'rgba(255,227,236,.75)');
  blossom(c, 302, 290, 58, -.3);
  // Face.
  eye(c, 268, 414, 19, 25); eye(c, 370, 422, 24, 30);
  fill(c, cc => ell(cc, 236, 470, 24, 13), P.blush); fill(c, cc => ell(cc, 408, 482, 28, 14), P.blush);
  const tusk = (x0, y0, x1, y1, w) => tube([[x0, y0], [(x0 + x1) / 2 - 8, (y0 + y1) / 2 + 6], [x1, y1]], w, 5, 10);
  part(c, tusk(276, 506, 238, 556, 20).path, P.jade2, () => fill(c, cc => ell(cc, 262, 518, 6, 12, .6), P.jade1), 4);
  const trunk = tube([[318, 456], [312, 540], [298, 606], [266, 648], [228, 646], [208, 616], [214, 588]], 72, 30, 12);
  trunkPart(c, trunk);
  part(c, tusk(358, 512, 330, 572, 24).path, P.jade1, () => { fill(c, cc => ell(cc, 342, 546, 6, 18, .4), P.jade2); fill(c, cc => ell(cc, 352, 522, 4, 8, .4), P.jade0); }, 4);
  part(c, cc => cc.rect(348, 506, 20, 10), P.gold1, null, 3);
  // The sprout carried in the curl of the trunk.
  stroke(c, cc => { cc.moveTo(214, 590); cc.quadraticCurveTo(206, 556, 218, 528); }, P.leaf3, 7);
  leaf(c, 218, 530, 180, 496, 40, { bend: -6, tone: 1, vein: false, line: 3 }); leaf(c, 218, 530, 256, 500, 40, { bend: 6, tone: 0, vein: false, line: 3 });
  stroke(c, cc => { cc.moveTo(360, 532); cc.quadraticCurveTo(374, 544, 390, 534); }, P.ink, 5);
  for (const [x, y, r] of [[160, 520, 14], [150, 600, 10], [176, 456, 9]]) sparkle(c, x, y, r);
}

// ── Back view: facing right, seen from behind-left.
function back(c) {
  const ground = 860;
  // Far legs (the front pair, toward the right) behind the body.
  leg(c, 546, 640, ground - 24, 92, { far: true, side: -1 });
  leg(c, 292, 640, ground - 20, 96, { far: true, side: -1 });
  // Far ear and trunk beyond the head (right).
  leaf(c, 690, 350, 820, 500, 160, { bend: 22, tone: 3 });
  const trunk = tube([[700, 486], [738, 552], [784, 572], [820, 534], [814, 490]], 58, 24, 12);
  trunkPart(c, trunk, { far: true });
  leaf(c, 814, 494, 848, 452, 34, { bend: 5, tone: 1, vein: false, line: 3 });
  // Near legs: the hind pair in front, tucked under the body.
  leg(c, 278, 622, ground, 116, { side: -1 });
  leg(c, 506, 620, ground, 110, { side: -1 });
  // Body.
  const body = cc => ell(cc, 414, 568, 228, 170, .03);
  part(c, body, P.ivory1, () => {
    fill(c, cc => ell(cc, 470, 662, 250, 104, .05), P.ivory2);
    fill(c, cc => ell(cc, 450, 726, 236, 60), P.ivory3);
    fill(c, cc => ell(cc, 330, 470, 140, 56, .1), P.ivory0);
    stroke(c, cc => { cc.moveTo(250, 484); cc.quadraticCurveTo(232, 572, 262, 662); }, P.ivory3, 5);
    for (const [x, y, d] of [[292, 650, -1], [306, 676, -1], [540, 644, 1], [528, 670, 1]]) stroke(c, cc => { cc.moveTo(x, y); cc.quadraticCurveTo(x + d * 22, y - 18, x + d * 40, y - 12); }, P.ivory3, 4);
  }, 5);
  saddle(c, body, cc => { cc.moveTo(250, 446); cc.bezierCurveTo(320, 398, 470, 390, 572, 418); cc.lineTo(580, 566); cc.bezierCurveTo(490, 594, 340, 596, 262, 572); cc.closePath(); },
    [[262, 574], [340, 592], [420, 596], [500, 588], [580, 564]], [412, 500],
    cc => { cc.moveTo(250, 446); cc.bezierCurveTo(320, 404, 470, 398, 572, 426); cc.lineTo(572, 446); cc.bezierCurveTo(470, 418, 320, 428, 254, 474); cc.closePath(); });
  // Tail with its leaf tuft, toward the viewer on the left.
  const tail = tube([[214, 540], [168, 586], [146, 650], [150, 706]], 24, 13);
  part(c, tail.path, P.ivory1, () => fill(c, cc => ell(cc, 160, 654, 12, 56, .1), P.ivory2), 5);
  leaf(c, 150, 694, 118, 784, 46, { bend: -8, tone: 1 }); leaf(c, 152, 696, 186, 782, 42, { bend: 8, tone: 2 });
  blossom(c, 150, 706, 30, .2);
  // Near ear from behind (the back of a great leaf), flaring left behind the head.
  const ear = leaf(c, 540, 352, 420, 572, 170, { bend: -22, tone: 2 });
  stroke(c, cc => { for (let i = 1; i <= 20; i++) { const p = ear.mid(i / 21); i === 1 ? cc.moveTo(p[0], p[1]) : cc.lineTo(p[0], p[1]); } }, P.leaf0, 6);
  // Head from behind, turned right.
  const head = cc => ell(cc, 612, 404, 136, 128, -.04);
  part(c, head, P.ivory1, () => { fill(c, cc => ell(cc, 556, 470, 120, 80, -.2), P.ivory2); fill(c, cc => ell(cc, 656, 340, 82, 44, .2), P.ivory0); }, 5);
  eye(c, 716, 410, 13, 19);
  const tusk = tube([[702, 494], [728, 528], [744, 554]], 20, 5, 10);
  part(c, tusk.path, P.jade1, () => fill(c, cc => ell(cc, 724, 522, 5, 11, -.5), P.jade0), 4);
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (1.1 + i * .1), x = 612 + Math.cos(a) * 124, y = 392 + Math.sin(a) * 114;
    leaf(c, x, y, x + Math.cos(a + .9) * 50, y + Math.sin(a + .9) * 50 - 8, 30, { bend: -4, tone: i % 2 ? 2 : 3, vein: false, line: 3 });
  }
  blossom(c, 676, 284, 48, .2, { colors: [P.pink1, P.pink2, P.pink3] });
  for (const [x, y, r] of [[516, 326, 16], [560, 294, 14]]) blossom(c, x, y, r, x * .01, { line: 3 });
  for (const [x, y, r] of [[790, 420, 12], [868, 404, 12]]) sparkle(c, x, y, r);
}

// ── Reduction to the pixel grid: area average, palette, one-pixel outline, 4x enlargement.
function pixelate(src) {
  const sc = src.getContext('2d'), data = sc.getImageData(0, 0, S, S).data;
  const out = new Uint8ClampedArray(GRID * GRID * 4), alpha = new Float32Array(GRID * GRID);
  for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let y = 0; y < K; y++) for (let x = 0; x < K; x++) { const i = ((gy * K + y) * S + gx * K + x) * 4, w = data[i + 3] / 255; r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; a += w; }
    const o = (gy * GRID + gx) * 4, cov = a / (K * K); alpha[gy * GRID + gx] = cov;
    if (cov < .5) continue;
    r /= a; g /= a; b /= a;
    let best = 0, dist = Infinity;
    for (const [i, [pr, pg, pb]] of PALETTE.entries()) { const d = 2 * (r - pr) ** 2 + 4 * (g - pg) ** 2 + 3 * (b - pb) ** 2; if (d < dist) { dist = d; best = i; } }
    out[o] = PALETTE[best][0]; out[o + 1] = PALETTE[best][1]; out[o + 2] = PALETTE[best][2]; out[o + 3] = 255;
  }
  // Outline: every empty cell touching the figure becomes ink.
  const ink = PALETTE.find(([r, g, b]) => `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}` === P.ink), solid = i => out[i * 4 + 3] === 255;
  const edges = [];
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const i = y * GRID + x; if (solid(i)) continue;
    if ((x > 0 && solid(i - 1)) || (x < GRID - 1 && solid(i + 1)) || (y > 0 && solid(i - GRID)) || (y < GRID - 1 && solid(i + GRID))) edges.push(i);
  }
  for (const i of edges) { out[i * 4] = ink[0]; out[i * 4 + 1] = ink[1]; out[i * 4 + 2] = ink[2]; out[i * 4 + 3] = 255; }
  const big = createCanvas(S, S), bc = big.getContext('2d'), small = createCanvas(GRID, GRID), smc = small.getContext('2d');
  const img = smc.createImageData(GRID, GRID); img.data.set(out); smc.putImageData(img, 0, 0);
  bc.imageSmoothingEnabled = false; bc.drawImage(small, 0, 0, S, S);
  return big;
}

async function main() {
  const args = process.argv.slice(2), previewAt = args.indexOf('--preview'), preview = previewAt >= 0 ? args[previewAt + 1] : null;
  const outFile = args.find((a, i) => !a.startsWith('--') && (previewAt < 0 || i !== previewAt + 1)) || path.join(ROOT, 'assets', 'floravelle.png');
  const views = [front, back].map(draw => { const cv = createCanvas(S, S), c = cv.getContext('2d'); draw(c); return cv; });
  const sheet = createCanvas(S * 2, S), shc = sheet.getContext('2d');
  views.map(pixelate).forEach((v, i) => shc.drawImage(v, i * S, 0));
  fs.writeFileSync(outFile, await sheet.encode('png'));
  if (preview) { fs.mkdirSync(preview, { recursive: true }); views.forEach(async (v, i) => fs.writeFileSync(path.join(preview, `vector-${i ? 'back' : 'front'}.png`), await v.encode('png'))); }
  console.log(JSON.stringify({ wrote: outFile, size: [sheet.width, sheet.height], palette: PALETTE.length }));
}
main().catch(error => { console.error(error); process.exit(1); });
