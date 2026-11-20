#!/usr/bin/env node
'use strict';
// Export the public encyclopedia from the same authored portrait and display
// pipeline used in the game. No independent colour/outline filter lives here.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),output=path.join(root,'assets','dex'),SIZE=96;
function dependency(name){
  for(const target of [name,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES&&path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,name),path.join('/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules',name)].filter(Boolean)){
    try{return require(target);}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
  }
  throw Error(`Install ${name} before generating the encyclopedia portraits.`);
}
const canvas=dependency('@napi-rs/canvas'),sharp=dependency('sharp');
async function createRuntime(){
  const imageErrors=[];
  class LocalImage extends canvas.Image{
    set src(value){
      if(value==='')return;
      const url=new URL(String(value),'https://game.test/'),relative=decodeURIComponent(url.pathname.slice(1)),absolute=path.resolve(root,relative);
      assert(absolute.startsWith(root+path.sep),'Artwork must remain inside the project');
      // Browser loaders install callbacks and timers before images complete.
      setImmediate(()=>{
        const failed=this.onerror;
        this.onerror=error=>{imageErrors.push(relative);failed?.call(this,error);};
        try{super.src=absolute;}catch(error){this.onerror?.(error);}
      });
    }
    get src(){return super.src;}
  }
  const document={baseURI:'https://game.test/',currentScript:null,
    createElement(tag){assert.equal(tag,'canvas');return canvas.createCanvas(1,1);},dispatchEvent(){}};
  const context=vm.createContext({console,document,Image:LocalImage,URL,Event:class{constructor(type){this.type=type;}},
    setTimeout(callback,ms){const timer=setTimeout(callback,ms);timer.unref();return timer;},clearTimeout});
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  for(const [,attrs,code]of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(/\bsrc=|application\/ld\+json/.test(attrs))continue;
    vm.runInContext(code,context);if(context.LT?.Engine)break;
  }
  assert(context.LT?.DATA&&context.LT?.Engine,'Game species catalogue could not initialize');
  for(const file of ['monster-pixels.js','creature-art.js','assets/creatures-individual-catalog.js','individual-creature-art.js']){
    document.currentScript={src:new URL(file,document.baseURI).href};
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
  }
  await context.LT.CreatureArt.ready;
  return {LT:context.LT,imageErrors};
}
async function main(){
  const args=process.argv.slice(2);assert(args.every(arg=>arg==='--check'),'Only --check is supported');
  const check=args.includes('--check'),{LT,imageErrors}=await createRuntime();
  const ids=Object.keys(LT.DATA.species).filter(id=>!LT.DATA.species[id].hiddenDex);
  assert.equal(ids.length,LT.DATA.content.dexSpecies,'Public encyclopedia count must match game data');
  fs.mkdirSync(output,{recursive:true});
  for(const [index,id]of ids.entries()){
    await LT.CreatureArt.preload(id);
    const source=LT.CreatureArt.get(id,false);assert(source,`Missing authored front for ${id}`);
    const sample=LT.MonsterPixels.get(source),portrait=canvas.createCanvas(SIZE,SIZE),c=portrait.getContext('2d');
    c.imageSmoothingEnabled=false;c.drawImage(sample,0,0,sample.width,sample.height,0,0,SIZE,SIZE);
    const pixels=c.getImageData(0,0,SIZE,SIZE).data;
    let visible=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>16)visible++;
    assert(visible>SIZE*SIZE*.05&&visible<SIZE*SIZE*.9,`${id}: expected a complete transparent sprite`);
    const encoded=await sharp(portrait.toBuffer('image/png')).webp({lossless:true,effort:6}).toBuffer();
    const decoded=await sharp(encoded).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(decoded.info.width,SIZE);assert.equal(decoded.info.height,SIZE);
    for(let i=0;i<pixels.length;i+=4){
      assert.equal(decoded.data[i+3],pixels[i+3],`${id}: alpha changed during WebP encoding`);
      if(pixels[i+3])for(let channel=0;channel<3;channel++)assert.equal(decoded.data[i+channel],pixels[i+channel],`${id}: WebP must remain lossless`);
    }
    const destination=path.join(output,id+'.webp');
    if(check)assert(fs.existsSync(destination)&&fs.readFileSync(destination).equals(encoded),`${id}: thumbnail is stale; run node scripts/build-dex-sprites.cjs`);
    else fs.writeFileSync(destination,encoded);
    portrait.width=portrait.height=1;
    if((index+1)%8===0){global.gc?.();await new Promise(setImmediate);global.gc?.();}
    if((index+1)%64===0)console.log(`${check?'Checked':'Exported'} ${index+1}/${ids.length} public portraits`);
  }
  assert.equal(imageErrors.length,0,'All exported portraits must use valid shipped artwork');
  for(const species of Object.values(LT.DATA.species).filter(species=>species.hiddenDex))assert(!fs.existsSync(path.join(output,species.id+'.webp')),`${species.id}: hidden artwork must not enter the public encyclopedia`);
  console.log(JSON.stringify({ok:true,mode:check?'check':'write',species:ids.length,grid:LT.MonsterPixels.grid,size:SIZE,sharedRenderer:true,lossless:true,hiddenExcluded:true}));
}
if(!global.gc){const result=require('node:child_process').spawnSync(process.execPath,['--expose-gc',__filename,...process.argv.slice(2)],{stdio:'inherit'});process.exitCode=result.status??1;}
else main().catch(error=>{console.error(error.stack);process.exitCode=1;});
