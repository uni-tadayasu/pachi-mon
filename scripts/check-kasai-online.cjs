#!/usr/bin/env node
'use strict';
// Actual OnlineUI and DuelSession, with a controlled DOM/transport boundary.
// Trainer proof integration below uses the shipped Worker and SQLite migrations.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto,randomBytes}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const blocks=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!/\bsrc=|application\/ld\+json/.test(m[1])).map(m=>m[2]);
const model=vm.createContext({console});
for(const code of blocks){vm.runInContext(code,model);if(model.LT?.Engine)break;}
const duelSource=blocks.find(code=>code.includes('deterministic, save-independent rental-team duels'));
const sessionSource=blocks.find(code=>code.includes('peer-to-peer casual duel protocol'));
const uiSource=blocks.find(code=>code.includes('Pachi Link — short-code, human-versus-human battles'));
assert(duelSource&&sessionSource&&uiSource);
const KASAI='謎のトレーナー カサイ',OTHER='2'.repeat(32),copy=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(setImmediate);};
async function until(predicate,message){const deadline=Date.now()+5000;while(!predicate()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));assert(predicate(),message);}

function harness({player={id:'P1111111111111111',name:'冒険者',isAdmin:false},request=async()=>{throw Error('Proof service unavailable');},hostResult}={}){
  const nodes=new Map(),peers=[],requests=[],toasts=[],events=[],timers=new Map();let timerId=0;
  function element(id){
    const listeners=new Map(),classes=new Set();
    return {id,hidden:false,open:false,disabled:false,textContent:'',dataset:{},innerHTML:'',
      classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),toggle(x,on){if(on)classes.add(x);else classes.delete(x);},contains:x=>classes.has(x)},
      addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);},
      async emit(type,event={}){for(const fn of listeners.get(type)||[])await fn(event);},
      showModal(){this.open=true;},close(){this.open=false;for(const fn of listeners.get('close')||[])fn();},
      focus(){document.activeElement=this;},querySelectorAll(){return [];},querySelector(){return null;},setAttribute(){},
      closest(selector){return selector==='button'?this:null;}
    };
  }
  const document={hidden:false,activeElement:null,
    getElementById(id){if(!nodes.has(id))nodes.set(id,element(id));return nodes.get(id);},
    querySelectorAll(){return [];},addEventListener(){},dispatchEvent(event){events.push(event.type);}
  };
  class Peer {
    static normalizeCode(code){if(typeof code!=='string'||!/^[A-HJ-NP-Z2-9]{6}$/i.test(code))throw Error('Invalid code');return code.toUpperCase();}
    constructor(options){this.options=options;this.sent=[];this.connected=false;this.state='idle';this.role=null;this.hostCalls=0;this.joinCalls=[];peers.push(this);}
    async host(){this.role=0;this.state='waiting';this.hostCalls++;const code=hostResult?await hostResult:'ABC234';this.code=code;this.options.onStatus({message:'Waiting',code});return code;}
    async join(code){this.role=1;this.code=code;this.state='joining';this.joinCalls.push(code);return code;}
    send(message){this.sent.push(copy(message));return true;}
    close(reason){this.connected=false;this.state='closed';this.options.onClose?.({reason});}
    opened(role=this.role){this.role=role;this.connected=true;this.state='connected';this.options.onOpen({role,code:this.code||'ABC234'});}
    receive(message){this.options.onMessage(message);}
  }
  const engine=new model.LT.Engine();engine.newGame(model.LT.DATA.starters[0]);
  engine.state.party.push(engine.makeMonster(model.LT.DATA.starters[1],20),engine.makeMonster(model.LT.DATA.starters[2],20));
  const context=vm.createContext({console,document,crypto:webcrypto,TextEncoder,Uint8Array,Uint32Array,performance,
    navigator:{onLine:true},CustomEvent:class{constructor(type){this.type=type;}},
    setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame:()=>1,cancelAnimationFrame(){},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    LT:{...model.LT,PeerLink:Peer,Art:{ready:Promise.resolve(),creature(){}},PixelSprites:{duel(){}},
      Admin:{player,async worldRequest(route,options){requests.push({route,options:copy(options)});return request(route,options);}},
      adminBridge:{getEngine:()=>engine,toast:message=>toasts.push(message)}},addEventListener(){}
  });
  context.window=context;
  vm.runInContext(duelSource,context);vm.runInContext(sessionSource,context);vm.runInContext(uiSource,context);
  const modal=document.getElementById('online-modal');
  return {context,LT:context.LT,ui:context.LT.OnlineUI,peers,requests,toasts,nodes,events,modal,
    async click(id){const button=document.getElementById(id);button.disabled=false;await modal.emit('click',{target:button});await settle();},
    async connectHost(){assert(this.ui.open({autoHost:true}));await settle();const peer=peers.at(-1);peer.opened(0);await settle();return peer;},
    async hello(peer,{rules=context.LT.Duel.rulesFingerprint(),...extra}={}){peer.receive({v:context.LT.DuelSession.VERSION,t:'hello',role:1,rules,...extra});await settle();},
    expire(ms){for(const [id,timer] of timers)if(timer.ms===ms){timers.delete(id);timer.fn();}},
    close(){document.getElementById('online-modal').close();}
  };
}

