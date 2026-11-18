#!/usr/bin/env node
'use strict';

// Exercise gesture policy without depending on a browser's synthetic-touch support.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const mobileSource = fs.readFileSync(path.join(__dirname, '..', 'mobile-screen.js'), 'utf8');
const events = new Map();
const listenerOptions = new Map();
const viewport = { content: '', setAttribute(_, value) { this.content = value; } };
const classes = new Set(), properties = new Map(), frames = [];
class Element {
  constructor({ editable = false, control = false, tag = 'div', parent = null, contentEditable, readOnly = false } = {}) {
    this.nodeType = 1; this.tagName = (editable ? 'input' : tag).toUpperCase();
    this.control = control; this.parentElement = parent; this.contentEditable = contentEditable; this.readOnly = readOnly;
    this.syntheticClicks = 0;
  }
  // Match the browser's editing inheritance, including an explicitly noneditable island.
  get isContentEditable() {
    for (let node = this; node; node = node.parentElement) {
      if (node.contentEditable === 'false') return false;
      if (['', 'true', 'plaintext-only'].includes(node.contentEditable)) return true;
    }
    return false;
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      for (const part of selector.split(',').map(value => value.trim())) {
        if (part === '.touch-controls' && node.control) return node;
        if (/^[a-z]+$/i.test(part) && node.tagName === part.toUpperCase()) return node;
        const content = /^\[contenteditable="([^"]*)"\]$/.exec(part);
        if (content && node.contentEditable === content[1]) return node;
      }
    }
    return null;
  }
  click() { this.syntheticClicks++; }
}
const textNode = parentElement => ({ nodeType: 3, parentElement });
function makeSelection() {
  let ranges = [];
  return {
    removed: 0,
    get rangeCount() { return ranges.length; },
    get isCollapsed() { return !ranges.length || ranges.every(range => range.collapsed); },
    get anchorNode() { return ranges[0]?.startContainer || null; },
    get focusNode() { return ranges.at(-1)?.endContainer || null; },
    getRangeAt(index) { assert(ranges[index], 'Selection range exists'); return ranges[index]; },
    set(startContainer, endContainer = startContainer, collapsed = false) { ranges = [{ startContainer, endContainer, collapsed }]; },
    removeAllRanges() { this.removed++; ranges = []; },
  };
}
const selection = makeSelection();
const root = {
  classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) },
  style: { setProperty(name, value) { properties.set(name, value); } },
};
const listen = (type, listener, options) => {
  if (!events.has(type)) events.set(type, []);
  if (!listenerOptions.has(type)) listenerOptions.set(type, []);
  events.get(type).push(listener); listenerOptions.get(type).push(options);
};
const mobile = { matches: true, addEventListener: listen };
const touch = { matches: false, addEventListener: listen };
const navigator = { maxTouchPoints: 0 };
const scrolls = [], shapes = [];
const window = { innerWidth: 390, innerHeight: 844, scrollX: 0, scrollY: 0, navigator, getSelection: () => selection, scrollTo(x, y) { scrolls.push([x, y]); this.scrollX = x; this.scrollY = y; }, visualViewport: { height: 844, addEventListener: listen }, addEventListener: listen, dispatchEvent() {} };
const document = { activeElement: null, documentElement: root, getSelection: () => selection, querySelector() { return viewport; }, addEventListener: listen, dispatchEvent(event) { shapes.push(event.detail?.shape); } };
const context = vm.createContext({ window, document, navigator, Element, Event: class Event {}, CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }, matchMedia: query => query === '(any-pointer:coarse)' ? touch : mobile,
  requestAnimationFrame(callback) { frames.push(callback); return frames.length; } });
vm.runInContext(mobileSource, context);

