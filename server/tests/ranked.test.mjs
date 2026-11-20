import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker,{worldRoomWalls,DEFAULT_CONFIG} from '../server.mjs';
import {createReplayRuntime} from '../kasai-replay.mjs';
import {RANKED_RULES_VERSION,normalizeRankedTeam,validateRankedOrders,rankedPreviewMember} from '../ranked-engine.mjs';
import {RANKED_QUEUE_TTL,RANKED_HEARTBEAT_TTL,RANKED_ROUND_TTL,rankedRatingResult} from '../ranked-service.mjs';

const SECRET='ranked-local-test-admin-claim-key',SIGNING='ranked-local-test-signing-key-over-thirty-two-characters';
const MIGRATIONS=readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
const LT=createReplayRuntime(),engine=new LT.Engine(),copy=value=>JSON.parse(JSON.stringify(value));
class LocalD1 {
  constructor({ranked=true}={}){
    this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');
    for(const file of MIGRATIONS)if(ranked||file!=='0010_ranked.sql')this.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
    this.beforeBatch=null;this.afterFirst=null;
  }
  prepare(sql){const db=this;return {sql,values:[],bind(...values){this.values=values;return this;},execute(){return {results:db.sqlite.prepare(sql).all(...this.values).map(row=>({...row})),success:true,meta:{changes:db.sqlite.prepare('SELECT changes() AS n').get().n}};},async first(){const result=this.execute().results[0]||null;if(db.afterFirst)await db.afterFirst(this,result);return result;},async all(){return this.execute();},async run(){return this.execute();}};}
  async batch(statements){
    if(this.beforeBatch)await this.beforeBatch(statements);
    this.sqlite.exec('BEGIN IMMEDIATE');try{const result=statements.map(statement=>statement.execute());this.sqlite.exec('COMMIT');return result;}catch(error){this.sqlite.exec('ROLLBACK');throw error;}
  }
}
const ok=response=>{assert.equal(response.status,200,JSON.stringify(response));return response;};
function team(species=['komori','shizuku','hibana'],level=70){return copy(species.map(id=>engine.makeMonster(id,level)));}
function choose(state,side){
  const roster=state.teams[side],active=roster.monsters[roster.active[0]];
  if(state.phase==='replacement')return active.hp>0?[]:[{type:'switch',slot:0,index:roster.monsters.findIndex((mon,index)=>mon.hp>0&&!roster.active.includes(index))}];
  const moves=engine.moves(active).map((move,index)=>({move,index})).filter(({move})=>active.pp[move.id]>0).sort((a,b)=>(b.move.kind==='attack'?b.move.power:0)-(a.move.kind==='attack'?a.move.power:0));
  const orders=moves.length?[{type:'move',slot:0,move:moves[0].index,target:0}]:[{type:'struggle',slot:0,target:0}];
  assert.equal(validateRankedOrders(state,side,orders).ok,true);return orders;
}
function setup(t,{ranked=true}={}){
  let now=Date.now(),ip=0;t.mock.method(Date,'now',()=>now);
  const env={DB:new LocalD1({ranked}),ADMIN_CLAIM_KEY:SECRET,DUEL_SIGNING_KEY:SIGNING};t.after(()=>env.DB.sqlite.close());
  const advance=milliseconds=>now+=milliseconds;
  const call=async(path,actor,method='GET',body)=>{
    const response=await worker.fetch(new Request('https://ranked.example/api'+path,{method,headers:{'Content-Type':'application/json',Origin:'https://uni-tadayasu.github.io','CF-Connecting-IP':'192.0.2.'+(++ip),...(actor?{Authorization:'Bearer '+actor.token}:{})},body:body===undefined?undefined:JSON.stringify(body)}),env);
    const data=await response.json();assert(!JSON.stringify(data).includes(SECRET));assert(!JSON.stringify(data).includes(SIGNING));return {status:response.status,...data};
  };
  const register=async(name='旅人')=>{const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),result=ok(await call('/register',null,'POST',{name,token}));return {token,...result.player};};
  const queue=(actor,roster=team(),requestId=crypto.randomUUID())=>call('/world/ranked/queue',actor,'POST',{requestId,team:roster});
  const cancel=(actor,requestId)=>call('/world/ranked/queue',actor,'DELETE',{requestId});
  const status=actor=>call('/world/ranked',actor);
  const match=(actor,id,action,body={})=>call('/world/ranked/matches/'+id+'/'+action,actor,'POST',body);
  const pair=async(a,b,roster0=team(),roster1=team())=>{ok(await queue(a,roster0));advance(1);const result=ok(await queue(b,roster1));assert.equal(result.match.state,'battle');assert.equal(result.match.players[0].id,a.id);return ok(await status(a)).match;};
  const operators=async()=>{
    const main=await register('あおい'),sub=await register('ひなた'),third=await register('こはる');ok(await call('/admin/claim',main,'POST',{key:SECRET}));
    ok(await call('/admin/devices',main,'POST',{playerId:sub.id,role:'sub',confirmed:true}));ok(await call('/admin/devices',main,'POST',{playerId:third.id,role:'sub-sub',confirmed:true}));return {main,sub,third};
  };
  const presence=async(actor,position={})=>{advance(300);return call('/world/presence',actor,'POST',{map:'village',x:21,y:17,facing:'up',avatar:'male',status:'idle',...position});};
  const liveReady=async()=>{
    const main=await register('運営の本名'),challenger=await register('挑戦者');ok(await call('/admin/claim',main,'POST',{key:SECRET}));
    const wall=worldRoomWalls('village')[0],facing=wall.facings[0],[dx,dy]={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]}[facing];
    ok(await presence(main,{x:wall.x-dx,y:wall.y-dy,facing}));ok(await call('/world/rooms',main,'POST',{map:'village',x:wall.x,y:wall.y,facing}));
    ok(await presence(main,{x:22,facing:'left'}));ok(await presence(challenger));return {main,challenger};
  };
  const startLive=(actor,main)=>call('/world/kasai/live',actor,'POST',{requestId:crypto.randomUUID(),roomId:main.id,party:team(),storageCount:0});
  return {env,advance,call,register,queue,cancel,status,match,pair,operators,presence,liveReady,startLive};
}
async function finish(h,a,b,current){
  for(let step=0;step<160&&current.state==='battle';step++){
    h.advance(500);
    const round=current.round,commands=[0,1].map(side=>({round,orders:choose(current.battle,side),requestId:crypto.randomUUID()}));
    let result=ok(await h.match(a,current.id,'actions',commands[0]));
    if(result.match.state==='battle'&&result.match.round===round)result=ok(await h.match(b,current.id,'actions',commands[1]));
    current=result.match;
  }
  assert.equal(current.state,'result');return current;
}

