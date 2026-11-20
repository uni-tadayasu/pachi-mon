#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {RankedBattleController,KEY,reasonText}=require('../ranked-battle.js');
const SOURCE=fs.readFileSync(require.resolve('../ranked-battle.js'),'utf8');
const SELF='P0000000000000001',PEER='P0000000000000002',OTHER='P0000000000000003',NOW=1800000000000;
const copy=value=>JSON.parse(JSON.stringify(value)),uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function until(check){for(let i=0;i<100;i++){if(check())return;await Promise.resolve();}assert.fail('Asynchronous step was not reached');}
let runtime;
async function loadRules(){
  if(runtime)return runtime;const {createReplayRuntime}=await import('../server/kasai-replay.mjs'),LT=createReplayRuntime();
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8'),source=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(match=>match[1].includes('deterministic, save-independent rental-team duels'))[1];
  const context=vm.createContext({LT,console});vm.runInContext(source,context);vm.runInContext(fs.readFileSync(require.resolve('../legacy-battle-v82.js'),'utf8'),context);vm.runInContext(fs.readFileSync(require.resolve('../ranked-rules.js'),'utf8'),context);
  return runtime={LT,rules:context.LT.RankedRules};
}
async function fixture(){
  const loaded=await loadRules(),e=new loaded.LT.Engine();e.newGame('komori');
  const team=['komori','fuwari','akehomura'].map((species,index)=>e.makeMonster(species,[24,71,60][index]));
  Object.assign(team[0],{nickname:'育てた仲間',alloc:{hp:6,atk:5},heldItem:'trainband',moveOrder:[3,1,0,2],gender:'male',shiny:true,hp:0,battleGrowth:23});team[1].heldItem='trainband';
  e.state.party=[copy(team[0])];e.state.storage=copy(team.slice(1));
  const h={e,team,loaded,now:NOW,player:{id:SELF,name:'自分の登録名'},calls:[],scenes:[],notes:[],records:new Map(),allowed:true,sceneResult:true,queue:null,match:null,intents:new Map(),nextUUID:1000,handler:null};
  h.profile=()=>({playerId:h.player.id,name:h.player.name,rating:1000,wins:0,losses:0,draws:0,games:0,tier:loaded.rules.rankForRating(1000)});
  h.reply=extra=>({rulesVersion:h.match?.rulesVersion||loaded.rules.info().version,profile:h.profile(),queue:copy(h.queue),match:copy(h.match),serverTime:h.now,pollAfterMs:2000,...extra});
  h.begin=(side=0)=>{
    const players=side===0?[{id:SELF,name:'自分の登録名',ratingBefore:1000},{id:PEER,name:'相手の登録名',ratingBefore:1000}]:[{id:PEER,name:'相手の登録名',ratingBefore:1000},{id:SELF,name:'自分の登録名',ratingBefore:1000}];
    h.queue=null;h.match={id:uuid(900),rulesVersion:loaded.rules.info().version,state:'battle',side,players,revision:0,round:1,submitted:[false,false],deadlineAt:h.now+90000,battle:copy(loaded.rules.create(team,team,78,players.map(player=>player.name))),result:null,createdAt:h.now,updatedAt:h.now};return h.match;
  };
  h.finish=(outcome='win',reason='battle')=>{
    h.match??=h.begin();const side=h.match.side,winner=outcome==='void'?null:outcome==='draw'?'draw':outcome==='win'?side:1-side,change=outcome==='win'?16:outcome==='loss'?-16:0,changes=side===0?[change,-change]:[-change,change];
    h.match={...h.match,state:'result',revision:h.match.revision+1,submitted:[false,false],result:{winner,reason,outcome,ratingBefore:[1000,1000],ratingAfter:changes.map(value=>1000+value),ratingDelta:changes,settledAt:h.now}};
    if(winner!==null)h.match.battle.winner=winner;return h.match;
  };
  h.respond=(route,options={})=>{
    if(route==='/world/ranked')return h.reply();
    if(route==='/world/ranked/history')return {history:[],serverTime:h.now};
    if(route==='/world/ranked/leaderboard')return {players:[],serverTime:h.now};
    if(route==='/world/ranked/queue'){
      const id=options.body.requestId;
      if(options.method==='DELETE'){if(!h.match){h.intents.set(id,'cancelled');if(h.queue?.requestId===id)h.queue=null;}return h.reply({intent:{requestId:id,state:h.match?'matched':'cancelled'}});}
      if(h.intents.get(id)==='cancelled')return h.reply({intent:{requestId:id,state:'cancelled'}});
      if(!h.match){h.queue={id:uuid(901),requestId:id,state:'waiting',team:copy(loaded.rules.normalizeTeam(options.body.team)),joinedAt:h.now,expiresAt:h.now+45000};h.intents.set(id,'waiting');}
      return h.reply({intent:{requestId:id,state:h.match?'matched':'waiting'}});
    }
    if(route.endsWith('/actions')){if(h.match.state==='battle'){const check=loaded.rules.validate(h.match.battle,h.match.side,options.body.orders);assert(check.ok,check.error);h.match.submitted[h.match.side]=true;h.match.revision++;}return h.reply();}
    if(route.endsWith('/forfeit')){h.finish('loss','forfeit');return h.reply();}
    if(route.endsWith('/ack')){const version=h.match.rulesVersion;h.match=null;return h.reply({rulesVersion:version});}
    throw Error('Unexpected test route '+route);
  };
  h.request=async(route,options={})=>{h.calls.push({route,...copy(options)});const custom=h.handler?.(route,options);return custom===undefined?h.respond(route,options):custom;};
  h.storage={getItem:key=>h.records.get(key)??null,setItem:(key,value)=>h.records.set(key,String(value)),removeItem:key=>h.records.delete(key)};
  h.identify=async()=>copy(h.player);
  h.newController=()=>new RankedBattleController({request:h.request,identify:options=>h.identify(options),getIdentity:()=>h.player,getEngine:()=>h.e,canEnter:()=>h.allowed,canResume:()=>h.resumeAllowed??h.allowed,
    setScene:(snapshot,side,id)=>{h.scenes.push({snapshot:copy(snapshot),side,id});return h.sceneResult;},rules:loaded.rules,storage:h.storage,clock:()=>h.now,uuid:()=>uuid(++h.nextUUID),notify:message=>h.notes.push(message)});
  h.c=h.newController();return h;
}

