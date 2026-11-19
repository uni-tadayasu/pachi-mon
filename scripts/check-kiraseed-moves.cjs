#!/usr/bin/env node
'use strict';
// Exercise the shipped catalog, adventure actions, deterministic link turns,
// and saved individuals rather than reimplementing any battle calculation.
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)],context=vm.createContext({console});
for(const script of scripts){if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;vm.runInContext(script[2],context);if(context.LT?.Engine)break;}
vm.runInContext(scripts.find(script=>script[2].includes('deterministic, save-independent rental-team duels.'))[2],context);
const {Engine,Duel,DATA:D}=context.LT,copy=value=>JSON.parse(JSON.stringify(value));
const IDS=['verdant_lance','forest_crown','genesis_bloom','root_drain'],SPECIES='floravelle',MODES=['solo','single','double'];
const grant={grantId:'admin-mythical:kiraseed-regression',species:SPECIES,level:70};
function hero(){const e=new Engine();assert(e.newGame('komori').ok);return e;}
function fight(mode='solo',side=0,slot=0,targetId='kirari',level=50){
 if(mode==='solo'){
  const e=hero(),label=side?'enemy':'ally',opposite=side?'ally':'enemy';
  e.state.party=[e.makeMonster(side?targetId:SPECIES,level),e.makeMonster('shizuku',level)];
  assert(e.startBattle('kirari',level,null,{wild:false}));e.battle.enemy=e.makeMonster(side?SPECIES:targetId,level);e.rng=()=>.5;
  const actor=side?e.battle.enemy:e.state.party[0],target=side?e.state.party[0]:e.battle.enemy;
  return {mode,e,actor,target,side,slot,actorStages:e.battle.stages[label],targetStages:e.battle.stages[opposite],item:'heldItem',max:mon=>e.stats(mon).hp,
   guard(value){if(value!==undefined)e.battle[opposite+'Guard']=value;return e.battle[opposite+'Guard'];},random(fn){e.rng=fn;},
   cast(id){const events=[];e.applyMove(actor,target,D.moves[id],label,events);return events;},tick(){const events=[];e.endOfTurn(events);return events;}};
 }
 const size=Duel.teamSize(mode),team=(id,index)=>{const ids=['komori','shizuku','hibana','kirari','fuwari'].filter(x=>x!==id);ids.splice(index,0,id);return ids.slice(0,size);};
 const teams=[team(SPECIES,slot),team(targetId,slot)];if(side)teams.reverse();
 const d=Duel.create({mode,teams,seed:50150}),actor=d.active(side)[slot],target=d.active(1-side)[slot];d._random=()=>.5;
 return {mode,d,actor,target,side,slot,actorStages:actor.stages,targetStages:target.stages,item:'item',max:mon=>mon.maxHp,
  guard(value){if(value!==undefined)target.guard=value;return target.guard;},random(fn){d._random=fn;},
  cast(id){d.state.events=[];d._apply({type:'move',side,slot,target:slot,technique:D.moves[id]},actor);return d.state.events;},tick(){d.state.events=[];d._endOfTurn();return d.state.events;}};
}
function forEachPosition(run){for(const mode of MODES)for(const side of [0,1])for(let slot=0;slot<(mode==='double'?2:1);slot++)run(mode,side,slot);}
function damage(events){const event=events.find(e=>e.kind==='damage');assert(event&&event.amount>0,'An actual attack deals damage');assert.equal(event.category,'physical');return event.amount;}
function quietOrders(d,side){return d.active(side).flatMap((mon,slot)=>{
 if(mon.hp<=0)return[];const move=d.moves(mon).findIndex(m=>['heal','guard'].includes(m.kind)&&m.pp>0);assert(move>=0,'Fixture has a non-damaging legal turn');return[{type:'move',slot,move,target:slot}];
});}

