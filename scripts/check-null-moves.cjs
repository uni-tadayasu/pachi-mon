#!/usr/bin/env node
'use strict';

// Run the shipped move catalog and both deterministic battle engines. These
// checks use actual moves, turn resolution, saves, and selected duel slots.
const assert = require('node:assert/strict'), test = require('node:test');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const context = vm.createContext({ console });
for (const [, attrs, code] of scripts) {
  if (/\bsrc=|application\/ld\+json/.test(attrs)) continue;
  vm.runInContext(code, context); if (context.LT?.Engine) break;
}
const link = scripts.find(([, attrs, code]) => !/\bsrc=/.test(attrs) && code.includes('deterministic, save-independent rental-team duels'));
assert(link); vm.runInContext(link[2], context);
const { Engine, Duel, DATA: D, ConditionRules } = context.LT;
const IDS = ['null_restore', 'null_curse', 'null_ray', 'null_scorch'];
const LINE = ['nullmie', 'nullva', 'zeroveil'];
const OLD = { nullmie: ['nudge', 'dew', 'focus', 'restsong'], nullva: ['pulse', 'dew', 'focus', 'restsong'], zeroveil: ['dawnstep', 'dew', 'focus', 'restsong'] };
const copy = value => JSON.parse(JSON.stringify(value));
const quarter = n => Math.max(1, Math.floor(n / 4));
const move = id => { assert(D.moves[id], `${id} is registered`); return D.moves[id]; };
const isRecharging = mon => (mon.rechargeTurns || 0) > 0;
const assertLifecycleCleanup = mon => { assert.equal(mon.curse === true, !ConditionRules.isImmune(mon), 'Curse persists except on immune types'); assert(!isRecharging(mon), 'Recovery delay cleared'); };
function hero() { const e = new Engine(); assert(e.newGame('komori').ok); return e; }
function solo(id = 'nullmie', target = 'komori') {
  const e = hero(); e.state.party = [e.makeMonster(id, 50)]; e.markCaught(id);
  assert(e.startBattle('komori', 50, null, { wild: false })); e.battle.enemy = e.makeMonster(target, 50);
  e.rng = () => .5;
  return { e, actor: e.state.party[0], target: e.battle.enemy };
}
function apply(e, actor, target, id, side = 'ally') { const events = []; e.applyMove(actor, target, move(id), side, events); return events; }
function duel(mode = 'single', side = 0, targetId = 'komori') {
  const size = Duel.teamSize(mode), ordinary = [targetId, ...['komori', 'shizuku', 'hibana', 'fuwari', 'kirari'].filter(id => id !== targetId)].slice(0, size);
  const teams = [LINE.concat('fuwari').slice(0, size), ordinary];
  if (side === 1) teams.reverse();
  const d = Duel.create({ mode, teams, seed: 41042 }); d._random = () => .5;
  return d;
}
function linkApply(d, side, slot, targetSlot, id) {
  const actor = d.active(side)[slot]; d.state.events = [];
  d._apply({ type: 'move', technique: move(id), side, slot, target: targetSlot }, actor);
  return d.state.events;
}
function damage(events) { const event = events.find(e => e.kind === 'damage'); assert(event && event.amount > 0, 'A damaging attack lands'); return event; }
const idle = (e, mon) => { const hp = mon.hp, pp = copy(mon.pp), turn = e.battle.turn; return { hp, pp, turn }; };

test('the three stages share four fixed moves with the requested types, PP, effects and power', () => {
  const expected = [
    ['null_restore', '零への回帰', 'heal', 'status', 'void', 100, 8, 'fullHealRecharge'],
    ['null_curse', '虚無の呪縛', 'attack', 'status', 'void', 0, 8, 'curse'],
    ['null_ray', 'ヴォイドレイ', 'attack', 'special', 'void', 60, 16, undefined],
    ['null_scorch', '呪灯', 'attack', 'status', 'ember', 0, 16, 'inflictScorch']
  ];
  for (const [id, name, kind, category, element, power, pp, effect] of expected) {
    const m = move(id); assert.deepEqual([m.name, m.kind, m.category, m.element, m.power, m.pp], [name, kind, category, element, power, pp]);
    assert.equal(m.accuracy, 100); if (effect) assert.equal(m.effect, effect); else assert(!m.effect);
  }
  for (const id of LINE) assert.deepEqual(copy(D.species[id].moves), IDS);
  assert.equal(Object.keys(D.moves).length, 100);
  assert.equal(Object.keys(D.statuses).length, 5, 'Curse is independent of the existing single-condition slot');
  for (const id of IDS) assert.deepEqual(Object.values(D.species).filter(s => s.moves.includes(id)).map(s => s.id).sort(), [...LINE].sort());
});

