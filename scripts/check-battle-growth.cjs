#!/usr/bin/env node
'use strict';
// Participants receive full combat XP and direct growth on level-up. Living
// companions present at battle start receive 20% XP with normal growth only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),context=vm.createContext({console});
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
for(const script of scripts){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],context);if(context.LT?.Engine)break;
}
const {Engine,DATA:D,KasaiRules}=context.LT,copy=value=>JSON.parse(JSON.stringify(value));
const finalForms=['komorizen','shizunaria','akehomura'];
const futoStats={hp:1000,atk:300,def:100,spAtk:300,spDef:100,speed:200,accuracy:100,evasion:100};
const BATTLE_GAINS={hp:2,atk:1,def:1,spAtk:1,spDef:1,speed:1};
const NO_BATTLE_GAINS={hp:0,atk:0,def:0,spAtk:0,spDef:0,speed:0};
const BASE_GAINS={hp:5,atk:3,def:2,spAtk:3,spDef:2,speed:2};
const COMBAT_GAINS={hp:7,atk:4,def:3,spAtk:4,spDef:3,speed:3};
function game(ids=finalForms){
  const e=new Engine();assert(e.newGame('komori').ok);e.rng=()=>.5;
  e.state.party=ids.map(id=>e.makeMonster(id,50));e.state.storage=[e.makeMonster('fuwari',50)];
  for(const mon of [...e.state.party,...e.state.storage])e.markCaught(mon.species);
  return e;
}
const xp=e=>copy(e.state.party.map(mon=>mon.xp));
const growth=e=>copy(e.state.party.map(mon=>mon.battleGrowth||0));
const allocationTotals=e=>copy(e.state.party.map(mon=>e.allocationInfo(mon).total));
const progress=e=>copy(e.state.party.map(mon=>({uid:mon.uid,species:mon.species,level:mon.level,xp:mon.xp,battleGrowth:mon.battleGrowth||0,bonusPoints:mon.bonusPoints||0,stats:e.stats(mon),total:e.allocationInfo(mon).total})));
function nearLevelUp(e,{level=7,training=false}={}){
  for(const mon of e.state.party){mon.level=level;mon.xp=e.xpToNext(level)-1;e.restoreMonster(mon);if(training)mon.heldItem='trainband';}
  return allocationTotals(e);
}
function assertLevelEvent(events,mon,{level=mon.level,points=2,battleGains=BATTLE_GAINS,gains=COMBAT_GAINS}={}){
  const event=events.find(event=>event.kind==='level'&&event.uid===mon.uid&&event.levelUp.level===level);
  assert(event,`Missing Lv.${level} event for ${mon.uid}`);assert.equal(event.levelUp.points,points);
  assert.deepEqual(event.levelUp.battleGains&&copy(event.levelUp.battleGains),battleGains);assert.deepEqual(copy(event.levelUp.gains),gains);
  assert(!Object.hasOwn(event.levelUp,'pointSources'),'Participation must not be represented as allocation-point sources');return event;
}
function assertPermanentGrowth(e,mon,count){
  const plain=copy(mon);delete plain.battleGrowth;const base=e.stats(plain),actual=e.stats(mon);
  for(const [key,perLevel]of Object.entries(BATTLE_GAINS))assert.equal(actual[key],base[key]+count*perLevel,`${mon.species}: ${key}`);
  assert.equal(actual.accuracy,base.accuracy);assert.equal(actual.evasion,base.evasion);
}
function attack(e){const index=e.moves(e.state.party[e.battle.activeIndex]).findIndex(move=>move.kind==='attack'&&move.accuracy>=60);assert(index>=0);return {type:'move',index};}
function knockOut(e){e.battle.enemy.hp=1;const result=e.action(attack(e));assert(result.ok);assert.equal(e.battle.enemy.hp,0);return result;}

test('the first living participant receives 1.5x XP and a living waiting member receives 20%; fainted and stored members receive none',()=>{
  const e=game();e.state.party[0].hp=0;const stored=JSON.stringify(e.state.storage),waiting=copy(e.state.party[2]);
  assert(e.startBattle('komori',1));assert.equal(e.battle.activeIndex,1);assert.deepEqual(copy(e.battle.xpPartyUids),e.state.party.map(mon=>mon.uid));knockOut(e);
  assert.deepEqual(xp(e),[0,63,13]);assert.equal(e.state.party[0].hp,0);assert.deepEqual(copy(e.state.party[2]),{...waiting,xp:13});
  assert.deepEqual(growth(e),[0,0,0],'Winning without a level-up does not itself add permanent growth');
  assert.equal(JSON.stringify(e.state.storage),stored);assert.doesNotThrow(()=>new Engine(e.serialize()));
});

