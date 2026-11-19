#!/usr/bin/env node
'use strict';
// Exercise the shipped main-UI bridge, keyboard/controller handlers and field
// runtime. No service writes, browser fixtures or substitute room logic.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),model=vm.createContext({console});
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(match[1]))continue;
  vm.runInContext(match[2],model);if(model.LT?.Engine)break;
}
vm.runInContext(fs.readFileSync(path.join(root,'room-art.js'),'utf8'),model);
const {Engine,DATA,RoomArt}=model.LT,copy=value=>JSON.parse(JSON.stringify(value)),OWNER='P0123456789abcdef';
const slice=(first,last)=>{const start=html.indexOf(first),end=html.indexOf(last,start);assert(start>=0&&end>start,first);return html.slice(start,end);};
const barrier=slice('  let checkedTradeSave=','  function begin(');
const gifting=slice('  function persistGiftMutation(','  LT.playMoveSound=');
const trades=slice('  function commitTrade(','  function showCredits(');
const bridge=slice('  LT.adminBridge={','  LT.portraitHTML=');
const controllers=slice('  function fieldDialogOpen()','  document.addEventListener(\'pachi-online-return\'');
const keyboard=slice('  function walk(dx,dy)','  window.addEventListener(\'keyup\'');
const menu=slice('  function showMenu()','  function openOnlineFromMenu(');
const scene=slice('  function updateScene(){','  function sceneOptions()');
const roomMenuBranch=html.match(/if\(d\.ui==='rooms'\)\{[^\n]+\}/)?.[0];assert(roomMenuBranch,'The menu must have its rooms action');
const record=(kind='secret',decorations=[])=>({id:OWNER,mapId:'room:'+OWNER,owner:{id:OWNER,name:'旅人',isAdmin:kind==='kasai'},kind,name:'テストの部屋',revision:1,decorations,
  entrance:{map:'village',x:32,y:7,facing:'up',returnX:32,returnY:8}});
