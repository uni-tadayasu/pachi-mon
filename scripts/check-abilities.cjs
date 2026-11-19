#!/usr/bin/env node
'use strict';
// Exercise the shipped battle engines. A copied species has the same types,
// stats and moves, but no canonical assignment: it is the no-ability control.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = JSON.parse(fs.readFileSync(path.join(root, 'data/species-abilities.json'), 'utf8'));
const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const copy = value => JSON.parse(JSON.stringify(value));
const script = marker => {
  const found = blocks.find(([, attrs, code]) => !/\bsrc=|application\/ld\+json/.test(attrs) && code.includes(marker));
  assert(found, marker); return found[2];
};
function runtime() {
  const timers = new Set(), context = vm.createContext({ console, crypto: webcrypto, TextEncoder, Uint8Array, Uint32Array,
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); } });
  for (const [, attrs, code] of blocks) {
    if (/\bsrc=|application\/ld\+json/.test(attrs)) continue;
    vm.runInContext(code, context);
    if (context.LT?.Engine) break;
  }
  vm.runInContext(script('deterministic, save-independent rental-team duels'), context);
  vm.runInContext(script('peer-to-peer casual duel protocol'), context);
  return { context, LT: context.LT, close() { for (const timer of timers) clearTimeout(timer); } };
}
const env = runtime(), { LT } = env, { DATA: D, Abilities: A, Engine, Duel, TypeSystem: T } = LT;
const modes = ['solo', 'single', 'double'], originalIds = Object.keys(D.species);
assert.equal(originalIds.length, 259, 'Every existing species, including hidden and special companions, is covered');
assert.equal(Object.keys(A.catalog).length, 28);
assert.deepEqual(copy(A.assignments), source.species);
assert.deepEqual(copy(A.catalog), Object.fromEntries(source.abilities.map(ability => [ability.id, ability])));
assert.deepEqual(Object.keys(A.assignments).sort(), originalIds.slice().sort());
for (const id of originalIds) {
  assert.equal(A.get(id)?.id, source.species[id], id);
  assert.equal(A.get({ species: id, ability: 'forged', abilityId: 'forged' })?.id, source.species[id], id + ' ignores individual overrides');
}
for (const value of [null, undefined, {}, '__proto__', 'missing', { species: 'missing', id: 'komori', ability: 'budding_resolve' }]) assert.equal(A.get(value), null);
assert.equal(A.get(D.species.komori).id, A.get('komori').id, 'Species data can be displayed through the same canonical lookup');

