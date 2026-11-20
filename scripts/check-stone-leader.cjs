#!/usr/bin/env node
'use strict';
// Exercise the shipped stone leader through acquisition, save migration and
// all three combat modes. The public encyclopedia remains a 256-species book.
const assert=require('node:assert/strict'),test=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const blocks=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)],context=vm.createContext({console});
for(const [,attrs,code]of blocks){
  if(/\bsrc=|application\/ld\+json/.test(attrs))continue;
  vm.runInContext(code,context);if(context.LT?.Engine)break;
}
const code=marker=>{const value=blocks.find(([,attrs,source])=>!/\bsrc=/.test(attrs)&&source.includes(marker));assert(value,marker);return value[2];};
vm.runInContext(code('deterministic, save-independent rental-team duels'),context);
const {LT}=context,{DATA:D,Engine,Duel,TypeSystem:T,Abilities:A}=LT;
const plain=value=>JSON.parse(JSON.stringify(value)),ID='galdoras',EVOLVED_ID='galdogran';
const IDS=['galdoras_crown','galdoras_fault','galdoras_bastion','galdoras_mend'];
const owner={id:'P1234567890abcdef',isAdmin:true};
const hero=()=>{const e=new Engine();assert(e.newGame('komori').ok);e.rng=()=>.5;return e;};
const team=(id,size)=>[id,...['hibana','shizuku','fuwari','kirari'].filter(other=>other!==id)].slice(0,size);
function fight(mode='solo',side=0,slot=0,targetId='hibana',actorId=ID){
  if(mode==='solo'){
    const e=hero(),label=side?'enemy':'ally',opposite=side?'ally':'enemy';
    e.state.party=[e.makeMonster(side?targetId:actorId,50),e.makeMonster('shizuku',50)];
    assert(e.startBattle('hibana',50,null,{wild:false}));e.battle.enemy=e.makeMonster(side?actorId:targetId,50);
    const actor=side?e.battle.enemy:e.state.party[0],target=side?e.state.party[0]:e.battle.enemy;
    return {e,actor,target,actorStages:e.battle.stages[label],targetStages:e.battle.stages[opposite],
      max:mon=>e.stats(mon).hp,random:fn=>{e.rng=fn;},
      targetGuard(value){if(value!==undefined)e.battle[opposite+'Guard']=value;return e.battle[opposite+'Guard'];},
      ownGuard:()=>e.battle[label+'Guard'],
      cast(id){const events=[];e.applyMove(actor,target,D.moves[id],label,events);return events;}};
  }
  const size=Duel.teamSize(mode),roster=(id,index)=>{const list=team(id,size);list.splice(index,0,list.shift());return list;};
  const teams=[roster(actorId,slot),roster(targetId,slot)];if(side)teams.reverse();
  const d=Duel.create({mode,teams,seed:650065}),actor=d.active(side)[slot],target=d.active(1-side)[slot];d._random=()=>.5;
  return {d,actor,target,actorStages:actor.stages,targetStages:target.stages,max:mon=>mon.maxHp,random:fn=>{d._random=fn;},
    targetGuard(value){if(value!==undefined)target.guard=value;return target.guard;},ownGuard:()=>actor.guard,
    cast(id){d.state.events=[];d._apply({type:'move',side,slot,target:slot,technique:D.moves[id]},actor);return d.state.events;}};
}
function positions(run){for(const mode of ['solo','single','double'])for(const side of [0,1])for(let slot=0;slot<(mode==='double'?2:1);slot++)run(mode,side,slot);}
const damage=events=>{const hit=events.find(event=>event.kind==='damage');assert(hit&&hit.amount>0,'An actual hit must deal damage');return hit;};