const gift={id:'kasai-reward:'+OWNER,grantId:'kasai-reward:'+OWNER,species:'floravelle',level:70,gender:'female',delivered:false,ackedAt:null};
function harness(){
  const engine=new Engine();assert(engine.newGame('komori').ok);
  const initial=engine.serialize(),events={},nodes=new Map(),trace=[];
  const controls={raw:JSON.stringify(initial),quota:false,writes:0,reads:0,updates:0,loads:0,worldMoves:0,roomMoves:0,roomOpen:false,roomWorking:false,kasaiOpen:false,kasaiWorking:false,fieldOpen:false,roomCloses:0,fieldCloses:0,kasaiCloses:0,roomMenus:0,locked:false,reloads:0,timers:[],messages:[],scene:null,menu:null,battles:0};
  const node=id=>{if(!nodes.has(id))nodes.set(id,{id,open:false,hidden:false,textContent:'',querySelector:()=>null,focus(){},classList:{contains:()=>false,toggle(){}}});return nodes.get(id);};
  const primary={id:'primary'},dialog={id:'secret-room-dialog',querySelector:()=>primary};
  const c=vm.createContext({console,Engine,DATA,engine,playing:true,busy:false,introPending:false,storedSave:copy(initial),lastSave:0,SAVE_KEY:'room-save',BACKUP_KEY:'room-backup',saveIssueShown:false,
    pressedDirection:'right',directionSource:'keyboard',moveAnim:{x:1},padSprint:false,lastStep:0,controller:null,battleEffect:null,battleView:null,healingUntil:0,evolutionUntil:0,endingActive:false,
    settings:{autoRun:false,dayNight:false,reducedMotion:true},activePane:'',sealCount:32,performance:{now:()=>123},dayPhase:()=>.3,noteHeard(){},sound:{setScene:value=>controls.scene=value,getCurrentTrack:()=>null,fx(){}},
    $:node,escape:value=>String(value),ico:()=>'',tapStreak:()=>false,announceDiscoveries(){},noteTrick(){},nearHint:()=>'',updateFacing(){},interact(){trace.push('interact');},skipBattlePlayback(){},finishBattle(){},showDex(){},showMap(){},showBag(){},showSettings(){},returnToShop(){},battleActions(){},
    toast:message=>controls.messages.push(message),setTimeout(fn,ms){controls.timers.push({fn,ms});return controls.timers.length;},
    document:{body:{},activeElement:null,querySelector:selector=>selector.includes('secret-room-dialog')&&controls.roomOpen?dialog:selector.includes('kasai-challenge-dialog')&&controls.kasaiOpen?dialog:null,getElementById:node,dispatchEvent:event=>trace.push(event.type)},
    CustomEvent:class{constructor(type,details){this.type=type;this.detail=details?.detail;}},
    window:{location:{reload(){controls.reloads++;}},addEventListener(name,fn){(events[name]||=[]).push(fn);}},
    closeModal(){node('modal').open=false;trace.push('close-modal');},showDialogue(){},openModal(title,body,pane){controls.menu={title,body,pane};node('modal').open=true;},
    updateAll(){controls.updates++;trace.push('render');},loadStored(){controls.loads++;},resize(){trace.push('resize');},openBattle(){controls.battles++;},
    LT:{DATA,PlayerIdentity:model.LT.PlayerIdentity,Admin:{player:{id:OWNER,isAdmin:false}},Gamepad:class{constructor(config){controls.pad=config;}},
      Trade:{isLocked:()=>controls.locked},World:{moved(){controls.worldMoves++;},isDialogOpen:()=>controls.fieldOpen,closeDialog(){controls.fieldCloses++;controls.fieldOpen=false;return true;}},
      Rooms:{moved(){controls.roomMoves++;},isDialogOpen:()=>controls.roomOpen,isWorking:()=>controls.roomWorking,closeDialog(){controls.roomCloses++;controls.roomOpen=false;return true;},open(){controls.roomMenus++;return true;}},
      KasaiChallenge:{isDialogOpen:()=>controls.kasaiOpen,isWorking:()=>controls.kasaiWorking,closeDialog(){controls.kasaiCloses++;controls.kasaiOpen=false;return true;}}},
    localStorage:{getItem(key){if(key==='room-save'){controls.reads++;return controls.raw;}return null;},setItem(key,value){if(key==='room-backup')return;if(key!=='room-save')throw Error('Unexpected storage key');trace.push('write-attempt');if(controls.quota)throw Error('Storage quota exceeded');new Engine(JSON.parse(value));controls.raw=value;controls.writes++;trace.push('written');}}
  });
  vm.runInContext([barrier,keyboard,controllers,menu,scene,trades,gifting,bridge,'function dispatchRoomMenu(){const d={ui:"rooms"};'+roomMenuBranch+'}'].join('\n'),c);
  controls.reads=0;trace.length=0;
  return {c,controls,trace,events,primary,dialog,bridge:c.LT.adminBridge,room:RoomArt.createMap(record()),kasai:RoomArt.createMap(record('kasai'))};
}

test('room entry keeps the live room position while every durable save uses the safe outside entrance',()=>{
  const h=harness();assert.equal(h.bridge.enterSharedRoom(h.room).ok,true);
  assert.equal(h.c.engine.state.map,h.room.id);assert.equal(h.c.engine.state.x,9);assert.equal(h.c.engine.state.y,12);
  const saved=JSON.parse(h.controls.raw);assert.equal(saved.map,'village');assert.equal(saved.x,32);assert.equal(saved.y,8);assert(!saved.visited.some(id=>id.startsWith('room:')));
  assert.equal(new Engine(saved).state.map,'village');assert.equal(h.c.pressedDirection,null);assert.equal(h.c.directionSource,null);assert.equal(h.controls.worldMoves,1);
  Object.assign(h.c.engine.state,{x:3,y:8,facing:'left',coins:456});assert.equal(h.c.save(),true);
  assert.equal(h.c.engine.state.map,h.room.id);assert.equal(h.c.engine.state.x,3);assert.equal(JSON.parse(h.controls.raw).coins,456);
  assert.equal(h.bridge.leaveSharedRoom().ok,true);assert.equal(h.c.engine.state.map,'village');assert.equal(h.c.engine.state.x,32);assert.equal(h.c.engine.state.y,8);assert.equal(h.c.engine.state.facing,'down');
});

