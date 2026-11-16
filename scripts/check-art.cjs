#!/usr/bin/env node
'use strict';

// Offline rendering regression checks. Install @napi-rs/canvas or set CANVAS_MODULE.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const settle = async () => {
  global.gc?.();
  // Native finalizers run after the current JS turn. GC alone inside a long
  // synchronous rendering loop leaves native pixel buffers pending release.
  await new Promise(setImmediate);
  global.gc?.();
  await new Promise(setImmediate);
};
const progress = async label => { await settle(); console.log(`${label} (RSS ${Math.round(process.memoryUsage().rss / 1048576)} MiB)`); };
let canvas;
for (const name of [process.env.CANVAS_MODULE, '@napi-rs/canvas', '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'].filter(Boolean)) {
  try { canvas = require(name); break; } catch (_) {}
}
assert(canvas, 'Install @napi-rs/canvas or set CANVAS_MODULE to its module path.');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m, i) => ({
  attrs: m[1], code: m[2], filename: `index.html:script-${i + 1}`,
  source: /\bsrc=["']([^"']+)["']/.exec(m[1])?.[1],
}));
let syntaxCount = 0;
for (const script of scripts) {
  if (/application\/ld\+json/.test(script.attrs)) JSON.parse(script.code);
  else {
    const code = script.source ? fs.readFileSync(path.join(root, script.source.split('?')[0]), 'utf8') : script.code;
    new vm.Script(code, { filename: script.source || script.filename });
    syntaxCount++;
  }
}

function imageStats(cv) {
  assert(cv && typeof cv.getContext === 'function', 'Expected a rendered canvas');
  const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let opaque = 0, left = cv.width, right = -1, top = cv.height, bottom = -1;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 16) {
    opaque++;
    const px = (i - 3) / 4, x = px % cv.width, y = Math.floor(px / cv.width);
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return { opaque, fraction: opaque / (cv.width * cv.height), left, right, top, bottom,
    hash: crypto.createHash('sha256').update(data).digest('hex') };
}
function visible(cv, label, cutout = false) {
  const stats = imageStats(cv);
  assert(stats.fraction > (cutout ? .05 : .01), `${label}: empty or nearly empty image`);
  if (cutout) assert(stats.fraction < .95, `${label}: expected transparent sprite margins`);
  return stats;
}

