#!/usr/bin/env node
'use strict';
// Exercise the actual preference migration, live portrait switching and canvas
// post-processing. The save and species data are never part of this migration.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {runtime,canvas,imageStats}=require('./check-art.cjs');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
let allocated=0;
const document={documentElement:{dataset:{}},createElement(tag){
  assert.equal(tag,'canvas');allocated++;return canvas.createCanvas(1,1);
}};
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
  const test=vm.createContext({LT:{RetroScreen:retro},document:{documentElement:{dataset:{}}},matchMedia:()=>({matches:false}),SETTINGS_KEY:'lumina-trail-settings-v1',
    localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){storage.set(key,value);writes.push(key);}}});
  vm.runInContext(saveFunction+'\n'+html.slice(start,end)+'\nglobalThis.result=settings;',test);
  assert.equal(storage.get('lumina-trail-save-v1'),save,'Display migration changed the adventure save');
  assert(writes.every(key=>key==='lumina-trail-settings-v1'),'Display migration wrote an unrelated key');
  assert.equal(test.document.documentElement.dataset.screenMode,test.result.screen,'Initial CSS display mode did not match saved settings');
  return JSON.parse(JSON.stringify(test.result));
}
const fresh=settingsFor();assert.equal(fresh.screen,'color');assert.equal(fresh.screenVersion,3);
assert.equal(retro.label('color'),'カラー');assert.equal(retro.label('mono'),'モノクロ');
assert.equal(fresh.crt,false,'A fresh full-colour display should not be covered in scanlines');
assert.equal(settingsFor({screen:'color',crt:true}).crt,true,'Saved CRT preference was replaced');
assert.equal(settingsFor({screen:'color',crt:false}).crt,false,'Saved clear-display preference was replaced');
const migrated=settingsFor({screen:'pocket',sound:false,volume:.21,quality:'low',textSpeed:'fast',autoRun:true,crt:false,glitchUnlocked:true});
assert.equal(migrated.screen,'color');assert.equal(migrated.sound,false);assert.equal(migrated.volume,.21);
assert.equal(migrated.quality,'low');assert.equal(migrated.textSpeed,'fast');assert.equal(migrated.autoRun,true);assert.equal(migrated.crt,false);assert.equal(migrated.glitchUnlocked,true);
assert.equal(settingsFor(migrated).screen,'color','Preference migration was not stable on reload');
for(const screen of ['pocket','dot','leaf','sepia','night','glitch']){
  assert.equal(settingsFor({screen}).screen,'color',`${screen}: legacy mode survived migration`);
  assert.equal(settingsFor({screen,screenExplicit:true,screenVersion:2}).screen,'color',`${screen}: explicit legacy mode survived migration`);
}
for(const screen of ['color','mono'])assert.equal(settingsFor({screen}).screen,screen,'Supported display choice was replaced');
assert.equal(settingsFor('{invalid').screen,'color','Broken settings prevented the new default');
assert.equal(settingsFor({screen:'invalid'}).screen,'color');

// Switch the real open-menu canvases immediately, including a rear/shiny view;
// the loader will keep only visible canvases backed by a native pixel buffer.
const portraits=[{dataset:{portraitSize:'54',raster:'40',back:'false',shiny:'false'},style:{width:'54px'}},
  {dataset:{portraitSize:'160',raster:'64',back:'true',shiny:'true'},style:{width:'160px'}}];
const start=html.indexOf('  function setScreenMode(id) {'),end=html.indexOf('  // Hidden elements',start);assert(start>=0&&end>start);
let saved=0,repainted=0;const switching=vm.createContext({LT:{RetroScreen:retro},settings:{screen:'color',screenVersion:3},
  document:{documentElement:{dataset:{}},querySelectorAll:()=>portraits},saveSettings(){saved++;},paintPortraits(){repainted++;}});
