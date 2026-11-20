import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createReplayRuntime} from '../kasai-replay.mjs';
import {RANKED_RULES_VERSION,rankedRulesInfo,rankForRating,normalizeRankedTeam,rankedPreviewMember,validateRankedTeam,createRankedBattle,validateRankedOrders,resolveRankedRound} from '../ranked-engine.mjs';

const LT=createReplayRuntime(),engine=new LT.Engine(),copy=value=>JSON.parse(JSON.stringify(value));
const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const duel=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(match=>match[1].includes('deterministic, save-independent rental-team duels'))[1];
const browser=vm.createContext({LT,console});vm.runInContext(duel,browser);
vm.runInContext(fs.readFileSync(new URL('../../legacy-battle-v82.js',import.meta.url),'utf8'),browser);
vm.runInContext(fs.readFileSync(new URL('../../ranked-rules.js',import.meta.url),'utf8'),browser);
const rules=browser.LT.RankedRules;
const team=(suffix='a',levels=[80,5,100])=>['komorizen','shizunaria','akehomura'].map((id,i)=>({...engine.makeMonster(id,levels[i]),uid:`rank-${suffix}-${i}`}));

test('owned party and storage records become Lv50 battles with full earned allocation',()=>{
  const input=team(),item=Object.keys(LT.DATA.heldItems).find(id=>LT.DATA.heldItems[id].kind==='regen');
  Object.assign(input[0],{nickname:'あいぼう',shiny:true,gender:'female',alloc:{hp:60,atk:60},heldItem:item,moveOrder:[3,1,0,2],hp:1,status:'scorch',curse:true});
  Object.assign(input[2],{bonusPoints:99,alloc:{hp:64,atk:64,def:64,spAtk:64,spDef:41},heldItem:item});
  const original=copy(input),state=createRankedBattle(input,team('b'),78,['あおい','はる']);
  const [first,low,high]=state.teams[0].monsters;
  assert.equal(first.level,50);assert.equal(first.sourceLevel,80);assert.equal(low.level,50);assert.equal(high.level,50);
  assert.deepEqual(first.stats,engine.stats({...input[0],level:50}));
  assert.deepEqual(high.alloc,input[2].alloc,'all 297 earned points survive normalization');
  assert.deepEqual(first.moveOrder,[3,1,0,2]);assert.equal(first.nickname,'あいぼう');assert.equal(first.shiny,true);assert.equal(first.gender,'female');
  assert.equal(first.item,item);assert.equal(high.item,item,'equipped duplicate items are valid');
  assert.equal(first.hp,first.maxHp);assert(!first.status&&!first.curse);
  assert(rules.moves(first).every(move=>move.pp===move.maxPP));
  assert.deepEqual(input,original,'battle preparation must not mutate the adventure');
  assert.equal(rankedRulesInfo().teamSource,'owned-party-and-storage');
});

test('99 battle growth stays separate from 297 training points and survives Lv50 normalization',()=>{
  const progression=new LT.Engine();progression.newGame('komori');
  const veteran=progression.makeMonster('komorizen',1);veteran.heldItem='trainband';progression.state.party=[veteran];progression.markCaught(veteran.species);
  const earnedXP=Array.from({length:99},(_,i)=>progression.xpToNext(i+1)).reduce((sum,value)=>sum+value,0);
  progression.giveXP(veteran,earnedXP,[],{battleParticipation:true});
  assert.equal(veteran.level,100);assert.equal(veteran.bonusPoints,99);assert.equal(veteran.battleGrowth,99);assert.equal(progression.allocationInfo(veteran).total,297);
  assert(progression.autoAllocate(0).ok);assert.equal(progression.allocationInfo(veteran).used,297);assert.equal(progression.allocationInfo(veteran).free,0);
  const input=[copy(veteran),...team('capacity').slice(1)],before=copy(input),normalized=normalizeRankedTeam(input);
  assert.equal(normalized[0].level,100);assert.equal(normalized[0].bonusPoints,99);assert.equal(normalized[0].battleGrowth,99);assert.deepEqual(normalized[0].alloc,veteran.alloc);
  const preview=rankedPreviewMember(input[0]),state=createRankedBattle(input,team('opponent'),79),client=copy(rules.create(input,team('opponent'),79));
  assert.deepEqual(state,client);const actual=state.teams[0].monsters[0];
  for(const mon of [preview,actual]){
    assert.equal(mon.level,50);assert.equal(mon.sourceLevel,100);assert.equal(mon.battleGrowth,99);assert.deepEqual(mon.alloc,veteran.alloc);
    assert.equal(Object.values(mon.alloc).reduce((sum,value)=>sum+value,0),297);
    assert.deepEqual(mon.stats,progression.stats({...veteran,level:50,sourceLevel:100}));
    const base=progression.stats({...veteran,level:50,battleGrowth:0});
    for(const key of Object.keys(base))assert.equal(mon.stats[key]-base[key],key==='hp'?198:['atk','def','spAtk','spDef','speed'].includes(key)?99:0,key);
  }
  assert.deepEqual(input,before);assert.equal(progression.allocationInfo(veteran).free,0);
});