test('ranked endpoints require a verified identity and reject forged result/identity/stat envelopes',async t=>{
  const h=setup(t),a=await h.register(),id=crypto.randomUUID();
  for(const [path,method,body] of [['/world/ranked','GET'],['/world/ranked/history','GET'],['/world/ranked/leaderboard','GET'],['/world/ranked/queue','POST',{requestId:id,team:team()}],['/world/ranked/queue','DELETE',{requestId:id}],['/world/ranked/matches/'+id+'/forfeit','POST',{}]])assert.equal((await h.call(path,null,method,body)).status,401);
  for(const extra of [{playerId:a.id},{rating:9999},{winner:0},{stats:{}},{items:[]},{adminRole:'main'}])assert.equal((await h.call('/world/ranked/queue',a,'POST',{requestId:id,team:team(),...extra})).error.code,'INVALID_RANKED_REQUEST');
  for(const bad of ['',null,'00000000-0000-0000-0000-000000000001','00000000-0000-6000-8000-000000000001','00000000-0000-4000-7000-000000000001'])assert.equal((await h.queue(a,team(),bad)).error.code,'INVALID_RANKED_REQUEST_ID');
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM ranked_queue').get().n,0);
  const status=ok(await h.status(a));assert.equal(status.profile.rating,1000);assert.equal(status.profile.tier.id,'bronze');assert.equal(status.rulesVersion,RANKED_RULES_VERSION);assert.equal(status.queue,null);assert.equal(status.match,null);
  assert.equal((await h.call('/world/ranked',a,'PUT',{})).status,405);
});

