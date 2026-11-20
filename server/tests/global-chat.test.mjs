import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../server.mjs';

const SECRET='global-chat-local-test-claim-key',MESSAGE_KEYS=['authorId','canDelete','clientId','createdAt','deletedAt','id','name','text'];
const MIGRATIONS=readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>/^\d+.*\.sql$/.test(name)).sort();
class LocalD1 {
  constructor({chat=true}={}){
    this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON');
    for(const file of MIGRATIONS)if(chat||file!=='0009_global_chat.sql')this.sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  }
  prepare(sql){
    const db=this;
    return {sql,values:[],bind(...values){this.values=values;return this;},execute(){return {results:db.sqlite.prepare(sql).all(...this.values).map(row=>({...row})),success:true,meta:{changes:db.sqlite.prepare('SELECT changes() AS n').get().n}};},async first(){return this.execute().results[0]||null;},async all(){return this.execute();},async run(){return this.execute();}};
  }
  async batch(statements){this.sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement.execute());this.sqlite.exec('COMMIT');return results;}catch(error){this.sqlite.exec('ROLLBACK');throw error;}}
}
const ok=response=>{assert.equal(response.status,200,JSON.stringify(response));return response;};
function setup(t){
  let now=Date.now(),ip=0;t.mock.method(Date,'now',()=>now);
  const env={DB:new LocalD1(),ADMIN_CLAIM_KEY:SECRET};t.after(()=>env.DB.sqlite.close());
  const advance=milliseconds=>now+=milliseconds;
  const call=async(path,actor,method='GET',body,options={})=>{
    const response=await worker.fetch(new Request('https://chat.example/api'+path,{method,headers:{'Content-Type':'application/json',Origin:'https://uni-tadayasu.github.io','CF-Connecting-IP':options.ip||'192.0.2.'+(++ip),...(actor?{Authorization:'Bearer '+actor.token}:{})},body:body===undefined?undefined:JSON.stringify(body)}),env);
    const data=await response.json();assert(!JSON.stringify(data).includes(SECRET));return {status:response.status,...data};
  };
  const register=async(name='旅人')=>{
    const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),result=ok(await call('/register',null,'POST',{name,token}));
    return {token,...result.player};
  };
  const operators=async()=>{
    const main=await register('あおい'),sub=await register('ひなた'),third=await register('こはる');
    ok(await call('/admin/claim',main,'POST',{key:SECRET}));
    ok(await call('/admin/devices',main,'POST',{playerId:sub.id,role:'sub',confirmed:true}));
    ok(await call('/admin/devices',main,'POST',{playerId:third.id,role:'sub-sub',confirmed:true}));
    return {main,sub,third};
  };
  const revoke=async(main,actor)=>{
    const device=ok(await call('/admin/devices',main)).devices.find(row=>row.playerId===actor.id);assert(device);
    return call('/admin/devices/revoke',main,'POST',{playerId:actor.id,claimedAt:device.claimedAt,confirmed:true});
  };
  const post=(actor,text,clientId=crypto.randomUUID(),options)=>call('/world/chat',actor,'POST',{clientId,text},options);
  const presence=(actor,map)=>call('/world/presence',actor,'POST',{map,x:21,y:17,facing:'up',avatar:'male',status:'idle'});
  return {env,advance,call,register,operators,revoke,post,presence};
}

test('chat authenticates every read and mutation and ignores no forged author fields',async t=>{
  const h=setup(t),a=await h.register('本人');
  for(const [path,method,body] of [
    ['/world/chat','GET'],['/world/chat?summary=1&after=0','GET'],
    ['/world/chat','POST',{clientId:crypto.randomUUID(),text:'未登録'}],['/world/chat/1','DELETE']
  ])assert.equal((await h.call(path,null,method,body)).status,401);
  for(const forged of [{name:'偽名'},{authorId:'P0000000000000000'},{playerId:a.id},{adminRole:'main'},{canDelete:true},{map:'village'}]){
    const result=await h.call('/world/chat',a,'POST',{clientId:crypto.randomUUID(),text:'本文',...forged});assert.equal(result.error.code,'INVALID_CHAT_MESSAGE');
  }
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_chat_messages').get().n,0);
  const sent=ok(await h.post(a,'本人の投稿'));assert.equal(sent.message.name,'本人');assert.equal(sent.message.authorId,a.id);
  assert.deepEqual(Object.keys(sent.message).sort(),MESSAGE_KEYS);
  assert.equal((await h.call('/world/chat',a,'PUT',{})).status,405);
});