test('enrollment sends three owned original-level records with training, items, appearance and move order intact',async()=>{
  const h=await fixture(),adventure=JSON.stringify(h.e.state);assert((await h.c.join(h.team)).ok);
  const post=h.calls.find(call=>call.method==='POST');assert.equal(post.route,'/world/ranked/queue');assert.deepEqual(post.body.team,copy(h.loaded.rules.normalizeTeam(h.team)));
  assert.equal(post.body.rulesVersion,'ranked-v83-vernix');assert.equal(post.body.team[0].battleGrowth,23);
  assert.deepEqual(post.body.team.map(mon=>mon.level),[24,71,60]);assert.equal(post.body.team[0].uid,h.team[0].uid);assert.deepEqual(post.body.team[0].alloc,{hp:6,atk:5});assert.deepEqual(post.body.team[0].moveOrder,[3,1,0,2]);assert.equal(post.body.team[0].nickname,'育てた仲間');assert.equal(post.body.team[0].shiny,true);assert.equal(post.body.team[0].gender,'male');assert.equal(post.body.team[1].heldItem,'trainband');
  assert(h.c.locked());assert(h.c.queued());assert.equal(h.scenes.length,0);assert.equal(JSON.stringify(h.e.state),adventure,'Ranked enrollment must not heal or edit the adventure save');
  assert(!h.calls.some(call=>call.route.includes('/actions')||call.route.includes('/accept')));
});

