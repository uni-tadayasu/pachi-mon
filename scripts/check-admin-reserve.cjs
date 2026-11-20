#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const context=vm.createContext({console});
for(const script of scripts){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  new vm.Script(script[2]);
  if(!context.LT?.Engine)vm.runInContext(script[2],context);
}
const {Engine,DATA:D,AdminReserveRules:rules}=context.LT,copy=value=>JSON.parse(JSON.stringify(value));
const PLAYER='P0123456789abcdef',OTHER='Pfedcba9876543210';
const roles={main:'komorizen',sub:'shizunaria','sub-sub':'akehomura'};
const common=['floravelle','zeroveil','pearlseria','hyogald','rurigorm'];
function bundle(role='main',playerId=PLAYER){return {version:1,playerId,role,members:[roles[role],...common].map(species=>({grantId:`admin-trained-v64:${role}:${playerId}:${species}`,species,level:100,gender:role==='sub'?'female':'male',heldItem:'trainband',bonusPoints:99}))};}
function addition(role='main',playerId=PLAYER){return {version:2,playerId,role,members:[{grantId:`admin-galdogran-v68:${role}:${playerId}:galdogran`,species:'galdoras',level:100,gender:'male',heldItem:'trainband',bonusPoints:99}]};}
function fresh(){const engine=new Engine();assert(engine.newGame('komori').ok);return engine;}
const all=engine=>[...engine.state.party,...engine.state.storage];

test('all three six-member grants match actual Lv1-to-100 training and go exclusively to reserve',()=>{
  for(const role of Object.keys(roles)){
    const engine=fresh(),grant=bundle(role),before=copy(engine.state.party);
    const result=engine.receiveAdminReserveTeam(grant);
    assert.equal(result.added,6);assert.equal(result.destination,'storage');assert.deepEqual(copy(engine.state.party),before);
    assert.deepEqual(copy(engine.state.storage.map(mon=>mon.species)),[roles[role],...common]);
    for(const mon of engine.state.storage){
      const simulated=fresh(),trained=simulated.makeMonster(mon.species,1),events=[];
      trained.heldItem='trainband';trained.gender=role==='sub'?'female':'male';
      const earned=Array.from({length:99},(_,i)=>simulated.xpToNext(i+1)).reduce((a,b)=>a+b,0);
      simulated.giveXP(trained,earned,events);
      assert.equal(events.filter(event=>event.kind==='level').length,99);
      for(const field of ['level','xp','hp','heldItem','bonusPoints'])assert.equal(mon[field],trained[field],`${role}/${mon.species}/${field}`);
      assert.deepEqual(copy(engine.stats(mon)),copy(simulated.stats(trained)));
      assert.deepEqual(copy(mon.pp),copy(trained.pp));
      assert.equal(engine.allocationInfo(mon).total,297);assert.equal(engine.allocationInfo(mon).free,297);
      assert.equal(mon.shiny,false);assert.equal(engine.genderOf(mon),role==='sub'?'female':'male');
      assert.equal(mon.gender,role==='sub'?'female':'male');
      assert.equal(mon.customStats,undefined);
      assert(engine.state.seen.includes(mon.species));assert(engine.state.caught.includes(mon.species));
    }
    const roundtrip=new Engine(engine.serialize());
    assert.deepEqual(copy(roundtrip.state),copy(engine.state));
    for(const mon of roundtrip.state.storage)assert.equal(roundtrip.genderOf(mon),role==='sub'?'female':'male');
  }
});

test('ordinary genderless and unrelated owned monsters retain their existing rules',()=>{
  const engine=fresh(),ordinary=engine.makeMonster('floravelle',70);
  ordinary.grantId='admin-mythical:legacy';ordinary.gender='female';
  assert.equal(engine.genderOf(ordinary),'none');
  engine.state.storage.push(ordinary);engine.markCaught('floravelle');
  const original=copy(ordinary);assert(engine.receiveAdminReserveTeam(bundle('sub')).ok);
  assert.deepEqual(copy(engine.state.storage[0]),original);
  assert.equal(engine.state.storage.filter(mon=>mon.species==='floravelle').length,2,'new team never replaces the existing Lv70 mythical');
});