test('the stone/earth lineage preserves the original leader and shares four exclusive techniques and canonical armor',()=>{
  const s=D.species[ID];assert(s);assert.equal(s.name,'ガルドラス');assert.equal(s.title,'巌冠の覇王');
  assert.deepEqual(plain(s.types),['stone','earth']);assert.equal(s.element,'stone');assert.equal(D.elements.stone.name,'石');
  assert(s.hiddenDex&&s.glitchOnly&&s.specialOnly&&s.hiddenLeader);assert.equal(s.acquisition,'operator-secret');
  assert.equal(s.evolvesTo,EVOLVED_ID);assert.equal(s.evolveLevel,50);assert.equal(s.atlasNumber,undefined);assert.deepEqual(plain(D.offDexLeaders.ids),[ID,EVOLVED_ID]);
  assert.deepEqual(plain(s.base),{hp:66,atk:46,def:44,spAtk:26,spDef:36,speed:18,accuracy:100,evasion:100});
  assert.deepEqual(plain(s.moves),IDS);assert.deepEqual(plain(D.offDexLeaders.moves),IDS);
  const expected=[['stone','attack','physical',70,95,8,'pierce'],['earth','attack','physical',90,90,5,'attackRecharge'],
    ['stone','guard','status',0,100,6,undefined],['earth','heal','status',50,100,6,undefined]];
  IDS.forEach((id,index)=>{const m=D.moves[id];assert(m.hiddenDex);assert.deepEqual([m.element,m.kind,m.category,m.power,m.accuracy,m.pp,m.effect],expected[index]);
    assert.deepEqual(Object.values(D.species).filter(species=>species.moves.includes(id)).map(species=>species.id),[ID,EVOLVED_ID]);});
  assert.equal(A.get(ID).name,'巌王の甲殻');assert.equal(A.get(ID).kind,'defense');assert.deepEqual(plain(A.get(ID).params),{category:'physical',mul:.8});
  const total=species=>['hp','atk','def','spAtk','spDef','speed'].reduce((sum,key)=>sum+species.base[key],0);
  assert(Object.values(D.species).filter(species=>species.hiddenDex&&![ID,EVOLVED_ID].includes(species.id)).every(species=>total(s)>total(species)));
  assert(s.base.speed<s.base.atk&&s.base.speed<s.base.def,'The physical leader retains its deliberate speed tradeoff');
  const evolved=D.species[EVOLVED_ID];assert.equal(evolved.name,'ガルドグラン');assert(!evolved.evolvesTo);
  assert(evolved.hiddenDex&&evolved.glitchOnly&&evolved.specialOnly&&evolved.hiddenLeader&&evolved.evolutionOnly&&evolved.evolved);
  assert.equal(evolved.acquisition,'operator-secret');assert.equal(evolved.atlasNumber,undefined);
  assert.deepEqual(plain(evolved.types),plain(s.types));assert.deepEqual(plain(evolved.moves),IDS);assert.equal(A.get(EVOLVED_ID).id,A.get(ID).id);
  for(const key of ['hp','atk','def','spAtk','spDef','speed'])assert(evolved.base[key]>s.base[key]&&evolved.base[key]<=s.base[key]*1.25,`${key}: evolution remains a measured increase`);
  assert(total(evolved)>total(s));assert.equal(T.effectiveness('leaf',EVOLVED_ID),2.25);assert.equal(T.effectiveness('tide',EVOLVED_ID),2.25);
});

test('public discovery, ordinary encounters, trainers, collection goals and new adventures exclude the leader',()=>{
  assert.equal(Object.keys(D.species).length,269);assert.equal(Object.values(D.species).filter(s=>!s.hiddenDex).length,256);
  assert.equal(D.content.hiddenSpecies,13);assert.equal(D.content.playableSpecies,269);assert.equal(D.content.totalSpecies,256);
  for(const id of [ID,EVOLVED_ID]){
    assert(!D.starters.includes(id));assert(!D.collectionRoutes.wild.includes(id));assert(Object.values(D.collectionRoutes.starters).every(ids=>!ids.includes(id)));
    assert(Object.values(D.maps).every(map=>!map.encounters?.includes(id)));
    for(const group of [D.rivals,D.guardians,D.elites,D.champions])assert(Object.values(group).every(trainer=>trainer.species!==id&&!trainer.team?.some(mon=>mon.species===id)));
  }
  const e=hero(),before=plain(e.quests());assert(![...e.state.party,...e.state.storage].some(mon=>mon.species===ID));
  e.markCaught(ID);assert.deepEqual(plain(e.quests()),before);assert.equal(e.state.flags.nullLineClaimed,undefined);
  for(const id of [ID,EVOLVED_ID]){assert.equal(LT.TradeRules.isEligible(e.makeMonster(id,50)),false);assert.throws(()=>e.tradeMonster(e.makeMonster(id,50)),/交換/);}
});