test('entry validates safe return and spawn tiles and does not travel if the initial save fails',()=>{
  for(const map of [{...RoomArt.createMap(record()),id:'room:forged'},{...RoomArt.createMap(record()),returnPoint:{map:'unknown',x:1,y:1}},{...RoomArt.createMap(record()),returnPoint:{map:'village',x:0,y:0}},{...RoomArt.createMap(record()),spawn:{x:0,y:0}}]){
    const h=harness(),before=copy(h.c.engine.state);assert.equal(h.bridge.enterSharedRoom(map).ok,false);assert.deepEqual(copy(h.c.engine.state),before);assert.equal(h.controls.writes,0);
  }
  const h=harness();h.controls.quota=true;const before=copy(h.c.engine.state),raw=h.controls.raw;
  assert.equal(h.bridge.enterSharedRoom(h.room).ok,false);assert.deepEqual(copy(h.c.engine.state),before);assert.equal(h.controls.raw,raw);assert.equal(h.controls.worldMoves,0);
});

test('entry and Kasai start respect adventure, intro, battle, internet and exchange guards',()=>{
  const blockers=[h=>h.c.playing=false,h=>h.c.busy=true,h=>h.c.introPending=true,h=>h.c.engine.battle={},h=>h.c.LT.onlineActive=true,h=>h.c.LT.localTradeActive=true,h=>h.controls.locked=true];
  for(const block of blockers){const h=harness();block(h);assert.equal(h.bridge.enterSharedRoom(h.room).ok,false);assert.equal(h.bridge.startKasaiBattle({}).ok,false);assert.equal(h.controls.writes,0);}
  const h=harness();assert.equal(h.bridge.startKasaiBattle({}).ok,false);assert.equal(h.controls.battles,0);
});

test('talking to the mounted Kasai NPC starts the actual solo Engine with its prepared party',()=>{
  const h=harness();h.bridge.enterSharedRoom(h.kasai);Object.assign(h.c.engine.state,{x:12,y:5,facing:'up'});
  const challenge={id:'bridge-test-session',token:'bridge-test-token-12345678',seed:7,rulesVersion:model.LT.KasaiRules.version,party:copy(model.LT.KasaiRules.normalizeParty(h.c.engine.state.party))};
  assert.equal(h.bridge.startKasaiBattle(challenge).ok,true);assert.equal(h.controls.battles,1);assert.equal(h.c.engine.battle.kasai,true);assert.equal(h.c.engine.battle.enemyTeam.length,3);assert.equal(h.c.engine.battle.kasaiChallenge.id,challenge.id);
  assert.equal(JSON.parse(h.controls.raw).map,'village');assert.equal(h.c.engine.state.map,h.kasai.id);
});

test('room refresh preserves safe position, relocates a blocked tile, and leaves battle maps stable',()=>{
  const h=harness();h.bridge.enterSharedRoom(h.room);Object.assign(h.c.engine.state,{x:3,y:5,facing:'left'});
  const refreshed=RoomArt.createMap({...record(),revision:2});assert.equal(h.bridge.refreshSharedRoom(refreshed).ok,true);assert.equal(h.c.engine.state.x,3);assert.equal(h.c.engine.state.y,5);assert.equal(h.c.engine.state.facing,'left');
  const blocked=RoomArt.createMap({...record(),revision:3,decorations:[{id:'plant',itemId:'plant',x:3,y:5,rotation:0}]});assert.equal(h.bridge.refreshSharedRoom(blocked).ok,true);assert.equal(h.c.engine.state.x,9);assert.equal(h.c.engine.state.y,12);
  const current=h.c.engine.map;h.c.engine.battle={};assert.equal(h.bridge.refreshSharedRoom(refreshed).ok,false);assert.equal(h.c.engine.map,current);assert.equal(h.bridge.leaveSharedRoom().ok,false);
});

test('Kasai reward commits durably before ACK eligibility and retains its live room and random gender',()=>{
  const h=harness();h.bridge.enterSharedRoom(h.kasai);Object.assign(h.c.engine.state,{x:12,y:5,facing:'up'});h.c.save();
  const state=h.c.engine.state,raw=h.controls.raw;h.controls.quota=true;
  let result=h.bridge.receiveKasaiReward(gift);assert.equal(result.ok,false);assert.equal(h.c.engine.state,state);assert.equal(h.controls.raw,raw);assert(!h.c.engine.state.giftReceipts.includes(gift.id));
  h.controls.quota=false;h.trace.length=0;result=h.bridge.receiveKasaiReward(gift);if(result.ok)h.trace.push('ACK-allowed');assert.equal(result.ok,true);
  assert(h.trace.indexOf('written')<h.trace.indexOf('ACK-allowed'));assert.equal(h.c.engine.state.map,h.kasai.id);assert.equal(h.c.engine.state.x,12);assert.equal(h.c.engine.state.y,5);
  const saved=JSON.parse(h.controls.raw),mon=saved.party.find(mon=>mon.grantId===gift.id);assert(mon);assert.equal(mon.gender,'female');assert.equal(mon.level,70);assert.equal(saved.map,'village');assert.equal(saved.x,32);assert.equal(saved.y,8);
  const writes=h.controls.writes;assert.equal(h.bridge.receiveKasaiReward(gift).alreadyReceived,true);assert.equal(h.controls.writes,writes);assert.equal(h.c.save(),true);assert.equal(h.controls.timers.length,0,'This tab remembers its own new receipt before the next save');
});

