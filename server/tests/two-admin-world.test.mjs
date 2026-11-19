import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker, {worldRoomWalls} from '../server.mjs';
import {createReplayRuntime} from '../kasai-replay.mjs';
import {validateLiveOrders} from '../kasai-live-engine.mjs';

const LT=createReplayRuntime(),copy=value=>JSON.parse(JSON.stringify(value));
const SECRET='two-admin-integration-test-claim-key';
const SIGNING='two-admin-integration-test-signing-secret-at-least-32';
const MIGRATIONS=['0000_admin.sql','0001_trades.sql','0002_world.sql','0003_rooms.sql','0004_kasai_party.sql','0005_kasai_live.sql','0006_sub_admin.sql','0007_third_admin.sql'];

class LocalD1 {
  constructor(){
    this.sqlite=new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON');
    for(const file of MIGRATIONS)this.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  }
  prepare(sql){
    const database=this;
    return {
      sql,values:[],bind(...values){this.values=values;return this;},
      execute(){
        const results=database.sqlite.prepare(sql).all(...this.values).map(row=>({...row}));
        return {results,success:true,meta:{changes:database.sqlite.prepare('SELECT changes() AS n').get().n}};
      },
      async first(){return this.execute().results[0]||null;},
      async all(){return this.execute();},async run(){return this.execute();}
    };
  }
  async batch(statements){
    this.sqlite.exec('BEGIN IMMEDIATE');
    try{const results=statements.map(statement=>statement.execute());this.sqlite.exec('COMMIT');return results;}
    catch(error){this.sqlite.exec('ROLLBACK');throw error;}
  }
}

function ok(response){assert.equal(response.status,200,JSON.stringify(response));return response;}
function party(species='arvelion',level=70){return copy([new LT.Engine().makeMonster(species,level)]);}
function ownedParty(actor,profile){
  const grant=profile.grants.find(row=>row.grantId==='admin-initial:'+actor.id);
  assert(grant,'Every administrator receives their own initial Futo');
  const engine=new LT.Engine();
  return copy([
    {...engine.makeMonster('arvelion',70),grantId:'admin-legendary:'+actor.id,nickname:actor.name},
    {...engine.makeMonster('futo',grant.level,grant.stats,grant.moves),grantId:grant.grantId},
    {...engine.makeMonster('floravelle',70),grantId:'admin-mythical:'+actor.id}
  ]);
}

