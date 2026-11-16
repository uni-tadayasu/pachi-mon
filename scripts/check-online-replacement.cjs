#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const blocks=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(m=>m[2]);
const context=vm.createContext({console,crypto:webcrypto,TextEncoder,Uint8Array,Uint32Array,performance,setTimeout(fn,ms){const id=setTimeout(fn,ms);id.unref();return id;},clearTimeout});
for(const marker of ['original world and game data','Original creature atlas and optional journeys','the Meridian Accord, an original 256-species atlas','two-stage starter lineages, retaining every existing species ID','Arvelion, the original roaming legendary','owner-only leaf mythical, outside all ordinary acquisition pools','deterministic combat, interiors, league and versioned saves','deterministic, save-independent rental-team duels','peer-to-peer casual duel protocol']){
 const code=blocks.find(code=>code.includes(marker));assert(code,marker);vm.runInContext(code,context);
}
const {LT}=context,copy=value=>JSON.parse(JSON.stringify(value)),ids=Object.keys(LT.DATA.species).filter(id=>!LT.DATA.species[id].specialOnly);
const make=(mode='single')=>new LT.Duel({mode,teams:[ids.slice(0,mode==='single'?3:4),ids.slice(4,mode==='single'?7:8)],seed:948203});
const attack=(duel,side,slot=0,target=0)=>({type:'move',slot,move:duel.moves(duel.active(side)[slot]).findIndex(move=>move.kind==='attack'),target});
function prepareKO(duel,double=false){
 for(const mon of duel.state.teams[0].monsters){mon.stats.speed=10000;mon.stats.atk=mon.stats.spAtk=10000;mon.stats.accuracy=10000;}
 for(const mon of duel.state.teams[1].monsters){mon.stats.speed=1;mon.stats.evasion=1;}
 duel.state.teams[1].monsters[0].hp=1;if(double)duel.state.teams[1].monsters[1].hp=1;
}
let d=make();prepareKO(d);d.resolve([[attack(d,0)],[attack(d,1)]]);
assert.equal(d.state.phase,'replacement');assert.equal(d.state.turn,2);assert.equal(d.state.round,2);
assert.equal(d.state.teams[1].active[0],0,'The defeated opponent stays in its slot for the KO effect');
assert.equal(d.state.events.filter(e=>e.kind==='switch').length,0,'No automatic replacement event');
assert.equal(d.state.events[0].visual.teams[1].monsters[0].hp,1,'Turn visual preserves pre-hit HP');
const faint=d.state.events.find(e=>e.kind==='faint');assert(faint);assert.equal(faint.visual.teams[1].active[0],0);assert.equal(faint.visual.teams[1].monsters[0].hp,0);
assert(!d.validate(1,[attack(d,1)]).ok);assert(!d.validate(1,[]).ok);assert(!d.validate(1,[{type:'switch',slot:0,index:0}]).ok);
assert(d.validate(0,[]).ok);assert(d.validate(1,[{type:'switch',slot:0,index:2}]).ok);
const before=copy(d.state),koState=d.snapshot();
d.resolve([[],[{type:'switch',slot:0,index:2}]]);
assert.equal(d.state.phase,'action');assert.equal(d.state.turn,2);assert.equal(d.state.round,3);assert.equal(d.state.rng,before.rng);
assert.equal(d.state.teams[1].active[0],2,'Player can choose the second bench instead of its first');
assert.deepEqual(copy(d.state.teams.map(team=>team.monsters)),before.teams.map(team=>team.monsters),'Replacement consumes no HP, PP or RNG');
assert.equal(d.state.events.filter(e=>e.kind==='switch').length,1);assert(d.state.events.at(-1).forced);
const entryState=d.snapshot();
// Doubles require separate choices for each empty slot; no two slots may share a creature.
d=make('double');prepareKO(d,true);d.resolve([[attack(d,0,0,0),attack(d,0,1,1)],[attack(d,1,0),attack(d,1,1)]]);
assert.equal(d.state.phase,'replacement');assert.deepEqual(copy(d.replacementSlots(1)),[0,1]);assert.deepEqual(copy(d.state.teams[1].active),[0,1]);
assert(!d.validate(1,[{type:'switch',slot:0,index:2},{type:'switch',slot:1,index:2}]).ok);
assert(!d.validate(1,[{type:'switch',slot:0,index:2}]).ok);
const pp=JSON.stringify(d.state.teams.map(team=>team.monsters.map(mon=>mon.pp)));
d.resolve([[],[{type:'switch',slot:1,index:2},{type:'switch',slot:0,index:3}]]);
assert.deepEqual(copy(d.state.teams[1].active),[3,2]);assert.equal(d.state.turn,2);assert.equal(JSON.stringify(d.state.teams.map(team=>team.monsters.map(mon=>mon.pp))),pp);
// Only one bench remains: exactly one empty slot can be filled.
d=make('double');d.state.teams[1].monsters[0].hp=d.state.teams[1].monsters[1].hp=d.state.teams[1].monsters[3].hp=0;d._replaceFainted();
assert.deepEqual(copy(d.replacementSlots(1)),[0]);d.resolve([[],[{type:'switch',slot:0,index:2}]]);assert.equal(d.state.phase,'action');assert.equal(d.state.teams[1].active[1],1);
assert.equal(d.legalOrders(1).length,1,'Unfillable fainted slot issues no attack');
// Simultaneous recoil KOs pause for both players; terminal all-faint has no selection phase.
d=make();for(const team of d.state.teams){const mon=team.monsters[0];mon.hp=1;mon.stats.accuracy=10000;mon.stats.evasion=1;Object.keys(mon.pp).forEach(id=>mon.pp[id]=0);}
d.resolve([[{type:'struggle',slot:0,target:0}],[{type:'struggle',slot:0,target:0}]]);
assert.equal(d.state.phase,'replacement');assert.deepEqual([d.replacementSlots(0).length,d.replacementSlots(1).length],[1,1]);
assert.equal(d.state.teams[0].active[0],0);assert.equal(d.state.teams[1].active[0],0);
d.resolve([[{type:'switch',slot:0,index:2}],[{type:'switch',slot:0,index:1}]]);assert.equal(d.state.turn,2);
d=make();prepareKO(d);d.state.teams[1].monsters.slice(1).forEach(mon=>mon.hp=0);d.resolve([[attack(d,0)],[attack(d,1)]]);assert.equal(d.state.winner,0);assert.equal(d.state.phase,'action');
// Observer timing never shows the replacement during the preceding hit/faint effect.
vm.runInContext(fs.readFileSync(path.join(root,'battle-vfx.js'),'utf8'),context);const fx=LT.BattleVFX;
assert(fx.fromEvent({kind:'faint',side:1}));assert(fx.fromEvent({kind:'switch',side:1}));
const start=5000,visuals=koState.events.map(e=>fx.fromEvent(e,null,0)).filter(Boolean),duration=visuals.reduce((sum,e)=>sum+e.duration+75,0)+180;
assert(fx.onlineBusy(koState,start));assert.equal(fx.onlineView(koState,start).teams[1].monsters[0].hp,1);
const duringFaint=start+visuals[0].duration+76;assert.equal(fx.onlineView(koState,duringFaint).teams[1].active[0],0);assert(fx.onlineBusy(koState,duringFaint));
assert(!fx.onlineBusy(koState,start+duration+1));assert.equal(fx.onlineView(koState,start+duration+1).teams[1].active[0],0);
assert(fx.onlineBusy(entryState,start+duration+100));assert.equal(fx.onlineView(entryState,start+duration+100).teams[1].active[0],2,'Arrival effect uses the selected incoming creature');
const untouched=JSON.stringify(koState),slowKO={...copy(koState),seed:koState.seed+1},fastEntry={...copy(entryState),seed:koState.seed+1},slowStart=20000;
assert(fx.onlineBusy(slowKO,slowStart));assert(fx.onlineBusy(fastEntry,slowStart+100));
assert.equal(fx.onlineView(fastEntry,slowStart+200).teams[1].active[0],0,"A faster peer must not truncate this client's KO animation");
assert.equal(fx.onlineView(fastEntry,slowStart+duration+1).teams[1].active[0],2,'Queued arrival follows the full KO playback');
assert.equal(JSON.stringify(koState),untouched,'Playback never mutates synchronized state');
async function pair(){
 const queue=[],sessions=[0,1].map(role=>new LT.DuelSession({role,mode:'single',send:message=>{queue.push({role,message:copy(message)});return true;}}));
 async function flush(){for(let idle=0,n=0;idle<3;){if(++n>150)throw Error('Protocol failed to settle');if(queue.length){idle=0;const{role,message}=queue.shift();await sessions[1-role].receive(message);}else{idle++;await new Promise(setImmediate);}}}
 sessions.forEach(session=>session.start());await flush();sessions.forEach((session,side)=>assert(session.setTeam({name:'P'+side,ids:ids.slice(side*4,side*4+3)}).ok));await flush();
 return{sessions,flush,queue,close(){sessions.forEach(session=>session.close());}};
}
(async()=>{
 const p=await pair();try{
  p.sessions.forEach(session=>prepareKO(session.duel));
  await Promise.all(p.sessions.map((session,side)=>session.submit([attack(session.duel,side)])));await p.flush();
  assert(p.sessions.every(session=>session.duel.state.phase==='replacement'));assert(p.sessions[0].snapshot().localSubmitted,'Unaffected side acknowledges replacement without taking a turn');
  assert.equal(p.sessions[1].snapshot().phase,'choosing');assert(!p.sessions[1].snapshot().localSubmitted);
  assert((await p.sessions[1].submit([{type:'switch',slot:0,index:2}])).ok);await p.flush();
  assert(p.sessions.every(session=>session.snapshot().phase==='choosing'&&session.duel.state.phase==='action'));
  assert.equal(p.sessions[0].duel.state.turn,2);assert.equal(p.sessions[0].duel.state.round,3);
  assert.equal(p.sessions[0].duel.fingerprint(),p.sessions[1].duel.fingerprint(),'Commit/reveal and synchronization include the manual choices');
  await p.sessions[1].receive({v:LT.DuelSession.VERSION,t:'commit',session:p.sessions[1].sessionId,turn:2,hash:'a'.repeat(64)});
  assert.equal(p.sessions[1].snapshot().phase,'error','Replacement packet cannot be replayed as next action turn');
 }finally{p.close();}
 const old=await pair();try{await old.sessions[0].receive({v:1,t:'commit'});assert.equal(old.sessions[0].snapshot().phase,'error','Old client protocol is rejected');}finally{old.close();}
 console.log('Online replacement checks passed: manual single/double choices, unique reserves, partial doubles, simultaneous recoil, no-turn/no-attack replacement, terminal KO, event snapshots, playback lock, synchronized commit/reveal and stale-packet rejection.');
})().catch(error=>{console.error(error);process.exitCode=1;});
