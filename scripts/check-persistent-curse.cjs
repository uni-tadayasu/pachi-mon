#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)],context=vm.createContext({console});
for(const script of scripts){if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;vm.runInContext(script[2],context);if(context.LT?.Engine)break;}
const duelScript=scripts.find(script=>!/\bsrc=/.test(script[1])&&script[2].includes('deterministic, save-independent rental-team duels'));
assert(duelScript);vm.runInContext(duelScript[2],context);
const {Engine,Duel,DATA:D,ConditionRules}=context.LT,copy=value=>JSON.parse(JSON.stringify(value)),quarter=max=>Math.max(1,Math.floor(max/4));
let passed=0;function test(name,run){run();passed++;console.log('PASS '+name);}
function game(){const e=new Engine();assert(e.newGame('komori').ok);e.state.party[0].level=50;e.restoreMonster(e.state.party[0]);e.state.party.push(e.makeMonster('shizuku',50));e.markCaught('shizuku');e.rng=()=>.5;return e;}
function fight(species='komori',enemy='nullmie'){
 const e=game();e.state.party[0]=e.makeMonster(species,50);e.markCaught(species);assert(e.startBattle(enemy,50));e.enemyTurn=()=>{};
 return {e,actor:e.state.party[0],enemy:e.battle.enemy};
}
function cast(e,user,target,id,side='enemy'){const events=[];e.applyMove(user,target,D.moves[id],side,events);return events;}
function cursed(mon){assert.equal(mon.curse,true,'Non-void curse persists');}
function noRecharge(mon){assert(!(mon.rechargeTurns>0),'Recovery delay is still cleared at the existing lifecycle boundary');}
function restSpot(e){
 for(const map of Object.values(D.maps))for(const npc of map.npcs.filter(n=>n.kind==='rest')){
  const spot=[{x:npc.x,y:npc.y+1,facing:'up'},{x:npc.x,y:npc.y-1,facing:'down'},{x:npc.x+1,y:npc.y,facing:'left'},{x:npc.x-1,y:npc.y,facing:'right'}].find(p=>e.walkable(map,p.x,p.y));
  if(!spot)continue;Object.assign(e.state,{map:map.id,...spot});if(e.nearbyNPC()?.kind==='rest')return;
 }
 assert.fail('A real rest location is available');
}

test('a real curse costs HP only once, stacks with scorch and ticks only while its living target is active',()=>{
 assert.equal(D.volatileConditions.curse.persistent,true);
 const {e,actor,enemy}=fight(),max=e.stats(actor).hp,userHP=enemy.hp;cast(e,enemy,actor,'null_curse');cursed(actor);assert.equal(enemy.hp,userHP-quarter(e.stats(enemy).hp));
 cast(e,enemy,actor,'null_scorch');assert.equal(actor.status,'scorch');const pp=enemy.pp.null_curse,hp=enemy.hp;cast(e,enemy,actor,'null_curse');assert.equal(enemy.hp,hp);assert.equal(enemy.pp.null_curse,pp-1);
 const events=[];e.endOfTurn(events);assert.equal(actor.hp,max-quarter(max)-Math.max(1,Math.floor(max/16)));assert(events.some(event=>event.kind==='statusTick'&&event.status==='curse'));
 const after=actor.hp;assert(e.action({type:'switch',index:1}).ok);cursed(actor);assert.equal(actor.hp,after);
 const reserve=e.makeMonster('kirari',50);reserve.curse=true;e.state.storage.push(reserve);e.markCaught(reserve.species);const reserveHP=reserve.hp;
 for(let n=0;n<2;n++)e.endOfTurn([]);assert.equal(actor.hp,after,'A benched cursed member does not tick');assert.equal(reserve.hp,reserveHP,'Storage never ticks');
 assert(e.action({type:'switch',index:0}).ok);cursed(actor);assert.equal(actor.hp,after-quarter(max)-Math.max(1,Math.floor(max/16)));
 assert(ConditionRules.list(actor).some(condition=>condition.id==='curse'));
});

