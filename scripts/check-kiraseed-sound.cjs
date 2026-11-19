#!/usr/bin/env node
'use strict';
// Four authored Kiraseed cues, their real event paths, and the shared audio budget.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const {canvas}=require('./check-art.cjs');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const select=marker=>{const code=scripts.find(([, ,source])=>source.includes(marker))?.[2];assert(code,marker);return code;};
const audioSource=select('class LuminaAudio'),vfxSource=fs.readFileSync(path.join(root,'battle-vfx.js'),'utf8'),copy=value=>JSON.parse(JSON.stringify(value));
const loaded=vm.createContext({console});
for(const [,attributes,source]of scripts){if(/\bsrc=|application\/ld\+json/.test(attributes))continue;vm.runInContext(source,loaded);if(loaded.LT?.Engine)break;}
vm.runInContext(select('deterministic, save-independent rental-team duels'),loaded);vm.runInContext(vfxSource,loaded);
const {Engine,Duel,DATA,BattleVFX}=loaded.LT,ids=['verdant_lance','forest_crown','genesis_bloom','root_drain'];
const primary=id=>({kind:id==='root_drain'?'heal':id==='forest_crown'?'attack':'damage',side:'ally',moveId:id,move:id,
  amount:id==='forest_crown'?0:36,effectiveness:1.5,category:DATA.moves[id].category,text:`キラシードの「${DATA.moves[id].name}」。`});

class Param {
  constructor(value=0){this.value=value;this.events=[];}
  add(kind,v,t){assert(Number.isFinite(v)&&Number.isFinite(t)&&t>=0);this.value=v;this.events.push({kind,v,t});}
  setValueAtTime(v,t){this.add('set',v,t);}linearRampToValueAtTime(v,t){this.add('linear',v,t);}
  exponentialRampToValueAtTime(v,t){assert(v>0);this.add('exponential',v,t);}
  setTargetAtTime(v,t,c){assert(c>0);this.add('target',v,t);}cancelScheduledValues(t){assert(Number.isFinite(t));}
}
class Node {
  constructor(kind='node'){this.nodeKind=kind;this.connections=[];for(const key of ['gain','frequency','detune','pan','Q','threshold','knee','ratio','attack','release','delayTime'])this[key]=new Param();}
  connect(node){assert(node);this.connections.push(node);return node;}disconnect(){this.connections=[];}
  setPeriodicWave(wave){this.wave=wave;}start(time){assert(Number.isFinite(time)&&time>=0);this.started=time;}
  stop(time){assert(Number.isFinite(time)&&time>=this.started);this.stopped=time;}
}
class Context {
  constructor(){this.currentTime=10;this.state='running';this.sampleRate=8000;this.destination=new Node();}
  createGain(){return new Node('gain');}createOscillator(){return new Node('oscillator');}createBiquadFilter(){return new Node('filter');}
  createStereoPanner(){return new Node('panner');}createDynamicsCompressor(){return new Node();}createConvolver(){return new Node();}
  createDelay(){return new Node();}createBufferSource(){return new Node('noise');}createPeriodicWave(){return {};}
  createBuffer(channels,length){const data=Array.from({length:channels},()=>new Float32Array(length));return {getChannelData:i=>data[i]};}
}
function harness(quality='high'){
  const c=vm.createContext({console,AudioContext:Context,navigator:{},document:{hidden:false},matchMedia:()=>({matches:quality==='low'})});
  vm.runInContext(audioSource,c);const audio=new c.LT.Audio();audio.setup();audio.enabled=true;audio.setVolume(.42);return audio;
}
function play(audio,id,event=primary(id),effect=BattleVFX.fromEvent(event,null,100)){
  const before=new Set(audio.voices),affinity=new Set(),impacts=[],original=audio.damageImpact;
  audio.damageImpact=function(...args){const previous=new Set(this.voices),kind=original.apply(this,args);impacts.push({kind,time:args[1]});for(const voice of this.voices)if(!previous.has(voice))affinity.add(voice);return kind;};
  try{audio.move(DATA.moves[id],event,effect);}finally{audio.damageImpact=original;}
  const voices=[...audio.voices].filter(v=>!before.has(v));return {voices,custom:voices.filter(v=>!affinity.has(v)),impacts};
}
function noiseCount(voices){return voices.filter(v=>v.sources[0].nodeKind==='noise').length;}

