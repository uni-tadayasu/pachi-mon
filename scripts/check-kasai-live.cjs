#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {KasaiLiveController,reasonText}=require('../kasai-live.js');
const copy=value=>JSON.parse(JSON.stringify(value)),PLAYER='P0123456789abcdef',ADMIN='Pfedcba9876543210',SESSION='00000000-0000-4000-8000-000000000058';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function until(check){for(let i=0;i<100;i++){if(check())return;await Promise.resolve();}assert.fail('Asynchronous step was not reached');}
let runtime;
async function rules(){
  if(runtime)return runtime;const {createReplayRuntime}=await import('../server/kasai-replay.mjs'),LT=createReplayRuntime();
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8'),source=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(match=>match[1].includes('deterministic, save-independent rental-team duels'))[1];
  const context=vm.createContext({LT,console});vm.runInContext(source,context);vm.runInContext(fs.readFileSync(require.resolve('../kasai-live-model.js'),'utf8'),context);return runtime={LT,rules:context.LT.KasaiLiveRules};
}
async function fixture(role='challenger'){
  const loaded=await rules(),e=new loaded.LT.Engine();e.newGame('komori');
  e.state.party=['komori','fuwari'].map((id,i)=>({...e.makeMonster(id,55+i),uid:role+'-'+i}));
  const h={e,role,now:100000,player:{id:role==='kasai'?ADMIN:PLAYER,isAdmin:role==='kasai'},calls:[],stages:[],restores:[],notes:[],allowed:true,acked:false,fail:false,grants:0,saveParty:copy(e.state.party)};
  const seed={id:SESSION,state:'staging',roomId:ADMIN,challenger:{id:PLAYER,name:'挑戦者'},kasai:{id:ADMIN,name:'謎のトレーナー カサイ'},deadlineAt:h.now+60000,arrived:[false,false],battle:null,round:1,submitted:[false,false],rewardEligible:false,rewardClaimed:false,rewardDelivered:false,reason:null};
  h.s=null;h.offer=()=>{h.s=copy(seed);};h.battle=()=>{h.s??=copy(seed);h.s.arrived=[true,true];h.s.state='battle';h.s.battle=copy(loaded.rules.create(h.saveParty,h.saveParty,57));h.s.round=h.s.battle.round;};
  h.reply=()=>({serverTime:h.now,session:h.s&&!h.acked?{...copy(h.s),role:h.role,returnPosition:{map:'village',x:5,y:8,facing:'left'}}:null});
  h.request=async(path,options={})=>{
    h.calls.push({path,options:copy(options)});if(h.fail)throw Error('Network unavailable');
    let result;
    if(path==='/world/kasai/live'){if(options.method==='POST')h.offer();result=h.reply();}
    else if(path==='/world/rooms/'+ADMIN)result={room:{id:ADMIN,kind:'kasai',decorations:[]}};
    else if(path.endsWith('/arrive')){h.s.arrived[h.role==='kasai'?1:0]=true;result=h.reply();}
    else if(path.endsWith('/talk')){h.s.state='permission';result=h.reply();}
    else if(path.endsWith('/answer')){if(options.body.accept)h.battle();else{h.s.state='closed';h.s.reason='declined';}result=h.reply();}
    else if(path.endsWith('/actions')){h.s.submitted[h.role==='kasai'?1:0]=true;result=h.reply();}
    else if(path.endsWith('/leave')){h.s.state='closed';h.s.reason='challenger-left';result=h.reply();}
    else if(path.endsWith('/ack')){h.acked=true;result={session:null,serverTime:h.now};}
    else if(path.endsWith('/claim')){h.s.rewardClaimed=true;result={...h.reply(),receipt:{id:'kasai-reward:'+PLAYER}};}
    else throw Error('Unexpected request '+path);
    return h.onResponse?await h.onResponse(path,result,options):result;
  };
  h.c=new KasaiLiveController({request:h.request,identify:async()=>copy(h.player),getEngine:()=>h.e,getParty:()=>copy(h.saveParty),canEnter:()=>h.allowed,
    stage:(room,s)=>{h.stages.push(copy(s));Object.assign(h.e.state,{map:'room:'+s.roomId,x:12,y:s.role==='kasai'?4:16,facing:s.role==='kasai'?'down':'up'});return {ok:true};},
    restore:point=>{h.restores.push(copy(point));Object.assign(h.e.state,point);return {ok:true};},enforce:s=>{if(s.role==='kasai')Object.assign(h.e.state,{x:12,y:4,facing:'down'});},
    claimReward:async()=>{h.grants++;return {ok:true};},refreshPresence:async()=>{assert.equal(h.c.requesting===true||h.c.active(),true);},rules:loaded.rules,clock:()=>h.now,uuid:()=>SESSION,notify:message=>h.notes.push(message)});
  return h;
}
test('challenger enters at the foreground with the saved party and no automatic duel actions',async()=>{
  const h=await fixture();h.e.state.party[0].level=99;const result=await h.c.requestChallenge(ADMIN);assert(result.ok,result.message);
  assert.equal(h.stages.length,1);assert.equal(h.e.state.x,12);assert.equal(h.e.state.y,16);assert.equal(h.e.state.facing,'up');assert.equal(h.c.requesting,false);
  assert.deepEqual(h.calls.find(call=>call.options.method==='POST').options.body.party,h.saveParty);
  assert.equal(h.calls.filter(call=>call.path.endsWith('/arrive')).length,1);assert.equal(h.calls.filter(call=>call.path.endsWith('/actions')).length,0);assert.equal(h.c.state().remaining,60);
});
test('the real administrator arrives with its own party and must explicitly answer after the challenger talks',async()=>{
  const h=await fixture('kasai');h.offer();assert((await h.c.refresh()).ok);assert.equal(h.e.state.y,4);assert.equal(h.e.state.facing,'down');
  assert.deepEqual(h.calls.find(call=>call.path.endsWith('/arrive')).options.body.party,h.saveParty);assert(!h.calls.some(call=>call.path.endsWith('/answer')));
  assert.equal((await h.c.answer(true)).ok,false);assert(!h.calls.some(call=>call.path.endsWith('/answer')));
  h.s.arrived=[true,true];h.s.state='permission';await h.c.refresh();assert((await h.c.answer(true)).ok);assert.equal(h.c.live.state,'battle');assert.equal(h.calls.filter(call=>call.path.endsWith('/answer')).length,1);
  assert.equal((await h.c.leave()).ok,false);assert(!h.calls.some(call=>call.path.endsWith('/leave')));
});
test('staging talk requires both arrivals and an adjacent challenger, with a visible 60 second deadline',async()=>{
  const h=await fixture();await h.c.requestChallenge(ADMIN);assert.equal(h.c.canTalk(),false);assert.equal((await h.c.talk()).ok,false);
  h.s.arrived=[true,true];await h.c.refresh();h.now+=9000;assert.equal(h.c.state().remaining,51);h.e.state.x=12;h.e.state.y=5;assert(h.c.canTalk());
  assert((await h.c.talk()).ok);assert.equal(h.c.live.state,'permission');assert.equal(h.calls.filter(call=>call.path.endsWith('/talk')).length,1);assert(!h.calls.some(call=>call.path.endsWith('/actions')));
});
test('a busy administrator declines arrival without discarding an editor or starting a battle',async()=>{
  const h=await fixture('kasai');h.offer();h.allowed=false;assert((await h.c.refresh()).ok);assert.equal(h.stages.length,0);assert.equal(h.calls.filter(call=>call.path.endsWith('/arrive')).length,0);
  assert.deepEqual(h.calls.find(call=>call.path.endsWith('/answer')).options.body,{accept:false});assert.equal(h.c.active(),false);
});
test('the server snapshot advances only after an explicitly selected valid human action',async()=>{
  const h=await fixture();h.battle();assert((await h.c.refresh()).ok);const before=JSON.stringify(h.c.live.battle);
  assert.equal(h.calls.filter(call=>call.path.endsWith('/actions')).length,0);assert.equal((await h.c.submit([])).ok,false);
  const orders=[{type:'move',slot:0,move:0,target:0}];assert((await h.c.submit(orders)).ok);assert.deepEqual(h.calls.find(call=>call.path.endsWith('/actions')).options.body.orders,orders);
  assert.equal(JSON.stringify(h.c.live.battle),before,'Client never resolves or simulates the opponent command');assert.equal((await h.c.submit(orders)).ok,false);assert.equal(h.calls.filter(call=>call.path.endsWith('/actions')).length,1);
});
test('uncertain actions retry the same request id and do not permit a replacement command',async()=>{
  const h=await fixture();h.battle();await h.c.refresh();let dropped=false;
  h.onResponse=async(path,result)=>{if(path.endsWith('/actions')&&!dropped){dropped=true;throw Error('Lost response');}return result;};
  const orders=[{type:'move',slot:0,move:0,target:0}];assert.equal((await h.c.submit(orders)).ok,false);assert(h.c.actionIntent);
  assert.equal((await h.c.submit([{type:'switch',slot:0,index:1}])).ok,false);assert.equal(h.calls.filter(call=>call.path.endsWith('/actions')).length,1);
  assert((await h.c.submit(orders)).ok);const calls=h.calls.filter(call=>call.path.endsWith('/actions'));assert.equal(calls.length,2);assert.equal(calls[0].options.body.requestId,calls[1].options.body.requestId);assert.equal(h.c.actionIntent,null);
});
test('an older poll cannot overwrite a newer action acknowledgement',async()=>{
  const h=await fixture();h.battle();await h.c.refresh();const delayed=deferred();let intercept=true;
  h.onResponse=async(path,result)=>path==='/world/kasai/live'&&intercept?(intercept=false,delayed.promise):result;
  const pending=h.c.refresh();await until(()=>h.polling!==null||h.c.polling!==null);await until(()=>intercept===false);
  assert((await h.c.submit([{type:'move',slot:0,move:0,target:0}])).ok);const old=h.reply();old.session.submitted=[false,false];delayed.resolve(old);await pending;
  assert.equal(h.c.live.submitted[0],true);
});
test('timeout and challenger departure restore each participant once and acknowledge the closed session',async()=>{
  for(const role of ['challenger','kasai']){const h=await fixture(role);h.offer();await h.c.refresh();h.s.state='closed';h.s.reason=role==='challenger'?'talk-timeout':'challenger-left';await h.c.refresh();
    assert.equal(h.restores.length,1);assert.equal(h.e.state.map,'village');assert.equal(h.c.live,null);assert(h.acked);await h.c.refresh();assert.equal(h.restores.length,1);}
  assert.match(reasonText('talk-timeout'),/60秒/);assert.match(reasonText('challenger-left'),/挑戦者が退出/);
});
test('connection loss restores a pinned stage and reconnect acknowledges without a second teleport',async()=>{
  const h=await fixture('kasai');h.offer();await h.c.refresh();h.fail=true;h.now+=31000;assert.equal((await h.c.refresh()).ok,false);assert.equal(h.restores.length,1);assert.equal(h.c.active(),false);
  h.fail=false;h.s.state='closed';h.s.reason='disconnected';await h.c.refresh();assert.equal(h.restores.length,1);assert.equal(h.c.live,null);
});
test('identity reset restores only the current stage and rejects a late old session response',async()=>{
  const h=await fixture();h.offer();await h.c.refresh();const pending=deferred();h.onResponse=async(path,result)=>path==='/world/kasai/live'?pending.promise:result;
  const attempt=h.c.refresh();await until(()=>h.c.polling!==null);h.c.reset();assert.equal(h.restores.length,1);h.player={id:ADMIN,isAdmin:true};pending.resolve(h.reply());await attempt;assert.equal(h.c.live,null);assert.equal(h.stages.length,1);
});
test('winning rewards are explicit, blocked by reserve capacity, and committed after the server claim',async()=>{
  const h=await fixture();h.battle();h.s.state='result';h.s.battle.winner=0;h.s.rewardEligible=true;await h.c.refresh();assert.equal(h.grants,0);
  h.e.state.storage=Array(192).fill({});assert.equal((await h.c.claim()).ok,false);assert(!h.calls.some(call=>call.path.endsWith('/claim')));
  h.e.state.storage.pop();assert((await h.c.claim()).ok);assert.equal(h.grants,1);assert.equal(h.c.live.rewardDelivered,true);assert((await h.c.claim()).alreadyReceived);assert.equal(h.grants,1);
});
async function browserFixture(role){
  const h=await fixture(role),loaded=await rules(),nodes=[],scenes=[];
  class Node{constructor(tag){this.tag=tag;this.open=false;this.hidden=false;this.innerHTML='';this.listeners={};}setAttribute(){}addEventListener(type,listener){(this.listeners[type]||=[]).push(listener);}showModal(){this.open=true;}close(){this.open=false;}before(node){nodes.push(node);}querySelector(){return null;}querySelectorAll(){return [];}}
  const stage=new Node('stage'),document={createElement:tag=>{const node=new Node(tag);nodes.push(node);return node;},querySelector:selector=>selector==='.game-stage'?stage:null,body:{append(){}},addEventListener(){},hidden:false};
  const context=vm.createContext({console,document,navigator:{onLine:true},performance:{now:()=>h.now},crypto:{randomUUID:()=>SESSION},Date:class extends Date{static now(){return h.now;}},
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,requestAnimationFrame:()=>1,cancelAnimationFrame(){},addEventListener(){},
    LT:{...loaded.LT,KasaiLiveRules:loaded.rules,Admin:{player:h.player,tradeIdentity:async()=>copy(h.player),worldRequest:h.request},
      adminBridge:{isPlaying:()=>true,getEngine:()=>h.e,getKasaiLiveParty:()=>copy(h.saveParty),canEnterKasaiLive:()=>h.allowed,stageKasaiLive:h.c.stage,leaveKasaiLive:h.c.restore,enforceKasaiLive:h.c.enforce,setKasaiLiveBattle:state=>scenes.push(state),toast:message=>h.notes.push(message)},
      Rooms:{enterLive:h.c.stage},World:{refreshPresence:async()=>{}},KasaiChallenge:{claim:async()=>({ok:true})}}
  });
  vm.runInContext(fs.readFileSync(require.resolve('../kasai-live.js'),'utf8'),context);
  h.ui=context.LT.KasaiLive;h.dialog=()=>nodes.find(node=>node.id==='kasai-live-dialog');h.banner=()=>nodes.find(node=>node.id==='kasai-live-banner');h.scenes=scenes;
  h.click=async(action,index)=>{const node=h.dialog(),event={target:{closest:()=>({disabled:false,dataset:{kasaiLive:action,...(index===undefined?{}:{index:String(index)})}})}};for(const listener of node.listeners.click||[])await listener(event);};
  return h;
}
test('live permission and battle UI require separate explicit approval and command confirmation',async()=>{
  const h=await browserFixture('kasai');h.offer();h.s.state='permission';h.s.arrived=[true,true];assert((await h.ui.refresh()).ok);
  assert(h.dialog().open);assert.match(h.dialog().innerHTML,/data-kasai-live="accept"/);assert.match(h.dialog().innerHTML,/data-kasai-live="decline"/);assert.equal(h.scenes.length,0,'Discovery must not clear or start unrelated online battle scenes');assert(!h.calls.some(call=>call.path.endsWith('/answer')));
  await h.click('accept');assert.equal(h.ui.session().state,'battle');assert.match(h.dialog().innerHTML,/kasai-live-canvas/);assert.match(h.dialog().innerHTML,/data-kasai-live="move"/);assert.match(h.dialog().innerHTML,/data-kasai-live="submit" disabled/);assert(!h.calls.some(call=>call.path.endsWith('/actions')));
  await h.click('move',0);assert(!h.calls.some(call=>call.path.endsWith('/actions')));await h.click('submit');assert.equal(h.calls.filter(call=>call.path.endsWith('/actions')).length,1);assert.equal(h.scenes.at(-1).liveVersion,'kasai-live-v58');
});
test('closing the result UI returns to the stage while Kasai remains pinned until the challenger leaves',async()=>{
  const h=await browserFixture('kasai');h.battle();h.s.state='result';h.s.battle.winner=1;assert((await h.ui.refresh()).ok);
  assert(h.dialog().open);assert.match(h.dialog().innerHTML,/ステージに戻る/);await h.click('dismiss');assert.equal(h.dialog().open,false);assert.equal(h.scenes.at(-1),null);assert(h.ui.isActive());assert(h.ui.locked());assert.equal(h.e.state.y,4);assert.equal(h.restores.length,0);assert(!h.banner().innerHTML.includes('data-kasai-live="leave"'));
});
