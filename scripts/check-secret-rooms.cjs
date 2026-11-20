#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),test=require('node:test');
const {pathToFileURL}=require('node:url');
const {placement,footprint,rearrangeDecorations}=require('../secret-rooms.js');
const root=path.resolve(__dirname,'..'),SOURCE=fs.readFileSync(path.join(root,'secret-rooms.js'),'utf8'),ART=fs.readFileSync(path.join(root,'room-art.js'),'utf8');
const SELF='P0000000000000001',PEER='P0000000000000002',KASAI='P0000000000000003';
const copy=value=>JSON.parse(JSON.stringify(value)),settle=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const contractContext=vm.createContext({});vm.runInContext(ART,contractContext);const {catalog,layouts}=copy(contractContext.LT.RoomArt);
const makeRoom=(id=SELF,kind=id===KASAI?'kasai':'secret')=>({id,mapId:'room:'+id,owner:{id,name:id===SELF?'みどり':id===KASAI?'謎のトレーナー カサイ':'旅人',isAdmin:id===KASAI},
  name:id===KASAI?'カサイの間':'星の読書室',kind,...copy(layouts[kind]),entrance:{map:'village',x:4,y:2,facing:'up',returnX:4,returnY:3},decorations:[],revision:1});
const item=(itemId,x,y,rotation=0,id='candidate')=>({id,itemId,x,y,rotation});

test('placement agrees with server bounds, every rotation, protected paths, and non-solid overlap rules',async()=>{
  const {validateRoomDecorations}=await import(pathToFileURL(path.join(root,'server/server.mjs')).href);
  for(const kind of ['secret','kasai'])for(const furniture of catalog)for(const rotation of [0,90,180,270]) {
    const room=makeRoom(SELF,kind),size=footprint(furniture,rotation);
    assert.equal(size.width,rotation%180?furniture.height:furniture.width);
    for(const [x,y] of [[1,2],[room.width-1-size.width,room.height-2-size.height],[1,room.height-1-size.height],[0,2],[2,1],[2.5,4],
      [kind==='kasai'?11:8,8],[8,3],[1,room.height-size.height]]) {
      const candidate=item(furniture.id,x,y,rotation);let accepted=true;try{validateRoomDecorations([candidate],kind);}catch{accepted=false;}
      assert.equal(placement(room,catalog,[],candidate)===null,accepted,`${kind}/${furniture.id}/${rotation} at ${x},${y}`);
    }
  }
  const room=makeRoom(),rug=item('rug',2,3,0,'rug');
  assert.match(placement(room,catalog,[rug],item('lamp',3,4)),/重ならない/,'Non-solid rugs still reserve their placement footprint');
  assert.equal(placement(room,catalog,[rug],item('rug',3,4,0,'rug')),null,'Moving an instance must ignore its previous footprint');
  assert.match(placement(room,catalog,[],item('lamp',2,3,45)),/家具/);
});

test('thirty-two decorations prevent additions but allow moving existing furniture',()=>{
  const room=makeRoom(),decos=Array.from({length:32},(_,i)=>item('plant',1+i%6,2+Math.floor(i/6),0,'p'+i));
  assert.match(placement(room,catalog,decos,item('plant',15,11,0,'new')),/32/);
  assert.equal(placement(room,catalog,decos,item('plant',15,11,0,'p0')),null);
});

