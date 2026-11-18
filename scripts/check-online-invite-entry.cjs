#!/usr/bin/env node
'use strict';
// Exercise the actual game entry/save/boot code. Network and DOM boundaries are
// controlled, while Engine serialization and the receipt barrier stay real.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {normalizeCode,create,createReceiver,routeInvite}=require('../online-invites.js');
const {TradeController,key:PENDING_KEY}=require('../trade-client.js');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),model=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],model);if(model.LT?.Engine)break;
}
assert(model.LT?.Engine,'The production Engine must load');
const {Engine,DATA}=model.LT,copy=value=>JSON.parse(JSON.stringify(value));
function segment(start,end){const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert(a>=0&&b>a,'Production entry markers missing: '+start);return html.slice(a,b);}
const production=[
  segment('  let checkedTradeSave=','  function begin('),
  segment('  function begin(','  const portraitLoader ='),
  segment('  function openOnlineFromMenu(','  function showLocalMenu('),
  segment('  function openTradeFromMenu(','  function commitTrade('),
  segment('  let booting=null;','  // A new adventure\'s setup'),
  segment('  LT.requestOnline=','  // The server-facing client'),
  segment('  LT.adminBridge={','  LT.portraitHTML=')
].join('\n');
const SAVE='entry-save',BACKUP='entry-backup',ROOM='12345678-1234-4234-8234-123456789abc',BASE='https://example.test/pachi-mon/';

function harness({playing=true}={}){
  const engine=new Engine();assert(engine.newGame('komori').ok);
  engine.state.party.push(engine.makeMonster('shizuku',20));engine.markCaught('shizuku');
  const initial=engine.serialize(),memory=new Map([[SAVE,JSON.stringify(initial)]]),trace=[],timers=[],listeners=new Map();
  const control={quota:false,writes:0,backups:0,accept:true,opened:[],toasts:[],reloads:0,href:create('trade','ABC234',BASE),cleanups:0};
  function element(){const classes=new Set();return {hidden:false,open:false,children:[],classList:{add(...values){values.forEach(value=>classes.add(value));},remove(...values){values.forEach(value=>classes.delete(value));},contains:value=>classes.has(value)},setAttribute(){},appendChild(child){this.children.push(child);},focus(){},remove(){},innerHTML:''};}
  const nodes=Object.fromEntries(['title-screen','online-modal','modal','game-canvas'].map(id=>[id,element()])),stage=element(),body=element();
  const document={body,createElement:()=>element(),getElementById:id=>nodes[id],querySelector:selector=>selector==='.game-stage'?stage:selector==='dialog[open]'?Object.values(nodes).find(node=>node.open)||null:null,
    addEventListener(name,fn){const entries=listeners.get(name)||[];entries.push(fn);listeners.set(name,entries);},dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event);}};
  const storage={getItem:key=>memory.get(key)||null,setItem(key,value){
    if(key===BACKUP){memory.set(key,value);control.backups++;return;}
    if(key===SAVE){trace.push('save-attempt');if(control.quota)throw Error('Storage quota exceeded');new Engine(JSON.parse(value));control.writes++;trace.push('saved');}
    memory.set(key,value);
  },removeItem:key=>memory.delete(key)};
  const trade=new TradeController({storage,request:async()=>{throw Error('The invitation must not call trade APIs');},identify:async()=>{throw Error('The invitation must not register an identity');},getEngine:()=>c.engine,commit:()=>{throw Error('The invitation must not commit an exchange');},data:DATA});
  function opened(mode,options){
    trace.push(mode+'-open');control.opened.push({mode,options:copy(options),saved:JSON.parse(memory.get(SAVE))});
    if(mode==='battle'&&control.accept){c.LT.onlineActive=true;nodes['online-modal'].open=true;}
    return control.accept;
  }
  const c=vm.createContext({console,Engine,DATA,engine,playing,busy:false,introPending:false,storedSave:copy(initial),lastSave:0,SAVE_KEY:SAVE,BACKUP_KEY:BACKUP,saveIssueShown:false,
    pressedDirection:'left',directionSource:'keyboard',moveAnim:null,endingActive:false,selectedAvatar:'male',selectedPlayerName:'招待テスト',settings:{sound:false,reducedMotion:false},performance:{now:()=>123},localStorage:storage,document,
    navigator:{onLine:true},window:{scrollTo(){},location:{reload(){control.reloads++;}}},CustomEvent:class{constructor(type){this.type=type;}},
    $:id=>nodes[id],toast:message=>control.toasts.push(message),closeModal(){trace.push('close-menu');nodes.modal.open=false;},
    setTimeout(callback,ms){const timer={callback,ms,used:false};timers.push(timer);return timer;},requestAnimationFrame:callback=>callback(),
    resize(){},updateAll(){},loadStored(){},paintPortraits(){},updateAudioHint(){},sound:{},showDialogue(){nodes.modal.open=true;trace.push('introduction');},commitTrade(){},checkTrade(){},
    LT:{OnlineInvites:{normalizeCode},Trade:{isLocked:()=>trade.busy||trade.isLocked()||trade.hasStoredPending(),resume:async()=>{trace.push('recover-trade');},open:options=>opened('trade',options)},OnlineUI:{open:options=>opened('battle',options)}}});
  vm.runInContext(production,c);trace.length=0;
  return {c,control,nodes,memory,trace,timers,initial,document,
    receiver(mode='trade'){control.href=create(mode,'ABC234',BASE);return createReceiver({href:()=>control.href,replace:url=>{control.href=url;control.cleanups++;},deliver:invite=>routeInvite(invite,c)});},
    runTimer(ms){const timer=timers.find(item=>!item.used&&item.ms===ms);assert(timer,'Missing timer '+ms);timer.used=true;timer.callback();}
  };
}