test('voluntary switches reward each participating UID once while the identical unused individual receives only shared XP',()=>{
  const e=game(['komorizen','komorizen','komorizen']);assert(e.startBattle('komori',1));
  for(const index of [1,0,1])assert(e.action({type:'switch',index}).ok);
  assert(!e.action({type:'switch',index:8}).ok);assert(!e.action({type:'switch',index:1}).ok);knockOut(e);assert.deepEqual(xp(e),[63,63,13]);
  const before=JSON.stringify(e.state);e.defeatOpponent([]);e.endBattle('won',[]);assert(!e.action({type:'move',index:0}).ok);assert.equal(JSON.stringify(e.state),before);
});

test('battle XP passes the exact full or shared amount and an explicit combat-growth flag for each eligible UID',()=>{
  const e=game(['komorizen','komorizen','komorizen']),calls=[],giveXP=e.giveXP;
  e.giveXP=function(mon,amount,events,options){calls.push({uid:mon.uid,amount,options:options&&copy(options)});return giveXP.call(this,mon,amount,events,options);};
  assert(e.startBattle('komori',1));for(const index of [1,0,1])assert(e.action({type:'switch',index}).ok);knockOut(e);
  assert.deepEqual(calls,e.state.party.map((mon,index)=>({uid:mon.uid,amount:index<2?63:12.6,options:{battleParticipation:index<2}})));assert.deepEqual(xp(e),[63,63,13]);
});

test('shared level-ups add only normal stats and 2 or training-band 3 points while participating level-ups retain direct combat growth',()=>{
  for(const training of [false,true]){
    const e=game(),before=nearLevelUp(e,{training}),control=game();control.state.party[0]=copy(e.state.party[0]);
    e.state.party[2].battleGrowth=2;e.restoreMonster(e.state.party[2]);
    const mon=e.state.party[0],normal=control.state.party[0],waiting=copy(e.state.party.slice(1)),normalEvents=[];
    assert(e.startBattle('komori',1));const result=knockOut(e);control.giveXP(normal,63,normalEvents);
    assert.equal(mon.level,8);assert.equal(normal.level,8);assert.equal(mon.xp,62);assert.equal(normal.xp,62);
    for(const [index,old]of waiting.entries()){
      const member=e.state.party[index+1];assert.equal(member.level,8);assert.equal(member.xp,12);assert.equal(member.battleGrowth||0,old.battleGrowth||0);
      for(const [key,gain]of Object.entries(BASE_GAINS))assert.equal(e.stats(member)[key]-e.stats(old)[key],gain);
      assert.equal(e.allocationInfo(member).total-before[index+1],training?3:2);assert.equal(member.bonusPoints||0,training?1:0);
      assertLevelEvent(result.events,member,{points:training?3:2,battleGains:NO_BATTLE_GAINS,gains:BASE_GAINS});
    }
    assert.equal(mon.battleGrowth,1);assert.equal(normal.battleGrowth||0,0);const actual=e.stats(mon),baseline=control.stats(normal);
    for(const [key,value]of Object.entries(BATTLE_GAINS))assert.equal(actual[key]-baseline[key],value,key);
    assert.equal(actual.accuracy,baseline.accuracy);assert.equal(actual.evasion,baseline.evasion);
    assert.equal(e.allocationInfo(mon).total-before[0],training?3:2);assert.equal(e.allocationInfo(mon).total,control.allocationInfo(normal).total);
    assert.equal(mon.bonusPoints||0,training?1:0);assert.equal(mon.bonusPoints||0,normal.bonusPoints||0);
    assertLevelEvent(result.events,mon,{points:training?3:2});assertLevelEvent(normalEvents,normal,{points:training?3:2,battleGains:NO_BATTLE_GAINS,gains:BASE_GAINS});
  }
});

test('a large reward applies each participating combat level once and shared normal levels once without extra allocation points',()=>{
  for(const training of [false,true]){
    const e=game();nearLevelUp(e,{training});for(const mon of e.state.party){mon.xp=0;mon.bonusPoints=7;}
    const mon=e.state.party[0],before=e.allocationInfo(mon).total,waiting=copy(e.state.party.slice(1));
    const amount=[7,8,9].reduce((sum,level)=>sum+e.xpToNext(level),0),events=[];assert(e.startBattle('komori',1));e.awardBattleXP(amount,events);
    assert.equal(mon.level,11);assert.equal(mon.xp,36);assert.equal(mon.battleGrowth,4);assertPermanentGrowth(e,mon,4);
    for(const [index,old]of waiting.entries()){
      const member=e.state.party[index+1];assert.equal(member.level,8);assert.equal(member.xp,0);assert.equal(member.battleGrowth||0,0);
      assert.equal(member.bonusPoints,7+(training?1:0));assert.equal(e.allocationInfo(member).total-e.allocationInfo(old).total,training?3:2);
      assertLevelEvent(events,member,{points:training?3:2,battleGains:NO_BATTLE_GAINS,gains:BASE_GAINS});
    }
    assert.equal(mon.bonusPoints,7+(training?4:0));assert.equal(e.allocationInfo(mon).total-before,4*(training?3:2));assert.equal(events.filter(event=>event.kind==='level'&&event.uid===mon.uid).length,4);
    for(let level=8;level<=11;level++)assertLevelEvent(events,mon,{level,points:training?3:2});
    const once=JSON.stringify(e.state),eventCount=events.length;e.awardBattleXP(amount,events);assert.equal(JSON.stringify(e.state),once);assert.equal(events.length,eventCount);
  }
});

