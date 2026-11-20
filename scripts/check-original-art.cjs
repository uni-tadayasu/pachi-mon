#!/usr/bin/env node
'use strict';
// Exercise the actual original atlases: independent views, shared downloads, alpha,
// late recovery, retired-art exclusion and unchanged owned-monster records.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {canvas,imageStats}=require('./check-art.cjs');
const root=path.resolve(__dirname,'..'),settle=()=>new Promise(setImmediate);
const ids=['nullmie','nullva','zeroveil','shimomaru','shimorei','hyogald','pearlmi','pearlgoa','pearlseria','galdoras','futo'];
const files=['original-null-line-v67.png','original-tide-line-v67.png','original-pearl-line-v67.png','galdoras-user-v70.png','original-futo-v67.png'].map(file=>`assets/${file}`);
const unchanged={rurikoro:'assets/offdex-v54-07.png',rurigorm:'assets/offdex-v54-08.png'};
const retired=new Set(['nullmie-v46.png','nullva-v46.png','zeroveil-v46.png','galdoras-front-v65.png','galdoras-back-v65.png','original-galdoras-v67.png','original-galdogran-v68.png','futo-front-v2.png','futo-back-v2.png','futo.png',...Array.from({length:6},(_,i)=>`offdex-v54-0${i+1}.png`)].map(file=>`assets/${file}`));
const source=fs.readFileSync(path.join(root,'creature-art.js'),'utf8');
const blocks=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const pixels=cv=>cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
const alpha=cv=>{const data=pixels(cv);return Uint8Array.from({length:cv.width*cv.height},(_,i)=>data[i*4+3]);};
function silhouette(cv){
  const bounds=imageStats(cv),small=canvas.createCanvas(80,80),c=small.getContext('2d');c.imageSmoothingEnabled=false;
  c.drawImage(cv,bounds.left,bounds.top,bounds.right-bounds.left+1,bounds.bottom-bounds.top+1,0,0,80,80);
  const data=pixels(small),mask=Uint8Array.from({length:6400},(_,i)=>data[i*4+3]>128?1:0);
  small.width=small.height=1;return mask;
}
function maskDifference(a,b){let changed=0,union=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])changed++;if(a[i]||b[i])union++;}return changed/Math.max(1,union);}
function assertNoRetired(run){assert.deepEqual(run.requests.filter(file=>retired.has(file)),[],'A retired character image was requested');}
async function runtime(mode='normal'){
  const requests=[],events=[],active=new Set(),deferred=[],timers=new Set(),listeners=new Map();
  const fixture=canvas.createCanvas(400,400),fc=fixture.getContext('2d');fc.fillStyle='#708b99';
  for(let y=0;y<4;y++)for(let x=0;x<4;x++)fc.fillRect(x*100+20,y*100+20,60,70);
  const placeholder=fixture.toBuffer('image/png');fixture.width=fixture.height=1;
  class LocalImage extends canvas.Image{
    set src(value){
      const url=new URL(String(value),'https://game.test/pachi-mon/'),file=decodeURIComponent(url.pathname.replace(/^\/pachi-mon\//,''));
      const absolute=path.resolve(root,file);assert(absolute.startsWith(root+path.sep));requests.push(file);
      const revised=files.includes(file),complete=()=>new Promise(resolve=>{
        const loaded=this.onload,failed=this.onerror;
        this.onload=(...args)=>{try{loaded?.apply(this,args);}finally{resolve();}};
        this.onerror=(...args)=>{try{failed?.apply(this,args);}finally{resolve();}};
        if(revised&&mode==='failed'){this.onerror(new Error('Expected unavailable original atlas'));return;}
        try{super.src=revised||Object.values(unchanged).includes(file)?absolute:placeholder;}catch(error){this.onerror(error);}
      });
      if(revised&&mode==='delayed')deferred.push(complete);
      else{const task=new Promise(resolve=>setImmediate(()=>complete().then(resolve)));active.add(task);task.finally(()=>active.delete(task));}
    }
    get src(){return super.src;}
  }
  const document={baseURI:'https://game.test/pachi-mon/',currentScript:null,
    createElement(tag){assert.equal(tag,'canvas');return canvas.createCanvas(1,1);},
    addEventListener(type,listener){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(listener);},
    dispatchEvent(event){events.push(event);for(const listener of listeners.get(event.type)||[])listener(event);}};
  const context=vm.createContext({console,document,Image:LocalImage,ImageData:canvas.ImageData,URL,Uint8Array,Uint8ClampedArray,Float32Array,Int32Array,ArrayBuffer,performance,
    Event:class Event{constructor(type){this.type=type;}},setTimeout(callback){const token={callback};timers.add(token);return token;},clearTimeout(token){timers.delete(token);}});
  for(const [,attrs,code]of blocks){if(/\bsrc=|application\/ld\+json/.test(attrs))continue;vm.runInContext(code,context);if(context.LT?.Engine)break;}
  const LT=context.LT,engine=new LT.Engine();assert(engine.newGame(LT.DATA.starters[0]).ok);
  const monsters=ids.map((id,i)=>{const mon=engine.makeMonster(id,17+i);mon.nickname=`試験${i+1}`;mon.shiny=i%2===1;mon.hp=Math.max(1,mon.hp-5);mon.pp[LT.DATA.species[id].moves[0]]--;return mon;});
  engine.state.party=monsters.slice(0,6);engine.state.storage=monsters.slice(6);engine.state.seen=ids.slice();engine.state.caught=ids.slice();
  const before={data:JSON.stringify(LT.DATA),save:JSON.stringify(engine.serialize())};
  for(const file of ['monster-pixels.js','creature-art.js','assets/creatures-individual-catalog.js','individual-creature-art.js']){
    document.currentScript={src:new URL(file,document.baseURI).href};vm.runInContext(file==='creature-art.js'?source:fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  }
  const pixel=blocks.find(([,attrs,code])=>!attrs.includes('src=')&&code.includes('LT.PixelSprites='));assert(pixel);
  vm.runInContext(pixel[2],context,{filename:'PixelSprites'});
  const art=LT.CreatureArt,drain=async()=>{await settle();while(active.size)await Promise.all([...active]);await settle();};
  await drain();await art.ready;await drain();
  return {LT,art,engine,before,requests,events,drain,
    expire(){for(const timer of [...timers])timer.callback();},
    async finish(){const pending=deferred.splice(0);await Promise.all(pending.map(fn=>fn()));await drain();}};
}
function productionPortrait(LT,id,back=false,shiny=false){
  const cv=canvas.createCanvas(320,320);LT.PixelSprites.creature(cv,id,{back,shiny,time:0,reducedMotion:true});return cv;
}
function assertSaveIntact(run){
  assert.equal(JSON.stringify(run.LT.DATA),run.before.data,'Artwork mutated species/gameplay definitions');
  assert.equal(JSON.stringify(run.engine.serialize()),run.before.save,'Rendering changed owned individuals, HP, PP, level, nickname or shiny state');
  const restored=new run.LT.Engine(run.engine.serialize());
  const owned=engine=>JSON.parse(JSON.stringify([...engine.state.party,...engine.state.storage]));
  assert.deepEqual(owned(restored),owned(run.engine),'Save reload changed one of the revised species');
}
async function main(){
  for(const file of files)assert(fs.existsSync(path.join(root,file)),`Missing generated atlas: ${file}`);
  const run=await runtime(),{LT,art}=run;
  assert.deepEqual(Array.from(art.revisedIds),ids);assert(ids.every(id=>art.hasRevised(id)));
  assert(!art.hasRevised('galdogran'),'The cancelled evolution must not retain an active artwork entry');
  assert.equal(art.revisedArt.galdoras.file,'assets/galdoras-user-v70.png');assert.equal(art.revisedArt.galdoras.stage,0);
  assert(!art.hasRevised('rurikoro')&&!art.hasRevised('rurigorm'),'Unchanged rock family unexpectedly rerouted');
  for(const id of ids.filter(id=>id!=='futo')){
    assert(LT.DATA.species[id].hiddenDex,`${id}: off-dex identity was lost`);
    assert(!LT.IndividualArtCatalog.species[id]&&!LT.IndividualCreatureArt.has(id),`${id}: hidden species leaked into the public artwork catalogue`);
  }
  assert(!run.requests.some(file=>files.includes(file)),'Revised portraits should not enlarge ordinary startup');
  for(const id of ids)for(const back of [false,true]){
    assert.equal(art.get(id,back),null,'A request must stay pending until its source image loads');
    assert.equal(art.orientation(id,back).source,'revised-pending');
  }
  assert.deepEqual(Array.from(await art.preload(ids,{back:'both'})),ids.map(()=>true));await run.drain();
  assert.deepEqual(run.requests.filter(file=>files.includes(file)),files,'Each shared atlas must be fetched exactly once');
  assert.equal(art.status().revisedLoaded,files.length);assert.equal(art.status().revisedFailed,0);
  assert.equal(art.status().evolutionRequested,0,'Revised forms must not request generic evolution silhouettes');
  assert.equal(LT.IndividualCreatureArt.status().requested,0,'Revised forms must not request old individual sheets');
  assertNoRetired(run);
  const images=new Map();for(const file of files)images.set(file,await canvas.loadImage(path.join(root,file)));
  const hashes=new Map(),rendered=new Map();
  for(const id of ids){
    const entry=art.revisedArt[id],image=images.get(entry.file),views=[];
    for(const back of [false,true]){
      const cv=art.get(id,back),stats=imageStats(cv);views.push(cv);
      assert.equal(cv.width,320);assert.equal(cv.height,320);
      assert(stats.fraction>.03&&stats.fraction<.9,`${id}: missing visible figure or transparency`);
      assert(stats.left>=10&&stats.top>=10&&stats.right<310&&stats.bottom<310,`${id}: display clips the figure`);
      const native=entry[back?'back':'front'];
      const frame=native?Array.from(native).map((value,i)=>value*(i%2?image.height/entry.nativeSize[1]:image.width/entry.nativeSize[0])):
        [back?Math.floor(image.width/2):0,Math.floor(entry.row*image.height/entry.rows),back?image.width-Math.floor(image.width/2):Math.floor(image.width/2),Math.floor((entry.row+1)*image.height/entry.rows)-Math.floor(entry.row*image.height/entry.rows)];
      assert(frame[0]>=0&&frame[1]>=0&&frame[0]+frame[2]<=image.width&&frame[1]+frame[3]<=image.height,`${id}: source rectangle escapes its PNG`);
      const original=canvas.createCanvas(Math.round(frame[2]),Math.round(frame[3])),oc=original.getContext('2d');
      oc.drawImage(image,...frame,0,0,original.width,original.height);
      assert(imageStats(original).opaque>0,`${id}: selected an empty source cell`);
      assert(maskDifference(silhouette(original),silhouette(cv))<.09,`${id}: source silhouette or view was changed`);
      original.width=original.height=1;
      const orientation=art.orientation(id,back);assert.equal(orientation.source,'revised-authored');assert.equal(orientation.authoredBack,back);
      assert.equal(orientation.direction,entry[back?'backDirection':'frontDirection']??(back?-1:1));
      assert.equal(orientation.stage,entry.stage);
      const shiny=art.get(id,back,{shiny:true});assert.notEqual(imageStats(shiny).hash,stats.hash,`${id}: shiny has no palette change`);
      assert.deepEqual(alpha(shiny),alpha(cv),`${id}: shiny changed source alpha`);
      hashes.set(`${id}:${back}`,stats.hash);
      for(const alternate of [false,true]){
        const actual=productionPortrait(LT,id,back,alternate),shown=imageStats(actual);assert(shown.fraction>.01);
        rendered.set(`${id}:${back}:${alternate}`,shown.hash);actual.width=actual.height=1;
      }
    }
    assert.notEqual(imageStats(views[0]).hash,imageStats(views[1]).hash,`${id}: rear duplicates front`);
    const mirror=canvas.createCanvas(320,320),mc=mirror.getContext('2d');mc.translate(320,0);mc.scale(-1,1);mc.drawImage(views[0],0,0);
    assert.notEqual(imageStats(mirror).hash,imageStats(views[1]).hash,`${id}: rear is only a mirrored front`);mirror.width=mirror.height=1;
  }
  assert.equal(new Set(hashes.values()).size,ids.length*2,'Each species/view must retain its own illustration');
  art.clearCache();
  for(const id of ids)for(const back of [false,true])assert.equal(imageStats(art.get(id,back)).hash,hashes.get(`${id}:${back}`));
  await art.preload([...ids,...ids],{back:'both'});assert.equal(run.requests.filter(file=>files.includes(file)).length,files.length,'Cache rebuild re-fetched an atlas');
  // The two v54 rock forms were not redrawn. Keep their real-image regression
  // coverage when the old off-dex test entry delegates to this consolidated test.
  assert.deepEqual(Array.from(await art.preload(Object.keys(unchanged),{back:'both'})),[true,true]);await run.drain();
  assert.deepEqual(run.requests.filter(file=>Object.values(unchanged).includes(file)),Object.values(unchanged));
  for(const id of Object.keys(unchanged)){
    assert(LT.DATA.species[id].hiddenDex&&!LT.IndividualCreatureArt.has(id));
    const views=[];
    for(const back of [false,true]){
      const cv=art.get(id,back),stats=imageStats(cv);views.push(cv);
      assert(stats.fraction>.05&&stats.fraction<.85,`${id}: missing unchanged rock figure`);
      assert(stats.left>=10&&stats.top>=10&&stats.right<310&&stats.bottom<310,`${id}: unchanged figure was clipped`);
      assert.equal(art.orientation(id,back).source,'offdex-authored');assert.equal(art.orientation(id,back).direction,back?1:-1);
      const shiny=art.get(id,back,{shiny:true});assert.notEqual(imageStats(shiny).hash,stats.hash);assert.deepEqual(alpha(shiny),alpha(cv));
    }
    assert.notEqual(imageStats(views[0]).hash,imageStats(views[1]).hash,`${id}: unchanged rear duplicates front`);
    const mirror=canvas.createCanvas(320,320),mc=mirror.getContext('2d');mc.translate(320,0);mc.scale(-1,1);mc.drawImage(views[0],0,0);
    assert.notEqual(imageStats(mirror).hash,imageStats(views[1]).hash,`${id}: unchanged rear is a mirrored front`);mirror.width=mirror.height=1;
  }
  assertSaveIntact(run);

  const delayed=await runtime('delayed'),waiting=delayed.art.preload(ids,{back:'both'}),pending=new Map();
  for(const id of ids)for(const back of [false,true]){
    assert.equal(delayed.art.get(id,back),null);assert.equal(delayed.art.get(id,back,{shiny:true}),null);
    const placeholder=productionPortrait(delayed.LT,id,back);pending.set(`${id}:${back}`,imageStats(placeholder).hash);placeholder.width=placeholder.height=1;
  }
  delayed.expire();assert.deepEqual(Array.from(await waiting),ids.map(()=>false));
  assert.equal(delayed.art.status().revisedFailed,files.length);assertNoRetired(delayed);
  for(const id of ids)for(const back of [false,true])assert.equal(delayed.art.get(id,back),null,'Timed-out loading redisplayed a retired illustration');
  await delayed.finish();assert.equal(delayed.art.status().revisedFailed,0);assert.equal(delayed.art.status().revisedLoaded,files.length);
  const notifications=delayed.events.filter(event=>event.type==='pachi-art-ready'&&event.speciesIds);
  assert.equal(notifications.length,files.length,'Each late atlas should refresh its own portraits once');
  assert.deepEqual(new Set(notifications.flatMap(event=>Array.from(event.speciesIds))),new Set(ids));
  for(const id of ids)for(const back of [false,true])for(const shiny of [false,true]){
    const cv=productionPortrait(delayed.LT,id,back,shiny),hash=imageStats(cv).hash;
    assert.equal(hash,rendered.get(`${id}:${back}:${shiny}`),'Late image did not replace the cached waiting portrait');
    assert.notEqual(hash,pending.get(`${id}:${back}`),'Waiting portrait remained after load');cv.width=cv.height=1;
  }
  assertNoRetired(delayed);assertSaveIntact(delayed);

  const failed=await runtime('failed');assert.deepEqual(Array.from(await failed.art.preload(ids,{back:'both'})),ids.map(()=>false));await failed.drain();
  for(const id of ids)for(const back of [false,true]){
    assert.equal(failed.art.get(id,back),null);assert.equal(failed.art.orientation(id,back).source,'revised-pending');
    const cv=productionPortrait(failed.LT,id,back);assert.equal(imageStats(cv).hash,pending.get(`${id}:${back}`));cv.width=cv.height=1;
  }
  await failed.art.preload(ids,{back:'both'});assert.equal(failed.requests.filter(file=>files.includes(file)).length,files.length,'An error triggered a request storm');
  assertNoRetired(failed);assertSaveIntact(failed);
  const output=process.argv[2];
  if(output){
    const width=1280,rowHeight=350,sheet=canvas.createCanvas(width,Math.ceil(ids.length/2)*rowHeight),c=sheet.getContext('2d');
    c.fillStyle='#202f42';c.fillRect(0,0,sheet.width,sheet.height);c.fillStyle='#f4ead0';c.font='16px sans-serif';
    for(const [i,id]of ids.entries())for(const back of [false,true]){
      const x=(i%2)*640+(back?320:0),y=Math.floor(i/2)*rowHeight;
      c.fillText(`${id} / ${back?'REAR':'FRONT'}`,x+16,y+23);c.drawImage(art.get(id,back),x,y+30);
    }
    fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,sheet.toBuffer('image/png'));
  }
  console.log(JSON.stringify({ok:true,species:ids.length,authoredViews:ids.length*2,unchangedRockViews:4,sharedAtlases:files.length,transparentMargins:true,distinctRearViews:true,shinyAlphaPreserved:true,lateRecovery:true,noRetiredImages:true,saveIdentityUnchanged:true}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
