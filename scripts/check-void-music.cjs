#!/usr/bin/env node
'use strict';
// Exercise the shipped music engine and displayed-state bridges. Fake media
// promises deliberately finish out of order to catch cross-scene playback races.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const source=scripts.find(m=>m[2].includes('class LuminaAudio'))[2];
const dataContext=vm.createContext({console});
for(const [,attributes,code] of scripts){if(/\bsrc=|application\/ld\+json/.test(attributes))continue;vm.runInContext(code,dataContext);if(dataContext.LT?.Engine)break;}
const D=dataContext.LT.DATA,copy=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
class Param{
  constructor(value=0){this.value=value;this.events=[];}
  setValueAtTime(v,t){this.value=v;this.events.push(['set',v,t]);}
  linearRampToValueAtTime(v,t){this.value=v;this.events.push(['ramp',v,t]);}
  setTargetAtTime(v,t){this.value=v;this.events.push(['target',v,t]);}
  exponentialRampToValueAtTime(v,t){this.value=v;this.events.push(['exp',v,t]);}
  cancelScheduledValues(){}
}
class Node{
  constructor(kind){this.kind=kind;this.outputs=[];for(const k of ['gain','frequency','Q','detune','pan','delayTime','threshold','knee','ratio','attack','release'])this[k]=new Param(1);}
  connect(n){this.outputs.push(n);return n;}disconnect(){this.outputs=[];}start(){}stop(){}setPeriodicWave(){}
}
function world({deferFetch=false}={}){
  const log={fetches:[],requests:[],audios:[],revoked:[],sources:[]},timers=new Map(),plays=[];let timerId=0,blobId=0;
  class Context{
    constructor(){this.currentTime=0;this.sampleRate=4000;this.state='running';this.destination=new Node('destination');}
    resume(){this.state='running';return Promise.resolve();}suspend(){this.state='suspended';return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}
    createGain(){return new Node('gain');}createOscillator(){return new Node('oscillator');}createBiquadFilter(){return new Node('filter');}createStereoPanner(){return new Node('pan');}
    createDynamicsCompressor(){return new Node('compressor');}createConvolver(){return new Node('convolver');}createDelay(){return new Node('delay');}createBufferSource(){return new Node('buffer');}createWaveShaper(){return new Node('shaper');}
    createPeriodicWave(){return {};}createBuffer(channels,length,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(length));return {getChannelData:i=>data[i],length,sampleRate};}
    createMediaElementSource(audio){const node=new Node('media');node.audio=audio;log.sources.push(node);return node;}
  }
  class Audio{
    constructor(){this.paused=true;this.currentTime=0;this.attrs={};this.listeners={};this.plays=0;log.audios.push(this);}
    setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this[k];}
    addEventListener(k,fn){this.listeners[k]=fn;}
    play(){this.plays++;const behavior=plays.shift();if(behavior instanceof Error)return Promise.reject(behavior);this.paused=false;return behavior?.promise||Promise.resolve();}
    pause(){this.paused=true;}fail(){this.listeners.error?.();}
  }
  const context=vm.createContext({console,LT:{DATA:D},AudioContext:Context,Audio,navigator:{},matchMedia:()=>({matches:false}),document:{hidden:false,dispatchEvent(){}},CustomEvent:class{},
    setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
    URL:{createObjectURL:()=>`blob:recording-${++blobId}`,revokeObjectURL:url=>log.revoked.push(url)},
    fetch(url){log.fetches.push(url);const task=deferred();log.requests.push(task);if(!deferFetch)task.resolve({ok:true,blob:async()=>({size:1})});return task.promise;}
  });
  vm.runInContext(source,context);const sound=new context.LT.Audio();sound.instrument=()=>{};sound.drum=()=>{};
  return {sound,context,log,plays,timers,flushTimers(){const pending=[...timers.values()];timers.clear();for(const t of pending)t.fn();},ready(index){log.requests[index].resolve({ok:true,blob:async()=>({size:1})});}};
}
const mon=(species='komori',hp=50)=>({species,hp});
const solo=(ally='komori',enemy='shizuku',extra={})=>({map:'village',party:[mon(ally),mon('nullva')],battle:{activeIndex:0,enemy:mon(enemy),...extra}});
const team=(active,ids)=>({active,monsters:ids.map(id=>mon(id))});
const duel=(teams,extra={})=>({theme:'meadow',battle:{teams,rival:true,...extra}});