test('owned enrollment validates original records, saves no battle changes, and normalizes Lv50 with training/equipment/moves intact',async t=>{
  const h=setup(t),a=await h.register('草原の人'),b=await h.register('港の人'),roster=team();
  Object.assign(roster[0],{nickname:'こも',shiny:true,alloc:{hp:20,atk:16,def:0,spAtk:0,spDef:0,speed:5},heldItem:'powerband',moveOrder:[2,0,3,1],hp:0});
  roster[0].pp[Object.keys(roster[0].pp)[0]]=0;const original=copy(roster);
  ok(await h.presence(a,{map:'meadow'}));ok(await h.presence(b,{map:'harbor'}));
  const match=await h.pair(a,b,roster,team(undefined,1));
  assert.deepEqual(roster,original);assert.equal(match.side,0);assert.equal(match.state,'battle');assert.equal(match.players[0].name,'草原の人');assert.equal(match.players[1].name,'港の人');
  const mon=match.battle.teams[0].monsters[0],expected=rankedPreviewMember(original[0]);
  assert.equal(mon.level,50);assert.equal(mon.sourceLevel,70);assert.deepEqual(mon.stats,expected.stats);assert.equal(mon.hp,mon.maxHp);assert.equal(mon.nickname,'こも');assert.equal(mon.shiny,true);assert.equal(mon.item,'powerband');assert.deepEqual(mon.alloc,normalizeRankedTeam(original)[0].alloc);assert.deepEqual(mon.moveOrder,[2,0,3,1]);assert(Object.values(mon.pp).every(pp=>pp>0));
  assert(match.battle.teams[1].monsters.every(member=>member.level===50&&member.sourceLevel===1));
  const saved=JSON.parse(h.env.DB.sqlite.prepare('SELECT team_json FROM ranked_queue WHERE player_id=?').get(a.id).team_json);assert.equal(saved[0].level,70);assert.equal(saved[0].pp[Object.keys(original[0].pp)[0]],0);assert.equal(saved[0].hp,1,'Only the enrollment validator heals a fainted saved member to its minimum valid HP');
  assert.equal(h.env.DB.sqlite.prepare('SELECT map_id FROM world_presence WHERE player_id=?').get(a.id).map_id,'meadow');
  const enrolled=new LT.Engine().makeMonster('lunaxion',50),c=await h.register();
  assert.equal(ok(await h.queue(c,[enrolled,...team().slice(1)])).queue.team[0].species,'lunaxion','Hidden owned species are not categorically excluded');
});

test('team validation rejects duplicates, illegal saved fields and inflated original allocations before acquiring locks',async t=>{
  const h=setup(t),a=await h.register(),base=team();
  for(const invalid of [[],base.slice(0,2),base.map(mon=>mon.species),[base[0],base[0],base[2]],base.map((mon,index)=>index===1?{...mon,species:base[0].species,pp:base[0].pp}:mon),base.map((mon,index)=>index===0?{...mon,stats:{hp:99999}}:mon),base.map((mon,index)=>index===0?{...mon,alloc:{hp:999}}:mon),base.map((mon,index)=>index===0?{...mon,level:101}:mon)]){
    const result=await h.queue(a,invalid);assert.equal(result.status,400,JSON.stringify(result));assert.equal(result.error.code,'INVALID_RANKED_TEAM');
  }
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM ranked_members').get().n,0);
});

test('queue requests are stable, cancellation wins before delayed enqueue, and old intents cannot cancel newer queues',async t=>{
  const h=setup(t),a=await h.register(),roster=team(),requestId=crypto.randomUUID();
  const first=ok(await h.queue(a,roster,requestId));assert.equal(first.intent.state,'waiting');
  const again=ok(await h.queue(a,copy(roster),requestId.toUpperCase()));assert.equal(again.queue.id,first.queue.id);
  const changed=copy(roster);changed[0].nickname='かわり';assert.equal((await h.queue(a,changed,requestId)).error.code,'RANKED_REQUEST_REUSED');
  assert.equal((await h.queue(a)).error.code,'RANKED_BUSY');
  ok(await h.cancel(a,requestId));const replay=ok(await h.queue(a,roster,requestId));assert.equal(replay.intent.state,'cancelled');assert.equal(replay.queue,null);
  const delayed=crypto.randomUUID();assert.equal(ok(await h.cancel(a,delayed)).intent.state,'cancelled');assert.equal(ok(await h.queue(a,roster,delayed)).queue,null);
  const newer=ok(await h.queue(a,roster));assert(newer.queue);assert.equal(ok(await h.cancel(a,requestId)).queue.id,newer.queue.id);
  assert.equal(h.env.DB.sqlite.prepare("SELECT COUNT(*) AS n FROM ranked_queue WHERE state='waiting'").get().n,1);
});

test('queue heartbeat extends active waiting, expires offline queues and never resurrects expired request IDs',async t=>{
  const h=setup(t),a=await h.register(),b=await h.register(),roster=team(),requestId=crypto.randomUUID(),first=ok(await h.queue(a,roster,requestId));
  h.advance(RANKED_QUEUE_TTL-1);const alive=ok(await h.status(a));assert(alive.queue.expiresAt>first.queue.expiresAt);
  h.advance(RANKED_QUEUE_TTL);const expired=ok(await h.status(a));assert.equal(expired.queue,null);
  const retry=ok(await h.queue(a,roster,requestId));assert.equal(retry.intent.state,'expired');assert.equal(retry.queue,null);
  assert(ok(await h.queue(b)).queue);assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM ranked_matches').get().n,0);
});