test('operator capture requires current authorization and preserves requested sex, appearance, form and level',()=>{
  for(const denied of [null,{}, {id:owner.id,isAdmin:false},{id:'invalid',isAdmin:true},{id:owner.id,isAdmin:1}]){
    const e=hero(),before=JSON.stringify(e.state);assert.equal(e.startAdminEncounter(ID,70,denied).ok,false);assert.equal(JSON.stringify(e.state),before);assert.equal(e.battle,null);
  }
  for(const id of [ID,EVOLVED_ID])for(const destination of ['party','storage'])for(const gender of ['male','female'])for(const level of [1,70,100]){
    const e=hero();if(destination==='storage')while(e.state.party.length<D.limits.party)e.state.party.push(e.makeMonster('komori',5));
    assert(e.startAdminEncounter(id,level,owner,{gender,shiny:true}).ok);assert.equal(e.resonanceChance(),1);
    assert(e.action({type:'resonate'}).ok);const mon=e.state[destination].at(-1);
    assert.equal(mon.species,id);assert.equal(mon.level,level);assert.equal(mon.gender,gender);assert.equal(mon.shiny,true);
    assert.deepEqual(Object.keys(mon.pp),IDS);assert.equal(e.state.flags.nullLineClaimed,undefined);
    assert.deepEqual(plain(new Engine(e.serialize()).state[destination].at(-1)),plain(mon));
  }
});

test('save round-trips keep the owned individual while rejecting forged type and ability overrides',()=>{
  for(const id of [ID,EVOLVED_ID])for(const destination of ['party','storage']){
    const e=hero(),mon=e.makeMonster(id,100);e.state[destination].push(mon);e.markCaught(id);
    Object.assign(mon,{nickname:'いわおう',gender:'female',shiny:true,heldItem:'trainband',alloc:{hp:32,atk:32,def:32,spAtk:32,spDef:32,speed:32},moveOrder:[3,1,0,2],curse:true});
    mon.hp=e.stats(mon).hp-7;mon.pp.galdoras_crown=1;
    const expected=plain(mon);
    for(const version of [1,2,3,4]){
      const saved=plain(e.serialize());saved.version=version;
      Object.assign(saved[destination].at(-1),{types:['void'],element:'void',ability:'shadow_reader'});
      const restored=new Engine(saved).state[destination].at(-1);
      assert.deepEqual(plain(restored),expected);assert.deepEqual(plain(T.of(restored)),['stone','earth']);assert.equal(A.get(restored).id,'sovereign_carapace');
    }
    const oldMax=e.stats(mon).hp,events=[];e.giveXP(mon,999999,events);assert.equal(mon.level,100);assert.equal(mon.species,EVOLVED_ID);
    assert.equal(events.filter(event=>event.kind==='evolve').length,id===ID?1:0);
    assert.equal(mon.hp,id===ID?Math.round(expected.hp*e.stats(mon).hp/oldMax):expected.hp);
    assert.deepEqual({...plain(mon),species:id,hp:expected.hp},expected,'Evolution preserves the existing individual and all non-form data');
  }
});

test('Lv50 threshold and explicit evolution also work for existing reserve and Lv100 individuals without forced load migration',()=>{
  const threshold=hero(),young=threshold.makeMonster(ID,49);threshold.state.party.push(young);
  let events=[];threshold.giveXP(young,threshold.xpToNext(49)-1,events);assert.equal(young.species,ID);assert.equal(young.level,49);
  assert.equal(threshold.evolveOwned(young.uid).ok,false);
  events=[];threshold.giveXP(young,1,events);assert.equal(young.species,EVOLVED_ID);assert.equal(young.level,50);
  assert.equal(events.filter(event=>event.kind==='evolve').length,1);assert(!events.some(event=>event.kind==='learn'));
  for(const destination of ['party','storage'])for(const level of [50,70,100])for(const health of [0,.37,1]){
    const e=hero(),mon=e.makeMonster(ID,level);e.state[destination].push(mon);e.markCaught(ID);
    Object.assign(mon,{nickname:'いしのこ',gender:'male',shiny:true,heldItem:'trainband',bonusPoints:99,
      alloc:{hp:32,atk:32,def:32,spAtk:32,spDef:32,speed:32},moveOrder:[3,1,0,2],curse:true,xp:level===100?0:19});
    mon.hp=Math.round(e.stats(mon).hp*health);mon.pp.galdoras_crown=1;mon.pp.galdoras_fault=0;
    const old=plain(mon),oldMax=e.stats(mon).hp,load=new Engine(e.serialize());
    assert.deepEqual(plain(load.state[destination].at(-1)),old,'Loading an old high-level record must not force evolution');
    const result=e.evolveOwned(mon.uid);assert(result.ok);assert.equal(result.events.filter(event=>event.kind==='evolve').length,1);
    assert.equal(mon.species,EVOLVED_ID);assert.equal(mon.hp,health?Math.max(1,Math.round(old.hp*e.stats(mon).hp/oldMax)):0);
    assert.deepEqual({...plain(mon),species:ID,hp:old.hp},old,'Manual evolution retains UID, XP, PP, allocation, item, nickname and move order');
    assert(e.state.caught.includes(ID)&&e.state.caught.includes(EVOLVED_ID));assert.equal(e.state.stats.evolutions,1);
    assert.deepEqual(plain(new Engine(e.serialize()).state[destination].at(-1)),plain(mon));
    const after=JSON.stringify(e.state);assert.equal(e.evolveOwned(mon.uid).ok,false);assert.equal(JSON.stringify(e.state),after);
  }
});