test('Kiraseed keeps four exclusive slots and PP with its physical, poisonous, large-root and half-heal roles',()=>{
 const expected=[
  ['若葉の刃','attack','physical',50,100,8,undefined],
  ['花毒の舞','attack','status',0,100,2,'inflictBloom'],
  ['大樹の逆鱗','attack','physical',90,90,5,'attackRecharge'],
  ['陽だまりの再生','heal','status',50,100,8,undefined]
 ];
 assert.deepEqual(copy(D.species[SPECIES].moves),IDS);
 IDS.forEach((id,index)=>{const m=D.moves[id];assert.deepEqual([m.name,m.kind,m.category,m.power,m.accuracy,m.pp,m.effect],expected[index]);assert.equal(m.element,'leaf');assert.equal(m.role,'special');assert.equal(m.alwaysHits===true,index===1);assert.deepEqual(Object.values(D.species).filter(s=>s.moves.includes(id)).map(s=>s.id),[SPECIES]);});
 assert.deepEqual(Object.values(D.moves).filter(m=>m.alwaysHits).map(m=>m.id),['forest_crown'],'Only the requested poison technique bypasses accuracy');
 assert.equal(D.content.moves,96);assert.equal(D.content.hiddenMoves,4);assert.equal(Object.keys(D.moves).length,100);
 assert.deepEqual(copy(D.species[SPECIES].base),{hp:76,atk:42,def:42,spAtk:22,spDef:42,speed:10,accuracy:103,evasion:102});
 const e=hero();for(const level of [50,100]){
  const stats=e.stats(e.makeMonster(SPECIES,level)),legend=e.stats(e.makeMonster('arvelion',level));
  assert.deepEqual([stats.hp,stats.atk,stats.def,stats.spAtk,stats.spDef,stats.speed],level===50?[326,192,142,172,142,110]:[576,342,242,322,242,210]);
  assert(stats.hp>legend.hp&&stats.atk>legend.atk&&stats.def>legend.def&&stats.spDef>legend.spDef);assert(stats.speed<legend.speed&&stats.spAtk<legend.spAtk);
 }
});

test('existing party and reserve individuals preserve UID, grant, allocation, move order and each PP through load and delivery polling',()=>{
 for(const location of ['party','storage']){
  const e=hero();assert(e.receiveAdminMythical(grant).ok);const mon=e.state.party.find(m=>m.species===SPECIES);
  assert(e.renameMonster(mon.uid,'もりがみ').ok);mon.shiny=true;mon.heldItem='bloomward';mon.alloc={hp:1,atk:2,def:2,spDef:1};mon.hp=17;mon.xp=19;mon.curse=true;
  mon.pp={verdant_lance:0,forest_crown:1,genesis_bloom:2,root_drain:3};assert(e.moveMove(mon.uid,3,0).ok);
  if(location==='storage'){assert(e.depositParty(e.state.party.indexOf(mon)).ok);}
  const expected=copy(mon),saved=e.serialize(),before=JSON.stringify(saved),loaded=new Engine(saved),restored=loaded.state[location].find(m=>m.uid===mon.uid);
  assert.equal(JSON.stringify(saved),before,'Reading the save leaves the supplied record unchanged');assert.deepEqual(copy(restored),expected);
  assert.deepEqual(copy(loaded.moves(restored).map(m=>m.id)),[IDS[3],IDS[0],IDS[1],IDS[2]]);assert(loaded.receiveAdminMythical(grant).alreadyReceived);assert.deepEqual(copy(restored),expected);
  const twice=new Engine(loaded.serialize()).state[location].find(m=>m.uid===mon.uid);assert.deepEqual(copy(twice),expected);
 }
 const {e,actor}=fight();assert(e.moveMove(actor.uid,3,0).ok===false,'Battle-time move-order edits remain forbidden');
 e.battle=null;assert(e.moveMove(actor.uid,3,0).ok);assert(e.startBattle('kirari',50,null,{wild:false}));e.enemyTurn=()=>{};actor.hp=1;
 const before=copy(actor.pp),result=e.action({type:'move',index:0});assert(result.ok);assert(result.events.some(event=>event.kind==='heal'&&event.moveId===IDS[3]));
 assert.equal(actor.hp,1+Math.ceil(e.stats(actor).hp/2));assert.deepEqual(copy(actor.pp),{...before,root_drain:before.root_drain-1});
});