test('curse survives knockout, normal-condition cleanup, a real revive item and returning to the battle',()=>{
 const {e,actor}=fight();actor.curse=true;actor.hp=1;actor.rechargeTurns=1;
 const events=[];e.endOfTurn(events);assert.equal(actor.hp,0);cursed(actor);noRecharge(actor);assert(events.some(event=>event.kind==='faint'&&event.side==='ally'));
 assert(e.action({type:'switch',index:1}).ok);const tonic=e.state.inventory.tonic;assert(e.action({type:'item',id:'tonic',index:0}).ok);
 assert.equal(e.state.inventory.tonic,tonic-1);assert.equal(actor.hp,Math.ceil(e.stats(actor).hp*.5));cursed(actor);
 const revived=actor.hp;assert(e.action({type:'switch',index:0}).ok);assert.equal(actor.hp,revived-quarter(e.stats(actor).hp));cursed(actor);
 actor.status='scorch';actor.hp=0;actor.rechargeTurns=1;e.faint(actor,'ally',[]);assert.equal(actor.status,undefined);noRecharge(actor);cursed(actor);
 e.endBattle('fled',[]);assert(e.finishBattle().ok);const loaded=new Engine(e.serialize());assert.equal(loaded.state.party[0].hp,0);cursed(loaded.state.party[0]);
 assert(loaded.useItem('tonic',0).ok);assert(loaded.state.party[0].hp>0);cursed(loaded.state.party[0]);
});

test('medicine and healing berries keep curse while curing ordinary conditions and restoring HP normally',()=>{
 const e=game(),mon=e.state.party[0];mon.curse=true;mon.status='scorch';mon.hp=1;const pp=copy(mon.pp),remedies=e.state.inventory.remedy;
 assert(e.useItem('remedy',0).ok);assert.equal(mon.status,undefined);cursed(mon);assert.equal(e.state.inventory.remedy,remedies-1);assert.deepEqual(copy(mon.pp),pp);
 const inventory=copy(e.state.inventory);assert.equal(e.useItem('remedy',0).ok,false,'Curse alone is not curable with normal medicine');assert.deepEqual(copy(e.state.inventory),inventory);
 assert(e.useItem('salve',0).ok);assert.equal(mon.hp,1+Math.ceil(e.stats(mon).hp*.5));cursed(mon);
 for(const item of Object.values(D.heldItems).filter(item=>item.kind==='cureberry')){
  mon.hp=e.stats(mon).hp;mon.status=item.params.status==='any'?'scorch':item.params.status;mon.statusTurns=2;mon.heldItem=item.id;
  e.heldReact(mon,'ally',[]);assert.equal(mon.heldItem,undefined);assert.equal(mon.status,undefined);assert.equal(mon.statusTurns,undefined);cursed(mon);
 }
 mon.heldItem='allberry';e.heldReact(mon,'ally',[]);assert.equal(mon.heldItem,'allberry','Curse alone never wastes a cure berry');cursed(mon);
 for(const item of Object.values(D.heldItems).filter(item=>item.kind==='pinchheal')){
  mon.hp=1;mon.heldItem=item.id;e.heldReact(mon,'ally',[]);assert.equal(mon.hp,1+Math.ceil(e.stats(mon).hp*item.params.amount));assert.equal(mon.heldItem,undefined);cursed(mon);
 }
});

test('healing techniques, resting, trainer rescue and defeat recovery keep curse and retain ordinary recovery rules',()=>{
 const {e,actor}=fight('hibana');actor.curse=true;actor.hp=1;actor.pp.warmth=3;const before=actor.hp;cast(e,actor,e.battle.enemy,'warmth','ally');assert(actor.hp>before);assert.equal(actor.pp.warmth,2);cursed(actor);
 e.endBattle('fled',[]);assert(e.finishBattle().ok);actor.status='scorch';actor.rechargeTurns=1;actor.hp=1;for(const move of e.moves(actor))actor.pp[move.id]=0;
 restSpot(e);assert(e.heal().ok);assert.equal(actor.hp,e.stats(actor).hp);assert.equal(actor.status,undefined);noRecharge(actor);cursed(actor);for(const move of e.moves(actor))assert.equal(actor.pp[move.id],e.maxPP(move));
 for(const result of ['won','lost','fled']){
  const {e,actor}=fight();actor.curse=true;actor.status='scorch';actor.rechargeTurns=1;actor.hp=result==='lost'?0:17;
  for(const move of e.moves(actor))actor.pp[move.id]=0;
  if(result==='won'){e.battle.towerFloor=1;assert.equal(e.isTrainerBattle(),true);}
  e.endBattle(result,[]);cursed(actor);noRecharge(actor);assert(e.finishBattle().ok);cursed(actor);
  if(result!=='fled'){assert.equal(actor.hp,e.stats(actor).hp);assert.equal(actor.status,undefined);for(const move of e.moves(actor))assert.equal(actor.pp[move.id],e.maxPP(move));}
  const loaded=new Engine(e.serialize());cursed(loaded.state.party[0]);
 }
});