test('repeated delivery or restore preserves each existing individual and its custom build',()=>{
  const engine=fresh(),grant=bundle();assert(engine.receiveAdminReserveTeam(grant).ok);
  assert(engine.exchange(-1,0).ok);
  const mon=engine.state.party[1];mon.nickname='もり';mon.hp-=7;mon.pp[D.species[mon.species].moves[0]]--;
  engine.setAllocation(mon,{hp:64,atk:64,def:64,spAtk:64,spDef:41});
  mon.moveOrder=[3,2,1,0];delete mon.heldItem;
  const before=JSON.stringify(engine.state),status=engine.adminReserveTeamStatus(grant);
  assert.equal(status.ownedCount,6);assert.equal(status.missingCount,0);assert.equal(status.members[0].destination,'party');
  for(const options of [{},{restore:true}]){
    assert(engine.receiveAdminReserveTeam(grant,options).alreadyReceived);
    assert.equal(JSON.stringify(engine.state),before);
  }
  const roundtrip=new Engine(engine.serialize());assert.deepEqual(copy(roundtrip.state),copy(engine.state));
});

test('manual restoration replaces only missing received members and does not consume another receipt',()=>{
  const engine=fresh(),grant=bundle('sub');assert(engine.receiveAdminReserveTeam(grant).ok);
  const lost=copy(engine.state.storage[2]),kept=copy(engine.state.storage.filter((_,i)=>i!==2));
  assert(engine.release(2).ok);
  let status=engine.adminReserveTeamStatus(grant);assert.equal(status.restorableCount,1);assert.equal(status.newCount,0);assert.equal(status.ownedCount,5);
  assert(engine.receiveAdminReserveTeam(grant).alreadyReceived);assert.equal(engine.state.storage.length,5,'ordinary sync never undoes a release');
  const receipts=copy(engine.state.giftReceipts),restored=engine.receiveAdminReserveTeam(grant,{restore:true});
  assert.equal(restored.added,1);assert.equal(restored.restored,1);assert.equal(restored.remainingMissing,0);
  assert.deepEqual(copy(engine.state.giftReceipts),receipts);
  assert.deepEqual(copy(engine.state.storage.slice(0,5)),kept);
  const replacement=engine.state.storage[5];assert.equal(replacement.grantId,lost.grantId);assert.notEqual(replacement.uid,lost.uid);
  assert.equal(replacement.gender,'female');assert.equal(engine.allocationInfo(replacement).free,297);
  assert(engine.receiveAdminReserveTeam(grant,{restore:true}).alreadyReceived);assert.equal(engine.state.storage.length,6);
});

test('cleared save can receive the same durable role entitlement again without requiring a new grant',()=>{
  const grant=bundle('sub-sub'),first=fresh();assert(first.receiveAdminReserveTeam(grant).ok);
  const reset=fresh();assert.equal(reset.receiveAdminReserveTeam(grant).added,6);
  assert.deepEqual(reset.state.storage.map(mon=>mon.grantId),first.state.storage.map(mon=>mon.grantId));
  assert.equal(reset.receiveAdminReserveTeam(grant).alreadyReceived,true);
});

test('reserve capacity is checked for all missing members atomically, even with empty party slots',()=>{
  const engine=fresh(),grant=bundle();
  for(let i=0;i<187;i++)engine.state.storage.push(engine.makeMonster('komori',1));
  let before=JSON.stringify(engine.state),result=engine.receiveAdminReserveTeam(grant);
  assert(result.pending);assert.equal(result.requiredSlots,6);assert.equal(result.availableSlots,5);assert.equal(JSON.stringify(engine.state),before);
  engine.state.storage.pop();assert.equal(engine.receiveAdminReserveTeam(grant).added,6);assert.equal(engine.state.storage.length,192);assert.equal(engine.state.party.length,1);
  assert(engine.receiveAdminReserveTeam(grant,{restore:true}).alreadyReceived,'full reserve does not block no-op retries');
  assert(engine.release(191).ok);engine.state.storage.push(engine.makeMonster('komori',1));before=JSON.stringify(engine.state);
  result=engine.receiveAdminReserveTeam(grant,{restore:true});assert(result.pending);assert.equal(result.requiredSlots,1);assert.equal(JSON.stringify(engine.state),before);
});