// Small DOM/timer harness, with the real room factory and art entry points.
// Network calls are recorded in memory; these checks never touch real rooms.
function runtime({handle,own=false,others=true}={}) {
  let now=1000,timerId=0,uid=0;const timers=new Map(),events={},globalEvents={},calls=[],messages=[],entered=[],refreshed=[],store=new Map();
  if(own)store.set(SELF,makeRoom());if(others)for(const [id,x] of [[PEER,7],[KASAI,9]]){const room=makeRoom(id);room.entrance.x=room.entrance.returnX=x;store.set(id,room);}
  const decode=v=>v.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  const dataKey=key=>key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
  class Element {
    constructor(tag,attrs='') {
      this.tag=tag;this.dataset={};this.children=[];this.listeners={};this.open=false;this.disabled=/(?:^|\s)disabled(?:\s|$)/.test(attrs);this.textContent='';this.value='';this.width=1;this.height=1;
      const classes=new Set();this.classList={add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v),toggle(v,value){const yes=value===undefined?!classes.has(v):value;yes?classes.add(v):classes.delete(v);return yes;}};
      for(const m of attrs.matchAll(/([\w-]+)="([^"]*)"/g)){const key=m[1],value=decode(m[2]);if(key.startsWith('data-'))this.dataset[dataKey(key)]=value;else this[key==='class'?'className':key]=['width','height'].includes(key)?Number(value):value;}
      for(const m of attrs.matchAll(/\b(data-[\w-]+)(?=\s|$)/g))this.dataset[dataKey(m[1])]??='';
    }
    setAttribute(key,value){if(key.startsWith('data-'))this.dataset[dataKey(key)]=String(value);else this[key]=String(value);}
    append(node){this.children.push(node);}
    addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
    emit(type,event={}){for(const fn of this.listeners[type]||[])fn({target:this,preventDefault(){this.defaultPrevented=true;},...event});}
    showModal(){this.open=true;}
    close(){if(!this.open)return;this.open=false;this.emit('close');}
    matches(selector){
      if(selector.includes(','))return selector.split(',').some(value=>this.matches(value.trim()));
      if(selector.startsWith('#'))return this.id===selector.slice(1);
      const match=selector.match(/^\[(data-[\w-]+)(?:="([^"]*)")?\]$/);
      if(match)return Object.hasOwn(this.dataset,dataKey(match[1]))&&(match[2]===undefined||this.dataset[dataKey(match[1])]===match[2]);
      return this.tag===selector;
    }
    closest(selector){return this.matches(selector)?this:null;}
    querySelectorAll(selector){return this.children.filter(child=>child.matches(selector));}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
    getBoundingClientRect(){return {left:0,top:0,width:this.width,height:this.height};}
    getContext(){return this.ctx||(this.ctx=new Proxy({canvas:this,measureText:text=>({width:String(text).length*8})},{get(target,key){if(key in target)return target[key];return ()=>{};}}));}
    set innerHTML(value){this.html=value;this.children=[];for(const match of value.matchAll(/<(button|input|select|canvas|p|span|h2|h3|div|section|label)\b([^>]*)>/g))this.children.push(new Element(match[1],match[2]));}
    get innerHTML(){return this.html||'';}
  }
  const doc={hidden:false,nodes:[],createElement:tag=>new Element(tag),body:{append(node){doc.nodes.push(node);}},
    addEventListener(type,fn){(events[type]||=[]).push(fn);},dispatchEvent(event){for(const fn of events[event.type]||[])fn(event);}};
  const outdoor={id:'village',name:'はじまりの里',width:12,height:10,tiles:Array.from({length:10},(_,y)=>Array.from({length:12},(_,x)=>x===0||y===0||x===11||y===9||[4,7,9].includes(x)&&y===2?'#':'_').join('')),npcs:[],exits:[],level:[1,4]};
  const LT={DATA:{maps:{village:outdoor,forest:{...outdoor,id:'forest'}}},Admin:{player:{id:SELF,name:'みどり',isAdmin:false}},Trade:{isLocked:()=>false}};
  const newEngine=()=>({state:{started:true,map:'village',x:4,y:4,facing:'down'},battle:null,get map(){return LT.DATA.maps[this.state.map];},nearbyNPC(){return null;}});
  const h={LT,doc,store,calls,messages,entered,refreshed,engine:newEngine(),playing:true,bridgeBusy:false,presenceRefreshes:0,freshPresence:true,liveStages:[],
    faceWall(){this.engine.state.x=4;this.engine.state.y=3;this.engine.state.facing='up';},
    faceMoveWall(){this.engine.state.x=1;this.engine.state.y=5;this.engine.state.facing='left';},
    dialog:()=>doc.nodes.find(n=>n.id==='secret-room-dialog'),
    action(name,filter={}){return this.dialog()?.children.find(n=>n.dataset.roomAction===name&&Object.entries(filter).every(([key,value])=>n.dataset[key]===value));},
    click(name,filter={}){const button=this.action(name,filter);assert(button,'Missing room action '+name);this.dialog().emit('click',{target:button});},
    input(id,value){const node=this.dialog().querySelector('#'+id);assert(node,'Missing input '+id);node.value=String(value);node.emit('input');},
    event(type,extra={}){doc.dispatchEvent({type,...extra});},globalEvent(type,extra={}){for(const fn of globalEvents[type]||[])fn({type,...extra});},
    replaceGame(){this.engine=newEngine();this.event('pachi-game-ready');},
    identity(id){LT.Admin.player={id,name:'交代した旅人',isAdmin:false};this.globalEvent('storage',{key:'pachi-player-identity-v1'});},
    async step(ms=0){now+=ms;for(let i=0;i<40;i++){const next=[...timers].filter(([,t])=>t.at<=now).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;timers.delete(next[0]);next[1].fn();await settle();}await settle();},
    async editOwn(){assert(await LT.Rooms.enter(SELF));assert(await LT.Rooms.open());this.click('edit');await settle();assert(this.action('place'));},
    place(itemId,x,y){this.click('item',{roomItem:itemId});this.input('room-x',x);this.input('room-y',y);this.click('place');},
    marks(){const output=[],original=LT.RoomArt;LT.RoomArt={...original,drawDoor:(ctx,room,options)=>output.push({id:room.id,entrance:copy(room.entrance),active:options.active})};try{LT.Rooms.drawEntrances({},this.engine.map);}finally{LT.RoomArt=original;}return output;},
  };
  LT.Admin.worldRequest=async(url,options={})=>{
    calls.push({path:url,...copy(options)});const supplied=handle?.(url,options,h);if(supplied!==undefined)return supplied;
    if(url==='/world/rooms/catalog')return {catalog:copy(catalog),layouts:copy(layouts)};
    if(url==='/world/rooms/mine')return {room:copy(store.get(LT.Admin.player.id)||null)};
    if(url==='/world/rooms/kasai')return {room:copy(store.get(KASAI)||null)};
    if(url.startsWith('/world/rooms?map='))return {rooms:copy([...store.values()].filter(room=>room.entrance.map===decodeURIComponent(url.split('=')[1])))};
    if(url==='/world/rooms'&&options.method==='POST') {
      const b=options.body;if(store.has(LT.Admin.player.id))throw Error('部屋は一人一つです。');
      if([...store.values()].some(room=>room.entrance.map===b.map&&room.entrance.x===b.x&&room.entrance.y===b.y))throw Error('この壁には部屋があります。');
      const room=makeRoom(LT.Admin.player.id,LT.Admin.player.isAdmin?'kasai':'secret');room.name=b.name;room.entrance={map:b.map,x:b.x,y:b.y,facing:b.facing,returnX:h.engine.state.x,returnY:h.engine.state.y};store.set(room.id,room);return {room:copy(room)};
    }
    if(url.endsWith('/relocate')&&options.method==='POST'){const id=url.split('/').at(-2),room=store.get(id),b=options.body;assert.equal(id,LT.Admin.player.id);if(b.revision!==room.revision)throw Error('別の画面で更新されました。');const updated={...room,entrance:{map:b.map,x:b.x,y:b.y,facing:b.facing,returnX:h.engine.state.x,returnY:h.engine.state.y},revision:room.revision+1};store.set(id,updated);return {room:copy(updated)};}
    const id=url.split('/').at(-1),room=store.get(id);
    if(options.method==='PATCH') {
      assert.equal(id,LT.Admin.player.id,'A visitor attempted to save another owner’s room');
      if(options.body.revision!==room.revision)throw Error('別の画面で更新されました。');
      const updated={...room,...copy(options.body),revision:room.revision+1};store.set(id,updated);return {room:copy(updated)};
    }
    return {room:copy(room||null)};
  };
  LT.World={async refreshPresence(){h.presenceRefreshes++;return h.freshPresence;}};
  LT.adminBridge={getEngine:()=>h.engine,isPlaying:()=>h.playing,isBusy:()=>h.bridgeBusy,closeModal(){},getPlayerName:()=>LT.Admin.player.name,toast:message=>messages.push(message),
    enterSharedRoom(map){LT.DATA.maps[map.id]=map;Object.assign(h.engine.state,{map:map.id,...map.spawn});entered.push(map);return {ok:true};},
    stageKasaiLive(room,session){h.liveStages.push({room:copy(room),session:copy(session)});const map=LT.RoomArt.createMap(room);LT.DATA.maps[map.id]=map;Object.assign(h.engine.state,{map:map.id,x:12,y:session.role==='kasai'?4:16,facing:session.role==='kasai'?'down':'up'});return {ok:true};},
    refreshSharedRoom(map){if(h.engine.state.map!==map.id)return {ok:false};LT.DATA.maps[map.id]=map;refreshed.push(map);return {ok:true};},
    leaveSharedRoom(){const point=h.engine.map.returnPoint;if(!point)return {ok:false};Object.assign(h.engine.state,{map:point.map,x:point.x,y:point.y,facing:point.facing});return {ok:true};},
  };
  const context=vm.createContext({LT,document:doc,navigator:{onLine:true},console,crypto:{randomUUID:()=>`test-room-item-${++uid}`},
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{at:now+delay,fn});return id;},clearTimeout:id=>timers.delete(id),
    addEventListener(type,fn){(globalEvents[type]||=[]).push(fn);}});
  vm.runInContext(ART,context);vm.runInContext(SOURCE,context);return h;
}