vm.runInContext(html.slice(start,end),switching);
assert.equal(switching.setScreenMode('color'),true);assert.equal(saved,1);assert.equal(repainted,1);
assert.equal(switching.document.documentElement.dataset.screenMode,'color');
assert.deepEqual(portraits.map(c=>Number(c.dataset.raster)),[128,320]);
assert.equal(portraits[1].dataset.back,'true');assert.equal(portraits[1].dataset.shiny,'true');
assert.equal(switching.settings.screenExplicit,true);
switching.setScreenMode('mono');assert.equal(switching.document.documentElement.dataset.screenMode,'mono');assert.deepEqual(portraits.map(c=>Number(c.dataset.raster)),[128,320],'Monochrome reduced portrait detail');
assert.equal(settingsFor(switching.settings).screen,'mono','Monochrome choice did not survive reload');
for(const id of ['pocket','dot','leaf','sepia','night','glitch','unknown'])assert.equal(switching.setScreenMode(id),false);
assert.equal(saved,2);assert.equal(switching.document.documentElement.dataset.screenMode,'mono','Invalid mode changed the live display');
for(const size of [24,42,54,64,88,160,200,5000]){assert(retro.portraitRaster('color',size)<=512,'HD portrait exceeded its memory bound');assert.equal(retro.portraitRaster('mono',size),retro.portraitRaster('color',size),'Display modes use different portrait resolution');}
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
  const mono=canvas.createCanvas(768,480);mono.getContext('2d').drawImage(hd,0,0);assert.equal(retro.apply(mono,'mono'),true);
  assert.notEqual(imageStats(mono).hash,pristine,'Monochrome left the battle in colour');
  assert.equal(mono.width,hd.width);assert.equal(mono.height,hd.height);
  const colorPixels=hd.getContext('2d').getImageData(0,0,hd.width,hd.height).data,monoPixels=mono.getContext('2d').getImageData(0,0,mono.width,mono.height).data;
  for(let i=0;i<monoPixels.length;i+=4){assert.equal(monoPixels[i+3],colorPixels[i+3]);if(monoPixels[i+3]){assert.equal(monoPixels[i],monoPixels[i+1]);assert.equal(monoPixels[i+1],monoPixels[i+2]);}}
  assert(colours(mono)>64,'Battle monochrome still uses a limited palette');
  if(preview){
    fs.mkdirSync(preview,{recursive:true});
    const board=canvas.createCanvas(1560,654),c=board.getContext('2d');c.fillStyle='#102730';c.fillRect(0,0,board.width,board.height);
    c.fillStyle='#fff4d6';c.font='bold 24px sans-serif';c.fillText('Colour: native pixel artwork',18,36);c.fillText('Monochrome: same native detail',798,36);
    c.imageSmoothingEnabled=false;c.drawImage(hd,12,54);c.drawImage(mono,792,54);
    c.fillStyle='#c3dacd';c.font='16px sans-serif';c.fillText('The same authored sprites, shapes, colours and rear views. No changes to battle statistics.',18,576);
    c.fillText('Both modes retain 320 px portraits / 128 px icons. Monochrome keeps the full 256-shade range.',18,610);
    fs.writeFileSync(path.join(preview,'display-modes-v52.png'),board.toBuffer('image/png'));
  }
  assert.equal(JSON.stringify({data:LT.DATA,state:engine.state}),snapshot,'Display rendering changed game data or saves');
  const status=LT.IndividualCreatureArt.status();assert(status.loaded<=6&&status.cached<=48&&status.peakActive<=2,'Artwork cache/network bounds changed');
  console.log(JSON.stringify({ok:true,defaultMode:'color',legacyModesMigrated:true,monochromeChoicePreserved:true,publicModes:Array.from(retro.order),monochromeDetailPreserved:true,saveUnchanged:true,livePortraitResizing:true,hdPortrait:320,smallPortrait:128,maximumPortrait:512,nativePixelsPreserved:true,frontRearViews:detail.length,detail,cacheBounds:status},null,2));
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
