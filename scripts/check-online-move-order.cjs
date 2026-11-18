#!/usr/bin/env node
'use strict';
// An owned individual's four move slots reach both peers before numeric move
// commands are committed. This covers the shared Internet/local duel engine.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const select = marker => { const code = scripts.find(([, , code]) => code.includes(marker))?.[2]; assert(code, marker); return code; };
const copy = value => JSON.parse(JSON.stringify(value)), identity = () => [0, 1, 2, 3];
const orderA = [[2, 0, 3, 1], [3, 1, 0, 2], [1, 2, 3, 0], [3, 2, 1, 0]];
const orderB = [[3, 1, 0, 2], [2, 0, 3, 1], [3, 2, 1, 0], [1, 3, 0, 2]];

function runtime({ previousRules = false } = {}) {
  const timers = new Set(), context = vm.createContext({ console, crypto: webcrypto, TextEncoder, Uint8Array, Uint32Array,
    setTimeout(fn, ms) { const id = setTimeout(fn, ms); id.unref(); timers.add(id); return id; },
    clearTimeout(id) { timers.delete(id); clearTimeout(id); }
  });
  for (const [, attributes, code] of scripts) {
    if (/\bsrc=|application\/ld\+json/.test(attributes)) continue;
    vm.runInContext(code, context); if (context.LT?.Engine) break;
  }
  let duelCode = select('deterministic, save-independent rental-team duels');
  let linkCode = fs.readFileSync(path.join(root, 'online-futo.js'), 'utf8');
  if (previousRules) {
    // Reconstruct the previous handshake fingerprint, without relying on a
    // hard-coded checksum that would become stale when species data changes.
    assert(duelCode.includes("moveOrder: 'selected-owned-individual-four-slot-permutation-v48',"));
    duelCode = duelCode.replace("    moveOrder: 'selected-owned-individual-four-slot-permutation-v48',\n", '');
    linkCode = linkCode.replace(':owned-move-order-v48', '');
  }
  vm.runInContext(duelCode, context);
  vm.runInContext(select('peer-to-peer casual duel protocol'), context);
  const { LT } = context, engine = new LT.Engine(); assert(engine.newGame('hibana').ok);
  LT.adminBridge = { getEngine: () => engine };
  vm.runInContext(linkCode, context);
  return { LT, engine, dispose() { for (const timer of timers) clearTimeout(timer); timers.clear(); } };
}

function stock(env, mode, ordered = true) {
  const ids = ['futo', 'komori', 'shizuku', 'nullmie'].slice(0, env.LT.Duel.teamSize(mode));
  env.engine.state.party = []; env.engine.state.storage = [];
  for (const [side, orders] of [orderA, orderB].entries()) for (const [index, species] of ids.entries()) {
    const mon = env.engine.makeMonster(species, 50); mon.uid = `order-${side}-${species}`;
    if (ordered) mon.moveOrder = orders[index].slice();
    if (species === 'futo') {
      mon.grantId = `gift-order-${side}`;
      mon.customMoves = [...env.LT.DATA.species.komori.moves];
    }
    env.engine.state[side ? 'storage' : 'party'].push(mon); env.engine.markCaught(species);
  }
  return ids;
}

function pair(env, mode = 'single', remote = env) {
  const queue = [], packets = [], sessions = [env, remote].map((source, role) => new source.LT.DuelSession({ role, mode,
    send(message) { const wire = copy(message); queue.push({ from: role, message: wire }); packets.push({ from: role, message: copy(wire) }); return true; }
  }));
  sessions[0].seed = 48048;
  return { sessions, queue, packets,
    async flush() { let count = 0; while (queue.length) { assert(++count < 100, 'Protocol did not settle'); const { from, message } = queue.shift(); await sessions[1 - from].receive(message); } },
    async start() { sessions.forEach(session => session.start()); await this.flush(); },
    close() { sessions.forEach(session => session.close()); }
  };
}

