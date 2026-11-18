#!/usr/bin/env node
'use strict';
// Exercise the real dialogue reward, save validation and evolution pipeline.
const assert=require('node:assert/strict'),test=require('node:test');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),context=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],context);if(context.LT?.Engine)break;
}
const {Engine,DATA:D}=context.LT,line=D.glitchLine,copy=value=>JSON.parse(JSON.stringify(value));
const owner={id:'P1234567890abcdef',isAdmin:true};
const hero=()=>{const e=new Engine();assert(e.newGame('komori','female','ゆらぎ').ok);e.rng=()=>.999999;return e;};
function enter(e){
  const wall=D.trickWall;Object.assign(e.state,{map:wall.map,x:wall.x,y:wall.y});
  for(let count=0;count<7;count++)assert.equal(e.move(0,-1).ok,false);
  const result=e.move(0,-1);assert(result.ok&&result.glitch);assert.equal(e.state.map,'interior-glitch');
}
function approach(e,npcId='glitch-note',mapId='interior-glitch'){
  const map=D.maps[mapId],npc=map.npcs.find(n=>n.id===npcId);assert(npc,npcId);
  const spot=[{x:npc.x,y:npc.y+1,facing:'up'},{x:npc.x,y:npc.y-1,facing:'down'},
    {x:npc.x+1,y:npc.y,facing:'left'},{x:npc.x-1,y:npc.y,facing:'right'}].find(p=>e.walkable(map,p.x,p.y));
  assert(spot,'An adjacent walkable tile exists');Object.assign(e.state,{map:mapId,...spot});e.talkStreak=null;
  assert.equal(e.nearbyNPC()?.id,npcId);return spot;
}
function talk(e,count=8){let result;for(let n=0;n<count;n++)result=e.interact();return result;}
function recruit(e=hero()){
  enter(e);approach(e);const result=talk(e);assert(result.glitchCompanion,'Eight conversations grant the companion');
  return {e,mon:[...e.state.party,...e.state.storage].find(m=>m.uid===result.glitchCompanion),result};
}
const hidden=e=>[...e.state.party,...e.state.storage].filter(m=>line.ids.includes(m.species));
function levelTo(e,mon,target){let xp=0;for(let level=mon.level;level<target;level++)xp+=e.xpToNext(level);const events=[];e.giveXP(mon,xp-mon.xp,events);return events;}

test('the three hidden stages have no public dex number or ordinary acquisition pool',()=>{
  assert.deepEqual([...line.ids],['nullmie','nullva','zeroveil']);assert.equal(line.starter,'nullmie');assert.equal(line.level,5);
  assert.equal(Object.values(D.species).filter(s=>!s.hiddenDex).length,256);
  for(const id of line.ids){
    const species=D.species[id];assert(species.hiddenDex&&species.glitchOnly&&species.specialOnly);assert.equal(species.element,'void');
    assert.equal(species.atlasNumber,undefined);assert(!D.starters.includes(id));
    assert(!D.collectionRoutes.wild.includes(id));assert(!Object.values(D.collectionRoutes.starters).some(ids=>ids.includes(id)));
    assert(!Object.values(D.maps).some(map=>map.encounters.includes(id)));
    assert(!Object.values(D.rivals).some(rival=>rival.species===id||rival.team?.some(mon=>mon.species===id)));
  }
  assert.equal(D.secrets.length,16);assert.equal(D.tricks.length,8);
});

test('the wall glitch and eighth unmoving conversation grant exactly one Lv.5 companion',()=>{
  const e=hero();enter(e);assert.equal(hidden(e).length,0);approach(e);
  for(let n=0;n<7;n++){const result=e.interact();assert(!result.glitchCompanion);assert.equal(hidden(e).length,0);}
  const result=e.interact(),mon=hidden(e)[0];assert.equal(result.glitchCompanion,mon.uid);assert.equal(result.destination,'party');
  assert.equal(mon.species,'nullmie');assert.equal(mon.level,5);assert.equal(mon.hp,e.stats(mon).hp);
  assert.equal(e.state.flags.nullLineClaimed,true);assert(e.state.seen.includes('nullmie')&&e.state.caught.includes('nullmie'));
  assert(e.state.tricks.includes('wallslip')&&e.state.tricks.includes('garble'));assert(e.state.secrets.includes('glitchroom'));
  const before=copy(e.state);assert(!talk(e,16).glitchCompanion);assert.deepEqual(copy(e.state),before);
});

