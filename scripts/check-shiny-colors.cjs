#!/usr/bin/env node
'use strict';
/* Every species has its own shiny coat: unique hue turn × style per dex entry,
 * never close to the normal colours, and neighbouring entries far apart. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const context = vm.createContext({ console });
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc=|application\/ld\+json/.test(m[1])) continue;
  vm.runInContext(m[2], context); if (context.LT?.Engine) break;
}
const art = fs.readFileSync(path.join(root, 'creature-art.js'), 'utf8');
const start = art.indexOf('  const SHINY_STYLES='), end = art.indexOf('  function alternate(source,id){', start);
assert(start > 0 && end > start, 'shinyPalette exists before alternate()');
vm.runInContext(art.slice(start, end) + '\nglobalThis.shinyPalette=shinyPalette;', context);
const { shinyPalette, LT } = context, ids = Object.keys(LT.DATA.species);
assert.equal(ids.length, 256);
const seen = new Map(), circular = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
ids.forEach((id, index) => {
  const p = shinyPalette(id), key = `${p.hueStep}:${p.style}`;
  assert.equal(p.index, index);
  assert(!seen.has(key), `${id} shares a shiny coat with ${seen.get(key)}`); seen.set(key, id);
  assert(p.turn >= 50 && p.turn <= 310, `${id}: hue turn ${p.turn} must stay far from the normal colours`);
  assert(p.saturation > 0 && p.brightness > 0);
  if (index) { const prev = shinyPalette(ids[index - 1]); assert(circular(p.turn, prev.turn) >= 60 || p.style !== prev.style, `${id} vs ${ids[index - 1]}: neighbours look alike`); }
});
// Evolution families: every member differs from every other member.
const families = new Map();
for (const id of ids) { let rootId = id; for (let guard = 0; guard < 6; guard++) { const parent = ids.find(other => LT.DATA.species[other].evolvesTo === rootId); if (!parent) break; rootId = parent; } if (!families.has(rootId)) families.set(rootId, []); families.get(rootId).push(id); }
for (const [rootId, members] of families) assert.equal(new Set(members.map(id => { const p = shinyPalette(id); return `${p.hueStep}:${p.style}`; })).size, members.length, `family ${rootId}`);
console.log(JSON.stringify({ ok: true, species: ids.length, uniqueCoats: seen.size, families: families.size }));
