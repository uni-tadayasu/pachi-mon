#!/usr/bin/env node
'use strict';
// Render the production UI functions against the actual catalog and Engine.
// Only unrelated image/stat widgets and the modal destination are replaced.
const assert=require('node:assert/strict'),test=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),model=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],model);if(model.LT?.Engine)break;
}
const {Engine,DATA,displayName}=model.LT,hiddenIds=Object.keys(DATA.species).filter(id=>DATA.species[id].hiddenDex);
const publicIds=Object.keys(DATA.species).filter(id=>!DATA.species[id].hiddenDex);
const publicTypes=['leaf','tide','ember','wind','crystal','thunder','ice','earth','stone'];
function section(from,to){const start=html.indexOf(from),end=html.indexOf(to,start);assert(start>=0&&end>start);return html.slice(start,end);}
const source=[section('  function typeBadge(', '  const nameOf='),
  section('  function showDex(', '  function showMap() {'),
  section('  function partyDepositReason(', '  const HELD_ITEMS='),
  section('  function showRecords(){', '  function showMenu() {')].join('\n');
const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function ui(complete=false){
  const engine=new Engine();assert(engine.newGame('komori','female','みどり').ok);
  for(const id of hiddenIds)engine.markCaught(id);
  if(complete){engine.state.seen=Object.keys(DATA.species);engine.state.caught=Object.keys(DATA.species);}
  const elements=new Map(),opened=[],previews=[];
  const context=vm.createContext({DATA,LT:model.LT,engine,playing:true,escape,HELD_ITEMS:DATA.heldItems,
    $:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);},
    openModal(title,markup,pane){opened.push({title,markup,pane});},
    portrait:id=>`<canvas data-creature="${escape(typeof id==='string'?id:id.species)}"></canvas>`,
    creatureView:mon=>`<canvas data-creature="${escape(typeof mon==='string'?mon:mon.species)}"></canvas>`,
    nameOf:displayName,creatureDescription:species=>species.description,
    genderMark:()=>'',shinyBadge:()=>'',conditionChip:()=>'',partyVitals:()=>'',statCells:()=>'',allocationPanel:()=>'',
    toast:()=>{},heardTracks:()=>new Set(),sound:{getTracks:()=>[],preview:id=>previews.push(id)}});
  vm.runInContext(source,context);
  return {context,engine,elements,opened,previews,get modal(){return opened.at(-1);}};
}
const cards=markup=>[...markup.matchAll(/\bdata-dex="([^"]+)"/g)].map(match=>match[1]);
function assertNoHidden(markup){for(const id of hiddenIds){assert(!markup.includes(id),`Hidden ID ${id} leaked`);assert(!markup.includes(DATA.species[id].name),`Hidden name ${id} leaked`);}}