test('both damaging techniques use physical attack and defense, obey guard and remain weakened by scorch',()=>{
 for(const mode of MODES)for(const side of [0,1])for(const id of [IDS[0],IDS[2]]){
  const hit=change=>{const f=fight(mode,side,0,'hibana');change?.(f);return damage(f.cast(id));};
  const ordinary=hit();assert(hit(f=>{f.actorStages.atk=6;})>ordinary);assert.equal(hit(f=>{f.actorStages.spAtk=6;}),ordinary);
  assert(hit(f=>{f.targetStages.def=6;})<ordinary);assert.equal(hit(f=>{f.targetStages.spDef=6;}),ordinary);
  assert(Math.abs(hit(f=>{f.actor.status='scorch';})-ordinary/2)<=1);assert(hit(f=>f.guard(true))<ordinary,'The former piercing technique now respects guard');
 }
});

test('the poison dance always hits the chosen opponent without direct damage, stat boosts or consuming its guard',()=>{
 forEachPosition((mode,side,slot)=>{
  const f=fight(mode,side,slot);f.actorStages.accuracy=-6;f.targetStages.evasion=6;f.guard(true);f.random(()=>.999999);f.target.curse=true;
  const hp=[f.actor.hp,f.target.hp],stages=[copy(f.actorStages),copy(f.targetStages)],pp=f.actor.pp[IDS[1]],events=f.cast(IDS[1]);
  assert.equal(f.target.status,'bloom');assert.equal(f.target.curse,true);assert.deepEqual([f.actor.hp,f.target.hp],hp);assert.equal(f.actor.pp[IDS[1]],pp-1);assert.equal(f.guard(),true);
  assert.deepEqual([copy(f.actorStages),copy(f.targetStages)],stages);assert(!events.some(e=>['damage','miss','boost','recoil'].includes(e.kind)));
  const status=events.find(e=>e.kind==='status'&&e.status==='bloom');assert(status);assert.equal(status.side,mode==='solo'?(side?'ally':'enemy'):1-side);if(mode!=='solo')assert.equal(status.slot,slot);
 });
});

test('poison immunity, wards and occupied status slots reject the dance without consuming unrelated healing berries',()=>{
 const scenarios=[...['komori',SPECIES,'nullmie','nullva','zeroveil'].map(targetId=>({targetId})),{targetId:'kirari',item:'bloomward'},...Object.keys(D.statuses).map(status=>({targetId:'kirari',status}))];
 for(const mode of MODES)for(const scenario of scenarios){
  const f=fight(mode,0,mode==='double'?1:0,scenario.targetId);f.target.hp=17;f.target[f.item]=scenario.item||'healberry';if(scenario.status){f.target.status=scenario.status;if(scenario.status==='crystal')f.target.statusTurns=2;}
  f.actorStages.accuracy=-6;f.targetStages.evasion=6;f.random(()=>.999999);const before=copy(f.target),pp=f.actor.pp[IDS[1]],events=f.cast(IDS[1]);
  assert.deepEqual(copy(f.target),before,`${mode}: rejected poison cannot trigger item healing or replace an existing condition`);assert.equal(f.actor.pp[IDS[1]],pp-1);assert(!events.some(e=>e.kind==='miss'||e.kind==='damage'||e.kind==='item'));
 }
});

test('poison cure berries still activate and poison coexists with the permanent curse on the same turn',()=>{
 for(const mode of MODES)for(const berry of ['bloomberry','allberry']){
  const f=fight(mode,1,mode==='double'?1:0);f.target[f.item]=berry;f.target.curse=true;f.random(()=>.999999);const hp=f.target.hp,events=f.cast(IDS[1]);
  assert.equal(f.target.status,undefined);assert.equal(f.target[f.item],undefined);assert.equal(f.target.curse,true);assert.equal(f.target.hp,hp);assert(events.some(e=>e.kind==='item'&&e.item===berry));
 }
 for(const mode of MODES){
  const f=fight(mode,0,mode==='double'?1:0);f.target.curse=true;f.cast(IDS[1]);const hp=f.target.hp,max=f.max(f.target),events=f.tick();
  assert.equal(f.target.hp,hp-Math.max(1,Math.floor(max/8))-Math.max(1,Math.floor(max/4)));assert.equal(f.target.status,'bloom');assert.equal(f.target.curse,true);
  assert(events.some(e=>e.kind==='statusTick'&&e.status==='bloom'));assert(events.some(e=>e.kind==='statusTick'&&e.status==='curse'));
 }
});

