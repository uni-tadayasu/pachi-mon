#!/usr/bin/env node
'use strict';
/* Link battles (online and local) with Arvelion, Floravelle and Futo: each joins
 * like any species once its owner has it — fixed Lv.50 stats from its balanced
 * species data, its species moves, the individual's allocation (Futo, whose
 * adventure stats are operator-set, spreads the whole budget evenly), its look.
 * No server is involved, both peers agree turn after turn, unowned special
 * monsters are refused before anything is sent, and the special moves keep their
 * effects (seven-stat boost with cap, guard, healing, stage resets). */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(m => m[2]);
const plain = value => JSON.parse(JSON.stringify(value));
const select = marker => {
  const code = scripts.find(code => code.includes(marker));
  assert(code, `Missing production script: ${marker}`); return code;
};
function setup() {
  const timers = new Set();
  const context = vm.createContext({ console, crypto: webcrypto, TextEncoder, Uint8Array, Uint32Array,
    setTimeout(fn, ms) { const id = setTimeout(fn, ms); id.unref(); timers.add(id); return id; },
    clearTimeout(id) { timers.delete(id); clearTimeout(id); },
  });
  for (const marker of ['original world and game data', 'Original creature atlas and optional journeys', 'the Meridian Accord, an original 256-species atlas', 'two-stage starter lineages, retaining every existing species ID', 'Arvelion, the original roaming legendary', 'owner-only leaf mythical, outside all ordinary acquisition pools']) vm.runInContext(select(marker), context);
  vm.runInContext(select('deterministic combat, interiors, league and versioned saves'), context);
  assert(context.LT.DATA.species.futo, 'Futo production species must exist');
  for (const marker of ['deterministic, save-independent rental-team duels', 'peer-to-peer casual duel protocol']) vm.runInContext(select(marker), context);
  const LT = context.LT;
  const normal = Object.keys(LT.DATA.species).filter(id => !LT.DATA.species[id].specialOnly);
  assert.equal(normal.length, 254, 'Online test must load the full production species data');
  for (const id of ['komorizen', 'shizunaria', 'akehomura']) assert(normal.includes(id), `Missing starter final form ${id}`);
  // A gifted Futo with operator stats and moves (adventure only), and a nicknamed ordinary monster.
  const state = { party: [{ species: 'futo', level: 99, uid: 'futo-1', grantId: 'gift-test-001', nickname: 'フーちゃん', shiny: false, customStatsLevel: 88,
    customStats: { hp: 99999, atk: 9999, def: 9999, spAtk: 9999, spDef: 9999, speed: 9999, accuracy: 300, evasion: 300 }, customMoves: ['supernova', 'atlas_crystal_4', 'starlight', 'shell'] },
    { species: normal[0], level: 100, uid: 'k-1', nickname: 'きらり', shiny: true }], storage: [] };
  let serverCalls = 0;
  LT.adminBridge = { getEngine: () => ({ state }) };
  // Link battles need no server: any call here fails the check.
  LT.Admin = { async requestDuelPass() { serverCalls++; throw Error('no server in link battles'); }, async verifyDuelPass() { serverCalls++; throw Error('no server in link battles'); } };
  vm.runInContext(fs.readFileSync(path.join(root, 'online-futo.js'), 'utf8'), context);
  function pair(mode = 'single') {
    const queue = [];
    const sessions = [0, 1].map(role => new LT.DuelSession({ role, mode, send: message => { queue.push({ from: role, message }); return true; } }));
    const flush = async () => {
      let count = 0;
      while (queue.length) {
        assert(++count < 100, 'Protocol failed to settle');
        const { from, message } = queue.shift();
        await sessions[1 - from].receive(message);
      }
    };
    return { sessions, flush, queue, async start() { sessions.forEach(s => s.start()); await flush(); }, close() { sessions.forEach(s => s.close()); } };
  }
  return { LT, normal, state, pair, get serverCalls() { return serverCalls; }, dispose() { for (const timer of timers) clearTimeout(timer); } };
}
// Lv.50 stats as every species gets them, with optional allocation.
function standard(LT, species, alloc = null) {
  const b = LT.DATA.species[species].base, a = alloc || {}, hpPer = LT.Duel.rules.allocation.hpPerPoint;
  return { hp: b.hp + 250 + (a.hp || 0) * hpPer, atk: b.atk + 150 + (a.atk || 0), def: b.def + 100 + (a.def || 0), spAtk: (b.spAtk ?? b.atk) + 150 + (a.spAtk || 0),
    spDef: (b.spDef ?? b.def) + 100 + (a.spDef || 0), speed: b.speed + 100 + (a.speed || 0), accuracy: b.accuracy ?? 100, evasion: b.evasion ?? 100 };
}

