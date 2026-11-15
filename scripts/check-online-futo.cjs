#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(m => m[2]);
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
  for (const marker of ['original world and game data', 'Original creature atlas and optional journeys', 'the Meridian Accord, an original 256-species atlas']) vm.runInContext(select(marker), context);
  // game_data's special species registration is in the engine script.
  vm.runInContext(select('deterministic combat, interiors, league and versioned saves'), context);
  assert(context.LT.DATA.species.futo, 'Futo production species must exist');
  for (const marker of ['deterministic, save-independent rental-team duels', 'peer-to-peer casual duel protocol']) vm.runInContext(select(marker), context);
  const LT = context.LT;
  const normal = Object.keys(LT.DATA.species).filter(id => !LT.DATA.species[id].specialOnly);
  const custom = { hp: 1300, atk: 220, def: 190, spAtk: 410, spDef: 305, speed: 276, accuracy: 130, evasion: 115 };
  const moves = LT.DATA.species.futo.moves.slice();
  const state = { party: [{ species: 'futo', level: 88, grantId: 'gift-test-001' }], storage: [] };
  let issueCount = 0, verifyCount = 0, failure = '', expiry = 600000;
  const passes = new Map();
  LT.adminBridge = { getEngine: () => ({ state }) };
  LT.Admin = {
    async requestDuelPass(sessionId, grantId, side) {
      issueCount++;
      if (failure) throw Error(failure);
      const pass = `pass-${side}-${sessionId}-${String(issueCount).padStart(16, '0')}`;
      passes.set(pass, { ok: true, grantId, species: 'futo', level: 88, stats: custom, moves, sessionId, side, expiresAt: Date.now() + expiry });
      return { ok: true, pass };
    },
    async verifyDuelPass(sessionId, pass, side) {
      verifyCount++;
      const result = passes.get(pass);
      if (!result || result.sessionId !== sessionId || result.side !== side) throw Error('invalid pass');
      return JSON.parse(JSON.stringify(result));
    },
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'online-futo.js'), 'utf8'), context);
  function pair() {
    const queue = [];
    const sessions = [0, 1].map(role => new LT.DuelSession({ role, mode: 'single', send: message => { queue.push({ from: role, message }); return true; } }));
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
  return { LT, normal, custom, moves, state, passes, pair, get counts() { return { issueCount, verifyCount }; },
    setFailure(value) { failure = value; }, setExpiry(value) { expiry = value; },
    dispose() { for (const timer of timers) clearTimeout(timer); } };
}
(async () => {
  const env = setup(), { LT, normal, custom, moves, state } = env;
  try {
    assert(!LT.Duel.validateTeam(['futo', ...normal.slice(0, 2)], 'single').ok, 'Unverified direct Duel must remain denied');
    assert(LT.OnlineFuto.rosterIds(normal).includes('futo'));
    const savedState = JSON.stringify(state);
    const rentals = env.pair(); await rentals.start();
    assert((await rentals.sessions[0].setTeam({ name: 'A', ids: normal.slice(0, 3) })).ok);
    assert((await rentals.sessions[1].setTeam({ name: 'B', ids: normal.slice(3, 6) })).ok);
    await rentals.flush();
    assert(rentals.sessions.every(s => s.snapshot().phase === 'choosing'));
    assert.equal(env.counts.issueCount, 0, 'Ordinary rentals must not call Futo service');
    assert.equal(env.counts.verifyCount, 0);
    assert(rentals.sessions[0].duel.state.teams.every(t => t.monsters.every(m => m.level === 50)));
    rentals.close();

    const pair = env.pair(); await pair.start();
    assert((await pair.sessions[0].setTeam({ name: '運営', ids: ['futo', ...normal.slice(0, 2)] })).ok);
    assert((await pair.sessions[1].setTeam({ name: '一般', ids: normal.slice(2, 5) })).ok);
    await pair.flush();
    assert(pair.sessions.every(s => s.snapshot().phase === 'choosing'));
    const duel = pair.sessions[0].duel, mon = duel.state.teams[0].monsters[0];
    assert.equal(mon.species, 'futo'); assert.equal(mon.level, 88);
    assert.deepEqual(JSON.parse(JSON.stringify(mon.stats)), custom);
    assert.deepEqual(JSON.parse(JSON.stringify(duel.moves(mon).map(m => m.id))), JSON.parse(JSON.stringify(moves)));
    assert.equal(mon.hp, custom.hp); assert.equal(mon.maxHp, custom.hp);
    assert.equal(pair.sessions[0].duel.fingerprint(), pair.sessions[1].duel.fingerprint());
    const commands = pair.sessions.map(s => s.duel.legalOrders(s.role));
    await Promise.all(pair.sessions.map((s, side) => s.submit(commands[side])));
    await pair.flush();
    assert.equal(pair.sessions[0].duel.fingerprint(), pair.sessions[1].duel.fingerprint());
    assert.equal(JSON.stringify(state), savedState, 'Online play modified adventure ownership/save');
    pair.close();

    state.party = [];
    assert(!LT.OnlineFuto.rosterIds(normal).includes('futo'));
    const unauth = env.pair(); await unauth.start();
    assert(!(await unauth.sessions[0].setTeam({ name: 'No grant', ids: ['futo', ...normal.slice(0, 2)] })).ok);
    unauth.close(); state.party = JSON.parse(savedState).party;

    const spoof = env.pair(); await spoof.start();
    await spoof.sessions[1].receive({ v: 1, t: 'ready', session: spoof.sessions[1].sessionId,
      team: { name: 'Forged', ids: ['futo', ...normal.slice(0, 2)], futo: { pass: 'forged-'.repeat(12) } } });
    assert.equal(spoof.sessions[1].snapshot().phase, 'error'); spoof.close();

    const reflected = env.pair(); await reflected.start();
    const issued = await LT.Admin.requestDuelPass(reflected.sessions[0].sessionId, 'gift-test-001', 0);
    await reflected.sessions[0].receive({ v: 1, t: 'ready', session: reflected.sessions[0].sessionId,
      team: { name: 'Reflected', ids: ['futo', ...normal.slice(0, 2)], futo: { pass: issued.pass } } });
    assert.equal(reflected.sessions[0].snapshot().phase, 'error'); reflected.close();

    env.setExpiry(-1);
    const expired = env.pair(); await expired.start();
    assert(!(await expired.sessions[0].setTeam({ name: 'Expired', ids: ['futo', ...normal.slice(0, 2)] })).ok);
    assert.equal(expired.sessions[0].duel, null); expired.close();
    env.setExpiry(600000);

    const validSnapshot = { ok: true, grantId: 'abc', species: 'futo', level: 88, stats: custom, moves, sessionId: 's', side: 0, expiresAt: Date.now() + 60000 };
    assert.throws(() => LT.OnlineFuto.validateSnapshot({ ...validSnapshot, stats: { ...custom, hp: Infinity } }, 's', 0));
    assert.throws(() => LT.OnlineFuto.validateSnapshot({ ...validSnapshot, moves: ['missing', ...moves.slice(1)] }, 's', 0));
    assert.throws(() => LT.OnlineFuto.validateSnapshot({ ...validSnapshot, level: 101 }, 's', 0));
    console.log(JSON.stringify({ ok: true, scenarios: ['normal rentals unchanged', 'verified Futo level/stats/moves', 'identical deterministic turn', 'no save mutation', 'unowned denied', 'forged denied', 'side reflection denied', 'expired denied', 'invalid snapshot denied'], counts: env.counts }, null, 2));
  } finally { env.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