async function runtime(mode = 'normal') {
  const imageErrors = [], warnings = [], deferredImages = [], pendingTimeouts = new Set(), events = new Map();
  let lateNotifications = 0;
  class LocalImage extends canvas.Image {
    set src(value) {
      if (value === '') return; // Browser image reset after an intentional load failure.
      const url = new URL(String(value), 'https://example.test/pachi-mon/');
      const relative = decodeURIComponent(url.pathname.replace(/^\/pachi-mon\//, '').replace(/^\//, ''));
      const absolute = path.resolve(root, relative);
      assert(absolute.startsWith(root + path.sep), 'Image path escaped the project');
      // Force asynchronous completion so pre-load cache invalidation is tested.
      const complete = () => new Promise(resolve => {
        const onload = this.onload, onerror = this.onerror;
        this.onload = (...args) => { try { onload?.apply(this, args); } finally { resolve(); } };
        this.onerror = (...args) => { try { onerror?.apply(this, args); } finally { resolve(); } };
        if (mode === 'broken-assets') {
          imageErrors.push(relative);
          this.onerror?.(new Error('Intentional missing-image regression test'));
        } else {
          try { super.src = absolute; } catch (error) { imageErrors.push(relative); this.onerror?.(error); }
        }
      });
      if (mode === 'delayed-assets') deferredImages.push(complete);
      else setImmediate(complete);
    }
    get src() { return super.src; }
  }
  const document = {
    baseURI: 'https://example.test/pachi-mon/', currentScript: null,
    addEventListener(type, listener) { if (!events.has(type)) events.set(type, []); events.get(type).push(listener); },
    dispatchEvent(event) {
      if (event.type === 'pachi-art-ready') lateNotifications++;
      for (const listener of events.get(event.type) || []) listener(event);
    },
    createElement(tag) { assert.equal(tag, 'canvas', `Unexpected element requested in renderer: ${tag}`); return canvas.createCanvas(1, 1); },
  };
  const context = vm.createContext({ document, Image: LocalImage, ImageData: canvas.ImageData,
    URL, Uint8Array, Uint8ClampedArray, Float32Array, Int32Array, ArrayBuffer,
    performance, setImmediate, queueMicrotask, Event: class Event { constructor(type) { this.type = type; } },
    setTimeout(callback, delay, ...args) {
      if (mode === 'delayed-assets' && delay >= 12000) { const token = { callback }; pendingTimeouts.add(token); return token; }
      return setTimeout(callback, delay, ...args);
    },
    clearTimeout(token) { if (!pendingTimeouts.delete(token)) clearTimeout(token); },
    console: { log() {}, warn(...v) { warnings.push(v.map(String).join(' ')); }, error(...v) { warnings.push(v.map(String).join(' ')); } },
    location: { href: document.baseURI },
  });
  context.window = context;
  for (const script of scripts) {
    if (/application\/ld\+json/.test(script.attrs)) continue;
    if (script.source && mode === 'no-modules') continue;
    const code = script.source ? fs.readFileSync(path.join(root, script.source.split('?')[0]), 'utf8') : script.code;
    document.currentScript = { src: new URL(script.source || 'index.html', document.baseURI).href };
    vm.runInContext(code, context, { filename: script.source || script.filename, timeout: 30000 });
    if (code.includes('LT.Art={')) break;
  }
  const LT = context.LT;
  assert(LT?.DATA && LT.Engine && LT.Art, 'Renderer runtime failed to initialize');
  const engine = new LT.Engine(); engine.newGame(LT.DATA.starters[0]);
  const probe = canvas.createCanvas(640, 480);
  LT.Art.world(probe, engine, 0);
  const beforeLoad = imageStats(probe).hash;
  // Expire all startup deadlines without completing any image downloads.
  if (mode === 'delayed-assets') for (const token of [...pendingTimeouts]) token.callback();
  await Promise.race([LT.Art.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('Artwork loading timed out')), 15000).unref())]);
  LT.Art.world(probe, engine, 0);
  const afterLoad = visible(probe, `${mode}: field`).hash;
  return { LT, engine, imageErrors, warnings, beforeLoad, afterLoad,
    async finishDelayedImages() {
      await Promise.all(deferredImages.splice(0).map(complete => complete()));
      LT.Art.world(probe, engine, 0);
      return { hash: imageStats(probe).hash, notifications: lateNotifications };
    },
  };
}

