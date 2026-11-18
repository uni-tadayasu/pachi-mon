#!/usr/bin/env node
'use strict';
// Real hidden-lineage PNGs, the production portrait wrapper and the playable
// procedural fallback. Other atlases use a small fixture to bound native memory.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {canvas,imageStats}=require('./check-art.cjs');
const root=path.resolve(__dirname,'..'),ids=['nullmie','nullva','zeroveil'];
const scripts=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const source=fs.readFileSync(path.join(root,'creature-art.js'),'utf8'),settle=()=>new Promise(setImmediate);
const isGlitch=file=>ids.some(id=>file===`assets/${id}-v46.png`);

async function runtime(mode='normal'){
 const requests=[],events=[],deferred=[],active=new Set(),timers=new Set();
 const fixture=canvas.createCanvas(400,400),fc=fixture.getContext('2d');fc.fillStyle='#8766af';
 for(let y=0;y<4;y++)for(let x=0;x<4;x++)fc.fillRect(x*100+20,y*100+20,60,70);
 const placeholder=fixture.toBuffer('image/png');fixture.width=fixture.height=1;
 class LocalImage extends canvas.Image{
  set src(value){
   const url=new URL(String(value),'https://example.test/pachi-mon/');
   const file=decodeURIComponent(url.pathname.replace(/^\/pachi-mon\//,'')),absolute=path.resolve(root,file);
   assert(absolute.startsWith(root+path.sep),'Image request escaped the checkout');requests.push(file);
   const hidden=isGlitch(file);
   const complete=()=>new Promise(resolve=>{
    const onload=this.onload,onerror=this.onerror;
    this.onload=(...args)=>{try{onload?.apply(this,args);}finally{resolve();}};
    this.onerror=(...args)=>{try{onerror?.apply(this,args);}finally{resolve();}};
    if(hidden&&mode==='failed'){this.onerror(new Error('Expected hidden artwork download failure'));return;}
    try{super.src=hidden?absolute:placeholder;}catch(error){this.onerror(error);}
   });
   if(hidden&&mode==='delayed')deferred.push(complete);
   else{const task=new Promise(resolve=>setImmediate(()=>complete().then(resolve)));active.add(task);task.finally(()=>active.delete(task));}
  }
  get src(){return super.src;}
 }
 const document={baseURI:'https://example.test/pachi-mon/',currentScript:null,
  createElement(tag){assert.equal(tag,'canvas');return canvas.createCanvas(1,1);},dispatchEvent(event){events.push(event);}};
 const context=vm.createContext({document,Image:LocalImage,URL,Uint8Array,Uint8ClampedArray,Float32Array,Int32Array,ArrayBuffer,console,
  Event:class Event{constructor(type){this.type=type;}},
  setTimeout(callback){const token={callback};timers.add(token);return token;},clearTimeout(token){timers.delete(token);}});
 for(const script of scripts){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],context);if(context.LT?.Engine)break;
 }
 const {LT}=context;
 document.currentScript={src:new URL('creature-art.js',document.baseURI).href};
 vm.runInContext(source,context,{filename:'creature-art.js'});
 const baseGet=LT.CreatureArt.get;
 for(const file of ['assets/creatures-individual-catalog.js','individual-creature-art.js']){
  document.currentScript={src:new URL(file,document.baseURI).href};vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
 }
 const pixelModule=scripts.find(script=>script[2].includes('LT.PixelSprites='));assert(pixelModule,'Pixel sprite renderer is missing');
 vm.runInContext(pixelModule[2],context,{filename:'index.html:PixelSprites'});
 async function flush(){while(active.size)await Promise.all([...active]);await settle();}
 await LT.CreatureArt.ready;await flush();
 return {LT,art:LT.CreatureArt,baseGet,requests,events,
  expire(){for(const token of [...timers])token.callback();},
  async finish(){await Promise.all(deferred.splice(0).map(complete=>complete()));await flush();}};
}
function alpha(cv){const p=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;return Uint8Array.from({length:cv.width*cv.height},(_,i)=>p[i*4+3]);}
function mask(cv){
 const s=imageStats(cv),small=canvas.createCanvas(64,64),c=small.getContext('2d');c.imageSmoothingEnabled=false;
 c.drawImage(cv,s.left,s.top,s.right-s.left+1,s.bottom-s.top+1,0,0,64,64);
 const data=alpha(small).map(value=>value>128?1:0);small.width=small.height=1;return data;
}
function difference(a,b){let changed=0,union=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])changed++;if(a[i]||b[i])union++;}return changed/Math.max(1,union);}
function rendered(LT,id,back=false,shiny=false){
 const cv=canvas.createCanvas(320,320);LT.PixelSprites.creature(cv,id,{back,shiny,time:0,reducedMotion:true});
 const stats=imageStats(cv);cv.width=cv.height=1;return stats;
}

