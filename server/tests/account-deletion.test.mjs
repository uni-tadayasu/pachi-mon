import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import worker from '../server.mjs';

class LocalD1 {
  constructor(){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');for(const file of ['0000_admin.sql','0001_trades.sql'])this.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));}
  prepare(sql){const db=this;return{values:[],bind(...values){this.values=values;return this;},execute(){const results=db.sqlite.prepare(sql).all(...this.values).map(row=>({...row}));return{results,success:true,meta:{changes:db.sqlite.prepare('SELECT changes() AS n').get().n}};},async first(){return this.execute().results[0]||null;},async all(){return this.execute();},async run(){return this.execute();}};}
  async batch(statements){this.sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.execute());this.sqlite.exec('COMMIT');return result;}catch(error){this.sqlite.exec('ROLLBACK');throw error;}}
}
function setup(){
  const env={DB:new LocalD1(),ADMIN_CLAIM_KEY:'test-only-delete-account-key'};let ip=0;
  async function call(path,{token,body,method='GET',origin='https://uni-tadayasu.github.io'}={}){
    const headers={'Content-Type':'application/json','CF-Connecting-IP':`192.0.2.${++ip}`};if(origin)headers.Origin=origin;if(token)headers.Authorization=`Bearer ${token}`;
    const res=await worker.fetch(new Request('https://delete.example/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
    return{status:res.status,headers:res.headers,...(res.status===204?{}:await res.json())};
  }
  async function register(name='旅人'){const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');const r=await call('/register',{method:'POST',body:{name,token}});assert.equal(r.status,200);return{token,...r.player};}
  const remove=(p,body={confirmation:'DELETE',playerId:p.id})=>call('/me',{token:p.token,method:'DELETE',body});
  return{env,call,register,remove};
}
function seedTrade(env,a,b,{state='committed',requestId=crypto.randomUUID()}={}){
  const id=crypto.randomUUID(),code=id.replace(/-/g,'').slice(0,6).toUpperCase();
  const offer=uid=>JSON.stringify({uid,species:'komori',level:20,hp:50,xp:0,pp:{},nickname:'なかま'});
  env.DB.sqlite.prepare('INSERT INTO trades (id,code,request_id,host_id,guest_id,state,host_offer,guest_offer,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,code,requestId,a.id,b.id,state,offer('alpha-'+id),offer('beta-'+id),Date.now(),Date.now()+900000);
  for(const p of [a,b])env.DB.sqlite.prepare('INSERT INTO trade_active (player_id,trade_id) VALUES (?,?)').run(p.id,id);
  return id;
}

test('deletion requires own token and exact confirmed identity; no unauthenticated mutation',async()=>{
  const {call,register,remove,env}=setup(),a=await register('削除される名前'),b=await register('他の人');
  assert.equal((await call('/me',{method:'DELETE',body:{confirmation:'DELETE',playerId:a.id}})).status,401);
  assert.equal((await remove(a,{})).status,400);
  assert.equal((await remove(a,{confirmation:'DELETE',playerId:b.id})).status,409);
  assert.equal((await call('/me',{token:a.token,method:'DELETE',origin:'https://evil.example',body:{confirmation:'DELETE',playerId:a.id}})).status,403);
  assert.equal((await remove(a)).status,200);
  assert.equal(env.DB.sqlite.prepare('SELECT id FROM players WHERE id=?').get(a.id),undefined);
  const hash=createHash('sha256').update(a.token).digest('hex');
  assert.equal(env.DB.sqlite.prepare('SELECT id FROM players WHERE token_hash=?').get(hash),undefined);
  assert.equal((await call('/me',{token:a.token})).status,401);
  assert.equal((await call('/me',{token:b.token})).player.id,b.id);
  assert.equal((await remove(a)).status,200,'retry after a lost success response is safe');
  assert.match((await call('/me',{method:'OPTIONS'})).headers.get('Access-Control-Allow-Methods'),/DELETE/);
});

test('open exchange is cancelled; the surviving user is unlocked and original names/ids removed',async()=>{
  const {call,register,remove,env}=setup(),a=await register('削除する人'),b=await register('残る人'),id=seedTrade(env,a,b,{state:'open'});
  assert.equal((await remove(a)).status,200);
  const r=await call('/trades/'+id,{token:b.token});assert.equal(r.status,200);assert.equal(r.trade.state,'cancelled');
  assert.equal(r.trade.host.name,'削除済みプレイヤー');assert.equal(r.trade.host.monster,null);assert.equal(r.trade.guest.monster,null);
  assert(!JSON.stringify(r).includes(a.id));assert(!JSON.stringify(r).includes(a.name));
  assert.equal((await call('/trades/active',{token:b.token})).trade,null);
  assert.equal(env.DB.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('committed receipt survives counterpart deletion and can be acknowledged without replaying the swap',async()=>{
  for(const side of ['host','guest']){
    const {call,register,remove,env}=setup(),a=await register('甲'),b=await register('乙'),id=seedTrade(env,a,b),deleted=side==='host'?a:b,survivor=side==='host'?b:a;
    const before=(await call('/trades/'+id,{token:survivor.token})).trade.receipt;
    assert.equal((await remove(deleted)).status,200);
    const after=(await call('/trades/active',{token:survivor.token})).trade;
    assert.equal(after.id,id);assert.deepEqual(after.receipt,before);assert.equal(after.state,'committed');assert(!JSON.stringify(after).includes(deleted.id));
    assert.equal((await call('/trades/'+id+'/ack',{token:survivor.token,method:'POST',body:{}})).status,200);
    assert.equal((await call('/trades/active',{token:survivor.token})).trade,null);
    assert.equal((await remove(survivor)).status,200);
    assert.equal(env.DB.sqlite.prepare('SELECT id FROM trades WHERE id=?').get(id),undefined);
    assert.equal(env.DB.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
  }
});

test('shared anonymized hosts cannot collide on a client-supplied request id',async()=>{
  const {register,remove,env}=setup(),a=await register(),b=await register(),c=await register(),d=await register(),requestId=crypto.randomUUID();
  seedTrade(env,a,b,{requestId});seedTrade(env,c,d,{requestId});
  assert.equal((await remove(a)).status,200);assert.equal((await remove(c)).status,200);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM trades').get().n,2);
});

test('admin deletion removes ownership and own gifts while preserving other players gifts and config',async()=>{
  const {register,remove,call,env}=setup(),owner=await register('運営'),other=await register('相手');
  assert.equal((await call('/admin/claim',{token:owner.token,method:'POST',body:{key:env.ADMIN_CLAIM_KEY}})).status,200);
  assert.equal((await call('/admin/grants',{token:owner.token,method:'POST',body:{requestId:crypto.randomUUID(),target:'all'}})).status,200);
  const before=(await call('/me',{token:other.token})).grants,config=env.DB.sqlite.prepare('SELECT * FROM futo_config').get();
  assert.equal((await remove(owner)).status,200);
  assert.deepEqual((await call('/me',{token:other.token})).grants,before);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM futo_config').get(),config);
  assert.equal(env.DB.sqlite.prepare('SELECT * FROM admin_owner').get(),undefined);
  assert.equal(env.DB.sqlite.prepare('SELECT * FROM grants WHERE player_id=?').get(owner.id),undefined);
  assert.equal((await call('/admin/claim',{token:other.token,method:'POST',body:{key:env.ADMIN_CLAIM_KEY}})).status,200);
  const players=(await call('/admin/players',{token:other.token})).players;
  assert.deepEqual(players.map(x=>x.id),[other.id]);
  const sent=await call('/admin/grants',{token:other.token,method:'POST',body:{requestId:crypto.randomUUID(),target:'all'}});
  assert.equal(sent.recipientCount,1);assert.equal(env.DB.sqlite.prepare("SELECT * FROM grants WHERE player_id LIKE '__deleted_%'").get(),undefined);
});

test('database failure rolls the entire deletion back, including trade cancellation',async()=>{
  const {register,remove,env}=setup(),a=await register(),b=await register(),id=seedTrade(env,a,b,{state:'open'});
  env.DB.sqlite.exec("CREATE TRIGGER reject_player_delete BEFORE DELETE ON players BEGIN SELECT RAISE(ABORT,'forced test failure'); END");
  assert.equal((await remove(a)).status,500);
  assert.equal(env.DB.sqlite.prepare('SELECT id FROM players WHERE id=?').get(a.id).id,a.id);
  const trade=env.DB.sqlite.prepare('SELECT * FROM trades WHERE id=?').get(id);assert.equal(trade.state,'open');assert.equal(trade.host_id,a.id);
  assert.equal(env.DB.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('public status advertises account deletion support for release preflight',async()=>{
  const {call}=setup();const status=await call('/status');
  assert.equal(status.status,200);assert.equal(status.accountDeletionSupported,true);
});