let serial = 0, comparisons = 0;
const fixtures = [];
function bare(id, changes = {}) {
  const original = D.species[id], key = 'ability_probe_' + (++serial);
  D.species[key] = { ...copy(original), ...changes, id: key, base: { ...original.base, ...(changes.base || {}) }, moves: (changes.moves || original.moves).slice() };
  fixtures.push(key);
  assert.equal(A.get(key), null, 'Copying a species ability field does not grant that ability');
  return key;
}
const owner = abilityId => originalIds.find(id => A.assignments[id] === abilityId && !D.species[id].adminOnly);
const guards = Object.values(D.moves).filter(move => move.kind === 'guard').slice(0, 4).map(move => move.id);
assert.equal(guards.length, 4);
const neutral = bare('komori', { element: 'earth', types: ['earth'], moves: guards });
const fillers = Array.from({ length: 8 }, () => bare('komori', { moves: guards }));
function setup(mode, actorId, targetId = neutral, options = {}) {
  let model, actor, target, slot = mode === 'double' ? 1 : 0, events = [];
  if (mode === 'solo') {
    model = new Engine(); assert(model.newGame('komori').ok);
    model.state.party = [model.makeMonster(actorId, 50), model.makeMonster(fillers[0], 50), model.makeMonster(fillers[1], 50)];
    model.rng = () => .5; assert(model.startBattle(targetId, 50, null, { wild: false }));
    actor = model.state.party[0]; target = model.battle.enemy;
  } else {
    const size = Duel.teamSize(mode), teams = [fillers.slice(0, size), fillers.slice(4, 4 + size)];
    teams[0][slot] = actorId; teams[1][slot] = targetId;
    model = Duel.create({ mode, teams, seed: 0x53ab1117 });
    actor = model.active(0)[slot]; target = model.active(1)[slot];
  }
  const actorMax = mode === 'solo' ? model.stats(actor).hp : actor.maxHp, targetMax = mode === 'solo' ? model.stats(target).hp : target.maxHp;
  if (options.actorRatio !== undefined) actor.hp = Math.max(1, Math.floor(actorMax * options.actorRatio));
  if (options.targetRatio !== undefined) target.hp = Math.max(1, Math.floor(targetMax * options.targetRatio));
  if (options.targetHp !== undefined) target.hp = options.targetHp;
  if (options.targetStatus) target.status = options.targetStatus;
  if (options.targetCurse) target.curse = true;
  const sim = { mode, model, actor, target, slot, actorMax, targetMax };
  Object.defineProperty(sim, 'events', { get: () => mode === 'solo' ? events : model.state.events });
  sim.rig = rolls => {
    let index = 0; const random = () => Array.isArray(rolls) ? (rolls[index++] ?? .99) : rolls;
    if (mode === 'solo') model.rng = random; else model._random = random;
  };
  sim.end = () => mode === 'solo' ? model.endOfTurn(events) : model._endOfTurn();
  sim.rig(.5);
  return sim;
}
const probe = changes => ({ id: 'struggle', name: '検証の一撃', kind: 'attack', category: 'physical', element: null, power: 12, accuracy: 100, ...changes });
function strike(sim, changes = {}, critical = false) {
  const move = probe(changes), beforeHP = sim.target.hp, beforeActor = sim.actor.hp, start = sim.events.length;
  sim.rig(critical ? [0, 0, .5, .99] : .5);
  if (sim.mode === 'solo') sim.model.applyMove(sim.actor, sim.target, move, 'ally', sim.events);
  else sim.model._apply({ side: 0, slot: sim.slot, target: sim.slot, technique: move }, sim.actor);
  const events = sim.events.slice(start), hit = events.find(event => event.kind === 'damage');
  return { amount: hit?.amount || 0, loss: beforeHP - sim.target.hp, healing: sim.actor.hp - beforeActor, events, hit };
}
function equalEffect(actual, baseline, factor, label) {
  comparisons++;
  if (factor === 1) assert.equal(actual, baseline, label);
  else {
    assert(Math.abs(actual - baseline * factor) <= 1.1, label + ': ' + actual + ' vs control ' + baseline + ' × ' + factor);
    assert(factor > 1 ? actual > baseline : actual < baseline, label + ': the modifier must change real damage');
  }
}
function damageCase(ability, defensive, settings, factor) {
  const species = owner(ability.id), control = bare(species), outcomes = [];
  for (const mode of modes) {
    const attacker = defensive ? neutral : species, defender = defensive ? species : (settings.targetId || neutral);
    const actual = setup(mode, attacker, defender, settings), baseline = setup(mode, defensive ? neutral : control, defensive ? control : defender, settings);
    const hit = strike(actual, settings.move, settings.critical), normal = strike(baseline, settings.move, settings.critical);
    const label = ability.id + ' / ' + settings.label + ' / ' + mode;
    equalEffect(hit.loss, normal.loss, factor, label);
    assert.equal(hit.amount, hit.loss, label + ': reported damage equals lost HP');
    assert.equal(hit.hit.critical, ability.kind === 'critical_guard' ? false : !!settings.critical, label + ': critical result');
    const notice = hit.events.find(event => event.kind === 'ability' && event.ability === ability.id);
    if (factor !== 1) {
      assert(notice, label + ': activation is visible');
      assert.equal(notice.side, mode === 'solo' ? (defensive ? 'enemy' : 'ally') : (defensive ? 1 : 0));
      assert.equal(notice.slot ?? 0, actual.slot);
    } else assert(!notice, label + ': inactive conditional ability stays silent');
    outcomes.push(hit.loss);
  }
  assert.equal(new Set(outcomes).size, 1, ability.id + ' / ' + settings.label + ': solo, single and double use identical damage rules');
}
for (const ability of source.abilities) {
  const p = ability.params, species = owner(ability.id), cases = [];
  let defensive = false;
  switch (ability.kind) {
    case 'low_type':
      cases.push([{ label: 'threshold', actorRatio: 1 / 3, move: { element: p.element } }, p.mul],
        [{ label: 'healthy', actorRatio: .5, move: { element: p.element } }, 1],
        [{ label: 'other element', actorRatio: 1 / 3, move: { element: null } }, 1]); break;
    case 'offense':
      cases.push([{ label: 'matching category', move: { category: p.category } }, p.mul],
        [{ label: 'other category', move: { category: p.category === 'physical' ? 'special' : 'physical' } }, 1]); break;
    case 'small_move':
      cases.push([{ label: 'power 30', move: { power: 30 } }, p.mul], [{ label: 'power 31', move: { power: 31 } }, 1]); break;
    case 'coverage':
      cases.push([{ label: 'neutral coverage', move: { element: null } }, p.mul],
        [{ label: 'same type', move: { element: T.of(species)[0] } }, 1]); break;
    case 'pierce':
      cases.push([{ label: 'piercing move', move: { effect: 'pierce' } }, p.mul], [{ label: 'ordinary move' }, 1]); break;
    case 'slower':
      cases.push([{ label: 'strictly slower', targetId: bare(species, { base: { speed: D.species[species].base.speed + 1000 } }) }, p.mul],
        [{ label: 'equal speed', targetId: bare(species) }, 1]); break;
    case 'afflicted':
      cases.push([{ label: 'status', targetStatus: 'bloom' }, p.mul], [{ label: 'curse', targetCurse: true }, p.mul], [{ label: 'healthy opponent' }, 1]); break;
    case 'defense':
      defensive = true;
      cases.push([{ label: 'matching category', move: { category: p.category } }, p.mul],
        [{ label: 'other category', move: { category: p.category === 'physical' ? 'special' : 'physical' } }, 1]); break;
    case 'full_guard':
      defensive = true; cases.push([{ label: 'full HP' }, p.mul], [{ label: 'damaged', targetRatio: .8 }, 1]); break;
    case 'weakness_guard': {
      defensive = true;
      const element = T.order.find(type => T.effectiveness(type, species) > 1); assert(element);
      cases.push([{ label: 'weakness', move: { element } }, p.mul], [{ label: 'neutral hit' }, 1]); break;
    }
    case 'pinch_guard':
      defensive = true; cases.push([{ label: 'threshold', targetRatio: 1 / 3 }, p.mul], [{ label: 'above threshold', targetRatio: .5 }, 1]); break;
    case 'critical_guard':
      defensive = true; cases.push([{ label: 'critical prevented', critical: true }, 1 / 1.35], [{ label: 'ordinary hit' }, 1]); break;
  }
  for (const [settings, factor] of cases) damageCase(ability, defensive, settings, factor);
}
// Failed attacks do not announce damage modifiers; a persistent benefit is
// announced once per individual even if it helps on several hits.
for (const mode of modes) {
  const id = owner('powerful_limbs'), sim = setup(mode, id);
  const missMove = probe({ accuracy: 20 }); sim.rig(.99);
  if (mode === 'solo') sim.model.applyMove(sim.actor, sim.target, missMove, 'ally', sim.events);
  else sim.model._apply({ side: 0, slot: sim.slot, target: sim.slot, technique: missMove }, sim.actor);
  assert(sim.events.some(event => event.kind === 'miss')); assert(!sim.events.some(event => event.kind === 'ability'));
  strike(sim); strike(sim);
  assert.equal(sim.events.filter(event => event.kind === 'ability' && event.ability === 'powerful_limbs').length, 1);
}