test('switching identical species gives direct growth to both participating UIDs and only ordinary growth to the unused UID',()=>{
  const e=game(['komorizen','komorizen','komorizen']),before=nearLevelUp(e),uids=e.state.party.map(mon=>mon.uid);
  assert.equal(new Set(uids).size,3);assert(e.startBattle('komori',1));for(const index of [1,0,1])assert(e.action({type:'switch',index}).ok);
  const result=knockOut(e);assert.deepEqual(e.state.party.map(mon=>mon.uid),uids);assert.deepEqual(growth(e),[1,1,0]);assert.deepEqual(xp(e),[62,62,12]);
  assert.deepEqual(e.state.party.map(mon=>mon.level),[8,8,8]);assert.deepEqual(allocationTotals(e).map((total,index)=>total-before[index]),[2,2,2]);
  for(const mon of e.state.party.slice(0,2)){assertPermanentGrowth(e,mon,1);assertLevelEvent(result.events,mon);}
  assertLevelEvent(result.events,e.state.party[2],{battleGains:NO_BATTLE_GAINS,gains:BASE_GAINS});
});

test('the next opponent resets participation but retains the original sharing roster; choosing a replacement itself awards nothing',()=>{
  const e=game();nearLevelUp(e);assert(e.startTeamBattle([{species:'komori',level:1},{species:'shizuku',level:1}]));const starting=copy(e.battle.xpPartyUids);
  const first=knockOut(e);assert.deepEqual(e.state.party.map(mon=>mon.level),[8,8,8]);assert.deepEqual(growth(e),[1,0,0]);assert.deepEqual(xp(e),[38,7,7]);assertLevelEvent(first.events,e.state.party[0]);
  for(const mon of e.state.party)mon.xp=e.xpToNext(mon.level)-1;
  const previous=progress(e);assert(e.chooseReplacement(1).ok);assert.deepEqual(progress(e),previous);assert.deepEqual(copy(e.battle.xpParticipants),[e.state.party[1].uid]);assert.deepEqual(copy(e.battle.xpPartyUids),starting);
  const second=knockOut(e);assert.deepEqual(e.state.party.map(mon=>mon.level),[9,9,9]);assert.deepEqual(growth(e),[1,1,0]);assert.deepEqual(xp(e),[12,62,12]);assertLevelEvent(second.events,e.state.party[1]);
  for(const index of [0,2])assertLevelEvent(second.events,e.state.party[index],{battleGains:NO_BATTLE_GAINS,gains:BASE_GAINS});
});

test('the learning sash multiplies both full and shared XP with one final rounding',()=>{
  const e=game();e.state.party[0].heldItem='learnsash';e.state.party[1].heldItem='learnsash';assert(e.startBattle('komori',1));knockOut(e);
  assert.deepEqual(xp(e),[95,19,13],'Shared base12.6 is multiplied before rounding, not rounded to13 then multiplied');assert(e.state.party.every(mon=>Number.isSafeInteger(mon.xp)));assert.doesNotThrow(()=>new Engine(e.serialize()));
});

test('each enemy starts a new XP participation set and free replacements cannot retroactively upgrade an earlier shared reward',()=>{
  const e=game();assert(e.startTeamBattle([{species:'komori',level:1},{species:'shizuku',level:2},{species:'hibana',level:3}]));knockOut(e);assert.deepEqual(xp(e),[39,8,8]);
  const first=JSON.stringify(e.state);e.defeatOpponent([]);e.endOfTurn([]);assert(!e.action({type:'switch',index:1}).ok);assert(!e.chooseReplacement(6).ok);assert.equal(JSON.stringify(e.state),first);
  assert(e.chooseReplacement(1).ok);assert.deepEqual(xp(e),[39,8,8]);knockOut(e);assert.deepEqual(xp(e),[49,56,18]);
  assert(e.chooseReplacement().ok);assert(e.action({type:'switch',index:2}).ok);knockOut(e);assert.deepEqual(xp(e),[68,149,111]);assert.equal(e.battle.result,'won');
  const final=JSON.stringify(e.state);e.defeatOpponent([]);e.endBattle('won',[]);assert(!e.chooseReplacement(0).ok);assert.equal(JSON.stringify(e.state),final);
});