test('existing v78 matches recover, accept actions and acknowledge with their unchanged version',async()=>{
  const h=await fixture();delete h.team[0].battleGrowth;h.begin();h.match.rulesVersion='ranked-v78';h.match.battle.rankedVersion='ranked-v78';const before=copy(h.match.battle);
  assert((await h.c.refresh()).ok);assert.equal(h.c.match.rulesVersion,'ranked-v78');assert.deepEqual(h.scenes[0].snapshot,before);
  const orders=copy(h.loaded.rules.hydrate(h.match.battle).legalOrders(h.match.side));assert((await h.c.submit(orders)).ok);assert.equal(h.c.match.rulesVersion,'ranked-v78');
  h.finish('win');assert((await h.c.refresh()).ok);assert((await h.c.acknowledge()).ok);assert(!h.c.locked());assert.equal(h.c.match,null);assert.equal(h.scenes.at(-1).snapshot,null);
  assert((await h.c.refresh()).ok);assert((await h.c.join(h.team)).ok);assert.equal(h.calls.filter(call=>call.route==='/world/ranked/queue'&&call.method==='POST').at(-1).body.rulesVersion,'ranked-v83-vernix');
});

test('invalid or duplicate individuals and species never create a queue request',async()=>{
  for(const kind of ['short','individual','species']){const h=await fixture(),team=copy(h.team);if(kind==='short')team.pop();if(kind==='individual')team[2]=copy(team[0]);if(kind==='species'){team[2]=copy(team[0]);team[2].uid='another-owned-mon';}
    const result=await h.c.join(team);assert.equal(result.ok,false,kind);assert(!h.calls.some(call=>call.method==='POST'),kind);assert(!h.c.locked(),kind);
  }
});

test('both queue matching and discovery automatically enter the authoritative match without an acceptance step',async()=>{
  for(const source of ['queue','discovery']){const h=await fixture();if(source==='queue')h.handler=(route,options)=>{if(route==='/world/ranked/queue'&&options.method==='POST'){h.begin();return h.reply({intent:{requestId:options.body.requestId,state:'matched'}});}};else h.begin(1);
    assert((source==='queue'?await h.c.join(h.team):await h.c.refresh()).ok);assert.equal(h.c.match.state,'battle');assert.equal(h.scenes.length,1);assert.deepEqual(h.scenes[0].snapshot,h.match.battle);assert.equal(h.scenes[0].side,h.match.side);assert(h.c.locked());assert(!h.c.queueIntent);assert.equal(h.calls.filter(call=>call.route.endsWith('/actions')).length,0);assert(!h.calls.some(call=>/accept|answer/.test(call.route)));
  }
});

test('an initial status discovery prevents an attempted second enrollment',async()=>{
  const h=await fixture();h.begin();const result=await h.c.join(h.team);assert.equal(result.ok,false);assert.equal(h.c.match.id,h.match.id);assert(h.c.locked());assert(!h.calls.some(call=>call.method==='POST'));
});

test('an uncertain enrollment retries its stable intent and preserves a readable failure through a successful poll',async()=>{
  const h=await fixture();let lose=true;h.handler=(route,options)=>{if(route==='/world/ranked/queue'&&options.method==='POST'&&lose){lose=false;return Promise.reject(Error('送信の応答が届きませんでした'));}};
  assert.equal((await h.c.join(h.team)).ok,false);const first=h.calls.find(call=>call.method==='POST');assert(h.c.queueIntent);assert(h.c.locked());assert(h.records.has(KEY+SELF));
  await h.c.refresh();assert.match(h.c.error,/応答/);const altered=copy(h.team);altered[0].nickname='別の内容';assert.equal((await h.c.join(altered)).ok,false);assert.equal(h.calls.filter(call=>call.method==='POST').length,1);
  assert((await h.c.join(h.team)).ok);assert.equal(h.calls.filter(call=>call.method==='POST')[1].body.requestId,first.body.requestId);assert.equal(h.c.queueIntent.phase,'waiting');
});

