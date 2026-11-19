import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{WORLD_TTL,worldRoomWalls} from '../server.mjs';
import {createReplayRuntime} from '../kasai-replay.mjs';
import {validateLiveOrders} from '../kasai-live-engine.mjs';
const LT=createReplayRuntime(),copy=value=>JSON.parse(JSON.stringify(value));
const SECRET='test-live-admin-only-secret',SIGNING='test-live-signing-key-with-more-than-32-characters';
class LocalD1{
  constructor(){this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');for(const file of ['0000_admin.sql','0001_trades.sql','0002_world.sql','0003_rooms.sql','0004_kasai_party.sql','0005_kasai_live.sql'])this.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));}
  prepare(sql){const db=this;return {sql,values:[],bind(...values){this.values=values;return this;},execute(){return {results:db.sqlite.prepare(sql).all(...this.values).map(row=>({...row})),success:true,meta:{changes:db.sqlite.prepare('SELECT changes() AS n').get().n}};},async first(){return this.execute().results[0]||null;},async all(){return this.execute();},async run(){return this.execute();}};}
  async batch(statements){this.sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(statement=>statement.execute());this.sqlite.exec('COMMIT');return result;}catch(error){this.sqlite.exec('ROLLBACK');throw error;}}
}
function party(species='arvelion',level=100,count=1){const engine=new LT.Engine();return copy(Array.from({length:count},()=>engine.makeMonster(species,level)));}
function setup(t){
 let now=Date.now(),ip=0;t.mock.method(Date,'now',()=>now);const env={DB:new LocalD1(),ADMIN_CLAIM_KEY:SECRET,DUEL_SIGNING_KEY:SIGNING};
 const advance=ms=>now+=ms;
 const call=async(path,actor,method='GET',body)=>{const response=await worker.fetch(new Request('https://live.example/api'+path,{method,headers:{'Content-Type':'application/json',Origin:'https://uni-tadayasu.github.io','CF-Connecting-IP':'192.0.2.'+(++ip),...(actor?{Authorization:'Bearer '+actor.token}:{})},body:body===undefined?undefined:JSON.stringify(body)}),env);const data=await response.json();assert(!JSON.stringify(data).includes(SECRET));assert(!JSON.stringify(data).includes(SIGNING));return {status:response.status,...data};};
 const register=async(name='挑戦者')=>{const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),result=await call('/register',null,'POST',{name,token});assert.equal(result.status,200);return {token,...result.player};};
 const presence=async(actor,position={},elapsed=300)=>{advance(elapsed);return call('/world/presence',actor,'POST',{map:'village',x:21,y:17,facing:'up',avatar:'male',status:'idle',...position});};
 const players=async({createRoom=true}={})=>{
  const challenger=await register(),admin=await register('運営'),third=await register('他の挑戦者');assert.equal((await call('/admin/claim',admin,'POST',{key:SECRET})).status,200);
  if(createRoom){const wall=worldRoomWalls('village')[0],facing=wall.facings[0],[dx,dy]={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]}[facing];await presence(admin,{x:wall.x-dx,y:wall.y-dy,facing});assert.equal((await call('/world/rooms',admin,'POST',{map:'village',x:wall.x,y:wall.y,facing})).status,200);}
  await presence(challenger);await presence(admin,{x:22,facing:'left'});await presence(third,{x:20});return {challenger,admin,third};
 };
 const live=(actor,id,action,body={})=>call('/world/kasai/live'+(id?'/'+id:'')+(action?'/'+action:''),actor,action?'POST':'GET',action?body:undefined);
 const start=(actor,extra={})=>call('/world/kasai/live',actor,'POST',{requestId:crypto.randomUUID(),party:party(),storageCount:0,...extra});
 const stage=async(challenger,admin,adminParty=party('komori',1),extra={})=>{const result=await start(challenger,extra);assert.equal(result.status,200,JSON.stringify(result));const id=result.session.id;assert.equal((await live(challenger,id,'arrive')).status,200);assert.equal((await live(admin,id,'arrive',{party:adminParty})).status,200);return id;};
 const battle=async(challenger,admin,adminParty,extra)=>{const id=await stage(challenger,admin,adminParty,extra);assert.equal((await presence(challenger,{map:'room:'+admin.id,x:12,y:5,facing:'up'})).status,200);assert.equal((await live(challenger,id,'talk')).session.state,'permission');const result=await live(admin,id,'answer',{accept:true});assert.equal(result.session.state,'battle',JSON.stringify(result));return result.session;};
 return {env,advance,call,register,presence,players,live,start,stage,battle};
}
function choose(state,side){
 const team=state.teams[side],active=team.monsters[team.active[0]];
 if(state.phase==='replacement')return active.hp>0?[]:[{type:'switch',slot:0,index:team.monsters.findIndex((mon,index)=>mon.hp>0&&!team.active.includes(index))}];
 const engine=new LT.Engine(),moves=engine.moves(active).map((move,index)=>({move,index})).filter(({move})=>active.pp[move.id]>0).sort((a,b)=>(b.move.kind==='attack'?b.move.power:0)-(a.move.kind==='attack'?a.move.power:0));
 const orders=moves.length?[{type:'move',slot:0,move:moves[0].index,target:0}]:[{type:'struggle',slot:0,target:0}];assert.equal(validateLiveOrders(state,side,orders).ok,true);return orders;
}
async function finish(h,challenger,admin,session){
 for(let n=0;n<100&&session.state==='battle';n++){
  const old=session,commands=[0,1].map(side=>({round:old.round,orders:choose(old.battle,side),requestId:crypto.randomUUID()}));
  let response=await h.live(challenger,old.id,'actions',commands[0]);assert.equal(response.status,200,JSON.stringify(response));
  if(response.session.round===old.round){response=await h.live(admin,old.id,'actions',commands[1]);assert.equal(response.status,200,JSON.stringify(response));}
  session=response.session;
 }
 assert.equal(session.state,'result');return session;
}