let checks = 0;
function dispatch(type, detail = {}) {
  const event = { target: new Element(), defaultPrevented: false, propagationStopped: false, ...detail,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
  for (const listener of events.get(type) || []) listener(event);
  return event;
}
const prevented = (type, detail) => dispatch(type, detail).defaultPrevented;
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
  check(listenerOptions.get(type).some(options => options === true || options?.capture === true), true, `${type}: selection guard runs during capture`);
  check(listenerOptions.get(type).every(options => options?.passive !== true), true, `${type}: cancelable listener is not passive`);
  check(dispatch(type, { target: field }).propagationStopped, false, `${type}: existing game handlers still receive the event`);
}
const editableHost = new Element({ contentEditable: 'true' });
const editableTargets = [
  [new Element({ tag: 'input', readOnly: true }), 'readonly invitation / player ID'],
  [new Element({ tag: 'textarea' }), 'textarea'],
  [new Element({ tag: 'select' }), 'native select'],
  [new Element({ tag: 'option', parent: new Element({ tag: 'select' }) }), 'select option'],
  [editableHost, 'contenteditable true'],
  [new Element({ contentEditable: '' }), 'empty contenteditable attribute'],
  [new Element({ contentEditable: 'plaintext-only' }), 'plain-text editor'],
  [new Element({ tag: 'span', parent: editableHost }), 'nested editable text'],
  [textNode(editableHost), 'editable text node'],
];
for (const [target, label] of editableTargets) {
  for (const type of ['contextmenu', 'selectstart', 'dragstart', 'dblclick']) {
    check(prevented(type, { target }), false, `${label}: ${type} stays native`);
  }
  selection.set(target); dispatch('selectionchange');
  check(selection.rangeCount, 1, `${label}: selected text remains available for copying`);
}
const noneditableIsland = new Element({ contentEditable: 'false', parent: editableHost });
check(prevented('selectstart', { target: textNode(noneditableIsland) }), true, 'Noneditable island does not inherit the editing exception');
check(prevented('selectstart', { target: textNode(field) }), true, 'Text-node events on ordinary UI are protected');
selection.set(textNode(field)); dispatch('selectionchange');
check(selection.rangeCount, 0, 'Native selection that escaped selectstart is cleared on ordinary UI');
const beforeEmpty = selection.removed; dispatch('selectionchange');
check(selection.removed, beforeEmpty, 'Empty selection does not cause a clearing loop');
document.activeElement = input; selection.set(textNode(field)); dispatch('selectionchange');
check(selection.rangeCount, 1, 'Selection cleanup stays out of an active input session');
document.activeElement = new Element({ parent: editableHost }); dispatch('selectionchange');
check(selection.rangeCount, 1, 'Selection cleanup also respects a focused editable descendant');
document.activeElement = null; dispatch('selectionchange');
check(selection.rangeCount, 0, 'Stray noneditable selection is removed after editing ends');
selection.set(textNode(field), textNode(editableHost)); dispatch('selectionchange');
check(selection.rangeCount, 1, 'Selection ending in an editor is preserved');
selection.set(textNode(editableHost), textNode(field)); dispatch('selectionchange');
check(selection.rangeCount, 1, 'Selection beginning in an editor is preserved');

// Check browser-event contracts rather than inventing synthetic replacement clicks.
// The actual game's repeat/cancel behavior is covered by check-allocation-ui.cjs.
const rapidButton = new Element({ tag: 'button' });
for (let tap = 0; tap < 2; tap++) {
  check(prevented('touchstart', { target: rapidButton, touches: [{ target: rapidButton }] }), false, `Rapid tap ${tap + 1}: touchstart remains native`);
  check(prevented('touchend', { target: rapidButton, touches: [], changedTouches: [{ target: rapidButton }] }), false, `Rapid tap ${tap + 1}: touchend can generate its native click`);
  check(prevented('click', { target: rapidButton, detail: tap + 1 }), false, `Rapid tap ${tap + 1}: click is not suppressed`);
}
check(rapidButton.syntheticClicks, 0, 'Guard never substitutes synthetic button activation');
for (const type of ['touchmove', 'touchend', 'touchcancel', 'pointercancel']) {
  check(prevented(type, { target: field, touches: [{ target: field }] }), false, `${type}: scrolling or a cancelled long press is not intercepted`);
}
for (const type of ['copy', 'cut', 'paste', 'beforeinput']) check(prevented(type, { target: input }), false, `${type}: native text editing is unaffected`);
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) check(prevented(type), true, `${type}: native zoom blocked`);
check(prevented('wheel', { ctrlKey: true }), true, 'Ctrl-wheel zoom blocked on mobile');
check(prevented('wheel', { ctrlKey: false }), false, 'Panel wheel scroll allowed');
check(classes.has('mobile-screen'), true, 'Mobile class initialized');
check(classes.has('touch-guard'), true, 'Mobile selection protection initialized');
check(properties.get('--app-height'), '844px', 'Viewport height initialized');
check(viewport.content.includes('maximum-scale=1'), true, 'Mobile zoom viewport enabled');

