#!/usr/bin/env node
'use strict';
/* Conditions show every turn. Both battle engines give each afflicted monster
 * one condition event per turn — when the condition lands, when it stops a
 * move, as a damage tick, or otherwise as an end-of-turn reminder — without
 * drawing extra random numbers; online peers stay in step. The effects module
 * turns every such event into a motif on that monster (spores, bubble, flames,
 * stars, crystal), plus the bubble pop and the crystal shatter when one ends;
 * the sprites react, adventure and online playback give each one a beat, and
 * every condition has its own sound. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { canvas, imageStats } = require('./check-art.cjs');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const vfxSource = fs.readFileSync(path.join(root, 'battle-vfx.js'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(m => m[2]);
const copy = value => JSON.parse(JSON.stringify(value));
const timers = new Set();
const context = vm.createContext({ console, crypto: webcrypto, TextEncoder, Uint8Array, Uint32Array,
  setTimeout(fn, ms) { const id = setTimeout(fn, ms); id.unref(); timers.add(id); return id; },
  clearTimeout(id) { timers.delete(id); clearTimeout(id); } });
const loaded = new Set();
for (const marker of ['original world and game data', 'Original creature atlas and optional journeys', 'the Meridian Accord, an original 256-species atlas', 'two-stage starter lineages, retaining every existing species ID',
  'Initial companions are selected once', 'Arvelion, the original roaming legendary', 'owner-only leaf mythical, outside all ordinary acquisition pools', 'deterministic combat, interiors, league and versioned saves',
  'deterministic, save-independent rental-team duels', 'peer-to-peer casual duel protocol']) {
  const code = scripts.find(text => text.includes(marker)); assert(code, `Missing production script: ${marker}`);
  if (!loaded.has(code)) { loaded.add(code); vm.runInContext(code, context); }
}
vm.runInContext(vfxSource, context);
const { LT } = context, D = LT.DATA, { Engine, Duel } = LT, V = LT.BattleVFX;
const KINDS = ['bloom', 'bubble', 'scorch', 'dizzy', 'crystal'];
assert.deepEqual([...V.conditions], KINDS); assert.deepEqual(Object.keys(D.statuses).sort(), [...KINDS].sort());
for (const kind of KINDS) assert(D.statuses[kind].ongoing && !D.statuses[kind].ongoing.includes('undefined'), `${kind}: an end-of-turn line`);
const isCondition = e => e.kind === 'status' || e.kind === 'statusTick';

// ── Adventure: every turn shows each condition of the two active monsters once.
const hero = (level = 50) => { const e = new Engine(); e.newGame('hibana'); const m = e.state.party[0]; m.level = level; e.restoreMonster(m); return e; };
function battle(allyStatus, enemyStatus, extra = {}) {
  const e = hero(); e.startBattle('fuwari', 50); const ally = e.state.party[e.battle.activeIndex], foe = e.battle.enemy;
  for (const [mon, status] of [[ally, allyStatus], [foe, enemyStatus]]) if (status) { mon.status = status; if (status === 'crystal') mon.statusTurns = extra.turns ?? 2; }
  ally.hp = e.stats(ally).hp; foe.hp = e.stats(foe).hp; e.rng = () => .5; // hits, no criticals, dizzy acts, bubbles hold, no new conditions
  return { e, ally, foe };
}
const forSide = (events, side) => [...events].filter(x => isCondition(x) && x.side === side);
{
  // 目眩 that does not stop the move: a reminder at the end of the turn, after both moves.
  const { e } = battle('dizzy', null); const r = e.action({ type: 'move', index: 0 });
  assert(r.ok && !r.ended); const mine = forSide(r.events, 'ally');
  assert.equal(mine.length, 1); assert.equal(mine[0].status, 'dizzy'); assert.equal(mine[0].ongoing, true); assert.match(mine[0].text, /目が回ってふらついている/);
  assert(r.events.indexOf(mine[0]) > r.events.findLastIndex(x => x.kind === 'damage'), 'the reminder closes the turn');
  assert.equal(forSide(r.events, 'enemy').length, 0, 'a healthy monster shows nothing');
  // The same condition, turn after turn.
  for (let turn = 0; turn < 3; turn++) { const next = e.action({ type: 'move', index: 0 }); if (next.ended) break; assert.equal(forSide(next.events, 'ally').filter(x => x.status === 'dizzy').length, 1, `turn ${turn + 2}`); }
}
{
  // 結晶化 and 水封 that stop the move show then, and only then.
  for (const kind of ['crystal', 'bubble']) {
    const { e } = battle(kind, null); const r = e.action({ type: 'move', index: 0 }), mine = forSide(r.events, 'ally');
    assert.equal(mine.length, 1, `${kind}: one event`); assert.equal(mine[0].blocked, true); assert.match(mine[0].text, /動けない/);
  }
  // A held turn (an item instead of a move) still shows the condition at the end of the turn.
  const { e, ally } = battle('bubble', null); ally.hp = Math.floor(ally.hp / 2); e.state.inventory.salve = 1;
  const r = e.action({ type: 'item', id: 'salve' }); assert(r.ok); const mine = forSide(r.events, 'ally');
  assert.equal(mine.length, 1); assert.equal(mine[0].ongoing, true); assert.match(mine[0].text, /泡に閉じ込められている/);
  // Breaking free shows the end of the condition and nothing after it.
  const free = battle('crystal', null, { turns: 0 }), out = free.e.action({ type: 'move', index: 0 }), shown = forSide(out.events, 'ally');
  assert.equal(shown.length, 1); assert.equal(shown[0].status, 'cure'); assert.equal(shown[0].was, 'crystal'); assert.equal(free.ally.status, undefined);
}
{
  // 花毒 and 灯焼け tick every turn and need no extra reminder; both monsters can show theirs.
  const { e } = battle('bloom', 'scorch'); const r = e.action({ type: 'move', index: 0 });
  assert.deepEqual(forSide(r.events, 'ally').map(x => x.kind + ':' + x.status), ['statusTick:bloom']);
  assert.deepEqual(forSide(r.events, 'enemy').map(x => x.kind + ':' + x.status), ['statusTick:scorch']);
  const both = battle('dizzy', 'crystal').e.action({ type: 'move', index: 0 }); // crystal: a fire move would pop a bubble
  assert.deepEqual(forSide(both.events, 'ally').map(x => x.status), ['dizzy']); assert.deepEqual(forSide(both.events, 'enemy').map(x => x.status), ['crystal']);
}
{
  // A condition that lands this turn already showed itself: no second reminder.
  const { e, ally, foe } = battle(null, null); const queue = [0, .99, .5, 0];
  e.rng = () => queue.length ? queue.shift() : .5; const wind = Object.values(D.moves).find(m => m.kind === 'attack' && m.element === 'wind' && !m.effect);
  const events = []; e.applyMove(foe, ally, wind, 'enemy', events); assert.equal(ally.status, 'dizzy'); e.endOfTurn(events);
  assert.deepEqual(forSide(events, 'ally').map(x => [x.status, !!x.ongoing]), [['dizzy', false]]);
  // End-of-turn reminders draw no random numbers.
  const quiet = battle('dizzy', 'crystal').e; let draws = 0; quiet.rng = () => { draws++; return .5; }; quiet.endOfTurn([]); assert.equal(draws, 0);
}

// ── Duels (online and local): the same rule, on the seeded random numbers, identical on both peers.
const POOL = ['komori', 'fuwari', 'kirari', 'shizuku', 'hibana'];
function duel(mode = 'single', seed = 9) {
  const size = mode === 'double' ? 4 : 3;
  return Duel.create({ mode, teams: [POOL.slice(0, size), POOL.slice(1, size + 1)], seed });
}
const ordersOf = d => [0, 1].map(side => d.legalOrders(side));
function invariant(d, label) {
  // Every afflicted active monster has at least one condition event this turn; a reminder only when nothing else showed.
  d.state.teams.forEach((team, side) => team.active.forEach((index, slot) => {
    const mon = team.monsters[index]; if (mon.hp <= 0 || !mon.status) return;
    const mine = [...d.state.events].filter(x => isCondition(x) && x.side === side && (x.slot || 0) === slot && x.status === mon.status);
    assert(mine.length >= 1, `${label}: ${side}/${slot} ${mon.status} shown`);
    const reminders = mine.filter(x => x.ongoing); assert(reminders.length <= 1, `${label}: one reminder at most`);
    if (reminders.length) assert.equal(mine.length, 1, `${label}: a reminder only when nothing else showed`);
  }));
}
{
  let d = duel(); d.active(0)[0].status = 'dizzy'; d._random = () => .5; d.resolve(ordersOf(d));
  const mine = [...d.state.events].filter(x => isCondition(x) && x.side === 0);
  assert.equal(mine.length, 1); assert.equal(mine[0].ongoing, true); assert.equal(mine[0].slot, 0); assert.match(mine[0].text, /目が回ってふらついている/); invariant(d, 'dizzy');
  d = duel(); d.active(1)[0].status = 'crystal'; d.active(1)[0].statusTurns = 2; d._random = () => .5; d.resolve(ordersOf(d));
  assert.deepEqual([...d.state.events].filter(x => isCondition(x) && x.side === 1).map(x => !!x.blocked), [true]); invariant(d, 'crystal');
  d = duel(); d.active(0)[0].status = 'bloom'; d._random = () => .5; d.resolve(ordersOf(d));
  assert.deepEqual([...d.state.events].filter(x => isCondition(x) && x.side === 0).map(x => x.kind), ['statusTick']);
  // The end of a turn draws no random numbers.
  d = duel(); d.active(0)[0].status = 'dizzy'; d.active(1)[0].status = 'bubble';
  const end = d._endOfTurn.bind(d); let unchanged = null; d._endOfTurn = () => { const before = d.state.rng; end(); unchanged = d.state.rng === before; };
  const rngBefore = d.state.rng; d.resolve(ordersOf(d)); assert.equal(unchanged, true); assert.notEqual(d.state.rng, rngBefore, 'the turn itself did draw');
  // Two peers of a double duel with conditions on both sides stay identical, turn after turn.
  const peers = [duel('double', 31337), duel('double', 31337)];
  for (const p of peers) { p.active(0)[0].status = 'dizzy'; p.active(0)[1].status = 'bloom'; p.active(1)[0].status = 'bubble'; p.active(1)[1].status = 'crystal'; p.active(1)[1].statusTurns = 3; }
  let turns = 0, reminders = 0;
  while (peers[0].state.winner === null && turns < 40) {
    const orders = ordersOf(peers[0]); peers.forEach(p => p.resolve(copy(orders)));
    assert.equal(peers[0].fingerprint(), peers[1].fingerprint(), `turn ${turns}: both peers agree`);
    if (peers[0].state.winner === null && !peers[0].state.events.some(x => x.kind === 'replacement')) invariant(peers[0], `double turn ${turns}`);
    reminders += peers[0].state.events.filter(x => x.ongoing).length; turns++;
  }
  assert(reminders > 0, 'reminders appeared during the duel');
  assert.equal(Duel.rules.version, 6); assert.match(Duel.rules.conditions, /shown-every-turn/);
}

// ── Effects: every condition event becomes a motif on the afflicted monster.
const MOMENTS = { inflict: 1100, blocked: 1000, ongoing: 950, tick: 1000, cure: 820 };
const eventFor = (kind, moment, side = 'ally', extra = {}) => moment === 'tick' ? { kind: 'statusTick', side, status: kind, amount: 12, ...extra }
  : moment === 'cure' ? { kind: 'status', side, status: 'cure', was: kind, ...extra } : { kind: 'status', side, status: kind, ...(moment === 'blocked' ? { blocked: true } : moment === 'ongoing' ? { ongoing: true } : {}), ...extra };
for (const kind of KINDS) for (const moment of Object.keys(MOMENTS)) {
  const fx = V.fromEvent(eventFor(kind, moment, 1, { slot: 1 }), null, 100);
  assert.equal(fx.style, 'condition'); assert.equal(fx.condition, kind); assert.equal(fx.moment, moment); assert.equal(fx.duration, MOMENTS[moment]);
  assert.equal(fx.side, 1); assert.equal(fx.slot, 1); assert.equal(fx.amount, moment === 'tick' ? 12 : 0);
  for (const [side, options] of [['ally', {}], ['enemy', {}], [1, { online: true, double: true, side: 1 }], [0, { online: true, double: true, side: 1 }]]) {
    const a = V.anchors(768, 440, { ...fx, side }, options); assert.deepEqual(a.source, a.target, 'the motif stays on the afflicted monster');
  }
}
// The engines' own lines map too, including older events without markers.
assert.equal(V.fromEvent({ kind: 'status', side: 'ally', status: 'dizzy', text: 'コモリは目が回って動けない！' }, null, 1).moment, 'blocked');
assert.equal(V.fromEvent({ kind: 'status', side: 'ally', status: 'cure', text: 'コモリは泡から抜け出した！' }, null, 1).condition, 'bubble');
assert.equal(V.fromEvent({ kind: 'status', side: 'ally', status: 'cure', text: 'コモリを包む結晶が砕けた！' }, null, 1).condition, 'crystal');
assert.equal(V.fromEvent({ kind: 'statusTick', side: 0, status: 'bloom', text: 'Aのコモリは花毒で7ダメージ。' }, null, 1).amount, 7);
assert.equal(V.fromEvent({ kind: 'status', side: 'ally', status: 'nope' }, null, 1), null);
assert.equal(V.fromEvent({ kind: 'status', side: 'ally', status: 'cure', text: '？' }, null, 1), null);
{
  // Drawing: every motif and moment paints at both qualities, deterministically, never with reduced motion.
  const cv = canvas.createCanvas(768, 440), c = cv.getContext('2d'), hashes = new Map();
  let frames = 0;
  for (const kind of KINDS) for (const moment of Object.keys(MOMENTS)) for (const quality of ['high', 'low']) {
    const fx = { ...V.fromEvent(eventFor(kind, moment, (frames % 2) ? 'enemy' : 'ally'), null, 100) };
    for (const age of [.2, .5, .8]) {
      c.clearRect(0, 0, 768, 440); assert.equal(V.render(c, 768, 440, 100 + age * fx.duration, fx, { quality }), true);
      const first = imageStats(cv); assert(first.opaque > 0, `${kind}/${moment}/${quality}/${age} paints`);
      c.clearRect(0, 0, 768, 440); V.render(c, 768, 440, 100 + age * fx.duration, fx, { quality }); assert.equal(imageStats(cv).hash, first.hash, 'deterministic');
      if (quality === 'high' && age === .5) hashes.set(kind + ':' + moment, first.hash); frames++;
    }
    c.clearRect(0, 0, 768, 440); assert.equal(V.render(c, 768, 440, 100 + fx.duration / 2, fx, { reducedMotion: true }), false); assert.equal(imageStats(cv).opaque, 0);
    assert.equal(V.render(c, 768, 440, 100 + fx.duration + 1, fx), false, 'finished motifs clear');
  }
  assert.equal(new Set(KINDS.map(kind => hashes.get(kind + ':ongoing'))).size, 5, 'five distinct motifs');
  for (const kind of ['bubble', 'crystal']) assert.notEqual(hashes.get(kind + ':cure'), hashes.get(kind + ':ongoing'), `${kind} breaks visibly`);
  // Finite geometry at tiny sizes and phase edges, bounded work, no leaked canvas state.
  let calls = 0, largest = 0;
  const geometry = new Set(['moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'ellipse', 'fillRect', 'strokeRect', 'translate', 'rotate', 'scale', 'createRadialGradient']);
  const measured = new Proxy(c, { get(target, key) { const value = Reflect.get(target, key, target); if (typeof value !== 'function') return value;
    return (...args) => { calls++; if (geometry.has(key)) for (const n of args) if (typeof n === 'number') assert(Number.isFinite(n), `${String(key)} received a nonfinite value`); return value.apply(target, args); }; },
    set(target, key, value) { return Reflect.set(target, key, value, target); } });
  for (const kind of KINDS) for (const moment of Object.keys(MOMENTS)) for (const [w, h] of [[64, 40], [768, 440]]) for (const age of [0, .001, .3, .5, .999, 1]) {
    const fx = V.fromEvent(eventFor(kind, moment, 'enemy'), null, 100); calls = 0;
    V.render(measured, w, h, 100 + age * fx.duration, fx, { quality: 'low' }); largest = Math.max(largest, calls);
    assert(calls < 2600, `${kind}/${moment} stays within the low quality budget (${calls})`);
    assert.equal(c.globalAlpha, 1); assert.equal(c.globalCompositeOperation, 'source-over');
  }
  // Online doubles: the motif sits on the chosen slot.
  const a = V.anchors(1000, 500, { kind: 'status', side: 1, slot: 1 }, { online: true, double: true, side: 1 }); assert.deepEqual({ ...a.source }, { x: 470, y: 375 });
  console.log(JSON.stringify({ step: 'effects', frames, largestLowQualityCalls: largest }));
}

// ── Online playback: condition events are effect beats; a damage tick settles like a hit.
{
  const teams = copy(duel().state.teams), visual = { teams };
  const state = { seed: 5, round: 2, turn: 1, winner: null, teams, events: [
    { kind: 'turn', text: '第1ターン', visual }, { kind: 'status', side: 0, slot: 0, status: 'dizzy', blocked: true, text: 'Aのコモリは目が回って動けない！', visual },
    { kind: 'statusTick', side: 1, slot: 0, status: 'bloom', amount: 9, text: 'Bのフワリは花毒で9ダメージ。', visual }, { kind: 'status', side: 1, slot: 0, status: 'bubble', ongoing: true, text: 'Bのフワリは泡に閉じ込められている。', visual }] };
  const plan = V.onlinePlan(state); assert.deepEqual([...plan.beats].map(b => b.kind), ['text', 'status', 'statusTick', 'status']);
  const tick = plan.beats[2]; assert(tick.until - tick.start >= 1000 + 400, 'a tick plays in full and settles');
  plan.beats.slice(1).forEach(b => assert(b.until - b.start >= 950, 'each condition keeps its beat'));
  // The online hook plays the condition's sound once, when its beat starts.
  const sounds = []; let drawn;
  const hook = { DATA: D, playStatusSound: e => sounds.push(e.condition + ':' + e.moment), Art: { battle() {} }, PixelSprites: { duel: (cv, s, side, time, options) => { drawn = options; } } };
  vm.runInNewContext(vfxSource, { LT: hook, module: { exports: {} }, localStorage: { getItem: () => null } });
  const small = canvas.createCanvas(64, 40);
  for (let at = 5000; at < 17000; at += 40) hook.PixelSprites.duel(small, state, 0, at);
  assert.deepEqual(sounds, ['dizzy:blocked', 'bloom:tick', 'bubble:ongoing'], 'each condition sounds once, in order');
  assert(drawn, 'the duel renderer was called');
}

// ── Adventure playback: the motif plays, its sound starts, a tick drains the bar on its impact.
{
  const begin = html.indexOf('  function captureBattleView()'), finish = html.indexOf('  function openBattle()', begin); assert(begin > 0 && finish > begin);
  function harness(engine) {
    const log = { children: [], replaceChildren() { this.children = []; }, appendChild(node) { this.children.push(node); }, scrollTop: 0, scrollHeight: 100 };
    const nodes = { 'battle-log': log, 'battle-actions': { querySelectorAll: () => [] }, 'game-canvas': { classList: { remove() {} } } };
    const out = { frames: [], sounds: [] };
    const c = vm.createContext({ engine, LT, DATA: D, battleView: null, battleEffect: null, busy: false, evolutionUntil: 0, settings: { reducedMotion: false }, performance: { now: () => 100 },
      $: id => nodes[id], document: { createElement: () => ({ textContent: '' }) }, toast() {}, updateScene() {}, updateAll() {}, updateBattle() {}, save() {},
      sound: { fx: (name, detail) => out.sounds.push(name === 'status' ? `status:${detail?.condition}:${detail?.moment}` : name), move() {} },
      setTimeout(fn, duration) { out.frames.push({ duration, effect: c.battleEffect && copy(c.battleEffect), hp: c.battleView && copy(c.battleView.state.party[c.battleView.battle.activeIndex].hp) }); return setTimeout(fn, 0); },
      clearTimeout(id) { clearTimeout(id); } });
    vm.runInContext(html.slice(begin, finish), c); return { c, out };
  }
  (async () => {
    let { e } = battle('dizzy', null); let { c, out } = harness(e); await c.doBattle({ type: 'move', index: 0 });
    const motif = out.frames.find(f => f.effect?.style === 'condition'); assert(motif, 'the condition plays as an effect');
    assert.equal(motif.effect.condition, 'dizzy'); assert.equal(motif.effect.moment, 'ongoing'); assert(motif.duration >= motif.effect.duration + 400, 'the motif gets its own beat');
    assert(out.sounds.includes('status:dizzy:ongoing'), 'its sound plays');
    ({ e } = battle('bloom', null)); ({ c, out } = harness(e)); await c.doBattle({ type: 'move', index: 0 });
    const ticks = out.frames.filter(f => f.effect?.kind === 'statusTick'); assert(ticks.length >= 2, 'the tick plays as an effect');
    assert(ticks.some(f => f.duration === Math.round(1000 * .45)), 'the tick drains the bar on its impact');
    assert(out.sounds.includes('status:bloom:tick'));
    for (const id of timers) clearTimeout(id);
    audioAndPose();
  })().catch(error => { console.error(error); process.exit(1); });
}

// ── Sound and sprite poses.
function audioAndPose() {
  const engineSource = scripts.find(code => code.includes('64 original scores and a bounded Web Audio ensemble')); assert(engineSource, 'music engine script');
  class Param { constructor(v = 0) { this.value = v; } setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} exponentialRampToValueAtTime(v) { this.value = v; } }
  class Node { constructor() { for (const k of ['gain', 'frequency', 'Q', 'detune', 'pan', 'delayTime', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[k] = new Param(1); } connect(n) { return n; } disconnect() {} start() {} stop() {} setPeriodicWave() {} }
  class Context { constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = new Node(); }
    resume() { this.state = 'running'; return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); }
    createGain() { return new Node(); } createOscillator() { return new Node(); } createBiquadFilter() { return new Node(); } createStereoPanner() { return new Node(); } createDynamicsCompressor() { return new Node(); }
    createConvolver() { return new Node(); } createDelay() { return new Node(); } createBufferSource() { return new Node(); } createWaveShaper() { return new Node(); } createPeriodicWave() { return {}; }
    createBuffer(ch, len) { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { getChannelData: i => d[i] }; } createMediaElementSource() { return new Node(); } }
  const sandbox = { console, AudioContext: Context, Audio: class { play() { return Promise.resolve(); } pause() {} setAttribute() {} removeAttribute() {} }, matchMedia: () => ({ matches: false }),
    document: { hidden: false, dispatchEvent() {} }, CustomEvent: class {}, navigator: {}, setTimeout: () => 0, clearTimeout() {}, URL: { createObjectURL: () => '' }, fetch: () => new Promise(() => {}) };
  vm.createContext(sandbox); vm.runInContext(engineSource, sandbox);
  const audio = new sandbox.LT.Audio(); audio.ctx = new Context(); audio.enabled = true; const played = [];
  audio.instrument = (_, name, note) => played.push(name + note); audio.drum = (_, name) => played.push(name);
  const motifs = new Set();
  for (const kind of KINDS) for (const moment of ['inflict', 'tick', 'cure']) {
    played.length = 0; audio.lastFX = -1; audio.fx('status', { condition: kind, moment }); assert(played.length >= 3, `${kind}/${moment} sounds`); motifs.add(played.join(','));
  }
  assert(motifs.size >= 10, 'each condition has its own motif');
  // Poses: the afflicted monster reacts; the other side stays still.
  const poseSource = html.slice(html.indexOf('function battlePose('), html.indexOf('\nfunction battleFacing('));
  const pose = vm.runInNewContext(poseSource + ';battlePose');
  const at = fx => fx.started + fx.duration / 2;
  let fx = V.fromEvent({ kind: 'status', side: 'ally', status: 'dizzy', ongoing: true }, null, 0);
  assert.deepEqual({ ...pose(fx, at(fx), 'ally', 0, {}) }, { action: 'status', progress: .5, statusKind: 'dizzy' }); assert.deepEqual({ ...pose(fx, at(fx), 'enemy', 0, {}) }, {});
  fx = V.fromEvent({ kind: 'statusTick', side: 'enemy', status: 'scorch', amount: 3 }, null, 0);
  assert.equal(pose(fx, at(fx), 'enemy', 0, {}).action, 'hit'); assert.deepEqual({ ...pose(fx, at(fx), 'ally', 0, {}) }, {});
  fx = V.fromEvent({ kind: 'status', side: 1, slot: 1, status: 'cure', was: 'bubble' }, null, 0);
  assert.equal(pose(fx, at(fx), 'ally', 1, { online: true, side: 1 }).action, 'cast'); assert.deepEqual({ ...pose(fx, at(fx), 'ally', 0, { online: true, side: 1 }) }, {});
  // A plain message (turn header, item line) moves nobody.
  const text = { kind: 'text', style: 'text', started: 0, duration: 900, side: 0, slot: 0, target: 0 };
  for (const side of ['ally', 'enemy']) assert.deepEqual({ ...pose(text, 450, side, 0, { online: true, side: 0 }) }, {});
  // Page wiring.
  for (const needle of ["LT.playStatusSound=effect=>sound.fx('status',effect);", "else if(effect?.style==='condition')sound.fx('status',effect);",
    "['damage','heal','recoil','attack','statusTick'].includes(event.kind)", "}else if(options.action==='status'){", "if(kind==='status'){"])
    assert(html.includes(needle), `index.html: ${needle}`);
  console.log(JSON.stringify({ ok: true, conditions: KINDS.map(k => D.statuses[k].name),
    checks: ['adventure: one condition event per afflicted monster per turn', 'reminder at the end of a turn only when nothing else showed', 'held turns, breaking free, new conditions, ticks', 'no extra random numbers',
      'duel: same rule, identical peers, rules version 6', 'five motifs and two breaks, both qualities, deterministic', 'reduced motion and finished motifs draw nothing', 'finite and bounded drawing',
      'online beats and sounds once', 'adventure beat, sound and tick impact', 'condition sounds', 'poses on the afflicted monster only'] }));
}