test('a live invitation needs an explicitly created Kasai room and never makes a doorway or locks either player',async t=>{
 const h=setup(t),{challenger,admin}=await h.players({createRoom:false}),requestId=crypto.randomUUID();
 const unavailable=await h.start(challenger,{requestId});assert.equal(unavailable.status,409);assert.equal(unavailable.error.code,'KASAI_ROOM_UNAVAILABLE');assert.match(unavailable.error.message,/運営が壁を向いてAで部屋を作成/);
 assert.equal((await h.call('/world/rooms/kasai',challenger)).room,null);assert.equal((await h.call('/world/rooms/mine',admin)).room,null);
 for(const table of ['world_rooms','kasai_live_sessions','kasai_live_members'])assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
 for(const actor of [challenger,admin])assert.equal(h.env.DB.sqlite.prepare('SELECT map_id FROM world_presence WHERE player_id=?').get(actor.id).map_id,'village');
 const wall=worldRoomWalls('forest')[0],facing=wall.facings[0],[dx,dy]={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]}[facing];
 await h.presence(admin,{map:'forest',x:wall.x-dx,y:wall.y-dy,facing});const created=await h.call('/world/rooms',admin,'POST',{map:'forest',x:wall.x,y:wall.y,facing});assert.equal(created.status,200);assert.equal(created.room.kind,'kasai');
 await h.presence(admin,{x:22,facing:'left'});const accepted=await h.start(challenger,{requestId});assert.equal(accepted.status,200);assert.equal(accepted.session.roomId,admin.id);
 assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_rooms').get().n,1);assert.equal(h.env.DB.sqlite.prepare('SELECT map_id FROM world_rooms WHERE owner_id=?').get(admin.id).map_id,'forest');
});

