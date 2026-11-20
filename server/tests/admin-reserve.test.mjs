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
    for(const name of ['0000_admin.sql','0001_trades.sql','0002_world.sql','0003_rooms.sql','0004_kasai_party.sql','0005_kasai_live.sql','0006_sub_admin.sql','0007_third_admin.sql','0008_room_templates.sql','0009_global_chat.sql','0010_ranked.sql'])this.sqlite.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
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
function expectedAddition(playerId,role){return {version:2,playerId,role,members:[{grantId:`admin-galdogran-v68:${role}:${playerId}:galdogran`,species:'lunaxion',level:100,gender:'none',heldItem:'trainband',bonusPoints:99}]};}
function partyFor(bundle){
  const LT=createReplayRuntime(),engine=new LT.Engine();
  return bundle.members.map((member,index)=>{
    const mon=engine.makeMonster(member.species,100);
    Object.assign(mon,{grantId:member.grantId,gender:member.gender,heldItem:'trainband',bonusPoints:99,xp:0});
    if(member.gender==='none')delete mon.gender;
    mon.uid=`reserve-${bundle.role}-${index}`;
    return mon;
  });
}
const retiredForms={galdo:'lunax',galdoran:'lunax',galdoras:'lunaxion',galdogran:'lunaxion'};
const retiredMoves={galdoras_crown:'lunax_crescent',galdoras_fault:'lunax_nova',galdoras_bastion:'lunax_aegis',galdoras_mend:'lunax_renew'};
function expectedMigrated(mon){
  const next={...copy(mon),species:retiredForms[mon.species]||mon.species,
    pp:Object.fromEntries(Object.entries(mon.pp).map(([id,value])=>[retiredMoves[id]||id,value]))};
  if(['lunax','lunaxion'].includes(next.species))delete next.gender;
  next.hp=Math.min(next.hp,new (createReplayRuntime().Engine)().stats(next).hp);
  return next;
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

test('the Lunaxion entitlement is separate, stable, genderless for every current role and private to that role',async()=>{
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

test('Lunaxion can enter an authenticated saved battle party with its chosen build alongside old members',async()=>{
  const h=setup(),actors=await h.actors();
  for(const role of ['main','sub','sub-sub']){
    const entitlements=await h.call('/me',actors[role]),party=partyFor(entitlements.adminReserveAddition);
    party[0].uid='addition-'+role;party[0].nickname='がん';party[0].moveOrder=[3,1,0,2];delete party[0].heldItem;
    party[0].alloc={hp:64,atk:64,def:64,spAtk:64,spDef:41};
    party.push(...partyFor(entitlements.adminReserveTeam).slice(0,5));
    const result=await h.call('/world/kasai/party',actors[role],'POST',{party});assert.equal(result.status,200,JSON.stringify(result));
    assert.equal(result.party[0].species,'lunaxion');assert.equal(result.party[0].gender,undefined);assert.equal(result.party[0].bonusPoints,99);
    for(const key of ['uid','nickname','moveOrder','alloc','grantId'])assert.deepEqual(result.party[0][key],party[0][key]);
    assert.equal(result.party[0].heldItem,undefined);
    if(role==='sub')assert(result.party.slice(1).every(mon=>mon.gender==='female'));
  }
});

test('Lunaxion cannot claim another recipient or role and rejects changed grant growth before a save write',async()=>{
  const h=setup(),actors=await h.actors(),party=partyFor(expectedAddition(actors.main.id,'main'));
  for(const actor of [actors.sub,actors['sub-sub'],actors.visitor]){
    const result=await h.call('/world/kasai/party',actor,'POST',{party});assert.equal(result.status,403,JSON.stringify(result));
  }
  const wrongRole=partyFor(expectedAddition(actors.main.id,'sub'));
  assert.equal((await h.call('/world/kasai/party',actors.main,'POST',{party:wrongRole})).error.code,'KASAI_PARTY_NOT_OWNED');
  for(const mutate of [m=>m.level=99,m=>m.bonusPoints=100,m=>m.species='komori']){
    const invalid=copy(party);mutate(invalid[0]);
    const result=await h.call('/world/kasai/party',actors.main,'POST',{party:invalid});assert([400,403].includes(result.status),JSON.stringify(result));
  }
  assert.equal((await h.call('/world/kasai/party',actors.main)).party,null);
  for(const gender of ['male','female','none']){
    const oldGender=copy(party);oldGender[0].gender=gender;
    const normalized=await h.call('/world/kasai/party',actors.main,'POST',{party:oldGender});
    assert.equal(normalized.status,200,JSON.stringify(normalized));assert.equal(normalized.party[0].gender,undefined,'Only the canonical lunar lineage loses historical gender fields');
  }
});


test('legacy owned forms normalize before server ownership checks and preserve their saved build',async()=>{
  const h=setup(),actors=await h.actors(),fixture=JSON.parse(readFileSync(new URL('../../scripts/fixtures/v69-stone-leader-save.json',import.meta.url),'utf8'));
  for(const role of ['main','sub','sub-sub']){
    const member=expectedAddition(actors[role].id,role).members[0],legacy=copy(fixture.storage.find(mon=>mon.grantId?.includes(':'+role+':')));
    legacy.grantId=member.grantId;legacy.nickname='引継';legacy.moveOrder=[3,1,0,2];legacy.pp.galdoras_crown=1;delete legacy.heldItem;
    const result=await h.call('/world/kasai/party',actors[role],'POST',{party:[legacy]});assert.equal(result.status,200,JSON.stringify(result));
    assert.deepEqual(result.party[0],expectedMigrated(legacy));
    assert.deepEqual((await h.call('/world/kasai/party',actors[role])).party,result.party);
    const forged=copy(legacy);forged.grantId=forged.grantId.replace(/:galdogran$/,':galdoras');
    assert.equal((await h.call('/world/kasai/party',actors[role],'POST',{party:[forged]})).status,400);
    assert.deepEqual((await h.call('/world/kasai/party',actors[role])).party,result.party,'Rejected IDs do not overwrite the valid migrated party');
  }
});

test('previously registered v69 admin parties are read as Lunaxion without deleting their saved identity',async()=>{
  const h=setup(),actors=await h.actors(),fixture=JSON.parse(readFileSync(new URL('../../scripts/fixtures/v69-stone-leader-save.json',import.meta.url),'utf8'));
  for(const role of ['main','sub','sub-sub']){
    const legacy=copy(fixture.storage.find(mon=>mon.grantId?.includes(':'+role+':')));legacy.grantId=expectedAddition(actors[role].id,role).members[0].grantId;
    const stored=JSON.stringify([legacy]);h.env.DB.sqlite.prepare('INSERT INTO kasai_parties (player_id,party_json,updated_at) VALUES (?,?,?)').run(actors[role].id,stored,12345);
    const result=await h.call('/world/kasai/party',actors[role]);assert.equal(result.status,200,JSON.stringify(result));
    assert.equal(result.party[0].species,'lunaxion');assert.equal(result.party[0].uid,legacy.uid);assert.equal(result.party[0].grantId,legacy.grantId);
    assert.equal(result.updatedAt,12345);assert.equal(h.env.DB.sqlite.prepare('SELECT party_json FROM kasai_parties WHERE player_id=?').get(actors[role].id).party_json,stored,'Read-time normalization preserves the historical record');
  }
});


test('both new owned forms can be registered independently but the normal form cannot impersonate the final-form entitlement',async()=>{
  const h=setup(),actors=await h.actors(),LT=createReplayRuntime(),engine=new LT.Engine();
  const party=['lunax','lunaxion'].map((species,index)=>{const mon=engine.makeMonster(species,100);mon.uid='lineage-stage-'+index;mon.nickname='新形態'+index;mon.moveOrder=[3,1,0,2];mon.pp.lunax_crescent=1;return mon;});
  const accepted=await h.call('/world/kasai/party',actors.main,'POST',{party});assert.equal(accepted.status,200,JSON.stringify(accepted));
  assert.deepEqual(accepted.party,party,'Registering owned forms does not automatically evolve them');
  const member=expectedAddition(actors.main.id,'main').members[0];
  for(const species of ['lunax','galdo','galdoran']){
    const forged=partyFor(expectedAddition(actors.main.id,'main'))[0];forged.species=species;forged.hp=1;forged.grantId=member.grantId;
    assert.equal((await h.call('/world/kasai/party',actors.main,'POST',{party:[forged]})).status,400);
    assert.deepEqual((await h.call('/world/kasai/party',actors.main)).party,party);
  }
  assert.deepEqual((await h.call('/me',actors.main)).adminReserveAddition,expectedAddition(actors.main.id,'main'));
});

test('all four retired owned species and their exact spent PP migrate through authenticated server validation',async()=>{
  const h=setup(),actors=await h.actors(),fixture=JSON.parse(readFileSync(new URL('../../scripts/fixtures/v73-retired-line-save.json',import.meta.url),'utf8'));
  const party=[...fixture.party,...fixture.storage],original=copy(party),expected=party.map(expectedMigrated);
  assert.deepEqual(party.map(mon=>mon.species),['galdo','galdoran','galdoras','galdogran']);
  const result=await h.call('/world/kasai/party',actors.main,'POST',{party});
  assert.equal(result.status,200,JSON.stringify(result));assert.deepEqual(result.party,expected);
  assert.deepEqual(party,original,'Normalization does not mutate the submitted legacy data');
  assert.deepEqual((await h.call('/world/kasai/party',actors.main)).party,expected);
  assert.deepEqual(result.party[0].pp,{lunax_crescent:1,lunax_nova:0,lunax_aegis:3,lunax_renew:2});
  assert.equal(result.party[0].hp,0,'Migration cannot revive a fainted individual');
  for(const mutate of [
    mon=>mon.pp.lunax_crescent=mon.pp.galdoras_crown,
    mon=>mon.pp.galdoras_fault=6,
    mon=>mon.pp.galdoras_crown=-1,
    mon=>delete mon.pp.galdoras_mend,
    mon=>mon.customMoves=['lunax_crescent','lunax_nova','lunax_aegis','lunax_renew']
  ]){
    const forged=copy(original);mutate(forged[1]);
    const rejected=await h.call('/world/kasai/party',actors.main,'POST',{party:forged});
    assert.equal(rejected.status,400,JSON.stringify(rejected));
    assert.deepEqual((await h.call('/world/kasai/party',actors.main)).party,expected,'Rejected migrated data cannot overwrite the saved roster');
  }
});

test('the worker replay catalog exposes only the new exclusive Super lineage and preserves ordinary trade restrictions',()=>{
  const LT=createReplayRuntime(),D=LT.DATA,engine=new LT.Engine();
  assert.equal(D.elements.super.name,'超');
  for(const id of ['lunax','lunaxion']){
    const species=D.species[id];assert(species.hiddenDex&&species.specialOnly);
    assert.deepEqual(LT.TypeSystem.of(species),['super']);
    assert(D.genderless.includes(id));assert.equal(LT.genderOf(engine.makeMonster(id,100)),'none');
    assert.deepEqual(species.moves,['lunax_crescent','lunax_nova','lunax_aegis','lunax_renew']);
    assert(species.moves.every(move=>D.moves[move].element==='super'));
    assert.throws(()=>engine.tradeMonster(engine.makeMonster(id,100)),/交換/);
  }
  for(const id of Object.keys(retiredForms))assert.equal(D.species[id],undefined);
  for(const id of Object.keys(retiredMoves))assert.equal(D.moves[id],undefined);
});
