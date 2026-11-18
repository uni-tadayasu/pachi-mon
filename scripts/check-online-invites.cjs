#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path'),source=fs.readFileSync(path.join(__dirname,'..','online-invites.js'),'utf8');
const {normalizeCode,parse,create,createReceiver,routeInvite}=require('../online-invites.js');
const BASE='https://example.test/pachi-mon/';
const invitation=(mode='trade',code='ABC234')=>create(mode,code,BASE);
const plain=value=>JSON.parse(JSON.stringify(value));

test('typed invitations round-trip for both modes and retain the deployment path',()=>{
  for(const mode of ['battle','trade']){
    const url=create(mode,'abc234',BASE+'index.html?token=private&old=1#settings');
    assert.equal(url,BASE+'index.html?pachi_invite='+mode+'&pachi_room=ABC234');
    assert.deepEqual(parse(url),{mode,code:'ABC234'});
  }
  assert.equal(normalizeCode('Z9NPX2'),'Z9NPX2');
  assert.equal(parse(BASE+'?campaign=autumn#about'),null);
  assert.throws(()=>create('battle','ABC234','javascript:alert(1)'));
  assert.throws(()=>create('trade','ABC234','https://name:secret@example.test/game/'));
});

test('ambiguous, truncated and invalid links cannot become a different invitation',()=>{
  const queries=[
    '?pachi_invite=battle', '?pachi_room=ABC234',
    '?pachi_invite=battle&pachi_invite=battle&pachi_room=ABC234',
    '?pachi_invite=battle&%70achi_invite=trade&pachi_room=ABC234',
    '?pachi_invite=trade&pachi_room=ABC234&pachi_room=ABC234',
    '?pachi_invite=trade&pachi_room=ABC234&pachi_room=XYZ789',
    '?pachi_invite=local&pachi_room=ABC234', '?pachi_invite=&pachi_room=ABC234',
    '?pachi_invite=trade&pachi_room=ABC123', '?pachi_invite=trade&pachi_room=ABO234',
    '?pachi_invite=trade&pachi_room=ABC23', '?pachi_invite=trade&pachi_room=ABC2345',
    '?pachi_invite=trade&pachi_room=%20ABC234', '?pachi_invite=trade&pachi_room=AB-C234',
    '?pachi_invite=trade&pachi_room=ABC%ZZ', '?pachi_invite=trade&pachi_room=%3Cimg%3E',
    '?pachi_invite=trade&pachi_room=ＡＢＣ２３４'
  ];
  for(const query of queries)assert.throws(()=>parse(BASE+query),query);
  assert.throws(()=>parse('not a url'));
  assert.throws(()=>normalizeCode(null));
  assert.throws(()=>create('TRADE','ABC234',BASE));
});

test('opening a link is read-only; invalid links can be dismissed without touching other URL state',()=>{
  let href=BASE+'?lang=ja&pachi_invite=trade&pachi_room=ABC234&pachi_room=XYZ789#about';
  let deliveries=0,replacements=0;
  const receiver=createReceiver({href:()=>href,replace:url=>{href=url;replacements++;},deliver:()=>{deliveries++;return true;}});
  assert(receiver.snapshot().error);assert.equal(receiver.snapshot().pending,null);
  assert.equal(deliveries,0);assert.equal(replacements,0);
  receiver.dismiss();receiver.refresh();
  assert.equal(href,BASE+'?lang=ja#about');assert.equal(deliveries,0);assert.equal(receiver.snapshot().error,'');
});

test('busy or rejected delivery retains the invitation; explicit dismissal never reopens it',async()=>{
  let href=invitation(),deliveries=0,replacements=0;
  const receiver=createReceiver({href:()=>href,replace:url=>{href=url;replacements++;},deliver:()=>{deliveries++;return {accepted:false,message:'今の交換を確認してください。'};}});
  receiver.refresh();assert.equal(deliveries,0);
  assert.equal(await receiver.open(),false);assert.equal(receiver.snapshot().pending.mode,'trade');
  assert.equal(replacements,0);assert.match(receiver.snapshot().message,/確認/);
  receiver.dismiss();receiver.refresh();assert.equal(await receiver.open(),false);
  assert.equal(deliveries,1);assert.equal(replacements,1);assert.equal(receiver.snapshot().pending,null);
});