test('a fainted participant retains its direct growth through evolution and save restoration without reviving',()=>{
  const e=game();e.state.party[0]=e.makeMonster('komori',7);const first=e.state.party[0],uid=first.uid;first.xp=58;first.hp=1;assert(e.startBattle('komori',1));
  e.battle.enemy=e.makeMonster('futo',1,{...futoStats,atk:9999,spAtk:9999,speed:9999});assert(e.action(attack(e)).ok);assert.equal(first.hp,0);assert(e.battle.pendingReplacement.allyRequired);
  assert(e.chooseReplacement(1).ok);e.battle.enemy.customStats.speed=1;const result=knockOut(e);
  assert.equal(first.uid,uid);assert.equal(first.species,'komorion');assert.equal(first.level,8);assert.equal(first.xp,13);assert.equal(first.hp,0);assert.equal(first.battleGrowth,1);
  assert.equal(first.bonusPoints||0,0);assert.equal(e.allocationInfo(first).total,14);assertPermanentGrowth(e,first,1);assertLevelEvent(result.events,first);assert.equal(e.state.party[1].xp,63);assert.equal(e.state.party[2].xp,13);
  const restored=new Engine(e.serialize()),saved=restored.state.party.find(mon=>mon.uid===uid);assert(saved);assert.equal(saved.species,'komorion');assert.equal(saved.level,8);assert.equal(saved.hp,0);assert.equal(saved.battleGrowth,1);assertPermanentGrowth(restored,saved,1);
});

test('simultaneous recoil knockout rewards the fainted participant once and does not keep rewarding it against later opponents',()=>{
  const e=game();assert(e.startTeamBattle([{species:'komori',level:1},{species:'shizuku',level:1}]));const first=e.state.party[0];first.hp=1;for(const move of e.moves(first))first.pp[move.id]=0;e.battle.enemy.hp=1;
  const result=e.action({type:'struggle'});assert(result.ok);assert.equal(first.hp,0);assert.deepEqual(xp(e),[39,8,8]);assert.equal(result.events.filter(event=>event.kind==='reward').length,1);
  const once=JSON.stringify(e.state);e.defeatOpponent([]);assert.equal(JSON.stringify(e.state),once);assert(e.chooseReplacement(1).ok);knockOut(e);assert.deepEqual(xp(e),[39,71,21]);assert.equal(first.hp,0);
});

test('normal captures share XP with the starting party but exclude the newly caught member and storage',()=>{
  const e=game();assert(e.startBattle('hibana',1));e.rng=()=>0;const stored=JSON.stringify(e.state.storage),result=e.action({type:'resonate'});assert(result.ok);assert.equal(result.ended,'caught');
  assert.deepEqual(xp(e),[63,13,13,0]);const caught=e.state.party[3];assert.equal(caught.level,1);assert.equal(caught.battleGrowth||0,0);assert(!e.battle.xpPartyUids.includes(caught.uid));assert.equal(JSON.stringify(e.state.storage),stored);
  const once=JSON.stringify(e.state);assert(!e.action({type:'resonate'}).ok);e.endBattle('caught',[]);assert.equal(JSON.stringify(e.state),once);
  const full=game([...finalForms,...finalForms]);assert(full.startBattle('hibana',1));full.rng=()=>0;assert(full.action({type:'resonate'}).ok);assert.deepEqual(xp(full),[63,13,13,13,13,13]);
  assert.equal(full.state.storage[1].level,1);assert.equal(full.state.storage[1].xp,0);assert.equal(full.state.storage[1].battleGrowth||0,0);
});

test('secret captures also share with the original party and exclude the newly caught individual',()=>{
  const e=game(),owner={id:'P0123456789abcdef',isAdmin:true};assert(e.startAdminEncounter('komori',1,owner).ok);assert(e.action({type:'resonate'}).ok);
  assert.deepEqual(xp(e),[63,13,13,0]);assert.equal(e.state.party[3].level,1);assert.equal(e.state.party[3].battleGrowth||0,0);assert(!e.battle.xpPartyUids.includes(e.state.party[3].uid));
});

test('reviving a waiting member enables only shared XP and a new battle cannot reuse previous participants',()=>{
  const e=game(),members=e.state.party.slice();members[2].hp=0;assert(e.startBattle('komori',1));assert(e.action({type:'item',id:'tonic',index:2}).ok);assert(members[2].hp>0);assert(!e.battle.xpParticipants.includes(members[2].uid));knockOut(e);assert.deepEqual(xp(e),[63,13,13]);
  assert(e.finishBattle().ok);assert(e.setLead(2).ok);assert(e.startBattle('komori',1));knockOut(e);assert.deepEqual(members.map(mon=>mon.xp),[76,26,76]);
  const saved=e.serialize();assert(!Object.hasOwn(saved,'xpParticipants'));assert(!Object.hasOwn(saved,'xpPartyUids'));assert.equal(new Engine(saved).battle,null);
});