test('half restoration rounds up for odd HP, caps at full HP and leaves conditions, PP of other moves and the opponent intact',()=>{
 forEachPosition((mode,side,slot)=>{for(const odd of [false,true])for(const health of ['one','half','almost','full']){
  const f=fight(mode,side,slot,'kirari',odd?51:50);
  // Link duels are Lv.50; an odd maximum probes the shared heal arithmetic.
  if(mode!=='solo'&&odd){f.actor.maxHp++;f.actor.stats.hp++;}
  const max=f.max(f.actor),hp={one:1,half:Math.floor(max/2),almost:max-1,full:max}[health];assert.equal(max%2,odd?1:0);
  f.actor.hp=hp;f.actor.curse=true;f.actor.status='scorch';const target=copy(f.target),beforePP=copy(f.actor.pp),events=f.cast(IDS[3]);
  assert.equal(f.actor.hp,Math.min(max,hp+Math.ceil(max/2)));assert.equal(f.actor.curse,true);assert.equal(f.actor.status,'scorch');assert(!f.actor.rechargeTurns);
  assert.deepEqual(copy(f.actor.pp),{...beforePP,root_drain:beforePP.root_drain-1});assert.deepEqual(copy(f.target),target);
  const heal=events.find(e=>e.kind==='heal');assert(heal);assert.equal(heal.amount,Math.min(max-hp,Math.ceil(max/2)));assert(!events.some(e=>e.kind==='damage'));
 }});
 const {e,actor}=fight();actor.hp=0;const before=copy({state:e.state,battle:e.battle});assert.equal(e.action({type:'move',index:3}).ok,false);assert.deepEqual(copy({state:e.state,battle:e.battle}),before,'A fainted companion cannot revive itself');
 for(const mode of ['single','double']){const {d,actor}=fight(mode);actor.hp=0;const orders=quietOrders(d,0);orders.push({type:'move',slot:0,move:3,target:0});const before=copy(d.state);assert.equal(d.validate(0,orders).ok,false);assert.deepEqual(copy(d.state),before);}
});

test('the large root hit spends exactly one following turn resting even when a move or switch is requested',()=>{
 for(const requested of ['move','switch']){
  const {e,actor,target}=fight('solo',0,0,'hibana');e.enemyTurn=()=>{};actor.hp-=17;const pp=actor.pp[IDS[2]],hit=e.action({type:'move',index:2});assert(hit.ok);damage(hit.events);assert(target.hp>0);assert.equal(actor.pp[IDS[2]],pp-1);assert.equal(actor.rechargeTurns,1);
  const beforePP=copy(actor.pp),hp=actor.hp,targetHP=target.hp;
  const wait=e.action(requested==='switch'?{type:'switch',index:1}:{type:'move',index:3});assert(wait.ok);assert.equal(e.battle.activeIndex,0);assert.equal(actor.hp,hp);assert.equal(target.hp,targetHP);assert.deepEqual(copy(actor.pp),beforePP);assert(!actor.rechargeTurns);assert.equal(wait.events.filter(e=>e.kind==='recharge').length,1);
  const resumed=e.action({type:'move',index:3});assert(resumed.ok);assert(resumed.events.some(e=>e.kind==='heal'&&e.moveId===IDS[3]));assert.equal(actor.pp[IDS[3]],beforePP[IDS[3]]-1);assert(!actor.rechargeTurns);
 }
 const {e,actor}=fight();e.battle=null;assert(e.startTeamBattle([{species:'hibana',level:50},{species:'fuwari',level:50}]));e.enemyTurn=()=>{};e.battle.enemy.hp=1;
 assert(e.action({type:'move',index:2}).ok);assert(e.battle.pendingReplacement);assert.equal(actor.rechargeTurns,1);assert.equal(e.chooseReplacement(1).ok,false);assert(e.chooseReplacement().ok);
 const pp=copy(actor.pp);assert(e.action({type:'move',index:3}).ok);assert.deepEqual(copy(actor.pp),pp);assert(!actor.rechargeTurns,'Defeating one trainer member does not bypass or repeat the forced rest');
});