test('one global chronological channel crosses maps and includes players without active presence',async t=>{
  const h=setup(t),a=await h.register('草原の人'),b=await h.register('港の人'),c=await h.register('旅の準備中');
  ok(await h.presence(a,'meadow'));ok(await h.presence(b,'harbor'));
  const first=ok(await h.post(a,'草原からこんにちは')),second=ok(await h.post(b,'港からこんにちは')),third=ok(await h.post(c,'マップ移動前です'));
  assert(first.message.id<second.message.id&&second.message.id<third.message.id);
  for(const actor of [a,b,c]){
    const read=ok(await h.call('/world/chat',actor));assert.equal(read.latestId,third.message.id);
    assert.deepEqual(read.messages.map(message=>message.text),['草原からこんにちは','港からこんにちは','マップ移動前です']);
    assert.deepEqual(read.messages.map(message=>message.canDelete),[a,b,c].map(author=>author.id===actor.id));
  }
  h.advance(60000);assert.equal(ok(await h.call('/world/chat',c)).messages.length,3,'Presence expiry never hides global messages');
});

test('all three operator authors display their registered player names without any role metadata',async t=>{
  const h=setup(t),{main,sub,third}=await h.operators(),reader=await h.register('見学者');
  for(const actor of [main,sub,third]){
    const sent=ok(await h.post(actor,'みんなへのお知らせ'));assert.equal(sent.message.name,actor.name);
    assert.deepEqual(Object.keys(sent.message).sort(),MESSAGE_KEYS);
  }
  const read=ok(await h.call('/world/chat',reader));assert.deepEqual(read.messages.map(message=>message.name),['あおい','ひなた','こはる']);
  for(const message of read.messages){assert.equal(message.canDelete,false);assert(!/カサイ|サカイ|イサカ/.test(message.name));assert.deepEqual(Object.keys(message).sort(),MESSAGE_KEYS);}
  ok(await h.call('/me',sub,'PATCH',{name:'ひなた🌙'}));
  assert.equal(ok(await h.call('/world/chat',reader)).messages.find(message=>message.authorId===sub.id).name,'ひなた🌙');
  ok(await h.revoke(main,third));assert.equal(ok(await h.call('/world/chat',reader)).messages.find(message=>message.authorId===third.id).name,'こはる');
});

test('message validation counts Unicode code points, preserves IME text and stores markup only as text',async t=>{
  const h=setup(t),a=await h.register();
  const accepted=[['  こんにちは\r\n世界  ','こんにちは\n世界'],['🌙'.repeat(300),'🌙'.repeat(300)],['か\u3099'.repeat(150),'か\u3099'.repeat(150)],['👨‍👩‍👧‍👦'.repeat(42),'👨‍👩‍👧‍👦'.repeat(42)],['<script>alert("x")</script>\n<img src=x onerror=alert(1)>\n\'); DROP TABLE players; --','<script>alert("x")</script>\n<img src=x onerror=alert(1)>\n\'); DROP TABLE players; --']];
  for(const [input,expected] of accepted){
    const result=ok(await h.post(a,input));assert.equal(result.message.text,expected);
    assert.equal(h.env.DB.sqlite.prepare('SELECT body FROM world_chat_messages WHERE id=?').get(result.message.id).body,expected);h.advance(2000);
  }
  for(const text of ['', ' \n　 ',null,1,{},'あ'.repeat(301),'🌙'.repeat(301),'a\tb','a\rb','a\u0000b','a\u0007b','a\u0085b','a\u202eb','a\u2066b','\u200b\u200d','\ud800','\udfff']){
    const result=await h.post(a,text);assert.equal(result.error.code,'INVALID_CHAT_MESSAGE',JSON.stringify(text));assert.equal(result.status,400);
  }
  for(const clientId of ['',null,1,{},'not-a-uuid','a'.repeat(80)])assert.equal((await h.post(a,'本文',clientId)).error.code,'INVALID_CHAT_CLIENT_ID');
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_chat_messages').get().n,accepted.length);
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM players').get().n,1);
});