test('manager retains the disabled create control off a wall and restores controls after loading',async()=>{
  const h=runtime();assert(await h.LT.Rooms.open());assert.equal(h.LT.Rooms.isWorking(),false);assert.equal(h.action('create').disabled,true);
  h.click('create');await settle();assert(!h.calls.some(call=>call.method==='POST'));
  h.LT.Rooms.closeDialog();h.faceWall();assert(await h.LT.Rooms.open());assert.equal(h.action('create').disabled,false);
  h.input('room-new-name','星と本の部屋');h.click('create');await settle();assert.equal(h.entered.length,1);assert.equal(h.entered[0].roomOwner,SELF);
  assert.equal(h.entered[0].name,'星と本の部屋');assert.equal(h.LT.Rooms.isWorking(),false);assert.equal(h.LT.Rooms.isDialogOpen(),false);
});

test('A at an empty wall prepares the first room for either player role and sends fresh presence before creation',async()=>{
  for(const isAdmin of [false,true]){
    const h=runtime({others:false});if(isAdmin){h.identity(KASAI);h.LT.Admin.player.isAdmin=true;}h.faceWall();
    assert.match(h.LT.Rooms.hint(),/作成・移転/);assert.equal(h.LT.Rooms.interact(),true);await settle();
    assert.match(h.dialog().innerHTML,/この壁に部屋を作りますか/);assert(h.dialog().querySelector('#room-entrance-preview'));
    assert.equal(h.dialog().querySelector('#room-new-name').value,isAdmin?'カサイのひみつ部屋':'みどりの秘密部屋');
    assert(!h.calls.some(call=>call.method==='POST'),'A first presents the destination and name for review');
    const presence=deferred();h.LT.World.refreshPresence=async()=>{h.presenceRefreshes++;return presence.promise;};h.click('create');await settle();
    assert.equal(h.presenceRefreshes,1);assert(!h.calls.some(call=>call.method==='POST'),'Creation must wait until the current wall position is published');
    presence.resolve(true);await settle();assert.equal(h.store.size,1);assert.equal(h.entered.length,1);assert.equal(h.entered[0].roomKindTag,isAdmin?'kasai':'secret');
    const saved=h.store.get(isAdmin?KASAI:SELF);assert.deepEqual(saved.entrance,{map:'village',x:4,y:2,facing:'up',returnX:4,returnY:3});
    h.LT.Rooms.leave();h.faceWall();assert.deepEqual(h.marks().map(mark=>[mark.id,mark.entrance.x,mark.entrance.y,mark.active]),[[saved.id,4,2,true]]);
  }
});

test('A on an occupied wall visits its current room even before any area list is loaded',async()=>{
  for(const id of [SELF,PEER,KASAI]){
    const h=runtime({others:false}),room=makeRoom(id);h.store.set(id,room);h.faceWall();
    assert.equal(h.LT.Rooms.interact(),true);await settle();assert.equal(h.entered.length,1);assert.equal(h.entered[0].roomOwner,id);
    assert(h.calls.some(call=>call.path==='/world/rooms?map=village'));assert.equal(h.action('create'),undefined);assert.equal(h.action('confirm-relocate'),undefined);
    assert(!h.calls.some(call=>call.method==='POST'),'Existing entrance visits cannot create or replace a room');
  }
});

test('a cached empty wall is rechecked before A can offer creation or relocation',async()=>{
  for(const own of [false,true]){
    const h=runtime({own,others:false});h.faceMoveWall();await h.LT.Rooms.open();h.LT.Rooms.closeDialog();
    const visitor=makeRoom(PEER);visitor.entrance={map:'village',x:0,y:5,facing:'left',returnX:1,returnY:5};h.store.set(PEER,visitor);
    assert.equal(h.LT.Rooms.interact(),true);await settle();assert.equal(h.entered.at(-1).roomOwner,PEER);assert.equal(h.action('confirm-relocate'),undefined);assert.equal(h.action('create'),undefined);
    assert(!h.calls.some(call=>call.method==='POST'));
  }
});