test('old PP migrates by slot and proportion, including empty/full moves, without changing individual data', () => {
  for (const id of LINE) for (const location of ['party', 'storage']) {
    const e = hero(), mon = e.makeMonster(id, 50); mon.nickname = 'ぬる'; mon.shiny = true; mon.hp -= 13; e.state[location].push(mon); e.markCaught(id);
    const saved = copy(e.serialize()), record = saved[location].find(m => m.uid === mon.uid), original = copy(record);
    const fractions = [0, 1, .5, .25], oldPP = Object.fromEntries(OLD[id].map((key, i) => [key, Math.floor(e.maxPP(D.moves[key]) * fractions[i])]));
    record.pp = oldPP; const before = JSON.stringify(saved), loaded = new Engine(saved), restored = loaded.state[location].find(m => m.uid === mon.uid);
    assert.equal(JSON.stringify(saved), before, 'Loading does not rewrite the source save');
    const expected = Object.fromEntries(IDS.map((key, i) => [key, Math.round(oldPP[OLD[id][i]] * e.maxPP(move(key)) / e.maxPP(D.moves[OLD[id][i]]))]));
    assert.deepEqual(copy(restored.pp), expected); assert.equal(restored.uid, original.uid); assert.equal(restored.hp, original.hp);
    assert.equal(restored.nickname, original.nickname); assert.equal(restored.shiny, original.shiny);
    assert.deepEqual(copy(new Engine(loaded.serialize()).state[location].find(m => m.uid === mon.uid).pp), expected, 'New-format round trip is stable');
    mon.pp = copy(oldPP); e.syncPP(mon); assert.deepEqual(copy(mon.pp), expected, 'Live PP synchronization also preserves the old proportions');
  }
  const e = hero(), mon = e.makeMonster('nullmie', 24); e.state.party.push(mon); e.markCaught(mon.species);
  mon.pp = { null_restore: 0, null_curse: 4, null_ray: 5, null_scorch: 16 }; const expected = copy(mon.pp);
  e.giveXP(mon, 1, []); assert.equal(mon.species, 'nullva'); assert.deepEqual(copy(mon.pp), expected);
  mon.level = 48; e.giveXP(mon, 1, []); assert.equal(mon.species, 'zeroveil'); assert.deepEqual(copy(mon.pp), expected);
});

test('full restoration imposes exactly one idle turn, including at full HP and when attempting a switch', () => {
  for (const id of LINE) for (const initialFull of [false, true]) for (const command of ['move', 'switch']) {
    const { e, actor, target } = solo(id); e.state.party.push(e.makeMonster('fuwari', 50)); e.enemyTurn = () => {};
    if (!initialFull) actor.hp = 1;
    const pp = actor.pp.null_restore; apply(e, actor, target, 'null_restore');
    assert.equal(actor.hp, e.stats(actor).hp); assert.equal(actor.pp.null_restore, pp - 1); assert.equal(actor.rechargeTurns, 1);
    actor.status = 'bubble'; actor.curse = true; ConditionRules.clearImmune(actor);
    assert.equal(actor.status, undefined); assert(!actor.curse); assert.equal(actor.rechargeTurns, 1, 'Status immunity does not waive the move cost');
    const before = idle(e, actor), targetHP = target.hp;
    const result = e.action(command === 'switch' ? { type: 'switch', index: 1 } : { type: 'move', index: 2 });
    assert(result.ok); assert.equal(e.battle.activeIndex, 0); assert.equal(e.battle.turn, before.turn + 1);
    assert.equal(target.hp, targetHP); assert.deepEqual(copy(actor.pp), before.pp); assert(!isRecharging(actor));
    assert(result.events.some(event => event.kind === 'recharge'), 'The forced idle turn is visible');
    const next = e.action({ type: 'move', index: 2 }); assert(next.ok); damage(next.events); assert.equal(actor.pp.null_ray, before.pp.null_ray - 1);
    assert(!isRecharging(actor), 'Normal attacks do not restart the wait');
  }
});

