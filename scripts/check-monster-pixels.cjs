#!/usr/bin/env node
'use strict';
// Real Canvas checks for the shared creature display grid. Source artwork,
// gameplay data and saves remain unchanged; only the displayed grid and ink change.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {runtime,canvas,imageStats}=require('./check-art.cjs');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'monster-pixels.js'),'utf8'),GRID=112;
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const rgba=cv=>cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
function alphaHash(cv){const data=rgba(cv),alpha=new Uint8Array(data.length/4);for(let i=0;i<alpha.length;i++)alpha[i]=data[i*4+3];return hash(alpha);}
async function settle(){global.gc?.();await new Promise(setImmediate);global.gc?.();await new Promise(setImmediate);}
function install(LT={},create=()=>canvas.createCanvas(1,1)){
 const context=vm.createContext({LT,document:{createElement(tag){assert.equal(tag,'canvas');return create();}}});
 vm.runInContext(source,context,{filename:'monster-pixels.js'});return context.LT.MonsterPixels;
}
function traced(size=352){
 const cv=canvas.createCanvas(size,size),c=cv.getContext('2d'),draw=c.drawImage.bind(c),calls=[];
 c.drawImage=(image,...args)=>{calls.push({image,args,smoothing:c.imageSmoothingEnabled,transform:c.getTransform()});return draw(image,...args);};
 return {cv,c,calls,reset(){calls.length=0;}};
}
function painted(width=320,height=320,color='#de8256'){
 const cv=canvas.createCanvas(width,height),c=cv.getContext('2d');c.fillStyle=color;c.fillRect(width*.1,height*.2,width*.65,height*.65);c.fillStyle='#273c71';c.fillRect(width*.55,height*.1,width*.3,height*.35);return cv;
}
function visibleInside(cv,label,margin=0){
 const stats=imageStats(cv);assert(stats.fraction>.015&&stats.fraction<.9,`${label}: visible creature with a transparent surround`);
 assert(stats.left>=margin&&stats.top>=margin&&stats.right<cv.width-margin&&stats.bottom<cv.height-margin,`${label}: the creature is not cut by the canvas boundary`);
 return stats;
}

function nearest(source,width,height){
 const out=canvas.createCanvas(width,height),c=out.getContext('2d');c.imageSmoothingEnabled=false;c.drawImage(source,0,0,width,height);return out;
}
function colorAt(cv,x,y){return Array.from(cv.getContext('2d').getImageData(x,y,1,1).data);}
const luminance=([r,g,b])=>r*.2126+g*.7152+b*.0722;

