#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {WorldPresence,populationData}=require('../field-world.js');
const SOURCE=fs.readFileSync(require.resolve('../field-world.js'),'utf8');
const SELF='P0000000000000001',PEER='P0000000000000002',OTHER='P0000000000000003';
const copy=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function actor(overrides={}){return {id:PEER,name:'旅人',isAdmin:false,avatar:'male',map:'village',x:2,y:1,facing:'left',status:'idle',updatedAt:1000,...overrides};}
function packet(players=[],overrides={}){return {self:actor({id:SELF,x:1,facing:'right'}),players,serverTime:1000,ttlMs:15000,...overrides};}

test('presence displays only valid other players from the current map and replaces an authoritative snapshot',()=>{
 let now=10;const p=new WorldPresence({clock:()=>now});
 p.ingest(packet([actor(),actor({id:SELF}),actor({id:OTHER,map:'forest'}),actor({id:'forged'}),actor({id:'P0000000000000004',x:NaN}),actor({id:'P0000000000000005',facing:'diagonal'})]),'village');
 assert.deepEqual(p.actors('village').map(person=>person.id),[PEER]);assert.deepEqual(p.actors('forest'),[]);
 now=200;p.ingest(packet([],{serverTime:1200}),'village');assert.deepEqual(p.actors('village'),[]);
 assert.throws(()=>p.ingest({players:[],serverTime:1200},'village'));
 assert.throws(()=>p.ingest(packet([],{serverTime:NaN}),'village'));
});

test('presence freshness follows server age plus elapsed client time, regardless of wall-clock offset',()=>{
 let now=800000000;const p=new WorldPresence({clock:()=>now}),serverTime=2000000000000;
 p.ingest(packet([actor({updatedAt:serverTime-14500}),actor({id:OTHER,updatedAt:serverTime-15001}),actor({id:'P0000000000000004',updatedAt:serverTime+2001})],{serverTime}),'village');
 assert.deepEqual(p.actors('village').map(person=>person.id),[PEER]);now+=500;assert.equal(p.actors('village').length,1);now++;assert.equal(p.actors('village').length,0);
 p.ingest(packet([actor({updatedAt:serverTime})],{serverTime}),'village');now+=15001;assert.equal(p.actors('village').length,0);
});

test('fresh heartbeat advances age without restarting an in-progress walk and old snapshots cannot rewind it',()=>{
 let now=0;const p=new WorldPresence({clock:()=>now});p.ingest(packet([actor({x:0})]),'village');
 now=500;p.ingest(packet([actor({x:4,updatedAt:1500})],{serverTime:1500}),'village');
 assert.equal(p.actors('village')[0].x,0);now=750;assert.equal(p.actors('village')[0].x,2);assert.equal(p.actors('village')[0].moving,true);
 p.ingest(packet([actor({x:4,name:'改名',facing:'up',status:'busy',updatedAt:1750})],{serverTime:1750}),'village');
 assert.equal(p.actors('village')[0].x,2);now=1000;assert.equal(p.actors('village')[0].x,4);assert.equal(p.actors('village')[0].moving,false);assert.equal(p.actors('village')[0].name,'改名');
 p.ingest(packet([actor({x:1,updatedAt:1400})],{serverTime:2000}),'village');assert.equal(p.actors('village')[0].x,4);assert.equal(p.actors('village')[0].updatedAt,1750);
});

test('large jumps and map or identity changes snap to the new scene without drawing a long walking trail',()=>{
 let now=0;const p=new WorldPresence({clock:()=>now});p.ingest(packet([actor({x:0,y:0})]),'village');
 now=500;p.ingest(packet([actor({x:20,y:20,updatedAt:1500})],{serverTime:1500}),'village');
 let person=p.actors('village')[0];assert.equal(person.x,20);assert.equal(person.y,20);assert.equal(person.moving,false);
 now=1000;p.ingest(packet([actor({map:'forest',x:1,y:1,updatedAt:2000})],{serverTime:2000}),'forest');assert.deepEqual(p.actors('village'),[]);assert.equal(p.actors('forest')[0].x,1);
 now=1500;p.ingest(packet([actor({map:'forest',x:3,y:1,updatedAt:2500})],{self:actor({id:OTHER}),serverTime:2500}),'forest');assert.equal(p.actors('forest')[0].x,3);assert.equal(p.actors('forest')[0].moving,false);
});

test('presence caps rendering at eighty actors and nearby eligibility uses server target tiles',()=>{
 let now=0;const p=new WorldPresence({clock:()=>now});
 const rows=Array.from({length:100},(_,i)=>actor({id:'P'+(i+10).toString(16).padStart(16,'0')}));p.ingest(packet(rows),'village');assert.equal(p.actors('village').length,80);
 p.clear();p.ingest(packet([actor({x:2,y:0})]),'village');now=500;p.ingest(packet([actor({x:7,y:0,updatedAt:1500})],{serverTime:1500}),'village');
 assert.equal(p.actors('village')[0].x,2);assert.equal(p.nearby({map:'village',x:0,y:0,facing:'right'},3).length,0,'A visually trailing actor already out of range cannot be invited');
 now=1000;p.ingest(packet([actor({x:1,y:0,updatedAt:2000})],{serverTime:2000}),'village');
 assert.equal(p.actors('village')[0].x,7);assert.equal(p.nearby({map:'village',x:0,y:0,facing:'right'},2).length,1,'A freshly arrived actor uses its server tile for invitation range');
});