test('link full restoration and forced idle apply to either side and both double slots without PP or switch bypass', () => {
  for (const mode of ['single', 'double']) for (const side of [0, 1]) for (const full of [false, true]) {
    const d = duel(mode, side), slots = d.active(side).length;
    for (let slot = 0; slot < slots; slot++) {
      const actor = d.active(side)[slot]; if (!full) actor.hp = 1;
      const pp = actor.pp.null_restore; linkApply(d, side, slot, 0, 'null_restore');
      assert.equal(actor.hp, actor.maxHp); assert.equal(actor.pp.null_restore, pp - 1); assert.equal(actor.rechargeTurns, 1);
    }
    const beforeActive = copy(d.state.teams[side].active), beforePP = d.active(side).map(mon => copy(mon.pp));
    const orders = [d.legalOrders(0), d.legalOrders(1)];
    const bench = d.state.teams[side].monsters.map((mon, index) => index).filter(index => !beforeActive.includes(index));
    orders[side] = beforeActive.map((_, slot) => ({ type: 'switch', slot, index: bench[slot] }));
    d.resolve(orders); assert.deepEqual(copy(d.state.teams[side].active), beforeActive, 'No switch during the forced idle turn');
    d.active(side).forEach((mon, slot) => { assert(!isRecharging(mon)); assert.deepEqual(copy(mon.pp), beforePP[slot]); });
    assert.equal(d.state.events.filter(event => event.kind === 'recharge' && event.side === side).length, slots);
    const actor = d.active(side)[0], nextPP = actor.pp.null_ray;
    damage(linkApply(d, side, 0, 0, 'null_ray')); assert.equal(actor.pp.null_ray, nextPP - 1);
  }
});

test('using the final PP still consumes exactly one idle turn and then permits the no-PP fallback', () => {
  const { e, actor, target } = solo(); e.enemyTurn = () => {};
  for (const id of IDS) actor.pp[id] = id === 'null_restore' ? 1 : 0;
  apply(e, actor, target, 'null_restore'); assert.equal(actor.pp.null_restore, 0); assert.equal(actor.rechargeTurns, 1);
  const before = [actor.hp, target.hp], idleResult = e.action({ type: 'struggle' });
  assert(idleResult.ok); assert.deepEqual([actor.hp, target.hp], before); assert(!isRecharging(actor));
  const acted = e.action({ type: 'struggle' }); assert(acted.ok); damage(acted.events);
  for (const mode of ['single', 'double']) {
    const d = duel(mode), actor = d.active(0)[0];
    for (const id of IDS) actor.pp[id] = id === 'null_restore' ? 1 : 0;
    linkApply(d, 0, 0, 0, 'null_restore');
    let orders = [d.legalOrders(0), d.legalOrders(1)]; assert.equal(orders[0].find(order => order.slot === 0).type, 'struggle');
    d.resolve(orders); assert(!isRecharging(actor));
    assert(d.state.events.some(event => event.kind === 'recharge' && event.side === 0 && event.slot === 0));
    assert(!d.state.events.some(event => event.kind === 'damage' && event.side === 0 && event.slot === 0));
    orders = [d.legalOrders(0), d.legalOrders(1)]; d.resolve(orders);
    assert(d.state.events.some(event => event.kind === 'damage' && event.side === 0 && event.slot === 0 && event.move === 'struggle'));
  }
});