// Passive speed changes real turn order, and accuracy changes whether a move lands.
const ordinaryAttack = Object.values(D.moves).find(move => move.kind === 'attack' && !move.element && !move.effect);
assert(ordinaryAttack);
const battleMoves = [ordinaryAttack.id, ...guards.slice(0, 3)];
function passiveOrders(duel, side, attackingSlot = -1, skipSlot = -1) {
  return duel.state.teams[side].active.flatMap((index, slot) => {
    const mon = duel.state.teams[side].monsters[index]; if (mon.hp <= 0 || slot === skipSlot) return [];
    const moves = duel.moves(mon), move = slot === attackingSlot ? moves.findIndex(m => m.kind === 'attack') : moves.findIndex(m => m.kind === 'guard');
    assert(move >= 0);
    return [{ type: 'move', slot, move, target: slot === attackingSlot ? attackingSlot : 0 }];
  });
}
function round(sim) {
  sim.rig(.5);
  if (sim.mode === 'solo') return sim.model.action({ type: 'move', index: 0 }).events;
  return sim.model.resolve([passiveOrders(sim.model, 0, sim.slot), passiveOrders(sim.model, 1, sim.slot)]).events;
}
for (const abilityId of ['windstride', 'escape_spring']) {
  const ability = A.catalog[abilityId], id = owner(abilityId), original = D.species[id];
  D.species[id] = { ...original, moves: battleMoves };
  try {
    const baseSpeed = new Engine().stats({ species: id, level: 50 }).speed;
    const targetSpeed = baseSpeed + Math.max(1, Math.floor(baseSpeed * (ability.params.mul - 1) / 2));
    const opponent = bare(id, { moves: battleMoves, base: { speed: targetSpeed - 100 } }), control = bare(id);
    for (const mode of modes) {
      const options = ability.kind === 'pinch_speed' ? { actorRatio: .5 } : {};
      const actual = setup(mode, id, opponent, options), baseline = setup(mode, control, opponent, options);
      const first = round(actual).find(event => ['damage', 'miss'].includes(event.kind)), normal = round(baseline).find(event => ['damage', 'miss'].includes(event.kind));
      assert.equal(first.side, mode === 'solo' ? 'ally' : 0, abilityId + ' changes turn order in ' + mode);
      assert.equal(normal.side, mode === 'solo' ? 'enemy' : 1, abilityId + ' control is slower in ' + mode);
      assert.equal(actual.actorMax, baseline.actorMax, 'Abilities do not inflate max HP');
      if (ability.kind === 'pinch_speed') assert.equal(round(setup(mode, id, opponent)).find(event => ['damage', 'miss'].includes(event.kind)).side, mode === 'solo' ? 'enemy' : 1, 'Pinch speed does not apply above half HP');
    }
  } finally { D.species[id] = original; }
}
for (const mode of modes) {
  const id = owner('guiding_eyes'), actual = setup(mode, id), baseline = setup(mode, bare(id)), move = probe({ accuracy: 50 });
  const statsOf = sim => sim.mode === 'solo' ? sim.model.battleStats(sim.actor) : sim.model.effectiveStats(sim.actor);
  const targetStats = actual.mode === 'solo' ? actual.model.battleStats(actual.target) : actual.model.effectiveStats(actual.target);
  const chance = 50 * (statsOf(actual).accuracy + statsOf(baseline).accuracy) / 2 / targetStats.evasion / 100;
  for (const sim of [actual, baseline]) {
    sim.rig([chance, .5, .5, .99]);
    if (mode === 'solo') sim.model.applyMove(sim.actor, sim.target, move, 'ally', sim.events);
    else sim.model._apply({ side: 0, slot: sim.slot, target: sim.slot, technique: move }, sim.actor);
  }
  assert(actual.events.some(event => event.kind === 'damage'), 'Accuracy ability lands the boundary hit in ' + mode);
  assert(baseline.events.some(event => event.kind === 'miss'), 'The identical control misses in ' + mode);
}

