#!/usr/bin/env node
'use strict';
/* Online battles carry each member's allocation points (the same owned
 * individual as its nickname/shiny look) in full, while base stats use Lv.50.
 * Both peers validate and apply them identically; Futo keeps its fixed spread. */
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
const full = partial => Object.fromEntries(KEYS.map(key => [key, partial[key] ?? 0]));

// ── Rules: the level is fixed, but points keep the adventure's per-stat limits.
const A = Duel.rules.allocation;
assert.equal(Duel.rules.level, 50); assert.equal(A.budget, D.allocation.capPerStat * KEYS.length); assert.equal(A.cap, 64); assert.equal(A.hpPerPoint, 2);
assert.match(A.source, /full-allocation/);

// ── All assigned points survive, including Lv.100 and training-item bonus points.
assert.equal(Duel.scaleAllocation(undefined), null); assert.equal(Duel.scaleAllocation({}), null); assert.equal(Duel.scaleAllocation({ atk: 0 }), null);
assert.deepEqual(copy(Duel.scaleAllocation({ atk: 10, speed: 5 })), full({ atk: 10, speed: 5 }));
assert.deepEqual(copy(Duel.scaleAllocation({ hp: 40, atk: 58 })), full({ hp: 40, atk: 58 }), 'exactly 98 is kept');
const big = { atk: 64, speed: 64, hp: 40, def: 30 }, carried = Duel.normalizeAllocation(big);
const trainedBonus = full({ hp: 64, atk: 64, def: 64, spAtk: 41, speed: 64 });
assert.deepEqual(copy(carried), full(big), 'all 198 points are kept; the old 98-point ceiling is gone');
assert.deepEqual(copy(Duel.normalizeAllocation(trainedBonus)), trainedBonus, 'all 297 training points are kept');
assert.deepEqual(copy(Duel.scaleAllocation(big)), copy(carried), 'legacy helper also preserves all points');
assert.deepEqual(copy(Duel.scaleAllocation({ atk: 999, speed: -5, luck: 50, def: 1.5 })), full({ atk: 64 }), 'junk is clamped or ignored');
for (let seed = 1; seed < 400; seed++) {
  const alloc = Object.fromEntries(KEYS.map((key, i) => [key, (seed * (i + 3) * 7919) % 65]));
  const result = Duel.scaleAllocation(alloc), used = KEYS.reduce((sum, key) => sum + alloc[key], 0);
  if (!used) { assert.equal(result, null); continue; }
  assert(Duel.validateAllocation(result).ok, `seed ${seed}`); assert.deepEqual(copy(result), alloc, `seed ${seed} keeps every point`);
}

// ── Validation: canonical, whole numbers, per-stat cap, total budget.
assert(Duel.validateAllocation(null).ok); assert(Duel.validateAllocation(full({ hp: 64, atk: 35 })).ok); assert(Duel.validateAllocation(trainedBonus).ok);
assert(Duel.validateAllocation(full(Object.fromEntries(KEYS.map(key => [key, 64])))).ok, 'the same per-stat maximum as supported adventure saves');
for (const bad of [full({ hp: 65 }), { hp: 1 }, { ...full({ hp: 1 }), luck: 1 }, full({ atk: 1.5 }), full({ atk: -1 }), full({ atk: NaN }), full({ atk: Infinity }), full({}), [], 'x'])
  assert.equal(Duel.validateAllocation(bad).ok, false, JSON.stringify(bad));

// ── Engine: stats match the adventure formula at Lv.50 exactly; plain rentals are unchanged.
const teams = [['komori', 'fuwari', 'kirari'], ['hibana', 'komori', 'fuwari']];
const spread = full(big);
const duel = Duel.create({ mode: 'single', teams, seed: 7, allocation: [[spread, null, null], null] });
const plain = Duel.create({ mode: 'single', teams, seed: 7 });
const adventure = new LT.Engine().stats({ species: 'komori', level: 50, alloc: spread });
assert.deepEqual(copy(duel.state.teams[0].monsters[0].stats), copy(adventure), 'online stats = adventure stats at Lv.50');
assert.equal(duel.state.teams[0].monsters[0].hp, adventure.hp); assert.deepEqual(copy(duel.state.teams[0].monsters[0].alloc), spread);
assert.equal(duel.state.teams[0].monsters[0].stats.hp, D.species.komori.base.hp + 250 + 80, 'HP gains 2 per assigned point');
assert.equal(duel.state.teams[0].monsters[0].stats.atk, D.species.komori.base.atk + 150 + 64, 'Lv.50 base attack plus all 64 assigned points');
assert.deepEqual(copy(duel.state.teams[0].monsters[1]), copy(plain.state.teams[0].monsters[1]), 'members without points are plain rentals');
assert.deepEqual(copy(duel.state.teams[1]), copy(plain.state.teams[1]));
assert.throws(() => Duel.create({ mode: 'single', teams, seed: 7, allocation: [[spread], null] }), /振り分け/);
assert.throws(() => Duel.create({ mode: 'single', teams, seed: 7, allocation: [[full({ atk: 99 }), null, null], null] }), /振り分け/);

