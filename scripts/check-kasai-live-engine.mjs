import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createReplayRuntime} from '../server/kasai-replay.mjs';
import {createLiveBattle,validateLiveOrders,resolveLiveRound} from '../server/kasai-live-engine.mjs';
const LT=createReplayRuntime(),engine=new LT.Engine(),copy=value=>JSON.parse(JSON.stringify(value));
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const duelSource=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(match=>match[1].includes('deterministic, save-independent rental-team duels'))[1];
const browser=vm.createContext({LT:createReplayRuntime(),console});
vm.runInContext(duelSource,browser);vm.runInContext(fs.readFileSync(new URL('../kasai-live-model.js',import.meta.url),'utf8'),browser);
const browserRules=browser.LT.KasaiLiveRules;
function party(size=3,level=47,tag='p'){
  return Array.from({length:size},(_,i)=>({...engine.makeMonster(['komori','fuwari','shizunaria'][i%3],level+i),uid:`${tag}-${i}`}));
}
test('live duel uses 1–6 actual owned individuals and never writes to either adventure party',()=>{
  const own=party(6,41),other=party(1,91,'k');
  Object.assign(own[0],{hp:1,moveOrder:[2,0,3,1],heldItem:'learnsash',nickname:'みどり',shiny:true,gender:'female',alloc:{atk:20,hp:5},curse:true,status:'scorch'});
  own[0].pp[Object.keys(own[0].pp)[0]]=0;
  const before=JSON.stringify([own,other]),state=createLiveBattle(own,other,47);
  assert.deepEqual(state.teams.map(team=>team.monsters.length),[6,1]);assert.deepEqual(state.teams[0].monsters.map(mon=>mon.level),[41,42,43,44,45,46]);assert.equal(state.teams[1].monsters[0].level,91);
  const first=state.teams[0].monsters[0];assert.equal(first.uid,'p-0');assert.equal(first.nickname,'みどり');assert.equal(first.shiny,true);assert.equal(first.gender,'female');assert.deepEqual(first.moveOrder,[2,0,3,1]);assert.equal(first.item,'learnsash');assert.equal(first.curse,true);assert.equal(first.status,undefined);assert.equal(first.hp,engine.stats(own[0]).hp);
  for(const mon of state.teams.flatMap(team=>team.monsters))for(const move of engine.moves(mon))assert.equal(mon.pp[move.id],engine.maxPP(move));
  assert.equal(JSON.stringify([own,other]),before);state.teams[0].monsters[0].alloc.atk=0;assert.equal(own[0].alloc.atk,20);
});
test('configured Futo retains its grown custom stats and ordered custom moves',()=>{
  const mon=engine.makeMonster('futo',80,{hp:1000,atk:300,def:100,spAtk:300,spDef:100,speed:200,accuracy:100,evasion:100},LT.DATA.species.futo.moves.slice().reverse());
  Object.assign(mon,{uid:'kasai-futo',grantId:'admin-initial:P0123456789abcdef',customStatsLevel:70,futoConfigLevel:80,moveOrder:[1,3,0,2]});
  const state=createLiveBattle(party(1),[mon],89),duel=browserRules.hydrate(state),opponent=state.teams[1].monsters[0];
  assert.deepEqual(opponent.stats,engine.stats(mon));assert.deepEqual(copy(duel.moves(opponent).map(move=>move.id)),engine.moves(mon).map(move=>move.id));assert.equal(opponent.level,80);
});
test('browser and Worker resolve the same human commands through knockouts and replacements',()=>{
  let state=createLiveBattle(party(6,65),party(6,62,'k'),94587),mirrored=browserRules.create(party(6,65),party(6,62,'k'),94587);
  assert.deepEqual(copy(mirrored),state);let replacements=0;
  for(let steps=0;state.winner===null&&steps<300;steps++){
    const source=JSON.stringify(state),duel=browserRules.hydrate(state),orders=[duel.legalOrders(0),duel.legalOrders(1)];
    if(state.phase==='replacement')replacements++;
    for(let side=0;side<2;side++)assert.equal(validateLiveOrders(state,side,orders[side]).ok,true);
    const next=resolveLiveRound(state,orders);mirrored=browserRules.resolve(mirrored,orders);assert.deepEqual(next,copy(mirrored));assert.equal(JSON.stringify(state),source);assert.equal(next.round,state.round+1);state=next;
  }
  assert.notEqual(state.winner,null);assert(replacements>0);assert(!validateLiveOrders(state,0,[]).ok);assert.throws(()=>resolveLiveRound(state,[[],[]]));
});
test('malformed parties and unauthorized or incomplete orders fail without advancing a round',()=>{
  for(const invalid of [[],party(7),[{...party(1)[0],species:'forged'}]])assert.throws(()=>createLiveBattle(invalid,party(1),3));
  const state=createLiveBattle(party(1),party(1,45,'k'),3),before=JSON.stringify(state);
  for(const orders of [[],[{type:'won'}],[{type:'item',slot:0,index:0}],[{type:'move',slot:0,move:99,target:0}],[{type:'switch',slot:0,index:0}]])assert.equal(validateLiveOrders(state,0,orders).ok,false);
  assert.equal(validateLiveOrders(state,2,[{type:'move',slot:0,move:0,target:0}]).ok,false);assert.throws(()=>resolveLiveRound(state,[[{type:'move',slot:0,move:0,target:0}]]));assert.equal(JSON.stringify(state),before);
});
