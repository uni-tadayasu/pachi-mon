#!/usr/bin/env node
'use strict';
// The shipped type rules must agree in adventure, single/double duels, saved
// individuals and the connection handshake. Fixtures do not depend on which
// existing species the artwork-driven classification assigns to each type.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const select=marker=>{const code=scripts.find(([,attrs,code])=>!/\bsrc=|application\/ld\+json/.test(attrs)&&code.includes(marker))?.[2];assert(code,marker);return code;};
const copy=value=>JSON.parse(JSON.stringify(value));
function runtime(){
  const timers=new Set(),context=vm.createContext({console,crypto:webcrypto,TextEncoder,Uint8Array,Uint32Array,
    setTimeout(fn,ms){const id=setTimeout(fn,ms);id.unref();timers.add(id);return id;},clearTimeout(id){timers.delete(id);clearTimeout(id);}});
  for(const [,attrs,code]of scripts){if(/\bsrc=|application\/ld\+json/.test(attrs))continue;vm.runInContext(code,context);if(context.LT?.Engine)break;}
  vm.runInContext(select('deterministic, save-independent rental-team duels'),context);
  vm.runInContext(select('peer-to-peer casual duel protocol'),context);
  return {context,LT:context.LT,close(){for(const timer of timers)clearTimeout(timer);}};
}
const env=runtime(),{LT}=env,{DATA:D,TypeSystem:T,Engine,Duel}=LT;
const ORDER=['leaf','tide','ember','wind','crystal','thunder','ice','earth','stone','void','super'];
const EXPECTED=[
  [.8,1.5,.7,1,1,1,.7,1.5,1.5,1],
  [.7,.8,1.5,1,1,.7,1,1.5,1.5,1],
  [1.5,.7,.8,1,1,1,1.5,.7,1,1],
  [1,1,1,.8,1.5,.7,1.5,1,.7,1],
  [1,1,1,1.5,.8,1.5,.7,1,1,1],
  [1,1.5,1,1.5,.7,.8,1,.7,1,1],
  [1.5,1,.7,.7,1.5,1,.8,1,.7,1],
  [.7,.7,1.5,1,1,1.5,1,.8,1,1],
  [.7,.7,1,1.5,1,1,1.5,1,.8,1],
  [1,1,1,1,1,1,1,1,1,1]
];
for(const row of EXPECTED)row.push(.75);EXPECTED.push([...Array(10).fill(1.5),1]);
assert.deepEqual(copy(T.order),ORDER);assert.equal(D.content.elements,9);assert.equal(D.content.totalElements,11);assert.equal(Object.keys(D.elements).length,11);
assert.equal(D.elements.super.name,'超');assert.equal(D.elements.super.hiddenDex,true);assert.equal(D.elements.super.statusImmune,undefined);
assert.deepEqual(['thunder','ice','earth','stone'].map(type=>D.elements[type].name),['雷','氷','土','石']);
for(const [i,attack]of ORDER.entries())for(const [j,defense]of ORDER.entries()){
  assert.equal(T.chart[attack][defense],EXPECTED[i][j],`${attack} → ${defense}: declared chart`);
  assert.equal(T.effectiveness(attack,defense),EXPECTED[i][j]);
  assert.equal(new Engine().effectiveness(attack,defense),EXPECTED[i][j]);
}
// Stone extends the chart without moving any of the original eight matchups.
const legacyTypes=ORDER.filter(type=>!['void','stone','super'].includes(type));
for(const type of legacyTypes){
  assert.equal(legacyTypes.filter(defense=>T.chart[type][defense]===1.5).length,2,`${type}: old strengths changed`);
  assert.equal(legacyTypes.filter(attack=>T.chart[attack][type]===1.5).length,2,`${type}: old weaknesses changed`);
}
assert.deepEqual(ORDER.filter(type=>T.chart.stone[type]===1.5),['wind','ice']);
assert.deepEqual(ORDER.filter(type=>T.chart[type].stone===1.5),['leaf','tide','super']);
assert(Object.isFrozen(T)&&Object.isFrozen(T.chart)&&ORDER.every(type=>Object.isFrozen(T.chart[type])));
const typeCoverage=Object.fromEntries(ORDER.map(type=>[type,0]));let dualSpecies=0;
for(const species of Object.values(D.species)){
  assert(Array.isArray(species.types)&&species.types.length>=1&&species.types.length<=2,`${species.id}: missing or oversized type list`);
  assert.equal(new Set(species.types).size,species.types.length,`${species.id}: duplicate type`);
  assert.equal(species.element,species.types[0],`${species.id}: primary type disagrees with compatibility field`);
  assert(species.types.every(type=>ORDER.includes(type)));assert.deepEqual(copy(T.of(species.id)),copy(species.types));
  if(species.types.includes('void'))assert.deepEqual(copy(species.types),['void']);
  if(species.types.length===2)dualSpecies++;
  for(const type of species.types)typeCoverage[type]++;
  assert(species.moves.some(id=>D.moves[id].kind==='attack'&&T.has(species,D.moves[id].element)),`${species.id}: no matching attack after reclassification`);
}
assert(dualSpecies>0);assert(ORDER.filter(type=>type!=='stone').every(type=>typeCoverage[type]>0),'An active type has no species');assert.equal(typeCoverage.stone,0,'The legacy stone chart is retained after its sole lineage is removed');assert.equal(typeCoverage.super,3);assert.deepEqual(Object.values(D.species).filter(s=>s.types.includes('super')).map(s=>s.id),['verny','vernion','vernix']);
assert.deepEqual(copy(T.of(['tide','wind','wind'])),['tide','wind']);
assert.deepEqual(copy(T.of(['void','leaf'])),['void']);
assert.deepEqual(copy(T.of(['leaf','void'])),['leaf']);
assert.deepEqual(copy(T.of(['invalid','earth','ice','thunder'])),['earth','ice']);
assert.deepEqual(copy(T.of({species:'missing',types:['void'],element:'void'})),[]);
assert.equal(T.effectiveness(null,['tide','wind']),1);assert.equal(T.effectiveness('unknown','leaf'),1);
assert.equal(T.effectiveness('thunder',['tide','wind']),2.25);assert.equal(T.effectiveness('thunder',['crystal','earth']),.49);
assert.equal(T.effectiveness('thunder',['tide','earth']),1.05);assert.equal(T.effectiveness('thunder',['tide','tide']),1.5);
for(const type of ORDER){assert.equal(T.effectiveness('void',[type,'leaf']),type==='super'?.75:1);assert.equal(T.effectiveness(type,'void'),type==='super'?1.5:1);}
assert.deepEqual(copy(T.of(['super','leaf'])),['super']);assert.deepEqual(copy(T.of(['leaf','super'])),['leaf']);assert.equal(T.immune('super'),false);

