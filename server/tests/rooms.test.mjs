import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import worker,{ROOM_CATALOG,ROOM_LAYOUTS,worldRoomWalls,validateRoomDecorations,WORLD_TTL,MYTHICAL_CONFIG,DEFAULT_CONFIG} from '../server.mjs';
import {RULES_VERSION,replayChallenge} from '../kasai-replay.mjs';

class LocalD1 {
  constructor(){
    this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');
    for(const file of ['0000_admin.sql','0001_trades.sql','0002_world.sql','0003_rooms.sql'])this.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  }
  prepare(sql){
    const db=this;
    return {values:[],bind(...values){this.values=values;return this;},execute(){const results=db.sqlite.prepare(sql).all(...this.values).map(row=>({...row}));return {results,success:true,meta:{changes:db.sqlite.prepare('SELECT changes() AS n').get().n}};},async first(){return this.execute().results[0]||null;},async all(){return this.execute();},async run(){return this.execute();}};
  }
  async batch(statements){this.sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>s.execute());this.sqlite.exec('COMMIT');return results;}catch(error){this.sqlite.exec('ROLLBACK');throw error;}}
}
const SECRET='test-room-owner-secret-only',SIGNING='test-room-signing-key-only-at-least-32-characters';
const runtime={console};
for(const match of readFileSync(new URL('../../index.html',import.meta.url),'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(match[1]))continue;
  runInNewContext(match[2],runtime);if(runtime.LT?.Engine)break;
}
const copy=value=>JSON.parse(JSON.stringify(value));
function team(){const engine=new runtime.LT.Engine();return copy(Array.from({length:6},(_,i)=>({...engine.makeMonster('arvelion',100),uid:'room-team-'+i})));}
function play(challenge,expected='won'){
  const engine=new runtime.LT.Engine();engine.state.started=true;engine.state.party=copy(challenge.party);
  assert.equal(engine.startKasaiBattle(challenge).ok,true);
  for(let n=0;n<512&&!engine.battle.result;n++){
    let action;
    if(engine.battle.pendingReplacement)action={type:'replace',index:engine.state.party.findIndex(mon=>mon.hp>0)};
    else{
      const mon=engine.state.party[engine.battle.activeIndex],moves=engine.moves(mon).map((move,index)=>({move,index})).filter(({move})=>mon.pp[move.id]>0&&move.kind==='attack').sort((a,b)=>b.move.power-a.move.power);
      action=moves.length?{type:'move',index:moves[0].index}:{type:'struggle'};
    }
    const result=action.type==='replace'?engine.chooseReplacement(action.index):engine.action(action);
    assert.equal(result.ok,true,result.message);
  }
  assert.equal(engine.battle.result,expected);return copy(engine.battle.kasaiChallenge.actions);
}
function setup(t){
  let now=Date.now(),ip=0;t.mock.method(Date,'now',()=>now);
  const env={DB:new LocalD1(),ADMIN_CLAIM_KEY:SECRET,DUEL_SIGNING_KEY:SIGNING};
  const advance=ms=>now+=ms;
  async function call(path,{token,method='GET',body}={}){
    const headers={'Content-Type':'application/json',Origin:'https://uni-tadayasu.github.io','CF-Connecting-IP':'192.0.2.'+(++ip)};
    if(token)headers.Authorization='Bearer '+token;
    const response=await worker.fetch(new Request('https://rooms.example/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env),data=await response.json();
    assert(!JSON.stringify(data).includes(SECRET));assert(!JSON.stringify(data).includes(SIGNING));return {status:response.status,...data};
  }
  async function register(name='旅人'){
    const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),result=await call('/register',{method:'POST',body:{name,token}});
    assert.equal(result.status,200);return {token,...result.player};
  }
  async function admin(){const a=await register('運営');assert.equal((await call('/admin/claim',{token:a.token,method:'POST',body:{key:SECRET}})).status,200);return a;}
  const door=(map='village',index=0)=>{const cell=worldRoomWalls(map).filter(cell=>map!=='village'||![6,14,32].some(x=>cell.x===x&&cell.y===7))[index];return {map,x:cell.x,y:cell.y,facing:cell.facings[0]};};
  const create=(player,entrance=door(),extra={})=>call('/world/rooms',{token:player.token,method:'POST',body:{...entrance,...extra}});
  async function presence(player,map,x=9,y=12){advance(300);return call('/world/presence',{token:player.token,method:'POST',body:{map,x,y,facing:'up',avatar:'male',status:'idle'}});}
  async function challenge(player,room,extra={}){
    const result=await presence(player,room.mapId,12,5);assert.equal(result.status,200);
    return call('/world/kasai/challenges',{token:player.token,method:'POST',body:{requestId:crypto.randomUUID(),roomId:room.id,party:team(),storageCount:0,...extra}});
  }
  const complete=(player,result,actions,storageCount=0)=>call('/world/kasai/challenges/'+result.challenge.id+'/complete',{token:player.token,method:'POST',body:{token:result.token,actions,storageCount}});
  return {env,call,register,admin,door,create,presence,challenge,complete,advance};
}

test('room doorway catalog exactly matches actual walls, safe approaches and existing exits',()=>{
  const engine=new runtime.LT.Engine(),directions={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]};
  for(const [id,map] of Object.entries(runtime.LT.DATA.maps)){
    if(map.sharedRoom||id.startsWith('room:'))continue;
    const expected=[];
    for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++){
      if(!['#','B'].includes(map.tiles[y][x])||map.exits.some(exit=>Math.abs(exit.x-x)+Math.abs(exit.y-y)<=1))continue;
      const facings=Object.entries(directions).filter(([, [dx,dy]])=>engine.walkable(map,x-dx,y-dy)&&!map.exits.some(exit=>exit.x===x-dx&&exit.y===y-dy)).map(([facing])=>facing);
      if(facings.length)expected.push({x,y,facings});
    }
    assert.deepEqual(worldRoomWalls(id),expected,id);
    assert(expected.length<400,'one bounded listing includes every possible doorway');
  }
  assert.deepEqual(worldRoomWalls('__proto__'),[]);assert.deepEqual(worldRoomWalls('room:P0000000000000000'),[]);
});

