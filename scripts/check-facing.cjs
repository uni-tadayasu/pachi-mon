#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {runtime,canvas}=require('./check-art.cjs');
async function main(){
 const {LT,engine}=await runtime(),art=LT.CreatureArt,all=Object.keys(LT.DATA.species);
 const finals=['komorizen','shizunaria','akehomura'];
 const bat=all.find(id=>art.lineage(id).shape==='bat'&&art.lineage(id).stage===1);
 if(bat)assert.equal(art.orientation(bat,true).stage,0,'Loading fallback orientation must describe the actual original sheet');
 await art.preload(all,{back:'both'});
 assert.equal(art.orientation('komori',true).direction,-1,'Authored sprig rear looks left');
 assert.equal(art.orientation('komori',false).direction,1,'Authored sprig front looks right');
 assert.equal(art.orientation('futo',true).direction,1,'Futo uses its right-facing front fallback');
 assert.equal(art.orientation('futo',true).authoredBack,false);
 assert.equal(art.orientation('arvelion',false).direction,-1,'Legendary front looks toward the player');
 assert.equal(art.orientation('arvelion',true).direction,1,'Legendary rear looks toward the opponent');
 assert.equal(art.orientation('arvelion',true).authoredBack,true);
 if(bat){assert.equal(art.orientation(bat,true).stage,1);assert.equal(art.orientation(bat,true).direction,-1);}
 for(const id of finals){assert.equal(art.lineage(id).stage,2);assert.equal(art.orientation(id,true).stage,2);assert.equal(art.orientation(id,true).direction,-1);}
 for(const id of all)for(const back of [false,true])for(const target of ['left','right']){
  const orientation=art.orientation(id,back),resolved=LT.PixelSprites.battleFacing(id,back,target);
  assert([-1,0,1].includes(orientation.direction),`${id}: no authored direction`);
  const effective=orientation.direction*(resolved.flip?-1:1);
  assert(effective===0||effective===(target==='left'?-1:1),`${id}: gaze points away from opponent`);
  if(!orientation.direction)assert.equal(resolved.flip,false,'Neutral poses should not be needlessly mirrored');
 }
 // Capture real Canvas transforms at the actual draw call. This detects a
 // regression where correct metadata exists but battle/duel ignores it.
 const target=canvas.createCanvas(768,480),c=target.getContext('2d'),draw=c.drawImage.bind(c),get=art.get,trace=[];
 const markers=new Map();art.get=(id,back)=>{const key=id+':'+back;if(!markers.has(key)){const cv=canvas.createCanvas(32,32);cv._monster={id,back};cv.getContext('2d').fillRect(2,2,8,12);markers.set(key,cv);}return markers.get(key);};
 c.drawImage=(image,...args)=>{if(image._monster)trace.push({...image._monster,a:c.getTransform().a});return draw(image,...args);};
 function verify(expected){assert.equal(trace.length,expected.length);for(let i=0;i<expected.length;i++){const [id,back,target]=expected[i],actual=trace[i];assert.equal(actual.id,id);assert.equal(actual.back,back);assert.equal(actual.a<0,LT.PixelSprites.battleFacing(id,back,target).flip,`${id}: draw ignored battle orientation`);}trace.length=0;}
 for(const ally of [...finals,'futo','arvelion']){
  engine.state.party=[engine.makeMonster(ally,45)];engine.battle={activeIndex:0,enemy:engine.makeMonster('komori',45)};
  LT.Art.battle(target,engine,0);verify([['komori',false,'left'],[ally,true,'right']]);
 }
 const state={mode:'double',teams:[{active:[0,1],monsters:finals.slice(0,2).map(id=>engine.makeMonster(id,45))},{active:[0,1],monsters:[engine.makeMonster(finals[2],45),engine.makeMonster('futo',45)]}]};
 for(const side of [0,1]){LT.PixelSprites.duel(target,state,side,0);verify([...state.teams[1-side].monsters.map(m=>[m.species,false,'left']),...state.teams[side].monsters.map(m=>[m.species,true,'right'])]);}
 LT.Art.creature(target,'komori',{back:true,time:0});assert.equal(trace[0].a,1,'Portrait rear view must keep its authored orientation');trace.length=0;
 art.get=get;c.drawImage=draw;
 const output=process.argv[2];
 if(output){
  const width=768,height=480,labels=['Starter finale: komorizen','Starter finale: shizunaria','Starter finale: akehomura','Doubles: starter finales / Futo front fallback','Doubles: reversed player viewpoint'];
  const contact=canvas.createCanvas(width*2,(height+34)*3),cc=contact.getContext('2d');cc.fillStyle='#142331';cc.fillRect(0,0,contact.width,contact.height);
  for(let i=0;i<labels.length;i++){
   if(i<3){engine.state.party=[engine.makeMonster(finals[i],45)];engine.battle={activeIndex:0,enemy:engine.makeMonster(finals[(i+1)%3],45)};LT.Art.battle(target,engine,0);}
   else LT.PixelSprites.duel(target,state,i===3?0:1,0);
   const x=(i%2)*width,y=Math.floor(i/2)*(height+34);cc.fillStyle='#e4edf3';cc.font='16px sans-serif';cc.fillText(labels[i],x+14,y+23);cc.drawImage(target,x,y+34);
  }
  fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,contact.toBuffer('image/png'));
 }
 console.log(JSON.stringify({ok:true,species:all.length,orientationCombinations:all.length*4,authoredSheets:13,soloCases:5,doubleViewpoints:2,portraitOrientationPreserved:true,finaleSprites:finals,legendaryFrontBack:true}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
