#!/usr/bin/env node
'use strict';
// Deterministic loader regressions: no timers, network, or native image memory.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../individual-creature-art.js'),'utf8');
function runtime({automatic=false}={}){
 const images=[],events=[],timers=new Set(),legacyCalls=[],species={},entries={},listeners=new Map();let now=1000;
 for(let i=0;i<32;i++){
  const id=`species${i}`;species[id]={id};entries[id]={file:`assets/sheet-${Math.floor(i/2)}.webp`,size:[512,512],front:[16,24,100,120],back:[240,32,130,140],frontDirection:-1,backDirection:1};
 }
 for(const id of ['futo','arvelion','floravelle']){species[id]={id};entries[id]=entries.species0;}
 const fallback={fallback:true},art={spriteSize:320,get:(...args)=>{legacyCalls.push(args);return fallback;},
  preload:async ids=>ids.map(()=>true),orientation:()=>({direction:1,source:'legacy',authoredBack:false,stage:0}),
  status:()=>({loaded:4}),lineage:()=>({stage:1}),clearCache(){},alternate:(base,id)=>({shiny:true,base,id})};
 class Image{
  set src(url){this.url=url;images.push(this);if(automatic)queueMicrotask(()=>this.succeed());}
  succeed(){this.naturalWidth=this.naturalHeight=512;this.onload?.();}
  fail(){this.onerror?.(new Error('expected failure'));}
 }
 const document={baseURI:'https://example.test/game/',currentScript:{src:'https://example.test/game/individual-creature-art.js'},
  createElement(){const calls=[],ctx={drawImage(...args){calls.push(args);}};return {width:1,height:1,calls,getContext:()=>ctx};},
  dispatchEvent(event){events.push(event);}};
 const LT={CreatureArt:art,DATA:{species},IndividualArtCatalog:{version:'test',species:entries}};
 const context=vm.createContext({LT,document,Image,URL,Date:{now:()=>now},Event:class{constructor(type){this.type=type;}},
  addEventListener(type,callback){listeners.set(type,callback);},
  setTimeout(callback){const token={callback};timers.add(token);return token;},clearTimeout(token){timers.delete(token);}});
 vm.runInContext(code,context);
 return {LT,art,api:LT.IndividualCreatureArt,images,events,legacyCalls,fallback,
  advance(ms){now+=ms;},online(){listeners.get('online')?.();},
  expire(){for(const timer of [...timers]){timers.delete(timer);timer.callback();}}};
}
function checkPortraitScrolling(){
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const start=html.indexOf('/* Pachi Monsters — visible-only portrait backing stores'),end=html.indexOf('</script>',start);
 assert(start>=0&&end>start,'Portrait loader module missing');
 const frames=[],painted=[],portraits=Array.from({length:259},(_,i)=>({dataset:{creature:`species${i}`},width:256,height:256,isConnected:true}));
 let observer;
 const context=vm.createContext({LT:{},document:{hidden:false,addEventListener(){},removeEventListener(){}},
  requestAnimationFrame(fn){frames.push(fn);return frames.length;},cancelAnimationFrame(){},console,
  IntersectionObserver:class{constructor(callback){this.callback=callback;observer=this;}observe(){}unobserve(){}disconnect(){}}});
 vm.runInContext(html.slice(start,end),context);
 const loader=new context.LT.PortraitLoader({render:(_,id)=>painted.push(id)});
 const drain=()=>{let count=0;while(frames.length){assert(++count<520,'Portrait rendering entered an idle loop');frames.shift()();}};
 const visibility=(indices,isIntersecting)=>observer.callback(indices.map(i=>({target:portraits[i],isIntersecting})));
 loader.observe({querySelectorAll:()=>portraits});drain();
 assert(portraits.every(canvas=>canvas.width===1),'Opening the dex allocated every portrait');
 visibility([0,1,2],true);drain();assert.deepEqual(painted,['species0','species1','species2']);
 painted.length=0;loader.invalidate(['species1']);drain();assert.deepEqual(painted,['species1'],'One atlas repaint invalidated unrelated portraits');
 visibility([0,1,2],false);visibility([250,251],true);drain();
 assert.equal(portraits.filter(canvas=>canvas.width>1).length,2,'Scrolled-away backing stores were retained');
 portraits[250].isConnected=false;loader.prune();assert.equal(portraits[250].width,1);
 loader.destroy();assert(portraits.every(canvas=>canvas.width===1));assert.equal(loader._records.size,0);
}
async function main(){
 const stalled=runtime(),{art,api,images}=stalled;
 assert.equal(images.length,0,'Module installation eagerly downloaded images');
 assert.equal(art.get('species0'),stalled.fallback);
 assert.equal(art.orientation('species0').source,'legacy','Loading orientation claimed an unavailable pose');
 const pending=api.preload('species0',{back:'both'});
 art.get('species2');art.get('species4');
 assert.equal(images.length,2);assert.equal(api.status().queued,1);
 for(let i=0;i<10;i++)art.get('species0');
 assert.equal(images.length,2,'Repeated paints duplicated a request');
 stalled.expire();assert.equal((await pending)[0],false);
 assert.equal(api.status().active,2,'Timeout released an image that remained in flight');
 assert.equal(images.length,2,'Timeout exceeded the actual download limit');
 images[0].succeed();assert.equal(images.length,3,'Completion did not release the next queued download');
 const front=art.get('species0'),back=art.get('species0',true);
 assert.notEqual(front,stalled.fallback);assert.notEqual(front,back);
 assert.equal(art.orientation('species0').direction,-1);assert.equal(art.orientation('species0',true).direction,1);
 assert.deepEqual(Array.from(stalled.events[0].speciesIds).filter(id=>!['futo','arvelion','floravelle'].includes(id)),['species0','species1']);
 assert.equal(front.calls[0][1],16);assert.equal(back.calls[0][1],240,'Rear view borrowed the front cell');
 const shiny=art.get('species0',false,{shiny:true});assert.equal(shiny.base,front);assert(shiny.shiny);
 images[1].fail();images[2].succeed();
 for(let i=0;i<10;i++){assert.equal(art.get('species2'),stalled.fallback);await api.preload('species2');}
 assert.equal(images.length,3,'Failed assets were retried on every paint');
 assert.equal(api.status().failed,1);assert.equal(api.status().peakActive,2);assert.equal(api.status().active,0);
 assert.equal(art.get('futo',true),stalled.fallback);assert.equal(art.get('arvelion'),stalled.fallback);assert.equal(art.get('floravelle',true),stalled.fallback);
 assert.equal(images.length,3,'Special species requested ordinary artwork');
 stalled.advance(29999);art.get('species2');assert.equal(images.length,3,'Failure cooldown ended early');
 stalled.advance(1);art.get('species2');assert.equal(images.length,4,'A temporary failure remained pinned after cooldown');
 images[3].fail();const beforeOnline=images.length;
 stalled.online();assert.equal(images.length,beforeOnline,'Reconnect eagerly fetched offscreen sheets');
 art.get('species2');assert.equal(images.length,5,'Reconnect did not permit immediate requested recovery');
 images[4].succeed();assert.notEqual(art.get('species2'),stalled.fallback);
 assert.equal(api.status().failed,0);assert.equal(api.status().active,0);assert(api.status().peakActive<=2);

 const bounded=runtime({automatic:true}),before=JSON.stringify(bounded.LT.DATA);
 for(let i=0;i<16;i+=2)await bounded.api.preload([`species${i}`,`species${i+1}`],{back:'both'});
 assert.equal(bounded.api.status().loaded,6);assert(bounded.api.status().evictions>0);
 const requests=bounded.images.length,retained=bounded.art.get('species0');
 assert.notEqual(retained,bounded.fallback);assert.equal(bounded.images.length,requests,'A cached sprite needlessly reloaded its evicted atlas');
 await bounded.api.preload(Object.keys(bounded.LT.DATA.species),{back:'both'});
 const status=bounded.api.status();assert.equal(status.loaded,6);assert.equal(status.cached,48);assert(status.peakActive<=2);
 assert.equal(JSON.stringify(bounded.LT.DATA),before,'Loader changed species data');
 bounded.art.clearCache();assert.equal(bounded.api.status().cached,48,'An unrelated artwork event discarded immutable portraits');
 bounded.api.clearCache();assert.equal(bounded.api.status().cached,0);
 await bounded.api.preload('species0');assert.equal(bounded.art.orientation('species0').source,'individual');
 checkPortraitScrolling();
 console.log(JSON.stringify({ok:true,lazyStartup:true,concurrentDownloads:2,lateRecovery:true,failureRetryCooldownMs:30000,reconnectRecovery:true,decodedSheetLimit:6,spriteLimit:48,bulkPreloadBounded:true,specialArtworkPreserved:true,selectivePortraitRepaint:true,scrollReleasesBackingStores:true}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