test('trainer rewards retain full participant XP and share with living bench members before the final party heal',()=>{
  const guardian=Object.keys(D.guardians)[0],rival=Object.keys(D.rivals)[0],elite=Object.keys(D.elites)[0];
  for(const [kind,base]of [['guardian',190],['rematch',114],['rival',124],['elite',250],['champion',250],['tower',134]]){
    const e=game();e.state.party[2].hp=0;assert(e.startTeamBattle([{species:'komori',level:3}],['guardian','rematch'].includes(kind)?guardian:null));
    if(kind==='rematch')e.battle.rematch=true;if(kind==='rival')e.battle.rival=rival;if(kind==='elite')e.battle.elite=elite;if(kind==='champion')e.battle.champion=D.champion.id;if(kind==='tower')e.battle.towerFloor=1;
    knockOut(e);assert.deepEqual(xp(e),[Math.round(base*1.5),Math.round(base*.3),0],kind);assert(e.state.party.every(mon=>mon.hp===e.stats(mon).hp),'Trainer rescue after reward cannot make a fainted bench member eligible retroactively');
  }
});

test('Lv100 participants and waiting companions receive no new XP, direct growth or allocation, including pending evolutions',()=>{
  const e=game();e.state.party[0]=e.makeMonster('komori',100);const mon=e.state.party[0],uid=mon.uid;mon.heldItem='trainband';mon.bonusPoints=23;mon.battleGrowth=23;const before=e.allocationInfo(mon).total;
  e.state.party[1]=e.makeMonster('shizunaria',100);e.state.party[1].heldItem='trainband';e.state.party[1].battleGrowth=17;e.state.party[1].bonusPoints=12;const waiting=copy(e.state.party[1]);
  assert(e.startBattle('komori',1));const result=knockOut(e);assert.equal(mon.level,100);assert.equal(mon.xp,0);assert.equal(mon.uid,uid);assert.equal(mon.species,'komorizen');assert.equal(mon.battleGrowth,23);assertPermanentGrowth(e,mon,23);
  assert.equal(mon.bonusPoints,23);assert.equal(e.allocationInfo(mon).total,before);assert(!result.events.some(event=>event.kind==='level'&&event.uid===uid));assert.deepEqual(xp(e),[0,0,13]);assert.deepEqual(copy(e.state.party[1]),waiting);
});

test('configured Futo gains direct stats only from participation; shared XP keeps its base and allocation rules',()=>{
  for(const training of [false,true]){
    const e=game();assert(e.grantFuto({grantId:'growth-v79-'+training,level:7,stats:futoStats}).ok);assert(e.setLead(3).ok);const mon=e.state.party[0],reference=copy(mon.customStats);mon.xp=58;if(training)mon.heldItem='trainband';
    const baseline=copy(mon),normalEvents=[];assert(e.startBattle('komori',1));const result=knockOut(e);e.giveXP(baseline,63,normalEvents);
    assert.equal(mon.level,8);assert.equal(mon.xp,13);assert.equal(mon.battleGrowth,1);assert.deepEqual(copy(mon.customStats),reference);assertPermanentGrowth(e,mon,1);
    assert.equal(e.stats(mon).hp,1007);assert.equal(e.stats(mon).atk,304);assert.equal(e.stats(mon).def,103);assert.equal(e.stats(mon).speed,203);
    for(const [key,value]of Object.entries(BATTLE_GAINS))assert.equal(e.stats(mon)[key]-e.stats(baseline)[key],value);
    assert.equal(e.allocationInfo(mon).total,0);assert.equal(mon.bonusPoints||0,0);assertLevelEvent(result.events,mon,{points:0});assertLevelEvent(normalEvents,baseline,{points:0,battleGains:NO_BATTLE_GAINS,gains:BASE_GAINS});
    const restored=new Engine(e.serialize()),saved=restored.state.party.find(member=>member.uid===mon.uid);assert.equal(saved.battleGrowth,1);assertPermanentGrowth(restored,saved,1);
    const bench=game();assert(bench.grantFuto({grantId:'growth-v82-shared-'+training,level:7,stats:futoStats}).ok);
    const waiting=bench.state.party[3];waiting.xp=bench.xpToNext(waiting.level)-1;if(training)waiting.heldItem='trainband';
    const oldStats=copy(bench.stats(waiting));assert(bench.startBattle('komori',1));const shared=knockOut(bench);
    assert.equal(waiting.level,8);assert.equal(waiting.xp,12);assert.equal(waiting.battleGrowth||0,0);assert.equal(waiting.bonusPoints||0,0);assert.equal(bench.allocationInfo(waiting).total,0);assert.deepEqual(copy(waiting.customStats),reference);
    for(const [key,gain]of Object.entries(BASE_GAINS))assert.equal(bench.stats(waiting)[key]-oldStats[key],gain);
    assertLevelEvent(shared.events,waiting,{points:0,battleGains:NO_BATTLE_GAINS,gains:BASE_GAINS});
  }
});