test('authoritative roles select distinct admin appearances and sub names without trusting avatar text',()=>{
 const p=new WorldPresence({clock:()=>0});
 p.ingest(packet([
  actor({isAdmin:true,adminRole:'main',name:'登録名',avatar:'female'}),
  actor({id:OTHER,isAdmin:true,adminRole:'sub',name:'紫の旅人',avatar:'kasai'}),
  actor({id:'P0000000000000004',isAdmin:false,adminRole:'sub',avatar:'sub-admin'}),
  actor({id:'P0000000000000005',isAdmin:true,adminRole:'invalid',avatar:'female'}),
  actor({id:'P0000000000000006',isAdmin:true,avatar:'kasai'}),
  actor({id:'P0000000000000007',isAdmin:true,adminRole:'sub-sub',name:'金の旅人',avatar:'sub-admin'}),
  actor({id:'P0000000000000008',isAdmin:false,adminRole:'sub-sub',avatar:'sub-sub-admin'})
 ]),'village');
 const [main,sub,ordinary,invalid,legacy,third,forgedThird]=p.actors('village');
 assert.equal(main.avatar,'kasai');assert.equal(main.name,'謎のトレーナー カサイ');assert.equal(main.adminRole,'main');
 assert.equal(sub.avatar,'sub-admin');assert.equal(sub.name,'サカイ');assert.equal(sub.adminRole,'sub');assert.equal(sub.isAdmin,true);
 assert.equal(ordinary.avatar,'male');assert.equal(ordinary.adminRole,null);assert.equal(ordinary.isAdmin,false);
 assert.equal(invalid.avatar,'female');assert.equal(invalid.adminRole,null);assert.equal(invalid.isAdmin,false);
 assert.equal(legacy.avatar,'kasai');assert.equal(legacy.adminRole,'main');
 assert.equal(third.avatar,'sub-sub-admin');assert.equal(third.name,'イサカ');assert.equal(third.adminRole,'sub-sub');assert.equal(third.isAdmin,true);
 assert.equal(forgedThird.avatar,'male');assert.equal(forgedThird.adminRole,null);assert.equal(forgedThird.isAdmin,false);
});

test('stationary snapshots refresh role, name and avatar together and stale snapshots cannot restore a revoked role',()=>{
 let now=0;const p=new WorldPresence({clock:()=>now});p.ingest(packet([actor()]),'village');
 const receive=(patch,time)=>{now+=100;p.ingest(packet([actor({...patch,updatedAt:time})],{serverTime:time}),'village');return p.actors('village')[0];};
 let peer=receive({isAdmin:true,adminRole:'sub',avatar:'sub-admin',name:'紫の旅人'},1100);
 assert.equal(peer.adminRole,'sub');assert.equal(peer.avatar,'sub-admin');assert.equal(peer.name,'サカイ');assert.equal(peer.moving,false);
 peer=receive({isAdmin:true,adminRole:'sub-sub',avatar:'sub-sub-admin',name:'金の旅人'},1150);
 assert.equal(peer.adminRole,'sub-sub');assert.equal(peer.avatar,'sub-sub-admin');assert.equal(peer.name,'イサカ');assert.equal(peer.moving,false);
 peer=receive({isAdmin:true,adminRole:'main',avatar:'kasai',name:'紫の旅人'},1200);
 assert.equal(peer.adminRole,'main');assert.equal(peer.avatar,'kasai');assert.equal(peer.name,'謎のトレーナー カサイ');
 peer=receive({isAdmin:false,adminRole:null,avatar:'female',name:'紫の旅人'},1300);
 assert.equal(peer.isAdmin,false);assert.equal(peer.adminRole,null);assert.equal(peer.avatar,'female');assert.equal(peer.name,'紫の旅人');
 now+=100;p.ingest(packet([actor({isAdmin:true,adminRole:'sub-sub',avatar:'sub-sub-admin',updatedAt:1250})],{serverTime:1400}),'village');
 assert.equal(p.actors('village')[0].isAdmin,false);assert.equal(p.actors('village')[0].avatar,'female');
});

test('population accepts only exact positive server aggregates with unique valid stage IDs',()=>{
 const packet={rows:[{map:'village',count:91},{map:'room:'+PEER,count:3,name:'星の私室',kind:'secret'}],total:94,serverTime:1000,ttlMs:15000};
 assert.equal(populationData(packet).total,94);assert.equal(populationData(packet).rows[0].count,91,'Population must not inherit the nearby rendering cap');
 for(const patch of [{total:95},{rows:[...packet.rows,packet.rows[0]],total:185},{rows:[{map:'village',count:-1}],total:0},{rows:[{map:'village',count:1.5}],total:1.5},{rows:[{map:'room:forged',count:1}],total:1},{rows:[{map:'village',count:0}],total:0},{serverTime:NaN}])assert.throws(()=>populationData({...packet,...patch}));
 assert.deepEqual(populationData({rows:[],total:0,serverTime:1000}).rows,[],'No online users is a valid server result');
});