test('fainted owned members are eligible and enrollment retains original levels',()=>{
  const input=team();input.forEach(mon=>{mon.hp=0;});
  const canonical=normalizeRankedTeam(input);
  assert.deepEqual(canonical.map(mon=>mon.level),[80,5,100]);
  const state=createRankedBattle(input,team('b'),12);
  assert(state.teams[0].monsters.every(mon=>mon.level===50&&mon.hp===mon.maxHp));
  assert(input.every(mon=>mon.hp===0));
});

test('configured Futo stats and moves follow its existing growth curve at Lv50',()=>{
  const stats={hp:900,atk:700,def:600,spAtk:750,spDef:650,speed:800,accuracy:150,evasion:140};
  const source={...engine.makeMonster('futo',90,stats,LT.FutoRules.defaultMoves),uid:'rank-futo'};
  const preview=rankedPreviewMember(source);
  for(const [key,value] of Object.entries(stats))assert.equal(preview.stats[key],Math.max(1,value-40*LT.FutoRules.growth[key]));
  assert.deepEqual(preview.customMoves,source.customMoves);assert.equal(preview.level,50);assert.equal(source.level,90);
  const capped={...engine.makeMonster('futo',5,{...LT.FutoRules.statLimits},LT.FutoRules.defaultMoves),uid:'rank-futo-capped'};
  const grown=rankedPreviewMember(capped);
  for(const [key,value] of Object.entries(LT.FutoRules.statLimits))assert.equal(grown.stats[key],value+45*LT.FutoRules.growth[key]);
  const veteran={...source,level:100,battleGrowth:99},original=copy(veteran),withGrowth=rankedPreviewMember(veteran),withoutGrowth=rankedPreviewMember({...veteran,battleGrowth:0});
  assert.equal(withGrowth.sourceLevel,100);assert.equal(withGrowth.battleGrowth,99);
  for(const key of Object.keys(withoutGrowth.stats))assert.equal(withGrowth.stats[key]-withoutGrowth.stats[key],key==='hp'?198:['atk','def','spAtk','spDef','speed'].includes(key)?99:0,key);
  assert.deepEqual(veteran,original,'configured base stats and growth are never written back');
});

test('all six v64 reserve gifts for every operator role retain growth99 and allocation297 at Lv50',()=>{
  const points={hp:64,atk:64,def:64,spAtk:64,spDef:41};
  for(const [role,starter] of Object.entries({main:'komorizen',sub:'shizunaria','sub-sub':'akehomura'})){
    const members=[starter,'floravelle','zeroveil','pearlseria','hyogald','rurigorm'].map(species=>({...engine.makeMonster(species,100),grantId:`admin-trained-v64:${role}:P0000000000000001:${species}`,gender:role==='sub'?'female':'male',heldItem:'trainband',bonusPoints:99,alloc:copy(points),battleGrowth:99}));
    const before=copy(members);
    for(const group of [members.slice(0,3),members.slice(3)]){
      const state=createRankedBattle(group,team('other'),79);
      for(const member of state.teams[0].monsters){
        assert.equal(member.level,50);assert.equal(member.sourceLevel,100);assert.equal(member.battleGrowth,99);assert.deepEqual(member.alloc,points);assert.equal(member.bonusPoints,99);
        const base=engine.stats({...member,battleGrowth:0});
        for(const key of Object.keys(base))assert.equal(member.stats[key]-base[key],key==='hp'?198:['atk','def','spAtk','spDef','speed'].includes(key)?99:0,role+' '+member.species+' '+key);
      }
    }
    assert.deepEqual(members,before);
  }
});

test('invalid raw teams and separately posted battle stats are rejected',()=>{
  const input=team();
  assert.equal(validateRankedTeam(input.slice(0,2)).ok,false);
  assert.equal(validateRankedTeam(['komorizen','shizunaria','akehomura']).ok,false);
  assert.equal(validateRankedTeam([input[0],input[0],input[2]]).ok,false);
  assert.equal(validateRankedTeam([input[0],{...input[0],uid:'other'},input[2]]).ok,false);
  assert.equal(validateRankedTeam([{...input[0],stats:{hp:999999}},...input.slice(1)]).ok,false);
  assert.equal(validateRankedTeam([{...input[0],species:'does-not-exist'},...input.slice(1)]).ok,false);
  assert.equal(validateRankedTeam([{...input[0],level:101},...input.slice(1)]).ok,false);
  assert.equal(validateRankedTeam([{...input[0],alloc:{hp:999}},...input.slice(1)]).ok,false);
  assert.equal(validateRankedTeam([{...input[1],uid:'rank-extra',alloc:{atk:64}},input[0],input[2]]).ok,false);
  assert.equal(validateRankedTeam([{...input[0],customStats:{hp:999999}},...input.slice(1)]).ok,false);
  for(const battleGrowth of [-1,80,100,1.5,'1',null])assert.equal(validateRankedTeam([{...input[0],battleGrowth},...input.slice(1)]).ok,false,'invalid original-level growth '+battleGrowth);
  assert.equal(validateRankedTeam([input[0],{...input[1],sourceLevel:100,battleGrowth:99},input[2]]).ok,false,'enrollment cannot claim a different source level');
});