test('battle, unstarted adventures and receipt limit postpone every addition without mutations',()=>{
  for(const condition of ['unstarted','battle','receipts']){
    const engine=condition==='unstarted'?new Engine():fresh();
    if(condition==='battle')engine.battle={};
    if(condition==='receipts')engine.state.giftReceipts=Array.from({length:9995},(_,i)=>'gift:'+i);
    const before=JSON.stringify(engine.state);assert(engine.receiveAdminReserveTeam(bundle()).pending);assert.equal(JSON.stringify(engine.state),before);
  }
});

test('malformed entitlements cannot introduce a different species, role, player, gender or growth history',()=>{
  const mutations=[g=>g.version=2,g=>g.role='other',g=>g.role=['main'],g=>g.playerId='anyone',g=>g.members.pop(),g=>g.members.reverse(),g=>g.members[0].grantId='admin-trained-v64:main:'+OTHER+':komorizen',g=>g.members[0].species='arvelion',g=>g.members[0].level=99,g=>g.members[1].gender='female',g=>g.members[2].heldItem='everstone',g=>g.members[3].bonusPoints=100];
  for(const mutate of mutations){
    const engine=fresh(),grant=bundle(),before=JSON.stringify(engine.state);mutate(grant);
    assert.throws(()=>rules.normalizeBundle(grant));assert.equal(engine.receiveAdminReserveTeam(grant).ok,false);assert.equal(JSON.stringify(engine.state),before);
  }
});

test('saved member grants reject mismatched or duplicated identity and preserve legitimate 297-point allocations',()=>{
  const engine=fresh();assert(engine.receiveAdminReserveTeam(bundle()).ok);const raw=engine.serialize();
  for(const mutate of [m=>m.gender='female',m=>m.level=99,m=>m.bonusPoints=98,m=>m.species='komori',m=>m.grantId=m.grantId.replace(':main:',':sub:'),m=>m.grantId='admin-trained-v64:main:'+PLAYER+':futo']){
    const bad=copy(raw);mutate(bad.storage[0]);assert.throws(()=>new Engine(bad));
  }
  const duplicate=copy(raw);duplicate.storage.push({...copy(duplicate.storage[0]),uid:'another-uid'});assert.throws(()=>new Engine(duplicate));
  const mon=engine.state.storage[1];engine.setAllocation(mon,{hp:64,atk:64,def:64,spAtk:64,spDef:41});
  assert.equal(new Engine(engine.serialize()).allocationInfo(mon).used,297);
  for(const member of engine.state.storage){delete member.heldItem;assert.equal(context.LT.TradeRules.isEligible(member),false,'recoverable grants use existing nontradeable gift rules');}
  const party=context.LT.KasaiRules.normalizeParty(engine.state.storage);
  assert.equal(party.length,6);assert.equal(party[1].gender,'male');assert.equal(party[1].bonusPoints,99);
});

test('all assigned training points survive level50 battle scaling',()=>{
  vm.runInContext(scripts.find(script=>script[2].includes('deterministic, save-independent rental-team duels'))[2],context);
  const engine=fresh();engine.receiveAdminReserveTeam(bundle('sub'));
  const alloc={hp:64,atk:64,def:64,spAtk:41,spDef:0,speed:64};
  const ids=engine.state.storage.slice(0,3).map(mon=>mon.species),duel=context.LT.Duel.create({mode:'single',teams:[ids,['komori','shizuku','hibana']],seed:7,allocation:[[alloc,alloc,alloc],null]});
  for(const mon of duel.state.teams[0].monsters){assert.equal(mon.level,50);assert.deepEqual(copy(mon.stats),copy(engine.stats({species:mon.species,level:50,alloc})));assert.equal(Object.values(mon.alloc).reduce((a,b)=>a+b),297);}
});

