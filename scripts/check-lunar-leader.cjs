#!/usr/bin/env node
'use strict';
// Exercise the shipped psychic lineage through acquisition, save migration and
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
const plain=value=>JSON.parse(JSON.stringify(value)),ID='vernix',LINE=['verny','vernion','vernix'];
const IDS=['vernix_renew','vernix_frost','vernix_psycho','vernix_thunder'];
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

const ALIASES={galdo:'verny',galdoran:'vernion',galdoras:'vernix',galdogran:'vernix',lunax:'verny',lunaxion:'vernix'};
const OLD_IDS=Object.keys(ALIASES);
const OLD_MOVE_ALIASES={galdoras_crown:'vernix_psycho',galdoras_fault:'vernix_frost',galdoras_bastion:'vernix_thunder',galdoras_mend:'vernix_renew',lunax_crescent:'vernix_psycho',lunax_nova:'vernix_frost',lunax_aegis:'vernix_thunder',lunax_renew:'vernix_renew'};
const OLD_MOVES=Object.keys(OLD_MOVE_ALIASES);
const STAT_KEYS=['hp','atk','def','spAtk','spDef','speed','accuracy','evasion'];
const BASES=[{hp:90,atk:64,def:66,spAtk:88,spDef:80,speed:72,accuracy:108,evasion:106},
  {hp:106,atk:80,def:84,spAtk:110,spDef:98,speed:90,accuracy:110,evasion:107},
  {hp:124,atk:94,def:102,spAtk:144,spDef:124,speed:112,accuracy:112,evasion:108}];

test('the three ordered source images define a genderless Super lineage with four exclusive techniques and no active old forms',()=>{
  for(const [stage,id]of LINE.entries()){
    const species=D.species[id];assert.equal(species.name,['ヴェルニィ','ヴェルニオン','ヴェルニクス'][stage]);assert.equal(species.family,'psychic_violet');
    assert.equal(species.sourceImage,['0001.png','0002.png','0003.png'][stage]);assert.equal(species.visual.stage,stage);
    assert.deepEqual(plain(species.base),BASES[stage]);assert.deepEqual(plain(species.types),['super']);assert.equal(species.element,'super');
    assert(species.hiddenDex&&species.glitchOnly&&species.specialOnly);assert.equal(species.acquisition,'operator-secret');assert.equal(species.atlasNumber,undefined);
    assert.equal(species.hiddenLeader===true,stage===2);assert.equal(species.evolved,stage>0);assert.equal(species.evolutionOnly,stage>0);
    assert.equal(species.evolvesTo,LINE[stage+1]);assert.equal(species.evolveLevel,[24,48,undefined][stage]);assert.deepEqual(plain(species.moves),IDS);
    assert(D.genderless.includes(id));assert.equal(LT.genderOf({species:id,gender:'male'}),'none');assert.equal(LT.genderOf({species:id,gender:'female'}),'none');
    assert.equal(A.get(id).id,'psychic_sovereignty');assert.equal(A.get(id).name,'紫紋の念動');assert.equal(A.get(id).kind,'offense');assert.deepEqual(plain(A.get(id).params),{category:'special',mul:1.2});
  }
  assert.equal(A.catalog.sovereign_carapace,undefined);assert.equal(A.catalog.lunar_sovereignty,undefined);assert.equal(D.elements.super.name,'超');assert.equal(D.elements.super.hiddenDex,true);
  assert.deepEqual(Object.values(D.species).filter(s=>T.has(s,'super')).map(s=>s.id),LINE);
  assert.deepEqual(plain(D.offDexLeaders.ids),[ID,'vernion','verny']);assert.deepEqual(plain(D.offDexLeaders.lineage),LINE);assert.equal(D.offDexLeaders.starter,'verny');assert.equal(D.offDexLeaders.leader,ID);
  const expected=[['super','heal','status',100,100,5,undefined],['ice','attack','special',95,100,10,undefined],['super','attack','special',120,100,8,'pierce'],['thunder','attack','special',110,95,10,undefined]];
  IDS.forEach((id,index)=>{const m=D.moves[id];assert(m.hiddenDex);assert.deepEqual([m.element,m.kind,m.category,m.power,m.accuracy,m.pp,m.effect],expected[index]);assert.deepEqual(Object.values(D.species).filter(s=>s.moves.includes(id)).map(s=>s.id),LINE);});
  for(const id of OLD_IDS){assert.equal(D.species[id],undefined);assert.equal(D.retiredSpecies[id],undefined);assert.equal(A.assignments[id],undefined);}
  for(const id of OLD_MOVES)assert.equal(D.moves[id],undefined);
});