test('rooms are permanent, unique, public to authenticated players and never accept forged roles',async t=>{
  const {env,call,register,door,create}=setup(t),a=await register('甲'),b=await register('乙');
  assert.equal((await call('/world/rooms/catalog')).status,401);
  const catalog=await call('/world/rooms/catalog',{token:a.token});assert.deepEqual(catalog.catalog,ROOM_CATALOG);assert.deepEqual(catalog.layouts,ROOM_LAYOUTS);
  assert.equal((await call('/world/rooms/mine',{token:a.token})).room,null);
  const entrance=door(),created=await create(a,entrance,{name:'わたしの部屋'});assert.equal(created.status,200);
  assert.equal(created.room.id,a.id);assert.equal(created.room.mapId,'room:'+a.id);assert.equal(created.room.kind,'secret');assert.equal(created.room.owner.isAdmin,false);
  assert.equal((await create(a,entrance)).room.id,a.id);assert.equal((await create(a,door('meadow'))).error.code,'ROOM_ALREADY_EXISTS');
  assert.equal((await create(b,entrance)).error.code,'ROOM_ENTRANCE_OCCUPIED');
  const detail=await call('/world/rooms/'+a.id,{token:b.token});assert.deepEqual(detail.room,created.room);
  assert.equal((await call('/world/rooms?map=village',{token:b.token})).rooms.length,1);
  assert.equal((await call('/world/rooms?map=meadow',{token:b.token})).rooms.length,0);
  assert.equal((await call('/world/rooms/mine',{token:a.token})).room.id,a.id);
  assert.equal((await call('/world/rooms/P0000000000000000',{token:a.token})).status,404);
  assert.equal((await create(b,door('meadow'),{owner:{id:a.id,isAdmin:true}})).status,400);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_rooms').get().n,1);
});

