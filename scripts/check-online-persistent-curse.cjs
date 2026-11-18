#!/usr/bin/env node
'use strict';
// The selected individual's permanent curse reaches both link-battle peers;
// new duel conditions must never alter the adventure save.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const select = marker => { const code = scripts.find(([, , code]) => code.includes(marker))?.[2]; assert(code, marker); return code; };
const copy = value => JSON.parse(JSON.stringify(value));

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
    const current = 'full-heal-then-one-recharge-turn-permanent-quarter-hp-curse-stacks-immune-only-cure-active-living-tick-forced-scorch-v49';
    assert(duelCode.includes(current));
    duelCode = duelCode.replace(current, 'full-heal-then-one-recharge-turn-quarter-hp-curse-stacks-clears-on-switch-faint-end-forced-scorch-v41')
      .replace("    curse: 'selected-owned-individual-permanent-curse-no-adventure-writeback-v49',\n", '');
    linkCode = linkCode.replace(':owned-permanent-curse-v49', '');
  }
  vm.runInContext(duelCode, context);
  vm.runInContext(select('peer-to-peer casual duel protocol'), context);
  const { LT } = context, engine = new LT.Engine(); assert(engine.newGame('hibana').ok);
  LT.adminBridge = { getEngine: () => engine };
  vm.runInContext(linkCode, context);
  return { LT, engine, dispose() { for (const timer of timers) clearTimeout(timer); timers.clear(); } };
}

function stock(env, mode, requestedIds) {
  const ids = requestedIds || ['komori', 'shizuku', 'hibana', 'nullmie'].slice(0, env.LT.Duel.teamSize(mode));
  env.engine.state.party = []; env.engine.state.storage = [];
  for (const side of [0, 1]) for (const [index, species] of ids.entries()) {
    const mon = env.engine.makeMonster(species, 50); mon.uid = `curse-${side}-${species}`;
    mon.hp = 1; mon.status = 'scorch'; mon.curse = side === 0 ? index % 2 === 0 : index % 2 === 1;
    if (species === 'nullmie') mon.curse = true; // Invalid old state must not defeat void immunity.
    for (const id of Object.keys(mon.pp)) mon.pp[id] = 0;
    env.engine.state[side ? 'storage' : 'party'].push(mon); env.engine.markCaught(species);
  }
  return ids;
}

function pair(env, mode = 'single', remote = env) {
  const queue = [], packets = [], sessions = [env, remote].map((source, role) => new source.LT.DuelSession({ role, mode,
    send(message) { const wire = copy(message); queue.push({ from: role, message: wire }); packets.push({ from: role, message: copy(wire) }); return true; }
  }));
  sessions[0].seed = 49049;
  return { sessions, queue, packets,
    async flush() { let count = 0; while (queue.length) { assert(++count < 100, 'Protocol did not settle'); const { from, message } = queue.shift(); await sessions[1 - from].receive(message); } },
    async start() { sessions.forEach(session => session.start()); await this.flush(); },
    close() { sessions.forEach(session => session.close()); }
  };
}

function harmless(duel, side) {
  return duel.active(side).flatMap((mon, slot) => {
    if (mon.hp <= 0) return [];
    const move = duel.moves(mon).findIndex(move => ['guard', 'heal'].includes(move.kind)); assert(move >= 0);
    return [{ type: 'move', slot, move, target: 0 }];
  });
}
async function ready(p, idsBySide) {
  for (const side of [0, 1]) {
    const ids = idsBySide[side];
    const result = await p.sessions[side].setTeam({ name: `Side ${side}`, ids, uids: ids.map(id => `curse-${side}-${id}`), curses: ids.map(() => true) });
    assert(result.ok, result.error);
  }
  await p.flush(); assert(p.sessions.every(session => session.snapshot().phase === 'choosing'));
}
async function turn(p, orders) {
  const results = await Promise.all(p.sessions.map((session, side) => session.submit(orders[side])));
  for (const result of results) assert(result.ok, result.error);
  await p.flush(); assert.equal(p.sessions[0].duel.fingerprint(), p.sessions[1].duel.fingerprint());
}