test('the four dedicated motifs are distinct, follow VFX release/impact clocks and shorten through the entire envelope',()=>{
  const signatures=new Set();
  for(const quality of ['high','low'])for(const id of ids)for(const shortened of [false,true]){
    const audio=harness(quality),event=primary(id),effect=BattleVFX.fromEvent(event,null,100);assert(effect);
    if(shortened)effect.duration=180;
    const now=audio.ctx.currentTime+.008,duration=effect.duration/1000,{voices,custom,impacts}=play(audio,id,event,effect);
    assert.equal(custom.length,id==='root_drain'?6:5);assert(voices.length<=8,'The cue fits the eight reserved mobile FX voices');
    for(const voice of custom){
      assert.equal(voice.group,null);assert.equal(voice.sources.length,1);assert(voice.sources[0].started>=now-1e-8);
      assert(voice.end<=now+duration+1e-8,'The authored tail cannot spill beyond a shortened effect');
      assert.equal(voice.sources[0].stopped,voice.end);assert(voice.nodes.some(n=>n.connections.includes(audio.fxBus)));
      const envelope=voice.nodes.find(n=>n.nodeKind==='gain').gain.events;assert.equal(envelope.at(-1).v,.0001);
    }
    if(['verdant_lance','genesis_bloom'].includes(id)){
      assert.equal(impacts.length,1);assert.equal(impacts[0].kind,'super');assert.equal(impacts[0].time,now+duration*effect.impactAt);
    }else assert.equal(impacts.length,0,'Pollen and recovery have no damage-affinity cue');
    assert.equal(noiseCount(custom),id==='verdant_lance'?3:id==='genesis_bloom'?2:1);
    if(id==='verdant_lance')assert(custom.some(v=>v.sources[0].nodeKind==='noise'&&Math.abs(v.sources[0].started-(now+duration*effect.impactAt))<1e-8));
    if(id==='genesis_bloom')assert(custom.some(v=>v.sources[0].frequency.events.at(-1)?.v<50),'The root strike has a low body');
    if(!shortened)signatures.add(JSON.stringify(custom.map(v=>({kind:v.sources[0].nodeKind,f:v.sources[0].frequency.events.map(e=>e.v),filter:v.nodes.find(n=>n.nodeKind==='filter').frequency.events.map(e=>e.v)}))));
    assert.equal(audio.currentId,'title');assert.equal(audio.group,null,'Dedicated effects never start a dedicated BGM');
  }
  assert.equal(signatures.size,4);
});

test('mute, audio lock, no-effect recovery, misses, duplicate frames, volume and full mobile voice budgets stay safe',()=>{
  for(const id of ids)for(const state of ['muted','suspended','interrupted','absent']){
    const audio=harness();if(state==='muted')audio.enabled=false;else if(state==='absent')audio.ctx=null;else audio.ctx.state=state;
    audio.fx('move',{move:DATA.moves[id],event:primary(id)});assert.equal(audio.voices.size,0);
  }
  for(const event of [{...primary('root_drain'),amount:0},{...primary('root_drain'),text:'体力は満タンだった。'}]){
    assert.equal(BattleVFX.fromEvent(event,null,100),null);const audio=harness();play(audio,'root_drain',event,null);
    assert.equal(audio.voices.size,0);assert.equal(audio.musicBus.gain.events.length,0,'No healing success and no music duck when HP cannot recover');
  }
  for(const id of ['verdant_lance','genesis_bloom']){
    const audio=harness(),event={...primary(id),kind:'miss'},cue=play(audio,id,event);
    assert.equal(cue.impacts.length,0);assert.equal(cue.custom.length,2);assert.equal(noiseCount(cue.custom),1,'A miss has only a passing leaf/air cue');
  }
  for(const id of ids){
    const audio=harness('low'),group={bus:audio.ctx.createGain(),voices:new Set()};
    for(let i=0;i<audio.maxVoices;i++)audio.instrument(group,'piano',60,10,.5,.05);
    assert.equal(audio.voices.size,audio.maxVoices-8);
    const event=primary(id),before=copy(event),cue=play(audio,id,event);assert.equal(cue.custom.length,id==='root_drain'?6:5);assert(audio.voices.size<=audio.maxVoices);
    const count=audio.voices.size;play(audio,id,event);assert.equal(audio.voices.size,count,'Rendering the same move twice does not duplicate its sound');
    audio.setVolume(.25);assert.equal(audio.master.gain.value,.18);audio.setVolume(0);assert.equal(audio.master.gain.value,0);
    audio.ctx.currentTime=20;audio.prune(20);assert.equal(audio.voices.size,0);assert.equal(group.voices.size,0);assert(cue.custom.every(v=>v.nodes.every(n=>n.connections.length===0)));assert.deepEqual(event,before);
  }
});

