#!/usr/bin/env node
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)],context=vm.createContext({console});
for(const script of scripts){if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;vm.runInContext(script[2],context);if(context.LT?.Engine)break;}
const {Engine,DATA:D,KasaiRules:Rules}=context.LT,copy=value=>JSON.parse(JSON.stringify(value));
const player='P0123456789abcdef',receipt={id:'kasai-reward:'+player,grantId:'kasai-reward:'+player,species:'floravelle',level:70,gender:'female'};
function game(level=100){const e=new Engine();e.newGame('komori');e.state.party=['akehomura','shizunaria','komorizen','arvelion','astralith','setsurei'].map((id,index)=>({...e.makeMonster(id,level),uid:'challenge-ally-'+index}));for(const mon of e.state.party)e.markCaught(mon.species);return e;}
const adminParty=(e,entries=[['shizunaria',63],['fuwari',41],['akehomura',82]])=>copy(Rules.normalizeParty(entries.map(([species,level],index)=>({...e.makeMonster(species,level),uid:'admin-snapshot-'+index}))));
const challenge=(e,seed=57,opponents=adminParty(e))=>({id:'challenge-test',token:'test-token-for-replay',seed,rulesVersion:Rules.version,party:copy(Rules.normalizeParty(e.state.party)),opponents:copy(opponents)});
function battle(e){
  for(let i=0;i<Rules.maxActions&&!e.battle.result;i++){
    if(e.battle.pendingReplacement){const index=e.state.party.findIndex(mon=>mon.hp>0);assert(e.chooseReplacement(index).ok);continue;}
    const mon=e.state.party[e.battle.activeIndex],enemy=e.battle.enemy,stats=e.battleStats(mon,'ally'),opponent=e.battleStats(enemy,'enemy');
    let choices=e.moves(mon).map((move,index)=>({move,index})).filter(({move})=>e.movePP(mon,move.id)>0);
    let healing=choices.find(({move})=>move.kind==='heal');
    if(healing&&mon.hp/e.stats(mon).hp<.35&&e.battle.turn%3===0){assert(e.action({type:'move',index:healing.index}).ok);continue;}
    choices=choices.filter(({move})=>move.kind==='attack'&&move.power>0).map(item=>({...item,score:item.move.power*e.effectiveness(item.move.element,context.LT.TypeSystem.of(enemy))*(item.move.category==='physical'?stats.atk/opponent.def:stats.spAtk/opponent.spDef)})).sort((a,b)=>b.score-a.score);
    const pick=choices[0]||e.moves(mon).map((move,index)=>({move,index})).find(({move})=>e.movePP(mon,move.id)>0);
    const result=e.action(pick?{type:'move',index:pick.index}:{type:'struggle'});assert(result.ok,result.message);
  }
  return e.finishBattle();
}