test('direct XP defaults to normal growth even for an active participant and preserves previously earned battle growth',()=>{
  for(const training of [false,true]){
    const e=game();nearLevelUp(e,{training});for(const mon of e.state.party){mon.xp=0;mon.battleGrowth=3;e.restoreMonster(mon);}
    const before=allocationTotals(e),events=[];assert(e.startBattle('komori',1));assert(e.battle.xpParticipants.includes(e.state.party[0].uid));
    e.giveXP(e.state.party[0],e.xpToNext(7),events);e.giveXP(e.state.party[1],e.xpToNext(7),events,{battleParticipation:false});
    for(const index of [0,1]){
      const mon=e.state.party[index];assert.equal(mon.level,8);assert.equal(mon.xp,0);assert.equal(mon.battleGrowth,3);assertPermanentGrowth(e,mon,3);assert.equal(e.allocationInfo(mon).total-before[index],training?3:2);assert.equal(mon.bonusPoints||0,training?1:0);
      assertLevelEvent(events,mon,{points:training?3:2,battleGains:NO_BATTLE_GAINS,gains:BASE_GAINS});
    }
    assert.equal(e.state.party[2].level,7);assert.equal(e.allocationInfo(e.state.party[2]).total,before[2]);
  }
});

test('combat growth remains independent of the capped training allocation bonus',()=>{
  const e=game();nearLevelUp(e,{training:true});const mon=e.state.party[0];mon.xp=0;mon.bonusPoints=998;const before=e.allocationInfo(mon).total,events=[];
  e.giveXP(mon,e.xpToNext(7)+e.xpToNext(8),events,{battleParticipation:true});assert.equal(mon.level,9);assert.equal(mon.bonusPoints,999);assert.equal(mon.battleGrowth,2);assertPermanentGrowth(e,mon,2);assert.equal(e.allocationInfo(mon).total-before,5);
  for(const event of events.filter(event=>event.kind==='level'))assert.deepEqual(copy(event.levelUp.battleGains),BATTLE_GAINS);
  const restored=new Engine(e.serialize()),saved=restored.state.party.find(member=>member.uid===mon.uid);assert.equal(saved.bonusPoints,999);assert.equal(saved.battleGrowth,2);assertPermanentGrowth(restored,saved,2);
});

test('the final participating level reaches growth99 once and further XP at Lv100 adds nothing',()=>{
  const e=game();nearLevelUp(e,{level:99,training:true});const mon=e.state.party[0];mon.battleGrowth=98;e.restoreMonster(mon);const before=e.allocationInfo(mon).total,events=[];
  e.giveXP(mon,e.xpToNext(99)*10,events,{battleParticipation:true});assert.equal(mon.level,100);assert.equal(mon.xp,0);assert.equal(mon.battleGrowth,99);assertPermanentGrowth(e,mon,99);assert.equal(mon.bonusPoints,1);assert.equal(e.allocationInfo(mon).total-before,3);
  assert.equal(events.filter(event=>event.kind==='level'&&event.uid===mon.uid).length,1);assertLevelEvent(events,mon,{points:3});
  const once=JSON.stringify(mon),eventCount=events.length;e.giveXP(mon,999999,events,{battleParticipation:true});assert.equal(JSON.stringify(mon),once);assert.equal(events.length,eventCount);assert.doesNotThrow(()=>new Engine(e.serialize()));
});

test('direct growth and ordinary allocated points survive save/restore independently without persisting battle participation',()=>{
  const e=game();nearLevelUp(e,{training:true});assert(e.startBattle('komori',1));knockOut(e);assert(e.finishBattle().ok);const mon=e.state.party[0],uid=mon.uid;assert(e.allocate(0,'atk',10).ok);assert(e.allocate(0,'hp',5).ok);
  const before=copy(e.allocationInfo(mon)),stats=copy(e.stats(mon)),saved=e.serialize(),restored=new Engine(saved),member=restored.state.party.find(member=>member.uid===uid);
  assert.equal(member.battleGrowth,1);assert.equal(member.bonusPoints,1);assert.deepEqual(copy(member.alloc),{atk:10,hp:5});assert.deepEqual(copy(restored.allocationInfo(member)),before);assert.deepEqual(copy(restored.stats(member)),stats);assertPermanentGrowth(restored,member,1);
  assert.equal(before.total,15);assert.equal(before.used,15);assert.equal(before.free,0);assert.equal(restored.battle,null);assert(!Object.hasOwn(saved,'xpParticipants'));assert(!Object.hasOwn(member,'xpParticipants'));
});

