#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),model=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
 if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
 vm.runInContext(script[2],model);if(model.LT?.Engine)break;
}
const {Engine,DATA:D}=model.LT,copy=value=>JSON.parse(JSON.stringify(value));
let passed=0;
function test(name,run){run();passed++;console.log('PASS '+name);}
function game(party=6,storage=0){
 const e=new Engine();assert(e.newGame('komori').ok);e.state.party[0].level=30;e.restoreMonster(e.state.party[0]);
 const ids=['komori','hibana','shizuku','fuwari','kirari','nullmie'];
 while(e.state.party.length<party){const id=ids[e.state.party.length];e.state.party.push(e.makeMonster(id,30));e.markCaught(id);}
 for(let n=0;n<storage;n++)e.state.storage.push(e.makeMonster('komori',30));
 return e;
}
function rejectUnchanged(e,action){
 const state=e.state,battle=e.battle,before=copy(state),party=[...state.party],storage=[...state.storage];
 const result=action();assert.equal(result.ok,false);assert.equal(e.state,state);assert.equal(e.battle,battle);assert.deepEqual(copy(e.state),before);
 assert.deepEqual([...e.state.party],party);assert.deepEqual([...e.state.storage],storage);return result;
}
function rich(mon,e){
 Object.assign(mon,{nickname:'おあずけ',gender:'female',shiny:true,heldItem:'healberry',bonusPoints:4,alloc:{hp:4,atk:7,spDef:3},xp:11,hp:3});
 mon.pp[e.moves(mon)[0].id]=1;if(D.species[mon.species].element!=='void')mon.status='scorch';
}

test('six companions can become one without changing individuals, inventory, records or survivor order',()=>{
 const e=game();rich(e.state.party[0],e);rich(e.state.party[2],e);e.state.party[1].hp=0;
 e.state.held={healberry:2,calmbell:1};e.state.inventory.remedy=9;e.state.coins=731;e.state.stats.captures=12;
 e.state.giftReceipts.push('deposit-past-gift');e.state.tradeReceipts.push('trade:12345678-1234-4234-8234-123456789abc');
 const originals=[...e.state.party],individuals=copy(originals);
 for(const index of [0,2,1,1,0]){
  const mon=e.state.party[index],expected=copy(e.state),removed=expected.party.splice(index,1)[0];expected.storage.push(removed);
  assert(e.depositParty(index).ok);assert.equal(e.state.storage.at(-1),mon,'Engine moves the same individual object');assert.deepEqual(copy(e.state),expected);
  if(e.state.party.length===5)assert.equal(e.state.party[0],originals[1],'A fainted first survivor stays first instead of reordering the party');
 }
 assert.equal(e.state.party.length,1);assert.equal(e.state.storage.length,5);assert.equal(e.state.party[0],originals[5]);
 rejectUnchanged(e,()=>e.depositParty(0));
 const loaded=new Engine(e.serialize());
 for(const saved of individuals)assert.deepEqual(copy([...loaded.state.party,...loaded.state.storage].find(mon=>mon.uid===saved.uid)),saved,'Every individual field survives save/reload');
 const returning=loaded.state.storage[0];assert(loaded.exchange(loaded.state.party.length,0).ok);assert.equal(loaded.state.party.at(-1),returning);
 assert.deepEqual(copy(returning),individuals[0]);assert.deepEqual(copy(loaded.state.held),copy(e.state.held));assert.deepEqual(copy(loaded.state.giftReceipts),copy(e.state.giftReceipts));
});

test('last companion and only able companion are protected while fainted spares can be deposited',()=>{
 const e=game(3);e.state.party[0].hp=1;e.state.party[1].hp=0;e.state.party[2].hp=0;
 assert.match(rejectUnchanged(e,()=>e.depositParty(0)).message,/動ける/);
 const fainted=e.state.party[2];assert(e.depositParty(2).ok);assert.equal(e.state.storage[0],fainted);assert.equal(fainted.hp,0);
 assert(e.depositParty(1).ok);assert.equal(e.state.party.length,1);assert.match(rejectUnchanged(e,()=>e.depositParty(0)).message,/最後/);
 const none=game(2);none.state.party.forEach(mon=>{mon.hp=0;});rejectUnchanged(none,()=>none.depositParty(1));
});

test('invalid slots, inactive adventures and active or finished battle screens reject without mutation',()=>{
 for(const index of [-1,2,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,null,undefined,'1',true,{},[]]){
  const e=game(2);rejectUnchanged(e,()=>e.depositParty(index));
 }
 const unopened=new Engine();rejectUnchanged(unopened,()=>unopened.depositParty(0));
 const stopped=game(2);stopped.state.started=false;rejectUnchanged(stopped,()=>stopped.depositParty(1));
 for(const battle of [{},{result:'won'}]){const e=game(2);e.battle=battle;rejectUnchanged(e,()=>e.depositParty(1));}
});

