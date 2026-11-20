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
function addition(role='main',playerId=PLAYER){return {version:2,playerId,role,members:[{grantId:`admin-galdogran-v68:${role}:${playerId}:galdogran`,species:'lunaxion',level:100,gender:'none',heldItem:'trainband',bonusPoints:99}]};}
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
      simulated.giveXP(trained,earned,events,{battleParticipation:true});
      assert.equal(events.filter(event=>event.kind==='level').length,99);
      for(const field of ['level','xp','hp','heldItem','bonusPoints','battleGrowth'])assert.equal(mon[field],trained[field],`${role}/${mon.species}/${field}`);
      assert.deepEqual(copy(engine.stats(mon)),copy(simulated.stats(trained)));
      assert.deepEqual(copy(mon.pp),copy(trained.pp));
      assert.equal(engine.allocationInfo(mon).total,297);assert.equal(engine.allocationInfo(mon).free,297);
      assert.equal(mon.shiny,false);assert.equal(engine.genderOf(mon),role==='sub'?'female':'male');
      assert.equal(mon.gender,role==='sub'?'female':'male');
      assert.equal(mon.customStats,undefined);
      assert(engine.state.seen.includes(mon.species));assert(engine.state.caught.includes(mon.species));
    }
    const roundtrip=new Engine(engine.serialize());
    assert.deepEqual(copy(roundtrip.state),copy(engine.serialize()));
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
  const roundtrip=new Engine(engine.serialize());assert.deepEqual(copy(roundtrip.state),copy(engine.serialize()));
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

function bridgeHarness({playing=true,initialSave=null,role='main'}={}){
  const empty=fresh(),initial=initialSave?copy(initialSave):empty.serialize(),engine=playing?new Engine(initial):empty;
  const normalized=new Engine(initial).serialize(),control={raw:JSON.stringify(initial),fail:false,writes:0,events:0,reloads:0,remembered:0,liveBeforeWrite:JSON.stringify(engine.state)};
  const ctx=vm.createContext({Engine,engine,playing,busy:false,storedSave:copy(normalized),SAVE_KEY:'save',lastSave:0,
    LT:{Admin:{player:{id:PLAYER,isAdmin:true,adminRole:role}}},tradeLocked:()=>false,rankedLocked:()=>false,performance:{now:()=>10},updateAll(){},loadStored(){},
    localStorage:{getItem(){return control.raw;},setItem(key,value){if(control.fail)throw Error('quota');assert.equal(JSON.stringify(engine.state),control.liveBeforeWrite,'durable write precedes live adoption');new Engine(JSON.parse(value));control.raw=value;control.writes++;}},
    rememberTradeSave(){control.remembered++;},CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},document:{dispatchEvent(){control.events++;}}});
  const begin=html.indexOf('  function persistGiftMutation(method,...args){'),end=html.indexOf('  LT.playMoveSound=',begin);
  vm.runInContext(html.slice(begin,end),ctx);
  return {ctx,engine,control,initial,receive:(grant=bundle(),options)=>{control.liveBeforeWrite=JSON.stringify(engine.state);return ctx.persistGiftMutation('receiveAdminReserveTeam',grant,options);}};
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