test('browser and server resolve the complete same owned battle without save writes',()=>{
  const a=team(),b=team('b',[65,66,67]);a[0].alloc={atk:64,hp:20};a[0].moveOrder=[1,0,3,2];a[0].battleGrowth=79;b[1].battleGrowth=30;
  const before=copy([a,b]);let server=createRankedBattle(a,b,0x00780078,['あおい','はる']),client=copy(rules.create(a,b,0x00780078,['あおい','はる']));
  assert.deepEqual(server,client);
  let rounds=0;
  while(server.winner===null&&rounds++<220){
    const active=rules.hydrate(client),orders=[active.legalOrders(0),active.legalOrders(1)].map(copy);
    assert.equal(validateRankedOrders(server,0,orders[0]).ok,true);assert.equal(validateRankedOrders(server,1,orders[1]).ok,true);
    server=resolveRankedRound(server,orders);client=copy(rules.resolve(client,orders));assert.deepEqual(server,client);
  }
  assert.notEqual(server.winner,null);assert(rounds<220);assert.equal(server.rankedVersion,RANKED_RULES_VERSION);
  assert.deepEqual([a,b],before);
});

test('released v78 snapshots continue unchanged while rejecting injected growth and unsupported versions',()=>{
  const current=createRankedBattle(team(),team('legacy-opponent'),78),legacy=copy(current);legacy.rankedVersion='ranked-v78';
  assert.equal(RANKED_RULES_VERSION,'ranked-v83-vernix');assert(rankedRulesInfo().compatibleVersions.includes('ranked-v78'));assert(rankedRulesInfo().compatibleVersions.includes('ranked-v79-growth'));
  assert.deepEqual(copy(rules.hydrate(legacy).snapshot()),legacy);
  const duel=rules.hydrate(legacy),orders=[duel.legalOrders(0),duel.legalOrders(1)].map(copy);
  assert.equal(validateRankedOrders(legacy,0,orders[0]).ok,true);
  const resolved=resolveRankedRound(legacy,orders),modern=resolveRankedRound(current,orders);
  assert.equal(resolved.rankedVersion,'ranked-v78');assert.deepEqual({...resolved,rankedVersion:modern.rankedVersion},modern,'zero-growth rules preserve exactly the old turn outcome');
  const injected=copy(legacy),member=injected.teams[0].monsters[0];member.battleGrowth=1;member.stats=engine.stats(member);member.maxHp=member.stats.hp;member.hp=member.maxHp;
  assert.equal(validateRankedOrders(injected,0,orders[0]).ok,false);
  assert.equal(validateRankedOrders({...legacy,rankedVersion:'ranked-v77'},0,orders[0]).ok,false);
  const malformed=copy(current);malformed.teams[0].monsters[0].battleGrowth=80;assert.equal(validateRankedOrders(malformed,0,orders[0]).ok,false,'hydration validates the preserved original source level');
});

test('authoritative snapshots reject inflated abilities and illegal commands',()=>{
  const state=createRankedBattle(team(),team('b'),1);
  const invalid=copy(state);invalid.teams[0].monsters[0].stats.atk+=1000;
  const order=[{type:'move',slot:0,move:0,target:0}];
  assert.equal(validateRankedOrders(invalid,0,order).ok,false);
  assert.equal(validateRankedOrders(state,0,[{type:'switch',slot:0,index:0}]).ok,false);
  assert.equal(validateRankedOrders(state,0,[{type:'move',slot:0,move:9,target:0}]).ok,false);
  assert.equal(validateRankedOrders(state,0,[{...order[0],damage:99999}]).ok,false);
  assert.equal(validateRankedOrders(state,1,order).ok,true);
});

test('rank thresholds have stable names and exact promotion boundaries',()=>{
  assert.equal(rankForRating(1000).id,'bronze');
  for(const tier of rankedRulesInfo().tiers.slice(1)){
    assert.equal(rankForRating(tier.minRating).id,tier.id);
    assert.notEqual(rankForRating(tier.minRating-1).id,tier.id);
  }
  assert.equal(rankForRating(1800).nextMinRating,null);assert.equal(rankForRating(0).progress,0);
});
