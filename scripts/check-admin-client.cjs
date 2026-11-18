#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const TOKEN_A='A'.repeat(43),TOKEN_B='B'.repeat(43);
const PLAYER_A={id:'P'+'a'.repeat(16),name:'A',isAdmin:true};
const PLAYER_B={id:'P'+'b'.repeat(16),name:'B',isAdmin:false};
const CONFIG={level:100,stats:{hp:500,atk:150,def:150,spAtk:180,spDef:150,speed:160,accuracy:110,evasion:100},moves:['supernova','atlas_crystal_4','starlight','shell']};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const response=data=>({ok:true,status:200,json:async()=>({ok:true,...data})});
async function until(check){for(let i=0;i<100;i++){if(check())return;await Promise.resolve();}assert.fail('Expected asynchronous step was not reached');}
function harness({storage=new Map(),handle=()=>null,bridge={},settings=false}={}){
  const calls=[],applied=[],updated=[],initial=[],toasts=[],listeners={},clock={now:1_000_000};
  const serviceBody={dataset:{},innerHTML:''},statusLine={dataset:{},textContent:''},keyField={value:'',focus(){}};
  const serviceRoot={querySelector:selector=>selector==='[data-service-body]'?serviceBody:selector==='.pachi-status'?statusLine:null};
  const settingsContent={querySelector:selector=>selector==='#pachi-service'?serviceRoot:selector==='.pachi-status'?statusLine:null};
  const element=id=>!settings?null:id==='modal-title'?{textContent:'冒険の設定'}:id==='modal-content'?settingsContent:id==='pachi-admin-key'&&serviceBody.innerHTML.includes('id="pachi-admin-key"')?keyField:null;
  const hooks=`globalThis.__test={sync,ensureIdentity,adoptIdentity,prepareGrant,submitPendingGrant,loadPendingGrant,refreshSettings,claim,prepareRelease,releaseAdmin,handleConsole,futoMoveEntries,attachConsole(dialog,registration){consoleDialog=dialog;adminRegistration=registration;},get releaseReview(){return releaseReview;},get releaseBusy(){return releaseBusy;},get status(){return status;},get claimBusy(){return claimBusy;},stubConsole(fn){openConsole=fn;},resumePending(){pendingGrant=loadPendingGrant();},get pendingGrant(){return pendingGrant;}};`;
  let source=fs.readFileSync(require.resolve('../admin-console.js'),'utf8');
  assert(source.includes('mountSettings();void sync();'));
  source=source.replace('mountSettings();void sync();',hooks);
  const ctx={console,crypto:webcrypto,AbortController,URL,Blob,btoa,atob,
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    MutationObserver:class{observe(){}},
    document:{getElementById:element,addEventListener:(type,fn)=>{(listeners[type]||=[]).push(fn);},hidden:false},
    Date:class extends Date{static now(){return clock.now;}},
    LT:{DATA:{moves:Object.fromEntries(CONFIG.moves.map(id=>[id,{name:id}]))},adminBridge:{
      getEngine:()=>null,getPlayerName:()=> 'Traveller',toast:message=>toasts.push(message),
      grantFuto:g=>{applied.push(g);return{ok:true,alreadyReceived:true};},
      receiveAdminLegendary:g=>{initial.push(g);return{ok:true,alreadyReceived:true};},
      receiveAdminMythical:g=>{initial.push(g);return{ok:true,alreadyReceived:true};},
      updateOwnedFuto:(id,g)=>{updated.push(g);return{ok:true};},...bridge}},
    fetch:async(url,options)=>{
      const call={path:new URL(url).pathname.replace('/api',''),search:new URL(url).search,token:options.headers.Authorization?.replace('Bearer ',''),body:options.body?JSON.parse(options.body):undefined};calls.push(call);
      const result=handle(call);if(result)return await result;
      if(call.path==='/status')return response({adminExists:false});
      if(call.path==='/register')return response({player:call.body.token===TOKEN_B?PLAYER_B:PLAYER_A,adminExists:true});
      if(call.path==='/me')return response({player:call.token===TOKEN_B?PLAYER_B:PLAYER_A,adminExists:true,grants:[],nextCursor:null});
      throw new Error('Unexpected request '+call.path);
    }
  };
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx,{filename:'admin-console.js'});
  // Clicks on the service panel's buttons, as the page delivers them.
  const press=action=>{const button={dataset:{adminAction:action},disabled:false,isConnected:true};for(const fn of listeners.click||[])fn({target:{closest:()=>button}});return button;};
  return{ctx,api:ctx.__test,calls,applied,updated,initial,toasts,storage,serviceBody,statusLine,keyField,press,clock};
}
function adopt(h,token=TOKEN_A,player=PLAYER_A){h.api.adoptIdentity({token,id:player.id,name:player.name},player,true);}