test('the separate Lunaxion grant trains one genderless member per role and leaves every v64 individual unchanged',()=>{
  for(const role of Object.keys(roles)){
    const engine=fresh();assert.equal(engine.receiveAdminReserveTeam(bundle(role)).added,6);
    engine.state.storage[0].nickname='相棒';engine.state.storage[1].moveOrder=[3,2,1,0];
    engine.setAllocation(engine.state.storage[2],{hp:64,atk:64,def:64,spAtk:64,spDef:41});
    delete engine.state.storage[3].heldItem;
    const existing=copy(engine.state.storage),party=copy(engine.state.party),grant=addition(role);
    assert.equal(engine.adminReserveTeamStatus(grant).total,1);
    assert.equal(engine.receiveAdminReserveTeam(grant).added,1);
    assert.deepEqual(copy(engine.state.storage.slice(0,6)),existing);assert.deepEqual(copy(engine.state.party),party);
    const mon=engine.state.storage[6],simulated=fresh(),trained=simulated.makeMonster('lunaxion',1),events=[];
    trained.heldItem='trainband';
    simulated.giveXP(trained,Array.from({length:99},(_,i)=>simulated.xpToNext(i+1)).reduce((a,b)=>a+b,0),events);
    assert.equal(events.filter(event=>event.kind==='level').length,99);
    for(const field of ['level','xp','hp','heldItem','bonusPoints'])assert.equal(mon[field],trained[field],`${role}/${field}`);
    assert.deepEqual(copy(engine.stats(mon)),copy(simulated.stats(trained)));assert.deepEqual(copy(mon.pp),copy(trained.pp));
    assert.equal(engine.genderOf(mon),'none');assert.equal(engine.allocationInfo(mon).free,297);
    assert.equal(mon.gender,undefined);assert.equal(mon.shiny,false);assert.equal(mon.customStats,undefined);
    assert.equal(new Set(all(engine).map(mon=>mon.uid)).size,all(engine).length);
    assert.deepEqual(copy(new Engine(engine.serialize()).state),copy(engine.serialize()));
    if(role==='sub')assert(existing.every(member=>member.gender==='female'));
  }
});

test('Lunaxion retry preserves its UID and build; explicit recovery restores only that missing individual',()=>{
  const engine=fresh(),grant=addition('sub');engine.receiveAdminReserveTeam(bundle('sub'));engine.receiveAdminReserveTeam(grant);
  const mon=engine.state.storage[6];mon.nickname='いわ';mon.moveOrder=[3,1,0,2];mon.heldItem='everpebble';
  engine.setAllocation(mon,{hp:64,atk:64,def:64,spAtk:64,spDef:41});
  assert(engine.exchange(-1,6).ok);
  const before=JSON.stringify(engine.state);
  for(const options of [{},{restore:true}]){assert(engine.receiveAdminReserveTeam(grant,options).alreadyReceived);assert.equal(JSON.stringify(engine.state),before);}
  assert.deepEqual(copy(new Engine(engine.serialize()).state),copy(engine.serialize()));
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
  assert.equal(replacement.gender,undefined);assert.equal(engine.genderOf(replacement),'none');assert.equal(replacement.heldItem,'trainband');assert.equal(engine.allocationInfo(replacement).free,297);
  assert.equal(engine.adminReserveTeamStatus(bundle('sub')).missingCount,1);
});

test('Lunaxion delivery remains atomic under full reserve, battle, unopened save and receipt limits',()=>{
  for(const condition of ['full','battle','unstarted','receipts']){
    const engine=condition==='unstarted'?new Engine():fresh();
    if(condition==='full')for(let i=0;i<192;i++)engine.state.storage.push(engine.makeMonster('komori',1));
    if(condition==='battle')engine.battle={};
    if(condition==='receipts')engine.state.giftReceipts=Array.from({length:10000},(_,i)=>'gift:'+i);
    const before=JSON.stringify(engine.state),result=engine.receiveAdminReserveTeam(addition());
    assert.equal(result.pending,true,condition);assert.equal(JSON.stringify(engine.state),before);
  }
});