test('reward refuses stale durable storage, including full reserves and a previously released receipt',()=>{
  for(const mutation of ['full','released']){
    const h=harness();h.bridge.enterSharedRoom(h.kasai);h.c.save();const state=copy(h.c.engine.state),writes=h.controls.writes;
    const disk=new Engine(JSON.parse(h.controls.raw));
    if(mutation==='full'){disk.state.storage=Array.from({length:192},()=>disk.makeMonster('komori',1));disk.state.coins=987;}
    else{assert.equal(disk.receiveKasaiReward(gift).ok,true);const index=disk.state.party.findIndex(mon=>mon.grantId===gift.id);assert.equal(disk.releaseParty(index).ok,true);}
    h.controls.raw=JSON.stringify(disk.serialize());const raw=h.controls.raw;
    const result=h.bridge.receiveKasaiReward(gift);assert.equal(result.ok,false);assert.equal(result.pending,true);assert.equal(h.controls.raw,raw);assert.equal(h.controls.writes,writes);assert.deepEqual(copy(h.c.engine.state),state);
  }
});

test('an old sleeping tab cannot autosave away a newly delivered Kasai reward',()=>{
  const h=harness(),disk=new Engine(JSON.parse(h.controls.raw));assert.equal(disk.receiveKasaiReward(gift).ok,true);h.controls.raw=JSON.stringify(disk.serialize());const raw=h.controls.raw;
  assert.equal(h.c.save(),false);assert.equal(h.controls.raw,raw);assert.equal(h.controls.writes,0);assert.equal(h.controls.timers.length,1);assert.equal(h.c.pressedDirection,null);h.controls.timers[0].fn();assert.equal(h.controls.reloads,1);
});

test('already-saved reward can ACK after storage fills without adding or writing another individual',()=>{
  const h=harness();assert.equal(h.bridge.receiveKasaiReward(gift).ok,true);h.c.engine.state.storage=Array.from({length:192},()=>h.c.engine.makeMonster('komori',1));h.c.save();
  const raw=h.controls.raw,writes=h.controls.writes,count=h.c.engine.state.party.length+h.c.engine.state.storage.length;
  const result=h.bridge.receiveKasaiReward(gift);assert.equal(result.ok,true);assert.equal(result.alreadyReceived,true);assert.equal(h.controls.raw,raw);assert.equal(h.controls.writes,writes);assert.equal(h.c.engine.state.party.length+h.c.engine.state.storage.length,count);
});

test('secret-room menu opens the room manager and native dialog keys remain unconsumed',()=>{
  const h=harness();h.c.showMenu();assert.match(h.controls.menu.body,/data-ui="rooms"/);h.c.dispatchRoomMenu();assert.equal(h.controls.roomMenus,1);
  h.controls.roomOpen=true;
  for(const key of ['Tab','Enter','Escape','ArrowUp',' ']){
    let prevented=0;for(const callback of h.events.keydown)callback({key,code:key,target:{tagName:'DIV'},preventDefault(){prevented++;}});
    assert.equal(prevented,0,key+' remains a native dialog key');
  }
  const context=h.c.controllerContext();assert.equal(context.mode,'modal');assert.equal(context.scope,h.dialog);assert.equal(context.defaultTarget,h.primary);
  h.c.controllerBack();assert.equal(h.controls.roomCloses,1);h.controls.roomOpen=true;h.c.setupController();h.controls.pad.onMenu();assert.equal(h.controls.roomCloses,2);
  h.controls.roomWorking=true;assert.equal(h.c.controllerContext().busy,true);const position=copy(h.c.engine.state);h.controls.pad.onMove('up',false);h.c.walk(0,-1);assert.deepEqual(copy(h.c.engine.state),position);
});