test('all 268 internal discoveries still render exactly the 256 public dex entries',()=>{
  const app=ui(true);assert.equal(app.engine.state.caught.length,268);assert.equal(publicIds.length,256);
  app.context.showDex();const {markup,pane}=app.modal;assert.equal(pane,'dex');
  assert.deepEqual(cards(markup),publicIds);assertNoHidden(markup);
  assert.match(markup,/捕獲 <strong>256<\/strong> \/ 256/);assert.match(markup,/発見 256<\/p>/);
  assert(!/No\.25[7-9]/.test(markup));assert(!markup.includes('未発見'));
  const options=[...markup.matchAll(/<option value="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(options,['all',...publicTypes]);assert(!options.includes('void'));
});

test('partial discovery and the actual element-change callback include either type without hidden entries',()=>{
  const app=ui();assert.equal(app.engine.state.caught.length,13);app.context.showDex();
  assert.match(app.modal.markup,/捕獲 <strong>1<\/strong> \/ 256/);assert.match(app.modal.markup,/発見 1<\/p>/);
  assert.equal(cards(app.modal.markup).length,256);assert(app.modal.markup.includes('未発見'));assertNoHidden(app.modal.markup);
  for(const element of publicTypes){
    app.elements.get('dex-filter').onchange({target:{value:element}});
    assert.deepEqual(cards(app.modal.markup),publicIds.filter(id=>model.LT.TypeSystem.has(id,element)));
    assertNoHidden(app.modal.markup);
  }
  app.context.showDex('void');assert.equal(cards(app.modal.markup).length,0);assertNoHidden(app.modal.markup);
  const complete=ui(true),dual=publicIds.filter(id=>model.LT.TypeSystem.of(id).length===2);
  assert.equal(dual.length,64);
  for(const element of publicTypes){
    complete.context.showDex(element);
    const visible=cards(complete.modal.markup);
    assert.deepEqual(visible,publicIds.filter(id=>model.LT.TypeSystem.has(id,element)));
    for(const id of dual.filter(id=>DATA.species[id].types[1]===element))assert(visible.includes(id),id+' appears under its secondary type');
    assertNoHidden(complete.modal.markup);
  }
  for(const id of dual){
    complete.context.showDexEntry(id);
    const labels=model.LT.TypeSystem.of(id).map(type=>DATA.elements[type].name);
    assert(complete.modal.markup.includes(`aria-label="${labels.join('・')}タイプ"`));
    for(const label of labels)assert(complete.modal.markup.includes(`>${label}</span>`),id+' displays both type badges');
    assertNoHidden(complete.modal.markup);
  }
});

test('direct hidden entry and lineage calls reveal nothing while normal evolution entries work',()=>{
  const app=ui(true);app.context.showDexEntry('komori');assert.equal(app.modal.pane,'dex-entry');
  assert.equal(app.modal.title,DATA.species.komori.name);assert(app.modal.markup.includes('最初の相棒として選択'));
  assert.deepEqual(cards(app.context.evolutionLineage('komori')),['komori','komorion','komorizen']);
  const before=app.opened.length;
  for(const id of hiddenIds){app.context.showDexEntry(id);assert.equal(app.opened.length,before);assert.equal(app.context.evolutionLineage(id),'');}
  assertNoHidden(app.modal.markup);
  app.context.showDexEntry('akebino');assert.equal(app.opened.length,before+1);assert.equal(app.modal.title,DATA.species.akebino.name);
  assert(app.modal.markup.includes(DATA.maps.cinderisle.name));
});

test('owned hidden companions show their name and growth details without an invented dex number',()=>{
  const app=ui(true);
  for(const [index,id]of hiddenIds.entries()){
    const mon=app.engine.makeMonster(id,DATA.species[id].visual.stage===0?5:DATA.species[id].visual.stage===1?24:48);app.engine.state.party[1]=mon;app.context.showParty(1);
    const {markup,title,pane}=app.modal;assert.equal(pane,'party');assert.equal(title,DATA.species[id].name);
    assert(markup.includes((DATA.offDexLines.ids.includes(id)||DATA.offDexLeaders.ids.includes(id))?'図鑑未登録 · 幻の草むらで出会ったパチモン':'図鑑未登録 · バグ技で出会ったパチモン'));assert(!markup.includes('No.'));
    assert(markup.includes(`data-creature="${id}"`));const labels=model.LT.TypeSystem.of(id).map(type=>DATA.elements[type].name);assert(markup.includes(`aria-label="${labels.join('・')}タイプ"`));for(const label of labels)assert(markup.includes(`>${label}</span>`));
    assert(markup.includes(`Lv.${mon.level}`));assert(markup.includes(`data-nickname="${mon.uid}"`));
    assert(markup.includes(!DATA.species[id].evolvesTo?'完成した姿':`Lv.${DATA.species[id].evolveLevel}で新しい姿に進化`));
    app.context.showDex();assertNoHidden(app.modal.markup);
  }
  app.context.showParty(0);assert.match(app.modal.markup,/モンスター記録　No\.001/);assert(!app.modal.markup.includes('図鑑未登録'));
});

test('the adventure record counts public species only, both complete and partially collected',()=>{
  const app=ui(true);app.context.showRecords();
  const firstRow=()=>/<li class="ladder-row[^"]*">([\s\S]*?)<\/li>/.exec(app.modal.markup)?.[1];
  assert.match(firstRow(),/<strong>256 \/ 256<\/strong>/);assert(!firstRow().includes('268'));assertNoHidden(app.modal.markup);
  app.engine.state.caught=['komori',...hiddenIds];app.context.showRecords();
  assert.match(firstRow(),/<strong>1 \/ 256<\/strong>/);assertNoHidden(app.modal.markup);
  assert.deepEqual(app.previews,['records','records']);
});
