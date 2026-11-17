#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(m => m[2]);
const select = marker => {
  const code = scripts.find(code => code.includes(marker));
  assert(code, `Missing production script: ${marker}`); return code;
};
function setup() {
  const timers = new Set();
  const context = vm.createContext({ console, crypto: webcrypto, TextEncoder, Uint8Array, Uint32Array,
    setTimeout(fn, ms) { const id = setTimeout(fn, ms); id.unref(); timers.add(id); return id; },
    clearTimeout(id) { timers.delete(id); clearTimeout(id); },
  });
  for (const marker of ['original world and game data', 'Original creature atlas and optional journeys', 'the Meridian Accord, an original 256-species atlas', 'two-stage starter lineages, retaining every existing species ID', 'Arvelion, the original roaming legendary', 'owner-only leaf mythical, outside all ordinary acquisition pools']) vm.runInContext(select(marker), context);
  // Special species registration precedes the starter-final-form extension.
  vm.runInContext(select('deterministic combat, interiors, league and versioned saves'), context);
  assert(context.LT.DATA.species.futo, 'Futo production species must exist');
  for (const marker of ['deterministic, save-independent rental-team duels', 'peer-to-peer casual duel protocol']) vm.runInContext(select(marker), context);
  const LT = context.LT;
  const normal = Object.keys(LT.DATA.species).filter(id => !LT.DATA.species[id].specialOnly);
  assert.equal(normal.length,254,'Online test must load the full production species data');
  for(const id of ['komorizen','shizunaria','akehomura'])assert(normal.includes(id),`Missing starter final form ${id}`);
  const custom = { hp: 1300, atk: 220, def: 190, spAtk: 410, spDef: 305, speed: 276, accuracy: 130, evasion: 115 };
  const moves = LT.DATA.species.futo.moves.slice();
  const state = { party: [{ species: 'futo', level: 99, grantId: 'gift-test-001', nickname: 'フーちゃん', shiny:false, customStatsLevel:88, customStats:{hp:99999,spAtk:9999} }, {species:normal[0],level:100,nickname:'きらり',shiny:true}], storage: [] };
  let issueCount = 0, verifyCount = 0, failure = '', expiry = 600000;
  const passes = new Map();
  LT.adminBridge = { getEngine: () => ({ state }) };
  LT.Admin = {
    async requestDuelPass(sessionId, grantId, side) {
      issueCount++;
      if (failure) throw Error(failure);
      const pass = `pass-${side}-${sessionId}-${String(issueCount).padStart(16, '0')}`;
      const mythical=grantId.startsWith('admin-mythical:');
      passes.set(pass, { ok: true, grantId, species: mythical?'floravelle':'futo', level: mythical?50:88, stats: mythical?new LT.Engine().stats({species:'floravelle',level:50}):custom, moves: mythical?LT.DATA.species.floravelle.moves:moves, sessionId, side, expiresAt: Date.now() + expiry });
      return { ok: true, pass };
    },
    async verifyDuelPass(sessionId, pass, side) {
      verifyCount++;
      const result = passes.get(pass);
      if (!result || result.sessionId !== sessionId || result.side !== side) throw Error('invalid pass');
      return JSON.parse(JSON.stringify(result));
    },
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'online-futo.js'), 'utf8'), context);
  function pair(mode = 'single') {
    const queue = [];
    const sessions = [0, 1].map(role => new LT.DuelSession({ role, mode, send: message => { queue.push({ from: role, message }); return true; } }));
    const flush = async () => {
      let count = 0;
      while (queue.length) {
        assert(++count < 100, 'Protocol failed to settle');
        const { from, message } = queue.shift();
        await sessions[1 - from].receive(message);
      }
    };
    return { sessions, flush, queue, async start() { sessions.forEach(s => s.start()); await flush(); }, close() { sessions.forEach(s => s.close()); } };
  }
  return { LT, normal, custom, moves, state, passes, pair, get counts() { return { issueCount, verifyCount }; },
    setFailure(value) { failure = value; }, setExpiry(value) { expiry = value; },
    dispose() { for (const timer of timers) clearTimeout(timer); } };
}
async function combatScenarios(env) {
  const { LT, normal, custom } = env;
  const moveIds = ['futo_breaker','futo_burst','futo_ascend','futo_restore'];
  assert.deepEqual(JSON.parse(JSON.stringify(LT.DATA.species.futo.moves)), moveIds, 'Futo default quartet');
  const legacy = ['supernova','atlas_crystal_4','starlight','shell'];
  const snapshot = { ok:true, grantId:'legacy', species:'futo', level:88, stats:custom, moves:legacy, sessionId:'legacy-session', side:0, expiresAt:Date.now()+60000 };
  assert.deepEqual(JSON.parse(JSON.stringify(LT.OnlineFuto.validateSnapshot(snapshot,'legacy-session',0).moves)), moveIds, 'Legacy exact default migrates');
  const customMoves = [legacy[1],legacy[0],legacy[2],legacy[3]];
  assert.deepEqual(JSON.parse(JSON.stringify(LT.OnlineFuto.validateSnapshot({...snapshot,moves:customMoves},'legacy-session',0).moves)), customMoves, 'Customized quartet is preserved');
  const pair = env.pair(); await pair.start();
  assert((await pair.sessions[0].setTeam({ name:'Futo combat', ids:['futo',...normal.slice(0,2)] })).ok);
  assert((await pair.sessions[1].setTeam({ name:'Opponent', ids:normal.slice(2,5) })).ok);
  await pair.flush();
  assert(pair.sessions.every(s=>s.snapshot().phase==='choosing'));
  const duel=pair.sessions[0].duel, initial=JSON.stringify(duel.state), dataBefore=JSON.stringify(LT.DATA);
  await Promise.all([
    pair.sessions[0].submit([{type:'move',slot:0,move:2,target:0}]),
    pair.sessions[1].submit(pair.sessions[1].duel.legalOrders(1))
  ]);
  await pair.flush();
  assert.equal(duel.fingerprint(),pair.sessions[1].duel.fingerprint(),'Real commit/reveal and sync agree after boosting');
  assert(Object.values(duel.state.teams[0].monsters[0].stages).every(v=>v===1));
  const reset=()=>{duel.state=JSON.parse(initial);duel._random=()=>.5;return [duel.state.teams[0].monsters[0],duel.state.teams[1].monsters[0]];};
  const apply=(id,side=0)=>{const mon=duel.state.teams[side].monsters[duel.state.teams[side].active[0]];duel._apply({side,slot:0,target:0,technique:LT.DATA.moves[id]},mon);};
  let [actor,target]=reset();
  assert.deepEqual(duel.moves(actor).map(m=>m.maxPP),[15,15,5,10]);
  assert.equal(duel.moves(actor)[0].category,'physical');assert.equal(duel.moves(actor)[1].category,'special');
  assert.equal(duel.moves(actor)[0].power,100);assert.equal(duel.moves(actor)[1].power,100);
  assert.equal(duel.moves(actor)[0].accuracy,100);assert.equal(duel.moves(actor)[1].accuracy,100);
  const hpBefore=[actor.hp,actor.maxHp,target.hp];
  apply('futo_ascend');
  assert(Object.values(actor.stages).every(v=>v===1));
  assert.deepEqual([actor.hp,actor.maxHp,target.hp],hpBefore,'Boost targets self and never changes HP');
  assert.equal(actor.pp.futo_ascend,4);
  const effective=duel.effectiveStats(actor);
  assert.equal(effective.atk,Math.floor(custom.atk*1.5));assert.equal(effective.def,Math.floor(custom.def*1.5));
  assert.equal(effective.spAtk,Math.floor(custom.spAtk*1.5));assert.equal(effective.spDef,Math.floor(custom.spDef*1.5));
  assert.equal(effective.speed,Math.floor(custom.speed*1.5));assert.equal(effective.accuracy,Math.floor(custom.accuracy*4/3));
  assert.equal(effective.evasion,Math.floor(custom.evasion*4/3));assert.equal(effective.hp,custom.hp);
  assert.equal(duel.state.events.at(-1).kind,'boost');assert.equal(duel.state.events.at(-1).side,0);
  for(const key of Object.keys(actor.stages))actor.stages[key]=5;
  apply('futo_ascend');apply('futo_ascend');
  assert(Object.values(actor.stages).every(v=>v===6),'All seven stage values cap at six');
  assert.equal(duel.state.events.at(-1).changed,false);

  function damage(move,offenseKey,defenseKey,boostActor,boostDefender){
    const [a,t]=reset();t.hp=t.maxHp=99999;a.stages[offenseKey]=boostActor;t.stages[defenseKey]=boostDefender;
    apply(move);return duel.state.events.find(e=>e.kind==='damage').amount;
  }
  for(const [move,offense,defense] of [['futo_breaker','atk','def'],['futo_burst','spAtk','spDef']]){
    const baseline=damage(move,offense,defense,0,0);
    assert(damage(move,offense,defense,1,0)>baseline,`${offense} boost increases real damage`);
    assert(damage(move,offense,defense,0,1)<baseline,`${defense} boost lowers real damage`);
  }
  [actor,target]=reset();target.stats.evasion=300;apply('futo_breaker');
  assert.equal(duel.state.events[0].kind,'miss','Unboosted accuracy can miss');
  [actor,target]=reset();target.stats.evasion=300;actor.stages.accuracy=1;apply('futo_breaker');
  assert.equal(duel.state.events[0].kind,'damage','Accuracy stage changes hit outcome');
  [actor,target]=reset();actor.stats.accuracy=target.stats.evasion=130;duel._random=()=>.9;apply('futo_breaker');
  assert.equal(duel.state.events[0].kind,'damage');
  [actor,target]=reset();actor.stats.accuracy=target.stats.evasion=130;target.stages.evasion=1;duel._random=()=>.9;apply('futo_breaker');
  assert.equal(duel.state.events[0].kind,'miss','Evasion stage changes hit outcome');

  function actionOrder(speedStage){
    const [a,t]=reset();a.stats.speed=100;t.stats.speed=120;a.stages.speed=speedStage;a.hp=a.maxHp=t.hp=t.maxHp=99999;
    const enemyAttack=duel.moves(t).findIndex(m=>m.kind==='attack');assert(enemyAttack>=0);
    duel.resolve([[{type:'move',slot:0,move:0,target:0}],[{type:'move',slot:0,move:enemyAttack,target:0}]]);
    return duel.state.events.find(e=>e.kind==='damage'||e.kind==='miss').side;
  }
  assert.equal(actionOrder(0),1);assert.equal(actionOrder(1),0,'Speed stages determine next-turn action order');
  [actor,target]=reset();for(const key of Object.keys(actor.stages))actor.stages[key]=2;
  const enemyAttack=duel.moves(target).findIndex(m=>m.kind==='attack');
  duel.resolve([[{type:'switch',slot:0,index:1}],[{type:'move',slot:0,move:enemyAttack,target:0}]]);
  assert(Object.values(actor.stages).every(v=>v===0),'Switching out clears stages');
  assert(Object.values(duel.state.teams[0].monsters[1].stages).every(v=>v===0),'Switching in starts neutral');
  [actor,target]=reset();for(const key of Object.keys(target.stages))target.stages[key]=2;target.hp=1;apply('futo_breaker');
  assert.equal(target.hp,0);assert(Object.values(target.stages).every(v=>v===0),'Fainting clears stages immediately');
  duel._replaceFainted();assert.equal(duel.state.teams[1].active[0],0);assert.equal(duel.state.phase,'replacement');
  duel.resolve([[],[{type:'switch',slot:0,index:2}]]);assert.equal(duel.state.teams[1].active[0],2);
  assert(Object.values(duel.state.teams[1].monsters[duel.state.teams[1].active[0]].stages).every(v=>v===0));

  [actor,target]=reset();actor.hp=100;apply('futo_restore');
  assert.equal(actor.hp,100+Math.ceil(actor.maxHp*.5));assert.equal(actor.pp.futo_restore,9);
  actor.hp=actor.maxHp-10;apply('futo_restore');assert.equal(actor.hp,actor.maxHp,'Healing clamps to max HP');
  assert.equal(duel.state.events.at(-1).amount,10);
  [actor,target]=reset();const hash=duel.fingerprint();actor.stages.atk=1;
  assert.notEqual(duel.fingerprint(),hash,'Stages participate in synchronization checksum');
  assert.equal(duel.snapshot().teams[0].monsters[0].stages.atk,1);
  assert.equal(JSON.stringify(LT.DATA),dataBefore,'Combat does not mutate species or move definitions');
  pair.close();
  const doubles=env.pair('double');await doubles.start();
  assert((await doubles.sessions[0].setTeam({name:'Double Futo',ids:[normal[0],'futo',...normal.slice(1,3)]})).ok);
  assert((await doubles.sessions[1].setTeam({name:'Double opponent',ids:normal.slice(3,7)})).ok);
  await doubles.flush();
  await Promise.all([
    doubles.sessions[0].submit([{type:'switch',slot:0,index:2},{type:'move',slot:1,move:2,target:0}]),
    doubles.sessions[1].submit([{type:'switch',slot:0,index:2},{type:'switch',slot:1,index:3}])
  ]);
  await doubles.flush();
  const doubleDuel=doubles.sessions[0].duel,boost=doubleDuel.state.events.find(e=>e.kind==='boost');
  assert.equal(boost.side,0);assert.equal(boost.slot,1);assert.equal(boost.move,'futo_ascend');
  assert(Object.values(doubleDuel.state.teams[0].monsters[1].stages).every(v=>v===1),'Doubles slot 1 boosts itself');
  assert(Object.values(doubleDuel.state.teams[0].monsters[2].stages).every(v=>v===0),'Doubles ally is unaffected');
  assert.equal(doubleDuel.fingerprint(),doubles.sessions[1].duel.fingerprint());
  doubles.close();
  const mismatch=env.pair();mismatch.sessions.forEach(s=>s.start());
  mismatch.queue.forEach(item=>{item.message.rules='previous-rules';});await mismatch.flush();
  assert(mismatch.sessions.every(s=>s.snapshot().phase==='error'));
  assert(mismatch.sessions.some(s=>s.snapshot().message.includes('バージョンが一致しません')),'Older rules fail clearly before team selection');
  mismatch.close();
  return ['default quartet and PP','exact legacy migration','seven-stat boost and cap','physical/special damage and defenses','accuracy/evasion hit outcomes','speed order','switch/faint stage reset','50-percent healing and cap','stage checksum and commit/reveal synchronization','double slot self-target','old rules rejected clearly'];
}