test('curse spends a quarter of user maximum HP once, ticks immediately, and stacks with scorch', () => {
  for (const side of ['ally', 'enemy']) {
    const { e, actor, target } = side === 'ally' ? solo() : solo('komori', 'nullmie');
    const user = side === 'ally' ? actor : target, victim = side === 'ally' ? target : actor;
    victim.status = 'scorch'; const userHP = user.hp, victimHP = victim.hp, cost = quarter(e.stats(user).hp), tick = quarter(e.stats(victim).hp);
    apply(e, user, victim, 'null_curse', side); assert.equal(user.hp, userHP - cost); assert.equal(victim.hp, victimHP);
    assert.equal(victim.curse, true); assert.equal(victim.status, 'scorch');
    const beforePP = user.pp.null_curse; apply(e, user, victim, 'null_curse', side);
    assert.equal(user.hp, userHP - cost, 'Already-cursed target causes no extra self-damage'); assert.equal(user.pp.null_curse, beforePP - 1);
    const events = []; e.endOfTurn(events);
    assert.equal(victim.hp, victimHP - tick - Math.max(1, Math.floor(e.stats(victim).hp / 16)));
    assert(events.some(event => event.kind === 'statusTick' && event.status === 'curse'));
    assert(events.some(event => event.kind === 'statusTick' && event.status === 'scorch'));
  }
  for (const mode of ['single', 'double']) for (const side of [0, 1]) {
    const d = duel(mode, side);
    for (let slot = 0; slot < d.active(side).length; slot++) {
      const actor = d.active(side)[slot], target = d.active(1 - side)[slot], hp = actor.hp, targetHP = target.hp;
      target.status = 'scorch'; linkApply(d, side, slot, slot, 'null_curse');
      assert.equal(actor.hp, hp - quarter(actor.maxHp)); assert.equal(target.hp, targetHP); assert.equal(target.curse, true); assert.equal(target.status, 'scorch');
    }
    const before = d.active(1 - side).map(mon => mon.hp); d._endOfTurn();
    d.active(1 - side).forEach((mon, slot) => assert.equal(mon.hp, before[slot] - quarter(mon.maxHp) - Math.max(1, Math.floor(mon.maxHp / 16))));
  }
});

test('curse immunity, misses and repeat casts cause no self-damage, and stale void curses are removed', () => {
  for (const id of LINE) {
    const { e, actor, target } = solo('nullmie', id), hp = [actor.hp, target.hp];
    apply(e, actor, target, 'null_curse'); assert.deepEqual([actor.hp, target.hp], hp); assert(!target.curse);
    target.curse = true; const events = []; e.endOfTurn(events); assert(!target.curse); assert.deepEqual([actor.hp, target.hp], hp);
    for (const mode of ['single', 'double']) {
      const d = duel(mode, 0, id), actor = d.active(0)[0], target = d.active(1)[0], before = [actor.hp, target.hp];
      linkApply(d, 0, 0, 0, 'null_curse'); assert.deepEqual([actor.hp, target.hp], before); assert(!target.curse);
      target.curse = true; d._endOfTurn(); assert(!target.curse); assert.deepEqual([actor.hp, target.hp], before);
    }
  }
  const { e, actor, target } = solo(); e.battle.stages.ally.accuracy = -6; e.rng = () => .99;
  const hp = [actor.hp, target.hp]; assert(apply(e, actor, target, 'null_curse').some(event => event.kind === 'miss'));
  assert.deepEqual([actor.hp, target.hp], hp); assert(!target.curse);
  const d = duel('double'); d.active(0)[0].stages.accuracy = -6; d._random = () => .99;
  const onlineHP = [d.active(0)[0].hp, d.active(1)[0].hp]; assert(linkApply(d, 0, 0, 0, 'null_curse').some(event => event.kind === 'miss'));
  assert.deepEqual([d.active(0)[0].hp, d.active(1)[0].hp], onlineHP); assert(!d.active(1)[0].curse);
});

test('curse can knock out its user and correctly resolves the loss for the last living combatant', () => {
  const { e, actor } = solo(); actor.hp = 1; e.battle.stages.ally.speed = 6;
  const result = e.action({ type: 'move', index: 1 }); assert(result.ok); assert.equal(result.ended, 'lost');
  assert(result.events.some(event => event.kind === 'faint' && event.side === 'ally' && event.visual?.ally.hp === 0), 'Self-damage knocks out the user before the existing loss/respawn recovery');
  for (const mode of ['single', 'double']) for (const side of [0, 1]) {
    const d = duel(mode, side), user = d.active(side)[0];
    d.state.teams[side].monsters.forEach(mon => { mon.hp = 0; }); user.hp = 1; user.stages.speed = 6;
    const orders = [d.legalOrders(0), d.legalOrders(1)]; orders[side] = [{ type: 'move', slot: 0, move: 1, target: 0 }];
    d.resolve(orders); assert.equal(user.hp, 0); assert.equal(d.state.winner, 1 - side);
  }
});

