#!/usr/bin/env node
'use strict';
// Exercise the actual detail/confirmation callbacks and save transaction.
const assert=require('node:assert/strict'),test=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),model=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],model);if(model.LT?.Engine)break;
}
const {Engine,DATA}=model.LT,copy=value=>JSON.parse(JSON.stringify(value));
function section(from,to){const start=html.indexOf(from),end=html.indexOf(to,start);assert(start>0&&end>start,from);return html.slice(start,end);}
const source=[section('  function partyDepositReason(','  const HELD_ITEMS='),
  section('  function findOwned(','  function showNickname(')].join('\n');
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function ui(destination='party',level=100){
  const e=new Engine();assert(e.newGame('komori').ok);const mon=e.makeMonster('galdoras',level);
  Object.assign(mon,{nickname:'<A>',gender:'male',shiny:true,heldItem:'trainband',bonusPoints:99,
    alloc:{hp:31,atk:62},moveOrder:[3,0,2,1],xp:level===100?0:13});
  mon.hp=Math.round(e.stats(mon).hp*.4);mon.pp.galdoras_crown=0;e.state[destination].push(mon);e.markCaught('galdoras');
  const elements=new Map(),c=vm.createContext({Engine,DATA,HELD_ITEMS:DATA.heldItems,LT:{...model.LT,onlineActive:false,localTradeActive:false},
    engine:e,uid:mon.uid,playing:true,busy:false,tradeLock:false,storedSave:{previous:true},lastSave:7,moveAnim:null,
    SAVE_KEY:'evolution-save',writes:[],attempts:0,updates:0,toasts:[],sounds:[],storageFails:false,
    performance:{now:()=>123},tradeLocked:()=>c.tradeLock,escape,nameOf:mon=>model.LT.displayName(mon),
    portrait:mon=>`<canvas data-creature="${escape(typeof mon==='string'?mon:mon.species)}"></canvas>`,
    creatureView:mon=>`<canvas data-creature="${escape(typeof mon==='string'?mon:mon.species)}"></canvas>`,
    creatureDescription:species=>species.description,genderMark:()=>'',shinyBadge:()=>'',speciesBadges:()=>'',conditionChip:()=>'',
    abilityPanel:()=>'',partyVitals:()=>'',statCells:()=>'',allocationPanel:()=>'',typeBadge:()=>'',
    $:id=>elements.get(id),updateAll:()=>{c.updates++;},toast:message=>c.toasts.push(message),sound:{fx:name=>c.sounds.push(name)},
    localStorage:{setItem(key,value){c.attempts++;c.onWrite?.(value);if(c.storageFails)throw Error('Quota exceeded');c.writes.push([key,value]);}},
    openModal(title,markup,pane){
      c.modal={title,markup,pane};elements.clear();
      for(const tag of markup.matchAll(/<[a-z][\w-]*\b([^>]*)>/gi)){
        const attrs=Object.fromEntries([...tag[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(match=>[match[1],match[2]??'']));
        if(attrs.id)elements.set(attrs.id,{attrs,disabled:Object.hasOwn(attrs,'disabled'),hidden:Object.hasOwn(attrs,'hidden'),textContent:'',focus(){c.focused=attrs.id;}});
      }
    }
  });
  vm.runInContext(source,c);c.elements=elements;return c;
}
const owned=c=>[...c.engine.state.party,...c.engine.state.storage].find(mon=>mon.uid===c.uid);
function details(c){const index=c.engine.state.party.findIndex(mon=>mon.uid===c.uid);if(index>=0)c.showParty(index);else c.showStorageDetail(c.uid);}
function rejectWithoutWrite(c,action){const state=c.engine.state,before=copy(state),stored=c.storedSave,last=c.lastSave,attempts=c.attempts;
  action();assert.equal(c.engine.state,state);assert.deepEqual(copy(c.engine.state),before);assert.equal(c.storedSave,stored);assert.equal(c.lastSave,last);assert.equal(c.attempts,attempts);
}

test('both owned-detail screens offer Lv50 evolution, preview its new art, escape nicknames and allow cancellation',()=>{
  for(const destination of ['party','storage'])for(const level of [50,100]){
    const c=ui(destination,level),before=copy(c.engine.state);details(c);
    assert(c.modal.markup.includes('ガルドグランへ進化'));assert(c.elements.has('owned-evolution-open'));
    c.elements.get('owned-evolution-open').onclick();assert.equal(c.modal.pane,'owned-evolution');
    assert(c.modal.markup.includes('data-creature="galdogran"'));assert(c.modal.markup.includes('&lt;A&gt;'));assert(!c.modal.markup.includes('<A>'));
    assert(c.modal.markup.includes('残りPP'));assert(c.modal.markup.includes('体力は現在の割合'));assert(c.modal.markup.includes('戻せません'));
    assert.equal(c.focused,'owned-evolution-cancel');c.elements.get('owned-evolution-cancel').onclick();
    assert.equal(c.modal.pane,destination==='party'?'party':'storage-detail');assert.deepEqual(copy(c.engine.state),before);assert.equal(c.attempts,0);
  }
  const young=ui('party',49);details(young);assert(!young.elements.has('owned-evolution-open'));
  const evolved=ui();assert(evolved.engine.evolveOwned(evolved.uid).ok);details(evolved);assert(!evolved.elements.has('owned-evolution-open'));
});

test('confirmation writes before applying and failed storage can retry with the entire live individual intact',()=>{
  for(const destination of ['party','storage']){
    const c=ui(destination),state=c.engine.state,before=copy(state),previous=copy(owned(c)),oldMax=c.engine.stats(owned(c)).hp,stored=c.storedSave;
    c.showOwnedEvolution(c.uid);
    c.onWrite=value=>{assert.equal(c.engine.state,state);assert.deepEqual(copy(c.engine.state),before);assert.equal(c.storedSave,stored);
      assert.equal(JSON.parse(value)[destination].find(mon=>mon.uid===c.uid).species,'galdogran');};
    c.storageFails=true;c.elements.get('owned-evolution-confirm').onclick();
    assert.equal(c.engine.state,state);assert.deepEqual(copy(c.engine.state),before);assert.equal(c.storedSave,stored);assert.equal(c.lastSave,7);assert.equal(c.writes.length,0);
    assert.equal(c.elements.get('owned-evolution-result').hidden,false);assert.equal(c.elements.get('owned-evolution-confirm').disabled,false);assert.equal(c.sounds.length,0);
    c.storageFails=false;c.elements.get('owned-evolution-confirm').onclick();
    assert.equal(c.writes.length,1);assert.equal(c.lastSave,123);assert.notEqual(c.engine.state,state);assert.equal(owned(c).species,'galdogran');
    assert.equal(owned(c).hp,Math.round(previous.hp*c.engine.stats(owned(c)).hp/oldMax));
    assert.deepEqual({...copy(owned(c)),species:'galdoras',hp:previous.hp},previous);
    assert.equal(c.modal.pane,destination==='party'?'party':'storage-detail');assert.deepEqual(c.sounds,['evolution']);assert(c.updates>0);
    assert.deepEqual(copy(new Engine(JSON.parse(c.writes[0][1])).state),copy(c.engine.state));
  }
});

test('busy states, communication and exchange locks block opening and committing an existing confirmation',()=>{
  for(const block of ['not-playing','busy','battle','online','local-trade','trade-lock']){
    const c=ui();c.showOwnedEvolution(c.uid);const confirm=c.elements.get('owned-evolution-confirm').onclick;
    if(block==='not-playing')c.playing=false;if(block==='busy')c.busy=true;if(block==='battle')c.engine.battle={};
    if(block==='online')c.LT.onlineActive=true;if(block==='local-trade')c.LT.localTradeActive=true;if(block==='trade-lock')c.tradeLock=true;
    rejectWithoutWrite(c,confirm);assert.equal(c.elements.get('owned-evolution-result').hidden,false);
    c.modal=null;rejectWithoutWrite(c,()=>c.showOwnedEvolution(c.uid));assert.equal(c.modal,null);assert(c.toasts.length>0);
  }
});

test('changed adventures, missing or changed individuals and stopped evolution never commit a stale choice',()=>{
  for(const change of ['engine','missing','nickname','held-item','evolved']){
    const c=ui();c.showOwnedEvolution(c.uid);const confirm=c.elements.get('owned-evolution-confirm').onclick;
    if(change==='engine')c.engine=new Engine(c.engine.serialize());if(change==='missing')c.engine.state.party.splice(1,1);
    if(change==='nickname')owned(c).nickname='かわった';if(change==='held-item')owned(c).heldItem='everpebble';
    if(change==='evolved')assert(c.engine.evolveOwned(c.uid).ok);
    rejectWithoutWrite(c,confirm);assert.equal(c.elements.get('owned-evolution-result').hidden,false);
  }
  for(const destination of ['party','storage']){
    const c=ui(destination);owned(c).heldItem='everpebble';details(c);
    assert.equal(c.elements.get('owned-evolution-open').disabled,true);assert(c.modal.markup.includes('とどまりの小石を外す'));
    rejectWithoutWrite(c,()=>c.elements.get('owned-evolution-open').onclick());c.showOwnedEvolution(c.uid);
    assert.equal(c.elements.get('owned-evolution-confirm').disabled,true);rejectWithoutWrite(c,()=>c.elements.get('owned-evolution-confirm').onclick());
  }
  const moved=ui('storage');moved.showOwnedEvolution(moved.uid);const confirm=moved.elements.get('owned-evolution-confirm').onclick;
  assert(moved.engine.exchange(moved.engine.state.party.length,0).ok);confirm();
  assert.equal(owned(moved).species,'galdogran');assert.equal(moved.modal.pane,'party');assert.equal(moved.writes.length,1);
});
