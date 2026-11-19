#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const copy=value=>JSON.parse(JSON.stringify(value));
function runtime(fallback=false){
  const c=vm.createContext({console,...(fallback?{Intl:{}}:{})});
  for(const s of scripts){if(/\bsrc=|application\/ld\+json/.test(s[1]))continue;vm.runInContext(s[2],c);if(c.LT?.Engine)break;}
  return c.LT;
}
const LT=runtime(),{Engine,DATA,PlayerIdentity:I}=LT;
const make=()=>{const e=new Engine();assert(e.newGame(DATA.starters[0],'female',' か\u3099く ').ok);return e;};
let e=make();assert.equal(e.state.playerName,'がく');assert.equal(e.state.avatar,'female');
const initial=JSON.stringify(e.serialize());assert(!e.newGame(DATA.starters[1],'male','あ'.repeat(13)).ok);assert.equal(JSON.stringify(e.serialize()),initial,'Invalid name must not replace an existing adventure');
const old=copy(e.serialize());delete old.playerName;const oldBefore=JSON.stringify(old);
assert.equal(new Engine(old).state.playerName,'プレイヤー');assert.equal(JSON.stringify(old),oldBefore,'Legacy migration must not mutate caller data');
for(const identity of [I,runtime(true).PlayerIdentity]){
  assert.equal(identity.normalizeName(' か\u3099く '),'がく');assert.equal(identity.normalizeName('　 '),'プレイヤー');
  for(const char of ['👩‍👩‍👧‍👦','🇯🇵','👍🏽','か\u3099']){
    assert.equal(identity.countName(char.repeat(12)),12);assert(identity.normalizeName(char.repeat(12)));
    assert.throws(()=>identity.normalizeName(char.repeat(13)));
  }
  for(const invalid of [null,12,{},'bad\n','bad\u0000','x\u202e','x\u2066','x\ufeff','a'.repeat(513)])assert.throws(()=>identity.normalizeName(invalid));
  const family='👩‍👩‍👧‍👦';assert.equal(identity.onlineName(family.repeat(12)),family,'Online fallback keeps complete graphemes within the existing 16-code-unit input limit');
  assert.equal(identity.onlineName('🇯🇵'.repeat(12)),'🇯🇵'.repeat(4));assert.equal(identity.onlineName('あ'.repeat(12)),'あ'.repeat(12));
}
e.state.party[0].nickname='あいぼう';e.state.party[0].hp=7;e.state.party[0].xp=3;e.state.coins=237;
const before=copy(e.serialize());assert(e.renamePlayer('旅人🌿').ok);
const after=copy(e.serialize());assert.equal(after.playerName,'旅人🌿');delete before.playerName;delete after.playerName;
assert.deepEqual(after,before,'Rename changes only the protagonist name, preserving all party, avatar, progress and inventory data');
assert.equal(new Engine(JSON.parse(JSON.stringify(e.serialize()))).state.playerName,'旅人🌿','Export/import retains the name');
e.battle={};assert(!e.renamePlayer('戦闘中').ok);assert.equal(e.state.playerName,'旅人🌿');e.battle=null;
assert(!new Engine().renamePlayer('開始前').ok);
for(const name of ['あ'.repeat(13),'bad\n',false,null]){const bad=e.serialize();bad.playerName=name;assert.throws(()=>new Engine(bad));}