test('captured cursed wild monsters retain curse through deposit, withdrawal and both normal and mid-battle saves',()=>{
 const e=game(),owner={id:'P1234567890abcdef',isAdmin:true};assert(e.startAdminEncounter('fuwari',30,owner).ok);e.battle.enemy.curse=true;e.battle.enemy.status='scorch';const enemyUID=e.battle.enemy.uid;
 assert(e.action({type:'resonate'}).ok);const mon=e.state.party.at(-1);assert.notEqual(mon.uid,enemyUID);cursed(mon);assert.equal(mon.status,undefined);assert.equal(mon.hp,e.stats(mon).hp);assert(e.finishBattle().ok);
 const uid=mon.uid,before=copy(mon);assert(e.depositParty(2).ok);assert.deepEqual(copy(e.state.storage[0]),before);
 let loaded=new Engine(e.serialize());cursed(loaded.state.storage[0]);assert(loaded.exchange(loaded.state.party.length,0).ok);assert.deepEqual(copy(loaded.state.party.at(-1)),before);
 const target=loaded.state.party.find(mon=>mon.uid===uid);target.hp=1;target.rechargeTurns=1;target.status='scorch';for(const move of loaded.moves(target))target.pp[move.id]=0;
 assert(loaded.startBattle('komori',30));const raw=copy(loaded.state),save=loaded.serialize();assert.deepEqual(copy(loaded.state),raw,'Saving does not modify the running battle');
 const saved=save.party.find(mon=>mon.uid===uid);cursed(saved);noRecharge(saved);assert.equal(saved.hp,loaded.stats(target).hp);assert.equal(saved.status,undefined);
 for(const move of loaded.moves(saved))assert.equal(saved.pp[move.id],loaded.maxPP(move));loaded=new Engine(save);cursed(loaded.state.party.find(mon=>mon.uid===uid));assert.equal(loaded.battle,null);
});

test('save validation retains true even at zero HP, omits false, rejects other values and prioritizes void immunity',()=>{
 const bad=[null,'true','curse','',0,1,NaN,[],{},[true]];
 for(const location of ['party','storage'])for(const hp of [0,17]){
  const e=game(),mon=e.makeMonster('fuwari',30);mon.hp=hp;e.state[location].push(mon);e.markCaught(mon.species);
  for(const value of [undefined,false,true]){
   const save=e.serialize(),record=save[location].find(item=>item.uid===mon.uid);record.curse=value;record.rechargeTurns=1;const before=JSON.stringify(save),loaded=new Engine(save),restored=loaded.state[location].find(item=>item.uid===mon.uid);
   assert.equal(JSON.stringify(save),before);assert.equal(restored.hp,hp);assert.equal(restored.curse,value===true?true:undefined);noRecharge(restored);
  }
  for(const value of bad){const save=e.serialize();save[location].find(item=>item.uid===mon.uid).curse=value;assert.throws(()=>new Engine(save),/呪縛/);}
 }
 for(const id of D.glitchLine.ids)for(const value of [true,false,undefined,...bad]){
  const e=game(),mon=e.makeMonster(id,50);e.state.storage.push(mon);e.markCaught(id);const save=e.serialize();save.storage[0].curse=value;
  const before=JSON.stringify(save),loaded=new Engine(save);assert.equal(JSON.stringify(save),before);assert.equal(loaded.state.storage[0].curse,undefined);
 }
});