test('A at another empty wall reviews relocation of the existing room and keeps its name and furniture',async()=>{
  for(const id of [SELF,KASAI]){
    const h=runtime({others:false}),room=makeRoom(id);room.decorations=[item('plant',2,3,0,'kept')];h.store.set(id,room);h.identity(id);h.LT.Admin.player.isAdmin=id===KASAI;h.faceMoveWall();
    assert.equal(h.LT.Rooms.interact(),true);await settle();assert(h.action('confirm-relocate'));assert.equal(h.action('create'),undefined);assert.match(h.dialog().innerHTML,/家具と部屋の名前/);
    h.click('confirm-relocate');await settle();assert.equal(h.store.size,1);assert.equal(h.store.get(id).id,id);assert.equal(h.store.get(id).name,room.name);assert.deepEqual(h.store.get(id).decorations,room.decorations);
    assert.deepEqual(h.marks().map(mark=>[mark.id,mark.entrance.x,mark.entrance.y]),[[id,0,5]]);assert.equal(h.engine.state.map,'village');assert.equal(h.presenceRefreshes,1);
    assert(!h.calls.some(call=>call.path==='/world/rooms'&&call.method==='POST'));
  }
});

test('wall interaction leaves ordinary tiles, NPCs, doors and shared-room walls to the normal game interaction',async()=>{
  for(const kind of ['floor','npc','exit','shared-room']){
    const h=runtime({others:false});if(kind!=='floor')h.faceWall();
    if(kind==='npc')h.engine.map.npcs=[{x:4,y:2}];if(kind==='exit')h.engine.map.exits=[{x:4,y:2}];if(kind==='shared-room')h.engine.map.sharedRoom=true;
    assert.equal(h.LT.Rooms.interact(),false,kind);assert.equal(h.LT.Rooms.hint(),null,kind);assert.equal(h.calls.length,0,kind);
  }
});

test('failed or stale wall lookups never turn an unknown entrance into a creation form',async()=>{
  for(const mode of ['failure','wall','identity','game']){
    const pending=deferred(),h=runtime({others:false,handle:url=>url.startsWith('/world/rooms?map=')?pending.promise:undefined});h.faceWall();assert.equal(h.LT.Rooms.interact(),true);await settle();
    if(mode==='wall')h.faceMoveWall();if(mode==='identity')h.identity(PEER);if(mode==='game')h.replaceGame();
    if(mode==='failure')pending.reject(Error('入口の接続を確認してください。'));else pending.resolve({rooms:[]});await settle();
    assert.equal(h.action('create'),undefined,mode);assert.equal(h.action('confirm-relocate'),undefined,mode);assert.equal(h.entered.length,0,mode);assert.equal(h.LT.Rooms.isWorking(),false,mode);assert(!h.calls.some(call=>call.method==='POST'));
  }
});

test('creation and relocation cannot publish a stale wall after presence synchronization changes position or identity',async()=>{
  for(const move of [false,true])for(const change of ['position','facing','identity','no-presence']){
    const h=runtime({own:move,others:false});move?h.faceMoveWall():h.faceWall();assert.equal(h.LT.Rooms.interact(),true);await settle();
    const before=copy([...h.store.values()]),presence=deferred();h.LT.World.refreshPresence=()=>presence.promise;h.click(move?'confirm-relocate':'create');await settle();
    if(change==='position')move?h.faceWall():h.faceMoveWall();if(change==='facing')h.engine.state.facing='down';if(change==='identity')h.identity(PEER);
    presence.resolve(change!=='no-presence');await settle();
    assert(!h.calls.some(call=>call.method==='POST'),`${move?'Relocate':'Create'} continued after ${change}`);assert.deepEqual([...h.store.values()],before);assert.equal(h.entered.length,0);assert.equal(h.LT.Rooms.isWorking(),false);
  }
});

test('a saved wall response cannot teleport or replace entrance markers after the player moves to another cell',async()=>{
  for(const move of [false,true]){
    const response=deferred(),h=runtime({own:move,others:false,handle:(url,options)=>options.method==='POST'&&(url==='/world/rooms'||url.endsWith('/relocate'))?response.promise:undefined});
    move?h.faceMoveWall():h.faceWall();assert.equal(h.LT.Rooms.interact(),true);await settle();h.click(move?'confirm-relocate':'create');await settle();
    assert.equal(h.calls.filter(call=>call.method==='POST').length,1);const saved=makeRoom();if(move){saved.revision=2;saved.entrance={map:'village',x:0,y:5,facing:'left',returnX:1,returnY:5};}
    move?h.faceWall():h.faceMoveWall();response.resolve({room:saved});await settle();
    assert.equal(h.entered.length,0);assert.equal(h.engine.state.map,'village');assert.equal(h.LT.Rooms.current(),null);assert.equal(h.LT.Rooms.isWorking(),false);
    assert.deepEqual(h.marks().map(mark=>[mark.entrance.x,mark.entrance.y]),move?[[4,2]]:[],'A late response changed the doorway shown for the reviewed wall');
  }
});

test('an older area poll cannot redraw the previous entrance after a successful relocation',async()=>{
  const pending=deferred();let delayNext=false;
  const h=runtime({own:true,others:false,handle:url=>{if(delayNext&&url.startsWith('/world/rooms?map=')){delayNext=false;return pending.promise;}}});
  h.faceMoveWall();await h.LT.Rooms.open();const oldRoom=copy(h.store.get(SELF));delayNext=true;await h.step(1200);h.click('relocate');h.click('confirm-relocate');await settle();
  assert.deepEqual(h.marks().map(mark=>[mark.entrance.x,mark.entrance.y]),[[0,5]]);pending.resolve({rooms:[oldRoom]});await settle();
  assert.deepEqual(h.marks().map(mark=>[mark.entrance.x,mark.entrance.y]),[[0,5]],'The old entrance reappeared when a stale area response completed');
});

