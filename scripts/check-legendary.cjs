#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const context=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],context);if(context.LT?.Engine)break;
}
const {Engine,DATA:D}=context.LT,L=D.legendary;
const make=()=>{const e=new Engine();assert(e.newGame(D.starters[0]).ok);return e;};
const copy=value=>JSON.parse(JSON.stringify(value));
const entitlement={grantId:'admin-legendary:player-test',species:'arvelion',level:70};
function sequence(e,values){let index=0;e.rng=()=>{assert(index<values.length,'Unexpected extra RNG call');return values[index++];};return()=>index;}
function position(e,map,{grass=false}={}){
  e.state.map=map.id;e.state.seals=Object.keys(D.guardians);
  for(let y=0;y<map.height;y++)for(let x=0;x<map.width-1;x++){
    if(!e.walkable(map,x,y)||!e.walkable(map,x+1,y)||map.exits.some(exit=>exit.x===x+1&&exit.y===y))continue;
    if(grass&&map.tiles[y][x+1]!==':')continue;
    if(!grass&&map.tiles[y][x+1]===':')continue;
    e.state.x=x;e.state.y=y;return true;
  }
  return false;
}

assert.equal(L.encounterOdds,700);assert.equal(L.rollUnit,'successful-walking-step');
assert.equal(L.minLevel,70);assert.equal(L.maxLevel,70,'Wild legendary level is fixed at 70');
assert.equal(L.species,'arvelion');assert.equal(D.content.species,254);assert.equal(D.content.totalSpecies,256);
assert.equal(D.species.arvelion.rarity,'legendary');assert(!D.species.arvelion.evolvesTo);assert(!D.species.arvelion.specialOnly);
assert(Object.values(D.maps).every(map=>!map.encounters.includes('arvelion')),'Separate rare roll must not leak into normal pools');
for(const species of Object.values(D.species).filter(species=>species.id!=='arvelion'))for(const [stat,value]of Object.entries(species.base)){
  assert(D.species.arvelion.base[stat]>=value,`Strongest fixed base ${stat}: ${species.id}`);
}
assert.equal(new Set(D.species.arvelion.moves).size,4);
assert.equal(D.species.arvelion.element,'ember');
assert(D.species.arvelion.moves.every(id=>D.moves[id].element==='ember'),'All four legendary techniques are lamp type');
assert.equal(D.moves.arvelion_rend.category,'physical');assert.equal(D.moves.arvelion_nova.category,'special');

// A successful step rolls on all maps, even indoors and during grass cooldown.
let mapsChecked=0;
for(const map of Object.values(D.maps)){
  const e=make();assert(position(e,map),`Need an ordinary path on ${map.id}`);
  e.encounterCooldown=99;const before=e.state.steps,calls=sequence(e,[0,.999999,.5]);
  const result=e.move(1,0);
  assert(result.ok&&result.battleStarted&&result.legendaryEncounter,map.id);
  assert.equal(e.battle.enemy.species,'arvelion');assert.equal(e.battle.enemy.level,70);
  assert.equal(e.state.map,map.id);assert.equal(e.state.steps,before+1);assert.equal(calls(),3);
  mapsChecked++;
}

// Deterministic probability boundary: exactly one of 700 equally spaced rolls.
let e=make(),legendaryCount=0;assert(position(e,D.maps.village));
const origin={x:e.state.x,y:e.state.y};
for(let i=0;i<700;i++){
  e.battle=null;Object.assign(e.state,origin);e.encounterCooldown=99;
  const calls=sequence(e,i===0?[0,0,.5]:[i/700]);
  const result=e.move(1,0);if(result.legendaryEncounter)legendaryCount++;
  assert.equal(calls(),i===0?3:1);
  if(i===0)assert.equal(e.battle.enemy.level,70);
}
assert.equal(legendaryCount,1);
for(const [roll,expected]of [[1/700-Number.EPSILON,true],[1/700,false]]){
  e.battle=null;Object.assign(e.state,origin);sequence(e,expected?[roll,0,.5]:[roll]);
  assert.equal(!!e.move(1,0).legendaryEncounter,expected);
}