function bridgeHarness({playing=true}={}){
  const engine=fresh(),initial=engine.serialize(),control={raw:JSON.stringify(initial),fail:false,writes:0,events:0,reloads:0,remembered:0};
  const ctx=vm.createContext({Engine,engine,playing,busy:false,storedSave:copy(initial),SAVE_KEY:'save',lastSave:0,
    LT:{Admin:{player:{id:PLAYER,isAdmin:true,adminRole:'main'}}},tradeLocked:()=>false,performance:{now:()=>10},updateAll(){},loadStored(){},
    localStorage:{getItem(){return control.raw;},setItem(key,value){if(control.fail)throw Error('quota');assert.equal(engine.state.storage.length,0,'durable write precedes live adoption');new Engine(JSON.parse(value));control.raw=value;control.writes++;}},
    rememberTradeSave(){control.remembered++;},CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},document:{dispatchEvent(){control.events++;}}});
  const begin=html.indexOf('  function persistGiftMutation(method,...args){'),end=html.indexOf('  LT.playMoveSound=',begin);
  vm.runInContext(html.slice(begin,end),ctx);
  return {ctx,engine,control,initial,receive:(grant=bundle(),options)=>ctx.persistGiftMutation('receiveAdminReserveTeam',grant,options)};
}

test('bridge checks live role/identity and refuses stale-disk or communication-state writes',()=>{
  for(const blocked of ['nonadmin','wrong-role','wrong-player','no-role','online','trade','stale-disk']){
    const h=bridgeHarness(),owner=h.ctx.LT.Admin.player;
    if(blocked==='nonadmin')owner.isAdmin=false;if(blocked==='wrong-role')owner.adminRole='sub';if(blocked==='wrong-player')owner.id=OTHER;if(blocked==='no-role')delete owner.adminRole;
    if(blocked==='online')h.ctx.LT.onlineActive=true;if(blocked==='trade')h.ctx.LT.localTradeActive=true;
    if(blocked==='stale-disk'){const newer=copy(h.initial);newer.coins++;h.control.raw=JSON.stringify(newer);}
    const before=JSON.stringify(h.engine.state);assert.equal(h.receive().ok,false,blocked);assert.equal(JSON.stringify(h.engine.state),before);assert.equal(h.control.writes,0);assert.equal(h.control.events,0);
  }
});

test('bridge saves atomically, rolls back quota failures, and safely retries from game or title screen',()=>{
  for(const playing of [true,false]){
    const h=bridgeHarness({playing}),before=JSON.stringify(h.engine.state);
    h.control.fail=true;assert(h.receive().pending);assert.equal(JSON.stringify(h.engine.state),before);assert.equal(h.control.raw,JSON.stringify(h.initial));assert.equal(h.control.writes,0);
    h.control.fail=false;const accepted=h.receive();assert.equal(accepted.added,6,JSON.stringify(accepted));assert.equal(h.control.writes,1);assert.equal(h.control.remembered,1);assert.equal(h.ctx.storedSave.storage.length,6);
    assert.equal(h.engine.state.storage.length,playing?6:0);assert(h.receive().alreadyReceived);assert.equal(h.control.writes,1);
  }
});

test('sleeping tabs detect both first delivery and restoration before they can overwrite another tab',()=>{
  const begin=html.indexOf('  let checkedTradeSave='),end=html.indexOf('  function save(',begin),barrier=html.slice(begin,end);
  for(const restore of [false,true]){
    const engine=fresh(),grant=bundle();
    if(restore){engine.receiveAdminReserveTeam(grant);engine.release(2);}
    const before=engine.serialize(),other=new Engine(before);other.receiveAdminReserveTeam(grant,{restore});
    const control={raw:JSON.stringify(before),reloads:0},ctx=vm.createContext({storedSave:copy(before),SAVE_KEY:'save',engine,playing:true,LT:{},pressedDirection:null,directionSource:null,
      localStorage:{getItem:()=>control.raw},toast(){},setTimeout(fn){fn();},window:{location:{reload(){control.reloads++;}}}});
    vm.runInContext(barrier,ctx);assert.equal(vm.runInContext('tradeLocked()',ctx),false);
    control.raw=JSON.stringify(other.serialize());assert.equal(vm.runInContext('tradeLocked()',ctx),true);assert.equal(control.reloads,1);
    assert.equal(vm.runInContext('tradeLocked()',ctx),true);assert.equal(control.reloads,1);
  }
});

