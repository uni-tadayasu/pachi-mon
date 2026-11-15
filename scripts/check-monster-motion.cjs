#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {runtime,canvas,imageStats}=require('./check-art.cjs');
async function main(){
 const {LT,engine}=await runtime();
 const byShape=new Map();
 for(const s of Object.values(LT.DATA.species)){const family=LT.CreatureArt.lineage(s.id);if(!byShape.has(family.shape))byShape.set(family.shape,s.id);}
 const ids=[...new Set([...byShape.values(),'futo','komorion','saikaju'])];
 await LT.CreatureArt.preload(ids,{back:'both'});
 const before=JSON.stringify(engine.state),profiles=new Set();let views=0;
 const cv=canvas.createCanvas(200,200);
 function frame(id,options){LT.Art.creature(cv,id,options);return imageStats(cv);}
 for(const id of ids){
  profiles.add(LT.PixelSprites.motionProfile(id));
  for(const back of [false,true]){
   const normal=frame(id,{back,time:0}),shiny=frame(id,{back,time:0,shiny:true});
   assert(normal.fraction>.03&&shiny.fraction>.03,`${id}: empty image`);
   assert.notEqual(normal.hash,shiny.hash,`${id}: shiny palette must be distinct`);
   assert.equal(normal.opaque,shiny.opaque,`${id}: shiny variant changed shape`);
   assert.equal(frame(id,{back,time:3100,reducedMotion:true}).hash,normal.hash,`${id}: reduced motion moved sprite`);
   assert.equal(frame(id,{back,time:3100,motion:false}).hash,normal.hash,`${id}: disabled motion moved sprite`);
   const a=frame(id,{back,time:1100}),b=frame(id,{back,time:1600});
   assert.notEqual(a.hash,b.hash,`${id}: idle animation did not move`);
   assert.notEqual(frame(id,{back,time:1100,action:'attack',progress:.5}).hash,a.hash,`${id}: physical pose missing`);
   assert.notEqual(frame(id,{back,time:1100,action:'cast',progress:.35}).hash,a.hash,`${id}: cast pose missing`);
   assert.notEqual(frame(id,{back,time:1100,action:'hit',progress:.53}).hash,a.hash,`${id}: hit pose missing`);
   assert.notEqual(frame(id,{back,time:1100,action:'faint',progress:1}).hash,a.hash,`${id}: faint pose missing`);
   views++;
  }
  global.gc?.();await new Promise(setImmediate);
 }
 assert.equal(profiles.size,5,'All five family motion rigs must be used');
 assert.equal(LT.CreatureArt.supportsBack('futo'),false,'Futo has no authored rear illustration');
 assert.equal(LT.CreatureArt.supportsBack('komori'),true);
 const pose=LT.PixelSprites.battlePose;
 assert.equal(pose({side:'ally',slot:0,target:0,kind:'damage',category:'physical',started:100,duration:1000},600,'ally').action,'attack');
 assert.equal(pose({side:'ally',slot:0,target:0,kind:'damage',category:'physical',started:100,duration:1000},600,'enemy').action,'hit');
 assert.equal(pose({side:1,slot:1,target:0,kind:'damage',category:'special',started:100,duration:1000},600,'ally',1,{online:true,side:1}).action,'cast');
 assert.equal(pose({side:1,slot:1,target:0,kind:'damage',category:'special',started:100,duration:1000},600,'ally',0,{online:true,side:1}).action,undefined,'Doubles unrelated slot moved');
 assert.equal(pose({side:'ally',kind:'miss',started:100,duration:1000},600,'enemy').action,undefined,'A miss triggered hit motion');
 assert.equal(JSON.stringify(engine.state),before,'Rendering changed save data');
 assert(LT.CreatureArt.status().cached<=LT.CreatureArt.status().cacheLimit);
 console.log(JSON.stringify({ok:true,speciesSampled:ids.length,frontBackViews:views,motionProfiles:profiles.size,poses:4,shinySilhouettesPreserved:true,reducedMotion:true,authoredFutoRear:false}));
}
if(!global.gc){const child=require('node:child_process').spawnSync(process.execPath,['--expose-gc',__filename],{stdio:'inherit'});process.exitCode=child.status??1;}else main().catch(e=>{console.error(e.stack);process.exitCode=1;});