test('intent cancellation wins even when the original queue POST arrives after DELETE',async()=>{
  const h=await fixture(),gate=deferred();let delayed;
  h.handler=(route,options)=>{if(route==='/world/ranked/queue'&&options.method==='POST'){delayed={route,options:copy(options)};return gate.promise.then(()=>h.respond(route,options));}};
  const joining=h.c.join(h.team);await until(()=>!!delayed);assert.equal(h.c.busy.kind,'queue');const requestId=delayed.options.body.requestId;
  const result=await h.c.cancel();assert(result.ok&&result.cancelled);assert.deepEqual(h.calls.find(call=>call.method==='DELETE').body,{requestId});assert(!h.c.locked());gate.resolve();await joining;
  assert.equal(h.queue,null);assert.equal(h.c.queue,null);assert.equal(h.c.match,null);assert(!h.c.queueIntent);assert(!h.records.has(KEY+SELF));
});

test('cancelling before identity or initial status completes cannot later send a queue POST',async()=>{
  for(const boundary of ['identity','status']){const h=await fixture(),gate=deferred();let reached=false;
    if(boundary==='identity')h.identify=async()=>{reached=true;await gate.promise;return h.player;};else h.handler=route=>{if(route==='/world/ranked'){reached=true;return gate.promise.then(()=>h.reply());}};
    const joining=h.c.join(h.team);await until(()=>reached);assert(h.c.locked());assert((await h.c.cancel()).cancelled);gate.resolve();await joining;assert(!h.calls.some(call=>call.method==='POST'));assert(!h.c.locked());
  }
});

test('a cancel that races successful matching enters the match and never forfeits it',async()=>{
  const h=await fixture();await h.c.join(h.team);h.handler=(route,options)=>{if(options.method==='DELETE'){h.begin();return h.reply({intent:{requestId:options.body.requestId,state:'matched'}});}};
  const result=await h.c.cancel();assert(result.ok&&result.matched);assert(h.c.active());assert.equal(h.scenes.length,1);assert(!h.calls.some(call=>call.route.endsWith('/forfeit')));
});

test('human move and switch orders are validated, submitted once, and never resolved locally',async()=>{
  for(const orders of [[{type:'move',slot:0,move:0,target:0}],[{type:'switch',slot:0,index:1}]]){const h=await fixture();h.begin();await h.c.refresh();const before=JSON.stringify(h.c.match.battle);
    assert.equal((await h.c.submit([])).ok,false);assert((await h.c.submit(orders)).ok);assert.deepEqual(h.calls.find(call=>call.route.endsWith('/actions')).body.orders,orders);assert.equal(JSON.stringify(h.c.match.battle),before);assert.equal((await h.c.submit(orders)).ok,false);assert.equal(h.calls.filter(call=>call.route.endsWith('/actions')).length,1);
  }
});

test('uncertain action retries survive reload with their original round, content and request ID',async()=>{
  const h=await fixture();h.begin();await h.c.refresh();let failOnce=true;h.handler=route=>{if(route.endsWith('/actions')&&failOnce){failOnce=false;return Promise.reject(Error('行動の応答が不明です'));}};
  const orders=[{type:'move',slot:0,move:1,target:0}];assert.equal((await h.c.submit(orders)).ok,false);const sent=h.calls.find(call=>call.route.endsWith('/actions')).body;
  h.c=h.newController();assert((await h.c.refresh()).ok);assert.deepEqual(h.c.actionIntent.orders,orders);assert(h.c.locked());assert.equal((await h.c.submit([{type:'switch',slot:0,index:1}])).ok,false);assert((await h.c.submit(orders)).ok);
  const retry=h.calls.filter(call=>call.route.endsWith('/actions')).at(-1).body;assert.deepEqual(retry,sent);assert.equal(h.c.actionIntent,null);assert.equal(h.c.match.submitted[0],true);
});

