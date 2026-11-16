#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const copy=value=>JSON.parse(JSON.stringify(value));
function runtime(){
  const context=vm.createContext({console,crypto:webcrypto,TextEncoder,Uint8Array,Uint32Array,
    setTimeout(){return {};},clearTimeout(){}});
  for(const script of scripts){
    if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
    vm.runInContext(script[2],context);if(context.LT?.Engine)break;
  }
  return context;
}
const context=runtime(),{Engine,DATA:D}=context.LT;
const entitlement={grantId:'admin-legendary:operator-shiny-test',species:'arvelion',level:70};
const make=()=>{const e=new Engine();assert(e.newGame(D.starters[0]).ok);return e;};
const owned=(state,id=entitlement.grantId)=>[...state.party,...state.storage].filter(mon=>mon.species==='arvelion'&&mon.grantId===id);
const withoutShiny=mon=>{const value=copy(mon);delete value.shiny;return value;};
function legacy(destination='party'){
  const e=make(),mon=e.makeMonster('arvelion',84);
  Object.assign(mon,{grantId:entitlement.grantId,nickname:'ひのかみ',shiny:false,xp:11,hp:317,
    pp:{arvelion_rend:2,arvelion_nova:0,arvelion_crown:1,arvelion_renewal:4}});
  e.state[destination].push(mon);e.state.giftReceipts.push(entitlement.grantId);e.markCaught('arvelion');
  const normal=e.makeMonster('arvelion',73),rare=e.makeMonster('arvelion',71),futo=e.makeMonster('futo',25);
  normal.nickname='のせい';rare.shiny=true;futo.grantId='admin-initial:other-futo';
  e.state.storage.push(normal,rare,futo);e.state.giftReceipts.push(futo.grantId);e.markCaught('futo');
  return {e,mon,normal,rare,futo};
}

// A new operator entitlement affects only that individual, not the species.
let e=make();assert.equal(e.makeMonster('arvelion',70).shiny,false);
assert(e.receiveAdminLegendary(entitlement).ok);
let mon=owned(e.state)[0];assert(mon.shiny);assert.equal(mon.level,70);
assert.equal(e.state.party[0].shiny,false);assert.equal(owned(e.state).length,1);
const initial=copy(e.state);assert(e.receiveAdminLegendary(entitlement).alreadyReceived);
assert.deepEqual(copy(e.state),initial,'A repeated grant must not add or reset a monster');

// Old live state and old saved state both migrate in place, including storage.
for(const destination of ['party','storage']){
  const source=legacy(destination),before=withoutShiny(source.mon),receipts=copy(source.e.state.giftReceipts);
  const raw=source.e.serialize(),rawBefore=JSON.stringify(raw);
  const reloaded=new Engine(raw),migrated=owned(reloaded.state)[0];
  assert.equal(JSON.stringify(raw),rawBefore,'Loading must not mutate the input save');
  assert.equal(migrated.shiny,true);assert.deepEqual(withoutShiny(migrated),before);
  assert.deepEqual(copy(reloaded.state.giftReceipts),receipts);assert.equal(owned(reloaded.state).length,1);
  assert(reloaded.state[destination].some(item=>item.uid===migrated.uid),'Migration must keep party/storage placement');
  for(const original of [source.normal,source.rare,source.futo]){
    const actual=[...reloaded.state.party,...reloaded.state.storage].find(item=>item.uid===original.uid);
    assert.deepEqual(copy(actual),copy(original),'Wild Arvelion and other species retain their exact appearance and identity');
  }
  const result=source.e.receiveAdminLegendary(entitlement);assert(result.ok);
  assert.equal(source.mon.shiny,true,'A running session with an old received grant must also update');
  assert.deepEqual(withoutShiny(source.mon),before);assert.deepEqual(copy(source.e.state.giftReceipts),receipts);
  const stable=JSON.stringify(source.e.state);assert(source.e.receiveAdminLegendary(entitlement).alreadyReceived);
  assert.equal(JSON.stringify(source.e.state),stable);
  const absent=copy(raw);delete owned(absent)[0].shiny;
  assert.equal(owned(new Engine(absent).state)[0].shiny,true,'Pre-shiny saves also receive the operator appearance');
  const roundTrip=new Engine(reloaded.serialize());assert.deepEqual(copy(roundTrip.state),copy(reloaded.state));
}

// Releasing the gift never creates a second entitlement or resurrects it.
e=make();assert(e.receiveAdminLegendary(entitlement).ok);assert(e.releaseParty(1).ok);
e=new Engine(e.serialize());assert(e.receiveAdminLegendary(entitlement).alreadyReceived);
assert.equal(owned(e.state).length,0);assert(e.state.giftReceipts.includes(entitlement.grantId));
const receiptsOnly=copy(e.state);assert.equal(owned(new Engine(receiptsOnly).state).length,0);
e=make();e.battle={};assert(e.receiveAdminLegendary(entitlement).pending);
assert.equal(owned(e.state).length,0);assert.equal(e.state.giftReceipts.length,0);

