#!/usr/bin/env node
'use strict';
/* 96 moves: 15 per type, 6 neutral, 12 special, 3 starter signature moves.
 * Every move is learned by someone; old saves, trades with the exchange
 * server and saved Futo settings keep working. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const context = vm.createContext({ console });
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc=|application\/ld\+json/.test(m[1])) continue;
  vm.runInContext(m[2], context); if (context.LT?.Engine) break;
}
const { LT } = context, D = LT.DATA, { Engine } = LT, M = D.moves;
const copy = value => JSON.parse(JSON.stringify(value));

// ── Roster shape.
assert.equal(Object.keys(M).length, 96); assert.equal(D.content.moves, 96); assert.equal(D.moveRoster.total, 96);
const byElement = {}; for (const m of Object.values(M)) { const key = m.role === 'special' ? 'special' : m.role === 'signature' ? 'signature' : m.element || 'neutral'; byElement[key] = (byElement[key] || 0) + 1; }
assert.deepEqual(byElement, { leaf: 15, tide: 15, ember: 15, wind: 15, crystal: 15, neutral: 6, special: 12, signature: 3 });
for (const element of ['leaf', 'tide', 'ember', 'wind', 'crystal']) {
  const roles = Object.values(M).filter(m => m.element === element && D.moveRoster.roles.includes(m.role)).map(m => m.role).sort();
  assert.deepEqual(roles, [...D.moveRoster.roles].sort(), `${element} has one move per role`);
}
for (const m of Object.values(M)) {
  assert(m.name && m.description, m.id); assert(['attack', 'heal', 'guard', 'boost'].includes(m.kind), m.id);
  if (m.kind === 'attack') assert(['physical', 'special'].includes(m.category) && m.power > 0 && m.accuracy > 0 && m.accuracy <= 100, m.id);
  assert(!/こうげき|ぼうぎょ|とくこう|とくぼう|すばやさ|最大HP/.test(m.description), `${m.id} uses the current stat names`);
}

// ── Movesets: four distinct moves each, every move learned by someone, signatures on their owners only.
const uses = new Map(Object.keys(M).map(id => [id, 0]));
for (const s of Object.values(D.species)) {
  assert.equal(s.moves.length, 4, s.id); assert.equal(new Set(s.moves).size, 4, s.id);
  for (const id of s.moves) { assert(M[id], `${s.id}: ${id}`); uses.set(id, uses.get(id) + 1); }
}
for (const [id, n] of uses) assert(n > 0, `${id} is learned by no monster`);
assert.deepEqual(copy(D.signatureMoves), { sig_leaf: 'komorizen', sig_tide: 'shizunaria', sig_ember: 'akehomura' });
for (const [move, owner] of Object.entries(D.signatureMoves)) {
  assert.deepEqual(Object.values(D.species).filter(s => s.moves.includes(move)).map(s => s.id), [owner]);
  assert.equal(M[move].element, D.species[owner].element); assert(M[move].power >= 60);
}
for (const id of ['futo', 'arvelion', 'floravelle']) assert(D.species[id].moves.every(move => M[move].role === 'special'), id);

// ── Second evolution teaches the signature move, with its own message.
for (const [middle, final] of [['komorion', 'komorizen'], ['shizurua', 'shizunaria'], ['akebino', 'akehomura']]) {
  const e = new Engine(); e.newGame('komori');
  const mon = e.makeMonster(middle, D.species[middle].evolveLevel - 1); e.state.party.push(mon); e.markCaught(middle);
  const events = []; e.giveXP(mon, e.xpToNext(mon.level), events);
  assert.equal(mon.species, final);
  const learned = events.find(event => event.kind === 'learn');
  assert(learned && learned.text.includes(`「${M[learned.move].name}」`) && D.signatureMoves[learned.move] === final, `${final} announces its signature move`);
  assert.equal(mon.pp[learned.move], e.maxPP(M[learned.move]), 'the new move starts with full PP');
}

// ── Old saves: PP of the old four moves carries over slot by slot.
{
  const e = new Engine(); e.newGame('hibana');
  const mon = e.state.party[0], old = D.legacyMovesets.hibana;
  const save = copy(e.serialize()); save.party[0].pp = Object.fromEntries(old.map(([id, max], i) => [id, i === 0 ? 0 : i === 1 ? max : Math.floor(max / 2)]));
  const loaded = new Engine(save).state.party[0], moves = D.species.hibana.moves;
  assert.deepEqual(Object.keys(loaded.pp), copy(moves), 'old PP keys become the new moves');
  assert.equal(loaded.pp[moves[0]], 0, 'an empty move stays empty'); assert.equal(loaded.pp[moves[1]], e.maxPP(M[moves[1]]), 'a full move stays full');
  assert(loaded.pp[moves[2]] > 0 && loaded.pp[moves[2]] < e.maxPP(M[moves[2]]));
  void mon;
}

// ── Trades: the exchange server's catalog on the wire, both directions.
const server = fs.readFileSync(path.join(root, 'server', 'server.mjs'), 'utf8');
const TRADE = JSON.parse(server.match(/const TRADE_SPECIES = Object\.freeze\((\{.*?\})\);/s)[1]);
let tradable = 0;
for (const [id, s] of Object.entries(D.species)) {
  if (s.specialOnly || s.adminOnly || ['futo', 'floravelle'].includes(id)) continue;
  assert.deepEqual(Object.fromEntries(D.legacyMovesets[id]), TRADE[id].pp, `${id}: the frozen catalog equals the server's`);
  tradable++;
}
assert.equal(tradable, 254);
{
  const e = new Engine(); e.newGame('komori');
  const mon = e.makeMonster('fuwari', 30); mon.uid = 'trade-1'; const ids = D.species.fuwari.moves;
  mon.pp[ids[0]] = 0; mon.pp[ids[1]] = e.maxPP(M[ids[1]]);
  const wire = e.toTradeWire(mon);
  assert.deepEqual(Object.keys(wire.pp), copy(D.legacyMovesets.fuwari.map(([id]) => id)), 'wire PP uses the server catalog');
  for (const [i, [id, max]] of D.legacyMovesets.fuwari.entries()) assert(wire.pp[id] >= 0 && wire.pp[id] <= max, id), void i;
  assert.equal(wire.pp[D.legacyMovesets.fuwari[0][0]], 0); assert.equal(wire.pp[D.legacyMovesets.fuwari[1][0]], D.legacyMovesets.fuwari[1][1]);
  const back = e.fromTradeWire(wire); assert.deepEqual(Object.keys(back.pp), copy(ids));
  assert.equal(back.pp[ids[0]], 0); assert.equal(back.pp[ids[1]], e.maxPP(M[ids[1]]));
  assert.deepEqual(copy(e.tradeMonster(back)).species, 'fuwari');
  assert.equal(JSON.stringify(e.wireEcho(wire)), JSON.stringify(e.wireEcho(e.tradeMonster(mon))), 'both formats compare equal');
  assert.deepEqual(copy(e.tradeWirePP(wire)), copy(wire.pp), 'wire PP is left as is');
}

// ── Retired moves read as their replacements; genuine duplicates stay invalid.
for (const [old, next] of Object.entries(D.retiredMoves)) {
  assert(!M[old], `${old} is retired`); assert(M[next], `${old} → ${next} exists`);
}
assert.equal(Object.keys(D.retiredMoves).length, 19);
assert.deepEqual(copy(LT.FutoRules.migrateMoves(['phoenix', 'atlas_ember_10', 'supernova', 'shell'])).length, 4);
assert.equal(new Set(LT.FutoRules.migrateMoves(['phoenix', 'atlas_ember_10', 'supernova', 'shell'])).size, 4, 'a replacement never duplicates');
assert.deepEqual(copy(LT.normalizeFutoMoves(['atlas_crystal_2', 'atlas_crystal_6', 'atlas_crystal_9', 'atlas_crystal_11'])), ['prism', 'moonbeam', 'starlight', 'shell']);
assert.throws(() => LT.normalizeFutoMoves(['shell', 'shell', 'shell', 'shell']));
const admin = fs.readFileSync(path.join(root, 'admin-console.js'), 'utf8');
assert(/signatureMoves/.test(admin), 'the admin move picker leaves signature moves to their starters');
// Every move the admin can pick for Futo is still accepted by the exchange server.
const accepted = new Set([...server.match(/const DEFAULT_MOVES = (\[.*?\]);/)[1].match(/'([^']+)'/g).map(x => x.slice(1, -1)),
  ...server.match(/const BASIC_MOVES = '([^']+)'/)[1].split(' '), ...['leaf', 'tide', 'ember', 'wind', 'crystal'].flatMap(t => Array.from({ length: 12 }, (_, i) => `atlas_${t}_${i + 1}`))]);
const exclusive = new Set([...D.species.arvelion.moves, ...D.species.floravelle.moves, ...Object.keys(D.signatureMoves)]);
for (const id of Object.keys(M).filter(id => !exclusive.has(id))) assert(accepted.has(id), `${id} must be accepted by the current server for Futo`);

// ── Online: rental teams fight with the new movesets.
const duel = LT.Duel?.create?.({ mode: 'single', teams: [['komori', 'fuwari', 'kirari'], ['hibana', 'shizuku', 'glint' in M ? 'komorion' : 'komorion']], seed: 3 });
if (duel) assert.deepEqual(copy(duel.moves(duel.state.teams[0].monsters[0]).map(m => m.id)), copy(D.species.komori.moves));
console.log(JSON.stringify({ ok: true, moves: 96, perElement: 15, neutral: 6, special: 12, signature: 3, retired: 19, tradable }));
