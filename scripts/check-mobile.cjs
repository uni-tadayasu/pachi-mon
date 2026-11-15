#!/usr/bin/env node
'use strict';

// Exercise gesture policy without depending on a browser's synthetic-touch support.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const events = new Map();
const viewport = { content: '', setAttribute(_, value) { this.content = value; } };
const classes = new Set(), properties = new Map(), frames = [];
class Element {
  constructor({ editable = false, control = false } = {}) { this.editable = editable; this.control = control; }
  closest(selector) { return (selector === '.touch-controls' ? this.control : this.editable) ? this : null; }
}
const root = {
  classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } },
  style: { setProperty(name, value) { properties.set(name, value); } },
};
const listen = (type, listener) => { if (!events.has(type)) events.set(type, []); events.get(type).push(listener); };
const mobile = { matches: true, addEventListener: listen };
const window = { innerHeight: 844, visualViewport: { height: 844, addEventListener: listen }, addEventListener: listen, dispatchEvent() {} };
const document = { documentElement: root, querySelector() { return viewport; }, addEventListener: listen };
const context = vm.createContext({ window, document, Element, Event: class Event {}, matchMedia: () => mobile,
  requestAnimationFrame(callback) { frames.push(callback); return frames.length; } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'mobile-screen.js'), 'utf8'), context);

let checks = 0;
function prevented(type, detail = {}) {
  let blocked = false;
  const event = { target: new Element(), ...detail, preventDefault() { blocked = true; } };
  for (const listener of events.get(type) || []) listener(event);
  return blocked;
}
function check(value, expected, label) { assert.equal(value, expected, label); checks++; }
const pad = new Element({ control: true }), action = new Element({ control: true });
const field = new Element(), input = new Element({ editable: true });
for (const type of ['touchstart', 'touchmove']) {
  check(prevented(type, { touches: [{ target: pad }, { target: action }] }), false, `${type}: D-pad + A/menu stays actionable`);
  check(prevented(type, { touches: [{ target: field }, { target: field }] }), true, `${type}: field pinch is blocked`);
  check(prevented(type, { touches: [{ target: pad }, { target: field }] }), true, `${type}: mixed pinch is blocked`);
  check(prevented(type, { touches: [{ target: input }] }), false, `${type}: single-finger input stays available`);
}
for (const type of ['contextmenu', 'selectstart', 'dragstart', 'dblclick']) {
  check(prevented(type, { target: field }), true, `${type}: ordinary game content protected`);
  check(prevented(type, { target: input }), false, `${type}: editing remains available`);
}
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) check(prevented(type), true, `${type}: native zoom blocked`);
check(prevented('wheel', { ctrlKey: true }), true, 'Ctrl-wheel zoom blocked on mobile');
check(prevented('wheel', { ctrlKey: false }), false, 'Panel wheel scroll allowed');
check(classes.has('mobile-screen'), true, 'Mobile class initialized');
check(properties.get('--app-height'), '844px', 'Viewport height initialized');
check(viewport.content.includes('maximum-scale=1'), true, 'Mobile zoom viewport enabled');

window.visualViewport.height = 380;
for (const listener of events.get('orientationchange')) listener();
while (frames.length) frames.shift()();
check(properties.get('--app-height'), '380px', 'Visible height updates after rotation/keyboard');

mobile.matches = false;
for (const listener of events.get('change')) listener();
while (frames.length) frames.shift()();
check(classes.has('mobile-screen'), false, 'Desktop class restored');
check(viewport.content.includes('maximum-scale'), false, 'Desktop zoom restored');
check(prevented('touchstart', { touches: [{ target: field }, { target: field }] }), false, 'Desktop gestures unchanged');
check(prevented('contextmenu'), false, 'Desktop context menu unchanged');

