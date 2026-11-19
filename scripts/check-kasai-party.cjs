#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {KasaiPartyController}=require('../kasai-party.js');
const copy=value=>JSON.parse(JSON.stringify(value));
const SELF='P0123456789abcdef',OTHER='Pfedcba9876543210';
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function fixture(){
  const h={player:{id:SELF,isAdmin:true},allowed:true,now:10000,calls:[],identities:0,fail:false};
  h.engine={state:{party:[{uid:'one',species:'komori',level:9,hp:20,pp:{sprout:3},gender:'female',shiny:false,moveOrder:['sprout','nudge'],heldItem:null,alloc:{atk:3}},
    {uid:'two',species:'fuwari',level:12,hp:35,pp:{gust:10},gender:'male',shiny:true,moveOrder:['gust','storm'],heldItem:'stone',alloc:{speed:1}}]}};
  h.c=new KasaiPartyController({canSync:()=>h.allowed,getEngine:()=>h.engine,identify:async()=>{h.identities++;if(h.onIdentify)await h.onIdentify();return copy(h.player);},
    normalizeParty:party=>copy(party),clock:()=>h.now,request:async(path,options)=>{assert.equal(path,'/world/kasai/party');assert.equal(options.method,'POST');h.calls.push(copy(options.body.party));if(h.onRequest)await h.onRequest();if(h.fail)throw Error('Network unavailable');return {updatedAt:h.now};}});
  return h;
}
test('only an allowed current administrator publishes a real saved party',async()=>{
  const h=fixture();h.allowed=false;assert((await h.c.sync()).skipped);assert.equal(h.identities,0);assert.equal(h.calls.length,0);
  h.allowed=true;h.player.isAdmin=false;assert((await h.c.sync()).skipped);assert.equal(h.calls.length,0);
  h.player.isAdmin=true;assert((await h.c.sync()).ok);assert.deepEqual(h.calls,[h.engine.state.party]);assert.equal(h.c.state().updatedAt,h.now);
});
test('health changes do not replace the roster, while order, level, moves and build changes do',async()=>{
  const h=fixture();await h.c.sync();h.engine.state.party[0].hp=1;h.engine.state.party[0].pp.sprout=0;h.engine.state.party[0].status={kind:'poison'};
  assert((await h.c.sync()).unchanged);assert.equal(h.calls.length,1);
  h.engine.state.party.reverse();h.engine.state.party[0].level=18;h.engine.state.party[0].moveOrder.reverse();h.engine.state.party[0].heldItem='seed';h.engine.state.party[0].alloc.speed=2;
  assert((await h.c.sync()).ok);assert.equal(h.calls.length,2);assert.deepEqual(h.calls[1],h.engine.state.party);
});
test('in-flight saves coalesce and upload in serial order with the latest party last',async()=>{
  const h=fixture(),started=deferred(),finish=deferred();h.onRequest=async()=>{if(h.calls.length===1){started.resolve();await finish.promise;}};
  const initial=h.c.sync();await started.promise;
  h.engine.state.party[0].level=21;const second=h.c.sync();h.engine.state.party[0].level=25;const third=h.c.sync();
  assert.equal(initial,second);assert.equal(initial,third);assert.equal(h.calls.length,1);
  finish.resolve();assert((await initial).ok);assert.equal(h.calls.length,2);assert.equal(h.calls[0][0].level,9);assert.equal(h.calls[1][0].level,25);
});
test('role, engine or saved-record changes while checking identity prevent any upload',async()=>{
  for(const mutation of [h=>{h.allowed=false;},h=>{h.player.isAdmin=false;},h=>{h.engine=copy(h.engine);}]){
    const h=fixture();h.onIdentify=async()=>{mutation(h);};assert((await h.c.sync()).skipped);assert.equal(h.calls.length,0);
  }
});
test('a stale response cannot mark a different administrator as synchronized',async()=>{
  const h=fixture();h.onRequest=async()=>{h.player.id=OTHER;};assert((await h.c.sync()).stale);assert.equal(h.c.state().updatedAt,null);
  h.onRequest=null;assert((await h.c.sync()).ok);assert.equal(h.calls.length,2);assert.equal(h.c.syncedOwner,OTHER);
});
test('failed uploads are retryable and manual refresh still honors the saved-state guard',async()=>{
  const h=fixture();h.fail=true;assert.equal((await h.c.sync()).ok,false);assert.equal(h.c.state().updatedAt,null);
  h.fail=false;assert((await h.c.sync()).ok);assert.equal(h.calls.length,2);
  assert((await h.c.sync({force:true})).ok);assert.equal(h.calls.length,3);
  h.allowed=false;const blocked=await h.c.sync({force:true});assert.equal(blocked.ok,false);assert.equal(blocked.skipped,true);assert.equal(h.calls.length,3);
});
test('unsaved live changes are not published and only a durable party update advances the roster',async()=>{
  const h=fixture();let savedParty=copy(h.engine.state.party);h.c.getParty=()=>savedParty;
  assert((await h.c.sync()).ok);assert.equal(h.calls.length,1);
  h.engine.state.party.reverse();h.engine.state.party[0].level=47;h.engine.state.party[0].moveOrder.reverse();
  assert((await h.c.sync()).unchanged);assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0],savedParty);
  savedParty=null;assert((await h.c.sync()).skipped);assert.equal(h.calls.length,1,'An unavailable or stale saved snapshot cannot publish the live party');
  savedParty=copy(h.engine.state.party);assert((await h.c.sync()).ok);assert.equal(h.calls.length,2);assert.deepEqual(h.calls[1],savedParty);
});