test('active 無 wins over every battle theme, while reserves, fainted and finished combatants do not',()=>{
  const {sound}=world();
  for(const id of ['nullmie','nullva','zeroveil']){
    for(const extra of [{},{guardian:'mio'},{rival:'test'},{towerFloor:4},{elite:'one'},{champion:D.champion2.id},{rival:'glitch-keeper'}]){
      sound.setScene(solo(id,'shizuku',extra));assert.equal(sound.currentId,'glitchbattle');
      sound.setScene(solo('komori',id,extra));assert.equal(sound.currentId,'glitchbattle');
      assert(sound.recordingDefinition(sound.currentId),'void recording mode');
    }
  }
  sound.setScene(solo('komori','arvelion'));assert.equal(sound.currentId,'legend');
  sound.setScene(solo('komori','shizuku'));assert.equal(sound.currentId,'battle','reserve void has no effect');
  const faint=solo('nullmie');faint.party[0].hp=0;sound.setScene(faint);assert.equal(sound.currentId,'battle');
  for(const [result,id] of [['won','victory'],['caught','resonance'],['lost','village'],['fled','village']]){
    sound.setScene(solo('nullmie','nullva',{result}));assert.equal(sound.currentId,id,result);
  }
  sound.setScene(solo('komori','shizuku',{rival:'glitch-keeper'}));assert.equal(sound.currentId,'glitchbattle');assert.equal(sound.recordingDefinition(sound.currentId),null,'keeper keeps original synth');
});

test('single and double battles inspect both sides and all live active slots',()=>{
  const {sound}=world();
  for(const side of [0,1])for(const slots of [1,2])for(let slot=0;slot<slots;slot++){
    const teams=[team([...Array(slots).keys()],['komori','shizuku','nullmie']),team([...Array(slots).keys()],['hibana','fuwari','nullva'])];
    sound.setScene(duel(teams));assert.notEqual(sound.currentId,'glitchbattle','benched hidden members do not select theme');
    teams[side].monsters[slot]=mon('zeroveil');sound.setScene(duel(teams));assert.equal(sound.currentId,'glitchbattle');
    teams[side].monsters[slot].hp=0;sound.setScene(duel(teams));assert.notEqual(sound.currentId,'glitchbattle');
  }
  const teams=[team([0,1],['nullmie','nullva','komori']),team([0,1],['shizuku','hibana','fuwari'])];
  teams[0].monsters[0].hp=0;sound.setScene(duel(teams));assert.equal(sound.currentId,'glitchbattle','other live void retains priority');
});

test('recorded priority, explicit preview, ducking, fades and unchanged scene updates share one bounded playback',async()=>{
  const w=world(),a=w.sound;await a.setEnabled(true);await settle();const title=a.recording;
  a.setScene(solo('nullmie'));await settle();const rec=a.group.recording,group=a.group;
  assert.equal(rec.id,'glitchbattle');assert(rec.audio.loop);assert.equal(rec.audio.attrs.playsinline,'');
  assert.equal(rec.gain.outputs[0],a.recordedMusicBus);assert.equal(a.recordedMusicBus.outputs[0],a.mix);
  assert.equal(title.gain.outputs[0],a.mix,'title bypass remains unchanged');
  rec.audio.currentTime=38;
  for(let i=0;i<5;i++)a.setScene(solo(i%2?'nullva':'zeroveil'));
  assert.equal(a.group,group);assert.equal(rec.audio.currentTime,38);assert.equal(rec.audio.plays,1);
  a.duckMusic(1,.75,.4);assert(a.recordedMusicBus.gain.events.some(e=>e[0]==='ramp'&&e[1]===.4));assert(a.musicBus.gain.events.some(e=>e[0]==='ramp'&&e[1]===.4));
  const volume=a.volume;a.setVolume(.22);assert.equal(a.master.gain.value,.22*.72);assert.notEqual(volume,a.volume);
  a.preview('village');assert.equal(a.currentId,'village');assert(!a.group.recorded);w.flushTimers();assert(rec.audio.paused&&title.audio.paused);
  a.preview(null);assert.equal(a.group.recording,rec);assert.equal(rec.audio.currentTime,0);assert(!rec.audio.paused);
  a.setScene(solo('komori','shizuku',{rival:'glitch-keeper'}));assert.equal(a.currentId,'glitchbattle');assert(!a.group.recorded,'same ID changes to original keeper synth');
  a.preview('glitchbattle');assert.equal(a.group.recording,rec,'explicit music-room preview selects supplied song');
  a.preview(null);assert(!a.group.recorded,'auto restores keeper synth');
  assert.equal(a.getTracks().length,64);assert.match(a.getTracks()[60].description,/無属性.*優先/);assert.equal(a.getTracks()[60].recording.bpm,152);
  assert.equal(w.log.fetches.filter(url=>url.includes('void-enthusiast')).length,1);
  await a.setEnabled(false);w.flushTimers();assert(w.log.audios.every(el=>el.paused));
});

