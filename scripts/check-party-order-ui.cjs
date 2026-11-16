#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),model=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],model);if(model.LT?.Engine)break;
}
const {Engine,DATA,displayName}=model.LT,copy=value=>JSON.parse(JSON.stringify(value));
function fresh(){
  const e=new Engine();assert(e.newGame(DATA.starters[0]).ok);
  for(const id of DATA.starters.slice(1))e.state.party.push(e.makeMonster(id,7));
  assert(e.grantFuto({grantId:'admin-initial:P1234567890abcdef',level:70,stats:{hp:1000,atk:250,def:250,spAtk:250,spDef:250,speed:250,accuracy:100,evasion:100},moves:DATA.species.futo.moves.slice()}).ok);
  assert(e.receiveAdminMythical({grantId:'admin-mythical:P1234567890abcdef',species:'floravelle',level:70}).ok);
  e.state.party.push(e.makeMonster('arvelion',70));
  for(const mon of e.state.party)e.markCaught(mon.species);
  e.state.party[1].hp=0;e.state.party[2].nickname='<A>';e.state.party[2].xp=3;e.state.party[2].shiny=true;
  e.state.party[2].pp[e.moves(e.state.party[2])[0].id]=1;
  return e;
}
const elements=new Map(),writes=[];let quota=false;
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const c=vm.createContext({tradeLocked:()=>false,console,Engine,DATA,LT:{onlineActive:false},engine:fresh(),playing:true,busy:false,storedSave:null,lastSave:0,moveAnim:{},SAVE_KEY:'party-save',performance:{now:()=>123},escape:esc,nameOf:displayName,
  portrait:()=>'<canvas></canvas>',updateAll(){c.updates=(c.updates||0)+1;},toast(message){c.toastMessage=message;},$:id=>elements.get(id),
  localStorage:{setItem(key,value){if(quota)throw Error('Quota');writes.push({key,value});}},
  openModal(title,markup,pane){c.modal={title,markup,pane};elements.clear();for(const match of markup.matchAll(/id="([^"]+)"/g))elements.set(match[1],{hidden:false,textContent:'',focus(options){c.focused={id:match[1],options};}});}
});
const start=html.indexOf('  function persistPartyOrder('),end=html.indexOf('  function showParty(',start);assert(start>0&&end>start);
vm.runInContext(html.slice(start,end),c);
function click(from,to,disabled=false,handler=elements.get('party-order-list').onclick){
  const button={disabled,dataset:{partyOrder:String(from),partyTo:String(to),partyUid:c.engine.state.party[from].uid}};
  handler({target:{closest:selector=>selector==='[data-party-order]'?button:null}});
}
assert.doesNotThrow(()=>new Engine(c.engine.serialize()),'UI fixture is a valid saved adventure');
const original=copy(c.engine.serialize()),identities=new Map(original.party.map(mon=>[mon.uid,mon]));
c.showPartyOrder();assert.equal(c.modal.pane,'party-order');assert.equal((c.modal.markup.match(/class="party-order-row"/g)||[]).length,6);
assert(c.modal.markup.includes('&lt;A&gt;'));assert(!c.modal.markup.includes('<A>'));
assert(/data-party-order="0" data-party-to="-1"[^>]* disabled/.test(c.modal.markup));
assert(/data-party-order="5" data-party-to="6"[^>]* disabled/.test(c.modal.markup));
const faintedUID=c.engine.state.party[1].uid;click(1,0);assert.equal(c.engine.state.party[0].uid,faintedUID,'Fainted members can be ordered without healing or losing data');
assert.equal(c.focused.id,'party-order-row-0');assert(c.focused.options.preventScroll);assert.equal(c.moveAnim,null);assert.equal(c.lastSave,123);
const movedUID=c.engine.state.party[3].uid;click(3,5);assert.equal(c.engine.state.party[5].uid,movedUID);
for(const mon of c.engine.serialize().party)assert.deepEqual(copy(mon),identities.get(mon.uid),'Reordering preserves all individual data');
const after=copy(c.engine.serialize());delete after.party;const unchanged=copy(original);delete unchanged.party;assert.deepEqual(after,unchanged,'Reordering changes no other adventure fields');
assert.equal(writes.length,2);assert.equal(writes[1].key,'party-save');
assert.deepEqual(copy(new Engine(JSON.parse(writes[1].value)).state.party),copy(c.engine.state.party),'The written order survives reload');
let before=JSON.stringify(c.engine.serialize()),state=c.engine.state,save=c.storedSave;
quota=true;click(2,1);assert.equal(JSON.stringify(c.engine.serialize()),before);assert.equal(c.engine.state,state);assert.equal(c.storedSave,save);assert.equal(writes.length,2);
assert.equal(elements.get('party-order-result').hidden,false);assert(elements.get('party-order-result').textContent.includes('並びは変更していません'));
quota=false;click(2,1);assert.equal(writes.length,3,'A failed move can be retried from the same rendered order');
before=JSON.stringify(c.engine.serialize());click(0,1,true);assert.equal(JSON.stringify(c.engine.serialize()),before);
// A delayed click cannot move a different occupant after another update.
c.showPartyOrder();const staleHandler=elements.get('party-order-list').onclick;c.engine.state.party.reverse();before=JSON.stringify(c.engine.serialize());click(1,2,false,staleHandler);assert.equal(JSON.stringify(c.engine.serialize()),before);assert(elements.get('party-order-result').textContent.includes('並びが変わりました'));
for(const blocked of ['busy','battle','online','title','engine']){
  c.engine=fresh();c.busy=false;c.playing=true;c.LT.onlineActive=false;c.showPartyOrder();
  const handler=elements.get('party-order-list').onclick;
  if(blocked==='busy')c.busy=true;if(blocked==='battle')c.engine.battle={};if(blocked==='online')c.LT.onlineActive=true;if(blocked==='title')c.playing=false;if(blocked==='engine')c.engine=new Engine(c.engine.serialize());
  before=JSON.stringify(c.engine.serialize());const count=writes.length;click(1,0,false,handler);assert.equal(JSON.stringify(c.engine.serialize()),before,blocked);assert.equal(writes.length,count,blocked);
}
assert(html.includes("['party-order','switch','パーティーの並べ替え']"));assert(html.includes("'party-order':showPartyOrder"));assert(html.includes('data-ui="party-order">パーティーを並べ替える'));
console.log('Party order UI checks passed: six touch/keyboard rows, escaped names, disabled endpoints, fainted/member metadata preserved, atomic save and retry, reload, focus retention, stale order and adventure guards, menu/detail entry points.');
