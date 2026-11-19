#!/usr/bin/env node
'use strict';
// Shared scenery/effect sampling with real Canvas pixels. The title decoration
// is exercised independently of page text, controls and saved game state.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const {canvas}=require('./check-art.cjs'),root=path.resolve(__dirname,'..');
const helper=fs.readFileSync(path.join(root,'scene-pixels.js'),'utf8'),backdropSource=fs.readFileSync(path.join(root,'pixel-backdrop.js'),'utf8');
const rgba=cv=>cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
function fixture(w=64,h=48){
 const cv=canvas.createCanvas(w,h),c=cv.getContext('2d'),pixels=c.createImageData(w,h),colors=[[0,0,0,0],[220,80,60,255],[48,144,96,255],[40,80,120,128]];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)pixels.data.set(colors[(x*3+y*5+Math.floor(x/7))%colors.length],(y*w+x)*4);
 c.putImageData(pixels,0,0);return cv;
}
function runtime(factory){
 const created=[],LT={DATA:{untouched:'catalog'},savedGame:{untouched:'save'}};
 const context=vm.createContext({LT,document:{createElement(tag){assert.equal(tag,'canvas');const cv=factory?factory():canvas.createCanvas(1,1);created.push(cv);return cv;}}});
 vm.runInContext(helper,context,{filename:'scene-pixels.js'});return {api:LT.ScenePixels,created,LT};
}
function state(c){
 // Native Canvas restores paint correctly, although @napi-rs/canvas's JS paint
 // getters retain the last setter. A pixel swatch below checks the actual paint.
 return JSON.stringify({alpha:c.globalAlpha,blend:c.globalCompositeOperation,filter:c.filter,font:c.font,smoothing:c.imageSmoothingEnabled,lineWidth:c.lineWidth,
  blur:c.shadowBlur,offsetX:c.shadowOffsetX,offsetY:c.shadowOffsetY,transform:Array.from(c.getTransform().toFloat64Array())});
}
function pixel(cv,x,y){return Array.from(cv.getContext('2d').getImageData(x,y,1,1).data);}

test('apply defaults to fine 2px color/alpha blocks and keeps dimensions, caller state and game objects',()=>{
 const {api,LT}=runtime(),cv=fixture(),c=cv.getContext('2d'),before=rgba(cv).slice(),game=JSON.stringify({data:LT.DATA,save:LT.savedGame});
 const palette=new Set();for(let i=0;i<before.length;i+=4)palette.add(Array.from(before.subarray(i,i+4)).join(','));
 c.translate(9,13);c.scale(1.1,1.2);c.globalAlpha=.37;c.globalCompositeOperation='screen';c.filter='blur(2px)';c.shadowBlur=3;c.shadowOffsetX=4;c.shadowOffsetY=5;c.fillStyle='#abc123';c.font='17px sans-serif';
 const prior=state(c);assert.equal(api.apply(cv),true);assert.equal(state(c),prior);assert.deepEqual([cv.width,cv.height],[64,48]);
 const after=rgba(cv);assert.notDeepEqual(after,before,'The source is sampled on the requested display grid');
 for(let y=0;y<48;y+=2)for(let x=0;x<64;x+=2){
  const cell=pixel(cv,x,y);assert(palette.has(cell.join(',')),'Sampling introduces no color/alpha blends');
  for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)assert.deepEqual(pixel(cv,x+dx,y+dy),cell);
 }
 c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.globalCompositeOperation='copy';c.filter='none';c.shadowBlur=0;c.shadowOffsetX=c.shadowOffsetY=0;c.fillRect(0,0,4,4);
 assert.deepEqual(pixel(cv,1,1),[171,193,35,255],'Native fill paint survives save/restore');
 assert.equal(JSON.stringify({data:LT.DATA,save:LT.savedGame}),game);
});

test('fine default retains original two-pixel details that the previous coarse grid loses',()=>{
 const {api,created}=runtime(),fine=canvas.createCanvas(64,48),c=fine.getContext('2d');
 c.fillStyle='#203050';c.fillRect(0,0,64,48);c.fillStyle='#efc850';for(let x=0;x<64;x+=4)c.fillRect(x,0,2,48);
 const original=rgba(fine).slice(),coarse=canvas.createCanvas(64,48);coarse.getContext('2d').drawImage(fine,0,0);
 assert(api.apply(fine));assert.deepEqual([created[0].width,created[0].height],[32,24]);assert.deepEqual(rgba(fine),original);
 assert(api.apply(coarse,{step:4}));assert.notDeepEqual(rgba(coarse),original,'Increasing resolution must recover details from the original, not enlarge its coarse sample');
});

