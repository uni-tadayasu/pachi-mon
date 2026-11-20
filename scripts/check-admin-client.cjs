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
const apiError=(status,code,message=code)=>({ok:false,status,json:async()=>({ok:false,error:{code,message}})});
async function until(check){for(let i=0;i<100;i++){if(check())return;await Promise.resolve();}assert.fail('Expected asynchronous step was not reached');}
function harness({storage=new Map(),handle=()=>null,bridge={},settings=false}={}){
  const calls=[],applied=[],updated=[],initial=[],toasts=[],listeners={},emitted=[],clock={now:1_000_000};
  const serviceBody={dataset:{},innerHTML:''},statusLine={dataset:{},textContent:''},keyField={value:'',focus(){}};
  const serviceRoot={querySelector:selector=>selector==='[data-service-body]'?serviceBody:selector==='.pachi-status'?statusLine:null};
  const settingsContent={querySelector:selector=>selector==='#pachi-service'?serviceRoot:selector==='.pachi-status'?statusLine:null};
  const element=id=>!settings?null:id==='modal-title'?{textContent:'冒険の設定'}:id==='modal-content'?settingsContent:id==='pachi-admin-key'&&serviceBody.innerHTML.includes('id="pachi-admin-key"')?keyField:null;
  const hooks=`globalThis.__test={sync,ensureIdentity,adoptIdentity,restoreAdminReserveTeam,restoreAdminReserveAddition,adoptReserveTeam,renderAdminReserveTeam,get reserveTeam(){return reserveTeam;},get reserveAddition(){return reserveAddition;},get reserveBusy(){return reserveBusy;},prepareGrant,submitPendingGrant,loadPendingGrant,refreshSettings,claim,prepareRelease,releaseAdmin,handleConsole,futoMoveEntries,loadAdminDevices,renderAdminDevices,prepareDeviceGrant,prepareDeviceRevoke,confirmDeviceChange,get adminDevices(){return adminDevices;},get deviceReview(){return deviceReview;},get deviceBusy(){return deviceBusy;},attachConsole(dialog,registration){consoleDialog=dialog;adminRegistration=registration;},get releaseReview(){return releaseReview;},get releaseBusy(){return releaseBusy;},get status(){return status;},get claimBusy(){return claimBusy;},stubConsole(fn){openConsole=fn;},resumePending(){pendingGrant=loadPendingGrant();},get pendingGrant(){return pendingGrant;}};`;
  let source=fs.readFileSync(require.resolve('../admin-console.js'),'utf8');
  assert(source.includes('mountSettings();void sync();'));
  source=source.replace('mountSettings();void sync();',hooks);
  const ctx={console,crypto:webcrypto,AbortController,URL,Blob,btoa,atob,CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,
    addEventListener:(type,fn)=>{(listeners[type]||=[]).push(fn);},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    MutationObserver:class{observe(){}},
    document:{getElementById:element,addEventListener:(type,fn)=>{(listeners[type]||=[]).push(fn);},dispatchEvent:event=>{emitted.push(event);for(const fn of listeners[event.type]||[])fn(event);},hidden:false},
    Date:class extends Date{static now(){return clock.now;}},
    LT:{DATA:{moves:Object.fromEntries(CONFIG.moves.map(id=>[id,{name:id}]))},adminBridge:{
      getEngine:()=>null,getPlayerName:()=> 'Traveller',toast:message=>toasts.push(message),
      grantFuto:g=>{applied.push(g);return{ok:true,alreadyReceived:true};},
      receiveAdminLegendary:g=>{initial.push(g);return{ok:true,alreadyReceived:true};},
      receiveAdminMythical:g=>{initial.push(g);return{ok:true,alreadyReceived:true};},
      updateOwnedFuto:(id,g)=>{updated.push(g);return{ok:true};},...bridge}},
    fetch:async(url,options)=>{
      const call={path:new URL(url).pathname.replace('/api',''),search:new URL(url).search,method:options.method,token:options.headers.Authorization?.replace('Bearer ',''),body:options.body?JSON.parse(options.body):undefined};calls.push(call);
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
  const emitStorage=event=>{for(const fn of listeners.storage||[])fn({storageArea:ctx.localStorage,...event});};
  const changeIdentity=raw=>{const key='pachi-player-identity-v1',oldValue=storage.get(key)||null;if(raw===null)storage.delete(key);else storage.set(key,raw);emitStorage({key,newValue:raw,oldValue});};
  return{ctx,api:ctx.__test,calls,applied,updated,initial,toasts,storage,serviceBody,statusLine,keyField,press,clock,emitStorage,changeIdentity,emitted};
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

test('cross-tab identity changes use the new token and reject old world responses without trusting cached roles',async()=>{
  const old=deferred();
  const h=harness({handle:c=>c.path==='/world/presence'?(c.token===TOKEN_A?old.promise:response({self:{id:PLAYER_B.id,isAdmin:false}})):null});
  adopt(h);
  const request=h.ctx.LT.Admin.worldRequest('/world/presence',{method:'POST',body:{}});
  await until(()=>h.calls.some(c=>c.path==='/world/presence'));
  let closed=0;const dialog={open:true,close(){closed++;this.open=false;}};h.api.attachConsole(dialog,{playerId:PLAYER_A.id,claimedAt:1});
  const raw=JSON.stringify({token:TOKEN_B,id:PLAYER_A.id,name:'fake cached name',isAdmin:true});
  h.changeIdentity(raw);
  assert.equal(h.ctx.LT.Admin.player,null);assert.equal(closed,1);
  assert.equal(h.storage.get('pachi-player-identity-v1'),raw,'The storage event must not echo old identity data back to disk');
  await h.api.ensureIdentity();await until(()=>h.ctx.LT.Admin.player?.id===PLAYER_B.id);
  old.resolve(response({self:{id:PLAYER_A.id,isAdmin:true}}));
  await assert.rejects(request,error=>error.staleIdentity===true);
  await h.ctx.LT.Admin.worldRequest('/world/presence',{method:'POST',body:{}});
  assert.equal(h.calls.filter(c=>c.path==='/world/presence').at(-1).token,TOKEN_B);
  assert.equal(h.ctx.LT.Admin.player.isAdmin,false);assert.equal(h.ctx.LT.Admin.player.name,PLAYER_B.name);
  assert.equal(JSON.parse(h.storage.get('pachi-player-identity-v1')).token,TOKEN_B);
});

test('cross-tab switch discards old pagination and registration writes',async()=>{
  const oldPage=deferred(),h=harness({handle:c=>c.path==='/me'&&c.token===TOKEN_A?oldPage.promise:null});
  adopt(h);const first=h.api.sync();await until(()=>h.calls.some(c=>c.path==='/me'));
  h.changeIdentity(JSON.stringify({token:TOKEN_B,name:'B'}));
  oldPage.resolve(response({player:PLAYER_A,adminExists:true,grants:[{grantId:'old-player-gift'}],initialCompanions:[{grantId:'admin-legendary:'+PLAYER_A.id,species:'arvelion',level:70}],nextCursor:42}));
  await first;await until(()=>h.ctx.LT.Admin.player?.id===PLAYER_B.id);
  assert.equal(h.applied.length,0);assert.equal(h.initial.length,0);
  assert(!h.calls.some(c=>c.path==='/me'&&c.token===TOKEN_A&&c.search.includes('cursor=')));

  const oldRegister=deferred(),storage=new Map([['pachi-player-identity-v1',JSON.stringify({token:TOKEN_A,name:'A'})]]);
  const second=harness({storage,handle:c=>c.path==='/register'&&c.body.token===TOKEN_A?oldRegister.promise:null});
  const pending=second.api.ensureIdentity();await until(()=>second.calls.some(c=>c.path==='/register'));
  second.changeIdentity(JSON.stringify({token:TOKEN_B,name:'B'}));
  await second.api.ensureIdentity();oldRegister.resolve(response({player:PLAYER_A,adminExists:true}));
  await assert.rejects(pending,error=>error.staleIdentity===true);
  assert.equal(second.ctx.LT.Admin.player.id,PLAYER_B.id);assert.equal(JSON.parse(storage.get('pachi-player-identity-v1')).token,TOKEN_B);
});

test('cross-tab metadata refresh is server-authoritative and malformed or superseded events are ignored',async()=>{
  const h=harness();adopt(h);
  for(const raw of ['not JSON',JSON.stringify({token:[TOKEN_B],isAdmin:true}),JSON.stringify({token:'weak'}),JSON.stringify([TOKEN_B])]){
    h.changeIdentity(raw);assert.equal(h.ctx.LT.Admin.player.id,PLAYER_A.id);assert.equal(h.storage.get('pachi-player-identity-v1'),raw);assert.equal(h.calls.length,0);
  }
  const metadata=JSON.stringify({token:TOKEN_A,id:PLAYER_B.id,name:'Forged',isAdmin:false});
  h.changeIdentity(metadata);await h.api.sync({fresh:true});
  assert.equal(h.ctx.LT.Admin.player.id,PLAYER_A.id);assert.equal(h.ctx.LT.Admin.player.name,PLAYER_A.name);assert.equal(h.ctx.LT.Admin.player.isAdmin,true);
  assert.equal(h.storage.get('pachi-player-identity-v1'),metadata);assert(!h.calls.some(c=>c.path==='/register'));
  const count=h.calls.length;h.storage.set('pachi-player-identity-v1',metadata);
  h.emitStorage({key:'pachi-player-identity-v1',newValue:JSON.stringify({token:TOKEN_B,name:'B'})});
  assert.equal(h.calls.length,count);assert.equal(h.ctx.LT.Admin.player.id,PLAYER_A.id);
});

test('removing identity in another tab retires its token without writing a replacement',async()=>{
  const old=deferred(),h=harness({handle:c=>c.path==='/world/presence'?old.promise:null});adopt(h);
  const pending=h.ctx.LT.Admin.worldRequest('/world/presence',{method:'POST',body:{}});await until(()=>h.calls.length===1);
  h.changeIdentity(null);assert.equal(h.ctx.LT.Admin.player,null);assert.equal(h.storage.has('pachi-player-identity-v1'),false);assert.equal(h.calls.length,1);
  old.resolve(response({self:{id:PLAYER_A.id,isAdmin:true}}));await assert.rejects(pending,error=>error.staleIdentity===true);
  assert.equal(h.ctx.LT.Admin.player,null);assert.equal(h.storage.has('pachi-player-identity-v1'),false);
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
  let failWrite=true,saved=null,writes=0;const events=[];
  Object.assign(ctx,{tradeLocked:()=>false,rankedLocked:()=>false,Engine:ctx.LT.Engine,engine,playing:true,busy:false,storedSave:engine.serialize(),SAVE_KEY:'test-save',lastSave:0,
    localStorage:{setItem:(key,value)=>{if(failWrite)throw Error('Storage full');saved=value;writes++;}},
    performance:{now:()=>100},updateAll(){},loadStored(){},
    CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},
    document:{dispatchEvent:event=>events.push(event)}});
  const start=html.indexOf('  function persistGiftMutation(method,...args){');
  const end=html.indexOf('  LT.playMoveSound=',start);
  assert(start>0&&end>start);vm.runInContext(html.slice(start,end),ctx);
  assert.equal(ctx.persistGiftMutation('receiveAdminLegendary',LEGENDARY).pending,true);
  assert.equal(engine.state.party.length,1);assert.equal(engine.state.giftReceipts.length,0);assert.equal(events.length,0);
  failWrite=false;
  assert.equal(ctx.persistGiftMutation('receiveAdminLegendary',LEGENDARY).ok,true);
  assert.equal(engine.state.party.filter(mon=>mon.species==='arvelion').length,1);
  assert.equal(writes,1);assert.deepEqual(events.map(event=>event.type),['pachi-party-changed','pachi-gift-received']);assert.equal(events[1].detail.grantId,LEGENDARY.grantId);
  assert.equal(ctx.persistGiftMutation('receiveAdminLegendary',LEGENDARY).alreadyReceived,true);
  assert.equal(writes,1);assert.equal(events.length,2);
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

test('fresh challenge identity rechecks the current server role and announces no credentials or gifts',async()=>{
  const h=harness({handle:c=>c.path==='/me'?response({player:{...PLAYER_A,isAdmin:false},adminExists:true,grants:[{grantId:'read-only-gift'}],initialCompanions:[LEGENDARY]}):null});adopt(h);
  assert.equal((await h.ctx.LT.Admin.tradeIdentity()).isAdmin,true);assert.equal(h.calls.length,0);
  const fresh=await h.ctx.LT.Admin.tradeIdentity({fresh:true});assert.equal(fresh.isAdmin,false);assert.equal(h.ctx.LT.Admin.player.isAdmin,false);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/me');assert.equal(h.calls[0].search,'?limit=1');
  assert.equal(h.applied.length,0);assert.equal(h.initial.length,0);
  const event=h.emitted.findLast(event=>event.type==='pachi-admin-state');assert(event);assert.deepEqual(JSON.parse(JSON.stringify(event.detail)),{id:PLAYER_A.id,isAdmin:false});
  assert(!JSON.stringify(h.emitted).includes(TOKEN_A));
});

test('fresh challenge identity cannot restore an old player after a token switch',async()=>{
  const pending=deferred(),h=harness({handle:c=>c.path==='/me'?pending.promise:null});adopt(h);
  const attempt=h.ctx.LT.Admin.tradeIdentity({fresh:true});await until(()=>h.calls.some(c=>c.path==='/me'));adopt(h,TOKEN_B,PLAYER_B);
  pending.resolve(response({player:PLAYER_A,adminExists:true}));await assert.rejects(attempt,error=>error.staleIdentity===true);
  assert.equal(h.ctx.LT.Admin.player.id,PLAYER_B.id);assert.equal(h.ctx.LT.Admin.player.isAdmin,false);
});

test('world client allows the roster and population endpoints and rejects invalid targets before authentication',async()=>{
  const h=harness({handle:c=>c.path.startsWith('/world/')?response({updatedAt:1,party:c.body?.party,total:1}):null});
  for(const path of ['/world/kasai/party/other','/world/kasai/party?owner=another','/world/population/other','/admin/config','https://example.test/world/kasai/party'])await assert.rejects(h.ctx.LT.Admin.worldRequest(path),/指定が正しく/);
  assert.equal(h.calls.length,0);adopt(h);const party=[{uid:'one',species:'komori',level:5}];
  await h.ctx.LT.Admin.worldRequest('/world/kasai/party',{method:'POST',body:{party}});
  await h.ctx.LT.Admin.worldRequest('/world/population');
  assert.deepEqual(h.calls.map(call=>call.path),['/world/kasai/party','/world/population']);assert.deepEqual(h.calls[0].body,{party});assert(h.calls.every(call=>call.token===TOKEN_A));
});

test('global chat routes use the verified player token and reject unrelated queries before authentication',async()=>{
  const h=harness({handle:c=>c.path.startsWith('/world/chat')?response({messages:[],latestId:0}):null});
  for(const path of ['/world/chat/0','/world/chat/-1','/world/chat/1/other','/world/chat?room=private','/world/chat?summary=1&after=-2','/world/chat?summary=1&after=0&token=secret','https://example.test/world/chat'])await assert.rejects(h.ctx.LT.Admin.worldRequest(path),/指定が正しく/);
  assert.equal(h.calls.length,0);adopt(h);
  const body={clientId:'f74d60b0-0000-4000-8000-000000000001',text:'こんにちは'};
  await h.ctx.LT.Admin.worldRequest('/world/chat');
  await h.ctx.LT.Admin.worldRequest('/world/chat?summary=1&after=0');
  await h.ctx.LT.Admin.worldRequest('/world/chat',{method:'POST',body});
  await h.ctx.LT.Admin.worldRequest('/world/chat/12',{method:'DELETE'});
  assert.deepEqual(h.calls.map(c=>c.path+c.search),['/world/chat','/world/chat?summary=1&after=0','/world/chat','/world/chat/12']);
  assert.deepEqual(h.calls.map(c=>c.method),['GET','GET','POST','DELETE']);
  assert.deepEqual(h.calls[2].body,body);assert(h.calls.every(c=>c.token===TOKEN_A));
});

test('manual roster update checks readiness before saving and saves before forced synchronization',async()=>{
  const sequence=[],h=harness({bridge:{canSyncKasaiParty:()=>false,saveNow:()=>{sequence.push('save');return true;}}});adopt(h);attachOwnerConsole(h);
  h.ctx.LT.KasaiParty={sync:async options=>{sequence.push('sync');assert.equal(options.force,true);return {ok:true,message:'Roster updated'};}};
  const click=()=>h.api.handleConsole({target:{closest:()=>({dataset:{adminAction:'sync-kasai-party'},disabled:false,isConnected:true})}});
  await click();assert.deepEqual(sequence,[]);assert.match(h.statusLine.textContent,/再読み込み|更新/);
  h.ctx.LT.adminBridge.canSyncKasaiParty=()=>true;await click();assert.deepEqual(sequence,['save','sync']);assert.equal(h.statusLine.textContent,'Roster updated');
  h.ctx.LT.adminBridge.saveNow=()=>false;await click();assert.deepEqual(sequence,['save','sync'],'A failed save cannot publish unsaved monsters');
});

test('owner decoration button closes management before opening the room editor',async()=>{
  let playing=false,decorations=0;const h=harness({bridge:{isPlaying:()=>playing}});adopt(h);const view=attachOwnerConsole(h);
  h.ctx.LT.Rooms={decorateMine:async()=>{assert.equal(view.dialog.open,false);decorations++;return true;}};
  const click=()=>h.api.handleConsole({target:{closest:()=>({dataset:{adminAction:'decorate-room'},disabled:false,isConnected:true})}});
  await click();assert.equal(decorations,0);assert.equal(view.dialog.open,true);
  playing=true;await click();assert.equal(decorations,1);assert.equal(view.dialog.closed,1);
});

const MAIN_DEVICE={playerId:PLAYER_A.id,name:'メインの旅人',role:'main',claimedAt:1234};
const SUB_DEVICE={playerId:PLAYER_B.id,name:'サブの旅人',role:'sub',claimedAt:2345};
const PLAYER_C={id:'P'+'c'.repeat(16),name:'第三の旅人',isAdmin:false},TOKEN_C='C'.repeat(43);
const SUB_SUB_DEVICE={playerId:PLAYER_C.id,name:PLAYER_C.name,role:'sub-sub',claimedAt:3456};
const deviceData=(devices=[MAIN_DEVICE],canManageDevices=true)=>({devices,capacity:3,canManageDevices});
function attachDeviceConsole(h){
  const role={value:'',disabled:false},box={html:'',get innerHTML(){return this.html;},set innerHTML(html){this.html=html;role.value=(html.match(/<option value="(sub|sub-sub)" selected>/)||html.match(/<option value="(sub|sub-sub)"/))?.[1]||'';}},releaseBox={hidden:true,innerHTML:''},input={value:'',disabled:false};
  const cancel={disabled:false,focused:false,focus(){this.focused=true;}},confirm={disabled:false},existing={disabled:true};
  const dialog={open:true,closed:0,
    querySelector(selector){
      if(selector==='#pachi-admin-devices')return box;
      if(selector==='#pachi-release-review')return releaseBox;
      if(selector==='#pachi-device-player-id')return box.innerHTML.includes('id="pachi-device-player-id"')?input:null;
      if(selector==='#pachi-device-role')return box.innerHTML.includes('id="pachi-device-role"')?role:null;
      if(selector==='[data-admin-action="device-cancel"]'||selector==='[data-admin-action="release-cancel"]')return cancel;
      if(selector==='.pachi-status')return h.statusLine;
      return null;
    },querySelectorAll:()=>[input,role,cancel,confirm,existing],close(){this.open=false;this.closed++;}};
  h.api.attachConsole(dialog,{playerId:h.ctx.LT.Admin.player?.id,claimedAt:1234});
  const click=(action,extra={})=>h.api.handleConsole({target:{closest:()=>({dataset:{adminAction:action,...extra},disabled:false,isConnected:true})}});
  return{box,releaseBox,input,role,cancel,confirm,existing,dialog,click};
}

test('device registration lives only in the main console and disappears at capacity',async()=>{
  let devices=[MAIN_DEVICE];
  const h=harness({settings:true,handle:c=>c.path==='/admin/devices'?response(deviceData(devices)):null});
  adopt(h);h.api.refreshSettings();const view=attachDeviceConsole(h);await h.api.loadAdminDevices();
  assert(!h.serviceBody.innerHTML.includes('pachi-device-player-id'));assert(!h.serviceBody.innerHTML.includes('device-add-review'));
  assert(view.box.innerHTML.includes('id="pachi-device-player-id"'));assert(view.box.innerHTML.includes('登録済み 1 / 3台'));
  assert(view.box.innerHTML.includes('<option value="sub"'));assert(view.box.innerHTML.includes('<option value="sub-sub"'));
  devices=[MAIN_DEVICE,SUB_DEVICE];await h.api.loadAdminDevices();
  assert(view.box.innerHTML.includes('id="pachi-device-player-id"'));assert(!view.box.innerHTML.includes('<option value="sub"'));assert(view.box.innerHTML.includes('<option value="sub-sub"'));assert.equal(view.role.value,'sub-sub');
  devices=[MAIN_DEVICE,SUB_DEVICE,SUB_SUB_DEVICE];await h.api.loadAdminDevices();
  assert(!view.box.innerHTML.includes('id="pachi-device-player-id"'));assert(!view.box.innerHTML.includes('device-add-review'));
  assert(!view.box.innerHTML.includes('id="pachi-device-role"'));assert(view.box.innerHTML.includes('登録済み 3 / 3台'));
  for(const device of devices)assert(view.box.innerHTML.includes(device.playerId));
  for(const name of ['カサイ','サカイ','イサカ'])assert(view.box.innerHTML.includes(`<strong>${name}</strong>`));
  assert(view.box.innerHTML.includes('data-device-id="'+SUB_DEVICE.playerId+'"'));assert(view.box.innerHTML.includes('device-revoke-review'));
  assert(view.box.innerHTML.includes('サブ運営の解除を確認'));assert(view.box.innerHTML.includes('サブサブ運営の解除を確認'));
  assert(view.existing.disabled,'Already disabled controls stay disabled after a roster fetch');
});

test('both deputies can read all devices and self-release but cannot grant or revoke others',async()=>{
 for(const [token,current,device] of [[TOKEN_B,PLAYER_B,SUB_DEVICE],[TOKEN_C,PLAYER_C,SUB_SUB_DEVICE]]){
  const h=harness({settings:true,handle:c=>c.path==='/admin/devices'?response(deviceData([MAIN_DEVICE,SUB_DEVICE,SUB_SUB_DEVICE],false)):null});
  adopt(h,token,{...current,isAdmin:true});h.api.refreshSettings();const view=attachDeviceConsole(h);await h.api.loadAdminDevices();
  for(const row of [MAIN_DEVICE,SUB_DEVICE,SUB_SUB_DEVICE])assert(view.box.innerHTML.includes(row.playerId));
  assert(!view.box.innerHTML.includes('device-revoke-review'));assert(!view.box.innerHTML.includes('device-add-review'));assert(!view.box.innerHTML.includes('pachi-device-player-id'));
  assert(h.serviceBody.innerHTML.includes('data-admin-action="console"'),'Sub retains the existing operational console');
  const count=h.calls.length;await assert.rejects(h.api.prepareDeviceGrant(),/メイン運営/);await assert.rejects(h.api.prepareDeviceRevoke(MAIN_DEVICE.playerId),/メイン運営/);
  assert.equal(h.calls.length,count);h.api.prepareRelease();assert.equal(h.api.releaseReview.registration.playerId,current.id);assert.equal(h.api.releaseReview.registration.claimedAt,device.claimedAt);
 }
});

test('either promoted deputy immediately refreshes its operator name, controls and self-release registration',async()=>{
 for(const [token,current,device] of [[TOKEN_B,PLAYER_B,SUB_DEVICE],[TOKEN_C,PLAYER_C,SUB_SUB_DEVICE]]){
  let promoted=false;
  const h=harness({settings:true,handle:c=>c.path==='/admin/devices'?response(promoted?deviceData([{...device,role:'main',claimedAt:4567}]):deviceData([MAIN_DEVICE,device],false)):null});
  adopt(h,token,{...current,isAdmin:true,adminRole:device.role});const view=attachDeviceConsole(h);
  const title={textContent:''},heading={textContent:''},decorate={textContent:''},query=view.dialog.querySelector;
  view.dialog.querySelector=selector=>selector==='#pachi-console-title'?title:selector==='.pachi-owner-identity h3'?heading:selector==='[data-admin-action="decorate-room"]'?decorate:query(selector);
  h.api.refreshSettings();await h.api.loadAdminDevices();
  assert.equal(h.ctx.LT.Admin.player.adminRole,device.role);assert(!view.box.innerHTML.includes('device-add-review'));
  const expectedName=device.role==='sub'?'サカイ':'イサカ';assert.equal(title.textContent,expectedName+'の運営管理');assert.equal(heading.textContent,expectedName);assert.equal(decorate.textContent,expectedName+'の部屋を飾る');assert(h.serviceBody.innerHTML.includes(expectedName+'の運営管理'));
  promoted=true;await h.api.loadAdminDevices();assert.equal(h.ctx.LT.Admin.player.adminRole,'main');assert(view.box.innerHTML.includes('device-add-review'));
  assert.equal(title.textContent,'カサイの運営管理');assert.equal(heading.textContent,'謎の調律士 カサイ');assert.equal(decorate.textContent,'カサイの部屋を飾る');assert(h.serviceBody.innerHTML.includes('カサイの運営管理'));assert.equal(h.ctx.LT.Admin.player.name,current.name);
  h.api.prepareRelease();assert.equal(h.api.releaseReview.registration.claimedAt,4567);
 }
});

test('ordinary players see no device UI and cannot make device requests',async()=>{
  const h=harness({settings:true});adopt(h,TOKEN_B,PLAYER_B);h.api.refreshSettings();const view=attachDeviceConsole(h);
  h.api.renderAdminDevices();assert.equal(view.box.innerHTML,'');
  assert(!h.serviceBody.innerHTML.includes('device-add-review'));assert(!h.serviceBody.innerHTML.includes('data-admin-action="console"'));
  await assert.rejects(h.api.loadAdminDevices(),/運営端末/);assert.equal(h.calls.length,0);
});

test('device lookup reviews the exact escaped profile and cancellation sends no mutation',async()=>{
  const target={playerId:PLAYER_B.id,name:'<img src=x onerror=alert(1)>',isAdmin:false};
  const h=harness({handle:c=>c.path==='/admin/devices'?response({...deviceData(),...(c.search?{candidate:target}:{})}):null});
  adopt(h);const view=attachDeviceConsole(h);await h.api.loadAdminDevices();view.input.value=PLAYER_B.id;await h.api.prepareDeviceGrant();
  assert.equal(h.calls.at(-1).method,'GET');assert.equal(h.calls.at(-1).search,'?playerId='+PLAYER_B.id);
  assert.equal(h.api.deviceReview.target.playerId,PLAYER_B.id);assert.equal(h.api.deviceReview.target.name,target.name);
  assert(view.box.innerHTML.includes('&lt;img'));assert(!view.box.innerHTML.includes('<img src=x'));
  assert(view.box.innerHTML.includes('同じ運営機能'));assert(view.box.innerHTML.includes('メイン運営だけ'));assert(view.cancel.focused);
  assert(!view.box.innerHTML.includes(TOKEN_A));assert(!view.box.innerHTML.includes(TOKEN_B));
  await view.click('device-cancel');assert.equal(h.api.deviceReview,null);assert(h.calls.every(c=>c.method==='GET'));assert(view.box.innerHTML.includes('id="pachi-device-player-id"'));
});

test('confirmed sub registration sends its role once and leaves only the third seat available',async()=>{
  const posted=deferred();
  const h=harness({handle:c=>c.path==='/admin/devices'?(c.method==='POST'?posted.promise:response({...deviceData(),...(c.search?{candidate:{playerId:PLAYER_B.id,name:PLAYER_B.name,isAdmin:false}}:{})})):null});
  adopt(h);const view=attachDeviceConsole(h);await h.api.loadAdminDevices();view.input.value=PLAYER_B.id;await h.api.prepareDeviceGrant();
  const first=h.api.confirmDeviceChange();await until(()=>h.calls.some(c=>c.method==='POST'));
  assert.equal(h.api.deviceBusy,true);assert(view.cancel.disabled);assert.equal(await h.api.confirmDeviceChange(),null);
  assert.deepEqual(h.calls.filter(c=>c.method==='POST').map(c=>({path:c.path,body:c.body})),[{path:'/admin/devices',body:{playerId:PLAYER_B.id,role:'sub',confirmed:true}}]);
  posted.resolve(response({...deviceData([MAIN_DEVICE,SUB_DEVICE]),added:true}));await first;
  assert.equal(h.api.deviceBusy,false);assert.equal(h.api.deviceReview,null);assert(view.box.innerHTML.includes('pachi-device-player-id'));
  assert(view.box.innerHTML.includes('登録済み 2 / 3台'));assert.equal(view.role.value,'sub-sub');assert(!view.box.innerHTML.includes('<option value="sub"'));assert(h.statusLine.textContent.includes('お届けものを確認'));
});

test('the third role is reviewed explicitly and the confirmed request preserves the chosen vacant seat',async()=>{
 for(const initial of [[MAIN_DEVICE],[MAIN_DEVICE,SUB_DEVICE]]){
  let devices=initial;
  const h=harness({handle:c=>{
    if(c.path!=='/admin/devices')return null;
    if(c.method==='POST'){devices=[...initial,SUB_SUB_DEVICE];return response({...deviceData(devices),added:true});}
    return response({...deviceData(devices),...(c.search?{candidate:{playerId:PLAYER_C.id,name:PLAYER_C.name,isAdmin:false}}:{})});
  }});
  adopt(h);const view=attachDeviceConsole(h);await h.api.loadAdminDevices();view.input.value=PLAYER_C.id;view.role.value='sub-sub';await h.api.prepareDeviceGrant();
  assert.equal(h.api.deviceReview.target.role,'sub-sub');assert(view.box.innerHTML.includes('役割：サブサブ運営'));assert(view.box.innerHTML.includes('この端末をサブサブ運営に登録する'));
  await view.click('device-cancel');assert.equal(view.role.value,'sub-sub');assert(h.calls.every(c=>c.method==='GET'));
  view.input.value=PLAYER_C.id;await h.api.prepareDeviceGrant();await h.api.confirmDeviceChange();
  assert.deepEqual(h.calls.filter(c=>c.method==='POST').map(c=>c.body),[{playerId:PLAYER_C.id,role:'sub-sub',confirmed:true}]);
  if(initial.length===1){assert(view.box.innerHTML.includes('pachi-device-player-id'));assert.equal(view.role.value,'sub');assert(!view.box.innerHTML.includes('<option value="sub-sub"'));}
  else{assert(view.box.innerHTML.includes('登録済み 3 / 3台'));assert(!view.box.innerHTML.includes('id="pachi-device-player-id"'));assert(!view.box.innerHTML.includes('id="pachi-device-role"'));}
 }
});

test('a role occupied during lookup prevents review and does not silently select another role for the same player',async()=>{
  const h=harness({handle:c=>c.path==='/admin/devices'?response({...deviceData(c.search?[MAIN_DEVICE,SUB_DEVICE]:[MAIN_DEVICE]),...(c.search?{candidate:{playerId:PLAYER_C.id,name:PLAYER_C.name,isAdmin:false}}:{})}):null});
  adopt(h);const view=attachDeviceConsole(h);await h.api.loadAdminDevices();view.input.value=PLAYER_C.id;
  for(const role of ['main','invalid','']){view.role.value=role;await assert.rejects(h.api.prepareDeviceGrant(),/役割/);}
  assert.equal(h.calls.length,1,'Invalid selected roles are rejected before looking up a player');
  view.role.value='sub';await assert.rejects(h.api.prepareDeviceGrant(),/サブ運営はすでに登録/);
  assert.equal(h.api.deviceReview,null);assert.equal(view.role.value,'sub-sub');assert(h.calls.every(c=>c.method==='GET'));
});

test('role conflicts refresh available seats without resending or changing the reviewed appointment',async()=>{
 for(const code of ['ADMIN_ROLE_OCCUPIED','ADMIN_ROLE_CHANGED']){
  let changed=false;
  const h=harness({handle:c=>{
    if(c.path!=='/admin/devices')return null;
    if(c.method==='POST'){changed=true;return apiError(409,code);}
    const devices=changed?code==='ADMIN_ROLE_OCCUPIED'?[MAIN_DEVICE,SUB_DEVICE]:[MAIN_DEVICE,SUB_SUB_DEVICE]:[MAIN_DEVICE];
    return response({...deviceData(devices),...(c.search?{candidate:{playerId:PLAYER_C.id,name:PLAYER_C.name,isAdmin:false}}:{})});
  }});
  adopt(h);const view=attachDeviceConsole(h);await h.api.loadAdminDevices();view.input.value=PLAYER_C.id;await h.api.prepareDeviceGrant();
  await assert.rejects(h.api.confirmDeviceChange(),err=>err.code===code);assert.equal(h.api.deviceReview,null);
  assert.equal(await h.api.confirmDeviceChange(),null);assert.deepEqual(h.calls.filter(c=>c.method==='POST').map(c=>c.body),[{playerId:PLAYER_C.id,role:'sub',confirmed:true}]);
  assert.equal(view.role.value,code==='ADMIN_ROLE_OCCUPIED'?'sub-sub':'sub');
 }
});

test('revocation reviews the latest registration and submits its exact claimedAt once',async()=>{
  let removed=false;const latestSub={...SUB_DEVICE,claimedAt:3456};
  const h=harness({handle:c=>{
    if(c.path==='/admin/devices/revoke'){removed=true;return response({...deviceData(),revoked:true});}
    if(c.path==='/admin/devices')return response(deviceData(removed?[MAIN_DEVICE]:[MAIN_DEVICE,latestSub]));
  }});
  adopt(h);const view=attachDeviceConsole(h);await h.api.loadAdminDevices();await h.api.prepareDeviceRevoke(PLAYER_B.id);
  assert.equal(h.api.deviceReview.target.claimedAt,latestSub.claimedAt);assert(view.box.innerHTML.includes(new Date(latestSub.claimedAt).toISOString()));assert(view.cancel.focused);
  await view.click('device-cancel');assert(!h.calls.some(c=>c.method==='POST'));
  await h.api.prepareDeviceRevoke(PLAYER_B.id);await h.api.confirmDeviceChange();
  assert.deepEqual(h.calls.filter(c=>c.method==='POST').map(c=>c.body),[{playerId:PLAYER_B.id,confirmed:true,claimedAt:latestSub.claimedAt}]);
  assert(view.box.innerHTML.includes('id="pachi-device-player-id"'));assert(!view.box.innerHTML.includes(SUB_DEVICE.playerId));
  await assert.rejects(h.api.prepareDeviceRevoke(PLAYER_A.id),/この端末の運営登録/);
});

test('main can review and dismiss the third role from a full roster while preserving the other deputy',async()=>{
  let removed=false;
  const h=harness({handle:c=>{
    if(c.path==='/admin/devices/revoke'){removed=true;return response({...deviceData([MAIN_DEVICE,SUB_DEVICE]),revoked:true});}
    if(c.path==='/admin/devices')return response(deviceData(removed?[MAIN_DEVICE,SUB_DEVICE]:[MAIN_DEVICE,SUB_DEVICE,SUB_SUB_DEVICE]));
  }});
  adopt(h);const view=attachDeviceConsole(h);await h.api.loadAdminDevices();await h.api.prepareDeviceRevoke(PLAYER_C.id);
  assert(view.box.innerHTML.includes('役割：サブサブ運営'));assert(view.box.innerHTML.includes('この端末のサブサブ運営登録を解除する'));
  assert.equal(h.api.deviceReview.target.claimedAt,SUB_SUB_DEVICE.claimedAt);await h.api.confirmDeviceChange();
  assert.deepEqual(h.calls.filter(c=>c.method==='POST').map(c=>c.body),[{playerId:PLAYER_C.id,confirmed:true,claimedAt:SUB_SUB_DEVICE.claimedAt}]);
  assert(view.box.innerHTML.includes(SUB_DEVICE.playerId));assert(!view.box.innerHTML.includes(SUB_SUB_DEVICE.playerId));assert.equal(view.role.value,'sub-sub');
});

test('a filled capacity race refreshes the roster without retrying the mutation',async()=>{
  let full=false;
  const h=harness({handle:c=>{
    if(c.path!=='/admin/devices')return null;
    if(c.method==='POST'){full=true;return apiError(409,'ADMIN_CAPACITY_REACHED');}
    return response({...deviceData(full?[MAIN_DEVICE,SUB_DEVICE,SUB_SUB_DEVICE]:[MAIN_DEVICE]),...(c.search?{candidate:{playerId:PLAYER_B.id,name:PLAYER_B.name,isAdmin:false}}:{})});
  }});
  adopt(h);const view=attachDeviceConsole(h);await h.api.loadAdminDevices();view.input.value=PLAYER_B.id;await h.api.prepareDeviceGrant();
  await assert.rejects(h.api.confirmDeviceChange(),err=>err.code==='ADMIN_CAPACITY_REACHED');
  assert.equal(h.calls.filter(c=>c.method==='POST').length,1);assert.equal(h.api.deviceReview,null);assert(!view.box.innerHTML.includes('pachi-device-player-id'));assert(view.box.innerHTML.includes(SUB_DEVICE.playerId));
});

test('a changed target registration requires a new review before another revocation',async()=>{
  let changed=false;
  const h=harness({handle:c=>{
    if(c.path==='/admin/devices/revoke'){changed=true;return apiError(409,'ADMIN_REGISTRATION_CHANGED');}
    if(c.path==='/admin/devices')return response(deviceData([MAIN_DEVICE,{...SUB_DEVICE,claimedAt:changed?9999:SUB_DEVICE.claimedAt}]));
  }});
  adopt(h);attachDeviceConsole(h);await h.api.loadAdminDevices();await h.api.prepareDeviceRevoke(PLAYER_B.id);
  await assert.rejects(h.api.confirmDeviceChange(),err=>err.code==='ADMIN_REGISTRATION_CHANGED');
  assert.equal(h.api.deviceReview,null);assert.equal(await h.api.confirmDeviceChange(),null);assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
  await h.api.prepareDeviceRevoke(PLAYER_B.id);assert.equal(h.api.deviceReview.target.claimedAt,9999);
});

test('identity changes discard delayed candidate lookups and their confirmations',async()=>{
  const lookup=deferred();
  const h=harness({handle:c=>c.path==='/admin/devices'?(c.search?lookup.promise:response(deviceData())):null});
  adopt(h);const view=attachDeviceConsole(h);await h.api.loadAdminDevices();view.input.value=PLAYER_B.id;const waiting=h.api.prepareDeviceGrant();await until(()=>h.calls.some(c=>c.search));
  adopt(h,TOKEN_B,PLAYER_B);lookup.resolve(response({...deviceData(),candidate:{playerId:PLAYER_B.id,name:PLAYER_B.name,isAdmin:false}}));
  await assert.rejects(waiting,err=>err.staleIdentity===true);assert.equal(h.api.deviceReview,null);assert.equal(h.api.adminDevices,null);assert.equal(h.ctx.LT.Admin.player.id,PLAYER_B.id);
  assert.equal(await h.api.confirmDeviceChange(),null);assert(!h.calls.some(c=>c.method==='POST'));assert.equal(view.box.innerHTML,'');
});

test('identity changes after a device review prevent submitting it',async()=>{
  const h=harness({handle:c=>c.path==='/admin/devices'?response({...deviceData(),candidate:{playerId:PLAYER_B.id,name:PLAYER_B.name,isAdmin:false}}):null});
  adopt(h);const view=attachDeviceConsole(h);await h.api.loadAdminDevices();view.input.value=PLAYER_B.id;await h.api.prepareDeviceGrant();
  adopt(h,TOKEN_B,PLAYER_B);await h.api.confirmDeviceChange();assert.equal(h.api.deviceReview,null);assert(!h.calls.some(c=>c.method==='POST'));
});

test('lost device mutation responses require a fresh roster instead of offering a stale form',async()=>{
  let granted=false;
  const h=harness({handle:c=>{
    if(c.path!=='/admin/devices')return null;
    if(c.method==='POST'){granted=true;return Promise.reject(new Error('Network response lost'));}
    return response({...deviceData(granted?[MAIN_DEVICE,SUB_DEVICE]:[MAIN_DEVICE]),...(c.search?{candidate:{playerId:PLAYER_B.id,name:PLAYER_B.name,isAdmin:false}}:{})});
  }});
  adopt(h);const view=attachDeviceConsole(h);await h.api.loadAdminDevices();view.input.value=PLAYER_B.id;await h.api.prepareDeviceGrant();
  await assert.rejects(h.api.confirmDeviceChange(),/Network response lost/);
  assert.equal(h.api.deviceReview,null);assert.equal(h.api.adminDevices,null);assert(!view.box.innerHTML.includes('pachi-device-player-id'));assert(view.box.innerHTML.includes('devices-refresh'));
  await h.api.loadAdminDevices();assert(view.box.innerHTML.includes('登録済み 2 / 3台'));assert.equal(view.role.value,'sub-sub');assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
});

test('lost admin access closes management and keeps the public key hidden while another admin remains',async()=>{
  let lost=false;
  const h=harness({settings:true,handle:c=>{
    if(c.path==='/admin/devices')return response(deviceData([MAIN_DEVICE,SUB_DEVICE]));
    if(c.path==='/admin/devices/revoke'){lost=true;return apiError(403,'ADMIN_REQUIRED');}
    if(c.path==='/status')return response({adminExists:true});
    if(c.path==='/me')return response({player:{...PLAYER_A,isAdmin:!lost},adminExists:true,grants:[],nextCursor:null});
  }});
  adopt(h);const view=attachDeviceConsole(h);await h.api.loadAdminDevices();
  // The server may revoke the actor after a review and before the confirmed request.
  await h.api.prepareDeviceRevoke(PLAYER_B.id);await assert.rejects(h.api.confirmDeviceChange(),err=>err.code==='ADMIN_REQUIRED');
  assert.equal(h.ctx.LT.Admin.player.isAdmin,false);assert.equal(view.dialog.open,false);assert.equal(h.api.adminDevices,null);assert.equal(view.box.innerHTML,'');
  assert(!h.serviceBody.innerHTML.includes('data-admin-action="console"'));assert(!h.serviceBody.innerHTML.includes('id="pachi-admin-key"'));
});

test('a main-only rejection refreshes capabilities without stripping ordinary sub permissions',async()=>{
  let demoted=false;
  const h=harness({handle:c=>{
    if(c.path==='/admin/devices/revoke'){demoted=true;return apiError(403,'MAIN_ADMIN_REQUIRED');}
    if(c.path==='/admin/devices')return response(deviceData(demoted?[{...MAIN_DEVICE,role:'sub'},{...SUB_DEVICE,role:'main'}]:[MAIN_DEVICE,SUB_DEVICE],!demoted));
  }});
  adopt(h);const view=attachDeviceConsole(h);await h.api.loadAdminDevices();await h.api.prepareDeviceRevoke(PLAYER_B.id);
  await assert.rejects(h.api.confirmDeviceChange(),err=>err.code==='MAIN_ADMIN_REQUIRED');
  assert.equal(h.ctx.LT.Admin.player.isAdmin,true);assert.equal(view.dialog.open,true);assert.equal(h.api.deviceReview,null);
  assert(!view.box.innerHTML.includes('device-revoke-review'));assert(!view.box.innerHTML.includes('device-add-review'));
});

test('main self-release review explains succession and sub release keeps the key private',async()=>{
  let released=false;
  const h=harness({settings:true,handle:c=>{
    if(c.path==='/admin/devices')return response(deviceData([MAIN_DEVICE,SUB_DEVICE],c.token===TOKEN_A));
    if(c.path==='/admin/release'){released=true;return response({released:true,player:{...PLAYER_B,isAdmin:false},adminExists:true});}
    if(c.path==='/status')return response({adminExists:true});
    if(c.path==='/me')return response({player:{...PLAYER_B,isAdmin:!released},adminExists:true,grants:[],nextCursor:null});
  }});
  adopt(h);const mainView=attachDeviceConsole(h);await h.api.loadAdminDevices();h.api.prepareRelease();
  assert(mainView.releaseBox.innerHTML.includes('登録済みのサブ運営がメイン運営を引き継ぎます'));assert(mainView.releaseBox.innerHTML.includes('入力欄は表示されません'));
  adopt(h,TOKEN_B,{...PLAYER_B,isAdmin:true});const subView=attachDeviceConsole(h);await h.api.loadAdminDevices();h.api.prepareRelease();await h.api.releaseAdmin();
  assert.equal(subView.dialog.open,false);assert.equal(h.ctx.LT.Admin.player.isAdmin,false);assert(!h.serviceBody.innerHTML.includes('id="pachi-admin-key"'));assert(h.statusLine.textContent.includes('別の運営端末'));
});

test('main self-release reviews the actual successor in sub then sub-sub order',async()=>{
 for(const [devices,label] of [[[MAIN_DEVICE,SUB_DEVICE,SUB_SUB_DEVICE],'サブ運営'],[[MAIN_DEVICE,SUB_SUB_DEVICE],'サブサブ運営']]){
  const h=harness({handle:c=>c.path==='/admin/devices'?response(deviceData(devices)):null});adopt(h);const view=attachDeviceConsole(h);await h.api.loadAdminDevices();h.api.prepareRelease();
  assert(view.releaseBox.innerHTML.includes(`登録済みの${label}がメイン運営を引き継ぎます`));assert(view.releaseBox.innerHTML.includes('入力欄は表示されません'));assert(h.calls.every(c=>c.method==='GET'));
 }
});

// The recovery action must use the same current-server identity as automatic delivery.
let reserveModel;
function reserveRules(){
  if(reserveModel)return reserveModel;
  const ctx=vm.createContext({console});
  for(const [,attributes,code] of fs.readFileSync(require.resolve('../index.html'),'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(/\bsrc=|application\/ld\+json/.test(attributes))continue;
    vm.runInContext(code,ctx);if(ctx.LT?.Engine)break;
  }
  return reserveModel=ctx.LT.AdminReserveRules;
}
function reserveBundle(role='main',id=PLAYER_A.id){
  return {version:1,playerId:id,role,members:[{main:'komorizen',sub:'shizunaria','sub-sub':'akehomura'}[role],'floravelle','zeroveil','pearlseria','hyogald','rurigorm'].map(species=>({grantId:`admin-trained-v64:${role}:${id}:${species}`,species,level:100,gender:role==='sub'?'female':'male',heldItem:'trainband',bonusPoints:99}))};
}
function reserveAddition(role='main',id=PLAYER_A.id){return {version:2,playerId:id,role,members:[{grantId:`admin-galdogran-v68:${role}:${id}:galdogran`,species:'vernix',level:100,gender:'none',heldItem:'trainband',bonusPoints:99}]};}
function enableReserve(h){h.ctx.LT.AdminReserveRules=reserveRules();return h;}

function initialPayload(owner){return {player:owner,adminExists:true,
  initialCompanions:[{...LEGENDARY,grantId:'admin-legendary:'+owner.id},{grantId:'admin-mythical:'+owner.id,species:'floravelle',level:70}],
  adminReserveTeam:reserveBundle(owner.adminRole,owner.id),adminReserveAddition:reserveAddition(owner.adminRole,owner.id),
  grants:[{grantId:'admin-initial:'+owner.id}],nextCursor:null};}
function attachInitialConsole(h){
  const groups={team:{hidden:false},addition:{hidden:false}};
  const boxes={
    '#pachi-admin-reserve':{innerHTML:'',closest:()=>groups.team},
    '#pachi-admin-reserve-addition':{innerHTML:'',closest:()=>groups.addition},
    '[data-admin-initial-policy]':{textContent:''},'[data-admin-config-policy]':{textContent:''},
    '[data-admin-futo-policy]':{textContent:''},'.pachi-status':h.statusLine
  };
  for(const [name,value] of Object.entries({level:CONFIG.level,...CONFIG.stats}))boxes[`[name="${name}"]`]={value:String(value)};
  CONFIG.moves.forEach((value,index)=>boxes[`[name="move${index}"]`]={value});
  const dialog={open:true,querySelector:selector=>boxes[selector]||null,querySelectorAll:()=>[],close(){this.open=false;}};
  h.api.attachConsole(dialog);return {boxes,groups,dialog};
}

test('sub ignores all automatic initial gifts across pages while ordinary gifts remain receivable',async()=>{
  const owner={...PLAYER_A,adminRole:'sub'},reserveCalls=[],existing={party:[{uid:'already-owned',species:'futo',hp:67}],giftReceipts:['admin-initial:'+PLAYER_A.id]};
  const original=JSON.stringify(existing);
  const h=enableReserve(harness({settings:true,handle:c=>{
    if(c.path==='/me'){const page=c.search.includes('cursor=')?2:1;return response({...initialPayload(owner),grants:[{grantId:'admin-initial:'+owner.id},{id:'admin-initial:'+owner.id},{grantId:'manual-'+page}],nextCursor:page===1?8:null});}
  },bridge:{getEngine:()=>({state:existing}),receiveAdminReserveTeam:bundle=>{reserveCalls.push(bundle);return {ok:false,pending:true};}}}));
  adopt(h,TOKEN_A,owner);const view=attachInitialConsole(h);await h.api.sync();
  assert.deepEqual(h.applied.map(grant=>grant.grantId),['manual-1','manual-2']);
  assert.equal(h.initial.length,0);assert.equal(h.updated.length,0);assert.equal(reserveCalls.length,0);
  assert.equal(h.ctx.LT.Admin.pending,0);assert.equal(h.toasts.length,0);
  assert.equal(h.api.reserveTeam,null);assert.equal(h.api.reserveAddition,null);
  assert.equal(JSON.stringify(existing),original,'Existing individuals and receipts are never deleted or rewritten');
  assert(view.groups.team.hidden&&view.groups.addition.hidden);
  assert.equal(view.boxes['#pachi-admin-reserve'].innerHTML,'');assert.equal(view.boxes['#pachi-admin-reserve-addition'].innerHTML,'');
  assert.match(h.serviceBody.innerHTML,/自分の冒険で仲間にしたパチモン/);
  assert.match(h.serviceBody.innerHTML,/初期メンバーの自動配布・復元はありません/);
  assert.match(h.serviceBody.innerHTML,/data-admin-action="console"/);
  assert(!h.serviceBody.innerHTML.includes('アルヴェリオンは運営の初期メンバー'));
});

test('main and sub-sub retain every initial gift path and initial Futo config updates',async()=>{
  for(const role of ['main','sub-sub']){
    const owner={...PLAYER_A,adminRole:role},received=[];
    const h=enableReserve(harness({handle:c=>c.path==='/me'?response(initialPayload(owner)):null,
      bridge:{receiveAdminReserveTeam:bundle=>{received.push(bundle);return {ok:true,alreadyReceived:true};}}}));
    adopt(h,TOKEN_A,owner);await h.api.sync();
    assert.deepEqual(received.map(bundle=>bundle.version),[1,2]);
    assert.deepEqual(h.initial.map(mon=>mon.species),['arvelion','floravelle']);
    assert.equal(h.applied[0].grantId,'admin-initial:'+owner.id);assert.equal(h.updated[0].grantId,'admin-initial:'+owner.id);
  }
});

test('intentionally disabled deliveries are not counted as pending',async()=>{
  for(const disableGrant of [true,false]){
    const owner={...PLAYER_A,adminRole:'main'},disabled=()=>({ok:false,disabled:true}),updates=[];
    const h=enableReserve(harness({handle:c=>c.path==='/me'?response({...initialPayload(owner),grants:[{id:'admin-initial:'+owner.id}]}):null,
      bridge:{receiveAdminReserveTeam:disabled,receiveAdminLegendary:disabled,receiveAdminMythical:disabled,
        grantFuto:()=>disableGrant?disabled():{ok:true,alreadyReceived:true},updateOwnedFuto:id=>{updates.push(id);return disabled();}}}));
    adopt(h,TOKEN_A,owner);await h.api.sync();
    assert.equal(h.ctx.LT.Admin.pending,0);assert.equal(h.toasts.length,0);
    assert.deepEqual(updates,disableGrant?[]:['admin-initial:'+owner.id]);
  }
});

test('a delayed inbox cannot apply initial gifts under a newer role in either direction',async()=>{
  for(const [prior,next] of [['main','sub'],['sub','main']]){
    const owner={...PLAYER_A,adminRole:prior},delayed=deferred(),received=[];
    const h=enableReserve(harness({handle:c=>c.path==='/me'?delayed.promise:c.path==='/world/presence'?response({self:{id:owner.id,isAdmin:true,adminRole:next}}):null,
      bridge:{receiveAdminReserveTeam:bundle=>{received.push(bundle);return {ok:true,added:6};}}}));
    adopt(h,TOKEN_A,owner);const pending=h.api.sync();await until(()=>h.calls.some(call=>call.path==='/me'));
    await h.ctx.LT.Admin.worldRequest('/world/presence',{method:'POST',body:{}});
    const payload=initialPayload(owner);payload.grants.push({grantId:'explicit-gift'});delayed.resolve(response(payload));await pending;
    assert.equal(h.ctx.LT.Admin.player.adminRole,next);assert.equal(received.length,0);assert.equal(h.initial.length,0);assert.equal(h.updated.length,0);
    assert.deepEqual(h.applied.map(grant=>grant.grantId),['explicit-gift']);assert.equal(h.ctx.LT.Admin.pending,0);
  }
});

test('sub cannot invoke either reserve restore even through stale buttons',async()=>{
  const owner={...PLAYER_A,adminRole:'sub'},h=enableReserve(harness({settings:true}));adopt(h,TOKEN_A,owner);
  const view=attachInitialConsole(h);h.api.refreshSettings();
  for(const method of ['restoreAdminReserveTeam','restoreAdminReserveAddition'])await assert.rejects(h.api[method](),/自動配布・復元はありません/);
  for(const action of ['restore-reserve','restore-reserve-addition'])await h.api.handleConsole({target:{closest:()=>({dataset:{adminAction:action},disabled:false,isConnected:true})}});
  assert.equal(h.calls.length,0);assert.equal(h.api.reserveBusy,false);assert(view.groups.team.hidden&&view.groups.addition.hidden);
  assert.match(h.statusLine.textContent,/初期メンバーの自動配布・復元はありません/);
});

test('a fresh sub profile cancels a restore started under main before it applies the payload',async()=>{
  for(const method of ['restoreAdminReserveTeam','restoreAdminReserveAddition']){
    const owner={...PLAYER_A,adminRole:'main'},delayed=deferred(),received=[];
    const h=enableReserve(harness({handle:c=>c.path==='/me'?delayed.promise:null,
      bridge:{receiveAdminReserveTeam:bundle=>{received.push(bundle);return {ok:true,added:1};}}}));
    adopt(h,TOKEN_A,owner);h.api.adoptReserveTeam(initialPayload(owner));const view=attachInitialConsole(h);h.api.renderAdminReserveTeam();
    assert(!view.groups.team.hidden&&!view.groups.addition.hidden);
    const restoring=h.api[method]();await until(()=>h.calls.some(call=>call.path==='/me'));
    delayed.resolve(response({...initialPayload(owner),player:{...owner,adminRole:'sub'}}));
    await assert.rejects(restoring,/初期メンバーの自動配布・復元はありません/);
    assert.equal(received.length,0);assert.equal(h.api.reserveTeam,null);assert.equal(h.api.reserveAddition,null);assert.equal(h.api.reserveBusy,false);
    assert(view.groups.team.hidden&&view.groups.addition.hidden);
  }
});

test('role changes immediately hide cached restore panels and show the own-adventure policy',async()=>{
  const owner={...PLAYER_A,adminRole:'main'};let role='sub';
  const h=enableReserve(harness({settings:true,handle:c=>c.path==='/world/presence'?response({self:{id:owner.id,isAdmin:true,adminRole:role}}):null}));
  adopt(h,TOKEN_A,owner);h.api.adoptReserveTeam(initialPayload(owner));const view=attachInitialConsole(h);h.api.renderAdminReserveTeam();
  assert.match(view.boxes['#pachi-admin-reserve'].innerHTML,/restore-reserve/);
  await h.ctx.LT.Admin.worldRequest('/world/presence',{method:'POST',body:{}});
  assert.equal(h.api.reserveTeam,null);assert.equal(h.api.reserveAddition,null);assert(view.groups.team.hidden&&view.groups.addition.hidden);
  assert.match(view.boxes['[data-admin-initial-policy]'].textContent,/自分の冒険/);
  assert.match(view.boxes['[data-admin-futo-policy]'].textContent,/初期フートは自動追加されません/);
  role='sub-sub';await h.ctx.LT.Admin.worldRequest('/world/presence',{method:'POST',body:{}});
  h.api.adoptReserveTeam(initialPayload({...owner,adminRole:role}));h.api.renderAdminReserveTeam();
  assert(!view.groups.team.hidden&&!view.groups.addition.hidden);
  assert.match(view.boxes['#pachi-admin-reserve'].innerHTML,/restore-reserve/);
  assert.match(view.boxes['#pachi-admin-reserve-addition'].innerHTML,/restore-reserve-addition/);
  assert(!view.boxes['[data-admin-initial-policy]'].textContent.includes('自動配布・復元はありません'));
});

test('sub keeps Futo configuration and explicit distribution to self and other players',async()=>{
  const owner={...PLAYER_A,adminRole:'sub'};
  const h=enableReserve(harness({settings:true,handle:c=>{
    if(c.path==='/me')return response(initialPayload(owner));
    if(c.path==='/admin/config'&&c.method==='PUT')return response({config:c.body.config,revision:2});
    if(c.path==='/admin/grants')return response({recipientCount:1});
  }}));
  adopt(h,TOKEN_A,owner);attachInitialConsole(h);
  await h.api.handleConsole({target:{closest:()=>({dataset:{adminAction:'config'},disabled:false,isConnected:true})}});
  assert.equal(h.calls.filter(call=>call.path==='/admin/config'&&call.method==='PUT').length,1);
  assert.match(h.statusLine.textContent,/これから配布するフートに反映/);assert(!h.statusLine.textContent.includes('運営のフートにも'));
  for(const target of ['self',PLAYER_B.id]){h.api.prepareGrant(target,CONFIG);assert.equal((await h.api.submitPendingGrant()).recipientCount,1);}
  assert.deepEqual(h.calls.filter(call=>call.path==='/admin/grants').map(call=>call.body.target),['self',PLAYER_B.id]);
  assert.equal(h.applied.length,0);assert.equal(h.initial.length,0);assert.equal(h.updated.length,0);
});

test('main and sub-sub receive their own trained six once per paginated synchronization',async()=>{
  for(const role of ['main','sub-sub']){
    const owner={...PLAYER_A,adminRole:role},bundle=reserveBundle(role),applied=[];
    const h=enableReserve(harness({handle:c=>c.path==='/me'?response({player:owner,adminReserveTeam:bundle,grants:[],nextCursor:c.search.includes('cursor=')?null:4}):null,
      bridge:{receiveAdminReserveTeam:(value,options)=>{applied.push({value,options});return {ok:true,added:6};}}}));
    adopt(h,TOKEN_A,owner);await h.api.sync();
    assert.equal(applied.length,1);assert.equal(applied[0].value.role,role);assert.equal(applied[0].value.members.length,6);
    assert.equal(applied[0].options,undefined);assert.equal(h.ctx.LT.Admin.pending,0);
    assert(h.toasts.some(message=>message.includes('6体をひかえに追加')));
  }
});

test('reserve delivery rejects ordinary players and mismatched role, owner, species or growth',async()=>{
  const owner={...PLAYER_A,adminRole:'main'},applied=[];let profile=owner,bundle=reserveBundle();
  const h=enableReserve(harness({handle:c=>c.path==='/me'?response({player:profile,adminReserveTeam:bundle,grants:[]}):null,
    bridge:{receiveAdminReserveTeam:value=>{applied.push(value);return {ok:true,added:6};}}}));
  for(const invalid of [reserveBundle('sub'),reserveBundle('main',PLAYER_B.id),{...reserveBundle(),members:reserveBundle().members.slice(1)},
    {...reserveBundle(),members:reserveBundle().members.map((mon,i)=>i===0?{...mon,bonusPoints:100}:mon)}]){
    bundle=invalid;adopt(h,TOKEN_A,owner);await h.api.sync();assert.equal(applied.length,0);
  }
  profile={...owner,isAdmin:false,adminRole:null};bundle=reserveBundle();adopt(h,TOKEN_A,owner);await h.api.sync();
  assert.equal(applied.length,0);assert.equal(h.api.reserveTeam,null);
});

test('reserve capacity failures stay pending and a later synchronization can safely retry',async()=>{
  const owner={...PLAYER_A,adminRole:'main'},bundle=reserveBundle();let blocked=true,attempts=0;
  const h=enableReserve(harness({handle:c=>c.path==='/me'?response({player:owner,adminReserveTeam:bundle,grants:[]}):null,
    bridge:{receiveAdminReserveTeam:()=>{attempts++;return blocked?{ok:false,pending:true,message:'ひかえに6体分の空きが必要です。'}:{ok:true,added:6};},adminReserveTeamStatus:()=>({newCount:6})}}));
  adopt(h,TOKEN_A,owner);await h.api.sync();assert.equal(h.ctx.LT.Admin.pending,6);assert.equal(h.toasts.length,0);
  blocked=false;await h.api.sync();assert.equal(attempts,2);assert.equal(h.ctx.LT.Admin.pending,0);
});

test('manual reserve restore refreshes authorization and repeated taps share one request',async()=>{
  const owner={...PLAYER_A,adminRole:'sub-sub'},bundle=reserveBundle('sub-sub'),pending=deferred(),applied=[];
  const h=enableReserve(harness({handle:c=>c.path==='/me'?pending.promise:null,bridge:{receiveAdminReserveTeam:(value,options)=>{applied.push({value,options});return {ok:true,added:1,restored:1,message:'1体を復元しました。'};}}}));
  adopt(h,TOKEN_A,owner);
  const first=h.api.restoreAdminReserveTeam(),second=h.api.restoreAdminReserveTeam();
  await until(()=>h.calls.some(c=>c.path==='/me'));assert.equal(h.calls.filter(c=>c.path==='/me').length,1);assert.equal(await second,null);
  pending.resolve(response({player:owner,adminReserveTeam:bundle}));const outcome=await first;
  assert.equal(outcome.added,1);assert.equal(applied.length,1);assert.equal(applied[0].options.restore,true);assert.equal(h.api.reserveBusy,false);
});

test('manual reserve restore discards responses after identity switch or current server revocation',async()=>{
  const owner={...PLAYER_A,adminRole:'main'},bundle=reserveBundle(),pending=deferred(),applied=[];
  const h=enableReserve(harness({handle:c=>c.path==='/me'?pending.promise:null,bridge:{receiveAdminReserveTeam:value=>{applied.push(value);return {ok:true,added:6};}}}));
  adopt(h,TOKEN_A,owner);const restore=h.api.restoreAdminReserveTeam();await until(()=>h.calls.length===1);
  adopt(h,TOKEN_B,PLAYER_B);pending.resolve(response({player:owner,adminReserveTeam:bundle}));
  await assert.rejects(restore,error=>error.staleIdentity===true);assert.equal(applied.length,0);assert.equal(h.api.reserveTeam,null);
  const revoked=enableReserve(harness({handle:c=>c.path==='/me'?response({player:{...owner,isAdmin:false,adminRole:null},adminReserveTeam:null}):null,
    bridge:{receiveAdminReserveTeam:value=>{applied.push(value);return {ok:true,added:6};}}}));
  adopt(revoked,TOKEN_A,owner);await assert.rejects(revoked.api.restoreAdminReserveTeam(),/現在の運営登録/);
  assert.equal(applied.length,0);assert.equal(revoked.ctx.LT.Admin.player.isAdmin,false);
});

test('a newer role heartbeat prevents an older reserve bundle from being delivered',async()=>{
  const owner={...PLAYER_A,adminRole:'main'},pending=deferred(),applied=[];
  const h=enableReserve(harness({handle:c=>c.path==='/me'?pending.promise:c.path==='/world/presence'?response({self:{id:owner.id,isAdmin:true,adminRole:'sub'}}):null,
    bridge:{receiveAdminReserveTeam:value=>{applied.push(value);return {ok:true,added:6};}}}));
  adopt(h,TOKEN_A,owner);const sync=h.api.sync();await until(()=>h.calls.some(c=>c.path==='/me'));
  await h.ctx.LT.Admin.worldRequest('/world/presence',{method:'POST',body:{}});
  pending.resolve(response({player:owner,adminReserveTeam:reserveBundle(),grants:[]}));await sync;
  assert.equal(applied.length,0);assert.equal(h.ctx.LT.Admin.player.adminRole,'sub');assert.equal(h.api.reserveTeam,null);
});

test('main and sub-sub receive the Vernix addition independently of the old six and only once across pages',async()=>{
  for(const role of ['main','sub-sub']){
    const owner={...PLAYER_A,adminRole:role},applied=[];
    const h=enableReserve(harness({handle:c=>c.path==='/me'?response({player:owner,adminReserveTeam:reserveBundle(role),adminReserveAddition:reserveAddition(role),grants:[],nextCursor:c.search.includes('cursor=')?null:7}):null,
      bridge:{receiveAdminReserveTeam:(value,options)=>{applied.push({value,options});return {ok:true,added:value.version===2?1:0,alreadyReceived:value.version===1};}}}));
    adopt(h,TOKEN_A,owner);await h.api.sync();
    assert.equal(applied.length,2);assert.equal(applied[0].value.version,1);assert.equal(applied[1].value.version,2);
    assert.equal(applied[0].value.members.length,6);assert.equal(applied[1].value.members.length,1);
    assert.equal(applied[1].value.members[0].gender,'none');assert.equal(applied[1].value.members[0].species,'vernix');
    assert(applied[0].value.members.every(member=>member.gender==='male'));
    assert(applied.every(entry=>entry.options===undefined));assert.equal(h.ctx.LT.Admin.pending,0);
    assert(h.toasts.some(message=>message.includes('1体をひかえに追加')));
  }
});

test('Vernix pending state counts one and retries without turning the old six into restoration',async()=>{
  const owner={...PLAYER_A,adminRole:'sub-sub'},applied=[];let blocked=true;
  const h=enableReserve(harness({handle:c=>c.path==='/me'?response({player:owner,adminReserveTeam:reserveBundle('sub-sub'),adminReserveAddition:reserveAddition('sub-sub'),grants:[]}):null,
    bridge:{receiveAdminReserveTeam:(value,options)=>{applied.push({version:value.version,options});return value.version===1?{ok:true,alreadyReceived:true}:blocked?{ok:false,pending:true}:{ok:true,added:1};},adminReserveTeamStatus:()=>({newCount:1})}}));
  adopt(h,TOKEN_A,owner);await h.api.sync();assert.equal(h.ctx.LT.Admin.pending,1);assert.equal(h.toasts.length,0);
  blocked=false;await h.api.sync();assert.equal(h.ctx.LT.Admin.pending,0);assert.equal(applied.filter(entry=>entry.version===2).length,2);
  assert(applied.every(entry=>entry.options===undefined));
});

test('invalid addition payloads cannot borrow the old bundle, another role, another owner, or a sex assignment',async()=>{
  const owner={...PLAYER_A,adminRole:'main'},applied=[];let bundle=reserveAddition();
  const h=enableReserve(harness({handle:c=>c.path==='/me'?response({player:owner,adminReserveAddition:bundle,grants:[]}):null,
    bridge:{receiveAdminReserveTeam:value=>{applied.push(value);return {ok:true,added:1};}}}));
  for(const bad of [reserveBundle(),reserveAddition('sub'),reserveAddition('main',PLAYER_B.id),
    {...reserveAddition(),members:reserveAddition().members.map(mon=>({...mon,gender:'female'}))},
    {...reserveAddition(),members:reserveAddition().members.map(mon=>({...mon,gender:'male'}))},
    {...reserveAddition(),members:reserveAddition().members.map(mon=>({...mon,species:'komori'}))}]){
    bundle=bad;adopt(h,TOKEN_A,owner);await h.api.sync();assert.equal(applied.length,0);assert.equal(h.api.reserveAddition,null);
  }
});

test('dedicated Vernix restore refreshes authorization, shares the operation lock, and never restores v64',async()=>{
  const owner={...PLAYER_A,adminRole:'sub-sub'},pending=deferred(),applied=[];
  const h=enableReserve(harness({handle:c=>c.path==='/me'?pending.promise:null,
    bridge:{receiveAdminReserveTeam:(value,options)=>{applied.push({value,options});return {ok:true,added:1,restored:1,message:'1体を復元しました。'};}}}));
  adopt(h,TOKEN_A,owner);
  const first=h.api.restoreAdminReserveAddition();await until(()=>h.calls.some(c=>c.path==='/me'));
  assert.equal(await h.api.restoreAdminReserveAddition(),null);assert.equal(await h.api.restoreAdminReserveTeam(),null);
  pending.resolve(response({player:owner,adminReserveTeam:reserveBundle('sub-sub'),adminReserveAddition:reserveAddition('sub-sub')}));
  assert.equal((await first).restored,1);assert.equal(applied.length,1);assert.equal(applied[0].value.version,2);
  assert.equal(applied[0].options.restore,true);assert.equal(h.api.reserveBusy,false);assert.equal(h.calls.filter(c=>c.path==='/me').length,1);
  const boxes={'#pachi-admin-reserve':{innerHTML:''},'#pachi-admin-reserve-addition':{innerHTML:''}};
  h.api.attachConsole({open:true,querySelector:selector=>boxes[selector]||null});h.api.renderAdminReserveTeam();
  assert.match(boxes['#pachi-admin-reserve'].innerHTML,/全員Lv\.100・オス/);
  assert.match(boxes['#pachi-admin-reserve-addition'].innerHTML,/ヴェルニクス · Lv\.100・性別なし/);
  assert.match(boxes['#pachi-admin-reserve-addition'].innerHTML,/data-admin-action="restore-reserve-addition"/);
  assert(!boxes['#pachi-admin-reserve-addition'].innerHTML.includes('data-admin-action="restore-reserve"'));
});

test('Vernix restore rejects delayed identities, a revoked role and a newer conflicting heartbeat',async()=>{
  const owner={...PLAYER_A,adminRole:'main'},applied=[];
  for(const change of ['identity','revoked','heartbeat']){
    const pending=deferred();
    const h=enableReserve(harness({handle:c=>c.path==='/me'?pending.promise:c.path==='/world/presence'?response({self:{id:owner.id,isAdmin:true,adminRole:'sub'}}):null,
      bridge:{receiveAdminReserveTeam:value=>{applied.push(value);return {ok:true,added:1};}}}));
    adopt(h,TOKEN_A,owner);const restore=h.api.restoreAdminReserveAddition();await until(()=>h.calls.some(c=>c.path==='/me'));
    if(change==='identity')adopt(h,TOKEN_B,PLAYER_B);
    if(change==='heartbeat')await h.ctx.LT.Admin.worldRequest('/world/presence',{method:'POST',body:{}});
    pending.resolve(response({player:change==='revoked'?{...owner,isAdmin:false,adminRole:null}:owner,adminReserveAddition:reserveAddition()}));
    await assert.rejects(restore);assert.equal(applied.length,0);assert.equal(h.api.reserveAddition,null);
  }
});


test('delayed old-backend addition payloads keep the same receipt while normalizing their species before delivery',async()=>{
  for(const role of ['main','sub-sub'])for(const retired of ['galdogran','galdoras','lunaxion'])for(const gender of ['male','female','none']){
    const owner={...PLAYER_A,adminRole:role},legacy=reserveAddition(role),applied=[];legacy.members[0].species=retired;legacy.members[0].gender=gender;
    const h=enableReserve(harness({handle:c=>c.path==='/me'?response({player:owner,adminReserveAddition:legacy,grants:[]}):null,
      bridge:{receiveAdminReserveTeam:value=>{applied.push(value);return {ok:true,alreadyReceived:true,added:0};}}}));
    adopt(h,TOKEN_A,owner);await h.api.sync();assert.equal(applied.length,1);
    assert.equal(applied[0].members[0].species,'vernix');assert.equal(applied[0].members[0].grantId,legacy.members[0].grantId);
    assert.equal(applied[0].members[0].gender,'none');
    assert.equal(h.ctx.LT.Admin.pending,0);assert.equal(h.toasts.length,0);
  }
});