function soloEvents(id){
  const e=new Engine();assert(e.newGame('komori').ok);const actor=e.makeMonster('floravelle',50);actor.hp-=70;e.state.party=[actor];assert(e.startBattle('hibana',50));e.rng=()=>.5;
  const events=[];e.applyMove(actor,e.battle.enemy,DATA.moves[id],'ally',events);return events;
}
function spyPlayback(audio){
  const moves=[],statuses=[],original=audio.kiraseedMove,fx=audio.fx;
  audio.kiraseedMove=function(move,event,clock){moves.push({id:move.id,event:copy(event),clock:copy(clock)});return original.call(this,move,event,clock);};
  audio.fx=function(kind,detail){if(kind==='status')statuses.push(detail?.condition);return fx.call(this,kind,detail);};
  return {moves,statuses};
}

test('real adventure move events reach each dedicated cue once, and pollen gets its own beat before the bloom sound',async()=>{
  const source=html.slice(html.indexOf('  const TEXT_PACE='),html.indexOf('  async function doBattle('));assert(source.includes('playBattleEvents'));
  for(const reducedMotion of [false,true])for(const id of ids){
    const audio=harness(),heard=spyPlayback(audio),LT={DATA,BattleVFX},box={replaceChildren(){},appendChild(){},scrollTop:0,scrollHeight:1};
    const c=vm.createContext({LT,DATA,settings:{reducedMotion,textSpeed:'instant'},busy:false,battleEffect:null,battleView:null,
      performance:{now:()=>100},document:{createElement:()=>({})},
      $:key=>key==='battle-log'?box:key==='battle-actions'?{querySelectorAll:()=>[]}:{classList:{add(){},remove(){}}},
      sound:audio,updateAll(){},save(){},applyBattleVisual(){},battleHealthDuration:()=>0,setTimeout(fn){return setTimeout(fn,0);},clearTimeout});
    vm.runInContext(source,c);const events=soloEvents(id),before=copy(events);await c.playBattleEvents({events});
    assert.deepEqual(heard.moves.map(m=>m.id),[id]);assert.equal(heard.moves[0].event.kind,primary(id).kind);
    if(reducedMotion)assert.equal(heard.moves[0].clock.duration,.18);
    if(id==='forest_crown'){assert.deepEqual(events.map(e=>e.kind),['attack','status']);assert.deepEqual(heard.statuses,['bloom']);}
    assert.deepEqual(copy(events),before);
  }
});

test('real single/double link events use the same cue once per beat, including separate pollen and condition sounds',()=>{
  for(const mode of ['single','double'])for(const reducedMotion of [false,true])for(const id of ids){
    const size=Duel.teamSize(mode),slot=mode==='double'?1:0,first=['floravelle','komori','shizuku','fuwari'];if(slot)[first[0],first[1]]=[first[1],first[0]];
    const d=Duel.create({mode,teams:[['hibana','kirari','shizuku','fuwari'].slice(0,size),first.slice(0,size)],seed:50});d._random=()=>.5;
    const actor=d.active(1)[slot];actor.hp-=70;d._apply({side:1,slot,target:0,technique:DATA.moves[id]},actor);
    const audio=harness('low'),heard=spyPlayback(audio),LT={DATA,Art:{battle(){}},PixelSprites:{duel(){}},
      playMoveSound(move,event,effect){audio.move(move,event,effect);},playStatusSound(effect){audio.fx('status',effect);}};
    vm.runInNewContext(vfxSource,{LT,localStorage:{getItem:()=>JSON.stringify({quality:'low',reducedMotion,textSpeed:'instant'})}});
    const cv=canvas.createCanvas(320,220),state=copy(d.state),before=copy(state),plan=LT.BattleVFX.onlinePlan(state);
    for(const beat of plan.beats)for(const delta of [0,16,32]){const now=1000+beat.start+delta;audio.ctx.currentTime=now/1000;audio.prune(audio.ctx.currentTime);LT.PixelSprites.duel(cv,state,0,now);}
    assert.deepEqual(heard.moves.map(m=>m.id),[id]);assert.equal(heard.moves[0].event.side,1);assert.equal(heard.moves[0].event.slot,slot);
    if(reducedMotion)assert.equal(heard.moves[0].clock.duration,.18);
    if(id==='forest_crown'){assert.deepEqual(state.events.map(e=>e.kind),['attack','status']);assert.deepEqual(heard.statuses,['bloom']);}
    assert.deepEqual(state,before);cv.width=cv.height=1;
  }
});