test('a required registration queued during status-only sync is not dropped',async()=>{
  const status=deferred();let statuses=0;
  const h=harness({handle:c=>c.path==='/status'&&statuses++===0?status.promise:null});
  const first=h.api.sync();await until(()=>h.calls.length===1);
  const required=h.api.sync({register:true});status.resolve(response({adminExists:false}));
  await Promise.all([first,required]);
  assert.equal(h.calls.filter(c=>c.path==='/register').length,1);
  assert.equal(h.calls.filter(c=>c.path==='/status').length,2);
  assert.equal(h.ctx.LT.Admin.player.id,PLAYER_A.id);
});

test('restoring identity discards old responses and starts pagination under the new token',async()=>{
  const old=deferred();
  const h=harness({handle:c=>{
    if(c.path==='/me'&&c.token===TOKEN_A)return old.promise;
    if(c.path==='/me'&&c.token===TOKEN_B)return response({player:PLAYER_B,adminExists:true,grants:[{grantId:'new-player-grant'}],nextCursor:null});
  }});
  adopt(h);const first=h.api.sync();await until(()=>h.calls.some(c=>c.path==='/me'));
  adopt(h,TOKEN_B,PLAYER_B);const restored=h.api.sync({fresh:true});
  old.resolve(response({player:PLAYER_A,adminExists:true,grants:[{grantId:'old-player-grant'}],nextCursor:42}));
  await Promise.all([first,restored]);
  assert.deepEqual(h.applied.map(g=>g.grantId),['new-player-grant']);
  assert.equal(h.ctx.LT.Admin.player.id,PLAYER_B.id);
  assert.equal(h.calls.find(c=>c.path==='/me'&&c.token===TOKEN_B).search,'?limit=50');
});

test('stale registration cannot overwrite a restored player',async()=>{
  const registration=deferred(),storage=new Map([['pachi-player-identity-v1',JSON.stringify({token:TOKEN_A,name:'A'})]]);
  const h=harness({storage,handle:c=>c.path==='/register'?registration.promise:null});
  const first=h.api.ensureIdentity();await until(()=>h.calls.length===1);
  adopt(h,TOKEN_B,PLAYER_B);registration.resolve(response({player:PLAYER_A,adminExists:true}));
  await assert.rejects(first,error=>error.staleIdentity===true);
  assert.equal(h.ctx.LT.Admin.player.id,PLAYER_B.id);
  assert.equal(JSON.parse(storage.get('pachi-player-identity-v1')).token,TOKEN_B);
});

test('fresh sync waits for a new config read after the running pass',async()=>{
  const old=deferred();let reads=0;
  const grant=version=>({grantId:'admin-initial:'+PLAYER_A.id,version});
  const h=harness({handle:c=>{
    if(c.path==='/me'){reads++;return reads===1?old.promise:response({player:PLAYER_A,adminExists:true,grants:[grant(2)],nextCursor:null});}
  }});
  adopt(h);const first=h.api.sync();await until(()=>reads===1);
  const fresh=h.api.sync({fresh:true});old.resolve(response({player:PLAYER_A,adminExists:true,grants:[grant(1)],nextCursor:null}));
  await Promise.all([first,fresh]);assert.equal(reads,2);assert.equal(h.updated.at(-1).version,2);
});

test('deferred administrator stat updates contribute to pending count',async()=>{
  const h=harness({bridge:{updateOwnedFuto:()=>({ok:false,pending:true})},handle:c=>c.path==='/me'?response({player:PLAYER_A,adminExists:true,grants:[{grantId:'admin-initial:'+PLAYER_A.id}],nextCursor:null}):null});
  adopt(h);await h.api.sync();assert.equal(h.ctx.LT.Admin.pending,1);
});