test('Lunaxion grants reject a sex assignment and saves reject another species, duplicate receipt or altered growth',()=>{
  for(const mutate of [g=>g.version=1,g=>g.members.push(copy(g.members[0])),g=>g.members[0].species='komori',g=>g.members[0].gender='female',g=>g.members[0].gender='male',g=>g.members[0].level=99,g=>g.members[0].bonusPoints=100,g=>g.members[0].heldItem='everstone',g=>g.members[0].grantId=g.members[0].grantId.replace('v68','v64'),g=>g.members[0].grantId=g.members[0].grantId.replace(':main:',':sub:')]){
    const engine=fresh(),grant=addition(),before=JSON.stringify(engine.state);mutate(grant);
    assert.throws(()=>rules.normalizeBundle(grant));assert.equal(engine.receiveAdminReserveTeam(grant).ok,false);assert.equal(JSON.stringify(engine.state),before);
  }
  const engine=fresh();engine.receiveAdminReserveTeam(addition());const raw=engine.serialize();
  for(const mutate of [m=>m.level=99,m=>m.bonusPoints=98,m=>m.species='komori',m=>m.grantId=m.grantId.replace(':galdogran',':futo')]){
    const bad=copy(raw);mutate(bad.storage[0]);assert.throws(()=>new Engine(bad));
  }
  const duplicate=copy(raw);duplicate.storage.push({...copy(duplicate.storage[0]),uid:'another-galdogran'});assert.throws(()=>new Engine(duplicate));
  for(const gender of ['male','female','none']){
    const historical=copy(raw);historical.storage[0].gender=gender;
    const normalized=new Engine(historical).state.storage[0];assert.equal(normalized.gender,undefined);assert.equal(engine.genderOf(normalized),'none');
  }
});

test('the Lunaxion bridge retains durable-write ordering, role checks, battle and cross-tab barriers',()=>{
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
    assert.equal(h.ctx.storedSave.storage[0].species,'lunaxion');
  }
});


const legacySave=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/v69-stone-leader-save.json'),'utf8'));
test('v68 through v73 received forms and unchanged entitlement IDs suppress duplicate delivery for every role',()=>{
  for(const role of Object.keys(roles))for(const removeReceipts of [false,true])for(const retired of ['galdogran','galdoras'])for(const gender of ['male','female']){
    const raw=copy(legacySave);if(removeReceipts)raw.giftReceipts=[];
    const engine=new Engine(raw),grant=addition(role),oldPayload=copy(grant);oldPayload.members[0].species=retired;oldPayload.members[0].gender=gender;
    const member=all(engine).find(mon=>mon.grantId===grant.members[0].grantId),before=copy(engine.state);
    assert.equal(member.species,'lunaxion');assert.equal(engine.adminReserveTeamStatus(grant).ownedCount,1);
    assert.deepEqual(copy(rules.normalizeBundle(oldPayload)),grant,'A pending old-backend payload receives the same canonical entitlement');
    for(const payload of [grant,oldPayload])for(const options of [{},{restore:true}]){
      const result=engine.receiveAdminReserveTeam(payload,options);assert(result.alreadyReceived);assert.equal(result.added,0);
      assert.deepEqual(copy(engine.state),before,'A received individual keeps UID, nickname, allocation, item, move order and PP');
    }
    assert.equal(engine.state.giftReceipts.filter(id=>id===member.grantId).length,1);
    assert.deepEqual(copy(new Engine(engine.serialize()).state),before);
  }
});

