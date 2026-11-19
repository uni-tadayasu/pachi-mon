#!/usr/bin/env node
'use strict';

// Exercise the shipped adventure and link-battle engines. Force condition rolls
// to succeed so immunity cannot pass merely because a low-probability roll lost.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const vm = require('node:vm'), test = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const context = vm.createContext({ console });
for (const [, attributes, code] of scripts) {
  if (/\bsrc=|application\/ld\+json/.test(attributes)) continue;
  vm.runInContext(code, context);
  if (context.LT?.Engine) break;
}
const link = scripts.find(([, attributes, code]) => !/\bsrc=/.test(attributes) && code.includes('deterministic, save-independent rental-team duels'));
assert(link, 'Production link-battle engine exists'); vm.runInContext(link[2], context);
const { Engine, Duel, DATA: D } = context.LT;
const VOID = ['nullmie', 'nullva', 'zeroveil'], CONDITIONS = Object.keys(D.statuses);
const copy = value => JSON.parse(JSON.stringify(value));
const probe = element => ({ id: 'void_status_probe', name: '状態異常検証', kind: 'attack', element, category: 'physical', power: 2, accuracy: 100, pp: 99 });
const dirty = (mon, kind) => Object.assign(mon, { status: kind, statusTurns: 3 });
const clean = (mon, label) => {
  assert.equal(mon.status, undefined, `${label}: no condition`);
  assert.equal(mon.statusTurns, undefined, `${label}: no leftover condition counter`);
};
const conditionEvents = events => events.filter(e => e.kind === 'status' || e.kind === 'statusTick');
function hero() { const e = new Engine(); assert(e.newGame('komori').ok); return e; }
function solo(ally = 'nullmie', enemy = 'komori') {
  const e = hero(); e.state.party = [e.makeMonster(ally, 50)];
  assert(e.startBattle('komori', 50, null, { wild: false }));
  e.battle.enemy = e.makeMonster(enemy, 50); e.rng = () => 0;
  return { e, ally: e.state.party[0], enemy: e.battle.enemy };
}
function team(first, size) { return [first, ...['nullmie', 'nullva', 'zeroveil', 'komori', 'shizuku'].filter(id => id !== first)].slice(0, size); }
function duel(mode = 'single', first = 'nullmie', opponent = 'komori') {
  const size = Duel.teamSize(mode);
  const d = Duel.create({ mode, teams: [team(first, size), team(opponent, size)], seed: 41019 });
  d._random = () => 0; return d;
}
function linkHit(d, side, slot, targetSlot, move) {
  const mon = d.active(side)[slot]; mon.pp[move.id] = 99;
  d.state.events = []; d._apply({ technique: move, side, slot, target: targetSlot }, mon);
  return d.state.events;
}
function amount(events) { const hit = events.find(e => e.kind === 'damage'); assert(hit, 'The attack still lands'); assert(hit.amount > 0); return hit.amount; }

test('all three stages reject every condition in adventure and both link modes, without spending a berry', () => {
  assert.equal(CONDITIONS.length, 5, 'Audit new condition categories when the catalog changes');
  for (const id of VOID) for (const kind of CONDITIONS) {
    const move = probe(D.statuses[kind].element), { e, ally } = solo(id);
    ally.heldItem = 'allberry'; const events = [];
    assert.equal(e.inflictCondition(ally, 'ally', move, events), false, `${id}/${kind}: adventure rejection`);
    e.heldReact(ally, 'ally', events); clean(ally, `${id}/${kind}: adventure`);
    assert.equal(ally.heldItem, 'allberry'); assert.equal(conditionEvents(events).length, 0);
    for (const mode of ['single', 'double']) {
      const d = duel(mode, id), mon = d.active(0)[0]; mon.item = 'allberry';
      assert.equal(d._inflict(0, 0, mon, move), false, `${mode}/${id}/${kind}: link rejection`);
      d._react(0, 0, mon); clean(mon, `${mode}/${id}/${kind}`);
      assert.equal(mon.item, 'allberry'); assert.equal(conditionEvents(d.state.events).length, 0);
    }
  }
});

test('immunity follows the declared type, not a hard-coded list of the three species', () => {
  const original = D.species.komori.element, originalTypes = D.species.komori.types;
  try {
    D.species.komori.element = 'void';D.species.komori.types = ['void'];
    for (const kind of CONDITIONS) {
      const move = probe(D.statuses[kind].element), { e, ally } = solo('komori');
      assert.equal(e.inflictCondition(ally, 'ally', move, []), false); clean(ally, `additional void species/${kind}`);
      const d = duel('double', 'komori'), mon = d.active(0)[0];
      assert.equal(d._inflict(0, 0, mon, move), false); clean(mon, `additional void species online/${kind}`);
    }
  } finally { D.species.komori.element = original;if(originalTypes===undefined)delete D.species.komori.types;else D.species.komori.types=originalTypes; }
});