async function combatScenarios(env) {
  const { LT, normal } = env;
  const moveIds = ['futo_breaker', 'futo_burst', 'futo_ascend', 'futo_restore'];
  assert.deepEqual(plain(LT.DATA.species.futo.moves), moveIds, 'Futo default quartet');
  const pair = env.pair(); await pair.start();
  assert((await pair.sessions[0].setTeam({ name: 'Futo combat', ids: ['futo', ...normal.slice(0, 2)] })).ok);
  assert((await pair.sessions[1].setTeam({ name: 'Opponent', ids: normal.slice(2, 5) })).ok);
  await pair.flush();
  assert(pair.sessions.every(s => s.snapshot().phase === 'choosing'));
  const duel = pair.sessions[0].duel, initial = JSON.stringify(duel.state), dataBefore = JSON.stringify(LT.DATA);
  await Promise.all([pair.sessions[0].submit([{ type: 'move', slot: 0, move: 2, target: 0 }]), pair.sessions[1].submit(pair.sessions[1].duel.legalOrders(1))]);
  await pair.flush();
  assert.equal(duel.fingerprint(), pair.sessions[1].duel.fingerprint(), 'Real commit/reveal and sync agree after boosting');
  assert(Object.values(duel.state.teams[0].monsters[0].stages).every(v => v === 1));
  const reset = () => { duel.state = JSON.parse(initial); duel._random = () => .5; return [duel.state.teams[0].monsters[0], duel.state.teams[1].monsters[0]]; };
  const apply = (id, side = 0) => { const mon = duel.state.teams[side].monsters[duel.state.teams[side].active[0]]; duel._apply({ side, slot: 0, target: 0, technique: LT.DATA.moves[id] }, mon); };
  let [actor, target] = reset();
  assert.deepEqual(plain(duel.moves(actor).map(m => m.maxPP)), [10, 10, 2, 5]);
  assert.equal(duel.moves(actor)[0].category, 'physical'); assert.equal(duel.moves(actor)[1].category, 'special');
  assert.equal(duel.moves(actor)[0].power, 62); assert.equal(duel.moves(actor)[1].power, 62);
  const hpBefore = [actor.hp, actor.maxHp, target.hp];
  apply('futo_ascend');
  assert(Object.values(actor.stages).every(v => v === 1));
  assert.deepEqual([actor.hp, actor.maxHp, target.hp], hpBefore, 'Boost targets self and never changes HP');
  assert.equal(actor.pp.futo_ascend, 1, 'The seven-stat boost has two uses');
  const effective = duel.effectiveStats(actor), base = actor.stats;
  for (const key of ['atk', 'def', 'spAtk', 'spDef', 'speed']) assert.equal(effective[key], Math.floor(base[key] * 1.5));
  for (const key of ['accuracy', 'evasion']) assert.equal(effective[key], Math.floor(base[key] * 4 / 3));
  assert.equal(effective.hp, base.hp);
  assert.equal(duel.state.events.at(-1).kind, 'boost'); assert.equal(duel.state.events.at(-1).side, 0);
  for (const key of Object.keys(actor.stages)) actor.stages[key] = 5;
  actor.pp.futo_ascend = 2; apply('futo_ascend'); apply('futo_ascend');
  assert(Object.values(actor.stages).every(v => v === 6), 'All seven stage values cap at six');
  assert.equal(duel.state.events.at(-1).changed, false);
  function damage(move, offenseKey, defenseKey, boostActor, boostDefender) {
    const [a, t] = reset(); t.hp = t.maxHp = 99999; a.stages[offenseKey] = boostActor; t.stages[defenseKey] = boostDefender;
    apply(move); return duel.state.events.find(e => e.kind === 'damage').amount;
  }
  for (const [move, offense, defense] of [['futo_breaker', 'atk', 'def'], ['futo_burst', 'spAtk', 'spDef']]) {
    const baseline = damage(move, offense, defense, 0, 0);
    assert(damage(move, offense, defense, 1, 0) > baseline, `${offense} boost increases real damage`);
    assert(damage(move, offense, defense, 0, 1) < baseline, `${defense} boost lowers real damage`);
  }
  // Accuracy 102 against evasion 240: 42.5% unboosted (a 0.5 roll misses), 56.7% at +1 (it hits).
  [actor, target] = reset(); actor.stats.accuracy = 102; target.stats.evasion = 240; apply('futo_breaker');
  assert.equal(duel.state.events[0].kind, 'miss', 'Unboosted accuracy can miss');
  [actor, target] = reset(); actor.stats.accuracy = 102; target.stats.evasion = 240; actor.stages.accuracy = 1; apply('futo_breaker');
  assert.equal(duel.state.events[0].kind, 'damage', 'Accuracy stage changes hit outcome');
  function actionOrder(speedStage) {
    const [a, t] = reset(); a.stats.speed = 100; t.stats.speed = 120; a.stages.speed = speedStage; a.hp = a.maxHp = t.hp = t.maxHp = 99999;
    const enemyAttack = duel.moves(t).findIndex(m => m.kind === 'attack'); assert(enemyAttack >= 0);
    duel.resolve([[{ type: 'move', slot: 0, move: 0, target: 0 }], [{ type: 'move', slot: 0, move: enemyAttack, target: 0 }]]);
    return duel.state.events.find(e => e.kind === 'damage' || e.kind === 'miss').side;
  }
  assert.equal(actionOrder(0), 1); assert.equal(actionOrder(1), 0, 'Speed stages determine next-turn action order');
  [actor, target] = reset(); for (const key of Object.keys(actor.stages)) actor.stages[key] = 2;
  const enemyAttack = duel.moves(target).findIndex(m => m.kind === 'attack');
  duel.resolve([[{ type: 'switch', slot: 0, index: 1 }], [{ type: 'move', slot: 0, move: enemyAttack, target: 0 }]]);
  assert(Object.values(actor.stages).every(v => v === 0), 'Switching out clears stages');
  [actor, target] = reset(); for (const key of Object.keys(target.stages)) target.stages[key] = 2; target.hp = 1; apply('futo_breaker');
  assert.equal(target.hp, 0); assert(Object.values(target.stages).every(v => v === 0), 'Fainting clears stages immediately');
  [actor, target] = reset(); actor.hp = 100; apply('futo_restore');
  assert.equal(actor.hp, 100 + Math.ceil(actor.maxHp * .45)); assert.equal(actor.pp.futo_restore, 4);
  actor.hp = actor.maxHp - 10; apply('futo_restore'); assert.equal(actor.hp, actor.maxHp, 'Healing clamps to max HP');
  [actor, target] = reset(); const hash = duel.fingerprint(); actor.stages.atk = 1;
  assert.notEqual(duel.fingerprint(), hash, 'Stages participate in synchronization checksum');
  assert.equal(JSON.stringify(LT.DATA), dataBefore, 'Combat does not mutate species or move definitions');
  pair.close();
  // Doubles: the boost stays on its own slot.
  const doubles = env.pair('double'); await doubles.start();
  assert((await doubles.sessions[0].setTeam({ name: 'Double Futo', ids: [normal[0], 'futo', ...normal.slice(1, 3)] })).ok);
  assert((await doubles.sessions[1].setTeam({ name: 'Double opponent', ids: normal.slice(3, 7) })).ok);
  await doubles.flush();
  await Promise.all([
    doubles.sessions[0].submit([{ type: 'switch', slot: 0, index: 2 }, { type: 'move', slot: 1, move: 2, target: 0 }]),
    doubles.sessions[1].submit([{ type: 'switch', slot: 0, index: 2 }, { type: 'switch', slot: 1, index: 3 }])
  ]);
  await doubles.flush();
  const doubleDuel = doubles.sessions[0].duel, boost = doubleDuel.state.events.find(e => e.kind === 'boost');
  assert.equal(boost.side, 0); assert.equal(boost.slot, 1); assert.equal(boost.move, 'futo_ascend');
  assert(Object.values(doubleDuel.state.teams[0].monsters[1].stages).every(v => v === 1), 'Doubles slot 1 boosts itself');
  assert(Object.values(doubleDuel.state.teams[0].monsters[2].stages).every(v => v === 0), 'Doubles ally is unaffected');
  assert.equal(doubleDuel.fingerprint(), doubles.sessions[1].duel.fingerprint());
  doubles.close();
  // Peers on other rules are turned away before choosing teams.
  for(const oldRules of ['previous-rules',LT.Duel.rulesFingerprint().replace(':lunar-super-genderless-v74',''),LT.Duel.rulesFingerprint().replace(':owned-battle-growth-source-level-v79',''),LT.Duel.rulesFingerprint().replace(':vernix-three-form-moves-v83','')]){
    const mismatch = env.pair(); mismatch.sessions.forEach(s => s.start());
    mismatch.queue.forEach(item => { item.message.rules = oldRules; }); await mismatch.flush();
    assert(mismatch.sessions.every(s => s.snapshot().phase === 'error'));
    assert(mismatch.sessions.some(s => s.snapshot().message.includes('バージョンが一致しません')), 'Older rules, including the previous single-form roster, fail clearly before team selection');
    mismatch.close();
  }
  return ['species quartet, PP and power', 'two-use seven-stat boost and cap', 'physical/special damage and defenses', 'accuracy/evasion', 'speed order', 'switch/faint stage reset', '45-percent healing and cap', 'stage checksum', 'doubles slot', 'rules mismatch'];
}