test('an old receipt restores only its missing canonical Lunaxion and keeps the original six intact',()=>{
  for(const role of Object.keys(roles)){
    const raw=copy(legacySave),grant=addition(role),at=raw.storage.findIndex(mon=>mon.grantId===grant.members[0].grantId),missing=raw.storage.splice(at,1)[0];
    const engine=new Engine(raw);assert.equal(engine.receiveAdminReserveTeam(bundle(role)).added,6);
    const before=copy(engine.state);assert(engine.receiveAdminReserveTeam(grant).alreadyReceived);assert.deepEqual(copy(engine.state),before);
    assert.equal(engine.adminReserveTeamStatus(grant).restorableCount,1);
    const result=engine.receiveAdminReserveTeam(grant,{restore:true});assert.equal(result.added,1);assert.equal(result.restored,1);
    const restored=engine.state.storage.at(-1);assert.equal(restored.species,'lunaxion');assert.equal(restored.grantId,missing.grantId);assert.notEqual(restored.uid,missing.uid);
    assert.equal(restored.level,100);assert.equal(restored.gender,undefined);assert.equal(engine.genderOf(restored),'none');assert.equal(restored.heldItem,'trainband');assert.equal(engine.allocationInfo(restored).free,297);
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


test('normal and retired earlier forms cannot reuse the final-form gift and all three role entitlements stay Lunaxion',()=>{
  for(const role of Object.keys(roles)){
    const engine=fresh(),grant=addition(role);assert.equal(engine.receiveAdminReserveTeam(grant).added,1);
    const final=engine.state.storage[0],before=copy(final);assert.equal(final.species,'lunaxion');
    const events=[];engine.giveXP(final,1,events);assert.deepEqual(copy(final),before);assert(!events.some(event=>event.kind==='evolve'));
    for(const species of ['lunax','galdo','galdoran']){
      const invalid=copy(grant);invalid.members[0].species=species;assert.throws(()=>rules.normalizeBundle(invalid));
      const raw=engine.serialize();raw.storage[0].species=species;raw.storage[0].hp=1;assert.throws(()=>new Engine(raw));
    }
    assert.equal(engine.allocationInfo(final).free,297);assert.equal(final.heldItem,'trainband');assert.equal(final.gender,undefined);assert.equal(engine.genderOf(final),'none');
  }
});

test('all four historical species retain individual data and spent PP when saved as the new two-form lineage',()=>{
  const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/v73-retired-line-save.json'),'utf8'));
  const former=[...raw.party,...raw.storage],before=copy(raw),engine=new Engine(raw);
  const expectedSpecies={galdo:'lunax',galdoran:'lunax',galdoras:'lunaxion',galdogran:'lunaxion'};
  const aliases={galdoras_crown:'lunax_crescent',galdoras_fault:'lunax_nova',galdoras_bastion:'lunax_aegis',galdoras_mend:'lunax_renew'};
  assert.deepEqual(former.map(mon=>mon.species),['galdo','galdoran','galdoras','galdogran']);
  for(const old of former){
    const mon=all(engine).find(member=>member.uid===old.uid),expected={...copy(old),species:expectedSpecies[old.species],
      pp:Object.fromEntries(Object.entries(old.pp).map(([id,value])=>[aliases[id],value]))};
    delete expected.gender;
    expected.hp=Math.min(old.hp,engine.stats(expected).hp);
    assert.deepEqual(copy(mon),expected,old.species+': UID, HP, XP, name, shiny, allocations, item and move order survive');
    assert.equal(engine.genderOf(mon),'none','Every retired gender is replaced by the new genderless identity');
  }
  assert.equal(engine.state.party[0].hp,0);assert.equal(engine.state.party[1].species,'lunax');assert.equal(engine.state.party[1].level,49,'Loading a historical earlier form does not grant an automatic evolution');
  assert.deepEqual(copy(raw),before,'The historical fixture is not mutated');
  const stored=engine.serialize();assert.deepEqual(copy(new Engine(stored).state),copy(engine.state));
  for(const mutate of [
    mon=>mon.pp.lunax_crescent=mon.pp.galdoras_crown,
    mon=>mon.pp.galdoras_crown=-1,
    mon=>mon.pp.galdoras_fault=6,
    mon=>delete mon.pp.galdoras_mend
  ]){
    const invalid=copy(before);mutate(invalid.party[1]);assert.throws(()=>new Engine(invalid),'Migration must not weaken exact PP validation');
  }
});

const COMBAT_PER_LEVEL={hp:2,atk:1,def:1,spAtk:1,spDef:1,speed:1};
function assertFullReserveGrowth(engine,mon){
  assert.equal(mon.battleGrowth,99);assert.equal(mon.bonusPoints,99);assert.equal(engine.allocationInfo(mon).total,297);
  const base=engine.stats({...copy(mon),battleGrowth:0}),actual=engine.stats(mon);
  for(const [key,increment]of Object.entries(COMBAT_PER_LEVEL))assert.equal(actual[key]-base[key],increment*99,mon.species+'/'+key);
  assert.equal(actual.accuracy,base.accuracy);assert.equal(actual.evasion,base.evasion);
}
function oldReserveSave(role,counts=Array(6).fill(undefined)){
  const engine=fresh(),grant=bundle(role);assert.equal(engine.receiveAdminReserveTeam(grant).added,6);assert(engine.exchange(-1,0).ok);
  const raw=engine.serialize();raw.version=4;
  grant.members.forEach((member,index)=>{
    const mon=[...raw.party,...raw.storage].find(owned=>owned.grantId===member.grantId),count=counts[index];
    mon.nickname='仲間'+index;mon.shiny=index%2===1;mon.moveOrder=[3,1,0,2];mon.alloc={hp:64,atk:64,def:64,spAtk:64,spDef:41};
    mon.pp=Object.fromEntries(Object.keys(mon.pp).map((id,slot)=>[id,slot]));
    if(index%2)delete mon.heldItem;else mon.heldItem='powerband';
    if(count===undefined)delete mon.battleGrowth;else mon.battleGrowth=count;
    mon.hp=index===0?0:engine.stats(mon).hp-(index*3+1);
  });
  return {raw,grant};
}
function assertMigratedReserve(before,engine){
  const originals=[...before.party,...before.storage].filter(mon=>mon.grantId?.startsWith('admin-trained-v64:'));
  assert.equal(originals.length,6);
  for(const old of originals){
    const mon=all(engine).find(owned=>owned.uid===old.uid),expected={...copy(old),battleGrowth:99,hp:old.hp===0?0:old.hp+2*(99-(old.battleGrowth||0))};
    assert.deepEqual(copy(mon),expected,'Migration preserves UID, PP, allocation, identity, gender, equipment and existing damage');assertFullReserveGrowth(engine,mon);
    assert.equal(engine.genderOf(mon),old.gender);assert.equal(engine.allocationInfo(mon).used,297);
  }
  assert.deepEqual(copy(engine.state.giftReceipts),copy(before.giftReceipts));assert.equal(engine.serialize().version,5);
}

test('v79 canonicalizes old six-member entitlements and grants all eighteen role members with combatGrowth99 and full HP',()=>{
  for(const role of Object.keys(roles))for(const oldGrowth of [undefined,0,99]){
    const grant=bundle(role);if(oldGrowth!==undefined)grant.members.forEach(mon=>mon.battleGrowth=oldGrowth);
    const original=copy(grant),canonical=rules.normalizeBundle(grant);
    assert.deepEqual(copy(grant),original,'Normalization does not mutate a pending legacy response');
    assert.deepEqual(copy(canonical.members.map(mon=>mon.battleGrowth)),[99,99,99,99,99,99]);
    const engine=fresh();assert.equal(engine.receiveAdminReserveTeam(grant).added,6);assert.equal(engine.state.party.length,1);
    for(const mon of engine.state.storage){
      assertFullReserveGrowth(engine,mon);assert.equal(mon.hp,engine.stats(mon).hp);assert.equal(mon.heldItem,'trainband');assert.equal(mon.gender,role==='sub'?'female':'male');assert.equal(engine.allocationInfo(mon).free,297);
    }
    const before=JSON.stringify(engine.state);for(const options of [{},{restore:true}]){assert(engine.receiveAdminReserveTeam(grant,options).alreadyReceived);assert.equal(JSON.stringify(engine.state),before);}
    assert.equal(engine.state.giftReceipts.filter(id=>id.startsWith('admin-trained-v64:')).length,6);
  }
});

test('old saved v64 members with missing or zero combat growth migrate once without changing their builds or reviving fainted members',()=>{
  for(const role of Object.keys(roles))for(const count of [undefined,0]){
    const {raw,grant}=oldReserveSave(role,Array(6).fill(count)),input=copy(raw),engine=new Engine(raw);assertMigratedReserve(input,engine);assert.deepEqual(copy(raw),input,'Loading leaves the original raw save unchanged');
    const once=copy(engine.serialize()),restored=new Engine(once);assert.deepEqual(copy(restored.serialize()),once,'Loading a migrated save never adds the HP correction twice');
    for(const options of [{},{restore:true}]){assert(restored.receiveAdminReserveTeam(grant,options).alreadyReceived);assert.deepEqual(copy(restored.serialize()),once);}
    const fallen=all(restored).find(mon=>mon.uid===input.party[1].uid);assert.equal(fallen.hp,0);
  }
});

test('partial combat growth upgrades only the missing portion and neither repeat loading nor repeat delivery heals existing damage twice',()=>{
  for(const role of Object.keys(roles)){
    const {raw,grant}=oldReserveSave(role,[1,13,25,49,77,99]);raw.version=5;const engine=new Engine(raw);assertMigratedReserve(raw,engine);
    const once=copy(engine.serialize());assert.deepEqual(copy(new Engine(once).serialize()),once);assert(engine.receiveAdminReserveTeam(grant).alreadyReceived);assert.deepEqual(copy(engine.serialize()),once);
    for(const mon of all(engine).filter(mon=>mon.grantId?.startsWith('admin-trained-v64:')))assert.equal(mon.battleGrowth,99);
  }
});

test('already-loaded legacy members can upgrade in place without adding individuals or consuming duplicate receipts',()=>{
  for(const role of Object.keys(roles)){
    const {raw,grant}=oldReserveSave(role,[undefined,0,12,33,70,98]),engine=fresh();engine.state=copy(raw);
    const result=engine.receiveAdminReserveTeam(grant);assert(result.ok);assert.equal(result.added,0);assert.equal(result.updated,6);assert.equal(result.restored,0);assert.equal(all(engine).length,7);assertMigratedReserve(raw,engine);
    const once=JSON.stringify(engine.state);assert(engine.receiveAdminReserveTeam(grant,{restore:true}).alreadyReceived);assert.equal(JSON.stringify(engine.state),once);
  }
});

test('manual recovery gives every role a fresh full-growth missing member while preserving the five surviving builds',()=>{
  for(const role of Object.keys(roles)){
    const engine=fresh(),grant=bundle(role);engine.receiveAdminReserveTeam(grant);
    const missing=copy(engine.state.storage[2]);assert(engine.release(2).ok);const kept=copy(engine.state.storage),receipts=copy(engine.state.giftReceipts);
    assert(engine.receiveAdminReserveTeam(grant).alreadyReceived);assert.equal(engine.state.storage.length,5);
    const restored=engine.receiveAdminReserveTeam(grant,{restore:true});assert.equal(restored.added,1);assert.equal(restored.restored,1);assert.deepEqual(copy(engine.state.storage.slice(0,5)),kept);assert.deepEqual(copy(engine.state.giftReceipts),receipts);
    const mon=engine.state.storage.at(-1);assert.notEqual(mon.uid,missing.uid);assert.equal(mon.grantId,missing.grantId);assertFullReserveGrowth(engine,mon);assert.equal(mon.hp,engine.stats(mon).hp);assert.equal(mon.gender,role==='sub'?'female':'male');assert.equal(mon.heldItem,'trainband');
    assert.deepEqual(copy(mon.pp),Object.fromEntries(engine.moves(mon).map(move=>[move.id,engine.maxPP(move)])));
  }
});

test('all eighteen operator members retain HP198 and five stats99 from combat growth in level50 ranked battles',()=>{
  if(!context.LT.Duel)vm.runInContext(scripts.find(script=>script[2].includes('deterministic, save-independent rental-team duels'))[2],context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../ranked-rules.js'),'utf8'),context);
  for(const role of Object.keys(roles)){
    const engine=fresh();engine.receiveAdminReserveTeam(bundle(role));
    for(const mon of engine.state.storage)engine.setAllocation(mon,{hp:64,atk:64,def:64,spAtk:64,spDef:41});
    const before=JSON.stringify(engine.state),battle=context.LT.RankedRules.create(copy(engine.state.storage.slice(0,3)),copy(engine.state.storage.slice(3)),7,['甲','乙']);
    const rendered=context.LT.RankedRules.hydrate(battle).snapshot();
    for(const team of rendered.teams)for(const mon of team.monsters){
      assert.equal(mon.level,50);assert.equal(mon.sourceLevel,100);assert.equal(mon.battleGrowth,99);assert.equal(Object.values(mon.alloc).reduce((sum,value)=>sum+value,0),297);
      const baseline=engine.stats({...copy(mon),battleGrowth:0});for(const [key,perLevel]of Object.entries(COMBAT_PER_LEVEL))assert.equal(mon.stats[key]-baseline[key],99*perLevel,role+'/'+mon.species+'/'+key);
      assert.equal(mon.stats.accuracy,baseline.accuracy);assert.equal(mon.stats.evasion,baseline.evasion);assert.equal(mon.hp,mon.maxHp);assert.equal(mon.maxHp,mon.stats.hp);
    }
    assert.equal(JSON.stringify(engine.state),before,'A battle preview cannot change the Lv100 owned records');
  }
});

test('the separate v68 Lunaxion entitlement never acquires the six-member growth migration',()=>{
  for(const role of Object.keys(roles)){
    const engine=fresh();engine.receiveAdminReserveTeam(bundle(role));const grant=addition(role);engine.receiveAdminReserveTeam(grant);const mon=engine.state.storage.at(-1);
    assert.equal(mon.battleGrowth||0,0);const before=copy(mon),loaded=new Engine(engine.serialize()),saved=loaded.state.storage.find(member=>member.uid===mon.uid);assert.deepEqual(copy(saved),before);
    const at=loaded.state.storage.findIndex(member=>member.uid===mon.uid);assert(loaded.release(at).ok);assert.equal(loaded.receiveAdminReserveTeam(grant,{restore:true}).added,1);assert.equal(loaded.state.storage.at(-1).battleGrowth||0,0);
    assert(loaded.state.storage.filter(member=>member.grantId.startsWith('admin-trained-v64:')).every(member=>member.battleGrowth===99));
  }
});

test('invalid combat-growth histories are rejected before v64 migration can replace them with99',()=>{
  for(const value of [-1,.5,100,'99',null,{},[]]){
    const grant=bundle();grant.members[0].battleGrowth=value;assert.throws(()=>rules.normalizeBundle(grant));
    const {raw}=oldReserveSave('main');raw.party[1].battleGrowth=value;assert.throws(()=>new Engine(raw));
  }
});

test('the bridge durably saves migrated already-received six-member records once and retries quota failure without a second correction',()=>{
  for(const role of Object.keys(roles))for(const playing of [true,false]){
    const {raw,grant}=oldReserveSave(role),h=bridgeHarness({playing,initialSave:raw,role}),before=JSON.stringify(h.engine.state),expected=new Engine(raw).serialize();
    h.control.fail=true;assert(h.receive(grant).pending);assert.equal(h.control.raw,JSON.stringify(raw));assert.equal(JSON.stringify(h.engine.state),before);assert.equal(h.control.writes,0);
    h.control.fail=false;const result=h.receive(grant);assert(result.ok,JSON.stringify({role,playing,result}));assert.equal(result.added,0);assert.equal(h.control.writes,1);assert.equal(h.control.remembered,1);
    assert.deepEqual(JSON.parse(h.control.raw),copy(expected));assert.deepEqual(copy(h.ctx.storedSave),copy(expected));
    const once=h.control.raw;assert(h.receive(grant).alreadyReceived);assert.equal(h.control.writes,1);assert.equal(h.control.raw,once);
    if(playing)assertMigratedReserve(raw,h.engine);else assert.equal(JSON.stringify(h.engine.state),before,'The title screen keeps the inactive live engine untouched');
  }
});
