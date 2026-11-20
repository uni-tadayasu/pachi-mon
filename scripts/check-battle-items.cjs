#!/usr/bin/env node
'use strict';
/* Player battles (online and local) with the adventure's held items and
 * conditions, teams chosen from the player's own monsters, and a steady
 * playback rhythm: every battle item works as in the adventure on the duel's
 * seeded random numbers; an item is at most once per team; both peers build
 * the same duel; members and items must be the player's own; and each battle
 * message gets its own beat. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(m => m[2]);
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
const { LT } = context, D = LT.DATA, { Duel } = LT;
const copy = value => JSON.parse(JSON.stringify(value));
assert.equal(Object.keys(D.heldItems).length, 48); assert(D.statuses.bloom && D.statusByElement.leaf === 'bloom');

// ── Rules: version, fingerprint, item lists.
assert.equal(Duel.rules.version, 11); assert.match(Duel.rules.items, /once-per-team/); assert.match(Duel.rules.conditions, /shown-every-turn/); assert.match(Duel.rules.special, /standard-lv50/);
assert(Duel.validateItems(null, 3).ok && Duel.validateItems([null, null, null], 3).ok && Duel.validateItems(['leafcrown', null, 'healberry'], 3).ok);
assert.match(Duel.validateItems(['healberry', 'healberry', null], 3).error, /同じ持ち物/, 'the same item twice in a team is refused');
for (const bad of [['nope', null, null], ['leafcrown', null], 'x', [1, null, null]]) assert.equal(Duel.validateItems(bad, 3).ok, false, JSON.stringify(bad));
const BATTLE = Object.keys(D.heldItems).filter(id => Duel.battleItem(id)), INERT = Object.keys(D.heldItems).filter(id => !Duel.battleItem(id));
assert.equal(BATTLE.length, 43); assert.deepEqual(INERT.sort(), ['calmbell', 'everpebble', 'learnsash', 'luckycoin', 'trainband'], 'only experience, coins, encounters, evolution and training items stay idle');
assert.throws(() => Duel.create({ mode: 'single', teams: [['komori', 'fuwari', 'kirari'], ['hibana', 'shizuku', 'fuwari']], seed: 1, items: [['healberry', 'healberry', null], null] }), /同じ持ち物/);
const withItems = Duel.create({ mode: 'single', teams: [['komori', 'fuwari', 'kirari'], ['hibana', 'shizuku', 'fuwari']], seed: 1, items: [['leafcrown', null, 'healberry'], null] });
assert.deepEqual(copy(withItems.state.teams[0].monsters.map(m => m.item ?? null)), ['leafcrown', null, 'healberry']); assert(withItems.state.teams[1].monsters.every(m => m.item === undefined));

// ── One hit at a time, on chosen random numbers.
const POOL = ['komori', 'fuwari', 'kirari', 'shizuku', 'hibana'];
const teamWith = lead => [lead, ...POOL.filter(id => id !== lead).slice(0, 2)];
function setup({ a = 'komori', b = 'shizuku', itemA = null, itemB = null } = {}) {
  const d = Duel.create({ mode: 'single', teams: [teamWith(a), teamWith(b)], seed: 9 });
  if (itemA) d.active(0)[0].item = itemA; if (itemB) d.active(1)[0].item = itemB;
  return d;
}
function rig(d, values) { const queue = [...values]; d._random = () => queue.length ? queue.shift() : .5; }
const moveOf = (d, side, test) => { const i = d.moves(d.active(side)[0]).findIndex(test); assert(i >= 0, 'move needed for the check'); return i; };
const attackOf = (d, side, element) => moveOf(d, side, m => m.kind === 'attack' && (element === undefined || m.element === element) && (m.effect || '') !== 'recoil' && (m.effect || '') !== 'drain');
function act(d, side, index, extra = {}) { const mon = d.active(side)[0]; d._apply({ type: 'move', side, slot: 0, actor: d.state.teams[side].active[0], technique: d.moves(mon)[index], target: 0, ...extra }, mon); return d.state.events; }
const NO_STATUS = [0, .5, .5, .99]; // hit, no critical, middle variance, no condition
function dealt(options, rolls = NO_STATUS, element) {
  const d = setup(options), before = d.active(1)[0].hp; rig(d, rolls); act(d, 0, attackOf(d, 0, element)); return { d, amount: before - d.active(1)[0].hp };
}
const ratio = (a, b) => a / b;
const leaf = D.species.komori.element;
// Type boost ×1.2 on its own element only; shield ×0.75 against its element; orb ×1.25 with recoil.
assert(Math.abs(ratio(dealt({ itemA: 'leafcrown' }, NO_STATUS, leaf).amount, dealt({}, NO_STATUS, leaf).amount) - 1.2) < .06, 'boost item');
assert.equal(dealt({ itemA: 'tideshell' }, NO_STATUS, leaf).amount, dealt({}, NO_STATUS, leaf).amount, 'a boost for another element does nothing');
assert(Math.abs(ratio(dealt({ itemB: `${leaf}veil` }, NO_STATUS, leaf).amount, dealt({}, NO_STATUS, leaf).amount) - .75) < .06, 'shield item');
let r = dealt({ itemA: 'lifeorb' }, NO_STATUS, leaf);
assert(Math.abs(ratio(r.amount, dealt({}, NO_STATUS, leaf).amount) - 1.25) < .06, 'orb power');
assert.equal(r.d.active(0)[0].maxHp - r.d.active(0)[0].hp, Math.floor(r.d.active(0)[0].maxHp / 10), 'orb recoil'); assert(r.d.state.events.some(e => e.kind === 'recoil' && e.item === 'lifeorb'));
// Stat ×1.1; critical chance 15% with the shard.
const strong = setup({ itemA: 'powerband' }); assert.equal(strong.effectiveStats(strong.active(0)[0]).atk, Math.floor(strong.active(0)[0].stats.atk * 1.1));
assert.equal(dealt({ itemA: 'keenshard' }, [0, .1, .5, .99], leaf).d.state.events.find(e => e.kind === 'damage').critical, true);
assert.equal(dealt({}, [0, .1, .5, .99], leaf).d.state.events.find(e => e.kind === 'damage').critical, false);
// Endurance at full health, consumed.
let d = setup({ itemB: 'endureband' }); d.active(1)[0].hp = d.active(1)[0].maxHp = 5; rig(d, NO_STATUS); act(d, 0, attackOf(d, 0, leaf));
assert.equal(d.active(1)[0].hp, 1); assert.equal(d.active(1)[0].item, undefined); assert(d.state.events.some(e => e.kind === 'item' && e.item === 'endureband'));
// Pinch berries: healing below half, a stage below a quarter; both consumed once.
d = setup({ itemB: 'healberry' }); const target = d.active(1)[0]; target.hp = Math.ceil(target.maxHp * .5) + 3; rig(d, NO_STATUS); act(d, 0, attackOf(d, 0, leaf));
assert(d.state.events.some(e => e.item === 'healberry' && e.amount === Math.min(target.maxHp - (target.hp - e.amount), Math.ceil(target.maxHp * .25)))); assert.equal(target.item, undefined);
d = setup({ itemB: 'rallyberry' }); d.active(1)[0].hp = Math.floor(d.active(1)[0].maxHp * .25); d._react(1, 0, d.active(1)[0]);
assert.equal(d.active(1)[0].stages.atk, 1); assert.equal(d.active(1)[0].item, undefined);
// Thorns hurt the attacker; the bell drains; the hourglass saves PP; the charm strengthens guard.
r = dealt({ itemB: 'thornhelm' }, NO_STATUS, leaf); assert.equal(r.d.active(0)[0].maxHp - r.d.active(0)[0].hp, Math.floor(r.d.active(0)[0].maxHp / 8));
d = setup({ itemA: 'shellbell' }); d.active(0)[0].hp = 10; const hpBefore = d.active(1)[0].hp; rig(d, NO_STATUS); act(d, 0, attackOf(d, 0, leaf));
assert.equal(d.active(0)[0].hp, 10 + Math.max(1, Math.floor((hpBefore - d.active(1)[0].hp) / 8)), 'drain bell');
d = setup({ itemA: 'hourglass' }); let index = attackOf(d, 0, leaf), id = d.moves(d.active(0)[0])[index].id, pp = d.active(0)[0].pp[id];
rig(d, [.1, ...NO_STATUS]); act(d, 0, index); assert.equal(d.active(0)[0].pp[id], pp, 'PP kept'); rig(d, [.9, ...NO_STATUS]); act(d, 0, index); assert.equal(d.active(0)[0].pp[id], pp - 1);
const guardHit = item => { const g = setup({ itemB: item }); g.active(1)[0].guard = true; const h = g.active(1)[0].hp; rig(g, NO_STATUS); act(g, 0, attackOf(g, 0, leaf)); return h - g.active(1)[0].hp; };
assert(Math.abs(ratio(guardHit('guardcharm'), guardHit(null)) - 2 / 3) < .08, 'guard charm: 1/3 instead of 1/2');
// End of turn: regeneration.
d = setup({ itemA: 'forestscent' }); d.active(0)[0].hp = 50; d._endOfTurn(); assert.equal(d.active(0)[0].hp, 50 + Math.max(1, Math.floor(d.active(0)[0].maxHp / 16)));
// Quick claw: the slower holder moves first on a successful roll.
d = Duel.create({ mode: 'single', teams: [teamWith('komori'), teamWith('shizuku')], seed: 3 });
d.active(1)[0].item = 'quickclaw'; d.active(0)[0].stats.speed = 999; d.active(1)[0].stats.speed = 1;
rig(d, [.5, .1, .5]);
const order = side => ({ type: 'move', slot: 0, move: attackOf(d, side), target: 0 });
d.resolve([[order(0)], [order(1)]]);
const firstMove = d.state.events.find(e => e.kind === 'damage' || e.kind === 'miss');
assert.equal(firstMove.side, 1, 'the claw holder acted first'); assert(d.state.events.some(e => e.item === 'quickclaw'));
// Non-battle items do nothing in battle.
assert.equal(dealt({ itemA: 'luckycoin' }, NO_STATUS, leaf).amount, dealt({}, NO_STATUS, leaf).amount);

// ── Conditions as in the adventure.
const ember = D.species.hibana.element, tide = D.species.shizuku.element;
d = setup({ a: 'hibana', b: 'komori' }); rig(d, [0, .5, .5, 0]); act(d, 0, attackOf(d, 0, ember));
assert.equal(d.active(1)[0].status, D.statusByElement[ember], 'an elemental hit can inflict its condition');
d = setup({ a: 'komori', b: 'fuwari' }); rig(d, [0, .5, .5, 0]); act(d, 0, attackOf(d, 0, leaf)); assert.equal(d.active(1)[0].status, 'bloom');
d._endOfTurn(); assert(d.state.events.some(e => e.kind === 'statusTick' && e.status === 'bloom' && e.amount === Math.max(1, Math.floor(d.active(1)[0].maxHp / 8))));
d = setup({ a: 'komori', b: 'fuwari', itemB: 'bloomward' }); rig(d, [0, .5, .5, 0]); act(d, 0, attackOf(d, 0, leaf)); assert.equal(d.active(1)[0].status, undefined, 'the ward prevents its condition');
d = setup({ a: 'komori', b: 'fuwari', itemB: 'bloomberry' }); rig(d, [0, .5, .5, 0]); act(d, 0, attackOf(d, 0, leaf));
assert.equal(d.active(1)[0].status, undefined); assert.equal(d.active(1)[0].item, undefined); assert(d.state.events.some(e => e.item === 'bloomberry'), 'the berry cures at once');
const sameElement = setup({ a: 'komori', b: 'fuwari' }); sameElement.active(1)[0].species = 'komori'; rig(sameElement, [0, .5, .5, 0]); act(sameElement, 0, attackOf(sameElement, 0, leaf));
assert.equal(sameElement.active(1)[0].status, undefined, 'a monster of the same type is immune');
// Blocking conditions: crystal for its turns, bubble until it bursts or an ember hit pops it, dizzy 25%.
d = setup(); d.active(0)[0].status = 'crystal'; d.active(0)[0].statusTurns = 1; rig(d, NO_STATUS);
act(d, 0, attackOf(d, 0, leaf)); assert(d.state.events.at(-1).kind === 'status' && /動けない/.test(d.state.events.at(-1).text));
act(d, 0, attackOf(d, 0, leaf)); assert(d.state.events.some(e => /砕けた/.test(e.text)) && d.state.events.at(-1).kind !== 'status');
d = setup(); d.active(0)[0].status = 'bubble'; rig(d, [.5]); act(d, 0, attackOf(d, 0, leaf)); assert(/泡に閉じ込められて/.test(d.state.events.at(-1).text));
d = setup({ a: 'hibana', b: 'komori' }); d.active(1)[0].status = 'bubble'; rig(d, NO_STATUS); act(d, 0, attackOf(d, 0, ember)); assert.equal(d.active(1)[0].status, undefined, 'an ember hit pops the bubble');
d = setup(); d.active(0)[0].status = 'dizzy'; assert.equal(d.effectiveStats(d.active(0)[0]).speed, Math.floor(d.active(0)[0].stats.speed / 2)); rig(d, [.1]); act(d, 0, attackOf(d, 0, leaf)); assert(/目が回って/.test(d.state.events.at(-1).text));
// Scorch halves physical damage; fainting clears the condition.
const physical = (status) => { const s = setup({ a: 'komori', b: 'shizuku' }); const i = moveOf(s, 0, m => m.kind === 'attack' && (m.category || (m.element ? 'special' : 'physical')) === 'physical' && !m.effect); s.active(0)[0].status = status; const h = s.active(1)[0].hp; rig(s, NO_STATUS); act(s, 0, i); return h - s.active(1)[0].hp; };
assert(Math.abs(ratio(physical('scorch'), physical(undefined)) - .5) < .08, 'scorch halves physical damage');
d = setup(); d.active(1)[0].status = 'bloom'; d.active(1)[0].hp = 1; rig(d, NO_STATUS); act(d, 0, attackOf(d, 0, leaf)); assert.equal(d.active(1)[0].hp, 0); assert.equal(d.active(1)[0].status, undefined);

// ── Both peers build the same duel with items and conditions, turn after turn.
const config = { mode: 'double', teams: [['komori', 'fuwari', 'kirari', 'hibana'], ['shizuku', 'hibana', 'komori', 'kirari']], seed: 4242,
  items: [['leafcrown', 'quickclaw', 'lifeorb', 'forestscent'], ['tideshell', 'healberry', 'thornhelm', null]] };
const peers = [Duel.create(copy(config)), Duel.create(copy(config))];
let turns = 0, conditionEvents = 0, itemEvents = 0;
while (peers[0].state.winner === null && turns < 60) {
  const orders = [0, 1].map(side => peers[0].legalOrders(side));
  peers.forEach(p => p.resolve(copy(orders)));
  assert.equal(peers[0].fingerprint(), peers[1].fingerprint(), `turn ${turns}: both peers agree`);
  conditionEvents += peers[0].state.events.filter(e => e.kind === 'status' || e.kind === 'statusTick').length;
  itemEvents += peers[0].state.events.filter(e => e.kind === 'item' || e.item).length; turns++;
}
assert(peers[0].state.winner !== null, 'the duel finishes'); assert(itemEvents > 0, 'items acted during the duel');

// ── Sessions: members and items are the player's own, sent in the ready packet, the same on both peers.
const state = { party: [], storage: [], held: { swiftshoes: 1, lifeorb: 0 } };
const mk = (species, uid, extra = {}) => ({ species, level: 30, uid, ...extra });
state.party.push(mk('komori', 'p1', { heldItem: 'leafcrown', nickname: 'もり' }), mk('fuwari', 'p2', { heldItem: 'healberry' }), mk('kirari', 'p3'));
state.storage.push(mk('komori', 's1', { heldItem: 'healberry', shiny: true }), mk('hibana', 's2'));
LT.adminBridge = { getEngine: () => ({ state }) };
LT.Admin = { async requestDuelPass() { throw Error('not used'); }, async verifyDuelPass() { throw Error('not used'); } };
vm.runInContext(fs.readFileSync(path.join(root, 'online-futo.js'), 'utf8'), context);
assert.match(Duel.rulesFingerprint(), /owned-items/, 'peers on the old rules are turned away');
assert.deepEqual(copy(LT.OnlineFuto.ownedItems()), ['healberry', 'swiftshoes', 'leafcrown'].sort((a, b) => D.heldItems[a].no - D.heldItems[b].no), 'owned items: bag and held, without empty bag slots');
async function pair() {
  const queue = [], packets = [];
  const sessions = [0, 1].map(role => new LT.DuelSession({ role, mode: 'single', send: message => { queue.push({ from: role, message }); packets.push({ from: role, message: copy(message) }); return true; } }));
  const flush = async () => { let n = 0; while (queue.length) { assert(++n < 100); const { from, message } = queue.shift(); await sessions[1 - from].receive(message); } };
  sessions.forEach(s => s.start()); await flush(); return { sessions, flush, packets };
}
(async () => {
  let p = await pair();
  const refuse = async (input, pattern) => { const result = await p.sessions[0].setTeam({ name: 'A', ...input }); assert.equal(result.ok, false, JSON.stringify(input)); assert.match(result.error, pattern); };
  await refuse({ ids: ['komori', 'fuwari', 'kirari'], uids: ['p1', 'p2', 'zz'] }, /手持ち・ひかえ/);
  await refuse({ ids: ['komori', 'fuwari', 'kirari'], uids: ['p1', 'p3', 'p2'] }, /手持ち・ひかえ/, 'species must match the member');
  await refuse({ ids: ['komori', 'fuwari', 'kirari'], uids: ['p1', 'p2', 'p3'], items: ['healberry', 'healberry', null] }, /同じ持ち物/);
  await refuse({ ids: ['komori', 'fuwari', 'kirari'], uids: ['p1', 'p2', 'p3'], items: ['lifeorb', null, null] }, /持っていません/, 'an item with no copy left cannot be used');
  // The storage komori (shiny, holding a berry) with an item from the bag and one moved from another member.
  let result = await p.sessions[0].setTeam({ name: 'A', ids: ['komori', 'fuwari', 'kirari'], uids: ['s1', 'p2', 'p3'], items: ['leafcrown', 'swiftshoes', 'healberry'] });
  assert(result.ok, result.error);
  state.party.length = 0; state.storage.length = 0; state.held = {};
  state.party.push(mk('shizuku', 'q1'), mk('hibana', 'q2', { heldItem: 'thornhelm' }), mk('fuwari', 'q3'));
  result = await p.sessions[1].setTeam({ name: 'B', ids: ['shizuku', 'hibana', 'fuwari'], uids: ['q1', 'q2', 'q3'] });
  assert(result.ok, result.error); await p.flush();
  const ready = p.packets.filter(x => x.message.t === 'ready');
  assert.deepEqual(ready.find(x => x.from === 0).message.team.items, ['leafcrown', 'swiftshoes', 'healberry']);
  assert.deepEqual(ready.find(x => x.from === 1).message.team.items, [null, 'thornhelm', null], 'held items come along by default');
  assert.deepEqual(ready.find(x => x.from === 0).message.team.appearance[0], { nickname: '', shiny: true }, 'the chosen individual, not the first of its species');
  const [a, b] = p.sessions.map(s => s.duel);
  assert(a && b); assert.equal(a.fingerprint(), b.fingerprint());
  assert.deepEqual(copy(a.state.teams.map(t => t.monsters.map(m => m.item ?? null))), [['leafcrown', 'swiftshoes', 'healberry'], [null, 'thornhelm', null]]);
  const forged = { name: 'X', ids: ['komori', 'fuwari', 'kirari'], appearance: [0, 1, 2].map(() => ({ nickname: '', shiny: false })) };
  assert(p.sessions[0]._validTeam({ ...forged, items: ['leafcrown', null, null] }));
  for (const items of [['leafcrown', 'leafcrown', null], ['zzz', null, null], [null, null, null], ['leafcrown', null]]) assert.equal(p.sessions[0]._validTeam({ ...forged, items }), false, JSON.stringify(items));
  p.sessions.forEach(s => s.close());

  // ── Playback rhythm: every message has a beat, in order, with pauses; the log follows it.
  vm.runInContext(fs.readFileSync(path.join(root, 'battle-vfx.js'), 'utf8'), context);
  const V = LT.BattleVFX, teams = copy(peers[0].state.teams);
  const fake = { seed: 77, round: 2, turn: 1, winner: null, teams, events: [
    { kind: 'turn', text: '第1ターン', visual: { teams } },
    { kind: 'damage', side: 0, slot: 0, target: 0, move: D.species.komori.moves[0], amount: 20, text: 'アオイのコモリの技。シズクに20ダメージ。', visual: { teams } },
    { kind: 'status', side: 1, slot: 0, status: 'bloom', text: 'ベニのシズクは花毒に冒された！', visual: { teams } },
    { kind: 'item', side: 1, slot: 0, item: 'healberry', text: 'ベニのシズクは癒やしの実を食べて、体力が30回復した！', visual: { teams } },
    { kind: 'statusTick', side: 1, slot: 0, status: 'bloom', amount: 10, text: 'ベニのシズクは花毒で10ダメージ。', visual: { teams } }] };
  const t0 = 1000; assert.equal(V.onlineBusy(fake, t0), true);
  const shownAt = t => V.onlineProgress(fake, t).shown;
  let last = 0, changes = [], t = t0;
  for (; t < t0 + 30000 && V.onlineBusy(fake, t); t += 50) { const n = shownAt(t); if (n !== last) { changes.push([n, t - t0]); last = n; } }
  assert.deepEqual(changes.map(c => c[0]), [1, 2, 3, 4, 5], 'one message after another, never several at once');
  const gaps = changes.slice(1).map((c, i) => c[1] - changes[i][1]);
  assert(gaps.every(g => g >= 1100), `each message stays readable before the next (${gaps.join(',')}ms)`);
  assert(t - t0 >= 6000 && t - t0 <= 12000, `a five-message turn takes a calm ${((t - t0) / 1000).toFixed(1)}s`);
  assert.equal(V.render({}, 100, 100, t0 + 10, { kind: 'text', started: t0, duration: 900 }), false, 'plain messages draw no effect');

  // ── The page: owned members, item choices, synced log, Bluetooth guide.
  for (const needle of ['data-link-member=', 'data-link-item=', 'function ownedMembers()', 'function normalizeTeam(', 'items:itemPicks.slice(0,mode===\'double\'?4:3).map(id=>id||null)', 'uids:selected.slice(0,mode===\'double\'?4:3)',
    'onlineProgress?.(b,performance.now())', 'class="is-current"', '対戦には、種類の違うパチモンが', '（対戦では効果なし）', 'LT.LocalQR?.guide'])
    assert(html.includes(needle), `index.html: ${needle}`);
  const local = fs.readFileSync(path.join(root, 'local-link.js'), 'utf8');
  assert(/Bluetoothテザリング/.test(local) && /テザリングなしのBluetooth直接通信は、このブラウザー版では利用できません。/.test(local), 'the Bluetooth guide explains tethering and its limit');
  for (const id of timers) clearTimeout(id);
  console.log(JSON.stringify({ ok: true, battleItems: BATTLE.length, idleItems: INERT.length, duelTurns: turns, itemEvents, conditionEvents,
    checks: ['item lists and uniqueness', 'boost/shield/orb/stat/critical', 'endurance and pinch berries', 'thorns/bell/hourglass/guard charm', 'regeneration', 'quick claw', 'idle items', 'conditions (inflict, ward, berry, immunity, crystal, bubble, dizzy, scorch, faint)', 'identical peers over a full double duel', 'owned members and items only', 'ready packet items and look', 'forged item lists refused', 'one beat per message', 'page wiring and Bluetooth guide'] }));
})().catch(error => { console.error(error); process.exit(1); });
