#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {WorldPresence}=require('../field-world.js');
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

// Runtime tests use the real client, a small DOM and controlled promises. They
// never contact the service or create invitations for real player identities.
function runtime({handle,stored=[]}={}){
 let now=100000,nextTimer=0,requestId=0;const timers=new Map(),memory=new Map(stored),calls=[],messages=[],notices=[],opens=[],events={},globalEvents={};
 const state={started:true,map:'village',x:1,y:1,facing:'right',avatar:'female'},engine={state,battle:null};
 const doc={hidden:false,nodes:[],addEventListener(name,fn){(events[name]||=[]).push(fn);},dispatchEvent(event){for(const fn of events[event.type]||[])fn(event);return true;},body:{append(node){doc.nodes.push(node);}},querySelector(selector){if(selector==='.game-stage')return stage;if(selector==='dialog[open]')return doc.nodes.find(node=>node.tag==='dialog'&&node.open)||null;return null;}};
 class Element{
  constructor(tag,attrs=''){this.tag=tag;this.dataset={};this.children=[];this.listeners={};this.open=false;this.disabled=/\sdisabled(?:\s|$)/.test(attrs);this.hidden=false;this.textContent='';this.id='';
   for(const m of attrs.matchAll(/([\w-]+)="([^"]*)"/g)){const [,key,value]=m;if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;else this[key==='class'?'className':key]=value;}
   for(const m of attrs.matchAll(/\b(data-[\w-]+)(?=\s|$)/g))this.dataset[m[1].slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]??='';
  }
  append(node){this.children.push(node);}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,fn){(this.listeners[name]||=[]).push(fn);}
  emit(name,event={}){for(const fn of this.listeners[name]||[])fn(event);}
  showModal(){this.open=true;}
  close(){this.open=false;this.emit('close');}
  matches(selector){if(selector==='button')return this.tag==='button';if(selector==='canvas[data-traveller]')return this.tag==='canvas'&&this.dataset.traveller!==undefined;if(selector.startsWith('#'))return this.id===selector.slice(1);const attr=selector.match(/^\[(data-[\w-]+)\]$/);return !!attr&&Object.hasOwn(this.dataset,attr[1].slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()));}
  closest(selector){return this.matches(selector)?this:null;}
  querySelectorAll(selector){return this.children.filter(node=>node.matches(selector));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  set innerHTML(html){this.html=html;this.children=[];for(const match of html.matchAll(/<(button|section|div|span|canvas|p|h2)\b([^>]*)>/g))this.children.push(new Element(match[1],match[2]));}
  get innerHTML(){return this.html||'';}
 }
 doc.createElement=tag=>new Element(tag);const stage=new Element('div');
 const trade={active:false,connected:false,state:null,cancels:0,failCleanup:false};
 const context=vm.createContext({console,Date:class extends Date{static now(){return now;}},document:doc,navigator:{onLine:true},crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++requestId).padStart(12,'0')}`},
  localStorage:{getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)},
  setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{at:now+Math.max(0,Number(delay)||0),fn});return id;},clearTimeout:id=>timers.delete(id),
  addEventListener(name,fn){(globalEvents[name]||=[]).push(fn);},
  LT:{DATA:{maps:{village:{},forest:{}}},Admin:{player:{id:SELF,name:'自分',isAdmin:false},worldRequest:async(path,options={})=>{
   calls.push({path,...copy(options),at:now});const supplied=handle?handle(path,options,h):undefined;if(supplied!==undefined)return supplied;
   if(path==='/world/presence'&&options.method==='POST')return h.snapshot(options.body.map);
   if(path==='/world/invitations')return {invitation:{id:'offer-'+requestId,state:'pending',expiresAt:now+60000,roomCode:options.body.roomCode}};
   return {ok:true};
  }},adminBridge:{getEngine:()=>engine,isPlaying:()=>h.playing,isBusy:()=>false,refresh(){h.refreshes++;},toast:message=>messages.push(message)},Art:{traveller(){}},
  Trade:{isLocked:()=>trade.active,worldState:()=>({...trade}),setWorldNotice:message=>notices.push(message),async cancelWorldWait(){trade.cancels++;if(trade.failCleanup)return false;trade.active=false;trade.state='cancelled';context.LT.tradeActive=false;doc.dispatchEvent({type:'pachi-trade-state'});return true;},async open(options){
   opens.push(options);trade.active=true;trade.connected=false;trade.state='open';context.LT.tradeActive=true;
   try{if(options.autoHost)await options.onRoomReady('ABC234');return true;}catch(_){return false;}
  }}
 }});
 const h={context,doc,stage,state,engine,trade,calls,messages,notices,opens,playing:true,refreshes:0,serverOffset:0,players:[actor()],invitations:[],
  snapshot(map=state.map){return packet(this.players.map(person=>({...person,map:person.map,updatedAt:now+this.serverOffset})),{self:actor({id:SELF,map,x:state.x,y:state.y}),serverTime:now+this.serverOffset,invitations:copy(this.invitations)});},
  async step(ms=0){now+=ms;for(let i=0;i<100;i++){const due=[...timers.entries()].filter(([,timer])=>timer.at<=now).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;timers.delete(due[0]);due[1].fn();await settle();if(i===99)assert.fail('Runtime timer loop did not settle');}await settle();},
  event(type,values={}){doc.dispatchEvent({type,...values});},globalEvent(type,values={}){for(const fn of globalEvents[type]||[])fn({type,...values});},
  dialog(){return doc.nodes.find(node=>node.id==='world-player-dialog');},
  click(action){const dialog=this.dialog(),button=dialog?.children.find(node=>node.dataset.worldAction===action);assert(button,'Missing world action '+action);dialog.emit('click',{target:button});},
  async approachTrade(){assert(context.LT.World.interact(),'Nearby player should be interactable');this.click('trade');await this.step(300);},now:()=>now
 };
 vm.runInContext(SOURCE,context);return h;
}

test('runtime heartbeat publishes canonical position, retains offline solo play and clears leaving actors',async()=>{
 const h=runtime();h.serverOffset=800000;await h.step(800);
 const post=h.calls.find(call=>call.method==='POST');assert.deepEqual(post.body,{map:'village',x:1,y:1,facing:'right',avatar:'female',status:'idle'});
 assert.equal(h.context.LT.World.status().connected,true);assert.equal(h.context.LT.World.actors('village').length,1);
 h.context.navigator.onLine=false;h.globalEvent('offline');await settle();assert.equal(h.context.LT.World.actors('village').length,0);assert.equal(h.state.started,true);assert.equal(h.state.map,'village');
 assert(h.calls.some(call=>call.method==='DELETE'));await h.step(1500);assert.equal(h.calls.filter(call=>call.method==='POST').length,1);
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