test('misses and blocked actions do not start recharge, and item recoil KO clears the successful hit cost',()=>{
 forEachPosition((mode,side,slot)=>{
  for(const id of [IDS[0],IDS[2]]){const f=fight(mode,side,slot);f.actorStages.accuracy=-6;f.targetStages.evasion=6;f.random(()=>.999999);const hp=f.target.hp,pp=f.actor.pp[id],events=f.cast(id);assert(events.some(e=>e.kind==='miss'));assert.equal(f.target.hp,hp);assert.equal(f.actor.pp[id],pp-1);assert(!f.actor.rechargeTurns);}
  const f=fight(mode,side,slot);f.actor.status='bubble';const pp=copy(f.actor.pp),hp=f.target.hp;assert(f.cast(IDS[2]).some(e=>e.blocked));assert.deepEqual(copy(f.actor.pp),pp);assert.equal(f.target.hp,hp);assert(!f.actor.rechargeTurns);
  for(const itemKind of ['thorns','orb']){
   const f=fight(mode,side,slot,'hibana'),item=Object.values(D.heldItems).find(item=>item.kind===itemKind);assert(item);f.actor.hp=1;(itemKind==='thorns'?f.target:f.actor)[f.item]=item.id;
   const events=f.cast(IDS[2]);damage(events);assert.equal(f.actor.hp,0);assert(!f.actor.rechargeTurns);assert(events.some(e=>e.kind==='faint'&&e.side===(mode==='solo'?(side?'enemy':'ally'):side)));
  }
 });
});

test('paired link single and double turns execute all four selected slots and synchronize the one-turn recharge on both sides',()=>{
 for(const mode of ['single','double'])for(const side of [0,1])for(let slot=0;slot<(mode==='double'?2:1);slot++){
  const a=fight(mode,side,slot,'hibana'),b=fight(mode,side,slot,'hibana');a.actorStages.def=b.actorStages.def=6;a.actorStages.spDef=b.actorStages.spDef=6;
  const initialPP=copy(a.actor.pp),active=copy(a.d.state.teams[side].active),bench=a.d.state.teams[side].monsters.findIndex((m,i)=>!active.includes(i));
  for(const selected of [1,2,'rest',3,0]){
   const orders=[quietOrders(a.d,0),quietOrders(a.d,1)],current=orders[side].findIndex(order=>order.slot===slot);assert(current>=0);
   orders[side][current]=selected==='rest'?{type:'switch',slot,index:bench}:{type:'move',slot,move:selected,target:slot};
   const beforePP=copy(a.actor.pp);a.d.resolve(copy(orders));b.d.resolve(copy(orders));assert.deepEqual(copy(a.d.state),copy(b.d.state));
   const own=a.d.state.events.filter(event=>event.side===side&&event.slot===slot);
   if(selected==='rest'){assert.deepEqual(copy(a.d.state.teams[side].active),active);assert.deepEqual(copy(a.actor.pp),beforePP);assert.equal(own.filter(event=>event.kind==='recharge').length,1);assert(!a.actor.rechargeTurns);}
   else{assert.equal(a.actor.pp[IDS[selected]],beforePP[IDS[selected]]-1);assert(own.some(event=>event.move===IDS[selected]));if(selected===2)assert.equal(a.actor.rechargeTurns,1);}
  }
  assert.deepEqual(copy(a.actor.pp),Object.fromEntries(IDS.map(id=>[id,initialPP[id]-1])));assert(!a.actor.rechargeTurns);
 }
});

test('the changed condition and recharge rules participate in the shared multiplayer fingerprint',()=>{
 const before=Duel.rulesFingerprint();assert.equal(typeof before,'string');assert(before.length>0);
 const value=D.moves.forest_crown.alwaysHits;try{D.moves.forest_crown.alwaysHits=false;assert.notEqual(Duel.rulesFingerprint(),before);}finally{D.moves.forest_crown.alwaysHits=value;}
 assert.equal(Duel.rulesFingerprint(),before);
});
