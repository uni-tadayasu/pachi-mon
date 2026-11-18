#!/usr/bin/env node
'use strict';
// Exercise the actual preference migration, live portrait switching and canvas
// post-processing. The save and species data are never part of this migration.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {runtime,canvas,imageStats}=require('./check-art.cjs');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
let allocated=0;
const element=()=>({style:{},setAttribute(){},append(){},appendChild(){}});
const document={body:element(),createElement(tag){
  assert.equal(tag,'canvas');allocated++;const cv=canvas.createCanvas(1,1),ctx=cv.getContext('2d');
  // The native harness has no DOM SVG-filter registry. Model a browser without
  // url() canvas-filter support instead of asking Skia to resolve a DOM node.
  let filter='none';Object.defineProperty(ctx,'filter',{get:()=>filter,set:value=>{filter=String(value).startsWith('url(')?'none':value;}});
  return cv;
},createElementNS:()=>element()};
const context=vm.createContext({document});
vm.runInContext(fs.readFileSync(path.join(root,'retro-screen.js'),'utf8'),context);
const retro=context.LT.RetroScreen;
assert.equal(retro.defaultMode,'color');assert.equal(retro.order[0],'color');

function settingsFor(saved){
  const save='{"party":[{"uid":"keep-me","species":"komori","level":81,"alloc":{"hp":64}}],"seals":["first"]}';
  const storage=new Map([['lumina-trail-save-v1',save]]),writes=[];
  if(saved!==undefined)storage.set('lumina-trail-settings-v1',typeof saved==='string'?saved:JSON.stringify(saved));
  const start=html.indexOf('  let settings = {'),end=html.indexOf('  const sound = new LT.Audio();',start);
  assert(start>=0&&end>start);
  const saveFunction=html.match(/  function saveSettings\(\) \{[^\n]+\}/)?.[0];assert(saveFunction);
  const test=vm.createContext({LT:{RetroScreen:retro},matchMedia:()=>({matches:false}),SETTINGS_KEY:'lumina-trail-settings-v1',
    localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){storage.set(key,value);writes.push(key);}}});
  vm.runInContext(saveFunction+'\n'+html.slice(start,end)+'\nglobalThis.result=settings;',test);
  assert.equal(storage.get('lumina-trail-save-v1'),save,'Display migration changed the adventure save');
  assert(writes.every(key=>key==='lumina-trail-settings-v1'),'Display migration wrote an unrelated key');
  return JSON.parse(JSON.stringify(test.result));
}
const fresh=settingsFor();assert.equal(fresh.screen,'color');assert.equal(fresh.screenVersion,2);
const migrated=settingsFor({screen:'pocket',sound:false,volume:.21,quality:'low',textSpeed:'fast',autoRun:true,crt:false});
assert.equal(migrated.screen,'color');assert.equal(migrated.sound,false);assert.equal(migrated.volume,.21);
assert.equal(migrated.quality,'low');assert.equal(migrated.textSpeed,'fast');assert.equal(migrated.autoRun,true);assert.equal(migrated.crt,false);
assert.equal(settingsFor(migrated).screen,'color','Preference migration was not stable on reload');
for(const screen of ['dot','leaf','sepia','night','mono','color','glitch'])assert.equal(settingsFor({screen}).screen,screen,'Saved nondefault mode was replaced');
assert.equal(settingsFor({screen:'pocket',screenExplicit:true}).screen,'pocket','Explicit nostalgic choice was replaced');
assert.equal(settingsFor({screen:'pocket',screenVersion:2}).screen,'pocket','Already migrated display reverted on reload');
assert.equal(settingsFor('{invalid').screen,'color','Broken settings prevented the new default');
assert.equal(settingsFor({screen:'invalid'}).screen,'color');

// Switch the real open-menu canvases immediately, including a rear/shiny view;
// the loader will keep only visible canvases backed by a native pixel buffer.
const portraits=[{dataset:{portraitSize:'54',raster:'40',back:'false',shiny:'false'},style:{width:'54px'}},
  {dataset:{portraitSize:'160',raster:'64',back:'true',shiny:'true'},style:{width:'160px'}}];
const start=html.indexOf('  function setScreenMode(id) {'),end=html.indexOf('  // Hidden elements',start);assert(start>=0&&end>start);
let saved=0,repainted=0;const switching=vm.createContext({LT:{RetroScreen:retro},settings:{screen:'pocket',screenVersion:2},
  document:{querySelectorAll:()=>portraits},saveSettings(){saved++;},paintPortraits(){repainted++;}});