async function main() {
  const env = runtime(), { LT, engine } = env, { Duel } = LT;
  try {
    const ids = ['komori', 'nullmie', 'shizuku'], config = { mode: 'single', teams: [ids, ids], seed: 1 };
    const sparse = [false, true, false]; delete sparse[1];
    const invalid = [null, {}, 'false', [], [true], [true, false, true, false], [true, 0, false], [true, 'false', false], [true, null, false], [true, undefined, false], sparse];
    assert(Duel.validateCurses(undefined, 3).ok); assert(Duel.validateCurses([false, true, false], 3).ok);
    for (const value of invalid) {
      assert.equal(Duel.validateCurses(value, 3).ok, false);
      assert.throws(() => Duel.create({ ...config, curses: [value, undefined] }), /呪縛/);
    }
    const outerHole = [undefined, undefined]; delete outerHole[0];
    for (const value of [null, {}, [], [undefined], [undefined, undefined, undefined], outerHole]) assert.throws(() => Duel.create({ ...config, curses: value }), /呪縛/);
    const clean = Duel.create(config), flags = [[true, true, false], undefined], cursed = Duel.create({ ...config, curses: flags });
    assert(clean.state.teams.every(team => team.monsters.every(mon => !mon.curse)));
    assert(cursed.state.teams[0].monsters[0].curse); assert(!cursed.state.teams[0].monsters[1].curse, 'Void immunity applies before the initial snapshot');
    assert.notEqual(cursed.fingerprint(), clean.fingerprint()); flags[0][0] = false; assert(cursed.state.teams[0].monsters[0].curse);

    for (const mode of ['single', 'double']) {
      const ids = stock(env, mode), before = JSON.stringify(engine.state), p = pair(env, mode); await p.start(); await ready(p, [ids, ids]);
      const duels = p.sessions.map(session => session.duel); assert.equal(duels[0].fingerprint(), duels[1].fingerprint());
      for (const side of [0, 1]) {
        const source = engine.state[side ? 'storage' : 'party'];
        const expected = source.map(mon => mon.curse === true && !LT.ConditionRules.isImmune(mon));
        assert.deepEqual(p.packets.find(packet => packet.from === side && packet.message.t === 'ready').message.team.curses, expected, 'UID chooses the individual; caller-supplied curses are ignored');
        for (const duel of duels) for (const [index, mon] of duel.state.teams[side].monsters.entries()) {
          assert.equal(mon.curse === true, expected[index]); assert.equal(mon.hp, mon.maxHp); assert.equal(mon.status, undefined);
          assert(duel.moves(mon).every(move => move.pp === move.maxPP), 'Existing fresh HP, PP and ordinary-status policy remains intact');
        }
      }
      await turn(p, [0, 1].map(side => harmless(duels[0], side)));
      for (const team of duels[0].state.teams) for (const [index, mon] of team.monsters.entries())
        assert.equal(mon.hp, mon.maxHp - (team.active.includes(index) && mon.curse ? Math.max(1, Math.floor(mon.maxHp / 4)) : 0), 'Only living active cursed members take damage');
      const outgoing = duels[0].state.teams.map(team => ({ hp: team.monsters[0].hp, curse: team.monsters[0].curse === true }));
      await turn(p, [0, 1].map(side => harmless(duels[0], side).map(order => order.slot === 0 ? { type: 'switch', slot: 0, index: 2 } : order)));
      for (const side of [0, 1]) {
        const mon = duels[0].state.teams[side].monsters[0]; assert.equal(mon.hp, outgoing[side].hp); assert.equal(mon.curse === true, outgoing[side].curse);
      }
      assert.equal(JSON.stringify(engine.state), before, 'Both peers leave the selected adventure individuals untouched'); p.close();
    }

    // A real committed null_curse applies to the chosen opponent in both peers,
    // persists through the result, and still cannot infect the adventure save.
    const castIds = stock(env, 'single', ['nullmie', 'komori', 'shizuku']);
    for (const mon of [...engine.state.party, ...engine.state.storage]) delete mon.curse;
    const beforeCast = JSON.stringify(engine.state), cast = pair(env); await cast.start();
    await ready(cast, [castIds, ['komori', 'nullmie', 'shizuku']]);
    const caster = cast.sessions[0].duel, move = caster.moves(caster.active(0)[0]).findIndex(move => move.id === 'null_curse');
    await turn(cast, [[{ type: 'move', slot: 0, move, target: 0 }], harmless(caster, 1)]);
    for (const session of cast.sessions) {
      const target = session.duel.active(1)[0]; assert(target.curse); assert.equal(target.hp, target.maxHp - Math.max(1, Math.floor(target.maxHp / 4)));
      session.duel._finish(0, 'knockout'); assert(target.curse, 'Finishing a duel does not cure its individual');
    }
    assert.equal(JSON.stringify(engine.state), beforeCast, 'New duel curse never writes into the adventure'); cast.close();

    // Optional omission is uncursed, while supplied metadata is strict on the
    // receiving side before any duel can be constructed.
    const base = { name: 'Check', ids: castIds }, check = pair(env); await check.start();
    assert(check.sessions[0]._validTeam(base)); assert(check.sessions[0]._validTeam({ ...base, curses: [false, true, false] }));
    for (const value of invalid) assert.equal(check.sessions[0]._validTeam({ ...base, curses: value }), false);
    assert.equal(check.sessions[0]._validTeam({ ...base, curses: [false, true, false], curse: true }), false); check.close();
    const missing = pair(env); await missing.start();
    for (const side of [0, 1]) assert((await missing.sessions[side].setTeam({ ids: castIds, uids: castIds.map(id => `curse-${side}-${id}`) })).ok);
    for (const packet of missing.queue) if (packet.message.t === 'ready') delete packet.message.team.curses;
    await missing.flush(); assert(missing.sessions.every(session => session.snapshot().phase === 'choosing'));
    for (const session of missing.sessions) assert(session.duel.state.teams.every(team => team.monsters.every(mon => !mon.curse)));
    assert.equal(missing.sessions[0].duel.fingerprint(), missing.sessions[1].duel.fingerprint()); missing.close();
    const bad = pair(env); await bad.start(); assert((await bad.sessions[0].setTeam({ ids: castIds })).ok);
    bad.queue.find(packet => packet.message.t === 'ready').message.team.curses[1] = 'false';
    await bad.flush(); assert.equal(bad.sessions[1].snapshot().phase, 'error'); assert.equal(bad.sessions[1].duel, null); bad.close();

    const previous = runtime({ previousRules: true });
    try {
      assert.notEqual(Duel.rulesFingerprint(), previous.LT.Duel.rulesFingerprint());
      const mixed = pair(env, 'single', previous); await mixed.start();
      assert(mixed.sessions.every(session => session.snapshot().phase === 'error')); assert(mixed.sessions.every(session => session.duel === null)); mixed.close();
    } finally { previous.dispose(); }
    console.log('Online permanent curse checks passed: strict optional boolean metadata, UID-specific party/reserve selection, void immunity, single/double commit-reveal synchronization and switching, fresh ordinary conditions, new-curse save isolation, malformed packets and v48 handshake rejection.');
  } finally { env.dispose(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
