import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import worker,{ROOM_CATALOG,ROOM_LAYOUTS,ROOM_TEMPLATES,worldRoomWalls,validateRoomDecorations,WORLD_TTL,MYTHICAL_CONFIG,DEFAULT_CONFIG} from '../server.mjs';
import {RULES_VERSION,LEGACY_RULES_VERSION,replayChallenge,normalizeParty} from '../kasai-replay.mjs';

class LocalD1 {
  constructor(){
    this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');
    for(const file of ['0000_admin.sql','0001_trades.sql','0002_world.sql','0003_rooms.sql','0004_kasai_party.sql','0005_kasai_live.sql','0006_sub_admin.sql','0007_third_admin.sql','0008_room_templates.sql','0009_global_chat.sql'])this.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
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
  async function admin({createRoom=true,entrance}={}){
    const a=await register('運営');assert.equal((await call('/admin/claim',{token:a.token,method:'POST',body:{key:SECRET}})).status,200);
    const engine=new runtime.LT.Engine(),party=copy(['arvelion','futo','floravelle'].map(species=>engine.makeMonster(species,70)));
    party[2].grantId='admin-mythical:'+a.id;
    assert.equal((await call('/world/kasai/party',{token:a.token,method:'POST',body:{party}})).status,200);
    if(createRoom)assert.equal((await create(a,entrance||door('coast',env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM world_rooms WHERE map_id='coast'").get().n))).status,200);
    return a;
  }
  const door=(map='village',index=0)=>{const cell=worldRoomWalls(map)[index];return {map,x:cell.x,y:cell.y,facing:cell.facings[0]};};
  async function presence(player,map,x=9,y=12,facing='up'){advance(300);return call('/world/presence',{token:player.token,method:'POST',body:{map,x,y,facing,avatar:'male',status:'idle'}});}
  async function atWall(player,entrance){const [dx,dy]={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]}[entrance.facing];const result=await presence(player,entrance.map,entrance.x-dx,entrance.y-dy,entrance.facing);assert.equal(result.status,200,JSON.stringify(result));}
  async function create(player,entrance=door(),extra={}){
    if(typeof entrance.map==='string'&&worldRoomWalls(entrance.map).some(cell=>cell.x===entrance.x&&cell.y===entrance.y&&cell.facings.includes(entrance.facing)))await atWall(player,entrance);
    return call('/world/rooms',{token:player.token,method:'POST',body:{...entrance,...extra}});
  }
  async function challenge(player,room,extra={}){
    // Fixtures model already-issued current-rule sessions. Production no longer creates
    // CPU challenges; only their pre-update result/recovery path is retained.
    const result=await presence(player,room.mapId,12,5);assert.equal(result.status,200);
    if(env.DB.sqlite.prepare('SELECT player_id FROM admin_owner').get()?.player_id===player.id)return call('/world/kasai/challenges',{token:player.token,method:'POST',body:{requestId:crypto.randomUUID(),roomId:room.id,party:team(),storageCount:0,...extra}});
    const party=normalizeParty(extra.party||team()),roster=env.DB.sqlite.prepare('SELECT party_json FROM kasai_parties WHERE player_id=?').get(room.id);
    assert(roster,'An already-issued fixture needs its original opponent snapshot');
    const opponents=JSON.parse(roster.party_json),id=crypto.randomUUID(),requestId=crypto.randomUUID(),seed=crypto.getRandomValues(new Uint32Array(1))[0],expiresAt=now+1800000;
    const payload=new TextEncoder().encode(JSON.stringify({kind:'kasai-challenge',v:1,id,playerId:player.id,seed,rulesVersion:RULES_VERSION,expiresAt}));
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(SIGNING),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const token=Buffer.from(await crypto.subtle.sign('HMAC',key,payload)).toString('base64url'),hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
    env.DB.sqlite.prepare("UPDATE kasai_challenges SET state='cancelled',completed_at=? WHERE player_id=? AND state='pending'").run(now,player.id);
    env.DB.sqlite.prepare('INSERT INTO kasai_challenges (id,player_id,request_id,room_owner_id,rules_version,party_json,opponents_json,seed,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,player.id,requestId,room.id,RULES_VERSION,JSON.stringify(party),JSON.stringify(opponents),seed,hash,now,expiresAt);
    return {status:200,token,challenge:{id,roomId:room.id,seed,rulesVersion:RULES_VERSION,party,opponents,expiresAt,state:'pending'},rewardClaimed:!!env.DB.sqlite.prepare('SELECT player_id FROM kasai_rewards WHERE player_id=?').get(player.id)};
  }
  const complete=(player,result,actions,storageCount=0)=>call('/world/kasai/challenges/'+result.challenge.id+'/complete',{token:player.token,method:'POST',body:{token:result.token,actions,storageCount}});
  return {env,call,register,admin,door,create,presence,atWall,challenge,complete,advance};
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

test('invalid door geometry is rejected while the former reserved walls are available to ordinary players',async t=>{
  const {call,register,door,create}=setup(t),a=await register();
  for(const patch of [{map:'__proto__'},{map:'unknown'},{map:['village']},{x:21,y:17},{x:-1},{x:44},{y:30},{x:1.5},{facing:['up']},{facing:'north'},{name:'\u202e'},{name:'a'.repeat(33)}])assert.equal((await create(a,{...door(),...patch})).status,400,JSON.stringify(patch));
  assert.equal((await create(a,{map:'village',x:32,y:7,facing:'up'})).status,200);
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
  const {env,call,register,create,door,atWall}=setup(t),a=await register(),b=await register(),c=await register(),entrance=door();
  await atWall(a,entrance);
  const post=actor=>call('/world/rooms',{token:actor.token,method:'POST',body:entrance});
  const retries=await Promise.all([post(a),post(a)]);assert(retries.every(result=>result.status===200));assert.deepEqual(retries[0].room,retries[1].room);
  assert.equal((await create(a,door('meadow'))).error.code,'ROOM_ALREADY_EXISTS');
  assert.equal((await create(b,entrance)).error.code,'ROOM_ENTRANCE_OCCUPIED');
  const other=door('forest');await atWall(b,other);await atWall(c,other);
  const contested=await Promise.all([b,c].map(actor=>call('/world/rooms',{token:actor.token,method:'POST',body:other})));assert.deepEqual(contested.map(result=>result.status).sort(),[200,409]);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_rooms WHERE owner_id=?').get(a.id).n,1);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_rooms').get().n,2);
});

test('room and population reads never create a room for an administrator',async t=>{
  const {env,call,register,admin}=setup(t),visitor=await register(),owner=await admin({createRoom:false});
  const changes=env.DB.sqlite.prepare('SELECT total_changes() AS n').get().n;
  for(const actor of [owner,visitor]){
    for(const path of ['/world/rooms/mine','/world/rooms/kasai'])assert.equal((await call(path,{token:actor.token})).room,null);
    for(const path of ['/world/rooms?kind=kasai','/world/rooms?map=village','/world/rooms?map=coast'])assert.deepEqual((await call(path,{token:actor.token})).rooms,[]);
    assert.equal((await call('/world/population',{token:actor.token})).total,0);
  }
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_rooms').get().n,0);
  assert.equal(env.DB.sqlite.prepare('SELECT total_changes() AS n').get().n,changes);
});

test('initial creation requires fresh presence at the chosen wall for ordinary players and Kasai',async t=>{
  const {env,call,register,admin,door,presence,atWall,advance}=setup(t),guest=await register(),owner=await admin({createRoom:false});
  for(const [index,actor] of [guest,owner].entries()){
    const entrance=door('forest',index),post=()=>call('/world/rooms',{token:actor.token,method:'POST',body:entrance});
    assert.equal((await post()).error.code,'ROOM_NOT_NEARBY');
    await presence(actor,'village',21,17);assert.equal((await post()).error.code,'ROOM_NOT_NEARBY');
    await atWall(actor,entrance);
    const [dx,dy]={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]}[entrance.facing];
    await presence(actor,entrance.map,entrance.x-dx,entrance.y-dy,entrance.facing==='up'?'down':'up');assert.equal((await post()).error.code,'ROOM_NOT_NEARBY');
    await atWall(actor,entrance);advance(WORLD_TTL);assert.equal((await post()).error.code,'ROOM_NOT_NEARBY');
    await atWall(actor,entrance);const created=await post();assert.equal(created.status,200);assert.equal(created.room.kind,index?'kasai':'secret');
  }
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_rooms').get().n,2);
});

test('Kasai creates at a chosen wall, relocates with decorations, and role changes never recreate a village room',async t=>{
  const {env,call,register,admin,create,door,atWall}=setup(t),visitor=await register();
  assert.equal((await call('/world/rooms/kasai',{token:visitor.token})).room,null);
  const owner=await admin({createRoom:false}),entrance=door('forest'),created=await create(owner,entrance);assert.equal(created.status,200);
  const [one,two]=await Promise.all([call('/world/rooms/kasai',{token:visitor.token}),call('/world/rooms/mine',{token:owner.token})]);
  assert.equal(one.room.id,owner.id);assert.deepEqual(one.room,two.room);assert.equal(one.room.width,24);assert.equal(one.room.owner.name,'謎のトレーナー カサイ');
  assert.equal(one.room.name,'カサイのひみつ部屋');assert.equal(one.room.kind,'kasai');assert.deepEqual(one.room.protected,ROOM_LAYOUTS.kasai.protected);
  for(const key of ['map','x','y','facing'])assert.equal(one.room.entrance[key],entrance[key]);
  assert.equal((await create(owner)).error.code,'ROOM_ALREADY_EXISTS');
  const decorations=[{id:'outside',itemId:'plant',x:20,y:10,rotation:0},{id:'sofa',itemId:'sofa',x:3,y:12,rotation:90}];
  const decorated=await call('/world/rooms/'+owner.id,{token:owner.token,method:'PATCH',body:{revision:1,name:'カサイのアトリエ',decorations}});
  assert.equal(decorated.status,200);assert.deepEqual(decorated.room.decorations,decorations);
  assert.deepEqual((await call('/world/rooms/'+owner.id,{token:visitor.token})).room,decorated.room);
  assert.equal((await call('/world/rooms/'+owner.id,{token:visitor.token,method:'PATCH',body:{revision:2,decorations:[]}})).error.code,'ROOM_OWNER_REQUIRED');
  for(const [x,y] of [[12,4],[11,10],[12,18]])assert.equal((await call('/world/rooms/'+owner.id,{token:owner.token,method:'PATCH',body:{revision:2,decorations:[{id:'blocked',itemId:'plant',x,y,rotation:0}]}})).status,400);
  const target=door('coast');await atWall(owner,target);
  const moved=await call('/world/rooms/'+owner.id+'/relocate',{token:owner.token,method:'POST',body:{revision:2,...target}});assert.equal(moved.status,200);assert.equal(moved.room.id,one.room.id);assert.equal(moved.room.createdAt,one.room.createdAt);assert.equal(moved.room.name,decorated.room.name);assert.deepEqual(moved.room.decorations,decorations);assert.equal(moved.room.revision,3);
  assert.deepEqual((await call('/world/rooms/kasai',{token:visitor.token})).room,moved.room);
  assert.deepEqual((await call('/world/rooms?kind=kasai',{token:owner.token})).rooms,[moved.room]);
  for(const map of ['village','forest'])assert.deepEqual((await call('/world/rooms?map='+map,{token:visitor.token})).rooms,[]);
  assert.deepEqual((await call('/world/rooms?map=coast',{token:visitor.token})).rooms,[moved.room]);
  env.DB.sqlite.prepare('DELETE FROM admin_owner').run();const nextOwner=await admin({createRoom:false});
  assert.equal((await call('/world/rooms/kasai',{token:visitor.token})).room,null);
  const next=(await create(nextOwner,door('meadow'))).room;assert.equal(next.id,nextOwner.id);assert.equal(next.kind,'kasai');
  const old=(await call('/world/rooms/'+owner.id,{token:visitor.token})).room;assert.equal(old.kind,'secret');assert.equal(old.width,18);assert.deepEqual(old.decorations,[decorations[1]]);assert.deepEqual(old.entrance,moved.room.entrance);
  assert.deepEqual(JSON.parse(env.DB.sqlite.prepare('SELECT decorations_json FROM world_rooms WHERE owner_id=?').get(owner.id).decorations_json),decorations);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_rooms').get().n,2);
});

test('dynamic presence requires persisted room and uses current room dimensions and map isolation',async t=>{
  const {call,register,admin,create,presence}=setup(t),a=await register(),b=await register(),owner=await admin();
  const room=(await create(a)).room,kasai=(await call('/world/rooms/kasai',{token:a.token})).room;
  assert.equal((await presence(a,'room:P0000000000000000')).status,400);
  assert.equal((await presence(a,room.mapId,18,12)).status,400);assert.equal((await presence(a,room.mapId,9,16)).status,400);
  assert.equal((await presence(a,room.mapId)).status,200);assert.deepEqual((await presence(b,room.mapId)).players.map(p=>p.id),[a.id]);
  assert.equal((await presence(a,kasai.mapId,23,19)).status,400);
  assert.equal((await presence(a,kasai.mapId,22,18)).status,200);assert.deepEqual((await presence(b,room.mapId)).players,[]);
  assert.equal((await presence(owner,kasai.mapId,24,19)).status,400);
});

test('template migration adds the original hall without changing existing rooms, furniture or revisions',()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  for(const file of ['0000_admin.sql','0003_rooms.sql'])db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  const owner='P0000000000000001',decorations=JSON.stringify([{id:'old-bed',itemId:'bed',x:3,y:8,rotation:90}]);
  db.prepare('INSERT INTO players (id,token_hash,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(owner,'legacy-hash','既存の旅人',100,200);
  db.prepare("INSERT INTO world_rooms (owner_id,map_id,entrance_x,entrance_y,facing,name,decorations_json,revision,created_at,updated_at) VALUES (?,'forest',4,7,'down','以前の部屋',?,9,100,200)").run(owner,decorations);
  const before={...db.prepare('SELECT * FROM world_rooms').get()};
  db.exec(readFileSync(new URL('../drizzle/0008_room_templates.sql',import.meta.url),'utf8'));
  assert.deepEqual({...db.prepare('SELECT * FROM world_rooms').get()},{...before,template_id:'hall'});
  for(const id of ['unknown','',null])assert.throws(()=>db.prepare('UPDATE world_rooms SET template_id=?').run(id),/CHECK|NOT NULL/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
});

test('the three template masks keep a connected floor, exact silhouettes and the common protected stage',()=>{
  assert.deepEqual(ROOM_TEMPLATES.map(template=>template.id),['hall','sanctum','wings']);
  const bounds={
    hall:Array.from({length:18},()=>[1,22]),
    sanctum:[[6,17],[5,18],[4,19],[3,20],...Array.from({length:10},()=>[2,21]),[3,20],[4,19],[5,18],[6,17]],
    wings:[...Array.from({length:5},()=>[7,16]),...Array.from({length:8},()=>[1,22]),...Array.from({length:5},()=>[7,16])]
  };
  for(const template of ROOM_TEMPLATES){
    assert.equal(template.width,24);assert.equal(template.height,20);assert.equal(template.floorMask.length,20);
    const expected=['0'.repeat(24),...bounds[template.id].map(([left,right])=>'0'.repeat(left)+'1'.repeat(right-left+1)+'0'.repeat(23-right)),'0'.repeat(24)];
    assert.deepEqual(template.floorMask,expected,template.id);
    const queue=[[12,16]],visited=new Set(['12,16']);
    for(let i=0;i<queue.length;i++)for(const [dx,dy] of [[0,1],[1,0],[0,-1],[-1,0]]){
      const [x,y]=queue[i],nx=x+dx,ny=y+dy,key=nx+','+ny;
      if(template.floorMask[ny]?.[nx]==='1'&&!visited.has(key)){visited.add(key);queue.push([nx,ny]);}
    }
    assert.equal(visited.size,expected.join('').split('1').length-1,'Every floor tile is reachable from the spawn');
    for(let y=1;y<=18;y++)for(const x of [11,12])assert(visited.has(x+','+y));
    for(let y=2;y<=7;y++)for(let x=8;x<=15;x++)assert(visited.has(x+','+y));
    assert.deepEqual(template.spawn,{x:12,y:16});assert.deepEqual(template.exit,{x:12,y:18});
    assert.deepEqual(template.protected,ROOM_LAYOUTS.kasai.protected);
    assert.throws(()=>validateRoomDecorations([{id:'stage',itemId:'plant',x:12,y:4,rotation:0}],'kasai',template.id));
  }
  assert.throws(()=>validateRoomDecorations([{id:'right-edge',itemId:'sofa',x:18,y:2,rotation:0}],'kasai','sanctum'),/アイテム全体/);
  assert.throws(()=>validateRoomDecorations([{id:'lower-wing',itemId:'bed',x:5,y:12,rotation:0}],'kasai','wings'),/アイテム全体/);
});

test('template changes persist for visitors and reject incompatible furniture atomically',async t=>{
  const {env,call,register,admin}=setup(t),owner=await admin(),visitor=await register();
  const catalog=await call('/world/rooms/catalog',{token:visitor.token});assert.deepEqual(catalog.templates,ROOM_TEMPLATES);
  const patch=body=>call('/world/rooms/'+owner.id,{token:owner.token,method:'PATCH',body});
  const initial=(await call('/world/rooms/mine',{token:owner.token})).room;assert.equal(initial.templateId,'hall');
  const old=[{id:'keep-plant',itemId:'plant',x:2,y:3,rotation:0}];
  const furnished=await patch({revision:initial.revision,decorations:old});assert.equal(furnished.status,200);
  const stored={...env.DB.sqlite.prepare('SELECT * FROM world_rooms WHERE owner_id=?').get(owner.id)};
  for(const body of [{templateId:'sanctum'},{templateId:'sanctum',decorations:old},{templateId:'wings',decorations:old}]){
    const refused=await patch({revision:furnished.room.revision,...body});assert.equal(refused.status,400,JSON.stringify(refused));
    assert.deepEqual({...env.DB.sqlite.prepare('SELECT * FROM world_rooms WHERE owner_id=?').get(owner.id)},stored);
  }
  for(const templateId of ['',null,[],{},'__proto__','unknown'])assert.equal((await patch({revision:furnished.room.revision,templateId,decorations:[]})).status,400);
  let revision=furnished.room.revision;
  for(const template of ROOM_TEMPLATES){
    const decorations=[{...old[0],x:3,y:10}],changed=await patch({revision,templateId:template.id,decorations});assert.equal(changed.status,200,JSON.stringify(changed));
    revision=changed.room.revision;assert.equal(changed.room.templateId,template.id);assert.deepEqual(changed.room.floorMask,template.floorMask);assert.deepEqual(changed.room.decorations,decorations);
    assert.deepEqual((await call('/world/rooms/'+owner.id,{token:visitor.token})).room,changed.room);
    assert.deepEqual((await call('/world/rooms?kind=kasai',{token:visitor.token})).rooms,[changed.room]);
    assert.equal(env.DB.sqlite.prepare('SELECT template_id FROM world_rooms WHERE owner_id=?').get(owner.id).template_id,template.id);
  }
  const concurrent=await Promise.all(['hall','sanctum'].map(templateId=>patch({revision,templateId,decorations:[{...old[0],x:3,y:10}]})));
  assert.deepEqual(concurrent.map(result=>result.status).sort(),[200,409]);
  const winner=concurrent.find(result=>result.status===200).room;
  assert.deepEqual((await call('/world/rooms/'+owner.id,{token:visitor.token})).room,winner);
});

test('world presence follows the selected floor mask and retains stage, spawn and exit coordinates',async t=>{
  const {call,register,admin,presence}=setup(t),owner=await admin(),visitor=await register();let revision=1;
  for(const templateId of ['hall','sanctum','wings']){
    const changed=await call('/world/rooms/'+owner.id,{token:owner.token,method:'PATCH',body:{revision,templateId,decorations:[]}});assert.equal(changed.status,200);revision=changed.room.revision;
    const map=changed.room.mapId;
    for(const [x,y] of [[12,4],[12,5],[12,16],[12,18],[3,10]])assert.equal((await presence(visitor,map,x,y)).status,200,templateId+':'+x+','+y);
    for(const [x,y] of [[0,10],[23,10],[12,0],[12,19]])assert.equal((await presence(visitor,map,x,y)).status,400);
    for(const [x,y] of [[2,3],[21,3],[3,16]])assert.equal((await presence(visitor,map,x,y)).status,templateId==='hall'?200:400,templateId+':'+x+','+y);
    assert.equal((await presence(visitor,map,5,8)).status,200,'Both side wings remain walkable');
  }
});

test('CPU starts require live play, while authenticated issued-session recovery stays idempotent',async t=>{
  const {env,call,register,admin,challenge}=setup(t),a=await register(),owner=await admin(),room=(await call('/world/rooms/kasai',{token:a.token})).room;
  const body={requestId:crypto.randomUUID(),roomId:room.id,party:team(),storageCount:0};
  assert.equal((await call('/world/kasai/challenges',{method:'POST',body})).status,401);
  assert.equal((await call('/world/kasai/challenges',{token:a.token,method:'POST',body})).error.code,'KASAI_LIVE_REQUIRED');
  assert.equal((await call('/world/kasai/challenges',{token:owner.token,method:'POST',body})).error.code,'KASAI_SELF_BATTLE');
  for(const patch of [{roomId:[owner.id]},{party:[]},{storageCount:'0'},{storageCount:193},{won:true}])assert.equal((await call('/world/kasai/challenges',{token:a.token,method:'POST',body:{...body,...patch}})).status,400);
  const issued=await challenge(a,room),record=env.DB.sqlite.prepare('SELECT request_id FROM kasai_challenges WHERE id=?').get(issued.challenge.id),retry={requestId:record.request_id,roomId:room.id,party:issued.challenge.party,storageCount:0};
  const responses=await Promise.all([call('/world/kasai/challenges',{token:a.token,method:'POST',body:retry}),call('/world/kasai/challenges',{token:a.token,method:'POST',body:retry})]);
  assert(responses.every(result=>result.status===200));assert.equal(responses[0].token,issued.token);assert.deepEqual(responses[0],responses[1]);assert.equal(responses[0].challenge.id,issued.challenge.id);
  assert.equal((await call('/world/kasai/challenges',{token:a.token,method:'POST',body:{...retry,party:retry.party.slice(0,1)}})).error.code,'KASAI_REQUEST_REUSED');
});

test('actual deterministic win creates one durable random-gender receipt and explicit ACK',async t=>{
  const {env,call,register,admin,challenge,complete,advance}=setup(t),a=await register(),b=await register();await admin();
  const room=(await call('/world/rooms/kasai',{token:a.token})).room,start=await challenge(a,room);assert.equal(start.status,200);
  const actions=play({...start.challenge,token:start.token});assert.equal(replayChallenge(start.challenge.party,start.challenge.seed,actions,start.challenge.opponents,start.challenge.rulesVersion).won,true);
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

test('missing signing configuration blocks reissuing an old challenge token',async t=>{
  const {env,call,register,admin,challenge}=setup(t),a=await register();await admin();const room=(await call('/world/rooms/kasai',{token:a.token})).room,issued=await challenge(a,room);
  const record=env.DB.sqlite.prepare('SELECT request_id FROM kasai_challenges WHERE id=?').get(issued.challenge.id);delete env.DUEL_SIGNING_KEY;
  const result=await call('/world/kasai/challenges',{token:a.token,method:'POST',body:{requestId:record.request_id,roomId:room.id,party:issued.challenge.party,storageCount:0}});
  assert.equal(result.error.code,'KASAI_NOT_CONFIGURED');assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_challenges').get().n,1);
});


test('the current administrator cannot start, recover or acknowledge a self battle',async t=>{
  const {env,call,register,admin,challenge}=setup(t),visitor=await register(),owner=await admin(),room=(await call('/world/rooms/kasai',{token:visitor.token})).room;
  const started=await challenge(owner,room);assert.equal(started.status,403);assert.equal(started.error.code,'KASAI_SELF_BATTLE');
  assert.equal((await call('/world/kasai/reward',{token:owner.token})).error.code,'KASAI_SELF_BATTLE');
  assert.equal((await call('/world/kasai/reward/ack',{token:owner.token,method:'POST',body:{receiptId:'kasai-reward:'+owner.id}})).error.code,'KASAI_SELF_BATTLE');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_challenges').get().n,0);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_rewards').get().n,0);
  assert.equal((await challenge(visitor,room)).status,200);
});

test('a player promoted to administrator cannot complete an old challenge or recover a pending gift',async t=>{
  const {env,call,register,admin,challenge,complete}=setup(t),a=await register(),b=await register();await admin();
  const room=(await call('/world/rooms/kasai',{token:a.token})).room,start=await challenge(a,room),actions=play({...start.challenge,token:start.token});
  const earned=await challenge(b,room),won=await complete(b,earned,play({...earned.challenge,token:earned.token}));assert.equal(won.status,200);
  env.DB.sqlite.prepare('UPDATE admin_owner SET player_id=?').run(a.id);
  assert.equal((await complete(a,start,actions)).error.code,'KASAI_SELF_BATTLE');
  assert.equal(env.DB.sqlite.prepare('SELECT state FROM kasai_challenges WHERE id=?').get(start.challenge.id).state,'pending');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_rewards WHERE player_id=?').get(a.id).n,0);
  assert.equal((await call('/world/kasai/challenges/'+start.challenge.id+'/cancel',{token:a.token,method:'POST',body:{token:start.token}})).cancelled,true);
  env.DB.sqlite.prepare('UPDATE admin_owner SET player_id=?').run(b.id);
  assert.equal((await call('/world/kasai/reward',{token:b.token})).error.code,'KASAI_SELF_BATTLE');
  assert.equal((await call('/world/kasai/reward/ack',{token:b.token,method:'POST',body:{receiptId:won.receipt.id}})).error.code,'KASAI_SELF_BATTLE');
  assert.equal(env.DB.sqlite.prepare('SELECT acked_at FROM kasai_rewards WHERE player_id=?').get(b.id).acked_at,null);
});

test('legacy self-battle records cannot pay after ownership moves, and owned records are retained',async t=>{
  const {env,call,register,admin,create,challenge,complete}=setup(t),a=await register();await create(a);await admin();
  const room=(await call('/world/rooms/kasai',{token:a.token})).room,start=await challenge(a,room),actions=play({...start.challenge,token:start.token});
  // A v56 self-battle can remain after its owner relinquishes the admin role.
  env.DB.sqlite.prepare('UPDATE kasai_challenges SET room_owner_id=? WHERE id=?').run(a.id,start.challenge.id);
  assert.equal((await complete(a,start,actions)).error.code,'KASAI_SELF_BATTLE');
  env.DB.sqlite.prepare('UPDATE kasai_challenges SET room_owner_id=? WHERE id=?').run(room.id,start.challenge.id);
  const won=await complete(a,start,actions);assert.equal(won.status,200);
  env.DB.sqlite.prepare('UPDATE kasai_challenges SET room_owner_id=? WHERE id=?').run(a.id,start.challenge.id);
  assert.equal((await call('/world/kasai/reward',{token:a.token})).error.code,'KASAI_SELF_BATTLE');
  assert.equal((await call('/world/kasai/reward/ack',{token:a.token,method:'POST',body:{receiptId:won.receipt.id}})).error.code,'KASAI_SELF_BATTLE');
  const stored=env.DB.sqlite.prepare('SELECT * FROM kasai_rewards WHERE player_id=?').get(a.id);assert.equal(stored.acked_at,null);
  env.DB.sqlite.prepare('UPDATE kasai_rewards SET acked_at=? WHERE player_id=?').run(Date.now(),a.id);
  assert.equal((await call('/duel-pass',{token:a.token,method:'POST',body:{sessionId:'0123456789abcdef'.repeat(2),side:0,grantId:won.receipt.id}})).status,200);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_rewards WHERE player_id=?').get(a.id).n,1);
});

test('a role transfer during completion cannot commit a victory reward',async t=>{
  const {env,call,register,admin,challenge,complete}=setup(t),a=await register();await admin();
  const room=(await call('/world/rooms/kasai',{token:a.token})).room,start=await challenge(a,room),actions=play({...start.challenge,token:start.token});
  const original=env.DB.batch.bind(env.DB);env.DB.batch=async statements=>{env.DB.sqlite.prepare('UPDATE admin_owner SET player_id=?').run(a.id);return original(statements);};
  assert.equal((await complete(a,start,actions)).error.code,'KASAI_SELF_BATTLE');
  assert.equal(env.DB.sqlite.prepare('SELECT state FROM kasai_challenges WHERE id=?').get(start.challenge.id).state,'pending');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_rewards').get().n,0);
});

test('only the current administrator publishes an authentic party and issued sessions retain their original snapshot',async t=>{
  const {env,call,register,admin,challenge,complete,advance}=setup(t),a=await register(),owner=await admin(),engine=new runtime.LT.Engine();
  const publish=(actor,party,extra={})=>call('/world/kasai/party',{token:actor.token,method:'POST',body:{party,...extra}});
  const futo=engine.makeMonster('futo',100,DEFAULT_CONFIG.stats,DEFAULT_CONFIG.moves);futo.grantId='admin-initial:'+owner.id;
  const mythic=engine.makeMonster('floravelle',70);mythic.grantId='admin-mythical:'+owner.id;
  const legendary=engine.makeMonster('arvelion',88);Object.assign(legendary,{grantId:'admin-legendary:'+owner.id,shiny:true,nickname:'カサイ',moveOrder:[3,1,2,0],alloc:{hp:10,atk:30,def:12},bonusPoints:4,heldItem:'learnsash',curse:true,status:'scorch',xp:23});
  const roster=copy([legendary,futo,mythic]);
  assert.equal((await call('/world/kasai/party')).status,401);
  assert.equal((await publish(a,roster)).error.code,'ADMIN_REQUIRED');
  for(const party of [[],Array(7).fill(roster[0]),[{...roster[0],level:101}],null])assert.equal((await publish(owner,party)).status,400);
  assert.equal((await publish(owner,roster,{playerId:a.id})).status,400);
  assert.equal((await publish(owner,[{...roster[1],grantId:'admin-initial:'+a.id}])).error.code,'KASAI_PARTY_NOT_OWNED');
  assert.equal((await publish(owner,[{...roster[1],customStats:{...roster[1].customStats,atk:roster[1].customStats.atk+1}}])).error.code,'KASAI_PARTY_CHANGED');
  const saved=await publish(owner,roster);assert.equal(saved.status,200);assert.equal(saved.playerId,owner.id);
  const actual=saved.party;assert.deepEqual(actual.map(mon=>mon.species),roster.map(mon=>mon.species));
  for(const key of ['level','shiny','nickname','moveOrder','alloc','bonusPoints','heldItem','curse','xp'])assert.deepEqual(actual[0][key],roster[0][key],key);
  assert.deepEqual(actual[1].customStats,roster[1].customStats);assert.deepEqual(actual[1].customMoves,roster[1].customMoves);assert.equal(actual[2].gender,roster[2].gender);
  assert.deepEqual((await call('/world/kasai/party',{token:a.token})).party,actual);
  advance(1000);assert.equal((await publish(owner,roster)).updatedAt,saved.updatedAt);
  const weak=copy([engine.makeMonster('komori',7),engine.makeMonster('shizunaria',12)]),weakSaved=await publish(owner,weak);
  const room=(await call('/world/rooms/kasai',{token:a.token})).room,start=await challenge(a,room);assert.equal(start.challenge.rulesVersion,RULES_VERSION);assert.deepEqual(start.challenge.opponents,weakSaved.party);
  const changed=await publish(owner,copy([engine.makeMonster('arvelion',85)]));assert.equal(changed.status,200);
  assert.deepEqual(JSON.parse(env.DB.sqlite.prepare('SELECT opponents_json FROM kasai_challenges WHERE id=?').get(start.challenge.id).opponents_json),weakSaved.party);
  const won=await complete(a,start,play({...start.challenge,token:start.token}));assert.equal(won.won,true);
  const next=await challenge(a,room);assert.deepEqual(next.challenge.opponents,changed.party);assert.equal(next.challenge.opponents.length,1);assert.equal(next.challenge.opponents[0].level,85);
});

test('an unconfigured or newly transferred administrator never falls back to a fixed party',async t=>{
  const {env,call,register,admin,challenge}=setup(t),a=await register(),owner=await admin(),next=await register('次の運営');
  const oldRoom=(await call('/world/rooms/kasai',{token:a.token})).room;
  env.DB.sqlite.prepare('DELETE FROM kasai_parties WHERE player_id=?').run(owner.id);
  assert.equal((await call('/world/kasai/party',{token:a.token})).party,null);
  assert.equal((await call('/world/kasai/challenges',{token:a.token,method:'POST',body:{requestId:crypto.randomUUID(),roomId:oldRoom.id,party:team(),storageCount:0}})).error.code,'KASAI_LIVE_REQUIRED');
  env.DB.sqlite.prepare('UPDATE admin_owner SET player_id=?').run(next.id);
  assert.equal((await call('/world/rooms/kasai',{token:a.token})).room,null);
  assert.equal((await call('/world/kasai/party',{token:a.token})).party,null);
  assert.equal((await call('/world/kasai/party',{token:owner.token,method:'POST',body:{party:team()}})).error.code,'ADMIN_REQUIRED');
  assert.equal((await call('/world/kasai/challenges',{token:a.token,method:'POST',body:{requestId:crypto.randomUUID(),roomId:next.id,party:team(),storageCount:0}})).error.code,'KASAI_LIVE_REQUIRED');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_challenges').get().n,0);
});

test('real legacy challenge rules remain replayable only for a pre-v57 row without opponents',async t=>{
  const {env,call,register,admin,challenge,complete}=setup(t),a=await register();await admin();
  const room=(await call('/world/rooms/kasai',{token:a.token})).room,start=await challenge(a,room),row=env.DB.sqlite.prepare('SELECT * FROM kasai_challenges WHERE id=?').get(start.challenge.id);
  const payload=new TextEncoder().encode(JSON.stringify({kind:'kasai-challenge',v:1,id:row.id,playerId:a.id,seed:row.seed,rulesVersion:LEGACY_RULES_VERSION,expiresAt:row.expires_at}));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(SIGNING),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const token=Buffer.from(await crypto.subtle.sign('HMAC',key,payload)).toString('base64url'),hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
  env.DB.sqlite.prepare('UPDATE kasai_challenges SET rules_version=?,opponents_json=NULL,token_hash=? WHERE id=?').run(LEGACY_RULES_VERSION,hash,row.id);
  const legacy={challenge:{...start.challenge,rulesVersion:LEGACY_RULES_VERSION,opponents:null},token},actions=play({...legacy.challenge,token});
  assert.equal(replayChallenge(legacy.challenge.party,legacy.challenge.seed,actions,null,LEGACY_RULES_VERSION).won,true);
  const won=await complete(a,legacy,actions);assert.equal(won.status,200);assert.equal(won.won,true);
  const invalid=await challenge(a,room);env.DB.sqlite.prepare('UPDATE kasai_challenges SET opponents_json=NULL WHERE id=?').run(invalid.challenge.id);
  assert.equal((await complete(a,invalid,actions)).error.code,'KASAI_CHALLENGE_FINISHED');
});

test('retired v57 challenge recovery and completion expire the old snapshot before any new-rule replay',async t=>{
  const h=setup(t),{env,call,register,admin,challenge,complete,presence}=h,a=await register(),owner=await admin();
  assert.equal(RULES_VERSION,'kasai-solo-v74');
  const room=(await call('/world/rooms/kasai',{token:a.token})).room;
  const fixture=JSON.parse(readFileSync(new URL('../../scripts/fixtures/v73-retired-line-save.json',import.meta.url),'utf8'));
  const originalParty=JSON.stringify([fixture.party.find(mon=>mon.species==='galdoras')]);
  const originalOpponents=JSON.stringify(fixture.party);
  for(const operation of ['recover','complete']){
    const start=await challenge(a,room),row=env.DB.sqlite.prepare('SELECT * FROM kasai_challenges WHERE id=?').get(start.challenge.id);
    const payload=new TextEncoder().encode(JSON.stringify({kind:'kasai-challenge',v:1,id:row.id,playerId:a.id,seed:row.seed,rulesVersion:'kasai-solo-v57',expiresAt:row.expires_at}));
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(SIGNING),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const token=Buffer.from(await crypto.subtle.sign('HMAC',key,payload)).toString('base64url');
    const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
    env.DB.sqlite.prepare('UPDATE kasai_challenges SET rules_version=?,party_json=?,opponents_json=?,token_hash=? WHERE id=?').run('kasai-solo-v57',originalParty,originalOpponents,hash,row.id);
    const old={...start,token};
    if(operation==='complete'){
      const forged=await complete(a,{...old,token:'A'.repeat(43)},[{type:'struggle'}]);
      assert.equal(forged.error.code,'INVALID_KASAI_TOKEN');
      assert.equal(env.DB.sqlite.prepare('SELECT state FROM kasai_challenges WHERE id=?').get(row.id).state,'pending','An invalid token cannot expire another record');
    }
    const result=operation==='recover'
      ? await call('/world/kasai/challenges',{token:a.token,method:'POST',body:{requestId:row.request_id,roomId:room.id,party:JSON.parse(originalParty),storageCount:0}})
      : await complete(a,old,[{type:'struggle'}]);
    assert.equal(result.status,409,JSON.stringify(result));assert.equal(result.error.code,'KASAI_CHALLENGE_FINISHED');
    assert.match(result.error.message,/ルールが更新.*新しい対戦/);
    const expired=env.DB.sqlite.prepare('SELECT * FROM kasai_challenges WHERE id=?').get(row.id);
    assert.equal(expired.state,'expired');assert.equal(expired.completed_at,Date.now());
    assert.equal(expired.party_json,originalParty);assert.equal(expired.opponents_json,originalOpponents);
    assert.equal(expired.rules_version,'kasai-solo-v57');assert.equal(expired.token_hash,hash);
    assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_rewards').get().n,0);
  }
  // CPU challenges have been retired. Old pending records never occupy a live
  // session slot, so the player can invite the nearby administrator immediately.
  env.DB.sqlite.prepare("UPDATE kasai_challenges SET state='pending',completed_at=NULL WHERE player_id=? AND rules_version='kasai-solo-v57'").run(a.id);
  await presence(owner,'village',22,17,'left');await presence(a,'village',21,17,'right');
  const invited=await call('/world/kasai/live',{token:a.token,method:'POST',body:{requestId:crypto.randomUUID(),roomId:owner.id,party:team(),storageCount:0}});
  assert.equal(invited.status,200,JSON.stringify(invited));assert.equal(invited.session.state,'staging');
  assert.equal(env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM kasai_challenges WHERE player_id=? AND state='pending' AND expires_at>?").get(a.id,Date.now()).n,2,'Unvisited old challenges do not block a fresh live invitation');
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_live_members').get().n,2);
});

test('a completed old-version challenge keeps its receipt and idempotent result without replaying',async t=>{
  const {env,call,register,admin,challenge,complete}=setup(t),a=await register();await admin();
  const room=(await call('/world/rooms/kasai',{token:a.token})).room,start=await challenge(a,room);
  const actions=play({...start.challenge,token:start.token}),won=await complete(a,start,actions);assert.equal(won.status,200);assert.equal(won.won,true);
  const row=env.DB.sqlite.prepare('SELECT * FROM kasai_challenges WHERE id=?').get(start.challenge.id);
  const payload=new TextEncoder().encode(JSON.stringify({kind:'kasai-challenge',v:1,id:row.id,playerId:a.id,seed:row.seed,rulesVersion:'kasai-solo-v57',expiresAt:row.expires_at}));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(SIGNING),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const token=Buffer.from(await crypto.subtle.sign('HMAC',key,payload)).toString('base64url');
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
  env.DB.sqlite.prepare('UPDATE kasai_challenges SET rules_version=?,token_hash=? WHERE id=?').run('kasai-solo-v57',hash,row.id);
  const settled=env.DB.sqlite.prepare('SELECT * FROM kasai_challenges WHERE id=?').get(row.id);
  const recovered=await complete(a,{...start,token},actions);assert.equal(recovered.status,200);assert.equal(recovered.won,true);
  assert.deepEqual(recovered.receipt,won.receipt);assert.deepEqual((await call('/world/kasai/reward',{token:a.token})).receipt,won.receipt);
  assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM kasai_challenges WHERE id=?').get(row.id),settled);
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_rewards').get().n,1);
});