test('concurrent matching creates one battle per player and starts immediately without acceptance',async t=>{
  const h=setup(t),actors=await Promise.all(['甲','乙','丙','丁'].map(name=>h.register(name)));
  const responses=await Promise.all(actors.map(actor=>h.queue(actor)));for(const response of responses)ok(response);
  const states=await Promise.all(actors.map(actor=>h.status(actor)));states.forEach(ok);
  assert(states.every(state=>state.match?.state==='battle'&&!state.queue));assert.equal(new Set(states.map(state=>state.match.id)).size,2);
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM ranked_matches').get().n,2);assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM ranked_members WHERE match_id IS NOT NULL').get().n,4);
  for(const state of states){assert.deepEqual(state.match.submitted,[false,false]);assert.equal(state.match.round,1);assert.equal(state.match.result,null);assert.equal(state.match.deadlineAt-state.match.createdAt,RANKED_ROUND_TTL);}
});

test('cancel/match race cannot orphan a match or revive a canceled queue, and matching win returns battle',async t=>{
  const h=setup(t),a=await h.register(),b=await h.register(),roster=team(),requestId=crypto.randomUUID();ok(await h.queue(a,roster,requestId));
  let canceled=false;
  h.env.DB.beforeBatch=async statements=>{if(!canceled&&statements.some(statement=>statement.sql.includes('INSERT OR IGNORE INTO ranked_matches'))){canceled=true;h.env.DB.beforeBatch=null;ok(await h.cancel(a,requestId));}};
  const joined=ok(await h.queue(b));assert(canceled);assert.equal(joined.match,null);assert(joined.queue);assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM ranked_matches').get().n,0);assert.equal(ok(await h.queue(a,roster,requestId)).intent.state,'cancelled');
  const next=ok(await h.queue(a,roster)),matched=next.match;assert.equal(matched.state,'battle');
  const after=ok(await h.cancel(a,next.intent.requestId));assert.equal(after.intent.state,'matched');assert.equal(after.match.id,matched.id);assert.equal(after.match.state,'battle');
});

test('status never reports idle when pairing commits between the membership snapshot and response',async t=>{
  const h=setup(t),a=await h.register(),b=await h.register();ok(await h.queue(a));let interleaved=false;
  h.env.DB.afterFirst=async(statement,row)=>{
    if(statement.sql.includes('FROM ranked_members m LEFT JOIN ranked_queue')&&row?.queue_id){
      interleaved=true;h.env.DB.afterFirst=null;assert.equal(ok(await h.queue(b)).match.state,'battle');
    }
  };
  const pending=ok(await h.status(a));assert(interleaved);assert(pending.queue||pending.match,'A concurrent match must not look idle');assert.equal(ok(await h.status(a)).match.state,'battle');
});

test('matching prefers eligible nearby ratings, widens after waiting, and eventually admits any difference',async t=>{
  const h=setup(t),a=await h.register('1000'),b=await h.register('1500'),c=await h.register('1050');
  for(const actor of [a,b,c])ok(await h.status(actor));
  h.env.DB.sqlite.prepare('UPDATE ranked_profiles SET rating=1500 WHERE player_id=?').run(b.id);h.env.DB.sqlite.prepare('UPDATE ranked_profiles SET rating=1050 WHERE player_id=?').run(c.id);
  assert(ok(await h.queue(a)).queue);assert(ok(await h.queue(b)).queue);const close=ok(await h.queue(c));assert.equal(close.match.players.some(player=>player.id===a.id),true);assert.equal(ok(await h.status(b)).match,null);
  const farId=ok(await h.status(b)).queue.requestId;ok(await h.cancel(b,farId));
  const d=await h.register('2000'),e=await h.register('2300');for(const actor of [d,e])ok(await h.status(actor));
  h.env.DB.sqlite.prepare('UPDATE ranked_profiles SET rating=2000 WHERE player_id=?').run(d.id);h.env.DB.sqlite.prepare('UPDATE ranked_profiles SET rating=2300 WHERE player_id=?').run(e.id);
  assert(ok(await h.queue(d)).queue);assert(ok(await h.queue(e)).queue);h.advance(15000);assert(ok(await h.status(d)).queue);assert(ok(await h.status(e)).queue);h.advance(15000);assert.equal(ok(await h.status(d)).match.state,'battle');
  const f=await h.register('ゼロ'),g=await h.register('高レート');for(const actor of [f,g])ok(await h.status(actor));
  h.env.DB.sqlite.prepare('UPDATE ranked_profiles SET rating=0 WHERE player_id=?').run(f.id);h.env.DB.sqlite.prepare('UPDATE ranked_profiles SET rating=5000 WHERE player_id=?').run(g.id);
  assert(ok(await h.queue(f)).queue);assert(ok(await h.queue(g)).queue);
  for(let i=0;i<2;i++){h.advance(30000);assert(ok(await h.status(f)).queue);assert(ok(await h.status(g)).queue);}
  h.advance(30000);assert.equal(ok(await h.status(f)).match.state,'battle');
});

