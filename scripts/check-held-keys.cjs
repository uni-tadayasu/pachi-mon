#!/usr/bin/env node
'use strict';
/* Held direction keys never leave the hero walking: the page's own keyboard code
 * runs here with a stand-in world. A key released after Shift (dash) or Caps Lock
 * changed its letter still stops the walk; two held keys hand over to each other;
 * releasing ⌘/Ctrl/Alt (macOS sends no key-up for keys let go under ⌘) and losing
 * focus release everything; shortcut combinations never start a walk; and when a
 * key's repeats stop without a key-up, the walk stops by itself. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('  let sprint=false;'), end = html.indexOf("  // Rotating the phone can swallow the pointerup", start);
assert(start > 0 && end > start, 'keyboard block');
const block = html.slice(start, end);
const loopLine = html.split('\n').find(line => line.includes("if(directionSource==='keyboard'&&keyClock.gap>0"));
assert(loopLine, 'the frame loop checks for lost key-ups');

const listeners = {}, walked = [];
let now = 0;
const ctx = vm.createContext({
  window: { addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } },
  performance: { now: () => now },
  $: () => ({ open: false, focus() {}, click() {} }),
  engine: { battle: null }, playing: true, busy: false, activePane: '',
  directions: { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] },
  walk: (dx, dy) => walked.push([dx, dy]),
  interact() {}, showMenu() {}, showDex() {}, showMap() {}, showBag() {}, finishBattle() {}, save() {},
  clearTouchDirections() {}, controller: null, battleSkip: false, padSprint: false, LT: {}, tradeLocked: () => false, rankedLocked: () => false, fieldDialogOpen: () => false
});
vm.runInContext(`var pressedDirection=null,directionSource=null;${block};this.state=()=>({pressedDirection,directionSource,sprint});this.lost=now=>{${loopLine.trim().split(';')[0]};};`, ctx);
const fire = (type, init) => { for (const fn of listeners[type] || []) fn({ preventDefault() {}, target: { tagName: 'CANVAS' }, repeat: false, metaKey: false, ctrlKey: false, altKey: false, ...init }); };
const down = (key, code, extra = {}) => fire('keydown', { key, code, ...extra });
const up = (key, code) => fire('keyup', { key, code });
const state = () => ctx.state();

// 1. Shift pressed while walking turns "d" into "D": the release still stops the walk.
down('d', 'KeyD'); assert.equal(state().pressedDirection, 'right'); assert.equal(walked.length, 1);
down('Shift', 'ShiftLeft'); assert.equal(state().sprint, true);
up('D', 'KeyD'); assert.equal(state().pressedDirection, null, 'releasing D after Shift stops the walk');
up('Shift', 'ShiftLeft'); assert.equal(state().sprint, false);
// The other order: Shift first, then the letter, Shift released first.
down('Shift', 'ShiftLeft'); down('W', 'KeyW'); up('Shift', 'ShiftLeft'); up('w', 'KeyW');
assert.equal(state().pressedDirection, null, 'Shift released before the letter');
// Caps Lock, and keyboards without codes (letters compared case-insensitively).
down('A', 'KeyA'); up('a', 'KeyA'); assert.equal(state().pressedDirection, null);
down('s', ''); up('S', ''); assert.equal(state().pressedDirection, null);

// 2. Two held keys: the newest leads; letting it go hands back to the other.
down('ArrowRight', 'ArrowRight'); down('ArrowUp', 'ArrowUp'); assert.equal(state().pressedDirection, 'up');
up('ArrowUp', 'ArrowUp'); assert.equal(state().pressedDirection, 'right', 'falls back to the key still held');
up('ArrowRight', 'ArrowRight'); assert.equal(state().pressedDirection, null);

// 3. ⌘/Ctrl/Alt: no walk from shortcuts; releasing the modifier lets go of everything.
const before = walked.length;
down('ArrowLeft', 'ArrowLeft', { metaKey: true }); assert.equal(state().pressedDirection, null); assert.equal(walked.length, before, 'shortcuts do not walk');
down('ArrowLeft', 'ArrowLeft'); fire('keydown', { key: 'Meta', code: 'MetaLeft', metaKey: true }); up('Meta', 'MetaLeft');
assert.equal(state().pressedDirection, null, 'releasing ⌘ releases keys whose key-up macOS swallowed');
down('ArrowLeft', 'ArrowLeft'); up('ArrowUp', 'ArrowUp'); assert.equal(state().pressedDirection, 'left', 'stale key-ups of other keys change nothing');

// 4. Losing focus forgets held keys, so a later key-up cannot revive an old direction.
down('ArrowDown', 'ArrowDown'); fire('blur', {}); assert.equal(state().pressedDirection, null);
down('ArrowRight', 'ArrowRight'); up('ArrowRight', 'ArrowRight'); assert.equal(state().pressedDirection, null, 'no stale direction after blur');

// 5. Repeats that stop without a key-up: the walk stops after three repeat periods (at least a second).
now = 1000; down('ArrowUp', 'ArrowUp');
for (let t = 1500; t <= 2000; t += 33) { now = t; down('ArrowUp', 'ArrowUp', { repeat: true }); }
now += 900; ctx.lost(now); assert.equal(state().pressedDirection, 'up', 'a short pause in repeats is tolerated');
now += 200; ctx.lost(now); assert.equal(state().pressedDirection, null, 'a lost key-up is detected');
// Without repeats (repeat switched off, or still in the first delay) nothing is guessed.
now = 10000; down('ArrowDown', 'ArrowDown'); now += 5000; ctx.lost(now); assert.equal(state().pressedDirection, 'down');
up('ArrowDown', 'ArrowDown');

const beforeRanked=walked.length;ctx.rankedLocked=()=>true;
down('ArrowRight','ArrowRight');assert.equal(walked.length,beforeRanked,'waiting for a ranked match never moves the field');
assert.equal(state().pressedDirection,null);ctx.rankedLocked=()=>false;

console.log(JSON.stringify({ ok: true, checks: ['Shift and Caps Lock change the letter', 'no-code keyboards', 'two keys hand over', 'shortcuts never walk', 'releasing ⌘/Ctrl/Alt releases all', 'focus loss forgets held keys', 'lost key-up detected from stopped repeats', 'no guessing without repeats'] }));
