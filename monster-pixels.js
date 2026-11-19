/* Pachi Monsters — one crisp display grid for every original creature sprite. */
(() => {
  'use strict';
  const LT=globalThis.LT=globalThis.LT||{},GRID=80;
  let cache=new WeakMap();
  function surface(source,width,height){
    const doc=source.ownerDocument||globalThis.document;let canvas;
    if(typeof doc?.createElement==='function')canvas=doc.createElement('canvas');
    else if(typeof globalThis.OffscreenCanvas==='function')canvas=new globalThis.OffscreenCanvas(width,height);
    else if(typeof source.getContext==='function'&&typeof source.constructor==='function')canvas=new source.constructor(width,height);
    if(!canvas||canvas===source||typeof canvas.getContext!=='function')return null;
    canvas.width=width;canvas.height=height;return canvas;
  }
  // All game sprite cells are square, so they become 80×80. A smaller native
  // sprite keeps its own pixels; rectangular inputs keep their aspect ratio.
  // The source's colour, transparency and view box are sampled without edits.
  function get(source){
    if(!source||(typeof source!=='object'&&typeof source!=='function'))return source;
    try{
      const width=source.width,height=source.height;
      if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0){cache.delete(source);return source;}
      const previous=cache.get(source);
      if(previous?.width===width&&previous?.height===height)return previous.canvas;
      cache.delete(source);
      if(Math.max(width,height)<=GRID)return source;
      const scale=GRID/Math.max(width,height),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
      const canvas=surface(source,w,h),c=canvas?.getContext('2d');if(!c)return source;
      c.imageSmoothingEnabled=false;c.drawImage(source,0,0,width,height,0,0,w,h);
      cache.set(source,{width,height,canvas});return canvas;
    }catch(_){cache.delete(source);return source;}
  }
  // Sprite cells are immutable snapshots. Clearing the renderer, resizing a
  // source or replacing it after an image load always allows a fresh sample.
  function clearCache(){cache=new WeakMap();}
  const api=Object.freeze({grid:GRID,get,clearCache});LT.MonsterPixels=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})();