async function main() {
  const env = runtime(), { LT, engine } = env, { Duel } = LT;
  try {
    const ids = stock(env, 'single'), teams = [ids, ids], missing = [0, 1, 2, 3]; delete missing[2];
    const invalid = [null, {}, '0123', [], [0, 1, 2], [0, 1, 2, 3, 4], [0, 0, 2, 3], [-1, 1, 2, 3], [0, 1, 2, 4], [0, 1, 2, 1.5], ['0', 1, 2, 3], [0, 1, 2, NaN], [0, 1, 2, undefined], missing, ['nudge', 'dew', 'focus', 'restsong']];
    assert(Duel.validateMoveOrder(undefined).ok);
    for (const value of invalid) {
      assert.equal(Duel.validateMoveOrder(value).ok, false, String(value));
      assert.throws(() => Duel.create({ mode: 'single', teams, seed: 1, moveOrders: [[value, identity(), identity()], undefined] }), /技の並び/);
    }
    for (const value of [null, {}, [], [identity()], [identity(), undefined, identity()], [identity(), null, identity()]])
      assert.equal(Duel.validateMoveOrders(value, 3).ok, false);
    const plain = Duel.create({ mode: 'single', teams, seed: 1 });
    assert.deepEqual(copy(plain.state.teams[0].monsters[0].moveOrder), identity());
    assert.deepEqual(copy(plain.moves(plain.active(0)[0]).map(move => move.id)), copy(LT.DATA.species.futo.moves));
    const configOrders = [orderA.slice(0, 3).map(copy), orderB.slice(0, 3).map(copy)];
    const ordered = Duel.create({ mode: 'single', teams, seed: 1, moveOrders: configOrders });
    const saved = ordered.fingerprint(); configOrders[0][0].reverse(); ordered.snapshot().teams[0].monsters[0].moveOrder.reverse();
    assert.equal(ordered.fingerprint(), saved, 'The duel owns a copy of its order');
    assert.notEqual(plain.fingerprint(), saved, 'Move order participates in state synchronization');

    // Each side chooses a different UID of the same species, including reserve
    // individuals and Futo whose adventure moves differ from its standard quartet.
    for (const mode of ['single', 'double']) {
      const ids = stock(env, mode), before = JSON.stringify(engine.state), p = pair(env, mode); await p.start();
      for (const side of [0, 1]) {
        const result = await p.sessions[side].setTeam({ name: `Side ${side}`, ids, uids: ids.map(id => `order-${side}-${id}`), moveOrders: ids.map(() => [9, 9, 9, 9]) });
        assert(result.ok, result.error);
      }
      await p.flush();
      assert(p.sessions.every(session => session.snapshot().phase === 'choosing'));
      const duels = p.sessions.map(session => session.duel);
      assert.equal(duels[0].fingerprint(), duels[1].fingerprint());
      for (const side of [0, 1]) {
        const orders = (side ? orderB : orderA).slice(0, ids.length);
        assert.deepEqual(p.packets.find(packet => packet.from === side && packet.message.t === 'ready').message.team.moveOrders, orders);
        for (const [index, id] of ids.entries()) for (const duel of duels) {
          const mon = duel.state.teams[side].monsters[index];
          assert.deepEqual(copy(mon.moveOrder), orders[index]);
          assert.deepEqual(copy(duel.moves(mon).map(move => move.id)), orders[index].map(slot => LT.DATA.species[id].moves[slot]));
          assert.deepEqual(Object.keys(mon.pp).sort(), [...LT.DATA.species[id].moves].sort(), 'Order cannot add or replace a technique');
        }
      }
      const expected = [], commands = [0, 1].map(side => duels[0].active(side).map((mon, slot) => {
        // Futo uses a real attack; its partner uses a non-attack so neither
        // side can prevent the other's action by inflicting a condition first.
        const canonical = LT.DATA.species[mon.species].moves;
        const baseSlot = slot === 0 ? side : canonical.findIndex(id => LT.DATA.moves[id].kind !== 'attack');
        assert(baseSlot >= 0); const move = mon.moveOrder.indexOf(baseSlot), id = canonical[baseSlot];
        expected.push({ side, slot, id, pp: copy(mon.pp) });
        return { type: 'move', slot, move, target: 0 };
      }));
      assert.notEqual(expected[0].id, expected[mode === 'single' ? 1 : 2].id, 'The peers deliberately select different Futo attacks');
      await Promise.all(p.sessions.map((session, side) => session.submit(commands[side]))); await p.flush();
      assert(p.sessions.every(session => session.snapshot().phase === 'choosing'));
      assert.equal(duels[0].fingerprint(), duels[1].fingerprint(), `${mode}: commit/reveal chose the same techniques on both peers`);
      for (const { side, slot, id, pp } of expected) for (const duel of duels) {
        const mon = duel.active(side)[slot];
        for (const [technique, amount] of Object.entries(pp)) assert.equal(mon.pp[technique], amount - Number(technique === id), `${mode}: only the selected move spends PP`);
        assert(duel.state.events.some(event => event.side === side && event.slot === slot && event.move === id), `${mode}: actual move event matches the displayed position`);
      }
      assert.equal(JSON.stringify(engine.state), before, 'Link battles do not change the adventure individual'); p.close();
    }

    // Missing metadata is identity, even when the peer omits the whole field.
    const legacyIds = stock(env, 'single', false), old = pair(env); await old.start();
    for (const side of [0, 1]) assert((await old.sessions[side].setTeam({ ids: legacyIds, uids: legacyIds.map(id => `order-${side}-${id}`) })).ok);
    for (const packet of old.queue) if (packet.message.t === 'ready') delete packet.message.team.moveOrders;
    await old.flush(); assert(old.sessions.every(session => session.snapshot().phase === 'choosing'));
    for (const session of old.sessions) for (const team of session.duel.state.teams) for (const mon of team.monsters) assert.deepEqual(copy(mon.moveOrder), identity());
    assert.equal(old.sessions[0].duel.fingerprint(), old.sessions[1].duel.fingerprint()); old.close();

    // Invalid local order fails before sending; a malformed received order is
    // rejected before creating a duel. Extra team keys remain disallowed.
    const bad = pair(env); await bad.start();
    const base = { name: 'Check', ids: legacyIds }, valid = legacyIds.map(identity);
    assert(bad.sessions[0]._validTeam(base)); assert(bad.sessions[0]._validTeam({ ...base, moveOrders: valid }));
    for (const value of invalid) assert.equal(bad.sessions[0]._validTeam({ ...base, moveOrders: [value, identity(), identity()] }), false);
    assert.equal(bad.sessions[0]._validTeam({ ...base, moveOrders: valid, moves: [['supernova']] }), false);
    engine.state.party[0].moveOrder = [0, 0, 2, 3]; const packetsBefore = bad.packets.length;
    assert.equal((await bad.sessions[0].setTeam({ ids: legacyIds })).ok, false); assert.equal(bad.packets.length, packetsBefore);
    delete engine.state.party[0].moveOrder;
    assert((await bad.sessions[0].setTeam({ ids: legacyIds })).ok);
    bad.queue.find(packet => packet.message.t === 'ready').message.team.moveOrders[0] = [0, 0, 2, 3];
    await bad.flush(); assert.equal(bad.sessions[1].snapshot().phase, 'error'); assert.equal(bad.sessions[1].duel, null); bad.close();

    const previous = runtime({ previousRules: true });
    try {
      assert.notEqual(LT.Duel.rulesFingerprint(), previous.LT.Duel.rulesFingerprint());
      const mixed = pair(env, 'single', previous); await mixed.start();
      assert(mixed.sessions.every(session => session.snapshot().phase === 'error'));
      assert(mixed.sessions.every(session => session.duel === null)); mixed.close();
    } finally { previous.dispose(); }
    console.log('Online move order checks passed: strict slot permutations, UID-specific party/reserve orders, standard Futo quartet, single/double commit-reveal move and PP agreement, metadata defaults, malformed-order rejection, prior-client handshake rejection and unchanged adventure data.');
  } finally { env.dispose(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