// Run the actual game handlers so simultaneous direction releases and browser
// interruption events exercise the production pointer state, not a duplicate.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const handlersStart = html.indexOf("  window.addEventListener('keyup',");
const handlersEnd = html.indexOf("  $('start-btn').onclick", handlersStart);
assert(handlersStart >= 0 && handlersEnd > handlersStart, 'Game input handlers are available');
const gameEvents = new Map();
const gameListen = (type, handler) => {
  if (!gameEvents.has(type)) gameEvents.set(type, []);
  gameEvents.get(type).push(handler);
};
const gameEvent = type => { for (const handler of gameEvents.get(type) || []) handler({}); };
function makeButton(dir) {
  const listeners = new Map(), pressed = new Set(), captures = new Set();
  return {
    dataset: { dir },
    classList: { add: value => pressed.add(value), remove: value => pressed.delete(value), contains: value => pressed.has(value) },
    addEventListener(type, handler) { listeners.set(type, handler); },
    setPointerCapture(id) { captures.add(id); },
    hasPointerCapture(id) { return captures.has(id); },
    releasePointerCapture(id) { captures.delete(id); this.send('lostpointercapture', id); },
    send(type, pointerId) { listeners.get(type)?.({ pointerId, preventDefault() {} }); },
  };
}
const right = makeButton('right'), up = makeButton('up');
const walked = [], modal = { open: false };
const game = vm.createContext({
  window: { addEventListener: gameListen },
  document: { hidden: false, addEventListener: gameListen, querySelectorAll: () => [right, up] },
  $: () => modal, LT: { onlineActive: false }, engine: { battle: null }, playing: true,
  settings: { sound: false },
  sound: {
    enabled: false, ctx: { state: 'suspended' },
    async suspend() { this.enabled = false; this.ctx.state = 'suspended'; },
    needsUnlock() { return !this.enabled || this.ctx.state !== 'running'; },
    async setEnabled(value) { this.enabled = !!value; this.ctx.state = value ? 'running' : 'suspended'; return this.enabled; },
  },
  controller: { reset() {} }, save() {},
  performance: { now: () => 100 }, pressedDirection: null, directionSource: null,
  sprint: false, padSprint: false, lastStep: 0,
  directions: { right: [1, 0], up: [0, -1] }, walk: (...direction) => walked.push(direction),
});
vm.runInContext(html.slice(handlersStart, handlersEnd), game);
right.send('pointerdown', 1);
check(game.pressedDirection, 'right', 'First held direction moves');
check(walked.length, 1, 'Initial press moves immediately');
up.send('pointerdown', 2);
check(game.pressedDirection, 'up', 'Latest held direction takes priority');
up.send('pointerup', 2);
check(game.pressedDirection, 'right', 'Releasing latest direction resumes the held direction');
up.send('lostpointercapture', 2);
check(game.pressedDirection, 'right', 'Follow-up capture loss does not stop the remaining finger');
right.send('pointerup', 1);
check(game.pressedDirection, null, 'Releasing the final direction stops movement');
check(game.directionSource, null, 'Final release clears touch input ownership');

right.send('pointerdown', 3); up.send('pointerdown', 4);
right.send('pointerup', 3);
check(game.pressedDirection, 'up', 'Releasing an earlier finger preserves the latest direction');
up.send('pointercancel', 4);
check(game.pressedDirection, null, 'Cancelling the final finger stops movement');
right.send('pointerdown', 5); up.send('pointerdown', 6);
up.send('pointercancel', 6);
check(game.pressedDirection, 'right', 'Cancelling one finger preserves another held direction');
right.send('lostpointercapture', 5);
check(game.pressedDirection, null, 'Losing the final pointer capture stops movement');

right.send('pointerdown', 7); right.send('pointerdown', 8);
right.send('pointerup', 7);
check(right.classList.contains('pressed'), true, 'Button stays pressed while a second finger holds it');
check(game.pressedDirection, 'right', 'Two fingers on one direction remain actionable');
right.send('pointerup', 8);
check(right.classList.contains('pressed'), false, 'Final same-button release clears its pressed appearance');

for (const type of ['blur', 'visibilitychange', 'pagehide']) {
  right.send('pointerdown', 9); up.send('pointerdown', 10);
  game.document.hidden = type === 'visibilitychange';
  gameEvent(type);
  check(game.pressedDirection, null, `${type}: movement stops`);
  check(game.directionSource, null, `${type}: touch ownership clears`);
  check(right.classList.contains('pressed') || up.classList.contains('pressed'), false, `${type}: pressed appearances clear`);
  check(right.hasPointerCapture(9) || up.hasPointerCapture(10), false, `${type}: captures release`);
  up.send('pointerup', 10);
  check(game.pressedDirection, null, `${type}: delayed release cannot resume a stale direction`);
}

game.document.hidden = false;
right.send('pointerdown', 11);
game.directionSource = 'ArrowUp'; game.pressedDirection = 'up';
right.send('pointerup', 11);
check(game.pressedDirection, 'up', 'Touch release respects keyboard takeover');
modal.open = true;
up.send('pointerdown', 12);
check(up.classList.contains('pressed'), false, 'Modal blocks new touch movement');
check(game.directionSource, 'ArrowUp', 'Blocked press does not take over input');
console.log(JSON.stringify({ ok: true, checks, coverage: 'Mobile gestures, held-pointer handoff, interruption cleanup, editable inputs, viewport changes, desktop restoration' }));