// Every new status ward prevents both ordinary and guaranteed infliction,
// without clearing a pre-existing condition or blocking permanent curse.
for (const ability of source.abilities.filter(ability => ability.kind === 'status_guard')) {
  const id = owner(ability.id), kind = ability.params.status, element = D.statuses[kind].element, control = bare(id);
  assert(!T.has(id, element), ability.id + ' adds a resistance the species did not already have');
  for (const mode of modes) {
    for (const force of [false, true]) {
      for (const [targetId, expected] of [[id, false], [control, true]]) {
        const sim = setup(mode, neutral, targetId); sim.rig(0);
        const applied = mode === 'solo' ? sim.model.inflictCondition(sim.target, 'enemy', { element }, sim.events, force) : sim.model._inflict(1, sim.slot, sim.target, { element }, force);
        assert.equal(applied, expected, ability.id + ' / ' + mode + ' / forced=' + force);
        assert.equal(sim.target.status, expected ? kind : undefined);
        if (!expected) assert(sim.events.some(event => event.kind === 'ability' && event.ability === ability.id && event.text.includes(D.statuses[kind].name) && event.text.includes('防いだ')), ability.id + ' prevention is explained in ' + mode);
      }
    }
    const cursed = setup(mode, neutral, id); strike(cursed, { category: 'status', element: 'void', effect: 'curse', power: 0 });
    assert.equal(cursed.target.curse, true, ability.id + ' does not block curse');
    const existing = setup(mode, neutral, id, { targetStatus: kind });
    if (mode === 'solo') existing.model.battleStats(existing.target); else existing.model.effectiveStats(existing.target);
    assert.equal(existing.target.status, kind, 'Prevention does not silently cure existing conditions');
  }
}
for (const mode of modes) {
  const sim = setup(mode, neutral, 'nullmie'); sim.target.status = 'bloom'; sim.target.curse = true;
  sim.rig(0);
  const applied = mode === 'solo' ? sim.model.inflictCondition(sim.target, 'enemy', { element: 'leaf' }, sim.events, true) : sim.model._inflict(1, sim.slot, sim.target, { element: 'leaf' }, true);
  assert.equal(applied, false); assert.equal(sim.target.status, undefined); assert.equal(sim.target.curse, undefined);
  strike(sim, { category: 'status', element: 'void', effect: 'curse', power: 0 });
  assert.equal(sim.target.curse, undefined, 'Void keeps its separate curse immunity');
}