window.visualViewport.height = 380;
for (const listener of events.get('orientationchange')) listener();
while (frames.length) frames.shift()();
check(properties.get('--app-height'), '380px', 'Visible height updates after rotation/keyboard');

// Rotating to landscape and back: a leftover scroll offset is cleared (otherwise
// taps land away from what is drawn) and every shape change is announced so the
// game can release buttons whose pointerup was swallowed by the rotation.
Object.assign(window, { innerWidth: 844, innerHeight: 390, scrollY: 140 }); window.visualViewport.height = 390;
for (const listener of events.get('orientationchange')) listener();
while (frames.length) frames.shift()();
check(JSON.stringify(scrolls.at(-1)), '[0,0]', 'Scroll offset reset after rotating to landscape');
check(shapes.at(-1), 'landscape:true', 'Landscape shape announced');
Object.assign(window, { innerWidth: 390, innerHeight: 844, scrollY: 60 }); window.visualViewport.height = 844;
for (const listener of events.get('orientationchange')) listener();
while (frames.length) frames.shift()();
check(JSON.stringify(scrolls.at(-1)), '[0,0]', 'Scroll offset reset after rotating back to portrait');
check(shapes.at(-1), 'portrait:true', 'Portrait shape announced');
check(properties.get('--app-height'), '844px', 'Portrait height restored after rotation');

mobile.matches = false;
for (const listener of events.get('change')) listener();
while (frames.length) frames.shift()();
check(classes.has('mobile-screen'), false, 'Desktop class restored');
check(classes.has('touch-guard'), false, 'Mouse-only desktop restores normal text selection');
check(viewport.content.includes('maximum-scale'), false, 'Desktop zoom restored');
check(prevented('touchstart', { touches: [{ target: field }, { target: field }] }), false, 'Desktop gestures unchanged');
check(prevented('contextmenu'), false, 'Desktop context menu unchanged');
selection.set(textNode(field)); dispatch('selectionchange');
check(selection.rangeCount, 1, 'Mouse-only desktop keeps ordinary selected text');

