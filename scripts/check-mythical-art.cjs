#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {runtime,canvas,imageStats}=require('./check-art.cjs');
const id='floravelle';
async function main(){
 const run=await runtime(),{LT,engine}=run,art=LT.CreatureArt;
 await art.preload(id,{back:'both'});
 assert(art.status().floravelleLoaded);assert(!LT.IndividualCreatureArt.has(id));assert(art.supportsBack(id));
 const views=[false,true].map(back=>art.get(id,back)),stats=views.map(imageStats);
 for(const s of stats){assert(s.fraction>.1&&s.fraction<.85);assert(s.left>=10&&s.right<311&&s.top>=10&&s.bottom<311);}
 assert.notEqual(stats[0].hash,stats[1].hash);
 const mirror=canvas.createCanvas(320,320),mc=mirror.getContext('2d');mc.translate(320,0);mc.scale(-1,1);mc.drawImage(views[0],0,0);
 assert.notEqual(imageStats(mirror).hash,stats[1].hash,'Rear cannot be a mirrored front');
 assert(Math.abs(stats[0].bottom-stats[1].bottom)<=1);assert(Math.abs(stats[0].top-stats[1].top)<=2);
 for(const back of [false,true]){
  assert.equal(art.orientation(id,back).direction,back?1:-1);assert.equal(art.orientation(id,back).authoredBack,back);
  const shiny=imageStats(art.get(id,back,{shiny:true}));assert.notEqual(shiny.hash,stats[+back].hash);assert.equal(shiny.opaque,stats[+back].opaque);
 }
 const cv=canvas.createCanvas(160,160);
 for(const back of [false,true]){
  LT.Art.creature(cv,id,{back,time:0});const rest=imageStats(cv);assert(rest.fraction>.1);
  LT.Art.creature(cv,id,{back,time:1100});const idle=imageStats(cv);
  LT.Art.creature(cv,id,{back,time:1100,action:'cast',progress:.5});assert.notEqual(imageStats(cv).hash,idle.hash);
  LT.Art.creature(cv,id,{back,time:1100,reducedMotion:true});assert.equal(imageStats(cv).hash,rest.hash);
 }
 const failed=await runtime('broken-assets');assert(failed.LT.CreatureArt.status().floravelleFailed);
 const fallbackHashes=[];
 for(const back of [false,true]){
  const sprite=failed.LT.CreatureArt.get(id,back),s=imageStats(sprite);assert(s.fraction>.1&&s.fraction<.85);fallbackHashes.push(s.hash);
  assert.equal(failed.LT.CreatureArt.orientation(id,back).direction,back?1:-1);assert.equal(failed.LT.CreatureArt.orientation(id,back).source,'floravelle-fallback');
  assert.notEqual(s.hash,stats[+back].hash);
 }
 assert.notEqual(...fallbackHashes);
 const delayed=await runtime('delayed-assets');
 for(const back of [false,true]){assert.equal(imageStats(delayed.LT.CreatureArt.get(id,back)).hash,fallbackHashes[+back]);delayed.LT.CreatureArt.get(id,back,{shiny:true});}
 const recovery=await delayed.finishDelayedImages();assert(recovery.notifications>0);assert(delayed.LT.CreatureArt.status().floravelleLoaded);
 for(const back of [false,true])for(const shiny of [false,true])assert.equal(imageStats(delayed.LT.CreatureArt.get(id,back,{shiny})).hash,imageStats(art.get(id,back,{shiny})).hash,'Late atlas must replace cached fallback and shiny');
 const output=process.argv[2];if(output){
  const out=canvas.createCanvas(1536,914),c=out.getContext('2d');c.fillStyle='#203c36';c.fillRect(0,0,out.width,out.height);c.fillStyle='white';c.font='20px sans-serif';
  for(let i=0;i<4;i++){c.fillText(['Floravelle front','Floravelle rear','Shiny front','Shiny rear'][i],i*384+20,28);c.drawImage(art.get(id,i%2===1,{shiny:i>=2}),i*384+32,45);}
  const battle=canvas.createCanvas(768,480);engine.state.party=[engine.makeMonster(id,70)];engine.battle={activeIndex:0,enemy:engine.makeMonster('arvelion',70)};LT.Art.battle(battle,engine,0);
  c.fillText('Solo: mythical rear faces opponent',20,418);c.drawImage(battle,0,434);
  const state={mode:'double',teams:[{active:[0,1],monsters:[id,'arvelion'].map(s=>engine.makeMonster(s,70))},{active:[0,1],monsters:['futo',id].map(s=>engine.makeMonster(s,70))}]};LT.PixelSprites.duel(battle,state,0,0);c.fillText('Doubles: distinct front and rear',788,418);c.drawImage(battle,768,434);
  fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,out.toBuffer('image/png'));
 }
 console.log(JSON.stringify({ok:true,authoredFrontRear:true,distinctNotMirrored:true,transparentMargins:true,shinyShapePreserved:true,dedicatedFallback:true,delayedRecovery:true,gameSizeRendering:true}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
