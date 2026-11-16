#!/usr/bin/env node
'use strict';

// Real atlas/rendering regressions. No browser or network is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { canvas, imageStats } = require('./check-art.cjs');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const settle = async () => {
  global.gc?.();
  // Native finalizers run after the current JS turn. GC alone inside a long
  // synchronous rendering loop leaves native pixel buffers pending release.
  await new Promise(setImmediate);
  global.gc?.();
  await new Promise(setImmediate);
};
const progress = async label => { await settle(); console.log(`${label} (RSS ${Math.round(process.memoryUsage().rss / 1048576)} MiB)`); };

async function runtime({ mode = 'normal', renderer } = {}) {
  const requests = [], deferred = [], timers = new Set(), events = new Map();
  let notifications = 0;
  class LocalImage extends canvas.Image {
    set src(value) {
      if (!value) return;
      const url = new URL(String(value), 'https://example.test/pachi-mon/');
      const relative = decodeURIComponent(url.pathname.replace(/^\/pachi-mon\//, ''));
      const file = path.resolve(root, relative);
      assert(file.startsWith(root + path.sep), 'Image request escaped the checkout');
      const evolution = relative.includes('creatures-evolution-');
      requests.push(relative);
      const complete = () => new Promise(resolve => {
        const onload = this.onload, onerror = this.onerror;
        this.onload = (...args) => { try { onload?.apply(this, args); } finally { resolve(); } };
        this.onerror = (...args) => { try { onerror?.apply(this, args); } finally { resolve(); } };
        if (evolution && mode === 'failed') this.onerror(new Error('Intentional evolution download failure'));
        else { try { super.src = file; } catch (error) { this.onerror(error); } }
      });
      if (evolution && mode === 'delayed') deferred.push(complete);
      else setImmediate(complete);
    }
    get src() { return super.src; }
  }
  const document = {
    baseURI: 'https://example.test/pachi-mon/', currentScript: null,
    createElement(tag) { assert.equal(tag, 'canvas'); return canvas.createCanvas(1, 1); },
    addEventListener(type, listener) { if (!events.has(type)) events.set(type, []); events.get(type).push(listener); },
    dispatchEvent(event) {
      if (event.type === 'pachi-art-ready') notifications++;
      for (const listener of events.get(event.type) || []) listener(event);
    },
  };
  const context = vm.createContext({ document, Image: LocalImage, ImageData: canvas.ImageData,
    URL, Uint8Array, Uint8ClampedArray, Float32Array, Int32Array, ArrayBuffer, performance, setImmediate, queueMicrotask,
    Event: class Event { constructor(type) { this.type = type; } },
    setTimeout(callback, delay, ...args) {
      if (delay >= 12000) { const token = { callback }; timers.add(token); return token; }
      return setTimeout(callback, delay, ...args);
    },
    clearTimeout(token) { if (!timers.delete(token)) clearTimeout(token); },
    console, location: { href: document.baseURI },
  });
  context.window = context;
  for (const match of scripts) {
    if (/application\/ld\+json/.test(match[1])) continue;
    const source = /\bsrc=["']([^"']+)["']/.exec(match[1])?.[1];
    const file = source?.split('?')[0];
    // Keep the original authored-evolution snapshots as a fallback regression.
    // Dedicated per-species artwork is verified by check-individual-art.cjs.
    if (file === 'individual-creature-art.js' || file === 'assets/creatures-individual-catalog.js') continue;
    const code = file === 'creature-art.js' && renderer ? renderer : file ? fs.readFileSync(path.join(root, file), 'utf8') : match[2];
    document.currentScript = { src: new URL(source || 'index.html', document.baseURI).href };
    vm.runInContext(code, context, { filename: source || 'index.html', timeout: 30000 });
    if (code.includes('LT.Art={')) break;
  }
  const LT = context.LT;
  assert(LT?.Art && LT?.CreatureArt && LT?.Engine, 'Artwork integration failed to initialize');
  await LT.Art.ready;
  return { LT, requests, get notifications() { return notifications; },
    expireDownloads() { for (const token of [...timers]) token.callback(); },
    async completeDownloads() { await Promise.all(deferred.splice(0).map(complete => complete())); },
  };
}

function silhouette(cv) {
  const stats = imageStats(cv);
  assert(stats.fraction > .05 && stats.fraction < .9, 'Sprite must have a visible subject and transparent margins');
  // Normalize the occupied bounds before comparing alpha; scaling/recoloring
  // an old drawing alone must not satisfy the evolution artwork contract.
  const mask = canvas.createCanvas(64, 64), ctx = mask.getContext('2d');
  ctx.drawImage(cv, stats.left, stats.top, stats.right - stats.left + 1, stats.bottom - stats.top + 1, 0, 0, 64, 64);
  const rgba = ctx.getImageData(0, 0, 64, 64).data;
  const result = Uint8Array.from({ length: 4096 }, (_, i) => rgba[i * 4 + 3] >= 128 ? 1 : 0);
  mask.width = mask.height = 1;
  return result;
}
function silhouetteDifference(a, b) {
  let mismatch = 0, union = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) mismatch++; if (a[i] || b[i]) union++; }
  return mismatch / Math.max(1, union);
}
async function unchangedDigest(LT, ids) {
  const hash = crypto.createHash('sha256');
  let checked = 0;
  for (const id of [...ids].sort()) {
    for (const back of [false, true]) {
      hash.update(id + ':' + back + ':');
      hash.update(imageStats(LT.CreatureArt.get(id, back)).hash);
    }
    if (++checked % 8 === 0) await settle();
  }
  return hash.digest('hex');
}
function integrated(LT, id, back = false) {
  const target = canvas.createCanvas(256, 256);
  LT.Art.creature(target, id, { back });
  return target;
}
function integratedStats(LT, id, back = false) {
  const target = integrated(LT, id, back), stats = imageStats(target);
  target.width = target.height = 1;
  return stats;
}

