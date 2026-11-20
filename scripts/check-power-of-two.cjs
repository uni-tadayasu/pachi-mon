#!/usr/bin/env node
'use strict';
/* The power-of-two edition: 256 species, 128 stages, 64 scores, 32 badges,
 * 16 secrets, 8 trick glitches, 4 elites and 2 champions — plus the save
 * migration that keeps older adventures loadable. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const context = vm.createContext({ console });
for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\bsrc=|application\/ld\+json/.test(m[1])) continue;
  vm.runInContext(m[2], context);
  if (context.LT?.Engine) break;
}
const { LT } = context, D = LT.DATA, { Engine } = LT;
const audioSource = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(m => m[1].includes('class LuminaAudio'))[1];
const audio = vm.createContext({ console, matchMedia: () => ({ matches: false }), document: { hidden: false }, navigator: {} });
vm.runInContext(audioSource, audio);
const tracks = audio.LT.AUDIO_MANIFEST;

// ── The ladder.
const stages = D.regionIds.map(id => D.maps[id]);
assert.equal(Object.values(D.species).filter(s=>!s.hiddenDex).length, 256, '256 species in the public dex');
assert.equal(Object.values(D.species).filter(s=>s.hiddenDex).length, 12, 'twelve special companions live outside the dex');
assert.equal(D.glitchLine.ids.length, 3, 'the original Void lineage still has three stages');
assert.equal(D.offDexLines.ids.length, 8, 'the three added families contain exactly eight forms');
assert.deepEqual([...D.offDexLeaders.ids], ['galdoras'], 'the stone leader is a single non-evolving species');
assert.equal(stages.length, 128, '128 stages');
assert.equal(tracks.length, 64, '64 BGM tracks');
assert.equal(new Set(tracks.map(t => t.id)).size, 64);
assert.equal(Object.keys(D.guardians).length, 32, '32 badge holders');
assert.equal(new Set(Object.values(D.guardians).map(g => g.seal)).size, 32, '32 distinct badges');
assert.equal(D.secrets.length, 16, '16 secrets');
assert.equal(D.tricks.length, 8, '8 trick glitches');
assert.equal(Object.keys(D.elites).length, 4, '4 elites');
assert.equal(D.champions.length, 2, '2 champions');
assert.deepEqual([...D.ladder.map(r => r.count)], [256, 128, 64, 32, 16, 8, 4, 2]);
assert.equal(D.content.totalSpecies, 256); assert.equal(D.content.stages, 128); assert.equal(D.content.badges, 32);

// ── Stage structure: 32 districts × (town, route, landmark, depths); 64 = council hall, 128 = zenith.
stages.forEach((m, i) => { assert.equal(m.stage, i + 1); assert.equal(m.district, Math.floor(i / 4) + 1); assert(!m.interior); });
assert.equal(stages[63].id, 'meridianleague'); assert.equal(stages[63].role, 'league');
assert.equal(stages[127].id, 'zenithcrossing'); assert.equal(stages[127].role, 'summit');
const order = Object.keys(D.guardians);
for (let d = 0; d < 32; d++) {
  const town = stages[d * 4], g = D.guardians[order[d]];
  assert.equal(town.role, 'town'); assert.equal(g.region, town.id, `badge ${d + 1} lives in its district town`);
  for (const kind of ['gym', 'inn', 'shop']) assert(town.exits.some(e => e.door && D.maps[e.to].roomKind === kind), `${town.id} has a ${kind}`);
  assert(D.maps[g.map].npcs.some(n => n.guardianId === g.id), `${g.id} waits inside its badge hall`);
  if (d !== 15 && d !== 31) assert(stages[d * 4 + 3].exits.some(e => e.shortcut && e.to === town.id), `depths ${d + 1} has a shortcut home`);
}
// The road is continuous and every stage is reachable from the first town.
const reached = new Set(['village']), queue = ['village'];
while (queue.length) for (const e of D.maps[queue.shift()].exits) if (!reached.has(e.to)) { reached.add(e.to); queue.push(e.to); }
for (const m of stages) assert(reached.has(m.id), `${m.id} is reachable`);
// Levels rise with the districts and stay within the cap.
for (let i = 1; i < stages.length; i++) if (stages[i].encounters.length && stages[i - 4]?.encounters.length) assert(stages[i].level[0] >= stages[i - 4].level[0], `${stages[i].id} is not easier than the previous district`);
assert(stages.every(m => m.level[1] <= 100));
// Every wild species of the old atlas remains obtainable, and retired IDs are gone.
for (const id of Object.keys(D.retiredSpecies)) { assert(!D.species[id]); assert(!stages.some(m => m.encounters.includes(id))); }
for (const id of D.collectionRoutes.wild) assert(D.species[id]);

// ── Saves: retired species convert, rebuilt places relocate, champions gate the east line.
const e = new Engine(); assert(e.newGame('komori').ok);
const legacy = JSON.parse(JSON.stringify(e.state));
Object.assign(legacy, { version: 3, map: 'interior-meadow-1', x: 9, y: 12, visited: ['village', 'orchard', 'interior-meadow-1'] });
legacy.party.push({ uid: 'old-1', species: 'sangoro', level: 20, xp: 0, hp: 60, pp: { riptide: 10, frost: 20, mist: 15, pulse: 20 } });
legacy.seen.push('sangoro', 'tobine'); legacy.caught.push('sangoro', 'tobine');
delete legacy.secrets; delete legacy.tricks;
const migrated = new Engine(legacy).state;
assert.equal(migrated.version, 4); assert.equal(migrated.map, 'village');
assert.equal(migrated.party[1].species, D.retiredSpecies.sangoro);
assert(!migrated.caught.some(id => D.retiredSpecies[id])); assert(migrated.caught.includes('rurihime') && migrated.caught.includes('tousa'));
assert(!migrated.visited.includes('orchard'), 'places that now open later are forgotten, not fatal');
assert.equal(migrated.secrets.length, 0); assert.equal(migrated.tricks.length, 0);

const hero = () => { const x = new Engine(); x.newGame('hibana'); return x; };
const champ = hero();
champ.state.seals = order.slice(0, 16); champ.state.leagueWins = Object.values(D.elites).sort((a, b) => a.order - b.order).map(x => x.id);
const gate = D.maps.meridianleague.exits.find(x => x.to === 'shinonomeport');
const step = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: gate.x - dx, y: gate.y - dy, dx, dy })).find(p => champ.walkable(D.maps.meridianleague, p.x, p.y));
Object.assign(champ.state, { map: 'meridianleague', x: step.x, y: step.y });
assert.equal(champ.move(step.dx, step.dy).ok, false, 'the east line needs the first champion');
champ.state.flags.championWon = true; champ.state.flags.completed = true;
assert.equal(champ.move(step.dx, step.dy).ok, true); assert.equal(champ.state.map, 'shinonomeport');
assert.match(champ.objective(), /東雲旅紋/);
assert.equal(champ.fastTravel('zenithgate').ok, false);
const summitNpc = D.maps.zenithcrossing.npcs.find(n => n.championId === D.champion2.id);
Object.assign(champ.state, { map: 'zenithcrossing', x: summitNpc.x, y: summitNpc.y + 1, facing: 'up' });
assert.equal(champ.startChampion(D.champion2.id).ok, false, 'the zenith needs all 32 badges');
champ.state.seals = order.slice();
assert.equal(champ.startChampion(D.champion2.id).ok, true); assert.equal(champ.battle.champion, D.champion2.id);
champ.battle = null;
const round = new Engine(JSON.parse(JSON.stringify({ ...champ.state, flags: { ...champ.state.flags, champion2Won: true, trueEndingShown: true } }))).state;
assert.equal(round.flags.champion2Won, true); assert.equal(round.flags.trueEndingShown, true);
assert.throws(() => new Engine({ ...JSON.parse(JSON.stringify(champ.state)), seals: order.slice(), flags: { endingShown: true } }), /旅紋/, '17+ badges require the first champion');

// ── Secrets and tricks recorded by the engine itself.
const t = hero(), w = D.trickWall;
Object.assign(t.state, { map: w.map, x: w.x, y: w.y });
for (let i = 0; i < 7; i++) assert.equal(t.move(0, -1).ok, false);
const slip = t.move(0, -1); assert(slip.ok && slip.glitch); assert.equal(t.state.map, 'interior-glitch');
assert.deepEqual([...t.takeDiscoveries().map(d => d.type + ':' + d.id)].sort(), ['secret:glitchroom', 'trick:wallslip']);
const spot = D.hiddenSpots[0]; Object.assign(t.state, { map: spot.map, x: spot.x, y: spot.y });
assert.equal(t.interact().title, '見えない落とし物'); assert(t.state.secrets.includes('hiddenitem'));
const mentor = D.maps.village.npcs.find(n => n.id === 'mentor'); Object.assign(t.state, { map: 'village', x: mentor.x, y: mentor.y + 1, facing: 'up' });
let talk; for (let i = 0; i < 16; i++) talk = t.interact();
assert(t.state.secrets.includes('mentor16') && t.state.tricks.includes('garble'), 'mentor story and garbled text');
const curator = D.maps.lunettecity.npcs.find(n => n.id === 'lunettecity-curator'); t.clock = () => new Date(2026, 0, 1, 2);
Object.assign(t.state, { map: 'lunettecity', x: curator.x, y: curator.y + 1, facing: 'up' }); t.talkStreak = null;
t.interact(); assert(t.state.secrets.includes('midnight'));
assert(t.activateStealth().ok && t.stealthSteps === 128 && t.state.tricks.includes('stealth'));
for (const id of ['overrun', 'palette', 'crunch', 'mirror', 'dupe']) t.discoverTrick(id);
assert.equal(t.state.tricks.length, 8); assert(t.state.secrets.includes('bugmaster'), 'all 8 tricks reveal the bug master secret');
const saved = new Engine(JSON.parse(JSON.stringify(t.state))).state;
assert.equal(saved.tricks.length, 8); for (const id of ['glitchroom', 'hiddenitem', 'mentor16', 'midnight', 'bugmaster']) assert(saved.secrets.includes(id), id);
assert.throws(() => new Engine({ ...JSON.parse(JSON.stringify(t.state)), secrets: ['not-a-secret'] }), /隠し要素/);

console.log(JSON.stringify({ ok: true, ladder: D.ladder.map(r => `${r.count} ${r.label}`), stages: stages.length, tracks: tracks.length, interiors: Object.values(D.maps).filter(m => m.interior).length, trainers: Object.keys(D.rivals).length }));