// Healing moves and drain use actual health restored, including overkill and
// max-HP caps. Held-item drain remains separate from the drain-move ability.
for (const mode of modes) {
  const healer = owner('tender_care'), real = setup(mode, healer, neutral, { actorRatio: .1 }), normal = setup(mode, bare(healer), neutral, { actorRatio: .1 });
  const enhanced = strike(real, { kind: 'heal', power: 25 }), baseline = strike(normal, { kind: 'heal', power: 25 });
  equalEffect(enhanced.healing, baseline.healing, 1.2, 'Healing move / ' + mode);
  assert(enhanced.events.some(event => event.ability === 'tender_care' && event.amount === enhanced.healing));
  const nearFull = setup(mode, healer, neutral, { actorRatio: .99 }); strike(nearFull, { kind: 'heal', power: 25 }); assert.equal(nearFull.actor.hp, nearFull.actorMax);
  const full = setup(mode, healer); strike(full, { kind: 'heal', power: 25 }); assert(!full.events.some(event => event.kind === 'ability'), 'No false recovery at full HP');
  const drainer = owner('life_cycle'), drain = setup(mode, drainer, neutral, { actorRatio: .1 }), unboosted = setup(mode, bare(drainer), neutral, { actorRatio: .1 });
  const drained = strike(drain, { effect: 'drain', power: 22 }), ordinary = strike(unboosted, { effect: 'drain', power: 22 });
  assert.equal(drained.loss, ordinary.loss);
  assert.equal(drained.healing, Math.max(1, Math.floor(drained.loss * .25 * 1.25)));
  assert.equal(ordinary.healing, Math.max(1, Math.floor(ordinary.loss * .25)));
  const overkill = setup(mode, drainer, neutral, { actorRatio: .1, targetHp: 31 }), overflow = strike(overkill, { effect: 'drain', power: 10000 });
  assert.equal(overflow.loss, 31); assert.equal(overflow.healing, Math.floor(31 * .25 * 1.25), 'Overkill cannot manufacture extra drain healing');
  const bell = Object.values(D.heldItems).find(item => item.kind === 'drain'); assert(bell);
  const itemReal = setup(mode, drainer, neutral, { actorRatio: .1 }), itemControl = setup(mode, bare(drainer), neutral, { actorRatio: .1 });
  for (const sim of [itemReal, itemControl]) sim.actor[mode === 'solo' ? 'heldItem' : 'item'] = bell.id;
  assert.equal(strike(itemReal).healing, strike(itemControl).healing, 'Drain ability does not boost held-item healing');
}

