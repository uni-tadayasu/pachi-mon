import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import worker,{WORLD_MAP_BOUNDS,WORLD_TTL} from '../server.mjs';

class LocalD1 {
  constructor() {
    this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');
    for(const file of ['0000_admin.sql','0001_trades.sql','0002_world.sql','0003_rooms.sql','0004_kasai_party.sql','0005_kasai_live.sql'])this.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  }
  prepare(sql) {
    const db=this;
    return {values:[],bind(...v){this.values=v;return this;},execute(){const results=db.sqlite.prepare(sql).all(...this.values).map(row=>({...row}));return {results,success:true,meta:{changes:db.sqlite.prepare('SELECT changes() AS n').get().n}};},async first(){return this.execute().results[0]||null;},async all(){return this.execute();},async run(){return this.execute();}};
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try{const results=statements.map(s=>s.execute());this.sqlite.exec('COMMIT');return results;}
    catch(error){this.sqlite.exec('ROLLBACK');throw error;}
  }
}
const SECRET='world-test-only-admin-secret';
const DEFAULT_POSITION={map:'village',x:21,y:17,facing:'down',avatar:'male',status:'idle'};
function setup(t) {
  let now=Date.now(),addr=0;t.mock.method(Date,'now',()=>now);
  const env={DB:new LocalD1(),ADMIN_CLAIM_KEY:SECRET};
  const advance=ms=>now+=ms;
  async function call(path,{token,method='GET',body,ip}={}) {
    const headers={'Content-Type':'application/json',Origin:'https://uni-tadayasu.github.io','CF-Connecting-IP':ip||'192.0.2.'+(++addr)};
    if(token)headers.Authorization='Bearer '+token;
    const response=await worker.fetch(new Request('https://world.example/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
    if(response.status===204)return {status:204,headers:response.headers};
    const data=await response.json();assert(!JSON.stringify(data).includes(SECRET));return {status:response.status,...data};
  }
  async function register(name='旅人') {
    const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const data=await call('/register',{method:'POST',body:{name,token}});assert.equal(data.status,200);return {token,...data.player};
  }
  async function presence(player,position={},elapsed=300) {
    advance(elapsed);return call('/world/presence',{token:player.token,method:'POST',body:{...DEFAULT_POSITION,...position}});
  }
  async function pair() {
    const a=await register('甲'),b=await register('乙');
    assert.equal((await presence(a)).status,200);assert.equal((await presence(b,{x:22})).status,200);return {a,b};
  }
  async function invite(a,b,changes={}) {
    return call('/world/invitations',{token:a.token,method:'POST',body:{targetId:b.id,kind:'battle',roomCode:'ABC234',requestId:crypto.randomUUID(),...changes}});
  }
  const respond=(player,id,accept)=>call('/world/invitations/'+id+'/respond',{token:player.token,method:'POST',body:{accept}});
  return {env,call,register,presence,pair,invite,respond,advance};
}

test('world map bounds match every published outdoor and indoor map',()=>{
  const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8'),context={console};
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(/\bsrc=|application\/ld\+json/.test(match[1]))continue;
    runInNewContext(match[2],context);if(context.LT?.Engine)break;
  }
  const actual=Object.fromEntries(Object.entries(context.LT.DATA.maps).filter(([id,map])=>!map.sharedRoom&&!id.startsWith('room:')).map(([id,map])=>[id,[map.width,map.height]]));
  assert.deepEqual(WORLD_MAP_BOUNDS,actual);assert.equal(Object.keys(actual).length,232);
});

test('authenticated presence moves real actors, isolates maps, expires and leaves',async t=>{
  const {call,presence,pair,advance}=setup(t),{a,b}=await pair();
  assert.equal((await call('/world/presence',{method:'POST',body:DEFAULT_POSITION})).status,401);
  const seen=await presence(a);
  assert.equal(seen.self.id,a.id);assert.deepEqual(seen.players.map(p=>p.id),[b.id]);
  assert.equal(seen.ttlMs,15000);assert.equal(seen.pollAfterMs,500);
  assert.equal(seen.players[0].x,22);assert.equal(seen.players[0].name,'乙');
  await presence(b,{x:24,facing:'left',avatar:'female'});
  const moved=(await presence(a)).players[0];assert.equal(moved.x,24);assert.equal(moved.facing,'left');assert.equal(moved.avatar,'female');
  await presence(b,{map:'meadow'});assert.equal((await presence(a)).players.length,0);
  await presence(b,{x:22});advance(WORLD_TTL+1);assert.equal((await presence(a)).players.length,0);
  await presence(b,{x:22});assert.equal((await presence(a)).players.length,1);
  assert.equal((await call('/world/presence',{token:b.token,method:'DELETE'})).left,true);
  assert.equal((await presence(a)).players.length,0);
  const cors=await call('/world/presence',{method:'OPTIONS'});assert(cors.headers.get('Access-Control-Allow-Methods').includes('DELETE'));
});

test('only server-verified administrator receives Kasai avatar and display name',async t=>{
  const {call,presence,pair,env}=setup(t),{a,b}=await pair();
  await call('/admin/claim',{token:a.token,method:'POST',body:{key:SECRET}});
  const owner=await presence(a,{avatar:'female'});
  assert.equal(owner.self.name,'謎のトレーナー カサイ');assert.equal(owner.self.avatar,'kasai');assert.equal(owner.self.isAdmin,true);
  const seen=(await presence(b,{x:22})).players.find(p=>p.id===a.id);assert.deepEqual(seen,owner.self);
  for(const patch of [{avatar:'kasai'},{isAdmin:true},{name:'謎のトレーナー カサイ'},{id:a.id}])assert.equal((await presence(b,patch)).status,400);
  env.DB.sqlite.prepare('DELETE FROM admin_owner').run();
  const former=(await presence(b)).players.find(p=>p.id===a.id);assert.equal(former.isAdmin,false);assert.equal(former.name,'甲');assert.equal(former.avatar,'female');
  env.DB.sqlite.prepare('UPDATE players SET name=? WHERE id=?').run('旅\u202e人\u0001',a.id);
  assert.equal((await presence(b)).players.find(p=>p.id===a.id).name,'旅人');
});

test('presence rejects invalid map bounds and throttles per player, not shared IP',async t=>{
  const {call,register,presence}=setup(t),a=await register(),b=await register();
  for(const patch of [{map:'unknown'},{map:'__proto__'},{x:-1},{x:44},{y:30},{x:1.5},{facing:'north'},{status:'admin'},{avatar:'anything'}])assert.equal((await presence(a,patch)).status,400);
  const sameIP={method:'POST',body:DEFAULT_POSITION,ip:'192.0.2.200'};
  assert.equal((await call('/world/presence',{...sameIP,token:a.token})).status,200);
  assert.equal((await call('/world/presence',{...sameIP,token:a.token})).status,429);
  assert.equal((await call('/world/presence',{...sameIP,token:b.token})).status,200);
  assert.equal((await presence(a,{x:22},250)).status,200);
});

test('nearby invitation is private, idempotent, consent-based and carries verified Kasai identity',async t=>{
  const {call,register,presence,pair,invite,respond,env}=setup(t),{a,b}=await pair(),c=await register('第三者');
  await call('/admin/claim',{token:a.token,method:'POST',body:{key:SECRET}});
  const requestId=crypto.randomUUID(),sent=await invite(a,b,{requestId});assert.equal(sent.status,200);
  const id=sent.invitation.id;assert.equal(sent.invitation.state,'pending');assert.equal(sent.invitation.from.isAdmin,true);assert.equal(sent.invitation.from.name,'謎のトレーナー カサイ');assert.equal(sent.invitation.to.id,b.id);
  assert.equal((await invite(a,b,{requestId})).invitation.id,id);
  assert.equal((await invite(a,b,{requestId,roomCode:'XYZ234'})).error.code,'WORLD_REQUEST_REUSED');
  assert.equal((await presence(b,{x:22})).invitations[0].id,id);
  assert.equal((await presence(c,{x:23})).invitations.length,0);
  assert.equal((await call('/world/invitations/'+id,{token:c.token})).status,403);
  assert.equal((await respond(a,id,true)).status,403);assert.equal((await respond(c,id,true)).status,403);
  const accepted=await respond(b,id,true);assert.equal(accepted.invitation.state,'accepted');
  assert.equal((await respond(b,id,true)).invitation.state,'accepted');
  assert.equal((await call('/world/invitations/'+id,{token:a.token})).invitation.state,'accepted');
  assert.equal(env.DB.sqlite.prepare('SELECT status FROM world_presence WHERE player_id=?').get(a.id).status,'busy');
  assert.equal(env.DB.sqlite.prepare('SELECT status FROM world_presence WHERE player_id=?').get(b.id).status,'busy');
});

test('busy, distant, cross-map and stale players cannot receive invitations',async t=>{
  const {pair,presence,invite,advance}=setup(t),{a,b}=await pair();
  await presence(b,{x:22,status:'busy'});assert.equal((await invite(a,b)).error.code,'WORLD_PLAYER_BUSY');
  await presence(b,{x:26});assert.equal((await invite(a,b)).error.code,'WORLD_TOO_FAR');
  await presence(b,{map:'meadow',x:22});assert.equal((await invite(a,b)).error.code,'WORLD_TOO_FAR');
  advance(WORLD_TTL+1);await presence(a);assert.equal((await invite(a,b)).error.code,'WORLD_PLAYER_OFFLINE');
  await presence(b,{x:22});assert.equal((await invite(a,b)).status,200);
});

test('decline, cancellation, expiry, movement and leaving never force a match',async t=>{
  const {call,pair,presence,invite,respond,advance}=setup(t),{a,b}=await pair();
  let sent=await invite(a,b);assert.equal((await respond(b,sent.invitation.id,false)).invitation.state,'declined');
  sent=await invite(a,b);assert.equal((await call('/world/invitations/'+sent.invitation.id+'/cancel',{token:b.token,method:'POST',body:{}})).status,403);
  assert.equal((await call('/world/invitations/'+sent.invitation.id+'/cancel',{token:a.token,method:'POST',body:{}})).invitation.state,'cancelled');
  assert.equal((await respond(b,sent.invitation.id,true)).invitation.state,'cancelled');
  sent=await invite(a,b);advance(60001);assert.equal((await respond(b,sent.invitation.id,true)).invitation.state,'expired');
  await presence(a);await presence(b,{x:22});
  sent=await invite(a,b);await presence(b,{x:32});assert.equal((await respond(b,sent.invitation.id,true)).error.code,'WORLD_TOO_FAR');
  await presence(b,{map:'meadow'});assert.equal((await call('/world/invitations/'+sent.invitation.id,{token:a.token})).invitation.state,'expired');
  await presence(b,{x:22});sent=await invite(a,b);
  await call('/world/presence',{token:a.token,method:'DELETE'});assert.equal((await respond(b,sent.invitation.id,true)).invitation.state,'cancelled');
});

test('concurrent invitations and accept/cancel races resolve to one valid state',async t=>{
  const {call,register,pair,presence,invite,respond,env}=setup(t),{a,b}=await pair(),c=await register();await presence(c,{x:23});
  const results=await Promise.all([invite(a,b),invite(c,b)]);assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM world_invitations WHERE state='pending'").get().n,1);
  const invitation=results.find(r=>r.status===200).invitation,sender=invitation.from.id===a.id?a:c;
  await Promise.all([respond(b,invitation.id,true),call('/world/invitations/'+invitation.id+'/cancel',{token:sender.token,method:'POST',body:{}})]);
  const result=await call('/world/invitations/'+invitation.id,{token:b.token});assert(['accepted','cancelled'].includes(result.invitation.state));
  if(result.invitation.state==='accepted')assert.equal(env.DB.sqlite.prepare('SELECT status FROM world_presence WHERE player_id=?').get(b.id).status,'busy');
});

test('trade invitations verify room ownership and reserve joining to the consenting target',async t=>{
  const {call,register,pair,presence,invite,respond,advance}=setup(t),{a,b}=await pair(),c=await register();await presence(c,{x:23});
  assert.equal((await invite(a,b,{kind:'trade'})).error.code,'WORLD_TRADE_UNAVAILABLE');
  const created=await call('/trades',{token:a.token,method:'POST',body:{requestId:crypto.randomUUID()}});assert.equal(created.status,200);
  assert.equal((await invite(c,b,{kind:'trade',roomCode:created.trade.code})).error.code,'WORLD_TRADE_UNAVAILABLE');
  const sent=await invite(a,b,{kind:'trade',roomCode:created.trade.code});assert.equal(sent.status,200);
  const join=player=>call('/trades/join',{token:player.token,method:'POST',body:{code:created.trade.code}});
  assert.equal((await join(c)).error.code,'TRADE_RESERVED');
  assert.equal((await join(b)).error.code,'WORLD_INVITATION_REQUIRED');
  assert.equal((await respond(b,sent.invitation.id,true)).invitation.state,'accepted');
  advance(200000);await presence(a);
  const joined=await join(b);assert.equal(joined.status,200);assert.equal(joined.trade.guest.id,b.id);
});

test('malformed invitations and repeated unsolicited attempts are rejected',async t=>{
  const {call,pair,invite,respond}=setup(t),{a,b}=await pair();
  for(const body of [{targetId:a.id,kind:'battle',roomCode:'ABC234'},{targetId:[b.id],kind:'battle',roomCode:'ABC234'},{targetId:{id:b.id},kind:'battle',roomCode:'ABC234'},{targetId:b.id,kind:'chat',roomCode:'ABC234'},{targetId:b.id,kind:'battle',roomCode:'BAD!'},{targetId:b.id,kind:'battle',roomCode:'ABC234',isAdmin:true}])assert.equal((await call('/world/invitations',{token:a.token,method:'POST',body})).status,400);
  for(let i=0;i<8;i++){
    const sent=await invite(a,b);assert.equal(sent.status,200);assert.equal((await respond(b,sent.invitation.id,false)).invitation.state,'declined');
  }
  assert.equal((await invite(a,b)).status,429);
});

test('trainer passes bind verified identity to the exact duel side/session and current owner',async t=>{
  const {call,pair,presence,env,advance}=setup(t),{a,b}=await pair();
  const sessionId='0123456789abcdef0123456789abcdef';
  const issue=(player,body={sessionId,side:0})=>call('/world/trainer-pass',{token:player.token,method:'POST',body});
  const verify=(pass,body={sessionId,side:0})=>call('/world/trainer-pass/verify',{token:b.token,method:'POST',body:{...body,pass}});
  assert.equal((await issue(a)).error.code,'TRAINER_NOT_CONFIGURED');
  env.DUEL_SIGNING_KEY='world-test-only-signing-secret-with-at-least-32-chars';
  assert.equal((await call('/world/trainer-pass',{method:'POST',body:{sessionId,side:0}})).status,401);
  const normal=await issue(b);assert.equal(normal.status,200);assert.equal((await verify(normal.pass)).trainer.isAdmin,false);
  assert.equal((await issue(b,{sessionId,side:0,isAdmin:true})).status,400);
  await call('/admin/claim',{token:a.token,method:'POST',body:{key:SECRET}});await presence(a,{avatar:'female'});
  const signed=await issue(a);assert.equal(signed.status,200);
  const verified=await verify(signed.pass);assert.equal(verified.trainer.id,a.id);assert.equal(verified.trainer.name,'謎のトレーナー カサイ');assert.equal(verified.trainer.isAdmin,true);assert.equal(verified.trainer.avatar,'kasai');
  assert.equal((await verify(signed.pass,{sessionId,side:1})).status,403);
  assert.equal((await verify(signed.pass,{sessionId:'ffffffffffffffffffffffffffffffff',side:0})).status,403);
  const [payload,signature]=normal.pass.split('.'),data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  data.isAdmin=true;data.playerId=a.id;data.name='謎のトレーナー カサイ';data.avatar='kasai';
  const forged=Buffer.from(JSON.stringify(data)).toString('base64url')+'.'+signature;assert.equal((await verify(forged)).status,403);
  // Even a correctly signed malformed payload cannot exploit RegExp string
  // coercion to send array/object values into the database binding.
  data.playerId=[a.id];
  const malformedPayload=Buffer.from(JSON.stringify(data)),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.DUEL_SIGNING_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const malformedSignature=Buffer.from(await crypto.subtle.sign('HMAC',key,malformedPayload)).toString('base64url');
  assert.equal((await verify(malformedPayload.toString('base64url')+'.'+malformedSignature)).status,403);
  env.DB.sqlite.prepare('DELETE FROM admin_owner').run();
  const released=await verify(signed.pass);assert.equal(released.trainer.isAdmin,false);assert.equal(released.trainer.name,'甲');assert.equal(released.trainer.avatar,'female');
  advance(600001);assert.equal((await verify(signed.pass)).status,403);
});

test('waiting-only trade cancellation cannot cancel a joined or changed room, including a join race',async t=>{
  const {call,register}=setup(t),a=await register(),b=await register();
  const create=async()=>{
    const result=await call('/trades',{token:a.token,method:'POST',body:{requestId:crypto.randomUUID()}});assert.equal(result.status,200);return result.trade;
  };
  const cancel=(trade,player=a,revision=trade.revision)=>call('/trades/'+trade.id+'/cancel',{token:player.token,method:'POST',body:{waitingOnly:true,expectedRevision:revision}});
  let trade=await create();
  assert.equal((await cancel(trade,a,trade.revision+1)).trade.state,'open');
  assert.equal((await cancel(trade)).trade.state,'cancelled');
  trade=await create();
  const joined=await call('/trades/join',{token:b.token,method:'POST',body:{code:trade.code}});assert.equal(joined.status,200);
  assert.equal((await cancel(trade)).trade.state,'open');assert.equal((await cancel(joined.trade)).trade.guest.id,b.id);
  assert.equal((await cancel(joined.trade,b)).error.code,'TRADE_HOST_REQUIRED');
  await call('/trades/'+trade.id+'/cancel',{token:a.token,method:'POST',body:{}});
  trade=await create();
  await Promise.all([cancel(trade),call('/trades/join',{token:b.token,method:'POST',body:{code:trade.code}})]);
  const final=(await call('/trades/'+trade.id,{token:a.token})).trade;
  if(final.guest)assert.equal(final.state,'open');else assert.equal(final.state,'cancelled');
});

test('population is authenticated, read-only and expires at the same strict fifteen-second boundary',async t=>{
  const {env,call,register,presence,advance}=setup(t),a=await register('集計確認'),b=await register('もう一人');
  assert.equal((await call('/world/population')).status,401);
  let result=await call('/world/population',{token:a.token});assert.equal(result.status,200);assert.deepEqual(result.rows,[]);assert.equal(result.total,0);assert.equal(result.ttlMs,WORLD_TTL);
  await presence(a,{},0);await presence(b,{status:'busy'},0);
  const changes=env.DB.sqlite.prepare('SELECT total_changes() AS n').get().n,updated=env.DB.sqlite.prepare('SELECT updated_at FROM world_presence WHERE player_id=?').get(a.id).updated_at;
  result=await call('/world/population',{token:a.token});assert.deepEqual(result.rows,[{map:'village',count:2}]);assert.equal(result.total,2);assert.equal(result.serverTime,Date.now());
  assert.equal(env.DB.sqlite.prepare('SELECT total_changes() AS n').get().n,changes,'listing counts never writes presence or rate-limit records');
  assert.equal(env.DB.sqlite.prepare('SELECT updated_at FROM world_presence WHERE player_id=?').get(a.id).updated_at,updated);
  const serialized=JSON.stringify(result);for(const value of [a.id,b.id,a.name,b.name,a.token,b.token])assert(!serialized.includes(value));
  advance(WORLD_TTL-1);assert.equal((await call('/world/population',{token:a.token})).total,2);
  advance(1);result=await call('/world/population',{token:a.token});assert.equal(result.total,0);assert.deepEqual(result.rows,[]);
  assert.equal((await call('/world/population',{token:a.token,method:'POST',body:{}})).status,404);
});

test('population includes the requester once and moves a player between stages without double counting',async t=>{
  const {call,pair,presence}=setup(t),{a,b}=await pair(),population=()=>call('/world/population',{token:a.token});
  assert.equal((await population()).total,2);
  await presence(b,{map:'meadow'});let result=await population();assert.deepEqual(result.rows,[{map:'meadow',count:1},{map:'village',count:1}]);assert.equal(result.total,2);
  await presence(b,{map:'meadow',x:22});result=await population();assert.equal(result.total,2);assert.equal(result.rows.find(row=>row.map==='meadow').count,1);
  await presence(a,{map:'interior-village-1',x:9,y:12});result=await population();assert.deepEqual(result.rows,[{map:'interior-village-1',count:1},{map:'meadow',count:1}]);
  await call('/world/presence',{token:b.token,method:'DELETE'});result=await population();assert.equal(result.total,1);assert.deepEqual(result.rows,[{map:'interior-village-1',count:1}]);
});

test('population counts all real active participants beyond the eighty-person nearby display cap',async t=>{
  const {call,register,presence}=setup(t),a=await register('一覧を開く人');await presence(a,{},0);
  for(let n=0;n<90;n++){const player=await register('実プレイヤー'+n);assert.equal((await presence(player,{x:20},0)).status,200);}
  const nearby=await presence(a);assert.equal(nearby.players.length,80);
  const result=await call('/world/population',{token:a.token});assert.equal(result.status,200);assert.deepEqual(result.rows,[{map:'village',count:91}]);assert.equal(result.total,91);
});

test('population labels persisted rooms using current roles and excludes detached or unknown maps',async t=>{
  const {env,call,register,presence}=setup(t),viewer=await register('閲覧者'),owner=await register('運営'),resident=await register('部屋の持ち主'),unknown=await register('無効マップ');
  assert.equal((await call('/admin/claim',{token:owner.token,method:'POST',body:{key:SECRET}})).status,200);
  assert.equal((await call('/world/rooms/kasai',{token:viewer.token})).room,null);
  assert.equal((await call('/world/population',{token:viewer.token})).total,0);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_rooms').get().n,0);
  const directions={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]},ownerWall=(await call('/world/rooms/walls?map=coast',{token:owner.token})).walls[0],ownerFacing=ownerWall.facings[0],[ox,oy]=directions[ownerFacing];
  await presence(owner,{map:'coast',x:ownerWall.x-ox,y:ownerWall.y-oy,facing:ownerFacing});
  assert.equal((await call('/world/rooms',{token:owner.token,method:'POST',body:{map:'coast',x:ownerWall.x,y:ownerWall.y,facing:ownerFacing}})).status,200);
  const kasai=(await call('/world/rooms/kasai',{token:viewer.token})).room;
  const walls=(await call('/world/rooms/walls?map=village',{token:resident.token})).walls,wall=walls[0],[rx,ry]=directions[wall.facings[0]];
  await presence(resident,{map:'village',x:wall.x-rx,y:wall.y-ry,facing:wall.facings[0]});
  const created=await call('/world/rooms',{token:resident.token,method:'POST',body:{map:'village',x:wall.x,y:wall.y,facing:wall.facings[0],name:'星空の部屋'}});assert.equal(created.status,200);
  await presence(viewer,{map:'harbor'},0);await presence(owner,{map:kasai.mapId,x:12,y:5});await presence(resident,{map:created.room.mapId,x:9,y:12});
  env.DB.sqlite.prepare("INSERT INTO world_presence (player_id,map_id,x,y,facing,avatar,status,updated_at) VALUES (?,'test-hidden-dead-map',1,1,'down','male','idle',?)").run(unknown.id,Date.now());
  let result=await call('/world/population',{token:viewer.token});assert.equal(result.total,3);assert.equal(result.total,result.rows.reduce((sum,row)=>sum+row.count,0));
  assert.deepEqual(result.rows.find(row=>row.map===kasai.mapId),{map:kasai.mapId,count:1,name:kasai.name,kind:'kasai'});
  assert.deepEqual(result.rows.find(row=>row.map===created.room.mapId),{map:created.room.mapId,count:1,name:'星空の部屋',kind:'secret'});
  assert(!result.rows.some(row=>row.map==='test-hidden-dead-map'));assert(result.rows.every(row=>row.count>0));
  assert.equal((await call('/world/rooms/'+resident.id,{token:resident.token,method:'PATCH',body:{revision:1,name:'模様替えした部屋'}})).status,200);
  result=await call('/world/population',{token:viewer.token});assert.equal(result.rows.find(row=>row.map===created.room.mapId).name,'模様替えした部屋');
  env.DB.sqlite.prepare('UPDATE admin_owner SET player_id=?').run(resident.id);
  result=await call('/world/population',{token:viewer.token});assert.equal(result.rows.find(row=>row.map===kasai.mapId).kind,'secret');assert.equal(result.rows.find(row=>row.map===created.room.mapId).kind,'kasai');assert.equal(result.total,3);
  env.DB.sqlite.prepare('DELETE FROM world_rooms WHERE owner_id=?').run(resident.id);
  result=await call('/world/population',{token:viewer.token});assert.equal(result.total,2);assert(!result.rows.some(row=>row.map===created.room.mapId));
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_rooms WHERE owner_id=?').get(resident.id).n,0,'population must not recreate a missing administrator room');
});