function unitChecks(){
 const P=install();assert.equal(P.grid,GRID);assert(Object.isFrozen(P));
 // An independent nearest-neighbor render supplies only the alpha oracle.
 // Colour is intentionally stronger, but sampling may never blur the silhouette.
 const cv=canvas.createCanvas(320,320),c=cv.getContext('2d'),data=c.createImageData(320,320),colors=[[231,94,61,255],[48,146,103,255],[40,80,120,128]];
 for(let y=0;y<320;y++)for(let x=0;x<320;x++){
  const xx=Math.floor(x/2),yy=Math.floor(y/2),color=xx<3||xx>156||yy<3||yy>156?[0,0,0,0]:colors[(xx+yy)%colors.length],at=(y*320+x)*4;data.data.set(color,at);
 }
 c.putImageData(data,0,0);const originalHash=hash(rgba(cv)),pixel=P.get(cv),sample=nearest(cv,GRID,GRID);
 assert.notEqual(pixel,cv);assert.deepEqual([pixel.width,pixel.height],[GRID,GRID]);
 assert.equal(alphaHash(pixel),alphaHash(sample),'Ink treatment retains every sampled alpha value, including partial alpha');
 assert.notEqual(hash(rgba(pixel)),hash(rgba(sample)),'The requested darker treatment is applied after nearest sampling');
 assert.equal(hash(rgba(cv)),originalHash);assert.deepEqual([cv.width,cv.height],[320,320]);
 assert.equal(P.get(pixel),pixel,'A rendered output is never darkened a second time');
 assert.equal(P.get(cv),pixel,'The same immutable source reuses its processed sample');
 const fresh=painted();assert.notEqual(P.get(fresh),pixel,'A replacement source cannot inherit the old sample');

 // Broad fill, an internal stripe, pale highlights and saturated colour marks
 // verify the visual outcome without duplicating the implementation's formula.
 const motif=canvas.createCanvas(GRID,GRID),mc=motif.getContext('2d');
 mc.fillStyle='#be8f5b';mc.fillRect(8,8,96,96);
 mc.fillStyle='#5f473c';mc.fillRect(24,24,12,40);
 mc.fillStyle='#fafafa';mc.fillRect(72,20,20,20);
 mc.fillStyle='#40324e';mc.fillRect(72,48,20,16);
 for(const [i,color]of ['#c24442','#3ba567','#456bd4'].entries()){mc.fillStyle=color;mc.fillRect(16+i*28,76,16,16);}
 const motifHash=hash(rgba(motif)),ink=P.get(motif);
 assert.notEqual(ink,motif);assert.deepEqual([ink.width,ink.height],[GRID,GRID],'Native grid art is styled without enlargement');
 assert.equal(alphaHash(ink),alphaHash(motif));assert.equal(hash(rgba(motif)),motifHash);
 assert(luminance(colorAt(ink,8,16))<luminance(colorAt(ink,16,16))*.75,'The outer contour is darker than the adjacent body fill');
 const oldContrast=luminance(colorAt(motif,23,44))-luminance(colorAt(motif,24,44));
 const newContrast=luminance(colorAt(ink,23,44))-luminance(colorAt(ink,24,44));
 assert(newContrast>oldContrast,'An existing dark pattern is clearer against its body colour');
 assert(luminance(colorAt(ink,24,44))<luminance(colorAt(motif,24,44)),'Dark pattern strokes are visibly deeper');
 assert(luminance(colorAt(ink,80,28))>=235,'Eye and ivory highlights remain bright');
 assert(luminance(colorAt(ink,80,54))>10,'Dark coloured details retain tonal separation from black');
 for(let i=0;i<3;i++){
  const rgb=colorAt(ink,23+i*28,83).slice(0,3);
  assert(rgb[i]>Math.max(...rgb.filter((_,j)=>j!==i)),'Red, green and blue identities remain distinct');
 }
 assert.equal(P.get(ink),ink,'Native-size styling is idempotent too');

 const rectangle=painted(320,160),rectBefore=hash(rgba(rectangle)),rect=P.get(rectangle);assert.deepEqual([rect.width,rect.height],[GRID,GRID/2]);assert.equal(hash(rgba(rectangle)),rectBefore);
 const native=painted(96,72),nativeHash=hash(rgba(native)),small=P.get(native);assert.notEqual(small,native);assert.deepEqual([small.width,small.height],[96,72],'Small native artwork is never enlarged');assert.equal(alphaHash(small),alphaHash(native));assert.equal(hash(rgba(native)),nativeHash);
 // Resizing an existing canvas and clearing after a content edit both invalidate.
 cv.width=160;cv.height=240;c.fillStyle='#d44b86';c.fillRect(20,20,100,200);const resized=P.get(cv);assert.notEqual(resized,pixel);assert.deepEqual([resized.width,resized.height],[75,GRID]);
 cv.width=cv.height=32;const tiny=P.get(cv);assert.notEqual(tiny,cv);assert.deepEqual([tiny.width,tiny.height],[32,32]);cv.width=cv.height=320;c.fillStyle='#6a92dc';c.fillRect(8,8,304,304);const regrown=P.get(cv);assert.notEqual(regrown,resized);
 const cachedHash=hash(rgba(regrown));c.fillStyle='#dce7a2';c.fillRect(8,8,304,304);assert.equal(P.get(cv),regrown,'Immutable-source cache changes only after a resize, replacement or explicit clear');
 P.clearCache();const refreshed=P.get(cv);assert.notEqual(refreshed,regrown);assert.notEqual(hash(rgba(refreshed)),cachedHash);
 for(const invalid of [null,undefined,0,'sprite',{}, {width:0,height:320},{width:Infinity,height:320}])assert.equal(P.get(invalid),invalid);
 let unavailable=true;const retry=install({},()=>{if(unavailable)throw Error('Canvas is unavailable');return canvas.createCanvas(1,1);}),good=painted();
 assert.equal(retry.get(good),good,'A failed sample leaves the original usable');unavailable=false;assert.equal(retry.get(good).width,GRID,'A failed sample is not cached forever');
 const sameSource=install({},()=>good),safeHash=hash(rgba(good));assert.equal(sameSource.get(good),good);assert.deepEqual([good.width,good.height],[320,320]);assert.equal(hash(rgba(good)),safeHash,'A faulty canvas factory must not resize its input');
 const unreadable=install({},()=>{const failed=canvas.createCanvas(1,1);failed.getContext('2d').getImageData=()=>{throw Error('Pixel read failed');};return failed;});
 assert.equal(unreadable.get(good),good,'Unreadable pixel data degrades to the original artwork');assert.equal(hash(rgba(good)),safeHash);
 console.log('PASS helper: stronger contours and motifs, bright highlights, nearest alpha, immutable source, idempotence, cache and graceful failure');
}