test('any visitor can enter public rooms, while only the owner sees furniture editing',async()=>{
  const h=runtime({own:true});assert(await h.LT.Rooms.enter(PEER));assert.equal(h.engine.state.map,'room:'+PEER);assert(await h.LT.Rooms.open());
  assert.equal(h.action('edit'),undefined);assert(h.action('leave'));h.click('leave');assert.equal(h.engine.state.map,'village');assert.equal(h.engine.state.y,3);
  await h.editOwn();h.place('plant',2,3);h.click('save');await settle();assert.equal(h.store.get(SELF).decorations.length,1);assert.equal(h.store.get(PEER).decorations.length,0);
  assert.equal(h.store.get(SELF).revision,2);assert.equal(h.refreshed.at(-1).roomRevision,2);
});

test('Kasai owner has a direct decoration action outside the stage and saves without teleporting',async()=>{
  const h=runtime();h.identity(KASAI);h.LT.Admin.player.isAdmin=true;
  assert(await h.LT.Rooms.open());assert.equal(h.action('create'),undefined);
  assert.match(h.dialog().innerHTML,/運営カサイの部屋/);assert.match(h.dialog().innerHTML,/カサイの部屋を飾る/);
  assert.equal(h.dialog().children.filter(node=>node.dataset.roomAction==='visit'&&node.dataset.roomOwner===KASAI).length,1);
  h.click('edit-own');await settle();assert(h.action('place'));assert.match(h.dialog().innerHTML,/中央の対戦ステージと通路の両側/);
  assert.equal(h.dialog().querySelector('#room-editor-canvas').width,24*28);
  h.place('plant',20,10);h.place('lamp',11,10);assert.match(h.dialog().querySelector('[data-room-message]').textContent,/入口・通路・対戦ステージ/);
  h.input('room-edit-name','カサイの星見の間');h.click('save');await settle();
  assert.equal(h.store.get(KASAI).decorations.length,1);assert.equal(h.store.get(KASAI).decorations[0].x,20);
  assert.equal(h.store.get(KASAI).name,'カサイの星見の間');assert.equal(h.store.get(KASAI).kind,'kasai');
  assert.equal(h.engine.state.map,'village');assert.equal(h.entered.length,0);assert.equal(h.refreshed.length,0);assert.equal(h.LT.Rooms.current(),null);
});

test('own Kasai room has no offline double and decoration remains available through its owner control',async()=>{
  const h=runtime();h.identity(KASAI);let battles=0;h.LT.KasaiChallenge={talk(){battles++;}};
  assert(await h.LT.Rooms.enterKasai(KASAI));assert.equal(h.LT.Admin.player.isAdmin,false);
  assert.match(h.messages.at(-1),/自分の専用ステージ/);assert.equal(h.engine.map.npcs.length,0);
  assert.equal(h.LT.Rooms.interact(),false);assert.equal(battles,0);assert.equal(h.LT.Rooms.hint(),null);
  assert(await h.LT.Rooms.open());h.click('edit');await settle();assert(h.action('place'));
  h.place('plant',20,10);assert(await h.LT.Rooms.decorateMine());h.click('save');await settle();
  assert.equal(h.store.get(KASAI).decorations.length,1,'Reopening the owner entry must preserve an unsaved draft');
  assert.equal(h.refreshed.at(-1).roomKindTag,'kasai');assert.equal(h.refreshed.at(-1).roomRevision,2);
});

test('visitors may enter the Kasai room freely but cannot launch a ghost NPC battle or decorate it',async()=>{
  const h=runtime();let battles=0;h.LT.KasaiChallenge={talk(){battles++;}};
  assert(await h.LT.Rooms.enterKasai(KASAI));assert.match(h.messages.at(-1),/カサイ本人/);assert.equal(h.engine.map.npcs.length,0);
  assert.equal(h.LT.Rooms.interact(),false);assert.equal(battles,0);
  assert(await h.LT.Rooms.open());assert.equal(h.action('edit'),undefined);assert.equal(h.action('edit-own'),undefined);
  assert.equal(await h.LT.Rooms.decorateMine(),false);assert.equal(h.action('place'),undefined);
  assert(!h.calls.some(call=>call.method==='PATCH'));
});

test('visiting the secondary administrator enters that exact room instead of the primary room',async()=>{
  const h=runtime(),secondary=makeRoom(PEER,'kasai');
  secondary.owner={id:PEER,name:'謎のトレーナー カサイ',isAdmin:true};
  secondary.name='サブ運営の部屋';h.store.set(PEER,secondary);
  assert(await h.LT.Rooms.enterKasai(PEER));
  assert.equal(h.engine.state.map,'room:'+PEER);
  assert.equal(h.LT.Rooms.current().owner.id,PEER);
  assert(h.calls.some(call=>call.path==='/world/rooms/'+PEER));
  assert(!h.calls.some(call=>call.path==='/world/rooms/kasai'));
  assert(await h.LT.Rooms.open());assert.equal(h.action('edit'),undefined);
  h.LT.Rooms.leave();h.store.set(PEER,makeRoom(PEER,'secret'));
  assert.equal(await h.LT.Rooms.enterKasai(PEER),false,'A revoked administrator no longer has a Kasai room');
  assert.equal(h.engine.state.map,'village');
});

test('authorized live staging uses the bridge, talks only through live eligibility and delegates exit',async()=>{
  const h=runtime();let canTalk=false,talks=0,leaves=0;const session={id:'live-test',roomId:KASAI,role:'challenger',state:'staging'};
  h.LT.KasaiLive={locked:()=>true,canTalk:()=>canTalk,hint:()=>canTalk?'カサイに話しかける':'60秒以内にカサイへ',talk(){talks++;},leave(){leaves++;return {ok:true};}};
  assert.equal((await h.LT.Rooms.enterLive(makeRoom(KASAI),session)).ok,true);assert.equal(h.liveStages.length,1);assert.equal(h.engine.state.map,'room:'+KASAI);assert.equal(h.engine.state.y,16);
  assert.equal(h.LT.Rooms.interact(),false);assert.equal(h.LT.Rooms.hint(),'60秒以内にカサイへ');
  canTalk=true;assert.equal(h.LT.Rooms.interact(),true);assert.equal(talks,1);assert.equal(h.LT.Rooms.hint(),'カサイに話しかける');
  assert.equal(await h.LT.Rooms.open(),false);assert.equal(await h.LT.Rooms.decorateMine(),false);assert.equal(await h.LT.Rooms.enter(PEER),false);
  assert.equal(h.LT.Rooms.leave().ok,true);assert.equal(leaves,1);
});

