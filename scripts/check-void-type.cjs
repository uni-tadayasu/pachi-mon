#!/usr/bin/env node
'use strict';

// Run the shipped data and combat engines, including the late off-dex block.
// Explicit legacy expectations catch accidental changes to the original chart.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const select=marker=>{const code=scripts.find(match=>! /\bsrc=|application\/ld\+json/.test(match[1])&&match[2].includes(marker))?.[2];assert(code,marker);return code;};
const context=vm.createContext({console});
for(const [,attributes,code] of scripts){
  if(/\bsrc=|application\/ld\+json/.test(attributes))continue;
  vm.runInContext(code,context);
  if(context.LT?.Engine)break;
}
vm.runInContext(select('deterministic, save-independent rental-team duels'),context);
vm.runInContext(fs.readFileSync(path.join(root,'battle-vfx.js'),'utf8'),context);
const {DATA:D,Engine,Duel,BattleVFX}=context.LT;
const LEGACY=['leaf','tide','ember','wind','crystal'];
const CHART=[
  [.8,1.5,.7,1,1],
  [.7,.8,1.5,1,1],
  [1.5,.7,.8,1,1],
  [1,1,1,.8,1.5],
  [1,1,1,1.5,.8]
];
const TYPES=[...LEGACY,'void'];
const REPRESENTATIVES={leaf:'komori',tide:'shizuku',ember:'hibana',wind:'fuwari',crystal:'kirari',void:'nullmie'};
const expected=(attack,defense)=>!attack||attack==='void'||defense==='void'?1:CHART[LEGACY.indexOf(attack)][LEGACY.indexOf(defense)];
const team=(first,size)=>[first,...Object.values(REPRESENTATIVES).filter(id=>id!==first)].slice(0,size);
const moveFor=(element,power=8)=>({id:'void_affinity_probe',name:'相性の検証',kind:'attack',element,category:'special',power,accuracy:100,pp:30});

function soloHit(element,defense,{power=8,critical=false,guarded=false,allocation=0}={}){
  const engine=new Engine();assert(engine.newGame('komori').ok);
  const actor=engine.makeMonster(REPRESENTATIVES[element]||'komori',50);
  if(allocation)actor.alloc={spAtk:allocation};
  engine.state.party=[actor];
  // Use a normal battle shell, then supply the test opponent. This does not
  // introduce a wild-acquisition route for the off-dex species.
  assert(engine.startBattle('komori',50,null,{wild:false}));
  const target=engine.battle.enemy=engine.makeMonster(REPRESENTATIVES[defense],50);
  engine.rng=()=>critical?.01:.5;engine.battle.enemyGuard=guarded;
  const events=[];engine.applyMove(actor,target,moveFor(element,power),'ally',events);
  const event=events.find(entry=>entry.kind==='damage');assert(event,'solo attack lands');return event;
}

function duelHit(element,defense,mode='single',{power=8,critical=false,guarded=false,allocation=0}={}){
  const size=Duel.teamSize(mode),actor=REPRESENTATIVES[element]||'komori';
  const allocations=allocation?[[{hp:0,atk:0,def:0,spAtk:allocation,spDef:0,speed:0},...Array(size-1).fill(null)],null]:undefined;
  const duel=Duel.create({mode,teams:[team(actor,size),team(REPRESENTATIVES[defense],size)],seed:17,...(allocations?{allocation:allocations}:{})});
  const mon=duel.state.teams[0].monsters[0],move=moveFor(element,power);mon.pp[move.id]=30;
  duel.state.teams[1].monsters[0].guard=guarded;duel._random=()=>critical?.01:.5;
  duel._apply({technique:move,side:0,slot:0,target:0},mon);
  const event=duel.state.events.find(entry=>entry.kind==='damage');assert(event,mode+' link attack lands');return event;
}

const audioContext=vm.createContext({console,navigator:{},matchMedia:()=>({matches:false})});
vm.runInContext(select('class LuminaAudio'),audioContext);
const audio=new audioContext.LT.Audio(),voices=[];
audio.ctx={currentTime:0,state:'running'};audio.enabled=true;
for(const method of ['drum','instrument','sweep','texture'])audio[method]=(...args)=>voices.push([method,...args]);
function impact(event){voices.length=0;return {kind:audio.damageImpact(event,1),voices:JSON.stringify(voices)};}

test('the new 無 type and every stage are registered without changing the five-type chart',()=>{
  assert.equal(D.elements.void?.name,'無');assert.equal(Object.keys(D.elements).length,6);
  for(const [type,id]of Object.entries(REPRESENTATIVES))assert.equal(D.species[id].element,type);
  for(const id of ['nullmie','nullva','zeroveil']){
    const species=D.species[id];assert.equal(species.element,'void');assert(species.hiddenDex&&species.glitchOnly);
    assert.equal(species.moves.length,4);
    for(const id of species.moves)assert.equal(D.moves[id].element,null,'the lineage learns only neutral moves');
  }
  const engine=new Engine();
  for(const attack of [null,...TYPES])for(const defense of TYPES){
    assert.equal(engine.effectiveness(attack,defense),expected(attack,defense),`${attack} → ${defense}`);
  }
});

test('solo, single and double battles keep 無 neutral in both directions and preserve legacy affinities',()=>{
  const normalSignature=impact({kind:'damage',amount:1,effectiveness:1}).voices;
  let combinations=0;
  for(const attack of [null,...TYPES])for(const defense of TYPES){
    const factor=expected(attack,defense),kind=factor>1?'super':factor<1?'resisted':'normal';
    for(const event of [soloHit(attack,defense),duelHit(attack,defense),duelHit(attack,defense,'double')]){
      assert.equal(event.effectiveness,factor,`${attack} → ${defense}: combat metadata`);assert(event.amount>0);
      const effect=BattleVFX.fromEvent(event,null,100);assert.equal(effect.effectiveness,factor,'VFX keeps the combat factor');
      const cue=impact(effect);assert.equal(cue.kind,kind,'the actual sound classifier follows affinity');
      if(attack==='void'||defense==='void'||!attack){
        assert.equal(cue.voices,normalSignature,'neutral hits use the normal impact sound');
        assert.doesNotMatch(event.text,/属性が[有不]利/,'no false weakness/resistance text');
      }
    }
    combinations++;
  }
  assert.equal(combinations,42);
});

test('neutrality preserves move power, allocated attack, critical hits and guarding',()=>{
  for(const hit of [options=>soloHit('void','void',options),options=>duelHit('void','void','single',options),options=>duelHit('void','void','double',options)]){
    const normal=hit({power:16}),stronger=hit({power:32}),trained=hit({power:16,allocation:64}),critical=hit({power:16,critical:true}),guarded=hit({power:16,guarded:true});
    assert(stronger.amount>normal.amount,'more power still increases damage');
    assert(trained.amount>normal.amount,'allocated attack still increases damage');
    assert(critical.amount>normal.amount,'critical bonus is separate from type affinity');
    assert(guarded.amount<normal.amount,'guard still reduces damage');
    assert.equal(critical.critical,true);assert.equal(guarded.guarded,true);
    for(const event of [normal,stronger,trained,critical,guarded]){
      assert.equal(event.effectiveness,1);assert.equal(impact(event).kind,'normal');
    }
  }
});

test('the duel compatibility fingerprint includes the new type rules',()=>{
  const before=Duel.rulesFingerprint(),definition=D.elements.void;
  try{D.elements.void={...definition,strongAgainst:'leaf'};assert.notEqual(Duel.rulesFingerprint(),before);}
  finally{D.elements.void=definition;}
  assert.equal(Duel.rulesFingerprint(),before);
});
