#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)],context=vm.createContext({console});
for(const script of scripts){if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;vm.runInContext(script[2],context);if(context.LT?.Engine)break;}
vm.runInContext(scripts.find(script=>script[2].includes('deterministic, save-independent rental-team duels.'))[2],context);
const {Engine,DATA:D,Duel}=context.LT,copy=v=>JSON.parse(JSON.stringify(v));
const grant={grantId:'admin-mythical:operator-test',species:'floravelle',level:70},ids=['verdant_lance','forest_crown','genesis_bloom','root_drain'];
const make=()=>{const e=new Engine();assert(e.newGame('komori','female','もりのたび').ok);return e;};
const get=e=>[...e.state.party,...e.state.storage].find(m=>m.species==='floravelle');
assert.equal(D.mythical.species,'floravelle');assert.equal(D.mythical.adminLevel,70);
assert.equal(D.species.floravelle.element,'leaf');assert(D.species.floravelle.adminOnly&&D.species.floravelle.specialOnly);
assert.equal(D.species.floravelle.rarity,'mythical');assert(!D.species.floravelle.evolvesTo);
assert.equal(D.content.species,254);assert.equal(D.content.totalSpecies,256);assert.equal(D.content.specialSpecies,2);
assert.equal(D.content.dexSpecies,256);assert.equal(D.content.hiddenSpecies,12);assert.equal(D.content.playableSpecies,268);assert.equal(Object.keys(D.species).length,268);
assert.deepEqual(copy(D.species.floravelle.moves),ids);assert(ids.every(id=>D.moves[id].element==='leaf'));
assert(Object.values(D.maps).every(m=>!m.encounters.includes('floravelle')));
assert(!D.starters.includes('floravelle'));assert(!D.collectionRoutes.wild.includes('floravelle'));
assert(Object.values(D.collectionRoutes.starters).every(ids=>!ids.includes('floravelle')));
for(const pool of [D.guardians,D.rivals,D.elites,{champion:D.champion}])assert(!JSON.stringify(pool).includes('floravelle'));
let e=make();assert(!e.startBattle('floravelle',70));assert(!e.startBattle('floravelle',70,null,{wild:false}));
assert(!e.startTeamBattle([{species:'komori',level:5},{species:'floravelle',level:70}]));assert.equal(e.battle,null);
// Link battles take the mythical at standard Lv.50 stats from its (balanced) species data.
{const d=new Duel({mode:'single',seed:7,teams:[['floravelle','komori','shizuku'],['arvelion','hibana','komori']]}),fl=d.state.teams[0].monsters[0],b=D.species.floravelle.base;
 assert.equal(fl.level,50);assert.deepEqual(copy(fl.stats),{hp:b.hp+250,atk:b.atk+150,def:b.def+100,spAtk:b.spAtk+150,spDef:b.spDef+100,speed:b.speed+100,accuracy:b.accuracy,evasion:b.evasion});}