test('legacy saves without battle growth remain zero and valid counters persist in party, storage and battle enrollment',()=>{
  const e=game(),legacy=e.serialize(),baseStats=copy(e.state.party.map(mon=>e.stats(mon))),restored=new Engine(legacy);assert.deepEqual(growth(restored),[0,0,0]);assert.deepEqual(copy(restored.state.party.map(mon=>restored.stats(mon))),baseStats);
  for(const [level,count]of [[1,0],[50,0],[50,49],[100,99]]){
    const state=copy(legacy),mon=e.makeMonster('komorizen',level);mon.battleGrowth=count;state.party[0]=copy(mon);state.storage[0].battleGrowth=49;const loaded=new Engine(state);
    assert.equal(loaded.state.party[0].battleGrowth||0,count);assertPermanentGrowth(loaded,loaded.state.party[0],count);assert.equal(loaded.state.storage[0].battleGrowth,49);const enrolled=KasaiRules.normalizeParty([copy(mon)]);assert.equal(enrolled[0].battleGrowth||0,count);
  }
});

test('combat-growth saves use version5 while untrained version1 through version4 saves keep their original abilities',()=>{
  const e=game(),legacy=e.serialize(),before=copy(e.state.party.map(mon=>e.stats(mon)));assert.equal(legacy.version,4);
  for(const version of [1,2,3,4]){
    const restored=new Engine({...copy(legacy),version});assert.deepEqual(growth(restored),[0,0,0]);assert.deepEqual(copy(restored.state.party.map(mon=>restored.stats(mon))),before);
  }
  e.state.party[0].battleGrowth=1;const trained=e.serialize();assert.equal(trained.version,5);
  const restored=new Engine(trained);assert.equal(restored.state.party[0].battleGrowth,1);assert.equal(restored.serialize().version,5);assertPermanentGrowth(restored,restored.state.party[0],1);
  const storageOnly=game();storageOnly.state.storage[0].battleGrowth=1;assert.equal(storageOnly.serialize().version,5);
  assert.equal(new Engine(storageOnly.serialize()).state.storage[0].battleGrowth,1);
});

test('saved and enrolled battle-growth counters reject negative, fractional, nonnumeric, over-cap and over-level values',()=>{
  const e=game(),saved=e.serialize(),invalid=[-1,.5,50,99,100,Number.MAX_SAFE_INTEGER,null,'1',true,{},[],NaN,Infinity];
  for(const value of invalid){
    for(const location of ['party','storage']){const state=copy(saved);state[location][0].battleGrowth=value;assert.throws(()=>new Engine(state),`${location}: ${String(value)}`);}
    const mon=copy(saved.party[0]);mon.battleGrowth=value;assert.throws(()=>KasaiRules.normalizeParty([mon]),`enrollment: ${String(value)}`);
  }
  const low=e.makeMonster('komorizen',1);low.battleGrowth=1;assert.throws(()=>KasaiRules.normalizeParty([copy(low)]),'A Lv1 individual cannot already have one battle level-up');
});

test('escape, loss and repeated victory or capture resolution cannot add unearned XP or growth',()=>{
  for(const ending of ['fled','lost']){const e=game();nearLevelUp(e,{training:true});const before=progress(e),events=[];assert(e.startBattle('komori',1));e.endBattle(ending,events);assert.deepEqual(progress(e),before);assert(!events.some(event=>event.kind==='level'));}
  const e=game();nearLevelUp(e,{training:true});assert(e.startTeamBattle([{species:'komori',level:1},{species:'shizuku',level:1}]));knockOut(e);const earned=progress(e);assert(e.chooseReplacement(1).ok);e.endBattle('lost',[]);assert.deepEqual(progress(e),earned);
  for(const capture of [false,true]){
    const rewarded=game();nearLevelUp(rewarded,{training:true});assert(rewarded.startBattle('hibana',1));if(capture){rewarded.rng=()=>0;assert.equal(rewarded.action({type:'resonate'}).ended,'caught');}else knockOut(rewarded);
    const once=JSON.stringify(rewarded.state),repeated=[];rewarded.awardBattleXP(999999,repeated);rewarded.defeatOpponent(repeated);rewarded.endBattle(capture?'caught':'won',repeated);assert.equal(JSON.stringify(rewarded.state),once);assert.equal(repeated.length,0);
  }
});

