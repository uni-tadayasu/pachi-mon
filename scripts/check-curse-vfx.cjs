#!/usr/bin/env node
'use strict';
// Production curse rendering: readable skull-ghost, spring motion, a stationary
// reduced-motion pose, bounded mobile work, and no changes to gameplay state.
// Optional: node scripts/check-curse-vfx.cjs --qa /absolute/path/contact-sheet.png
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {canvas,imageStats}=require('./check-art.cjs');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'battle-vfx.js'),'utf8');
let systemReduced=false;
const context=vm.createContext({LT:{DATA:{volatileConditions:{curse:{name:'呪縛'}}}},matchMedia:()=>({matches:systemReduced})});
vm.runInContext(source,context,{filename:'battle-vfx.js'});
const V=context.LT.BattleVFX;
const effect=(moment='inflict',side='ally',slot=0)=>V.fromEvent(moment==='tick'?{kind:'statusTick',status:'curse',side,slot,amount:26}:{kind:'status',status:'curse',side,slot},null,100);
const layouts=[
  {w:768,h:440,side:'ally',options:{}},{w:768,h:440,side:'enemy',options:{}},
  {w:320,h:220,side:'ally',options:{}},{w:320,h:220,side:'enemy',options:{}},
  {w:360,h:260,side:1,slot:1,options:{online:true,double:true,side:1}},
  {w:360,h:260,side:0,slot:0,options:{online:true,double:true,side:1}}
];
function draw(fx,age,w=768,h=440,options={}){
  const cv=canvas.createCanvas(w,h),c=cv.getContext('2d');
  assert.equal(V.render(c,w,h,fx.started+fx.duration*age,fx,options),true);return cv;
}
function brightShape(cv){
  const data=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
  let count=0,x0=cv.width,x1=-1,sumY=0,dark=0;
  for(let i=0;i<data.length;i+=4){
    if(data[i+3]<200)continue;
    if(data[i]<80&&data[i+1]<65&&data[i+2]<100)dark++;
    if(data[i]<190||data[i+1]<180||data[i+2]<200)continue;
    const x=(i/4)%cv.width,y=Math.floor(i/4/cv.width);count++;sumY+=y;x0=Math.min(x0,x);x1=Math.max(x1,x);
  }
  return {count,dark,centerY:sumY/Math.max(1,count),width:x1-x0+1};
}
assert.equal(V.effects.length,24);assert.equal(new Set(V.effects).size,24);
assert.deepEqual([...V.conditions],['bloom','bubble','scorch','dizzy','crystal']);assert.deepEqual([...V.volatileConditions],['curse']);
let frames=0;
for(const moment of ['inflict','tick'])for(const layout of layouts)for(const quality of ['high','low']){
  const fx=effect(moment,layout.side,layout.slot||0),before=JSON.stringify(fx);
  assert.equal(fx.style,'condition');assert.equal(fx.condition,'curse');assert.equal(fx.moment,moment);
  const anchors=V.anchors(layout.w,layout.h,fx,layout.options);assert.deepEqual(anchors.source,anchors.target);
  for(const age of [.16,.32,.49,.67]){
    const options={...layout.options,quality},cv=draw(fx,age,layout.w,layout.h,options),first=imageStats(cv),shape=brightShape(cv);
    assert(first.opaque>70,'The curse is visible even in a small double-battle slot');
    assert(shape.count>35&&shape.dark>15,'A pale body and dark skull features must both remain readable');
    const repeat=draw(fx,age,layout.w,layout.h,options);assert.equal(imageStats(repeat).hash,first.hash,'Animation is deterministic');
    cv.width=cv.height=repeat.width=repeat.height=1;frames++;
  }
  assert.equal(JSON.stringify(fx),before,'Drawing must not modify the event');
}
// Inspect visible motion rather than duplicating the animation formula.
const bounce=[.16,.32,.49,.67].map(age=>{const cv=draw(effect('tick'),age),shape=brightShape(cv);cv.width=cv.height=1;return shape;});
assert(Math.max(...bounce.map(s=>s.centerY))-Math.min(...bounce.map(s=>s.centerY))>15,'The ghost visibly rises and lands');
assert(Math.max(...bounce.map(s=>s.width))/Math.min(...bounce.map(s=>s.width))>1.08,'The ghost visibly stretches and squashes');
for(const moment of ['inflict','tick']){
  const fx=effect(moment),hashes=[];
  for(const age of [.15,.4,.75]){const cv=draw(fx,age,320,220,{quality:'low',reducedMotion:true});assert(brightShape(cv).count>35);hashes.push(imageStats(cv).hash);cv.width=cv.height=1;}
  assert.equal(new Set(hashes).size,1,'Reduced motion must hold a completely stationary pose');
  systemReduced=true;const automatic=draw(fx,.4,320,220,{quality:'low'});assert.equal(imageStats(automatic).hash,hashes[0]);automatic.width=automatic.height=1;systemReduced=false;
  const cv=canvas.createCanvas(320,220),c=cv.getContext('2d');
  for(const age of [-.01,1.01])assert.equal(V.render(c,320,220,100+age*fx.duration,fx,{reducedMotion:true}),false,'Static ghosts still expire');
  cv.width=cv.height=1;
}
// Other conditions and all 24 move families retain their reduced-motion policy.
const quiet=canvas.createCanvas(320,220),qc=quiet.getContext('2d');
for(const condition of V.conditions)assert.equal(V.render(qc,320,220,500,{...effect(),condition},{reducedMotion:true}),false);
for(const style of V.effects)assert.equal(V.render(qc,320,220,500,{kind:'damage',style,started:100,duration:1000},{reducedMotion:true}),false);
assert.equal(imageStats(quiet).opaque,0);quiet.width=quiet.height=1;
// The actual solo frame deliberately passes time=0 to keep sprites still.
// Its wrapper must render only the quiet curse with the live effect clock.
for(const mode of ['setting','system']){
  let now=500,baseTime;
  const wrapped=vm.createContext({LT:{DATA:context.LT.DATA,Art:{battle(cv,engine,time){baseTime=time;}},PixelSprites:{duel(){}}},
    performance:{now:()=>now},matchMedia:()=>({matches:mode==='system'})});
  vm.runInContext(source,wrapped,{filename:'battle-vfx.js'});
  const cv=canvas.createCanvas(320,220),c=cv.getContext('2d'),fx=effect(),options={quality:'low',reducedMotion:mode==='setting',effect:fx};
  for(const time of [fx.started+150,fx.started+750]){
    now=time;c.clearRect(0,0,320,220);wrapped.LT.Art.battle(cv,{},0,options);
    assert.equal(baseTime,0,'The base sprite still receives its stationary time');
    assert(brightShape(cv).count>35,'The reduced-motion solo wrapper displays its stationary skull-ghost');
  }
  for(const time of [fx.started-1,fx.started+fx.duration+1]){
    now=time;c.clearRect(0,0,320,220);wrapped.LT.Art.battle(cv,{},0,options);
    assert.equal(imageStats(cv).opaque,0,'The quiet wrapper ghost obeys its real beat lifetime');
  }
  now=500;
  for(const condition of V.conditions){
    c.clearRect(0,0,320,220);wrapped.LT.Art.battle(cv,{},0,{...options,effect:{...fx,condition}});
    assert.equal(imageStats(cv).opaque,0,'Other reduced-motion solo conditions remain hidden');
  }
  cv.width=cv.height=1;
}
// Finite phase-edge geometry, a small canvas-call budget, and no leaked drawing state.
const probe=canvas.createCanvas(768,440),pc=probe.getContext('2d');let calls=0,largest=0;
const geometry=new Set(['moveTo','lineTo','quadraticCurveTo','bezierCurveTo','arc','ellipse','fillRect','strokeRect','translate','rotate','scale','createRadialGradient']);
const measured=new Proxy(pc,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{calls++;if(geometry.has(key))for(const n of args)if(typeof n==='number')assert(Number.isFinite(n));return value.apply(target,args);};},set(target,key,value){return Reflect.set(target,key,value,target);}});
for(const moment of ['inflict','tick'])for(const [w,h] of [[64,40],[320,220],[768,440]])for(const age of [0,.001,.16,.32,.5,.999,1]){
  const fx=effect(moment,'enemy');calls=0;V.render(measured,w,h,100+age*fx.duration,fx,{quality:'low'});largest=Math.max(largest,calls);
  assert(calls<700,'Curse exceeds its bounded mobile drawing budget');assert.equal(pc.globalAlpha,1);assert.equal(pc.globalCompositeOperation,'source-over');
}
assert.equal(V.artStatus().state,'idle','The ghost needs no downloaded artwork');probe.width=probe.height=1;