test('invalid door geometry and reserved Kasai doors cannot be claimed',async t=>{
  const {call,register,door,create}=setup(t),a=await register();
  for(const patch of [{map:'__proto__'},{map:'unknown'},{map:['village']},{x:21,y:17},{x:-1},{x:44},{y:30},{x:1.5},{facing:['up']},{facing:'north'},{name:'\u202e'},{name:'a'.repeat(33)}])assert.equal((await create(a,{...door(),...patch})).status,400,JSON.stringify(patch));
  assert.equal((await create(a,{map:'village',x:32,y:7,facing:'up'})).error.code,'ROOM_ENTRANCE_RESERVED');
  assert.equal((await call('/world/rooms/walls?map=unknown',{token:a.token})).status,400);
  assert.deepEqual((await call('/world/rooms/walls?map=village',{token:a.token})).walls,worldRoomWalls('village'));
});

test('owner furnishing uses revision compare-and-swap, strict footprints and protected walkways',async t=>{
  const {env,call,register,create}=setup(t),a=await register(),b=await register();await create(a);
  const decoration={id:'plant-1',itemId:'plant',x:2,y:3,rotation:0};
  const patch=(actor,body)=>call('/world/rooms/'+a.id,{token:actor.token,method:'PATCH',body});
  assert.equal((await patch(b,{revision:1,decorations:[]})).status,403);
  const invalid=[null,Array(33).fill(decoration),[{...decoration,id:['plant']}],[{...decoration,itemId:'__proto__'}],[{...decoration,rotation:'90'}],[{...decoration,rotation:45}],[{...decoration,x:0}],[{...decoration,y:1}],[{...decoration,x:1.5}],[{...decoration,x:8}],[{...decoration,x:9,y:12}],[{...decoration,x:9,y:14}],[decoration,{...decoration,id:'plant-2'}],[decoration,{...decoration,x:4}],[{...decoration,itemId:'bed',x:16,y:12,rotation:90}],[{...decoration,owner:a.id}]];
  for(const decorations of invalid)assert.equal((await patch(a,{revision:1,decorations})).status,400,JSON.stringify(decorations));
  const edits=await Promise.all([patch(a,{revision:1,decorations:[decoration]}),patch(a,{revision:1,name:'別のタブ'})]);
  assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
  const current=(await call('/world/rooms/'+a.id,{token:a.token})).room;assert.equal(current.revision,2);
  const next=await patch(a,{revision:2,name:'落ち着く部屋',decorations:[{...decoration,itemId:'bed',x:2,y:2,rotation:90},{id:'rug-1',itemId:'rug',x:3,y:7,rotation:0}]});assert.equal(next.status,200);assert.equal(next.room.revision,3);
  assert.throws(()=>validateRoomDecorations([{...decoration,x:8,y:2}],'kasai'));
  assert.throws(()=>validateRoomDecorations([{...decoration,x:11,y:10}],'kasai'));
  assert.equal(validateRoomDecorations([{...decoration,x:20,y:10}],'kasai').length,1);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_rooms').get().n,1);
});

