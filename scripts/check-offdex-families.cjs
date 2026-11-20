#!/usr/bin/env node
'use strict';
// Run the shipped data, evolution, save and both battle engines. Source-file
// order is the user contract; the bulky pearl form must precede the slim one.
const assert=require('node:assert/strict'),test=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const blocks=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)],context=vm.createContext({console});
for(const [,attrs,source]of blocks){
  if(/\bsrc=|application\/ld\+json/.test(attrs))continue;
  vm.runInContext(source,context);if(context.LT?.Engine)break;
}
const duelSource=blocks.find(([,attrs,source])=>!/\bsrc=/.test(attrs)&&source.includes('deterministic, save-independent rental-team duels'));
assert(duelSource);vm.runInContext(duelSource[2],context);
const {Engine,Duel,DATA:D,TypeSystem:T,Abilities:A,ConditionRules}=context.LT;
const plain=value=>JSON.parse(JSON.stringify(value)),ids=[...D.offDexLines.ids];
const expected=[
  {ids:['pearlmi','pearlgoa','pearlseria'],files:['1.png','2.png','3.png'],types:['crystal','tide'],levels:[24,48],ability:'layered_shell'},
  {ids:['shimomaru','shimorei','hyogald'],files:['4.png','5.png','6.png'],types:['tide','ice'],levels:[24,48],ability:'powerful_limbs'},
  {ids:['rurikoro','rurigorm'],files:['7.png','8.png'],types:['earth','crystal'],levels:[32],ability:'steady_core'}
];
const owner={id:'P1234567890abcdef',isAdmin:true};
function hero(){const e=new Engine();assert(e.newGame('komori','female','図鑑外').ok);e.rng=()=>.5;return e;}
function levelTo(e,mon,target){
  let amount=0;for(let level=mon.level;level<target;level++)amount+=e.xpToNext(level);
  const events=[];e.giveXP(mon,amount-mon.xp,events);return events;
}
function team(first,size){return [first,...['komori','shizuku','hibana','fuwari'].filter(id=>id!==first)].slice(0,size);}
const attack={id:'offdex_probe',name:'検証の一撃',kind:'attack',element:'leaf',category:'physical',power:2,accuracy:100,pp:99};

test('the exact eight source filenames form three separate off-dex evolution families',()=>{
  assert.deepEqual(ids,expected.flatMap(line=>line.ids));assert.equal(new Set(ids).size,8);
  assert.equal(D.offDexLines.acquisition,'operator-secret');assert.equal(D.offDexLines.families.length,3);
  assert(Object.isFrozen(D.offDexLines)&&Object.isFrozen(D.offDexLines.ids));
  expected.forEach((line,index)=>{
    const family=D.offDexLines.families[index];assert.deepEqual(plain(family.ids),line.ids);assert.deepEqual(plain(family.sourceFiles),line.files);
    assert.equal(family.starter,line.ids[0]);assert(Object.isFrozen(family.ids)&&Object.isFrozen(family.sourceFiles));
    line.ids.forEach((id,stage)=>{
      const s=D.species[id];assert.equal(s.sourceImage,line.files[stage]);assert.equal(s.visual.stage,stage);
      assert.equal(s.evolvesTo,line.ids[stage+1]);assert.equal(s.evolveLevel,line.levels[stage]);
      assert.equal(s.evolutionOnly,stage>0);assert.equal(s.evolved,stage>0);
      assert.equal(s.family,family.id);assert.equal(s.atlasNumber,undefined);
      assert(s.hiddenDex&&s.glitchOnly&&s.specialOnly);assert(!s.adminOnly);
      assert.deepEqual(plain(T.of(id)),line.types);assert.equal(T.immune(id),false);
      assert.equal(s.ability,line.ability);assert.equal(A.get(id)?.id,line.ability);
      assert.equal(A.get({species:id,ability:'shadow_reader'})?.id,line.ability,'Saved metadata cannot override the species ability');
      const parents=Object.values(D.species).filter(other=>other.evolvesTo===id).map(other=>other.id);
      assert.deepEqual(parents,stage?[line.ids[stage-1]]:[],'No existing family is redirected into a new one');
    });
  });
  assert.match(D.species.pearlgoa.description,/四本の脚/);assert.match(D.species.pearlseria.description,/四本の長い脚/);
  assert.deepEqual(plain(D.glitchLine.ids),['nullmie','nullva','zeroveil']);
});