test('an authoritative poll clears a lost-response error once the original action is confirmed',async()=>{
  const h=await fixture();h.begin();await h.c.refresh();let lost=true;
  h.handler=(route,options)=>{if(route.endsWith('/actions')&&lost){lost=false;h.respond(route,options);return Promise.reject(Error('応答を受け取れませんでした'));}};
  assert.equal((await h.c.submit([{type:'move',slot:0,move:0,target:0}])).ok,false);assert.match(h.c.error,/応答/);assert(h.c.actionIntent);
  assert((await h.c.refresh()).ok);assert.equal(h.c.actionIntent,null);assert.equal(h.c.error,'');assert.equal(h.c.match.submitted[0],true);assert.equal(h.calls.filter(call=>call.route.endsWith('/actions')).length,1);
});

test('older polling and older revisions cannot roll back an accepted action',async()=>{
  const h=await fixture();h.begin();await h.c.refresh();const gate=deferred(),old=h.reply();let held=false;
  h.handler=route=>{if(route==='/world/ranked'&&!held){held=true;return gate.promise;}};const pending=h.c.refresh();await until(()=>held);
  assert((await h.c.submit([{type:'move',slot:0,move:0,target:0}])).ok);const revision=h.c.match.revision;gate.resolve(old);await pending;assert.equal(h.c.match.revision,revision);assert.equal(h.c.match.submitted[0],true);
  h.handler=route=>route==='/world/ranked'?old:undefined;await h.c.refresh();assert.equal(h.c.match.revision,revision,'Even a later GET cannot apply a lower match revision');
});

test('connection loss retains the match lock until the service settles or recovers it',async()=>{
  const h=await fixture();h.begin();await h.c.refresh();h.now+=120000;h.handler=route=>route==='/world/ranked'?Promise.reject(Error('接続できません')):undefined;
  assert.equal((await h.c.refresh()).ok,false);assert(h.c.locked());assert.equal(h.c.match.state,'battle');assert(!h.scenes.some(scene=>scene.snapshot===null));assert.equal(h.c.state().remaining,0);
  h.handler=null;h.finish('void','double_disconnect');assert((await h.c.refresh()).ok);assert.equal(h.c.match.result.ratingDelta[0],0);assert(h.c.locked());assert((await h.c.acknowledge()).ok);assert(!h.c.locked());assert.equal(h.scenes.at(-1).snapshot,null);assert.equal(h.scenes.at(-1).id,uuid(900));assert(!h.records.has(KEY+SELF));
});

test('boolean scene rejection is retried and never claims ownership of an unrelated scene',async()=>{
  const h=await fixture();h.begin();h.sceneResult=false;await h.c.refresh();assert.equal(h.c.sceneId,null);assert(h.c.locked());h.c.reset();assert(!h.scenes.some(scene=>scene.snapshot===null));
  h.allowed=false;h.sceneResult=true;await h.c.refresh();assert.equal(h.c.sceneId,null);h.allowed=true;await h.c.refresh();assert.equal(h.c.sceneId,h.match.id);assert.equal(h.scenes.filter(scene=>scene.snapshot).length,2);
});

test('recovering an owned server match can overlay a solo battle without allowing fresh enrollment there',async()=>{
  const h=await fixture();h.allowed=false;h.resumeAllowed=true;h.e.battle={title:'冒険の対戦',turn:2};h.begin();const before=copy(h.e.battle);
  assert((await h.c.refresh()).ok);assert.equal(h.c.sceneId,h.match.id);assert.equal(h.scenes.length,1);assert.deepEqual(h.e.battle,before,'Only the bridge owns presentation; the adventure battle stays intact');
  const fresh=await fixture();fresh.allowed=false;fresh.resumeAllowed=true;assert.equal((await fresh.c.join(fresh.team)).ok,false);assert(!fresh.calls.some(call=>call.method==='POST'));
});

