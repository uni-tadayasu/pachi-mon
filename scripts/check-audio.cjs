#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the shipped class, not a copy of the playback state machine. The
// procedural synthesizer is outside these lifecycle tests, so only its graph
// setup and track scheduler are replaced with small observable fakes.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
const source = scripts.find(match => match[1].includes('class LuminaAudio'))?.[1];
assert(source, 'The real inline LuminaAudio script must exist');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

function harness({modern = false, sessionThrows = false, userAgent = 'iPhone', platform = 'iPhone', maxTouchPoints = 5} = {}) {
  const trace = [], media = [], gains = [], switches = [], resumes = [], suspends = [], plays = [];
  let sessionType = 'auto';
  const session = {
    get type() { return sessionType; },
    set type(value) {
      trace.push('session:' + value);
      if (sessionThrows) throw new Error('Audio Session unavailable');
      sessionType = value;
    }
  };
  class FakeAudio {
    constructor(src = '') {
      this.src = src; this.paused = true; this.muted = false; this.volume = 1;
      this.loop = false; this.style = {}; this.attributes = {}; this.pauseCount = 0;
      this.playCount = 0; this.removed = false; this.generation = 0;
      media.push(this);
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    removeAttribute(name) { delete this.attributes[name]; if (name === 'src') this.src = ''; }
    addEventListener() {}
    removeEventListener() {}
    load() {}
    play() {
      this.playCount++; trace.push('play'); this.paused = false;
      const generation = this.generation;
      const next = plays.shift();
      const result = typeof next === 'function' ? next() : next;
      return Promise.resolve(result).then(() => {
        if (generation === this.generation) this.paused = false;
      }, error => { this.paused = true; throw error; });
    }
    pause() { this.pauseCount++; this.generation++; this.paused = true; trace.push('pause'); }
    remove() { this.removed = true; }
  }
  const context = {
    state: 'suspended', currentTime: 12,
    resume() {
      trace.push('resume');
      const next = resumes.shift();
      return Promise.resolve(typeof next === 'function' ? next() : next).then(() => { this.state = 'running'; });
    },
    suspend() {
      trace.push('suspend');
      const next = suspends.shift();
      return Promise.resolve(typeof next === 'function' ? next() : next).then(() => { this.state = 'suspended'; });
    },
    close() { this.state = 'closed'; trace.push('close'); return Promise.resolve(); }
  };
  const appendChild = node => { node.isConnected = true; return node; };
  const document = {
    hidden: false,
    body: {appendChild, append: appendChild},
    documentElement: {appendChild, append: appendChild},
    createElement: name => { assert.equal(name, 'audio'); return new FakeAudio(); },
    addEventListener() {}, removeEventListener() {}
  };
  const navigator = {userAgent, platform, maxTouchPoints};
  if (modern) navigator.audioSession = session;
  const sandbox = {console, navigator, document, Audio: FakeAudio, btoa, atob, URL, Blob,
    matchMedia: () => ({matches: false}), setTimeout, clearTimeout};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, {filename: 'index.html:audio'});
  const audio = new sandbox.LT.Audio();
  audio.setup = function () {
    this.ctx = context;
    this.master = {gain: {
      value: 0,
      setTargetAtTime(value) { this.value = value; gains.push(value); },
      cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; gains.push(value); }
    }};
  };
  audio.switchTrack = function (id, force) { switches.push({id, force}); this.group = {id}; };
  audio.stopAll = function () { trace.push('stopAll'); this.group = null; };
  return {audio, context, document, media, trace, gains, switches, resumes, suspends, plays, session};
}

test('modern iOS requests playback without creating a media helper and releases it on OFF', async () => {
  const h = harness({modern: true});
  assert.equal(await h.audio.setEnabled(true), true);
  assert.equal(h.session.type, 'playback');
  assert.equal(h.media.length, 0);
  assert.equal(h.audio.enabled, true);
  await h.audio.setEnabled(false);
  assert.equal(h.audio.enabled, false);
  assert.equal(h.session.type, 'auto');
  assert.equal(h.gains.at(-1), 0);
});

test('legacy iOS starts both playback APIs within the synchronous gesture and reuses one helper', async () => {
  const h = harness(), resume = deferred(), play = deferred();
  h.resumes.push(resume.promise); h.plays.push(play.promise);
  const pending = h.audio.setEnabled(true);
  assert(h.trace.includes('play'), 'HTMLMediaElement.play must run before the first await');
  assert(h.trace.includes('resume'), 'AudioContext.resume must run before the first await');
  assert.equal(h.media.length, 1);
  const helper = h.media[0];
  assert.equal(helper.muted, false); assert.equal(helper.volume, 1); assert.equal(helper.loop, true);
  assert.match(helper.src, /^data:audio\/(?:wav|wave|x-wav)[;,]/);
  const wav = Buffer.from(helper.src.split(',')[1], 'base64');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.readUInt16LE(20), 1, 'helper must be ordinary PCM');
  assert.equal(wav.readUInt16LE(22), 1, 'helper must be mono');
  assert.equal(wav.readUInt16LE(34), 8);
  assert.equal(wav.toString('ascii', 36, 40), 'data');
  assert.equal(wav.readUInt32LE(40), wav.length - 44);
  assert(wav.subarray(44).every(sample => sample === 128), 'unsigned 8-bit PCM silence is 128, not 0');
  resume.resolve(); play.resolve(); await pending;
  await h.audio.setEnabled(false);
  assert.equal(helper.paused, true);
  await h.audio.setEnabled(true);
  assert.equal(h.media.length, 1);
  assert.equal(helper.paused, false);
});

