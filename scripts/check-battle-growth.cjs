#!/usr/bin/env node
'use strict';
// Experience follows the individuals who actually entered each opponent's
// battle, while waiting party members and stored monsters retain their rules.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),context=vm.createContext({console});
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
for(const script of scripts){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],context);if(context.LT?.Engine)break;
}
const {Engine,DATA:D}=context.LT,copy=value=>JSON.parse(JSON.stringify(value));
const finalForms=['komorizen','shizunaria','akehomura'];
const futoStats={hp:1000,atk:300,def:100,spAtk:300,spDef:100,speed:200,accuracy:100,evasion:100};
function game(ids=finalForms){
  const e=new Engine();assert(e.newGame('komori').ok);e.rng=()=>.5;
  e.state.party=ids.map(id=>e.makeMonster(id,50));e.state.storage=[e.makeMonster('fuwari',50)];
  for(const mon of [...e.state.party,...e.state.storage])e.markCaught(mon.species);
  return e;
}
const points=e=>e.state.party.map(mon=>mon.xp);
function attack(e){const index=e.moves(e.state.party[e.battle.activeIndex]).findIndex(move=>move.kind==='attack'&&move.accuracy>=60);assert(index>=0);return {type:'move',index};}
function knockOut(e){e.battle.enemy.hp=1;const result=e.action(attack(e));assert(result.ok);assert.equal(e.battle.enemy.hp,0);return result;}

test('the first living individual gains 1.5x; waiting and fainted party members keep base XP, storage gains none',()=>{
  const e=game();e.state.party[0].hp=0;const stored=JSON.stringify(e.state.storage);
  assert(e.startBattle('komori',1));assert.equal(e.battle.activeIndex,1);knockOut(e);
  assert.deepEqual(points(e),[42,63,42]);assert.equal(e.state.party[0].hp,0);
  assert.equal(JSON.stringify(e.state.storage),stored);assert.doesNotThrow(()=>new Engine(e.serialize()));
});

test('voluntary switches credit each UID once, including identical species, without giving an unused slot a bonus',()=>{
  const e=game(['komorizen','komorizen','komorizen']);assert(e.startBattle('komori',1));
  for(const index of [1,0,1])assert(e.action({type:'switch',index}).ok);
  assert(!e.action({type:'switch',index:8}).ok);assert(!e.action({type:'switch',index:1}).ok);
  knockOut(e);assert.deepEqual(points(e),[63,63,42]);
  const before=JSON.stringify(e.state);e.defeatOpponent([]);e.endBattle('won',[]);
  assert(!e.action({type:'move',index:0}).ok);assert.equal(JSON.stringify(e.state),before,'Repeated inputs must not grant another reward');
});

test('participation and the learning sash multiply to 2.25x with one final integer rounding',()=>{
  const e=game();e.state.party[0].heldItem='learnsash';e.state.party[1].heldItem='learnsash';
  assert(e.startBattle('komori',1));knockOut(e);
  assert.deepEqual(points(e),[95,63,42]); // round(42 * 1.5 * 1.5), 42 * 1.5, 42
  assert(e.state.party.every(mon=>Number.isSafeInteger(mon.xp)));assert.doesNotThrow(()=>new Engine(e.serialize()));
});

test('each enemy starts a new participation set; free replacements cannot retroactively earn the previous reward',()=>{
  const e=game();assert(e.startTeamBattle([{species:'komori',level:1},{species:'shizuku',level:2},{species:'hibana',level:3}]));
  knockOut(e);assert.deepEqual(points(e),[39,26,26]);
  const first=JSON.stringify(e.state);e.defeatOpponent([]);e.endOfTurn([]);
  assert(!e.action({type:'switch',index:1}).ok);assert(!e.chooseReplacement(6).ok);assert.equal(JSON.stringify(e.state),first);
  assert(e.chooseReplacement(1).ok);assert.deepEqual(points(e),[39,26,26],'Choosing the next battler grants no XP');
  knockOut(e);assert.deepEqual(points(e),[71,74,58],'The first battler only receives base XP against the second opponent');
  assert(e.chooseReplacement().ok);assert(e.action({type:'switch',index:2}).ok);knockOut(e);
  assert.deepEqual(points(e),[133,167,151]);assert.equal(e.battle.result,'won');
  const final=JSON.stringify(e.state);e.defeatOpponent([]);e.endBattle('won',[]);assert(!e.chooseReplacement(0).ok);
  assert.equal(JSON.stringify(e.state),final);
});

