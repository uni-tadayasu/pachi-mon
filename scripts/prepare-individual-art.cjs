#!/usr/bin/env node
'use strict';
// Encode generated atlases for delivery and measure each authored view.
// This is file-format preparation; the generated artwork and alpha are retained.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createCanvas,loadImage}=require(process.env.CANVAS_MODULE||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/@napi-rs/canvas');
const root=path.resolve(__dirname,'..'),source=path.resolve(process.argv[2]||'individual-art-source');
const partial=process.argv.includes('--partial');
const jobs=JSON.parse(fs.readFileSync(path.join(root,'assets/creatures-individual-designs.json'),'utf8'));
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');
async function main(){
 const species={},sheets=[],warnings=[];
 for(const job of jobs){
  const basename='creatures-individual-'+job.sheet,png=path.join(source,basename+'.png');
  if(!fs.existsSync(png)){if(partial)continue;throw Error('Missing generated sheet '+png);}
  const metadataFile=path.join(source,basename+'.json');
  if(!fs.existsSync(metadataFile)&&partial)continue;
  const metadata=JSON.parse(fs.readFileSync(metadataFile,'utf8'));
  const image=await loadImage(png),w=image.width,h=image.height;
  if(Math.abs(w/h-1)>.01)throw Error('Atlas must be square: '+basename);
  const cv=createCanvas(w,h),ctx=cv.getContext('2d');ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,w,h).data,frames=[];
  for(let cell=0;cell<job.members.length*2;cell++){
   const x0=Math.floor(cell%4*w/4),x1=Math.floor((cell%4+1)*w/4),y0=Math.floor(Math.floor(cell/4)*h/4),y1=Math.floor((Math.floor(cell/4)+1)*h/4);
   let left=x1,right=-1,top=y1,bottom=-1,count=0,edge=0;
   for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(pixels[(y*w+x)*4+3]>=128){
    count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
    if(x<x0+2||x>=x1-2||y<y0+2||y>=y1-2)edge++;
   }
   if(count<300)throw Error('Empty sprite '+basename+' cell '+cell);
   if(edge>8)warnings.push({sheet:job.sheet,cell,edgePixels:edge});
   left=Math.max(x0,left-2);top=Math.max(y0,top-2);right=Math.min(x1-1,right+2);bottom=Math.min(y1-1,bottom+2);
   frames.push([left,top,right-left+1,bottom-top+1]);
  }
  const output=path.join(root,'assets',basename+'.webp');
  const sourceHash=digest(fs.readFileSync(png));
  const recordFile=path.join(source,basename+'.encoded.json');
  let old;try{old=JSON.parse(fs.readFileSync(recordFile,'utf8'));}catch{}
  if(old?.sourceHash!==sourceHash||!fs.existsSync(output)){
   fs.writeFileSync(output,cv.toBuffer('image/webp',94));
   fs.writeFileSync(recordFile,JSON.stringify({sourceHash}));
  }
  for(const member of job.members)species[member.id]={file:'assets/'+basename+'.webp',size:[w,h],front:frames[member.frontCell],back:frames[member.backCell],frontDirection:metadata.frontDirection??-1,backDirection:metadata.backDirection??1};
  sheets.push({file:basename+'.webp',size:[w,h],sha256:digest(fs.readFileSync(output)),sourceSha256:sourceHash,species:job.members.map(m=>m.id),prompt:metadata.prompt,qa:metadata.qa||metadata.observations||''});
  cv.width=cv.height=1;
  global.gc?.();await new Promise(setImmediate);
 }
 const catalog={version:'20261116-individual-v1',species};
 const target=path.join(root,'assets/creatures-individual-catalog.js');
 fs.writeFileSync(target+'.tmp','/* Generated per-species front/rear atlas coordinates. */\n(()=>{const LT=globalThis.LT=globalThis.LT||{};LT.IndividualArtCatalog='+JSON.stringify(catalog)+';})();\n');fs.renameSync(target+'.tmp',target);
 fs.writeFileSync(path.join(root,'assets/creatures-individual-manifest.json'),JSON.stringify({generator:'Built-in image_gen',created:'2026-11-16',description:'259 individually authored normal species, each with a separate front and rear view. Evolution families share their own motifs. Futo and Arvelion retain their dedicated artwork.',preparation:'PNG to WebP quality 94; alpha retained. Recorded crop rectangles remove only transparent atlas margins.',grid:{columns:4,rows:4},sheets},null,2)+'\n');
 console.log(JSON.stringify({sheets:sheets.length,species:Object.keys(species).length,bytes:sheets.reduce((n,s)=>n+fs.statSync(path.join(root,'assets',s.file)).size,0),warnings}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