test('cursed individuals cannot escape through trades, while ordinary conditions and false curse stay compatible',()=>{
 for(const location of ['party','storage']){
  const e=game(),mon=e.makeMonster('fuwari',30);e.state[location].push(mon);e.markCaught(mon.species);mon.status='scorch';mon.curse=false;
  const outgoing=e.toTradeWire(mon);assert(!Object.hasOwn(outgoing,'curse'));assert.equal(mon.status,'scorch');
  mon.curse=true;assert.throws(()=>e.tradeMonster(mon),/呪縛/);assert.throws(()=>e.toTradeWire(mon),/呪縛/);cursed(mon);
  const room='12345678-1234-4234-8234-123456789abc',incoming=e.makeMonster('shizuku',30);incoming.uid='tr-'+room+'-g';
  const receipt={id:'trade:'+room,outgoingUid:mon.uid,outgoing,incoming:e.toTradeWire(incoming),revision:1},before=copy(e.state),result=e.applyTrade(receipt);
  assert.equal(result.ok,false);assert.match(result.message,/呪縛/);assert.deepEqual(copy(e.state),before,'Forged curse-free wire cannot replace the cursed owned individual');
 }
});

function duel(mode='single'){
 const size=Duel.teamSize(mode),d=Duel.create({mode,teams:[['komori','shizuku','hibana','fuwari'].slice(0,size),['kirari','fuwari','shizuku','komori'].slice(0,size)],seed:49123});d._random=()=>.5;return d;
}
function apply(d,side,slot,id,target=0){d.state.events=[];const mon=d.active(side)[slot];d._apply({type:'move',technique:D.moves[id],side,slot,target},mon);return d.state.events;}

test('single and double curse ticks affect only living active slots and preserve curse when the tick causes knockout',()=>{
 for(const mode of ['single','double']){
  const d=duel(mode),before=[];d.state.teams.forEach((team,side)=>team.monsters.forEach((mon,index)=>{mon.curse=true;before.push({mon,hp:mon.hp,active:team.active.includes(index)});}));
  const dead=d.active(1)[0];dead.hp=0;const clipped=d.active(0)[0];clipped.hp=3;clipped.rechargeTurns=1;
  d._endOfTurn();assert.equal(clipped.hp,0);cursed(clipped);noRecharge(clipped);assert.equal(dead.hp,0);cursed(dead);
  for(const record of before){const {mon,hp,active}=record;cursed(mon);if(mon===dead||mon===clipped)continue;assert.equal(mon.hp,active?hp-quarter(mon.maxHp):hp);}
  assert(d.state.events.some(event=>event.kind==='statusTick'&&event.status==='curse'&&event.amount===3));
  assert(!d.state.events.some(event=>event.kind==='statusTick'&&event.status==='curse'&&event.side===1&&event.slot===0));
 }
});

test('single and double switches, forced replacement, fainting and result cleanup preserve curse but clear recharge',()=>{
 for(const mode of ['single','double'])for(const side of [0,1]){
  const d=duel(mode),team=d.state.teams[side],outgoing=d.active(side)[0],original=team.active[0],bench=team.monsters.findIndex((mon,index)=>!team.active.includes(index)),incoming=team.monsters[bench];
  // Keep unrelated attacks out of this switch test; resolve, replacement and
  // turn-end effects still run their real implementations.
  d._apply=()=>{};outgoing.curse=true;incoming.curse=true;const outHP=outgoing.hp,inHP=incoming.hp;
  let orders=[d.legalOrders(0),d.legalOrders(1)];orders[side][0]={type:'switch',slot:0,index:bench};d.resolve(orders);
  assert.equal(team.active[0],bench);cursed(outgoing);cursed(incoming);assert.equal(outgoing.hp,outHP);assert.equal(incoming.hp,inHP-quarter(incoming.maxHp));
  orders=[d.legalOrders(0),d.legalOrders(1)];orders[side][0]={type:'switch',slot:0,index:original};d.resolve(orders);assert.equal(team.active[0],original);assert.equal(outgoing.hp,outHP-quarter(outgoing.maxHp));cursed(outgoing);
  outgoing.hp=0;outgoing.status='scorch';outgoing.rechargeTurns=1;d._faint(side,0,outgoing);cursed(outgoing);noRecharge(outgoing);assert.equal(outgoing.status,undefined);d._replaceFainted();assert.equal(d.state.phase,'replacement');
  incoming.rechargeTurns=1;orders=[d.legalOrders(0),d.legalOrders(1)];orders[side][0]={type:'switch',slot:0,index:bench};d.resolve(orders);assert.equal(team.active[0],bench);cursed(outgoing);cursed(incoming);noRecharge(incoming);
  d.state.teams.forEach(team=>team.monsters.forEach(mon=>{mon.curse=true;mon.rechargeTurns=1;}));d._finish(side,'knockout');
  d.state.teams.forEach(team=>team.monsters.forEach(mon=>{cursed(mon);noRecharge(mon);}));
 }
});