test('authoritative commands are private, simultaneous actions resolve once, and request retries cannot change a move',async t=>{
  const h=setup(t),a=await h.register(),b=await h.register(),c=await h.register(),current=await h.pair(a,b);
  assert.equal((await h.match(c,current.id,'forfeit')).status,403);
  const requestId=crypto.randomUUID(),orders=choose(current.battle,0),body={round:current.round,orders,requestId};
  const first=ok(await h.match(a,current.id,'actions',body));assert.deepEqual(first.match.submitted,[true,false]);assert(first.match.revision>current.revision);
  const opponent=ok(await h.status(b));assert.equal('orders'in opponent.match,false);assert.equal('orders_json'in opponent.match,false);assert.deepEqual(opponent.match.battle,current.battle);
  const duplicate=ok(await h.match(a,current.id,'actions',body));assert.equal(duplicate.match.revision,first.match.revision);
  assert.equal((await h.match(a,current.id,'actions',{...body,orders:[{type:'switch',slot:0,index:1}]})).error.code,'RANKED_ACTION_REUSED');
  assert.equal((await h.match(a,current.id,'actions',{...body,requestId:crypto.randomUUID()})).error.code,'RANKED_ACTION_LOCKED');
  const second={round:current.round,orders:choose(current.battle,1),requestId:crypto.randomUUID()};
  const responses=await Promise.all([h.match(b,current.id,'actions',second),h.match(b,current.id,'actions',second),h.status(a)]);responses.forEach(ok);
  const latest=ok(await h.status(a));assert.equal(latest.match.round,current.round+1);assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM ranked_orders WHERE match_id=? AND round=1').get(current.id).n,2);
  ok(await h.match(a,current.id,'actions',body));assert.equal(ok(await h.status(a)).match.round,latest.match.round);
  assert.equal((await h.match(a,current.id,'actions',{round:1,orders,requestId:crypto.randomUUID()})).error.code,'RANKED_ROUND_CHANGED');
  assert.equal((await h.match(a,current.id,'actions',{round:latest.match.round,orders:[{type:'item',slot:0,item:'tonic'}],requestId:crypto.randomUUID()})).error.code,'INVALID_RANKED_ACTION');
});

test('natural full battles settle one rating result and preserve replay snapshots through individual acknowledgements',async t=>{
  const h=setup(t),a=await h.register('甲'),b=await h.register('乙'),current=await h.pair(a,b),result=await finish(h,a,b,current);
  assert.equal(result.reason,undefined);assert.equal(result.result.reason,'battle');assert.equal(result.battle.winner,result.result.winner);
  const profiles=h.env.DB.sqlite.prepare('SELECT * FROM ranked_profiles ORDER BY player_id').all();assert(profiles.every(profile=>profile.games===1));assert.equal(profiles.reduce((sum,profile)=>sum+profile.rating,0),2000);
  const serialized=JSON.stringify(profiles);
  await Promise.all([h.status(a),h.status(b),h.match(a,current.id,'forfeit'),h.match(b,current.id,'forfeit')]);assert.equal(JSON.stringify(h.env.DB.sqlite.prepare('SELECT * FROM ranked_profiles ORDER BY player_id').all()),serialized);
  const history=ok(await h.call('/world/ranked/history',a));assert.equal(history.history.length,1);assert.equal(history.history[0].id,current.id);assert.equal(history.history[0].opponent.name,'乙');
  const ack=ok(await h.match(a,current.id,'ack'));assert.equal(ack.match,null);assert.equal(ok(await h.status(b)).match.id,current.id);assert.equal(ok(await h.match(a,current.id,'ack')).match,null);
  assert(ok(await h.queue(a)).queue);assert.equal((await h.queue(b)).error.code,'RANKED_BUSY');ok(await h.match(b,current.id,'ack'));
  const leaderboard=ok(await h.call('/world/ranked/leaderboard',a));assert.equal(leaderboard.players.length,2);assert.deepEqual(leaderboard.players.map(profile=>profile.rank),[1,2]);assert(leaderboard.players[0].rating>=leaderboard.players[1].rating);
});

test('simultaneous forfeits settle both profiles once and stamp the terminal battle winner',async t=>{
  const h=setup(t),a=await h.register(),b=await h.register(),current=await h.pair(a,b);
  const results=await Promise.all([h.match(a,current.id,'forfeit'),h.match(b,current.id,'forfeit'),h.match(a,current.id,'forfeit')]);results.forEach(ok);
  const final=ok(await h.status(a));assert.equal(final.match.state,'result');assert.equal(final.match.result.reason,'forfeit');assert.equal(final.match.battle.winner,final.match.result.winner);assert.equal(final.match.battle.reason,'forfeit');
  const profiles=h.env.DB.sqlite.prepare('SELECT rating,games,wins,losses,draws FROM ranked_profiles').all();assert(profiles.every(profile=>profile.games===1));assert.deepEqual(profiles.map(profile=>profile.rating).sort((a,b)=>a-b),[984,1016]);assert.equal(profiles.reduce((sum,p)=>sum+p.wins,0),1);assert.equal(profiles.reduce((sum,p)=>sum+p.losses,0),1);
});