test('real attack resolution damages void targets but never adds a condition, on either side or double slot', () => {
  for (const id of VOID) for (const kind of CONDITIONS) {
    const move = probe(D.statuses[kind].element);
    for (const targetSide of ['ally', 'enemy']) {
      const { e, ally, enemy } = targetSide === 'ally' ? solo(id, 'komori') : solo('komori', id);
      const target = targetSide === 'ally' ? ally : enemy, actor = targetSide === 'ally' ? enemy : ally;
      const hp = target.hp, events = []; e.applyMove(actor, target, move, targetSide === 'ally' ? 'enemy' : 'ally', events);
      assert.equal(hp - target.hp, amount(events)); clean(target, `${id}/${kind}/${targetSide}`);
      assert.equal(conditionEvents(events).length, 0);
    }
    for (const mode of ['single', 'double']) for (const targetSide of [0, 1]) {
      const d = duel(mode, id, id);
      for (let targetSlot = 0; targetSlot < d.active(targetSide).length; targetSlot++) {
        const target = d.active(targetSide)[targetSlot]; target.species = id;
        const hp = target.hp, events = linkHit(d, 1 - targetSide, 0, targetSlot, move);
        assert.equal(hp - target.hp, amount(events)); clean(target, `${mode}/${id}/${kind}/${targetSide}/${targetSlot}`);
        assert.equal(conditionEvents(events).length, 0);
      }
    }
  }
});

test('residual conditions cannot stop a move, halve its damage, slow a void combatant, or consume cure items', () => {
  for (const id of VOID) for (const kind of CONDITIONS) {
    const { e, ally, enemy } = solo(id), move = probe(null), events = [];
    e.applyMove(ally, enemy, move, 'ally', events); const baseline = amount(events);
    enemy.hp = e.stats(enemy).hp; dirty(ally, kind); const affected = [];
    e.applyMove(ally, enemy, move, 'ally', affected);
    assert.equal(amount(affected), baseline, `${id}/${kind}: damage and ability to act unchanged`); clean(ally, `${id}/${kind}: action`);
    dirty(ally, kind); assert.equal(e.battleStats(ally).speed, e.stats(ally).speed); clean(ally, `${id}/${kind}: speed`);
    dirty(ally, kind); ally.heldItem = 'allberry'; const reaction = []; e.heldReact(ally, 'ally', reaction);
    clean(ally, `${id}/${kind}: item reaction`); assert.equal(ally.heldItem, 'allberry'); assert.equal(reaction.length, 0);
    for (const mode of ['single', 'double']) {
      const d = duel(mode, id), mon = d.active(0)[0], target = d.active(1)[0];
      const baseline = amount(linkHit(d, 0, 0, 0, move)); target.hp = target.maxHp;
      dirty(mon, kind); assert.equal(amount(linkHit(d, 0, 0, 0, move)), baseline, `${mode}/${id}/${kind}: attack`); clean(mon, 'link action');
      dirty(mon, kind); assert.equal(d.effectiveStats(mon).speed, mon.stats.speed); clean(mon, 'link speed');
      dirty(mon, kind); mon.item = 'allberry'; d.state.events = []; d._react(0, 0, mon);
      clean(mon, 'link item reaction'); assert.equal(mon.item, 'allberry'); assert.equal(d.state.events.length, 0);
    }
  }
});

test('turn-end cleanup removes all residual conditions without HP loss or false condition effects', () => {
  for (const kind of CONDITIONS) {
    const { e, ally, enemy } = solo('nullmie', 'zeroveil');
    dirty(ally, kind); dirty(enemy, kind); const hp = [ally.hp, enemy.hp], events = [];
    e.endOfTurn(events); assert.deepEqual([ally.hp, enemy.hp], hp);
    clean(ally, `adventure ally/${kind}`); clean(enemy, `adventure opponent/${kind}`); assert.equal(conditionEvents(events).length, 0);
    for (const mode of ['single', 'double']) {
      const d = duel(mode, 'nullmie', 'zeroveil'), active = [...d.active(0), ...d.active(1)];
      assert(active.every(mon => D.species[mon.species].element === 'void'));
      active.forEach(mon => dirty(mon, kind)); const before = active.map(mon => mon.hp);
      d._endOfTurn(); assert.deepEqual(active.map(mon => mon.hp), before);
      active.forEach(mon => clean(mon, `${mode}/${kind}`)); assert.equal(conditionEvents(d.state.events).length, 0);
    }
  }
});

