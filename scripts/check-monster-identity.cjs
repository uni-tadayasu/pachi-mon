#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
function load(fallback=false){
  const context=vm.createContext({console,...(fallback?{Intl:{}}:{})});
  for(const script of scripts){if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;vm.runInContext(script[2],context);if(context.LT?.Engine)break;}
  return context.LT;
}
const LT=load(),{Engine,DATA:D,MonsterIdentity:I}=LT;
const copy=x=>JSON.parse(JSON.stringify(x));
const make=()=>{const e=new Engine();assert(e.newGame(D.starters[0],'female').ok);return e;};
let e=make();assert.equal(e.state.avatar,'female');assert.equal(new Engine(e.serialize()).state.avatar,'female');
const old=e.serialize();delete old.avatar;assert.equal(new Engine(old).state.avatar,'male');
assert(!e.newGame(D.starters[0],'invalid').ok);assert.equal(e.state.avatar,'female');
const invalidAvatar=e.serialize();invalidAvatar.avatar='invalid';assert.throws(()=>new Engine(invalidAvatar));

const base={hp:1000,atk:100,def:120,spAtk:150,spDef:110,speed:80,accuracy:100,evasion:90};
assert(e.grantFuto({grantId:'growth-test',level:5,stats:base}).ok);
let mon=e.state.party[1];assert.equal(mon.customStatsLevel,5);assert.deepEqual(copy(e.stats(mon)),base);
e.battle={log:[]};e.giveXP(mon,e.xpToNext(5),[]);e.battle=null;
assert.equal(mon.level,6);assert.equal(mon.species,'futo');
for(const [key,growth]of Object.entries(LT.FutoRules.growth))assert.equal(e.stats(mon)[key],base[key]+growth);
assert.equal(mon.hp,1005,'Level-up raises a healthy monster HP by the max HP increase');
const afterGrowth=JSON.stringify(mon);assert(e.updateOwnedFuto('growth-test',{level:5,stats:base}).unchanged);
assert.equal(JSON.stringify(mon),afterGrowth,'Repeated unchanged admin polling preserves earned level, XP and HP');
const before=e.serialize(),unmodified=JSON.stringify(before);e=new Engine(before);mon=e.state.party[1];
assert.equal(JSON.stringify(before),unmodified,'Validation does not mutate caller data');assert.equal(e.stats(mon).hp,1005);
const legacy=copy(before);delete legacy.party[1].customStatsLevel;delete legacy.party[1].futoConfigLevel;legacy.party[1].customStats=copy(e.stats(mon));
const legacyEngine=new Engine(legacy),migrated=legacyEngine.state.party[1];assert.equal(migrated.customStatsLevel,6);assert.equal(legacyEngine.stats(migrated).hp,1005);
assert(legacyEngine.updateOwnedFuto('growth-test',{level:5,stats:copy(legacy.party[1].customStats)}).unchanged);
assert.equal(migrated.level,6);assert.equal(migrated.customStatsLevel,6);assert.equal(migrated.futoConfigLevel,5);
legacyEngine.battle={log:[]};legacyEngine.giveXP(migrated,legacyEngine.xpToNext(6),[]);assert.equal(legacyEngine.stats(migrated).hp,1010);
e.battle={log:[]};mon.hp=0;e.giveXP(mon,1000000,[]);e.battle=null;
assert.equal(mon.level,100);assert.equal(mon.xp,0);assert.equal(mon.hp,0,'Growth does not revive fainted Futo');assert.equal(mon.species,'futo');
for(const [key,growth]of Object.entries(LT.FutoRules.growth))assert.equal(e.stats(mon)[key],base[key]+95*growth);
assert(e.updateOwnedFuto('growth-test',{level:20,stats:base}).ok);assert.equal(mon.customStatsLevel,20);assert.equal(mon.level,20);assert.equal(mon.hp,0);
for(const invalid of [0,101,'5']){const bad=copy(before);bad.party[1].customStatsLevel=invalid;assert.throws(()=>new Engine(bad));}
const badOrdinary=copy(before);badOrdinary.party[0].customStatsLevel=1;assert.throws(()=>new Engine(badOrdinary));