vm.runInContext(html.slice(start,end),switching);
assert.equal(switching.setScreenMode('color'),true);assert.equal(saved,1);assert.equal(repainted,1);
assert.deepEqual(portraits.map(c=>Number(c.dataset.raster)),[128,320]);
assert.equal(portraits[1].dataset.back,'true');assert.equal(portraits[1].dataset.shiny,'true');
assert.equal(switching.settings.screenExplicit,true);
switching.setScreenMode('pocket');assert.deepEqual(portraits.map(c=>Number(c.dataset.raster)),[40,64]);
assert.equal(settingsFor(switching.settings).screen,'pocket','Player cannot retain the nostalgic setting after migration');
assert.equal(switching.setScreenMode('unknown'),false);assert.equal(saved,2);
for(const size of [24,42,54,64,88,160,200,5000])assert(retro.portraitRaster('color',size)<=512,'HD portrait exceeded its memory bound');
assert.equal(retro.portraitRaster('color',160),320);assert.equal(retro.portraitRaster('color',260),512);

function colours(cv){const d=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data,unique=new Set();for(let i=0;i<d.length;i+=4)if(d[i+3]>32)unique.add((d[i]<<16)|(d[i+1]<<8)|d[i+2]);return unique.size;}
async function main(){
  const {LT,engine}=await runtime(),snapshot=JSON.stringify({data:LT.DATA,state:engine.state});
  const ids=['komori','shizuku','hibana','komorizen','shizunaria','futo','arvelion','floravelle'],detail=[];
  for(const id of ids){
    await LT.CreatureArt.preload([id],{back:'both'});
    for(const back of [false,true]){
      const old=canvas.createCanvas(64,64),hd=canvas.createCanvas(retro.portraitRaster('color',160),retro.portraitRaster('color',160));
      LT.Art.creature(old,id,{back,time:0});LT.Art.creature(hd,id,{back,time:0});
      const oldColours=colours(old),hdColours=colours(hd);
      assert(hdColours>oldColours*1.3,`${id} ${back?'back':'front'}: native details were lost before display`);
      const hash=imageStats(hd).hash,before=allocated;
      assert.equal(retro.apply(hd),false,'HD default applied the lossy handheld grid');
      assert.equal(imageStats(hd).hash,hash,'HD post-processing changed the native portrait pixels');
      assert.equal(allocated,before,'HD allocated unused retro intermediate canvases');
      detail.push({id,back,oldColours,hdColours});
      old.width=old.height=1;hd.width=hd.height=1;
    }
  }
  const preview=process.env.RENDER_PREVIEW_DIR;
  await LT.CreatureArt.preload(['shizunaria','floravelle'],{back:'both'});
  const scene={map:engine.map,state:{...engine.state,party:[engine.makeMonster('shizunaria',50)]},battle:{activeIndex:0,enemy:engine.makeMonster('floravelle',50)}};
  const hd=canvas.createCanvas(768,480);LT.Art.battle(hd,scene,0,{quality:'high',reducedMotion:true});
  const pristine=imageStats(hd).hash;retro.apply(hd);assert.equal(imageStats(hd).hash,pristine);
  const old=canvas.createCanvas(768,480);old.getContext('2d').drawImage(hd,0,0);assert.equal(retro.apply(old,'pocket'),true);
  assert.notEqual(imageStats(old).hash,pristine,'Explicit handheld mode stopped reducing the display');
  if(preview){
    fs.mkdirSync(preview,{recursive:true});
    const board=canvas.createCanvas(1560,654),c=board.getContext('2d');c.fillStyle='#102730';c.fillRect(0,0,board.width,board.height);
    c.fillStyle='#fff4d6';c.font='bold 24px sans-serif';c.fillText('Previous default: 240 dots',18,36);c.fillText('Updated default: native pixel artwork',798,36);
    c.imageSmoothingEnabled=false;c.drawImage(old,12,54);c.drawImage(hd,792,54);
    c.fillStyle='#c3dacd';c.font='16px sans-serif';c.fillText('The same authored sprites, shapes, colours and rear views. No changes to battle statistics.',18,576);
    c.fillText('HD menu portraits: 320 px. Small icons: 128 px. Classic display modes remain selectable.',18,610);
    fs.writeFileSync(path.join(preview,'high-detail-v32.png'),board.toBuffer('image/png'));
  }
  assert.equal(JSON.stringify({data:LT.DATA,state:engine.state}),snapshot,'Display rendering changed game data or saves');
  const status=LT.IndividualCreatureArt.status();assert(status.loaded<=6&&status.cached<=48&&status.peakActive<=2,'Artwork cache/network bounds changed');
  console.log(JSON.stringify({ok:true,defaultMode:'color',legacyPocketMigration:true,explicitModesPreserved:true,saveUnchanged:true,livePortraitResizing:true,hdPortrait:320,smallPortrait:128,maximumPortrait:512,nativePixelsPreserved:true,frontRearViews:detail.length,detail,cacheBounds:status},null,2));
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
