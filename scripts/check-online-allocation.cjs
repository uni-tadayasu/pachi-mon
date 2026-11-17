#!/usr/bin/env node
'use strict';
/* Online battles carry each member's allocation points (the same owned
 * individual as its nickname/shiny look), limited to what a Lv.50 monster can
 * hold. Both peers validate and apply them identically; Futo keeps its stats. */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(m => m[2]);
const select = marker => { const code = scripts.find(text => text.includes(marker)); assert(code, `Missing production script: ${marker}`); return code; };
const timers = new Set();
const context = vm.createContext({ console, crypto: webcrypto, TextEncoder, Uint8Array, Uint32Array,
  setTimeout(fn, ms) { const id = setTimeout(fn, ms); id.unref(); timers.add(id); return id; },
  clearTimeout(id) { timers.delete(id); clearTimeout(id); } });
for (const marker of ['original world and game data', 'Original creature atlas and optional journeys', 'the Meridian Accord, an original 256-species atlas', 'two-stage starter lineages, retaining every existing species ID', 'Arvelion, the original roaming legendary', 'owner-only leaf mythical, outside all ordinary acquisition pools', 'deterministic combat, interiors, league and versioned saves', 'deterministic, save-independent rental-team duels', 'peer-to-peer casual duel protocol']) vm.runInContext(select(marker), context);
const { LT } = context, D = LT.DATA, { Duel } = LT;
const copy = value => JSON.parse(JSON.stringify(value));
const KEYS = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];
const full = partial => Object.fromEntries(KEYS.map(key => [key, partial[key] || 0]));

// ── Rules: the Lv.50 limits, folded into the rules fingerprint.
const A = Duel.rules.allocation;
assert.equal(A.budget, D.allocation.pointsPerLevel * 49); assert.equal(A.budget, 98); assert.equal(A.cap, 64); assert.equal(A.hpPerPoint, 2);

// ── Scaling: unchanged within the budget, proportional above it, never above a stat's own points.
assert.equal(Duel.scaleAllocation(undefined), null); assert.equal(Duel.scaleAllocation({}), null); assert.equal(Duel.scaleAllocation({ atk: 0 }), null);
assert.deepEqual(copy(Duel.scaleAllocation({ atk: 10, speed: 5 })), full({ atk: 10, speed: 5 }));
assert.deepEqual(copy(Duel.scaleAllocation({ hp: 40, atk: 58 })), full({ hp: 40, atk: 58 }), 'exactly 98 is kept');
const big = { atk: 64, speed: 64, hp: 40, def: 30 }, scaled = Duel.scaleAllocation(big);
assert.equal(KEYS.reduce((sum, key) => sum + scaled[key], 0), 98, 'scaled to the full budget');
for (const key of KEYS) { assert(scaled[key] <= (big[key] || 0)); assert(Math.abs(scaled[key] - (big[key] || 0) * 98 / 198) < 1, `${key} keeps its share`); }
assert.deepEqual(copy(Duel.scaleAllocation({ atk: 999, speed: -5, luck: 50, def: 1.5 })), full({ atk: 64 }), 'junk is clamped or ignored');
for (let seed = 1; seed < 400; seed++) { // Random spreads always land within the limits.
  const alloc = Object.fromEntries(KEYS.map((key, i) => [key, (seed * (i + 3) * 7919) % 65]));
  const result = Duel.scaleAllocation(alloc), used = KEYS.reduce((sum, key) => sum + alloc[key], 0);
  if (!used) { assert.equal(result, null); continue; }
  assert(Duel.validateAllocation(result).ok, `seed ${seed}`); assert.equal(KEYS.reduce((sum, key) => sum + result[key], 0), Math.min(98, used));
}

// ── Validation: canonical, whole numbers, per-stat cap, total budget.
assert(Duel.validateAllocation(null).ok); assert(Duel.validateAllocation(full({ hp: 64, atk: 34 })).ok);
for (const bad of [full({ hp: 65 }), full({ hp: 64, atk: 35 }), { hp: 1 }, { ...full({ hp: 1 }), luck: 1 }, full({ atk: 1.5 }), full({ atk: -1 }), full({}), [], 'x'])
  assert.equal(Duel.validateAllocation(bad).ok, false, JSON.stringify(bad));

// ── Engine: stats match the adventure formula at Lv.50 exactly; plain rentals are unchanged.
const teams = [['komori', 'fuwari', 'kirari'], ['hibana', 'komori', 'fuwari']];
const spread = full({ hp: 20, atk: 32, def: 15, speed: 31 });
const duel = Duel.create({ mode: 'single', teams, seed: 7, allocation: [[spread, null, null], null] });
const plain = Duel.create({ mode: 'single', teams, seed: 7 });
const adventure = new LT.Engine().stats({ species: 'komori', level: 50, alloc: spread });
assert.deepEqual(copy(duel.state.teams[0].monsters[0].stats), copy(adventure), 'online stats = adventure stats at Lv.50');
assert.equal(duel.state.teams[0].monsters[0].hp, adventure.hp); assert.deepEqual(copy(duel.state.teams[0].monsters[0].alloc), spread);
assert.deepEqual(copy(duel.state.teams[0].monsters[1]), copy(plain.state.teams[0].monsters[1]), 'members without points are plain rentals');
assert.deepEqual(copy(duel.state.teams[1]), copy(plain.state.teams[1]));
assert.throws(() => Duel.create({ mode: 'single', teams, seed: 7, allocation: [[spread], null] }), /振り分け/);
assert.throws(() => Duel.create({ mode: 'single', teams, seed: 7, allocation: [[full({ atk: 99 }), null, null], null] }), /振り分け/);