// Test the exact probability boundary, including a complete set of equally
// spaced RNG outcomes. No flaky statistical threshold or global Math patch.
e=make();assert.equal(I.shinyOdds,3000);let calls=0;
for(let i=0;i<3000;i++){e.rng=()=>{calls++;return i/3000;};assert(e.startBattle('komori',5));assert.equal(e.battle.enemy.shiny,i===0);}
assert.equal(calls,3000,'Exactly one independent shiny roll per wild encounter');
e.rng=()=>1/3000-Number.EPSILON;e.startBattle('komori',5);assert(e.battle.enemy.shiny);
e.rng=()=>1/3000;e.startBattle('komori',5);assert(!e.battle.enemy.shiny);
e.rng=()=>{throw Error('Trainer encounters must not roll for shininess');};e.startTeamBattle([{species:'komori',level:5}]);assert(!e.battle.enemy.shiny);
e.battle=null;e.state.seals=Object.keys(D.guardians).slice(0,4);e.state.map='tower';e.nearbyNPC=()=>({kind:'tower'});assert(e.startTower().ok);assert(!e.battle.enemy.shiny);
e=make();e.rng=()=>0;e.startBattle('komori',5);assert(e.battle.enemy.shiny);const caughtResult=e.action({type:'resonate'});assert(caughtResult.ok);e.battle=null;
mon=e.state.party[1];assert(mon.shiny,'Capture preserves the wild variant');assert(e.renameMonster(mon.uid,'きらりん').ok);
assert.equal(e.displayName(mon),'きらりん');assert.equal(LT.displayName(mon),'きらりん');
e.battle={log:[]};const events=[];e.giveXP(mon,1000000,events);e.battle=null;
assert.notEqual(mon.species,'komori');assert(mon.shiny);assert.equal(mon.nickname,'きらりん');assert(events.some(ev=>ev.kind==='evolve'));
const save=e.serialize();assert.equal(new Engine(save).state.party[1].nickname,'きらりん');assert(new Engine(save).state.party[1].shiny);
e.state.storage.push(e.state.party.pop());assert(e.renameMonster(mon.uid,'おほしさま').ok);assert.equal(mon.nickname,'おほしさま');assert(!e.renameMonster(mon.uid,'あいうえおか').ok);assert.equal(mon.nickname,'おほしさま');
assert(!e.renameMonster('not-owned','abc').ok);assert(!e.renameMonster(mon.uid,'bad\n').ok);assert(!e.renameMonster(mon.uid,'x\u202e').ok);
for(const identity of [I,load(true).MonsterIdentity]){
 assert.equal(identity.countNickname('👩‍👩‍👧‍👦'),1);
}

for(const identity of [I,load(true).MonsterIdentity]){
 assert.equal(identity.countNickname('🇯🇵🇺🇸'),2);
 assert.equal(identity.normalizeNickname(' か\u3099 '),'が');
 assert.equal(identity.normalizeNickname('👩‍👩‍👧‍👦あいうえ'),'👩‍👩‍👧‍👦あいうえ');
 assert.throws(()=>identity.normalizeNickname('👩‍👩‍👧‍👦あいうえお'));
}
assert(e.renameMonster(mon.uid,'').ok);assert(!Object.hasOwn(mon,'nickname'));assert.equal(e.displayName(mon),D.species[mon.species].name);
e.battle={log:[]};assert(!e.renameMonster(mon.uid,'いま').ok);e.battle=null;
for(const mutate of [m=>m.shiny='true',m=>m.nickname='あいうえおか',m=>m.nickname='bad\u0000']){const bad=copy(save);mutate(bad.party[1]);assert.throws(()=>new Engine(bad));}
console.log('Monster identity checks passed: exact 1/3000 wild odds, trainer exclusion, capture/evolution/save persistence, 5-grapheme nicknames, avatar migration, Futo growth/reference migration/no evolution/Lv100.');