test('forced replacement retains the fainted participant and does not revive it on level-up or evolution',()=>{
  const e=game();e.state.party[0]=e.makeMonster('komori',7);const first=e.state.party[0],uid=first.uid;
  first.xp=58;first.hp=1;assert(e.startBattle('komori',1));
  e.battle.enemy=e.makeMonster('futo',1,{...futoStats,atk:9999,spAtk:9999,speed:9999});
  assert(e.action(attack(e)).ok);assert.equal(first.hp,0);assert(e.battle.pendingReplacement.allyRequired);
  assert(e.chooseReplacement(1).ok);e.battle.enemy.customStats.speed=1;knockOut(e);
  assert.equal(first.uid,uid);assert.equal(first.species,'komorion');assert.equal(first.level,8);assert.equal(first.xp,13);assert.equal(first.hp,0);
  assert.equal(e.state.party[1].xp,63);assert.equal(e.state.party[2].xp,42);assert.doesNotThrow(()=>new Engine(e.serialize()));
});

test('a simultaneous recoil knockout pays once and switches participation only when the next enemy enters',()=>{
  const e=game();assert(e.startTeamBattle([{species:'komori',level:1},{species:'shizuku',level:1}]));
  const first=e.state.party[0];first.hp=1;for(const move of e.moves(first))first.pp[move.id]=0;e.battle.enemy.hp=1;
  const result=e.action({type:'struggle'});assert(result.ok);assert.equal(first.hp,0);
  assert.deepEqual(points(e),[39,26,26]);assert.equal(result.events.filter(event=>event.kind==='reward').length,1);
  const once=JSON.stringify(e.state);e.defeatOpponent([]);assert.equal(JSON.stringify(e.state),once);
  assert(e.chooseReplacement(1).ok);knockOut(e);assert.deepEqual(points(e),[81,89,68]);assert.equal(first.hp,0);
});

test('normal captures reward participants, never promote the newly caught individual to participant, and leave storage XP unchanged',()=>{
  const e=game();assert(e.startBattle('hibana',1));e.rng=()=>0;
  const stored=JSON.stringify(e.state.storage),result=e.action({type:'resonate'});assert(result.ok);assert.equal(result.ended,'caught');
  assert.deepEqual(points(e).slice(0,3),[63,42,42]);
  const caught=e.state.party[3];assert.equal(caught.level,2);assert.equal(caught.xp,6,'The newly caught member retains the original 42 XP, not 63');
  assert.equal(JSON.stringify(e.state.storage),stored);
  const once=JSON.stringify(e.state);assert(!e.action({type:'resonate'}).ok);e.endBattle('caught',[]);assert.equal(JSON.stringify(e.state),once);
  const full=game([...finalForms,...finalForms]);assert(full.startBattle('hibana',1));full.rng=()=>0;
  assert(full.action({type:'resonate'}).ok);assert.deepEqual(points(full),[63,42,42,42,42,42]);
  assert.equal(full.state.storage[1].level,1);assert.equal(full.state.storage[1].xp,0);
});

test('secret captures keep their existing new-member XP exclusion',()=>{
  const e=game(),owner={id:'P0123456789abcdef',isAdmin:true};assert(e.startAdminEncounter('komori',1,owner).ok);
  assert(e.action({type:'resonate'}).ok);assert.deepEqual(points(e),[63,42,42,0]);assert.equal(e.state.party[3].level,1);
});

test('healing a waiting member does not count as participation and a new battle cannot reuse earlier participants',()=>{
  const e=game(),members=e.state.party.slice();members[2].hp=0;assert(e.startBattle('komori',1));
  assert(e.action({type:'item',id:'tonic',index:2}).ok);assert(members[2].hp>0);knockOut(e);assert.deepEqual(points(e),[63,42,42]);
  assert(e.finishBattle().ok);assert(e.setLead(2).ok);assert(e.startBattle('komori',1));knockOut(e);
  assert.deepEqual(members.map(mon=>mon.xp),[105,84,105]);
  const saved=e.serialize();assert(!Object.hasOwn(saved,'xpParticipants'));assert.equal(new Engine(saved).battle,null);
});

