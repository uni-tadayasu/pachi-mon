#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),ctx=vm.createContext({console});
for(const s of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(/\bsrc=|application\/ld\+json/.test(s[1]))continue;vm.runInContext(s[2],ctx);if(ctx.LT?.Engine)break;}
const {Engine,DATA:D}=ctx.LT,owner={id:'P1234567890abcdef',isAdmin:true},copy=v=>JSON.parse(JSON.stringify(v));
const {eligible:tradeEligible}=require('../trade-client.js');
const make=()=>{const e=new Engine();assert(e.newGame('komori','female','みどり').ok);e.rng=()=>.999999999;return e;};
const all=Object.keys(D.species),hidden=all.filter(id=>D.species[id].hiddenDex),nullMoves=['null_restore','null_curse','null_ray','null_scorch'];assert.equal(all.length,267);assert.equal(hidden.length,11);
for(const id of D.glitchLine.ids)assert.deepEqual(copy(D.species[id].moves),nullMoves);
const genderless=[...D.genderless],gendered=[...D.starters,...hidden.filter(id=>!genderless.includes(id))];
function assertCapturedGender(engine,mon,gender,enemyUID){
 assert.notEqual(mon.uid,enemyUID,'Capture assigns a new individual ID');assert.equal(engine.genderOf(mon),gender,'The displayed encounter gender survives capture');
 assert.equal(mon.gender,gender==='none'?undefined:gender,'Captured gender is explicit unless the species is genderless');
}
// The operator selector covers every species, including all eleven off-dex
// forms. One capsule captures exactly the chosen form and level.
for(const [i,id] of all.entries()){
 const e=make(),level=i%2?100:1;e.state.inventory.chime=0;
 assert(e.startAdminEncounter(id,level,owner).ok,id);assert.equal(e.battle.enemy.species,id);assert.equal(e.battle.enemy.level,level);
 const enemyUID=e.battle.enemy.uid,gender=e.genderOf(e.battle.enemy);assert.equal(e.battle.enemy.gender,undefined,'Omitted gender retains automatic UID-based selection');
 assert.equal(genderless.includes(id),gender==='none');
 assert.equal(e.resonanceChance(),1);assert.equal(e.state.inventory.chime,1);
 const result=e.action({type:'resonate'});assert(result.ok);assert.equal(e.battle.result,'caught',id);assert.equal(e.state.inventory.chime,0);
 const mon=e.state.party[1];assert.equal(mon.species,id);assert.equal(mon.level,level);
 assertCapturedGender(e,mon,gender,enemyUID);
 const saved=e.serialize(),reloaded=new Engine(saved);assert.deepEqual(copy(reloaded.state.party[1]),copy(mon));
 assert(!JSON.stringify(saved).includes('secretEncounter'),'The permission and 100% capture flag must not persist');
 if(id==='floravelle'||id==='futo'){
  const expected=(id==='floravelle'?'admin-mythical:':'admin-initial:')+owner.id;
  assert.equal(mon.grantId,expected);assert(e.state.giftReceipts.includes(expected));
 }else assert.equal(mon.grantId,undefined);
}
for(const species of ['floravelle',...hidden])for(const denied of [null,{}, {id:owner.id,isAdmin:false},{id:'invalid',isAdmin:true},{id:owner.id,isAdmin:1}]){
 const e=make(),state=JSON.stringify(e.state);assert(!e.startAdminEncounter(species,70,denied).ok);assert.equal(e.battle,null);assert.equal(JSON.stringify(e.state),state);
}
for(const [species,level] of [['missing',70],['floravelle',0],['floravelle',101],['floravelle',1.5],['floravelle','70'],['floravelle',NaN]]){
 const e=make();assert(!e.startAdminEncounter(species,level,owner).ok);assert.equal(e.battle,null);
}
// Each hidden form can be requested normally or shiny, at either level limit,
// into the party or reserve. Capturing at Lv.100 must not auto-evolve it.
for(const id of hidden)for(const shiny of [false,true])for(const level of [1,100])for(const destination of ['party','storage']){
 const e=make();if(destination==='storage')while(e.state.party.length<D.limits.party)e.state.party.push(e.makeMonster('komori',5));
 const before=e.state[destination].length;
 assert(e.startAdminEncounter(id,level,owner,{shiny}).ok);assert.equal(e.battle.enemy.species,id);assert.equal(e.battle.enemy.level,level);assert.equal(e.battle.enemy.shiny,shiny);
 assert.deepEqual(copy(e.moves(e.battle.enemy).map(move=>move.id)),copy(D.species[id].moves));assert.equal(e.resonanceChance(),1);
 const result=e.action({type:'resonate'});assert(result.ok);assert.equal(result.ended,'caught');assert.equal(e.state[destination].length,before+1);
 const mon=e.state[destination].at(-1);assert.equal(mon.species,id);assert.equal(mon.level,level);assert.equal(mon.shiny,shiny);
 assert.deepEqual(Object.keys(mon.pp),copy(D.species[id].moves));for(const move of e.moves(mon))assert.equal(mon.pp[move.id],e.maxPP(move));
 assert.equal(mon.grantId,undefined);assert.throws(()=>e.tradeMonster(mon),/交換/,'Operator capture does not grant exchange eligibility');
 assert.equal(tradeEligible(mon,D),false,'Online trade chooser excludes every off-dex individual');
 const loaded=new Engine(e.serialize()),restored=loaded.state[destination].find(item=>item.uid===mon.uid);
 assert.deepEqual(copy(restored),copy(mon));assert.equal(restored.species,id);assert.equal(restored.level,level);assert.equal(restored.shiny,shiny);
 assert.deepEqual(copy(loaded.moves(restored).map(move=>move.id)),copy(D.species[id].moves));
}
// Explicit genders survive the new capture UID, both destinations, and reload.
// Exercise both sexes for the ordinary starters and every off-dex stage.
for(const id of gendered)for(const gender of ['male','female'])for(const destination of ['party','storage']){
 const e=make();if(destination==='storage')while(e.state.party.length<D.limits.party)e.state.party.push(e.makeMonster('komori',5));
 const level=destination==='party'?1:100;
 assert(e.startAdminEncounter(id,level,owner,{gender,shiny:true}).ok);const enemyUID=e.battle.enemy.uid;
 assert.equal(e.battle.enemy.gender,gender);assert.equal(e.genderOf(e.battle.enemy),gender);assert.equal(e.battle.enemy.shiny,true);
 assert(e.action({type:'resonate'}).ok);const mon=e.state[destination].at(-1);
 assert.equal(mon.species,id);assert.equal(mon.level,level);assertCapturedGender(e,mon,gender,enemyUID);
 const loaded=new Engine(e.serialize()),restored=loaded.state[destination].find(m=>m.uid===mon.uid);
 assert.deepEqual(copy(restored),copy(mon));assert.equal(loaded.genderOf(restored),gender);
}
// Omitted, undefined and auto use the existing individual-ID gender calculation.
// Genderless species stay genderless throughout their guaranteed capture.
for(const id of [...gendered,...genderless])for(const options of [{},{gender:undefined},{gender:'auto'}]){
 const e=make();assert(e.startAdminEncounter(id,1,owner,options).ok);
 const enemy=e.battle.enemy,gender=e.genderOf(enemy);assert.equal(enemy.gender,undefined);
 assert.equal(gender,e.genderOf({uid:enemy.uid,species:id}));assert.equal(genderless.includes(id),gender==='none');
 assert(e.action({type:'resonate'}).ok);assertCapturedGender(e,e.state.party.at(-1),gender,enemy.uid);
}
// Sex is individual data: both ordinary and off-dex evolution chains retain it,
// including a monster caught directly into the reserve and then reloaded.
for(const id of ['komori',...hidden.filter(id=>D.species[id].evolvesTo)])for(const gender of ['male','female'])for(const destination of ['party','storage']){
 let e=make();if(destination==='storage')while(e.state.party.length<D.limits.party)e.state.party.push(e.makeMonster('komori',5));
 assert(e.startAdminEncounter(id,1,owner,{gender}).ok);assert(e.action({type:'resonate'}).ok);e.battle=null;
 const uid=e.state[destination].at(-1).uid;e=new Engine(e.serialize());let mon=e.state[destination].find(m=>m.uid===uid);
 while(D.species[mon.species].evolvesTo){
  const species=D.species[mon.species],events=[];let xp=0;for(let level=mon.level;level<species.evolveLevel;level++)xp+=e.xpToNext(level);
  e.giveXP(mon,xp-mon.xp,events);assert.equal(mon.species,species.evolvesTo);assert.equal(mon.gender,gender);assert.equal(e.genderOf(mon),gender);assert.equal(mon.uid,uid);
  assert(events.some(event=>event.kind==='evolve'));e=new Engine(e.serialize());mon=e.state[destination].find(m=>m.uid===uid);assert.equal(mon.gender,gender);
 }
}
function rejectGender(species,gender){
 const e=make();e.state.inventory.chime=0;const before=JSON.stringify(e.state),cooldown=e.encounterCooldown;
 assert.equal(e.startAdminEncounter(species,70,owner,{gender,shiny:true}).ok,false,`${species}: invalid gender is rejected`);
 assert.equal(e.battle,null);assert.equal(JSON.stringify(e.state),before,'Rejected gender does not change inventory, receipts, collection or other state');assert.equal(e.encounterCooldown,cooldown);
}
const invalidGenders=[null,'','none','random','MALE',0,1,NaN,true,false,[],{},['male'],new String('male')];
for(const id of [...gendered,...genderless])for(const gender of invalidGenders)rejectGender(id,gender);
for(const id of genderless)for(const gender of ['male','female'])rejectGender(id,gender);
assert(!new Engine().startAdminEncounter('floravelle',70,owner).ok);
let e=make();e.startBattle('arvelion',70);const originalBattle=e.battle;
assert(!e.startAdminEncounter('floravelle',70,owner).ok);assert.equal(e.battle,originalBattle);
e=make();e.state.party[0].hp=0;assert(!e.startAdminEncounter('floravelle',70,owner).ok);assert.equal(e.battle,null);
e=make();while(e.state.party.length<D.limits.party)e.state.party.push(e.makeMonster('komori',5));
while(e.state.storage.length<D.limits.storage)e.state.storage.push(e.makeMonster('komori',5));
assert(!e.startAdminEncounter('floravelle',70,owner).ok);assert.equal(e.battle,null);
e.state.storage.pop();assert(e.startAdminEncounter('floravelle',70,owner).ok);assert(e.action({type:'resonate'}).ok);
assert.equal(e.state.storage.at(-1).species,'floravelle');assert.doesNotThrow(()=>new Engine(e.serialize()));
// The private permit cannot be reproduced by another symbol or a string.
e=make();for(const secretPermit of [true,'operator-encounter',Symbol('operator-encounter')])assert(!e.startBattle('floravelle',70,null,{secretPermit}));
assert(!e.startBattle('floravelle',70));assert(!e.startTeamBattle([{species:'floravelle',level:70}]));
assert(Object.values(D.maps).every(map=>!map.encounters.includes('floravelle')));
// Escape/capture do not lend the next ordinary battle the guaranteed rate.
for(const type of ['flee','resonate']){
 e=make();assert(e.startAdminEncounter('arvelion',70,owner).ok);assert(e.action({type}).ok);
 assert.equal(e.battle.result,type==='flee'?'fled':'caught');e.battle=null;
 assert(e.startBattle('arvelion',70));assert.equal(e.resonanceChance(),.01);assert(!e.battle.secretEncounter);
 e.battle.enemy.hp=1;assert.equal(e.resonanceChance(),.06);
 e.battle=null;assert(e.startBattle('komori',5));assert.equal(e.resonanceChance(),.28);
}
// Hidden captures preserve exactly the chosen form/level while existing party
// members still gain experience; ordinary capture progression remains unchanged.
e=make();e.rng=()=>0;assert(e.startBattle('komori',1));assert(e.action({type:'resonate'}).ok);
assert.equal(e.state.party[1].level,2,'Ordinary newly caught monsters still gain battle XP');
e=make();const leadXP=e.state.party[0].xp;assert(e.startAdminEncounter('komori',1,owner).ok);assert(e.action({type:'resonate'}).ok);
assert.equal(e.state.party[1].level,1);assert(e.state.party[0].xp>leadXP,'Existing party XP is preserved');
// Repeated hidden captures keep the single initial entitlement receipt stable.
e=make();for(let n=0;n<2;n++){assert(e.startAdminEncounter('floravelle',70,owner).ok);assert(e.action({type:'resonate'}).ok);e.battle=null;}
assert.equal(e.state.giftReceipts.filter(id=>id==='admin-mythical:'+owner.id).length,1);
assert(e.receiveAdminMythical({grantId:'admin-mythical:'+owner.id,species:'floravelle',level:70}).alreadyReceived);
assert.doesNotThrow(()=>new Engine(e.serialize()));
// The operator's configured Futo and a hidden wild Futo share a server proof,
// not a growth record. Polling must preserve the captured level and appearance
// even after releasing the original or moving it behind the new party member.
const futoGrant={grantId:'admin-initial:'+owner.id,level:70,stats:{hp:1000,atk:300,def:250,spAtk:400,spDef:280,speed:260,accuracy:110,evasion:105},moves:D.species.futo.moves.slice()};
function captureFuto(engine,level){
 assert(engine.startAdminEncounter('futo',level,owner).ok);assert(engine.action({type:'resonate'}).ok);engine.battle=null;
 const mon=[...engine.state.party,...engine.state.storage].filter(m=>m.species==='futo'&&m.customStats===undefined).at(-1);
 mon.nickname='やせい';mon.hp=Math.max(1,mon.hp-3);mon.pp[D.species.futo.moves[0]]=1;mon.xp=1;
 return mon;
}
function syncFuto(engine,grant){assert(engine.grantFuto(grant).alreadyReceived);return engine.updateOwnedFuto(grant.grantId,grant);}
e=make();assert(e.grantFuto(futoGrant).ok);assert(e.releaseParty(1).ok);
let wildFuto=captureFuto(e,1),wildSaved=copy(wildFuto);
for(const level of [70,90]){const outcome=syncFuto(e,{...futoGrant,level});assert(outcome.ok&&outcome.unchanged&&outcome.alreadyReceived);assert.deepEqual(copy(wildFuto),wildSaved);}
e=new Engine(e.serialize());wildFuto=e.state.party.find(m=>m.uid===wildSaved.uid);
assert(syncFuto(e,{...futoGrant,level:85}).unchanged);assert.deepEqual(copy(wildFuto),wildSaved);
assert.equal(e.state.party.filter(m=>m.species==='futo').length,1,'Sync does not recreate the released configured Futo');
e=make();assert(e.grantFuto(futoGrant).ok);
const configured=e.state.party.splice(1,1)[0];e.state.storage.push(configured);
wildFuto=captureFuto(e,12);wildSaved=copy(wildFuto);
const updatedGrant={...futoGrant,level:80,stats:{...futoGrant.stats,hp:1800}};
assert(syncFuto(e,updatedGrant).ok);assert.deepEqual(copy(wildFuto),wildSaved);assert.equal(configured.level,80);assert.equal(configured.customStats.hp,1800);
e=new Engine(e.serialize());wildFuto=e.state.party.find(m=>m.uid===wildSaved.uid);
assert(syncFuto(e,{...updatedGrant,level:90}).ok);assert.deepEqual(copy(wildFuto),wildSaved);assert.equal(e.state.storage[0].level,90);
assert.equal(e.state.giftReceipts.filter(id=>id===futoGrant.grantId).length,1);
// Legacy gifts lack explicit growth/config levels but retain their configured
// stats, so save migration must keep them eligible for operator updates.
const legacy=e.serialize();delete legacy.storage[0].customStatsLevel;delete legacy.storage[0].futoConfigLevel;
e=new Engine(legacy);assert(syncFuto(e,{...updatedGrant,level:95,stats:{...updatedGrant.stats,hp:2200}}).ok);assert.equal(e.state.storage[0].level,95);assert.equal(e.state.storage[0].customStats.hp,2200);
assert.deepEqual(copy(e.state.party.find(m=>m.uid===wildSaved.uid)),wildSaved);
// The UI bridge additionally checks the current authenticated identity and UI
// state before it calls the engine, even if handed an otherwise valid owner.
const start=html.indexOf('    startSecretEncounter:'),end=html.indexOf('    getPlayerName:',start);assert(start>0&&end>start);
function bridge(overrides={}){
 const context=vm.createContext({tradeLocked:()=>false,engine:make(),playing:true,busy:false,LT:{onlineActive:false,Admin:{player:copy(owner)}},closed:0,opened:0,closeModal(){context.closed++;},openBattle(){context.opened++;},...overrides});
 vm.runInContext('globalThis.bridge={'+html.slice(start,end)+'};',context);return context;
}
for(const species of ['floravelle',...hidden])for(const override of [{playing:false},{busy:true},{LT:{onlineActive:true,Admin:{player:copy(owner)}}},{LT:{Admin:{player:{id:owner.id,isAdmin:false}}}},{LT:{Admin:{player:{id:'Paaaaaaaaaaaaaaaa',isAdmin:true}}}}]){
 const c=bridge(override);assert(!c.bridge.startSecretEncounter(species,70,owner).ok);assert.equal(c.opened,0);assert.equal(c.engine.battle,null);
}
let b=bridge();assert(b.bridge.startSecretEncounter('floravelle',70,owner).ok);assert.equal(b.closed,1);assert.equal(b.opened,1);
for(const species of hidden){const c=bridge();assert(c.bridge.startSecretEncounter(species,100,owner,{shiny:true}).ok);assert.equal(c.closed,1);assert.equal(c.opened,1);assert.equal(c.engine.battle.enemy.species,species);assert.equal(c.engine.battle.enemy.shiny,true);}
for(const species of gendered)for(const gender of ['male','female']){
 const c=bridge();assert(c.bridge.startSecretEncounter(species,70,owner,{gender,shiny:true}).ok);
 assert.equal(c.engine.battle.enemy.gender,gender);assert.equal(c.engine.battle.enemy.shiny,true);assert.equal(c.closed,1);assert.equal(c.opened,1);
}
for(const [species,gender] of [['komori',null],['komori','none'],...hidden.map(id=>[id,{}]),...genderless.map(id=>[id,'female'])]){
 const c=bridge(),before=JSON.stringify(c.engine.state);assert(!c.bridge.startSecretEncounter(species,70,owner,{gender}).ok);
 assert.equal(c.engine.battle,null);assert.equal(JSON.stringify(c.engine.state),before);assert.equal(c.closed,0);assert.equal(c.opened,0);
}
// Minimal DOM harness exercises real seven-tap and submit handlers, including
// fresh server authorization for every open and every encounter request.
const source=fs.readFileSync(path.join(root,'secret-encounter.js'),'utf8');
function ui(){
 const state={now:10000,click:null,dialog:null,authCalls:0,startCalls:[],messages:[],admin:true,playing:true};
 function element(tag){return {tag,children:[],get options(){return this.children;},value:'',textContent:'',checked:false,disabled:false,open:false,append(child){this.children.push(child);if(tag==='select'&&this.children.length===1)this.value=child.value;},setAttribute(){},addEventListener(name,fn){this[name]=fn;},showModal(){this.open=true;},close(){this.open=false;}};}
 const document={body:{append(node){state.dialog=node;}},addEventListener(name,fn){if(name==='click')state.click=fn;},querySelectorAll(){return state.dialog?.open?[state.dialog]:[];},createElement(tag){const node=element(tag);if(tag==='dialog'){
  const fields={'#secret-species':element('select'),'#secret-level':element('input'),'#secret-gender':element('select'),'#secret-shiny':element('input'),'#secret-status':element('p'),'#secret-form':element('form'),'[type="submit"]':element('button'),'[data-secret-close]':element('button')};fields['#secret-level'].value='70';node.querySelector=selector=>fields[selector];
  // Read the new select's options from the real markup, so the harness cannot
  // conceal a missing control or incorrect values/labels in the UI source.
  Object.defineProperty(node,'innerHTML',{set(markup){
   const select=markup.match(/<select\b[^>]*\bid="secret-gender"[^>]*>([\s\S]*?)<\/select>/);assert(select,'Gender selector exists in the dialog markup');
   for(const option of select[1].matchAll(/<option\b[^>]*\bvalue="([^"]*)"[^>]*>([^<]*)<\/option>/g)){const child=element('option');child.value=option[1];child.textContent=option[2];fields['#secret-gender'].append(child);}
  }});
 }return node;}};
 const LT={DATA:D,TypeSystem:ctx.LT.TypeSystem,Admin:{async authorizeSecretEncounter(){state.authCalls++;return state.authOwner!==undefined?copy(state.authOwner):state.admin?copy(owner):{id:owner.id,isAdmin:false};}},adminBridge:{isPlaying:()=>state.playing,toast:message=>state.messages.push(message),startSecretEncounter(...args){state.startCalls.push(args);return {ok:true};}}};
 vm.runInNewContext(source,{LT,document,Date:{now:()=>state.now},console});
 state.tap=()=>state.click({target:{closest:selector=>selector==='#pachi-console-title'?{}:null}});
 state.submit=()=>state.dialog.querySelector('#secret-form').onsubmit({preventDefault(){}});
 state.selectSpecies=id=>{const select=state.dialog.querySelector('#secret-species');select.value=id;assert.equal(typeof select.onchange,'function');select.onchange();};
 return state;
}
async function main(){
 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 let u=ui();for(let n=0;n<6;n++)u.tap();await settle();assert.equal(u.authCalls,0);assert.equal(u.dialog,null);
 u.tap();await settle();assert.equal(u.authCalls,1);assert(u.dialog.open);assert.equal(u.dialog.querySelector('#secret-species').children.length,267);
 const choices=u.dialog.querySelector('#secret-species').children;assert.deepEqual(choices.map(option=>option.value).sort(),all.slice().sort());
 let genderSelect=u.dialog.querySelector('#secret-gender');assert.deepEqual(genderSelect.options.map(option=>[option.value,option.textContent]),[['auto','おまかせ'],['male','オス ♂'],['female','メス ♀']]);assert.equal(genderSelect.value,'auto');assert.equal(genderSelect.disabled,false);
 for(const id of hidden){const option=choices.find(option=>option.value===id);assert(option);assert(option.textContent.includes('図鑑外'),'Off-dex operator choices are clearly labelled');assert(option.textContent.includes(ctx.LT.TypeSystem.of(id).map(type=>D.elements[type].name).join('・')),'Both types are displayed in the selector');}
 u.selectSpecies('floravelle');assert.equal(genderSelect.disabled,true);assert.equal(genderSelect.options[0].textContent,'性別なし');await u.submit();assert.equal(u.authCalls,2);assert.equal(u.startCalls.length,1);assert.deepEqual(copy(u.startCalls[0]),['floravelle',70,owner,{shiny:false,gender:'auto'}]);assert(!u.dialog.open);
 u.admin=false;for(let n=0;n<7;n++)u.tap();await settle();assert.equal(u.authCalls,3);assert(!u.dialog.open);assert.equal(u.startCalls.length,1,'Reopening rechecks permissions instead of reusing the earlier authorization');
 for(const id of hidden)for(const shiny of [false,true])for(const level of [1,100]){
  u=ui();for(let n=0;n<7;n++)u.tap();await settle();assert.equal(u.authCalls,1);assert(u.dialog.open);
  u.selectSpecies(id);u.dialog.querySelector('#secret-level').value=String(level);u.dialog.querySelector('#secret-shiny').checked=shiny;
  await u.submit();assert.equal(u.authCalls,2);assert.equal(u.startCalls.length,1);assert.deepEqual(copy(u.startCalls[0]),[id,level,owner,{shiny,gender:'auto'}]);assert(!u.dialog.open);
 }
 for(const id of ['komori',...hidden])for(const gender of ['male','female']){
  u=ui();for(let n=0;n<7;n++)u.tap();await settle();u.selectSpecies(id);u.dialog.querySelector('#secret-gender').value=gender;u.dialog.querySelector('#secret-shiny').checked=true;
  await u.submit();assert.equal(u.authCalls,2);assert.deepEqual(copy(u.startCalls[0]),[id,70,owner,{shiny:true,gender}]);assert(!u.dialog.open);
 }
 u=ui();for(let n=0;n<7;n++)u.tap();await settle();genderSelect=u.dialog.querySelector('#secret-gender');
 for(const id of genderless){
  genderSelect.value='female';u.selectSpecies(id);assert.equal(genderSelect.value,'auto');assert.equal(genderSelect.disabled,true);assert.equal(genderSelect.options[0].textContent,'性別なし');
  genderSelect.value='male';await u.submit();assert.equal(u.authCalls,1);assert.equal(u.startCalls.length,0);assert(u.dialog.querySelector('#secret-status').textContent.includes('性別'));assert(u.dialog.open);
  u.selectSpecies('nullmie');assert.equal(genderSelect.disabled,false);assert.equal(genderSelect.options[0].textContent,'おまかせ');
 }
 // Reopening synchronizes even if the selected species changed while closed.
 u.selectSpecies('futo');u.dialog.querySelector('[data-secret-close]').onclick();u.dialog.querySelector('#secret-species').value='komori';
 for(let n=0;n<7;n++)u.tap();await settle();assert.equal(u.authCalls,2);assert(u.dialog.open);assert.equal(genderSelect.disabled,false);assert.equal(genderSelect.options[0].textContent,'おまかせ');
 assert.equal(genderSelect.value,'auto');
 for(const gender of ['','none','unknown']){genderSelect.value=gender;await u.submit();assert.equal(u.authCalls,2);assert.equal(u.startCalls.length,0);assert(u.dialog.open);assert(u.dialog.querySelector('#secret-status').textContent.includes('性別'));}
 u=ui();u.admin=false;for(let n=0;n<7;n++)u.tap();await settle();assert.equal(u.dialog,null);assert.equal(u.startCalls.length,0);assert(u.messages.some(m=>m.includes('運営専用')));
 for(const authOwner of [null,{}, {id:owner.id,isAdmin:1},{id:'invalid',isAdmin:true}]){
  u=ui();u.authOwner=authOwner;for(let n=0;n<7;n++)u.tap();await settle();assert.equal(u.authCalls,1);assert.equal(u.dialog,null);assert.equal(u.startCalls.length,0);
 }
 u=ui();for(let n=0;n<7;n++)u.tap();await settle();u.admin=false;await u.submit();assert.equal(u.authCalls,2);assert.equal(u.startCalls.length,0);assert(u.dialog.open);
 assert(u.dialog.querySelector('#secret-status').textContent.includes('運営専用'));
 for(const id of hidden){
  u=ui();for(let n=0;n<7;n++)u.tap();await settle();u.selectSpecies(id);u.dialog.querySelector('#secret-gender').value='female';u.admin=false;
  await u.submit();assert.equal(u.authCalls,2);assert.equal(u.startCalls.length,0);assert(u.dialog.open);assert(u.dialog.querySelector('#secret-status').textContent.includes('運営専用'));
 }
 u=ui();for(let n=0;n<6;n++)u.tap();u.now+=2501;u.tap();await settle();assert.equal(u.authCalls,0);
 u=ui();for(let n=0;n<7;n++)u.tap();await settle();u.dialog.querySelector('#secret-level').value='101';await u.submit();assert.equal(u.authCalls,1);assert.equal(u.startCalls.length,0);
 console.log('Secret encounter checks passed: all 267 species capture/save; 11 off-dex forms x normal/shiny x Lv1/100 x party/reserve with exact form and dedicated moves; male/female and automatic gender through capture UID changes, both destinations, reload and evolution; genderless/input rejection without side effects; owner/battle/capacity guards, private permit, special receipts, hidden Futo sync/reload and legacy gifts, normal odds restored, bridge identity/gender forwarding, seven-tap UI, gender switching/reopening/validation, off-dex labels, and fresh authorization on every open/submit including revoked permissions.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