test('a normalized older save can receive the reserve team without a false stale-tab warning',()=>{
  const h=bridgeHarness({playing:false});
  const older=copy(h.initial);delete older.giftReceipts;
  h.control.raw=JSON.stringify(Object.fromEntries(Object.entries(older).reverse()));
  const outcome=h.receive();assert.equal(outcome.added,6,JSON.stringify(outcome));assert.equal(h.control.writes,1);
});

test('the separate Galdoras grant trains one male per role and leaves every v64 individual unchanged',()=>{
  for(const role of Object.keys(roles)){
    const engine=fresh();assert.equal(engine.receiveAdminReserveTeam(bundle(role)).added,6);
    engine.state.storage[0].nickname='相棒';engine.state.storage[1].moveOrder=[3,2,1,0];
    engine.setAllocation(engine.state.storage[2],{hp:64,atk:64,def:64,spAtk:64,spDef:41});
    delete engine.state.storage[3].heldItem;
    const existing=copy(engine.state.storage),party=copy(engine.state.party),grant=addition(role);
    assert.equal(engine.adminReserveTeamStatus(grant).total,1);
    assert.equal(engine.receiveAdminReserveTeam(grant).added,1);
    assert.deepEqual(copy(engine.state.storage.slice(0,6)),existing);assert.deepEqual(copy(engine.state.party),party);
    const mon=engine.state.storage[6],simulated=fresh(),trained=simulated.makeMonster('galdoras',1),events=[];
    trained.heldItem='trainband';trained.gender='male';
    simulated.giveXP(trained,Array.from({length:99},(_,i)=>simulated.xpToNext(i+1)).reduce((a,b)=>a+b,0),events);
    assert.equal(events.filter(event=>event.kind==='level').length,99);
    for(const field of ['level','xp','hp','heldItem','bonusPoints'])assert.equal(mon[field],trained[field],`${role}/${field}`);
    assert.deepEqual(copy(engine.stats(mon)),copy(simulated.stats(trained)));assert.deepEqual(copy(mon.pp),copy(trained.pp));
    assert.equal(engine.genderOf(mon),'male');assert.equal(engine.allocationInfo(mon).free,297);
    assert.equal(mon.gender,'male');assert.equal(mon.shiny,false);assert.equal(mon.customStats,undefined);
    assert.equal(new Set(all(engine).map(mon=>mon.uid)).size,all(engine).length);
    assert.deepEqual(copy(new Engine(engine.serialize()).state),copy(engine.state));
    if(role==='sub')assert(existing.every(member=>member.gender==='female'));
  }
});

test('Galdoras retry preserves its UID and build; explicit recovery restores only that missing individual',()=>{
  const engine=fresh(),grant=addition('sub');engine.receiveAdminReserveTeam(bundle('sub'));engine.receiveAdminReserveTeam(grant);
  const mon=engine.state.storage[6];mon.nickname='いわ';mon.moveOrder=[3,1,0,2];mon.heldItem='everpebble';
  engine.setAllocation(mon,{hp:64,atk:64,def:64,spAtk:64,spDef:41});
  assert(engine.exchange(-1,6).ok);
  const before=JSON.stringify(engine.state);
  for(const options of [{},{restore:true}]){assert(engine.receiveAdminReserveTeam(grant,options).alreadyReceived);assert.equal(JSON.stringify(engine.state),before);}
  assert.deepEqual(copy(new Engine(engine.serialize()).state),copy(engine.state));
  assert(engine.exchange(1,0).ok); // Put the added monster back into reserve.
  const at=engine.state.storage.findIndex(member=>member.grantId===mon.grantId);assert(at>=0);
  assert(engine.release(at).ok);
  const oldAt=engine.state.storage.findIndex(member=>member.grantId.startsWith('admin-trained-v64:'));
  assert(engine.release(oldAt).ok); // A missing v64 member is deliberately not part of this recovery.
  const kept=copy(engine.state),receipts=copy(engine.state.giftReceipts);
  assert(engine.receiveAdminReserveTeam(grant).alreadyReceived);assert.deepEqual(copy(engine.state),kept);
  const outcome=engine.receiveAdminReserveTeam(grant,{restore:true});assert.equal(outcome.added,1);assert.equal(outcome.restored,1);
  assert.deepEqual(copy(engine.state.giftReceipts),receipts);assert.deepEqual(copy(engine.state.storage.slice(0,-1)),kept.storage);
  assert.deepEqual(copy(engine.state.party),kept.party);
  const replacement=engine.state.storage.at(-1);assert.equal(replacement.grantId,mon.grantId);assert.notEqual(replacement.uid,mon.uid);
  assert.equal(replacement.gender,'male');assert.equal(replacement.heldItem,'trainband');assert.equal(engine.allocationInfo(replacement).free,297);
  assert.equal(engine.adminReserveTeamStatus(bundle('sub')).missingCount,1);
});