test('ordinary dialogue, wrong locations and incomplete conversation sequences cannot claim it',()=>{
  const e=hero();assert(!e.claimGlitchCompanion().ok);approach(e,'mentor','village');
  talk(e);assert(e.state.tricks.includes('garble'));assert.equal(hidden(e).length,0);
  enter(e);approach(e);talk(e,7);assert(!e.claimGlitchCompanion().ok);assert.equal(hidden(e).length,0);
  e.battle={log:[]};assert(!e.claimGlitchCompanion().ok);e.battle=null;
  assert(!new Engine().claimGlitchCompanion().ok);
});

test('walking away and speaking to another NPC reset the eight-conversation sequence',()=>{
  const e=hero();enter(e);const origin=approach(e);talk(e,7);
  const step=[[1,0],[-1,0],[0,1],[0,-1]].find(([dx,dy])=>e.walkable(e.map,e.state.x+dx,e.state.y+dy)
    &&!e.map.exits.some(exit=>exit.x===e.state.x+dx&&exit.y===e.state.y+dy));assert(step);
  assert(e.move(...step).ok);assert(e.move(-step[0],-step[1]).ok);e.state.facing=origin.facing;
  assert(!e.interact().glitchCompanion);assert.equal(e.talkStreak.count,1);assert.equal(hidden(e).length,0);
  const notePosition={x:e.state.x,y:e.state.y,facing:e.state.facing};
  const other=e.map.npcs.find(n=>n.id==='glitch-cache');
  Object.assign(e.state,{x:other.x,y:other.y+1,facing:'up'});e.interact();
  Object.assign(e.state,notePosition);assert(!e.interact().glitchCompanion);assert.equal(e.talkStreak.count,1);
  assert(talk(e,7).glitchCompanion);assert.equal(hidden(e).length,1);
});

test('a full party receives it in reserve, and full reserves preserve the unclaimed reward',()=>{
  let e=hero();while(e.state.party.length<D.limits.party)e.state.party.push(e.makeMonster('komori',5));
  let received=recruit(e);assert.equal(received.result.destination,'storage');assert.equal(e.state.storage.length,1);
  assert.equal(e.state.party.length,6);assert.doesNotThrow(()=>new Engine(e.serialize()));
  e=hero();while(e.state.party.length<D.limits.party)e.state.party.push(e.makeMonster('komori',5));
  while(e.state.storage.length<D.limits.storage)e.state.storage.push(e.makeMonster('komori',5));
  enter(e);approach(e);const before=copy(e.state),blocked=talk(e);
  assert(!blocked.glitchCompanion);assert(blocked.lines.some(text=>text.includes('満員')));assert.deepEqual(copy(e.state),before);
  assert(!e.state.flags.nullLineClaimed);assert(!e.state.caught.includes('nullmie'));
  assert(e.release(0).ok);assert(talk(e).glitchCompanion);assert.equal(e.state.storage.length,192);assert.equal(hidden(e).length,1);
  assert.doesNotThrow(()=>new Engine(e.serialize()));
});

test('a free party slot accepts the reward even when reserve storage is at its limit',()=>{
  const e=hero();while(e.state.storage.length<D.limits.storage)e.state.storage.push(e.makeMonster('komori',5));
  const {result}=recruit(e);assert.equal(result.destination,'party');assert.equal(e.state.party.length,2);assert.equal(e.state.storage.length,192);
});

test('save/load preserves the receipt, individual identity, and a missing-flag history migration',()=>{
  const {e,mon}=recruit();mon.nickname='ぬる';mon.shiny=true;mon.alloc={spAtk:4};
  const saved=e.serialize(),snapshot=JSON.stringify(saved),loaded=new Engine(saved);assert.equal(JSON.stringify(saved),snapshot);
  assert.deepEqual(copy(hidden(loaded)[0]),copy(mon));assert.equal(loaded.state.flags.nullLineClaimed,true);
  approach(loaded);assert(!talk(loaded).glitchCompanion);assert.equal(hidden(loaded).length,1);
  delete saved.flags.nullLineClaimed;const migrated=new Engine(saved);assert.equal(migrated.state.flags.nullLineClaimed,true);
  approach(migrated);assert(!talk(migrated).glitchCompanion);assert.equal(hidden(migrated).length,1);
  const bad=copy(saved);bad.flags.nullLineClaimed='yes';assert.throws(()=>new Engine(bad),/記録/);
});

