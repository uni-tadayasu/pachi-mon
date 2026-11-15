#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),context=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],context);if(context.LT?.Engine)break;
}
const {DATA:D,Engine,BattleStages:Stages,FutoRules}=context.LT;
const plain=x=>JSON.parse(JSON.stringify(x));
const defaults=['futo_breaker','futo_burst','futo_ascend','futo_restore'];
const legacy=['supernova','atlas_crystal_4','starlight','shell'];
const custom=['shell','supernova','starlight','atlas_crystal_4'];
const base={hp:1001,atk:100,def:100,spAtk:200,spDef:100,speed:100,accuracy:100,evasion:100};
function game(){const e=new Engine();e.newGame('komori');return e;}
function fight(foeStats={}){
  const e=game();assert(e.grantFuto({grantId:'admin-initial:test',level:50,stats:base}).ok);e.setLead(1);
  e.startBattle('komori',50);e.battle.enemy=e.makeMonster('futo',50,{...base,hp:99999,...foeStats});e.rng=()=>.5;
  return {e,ally:e.state.party[0],enemy:e.battle.enemy};
}
function cast(e,attacker,target,id,side='ally'){const events=[];e.applyMove(attacker,target,D.moves[id],side,events);return events;}
assert.equal(D.content.moves,104);assert.equal(Object.keys(D.moves).length,104);
assert.deepEqual(plain(D.species.futo.moves),defaults);
assert.deepEqual(plain(FutoRules.defaultMoves),defaults);
const values=defaults.map(id=>D.moves[id]);
assert.deepEqual(plain(values.map(m=>[m.kind,m.category,m.power,m.accuracy,m.pp])),[
  ['attack','physical',100,100,15],['attack','special',100,100,15],['boost','status',0,100,5],['heal','status',50,100,10]
]);
assert.equal(D.moves.futo_ascend.effect,'allStats');
assert.deepEqual(plain(FutoRules.normalizeMoves(legacy)),defaults);
assert.deepEqual(plain(FutoRules.normalizeMoves(custom)),custom);
assert.deepEqual(plain(FutoRules.normalizeMoves([...legacy].reverse())),[...legacy].reverse());

let {e,ally,enemy}=fight();
assert.deepEqual(plain(e.moveDetails(ally).map(m=>m.maxPP)),[15,15,5,10]);
const permanent=JSON.stringify(ally.customStats);
let events=cast(e,ally,enemy,'futo_ascend');
assert.equal(ally.pp.futo_ascend,4);assert.equal(events[0].kind,'boost');assert.equal(events[0].changed,true);
assert.equal(events[0].moveId,'futo_ascend');assert.equal(events[0].side,'ally');
assert.deepEqual(plain(e.battleStats(ally)),{hp:1001,atk:150,def:150,spAtk:300,spDef:150,speed:150,accuracy:133,evasion:133});
assert.deepEqual(plain(e.stats(ally)),base);assert.equal(JSON.stringify(ally.customStats),permanent);
assert(!JSON.stringify(e.serialize()).includes('"stages"'),'Battle stages must not enter saves');
for(let i=0;i<6;i++){ally.pp.futo_ascend=5;events=cast(e,ally,enemy,'futo_ascend');}
assert(Object.values(e.battle.stages.ally).every(n=>n===6));assert.equal(events[0].changed,false);
assert.equal(e.battleStats(ally).atk,400);assert.equal(e.battleStats(ally).accuracy,300);assert.equal(e.battleStats(ally).hp,1001);
const fresh=new Engine(e.serialize());assert.deepEqual(plain(fresh.stats(fresh.state.party[0])),base);assert.equal(fresh.battle,null);

({e,ally,enemy}=fight());
const damage=id=>{enemy.hp=99999;cast(e,ally,enemy,id);return 99999-enemy.hp;};
const physical=damage('futo_breaker'),special=damage('futo_burst');assert(special>physical,'Special and physical attacks use their corresponding ability');
cast(e,ally,enemy,'futo_ascend');const boosted=damage('futo_breaker');assert(boosted>physical,'Attack boost must increase actual damage');
e.resetBattleStages();cast(e,enemy,ally,'futo_ascend','enemy');assert(damage('futo_breaker')<physical,'Defense boost must reduce actual damage');

({e,ally,enemy}=fight({evasion:200}));e.rng=()=>.6;
assert(cast(e,ally,enemy,'futo_breaker').some(event=>event.kind==='miss'));
cast(e,ally,enemy,'futo_ascend');assert(cast(e,ally,enemy,'futo_breaker').some(event=>event.kind==='damage'));
cast(e,enemy,ally,'futo_ascend','enemy');assert(cast(e,ally,enemy,'futo_breaker').some(event=>event.kind==='miss'));

({e,ally,enemy}=fight({speed:120}));
const order=[],actualApply=e.applyMove.bind(e);e.applyMove=(a,d,m,side)=>order.push(side);e.enemyTurn=()=>order.push('enemy');
e.action({type:'move',index:0});assert.deepEqual(order,['enemy','ally']);order.length=0;
actualApply(ally,enemy,D.moves.futo_ascend,'ally',[]);e.action({type:'move',index:0});assert.deepEqual(order,['ally','enemy']);