test('guests can explicitly review victory rewards after leaving, while Kasai sees no self reward action',async()=>{
  const h=runtime({own:true});let reviewed=0;h.LT.KasaiChallenge={async openRewards(){assert.equal(h.LT.Rooms.isDialogOpen(),false,'Room manager must close before the reward dialog opens');reviewed++;}};
  assert(await h.LT.Rooms.open());assert(h.action('reward'));assert.equal(reviewed,0);h.click('reward');await settle();assert.equal(reviewed,1);
  h.identity(KASAI);assert(await h.LT.Rooms.open());assert.equal(h.action('reward'),undefined,'Owner ID prevents the self reward action before its admin flag refresh');
  h.identity(SELF);h.LT.Admin.player.isAdmin=true;assert(await h.LT.Rooms.open());assert.equal(h.action('reward'),undefined);
});

test('automatic live arrival never closes or discards an unsaved decoration draft',async()=>{
  const h=runtime({own:true});await h.editOwn();h.place('plant',2,3);const draft=h.dialog().innerHTML;
  assert.equal((await h.LT.Rooms.enterLive(makeRoom(KASAI),{roomId:KASAI,role:'challenger'})).ok,false);assert.equal(h.liveStages.length,0);assert.equal(h.dialog().innerHTML,draft);assert.equal(h.LT.Rooms.isDialogOpen(),true);
  h.click('save');await settle();assert.equal(h.store.get(SELF).decorations.length,1);
});

test('ordinary and administrator rooms relocate as the same room with decorations and name intact',async()=>{
  for(const id of [SELF,KASAI]){
    const h=runtime({own:true});h.identity(id);h.LT.Admin.player.isAdmin=id===KASAI;const original=copy(h.store.get(id));original.decorations=[item('plant',2,3,0,'kept')];h.store.set(id,original);
    h.faceMoveWall();assert(await h.LT.Rooms.open());assert.equal(h.action('create'),undefined);assert.equal(h.action('relocate').disabled,false);h.click('relocate');assert.match(h.dialog().innerHTML,/移転先：はじまりの里/);
    assert(!h.calls.some(call=>call.path.endsWith('/relocate')),'Destination must be reviewed before changing the entrance');
    h.click('confirm-relocate');await settle();const room=h.store.get(id);assert.equal(h.presenceRefreshes,1);assert.equal(room.id,original.id);assert.equal(room.name,original.name);assert.equal(room.kind,original.kind);assert.deepEqual(room.decorations,original.decorations);assert.equal(room.revision,original.revision+1);assert.deepEqual(room.entrance,{map:'village',x:0,y:5,facing:'left',returnX:1,returnY:5});
    assert.equal(h.store.size,3);assert.equal(h.engine.state.map,'village');assert.equal(h.entered.length,0);assert.equal(h.action('relocate').disabled,true);
    assert(!h.calls.some(call=>call.path==='/world/rooms'&&call.method==='POST'),'Relocation must never create a second room');
  }
});

test('relocation refuses stale walls, absent presence and a live-session lock without losing the room',async()=>{
  for(const mode of ['wall-changed','presence-missing','live-locked']){
    const h=runtime({own:true});h.faceMoveWall();await h.LT.Rooms.open();h.click('relocate');const before=copy(h.store.get(SELF));
    if(mode==='wall-changed')h.faceWall();if(mode==='presence-missing')h.freshPresence=false;if(mode==='live-locked')h.LT.KasaiLive={locked:()=>true};
    h.click('confirm-relocate');await settle();assert.deepEqual(h.store.get(SELF),before);assert(!h.calls.some(call=>call.path.endsWith('/relocate')));assert.equal(h.LT.Rooms.isWorking(),false);
  }
});

test('a rejected relocation keeps the original entrance and an old response cannot replace another identity',async()=>{
  const h=runtime({own:true,handle:url=>url.endsWith('/relocate')?Promise.reject(Error('この壁には、ほかの部屋の入口があります。')):undefined});h.faceMoveWall();await h.LT.Rooms.open();h.click('relocate');const original=copy(h.store.get(SELF));h.click('confirm-relocate');await settle();
  assert.deepEqual(h.store.get(SELF),original);assert.match(h.dialog().querySelector('[data-room-message]').textContent,/ほかの部屋/);assert.equal(h.action('confirm-relocate').disabled,false);
  const pending=deferred(),changed=runtime({own:true,handle:url=>url.endsWith('/relocate')?pending.promise:undefined});changed.faceMoveWall();await changed.LT.Rooms.open();changed.click('relocate');changed.click('confirm-relocate');await settle();changed.identity(PEER);pending.resolve({room:{...makeRoom(),revision:2}});await settle();
  assert.equal(changed.LT.Rooms.isDialogOpen(),false);assert.equal(changed.LT.Rooms.isWorking(),false);assert.equal(changed.entered.length,0);assert.equal(changed.LT.Rooms.current(),null);
});