(async () => {
  const env = setup(), { LT, normal, custom, moves, state } = env;
  try {
    assert(!LT.Duel.validateTeam(['futo', ...normal.slice(0, 2)], 'single').ok, 'Unverified direct Duel must remain denied');
    assert(LT.OnlineFuto.rosterIds(normal).includes('futo'));
    assert(normal.includes('arvelion'),'Legendary production data must be loaded');
    assert(!LT.OnlineFuto.rosterIds(normal).includes('arvelion'),'Unowned legendary is not a free rental');
    assert.equal(LT.OnlineFuto.rosterIds(normal).filter(id=>id!=='futo').length,253);
    const savedState = JSON.stringify(state);
    const rentals = env.pair(); await rentals.start();
    assert((await rentals.sessions[0].setTeam({ name: 'A', ids: normal.slice(0, 3) })).ok);
    assert((await rentals.sessions[1].setTeam({ name: 'B', ids: normal.slice(3, 6) })).ok);
    await rentals.flush();
    assert(rentals.sessions.every(s => s.snapshot().phase === 'choosing'));
    assert.equal(env.counts.issueCount, 0, 'Ordinary rentals must not call Futo service');
    assert.equal(env.counts.verifyCount, 0);
    assert(rentals.sessions[0].duel.state.teams.every(t => t.monsters.every(m => m.level === 50)));
    const rentalMon=rentals.sessions[0].duel.state.teams[0].monsters[0];
    assert.equal(rentalMon.nickname,'きらり');assert.equal(rentalMon.shiny,true);assert.equal(rentalMon.level,50);
    assert.equal(rentals.sessions[0].duel.fingerprint(),rentals.sessions[1].duel.fingerprint());
    assert(!rentals.sessions[0]._validTeam({name:'bad',ids:normal.slice(0,3),appearance:[{nickname:'あいうえおか',shiny:false},{nickname:'',shiny:false},{nickname:'',shiny:false}]}));
    assert(!rentals.sessions[0]._validTeam({name:'bad',ids:normal.slice(0,3),appearance:[{nickname:'',shiny:false,stats:{hp:999999}},{nickname:'',shiny:false},{nickname:'',shiny:false}]}));
    rentals.close();

    const unownedLegendary=env.pair();await unownedLegendary.start();
    assert(!(await unownedLegendary.sessions[0].setTeam({name:'Unowned legend',ids:['arvelion',...normal.slice(0,2)]})).ok);
    assert(!(await unownedLegendary.sessions[0].setTeam({name:'Unowned legend and Futo',ids:['arvelion','futo',normal[0]]})).ok);
    assert.equal(env.counts.issueCount,0,'Unowned legendary is rejected before any Futo request');
    assert.equal(unownedLegendary.sessions[0]._teams[0],null);unownedLegendary.close();
    state.storage.push({species:'arvelion',level:100,nickname:'ほしおう',shiny:true});
    assert(LT.OnlineFuto.rosterIds(normal).includes('arvelion'),'An owned reserve legendary is selectable');
    const legendaryPair=env.pair();await legendaryPair.start();
    assert((await legendaryPair.sessions[0].setTeam({name:'Legend owner',ids:['arvelion',...normal.slice(0,2)]})).ok);
    // The opponent need not own a legendary to receive and play this team.
    state.storage=[];
    assert((await legendaryPair.sessions[1].setTeam({name:'Opponent',ids:normal.slice(2,5)})).ok);
    await legendaryPair.flush();
    assert(legendaryPair.sessions.every(s=>s.snapshot().phase==='choosing'));
    const legendaryMon=legendaryPair.sessions[0].duel.state.teams[0].monsters[0];
    assert.equal(legendaryMon.species,'arvelion');assert.equal(legendaryMon.level,50);
    assert.equal(legendaryMon.nickname,'ほしおう');assert.equal(legendaryMon.shiny,true);
    assert.equal(legendaryPair.sessions[0].duel.fingerprint(),legendaryPair.sessions[1].duel.fingerprint());
    assert.equal(env.counts.issueCount,0,'Legendary uses fixed normal combat rules, not Futo passes');
    assert(!LT.OnlineFuto.rosterIds(normal).includes('arvelion'),'Released legendary leaves the local roster');
    assert.equal(JSON.stringify(state),savedState,'Legendary online selection must not alter adventure progress');
    legendaryPair.close();

    const pair = env.pair(); await pair.start();
    const pendingFuto=pair.sessions[0].setTeam({ name: '運営', ids: ['futo', ...normal.slice(0, 2)] });
    assert(!(await pair.sessions[0].setTeam({name:'Competing request',ids:normal.slice(0,3)})).ok,'Pending authorization locks both normal and Futo team changes');
    assert((await pendingFuto).ok);
    assert((await pair.sessions[1].setTeam({ name: '一般', ids: normal.slice(2, 5) })).ok);
    await pair.flush();
    assert(pair.sessions.every(s => s.snapshot().phase === 'choosing'));
    const duel = pair.sessions[0].duel, mon = duel.state.teams[0].monsters[0];
    assert.equal(mon.species, 'futo'); assert.equal(mon.level, 88, 'Local solo growth does not override signed rental level');assert.equal(mon.nickname,'フーちゃん');assert.equal(mon.shiny,false);
    assert.deepEqual(JSON.parse(JSON.stringify(mon.stats)), custom);
    assert.deepEqual(JSON.parse(JSON.stringify(duel.moves(mon).map(m => m.id))), JSON.parse(JSON.stringify(moves)));
    assert.equal(mon.hp, custom.hp); assert.equal(mon.maxHp, custom.hp);
    assert.equal(pair.sessions[0].duel.fingerprint(), pair.sessions[1].duel.fingerprint());
    const commands = pair.sessions.map(s => s.duel.legalOrders(s.role));
    await Promise.all(pair.sessions.map((s, side) => s.submit(commands[side])));
    await pair.flush();
    assert.equal(pair.sessions[0].duel.fingerprint(), pair.sessions[1].duel.fingerprint());
    assert.equal(JSON.stringify(state), savedState, 'Online play modified adventure ownership/save');
    pair.close();

    state.party = []; state.giftReceipts = ['gift-test-001'];
    assert(!LT.OnlineFuto.rosterIds(normal).includes('futo'),'A released Futo is absent from the roster even when its receipt remains');
    const unauth = env.pair(); await unauth.start();
    assert(!(await unauth.sessions[0].setTeam({ name: 'No grant', ids: ['futo', ...normal.slice(0, 2)] })).ok);
    unauth.close(); state.party = JSON.parse(savedState).party;

    const spoof = env.pair(); await spoof.start();
    await spoof.sessions[1].receive({ v: LT.DuelSession.VERSION, t: 'ready', session: spoof.sessions[1].sessionId,
      team: { name: 'Forged', ids: ['futo', ...normal.slice(0, 2)], futo: { pass: 'forged-'.repeat(12) } } });
    assert.equal(spoof.sessions[1].snapshot().phase, 'error'); spoof.close();

    const reflected = env.pair(); await reflected.start();
    const issued = await LT.Admin.requestDuelPass(reflected.sessions[0].sessionId, 'gift-test-001', 0);
    await reflected.sessions[0].receive({ v: LT.DuelSession.VERSION, t: 'ready', session: reflected.sessions[0].sessionId,
      team: { name: 'Reflected', ids: ['futo', ...normal.slice(0, 2)], futo: { pass: issued.pass } } });
    assert.equal(reflected.sessions[0].snapshot().phase, 'error'); reflected.close();

    env.setExpiry(-1);
    const expired = env.pair(); await expired.start();
    assert(!(await expired.sessions[0].setTeam({ name: 'Expired', ids: ['futo', ...normal.slice(0, 2)] })).ok);
    assert.equal(expired.sessions[0].duel, null); expired.close();
    env.setExpiry(600000);

    const validSnapshot = { ok: true, grantId: 'abc', species: 'futo', level: 88, stats: custom, moves, sessionId: 's', side: 0, expiresAt: Date.now() + 60000 };
    assert.throws(() => LT.OnlineFuto.validateSnapshot({ ...validSnapshot, stats: { ...custom, hp: Infinity } }, 's', 0));
    assert.throws(() => LT.OnlineFuto.validateSnapshot({ ...validSnapshot, moves: ['missing', ...moves.slice(1)] }, 's', 0));
    assert.throws(() => LT.OnlineFuto.validateSnapshot({ ...validSnapshot, level: 101 }, 's', 0));
    // Owner-only mythical proof coexists with Futo, including both active doubles slots.
    const noMyth=env.pair();await noMyth.start();
    for(const ids of ['floravelle',{},null,42])assert.equal(noMyth.sessions[0]._validTeam({name:'Malformed',ids}),false);
    assert(!LT.OnlineFuto.rosterIds(normal).includes('floravelle'));
    assert(!(await noMyth.sessions[0].setTeam({name:'No mythical',ids:['floravelle',...normal.slice(0,2)]})).ok);noMyth.close();
    state.storage.push({species:'floravelle',grantId:'admin-mythical:owner-test',level:100,nickname:'はな',shiny:false});
    const mythSaved=JSON.stringify(state);
    assert(LT.OnlineFuto.rosterIds(normal).includes('floravelle'));
    for(const mode of ['single','double']){
      const myth=env.pair(mode);await myth.start();
      assert((await myth.sessions[0].setTeam({name:'Owner',ids:['floravelle','futo',...normal.slice(0,mode==='single'?1:2)]})).ok);
      assert((await myth.sessions[1].setTeam({name:'Visitor',ids:normal.slice(4,mode==='single'?7:8)})).ok);
      await myth.flush();assert(myth.sessions.every(s=>s.snapshot().phase==='choosing'));
      const d=myth.sessions[0].duel,m=d.state.teams[0].monsters[0];
      assert.equal(m.species,'floravelle');assert.equal(m.level,50);assert.equal(m.nickname,'はな');
      assert.deepEqual(JSON.parse(JSON.stringify(m.stats)),JSON.parse(JSON.stringify(new LT.Engine().stats({species:'floravelle',level:50}))));
      assert.equal(d.state.teams[0].monsters[1].species,'futo');
      assert.deepEqual(JSON.parse(JSON.stringify(d.moves(m).map(x=>x.id))),JSON.parse(JSON.stringify(LT.DATA.species.floravelle.moves)));
      await Promise.all(myth.sessions.map(s=>s.submit(s.duel.legalOrders(s.role))));await myth.flush();
      assert.equal(d.fingerprint(),myth.sessions[1].duel.fingerprint());myth.close();
    }
    assert.equal(JSON.stringify(state),mythSaved);
    // A forged local save is only a roster hint; the real service can still deny it.
    env.setFailure('Not current owner');const denied=env.pair();await denied.start();
    assert(!(await denied.sessions[0].setTeam({name:'Forged owner',ids:['floravelle',...normal.slice(0,2)]})).ok);assert.equal(denied.sessions[0].duel,null);denied.close();env.setFailure('');
    const forgedMyth=env.pair();await forgedMyth.start();
    await forgedMyth.sessions[1].receive({v:LT.DuelSession.VERSION,t:'ready',session:forgedMyth.sessions[1].sessionId,team:{name:'Forged mythical',ids:['floravelle',...normal.slice(0,2)],mythical:{pass:'forged-'.repeat(12)}}});
    assert.equal(forgedMyth.sessions[1].snapshot().phase,'error');forgedMyth.close();
    const mythSnapshot={...validSnapshot,species:'floravelle',grantId:'admin-mythical:test',level:50,stats:new LT.Engine().stats({species:'floravelle',level:50}),moves:LT.DATA.species.floravelle.moves};
    assert.throws(()=>LT.OnlineFuto.validateSnapshot({...mythSnapshot,stats:{...mythSnapshot.stats,hp:9999}},'s',0,Date.now(),'floravelle'));
    assert.throws(()=>LT.OnlineFuto.validateSnapshot({...mythSnapshot,moves:LT.DATA.species.futo.moves},'s',0,Date.now(),'floravelle'));
    assert.throws(()=>LT.OnlineFuto.validateSnapshot({...mythSnapshot,level:100},'s',0,Date.now(),'floravelle'));
    state.storage=[];
    const combat = await combatScenarios(env);
    console.log(JSON.stringify({ ok: true, combat, scenarios: ['mythical + Futo single/double verified teams and deterministic combat', 'forged mythical ownership, proof and snapshot denied', 'normal rental stats unchanged, owned cosmetics retained', 'legendary requires current local ownership and uses Lv50 fixed rules', 'opponents can face owned legendary without owning it', 'invalid cosmetic metadata denied', 'local growth cannot override signed Futo', 'verified Futo level/stats/moves', 'identical deterministic turn', 'no save mutation', 'unowned denied', 'forged denied', 'side reflection denied', 'expired denied', 'invalid snapshot denied'], counts: env.counts }, null, 2));
  } finally { env.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