test('a genuine turn-limit draw updates both draw counters exactly once without changing equal ratings',async t=>{
  const h=setup(t),a=await h.register(),b=await h.register(),current=await h.pair(a,b),battle=copy(current.battle);battle.turn=100;battle.round=100;
  h.env.DB.sqlite.prepare('UPDATE ranked_matches SET battle_json=?,round=100 WHERE id=?').run(JSON.stringify(battle),current.id);
  const results=await Promise.all([a,b].map(actor=>h.match(actor,current.id,'actions',{round:100,orders:[{type:'switch',slot:0,index:1}],requestId:crypto.randomUUID()})));results.forEach(ok);
  const final=ok(await h.status(a));assert.equal(final.match.result.winner,'draw');assert.equal(final.match.result.outcome,'draw');assert.equal(final.match.result.reason,'battle');assert.equal(final.match.battle.reason,'turn-limit');
  const profiles=h.env.DB.sqlite.prepare('SELECT rating,games,wins,losses,draws FROM ranked_profiles').all();for(const profile of profiles)assert.deepEqual({...profile},{rating:1000,games:1,wins:0,losses:0,draws:1});
});

test('rating settlement rolls back entirely if either profile update fails, then succeeds once on retry',async t=>{
  const h=setup(t),a=await h.register(),b=await h.register(),current=await h.pair(a,b);
  h.env.DB.sqlite.exec("CREATE TRIGGER reject_ranked_rating BEFORE UPDATE ON ranked_profiles BEGIN SELECT RAISE(ABORT,'injected profile write failure'); END");
  assert.equal((await h.match(a,current.id,'forfeit')).status,500);assert.equal(h.env.DB.sqlite.prepare('SELECT state FROM ranked_matches WHERE id=?').get(current.id).state,'battle');assert(h.env.DB.sqlite.prepare('SELECT games FROM ranked_profiles').all().every(row=>row.games===0));
  h.env.DB.sqlite.exec('DROP TRIGGER reject_ranked_rating');assert.equal(ok(await h.match(a,current.id,'forfeit')).match.result.reason,'forfeit');assert(h.env.DB.sqlite.prepare('SELECT games FROM ranked_profiles').all().every(row=>row.games===1));
});

test('a concurrent timely heartbeat invalidates a previously read disconnect decision',async t=>{
  const h=setup(t),a=await h.register(),b=await h.register(),current=await h.pair(a,b);h.advance(30000);ok(await h.status(a));h.advance(30001);let refreshed=false;
  h.env.DB.beforeBatch=async statements=>{
    if(statements.some(statement=>statement.sql.includes("SET state='result'")&&statement.values.includes('disconnect'))){
      refreshed=true;h.env.DB.beforeBatch=null;h.env.DB.sqlite.prepare('UPDATE ranked_matches SET seen1_at=? WHERE id=?').run(Date.now()-1,current.id);
    }
  };
  const result=ok(await h.status(a));assert(refreshed);assert.equal(result.match.state,'battle');assert.equal(result.profile.games,0);assert.equal(ok(await h.status(b)).match.state,'battle');
});

test('late reconnect forfeits before heartbeat refresh while both disconnected players receive an unrated void',async t=>{
  const h=setup(t),a=await h.register(),b=await h.register(),current=await h.pair(a,b);
  h.advance(30000);ok(await h.status(a));h.advance(30001);const late=ok(await h.status(b));
  assert.equal(late.match.result.outcome,'loss');assert.equal(late.match.result.reason,'disconnect');assert.equal(late.match.result.winner,0);assert.equal(late.match.battle.winner,0);
  ok(await h.match(a,current.id,'ack'));ok(await h.match(b,current.id,'ack'));const next=await h.pair(a,b),before=copy(h.env.DB.sqlite.prepare('SELECT rating,games FROM ranked_profiles ORDER BY player_id').all());
  h.advance(RANKED_HEARTBEAT_TTL);const both=ok(await h.status(a));assert.equal(both.match.id,next.id);assert.equal(both.match.result.outcome,'void');assert.equal(both.match.result.reason,'double_disconnect');assert.deepEqual(both.match.result.ratingDelta,[0,0]);assert.equal(both.match.battle.winner,null);assert.deepEqual(copy(h.env.DB.sqlite.prepare('SELECT rating,games FROM ranked_profiles ORDER BY player_id').all()),before);
});

