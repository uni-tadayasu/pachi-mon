#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const context=vm.createContext({console});
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
for(const script of scripts){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],context);
  if(context.LT?.Engine)break;
}
const {Engine,DATA:D}=context.LT;
const clean=value=>JSON.parse(JSON.stringify(value));
const engine=()=>{const e=new Engine();e.newGame(D.starters[0]);return e;};
const stats={hp:5000,attack:420,defense:360,spAttack:520,spDefense:410,speed:260,accuracy:120,evasion:105};
const canonical={hp:5000,atk:420,def:360,spAtk:520,spDef:410,speed:260,accuracy:120,evasion:105};
// A genuinely customized ordering must survive the default-moves migration.
const moves=['supernova','atlas_crystal_4','shell','starlight'];
const grant=(id,overrides={})=>({grantId:id,species:'futo',level:100,stats:{...stats},moves:[...moves],...overrides});
assert.equal(D.limits.level,100);
assert.equal(Object.values(D.species).filter(s=>!s.specialOnly).length,259);
assert.equal(D.species.futo.specialOnly,true);
assert(Object.values(D.maps).every(m=>!m.encounters?.includes('futo')),'Futo is distribution-only');
let e=engine(),m=e.state.party[0];e.battle={log:[],result:'won'};
e.giveXP(m,1000000,[]);
assert.equal(m.level,100);assert.equal(m.xp,0);assert.equal(e.xpToNext(100),0);
e.giveXP(m,1000,[]);assert.equal(m.level,100);assert.equal(m.xp,0);
assert.equal(new Engine(e.serialize()).state.party[0].level,100);
assert.throws(()=>e.makeMonster('komori',101));
assert.throws(()=>e.makeMonster('komori',0));
e=engine();e.state.party[0]=e.makeMonster(D.starters[0],60);
const legacy=e.serialize();delete legacy.giftReceipts;
e=new Engine(legacy);assert.deepEqual(clean(e.state.giftReceipts),[]);e.battle={log:[],result:'won'};
e.giveXP(e.state.party[0],e.xpToNext(60),[]);assert.equal(e.state.party[0].level,61);

e=engine();const immutable=JSON.stringify(D.species.futo);
let result=e.grantFuto(grant('gift-a'));
assert.equal(result.ok,true);assert.equal(result.destination,'party');
m=e.state.party.find(mon=>mon.species==='futo');
assert.deepEqual(clean(e.stats(m)),canonical);assert.equal(m.hp,5000);
assert.deepEqual(clean(e.moves(m).map(x=>x.id)),moves);
assert.equal(m.grantId,'gift-a');
assert(e.state.caught.includes('futo'));assert(e.state.seen.includes('futo'));
assert.equal(e.grantFuto(grant('gift-a')).alreadyReceived,true);
assert.equal(e.state.party.filter(mon=>mon.species==='futo').length,1);
let snapshot=e.serialize();const before=JSON.stringify(snapshot);
const reloaded=new Engine(snapshot);assert.equal(JSON.stringify(snapshot),before,'Validate must not mutate caller save');
assert.deepEqual(clean(reloaded.stats(reloaded.state.party[1])),canonical);
assert.equal(reloaded.grantFuto(grant('gift-a')).alreadyReceived,true);
assert.equal(JSON.stringify(D.species.futo),immutable,'Configured stats must not mutate species template');
const bad=e.serialize();bad.party[1].customStats.hp=Infinity;
assert.throws(()=>new Engine(bad));
const bad2=e.serialize();bad2.party[0].customStats=canonical;
assert.throws(()=>new Engine(bad2));
for(const invalid of [{hp:0},{hp:100000},{attack:10000},{accuracy:301},{evasion:NaN}]){
  assert.equal(e.grantFuto(grant('invalid-'+Object.keys(invalid)[0],{stats:{...stats,...invalid}})).ok,false);
}
assert.equal(e.grantFuto(grant('bad-moves',{moves:['shell','shell','shell','shell']})).ok,false);
assert.equal(e.grantFuto(grant('bad-level',{level:101})).ok,false);
assert.equal(e.grantFuto(grant('__bad id__')).ok,false);
assert.equal(e.grantFuto(grant('missing-stats',{stats:{hp:100}})).ok,false);

