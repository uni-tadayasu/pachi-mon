#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const ID='12345678-1234-4234-8234-123456789abc',key='pachi-pending-trade-v1',owner={id:'Pa123456789012345',name:'自分'};
const mon=(uid='owned',species='komori')=>({uid,species,level:10,xp:0,hp:30,pp:{move:4},shiny:true,nickname:'仲間'});
const room=()=>({id:ID,code:'ABC234',state:'open',revision:2,expiresAt:Date.now()+900000,you:'host',host:{...owner,monster:mon(),confirmed:false},guest:{id:'Pb123456789012345',name:'相手',monster:mon('other','shizuku'),confirmed:false}});
const copy=value=>JSON.parse(JSON.stringify(value));
const typeRuntime=vm.createContext({console});
for(const script of fs.readFileSync(require.resolve('../index.html'),'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
 if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
 vm.runInContext(script[2],typeRuntime);if(typeRuntime.LT?.Engine)break;
}
function harness({handle}={}){
 const memory=new Map(),calls=[],timers=[],events=[],messages=[],doc={hidden:false,activeElement:null,addEventListener(){},dispatchEvent(event){events.push(event);return true;},body:{append(node){doc.dialog=node;}}};
 class Element{
  constructor(tag,attrs=''){this.tag=tag;this.listeners={};this.dataset={};this.open=false;this.disabled=/\sdisabled(?:\s|$)/.test(attrs);this.children=[];this.scrollTop=0;this.value='';this.id='';this.textContent='';for(const m of attrs.matchAll(/([\w-]+)="([^"]*)"/g)){const [_,name,value]=m;if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;else this[name==='class'?'className':name]=value;}}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,fn){this.listeners[name]=fn;}
  showModal(){this.open=true;}
  close(){this.open=false;this.listeners.close?.();}
  focus(){doc.activeElement=this;}
  closest(selector){return selector==='[data-trade]'&&this.dataset.trade?this:null;}
  querySelectorAll(selector){return this.children.filter(x=>selector==='button'?x.tag==='button':selector==='canvas[data-trade-portrait]'?x.tag==='canvas'&&x.dataset.tradePortrait:selector.startsWith('#')?x.id===selector.slice(1):selector.startsWith('.')?x.className?.split(' ').includes(selector.slice(1)):false);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  set innerHTML(html){this.html=html;this.children=[];for(const m of html.matchAll(/<(button|input|select|canvas|div|p)\b([^>]*)>/g)){const child=new Element(m[1],m[2]);if(child.tag==='select'){const opts=html.slice(m.index).match(/<option value="([^"]*)"([^>]*)>/);child.value=opts?.[1]||'';}this.children.push(child);}}
  get innerHTML(){return this.html||'';}
 }
 doc.createElement=tag=>new Element(tag);
 const engine={state:{started:true,party:[mon()],storage:[],tradeReceipts:[]}},ctx={console,crypto:webcrypto,document:doc,CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},
  localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout(){},addEventListener(){},
  LT:{DATA:typeRuntime.LT.DATA,TypeSystem:typeRuntime.LT.TypeSystem,Abilities:typeRuntime.LT.Abilities,Art:{creature(){}},
   Admin:{tradeIdentity:async()=>owner,tradeRequest:async(path,options)=>{calls.push({path,...options});if(handle)return handle(path,options,ctx);if(path.endsWith('/cancel'))ctx.serverTrade.state='cancelled';return{trade:copy(ctx.serverTrade)};}},adminBridge:{getEngine:()=>engine,isPlaying:()=>true,toast:message=>messages.push(message),checkTrade:()=>({ok:true}),commitTrade:()=>ctx.saveOk?{ok:true}:{ok:false,message:'保存容量不足'}}},serverTrade:null,saveOk:true};
 let source=fs.readFileSync(require.resolve('../trade-client.js'),'utf8');source=source.replace('\n  if(controller.isLocked())void resume();','\n  globalThis.__tradeController=controller;');vm.createContext(ctx);vm.runInContext(source,ctx);
 return{ctx,doc,memory,calls,engine,timers,events,messages,async click(action){const button=doc.dialog.children.find(x=>x.dataset.trade===action);assert(button,'Missing action '+action);await doc.dialog.listeners.click({target:button});},blur(){doc.activeElement=null;doc.dialog.listeners.focusout();for(const timer of timers.filter(t=>t.delay===0))timer.fn();}};
}

test('exchange dialog is accessible, labels both offers and escapes player content',async()=>{
 const h=harness();h.ctx.serverTrade=room();h.ctx.serverTrade.guest.name='<img src=x>';h.ctx.serverTrade.guest.monster.nickname='<花>';
 await h.ctx.LT.Trade.open();assert.equal(h.doc.dialog.id,'pachi-trade-dialog');assert.equal(h.doc.dialog['aria-labelledby'],'trade-title');assert(h.doc.dialog.open);assert(h.ctx.LT.tradeActive);
 assert.match(h.doc.dialog.innerHTML,/自分が渡す/);assert.match(h.doc.dialog.innerHTML,/相手から受け取る/);assert.match(h.doc.dialog.innerHTML,/潮タイプ/);assert.match(h.doc.dialog.innerHTML,/Lv\.10/);assert.match(h.doc.dialog.innerHTML,/&lt;img src=x&gt;/);assert.match(h.doc.dialog.innerHTML,/&lt;花&gt;/);assert(!h.doc.dialog.innerHTML.includes('<img'));
 assert(h.doc.dialog.children.find(x=>x.dataset.trade==='close').disabled);
 for(const person of [h.ctx.serverTrade.host,h.ctx.serverTrade.guest]){const ability=typeRuntime.LT.Abilities.get(person.monster);assert(ability);assert(h.doc.dialog.innerHTML.includes(ability.name));assert(h.doc.dialog.innerHTML.includes(ability.description));}
});

test('both authoritative types are shown even when an offered individual carries stale type metadata',async()=>{
 const h=harness();h.ctx.serverTrade=room();h.ctx.serverTrade.guest.monster={...mon('other','volt_3'),types:['void']};
 await h.ctx.LT.Trade.open();assert.match(h.doc.dialog.innerHTML,/雷・風タイプ/);assert(!h.doc.dialog.innerHTML.includes('無タイプ'));
});

test('held individuals are absent from the selector and the existing item restriction is explained',async()=>{
 const h=harness();h.ctx.serverTrade=room();h.engine.state.storage.push({...mon('holding','shizuku'),heldItem:'leafcrown'},mon('available','shizuku'));
 await h.ctx.LT.Trade.open();assert(!h.doc.dialog.innerHTML.includes('<option value="holding"'));
 assert(h.doc.dialog.innerHTML.includes('<option value="available"'));assert.match(h.doc.dialog.innerHTML,/先に持ち物を外して/);
});

test('polling preserves selected element, focus and input code draft',async()=>{
 const h=harness();await h.ctx.LT.Trade.open();const code=h.doc.dialog.querySelector('#trade-code-input');code.value='ABC234';code.focus();await h.ctx.__tradeController.resume();assert.equal(h.doc.dialog.querySelector('#trade-code-input'),code);assert.equal(code.value,'ABC234');
 h.doc.activeElement=null;h.ctx.serverTrade=room();await h.ctx.__tradeController.resume();const select=h.doc.dialog.querySelector('#trade-monster');select.focus();await h.ctx.__tradeController.resume();assert.equal(h.doc.dialog.querySelector('#trade-monster'),select);assert.equal(h.doc.activeElement,select);
});

test('focused selector defers incoming preview changes and cannot confirm an unseen revision',async()=>{
 const h=harness();h.ctx.serverTrade=room();await h.ctx.LT.Trade.open();const select=h.doc.dialog.querySelector('#trade-monster');select.focus();
 h.ctx.serverTrade.revision++;h.ctx.serverTrade.guest.monster.nickname='変更後';await h.ctx.__tradeController.resume();assert.equal(h.doc.dialog.querySelector('#trade-monster'),select);assert(!h.doc.dialog.innerHTML.includes('変更後'));
 await h.click('confirm');assert(!h.calls.some(x=>x.path.endsWith('/confirm')));assert.match(h.doc.dialog.querySelector('.trade-status').textContent,/更新/);
 h.blur();assert(h.doc.dialog.innerHTML.includes('変更後'));await h.click('confirm');assert.equal(h.calls.filter(x=>x.path.endsWith('/confirm')).length,1);
});

test('Escape and close cannot dismiss active trade, while confirmed cancellation releases it',async()=>{
 const h=harness();h.ctx.serverTrade=room();await h.ctx.LT.Trade.open();let prevented=false;h.doc.dialog.listeners.cancel({preventDefault(){prevented=true;}});assert(prevented);h.ctx.LT.Trade.close();assert(h.doc.dialog.open);
 await h.click('cancel');assert(!h.ctx.LT.Trade.isLocked());await h.click('close');assert(!h.doc.dialog.open);assert(!h.ctx.LT.tradeActive);
});

test('public game guard sees another tab pending record before a storage event',async()=>{
 const h=harness();assert(!h.ctx.LT.Trade.isLocked());h.memory.set(key,JSON.stringify({version:1,ownerId:owner.id,roomId:ID}));assert(h.ctx.LT.Trade.isLocked());
});

test('completed screen appears only after durable save and acknowledgement',async()=>{
 const h=harness();h.ctx.serverTrade={...room(),state:'committed',receipt:{id:'trade:'+ID}};h.ctx.saveOk=false;await h.ctx.LT.Trade.open();assert(h.ctx.LT.Trade.isLocked());assert(!h.calls.some(x=>x.path.endsWith('/ack')));assert.match(h.doc.dialog.innerHTML,/受け取りを確認中/);
 h.ctx.saveOk=true;await h.click('refresh');assert(!h.ctx.LT.Trade.isLocked());assert(h.calls.some(x=>x.path.endsWith('/ack')));assert.match(h.doc.dialog.innerHTML,/交換が完了しました/);
});

const encounter={id:'Pb123456789012345',name:'<カサイ & 旅人>',isAdmin:true,avatar:'kasai'};
const waitingRoom=()=>({...room(),revision:0,guest:null,host:{...owner,monster:null,confirmed:false}});
function fieldService(path,options,ctx){
 if(path==='/trades')ctx.serverTrade=waitingRoom();
 if(path==='/trades/join')ctx.serverTrade={...room(),you:'guest',host:{id:encounter.id,name:encounter.name,monster:null,confirmed:false},guest:{...owner,monster:null,confirmed:false}};
 if(path.endsWith('/cancel')){
  if(options.body.waitingOnly&&ctx.serverTrade.guest)return{trade:copy(ctx.serverTrade)};
  ctx.serverTrade.state='cancelled';
 }
 return{trade:copy(ctx.serverTrade)};
}

test('field host creates once, calls room callback once, escapes counterpart and emits lifecycle state',async()=>{
 const h=harness({handle:fieldService}),codes=[];
 assert.equal(await h.ctx.LT.Trade.open({autoHost:true,encounter,onRoomReady:async code=>codes.push(code)}),true);
 assert.deepEqual(codes,['ABC234']);assert.equal(h.calls.filter(call=>call.path==='/trades').length,1);
 assert.equal(h.calls.filter(call=>call.path.endsWith('/confirm')).length,0);
 assert.deepEqual(copy(h.ctx.LT.Trade.worldState()),{active:true,connected:false,state:'open'});
 assert.match(h.doc.dialog.innerHTML,/&lt;カサイ &amp; 旅人&gt;とのフィールド交換/);
 assert.match(h.doc.dialog.querySelector('.trade-world-notice').textContent,/返事を待っています/);
 assert(h.events.some(event=>event.type==='pachi-trade-state'&&event.detail.active));
 h.ctx.LT.Trade.setWorldNotice('<返事> & 待機中');assert.equal(h.doc.dialog.querySelector('.trade-world-notice').textContent,'<返事> & 待機中');
 assert(!h.doc.dialog.innerHTML.includes('<返事>'));
});

test('URL invitation only fills code; explicit field acceptance autojoins without confirming an exchange',async()=>{
 let h=harness({handle:fieldService});
 assert.equal(await h.ctx.LT.Trade.open({joinCode:'ABC234'}),true);
 assert.equal(h.doc.dialog.querySelector('#trade-code-input').value,'ABC234');assert(!h.calls.some(call=>call.path==='/trades/join'));
 h=harness({handle:fieldService});
 assert.equal(await h.ctx.LT.Trade.open({autoJoin:true,joinCode:'ABC234',encounter}),true);
 assert.equal(h.calls.filter(call=>call.path==='/trades/join').length,1);
 assert(!h.calls.some(call=>call.path.endsWith('/offer')||call.path.endsWith('/confirm')));
 assert.deepEqual(copy(h.ctx.LT.Trade.worldState()),{active:true,connected:true,state:'open'});
});

test('field automatic actions respect local and server-only recovery instead of inviting to a previous room',async()=>{
 for(const local of [false,true])for(const autoHost of [false,true]){
  const h=harness({handle:fieldService});h.ctx.serverTrade=room();
  if(local)h.memory.set(key,JSON.stringify({version:1,ownerId:owner.id,roomId:ID,code:'ABC234'}));
  let callbacks=0;
  assert.equal(await h.ctx.LT.Trade.open({...(autoHost?{autoHost:true}:{autoJoin:true,joinCode:'ABC234'}),encounter,onRoomReady:async()=>callbacks++}),false);
  assert.equal(callbacks,0);assert(!h.calls.some(call=>call.path==='/trades'||call.path==='/trades/join'));
  assert(h.ctx.LT.Trade.isLocked());assert(h.doc.dialog.open);
 }
});

test('field host does not publish a room recovered during the second active-room check',async()=>{
 let checks=0,callbacks=0;
 const h=harness({handle:(path,options,ctx)=>{if(path==='/trades/active'&&++checks===2)ctx.serverTrade=waitingRoom();return fieldService(path,options,ctx);}});
 assert.equal(await h.ctx.LT.Trade.open({autoHost:true,encounter,onRoomReady:async()=>callbacks++}),false);
 assert.equal(callbacks,0);assert(!h.calls.some(call=>call.path==='/trades'));assert(h.ctx.LT.Trade.isLocked());
});

test('failed field invite cancels only its own empty room and returns to field',async()=>{
 const h=harness({handle:fieldService});
 assert.equal(await h.ctx.LT.Trade.open({autoHost:true,encounter,onRoomReady:async()=>{throw Error('相手は移動しました');}}),false);
 const cancel=h.calls.find(call=>call.path.endsWith('/cancel'));
 assert.deepEqual(copy(cancel.body),{waitingOnly:true,expectedRevision:0});
 assert(!h.ctx.LT.Trade.isLocked());assert(!h.doc.dialog.open);assert(!h.ctx.LT.tradeActive);
 assert(h.messages.includes('相手は移動しました'));assert.equal(h.events.at(-1).detail.active,false);
});

test('field waiting cleanup preserves a room if a guest joins concurrently',async()=>{
 const h=harness({handle:(path,options,ctx)=>{
  if(path.endsWith('/cancel')){ctx.serverTrade.guest=room().guest;ctx.serverTrade.revision++;}
  return fieldService(path,options,ctx);
 }});
 await h.ctx.LT.Trade.open({autoHost:true,encounter,onRoomReady:async()=>{}});
 assert.equal(await h.ctx.LT.Trade.cancelWorldWait('期限切れ'),false);
 assert.equal(h.ctx.__tradeController.trade.state,'open');assert(h.ctx.LT.Trade.isLocked());assert(h.doc.dialog.open);
 assert.equal(h.ctx.LT.Trade.worldState().connected,true);
});

test('field waiting cleanup does not cancel manually opened, joined, or committed rooms',async()=>{
 let h=harness({handle:fieldService});h.ctx.serverTrade=waitingRoom();await h.ctx.LT.Trade.open();
 assert.equal(await h.ctx.LT.Trade.cancelWorldWait(),false);assert(!h.calls.some(call=>call.path.endsWith('/cancel')));
 h=harness({handle:fieldService});await h.ctx.LT.Trade.open({autoJoin:true,joinCode:'ABC234',encounter});
 assert.equal(await h.ctx.LT.Trade.cancelWorldWait(),false);assert(!h.calls.some(call=>call.path.endsWith('/cancel')));
 h=harness({handle:fieldService});await h.ctx.LT.Trade.open({autoHost:true,encounter,onRoomReady:async()=>{}});
 h.ctx.serverTrade={...room(),state:'committed',receipt:{id:'trade:'+ID}};
 assert.equal(await h.ctx.LT.Trade.cancelWorldWait(),false);assert(!h.calls.some(call=>call.path.endsWith('/cancel')));
 assert(h.calls.some(call=>call.path.endsWith('/ack')));assert(h.doc.dialog.open);assert.match(h.doc.dialog.innerHTML,/交換が完了しました/);
});

test('field notices update without replacing a focused offer selector',async()=>{
 const h=harness({handle:fieldService});await h.ctx.LT.Trade.open({autoHost:true,encounter,onRoomReady:async()=>{}});
 const select=h.doc.dialog.querySelector('#trade-monster');select.focus();
 h.ctx.LT.Trade.setWorldNotice('相手が参加しました');
 assert.equal(h.doc.dialog.querySelector('#trade-monster'),select);assert.equal(h.doc.activeElement,select);
 assert.equal(h.doc.dialog.querySelector('.trade-world-notice').textContent,'相手が参加しました');
});

test('invalid automatic mode combinations cannot create or join a room',async()=>{
 for(const options of [{autoHost:true,autoJoin:true,joinCode:'ABC234'},{autoHost:true,joinCode:'ABC234'},{autoJoin:true}]){
  const h=harness({handle:fieldService});assert.equal(await h.ctx.LT.Trade.open(options),false);assert.equal(h.calls.length,0);assert.equal(h.doc.dialog,undefined);
 }
});
