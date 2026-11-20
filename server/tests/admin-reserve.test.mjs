import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../server.mjs';
import {createReplayRuntime} from '../kasai-replay.mjs';

const SECRET='admin-reserve-test-key-not-for-production';
const common=['floravelle','zeroveil','pearlseria','hyogald','rurigorm'];
const starters={main:'komorizen',sub:'shizunaria','sub-sub':'akehomura'};
const copy=value=>JSON.parse(JSON.stringify(value));
class LocalD1 {
  constructor(){
    this.sqlite=new DatabaseSync(':memory:');this.sqlite.exec('PRAGMA foreign_keys=ON;');
    for(const name of ['0000_admin.sql','0001_trades.sql','0002_world.sql','0003_rooms.sql','0004_kasai_party.sql','0005_kasai_live.sql','0006_sub_admin.sql','0007_third_admin.sql'])this.sqlite.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
  }
  prepare(sql){const database=this;return {values:[],bind(...values){this.values=values;return this;},execute(){return {results:database.sqlite.prepare(sql).all(...this.values).map(row=>({...row})),success:true,meta:{changes:database.sqlite.prepare('SELECT changes() AS n').get().n}};},async first(){return this.execute().results[0]||null;},async all(){return this.execute();},async run(){return this.execute();}};}
  async batch(statements){this.sqlite.exec('BEGIN IMMEDIATE;');try{const results=statements.map(statement=>statement.execute());this.sqlite.exec('COMMIT;');return results;}catch(error){this.sqlite.exec('ROLLBACK;');throw error;}}
}
function setup(){
  const env={DB:new LocalD1(),ADMIN_CLAIM_KEY:SECRET,DUEL_SIGNING_KEY:'admin-reserve-test-signing-key-at-least-thirty-two-characters'};let ip=0;
  const call=async(path,actor=null,method='GET',body)=>{
    const response=await worker.fetch(new Request('https://admin-reserve.example/api'+path,{method,headers:{Origin:'https://uni-tadayasu.github.io','Content-Type':'application/json','CF-Connecting-IP':`192.0.2.${++ip}`,...(actor?{Authorization:'Bearer '+actor.token}:{})},body:body===undefined?undefined:JSON.stringify(body)}),env);
    const data=await response.json();assert(!JSON.stringify(data).includes(SECRET));return {status:response.status,...data};
  };
  const register=async(name='候補')=>{const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),result=await call('/register',null,'POST',{name,token});assert.equal(result.status,200);return {token,...result.player};};
  const appoint=async(main,candidate,role)=>{const result=await call('/admin/devices',main,'POST',{playerId:candidate.id,role,confirmed:true});assert.equal(result.status,200);return result.devices.find(device=>device.playerId===candidate.id);};
  const actors=async()=>{
    const main=await register('カサイ'),sub=await register('サカイ'),third=await register('イサカ'),visitor=await register('一般');
    assert.equal((await call('/admin/claim',main,'POST',{key:SECRET})).status,200);
    await appoint(main,sub,'sub');await appoint(main,third,'sub-sub');return {main,sub,'sub-sub':third,visitor};
  };
  return {env,call,register,appoint,actors};
}
function expectedTeam(playerId,role){return {version:1,playerId,role,members:[starters[role],...common].map(species=>({grantId:`admin-trained-v64:${role}:${playerId}:${species}`,species,level:100,gender:role==='sub'?'female':'male',heldItem:'trainband',bonusPoints:99}))};}
function expectedAddition(playerId,role){return {version:2,playerId,role,members:[{grantId:`admin-galdogran-v68:${role}:${playerId}:galdogran`,species:'galdogran',level:100,gender:'male',heldItem:'trainband',bonusPoints:99}]};}
function partyFor(bundle){
  const LT=createReplayRuntime(),engine=new LT.Engine();
  return bundle.members.map((member,index)=>{
    const mon=engine.makeMonster(member.species,100);
    Object.assign(mon,{grantId:member.grantId,gender:member.gender,heldItem:'trainband',bonusPoints:99,xp:0});
    mon.uid=`reserve-${bundle.role}-${index}`;
    return mon;
  });
}

test('each authenticated admin role receives exactly its requested reserve entitlement',async()=>{
  const h=setup(),actors=await h.actors();
  assert.equal((await h.call('/me')).status,401);
  assert.equal((await h.call('/me',actors.visitor)).adminReserveTeam,null);
  for(const role of ['main','sub','sub-sub']){
    const result=await h.call('/me',actors[role]);
    assert.equal(result.status,200);assert.equal(result.player.adminRole,role);
    assert.deepEqual(result.adminReserveTeam,expectedTeam(actors[role].id,role));
    assert.equal(new Set(result.adminReserveTeam.members.map(member=>member.grantId)).size,6);
    assert.equal(result.initialCompanions.length,2,'Existing Lv70 initial companions remain separate');
    assert(result.grants.every(grant=>grant.species==='futo'),'The Futo inbox keeps its original payload shape');
  }
  const attempts=await h.call('/me?playerId='+actors.main.id+'&role=main',actors.visitor);
  assert.equal(attempts.player.id,actors.visitor.id);assert.equal(attempts.adminReserveTeam,null,'The query cannot select another recipient or role');
});

