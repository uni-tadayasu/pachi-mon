#!/usr/bin/env node
'use strict';
// Actual front/rear pixels, independent loading, front-only legacy fallback and late recovery.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {canvas,imageStats,runtime:gameRuntime}=require('./check-art.cjs');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'creature-art.js'),'utf8');
const settle=()=>new Promise(setImmediate);
async function runtime(mode='normal',expire=true){
 const deferred=[],timers=new Set(),requests=[],events=[],active=new Set();
 const placeholder=canvas.createCanvas(400,400).toBuffer('image/png');
 class LocalImage extends canvas.Image {
  set src(value){
   const url=new URL(String(value),'https://example.test/pachi-mon/');
   const relative=decodeURIComponent(url.pathname.replace(/^\/pachi-mon\//,''));requests.push(relative);
   const view=relative==='assets/futo-front-v2.png'?'front':relative==='assets/futo-back-v2.png'?'back':null;
   const original=relative==='assets/futo.png',affected=view&&(mode.startsWith(view)||mode.startsWith('both'));
   const complete=()=>new Promise(resolve=>{
    const onload=this.onload,onerror=this.onerror;
    this.onload=(...args)=>{try{onload?.apply(this,args);}finally{resolve();}};
    this.onerror=(...args)=>{try{onerror?.apply(this,args);}finally{resolve();}};
    if(affected&&mode.endsWith('failed')){this.onerror(new Error('Expected missing '+view));return;}
    try{super.src=view||original?path.join(root,relative):placeholder;}catch(error){this.onerror(error);}
   });
   if(affected&&mode.endsWith('delayed'))deferred.push({view,complete});
   else{const task=new Promise(resolve=>setImmediate(()=>complete().then(resolve)));active.add(task);task.finally(()=>active.delete(task));}
  }
  get src(){return super.src;}
 }
 const document={baseURI:'https://example.test/pachi-mon/',currentScript:{src:'https://example.test/pachi-mon/creature-art.js'},
  createElement(tag){assert.equal(tag,'canvas');return canvas.createCanvas(1,1);},dispatchEvent(event){events.push(event);}};
 const context=vm.createContext({LT:{DATA:{species:{futo:{id:'futo',shape:'cat',element:'crystal'}}}},document,Image:LocalImage,URL,Uint8Array,Uint8ClampedArray,Float32Array,Int32Array,ArrayBuffer,
  Event:class Event{constructor(type){this.type=type;}},setTimeout(callback){const token={callback};timers.add(token);return token;},clearTimeout(token){timers.delete(token);},console});
 vm.runInContext(source,context,{filename:'creature-art.js'});const art=context.LT.CreatureArt;
 const run={art,requests,events,async expire(){for(const token of [...timers])token.callback();await art.ready;while(active.size)await Promise.all([...active]);await settle();},
  async finish(view){const selected=deferred.filter(item=>!view||item.view===view);for(const item of selected)deferred.splice(deferred.indexOf(item),1);await Promise.all(selected.map(item=>item.complete()));await settle();}};
 await settle();while(active.size)await Promise.all([...active]);
 if(mode.endsWith('delayed')){if(expire)await run.expire();}
 else{await art.ready;while(active.size)await Promise.all([...active]);await settle();}
 return run;
}
function hashes(art){return [false,true].map(back=>imageStats(art.get('futo',back)).hash);}
async function main(){
 assert(fs.readFileSync(path.join(root,'admin-console.js'),'utf8').includes('assets/futo-front-v2.png'),'Admin preview uses the same revised front');
 const normal=await runtime(),art=normal.art;
 assert.equal(art.status().futoFrontLoaded,true);assert.equal(art.status().futoBackLoaded,true);assert.equal(art.supportsBack('futo'),true);
 assert(!normal.requests.includes('assets/futo.png'),'Successful new images must not download the unused original');
 assert.equal(normal.events.length,0,'Normal startup relies on Art.ready without extra update notifications');
 await art.preload('futo',{back:'both'});
 const [front,back]=[false,true].map(rear=>art.get('futo',rear)),stats=[front,back].map(imageStats);
 for(const [i,s]of stats.entries()){
  assert(s.fraction>.05&&s.fraction<.85,`${i}: expected visible transparent character`);
  assert(s.left>=10&&s.right<311&&s.top>=10&&s.bottom<311,`${i}: complete figure must have a clear margin`);
 }
 assert(Math.abs((stats[0].bottom-stats[0].top)-(stats[1].bottom-stats[1].top))<=2,'Front/rear figure height is consistent');
 assert.notEqual(stats[0].hash,stats[1].hash,'Rear is not a duplicate of the front');
 const mirrored=canvas.createCanvas(320,320),mc=mirrored.getContext('2d');mc.translate(320,0);mc.scale(-1,1);mc.drawImage(front,0,0);
 assert.notEqual(imageStats(mirrored).hash,stats[1].hash,'Rear is not a mirrored front');
 assert.equal(art.orientation('futo',false).direction,-1);assert.equal(art.orientation('futo',true).direction,1);assert.equal(art.orientation('futo',true).authoredBack,true);
 for(const rear of [false,true]){
  const ordinary=imageStats(art.get('futo',rear)),shiny=imageStats(art.get('futo',rear,{shiny:true}));
  assert.notEqual(shiny.hash,ordinary.hash);assert.equal(shiny.opaque,ordinary.opaque,'Shiny keeps silhouette');
 }
 const originalHashes=hashes(art);art.clearCache();assert.deepEqual(hashes(art),originalHashes,'Cache clearing preserves both poses');
 for(const view of ['front','back','both']){
  const failed=await runtime(view+'-failed'),a=failed.art,frontFailed=view!=='back',backFailed=view!=='front';
  assert.equal(a.status().futoFrontFailed,frontFailed);assert.equal(a.status().futoBackFailed,backFailed);
  assert.equal(a.status().futoOriginalFallbackLoaded,frontFailed,'Only front failure starts old-front fallback');
  assert(a.get('futo',false));
  if(backFailed){assert.equal(a.get('futo',true),null,'Missing rear must not reuse a front');assert.equal(a.orientation('futo',true).direction,-1);}
  else assert.equal(imageStats(a.get('futo',true)).hash,originalHashes[1]);
  if(!frontFailed){assert.equal(imageStats(a.get('futo',false)).hash,originalHashes[0]);assert(!failed.requests.includes('assets/futo.png'));}
 }
 for(const view of ['front','back','both']){
  const delayed=await runtime(view+'-delayed'),a=delayed.art;
  const preserved=view==='front'?a.get('futo',true):view==='back'?a.get('futo',false):null;
  const preservedShiny=view==='front'?a.get('futo',true,{shiny:true}):view==='back'?a.get('futo',false,{shiny:true}):null;
  if(view!=='front')assert.equal(a.get('futo',true),null);
  if(view!=='back')a.get('futo',false,{shiny:true});
  const notifications=delayed.events.length;
  if(view==='both'){
   await delayed.finish('front');assert.equal(a.get('futo',true),null,'Front completion cannot masquerade as rear');
   assert.equal(a.status().futoBackLoaded,false);await delayed.finish('back');
  }else await delayed.finish();
  assert(delayed.events.length>notifications,'Late success refreshes portraits');
  assert.deepEqual(hashes(a),originalHashes);assert.equal(a.status().futoFailed,false);
  for(const event of delayed.events){assert.equal(event.type,'pachi-art-ready');assert.deepEqual(Array.from(event.speciesIds),['futo']);}
  if(preserved){const rear=view==='front';assert.equal(a.get('futo',rear),preserved,'Opposite view retains its cached canvas');assert.equal(a.get('futo',rear,{shiny:true}),preservedShiny,'Opposite shiny stays cached');}
  for(const rear of [false,true])assert.equal(imageStats(a.get('futo',rear,{shiny:true})).hash,imageStats(art.get('futo',rear,{shiny:true})).hash,'Recovered shiny is current');
 }
 // A view-specific preload does not wait for the other view's stalled request.
 const partial=await runtime('front-delayed',false);await partial.art.preload('futo',{back:true});
 assert.equal(partial.art.status().futoBackLoaded,true);assert.equal(partial.art.status().futoFrontLoaded,false);await partial.expire();await partial.finish();
 const output=process.argv[2];if(output){
  const {LT,engine}=await gameRuntime(),sheet=canvas.createCanvas(1536,914),c=sheet.getContext('2d');c.fillStyle='#23313f';c.fillRect(0,0,sheet.width,sheet.height);c.font='20px sans-serif';c.fillStyle='#ffffff';
  for(let i=0;i<4;i++){c.fillText(['Futo front','Futo rear','Shiny front','Shiny rear'][i],i*384+20,28);c.drawImage(art.get('futo',i%2===1,{shiny:i>=2}),i*384+32,45);}
  const target=canvas.createCanvas(768,480);
  engine.state.party=[engine.makeMonster('futo',70)];engine.battle={activeIndex:0,enemy:engine.makeMonster('arvelion',70)};LT.Art.battle(target,engine,0);
  c.fillText('Solo: Futo rear faces Arvelion',20,418);c.drawImage(target,0,434);
  const state={mode:'double',teams:[{active:[0,1],monsters:['futo','arvelion'].map(id=>engine.makeMonster(id,70))},{active:[0,1],monsters:['arvelion','futo'].map(id=>engine.makeMonster(id,70))}]};
  LT.PixelSprites.duel(target,state,0,0);c.fillText('Doubles: front and rear in battle',788,418);c.drawImage(target,768,434);
  fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,sheet.toBuffer('image/png'));
 }
 console.log(JSON.stringify({ok:true,authoredFrontBack:true,distinctAndNotMirrored:true,transparentMargins:true,shinyShapePreserved:true,missingRearNeverUsesFront:true,independentFailureCases:3,independentLateRecoveryCases:3,viewSpecificPreload:true,normalStartupNotifications:0,unneededOriginalDownload:false}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