test('identity and same-player engine replacement reject stale callbacks while preserving scoped recovery',async()=>{
  const h=await fixture();h.begin();await h.c.refresh();const gate=deferred(),old=h.reply();h.handler=route=>route==='/world/ranked'?gate.promise:undefined;
  const pending=h.c.refresh();await until(()=>!!h.c.polling);h.c.reset();h.player={id:OTHER,name:'別の人'};gate.resolve(old);await pending;assert.equal(h.c.match,null);assert(h.records.has(KEY+SELF));assert(!h.records.has(KEY+OTHER));
  h.player={id:SELF,name:'自分の登録名'};h.handler=null;await h.c.refresh();h.e=new h.loaded.LT.Engine();h.e.newGame('komori');await h.c.refresh();assert.equal(h.c.engine,h.e);await h.c.refresh();assert.equal(h.c.match.id,h.match.id);
});

test('history failures remain contained and server settlement reason codes have specific labels',async()=>{
  const h=await fixture();h.identify=async()=>{throw Error('本人を確認できません');};await assert.doesNotReject(h.c.loadPanels());assert.match(h.c.panelsError,/確認/);
  for(const code of ['battle','forfeit','disconnect','turn_timeout','double_disconnect','double_timeout','rules_changed'])assert.notEqual(reasonText(code),'対戦終了',code);
});

async function browserFixture(){
  const h=await fixture(),nodes=[],events=[],timers=new Map(),closeEvents=[],listeners=new Map();let timerId=0,rafId=0;
  class Node{
    constructor(tag){this.tagName=tag;this.open=false;this.hidden=false;this.innerHTML='';this.dataset={};this.style={setProperty(){}};this.listeners={};this.regions={'.ranked-body':{scrollTop:0},'.ranked-command':{scrollTop:0}};}
    setAttribute(){} addEventListener(type,listener){(this.listeners[type]||=[]).push(listener);} showModal(){this.open=true;} close(){if(this.open){this.open=false;closeEvents.push(...(this.listeners.close||[]));}}
    querySelector(selector){return this.regions[selector]||null;} querySelectorAll(){return [];} contains(){return false;}
  }
  const document={hidden:false,activeElement:null,createElement:tag=>{const node=new Node(tag);nodes.push(node);return node;},body:{append(){}},addEventListener(type,listener){const list=listeners.get(type)||[];list.push(listener);listeners.set(type,list);},dispatchEvent:event=>{events.push(event);for(const listener of listeners.get(event.type)||[])listener(event);}};
  const context=vm.createContext({console,document,navigator:{onLine:true},performance:{now:()=>h.now},crypto:{randomUUID:()=>uuid(++h.nextUUID)},Date:class extends Date{static now(){return h.now;}},localStorage:h.storage,
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:()=>++rafId,cancelAnimationFrame(){},addEventListener(){},innerHeight:800,
    LT:{...h.loaded.LT,RankedRules:h.loaded.rules,Admin:{player:h.player,tradeIdentity:async()=>h.player,worldRequest:h.request},
      adminBridge:{isPlaying:()=>true,getEngine:()=>h.e,getRankedRoster:()=>[...h.e.state.party.map(mon=>({mon:copy(mon),where:'手持ち'})),...h.e.state.storage.map(mon=>({mon:copy(mon),where:'ひかえ'}))],canEnterRanked:()=>h.allowed,setRankedBattle:(snapshot,side,id)=>{h.scenes.push({snapshot:copy(snapshot),side,id});return true;},toast:message=>h.notes.push(message)}}
  });
  vm.runInContext(SOURCE,context);h.ui=context.LT.Ranked;h.context=context;h.document=document;h.nodes=nodes;h.events=events;h.timers=timers;h.closeEvents=closeEvents;h.dialog=()=>nodes.find(node=>node.id==='ranked-battle-dialog');
  h.click=async(action,index)=>{const event={target:{closest:()=>({disabled:false,dataset:{rankedAction:action,...(index===undefined?{}:{index:String(index)})}})}};for(const listener of h.dialog().listeners.click||[])await listener(event);};return h;
}

