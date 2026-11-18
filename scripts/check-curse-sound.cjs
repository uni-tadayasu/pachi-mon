#!/usr/bin/env node
'use strict';
// Soft curse bounce: actual synthesis, volume/lock gates, and both event players.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const {canvas}=require('./check-art.cjs');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]);
const audioSource=scripts.find(code=>code.includes('class LuminaAudio'));assert(audioSource);
const vfxSource=fs.readFileSync(path.join(root,'battle-vfx.js'),'utf8'),copy=value=>JSON.parse(JSON.stringify(value));
const DATA={moves:{null_curse:{id:'null_curse',name:'虚無の呪縛',kind:'attack',category:'status',power:0,element:'void'}},volatileConditions:{curse:{name:'呪縛'}}};
const event=moment=>moment==='tick'?{kind:'statusTick',status:'curse',side:1,slot:0,amount:24,text:'呪縛で24ダメージ。'}
  :{kind:'status',status:'curse',side:1,slot:0,move:'null_curse',text:'虚無の呪縛にとらわれた！'};

class Param {
  constructor(value=0){this.value=value;this.events=[];}
  add(kind,v,t){assert(Number.isFinite(v)&&Number.isFinite(t)&&t>=0);this.value=v;this.events.push({kind,v,t});}
  setValueAtTime(v,t){this.add('set',v,t);}linearRampToValueAtTime(v,t){this.add('linear',v,t);}
  exponentialRampToValueAtTime(v,t){assert(v>0);this.add('exponential',v,t);}
  setTargetAtTime(v,t,c){assert(c>0);this.add('target',v,t);}cancelScheduledValues(t){assert(Number.isFinite(t));}
}
class Node {
  constructor(){this.connections=[];for(const key of ['gain','frequency','detune','pan','Q','threshold','knee','ratio','attack','release','delayTime'])this[key]=new Param();}
  connect(node){assert(node);this.connections.push(node);return node;}disconnect(){this.connections=[];}
  setPeriodicWave(wave){this.wave=wave;}start(time){assert(Number.isFinite(time)&&time>=0);this.started=time;}
  stop(time){assert(Number.isFinite(time)&&time>=this.started);this.stopped=time;}
}
class Context {
  constructor(){this.currentTime=10;this.state='running';this.sampleRate=8000;this.destination=new Node();}
  createGain(){return new Node();}createOscillator(){return new Node();}createBiquadFilter(){return new Node();}
  createStereoPanner(){return new Node();}createDynamicsCompressor(){return new Node();}createConvolver(){return new Node();}
  createDelay(){return new Node();}createBufferSource(){return new Node();}createPeriodicWave(){return {};}
  createBuffer(channels,length){const data=Array.from({length:channels},()=>new Float32Array(length));return {getChannelData:i=>data[i]};}
}
function harness(quality='high'){
  const c=vm.createContext({console,AudioContext:Context,navigator:{},document:{hidden:false},matchMedia:()=>({matches:quality==='low'})});
  vm.runInContext(audioSource,c);const audio=new c.LT.Audio();audio.setup();audio.enabled=true;audio.setVolume(.42);
  return audio;
}
function soundShape(audio,moment,duration){
  const before=new Set(audio.voices);audio.fx('status',{condition:'curse',moment,duration});
  const voices=[...audio.voices].filter(v=>!before.has(v));
  return {voices,end:Math.max(...voices.map(v=>v.end))-audio.ctx.currentTime,
    peaks:voices.map(v=>Math.max(...v.nodes.flatMap(n=>n.gain.events.map(e=>e.v))))};
}

test('curse has a soft falling/rising contour, a quieter shorter tick, and a bounded shared FX graph',()=>{
  for(const quality of ['high','low']){
    const full=harness(quality),short=harness(quality),inflict=soundShape(full,'inflict',1100),tick=soundShape(short,'tick',1000);
    assert(inflict.voices.length>=2&&inflict.voices.length<=3);assert(tick.voices.length<=2);
    assert(inflict.end<1.1&&inflict.end>.65);assert(tick.end<.5&&tick.end<inflict.end*.6);
    assert(Math.max(...tick.peaks)<Math.max(...inflict.peaks)*.55,'Repeated damage has lower peak gain');
    for(const {voices,bus}of[{voices:inflict.voices,bus:full.fxBus},{voices:tick.voices,bus:short.fxBus}]){
      const contour=voices[0].sources[0].frequency.events.map(e=>e.v);
      assert(contour[1]<contour[0]&&contour[2]>contour[0]&&contour.at(-1)<contour[2],'Landing, upward spring, then a soft descent');
      for(const voice of voices){
        assert.equal(voice.group,null);assert.equal(voice.sources.length,1,'No extra noise or percussion on each tick');
        assert(voice.nodes.some(n=>n.connections.includes(bus)));
        for(const source of voice.sources)assert.equal(source.stopped,voice.end);
        const gain=voice.nodes.find(n=>n.gain.events.length);assert.equal(gain.gain.events.at(-1).v,.0001,'Click-free release');
      }
    }
    assert.equal(full.currentId,'title');assert.equal(full.group,null,'A status cue never starts or replaces background music');
  }
});