test('Galdoras delivery remains atomic under full reserve, battle, unopened save and receipt limits',()=>{
  for(const condition of ['full','battle','unstarted','receipts']){
    const engine=condition==='unstarted'?new Engine():fresh();
    if(condition==='full')for(let i=0;i<192;i++)engine.state.storage.push(engine.makeMonster('komori',1));
    if(condition==='battle')engine.battle={};
    if(condition==='receipts')engine.state.giftReceipts=Array.from({length:10000},(_,i)=>'gift:'+i);
    const before=JSON.stringify(engine.state),result=engine.receiveAdminReserveTeam(addition());
    assert.equal(result.pending,true,condition);assert.equal(JSON.stringify(engine.state),before);
  }
});

test('Galdoras grants and saves reject another species, duplicate receipt, female or altered growth',()=>{
  for(const mutate of [g=>g.version=1,g=>g.members.push(copy(g.members[0])),g=>g.members[0].species='komori',g=>g.members[0].gender='female',g=>g.members[0].level=99,g=>g.members[0].bonusPoints=100,g=>g.members[0].heldItem='everstone',g=>g.members[0].grantId=g.members[0].grantId.replace('v68','v64'),g=>g.members[0].grantId=g.members[0].grantId.replace(':main:',':sub:')]){
    const engine=fresh(),grant=addition(),before=JSON.stringify(engine.state);mutate(grant);
    assert.throws(()=>rules.normalizeBundle(grant));assert.equal(engine.receiveAdminReserveTeam(grant).ok,false);assert.equal(JSON.stringify(engine.state),before);
  }
  const engine=fresh();engine.receiveAdminReserveTeam(addition());const raw=engine.serialize();
  for(const mutate of [m=>m.gender='female',m=>m.level=99,m=>m.bonusPoints=98,m=>m.species='komori',m=>m.grantId=m.grantId.replace(':galdogran',':futo')]){
    const bad=copy(raw);mutate(bad.storage[0]);assert.throws(()=>new Engine(bad));
  }
  const duplicate=copy(raw);duplicate.storage.push({...copy(duplicate.storage[0]),uid:'another-galdogran'});assert.throws(()=>new Engine(duplicate));
});

test('the Galdoras bridge retains durable-write ordering, role checks, battle and cross-tab barriers',()=>{
  for(const blocked of ['nonadmin','wrong-role','wrong-player','online','trade','live','battle','stale-disk']){
    const h=bridgeHarness(),owner=h.ctx.LT.Admin.player;
    if(blocked==='nonadmin')owner.isAdmin=false;if(blocked==='wrong-role')owner.adminRole='sub';if(blocked==='wrong-player')owner.id=OTHER;
    if(blocked==='online')h.ctx.LT.onlineActive=true;if(blocked==='trade')h.ctx.LT.localTradeActive=true;
    if(blocked==='live')h.ctx.LT.KasaiLive={isActive:()=>true};if(blocked==='battle')h.engine.battle={};
    if(blocked==='stale-disk'){const newer=copy(h.initial);newer.coins++;h.control.raw=JSON.stringify(newer);}
    const before=JSON.stringify(h.engine.state);assert.equal(h.receive(addition()).ok,false,blocked);assert.equal(JSON.stringify(h.engine.state),before);assert.equal(h.control.writes,0);
  }
  for(const playing of [true,false]){
    const h=bridgeHarness({playing});h.control.fail=true;assert(h.receive(addition()).pending);assert.equal(h.control.writes,0);
    h.control.fail=false;assert.equal(h.receive(addition()).added,1);assert.equal(h.control.writes,1);assert.equal(h.control.remembered,1);
    assert(h.receive(addition()).alreadyReceived);assert.equal(h.control.writes,1);
    assert.equal(h.ctx.storedSave.storage[0].species,'galdoras');
  }
});


