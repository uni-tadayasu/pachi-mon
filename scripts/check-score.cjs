#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const source=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(m=>m[1].includes('class LuminaAudio'))[1];
class Param {
  constructor(value=0){this.value=value;this.events=[];}
  add(type,value,time){assert(Number.isFinite(value));assert(Number.isFinite(time)&&time>=0);this.events.push({type,value,time});this.value=value;}
  setValueAtTime(v,t){this.add('set',v,t);}
  linearRampToValueAtTime(v,t){this.add('linear',v,t);}
  exponentialRampToValueAtTime(v,t){assert(v>0);this.add('exponential',v,t);}
  setTargetAtTime(v,t,c){assert(c>0);this.add('target',v,t);}
  cancelScheduledValues(t){assert(Number.isFinite(t));this.events=this.events.filter(e=>e.time<t);}
}
class Node {
  constructor(kind){this.kind=kind;this.connections=[];for(const key of ['gain','frequency','detune','pan','Q','threshold','knee','ratio','attack','release','delayTime'])this[key]=new Param();}
  connect(node){assert(node);this.connections.push(node);return node;}
  disconnect(){this.connections=[];this.disconnected=true;}
  setPeriodicWave(wave){assert(wave);this.wave=wave;}
  start(t){assert(t>=0&&Number.isFinite(t));this.started=t;}
  stop(t){assert(t>=0&&Number.isFinite(t));this.stopped=t;}
}
class Context {
  constructor(){this.currentTime=0;this.sampleRate=8000;this.state='running';this.destination=new Node('destination');this.created=[];}
  node(kind){const n=new Node(kind);this.created.push(n);return n;}
  createGain(){return this.node('gain');} createOscillator(){return this.node('oscillator');}
  createBiquadFilter(){return this.node('filter');} createStereoPanner(){return this.node('pan');}
  createDynamicsCompressor(){return this.node('compressor');} createConvolver(){return this.node('convolver');}
  createDelay(){return this.node('delay');} createBufferSource(){return this.node('buffer-source');}
  createPeriodicWave(real,imag){assert.equal(real.length,imag.length);return {real,imag};}
  createBuffer(channels,length,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(length));return {getChannelData:i=>data[i],length,sampleRate};}
  close(){this.state='closed';return Promise.resolve();}
}
function make(quality='high') {
  const sandbox={console,AudioContext:Context,matchMedia:()=>({matches:quality==='low'}),document:{hidden:false},navigator:{}};
  vm.createContext(sandbox);vm.runInContext(source,sandbox);const audio=new sandbox.LT.Audio();audio.setup();audio.enabled=true;
  return {audio,manifest:sandbox.LT.AUDIO_MANIFEST};
}
function scoreEvents(audio,id) {
  const events=[];audio.instrument=(group,kind,midi,time,duration,velocity,pan=0)=>events.push({kind,midi,time,duration,velocity,pan});
  audio.drum=(group,kind,time,velocity)=>events.push({kind,time,velocity,drum:true});
  audio.switchTrack(id,true);const track=audio.getCurrentTrack(),count=track.bars*Number(track.meter.split('/')[0])*2;
  for(let i=0;i<count;i++){audio.ctx.currentTime=Math.max(0,audio.group.next-.179);audio.tick();}
  return {events,track};
}
test('all 32 original themes have finite, distinct complete arrangements in both quality modes',()=>{
  for(const quality of ['low','high']){
    const signatures=new Set();
    for(const m of make(quality).manifest){
      const {audio}=make(quality),{events,track}=scoreEvents(audio,m.id);
      assert(events.length>100, m.id+' must contain a developed score');
      for(const e of events){assert(Number.isFinite(e.time)&&e.time>=0);assert(e.velocity>0&&e.velocity<=.45);if(!e.drum){assert(e.midi>=12&&e.midi<=108);assert(e.duration>0&&e.duration<10);}}
      assert.match(track.form,/主題.*間奏.*クライマックス/);
      assert(events.some(e=>e.time>track.duration*.8),'last section must be scheduled');
      signatures.add(JSON.stringify(events.filter(e=>!e.drum).slice(0,24).map(e=>[e.kind,e.midi,e.duration])));
    }
    assert.equal(signatures.size,32);
  }
});
test('real graph remains bounded with dense music and repeated layered move effects',()=>{
  for(const quality of ['low','high']){
    const {audio}=make(quality);audio.switchTrack('champion',true);
    let peak=0,previous=0;
    for(let frame=0;frame<3600;frame++){
      audio.ctx.currentTime=frame/60;audio.tick();
      if(frame%45===0)audio.move({id:'futo_burst',kind:'attack',category:'special',element:'crystal',power:100},{side:'ally'},{duration:1000,impactAt:.43,releaseAt:.14});
      peak=Math.max(peak,audio.voices.size);assert(audio.voices.size<=audio.maxVoices);
      for(const n of audio.ctx.created.slice(previous)){if(n.started!==undefined)assert(n.stopped>=n.started);}
      previous=audio.ctx.created.length;
      // Do not retain diagnostic objects indefinitely in the test harness.
      if(frame%120===0){audio.ctx.created=[];previous=0;}
    }
    assert(peak>15,'exercise polyphony');audio.stopAll(audio.ctx.currentTime);audio.prune(audio.ctx.currentTime+4);assert.equal(audio.voices.size,0);assert.equal(audio.groups.size,0);
  }
});
test('spell families have different sounds, misses omit impacts and duplicates are suppressed',()=>{
  const {audio}=make(),calls=[];
  audio.instrument=(g,kind,midi,t,d,v)=>calls.push(['note',kind,midi,t,d,v]);
  audio.drum=(g,kind,t,v)=>calls.push(['drum',kind,t,v]);
  audio.texture=(...v)=>calls.push(['texture',...v]);audio.sweep=(...v)=>calls.push(['sweep',...v]);
  const signatures=new Set();
  for(const element of ['ember','tide','leaf','wind','crystal']){
    calls.length=0;audio.ctx.currentTime+=2;const m={id:element,element,kind:'attack',category:'special',power:100};audio.move(m);
    signatures.add(JSON.stringify(calls.map(e=>e.slice(0,3))));const n=calls.length;audio.move(m);assert.equal(calls.length,n);
  }
  assert.equal(signatures.size,5);
  calls.length=0;audio.ctx.currentTime+=2;audio.move({id:'punch',kind:'attack',category:'physical',element:'ember',power:100},{kind:'miss'});
  assert(!calls.some(e=>e[0]==='drum'),'miss must not sound like contact');
  assert(audio.duckUntil>audio.ctx.currentTime);
  const gains=audio.musicBus.gain.events;assert(gains.some(e=>e.value<1));assert.equal(gains.at(-1).value,1);
});
test('sound-disabled paths create no effect voices and never alter user volume',()=>{
  const {audio}=make();audio.setVolume(.23);audio.enabled=false;const before=audio.ctx.created.length;
  audio.move({id:'futo_burst',kind:'attack',element:'crystal',power:100});audio.fx('heal');
  assert.equal(audio.ctx.created.length,before);assert.equal(audio.volume,.23);
});