async function integratedChecks(){
 const {LT,engine,imageErrors}=await runtime(),P=LT.MonsterPixels,art=LT.CreatureArt,ids=Object.keys(LT.DATA.species),target=traced();
 assert(P&&P.grid===GRID,'The shipped page loads the shared helper before its creature renderer');assert.equal(ids.length,269);assert.equal(LT.Art.creature,LT.PixelSprites.creature);
 const before={data:JSON.stringify(LT.DATA),save:JSON.stringify(engine.state)},fronts=new Set(),backs=new Set();let renders=0;
 for(const [index,id]of ids.entries()){
  await art.preload([id],{back:'both'});const views=[];
  for(const back of [false,true]){
   const variants=[];
   for(const shiny of [false,true]){
    const original=art.get(id,back,{shiny});assert(original,`${id}: artwork or procedural fallback exists`);
    const originalHash=hash(rgba(original)),dimensions=[original.width,original.height],sample=P.get(original),orientation=JSON.stringify(art.orientation(id,back));
    assert.deepEqual([sample.width,sample.height],[GRID,GRID],`${id}: shared logical grid`);assert.equal(P.get(original),sample);
    target.reset();const facing=back?'right':'left';LT.Art.creature(target.cv,id,{back,shiny,time:0,size:320,x:16,y:16,facing});
    assert.equal(target.calls.length,1,`${id}: a static creature has one sampled-body draw`);const call=target.calls[0];assert.equal(call.image,sample,`${id}: Art.creature uses the shared helper output`);assert.equal(call.smoothing,false);
    assert.equal(call.transform.a<0,LT.PixelSprites.battleFacing(id,back,facing).flip,`${id}: sampling preserves the authored direction`);
    assert.equal(JSON.stringify(art.orientation(id,back)),orientation);assert.deepEqual([original.width,original.height],dimensions);assert.equal(hash(rgba(original)),originalHash,`${id}: rendering does not edit the source canvas`);
    const stats=visibleInside(target.cv,`${id}/${back?'back':'front'}/${shiny?'shiny':'normal'}`,16);variants.push({hash:stats.hash,alpha:alphaHash(target.cv)});renders++;
   }
   assert.notEqual(variants[0].hash,variants[1].hash,`${id}: colour variants remain distinct after sampling`);assert.equal(variants[0].alpha,variants[1].alpha,`${id}: the shiny palette preserves the silhouette`);views.push(variants[0].hash);
  }
  assert.notEqual(views[0],views[1],`${id}: front and rear remain distinct`);fronts.add(views[0]);backs.add(views[1]);
  if((index+1)%8===0)await settle();if((index+1)%64===0)console.log(`Rendered ${index+1}/${ids.length} species on the ${GRID}-pixel grid`);
 }
 assert.equal(renders,ids.length*4);assert(fronts.size>=200&&backs.size>=200,'Individual species keep their distinct artwork');assert.equal(imageErrors.length,0,'The exhaustive pass must use valid shipped artwork');
 assert.equal(JSON.stringify(LT.DATA),before.data);assert.equal(JSON.stringify(engine.state),before.save);
 console.log(`PASS actual Art.creature: ${ids.length} species, ${renders} front/back/normal/shiny renders, transparent bounds and facing`);

 // Source replacement and cache clearing are exercised through the real facade.
 const get=art.get,first=painted(320,320,'#e97c56'),second=painted(320,320,'#59acb4');let current=first;
 art.get=()=>current;
 try{
  const draw=()=>{target.reset();LT.Art.creature(target.cv,'komori',{time:0});return {hash:imageStats(target.cv).hash,image:target.calls.at(-1).image};};
  const a=draw();current=second;const b=draw();assert.notEqual(a.hash,b.hash);assert.notEqual(a.image,b.image);assert.equal(b.image,P.get(second));assert.equal(draw().image,b.image);
  second.getContext('2d').fillStyle='#e4b8e1';second.getContext('2d').fillRect(30,30,240,240);LT.PixelSprites.clearCache();const c=draw();assert.notEqual(c.image,b.image);assert.notEqual(c.hash,b.hash,'Clearing the production renderer invalidates its sample');
  delete LT.MonsterPixels;const missing=draw();assert.equal(missing.image,second,'If the helper is unavailable, the existing renderer uses the original source');visibleInside(target.cv,'optional helper absent');LT.MonsterPixels=P;
 }finally{art.get=get;LT.MonsterPixels=P;}
 console.log('PASS actual source replacement, renderer cache invalidation and optional-module fallback');

 const representatives=new Map();for(const id of ids){const profile=LT.PixelSprites.motionProfile(id);if(!representatives.has(profile))representatives.set(profile,id);}
 assert.equal(representatives.size,5);const motionIds=[...new Set([...representatives.values(),'futo','arvelion','floravelle','nullmie','nullva','zeroveil'])],moving=traced(450);let motionViews=0;
 function frame(id,options){moving.reset();LT.Art.creature(moving.cv,id,{size:320,x:65,y:65,...options});for(const call of moving.calls){assert(call.image.width<=GRID&&call.image.height<=GRID);assert.equal(call.smoothing,false);}return visibleInside(moving.cv,`${id}: motion`).hash;}
 for(const id of motionIds){await art.preload([id],{back:'both'});for(const back of [false,true]){
  const base=frame(id,{back,time:0});assert.equal(frame(id,{back,time:3100,reducedMotion:true}),base);assert.equal(frame(id,{back,time:3100,motion:false}),base);
  const idle=frame(id,{back,time:1100});assert.notEqual(idle,frame(id,{back,time:1600}),`${id}: idle motion remains visible`);
  for(const [action,progress]of [['attack',.5],['cast',.35],['hit',.53],['faint',1],['enter',.3]])assert.notEqual(frame(id,{back,time:1100,action,progress}),idle,`${id}: ${action} pose remains visible`);
  motionViews++;
 }await settle();}
 assert.equal(JSON.stringify(LT.DATA),before.data);assert.equal(JSON.stringify(engine.state),before.save);target.cv.width=target.cv.height=moving.cv.width=moving.cv.height=1;
 console.log(`PASS all ${representatives.size} motion profiles, ${motionViews} front/back motion views, five battle poses and reduced motion`);
 return {species:ids.length,renders,uniqueFronts:fronts.size,uniqueBacks:backs.size,motionProfiles:representatives.size,motionViews};
}