test('live creation requires the real nearby idle administrator, rejects self/CPU and atomically locks one pair',async t=>{
 const h=setup(t),{challenger,admin,third}=await h.players();
 assert.equal((await h.start(null)).status,401);
 assert.equal((await h.start(admin)).error.code,'KASAI_SELF_BATTLE');
 assert.equal((await h.call('/world/kasai/challenges',challenger,'POST',{requestId:crypto.randomUUID(),roomId:admin.id,party:party(),storageCount:0})).error.code,'KASAI_LIVE_REQUIRED');
 await h.presence(admin,{map:'meadow'});assert.equal((await h.start(challenger)).error.code,'KASAI_LIVE_NOT_NEARBY');
 await h.presence(admin,{x:22,status:'busy'});assert.equal((await h.start(challenger)).error.code,'KASAI_LIVE_BUSY');
 h.advance(WORLD_TTL+1);await h.presence(challenger);assert.equal((await h.start(challenger)).error.code,'KASAI_LIVE_OFFLINE');
 await h.presence(admin,{x:22});await h.presence(third,{x:20});
 const results=await Promise.all([h.start(challenger),h.start(third)]);assert.equal(results.filter(result=>result.status===200).length,1);
 assert.equal(h.env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM kasai_live_sessions WHERE state<>'closed'").get().n,1);assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_live_members').get().n,2);
 const accepted=results.find(result=>result.status===200).session;assert.equal(accepted.state,'staging');assert.equal(accepted.role,'challenger');assert.equal(accepted.deadlineAt-accepted.serverTime,60000);
 const kasai=await h.live(admin);assert.equal(kasai.session.id,accepted.id);assert.equal(kasai.session.role,'kasai');assert.deepEqual(kasai.session.stagePosition,{map:'room:'+admin.id,x:12,y:4,facing:'down'});
 const p=h.env.DB.sqlite.prepare('SELECT map_id,x,y,facing,status FROM world_presence WHERE player_id=?').get(admin.id);assert.deepEqual({...p},{map_id:'room:'+admin.id,x:12,y:4,facing:'down',status:'busy'});
 const outsider=accepted.challenger.id===challenger.id?third:challenger;assert.equal((await h.live(outsider,accepted.id)).error.code,'KASAI_LIVE_PARTICIPANT_REQUIRED');
});

test('both arrive, challenger must approach and talk, and only Kasai explicitly approves the actual-party battle',async t=>{
 const h=setup(t),{challenger,admin,third}=await h.players(),started=await h.start(challenger),id=started.session.id;
 assert.equal((await h.live(challenger,id,'talk')).error.code,'KASAI_LIVE_NOT_READY');
 assert.equal((await h.live(admin,id,'arrive')).error.code,'KASAI_LIVE_PARTY_REQUIRED');
 assert.equal((await h.live(challenger,id,'arrive')).session.arrived[0],true);
 const adminParty=party('komori',73,2);adminParty[1].nickname='カサイ';
 assert.equal((await h.live(admin,id,'arrive',{party:adminParty})).session.arrived[1],true);
 assert.equal((await h.live(admin,id,'answer',{accept:true})).error.code,'KASAI_LIVE_NOT_READY');
 assert.equal((await h.live(challenger,id,'talk')).error.code,'KASAI_NOT_NEARBY');
 assert.equal((await h.live(challenger,id,'answer',{accept:true})).error.code,'ADMIN_REQUIRED');
 await h.presence(challenger,{map:'room:'+admin.id,x:12,y:5});assert.equal((await h.live(challenger,id,'talk')).session.state,'permission');
 assert.equal((await h.live(third,id,'answer',{accept:true})).error.code,'KASAI_LIVE_PARTICIPANT_REQUIRED');
 let result=await h.live(admin,id,'answer',{accept:true});assert.equal(result.session.state,'battle');assert.equal(result.session.battle.teams[1].monsters.length,2);assert.equal(result.session.battle.teams[1].monsters[0].level,73);assert.equal(result.session.battle.teams[1].monsters[1].nickname,'カサイ');
 assert.equal((await h.live(admin,id,'arrive',{party:party('arvelion',100)})).error.code,'KASAI_PARTY_CHANGED');
 const challengerView=await h.live(challenger,id);assert.deepEqual(challengerView.session.battle,result.session.battle);
});

test('the arena pins Kasai, protects editing and relocation, and only challenger exit releases both',async t=>{
 const h=setup(t),{challenger,admin}=await h.players(),id=await h.stage(challenger,admin);
 h.advance(300);const moved=await h.presence(admin,{map:'meadow',x:4,y:4,facing:'left'});assert.equal(moved.status,200);assert.equal(moved.self.map,'room:'+admin.id);assert.equal(moved.self.x,12);assert.equal(moved.self.y,4);assert.equal(moved.self.facing,'down');
 assert.equal((await h.live(admin,id,'leave')).error.code,'KASAI_LIVE_PINNED');assert.equal((await h.call('/world/presence',admin,'DELETE')).error.code,'KASAI_LIVE_PINNED');
 assert.equal((await h.presence(challenger,{map:'meadow'})).error.code,'KASAI_LIVE_LOCKED');
 assert.equal((await h.call('/world/rooms/'+admin.id,admin,'PATCH',{revision:1,decorations:[]})).error.code,'KASAI_LIVE_BUSY');
 assert.equal((await h.call('/world/rooms/'+admin.id+'/relocate',admin,'POST',{revision:1,map:'village',x:32,y:7,facing:'up'})).error.code,'KASAI_LIVE_BUSY');
 assert.equal((await h.live(challenger,id,'leave')).session.state,'closed');
 const back=await h.live(admin);assert.equal(back.session.reason,'challenger-left');assert.deepEqual(back.session.returnPosition,{map:'village',x:22,y:17,facing:'left'});
 const p=h.env.DB.sqlite.prepare('SELECT map_id,x,y,facing,status FROM world_presence WHERE player_id=?').get(admin.id);assert.deepEqual({...p},{map_id:'village',x:22,y:17,facing:'left',status:'idle'});
 assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_live_members').get().n,0);
 assert.equal((await h.live(admin,id,'ack')).acknowledged,true);assert.equal((await h.live(admin)).session,null);
});

test('talk deadline, disconnect, role transfer and declined permission all return both players',async t=>{
 for(const scenario of ['talk-timeout','disconnected','kasai-changed','declined']){
  const h=setup(t),{challenger,admin,third}=await h.players(),id=await h.stage(challenger,admin);
  if(scenario==='talk-timeout'){
   for(let n=0;n<3;n++){h.advance(19000);await h.live(challenger,id);await h.live(admin,id);}h.advance(3000);
  }else if(scenario==='disconnected'){h.advance(30000);}
  else if(scenario==='kasai-changed')h.env.DB.sqlite.prepare('UPDATE admin_owner SET player_id=?').run(third.id);
  else await h.live(admin,id,'answer',{accept:false});
  const result=await h.live(challenger,id);assert.equal(result.session.state,'closed',scenario);assert.equal(result.session.reason,scenario);
  assert.equal(h.env.DB.sqlite.prepare('SELECT map_id FROM world_presence WHERE player_id=?').get(challenger.id).map_id,'village');assert.equal(h.env.DB.sqlite.prepare('SELECT map_id FROM world_presence WHERE player_id=?').get(admin.id).map_id,'village');
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_live_members').get().n,0);
 }
});

test('actions remain private until both people submit, retries are idempotent and racing rounds resolve once',async t=>{
 const h=setup(t),{challenger,admin,third}=await h.players();let session=await h.battle(challenger,admin,party('arvelion',100,3),{party:party('arvelion',100,3)});
 const request={round:session.round,orders:choose(session.battle,0),requestId:crypto.randomUUID()},first=await h.live(challenger,session.id,'actions',request);assert.equal(first.status,200);assert.equal(first.session.round,session.round);assert.deepEqual(first.session.submitted,[true,false]);
 const opponent=await h.live(admin,session.id);assert.deepEqual(opponent.session.battle,session.battle);assert(!Object.hasOwn(opponent.session,'orders'));assert(!Object.hasOwn(opponent.session,'orders0_json'));
 assert.equal((await h.live(challenger,session.id,'actions',request)).session.round,session.round);
 assert.equal((await h.live(challenger,session.id,'actions',{...request,orders:[{type:'struggle',slot:0,target:0}]})).error.code,'KASAI_LIVE_REQUEST_REUSED');
 assert.equal((await h.live(third,session.id,'actions',request)).error.code,'KASAI_LIVE_PARTICIPANT_REQUIRED');
 const other={round:session.round,orders:choose(session.battle,1),requestId:crypto.randomUUID()},results=await Promise.all([h.live(admin,session.id,'actions',other),h.live(admin,session.id,'actions',other)]);assert(results.every(result=>result.status===200));
 const latest=(await h.live(challenger,session.id)).session;assert.equal(latest.round,session.round+1);assert.deepEqual(latest.submitted,[false,false]);assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_live_orders WHERE session_id=?').get(session.id).n,2);
 assert.equal((await h.live(challenger,session.id,'actions',request)).session.round,latest.round);
 const bad={round:latest.round,requestId:crypto.randomUUID(),orders:[{type:'win'}]};assert.equal((await h.live(challenger,session.id,'actions',bad)).error.code,'INVALID_KASAI_LIVE_ORDERS');
});

test('a genuine human victory grants once, full storage blocks, and recovery survives exit and ACK',async t=>{
 const h=setup(t),{challenger,admin}=await h.players();let session=await h.battle(challenger,admin,party('komori',1));
 assert.equal((await h.live(challenger,session.id,'claim',{storageCount:0})).error.code,'KASAI_LIVE_NOT_WON');
 session=await finish(h,challenger,admin,session);assert.equal(session.battle.winner,0);
 const adminView=await h.live(admin,session.id);assert.equal(adminView.session.state,'result');assert.equal((await h.live(admin,session.id,'leave')).error.code,'KASAI_LIVE_PINNED');
 assert.equal((await h.live(challenger,session.id,'claim',{storageCount:192})).error.code,'KASAI_STORAGE_FULL');assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_rewards').get().n,0);
 await h.live(challenger,session.id,'leave');await h.live(challenger,session.id,'ack');assert.equal((await h.live(challenger)).session,null);
 const pending=await h.call('/world/kasai/reward',challenger);assert.equal(pending.receipt,null);assert.equal(pending.pendingLiveSessionId,session.id);
 const claims=await Promise.all([h.live(challenger,session.id,'claim',{storageCount:191}),h.live(challenger,session.id,'claim',{storageCount:191})]);assert(claims.every(result=>result.status===200));assert.deepEqual(claims[0].receipt,claims[1].receipt);
 const receipt=claims[0].receipt;assert.equal(receipt.species,'floravelle');assert.equal(receipt.level,70);assert(['male','female'].includes(receipt.gender));assert.equal(receipt.id,'kasai-reward:'+challenger.id);assert.equal(receipt.delivered,false);
 assert.equal((await h.call('/world/kasai/reward/ack',challenger,'POST',{receiptId:receipt.id})).receipt.delivered,true);
 assert.equal((await h.live(challenger,session.id,'claim',{storageCount:191})).receipt.delivered,true);assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_rewards').get().n,1);
 const pass=await h.call('/duel-pass',challenger,'POST',{sessionId:'0123456789abcdef'.repeat(2),side:0,grantId:receipt.id});assert.equal(pass.status,200);
});

test('one room per player is retained through relocation with furniture and safe ownership checks',async t=>{
 const h=setup(t),{challenger,admin,third}=await h.players();
 const wall=worldRoomWalls('meadow')[0],facing=wall.facings[0],dirs={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]},[dx,dy]=dirs[facing];
 await h.presence(challenger,{map:'meadow',x:wall.x-dx,y:wall.y-dy,facing});
 const first=await h.call('/world/rooms',challenger,'POST',{map:'meadow',x:wall.x,y:wall.y,facing,name:'家具を残す部屋'});assert.equal(first.status,200);
 const furniture=[{id:'plant',itemId:'plant',x:2,y:3,rotation:0}];assert.equal((await h.call('/world/rooms/'+challenger.id,challenger,'PATCH',{revision:1,decorations:furniture})).status,200);
 const target=worldRoomWalls('forest')[0],newFacing=target.facings[0],[nx,ny]=dirs[newFacing],body={revision:2,map:'forest',x:target.x,y:target.y,facing:newFacing};
 assert.equal((await h.call('/world/rooms/'+challenger.id+'/relocate',third,'POST',body)).error.code,'ROOM_OWNER_REQUIRED');
 assert.equal((await h.call('/world/rooms/'+challenger.id+'/relocate',challenger,'POST',body)).error.code,'ROOM_NOT_NEARBY');
 await h.presence(challenger,{map:'forest',x:target.x-nx,y:target.y-ny,facing:newFacing});
 const moved=await h.call('/world/rooms/'+challenger.id+'/relocate',challenger,'POST',body);assert.equal(moved.status,200);assert.equal(moved.room.id,first.room.id);assert.equal(moved.room.name,first.room.name);assert.deepEqual(moved.room.decorations,furniture);assert.equal(moved.room.revision,3);assert.equal(moved.room.entrance.map,'forest');
 assert.equal((await h.call('/world/rooms/'+challenger.id+'/relocate',challenger,'POST',body)).error.code,'ROOM_CHANGED');
 assert.equal((await h.call('/world/rooms',challenger,'POST',{map:'meadow',x:wall.x,y:wall.y,facing})).error.code,'ROOM_ALREADY_EXISTS');
 await h.presence(third,{map:'meadow',x:wall.x-dx,y:wall.y-dy,facing});const other=await h.call('/world/rooms',third,'POST',{map:'meadow',x:wall.x,y:wall.y,facing});assert.equal(other.status,200);
 await h.presence(challenger,{map:'meadow',x:wall.x-dx,y:wall.y-dy,facing});assert.equal((await h.call('/world/rooms/'+challenger.id+'/relocate',challenger,'POST',{revision:3,map:'meadow',x:wall.x,y:wall.y,facing})).error.code,'ROOM_ENTRANCE_OCCUPIED');
 const kasai=(await h.call('/world/rooms/kasai',admin)).room;assert.equal(kasai.id,admin.id);
 const adminTarget=worldRoomWalls('coast')[0],adminFacing=adminTarget.facings[0],[ax,ay]=dirs[adminFacing];await h.presence(admin,{map:'coast',x:adminTarget.x-ax,y:adminTarget.y-ay,facing:adminFacing});
 const shifted=await h.call('/world/rooms/'+admin.id+'/relocate',admin,'POST',{revision:1,map:'coast',x:adminTarget.x,y:adminTarget.y,facing:adminFacing});assert.equal(shifted.status,200);assert.equal(shifted.room.kind,'kasai');assert.equal(shifted.room.id,admin.id);
 assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_rooms WHERE owner_id=?').get(admin.id).n,1);
});