// Evaluate the production media query rather than forcing .matches=true. This
// catches tablets reverting to desktop solely because their long side turns
// horizontal, including a fine primary pointer with touch still available.
function matchesMedia(query, state) {
  return query.split(',').some(clause => {
    const features = [...clause.matchAll(/\(\s*([\w-]+)\s*:\s*([^)]+)\)/g)];
    assert(features.length && !clause.replace(/\([^)]*\)/g, '').replace(/\band\b/g, '').trim(), 'Supported media-query syntax');
    return features.every(([, feature, raw]) => {
      const value = raw.trim(), axis = /^(min|max)-(width|height)$/.exec(feature);
      if (axis) {
        assert(/^\d+(?:\.\d+)?px$/.test(value), 'Viewport breakpoints use CSS px');
        return axis[1] === 'max' ? state[axis[2]] <= parseFloat(value) : state[axis[2]] >= parseFloat(value);
      }
      if (feature === 'pointer') return state.pointer === value;
      if (feature === 'any-pointer') return state.pointers.includes(value);
      assert.fail('Unsupported media feature: ' + feature);
    });
  });
}
function viewportRuntime(initial) {
  const state = { pointer: 'coarse', maxTouchPoints: 0, ...initial };
  state.pointers = initial.pointers || [state.pointer];
  const activeClasses = new Set(), values = new Map(), pending = [], timers = [], listeners = new Map(), changes = [], pageScrolls = [];
  const mediaQueries = [], selected = makeSelection();
  let frameId = 0, viewportText = '';
  const on = source => (type, callback) => { const key = source + ':' + type; if (!listeners.has(key)) listeners.set(key, []); listeners.get(key).push(callback); };
  const emit = (source, type, event = {}) => { for (const callback of listeners.get(source + ':' + type) || []) callback(event); };
  const flush = () => { while (pending.length) pending.shift()(); };
  const nav = { get maxTouchPoints() { return state.maxTouchPoints; } };
  const win = { innerWidth: state.width, innerHeight: state.height, scrollX: 0, scrollY: 0,
    navigator: nav, getSelection: () => selected,
    scrollTo(x, y) { this.scrollX = x; this.scrollY = y; pageScrolls.push([x, y]); },
    visualViewport: { height: state.height, addEventListener: on('visual') }, addEventListener: on('window'), dispatchEvent() {} };
  const doc = { activeElement: null, documentElement: {
    classList: { toggle(name, enabled) { enabled ? activeClasses.add(name) : activeClasses.delete(name); }, contains: name => activeClasses.has(name) },
    style: { setProperty(name, value) { values.set(name, value); } } },
    getSelection: () => selected,
    querySelector: () => ({ setAttribute(name, value) { viewportText = value; } }), addEventListener: on('document'),
    dispatchEvent(event) { changes.push(event.detail?.shape); } };
  vm.runInNewContext(mobileSource, { window: win, document: doc, navigator: nav, Element,
    Event: class {}, CustomEvent: class { constructor(type, init) { this.detail = init.detail; } },
    matchMedia(query) {
      const source = 'media' + mediaQueries.length;
      const media = { source, get matches() { return matchesMedia(query, state); }, addEventListener: on(source) };
      mediaQueries.push(media); return media;
    }, requestAnimationFrame(callback) { pending.push(callback); return ++frameId; },
    setTimeout(callback) { timers.push(callback); return timers.length; } });
  const settleTimers = () => { flush(); while (timers.length) { timers.shift()(); flush(); } };
  return { state, win, doc, activeClasses, values, changes, pageScrolls, selection: selected, get viewport() { return viewportText; },
    prevented(type, detail = {}) {
      const event = { target: field, defaultPrevented: false, ...detail, preventDefault() { this.defaultPrevented = true; } };
      emit('document', type, event); return event.defaultPrevented;
    },
    resize(next, event = 'resize') {
      const before = mediaQueries.map(media => media.matches);
      Object.assign(state, next);win.innerWidth = state.width;win.innerHeight = state.height;
      win.visualViewport.height = next.visualHeight ?? state.height;
      mediaQueries.forEach((media, index) => { if (before[index] !== media.matches) emit(media.source, 'change'); });
      emit('window', event);emit('visual', 'resize');settleTimers();
    },
    changePointers(pointers) {
      const before = mediaQueries.map(media => media.matches); state.pointers = pointers;
      mediaQueries.forEach((media, index) => { if (before[index] !== media.matches) emit(media.source, 'change'); });
      settleTimers();
    },
    finishEditing(target) { doc.activeElement = null;emit('document', 'focusout', { target });settleTimers(); }
  };
}
const viewportCases = [
  [390, 844, 'fine', ['fine'], true, true, 'Narrow phone/window keeps existing behavior'],
  [844, 390, 'fine', ['fine'], true, true, 'Short landscape keeps existing behavior'],
  [768, 1024, 'coarse', ['coarse'], true, true, 'Tablet portrait'],
  [1024, 768, 'coarse', ['coarse'], true, true, 'Tablet landscape'],
  [820, 1180, 'coarse', ['coarse'], true, true, 'Tall tablet portrait'],
  [1180, 820, 'coarse', ['coarse'], true, true, 'Wide tablet landscape'],
  [834, 1194, 'coarse', ['coarse'], true, true, 'Intermediate tablet portrait'],
  [1194, 834, 'coarse', ['coarse'], true, true, 'Intermediate tablet landscape'],
  [1024, 1366, 'coarse', ['coarse'], true, true, 'Large tablet portrait'],
  [1366, 1024, 'coarse', ['coarse'], true, true, 'Large tablet landscape'],
  [820, 1180, 'fine', ['fine', 'coarse'], true, true, 'Portrait with fine primary and coarse secondary pointer'],
  [1366, 1024, 'fine', ['fine', 'coarse'], true, true, 'Landscape with fine primary and coarse secondary pointer'],
  [684, 1024, 'fine', ['fine'], true, true, 'Narrow Split View keeps existing behavior'],
  [700, 1366, 'fine', ['fine'], true, true, 'Existing narrow-window boundary'],
  [701, 1366, 'fine', ['fine'], false, false, 'Pure fine pointer beyond narrow-window boundary'],
  [1024, 768, 'fine', ['fine'], false, false, 'Mouse-only PC'],
  [1366, 1024, 'fine', ['fine'], false, false, 'Wide mouse-only PC'],
  [1400, 1100, 'coarse', ['coarse'], true, true, 'Tablet long/short edge boundary'],
  [1100, 1400, 'coarse', ['coarse'], true, true, 'Rotated tablet edge boundary'],
  [1401, 1100, 'fine', ['fine', 'coarse'], false, true, 'Long edge outside tablet bounds'],
  [1101, 1400, 'coarse', ['coarse'], false, true, 'Short edge outside tablet bounds'],
  [1920, 1080, 'coarse', ['coarse'], false, true, 'Large touch PC'],
  [1920, 1080, 'fine', ['fine', 'coarse'], false, true, 'Large PC with mixed input'],
  [1080, 1920, 'coarse', ['coarse'], false, true, 'Rotated large touch display'],
];
for (const [width, height, pointer, pointers, expected, guarded, label] of viewportCases) {
  const runtime = viewportRuntime({ width, height, pointer, pointers });
  check(runtime.activeClasses.has('mobile-screen'), expected, label);
  check(runtime.activeClasses.has('touch-guard'), guarded, label + ': selection guard covers touch surfaces');
  check(runtime.prevented('contextmenu'), guarded, label + ': event guard agrees with text-selection protection');
  check(runtime.viewport.includes('maximum-scale=1'), expected, label + ': viewport policy follows the layout');
  check(runtime.values.get('--app-height'), height + 'px', label + ': CSS viewport height is available');
}
// Some tablets expose a fine pointer in desktop mode but still report touch
// capability. That fallback must protect selection without fixing the layout.
const touchFallback = viewportRuntime({ width: 1920, height: 1080, pointer: 'fine', pointers: ['fine'], maxTouchPoints: 5 });
check(touchFallback.activeClasses.has('touch-guard'), true, 'maxTouchPoints protects a touch device with only a reported fine pointer');
check(touchFallback.activeClasses.has('mobile-screen'), false, 'Touch-capability fallback does not change the desktop layout');
check(touchFallback.prevented('contextmenu'), true, 'Touch-capability fallback also guards native text actions');
check(touchFallback.viewport.includes('maximum-scale'), false, 'Touch-capability fallback preserves desktop zoom');