test('owned lobby includes party and storage choices, actual Lv50 stats and readable details',async()=>{
  const h=await browserFixture();assert((await h.ui.open()).ok);const html=h.dialog().innerHTML,preview=h.loaded.rules.previewMember(h.team[0]);assert(h.dialog().open);assert.match(html,/data-ranked-team="0"/);assert.match(html,/data-ranked-team="2"/);assert.match(html,/ひかえ/);assert.match(html,/育てた仲間/);assert.match(html,/Lv.24 → 対戦 Lv.50/);assert.match(html,new RegExp('<dt>こうげき</dt><dd>'+preview.stats.atk+'</dd>'));assert.match(html,/<summary aria-label="育てた仲間の能力・持ち物・技を確認">詳細<\/summary>/);assert.match(html,/振り分け：体力\+6 \/ こうげき\+5/);assert(!/レンタル|受け入れる|対戦を承認/.test(html));
  assert(h.events.some(event=>event.type==='pachi-ranked-state'&&event.detail.isOpen));await h.click('queue');assert(h.ui.isLocked());assert.match(h.dialog().innerHTML,/待機を取り消す/);assert.match(h.dialog().innerHTML,/data-ranked-team="0"[^>]*disabled/);
  assert.match(html,/実戦成長：23回（HP\+46、攻撃・防御・特攻・特防・素早さ 各\+23）/);assert.match(html,/Lv\.50でも全累積分を反映/);
});

test('matched UI opens automatically, but moves and forfeit still require explicit player choices',async()=>{
  const h=await browserFixture();h.begin();await h.ui.refresh();assert(h.dialog().open);assert.match(h.dialog().innerHTML,/ranked-canvas/);assert.match(h.dialog().innerHTML,/data-ranked-action="submit" disabled/);assert.equal((h.dialog().innerHTML.match(/data-ranked-action="submit"/g)||[]).length,1);assert.match(h.dialog().innerHTML,/<footer class="ranked-footer ranked-battle-footer">[\s\S]*data-ranked-action="submit"/);assert(!h.calls.some(call=>call.route.endsWith('/actions')));
  await h.click('move',0);assert(!h.calls.some(call=>call.route.endsWith('/actions')));await h.click('submit');assert.equal(h.calls.filter(call=>call.route.endsWith('/actions')).length,1);
  assert(h.ui.closeDialog());assert.match(h.dialog().innerHTML,/降参しますか/);assert(!h.dialog().innerHTML.includes('data-ranked-action="submit"'));assert(!h.calls.some(call=>call.route.endsWith('/forfeit')));await h.click('stay');assert(!h.dialog().innerHTML.includes('降参しますか'));
  h.ui.closeDialog();await h.click('confirm-forfeit');assert.equal(h.ui.session().result.outcome,'loss');assert.match(h.dialog().innerHTML,/-16 RP/);assert(h.ui.isLocked());await h.click('ack');assert(!h.ui.isLocked());assert.equal(h.scenes.at(-1).snapshot,null);
});

test('battle health starts from the visual snapshot, and names are escaped in server-provided panels',async()=>{
  const h=await browserFixture();h.begin();const old=copy(h.match.battle);h.match.battle.teams[0].monsters[0].hp=1;h.match.players[1].name='<img src=x onerror=attack()>';
  h.context.LT.BattleVFX={onlineBusy:()=>true,onlineView:()=>old,onlineProgress:()=>({shown:0,total:0})};await h.ui.refresh();const html=h.dialog().innerHTML,mon=old.teams[0].monsters[0];assert(html.includes('>'+mon.hp+' / '+mon.maxHp+'</small>'));assert(!html.includes('>1 / '+mon.maxHp+'</small>'));assert.match(html,/&lt;img src=x onerror=attack\(\)&gt;/);assert(!html.includes('<img src=x'));assert(!h.calls.some(call=>call.route.endsWith('/actions')));
});

