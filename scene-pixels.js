/* Pachi Monsters — shared pixel grid for scenery, people and effects.
 * Derived artwork only: source files, gameplay, saves and DOM text are untouched. */
(() => {
  'use strict';
  const LT=globalThis.LT=globalThis.LT||{};
  let samples=new WeakMap(),layers=new WeakMap();

  function dimensions(width,height,options={}){
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1)return null;
    const step=Number(options.step),long=Number(options.long);
    const ratio=Number.isFinite(long)&&long>0?Math.min(1,long/Math.max(width,height)):
      Number.isFinite(step)&&step>=1?1/step:1/2;
    return {width:Math.max(1,Math.round(width*ratio)),height:Math.max(1,Math.round(height*ratio))};
  }
  function surface(source,width,height){
    const doc=source?.ownerDocument||globalThis.document;let canvas;
    if(typeof doc?.createElement==='function')canvas=doc.createElement('canvas');
    else if(typeof globalThis.OffscreenCanvas==='function')canvas=new globalThis.OffscreenCanvas(width,height);
    else if(typeof source?.getContext==='function'&&typeof source.constructor==='function')canvas=new source.constructor(width,height);
    if(!canvas||canvas===source||typeof canvas.getContext!=='function')return null;
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');return ctx?{canvas,ctx,busy:false}:null;
  }
  function entryFor(cache,source,width,height){
    let entry=cache.get(source);
    if(!entry){entry=surface(source,width,height);if(!entry)return null;cache.set(source,entry);}
    if(entry.busy)return null;
    if(entry.canvas.width!==width||entry.canvas.height!==height){entry.canvas.width=width;entry.canvas.height=height;}
    return entry;
  }
  function clean(ctx){
    ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
    ctx.imageSmoothingEnabled=false;ctx.filter='none';ctx.shadowBlur=0;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;
  }

  // Call once while constructing a cached, derived canvas. Its full dimensions
  // and the caller's drawing state stay intact; nearest sampling blends no colours.
  function apply(canvas,options={}){
    const size=dimensions(canvas?.width,canvas?.height,options);
    if(!size||typeof canvas.getContext!=='function'||size.width===canvas.width&&size.height===canvas.height)return false;
    let entry,ctx;
    try{
      ctx=canvas.getContext('2d');if(!ctx)return false;
      entry=entryFor(samples,canvas,size.width,size.height);if(!entry)return false;
      clean(entry.ctx);entry.ctx.clearRect(0,0,size.width,size.height);
      entry.ctx.drawImage(canvas,0,0,canvas.width,canvas.height,0,0,size.width,size.height);
    }catch(_){return false;}
    ctx.save();
    try{
      clean(ctx);ctx.globalCompositeOperation='copy';
      ctx.drawImage(entry.canvas,0,0,size.width,size.height,0,0,canvas.width,canvas.height);
      return true;
    }finally{ctx.restore();}
  }

  // Dynamic effects render directly to one small transparent layer per target.
  // The callback uses the original coordinate space. Labels can be painted on
  // the target afterwards at full resolution, independently of the effect grid.
  function layer(ctx,width,height,options,draw){
    const size=dimensions(width,height,options),source=ctx?.canvas;
    if(!size||!source||typeof source!=='object'||typeof draw!=='function'||typeof ctx.drawImage!=='function')return false;
    let entry;
    try{entry=entryFor(layers,source,size.width,size.height);if(!entry)return false;}
    catch(_){return false;}
    entry.busy=true;entry.ctx.save();
    try{
      clean(entry.ctx);entry.ctx.clearRect(0,0,size.width,size.height);
      entry.ctx.setTransform(size.width/width,0,0,size.height/height,0,0);
      draw(entry.ctx);
      ctx.save();
      try{
        ctx.imageSmoothingEnabled=false;ctx.filter='none';ctx.shadowBlur=0;ctx.shadowOffsetX=0;ctx.shadowOffsetY=0;
        ctx.drawImage(entry.canvas,0,0,size.width,size.height,0,0,width,height);
      }finally{ctx.restore();}
      return true;
    }finally{entry.ctx.restore();entry.busy=false;}
  }
  function clearCache(){samples=new WeakMap();layers=new WeakMap();}
  LT.ScenePixels=Object.freeze({apply,layer,clearCache});
})();
