#!/usr/bin/env node
'use strict';
/* Type-themed conditions, 48 held items, gender, allocation points, the admin
 * shiny encounter and edge warp gates. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const context = vm.createContext({ console });
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc=|application\/ld\+json/.test(m[1])) continue;
  vm.runInContext(m[2], context);
  if (context.LT?.Engine) break;
}
const { LT } = context, D = LT.DATA, { Engine } = LT;
const hero = (starter = 'hibana', level = 30) => { const e = new Engine(); e.newGame(starter); const m = e.state.party[0]; m.level = level; e.restoreMonster(m); return e; };
const attackOf = (e, mon, element) => e.moves(mon).find(m => m.element === element && m.kind === 'attack');

// ── Conditions: one per type, named for the type.
const S = D.statuses;
assert.deepEqual(Object.values(S).map(s => `${s.element}:${s.name}`).sort(), ['crystal:結晶化', 'ember:灯焼け', 'leaf:花毒', 'tide:水封', 'wind:目眩']);
assert.deepEqual(Object.values(S).filter(s => s.persistent).map(s => s.id).sort(), ['bloom', 'dizzy', 'scorch']);
{
  const e = hero(); const ally = e.makeMonster('komori', 20); e.state.party.push(ally); e.markCaught('komori');
  e.startBattle('fuwari', 20); e.battle.activeIndex = 1; e.rng = () => 0;
  const ev = []; e.applyMove(e.battle.enemy, ally, attackOf(e, e.battle.enemy, 'wind'), 'enemy', ev);
  assert.equal(ally.status, 'dizzy'); assert(ev.some(x => x.kind === 'status' && /目眩/.test(x.text)));
  const fast = e.stats(ally).speed; assert.equal(e.battleStats(ally).speed, Math.floor(fast / 2), '目眩 halves speed');
  // Same-type monsters are immune: a leaf monster never gets 花毒.
  ally.status = undefined; delete ally.status;
  const leafFoe = e.makeMonster('komorion', 20); e.battle.enemy = leafFoe;
  e.applyMove(leafFoe, ally, attackOf(e, leafFoe, 'leaf'), 'enemy', []); assert.equal(ally.status, undefined, 'leaf is immune to 花毒');
  // End of turn: 花毒 1/8, 灯焼け 1/16.
  ally.status = 'bloom'; const max = e.stats(ally).hp; ally.hp = max; const ticks = []; e.rng = () => .5; e.endOfTurn(ticks);
  assert.equal(ally.hp, max - Math.floor(max / 8)); assert(ticks.some(x => x.kind === 'statusTick'));
  // 結晶化 lasts 1–3 turns; 水封 breaks when hit by 灯.
  delete ally.status; e.rng = () => 0; const crystalFoe = e.makeMonster('kirari', 20); e.battle.enemy = crystalFoe;
  e.applyMove(crystalFoe, ally, attackOf(e, crystalFoe, 'crystal'), 'enemy', []); assert.equal(ally.status, 'crystal'); assert(ally.statusTurns >= 1 && ally.statusTurns <= 3);
  const blocked = []; assert.equal(e.conditionBlocks(ally, 'ally', blocked), true);
  ally.status = 'bubble'; ally.hp = e.stats(ally).hp; e.rng = () => .9; const emberFoe = e.makeMonster('hibana', 20); e.battle.enemy = emberFoe;
  e.applyMove(emberFoe, ally, attackOf(e, emberFoe, 'ember'), 'enemy', []); assert.equal(ally.status, undefined, 'ember pops 水封');
  // Battle-only conditions fade at the end; persistent ones stay until healed.
  ally.status = 'crystal'; e.state.party[0].status = 'scorch'; e.endBattle('fled', []);
  assert.equal(ally.status, undefined); assert.equal(e.state.party[0].status, 'scorch');
  e.battle = null; assert(e.useItem('remedy', 0).ok); assert.equal(e.state.party[0].status, undefined);
  e.state.party[0].status = 'bloom'; const npcRest = Object.values(D.maps).flatMap(m => m.npcs.map(n => [m, n])).find(([, n]) => n.kind === 'rest');
  Object.assign(e.state, { map: npcRest[0].id, x: npcRest[1].x, y: npcRest[1].y + 1, facing: 'up' });
  if (e.nearbyNPC()?.kind === 'rest') { e.heal(); assert.equal(e.state.party[0].status, undefined, 'inns heal conditions'); }
}

// ── 48 held items.
const H = D.heldItems;
assert.equal(Object.keys(H).length, 48); assert.equal(new Set(Object.values(H).map(h => h.name)).size, 48);
assert(Object.values(H).every(h => h.description && h.price > 0 && Number.isInteger(h.tier)));
{
  const e = hero(); const lead = e.state.party[0];
  e.state.held = { embercore: 1, healberry: 1, bloomberry: 1, learnsash: 1, everpebble: 1, trainband: 1, calmbell: 1 };
  assert(e.giveHeld(0, 'embercore').ok); assert.equal(lead.heldItem, 'embercore'); assert.equal(e.heldCount('embercore'), 0);
  assert(e.takeHeld(0).ok); assert.equal(e.heldCount('embercore'), 1);
  // Boost: ember damage ×1.2 (same rolls).
  const foe = e.makeMonster('kirari', 20); const ember = attackOf(e, lead, 'ember');
  e.startBattle('kirari', 20); e.rng = () => .5; const plain = e.battle.enemy.hp; e.applyMove(lead, e.battle.enemy, ember, 'ally', []); const dealt = plain - e.battle.enemy.hp;
  e.battle.enemy.hp = plain; lead.pp[ember.id] = e.maxPP(ember); lead.heldItem = 'embercore'; e.applyMove(lead, e.battle.enemy, ember, 'ally', []); const boosted = plain - e.battle.enemy.hp;
  assert(boosted > dealt, 'a booster raises damage'); delete lead.heldItem;
  // Cure berry consumes itself; pinch berry heals once.
  lead.heldItem = 'bloomberry'; lead.status = 'bloom'; e.heldReact(lead, 'ally', []); assert.equal(lead.status, undefined); assert.equal(lead.heldItem, undefined);
  lead.heldItem = 'healberry'; lead.hp = 5; e.heldReact(lead, 'ally', []); assert(lead.hp > 5); assert.equal(lead.heldItem, undefined);
  e.battle = null;
  // XP band, training band and the evolution stone.
  lead.heldItem = 'learnsash'; const before = lead.xp; e.giveXP(lead, 10, []); assert.equal(lead.xp - before, 15);
  lead.heldItem = 'trainband'; const pts = e.allocationInfo(lead).total; e.giveXP(lead, e.xpToNext(lead.level), []); assert.equal(e.allocationInfo(lead).total, pts + 3, 'level-up gives 2 + 1 points');
  const young = e.makeMonster('komori', 7); young.heldItem = 'everpebble'; e.giveXP(young, 5000, []); assert.equal(young.species, 'komori', 'the pebble stops evolution');
}

// ── Gender and allocation points.
{
  const e = hero(); const lead = e.state.party[0];
  assert(['male', 'female'].includes(LT.genderOf(lead))); assert.equal(LT.genderOf({ species: D.legendary.species, uid: 'x' }), 'none');
  const info = e.allocationInfo(lead); assert.equal(info.total, 58); assert.equal(info.free, 58);
  const atk = e.stats(lead).atk, hp = e.stats(lead).hp;
  assert(e.allocate(0, 'atk', 10).ok); assert(e.allocate(0, 'hp', 5).ok);
  assert.equal(e.stats(lead).atk, atk + 10); assert.equal(e.stats(lead).hp, hp + 10);
  assert.equal(e.allocate(0, 'speed', 99).ok, false, 'only ±1/±5/±10 steps');
  for (let i = 0; i < 20; i++) e.allocate(0, 'def', 5);
  assert(e.stats(lead).def <= e.stats({ ...lead, alloc: { def: 64 } }).def, 'each stat caps at 64');
  assert.equal(e.allocationInfo(lead).free, 0, 'points are limited by level');
  assert(e.resetAllocation(0).ok); assert.equal(e.allocationInfo(lead).used, 0);
  assert(e.autoAllocate(0).ok); assert.equal(e.allocationInfo(lead).free, 0);
  assert(e.resetAllocation(0).ok);
  e.allocate(0, 'spAtk', 10); lead.heldItem = 'powerband'; delete e.state.held; lead.status = 'scorch';
  // Saves keep conditions, items and points; old saves default the new fields.
  const back = new Engine(JSON.parse(JSON.stringify(e.state))).state;
  assert.equal(back.version, 4); assert.equal(back.party[0].heldItem, 'powerband'); assert.equal(back.party[0].status, 'scorch'); assert.equal(back.party[0].alloc.spAtk, 10);
  const old = JSON.parse(JSON.stringify(e.state)); delete old.inventory.remedy; delete old.held;
  const oldLoaded = new Engine(old).state; assert.equal(oldLoaded.inventory.remedy, 0); assert.equal(Object.keys(oldLoaded.held).length, 0);
  const forged = JSON.parse(JSON.stringify(e.state)); forged.party[0].alloc = { atk: 999 };
  assert.equal(new Engine(forged).state.party[0].alloc, undefined, 'impossible allocations are dropped');
  // Trades: holders must hand items back; conditions, gender and points stay home.
  assert.throws(() => e.tradeMonster(lead), /持ち物/);
  delete lead.heldItem; assert.deepEqual(Object.keys(e.tradeMonster(lead)).sort(), ['hp', 'level', 'pp', 'shiny', 'species', 'uid', 'xp']);
  // Captures keep the gender shown in battle.
  e.startBattle('fuwari', 3); const shown = LT.genderOf(e.battle.enemy); e.rng = () => 0; e.action({ type: 'resonate' });
  const caught = [...e.state.party, ...e.state.storage].find(m => m.species === 'fuwari'); assert.equal(LT.genderOf(caught), shown);
}

// ── Admin mythical encounter can be shiny on request.
{
  const e = hero(); const owner = { isAdmin: true, id: 'P0123456789abcdef' };
  assert(e.startAdminEncounter(D.mythical.species, 50, owner, { shiny: true }).ok); assert.equal(e.battle.enemy.shiny, true);
  e.battle = null; e.rng = () => .5; assert(e.startAdminEncounter('komori', 10, owner).ok); assert.equal(e.battle.enemy.shiny, false);
}

// ── Warp gates sit at the ends of each stage's main road; arrivals are two tiles inside.
for (const id of D.regionIds) {
  const m = D.maps[id];
  for (const x of m.exits.filter(x => !x.door)) {
    assert([2, 41].includes(x.x) || x.y === 2, `${id}: warp ${x.x},${x.y} must sit on the edge`);
    const t = D.maps[x.to]; assert(!t.exits.some(o => Math.abs(o.x - x.tx) + Math.abs(o.y - x.ty) <= 1), `${id}->${x.to}: arrival next to another warp`);
    assert(!m.npcs.some(n => Math.abs(n.x - x.x) + Math.abs(n.y - x.y) <= 1), `${id}: NPC beside a warp`);
  }
}
console.log(JSON.stringify({ ok: true, conditions: Object.values(S).map(s => s.name), heldItems: Object.keys(H).length, checks: ['immunity', 'end-of-turn', 'battle-only fade', 'remedy/inn', 'boost/berries/xp/training/pebble', 'gender', 'allocation caps/save', 'trade rules', 'admin shiny', 'edge gates'] }));