class LocalD1 {
  constructor(){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');for(const file of fs.readdirSync(path.join(root,'server/drizzle')).filter(file=>/^\d+.*\.sql$/.test(file)).sort())this.sqlite.exec(fs.readFileSync(path.join(root,'server/drizzle',file),'utf8'));}
  prepare(sql){const db=this.sqlite;return{values:[],bind(...values){this.values=values;return this;},execute(){const results=db.prepare(sql).all(...this.values).map(row=>({...row}));return{results,success:true,meta:{changes:db.prepare('SELECT changes() AS n').get().n}};},async first(){return this.execute().results[0]||null;},async all(){return this.execute();},async run(){return this.execute();}};}
  async batch(statements){this.sqlite.exec('BEGIN IMMEDIATE');try{const out=statements.map(statement=>statement.execute());this.sqlite.exec('COMMIT');return out;}catch(error){this.sqlite.exec('ROLLBACK');throw error;}}
}
async function service(){
  const worker=(await import('../server/server.mjs')).default;
  const env={DB:new LocalD1(),ADMIN_CLAIM_KEY:'local-test-admin-claim-key',DUEL_SIGNING_KEY:'local-test-trainer-signing-key-32-characters'};
  async function call(token,route,{method='POST',body}={}){
    const headers={'Content-Type':'application/json',Origin:'https://test.example','CF-Connecting-IP':'192.0.2.1'};if(token)headers.Authorization='Bearer '+token;
    const response=await worker.fetch(new Request('https://test.example/api'+route,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})}),env),data=await response.json();
    if(!response.ok)throw Object.assign(Error(data.error?.message||'API failure'),{status:response.status,code:data.error?.code});return data;
  }
  async function player(name,admin=false){
    const token=randomBytes(32).toString('base64url');let {player}=await call(null,'/register',{body:{token,name}});
    if(admin)({player}=await call(token,'/admin/claim',{body:{key:env.ADMIN_CLAIM_KEY}}));
    return{player,call:(route,options)=>call(token,route,options)};
  }
  return{player,close:()=>env.DB.sqlite.close()};
}

test('invite URLs stay manual; only explicit field flags create or join a room',async()=>{
  const manual=harness();assert(manual.ui.open({joinCode:'ABC234'}));await settle();assert.equal(manual.peers.length,0);assert.match(manual.nodes.get('online-content').innerHTML,/ABC234/);manual.close();
  const ready=deferred(),calls=[],host=harness();assert(host.ui.open({autoHost:true,encounter:{id:'P2222222222222222',name:'対戦相手',isAdmin:false,avatar:'male'},onRoomReady:async code=>{calls.push(code);await ready.promise;}}));
  await settle();assert.deepEqual(calls,['ABC234']);assert.equal(host.peers[0].hostCalls,1);assert.match(host.nodes.get('online-content').innerHTML,/対戦相手/);
  assert(host.ui.setWorldNotice('相手の返事を待っています。'));assert.equal(host.nodes.get('online-status').textContent,'相手の返事を待っています。');
  ready.resolve();await settle();assert.deepEqual(calls,['ABC234']);host.close();
  const join=harness();assert(join.ui.open({autoJoin:true,joinCode:'ABC234',encounter:{id:'P2222222222222222',name:'カサイ',isAdmin:true,avatar:'kasai'}}));await settle();assert.deepEqual(join.peers[0].joinCalls,['ABC234']);assert.equal(join.LT.onlineEncounter.kasai,true);join.close();
  const invalid=harness();assert.equal(invalid.ui.open({autoJoin:true}),false);assert.equal(invalid.ui.open({autoJoin:true,autoHost:true,joinCode:'ABC234'}),false);assert.equal(invalid.peers.length,0);
});

