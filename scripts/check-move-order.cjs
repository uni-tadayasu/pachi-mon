#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),model=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
 if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
 vm.runInContext(script[2],model);if(model.LT?.Engine)break;
}
const {Engine,DATA:D,MoveOrder}=model.LT,copy=value=>JSON.parse(JSON.stringify(value)),ORDER=[2,0,3,1];
const futoStats={hp:1001,atk:100,def:100,spAtk:200,spDef:100,speed:100,accuracy:100,evasion:100};
const customMoves=['shell','supernova','starlight','atlas_crystal_4'];
let passed=0;function test(name,run){run();passed++;console.log('PASS '+name);}
function fixture(kind='komori',location='party',level=30){
 const e=new Engine();assert(e.newGame('komori').ok);let mon,grant;
 if(kind==='futo'||kind==='custom-futo'){
  grant={grantId:'move-order-futo',level,stats:futoStats,moves:kind==='custom-futo'?customMoves:[...D.species.futo.moves]};
  assert(e.grantFuto(grant).ok);mon=e.state.party[1];if(location==='storage'){e.state.party.splice(1,1);e.state.storage.push(mon);}
 }else{mon=e.makeMonster(kind,level);e.state[location].push(mon);e.markCaught(kind);}
 return {e,mon,grant};
}
function arrange(e,mon){assert(e.moveMove(mon.uid,2,0).ok);assert(e.moveMove(mon.uid,3,2).ok);assert.deepEqual(copy(mon.moveOrder),ORDER);}
const ids=(e,mon)=>[...e.moves(mon)].map(move=>move.id),baseIDs=(e,mon)=>[...e.baseMoves(mon)].map(move=>move.id);
function variedPP(e,mon){
 const values=[7,6,1,4];e.baseMoves(mon).forEach((move,i)=>{assert(values[i]<=e.maxPP(move),move.id);mon.pp[move.id]=values[i];});
 assert.equal(new Set(Object.values(mon.pp)).size,4);
}
function rejectUnchanged(e,action){const state=e.state,before=copy(state),battle=e.battle,result=action();assert.equal(result.ok,false);assert.equal(e.state,state);assert.equal(e.battle,battle);assert.deepEqual(copy(e.state),before);}
const badOrders=[null,[],[0,1,2],[0,1,2,3,4],[0,0,2,3],[-1,1,2,3],[0,1,2,4],[0,1,2,1.5],[0,1,2,NaN],[0,1,2,Infinity],['0',1,2,3],['null_ray',1,2,3],'0123',{},true,0,new Array(4)];
const sparse=[0,1,2,3];delete sparse[2];badOrders.push(sparse);

test('move orders accept only complete four-slot permutations and old individuals keep the original order',()=>{
 assert.deepEqual(copy(MoveOrder.normalize(undefined)),[0,1,2,3]);
 for(const order of [[0,1,2,3],[3,2,1,0],ORDER]){const before=copy(order);assert.deepEqual(copy(MoveOrder.normalize(order)),order);assert.deepEqual(order,before);}
 for(const order of badOrders)assert.throws(()=>MoveOrder.normalize(order));
 const {e,mon}=fixture();assert.equal(mon.moveOrder,undefined);assert.deepEqual(ids(e,mon),baseIDs(e,mon));
 const loaded=new Engine(e.serialize()),restored=loaded.state.party[1];assert.equal(restored.moveOrder,undefined);assert.deepEqual(ids(loaded,restored),[...D.species.komori.moves]);
});