function switchActor(sim, index) {
  if (sim.mode === 'solo') {
    const result = sim.model.action({ type: 'switch', index }); assert(result.ok, result.error); return;
  }
  const orders = [...passiveOrders(sim.model, 0, -1, sim.slot), { type: 'switch', slot: sim.slot, index }];
  sim.model.resolve([orders, passiveOrders(sim.model, 1)]);
}
function forceBack(sim, index) {
  if (sim.mode === 'solo') {
    const fallen = sim.model.state.party[sim.model.battle.activeIndex]; fallen.hp = 0;
    sim.model.resolveAllyFaint(sim.events);
    const result = sim.model.chooseReplacement(index); assert(result.ok, result.error); return;
  }
  const current = sim.model.active(0)[sim.slot]; current.hp = 0; sim.model._faint(0, sim.slot, current); sim.model._replaceFainted();
  sim.model.resolve([[{ type: 'switch', slot: sim.slot, index }], []]);
}
for (const abilityId of ['resting_breath', 'stored_vigor']) {
  const ability = A.catalog[abilityId], id = owner(abilityId), ratio = ability.params.below;
  for (const mode of modes) {
    const sim = setup(mode, id, neutral, { actorRatio: ratio }), start = sim.actor.hp, amount = Math.max(1, Math.floor(sim.actorMax * ability.params.fraction));
    sim.end(); assert.equal(sim.actor.hp, start + amount, abilityId + ' / ' + mode);
    assert(sim.events.some(event => event.ability === abilityId && event.amount === amount));
    const above = setup(mode, id, neutral, { actorRatio: ratio + .05 }), aboveHP = above.actor.hp; above.end(); assert.equal(above.actor.hp, aboveHP);
    const bench = setup(mode, id, neutral, { actorRatio: ratio }), benchHP = bench.actor.hp;
    if (mode === 'solo') bench.model.battle.activeIndex = 1; else bench.model.state.teams[0].active[bench.slot] = 2;
    bench.end(); assert.equal(bench.actor.hp, benchHP, 'Benched ability does not tick');
    const fainted = setup(mode, id); fainted.actor.hp = 0; fainted.end(); assert.equal(fainted.actor.hp, 0, 'No ability revives a fainted monster');
    const tick = setup(mode, id); tick.actor.hp = 1; tick.actor.status = 'bloom'; tick.end();
    assert.equal(tick.actor.hp, 0, 'Status KO happens before end-turn recovery'); assert(!tick.events.some(event => event.ability === abilityId));
    if (abilityId === 'stored_vigor') {
      sim.actor.hp = start; sim.end(); assert.equal(sim.actor.hp, start, 'Reserve only fires once without switching');
      const originalIndex = mode === 'solo' ? 0 : sim.slot, benchIndex = 2;
      switchActor(sim, benchIndex); sim.actor.hp = start; switchActor(sim, originalIndex);
      assert.equal(sim.actor.hp, start, 'Voluntary switching does not refill reserve');
      switchActor(sim, benchIndex); sim.actor.hp = start; forceBack(sim, originalIndex); sim.end();
      assert.equal(sim.actor.hp, start, 'Forced replacement does not refill reserve');
      if (mode === 'solo') {
        sim.model.endBattle('fled', sim.events); assert(sim.model.startBattle(neutral, 50, null, { wild: false }));
        sim.actor.hp = start; sim.model.battle.activeIndex = 0; sim.end(); assert.equal(sim.actor.hp, start + amount, 'A new adventure battle restores the reserve');
      } else {
        const fresh = setup(mode, id, neutral, { actorRatio: ratio }); fresh.end(); assert.equal(fresh.actor.hp, start + amount, 'A new duel restores the reserve');
      }
    }
  }
}