test('iPad desktop-mode identification enables only the legacy Apple fallback', async () => {
  const ipad = harness({userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 5});
  await ipad.audio.setEnabled(true);
  assert.equal(ipad.media.length, 1);
  const mac = harness({userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', platform: 'MacIntel', maxTouchPoints: 0});
  await mac.audio.setEnabled(true);
  assert.equal(mac.media.length, 0);
  const android = harness({userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux armv8l', maxTouchPoints: 5});
  await android.audio.setEnabled(true);
  assert.equal(android.media.length, 0);
});

test('an unusable Audio Session implementation falls back on iOS', async () => {
  const h = harness({modern: true, sessionThrows: true});
  assert.equal(await h.audio.setEnabled(true), true);
  assert.equal(h.media.length, 1);
});

test('a denied legacy helper is nonfatal and retryable while Web Audio already runs', async () => {
  const h = harness();
  h.plays.push(() => Promise.reject(new Error('NotAllowedError')));
  assert.equal(await h.audio.setEnabled(true), true);
  assert.equal(h.context.state, 'running');
  assert.equal(h.audio.enabled, true);
  assert.equal(h.media[0].paused, true);
  assert.equal(h.audio.needsUnlock(), true);
  const before = h.switches.length;
  await h.audio.setEnabled(true);
  assert.equal(h.media[0].paused, false);
  assert.equal(h.audio.needsUnlock(), false);
  assert.equal(h.switches.length, before, 'helper retry must not restart the song');
});

test('legacy play rejection is handled even while AudioContext.resume is pending', async () => {
  const h = harness(), resume = deferred();
  h.resumes.push(resume.promise);
  h.plays.push(() => Promise.reject(new Error('autoplay denied before context settles')));
  const pending = h.audio.setEnabled(true);
  // Cross a task boundary: node:test would report an unhandled rejection if
  // playback only acquired a catch handler after awaiting AudioContext.resume.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.media[0].paused, true);
  resume.resolve();
  assert.equal(await pending, true);
  assert.equal(h.audio.needsUnlock(), true);
});

test('OFF invalidates a pending enable before its resume resolves', async () => {
  const h = harness({modern: true}), resume = deferred();
  h.resumes.push(resume.promise);
  const pending = h.audio.setEnabled(true);
  await h.audio.setEnabled(false);
  resume.resolve(); await pending;
  assert.equal(h.audio.enabled, false);
  assert.equal(h.session.type, 'auto');
  assert.equal(h.gains.at(-1), 0);
  assert.equal(h.switches.length, 0);
});

test('suspend pauses the helper immediately and prevents late enable from restarting audio', async () => {
  const h = harness(), resume = deferred(), suspend = deferred();
  h.resumes.push(resume.promise); h.suspends.push(suspend.promise);
  const enabling = h.audio.setEnabled(true);
  const suspending = h.audio.suspend();
  assert.equal(h.audio.enabled, false);
  assert.equal(h.media[0].paused, true);
  resume.resolve(); await enabling;
  assert.equal(h.audio.enabled, false);
  assert.equal(h.switches.length, 0);
  suspend.resolve(); await suspending;
});

test('a hidden page cannot finish enabling after a delayed browser response', async () => {
  const h = harness({modern: true}), resume = deferred();
  h.resumes.push(resume.promise);
  const pending = h.audio.setEnabled(true);
  h.document.hidden = true;
  resume.resolve(); await pending;
  assert.equal(h.audio.enabled, false);
  assert.equal(h.switches.length, 0);
  assert.equal(h.session.type, 'auto');
});

test('a stale failure cannot disable a later successful gesture', async () => {
  const h = harness({modern: true}), old = deferred();
  h.resumes.push(old.promise);
  const first = h.audio.setEnabled(true);
  assert.equal(await h.audio.setEnabled(true), true);
  old.reject(new Error('obsolete resume failure')); await first;
  assert.equal(h.audio.enabled, true);
  assert.equal(h.audio.lastError, null);
  assert.equal(h.session.type, 'playback');
  assert.equal(h.switches.length, 1);
});

test('interrupted contexts can unlock without restarting an existing song', async () => {
  const h = harness({modern: true});
  await h.audio.setEnabled(true);
  const group = h.audio.group, count = h.switches.length;
  h.context.state = 'interrupted';
  assert.equal(h.audio.needsUnlock(), true);
  await h.audio.setEnabled(true);
  assert.equal(h.context.state, 'running');
  assert.equal(h.audio.needsUnlock(), false);
  assert.equal(h.audio.group, group);
  assert.equal(h.switches.length, count);
});

test('repeated successful unlocks preserve track position and master volume', async () => {
  const h = harness({modern: true});
  h.audio.setVolume(.23);
  await h.audio.setEnabled(true);
  const group = h.audio.group;
  await h.audio.setEnabled(true); await h.audio.setEnabled(true);
  assert.equal(h.audio.group, group);
  assert.equal(h.switches.length, 1);
  assert.equal(h.audio.volume, .23);
  assert.equal(h.gains.at(-1), .23 * .72);
  h.audio.setVolume(0); assert.equal(h.gains.at(-1), 0);
  await h.audio.setEnabled(false); await h.audio.setEnabled(true);
  assert.equal(h.audio.volume, 0); assert.equal(h.gains.at(-1), 0);
});

test('dispose releases playback even when an enable request remains pending', async () => {
  const h = harness(), resume = deferred();
  h.resumes.push(resume.promise);
  const pending = h.audio.setEnabled(true);
  h.audio.dispose();
  assert.equal(h.media[0].paused, true);
  resume.resolve(); await pending;
  assert.equal(h.audio.enabled, false);
  assert.equal(h.switches.length, 0);
});