test('cancelWorldWait closes only an unconnected field room and ignores a late host result',async()=>{
  const pending=deferred(),calls=[],h=harness({hostResult:pending.promise});
  assert(h.ui.open({autoHost:true,encounter:{id:'P2222222222222222',name:'相手'},onRoomReady:code=>calls.push(code)}));
  assert(h.ui.cancelWorldWait('お誘いを取り消しました。'));assert.equal(h.modal.open,false);assert.equal(h.LT.onlineEncounter,null);pending.resolve('ABC234');await settle();assert.equal(calls.length,0);assert.equal(h.modal.open,false);
  const connected=harness({request:async()=>({pass:'own.proof'})});assert(connected.ui.open({autoHost:true,encounter:{id:'P2222222222222222',name:'相手'}}));await settle();connected.peers[0].opened(0);await connected.hello(connected.peers[0]);assert.equal(connected.ui.cancelWorldWait('期限切れ'),false);assert(connected.modal.open);connected.close();
});

test('actual Worker signs ordinary internet duels and verifies the opponent current Kasai identity',async()=>{
  const api=await service();try{
    const me=await api.player('こもり'),opponent=await api.player('管理者の元の名前',true),h=harness({player:me.player,request:me.call});
    const peer=await h.connectHost();assert.equal(h.requests.length,0,'No identity proof before the exact hello handshake');
    const hello=peer.sent.find(message=>message.t==='hello');await h.hello(peer);
    await until(()=>peer.sent.some(message=>message.t==='trainer-profile'),'Real crypto signing must produce the profile envelope');
    const envelope=peer.sent.find(message=>message.t==='trainer-profile');assert.equal(envelope.sessionId,hello.session);assert.equal(envelope.side,0);
    assert.equal(h.requests.filter(entry=>entry.route==='/world/trainer-pass').length,1);
    const self=await opponent.call('/world/trainer-pass/verify',{body:{sessionId:hello.session,side:0,pass:envelope.pass}});assert.equal(self.trainer.id,me.player.id);assert.equal(self.trainer.isAdmin,false);
    const {pass}=await opponent.call('/world/trainer-pass',{body:{sessionId:hello.session,side:1}});
    peer.receive({t:'trainer-profile',sessionId:hello.session,side:1,pass});await until(()=>h.LT.onlineEncounter?.verified,'Real crypto verification must adopt the current signed trainer');
    assert.equal(h.LT.onlineEncounter.kasai,true);assert.equal(h.LT.onlineEncounter.verified,true);assert.equal(h.LT.onlineEncounter.opponent.id,opponent.player.id);assert.equal(h.LT.onlineEncounter.opponent.name,KASAI);assert.equal(h.LT.onlineEncounter.opponent.avatar,'kasai');
    await h.click('link-ready');assert(peer.sent.some(message=>message.t==='ready'),'Normal team readiness still works after metadata');assert(!peer.sent.some(message=>message.t==='abort'));
    h.close();assert.equal(h.LT.onlineEncounter,null);
  }finally{api.close();}
});

test('the verified local administrator sends the exact Kasai display name without changing the chosen normal name',async()=>{
  const h=harness({player:{id:'P1111111111111111',name:'保存名',isAdmin:true}}),peer=await h.connectHost();await h.hello(peer);
  assert.equal(h.LT.onlineEncounter.kasai,true);assert.match(h.nodes.get('online-content').innerHTML,/value="謎のトレーナー カサイ" disabled/);
  await h.click('link-ready');assert.equal(peer.sent.find(message=>message.t==='ready').team.name,KASAI);h.close();
});