function writeQA(target){
  // Use the actual fallback creature renderer as a neutral afflicted companion;
  // this stays independent of the artwork download path and any game save.
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const pixels=vm.createContext({console,ImageData:canvas.ImageData,document:{createElement:()=>canvas.createCanvas(1,1)}});
  for(const script of scripts){if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;vm.runInContext(script[2],pixels);if(pixels.LT?.Engine)break;}
  vm.runInContext(scripts.find(script=>script[2].includes('LT.PixelSprites='))[2],pixels);
  const ages=[.16,.32,.49,.67],rows=[
    {label:'Curse applied / high quality',moment:'inflict',w:768,h:440,options:{quality:'high'}},
    {label:'Quarter-HP tick / high quality',moment:'tick',w:768,h:440,options:{quality:'high'}},
    {label:'Mobile / low quality / native 320px',moment:'tick',w:320,h:220,options:{quality:'low'}},
    {label:'Reduced motion / stationary ghost',moment:'tick',w:320,h:220,options:{quality:'low',reducedMotion:true}}
  ];
  const out=canvas.createCanvas(1360,1670),c=out.getContext('2d');c.fillStyle='#101824';c.fillRect(0,0,out.width,out.height);c.fillStyle='#f6eeff';c.font='bold 26px sans-serif';c.fillText('Curse ghost — production-renderer frames',16,36);
  c.font='14px sans-serif';c.fillStyle='#bfb2d0';c.fillText('Same skull-ghost on application and damage · springy body and short trails · stationary reduced-motion variant',16,61);
  rows.forEach((row,r)=>{
    const top=90+r*390;c.fillStyle='#f6eeff';c.font='bold 18px sans-serif';c.fillText(row.label,16,top);
    ages.forEach((age,i)=>{
      const left=16+i*336,fx=effect(row.moment),frame=canvas.createCanvas(row.w,row.h),cc=frame.getContext('2d'),anchor=V.anchors(row.w,row.h,fx,row.options).target;
      const bg=cc.createLinearGradient(0,0,0,row.h);bg.addColorStop(0,'#283943');bg.addColorStop(1,'#1a2634');cc.fillStyle=bg;cc.fillRect(0,0,row.w,row.h);
      const size=Math.min(row.w*.38,row.h*.64);pixels.LT.PixelSprites.creature(cc,'komori',{x:anchor.x-size/2,y:anchor.y-size/2,size,back:true,time:0,reducedMotion:true});
      V.render(cc,row.w,row.h,100+age*fx.duration,fx,row.options);
      c.fillStyle='#182334';c.fillRect(left,top+12,320,345);c.imageSmoothingEnabled=false;
      if(row.w===768)c.drawImage(frame,55,95,320,345,left,top+12,320,345);else c.drawImage(frame,left,top+72);
      c.fillStyle='#cdbfe0';c.font='13px sans-serif';c.fillText(Math.round(age*fx.duration)+' ms',left+8,top+378);frame.width=frame.height=1;
    });
  });
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,out.toBuffer('image/png'));out.width=out.height=1;return target;
}
const qaAt=process.argv.indexOf('--qa'),qa=qaAt>=0?writeQA(path.resolve(process.argv[qaAt+1]||'curse-vfx-qa.png')):undefined;
console.log(JSON.stringify({ok:true,frames,largestLowQualityCalls:largest,bouncing:true,squashAndStretch:true,staticReducedMotion:true,soloReducedWrapper:true,otherReducedEffectsUnchanged:true,noArtworkDownload:true,...(qa?{qa}: {})}));
