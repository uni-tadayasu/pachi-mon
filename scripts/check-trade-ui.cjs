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
function harness(){
 const memory=new Map(),calls=[],timers=[],doc={hidden:false,activeElement:null,addEventListener(){},body:{append(node){doc.dialog=node;}}};
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
 const engine={state:{started:true,party:[mon()],storage:[],tradeReceipts:[]}},ctx={console,crypto:webcrypto,document:doc,
  localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout(){},addEventListener(){},
  LT:{DATA:typeRuntime.LT.DATA,TypeSystem:typeRuntime.LT.TypeSystem,Abilities:typeRuntime.LT.Abilities,Art:{creature(){}},
   Admin:{tradeIdentity:async()=>owner,tradeRequest:async(path,options)=>{calls.push({path,...options});if(path.endsWith('/cancel'))ctx.serverTrade.state='cancelled';return{trade:copy(ctx.serverTrade)};}},adminBridge:{getEngine:()=>engine,isPlaying:()=>true,checkTrade:()=>({ok:true}),commitTrade:()=>ctx.saveOk?{ok:true}:{ok:false,message:'保存容量不足'}}},serverTrade:null,saveOk:true};
 let source=fs.readFileSync(require.resolve('../trade-client.js'),'utf8');source=source.replace('\n  if(controller.isLocked())void resume();','\n  globalThis.__tradeController=controller;');vm.createContext(ctx);vm.runInContext(source,ctx);
 return{ctx,doc,memory,calls,engine,timers,async click(action){const button=doc.dialog.children.find(x=>x.dataset.trade===action);assert(button,'Missing action '+action);await doc.dialog.listeners.click({target:button});},blur(){doc.activeElement=null;doc.dialog.listeners.focusout();for(const timer of timers.filter(t=>t.delay===0))timer.fn();}};
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
