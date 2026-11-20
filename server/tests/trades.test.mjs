import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import worker,{validateTradeMonster} from '../server.mjs';

class LocalD1{
 constructor(){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');for(const file of ['0000_admin.sql','0001_trades.sql','0006_sub_admin.sql','0007_third_admin.sql','0009_global_chat.sql','0010_ranked.sql'])this.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));}
 prepare(sql){const db=this;return {values:[],bind(...v){this.values=v;return this;},execute(){const results=db.sqlite.prepare(sql).all(...this.values).map(row=>({...row}));return {results,success:true,meta:{changes:db.sqlite.prepare('SELECT changes() AS n').get().n}};},async first(){return this.execute().results[0]||null;},async all(){return this.execute();},async run(){return this.execute();}};}
 async batch(statements){this.sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>s.execute());this.sqlite.exec('COMMIT');return results;}catch(e){this.sqlite.exec('ROLLBACK');throw e;}}
}
function setup(){
 const env={DB:new LocalD1()};let address=0;
 async function call(path,{token,method='GET',body,ip}={}){
  const headers={'Content-Type':'application/json',Origin:'https://uni-tadayasu.github.io','CF-Connecting-IP':ip||'192.0.2.'+(++address)};if(token)headers.Authorization='Bearer '+token;
  const res=await worker.fetch(new Request('https://trades.example/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);return {status:res.status,...await res.json()};
 }
 async function register(name='旅人'){const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');const r=await call('/register',{method:'POST',body:{name,token}});assert.equal(r.status,200);return {token,...r.player};}
 async function create(player,requestId=crypto.randomUUID()){const r=await call('/trades',{token:player.token,method:'POST',body:{requestId}});assert.equal(r.status,200);return {requestId,trade:r.trade};}
 async function ready(hostMonster=mon('komori','alpha'),guestMonster=mon('shizuku','beta')){const a=await register('甲'),b=await register('乙');let {trade}=await create(a);trade=(await call('/trades/join',{token:b.token,method:'POST',body:{code:trade.code}})).trade;trade=(await call('/trades/'+trade.id+'/offer',{token:a.token,method:'POST',body:{revision:trade.revision,monster:hostMonster}})).trade;trade=(await call('/trades/'+trade.id+'/offer',{token:b.token,method:'POST',body:{revision:trade.revision,monster:guestMonster}})).trade;return {a,b,trade};}
 return {env,call,register,create,ready};
}
let DATA,Engine;
{
 const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8'),context={console};
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(/\bsrc=|application\/ld\+json/.test(match[1]))continue;runInNewContext(match[2],context);if(context.LT?.Engine)break;}
 ({DATA,Engine}=context.LT);
}
// Monsters travel in the exchange catalog: the game converts its current moves' PP to it (Engine#tradeWirePP).
function mon(species='komori',uid='test-mon'){const e=new Engine(),m=JSON.parse(JSON.stringify(e.makeMonster(species,20)));m.uid=uid;m.hp-=3;m.xp=11;m.shiny=true;m.nickname='なかま';m.pp=JSON.parse(JSON.stringify(e.tradeWirePP(m)));m.pp[Object.keys(m.pp)[0]]=1;return m;}

test('trade catalog matches every ordinary species and preserves all legal snapshot fields',()=>{
 let count=0;for(const [id,s]of Object.entries(DATA.species)){
  const m=mon(id);if(s.specialOnly||s.adminOnly){assert.throws(()=>validateTradeMonster(m));continue;}
  assert.deepEqual(validateTradeMonster(m),m);count++;
 }
 assert.equal(count,254); // 253 ordinary + legendary; retired IDs stay accepted server-side for older clients
 for(const change of [{species:'missing'},{species:'floravelle'},{species:'futo'},{level:101},{xp:99999},{hp:99999},{shiny:'true'},{grantId:'admin-legendary:P1234567890abcdef'},{customStats:{}},{customMoves:[]},{futoConfigLevel:70},{nickname:'123456'},{nickname:'bad\u202e'},{pp:{fake:5}},{uid:'bad/id'}])assert.throws(()=>validateTradeMonster({...mon(),...change}),JSON.stringify(change));
 assert.equal(validateTradeMonster(mon('arvelion')).species,'arvelion');
 const absent=mon();delete absent.shiny;delete absent.nickname;assert.equal(validateTradeMonster(absent).shiny,false);assert(!('nickname'in validateTradeMonster(absent)));
 assert.equal(validateTradeMonster({...mon(),nickname:'👨‍👩‍👧‍👦🌸'}).nickname,'👨‍👩‍👧‍👦🌸');
});

test('battle growth survives the trade envelope and extends HP only within its original-level bound',()=>{
 const base=mon(),plain=validateTradeMonster(base);
 assert.deepEqual(validateTradeMonster({...base,battleGrowth:0}),plain,'Zero retains the legacy envelope');
 for(const battleGrowth of [1,7,19]){
  const grown={...base,battleGrowth};grown.hp=new Engine().stats({...grown,pp:undefined}).hp;
  const checked=validateTradeMonster(grown);assert.equal(checked.battleGrowth,battleGrowth);assert.equal(checked.hp,grown.hp);
  assert.throws(()=>validateTradeMonster({...grown,hp:grown.hp+1}));
 }
 for(const battleGrowth of [-1,.5,20,99,100,'1',null,false])assert.throws(()=>validateTradeMonster({...base,battleGrowth}),String(battleGrowth));
 const max={...base,level:100,xp:0,battleGrowth:99};assert.equal(validateTradeMonster(max).battleGrowth,99);
 const first={...base,level:1,xp:0,hp:1,battleGrowth:0};assert.equal(validateTradeMonster(first).battleGrowth,undefined);assert.throws(()=>validateTradeMonster({...first,battleGrowth:1}));
});

test('grown offers require both clients to support growth before committing and retain it in recoverable receipts',async()=>{
 const h=setup(),{a,b,trade}=await h.ready({...mon('komori','alpha'),battleGrowth:7},{...mon('shizuku','beta'),battleGrowth:3});
 const confirm=(actor,supportsBattleGrowth)=>h.call('/trades/'+trade.id+'/confirm',{token:actor.token,method:'POST',body:{revision:trade.revision,...(supportsBattleGrowth===undefined?{}:{supportsBattleGrowth})}});
 for(const supported of [undefined,false,1,'true']){const rejected=await confirm(a,supported);assert.equal(rejected.status,409);assert.equal(rejected.error.code,'TRADE_CLIENT_UPDATE_REQUIRED');}
 let row=h.env.DB.sqlite.prepare('SELECT * FROM trades WHERE id=?').get(trade.id);assert.equal(row.state,'open');assert.equal(row.host_confirm,null);assert.equal(row.guest_confirm,null);
 assert.equal((await confirm(a,true)).trade.state,'open');
 assert.equal((await confirm(b)).error.code,'TRADE_CLIENT_UPDATE_REQUIRED');
 const done=await confirm(b,true);assert.equal(done.trade.state,'committed');assert.equal(done.trade.receipt.incoming.battleGrowth,7);assert.equal(done.trade.receipt.outgoing.battleGrowth,3);
 const other=await h.call('/trades/'+trade.id,{token:a.token});assert.equal(other.trade.receipt.incoming.battleGrowth,3);assert.equal(other.trade.receipt.outgoing.battleGrowth,7);
 assert.deepEqual((await confirm(b,true)).trade.receipt,done.trade.receipt,'A retried consent does not change earned growth');
 assert.deepEqual((await h.call('/trades/'+trade.id+'/ack',{token:a.token,method:'POST',body:{}})).trade.receipt,other.trade.receipt);
 row=h.env.DB.sqlite.prepare('SELECT * FROM trades WHERE id=?').get(trade.id);assert.equal(JSON.parse(row.host_offer).battleGrowth,7);assert.equal(JSON.parse(row.guest_offer).battleGrowth,3);
});

test('invalid or changed battle growth cannot overwrite or confirm an earlier offered individual',async()=>{
 const h=setup(),{a,b,trade}=await h.ready({...mon('komori','alpha'),battleGrowth:7});
 const offer=monster=>h.call('/trades/'+trade.id+'/offer',{token:a.token,method:'POST',body:{revision:trade.revision,monster}});
 const before=h.env.DB.sqlite.prepare('SELECT host_offer,revision FROM trades WHERE id=?').get(trade.id);
 for(const battleGrowth of [-1,1.5,100,20,null,'7'])assert.equal((await offer({...mon('komori','alpha'),battleGrowth})).status,400);
 assert.deepEqual(h.env.DB.sqlite.prepare('SELECT host_offer,revision FROM trades WHERE id=?').get(trade.id),before);
 await h.call('/trades/'+trade.id+'/confirm',{token:b.token,method:'POST',body:{revision:trade.revision,supportsBattleGrowth:true}});
 const changed=await offer({...mon('komori','alpha'),battleGrowth:8});assert.equal(changed.trade.revision,trade.revision+1);assert.equal(changed.trade.guest.confirmed,false);
 assert.equal((await h.call('/trades/'+trade.id+'/confirm',{token:b.token,method:'POST',body:{revision:trade.revision,supportsBattleGrowth:true}})).error.code,'TRADE_CHANGED');
});

test('create/join is authenticated, six-code, idempotent and has one active room per player',async()=>{
 const {call,register,create,env}=setup(),a=await register(),b=await register(),c=await register();
 assert.equal((await call('/trades/active')).status,401);
 const {requestId,trade}=await create(a);assert.match(trade.code,/^[A-HJ-NP-Z2-9]{6}$/);assert.equal(trade.you,'host');assert.equal(trade.guest,null);
 const replay=await create(a,requestId);assert.equal(replay.trade.id,trade.id);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM trades').get().n,1);
 assert.equal((await call('/trades',{token:a.token,method:'POST',body:{requestId:crypto.randomUUID()}})).error.code,'ACTIVE_TRADE');
 const joined=await call('/trades/join',{token:b.token,method:'POST',body:{code:trade.code.toLowerCase()}});assert.equal(joined.status,200);assert.equal(joined.trade.you,'guest');assert.equal(joined.trade.guest.id,b.id);
 assert.equal((await call('/trades/join',{token:b.token,method:'POST',body:{code:trade.code}})).trade.id,trade.id);
 assert.equal((await call('/trades/join',{token:c.token,method:'POST',body:{code:trade.code}})).error.code,'TRADE_FULL');
 assert.equal((await call('/trades/'+trade.id,{token:c.token})).status,403);
 assert.equal((await call('/trades/'+trade.id+'/offer',{token:c.token,method:'POST',body:{revision:1,monster:mon()}})).status,403);
 assert.equal((await call('/trades/active',{token:b.token})).trade.id,trade.id);
});

test('both participants confirm same immutable offers before atomic commit and replayable receipts',async()=>{
 const {call,ready,env}=setup(),{a,b,trade}=await ready();
 const first=await call('/trades/'+trade.id+'/confirm',{token:a.token,method:'POST',body:{revision:trade.revision}});assert.equal(first.trade.state,'open');assert(first.trade.host.confirmed);assert.equal(first.trade.receipt,null);
 const done=await call('/trades/'+trade.id+'/confirm',{token:b.token,method:'POST',body:{revision:trade.revision}});assert.equal(done.trade.state,'committed');assert.equal(done.trade.receipt.outgoingUid,'beta');assert.equal(done.trade.receipt.incoming.species,'komori');assert.equal(done.trade.receipt.incoming.nickname,'なかま');assert.equal(done.trade.receipt.incoming.level,20);assert.equal(done.trade.receipt.incoming.shiny,true);
 assert.equal(done.trade.receipt.id,'trade:'+trade.id);assert.equal(done.trade.receipt.incoming.uid,'tr-'+trade.id+'-g');
 const own=await call('/trades/'+trade.id,{token:a.token});assert.equal(own.trade.receipt.incoming.uid,'tr-'+trade.id+'-h');assert.equal(own.trade.receipt.incoming.species,'shizuku');assert.deepEqual(own.trade.receipt.outgoing,mon('komori','alpha'));
 const replay=await call('/trades/'+trade.id+'/confirm',{token:b.token,method:'POST',body:{revision:trade.revision}});assert.deepEqual(replay.trade.receipt,done.trade.receipt);
 const committed=env.DB.sqlite.prepare('SELECT committed_at FROM trades').get().committed_at;await call('/trades/'+trade.id+'/confirm',{token:b.token,method:'POST',body:{revision:trade.revision}});assert.equal(env.DB.sqlite.prepare('SELECT committed_at FROM trades').get().committed_at,committed);
 assert.equal((await call('/trades/'+trade.id+'/cancel',{token:a.token,method:'POST',body:{}})).trade.state,'committed');
 assert.equal((await call('/trades/'+trade.id+'/offer',{token:a.token,method:'POST',body:{revision:trade.revision,monster:mon()}})).error.code,'TRADE_CLOSED');
 assert.equal((await call('/trades/active',{token:a.token})).trade.id,trade.id);
 await call('/trades/'+trade.id+'/ack',{token:a.token,method:'POST',body:{}});assert.equal((await call('/trades/active',{token:a.token})).trade,null);assert.equal((await call('/trades/active',{token:b.token})).trade.id,trade.id);
 assert.deepEqual((await call('/trades/'+trade.id+'/ack',{token:a.token,method:'POST',body:{}})).trade.receipt,own.trade.receipt);
});

test('an offer change clears both confirmations; stale confirmation cannot trade a changed monster',async()=>{
 const {call,ready}=setup(),{a,b,trade}=await ready();
 await call('/trades/'+trade.id+'/confirm',{token:a.token,method:'POST',body:{revision:trade.revision}});
 const offered=await call('/trades/'+trade.id+'/offer',{token:b.token,method:'POST',body:{revision:trade.revision,monster:mon('hibana','new-beta')}});assert.equal(offered.trade.revision,trade.revision+1);assert.equal(offered.trade.host.confirmed,false);assert.equal(offered.trade.guest.confirmed,false);
 const stale=await call('/trades/'+trade.id+'/confirm',{token:a.token,method:'POST',body:{revision:trade.revision}});assert.equal(stale.status,409);assert.equal(stale.error.code,'TRADE_CHANGED');
 const same=await call('/trades/'+trade.id+'/offer',{token:b.token,method:'POST',body:{revision:trade.revision,monster:mon('hibana','new-beta')}});assert.equal(same.trade.revision,offered.trade.revision);
 assert.equal((await call('/trades/'+trade.id+'/offer',{token:a.token,method:'POST',body:{revision:trade.revision,monster:mon('hibana','bad-race')}})).error.code,'TRADE_CHANGED');
 const current=(await call('/trades/'+trade.id,{token:a.token})).trade;assert.equal(current.host.monster.uid,'alpha');assert.equal(current.state,'open');
});

test('parallel confirmations commit exactly once; offer/confirm and cancel/confirm races never mix revisions',async()=>{
 for(const race of ['confirm','offer','cancel']){
  const {call,ready,env}=setup(),{a,b,trade}=await ready();
  if(race!=='confirm')await call('/trades/'+trade.id+'/confirm',{token:a.token,method:'POST',body:{revision:trade.revision}});
  const operation=race==='confirm'?call('/trades/'+trade.id+'/confirm',{token:a.token,method:'POST',body:{revision:trade.revision}}):race==='offer'?call('/trades/'+trade.id+'/offer',{token:a.token,method:'POST',body:{revision:trade.revision,monster:mon('hibana','new-alpha')}}):call('/trades/'+trade.id+'/cancel',{token:a.token,method:'POST',body:{}});
  await Promise.all([operation,call('/trades/'+trade.id+'/confirm',{token:b.token,method:'POST',body:{revision:trade.revision}})]);
  const row=env.DB.sqlite.prepare('SELECT * FROM trades').get();
  if(race==='confirm')assert.equal(row.state,'committed');
  if(row.state==='committed'){assert.equal(row.host_confirm,row.revision);assert.equal(row.guest_confirm,row.revision);assert.equal(JSON.parse(row.host_offer).uid,'alpha');}
  else {assert(['open','cancelled'].includes(row.state));assert.equal(row.committed_at,null);}
 }
});

test('expired/cancelled rooms release membership; committed rooms survive expiry for recovery',async()=>{
 const {call,ready,env,create}=setup();let {a,b,trade}=await ready();
 env.DB.sqlite.prepare('UPDATE trades SET expires_at=? WHERE id=?').run(Date.now()-1,trade.id);
 assert.equal((await call('/trades/'+trade.id,{token:a.token})).trade.state,'expired');assert.equal((await call('/trades/active',{token:a.token})).trade,null);assert.equal((await call('/trades/active',{token:b.token})).trade,null);
 assert.equal((await call('/trades/'+trade.id+'/confirm',{token:a.token,method:'POST',body:{revision:trade.revision}})).error.code,'TRADE_CLOSED');
 const next=await create(a);await call('/trades/'+next.trade.id+'/cancel',{token:a.token,method:'POST',body:{}});assert.equal((await call('/trades/active',{token:a.token})).trade,null);
 ({a,b,trade}=await ready());await call('/trades/'+trade.id+'/confirm',{token:a.token,method:'POST',body:{revision:trade.revision}});await call('/trades/'+trade.id+'/confirm',{token:b.token,method:'POST',body:{revision:trade.revision}});
 env.DB.sqlite.prepare('UPDATE trades SET expires_at=? WHERE id=?').run(Date.now()-1,trade.id);assert.equal((await call('/trades/active',{token:a.token})).trade.state,'committed');
});

test('simultaneous room creation and join reserve one active membership',async()=>{
 const {call,register,create,env}=setup(),a=await register(),b=await register(),c=await register();
 const attempts=await Promise.all([call('/trades',{token:a.token,method:'POST',body:{requestId:crypto.randomUUID()}}),call('/trades',{token:a.token,method:'POST',body:{requestId:crypto.randomUUID()}})]);
 assert.equal(attempts.filter(r=>r.status===200).length,1);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM trades').get().n,1);
 const second=await create(b),first=attempts.find(r=>r.status===200).trade;
 const joins=await Promise.all([call('/trades/join',{token:c.token,method:'POST',body:{code:first.code}}),call('/trades/join',{token:c.token,method:'POST',body:{code:second.trade.code}})]);
 assert.equal(joins.filter(r=>r.status===200).length,1);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM trades WHERE guest_id=?').get(c.id).n,1);
});

test('code guessing is bounded and foreign participants cannot confirm/cancel/ack',async()=>{
 const {call,register,create}=setup(),a=await register(),b=await register();const {trade}=await create(a);
 for(const action of ['confirm','cancel','ack'])assert.equal((await call('/trades/'+trade.id+'/'+action,{token:b.token,method:'POST',body:{revision:0}})).status,403);
 for(let n=0;n<30;n++)assert.equal((await call('/trades/join',{token:b.token,method:'POST',body:{code:'AAAAAA'},ip:'192.0.2.1'})).status,404);
 assert.equal((await call('/trades/join',{token:b.token,method:'POST',body:{code:'AAAAAA'},ip:'192.0.2.1'})).status,429);
});
