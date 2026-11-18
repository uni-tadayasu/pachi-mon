#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),ctx=vm.createContext({console});
for(const s of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(/\bsrc=|application\/ld\+json/.test(s[1]))continue;vm.runInContext(s[2],ctx);if(ctx.LT?.Engine)break;}
const {Engine,DATA:D}=ctx.LT,owner={id:'P1234567890abcdef',isAdmin:true},copy=v=>JSON.parse(JSON.stringify(v));
const make=()=>{const e=new Engine();assert(e.newGame('komori','female','みどり').ok);e.rng=()=>.999999999;return e;};
const all=Object.keys(D.species).filter(id=>!D.species[id].hiddenDex);assert.equal(all.length,256);
// Every public species is selectable, capturable with one capsule, and
// round-trippable, including starter bases, special species and every evolution.
for(const [i,id] of all.entries()){
 const e=make(),level=i%2?100:1;e.state.inventory.chime=0;
 assert(e.startAdminEncounter(id,level,owner).ok,id);assert.equal(e.battle.enemy.species,id);assert.equal(e.battle.enemy.level,level);
 assert.equal(e.resonanceChance(),1);assert.equal(e.state.inventory.chime,1);
 const result=e.action({type:'resonate'});assert(result.ok);assert.equal(e.battle.result,'caught',id);assert.equal(e.state.inventory.chime,0);
 const mon=e.state.party[1];assert.equal(mon.species,id);assert.equal(mon.level,level);
 const saved=e.serialize(),reloaded=new Engine(saved);assert.deepEqual(copy(reloaded.state.party[1]),copy(mon));
 assert(!JSON.stringify(saved).includes('secretEncounter'),'The permission and 100% capture flag must not persist');
 if(id==='floravelle'||id==='futo'){
  const expected=(id==='floravelle'?'admin-mythical:':'admin-initial:')+owner.id;
  assert.equal(mon.grantId,expected);assert(e.state.giftReceipts.includes(expected));
 }else assert.equal(mon.grantId,undefined);
}
for(const denied of [null,{}, {id:owner.id,isAdmin:false},{id:'invalid',isAdmin:true},{id:owner.id,isAdmin:1}]){
 const e=make(),state=JSON.stringify(e.state);assert(!e.startAdminEncounter('floravelle',70,denied).ok);assert.equal(e.battle,null);assert.equal(JSON.stringify(e.state),state);
}
for(const [species,level] of [['missing',70],['floravelle',0],['floravelle',101],['floravelle',1.5],['floravelle','70'],['floravelle',NaN]]){
 const e=make();assert(!e.startAdminEncounter(species,level,owner).ok);assert.equal(e.battle,null);
}
for(const id of D.glitchLine.ids){
 const e=make(),before=JSON.stringify(e.state);assert(!e.startAdminEncounter(id,5,owner).ok,id+' cannot bypass its glitch acquisition');
 assert.equal(e.battle,null);assert.equal(JSON.stringify(e.state),before);
}
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
for(const override of [{playing:false},{busy:true},{LT:{onlineActive:true,Admin:{player:copy(owner)}}},{LT:{Admin:{player:{id:owner.id,isAdmin:false}}}},{LT:{Admin:{player:{id:'Paaaaaaaaaaaaaaaa',isAdmin:true}}}}]){
 const c=bridge(override);assert(!c.bridge.startSecretEncounter('floravelle',70,owner).ok);assert.equal(c.opened,0);assert.equal(c.engine.battle,null);
}
let b=bridge();assert(b.bridge.startSecretEncounter('floravelle',70,owner).ok);assert.equal(b.closed,1);assert.equal(b.opened,1);
// Minimal DOM harness exercises real seven-tap and submit handlers, including
// fresh server authorization for every open and every encounter request.
const source=fs.readFileSync(path.join(root,'secret-encounter.js'),'utf8');
function ui(){
 const state={now:10000,click:null,dialog:null,authCalls:0,startCalls:[],messages:[],admin:true,playing:true};
 function element(tag){return {tag,children:[],value:'',textContent:'',disabled:false,open:false,append(child){this.children.push(child);if(tag==='select'&&this.children.length===1)this.value=child.value;},setAttribute(){},addEventListener(name,fn){this[name]=fn;},showModal(){this.open=true;},close(){this.open=false;}};}
 const document={body:{append(node){state.dialog=node;}},addEventListener(name,fn){if(name==='click')state.click=fn;},querySelectorAll(){return state.dialog?.open?[state.dialog]:[];},createElement(tag){const node=element(tag);if(tag==='dialog'){
  const fields={'#secret-species':element('select'),'#secret-level':element('input'),'#secret-status':element('p'),'#secret-form':element('form'),'[type="submit"]':element('button'),'[data-secret-close]':element('button')};fields['#secret-level'].value='70';node.querySelector=selector=>fields[selector];
 }return node;}};
 const LT={DATA:D,Admin:{async authorizeSecretEncounter(){state.authCalls++;return state.admin?copy(owner):{id:owner.id,isAdmin:false};}},adminBridge:{isPlaying:()=>state.playing,toast:message=>state.messages.push(message),startSecretEncounter(...args){state.startCalls.push(args);return {ok:true};}}};
 vm.runInNewContext(source,{LT,document,Date:{now:()=>state.now},console});
 state.tap=()=>state.click({target:{closest:selector=>selector==='#pachi-console-title'?{}:null}});
 state.submit=()=>state.dialog.querySelector('#secret-form').onsubmit({preventDefault(){}});
 return state;
}
async function main(){
 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 let u=ui();for(let n=0;n<6;n++)u.tap();await settle();assert.equal(u.authCalls,0);assert.equal(u.dialog,null);
 u.tap();await settle();assert.equal(u.authCalls,1);assert(u.dialog.open);assert.equal(u.dialog.querySelector('#secret-species').children.length,256);
 assert(!u.dialog.querySelector('#secret-species').children.some(option=>D.species[option.value].hiddenDex),'Off-dex creatures are absent from the operator selector');
 for(const id of D.glitchLine.ids){u.dialog.querySelector('#secret-species').value=id;await u.submit();assert.equal(u.authCalls,1);assert.equal(u.startCalls.length,0);assert(u.dialog.open);}
 u.dialog.querySelector('#secret-species').value='floravelle';await u.submit();assert.equal(u.authCalls,2);assert.equal(u.startCalls.length,1);assert.equal(u.startCalls[0][0],'floravelle');assert.equal(u.startCalls[0][1],70);assert(!u.dialog.open);
 u=ui();u.admin=false;for(let n=0;n<7;n++)u.tap();await settle();assert.equal(u.dialog,null);assert.equal(u.startCalls.length,0);assert(u.messages.some(m=>m.includes('運営専用')));
 u=ui();for(let n=0;n<7;n++)u.tap();await settle();u.admin=false;await u.submit();assert.equal(u.authCalls,2);assert.equal(u.startCalls.length,0);assert(u.dialog.open);
 assert(u.dialog.querySelector('#secret-status').textContent.includes('運営専用'));
 u=ui();for(let n=0;n<6;n++)u.tap();u.now+=2501;u.tap();await settle();assert.equal(u.authCalls,0);
 u=ui();for(let n=0;n<7;n++)u.tap();await settle();u.dialog.querySelector('#secret-level').value='101';await u.submit();assert.equal(u.authCalls,1);assert.equal(u.startCalls.length,0);
 console.log('Secret encounter checks passed: all 256 species capture/save, Lv1/100, owner/input/battle/capacity guards, private permit, special receipts, hidden Futo growth across sync/reload and legacy gift updates, normal odds restored, bridge identity checks, seven-tap UI and fresh authorization on submit.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
