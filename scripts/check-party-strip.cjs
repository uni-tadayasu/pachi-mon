#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),source=fs.readFileSync(path.join(root,'party-reorder.js'),'utf8');
const model=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],model);if(model.LT?.Engine)break;
}
const {Engine,DATA,displayName}=model.LT,copy=value=>JSON.parse(JSON.stringify(value));
function section(from,to){const start=html.indexOf(from),end=html.indexOf(to,start);assert(start>0&&end>start,from);return html.slice(start,end);}
function target(){
  const listeners=new Map();return {events:[],addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},removeEventListener(type,fn){listeners.set(type,(listeners.get(type)||[]).filter(other=>other!==fn));},
    dispatchEvent(event){this.events.push(event.type);for(const fn of listeners.get(event.type)||[]){fn(event);if(event.immediateStopped)break;}return !event.defaultPrevented;}
  };
}
function classes(){const values=new Set();return {add:(...items)=>items.forEach(value=>values.add(value)),remove:(...items)=>items.forEach(value=>values.delete(value)),contains:value=>values.has(value),toggle(value,on){if(on===undefined)on=!values.has(value);if(on)values.add(value);else values.delete(value);return on;}};}
function style(){return {setProperty(key,value){this[key]=value;},removeProperty(key){delete this[key];}};}
function event(type,fields={}){return {type,detail:1,defaultPrevented:false,immediateStopped:false,preventDefault(){this.defaultPrevented=true;},stopImmediatePropagation(){this.immediateStopped=true;},...fields};}
function fresh(){
  const engine=new Engine();assert(engine.newGame(DATA.starters[0]).ok);
  for(let i=1;i<6;i++)engine.state.party.push(engine.makeMonster(DATA.starters[i%DATA.starters.length],10+i));
  for(const mon of engine.state.party)engine.markCaught(mon.species);
  engine.state.party[1].hp=0;engine.state.party[2].nickname='<B>';engine.state.party[2].shiny=true;engine.state.party[2].xp=3;
  engine.state.party[2].pp[engine.moves(engine.state.party[2])[0].id]=1;
  return engine;
}
function harness(columns=6){
  const document=target(),window=target(),list=Object.assign(target(),{classList:classes(),dataset:{},cards:[],querySelectorAll(){return this.cards;},contains(card){return this.cards.includes(card);}});
  let clock=100,quota=false,modal=false,dialogue=false,trade=false,nextPointer=0;const writes=[],toasts=[],details=[];
  document.querySelector=()=>modal?{}:null;
  const c=vm.createContext({console,Engine,DATA,LT:{...model.LT},engine:fresh(),playing:true,busy:false,introPending:false,partyReorder:null,storedSave:null,lastSave:0,moveAnim:{},
    window,document,performance:{now:()=>clock},SAVE_KEY:'party-strip-save',nameOf:displayName,$:id=>id==='party-list'?list:null,fieldDialogOpen:()=>dialogue,tradeLocked:()=>trade,rankedLocked:()=>false,
    CustomEvent:class{constructor(type){this.type=type;}},sound:{fx(){}},toast:message=>toasts.push(message),
    localStorage:{setItem(key,value){if(quota)throw Error('Quota');writes.push({key,value});}},updateAll(){c.partyReorder?.cancel();render();}
  });
  function render(){
    list.cards=c.engine.state.party.map((mon,index)=>{
      const left=index%columns*60,top=Math.floor(index/columns)*72,rect={left,top,right:left+58,bottom:top+70,width:58,height:70},captures=new Set();
      const card={dataset:{partyUid:mon.uid},disabled:!!c.engine.battle,classList:classes(),style:style(),getBoundingClientRect:()=>rect,
        closest:selector=>selector==='button[data-party-uid]'?card:null,setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id)};
      return card;
    });
    list.getBoundingClientRect=()=>({left:0,top:0,right:columns*60-2,bottom:Math.ceil(list.cards.length/columns)*72-2,width:columns*60-2,height:Math.ceil(list.cards.length/columns)*72-2});
  }
  render();vm.runInContext(source,c,{filename:'party-reorder.js'});
  vm.runInContext(section('  function persistPartyOrder(','  function showPartyOrder('),c);
  vm.runInContext(section('  function setupPartyReorder(','  function persistMoveOrder('),c);c.setupPartyReorder();
  list.addEventListener('click',e=>{if(!e.defaultPrevented&&e.target&&!e.target.disabled)details.push(e.target.dataset.partyUid);});
  function center(index){const rect=list.cards[index].getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};}
  function down(index,type='touch',extra={}){
    const point=center(index),e=event('pointerdown',{target:list.cards[index],pointerId:++nextPointer,pointerType:type,isPrimary:true,button:0,buttons:1,clientX:point.x,clientY:point.y,...extra});
    document.dispatchEvent(e);list.dispatchEvent(e);return e;
  }
  function move(start,x,y,extra={}){const e=event('pointermove',{...start,clientX:x,clientY:y,buttons:1,...extra,type:'pointermove'});window.dispatchEvent(e);return e;}
  function up(start,x=start.clientX,y=start.clientY){const e=event('pointerup',{...start,clientX:x,clientY:y,buttons:0,type:'pointerup'});window.dispatchEvent(e);return e;}
  function click(card,detail=1){const e=event('click',{target:card,detail});list.dispatchEvent(e);return e;}
  function drag(from,to,type='touch'){const start=down(from,type),point=center(to);move(start,point.x,point.y);up(start,point.x,point.y);return start;}
  function clean(){assert.equal(c.partyReorder.gesture,null);assert(!list.classList.contains('party-reordering'));assert.equal(list.dataset.reorderTarget,undefined);for(const card of list.cards){assert(!card.classList.contains('party-dragging'));assert(!card.classList.contains('party-drop-target'));assert.equal(card.style['--party-drag-x'],undefined);assert.equal(card.style['--party-drag-y'],undefined);}}
  return {c,window,document,list,writes,toasts,details,center,down,move,up,click,drag,clean,render,set quota(value){quota=value;},set modal(value){modal=value;},set dialogue(value){dialogue=value;},set trade(value){trade=value;},tick:ms=>clock+=ms};
}
let passed=0;function test(name,fn){fn();passed++;console.log('PASS '+name);}