test('idempotent posts survive retries, canonical whitespace, conflicts and deletion without resurrection',async t=>{
  const h=setup(t),a=await h.register('一人目'),b=await h.register('二人目'),clientId=crypto.randomUUID();
  const initial=ok(await h.post(a,'こんにちは\n世界',clientId));assert.equal(initial.duplicate,false);
  for(const id of [clientId,clientId.toUpperCase()]){
    const retry=ok(await h.post(a,'  こんにちは\r\n世界  ',id));assert.equal(retry.duplicate,true);assert.deepEqual(retry.message,initial.message);
  }
  assert.equal((await h.post(a,'別の本文',clientId)).error.code,'CHAT_REQUEST_REUSED');
  const other=ok(await h.post(b,'同じUUIDでも別の人',clientId));assert.notEqual(other.message.id,initial.message.id);
  const removed=ok(await h.call('/world/chat/'+initial.message.id,a,'DELETE'));assert.equal(removed.message.text,null);
  h.advance(120000);
  const retried=ok(await h.post(a,'こんにちは\n世界',clientId));assert.equal(retried.duplicate,true);assert.deepEqual(retried.message,removed.message);
  assert.equal((await h.post(a,'削除後の別本文',clientId)).error.code,'CHAT_REQUEST_REUSED');
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_chat_messages').get().n,2);
});

test('chat client IDs match the frontend UUID versions and variants so an accepted post cannot poison the list',async t=>{
  const h=setup(t),a=await h.register();
  const rejected=[
    '00000000-0000-0000-0000-000000000001',
    ...['0','6','7','8','9','a','b','c','d','e','f'].map(version=>`12345678-1234-${version}abc-8def-123456789abc`),
    ...['0','1','2','3','4','5','6','7','c','d','e','f'].map(variant=>`12345678-1234-4abc-${variant}def-123456789abc`)
  ];
  for(const clientId of rejected){
    const result=await h.post(a,'拒否される投稿',clientId);assert.equal(result.status,400,clientId);assert.equal(result.error.code,'INVALID_CHAT_CLIENT_ID');
  }
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_chat_messages').get().n,0,'Rejected UUID shapes cannot enter the shared feed');
  const expected=[];
  for(const version of ['1','2','3','4','5'])for(const variant of ['8','9','a','b']){
    const clientId=`12345678-1234-${version}abc-${variant}def-123456789abc`,result=ok(await h.post(a,'表示できる投稿',clientId.toUpperCase()));
    assert.equal(result.message.clientId,clientId);expected.push(clientId);h.advance(6000);
  }
  let read=ok(await h.call('/world/chat',a));assert.deepEqual(read.messages.map(message=>message.clientId),expected);
  const removed=ok(await h.call('/world/chat/'+read.messages[0].id,a,'DELETE'));assert.equal(removed.message.clientId,expected[0]);assert.equal(removed.message.text,null);
  read=ok(await h.call('/world/chat',a));assert.deepEqual(read.messages.map(message=>message.clientId),expected,'Deletion tombstones retain the same valid UUID grammar');
});

test('racing identical requests create one message and racing changed bodies cannot reuse the client ID',async t=>{
  const h=setup(t),a=await h.register(),clientId=crypto.randomUUID();
  const retries=await Promise.all(Array.from({length:8},()=>h.post(a,'一度だけ',clientId)));
  assert(retries.every(result=>result.status===200));assert.equal(retries.filter(result=>!result.duplicate).length,1);
  assert.equal(new Set(retries.map(result=>result.message.id)).size,1);assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_chat_messages').get().n,1);
  h.advance(2000);const conflictId=crypto.randomUUID(),conflict=await Promise.all([h.post(a,'内容A',conflictId),h.post(a,'内容B',conflictId)]);
  assert.deepEqual(conflict.map(result=>result.status).sort(),[200,409]);assert.equal(conflict.find(result=>result.status===409).error.code,'CHAT_REQUEST_REUSED');
  h.advance(2000);const distinct=await Promise.all([h.post(a,'別UUIDのA'),h.post(a,'別UUIDのB')]);assert.deepEqual(distinct.map(result=>result.status).sort(),[200,429]);
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_chat_messages').get().n,3);
});