// Species data is authoritative; do not trust an individual's imported types.
const actorId='type_probe_actor',targetId='type_probe_target';
function species(id,types){
  D.species[id]={...copy(D.species.komori),id,name:id,element:types[0],types:types.slice(),specialOnly:false,adminOnly:false,glitchOnly:false,hiddenDex:false};
}
species(actorId,['earth','thunder']);species(targetId,['tide','wind']);
assert.deepEqual(copy(T.of({species:actorId,types:['void'],element:'void'})),['earth','thunder']);
assert.equal(T.stab('earth',{species:actorId}),1.15);assert.equal(T.stab('thunder',{species:actorId}),1.15);
assert.equal(T.stab('ice',{species:actorId}),1);assert.equal(T.stab(null,{species:actorId}),1);
assert.equal(T.immune({species:actorId,types:['void']}),false);
const team=(id,size)=>[id,...['komori','shizuku','hibana','fuwari'].filter(other=>other!==id)].slice(0,size);
const probe=element=>({id:'type_probe_attack',name:'属性検証',kind:'attack',element,category:'special',power:12,accuracy:100,pp:99});
function solo(attackTypes,defenseTypes){
  species(actorId,attackTypes);species(targetId,defenseTypes);
  const engine=new Engine();assert(engine.newGame('komori').ok);engine.state.party=[engine.makeMonster(actorId,50)];
  assert(engine.startBattle('komori',50,null,{wild:false}));engine.battle.enemy=engine.makeMonster(targetId,50);engine.rng=()=>.5;
  return {engine,actor:engine.state.party[0],target:engine.battle.enemy};
}
function duel(mode,attackTypes,defenseTypes){
  species(actorId,attackTypes);species(targetId,defenseTypes);
  const size=Duel.teamSize(mode),battle=Duel.create({mode,teams:[team(actorId,size),team(targetId,size)],seed:52152});
  battle._random=()=>.5;return battle;
}
function hits(attack,attackTypes,defenseTypes){
  const s=solo(attackTypes,defenseTypes),move=probe(attack),events=[];
  s.engine.applyMove(s.actor,s.target,move,'ally',events);
  const hit=events.find(event=>event.kind==='damage');assert(hit);const out=[hit];
  for(const mode of ['single','double']){
    const d=duel(mode,attackTypes,defenseTypes),mon=d.active(0)[0];mon.pp[move.id]=99;
    d._apply({technique:move,side:0,slot:0,target:0},mon);
    const other=d.state.events.find(event=>event.kind==='damage');assert(other);
    assert.equal(other.effectiveness,hit.effectiveness,`${mode}: affinity differs from adventure`);
    assert.equal(other.amount,hit.amount,`${mode}: type or STAB damage differs from adventure`);out.push(other);
  }
  return out;
}
let battleCases=0;
for(const [i,attack]of ORDER.entries())for(const [j,defense]of ORDER.entries()){
  for(const event of hits(attack,[attack],[defense]))assert.equal(event.effectiveness,EXPECTED[i][j]);battleCases+=3;
}
for(const [attack,defenseTypes,factor]of [['thunder',['tide','wind'],2.25],['thunder',['crystal','earth'],.49],['thunder',['tide','earth'],1.05],['ice',['leaf','crystal'],2.25],['earth',['ember','thunder'],2.25]]){
  for(const event of hits(attack,['leaf',attack],defenseTypes))assert.equal(event.effectiveness,factor);battleCases+=3;
}
const noStab=hits('thunder',['earth'],['void'])[0].amount,primaryStab=hits('thunder',['thunder','earth'],['void'])[0].amount,secondaryStab=hits('thunder',['earth','thunder'],['void'])[0].amount;
assert(primaryStab>noStab);assert.equal(primaryStab,secondaryStab,'Secondary STAB is weaker or stacks with primary');

