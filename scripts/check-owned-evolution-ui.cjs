#!/usr/bin/env node
'use strict';
// Keep the actual party/reserve detail screens free of the removed form action.
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
function ui(destination='party',level=100,species='lunaxion'){
  const e=new Engine();assert(e.newGame('komori').ok);const mon=e.makeMonster(species,level);
  Object.assign(mon,{nickname:'<A>',shiny:true,heldItem:'trainband',bonusPoints:99,
    alloc:{hp:31,atk:62},moveOrder:[3,0,2,1],xp:level===100?0:13});
  mon.hp=Math.round(e.stats(mon).hp*.4);mon.pp.lunax_crescent=0;e.state[destination].push(mon);e.markCaught(species);
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
test('party and reserve show the finished Lunaxion form at every level without an evolution action',()=>{
  for(const destination of ['party','storage'])for(const level of [1,49,50,70,100]){
    const c=ui(destination,level),before=copy(c.engine.state);details(c);
    assert.equal(c.modal.pane,destination==='party'?'party':'storage-detail');
    assert(c.modal.markup.includes('data-creature="lunaxion"'));assert(!c.modal.markup.includes('galdogran'));
    assert(!c.modal.markup.includes('gender-mark'));assert.equal(model.LT.genderOf(owned(c)),'none');
    assert(!c.modal.markup.includes('owned-evolution'));assert(!c.modal.markup.includes('ガルドグラン'));
    assert(c.modal.markup.includes('&lt;A&gt;'));assert(!c.modal.markup.includes('<A>'));
    assert(c.modal.markup.includes('data-nickname='));assert(c.modal.markup.includes('data-move-order-open='));
    assert.deepEqual(copy(c.engine.state),before);assert.equal(c.attempts,0);
    if(destination==='party')assert(c.modal.markup.includes('完成した姿'));
  }
});

test('old owned-form saves render the canonical details with the same individual and no save side effect',()=>{
  for(const destination of ['party','storage']){
    const c=ui(destination),raw=c.engine.serialize(),old=raw[destination].find(mon=>mon.uid===c.uid);old.species='galdogran';
    raw.seen.push('galdogran');raw.caught.push('galdogran');c.engine=new Engine(raw);
    const before=copy(c.engine.state);details(c);
    assert.equal(owned(c).species,'lunaxion');assert.equal(owned(c).nickname,'<A>');
    assert(c.modal.markup.includes('ルナクシオン'));assert(!c.modal.markup.includes('owned-evolution'));
    assert.deepEqual(copy(c.engine.state),before);assert.equal(c.attempts,0);
  }
});

test('ordinary species keep their existing evolution notice and the removed action is absent from shipped UI',()=>{
  const c=ui(),mon=owned(c);mon.species='komori';mon.level=5;details(c);
  assert(c.modal.markup.includes('新しい姿に進化します'));assert(!c.elements.has('owned-evolution-open'));
  for(const name of ['ownedEvolutionPanel','bindOwnedEvolution','persistOwnedEvolution','showOwnedEvolution'])assert(!html.includes('function '+name+'('));
  assert.equal(Engine.prototype.evolveOwned,undefined);assert.equal(DATA.species.lunaxion.evolvesTo,undefined);
});


test('the normal lunar form explains its growth stage in party and reserve without adding a manual mutation',()=>{
  for(const destination of ['party','storage'])for(const species of ['lunax'])for(const level of [1,47,48,100]){
    const c=ui(destination,level,species),before=copy(c.engine.state),data=DATA.species[species];details(c);
    assert(c.modal.markup.includes('data-creature="'+species+'"'));assert(c.modal.markup.includes('Lv.'+data.evolveLevel));
    assert(!c.modal.markup.includes('gender-mark'));assert.equal(model.LT.genderOf(owned(c)),'none');
    assert(c.modal.markup.includes(DATA.species[data.evolvesTo].name));assert(!c.modal.markup.includes('ガルドグラン'));
    assert(!c.elements.has('owned-evolution-open'));assert.equal(c.attempts,0);assert.deepEqual(copy(c.engine.state),before);
    if(level>=data.evolveLevel){assert(c.modal.markup.includes('次のバトルで経験値'));assert(c.modal.markup.includes('Lv.100でも進化'));assert(c.modal.markup.includes('パーティーに迎え'));}
    else assert(!c.modal.markup.includes('進化できるレベルに達しています'));
    owned(c).heldItem='everpebble';details(c);assert(c.modal.markup.includes('とどまりの小石'));assert(!c.modal.markup.includes('次のバトルで経験値'));
  }
});