test('ordinary, all Null stages and default/custom Futo reorder by UID in either collection without changing other data',()=>{
 const catalog=JSON.stringify(D.species);
 for(const kind of ['komori',...D.glitchLine.ids,'futo','custom-futo'])for(const location of ['party','storage']){
  const {e,mon}=fixture(kind,location);variedPP(e,mon);Object.assign(mon,{nickname:'わざじゅん',shiny:true,heldItem:'calmbell',xp:11,hp:17});
  if(kind!=='futo'&&kind!=='custom-futo')Object.assign(mon,{gender:'female',alloc:{hp:3,atk:2}});
  const before=copy(e.state),individual=copy(mon),canonical=baseIDs(e,mon),originalRef=mon;
  arrange(e,mon);assert.equal([...e.state.party,...e.state.storage].find(item=>item.uid===mon.uid),originalRef);
  assert.deepEqual(baseIDs(e,mon),canonical);assert.deepEqual(ids(e,mon),ORDER.map(slot=>canonical[slot]));
  const expected=copy(before);expected[location].find(item=>item.uid===mon.uid).moveOrder=ORDER;assert.deepEqual(copy(e.state),expected);
  const unchanged=e.moveMove(mon.uid,1,1);assert(unchanged.ok&&unchanged.unchanged);assert.deepEqual(copy(e.state),expected);
  const source=e.serialize(),untouched=JSON.stringify(source),loaded=new Engine(source),restored=loaded.state[location].find(item=>item.uid===mon.uid);
  assert.equal(JSON.stringify(source),untouched);assert.deepEqual(copy(restored),{...individual,moveOrder:ORDER});assert.deepEqual(ids(loaded,restored),ORDER.map(slot=>canonical[slot]));
 }
 assert.equal(JSON.stringify(D.species),catalog,'Individual layout never edits the species catalog');
});

test('each displayed battle position invokes its actual technique and spends only that technique PP',()=>{
 for(const kind of ['komori','nullmie','futo','custom-futo'])for(let index=0;index<4;index++){
  const {e,mon}=fixture(kind);variedPP(e,mon);arrange(e,mon);assert(e.setLead(1).ok);e.rng=()=>.5;
  assert(e.startBattle('komori',100));e.battle.enemy.hp=99999;e.enemyTurn=()=>{};
  const displayed=e.moveDetails(mon),selected=displayed[index].id,pp=copy(mon.pp),used=[],apply=e.applyMove.bind(e);
  e.applyMove=(actor,target,move,side,events)=>{if(side==='ally')used.push(move.id);return apply(actor,target,move,side,events);};
  const result=e.action({type:'move',index});assert(result.ok,`${kind} slot ${index}`);assert.deepEqual(used,[selected]);
  pp[selected]--;assert.deepEqual(copy(mon.pp),pp,`${kind}: PP stays attached to the move ID`);assert.deepEqual(copy(mon.moveOrder),ORDER);
 }
 const {e,mon}=fixture('nullmie');arrange(e,mon);mon.pp.null_ray=0;assert(e.setLead(1).ok);assert(e.startBattle('komori',100));
 const turn=e.battle.turn;rejectUnchanged(e,()=>e.action({type:'move',index:0}));assert.equal(e.battle.turn,turn,'An empty reordered move cannot spend another slot PP');
});

test('invalid UID, slot or adventure state cannot reorder and forged save orders cannot add techniques',()=>{
 const slots=[-1,4,1.5,NaN,Infinity,null,undefined,'1',true];
 for(const slot of slots){const {e,mon}=fixture();rejectUnchanged(e,()=>e.moveMove(mon.uid,slot,1));rejectUnchanged(e,()=>e.moveMove(mon.uid,1,slot));}
 for(const uid of [undefined,null,'','missing',1,{},[]]){const {e}=fixture();rejectUnchanged(e,()=>e.moveMove(uid,0,1));}
 for(const state of ['not-started','battle','finished-battle']){
  const {e,mon}=fixture();if(state==='not-started')e.state.started=false;else e.battle=state==='battle'?{}:{result:'won'};
  rejectUnchanged(e,()=>e.moveMove(mon.uid,0,1));
 }
 for(const order of badOrders)for(const location of ['party','storage']){
  const {e,mon}=fixture('komori',location),save=e.serialize();save[location].find(item=>item.uid===mon.uid).moveOrder=order;
  assert.throws(()=>new Engine(save),/技の順番/);
 }
});

test('normal and Null evolutions keep the slot permutation while learning and migrating PP canonically',()=>{
 for(const kind of ['komori','komorion','nullmie','nullva']){
  const {e,mon}=fixture(kind,'party',D.species[kind].evolveLevel-1);variedPP(e,mon);arrange(e,mon);
  const save=e.serialize();delete save.party[1].moveOrder;const control=new Engine(save),controlMon=control.state.party[1],amount=e.xpToNext(mon.level),next=D.species[kind].evolvesTo;
  e.giveXP(mon,amount,[]);control.giveXP(controlMon,amount,[]);assert.equal(mon.species,next);assert.deepEqual(copy(mon.moveOrder),ORDER);
  assert.deepEqual(ids(e,mon),ORDER.map(slot=>D.species[next].moves[slot]));const actual=copy(mon);delete actual.moveOrder;assert.deepEqual(actual,copy(controlMon));
  const loaded=new Engine(e.serialize());assert.deepEqual(ids(loaded,loaded.state.party[1]),ids(e,mon));
 }
});

