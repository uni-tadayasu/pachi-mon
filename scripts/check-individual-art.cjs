#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {runtime,canvas,imageStats}=require('./check-art.cjs');
const root=path.resolve(__dirname,'..'),partial=process.argv.includes('--partial');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
async function main(){
 const {LT,engine}=await runtime(),catalog=LT.IndividualArtCatalog?.species,api=LT.IndividualCreatureArt;
 assert(catalog&&api,'Individual artwork integration is missing');
 const normal=Object.keys(LT.DATA.species).filter(id=>!LT.DATA.species[id].hiddenDex&&!['futo','arvelion','floravelle'].includes(id));
 if(!partial)assert.deepEqual(Object.keys(catalog).sort(),normal.sort(),'Every normal species needs its own artwork');
 assert(!catalog.futo&&!catalog.arvelion&&!catalog.floravelle,'Dedicated special artwork must remain separate');
 const before=JSON.stringify({data:LT.DATA,state:engine.state}),groups=new Map(),sources=new Set(),rendered=new Set(),masks=new Set();
 for(const [id,entry]of Object.entries(catalog)){
  assert(LT.DATA.species[id]);assert(fs.existsSync(path.join(root,entry.file)),`Missing image: ${id}`);
  if(!groups.has(entry.file))groups.set(entry.file,[]);groups.get(entry.file).push(id);
  for(const back of [false,true]){
   const rect=entry[back?'back':'front'];assert(rect.length===4&&rect.every(Number.isFinite));
   assert(rect[0]>=0&&rect[1]>=0&&rect[2]>0&&rect[3]>0&&rect[0]+rect[2]<=entry.size[0]&&rect[1]+rect[3]<=entry.size[1]);
   const key=entry.file+':'+rect.join(',');assert(!sources.has(key),`Reused source pose: ${id}`);sources.add(key);
  }
 }
 let views=0;
 const contact=process.argv.find(a=>a.startsWith('--contact='))?.split('=').slice(1).join('=');
 const columns=8,tile=144,ids=Object.keys(catalog),overview=contact?canvas.createCanvas(columns*tile,Math.ceil(ids.length/columns)*(tile+24)):null;
 const oc=overview?.getContext('2d');if(oc){oc.fillStyle='#152534';oc.fillRect(0,0,overview.width,overview.height);}
 for(const [file,group]of groups){
  await api.preload(group,{back:'both'});
  for(const id of group){
   const viewHashes=[];
   for(const back of [false,true]){
    const cv=LT.CreatureArt.get(id,back),stats=imageStats(cv),orientation=LT.CreatureArt.orientation(id,back);
    assert.equal(orientation.source,'individual',`${id}: still using a shared fallback`);
    assert.equal(orientation.direction,back?1:-1);assert.equal(orientation.authoredBack,back);
    assert(stats.fraction>.04&&stats.fraction<.9,`${id}: empty or opaque-background sprite`);
    assert(stats.left>=8&&stats.top>=8&&stats.right<cv.width-8&&stats.bottom<cv.height-8,`${id}: clipped display margin`);
    assert(!rendered.has(stats.hash),`${id}: exact duplicate rendered artwork`);rendered.add(stats.hash);viewHashes.push(stats.hash);
    const small=canvas.createCanvas(48,48),sc=small.getContext('2d');sc.drawImage(cv,stats.left,stats.top,stats.right-stats.left+1,stats.bottom-stats.top+1,0,0,48,48);
    const rgba=sc.getImageData(0,0,48,48).data,mask=Uint8Array.from({length:48*48},(_,i)=>rgba[i*4+3]>=128?1:0);masks.add(hash(mask));small.width=small.height=1;
    if(!back&&oc){const n=ids.indexOf(id),x=n%columns*tile,y=Math.floor(n/columns)*(tile+24);oc.drawImage(cv,x,y,tile,tile);oc.fillStyle='#edf2f5';oc.font='12px sans-serif';oc.fillText(id,x+5,y+tile+15,tile-10);}
    views++;
   }
   assert.notEqual(...viewHashes,`${id}: rear view duplicates front`);
  }
  const status=api.status();assert(status.loaded<=status.sheetLimit&&status.cached<=status.cacheLimit&&status.peakActive<=status.downloadLimit,'Artwork memory/concurrency budget exceeded');
  global.gc?.();await new Promise(setImmediate);
 }
 assert.equal(JSON.stringify({data:LT.DATA,state:engine.state}),before,'Artwork changed game/save data');
 assert.equal(sources.size,ids.length*2);assert.equal(rendered.size,ids.length*2);
 assert(masks.size>ids.length*1.8,'Too many shared silhouettes');
 if(contact){fs.mkdirSync(path.dirname(path.resolve(contact)),{recursive:true});fs.writeFileSync(contact,overview.toBuffer('image/png'));}
 console.log(JSON.stringify({ok:true,species:ids.length,sheets:groups.size,views,uniqueSourcePoses:sources.size,uniqueRenderedViews:rendered.size,distinctNormalizedSilhouettes:masks.size,cache:api.status(),gameplayUnchanged:true}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