test('concurrent room creation retains one doorway and one room per player',async t=>{
  const {env,register,create,door}=setup(t),a=await register(),b=await register();
  const results=await Promise.all([create(a,door()),create(a,door('meadow'))]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const occupied=results.find(r=>r.status===200).room.entrance;
  assert.equal((await create(b,{map:occupied.map,x:occupied.x,y:occupied.y,facing:occupied.facing})).status,409);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_rooms').get().n,1);
});

test('Kasai room is always discoverable, changes role safely, and keeps old permanent rooms',async t=>{
  const {env,call,register,admin,create}=setup(t),visitor=await register();
  assert.equal((await call('/world/rooms/kasai',{token:visitor.token})).room,null);
  const owner=await admin();const [one,two]=await Promise.all([call('/world/rooms/kasai',{token:visitor.token}),call('/world/rooms/kasai',{token:owner.token})]);
  assert.equal(one.room.id,owner.id);assert.deepEqual(one.room,two.room);assert.equal(one.room.width,24);assert.equal(one.room.owner.name,'謎のトレーナー カサイ');
  assert.deepEqual(one.room.entrance,{map:'village',x:32,y:7,facing:'up',returnX:32,returnY:8});
  assert.equal((await create(owner)).error.code,'ROOM_ALREADY_EXISTS');
  assert.equal((await call('/world/rooms/'+owner.id,{token:owner.token,method:'PATCH',body:{revision:1,decorations:[{id:'outside',itemId:'plant',x:20,y:10,rotation:0}]}})).status,200);
  env.DB.sqlite.prepare('DELETE FROM admin_owner').run();const nextOwner=await admin();
  const next=(await call('/world/rooms/kasai',{token:visitor.token})).room;assert.equal(next.id,nextOwner.id);assert.equal(next.entrance.x,14);
  const old=(await call('/world/rooms/'+owner.id,{token:visitor.token})).room;assert.equal(old.kind,'secret');assert.equal(old.width,18);assert.deepEqual(old.decorations,[]);assert.equal(old.entrance.x,32);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_rooms').get().n,2);
});

test('dynamic presence requires persisted room and uses current room dimensions and map isolation',async t=>{
  const {call,register,admin,create,presence}=setup(t),a=await register(),b=await register(),owner=await admin();
  const room=(await create(a)).room,kasai=(await call('/world/rooms/kasai',{token:a.token})).room;
  assert.equal((await presence(a,'room:P0000000000000000')).status,400);
  assert.equal((await presence(a,room.mapId,18,12)).status,400);assert.equal((await presence(a,room.mapId,9,16)).status,400);
  assert.equal((await presence(a,room.mapId)).status,200);assert.deepEqual((await presence(b,room.mapId)).players.map(p=>p.id),[a.id]);
  assert.equal((await presence(a,kasai.mapId,23,19)).status,200);assert.deepEqual((await presence(b,room.mapId)).players,[]);
  assert.equal((await presence(owner,kasai.mapId,24,19)).status,400);
});

test('Kasai start is authenticated, nearby, idempotent and rejects invented special grants',async t=>{
  const {call,register,admin,challenge,presence,advance}=setup(t),a=await register(),owner=await admin(),room=(await call('/world/rooms/kasai',{token:a.token})).room;
  const body={requestId:crypto.randomUUID(),roomId:room.id,party:team(),storageCount:0};
  assert.equal((await call('/world/kasai/challenges',{method:'POST',body})).status,401);
  assert.equal((await call('/world/kasai/challenges',{token:a.token,method:'POST',body})).error.code,'KASAI_NOT_NEARBY');
  await presence(a,room.mapId,12,5);advance(WORLD_TTL+1);
  assert.equal((await call('/world/kasai/challenges',{token:a.token,method:'POST',body})).error.code,'KASAI_NOT_NEARBY');
  await presence(a,room.mapId,12,5);
  for(const patch of [{roomId:[owner.id]},{party:[]},{storageCount:'0'},{storageCount:193},{won:true}])assert.equal((await call('/world/kasai/challenges',{token:a.token,method:'POST',body:{...body,...patch}})).status,400);
  const invented=new runtime.LT.Engine().makeMonster('futo',100);invented.grantId='admin-initial:'+a.id;
  assert.equal((await challenge(a,room,{party:[copy(invented)]})).error.code,'KASAI_PARTY_NOT_OWNED');
  const configured=new runtime.LT.Engine().makeMonster('futo',100,DEFAULT_CONFIG.stats,DEFAULT_CONFIG.moves);
  assert.equal((await challenge(a,room,{party:[copy(configured)]})).error.code,'KASAI_PARTY_NOT_OWNED');
  configured.grantId='admin-initial:'+owner.id;
  assert.equal((await challenge(owner,room,{party:[copy(configured)]})).status,200);
  configured.customStats.atk++;
  assert.equal((await challenge(owner,room,{party:[copy(configured)]})).error.code,'KASAI_PARTY_CHANGED');
  const responses=await Promise.all([call('/world/kasai/challenges',{token:a.token,method:'POST',body}),call('/world/kasai/challenges',{token:a.token,method:'POST',body})]);
  assert(responses.every(r=>r.status===200));assert.equal(responses[0].token,responses[1].token);assert.equal(responses[0].challenge.id,responses[1].challenge.id);assert.equal(responses[0].challenge.rulesVersion,RULES_VERSION);
  assert.equal((await call('/world/kasai/challenges',{token:a.token,method:'POST',body:{...body,party:body.party.slice(0,1)}})).error.code,'KASAI_REQUEST_REUSED');
});

test('actual deterministic win creates one durable random-gender receipt and explicit ACK',async t=>{
  const {env,call,register,admin,challenge,complete,advance}=setup(t),a=await register(),b=await register();await admin();
  const room=(await call('/world/rooms/kasai',{token:a.token})).room,start=await challenge(a,room);assert.equal(start.status,200);
  const actions=play({...start.challenge,token:start.token});assert.equal(replayChallenge(start.challenge.party,start.challenge.seed,actions).won,true);
  const endpoint='/world/kasai/challenges/'+start.challenge.id+'/complete',body={token:start.token,actions,storageCount:0};
  assert.equal((await call(endpoint,{token:b.token,method:'POST',body})).status,404);
  assert.equal((await call(endpoint,{token:a.token,method:'POST',body:{...body,token:'A'.repeat(43)}})).status,403);
  assert.equal((await call(endpoint,{token:a.token,method:'POST',body:{...body,won:true}})).status,403);
  assert.equal((await complete(a,start,[{type:'win'}])).status,400);
  assert.equal((await complete(a,start,actions.slice(0,-1))).status,400);
  assert.equal((await complete(a,start,[...actions,{type:'struggle'}])).status,400);
  const completed=await Promise.all([complete(a,start,actions),complete(a,start,actions)]);assert(completed.every(r=>r.status===200));
  const receipt=completed[0].receipt;assert.deepEqual(completed[1].receipt,receipt);assert.equal(receipt.id,'kasai-reward:'+a.id);assert.equal(receipt.grantId,receipt.id);assert.equal(receipt.species,'floravelle');assert.equal(receipt.level,70);assert(['male','female'].includes(receipt.gender));assert.equal(receipt.delivered,false);assert.equal(receipt.ackedAt,null);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_rewards').get().n,1);
  assert.equal((await complete(a,start,[...actions,{type:'struggle'}])).error.code,'KASAI_RESULT_CHANGED');
  const account=await call('/me',{token:a.token});assert.deepEqual(account.grants,[]);assert.deepEqual(account.initialCompanions,[]);
  assert.equal((await call('/world/kasai/reward',{token:b.token})).receipt,null);
  assert.equal((await call('/world/kasai/reward/ack',{token:b.token,method:'POST',body:{receiptId:receipt.id}})).status,400);
  const ack=await call('/world/kasai/reward/ack',{token:a.token,method:'POST',body:{receiptId:receipt.id}});assert.equal(ack.receipt.delivered,true);assert.equal(typeof ack.receipt.ackedAt,'number');
  advance(3600000);assert.deepEqual((await call('/world/kasai/reward',{token:a.token})).receipt,ack.receipt);
  const second=await challenge(a,room);assert.equal(second.rewardClaimed,true);const again=await complete(a,second,play({...second.challenge,token:second.token}));assert.deepEqual(again.receipt,ack.receipt);assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_rewards').get().n,1);
});

test('full storage blocks receipt without queue; expired or cancelled challenges cannot pay out',async t=>{
  const {env,call,register,admin,challenge,complete,advance}=setup(t),a=await register();await admin();const room=(await call('/world/rooms/kasai',{token:a.token})).room;
  const start=await challenge(a,room,{storageCount:192}),actions=play({...start.challenge,token:start.token});
  assert.equal((await complete(a,start,actions,192)).error.code,'KASAI_STORAGE_FULL');assert.equal((await call('/world/kasai/reward',{token:a.token})).receipt,null);assert.equal(env.DB.sqlite.prepare('SELECT state FROM kasai_challenges WHERE id=?').get(start.challenge.id).state,'pending');
  const accepted=await complete(a,start,actions,191);assert.equal(accepted.status,200);assert.equal(accepted.receipt.level,70);
  const expired=await challenge(a,room),expiredActions=play({...expired.challenge,token:expired.token});advance(30*60*1000+1);assert.equal((await complete(a,expired,expiredActions)).error.code,'KASAI_CHALLENGE_FINISHED');
  const cancelled=await challenge(a,room),cancelActions=play({...cancelled.challenge,token:cancelled.token});assert.equal((await call('/world/kasai/challenges/'+cancelled.challenge.id+'/cancel',{token:a.token,method:'POST',body:{token:cancelled.token}})).cancelled,true);assert.equal((await complete(a,cancelled,cancelActions)).error.code,'KASAI_CHALLENGE_FINISHED');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_rewards').get().n,1);
});

test('earned mythical duel proof follows the durable reward, independent of administrator role',async t=>{
  const {call,register,admin,challenge,complete}=setup(t),a=await register(),b=await register();await admin();const room=(await call('/world/rooms/kasai',{token:a.token})).room,start=await challenge(a,room);await complete(a,start,play({...start.challenge,token:start.token}));
  const sessionId='0123456789abcdef'.repeat(2),body={sessionId,side:0,grantId:'kasai-reward:'+a.id};
  assert.equal((await call('/duel-pass',{token:b.token,method:'POST',body})).status,403);
  const issued=await call('/duel-pass',{token:a.token,method:'POST',body});assert.equal(issued.status,200);
  const verified=await call('/duel-pass/verify',{method:'POST',body:{sessionId,side:0,pass:issued.pass}});assert.equal(verified.status,200);assert.equal(verified.species,'floravelle');assert.deepEqual(verified.stats,MYTHICAL_CONFIG.stats);
  assert.equal((await call('/duel-pass/verify',{method:'POST',body:{sessionId,side:1,pass:issued.pass}})).status,403);
});

test('a replayed loss consumes that session and a replacement session invalidates the old token',async t=>{
  const {env,call,register,admin,challenge,complete}=setup(t),a=await register();await admin();const room=(await call('/world/rooms/kasai',{token:a.token})).room;
  const weak=copy(new runtime.LT.Engine().makeMonster('komori',1)),lost=await challenge(a,room,{party:[weak]}),actions=play({...lost.challenge,token:lost.token},'lost');
  const result=await complete(a,lost,actions);assert.equal(result.status,200);assert.equal(result.won,false);assert.equal(result.receipt,null);assert.equal((await complete(a,lost,actions)).result,'lost');assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_rewards').get().n,0);
  const first=await challenge(a,room),second=await challenge(a,room);assert.notEqual(first.challenge.id,second.challenge.id);
  assert.equal((await complete(a,first,play({...first.challenge,token:first.token}))).error.code,'KASAI_CHALLENGE_FINISHED');
  assert.equal((await complete(a,second,play({...second.challenge,token:second.token}))).status,200);
});

test('missing signing configuration prevents challenge issuance without creating a session',async t=>{
  const {env,call,register,admin,challenge}=setup(t),a=await register();await admin();const room=(await call('/world/rooms/kasai',{token:a.token})).room;delete env.DUEL_SIGNING_KEY;
  assert.equal((await challenge(a,room)).error.code,'KASAI_NOT_CONFIGURED');assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_challenges').get().n,0);
});