test('actual invitation entry durably saves the latest unsaved party before opening the exchange',async()=>{
  const h=harness(),before=h.memory.get(SAVE);
  const added=h.c.engine.makeMonster('hibana',15);added.nickname='直前の仲間';h.c.engine.state.party.push(added);h.c.engine.markCaught('hibana');h.c.engine.state.party[0].nickname='名前も変更';
  const receiver=h.receiver();assert.equal(h.control.writes,0);assert.equal(h.memory.get(SAVE),before,'reading the invitation never saves');
  assert.equal(await receiver.open(),true);assert.equal(h.control.opened.length,1);
  const result=h.control.opened[0];assert.equal(result.mode,'trade');assert.deepEqual(result.options,{joinCode:'ABC234'});
  assert.equal(result.saved.party.length,3);assert.equal(result.saved.party[0].nickname,'名前も変更');assert.equal(result.saved.party[2].uid,added.uid);assert.equal(result.saved.party[2].nickname,'直前の仲間');
  assert(h.trace.indexOf('saved')<h.trace.indexOf('trade-open'));assert.deepEqual(copy(h.c.storedSave),result.saved);
  assert.equal(h.control.cleanups,1);assert.equal(h.control.href,BASE);
});

test('quota failures block real battle and trade entries without consuming the invitation or replacing the save',async()=>{
  for(const mode of ['battle','trade']){
    const h=harness();h.c.engine.state.party[0].nickname='未保存';const before=h.memory.get(SAVE),cached=h.c.storedSave,live=JSON.stringify(h.c.engine.state);h.control.quota=true;
    const receiver=h.receiver(mode);assert.equal(await receiver.open(),false,mode);
    assert.equal(h.control.opened.length,0,mode);assert.equal(h.control.writes,0);assert.equal(h.memory.get(SAVE),before);assert.equal(h.c.storedSave,cached);assert.equal(JSON.stringify(h.c.engine.state),live);
    assert.equal(h.control.cleanups,0);assert(receiver.snapshot().pending);assert(!h.trace.includes('close-menu'),'a failed save keeps the current screen available');
  }
});