test('out-of-order title and void loads never resurrect a retired recording',async()=>{
  for(const first of ['title','void']){
    const w=world({deferFetch:true}),a=w.sound;if(first==='void')a.setScene(solo('nullmie'));
    await a.setEnabled(true);a.setScene(first==='title'?solo('nullmie'):{title:true});
    w.ready(1);await settle();const active=a.group.recording;assert(!active.audio.paused);
    w.ready(0);await settle();assert.equal(a.group.recording,active);assert.equal(w.log.audios.filter(el=>!el.paused).length,1);assert.equal(w.log.audios.at(-1).plays,0,'late load is cached silently');
    await a.setEnabled(false);w.flushTimers();
  }
});

test('late play promises, background suspension and disposal cannot revive music or leave blob URLs alive',async()=>{
  const w=world(),a=w.sound;await a.setEnabled(true);await settle();
  const pending=deferred();w.plays.push(pending);a.setScene(solo('nullmie'));await settle();const rec=a.group.recording;
  a.setScene({title:true});pending.resolve();await settle();assert(rec.audio.paused);assert(!a.recording.audio.paused);
  a.setScene(solo('nullmie'));await settle();await a.suspend();assert(w.log.audios.every(el=>el.paused),'including outgoing title fade');
  await a.setEnabled(true);await settle();assert(!rec.audio.paused);assert(a.recording.audio.paused);
  a.dispose();assert.equal(w.timers.size,0,'dispose leaves no recording pause timers');w.flushTimers();assert(w.log.audios.every(el=>el.paused));assert.equal(w.log.revoked.length,2);assert.equal(a.recordings.size,0);
  const late=world({deferFetch:true});await late.sound.setEnabled(true);late.sound.dispose();late.ready(0);await settle();assert.equal(late.log.audios.length,0,'dispose invalidates pending fetch');
});

test('fetch and media errors fall back locally; autoplay denial recovers on the next gesture',async()=>{
  const w=world({deferFetch:true}),a=w.sound;a.setScene(solo('nullmie'));await a.setEnabled(true);
  w.log.requests[0].resolve({ok:false,status:404});await settle();assert(a.recordings.get('glitchbattle').failed);assert(!a.group.recorded);assert.equal(a.currentId,'glitchbattle');
  const group=a.group;a.setScene(solo('nullva'));assert.equal(a.group,group,'fallback does not restart on polling');
  const f=world();f.sound.setScene(solo('nullmie'));const denied=new Error('Denied');denied.name='NotAllowedError';f.plays.push(denied);await f.sound.setEnabled(true);await settle();
  const rec=f.sound.group.recording;assert(rec.blocked);assert(f.sound.needsUnlock());f.sound.primeRecording();await settle();assert(!rec.blocked&&!rec.audio.paused);assert(!f.sound.needsUnlock());
  rec.audio.fail();assert(rec.failed);assert(!f.sound.group.recorded);assert(rec.audio.paused);
  const h=world();await h.sound.setEnabled(true);await settle();h.sound.setScene(solo('nullmie'));await settle();const current=h.sound.group;
  h.sound.recording.audio.fail();assert.equal(h.sound.group,current,'retired title failure leaves void untouched');
  await h.sound.setEnabled(false);h.flushTimers();
});