// Change the available pointers without resizing: the independent media-query
// listener must update the guard and remove any stale game-text selection.
const changingPointers = viewportRuntime({ width: 1920, height: 1080, pointer: 'fine', pointers: ['fine'] });
changingPointers.selection.set(textNode(field));
changingPointers.changePointers(['fine', 'coarse']);
check(changingPointers.activeClasses.has('touch-guard'), true, 'Adding touch activates protection without a resize');
check(changingPointers.activeClasses.has('mobile-screen'), false, 'Adding touch leaves a large window in desktop layout');
check(changingPointers.selection.rangeCount, 0, 'Enabling touch protection clears preexisting game-text selection');
check(changingPointers.prevented('contextmenu'), true, 'Added touch pointer activates the event guard');
changingPointers.changePointers(['fine']);
check(changingPointers.activeClasses.has('touch-guard'), false, 'Removing the last touch pointer restores text selection');
check(changingPointers.prevented('contextmenu'), false, 'Removing touch restores the native context menu');
changingPointers.selection.set(textNode(field)); changingPointers.prevented('selectionchange');
check(changingPointers.selection.rangeCount, 1, 'Mouse-only selection survives after touch is removed');

const tablet = viewportRuntime({ width: 1024, height: 1366, pointer: 'fine', pointers: ['fine', 'coarse'] });
tablet.win.scrollY = 120;tablet.resize({ width: 1366, height: 1024 }, 'orientationchange');
check(tablet.activeClasses.has('mobile-screen'), true, 'Rotating a large hybrid-input tablet retains touch layout');
check(tablet.changes.at(-1), 'landscape:true', 'Tablet rotation announces held-input cleanup without desktop transition');
check(JSON.stringify(tablet.pageScrolls.at(-1)), '[0,0]', 'Tablet rotation clears stale page scroll');
tablet.resize({ width: 1024, height: 1366 }, 'orientationchange');
check(tablet.changes.at(-1), 'portrait:true', 'Rotating back retains the tablet layout');
tablet.doc.activeElement = input;tablet.win.scrollY = 90;
tablet.resize({ visualHeight: 570 });
check(tablet.activeClasses.has('mobile-screen'), true, 'Virtual keyboard does not reclassify the tablet');
check(tablet.values.get('--app-height'), '570px', 'Tablet follows the visual viewport while keyboard is open');
check(tablet.win.scrollY, 90, 'Editing preserves the browser scroll needed to reach the input');
tablet.resize({ visualHeight: 1366 });tablet.finishEditing(input);
check(tablet.values.get('--app-height'), '1366px', 'Closing keyboard restores tablet height');
check(tablet.win.scrollY, 0, 'After editing the fixed page returns to its origin');
tablet.resize({ width: 684, height: 1024 });
check(tablet.activeClasses.has('mobile-screen'), true, 'Split View retains the responsive touch layout');
tablet.resize({ width: 1920, height: 1080 });
check(tablet.activeClasses.has('mobile-screen'), false, 'Large touch window returns to desktop instead of staying fixed');
check(tablet.viewport.includes('maximum-scale'), false, 'Large touch window restores ordinary zoom');

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
  tradeLocked: () => false,
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
// The keyboard helpers (held keys by physical key) come first: blur and the other
// interruption handlers release them too.
const keyHelpersStart = html.indexOf('  const keyDirs=');
const keyHelpersEnd = html.indexOf("  window.addEventListener('keydown',", keyHelpersStart);
assert(keyHelpersStart >= 0 && keyHelpersEnd > keyHelpersStart, 'Keyboard helpers are available');
vm.runInContext(html.slice(keyHelpersStart, keyHelpersEnd), game);
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
game.directionSource = 'keyboard'; game.pressedDirection = 'up';
right.send('pointerup', 11);
check(game.pressedDirection, 'up', 'Touch release respects keyboard takeover');
modal.open = true;
up.send('pointerdown', 12);
check(up.classList.contains('pressed'), false, 'Modal blocks new touch movement');
check(game.directionSource, 'keyboard', 'Blocked press does not take over input');