m.hp=2500;m.pp.supernova=2;
assert.equal(e.updateOwnedFuto('gift-a',{level:90,stats:{...stats,hp:8000},moves}).ok,true);
assert.equal(m.hp,4000);assert.equal(m.level,90);assert.equal(m.pp.supernova,2);
m.hp=0;assert.equal(e.updateOwnedFuto('gift-a',{level:100,stats,moves}).ok,true);assert.equal(m.hp,0);
assert.equal(e.updateOwnedFuto('missing',grant('x')).pending,true);
e.battle={};assert.equal(e.grantFuto(grant('during-battle')).pending,true);
assert(!e.state.giftReceipts.includes('during-battle'));
assert.equal(e.updateOwnedFuto('gift-a',grant('x')).pending,true);e.battle=null;
e=engine();while(e.state.party.length<6)e.state.party.push(e.makeMonster(D.starters[0],5));
assert.equal(e.grantFuto(grant('to-storage')).destination,'storage');
while(e.state.storage.length<D.limits.storage)e.state.storage.push(e.makeMonster(D.starters[0],5));
assert.equal(e.grantFuto(grant('full')).pending,true);assert(!e.state.giftReceipts.includes('full'));
e.state.storage.pop();assert.equal(e.grantFuto(grant('full')).ok,true);
const empty=new Engine();assert.equal(empty.grantFuto(grant('not-started')).pending,true);

// The gift uses configured battle strength, rather than the shared template.
e=engine();e.grantFuto(grant('combat',{level:50}));m=e.state.party[1];e.rng=()=>.5;
const defender=e.makeMonster(D.starters[0],100);defender.hp=100000;
e.battle={healCooldown:{ally:0,enemy:0},log:[]};
e.applyMove(m,defender,D.moves.supernova,'ally',[]);const strong=100000-defender.hp;
m.customStats.spAtk=1;defender.hp=100000;
e.applyMove(m,defender,D.moves.supernova,'ally',[]);const weak=100000-defender.hp;
assert(strong>weak*2,'Configured special attack must affect actual damage');
const quest=e.quests().find(q=>q.id==='all-voices');assert.equal(quest.target,259);assert.equal(quest.progress,1);
const duelScript=scripts.find(s=>s[2].includes('class Duel {'));
if(duelScript){vm.runInContext(duelScript[2],context);assert.equal(context.LT.Duel.validateTeam(['futo',...D.starters.slice(0,2)],'single').ok,false);}
// Exercise the real browser bridge with failing storage: no in-memory grant or
// receipt may commit before persistence succeeds, even when the API retries.
const bridgeSource=html.slice(html.indexOf('  function persistGiftMutation('),html.indexOf('  resize();updateSound();loadStored();'));
const persisted=new Map();let failStorage=true;
const bridgeContext=vm.createContext({LT:{...context.LT},performance:{now:()=>123},
  localStorage:{getItem:key=>persisted.get(key)||null,setItem:(key,value)=>{if(failStorage)throw Error('Quota exceeded');persisted.set(key,value);}},
  document:{dispatchEvent(){}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}});
vm.runInContext(`const Engine=LT.Engine;let engine=new Engine();engine.newGame(LT.DATA.starters[0]);
  let playing=true,busy=false,storedSave=null,lastSave=0;const SAVE_KEY='test-save';
  function updateAll(){}function loadStored(){}function toast(){}
  ${bridgeSource}`,bridgeContext);
const bridge=bridgeContext.LT.adminBridge;
assert.equal(bridge.grantFuto(grant('persisted')).pending,true);
assert.equal(bridge.getEngine().state.party.length,1);
assert(!bridge.getEngine().state.giftReceipts.includes('persisted'));
failStorage=false;assert.equal(bridge.grantFuto(grant('persisted')).ok,true);
assert.equal(bridge.getEngine().state.party.length,2);
assert(persisted.has('test-save'));assert.equal(bridge.grantFuto(grant('persisted')).alreadyReceived,true);
vm.runInContext('playing=false;storedSave=null;',bridgeContext);
assert.equal(bridge.getEngine(),null);assert.equal(bridge.grantFuto(grant('title')).pending,true);
console.log('Futo and level cap checks passed: Lv100 growth/save, configured stats/moves/damage, idempotent delivery, overflow retry, save migration, admin update HP/KO, distribution-only roster.');
