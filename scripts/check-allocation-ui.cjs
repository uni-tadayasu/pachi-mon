#!/usr/bin/env node
'use strict';
/* 振り分けポイント UI: repeated taps and press-and-hold update the open detail
 * screen in place (no re-open, no scroll reset), and a burst saves once. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const model = vm.createContext({ console });
for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc=|application\/ld\+json/.test(script[1])) continue;
  vm.runInContext(script[2], model);
  if (model.LT?.Engine) break;
}
const { Engine, DATA } = model.LT;

// ── A small element tree parsed from the detail markup: enough for the selectors the refresh uses.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const camel = name => name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
function matches(el, selector) {
  const m = /^([a-z0-9]+)?((?:\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/i.exec(selector);
  if (!m) throw Error(`Unsupported selector ${selector}`);
  if (m[1] && el.tag !== m[1].toLowerCase()) return false;
  for (const part of m[2].match(/\.[\w-]+|\[[\w-]+(?:="[^"]*")?\]/g) || []) {
    if (part[0] === '.') { if (!(el.attrs.class || '').split(/\s+/).includes(part.slice(1))) return false; continue; }
    const [, name, value] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
    if (!(name in el.attrs) || (value !== undefined && el.attrs[name] !== value)) return false;
  }
  return true;
}
function makeElement(tag, attrs = {}) {
  const el = {
    tag, attrs, dataset: {}, children: [], parent: null, textContent: '', innerHTML: '', isConnected: true,
    get disabled() { return 'disabled' in this.attrs; },
    set disabled(value) { if (value) this.attrs.disabled = ''; else delete this.attrs.disabled; },
    closest(selector) { for (let node = this; node && node.tag !== '#root'; node = node.parent) if (matches(node, selector)) return node; return null; },
    contains(other) { for (let node = other; node; node = node.parent) if (node === this) return true; return false; },
    querySelectorAll(selector) { const out = [], walk = node => { for (const child of node.children) { if (matches(child, selector)) out.push(child); walk(child); } }; walk(this); return out; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    focus() { c.document.activeElement = this; },
  };
  for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) el.dataset[camel(key.slice(5))] = value;
  return el;
}
function parse(markup) {
  const root = makeElement('#root'), stack = [root];
  for (const m of markup.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g)) {
    if (m[5] !== undefined) { for (const open of stack) open.textContent += m[5]; continue; }
    const name = m[2].toLowerCase();
    if (m[1]) { while (stack.length > 1 && stack.pop().tag !== name); continue; }
    const attrs = {}; for (const a of m[3].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
    const el = makeElement(name, attrs); el.parent = stack.at(-1); stack.at(-1).children.push(el);
    if (!VOID.has(name) && !m[4]) stack.push(el);
  }
  return root;
}

// ── Fake clock, listeners and the UI context.
let now = 1000, nextTimer = 1; const timers = new Map();
const advance = ms => {
  const end = now + ms;
  for (;;) {
    let due = null; for (const [id, t] of timers) if (t.at <= end && (!due || t.at < due[1].at)) due = [id, t];
    if (!due) break; timers.delete(due[0]); now = due[1].at; due[1].fn();
  }
  now = end;
};
const listeners = {}, listen = (type, fn) => { (listeners[type] ||= []).push(fn); };
const fire = (type, event) => { for (const fn of listeners[type] || []) fn(event); };
const modalListeners = {}, modal = { open: true, addEventListener: (type, fn) => { (modalListeners[type] ||= []).push(fn); } };
let content = makeElement('#root');
const engine = new Engine(); engine.newGame(DATA.starters[0]);
const lead = engine.state.party[0]; lead.level = 32; engine.restoreMonster(lead);
const counts = { open: 0, save: 0, updateAll: 0 }, fx = [], toasts = [];
const c = vm.createContext({
  console, Engine, DATA, LT: model.LT, engine, playing: true, activePane: '',
  escape: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
  portrait: () => '<canvas></canvas>', creatureView: () => '<div class="creature-view"><canvas></canvas></div>',
  nameOf: mon => model.LT.displayName(mon), shinyBadge: () => '', typeBadge: () => '', speciesBadges: () => '', abilityPanel: () => '', creatureDescription: s => s.description || '',
  hpBar: mon => `<div class="hp-track"><span class="hp-fill" data-hp="${mon.hp}"></span></div>`, ico: () => '',
  openModal(title, markup, pane) { counts.open += 1; c.activePane = pane; content = parse(markup); modal.open = true; },
  $: id => (id === 'modal' ? modal : id === 'modal-content' ? content : null),
  toast: message => toasts.push(message), save: () => { counts.save += 1; }, updateAll: () => { counts.updateAll += 1; },
  sound: { fx: kind => fx.push(kind) }, tradeLocked: () => false, rankedLocked: () => false,
  setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, at: now + ms }); return id; },
  clearTimeout: id => { timers.delete(id); },
  performance: { now: () => now },
  document: { activeElement: null, addEventListener: listen },
  window: { addEventListener: listen },
});
const slice = (from, to) => {
  const start = html.indexOf(from), end = html.indexOf(to, start);
  assert(start > 0 && end > start, `${from.trim()} … ${to.trim()} must exist`); return html.slice(start, end);
};
vm.runInContext(slice('  function partyDepositReason(', '  function showStorage('), c);
vm.runInContext(slice("  document.addEventListener('click',e=>{", '  function resize() {'), c);

const q = selector => content.querySelector(selector);
const value = key => q(`[data-alloc-stat="${key}"]`).textContent;
const free = () => Number(q('[data-alloc-free]').textContent);
const click = el => fire('click', { target: el });
const press = (el, pointerId) => fire('pointerdown', { target: el, button: 0, isPrimary: true, pointerId });
const release = pointerId => fire('pointerup', { pointerId });

// Opening the detail renders once, with hooks for in-place updates.
c.showParty(0);
assert.equal(counts.open, 1); assert.equal(c.activePane, 'party');
assert(q('.alloc-panel[data-alloc-index="0"]'), 'panel names its party slot');
assert(q('.party-vitals') && q('.stat-grid') && q('.alloc-tip'), 'vitals, stat grid and tip are present');
const total = engine.allocationInfo(lead).total;
assert.equal(free(), total); assert.equal(q('[data-alloc="0:atk:-1"]').disabled, true, 'nothing to take back yet');

// Three taps in a row: same screen, numbers and stats follow, one deferred save.
const atkBefore = engine.stats(lead).atk;
for (let i = 0; i < 3; i++) click(q('[data-alloc="0:atk:1"]'));
assert.equal(counts.open, 1, 'taps never re-open the detail (which resets the scroll)');
assert.equal(value('atk'), '3'); assert.equal(free(), total - 3); assert.equal(lead.alloc.atk, 3);
assert.equal(q('[data-alloc="0:atk:-1"]').disabled, false, 'take-back unlocks after a point is placed');
assert(q('.stat-grid').innerHTML.includes(`<strong>${atkBefore + 3}</strong>`), 'stat grid shows the new attack');
assert.deepEqual(fx, ['click', 'click', 'click']);
assert.equal(counts.save, 0, 'saving waits for the burst to end'); advance(239); assert.equal(counts.save, 0);
advance(1); assert.equal(counts.save, 1); assert.equal(counts.updateAll, 1, 'one save and one HUD refresh per burst');

// HP points also refresh the HP line.
const hpBefore = engine.stats(lead).hp; click(q('[data-alloc="0:hp:1"]'));
assert(q('.party-vitals').innerHTML.includes(`/ ${hpBefore + 2}`), 'HP line shows +2 max HP per point');
click(q('[data-alloc="0:hp:-1"]')); assert.equal(value('hp'), '0');

// Press and hold: nothing before 450 ms, then repeats; the click after release is not counted twice.
const speedPlus = q('[data-alloc="0:speed:1"]');
press(speedPlus, 7); advance(449); assert.equal(value('speed'), '0', 'a short press waits for the click');
advance(1); assert.equal(value('speed'), '1', 'hold starts repeating');
advance(450); assert.equal(value('speed'), '4', 'repeats speed up while held');
release(7); click(speedPlus); assert.equal(value('speed'), '4', 'release click after a hold is swallowed');
advance(1000); assert.equal(value('speed'), '4', 'release stops repeating');
press(speedPlus, 8); release(8); click(speedPlus); assert.equal(value('speed'), '5', 'the next tap counts normally');
assert.equal(counts.open, 1);

// Dragging off the button, cancelling or leaving the window stops a hold.
press(speedPlus, 9); advance(600); assert.equal(value('speed'), '7');
fire('pointerout', { pointerId: 9, target: speedPlus, relatedTarget: q('.alloc-tip') }); advance(1000); assert.equal(value('speed'), '7');
press(speedPlus, 10); advance(450); fire('pointercancel', { pointerId: 10 }); advance(1000); assert.equal(value('speed'), '8');
press(speedPlus, 11); advance(450); fire('blur', {}); advance(1000); assert.equal(value('speed'), '9');
release(11);
let prevented = false; fire('contextmenu', { target: speedPlus, preventDefault: () => { prevented = true; } });
assert(prevented, 'long-press menu is suppressed on allocation buttons');

// Hold until the points run out: the hold ends by itself and focus moves to a usable button.
const hpPlus5 = q('[data-alloc="0:hp:5"]'); c.document.activeElement = hpPlus5;
press(hpPlus5, 12); advance(20000);
assert.equal(free(), 0); assert.equal(Number(value('hp')), total - 3 - 9);
assert(content.querySelectorAll('[data-alloc]').filter(b => /:(1|5)$/.test(b.dataset.alloc)).every(b => b.disabled), 'all + buttons lock at 0 points');
assert.equal(timers.size === 0 || [...timers.values()].every(t => t.fn.name === 'commitAllocation'), true, 'no repeat timer left running');
assert.equal(c.document.activeElement, q('[data-alloc="0:hp:-5"]'), 'focus moves to a button that still works');
assert.equal(q('[data-alloc-auto="0"]').disabled, true);
release(12); advance(300);

// Reset and おまかせ also update in place.
click(q('[data-alloc-reset="0"]'));
assert.equal(free(), total); assert.equal(value('atk'), '0'); assert.equal(q('[data-alloc-reset="0"]').disabled, true);
click(q('[data-alloc-auto="0"]'));
assert.equal(free(), 0); assert.equal(q('[data-alloc-auto="0"]').disabled, true); assert.equal(q('[data-alloc-reset="0"]').disabled, false);
assert.equal(counts.open, 1, 'reset and auto stay on the same screen');

// Closing the detail saves the pending change at once.
click(q('[data-alloc-reset="0"]')); const saves = counts.save;
modal.open = false; for (const fn of modalListeners.close || []) fn();
assert.equal(counts.save, saves + 1, 'closing commits immediately'); advance(1000); assert.equal(counts.save, saves + 1, 'and only once');

// If another screen is showing, a change falls back to drawing the detail.
c.activePane = 'bag'; c.applyAllocation('0:def:1');
assert.equal(counts.open, 2); assert.equal(c.activePane, 'party'); assert.equal(value('def'), '1');

// Battles still block changes.
engine.battle = {}; const toastCount = toasts.length; click(q('[data-alloc="0:def:1"]'));
assert.equal(value('def'), '1'); assert.equal(toasts.length, toastCount + 1); assert.match(toasts.at(-1), /バトル中/);
engine.battle = null;

// Direct battle growth changes abilities without creating allocation points.
const veteran = engine.makeMonster('komorizen', 1); veteran.heldItem = 'trainband';
engine.state.party = [veteran]; engine.markCaught(veteran.species);
const growth = [], earnedXP = Array.from({ length: 99 }, (_, i) => engine.xpToNext(i + 1)).reduce((sum, value) => sum + value, 0);
engine.giveXP(veteran, earnedXP, growth, { battleParticipation: true });
assert.equal(veteran.level, 100); assert.equal(veteran.bonusPoints, 99); assert.equal(veteran.battleGrowth, 99);
assert.equal(engine.allocationInfo(veteran).total, 297); assert.equal(growth.filter(event => event.kind === 'level').length, 99);
c.showParty(0); const grownOpenCount = counts.open;
assert.equal(free(), 297); assert.equal(q('[data-alloc-auto="0"]').disabled, false);
assert(q('.battle-growth-summary'), 'the individual detail identifies accumulated direct battle growth');
click(q('[data-alloc-auto="0"]'));
assert.equal(counts.open, grownOpenCount, 'allocation refreshes the existing detail');
assert.equal(engine.allocationInfo(veteran).used, 297); assert.equal(free(), 0);
assert.equal(q('[data-alloc-auto="0"]').disabled, true);
const beforeReset = engine.stats(veteran), allocated = { ...veteran.alloc };
click(q('[data-alloc-reset="0"]'));
assert.equal(free(), 297); assert.equal(veteran.battleGrowth, 99, 'resetting allocation does not erase earned direct growth');
const afterReset = engine.stats(veteran), ordinary = engine.stats({ ...veteran, battleGrowth: 0 });
for (const key of DATA.allocation.keys) {
  assert.equal(beforeReset[key] - afterReset[key], (allocated[key] || 0) * (key === 'hp' ? 2 : 1));
  assert.equal(afterReset[key] - ordinary[key], key === 'hp' ? 198 : 99);
}
const restored = new Engine(engine.serialize()), restoredMon = restored.state.party[0];
assert.equal(restoredMon.battleGrowth, 99); assert.equal(restored.allocationInfo(restoredMon).total, 297);
assert.deepEqual(JSON.parse(JSON.stringify(restored.stats(restoredMon))), JSON.parse(JSON.stringify(afterReset)));

console.log(JSON.stringify({ ok: true, checks: ['in-place taps', 'deferred single save', 'HP line', 'press-and-hold', 'release click', 'drag-off/cancel/blur', 'run-out focus', 'reset/auto', 'close commit', 'fallback', 'battle guard', 'direct growth shown separately from 297 allocation points', 'allocation reset preserves direct growth', 'direct stats survive reload'] }));
