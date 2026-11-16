/* Pachi Monsters — individually authored species portraits.
 * Immutable atlas data stays separate from gameplay/save data.
 * © 2026 KASAI SOLUTIONS INC.
 */
(() => {
  'use strict';
  const LT=globalThis.LT,art=LT?.CreatureArt,catalog=LT?.IndividualArtCatalog;
  if(!art||!catalog?.species)return;
  const entries=catalog.species,root=new URL('.',document.currentScript?.src||document.baseURI);
  const SIZE=art.spriteSize||320,SHEET_LIMIT=6,SPRITE_LIMIT=48,DOWNLOAD_LIMIT=2,RETRY_DELAY=30000;
  const legacy={get:art.get,preload:art.preload,orientation:art.orientation,status:art.status,clearCache:art.clearCache};
  const records=new Map(),sprites=new Map(),lastSource=new Map(),queue=[];
  const idsByFile=new Map();
  for(const [id,entry]of Object.entries(entries)){
    if(!idsByFile.has(entry.file))idsByFile.set(entry.file,[]);
    idsByFile.get(entry.file).push(id);
  }
  let tick=0,active=0,peakActive=0,successfulLoads=0,evictions=0;
  const validEntry=id=>!['futo','arvelion'].includes(id)&&LT.DATA?.species?.[id]&&entries[id];
  const keyOf=(id,back,shiny=false)=>`${id}:${back?1:0}:${shiny?1:0}`;
  function touch(record){record.used=++tick;}
  function remember(key,value){
    sprites.delete(key);sprites.set(key,value);
    while(sprites.size>SPRITE_LIMIT)sprites.delete(sprites.keys().next().value);
    return value;
  }
  function cached(key){const value=sprites.get(key);if(value){sprites.delete(key);sprites.set(key,value);}return value;}
  function trim(){
    const resident=[...records.values()].filter(record=>record.state==='loaded');
    resident.sort((a,b)=>a.used-b.used);
    while(resident.length>SHEET_LIMIT){
      const record=resident.shift();record.image=null;record.state='evicted';record.promise=null;evictions++;
    }
  }
  function notify(file){
    const event=new Event('pachi-art-ready');
    // Only portraits belonging to this atlas need repainting. In a long dex,
    // re-invalidating every visible portrait would cycle through evicted sheets.
    event.speciesIds=idsByFile.get(file)?.slice()||[];
    document.dispatchEvent(event);
  }
  function pump(){
    while(active<DOWNLOAD_LIMIT&&queue.length){
      const record=queue.shift();if(record.state!=='queued')continue;
      active++;peakActive=Math.max(peakActive,active);record.state='loading';
      const image=record.image=new Image();let finished=false,released=false;
      const release=()=>{if(released)return;released=true;active--;pump();};
      const finish=ok=>{
        if(finished)return;finished=true;clearTimeout(record.timer);image.onload=null;image.onerror=null;
        record.state=ok?'loaded':'failed';record.timedOut=false;record.retryAt=ok?0:Date.now()+RETRY_DELAY;
        if(ok){touch(record);successfulLoads++;trim();}else record.image=null;
        record.resolve(ok);release();if(ok)notify(record.file);
      };
      image.onload=()=>finish(image.naturalWidth>=256&&image.naturalHeight>=256);
      image.onerror=()=>finish(false);
      try{image.src=record.url;}catch(_){finish(false);}
    }
  }
  function request(file){
    let record=records.get(file);
    // A temporary connection failure must not pin the fallback for the entire
    // session. Retry only when requested after the cooldown, never per frame.
    if(record?.state==='failed'&&Date.now()>=record.retryAt)record.state='evicted';
    if(record&&record.state!=='evicted'){if(record.state==='loaded')touch(record);return record;}
    if(!record){
      const url=new URL(file,root);url.searchParams.set('v',String(catalog.version||'individual'));
      record={file,url:url.href,state:'queued',image:null,promise:null,resolve:null,used:0,timedOut:false};
      records.set(file,record);
    }else record.state='queued';
    let settled=false;
    record.promise=new Promise(resolve=>{record.resolve=ok=>{if(settled)return;settled=true;resolve(ok);};});
    // Release preload callers after a deadline, including queued requests,
    // but retain the network slot until its real load/error event. A stalled
    // connection never expands the two-request concurrency bound.
    record.timer=setTimeout(()=>{record.timedOut=true;record.resolve(false);},18000);
    queue.push(record);pump();return record;
  }
  function frameFor(entry,back,image){
    const frame=entry[back?'back':'front'],size=entry.size;
    if(!Array.isArray(frame)||frame.length<4||!Array.isArray(size)||size.length!==2)return null;
    if(![...frame.slice(0,4),...size].every(Number.isFinite)||size.some(n=>n<=0)||frame[2]<=0||frame[3]<=0)return null;
    const fx=image.naturalWidth/size[0],fy=image.naturalHeight/size[1];
    const x=Math.max(0,Math.floor(frame[0]*fx)),y=Math.max(0,Math.floor(frame[1]*fy));
    const w=Math.min(image.naturalWidth-x,Math.ceil(frame[2]*fx)),h=Math.min(image.naturalHeight-y,Math.ceil(frame[3]*fy));
    return w>0&&h>0?[x,y,w,h]:null;
  }
  function render(id,back,record){
    const entry=entries[id],frame=frameFor(entry,back,record.image);if(!frame)return null;
    const [x,y,w,h]=frame,cv=document.createElement('canvas');cv.width=cv.height=SIZE;
    const c=cv.getContext('2d'),scale=Math.min((SIZE-24)/w,(SIZE-24)/h),dw=Math.max(1,Math.round(w*scale)),dh=Math.max(1,Math.round(h*scale));
    c.imageSmoothingEnabled=false;
    // Each source rectangle is a dedicated authored pose. Preserve its palette
    // and proportions; only transparent padding is removed by the catalogue.
    c.drawImage(record.image,x,y,w,h,Math.round((SIZE-dw)/2),SIZE-12-dh,dw,dh);
    return remember(keyOf(id,back),cv);
  }
  function get(id,back=false,options={}){
    const entry=validEntry(id);if(!entry)return legacy.get(id,back,options);
    const key=keyOf(id,back,!!options.shiny);let result=cached(key);
    if(!result){
      let base=cached(keyOf(id,back));
      if(!base){const record=request(entry.file);if(record.state==='loaded'){touch(record);base=render(id,back,record);}}
      if(base)result=options.shiny?remember(key,art.alternate(base,id)):base;
    }
    lastSource.set(`${id}:${back?1:0}`,!!result);
    return result||legacy.get(id,back,options);
  }
  async function preload(ids,{back=false}={}){
    const wanted=typeof ids==='string'?[ids]:Array.from(ids||[]),groups=new Map(),other=[];
    for(const id of wanted){const entry=validEntry(id);if(!entry){other.push(id);continue;}if(!groups.has(entry.file))groups.set(entry.file,[]);groups.get(entry.file).push(id);}
    const results=[];
    // Sequential groups keep bulk QA/export calls bounded. Rendering a large
    // collection should preload and draw one subset at a time, as the UI does.
    for(const [file,group]of groups){
      const views=back==='both'?[false,true]:[!!back];
      if(group.every(id=>views.every(rear=>sprites.has(keyOf(id,rear))))){results.push(true);continue;}
      const record=request(file),ok=record.state==='loaded'||await record.promise;
      if(ok&&record.state==='loaded')for(const id of group)for(const rear of views)get(id,rear);
      results.push(!!ok);
    }
    if(other.length)results.push(...await legacy.preload(other,{back}));
    return results;
  }
  function orientation(id,back=false){
    const entry=validEntry(id);if(!entry)return legacy.orientation(id,back);
    const prior=lastSource.get(`${id}:${back?1:0}`),available=prior===undefined
      ?sprites.has(keyOf(id,back))||records.get(entry.file)?.state==='loaded':prior;
    if(!available)return legacy.orientation(id,back);
    return {direction:entry[back?'backDirection':'frontDirection']??(back?1:-1),source:'individual',authoredBack:!!back,
      stage:art.lineage(id)?.stage||0,file:entry.file};
  }
  function status(){
    return {requested:records.size,loaded:[...records.values()].filter(r=>r.state==='loaded').length,
      failed:[...records.values()].filter(r=>r.state==='failed').length,queued:queue.length,active,peakActive,
      successfulLoads,evictions,cached:sprites.size,cacheLimit:SPRITE_LIMIT,sheetLimit:SHEET_LIMIT,downloadLimit:DOWNLOAD_LIMIT};
  }
  art.get=get;art.preload=preload;art.orientation=orientation;
  art.status=()=>({...legacy.status(),individual:status()});
  // Global artwork notifications clear procedural/legacy fallbacks; immutable
  // dedicated portraits do not become stale when an unrelated sheet arrives.
  art.clearCache=()=>legacy.clearCache();
  globalThis.addEventListener?.('online',()=>{
    const failed=[...records.values()].filter(record=>record.state==='failed');
    for(const record of failed)record.state='evicted';
    // Repaint only affected visible portraits. Offscreen sheets remain lazy.
    for(const record of failed)notify(record.file);
  });
  LT.IndividualCreatureArt={preload,get,orientation,status,catalog,
    clearCache(){sprites.clear();lastSource.clear();},
    has:id=>!!validEntry(id)};
})();