// ── Sessions: each side sends its own points; both peers build the identical duel.
const state = { party: [], storage: [] };
const trained = { species: 'komori', level: 100, uid: 'p-1', nickname: 'もりの', shiny: true, alloc: big };
state.party.push(trained, { species: 'fuwari', level: 30, uid: 'p-2', alloc: { spAtk: 20, spDef: 10 } }, { species: 'kirari', level: 60, uid: 'p-3' });
state.storage.push({ species: 'komori', level: 5, uid: 's-1', alloc: { def: 8 } }, { species: 'futo', level: 70, uid: 's-2', grantId: 'gift-1', customStats: { hp: 900, atk: 200, def: 150, spAtk: 220, spDef: 150, speed: 160, accuracy: 110, evasion: 100 } });
LT.adminBridge = { getEngine: () => ({ state }) };
vm.runInContext(fs.readFileSync(path.join(root, 'online-futo.js'), 'utf8'), context);
const { allocationFor } = LT.OnlineFuto;
assert.deepEqual(copy(allocationFor(['komori', 'fuwari', 'kirari', 'hibana', 'futo'])), [copy(carried), full({ spAtk: 20, spDef: 10 }), null, null, copy(LT.OnlineFuto.linkAllocation)],
  'party first (the same individual as the look), unowned carry nothing, Futo keeps its fixed even allocation');
assert.equal(Object.values(LT.OnlineFuto.linkAllocation).reduce((a, b) => a + b, 0), 98); assert(Duel.validateAllocation(copy(LT.OnlineFuto.linkAllocation)).ok);
assert.match(Duel.rulesFingerprint(), /v8.*full-allocation/, 'the new allocation rules have a distinct fingerprint');