// Each old status is resisted by either declared type. Void still clears all
// statuses and curse, while ordinary dual types remain susceptible to curse.
for(const info of Object.values(D.statuses)){
  const s=solo(['thunder'],['earth',info.element]),move=probe(info.element);
  assert.equal(s.engine.inflictCondition(s.target,'enemy',move,[],true),false,`${info.id}: secondary type did not resist`);
  assert.equal(s.target.status,undefined);assert.equal(LT.ConditionRules.isImmune(s.target),false);
  species(targetId,['thunder','ice']);assert.equal(s.engine.inflictCondition(s.target,'enemy',move,[],true),true,`${info.id}: positive control`);
  for(const mode of ['single','double']){
    const d=duel(mode,['thunder'],['earth',info.element]),mon=d.active(1)[0];
    assert.equal(d._inflict(1,0,mon,move,true),false);
    species(targetId,['thunder','ice']);assert.equal(d._inflict(1,0,mon,move,true),true);
  }
}
species(targetId,['void']);const immune={species:targetId,status:'bloom',statusTurns:2,curse:true};
assert.equal(LT.ConditionRules.clearImmune(immune),true);assert.equal(immune.status,undefined);assert.equal(immune.curse,undefined);
species(targetId,['earth','ice']);const cursed={species:targetId,curse:true};assert.equal(LT.ConditionRules.clearImmune(cursed),false);assert.equal(cursed.curse,true);

// Legacy saves carry identity, progress and PP, not cached classifications.
const adventure=new Engine();assert(adventure.newGame('komori').ok);
const mon=adventure.state.party[0];mon.level=50;mon.xp=7;adventure.restoreMonster(mon);mon.hp-=13;mon.nickname='テスト';mon.shiny=true;mon.heldItem='leafcrown';mon.curse=true;mon.alloc={hp:3,atk:5};mon.moveOrder=[2,0,3,1];
for(const [i,key]of Object.keys(mon.pp).entries())mon.pp[key]=i;
const oldSave=copy(adventure.serialize()),originalSpecies=D.species.komori;
try{
  D.species.komori={...originalSpecies,element:'earth',types:['earth','ice']};
  for(const version of [1,2,3,4]){
    const legacy=copy(oldSave);legacy.version=version;
    const savedBefore=JSON.stringify(legacy),loaded=new Engine(legacy),restored=loaded.state.party[0];
    assert.equal(JSON.stringify(legacy),savedBefore,'Load mutated the source save');
    for(const key of ['uid','species','level','xp','hp','pp','nickname','shiny','heldItem','curse','alloc','moveOrder'])assert.deepEqual(copy(restored[key]),copy(oldSave.party[0][key]),`v${version}: ${key} changed during reclassification`);
    assert.deepEqual(copy(T.of(restored)),['earth','ice']);
    assert(!Object.hasOwn(restored,'types')&&!Object.hasOwn(restored,'element'));
    assert.deepEqual(copy(T.of(new Engine(copy(loaded.serialize())).state.party[0])),['earth','ice']);
  }
  const spoof=copy(oldSave);spoof.party[0].types=['void'];spoof.party[0].element='void';
  const restored=new Engine(spoof).state.party[0];assert.deepEqual(copy(T.of(restored)),['earth','ice']);assert.equal(restored.curse,true);
}finally{D.species.komori=originalSpecies;}