// Turning the phone mid-press can swallow the pointerup: rotation releases held input and re-fits the canvas.
modal.open = false; game.directionSource = null; game.pressedDirection = null;
let resized = 0; game.resize = () => { resized += 1; };
for (const [n, type] of ['orientationchange', 'pachi-viewport-change'].entries()) {
  right.send('pointerdown', 20 + n);
  check(game.pressedDirection, 'right', `${type}: direction held before turning`);
  game.sprint = true;
  gameEvent(type);
  check(game.pressedDirection, null, `${type}: held direction is released`);
  check(game.directionSource, null, `${type}: input ownership clears`);
  check(game.sprint, false, `${type}: sprint is released`);
  check(right.classList.contains('pressed'), false, `${type}: pressed look clears`);
  check(resized, n + 1, `${type}: canvas re-fits the new shape`);
  right.send('pointerup', 20 + n);
  check(game.pressedDirection, null, `${type}: a late release cannot resume the old direction`);
  up.send('pointerdown', 30 + n);
  check(game.pressedDirection, 'up', `${type}: the next tap is read as itself`);
  up.send('pointerup', 30 + n);
}
console.log(JSON.stringify({ ok: true, checks, viewportCases: viewportCases.length, touchPolicyCases: 2, coverage: 'Phone/tablet/desktop media queries, mixed pointers, touch-capability fallback, pointer changes, editable/readonly selection, native tap and scroll events, Split View, virtual keyboard, held-pointer handoff, interruption cleanup, rotation release, desktop restoration' }));