test('owned evolution rejects unowned or busy targets and respects the evolution-stopping held item',()=>{
  const e=hero(),mon=e.makeMonster(ID,100);e.state.storage.push(mon);mon.heldItem='everpebble';
  const before=JSON.stringify(e.state);assert.equal(e.evolveOwned(mon.uid).ok,false);assert.equal(JSON.stringify(e.state),before);
  const events=[];e.giveXP(mon,1,events);assert.equal(mon.species,ID);assert(!events.some(event=>event.kind==='evolve'));
  assert.equal(e.evolveOwned('not-owned').ok,false);assert.equal(e.evolveOwned(e.state.party[0].uid).ok,false);
  delete mon.heldItem;assert(e.startBattle('hibana',5,null,{wild:false}));
  const inBattle=JSON.stringify(e.state);assert.equal(e.evolveOwned(mon.uid).ok,false);assert.equal(JSON.stringify(e.state),inBattle);
  e.battle=null;assert(e.evolveOwned(mon.uid).ok);assert.equal(mon.species,EVOLVED_ID);
});

test('stone and earth attacks use physical stats, consistent damage, guard penetration and the declared matchups',()=>{
  for(const id of IDS.slice(0,2)){
    let reference;
    positions((mode,side,slot)=>{
      // Avoid a knockout cap so the same raw damage is observable in both
      // engines; duel event amounts otherwise stop at the opponent's HP.
      const f=fight(mode,side,slot),pp=f.actor.pp[id];f.target.hp=10000;const hit=damage(f.cast(id));
      assert.equal(hit.category,'physical');assert.equal(f.actor.pp[id],pp-1);
      assert.equal(hit.effectiveness,T.effectiveness(D.moves[id].element,f.target));
      if(reference===undefined)reference=hit.amount;else assert.equal(hit.amount,reference,`${mode}/${side}/${slot}: identical Lv50 damage`);
      const guarded=fight(mode,side,slot);guarded.target.hp=10000;guarded.targetGuard(true);const other=damage(guarded.cast(id)).amount;
      if(id===IDS[0])assert.equal(other,hit.amount,'Piercing stone attack ignores the next-hit guard');else assert(other<hit.amount,'Earth attack respects guard');
      const special=fight(mode,side,slot);special.target.hp=10000;special.actorStages.spAtk=6;assert.equal(damage(special.cast(id)).amount,hit.amount);
      const physical=fight(mode,side,slot);physical.target.hp=10000;physical.actorStages.atk=1;assert(damage(physical.cast(id)).amount>hit.amount);
    });
  }
  assert.equal(T.effectiveness('leaf',ID),2.25);assert.equal(T.effectiveness('tide',ID),2.25);
  assert.equal(T.effectiveness('wind',ID),.7);assert.equal(T.effectiveness('ice',ID),.7);assert.equal(T.effectiveness('thunder',ID),.7);
  assert.equal(T.effectiveness('stone',['wind','ice']),2.25);assert.equal(T.effectiveness('stone','void'),1);
  for(const type of ['stone','earth'])assert.equal(T.stab(type,ID),1.15);
});

test('the large earth attack consumes one rest turn after a hit and no rest turn after a miss',()=>{
  positions((mode,side,slot)=>{
    const f=fight(mode,side,slot);damage(f.cast(IDS[1]));assert.equal(f.actor.rechargeTurns,1);
    const beforePP=plain(f.actor.pp),hp=f.target.hp,blocked=f.cast(IDS[0]);
    assert.equal(blocked.filter(event=>event.kind==='recharge').length,1);assert.equal(f.actor.rechargeTurns,undefined);assert.deepEqual(plain(f.actor.pp),beforePP);assert.equal(f.target.hp,hp);
    assert(f.cast(IDS[2]).some(event=>event.kind==='guard'));assert.equal(f.actor.pp[IDS[2]],beforePP[IDS[2]]-1);
    const miss=fight(mode,side,slot);miss.actorStages.accuracy=-6;miss.targetStages.evasion=6;miss.random(()=>.999999);
    assert(miss.cast(IDS[1]).some(event=>event.kind==='miss'));assert.equal(miss.actor.rechargeTurns,undefined);
  });
});