test('round deadlines forfeit a missing command and void a turn where neither player acts',async t=>{
  const h=setup(t),a=await h.register(),b=await h.register(),current=await h.pair(a,b);
  ok(await h.match(a,current.id,'actions',{round:1,orders:choose(current.battle,0),requestId:crypto.randomUUID()}));
  for(let i=0;i<2;i++){h.advance(30000);ok(await h.status(a));ok(await h.status(b));}
  h.advance(30000);const timeout=ok(await h.status(b));assert.equal(timeout.match.result.reason,'turn_timeout');assert.equal(timeout.match.result.winner,0);
  ok(await h.match(a,current.id,'ack'));ok(await h.match(b,current.id,'ack'));const next=await h.pair(a,b);
  for(let i=0;i<2;i++){h.advance(30000);ok(await h.status(a));ok(await h.status(b));}
  h.advance(30000);const neither=ok(await h.status(a));assert.equal(neither.match.id,next.id);assert.equal(neither.match.result.reason,'double_timeout');assert.equal(neither.match.result.outcome,'void');assert.deepEqual(neither.match.result.ratingDelta,[0,0]);
});

test('rules changes expire waiting intents and void active matches without replay or rating changes',async t=>{
  const h=setup(t),a=await h.register(),b=await h.register(),queued=ok(await h.queue(a));
  h.env.DB.sqlite.prepare('UPDATE ranked_queue SET rules_version=? WHERE id=?').run('ranked-old',queued.queue.id);
  assert.equal(ok(await h.status(a)).queue,null);assert.equal(ok(await h.queue(a,team(),queued.queue.requestId)).intent.state,'expired');
  const current=await h.pair(a,b);h.env.DB.sqlite.prepare('UPDATE ranked_matches SET rules_version=? WHERE id=?').run('ranked-old',current.id);
  const changed=ok(await h.status(a));assert.equal(changed.match.result.reason,'rules_changed');assert.equal(changed.match.result.outcome,'void');assert.deepEqual(changed.match.result.ratingDelta,[0,0]);assert.equal(changed.profile.games,0);
});

test('all operator roles use actual player names and original special-grant entitlements before normalizing Lv100 gifts',async t=>{
  const h=setup(t),{main,sub,third}=await h.operators();
  for(const actor of [main,sub,third]){
    const me=ok(await h.call('/me',actor)),member=me.adminReserveAddition.members[0],mon=engine.makeMonster(member.species,100);
    Object.assign(mon,{grantId:member.grantId,bonusPoints:99,heldItem:'trainband'});delete mon.gender;
    const roster=[mon,...team().slice(1)],response=ok(await h.queue(actor,roster));
    assert.equal(response.profile.name,actor.name);assert.equal('adminRole'in response.profile,false);assert.equal('isAdmin'in response.profile,false);
    if(response.queue){assert.equal(response.queue.team[0].level,100);ok(await h.cancel(actor,response.queue.requestId));}
    const outsider=await h.register();assert.equal((await h.queue(outsider,roster)).status,403);
    const changed=copy(roster);changed[0].level=99;changed[0].hp=Math.min(changed[0].hp,engine.stats(changed[0]).hp);assert([400,403].includes((await h.queue(actor,changed)).status));
  }
  const match=await h.pair(main,sub);assert.deepEqual(match.players.map(player=>player.name),['あおい','ひなた']);assert(match.players.every(player=>!('adminRole'in player)&&!('isAdmin'in player)));assert.deepEqual(match.battle.teams.map(roster=>roster.name),['あおい','ひなた']);
});

test('configured Futo stats require the recipient grant and preserve the verified configuration at Lv50',async t=>{
  const h=setup(t),{main}=await h.operators(),a=await h.register('受取人'),b=await h.register('別人'),batch=crypto.randomUUID(),config={...copy(DEFAULT_CONFIG),level:20};
  ok(await h.call('/admin/grants',main,'POST',{requestId:batch,target:a.id,config}));
  const mon=engine.makeMonster('futo',60);Object.assign(mon,{grantId:batch+':'+a.id,customStats:copy(config.stats),customStatsLevel:config.level,futoConfigLevel:config.level,customMoves:copy(config.moves)});mon.hp=engine.stats(mon).hp;mon.pp=Object.fromEntries(engine.moves(mon).map(move=>[move.id,engine.maxPP(move)]));
  const roster=[mon,...team().slice(1)],waiting=ok(await h.queue(a,roster));assert(waiting.queue);ok(await h.cancel(a,waiting.queue.requestId));
  assert.equal((await h.queue(b,roster)).error.code,'KASAI_PARTY_NOT_OWNED');
  const forged=copy(roster);forged[0].customStats.atk++;assert.equal((await h.queue(a,forged)).error.code,'KASAI_PARTY_CHANGED');
  const missing=copy(roster);delete missing[0].grantId;assert.equal((await h.queue(a,missing)).status,403);
  const current=await h.pair(a,b,roster);assert.deepEqual(current.battle.teams[0].monsters[0].stats,rankedPreviewMember(mon).stats);
});