for(const [role,registeredName,avatar,displayName] of [['sub','紫の旅人','sub-admin','サカイ'],['sub-sub','金色の旅人','sub-sub-admin','イサカ']]) {
  test(`${role} operator trainer proof applies the fixed operator name and distinct avatar`,async()=>{
    const api=await service();try{
      const main=await api.player('メイン',true),deputy=await api.player(registeredName),visitor=await api.player('訪問者');
      await main.call('/admin/devices',{body:{playerId:deputy.player.id,role,confirmed:true}});
      const h=harness({player:visitor.player,request:visitor.call}),peer=await h.connectHost();await h.hello(peer);
      const hello=peer.sent.find(message=>message.t==='hello');
      const {pass}=await deputy.call('/world/trainer-pass',{body:{sessionId:hello.session,side:1}});
      peer.receive({t:'trainer-profile',sessionId:hello.session,side:1,pass});
      await until(()=>h.LT.onlineEncounter?.verified,'Operator trainer proof must verify');
      const profile=h.LT.onlineEncounter.opponent;
      assert.equal(profile.name,displayName);assert.equal(profile.adminRole,role);
      assert.equal(profile.avatar,avatar);assert.equal(profile.isAdmin,true);
      assert.equal(h.LT.onlineEncounter.kasai,true,'Both deputies retain the operator battle features');
      h.close();
    }finally{api.close();}
  });

  test(`the local ${role} operator uses its fixed operator name in battle readiness`,async()=>{
    const h=harness({player:{id:'P1111111111111111',name:registeredName,isAdmin:true,adminRole:role}}),peer=await h.connectHost();await h.hello(peer);
    assert(h.nodes.get('online-content').innerHTML.includes('value="'+displayName+'" disabled'));
    await h.click('link-ready');assert.equal(peer.sent.find(message=>message.t==='ready').team.name,displayName);assert.equal(h.LT.Admin.player.name,registeredName);h.close();
  });
}

test('directed field rooms block readiness until the signed account matches the exact intended trainer',async()=>{
  const api=await service();try{
    const me=await api.player('誘う人'),expected=await api.player('会った相手',true),wrong=await api.player('別のアカウント');
    for(const [signer,match] of [[wrong,false],[expected,true]]){
      const h=harness({player:me.player,request:me.call});
      assert(h.ui.open({autoHost:true,encounter:{id:expected.player.id,name:KASAI,isAdmin:true,avatar:'kasai'}}));await settle();
      const peer=h.peers.at(-1);peer.opened(0);await h.hello(peer);
      await until(()=>peer.sent.some(message=>message.t==='trainer-profile'),'Own directed proof must be sent');
      assert.match(h.nodes.get('online-content').innerHTML,/id="link-ready"[^>]*disabled>対戦相手を確認しています/);
      await h.click('link-ready');assert(!peer.sent.some(message=>message.t==='ready'),'A fast or programmatic ready click cannot race identity verification');
      const sessionId=peer.sent.find(message=>message.t==='hello').session;
      const {pass}=await signer.call('/world/trainer-pass',{body:{sessionId,side:1}});
      peer.receive({t:'trainer-profile',sessionId,side:1,pass});
      if(match){
        await until(()=>h.LT.onlineEncounter?.verified,'Expected signed account must be verified');assert(h.modal.open);assert.equal(h.LT.onlineEncounter.opponent.id,expected.player.id);
        await h.click('link-ready');assert(peer.sent.some(message=>message.t==='ready'),'Matching signed counterpart unlocks the real readiness action');
        assert.equal(h.LT.onlineEncounter.kasai,true);h.close();
      }else{
        await until(()=>!h.modal.open,'Wrong signed account must close the directed room');assert.equal(peer.state,'closed');assert.equal(h.LT.onlineEncounter,null);assert(!peer.sent.some(message=>message.t==='ready'));
        assert(h.toasts.some(message=>/話しかけた相手と接続先が一致しません/.test(message)));
      }
    }
  }finally{api.close();}
});

test('directed identity timeouts and unavailable signing return to the field without a battle',async()=>{
  for(const unavailable of [false,true]){
    const h=harness({request:async()=>{if(unavailable)throw Object.assign(Error('Unavailable'),{status:503});return{pass:'own.proof'};}});
    assert(h.ui.open({autoHost:true,encounter:{id:'P2222222222222222',name:'相手',isAdmin:false,avatar:'male'}}));await settle();const peer=h.peers[0];peer.opened(0);await h.hello(peer);
    if(!unavailable){assert(h.modal.open);await h.click('link-ready');assert(!peer.sent.some(message=>message.t==='ready'));h.expire(20000);}
    assert.equal(h.modal.open,false);assert.equal(peer.state,'closed');assert.equal(h.LT.onlineEncounter,null);assert(!peer.sent.some(message=>message.t==='ready'));assert(h.toasts.some(message=>/確認.*フィールド/.test(message)));
  }
});