test('fixed final stats strictly exceed every other declared species at the same level and assigned training',()=>{
  const e=hero();let comparisons=0;
  for(const level of [1,47,48,50,70,100])for(const trained of [false,true]){
    const each=trained?Math.min(64,Math.floor((level-1)*2/6)):0,alloc=Object.fromEntries(STAT_KEYS.slice(0,6).map(key=>[key,each]));
    const strongest=e.stats({species:ID,level,alloc});
    for(const species of Object.values(D.species))if(species.id!==ID){
      const other=e.stats({species:species.id,level,alloc});for(const key of STAT_KEYS){assert(strongest[key]>other[key],`${level}/${trained}/${species.id}/${key}`);comparisons++;}
    }
    const base=e.stats({species:'verny',level,alloc});for(const species of ['futo','zeroveil','arvelion','floravelle'])for(const key of STAT_KEYS)assert(base[key]>e.stats({species,level,alloc})[key],species+' stays below the exceptional normal form');
  }
  assert(comparisons>25000);
  // Deliberate operator configuration stays an explicit override, not a reason
  // to grow the species dynamically whenever an administrator changes Futo.
  const custom=e.makeMonster('futo',50,{hp:99999,atk:9999,def:9999,spAtk:9999,spDef:9999,speed:9999,accuracy:300,evasion:300});
  assert.equal(e.stats(custom).hp,99999);assert.deepEqual(plain(D.species[ID].base),BASES[2]);
});

test('Super wins every non-Super type matchup without immunity and public discovery stays at 256 entries',()=>{
  for(const type of T.order){assert.equal(T.effectiveness('super',type),type==='super'?1:1.5);assert.equal(T.effectiveness(type,'super'),type==='super'?1:.75);}
  assert.equal(T.effectiveness('super',['tide','wind']),2.25);assert.equal(T.immune(ID),false);assert.equal(T.immune('zeroveil'),true);assert.equal(T.stab('super',ID),1.15);
  assert.equal(Object.keys(D.species).length,270);assert.equal(D.content.playableSpecies,270);assert.equal(D.content.hiddenSpecies,14);assert.equal(D.content.totalSpecies,256);
  assert.equal(Object.values(D.species).filter(s=>!s.hiddenDex).length,256);
  for(const id of [...LINE,...OLD_IDS]){
    assert(!D.starters.includes(id));assert(!D.collectionRoutes.wild.includes(id));assert(Object.values(D.collectionRoutes.starters).every(ids=>!ids.includes(id)));
    assert(Object.values(D.maps).every(map=>!map.encounters?.includes(id)));
    for(const group of [D.rivals,D.guardians,D.elites,D.champions])assert(Object.values(group).every(trainer=>trainer.species!==id&&!trainer.team?.some(mon=>mon.species===id)));
  }
  const e=hero(),before=plain(e.quests());for(const id of LINE){e.markCaught(id);assert.equal(LT.TradeRules.isEligible(e.makeMonster(id,50)),false);assert.throws(()=>e.tradeMonster(e.makeMonster(id,50)),/交換/);}
  assert.deepEqual(plain(e.quests()),before);assert.equal(e.state.flags.nullLineClaimed,undefined);
  for(const id of OLD_IDS){assert.throws(()=>e.makeMonster(id,50));assert.equal(e.startAdminEncounter(id,50,owner).ok,false);}
});