test('failed saves preserve the draft, and unsaved-change confirmation returns to the editor safely',async()=>{
  let failSave=true;const h=runtime({own:true,handle:(url,options)=>options.method==='PATCH'&&failSave?Promise.reject(Error('接続を確認してください。')):undefined});
  await h.editOwn();h.place('rug',2,3);h.input('room-edit-name','保存前の部屋');h.click('save');await settle();
  assert.equal(h.LT.Rooms.isWorking(),false);assert.equal(h.store.get(SELF).decorations.length,0);assert.equal(h.action('save').disabled,false);
  h.click('close');assert(h.action('resume'));h.dialog().emit('cancel');assert(h.action('place'),'Escape from confirmation discarded the draft');
  assert.equal(h.dialog().querySelector('#room-edit-name').value,'保存前の部屋');h.click('close');h.click('close');assert(h.action('place'),'Closing confirmation discarded the draft');
  failSave=false;h.click('save');await settle();assert.equal(h.store.get(SELF).decorations[0].itemId,'rug');assert.equal(h.store.get(SELF).name,'保存前の部屋');
});

test('an identity change clears the busy lock and ignores pending manager results',async()=>{
  const wait=deferred();let block=true;const h=runtime({handle:url=>url==='/world/rooms/mine'&&block?wait.promise:undefined});
  const opened=h.LT.Rooms.open();await settle();assert.equal(h.LT.Rooms.isWorking(),true);h.identity(PEER);
  assert.equal(h.LT.Rooms.isWorking(),false,'Identity change left the room client permanently busy');assert.equal(h.LT.Rooms.isDialogOpen(),false);
  block=false;assert(await h.LT.Rooms.open());wait.resolve({room:makeRoom(SELF)});await opened;await settle();
  assert(h.dialog().innerHTML.includes(PEER));assert.equal(h.LT.Rooms.isWorking(),false);
});

test('an old create response cannot teleport a new identity or replace its room state',async()=>{
  const wait=deferred();const h=runtime({handle:(url,options)=>url==='/world/rooms'&&options.method==='POST'?wait.promise:undefined});
  h.faceWall();assert(await h.LT.Rooms.open());h.click('create');await settle();h.identity(PEER);h.store.set(SELF,makeRoom(SELF));wait.resolve({room:makeRoom(SELF)});await settle();
  assert.equal(h.entered.length,0);assert.equal(h.LT.Rooms.current(),null);assert.equal(h.LT.Rooms.isWorking(),false);
});

test('pending visits and saves cannot reopen or mutate a replacement game',async()=>{
  const visit=deferred();const h=runtime({own:true,handle:(url,options)=>url==='/world/rooms/'+PEER&&!options.method?visit.promise:undefined});
  const pending=h.LT.Rooms.enter(PEER);await settle();h.replaceGame();visit.resolve({room:makeRoom(PEER)});assert.equal(await pending,false);assert.equal(h.entered.length,0);assert.equal(h.LT.Rooms.isWorking(),false);
  const save=deferred();const edited=runtime({own:true,handle:(url,options)=>options.method==='PATCH'?save.promise:undefined});
  await edited.editOwn();edited.place('plant',2,3);edited.click('save');await settle();edited.replaceGame();
  save.resolve({room:{...makeRoom(),decorations:[item('plant',2,3,0,'saved')],revision:2}});await settle();
  assert.equal(edited.refreshed.length,0);assert.equal(edited.LT.Rooms.isDialogOpen(),false);assert.equal(edited.LT.Rooms.isWorking(),false);
});

test('an old poll cannot roll a freshly saved room back to an earlier revision',async()=>{
  const poll=deferred();let delayPoll=false;const h=runtime({own:true,handle:(url,options)=>delayPoll&&url==='/world/rooms/'+SELF&&!options.method?poll.promise:undefined});
  await h.editOwn();delayPoll=true;await h.step(1200);h.place('plant',2,3);h.click('save');await settle();assert.equal(h.engine.map.roomRevision,2);
  poll.resolve({room:makeRoom()});await settle();assert.equal(h.engine.map.roomRevision,2,'A stale poll replaced the saved furniture revision');
  assert.equal(h.LT.Rooms.current().revision,2);
});

test('each operator can preview all three templates and save a complete furniture-preserving revision',async()=>{
  for(const role of ['primary','sub','sub-sub']){
    const h=runtime({others:false}),room=makeRoom(SELF,'kasai');room.owner.isAdmin=true;room.owner.adminRole=role;room.templateId='hall';
    room.decorations=[item('plant',2,3,0,'corner'),item('sofa',3,11,0,'wing'),item('bed',18,3,0,'bed')];h.store.set(SELF,room);h.LT.Admin.player.isAdmin=true;h.LT.Admin.player.adminRole=role;
    assert(await h.LT.Rooms.decorateMine());assert.equal(h.dialog().querySelectorAll('[data-room-template]').length,3);
    h.input('room-edit-name','三つの形を選ぶ部屋');
    for(const templateId of ['sanctum','wings']){
      h.click('template',{roomTemplate:templateId});await settle();
      assert.equal(h.action('template',{roomTemplate:templateId})['aria-pressed'],'true');
      assert.equal(h.dialog().querySelector('#room-edit-name').value,'三つの形を選ぶ部屋');
    }
    assert(!h.calls.some(call=>call.method==='PATCH'),'Template selection is a reversible local preview until Save');
    h.click('save');await settle();const saved=h.store.get(SELF),patch=h.calls.find(call=>call.method==='PATCH');
    assert.equal(patch.body.templateId,'wings');assert.equal(saved.templateId,'wings');assert.equal(saved.revision,2);
    assert.deepEqual(saved.decorations.map(entry=>entry.id),room.decorations.map(entry=>entry.id));assert.equal(saved.decorations.length,room.decorations.length);
    const target={...saved,...copy(h.LT.RoomArt.getLayout('kasai','wings'))};
    for(const entry of saved.decorations)assert.equal(placement(target,catalog,saved.decorations,entry),null);
    assert.deepEqual(saved.decorations.find(entry=>entry.id==='wing'),room.decorations.find(entry=>entry.id==='wing'),'Furniture already within the target shape must stay put');
    assert.equal(saved.name,'三つの形を選ぶ部屋');assert.equal(h.LT.Rooms.isWorking(),false);
  }
});