async function main() {
  const { LT, engine, beforeLoad, afterLoad } = await runtime();
  await progress('Base artwork loaded');
  const species = Object.values(LT.DATA.species).filter(s => !s.specialOnly), maps = Object.values(LT.DATA.maps);
  assert.equal(species.length, 260, 'Species count changed');
  assert.equal(maps.filter(m => !m.interior).length, 64, 'Outdoor map count changed');
  assert.equal(maps.filter(m => m.interior).length, 54, 'Interior map count changed');
  assert.equal(new Set(species.map(s => s.shape)).size, 29, 'Expected 29 creature forms');
  assert(LT.CreatureArt.status().futoLoaded, 'Supplied Futo artwork did not load');
  visible(LT.CreatureArt.get('futo'), 'Supplied Futo illustration', true);
  assert(LT.CreatureArt.status().arvelionLoaded, 'Original legendary artwork did not load');
  const legendaryFront=visible(LT.CreatureArt.get('arvelion'), 'Arvelion front', true);
  const legendaryBack=visible(LT.CreatureArt.get('arvelion',true), 'Arvelion back', true);
  assert.notEqual(legendaryFront.hash,legendaryBack.hash,'Arvelion must have separate authored front/back views');
  for (const module of ['CreatureArt', 'TravellerArt', 'FieldArt', 'BattleArt']) assert(LT[module], `${module} did not load`);
  assert.notEqual(beforeLoad, afterLoad, 'The field retained the procedural pre-load cache after artwork became ready');
  // Evolution art is intentionally lazy during startup. Load it explicitly so
  // this comprehensive rendering pass checks the generated views, not fallbacks.
  await LT.CreatureArt.preload(species.filter(s => LT.CreatureArt.lineage(s.id).stage > 0).map(s => s.id), { back: 'both' });
  assert.equal(LT.CreatureArt.status().evolutionLoaded, 8, 'Evolution atlases did not all load');
  await progress(`Evolution artwork loaded; rendering ${species.length} species`);

  const snapshots = { data: JSON.stringify(LT.DATA), state: JSON.stringify(engine.state) };
  const fronts = new Set(), backs = new Set();
  let creatureCount = 0;
  for (const monster of species) {
    const front = visible(LT.CreatureArt.get(monster.id, false), `${monster.id} front`, true);
    const back = visible(LT.CreatureArt.get(monster.id, true), `${monster.id} back`, true);
    assert.notEqual(front.hash, back.hash, `${monster.id}: front and rear artwork are identical`);
    fronts.add(front.hash); backs.add(back.hash);
    for (const rear of [false, true]) {
      const target = canvas.createCanvas(256, 256);
      LT.Art.creature(target, monster.id, { back: rear });
      visible(target, `${monster.id}: integrated creature renderer`, true);
      target.width = target.height = 1;
    }
    if (++creatureCount % 8 === 0) await settle();
    if (creatureCount % 64 === 0) await progress(`Rendered ${creatureCount}/${species.length} species`);
  }
  assert(fronts.size >= 200 && backs.size >= 200, 'Species artwork lost its individual visual variations');

  const kinds = [...new Set(['hero', 'hero-female', ...maps.flatMap(m => (m.npcs || []).map(n => n.kind || 'dialogue'))])].filter(k => k !== 'cache');
  let personCount = 0;
  for (const kind of kinds) for (const direction of ['down', 'left', 'right', 'up']) {
    const hashes = new Set();
    for (const frame of [0, 1, 2]) {
      const sprite = LT.TravellerArt.get(kind, direction, frame, 7);
      assert.equal(sprite?.width, 96, `${kind} ${direction}: unexpected width`);
      assert.equal(sprite?.height, 128, `${kind} ${direction}: unexpected height`);
      hashes.add(visible(sprite, `${kind} ${direction} ${frame}`, true).hash); personCount++;
      if (personCount % 24 === 0) await settle();
    }
    if (kind === 'hero' || kind === 'hero-female') assert(hashes.size > 1, `${direction}: walking animation is static`);
  }

  const counters = {};
  for (const name of ['ground', 'tree', 'building', 'furniture']) {
    const original = LT.FieldArt[name];
    if (!original) continue;
    counters[name] = 0;
    LT.FieldArt[name] = function (...args) { const result = original.apply(this, args); if (result) counters[name]++; return result; };
  }
  let fieldCount = 0;
  await progress('Creature and traveller views passed; rendering maps');
  for (const map of maps) {
    const view = canvas.createCanvas(640, 480);
    const oldGround = counters.ground || 0;
    LT.PixelWorld.clearCache();
    const testEngine = { map, state: { ...engine.state, map: map.id, x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) } };
    LT.Art.world(view, testEngine, 1200, { moving: true, dayPhase: 'day' });
    visible(view, `map ${map.id}`);
    assert((counters.ground || 0) > oldGround, `${map.id}: did not use the new ground artwork`);
    view.width = view.height = 1;
    fieldCount++;
    if (fieldCount % 4 === 0) await settle();
    if (fieldCount % 24 === 0) await progress(`Rendered ${fieldCount}/118 maps`);
  }
  assert(counters.tree > 0, 'No generated tree was rendered');
  assert(counters.building > 0, 'No generated building was rendered');
  assert(counters.furniture > 0, 'No generated furniture was rendered');

  let battleCount = 0;
  await progress('Maps passed; rendering battle views');
  const landscapes = new Set();
  for (const theme of LT.BattleArt.themes) {
    const painted = LT.BattleArt.get(theme, 768, 480);
    assert(painted, `Missing generated battle landscape for ${theme}`);
    const stats = visible(painted, `generated battle ${theme}`);
    assert(stats.fraction > .99, `${theme}: battle landscape has transparent gaps`);
    landscapes.add(stats.hash);
  }
  assert.equal(landscapes.size, LT.BattleArt.themes.length, 'Battle themes reuse identical landscapes');
  for (const theme of new Set(maps.map(m => m.theme))) {
    const view = canvas.createCanvas(768, 480);
    const map = maps.find(m => m.theme === theme);
    const testEngine = { map, state: engine.state, battle: { enemy: engine.makeMonster(species[15].id, 5), activeIndex: 0 } };
    LT.Art.battle(view, testEngine, 1000);
    visible(view, `battle ${theme}`); view.width = view.height = 1; battleCount++; await settle();
  }
  for (const mode of ['single', 'double']) {
    const team = { active: mode === 'single' ? [0] : [0, 1], monsters: species.slice(0, 4).map(s => engine.makeMonster(s.id, 50)) };
    const view = canvas.createCanvas(768, 480);
    LT.PixelSprites.duel(view, { mode, teams: [team, team] }, 0, 1000);
    visible(view, `${mode} online battle renderer`);
    view.width = view.height = 1; await settle();
  }
  assert.equal(JSON.stringify(LT.DATA), snapshots.data, 'Rendering modified gameplay data');
  assert.equal(JSON.stringify(engine.state), snapshots.state, 'Rendering modified the save state');

  console.log(`Artwork rendering complete: ${species.length} species, ${maps.length} maps, people, landscapes, and furniture. Checking fallbacks.`);
  for (const mode of ['broken-assets', 'no-modules']) {
    await progress(`Checking ${mode} fallback`);
    const fallback = await runtime(mode);
    const target = canvas.createCanvas(256, 256);
    for (const back of [false, true]) { fallback.LT.Art.creature(target, species[0].id, { back }); visible(target, `${mode}: creature`, true); }
    for (const facing of ['down', 'left', 'right', 'up']) {
      const person = canvas.createCanvas(96, 128);
      fallback.LT.Art.traveller(person, { facing, size: 128 }); visible(person, `${mode}: traveller ${facing}`, true);
      person.width = person.height = 1;
    }
    target.width = target.height = 1;
    assert.equal(fallback.beforeLoad, fallback.afterLoad, `${mode}: fallback unexpectedly changed after failed loading`);
    if (mode === 'broken-assets') assert(fallback.imageErrors.length > 0, 'Missing-image simulation did not run');
  }
  await progress('Checking delayed artwork recovery');
  const delayed = await runtime('delayed-assets');
  assert.equal(delayed.beforeLoad, delayed.afterLoad, 'Timed-out images should retain playable fallback graphics');
  assert.equal(delayed.LT.CreatureArt.status().loaded, 0, 'Delayed downloads completed before the test released them');
  const recovered = await delayed.finishDelayedImages();
  assert.equal(recovered.notifications, 14, 'Every late successful image, including the legendary atlas, should refresh the display');
  assert.notEqual(recovered.hash, delayed.afterLoad, 'The late artwork left stale world caches on screen');
  assert.equal(delayed.LT.CreatureArt.status().loaded, 4, 'Late creature atlases were not adopted');
  assert.equal(delayed.LT.CreatureArt.status().failed, 0, 'Recovered creature atlases still report failure');
  assert(delayed.LT.CreatureArt.status().arvelionLoaded, 'Late legendary atlas was not adopted');
  visible(delayed.LT.CreatureArt.get('arvelion'), 'Late legendary front recovery', true);
  visible(delayed.LT.CreatureArt.get('arvelion',true), 'Late legendary rear recovery', true);
  assert.equal(delayed.LT.TravellerArt.stats.loaded, 3, 'Late traveller atlases were not adopted');
  visible(delayed.LT.CreatureArt.get(species[0].id), 'Late creature recovery', true);
  visible(delayed.LT.TravellerArt.get('hero'), 'Late traveller recovery', true);
  visible(delayed.LT.FieldArt.tree('village'), 'Late tree recovery', true);
  visible(delayed.LT.BattleArt.get('village', 768, 480), 'Late battle recovery');
  console.log(JSON.stringify({ ok: true, syntaxScripts: syntaxCount, species: species.length, creatureRenders: species.length * 2,
    uniqueFronts: fronts.size, uniqueBacks: backs.size, travellerFrames: personCount, maps: fieldCount,
    battleThemes: battleCount, landscapeArtwork: landscapes.size, onlineModes: 2, fieldArtworkUses: counters, fallbackModes: 2, recoveredLateImages: recovered.notifications }, null, 2));
}
module.exports = { runtime, canvas, imageStats };
if (require.main === module) {
  // V8 cannot see all native canvas allocations. Explicit collection keeps the
  // exhaustive Node harness bounded without altering production renderer caches.
  if (!global.gc) {
    const child = require('node:child_process').spawnSync(process.execPath, ['--expose-gc', __filename], { stdio: 'inherit' });
    process.exitCode = child.status ?? 1;
  } else main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
