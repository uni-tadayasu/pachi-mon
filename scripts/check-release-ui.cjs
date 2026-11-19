#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const model=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],model);
  if(model.LT?.Engine)break;
}
const {Engine,DATA}=model.LT;
const fresh=()=>{const e=new Engine();e.newGame(DATA.starters[0]);e.state.party.push(e.makeMonster(DATA.starters[1],5));e.state.seen.push(DATA.starters[1]);e.state.caught.push(DATA.starters[1]);return e;};
const writes=new Map(),elements=new Map();let storageFails=false;
const c=vm.createContext({tradeLocked:()=>false,Engine,DATA,LT:{onlineActive:false},engine:fresh(),playing:true,busy:false,storedSave:null,lastSave:0,moveAnim:{},
  SAVE_KEY:'release-save',performance:{now:()=>123},escape:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'),
  portrait:(id,size)=>`<canvas data-creature="${id}" data-size="${size}"></canvas>`,creatureView:()=>'<canvas></canvas>',nameOf:mon=>model.LT.displayName(mon),shinyBadge:()=>'',creatureDescription:species=>species.description,typeBadge:()=>'',speciesBadges:()=>'',abilityPanel:()=>'',hpBar:()=>'',
  localStorage:{setItem(key,value){if(storageFails)throw Error('Quota exceeded');writes.set(key,value);}},
  $:id=>elements.get(id),updateAll:()=>{c.updates=(c.updates||0)+1;},toast:message=>{c.toastMessage=message;},
  showParty:index=>{c.navigation={source:'party',index};},showStorage:index=>{c.navigation={source:'storage',index};},
  openModal(title,markup,pane){c.modal={title,markup,pane};elements.clear();for(const match of markup.matchAll(/id="([^"]+)"/g))elements.set(match[1],{disabled:false,hidden:false,focus(){c.focused=match[1];}});}
});
const start=html.indexOf('  function persistRelease('),end=html.indexOf('  function showDex(',start);
assert(start>0&&end>start);vm.runInContext(html.slice(start,end),c);
const persist=(index,source='party',uid=c.engine.state[source][index]?.uid,expected=c.engine)=>c.persistRelease(index,source,uid,expected);
const state=()=>JSON.stringify(c.engine.serialize());
let before=state(),originalState=c.engine.state;
storageFails=true;
assert.equal(persist(1).ok,false);
assert.equal(state(),before,'Failed save must leave every live field intact');
assert.equal(c.engine.state,originalState,'Failed save retains the original state object');
assert.equal(c.storedSave,null);assert.equal(c.lastSave,0);assert.equal(writes.size,0);
storageFails=false;
assert.equal(persist(1).ok,true);
assert.equal(c.engine.state.party.length,1);assert.equal(c.lastSave,123);
assert.equal(new Engine(JSON.parse(writes.get('release-save'))).state.party.length,1);
assert.equal(persist(0).ok,false,'Last party member cannot be released');

c.engine=fresh();c.engine.state.party[1].hp=0;before=state();
assert.equal(persist(0).ok,false,'Last able member cannot be released');assert.equal(state(),before);
assert.equal(persist(1).ok,true,'An unconscious spare member may be released');
for(const block of ['battle','busy','online','not-playing']){
  c.engine=fresh();before=state();
  c.engine.battle=block==='battle'?{}:null;c.busy=block==='busy';c.LT.onlineActive=block==='online';c.playing=block!=='not-playing';
  assert.equal(persist(1).ok,false,block+' blocks release');assert.equal(state(),before);
}
c.busy=false;c.LT.onlineActive=false;c.playing=true;c.engine=fresh();
const previous=c.engine,uid=c.engine.state.party[1].uid;
c.engine.state.party.reverse();before=state();
assert.equal(persist(1,'party',uid,previous).ok,false,'Reordered party cannot release the replacement occupant');assert.equal(state(),before);
c.engine=new Engine(c.engine.serialize());
assert.equal(persist(0,'party',uid,previous).ok,false,'Replacing the active adventure invalidates the confirmation');

// Gift receipts survive both storage and party release and block automatic redelivery.
c.engine=fresh();
const grant={grantId:'release-gift',species:'futo',level:50,stats:{hp:5000,atk:420,def:360,spAtk:520,spDef:410,speed:260,accuracy:120,evasion:105},moves:['supernova','atlas_crystal_4','starlight','shell']};
assert.equal(c.engine.grantFuto(grant).ok,true);
let giftIndex=c.engine.state.party.findIndex(m=>m.grantId===grant.grantId);
assert.equal(persist(giftIndex).ok,true);assert(c.engine.state.giftReceipts.includes(grant.grantId));
assert(c.engine.state.caught.includes('futo'));assert(c.engine.state.seen.includes('futo'));
assert.equal(c.engine.grantFuto(grant).alreadyReceived,true);
c.engine.state.storage.push(c.engine.makeMonster(DATA.starters[0],5));
const storageUid=c.engine.state.storage[0].uid;
assert.equal(persist(0,'storage').ok,true);assert(!c.engine.state.storage.some(m=>m.uid===storageUid));
assert(c.engine.state.giftReceipts.includes(grant.grantId));

// Exercise the actual confirmation callbacks, including cancellation and retry.
c.engine=fresh();before=state();c.confirmRelease(1,'party');
assert(c.modal.markup.includes('元には戻せません'));assert(c.modal.markup.includes('図鑑'));
assert.equal(c.focused,'release-cancel','The non-destructive action receives initial focus');
elements.get('release-cancel').onclick();assert.deepEqual(c.navigation,{source:'party',index:1});assert.equal(state(),before);
c.confirmRelease(1,'party');storageFails=true;elements.get('release-confirm').onclick();
assert.equal(state(),before);assert.equal(elements.get('release-result').hidden,false);assert.equal(elements.get('release-confirm').disabled,false);
storageFails=false;elements.get('release-confirm').onclick();
assert.equal(c.engine.state.party.length,1);assert.equal(c.navigation.source,'party');assert.equal(c.navigation.index,0);assert.equal(c.moveAnim,null);assert(c.updates>0);
c.engine=fresh();c.engine.state.storage.push(c.engine.makeMonster(DATA.starters[0],5));c.confirmRelease(0);elements.get('release-cancel').onclick();
assert.deepEqual(c.navigation,{source:'storage',index:-2});

const partyStart=html.indexOf('  function partyDepositReason('),partyEnd=html.indexOf('  function showStorage(',partyStart);
vm.runInContext(html.slice(partyStart,partyEnd),c);
c.engine=fresh();c.showParty(1);assert(c.modal.markup.includes('data-release-source="party"'));assert(c.modal.markup.includes('>逃がす</button>'));
c.engine.state.party.splice(1);c.showParty(0);assert(c.modal.markup.includes('disabled aria-describedby="party-release-reason"'));assert(c.modal.markup.includes('最後の1体は逃がせません。'));
console.log('Release UI checks passed: confirmation/cancel, UID/session guards, save-failure retry without mutation, party safety, stored reload and gift receipt preservation.');