test('live heartbeats do not consume the movement throttle or strand the pinned administrator in reconnecting',async t=>{
 const h=setup(t),{challenger,admin}=await h.players(),id=await h.stage(challenger,admin);
 h.advance(300);assert.equal((await h.live(admin,id)).status,200);
 const position={map:'room:'+admin.id,x:12,y:4,facing:'down',avatar:'male',status:'busy'};
 const fresh=await h.presence(admin,position,0);assert.equal(fresh.status,200);assert.equal(fresh.self.name,'謎のトレーナー カサイ');
 assert.equal((await h.presence(admin,position,0)).error.code,'WORLD_UPDATE_TOO_FAST');
});

test('delayed outdoor and arena writes cannot overwrite an atomic live entrance or return',async t=>{
 const h=setup(t),{challenger,admin}=await h.players(),prepare=h.env.DB.prepare.bind(h.env.DB);
 async function pauseNextPresence(position){
  let signal,release;const reached=new Promise(resolve=>signal=resolve),gate=new Promise(resolve=>release=resolve);let block=true;
  h.env.DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith('INSERT INTO world_presence')){const first=statement.first.bind(statement);statement.first=async()=>{if(block){block=false;signal();await gate;}return first();};}return statement;};
  const pending=h.presence(admin,position);await reached;return {pending,release,restore(){h.env.DB.prepare=prepare;}};
 }
 const first=await pauseNextPresence({x:23,facing:'right'}),created=await h.start(challenger);assert.equal(created.status,200);first.release();
 assert.equal((await first.pending).error.code,'KASAI_LIVE_CHANGED');first.restore();
 let actual=h.env.DB.sqlite.prepare('SELECT map_id,x,y FROM world_presence WHERE player_id=?').get(admin.id);assert.deepEqual({...actual},{map_id:'room:'+admin.id,x:12,y:4});
 const second=await pauseNextPresence({map:'room:'+admin.id,x:20,y:10,facing:'right'});await h.live(challenger,created.session.id,'leave');second.release();
 assert.equal((await second.pending).error.code,'KASAI_LIVE_CHANGED');second.restore();
 actual=h.env.DB.sqlite.prepare('SELECT map_id,x,y FROM world_presence WHERE player_id=?').get(admin.id);assert.deepEqual({...actual},{map_id:'village',x:22,y:17});
});

