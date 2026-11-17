#!/usr/bin/env node
'use strict';
/* Title theme and publisher screen: the recorded 16-bit arrangement is a valid
 * 32 kHz stereo MP3 of the full song; the engine plays it on the title (looped,
 * through the shared mix and volume), stops it for every other scene, falls back
 * to the composed title score when it cannot be loaded, starts by itself where
 * the browser allows and otherwise waits for the first touch; the offline worker
 * keeps it; and every mode from the top menu opens on the black handheld screen
 * with "KASAI SOLUTIONS INC." in white. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// ── The file: MPEG-1 Layer III, 32 kHz, stereo, about 222 s (from the Xing frame count).
const file = path.join(root, 'assets', 'music', 'title-16bit.mp3'), mp3 = fs.readFileSync(file);
assert(mp3.length > 1.5e6 && mp3.length < 4e6, `reasonable size (${mp3.length} bytes)`);
let at = 0; while (!(mp3[at] === 0xff && (mp3[at + 1] & 0xe0) === 0xe0)) at++;
const h = mp3.readUInt32BE(at), version = (h >> 19) & 3, layer = (h >> 17) & 3, rateIndex = (h >> 10) & 3, mode = (h >> 6) & 3;
assert.equal(version, 3, 'MPEG-1'); assert.equal(layer, 1, 'Layer III'); assert.equal(rateIndex, 2, '32 kHz'); assert.notEqual(mode, 3, 'stereo');
const tag = mp3.indexOf('Xing', at) >= 0 ? mp3.indexOf('Xing', at) : mp3.indexOf('Info', at);
assert(tag > at && tag < at + 64, 'Xing/Info header present'); assert(mp3.readUInt32BE(tag + 4) & 1, 'frame count present');
const seconds = mp3.readUInt32BE(tag + 8) * 1152 / 32000;
assert(Math.abs(seconds - 222) < 2, `the whole song (${seconds.toFixed(1)} s)`);

// ── The engine in a small Web Audio world.
const engineSource = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).find(code => code.includes('64 original scores and a bounded Web Audio ensemble'));
assert(engineSource, 'music engine script');
class Param { constructor(v = 0) { this.value = v; this.events = []; } setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; } linearRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); this.value = v; } setTargetAtTime(v, t) { this.events.push(['target', v, t]); this.value = v; } cancelScheduledValues() {} exponentialRampToValueAtTime(v) { this.value = v; } }
class Node { constructor(kind) { this.kind = kind; this.gain = new Param(1); this.frequency = new Param(); this.Q = new Param(); this.detune = new Param(); this.pan = new Param(); this.delayTime = new Param(); this.threshold = new Param(); this.knee = new Param(); this.ratio = new Param(); this.attack = new Param(); this.release = new Param(); this.outputs = []; }
  connect(n) { this.outputs.push(n); return n; } disconnect() { this.outputs = []; } start() {} stop() {} setPeriodicWave() {} }
function world({ resume = 'running', fetchOk = true, playOk = true } = {}) {
  const log = { fetches: [], played: 0, paused: 0, sources: [] };
  class Context { constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'suspended'; this.destination = new Node('destination'); }
    resume() { if (resume === 'never') return new Promise(() => {}); this.state = 'running'; return Promise.resolve(); } suspend() { this.state = 'suspended'; return Promise.resolve(); } close() { this.state = 'closed'; return Promise.resolve(); }
    createGain() { return new Node('gain'); } createOscillator() { return new Node('osc'); } createBiquadFilter() { return new Node('filter'); } createStereoPanner() { return new Node('pan'); }
    createDynamicsCompressor() { return new Node('comp'); } createConvolver() { return new Node('conv'); } createDelay() { return new Node('delay'); } createBufferSource() { return new Node('buf'); } createWaveShaper() { return new Node('shaper'); }
    createPeriodicWave() { return {}; } createBuffer(c, l, r) { const d = Array.from({ length: c }, () => new Float32Array(l)); return { getChannelData: i => d[i], length: l, sampleRate: r }; }
    createMediaElementSource(el) { const n = new Node('media'); n.element = el; log.sources.push(n); return n; } }
  class Audio { constructor() { this.paused = true; this.currentTime = 0; this.loop = false; this.attrs = {}; log.audio = this; }
    setAttribute(k, v) { this.attrs[k] = v; } removeAttribute() {} play() { if (!playOk) return Promise.reject(new Error('NotAllowedError')); this.paused = false; log.played++; return Promise.resolve(); } pause() { this.paused = true; log.paused++; } }
  const sandbox = { console, AudioContext: Context, Audio, matchMedia: () => ({ matches: false }), document: { hidden: false, dispatchEvent() {} }, CustomEvent: class { constructor(t) { this.type = t; } }, navigator: {}, setTimeout, clearTimeout,
    URL: { createObjectURL: () => 'blob:title' }, fetch: async url => { log.fetches.push(url); return fetchOk ? { ok: true, status: 200, blob: async () => ({ size: 1 }) } : { ok: false, status: 404 }; } };
  vm.createContext(sandbox); vm.runInContext(engineSource, sandbox);
  const audio = new sandbox.LT.Audio(); let notes = 0;
  audio.instrument = () => { notes++; }; audio.drum = () => { notes++; };
  return { audio, log, notes: () => notes };
}
const settle = () => wait(20);

(async () => {
  // Title: the recording loops through the shared mix; nothing is synthesized meanwhile.
  let w = world(); await w.audio.setEnabled(true); await settle();
  assert.equal(w.audio.currentId, 'title'); assert(w.audio.group?.recorded, 'the title plays the recording');
  assert.deepEqual(w.log.fetches, ['assets/music/title-16bit.mp3?v=20261117-aishiteirukara'], 'fetched once, same origin');
  assert(w.audio.recording.ready); assert.equal(w.log.audio.loop, true); assert.equal(w.log.audio.attrs.playsinline, ''); assert.equal(w.log.audio.src, 'blob:title');
  assert(w.log.sources[0].outputs[0] === w.audio.recording.gain && w.audio.recording.gain.outputs[0] === w.audio.mix, 'routed into the mix (volume and mute apply)');
  assert.equal(w.log.audio.paused, false); assert.equal(w.audio.recording.gain.gain.value, .5);
  for (let i = 0; i < 20; i++) { w.audio.ctx.currentTime += .1; w.audio.tick(); }
  assert.equal(w.notes(), 0, 'no composed notes over the recording');
  // Another scene stops it (fade, then rewind); the composed music takes over.
  w.audio.setScene({ map: 'village' }); assert.notEqual(w.audio.currentId, 'title'); assert.equal(w.audio.recording.gain.gain.value, 0);
  for (let i = 0; i < 20; i++) { w.audio.ctx.currentTime += .1; w.audio.tick(); }
  assert(w.notes() > 0, 'scene music is synthesized again'); await wait(500);
  assert.equal(w.log.audio.paused, true); assert.equal(w.log.audio.currentTime, 0, 'back to the start for the next title visit');
  w.audio.setScene({ title: true }); assert(w.audio.group.recorded); assert.equal(w.log.audio.paused, false, 'plays again on the title');
  // Music room: the title entry describes the recording.
  const title = w.audio.getTracks()[0];
  assert.equal(title.id, 'title'); assert.match(title.name, /愛しているから（16ビットアレンジ）/); assert.equal(title.recording.seconds, 222);
  // Hidden page: paused; visible again: resumes.
  await w.audio.suspend(); assert.equal(w.log.audio.paused, true); await w.audio.setEnabled(true); await settle(); assert.equal(w.log.audio.paused, false);
  // Muting stops it.
  await w.audio.setEnabled(false); await wait(400); assert.equal(w.log.audio.paused, true);

  // Missing file: the composed title score plays instead.
  w = world({ fetchOk: false }); await w.audio.setEnabled(true); await settle();
  assert(w.audio.recording.failed); assert(!w.audio.group?.recorded);
  for (let i = 0; i < 20; i++) { w.audio.ctx.currentTime += .1; w.audio.tick(); }
  assert(w.notes() > 0, 'fallback title score');

  // Autoplay: where allowed, it starts with no interaction; where blocked, it waits.
  w = world(); assert.equal(await w.audio.tryAutoplay(), true); await settle(); assert(w.audio.enabled && w.audio.group?.recorded && !w.log.audio.paused);
  w = world({ resume: 'never' }); const t0 = Date.now(); assert.equal(await w.audio.tryAutoplay(), false);
  assert(Date.now() - t0 < 1500, 'gives up quickly'); assert.equal(w.audio.enabled, false); assert(w.audio.needsUnlock(), 'the first touch will start it');
  assert(w.log.fetches.length === 1, 'the recording is fetched early, ready for the first touch');
  w = world({ playOk: false }); await w.audio.setEnabled(true); await settle();
  assert(w.audio.recording.blocked && w.audio.needsUnlock(), 'a blocked media element also waits for the first touch');

  // ── The page: autoplay attempt, note, first-touch priming; offline storage.
  for (const needle of ['sound.tryAutoplay().then(updateAudioHint,updateAudioHint)', 'id="title-audio-hint"', "document.addEventListener('pachi-audio-state',updateAudioHint)", 'sound.primeRecording?.();',
    '<link rel="prefetch" href="assets/music/title-16bit.mp3?v=20261117-aishiteirukara">'])
    assert(html.includes(needle), `index.html: ${needle}`);
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert(/const ASSET = \/\\\.\(\?:[^)]*\|mp3\)\$\/i;/.test(sw), 'the offline worker stores mp3 files');

  // ── Publisher screen: every mode from the top menu, black screen, white KASAI SOLUTIONS INC.
  for (const needle of ["$('continue-btn').onclick=()=>storedSave && bootScreen(()=>begin(null,storedSave));", "$('start-btn').onclick=()=>bootScreen(requestNew);",
    "else bootScreen(()=>LT.OnlineUI?.open(),'online');", "el.innerHTML='<span class=\"company-splash-name\">KASAI SOLUTIONS INC.</span>';",
    "const stage=document.querySelector('.game-stage');", 'endBoot(false); closeModal(); updateAll(); save();', "document.getElementById('online-modal')?.addEventListener('close',()=>{if(booting&&!playing)endBoot(true);});"])
    assert(html.includes(needle), `index.html: ${needle}`);
  const css = fs.readFileSync(path.join(root, 'pachi-ui.css'), 'utf8');
  assert(/\.company-splash\{[^}]*position:absolute;inset:0[^}]*background:#000/.test(css), 'black over the whole game screen');
  assert(/\.company-splash-name\{color:#fff/.test(css), 'white text');
  console.log(JSON.stringify({ ok: true, seconds: +seconds.toFixed(1), bytes: mp3.length,
    checks: ['32 kHz stereo MP3 of the whole song', 'recording loops on the title through the shared mix', 'other scenes stop and rewind it', 'music room entry', 'pause on hide, resume, mute', 'composed fallback', 'autoplay where allowed', 'first-touch start where blocked', 'early fetch', 'offline storage', 'publisher screen for continue / new / online', 'black screen, white text'] }));
})().catch(error => { console.error(error); process.exit(1); });