test('a link-battle victory remains at Lv50 and does not award adventure XP or direct growth to the save',()=>{
  const source=scripts.find(script=>script[2].includes('class Duel {'));assert(source);vm.runInContext(source[2],context);const e=game();e.state.party[0].battleGrowth=12;
  const before=JSON.stringify(e.state),duel=context.LT.Duel.create({mode:'single',teams:[finalForms,['komori','fuwari','kirari']],seed:5});duel._random=()=>.5;duel.state.teams[1].monsters.forEach((mon,index)=>{mon.hp=index===0?1:0;});
  const orders=[0,1].map(side=>[{type:'move',slot:0,move:duel.moves(duel.active(side)[0]).findIndex(move=>move.kind==='attack'),target:0}]);duel.resolve(orders);assert.equal(duel.state.winner,0);
  assert(duel.state.teams.every(team=>team.monsters.every(mon=>mon.level===50&&!Object.hasOwn(mon,'xp')&&(mon.battleGrowth||0)===0)));assert.equal(JSON.stringify(e.state),before);
});

test('sharing follows the original party UIDs and excludes later arrivals and individuals moved to storage',()=>{
  const e=game(),starting=e.state.party.map(mon=>mon.uid);assert(e.startBattle('komori',1));assert.deepEqual(copy(e.battle.xpPartyUids),starting);
  const moved=e.state.party[1],arrived=e.state.storage.shift();e.state.storage.push(moved);e.state.party[1]=arrived;
  const sameSpecies=e.makeMonster('komorizen',50);e.state.party.push(sameSpecies);e.markCaught(sameSpecies.species);
  const stored=JSON.stringify(e.state.storage);knockOut(e);assert.deepEqual(xp(e),[63,0,13,0]);assert.equal(JSON.stringify(e.state.storage),stored);
  assert.equal(moved.xp,0);assert.equal(arrived.xp,0);assert.equal(sameSpecies.xp,0);assert.deepEqual(copy(e.battle.xpPartyUids),starting);
  assert(e.finishBattle().ok);assert.doesNotThrow(()=>new Engine(e.serialize()));
});

test('a shared-only level-up can evolve and save normally without adding combat growth or upgrading a legacy save version',()=>{
  const e=game();e.state.party[0]=e.makeMonster('komorizen',100);e.state.party[1]=e.makeMonster('komori',7);
  const mon=e.state.party[1],uid=mon.uid;mon.xp=e.xpToNext(7)-1;mon.heldItem='trainband';
  assert(e.startBattle('komori',1));const result=knockOut(e);assert.equal(mon.uid,uid);assert.equal(mon.level,8);assert.equal(mon.species,'komorion');assert.equal(mon.xp,12);
  assert.equal(mon.battleGrowth||0,0);assert.equal(mon.bonusPoints,1);assert.equal(e.allocationInfo(mon).total,15);assertLevelEvent(result.events,mon,{points:3,battleGains:NO_BATTLE_GAINS,gains:BASE_GAINS});
  assert(e.finishBattle().ok);const saved=e.serialize();assert.equal(saved.version,4);assert(!Object.hasOwn(saved,'xpPartyUids'));const restored=new Engine(saved);
  assert.deepEqual(copy(restored.state.party.find(member=>member.uid===uid)),copy(mon));assert.equal(restored.battle,null);
});

test('retired CPU Kasai challenge versions retain participant-only XP despite the new sharing roster',()=>{
  for(const rulesVersion of [KasaiRules.version,KasaiRules.legacyVersion]){
    const e=game();nearLevelUp(e,{training:true});const party=copy(KasaiRules.normalizeParty(e.state.party));
    const challenge={id:'growth-legacy-kasai',token:'growth-legacy-token-12345678',seed:57,rulesVersion,party,
      ...(rulesVersion===KasaiRules.version?{opponents:copy(KasaiRules.normalizeParty([e.makeMonster('komori',1)]))}:{})};
    assert(e.startKasaiBattle(challenge).ok);assert(e.battle.kasai);assert.deepEqual(copy(e.battle.xpPartyUids),party.map(mon=>mon.uid));
    const waiting=copy(e.state.party.slice(1)),events=[];e.awardBattleXP(42,events);
    assert.equal(e.state.party[0].level,8);assert.equal(e.state.party[0].xp,62);assert.equal(e.state.party[0].battleGrowth,1);assertLevelEvent(events,e.state.party[0],{points:3});
    assert.deepEqual(copy(e.state.party.slice(1)),waiting,'Previously recorded CPU battles must not gain new bench XP, levels or points');
    const once=JSON.stringify(e.state),count=events.length;e.awardBattleXP(42,events);assert.equal(JSON.stringify(e.state),once);assert.equal(events.length,count);
  }
});