test('slot 192 is usable and full or legacy 193–512 reserves retain every individual',()=>{
 assert.equal(D.limits.storage,192);
 for(const count of [191,192,193,512]){
  const e=new Engine(game(2,count).serialize()),mon=e.state.party[1];
  if(count===191){assert(e.depositParty(1).ok);assert.equal(e.state.storage.length,192);assert.equal(e.state.storage.at(-1),mon);}
  else{assert.match(rejectUnchanged(e,()=>e.depositParty(1)).message,/満員/);assert.equal(e.state.storage.length,count);}
  const loaded=new Engine(e.serialize());assert.deepEqual(copy(loaded.state.storage),copy(e.state.storage));
 }
});

test('configured Futo keeps its gift, growth, move PP and held item through deposit, reload and withdrawal',()=>{
 const e=game(1),grant={grantId:'deposit-configured-futo',level:50,stats:{hp:1200,atk:300,def:250,spAtk:400,spDef:280,speed:260,accuracy:110,evasion:105},moves:[...D.species.futo.moves]};
 assert(e.grantFuto(grant).ok);const mon=e.state.party[1];e.giveXP(mon,e.xpToNext(mon.level),[]);
 Object.assign(mon,{nickname:'おあずけ',shiny:true,heldItem:'calmbell',hp:17,xp:11});mon.pp[e.moves(mon)[0].id]=1;
 const before=copy(mon),receipts=copy(e.state.giftReceipts);assert(e.depositParty(1).ok);assert.equal(e.state.storage[0],mon);assert.deepEqual(copy(mon),before);
 const loaded=new Engine(e.serialize());assert.deepEqual(copy(loaded.state.storage[0]),before);assert.deepEqual(copy(loaded.state.giftReceipts),receipts);
 assert(loaded.grantFuto(grant).alreadyReceived);const returning=loaded.state.storage[0];assert(loaded.exchange(1,0).ok);assert.equal(loaded.state.party[1],returning);
 assert.deepEqual(copy(returning),before);assert.deepEqual(copy(loaded.stats(returning)),copy(e.stats(mon)));assert.equal(loaded.state.storage.length,0);
});