function setup(t){
  let now=Date.now(),address=0;
  t.mock.method(Date,'now',()=>now);
  const env={DB:new LocalD1(),ADMIN_CLAIM_KEY:SECRET,DUEL_SIGNING_KEY:SIGNING};
  t.after(()=>env.DB.sqlite.close());
  const advance=milliseconds=>now+=milliseconds;
  const call=async(path,actor,method='GET',body)=>{
    const headers={'Content-Type':'application/json',Origin:'https://uni-tadayasu.github.io','CF-Connecting-IP':'192.0.2.'+(++address)};
    if(actor)headers.Authorization='Bearer '+actor.token;
    const response=await worker.fetch(new Request('https://two-admin.example/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
    const data=await response.json(),serialized=JSON.stringify(data);
    assert(!serialized.includes(SECRET));assert(!serialized.includes(SIGNING));
    return {status:response.status,...data};
  };
  const register=async name=>{
    const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const result=ok(await call('/register',null,'POST',{name,token}));
    return {token,...result.player};
  };
  const admins=async()=>{
    const main=await register('主運営'),sub=await register('サブ運営');
    ok(await call('/admin/claim',main,'POST',{key:SECRET}));advance(1);
    ok(await call('/admin/devices',main,'POST',{playerId:sub.id,confirmed:true}));
    assert.equal(ok(await call('/me',sub)).player.isAdmin,true);
    return {main,sub};
  };
  const threeAdmins=async()=>{
    const {main,sub}=await admins(),third=await register('第三運営');
    ok(await call('/admin/devices',main,'POST',{playerId:third.id,role:'sub-sub',confirmed:true}));
    assert.equal(ok(await call('/me',third)).player.adminRole,'sub-sub');
    return {main,sub,third};
  };
  const presence=async(actor,position={})=>{
    advance(300);
    return call('/world/presence',actor,'POST',{map:'village',x:21,y:17,facing:'up',avatar:'male',status:'idle',...position});
  };
  const createRoom=async(actor,map='village',index=0)=>{
    const wall=worldRoomWalls(map)[index],facing=wall.facings[0];
    const [dx,dy]={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]}[facing];
    ok(await presence(actor,{map,x:wall.x-dx,y:wall.y-dy,facing}));
    return ok(await call('/world/rooms',actor,'POST',{map,x:wall.x,y:wall.y,facing})).room;
  };
  const revoke=async(actor,target)=>{
    const current=ok(await call('/admin/devices',actor)).devices.find(row=>row.playerId===target.id);
    assert(current,'The target registration must be reviewed before revoking it');
    return call('/admin/devices/revoke',actor,'POST',{playerId:target.id,claimedAt:current.claimedAt,confirmed:true});
  };
  const live=(actor,id,action,body={})=>call('/world/kasai/live'+(id?'/'+id:'')+(action?'/'+action:''),actor,action?'POST':'GET',action?body:undefined);
  const start=(actor,target)=>call('/world/kasai/live',actor,'POST',{requestId:crypto.randomUUID(),roomId:target.id,party:party('arvelion',100),storageCount:0});
  const participants=async()=>{
    const {main,sub}=await admins();
    await createRoom(main,'village');await createRoom(sub,'meadow');
    const mainChallenger=await register('主運営への挑戦者'),subChallenger=await register('サブ運営への挑戦者');
    for(const [actor,x] of [[main,22],[sub,24],[mainChallenger,21],[subChallenger,25]])ok(await presence(actor,{x}));
    return {main,sub,mainChallenger,subChallenger};
  };
  const threeParticipants=async()=>{
    const {main,sub,third}=await threeAdmins(),hosts=[main,sub,third],challengers=[];
    for(const [index,actor] of hosts.entries()){
      await createRoom(actor,['village','meadow','forest'][index]);
      challengers.push(await register('挑戦者'+(index+1)));
    }
    for(const [index,actor] of hosts.entries()){
      ok(await presence(actor,{x:22+index*2}));ok(await presence(challengers[index],{x:21+index*2}));
    }
    return {main,sub,third,hosts,challengers};
  };
  return {env,advance,call,register,admins,threeAdmins,presence,createRoom,revoke,live,start,participants,threeParticipants};
}

test('both administrators receive initial companions, current Kasai identities and independent editable rooms',async t=>{
  const h=setup(t),{main,sub}=await h.admins(),visitor=await h.register('旅人');
  for(const actor of [main,sub]){
    const profile=ok(await h.call('/me',actor));
    assert.equal(profile.player.isAdmin,true);
    assert.equal(profile.player.adminRole,actor.id===main.id?'main':'sub');
    assert.equal(profile.player.name,actor.name);
    assert.equal(profile.player.displayName,actor.id===main.id?'謎のトレーナー カサイ':'サカイ');
    assert.deepEqual(profile.initialCompanions,[
      {grantId:'admin-legendary:'+actor.id,species:'arvelion',level:70},
      {grantId:'admin-mythical:'+actor.id,species:'floravelle',level:70}
    ]);
    assert.equal(profile.grants.filter(row=>row.grantId==='admin-initial:'+actor.id).length,1);
  }
  const ordinary=ok(await h.call('/me',visitor));
  assert.deepEqual(ordinary.initialCompanions,[]);assert.equal(ordinary.player.adminRole,null);
  const rooms=[await h.createRoom(main),await h.createRoom(sub,'meadow')];
  for(const [index,actor] of [main,sub].entries()){
    assert.equal(rooms[index].kind,'kasai');assert.equal(rooms[index].owner.isAdmin,true);
    assert.equal(rooms[index].owner.adminRole,index===0?'main':'sub');
    assert.equal(rooms[index].owner.avatar,index===0?'kasai':'sub-admin');
    assert.equal(rooms[index].owner.name,index===0?'謎のトレーナー カサイ':'サカイ');
    assert.equal(ok(await h.call('/world/rooms/kasai',actor)).room.id,actor.id);
  }
  assert.equal(ok(await h.call('/world/rooms/kasai',visitor)).room.id,main.id);
  assert.deepEqual(ok(await h.call('/world/rooms?kind=kasai',visitor)).rooms.map(room=>room.id).sort(),[main.id,sub.id].sort());
  const changed=ok(await h.call('/world/rooms/'+sub.id,sub,'PATCH',{
    revision:rooms[1].revision,name:'サブ運営のステージ',decorations:[{id:'sub-plant',itemId:'plant',x:20,y:10,rotation:0}]
  })).room;
  assert.equal(changed.name,'サブ運営のステージ');assert.equal(changed.decorations.length,1);
  assert.equal((await h.call('/world/rooms/'+sub.id,main,'PATCH',{revision:changed.revision,name:'他人の部屋'})).status,403);
  for(const [actor,x] of [[main,22],[sub,24]]){
    const shown=ok(await h.presence(actor,{x,avatar:'female'})).self;
    assert.equal(shown.id,actor.id);assert.equal(shown.name,actor.id===main.id?'謎のトレーナー カサイ':'サカイ');
    assert.equal(shown.isAdmin,true);assert.equal(shown.adminRole,actor.id===main.id?'main':'sub');
    assert.equal(shown.avatar,actor.id===main.id?'kasai':'sub-admin');
  }
  const seen=ok(await h.presence(visitor)).players;
  for(const actor of [main,sub]){
    const shown=seen.find(row=>row.id===actor.id);
    assert.equal(shown?.isAdmin,true);assert.equal(shown.adminRole,actor.id===main.id?'main':'sub');
    assert.equal(shown.avatar,actor.id===main.id?'kasai':'sub-admin');
  }
  for(const forged of [{adminRole:'sub'},{avatar:'sub-admin'}])assert.equal((await h.presence(visitor,forged)).status,400);
  ok(await h.revoke(main,sub));
  const after=ok(await h.presence(visitor)).players.find(row=>row.id===sub.id);
  assert.equal(after.isAdmin,false);assert.equal(after.adminRole,null);assert.equal(after.name,sub.name);assert.equal(after.avatar,'female');
  const formerRoom=ok(await h.call('/world/rooms/'+sub.id,visitor)).room;
  assert.equal(formerRoom.kind,'secret');assert.equal(formerRoom.name,'サブ運営のステージ');
  assert.equal(formerRoom.owner.adminRole,null);assert.equal(formerRoom.owner.isAdmin,false);
  assert.equal(ok(await h.call('/world/rooms/'+main.id,visitor)).room.kind,'kasai');
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_rooms').get().n,2);
});

test('secondary owned parties and signed mythical/trainer proofs have the same authority and revoke independently',async t=>{
  const h=setup(t),{main,sub}=await h.admins(),visitor=await h.register('証明確認');
  const profiles=new Map(),rosters=new Map(),proofs=new Map(),sessionId='7'.repeat(32);
  for(const actor of [main,sub]){
    const profile=ok(await h.call('/me',actor)),roster=ownedParty(actor,profile);
    profiles.set(actor.id,profile);rosters.set(actor.id,roster);
    const saved=ok(await h.call('/world/kasai/party',actor,'POST',{party:roster}));
    assert.equal(saved.playerId,actor.id);assert.deepEqual(saved.party.map(mon=>mon.grantId),roster.map(mon=>mon.grantId));
    const mythical=ok(await h.call('/duel-pass',actor,'POST',{sessionId,side:0,grantId:'admin-mythical:'+actor.id}));
    const trainer=ok(await h.call('/world/trainer-pass',actor,'POST',{sessionId,side:0}));
    proofs.set(actor.id,{mythical:mythical.pass,trainer:trainer.pass});
    assert.equal(ok(await h.call('/duel-pass/verify',null,'POST',{sessionId,side:0,pass:mythical.pass})).species,'floravelle');
    const identity=ok(await h.call('/world/trainer-pass/verify',visitor,'POST',{sessionId,side:0,pass:trainer.pass})).trainer;
    assert.equal(identity.id,actor.id);assert.equal(identity.isAdmin,true);
    assert.equal(identity.adminRole,actor.id===main.id?'main':'sub');
    assert.equal(identity.avatar,actor.id===main.id?'kasai':'sub-admin');
    assert.equal(identity.name,actor.id===main.id?'謎のトレーナー カサイ':'サカイ');
  }
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_parties').get().n,2);
  const stolen=copy(rosters.get(sub.id));stolen[2].grantId='admin-mythical:'+main.id;
  assert.equal((await h.call('/world/kasai/party',sub,'POST',{party:stolen})).error.code,'KASAI_PARTY_NOT_OWNED');
  assert.equal((await h.call('/duel-pass',sub,'POST',{sessionId,side:0,grantId:'admin-mythical:'+main.id})).status,403);
  ok(await h.revoke(main,sub));
  const former=ok(await h.call('/me',sub));
  assert.equal(former.player.isAdmin,false);assert.equal(former.player.adminRole,null);assert.deepEqual(former.initialCompanions,[]);
  assert.deepEqual(former.grants,profiles.get(sub.id).grants,'Delivered Futo gifts survive removal of admin authority');
  assert.equal((await h.call('/world/kasai/party',sub,'POST',{party:rosters.get(sub.id)})).status,403);
  assert.equal((await h.call('/duel-pass',sub,'POST',{sessionId,side:0,grantId:'admin-mythical:'+sub.id})).status,403);
  assert.equal((await h.call('/duel-pass/verify',null,'POST',{sessionId,side:0,pass:proofs.get(sub.id).mythical})).status,403);
  assert.equal(ok(await h.call('/duel-pass/verify',null,'POST',{sessionId,side:0,pass:proofs.get(main.id).mythical})).species,'floravelle');
  for(const actor of [main,sub]){
    const identity=ok(await h.call('/world/trainer-pass/verify',visitor,'POST',{sessionId,side:0,pass:proofs.get(actor.id).trainer})).trainer;
    assert.equal(identity.isAdmin,actor.id===main.id);assert.equal(identity.name,actor.id===main.id?'謎のトレーナー カサイ':sub.name);
    assert.equal(identity.adminRole,actor.id===main.id?'main':null);assert.equal(identity.avatar,actor.id===main.id?'kasai':'male');
  }
});

function orders(state,side){
  const team=state.teams[side],active=team.monsters[team.active[0]],engine=new LT.Engine();
  const moves=engine.moves(active).map((move,index)=>({move,index})).filter(({move})=>active.pp[move.id]>0&&move.kind==='attack');
  const result=moves.length?[{type:'move',slot:0,move:moves[0].index,target:0}]:[{type:'struggle',slot:0,target:0}];
  assert.equal(validateLiveOrders(state,side,result).ok,true);
  return result;
}

test('both administrators simultaneously host their own live rooms and the secondary controls its actual-party battle',async t=>{
  const h=setup(t),{main,sub,mainChallenger,subChallenger}=await h.participants();
  const [mainStart,subStart]=await Promise.all([h.start(mainChallenger,main),h.start(subChallenger,sub)]);
  const mainSession=ok(mainStart).session,subSession=ok(subStart).session;
  assert.notEqual(mainSession.id,subSession.id);
  for(const [actor,session] of [[main,mainSession],[sub,subSession]]){
    assert.equal(session.kasai.id,actor.id);assert.equal(session.roomId,actor.id);
    assert.equal(session.kasai.adminRole,actor.id===main.id?'main':'sub');
    assert.equal(session.kasai.avatar,actor.id===main.id?'kasai':'sub-admin');
    assert.equal(session.kasai.name,actor.id===main.id?'謎のトレーナー カサイ':'サカイ');
    assert.equal(session.challenger.adminRole,null);assert.equal(session.challenger.isAdmin,false);
    assert.equal(ok(await h.live(actor)).session.id,session.id);
    assert.equal(h.env.DB.sqlite.prepare('SELECT map_id FROM world_presence WHERE player_id=?').get(actor.id).map_id,'room:'+actor.id);
  }
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_live_members').get().n,4);
  assert.equal((await h.start(sub,main)).error.code,'KASAI_SELF_BATTLE');
  assert.equal((await h.live(main,subSession.id,'answer',{accept:true})).status,403);
  const roster=ownedParty(sub,ok(await h.call('/me',sub)));
  ok(await h.live(subChallenger,subSession.id,'arrive'));
  ok(await h.live(sub,subSession.id,'arrive',{party:roster}));
  ok(await h.presence(subChallenger,{map:'room:'+sub.id,x:12,y:5}));
  assert.equal(ok(await h.live(subChallenger,subSession.id,'talk')).session.state,'permission');
  const accepted=ok(await h.live(sub,subSession.id,'answer',{accept:true})).session;
  assert.equal(accepted.state,'battle');
  assert.deepEqual(accepted.battle.teams[1].monsters.map(mon=>mon.species),roster.map(mon=>mon.species));
  const first=ok(await h.live(subChallenger,subSession.id,'actions',{round:accepted.round,orders:orders(accepted.battle,0),requestId:crypto.randomUUID()}));
  assert.equal(first.session.round,accepted.round);assert.deepEqual(first.session.submitted,[true,false]);
  const resolved=ok(await h.live(sub,subSession.id,'actions',{round:accepted.round,orders:orders(accepted.battle,1),requestId:crypto.randomUUID()}));
  assert(resolved.session.round>accepted.round||resolved.session.state==='result');
  assert.equal(ok(await h.live(main,mainSession.id)).session.state,'staging');
  assert.equal(ok(await h.live(subChallenger,subSession.id,'leave')).session.state,'closed');
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_live_members').get().n,2);
  assert.equal(ok(await h.live(main,mainSession.id)).session.state,'staging');
  assert.deepEqual(h.env.DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('a secondary live invitation reaches its own talk deadline while a newer primary invitation remains open',async t=>{
  const h=setup(t),{main,sub,mainChallenger,subChallenger}=await h.participants();
  const secondary=ok(await h.start(subChallenger,sub)).session;
  for(let index=0;index<3;index++){
    h.advance(19000);
    assert.equal(ok(await h.live(subChallenger,secondary.id)).session.state,'staging');
    assert.equal(ok(await h.live(sub,secondary.id)).session.state,'staging');
  }
  ok(await h.presence(main,{x:22}));ok(await h.presence(mainChallenger,{x:21}));
  const primary=ok(await h.start(mainChallenger,main)).session;
  h.advance(3000);
  assert.equal(ok(await h.live(main,primary.id)).session.state,'staging');
  const expired=ok(await h.live(subChallenger,secondary.id)).session;
  assert.equal(expired.state,'closed');assert.equal(expired.reason,'talk-timeout');
  for(const actor of [sub,subChallenger])assert.equal(h.env.DB.sqlite.prepare('SELECT map_id FROM world_presence WHERE player_id=?').get(actor.id).map_id,'village');
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_live_members').get().n,2);
});

test('revoking the secondary closes only its live session and retains the primary session and room',async t=>{
  const h=setup(t),{main,sub,mainChallenger,subChallenger}=await h.participants();
  const primary=ok(await h.start(mainChallenger,main)).session,secondary=ok(await h.start(subChallenger,sub)).session;
  ok(await h.revoke(main,sub));
  assert.equal(ok(await h.live(main,primary.id)).session.state,'staging');
  const closed=ok(await h.live(subChallenger,secondary.id)).session;
  assert.equal(closed.state,'closed');assert.equal(closed.reason,'kasai-changed');
  assert.equal(ok(await h.call('/world/rooms/'+sub.id,subChallenger)).room.kind,'secret');
  assert.equal(ok(await h.call('/world/rooms/'+main.id,mainChallenger)).room.kind,'kasai');
  const members=h.env.DB.sqlite.prepare('SELECT player_id FROM kasai_live_members ORDER BY player_id').all().map(row=>row.player_id);
  assert.deepEqual(members,[main.id,mainChallenger.id].sort());
  for(const actor of [sub,subChallenger])assert.equal(h.env.DB.sqlite.prepare('SELECT map_id FROM world_presence WHERE player_id=?').get(actor.id).map_id,'village');
});

test('primary release promotes the secondary identity across player, world, room, live and existing trainer proofs',async t=>{
  const h=setup(t),{main,sub,mainChallenger:visitor,subChallenger:challenger}=await h.participants();
  const sessionId='8'.repeat(32),signed=ok(await h.call('/world/trainer-pass',sub,'POST',{sessionId,side:0}));
  const before=ok(await h.call('/world/trainer-pass/verify',visitor,'POST',{sessionId,side:0,pass:signed.pass})).trainer;
  assert.equal(before.adminRole,'sub');assert.equal(before.avatar,'sub-admin');assert.equal(before.name,'サカイ');
  const staged=ok(await h.start(challenger,sub)).session;
  assert.equal(staged.kasai.adminRole,'sub');assert.equal(staged.kasai.avatar,'sub-admin');
  const expectedRegistration=ok(await h.call('/admin/config',main)).adminRegistration;
  const released=ok(await h.call('/admin/release',main,'POST',{confirmed:true,expectedRegistration}));
  assert.equal(released.adminExists,true);assert.equal(released.player.isAdmin,false);assert.equal(released.player.adminRole,null);
  const promoted=ok(await h.call('/me',sub)).player;
  assert.equal(promoted.isAdmin,true);assert.equal(promoted.adminRole,'main');assert.equal(promoted.name,sub.name);
  assert.equal(promoted.displayName,'謎のトレーナー カサイ');
  const devices=ok(await h.call('/admin/devices',sub));
  assert.equal(devices.canManageDevices,true);assert.equal(devices.devices.length,1);
  assert.equal(devices.devices[0].playerId,sub.id);assert.equal(devices.devices[0].role,'main');
  const room=ok(await h.call('/world/rooms/'+sub.id,visitor)).room;
  assert.equal(room.id,sub.id);assert.equal(room.owner.adminRole,'main');
  assert.equal(room.owner.avatar,'kasai');assert.equal(room.owner.name,'謎のトレーナー カサイ');
  const current=ok(await h.live(sub,staged.id)).session;
  assert.equal(current.state,'staging');assert.equal(current.kasai.id,sub.id);
  assert.equal(current.kasai.adminRole,'main');assert.equal(current.kasai.avatar,'kasai');assert.equal(current.kasai.name,'謎のトレーナー カサイ');
  const shown=ok(await h.presence(sub,{map:'room:'+sub.id,x:12,y:4,avatar:'female'})).self;
  assert.equal(shown.adminRole,'main');assert.equal(shown.avatar,'kasai');assert.equal(shown.name,'謎のトレーナー カサイ');
  const verified=ok(await h.call('/world/trainer-pass/verify',visitor,'POST',{sessionId,side:0,pass:signed.pass})).trainer;
  assert.equal(verified.id,sub.id);assert.equal(verified.adminRole,'main');assert.equal(verified.avatar,'kasai');
  assert.equal(verified.name,'謎のトレーナー カサイ');
});

test('a queued party publication cannot overwrite a revoked and regranted administrator registration',{timeout:5000},async t=>{
  const h=setup(t),{main,sub}=await h.admins();
  const previous=ok(await h.call('/admin/devices',main)).devices.find(row=>row.playerId===sub.id);
  const originalPrepare=h.env.DB.prepare.bind(h.env.DB);
  let resume,started,held=false;
  const gate=new Promise(resolve=>{resume=resolve;}),atGate=new Promise(resolve=>{started=resolve;});
  h.env.DB.prepare=sql=>{
    const statement=originalPrepare(sql);
    if(sql.startsWith('INSERT INTO kasai_parties')&&!held){
      held=true;const first=statement.first.bind(statement);
      statement.first=async()=>{started();await gate;return first();};
    }
    return statement;
  };
  const pending=h.call('/world/kasai/party',sub,'POST',{party:party('komori',1)});
  await atGate;h.env.DB.prepare=originalPrepare;
  try{
    ok(await h.revoke(main,sub));
    ok(await h.call('/admin/devices',main,'POST',{playerId:sub.id,confirmed:true}));
    const next=ok(await h.call('/admin/devices',main)).devices.find(row=>row.playerId===sub.id);
    assert.notEqual(next.claimedAt,previous.claimedAt);
    ok(await h.call('/world/kasai/party',sub,'POST',{party:party('arvelion',70)}));
  }finally{resume();}
  const stale=await pending;
  assert.equal(stale.status,403);assert.equal(stale.error.code,'ADMIN_REQUIRED');
  const current=ok(await h.call('/world/kasai/party',sub));
  assert.deepEqual(current.party.map(mon=>mon.species),['arvelion']);
});

test('all three seats retain distinct authoritative identities and the third has full game entitlements until revoked',async t=>{
  const h=setup(t),{main,sub,third}=await h.threeAdmins(),visitor=await h.register('三席確認');
  const hosts=[main,sub,third],roles=['main','sub','sub-sub'],avatars=['kasai','sub-admin','sub-sub-admin'],names=['謎のトレーナー カサイ','サカイ','イサカ'];
  const devices=ok(await h.call('/admin/devices',main));
  assert.equal(devices.capacity,3);assert.deepEqual(devices.devices.map(row=>row.role),roles);
  assert.equal(ok(await h.call('/admin/devices',third)).canManageDevices,false);
  assert.equal((await h.revoke(sub,third)).error.code,'MAIN_ADMIN_REQUIRED');
  const configuration=ok(await h.call('/admin/config',third));
  const changed={...configuration.config,stats:{...configuration.config.stats,hp:configuration.config.stats.hp+1}};
  ok(await h.call('/admin/config',third,'PUT',{config:changed,expectedRevision:configuration.revision}));
  assert.deepEqual(ok(await h.call('/admin/config',main)).config,changed);
  const gift=ok(await h.call('/admin/grants',third,'POST',{requestId:crypto.randomUUID(),target:visitor.id}));
  assert.equal(gift.recipientCount,1);
  assert.equal(ok(await h.call('/me',visitor)).grants.length,1);
  const sessionId='9'.repeat(32),proofs=new Map(),rosters=new Map();
  for(const [index,actor] of hosts.entries()){
    const profile=ok(await h.call('/me',actor));
    assert.equal(profile.player.isAdmin,true);assert.equal(profile.player.adminRole,roles[index]);assert.equal(profile.player.name,actor.name);
    assert.equal(profile.player.displayName,names[index]);
    assert.deepEqual(profile.initialCompanions,[
      {grantId:'admin-legendary:'+actor.id,species:'arvelion',level:70},
      {grantId:'admin-mythical:'+actor.id,species:'floravelle',level:70}
    ]);
    const initial=profile.grants.filter(row=>row.grantId==='admin-initial:'+actor.id);
    assert.equal(initial.length,1);assert.deepEqual(initial[0].stats,changed.stats);
    const roster=ownedParty(actor,profile);rosters.set(actor.id,roster);
    assert.equal(ok(await h.call('/world/kasai/party',actor,'POST',{party:roster})).playerId,actor.id);
    assert.equal(ok(await h.call('/world/kasai/party',actor)).playerId,actor.id);
    const room=await h.createRoom(actor,['village','meadow','forest'][index]);
    assert.equal(room.kind,'kasai');assert.equal(room.owner.adminRole,roles[index]);assert.equal(room.owner.avatar,avatars[index]);
    assert.equal(room.owner.name,names[index]);
    assert.equal(room.name,['カサイ','サカイ','イサカ'][index]+'のひみつ部屋');
    assert.equal(ok(await h.call('/world/rooms/kasai',actor)).room.id,actor.id);
    const mythical=ok(await h.call('/duel-pass',actor,'POST',{sessionId,side:0,grantId:'admin-mythical:'+actor.id}));
    const trainer=ok(await h.call('/world/trainer-pass',actor,'POST',{sessionId,side:0}));
    proofs.set(actor.id,{mythical:mythical.pass,trainer:trainer.pass});
    assert.equal(ok(await h.call('/duel-pass/verify',null,'POST',{sessionId,side:0,pass:mythical.pass})).species,'floravelle');
    const verified=ok(await h.call('/world/trainer-pass/verify',visitor,'POST',{sessionId,side:0,pass:trainer.pass})).trainer;
    assert.equal(verified.adminRole,roles[index]);assert.equal(verified.avatar,avatars[index]);
    assert.equal(verified.name,names[index]);
  }
  const thirdRoom=ok(await h.call('/world/rooms/'+third.id,third)).room;
  const edited=ok(await h.call('/world/rooms/'+third.id,third,'PATCH',{revision:thirdRoom.revision,name:'第三運営のステージ',decorations:[{id:'third-plant',itemId:'plant',x:20,y:10,rotation:0}]})).room;
  assert.equal(edited.decorations.length,1);
  assert.deepEqual(ok(await h.call('/world/rooms?kind=kasai',visitor)).rooms.map(room=>room.id).sort(),hosts.map(actor=>actor.id).sort());
  for(const [index,actor] of hosts.entries())ok(await h.presence(actor,{x:22+index*2,avatar:'female'}));
  const seen=ok(await h.presence(visitor,{x:23})).players;
  for(const [index,actor] of hosts.entries()){
    const shown=seen.find(row=>row.id===actor.id);
    assert.equal(shown.adminRole,roles[index]);assert.equal(shown.avatar,avatars[index]);assert.equal(shown.isAdmin,true);
    assert.equal(shown.name,names[index]);
  }
  for(const forged of [{adminRole:'sub-sub'},{avatar:'sub-sub-admin'}])assert.equal((await h.presence(visitor,forged)).status,400);
  const stolen=copy(rosters.get(third.id));stolen[2].grantId='admin-mythical:'+sub.id;
  assert.equal((await h.call('/world/kasai/party',third,'POST',{party:stolen})).error.code,'KASAI_PARTY_NOT_OWNED');
  ok(await h.revoke(main,third));
  const former=ok(await h.call('/me',third));
  assert.equal(former.player.isAdmin,false);assert.equal(former.player.adminRole,null);assert.deepEqual(former.initialCompanions,[]);
  assert.equal(former.grants.filter(row=>row.grantId==='admin-initial:'+third.id).length,1);
  assert.equal((await h.call('/world/kasai/party',third,'POST',{party:rosters.get(third.id)})).status,403);
  assert.equal((await h.call('/duel-pass/verify',null,'POST',{sessionId,side:0,pass:proofs.get(third.id).mythical})).status,403);
  for(const actor of [main,sub])assert.equal(ok(await h.call('/duel-pass/verify',null,'POST',{sessionId,side:0,pass:proofs.get(actor.id).mythical})).species,'floravelle');
  const identity=ok(await h.call('/world/trainer-pass/verify',visitor,'POST',{sessionId,side:0,pass:proofs.get(third.id).trainer})).trainer;
  assert.equal(identity.adminRole,null);assert.equal(identity.avatar,'female');assert.equal(identity.name,third.name);
  assert.equal(ok(await h.call('/world/rooms/'+third.id,visitor)).room.kind,'secret');
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_parties').get().n,3);
});

test('active trades display current deputy names and restore registered names after revocation without changing the trade',async t=>{
  const h=setup(t),{main,sub,third}=await h.threeAdmins();
  const created=ok(await h.call('/trades',sub,'POST',{requestId:crypto.randomUUID()})).trade;
  assert.equal(created.host.name,'サカイ');
  const joined=ok(await h.call('/trades/join',third,'POST',{code:created.code})).trade;
  assert.equal(joined.host.name,'サカイ');assert.equal(joined.guest.name,'イサカ');
  const renamed=ok(await h.call('/me',third,'PATCH',{name:'第三の旅人'}));
  assert.equal(renamed.player.name,'第三の旅人');assert.equal(renamed.player.displayName,'イサカ');
  const stillAdmin=ok(await h.call('/trades/'+created.id,sub)).trade;
  assert.equal(stillAdmin.guest.name,'イサカ');
  ok(await h.revoke(main,third));
  const after=ok(await h.call('/trades/active',sub)).trade;
  assert.equal(after.id,created.id);assert.equal(after.state,'open');assert.equal(after.revision,joined.revision);
  assert.equal(after.host.name,'サカイ');assert.equal(after.guest.name,'第三の旅人');
  ok(await h.revoke(main,sub));
  const bothOrdinary=ok(await h.call('/trades/'+created.id,third)).trade;
  assert.equal(bothOrdinary.host.name,sub.name);assert.equal(bothOrdinary.guest.name,'第三の旅人');
  assert.equal(bothOrdinary.revision,joined.revision);
});

test('three administrators host independent live sessions and revoking the third leaves the other two running',async t=>{
  const h=setup(t),{main,sub,third,hosts,challengers}=await h.threeParticipants();
  const sessions=(await Promise.all(hosts.map((actor,index)=>h.start(challengers[index],actor)))).map(result=>ok(result).session);
  assert.equal(new Set(sessions.map(session=>session.id)).size,3);
  for(const [index,actor] of hosts.entries()){
    assert.equal(sessions[index].roomId,actor.id);assert.equal(sessions[index].kasai.id,actor.id);
    assert.equal(sessions[index].kasai.adminRole,['main','sub','sub-sub'][index]);
    assert.equal(sessions[index].kasai.avatar,['kasai','sub-admin','sub-sub-admin'][index]);
    assert.equal(sessions[index].kasai.name,['謎のトレーナー カサイ','サカイ','イサカ'][index]);
    assert.equal(ok(await h.live(actor)).session.id,sessions[index].id);
  }
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM kasai_live_members').get().n,6);
  assert.equal((await h.start(third,main)).error.code,'KASAI_SELF_BATTLE');
  const session=sessions[2],challenger=challengers[2],roster=ownedParty(third,ok(await h.call('/me',third)));
  ok(await h.live(challenger,session.id,'arrive'));ok(await h.live(third,session.id,'arrive',{party:roster}));
  ok(await h.presence(challenger,{map:'room:'+third.id,x:12,y:5}));
  assert.equal(ok(await h.live(challenger,session.id,'talk')).session.state,'permission');
  for(const actor of [main,sub])assert.equal((await h.live(actor,session.id,'answer',{accept:true})).status,403);
  const battle=ok(await h.live(third,session.id,'answer',{accept:true})).session;
  assert.equal(battle.state,'battle');assert.deepEqual(battle.battle.teams[1].monsters.map(mon=>mon.species),roster.map(mon=>mon.species));
  assert.equal(battle.battle.teams[1].name,'イサカ');
  ok(await h.live(challenger,session.id,'actions',{round:battle.round,orders:orders(battle.battle,0),requestId:crypto.randomUUID()}));
  const resolved=ok(await h.live(third,session.id,'actions',{round:battle.round,orders:orders(battle.battle,1),requestId:crypto.randomUUID()})).session;
  assert(resolved.round>battle.round||resolved.state==='result');
  ok(await h.revoke(main,third));
  for(const index of [0,1])assert.equal(ok(await h.live(hosts[index],sessions[index].id)).session.state,'staging');
  const closed=ok(await h.live(challenger,session.id)).session;
  assert.equal(closed.state,'closed');assert.equal(closed.reason,'kasai-changed');
  const members=h.env.DB.sqlite.prepare('SELECT player_id FROM kasai_live_members ORDER BY player_id').all().map(row=>row.player_id);
  assert.deepEqual(members,[main.id,sub.id,challengers[0].id,challengers[1].id].sort());
  for(const actor of [third,challenger])assert.equal(h.env.DB.sqlite.prepare('SELECT map_id FROM world_presence WHERE player_id=?').get(actor.id).map_id,'village');
  assert.deepEqual(h.env.DB.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('primary release prefers the secondary seat and preserves the third registration and identity unchanged',async t=>{
  const h=setup(t),{main,sub,third}=await h.threeAdmins(),visitor=await h.register('引継確認');
  await h.createRoom(third,'forest');
  const before=ok(await h.call('/admin/devices',main)).devices.find(row=>row.playerId===third.id);
  const sessionId='a'.repeat(32),signed=ok(await h.call('/world/trainer-pass',third,'POST',{sessionId,side:0}));
  const expectedRegistration=ok(await h.call('/admin/config',main)).adminRegistration;
  assert.equal(ok(await h.call('/admin/release',main,'POST',{confirmed:true,expectedRegistration})).adminExists,true);
  const after=ok(await h.call('/admin/devices',sub));
  assert.equal(after.canManageDevices,true);assert.equal(after.capacity,3);
  assert.deepEqual(after.devices.map(row=>({id:row.playerId,role:row.role})),[{id:sub.id,role:'main'},{id:third.id,role:'sub-sub'}]);
  assert.equal(after.devices.find(row=>row.playerId===third.id).claimedAt,before.claimedAt);
  assert.equal(ok(await h.call('/admin/devices',third)).canManageDevices,false);
  assert.equal(ok(await h.call('/me',third)).player.adminRole,'sub-sub');
  const room=ok(await h.call('/world/rooms/'+third.id,visitor)).room;
  assert.equal(room.owner.adminRole,'sub-sub');assert.equal(room.owner.avatar,'sub-sub-admin');assert.equal(room.owner.name,'イサカ');
  const verified=ok(await h.call('/world/trainer-pass/verify',visitor,'POST',{sessionId,side:0,pass:signed.pass})).trainer;
  assert.equal(verified.adminRole,'sub-sub');assert.equal(verified.avatar,'sub-sub-admin');assert.equal(verified.name,'イサカ');
});

test('primary release without a secondary promotes the third seat and retains its active room, battle invitation and proof',async t=>{
  const h=setup(t),{main,sub,third}=await h.threeAdmins(),challenger=await h.register('第三引継');
  ok(await h.revoke(main,sub));await h.createRoom(third,'forest');
  const before=ok(await h.call('/admin/devices',main)).devices.find(row=>row.playerId===third.id);
  const sessionId='b'.repeat(32),signed=ok(await h.call('/world/trainer-pass',third,'POST',{sessionId,side:0}));
  ok(await h.presence(third,{x:22}));ok(await h.presence(challenger,{x:21}));
  const staged=ok(await h.start(challenger,third)).session;
  assert.equal(staged.kasai.adminRole,'sub-sub');
  const expectedRegistration=ok(await h.call('/admin/config',main)).adminRegistration;
  const released=ok(await h.call('/admin/release',main,'POST',{confirmed:true,expectedRegistration}));
  assert.equal(released.adminExists,true);assert.equal(released.player.adminRole,null);
  const devices=ok(await h.call('/admin/devices',third));
  assert.equal(devices.canManageDevices,true);assert.equal(devices.devices.length,1);
  assert.equal(devices.devices[0].playerId,third.id);assert.equal(devices.devices[0].role,'main');
  assert.notEqual(devices.devices[0].claimedAt,before.claimedAt);
  assert.equal(ok(await h.call('/me',third)).player.adminRole,'main');
  const room=ok(await h.call('/world/rooms/'+third.id,challenger)).room;
  assert.equal(room.owner.adminRole,'main');assert.equal(room.owner.avatar,'kasai');
  const current=ok(await h.live(third,staged.id)).session;
  assert.equal(current.state,'staging');assert.equal(current.kasai.id,third.id);
  assert.equal(current.kasai.adminRole,'main');assert.equal(current.kasai.avatar,'kasai');assert.equal(current.kasai.name,'謎のトレーナー カサイ');
  const verified=ok(await h.call('/world/trainer-pass/verify',challenger,'POST',{sessionId,side:0,pass:signed.pass})).trainer;
  assert.equal(verified.adminRole,'main');assert.equal(verified.avatar,'kasai');assert.equal(verified.name,'謎のトレーナー カサイ');
});
