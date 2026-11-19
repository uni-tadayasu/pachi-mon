#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),model=vm.createContext({console});
const blocks=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!/\bsrc=|application\/ld\+json/.test(m[1])).map(m=>m[2]);
for(const code of blocks){vm.runInContext(code,model);if(model.LT?.Engine)break;}
vm.runInContext(blocks.find(code=>code.includes('deterministic, save-independent rental-team duels')),model);
const {Engine,DATA:D,Duel}=model.LT,copy=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function extract(start,end){const from=html.indexOf(start),to=html.indexOf(end,from);assert(from>0&&to>from);return html.slice(from,to);}
function soloGame(){const e=new Engine();e.newGame(D.starters[0]);e.state.party.push(e.makeMonster(D.starters[1],20),e.makeMonster(D.starters[2],20));assert(e.startBattle('komori',1));e.rng=()=>.5;return e;}
const nodes=new Map();
const c=vm.createContext({console,DATA:D,engine:soloGame(),busy:false,activePane:'',endingActive:false,pressedDirection:null,playing:true,
  escape:esc,nameOf:model.LT.displayName,portrait:()=>'<canvas></canvas>',conditionChip:()=>'',
  $:id=>nodes.get(id),sound:{preview(){}},updateScene(){},
  document:{querySelector(selector){return {focus(){c.returnFocus=selector;}};}},
  toast(message){c.message=message;},battleActions(view){c.returnView=view;},
  doBattle(action){c.actions++;c.engine.action(action);},chooseBattleReplacement(index){c.actions++;c.engine.chooseReplacement(index);},
  openModal(title,markup,pane){c.modal={title,markup,pane};c.activePane=pane;nodes.set('modal',{open:true,close(){this.open=false;}});for(const match of markup.matchAll(/id="([^"]+)"/g))nodes.set(match[1],{focus(){c.focused=match[1];}});}
});
nodes.set('game-canvas',{focus(){}});
vm.runInContext(extract('  let battleSwitchConfirmation=null;','  function openBattle()'),c);
vm.runInContext(extract('  function closeModal()','  function showDialogue('),c);
const soloSnapshot=()=>JSON.stringify({state:c.engine.serialize(),battle:c.engine.battle});
function soloReset(){c.engine=soloGame();c.busy=false;c.actions=0;c.modal=null;c.message='';c.returnView=null;vm.runInContext('battleSwitchConfirmation=null',c);}
soloReset();c.engine.state.party[1].nickname='<みず>';let before=soloSnapshot();
c.confirmBattleSwitch(1);assert.equal(c.modal.pane,'battle-switch-confirm');assert.equal(c.focused,'battle-switch-cancel');
assert(c.modal.markup.includes('&lt;みず&gt;'));assert(!c.modal.markup.includes('<みず>'));assert(c.modal.markup.includes('1ターン'));
assert.equal(soloSnapshot(),before,'Selecting a candidate does not switch, spend a turn or change the save');
const cancelledCallback=nodes.get('battle-switch-confirm').onclick;
nodes.get('battle-switch-cancel').onclick();assert.equal(c.actions,0);assert.equal(soloSnapshot(),before);assert.equal(c.returnView,'switch');assert.equal(c.returnFocus,'[data-switch="1"]');
cancelledCallback();assert.equal(c.actions,0,'A detached cancelled confirmation is inert');
c.confirmBattleSwitch(1);const confirmedCallback=nodes.get('battle-switch-confirm').onclick;confirmedCallback();confirmedCallback();
assert.equal(c.actions,1,'Two rapid confirm activations cause one action');assert.equal(c.engine.battle.activeIndex,1);assert.equal(c.engine.battle.turn,1);
// All dismissal routes use the same close handler, retaining the selection screen.
soloReset();c.confirmBattleSwitch(2);before=soloSnapshot();c.closeModal();assert.equal(soloSnapshot(),before);assert.equal(c.returnView,'switch');
assert(html.includes("activePane==='battle-switch-confirm'){e.preventDefault();closeModal();}"));
assert(html.includes("activePane==='battle-switch-confirm'?$('battle-switch-cancel'):null"),'Gamepad defaults to choosing again');
assert(html.includes('confirmBattleSwitch(Number(d.replacement),true)'));assert(html.includes('confirmBattleSwitch(Number(d.switch))'));
// A fainted ally remains selected until the player confirms; no extra attack/turn.
soloReset();c.engine.state.party[0].hp=0;c.engine.battle.pendingReplacement={enemyIndex:null,allyRequired:true};
before=soloSnapshot();const turn=c.engine.battle.turn;c.confirmBattleSwitch(2,true);
assert(c.modal.markup.includes('ターンを消費しません'));assert.equal(soloSnapshot(),before);
nodes.get('battle-switch-cancel').onclick();assert.equal(soloSnapshot(),before);assert.equal(c.returnView,'main');assert.equal(c.returnFocus,'[data-replacement="2"]');
c.confirmBattleSwitch(2,true);const hp=c.engine.state.party[2].hp;nodes.get('battle-switch-confirm').onclick();
assert.equal(c.engine.battle.activeIndex,2);assert.equal(c.engine.battle.turn,turn);assert.equal(c.engine.state.party[2].hp,hp);assert.equal(c.actions,1);
// Enemy-to-enemy optional switches are also confirmed and are free.
soloReset();c.engine.battle.enemyTeam=[c.engine.battle.enemy,c.engine.makeMonster('komori',1)];c.engine.battle.enemyIndex=0;c.engine.battle.enemy.hp=0;
c.engine.battle.pendingReplacement={enemyIndex:1,allyRequired:false};c.confirmBattleSwitch(1,true);assert.equal(c.actions,0);
nodes.get('battle-switch-confirm').onclick();assert.equal(c.engine.battle.activeIndex,1);assert.equal(c.engine.battle.turn,0);assert.equal(c.engine.battle.enemyIndex,1);
// A successful large attack may defeat a trainer member before its recharge.
// Render the real replacement menu: only continuing with that actor is enabled.
{
 soloReset();const e=c.engine,actor=e.state.party[0],box={innerHTML:''};
 actor.rechargeTurns=1;e.battle.enemyTeam=[e.battle.enemy,e.makeMonster('komori',1)];e.battle.enemyIndex=0;e.battle.enemy.hp=0;e.battle.pendingReplacement={enemyIndex:1,allyRequired:false};
 const before=soloSnapshot(),pp=copy(actor.pp),menu=vm.createContext({engine:e,DATA:D,escape:esc,nameOf:model.LT.displayName,portrait:()=>'<canvas></canvas>',paintPortraits(){},$:id=>{assert.equal(id,'battle-actions');return box;}});
 vm.runInContext(extract('  function battleActions(','  function captureBattleView('),menu);menu.battleActions();
 const buttons=[...box.innerHTML.matchAll(/<button\b([^>]*)>/g)].map(match=>({index:Number(/data-replacement="(\d+)"/.exec(match[1])?.[1]),disabled:/\bdisabled\b/.test(match[1])}));
 assert.deepEqual(buttons,[{index:0,disabled:false},{index:1,disabled:true},{index:2,disabled:true}]);
 assert(box.innerHTML.includes('技の反動が残っている'));assert(box.innerHTML.includes('次の1ターンを休みます'));assert.equal(soloSnapshot(),before,'Rendering the recharge restriction does not alter the battle');
 c.confirmBattleSwitch(0,true);assert.equal(c.actions,1);assert.equal(e.battle.activeIndex,0);assert.equal(e.battle.enemyIndex,1);assert.equal(e.battle.turn,0);assert.equal(actor.rechargeTurns,1);assert.deepEqual(copy(actor.pp),pp);
}
// Invalid targets and stale confirmations never act on a new occupant/round.
for(const invalid of [-1,99,1.5,NaN,'1',0]){soloReset();c.confirmBattleSwitch(invalid);assert.equal(c.modal,null);assert.equal(c.actions,0);}
for(const changed of ['hp','uid','turn','active','pending','engine','battle','busy']){
  soloReset();c.confirmBattleSwitch(1);const callback=nodes.get('battle-switch-confirm').onclick;
  if(changed==='hp')c.engine.state.party[1].hp=0;
  if(changed==='uid')c.engine.state.party[1]=c.engine.makeMonster(D.starters[1],20);
  if(changed==='turn')c.engine.battle.turn++;
  if(changed==='active')c.engine.battle.activeIndex=2;
  if(changed==='pending')c.engine.battle.pendingReplacement={enemyIndex:null,allyRequired:true};
  if(changed==='engine')c.engine=soloGame();
  if(changed==='battle')c.engine.battle=null;
  if(changed==='busy')c.busy=true;
  before=soloSnapshot();callback();assert.equal(c.actions,0,changed+' invalidates confirmation');assert.equal(soloSnapshot(),before,changed+' preserves the current state');
}
const onlineNodes=new Map();
const online=vm.createContext({console,D,performance:{now:()=>1},LT:{BattleVFX:{onlineBusy:()=>false},TypeSystem:model.LT.TypeSystem,Abilities:model.LT.Abilities},peer:{role:0,connected:true,state:'open'},
  view:null,session:null,orders:[],orderTurn:0,submitting:false,switchConfirmation:null,playbackLocked:false,lastShown:-1,mode:'single',room:'TEST',error:'',
  esc,monLabel:mon=>mon.nickname||D.species[mon.species].name,modeName:()=>online.mode==='single'?'シングルバトル':'ダブルバトル',portrait:()=>'<canvas></canvas>',$:id=>onlineNodes.get(id),
  body:{set innerHTML(markup){online.markup=markup;onlineNodes.clear();for(const match of markup.matchAll(/id="([^"]+)"/g))onlineNodes.set(match[1],{hidden:false,focus(){online.focused=match[1];}});}},
  failure(message){online.error=message?.message||message;online.render();},render(){online.renderBattle();},close(){online.closed=true;}
});
vm.runInContext(extract('  function linkAbility(value,disclosure=false){','  const monLabel='),online);
vm.runInContext(extract('  function linkConditions(mon){','  function draw(){const canvas='),online);
vm.runInContext(extract('  function requestClose(){','  function setupSession(role){'),online);
const ids=Object.keys(D.species).filter(id=>!D.species[id].specialOnly);
function onlineReset(mode='single',replacing=false){
  const count=mode==='single'?3:4,duel=new Duel({mode,teams:[ids.slice(0,count),ids.slice(5,5+count)],seed:1234});
  if(replacing){duel.state.teams[0].monsters[0].hp=0;if(mode==='double')duel.state.teams[0].monsters[1].hp=0;duel._replaceFainted();}
  online.mode=mode;online.calls=[];online.error='';online.closed=false;online.leaving=false;online.submitting=false;online.switchConfirmation=null;online.orderTurn=0;online.orders=[];online.LT.BattleVFX.onlineBusy=()=>false;
  online.session={duel,async submit(orders){online.calls.push(copy(orders));online.view.localSubmitted=true;return {ok:true};}};
  online.view={battle:duel.state,phase:'choosing',localSubmitted:false,remoteSubmitted:false,outcomeConfirmed:false};online.render();return duel;
}
(async()=>{
  let duel=onlineReset();online.orders=[{type:'switch',slot:0,index:2}];before=JSON.stringify(duel.state);
  await online.requestSubmitOrders();assert(online.switchConfirmation);assert(online.markup.includes('この内容で交代しますか'));assert.equal(online.focused,'link-switch-cancel');
  assert.equal(online.calls.length,0);assert.equal(JSON.stringify(duel.state),before);assert(!online.view.localSubmitted);
  const selected=copy(online.orders);online.cancelSwitchConfirmation();assert.deepEqual(copy(online.orders),selected);assert.equal(online.calls.length,0);assert.equal(online.focused,'link-submit');
  await online.requestSubmitOrders();online.view.remoteSubmitted=true;online.render();assert(online.switchConfirmation,'Remote commit preserves the local confirmation and selection');
  await Promise.all([online.confirmSwitchOrders(),online.confirmSwitchOrders()]);assert.equal(online.calls.length,1);assert.deepEqual(online.calls[0],selected);
  // Doubles show both selected replacements, or the move that is submitted beside a switch.
  duel=onlineReset('double');online.orders=[{type:'switch',slot:0,index:2},{type:'switch',slot:1,index:3}];await online.requestSubmitOrders();
  assert.equal((online.markup.match(/class="link-switch-row"/g)||[]).length,2);assert.equal(online.calls.length,0);await online.confirmSwitchOrders();assert.equal(online.calls[0].length,2);
  duel=onlineReset('double');online.orders=[{type:'switch',slot:0,index:2},{type:'move',slot:1,move:0,target:0}];await online.requestSubmitOrders();assert(online.markup.includes('link-switch-other'));assert(online.markup.includes(esc(duel.moves(duel.active(0)[1])[0].name)));
  online.requestClose();assert.equal(online.switchConfirmation,null);assert.equal(online.calls.length,0);assert(!online.leaving&&!online.closed,'Esc/B closes the switch preview before the room leave flow');
  // Faint replacements, including two empty slots, remain entirely pending until confirmed.
  for(const mode of ['single','double']){
    duel=onlineReset(mode,true);const startTurn=duel.state.turn;
    online.orders=mode==='single'?[{type:'switch',slot:0,index:2}]:[{type:'switch',slot:0,index:3},{type:'switch',slot:1,index:2}];
    before=JSON.stringify(duel.state);await online.requestSubmitOrders();assert(online.markup.includes('ターンを消費しません'));online.cancelSwitchConfirmation();assert.equal(JSON.stringify(duel.state),before);assert.equal(online.calls.length,0);
    await online.requestSubmitOrders();await online.confirmSwitchOrders();assert.equal(online.calls.length,1);duel.resolve([online.calls[0],[]]);assert.equal(duel.state.turn,startTurn);assert.equal(duel.state.phase,'action');
  }
  // Invalid doubles never open a confirmation or send an invalid reserve twice.
  onlineReset('double');online.orders=[{type:'switch',slot:0,index:2},{type:'switch',slot:1,index:2}];await online.requestSubmitOrders();assert.equal(online.switchConfirmation,null);assert.equal(online.calls.length,0);assert(online.error);
  for(const change of ['round','phase','ended','session','order','playback']){
    duel=onlineReset();online.orders=[{type:'switch',slot:0,index:1}];await online.requestSubmitOrders();
    if(change==='round')duel.state.round++;
    if(change==='phase')duel.state.phase='replacement';
    if(change==='ended')online.view.phase='ended';
    if(change==='session')online.session={...online.session};
    if(change==='order')online.orders=[{type:'switch',slot:0,index:2}];
    if(change==='playback')online.LT.BattleVFX.onlineBusy=()=>true;
    await online.confirmSwitchOrders();assert.equal(online.calls.length,0,change+' blocks stale submission');assert.equal(online.switchConfirmation,null);
  }
  // Moves without a switch retain the existing one-click submit behavior.
  onlineReset();await online.requestSubmitOrders();assert.equal(online.calls.length,1);assert.equal(online.switchConfirmation,null);
  console.log('Battle switch UI checks passed: normal/free/forced solo confirmation, recharge disables optional swaps while keeping continue enabled, cancellation and focus, escaped names, stale/double-click guards, single/double online summaries, unchanged orders on cancel/remote commit, replacement turns, duplicate reserves, disconnect/round/session/playback guards and normal move submission.');
})().catch(error=>{console.error(error);process.exitCode=1;});
