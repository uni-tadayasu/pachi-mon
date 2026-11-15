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
function harness({storage=new Map(),handle=()=>null,bridge={}}={}){
  const calls=[],applied=[],updated=[];
  const hooks=`globalThis.__test={sync,ensureIdentity,adoptIdentity,prepareGrant,submitPendingGrant,loadPendingGrant,resumePending(){pendingGrant=loadPendingGrant();},get pendingGrant(){return pendingGrant;}};`;
  let source=fs.readFileSync(require.resolve('../admin-console.js'),'utf8');
  assert(source.includes('mountSettings();void sync();'));
  source=source.replace('mountSettings();void sync();',hooks);
  const ctx={console,crypto:webcrypto,AbortController,URL,Blob,btoa,atob,
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    MutationObserver:class{observe(){}},
    document:{getElementById:()=>null,addEventListener(){},hidden:false},
    LT:{DATA:{moves:Object.fromEntries(CONFIG.moves.map(id=>[id,{name:id}]))},adminBridge:{
      getEngine:()=>null,getPlayerName:()=> 'Traveller',toast(){},
      grantFuto:g=>{applied.push(g);return{ok:true,alreadyReceived:true};},
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
  return{ctx,api:ctx.__test,calls,applied,updated,storage};
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