// Old saves derive the ability from species without changing the individual.
const oldEngine = new Engine(); assert(oldEngine.newGame('komori').ok);
const savedMon = oldEngine.makeMonster('tanemaru', 50); savedMon.nickname = 'たね'; savedMon.shiny = true; savedMon.alloc = { atk: 7 }; savedMon.hp -= 9;
savedMon.heldItem = 'swiftshoes'; savedMon.moveOrder = [3, 2, 1, 0]; savedMon.pp[oldEngine.moves(savedMon)[0].id]--;
oldEngine.state.party = [savedMon]; oldEngine.markCaught(savedMon.species);
const saved = oldEngine.serialize();
for (const version of [1, 2, 3, 4]) {
  const legacy = copy(saved); legacy.version = version; legacy.party[0].ability = 'forged'; legacy.party[0].abilityId = 'forged';
  const restored = new Engine(legacy).state.party[0];
  for (const key of ['uid', 'species', 'level', 'xp', 'hp', 'pp', 'nickname', 'shiny', 'alloc', 'heldItem', 'moveOrder']) assert.deepEqual(copy(restored[key]), copy(saved.party[0][key]), 'v' + version + ': ' + key);
  assert.equal(A.get(restored).id, 'stored_vigor'); assert(!Object.hasOwn(restored, 'ability')); assert(!Object.hasOwn(restored, 'abilityId'));
}
for (const uid of ['__proto__', 'constructor']) {
  const legacy = copy(saved); legacy.party[0].uid = uid; legacy.party[0].hp = 1;
  const engine = new Engine(legacy); assert(engine.startBattle(neutral, 50, null, { wild: false }));
  const mon = engine.state.party[0], events = []; engine.endOfTurn(events); const once = mon.hp; engine.endOfTurn(events);
  assert(once > 1); assert.equal(mon.hp, once, 'Legacy UID ' + uid + ' cannot refill reserve through object prototype keys');
}
const evolving = oldEngine.makeMonster('velora_2', D.species.velora_2.evolveLevel);
assert.equal(A.get(evolving).id, 'life_cycle'); oldEngine.giveXP(evolving, 1, []);
assert.equal(evolving.species, 'velora_3'); assert.equal(A.get(evolving).id, 'travel_wisdom', 'Evolution derives the new species ability');
const plain = new Engine(), original = owner('windstride'), duplicate = bare(original);
assert.deepEqual(copy(plain.stats(plain.makeMonster(original, 50))), copy(plain.stats(plain.makeMonster(duplicate, 50))), 'Adventure base stats and max HP stay permanent-stat compatible');