test('strict sliding send limits apply per author, include deleted posts and allow harmless retries',async t=>{
  const h=setup(t),a=await h.register(),b=await h.register(),ip={ip:'192.0.2.200'};
  h.advance((1999-Date.now()%2000+2000)%2000);
  const first=ok(await h.post(a,'1',crypto.randomUUID(),ip)),firstTime=first.message.createdAt;
  h.advance(1);assert.equal((await h.post(a,'早すぎる')).error.code,'CHAT_RATE_LIMITED','A new wall-clock bucket cannot bypass two seconds');
  assert.equal(ok(await h.post(a,'1',first.message.clientId)).duplicate,true);
  ok(await h.post(b,'同じIPでも別の人',crypto.randomUUID(),ip));
  h.advance(1999);ok(await h.post(a,'2'));
  for(let index=3;index<=10;index++){h.advance(2000);ok(await h.post(a,String(index)));}
  ok(await h.call('/world/chat/'+first.message.id,a,'DELETE'));h.advance(2000);
  assert.equal((await h.post(a,'11')).error.code,'CHAT_RATE_LIMITED','Deleting a message cannot reclaim a send slot');
  h.advance(firstTime+60000-Date.now());assert.equal(ok(await h.post(a,'最初の投稿から60秒')).duplicate,false);
  assert.equal(h.env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM world_chat_messages WHERE player_id=?').get(a.id).n,11);
});

test('latest100 reads keep tombstones, summary excludes own/deleted posts and history is never automatically removed',async t=>{
  const h=setup(t),a=await h.register('読む人'),b=await h.register('別の人'),c=await h.register('新しい人');
  const insert=h.env.DB.sqlite.prepare('INSERT INTO world_chat_messages (player_id,client_id,body,created_at) VALUES (?,?,?,?)');
  for(let index=1;index<=105;index++)insert.run(index%2?b.id:a.id,crypto.randomUUID(),'投稿'+index,Date.now()+index);
  h.advance(1000);ok(await h.call('/world/chat/103',b,'DELETE'));
  const read=ok(await h.call('/world/chat',a));assert.equal(read.messages.length,100);assert.equal(read.latestId,105);
  assert.deepEqual(read.messages.map(message=>message.id),Array.from({length:100},(_,index)=>index+6));
  assert.equal(read.messages.find(message=>message.id===103).text,null);assert.equal(read.messages.find(message=>message.id===103).canDelete,false);
  const summary=ok(await h.call('/world/chat?summary=1&after=100',a));assert.equal(summary.latestId,105);assert.equal(summary.unreadCount,2);assert.equal(summary.messages,undefined);
  assert.equal(ok(await h.call('/world/chat?summary=1&after=105',a)).unreadCount,0);
  assert.equal(ok(await h.call('/world/chat?summary=1&after=0',c)).unreadCount,104);
  const before=h.env.DB.sqlite.prepare('SELECT * FROM world_chat_messages ORDER BY id').all(),changes=h.env.DB.sqlite.prepare('SELECT total_changes() AS n').get().n;
  h.advance(365*86400000);ok(await h.call('/world/chat',c));ok(await h.call('/world/chat?summary=1&after=0',c));
  assert.deepEqual(h.env.DB.sqlite.prepare('SELECT * FROM world_chat_messages ORDER BY id').all(),before);assert.equal(h.env.DB.sqlite.prepare('SELECT total_changes() AS n').get().n,changes);
  for(const query of ['summary=0','summary=true','summary=1&after=','summary=1&after=-1','summary=1&after=1.5','summary=1&after=9007199254740992','summary=1&after=01','after=1','summary=1&summary=1','limit=1000'])assert.equal((await h.call('/world/chat?'+query,a)).error.code,'INVALID_CHAT_QUERY',query);
});

test('authors and each current operator may delete, other players cannot, and every reader receives the tombstone',async t=>{
  const h=setup(t),{main,sub,third}=await h.operators(),author=await h.register('投稿者'),other=await h.register('見学者');
  const posts=[];
  for(let index=0;index<4;index++){posts.push(ok(await h.post(author,'削除前の本文'+index)).message);h.advance(2000);}
  assert.equal((await h.call('/world/chat/'+posts[0].id,other,'DELETE')).error.code,'CHAT_DELETE_FORBIDDEN');
  assert(ok(await h.call('/world/chat',author)).messages.every(message=>message.canDelete));
  for(const actor of [main,sub,third])assert(ok(await h.call('/world/chat',actor)).messages.every(message=>message.canDelete));
  for(const [index,actor] of [main,sub,third,author].entries()){
    const post=posts[index],deleted=ok(await h.call('/world/chat/'+post.id,actor,'DELETE'));
    assert.equal(deleted.message.text,null);assert.equal(deleted.message.deletedAt,Date.now());assert.equal(deleted.message.canDelete,false);
    assert(!JSON.stringify(deleted).includes(post.text));assert.deepEqual(Object.keys(deleted.message).sort(),MESSAGE_KEYS);
    const stored=h.env.DB.sqlite.prepare('SELECT * FROM world_chat_messages WHERE id=?').get(post.id);assert.equal(stored.body,post.text);assert.equal(stored.deleted_by,actor.id);
    h.advance(100);assert.deepEqual(ok(await h.call('/world/chat/'+post.id,actor,'DELETE')).message,deleted.message);
    assert.deepEqual(ok(await h.call('/world/chat/'+post.id,author,'DELETE')).message,deleted.message);
    assert.equal((await h.call('/world/chat/'+post.id,other,'DELETE')).status,403);
  }
  for(const reader of [author,other,main,sub,third])assert(ok(await h.call('/world/chat',reader)).messages.every(message=>message.text===null&&message.deletedAt!==null&&!message.canDelete));
  assert.equal(ok(await h.call('/world/chat?summary=1&after=0',other)).unreadCount,0);
  for(const id of ['0','-1','9007199254740992','9999','bad'])assert.equal((await h.call('/world/chat/'+id,author,'DELETE')).error.code,'CHAT_MESSAGE_NOT_FOUND');
});

test('a queued moderator deletion loses authority immediately when that operator is revoked',{timeout:5000},async t=>{
  const h=setup(t),{main,third}=await h.operators(),author=await h.register('守られる投稿者'),message=ok(await h.post(author,'保持する本文')).message;
  const prepare=h.env.DB.prepare.bind(h.env.DB);let release,signal,held=false;
  const gate=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{signal=resolve;});
  h.env.DB.prepare=sql=>{
    const statement=prepare(sql);
    if(sql.startsWith('UPDATE world_chat_messages SET deleted_at=')&&!held){held=true;const run=statement.run.bind(statement);statement.run=async()=>{signal();await gate;return run();};}
    return statement;
  };
  const pending=h.call('/world/chat/'+message.id,third,'DELETE');await ready;h.env.DB.prepare=prepare;
  try{ok(await h.revoke(main,third));}finally{release();}
  assert.equal((await pending).error.code,'CHAT_DELETE_FORBIDDEN');
  const stored=h.env.DB.sqlite.prepare('SELECT * FROM world_chat_messages WHERE id=?').get(message.id);assert.equal(stored.deleted_at,null);assert.equal(stored.deleted_by,null);assert.equal(stored.body,message.text);
  assert.equal(ok(await h.call('/world/chat',third)).messages[0].canDelete,false);
  assert.equal((await h.call('/world/chat/'+message.id,third,'DELETE')).status,403);
});

