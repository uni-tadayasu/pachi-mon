#!/usr/bin/env node
'use strict';
// Two-mode migration and full-resolution monochrome, including browsers that
// have no Canvas filter implementation. Does not need a browser DOM or SVG.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {canvas}=require('./check-art.cjs');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','retro-screen.js'),'utf8'),context);
const retro=context.LT.RetroScreen,removed=['pocket','dot','leaf','sepia','night','glitch'];
assert.deepEqual(Array.from(retro.order),['color','mono']);
assert.deepEqual(Object.keys(retro.modes),['color','mono']);
assert.equal(retro.defaultMode,'color');assert.equal(retro.label('color'),'カラー');assert.equal(retro.label('mono'),'モノクロ');
assert.equal(retro.next('color'),'mono');assert.equal(retro.next('mono'),'color');
assert.equal(retro.isMode('color'),true);assert.equal(retro.isMode('mono'),true);
for(const id of [...removed,'unknown','toString',null,undefined]){
  assert.equal(retro.isMode(id),false,`${id}: removed or unknown mode is still selectable`);
  assert.equal(retro.next(id),'color',`${id}: invalid mode did not recover to colour`);
  assert.equal(retro.label(id),'カラー');
}
assert(Object.isFrozen(retro)&&Object.isFrozen(retro.modes)&&Object.isFrozen(retro.order));
for(const screen of ['color','mono',...removed,'unknown',null,undefined]){
  for(const screenExplicit of [false,true]){
    for(const screenVersion of [undefined,1,2,3]){
      const saved={screen,screenExplicit,screenVersion,sound:false,volume:.21,quality:'low',textSpeed:'fast',autoRun:true,crt:false,glitchUnlocked:true};
      const before=JSON.stringify(saved),result=retro.preference(saved),merged={...saved,...result};
      assert.equal(result.screen,screen==='mono'?'mono':'color');assert.equal(result.screenVersion,3);
      assert.equal(result.screenExplicit,screenExplicit);assert.equal(JSON.stringify(saved),before,'Migration mutated the input');
      assert.deepEqual(Object.keys(result).sort(),['screen','screenExplicit','screenVersion']);
      for(const key of ['sound','volume','quality','textSpeed','autoRun','crt','glitchUnlocked'])assert.equal(merged[key],saved[key],`Migration replaced ${key}`);
      assert.equal(retro.preference(merged).screen,merged.screen,'Migration was not stable on reload');
    }
  }
}
assert.equal(retro.preference().screen,'color');assert.equal(retro.preference(null).screen,'color');
for(const size of [24,42,54,60,64,88,160,200,260,5000]){
  const color=retro.portraitRaster('color',size),mono=retro.portraitRaster('mono',size);
  assert.equal(mono,color,`${size}px portrait loses detail in monochrome`);assert(color>=128&&color<=512);
}
assert.equal(retro.portraitRaster('color',54),128);assert.equal(retro.portraitRaster('mono',160),320);assert.equal(retro.portraitRaster('mono',260),512);

const cv=canvas.createCanvas(768,480),ctx=cv.getContext('2d'),source=ctx.createImageData(cv.width,cv.height);
for(let y=0;y<cv.height;y++)for(let x=0;x<cv.width;x++){
  const i=(y*cv.width+x)*4;
  // One-pixel alternating detail and all 256 grey shades are finer than the
  // removed 300-dot grid; alpha also exercises edges and translucent effects.
  source.data.set(y<2?[x%256,x%256,x%256,255]:[(x*73+y*17)%256,(x*19+y*67)%256,(x*157+y*29)%256,[0,51,102,153,204,255][(x+y)%6]],i);
}
ctx.putImageData(source,0,0);
const original=ctx.getImageData(0,0,cv.width,cv.height).data.slice();
// An unsupported filter must not silently leave a colour picture behind.
Object.defineProperty(ctx,'filter',{configurable:true,get(){throw Error('Canvas filter unavailable');},set(){throw Error('Canvas filter unavailable');}});
assert.equal(retro.apply(cv,'color'),false);assert.deepEqual(ctx.getImageData(0,0,cv.width,cv.height).data,original,'Colour changed original pixels');
for(const id of removed)assert.equal(retro.apply(cv,id),false,'Removed preset still modifies the picture');
ctx.setTransform(1.3,0,0,.7,14,27);ctx.globalAlpha=.31;ctx.globalCompositeOperation='destination-in';
const transform=ctx.getTransform(),beforeState=[ctx.globalAlpha,ctx.globalCompositeOperation];
assert.equal(retro.apply(cv,'mono'),true,'Monochrome needs Canvas filter support');
assert.equal(cv.width,768);assert.equal(cv.height,480);
const actual=ctx.getImageData(0,0,cv.width,cv.height).data;
const shades=new Set();
for(let i=0;i<actual.length;i+=4){
  assert.equal(actual[i+3],original[i+3],`Monochrome moved or changed alpha at ${i/4}`);
  if(!actual[i+3])continue;
  assert.equal(actual[i],actual[i+1]);assert.equal(actual[i+1],actual[i+2]);
  if(original[i+3]===255){
    const expected=Math.round(original[i]*.2126+original[i+1]*.7152+original[i+2]*.0722);
    assert.equal(actual[i],expected,`Pixel ${i/4} was resampled or quantized`);
  }
  if(i<256*4)shades.add(actual[i]);
}
assert.equal(shades.size,256,'Monochrome discarded grey shades');
assert.deepEqual([ctx.globalAlpha,ctx.globalCompositeOperation],beforeState,'Fallback changed drawing state');
const afterTransform=ctx.getTransform();for(const key of ['a','b','c','d','e','f'])assert.equal(afterTransform[key],transform[key]);
assert.equal(retro.apply(null,'mono'),false);assert.equal(retro.apply({width:0,height:0},'mono'),false);
assert.equal(retro.apply({width:1,height:1,getContext:()=>({getImageData(){throw Error('SecurityError');}})},'mono'),false,'Tainted canvas crashed instead of retaining CSS display fallback');
console.log(JSON.stringify({ok:true,modes:Array.from(retro.order),defaultMode:retro.defaultMode,legacyMigration:true,settingsPreserved:true,monochromeWithoutCanvasFilter:true,monochromeDimensions:[cv.width,cv.height],monochromeShades:shades.size,onePixelDetailsPreserved:true,alphaPreserved:true,portraitResolutionEqual:true},null,2));
