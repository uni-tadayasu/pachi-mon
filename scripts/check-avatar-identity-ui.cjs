#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const model=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;vm.runInContext(script[2],model);if(model.LT?.Engine)break;}
const {Engine,DATA}=model.LT,engine=new Engine();engine.newGame(DATA.starters[0],'female');engine.state.party[0].shiny=true;
let writes=0,failWrite=false;const elements=new Map();
const c=vm.createContext({console,Engine,DATA,LT:{...model.LT,onlineActive:false,CreatureArt:{supportsBack:id=>id!=='futo'}},engine,playing:true,storedSave:null,lastSave:0,lastPortraitFrame:0,selectedAvatar:'male',settings:{reducedMotion:false},performance:{now:()=>123},SAVE_KEY:'test',
 document:{querySelectorAll:()=>[]},Art:{},escape:value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
 $:id=>elements.get(id),typeBadge:()=>'',creatureDescription:species=>species.description,
 showParty:index=>{c.returned=index;},updateAll:()=>{},toast:message=>{c.toast=message;},
 localStorage:{setItem(){if(failWrite)throw Error('save quota');writes++;}},
 openModal(title,markup,pane){c.modal={title,markup,pane};elements.clear();for(const m of markup.matchAll(/id="([^"]+)"/g)){elements.set(m[1],{value:'',disabled:false,hidden:false,listeners:{},setAttribute(k,v){this[k]=v;},addEventListener(k,v){this.listeners[k]=v;}});}}
});
function load(start,end){const a=html.indexOf(start),b=html.indexOf(end,a);assert(a>0&&b>a);vm.runInContext(html.slice(a,b),c);}
load('  const nameOf=','  const evolutionFeatures=');
load('  function chooseAvatar()','  function interact()');
load('  function findOwned(','  function persistRelease(');
const before=JSON.stringify(c.engine.serialize());c.chooseAvatar();assert.equal(c.modal.pane,'avatars');assert(c.modal.markup.includes('data-avatar="male"'));assert(c.modal.markup.includes('data-avatar="female"'));assert.equal(JSON.stringify(c.engine.serialize()),before,'Opening choice must not overwrite save');
c.selectedAvatar='female';c.chooseStarter();assert.equal(c.modal.pane,'starters');assert(c.modal.markup.includes('女性の主人公'));assert.equal(JSON.stringify(c.engine.serialize()),before,'Choosing appearance alone must not overwrite save');
const uid=c.engine.state.party[0].uid;const input=()=>elements.get('nickname-input'),submit=()=>elements.get('nickname-form').onsubmit({preventDefault(){}});
c.showNickname(uid);input().value='あいうえおか';input().listeners.input();assert(elements.get('nickname-save').disabled);submit();assert.equal(writes,0);
input().value='あいうえお';input().listeners.input();input().listeners.compositionstart();submit();assert.equal(writes,0,'IME Enter must not submit prematurely');input().listeners.compositionend();
failWrite=true;submit();assert.equal(c.engine.state.party[0].nickname,undefined,'Failed persistence must not change nickname');assert.equal(elements.get('nickname-result').hidden,false);failWrite=false;submit();assert.equal(c.engine.state.party[0].nickname,'あいうえお');assert.equal(c.engine.state.party[0].shiny,true);assert.equal(c.engine.state.avatar,'female');assert.equal(writes,1);
c.showNickname(uid);input().value='';input().listeners.input();submit();assert.equal(c.engine.state.party[0].nickname,undefined,'Empty name resets species name');
c.showNickname(uid);input().value='👩‍🚀🌿';input().listeners.input();assert.equal(elements.get('nickname-count').textContent,'2 / 5文字');submit();assert.equal(c.engine.state.party[0].nickname,'👩‍🚀🌿');
c.engine.state.party[0].nickname='<x>';c.showNickname(uid);assert(c.modal.markup.includes('&lt;x&gt;'));assert(!c.modal.markup.includes('<x>'));
assert(c.creatureView(c.engine.state.party[0]).includes('data-shiny="true"'));assert(c.creatureView('komori').includes('data-creature-view="back"'));assert(!c.creatureView('futo').includes('data-creature-view="back"'));
assert(html.includes("engine.newGame(starter, selectedAvatar)"));assert(html.includes("personSprite(engine.state.avatar==='female'?'hero-female':'hero'"));assert(html.includes('LT.playMoveSound='));
console.log('Avatar/identity UI: safe selection, 5-grapheme validation, IME composition, escaped names, transactional persistence, shiny preservation and view controls passed.');

(async()=>{
 let native;for(const candidate of [process.env.CANVAS_MODULE,'@napi-rs/canvas','/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'].filter(Boolean)){try{native=require(candidate);break;}catch{}}
 assert(native,'Canvas dependency required');
 class Image extends native.Image {set src(value){super.src=path.join(root,new URL(value).pathname.replace(/^\//,''));}get naturalWidth(){return this.width;}get naturalHeight(){return this.height;}}
 const r=vm.createContext({console,URL,Image,setTimeout,clearTimeout,Event:class{},document:{baseURI:'https://test/',currentScript:{src:'https://test/traveller-art.js'},createElement:()=>native.createCanvas(1,1),dispatchEvent(){}}});
 vm.runInContext(fs.readFileSync(path.join(root,'traveller-art.js'),'utf8'),r);await r.LT.TravellerArt.ready;
 assert.equal(r.LT.TravellerArt.stats.failed,0);const female=new Set(),male=new Set();
 for(const kind of ['hero','hero-female'])for(const dir of ['down','left','right','up'])for(let frame=0;frame<3;frame++){
  const cv=r.LT.TravellerArt.get(kind,dir,frame),pixels=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let alpha=0;
  for(let i=3;i<pixels.length;i+=4)if(pixels[i]>16)alpha++;
  assert(alpha>1000&&alpha<cv.width*cv.height*.9,`${kind}/${dir}/${frame} cutout`);
  (kind==='hero'?male:female).add(crypto.createHash('sha256').update(pixels).digest('hex'));
 }
 assert.equal(female.size,12,'Female four views by three poses must be distinct');assert.equal(male.size,12);assert([...female].every(hash=>!male.has(hash)),'Female atlas must differ from existing male');
 console.log('Traveller rendering: 24 distinct front/side/back idle/walking views passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