test('repeated and paged reserve reads are stable and create no additional gift records',async()=>{
  const h=setup(),actors=await h.actors(),before=Object.fromEntries(['grants','grant_batches','kasai_parties'].map(table=>[table,h.env.DB.sqlite.prepare('SELECT * FROM '+table).all()]));
  for(const role of ['main','sub','sub-sub'])for(const path of ['/me','/me?limit=1','/me?limit=1&cursor=9999'])assert.deepEqual((await h.call(path,actors[role])).adminReserveTeam,expectedTeam(actors[role].id,role));
  for(const table of Object.keys(before))assert.deepEqual(h.env.DB.sqlite.prepare('SELECT * FROM '+table).all(),before[table]);
});

test('revocation removes reserve authorization and a changed role receives its own stable roster',async()=>{
  const h=setup(),actors=await h.actors(),devices=await h.call('/admin/devices',actors.main),old=devices.devices.find(device=>device.playerId===actors.sub.id);
  const revoke=await h.call('/admin/devices/revoke',actors.main,'POST',{playerId:actors.sub.id,claimedAt:old.claimedAt,confirmed:true});assert.equal(revoke.status,200);
  assert.equal((await h.call('/me',actors.sub)).adminReserveTeam,null);
  await h.appoint(actors.main,actors.sub,'sub');
  assert.deepEqual((await h.call('/me',actors.sub)).adminReserveTeam,expectedTeam(actors.sub.id,'sub'),'Reinstating a role reuses stable receipts for restoration');
  const registration=(await h.call('/admin/config',actors.main)).adminRegistration;
  assert.equal((await h.call('/admin/release',actors.main,'POST',{confirmed:true,expectedRegistration:registration})).status,200);
  assert.deepEqual((await h.call('/me',actors.sub)).adminReserveTeam,expectedTeam(actors.sub.id,'main'),'Promotion follows the actual registered role');
  assert.equal((await h.call('/me',actors.main)).adminReserveTeam,null);
});

test('all six trained members can be saved for live admin battles with later allocations and changed held items',async()=>{
  const h=setup(),actors=await h.actors();
  for(const role of ['main','sub','sub-sub']){
    const team=(await h.call('/me',actors[role])).adminReserveTeam,party=partyFor(team);
    party[0].alloc={hp:64,atk:64,def:64,spAtk:64,spDef:41};delete party[0].heldItem;party[0].nickname='そだてた';
    const result=await h.call('/world/kasai/party',actors[role],'POST',{party});
    assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.party.length,6);
    assert.deepEqual(result.party.map(mon=>mon.grantId),team.members.map(member=>member.grantId));
    assert.deepEqual(result.party[0].alloc,party[0].alloc);assert.equal(result.party[0].heldItem,undefined);
    assert.equal(result.party[0].nickname,'そだてた');assert(result.party.every(mon=>mon.level===100&&mon.bonusPoints===99&&mon.gender===(role==='sub'?'female':'male')));
  }
});

test('trained members cannot be submitted by another player or with another registered role',async()=>{
  const h=setup(),actors=await h.actors(),mainParty=partyFor(expectedTeam(actors.main.id,'main'));
  for(const actor of [actors.sub,actors['sub-sub'],actors.visitor]){
    const result=await h.call('/world/kasai/party',actor,'POST',{party:mainParty});assert.equal(result.status,403,JSON.stringify(result));
  }
  const wrongRole=partyFor(expectedTeam(actors.main.id,'sub'));
  assert.equal((await h.call('/world/kasai/party',actors.main,'POST',{party:wrongRole})).error.code,'KASAI_PARTY_NOT_OWNED');
  const before=await h.call('/world/kasai/party',actors.main);assert.equal(before.party,null);
  const mutated=[
    mon=>mon.level=99,
    mon=>mon.gender='female',
    mon=>mon.bonusPoints=100
  ];
  for(const mutate of mutated){const party=copy(mainParty);mutate(party[0]);const result=await h.call('/world/kasai/party',actors.main,'POST',{party});assert([400,403].includes(result.status),JSON.stringify(result));}
  assert.equal((await h.call('/world/kasai/party',actors.main)).party,null,'Rejected parties never overwrite the stored roster');
  const overBudget=copy(mainParty);overBudget[0].alloc={hp:64,atk:64,def:64,spAtk:64,spDef:42};
  const normalized=await h.call('/world/kasai/party',actors.main,'POST',{party:overBudget});
  if(normalized.status===200)assert.equal(normalized.party[0].alloc,undefined,'An over-budget allocation must not survive normalization');
  else assert([400,403].includes(normalized.status),JSON.stringify(normalized));
});