// Blocked / invalid steps, unopened gates and battle-time actions do not roll.
e=make();e.rng=()=>{throw Error('An unsuccessful step must not roll');};
assert(!e.move(0,0).ok);
e.state.x=-1;e.state.y=0;assert(!e.move(-1,0).ok);
e.battle={};assert(!e.move(1,0).ok);
const unstarted=new Engine();unstarted.rng=e.rng;assert(!unstarted.move(1,0).ok);
e=make();let testedLockedGate=false;
for(const map of Object.values(D.maps)){
  if(testedLockedGate)break;e.state.map=map.id;
  for(const exit of map.exits){
    if(!exit.requires||!e.walkable(map,exit.x-1,exit.y)||!e.walkable(map,exit.x,exit.y))continue;
    e.state.x=exit.x-1;e.state.y=exit.y;e.rng=()=>{throw Error('A locked gate must not roll');};
    const steps=e.state.steps;assert(!e.move(1,0).ok);assert.equal(e.state.steps,steps);testedLockedGate=true;break;
  }
}
assert(testedLockedGate);

// A map arrival is one step and one legendary roll, using the destination map.
e=make();e.state.seals=Object.keys(D.guardians);let testedExit=false;
for(const map of Object.values(D.maps)){
  if(testedExit)break;e.state.map=map.id;
  for(const exit of map.exits){
    const x=exit.x-1,y=exit.y;if(!e.walkable(map,x,y)||!e.walkable(map,exit.x,exit.y))continue;
    e.state.x=x;e.state.y=y;const calls=sequence(e,[0,0,.5]);
    const result=e.move(1,0);assert(result.mapChanged&&result.legendaryEncounter);assert.equal(e.state.map,exit.to);assert.equal(calls(),3);
    testedExit=true;break;
  }
}
assert(testedExit);

// Missing the rare roll retains normal grass chance and original species pool.
e=make();const grassy=Object.values(D.maps).find(map=>map.encounters.length&&position(e,map,{grass:true}));assert(grassy);
e.encounterCooldown=0;let calls=sequence(e,[1/700,0,0,0,.5]);
assert(e.move(1,0).battleStarted);assert(grassy.encounters.includes(e.battle.enemy.species));assert.equal(calls(),5);
e=make();assert(position(e,grassy,{grass:true}));e.encounterCooldown=0;calls=sequence(e,[1/700,.18]);
assert(!e.move(1,0).battleStarted);assert.equal(calls(),2,'The normal 18% boundary remains exclusive');
e=make();assert(position(e,grassy,{grass:true}));e.encounterCooldown=2;calls=sequence(e,[1/700]);
assert(!e.move(1,0).battleStarted);assert.equal(calls(),1,'Grass cooldown suppresses only the ordinary encounter roll');
e=make();assert(position(e,grassy,{grass:true}));e.encounterCooldown=0;calls=sequence(e,[0,0,0]);
assert(e.move(1,0).legendaryEncounter);assert(e.battle.enemy.shiny);assert.equal(calls(),3,'One shiny roll and no extra normal encounter roll');

// Capture rates scale from 1% at full health to exactly 6% at one HP.
e=make();e.rng=()=>.5;e.startBattle('arvelion',70);let mon=e.battle.enemy;
assert.equal(e.resonanceChance(),.01);mon.hp=Math.floor(e.stats(mon).hp/2);
assert(e.resonanceChance()>.03&&e.resonanceChance()<.04);mon.hp=1;assert(Math.abs(e.resonanceChance()-.06)<1e-12);
e.rng=()=>0;mon.shiny=true;assert(e.action({type:'resonate'}).ok);assert.equal(e.battle.result,'caught');
assert(e.finishBattle().ok);mon=e.state.party[1];assert.equal(mon.species,'arvelion');assert(mon.shiny);assert(!mon.grantId);
assert(e.renameMonster(mon.uid,'ほしのりゅ').ok);assert.equal(new Engine(e.serialize()).state.party[1].nickname,'ほしのりゅ');
e.rng=()=>.5;e.startBattle('komori',5);assert.equal(e.resonanceChance(),.28);
e.startTeamBattle([{species:'arvelion',level:70}],Object.keys(D.guardians)[0]);assert.equal(e.resonanceChance(),0);

