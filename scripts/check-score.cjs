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
test('all 64 original themes have finite, distinct complete arrangements in both quality modes',()=>{
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
    assert.equal(signatures.size,64);
  }
});
test('action arrangements retain their melodic themes and individual lead instruments',()=>{
  const themes=[
    ['battle','pulse25',[64,62,64,69,67,64]],
    ['rival','guitarlead',[64,64,67,71,69,67]],
    ['guardian','horn',[62,69,74,72,69]],
    ['champion','horn',[57,69,67,65,64]]
  ];
  for(const quality of ['high','low'])for(const [id,kind,expected] of themes){
    const {audio}=make(quality),{events,track}=scoreEvents(audio,id),barSeconds=240/track.bpm;
    const melody=events.filter(e=>!e.drum&&e.kind===kind&&e.time<.065+barSeconds).map(e=>e.midi);
    assert.deepEqual(melody,expected,`${id}/${quality}: the opening tune must survive orchestration`);
  }
});
test('battle rhythm sections combine independent drums and moving bass in both quality modes',()=>{
  for(const quality of ['high','low'])for(const id of ['battle','rival','guardian','champion']){
    const {audio}=make(quality),{events,track}=scoreEvents(audio,id),unit=30/track.bpm;
    const firstBar=events.filter(e=>e.time<.065+unit*8-.0001);
    assert(firstBar.filter(e=>e.kind==='wavebass').length>=7,`${id}/${quality}: bass must drive the bar`);
    for(const step of [0,2,6]){
      const hits=firstBar.filter(e=>e.drum&&Math.abs(e.time-(.065+step*unit))<.001).map(e=>e.kind);
      assert(hits.includes(step===0?'kick':'snare'),`${id}/${quality}: independent backbeat`);
      assert(hits.includes('hat'),`${id}/${quality}: cymbal and backbeat strike together`);
    }
  }
});
test('the remix starts with sixteenth-note bass and kick pickups without moving the tempo grid',()=>{
  for(const quality of ['high','low'])for(const id of ['battle','rival','guardian','elite','champion','tower','glitchbattle']){
    const {audio}=make(quality),{events,track}=scoreEvents(audio,id),unit=30/track.bpm;
    const opening=events.filter(e=>e.time<.065+unit*8-.0001);
    const halfTick=e=>Math.abs((((e.time-.065)/unit)%1)-.5)<.00001;
    assert(opening.filter(e=>e.kind==='wavebass'&&halfTick(e)).length>=2,`${id}/${quality}: immediate bass pickups`);
    assert(opening.some(e=>e.kind==='kick'&&halfTick(e)),`${id}/${quality}: immediate kick anticipation`);
    assert(opening.some(e=>['marcato','rhythmguitar'].includes(e.kind)&&e.pan>0&&halfTick(e)),`${id}/${quality}: the accompaniment answers offbeat`);
    for(const e of events.filter(e=>e.drum)){
      const ticks=(e.time-.065)/unit*2;
      assert(Math.abs(ticks-Math.round(ticks))<.00001,`${id}/${quality}: percussion must remain on the shared clock`);
    }
  }
});
test('the action band leaves a half-tick after its section fill and answers with a different bass bar',()=>{
  for(const quality of ['high','low']){
    const {audio}=make(quality),{events,track}=scoreEvents(audio,'battle'),unit=30/track.bpm;
    const lastHalf=.065+(7*8+7.5)*unit;
    assert(!events.some(e=>e.drum&&Math.abs(e.time-lastHalf)<.001),'a rhythmic breath must separate the fill and next downbeat');
    const first=events.filter(e=>e.kind==='wavebass'&&e.time<.065+unit*8-.0001).map(e=>e.midi);
    const second=events.filter(e=>e.kind==='wavebass'&&e.time>=.065+unit*8-.0001&&e.time<.065+unit*16-.0001).map(e=>e.midi);
    assert.notDeepEqual(first,second,'two bars with the same chord have different bass performances');
    const held=events.filter(e=>e.kind==='strings'&&Math.abs(e.time-(.065+7*8*unit))<.05);
    assert(held.length>0&&held.every(e=>e.duration<=unit*5.001),'sustained inner parts release before the fill ends');
  }
});
test('complete battle remixes play without dropping music notes in either quality mode',()=>{
  for(const quality of ['high','low'])for(const id of ['battle','rival','guardian','elite','champion','tower','glitchbattle','zenith','legend']){
    const {audio}=make(quality);let peak=0,dropped=0;
    for(const method of ['instrument','drum']){
      const original=audio[method];
      audio[method]=function(...args){if(args[0]&&this.voices.size>=this.maxVoices-8)dropped++;return original.apply(this,args);};
    }
    audio.switchTrack(id,true);const track=audio.getCurrentTrack(),count=track.bars*Number(track.meter.split('/')[0])*2;
    for(let step=0;step<count;step++){
      audio.ctx.currentTime=Math.max(0,audio.group.next-.179);audio.tick();peak=Math.max(peak,audio.voices.size);
      if(step%64===0)audio.ctx.created=[];
    }
    assert.equal(dropped,0,`${id}/${quality}: preserve every scheduled music note`);
    assert(peak<=audio.maxVoices-8,`${id}/${quality}: reserve eight effect voices`);
  }
});
test('the quiet bridge, section fills and final return produce musical contrast',()=>{
  for(const quality of ['high','low']){
    const {audio}=make(quality),{events,track}=scoreEvents(audio,'champion'),barSeconds=240/track.bpm;
    const bars=(start,end)=>events.filter(e=>e.time>=.065+start*barSeconds-.0001&&e.time<.065+end*barSeconds-.0001);
    const chorus=bars(16,24),bridge=bars(32,40),finale=bars(48,56);
    assert(bridge.filter(e=>e.drum).length<chorus.filter(e=>e.drum).length*.6,'bridge needs space before the return');
    assert(!bridge.some(e=>e.kind==='wavebass'),'bridge releases the continuous bass ostinato');
    assert(finale.filter(e=>e.kind==='wavebass').length>40,'the driving bass returns in the finale');
    assert(finale.some(e=>e.kind==='brass'),'climax adds brass');
    const fill=bars(7,8);
    assert(fill.some(e=>e.kind==='tomHigh')&&fill.some(e=>e.kind==='tomLow'),'section fill descends through two toms');
    const arrival=finale.filter(e=>Math.abs(e.time-(.065+48*barSeconds))<.001&&e.drum).map(e=>e.kind);
    assert(arrival.includes('kick')&&arrival.includes('cymbal'),'the finale arrives as a combined band accent');
  }
});
test('rest scenes remain spacious while village and harbor gain acoustic accompaniment',()=>{
  for(const id of ['inn','night','healing']){
    const {audio}=make(),{events}=scoreEvents(audio,id);
    assert(!events.some(e=>e.drum),'resting scenes retain silence in the drum part');
    assert(!events.some(e=>e.kind==='powerguitar'||e.kind==='wavebass'),'resting scenes retain their soft ensemble');
  }
  for(const id of ['village','harbor']){
    const {audio}=make(),{events}=scoreEvents(audio,id);
    assert(events.filter(e=>e.kind==='guitar').length>50,`${id}: audible acoustic accompaniment`);
  }
});
test('repeated scene updates preserve song position and old ensembles retire after their crossfade',()=>{
  const {audio}=make();audio.setScene({map:'meadow'});audio.tick();
  const first=audio.group,step=first.step,next=first.next;
  for(let i=0;i<30;i++)audio.setScene({map:'meadow'});
  assert.equal(audio.group,first);assert.equal(first.step,step);assert.equal(first.next,next);assert.equal(audio.groups.size,1);
  audio.ctx.currentTime=.2;audio.setScene({map:'battle'});audio.tick();
  const current=audio.group;assert.notEqual(current,first);assert(first.retireAt<1);assert.equal(current.retireAt,Infinity);
  assert.equal(first.bus.gain.events.at(-1).value,0,'the old ensemble fades to silence');
  audio.ctx.currentTime=.8;audio.tick();
  assert.equal(audio.group,current);assert.equal(audio.groups.size,1);
  assert(![...audio.voices].some(v=>v.group===first),'retired scene leaves no sounding notes');
});
test('real graph remains bounded with dense music and repeated layered move effects',()=>{
  const techniques=[
    {id:'futo_burst',kind:'attack',category:'special',element:'crystal',power:100},
    {id:'arvelion_rend',kind:'attack',category:'physical',element:'crystal',power:135},
    {id:'arvelion_nova',kind:'attack',category:'special',element:'crystal',power:150},
    {id:'arvelion_crown',kind:'boost',category:'status',element:'crystal'},
    {id:'arvelion_renewal',kind:'heal',category:'status',element:'crystal'}
  ];
  for(const quality of ['low','high']){
    const {audio}=make(quality);audio.switchTrack('champion',true);
    let peak=0,previous=0;
    for(let frame=0;frame<3600;frame++){
      audio.ctx.currentTime=frame/60;audio.tick();
      if(frame%45===0)audio.move(techniques[(frame/45)%techniques.length],{side:'ally'},{duration:1000,impactAt:.43,releaseAt:.14});
      peak=Math.max(peak,audio.voices.size);assert(audio.voices.size<=audio.maxVoices);
      for(const n of audio.ctx.created.slice(previous)){if(n.started!==undefined)assert(n.stopped>=n.started);}
      previous=audio.ctx.created.length;
      // Do not retain diagnostic objects indefinitely in the test harness.
      if(frame%120===0){audio.ctx.created=[];previous=0;}
    }
    assert(peak>15,'exercise polyphony');audio.stopAll(audio.ctx.currentTime);audio.prune(audio.ctx.currentTime+4);assert.equal(audio.voices.size,0);assert.equal(audio.groups.size,0);
  }
});
test('the four legendary techniques have distinct signatures and suppress hit sounds on misses',()=>{
  const {audio}=make(),calls=[],signatures=new Set();
  audio.instrument=(g,kind,midi,t,d,v)=>calls.push(['note',kind,midi,d,v]);
  audio.drum=(g,kind,t,v)=>calls.push(['drum',kind,v]);
  audio.texture=(t,...args)=>calls.push(['texture',...args]);
  audio.sweep=(t,...args)=>calls.push(['sweep',...args]);
  for(const [id,kind,category,power] of [
    ['arvelion_rend','attack','physical',135],['arvelion_nova','attack','special',150],
    ['arvelion_crown','boost','status',0],['arvelion_renewal','heal','status',0]
  ]){
    calls.length=0;audio.ctx.currentTime+=2;
    audio.move({id,kind,category,power,element:'crystal'});
    assert(calls.length>5,`${id} must have a layered signature`);
    signatures.add(JSON.stringify(calls));
  }
  assert.equal(signatures.size,4);
  calls.length=0;audio.ctx.currentTime+=2;
  audio.move({id:'arvelion_nova',kind:'attack',category:'special',power:150,element:'crystal'},{kind:'miss'});
  assert(!calls.some(e=>e[0]==='drum'||e[0]==='note'),'a missed nova must omit its explosion and choir');
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