test('URL is consumed only after asynchronous UI delivery succeeds, with duplicate clicks ignored',async()=>{
  let href=invitation('battle')+'&lang=ja#about',resolve,deliveries=0,replacements=0;
  const receiver=createReceiver({href:()=>href,replace:url=>{href=url;replacements++;},deliver:()=>{deliveries++;return new Promise(yes=>{resolve=yes;});}});
  const first=receiver.open();assert(receiver.snapshot().working);assert.equal(replacements,0);
  assert.equal(await receiver.open(),false);assert.equal(deliveries,1);
  resolve(true);assert.equal(await first,true);assert.equal(replacements,1);
  assert.equal(href,BASE+'?lang=ja#about');assert.equal(receiver.snapshot().pending,null);
  receiver.refresh();assert.equal(await receiver.open(),false);assert.equal(deliveries,1);
  const second=createReceiver({href:()=>invitation('trade','XYZ789'),deliver:invite=>{assert.equal(invite.mode,'trade');assert.equal(invite.code,'XYZ789');return true;}});
  assert.equal(await second.open(),true,'a later, separate invitation has its own mode and code');
});

test('a failed asynchronous boot keeps its URL and can be retried after the competing activity ends',async()=>{
  let resolve,accepted=false,replacements=0;
  const receiver=createReceiver({href:()=>invitation('battle'),replace:()=>replacements++,deliver:()=>accepted?true:new Promise(yes=>{resolve=yes;})});
  const attempt=receiver.open();resolve(false);assert.equal(await attempt,false);
  assert(receiver.snapshot().pending);assert.equal(replacements,0);
  accepted=true;assert.equal(await receiver.open(),true);assert.equal(replacements,1);
});

function environment(){
  const calls=[],state={playing:true,busy:false,dialog:false,booting:false,locked:false,local:false};
  const env={navigator:{onLine:true},document:{querySelector:()=>state.dialog?{}:null,body:{classList:{contains:()=>state.booting}}},
    LT:{adminBridge:{isPlaying:()=>state.playing,isBusy:()=>state.busy,getEngine:()=>({state:{started:state.playing}})},
      Trade:{isLocked:()=>state.locked,resume:async()=>{calls.push(['resume']);},open:async options=>{calls.push(['trade',options]);return true;}},
      OnlineUI:{open:options=>{calls.push(['battle-direct',options]);return true;}},requestOnline:async options=>{calls.push(['battle',options]);return true;}}};
  return {env,state,calls};
}

test('routes are mode-specific and only prefill the existing UI',async()=>{
  const h=environment();
  assert((await routeInvite({mode:'battle',code:'abc234'},h.env)).accepted);
  assert.deepEqual(h.calls,[['battle',{transport:'internet',joinCode:'ABC234'}]]);
  assert((await routeInvite({mode:'trade',code:'XYZ789'},h.env)).accepted);
  assert.deepEqual(h.calls[1],['trade',{joinCode:'XYZ789'}]);
  await assert.rejects(routeInvite({mode:'local',code:'ABC234'},h.env));
  assert.equal(h.calls.length,2,'no alternate route, automatic join, team ready or exchange confirm');
});

test('exchange invitations use the normal game preparation hook and keep the invite when that hook fails',async()=>{
  const h=environment();let accepted=false,replacements=0;
  h.env.LT.requestTrade=async options=>{h.calls.push(['prepare-trade',options]);return accepted;};
  const receiver=createReceiver({href:()=>invitation('trade'),replace:()=>replacements++,deliver:invite=>routeInvite(invite,h.env)});
  assert.equal(h.calls.length,0,'reading the invitation never starts preparation or saving');
  assert.equal(await receiver.open(),false);assert(receiver.snapshot().pending);assert.equal(replacements,0);
  assert.deepEqual(h.calls,[['prepare-trade',{joinCode:'ABC234'}]]);
  accepted=true;assert.equal(await receiver.open(),true);assert.equal(replacements,1);
  assert(!h.calls.some(call=>call[0]==='trade'),'the shared router does not bypass the game hook');
});