test('guard and half recovery protect or restore the user without changing the opponent or curing permanent curse',()=>{
  positions((mode,side,slot)=>{
    const f=fight(mode,side,slot),target=plain(f.target),pp=plain(f.actor.pp);
    assert(f.cast(IDS[2]).some(event=>event.kind==='guard'));assert.equal(f.ownGuard(),true);assert.equal(f.actor.pp[IDS[2]],pp[IDS[2]]-1);
    f.actor.hp=1;f.actor.curse=true;f.actor.status='scorch';const max=f.max(f.actor),events=f.cast(IDS[3]);
    assert.equal(f.actor.hp,1+Math.ceil(max/2));assert.equal(events.find(event=>event.kind==='heal').amount,Math.ceil(max/2));
    assert.equal(f.actor.curse,true);assert.equal(f.actor.status,'scorch');assert.deepEqual(plain(f.target),target);
    f.actor.hp=max-1;f.cast(IDS[3]);assert.equal(f.actor.hp,max);assert.equal(f.actor.rechargeTurns,undefined);
  });
});

test('the physical armor reduces actual incoming hits by 20% and stone never inherits Void condition immunity',()=>{
  const control='stone_leader_no_ability';D.species[control]={...D.species[ID],id:control};
  try{
    assert.equal(A.get(control),null);
    for(const mode of ['solo','single','double'])for(const category of ['physical','special']){
      const id='stone_probe_'+category;D.moves[id]={id,name:'検証の一撃',element:'stone',kind:'attack',category,power:20,accuracy:100,pp:99};
      const cast=targetId=>{const f=fight(mode,0,mode==='double'?1:0,targetId,'galdoras');f.actor.pp[id]=99;
        // Adventure syncs PP to learned moves; temporarily supply the probe in a real slot.
        const prior=D.species.galdoras.moves;D.species.galdoras.moves=[id,...prior.slice(1)];
        try{return damage(f.cast(id)).amount;}finally{D.species.galdoras.moves=prior;}};
      const without=cast(control),withArmor=cast(ID);
      if(category==='physical')assert(Math.abs(withArmor-without*.8)<=1,`${mode}: armor applies only its declared physical reduction`);else assert.equal(withArmor,without);
      delete D.moves[id];
    }
  }finally{delete D.species[control];}
  const statusProbe={id:'stone_status_probe',name:'検証',element:'leaf',kind:'attack',category:'physical',power:1,accuracy:100};
  for(const mode of ['solo','single','double']){
    const f=fight(mode,0,mode==='double'?1:0);
    if(mode==='solo')assert.equal(f.e.inflictCondition(f.actor,'ally',statusProbe,[],true),true);
    else assert.equal(f.d._inflict(0,mode==='double'?1:0,f.actor,statusProbe,true),true);
    assert.equal(f.actor.status,'bloom');f.actor.curse=true;assert.equal(LT.ConditionRules.clearImmune(f.actor),false);assert.equal(f.actor.curse,true);
  }
  assert.equal(T.immune(ID),false);assert.equal(T.immune('zeroveil'),true);
});

test('Lv50 duels retain every assigned training point with canonical leader types and deterministic outcomes',()=>{
  const allocation={hp:64,atk:64,def:64,spAtk:41,spDef:0,speed:64};
  for(const mode of ['single','double']){
    const size=Duel.teamSize(mode),config={mode,teams:[team(ID,size),team('komori',size)],seed:650331,allocation:[[allocation,...Array(size-1).fill(null)],null]};
    const a=Duel.create(config),b=Duel.create(config),mon=a.active(0)[0];
    assert.equal(mon.level,50);assert.deepEqual(plain(mon.alloc),allocation);assert.deepEqual(plain(T.of(mon)),['stone','earth']);
    assert.deepEqual(plain(mon.stats),plain(new Engine().stats({species:ID,level:50,alloc:allocation})));
    const orders=[0,1].map(side=>a.active(side).map((_,slot)=>({type:'move',slot,move:0,target:0})));
    a.resolve(plain(orders));b.resolve(plain(orders));assert.equal(a.fingerprint(),b.fingerprint());assert.deepEqual(plain(a.snapshot()),plain(b.snapshot()));
  }
});