test('public dex, collection goals and ordinary encounter pools remain unchanged',()=>{
  assert.equal(Object.keys(D.species).length,269);assert.equal(D.content.playableSpecies,269);
  assert.equal(D.content.hiddenSpecies,13);assert.equal(D.content.dexSpecies,256);assert.equal(D.content.totalSpecies,256);
  assert.equal(Object.values(D.species).filter(s=>!s.hiddenDex).length,256);
  const e=hero(),progress=()=>plain(e.quests().map(({id,target,progress,complete})=>({id,target,progress,complete}))),before=progress();
  for(const id of ids){
    e.markCaught(id);assert(!D.starters.includes(id));assert(!D.collectionRoutes.wild.includes(id));
    assert(!Object.values(D.collectionRoutes.starters).some(list=>list.includes(id)));
    assert(!Object.values(D.maps).some(map=>(map.encounters||[]).includes(id)));
    assert(!Object.values(D.rivals).some(rival=>rival.species===id||rival.team?.some(mon=>mon.species===id)));
  }
  assert.deepEqual(progress(),before);assert.equal(e.state.flags.nullLineClaimed,undefined,'New discoveries do not consume the old Void reward');
  const loaded=new Engine(e.serialize());assert.equal(loaded.state.flags.nullLineClaimed,undefined);
  assert(!e.state.secrets.includes('dexwild'));
});

test('each form has four legal moves using both types and stage-appropriate growing stats',()=>{
  assert.equal(Object.keys(D.moves).length,104,'No existing move was replaced or removed');
  for(const line of expected)for(const [stage,id]of line.ids.entries()){
    const s=D.species[id],e=hero(),mon=e.makeMonster(id,50);
    assert.equal(s.moves.length,4);assert.equal(new Set(s.moves).size,4);
    assert(s.moves.every(move=>D.moves[move]&&!D.moves[move].hiddenDex&&!['special','signature'].includes(D.moves[move].role)));
    for(const type of line.types)assert(s.moves.some(move=>D.moves[move].element===type&&D.moves[move].kind==='attack'),id+' has an attack for '+type);
    for(const stat of ['hp','atk','def','spAtk','spDef','speed','accuracy','evasion'])assert(Number.isInteger(s.base[stat])&&s.base[stat]>0);
    if(stage)for(const stat of ['hp','atk','def','spAtk','spDef','speed'])assert(s.base[stat]>=D.species[line.ids[stage-1]].base[stat],id+' does not lose base '+stat);
    assert.deepEqual(plain(e.moves(mon).map(move=>move.id)),plain(s.moves));
    assert.equal(mon.hp,e.stats(mon).hp);for(const move of e.moves(mon))assert.equal(mon.pp[move.id],e.maxPP(move));
  }
});

test('all three chains evolve exactly at their thresholds while retaining individual identity',()=>{
  for(const line of expected)for(const source of ['party','storage']){
    let e=hero(),mon=e.makeMonster(line.ids[0],5);e.state[source].push(mon);e.markCaught(mon.species);
    Object.assign(mon,{nickname:'ひみつ',shiny:true,gender:'female',alloc:{atk:4},curse:true});mon.hp-=3;
    const uid=mon.uid;
    for(let stage=1;stage<line.ids.length;stage++){
      const target=line.levels[stage-1];
      assert.equal(levelTo(e,mon,target-1).filter(event=>event.kind==='evolve').length,0);assert.equal(mon.species,line.ids[stage-1]);
      const events=levelTo(e,mon,target);assert.equal(events.filter(event=>event.kind==='evolve').length,1);
      assert.equal(mon.species,line.ids[stage]);assert.equal(mon.level,target);assert.equal(mon.uid,uid);
      assert.equal(mon.nickname,'ひみつ');assert.equal(mon.gender,'female');assert.equal(mon.shiny,true);assert.equal(mon.curse,true);
      assert.deepEqual(plain(mon.alloc),{atk:4});assert.equal(e.stats(mon).hp-mon.hp,3,'Evolution preserves missing HP');
      assert.deepEqual(Object.keys(mon.pp).sort(),[...D.species[mon.species].moves].sort());
      for(const move of e.moves(mon))assert(Number.isInteger(mon.pp[move.id])&&mon.pp[move.id]>=0&&mon.pp[move.id]<=e.maxPP(move));
      assert.equal(A.get(mon).id,line.ability);assert(e.state.caught.includes(mon.species));
      const saved=e.serialize();e=new Engine(saved);mon=e.state[source].find(value=>value.uid===uid);assert(mon);assert.equal(mon.species,line.ids[stage]);
    }
    assert.equal(e.state.stats.evolutions,line.ids.length-1);
  }
});

test('evolution blocking and Lv.100 catch-up preserve every intended intermediate stage',()=>{
  for(const line of expected){
    const e=hero(),mon=e.makeMonster(line.ids[0],5);e.state.party.push(mon);e.markCaught(mon.species);mon.heldItem='everpebble';
    levelTo(e,mon,100);assert.equal(mon.species,line.ids[0]);assert.equal(mon.level,100);
    delete mon.heldItem;const events=[];e.giveXP(mon,1,events);
    assert.equal(mon.species,line.ids.at(-1));assert.equal(mon.xp,0);assert.equal(events.filter(event=>event.kind==='evolve').length,line.ids.length-1);
    for(const id of line.ids)assert(e.state.caught.includes(id));assert.doesNotThrow(()=>new Engine(e.serialize()));
  }
});