test('touch insertion changes the leader, preserves each individual and persists the exact order for reload',()=>{
  const h=harness(),before=copy(h.c.engine.serialize()),uids=before.party.map(mon=>mon.uid),individuals=new Map(before.party.map(mon=>[mon.uid,mon]));
  h.drag(0,5);assert.deepEqual(copy(h.c.engine.state.party.map(mon=>mon.uid)),[...uids.slice(1),uids[0]]);
  h.drag(5,2);assert.deepEqual(copy(h.c.engine.state.party.map(mon=>mon.uid)),[uids[1],uids[2],uids[0],...uids.slice(3)]);
  assert.equal(h.writes.length,2);assert.equal(h.writes[1].key,'party-strip-save');assert.equal(h.c.moveAnim,null);
  const after=copy(h.c.engine.serialize());for(const mon of after.party)assert.deepEqual(mon,individuals.get(mon.uid),'HP, PP, nickname and training belong to the same individual');
  const saved=new Engine(JSON.parse(h.writes[1].value));assert.deepEqual(copy(saved.state.party),copy(h.c.engine.state.party));
  delete before.party;delete after.party;assert.deepEqual(after,before,'Other adventure fields are untouched');
  assert.equal(h.document.events.filter(type=>type==='pachi-party-changed').length,2);h.clean();
});

test('short taps and keyboard details survive while a completed drag suppresses its trailing click',()=>{
  const h=harness();let start=h.down(1),card=start.target;h.move(start,start.clientX+4,start.clientY+2);h.up(start,start.clientX+4,start.clientY+2);
  assert(!h.click(card).defaultPrevented);assert.equal(h.details.length,1);assert.equal(h.writes.length,0);
  start=h.drag(1,4);assert(h.click(start.target).defaultPrevented);assert.equal(h.details.length,1);
  assert(!h.click(h.list.cards[0],0).defaultPrevented,'Assistive/keyboard activation is not swallowed');
  start=h.down(2);h.up(start);assert(!h.click(start.target).defaultPrevented,'A fresh tap works immediately after a drag');assert.equal(h.details.length,3);h.clean();
});