async function delayedChecks(){
 const delayed=await runtime('delayed-assets'),{LT,engine}=delayed,P=LT.MonsterPixels,target=traced(),before={data:JSON.stringify(LT.DATA),save:JSON.stringify(engine.state)};
 assert.equal(LT.CreatureArt.status().arvelionLoaded,false);
 // With all downloads held, CreatureArt returns null and PixelSprites creates
 // its procedural source. Observe the real helper input without bypassing it.
 let observedSource;LT.MonsterPixels={...P,get(value){observedSource=value;return P.get(value);}};
 LT.Art.creature(target.cv,'arvelion',{time:0});const oldSource=observedSource,oldHash=hash(rgba(oldSource)),oldSample=P.get(oldSource),oldFrame=imageStats(target.cv).hash;assert.equal(target.calls.at(-1).image,oldSample);
 await delayed.finishDelayedImages();assert.equal(LT.CreatureArt.status().arvelionLoaded,true);
 const nextSource=LT.CreatureArt.get('arvelion',false);assert.notEqual(nextSource,oldSource);target.reset();LT.Art.creature(target.cv,'arvelion',{time:0});
 assert.equal(observedSource,nextSource);assert.equal(target.calls.at(-1).image,P.get(nextSource));assert.notEqual(imageStats(target.cv).hash,oldFrame,'Late authored artwork replaces the sampled fallback');assert.equal(hash(rgba(oldSource)),oldHash);LT.MonsterPixels=P;
 assert.equal(JSON.stringify(LT.DATA),before.data);assert.equal(JSON.stringify(engine.state),before.save);target.cv.width=target.cv.height=1;
 console.log('PASS late image arrival replaces the sampled fallback without mutating the old source, catalog or save');
}