test('mute, suspended audio, volume, mobile voice reservation, cleanup, and shortened beats remain effective',()=>{
  for(const state of ['muted','suspended','interrupted','absent']){
    const audio=harness();if(state==='muted')audio.enabled=false;else if(state==='absent')audio.ctx=null;else audio.ctx.state=state;
    audio.fx('status',{condition:'curse',moment:'inflict'});assert.equal(audio.voices.size,0,state);
  }
  for(const moment of ['inflict','tick']){
    const audio=harness('low'),group={bus:audio.ctx.createGain(),voices:new Set()};
    for(let i=0;i<audio.maxVoices;i++)audio.instrument(group,'piano',60,10,.5,.05);
    assert.equal(audio.voices.size,audio.maxVoices-8);
    const cue=soundShape(audio,moment,180);assert(cue.voices.length>0);assert(cue.end<.2,'Reduced-motion online beat includes the complete shortened tail');
    assert(audio.voices.size<=audio.maxVoices);audio.setVolume(.25);assert.equal(audio.master.gain.value,.18);
    audio.setVolume(0);assert.equal(audio.master.gain.value,0);
    audio.ctx.currentTime=20;audio.prune(20);assert.equal(audio.voices.size,0);assert.equal(group.voices.size,0);
    for(const voice of cue.voices)assert(voice.nodes.every(n=>n.connections.length===0));
  }
});

test('solo infliction and damage events reach the curse cue once, with normal and reduced motion',async()=>{
  const source=html.slice(html.indexOf('  const TEXT_PACE='),html.indexOf('  async function doBattle('));assert(source.includes('playBattleEvents'));
  for(const reducedMotion of [false,true]){
    const audio=harness(),heard=[],LT={DATA};vm.runInNewContext(vfxSource,{LT});
    const original=audio.fx.bind(audio);audio.fx=(kind,effect)=>{heard.push({kind,condition:effect?.condition,moment:effect?.moment});original(kind,effect);};
    const box={replaceChildren(){},appendChild(){},scrollTop:0,scrollHeight:1};
    const c=vm.createContext({LT,DATA,settings:{reducedMotion,textSpeed:'instant'},busy:false,battleEffect:null,battleView:null,
      performance:{now:()=>100},document:{createElement:()=>({})},
      $:id=>id==='battle-log'?box:id==='battle-actions'?{querySelectorAll:()=>[]}:{classList:{add(){},remove(){}}},
      sound:audio,updateAll(){},save(){},applyBattleVisual(){},battleHealthDuration:()=>0,
      setTimeout(fn){return setTimeout(fn,0);},clearTimeout});
    vm.runInContext(source,c);const events=[event('inflict'),event('tick')],before=copy(events);
    await c.playBattleEvents({events});
    assert.deepEqual(heard,[{kind:'status',condition:'curse',moment:'inflict'},{kind:'status',condition:'curse',moment:'tick'}]);
    assert.equal(audio.voices.size,5);assert.deepEqual(events,before);
  }
});

test('single and double online playback use the status bridge once per beat, never the move cue or hit fallback',()=>{
  for(const mode of ['single','double'])for(const reducedMotion of [false,true]){
    const audio=harness('low'),heard=[],LT={DATA,Art:{battle(){}},PixelSprites:{duel(){}},
      playStatusSound(effect){heard.push(copy(effect));audio.fx('status',effect);},
      playMoveSound(){assert.fail('Condition infliction must not repeat the move sound');},playDamageSound(){assert.fail('A curse tick is its own sound');}};
    vm.runInNewContext(vfxSource,{LT,localStorage:{getItem:()=>JSON.stringify({quality:'low',reducedMotion,textSpeed:'instant'})}});
    const cv=canvas.createCanvas(320,220),state={seed:49,round:2,turn:2,winner:null,mode,teams:[{},{}],events:[event('inflict'),event('tick')]};
    if(mode==='double')state.events.forEach(e=>e.slot=1);
    const before=copy(state),plan=LT.BattleVFX.onlinePlan(state);
    for(const beat of plan.beats)for(const delta of [0,16,32]){
      const now=1000+beat.start+delta;audio.ctx.currentTime=now/1000;LT.PixelSprites.duel(cv,state,0,now);
    }
    assert.deepEqual(heard.map(e=>[e.condition,e.moment]),[['curse','inflict'],['curse','tick']]);
    assert(heard.every(e=>e.move===''&&e.side===1&&e.slot===(mode==='double'?1:0)));
    if(reducedMotion)assert(heard.every(e=>e.duration===180));assert.deepEqual(state,before);
    cv.width=cv.height=1;
  }
});
