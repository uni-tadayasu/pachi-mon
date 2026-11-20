// Ranked matches own their snapshots, locks and ratings on the server. Only
// original owned-mon enrollment records and battle commands come from clients.
import {RANKED_RULES_VERSION,RANKED_COMPATIBLE_VERSIONS,rankedRulesInfo,normalizeRankedTeam,createRankedBattle,validateRankedOrders,resolveRankedRound,rankForRating} from './ranked-engine.mjs';

export const RANKED_QUEUE_TTL=45000;
export const RANKED_HEARTBEAT_TTL=60000;
export const RANKED_ROUND_TTL=90000;
const INITIAL_RATING=1000,K_FACTOR=32;
const COMPATIBLE_VERSIONS=RANKED_COMPATIBLE_VERSIONS;
const supportsVersion=version=>COMPATIBLE_VERSIONS.includes(version);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MATCH_SELECT=`SELECT m.*,p0.name AS name0,p1.name AS name1 FROM ranked_matches m JOIN players p0 ON p0.id=m.player0_id JOIN players p1 ON p1.id=m.player1_id`;
const PROFILE_SELECT=`SELECT r.*,p.name FROM ranked_profiles r JOIN players p ON p.id=r.player_id`;
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const serialize=value=>JSON.stringify(canonical(value));
const matchSide=(row,id)=>row.player0_id===id?0:row.player1_id===id?1:-1;
const matchRow=(env,id)=>env.DB.prepare(MATCH_SELECT+' WHERE m.id=?').bind(id).first();
const membership=(env,id)=>env.DB.prepare('SELECT * FROM ranked_members WHERE player_id=?').bind(id).first();
const queueIntent=(env,playerId,requestId)=>env.DB.prepare('SELECT * FROM ranked_queue WHERE player_id=? AND request_id=?').bind(playerId,requestId).first();
export const hasRankedMembership=async(env,playerId)=>!!await membership(env,playerId);

export function rankedRatingResult(rating0,rating1,winner){
  const before=[rating0,rating1];
  if(winner===null)return {before,after:before.slice(),delta:[0,0]};
  const score=winner==='draw'?0.5:winner===0?1:0,expected=1/(1+10**((rating1-rating0)/400));
  const change=Math.round(K_FACTOR*(score-expected)),after=[Math.max(0,rating0+change),Math.max(0,rating1-change)];
  return {before,after,delta:after.map((rating,side)=>rating-before[side])};
}
function profileView(row){return {playerId:row.player_id,name:row.name,rating:row.rating,wins:row.wins,losses:row.losses,draws:row.draws,games:row.games,tier:rankForRating(row.rating)};}
function outcomeFor(row,side){return row.winner==='void'?'void':row.winner==='draw'?'draw':Number(row.winner)===side?'win':'loss';}
function resultView(row,side){
  if(row.state!=='result')return null;
  return {winner:row.winner==='void'?null:row.winner==='draw'?'draw':Number(row.winner),reason:row.reason,outcome:outcomeFor(row,side),ratingBefore:[row.rating0_before,row.rating1_before],ratingAfter:[row.rating0_after,row.rating1_after],ratingDelta:[row.delta0,row.delta1],settledAt:row.settled_at};
}
async function ordersFor(env,row){const data=await env.DB.prepare('SELECT side,orders_json FROM ranked_orders WHERE match_id=? AND round=? ORDER BY side').bind(row.id,row.round).all();return data.results;}
async function matchView(env,row,playerId){
  const side=matchSide(row,playerId),orders=row.state==='battle'?await ordersFor(env,row):[];
  return {id:row.id,rulesVersion:row.rules_version,state:row.state,side,
    players:[{id:row.player0_id,name:row.name0,ratingBefore:row.rating0_before},{id:row.player1_id,name:row.name1,ratingBefore:row.rating1_before}],
    revision:row.revision,round:row.round,submitted:[0,1].map(index=>orders.some(order=>order.side===index)),deadlineAt:row.deadline_at,
    battle:JSON.parse(row.battle_json),result:resultView(row,side),createdAt:row.created_at,updatedAt:row.updated_at};
}
async function ensureProfile(env,id,now){await env.DB.prepare('INSERT OR IGNORE INTO ranked_profiles (player_id,rating,updated_at) VALUES (?,?,?)').bind(id,INITIAL_RATING,now).run();}

