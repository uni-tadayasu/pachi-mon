#!/usr/bin/env node
'use strict';
// Exercise the actual new transparent sheets through the production portrait
// wrapper, including hidden catalogue isolation, facing and shiny silhouettes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {canvas,imageStats}=require('./check-art.cjs');
const root=path.resolve(__dirname,'..');
const ids=['pearlmi','pearlgoa','pearlseria','shimomaru','shimorei','hyogald','rurikoro','rurigorm'];
const stages=[0,1,2,0,1,2,0,1];
const files=ids.map((_,index)=>`assets/offdex-v54-${String(index+1).padStart(2,'0')}.png`);
const blocks=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
function pixels(cv){return cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;}
function silhouette(cv){
 const s=imageStats(cv),small=canvas.createCanvas(80,80),ctx=small.getContext('2d');ctx.imageSmoothingEnabled=false;
 ctx.drawImage(cv,s.left,s.top,s.right-s.left+1,s.bottom-s.top+1,0,0,80,80);
 const data=pixels(small),result=Uint8Array.from({length:6400},(_,i)=>data[i*4+3]>128?1:0);
 small.width=small.height=1;return result;
}
function difference(a,b){let change=0,union=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])change++;if(a[i]||b[i])union++;}return change/Math.max(1,union);}
async function main(){
 const requests=[],events=[],active=new Set();
 const fixture=canvas.createCanvas(400,400),fc=fixture.getContext('2d');fc.fillStyle='#347dac';fc.fillRect(40,40,320,320);
 const placeholder=fixture.toBuffer('image/png');fixture.width=fixture.height=1;
 class LocalImage extends canvas.Image{
  set src(value){
   const url=new URL(String(value),'https://game.test/'),file=url.pathname.slice(1);requests.push(file);
   const task=new Promise(resolve=>setImmediate(()=>{
    const loaded=this.onload,failed=this.onerror;
    this.onload=(...args)=>{loaded?.apply(this,args);resolve();};
    this.onerror=(...args)=>{failed?.apply(this,args);resolve();};
    try{super.src=files.includes(file)?path.join(root,file):placeholder;}catch(error){this.onerror(error);}
   }));active.add(task);task.finally(()=>active.delete(task));
  }
  get src(){return super.src;}
 }
 const document={baseURI:'https://game.test/',currentScript:null,createElement(tag){assert.equal(tag,'canvas');return canvas.createCanvas(1,1);},dispatchEvent(event){events.push(event.type);}};
 const context=vm.createContext({console,document,Image:LocalImage,URL,Uint8Array,Uint8ClampedArray,Float32Array,Int32Array,ArrayBuffer,
  Event:class{constructor(type){this.type=type;}},setTimeout(fn,ms){const t=setTimeout(fn,ms);t.unref();return t;},clearTimeout});
 for(const [,attrs,code]of blocks){if(/\bsrc=|application\/ld\+json/.test(attrs))continue;vm.runInContext(code,context);if(context.LT?.Engine)break;}
 const {LT}=context,before=JSON.stringify(LT.DATA);
 assert.deepEqual(Array.from(LT.DATA.offDexLines.ids),ids,'File numbers and species order must agree');
 for(const file of ['monster-pixels.js','creature-art.js','assets/creatures-individual-catalog.js','individual-creature-art.js']){
  document.currentScript={src:new URL(file,document.baseURI).href};vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
 }
 const pixel=blocks.find(([,attrs,code])=>!attrs.includes('src=')&&code.includes('LT.PixelSprites='));assert(pixel);
 vm.runInContext(pixel[2],context,{filename:'PixelSprites'});
 const art=LT.CreatureArt;await art.ready;while(active.size)await Promise.all([...active]);
 assert.equal(art.status().offDexRequested,0,'Ordinary startup must not request undiscovered portraits');
 for(const id of ids){
  assert(!LT.IndividualArtCatalog.species[id]&&!LT.IndividualCreatureArt.has(id),'Off-dex species leaked into the public artwork catalogue');
  assert.equal(art.orientation(id).source,'fallback');
 }
 assert.equal(art.get(ids[0]),null,'Unloaded dedicated art should remain pending');
 assert.equal(art.get(ids[0],true),null);
 assert.deepEqual(Array.from(await art.preload(ids,{back:'both'})),ids.map(()=>true));
 while(active.size)await Promise.all([...active]);
 assert.deepEqual(requests.filter(file=>files.includes(file)),files,'Each pair of views must share exactly one request');
 assert.equal(art.status().offDexLoaded,8);assert.equal(art.status().offDexFailed,0);
 assert.equal(art.status().evolutionRequested,0,'Dedicated evolution forms must not borrow generic atlas silhouettes');
 assert.equal(LT.IndividualCreatureArt.status().requested,0);
 assert.equal(events.filter(type=>type==='pachi-art-ready').length,8);
 const normalHashes=[],renderedHashes=[];
 for(const [index,id]of ids.entries()){
  const image=await canvas.loadImage(path.join(root,files[index])),half=Math.floor(image.width/2);
  assert(half>=320&&image.height>=400,'Source art must cover game portrait resolution');
  const views=[];
  for(const back of [false,true]){
   const source=canvas.createCanvas(half,image.height),sc=source.getContext('2d');
   sc.drawImage(image,back?half:0,0,half,image.height,0,0,half,image.height);
   const sourceStats=imageStats(source),cv=art.get(id,back),stats=imageStats(cv);views.push(cv);
   assert(sourceStats.fraction>.05&&sourceStats.fraction<.85,`${id}: source must have visible pixels and transparent padding`);
   assert(sourceStats.left>0&&sourceStats.top>0&&sourceStats.right<half-1&&sourceStats.bottom<image.height-1,`${id}: source silhouette touches cell boundary`);
   assert(stats.fraction>.05&&stats.fraction<.85);
   assert(stats.left>=10&&stats.top>=10&&stats.right<310&&stats.bottom<310,`${id}: clipped display`);
   assert(difference(silhouette(source),silhouette(cv))<.08,`${id}: source silhouette changed in portrait renderer`);
   normalHashes.push(stats.hash);
   const orientation=art.orientation(id,back);assert.equal(orientation.source,'offdex-authored');assert.equal(orientation.stage,stages[index]);
   assert.equal(orientation.direction,back?1:-1);assert.equal(orientation.authoredBack,back);
   assert.equal(LT.PixelSprites.battleFacing(id,back,back?'right':'left').flip,false);
   const shiny=art.get(id,back,{shiny:true});assert.notEqual(imageStats(shiny).hash,stats.hash);
   const a=pixels(cv),b=pixels(shiny);for(let p=3;p<a.length;p+=4)assert.equal(a[p],b[p],'Shiny changes silhouette alpha');
   const portrait=canvas.createCanvas(320,320);LT.PixelSprites.creature(portrait,id,{back,time:0,reducedMotion:true});
   const displayed=imageStats(portrait);assert(displayed.fraction>.05);renderedHashes.push(displayed.hash);
   source.width=source.height=portrait.width=portrait.height=1;
  }
  const mirror=canvas.createCanvas(320,320),mc=mirror.getContext('2d');mc.translate(320,0);mc.scale(-1,1);mc.drawImage(views[0],0,0);
  assert.notEqual(imageStats(mirror).hash,imageStats(views[1]).hash,`${id}: back must be authored, not mirrored front`);mirror.width=mirror.height=1;
 }
 assert.equal(new Set(normalHashes).size,16,'Every form and view needs distinct art');
 assert.equal(new Set(renderedHashes).size,16,'Production portraits must retain the distinct art');
 assert.equal(JSON.stringify(LT.DATA),before,'Rendering must not mutate species data');
 console.log(JSON.stringify({ok:true,species:8,authoredViews:16,sourceFiles:files.length,transparent:true,shinyAlphaPreserved:true,lazy:true}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