const legacySave=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/v69-stone-leader-save.json'),'utf8'));
test('v68/v69 received forms and unchanged entitlement IDs suppress duplicate delivery for every role',()=>{
  for(const role of Object.keys(roles))for(const removeReceipts of [false,true]){
    const raw=copy(legacySave);if(removeReceipts)raw.giftReceipts=[];
    const engine=new Engine(raw),grant=addition(role),oldPayload=copy(grant);oldPayload.members[0].species='galdogran';
    const member=all(engine).find(mon=>mon.grantId===grant.members[0].grantId),before=copy(engine.state);
    assert.equal(member.species,'galdoras');assert.equal(engine.adminReserveTeamStatus(grant).ownedCount,1);
    assert.deepEqual(copy(rules.normalizeBundle(oldPayload)),grant,'A pending old-backend payload receives the same canonical entitlement');
    for(const payload of [grant,oldPayload])for(const options of [{},{restore:true}]){
      const result=engine.receiveAdminReserveTeam(payload,options);assert(result.alreadyReceived);assert.equal(result.added,0);
      assert.deepEqual(copy(engine.state),before,'A received individual keeps UID, nickname, allocation, item, move order and PP');
    }
    assert.equal(engine.state.giftReceipts.filter(id=>id===member.grantId).length,1);
    assert.deepEqual(copy(new Engine(engine.serialize()).state),before);
  }
});

test('an old receipt restores only its missing canonical Galdoras and keeps the original six intact',()=>{
  for(const role of Object.keys(roles)){
    const raw=copy(legacySave),grant=addition(role),at=raw.storage.findIndex(mon=>mon.grantId===grant.members[0].grantId),missing=raw.storage.splice(at,1)[0];
    const engine=new Engine(raw);assert.equal(engine.receiveAdminReserveTeam(bundle(role)).added,6);
    const before=copy(engine.state);assert(engine.receiveAdminReserveTeam(grant).alreadyReceived);assert.deepEqual(copy(engine.state),before);
    assert.equal(engine.adminReserveTeamStatus(grant).restorableCount,1);
    const result=engine.receiveAdminReserveTeam(grant,{restore:true});assert.equal(result.added,1);assert.equal(result.restored,1);
    const restored=engine.state.storage.at(-1);assert.equal(restored.species,'galdoras');assert.equal(restored.grantId,missing.grantId);assert.notEqual(restored.uid,missing.uid);
    assert.equal(restored.level,100);assert.equal(restored.gender,'male');assert.equal(restored.heldItem,'trainband');assert.equal(engine.allocationInfo(restored).free,297);
    assert.deepEqual(copy(engine.state.storage.slice(0,-1)),before.storage);assert.deepEqual(copy(engine.state.party),before.party);
    assert.deepEqual(copy(engine.state.giftReceipts),before.giftReceipts);
    if(role==='sub')assert(engine.state.storage.filter(mon=>mon.grantId?.startsWith('admin-trained-v64:')).every(mon=>mon.gender==='female'));
  }
});

test('changing the historical entitlement prefix or final species ID cannot create a second grant',()=>{
  for(const mutate of [id=>id.replace('v68','v70'),id=>id.replace(/:galdogran$/,':galdoras')]){
    const engine=new Engine(copy(legacySave)),grant=addition(),before=copy(engine.state);grant.members[0].grantId=mutate(grant.members[0].grantId);
    assert.throws(()=>rules.normalizeBundle(grant));assert.equal(engine.receiveAdminReserveTeam(grant).ok,false);assert.deepEqual(copy(engine.state),before);
  }
});