// AI uses the whole opposing combination and either source type's STAB.
for(const [actorTypes,targetTypes,firstType,secondType,firstPower,secondPower]of [
  [['earth'],['leaf','wind'],'ice','ember',30,30],
  [['earth','ice'],['void'],'ember','ice',30,29]
]){
  const ids=['type_probe_first','type_probe_second'];
  D.moves[ids[0]]={...probe(firstType),id:ids[0],power:firstPower};D.moves[ids[1]]={...probe(secondType),id:ids[1],power:secondPower};
  const moves=[...ids,'focus','restsong'],s=solo(actorTypes,targetTypes);
  D.species[actorId].moves=moves;const actor=s.engine.makeMonster(actorId,50),target=s.engine.makeMonster(targetId,50);
  s.engine.state.party=[target];s.engine.battle.enemy=actor;s.engine.battle.guardian='type-probe';s.engine.battle.turn=1;s.engine.rng=()=>0;
  let selected;s.engine.applyMove=(_actor,_target,move)=>{selected=move.id;};s.engine.enemyTurn([]);assert.equal(selected,ids[1],'Adventure AI ignored a secondary type');
  for(const mode of ['single','double']){
    const size=Duel.teamSize(mode),d=Duel.create({mode,teams:[team(actorId,size),team(targetId,size)],seed:52});
    const order=d.legalOrders(0).find(order=>order.slot===0);assert.equal(d.moves(d.active(0)[0])[order.move].id,ids[1],`${mode} AI ignored a secondary type`);
  }
  delete D.moves[ids[0]];delete D.moves[ids[1]];
}
delete D.species[actorId];delete D.species[targetId];

// Compatibility includes secondary types and the numeric chart, so two clients
// with different rules stop at the handshake instead of diverging during play.
assert.equal(Duel.rules.version,11);assert.match(Duel.rules.types,/two-type-product/);
const initialFingerprint=Duel.rulesFingerprint(),original=D.species.komori;
D.species.komori={...original,types:[original.element,original.element==='thunder'?'ice':'thunder']};
assert.notEqual(Duel.rulesFingerprint(),initialFingerprint);D.species.komori=original;assert.equal(Duel.rulesFingerprint(),initialFingerprint);
const changedChart={...T.chart,thunder:{...T.chart.thunder,tide:1}};
LT.TypeSystem={...T,chart:changedChart};vm.runInContext(select('deterministic, save-independent rental-team duels'),env.context);
assert.notEqual(LT.Duel.rulesFingerprint(),initialFingerprint,'Numeric type chart was excluded from compatibility');LT.TypeSystem=T;LT.Duel=Duel;
async function handshake(remote){
  const queue=[],sessions=[env,remote].map((source,role)=>new source.LT.DuelSession({role,mode:'single',send(message){queue.push({from:role,message:copy(message)});return true;}}));
  try{sessions.forEach(session=>session.start());let count=0;while(queue.length){assert(++count<20);const {from,message}=queue.shift();await sessions[1-from].receive(message);}
    assert(sessions.every(session=>session.snapshot().phase==='error'));assert(sessions.every(session=>session.duel===null));assert(sessions.some(session=>session.snapshot().message.includes('バージョン')));
  }finally{sessions.forEach(session=>session.close());}
}
async function main(){
  const remote=runtime();try{const s=remote.LT.DATA.species.komori;remote.LT.DATA.species.komori={...s,types:[s.element,s.element==='thunder'?'ice':'thunder']};await handshake(remote);}finally{remote.close();}
  console.log(JSON.stringify({ok:true,publicTypes:9,hiddenTypes:2,dualSpecies,typeCoverage,legacyChartPreserved:true,legacyStrengths:2,legacyWeaknesses:2,stoneStrengths:['wind','ice'],stoneWeaknesses:['leaf','tide'],battleCases,dualRange:[.49,2.25],bothTypeStab:true,secondaryStatusResistance:true,saveVersions:[1,2,3,4],saveIdentityAndPPPreserved:true,individualTypeSpoofRejected:true,adventureAndDuelAI:true,mismatchedTypeHandshakeRejected:true},null,2));
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;}).finally(()=>env.close());