test('Futo polling retains earned levels and layout, and real operator move changes replace only the underlying slots',()=>{
 for(const location of ['party','storage']){
  const {e,mon,grant}=fixture('futo',location,50);e.giveXP(mon,e.xpToNext(50)+17,[]);variedPP(e,mon);arrange(e,mon);mon.hp-=31;
  const before=copy(mon),result=e.updateOwnedFuto(grant.grantId,grant);assert(result.ok&&result.unchanged);assert.deepEqual(copy(mon),before,'Display order does not make an unchanged config reset growth');
  const save=e.serialize();delete save[location].find(item=>item.uid===mon.uid).moveOrder;const control=new Engine(save),config={...grant,moves:customMoves};
  assert(e.updateOwnedFuto(grant.grantId,config).ok);assert(control.updateOwnedFuto(grant.grantId,config).ok);
  assert.deepEqual(copy(mon.moveOrder),ORDER);assert.deepEqual(copy(mon.customMoves),customMoves);assert.deepEqual(ids(e,mon),ORDER.map(slot=>customMoves[slot]));
  const actual=copy(mon);delete actual.moveOrder;assert.deepEqual(actual,copy(control.state[location].find(item=>item.uid===mon.uid)));
 }
});

test('legacy ordinary, Null and Futo PP migrate by original slot despite a saved display permutation',()=>{
 for(const kind of ['hibana',...D.glitchLine.ids]){
  const {e,mon}=fixture(kind,'storage'),old=D.nullLegacyMovesets?.[kind]||D.legacyMovesets[kind];arrange(e,mon);
  const fractions=[0,1,.25,.75],pp=Object.fromEntries(old.map(([id,max],i)=>[id,Math.floor(max*fractions[i])])),expected={};
  e.baseMoves(mon).forEach((move,i)=>{expected[move.id]=Math.round(pp[old[i][0]]*e.maxPP(move)/old[i][1]);});
  const save=e.serialize();save.storage[0].pp=copy(pp);const loaded=new Engine(save),restored=loaded.state.storage[0];assert.deepEqual(copy(restored.pp),expected);assert.deepEqual(copy(restored.moveOrder),ORDER);
  assert.deepEqual(ids(loaded,restored),ORDER.map(slot=>D.species[kind].moves[slot]));
  if(D.nullLegacyMovesets?.[kind]){mon.pp=copy(pp);e.syncPP(mon);assert.deepEqual(copy(mon.pp),expected);assert.deepEqual(copy(mon.moveOrder),ORDER);}
 }
 const {e,mon}=fixture('futo'),old=['supernova','atlas_crystal_4','starlight','shell'];arrange(e,mon);
 const oldPP={supernova:0,atlas_crystal_4:5,starlight:8,shell:3},expected=Object.fromEntries([...D.species.futo.moves].map((id,i)=>[id,Math.min(oldPP[old[i]],e.maxPP(id))]));
 const save=e.serialize();save.party[1].customMoves=old;save.party[1].pp=copy(oldPP);const loaded=new Engine(save),restored=loaded.state.party[1];
 assert.deepEqual(copy(restored.pp),expected);assert.deepEqual(copy(restored.moveOrder),ORDER);assert.deepEqual(copy(restored.customMoves),[...D.species.futo.moves]);
 mon.customMoves=old;mon.pp=copy(oldPP);e.syncPP(mon);assert.deepEqual(copy(mon.pp),expected);assert.deepEqual(copy(mon.moveOrder),ORDER);assert.deepEqual(ids(e,mon),ids(loaded,restored));
});

