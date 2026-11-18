#!/usr/bin/env node
'use strict';
// Exercise real combat metadata, both playback paths, and the bounded FX graph.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]);
const select=marker=>{const code=scripts.find(value=>value.includes(marker));assert(code,marker);return code;};
const audioSource=select('class LuminaAudio'),vfxSource=fs.readFileSync(path.join(root,'battle-vfx.js'),'utf8');
const context=vm.createContext({console});
for(const marker of ['original world and game data','Original creature atlas and optional journeys',
  'the Meridian Accord, an original 256-species atlas','two-stage starter lineages, retaining every existing species ID',
  'Arvelion, the original roaming legendary','owner-only leaf mythical, outside all ordinary acquisition pools',
  'deterministic combat, interiors, league and versioned saves','deterministic, save-independent rental-team duels'])
  vm.runInContext(select(marker),context);
vm.runInContext(vfxSource,context);
const {LT}=context,{Engine,Duel,DATA,BattleVFX}=LT,copy=value=>JSON.parse(JSON.stringify(value));
const species=['komori','shizuku','hibana','fuwari','kirari','nullmie'];
const forElement=element=>species.find(id=>DATA.species[id].element===element);
const team=(first,size)=>[first,...species.filter(id=>id!==first)].slice(0,size);
const classify=factor=>factor>1?'super':factor<1?'resisted':'normal';

function combatPair(element,defender,critical=false,guarded=false,mode='single'){
  const move={id:'sound_affinity_check',name:'音の検証',kind:'attack',element,category:'special',power:6,accuracy:100,pp:30};
  const solo=new Engine();solo.newGame('komori');solo.state.party=[solo.makeMonster('komori',50)];
  assert(solo.startBattle(defender,50));solo.rng=()=>critical?.01:.5;solo.battle.enemyGuard=guarded;
  const events=[];solo.applyMove(solo.state.party[0],solo.battle.enemy,move,'ally',events);
  const size=mode==='double'?4:3,duel=Duel.create({mode,teams:[team('komori',size),team(defender,size)],seed:7});
  duel._random=()=>critical?.01:.5;duel.state.teams[1].monsters[0].guard=guarded;
  const mon=duel.state.teams[0].monsters[0];mon.pp[move.id]=30;
  duel._apply({technique:move,side:0,slot:0,target:0},mon);
  return {solo:events.find(e=>e.kind==='damage'),online:duel.state.events.find(e=>e.kind==='damage')};
}

function spyAudio(){
  const sandbox=vm.createContext({console,navigator:{},matchMedia:()=>({matches:false})});vm.runInContext(audioSource,sandbox);
  const audio=new sandbox.LT.Audio(),calls=[],cues=[];audio.ctx={currentTime:10,state:'running'};audio.enabled=true;
  audio.prune=()=>{};audio.duckMusic=()=>{};
  audio.instrument=(group,kind,midi,time,duration,volume,pan)=>calls.push({voice:'note',kind,midi,time,duration,volume,pan});
  audio.drum=(group,kind,time,volume)=>calls.push({voice:'drum',kind,time,volume});
  audio.sweep=(time,duration,from,to,volume,pan)=>calls.push({voice:'sweep',time,duration,from,to,volume,pan});
  audio.texture=(time,duration,from,to,volume,pan,band)=>calls.push({voice:'texture',time,duration,from,to,volume,pan,band});
  const impact=audio.damageImpact;
  audio.damageImpact=function(event,time,pan){const first=calls.length,kind=impact.call(this,event,time,pan);if(kind)cues.push({kind,time,calls:calls.slice(first)});return kind;};
  return {audio,calls,cues};
}

test('solo and link combat expose the same attribute multiplier independently of critical hits and guard',()=>{
  let count=0;const seen=new Set();
  for(const element of [null,...Object.keys(DATA.elements)])for(const defenderElement of Object.keys(DATA.elements)){
    const expected=new Engine().effectiveness(element,defenderElement),critical=count%3===0,guarded=count%2===0;
    for(const mode of ['single','double']){
      const pair=combatPair(element,forElement(defenderElement),critical,guarded,mode);
      for(const event of Object.values(pair)){
        assert(event,'a landed attack produces a damage event');assert.equal(event.effectiveness,expected);
        assert.equal(event.critical,critical);assert.equal(event.guarded,guarded);assert(event.amount>0);
        const effect=BattleVFX.fromEvent(event,null,100);assert.equal(effect.effectiveness,expected,'VFX retains combat metadata');
        const {audio}=spyAudio();assert.equal(audio.damageImpact(effect,11),classify(expected));
      }
    }
    seen.add(expected);count++;
  }
  assert.deepEqual([...seen].sort(),[.7,.8,1,1.5]);assert.equal(count,42);
});