test('curse persists through switch, fainting, healing, finish and save-load while recharge remains battle-only', () => {
  const { e, actor } = solo('komori'); e.state.party.push(e.makeMonster('shizuku', 50)); e.markCaught('shizuku'); e.enemyTurn = () => {};
  actor.curse = true; assert(e.action({ type: 'switch', index: 1 }).ok); assert.equal(actor.curse, true);
  actor.curse = true; actor.rechargeTurns = 1; actor.hp = 0; e.faint(actor, 'ally', []); assertLifecycleCleanup(actor);
  actor.curse = true; actor.rechargeTurns = 1; e.restoreMonster(actor); assertLifecycleCleanup(actor);
  for (const mon of [...e.state.party, e.battle.enemy]) { mon.curse = true; mon.rechargeTurns = 1; }
  e.endBattle('fled', []); [...e.state.party, e.battle.enemy].forEach(assertLifecycleCleanup);
  e.battle = null; e.state.party.forEach(mon => { mon.curse = true; mon.rechargeTurns = 1; });
  new Engine(e.serialize()).state.party.forEach(assertLifecycleCleanup);
  for (const mode of ['single', 'double']) {
    const d = duel(mode, 0), side = 1, team = d.state.teams[side], outgoing = d.active(side)[0]; outgoing.curse = true;
    const bench = team.monsters.findIndex((mon, i) => !team.active.includes(i)), orders = [d.legalOrders(0), d.legalOrders(1)];
    orders[side][0] = { type: 'switch', slot: 0, index: bench }; d.resolve(orders); assert.equal(outgoing.curse, true);
    outgoing.curse = true; outgoing.rechargeTurns = 1; outgoing.hp = 0; d._faint(side, 0, outgoing); assertLifecycleCleanup(outgoing);
    d.state.teams.forEach(t => t.monsters.forEach(mon => { mon.curse = true; mon.rechargeTurns = 1; }));
    d._finish(0, 'knockout'); d.state.teams.forEach(t => t.monsters.forEach(assertLifecycleCleanup));
  }
});

test('scorch is guaranteed on hit, deals no direct damage, respects existing status and type immunity, and uses cure berries', () => {
  for (const targetId of ['komori', 'hibana', ...LINE]) {
    const immune = targetId === 'hibana' || LINE.includes(targetId), { e, actor, target } = solo('nullmie', targetId);
    e.rng = () => .99; const hp = target.hp, events = apply(e, actor, target, 'null_scorch');
    assert.equal(target.hp, hp); assert.equal(target.status, immune ? undefined : 'scorch'); assert(!events.some(event => event.kind === 'damage'));
    for (const mode of ['single', 'double']) for (const side of [0, 1]) {
      const d = duel(mode, side, targetId), mon = d.active(1 - side)[0]; d._random = () => .99;
      const before = mon.hp, events = linkApply(d, side, 0, 0, 'null_scorch');
      assert.equal(mon.hp, before); assert.equal(mon.status, immune ? undefined : 'scorch'); assert(!events.some(event => event.kind === 'damage'));
    }
  }
  for (const berry of ['scorchberry', 'allberry']) {
    const { e, actor, target } = solo(); target.heldItem = berry; e.rng = () => .99;
    apply(e, actor, target, 'null_scorch'); assert.equal(target.status, undefined); assert.equal(target.heldItem, undefined);
    const d = duel('double'); d.active(1)[0].item = berry; d._random = () => .99;
    linkApply(d, 0, 0, 0, 'null_scorch'); assert.equal(d.active(1)[0].status, undefined); assert.equal(d.active(1)[0].item, undefined);
  }
  const { e, actor, target } = solo(); target.status = 'bubble'; apply(e, actor, target, 'null_scorch'); assert.equal(target.status, 'bubble', 'A pure scorch attempt does not replace or pop another condition');
  const d = duel(); d.active(1)[0].status = 'dizzy'; linkApply(d, 0, 0, 0, 'null_scorch'); assert.equal(d.active(1)[0].status, 'dizzy');
});