test('guardian, rival, league, champion and tower final rewards keep their base amounts',()=>{
  const guardian=Object.keys(D.guardians)[0],rival=Object.keys(D.rivals)[0],elite=Object.keys(D.elites)[0];
  for(const [kind,base]of [['guardian',190],['rematch',114],['rival',124],['elite',250],['champion',250],['tower',134]]){
    const e=game();assert(e.startTeamBattle([{species:'komori',level:3}],['guardian','rematch'].includes(kind)?guardian:null));
    if(kind==='rematch')e.battle.rematch=true;
    if(kind==='rival')e.battle.rival=rival;if(kind==='elite')e.battle.elite=elite;
    if(kind==='champion')e.battle.champion=D.champion.id;if(kind==='tower')e.battle.towerFloor=1;
    knockOut(e);assert.deepEqual(points(e),[Math.round(base*1.5),base,base],kind);
    assert(e.state.party.every(mon=>mon.hp===e.stats(mon).hp),'Trainer rescue still heals the party');
  }
});

test('level cap, evolution identity, training points and configured Futo growth retain their existing behavior',()=>{
  let e=game();e.state.party[0]=e.makeMonster('komori',100);const capped=e.state.party[0],uid=capped.uid;
  assert(e.startBattle('komori',1));knockOut(e);assert.equal(capped.level,100);assert.equal(capped.xp,0);assert.equal(capped.uid,uid);assert.equal(capped.species,'komorizen');
  assert.equal(e.state.party[1].xp,42);
  e=game();e.state.party[0]=e.makeMonster('komori',7);const training=e.state.party[0];training.xp=58;training.heldItem='trainband';
  assert(e.startBattle('komori',1));const result=knockOut(e);assert.equal(training.level,8);assert.equal(training.xp,13);assert.equal(training.bonusPoints,1);
  assert.equal(e.allocationInfo(training).total,15);assert.equal(result.events.find(event=>event.kind==='level').levelUp.points,3);
  e=game();assert(e.grantFuto({grantId:'growth-v35',level:7,stats:futoStats}).ok);assert(e.setLead(3).ok);
  const futo=e.state.party[0],reference=copy(futo.customStats);futo.xp=58;assert(e.startBattle('komori',1));knockOut(e);
  assert.equal(futo.species,'futo');assert.equal(futo.level,8);assert.equal(futo.xp,13);assert.deepEqual(copy(futo.customStats),reference);
  assert.equal(e.stats(futo).hp,1005);assert.equal(e.stats(futo).atk,303);assert.equal(e.allocationInfo(futo).total,0);
  assert.doesNotThrow(()=>new Engine(e.serialize()));
});

test('fleeing and losing do not grant XP, while a previously earned opponent reward remains',()=>{
  for(const result of ['fled','lost']){
    const e=game();assert(e.startBattle('komori',1));e.endBattle(result,[]);assert.deepEqual(points(e),[0,0,0]);
  }
  const e=game();assert(e.startTeamBattle([{species:'komori',level:1},{species:'shizuku',level:1}]));knockOut(e);
  assert(e.chooseReplacement(1).ok);e.endBattle('lost',[]);assert.deepEqual(points(e),[39,26,26]);
});

test('a link-battle victory remains at Lv50 and does not grant adventure XP or mutate its save',()=>{
  const source=scripts.find(script=>script[2].includes('class Duel {'));assert(source);vm.runInContext(source[2],context);
  const e=game(),before=JSON.stringify(e.state),duel=context.LT.Duel.create({mode:'single',teams:[finalForms,['komori','fuwari','kirari']],seed:5});
  duel._random=()=>.5;duel.state.teams[1].monsters.forEach((mon,i)=>{mon.hp=i===0?1:0;});
  const orders=[0,1].map(side=>[{type:'move',slot:0,move:duel.moves(duel.active(side)[0]).findIndex(move=>move.kind==='attack'),target:0}]);
  duel.resolve(orders);assert.equal(duel.state.winner,0);
  assert(duel.state.teams.every(team=>team.monsters.every(mon=>mon.level===50&&!Object.hasOwn(mon,'xp'))));
  assert.equal(JSON.stringify(e.state),before);
});