test('three impact signatures stay distinct and use affinity, not numerical damage or log text',()=>{
  const {audio,calls}=spyAudio(),signatures=new Set();
  for(const effectiveness of [1.5,.7,1]){
    const event={kind:'damage',amount:1,effectiveness,critical:true,guarded:true,text:'急所! 属性が有利!'};
    calls.length=0;const kind=audio.damageImpact(event,11,.3),signature=JSON.stringify(calls);signatures.add(signature);
    assert.equal(kind,classify(effectiveness));assert(calls.length>=2&&calls.length<=3);
    assert(calls.every(call=>call.time>=11&&call.time<=11.06&&call.volume<=.12));
    calls.length=0;audio.damageImpact({...event,amount:99999,critical:false,guarded:false,text:'属性が不利'},11,.3);
    assert.equal(JSON.stringify(calls),signature,'critical, guard, damage roll and translated text cannot change the result cue');
  }
  assert.equal(signatures.size,3);
});

test('move and fallback paths schedule exactly one cue on the actual VFX impact, including shortened playback',()=>{
  for(const duration of [940,1180,180,100])for(const effectiveness of [1.5,.7,1]){
    const event={kind:'damage',amount:37,effectiveness,moveId:'spark',side:'ally'},effect={duration,releaseAt:.14,impactAt:.43};
    const {audio,cues}=spyAudio(),expected=10.008+duration/1000*.43;
    audio.move(DATA.moves.spark,event,effect);assert.equal(cues.length,1);assert.equal(cues[0].kind,classify(effectiveness));
    assert(Math.abs(cues[0].time-expected)<1e-9,'not a fixed 1-second animation');
    audio.move(DATA.moves.spark,event,effect);assert.equal(cues.length,1,'duplicate same-frame playback is suppressed');
    audio.ctx.currentTime+=2;audio.move(DATA.moves.spark,event,effect);assert.equal(cues.length,2,'a later real hit still plays');
    const fallback=spyAudio();fallback.audio.fx('damage',{event,effect});assert.equal(fallback.cues.length,1);
    assert(Math.abs(fallback.cues[0].time-(10.006+duration/1000*.43))<1e-9);
    assert.equal(fallback.calls.length,fallback.cues[0].calls.length,'no second generic hit is layered on the fallback');
  }
});

test('misses, healing, guard, boosts, residual damage and disabled audio never emit an affinity cue',()=>{
  for(const kind of ['miss','heal','guard','boost','status','statusTick','recoil','faint','switch']){
    const {audio,cues}=spyAudio();audio.move(DATA.moves.spark,{kind,effectiveness:1.5,amount:25},{duration:940});assert.equal(cues.length,0,kind);
    const direct=spyAudio();direct.audio.fx('damage',{event:{kind,effectiveness:1.5,amount:25}});assert.equal(direct.calls.length,0,kind+' fallback');
  }
  for(const effectiveness of [undefined,null,NaN,Infinity,-1,0,'1.5']){
    const {audio,cues}=spyAudio();audio.damageImpact({kind:'damage',effectiveness},11);assert.equal(cues.length,0,'missing or malformed metadata');
  }
  for(const disabled of ['mute','suspended']){
    const {audio,calls}=spyAudio();if(disabled==='mute')audio.enabled=false;else audio.ctx.state='suspended';
    const event={kind:'damage',effectiveness:1.5,amount:30};audio.move(DATA.moves.spark,event);audio.fx('damage',event);audio.damageImpact(event,11);
    assert.equal(calls.length,0,disabled);
  }
  const {audio,calls}=spyAudio();audio.damageImpact({kind:'damage',effectiveness:1.5,amount:0},11);assert.equal(calls.length,0);
});

