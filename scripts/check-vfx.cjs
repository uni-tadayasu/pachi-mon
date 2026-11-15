#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {runtime,canvas,imageStats}=require('./check-art.cjs');

async function main(){
  const {LT,engine}=await runtime();
  globalThis.LT=LT;
  const source=fs.readFileSync(path.join(__dirname,'../battle-vfx.js'),'utf8');
  new vm.Script(source);
  const api=require('../battle-vfx.js');
  assert(LT.Art.battle._pachiVFX,'Battle hook was not installed');
  const moves=Object.values(LT.DATA.moves),families=new Set(moves.map(m=>api.classify(m)));
  assert(families.size>=18,`Too few distinct move families: ${families.size}`);
  assert(moves.every(m=>api.styles.includes(api.classify(m))),'Unmapped technique');
  const sample=LT.DATA.moves.frost;
  assert.equal(api.fromEvent({kind:'damage',text:`敵の「${sample.name}」。30のダメージ。`,side:'enemy'},LT.DATA.moves.spark,100).style,'ice');
  assert.equal(api.fromEvent({kind:'miss',text:'攻撃は外れた。',side:'enemy'},null,100).style,'miss');
  assert.equal(api.fromEvent({kind:'heal',amount:0,side:'ally'},null,100),null);
  assert.equal(api.fromEvent({kind:'switch',side:'ally'},null,100),null);
  assert.equal(api.fromEvent({kind:'damage',move:'spark',amount:34,critical:true,side:1,slot:1,target:1},null,100).amount,34);
  const a=api.anchors(1000,500,{side:1,slot:1,target:1,kind:'damage'},{online:true,double:true,side:1});
  assert.deepEqual(a.source,{x:470,y:375});assert.deepEqual(a.target,{x:820,y:185});
  const b=api.anchors(1000,500,{side:0,slot:1,target:0,kind:'heal'},{online:true,double:true,side:1});
  assert.deepEqual(b.source,b.target);assert.equal(b.source.x,820);
  const futoMoves=[['futo_breaker','damage','fracture-punch'],['futo_burst','damage','focus-beam'],['futo_ascend','boost','ascension'],['futo_restore','heal','healing']];
  const futoEvents=futoMoves.map(([id,kind,style])=>{
    const move=LT.DATA.moves[id];assert(move,`Missing Futo technique: ${id}`);
    assert.equal(api.classify(move),style,`${id} must have its intended visual style`);
    const event=api.fromEvent({kind,move:id,side:1,slot:1,target:0,amount:kind==='damage'?100:kind==='heal'?50:0},null,100);
    assert.equal(event.style,style);assert.equal(event.move,id);
    const quoted=api.fromEvent({kind,text:`敵の「${move.name}」！`,side:'enemy'},null,100);
    assert.equal(quoted.style,style,`${id} must resolve from solo event text`);
    if(kind==='boost'||kind==='heal'){
      for(const [side,options] of [['ally',{}],['enemy',{}],[1,{online:true,double:true,side:1}],[0,{online:true,double:true,side:1}]]){
        const anchor=api.anchors(1000,500,{...event,side,slot:1,target:0},options);
        assert.deepEqual(anchor.target,anchor.source,`${id} must stay on its caster in solo and double battles`);
      }
    }
    return event;
  });
  assert.equal(api.fromEvent({kind:'boost',move:'futo_ascend',side:0,changed:false},null,100),null,'Capped boosts must not show a stat increase');
  const snapshots=JSON.stringify({data:LT.DATA,state:engine.state});
  const cv=canvas.createCanvas(768,440),c=cv.getContext('2d');
  let rendered=0;
  for(const [i,style] of api.styles.entries())for(const quality of ['high','low']){
    const kind=style==='healing'?'heal':style==='shield'?'guard':style==='ascension'?'boost':style==='capture'?'capture':style==='miss'?'miss':'damage';
    const event={style,kind,side:'ally',element:['leaf','tide','ember','wind','crystal'][i%5],started:100,duration:1000,seed:17,power:45,amount:kind==='damage'?78:0};
    for(const age of [0.2,0.51,0.81]){
      c.clearRect(0,0,cv.width,cv.height);const yes=api.render(c,cv.width,cv.height,100+age*1000,event,{quality});
      assert.equal(yes,true);assert(imageStats(cv).opaque>0,`${style} / ${quality} / ${age} did not paint`);rendered++;
    }
    c.clearRect(0,0,cv.width,cv.height);assert.equal(api.render(c,768,440,610,event,{reducedMotion:true}),false);assert.equal(imageStats(cv).opaque,0);
    assert.equal(api.render(c,768,440,1300,event),false);
  }
  const futoHashes=new Set();
  for(const event of futoEvents){
    c.clearRect(0,0,768,440);
    api.render(c,768,440,event.started+event.duration*.56,event,{online:true,double:true,side:1,quality:'high'});
    const first=imageStats(cv);assert(first.opaque>0,`${event.move} must paint`);futoHashes.add(first.hash);
    c.clearRect(0,0,768,440);
    api.render(c,768,440,event.started+event.duration*.56,event,{online:true,double:true,side:1,quality:'high'});
    assert.equal(imageStats(cv).hash,first.hash,`${event.move} must render deterministically`);
  }
  assert.equal(futoHashes.size,futoEvents.length,'Futo techniques must have distinct visuals');
  assert.equal(JSON.stringify({data:LT.DATA,state:engine.state}),snapshots,'Visual effects mutated gameplay');
  const first=api.fromEvent({kind:'damage',move:'frost',side:'ally',amount:25},null,100);
  c.clearRect(0,0,768,440);api.render(c,768,440,600,first);const one=imageStats(cv).hash;
  c.clearRect(0,0,768,440);api.render(c,768,440,600,first);assert.equal(imageStats(cv).hash,one,'Rendering is not deterministic');
  const previewArg=process.argv.indexOf('--preview');
  if(previewArg>=0&&process.argv[previewArg+1]){
    const styles=api.styles.filter(x=>x!=='miss'),tileW=384,tileH=240,cols=4,rows=Math.ceil(styles.length/cols);
    const sheet=canvas.createCanvas(tileW*cols,tileH*rows),sc=sheet.getContext('2d');sc.fillStyle='#101b2b';sc.fillRect(0,0,sheet.width,sheet.height);
    styles.forEach((style,i)=>{
      const tile=canvas.createCanvas(768,440),tc=tile.getContext('2d');
      const kind=style==='healing'?'heal':style==='shield'?'guard':style==='ascension'?'boost':style==='capture'?'capture':'damage';
      tc.fillStyle='#213348';tc.fillRect(0,0,768,440);tc.fillStyle='#34546a';tc.fillRect(0,275,768,165);
      const mon=Object.values(LT.DATA.species)[0];
      LT.PixelSprites.creature(tc,mon.id,{x:140,y:240,size:180,back:true});
      LT.PixelSprites.creature(tc,mon.id,{x:490,y:80,size:150,flip:true});
      const futo=futoMoves.find(([, , family])=>family===style);
      api.render(tc,768,440,650,{style,kind,move:futo?.[0],side:'ally',element:futo?'crystal':['leaf','tide','ember','wind','crystal'][i%5],started:100,duration:1000,seed:17,power:45,amount:0},{quality:'high'});
      const x=(i%cols)*tileW,y=Math.floor(i/cols)*tileH;sc.drawImage(tile,x,y,tileW,tileH-20);
      sc.fillStyle='#f4f8ff';sc.font='bold 13px sans-serif';sc.fillText(style,x+10,y+tileH-5);
    });
    fs.writeFileSync(process.argv[previewArg+1],await sheet.encode('webp',88));
  }
  console.log(JSON.stringify({ok:true,moves:moves.length,moveFamilies:families.size,styles:api.styles.length,renderedFrames:rendered,qualities:2,deterministic:true,reducedMotion:true,gameplayUnchanged:true}));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