test('the chat migration preserves older data and enforces ownership, body and receipt constraints',()=>{
  const db=new LocalD1({chat:false}).sqlite,ids=['P0000000000000001','P0000000000000002'];
  for(const [index,id] of ids.entries())db.prepare('INSERT INTO players (id,token_hash,name,created_at,updated_at) VALUES (?,?,?,?,?)').run(id,'hash'+index,'以前の人'+index,100,200);
  db.prepare('INSERT INTO admin_owner VALUES (1,?,100)').run(ids[0]);
  db.prepare("INSERT INTO world_rooms (owner_id,map_id,entrance_x,entrance_y,facing,name,template_id,created_at,updated_at) VALUES (?,'forest',4,7,'down','保存した部屋','wings',100,200)").run(ids[0]);
  const before=Object.fromEntries(['players','admin_owner','world_rooms'].map(table=>[table,db.prepare('SELECT * FROM '+table).all()]));
  db.exec(readFileSync(new URL('../drizzle/0009_global_chat.sql',import.meta.url),'utf8'));
  for(const [table,rows] of Object.entries(before))assert.deepEqual(db.prepare('SELECT * FROM '+table).all(),rows);
  const insert=db.prepare('INSERT INTO world_chat_messages (player_id,client_id,body,created_at) VALUES (?,?,?,?)'),clientId=crypto.randomUUID();
  insert.run(ids[0],clientId,'本文',300);assert.throws(()=>insert.run(ids[0],clientId,'再送',300),/UNIQUE/);insert.run(ids[1],clientId,'別の人',300);
  for(const text of ['', 'あ'.repeat(301)])assert.throws(()=>insert.run(ids[0],crypto.randomUUID(),text,300),/CHECK/);
  assert.throws(()=>insert.run('P0000000000000003',crypto.randomUUID(),'本人不明',300),/FOREIGN KEY/);
  assert.throws(()=>db.prepare('UPDATE world_chat_messages SET deleted_at=400 WHERE id=1').run(),/CHECK/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
});