test('online single and double playback preserve affinity and impact timing and sound once across frames',()=>{
  for(const mode of ['single','double']){
    const {audio,cues}=spyAudio(),received=[];
    const localLT={DATA,Art:{battle(){}},PixelSprites:{duel(){}},
      playMoveSound(move,event,effect){received.push({event,effect});audio.move(move,event,effect);},
      playDamageSound(event,effect){received.push({event,effect});audio.fx('damage',{event,effect});}};
    const sandbox={LT:localLT,localStorage:{getItem:()=>JSON.stringify({quality:'low',reducedMotion:true})}};
    vm.runInNewContext(vfxSource,sandbox);
    const canvas={width:768,height:440,getContext:()=>({})};
    for(const [index,effectiveness] of [1.5,.7,1].entries()){
      const now=1000+index*3000;audio.ctx.currentTime=now/1000;
      const state={seed:7,round:index+1,turn:index+1,winner:null,mode,teams:[{},{}],
        events:[{kind:'damage',move:index===2?'unknown_technique':'spark',amount:37,effectiveness,critical:true,side:1,slot:mode==='double'?1:0,target:0,text:'着弾'}]};
      localLT.PixelSprites.duel(canvas,state,0,now);localLT.PixelSprites.duel(canvas,state,0,now+16);localLT.PixelSprites.duel(canvas,state,0,now+32);
      assert.equal(cues.length,index+1);assert.equal(received.length,index+1,'one cue per event, not one per animation frame');
      assert.equal(cues[index].kind,classify(effectiveness));assert.equal(received[index].event.effectiveness,effectiveness);
      assert.equal(received[index].effect.duration,180,'the reduced-motion timeline is passed to Audio');
      assert(cues[index].time<now/1000+.1,'the hit cannot spill into the next reduced-motion message');
    }
  }
});

test('solo fast-forward and reduced motion pass a shortened sound clock without mutating the event',async()=>{
  const source=html.slice(html.indexOf('  const TEXT_PACE='),html.indexOf('  async function doBattle('));assert(source.includes('playBattleEvents'));
  for(const reducedMotion of [false,true]){
    const heard=[],waits=[],original={kind:'damage',moveId:'spark',effectiveness:1.5,amount:33,text:'着弾'},snapshot=copy(original);
    const box={replaceChildren(){},appendChild(){},scrollTop:0,scrollHeight:1};
    let c,timers=0;
    c=vm.createContext({LT,DATA,settings:{reducedMotion,textSpeed:'instant'},busy:false,battleEffect:null,battleView:null,
      performance:{now:()=>100},document:{createElement:()=>({})},
      $:id=>id==='battle-log'?box:id==='battle-actions'?{querySelectorAll:()=>[]}:{classList:{add(){},remove(){}}},
      sound:{fx(){},move(move,event,effect){heard.push(copy(effect));}},updateAll(){},save(){},applyBattleVisual(){},battleHealthDuration(){return 0;},
      setTimeout(fn,ms){waits.push(ms);if(timers++===0)vm.runInContext('battleSkip=true',c);return setTimeout(fn,0);},clearTimeout});
    vm.runInContext(source,c);
    await c.playBattleEvents({events:[{kind:'text',text:'早送り'},original]});
    assert.equal(heard.length,1);assert(heard[0].duration<=230);assert(heard[0].duration*.43<waits.at(-1));
    if(reducedMotion)assert.equal(heard[0].duration,180);assert.deepEqual(original,snapshot);
  }
});

