#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),context=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],context);if(context.LT?.Engine)break;
}
const {Engine,DATA:D}=context.LT,copy=value=>JSON.parse(JSON.stringify(value));
const base={hp:1000,atk:300,def:100,spAtk:300,spDef:100,speed:200,accuracy:100,evasion:100};
function game(){
  const e=new Engine();assert(e.newGame('komori').ok);e.rng=()=>.5;
  e.state.party=[e.makeMonster('futo',50,base),e.makeMonster('komori',20),e.makeMonster('shizuku',20)];
  for(const mon of e.state.party)e.markCaught(mon.species);
  return e;
}
function team(e){
  assert(e.startTeamBattle([{species:'komori',level:1},{species:'shizuku',level:1}]));
  return e.battle;
}
function wild(e,stats={}){
  assert(e.startBattle('komori',50));e.battle.enemy=e.makeMonster('futo',50,{...base,...stats});return e.battle;
}
function emptyPP(e,mon){for(const move of e.moves(mon))mon.pp[move.id]=0;}

// The outgoing enemy remains the displayed combatant until confirmation.
let e=game(),b=team(e),outgoing=b.enemy,nextEnemy=b.enemyTeam[1];outgoing.hp=1;
let result=e.action({type:'move',index:0});assert(result.ok);assert.equal(b.enemy,outgoing);assert.equal(outgoing.hp,0);
assert.equal(b.enemyIndex,0);assert.equal(b.activeIndex,0);assert.deepEqual(copy(b.pendingReplacement),{enemyIndex:1,allyRequired:false});
assert(!result.events.some(event=>event.kind==='switch'));
const faint=result.events.find(event=>event.kind==='faint');assert(faint);assert.equal(faint.side,'enemy');
assert.equal(faint.visual.enemy.uid,outgoing.uid);assert.equal(faint.visual.enemy.hp,0);assert.notEqual(faint.visual.enemy,outgoing);
assert.equal(faint.visual.activeIndex,0);assert.notEqual(faint.visual.ally,e.state.party[0]);
const once=copy(e.state),turn=b.turn,logs=b.log.length;
e.defeatOpponent([]);assert.deepEqual(copy(e.state),once);assert.equal(b.log.length,logs,'The defeated enemy awards XP once');
for(const command of [{type:'move',index:0},{type:'switch',index:1},{type:'item',id:'salve',index:0},{type:'resonate'},{type:'flee'}]){
  assert(!e.action(command).ok);assert.deepEqual(copy(e.state),once);assert.equal(b.turn,turn);
}
for(const invalid of [-1,3,1.5,'1',NaN,null]){assert(!e.chooseReplacement(invalid).ok);assert.equal(b.enemy,outgoing);assert.equal(b.activeIndex,0);}
const chosenBefore=copy(e.state.party[2]);result=e.chooseReplacement(2);assert(result.ok);
assert.equal(b.activeIndex,2);assert.equal(b.enemy,nextEnemy);assert.equal(b.enemyIndex,1);assert.equal(b.pendingReplacement,undefined);
assert.equal(b.turn,turn);assert.deepEqual(copy(e.state.party[2]),chosenBefore,'Replacement never gives the opponent an extra attack');
assert.deepEqual(copy(result.events.map(event=>event.side)),['ally','enemy']);
assert.equal(result.events[0].visual.enemy.uid,outgoing.uid);assert.equal(result.events[1].visual.enemy.uid,nextEnemy.uid);
assert.equal(faint.visual.enemy.hp,0);assert.equal(faint.visual.enemy.uid,outgoing.uid,'Presentation snapshots survive later changes');
assert(!e.chooseReplacement(1).ok);

// Keeping the healthy active monster is an explicit, free between-enemies choice.
e=game();b=team(e);b.stages.ally.atk=2;b.enemy.hp=0;e.defeatOpponent([]);const active=e.state.party[0],allyHP=active.hp;
result=e.chooseReplacement();assert(result.ok);assert.equal(b.activeIndex,0);assert.equal(active.hp,allyHP);assert.equal(b.turn,0);
assert.equal(b.stages.ally.atk,2);assert(result.events.every(event=>event.side==='enemy'));

// A defeated ally stays in its original slot; the player chooses any living bench.
e=game();b=wild(e,{atk:9999,speed:9999});e.state.party[0].hp=1;e.state.party[1].hp=0;
const usedPP=e.state.party[0].pp.futo_breaker;result=e.action({type:'move',index:0});assert(result.ok);
assert.equal(e.state.party[0].hp,0);assert.equal(e.state.party[0].pp.futo_breaker,usedPP,'A slower defeated ally cannot execute its queued move');
assert.equal(b.activeIndex,0);assert.deepEqual(copy(b.pendingReplacement),{enemyIndex:null,allyRequired:true});
assert(!e.chooseReplacement().ok);assert(!e.chooseReplacement(0).ok);assert(!e.chooseReplacement(1).ok);
const replacementHP=e.state.party[2].hp,forcedTurn=b.turn,enemyHP=b.enemy.hp;
result=e.chooseReplacement(2);assert(result.ok);assert.equal(b.activeIndex,2);assert.equal(b.turn,forcedTurn);
assert.equal(e.state.party[2].hp,replacementHP);assert.equal(b.enemy.hp,enemyHP);assert.equal(result.events[0].forced,true);

