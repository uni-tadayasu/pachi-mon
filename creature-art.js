/* Pachi Monsters: original illustrated pixel sprite atlases.
 * Original body forms and two lineage-preserving evolved forms, front/back views.
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
  // EVOLUTION_FRAMES_START
  // Measured source rectangles retain entire figures when generated atlas
  // positions differ slightly from the nominal grid. Optional crop-local
  // rectangles exclude only pixels belonging to an adjacent sprite at a
  // diagonal gutter; detached crystals belonging to this sprite remain.
  const evolutionFrames={
    "0:1:0":{"size":[1254,1254],"frames":[[20,9,270,294],[324,9,273,292],[626,9,300,292],[950,9,294,289],[7,318,299,293],[314,345,303,265],[626,320,306,291],[949,311,301,304],[12,625,270,303],[311,625,314,300,[[1,168,1,3],[1,172,1,1]]],[635,632,278,297],[932,629,318,301,[[6,252,1,1]]],[7,945,299,291],[316,951,305,273],[622,946,316,280],[939,946,315,287,[[0,170,1,1]]]]},
    "1:1:0":{"size":[1254,1254],"frames":[[10,0,290,301],[318,7,306,292],[632,15,299,286],[943,11,307,290],[10,319,287,298],[328,317,278,301],[641,315,251,302],[933,328,320,270],[10,632,300,276],[314,628,303,280],[627,628,304,288],[942,636,303,274],[3,941,299,289],[315,930,307,305],[624,932,313,295],[945,929,305,302]]},
    "0:1:1":{"size":[1254,1254],"frames":[[73,32,202,260],[371,28,200,262],[664,34,241,253],[982,34,233,255],[52,341,231,256],[356,356,235,240],[670,343,236,255],[969,334,243,269],[51,649,221,262],[360,652,224,253],[680,652,215,256],[972,653,248,260],[51,963,232,252],[339,966,253,238],[654,957,249,246],[976,965,246,249]]},
    "1:1:1":{"size":[1254,1254],"frames":[[31,20,258,267],[332,19,259,270],[648,36,263,254],[957,31,273,260],[34,334,260,272],[341,325,250,275],[669,328,229,276],[936,338,295,253],[29,642,259,258],[336,634,267,272],[648,637,260,270],[954,651,275,254],[29,949,266,274],[328,946,270,277],[642,946,261,277],[952,946,277,277]]},
    "0:2:0":{"size":[1254,1254],"frames":[[10,6,301,298],[320,9,295,293],[622,5,312,297],[942,11,311,293],[3,315,306,299],[318,322,304,290],[633,313,301,302],[939,313,312,301],[8,626,295,297],[310,627,317,300],[628,628,293,304],[927,627,327,309,[[13,72,1,1],[12,128,1,1],[9,130,1,1],[12,222,1,1],[11,224,1,1]]],[4,940,307,299],[315,947,306,293],[622,944,316,295,[[315,200,1,2],[314,202,2,6],[313,208,3,10],[314,218,2,3],[315,221,1,1]]],[935,940,316,300,[[0,99,1,4],[0,103,2,5],[0,108,3,11]]]]},
    "1:2:0":{"size":[1254,1254],"frames":[[7,6,294,293],[322,6,296,294],[628,18,309,284],[949,6,297,298],[9,313,288,300],[318,315,298,298],[639,315,279,299],[941,316,311,292],[8,631,298,279],[315,628,308,274,[[307,126,1,3],[306,129,2,4],[307,133,1,7]]],[621,628,314,282,[[0,240,1,3],[0,243,2,9],[0,252,1,1]]],[941,630,310,279],[2,928,308,306],[316,919,306,312],[629,924,308,306],[942,923,311,309]]},
    "0:2:1":{"size":[1254,1254],"frames":[[30,10,264,292],[340,11,266,290],[644,15,277,284],[960,16,274,284],[35,323,270,278],[334,325,280,280],[644,319,274,289],[955,320,288,287],[39,626,256,296],[331,624,283,298],[640,629,282,292],[943,629,299,297],[19,947,287,291],[323,949,290,282],[630,953,294,282],[944,947,291,291]]},
    "1:2:1":{"size":[1254,1254],"frames":[[50,44,221,232],[356,44,226,231],[668,56,230,223],[975,46,237,231],[45,349,229,242],[355,345,227,242],[671,352,216,235],[973,352,247,234],[48,660,220,212],[352,662,229,213],[662,660,233,213],[983,660,228,216],[48,954,223,220],[353,950,227,226],[658,955,238,221],[983,953,229,218]]}
  };
  // EVOLUTION_FRAMES_END
  const palette = {leaf: '#65ae67', tide: '#54aeca', ember: '#d67849', wind: '#92b6cc', crystal: '#b090d2'};
  const canonical = {
    sprig:'leaf',rabbit:'leaf',fox:'ember',wolf:'tide',cat:'crystal',otter:'tide',bear:'leaf',stag:'leaf',
    goat:'wind',owl:'wind',crane:'tide',phoenix:'ember',gryphon:'tide',lantern:'ember',bat:'crystal',beetle:'crystal',
    tortoise:'leaf',golem:'crystal',manta:'tide',whale:'tide',jelly:'crystal',flower:'leaf',seahorse:'tide',crab:'tide',
    scorpion:'tide',dragon:'ember',serpent:'tide',gecko:'leaf',lizard:'ember'
  };
  const cache = new Map(), sheets = new Map(), evolutionSheets = new Map();
  const lineages = new Map();
  let lineageSource = null, lineageSize = -1;
  function lineage(id) {
    const species=LT.DATA?.species||{},size=Object.keys(species).length;
    if(lineageSource!==species||lineageSize!==size){
      lineageSource=species;lineageSize=size;lineages.clear();
      const parents=new Map();
      for(const [parent,d] of Object.entries(species))if(d.evolvesTo&&species[d.evolvesTo]&&!parents.has(d.evolvesTo))parents.set(d.evolvesTo,parent);
      for(const [key,d] of Object.entries(species)){
        let ancestor=key,depth=0;
        const seen=new Set([key]);
        while(parents.has(ancestor)&&!seen.has(parents.get(ancestor))){ancestor=parents.get(ancestor);seen.add(ancestor);depth++;}
        const original=species[ancestor]||d;
        // The graph is authoritative: rarity and evolved labels alone never
        // move an unrelated, standalone monster onto an evolution sheet.
        lineages.set(key,Object.freeze({rootId:ancestor,shape:original.shape||'sprig',stage:Math.min(2,depth),depth}));
      }
    }
    return lineages.get(id)||null;
  }
  function evolutionKey(location,stage,back){return `${location.group}:${stage}:${back?1:0}`;}
  function requestEvolution(location,stage,back){
    const key=evolutionKey(location,stage,back);
    if(!evolutionSheets.has(key)){
      const url=new URL(`assets/creatures-evolution-${location.group?'b':'a'}-${stage}-${back?'back':'front'}.webp`,root).href;
      loadAtlas(evolutionSheets,key,url,true);
    }
    return evolutionSheets.get(key);
  }
  function preload(ids,{back=false}={}){
    const requests=[];
    for(const id of typeof ids==='string'?[ids]:ids||[]){
      const family=lineage(id),location=family&&lookup.get(family.shape);
      if(!family?.stage||!location)continue;
      for(const rear of back==='both'?[false,true]:[!!back])requests.push(requestEvolution(location,family.stage,rear).promise);
    }
    return Promise.all(requests);
  }
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
  function loadAtlas(collection,key,url,notify=false) {
    const image=new Image(),record={image,loaded:false,failed:false,url,promise:null,frames:notify?evolutionFrames[key]:null};
    collection.set(key,record);
    record.promise=new Promise(resolve=>{
      let settled=false,done=false;
      const release=ok=>{if(settled)return;settled=true;clearTimeout(timer);resolve(ok);};
      const finish=ok=>{
        if(done)return;done=true;
        const late=settled;
        image.onload=null;image.onerror=null;record.loaded=ok;record.failed=!ok;
        release(ok);
        if(ok&&(late||notify)){
          cache.clear();
          document.dispatchEvent(new Event('pachi-art-ready'));
        }
      };
      // Release startup/preload callers while retaining eventual image recovery.
      const timer=setTimeout(()=>{record.failed=true;release(false);},18000);
      image.onload=()=>finish(image.naturalWidth>=400&&image.naturalHeight>=400);
      image.onerror=()=>finish(false);
      image.src=record.url;
    });
    return record.promise;
  }
  function load(group,back){
    return loadAtlas(sheets,`${group}:${back?1:0}`,new URL(`assets/creatures-${group?'b':'a'}-${back?'back':'front'}.webp`,root).href);
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
    // Futo currently has only the supplied front illustration. Keep that
    // illustration intact; supportsBack() explicitly reports this limitation.
    c.drawImage(image,Math.round((SIZE-w)/2),SIZE-12-h,w,h);
    cache.set('futo:original',cv);
    if(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);
    return cv;
  }
  function getBase(id, back=false) {
    const d=LT.DATA?.species?.[id];
    if(!d)return null;
    if(id==='futo')return futoSprite();
    const family=lineage(id),stage=family?.stage||0;
    const shape=stage?family.shape:d.shape||'sprig';
    const mature=stage>0||d.rarity==='legendary'||d.evolved;
    const baseVariant=mature&&lookup.has(`${shape}-mature`)?`${shape}-mature`:shape;
    let location=lookup.get(baseVariant),record=location&&sheets.get(`${location.group}:${back?1:0}`);
    if(stage){
      const evolvedLocation=lookup.get(shape);
      if(evolvedLocation){
        const evolvedRecord=requestEvolution(evolvedLocation,stage,back);
        if(evolvedRecord.loaded){location=evolvedLocation;record=evolvedRecord;}
      }
    }
    // During download, retain the family root's illustrated form rather than
    // borrowing the silhouette of an unrelated species. A failed view never
    // silently substitutes a front image for a rear image.
    if(!location)return null;
    const key=`${id}:${back?1:0}`;
    if(cache.has(key)){const cv=cache.get(key);cache.delete(key);cache.set(key,cv);return cv;}
    // A missing rear sheet falls back to the legacy rear drawing, never a front sprite.
    if(!record?.loaded)return null;
    const metadata=record.frames,frame=metadata?.frames[location.cell];
    const factorX=metadata?record.image.naturalWidth/metadata.size[0]:1,factorY=metadata?record.image.naturalHeight/metadata.size[1]:1;
    const [sx,sy,sw,sh]=frame?[Math.floor(frame[0]*factorX),Math.floor(frame[1]*factorY),Math.ceil(frame[2]*factorX),Math.ceil(frame[3]*factorY)]:cellRect(record.image,location.cell);
    const raw=canvas(sw,sh),rc=raw.getContext('2d',{willReadFrequently:true});
    rc.drawImage(record.image,sx,sy,sw,sh,0,0,sw,sh);
    for(const [x,y,w,h] of frame?.[4]||[])rc.clearRect(x*factorX,y*factorY,w*factorX,h*factorY);
    const im=rc.getImageData(0,0,sw,sh),pixels=im.data,n=hash(stage?family.rootId:id);
    const original=stage?LT.DATA.species[family.rootId]:d;
    let left=sw,top=sh,right=0,bottom=0;
    // Ignore nearly transparent fringe pixels when finding the character bounds.
    for(let y=0;y<sh;y++)for(let x=0;x<sw;x++)if(pixels[(y*sw+x)*4+3]>128){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    if(right<=left||bottom<=top)return null;
    const sourceHue=hue(palette[canonical[shape]]||palette.leaf);
    // Keep the original coat color and variation seed through each evolution;
    // the stage's accent can develop without turning the family another color.
    const targetHue=hue(original.color||palette[original.element]||palette.leaf);
    const rotation=angular(targetHue,sourceHue)+(n%19)-9;
    const bodyHue=canonical[shape]===original.element?rotation*.28:rotation;
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
    const extent=stage===2?298:stage===1?290:mature?292:278;
    const scale=Math.min(extent/width,extent/height);
    const dw=Math.round(width*scale*(.97+(n%7)*.01)),dh=Math.round(height*scale);
    c.drawImage(raw,left,top,width,height,Math.round((SIZE-dw)/2),SIZE-16-dh,dw,dh);
    raw.width=raw.height=1;
    cache.set(key,cv);
    if(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);
    return cv;
  }
  // Shiny coats are an instance property, never a change to shared species
  // data. A family keeps one alternate palette through every evolution/view.
  function alternate(source,id){
    const cv=canvas(SIZE,SIZE),c=cv.getContext('2d',{willReadFrequently:true});
    c.drawImage(source,0,0);
    const im=c.getImageData(0,0,SIZE,SIZE),p=im.data;
    const turn=130+hash(lineage(id)?.rootId||id)%91;
    for(let i=0;i<p.length;i+=4){
      if(p[i+3]<12)continue;
      const [h,s,v]=hsv(p[i],p[i+1],p[i+2]);
      // Preserve dark ink, white clothing and eye glints. The alternate
      // colored materials retain their authored luminance and shading.
      if(v<.16||(s<.13&&v>.84))continue;
      const color=rgb(h+turn,clamp(s<.18?s+.16:s*.92+.08,0,1),clamp(v*1.025,0,1));
      p[i]=color[0];p[i+1]=color[1];p[i+2]=color[2];
    }
    c.putImageData(im,0,0);return cv;
  }
  function get(id,back=false,options={}){
    if(!options.shiny)return getBase(id,back);
    const key=`${id}:${back?1:0}:shiny`;
    if(cache.has(key)){const cv=cache.get(key);cache.delete(key);cache.set(key,cv);return cv;}
    const original=getBase(id,back);if(!original)return null;
    const cv=alternate(original,id);cache.set(key,cv);
    if(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);
    return cv;
  }
  const ready=Promise.all([load(0,false),load(0,true),load(1,false),load(1,true),loadFuto()]);
  LT.CreatureArt={ready,get,preload,lineage,alternate,supportsBack:id=>id!=='futo',clearCache(){cache.clear();},spriteSize:SIZE,
    forms:groups.map(row=>row.slice()),
    status(){return {loaded:[...sheets.values()].filter(s=>s.loaded).length,failed:[...sheets.values()].filter(s=>s.failed).length,evolutionRequested:evolutionSheets.size,evolutionLoaded:[...evolutionSheets.values()].filter(s=>s.loaded).length,evolutionFailed:[...evolutionSheets.values()].filter(s=>s.failed).length,
      futoLoaded:futoRecord.loaded,futoFailed:futoRecord.failed,cached:cache.size,cacheLimit:CACHE_LIMIT};}
  };
})();