test('apply reuses a bounded canvas per source, resizes it, and clears its cache',()=>{
 const {api,created}=runtime(),cv=fixture();assert(api.apply(cv,{step:4}));assert.equal(created.length,1);const cached=created[0];
 assert(api.apply(cv,{step:4}));assert.equal(created.length,1);assert.equal(created[0],cached);
 cv.width=96;cv.height=40;cv.getContext('2d').fillRect(0,0,96,40);assert(api.apply(cv,{long:24}));
 assert.equal(created.length,1);assert.deepEqual([cached.width,cached.height],[24,10]);assert.deepEqual([cv.width,cv.height],[96,40]);
 api.clearCache();assert(api.apply(cv,{long:24}));assert.equal(created.length,2);assert.notEqual(created[1],cached);
 const small=fixture(16,8),unchanged=rgba(small).slice();assert.equal(api.apply(small,{long:768}),false);assert.deepEqual(rgba(small),unchanged);
});

test('invalid inputs and unavailable factories leave the source usable and allow a later retry',()=>{
 const {api}=runtime();for(const source of [null,undefined,0,false,{}, {width:0,height:10},{width:Infinity,height:10}])assert.equal(api.apply(source),false);
 for(const maker of [()=>null,()=>({getContext:()=>null}),()=>{throw Error('No canvas');}]){
  const unavailable=runtime(maker).api,cv=fixture(),before=rgba(cv).slice();assert.equal(unavailable.apply(cv),false);assert.deepEqual(rgba(cv),before);
  assert.equal(unavailable.layer(cv.getContext('2d'),64,48,{step:4},()=>{}),false);
 }
 const same=fixture(),before=rgba(same).slice(),bad=runtime(()=>same).api;assert.equal(bad.apply(same),false);assert.deepEqual([same.width,same.height],[64,48]);assert.deepEqual(rgba(same),before);
 let fail=true;const retry=runtime(()=>{if(fail)throw Error('Temporary failure');return canvas.createCanvas(1,1);}).api,cv=fixture();assert.equal(retry.apply(cv),false);fail=false;assert(retry.apply(cv));
 for(const args of [[null,10,10,{},()=>{}],[{},10,10,{},()=>{}],[cv.getContext('2d'),0,10,{},()=>{}],[cv.getContext('2d'),NaN,10,{},()=>{}],[cv.getContext('2d'),10,10,{},null]])assert.equal(api.layer(...args),false);
});

test('layer clears prior transparency/clip each frame, retains coordinates and restores caller state',()=>{
 const {api,created}=runtime(),cv=canvas.createCanvas(32,16),c=cv.getContext('2d');
 assert(api.layer(c,32,16,{long:16},low=>{assert.equal(low.getTransform().a,.5);assert.equal(low.getTransform().d,.5);low.beginPath();low.rect(0,0,8,16);low.clip();low.fillStyle='#e04020';low.fillRect(0,0,32,16);}));
 assert.deepEqual(pixel(cv,2,2),[224,64,32,255]);assert.equal(pixel(cv,24,2)[3],0);c.clearRect(0,0,32,16);
 assert(api.layer(c,32,16,{long:16},low=>{low.fillStyle='#2040e0';low.fillRect(24,0,8,16);}));
 assert.equal(created.length,1);assert.equal(pixel(cv,2,2)[3],0,'Old effect pixels do not trail into the next frame');assert.deepEqual(pixel(cv,26,2),[32,64,224,255],'The prior callback clip is restored');
 c.translate(3,4);c.globalAlpha=.5;c.globalCompositeOperation='screen';c.filter='blur(1px)';c.shadowBlur=2;c.shadowOffsetX=3;c.font='19px sans-serif';const before=state(c);
 assert(api.layer(c,32,16,{long:16},low=>{low.globalAlpha=.2;low.fillStyle='#ffffff';low.fillRect(0,0,4,4);}));assert.equal(state(c),before);
 assert.throws(()=>api.layer(c,32,16,{long:16},()=>{throw Error('Interrupted effect');}),/Interrupted effect/);assert.equal(state(c),before);
 assert(api.layer(c,32,16,{long:16},()=>{}),'A throwing callback releases its layer');
 api.clearCache();assert(api.layer(c,32,16,{long:16},()=>{}));assert.equal(created.length,2);
});

