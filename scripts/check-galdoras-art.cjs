#!/usr/bin/env node
'use strict';
// Verify the supplied front and separately authored rear in the real renderer.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {canvas,imageStats}=require('./check-art.cjs');
const root=path.resolve(__dirname,'..');
const files=['assets/galdoras-front-v65.png','assets/galdoras-back-v65.png'];
const blocks=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
async function runtime(failedView=null){
  const requests=[],active=new Set(),events=[];
  const placeholder=canvas.createCanvas(400,400).toBuffer('image/png');
  class LocalImage extends canvas.Image{
    set src(value){
      const file=new URL(String(value),'https://game.test/').pathname.slice(1);requests.push(file);
      const task=new Promise(resolve=>setImmediate(()=>{
        const loaded=this.onload,failed=this.onerror;
        this.onload=(...args)=>{loaded?.apply(this,args);resolve();};
        this.onerror=(...args)=>{failed?.apply(this,args);resolve();};
        if(file===files[failedView]){this.onerror(new Error('Expected missing leader view'));return;}
        try{super.src=files.includes(file)?path.join(root,file):placeholder;}catch(error){this.onerror(error);}
      }));active.add(task);task.finally(()=>active.delete(task));
    }
    get src(){return super.src;}
  }
  const document={baseURI:'https://game.test/',currentScript:null,
    createElement(tag){assert.equal(tag,'canvas');return canvas.createCanvas(1,1);},dispatchEvent(event){events.push(event.type);}};
  const context=vm.createContext({console,document,Image:LocalImage,URL,Uint8Array,Uint8ClampedArray,Float32Array,Int32Array,ArrayBuffer,
    Event:class{constructor(type){this.type=type;}},setTimeout(fn,ms){const t=setTimeout(fn,ms);t.unref();return t;},clearTimeout});
  for(const [,attrs,code]of blocks){if(/\bsrc=|application\/ld\+json/.test(attrs))continue;vm.runInContext(code,context);if(context.LT?.Engine)break;}
  for(const file of ['monster-pixels.js','creature-art.js','assets/creatures-individual-catalog.js','individual-creature-art.js']){
    document.currentScript={src:new URL(file,document.baseURI).href};vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  }
  vm.runInContext(blocks.find(([,attrs,code])=>!attrs.includes('src=')&&code.includes('LT.PixelSprites='))[2],context);
  await context.LT.CreatureArt.ready;while(active.size)await Promise.all([...active]);
  return {LT:context.LT,requests,events,async settle(){while(active.size)await Promise.all([...active]);}};
}
async function main(){
  const run=await runtime(),{LT}=run,art=LT.CreatureArt;
  assert.equal(art.status().leaderRequested,0,'Undiscovered leader art must remain lazy');
  assert(!LT.IndividualArtCatalog.species.galdoras&&!LT.IndividualCreatureArt.has('galdoras'),'No public artwork catalogue entry');
  await art.preload('galdoras');await run.settle();
  assert.deepEqual(run.requests.filter(file=>files.includes(file)),[files[0]],'Front preload does not fetch a rear unnecessarily');
  assert.equal(art.status().leaderLoaded,1);
  await art.preload('galdoras',{back:'both'});await run.settle();
  assert.deepEqual(run.requests.filter(file=>files.includes(file)),files,'One request per independent view');
  assert.equal(art.status().leaderLoaded,2);assert.equal(art.status().leaderFailed,0);
  const views=[false,true].map(back=>art.get('galdoras',back));
  for(const [i,view]of views.entries()){
    const stats=imageStats(view);assert(stats.fraction>.2&&stats.fraction<.85,'Transparent complete creature');
    assert(stats.left>=10&&stats.top>=10&&stats.right<310&&stats.bottom<310,'Battle portrait has clear margins');
    const facing=art.orientation('galdoras',!!i);assert.equal(facing.source,'leader-authored');
    assert.equal(facing.direction,i?1:0);assert.equal(facing.authoredBack,!!i);
    const shiny=art.get('galdoras',!!i,{shiny:true});assert.notEqual(imageStats(shiny).hash,stats.hash);
    const a=view.getContext('2d').getImageData(0,0,320,320).data,b=shiny.getContext('2d').getImageData(0,0,320,320).data;
    for(let p=3;p<a.length;p+=4)assert.equal(a[p],b[p],'Shiny color retains source silhouette');
    const actual=canvas.createCanvas(320,320);LT.PixelSprites.creature(actual,'galdoras',{back:!!i,time:0,reducedMotion:true});
    assert(imageStats(actual).fraction>.2,'Production portrait draws the leader');
  }
  const mirror=canvas.createCanvas(320,320),mc=mirror.getContext('2d');mc.translate(320,0);mc.scale(-1,1);mc.drawImage(views[0],0,0);
  assert.notEqual(imageStats(views[0]).hash,imageStats(views[1]).hash);
  assert.notEqual(imageStats(mirror).hash,imageStats(views[1]).hash,'Rear is independently authored');
  for(const failure of [0,1]){
    const broken=await runtime(failure),a=broken.LT.CreatureArt;await a.preload('galdoras',{back:'both'});await broken.settle();
    assert.equal(a.get('galdoras',!!failure),null,'Missing view never substitutes the other view');
    assert.equal(imageStats(a.get('galdoras',!failure)).hash,imageStats(views[1-failure]).hash,'Opposite view remains available');
    assert.equal(a.status().leaderLoaded,1);assert.equal(a.status().leaderFailed,1);
  }
  const output=process.argv[2];
  if(output){
    const sheet=canvas.createCanvas(1280,390),c=sheet.getContext('2d');c.fillStyle='#263044';c.fillRect(0,0,1280,390);
    for(let i=0;i<4;i++){c.fillStyle='#efe6d3';c.font='16px sans-serif';c.fillText(['FRONT / supplied','REAR / authored','SHINY / front','SHINY / rear'][i],i*320+20,30);c.drawImage(art.get('galdoras',i%2===1,{shiny:i>=2}),i*320,55);}
    fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,sheet.toBuffer('image/png'));
  }
  console.log(JSON.stringify({ok:true,independentViews:2,lazy:true,transparent:true,shinyAlphaPreserved:true,failureIsolation:true}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