test('a newly committed exchange in another tab blocks actual entry and preserves the newer disk inventory',async()=>{
  for(const mode of ['battle','trade']){
    const h=harness(),disk=new Engine(JSON.parse(h.memory.get(SAVE))),outgoing=disk.tradeMonster(disk.state.party[0]),incoming=disk.makeMonster('hibana',25);incoming.uid='tr-'+ROOM+'-h';
    assert(disk.applyTrade({id:'trade:'+ROOM,revision:3,outgoingUid:outgoing.uid,outgoing,incoming}).ok);
    h.memory.set(SAVE,JSON.stringify(disk.serialize()));const latest=h.memory.get(SAVE),live=JSON.stringify(h.c.engine.state);
    // Call the real public entry directly: the save barrier remains effective
    // even if a caller skips the shared router's earlier busy check.
    const result=mode==='trade'?await h.c.LT.requestTrade({joinCode:'ABC234'}):await h.c.LT.requestOnline({transport:'internet',joinCode:'ABC234'});
    assert.equal(result,false,mode);assert.equal(h.control.opened.length,0);assert.equal(h.control.writes,0);assert.equal(h.memory.get(SAVE),latest);assert.equal(JSON.stringify(h.c.engine.state),live);
    assert.equal(h.timers.filter(timer=>timer.ms===800).length,1);h.runTimer(800);assert.equal(h.control.reloads,1);
  }
});

test('a pending exchange in storage wins over new invitations before any save or UI open',async()=>{
  for(const mode of ['battle','trade']){
    const h=harness(),before=h.memory.get(SAVE);h.memory.set(PENDING_KEY,JSON.stringify({version:1,ownerId:'player',roomId:ROOM}));
    const receiver=h.receiver(mode);assert.equal(await receiver.open(),false);assert(receiver.snapshot().pending);
    assert.equal(h.control.opened.length,0);assert.equal(h.control.writes,0);assert.equal(h.memory.get(SAVE),before);assert.equal(h.control.cleanups,0);assert(h.trace.includes('recover-trade'));
  }
});

test('invalid invite codes are rejected by the real public entries before saving',async()=>{
  for(const mode of ['battle','trade']){
    const h=harness(),before=h.memory.get(SAVE);h.c.engine.state.party[0].nickname='まだ保存しない';
    const result=mode==='trade'?await h.c.LT.requestTrade({joinCode:'ABC!234'}):await h.c.LT.requestOnline({joinCode:'ABC!234'});
    assert.equal(result,false);assert.equal(h.control.opened.length,0);assert.equal(h.control.writes,0);assert.equal(h.control.backups,0);assert.equal(h.memory.get(SAVE),before);
  }
});

test('real title boot keeps the invite until OnlineUI opens, and failed opening preserves a retry',async()=>{
  const h=harness({playing:false}),receiver=h.receiver('battle');h.control.accept=false;
  const first=receiver.open();assert.equal(h.control.cleanups,0);assert.equal(h.control.opened.length,0);assert(receiver.snapshot().working);
  h.runTimer(1550);assert.equal(h.control.cleanups,0);assert.equal(h.control.opened.length,0,'the fade has not completed');
  h.runTimer(340);assert.equal(await first,false);assert(receiver.snapshot().pending);assert.equal(h.control.cleanups,0);assert.equal(h.nodes['title-screen'].hidden,false);
  h.control.accept=true;const second=receiver.open();assert.equal(h.control.cleanups,0);h.runTimer(1550);h.runTimer(340);
  assert.equal(await second,true);assert.equal(h.control.cleanups,1);assert.equal(receiver.snapshot().pending,null);assert.equal(h.control.writes,0,'a title-screen battle does not create a save');
  assert.deepEqual(h.control.opened.at(-1).options,{transport:'internet',joinCode:'ABC234'});
});

test('real new-game startup blocks both entries throughout the 160ms introduction gap',async()=>{
  const h=harness({playing:false}),atReady=[];
  h.document.addEventListener('pachi-game-ready',()=>{
    atReady.push(h.c.LT.adminBridge.isBusy());
    atReady.push(h.c.LT.requestOnline({transport:'internet',joinCode:'ABC234'}));
    atReady.push(h.c.LT.requestTrade({joinCode:'ABC234'}));
  });
  h.c.begin('komori');assert.deepEqual(atReady,[true,false,false]);assert.equal(h.control.opened.length,0);assert.equal(h.c.LT.adminBridge.isBusy(),true);
  const receiver=h.receiver('trade'),writes=h.control.writes;assert.equal(await receiver.open(),false);assert(receiver.snapshot().pending);assert.equal(h.control.writes,writes);
  h.runTimer(160);assert(h.nodes.modal.open);assert.equal(await receiver.open(),false,'the actual introduction dialog also blocks delivery');assert.equal(h.control.opened.length,0);
  h.nodes.modal.open=false;assert.equal(await receiver.open(),true);assert.equal(h.control.opened[0].mode,'trade');
});