const LEGENDARY={grantId:'admin-legendary:'+PLAYER_A.id,species:'arvelion',level:70};
test('administrator initial companion is processed once across inbox pages',async()=>{
  const h=harness({settings:true,handle:c=>c.path==='/me'?response({player:PLAYER_A,adminExists:true,grants:[],initialCompanions:[LEGENDARY],nextCursor:c.search.includes('cursor=')?null:42}):null});
  adopt(h);await h.api.sync();
  assert.equal(h.initial.length,1);assert.equal(h.initial[0].species,'arvelion');
  assert.equal(h.applied.length,0,'Initial companion must not pass through Futo distribution');
  assert.equal(h.ctx.LT.Admin.pending,0);assert.equal(h.toasts.length,0,'Previously received members produce no new toast');
  assert(h.serviceBody.innerHTML.includes('初期メンバー'));
  assert(!h.calls.some(c=>c.path==='/admin/grants'),'Initial ownership must never send a distribution request');
});

test('deferred initial companion retries and successful receipt is announced only once',async()=>{
  let phase='battle',calls=0;
  const h=harness({settings:true,bridge:{receiveAdminLegendary:()=>{calls++;if(phase==='battle')return{ok:false,pending:true};if(phase==='ready'){phase='received';return{ok:true};}return{ok:true,alreadyReceived:true};}},handle:c=>c.path==='/me'?response({player:PLAYER_A,adminExists:true,grants:[],initialCompanions:[LEGENDARY],nextCursor:null}):null});
  adopt(h);await h.api.sync();assert.equal(h.ctx.LT.Admin.pending,1);assert.equal(h.toasts.length,0);
  assert(h.serviceBody.innerHTML.includes('受け取り待ちの仲間：1体'));
  phase='ready';await h.api.sync();assert.equal(h.ctx.LT.Admin.pending,0);assert.equal(h.toasts.length,1);
  assert(h.toasts[0].includes('初期メンバーにアルヴェリオン'));
  await h.api.sync();assert.equal(calls,3);assert.equal(h.toasts.length,1);
});

test('nonadministrators and mismatched initial companion ownership are rejected',async()=>{
  let currentPlayer=PLAYER_B;
  const h=harness({handle:c=>c.path==='/me'?response({player:currentPlayer,adminExists:true,grants:[],initialCompanions:[LEGENDARY,{...LEGENDARY,grantId:'admin-legendary:'+PLAYER_B.id}],nextCursor:null}):null});
  adopt(h,TOKEN_B,PLAYER_B);await h.api.sync();assert.equal(h.initial.length,0);
  currentPlayer={...PLAYER_B,isAdmin:true};await h.api.sync();
  assert.equal(h.initial.length,1);assert.equal(h.initial[0].grantId,'admin-legendary:'+PLAYER_B.id);
});

test('stale administrator identity cannot receive a delayed initial companion',async()=>{
  const old=deferred();
  const h=harness({handle:c=>c.path==='/me'&&c.token===TOKEN_A?old.promise:null});
  adopt(h);const first=h.api.sync();await until(()=>h.calls.some(c=>c.path==='/me'));
  adopt(h,TOKEN_B,PLAYER_B);const fresh=h.api.sync({fresh:true});
  old.resolve(response({player:PLAYER_A,adminExists:true,grants:[],initialCompanions:[LEGENDARY],nextCursor:null}));
  await Promise.all([first,fresh]);assert.equal(h.initial.length,0);
});

test('initial companion receipt survives reload only after its save succeeds',()=>{
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
  const ctx=vm.createContext({console});
  for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
    vm.runInContext(script[2],ctx);
    if(ctx.LT?.Engine)break;
  }
  const engine=new ctx.LT.Engine();engine.newGame(ctx.LT.DATA.starters[0]);
  let failWrite=true,saved=null,writes=0,events=0;
  Object.assign(ctx,{tradeLocked:()=>false,Engine:ctx.LT.Engine,engine,playing:true,busy:false,storedSave:engine.serialize(),SAVE_KEY:'test-save',lastSave:0,
    localStorage:{setItem:(key,value)=>{if(failWrite)throw Error('Storage full');saved=value;writes++;}},
    performance:{now:()=>100},updateAll(){},loadStored(){},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},
    document:{dispatchEvent:()=>events++}});
  const start=html.indexOf('  function persistGiftMutation(method,...args){');
  const end=html.indexOf('  LT.playMoveSound=',start);
  assert(start>0&&end>start);vm.runInContext(html.slice(start,end),ctx);
  assert.equal(ctx.persistGiftMutation('receiveAdminLegendary',LEGENDARY).pending,true);
  assert.equal(engine.state.party.length,1);assert.equal(engine.state.giftReceipts.length,0);assert.equal(events,0);
  failWrite=false;
  assert.equal(ctx.persistGiftMutation('receiveAdminLegendary',LEGENDARY).ok,true);
  assert.equal(engine.state.party.filter(mon=>mon.species==='arvelion').length,1);
  assert.equal(writes,1);assert.equal(events,1);
  assert.equal(ctx.persistGiftMutation('receiveAdminLegendary',LEGENDARY).alreadyReceived,true);
  assert.equal(writes,1);assert.equal(events,1);
  const reloaded=new ctx.LT.Engine(JSON.parse(saved));
  assert.equal(reloaded.receiveAdminLegendary(LEGENDARY).alreadyReceived,true);
  assert.equal(reloaded.state.party.filter(mon=>mon.species==='arvelion').length,1);
});