test('operator capture requires authorization, enforces no gender and preserves form, level and shiny appearance',()=>{
  for(const denied of [null,{}, {id:owner.id,isAdmin:false},{id:'invalid',isAdmin:true},{id:owner.id,isAdmin:1}]){
    const e=hero(),before=JSON.stringify(e.state);assert.equal(e.startAdminEncounter(ID,70,denied).ok,false);assert.equal(JSON.stringify(e.state),before);assert.equal(e.battle,null);
  }
  for(const id of LINE)for(const destination of ['party','storage'])for(const level of [1,47,48,70,100]){
    const e=hero();if(destination==='storage')while(e.state.party.length<D.limits.party)e.state.party.push(e.makeMonster('komori',5));
    for(const gender of ['male','female'])assert.equal(e.startAdminEncounter(id,level,owner,{gender}).ok,false);
    assert(e.startAdminEncounter(id,level,owner,{gender:'auto',shiny:true}).ok);assert.equal(e.resonanceChance(),1);assert.equal(LT.genderOf(e.battle.enemy),'none');
    assert(e.action({type:'resonate'}).ok);const mon=e.state[destination].at(-1);
    assert.equal(mon.species,id);assert.equal(mon.level,level);assert.equal(mon.gender,undefined);assert.equal(LT.genderOf(mon),'none');assert.equal(mon.shiny,true);assert.deepEqual(Object.keys(mon.pp),IDS);
    assert.deepEqual(plain(new Engine(e.serialize()).state[destination].at(-1)),plain(mon));
  }
});