test('an in-progress v82 ranked match renders original names and moves without changing its snapshot or current catalog',async()=>{
  const h=await browserFixture(),legacy=h.loaded.LT.LegacyBattles,lunar=JSON.parse(fs.readFileSync(require.resolve('./fixtures/v82-lunar-leader-save.json'),'utf8'));
  const team=[...lunar.party,copy(h.team[1])].map(mon=>{const member=copy(mon);delete member.nickname;return member;});
  h.begin();h.match.battle=copy(legacy.ranked().create(team,[team[1],team[0],team[2]],83));h.match.rulesVersion=h.match.battle.rankedVersion;
  const before=JSON.stringify(h.match.battle),catalog=JSON.stringify(h.loaded.LT.DATA);
  assert((await h.ui.refresh()).ok);const html=h.dialog().innerHTML;
  assert.match(html,/ルナクス/);assert.match(html,/ルナクシオン/);
  for(const id of ['lunax_crescent','lunax_nova','lunax_aegis','lunax_renew'])assert(html.includes(legacy.move(id).name),id+' keeps its archived move label');
  assert.equal(JSON.stringify(h.match.battle),before);assert.equal(JSON.stringify(h.scenes.at(-1).snapshot),before);
  assert.equal(JSON.stringify(h.loaded.LT.DATA),catalog);assert.equal(h.loaded.LT.DATA.species.lunaxion,undefined);assert.equal(h.loaded.LT.DATA.moves.lunax_nova,undefined);
  h.match.battle.teams[0].monsters[0].nickname='<A>';h.match.revision++;assert((await h.ui.refresh()).ok);assert.match(h.dialog().innerHTML,/&lt;A&gt;/);assert(!h.dialog().innerHTML.includes('><A><'));
  await h.click('move',0);await h.click('submit');assert.equal(h.calls.filter(call=>call.route.endsWith('/actions')).length,1);assert.equal(h.ui.session().battle.rankedVersion,'ranked-v79-growth');
});

test('a queued native close event cannot dismiss a reopened ranked lobby',async()=>{
  const h=await browserFixture();await h.ui.open();assert(h.ui.closeDialog());assert(!h.dialog().open);await h.ui.open();assert(h.dialog().open);for(const listener of h.closeEvents.splice(0))listener();assert(h.dialog().open);assert(h.ui.isDialogOpen());
});

test('automatic battle entry resets lobby scroll while same-match turn updates preserve reading position',async()=>{
  const h=await browserFixture();await h.ui.open();const body=h.dialog().querySelector('.ranked-body'),command=h.dialog().querySelector('.ranked-command');body.scrollTop=420;command.scrollTop=80;
  h.begin();await h.ui.refresh();assert.equal(body.scrollTop,0);assert.equal(command.scrollTop,0);
  body.scrollTop=120;command.scrollTop=44;h.match.revision++;h.match.submitted[1]=true;await h.ui.refresh();assert.equal(body.scrollTop,120);assert.equal(command.scrollTop,44);
  h.match.id=uuid(902);await h.ui.refresh();assert.equal(body.scrollTop,0);assert.equal(command.scrollTop,0);
  body.scrollTop=90;command.scrollTop=36;h.finish();await h.ui.refresh();assert.equal(body.scrollTop,0);assert.equal(command.scrollTop,0);
});

test('polling pauses while hidden and restores a match immediately after visibility returns',async()=>{
  const h=await browserFixture();await h.ui.open();h.document.hidden=true;h.document.dispatchEvent({type:'visibilitychange'});assert.equal(h.timers.size,0);const count=h.calls.length;assert((await h.ui.refresh()).skipped);assert.equal(h.calls.length,count);
  h.begin();h.document.hidden=false;h.document.dispatchEvent({type:'visibilitychange'});const [id,timer]=[...h.timers][0];assert.equal(timer.delay,0);h.timers.delete(id);await timer.fn();assert(h.ui.session());assert(h.ui.isDialogOpen());
});