function section(from,to){const start=html.indexOf(from),end=html.indexOf(to,start);assert(start>0&&end>start,`${from.trim()} extraction boundary`);return html.slice(start,end);}
const helpers=section('  function partyDepositReason(','  function showParty('),renderers=section('  function showParty(','  function findOwned(');
function ui(engine=game(2)){
 const elements=new Map(),c=vm.createContext({Engine,DATA:D,LT:{...model.LT,onlineActive:false,localTradeActive:false},engine,playing:true,busy:false,tradeLock:false,
  storedSave:{previous:true},lastSave:7,moveAnim:{before:true},SAVE_KEY:'deposit-save',writes:[],saveAttempts:0,updates:0,toasts:[],storageFails:false,
  performance:{now:()=>123},tradeLocked:()=>c.tradeLock,
  escape:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),portrait:()=>'<canvas></canvas>',creatureView:()=>'<canvas></canvas>',
  nameOf:mon=>model.LT.displayName(mon),shinyBadge:()=>'',typeBadge:()=>'',creatureDescription:s=>s.description||'',hpBar:()=>'',ico:()=>'',
  $:id=>elements.get(id),updateAll:()=>{c.updates++;},toast:message=>c.toasts.push(message),
  localStorage:{setItem(key,value){c.saveAttempts++;c.onWrite?.();if(c.storageFails)throw Error('Quota exceeded');c.writes.push([key,value]);}},
  openModal(title,markup,pane){
   c.modal={title,markup,pane};elements.clear();
   for(const tag of markup.matchAll(/<[a-z][\w-]*\b([^>]*)>/gi)){
    const attrs=Object.fromEntries([...tag[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(match=>[match[1],match[2]??'']));
    if(attrs.id)elements.set(attrs.id,{attrs,disabled:Object.hasOwn(attrs,'disabled'),textContent:'',hidden:Object.hasOwn(attrs,'hidden')});
   }
  }
 });
 vm.runInContext(helpers,c);vm.runInContext(renderers,c);c.elements=elements;return c;
}
function persist(c,index=1,uid=c.engine.state.party[index]?.uid,expected=c.engine){return c.persistPartyDeposit(index,uid,expected);}
function rejectUI(c,action){
 const before=copy(c.engine.state),state=c.engine.state,stored=c.storedSave,lastSave=c.lastSave,writes=c.writes.length,attempts=c.saveAttempts;
 const result=action();if(result!==undefined)assert.equal(result.ok,false);
 assert.equal(c.engine.state,state);assert.deepEqual(copy(c.engine.state),before);assert.equal(c.storedSave,stored);assert.equal(c.lastSave,lastSave);assert.equal(c.writes.length,writes);assert.equal(c.saveAttempts,attempts);
}

test('UI writes the candidate before committing it and a failed save preserves the whole live state',()=>{
 const c=ui(),before=copy(c.engine.state),state=c.engine.state,stored=c.storedSave;rich(c.engine.state.party[1],c.engine);
 const detailed=copy(c.engine.state);c.onWrite=()=>{assert.equal(c.engine.state,state);assert.deepEqual(copy(c.engine.state),detailed,'Live state stays unchanged while writing');assert.equal(c.storedSave,stored);};
 c.storageFails=true;assert.equal(persist(c).ok,false);assert.equal(c.engine.state,state);assert.deepEqual(copy(c.engine.state),detailed);assert.equal(c.storedSave,stored);assert.equal(c.lastSave,7);assert.equal(c.writes.length,0);
 c.storageFails=false;assert(persist(c).ok);assert.notEqual(c.engine.state,state);assert.equal(c.writes.length,1);assert.equal(c.writes[0][0],'deposit-save');assert.equal(c.lastSave,123);
 const loaded=new Engine(JSON.parse(c.writes[0][1]));assert.deepEqual(copy(loaded.state),copy(c.engine.state));assert.deepEqual(copy(c.storedSave),copy(c.engine.serialize()));
 assert.equal(c.engine.state.party.length,before.party.length-1);assert.deepEqual(copy(c.engine.state.storage[0]),detailed.party[1]);
});

test('UI refuses stale slots or adventures and every battle, communication or exchange lock before saving',()=>{
 for(const block of ['playing','busy','battle','online','local-trade','trade-lock']){
  const c=ui();if(block==='playing')c.playing=false;if(block==='busy')c.busy=true;if(block==='battle')c.engine.battle={};
  if(block==='online')c.LT.onlineActive=true;if(block==='local-trade')c.LT.localTradeActive=true;if(block==='trade-lock')c.tradeLock=true;
  rejectUI(c,()=>persist(c));
 }
 let c=ui(),uid=c.engine.state.party[1].uid;c.engine.state.party.reverse();rejectUI(c,()=>persist(c,1,uid));
 c=ui();const previous=c.engine;uid=c.engine.state.party[1].uid;c.engine=new Engine(c.engine.serialize());rejectUI(c,()=>persist(c,1,uid,previous));
 for(const index of [-1,2,NaN,'1']){c=ui();rejectUI(c,()=>persist(c,index,c.engine.state.party[1].uid));}
 c=ui();rejectUI(c,()=>persist(c,1,''));
});

test('party and reserve screens show deposit controls, safe disabled reasons and preserved exchange actions',()=>{
 const c=ui();c.showParty(1);let button=c.elements.get('party-deposit-1');assert(button);assert.equal(button.disabled,false);assert.equal(button.attrs['data-party-uid'],c.engine.state.party[1].uid);assert.match(c.modal.markup,/ひかえに送る/);
 c.showStorage();assert.match(c.modal.markup,/ひかえに送る/);assert.match(c.modal.markup,/data-storage-slot="0"/);assert.match(c.modal.markup.replace(/<[^>]*>/g,''),/2\s*\/\s*6\s*体/);
 assert.equal(c.elements.get('party-deposit-0').disabled,false);assert.equal(c.elements.get('party-deposit-1').disabled,false);
 for(const [e,index,reason] of [[game(1),0,/最後の1体/],[game(2,192),1,/満員/],[game(2,193),1,/満員/],[game(2,512),1,/満員/]]){
  const c=ui(e);for(const render of [()=>c.showParty(index),()=>c.showStorage()]){render();button=c.elements.get('party-deposit-'+index);assert.equal(button.disabled,true);assert.match(c.modal.markup,reason);assert.equal(button.attrs['aria-describedby'],'party-deposit-reason-'+index);}
 }
 const sole=ui();sole.engine.state.party[1].hp=0;sole.showStorage();assert.equal(sole.elements.get('party-deposit-0').disabled,true);assert.equal(sole.elements.get('party-deposit-1').disabled,false);assert.match(sole.modal.markup,/動ける仲間/);
 const lastSlot=ui(game(2,191));lastSlot.showParty(1);assert.equal(lastSlot.elements.get('party-deposit-1').disabled,false);
});

test('real deposit callbacks retry failed saves, refresh the reserve after success and reject stale display targets',()=>{
 const c=ui();c.showParty(1);const button=c.elements.get('party-deposit-1'),before=copy(c.engine.state),state=c.engine.state;
 c.storageFails=true;button.onclick();assert.equal(c.engine.state,state);assert.deepEqual(copy(c.engine.state),before);assert.equal(button.disabled,false);assert.equal(c.modal.pane,'party');assert.equal(c.writes.length,0);assert(c.toasts.length>0);
 c.storageFails=false;button.onclick();assert.equal(c.engine.state.party.length,1);assert.equal(c.engine.state.storage.length,1);assert.equal(c.writes.length,1);assert.equal(c.modal.pane,'storage');assert(c.updates>0);assert.match(c.toasts.at(-1),/ひかえ/);
 for(const change of ['reorder','engine']){
  const c=ui();c.showStorage();const click=c.elements.get('party-deposit-1').onclick;
  if(change==='reorder')c.engine.state.party.reverse();else c.engine=new Engine(c.engine.serialize());
  rejectUI(c,()=>click());assert(c.toasts.length>0);
 }
});
console.log(`Party deposit checks passed: ${passed} groups covering intact movement, survivor safety/order, capacity, save/reload/withdrawal, Futo gifts and real UI persistence/guards/rendering/callbacks.`);
