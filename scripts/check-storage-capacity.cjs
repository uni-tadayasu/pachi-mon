#!/usr/bin/env node
'use strict';
// A smaller reserve must govern every acquisition path without deleting old saves.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),context=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],context);if(context.LT?.Engine)break;
}
const {Engine,DATA:D}=context.LT,copy=value=>JSON.parse(JSON.stringify(value));
assert.equal(D.limits.storage,192);
function game(count=0,party=6){
  const e=new Engine();assert(e.newGame('komori').ok);
  while(e.state.party.length<party)e.state.party.push(e.makeMonster('komori',35));
  for(let i=0;i<count;i++){
    const id=D.starters[i%D.starters.length],mon=e.makeMonster(id,35);
    mon.nickname='旧'+String(i).padStart(3,'0');mon.shiny=i%7===0;mon.alloc={hp:4,atk:12,def:8};
    mon.xp=i%100;mon.pp[e.moves(mon)[0].id]=1;
    e.state.storage.push(mon);e.markCaught(id);
  }
  e.state.inventory.chime=20;e.rng=()=>0;return e;
}
function rejectWithoutMutation(e,action){
  const before=JSON.stringify({state:e.state,battle:e.battle});
  assert.equal(action().ok,false);
  assert.equal(JSON.stringify({state:e.state,battle:e.battle}),before,'Rejected acquisition must not consume a turn, capsule, receipt or save record');
}
const futo={grantId:'storage-boundary-futo',level:70,stats:{hp:1200,atk:300,def:250,spAtk:300,spDef:250,speed:200,accuracy:100,evasion:100},moves:D.species.futo.moves.slice()};
const legend={grantId:'admin-legendary:storage-boundary',species:D.legendary.species,level:D.legendary.adminLevel};
const mythical={grantId:'admin-mythical:storage-boundary',species:D.mythical.species,level:D.mythical.adminLevel};
const grants=[e=>e.grantFuto(futo),e=>e.receiveAdminLegendary(legend),e=>e.receiveAdminMythical(mythical)];

// Slot 192 is usable; slot 193 is blocked before any battle/resource mutation.
let e=game(191);assert(e.startBattle('hibana',1));let catchRoll=0;e.rng=()=>catchRoll++===0?0:.999;assert(e.action({type:'resonate'}).ok);
assert.equal(e.state.storage.length,192);assert.equal(e.state.inventory.chime,19);
e.battle=null;assert(e.startBattle('shizuku',1));rejectWithoutMutation(e,()=>e.action({type:'resonate'}));
for(const acquire of grants){
  e=game(191);assert(acquire(e).ok);assert.equal(e.state.storage.length,192);
  e=game(192);rejectWithoutMutation(e,()=>acquire(e));
}
e=game(192);rejectWithoutMutation(e,()=>e.startAdminEncounter('komori',5,{id:'P0123456789abcdef',isAdmin:true}));

// A spare party slot remains usable even when the reserve is full or grandfathered.
for(const count of [192,193,512]){
  e=game(count,5);assert(e.startBattle('hibana',1));assert(e.action({type:'resonate'}).ok);
  assert.equal(e.state.party.length,6);assert.equal(e.state.storage.length,count);
  for(const acquire of grants){e=game(count,5);assert(acquire(e).ok);assert.equal(e.state.party.length,6);assert.equal(e.state.storage.length,count);}
}

