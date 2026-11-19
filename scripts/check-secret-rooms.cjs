#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),test=require('node:test');
const {pathToFileURL}=require('node:url');
const {placement,footprint}=require('../secret-rooms.js');
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
  if(own)store.set(SELF,makeRoom());if(others){store.set(PEER,makeRoom(PEER));store.set(KASAI,makeRoom(KASAI));}
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
  const outdoor={id:'village',name:'はじまりの里',width:12,height:10,tiles:Array.from({length:10},(_,y)=>Array.from({length:12},(_,x)=>x===0||y===0||x===11||y===9||x===4&&y===2?'#':'_').join('')),npcs:[],exits:[],level:[1,4]};
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
  };
  LT.Admin.worldRequest=async(url,options={})=>{
    calls.push({path:url,...copy(options)});const supplied=handle?.(url,options,h);if(supplied!==undefined)return supplied;
    if(url==='/world/rooms/catalog')return {catalog:copy(catalog),layouts:copy(layouts)};
    if(url==='/world/rooms/mine')return {room:copy(store.get(LT.Admin.player.id)||null)};
    if(url==='/world/rooms/kasai')return {room:copy(store.get(KASAI)||null)};
    if(url.startsWith('/world/rooms?map='))return {rooms:copy([...store.values()].filter(room=>room.entrance.map===decodeURIComponent(url.split('=')[1])))};
    if(url==='/world/rooms'&&options.method==='POST') {
      const room=makeRoom(LT.Admin.player.id),b=options.body;room.name=b.name;room.entrance={map:b.map,x:b.x,y:b.y,facing:b.facing,returnX:h.engine.state.x,returnY:h.engine.state.y};store.set(room.id,room);return {room:copy(room)};
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
  h.place('plant',20,10);h.place('lamp',11,10);assert.match(h.dialog().querySelector('[data-room-message]').textContent,/入口・通路・カサイのステージ/);
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