// Every state-changing batch is guarded by the same persisted revision or
// intent row. A losing concurrent request cannot partly acquire either player.
async function expireQueues(env,now,playerId=null){
  const scope=playerId?'player_id=?':'id IN (SELECT id FROM ranked_queue WHERE state=\'waiting\' AND (seen_at<=? OR rules_version<>?) LIMIT 100)';
  const args=playerId?[playerId]:[now-RANKED_QUEUE_TTL,RANKED_RULES_VERSION];
  await env.DB.batch([
    env.DB.prepare(`UPDATE ranked_queue SET state='expired',updated_at=? WHERE state='waiting' AND (seen_at<=? OR rules_version<>?) AND ${scope}`).bind(now,now-RANKED_QUEUE_TTL,RANKED_RULES_VERSION,...args),
    env.DB.prepare("DELETE FROM ranked_members WHERE queue_id IN (SELECT id FROM ranked_queue WHERE state IN ('expired','cancelled'))").bind()
  ]);
}
async function settleMatch(env,row,winner,reason,now,battle=null){
  if(row.state!=='battle')return row;
  const rating=rankedRatingResult(row.rating0_before,row.rating1_before,winner),token=crypto.randomUUID(),winnerText=winner===null?'void':String(winner);
  const state=battle||JSON.parse(row.battle_json),round=state.round;
  if(!battle){state.winner=winner;state.reason=reason;}
  const heartbeatGuard=['disconnect','double_disconnect'].includes(reason)?' AND seen0_at=? AND seen1_at=?':'';
  const statements=[env.DB.prepare(`UPDATE ranked_matches SET state='result',battle_json=?,round=?,revision=revision+1,winner=?,reason=?,rating0_after=?,rating1_after=?,delta0=?,delta1=?,settlement_token=?,settled_at=?,updated_at=?
    WHERE id=? AND state='battle' AND revision=?${heartbeatGuard}`).bind(JSON.stringify(state),round,winnerText,reason,...rating.after,...rating.delta,token,now,now,row.id,row.revision,...(heartbeatGuard?[row.seen0_at,row.seen1_at]:[]))];
  if(winner!==null)for(const side of [0,1])statements.push(env.DB.prepare(`UPDATE ranked_profiles SET rating=?,games=games+1,wins=wins+?,losses=losses+?,draws=draws+?,updated_at=?
    WHERE player_id=? AND EXISTS(SELECT 1 FROM ranked_matches WHERE id=? AND settlement_token=?)`)
    .bind(rating.after[side],winner===side?1:0,winner!=='draw'&&winner!==side?1:0,winner==='draw'?1:0,now,row['player'+side+'_id'],row.id,token));
  await env.DB.batch(statements);
  return matchRow(env,row.id);
}
async function addAutomaticOrders(env,row,now){
  const battle=JSON.parse(row.battle_json);
  if(battle.phase!=='replacement')return row;
  for(const side of [0,1]){
    if(!validateRankedOrders(battle,side,[]).ok)continue;
    const token=crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO ranked_orders (match_id,round,side,request_id,orders_json,write_token,created_at)
        SELECT id,round,?,?,'[]',?,? FROM ranked_matches WHERE id=? AND state='battle' AND round=?`)
        .bind(side,crypto.randomUUID(),token,now,row.id,row.round),
      env.DB.prepare(`UPDATE ranked_matches SET revision=revision+1,updated_at=? WHERE id=? AND state='battle' AND round=?
        AND EXISTS(SELECT 1 FROM ranked_orders WHERE match_id=? AND round=? AND side=? AND write_token=?)`).bind(now,row.id,row.round,row.id,row.round,side,token)
    ]);
    row=await matchRow(env,row.id);
    if(row.state!=='battle'||row.round!==battle.round)return row;
  }
  return row;
}
async function advanceMatch(env,row,now){
  // Completed, accepted commands resolve before timeouts. A worker crash after
  // accepting the second command cannot discard a legitimately completed turn.
  for(let attempt=0;attempt<6&&row?.state==='battle';attempt++){
    if(!supportsVersion(row.rules_version))return settleMatch(env,row,null,'rules_changed',now);
    row=await addAutomaticOrders(env,row,now);
    if(row.state!=='battle')break;
    const orders=await ordersFor(env,row);
    if(orders.length===2){
      const commands=[0,1].map(side=>JSON.parse(orders.find(order=>order.side===side).orders_json)),battle=JSON.parse(row.battle_json);
      const next=resolveRankedRound(battle,commands);
      if(next.winner!==null)return settleMatch(env,row,next.winner,'battle',now,next);
      await env.DB.prepare(`UPDATE ranked_matches SET battle_json=?,round=?,revision=revision+1,deadline_at=?,updated_at=? WHERE id=? AND state='battle' AND round=? AND revision=?`)
        .bind(JSON.stringify(next),next.round,now+RANKED_ROUND_TTL,now,row.id,row.round,row.revision).run();
      row=await matchRow(env,row.id);continue;
    }
    const disconnected=[row.seen0_at,row.seen1_at].map(seen=>seen<=now-RANKED_HEARTBEAT_TTL);
    if(disconnected.some(Boolean))return settleMatch(env,row,disconnected.every(Boolean)?null:disconnected[0]?1:0,disconnected.every(Boolean)?'double_disconnect':'disconnect',now);
    if(row.deadline_at<=now){
      const submitted=[0,1].map(side=>orders.some(order=>order.side===side));
      return settleMatch(env,row,submitted[0]&&!submitted[1]?0:submitted[1]&&!submitted[0]?1:null,submitted.some(Boolean)?'turn_timeout':'double_timeout',now);
    }
    break;
  }
  return row;
}
async function refreshMember(env,playerId,now,{touch=true,match=true}={}){
  await expireQueues(env,now,playerId);
  let member=await membership(env,playerId);
  if(member?.match_id){
    let row=await advanceMatch(env,await matchRow(env,member.match_id),now);
    // Check the old deadline first: a late reconnect is not a fresh heartbeat.
    if(touch&&row.state==='battle')await env.DB.prepare(`UPDATE ranked_matches SET seen${member.side}_at=? WHERE id=? AND state='battle'`).bind(now,row.id).run();
  }else if(member?.queue_id){
    if(touch)await env.DB.prepare("UPDATE ranked_queue SET seen_at=?,updated_at=? WHERE id=? AND state='waiting' AND seen_at>? AND rules_version=?").bind(now,now,member.queue_id,now-RANKED_QUEUE_TTL,RANKED_RULES_VERSION).run();
    if(match)await tryMatch(env,member.queue_id,now);
  }
  return membership(env,playerId);
}
async function tryMatch(env,queueId,now){
  for(let attempt=0;attempt<4;attempt++){
    const first=await env.DB.prepare(`SELECT q.*,p.name,r.rating FROM ranked_queue q JOIN ranked_members m ON m.queue_id=q.id JOIN players p ON p.id=q.player_id JOIN ranked_profiles r ON r.player_id=q.player_id
      WHERE q.id=? AND q.state='waiting' AND q.rules_version=? AND q.seen_at>?`).bind(queueId,RANKED_RULES_VERSION,now-RANKED_QUEUE_TTL).first();
    if(!first)return;
    const second=await env.DB.prepare(`SELECT q.*,p.name,r.rating FROM ranked_queue q JOIN ranked_members m ON m.queue_id=q.id JOIN players p ON p.id=q.player_id JOIN ranked_profiles r ON r.player_id=q.player_id
      WHERE q.player_id<>? AND q.state='waiting' AND q.rules_version=? AND q.seen_at>?
      AND ((?-MIN(q.joined_at,?))>=90000 OR ABS(r.rating-?)<=100+100*CAST((?-MIN(q.joined_at,?))/15000 AS INTEGER))
      ORDER BY ABS(r.rating-?),q.joined_at,q.id LIMIT 1`).bind(first.player_id,RANKED_RULES_VERSION,now-RANKED_QUEUE_TTL,now,first.joined_at,first.rating,now,first.joined_at,first.rating).first();
    if(!second)return;
    // Keep side assignment independent of which poll happened to perform pairing.
    const pair=[first,second].sort((a,b)=>a.joined_at-b.joined_at||a.id.localeCompare(b.id));
    const id=crypto.randomUUID(),seed=crypto.getRandomValues(new Uint32Array(1))[0],battle=createRankedBattle(JSON.parse(pair[0].team_json),JSON.parse(pair[1].team_json),seed,pair.map(q=>q.name));
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO ranked_matches (id,queue0_id,queue1_id,player0_id,player1_id,rules_version,battle_json,round,seen0_at,seen1_at,deadline_at,rating0_before,rating1_before,created_at,updated_at)
        SELECT ?,q0.id,q1.id,q0.player_id,q1.player_id,?,?,?,q0.seen_at,q1.seen_at,?,r0.rating,r1.rating,?,?
        FROM ranked_queue q0 JOIN ranked_queue q1 ON q1.id=? JOIN ranked_profiles r0 ON r0.player_id=q0.player_id JOIN ranked_profiles r1 ON r1.player_id=q1.player_id
        WHERE q0.id=? AND q0.player_id<>q1.player_id AND q0.state='waiting' AND q1.state='waiting' AND q0.rules_version=? AND q1.rules_version=? AND q0.seen_at>? AND q1.seen_at>?
        AND EXISTS(SELECT 1 FROM ranked_members WHERE player_id=q0.player_id AND queue_id=q0.id) AND EXISTS(SELECT 1 FROM ranked_members WHERE player_id=q1.player_id AND queue_id=q1.id)
        AND NOT EXISTS(SELECT 1 FROM trade_active WHERE player_id IN(q0.player_id,q1.player_id)) AND NOT EXISTS(SELECT 1 FROM kasai_live_members WHERE player_id IN(q0.player_id,q1.player_id))`)
        .bind(id,RANKED_RULES_VERSION,JSON.stringify(battle),battle.round,now+RANKED_ROUND_TTL,now,now,pair[1].id,pair[0].id,RANKED_RULES_VERSION,RANKED_RULES_VERSION,now-RANKED_QUEUE_TTL,now-RANKED_QUEUE_TTL),
      env.DB.prepare("UPDATE ranked_queue SET state='matched',match_id=?,updated_at=? WHERE id IN (?,?) AND state='waiting' AND EXISTS(SELECT 1 FROM ranked_matches WHERE id=?)")
        .bind(id,now,pair[0].id,pair[1].id,id),
      ...pair.map((queue,side)=>env.DB.prepare('UPDATE ranked_members SET queue_id=NULL,match_id=?,side=? WHERE player_id=? AND queue_id=? AND EXISTS(SELECT 1 FROM ranked_matches WHERE id=?)').bind(id,side,queue.player_id,queue.id,id))
    ]);
    if(await matchRow(env,id))return;
  }
}
async function status(env,player,now,intent=null,responseVersion=RANKED_RULES_VERSION){
  // Read membership and its queue in one SQLite snapshot. Pairing may commit
  // between separate reads; that must never produce a false idle response.
  const member=await env.DB.prepare(`SELECT m.*,q.state AS queue_state,q.request_id,q.team_json,q.joined_at,q.seen_at
    FROM ranked_members m LEFT JOIN ranked_queue q ON q.id=m.queue_id WHERE m.player_id=?`).bind(player.id).first();
  const profile=await env.DB.prepare(PROFILE_SELECT+' WHERE r.player_id=?').bind(player.id).first();
  let queue=null,match=null;
  if(member?.queue_id&&member.queue_state==='waiting'){
    queue={id:member.queue_id,requestId:member.request_id,state:'waiting',team:JSON.parse(member.team_json),joinedAt:member.joined_at,expiresAt:member.seen_at+RANKED_QUEUE_TTL};
  }else if(member?.match_id)match=await matchView(env,await matchRow(env,member.match_id),player.id);
  // A match keeps its rules until acknowledged. This also lets an already-open
  // v78 client finish and acknowledge its match during the v79 deployment.
  const reply={rulesVersion:match?.rulesVersion||responseVersion,profile:profileView(profile),queue,match,serverTime:now,pollAfterMs:2000};
  if(intent)reply.intent={requestId:intent.request_id,state:intent.state};
  return reply;
}
async function sweepMatches(env,now){
  const rows=await env.DB.prepare(MATCH_SELECT+` WHERE m.state='battle' AND (m.rules_version NOT IN (${COMPATIBLE_VERSIONS.map(()=>'?').join(',')}) OR m.deadline_at<=? OR m.seen0_at<=? OR m.seen1_at<=?) LIMIT 20`)
    .bind(...COMPATIBLE_VERSIONS,now,now-RANKED_HEARTBEAT_TTL,now-RANKED_HEARTBEAT_TTL).all();
  for(const row of rows.results)await advanceMatch(env,row,now);
}
function exactFields(body,fields,fail){if(Object.keys(body).some(key=>!fields.includes(key)))fail(400,'INVALID_RANKED_REQUEST','ランク対戦の送信内容を確認してください。');}
function requestIdOf(value,fail){if(typeof value!=='string'||!UUID.test(value))fail(400,'INVALID_RANKED_REQUEST_ID','ランク対戦の識別情報を確認してください。');return value.toLowerCase();}
async function requireMatch(env,id,player,fail){
  if(!UUID.test(id))fail(404,'RANKED_MATCH_NOT_FOUND','このランク対戦は見つかりません。');
  const row=await matchRow(env,id);if(!row)fail(404,'RANKED_MATCH_NOT_FOUND','このランク対戦は見つかりません。');
  if(matchSide(row,player.id)<0)fail(403,'RANKED_PARTICIPANT_REQUIRED','このランク対戦には参加していません。');
  return row;
}