test('evolution occurs at Lv.24 and Lv.48 with identity, allocation, nickname, HP and PP intact',()=>{
  const {e,mon}=recruit(),uid=mon.uid;mon.nickname='ぬる';mon.shiny=true;mon.alloc={spAtk:4};
  assert.equal(levelTo(e,mon,23).filter(event=>event.kind==='evolve').length,0);assert.equal(mon.species,'nullmie');
  assert.equal(levelTo(e,mon,24).filter(event=>event.kind==='evolve').length,1);assert.equal(mon.species,'nullva');
  assert.equal(levelTo(e,mon,47).filter(event=>event.kind==='evolve').length,0);assert.equal(mon.species,'nullva');
  assert.equal(levelTo(e,mon,48).filter(event=>event.kind==='evolve').length,1);assert.equal(mon.species,'zeroveil');
  assert.equal(mon.uid,uid);assert.equal(mon.nickname,'ぬる');assert(mon.shiny);assert.deepEqual(copy(mon.alloc),{spAtk:4});
  assert.equal(mon.hp,e.stats(mon).hp);assert.equal(Object.keys(mon.pp).length,4);
  for(const move of e.moves(mon))assert(Number.isInteger(mon.pp[move.id])&&mon.pp[move.id]>=0&&mon.pp[move.id]<=e.maxPP(move));
  assert.equal(e.state.stats.evolutions,2);for(const id of line.ids)assert(e.state.caught.includes(id));
  const loaded=new Engine(e.serialize());assert.equal(hidden(loaded)[0].species,'zeroveil');
  approach(loaded);assert(!talk(loaded).glitchCompanion);assert.equal(hidden(loaded).length,1);
});

test('the existing evolution-blocking item and level-cap catch-up also work for the hidden line',()=>{
  const {e,mon}=recruit();mon.heldItem='everpebble';levelTo(e,mon,48);assert.equal(mon.species,'nullmie');
  delete mon.heldItem;const events=[];e.giveXP(mon,1,events);assert.equal(mon.species,'zeroveil');assert.equal(events.filter(event=>event.kind==='evolve').length,2);
  const capped=e.makeMonster('nullmie',100);e.state.storage.push(capped);const capEvents=[];e.giveXP(capped,1,capEvents);
  assert.equal(capped.species,'zeroveil');assert.equal(capped.xp,0);assert.equal(capEvents.filter(event=>event.kind==='evolve').length,2);
  assert.doesNotThrow(()=>new Engine(e.serialize()));
});

test('releasing any stage leaves its receipt/history and cannot create a second reward',()=>{
  for(const stage of line.ids){
    const {e,mon}=recruit();if(stage==='nullva')levelTo(e,mon,24);if(stage==='zeroveil')levelTo(e,mon,48);
    assert(e.releaseParty(e.state.party.findIndex(member=>member.uid===mon.uid)).ok);assert.equal(hidden(e).length,0);
    const exported=e.serialize();delete exported.flags.nullLineClaimed;const loaded=new Engine(exported);
    approach(loaded);assert(!talk(loaded).glitchCompanion);assert.equal(hidden(loaded).length,0);assert.equal(loaded.state.flags.nullLineClaimed,true);
  }
  const e=hero();while(e.state.party.length<6)e.state.party.push(e.makeMonster('komori',5));recruit(e);
  const released=e.release(0);assert(released.ok);assert(!released.message.includes('図鑑'));
  const loaded=new Engine(e.serialize());approach(loaded);assert(!talk(loaded).glitchCompanion);assert.equal(hidden(loaded).length,0);
});

test('hidden acquisition and evolution do not inflate dex or five-color collection quests',()=>{
  const e=hero(),ordinary=Object.values(D.species).filter(species=>!species.hiddenDex);
  for(const element of ['tide','ember','wind'])e.markCaught(ordinary.find(species=>species.element===element).id);
  const progress=()=>Object.fromEntries(e.quests().filter(q=>['caught','types'].includes(q.metric)).map(q=>[q.id,{target:q.target,progress:q.progress,complete:q.complete}]));
  const before=progress();assert.equal(before['five-colors'].progress,4);
  for(const id of line.ids)e.markCaught(id);
  assert.deepEqual(progress(),before);assert(e.state.caught.length>before['six-friends'].progress);
  assert(!e.state.secrets.includes('dexwild'));
  for(const id of D.collectionRoutes.wild)e.markCaught(id);
  assert(e.state.secrets.includes('dexwild'),'The ordinary wild collection still completes without a hidden requirement');
});

test('the operator encounter and exchange paths cannot bypass the glitch-only acquisition',()=>{
  for(const id of line.ids){
    const e=hero(),before=copy(e.state);const result=e.startAdminEncounter(id,50,owner);
    assert(!result.ok);assert.equal(e.battle,null);assert.deepEqual(copy(e.state),before);
    assert.throws(()=>e.tradeMonster(e.makeMonster(id,50)),/交換/);
  }
});