// Runtime tests use the real client, a small DOM and controlled promises. They
// never contact the service or create invitations for real player identities.
function runtime({handle,stored=[],realAdmin=false}={}){
 let now=100000,nextTimer=0,requestId=0;const timers=new Map(),memory=new Map(stored),calls=[],messages=[],notices=[],opens=[],portraits=[],events={},globalEvents={};
 const state={started:true,map:'village',x:1,y:1,facing:'right',avatar:'female'},engine={state,battle:null};
 const doc={hidden:false,nodes:[],addEventListener(name,fn){(events[name]||=[]).push(fn);},dispatchEvent(event){for(const fn of events[event.type]||[])fn(event);return true;},body:{append(node){doc.nodes.push(node);}},querySelector(selector){if(selector==='.game-stage')return stage;if(selector==='dialog[open]')return doc.nodes.find(node=>node.tag==='dialog'&&node.open)||null;return null;}};
 class Element{
  constructor(tag,attrs=''){this.tag=tag;this.dataset={};this.children=[];this.listeners={};this.open=false;this.disabled=/\sdisabled(?:\s|$)/.test(attrs);this.hidden=false;this.textContent='';this.id='';this.value='';this.parent=null;
   for(const m of attrs.matchAll(/([\w-]+)="([^"]*)"/g)){const [,key,value]=m;if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;else this[key==='class'?'className':key]=value;}
   for(const m of attrs.matchAll(/\b(data-[\w-]+)(?=\s|$)/g))this.dataset[m[1].slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]??='';
  }
  append(node){this.children.push(node);node.parent=this;}
  before(node){assert(this.parent,'Missing parent for outside-canvas control bar');const siblings=this.parent.children;siblings.splice(siblings.indexOf(this),0,node);node.parent=this.parent;}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,fn){(this.listeners[name]||=[]).push(fn);}
  emit(name,event={}){for(const fn of this.listeners[name]||[])fn(event);}
  showModal(){this.open=true;}
  close(){this.open=false;this.emit('close');}
  matches(selector){if(selector==='button')return this.tag==='button';if(selector==='canvas[data-traveller]')return this.tag==='canvas'&&this.dataset.traveller!==undefined;if(selector.startsWith('#'))return this.id===selector.slice(1);const attr=selector.match(/^\[(data-[\w-]+)\]$/);return !!attr&&Object.hasOwn(this.dataset,attr[1].slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()));}
  closest(selector){return this.matches(selector)?this:null;}
  querySelectorAll(selector){return this.children.filter(node=>node.matches(selector));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  set innerHTML(html){this.html=html;this.children=[];for(const match of html.matchAll(/<(button|section|div|span|canvas|p|h2|input|label|ul|li|strong|small)\b([^>]*)>/g))this.children.push(new Element(match[1],match[2]));}
  get innerHTML(){return this.html||'';}
 }
 doc.createElement=tag=>new Element(tag);const stage=new Element('div'),screen=new Element('div');screen.append(stage);
 const trade={active:false,connected:false,state:null,cancels:0,failCleanup:false};
 const context=vm.createContext({console,Date:class extends Date{static now(){return now;}},document:doc,navigator:{onLine:true},crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++requestId).padStart(12,'0')}`},
  localStorage:{getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)},
  setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{at:now+Math.max(0,Number(delay)||0),fn});return id;},clearTimeout:id=>timers.delete(id),
  addEventListener(name,fn){(globalEvents[name]||=[]).push(fn);},
  LT:{DATA:{maps:{village:{name:'風待ちの里'},forest:{name:'深緑の森'}}},Admin:{player:{id:SELF,name:'自分',isAdmin:false},worldRequest:async(path,options={})=>{
   calls.push({path,...copy(options),at:now});const supplied=handle?handle(path,options,h):undefined;if(supplied!==undefined)return supplied;
   if(path==='/world/presence'&&options.method==='POST')return h.snapshot(options.body.map);
   if(path==='/world/population')return h.populationPacket();
   if(path==='/world/invitations')return {invitation:{id:'offer-'+requestId,state:'pending',expiresAt:now+60000,roomCode:options.body.roomCode}};
   return {ok:true};
  }},adminBridge:{getEngine:()=>engine,isPlaying:()=>h.playing,isBusy:()=>false,refresh(){h.refreshes++;},toast:message=>messages.push(message)},Art:{traveller(canvas,options){portraits.push(copy(options));}},
  Trade:{isLocked:()=>trade.active,worldState:()=>({...trade}),setWorldNotice:message=>notices.push(message),async cancelWorldWait(){trade.cancels++;if(trade.failCleanup)return false;trade.active=false;trade.state='cancelled';context.LT.tradeActive=false;doc.dispatchEvent({type:'pachi-trade-state'});return true;},async open(options){
   opens.push(options);trade.active=true;trade.connected=false;trade.state='open';context.LT.tradeActive=true;
   try{if(options.autoHost)await options.onRoomReady('ABC234');return true;}catch(_){return false;}
  }}
 }});
 const h={context,doc,stage,screen,state,engine,trade,calls,messages,notices,opens,portraits,playing:true,refreshes:0,serverOffset:0,selfProfile:null,players:[actor()],invitations:[],populationRows:[{map:'village',count:2}],
  populationPacket(){return {rows:copy(this.populationRows),total:this.populationRows.reduce((sum,row)=>sum+row.count,0),serverTime:now+this.serverOffset,ttlMs:15000};},
  bar(){return screen.children.find(node=>node.className==='world-network-bar');},
  populationSummary(){return this.dialog()?.querySelector('[data-world-population-summary]')?.textContent;},
  populationList(){return this.dialog()?.querySelector('[data-world-population-list]')?.innerHTML;},
  searchPopulation(value){const input=this.dialog().querySelector('#world-population-search');input.value=value;input.emit('input',{target:input});},
  snapshot(map=state.map){return packet(this.players.map(person=>({...person,map:person.map,updatedAt:now+this.serverOffset})),{self:actor({id:SELF,...(this.selfProfile||context.LT.Admin.player),map,x:state.x,y:state.y}),serverTime:now+this.serverOffset,invitations:copy(this.invitations)});},
  async step(ms=0){now+=ms;for(let i=0;i<100;i++){const due=[...timers.entries()].filter(([,timer])=>timer.at<=now).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;timers.delete(due[0]);due[1].fn();await settle();if(i===99)assert.fail('Runtime timer loop did not settle');}await settle();},
  event(type,values={}){doc.dispatchEvent({type,...values});},globalEvent(type,values={}){for(const fn of globalEvents[type]||[])fn({type,...values});},
  dialog(){return doc.nodes.find(node=>node.id==='world-player-dialog');},
  click(action){const dialog=this.dialog(),button=dialog?.children.find(node=>node.dataset.worldAction===action);assert(button,'Missing world action '+action);dialog.emit('click',{target:button});},
  async approachTrade(){assert(context.LT.World.interact(),'Nearby player should be interactable');this.click('trade');await this.step(300);},now:()=>now
 };
 if(realAdmin){
  // Exercise the real authentication/profile adapter as well as field-world:
  // replacing this adapter with a mock used to conceal stale role propagation.
  Object.assign(context,{AbortController,URL,Blob,btoa,crypto:require('node:crypto').webcrypto,
   CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},
   MutationObserver:class{observe(){}},setInterval:()=>0});
  context.window=context;doc.getElementById=()=>null;
  context.localStorage.removeItem=key=>memory.delete(key);
  context.fetch=async(url,options)=>{
   const path=new URL(url).pathname.replace('/api',''),request={method:options.method,...(options.body?{body:JSON.parse(options.body)}:{})};
   calls.push({path,...copy(request),at:now});
   const supplied=handle?handle(path,request,h):undefined;
   const data=supplied!==undefined?await supplied:path==='/world/presence'?h.snapshot(request.body.map):path==='/me'?{player:h.meProfile||copy(context.LT.Admin.player),adminExists:true,grants:[],nextCursor:null}:path==='/status'?{adminExists:true}:{};
   return {ok:true,status:200,json:async()=>({ok:true,...data})};
  };
  const adminSource=fs.readFileSync(require.resolve('../admin-console.js'),'utf8').replace('mountSettings();void sync();','globalThis.__adoptAdmin=adoptIdentity;');
  vm.runInContext(adminSource,context,{filename:'admin-console.js'});
  h.adopt=profile=>context.__adoptAdmin({id:profile.id,token:'A'.repeat(43),name:profile.name},profile,true);
  h.adopt({id:SELF,name:'自分',isAdmin:false,adminRole:null});
 }
 vm.runInContext(SOURCE,context);return h;
}

test('runtime heartbeat publishes canonical position, retains offline solo play and clears leaving actors',async()=>{
 const h=runtime();h.serverOffset=800000;await h.step(800);
 const post=h.calls.find(call=>call.method==='POST');assert.deepEqual(post.body,{map:'village',x:1,y:1,facing:'right',avatar:'female',status:'idle'});
 assert.equal(h.context.LT.World.status().connected,true);assert.equal(h.context.LT.World.actors('village').length,1);
 h.context.navigator.onLine=false;h.globalEvent('offline');await settle();assert.equal(h.context.LT.World.actors('village').length,0);assert.equal(h.state.started,true);assert.equal(h.state.map,'village');
 assert(h.calls.some(call=>call.method==='DELETE'));await h.step(1500);assert.equal(h.calls.filter(call=>call.method==='POST').length,1);
});

test('both local deputies use fixed operator names without changing saved avatars or registered names',async()=>{
 for(const [role,avatar,name,displayName] of [['sub','sub-admin','紫の旅人','サカイ'],['sub-sub','sub-sub-admin','金の旅人','イサカ']]){
 const h=runtime();h.context.LT.Admin.player={id:SELF,name,isAdmin:true,adminRole:role};
 assert.equal(h.context.LT.World.localKind('female'),avatar);assert.equal(h.context.LT.World.displayName(),displayName);
 await h.step(800);assert.equal(h.context.LT.World.localKind('female'),avatar);assert.equal(h.context.LT.World.status().displayName,displayName);assert.equal(h.context.LT.Admin.player.name,name);
 assert.equal(h.state.avatar,'female');const post=h.calls.find(call=>call.path==='/world/presence'&&call.method==='POST');assert.equal(post.body.avatar,'female');assert(!Object.hasOwn(post.body,'isAdmin'));assert(!Object.hasOwn(post.body,'adminRole'));
 h.context.LT.Admin.player={id:SELF,name:'登録名',isAdmin:true};assert.equal(h.context.LT.World.localKind('female'),'kasai');assert.equal(h.context.LT.World.displayName(),'謎のトレーナー カサイ');
 }
});

test('new authoritative heartbeat roles override a cached profile and revocation restores the saved ordinary appearance',async()=>{
 const h=runtime();h.context.LT.Admin.player={id:SELF,name:'紫の旅人',isAdmin:true,adminRole:'sub'};await h.step(800);
 assert.equal(h.context.LT.World.localKind('female'),'sub-admin');
 h.selfProfile={id:SELF,name:'紫の旅人',isAdmin:false,adminRole:null,avatar:'female'};await h.step(500);
 assert.equal(h.context.LT.World.localKind('female'),'hero-female');assert.equal(h.context.LT.World.localKind('male'),'hero');assert.equal(h.context.LT.World.displayName(),null);
 const refreshed=h.refreshes;h.selfProfile={id:SELF,name:'紫の旅人',isAdmin:true,adminRole:'sub',avatar:'sub-admin'};await h.step(500);
 assert.equal(h.context.LT.World.localKind('female'),'sub-admin');assert.equal(h.context.LT.World.displayName(),'サカイ');assert(h.refreshes>refreshed);
 h.selfProfile={id:SELF,name:'金の旅人',isAdmin:true,adminRole:'sub-sub',avatar:'sub-sub-admin'};await h.step(500);
 assert.equal(h.context.LT.World.localKind('female'),'sub-sub-admin');assert.equal(h.context.LT.World.displayName(),'イサカ');
 h.selfProfile={id:SELF,name:'紫の旅人',isAdmin:true,adminRole:'main',avatar:'kasai'};await h.step(500);
 assert.equal(h.context.LT.World.localKind('female'),'kasai');assert.equal(h.context.LT.World.displayName(),'謎のトレーナー カサイ');
});

test('a fresh profile revocation is not undone by an older in-flight admin presence response',async()=>{
 const pending=deferred();const h=runtime({handle:(path,options)=>path==='/world/presence'&&options.method==='POST'?pending.promise:undefined});
 h.context.LT.Admin.player={id:SELF,name:'金の旅人',isAdmin:true,adminRole:'sub-sub'};await h.step(800);const old=h.snapshot();
 h.context.LT.Admin.player={id:SELF,name:'紫の旅人',isAdmin:false,adminRole:null};
 assert.equal(h.context.LT.World.localKind('female'),'hero-female');pending.resolve(old);await settle();
 assert.equal(h.context.LT.World.localKind('female'),'hero-female');assert.equal(h.context.LT.World.displayName(),null);
 h.context.LT.Admin.player={id:SELF,name:'新しい名前',isAdmin:true,adminRole:'sub'};
 assert.equal(h.context.LT.World.localKind('female'),'sub-admin');assert.equal(h.context.LT.World.displayName(),'サカイ');
});

test('real admin adapter applies deputy appointments, promotion and revocation on the next heartbeat',async()=>{
 const h=runtime({realAdmin:true});await h.step(800);
 for(const [role,kind] of [['sub','sub-admin'],['sub-sub','sub-sub-admin'],['main','kasai'],[null,'hero-female']]){
  h.selfProfile={id:SELF,name:'自分',isAdmin:role!==null,adminRole:role,avatar:kind};
  await h.step(500);
  assert.equal(h.context.LT.Admin.player.adminRole,role);
  assert.equal(h.context.LT.Admin.player.isAdmin,role!==null);
  assert.equal(h.context.LT.World.localKind('female'),kind);
  assert.equal(h.context.LT.World.displayName(),role==='main'?'謎のトレーナー カサイ':role==='sub'?'サカイ':role==='sub-sub'?'イサカ':null);
 }
 assert.equal(h.state.avatar,'female');assert(!h.calls.some(call=>call.path==='/me'),'Role updates must not wait for the periodic profile read');
});

test('real admin adapter cannot overwrite a newer profile with a delayed presence role',async()=>{
 const old=deferred();let hold=false;
 const h=runtime({realAdmin:true,handle:(path,options)=>hold&&path==='/world/presence'&&options.method==='POST'?old.promise:undefined});
 h.adopt({id:SELF,name:'自分',isAdmin:true,adminRole:'sub-sub'});await h.step(800);
 const snapshot=h.snapshot();hold=true;await h.step(500);
 h.meProfile={id:SELF,name:'自分',isAdmin:false,adminRole:null};
 await h.context.LT.Admin.tradeIdentity({fresh:true});
 old.resolve(snapshot);await settle();
 assert.equal(h.context.LT.Admin.player.isAdmin,false);assert.equal(h.context.LT.Admin.player.adminRole,null);
 assert.equal(h.context.LT.World.localKind('female'),'hero-female');assert.equal(h.context.LT.World.displayName(),null);
});

test('a delayed profile read cannot undo a revocation received by the next heartbeat',async()=>{
 const old=deferred();let holding=false;
 const h=runtime({realAdmin:true,handle:(path)=>holding&&path==='/me'?old.promise:undefined});
 h.adopt({id:SELF,name:'登録名',isAdmin:true,adminRole:'sub-sub'});await h.step(800);
 holding=true;const refresh=h.context.LT.Admin.tradeIdentity({fresh:true});await settle();
 h.selfProfile={id:SELF,name:'登録名',isAdmin:false,adminRole:null,avatar:'female'};await h.step(500);
 old.resolve({ok:true,player:{id:SELF,name:'登録名',isAdmin:true,adminRole:'sub-sub'},adminExists:true});await refresh;
 assert.equal(h.context.LT.Admin.player.isAdmin,false);assert.equal(h.context.LT.Admin.player.adminRole,null);
 assert.equal(h.context.LT.World.localKind('female'),'hero-female');assert.equal(h.context.LT.World.displayName(),null);
});

test('a previous identity presence response and stored role claims cannot give the current player an admin appearance',async()=>{
 const pending=deferred(),stored=[['pachi-player-identity-v1',JSON.stringify({id:SELF,isAdmin:true,adminRole:'sub-sub',avatar:'sub-sub-admin'})]];
 const h=runtime({stored,handle:(path,options)=>path==='/world/presence'&&options.method==='POST'?pending.promise:undefined});
 assert.equal(h.context.LT.World.localKind('sub-admin'),'hero');assert.equal(h.context.LT.World.localKind('sub-sub-admin'),'hero');assert.equal(h.context.LT.World.displayName(),null);
 h.context.LT.Admin.player={id:SELF,name:'紫の旅人',isAdmin:true,adminRole:'sub'};await h.step(800);const old=h.snapshot();
 h.context.LT.Admin.player={id:OTHER,name:'別の人',isAdmin:false,adminRole:null};pending.resolve(old);await settle();
 assert.equal(h.context.LT.World.localKind('female'),'hero-female');assert.equal(h.context.LT.World.displayName(),null);assert.deepEqual(copy(h.context.LT.World.actors('village')),[]);
 for(const profile of [{isAdmin:false,adminRole:'sub',avatar:'sub-admin'},{isAdmin:false,adminRole:'sub-sub',avatar:'sub-sub-admin'},{isAdmin:'true',adminRole:'sub',avatar:'sub-admin'},{isAdmin:true,adminRole:null,avatar:'kasai'},{isAdmin:true,adminRole:'invalid',avatar:'sub-admin'}]){
  h.context.LT.Admin.player={id:OTHER,name:'別の人',...profile};assert.equal(h.context.LT.World.localKind('female'),'hero-female');assert.equal(h.context.LT.World.displayName(),null);
 }
});

test('both deputy encounter portraits and live challenge labels use their fixed operator names',async()=>{
 for(const [role,avatar,label,displayName] of [['sub','sub-admin','SUB ADMIN','サカイ'],['sub-sub','sub-sub-admin','SUB SUB ADMIN','イサカ']]){
 const h=runtime(),requests=[];h.players=[actor({name:'旅人 <月>',isAdmin:true,adminRole:role,avatar})];
 h.context.LT.KasaiLive={request:async id=>{requests.push(id);return {ok:true};},locked:()=>false,isWorking:()=>false};
 await h.step(800);assert(h.context.LT.World.interact());assert.equal(h.portraits.at(-1).kind,avatar);
 assert(h.dialog().innerHTML.includes(displayName));assert(h.dialog().innerHTML.includes(label));assert.doesNotMatch(h.dialog().innerHTML,/カサイ|旅人|<月>/);
 h.click('battle');await h.step(300);assert.deepEqual(requests,[PEER]);assert(!h.calls.some(call=>call.path==='/world/invitations'));
 }
});

test('stationary role revocation updates an open encounter portrait and removes the admin battle label',async()=>{
 const h=runtime();h.players=[actor({name:'紫の旅人',isAdmin:true,adminRole:'sub',avatar:'sub-admin'})];
 await h.step(800);assert(h.context.LT.World.interact());assert.equal(h.portraits.at(-1).kind,'sub-admin');
 h.players=[actor({name:'金の旅人',isAdmin:true,adminRole:'sub-sub',avatar:'sub-sub-admin'})];await h.step(500);
 assert.equal(h.portraits.at(-1).kind,'sub-sub-admin');assert.match(h.dialog().innerHTML,/イサカ/);
 h.players=[actor({name:'旅人 <月>',isAdmin:false,adminRole:null,avatar:'female'})];await h.step(1800);
 assert.equal(h.portraits.at(-1).kind,'hero-female');assert.match(h.dialog().innerHTML,/対戦を申し込む/);assert.match(h.dialog().innerHTML,/旅人 &lt;月&gt;/);assert.doesNotMatch(h.dialog().innerHTML,/SUB ADMIN|専用ステージ|イサカ|<月>/);
 const peer=h.context.LT.World.actors('village')[0];assert.equal(peer.adminRole,null);assert.equal(peer.avatar,'female');
});

test('both deputy trade encounters retain authoritative role metadata for the trainer confirmation flow',async()=>{
 for(const [role,avatar] of [['sub','sub-admin'],['sub-sub','sub-sub-admin']]){
 const h=runtime();h.players=[actor({name:'旅人',isAdmin:true,adminRole:role,avatar})];
 await h.step(800);await h.approachTrade();
 assert.deepEqual(copy(h.opens[0].encounter),{id:PEER,name:role==='sub'?'サカイ':'イサカ',isAdmin:true,adminRole:role,avatar});
 const invitation=h.calls.find(call=>call.path==='/world/invitations');assert.equal(invitation.body.targetId,PEER);assert(!Object.hasOwn(invitation.body,'adminRole'));
 }
});

test('incoming deputy portraits refresh when the service revokes either sender role',async()=>{
 for(const [role,avatar] of [['sub','sub-admin'],['sub-sub','sub-sub-admin']]){
 const h=runtime();h.invitations=[{id:'incoming-sub',from:actor({name:'旅人',isAdmin:true,adminRole:role,avatar}),to:{id:SELF},kind:'trade',state:'pending',expiresAt:h.now()+60000}];
 await h.step(800);assert.equal(h.portraits.at(-1).kind,avatar);assert(h.dialog().innerHTML.includes(role==='sub'?'サカイ':'イサカ'));assert.doesNotMatch(h.dialog().innerHTML,/カサイ/);
 h.invitations[0].from={...h.invitations[0].from,isAdmin:false,adminRole:null,avatar:'female'};await h.step(500);
 assert.equal(h.portraits.at(-1).kind,'hero-female');assert.match(h.dialog().innerHTML,/旅人/);
 }
});

test('an old stored OFF preference cannot disable the always-on solo field',async()=>{
 const h=runtime({stored:[['pachi-world-enabled-v1','off']]});await h.step(800);
 assert(h.calls.some(call=>call.path==='/world/presence'&&call.method==='POST'));
 assert.equal(h.context.LT.World.status().connected,true);assert.equal(h.context.LT.World.actors('village').length,1);
});

test('an old pending heartbeat is left before a resumed heartbeat, never deleted after it',async()=>{
 const post=deferred(),remove=deferred();let posts=0;
 const h=runtime({handle:(path,options)=>{
  if(path==='/world/presence'&&options.method==='POST'&&++posts===1)return post.promise;
  if(path==='/world/presence'&&options.method==='DELETE')return remove.promise;
 }});
 await h.step(800);assert.equal(h.calls.length,1);
 h.doc.hidden=true;h.event('visibilitychange');h.doc.hidden=false;h.event('visibilitychange');await h.step(0);
 assert.equal(h.calls.length,1,'Resuming waits for the old request and leave');
 post.resolve(h.snapshot());await settle();assert.deepEqual(h.calls.map(call=>call.method),['POST','DELETE']);assert.equal(h.context.LT.World.status().connected,false);
 remove.resolve({ok:true});await settle();await h.step(300);
 assert.deepEqual(h.calls.map(call=>call.method),['POST','DELETE','POST']);assert.equal(h.context.LT.World.status().connected,true);assert.equal(h.context.LT.World.actors('village').length,1);
});

test('a heartbeat for a previous map is discarded after travel before receiving its response',async()=>{
 const post=deferred();let posts=0;const h=runtime({handle:(path,options)=>path==='/world/presence'&&options.method==='POST'&&++posts===1?post.promise:undefined});
 await h.step(800);h.state.map='forest';h.context.LT.World.moved();post.resolve(h.snapshot('village'));await settle();
 assert.equal(h.context.LT.World.actors('village').length,0);assert.equal(h.context.LT.World.actors('forest').length,0);
 h.players=[actor({map:'forest'})];await h.step(500);assert.equal(h.context.LT.World.actors('forest').length,1);assert.equal(h.calls.at(-1).body.map,'forest');
});

test('a rejected room-ready invitation releases outgoing state so the player can try again',async()=>{
 let invitations=0;const h=runtime({handle:(path)=>{if(path==='/world/invitations'&&++invitations===1)return Promise.reject(Error('相手は移動しました'));}});
 await h.step(800);await h.approachTrade();await settle();assert.equal(invitations,1);assert.equal(h.trade.active,false);assert.equal(h.trade.cancels,1);assert(h.messages.some(message=>message.includes('相手は移動しました')));
 await h.step(300);await h.approachTrade();await settle();assert.equal(invitations,2);assert.equal(h.opens.length,2);assert.equal(h.trade.active,true);
 assert.equal(h.calls.filter(call=>call.path==='/world/invitations').at(-1).body.targetId,PEER);assert(h.notices.some(message=>message.includes('返事を待っています')));
});

test('a declined invitation retries conditional cleanup if a trade poll is busy',async()=>{
 const h=runtime();await h.step(800);await h.approachTrade();await settle();
 const creation=h.calls.find(call=>call.path==='/world/invitations');assert(creation);h.trade.failCleanup=true;
 h.invitations=[{id:'offer-1',from:{id:SELF},to:{id:PEER},kind:'trade',state:'declined',expiresAt:h.now()+60000}];
 await h.step(500);assert.equal(h.trade.cancels,1);assert.equal(h.trade.active,true);
 h.trade.failCleanup=false;await h.step(500);assert.equal(h.trade.cancels,2);assert.equal(h.trade.active,false);
 await h.step(300);assert(h.context.LT.World.interact(),'Retry cleanup should release the interaction lock');
});

test('the compact social bar is outside the canvas and the online list uses exact self-inclusive stage counts',async()=>{
 const h=runtime();h.populationRows=[{map:'village',count:2},{map:'forest',count:4},{map:'room:'+PEER,count:1,name:'星の私室 <特別>',kind:'secret'}];h.context.LT.DATA.maps.desert={name:'砂の道'};
 await h.step(800);const bar=h.bar();assert(bar);assert(!h.stage.children.includes(bar));assert(h.screen.children.indexOf(bar)<h.screen.children.indexOf(h.stage));
 assert.equal(bar.querySelector('[data-world-status]').textContent,'接続中');assert.equal(h.calls.filter(call=>call.path==='/world/population').length,0,'Hidden details must not poll population');
 assert(h.context.LT.World.openPopulation());await settle();assert.equal(h.context.LT.World.isDialogOpen(),true);
 assert.equal(h.populationSummary(),'世界全体 7人 · このステージ 2人（自分を含む）');assert.match(h.populationList(),/aria-current="location"/);assert.match(h.populationList(),/星の私室 &lt;特別&gt;/);assert.doesNotMatch(h.populationList(),/砂の道/);
 assert.doesNotMatch(h.populationList(),/<button|data-world-action=/,'Population rows never teleport or invite a player');
 h.click('population-filter');assert.match(h.populationList(),/砂の道/);assert.match(h.populationList(),/>0<small>人/);
 h.searchPopulation('私室');assert.match(h.populationList(),/星の私室/);assert.doesNotMatch(h.populationList(),/風待ちの里|深緑の森/);
 assert(h.context.LT.World.closeDialog());assert.equal(h.context.LT.World.isDialogOpen(),false);
});

test('chat launcher follows late availability, unread and modal state without moving into the canvas',async()=>{
 const h=runtime(),bar=h.bar(),button=bar.querySelector('[data-world-chat]'),unread=bar.querySelector('[data-world-chat-unread]');
 assert(button);assert(!h.stage.children.includes(bar));assert(h.screen.children.indexOf(bar)<h.screen.children.indexOf(h.stage));
 assert.equal(button.disabled,true,'The launcher waits for its client module');assert.equal(unread.hidden,true);assert.equal(button['aria-controls'],'global-chat-dialog');
 const state={available:true,unreadCount:3,isOpen:false};let opens=0;
 const chatDialog=h.doc.createElement('dialog');chatDialog.id='global-chat-dialog';h.doc.body.append(chatDialog);
 const changed=()=>h.event('pachi-chat-state',{detail:{...state}});
 h.context.LT.Chat={get available(){return state.available;},get unreadCount(){return state.unreadCount;},isDialogOpen:()=>state.isOpen,open(){opens++;state.isOpen=true;state.unreadCount=0;chatDialog.showModal();changed();}};
 changed();assert.equal(button.disabled,false);assert.equal(unread.hidden,false);assert.match(button['aria-label'],/全体チャット、未読3件/);assert.equal(button['aria-expanded'],'false');
 button.onclick();await settle();assert.equal(opens,1);assert.equal(button['aria-expanded'],'true');assert.equal(unread.hidden,true);assert.equal(button['aria-label'],'全体チャット');
 state.isOpen=false;chatDialog.close();changed();assert.equal(button['aria-expanded'],'false');assert.equal(button.disabled,false);
 state.unreadCount=120;changed();assert.match(button['aria-label'],/99件以上/);assert.equal(unread.hidden,false);
 h.context.navigator.onLine=false;changed();assert.equal(button.disabled,true,'Offline sessions cannot open a send surface');
 h.context.navigator.onLine=true;h.trade.active=true;changed();assert.equal(button.disabled,true,'An unrelated active trade keeps the launcher unavailable');
 h.trade.active=false;state.available=false;changed();assert.equal(button.disabled,true,'A client availability loss is reflected immediately');
});

test('population refreshes about every five seconds only while its list is open',async()=>{
 const h=runtime();await h.step(800);h.context.LT.World.openPopulation();await settle();const reads=()=>h.calls.filter(call=>call.path==='/world/population').length;
 assert.equal(reads(),1);for(let i=0;i<9;i++)await h.step(500);assert.equal(reads(),1);
 h.populationRows=[{map:'village',count:5}];await h.step(1800);assert.equal(reads(),2);assert.match(h.populationSummary(),/世界全体 5人/);
 h.click('close');await h.step(20000);assert.equal(reads(),2);assert.equal(h.context.LT.World.isDialogOpen(),false);
});

test('failed refreshes expire old population instead of inventing zero users, despite server clock offsets',async()=>{
 let requests=0;const h=runtime({handle:path=>path==='/world/population'&&++requests>1?Promise.reject(Error('Disconnected')):undefined});h.serverOffset=900000000;
 await h.step(800);h.context.LT.World.openPopulation();await settle();assert.match(h.populationSummary(),/世界全体 2人/);
 await h.step(6000);assert.match(h.populationSummary(),/世界全体 2人/);assert.match(h.dialog().querySelector('[data-world-population-updated]').textContent,/更新できません/);
 await h.step(10000);assert.doesNotMatch(h.populationSummary(),/\d+人/);assert.match(h.populationSummary(),/取得できません/);assert.match(h.populationList(),/確認中/);
 h.context.navigator.onLine=false;h.globalEvent('offline');await settle();assert.match(h.populationSummary(),/接続が戻る/);assert.doesNotMatch(h.populationSummary(),/0人/);
});

test('closing or changing identity ignores a pending population response without reopening the list',async()=>{
 const old=deferred();let requests=0;const h=runtime({handle:path=>path==='/world/population'&&++requests===1?old.promise:undefined});
 await h.step(800);h.context.LT.World.openPopulation();await settle();h.click('close');assert.equal(h.context.LT.World.isDialogOpen(),false,'Close remains available while the read is pending');
 h.context.LT.World.openPopulation();await settle();assert.match(h.populationSummary(),/世界全体 2人/);
 old.resolve({rows:[{map:'village',count:99}],total:99,serverTime:h.now(),ttlMs:15000});await settle();assert.match(h.populationSummary(),/世界全体 2人/);
 const pending=deferred(),changed=runtime({handle:path=>path==='/world/population'?pending.promise:undefined});await changed.step(800);changed.context.LT.World.openPopulation();await settle();
 changed.context.LT.Admin.player={id:OTHER,name:'別の人',isAdmin:false};changed.globalEvent('storage',{key:'pachi-player-identity-v1'});assert.equal(changed.context.LT.World.isDialogOpen(),false);
 pending.resolve({rows:[{map:'village',count:77}],total:77,serverTime:changed.now(),ttlMs:15000});await settle();assert.equal(changed.context.LT.World.isDialogOpen(),false);
});

test('travelling during a population read discards the old map and refreshes the current stage highlight',async()=>{
 const old=deferred();let requests=0;const h=runtime({handle:path=>path==='/world/population'&&++requests===1?old.promise:undefined});
 await h.step(800);h.context.LT.World.openPopulation();await settle();h.state.map='forest';h.populationRows=[{map:'forest',count:4}];h.context.LT.World.moved();await settle();
 assert.equal(h.populationSummary(),'世界全体 4人 · このステージ 4人（自分を含む）');assert.match(h.populationList(),/aria-current="location"[^]*深緑の森/);
 old.resolve({rows:[{map:'village',count:99}],total:99,serverTime:h.now(),ttlMs:15000});await settle();assert.equal(h.populationSummary(),'世界全体 4人 · このステージ 4人（自分を含む）');
});

test('busy or hidden sessions cannot open population and a hidden tab clears its displayed counts',async()=>{
 const h=runtime();await h.step(800);h.context.LT.adminBridge.isBusy=()=>true;assert.equal(h.context.LT.World.openPopulation(),false);assert.equal(h.calls.filter(call=>call.path==='/world/population').length,0);
 h.context.LT.adminBridge.isBusy=()=>false;h.context.LT.World.openPopulation();await settle();assert.match(h.populationSummary(),/世界全体 2人/);
 h.doc.hidden=true;h.event('visibilitychange');await settle();assert.match(h.populationSummary(),/接続が戻る/);assert.equal(h.context.LT.World.openPopulation(),true,'An open list can still be closed while hidden');assert.equal(h.context.LT.World.openPopulation(),false);
});

test('requesting the connected Kasai starts the live ceremony instead of a CPU room or ordinary peer invitation',async()=>{
 const h=runtime(),requests=[],oldRooms=[];h.players=[actor({isAdmin:true,avatar:'kasai',name:'謎のトレーナー カサイ'})];
 h.context.LT.KasaiLive={request:async id=>{requests.push(id);return {ok:true};},locked:()=>false,isWorking:()=>false};h.context.LT.Rooms={enterKasai:async id=>oldRooms.push(id)};
 await h.step(800);assert.equal(h.context.LT.World.interact(),true);assert.match(h.dialog().innerHTML,/カサイ本人と専用ステージ/);assert.match(h.dialog().innerHTML,/60秒以内/);h.click('battle');await h.step(300);
 assert.deepEqual(requests,[PEER]);assert.deepEqual(oldRooms,[]);assert(!h.calls.some(call=>call.path==='/world/invitations'));assert.equal(h.context.LT.World.isDialogOpen(),false);
});

test('a failed Kasai request reports its returned error after the encounter dialog closes',async()=>{
 const h=runtime(),message='カサイがフィールドを離れました。';h.players=[actor({isAdmin:true,avatar:'kasai'})];
 h.context.LT.KasaiLive={request:async()=>({ok:false,message}),locked:()=>false,isWorking:()=>false};
 await h.step(800);assert.equal(h.context.LT.World.interact(),true);h.click('battle');await settle();
 assert.equal(h.context.LT.World.isDialogOpen(),false);assert.deepEqual(h.messages,[message]);assert.equal(h.state.map,'village');
 assert(!h.calls.some(call=>call.path==='/world/invitations'),'A failed live request must not fall back to another battle type');
});

test('a busy Kasai and the operator identity cannot start a self or simultaneous live request',async()=>{
 for(const mode of ['busy','self']){
  const h=runtime(),requests=[];h.players=[actor({isAdmin:true,avatar:'kasai',status:mode==='busy'?'busy':'idle'})];h.context.LT.KasaiLive={request:async id=>requests.push(id)};
  if(mode==='self')h.context.LT.Admin.player.isAdmin=true;
  await h.step(800);assert.equal(h.context.LT.World.interact(),true);h.click('battle');await settle();assert.deepEqual(requests,[]);
 }
 const h=runtime();await h.step(800);h.context.LT.KasaiLive={locked:()=>true};assert.equal(h.context.LT.World.interact(),false);assert.equal(h.context.LT.World.openNearby(),false);assert.equal(h.context.LT.World.openPopulation(),true,'Readonly stage counts remain available while live movement and invitations are locked');await settle();assert.match(h.populationSummary(),/世界全体 2人/);
});

test('live request preparation publishes eligible idle presence, then the active ceremony becomes busy',async()=>{
 const h=runtime();await h.step(800);let preparing=true,active=false;
 h.context.LT.KasaiLive={isRequesting:()=>preparing,isWorking:()=>preparing,locked:()=>active};
 const pending=h.context.LT.World.refreshPresence();await settle();await h.step(300);assert.equal(await pending,true);
 assert.equal(h.calls.filter(call=>call.path==='/world/presence'&&call.method==='POST').at(-1).body.status,'idle','The request preparation itself must not make the sender fail the server idle guard');
 preparing=false;active=true;const joined=h.context.LT.World.refreshPresence();await settle();await h.step(300);assert.equal(await joined,true);
 assert.equal(h.calls.filter(call=>call.path==='/world/presence'&&call.method==='POST').at(-1).body.status,'busy','An active ceremony cannot receive another ordinary invitation');
});