export async function rankedRoute(request,env,path,method,player,{fail,bodyJSON,consumeLimit,activeTrade,validateOwned,refreshLive}){
  const now=Date.now();
  await consumeLimit(env,request,`ranked:${player.id}`,180,60000,true);
  await ensureProfile(env,player.id,now);
  if(path==='/api/world/ranked'&&method==='GET'){
    await expireQueues(env,now);await refreshMember(env,player.id,now);return status(env,player,now);
  }
  if(path==='/api/world/ranked/rules'&&method==='GET')return {rules:rankedRulesInfo(),serverTime:now};
  if(path==='/api/world/ranked/history'&&method==='GET'){
    await refreshMember(env,player.id,now,{touch:false,match:false});
    const rows=await env.DB.prepare(MATCH_SELECT+" WHERE m.state='result' AND (m.player0_id=? OR m.player1_id=?) ORDER BY m.settled_at DESC,m.id DESC LIMIT 20").bind(player.id,player.id).all();
    return {history:rows.results.map(row=>{const side=matchSide(row,player.id),other=1-side;return {id:row.id,playedAt:row.settled_at,opponent:{id:row['player'+other+'_id'],name:row['name'+other]},outcome:outcomeFor(row,side),reason:row.reason,ratingBefore:row['rating'+side+'_before'],ratingAfter:row['rating'+side+'_after'],ratingDelta:row['delta'+side]};}),serverTime:now};
  }
  if(path==='/api/world/ranked/leaderboard'&&method==='GET'){
    await sweepMatches(env,now);
    const rows=await env.DB.prepare(PROFILE_SELECT+' WHERE r.games>0 ORDER BY r.rating DESC,r.wins DESC,r.games,r.player_id LIMIT 50').all();
    return {players:rows.results.map((row,index)=>({...profileView(row),rank:index+1})),serverTime:now};
  }
  if(path==='/api/world/ranked/queue'&&['POST','DELETE'].includes(method)){
    const body=await bodyJSON(request);exactFields(body,method==='POST'?['requestId','team','rulesVersion']:['requestId'],fail);
    const requestId=requestIdOf(body.requestId,fail);
    await refreshMember(env,player.id,now,{touch:false,match:false});
    if(method==='DELETE'){
      await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO ranked_queue (id,player_id,request_id,state,team_json,rules_version,joined_at,seen_at,updated_at) VALUES (?,?,?,'cancelled','[]',?,?,?,?)")
          .bind(crypto.randomUUID(),player.id,requestId,RANKED_RULES_VERSION,now,now,now),
        env.DB.prepare("UPDATE ranked_queue SET state='cancelled',updated_at=? WHERE player_id=? AND request_id=? AND state='waiting'").bind(now,player.id,requestId),
        env.DB.prepare("DELETE FROM ranked_members WHERE player_id=? AND queue_id IN (SELECT id FROM ranked_queue WHERE player_id=? AND request_id=? AND state='cancelled')").bind(player.id,player.id,requestId)
      ]);
      return status(env,player,now,await queueIntent(env,player.id,requestId));
    }
    // Old waiting intents expire on deployment. A fresh enrollment must prove
    // that its client can read and render the direct-growth rules before pairing.
    if(body.rulesVersion!==RANKED_RULES_VERSION)fail(409,'RANKED_RULES_UPDATED','ランク対戦のルールが更新されました。ページを更新してから参加してください。進行中の対戦はそのまま続けられます。');
    let team;try{team=normalizeRankedTeam(body.team);}catch(error){fail(400,'INVALID_RANKED_TEAM',error?.message||'所持パチモンから異なる3体を選んでください。');}
    await validateOwned(env,team,player);
    const teamJSON=serialize(team),prior=await queueIntent(env,player.id,requestId);
    if(prior){
      if(!['cancelled','expired'].includes(prior.state)&&prior.team_json!==teamJSON)fail(409,'RANKED_REQUEST_REUSED','同じ対戦の識別情報で別のチームは選べません。');
      if(prior.state==='waiting')await refreshMember(env,player.id,now);
      return status(env,player,now,await queueIntent(env,player.id,requestId));
    }
    if(await membership(env,player.id))fail(409,'RANKED_BUSY','進行中のランク対戦を先に確認してください。');
    if(await activeTrade(env,player.id))fail(409,'ACTIVE_TRADE','進行中の交換を先に終了してください。');
    await refreshLive(env,now);
    if(await env.DB.prepare('SELECT 1 FROM kasai_live_members WHERE player_id=?').bind(player.id).first())fail(409,'KASAI_LIVE_BUSY','運営との対戦を終了し、部屋を出てから参加してください。');
    await consumeLimit(env,request,`ranked-queue:${player.id}`,30,60000,true);
    const id=crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO ranked_queue (id,player_id,request_id,state,team_json,rules_version,joined_at,seen_at,updated_at)
        SELECT ?,?,?,'waiting',?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM ranked_members WHERE player_id=?)
        AND NOT EXISTS(SELECT 1 FROM trade_active WHERE player_id=?) AND NOT EXISTS(SELECT 1 FROM kasai_live_members WHERE player_id=?)`)
        .bind(id,player.id,requestId,teamJSON,RANKED_RULES_VERSION,now,now,now,player.id,player.id,player.id),
      env.DB.prepare(`INSERT OR IGNORE INTO ranked_members (player_id,queue_id) SELECT player_id,id FROM ranked_queue WHERE player_id=? AND request_id=? AND state='waiting'
        AND NOT EXISTS(SELECT 1 FROM trade_active WHERE player_id=?) AND NOT EXISTS(SELECT 1 FROM kasai_live_members WHERE player_id=?)`)
        .bind(player.id,requestId,player.id,player.id)
    ]);
    const created=await queueIntent(env,player.id,requestId);
    if(!created){
      if(await activeTrade(env,player.id))fail(409,'ACTIVE_TRADE','進行中の交換を先に終了してください。');
      if(await env.DB.prepare('SELECT 1 FROM kasai_live_members WHERE player_id=?').bind(player.id).first())fail(409,'KASAI_LIVE_BUSY','運営との対戦を先に終了してください。');
      fail(409,'RANKED_BUSY','参加状態が変わりました。現在の対戦を確認してください。');
    }
    if(!['cancelled','expired'].includes(created.state)&&created.team_json!==teamJSON)fail(409,'RANKED_REQUEST_REUSED','同じ対戦の識別情報で別のチームは選べません。');
    if(created.state==='waiting')await tryMatch(env,created.id,now);
    return status(env,player,now,await queueIntent(env,player.id,requestId));
  }
  const target=/^\/api\/world\/ranked\/matches\/([0-9a-f-]+)\/(actions|forfeit|ack)$/.exec(path);
  if(target&&method==='POST'){
    let row=await requireMatch(env,target[1],player,fail);const side=matchSide(row,player.id),operation=target[2],body=await bodyJSON(request);
    row=await advanceMatch(env,row,now);
    if(operation==='ack'){
      exactFields(body,[],fail);
      if(row.state!=='result')fail(409,'RANKED_NOT_FINISHED','対戦が終わってから結果を確認してください。');
      await env.DB.batch([
        env.DB.prepare(`UPDATE ranked_matches SET acked${side}_at=COALESCE(acked${side}_at,?) WHERE id=? AND state='result'`).bind(now,row.id),
        env.DB.prepare('DELETE FROM ranked_members WHERE player_id=? AND match_id=?').bind(player.id,row.id)
      ]);
      return status(env,player,now,null,supportsVersion(row.rules_version)?row.rules_version:RANKED_RULES_VERSION);
    }
    if(operation==='forfeit'){
      exactFields(body,[],fail);
      for(let attempt=0;attempt<4&&row.state==='battle';attempt++)row=await settleMatch(env,row,1-side,'forfeit',now);
      if(row.state==='battle')fail(409,'RANKED_STATE_CHANGED','対戦の状態が変わりました。最新の状態からもう一度操作してください。');
      return status(env,player,now);
    }
    exactFields(body,['round','orders','requestId'],fail);
    const requestId=requestIdOf(body.requestId,fail);
    if(!integer(body.round,1,1000)||!Array.isArray(body.orders))fail(400,'INVALID_RANKED_ACTION','対戦の行動を確認してください。');
    const ordersJSON=serialize(body.orders),prior=await env.DB.prepare('SELECT round,orders_json FROM ranked_orders WHERE match_id=? AND side=? AND request_id=?').bind(row.id,side,requestId).first();
    if(prior){
      if(prior.round!==body.round||prior.orders_json!==ordersJSON)fail(409,'RANKED_ACTION_REUSED','同じ行動の識別情報で別の行動は送れません。');
      if(row.state==='battle')await env.DB.prepare(`UPDATE ranked_matches SET seen${side}_at=? WHERE id=? AND state='battle'`).bind(now,row.id).run();
      return status(env,player,now);
    }
    if(row.state!=='battle')fail(409,'RANKED_NOT_ACTIVE','この対戦は終了しました。結果を確認してください。');
    if(row.round!==body.round)fail(409,'RANKED_ROUND_CHANGED','ターンが進みました。最新の対戦を確認してください。');
    const valid=validateRankedOrders(JSON.parse(row.battle_json),side,body.orders);
    if(!valid.ok)fail(400,'INVALID_RANKED_ACTION',valid.error||'この行動は選べません。');
    const token=crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO ranked_orders (match_id,round,side,request_id,orders_json,write_token,created_at)
        SELECT id,round,?,?,?,?,? FROM ranked_matches WHERE id=? AND state='battle' AND round=? AND rules_version=? AND deadline_at>? AND seen0_at>? AND seen1_at>?`)
        .bind(side,requestId,ordersJSON,token,now,row.id,body.round,row.rules_version,now,now-RANKED_HEARTBEAT_TTL,now-RANKED_HEARTBEAT_TTL),
      env.DB.prepare(`UPDATE ranked_matches SET revision=revision+1,seen${side}_at=?,updated_at=? WHERE id=? AND state='battle' AND round=?
        AND EXISTS(SELECT 1 FROM ranked_orders WHERE match_id=? AND round=? AND side=? AND write_token=?)`).bind(now,now,row.id,body.round,row.id,body.round,side,token)
    ]);
    const accepted=await env.DB.prepare('SELECT request_id,orders_json FROM ranked_orders WHERE match_id=? AND round=? AND side=?').bind(row.id,body.round,side).first();
    if(!accepted)fail(409,'RANKED_ROUND_CHANGED','対戦の状態が変わりました。最新の状態を確認してください。');
    const automaticEmpty=ordersJSON==='[]'&&JSON.parse(row.battle_json).phase==='replacement';
    if(accepted.orders_json!==ordersJSON||(accepted.request_id!==requestId&&!automaticEmpty))fail(409,'RANKED_ACTION_LOCKED','このターンの行動は送信済みです。変更できません。');
    await advanceMatch(env,await matchRow(env,row.id),now);
    return status(env,player,now);
  }
  if(path==='/api/world/ranked'||path==='/api/world/ranked/queue'||target)fail(405,'METHOD_NOT_ALLOWED','この操作方法には対応していません。');
  fail(404,'NOT_FOUND','このランク対戦の操作はありません。');
}