// The same graph primitives as the real AudioContext, with scheduling checks.
class Param {
  constructor(value=0){this.value=value;}
  setValueAtTime(v,t){assert(Number.isFinite(v)&&Number.isFinite(t)&&t>=0);this.value=v;}
  linearRampToValueAtTime(v,t){this.setValueAtTime(v,t);}
  exponentialRampToValueAtTime(v,t){assert(v>0);this.setValueAtTime(v,t);}
  setTargetAtTime(v,t,c){assert(c>0);this.setValueAtTime(v,t);}
  cancelScheduledValues(t){assert(Number.isFinite(t));}
}
class Node {
  constructor(){this.connections=[];for(const key of ['gain','frequency','detune','pan','Q','threshold','knee','ratio','attack','release','delayTime'])this[key]=new Param();}
  connect(node){this.connections.push(node);return node;}disconnect(){this.connections=[];}
  setPeriodicWave(){}start(time){assert(Number.isFinite(time)&&time>=0);this.started=time;}stop(time){assert(Number.isFinite(time)&&time>=this.started);}
}
class Context {
  constructor(){this.currentTime=10;this.state='running';this.sampleRate=8000;this.destination=new Node();}
  createGain(){return new Node();}createOscillator(){return new Node();}createBiquadFilter(){return new Node();}
  createStereoPanner(){return new Node();}createDynamicsCompressor(){return new Node();}createConvolver(){return new Node();}
  createDelay(){return new Node();}createBufferSource(){return new Node();}createPeriodicWave(){return {};}
  createBuffer(channels,length){const data=Array.from({length:channels},()=>new Float32Array(length));return {getChannelData:i=>data[i]};}
}
test('the actual graph reserves room for result cues with a full BGM and respects quality and master volume',()=>{
  for(const quality of ['high','low'])for(const effectiveness of [1.5,.7,1]){
    const c=vm.createContext({console,AudioContext:Context,navigator:{},document:{hidden:false},matchMedia:()=>({matches:quality==='low'})});
    vm.runInContext(audioSource,c);const audio=new c.LT.Audio();audio.setup();audio.enabled=true;audio.setVolume(.25);
    assert.equal(audio.master.gain.value,.18,'effects route through the existing user volume');
    const group={bus:audio.ctx.createGain(),voices:new Set()};
    for(let i=0;i<audio.maxVoices;i++)audio.instrument(group,'piano',60,10,.5,.05);
    assert.equal(audio.voices.size,audio.maxVoices-8,'BGM preserves eight FX voices');
    const cueVoices=[];const impact=audio.damageImpact;
    audio.damageImpact=function(...args){const before=new Set(this.voices),kind=impact.apply(this,args);cueVoices.push(...[...this.voices].filter(v=>!before.has(v)));return kind;};
    audio.move(DATA.moves.arvelion_nova,{kind:'damage',effectiveness,amount:140},{duration:1180,impactAt:.43,releaseAt:.14});
    assert.equal(cueVoices.length,effectiveness>1?3:2,'cue is reserved before ornamental move layers');
    assert(audio.voices.size<=audio.maxVoices,quality+' voice cap');
    for(const voice of cueVoices){assert.equal(voice.group,null);assert(voice.nodes.some(n=>n.connections.includes(audio.fxBus)));}
    audio.setVolume(0);assert.equal(audio.master.gain.value,0,'volume zero silences the shared output');
    for(const voice of [...audio.voices])audio.disposeVoice(voice);assert.equal(audio.voices.size,0,'scheduled voices dispose cleanly');
  }
});

test('mobile nova preserves every BGM note during dense climaxes and retains all three impact cues',()=>{
  for(const quality of ['high','low'])for(const track of ['champion','glitchbattle']){
    class ClockContext extends Context {constructor(){super();this.currentTime=0;}}
    const c=vm.createContext({console,AudioContext:ClockContext,navigator:{},document:{hidden:false},matchMedia:()=>({matches:quality==='low'})});
    vm.runInContext(audioSource,c);const audio=new c.LT.Audio();audio.setup();audio.enabled=true;
    const dropped=[],cues=[],impact=audio.damageImpact;
    for(const name of ['instrument','drum','texture','sweep']){
      const original=audio[name];audio[name]=function(...args){
        const music=(name==='instrument'||name==='drum')&&!!args[0],before=this.voices.size,result=original.apply(this,args);
        if(music&&this.voices.size===before)dropped.push({at:this.ctx.currentTime,kind:args[1]});
        assert(this.voices.size<=this.maxVoices);return result;
      };
    }
    audio.damageImpact=function(...args){const before=this.voices.size,kind=impact.apply(this,args);cues.push({kind,voices:this.voices.size-before});return kind;};
    audio.switchTrack(track,true);audio.group.step=48*8;
    const hits=[{at:.8,factor:1.5},{at:3,factor:1},{at:5.2,factor:.7}];let index=0;
    // Match browser playback: 20 ms ticks and the production 180 ms lookahead.
    for(let step=0;step<450;step++){
      audio.ctx.currentTime=step*.02;audio.prune(audio.ctx.currentTime);
      while(index<hits.length&&hits[index].at<=audio.ctx.currentTime+.00001){
        const hit=hits[index++];audio.move(DATA.moves.arvelion_nova,{kind:'damage',side:'ally',amount:23,effectiveness:hit.factor},{duration:1180,releaseAt:.14,impactAt:.43});
      }
      audio.tick();
    }
    assert.deepEqual(dropped,[],track+'/'+quality+': both melody and accompaniment keep every scheduled note');
    assert.deepEqual(cues,[{kind:'super',voices:3},{kind:'normal',voices:2},{kind:'resisted',voices:2}]);
  }
});