// ── Sessions: each side sends its own points; both peers build the identical duel.
const state = { party: [], storage: [] };
const trained = { species: 'komori', level: 100, uid: 'p-1', nickname: 'もりの', shiny: true, alloc: big };
state.party.push(trained, { species: 'fuwari', level: 30, uid: 'p-2', alloc: { spAtk: 20, spDef: 10 } }, { species: 'kirari', level: 60, uid: 'p-3' });
state.storage.push({ species: 'komori', level: 5, uid: 's-1', alloc: { def: 8 } }, { species: 'futo', level: 70, uid: 's-2', grantId: 'gift-1', alloc: { atk: 30 } });
LT.adminBridge = { getEngine: () => ({ state }) };
LT.Admin = { async requestDuelPass() { throw Error('not used'); }, async verifyDuelPass() { throw Error('not used'); } };
vm.runInContext(fs.readFileSync(path.join(root, 'online-futo.js'), 'utf8'), context);
const { allocationFor } = LT.OnlineFuto;
assert.deepEqual(copy(allocationFor(['komori', 'fuwari', 'kirari', 'hibana', 'futo'])), [copy(scaled), full({ spAtk: 20, spDef: 10 }), null, null, null],
  'party first (the same individual as the look), unowned and Futo carry nothing');
assert.match(Duel.rulesFingerprint(), /allocation/, 'peers on the old rules are turned away');

async function pair(mode = 'single') {
  const queue = [], packets = [];
  const sessions = [0, 1].map(role => new LT.DuelSession({ role, mode, send: message => { queue.push({ from: role, message }); packets.push({ from: role, message: copy(message) }); return true; } }));
  const flush = async () => { let count = 0; while (queue.length) { assert(++count < 100); const { from, message } = queue.shift(); await sessions[1 - from].receive(message); } };
  sessions.forEach(session => session.start()); await flush();
  return { sessions, flush, packets };
}
(async () => {
  const p = await pair();
  assert((await p.sessions[0].setTeam({ name: 'Trained', ids: ['komori', 'fuwari', 'kirari'] })).ok);
  state.party.length = 0; state.storage.length = 0; // The opponent owns nothing: plain rentals.
  assert((await p.sessions[1].setTeam({ name: 'Rental', ids: ['hibana', 'komori', 'fuwari'] })).ok);
  await p.flush();
  const ready = p.packets.filter(x => x.message.t === 'ready');
  assert.deepEqual(ready.find(x => x.from === 0).message.team.allocation, [copy(scaled), full({ spAtk: 20, spDef: 10 }), null]);
  assert.deepEqual(ready.find(x => x.from === 1).message.team.allocation, [null, null, null]);
  const [a, b] = p.sessions.map(session => session.duel);
  assert(a && b, 'both peers started the duel'); assert.equal(a.fingerprint(), b.fingerprint(), 'identical duel on both peers');
  const lead = a.state.teams[0].monsters[0];
  assert.deepEqual(copy(lead.stats), copy(new LT.Engine().stats({ species: 'komori', level: 50, alloc: scaled })));
  assert.equal(lead.nickname, 'もりの'); assert.equal(lead.shiny, true, 'look and points come from the same individual');
  assert.equal(a.state.teams[1].monsters[1].alloc, undefined, "the opponent's komori is a plain rental");

  // Forged or malformed points are refused before any duel starts.
  const s = p.sessions[0], base = { name: 'X', ids: ['komori', 'fuwari', 'kirari'], appearance: [0, 1, 2].map(() => ({ nickname: '', shiny: false })) };
  assert(s._validTeam({ ...base, allocation: [null, null, null] })); assert(s._validTeam({ ...base }), 'a team without points is a plain rental team');
  for (const allocation of [[full({ atk: 99 }), null, null], [full({ hp: 64, atk: 35 }), null, null], [{ atk: 5 }, null, null], [null, null], [full({}), null, null], 'x'])
    assert.equal(s._validTeam({ ...base, allocation }), false, JSON.stringify(allocation));
  assert.equal(s._validTeam({ ...base, ids: ['futo', 'fuwari', 'kirari'], futo: { pass: 'p'.repeat(32) }, allocation: [full({ atk: 5 }), null, null] }), false, 'Futo cannot carry points');
  p.sessions.forEach(session => session.close());
  for (const id of timers) clearTimeout(id);
  console.log(JSON.stringify({ ok: true, budget: A.budget, checks: ['Lv.50 limits in the rules', 'proportional scaling', 'canonical validation', 'adventure stat parity', 'per-member points in the ready packet', 'identical duel on both peers', 'look and points from one individual', 'forged points refused', 'Futo excluded'] }));
})().catch(error => { console.error(error); process.exit(1); });