(async () => {
  const env = setup(), { LT, normal, state } = env;
  try {
    // The duel accepts every species; the roster offers the special ones only to their owners.
    assert(LT.Duel.validateTeam(['futo', ...normal.slice(0, 2)], 'single').ok, 'Special species battle like any other');
    assert(LT.Duel.validateTeam(['floravelle', 'arvelion', 'futo'], 'single').ok);
    assert(!LT.Duel.validateTeam(['missing', ...normal.slice(0, 2)], 'single').ok);
    assert.equal(LT.Duel.rules.version, 11); assert.match(LT.Duel.rulesFingerprint(), /special-three-standard/); assert.match(LT.Duel.rulesFingerprint(), /:lunar-super-genderless-v74:/); assert.match(LT.Duel.rulesFingerprint(), /:owned-battle-growth-source-level-v79:/); assert.match(LT.Duel.rulesFingerprint(), /:vernix-three-form-moves-v83$/);
    assert(LT.OnlineFuto.rosterIds(normal).includes('futo'), 'A received Futo is selectable');
    assert(!LT.OnlineFuto.rosterIds(normal).includes('arvelion'), 'Unowned legendary is not a free rental');
    assert(!LT.OnlineFuto.rosterIds(normal).includes('floravelle'), 'Unowned mythical is not offered');
    assert.equal(LT.OnlineFuto.rosterIds(normal).filter(id => id !== 'futo').length, 253);
    const savedState = JSON.stringify(state);

    // Ordinary teams: standard stats, the player's looks, both peers agree.
    const rentals = env.pair(); await rentals.start();
    assert((await rentals.sessions[0].setTeam({ name: 'A', ids: normal.slice(0, 3) })).ok);
    assert((await rentals.sessions[1].setTeam({ name: 'B', ids: normal.slice(3, 6) })).ok);
    await rentals.flush();
    assert(rentals.sessions.every(s => s.snapshot().phase === 'choosing'));
    assert(rentals.sessions[0].duel.state.teams.every(t => t.monsters.every(m => m.level === 50)));
    const rentalMon = rentals.sessions[0].duel.state.teams[0].monsters[0];
    assert.equal(rentalMon.nickname, 'きらり'); assert.equal(rentalMon.shiny, true);
    assert.equal(rentals.sessions[0].duel.fingerprint(), rentals.sessions[1].duel.fingerprint());
    assert(!rentals.sessions[0]._validTeam({ name: 'bad', ids: normal.slice(0, 3), appearance: [{ nickname: 'あいうえおか', shiny: false }, { nickname: '', shiny: false }, { nickname: '', shiny: false }] }));
    assert(!rentals.sessions[0]._validTeam({ name: 'bad', ids: normal.slice(0, 3), appearance: [{ nickname: '', shiny: false, stats: { hp: 999999 } }, { nickname: '', shiny: false }, { nickname: '', shiny: false }] }));
    // Old-style packets carrying passes or stats are malformed now.
    assert(!rentals.sessions[0]._validTeam({ name: 'bad', ids: ['futo', ...normal.slice(0, 2)], futo: { pass: 'x'.repeat(40) } }));
    for (const ids of ['floravelle', {}, null, 42]) assert.equal(rentals.sessions[0]._validTeam({ name: 'Malformed', ids }), false);
    rentals.close();

    // Unowned special monsters are refused before anything is sent.
    const unowned = env.pair(); await unowned.start();
    assert(!(await unowned.sessions[0].setTeam({ name: 'Unowned legend', ids: ['arvelion', ...normal.slice(0, 2)] })).ok);
    assert(!(await unowned.sessions[0].setTeam({ name: 'Unowned mythical', ids: ['floravelle', ...normal.slice(0, 2)] })).ok);
    assert.equal(unowned.sessions[0]._teams[0], null); assert.equal(unowned.queue.length, 0); unowned.close();

    // Arvelion: owned in storage, standard stats with its own points, look kept, adventure untouched.
    state.storage.push({ species: 'arvelion', level: 100, uid: 'a-1', nickname: 'ほしおう', shiny: true, alloc: { atk: 40, speed: 30 } });
    assert(LT.OnlineFuto.rosterIds(normal).includes('arvelion'), 'An owned reserve legendary is selectable');
    const legendaryPair = env.pair(); await legendaryPair.start();
    assert((await legendaryPair.sessions[0].setTeam({ name: 'Legend owner', ids: ['arvelion', ...normal.slice(0, 2)] })).ok);
    assert((await legendaryPair.sessions[1].setTeam({ name: 'Opponent', ids: normal.slice(2, 5) })).ok);
    await legendaryPair.flush();
    assert(legendaryPair.sessions.every(s => s.snapshot().phase === 'choosing'));
    const legendaryMon = legendaryPair.sessions[0].duel.state.teams[0].monsters[0];
    assert.equal(legendaryMon.species, 'arvelion'); assert.equal(legendaryMon.level, 50);
    assert.equal(legendaryMon.nickname, 'ほしおう'); assert.equal(legendaryMon.shiny, true);
    assert.deepEqual(plain(legendaryMon.stats), standard(LT, 'arvelion', plain(LT.Duel.scaleAllocation({ atk: 40, speed: 30 }))));
    assert.equal(legendaryPair.sessions[0].duel.fingerprint(), legendaryPair.sessions[1].duel.fingerprint());
    legendaryPair.close();
    state.storage = [];
    assert(!LT.OnlineFuto.rosterIds(normal).includes('arvelion'), 'Released legendary leaves the local roster');

    // The off-dex line is offered only as an owned individual. Its appearance,
    // complete allocation and standard Lv.50 stats reach both online/local peers.
    const hiddenIds = [...LT.DATA.glitchLine.ids];
    assert(hiddenIds.every(id => !LT.OnlineFuto.rosterIds(normal).includes(id)));
    const hiddenUnowned = env.pair(); await hiddenUnowned.start();
    for (const id of hiddenIds) assert(!(await hiddenUnowned.sessions[0].setTeam({ ids: [id, ...normal.slice(0, 2)] })).ok);
    assert.equal(hiddenUnowned.queue.length, 0); hiddenUnowned.close();
    state.storage = hiddenIds.map((id, i) => ({ species: id, uid: 'null-' + i, level: 100, nickname: ['ぬる', 'ヴァ', 'ゼロ'][i], shiny: true, alloc: { hp: 64, spAtk: 64, speed: 64 } }));
    assert(hiddenIds.every(id => LT.OnlineFuto.rosterIds(normal).includes(id)));
    const hiddenSave = JSON.stringify(state), hidden = env.pair(); await hidden.start();
    assert((await hidden.sessions[0].setTeam({ name: 'Null owner', ids: hiddenIds, uids: state.storage.map(mon => mon.uid) })).ok);
    assert((await hidden.sessions[1].setTeam({ name: 'Opponent', ids: normal.slice(3, 6) })).ok);
    await hidden.flush();
    assert(hidden.sessions.every(session => session.snapshot().phase === 'choosing'));
    for (const [i, mon] of hidden.sessions[0].duel.state.teams[0].monsters.entries()) {
      assert.equal(mon.species, hiddenIds[i]); assert.equal(mon.level, 50); assert.equal(mon.nickname, state.storage[i].nickname); assert.equal(mon.shiny, true);
      assert.deepEqual(plain(mon.stats), standard(LT, hiddenIds[i], plain(LT.Duel.normalizeAllocation(state.storage[i].alloc))));
      assert.deepEqual(Object.keys(mon.pp), plain(LT.DATA.species[hiddenIds[i]].moves));
    }
    assert.equal(hidden.sessions[0].duel.fingerprint(), hidden.sessions[1].duel.fingerprint());
    await Promise.all(hidden.sessions.map(session => session.submit(session.duel.legalOrders(session.role)))); await hidden.flush();
    assert.equal(hidden.sessions[0].duel.fingerprint(), hidden.sessions[1].duel.fingerprint());
    assert.equal(JSON.stringify(state), hiddenSave); hidden.close(); state.storage = [];
    assert(hiddenIds.every(id => !LT.OnlineFuto.rosterIds(normal).includes(id)), 'Released/evolved-away forms do not remain selectable');

    // Each of the eight other off-dex forms and the three Vernix-lineage forms follows ownership rules independently
    // of the Null lineage. Verify actual peer setup, moves and a synchronized turn.
    const addedIds = [...LT.DATA.offDexLines.ids, ...LT.DATA.offDexLeaders.ids]; assert.equal(addedIds.length, 11);
    assert(addedIds.every(id => !LT.OnlineFuto.rosterIds(normal).includes(id)));
    const addedUnowned = env.pair(); await addedUnowned.start();
    for (const id of addedIds) assert(!(await addedUnowned.sessions[0].setTeam({ ids: [id, ...normal.slice(0, 2)] })).ok);
    assert.equal(addedUnowned.queue.length, 0); addedUnowned.close();
    for (const [index, id] of addedIds.entries()) {
      const individual = { species: id, uid: 'offdex-' + index, level: 100, nickname: 'とくべつ', shiny: true,
        alloc: { hp: 32, atk: 32, def: 32, spAtk: 32, spDef: 32, speed: 32 }, moveOrder: [3, 1, 0, 2], curse: true };
      state.storage = [individual];
      assert(LT.OnlineFuto.rosterIds(normal).includes(id));
      assert.equal(LT.OnlineFuto.rosterIds(normal).filter(value => value === id).length, 1);
      assert(addedIds.filter(value => value !== id).every(value => !LT.OnlineFuto.rosterIds(normal).includes(value)), 'Other forms are not unlocked by owning this form');
      const before = JSON.stringify(state), added = env.pair(); await added.start();
      assert((await added.sessions[0].setTeam({ name: 'Hidden owner', ids: [id, ...normal.slice(0, 2)] })).ok);
      assert((await added.sessions[1].setTeam({ name: 'Opponent', ids: normal.slice(3, 6) })).ok);
      await added.flush();
      const mon = added.sessions[0].duel.state.teams[0].monsters[0];
      assert.equal(mon.species, id); assert.equal(mon.level, 50); assert.equal(mon.nickname, individual.nickname); assert.equal(mon.shiny, true);
      assert.deepEqual(plain(mon.stats), standard(LT, id, plain(LT.Duel.normalizeAllocation(individual.alloc))));
      assert.deepEqual(Object.keys(mon.pp), plain(LT.DATA.species[id].moves));
      assert.equal(mon.curse, true, 'New hidden families use ordinary curse rules, not Void immunity');
      assert.equal(LT.Abilities.get(mon).id, LT.Abilities.get(id).id);
      assert.equal(added.sessions[0].duel.fingerprint(), added.sessions[1].duel.fingerprint());
      await Promise.all(added.sessions.map(session => session.submit(session.duel.legalOrders(session.role)))); await added.flush();
      assert.equal(added.sessions[0].duel.fingerprint(), added.sessions[1].duel.fingerprint());
      assert.equal(JSON.stringify(state), before, 'Link battle leaves the adventure individual untouched');
      added.close(); state.storage = [];
      assert(!LT.OnlineFuto.rosterIds(normal).includes(id), 'Releasing an off-dex form removes its roster entry');
    }

    // Futo: standard stats with the even spread, species moves — not the operator's adventure stats or moves.
    const pair = env.pair(); await pair.start();
    assert((await pair.sessions[0].setTeam({ name: '運営', ids: ['futo', ...normal.slice(0, 2)] })).ok);
    assert((await pair.sessions[1].setTeam({ name: '一般', ids: normal.slice(2, 5) })).ok);
    await pair.flush();
    assert(pair.sessions.every(s => s.snapshot().phase === 'choosing'));
    const duel = pair.sessions[0].duel, mon = duel.state.teams[0].monsters[0];
    assert.equal(mon.species, 'futo'); assert.equal(mon.level, 50); assert.equal(mon.nickname, 'フーちゃん'); assert.equal(mon.shiny, false);
    assert.deepEqual(plain(mon.stats), standard(LT, 'futo', plain(LT.OnlineFuto.linkAllocation)));
    assert.deepEqual(plain(duel.moves(mon).map(m => m.id)), plain(LT.DATA.species.futo.moves));
    assert.equal(mon.hp, mon.maxHp);
    assert.equal(pair.sessions[0].duel.fingerprint(), pair.sessions[1].duel.fingerprint());
    const commands = pair.sessions.map(s => s.duel.legalOrders(s.role));
    await Promise.all(pair.sessions.map((s, side) => s.submit(commands[side])));
    await pair.flush();
    assert.equal(pair.sessions[0].duel.fingerprint(), pair.sessions[1].duel.fingerprint());
    assert.equal(JSON.stringify(state), savedState, 'Link battles never change the adventure save');
    pair.close();

    // A released Futo leaves the roster, even with its receipt kept.
    state.party = [state.party[1]]; state.giftReceipts = ['gift-test-001'];
    assert(!LT.OnlineFuto.rosterIds(normal).includes('futo'));
    const unauth = env.pair(); await unauth.start();
    assert(!(await unauth.sessions[0].setTeam({ name: 'No grant', ids: ['futo', ...normal.slice(0, 2)] })).ok);
    unauth.close(); state.party = JSON.parse(savedState).party; delete state.giftReceipts;

    // Floravelle with Futo, singles and doubles: standard stats with its own points, species moves, peers agree.
    state.storage.push({ species: 'floravelle', grantId: 'admin-mythical:owner-test', uid: 'f-1', level: 100, nickname: 'はな', shiny: false, alloc: { spAtk: 64, hp: 30 } });
    const mythSaved = JSON.stringify(state);
    assert(LT.OnlineFuto.rosterIds(normal).includes('floravelle'));
    for (const mode of ['single', 'double']) {
      const myth = env.pair(mode); await myth.start();
      assert((await myth.sessions[0].setTeam({ name: 'Owner', ids: ['floravelle', 'futo', ...normal.slice(0, mode === 'single' ? 1 : 2)] })).ok);
      assert((await myth.sessions[1].setTeam({ name: 'Visitor', ids: normal.slice(4, mode === 'single' ? 7 : 8) })).ok);
      await myth.flush(); assert(myth.sessions.every(s => s.snapshot().phase === 'choosing'));
      const d = myth.sessions[0].duel, m = d.state.teams[0].monsters[0];
      assert.equal(m.species, 'floravelle'); assert.equal(m.level, 50); assert.equal(m.nickname, 'はな');
      assert.deepEqual(plain(m.stats), standard(LT, 'floravelle', plain(LT.Duel.scaleAllocation({ spAtk: 64, hp: 30 }))));
      assert.equal(d.state.teams[0].monsters[1].species, 'futo');
      assert.deepEqual(plain(d.moves(m).map(x => x.id)), plain(LT.DATA.species.floravelle.moves));
      // The receiving peer plays the same battle from the packet alone.
      assert.equal(d.fingerprint(), myth.sessions[1].duel.fingerprint());
      await Promise.all(myth.sessions.map(s => s.submit(s.duel.legalOrders(s.role)))); await myth.flush();
      assert.equal(d.fingerprint(), myth.sessions[1].duel.fingerprint()); myth.close();
    }
    assert.equal(JSON.stringify(state), mythSaved);
    state.storage = [];
    const combat = await combatScenarios(env);
    assert.equal(env.serverCalls, 0, 'No server was asked for anything');
    console.log(JSON.stringify({ ok: true, combat, scenarios: ['every species accepted by the duel, special ones offered only to owners', 'ordinary teams with looks', 'unowned special monsters refused before sending',
      'Arvelion at standard stats with its own points', 'Futo at standard stats with the even spread and species moves', 'Floravelle with Futo, singles and doubles', 'owned Null line with full points and synchronized peers', 'all 11 off-dex line and leader forms: ownership, full points, appearance, ability, ordinary curse, synchronized turn, release', 'no server calls', 'adventure save untouched'] }));
  } finally { env.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