test('mouse and pen work, a coalesced final move commits, and desktop multirow cards use both axes',()=>{
  for(const type of ['mouse','pen']){
    const h=harness(),uid=h.c.engine.state.party[0].uid,start=h.down(0,type),point=h.center(3);h.up(start,point.x,point.y);assert.equal(h.c.engine.state.party[3].uid,uid);assert.equal(h.writes.length,1);h.clean();
  }
  const h=harness(2),uid=h.c.engine.state.party[4].uid,start=h.down(4,'mouse'),point=h.center(0);
  h.move(start,point.x,point.y);assert.equal(h.c.partyReorder.gesture.to,0);assert(Number.parseFloat(start.target.style['--party-drag-y'])<0);
  h.up(start,point.x,point.y);assert.equal(h.c.engine.state.party[0].uid,uid);h.clean();
  const second=h.c.engine.state.party[4].uid;h.drag(4,5);assert.equal(h.c.engine.state.party[5].uid,second,'Horizontal drag on a lower row stays on that row');h.clean();
});

test('drag feedback stays in the strip and dropping outside or returning to the same slot never saves',()=>{
  const h=harness(),start=h.down(1),rect=start.target.getBoundingClientRect(),strip=h.list.getBoundingClientRect();
  h.move(start,999,30);assert.equal(Number.parseFloat(start.target.style['--party-drag-x']),strip.right-rect.right);
  assert.equal(h.list.dataset.reorderTarget,'5');assert.equal(h.list.cards[5].dataset.dropSide,'after');h.up(start,999,30);assert.equal(h.writes.length,0);h.clean();
  const back=h.down(3),other=h.center(1);h.move(back,other.x,other.y);assert.equal(h.list.cards[1].dataset.dropSide,'before');h.up(back);assert.equal(h.writes.length,0);h.clean();
});

test('vertical slips, pointer cancellation, lost capture, navigation and multitouch clear without mutation',()=>{
  for(const reason of ['vertical','pointercancel','lostpointercapture','blur','pagehide','resize','orientationchange','visibilitychange','pachi-viewport-change','pachi-online-state','second-pointer','mouse-release']){
    const h=harness(),before=JSON.stringify(h.c.engine.state.party),start=h.down(1,reason==='mouse-release'?'mouse':'touch'),point=h.center(4);
    if(reason==='vertical')h.move(start,start.clientX+2,start.clientY+25);
    else{
      h.move(start,point.x,point.y);
      if(reason==='second-pointer')h.down(3,'touch',{isPrimary:false});
      else if(reason==='mouse-release')h.move(start,point.x,point.y,{buttons:0});
      else (reason==='lostpointercapture'?h.list:['visibilitychange','pachi-viewport-change','pachi-online-state'].includes(reason)?h.document:h.window).dispatchEvent(event(reason,{pointerId:start.pointerId}));
    }
    h.up(start,point.x,point.y);assert.equal(JSON.stringify(h.c.engine.state.party),before,reason);assert.equal(h.writes.length,0,reason);assert(h.click(start.target).defaultPrevented,reason+' must not open details');h.clean();
  }
  const held=harness(),start=held.down(0);held.move(start,start.clientX+2,start.clientY+25);held.tick(5000);held.up(start,start.clientX+2,start.clientY+25);assert(held.click(start.target).defaultPrevented,'A long-held cancelled press cannot later open details');held.clean();
  const next=held.down(0);held.up(next);assert(!held.click(next.target).defaultPrevented,'The next fresh tap clears cancellation suppression');
});