test('normal rooms have no template selector and visitors cannot edit an operator room',async()=>{
  const h=runtime({own:true});await h.editOwn();assert.equal(h.dialog().querySelectorAll('[data-room-template]').length,0);h.click('save');await settle();
  assert(!Object.hasOwn(h.calls.find(call=>call.method==='PATCH').body,'templateId'));
  h.LT.Rooms.closeDialog();h.LT.Rooms.leave();assert(await h.LT.Rooms.enter(KASAI));assert(await h.LT.Rooms.open());
  assert.equal(h.action('edit'),undefined);assert.equal(h.dialog().querySelectorAll('[data-room-template]').length,0);
});

test('unsaved template changes can be resumed or discarded without changing the saved shape',async()=>{
  const h=runtime({others:false}),room=makeRoom(SELF,'kasai');room.templateId='hall';h.store.set(SELF,room);h.LT.Admin.player.isAdmin=true;
  assert(await h.LT.Rooms.decorateMine());h.click('template',{roomTemplate:'sanctum'});h.click('close');assert(h.action('resume'));
  h.click('resume');assert.equal(h.action('template',{roomTemplate:'sanctum'})['aria-pressed'],'true');
  h.click('close');h.click('discard');assert.equal(h.LT.Rooms.isDialogOpen(),false);assert.equal(h.store.get(SELF).templateId,'hall');
  assert(await h.LT.Rooms.decorateMine());assert.equal(h.action('template',{roomTemplate:'hall'})['aria-pressed'],'true');
  assert(!h.calls.some(call=>call.method==='PATCH'));
});

test('template furniture migration is deterministic, keeps IDs and rotations, and refuses a room that cannot fit everything',()=>{
  const art=contractContext.LT.RoomArt,target=copy(art.getLayout('kasai','wings')),source=copy(art.getLayout('kasai','hall'));
  const pieces=[item('plant',1,2,0,'plant'),item('table',20,2,90,'table'),item('sofa',2,9,90,'kept')],before=copy(pieces);
  const a=rearrangeDecorations(target,catalog,pieces),b=rearrangeDecorations(target,catalog,pieces);
  assert.equal(a.ok,true);assert.deepEqual(a,b);assert.deepEqual(pieces,before,'Preview must not mutate the saved room');
  assert.deepEqual(a.decorations.map(({id,itemId,rotation})=>({id,itemId,rotation})),pieces.map(({id,itemId,rotation})=>({id,itemId,rotation})));
  assert.deepEqual(a.decorations[2],pieces[2]);for(const entry of a.decorations)assert.equal(placement(target,catalog,a.decorations,entry),null);
  const crowded=[];
  for(let y=2;y<source.height-2&&crowded.length<32;y++)for(let x=1;x<source.width-1&&crowded.length<32;x++){
    const entry=item('bed',x,y,0,'bed'+crowded.length);if(placement(source,catalog,crowded,entry)===null)crowded.push(entry);
  }
  assert.equal(crowded.length,32);const preserved=copy(crowded),failure=rearrangeDecorations(target,catalog,crowded);
  assert.equal(failure.ok,false);assert.match(failure.message,/すべての家具/);assert.deepEqual(crowded,preserved);assert(!failure.decorations);
});

test('creation forms send the matching main, deputy and third operator room names',async()=>{
  for(const [role,name] of [['main','カサイ'],['sub','サカイ'],['sub-sub','イサカ']]){
    const h=runtime({others:false});h.identity(KASAI);Object.assign(h.LT.Admin.player,{isAdmin:true,adminRole:role});h.faceWall();
    assert.equal(h.LT.Rooms.interact(),true);await settle();
    assert.equal(h.dialog().querySelector('#room-new-name').value,`${name}のひみつ部屋`);
    assert(h.dialog().innerHTML.includes(`専用の対戦ステージがある、${name}の部屋`));
    h.click('create');await settle();const sent=h.calls.find(call=>call.path==='/world/rooms'&&call.method==='POST');
    assert.equal(sent.body.name,`${name}のひみつ部屋`);
  }
});

test('the featured operator room uses its actual owner when a deputy room is returned first',async()=>{
  for(const [role,name] of [['sub','サカイ'],['sub-sub','イサカ']]){
    const h=runtime({others:false}),room=makeRoom(KASAI);room.owner={...room.owner,name,adminRole:role};room.name=`${name}のひみつ部屋`;h.store.set(KASAI,room);
    assert(await h.LT.Rooms.open());assert(h.dialog().innerHTML.includes(`<h3>${name}の間</h3>`));
    assert(!h.dialog().innerHTML.includes('カサイの間'));assert(!h.dialog().innerHTML.includes('謎のトレーナー カサイ'));
    h.click('visit',{roomOwner:KASAI});await settle();assert.equal(h.engine.map.name,room.name);assert.equal(h.engine.map.owner.adminRole,role);
    assert(h.messages.some(message=>message.startsWith(`${name}の部屋へ。`)));
  }
});

test('a same-revision server name correction and role update refresh an already visited room',async()=>{
  const h=runtime();assert(await h.LT.Rooms.enter(KASAI));const previous=copy(h.store.get(KASAI)),revision=previous.revision;
  const corrected={...previous,name:'サカイのひみつ部屋',owner:{...previous.owner,name:'サカイ',adminRole:'sub'}};h.store.set(KASAI,corrected);
  await h.step(1200);assert.equal(h.engine.map.roomRevision,revision);assert.equal(h.engine.map.name,corrected.name);assert.equal(h.engine.map.owner.adminRole,'sub');
  assert.match(h.engine.map.subtitle,/サカイ本人/);assert.equal(h.refreshed.length,1);
  const promoted={...corrected,owner:{...corrected.owner,name:'イサカ',adminRole:'sub-sub'}};h.store.set(KASAI,promoted);
  await h.step(5000);assert.equal(h.engine.map.name,corrected.name,'An explicit room name must survive a role-only refresh');assert.equal(h.engine.map.owner.adminRole,'sub-sub');assert.match(h.engine.map.subtitle,/イサカ本人/);
});