test('layer rejects recursive reuse without clearing its active effect',()=>{
 const {api}=runtime(),cv=canvas.createCanvas(32,16),c=cv.getContext('2d');
 assert(api.layer(c,32,16,{long:16},low=>{
  low.fillStyle='#20c080';low.fillRect(0,0,32,16);
  assert.equal(api.layer(c,32,16,{long:16},()=>{throw Error('Should not run');}),false);
 }));assert.deepEqual(pixel(cv,2,2),[32,192,128,255]);
});

test('a fine 768px effect layer preserves thin details and leaves smaller native targets unscaled',()=>{
 const {api,created}=runtime();
 for(const [width,height]of [[1536,960],[320,200]]){
  const cv=canvas.createCanvas(width,height),c=cv.getContext('2d'),ratio=Math.min(1,768/width);
  assert(api.layer(c,width,height,{long:768},low=>{
   assert.equal(low.getTransform().a,ratio);assert.equal(low.getTransform().d,ratio);
   low.fillStyle='#f0c850';low.fillRect(20,10,2,8);
  }));
  assert.deepEqual(pixel(cv,20,10),[240,200,80,255]);assert.equal(pixel(cv,19,10)[3],0);assert.equal(pixel(cv,22,10)[3],0);
  const layer=created.at(-1);assert.deepEqual([layer.width,layer.height],[width*ratio,height*ratio]);
 }
});

async function title(mode='success'){
 const children=[],classes=new Set(),requests=[],created=[],attrs=new WeakMap();let done=Promise.resolve(),image;
 const backdrop={querySelector:()=>mode==='existing'?{}:children[0]||null,appendChild(node){children.push(node);},classList:{add(name){classes.add(name);}}};
 for(const prop of ['innerHTML','textContent'])Object.defineProperty(backdrop,prop,{set(){assert.fail('Decoration must not write DOM text');}});
 class LocalImage extends canvas.Image{
  constructor(){super();image=this;}
  set src(url){
   requests.push(url);done=new Promise(resolve=>{
    const loaded=this.onload,failed=this.onerror;
    this.onload=(...args)=>{loaded?.(...args);resolve();};this.onerror=(...args)=>{failed?.(...args);resolve();};
    if(mode==='load-failure'){queueMicrotask(()=>this.onerror(Error('Image failed')));return;}
    super.src=fs.readFileSync(path.join(root,'assets/cover-pixel.webp'));
   });
  }
 }
 const document={currentScript:{src:'https://game.example/pachi-mon/pixel-backdrop.js?v=52'},baseURI:'https://game.example/pachi-mon/',
  querySelector(selector){assert.equal(selector,'.title-backdrop');return mode==='missing'?null:backdrop;},
  createElement(tag){assert.equal(tag,'canvas');if(mode==='factory-failure')throw Error('Canvas disabled');const cv=canvas.createCanvas(1,1);attrs.set(cv,{});cv.setAttribute=(key,value)=>{attrs.get(cv)[key]=value;};if(mode==='context-failure')cv.getContext=()=>null;created.push(cv);return cv;}};
 vm.runInNewContext(backdropSource,{document,Image:LocalImage,URL,queueMicrotask},{filename:'pixel-backdrop.js'});await done;
 return {children,classes,requests,created,attrs,image};
}

test('title adds one decorative pixel canvas without writing text or game data',async()=>{
 const result=await title();assert.equal(result.requests[0],'https://game.example/pachi-mon/assets/cover-pixel.webp');assert.equal(result.children.length,1);
 const cv=result.children[0];assert.equal(Math.max(cv.width,cv.height),768);assert(Math.abs(cv.width/cv.height-result.image.naturalWidth/result.image.naturalHeight)<.01);
 const originalSample=canvas.createCanvas(cv.width,cv.height);originalSample.getContext('2d').imageSmoothingEnabled=false;originalSample.getContext('2d').drawImage(result.image,0,0,cv.width,cv.height);
 assert.deepEqual(rgba(cv),rgba(originalSample),'The finer title samples the untouched illustration directly');
 assert.equal(result.attrs.get(cv)['aria-hidden'],'true');assert(result.classes.has('pixel-backdrop-ready'));assert(rgba(cv).some(value=>value!==0));
});

test('title preserves the CSS fallback on image/canvas failure and skips absent or existing decoration',async()=>{
 for(const mode of ['load-failure','factory-failure','context-failure','missing','existing']){
  const result=await title(mode);assert.equal(result.children.length,0,mode);assert.equal(result.classes.size,0,mode);
  if(['missing','existing'].includes(mode))assert.equal(result.requests.length,0,mode);
 }
});