const legacySaves=['v69-stone-leader-save.json','v73-retired-line-save.json','v82-lunar-leader-save.json'].map(file=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',file),'utf8')));
const expectedOwned=before=>{
  const out=plain(before);
  if(ALIASES[out.species]){
    out.species=ALIASES[out.species];delete out.gender;
    out.pp=Object.fromEntries(Object.entries(out.pp).map(([id,value])=>{const move=OLD_MOVE_ALIASES[id]||id;return [move,Math.min(value,D.moves[move].pp)];}));
    out.hp=Math.min(out.hp,new Engine().stats(out).hp);
  }
  return out;
};
test('real historical saves migrate all six old forms without changing identity, spent PP, progress or stable receipts',()=>{
  for(const fixture of legacySaves)for(const version of [1,2,3,4]){
    const input=plain(fixture);input.version=version;const untouched=plain(input),e=new Engine(input);assert.deepEqual(input,untouched,'Import leaves the original backup intact');
    for(const location of ['party','storage']){
      assert.equal(e.state[location].length,input[location].length,'Migration neither duplicates nor discards an owned individual');
      input[location].forEach((before,index)=>{assert.deepEqual(plain(e.state[location][index]),expectedOwned(before),before.uid);if(ALIASES[before.species])assert.equal(LT.genderOf(e.state[location][index]),'none');});
    }
    assert.deepEqual(plain(e.state.giftReceipts),input.giftReceipts);
    for(const key of ['seen','caught'])assert.deepEqual(plain(e.state[key]),[...new Set(input[key].map(id=>ALIASES[id]||id))]);
    if(version>=2)assert.deepEqual(plain(e.state.stats),input.stats);
    assert.deepEqual(plain(new Engine(e.serialize()).state),plain(e.state),'Repeated import is idempotent');
  }
});

test('mixed old/current PP keys normalize exactly, aliases cannot collide, and malformed saves stay rejected',()=>{
  const e=hero(),base=plain(legacySaves[1]),legacy=base.party[1];
  for(const species of [...OLD_IDS,...LINE])for(const destination of ['party','storage']){
    const save=e.serialize(),mon={...plain(legacy),species};save[destination].push(mon);for(const key of ['seen','caught'])save[key].push(species);
    const restored=new Engine(save).state[destination].at(-1);assert.equal(restored.species,ALIASES[species]||species);assert.equal(restored.gender,undefined);assert.deepEqual(plain(restored.pp),{vernix_renew:2,vernix_frost:0,vernix_psycho:1,vernix_thunder:3});
    for(const mutate of [mon=>mon.hp=-1,mon=>mon.level=101,mon=>mon.pp.galdoras_crown=-1,mon=>mon.pp.galdoras_crown=9,mon=>mon.pp.galdoras_mend=7,mon=>mon.pp.galdoras_fault=6,mon=>mon.pp.galdoras_bastion=7,mon=>delete mon.pp.galdoras_mend,mon=>mon.moveOrder=[0,0,1,2],mon=>mon.pp.vernix_psycho=1,mon=>mon.pp.lunax_crescent=0]){
      const bad=plain(save);mutate(bad[destination].at(-1));assert.throws(()=>new Engine(bad));
    }
    const mixed=plain(save),pp=mixed[destination].at(-1).pp;pp.lunax_aegis=pp.galdoras_bastion;delete pp.galdoras_bastion;
    assert.deepEqual(plain(new Engine(mixed).state[destination].at(-1).pp),plain(restored.pp));
    const duplicate=plain(save);duplicate[destination].push(plain(mon));assert.throws(()=>new Engine(duplicate),'Duplicated UID is never merged or accepted');
  }
  const canonical=e.serialize(),mon=e.makeMonster(ID,20);mon.pp=plain(legacy.pp);mon.hp=999999;canonical.party.push(mon);e.markCaught(ID);canonical.caught.push(ID);canonical.seen.push(ID);assert.throws(()=>new Engine(canonical),'PP migration cannot weaken canonical HP validation');
});

test('only automatic former species names are removed and all current custom names remain untouched',()=>{
  const e=hero(),names={galdo:'ガルド',galdoran:'ガルドラン',galdoras:'ガルドラス',galdogran:'ガルドグラン',lunax:'ルナクス',lunaxion:'ルナクシオン'};
  for(const species of OLD_IDS)for(const nickname of [names[species],'むらさき']){
    const save=e.serialize(),mon={...plain(legacySaves[1].party[1]),species,nickname};save.storage.push(mon);for(const key of ['seen','caught'])save[key].push(species);
    const restored=new Engine(save).state.storage.at(-1);assert.equal(restored.nickname,nickname===names[species]?undefined:nickname);assert.equal(restored.uid,mon.uid);assert.equal(restored.hp,mon.hp);
  }
  // A former species name is also a valid player-chosen nickname. Match only
  // the exact default name of the species currently being migrated, and never
  // rewrite nicknames after the canonical creature has already been saved.
  for(const species of [...OLD_IDS,...LINE])for(const nickname of ['ルナクス','ガルド']){
    if(names[species]===nickname)continue;
    const save=e.serialize(),mon={...plain(legacySaves[1].party[1]),species,nickname};save.storage.push(mon);for(const key of ['seen','caught'])save[key].push(species);
    const restored=new Engine(save),owned=restored.state.storage.at(-1);assert.equal(owned.nickname,nickname);assert.equal(new Engine(restored.serialize()).state.storage.at(-1).nickname,nickname);
  }
});

function levelTo(engine,mon,target){const events=[];while(mon.level<target)engine.giveXP(mon,engine.xpToNext(mon.level)-mon.xp,events);return events;}
test('Lv24 and Lv48 evolutions preserve the individual, order, spent PP, training, held item, conditions and missing HP',()=>{
  for(const destination of ['party','storage']){
    let e=hero(),mon=e.makeMonster('verny',5);e.state[destination].push(mon);e.markCaught('verny');
    Object.assign(mon,{nickname:'しでん',shiny:true,heldItem:'trainband',alloc:{hp:2,spAtk:4},moveOrder:[3,1,0,2],curse:true,status:'scorch',battleGrowth:3});mon.hp=e.stats(mon).hp-9;mon.pp[IDS[0]]=0;mon.pp[IDS[1]]=1;
    const original=plain(mon),pp=plain(mon.pp);assert.equal(levelTo(e,mon,23).filter(event=>event.kind==='evolve').length,0);assert.equal(mon.species,'verny');
    const first=levelTo(e,mon,24);assert.equal(first.filter(event=>event.kind==='evolve').length,1);assert.equal(mon.species,'vernion');assert(!first.some(event=>event.kind==='learn'));assert.equal(e.stats(mon).hp-mon.hp,9);assert.deepEqual(plain(mon.pp),pp);
    assert.equal(levelTo(e,mon,47).filter(event=>event.kind==='evolve').length,0);assert.equal(mon.species,'vernion');
    const events=levelTo(e,mon,48);assert.equal(events.filter(event=>event.kind==='evolve').length,1);assert.equal(mon.species,ID);assert(!events.some(event=>event.kind==='learn'));
    for(const key of ['uid','nickname','shiny','heldItem','alloc','moveOrder','curse','status','battleGrowth'])assert.deepEqual(plain(mon[key]),original[key]);
    assert.deepEqual(plain(mon.pp),pp);assert.equal(e.stats(mon).hp-mon.hp,9);assert.equal(mon.bonusPoints,43);assert.equal(mon.gender,undefined);assert.equal(LT.genderOf(mon),'none');
    e=new Engine(e.serialize());mon=e.state[destination].find(value=>value.uid===original.uid);assert(mon);assert.equal(mon.species,ID);assert.equal(e.state.stats.evolutions,2);
    for(const id of LINE)assert(e.state.caught.includes(id));
  }
});

test('chosen normal forms stay through save/capture and stopping items, then evolve at Lv100 on actual battle XP',()=>{
  for(const form of LINE.slice(0,2)){
    const e=hero(),mon=e.makeMonster(form,1);mon.heldItem='everpebble';e.state.party.push(mon);e.markCaught(form);levelTo(e,mon,100);assert.equal(mon.species,form);
    assert.equal(new Engine(e.serialize()).state.party.at(-1).species,form);delete mon.heldItem;const before=plain(mon),oldMax=e.stats(mon).hp;e.rng=()=>.5;assert(e.startBattle('hibana',1,null,{wild:false}));
    e.battle.enemy.hp=0;const events=[];e.defeatOpponent(events);assert.equal(mon.species,ID);assert.equal(mon.level,100);assert.equal(events.filter(event=>event.kind==='evolve').length,form==='verny'?2:1);assert.deepEqual(plain(mon),{...before,species:ID,hp:before.hp+e.stats(mon).hp-oldMax});
  }
  const legacy=new Engine(legacySaves[1]),old=legacy.state.party[1],uid=old.uid;assert.equal(old.species,'vernion');assert.equal(old.level,49);legacy.giveXP(old,1,[]);assert.equal(old.species,ID);assert.equal(old.uid,uid);assert.equal(old.level,49);
  const trained=hero(),trainee=trained.makeMonster('verny',1),growth=[];trainee.heldItem='trainband';trained.state.party.push(trainee);trained.markCaught('verny');trained.giveXP(trainee,Array.from({length:99},(_,i)=>trained.xpToNext(i+1)).reduce((sum,n)=>sum+n,0),growth);
  assert.equal(trainee.species,ID);assert.equal(trainee.bonusPoints,99);assert.equal(trained.allocationInfo(trainee).free,297);assert.equal(growth.filter(event=>event.kind==='evolve').length,2);assert.equal(growth.filter(event=>event.kind==='level').length,99);
  assert.equal(Engine.prototype.evolveOwned,undefined);
});

test('all three elemental special attacks agree across adventure/single/double, use special stats and spend one PP',()=>{
  for(const id of IDS.slice(1)){
    let reference;positions((mode,side,slot)=>{
      const f=fight(mode,side,slot),pp=f.actor.pp[id];f.target.hp=10000;const hit=damage(f.cast(id));assert.equal(hit.category,'special');assert.equal(hit.effectiveness,T.effectiveness(D.moves[id].element,T.of(f.target)));assert.equal(f.actor.pp[id],pp-1);assert.equal(f.actor.rechargeTurns,undefined);
      if(reference===undefined)reference=hit.amount;else assert.equal(hit.amount,reference,`${mode}/${side}/${slot}`);
      const guarded=fight(mode,side,slot);guarded.target.hp=10000;guarded.targetGuard(true);const other=damage(guarded.cast(id)).amount;if(id===IDS[2])assert.equal(other,hit.amount);else assert(other<hit.amount);
      const physical=fight(mode,side,slot);physical.target.hp=10000;physical.actorStages.atk=6;assert.equal(damage(physical.cast(id)).amount,hit.amount);
      const special=fight(mode,side,slot);special.target.hp=10000;special.actorStages.spAtk=1;assert(damage(special.cast(id)).amount>hit.amount);
      const defense=fight(mode,side,slot);defense.target.hp=10000;defense.targetStages.def=6;assert.equal(damage(defense.cast(id)).amount,hit.amount);
      const specialDefense=fight(mode,side,slot);specialDefense.target.hp=10000;specialDefense.targetStages.spDef=1;assert(damage(specialDefense.cast(id)).amount<hit.amount);
      const miss=fight(mode,side,slot);miss.actorStages.accuracy=-6;miss.targetStages.evasion=6;miss.random(()=>.999999);const before=miss.actor.pp[id];assert(miss.cast(id).some(e=>e.kind==='miss'));assert.equal(miss.actor.pp[id],before-1);assert.equal(miss.actor.rechargeTurns,undefined);
    });
  }
});

test('full recovery heals only its user to maximum HP, spends one PP, keeps conditions and causes no recharge',()=>{
  positions((mode,side,slot)=>{
    const f=fight(mode,side,slot);f.actor.hp=1;f.actor.curse=true;f.actor.status='scorch';
    const target=plain(f.target),max=f.max(f.actor),pp=f.actor.pp[IDS[0]],events=f.cast(IDS[0]);
    assert.equal(f.actor.hp,max);assert.equal(events.find(e=>e.kind==='heal').amount,max-1);assert.equal(f.actor.pp[IDS[0]],pp-1);assert.equal(f.actor.curse,true);assert.equal(f.actor.status,'scorch');assert.equal(f.actor.rechargeTurns,undefined);assert.deepEqual(plain(f.target),target);
    const full=f.cast(IDS[0]);assert.equal(full.find(e=>e.kind==='heal').amount,0);assert.equal(f.actor.hp,max);assert.equal(f.actor.pp[IDS[0]],pp-2);
    f.target.hp=10000;assert(!f.cast(IDS[1]).some(event=>event.kind==='recharge'));assert.equal(f.actor.pp[IDS[1]],D.moves[IDS[1]].pp-1);
  });
});

test('psychic sovereignty boosts actual special damage by 20% but grants no physical boost or status immunity',()=>{
  const control='psychic_no_ability';D.species[control]={...D.species[ID],id:control};
  try{
    assert.equal(A.get(control),null);
    for(const mode of ['solo','single','double'])for(const category of ['physical','special']){
      const id='psychic_probe_'+category;D.moves[id]={id,name:'検証の一撃',element:null,kind:'attack',category,power:20,accuracy:100,pp:99};
      const cast=actorId=>{const prior=D.species[actorId].moves;D.species[actorId].moves=[id,...prior.slice(1)];try{const f=fight(mode,0,mode==='double'?1:0,'hibana',actorId);f.target.hp=10000;return damage(f.cast(id)).amount;}finally{D.species[actorId].moves=prior;}};
      const normal=cast(control),boosted=cast(ID);if(category==='special')assert(Math.abs(boosted-normal*1.2)<=1,mode);else assert.equal(boosted,normal);delete D.moves[id];
    }
  }finally{delete D.species[control];}
  const move={id:'psychic_status_probe',name:'検証',element:'leaf',kind:'attack',category:'physical',power:1,accuracy:100};
  for(const mode of ['solo','single','double']){
    const f=fight(mode,0,mode==='double'?1:0);assert(mode==='solo'?f.e.inflictCondition(f.actor,'ally',move,[],true):f.d._inflict(0,mode==='double'?1:0,f.actor,move,true));assert.equal(f.actor.status,'bloom');f.actor.curse=true;assert.equal(LT.ConditionRules.clearImmune(f.actor),false);assert.equal(f.actor.curse,true);
  }
});

test('Lv50 link battles retain allocated points and new types with deterministic complete results',()=>{
  const allocation={hp:64,atk:64,def:64,spAtk:41,spDef:0,speed:64};
  for(const mode of ['single','double']){
    const size=Duel.teamSize(mode),config={mode,teams:[team(ID,size),team('komori',size)],seed:740331,allocation:[[allocation,...Array(size-1).fill(null)],null]},a=Duel.create(config),b=Duel.create(config),mon=a.active(0)[0];
    assert.equal(mon.level,50);assert.deepEqual(plain(mon.alloc),allocation);assert.deepEqual(plain(T.of(mon)),['super']);assert.equal(LT.genderOf(mon),'none');assert.deepEqual(plain(mon.stats),plain(new Engine().stats({species:ID,level:50,alloc:allocation})));
    const orders=[0,1].map(side=>a.active(side).map((_,slot)=>({type:'move',slot,move:side===0&&slot===0?2:0,target:0})));a.resolve(plain(orders));b.resolve(plain(orders));assert.equal(a.fingerprint(),b.fingerprint());assert.deepEqual(plain(a.snapshot()),plain(b.snapshot()));
  }
});