test('trades preserve the existing server PP format, leave local order untouched and receive standard order',()=>{
 const {e,mon}=fixture('fuwari');variedPP(e,mon);arrange(e,mon);const before=copy(mon),plain=copy(mon);delete plain.moveOrder;
 const wire=e.toTradeWire(mon);assert.deepEqual(copy(wire),copy(e.toTradeWire(plain)));assert(!Object.hasOwn(wire,'moveOrder'));assert(!Object.hasOwn(e.tradeMonster(mon),'moveOrder'));assert.deepEqual(copy(mon),before);
 const forged=copy(mon);delete forged.pp[Object.keys(forged.pp)[0]];forged.pp.null_ray=1;assert.throws(()=>e.tradeMonster(forged),/技/);
 const room='12345678-1234-4234-8234-123456789abc',incoming=e.makeMonster('shizuku',30);incoming.uid='tr-'+room+'-g';incoming.moveOrder=ORDER;
 const receipt={id:'trade:'+room,outgoingUid:mon.uid,outgoing:wire,incoming:e.toTradeWire(incoming),revision:1};assert(e.applyTrade(receipt).ok);
 const received=e.state.party[1];assert.equal(received.uid,incoming.uid);assert.equal(received.moveOrder,undefined);assert.deepEqual(ids(e,received),[...D.species.shizuku.moves]);assert.doesNotThrow(()=>new Engine(e.serialize()));
});