test('one in-flight send, and an uncertain send survives reload with its original id',async()=>{
  const sent=deferred();const storage=new Map();
  const h=harness({storage,handle:c=>c.path==='/admin/grants'?sent.promise:null});adopt(h);
  h.api.prepareGrant('all',CONFIG);const original=h.api.pendingGrant.grant.requestId;
  const first=h.api.submitPendingGrant();await until(()=>h.calls.some(c=>c.path==='/admin/grants'));
  assert.equal(await h.api.submitPendingGrant(),null);
  assert.throws(()=>h.api.prepareGrant('self',CONFIG));
  assert.equal(h.calls.filter(c=>c.path==='/admin/grants').length,1);
  sent.reject(new Error('Network response lost'));await assert.rejects(first,/同じ内容/);
  assert.equal(h.api.pendingGrant.uncertain,true);
  const restarted=harness({storage,handle:c=>c.path==='/admin/grants'?response({recipientCount:4,replayed:true}):null});
  adopt(restarted);restarted.api.resumePending();assert.equal(restarted.api.pendingGrant.grant.requestId,original);
  assert.throws(()=>restarted.api.prepareGrant('all',CONFIG));
  const result=await restarted.api.submitPendingGrant();assert.equal(result.replayed,true);
  assert.equal(restarted.calls.find(c=>c.path==='/admin/grants').body.requestId,original);
  assert.equal(restarted.api.pendingGrant,null);assert.equal(storage.has('pachi-pending-distribution-v1'),false);
});


test('recovery status survives registration, paginated me reads and identity restoration',async()=>{
  const h=harness({handle:c=>{
    if(c.path==='/status')return response({adminExists:true,adminRecoveryAvailable:true});
    if(c.path==='/register')return response({player:PLAYER_B,adminExists:true,adminRecoveryAvailable:true});
    if(c.path==='/me')return response({player:PLAYER_B,adminExists:true,adminRecoveryAvailable:true,grants:[],nextCursor:null});
  }});
  await h.api.sync({register:true});
  assert.equal(h.api.status.adminRecoveryAvailable,true);
  h.api.adoptIdentity({token:TOKEN_A,id:PLAYER_A.id,name:PLAYER_A.name},PLAYER_A,true,false);
  assert.equal(h.api.status.adminRecoveryAvailable,false,'Restored identity must use its fresh server flags');
});

test('key input requires an authenticated player and explicit unregistered status',()=>{
  const h=harness({settings:true});
  h.api.refreshSettings();assert(!h.serviceBody.innerHTML.includes('id="pachi-admin-key"'));
  for(const [exists,recovery] of [[true,false],[true,true],[undefined,true]]){
    h.api.adoptIdentity({token:TOKEN_B,id:PLAYER_B.id,name:PLAYER_B.name},PLAYER_B,exists,recovery);h.api.refreshSettings();
    assert(!h.serviceBody.innerHTML.includes('id="pachi-admin-key"'));
    assert(!h.serviceBody.innerHTML.includes('運営を再登録'));
  }
  h.api.adoptIdentity({token:TOKEN_B,id:PLAYER_B.id,name:PLAYER_B.name},PLAYER_B,false,true);h.api.refreshSettings();
  assert(h.serviceBody.innerHTML.includes('id="pachi-admin-key"'));assert(h.serviceBody.innerHTML.includes('type="password"'));
  h.keyField.value='never-keep-this-key';
  h.api.adoptIdentity({token:TOKEN_B,id:PLAYER_B.id,name:PLAYER_B.name},PLAYER_B,true,true);h.api.refreshSettings();
  assert.equal(h.keyField.value,'');assert(!h.serviceBody.innerHTML.includes('id="pachi-admin-key"'));
  h.api.adoptIdentity({token:TOKEN_A,id:PLAYER_A.id,name:PLAYER_A.name},PLAYER_A,true,true);h.api.refreshSettings();
  assert(h.serviceBody.innerHTML.includes('運営として登録済み'));assert(!h.serviceBody.innerHTML.includes('id="pachi-admin-key"'));
});

