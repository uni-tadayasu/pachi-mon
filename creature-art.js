/* Pachi Monsters: original illustrated pixel sprite atlases.
 * 29 body forms + 3 mature variants, independently authored front/back views.
 * © 2026 KASAI SOLUTIONS INC.
 */
(() => {
  'use strict';
  const LT = globalThis.LT = globalThis.LT || {};
  const SIZE = 320, CACHE_LIMIT = 48;
  const groups = [
    ['sprig', 'rabbit', 'fox', 'wolf', 'cat', 'otter', 'bear', 'stag', 'goat', 'owl', 'crane', 'phoenix', 'gryphon', 'lantern', 'bat', 'beetle'],
    ['tortoise', 'golem', 'manta', 'whale', 'jelly', 'flower', 'seahorse', 'crab', 'scorpion', 'dragon', 'serpent', 'gecko', 'lizard', 'tortoise-mature', 'dragon-mature', 'serpent-mature']
  ];
  const lookup = new Map(groups.flatMap((row, group) => row.map((shape, cell) => [shape, {group, cell}])));
  const palette = {leaf: '#65ae67', tide: '#54aeca', ember: '#d67849', wind: '#92b6cc', crystal: '#b090d2'};
  const canonical = {
    sprig:'leaf',rabbit:'leaf',fox:'ember',wolf:'tide',cat:'crystal',otter:'tide',bear:'leaf',stag:'leaf',
    goat:'wind',owl:'wind',crane:'tide',phoenix:'ember',gryphon:'tide',lantern:'ember',bat:'crystal',beetle:'crystal',
    tortoise:'leaf',golem:'crystal',manta:'tide',whale:'tide',jelly:'crystal',flower:'leaf',seahorse:'tide',crab:'tide',
    scorpion:'tide',dragon:'ember',serpent:'tide',gecko:'leaf',lizard:'ember'
  };
  const cache = new Map(), sheets = new Map();
  const futoRecord={image:null,loaded:false,failed:false};
  const root = new URL('.', document.currentScript?.src || document.baseURI);
  function hash(value) { let n=2166136261; for(const c of String(value)) n=Math.imul(n^c.charCodeAt(0),16777619); return n>>>0; }
  function canvas(w, h) { const c=document.createElement('canvas'); c.width=w; c.height=h; return c; }
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function hsv(r,g,b) {
    r/=255;g/=255;b/=255;
    const hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo;
    let h=d===0?0:hi===r?((g-b)/d)%6:hi===g?(b-r)/d+2:(r-g)/d+4;
    return [((h*60)+360)%360,hi?d/hi:0,hi];
  }
  function rgb(h,s,v) {
    h=((h%360)+360)%360/60;
    const c=v*s,x=c*(1-Math.abs(h%2-1)),m=v-c;
    const q=h<1?[c,x,0]:h<2?[x,c,0]:h<3?[0,c,x]:h<4?[0,x,c]:h<5?[x,0,c]:[c,0,x];
    return q.map(n=>Math.round((n+m)*255));
  }
  function hue(hex) { const q=String(hex).match(/^#([0-9a-f]{6})$/i);return q?hsv(...q[1].match(/../g).map(x=>parseInt(x,16)))[0]:150; }
  function angular(a,b) { return ((a-b+540)%360)-180; }
  function cellRect(image, cell) {
    const x=Math.floor((cell%4)*image.naturalWidth/4), y=Math.floor(Math.floor(cell/4)*image.naturalHeight/4);
    return [x,y,Math.floor((cell%4+1)*image.naturalWidth/4)-x,Math.floor((Math.floor(cell/4)+1)*image.naturalHeight/4)-y];
  }
  function load(group, back) {
    const key=`${group}:${back?1:0}`, image=new Image();
    const record={image,loaded:false,failed:false,url:new URL(`assets/creatures-${group?'b':'a'}-${back?'back':'front'}.webp`,root).href};
    sheets.set(key,record);
    return new Promise(resolve=>{
      let settled=false,done=false;
      const release=ok=>{if(settled)return;settled=true;clearTimeout(timer);resolve(ok);};
      const finish=ok=>{
        if(done)return;done=true;
        const late=settled;
        image.onload=null;image.onerror=null;record.loaded=ok;record.failed=!ok;
        release(ok);
        if(ok&&late)document.dispatchEvent(new Event('pachi-art-ready'));
      };
      // Release startup while retaining the request and its eventual onload.
      const timer=setTimeout(()=>{record.failed=true;release(false);},18000);
      image.onload=()=>finish(image.naturalWidth>=400&&image.naturalHeight>=400);
      image.onerror=()=>finish(false);
      image.src=record.url;
    });
  }
  function loadFuto(){
    const image=futoRecord.image=new Image();
    return new Promise(resolve=>{
      let settled=false,finished=false;
      const release=ok=>{if(settled)return;settled=true;clearTimeout(timer);resolve(ok);};
      const finish=ok=>{
        if(finished)return;finished=true;
        const late=settled;futoRecord.loaded=ok;futoRecord.failed=!ok;
        image.onload=null;image.onerror=null;release(ok);
        if(ok&&late)document.dispatchEvent(new Event('pachi-art-ready'));
      };
      const timer=setTimeout(()=>{futoRecord.failed=true;release(false);},18000);
      image.onload=()=>finish(image.naturalWidth>0&&image.naturalHeight>0);
      image.onerror=()=>finish(false);
      image.src=new URL('assets/futo.png',root).href;
    });
  }
  function futoSprite(){
    if(!futoRecord.loaded)return null;
    if(cache.has('futo:original'))return cache.get('futo:original');
    const cv=canvas(SIZE,SIZE),c=cv.getContext('2d'),image=futoRecord.image;
    const scale=Math.min((SIZE-24)/image.naturalWidth,(SIZE-24)/image.naturalHeight);
    const w=Math.round(image.naturalWidth*scale),h=Math.round(image.naturalHeight*scale);
    c.imageSmoothingEnabled=false;
    // The supplied illustration is preserved for both battle positions. No
    // fabricated rear view, recoloring, or editing of the uploaded pixels.
    c.drawImage(image,Math.round((SIZE-w)/2),SIZE-12-h,w,h);
    cache.set('futo:original',cv);
    if(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);
    return cv;
  }
  function get(id, back=false) {
    const d=LT.DATA?.species?.[id];
    if(!d)return null;
    if(id==='futo')return futoSprite();
    const key=`${id}:${back?1:0}`;
    if(cache.has(key)){const cv=cache.get(key);cache.delete(key);cache.set(key,cv);return cv;}
    const stage=d.visual?.stage??(d.evolved?1:0);
    const mature=stage>=2||d.rarity==='legendary'||d.evolved;
    const shape=d.shape||'sprig';
    const variant=mature&&lookup.has(`${shape}-mature`)?`${shape}-mature`:shape;
    const location=lookup.get(variant);
    if(!location)return null;
    const record=sheets.get(`${location.group}:${back?1:0}`);
    // A missing rear sheet falls back to the legacy rear drawing, never a front sprite.
    if(!record?.loaded)return null;
    const [sx,sy,sw,sh]=cellRect(record.image,location.cell);
    const raw=canvas(sw,sh),rc=raw.getContext('2d',{willReadFrequently:true});
    rc.drawImage(record.image,sx,sy,sw,sh,0,0,sw,sh);
    const im=rc.getImageData(0,0,sw,sh),pixels=im.data,n=hash(id);
    let left=sw,top=sh,right=0,bottom=0;
    // Ignore nearly transparent fringe pixels when finding the character bounds.
    for(let y=0;y<sh;y++)for(let x=0;x<sw;x++)if(pixels[(y*sw+x)*4+3]>128){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    if(right<=left||bottom<=top)return null;
    const sourceHue=hue(palette[canonical[shape]]||palette.leaf);
    const targetHue=hue(d.color||palette[d.element]||palette.leaf);
    const rotation=angular(targetHue,sourceHue)+(n%19)-9;
    const bodyHue=canonical[shape]===d.element?rotation*.28:rotation;
    const accent=(d.accent||palette[d.element]||palette.leaf).match(/^#([0-9a-f]{6})$/i);
    const accentRGB=accent?accent[1].match(/../g).map(x=>parseInt(x,16)):[204,225,171];
    for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){
      const i=(y*sw+x)*4;
      if(pixels[i+3]<12){pixels[i+3]=0;continue;}
      const color=hsv(pixels[i],pixels[i+1],pixels[i+2]);
      // Keep ink, ivory fur, warm highlights and very bright eyes intact.
      const material=clamp((color[1]-.18)/.32,0,1)*clamp((color[2]-.15)/.25,0,1);
      if(material&&Math.abs(angular(color[0],sourceHue))<95){
        const out=rgb(color[0]+bodyHue*material,clamp(color[1]*(.94+(n%9)*.015),0,1),color[2]);
        pixels[i]=out[0];pixels[i+1]=out[1];pixels[i+2]=out[2];
      }
      // Subtle coat banding varies by species and is clipped to the existing body.
      const u=(x-left)/Math.max(1,right-left),v=(y-top)/Math.max(1,bottom-top);
      if(material>.6&&u>.27&&u<.73&&v>.56&&v<.79&&((Math.floor((u+(n%3)*v*.3)*27)+(n%7))%9===0)){
        for(let c=0;c<3;c++)pixels[i+c]=Math.round(pixels[i+c]*.9+accentRGB[c]*.1);
      }
    }
    rc.putImageData(im,0,0);
    const cv=canvas(SIZE,SIZE),c=cv.getContext('2d');c.imageSmoothingEnabled=false;
    const width=right-left+1,height=bottom-top+1;
    const scale=Math.min((mature?292:278)/width,(mature?292:278)/height);
    const dw=Math.round(width*scale*(.97+(n%7)*.01)),dh=Math.round(height*scale);
    c.drawImage(raw,left,top,width,height,Math.round((SIZE-dw)/2),SIZE-16-dh,dw,dh);
    raw.width=raw.height=1;
    cache.set(key,cv);
    if(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);
    return cv;
  }
  const ready=Promise.all([load(0,false),load(0,true),load(1,false),load(1,true),loadFuto()]);
  LT.CreatureArt={ready,get,clearCache(){cache.clear();},spriteSize:SIZE,
    forms:groups.map(row=>row.slice()),
    status(){return {loaded:[...sheets.values()].filter(s=>s.loaded).length,failed:[...sheets.values()].filter(s=>s.failed).length,futoLoaded:futoRecord.loaded,futoFailed:futoRecord.failed,cached:cache.size,cacheLimit:CACHE_LIMIT};}
  };
})();
