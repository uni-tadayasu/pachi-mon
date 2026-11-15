#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),context=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],context);if(context.LT?.Engine)break;
}
const {Engine,DATA:D}=context.LT,copy=x=>JSON.parse(JSON.stringify(x));
const expected=[['komori','komorion','komorizen'],['shizuku','shizurua','shizunaria'],['hibana','akebino','akehomura']];
assert.equal(Object.keys(D.species).length,260);assert.equal(D.content.species,259);assert.equal(D.content.specialSpecies,1);assert.equal(D.content.totalSpecies,260);
const before=JSON.stringify(D);
function setup(root,level){const e=new Engine();assert(e.newGame(root).ok);e.state.party=[e.makeMonster(root,level)];e.state.party[0].nickname='きらり';e.state.party[0].shiny=true;e.battle={log:[]};return e;}
function grant(e,amount){const events=[];e.giveXP(e.state.party[0],amount,events);return events;}
for(const [root,middle,final]of expected){
  const base=D.species[root],mid=D.species[middle],last=D.species[final];
  assert.equal(base.evolvesTo,middle);assert.equal(base.evolveLevel,8);assert.equal(mid.evolvesTo,final);assert.equal(mid.evolveLevel,32);assert.equal(last.evolvesTo,undefined);
  assert.equal(last.shape,base.shape);assert.equal(last.element,base.element);assert(last.evolutionOnly);assert(!last.specialOnly);
  assert.equal(last.moves.length,4);assert.equal(new Set(last.moves).size,4);assert(last.moves.every(id=>D.moves[id]));
  for(const key of ['hp','atk','def','spAtk','spDef','speed'])assert(last.base[key]>=mid.base[key],`${final} ${key} must grow`);
  assert(!Object.values(D.maps).some(map=>map.encounters.includes(final)),'Final starters are acquired by evolution, not silently added to wild pools');
  let e=setup(root,7),mon=e.state.party[0];
  assert.equal(grant(e,e.xpToNext(7)-1).filter(ev=>ev.kind==='evolve').length,0);assert.equal(mon.species,root);
  assert.equal(grant(e,1).filter(ev=>ev.kind==='evolve').length,1);assert.equal(mon.species,middle);assert.equal(mon.level,8);
  let to31=0;for(let level=8;level<31;level++)to31+=e.xpToNext(level);grant(e,to31);assert.equal(mon.species,middle);assert.equal(mon.level,31);
  grant(e,e.xpToNext(31));assert.equal(mon.species,final);assert.equal(mon.level,32);assert.equal(mon.nickname,'きらり');assert(mon.shiny);
  assert.equal(mon.hp,e.stats(mon).hp);assert.equal(Object.keys(mon.pp).length,4);assert(last.moves.every(id=>Number.isInteger(mon.pp[id])&&mon.pp[id]>=0&&mon.pp[id]<=e.maxPP(id)));
  e.battle=null;assert.equal(new Engine(e.serialize()).state.party[0].species,final);
  // Old saves and high-level captures can be above both thresholds without any
  // new level. A single positive XP award must still complete both stages.
  for(const level of [32,45,100]){
    e=setup(root,level);mon=e.state.party[0];const events=grant(e,1);
    assert.equal(mon.species,final);assert.equal(mon.level,level);assert.equal(events.filter(ev=>ev.kind==='evolve').length,2);
    assert(mon.shiny);assert.equal(mon.nickname,'きらり');assert(e.state.caught.includes(middle));assert(e.state.caught.includes(final));
    assert.equal(mon.hp,e.stats(mon).hp);if(level===100)assert.equal(mon.xp,0);
    e.battle=null;const save=e.serialize(),snapshot=JSON.stringify(save);assert.equal(new Engine(save).state.party[0].species,final);assert.equal(JSON.stringify(save),snapshot);
  }
  // Existing first-stage owners receive precisely the one remaining evolution.
  e=setup(root,32);e.state.party[0]=e.makeMonster(middle,32);e.markCaught(middle);assert.equal(grant(e,1).filter(ev=>ev.kind==='evolve').length,1);assert.equal(e.state.party[0].species,final);
  e=setup(root,32);e.state.party[0].hp=0;grant(e,1);assert.equal(e.state.party[0].species,final);assert.equal(e.state.party[0].hp,0,'Evolution never revives fainted members');
}
assert.equal(D.species.futo.evolvesTo,undefined);const f=setup('komori',5);f.state.party=[f.makeMonster('futo',99)];grant(f,1000000);assert.equal(f.state.party[0].species,'futo');
const childIds=new Set(Object.values(D.species).map(s=>s.evolvesTo).filter(Boolean)),families={0:0,1:0,2:0};
for(const [id,s]of Object.entries(D.species)){
  if(s.evolvesTo)assert(D.species[s.evolvesTo],`${id} target must exist`);
  const visited=new Set([id]);let next=s,edges=0;while(next.evolvesTo){assert(!visited.has(next.evolvesTo),'No evolution cycles');visited.add(next.evolvesTo);next=D.species[next.evolvesTo];edges++;assert(edges<=2,'No species evolves more than twice');}
  if(!childIds.has(id))families[edges]++;
}
assert.deepEqual(families,{0:48,1:37,2:46});assert.equal(JSON.stringify(D),before,'Gameplay never mutates the evolution catalog');
console.log(JSON.stringify({ok:true,starters:expected,levels:[8,32],species:260,ordinarySpecies:259,families,checks:['thresholds','old saves/high-level captures catch up on next XP','Lv100','nickname and shiny persistence','HP/PP integrity','no Futo evolution','cycle-free mixed evolution lengths']}));