test('repeated refresh taps never expose recovery or send a claim while registered',async()=>{
  const h=harness({settings:true,handle:c=>{
    if(c.path==='/status')return response({adminExists:true,adminRecoveryAvailable:true});
    if(c.path==='/me')return response({player:PLAYER_B,adminExists:true,adminRecoveryAvailable:true,grants:[],nextCursor:null});
  }});
  h.api.adoptIdentity({token:TOKEN_B,id:PLAYER_B.id,name:PLAYER_B.name},PLAYER_B,true,true);h.api.refreshSettings();
  for(let i=0;i<24;i++){h.clock.now+=100;h.press('refresh');}
  await h.api.sync();
  assert(!h.serviceBody.innerHTML.includes('id="pachi-admin-key"'));
  h.keyField.value='hidden-key';await h.api.claim({disabled:false,isConnected:true});
  assert.equal(h.calls.filter(c=>c.path==='/admin/claim').length,0);
});

test('background registration and release refreshes hide and restore the key form',async()=>{
  let exists=false;
  const h=harness({settings:true,handle:c=>{
    if(c.path==='/status')return response({adminExists:exists,adminRecoveryAvailable:true});
    if(c.path==='/me')return response({player:PLAYER_B,adminExists:exists,grants:[],nextCursor:null});
  }});
  h.api.adoptIdentity({token:TOKEN_B,id:PLAYER_B.id,name:PLAYER_B.name},PLAYER_B,false);await h.api.sync();
  assert(h.serviceBody.innerHTML.includes('id="pachi-admin-key"'));h.keyField.value='typed-key';
  exists=true;await h.api.sync();assert(!h.serviceBody.innerHTML.includes('id="pachi-admin-key"'));assert.equal(h.keyField.value,'');
  exists=false;await h.api.sync();assert(h.serviceBody.innerHTML.includes('id="pachi-admin-key"'));assert.equal(h.keyField.value,'');
});

test('unavailable status removes a previously visible key input',async()=>{
  const h=harness({settings:true,handle:c=>c.path==='/status'?Promise.reject(new Error('offline')):null});
  h.api.adoptIdentity({token:TOKEN_B,id:PLAYER_B.id,name:PLAYER_B.name},PLAYER_B,false);h.api.refreshSettings();h.keyField.value='typed-key';
  await h.api.sync();assert.equal(h.api.status,null);assert(!h.serviceBody.innerHTML.includes('id="pachi-admin-key"'));assert.equal(h.keyField.value,'');
});

test('normal registration sends once and clears the key after success',async()=>{
  const claimed=deferred(),newAdmin={...PLAYER_B,isAdmin:true};let complete=false,consoleOpened=0;
  const h=harness({settings:true,handle:c=>{
    if(c.path==='/admin/claim')return claimed.promise;
    if(c.path==='/status')return response({adminExists:complete});
    if(c.path==='/me')return response({player:complete?newAdmin:PLAYER_B,adminExists:complete,grants:[],nextCursor:null});
  }});
  h.api.adoptIdentity({token:TOKEN_B,id:PLAYER_B.id,name:PLAYER_B.name},PLAYER_B,false);h.api.refreshSettings();
  h.api.stubConsole(async()=>{consoleOpened++;});h.keyField.value='registration-test-key';
  const button={disabled:false,isConnected:true},first=h.api.claim(button);
  await until(()=>h.calls.some(c=>c.path==='/admin/claim'));await h.api.claim(button);
  assert.equal(h.calls.filter(c=>c.path==='/admin/claim').length,1);assert.equal(h.api.claimBusy,true);
  assert.deepEqual({...h.calls.find(c=>c.path==='/admin/claim').body},{key:'registration-test-key'});
  complete=true;claimed.resolve(response({player:newAdmin,adminExists:true,adminRecoveryAvailable:false}));await first;
  assert.equal(h.keyField.value,'');assert.equal(h.api.claimBusy,false);assert.equal(h.ctx.LT.Admin.player.isAdmin,true);assert.equal(consoleOpened,1);
  assert(!h.serviceBody.innerHTML.includes('id="pachi-admin-key"'));
});

