#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),context=vm.createContext({console});
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
for(const script of scripts){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],context);if(context.LT?.Engine)break;
}
vm.runInContext(scripts.find(script=>script[2].includes('deterministic, save-independent rental-team duels.'))[2],context);
const {DATA:D,Engine,Duel}=context.LT,ids=['arvelion_rend','arvelion_nova','arvelion_crown','arvelion_renewal'];
const plain=value=>JSON.parse(JSON.stringify(value));
const grant={grantId:'admin-legendary:test-lamp',species:'arvelion',level:70};
function fight(){
  const e=new Engine();assert(e.newGame('komori').ok);assert(e.receiveAdminLegendary(grant).ok);
  e.state.party[1].nickname='ひのまもり';e.state.party[1].shiny=true;
  e.startBattle('arvelion',70);e.battle.activeIndex=1;e.rng=()=>.5;
  return {e,mon:e.state.party[1],enemy:e.battle.enemy};
}
function cast(e,a,b,id,side='ally'){const events=[];e.applyMove(a,b,D.moves[id],side,events);return events;}
function damage(id,guard){const {e,mon,enemy}=fight();e.battle.enemyGuard=guard;const hp=enemy.hp;cast(e,mon,enemy,id);return hp-enemy.hp;}
assert.deepEqual(plain(D.species.arvelion.moves),ids,'Move IDs must remain save-compatible');
assert(ids.every(id=>D.moves[id].element==='ember'));
assert.equal(D.elements.ember.name,'灯');
assert.equal(damage(ids[0],true),damage(ids[0],false),'Flaming talons must pierce a guard');
assert(Math.abs(damage(ids[1],false)-damage(ids[1],true)*2)<=1,'Special blaze obeys guard rounding');

let {e,mon,enemy}=fight();
let events=cast(e,mon,enemy,ids[2]);
assert(Object.values(e.battle.stages.ally).every(stage=>stage===1));assert.equal(e.battle.allyGuard,true);
assert.equal(events[0].raised,true);assert.equal(events[0].guard,true);assert.equal(mon.pp[ids[2]],2);
// Compare damage with identical defensive stages, varying only the protective flame.
const hp=mon.hp;cast(e,enemy,mon,ids[1],'enemy');const protectedDamage=hp-mon.hp;assert.equal(e.battle.allyGuard,false);
mon.hp=hp;cast(e,enemy,mon,ids[1],'enemy');assert(Math.abs((hp-mon.hp)-protectedDamage*2)<=1);
for(const key of Object.keys(e.battle.stages.ally))e.battle.stages.ally[key]=6;
mon.pp[ids[2]]=3;events=cast(e,mon,enemy,ids[2]);
assert.equal(events[0].raised,false);assert.equal(events[0].changed,true);assert.equal(e.battle.allyGuard,true);
events=cast(e,mon,enemy,ids[2]);assert.equal(events[0].changed,false);assert(Object.values(e.battle.stages.ally).every(stage=>stage===6));
mon.hp=1;cast(e,mon,enemy,ids[3]);assert.equal(mon.hp,1+Math.ceil(e.stats(mon).hp*.65));
mon.hp=e.stats(mon).hp-1;cast(e,mon,enemy,ids[3]);assert.equal(mon.hp,e.stats(mon).hp,'Recovery cannot exceed maximum HP');
// Existing captures keep their identity and exact remaining PP while definitions update.
e.battle=null;mon.pp={arvelion_rend:2,arvelion_nova:0,arvelion_crown:1,arvelion_renewal:3};
const saved=e.serialize(),serialized=JSON.stringify(saved),restored=new Engine(saved),loaded=restored.state.party[1];
assert.equal(JSON.stringify(saved),serialized);assert.deepEqual(plain(loaded.pp),plain(mon.pp));
assert.equal(loaded.nickname,'ひのまもり');assert.equal(loaded.shiny,true);assert.equal(loaded.grantId,grant.grantId);
assert(restored.moves(loaded).every(move=>move.element==='ember'));assert(!serialized.includes('"stages"'));

const config={mode:'single',seed:519270,teams:[['arvelion','komori','shizuku'],['arvelion','hibana','komori']]};
function duel(){return new Duel(config);}
function apply(d,side,index){
  const actor=d.active(side)[0];
  d._apply({side,slot:0,target:0,technique:D.moves[ids[index]]},actor);return actor;
}
function duelDamage(index,guard){const d=duel(),target=d.active(1)[0];d._random=()=>.5;target.guard=guard;const hp=target.hp;apply(d,0,index);return hp-target.hp;}
assert.equal(duelDamage(0,true),duelDamage(0,false));
assert(Math.abs(duelDamage(1,false)-duelDamage(1,true)*2)<=1);
const d=duel();d._random=()=>.5;const actor=apply(d,0,2);
assert(Object.values(actor.stages).every(stage=>stage===1));assert.equal(actor.guard,true);
const current=actor.hp;apply(d,1,1);const reduced=current-actor.hp;assert.equal(actor.guard,false);
actor.hp=current;apply(d,1,1);assert(Math.abs((current-actor.hp)-reduced*2)<=1);
for(const key of Object.keys(actor.stages))actor.stages[key]=6;
actor.pp[ids[2]]=3;apply(d,0,2);assert.equal(d.state.events.at(-1).raised,false);assert.equal(d.state.events.at(-1).changed,true);
apply(d,0,2);assert.equal(d.state.events.at(-1).changed,false);
actor.hp=1;apply(d,0,3);assert.equal(actor.hp,1+Math.ceil(actor.maxHp*.65));
actor.hp=actor.maxHp-1;apply(d,0,3);assert.equal(actor.hp,actor.maxHp);
// Two independent clients execute the same complete turn sequence identically.
const left=duel(),right=duel();
for(const moves of [[2,2],[0,1],[3,3]]){
  const orders=moves.map(index=>[{slot:0,type:'move',move:index,target:0}]);
  left.resolve(orders);right.resolve(plain(orders));assert.equal(left.fingerprint(),right.fingerprint());
}
const fingerprint=Duel.rulesFingerprint(),crown=D.moves[ids[2]];crown.effect='allStats';
assert.notEqual(Duel.rulesFingerprint(),fingerprint,'Protective flame must affect online compatibility');crown.effect='allStatsGuard';
assert.equal(Duel.rulesFingerprint(),fingerprint);
console.log('Arvelion lamp moves passed: ember type, piercing/guard damage, seven-stat boost plus one-hit protection, capped recasts, 65% recovery/clamp, PP and save identity, solo/duel parity and deterministic clients.');
