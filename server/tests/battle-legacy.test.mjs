import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createReplayRuntime} from '../kasai-replay.mjs';
import {RANKED_RULES_VERSION,RANKED_COMPATIBLE_VERSIONS,createRankedBattle,validateRankedOrders,resolveRankedRound} from '../ranked-engine.mjs';
import {LIVE_RULES_VERSION,createLiveBattle,validateLiveOrders,resolveLiveRound} from '../kasai-live-engine.mjs';
import legacy from '../battle-legacy-v82.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/v82-persisted-battles.json',import.meta.url),'utf8'));
const copy=value=>JSON.parse(JSON.stringify(value));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const LT=createReplayRuntime(),engine=new LT.Engine();
const html=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const duel=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(match=>match[1].includes('deterministic, save-independent rental-team duels'))[1];
const browser=vm.createContext({LT,console});vm.runInContext(duel,browser);
for(const name of ['legacy-battle-v82.js','ranked-rules.js','kasai-live-model.js'])vm.runInContext(fs.readFileSync(new URL('../../'+name,import.meta.url),'utf8'),browser);

test('the frozen runtime is pinned to published v82 and never adds retired species or moves to current DATA',()=>{
  assert.equal(legacy.sourceCommit,'0696373ec0446ceb0d0d7e5fbf7708fafc7f1865');assert.equal(fixture.sourceCommit,legacy.sourceCommit);
  assert.deepEqual(RANKED_COMPATIBLE_VERSIONS,['ranked-v83-vernix','ranked-v79-growth','ranked-v78']);
  assert.equal(legacy.species('lunaxion').name,'ルナクシオン');assert.equal(legacy.move('lunax_renew').power,50);assert.equal(legacy.move('lunax_renew').pp,6);
  assert.equal(legacy.species('vernix'),null);assert.equal(legacy.move('vernix_renew'),null);
  for(const runtime of [LT,createReplayRuntime()]){
    for(const id of ['verny','vernion','vernix'])assert(runtime.DATA.species[id]);
    for(const id of ['lunax','lunaxion','galdo','galdoran','galdoras','galdogran'])assert.equal(runtime.DATA.species[id],undefined);
    for(const id of ['lunax_crescent','lunax_nova','lunax_aegis','lunax_renew'])assert.equal(runtime.DATA.moves[id],undefined);
  }
});

for(const saved of fixture.cases)test(`persisted v82 ${saved.kind} keeps every original snapshot, PP, recharge, RNG and outcome in browser and Worker`,()=>{
  const isRanked=saved.kind==='ranked',rules=isRanked?browser.LT.RankedRules:browser.LT.KasaiLiveRules;
  const validate=isRanked?validateRankedOrders:validateLiveOrders,resolve=isRanked?resolveRankedRound:resolveLiveRound;
  let server=copy(saved.initial),client=copy(saved.initial);const untouched=copy(saved.initial);
  assert.equal(server.round,4);assert.equal(server.teams[1].monsters[0].rechargeTurns,1);
  assert.equal(server.teams[0].monsters[0].pp.lunax_renew,6,'old half-heal retains all six PP');
  assert.deepEqual(copy(rules.hydrate(client).snapshot()),untouched);
  for(const turn of saved.turns){
    const before=copy(server);
    for(const side of [0,1]){assert.equal(validate(server,side,turn.orders[side]).ok,true);assert.equal(rules.validate(client,side,turn.orders[side]).ok,true);}
    const next=resolve(server,turn.orders);assert.deepEqual(server,before,'resolving never mutates persisted input');server=next;
    client=copy(rules.resolve(client,turn.orders));
    assert.equal(hash(server),turn.sha256,`original v82 ${saved.kind} round ${server.round}`);assert.deepEqual(client,server);
  }
  assert.equal(server.winner,saved.winner);assert.equal(server.round,saved.finalRound);assert.equal(hash(server),saved.finalSha256);
  assert.equal(server[isRanked?'rankedVersion':'liveVersion'],isRanked?'ranked-v79-growth':'kasai-live-v58');
  assert.deepEqual(saved.initial,untouched);
  const forged=copy(saved.initial);forged.teams[0].monsters[0].pp.lunax_renew=7;assert.equal(validate(forged,0,saved.turns[0].orders[0]).ok,false);
  const relabeled=copy(saved.initial);relabeled[isRanked?'rankedVersion':'liveVersion']=isRanked?RANKED_RULES_VERSION:LIVE_RULES_VERSION;
  assert.equal(validate(relabeled,0,saved.turns[0].orders[0]).ok,false,'old state may not impersonate new combat rules');
});

test('new battles always use v83 species and techniques even after legacy hydration',()=>{
  const teams=[0,1].map(side=>['vernix','komori','shizuku'].map((id,index)=>({...engine.makeMonster(id,50),uid:`new-${side}-${index}`})));
  const ranked=createRankedBattle(...teams,83),live=createLiveBattle(...teams,83);
  assert.equal(ranked.rankedVersion,'ranked-v83-vernix');assert.equal(live.liveVersion,'kasai-live-v83-vernix');
  for(const state of [ranked,live])for(const team of state.teams){
    const mon=team.monsters[0];assert.equal(mon.species,'vernix');
    assert.deepEqual(mon.pp,{vernix_renew:5,vernix_frost:10,vernix_psycho:8,vernix_thunder:10});
  }
});