async function main() {
  const run = await runtime(), { LT } = run, art = LT.CreatureArt;
  const species = Object.values(LT.DATA.species);
  const children = new Set(species.map(s => s.evolvesTo).filter(Boolean));
  // The newly created legendary has its own authored atlas and is verified
  // separately; retain the exact pre-existing-form regression snapshot.
  const unchanged = species.filter(s => !children.has(s.id)&&s.id!=='arvelion');
  const evolved = species.filter(s => children.has(s.id));
  assert.equal(species.length, 261);
  assert.equal(evolved.length, 129);
  assert.equal(unchanged.length, 131);
  assert(art.status().arvelionLoaded,'Original legendary atlas did not load');
  assert.notEqual(imageStats(art.get('arvelion')).hash,imageStats(art.get('arvelion',true)).hash,'Legendary rear duplicates front');
  assert.equal(art.status().evolutionRequested, 0, 'Startup must not download all evolution sheets');
  assert(!run.requests.some(x => x.includes('creatures-evolution-')), 'Evolution requests occurred before use');
  const engine = new LT.Engine(); engine.newGame('komori');
  const before = { data: JSON.stringify(LT.DATA), state: JSON.stringify(engine.state) };
  await progress('Checking 131 unchanged original forms');
  const baseline = await unchangedDigest(LT, unchanged.map(s => s.id));
  // Snapshot from the released renderer before the evolution change, covering
  // all 130 normal roots/singles plus the supplied Futo image in both views.
  assert.equal(baseline, '64b1f88864ceec10d046aa281cadefbe4ab191d339c0796609389afda98ed6f0', 'Original forms or Futo were changed by the evolution renderer');
  assert.equal(art.status().evolutionRequested, 0, 'Original forms requested evolution images');
  await progress('Original forms unchanged; checking generated evolution views');

  // Concrete old-data and new-data examples exercise graph depth and preserve
  // lineage even when legacy destination shapes name a different animal.
  for (const [id, rootId, shape, stage] of [
    ['komorion', 'komori', 'sprig', 1],
    ['komorizen', 'komori', 'sprig', 2],
    ['shizunaria', 'shizuku', 'otter', 2],
    ['akehomura', 'hibana', 'fox', 2],
    ['saikaju', 'tanemaru', 'flower', 2],
    ['caelum_3', 'caelum_1', 'cat', 2],
    ['futo', 'futo', 'futo', 0],
  ]) {
    const actual = art.lineage(id);
    assert(actual, `Missing lineage for ${id}`);
    assert.equal(actual.rootId, rootId, `${id}: wrong original form`);
    if (id !== 'futo') assert.equal(actual.shape, shape, `${id}: replaced the original family body`);
    assert.equal(actual.stage, stage, `${id}: wrong evolution stage`);
  }
  const leaf = art.get('komorion');
  assert(leaf, 'An evolution awaiting download must remain visible');
  assert.equal(art.status().evolutionRequested, 1, 'A single front view must request one atlas only');
  await art.preload(evolved.map(s => s.id), { back: 'both' });
  assert.equal(art.status().evolutionLoaded, 8, 'Not all stage/group/view combinations loaded');
  assert.equal(art.status().evolutionFailed, 0);
  assert.equal(run.requests.filter(x => x.includes('creatures-evolution-')).length, 8, 'Shared sheets were downloaded more than once');

  let stages = [0, 0], comparisons = 0, minimumDifference = 1;
  for (const start of unchanged.filter(s => s.evolvesTo)) {
    let previous = start, depth = 0;
    const visited = new Set([start.id]);
    while (previous.evolvesTo) {
      const next = LT.DATA.species[previous.evolvesTo];
      assert(next && !visited.has(next.id), 'Broken or cyclic evolution chain');
      visited.add(next.id); depth++; stages[depth - 1]++;
      const actual = art.lineage(next.id);
      assert.equal(actual.rootId, start.id);
      assert.equal(actual.shape, start.shape);
      assert.equal(actual.depth, depth);
      const views = [];
      for (const back of [false, true]) {
        const image = art.get(next.id, back), prior = art.get(previous.id, back);
        const difference = silhouetteDifference(silhouette(prior), silhouette(image));
        assert(difference > .025, `${previous.id} → ${next.id} (${back ? 'back' : 'front'}): evolution is only recoloring/scaling (${difference})`);
        minimumDifference = Math.min(minimumDifference, difference); comparisons++;
        views.push(sha(silhouette(image)));
        assert(integratedStats(LT, next.id, back).fraction > .05, `${next.id}: integrated sprite vanished`);
      }
      assert.notEqual(views[0], views[1], `${next.id}: rear view duplicates front silhouette`);
      previous = next;
    }
    await settle();
  }
  assert.deepEqual(stages, [83, 46]);
  assert.equal(await unchangedDigest(LT, unchanged.map(s => s.id)), baseline, 'Loading evolution atlases changed original forms');
  assert.equal(JSON.stringify(LT.DATA), before.data, 'Artwork changed species/gameplay data');
  assert.equal(JSON.stringify(engine.state), before.state, 'Artwork changed the save data');
  await progress('All evolution views passed; checking delayed and failed downloads');

  const delayed = await runtime({ mode: 'delayed' });
  const oldHash = integratedStats(delayed.LT, 'komorion').hash;
  const pending = delayed.LT.CreatureArt.preload('komorion', { back: 'both' });
  delayed.expireDownloads(); await pending;
  assert.equal(delayed.LT.CreatureArt.status().evolutionFailed, 2, 'Simulated timeouts were not recorded');
  assert.equal(integratedStats(delayed.LT, 'komorion').hash, oldHash, 'Timeout removed the playable fallback');
  await delayed.completeDownloads();
  assert.equal(delayed.notifications, 2, 'Each late successful view must refresh cached UI artwork');
  assert.equal(delayed.LT.CreatureArt.status().evolutionFailed, 0, 'Recovered images still report failure');
  assert.equal(delayed.LT.CreatureArt.status().evolutionLoaded, 2);
  assert.notEqual(integratedStats(delayed.LT, 'komorion').hash, oldHash, 'Late image did not replace the cached fallback');

  const failed = await runtime({ mode: 'failed' });
  await failed.LT.CreatureArt.preload('komorion', { back: 'both' });
  assert.equal(failed.LT.CreatureArt.status().evolutionFailed, 2);
  const front = integratedStats(failed.LT, 'komorion'), back = integratedStats(failed.LT, 'komorion', true);
  assert(front.fraction > .05 && back.fraction > .05, 'Failed evolution downloads must retain playable sprites');
  assert.notEqual(front.hash, back.hash, 'A failed rear download must not replace it with the front');
  console.log(JSON.stringify({ ok: true, evolvedSpecies: evolved.length, stages, silhouetteComparisons: comparisons,
    minimumSilhouetteDifference: Number(minimumDifference.toFixed(3)), unchangedSpecies: unchanged.length,
    evolutionSheets: 8, startupEvolutionDownloads: 0, lateViewsRecovered: 2, failedViewsWithFallback: 2 }, null, 2));
}

module.exports = { runtime, unchangedDigest };
if (require.main === module) {
  // Native canvas buffers are not reliably reflected in V8 heap pressure.
  // Give this exhaustive Node-only harness explicit collection; browser caches
  // and the renderer's production behavior remain unchanged.
  if (!global.gc) {
    const child = require('node:child_process').spawnSync(process.execPath, ['--expose-gc', __filename], { stdio: 'inherit' });
    process.exitCode = child.status ?? 1;
  } else main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