test('claim rechecks occupancy before sending a key and rejects stale empty state',async()=>{
  const h=harness({settings:true,handle:c=>{
    if(c.path==='/status')return response({adminExists:true});
    if(c.path==='/me')return response({player:PLAYER_B,adminExists:true,grants:[],nextCursor:null});
  }});
  h.api.adoptIdentity({token:TOKEN_B,id:PLAYER_B.id,name:PLAYER_B.name},PLAYER_B,false);h.api.refreshSettings();h.keyField.value='typed-key';
  await h.api.claim({disabled:false,isConnected:true});
  assert.equal(h.calls.filter(c=>c.path==='/admin/claim').length,0);assert.equal(h.keyField.value,'');assert(!h.serviceBody.innerHTML.includes('id="pachi-admin-key"'));
});

function attachOwnerConsole(h,claimedAt=1234){
  const box={hidden:true,innerHTML:''},cancel={disabled:false,focused:false,focus(){this.focused=true;}},confirm={disabled:false};
  const dialog={open:true,closed:0,querySelector:selector=>selector==='#pachi-release-review'?box:selector==='[data-admin-action="release-cancel"]'?cancel:selector==='.pachi-status'?h.statusLine:null,
    querySelectorAll:()=>[cancel,confirm],close(){this.open=false;this.closed++;}};
  h.api.attachConsole(dialog,{playerId:PLAYER_A.id,claimedAt});return {box,cancel,confirm,dialog};
}

test('release review defaults to cancel and cancellation has no server mutation',async()=>{
  const h=harness({settings:true});adopt(h);const view=attachOwnerConsole(h);
  h.api.prepareRelease();assert.equal(view.box.hidden,false);assert(view.box.innerHTML.includes('運営キーの入力欄'));assert(view.cancel.focused);
  const button={dataset:{adminAction:'release-cancel'},disabled:false,isConnected:true};await h.api.handleConsole({target:{closest:()=>button}});
  assert.equal(view.box.hidden,true);assert.equal(h.api.releaseReview,null);assert.equal(h.calls.length,0);assert(view.dialog.open);
  adopt(h,TOKEN_B,PLAYER_B);assert.throws(()=>h.api.prepareRelease());
});

test('confirmed owner release sends once, removes ownership and restores the empty-seat form',async()=>{
  const released=deferred();let complete=false;
  const h=harness({settings:true,handle:c=>{
    if(c.path==='/admin/release')return released.promise;
    if(c.path==='/status')return response({adminExists:!complete});
    if(c.path==='/me')return response({player:{...PLAYER_A,isAdmin:!complete},adminExists:!complete,grants:[],nextCursor:null});
  }});
  adopt(h);const view=attachOwnerConsole(h);h.api.prepareRelease();const first=h.api.releaseAdmin();await until(()=>h.calls.some(c=>c.path==='/admin/release'));
  assert.equal(h.api.releaseBusy,true);assert(view.cancel.disabled);await h.api.releaseAdmin();assert.equal(h.calls.filter(c=>c.path==='/admin/release').length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.find(c=>c.path==='/admin/release').body)),{confirmed:true,expectedRegistration:{playerId:PLAYER_A.id,claimedAt:1234}});
  complete=true;released.resolve(response({released:true,player:{...PLAYER_A,isAdmin:false},adminExists:false}));await first;
  assert.equal(h.api.releaseBusy,false);assert.equal(h.ctx.LT.Admin.player.isAdmin,false);assert.equal(h.api.releaseReview,null);assert.equal(view.dialog.open,false);
  assert(h.serviceBody.innerHTML.includes('id="pachi-admin-key"'));
});

test('identity changes discard release confirmation and uncertain gifts block release',async()=>{
  const h=harness({settings:true});adopt(h);attachOwnerConsole(h);h.api.prepareRelease();
  adopt(h,TOKEN_B,PLAYER_B);await h.api.releaseAdmin();assert(!h.calls.some(c=>c.path==='/admin/release'));
  adopt(h);attachOwnerConsole(h);h.api.prepareGrant('all',CONFIG);h.api.pendingGrant.uncertain=true;
  assert.throws(()=>h.api.prepareRelease(),/配布結果/);
});

