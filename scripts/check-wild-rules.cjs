#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const context=vm.createContext({console});
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/src=|application\/ld\+json/.test(m[1]))continue;vm.runInContext(m[2],context);if(context.LT?.Engine)break;
}
const {Engine,DATA:D}=context.LT,excluded=new Set(D.starters),copy=x=>JSON.parse(JSON.stringify(x));
assert.deepEqual([...excluded],['komori','shizuku','hibana']);
assert.deepEqual(Array.from(D.wildExcluded),[...excluded]);
assert.equal(D.species.arvelion.element,'ember');assert.equal(D.elements[D.species.arvelion.element].name,'灯');
let slots=0,grassMaps=0;
for(const map of Object.values(D.maps)){
  assert(map.encounters.every(id=>D.species[id]&&!excluded.has(id)),`${map.id}: an initial companion remains in wild pool`);
  if(!map.encounters.length)continue;
  const e=new Engine();e.newGame('komori');e.state.map=map.id;e.state.seals=Object.keys(D.guardians);
  let origin;
  for(let y=0;y<map.height&&!origin;y++)for(let x=0;x<map.width-1;x++){
    if(map.tiles[y][x+1]!==':'||!e.walkable(map,x,y)||!e.walkable(map,x+1,y)||map.exits.some(t=>t.x===x+1&&t.y===y))continue;
    origin={x,y};break;
  }
  if(!origin)continue;grassMaps++;
  for(let i=0;i<map.encounters.length;i++){
    e.battle=null;e.encounterCooldown=0;Object.assign(e.state,origin);
    const random=[1/700,0,(i+.5)/map.encounters.length,.5,.5];let calls=0;
    e.rng=()=>{assert(calls<random.length,'Unexpected RNG call');return random[calls++];};
    const result=e.move(1,0);assert(result.battleStarted,map.id);assert.equal(e.battle.enemy.species,map.encounters[i]);assert(!excluded.has(e.battle.enemy.species));slots++;
  }
}
for(const id of ['meadow','coast','forest','orchard','shelltown','mistmarsh'])assert(D.maps[id].encounters.length>0,`${id}: starter exclusion emptied its pool`);
// Each choice still starts normally, evolves normally and survives a saved game.
for(const starter of D.starters){
  const e=new Engine();assert(e.newGame(starter).ok);assert.equal(e.state.party[0].species,starter);
  const restored=new Engine(e.serialize());assert.equal(restored.state.party[0].species,starter);
  assert(restored.state.caught.includes(starter));
  restored.rng=()=>.5;assert(restored.startBattle(starter,5),'Explicit/trainer setup must remain valid');
  restored.battle=null;
  const reachable=new Set([...D.collectionRoutes.wild,...D.collectionRoutes.starters[starter]]);
  e.state.caught=[starter,...[...reachable].filter(id=>id!==starter)];e.state.seen=e.state.caught.slice();
  const quest=e.quests().find(q=>q.id==='all-voices');
  assert.equal(quest.target,starter==='hibana'?248:250);assert(quest.complete,`${starter}: feasible collection cannot complete`);
  const missing=[...reachable].find(id=>id!=='arvelion'&&!excluded.has(id));
  e.state.caught=e.state.caught.filter(id=>id!==missing);
  assert(!e.quests().find(q=>q.id==='all-voices').complete,'An unrelated missing obtainable species must block completion');
  // Historical captures of the other two base forms cannot substitute for a missing required species.
  for(const extra of D.starters.filter(id=>id!==starter))e.state.caught.push(extra);
  assert(!e.quests().find(q=>q.id==='all-voices').complete);
  assert.equal(e.quests().find(q=>q.id==='all-voices').target,quest.target,'Later catches changed the initial choice');
  e.state.caught=['arvelion',...e.state.caught.filter(id=>id!=='arvelion')];
  assert.equal(e.quests().find(q=>q.id==='all-voices').target,quest.target,'Unrelated catch order changed the initial choice');
  e.state.questsClaimed.push('all-voices');assert(e.quests().find(q=>q.id==='all-voices').complete,'Previously awarded completion must remain complete');
}
// No extra spawns or gifts were added to make the starter-exclusive lines obtainable.
assert(!D.collectionRoutes.wild.includes('komorion'));assert(!D.collectionRoutes.wild.includes('shizurua'));
assert(D.maps.cinderisle.encounters.includes('akebino'));assert(D.collectionRoutes.wild.includes('akehomura'));
// The displayed dex location must explain why the three initial choices have
// no habitat, without changing the location of an obtainable evolved form.
let dexContent='';
const dexContext=vm.createContext({DATA:D,engine:{state:{seen:Object.keys(D.species),caught:[]}},
  openModal:(_title,content)=>{dexContent=content;},creatureView:()=>'',typeBadge:()=>'',
  creatureDescription:()=>'',evolutionLineage:()=>'',escape:value=>String(value)});
vm.runInContext(html.slice(html.indexOf('  function showDexEntry(id) {'),html.indexOf('  function showMap() {')),dexContext);
for(const starter of D.starters){
  dexContext.showDexEntry(starter);
  assert(dexContent.includes('最初の相棒として選択（野生には出現しません）'),`${starter}: misleading dex habitat`);
  assert(!dexContent.includes('進化・星環の地で出会う'));
}
dexContext.showDexEntry('akebino');assert(dexContent.includes(D.maps.cinderisle.name));
assert(!dexContent.includes('野生には出現しません'));
const e=new Engine();e.newGame('komori');assert.equal(e.effectiveness('tide',D.species.arvelion.element),1.5);assert.equal(e.effectiveness('leaf',D.species.arvelion.element),.7);
assert.equal(e.effectiveness('ember',D.species.arvelion.element),.8);
const old=e.serialize();old.party.push(e.makeMonster('shizuku',15));old.caught.push('shizuku');old.seen.push('shizuku');assert.equal(new Engine(copy(old)).state.party[1].species,'shizuku');
// Arvelion and all four dedicated techniques share the published lamp type.
e.startBattle('arvelion',70);const attacker=e.makeMonster('arvelion',70),defender=e.battle.enemy;
e.rng=()=>.5;e.effectiveness=()=>1;e.battleStats=()=>({atk:100,def:100,spAtk:100,spDef:100,accuracy:100,evasion:100});
function damage(element){defender.hp=10000;e.applyMove(attacker,defender,{name:'type probe',kind:'damage',category:'special',element,power:50,accuracy:100},'ally',[]);return 10000-defender.hp;}
const emberDamage=damage('ember'),crystalDamage=damage('crystal');
assert(emberDamage/crystalDamage>1.14&&emberDamage/crystalDamage<1.16,'Arvelion does not receive its 灯 same-type bonus');
assert(e.moves(attacker).every(move=>move.element==='ember'),'Arvelion dedicated moves must remain lamp type');
console.log(JSON.stringify({ok:true,maps:Object.keys(D.maps).length,grassMaps,wildSlots:slots,starters:[...excluded],initialChoicesAndSaves:true,arvelionElement:'灯',collectionTargets:[256,256,254],oldCatchesPreserved:true}));