test('blocking battle, animation, modal and communication states reject new and in-flight reorders',()=>{
  const blockers={battle:h=>h.c.engine.battle={},busy:h=>h.c.busy=true,intro:h=>h.c.introPending=true,title:h=>h.c.playing=false,modal:h=>h.modal=true,dialogue:h=>h.dialogue=true,online:h=>h.c.LT.onlineActive=true,localTrade:h=>h.c.LT.localTradeActive=true,trade:h=>h.trade=true};
  for(const [name,block]of Object.entries(blockers)){
    let h=harness();block(h);h.drag(0,4);assert.equal(h.writes.length,0,name+' start');h.clean();
    h=harness();const start=h.down(0),point=h.center(4);h.move(start,point.x,point.y);block(h);h.up(start,point.x,point.y);assert.equal(h.writes.length,0,name+' transition');h.clean();
  }
  for(const mutation of [h=>h.c.engine.state.party.reverse(),h=>h.c.engine=new Engine(h.c.engine.serialize())]){
    const h=harness(),start=h.down(0),point=h.center(4);h.move(start,point.x,point.y);mutation(h);const before=JSON.stringify(h.c.engine.state.party);h.up(start,point.x,point.y);assert.equal(JSON.stringify(h.c.engine.state.party),before);assert.equal(h.writes.length,0);h.clean();
  }
  const h=harness();h.down(0,'mouse',{button:2});assert.equal(h.c.partyReorder.gesture,null);h.down(0,'touch',{isPrimary:false});assert.equal(h.c.partyReorder.gesture,null);
});

test('storage failure preserves live order and lets the next drag retry normally',()=>{
  const h=harness(),state=h.c.engine.state,before=JSON.stringify(h.c.engine.serialize()),uid=h.c.engine.state.party[2].uid;h.quota=true;h.drag(2,0);
  assert.equal(h.c.engine.state,state);assert.equal(JSON.stringify(h.c.engine.serialize()),before);assert.equal(h.writes.length,0);assert.equal(h.c.storedSave,null);assert(h.toasts.at(-1).includes('並びは変更していません'));h.clean();
  h.quota=false;h.drag(2,0);assert.equal(h.c.engine.state.party[0].uid,uid);assert.equal(h.writes.length,1);h.clean();
});

