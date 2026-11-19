#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {KasaiChallengeController,KEY}=require('../kasai-challenge.js');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),context=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;vm.runInContext(script[2],context);if(context.LT?.Engine)break;}
const {Engine,DATA:D,KasaiRules:rules}=context.LT,copy=value=>JSON.parse(JSON.stringify(value));
const OWNER='P0123456789abcdef',OTHER='Pfedcba9876543210';
function play(e){
  for(let step=0;!e.battle.result&&step<rules.maxActions;step++){
    if(e.battle.pendingReplacement){assert(e.chooseReplacement(e.state.party.findIndex(mon=>mon.hp>0)).ok);continue;}
    const mon=e.state.party[e.battle.activeIndex],enemy=e.battle.enemy;
    const choices=e.moves(mon).map((move,index)=>({move,index})).filter(({move})=>e.movePP(mon,move.id)>0);
    const attacks=choices.filter(({move})=>move.kind==='attack'&&move.power>0).sort((a,b)=>b.move.power*e.effectiveness(b.move.element,context.LT.TypeSystem.of(enemy))-a.move.power*e.effectiveness(a.move.element,context.LT.TypeSystem.of(enemy)));
    const pick=attacks[0]||choices[0];assert(e.action(pick?{type:'move',index:pick.index}:{type:'struggle'}).ok);
  }
  const result=e.finishBattle();assert.equal(result.result,'won');return result;
}
async function fixture(){
  const replay=await import('../server/kasai-replay.mjs'),e=new Engine();e.newGame('komori');
  e.state.party=['akehomura','shizunaria','komorizen','arvelion','astralith','setsurei'].map((id,i)=>({...e.makeMonster(id,100),uid:'recovery-'+i}));for(const mon of e.state.party)e.markCaught(mon.species);
  const roomId='room:'+OTHER;D.maps[roomId]={...D.maps.village,id:roomId,sharedRoom:true,roomKindTag:'kasai',roomOwner:OTHER,returnPoint:{map:'village',...D.maps.village.spawn,facing:'up'}};e.state.map=roomId;e.state.visited.push(roomId);
  const records=new Map(),calls=[],h={e,calls,owner:OWNER,isAdmin:false,receipt:null,challenge:null,failSave:false,failAck:false,commits:0,pulses:0};
  h.storage={getItem:key=>records.get(key)??null,setItem(key,value){if(h.failSave&&key==='save')throw Error('Storage is full');records.set(key,value);},removeItem:key=>records.delete(key)};
  h.request=async(route,options={})=>{
    calls.push({route,options:copy(options)});
    if(route==='/world/kasai/reward')return {receipt:copy(h.receipt),pendingLiveSessionId:h.liveWin||null};
    if(route==='/world/kasai/live/00000000-0000-4000-8000-000000000058/claim'){
      assert(options.body.storageCount<192);h.receipt??={id:'kasai-reward:'+h.owner,grantId:'kasai-reward:'+h.owner,species:'floravelle',level:70,gender:'female',delivered:false,ackedAt:null};return {receipt:copy(h.receipt)};
    }
    if(route==='/world/kasai/challenges'){
      h.challenge={id:'server-challenge',seed:57,roomId:OTHER,rulesVersion:rules.version,expiresAt:Date.now()+1800000,party:replay.normalizeParty(options.body.party),opponents:replay.normalizeParty(['akehomura','shizunaria','komorizen'].map((species,i)=>({...e.makeMonster(species,70),uid:'kasai-party-'+i})))};
      const response={challenge:copy(h.challenge),token:'server-issued-challenge-token'};return h.onStart?await h.onStart(response):response;
    }
    if(route==='/world/kasai/challenges/server-challenge/complete'){
      if(h.expired){const error=Error('Challenge expired');error.code='KASAI_CHALLENGE_FINISHED';throw error;}
      assert.equal(options.body.token,'server-issued-challenge-token');assert(options.body.storageCount<192);assert.equal(replay.replayChallenge(h.challenge.party,h.challenge.seed,options.body.actions,h.challenge.opponents,h.challenge.rulesVersion).won,true);
      h.receipt??={id:'kasai-reward:'+h.owner,grantId:'kasai-reward:'+h.owner,species:'floravelle',level:70,gender:'male',delivered:false,ackedAt:null};
      return h.onComplete?await h.onComplete(copy(h.receipt)):{receipt:copy(h.receipt)};
    }
    if(route==='/world/kasai/reward/ack'){
      assert.equal(options.body.receiptId,h.receipt.id);assert(records.has('save'),'ACK always follows the durable complete save');
      if(h.failAck)throw Error('Connection lost before ACK');h.receipt.delivered=true;h.receipt.ackedAt=Date.now();return {ok:true};
    }
    throw Error('Unexpected route '+route);
  };
  h.commit=async(receipt)=>{
    h.commits++;const candidate=new Engine(copy(e.state)),result=candidate.receiveKasaiReward(receipt);if(!result.ok)return result;
    try{h.storage.setItem('save',JSON.stringify(candidate.serialize()));}catch(_){return {ok:false,message:'セーブを書き込めませんでした。'};}
    e.state=candidate.state;return result;
  };
  h.controller=()=>new KasaiChallengeController({storage:h.storage,request:h.request,identify:async()=>({id:h.owner,isAdmin:h.isAdmin}),getEngine:()=>e,startBattle:challenge=>e.startKasaiBattle(challenge),commit:h.commit,refreshPresence:async()=>{h.pulses++;},rules,uuid:()=> '00000000-0000-4000-8000-000000000056'});
  h.c=h.controller();return h;
}
const completeCalls=h=>h.calls.filter(call=>call.route.endsWith('/complete'));
const ackCalls=h=>h.calls.filter(call=>call.route.endsWith('/ack'));
test('only a dedicated actual Kasai victory is submitted, with fresh room presence and server replay',async()=>{
  const h=await fixture();assert((await h.c.finish({ok:true,result:'won'})).ignored);assert.equal(h.calls.length,0);
  const started=await h.c.start();assert(started.ok,started.message);assert.equal(h.pulses,1);const result=play(h.e);assert((await h.c.finish(result)).ok);
  assert.equal(completeCalls(h).length,1);assert.equal(ackCalls(h).length,1);assert.equal(h.e.state.storage.filter(mon=>mon.species==='floravelle').length,1);assert.equal(h.c.pending,null);
  assert.equal(h.e.state.map,'room:'+OTHER,'Durable reward mutation preserves the live room');assert.equal(JSON.parse(h.storage.getItem('save')).map,'village','The durable save has a safe static return location');
});
test('storage full preserves the win without a server receipt and freeing space never grants automatically',async()=>{
  const h=await fixture();h.e.state.storage=Array.from({length:192},(_,i)=>({...h.e.makeMonster('fuwari',1),uid:'full-'+i}));h.e.markCaught('fuwari');
  assert((await h.c.start()).ok);const result=play(h.e),blocked=await h.c.finish(result);assert(blocked.storageFull);assert.equal(completeCalls(h).length,0);assert.equal(h.receipt,null);assert(h.c.pending.completion);
  h.e.state.storage.pop();await Promise.resolve();assert.equal(h.commits,0);assert.equal(completeCalls(h).length,0);
  const reloaded=h.controller();assert((await reloaded.inspect()).ok);assert(reloaded.state().canClaim);assert.equal(h.commits,0,'Opening dialogue or reloading never applies a reward');
  assert((await reloaded.claim()).ok);assert.equal(h.e.state.storage.length,192);assert.equal(h.e.state.storage.filter(mon=>mon.species==='floravelle').length,1);assert.equal(ackCalls(h).length,1);
});
test('failed durable save keeps the server receipt unacknowledged for explicit recovery',async()=>{
  const h=await fixture();assert((await h.c.start()).ok);const result=play(h.e),before=JSON.stringify(h.e.state);h.failSave=true;
  assert.equal((await h.c.finish(result)).ok,false);assert.equal(JSON.stringify(h.e.state),before);assert.equal(ackCalls(h).length,0);assert.equal(h.receipt.delivered,false);
  h.failSave=false;const reloaded=h.controller();assert((await reloaded.inspect()).ok);assert.equal(h.commits,1);assert((await reloaded.claim()).ok);assert.equal(h.commits,2);assert.equal(ackCalls(h).length,1);
  assert.equal(h.e.state.storage.filter(mon=>mon.species==='floravelle').length,1);
});
test('lost ACK recovers the same durable individual and acknowledged rewards never refill old saves',async()=>{
  const h=await fixture();assert((await h.c.start()).ok);h.failAck=true;assert.equal((await h.c.finish(play(h.e))).ok,false);
  const mon=copy(h.e.state.storage.find(mon=>mon.species==='floravelle'));assert(mon);assert(h.c.state().canClaim);h.failAck=false;
  while(h.e.state.storage.length<192)h.e.state.storage.push({...h.e.makeMonster('fuwari',1),uid:'after-ack-'+h.e.state.storage.length});h.e.markCaught('fuwari');
  const reloaded=h.controller();assert((await reloaded.claim()).alreadyReceived);assert.deepEqual(copy(h.e.state.storage.find(value=>value.uid===mon.uid)),mon);assert.equal(h.receipt.delivered,true);
  h.e.state.storage=h.e.state.storage.filter(value=>value.uid!==mon.uid);h.e.state.giftReceipts=[];const oldSave=h.controller(),before=h.commits;
  assert((await oldSave.claim()).alreadyReceived);assert.equal(h.commits,before);assert(!h.e.state.storage.some(value=>value.species==='floravelle'));
});
test('identity changes during reward delivery cannot apply another account receipt',async()=>{
  const h=await fixture();assert((await h.c.start()).ok);const result=play(h.e);
  h.onComplete=async receipt=>{h.owner=OTHER;return {receipt};};assert.equal((await h.c.finish(result)).ok,false);assert.equal(h.commits,0);assert.equal(ackCalls(h).length,0);assert(h.storage.getItem(KEY+OWNER));
});
test('lost start and completion responses keep a reusable intent and recover the already-created reward only on explicit claim',async()=>{
  const h=await fixture();h.onStart=async()=>{h.onStart=null;throw Error('Connection lost after challenge creation');};
  assert.equal((await h.c.start()).ok,false);assert.equal(h.c.pending.phase,'starting');const firstId=h.c.pending.requestId;assert((await h.c.start()).ok);assert.equal(h.c.pending.requestId,firstId);
  h.onComplete=async()=>{h.onComplete=null;throw Error('Connection lost after reward creation');};assert.equal((await h.c.finish(play(h.e))).ok,false);assert(h.receipt);assert.equal(h.commits,0);assert(h.c.pending.completion);
  const reloaded=h.controller();assert((await reloaded.inspect()).ok);assert.equal(h.commits,0);assert((await reloaded.claim()).ok);assert.equal(h.commits,1);assert.equal(completeCalls(h).length,1);
});
test('an expired unclaimed victory can be cleared by explicit server confirmation even while storage stays full',async()=>{
  const h=await fixture();h.e.state.storage=Array.from({length:192},(_,i)=>({...h.e.makeMonster('fuwari',1),uid:'expiry-'+i}));h.e.markCaught('fuwari');
  assert((await h.c.start()).ok);assert((await h.c.finish(play(h.e))).storageFull);h.c.persist({...h.c.pending,challenge:{...h.c.pending.challenge,expiresAt:Date.now()-1}});h.expired=true;
  assert(h.c.state().expired);const result=await h.c.claim();assert.equal(result.ok,false);assert.match(result.message,/もう一度挑戦/);assert.equal(h.c.pending,null);assert.equal(h.c.state().canClaim,false);assert.equal(h.commits,0);
  h.expired=false;assert((await h.c.start()).ok,'A fresh CPU challenge is available without first making storage space');
});
test('an expiry confirmation network error retains the winning transcript for recovery',async()=>{
  const h=await fixture();assert((await h.c.start()).ok);const result=play(h.e);h.failSave=true;assert.equal((await h.c.finish(result)).ok,false);
  h.failSave=false;h.receipt=null;h.expired=true;h.c.persist({...h.c.pending,challenge:{...h.c.pending.challenge,expiresAt:Date.now()-1}});
  const base=h.request;let reads=0;h.c.request=async(...args)=>{if(args[0]==='/world/kasai/reward'&&++reads===2)throw Error('Network lost during recovery');return base(...args);};
  assert.equal((await h.c.claim()).ok,false);assert(h.c.pending.completion);assert.equal(h.c.state().canClaim,true);
});
test('a corrupt recovery record stays blocked across retries without touching the adventure save',async()=>{
  const h=await fixture();h.storage.setItem(KEY+OWNER,'not-json');const before=JSON.stringify(h.e.state);
  assert.equal((await h.c.start()).ok,false);assert.equal((await h.c.start()).ok,false);assert.equal(h.calls.length,0);assert.equal(JSON.stringify(h.e.state),before);assert.equal(h.storage.getItem(KEY+OWNER),'not-json');
});
test('administrator cannot start, inspect or recover a self reward and retains existing owned monsters',async()=>{
  const h=await fixture();h.isAdmin=true;h.e.state.storage.push({...h.e.makeMonster('floravelle',70),uid:'already-owned',grantId:'admin-mythical:'+OWNER});
  const before=JSON.stringify(h.e.state);
  for(const operation of ['start','inspect','claim']){const result=await h.c[operation]();assert.equal(result.ok,false);assert.equal(result.code,'KASAI_SELF_BATTLE');}
  assert.equal(h.calls.length,0);assert.equal(h.commits,0);assert.equal(JSON.stringify(h.e.state),before);assert.equal(h.c.state().canClaim,false);
});
test('a stale non-admin profile still cannot challenge its own Kasai room',async()=>{
  const h=await fixture();h.owner=OTHER;const result=await h.c.start();
  assert.equal(result.code,'KASAI_SELF_BATTLE');assert.equal(h.calls.length,0);assert.equal(h.e.battle,null);
});
test('promotion during challenge creation prevents the returned battle from starting',async()=>{
  const h=await fixture();h.onStart=async response=>{h.isAdmin=true;return response;};
  const result=await h.c.start();assert.equal(result.code,'KASAI_SELF_BATTLE');assert.equal(h.e.battle,null);assert.equal(h.c.pending.phase,'starting');
});
test('promotion during completion rejects the reward before any durable grant or ACK',async()=>{
  const h=await fixture();assert((await h.c.start()).ok);const result=play(h.e),before=JSON.stringify(h.e.state);
  h.onComplete=async receipt=>{h.isAdmin=true;return {receipt};};const outcome=await h.c.finish(result);
  assert.equal(outcome.code,'KASAI_SELF_BATTLE');assert.equal(h.commits,0);assert.equal(ackCalls(h).length,0);assert.equal(JSON.stringify(h.e.state),before);assert(h.storage.getItem(KEY+OWNER));
});
test('pending victory is not recovered after becoming administrator, without deleting the old record',async()=>{
  const h=await fixture();h.e.state.storage=Array.from({length:192},(_,i)=>({...h.e.makeMonster('fuwari',1),uid:'promoted-'+i}));h.e.markCaught('fuwari');
  assert((await h.c.start()).ok);assert((await h.c.finish(play(h.e))).storageFull);h.e.state.storage.pop();
  const pending=h.storage.getItem(KEY+OWNER),before=JSON.stringify(h.e.state),calls=h.calls.length;h.isAdmin=true;
  assert.equal((await h.controller().claim()).code,'KASAI_SELF_BATTLE');assert.equal(h.calls.length,calls);assert.equal(h.commits,0);assert.equal(h.storage.getItem(KEY+OWNER),pending);assert.equal(JSON.stringify(h.e.state),before);
});
test('owner dialogue opens decoration instead of battle or reward controls',async()=>{
  const h=await fixture();let decorations=0,createdDialogs=0;
  const ui=vm.createContext({console,crypto:{randomUUID:()=> 'unused'},localStorage:h.storage,
    document:{createElement(){createdDialogs++;throw Error('Self battle dialogue must not be created');}},
    LT:{KasaiRules:rules,Admin:{player:{id:OWNER,isAdmin:true},worldRequest:h.request,tradeIdentity:async()=>({id:OWNER,isAdmin:true})},Rooms:{decorateMine:async()=>{decorations++;return true;}},
      adminBridge:{getEngine:()=>({...h.e,map:h.e.map,nearbyNPC:()=>({kind:'kasai'})}),startKasaiBattle:()=>{throw Error('Self battle started');},receiveKasaiReward:()=>{throw Error('Self reward applied');}}}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../kasai-challenge.js'),'utf8'),ui);
  assert.equal(ui.LT.KasaiChallenge.talk(),true);await Promise.resolve();assert.equal(decorations,1);assert.equal(createdDialogs,0);
  assert.equal((await ui.LT.KasaiChallenge.start()).code,'KASAI_SELF_BATTLE');assert.equal(decorations,2);assert.equal(h.calls.length,0);
});
test('a live victory remains explicitly claimable after leaving, reload and a full reserve without a CPU transcript',async()=>{
  const h=await fixture();h.liveWin='00000000-0000-4000-8000-000000000058';h.e.state.storage=Array.from({length:192},(_,i)=>({...h.e.makeMonster('fuwari',1),uid:'live-full-'+i}));h.e.markCaught('fuwari');
  const reloaded=h.controller();assert((await reloaded.inspect()).ok);assert(reloaded.state().canClaim);assert.equal(reloaded.pending,null);assert.equal(h.commits,0);
  assert.equal((await reloaded.claim()).ok,false);assert(!h.calls.some(call=>call.route.endsWith('/claim')));assert.equal(h.receipt,null);
  h.e.state.storage.pop();assert((await reloaded.claim()).ok);assert.equal(h.commits,1);assert.equal(h.e.state.storage.length,192);assert.equal(h.e.state.storage.at(-1).species,'floravelle');assert.equal(h.e.state.storage.at(-1).gender,'female');assert.equal(ackCalls(h).length,1);
  assert((await h.controller().claim()).alreadyReceived);assert.equal(h.commits,1);assert.equal(completeCalls(h).length,0);
});