test('a stale expiry snapshot cannot close a newly accepted talk or renewed heartbeat',async t=>{
 for(const cause of ['talk-timeout','disconnected']){
  const h=setup(t),{challenger,admin}=await h.players(),id=await h.stage(challenger,admin),batch=h.env.DB.batch.bind(h.env.DB);
  if(cause==='talk-timeout'){for(let i=0;i<3;i++){h.advance(19000);await h.live(challenger,id);await h.live(admin,id);}h.advance(3000);}
  else h.advance(30000);
  let intercepted=false;
  h.env.DB.batch=async statements=>{
   if(!intercepted&&statements[0]?.sql.startsWith("UPDATE kasai_live_sessions SET state='closed'")){
    intercepted=true;
    // Simulate a valid already-in-flight talk/heartbeat committing after the
    // cleanup query captured its row, but before the conditional close write.
    if(cause==='talk-timeout')h.env.DB.sqlite.prepare("UPDATE kasai_live_sessions SET state='permission',revision=revision+1 WHERE id=?").run(id);
    else h.env.DB.sqlite.prepare('UPDATE kasai_live_sessions SET challenger_seen=?,kasai_seen=? WHERE id=?').run(Date.now(),Date.now(),id);
   }
   return batch(statements);
  };
  const result=await h.live(challenger,id);assert(intercepted);assert.notEqual(result.session.state,'closed',cause);assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_live_members').get().n,2);
 }
});