test('duel medicine reactions and healing techniques preserve curse and peer turn resolution stays deterministic',()=>{
 for(const mode of ['single','double']){
  const d=duel(mode),mon=d.active(1)[0];mon.curse=true;mon.status='scorch';mon.item='allberry';d._react(1,0,mon);assert.equal(mon.status,undefined);assert.equal(mon.item,undefined);cursed(mon);
  mon.item='allberry';d._react(1,0,mon);assert.equal(mon.item,'allberry');cursed(mon);mon.hp=1;mon.item='healberry';d._react(1,0,mon);assert.equal(mon.item,undefined);assert(mon.hp>1);cursed(mon);
  const healing=d.moves(mon).find(move=>move.kind==='heal');assert(healing);delete mon.item;mon.hp=1;const pp=mon.pp[healing.id];apply(d,1,0,healing.id);assert(mon.hp>1);assert.equal(mon.pp[healing.id],pp-1);cursed(mon);
  const peers=[duel(mode),duel(mode)];peers.forEach(peer=>{peer.active(0)[0].curse=true;peer.active(0)[0].status='scorch';peer.active(1)[0].curse=true;});
  for(let n=0;n<3&&peers[0].state.winner===null;n++){
   const orders=[peers[0].legalOrders(0),peers[0].legalOrders(1)];peers.forEach(peer=>peer.resolve(copy(orders)));assert.equal(peers[0].fingerprint(),peers[1].fingerprint());
  }
  peers.forEach(peer=>{cursed(peer.state.teams[0].monsters[0]);cursed(peer.state.teams[1].monsters[0]);});
 }
});

test('all void stages remain immune to curse and their stale curse is removed without waiving recovery delay',()=>{
 for(const id of D.glitchLine.ids){
  const {e,actor,enemy}=fight(id),userHP=enemy.hp;cast(e,enemy,actor,'null_curse');assert.equal(actor.curse,undefined);assert.equal(enemy.hp,userHP);
  actor.curse=true;actor.rechargeTurns=1;ConditionRules.clearImmune(actor);assert.equal(actor.curse,undefined);assert.equal(actor.rechargeTurns,1);
  actor.curse=true;e.restoreMonster(actor);assert.equal(actor.curse,undefined);noRecharge(actor);
  for(const mode of ['single','double']){
   const size=Duel.teamSize(mode),d=Duel.create({mode,teams:[['nullmie','komori','shizuku','hibana'].slice(0,size),[id,'fuwari','kirari','komori'].slice(0,size)],seed:49123});d._random=()=>.5;
   const user=d.active(0)[0],target=d.active(1)[0],hp=user.hp;apply(d,0,0,'null_curse');assert.equal(target.curse,undefined);assert.equal(user.hp,hp);
   target.curse=true;target.rechargeTurns=1;d._clearImmuneConditions();assert.equal(target.curse,undefined);assert.equal(target.rechargeTurns,1);
   target.curse=true;d._finish(0,'knockout');assert.equal(target.curse,undefined);noRecharge(target);
  }
 }
});
console.log(`Persistent curse checks passed: ${passed} groups covering active-only ticks, KO/revive/heal/rest/end, permanent saves and storage, strict flags, trade rejection, both duel modes, items, deterministic peers and void immunity.`);
