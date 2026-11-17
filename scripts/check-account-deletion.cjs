#!/usr/bin/env node
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const TOKEN='A'.repeat(43),PLAYER={id:'P'+'a'.repeat(16),name:'旅人',isAdmin:false},KEY='pachi-player-identity-v1',DISABLED='pachi-online-disabled-v1';
const response=(data,status=200)=>({ok:status<300,status,json:async()=>({ok:status<300,...data})});
function harness({storage=new Map([[KEY,JSON.stringify({token:TOKEN,id:PLAYER.id,name:PLAYER.name})]]),handle=()=>null,native=false}={}){
  const calls=[],events=[],exports=[];
  const dispatch=async(path,options)=>{const call={path,method:options.method||'GET',token:options.token,body:options.body};calls.push(call);const supplied=handle(call);if(supplied)return supplied;
    if(path==='/me'&&call.method==='DELETE')return response({deleted:true});
    if(path==='/status')return response({adminExists:true});
    if(path==='/register')return response({player:{...PLAYER,id:'P'+'b'.repeat(16)},adminExists:true});
    if(path.startsWith('/me'))return response({player:PLAYER,adminExists:true,grants:[],nextCursor:null});
    throw new Error('Unexpected request '+path);
  };
  const ctx={console,crypto:webcrypto,AbortController,btoa,atob,URL,Blob,
    CustomEvent:class{constructor(type){this.type=type;}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},MutationObserver:class{observe(){}},
    document:{getElementById:()=>null,addEventListener(){},dispatchEvent:e=>events.push(e.type),hidden:false},
    LT:{DATA:{moves:{}},adminBridge:{getEngine:()=>({}),getPlayerName:()=>PLAYER.name,toast(){} }},
    fetch:(url,options)=>dispatch(new URL(url).pathname.replace(/^\/api/,''),{...options,token:options.headers.Authorization?.slice(7),body:options.body===undefined?undefined:JSON.parse(options.body)}),
    PachiNative:native?{available:true,apiRequest:dispatch,exportJSON:(json,kind)=>exports.push({json,kind})}:undefined};
  ctx.window=ctx;
  let source=fs.readFileSync(require.resolve('../admin-console.js'),'utf8');
  assert(source.includes('mountSettings();void sync();'));
  source=source.replace('mountSettings();void sync();','globalThis.hooks={deleteOwnAccount,resumeOnline,ensureIdentity,backup};');
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return{ctx,calls,events,storage,exports};
}

test('deleted accounts stay opted out across sync events and reload; explicit restart creates a new token',async()=>{
  const h=harness();await h.ctx.hooks.ensureIdentity();assert.equal(h.calls[0].path,'/me','known identity must not re-register');
  await h.ctx.hooks.deleteOwnAccount(PLAYER.id);
  assert.equal(h.storage.get(DISABLED),'1');assert(!h.storage.has(KEY));assert.equal(h.ctx.LT.Admin.player,null);assert.deepEqual(h.events,['pachi-account-deleted']);
  const count=h.calls.length;await h.ctx.LT.Admin.sync({register:true,fresh:true});await assert.rejects(h.ctx.hooks.ensureIdentity(),/停止/);assert.equal(h.calls.length,count);
  const reloaded=harness({storage:h.storage});await reloaded.ctx.LT.Admin.sync({register:true});assert.equal(reloaded.calls.length,0);
  await reloaded.ctx.hooks.resumeOnline();const registration=reloaded.calls.find(c=>c.path==='/register');assert(registration);assert.notEqual(registration.body.token,TOKEN);assert(!h.storage.has(DISABLED));
});

test('failed server deletion preserves identity and allows a safe retry',async()=>{
  let failures=1;const h=harness({handle:c=>c.method==='DELETE'&&failures--?response({error:{message:'サーバー停止'}},503):null});
  await assert.rejects(h.ctx.hooks.deleteOwnAccount(PLAYER.id),/サーバー停止/);
  assert.equal(JSON.parse(h.storage.get(KEY)).token,TOKEN);assert(!h.storage.has(DISABLED));
  await h.ctx.hooks.deleteOwnAccount(PLAYER.id);assert.equal(h.storage.get(DISABLED),'1');
});

test('in-flight profile responses cannot recreate a just-deleted identity',async()=>{
  let resolve;const waiting=new Promise(r=>{resolve=r;});
  const h=harness({handle:c=>c.path==='/me'&&c.method==='GET'?waiting:null});
  const reading=h.ctx.hooks.ensureIdentity();await Promise.resolve();await h.ctx.hooks.deleteOwnAccount(PLAYER.id);
  resolve(response({player:PLAYER,adminExists:true,grants:[]}));
  await assert.rejects(reading,e=>e.staleIdentity===true);assert.equal(h.ctx.LT.Admin.player,null);assert(!h.storage.has(KEY));
});

test('identity mismatch and active online play prevent deletion before any network mutation',async()=>{
  const h=harness();await assert.rejects(h.ctx.hooks.deleteOwnAccount('P'+'b'.repeat(16)),/切り替わ/);assert.equal(h.calls.length,0);
  h.ctx.LT.onlineActive=true;await assert.rejects(h.ctx.hooks.deleteOwnAccount(PLAYER.id),/対戦/);assert.equal(h.calls.length,0);
});

test('native account API and identity backup use the bounded native bridge',async()=>{
  const h=harness({native:true});h.ctx.fetch=()=>{throw new Error('native must use bridge');};
  await h.ctx.hooks.ensureIdentity();h.ctx.hooks.backup();assert.equal(h.exports.length,1);assert.equal(h.exports[0].kind,'playerIdentity');assert.equal(JSON.parse(h.exports[0].json).kind,'pachi-player-identity');
  await h.ctx.hooks.deleteOwnAccount(PLAYER.id);const deletion=h.calls.find(c=>c.method==='DELETE');assert.equal(deletion.path,'/me');assert.equal(deletion.body.confirmation,'DELETE');assert.equal(deletion.token,TOKEN);
});