test('battle strip uses staged names, levels and HP, remains read-only, then follows each visual event',()=>{
  const engine=fresh();assert(engine.startBattle('kirari',10));
  const list={classList:classes(),innerHTML:'',setAttribute(key,value){this[key]=value;}},c=vm.createContext({engine,battleView:null,partyReorder:null,
    $:id=>id==='party-list'?list:null,escape:value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;'),nameOf:displayName,portrait:()=>'<canvas></canvas>',genderMark:()=>'',conditionChip:()=>'',paintPortraits(){},updateBattle(){},updateScene(){},paintBattleHealth(){}});
  vm.runInContext(section('  function hpBar(','  function updateFacing('),c);
  vm.runInContext(section('  function refreshPartyStrip(','  function updateAll('),c);
  vm.runInContext(section('  function captureBattleView()','  // Handheld-style message pacing.'),c);
  c.battleView=c.captureBattleView();const initial=copy(c.battleView.state.party[0]),max=engine.stats(initial).hp;
  engine.state.party[0].level+=10;engine.state.party[0].nickname='future name';engine.state.party[0].hp=0;
  c.refreshPartyStrip();assert(list.innerHTML.includes(`Lv.${initial.level} `));assert(list.innerHTML.includes(`${initial.hp}/${max}`));assert(!list.innerHTML.includes('future name'));assert(list.classList.contains('party-readonly'));assert.equal((list.innerHTML.match(/ disabled aria-disabled="true"/g)||[]).length,6);
  const frame={activeIndex:0,ally:{...initial,hp:initial.hp-5},enemy:copy(c.battleView.battle.enemy),enemyIndex:0};
  c.applyBattleVisual(frame,{kind:'damage'});assert(list.innerHTML.includes(`${initial.hp-5}/${max}`));assert.equal(c.battleView.state.party[0].hp,initial.hp-5);assert.equal(engine.state.party[0].hp,0,'Rendering never mutates the engine');
  frame.ally.hp=0;c.applyBattleVisual(frame,{kind:'damage'},true);assert(list.innerHTML.includes(`体力0/${max}`));assert.equal(c.battleView.state.party[0].hp,initial.hp-5,'Knockout retains its old pose until its event completes');
  c.applyBattleVisual(frame,{kind:'faint'});assert.equal(c.battleView.state.party[0].hp,0);
  const level={...frame,ally:{...copy(engine.state.party[0]),hp:20}};c.applyBattleVisual(level,{kind:'level'});assert(list.innerHTML.includes('future name'));assert(list.innerHTML.includes(`Lv.${level.ally.level} `));assert(list.innerHTML.includes(`20/${engine.stats(level.ally).hp}`));
  c.battleView=null;engine.battle=null;c.refreshPartyStrip();assert(!list.classList.contains('party-readonly'));assert(!list.innerHTML.includes('aria-disabled'));assert(list.innerHTML.includes('data-party-uid='));
});

test('real bench revival, level-up and capture events keep immutable complete party snapshots',()=>{
  const engine=fresh();engine.state.party=engine.state.party.slice(0,3);engine.state.party[2].hp=0;engine.state.inventory.tonic=1;engine.state.inventory.chime=1;engine.rng=()=>.5;assert(engine.startBattle('kirari',1));
  const list={classList:classes(),innerHTML:'',setAttribute(key,value){this[key]=value;}},c=vm.createContext({engine,battleView:null,partyReorder:null,
    $:id=>id==='party-list'?list:null,escape:String,nameOf:displayName,portrait:()=>'<canvas></canvas>',genderMark:()=>'',conditionChip:()=>'',paintPortraits(){},updateBattle(){},updateScene(){},paintBattleHealth(){}});
  vm.runInContext(section('  function hpBar(','  function updateFacing('),c);vm.runInContext(section('  function refreshPartyStrip(','  function updateAll('),c);vm.runInContext(section('  function captureBattleView()','  // Handheld-style message pacing.'),c);
  c.battleView=c.captureBattleView();const old=copy(c.battleView.state.party[2]),result=engine.action({type:'item',id:'tonic',index:2});assert(result.ok);
  const healed=result.events.find(e=>e.kind==='heal');assert(healed?.visual.party[2].hp>0);const healSnapshot=JSON.stringify(healed.visual),levels=[];
  engine.giveXP(engine.state.party[2],engine.xpToNext(engine.state.party[2].level)+1,levels);const level=levels.find(e=>e.kind==='level');assert(level);assert(level.visual.party[2].level>old.level);
  engine.rng=()=>0;const caught=engine.action({type:'resonate'}).events.find(e=>e.kind==='caught');assert(caught);assert.equal(caught.visual.party.length,4);
  assert.equal(JSON.stringify(healed.visual),healSnapshot,'Later engine turns and levels cannot change a past visual snapshot');
  c.applyBattleVisual(healed.visual,healed,true);assert.equal(c.battleView.state.party[2].hp,0,'Health-only rendering does not advance the pose');assert(list.innerHTML.includes(`体力${healed.visual.party[2].hp}/${engine.stats(old).hp}`));
  c.applyBattleVisual(healed.visual,healed);assert.deepEqual(copy(c.battleView.state.party[2]),copy(healed.visual.party[2]));assert.equal(c.battleView.state.party[2].level,old.level,'Bench levels wait for their own event');
  c.applyBattleVisual(level.visual,level);assert.deepEqual(copy(c.battleView.state.party[2]),copy(level.visual.party[2]));assert.equal(c.battleView.state.party.length,3,'A caught companion is not displayed ahead of its capture event');
  c.applyBattleVisual(caught.visual,caught);assert.equal(c.battleView.state.party.length,4);assert.equal((list.innerHTML.match(/data-party-uid=/g)||[]).length,4);assert(list.innerHTML.includes(caught.visual.party[3].uid));assert.equal(JSON.stringify(healed.visual),healSnapshot);
});

assert(html.includes('<script src="party-reorder.js?v=20261120-console-controls-v72"></script>'));
console.log(`Party strip checks passed: ${passed} gesture, atomic persistence and staged battle-display scenarios.`);