test('solo Kasai battle scene uses its dedicated theme and ordinary battles clear that marker',()=>{
  const h=harness();h.bridge.enterSharedRoom(h.kasai);h.c.engine.battle={kasai:true,result:null};h.c.updateScene();assert.equal(h.controls.scene.kasai,true);assert.equal(h.controls.scene.interior,true);
  h.c.engine.battle={result:null};h.c.updateScene();assert.equal(h.controls.scene.kasai,false);
});

// Reuse the existing controlled timer/DOM field harness while executing the
// current field-world.js; only its test setup is evaluated here.
const fieldTests=fs.readFileSync(path.join(__dirname,'check-field-world.cjs'),'utf8'),fieldSource=fs.readFileSync(path.join(root,'field-world.js'),'utf8');
const harnessStart=fieldTests.indexOf('function runtime('),harnessEnd=fieldTests.indexOf("test('runtime heartbeat",harnessStart);assert(harnessStart>0&&harnessEnd>harnessStart);
const SELF='P0000000000000001',PEER='P0000000000000002',OTHER='P0000000000000003';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const actor=(overrides={})=>({id:PEER,name:'旅人',isAdmin:false,avatar:'male',map:'village',x:2,y:1,facing:'left',status:'idle',updatedAt:1000,...overrides});
const packet=(players=[],overrides={})=>({self:actor({id:SELF,x:1,facing:'right'}),players,serverTime:1000,ttlMs:15000,...overrides});
const fieldRuntime=vm.runInNewContext(fieldTests.slice(harnessStart,harnessEnd)+'\nruntime',{vm,assert,console,SOURCE:fieldSource,SELF,PEER,OTHER,copy,actor,packet,settle});

test('approaching verified field Kasai routes to the solo room without invitation or PeerJS battle',async()=>{
  const h=fieldRuntime(),entered=[],online=[];h.players=[actor({isAdmin:true,avatar:'kasai',name:'謎のトレーナー カサイ'})];h.context.LT.Rooms={enterKasai:async id=>{entered.push(id);return true;},isWorking:()=>false};h.context.LT.requestOnline=options=>online.push(options);
  await h.step(800);assert.equal(h.context.LT.World.interact(),true);h.click('battle');await h.step(300);
  assert.deepEqual(entered,[PEER]);assert.deepEqual(online,[]);assert(!h.calls.some(call=>call.path==='/world/invitations'));
});

test('refreshPresence waits for stale in-flight map data and sends a fresh throttled room position',async()=>{
  const old=deferred();let posts=0;const h=fieldRuntime({handle:(path,options)=>path==='/world/presence'&&options.method==='POST'&&++posts===1?old.promise:undefined});
  await h.step(800);const room='room:'+OWNER;h.context.LT.DATA.maps[room]={};Object.assign(h.state,{map:room,x:12,y:5,facing:'up'});h.context.LT.World.moved();
  const fresh=h.context.LT.World.refreshPresence();old.resolve(h.snapshot('village'));await settle();await h.step(300);assert.equal(await fresh,true);
  const calls=h.calls.filter(call=>call.method==='POST');assert.equal(calls.length,2);assert.equal(calls[1].body.map,room);assert.equal(calls[1].body.x,12);assert.equal(calls[1].body.y,5);assert(calls[1].at-calls[0].at>=270);
  h.state.y=6;const next=h.context.LT.World.refreshPresence();await settle();await h.step(269);assert.equal(h.calls.filter(call=>call.method==='POST').length,2);await h.step(1);assert.equal(await next,true);assert.equal(h.calls.filter(call=>call.method==='POST').at(-1).body.y,6);
});

test('refreshPresence refuses a hidden or disconnected game instead of reporting fresh position',async()=>{
  const h=fieldRuntime();await h.step(800);const count=h.calls.filter(call=>call.method==='POST').length;
  h.doc.hidden=true;assert.equal(await h.context.LT.World.refreshPresence(),false);h.doc.hidden=false;h.context.navigator.onLine=false;assert.equal(await h.context.LT.World.refreshPresence(),false);assert.equal(h.calls.filter(call=>call.method==='POST').length,count);
});