// The independent wild shiny probability and ordinary non-wild encounters stay unchanged.
assert.equal(context.LT.MonsterIdentity.shinyOdds,3000);
for(const [roll,expected]of [[0,true],[1/3000-Number.EPSILON,true],[1/3000,false],[.5,false]]){
  e=make();let calls=0;e.rng=()=>{calls++;return roll;};assert(e.startBattle('arvelion',70));
  assert.equal(e.battle.enemy.shiny,expected);assert.equal(calls,1);assert(!e.battle.enemy.grantId);
}
e=make();e.rng=()=>{throw Error('Trainer battles must not acquire an operator appearance or roll shiny');};
assert(e.startBattle('arvelion',70,null,{wild:false}));assert.equal(e.battle.enemy.shiny,false);

// A cosmetic migration through the production bridge is still an atomic save.
const bridgeStart=html.indexOf('  function persistGiftMutation(method,...args){');
const bridgeEnd=html.indexOf('  LT.playMoveSound=',bridgeStart);
assert(bridgeStart>0&&bridgeEnd>bridgeStart);
for(const playing of [true,false]){
  const {e:source}=legacy('storage'),original=JSON.stringify(source.state),stored=copy(source.state);
  let failWrite=true,writes=0,events=0,saved=null;
  const bridge=vm.createContext({Engine,engine:source,playing,busy:false,storedSave:stored,SAVE_KEY:'shiny-save',lastSave:0,
    performance:{now:()=>100},updateAll(){},loadStored(){},
    localStorage:{setItem(key,value){if(failWrite)throw Error('Storage full');writes++;saved=value;}},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
    document:{dispatchEvent(){events++;}}});
  vm.runInContext(html.slice(bridgeStart,bridgeEnd),bridge);
  assert(bridge.persistGiftMutation('receiveAdminLegendary',entitlement).pending,'An existing grant migration must attempt storage and report failure');
  assert.equal(JSON.stringify(source.state),original);assert.deepEqual(copy(bridge.storedSave),stored);assert.equal(writes,0);assert.equal(events,0);
  failWrite=false;assert(bridge.persistGiftMutation('receiveAdminLegendary',entitlement).ok);
  assert.equal(writes,1);assert.equal(owned(JSON.parse(saved))[0].shiny,true);
  assert.equal(owned(bridge.storedSave)[0].shiny,true);
  assert.deepEqual(withoutShiny(owned(JSON.parse(saved))[0]),withoutShiny(owned(stored)[0]));
  assert.deepEqual(JSON.parse(saved).giftReceipts,stored.giftReceipts);assert.equal(owned(JSON.parse(saved)).length,1);
  if(playing)assert.equal(owned(source.state)[0].shiny,true);else assert.equal(JSON.stringify(source.state),original);
  const successfulEvents=events;assert(bridge.persistGiftMutation('receiveAdminLegendary',entitlement).alreadyReceived);
  assert.equal(writes,1,'An unchanged repeated receipt must not rewrite storage');assert.equal(events,successfulEvents);
}

async function onlineAppearance(){
  for(const marker of ['deterministic, save-independent rental-team duels','peer-to-peer casual duel protocol']){
    const script=scripts.find(item=>item[2].includes(marker));assert(script);vm.runInContext(script[2],context);
  }
  const {e:legacyEngine}=legacy(),saved=new Engine(legacyEngine.serialize());
  context.LT.adminBridge={getEngine:()=>saved};
  vm.runInContext(fs.readFileSync(path.join(root,'online-futo.js'),'utf8'),context);
  const messages=[],session=new context.LT.DuelSession({role:0,mode:'single',send:message=>{messages.push(copy(message));return true;}});
  session._started=true;session._connected=true;session.sessionId='a'.repeat(32);
  const before=JSON.stringify(saved.state);
  assert((await session.setTeam({name:'Operator',ids:['arvelion','komori','shizuku']})).ok);
  const packet=messages.find(message=>message.t==='ready');assert(packet);
  assert.equal(packet.team.appearance[0].shiny,true);assert.equal(packet.team.appearance[0].nickname,'ひのかみ');
  session._teams[1]={name:'Other',ids:['arvelion','hibana','komori'],appearance:[{nickname:'',shiny:false},{nickname:'',shiny:false},{nickname:'',shiny:false}]};
  session._beginIfReady();assert(session.duel);
  assert.equal(session.duel.state.teams[0].monsters[0].shiny,true);
  assert.equal(session.duel.state.teams[1].monsters[0].shiny,false);
  assert.equal(session.duel.state.teams[0].monsters[0].level,50,'Online stats and level remain rental rules');
  assert.equal(JSON.stringify(saved.state),before,'Online cosmetics cannot rewrite the adventure save');
  session.close();
}
onlineAppearance().then(()=>console.log('Admin Arvelion shiny checks passed: new/legacy party/storage, stable identity/level/HP/PP/receipts, released grants, wild 1/3000 boundary, atomic live/title-screen persistence and online cosmetics.')).catch(error=>{console.error(error.stack);process.exitCode=1;});
