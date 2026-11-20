/* Pachi Monsters — bolder ink and a shared, coarse display grid for every creature. */
(() => {
  'use strict';
  const LT=globalThis.LT=globalThis.LT||{},GRID=112;
  let cache=new WeakMap();
  const styled=new WeakSet();
  function surface(source,width,height){
    const doc=source.ownerDocument||globalThis.document;let canvas;
    if(typeof doc?.createElement==='function')canvas=doc.createElement('canvas');
    else if(typeof globalThis.OffscreenCanvas==='function')canvas=new globalThis.OffscreenCanvas(width,height);
    else if(typeof source.getContext==='function'&&typeof source.constructor==='function')canvas=new source.constructor(width,height);
    if(!canvas||canvas===source||typeof canvas.getContext!=='function')return null;
    canvas.width=width;canvas.height=height;return canvas;
  }
  // Shade only occupied pixels. Darkening the inside of the silhouette keeps
  // thin horns, tails and translucent parts at their original sampled alpha.
  // Motif edges use the darker side of an existing contrast boundary: there
  // are no invented markings, black halos or dilation into empty space.
  function strengthenInk(c,width,height){
    const frame=c.getImageData(0,0,width,height),pixels=frame.data,original=new Uint8ClampedArray(pixels);
    const light=new Float32Array(width*height);
    for(let p=0,i=0;p<light.length;p++,i+=4)light[p]=original[i]*.2126+original[i+1]*.7152+original[i+2]*.0722;
    const opaque=p=>p>=0&&p<light.length&&original[p*4+3]>=24;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const p=y*width+x,i=p*4;if(!original[i+3])continue;
      const neighbors=[x>0?p-1:-1,x+1<width?p+1:-1,y>0?p-width:-1,y+1<height?p+width:-1];
      let rim=false,brighter=light[p];
      for(const next of neighbors){if(!opaque(next))rim=true;else brighter=Math.max(brighter,light[next]);}
      // A common multiplier retains each material's hue. Bright eye glints,
      // fur and cream details stay light while existing shadows gain weight.
      const luminance=light[p],tone=Math.max(.45,Math.min(1.08,(luminance*1.14-25)/(luminance||1)));
      const detail=luminance<190?Math.min(.22,Math.max(0,brighter-luminance-24)/170):0;
      const ink=[25,21,35];
      for(let channel=0;channel<3;channel++){
        const value=original[i+channel]*tone*(1-detail);
        pixels[i+channel]=rim?Math.round(value*.28+ink[channel]*.72):Math.round(value);
      }
      // Alpha is intentionally untouched, including partially transparent ink.
    }
    c.putImageData(frame,0,0);
  }
  // Square game cells become 112×112. Smaller sources are never enlarged;
  // rectangular sources retain their aspect ratio. The source stays immutable.
  function get(source){
    if(!source||(typeof source!=='object'&&typeof source!=='function'))return source;
    try{
      if(styled.has(source))return source;
      const width=source.width,height=source.height;
      if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0){cache.delete(source);return source;}
      const previous=cache.get(source);
      if(previous?.width===width&&previous?.height===height)return previous.canvas;
      cache.delete(source);
      const scale=Math.min(1,GRID/Math.max(width,height)),w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
      const canvas=surface(source,w,h),c=canvas?.getContext('2d');if(!c)return source;
      c.imageSmoothingEnabled=false;c.drawImage(source,0,0,width,height,0,0,w,h);
      strengthenInk(c,w,h);styled.add(canvas);
      cache.set(source,{width,height,canvas});return canvas;
    }catch(_){cache.delete(source);return source;}
  }
  // Sprite cells are immutable snapshots. Clearing the renderer, resizing a
  // source or replacing it after an image load always allows a fresh sample.
  function clearCache(){cache=new WeakMap();}
  const api=Object.freeze({grid:GRID,get,clearCache});LT.MonsterPixels=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})();
