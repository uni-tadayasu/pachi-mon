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
  // Exactly 24 move effects, every one of them used by some move.
  assert.equal(api.effects.length,24);assert.equal(new Set(api.effects).size,24);
  assert.equal(families.size,24,`Every move effect is used: ${[...families].join(',')}`);
  assert(moves.every(m=>api.effects.includes(api.classify(m))),'Every move uses one of the 24 effects');
  assert.deepEqual([...api.styles].sort(),[...api.effects,'capture','miss','faint','arrival'].sort());
  assert(moves.every(m=>api.styles.includes(api.classify(m))),'Unmapped technique');
  assert(api.budgets.low.particles < api.budgets.high.particles);
  assert(api.budgets.high.ribbonSteps <= 26 && api.budgets.high.corona <= 15);
  const sample=LT.DATA.moves.frost;
  assert.equal(api.fromEvent({kind:'damage',text:`敵の「${sample.name}」。30のダメージ。`,side:'enemy'},LT.DATA.moves.spark,100).style,'ice');
  assert.equal(api.fromEvent({kind:'miss',text:'攻撃は外れた。',side:'enemy'},null,100).style,'miss');
  assert.equal(api.fromEvent({kind:'heal',amount:0,side:'ally'},null,100),null);
  assert.equal(api.fromEvent({kind:'switch',side:'ally'},null,100).style,'arrival');
  assert.equal(api.fromEvent({kind:'faint',side:'enemy'},null,100).style,'faint');
  assert.equal(api.fromEvent({kind:'damage',move:'spark',amount:34,critical:true,side:1,slot:1,target:1},null,100).amount,34);
  const a=api.anchors(1000,500,{side:1,slot:1,target:1,kind:'damage'},{online:true,double:true,side:1});
  assert.deepEqual(a.source,{x:470,y:375});assert.deepEqual(a.target,{x:820,y:185});
  const b=api.anchors(1000,500,{side:0,slot:1,target:0,kind:'heal'},{online:true,double:true,side:1});
  assert.deepEqual(b.source,b.target);assert.equal(b.source.x,820);
  const futoMoves=[['futo_breaker','damage','impact'],['futo_burst','damage','beam'],['futo_ascend','boost','ascension'],['futo_restore','heal','healing']];
  const futoEvents=futoMoves.map(([id,kind,style])=>{
    const move=LT.DATA.moves[id];assert(move,`Missing Futo technique: ${id}`);
    assert.equal(api.classify(move),style,`${id} must have its intended visual style`);
    const event=api.fromEvent({kind,move:id,side:1,slot:1,target:0,amount:kind==='damage'?100:kind==='heal'?50:0},null,100);
    assert.equal(event.style,style);assert.equal(event.move,id);
    assert.equal(event.category,move.category);assert.equal(event.releaseAt,.14);assert.equal(event.impactAt,.43);
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
  const legendaryMoves=[['arvelion_rend','damage','astral-rend'],['arvelion_nova','damage','creation-nova'],['arvelion_crown','boost','ascension'],['arvelion_renewal','heal','healing']];
  const legendaryEvents=legendaryMoves.map(([id,kind,style])=>{
    const move=LT.DATA.moves[id];assert(move,`Missing legendary technique: ${id}`);
    assert.equal(api.classify(move),style);
    const event=api.fromEvent({kind,move:id,side:'enemy',amount:kind==='heal'?250:100},null,100);
    assert.equal(event.style,style);assert.equal(event.move,id);
    assert.equal(api.fromEvent({kind,text:`敵の「${move.name}」！`,side:'enemy'},null,100).style,style);
    if(kind==='boost'||kind==='heal'){
      const anchor=api.anchors(1000,500,event);
      assert.deepEqual(anchor.source,anchor.target,'Legendary status effect must stay on caster');
    }
    return event;
  });
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
  const legendaryHashes=new Set();
  for(const event of legendaryEvents){
    c.clearRect(0,0,768,440);api.render(c,768,440,event.started+event.duration*.56,event,{quality:'high'});
    const first=imageStats(cv);assert(first.opaque>0,`${event.move} must paint`);legendaryHashes.add(first.hash);
    c.clearRect(0,0,768,440);api.render(c,768,440,event.started+event.duration*.56,event,{quality:'high'});
    assert.equal(imageStats(cv).hash,first.hash,'Legendary animation must be deterministic');
  }
  assert.equal(legendaryHashes.size,4,'Legendary techniques must have four distinct visuals');
  assert.equal(JSON.stringify({data:LT.DATA,state:engine.state}),snapshots,'Visual effects mutated gameplay');
  const first=api.fromEvent({kind:'damage',move:'frost',side:'ally',amount:25},null,100);
  c.clearRect(0,0,768,440);api.render(c,768,440,600,first);const one=imageStats(cv).hash;
  c.clearRect(0,0,768,440);api.render(c,768,440,600,first);assert.equal(imageStats(cv).hash,one,'Rendering is not deterministic');
  // Verify every style stays finite at tiny canvas sizes and phase edges.
  // The proxy counts actual canvas work, not an implementation-mirroring loop.
  let calls=0;
  const geometry=new Set(['moveTo','lineTo','quadraticCurveTo','bezierCurveTo','arc','ellipse','fillRect','strokeRect','translate','rotate','scale']);
  const measured=new Proxy(c,{
    get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      return (...args)=>{calls++;if(geometry.has(key))for(const n of args)if(typeof n==='number')assert(Number.isFinite(n),`${String(key)} received a nonfinite coordinate`);return value.apply(target,args);};},
    set(target,key,value){return Reflect.set(target,key,value,target);}
  });
  let largestBudget=0;
  for(const style of api.styles)for(const time of [100,101,530,1099,1100]){
    const event={style,kind:'damage',element:'crystal',side:'enemy',started:100,duration:1000,power:100,seed:17};
    calls=0;api.render(measured,64,40,time,event,{quality:'low'});
    largestBudget=Math.max(largestBudget,calls);
    assert(calls<2600,`${style} exceeded a bounded low quality canvas budget: ${calls}`);
    assert.equal(c.globalAlpha,1,'Effect leaked alpha');assert.equal(c.globalCompositeOperation,'source-over','Effect leaked blending');
  }
  const variant={style:'beam',kind:'damage',element:'crystal',side:'ally',started:100,duration:1000,power:100,seed:17};
  c.clearRect(0,0,768,440);api.render(c,768,440,640,{...variant,category:'physical'});const physical=imageStats(cv).hash;
  c.clearRect(0,0,768,440);api.render(c,768,440,640,{...variant,category:'special'});assert.notEqual(imageStats(cv).hash,physical,'Physical and special impact language must differ');
  calls=0;api.render(measured,768,440,640,variant,{quality:'low'});const lowCalls=calls;
  calls=0;api.render(measured,768,440,640,variant,{quality:'high'});assert(calls>lowCalls,'High quality must add visual detail while low quality reduces work');
  // Both battle hooks must convey choreography to the underlying monster
  // renderer, including source/target slots for doubles.
  let soloOptions,duelOptions,soundCalls=0;
  const hookLT={DATA:LT.DATA,playMoveSound:()=>{soundCalls++;},Art:{battle:(cv,engine,time,options)=>{soloOptions=options;}},PixelSprites:{duel:(cv,state,side,time,options)=>{duelOptions=options;}}};
  const sandbox={LT:hookLT,module:{exports:{}},localStorage:{getItem:()=>null}};vm.runInNewContext(source,sandbox);
  hookLT.Art.battle(cv,engine,0,{effect:first,quality:'low',reducedMotion:true});
  assert.equal(soloOptions.effect,first);assert.equal(soloOptions.hideLegacyEffect,true);assert.equal(soloOptions.reducedMotion,true);
  const online={seed:1,turn:1,mode:'double',teams:[[],[]],events:[{kind:'damage',move:'futo_burst',side:1,slot:1,target:0,amount:100}]};
  hookLT.PixelSprites.duel(cv,online,1,100);
  assert.equal(duelOptions.effect.move,'futo_burst');assert.equal(duelOptions.effect.slot,1);assert.equal(duelOptions.effect.target,0);
  assert.equal(duelOptions.hideLegacyEffect,true);assert.equal(duelOptions.double,true);assert.equal(duelOptions.side,1);
  hookLT.PixelSprites.duel(cv,online,1,110);assert.equal(soundCalls,1,'Repainting an online effect must not repeat its sound');
  hookLT.PixelSprites.duel(cv,online,1,2000);assert.equal(duelOptions.effect,undefined,'Expired motions must clear');
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
      const signature=[...futoMoves,...legendaryMoves].find(([, , family])=>family===style);
      api.render(tc,768,440,650,{style,kind,move:signature?.[0],side:'ally',element:signature?'crystal':['leaf','tide','ember','wind','crystal'][i%5],started:100,duration:1000,seed:17,power:45,amount:0},{quality:'high'});
      const x=(i%cols)*tileW,y=Math.floor(i/cols)*tileH;sc.drawImage(tile,x,y,tileW,tileH-20);
      sc.fillStyle='#f4f8ff';sc.font='bold 13px sans-serif';sc.fillText(style,x+10,y+tileH-5);
    });
    fs.writeFileSync(process.argv[previewArg+1],await sheet.encode('webp',88));
  }
  console.log(JSON.stringify({ok:true,moves:moves.length,moveFamilies:families.size,styles:api.styles.length,renderedFrames:rendered,qualities:2,finitePhaseBoundaryCases:api.styles.length*5,maxLowQualityCanvasCalls:largestBudget,motionHooks:true,deterministic:true,reducedMotion:true,gameplayUnchanged:true}));
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