// Repeated real rounds remain deterministic, including activations, switches,
// replacement phases and every synchronized event snapshot.
for (const id of fixtures) delete D.species[id];
assert.equal(Object.keys(D.species).length, 259);
let rounds = 0, activations = 0;
for (const mode of ['single', 'double']) {
  const size = Duel.teamSize(mode), teams = [
    ['tanemaru', 'fuwari', 'genro', 'rurihime'].slice(0, size),
    ['mosselk', 'sazanami', 'sunari', 'sunokko'].slice(0, size)
  ], config = { mode, teams, seed: 0x531128 };
  const peers = [Duel.create(copy(config)), Duel.create(copy(config))];
  for (let count = 0; peers[0].state.winner === null && count < 220; count++) {
    const orders = [0, 1].map(side => peers[0].legalOrders(side));
    peers.forEach(peer => peer.resolve(copy(orders)));
    assert.equal(peers[0].fingerprint(), peers[1].fingerprint(), mode + ' round ' + count + ': identical seed and orders');
    activations += peers[0].state.events.filter(event => event.kind === 'ability').length; rounds++;
  }
  assert.notEqual(peers[0].state.winner, null, mode + ' finishes under the existing turn limit');
}
assert(activations > 0, 'Seeded real matches exercised abilities');
const initialFingerprint = Duel.rulesFingerprint();
for (const change of [
  { version: A.version + 1 },
  { catalog: { ...A.catalog, windstride: { ...A.catalog.windstride, params: { mul: 1.25 } } } },
  { assignments: { ...A.assignments, komori: 'last_ember' } }
]) {
  LT.Abilities = { ...A, ...change }; vm.runInContext(script('deterministic, save-independent rental-team duels'), env.context);
  assert.notEqual(LT.Duel.rulesFingerprint(), initialFingerprint, 'Ability version, numeric rules and assignments each participate in compatibility');
}
LT.Abilities = A; vm.runInContext(script('deterministic, save-independent rental-team duels'), env.context);
assert.equal(LT.Duel.rulesFingerprint(), initialFingerprint); assert.equal(LT.Duel.rules.version, 10);

(async () => {
  const remote = runtime(), queue = [];
  remote.LT.Abilities = { ...remote.LT.Abilities, version: A.version + 1 };
  vm.runInContext(script('deterministic, save-independent rental-team duels'), remote.context);
  const sessions = [env, remote].map((world, role) => new world.LT.DuelSession({ role, mode: 'single',
    send(message) { queue.push({ role, message: copy(message) }); return true; } }));
  try {
    sessions.forEach(session => session.start());
    for (let count = 0; queue.length && count < 30; count++) { const { role, message } = queue.shift(); await sessions[1 - role].receive(message); }
    assert(sessions.some(session => session.snapshot().phase === 'error'), 'Clients with different ability rules are rejected at the handshake');
  } finally { sessions.forEach(session => session.close()); remote.close(); env.close(); }
  console.log(JSON.stringify({
    ok: true, abilities: 28, species: 259, effectComparisons: comparisons, seededRounds: rounds, observedActivations: activations,
    checks: ['canonical species assignments and spoof rejection', 'conditional attack and defense effects', 'solo/single/double damage parity',
      'speed changes real turn order', 'accuracy changes hit outcomes', 'five status wards: normal and forced infliction',
      'existing conditions preserved; curse separate; void immunity retained', 'healing and capped actual-damage drain',
      'held-item drain remains unboosted', 'active living members only; status KO before recovery',
      'reserve persists across voluntary and forced replacement; resets in a new battle',
      'V1-V4 saves preserve individuals; forged ability ignored; evolution derives new ability',
      'legacy __proto__ and constructor UIDs cannot refill reserve',
      'seeded peers synchronize every round and event', 'catalog/version/assignments fingerprinted; incompatible handshake rejected']
  }));
})().catch(error => { env.close(); console.error(error); process.exitCode = 1; });
