#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),context=vm.createContext({console});
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
 if(/\bsrc=|application\/ld\+json/.test(match[1]))continue;
 vm.runInContext(match[2],context);if(context.LT?.Engine)break;
}
vm.runInContext(fs.readFileSync(path.join(__dirname,'../battle-vfx.js'),'utf8'),context);
const {LT}=context,{Engine,DATA}=LT,copy=value=>JSON.parse(JSON.stringify(value));
function harness(engine,reducedMotion=false){
 const log={children:[],replaceChildren(){this.children=[];},appendChild(node){this.children.push(node);},scrollTop:0,scrollHeight:100};
 const nodes={'battle-log':log,'battle-actions':{querySelectorAll:()=>[]},'game-canvas':{classList:{remove(){}}}};
 const out={frames:[],saves:0,toasts:[],draws:[],sounds:[]};
 const c=vm.createContext({engine,LT,DATA,battleView:null,battleEffect:null,busy:false,evolutionUntil:0,settings:{reducedMotion},performance:{now:()=>100},
  $:id=>nodes[id],document:{createElement:()=>({textContent:''})},toast:msg=>out.toasts.push(msg),updateScene(){},
  updateAll(){out.draws.push({busy:c.busy,enemy:(c.battleView||engine).battle.enemy.species});},updateBattle(){},save(){out.saves++;},
  sound:{fx:name=>out.sounds.push(name),move(){}},setTimeout(fn,duration){out.frames.push({duration,busy:c.busy,effect:copy(c.battleEffect),visual:copy(c.battleView.battle),party:copy(c.battleView.state.party)});return setTimeout(fn,0);}});
 const start=html.indexOf('  function captureBattleView()'),end=html.indexOf('  function openBattle()',start);
 assert(start>0&&end>start);vm.runInContext(html.slice(start,end),c);
 return {c,out};
}
function make(){const e=new Engine();e.newGame('komori');e.state.party=[e.makeMonster('arvelion',70),e.makeMonster('floravelle',70),e.makeMonster('futo',70)];e.rng=()=>.5;e.startTeamBattle([{species:'komori',level:1},{species:'shizuku',level:3}]);return e;}
async function run(){
 let e=make(),{c,out}=harness(e);const first=e.battle.enemy.species;
 await c.doBattle({type:'move',index:0});
 assert(e.battle.pendingReplacement);assert.equal(e.battle.enemy.species,first);
 const hit=out.frames.find(f=>f.effect?.kind==='damage'),faint=out.frames.find(f=>f.effect?.kind==='faint');
 assert(hit&&faint,'Lethal hit and collapse must both play');assert(hit.visual.enemy.hp>0,'The target remains visible until the hit effect completes');
 assert.equal(faint.visual.enemy.hp,0);assert(faint.duration>=950);assert.equal(faint.visual.enemy.species,first);
 assert(out.frames.every(f=>f.busy));assert(out.frames.every(f=>f.visual.enemy.species===first));assert.equal(c.battleView,null);assert.equal(c.busy,false);assert.equal(out.saves,1);
 const oldCount=out.frames.length;await c.chooseBattleReplacement(2);
 const arrivals=out.frames.slice(oldCount).filter(f=>f.effect?.kind==='switch');assert.equal(arrivals.length,2);
 assert.equal(arrivals[0].party[arrivals[0].visual.activeIndex].species,'futo');assert.equal(arrivals[0].visual.enemy.species,first);
 assert.equal(arrivals[1].visual.enemy.species,'shizuku');assert.equal(e.battle.activeIndex,2);assert.equal(e.battle.enemy.species,'shizuku');
 assert.equal(out.saves,2);assert.equal(c.busy,false);
 // Motion-reduced settings still settle the two states in order and release controls.
 e=make();({c,out}=harness(e,true));await c.doBattle({type:'move',index:0});assert(out.frames.every(f=>f.duration<=180));assert(e.battle.pendingReplacement);assert(!c.busy);
 const before=out.frames.length;await c.doBattle({type:'move',index:0});assert.equal(out.frames.length,before);assert(out.toasts.length);
 // Duplicate inputs while playback is outstanding cannot run a second engine turn.
 e=make();({c,out}=harness(e));const pending=c.doBattle({type:'move',index:0});const turn=e.battle.turn;await c.doBattle({type:'move',index:0});await pending;assert.equal(e.battle.turn,turn);
 assert(html.includes("battleView||engine,settings.reducedMotion?0:now"),'Canvas must render the staged view');
 assert(html.includes("if(b.pendingReplacement){"));assert(html.includes('data-replacement='));assert(html.includes("chooseBattleReplacement(Number(d.replacement))"));
 console.log('Battle playback passed: lethal hit before collapse, retained participants, selected arrivals after animation, no duplicate input, motion-reduced completion, staged canvas and choice UI.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