test('pending exchange recovery takes precedence over both battle and exchange invitations',async()=>{
  const h=environment();h.state.locked=true;
  for(const mode of ['battle','trade']){
    const result=await routeInvite({mode,code:'ABC234'},h.env);
    assert.equal(result.accepted,false);assert.match(result.message,/交換の結果/);
  }
  assert.deepEqual(h.calls,[['resume'],['resume']]);
  h.state.dialog=true;await routeInvite({mode:'trade',code:'ABC234'},h.env);
  assert.equal(h.calls.length,2,'an open recovery dialog is not opened a second time');
});

test('title, battle, introduction, other dialogs, local play and offline conditions retain delivery',async()=>{
  for(const key of ['busy','dialog','booting']){
    const h=environment();h.state[key]=true;assert.equal((await routeInvite({mode:'trade',code:'ABC234'},h.env)).accepted,false);assert.equal(h.calls.length,0,key);
  }
  for(const key of ['onlineActive','localTradeActive','tradeActive']){
    const h=environment();h.env.LT[key]=true;assert.equal((await routeInvite({mode:'battle',code:'ABC234'},h.env)).accepted,false);assert.equal(h.calls.length,0,key);
  }
  const title=environment();title.state.playing=false;
  assert.equal((await routeInvite({mode:'trade',code:'ABC234'},title.env)).accepted,false);assert.equal(title.calls.length,0);
  const offline=environment();offline.env.navigator.onLine=false;
  assert.equal((await routeInvite({mode:'battle',code:'ABC234'},offline.env)).accepted,false);assert.equal(offline.calls.length,0,'an online invite never falls back to a local room');
});