test('operator acquisition grants the requested form and old save versions retain all eight with canonical metadata',()=>{
  for(const id of ids){
    const e=hero();assert(e.startAdminEncounter(id,100,owner,{shiny:true,gender:'male'}).ok);assert.equal(e.resonanceChance(),1);
    assert(e.action({type:'resonate'}).ok);const caught=e.state.party.at(-1);assert.equal(caught.species,id);assert.equal(caught.level,100);
    assert.equal(caught.gender,'male');assert.equal(caught.shiny,true);e.battle=null;
    Object.assign(caught,{nickname:'ひみつ',alloc:{atk:4,def:3},moveOrder:[2,0,3,1],curse:true});caught.hp-=7;caught.pp[D.species[id].moves[0]]=1;
    for(const version of [1,2,3,4]){
      const saved=plain(e.serialize());saved.version=version;
      Object.assign(saved.party.at(-1),{ability:'shadow_reader',types:['void'],element:'void'});
      const restored=new Engine(saved).state.party.at(-1);
      for(const key of ['uid','species','level','xp','nickname','gender','shiny','hp','pp','alloc','moveOrder','curse'])assert.deepEqual(plain(restored[key]),plain(caught[key]),id+' retains '+key+' in v'+version);
      assert.deepEqual(plain(T.of(restored)),plain(D.species[id].types));assert.equal(A.get(restored).id,A.get(id).id);
      for(const forged of ['ability','types','element'])assert.equal(restored[forged],undefined);
    }
    assert.throws(()=>e.tradeMonster(caught),/交換/,'Secret acquisition does not make the new forms exchangeable');
  }
});

test('hidden status does not grant Void immunity: poison and permanent curse work in solo and both duel modes',()=>{
  for(const id of ids){
    const e=hero();e.state.party=[e.makeMonster(id,50)];assert(e.startBattle('komori',50,null,{wild:false}));
    const mon=e.state.party[0];assert.equal(e.inflictCondition(mon,'ally',attack,[],true),true);assert.equal(mon.status,'bloom');
    const events=[];e.applyMove(e.battle.enemy,mon,D.moves.null_curse,'enemy',events);assert.equal(mon.curse,true);assert.equal(mon.status,'bloom');
    assert.equal(ConditionRules.clearImmune(mon),false);assert.equal(mon.curse,true);
    for(const mode of ['single','double']){
      const duel=Duel.create({mode,teams:[team(id,Duel.teamSize(mode)),team('komori',Duel.teamSize(mode))],seed:0x54a1b2c3});
      duel._random=()=>0;const member=duel.active(0)[0],enemy=duel.active(1)[0];
      assert.equal(duel._inflict(0,0,member,attack,true),true);assert.equal(member.status,'bloom');
      enemy.pp.null_curse=99;duel._apply({technique:D.moves.null_curse,side:1,slot:0,target:0},enemy);
      assert.equal(member.curse,true);assert.equal(member.status,'bloom');assert.equal(duel.snapshot().teams[0].monsters[0].curse,true);
    }
  }
  for(const id of D.glitchLine.ids)assert(T.immune(id),'The existing Void line retains its immunity');
});

test('every new form uses its canonical moves, types, ability and deterministic resolution in both duel modes',()=>{
  for(const id of ids)for(const mode of ['single','double']){
    const size=Duel.teamSize(mode),config={mode,teams:[team(id,size),team('komori',size)],seed:0x54f00d};
    const a=Duel.create(config),b=Duel.create(config),member=a.active(0)[0];
    assert.equal(member.species,id);assert.equal(member.level,50);assert.equal(A.get(member).id,A.get(id).id);
    assert.deepEqual(plain(T.of(member)),plain(D.species[id].types));assert.deepEqual(plain(a.moves(member).map(move=>move.id)),plain(D.species[id].moves));
    const orders=[0,1].map(side=>a.active(side).map((_,slot)=>({type:'move',slot,move:0,target:0})));
    for(let side=0;side<2;side++)assert(a.validate(side,orders[side]).ok);
    a.resolve(orders);b.resolve(orders);assert.equal(a.fingerprint(),b.fingerprint());assert.deepEqual(plain(a.snapshot()),plain(b.snapshot()));
    assert(a.state.events.some(event=>event.kind==='damage'),'The team completed real battle actions');
    for(const roster of a.state.teams)for(const mon of roster.monsters)assert(Number.isFinite(mon.hp)&&mon.hp>=0&&mon.hp<=mon.maxHp);
  }
});