test('a failed scorch attempt does not activate an unrelated low-HP healing berry', () => {
  const { e, actor, target } = solo('nullmie', 'hibana');
  target.hp = Math.max(1, Math.floor(e.stats(target).hp / 10)); target.heldItem = 'healberry';
  const hp = target.hp, events = apply(e, actor, target, 'null_scorch');
  assert.equal(target.status, undefined); assert.equal(target.hp, hp); assert.equal(target.heldItem, 'healberry');
  assert(!events.some(event => event.kind === 'item' && event.item === 'healberry'));
  for (const mode of ['single', 'double']) for (const side of [0, 1]) {
    const d = duel(mode, side, 'hibana'), target = d.active(1 - side)[0];
    target.hp = Math.max(1, Math.floor(target.maxHp / 10)); target.item = 'healberry';
    const hp = target.hp, events = linkApply(d, side, 0, 0, 'null_scorch');
    assert.equal(target.status, undefined); assert.equal(target.hp, hp, `${mode}/${side}: failed status move does not heal`);
    assert.equal(target.item, 'healberry', `${mode}/${side}: unrelated berry remains held`);
    assert(!events.some(event => event.kind === 'item' && event.item === 'healberry'));
  }
});

test('Void Ray uses special offense and defense, retains neutral affinity, and responds to stat investment', () => {
  function soloDamage(a, d) {
    const { e, actor, target } = solo(); if (a) e.battle.stages.ally[a] = 2; if (d) e.battle.stages.enemy[d] = 2;
    return damage(apply(e, actor, target, 'null_ray'));
  }
  function linkDamage(a, def) {
    const d = duel('double'); if (a) d.active(0)[0].stages[a] = 2; if (def) d.active(1)[0].stages[def] = 2;
    return damage(linkApply(d, 0, 0, 0, 'null_ray'));
  }
  for (const hit of [soloDamage, linkDamage]) {
    const plain = hit(); assert.equal(plain.category, 'special'); assert.equal(plain.effectiveness, 1);
    assert(hit('spAtk').amount > plain.amount); assert(hit(null, 'spDef').amount < plain.amount);
    assert.equal(hit('atk').amount, plain.amount); assert.equal(hit(null, 'def').amount, plain.amount);
  }
});

test('both peers produce identical new-move turns and full restoration never creates an endless forced wait', () => {
  for (const mode of ['single', 'double']) {
    const size = Duel.teamSize(mode), teams = [LINE.concat('fuwari').slice(0, size), ['komori', 'shizuku', 'hibana', 'kirari'].slice(0, size)];
    const peers = [Duel.create({ mode, teams, seed: 731 }), Duel.create({ mode, teams: copy(teams), seed: 731 })];
    let heals = 0, rests = 0;
    for (let round = 0; round < 6; round++) {
      const d = peers[0]; if (d.state.winner !== null) break;
      const orders = [d.legalOrders(0), d.legalOrders(1)];
      if (d.state.phase !== 'replacement') orders[0] = d.active(0).flatMap((mon, slot) => mon.hp > 0 ? [{ type: 'move', slot, move: slot === 0 ? 0 : round % 2 ? 3 : 1, target: 0 }] : []);
      peers.forEach(peer => peer.resolve(copy(orders))); assert.equal(peers[0].fingerprint(), peers[1].fingerprint());
      heals += peers[0].state.events.filter(event => event.kind === 'heal' && event.side === 0 && (event.slot || 0) === 0).length;
      rests += peers[0].state.events.filter(event => event.kind === 'recharge' && event.side === 0 && (event.slot || 0) === 0).length;
    }
    assert(heals >= 2, `${mode}: can heal again after resting`); assert(rests >= 1, `${mode}: recovery costs a turn`);
  }
});