function browserHarness(url=invitation('trade')){
  const calls=[],events=new Map(),windowEvents=new Map(),state={playing:false,busy:false,dialog:false,booting:false,locked:false,accepted:true};
  class Element{
    constructor(tag){this.tagName=tag.toUpperCase();this.listeners={};this.children=[];this.dataset={};this.hidden=false;this.classList={contains:name=>name==='is-booting'&&state.booting};}
    setAttribute(name,value){this[name]=value;}
    addEventListener(name,callback){this.listeners[name]=callback;}
    append(child){this.children.push(child);child.parent=this;}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
    closest(selector){return selector==='[data-online-invite-action]'&&this.dataset.onlineInviteAction?this:null;}
    set innerHTML(value){this.html=value;this.children=[];for(const m of value.matchAll(/<button\b([^>]*)>/g)){const b=new Element('button');b.dataset.onlineInviteAction=m[1].match(/data-online-invite-action="([^"]+)"/)?.[1];b.disabled=/\bdisabled\b/.test(m[1]);this.append(b);}}
    get innerHTML(){return this.html||'';}
  }
  const body=new Element('body'),continuing=new Element('button'),starting=new Element('button');
  continuing.hidden=false;continuing.click=()=>calls.push(['continue']);starting.click=()=>calls.push(['start']);
  const doc={body,createElement:tag=>new Element(tag),querySelector:()=>state.dialog?{}:null,
    getElementById:id=>id==='continue-btn'?continuing:id==='start-btn'?starting:body.children.find(node=>node.id===id),
    addEventListener:(name,callback)=>{const list=events.get(name)||[];list.push(callback);events.set(name,list);}};
  const ctx={URL,console,document:doc,location:{href:url},navigator:{onLine:true},addEventListener:(name,callback)=>windowEvents.set(name,callback),
    history:{state:{test:true},replaceState(previous,title,next){calls.push(['replace',next]);ctx.location.href=next;}},
    localStorage:{getItem(){throw Error('Invitation code must not read save data');},setItem(){throw Error('Invitation code must not write save data');}},
    LT:{adminBridge:{isPlaying:()=>state.playing,isBusy:()=>state.busy,getEngine:()=>({state:{started:state.playing}})},
      Trade:{isLocked:()=>state.locked,resume:async()=>{calls.push(['resume']);},open:async options=>{calls.push(['trade',plain(options)]);return state.accepted;}},
      OnlineUI:{open:()=>true},requestOnline:async options=>{calls.push(['battle',plain(options)]);return state.accepted;}}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {ctx,doc,state,calls,continuing,notice:()=>doc.getElementById('online-invite-notice'),event(name){for(const fn of events.get(name)||[])fn();},async click(action){const n=this.notice(),button=n?.children.find(x=>x.dataset.onlineInviteAction===action);assert(button,'Missing notice action '+action);await n.listeners.click({target:button,preventDefault(){},stopPropagation(){}});}};
}

test('title exchange invitation survives normal adventure startup and the delayed introduction',async()=>{
  const h=browserHarness();assert(h.notice());assert.match(h.notice().innerHTML,/つづきから交換へ/);assert.equal(h.calls.length,0);
  await h.click('adventure');assert.deepEqual(h.calls,[['continue']]);assert(h.ctx.location.href.includes('pachi_invite'));
  h.state.playing=true;h.event('pachi-game-ready');assert.match(h.notice().innerHTML,/招待された交換へ/);
  h.state.dialog=true;await h.click('open');assert(!h.calls.some(call=>call[0]==='trade'));assert(h.notice());
  h.state.dialog=false;h.event('close');await h.click('open');
  assert.deepEqual(h.calls.filter(call=>call[0]==='trade'),[['trade',{joinCode:'ABC234'}]]);assert.equal(h.notice(),undefined);assert.equal(h.ctx.location.href,BASE);
  h.event('close');h.event('pachi-game-ready');assert.equal(h.notice(),undefined,'returning from the exchange does not reopen the consumed invitation');
});

test('new-adventure CTA uses the existing safe start action, and dismiss does not return after ready',async()=>{
  const h=browserHarness();h.continuing.hidden=true;h.event('visibilitychange');assert.match(h.notice().innerHTML,/冒険をはじめる/);
  await h.click('adventure');assert.deepEqual(h.calls,[['start']]);await h.click('dismiss');
  h.state.playing=true;h.event('pachi-game-ready');h.event('close');assert.equal(h.notice(),undefined);assert(!h.calls.some(call=>call[0]==='trade'));
});

test('invalid browser invitation shows a non-destructive error without opening any mode',async()=>{
  const h=browserHarness(BASE+'?pachi_invite=battle&pachi_invite=trade&pachi_room=ABC234');
  assert.match(h.notice().innerHTML,/招待リンクを確認/);assert.equal(h.calls.length,0);
  await h.click('dismiss');assert.equal(h.notice(),undefined);assert.equal(h.ctx.location.href,BASE);
});

function sharingHarness(navigator){
  const ctx={URL,console,navigator,location:{href:BASE+'?private=remove#old'},LT:{}};vm.createContext(ctx);vm.runInContext(source,ctx);
  const field={value:invitation('battle'),selected:false,focus(){},select(){this.selected=true;}},status={textContent:''};
  const container={querySelector:selector=>selector==='[data-online-invite-url]'?field:status};
  const button={disabled:false,shared:false,hasAttribute:()=>button.shared,closest:()=>container};
  const event={target:{closest:()=>button},preventDefault(){}};
  return {api:ctx.LT.OnlineInvites,field,status,button,event};
}

test('share UI exposes an accessible selectable URL, removes unrelated query data and copies only after a click',async()=>{
  const copied=[],h=sharingHarness({clipboard:{writeText:async value=>copied.push(value)}});
  const html=h.api.shareHtml('battle','ABC234');assert.match(html,/readonly/);assert.match(html,/data-online-invite-copy/);assert.match(html,/role="status"/);
  assert(!html.includes('private=remove'));assert.equal(copied.length,0);
  assert.equal(await h.api.handleClick(h.event),true);assert.deepEqual(copied,[invitation('battle')]);assert.equal(h.button.disabled,false);
  assert.match(h.status.textContent,/コピーしました/);
});

test('unsupported or rejected clipboard permits manual copying; cancelled native share is not a failure',async()=>{
  for(const navigator of [{},{clipboard:{writeText:async()=>{throw Error('Permission denied');}}}]){
    const h=sharingHarness(navigator);await h.api.handleClick(h.event);assert(h.field.selected);assert.equal(h.button.disabled,false);assert.match(h.status.textContent,/コピー/);
  }
  const cancelled=sharingHarness({share:async()=>{throw Object.assign(Error('cancelled'),{name:'AbortError'});}});
  cancelled.button.shared=true;assert.match(cancelled.api.shareHtml('trade','ABC234'),/data-online-invite-share/);
  await cancelled.api.handleClick(cancelled.event);assert.match(cancelled.status.textContent,/キャンセル/);assert.equal(cancelled.field.selected,false);assert.equal(cancelled.button.disabled,false);
});