async function pair(mode = 'single') {
  const queue = [], packets = [];
  const sessions = [0, 1].map(role => new LT.DuelSession({ role, mode, send: message => { queue.push({ from: role, message }); packets.push({ from: role, message: copy(message) }); return true; } }));
  const flush = async () => { let count = 0; while (queue.length) { assert(++count < 100); const { from, message } = queue.shift(); await sessions[1 - from].receive(message); } };
  sessions.forEach(session => session.start()); await flush();
  return { sessions, flush, packets };
}
(async () => {
  const p = await pair();
  const beforeTeam = JSON.stringify(state);
  assert((await p.sessions[0].setTeam({ name: 'Trained', ids: ['komori', 'fuwari', 'kirari'] })).ok);
  assert.equal(JSON.stringify(state), beforeTeam, 'choosing a team does not alter adventure points or levels');
  state.party.length = 0; state.storage.length = 0; // The opponent owns nothing: plain rentals.
  assert((await p.sessions[1].setTeam({ name: 'Rental', ids: ['hibana', 'komori', 'fuwari'] })).ok);
  await p.flush();
  const ready = p.packets.filter(x => x.message.t === 'ready');
  assert.deepEqual(ready.find(x => x.from === 0).message.team.allocation, [copy(carried), full({ spAtk: 20, spDef: 10 }), null]);
  assert.deepEqual(ready.find(x => x.from === 1).message.team.allocation, [null, null, null]);
  const [a, b] = p.sessions.map(session => session.duel);
  assert(a && b, 'both peers started the duel'); assert.equal(a.fingerprint(), b.fingerprint(), 'identical duel on both peers');
  const lead = a.state.teams[0].monsters[0];
  assert.deepEqual(copy(lead.stats), copy(new LT.Engine().stats({ species: 'komori', level: 50, alloc: carried })));
  assert.equal(lead.nickname, 'もりの'); assert.equal(lead.shiny, true, 'look and points come from the same individual');
  assert.equal(a.state.teams[1].monsters[1].alloc, undefined, "the opponent's komori is a plain rental");

  // Forged or malformed points are refused before any duel starts.
  const s = p.sessions[0], base = { name: 'X', ids: ['komori', 'fuwari', 'kirari'], appearance: [0, 1, 2].map(() => ({ nickname: '', shiny: false })) };
  assert(s._validTeam({ ...base, allocation: [null, null, null] })); assert(s._validTeam({ ...base }), 'a team without points is a plain rental team');
  assert(s._validTeam({ ...base, allocation: [trainedBonus, null, null] }), 'full training allocation is accepted by both peers');
  for (const allocation of [[full({ atk: 99 }), null, null], [{ atk: 5 }, null, null], [null, null], [full({}), null, null], 'x'])
    assert.equal(s._validTeam({ ...base, allocation }), false, JSON.stringify(allocation));
  assert.equal(s._validTeam({ ...base, ids: ['futo', 'fuwari', 'kirari'], futo: { pass: 'p'.repeat(32) }, allocation: [full({ atk: 5 }), null, null] }), false, 'unexpected legacy pass data is rejected');
  p.sessions.forEach(session => session.close());

  // Explicit individuals, ordinary/evolved/special species, full training points,
  // doubles commands and the resulting synchronization all use the same points.
  state.party.push(trained,
    { uid: 'evolved', species: 'shizunaria', level: 100, alloc: big },
    { uid: 'legendary', species: 'arvelion', level: 100, alloc: big },
    { uid: 'mythical', species: 'floravelle', level: 100, alloc: trainedBonus, bonusPoints: 99, grantId: 'admin-mythical:owner-1' });
  state.storage.push({ uid: 'komori-bonus', species: 'komori', level: 100, alloc: trainedBonus, bonusPoints: 99, nickname: 'きたえた' });
  const doubles = await pair('double'), ids = ['komori', 'shizunaria', 'arvelion', 'floravelle'];
  const saved = JSON.stringify(state);
  assert((await doubles.sessions[0].setTeam({ ids, uids: ['p-1', 'evolved', 'legendary', 'mythical'] })).ok);
  assert((await doubles.sessions[1].setTeam({ ids, uids: ['komori-bonus', 'evolved', 'legendary', 'mythical'] })).ok);
  await doubles.flush();
  const [da, db] = doubles.sessions.map(session => session.duel);
  assert(da && db); assert.equal(da.fingerprint(), db.fingerprint());
  for (const [side, team] of da.state.teams.entries()) for (const [index, mon] of team.monsters.entries()) {
    const expected = index === 3 || (side === 1 && index === 0) ? trainedBonus : full(big);
    assert.equal(mon.level, 50); assert.deepEqual(copy(mon.alloc), expected);
    assert.deepEqual(copy(mon.stats), copy(new LT.Engine().stats({ species: ids[index], level: 50, alloc: expected })));
  }
  assert.equal(da.state.teams[1].monsters[0].nickname, 'きたえた', 'chosen UID supplies both appearance and points');
  for (const session of doubles.sessions) assert((await session.submit([{ type: 'move', slot: 0, move: 0, target: 0 }, { type: 'move', slot: 1, move: 0, target: 1 }])).ok);
  await doubles.flush(); assert.equal(da.fingerprint(), db.fingerprint(), 'peers remain identical after a full turn');
  assert.equal(JSON.stringify(state), saved, 'adventure points, level, HP and bonus points remain unchanged');
  doubles.sessions.forEach(session => session.close());

  // A peer still using the released 98-point rules must update before battling.
  const mismatchQueue = [], oldRules = '3b063b4bc3f8015d:link-teams-v7-special-three-standard-allocation-owned-items';
  const mismatch = [0, 1].map(role => new LT.DuelSession({ role, mode: 'single', send: message => {
    const wire = copy(message); if (role === 1 && wire.t === 'hello') wire.rules = oldRules;
    mismatchQueue.push({ from: role, message: wire }); return true;
  } }));
  mismatch.forEach(session => session.start());
  while (mismatchQueue.length) { const { from, message } = mismatchQueue.shift(); await mismatch[1 - from].receive(message); }
  assert(mismatch.every(session => !session.duel && !session.snapshot().connected));
  assert.equal(mismatch[0].snapshot().phase, 'error');
  assert.match(mismatch[0].snapshot().message, /バージョンが一致しません/);
  mismatch.forEach(session => session.close());
  for (const id of timers) clearTimeout(id);
  console.log(JSON.stringify({ ok: true, level: Duel.rules.level, perStatCap: A.cap, checks: ['198-point allocations preserved', '297-point training allocations preserved', 'canonical validation', 'Lv.50 base plus full allocation', 'per-member points in ready packets', 'single/double peers stay synchronized', 'selected UID carries its own points', 'evolved/legendary/mythical allocations', 'adventure unchanged', 'Futo fixed 98-point spread', 'old 98-point rules rejected'] }));
})().catch(error => { console.error(error); process.exit(1); });