test('ranked and trade creation/join exclude each other atomically in both directions',async t=>{
  const h=setup(t),a=await h.register(),b=await h.register(),c=await h.register();
  const waiting=ok(await h.queue(a));assert.equal((await h.call('/trades',a,'POST',{requestId:crypto.randomUUID()})).error.code,'RANKED_BUSY');
  const trade=ok(await h.call('/trades',b,'POST',{requestId:crypto.randomUUID()})).trade;
  assert.equal((await h.call('/trades/join',a,'POST',{code:trade.code})).error.code,'RANKED_BUSY');assert.equal((await h.queue(b)).error.code,'ACTIVE_TRADE');
  ok(await h.cancel(a,waiting.queue.requestId));
  const results=await Promise.all([h.queue(a),h.call('/trades/join',a,'POST',{code:trade.code})]);assert.equal(results.filter(result=>result.status===200).length,1);
  const locks=h.env.DB.sqlite.prepare('SELECT (SELECT COUNT(*) FROM ranked_members WHERE player_id=?)+(SELECT COUNT(*) FROM trade_active WHERE player_id=?) AS n').get(a.id,a.id);assert.equal(locks.n,1);
  const creation=await Promise.all([h.queue(c),h.call('/trades',c,'POST',{requestId:crypto.randomUUID()})]);assert.equal(creation.filter(result=>result.status===200).length,1);assert.equal(h.env.DB.sqlite.prepare('SELECT (SELECT COUNT(*) FROM ranked_members WHERE player_id=?)+(SELECT COUNT(*) FROM trade_active WHERE player_id=?) AS n').get(c.id,c.id).n,1);
});

test('ranked and Kasai live lock either participant atomically, including a concurrent start',async t=>{
  const h=setup(t),{main,challenger}=await h.liveReady();
  const waiting=ok(await h.queue(main));assert.equal((await h.startLive(challenger,main)).error.code,'RANKED_BUSY');ok(await h.cancel(main,waiting.queue.requestId));
  const results=await Promise.all([h.queue(main),h.startLive(challenger,main)]);assert.equal(results.filter(result=>result.status===200).length,1);
  assert.equal(h.env.DB.sqlite.prepare('SELECT (SELECT COUNT(*) FROM ranked_members WHERE player_id=?)+(SELECT COUNT(*) FROM kasai_live_members WHERE player_id=?) AS n').get(main.id,main.id).n,1);
  if(results[1].status===200){assert.equal((await h.queue(main)).error.code,'KASAI_LIVE_BUSY');assert.equal((await h.queue(challenger)).error.code,'KASAI_LIVE_BUSY');}
  else{const queue=ok(await h.status(main)).queue;ok(await h.cancel(main,queue.requestId));ok(await h.startLive(challenger,main));assert.equal((await h.queue(main)).error.code,'KASAI_LIVE_BUSY');assert.equal((await h.queue(challenger)).error.code,'KASAI_LIVE_BUSY');}
});

test('Elo uses the declared K32 tiers, a zero floor, and an actual draw rather than a void',()=>{
  assert.deepEqual(rankedRatingResult(1000,1000,0),{before:[1000,1000],after:[1016,984],delta:[16,-16]});
  assert.deepEqual(rankedRatingResult(1000,1000,1).delta,[-16,16]);assert.deepEqual(rankedRatingResult(1000,1000,'draw').delta,[0,0]);
  assert.deepEqual(rankedRatingResult(0,0,1).after,[0,16]);assert.deepEqual(rankedRatingResult(1200,1000,null).delta,[0,0]);assert.deepEqual(rankedRatingResult(1200,1000,'draw').delta,[-8,8]);
});

test('ranked migration preserves existing identities, chat, grants and rooms without granting games or ratings',async t=>{
  const h=setup(t,{ranked:false}),a=await h.register('既存の旅人');ok(await h.call('/world/chat',a,'POST',{clientId:crypto.randomUUID(),text:'今までの会話'}));
  const before=copy(h.env.DB.sqlite.prepare('SELECT * FROM players').all()),chat=copy(h.env.DB.sqlite.prepare('SELECT * FROM world_chat_messages').all());
  h.env.DB.sqlite.exec(readFileSync(new URL('../drizzle/0010_ranked.sql',import.meta.url),'utf8'));
  assert.deepEqual(copy(h.env.DB.sqlite.prepare('SELECT * FROM players').all()),before);assert.deepEqual(copy(h.env.DB.sqlite.prepare('SELECT * FROM world_chat_messages').all()),chat);
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM ranked_profiles').get().n,0);assert.equal(ok(await h.status(a)).profile.games,0);assert.equal(ok(await h.call('/world/ranked/leaderboard',a)).players.length,0);
});
