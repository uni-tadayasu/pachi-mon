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
  // Audited against the 12 authored sheets, in the same cell order as groups.
  // +1 faces screen-right, -1 faces screen-left; 0 is a neutral/radial pose.
  // Rear views have their own gaze: mirroring a front view is never a rear view.
  const authoredDirections=Object.freeze({
    '0:0:0':Object.freeze([1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]),
    '0:0:1':Object.freeze([-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,0,-1]),
    '1:0:0':Object.freeze([1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1]),
    '1:0:1':Object.freeze([-1,-1,-1,-1,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1]),
    '0:1:0':Object.freeze([1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]),
    '0:1:1':Object.freeze([-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1]),
    '1:1:0':Object.freeze([1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1]),
    '1:1:1':Object.freeze([-1,-1,-1,-1,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1]),
    '0:2:0':Object.freeze([1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]),
    '0:2:1':Object.freeze([-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,0,-1,-1]),
    '1:2:0':Object.freeze([1,1,1,1,0,1,1,1,1,1,1,1,1,1,1,1]),
    '1:2:1':Object.freeze([-1,-1,-1,-1,0,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1])
  });
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
  const cache = new Map(), sheets = new Map(), evolutionSheets = new Map(), uniqueSheets = new Map(), revisedSheets = new Map();
  // Each new atlas contains independently authored front/rear pairs. Row order
  // is explicit so an evolved form can never borrow its predecessor's image.
  // Shared files are requested once, on demand, including both rear/front views.
  const revisedArt=Object.freeze({
    nullmie:{file:'assets/original-null-line-v67.png',row:0,rows:3,stage:0,nativeSize:[1024,1536],front:[0,0,512,376],back:[512,0,512,376]},
    nullva:{file:'assets/original-null-line-v67.png',row:1,rows:3,stage:1,nativeSize:[1024,1536],front:[0,376,512,440],back:[512,376,512,440]},
    zeroveil:{file:'assets/original-null-line-v67.png',row:2,rows:3,stage:2,nativeSize:[1024,1536],front:[0,816,512,720],back:[512,816,512,720]},
    shimomaru:{file:'assets/original-tide-line-v67.png',row:0,rows:3,stage:0},
    shimorei:{file:'assets/original-tide-line-v67.png',row:1,rows:3,stage:1},
    hyogald:{file:'assets/original-tide-line-v67.png',row:2,rows:3,stage:2},
    pearlmi:{file:'assets/original-pearl-line-v67.png',row:0,rows:3,stage:0,nativeSize:[1199,1312],front:[0,0,599,385],back:[599,0,600,385],frontDirection:-1,backDirection:1},
    pearlgoa:{file:'assets/original-pearl-line-v67.png',row:1,rows:3,stage:1,nativeSize:[1199,1312],front:[0,385,599,330],back:[599,385,600,330],frontDirection:-1,backDirection:1},
    pearlseria:{file:'assets/original-pearl-line-v67.png',row:2,rows:3,stage:2,nativeSize:[1199,1312],front:[0,715,599,597],back:[599,715,600,597],frontDirection:-1,backDirection:1},
    galdoras:{file:'assets/original-galdoras-v67.png',row:0,rows:1,stage:0},
    futo:{file:'assets/original-futo-v67.png',row:0,rows:1,stage:0,frontDirection:-1,backDirection:1}
  });
  for(const entry of Object.values(revisedArt)){for(const value of Object.values(entry))if(Array.isArray(value))Object.freeze(value);Object.freeze(entry);}
  const revisedIds=Object.freeze(Object.keys(revisedArt));
  const revisedIdsByFile=new Map();
  for(const [id,entry] of Object.entries(revisedArt)){
    if(!revisedIdsByFile.has(entry.file))revisedIdsByFile.set(entry.file,[]);
    revisedIdsByFile.get(entry.file).push(id);
  }
  const hasRevised=id=>Object.hasOwn(revisedArt,id);
  // These two unchanged rock forms keep their existing dedicated views.
  const offDexArt=Object.freeze({
    rurikoro:{file:'assets/offdex-v54-07.png',stage:0},
    rurigorm:{file:'assets/offdex-v54-08.png',stage:1}
  });
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
  function requestRevised(id){
    const entry=revisedArt[id];
    if(!revisedSheets.has(entry.file))loadAtlas(revisedSheets,entry.file,new URL(entry.file,root).href,true,revisedIdsByFile.get(entry.file));
    return revisedSheets.get(entry.file);
  }
  function requestOffDex(id){
    if(!uniqueSheets.has(id))loadAtlas(uniqueSheets,id,new URL(offDexArt[id].file,root).href,true);
    return uniqueSheets.get(id);
  }
  function preload(ids,{back=false}={}){
    const requests=[];
    for(const id of typeof ids==='string'?[ids]:ids||[]){
      if(hasRevised(id)&&LT.DATA?.species?.[id]){requests.push(requestRevised(id).promise);continue;}
      if(id==='arvelion'||id==='floravelle'){const record=uniqueSheets.get(id);if(record)requests.push(record.promise);continue;}
      if(offDexArt[id]&&LT.DATA?.species?.[id]){requests.push(requestOffDex(id).promise);continue;}
      const family=lineage(id),location=family&&lookup.get(family.shape);
      if(!family?.stage||!location)continue;
      for(const rear of back==='both'?[false,true]:[!!back])requests.push(requestEvolution(location,family.stage,rear).promise);
    }
    return Promise.all(requests);
  }
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
  function loadAtlas(collection,key,url,notify=false,speciesIds=null) {
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
          const event=new Event('pachi-art-ready');
          if(speciesIds)event.speciesIds=speciesIds.slice();
          document.dispatchEvent(event);
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
  function revisedCell(entry,back,image){
    // Measured frames may override the nominal grid when generated figures
    // occupy uneven cells. Values are in nativeSize pixels, front/rear separate.
    const frame=entry[back?'back':'front'],size=entry.nativeSize;
    if(frame){
      if(!Array.isArray(frame)||frame.length!==4||!Array.isArray(size)||size.length!==2||
        ![...frame,...size].every(Number.isFinite)||frame[2]<=0||frame[3]<=0||size.some(n=>n<=0))return null;
      const fx=image.naturalWidth/size[0],fy=image.naturalHeight/size[1];
      const x=clamp(Math.floor(frame[0]*fx),0,image.naturalWidth),y=clamp(Math.floor(frame[1]*fy),0,image.naturalHeight);
      const right=clamp(Math.ceil((frame[0]+frame[2])*fx),0,image.naturalWidth),bottom=clamp(Math.ceil((frame[1]+frame[3])*fy),0,image.naturalHeight);
      return right>x&&bottom>y?[x,y,right-x,bottom-y]:null;
    }
    const column=back?1:0,sx=Math.floor(column*image.naturalWidth/2),sy=Math.floor(entry.row*image.naturalHeight/entry.rows);
    return [sx,sy,Math.floor((column+1)*image.naturalWidth/2)-sx,Math.floor((entry.row+1)*image.naturalHeight/entry.rows)-sy];
  }
  function revisedFrame(record,entry,back){
    const key=`${entry.row}:${back?1:0}`;
    const frames=record.sourceFrames||(record.sourceFrames=new Map());
    if(frames.has(key))return frames.get(key);
    const image=record.image,cell=revisedCell(entry,back,image);
    if(!cell){frames.set(key,null);return null;}
    const [sx,sy,sw,sh]=cell;
    const raw=canvas(sw,sh),rc=raw.getContext('2d',{willReadFrequently:true});
    rc.drawImage(image,sx,sy,sw,sh,0,0,sw,sh);
    const pixels=rc.getImageData(0,0,sw,sh).data;
    let left=sw,right=-1,top=sh,bottom=-1;
    // Inspect only this cell; ignore nearly transparent fringe in its bounds.
    // Do not recolor, erase, or reconstruct any pixels from the source PNG.
    for(let i=3;i<pixels.length;i+=4)if(pixels[i]>12){
      const p=(i-3)/4,x=p%sw,y=Math.floor(p/sw);
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
    }
    const frame=right>=left&&bottom>=top?[sx+left,sy+top,right-left+1,bottom-top+1]:null;
    frames.set(key,frame);raw.width=raw.height=1;return frame;
  }
  function revisedSprite(id,back=false){
    const entry=revisedArt[id],record=requestRevised(id);
    // Pending/error states must never redisplay the retired character artwork.
    // The portrait renderer supplies a neutral waiting emblem for these IDs.
    if(!record.loaded)return null;
    const key=`${id}:${back?1:0}`;
    if(cache.has(key)){const cv=cache.get(key);cache.delete(key);cache.set(key,cv);return cv;}
    const frame=revisedFrame(record,entry,back);if(!frame)return null;
    const scale=Math.min((SIZE-24)/frame[2],(SIZE-24)/frame[3]);
    const width=Math.max(1,Math.round(frame[2]*scale)),height=Math.max(1,Math.round(frame[3]*scale));
    const cv=canvas(SIZE,SIZE),c=cv.getContext('2d');c.imageSmoothingEnabled=false;
    c.drawImage(record.image,...frame,Math.round((SIZE-width)/2),SIZE-12-height,width,height);
    cache.set(key,cv);if(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);
    return cv;
  }
  // A small dedicated silhouette remains available offline; it does not borrow
  // another species or use the front as a rear. The full atlas replaces it on load.
  // Without its sheet, キラシード keeps a thick green frog-slime body with soft
  // folds, golden eyes and a chest seed, without flowers or leaves.
  // The front faces left; the rear view hides the face.
  function floravelleFallback(back){
    const key=`floravelle:${back?1:0}:fallback`;if(cache.has(key))return cache.get(key);
    const cv=canvas(SIZE,SIZE),c=cv.getContext('2d'),ink='#234632',coat='#638b4d',far='#3c6743',pale='#8faa5a',gold='#ecc16a';
    const ellipse=(x,y,rx,ry,color,line=true,rot=0)=>{c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,rot,0,Math.PI*2);c.fill();if(line){c.strokeStyle=ink;c.lineWidth=3;c.stroke();}};
    if(back){c.translate(SIZE,0);c.scale(-1,1);}
    // Wide feet, a rounded body and a heavy head create the soft, squat silhouette.
    ellipse(68,280,44,22,far,true,-.27);ellipse(251,280,43,22,coat,true,.24);
    ellipse(165,210,109,85,coat);ellipse(168,283,64,19,pale);
    ellipse(134,126,77,63,coat);ellipse(134,179,83,30,far);
    // Rounded skin folds remain part of the body rather than pointed foliage.
    c.fillStyle=pale;c.strokeStyle=ink;c.lineWidth=3;c.beginPath();c.moveTo(62,187);c.bezierCurveTo(102,224,186,232,241,192);c.bezierCurveTo(265,209,254,229,234,237);c.bezierCurveTo(168,261,84,230,62,208);c.quadraticCurveTo(55,196,62,187);c.fill();c.stroke();
    ellipse(72,230,25,43,coat,true,.32);ellipse(242,231,27,44,coat,true,-.4);
    c.strokeStyle=far;c.lineWidth=4;c.lineCap='round';c.beginPath();c.moveTo(80,95);c.quadraticCurveTo(123,67,170,92);c.moveTo(82,178);c.quadraticCurveTo(126,196,178,175);c.stroke();
    if(back){
      // Rear folds and the absent face/chest marking make this a distinct rear view.
      c.strokeStyle=far;c.lineWidth=6;c.beginPath();c.moveTo(80,143);c.bezierCurveTo(116,170,165,153,198,177);c.moveTo(99,250);c.quadraticCurveTo(159,271,211,250);c.stroke();
    }else{
      ellipse(101,122,13,8,gold,true,-.12);ellipse(153,121,16,9,gold,true,-.18);
      ellipse(101,121,3,6,ink,false);ellipse(153,120,3,7,ink,false);
      ellipse(98,118,2,2,'#fff2bc',false);ellipse(149,117,2.5,2.5,'#fff2bc',false);
      c.strokeStyle=far;c.lineWidth=8;c.beginPath();c.moveTo(83,111);c.quadraticCurveTo(101,117,115,115);c.moveTo(134,111);c.quadraticCurveTo(153,108,174,106);c.stroke();
      c.strokeStyle=ink;c.lineWidth=3.5;c.beginPath();c.moveTo(76,151);c.quadraticCurveTo(118,168,177,149);c.stroke();
      ellipse(117,139,2.5,2,ink,false);ellipse(128,137,2.5,2,ink,false);
      c.fillStyle=gold;c.strokeStyle='#987c39';c.lineWidth=2;c.beginPath();c.moveTo(166,207);c.bezierCurveTo(161,218,151,221,155,230);c.bezierCurveTo(165,238,177,222,166,207);c.fill();c.stroke();
    }
    c.strokeStyle=far;c.lineWidth=3;c.beginPath();for(const x of [58,69,80]){c.moveTo(x,248);c.quadraticCurveTo(x+2,257,x+1,264);}for(const x of [232,243,254]){c.moveTo(x,251);c.quadraticCurveTo(x-2,260,x-1,267);}c.stroke();
    cache.set(key,cv);if(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);return cv;
  }
  function uniqueSprite(id,back){
    const record=uniqueSheets.get(id);if(!record?.loaded)return id==='floravelle'?floravelleFallback(back):null;
    const key=`${id}:${back?1:0}`;
    if(cache.has(key)){const cv=cache.get(key);cache.delete(key);cache.set(key,cv);return cv;}
    const image=record.image,half=Math.floor(image.naturalWidth/2),sx=back?half:0;
    const raw=canvas(half,image.naturalHeight),rc=raw.getContext('2d',{willReadFrequently:true});
    rc.drawImage(image,sx,0,half,image.naturalHeight,0,0,half,image.naturalHeight);
    const pixels=rc.getImageData(0,0,raw.width,raw.height).data;
    let left=raw.width,right=-1,top=raw.height,bottom=-1;
    for(let i=3;i<pixels.length;i+=4)if(pixels[i]>12){const p=(i-3)/4,x=p%raw.width,y=Math.floor(p/raw.width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    if(right<left||bottom<top)return null;
    const sw=right-left+1,sh=bottom-top+1,scale=Math.min((SIZE-24)/sw,(SIZE-24)/sh),w=Math.round(sw*scale),h=Math.round(sh*scale);
    const cv=canvas(SIZE,SIZE),c=cv.getContext('2d');c.imageSmoothingEnabled=false;
    // Each half is an independently authored view; only transparent margins
    // are cropped. No recoloring, mirrored substitute, or body-form borrowing.
    c.drawImage(raw,left,top,sw,sh,Math.round((SIZE-w)/2),SIZE-12-h,w,h);
    raw.width=raw.height=1;
    cache.set(key,cv);if(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);
    return cv;
  }
  function getBase(id, back=false) {
    const d=LT.DATA?.species?.[id];
    if(!d)return null;
    if(hasRevised(id))return revisedSprite(id,back);
    if(id==='arvelion'||id==='floravelle')return uniqueSprite(id,back);
    if(offDexArt[id]){requestOffDex(id);return uniqueSprite(id,back);}
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
    const originalElement=original.artElement||original.element,displayElement=d.artElement||d.element;
    const targetHue=hue(original.color||palette[originalElement]||palette.leaf);
    const rotation=angular(targetHue,sourceHue)+(n%19)-9;
    const bodyHue=canonical[shape]===originalElement?rotation*.28:rotation;
    const accent=(d.accent||palette[displayElement]||palette.leaf).match(/^#([0-9a-f]{6})$/i);
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
  // data. Every species has its own coat: one of 32 hue turns (always at least
  // 50° away from the normal colours) combined with one of 8 saturation and
  // brightness styles, both taken from its dex position. 32 × 8 = 256 coats, so
  // no two species share one, and neighbouring entries (usually one family)
  // land far apart on the colour wheel.
  const SHINY_STYLES=Object.freeze([[1,1],[1.28,.94],[.62,1.12],[1.12,.82],[.8,1.05],[1.4,1.08],[.5,.92],[1.05,1.17]]);
  function shinyPalette(id){
    const ids=Object.keys(LT.DATA?.species||{}),index=Math.max(0,ids.indexOf(id));
    const hueStep=(index*13)%32,style=Math.floor(index/32)%SHINY_STYLES.length;
    return {index,hueStep,style,turn:50+hueStep*260/31,saturation:SHINY_STYLES[style][0],brightness:SHINY_STYLES[style][1]};
  }
  function alternate(source,id){
    const cv=canvas(SIZE,SIZE),c=cv.getContext('2d',{willReadFrequently:true});
    c.drawImage(source,0,0);
    const im=c.getImageData(0,0,SIZE,SIZE),p=im.data;
    const {turn,saturation,brightness}=shinyPalette(id);
    for(let i=0;i<p.length;i+=4){
      if(p[i+3]<12)continue;
      const [h,s,v]=hsv(p[i],p[i+1],p[i+2]);
      // Preserve dark ink, white clothing and eye glints. The alternate
      // colored materials retain their authored shading.
      if(v<.16||(s<.13&&v>.84))continue;
      const color=rgb(h+turn,clamp((s<.18?s+.16:s*.92+.08)*saturation,0,1),clamp(v*1.025*brightness,0,1));
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
  function orientation(id,back=false){
    const d=LT.DATA?.species?.[id];if(!d)return {direction:0,source:'unavailable',authoredBack:false};
    if(hasRevised(id)){
      const entry=revisedArt[id],loaded=!!revisedSheets.get(entry.file)?.loaded;
      return {direction:loaded?(entry[back?'backDirection':'frontDirection']??(back?-1:1)):0,source:loaded?'revised-authored':'revised-pending',authoredBack:loaded&&!!back,stage:entry.stage,file:entry.file};
    }
    if(id==='floravelle')return {direction:back?1:-1,source:uniqueSheets.get(id)?.loaded?'floravelle-original':'floravelle-fallback',authoredBack:!!back,stage:0};
    if(id==='arvelion')return uniqueSheets.get(id)?.loaded
      ? {direction:back?1:-1,source:'arvelion-original',authoredBack:!!back,stage:0}
      : {direction:back?-1:1,source:'fallback',authoredBack:!!back,stage:0};
    if(offDexArt[id])return uniqueSheets.get(id)?.loaded
      ? {direction:back?1:-1,source:'offdex-authored',authoredBack:!!back,stage:offDexArt[id].stage}
      : {direction:back?-1:1,source:'fallback',authoredBack:!!back,stage:offDexArt[id].stage};
    const family=lineage(id),shape=family?.stage?family.shape:d.shape||'sprig';
    const mature=family?.stage>0||d.rarity==='legendary'||d.evolved;
    let stage=0,location=lookup.get(mature&&lookup.has(`${shape}-mature`)?`${shape}-mature`:shape);
    const candidate=lookup.get(shape),wanted=family?.stage||0;
    if(wanted&&candidate&&evolutionSheets.get(evolutionKey(candidate,wanted,back))?.loaded){stage=wanted;location=candidate;}
    if(!location)return {direction:back?-1:1,source:'fallback',authoredBack:!!back,stage:0};
    const key=`${location.group}:${stage}:${back?1:0}`;
    return {direction:authoredDirections[key][location.cell],source:stage?'evolution':'original',authoredBack:!!back,stage,group:location.group,cell:location.cell};
  }
  const ready=Promise.all([load(0,false),load(0,true),load(1,false),load(1,true),loadAtlas(uniqueSheets,'arvelion',new URL('assets/arvelion.png?v=20261116-lion',root).href),loadAtlas(uniqueSheets,'floravelle',new URL('assets/floravelle.png?v=20261119-kiraseed-v50',root).href)]);
  LT.CreatureArt={ready,get,preload,lineage,alternate,shinyPalette,orientation,authoredDirections,revisedArt,revisedIds,hasRevised,supportsBack:id=>!!LT.DATA?.species?.[id],clearCache(){cache.clear();},spriteSize:SIZE,
    forms:groups.map(row=>row.slice()),
    status(){
      const revisedState=id=>revisedSheets.get(revisedArt[id].file),count=(ids,flag)=>ids.filter(id=>flag?revisedState(id)?.[flag]:!!revisedState(id)).length;
      const glitchIds=['nullmie','nullva','zeroveil'],offDexIds=['pearlmi','pearlgoa','pearlseria','shimomaru','shimorei','hyogald'];
      const futo=revisedState('futo'),leader=revisedState('galdoras');
      return {loaded:[...sheets.values()].filter(s=>s.loaded).length,failed:[...sheets.values()].filter(s=>s.failed).length,
        evolutionRequested:evolutionSheets.size,evolutionLoaded:[...evolutionSheets.values()].filter(s=>s.loaded).length,evolutionFailed:[...evolutionSheets.values()].filter(s=>s.failed).length,
        revisedRequested:revisedSheets.size,revisedLoaded:[...revisedSheets.values()].filter(s=>s.loaded).length,revisedFailed:[...revisedSheets.values()].filter(s=>s.failed).length,
        glitchRequested:count(glitchIds),glitchLoaded:count(glitchIds,'loaded'),glitchFailed:count(glitchIds,'failed'),
        offDexRequested:count(offDexIds)+Object.keys(offDexArt).filter(id=>uniqueSheets.has(id)).length,
        offDexLoaded:count(offDexIds,'loaded')+Object.keys(offDexArt).filter(id=>uniqueSheets.get(id)?.loaded).length,
        offDexFailed:count(offDexIds,'failed')+Object.keys(offDexArt).filter(id=>uniqueSheets.get(id)?.failed).length,
        leaderRequested:leader?1:0,leaderLoaded:leader?.loaded?1:0,leaderFailed:leader?.failed?1:0,
        futoLoaded:!!futo?.loaded,futoFrontLoaded:!!futo?.loaded,futoBackLoaded:!!futo?.loaded,
        futoFailed:!!futo?.failed,futoFrontFailed:!!futo?.failed,futoBackFailed:!!futo?.failed,futoOriginalFallbackLoaded:false,
        arvelionLoaded:!!uniqueSheets.get('arvelion')?.loaded,arvelionFailed:!!uniqueSheets.get('arvelion')?.failed,
        floravelleLoaded:!!uniqueSheets.get('floravelle')?.loaded,floravelleFailed:!!uniqueSheets.get('floravelle')?.failed,cached:cache.size,cacheLimit:CACHE_LIMIT};
    }

  };
})();