test('old or extended hello messages fail before any signed profile request or envelope',async()=>{
  for(const extra of [{rules:'old-v54-fingerprint'},{unapproved:true}]){
    const h=harness(),peer=await h.connectHost();await h.hello(peer,extra);
    assert.equal(h.requests.length,0);assert(!peer.sent.some(message=>message.t==='trainer-profile'));assert(peer.sent.some(message=>message.t==='abort'));assert.match(h.nodes.get('online-status').textContent,/一致しません/);h.close();
  }
  const h=harness();assert.equal(h.LT.Duel.rules.trainerIdentity,'server-signed-v55');
  const older=vm.createContext({console,LT:{...model.LT}});vm.runInContext(duelSource.replace("    trainerIdentity: 'server-signed-v55',\n",''),older);
  assert.notEqual(h.LT.Duel.rulesFingerprint(),older.LT.Duel.rulesFingerprint());
});

test('malformed, foreign-session, wrong-side and repeated proofs never enter the combat protocol',async()=>{
  const h=harness(),peer=await h.connectHost(),sessionId=peer.sent.find(message=>message.t==='hello').session;
  peer.receive({t:'trainer-profile',sessionId,side:1,pass:'early.proof'});await settle();assert.equal(h.requests.length,0);
  await h.hello(peer);const afterHello=h.requests.filter(entry=>entry.route.endsWith('/verify')).length;assert.equal(afterHello,1,'A bounded pre-hello proof is checked only after hello succeeds');
  for(const message of [{t:'trainer-profile'},{t:'trainer-profile',sessionId,side:1,pass:'x'.repeat(4097)},{t:'trainer-profile',sessionId:OTHER,side:1,pass:'foreign.proof'},{t:'trainer-profile',sessionId,side:0,pass:'wrong.side'},{t:'trainer-profile',sessionId,side:1,pass:'extra.field',isAdmin:true}])peer.receive(message);
  await settle();assert.equal(h.requests.filter(entry=>entry.route.endsWith('/verify')).length,afterHello);
  for(let i=0;i<10;i++)peer.receive({t:'trainer-profile',sessionId,side:1,pass:`candidate${i}.proof`});await settle();
  assert.equal(h.requests.filter(entry=>entry.route.endsWith('/verify')).length,3,'Verification requests are capped per connection');assert(!peer.sent.some(message=>message.t==='abort'));
  assert.equal(h.LT.onlineEncounter.kasai,false);await h.click('link-ready');assert(peer.sent.some(message=>message.t==='ready'));h.close();
});

test('a late verified administrator proof cannot mark a newly opened room as Kasai',async()=>{
  const verification=deferred(),h=harness({request:async route=>route.endsWith('/verify')?verification.promise:{pass:'own.proof'}}),peer=await h.connectHost();await h.hello(peer);
  const sessionId=peer.sent.find(message=>message.t==='hello').session;peer.receive({t:'trainer-profile',sessionId,side:1,pass:'valid.proof'});await settle();
  h.close();assert(h.ui.open({joinCode:'XYZ789'}));verification.resolve({trainer:{id:'P2222222222222222',name:KASAI,isAdmin:true,avatar:'kasai'}});await settle();
  assert.equal(h.LT.onlineEncounter.kasai,false);assert.equal(h.LT.onlineEncounter.opponent,null);assert.equal(h.LT.onlineEncounter.verified,undefined);h.close();
});

test('missing signing configuration is nonfatal and never changes ordinary team readiness',async()=>{
  const h=harness({request:async()=>{throw Object.assign(Error('Not configured'),{status:503});}}),peer=await h.connectHost();await h.hello(peer);await h.click('link-ready');
  assert.equal(h.requests.filter(entry=>entry.route==='/world/trainer-pass').length,1);assert(!peer.sent.some(message=>message.t==='trainer-profile'));assert(peer.sent.some(message=>message.t==='ready'));assert(!peer.sent.some(message=>message.t==='abort'));h.close();
});