async function fallbackChecks(){
 const {LT,engine}=await runtime('no-modules');assert.equal(LT.MonsterPixels,undefined);assert.equal(LT.CreatureArt,undefined);
 const before={data:JSON.stringify(LT.DATA),save:JSON.stringify(engine.state)},target=traced(320),byShape=new Map();
 for(const s of Object.values(LT.DATA.species))if(!byShape.has(s.shape))byShape.set(s.shape,s.id);
 const revised=new Set(['futo','lunax','lunaxion','nullmie','nullva','zeroveil','pearlmi','pearlgoa','pearlseria','shimomaru','shimorei','hyogald']);
 const ids=[...new Set([...byShape.values(),'arvelion','floravelle',...revised])];let fallbackViews=0,waitingHash=null;
 for(const id of ids)for(const back of [false,true]){
  target.reset();LT.Art.creature(target.cv,id,{back,time:0});visibleInside(target.cv,`${id}: no external modules`);
  const original=target.calls.at(-1).image;
  if(revised.has(id)){
   // Authored redesigns deliberately show one neutral loading emblem. Missing
   // modules must never recreate their retired, species-specific silhouettes.
   const current=hash(rgba(original));if(waitingHash===null)waitingHash=current;else assert.equal(current,waitingHash,`${id}: expected the shared waiting emblem`);
  }else assert(original.width>GRID,'Unchanged procedural artwork retains its original source grid');
  fallbackViews++;
 }
 // A loaded display helper also handles the procedural fallback if the image
 // modules are missing. The fallback art has no dependence on uploaded sheets.
 const P=install(LT);let sampledWaitingHash=null;
 for(const id of ids){for(const back of [false,true])for(const shiny of [false,true]){
  target.reset();LT.Art.creature(target.cv,id,{back,shiny,time:0});visibleInside(target.cv,`${id}: sampled procedural fallback`);
  const drawn=target.calls.at(-1);
  if(revised.has(id)){
   assert(drawn.image.width<=P.grid&&drawn.image.height<=P.grid,'A small waiting emblem is not enlarged by the sampling helper');
   const current=hash(rgba(drawn.image));if(sampledWaitingHash===null)sampledWaitingHash=current;else assert.equal(current,sampledWaitingHash,`${id}: sampled waiting emblem stays neutral for either view and palette`);
  }else{assert.equal(drawn.image.width,P.grid);assert.equal(drawn.image.height,P.grid);}
  assert.equal(drawn.smoothing,false);fallbackViews++;
 }await settle();}
 assert.equal(JSON.stringify(LT.DATA),before.data);assert.equal(JSON.stringify(engine.state),before.save);target.cv.width=target.cv.height=1;
 console.log(`PASS no-modules and sampled procedural fallbacks: ${ids.length} species covering all ${byShape.size} shapes, ${fallbackViews} views`);
 return {fallbackSpecies:ids.length,fallbackShapes:byShape.size,fallbackViews};
}

async function main(){unitChecks();if(process.argv.includes('--unit'))return;const main=await integratedChecks();await settle();await delayedChecks();await settle();const fallback=await fallbackChecks();console.log(JSON.stringify({ok:true,grid:GRID,...main,...fallback,sourceCanvasImmutable:true,gameDataAndSaveUnchanged:true,lateArtworkUpdated:true}));}
if(!global.gc){const child=require('node:child_process').spawnSync(process.execPath,['--expose-gc',__filename,...process.argv.slice(2)],{stdio:'inherit'});process.exitCode=child.status??1;}else main().catch(error=>{console.error(error.stack);process.exitCode=1;});