({e,ally,enemy}=fight());cast(e,ally,enemy,'futo_ascend');e.enemyTurn=()=>{};
e.action({type:'switch',index:1});assert(Object.values(e.battle.stages.ally).every(n=>n===0));
e.action({type:'switch',index:0});assert.equal(e.battleStats(ally).atk,100);
cast(e,enemy,ally,'futo_ascend','enemy');enemy.hp=1;cast(e,ally,enemy,'futo_breaker');
assert.equal(enemy.hp,0);assert(Object.values(e.battle.stages.enemy).every(n=>n===0));
enemy.hp=99999;cast(e,ally,enemy,'futo_ascend');ally.hp=1;cast(e,enemy,ally,'futo_breaker','enemy');
assert.equal(ally.hp,0);assert(Object.values(e.battle.stages.ally).every(n=>n===0));
ally.hp=1001;cast(e,ally,enemy,'futo_ascend');e.endBattle('fled',[]);
assert(Object.values(e.battle.stages.ally).every(n=>n===0));assert.equal(e.battleStats(ally).atk,100);e.finishBattle();assert.equal(e.battle,null);

({e,ally,enemy}=fight());ally.hp=1;cast(e,ally,enemy,'futo_restore');assert.equal(ally.hp,502);assert.equal(ally.pp.futo_restore,9);
ally.hp=950;cast(e,ally,enemy,'futo_restore');assert.equal(ally.hp,1001);cast(e,ally,enemy,'futo_restore');assert.equal(ally.hp,1001);

e=game();e.grantFuto({grantId:'old',level:50,stats:base,moves:custom});
let old=e.serialize();old.party[1].customMoves=legacy;old.party[1].pp={supernova:4,atlas_crystal_4:7,starlight:8,shell:2};
const original=JSON.stringify(old);let migrated=new Engine(old),mon=migrated.state.party[1];
assert.equal(JSON.stringify(old),original,'Migration must not alter input data');
assert.deepEqual(plain(mon.customMoves),defaults);assert.deepEqual(plain(mon.pp),{futo_breaker:4,futo_burst:7,futo_ascend:5,futo_restore:2});
old.party[1].customMoves=custom;old.party[1].pp={shell:3,supernova:2,starlight:1,atlas_crystal_4:0};migrated=new Engine(old);mon=migrated.state.party[1];
assert.deepEqual(plain(mon.customMoves),custom);assert.deepEqual(plain(mon.pp),old.party[1].pp);
old.party[1].customMoves=legacy;old.party[1].pp={supernova:0,atlas_crystal_4:0,starlight:0,shell:0};
migrated=new Engine(old);assert(Object.values(migrated.state.party[1].pp).every(n=>n===0),'Migration must never refill exhausted PP');
mon=e.state.party[1];mon.customMoves=legacy;mon.pp={supernova:6,atlas_crystal_4:5,starlight:4,shell:3};e.syncPP(mon);
assert.deepEqual(plain(mon.customMoves),defaults);assert.deepEqual(plain(mon.pp),{futo_breaker:6,futo_burst:5,futo_ascend:4,futo_restore:3});

e=game();assert.equal(e.releaseParty(0).ok,false);assert.equal(e.releaseParty(-1).ok,false);assert.equal(e.releaseParty(1).ok,false);assert.equal(e.releaseParty(.5).ok,false);
e.grantFuto({grantId:'admin-initial:test',level:50,stats:base});e.state.party[1].hp=0;assert.equal(e.releaseParty(0).ok,false,'Keep last able member');
assert.equal(e.releaseParty(1).ok,true,'Fainted member may be released while an able member remains');
assert(e.state.caught.includes('futo'));assert(e.state.seen.includes('futo'));assert(e.state.giftReceipts.includes('admin-initial:test'));
assert.equal(e.updateOwnedFuto('admin-initial:test',{level:50,stats:base}).released,true);
assert.equal(e.grantFuto({grantId:'admin-initial:test',level:50,stats:base}).alreadyReceived,true);assert.equal(e.state.party.length,1);
assert.equal(e.updateOwnedFuto('unreceived',{level:50,stats:base}).pending,true);
e.grantFuto({grantId:'next',level:50,stats:base});e.startBattle('komori',3);assert.equal(e.releaseParty(1).ok,false);e.endBattle('fled',[]);assert.equal(e.releaseParty(1).ok,false);e.finishBattle();
const third=e.makeMonster('komori',5);e.state.party.push(third);e.state.party[0].hp=0;const survivor=e.state.party[1];
assert.equal(e.releaseParty(2).ok,true);assert.equal(e.state.party[0],survivor,'Lead must normalize to able remaining member');
assert.equal(e.state.party.length,2);new Engine(e.serialize());
console.log('Futo moves checks passed: four fixed moves/PP, seven-stage combat damage/hit/speed, capped boost and HP exclusion, reset lifecycle, safe legacy migration, party-release protections and gift sync.');
