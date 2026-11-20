#!/usr/bin/env node
'use strict';
// The hidden lineage uses the regular monster/save/evolution rules, while its
// catalog metadata keeps it out of the ordinary world and all exchange routes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const context=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],context);if(context.LT?.Engine)break;
}
const {LT}=context,{DATA:D,Engine}=LT,copy=value=>JSON.parse(JSON.stringify(value));
const ids=['nullmie','nullva','zeroveil'],names=['ヌルミィ','ヌルヴァ','ゼロヴェイル'];
assert.deepEqual(copy(D.glitchLine),{ids,starter:'nullmie',level:5});
assert.equal(D.elements.void.name,'無');assert.equal(D.elements.void.strongAgainst,null);assert.equal(D.elements.void.weakAgainst,null);
assert.equal(D.content.totalSpecies,256);assert.equal(D.content.dexSpecies,256);assert.equal(D.content.hiddenSpecies,12);assert.equal(D.content.playableSpecies,268);
assert.equal(D.content.species,254);assert.equal(D.content.specialSpecies,2);
assert.equal(Object.values(D.species).filter(s=>!s.hiddenDex).length,256);
assert.equal(Object.keys(D.species).length,268);assert.equal(Object.keys(D.moves).length,104);
assert.equal(Object.values(D.moves).filter(move=>!move.hiddenDex).length,96);assert.equal(D.content.moves,96);
const dedicated=['null_restore','null_curse','null_ray','null_scorch'];
assert.deepEqual(copy(D.hiddenMoves),dedicated);assert.equal(D.content.hiddenMoves,8);assert.equal(D.content.totalMoves,104);
const stats=['hp','atk','def','spAtk','spDef','speed'];
for(const [stage,id]of ids.entries()){
  const s=D.species[id];assert.equal(s.name,names[stage]);assert.equal(s.element,'void');
  assert(s.hiddenDex&&s.glitchOnly&&s.specialOnly);assert(!s.adminOnly);assert.equal(s.atlasNumber,undefined);
  assert.equal(s.moves.length,4);assert.equal(new Set(s.moves).size,4);
  assert.deepEqual(copy(s.moves),dedicated,'Every stage shares the same four dedicated move slots');
  assert(s.moves.every(mid=>D.moves[mid]?.hiddenDex&&D.moves[mid].role==='hidden'),'Dedicated moves remain hidden');
  assert.deepEqual([...s.moves].map(mid=>D.moves[mid].element),['void','void','void','ember']);
  assert(s.base.spAtk>s.base.atk);assert(stats.every(key=>Number.isInteger(s.base[key])&&s.base[key]>0));
  if(stage)assert(stats.every(key=>s.base[key]>D.species[ids[stage-1]].base[key]),'All six base stats grow with evolution');
  assert(Object.values(D.maps).every(map=>!map.encounters.includes(id)),'No ordinary wild encounter');
  for(const group of [D.rivals,D.guardians,D.elites,Object.fromEntries(D.champions.map(c=>[c.id,c]))])
    assert(Object.values(group).every(trainer=>trainer.species!==id&&!(trainer.team||[]).some(mon=>mon.species===id)),'No generated trainer owns an off-dex form');
  assert(!D.starters.includes(id));assert(!D.collectionRoutes.wild.includes(id));
  assert(Object.values(D.collectionRoutes.starters).every(line=>!line.includes(id)));
  const e=new Engine();assert(e.newGame('komori').ok);const mon=e.makeMonster(id,50);
  assert.equal(LT.TradeRules.isEligible(mon),false,'Both local and online exchanges use the blocked-species rule');
  assert.throws(()=>e.tradeMonster(mon),/交換/);
}
assert.equal(D.species.nullmie.evolvesTo,'nullva');assert.equal(D.species.nullmie.evolveLevel,24);
assert.equal(D.species.nullva.evolvesTo,'zeroveil');assert.equal(D.species.nullva.evolveLevel,48);assert(!D.species.zeroveil.evolvesTo);

// Real progression preserves identity, trained points, HP and the correct PP
// keys at both thresholds; hidden ownership must survive export/import.
const e=new Engine();assert(e.newGame('komori').ok);
const mon=e.makeMonster('nullmie',23);mon.nickname='ぬる';mon.shiny=true;mon.alloc={spAtk:20,hp:10};
e.state.party.push(mon);e.markCaught('nullmie');const uid=mon.uid,events=[];
e.giveXP(mon,e.xpToNext(23)-1,events);assert.equal(mon.species,'nullmie');
e.giveXP(mon,1,events);assert.equal(mon.level,24);assert.equal(mon.species,'nullva');
while(mon.level<47)e.giveXP(mon,e.xpToNext(mon.level),events);
assert.equal(mon.species,'nullva');e.giveXP(mon,e.xpToNext(47),events);
assert.equal(mon.level,48);assert.equal(mon.species,'zeroveil');
assert.equal(mon.uid,uid);assert.equal(mon.nickname,'ぬる');assert.equal(mon.shiny,true);assert.deepEqual(copy(mon.alloc),{spAtk:20,hp:10});
assert(mon.hp>0&&mon.hp<=e.stats(mon).hp);assert.equal(events.filter(event=>event.kind==='evolve').length,2);
assert.deepEqual(Object.keys(mon.pp),copy(D.species.zeroveil.moves));
assert(ids.every(id=>e.state.caught.includes(id)&&e.state.seen.includes(id)),'Acquisition history stays available to save validation');
const saved=e.serialize(),loaded=new Engine(saved);assert.deepEqual(copy(loaded.state.party[1]),copy(mon));
assert(ids.every(id=>loaded.state.caught.includes(id)));
const old=new Engine();old.newGame('komori');assert.doesNotThrow(()=>new Engine(old.serialize()),'An old adventure needs no new hidden flags');

// A held everstone delays both stages; high-level saved forms catch up once it
// is removed, even at Lv.100, using the same positive-XP path as other species.
const delayed=e.makeMonster('nullmie',100);delayed.heldItem='everpebble';e.state.storage.push(delayed);
e.giveXP(delayed,1,[]);assert.equal(delayed.species,'nullmie');
delete delayed.heldItem;e.giveXP(delayed,1,[]);assert.equal(delayed.species,'zeroveil');assert.equal(delayed.level,100);assert.equal(delayed.xp,0);
console.log(JSON.stringify({ok:true,hiddenSpecies:ids,dexSpecies:256,playableSpecies:268,publicMoves:96,hiddenMoves:8,totalMoves:104,evolutionLevels:[24,48],coverage:'void metadata, fixed hidden moves, no ordinary acquisition, no exchange, evolution identity and PP, allocation, save round-trip, everstone and level cap'}));