// Execute production form handlers with a small DOM surface so IME and failed
// persistence exercise the same transaction as the browser.
const elements=new Map(),avatarButtons=[{disabled:false},{disabled:false}],writes=[];let failWrite=false;
const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const decode=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[entity]));
const ui=vm.createContext({tradeLocked:()=>false,console,Engine,DATA,LT:{...LT,onlineActive:false},engine:e,playing:true,busy:false,storedSave:e.serialize(),lastSave:0,
  selectedPlayerName:I.defaultName,selectedAvatar:'male',performance:{now:()=>123},SAVE_KEY:'test-adventure',escape:esc,
  document:{querySelectorAll:selector=>selector==='[data-avatar]'?avatarButtons:[]},$:id=>elements.get(id),
  paintAnimatedPortraits(){},portrait:()=>'',typeBadge:()=>'',speciesBadges:()=>'',creatureDescription:species=>species.description,
  showSettings(){ui.settingsOpened=(ui.settingsOpened||0)+1;},updateAll(){},toast:message=>{ui.lastToast=message;},
  localStorage:{setItem(key,value){if(failWrite)throw Error('Storage full');writes.push([key,value]);}},
  openModal(title,markup,pane){ui.modal={title,markup,pane};elements.clear();for(const match of markup.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)){
    const value=match[0].match(/\bvalue="([^"]*)"/);elements.set(match[1],{value:decode(value?.[1]||''),disabled:false,hidden:match[0].includes(' hidden'),listeners:{},setAttribute(key,value){this[key]=value;},addEventListener(key,handler){this.listeners[key]=handler;}});
  }}
});
function load(start,end,c=ui){const a=html.indexOf(start),b=html.indexOf(end,a);assert(a>0&&b>a);vm.runInContext(html.slice(a,b),c);}
load('  function bindPlayerNameInput(','  function interact()');
const savedBefore=JSON.stringify(e.state);ui.chooseAvatar(true);assert.equal(elements.get('new-player-name').value,'プレイヤー');
let input=elements.get('new-player-name');input.value='旅人🌿';input.listeners.input();assert.equal(ui.selectedPlayerName,'旅人🌿');
ui.selectedAvatar='female';ui.chooseStarter();assert(ui.modal.markup.includes('旅人🌿'));ui.chooseAvatar(false);assert.equal(elements.get('new-player-name').value,'旅人🌿');
assert.equal(JSON.stringify(e.state),savedBefore,'Choosing a new-game name does not touch the current save');
input=elements.get('new-player-name');input.value='あ'.repeat(13);input.listeners.input();assert(avatarButtons.every(button=>button.disabled));
input.value='👩‍🚀';input.listeners.input();input.listeners.compositionstart();assert(avatarButtons.every(button=>button.disabled));
let prevented=false;input.listeners.keydown({key:'Enter',isComposing:true,preventDefault(){prevented=true;}});assert(prevented);input.listeners.compositionend();assert(avatarButtons.every(button=>!button.disabled));
const formInput=()=>elements.get('player-name-input'),submit=()=>elements.get('player-name-form').onsubmit({preventDefault(){}});
ui.showPlayerName();assert.equal(formInput().value,'旅人🌿');formInput().value='あ'.repeat(13);formInput().listeners.input();submit();assert.equal(writes.length,0);
formInput().value='そら🌟';formInput().listeners.input();formInput().listeners.compositionstart();submit();assert.equal(writes.length,0);formInput().listeners.compositionend();
const renameBefore=JSON.stringify(e.state);failWrite=true;submit();assert.equal(JSON.stringify(e.state),renameBefore);assert.equal(elements.get('player-name-result').hidden,false);assert.equal(writes.length,0);
failWrite=false;submit();assert.equal(e.state.playerName,'そら🌟');assert.equal(writes.length,1);assert.equal(writes[0][0],'test-adventure');assert.equal(new Engine(JSON.parse(writes[0][1])).state.playerName,'そら🌟');
const expected=JSON.parse(renameBefore);expected.playerName='そら🌟';assert.deepEqual(copy(e.state),expected);assert.equal(ui.settingsOpened,1);
ui.showPlayerName();formInput().value='';formInput().listeners.input();submit();assert.equal(e.state.playerName,'プレイヤー');
e.renamePlayer('<img src=x>');ui.showPlayerName();assert(ui.modal.markup.includes('&lt;img src=x&gt;'));assert(!ui.modal.markup.includes('<img src=x>'));
for(const blocked of ['busy','battle','online','title']){
  const prior=ui.modal;ui.busy=blocked==='busy';e.battle=blocked==='battle'?{}:null;ui.LT.onlineActive=blocked==='online';ui.playing=blocked!=='title';
  ui.showPlayerName();assert.equal(ui.modal,prior,'Rename cannot open during blocked game state');
}
ui.busy=false;e.battle=null;ui.LT.onlineActive=false;ui.playing=true;
ui.showPlayerName();formInput().value='後から';formInput().listeners.input();ui.busy=true;submit();assert.equal(e.state.playerName,'<img src=x>','A stale form cannot rename after the game state changes');ui.busy=false;
assert(html.includes('candidate.newGame(starter, selectedAvatar, selectedPlayerName)'));
assert(html.includes("'player-name':showPlayerName"));assert(html.includes("$('player-journal-name').textContent=`${s.playerName}の冒険記録`"));

// Run the real online menu script, preserving explicit names while deriving an
// unsaved default from the protagonist on each opening.
const onlineScript=scripts.find(s=>s[2].includes('short-code, human-versus-human battles'));assert(onlineScript);
function online(explicit){
  const nodes=new Map(),storage=new Map(explicit===undefined?[]:[['pachi-link-name',explicit]]),changes=[];
  const element=id=>{if(!nodes.has(id))nodes.set(id,{id,open:false,innerHTML:'',listeners:{},classList:{toggle(){}},showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();},addEventListener(event,fn){this.listeners[event]=fn;},querySelectorAll:()=>[]});return nodes.get(id);};
  const c=vm.createContext({console,LT:{...LT,adminBridge:{getEngine:()=>e},Art:{ready:Promise.resolve()},PixelSprites:{}},
    localStorage:{getItem:key=>storage.get(key)||null,setItem(key,value){changes.push(key);storage.set(key,value);},removeItem(key){changes.push(key);storage.delete(key);}},
    document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){},dispatchEvent(){}},window:{addEventListener(){}},
    requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout:()=>1,clearTimeout(){},CustomEvent:class{},performance:{now:()=>0}});
  vm.runInContext(onlineScript[2],c);return {c,nodes,changes,storage};
}
e.renamePlayer('旅人🌿');let o=online();o.c.LT.OnlineUI.open();assert(o.nodes.get('online-content').innerHTML.includes('value="旅人🌿"'));assert.equal(o.changes.length,0);
o.c.LT.OnlineUI.close();e.renamePlayer('変更後');o.c.LT.OnlineUI.open();assert(o.nodes.get('online-content').innerHTML.includes('value="変更後"'));assert.equal(o.changes.length,0);
o=online('対戦名');o.c.LT.OnlineUI.open();assert(o.nodes.get('online-content').innerHTML.includes('value="対戦名"'));assert.equal(o.storage.get('pachi-link-name'),'対戦名');assert.equal(o.changes.length,0);
o.nodes.get('online-modal').listeners.input({target:{id:'link-name',value:''}});assert(!o.storage.has('pachi-link-name'));o.c.LT.OnlineUI.close();o.c.LT.OnlineUI.open();assert(o.nodes.get('online-content').innerHTML.includes('value="変更後"'));
console.log('Player name checks passed: new-game setup, legacy/import/export migration, 12 graphemes and IME, safe escaped forms, atomic rename, preserved adventure identity and online defaults.');