// Saves from the previous 512-slot edition keep every individual and all detail,
// survive repeated exports/imports, and retain normal reserve-management actions.
for(const count of [0,191,192,193,256,512]){
  e=game(count);const save=e.serialize(),untouched=JSON.stringify(save),owned=copy(save.storage);
  e=new Engine(save);assert.equal(JSON.stringify(save),untouched,'Import cannot mutate its input');
  assert.equal(e.state.storage.length,count);assert.deepEqual(copy(e.state.storage),owned);
  const round=new Engine(e.serialize());assert.deepEqual(copy(round.state.storage),owned);
  if(count<193)continue;
  e.rng=()=>0;assert(e.startBattle('hibana',1));rejectWithoutMutation(e,()=>e.action({type:'resonate'}));e.battle=null;
  for(const acquire of grants)rejectWithoutMutation(e,()=>acquire(e));
  const last=e.state.storage.at(-1).uid,lead=e.state.party[0].uid;
  assert(e.exchange(0,count-1).ok);assert.equal(e.state.party[0].uid,last);assert.equal(e.state.storage.at(-1).uid,lead);assert.equal(e.state.storage.length,count);
  assert(e.releaseParty(1).ok);assert(e.exchange(e.state.party.length,count-2).ok);assert.equal(e.state.storage.length,count-1);
  assert(e.release(0).ok);assert.equal(e.state.storage.length,count-2);assert.doesNotThrow(()=>new Engine(e.serialize()));
}
e=game(513);assert.throws(()=>new Engine(e.serialize()),/仲間の人数/,'Legacy compatibility must remain bounded');
e=game(512);const duplicate=e.serialize();duplicate.storage[511].uid=duplicate.storage[0].uid;assert.throws(()=>new Engine(duplicate),/モンスターの情報/);

// A one-for-one network trade does not need a free reserve slot in a legacy save.
e=game(512);const target=400,room='12345678-1234-4234-8234-123456789abc',outgoing=e.state.storage[target],incoming=e.makeMonster('hibana',25);
incoming.uid='tr-'+room+'-h';
const result=e.applyTrade({id:'trade:'+room,outgoingUid:outgoing.uid,outgoing:e.tradeMonster(outgoing),incoming:e.tradeMonster(incoming),revision:1});
assert(result.ok,result.message);assert.equal(result.destination,'storage');assert.equal(result.index,target);assert.equal(e.state.storage.length,512);
assert.equal(e.state.storage[target].uid,incoming.uid);assert.doesNotThrow(()=>new Engine(e.serialize()));

// Only after the reserve falls below the limit can another individual enter it.
e=game(193);assert(e.release(0).ok);rejectWithoutMutation(e,()=>e.grantFuto(futo));
assert(e.release(0).ok);assert(e.grantFuto(futo).ok);assert.equal(e.state.storage.length,192);

// Run the real reserve renderer: all 512 legacy entries and a useful capacity
// explanation must remain reachable, including the last entry's management actions.
const start=html.indexOf('  function showStorage('),end=html.indexOf('  function findOwned(',start);
const depositStart=html.indexOf('  function partyDepositReason('),depositEnd=html.indexOf('  function showParty(',depositStart);
function storageUI(count,slot){
  const c=vm.createContext({engine:game(count),DATA:D,portrait:m=>`<img data-uid="${m.uid}">`,nameOf:m=>m.nickname||m.species,
    escape:s=>String(s),ico:()=>'',shinyBadge:()=>'',typeBadge:()=>'',speciesBadges:()=>'', $:()=>null,openModal:(title,body)=>{c.result={title,body};}});
  vm.runInContext(html.slice(depositStart,depositEnd),c);
  vm.runInContext(html.slice(start,end),c);c.showStorage(slot);return c;
}
let ui=storageUI(192,null);assert.match(ui.result.body,/ひかえ 192 \/ 192 体/);assert.doesNotMatch(ui.result.body,/以前の記録/);
ui=storageUI(512,-2);assert.match(ui.result.body,/ひかえ 512 \/ 192 体/);assert.match(ui.result.body,/512体をすべて保持/);
assert.match(ui.result.body,/191体以下/);assert.match(ui.result.body,/data-release="511"/);assert.match(ui.result.body,new RegExp(ui.engine.state.storage[511].uid));
assert.equal((ui.result.body.match(/class="dex-card storage-card"/g)||[]).length,512);
assert(!html.includes('engine.state.storage.length>=512'),'Capture UI must use the shared 192-slot capacity');
console.log('Storage capacity checks passed: exact 192 boundary, capsules/turns/receipts preserved on rejection, all gift paths, party vacancies, 193–512 legacy saves retained, bounded import, one-for-one trades, reserve management and complete legacy UI.');