test('a delayed old-owner profile cannot restore the role after release',async()=>{
  const stale=deferred();let reads=0,complete=false;
  const h=harness({settings:true,handle:c=>{
    if(c.path==='/admin/release'){complete=true;return response({released:true,player:{...PLAYER_A,isAdmin:false},adminExists:false});}
    if(c.path==='/status')return response({adminExists:!complete});
    if(c.path==='/me')return reads++===0?stale.promise:response({player:{...PLAYER_A,isAdmin:false},adminExists:false,grants:[],nextCursor:null});
  }});
  adopt(h);attachOwnerConsole(h);h.api.prepareRelease();const oldSync=h.api.sync();await until(()=>h.calls.some(c=>c.path==='/me'));
  const releasing=h.api.releaseAdmin();await until(()=>h.calls.some(c=>c.path==='/admin/release'));
  await until(()=>h.ctx.LT.Admin.player.isAdmin===false);
  stale.resolve(response({player:PLAYER_A,adminExists:true,grants:[],nextCursor:null}));await Promise.all([oldSync,releasing]);
  assert.equal(h.ctx.LT.Admin.player.isAdmin,false);assert(h.serviceBody.innerHTML.includes('id="pachi-admin-key"'));
});

test('legendary signature moves are excluded from Futo configuration choices',()=>{
  const h=harness();
  Object.assign(h.ctx.LT.DATA,{legendary:{species:'arvelion'},mythical:{species:'floravelle'},species:{arvelion:{moves:['arvelion_rend']},floravelle:{moves:['verdant_lance']}}});
  Object.assign(h.ctx.LT.DATA.moves,{arvelion_rend:{name:'星環裂爪'},verdant_lance:{name:'翠天の槍'},struggle:{name:'苦しまぎれ'}});
  const choices=Array.from(h.api.futoMoveEntries(),entry=>entry[0]);
  assert(!choices.includes('arvelion_rend'));assert(!choices.includes('verdant_lance'));assert(!choices.includes('struggle'));
  assert(choices.includes(CONFIG.moves[0]));
});


test('only current-owner mythical entitlements are delivered, once per sync',async()=>{
  const mythical={grantId:'admin-mythical:'+PLAYER_A.id,species:'floravelle',level:70};let admin=true;
  const h=harness({handle:c=>c.path==='/me'?response({player:{...PLAYER_A,isAdmin:admin},adminExists:true,grants:[],initialCompanions:[mythical,mythical,{...mythical,grantId:'admin-mythical:'+PLAYER_B.id}],nextCursor:null}):null});
  adopt(h);await h.api.sync();assert.equal(h.initial.length,1);assert.equal(h.initial[0].species,'floravelle');
  admin=false;await h.api.sync();assert.equal(h.initial.length,1);
});


test('secret encounter authorization refreshes current role and rejects revocation',async()=>{
  let allowed=true;
  const h=harness({handle:c=>c.path==='/me'?response({player:{...PLAYER_A,isAdmin:allowed},adminExists:true,grants:[],initialCompanions:[],nextCursor:null}):null});
  adopt(h);
  assert.equal((await h.ctx.LT.Admin.authorizeSecretEncounter()).id,PLAYER_A.id);
  assert(h.calls.some(c=>c.path==='/me'&&c.search==='?limit=1'));
  allowed=false;await assert.rejects(h.ctx.LT.Admin.authorizeSecretEncounter(),/現在の運営/);
  assert.equal(h.ctx.LT.Admin.player.isAdmin,false);
});

test('secret encounter authorization cannot complete under a restored identity',async()=>{
  const pending=deferred();
  const h=harness({handle:c=>c.path==='/me'?pending.promise:null});adopt(h);
  const attempt=h.ctx.LT.Admin.authorizeSecretEncounter();
  await until(()=>h.calls.some(c=>c.path==='/me'));adopt(h,TOKEN_B,PLAYER_B);
  pending.resolve(response({player:PLAYER_A,adminExists:true}));
  await assert.rejects(attempt,error=>error.staleIdentity===true);
  assert.equal(h.ctx.LT.Admin.player.id,PLAYER_B.id);
});