test('the live Engine uses the captured administrator party and the literal server replay agrees',async()=>{
  const replay=await import('../server/kasai-replay.mjs');
  assert.equal(replay.RULES_VERSION,Rules.version,'Server replay and browser must share the current rule tag');
  const variants=[{seed:1,entries:[['fuwari',41]]},{seed:57,entries:[['shizunaria',63],['fuwari',41],['akehomura',82]]},
    {seed:0xffffffff,entries:[['setsurei',76],['komorizen',45],['akehomura',82],['shizunaria',63],['fuwari',41],['astralith',74]]}];
  for(const {seed,entries} of variants){
    const e=game(),start=challenge(e,seed,adminParty(e,entries)),snapshot=JSON.stringify(start),beforeRng=e.rng;assert(e.startKasaiBattle(start).ok);assert(e.isTrainerBattle());
    assert.deepEqual(copy(e.battle.enemyTeam.map(mon=>[mon.species,mon.level])),entries);assert(e.battle.kasai);assert.equal(e.battle.enemy,e.battle.enemyTeam[0]);
    const result=battle(e);assert.equal(result.result,'won');assert.equal(result.kasai,true);assert.equal(e.rng,beforeRng);assert.equal(JSON.stringify(start),snapshot,'Battle must never mutate the server snapshot');
    if(entries.length>1)assert(result.challenge.actions.some(action=>action.type==='replace'));
    assert(result.challenge.actions.every(action=>Rules.normalizeAction(action)));
    assert.equal(replay.replayChallenge(start.party,seed,result.challenge.actions,start.opponents).won,true);
    assert.equal(replay.replayChallenge(start.party,seed,[...result.challenge.actions,{type:'move',index:0}],start.opponents).ok,false,'No commands may follow the actual terminal win');
    const bad=copy(result.challenge.actions);bad[0].damage=999999;assert.equal(replay.replayChallenge(start.party,seed,bad,start.opponents).ok,false);
    assert.equal(replay.replayChallenge(start.party,seed,result.challenge.actions).ok,false,'New challenges cannot fall back to the old fixed team');
  }
});
test('loss, incomplete play, forbidden actions and malformed opponent snapshots cannot form a victory',async()=>{
  const replay=await import('../server/kasai-replay.mjs'),e=game(5);e.state.party=e.state.party.slice(0,1);const start=challenge(e);assert(e.startKasaiBattle(start).ok);
  const before=JSON.stringify({state:e.state,battle:e.battle});
  for(const type of ['item','resonate','flee','won'])assert.equal(e.action({type,id:'salve',index:0}).ok,false);
  assert.equal(JSON.stringify({state:e.state,battle:e.battle}),before);assert.equal(e.battle.kasaiChallenge.actions.length,0);
  const result=battle(e);assert.equal(result.result,'lost');assert.equal(replay.replayChallenge(start.party,start.seed,result.challenge.actions,start.opponents).won,false);
  assert.equal(replay.replayChallenge(start.party,start.seed,[],start.opponents).won,false);assert.equal(replay.replayChallenge(start.party,-1,[{type:'move',index:0}],start.opponents).ok,false);
  const fresh=game();for(const rulesVersion of ['old','kasai-solo-v57']){
    const stale={...challenge(fresh),rulesVersion},state=JSON.stringify(fresh.state);
    assert.equal(fresh.startKasaiBattle(stale).ok,false);assert.equal(JSON.stringify(fresh.state),state);assert.equal(fresh.battle,null);
    assert.equal(replay.replayChallenge(stale.party,stale.seed,[{type:'move',index:0}],stale.opponents,rulesVersion).ok,false,'A pre-replacement transcript cannot run under the new lunar rules');
  }
  for(const opponents of [undefined,null,[],Array.from({length:7},(_,i)=>({...adminParty(fresh)[0],uid:'extra-'+i})),[{...adminParty(fresh)[0],species:'invented'}]]){
    const invalid={...challenge(fresh),opponents},unchanged=JSON.stringify(fresh.state);assert.equal(fresh.startKasaiBattle(invalid).ok,false);assert.equal(JSON.stringify(fresh.state),unchanged);assert.equal(fresh.battle,null);
    assert.equal(replay.replayChallenge(invalid.party,invalid.seed,[{type:'move',index:0}],opponents).ok,false);
  }
  const changed=challenge(fresh);fresh.state.party[0].hp--;assert.equal(fresh.startKasaiBattle(changed).ok,false);assert.equal(fresh.battle,null);
});
test('an actual v56 winning transcript replays only under the explicit legacy rules version',async()=>{
  const replay=await import('../server/kasai-replay.mjs'),e=game(),party=copy(Rules.normalizeParty(e.state.party));
  // Recorded against published v56 HEAD, seed 57, before the party-snapshot change.
  const actions=[{type:'move',index:0},{type:'move',index:0},{type:'replace',index:0},{type:'move',index:0},{type:'replace',index:0},{type:'move',index:0}];
  assert.equal(Rules.legacyVersion,'kasai-solo-v56');assert.equal(Rules.version,'kasai-solo-v74');
  assert.equal(replay.replayChallenge(party,57,actions,null,Rules.legacyVersion).won,true);
  assert.equal(replay.replayChallenge(party,57,actions).ok,false);assert.equal(replay.replayChallenge(party,57,actions,null,'unknown').ok,false);
  assert(e.startKasaiBattle({id:'legacy-session',token:'legacy-token-12345678',seed:57,rulesVersion:Rules.legacyVersion,party}).ok);
  assert.deepEqual(copy(e.battle.enemyTeam.map(mon=>[mon.species,mon.level])),[['arvelion',70],['futo',70],['floravelle',70]]);
  for(const action of actions)assert((action.type==='replace'?e.chooseReplacement(action.index):e.action(action)).ok);
  assert.equal(e.finishBattle().result,'won');
});
test('administrator snapshots preserve individuality, configured Futo moves, ordering and healing without touching the source party',()=>{
  const e=game(),first=e.makeMonster('komorizen',77),futo=e.makeMonster('futo',80,{hp:1000,atk:300,def:100,spAtk:300,spDef:100,speed:200,accuracy:100,evasion:100},D.species.futo.moves.slice().reverse());
  Object.assign(first,{uid:'admin-lead',xp:23,hp:1,nickname:'みどり',shiny:true,gender:'female',alloc:{hp:10,atk:30,def:12},bonusPoints:4,moveOrder:[3,1,2,0],heldItem:'learnsash',curse:true,status:'scorch'});
  Object.assign(futo,{uid:'admin-futo',grantId:'admin-initial:'+player,customStatsLevel:70,futoConfigLevel:80,nickname:'フー',xp:19,hp:1,moveOrder:[1,3,0,2]});
  for(const mon of [first,futo])mon.pp[Object.keys(mon.pp)[0]]=0;
  const opponents=copy(Rules.normalizeParty([futo,first])),start=challenge(e,91,opponents),before=JSON.stringify(start);assert(e.startKasaiBattle(start).ok);
  const retained=mon=>{const {uid,hp,pp,status,...rest}=mon;return rest;};
  assert.deepEqual(copy(e.battle.enemyTeam.map(retained)),opponents.map(retained));
  for(const mon of e.battle.enemyTeam){assert.equal(mon.hp,e.stats(mon).hp);for(const move of e.moves(mon))assert.equal(mon.pp[move.id],e.maxPP(move));assert.equal(mon.status,undefined);}
  assert.equal(e.battle.enemy.species,'futo');assert.equal(e.battle.enemy.customStatsLevel,70);assert.equal(e.battle.enemy.futoConfigLevel,80);
  assert.equal(e.battle.enemyTeam[1].curse,true);assert.equal(e.battle.enemyTeam[1].gender,'female');assert.equal(e.battle.enemyTeam[1].nickname,'みどり');
  assert.equal(JSON.stringify(start),before);e.battle.enemy.customMoves[0]='changed';e.battle.enemyTeam[1].alloc.atk=0;
  assert.equal(JSON.stringify(start),before,'Enemy nested structures must not share the immutable server snapshot');
});
test('a reserve full gift fails without mutation even with five empty party slots; explicit retry creates exactly one',()=>{
  const e=game();e.state.party=e.state.party.slice(0,1);e.state.storage=Array.from({length:192},(_,index)=>({...e.makeMonster('fuwari',1),uid:'stored-'+index}));e.markCaught('fuwari');
  const before=JSON.stringify(e.state);assert(e.receiveKasaiReward(receipt).storageFull);assert.equal(JSON.stringify(e.state),before);e.state.storage.pop();
  assert(!e.state.giftReceipts.includes(receipt.id));assert.equal(e.state.party.length,1,'Making room does not grant a gift by itself');
  const result=e.receiveKasaiReward(receipt);assert(result.ok);assert.equal(result.destination,'party');const mon=e.state.party.find(mon=>mon.species==='floravelle');assert.equal(mon.level,70);assert.equal(mon.gender,'female');assert.equal(e.genderOf(mon),'female');
  const same=JSON.stringify(e.state);assert(e.receiveKasaiReward({...receipt,gender:'male'}).alreadyReceived);assert.equal(JSON.stringify(e.state),same);
  e.state.party=e.state.party.filter(other=>other.uid!==mon.uid);assert(e.receiveKasaiReward(receipt).alreadyReceived);assert(!e.state.party.some(other=>other.uid===mon.uid),'Releasing a gift never makes a second gift available');
});
test('challenge normalization preserves each individual and growth data; only the promised battle healing changes HP, PP and ordinary status',()=>{
  const e=game(77);e.state.party=e.state.party.slice(0,1);Object.assign(e.state.party[0],{xp:23,hp:1,nickname:'ほのお',shiny:true,alloc:{hp:10,atk:30,def:12},bonusPoints:4,moveOrder:[3,1,2,0],heldItem:'learnsash',curse:true,status:'scorch'});
  const futo=e.makeMonster('futo',80,{hp:1000,atk:300,def:100,spAtk:300,spDef:100,speed:200,accuracy:100,evasion:100},D.species.futo.moves);
  Object.assign(futo,{uid:'metadata-futo',grantId:'gift-test-v56',customStatsLevel:70,futoConfigLevel:80,nickname:'フー',xp:19});e.restoreMonster(futo);e.state.party.push(futo);e.markCaught('futo');
  assert(e.receiveKasaiReward(receipt).ok);for(const mon of e.state.party){mon.hp=1;mon.pp[Object.keys(mon.pp)[0]]=0;}
  const before=copy(Rules.normalizeParty(e.state.party)),start=challenge(e);assert(e.startKasaiBattle(start).ok);
  const retained=mon=>{const {hp,pp,status,...rest}=mon;return rest;};
  assert.deepEqual(copy(e.state.party.map(retained)),before.map(retained));
  for(const mon of e.state.party){assert.equal(mon.hp,e.stats(mon).hp);for(const move of e.moves(mon))assert.equal(mon.pp[move.id],e.maxPP(move));assert.equal(mon.status,undefined);}
  assert.equal(e.state.party[0].curse,true);assert.equal(e.state.party[2].gender,'female');assert.equal(e.state.party[1].customStatsLevel,70);assert.equal(e.state.party[1].futoConfigLevel,80);
});
test('male and female reward gender survives reload, while older mythical and other genderless species retain their behavior',()=>{
  for(const gender of ['male','female']){
    const e=game();e.state.party=e.state.party.slice(0,1);assert(e.receiveKasaiReward({...receipt,gender}).ok);
    const saved=e.serialize(),loaded=new Engine(saved),mon=loaded.state.party.find(mon=>mon.species==='floravelle');assert.equal(mon.gender,gender);assert.equal(loaded.genderOf(mon),gender);assert.equal(mon.grantId,receipt.id);
    assert.throws(()=>loaded.tradeMonster(mon),/交換/,'The existing mythical trade restriction is unchanged');
    const corrupt=copy(saved);delete corrupt.party[1].gender;assert.throws(()=>new Engine(corrupt),/性別/);
  }
  const old=game();old.state.party=old.state.party.slice(0,1);assert(old.receiveAdminMythical({grantId:'admin-mythical:'+player,species:'floravelle',level:70}).ok);old.state.party[1].gender='male';
  const legacy=new Engine(old.serialize()).state.party[1];assert.equal(legacy.gender,undefined);assert.equal(context.LT.genderOf(legacy),'none');assert.equal(context.LT.genderOf({...legacy,grantId:'kasai-reward:wrong'}),'none');
  assert.equal(context.LT.genderOf({...old.makeMonster('arvelion',70),gender:'male'}),'none');
});
test('shared room saves resume at the safe entrance and never mutate live room position',()=>{
  const e=game(),mapId='room:'+player,point={map:'village',...D.maps.village.spawn,facing:'up'};
  D.maps[mapId]={...D.maps.village,id:mapId,sharedRoom:true,roomOwner:player,returnPoint:point};e.state.map=mapId;e.state.visited.push(mapId);e.state.facing='left';
  const saved=e.serialize();assert.equal(saved.map,point.map);assert.equal(saved.x,point.x);assert.equal(saved.y,point.y);assert.equal(saved.facing,'up');assert(!saved.visited.includes(mapId));assert.equal(e.state.map,mapId);assert.equal(e.state.facing,'left');
  delete D.maps[mapId];assert.doesNotThrow(()=>new Engine(saved));
});
test('earned reward is available in owned link teams and carries a narrowly validated gender appearance',()=>{
  Object.assign(context,{crypto:require('node:crypto').webcrypto,TextEncoder,Uint8Array,Uint32Array,setTimeout:(fn,ms)=>{const timer=setTimeout(fn,ms);timer.unref();return timer;},clearTimeout});
  vm.runInContext(scripts.find(script=>script[2].includes('deterministic, save-independent rental-team duels.'))[2],context);
  vm.runInContext(scripts.find(script=>script[2].includes('peer-to-peer casual duel protocol'))[2],context);
  const e=game();e.state.party=e.state.party.slice(0,3);assert(e.receiveKasaiReward(receipt).ok);context.LT.adminBridge={getEngine:()=>e};
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../online-futo.js'),'utf8'),context);
  assert.equal(context.LT.OnlineFuto.ownedMythical().grantId,receipt.id);assert(context.LT.OnlineFuto.rosterIds().includes('floravelle'));
  const session=new context.LT.DuelSession({role:0,mode:'single',send:()=>true});
  const team={name:'テスト',ids:['floravelle','akehomura','shizunaria'],appearance:[{nickname:'キラ',shiny:false,grantId:receipt.id,gender:'female'},{nickname:'',shiny:false},{nickname:'',shiny:false}]};
  assert(session._validTeam(team));const invalid=copy(team);invalid.ids[0]='komorizen';assert.equal(session._validTeam(invalid),false);const invalidGender=copy(team);invalidGender.appearance[0].gender='none';assert.equal(session._validTeam(invalidGender),false);
  session._teams=[team,copy(team)];session._beginSync=()=>{};session._beginIfReady();assert(session.duel);
  assert.equal(context.LT.genderOf(session.duel.state.teams[0].monsters[0]),'female');assert.equal(session.duel.state.teams[0].monsters[0].level,50);session.close();
});