function section(from,to){const start=html.indexOf(from),end=html.indexOf(to,start);assert(start>0&&end>start,from);return html.slice(start,end);}
const uiSource=section('  function persistMoveOrder(','  function partyDepositReason(');
function ui(kind='komori',location='party'){
 const {e,mon}=fixture(kind,location);variedPP(e,mon);mon.nickname='<A>';const elements=new Map();
 const c=vm.createContext({Engine,DATA:D,LT:{...model.LT,onlineActive:false,localTradeActive:false},engine:e,uid:mon.uid,playing:true,busy:false,tradeLock:false,
  storedSave:{previous:true},lastSave:7,SAVE_KEY:'move-order-save',writes:[],attempts:0,updates:0,toasts:[],storageFails:false,
  performance:{now:()=>123},tradeLocked:()=>c.tradeLock,escape:value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),nameOf:item=>model.LT.displayName(item),typeBadge:()=>'',
  $:id=>elements.get(id),updateAll:()=>{c.updates++;},toast:message=>c.toasts.push(message),
  showParty:index=>{c.navigation={source:'party',index};},showStorageDetail:uid=>{c.navigation={source:'storage',uid};},
  localStorage:{setItem(key,value){c.attempts++;c.onWrite?.();if(c.storageFails)throw Error('Quota exceeded');c.writes.push([key,value]);}},
  openModal(title,markup,pane){c.modal={title,markup,pane};elements.clear();for(const tag of markup.matchAll(/<[a-z][\w-]*\b([^>]*)>/gi)){
   const attrs=Object.fromEntries([...tag[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(match=>[match[1],match[2]??'']));
   if(attrs.id)elements.set(attrs.id,{attrs,hidden:Object.hasOwn(attrs,'hidden'),textContent:'',focus(options){c.focused={id:attrs.id,options};}});
  }}
 });
 vm.runInContext(uiSource,c);c.elements=elements;return c;
}
const owned=c=>[...c.engine.state.party,...c.engine.state.storage].find(mon=>mon.uid===c.uid);
function persist(c,from=2,to=0,expected=c.engine,snapshot=ids(c.engine,owned(c))){return c.persistMoveOrder(c.uid,from,to,expected,snapshot);}
function click(c,from,to,disabled=false,handler=c.elements.get('move-order-list').onclick){handler({target:{closest:selector=>selector==='[data-move-order]'?{disabled,dataset:{moveOrder:String(from),moveTo:String(to)}}:null}});}
function rejectUI(c,action){const state=c.engine.state,before=copy(state),stored=c.storedSave,attempts=c.attempts,last=c.lastSave,result=action();if(result!==undefined)assert.equal(result.ok,false);assert.equal(c.engine.state,state);assert.deepEqual(copy(c.engine.state),before);assert.equal(c.storedSave,stored);assert.equal(c.lastSave,last);assert.equal(c.attempts,attempts);}

test('real move-order callbacks commit only after saving, retry failures, keep PP and focus the moved row',()=>{
 const c=ui(),mon=owned(c),before=copy(c.engine.state),state=c.engine.state,stored=c.storedSave,original=ids(c.engine,mon);c.showMoveOrder(c.uid);
 assert.equal(c.modal.pane,'move-order');assert.equal((c.modal.markup.match(/class="move-order-row"/g)||[]).length,4);assert(c.modal.markup.includes('&lt;A&gt;'));assert(!c.modal.markup.includes('<A>'));
 assert(/data-move-order="0" data-move-to="-1"[^>]* disabled/.test(c.modal.markup));assert(/data-move-order="3" data-move-to="4"[^>]* disabled/.test(c.modal.markup));
 for(const move of c.engine.moveDetails(mon))assert(c.modal.markup.includes(`PP ${move.pp} / ${move.maxPP}`));
 c.onWrite=()=>{assert.equal(c.engine.state,state);assert.deepEqual(copy(c.engine.state),before);assert.equal(c.storedSave,stored);};
 c.storageFails=true;click(c,2,0);assert.equal(c.engine.state,state);assert.deepEqual(copy(c.engine.state),before);assert.equal(c.storedSave,stored);assert.equal(c.lastSave,7);assert.equal(c.writes.length,0);assert.equal(c.elements.get('move-order-result').hidden,false);
 c.storageFails=false;click(c,2,0);assert.equal(c.writes.length,1);assert.equal(c.lastSave,123);assert.notEqual(c.engine.state,state);assert.deepEqual(ids(c.engine,owned(c)),[original[2],original[0],original[1],original[3]]);assert.deepEqual(copy(owned(c).pp),copy(mon.pp));
 assert.equal(c.focused.id,'move-order-row-0');assert(c.focused.options.preventScroll);assert(c.modal.markup.includes('保存しました'));assert(c.updates>0);
 assert.deepEqual(copy(new Engine(JSON.parse(c.writes[0][1])).state),copy(c.engine.state));
 const after=copy(c.engine.state);click(c,0,-1,true);assert.deepEqual(copy(c.engine.state),after);assert.equal(c.writes.length,1);
});

test('UI rejects changed techniques, layouts, adventures, invalid snapshots and all communication locks without writing',()=>{
 for(const change of ['order','moves','engine','missing']){
  const c=ui('custom-futo');c.showMoveOrder(c.uid);const handler=c.elements.get('move-order-list').onclick;
  if(change==='order')assert(c.engine.moveMove(c.uid,0,1).ok);
  if(change==='moves'){owned(c).customMoves=[...D.species.futo.moves];c.engine.syncPP(owned(c));}
  if(change==='engine')c.engine=new Engine(c.engine.serialize());
  if(change==='missing')c.engine.state.party.splice(1,1);
  rejectUI(c,()=>click(c,2,0,false,handler));assert.equal(c.elements.get('move-order-result').hidden,false);
 }
 for(const block of ['playing','busy','battle','online','local-trade','trade-lock']){
  const c=ui();if(block==='playing')c.playing=false;if(block==='busy')c.busy=true;if(block==='battle')c.engine.battle={};
  if(block==='online')c.LT.onlineActive=true;if(block==='local-trade')c.LT.localTradeActive=true;if(block==='trade-lock')c.tradeLock=true;
  rejectUI(c,()=>persist(c));c.showMoveOrder(c.uid);assert.equal(c.modal,undefined);assert(c.toasts.length>0);
 }
 for(const snapshot of [null,[],new Array(4),['wrong','wrong','wrong','wrong']]){const c=ui();rejectUI(c,()=>persist(c,2,0,c.engine,snapshot));}
 for(const [from,to] of [[-1,0],[0,4],['0',1],[0,1.5],[NaN,0]]){const c=ui();rejectUI(c,()=>persist(c,from,to));}
});

test('reserve monsters reorder through the same UI and returning to details resolves the current UID location',()=>{
 const c=ui('nullmie','storage');c.showMoveOrder(c.uid);const before=copy(owned(c)),original=ids(c.engine,owned(c));click(c,3,0);
 assert.deepEqual(ids(c.engine,owned(c)),[original[3],original[0],original[1],original[2]]);assert.deepEqual(copy(owned(c).pp),before.pp);
 c.elements.get('move-order-back').onclick();assert.deepEqual(c.navigation,{source:'storage',uid:c.uid});
 c.showMoveOrder(c.uid);const back=c.elements.get('move-order-back').onclick;assert(c.engine.exchange(c.engine.state.party.length,0).ok);back();assert.deepEqual(c.navigation,{source:'party',index:1});
 const party=section('  function showParty(','  const HELD_ITEMS='),storage=section('  function showStorageDetail(','  function showNickname(');
 assert(party.includes('data-move-order-open='));assert(storage.includes('data-move-order-open='));assert(html.includes('if(d.moveOrderOpen)'));
});
console.log(`Move order checks passed: ${passed} groups covering strict permutations, canonical PP, real battle slots, both collections, evolution/Futo/legacy saves, trades and actual UI persistence/guards/callbacks.`);