test('older party and storage saves discard void conditions while preserving identities, HP, PP and held items', () => {
  for (const kind of [...CONDITIONS, 'unknown-old-condition']) {
    const e = hero();
    for (const [i, id] of VOID.entries()) {
      const mon = e.makeMonster(id, 50); mon.nickname = 'ぬる'; mon.shiny = true; mon.heldItem = 'allberry'; mon.hp -= 7;
      dirty(mon, kind); e.state.party.push(mon); e.markCaught(id);
      const stored = e.makeMonster(id, 50); stored.hp = i === 1 ? 0 : stored.hp - 9; dirty(stored, kind); e.state.storage.push(stored);
    }
    // A non-void companion's valid persistent condition must still survive.
    e.state.party[0].status = 'dizzy'; const raw = copy(e.state), original = JSON.stringify(raw);
    const expected = [...raw.party.slice(1), ...raw.storage].map(mon => { const result = copy(mon); delete result.status; delete result.statusTurns; return result; });
    const loaded = new Engine(raw); assert.equal(JSON.stringify(raw), original, 'Loading never mutates the supplied save');
    assert.deepEqual(copy([...loaded.state.party.slice(1), ...loaded.state.storage]), expected);
    assert.equal(loaded.state.party[0].status, 'dizzy');
    const exported = e.serialize();
    [...exported.party.slice(1), ...exported.storage].forEach(mon => clean(mon, `export/${kind}`));
    assert.equal(exported.party[0].status, 'dizzy');
  }
});

test('both evolutions discard residual conditions and preserve the individual and its held item', () => {
  for (const [from, to, level] of [['nullmie', 'nullva', 24], ['nullva', 'zeroveil', 48]]) for (const kind of CONDITIONS) {
    const e = hero(), mon = e.makeMonster(from, level); e.state.party.push(mon); e.markCaught(from);
    mon.nickname = 'ぬる'; mon.shiny = true; mon.heldItem = 'allberry'; dirty(mon, kind);
    const uid = mon.uid, events = []; e.giveXP(mon, 1, events);
    assert.equal(mon.species, to); assert(events.some(event => event.kind === 'evolve'));
    clean(mon, `${from} -> ${to}/${kind}`); assert.equal(mon.uid, uid); assert.equal(mon.nickname, 'ぬる');
    assert.equal(mon.shiny, true); assert.equal(mon.heldItem, 'allberry');
  }
});

test('non-void conditions, outgoing condition attacks, direct damage and stat stages retain their rules', () => {
  for (const kind of CONDITIONS) {
    const element = D.statuses[kind].element, targetId = element === 'leaf' ? 'shizuku' : 'komori', move = probe(element);
    const { e, ally, enemy } = solo('nullmie', targetId), events = [];
    e.applyMove(ally, enemy, move, 'ally', events); assert(amount(events) > 0); assert.equal(enemy.status, kind, `void attack still inflicts ${kind}`);
    const d = duel('double', 'zeroveil', targetId); linkHit(d, 0, 0, 0, move); assert.equal(d.active(1)[0].status, kind);
    const original = solo(targetId), ownKind = D.statusByElement[D.species[targetId].element];
    assert.equal(original.e.inflictCondition(original.ally, 'ally', probe(D.statuses[ownKind].element), []), false, 'Original same-type immunity remains');
  }
  const { e, ally } = solo('nullmie'); e.battle.stages.ally.speed = -2; e.battle.stages.ally.atk = 2;
  assert.equal(e.battleStats(ally).speed, Math.floor(e.stats(ally).speed / 2)); assert.equal(e.battleStats(ally).atk, e.stats(ally).atk * 2);
  const d = duel('double'), mon = d.active(0)[0]; mon.stages.speed = -2; mon.stages.atk = 2;
  assert.equal(d.effectiveStats(mon).speed, Math.floor(mon.stats.speed / 2)); assert.equal(d.effectiveStats(mon).atk, mon.stats.atk * 2);
});

test('link peers stay deterministic, clear reserve residue before it is shown, and fingerprint the immunity rule', () => {
  assert.equal(D.elements.void.statusImmune, true);
  const current = Duel.rulesFingerprint(), original = D.elements.void;
  try {
    const legacy = { ...original }; delete legacy.statusImmune; D.elements.void = legacy;
    assert.notEqual(Duel.rulesFingerprint(), current, 'Different immunity rules must fail the link compatibility handshake');
  } finally { D.elements.void = original; }
  assert.equal(Duel.rulesFingerprint(), current);
  for (const mode of ['single', 'double']) {
    const size = Duel.teamSize(mode), config = { mode, teams: [team('nullmie', size), team('zeroveil', size)], seed: 91839 };
    const peers = [Duel.create(config), Duel.create(copy(config))];
    peers.forEach(d => d.state.teams.forEach(team => team.monsters.forEach((mon, index) => {
      if (D.species[mon.species].element === 'void') dirty(mon, CONDITIONS[index % CONDITIONS.length]);
    })));
    for (let turn = 0; turn < 4 && peers[0].state.winner === null; turn++) {
      const orders = [peers[0].legalOrders(0), peers[0].legalOrders(1)];
      peers.forEach(d => d.resolve(copy(orders)));
      assert.equal(peers[0].fingerprint(), peers[1].fingerprint(), `${mode}: peer state agrees after turn ${turn}`);
      const snapshot = peers[0].snapshot();
      const checkTeams = teams => teams.forEach(team => team.monsters.forEach(mon => {
        if (D.species[mon.species].element === 'void') clean(mon, `${mode}: snapshot or visible event`);
      }));
      checkTeams(snapshot.teams); snapshot.events.forEach(event => { if (event.visual?.teams) checkTeams(event.visual.teams); });
    }
  }
});