assert(new Engine().receiveAdminMythical(grant).pending);
for(const invalid of [{...grant,grantId:'admin-legendary:operator-test'},{...grant,grantId:'admin-mythical:'},{...grant,species:'arvelion'},{...grant,level:71}]){assert(!e.receiveAdminMythical(invalid).ok);assert(!get(e));}
assert(e.receiveAdminMythical(grant).ok);let mon=get(e);assert.equal(mon.level,70);assert.equal(mon.shiny,false);assert.equal(mon.grantId,grant.grantId);
const before=JSON.stringify(e.state);assert(e.receiveAdminMythical(grant).alreadyReceived);assert.equal(JSON.stringify(e.state),before);
mon.nickname='もりがみ';mon.hp-=9;mon.pp.verdant_lance=3;mon.xp=12;
const saved=e.serialize(),saveBefore=JSON.stringify(saved),reloaded=new Engine(saved);assert.equal(JSON.stringify(saved),saveBefore);assert.deepEqual(copy(get(reloaded)),copy(mon));assert.equal(reloaded.state.playerName,'もりのたび');
for(const missing of [undefined,'admin-legendary:operator-test','ordinary:grant']){const forged=copy(saved);if(missing===undefined)delete forged.party[1].grantId;else forged.party[1].grantId=missing;assert.throws(()=>new Engine(forged));}
assert(e.releaseParty(1).ok);assert(e.receiveAdminMythical(grant).alreadyReceived);assert(!get(e),'A released initial companion is not duplicated');
// Capacity or battle defers delivery without consuming its stable receipt.
e=make();e.startBattle('arvelion',70);assert(e.receiveAdminMythical(grant).pending);assert(!e.state.giftReceipts.length);
e=make();while(e.state.party.length<D.limits.party)e.state.party.push(e.makeMonster('komori',5));
assert(e.receiveAdminMythical(grant).ok);assert(e.state.storage.some(m=>m.species==='floravelle'));
e=make();while(e.state.party.length<D.limits.party)e.state.party.push(e.makeMonster('komori',5));while(e.state.storage.length<D.limits.storage)e.state.storage.push(e.makeMonster('komori',5));
assert(e.receiveAdminMythical(grant).pending);assert(!e.state.giftReceipts.length);
function fight(){const e=make();assert(e.receiveAdminMythical(grant).ok);e.startBattle('arvelion',70);e.battle.activeIndex=1;e.rng=()=>.5;return {e,mon:get(e),enemy:e.battle.enemy};}
function cast(e,mon,enemy,id){const events=[];e.applyMove(mon,enemy,D.moves[id],'ally',events);return events;}
function damage(guard){const {e,mon,enemy}=fight();e.battle.enemyGuard=guard;const hp=enemy.hp;cast(e,mon,enemy,ids[0]);return hp-enemy.hp;}
assert(damage(true)<damage(false),'若葉の刃 is a physical attack that respects guard');
let f=fight();const poisonedHP=f.enemy.hp;cast(f.e,f.mon,f.enemy,ids[1]);assert.equal(f.enemy.status,'bloom');assert.equal(f.enemy.hp,poisonedHP);assert(Object.values(f.e.battle.stages.ally).every(v=>v===0));assert(!f.e.battle.allyGuard);assert.equal(f.mon.pp[ids[1]],1);
cast(f.e,f.mon,f.enemy,ids[1]);assert.equal(f.enemy.status,'bloom');assert.equal(f.enemy.hp,poisonedHP);assert.equal(f.mon.pp[ids[1]],0);
f=fight();f.mon.hp=1;const enemyHP=f.enemy.hp;cast(f.e,f.mon,f.enemy,ids[2]);assert(f.enemy.hp<enemyHP);assert.equal(f.mon.hp,1);assert.equal(f.mon.rechargeTurns,1);
f=fight();f.mon.hp=1;cast(f.e,f.mon,f.enemy,ids[3]);assert.equal(f.mon.hp,1+Math.ceil(f.e.stats(f.mon).hp*.5));
f.mon.hp=f.e.stats(f.mon).hp-1;cast(f.e,f.mon,f.enemy,ids[3]);assert.equal(f.mon.hp,f.e.stats(f.mon).hp);
const initialStats=f.e.stats(f.mon);f.e.giveXP(f.mon,999999,[]);assert.equal(f.mon.level,100);assert.equal(f.mon.species,'floravelle');assert.equal(f.mon.xp,0);assert.equal(f.e.state.stats.evolutions,0);
for(const key of ['hp','atk','def','spAtk','spDef','speed'])assert(f.e.stats(f.mon)[key]>initialStats[key]);
f.e.battle=null;assert.equal(get(new Engine(f.e.serialize())).level,100);
// The real mythical participates in link battles with the same four effects.
const d=new Duel({mode:'single',seed:7,teams:[['floravelle','komori','shizuku'],['arvelion','hibana','komori']]});
const actor=d.active(0)[0];actor.pp=Object.fromEntries(ids.map(id=>[id,D.moves[id].pp]));d._random=()=>.5;
function apply(id){d._apply({side:0,slot:0,target:0,technique:D.moves[id]},actor);}
apply(ids[1]);assert.equal(d.active(1)[0].status,'bloom');assert(Object.values(actor.stages).every(v=>v===0));assert(!actor.guard);
actor.hp=1;apply(ids[3]);assert.equal(actor.hp,1+Math.ceil(actor.maxHp*.5));
actor.hp=1;const enemy=d.active(1)[0],hp=enemy.hp;apply(ids[2]);assert(enemy.hp<hp);assert.equal(actor.hp,1);assert.equal(actor.rechargeTurns,1);
// Real bridge transaction must leave both in-memory and persisted saves intact
// on quota failure, then deliver once on retry.
const start=html.indexOf('  function persistGiftMutation(method,...args){'),end=html.indexOf('  LT.playMoveSound=',start);
for(const playing of [true,false]){
 const source=make(),original=JSON.stringify(source.state);let failWrite=true,writes=0,stored;
 const bridge=vm.createContext({tradeLocked:()=>false,Engine,engine:source,playing,busy:false,storedSave:copy(source.state),SAVE_KEY:'mythical-save',lastSave:0,performance:{now:()=>1},updateAll(){},loadStored(){},localStorage:{setItem(key,value){if(failWrite)throw Error('Storage full');writes++;stored=JSON.parse(value);}},CustomEvent:class{},document:{dispatchEvent(){}}});
 vm.runInContext(html.slice(start,end),bridge);
 assert(bridge.persistGiftMutation('receiveAdminMythical',grant).pending);assert.equal(JSON.stringify(source.state),original);assert.equal(writes,0);
 failWrite=false;assert(bridge.persistGiftMutation('receiveAdminMythical',grant).ok);assert.equal(writes,1);assert(stored.giftReceipts.includes(grant.grantId));
 assert(bridge.persistGiftMutation('receiveAdminMythical',grant).alreadyReceived);assert.equal(writes,1);
}
console.log('Mythical checks passed: owner entitlement validation, 254 ordinary / 256 dex / 268 playable species, no ordinary acquisition, link battles at standard Lv.50 stats, party/storage capacity, duplicate/release safety, save identity and rollback, Lv100/no evolution, physical leaf moves, poison, recharge and half restoration in solo/duel.');