async function main(){
 const run=await runtime(),{LT,art}=run,engine=new LT.Engine();engine.newGame('komori');
 const before=JSON.stringify({data:LT.DATA,state:engine.state});
 assert.equal(art.status().glitchRequested,0,'Startup eagerly downloads hidden artwork');
 assert.equal(art.status().evolutionRequested,0);assert.equal(run.events.length,0);
 for(const id of ids){
  assert(!LT.IndividualArtCatalog.species[id]&&!LT.IndividualCreatureArt.has(id),'Off-dex forms must remain outside the ordinary artwork catalog');
  assert(art.supportsBack(id));assert.equal(art.orientation(id).source,'fallback');
 }
 assert(!run.requests.some(isGlitch),'Reading orientation requested hidden images');
 assert.equal(art.get('nullmie'),null,'Loading should use the existing procedural fallback');
 assert.equal(art.get('nullmie',true,{shiny:true}),null);
 assert.equal(run.requests.filter(isGlitch).length,1,'Front, rear and shiny duplicated the same request');
 assert.deepEqual(Array.from(await art.preload('nullmie',{back:'both'})),[true]);
 await art.preload(ids,{back:'both'});
 assert.deepEqual(run.requests.filter(isGlitch),ids.map(id=>`assets/${id}-v46.png`));
 assert.equal(art.status().glitchLoaded,3);assert.equal(art.status().glitchFailed,0);
 assert.equal(art.status().evolutionRequested,0,'Hidden evolutions requested ordinary lineage sheets');
 assert.equal(LT.IndividualCreatureArt.status().requested,0);
 assert.equal(run.events.length,3);assert(run.events.every(event=>event.type==='pachi-art-ready'));
 const hashes=new Map(),integrated=new Map(),silhouettes=[];
 for(const [stage,id]of ids.entries()){
  const original=await canvas.loadImage(path.join(root,`assets/${id}-v46.png`)),frameSize=original.height;
  assert.equal(original.width,frameSize*2,`${id}: expected two square front/rear frames`);
  assert(frameSize>=320,`${id}: source frames must cover the rendered portrait resolution`);
  const views=[];
  for(const back of [false,true]){
   const cv=art.get(id,back),s=imageStats(cv),view=back?'back':'front';views.push(cv);hashes.set(id+':'+back,s.hash);
   assert.equal(cv.width,320);assert.equal(cv.height,320);
   assert(s.fraction>.05&&s.fraction<.85,`${id} ${view}: missing visible pixels or transparent background`);
   assert(s.left>=10&&s.top>=10&&s.right<310&&s.bottom<310,`${id} ${view}: the full figure needs clear margins`);
   const half=canvas.createCanvas(frameSize,frameSize),hc=half.getContext('2d');hc.drawImage(original,back?frameSize:0,0,frameSize,frameSize,0,0,frameSize,frameSize);
   const sourceStats=imageStats(half);
   assert(sourceStats.left>0&&sourceStats.top>0&&sourceStats.right<frameSize-1&&sourceStats.bottom<frameSize-1,`${id} ${view}: artwork reaches the source boundary`);
   assert(difference(mask(cv),mask(half))<.06,`${id} ${view}: displayed silhouette lost source pixels or used the wrong half`);
   silhouettes.push(Buffer.from(mask(cv)).toString('base64'));half.width=half.height=1;
   const orientation=art.orientation(id,back);
   assert.equal(orientation.source,'glitch-authored');assert.equal(orientation.stage,stage);
   assert.equal(orientation.direction,back?1:-1);assert.equal(orientation.authoredBack,back);
   assert.equal(LT.PixelSprites.battleFacing(id,back,back?'right':'left').flip,false,'Battle unnecessarily mirrors the authored pose');
   const shiny=art.get(id,back,{shiny:true});assert.notEqual(imageStats(shiny).hash,s.hash,'Shiny keeps the normal palette');
   assert.deepEqual(alpha(shiny),alpha(cv),'Shiny changes the authored silhouette');
   assert.equal(art.get(id,back),cv,'Shiny mutated the normal cached artwork');
   for(const alternate of [false,true]){
    const displayed=rendered(LT,id,back,alternate);assert(displayed.fraction>.05);
    integrated.set(`${id}:${back}:${alternate}`,displayed.hash);
   }
  }
  assert.notEqual(imageStats(views[0]).hash,imageStats(views[1]).hash,'Rear duplicates front');
  const mirror=canvas.createCanvas(320,320),mc=mirror.getContext('2d');mc.translate(320,0);mc.scale(-1,1);mc.drawImage(views[0],0,0);
  assert.notEqual(imageStats(mirror).hash,imageStats(views[1]).hash,'Rear is a mirrored front');mirror.width=mirror.height=1;
 }
 assert.equal(new Set(hashes.values()).size,6);assert.equal(new Set(silhouettes).size,6,'Evolution/view silhouettes were reused');

 // Hidden portraits share the bounded legacy cache, including recency touches.
 art.clearCache();const retained=art.get('nullmie');
 const roots=Object.keys(LT.DATA.species).filter(id=>!LT.DATA.species[id].specialOnly&&!['floravelle'].includes(id)&&art.lineage(id)?.stage===0);
 assert(roots.length>=60);const cold=run.baseGet(roots[0]);
 for(const id of roots.slice(1,46))assert(run.baseGet(id));
 assert.equal(art.get('nullmie'),retained);
 for(const id of roots.slice(46,58))assert(run.baseGet(id));
 assert.equal(art.get('nullmie'),retained,'Recently used hidden portrait was evicted');
 assert.notEqual(run.baseGet(roots[0]),cold,'Old portraits were not evicted');
 assert(art.status().cached<=art.status().cacheLimit);assert.equal(art.status().cacheLimit,48);
 art.clearCache();
 for(const id of ids)for(const back of [false,true])assert.equal(imageStats(art.get(id,back)).hash,hashes.get(id+':'+back));
 assert.equal(run.requests.filter(isGlitch).length,3,'Cache rebuilding redownloaded hidden sheets');
 assert.equal(JSON.stringify({data:LT.DATA,state:engine.state}),before,'Artwork mutated gameplay or save data');

 const delayed=await runtime('delayed'),waiting=delayed.art.preload(ids,{back:'both'}),fallbacks=new Map();
 await delayed.art.ready;assert.equal(delayed.art.status().glitchLoaded,0,'Startup promise waited for hidden requests');
 for(const id of ids)for(const back of [false,true]){
  assert.equal(delayed.art.get(id,back),null);assert.equal(delayed.art.orientation(id,back).direction,back?-1:1);
  const s=rendered(delayed.LT,id,back);assert(s.fraction>.05);fallbacks.set(id+':'+back,s.hash);
  assert.notEqual(s.hash,integrated.get(`${id}:${back}:false`));
  rendered(delayed.LT,id,back,true); // Exercise an already cached shiny fallback.
 }
 delayed.expire();assert.deepEqual(Array.from(await waiting),[false,false,false]);assert.equal(delayed.art.status().glitchFailed,3);
 for(const id of ids)for(const back of [false,true])assert.equal(rendered(delayed.LT,id,back).hash,fallbacks.get(id+':'+back));
 await delayed.finish();assert.equal(delayed.art.status().glitchFailed,0);assert.equal(delayed.art.status().glitchLoaded,3);
 assert.equal(delayed.events.length,3,'Late successes must each notify portraits');
 for(const id of ids)for(const back of [false,true])for(const shiny of [false,true])
  assert.equal(rendered(delayed.LT,id,back,shiny).hash,integrated.get(`${id}:${back}:${shiny}`),'Late artwork did not replace the normal/shiny fallback');

 const failed=await runtime('failed');assert.deepEqual(Array.from(await failed.art.preload(ids,{back:'both'})),[false,false,false]);
 for(const id of ids)for(const back of [false,true]){
  assert.equal(failed.art.get(id,back),null);assert.equal(failed.art.orientation(id,back).source,'fallback');
  assert.equal(rendered(failed.LT,id,back).hash,fallbacks.get(id+':'+back));
 }
 await failed.art.preload(ids,{back:'both'});
 assert.equal(failed.requests.filter(isGlitch).length,3,'A failed image was requested on every paint');
 assert.equal(failed.events.length,0);assert.equal(failed.art.status().glitchFailed,3);
 console.log(JSON.stringify({ok:true,species:3,authoredViews:6,lazyStartup:true,oneDownloadPerSpecies:true,sourceSilhouettesPreserved:true,
  distinctNotMirrored:true,transparentMargins:true,shinyShapePreserved:true,spriteLimit:48,lateRecovery:true,playableFailureFallback:true,gameplayUnchanged:true}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