// Player recoil can knock out both sides: one choice replaces both, with one XP award.
e=game();b=team(e);e.state.party[0].hp=1;emptyPP(e,e.state.party[0]);b.enemy.hp=1;outgoing=b.enemy;
result=e.action({type:'struggle'});assert(result.ok);assert.equal(e.state.party[0].hp,0);assert.equal(outgoing.hp,0);
assert.equal(b.activeIndex,0);assert.equal(b.enemy,outgoing);assert.deepEqual(copy(b.pendingReplacement),{enemyIndex:1,allyRequired:true});
assert.equal(result.events.filter(event=>event.kind==='reward').length,1);
assert.equal(result.events.filter(event=>event.kind==='faint').length,2);assert(!e.chooseReplacement().ok);
assert(e.chooseReplacement(2).ok);assert.equal(b.activeIndex,2);assert.equal(b.enemyIndex,1);

// Enemy recoil is resolved before a slower ally's queued attack. It must not
// award XP twice, attack the defeated enemy or hit the next enemy on entry.
for(const knockOutAlly of [false,true]){
  e=game();b=team(e);b.enemy=e.makeMonster('futo',50,{...base,atk:knockOutAlly?9999:1,speed:9999});b.enemyTeam[0]=b.enemy;
  b.enemy.hp=1;emptyPP(e,b.enemy);if(knockOutAlly)e.state.party[0].hp=1;
  const beforePP=e.state.party[0].pp.futo_breaker;outgoing=b.enemy;
  result=e.action({type:'move',index:0});assert(result.ok);assert.equal(outgoing.hp,0);assert.equal(b.enemy,outgoing);
  assert.equal(e.state.party[0].pp.futo_breaker,beforePP);assert.equal(result.events.filter(event=>event.kind==='damage').length,1);
  assert.equal(result.events.filter(event=>event.kind==='reward').length,1);assert.equal(b.pendingReplacement.allyRequired,knockOutAlly);
  assert(e.chooseReplacement(knockOutAlly?2:undefined).ok);assert.equal(b.enemy.hp,e.stats(b.enemy).hp);
}

// A normal voluntary switch still consumes a turn and permits an enemy attack.
e=game();b=wild(e,{atk:1,spAtk:1,speed:1});const targetHP=e.state.party[2].hp;b.stages.ally.atk=3;
result=e.action({type:'switch',index:2});assert(result.ok);assert.equal(b.activeIndex,2);assert.equal(b.turn,1);
assert(e.state.party[2].hp<targetHP);assert.equal(b.stages.ally.atk,0);assert.equal(result.events[0].side,'ally');

// The last knockout ends normally; no selection can revive an exhausted team.
for(const bench of [true,false]){
  e=game();if(!bench)e.state.party=e.state.party.slice(0,1);b=wild(e,{speed:1,def:1,spDef:1});b.enemy.hp=1;
  e.state.party[0].hp=1;emptyPP(e,e.state.party[0]);result=e.action({type:'struggle'});
  assert(result.ok);assert.equal(b.result,bench?'won':'lost');assert.equal(b.pendingReplacement,undefined);assert(!e.chooseReplacement(0).ok);
}

// Party ordering moves existing objects without changing their battle/save data.
e=game();e.state.party[1].hp=0;e.state.party[2].nickname='みず';e.state.party[2].shiny=true;e.state.party[2].pp[D.species.shizuku.moves[0]]=1;
const original=e.state.party.slice(),values=new Map(original.map(mon=>[mon.uid,copy(mon)]));
assert(e.moveParty(2,0).ok);assert.deepEqual(e.state.party.map(mon=>mon.uid),[original[2].uid,original[0].uid,original[1].uid]);
assert.equal(e.state.party[0],original[2]);assert(e.moveParty(2,1).ok);assert.equal(e.state.party[1],original[1]);assert.equal(e.state.party[1].hp,0);
for(const mon of e.state.party)assert.deepEqual(copy(mon),values.get(mon.uid));
const order=e.state.party.map(mon=>mon.uid),saved=e.serialize();assert.deepEqual(copy(new Engine(saved).state.party.map(mon=>mon.uid)),order);
assert(e.moveParty(1,1).unchanged);assert.deepEqual(e.state.party.map(mon=>mon.uid),order);
for(const pair of [[-1,0],[0,3],[0,1.5],['1',0],[0,null]]){assert(!e.moveParty(...pair).ok);assert.deepEqual(e.state.party.map(mon=>mon.uid),order);}
assert(e.startBattle('komori',1));assert(!e.moveParty(0,1).ok);assert.deepEqual(e.state.party.map(mon=>mon.uid),order);
assert(!new Engine().moveParty(0,0).ok);
console.log('Battle transition checks passed: held KO snapshots, selected/kept/forced replacements, simultaneous recoil, one XP reward, normal switch cost, final KO, party order and save fidelity.');