// All four initial moves execute with finite PP and normal combat semantics.
e=make();e.receiveAdminLegendary(entitlement);mon=e.state.party[1];e.rng=()=>.5;e.startBattle('arvelion',70);e.battle.activeIndex=1;
for(const id of ['arvelion_rend','arvelion_nova']){
  e.battle.enemy.hp=e.stats(e.battle.enemy).hp;const before=e.battle.enemy.hp,pp=mon.pp[id];
  e.applyMove(mon,e.battle.enemy,D.moves[id],'ally',[]);assert(e.battle.enemy.hp<before);assert.equal(mon.pp[id],pp-1);
}
e.applyMove(mon,e.battle.enemy,D.moves.arvelion_crown,'ally',[]);
assert(Object.values(e.battle.stages.ally).every(stage=>stage===1));assert.equal(e.battle.allyGuard,true);
mon.hp=1;e.applyMove(mon,e.battle.enemy,D.moves.arvelion_renewal,'ally',[]);assert.equal(mon.hp,1+Math.ceil(e.stats(mon).hp*.65));
e.battle={log:[],result:'won'};e.giveXP(mon,1000000,[]);assert.equal(mon.level,100);assert.equal(mon.species,'arvelion');assert.equal(mon.xp,0);
e.battle=null;assert.equal(new Engine(e.serialize()).state.party[1].level,100);

// Administrator membership is authenticated by the API and recorded locally
// once. Repeated syncs, reloading and releasing never restore the same member.
e=make();assert(e.receiveAdminLegendary(entitlement).ok);assert(e.receiveAdminLegendary(entitlement).alreadyReceived);
assert.equal(e.state.party.length,2);assert.equal(e.state.party[1].grantId,entitlement.grantId);
e=new Engine(e.serialize());assert(e.receiveAdminLegendary(entitlement).alreadyReceived);
assert(e.releaseParty(1).ok);e=new Engine(e.serialize());assert(e.receiveAdminLegendary(entitlement).alreadyReceived);assert.equal(e.state.party.length,1);
assert(new Engine().receiveAdminLegendary(entitlement).pending);
for(const invalid of [null,{...entitlement,level:100},{...entitlement,species:'futo'},{...entitlement,grantId:'not-admin'},{...entitlement,grantId:'admin-legendary:'}])assert(!e.receiveAdminLegendary(invalid).ok);
e=make();e.battle={};assert(e.receiveAdminLegendary(entitlement).pending);assert.equal(e.state.giftReceipts.length,0);e.battle=null;
while(e.state.party.length<D.limits.party)e.state.party.push(e.makeMonster(D.starters[0],5));
assert.equal(e.receiveAdminLegendary(entitlement).destination,'storage');
const another={...entitlement,grantId:'admin-legendary:another-player'};
while(e.state.storage.length<D.limits.storage)e.state.storage.push(e.makeMonster(D.starters[0],5));
assert(e.receiveAdminLegendary(another).pending);assert(!e.state.giftReceipts.includes(another.grantId));
e.state.storage.pop();assert(e.receiveAdminLegendary(another).ok);
const raw=e.serialize(),invalidCustom=copy(raw);invalidCustom.storage[0].customStats=copy(D.species.futo.base);assert.throws(()=>new Engine(invalidCustom));
const invalidId=copy(raw);invalidId.storage[0].grantId='arbitrary-gift';assert.throws(()=>new Engine(invalidId));
assert.equal(e.quests().find(quest=>quest.id==='all-voices').target,250);
console.log(`Legendary checks passed: ${mapsChecked} maps, exact 1/700 walking roll, arrivals, independent shiny, 1–6% capture, all four moves, Lv100, save validation and once-only administrator membership.`);