test('solo bridge follows staged arrivals, and online bridge defers victory until the visible turn finishes',()=>{
  const w=world(),a=w.sound,e=new dataContext.LT.Engine();e.newGame('komori');e.state.party=[e.makeMonster('komori',5),e.makeMonster('nullmie',5)];e.startBattle('shizuku',5);
  const display=Object.create(e);display.state={...e.state,party:copy(e.state.party)};display.battle=copy(e.battle);e.battle.activeIndex=1;
  let now=100;const ui=vm.createContext({LT:w.context.LT,sound:a,engine:e,battleView:display,playing:true,healingUntil:0,evolutionUntil:0,endingActive:false,performance:{now:()=>now},dayPhase:()=>.3,noteHeard(){},updateBattle(){}});
  const scene=html.slice(html.indexOf('  function updateScene(){'),html.indexOf('  function sceneOptions(){'));vm.runInContext(scene,ui);
  const visual=html.slice(html.indexOf('  function applyBattleVisual(visual)'),html.indexOf('  // Handheld-style message pacing.'));vm.runInContext(visual,ui);
  ui.updateScene();assert.equal(a.currentId,'battle','engine final state must not run ahead of visible frame');
  ui.applyBattleVisual({activeIndex:1,ally:e.state.party[1],enemy:e.battle.enemy,enemyIndex:0});assert.equal(a.currentId,'glitchbattle');
  ui.applyBattleVisual({activeIndex:0,ally:e.state.party[0],enemy:e.battle.enemy,enemyIndex:0});assert.equal(a.currentId,'battle');
  vm.runInContext(fs.readFileSync(path.join(root,'battle-vfx.js'),'utf8'),w.context);
  const before=[team([0],['nullmie','komori']),team([0],['shizuku','hibana'])],after=copy(before);after[1].monsters[0].hp=0;
  const battle={seed:450,round:1,turn:1,winner:0,teams:after,events:[{kind:'turn',text:'ターン',visual:{teams:before}},{kind:'damage',text:'命中',side:0,visual:{teams:after}},{kind:'result',text:'勝利',visual:{teams:after}}]};
  w.context.LT.onlineActive=true;w.context.LT.onlineBattle=battle;w.context.LT.onlineBattleResult='won';
  ui.updateScene();assert.equal(a.currentId,'glitchbattle','raw winner cannot interrupt playback');
  now+=w.context.LT.BattleVFX.onlinePlan(battle).total+1;ui.updateScene();assert.equal(a.currentId,'victory');
  w.context.LT.onlineActive=false;ui.battleView=null;e.battle=null;ui.updateScene();assert.equal(a.currentId,'village','closing returns to adventure scene');
});

test('the same-origin recording is included in offline prefetch and the public 64-track catalog stays stable',()=>{
  assert(html.includes('<link rel="prefetch" href="assets/music/void-enthusiast-16bit-v40.mp3?v=20261119-void-theme-v40">'));
  const {sound}=world(),ids=sound.getTracks().map(t=>t.id);assert.equal(new Set(ids).size,64);assert.equal(ids[60],'glitchbattle');
  const info=JSON.parse(fs.readFileSync(path.join(root,'docs/void-theme-v40.json'),'utf8'));
  const asset=fs.readFileSync(path.join(root,info.recording.path));
  assert.equal(asset.length,info.recording.bytes,'the published audio asset is present in full');
  assert.equal(require('node:crypto').createHash('sha256').update(asset).digest('hex'),info.recording.sha256,'asset matches the mastered recording');
  assert.equal(asset.toString('ascii',0,3),'ID3','MP3 container');
  assert(Math.abs(sound.getTracks()[60].recording.seconds-info.recording.seconds)<.01,'music-room duration follows the gapless decoded asset');
});