test('the Galdogran entitlement is separate, stable, male for every current role and private to that role',async()=>{
  const h=setup(),actors=await h.actors(),before=Object.fromEntries(['grants','grant_batches','kasai_parties'].map(table=>[table,h.env.DB.sqlite.prepare('SELECT * FROM '+table).all()]));
  for(const role of ['main','sub','sub-sub'])for(const path of ['/me','/me?limit=1','/me?limit=1&cursor=9999']){
    const result=await h.call(path,actors[role]);assert.equal(result.status,200);
    assert.deepEqual(result.adminReserveTeam,expectedTeam(actors[role].id,role));
    assert.deepEqual(result.adminReserveAddition,expectedAddition(actors[role].id,role));
    assert(!result.adminReserveTeam.members.some(member=>member.grantId===result.adminReserveAddition.members[0].grantId));
    if(role==='sub')assert(result.adminReserveTeam.members.every(member=>member.gender==='female'));
  }
  assert.equal((await h.call('/me',actors.visitor)).adminReserveAddition,null);
  assert.equal((await h.call('/me?playerId='+actors.main.id+'&role=main',actors.visitor)).adminReserveAddition,null);
  for(const table of Object.keys(before))assert.deepEqual(h.env.DB.sqlite.prepare('SELECT * FROM '+table).all(),before[table]);
  const devices=await h.call('/admin/devices',actors.main),registration=devices.devices.find(device=>device.playerId===actors.sub.id);
  assert.equal((await h.call('/admin/devices/revoke',actors.main,'POST',{playerId:actors.sub.id,claimedAt:registration.claimedAt,confirmed:true})).status,200);
  assert.equal((await h.call('/me',actors.sub)).adminReserveAddition,null);
  await h.appoint(actors.main,actors.sub,'sub');
  assert.deepEqual((await h.call('/me',actors.sub)).adminReserveAddition,expectedAddition(actors.sub.id,'sub'));
});

test('Galdogran can enter an authenticated saved battle party with its chosen build alongside old members',async()=>{
  const h=setup(),actors=await h.actors();
  for(const role of ['main','sub','sub-sub']){
    const entitlements=await h.call('/me',actors[role]),party=partyFor(entitlements.adminReserveAddition);
    party[0].uid='addition-'+role;party[0].nickname='がん';party[0].moveOrder=[3,1,0,2];delete party[0].heldItem;
    party[0].alloc={hp:64,atk:64,def:64,spAtk:64,spDef:41};
    party.push(...partyFor(entitlements.adminReserveTeam).slice(0,5));
    const result=await h.call('/world/kasai/party',actors[role],'POST',{party});assert.equal(result.status,200,JSON.stringify(result));
    assert.equal(result.party[0].species,'galdogran');assert.equal(result.party[0].gender,'male');assert.equal(result.party[0].bonusPoints,99);
    for(const key of ['uid','nickname','moveOrder','alloc','grantId'])assert.deepEqual(result.party[0][key],party[0][key]);
    assert.equal(result.party[0].heldItem,undefined);
    if(role==='sub')assert(result.party.slice(1).every(mon=>mon.gender==='female'));
  }
});

test('Galdogran cannot claim another recipient or role and rejects changed grant growth before a save write',async()=>{
  const h=setup(),actors=await h.actors(),party=partyFor(expectedAddition(actors.main.id,'main'));
  for(const actor of [actors.sub,actors['sub-sub'],actors.visitor]){
    const result=await h.call('/world/kasai/party',actor,'POST',{party});assert.equal(result.status,403,JSON.stringify(result));
  }
  const wrongRole=partyFor(expectedAddition(actors.main.id,'sub'));
  assert.equal((await h.call('/world/kasai/party',actors.main,'POST',{party:wrongRole})).error.code,'KASAI_PARTY_NOT_OWNED');
  for(const mutate of [m=>m.gender='female',m=>m.level=99,m=>m.bonusPoints=100,m=>m.species='galdoras']){
    const invalid=copy(party);mutate(invalid[0]);
    const result=await h.call('/world/kasai/party',actors.main,'POST',{party:invalid});assert([400,403].includes(result.status),JSON.stringify(result));
  }
  assert.equal((await h.call('/world/kasai/party',actors.main)).party,null);
});