test('the live migration preserves old once-only reward receipts and foreign-key validity',()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 for(const file of ['0000_admin.sql','0001_trades.sql','0002_world.sql','0003_rooms.sql','0004_kasai_party.sql'])db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
 const a='P0000000000000001',b='P0000000000000002',challenge=crypto.randomUUID();
 for(const id of [a,b])db.prepare('INSERT INTO players (id,token_hash,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(id,id+'hash','保存済み',100,100);
 db.prepare("INSERT INTO world_rooms (owner_id,map_id,entrance_x,entrance_y,facing,name,created_at,updated_at) VALUES (?,'village',32,7,'up','カサイ',100,100)").run(b);
 db.prepare("INSERT INTO kasai_challenges (id,player_id,request_id,room_owner_id,rules_version,party_json,seed,token_hash,created_at,expires_at,state) VALUES (?,?,?,?,'kasai-solo-v56','[]',1,'hash',100,200,'won')").run(challenge,a,crypto.randomUUID(),b);
 db.prepare('INSERT INTO kasai_rewards (player_id,receipt_id,challenge_id,gender,created_at,acked_at) VALUES (?,?,?,?,?,?)').run(a,'kasai-reward:'+a,challenge,'female',150,151);
 const before=db.prepare('SELECT * FROM kasai_rewards').get();db.exec(readFileSync(new URL('../drizzle/0005_kasai_live.sql',import.meta.url),'utf8'));
 const after=db.prepare('SELECT * FROM kasai_rewards').get();assert.deepEqual({...after},{...before,live_session_id:null});assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
});
