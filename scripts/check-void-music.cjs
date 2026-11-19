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
const BATTLE_URL='assets/music/battle-custom.mp3?v=20261119-battle-loop-v63';
const FIELD_URL='assets/music/field-custom.mp3?v=20261119-field-v52';
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

test('無 shares the supplied battle recording on either side, including bosses and both continents',()=>{
  const {sound}=world();
  const cases=[
    [{},'battle'],[{guardian:'mio'},'guardian'],[{rival:'test'},'rival'],
    [{towerFloor:4},'tower'],[{elite:'one'},'elite'],
    [{champion:true},'champion'],[{champion:D.champion2.id},'zenith'],
    [{rival:'glitch-keeper'},'glitchbattle']
  ];
  for(const id of ['nullmie','nullva','zeroveil'])for(const [extra,expected] of cases){
    for(const scene of [solo(id,'shizuku',extra),solo('komori',id,extra),solo(id,id,extra)]){
      sound.setScene(scene);assert.equal(sound.currentId,expected,id+': '+JSON.stringify(extra));
      assert.equal(sound.recordingDefinition(sound.currentId)?.id,'battle-custom','all opponents share the supplied recording');
    }
  }
  const east=Object.entries(D.maps).find(([,map])=>map.continent===2)?.[0];assert(east,'eastern continent fixture');
  for(const id of ['nullmie','nullva','zeroveil']){
    for(const [extra,expected] of [[{},'battle2'],[{guardian:'mio'},'guardian2'],[{rival:'test'},'rival2']]){
      const scene=solo(id,id,extra);scene.map=east;sound.setScene(scene);assert.equal(sound.currentId,expected);
    }
    sound.setScene(solo(id,D.legendary.species));assert.equal(sound.currentId,'legend','legendary opponent keeps its own scene');
    const final=solo(id,id,{guardian:'mio'});final.map='observatory';sound.setScene(final);assert.equal(sound.currentId,'finale');
  }
});

test('online single and double battles keep normal music across every active slot and both teams',()=>{
  const {sound}=world();
  for(const species of ['nullmie','nullva','zeroveil'])for(const side of [0,1])for(const slots of [1,2])for(let slot=0;slot<slots;slot++){
    const teams=[team([...Array(slots).keys()],['komori','shizuku','nullmie']),team([...Array(slots).keys()],['hibana','fuwari','nullva'])];
    sound.setScene(duel(teams));assert.equal(sound.currentId,'rival');
    teams[side].monsters[slot]=mon(species);sound.setScene(duel(teams));assert.equal(sound.currentId,'rival');
    teams[side].monsters[slot].hp=0;sound.setScene(duel(teams));assert.equal(sound.currentId,'rival','fainting does not select another song');
  }
  sound.setScene(duel([team([0,1],['nullmie','nullva']),team([0,1],['zeroveil','nullva'])]));
  assert.equal(sound.currentId,'rival','all four void slots still use the online theme');
  assert.equal(sound.recordingDefinition(sound.currentId)?.id,'battle-custom');
});

test('reserves, fainting, results and non-battle scenes retain their ordinary themes',()=>{
  const {sound}=world();
  sound.setScene(solo());assert.equal(sound.currentId,'battle','reserve void does not alter music');
  const faint=solo('nullmie','nullva');faint.party[0].hp=0;faint.battle.enemy.hp=0;
  sound.setScene(faint);assert.equal(sound.currentId,'battle');
  for(const [result,id] of [['won','victory'],['caught','resonance'],['lost','village'],['fled','village']]){
    sound.setScene(solo('nullmie','nullva',{result}));assert.equal(sound.currentId,id,result);
  }
  sound.setScene(solo('nullmie','nullva',{finished:true}));assert.equal(sound.currentId,'village');
  for(const [flag,id] of [['evolution','evolution'],['healing','healing'],['ending','ending'],['trueEnding','trueending']]){
    const scene=solo('nullmie','nullva');scene[flag]=true;sound.setScene(scene);assert.equal(sound.currentId,id);
  }
});

test('introducing or switching 無 does not restart the common recording or bypass mute and ducking',async()=>{
  const w=world(),a=w.sound;a.setScene(solo());await a.setEnabled(true);await settle();
  const group=a.group;assert(group.recorded);const rec=group.recording;rec.audio.currentTime=27;const plays=rec.audio.plays;
  for(const id of ['nullmie','nullva','zeroveil','komori']){
    a.setScene(solo(id));assert.equal(a.group,group);assert.equal(rec.audio.currentTime,27);assert.equal(rec.audio.plays,plays);
  }
  a.duckMusic(1,.75,.4);assert(a.musicBus.gain.events.some(e=>e[0]==='ramp'&&e[1]===.4));assert(a.recordedMusicBus.gain.events.some(e=>e[0]==='ramp'&&e[1]===.4));
  a.setVolume(.22);assert.equal(a.master.gain.value,.22*.72);
  a.setScene(solo('nullmie','shizuku',{rival:'test'}));assert.equal(a.currentId,'rival');assert.equal(a.group,group,'battle variants share one continuous recording');
  assert.deepEqual(w.log.fetches,[BATTLE_URL,FIELD_URL],'battle and field recordings are prepared, with no species-specific download');assert.equal(w.log.audios.length,2);
  await a.setEnabled(false);assert.equal(a.enabled,false);assert.equal(a.group,null);
});

test('the 64-track catalog and keeper preview restore the original synthesized track 61',async()=>{
  const w=world(),a=w.sound,tracks=a.getTracks();
  assert.equal(tracks.length,64);assert.equal(new Set(tracks.map(t=>t.id)).size,64);
  const keeper=tracks[60];assert.equal(keeper.id,'glitchbattle');assert.equal(keeper.name,'61 NULL BATTLE / ヌルの挑戦');
  assert.match(keeper.description,/裏部屋の番人戦/);assert.equal(keeper.bpm,176);assert.equal(keeper.recording,undefined);
  for(const t of tracks)assert.equal(Boolean(t.recording),['title','battle','expedition'].includes(t.id),'only title, common battle and field previews are recordings');
  a.setScene(solo('nullmie'));a.preview('glitchbattle');await a.setEnabled(true);await settle();
  assert.equal(a.currentId,'glitchbattle');assert(!a.group.recorded);assert.deepEqual(w.log.fetches,[BATTLE_URL,FIELD_URL]);
  a.preview(null);assert.equal(a.currentId,'battle');assert(a.group.recorded);
  a.setScene(solo('nullva','zeroveil',{rival:'glitch-keeper'}));assert.equal(a.currentId,'glitchbattle');assert(a.group.recorded);
});

test('the retained title recording cannot revive over a battle and remains playable on the title',async()=>{
  const w=world({deferFetch:true}),a=w.sound;await a.setEnabled(true);
  a.setScene(solo('nullmie'));const battle=a.group;w.ready(w.log.fetches.findIndex(url=>url.includes('title-16bit')));await settle();
  const rec=a.recording;assert(rec.ready&&rec.audio.paused);assert.equal(rec.audio.plays,0);assert.equal(a.group,battle,'late title load stays silent');
  a.preview('title');await settle();assert(a.group.recorded&&!rec.audio.paused);assert.equal(rec.gain.outputs[0],a.mix);assert(rec.audio.loop);
  rec.audio.currentTime=38;a.preview(null);w.flushTimers();assert(rec.audio.paused);assert.equal(rec.audio.currentTime,0);
  assert.equal(a.currentId,'battle');assert.deepEqual(w.log.fetches,[BATTLE_URL,FIELD_URL,'assets/music/title-16bit.mp3?v=20261117-aishiteirukara']);
  await a.suspend();assert(rec.audio.paused);await a.setEnabled(true);await settle();assert(a.group.recorded&&rec.audio.paused);
  a.dispose();assert.equal(w.timers.size,0);assert.equal(w.log.revoked.length,1);assert.equal(a.recordings.size,0);
});

test('displayed solo swaps preserve normal music and online victory still waits for its visible result',()=>{
  const w=world(),a=w.sound,e=new dataContext.LT.Engine();e.newGame('komori');e.state.party=[e.makeMonster('komori',5),e.makeMonster('nullmie',5)];e.startBattle('shizuku',5);
  const display=Object.create(e);display.state={...e.state,party:copy(e.state.party)};display.battle=copy(e.battle);e.battle.activeIndex=1;
  let now=100;const ui=vm.createContext({LT:w.context.LT,sound:a,engine:e,battleView:display,playing:true,healingUntil:0,evolutionUntil:0,endingActive:false,performance:{now:()=>now},dayPhase:()=>.3,noteHeard(){},updateBattle(){}});
  const scene=html.slice(html.indexOf('  function updateScene(){'),html.indexOf('  function sceneOptions(){'));vm.runInContext(scene,ui);
  const visual=html.slice(html.indexOf('  function applyBattleVisual('),html.indexOf('  // Handheld-style message pacing.'));vm.runInContext(visual,ui);
  ui.updateScene();assert.equal(a.currentId,'battle');
  ui.applyBattleVisual({activeIndex:1,ally:e.state.party[1],enemy:e.battle.enemy,enemyIndex:0});assert.equal(a.currentId,'battle');
  ui.applyBattleVisual({activeIndex:0,ally:e.state.party[0],enemy:e.makeMonster('zeroveil',5),enemyIndex:0});assert.equal(a.currentId,'battle');
  vm.runInContext(fs.readFileSync(path.join(root,'battle-vfx.js'),'utf8'),w.context);
  const before=[team([0],['nullmie','komori']),team([0],['shizuku','hibana'])],after=copy(before);after[1].monsters[0].hp=0;
  const battle={seed:450,round:1,turn:1,winner:0,teams:after,events:[{kind:'turn',text:'ターン',visual:{teams:before}},{kind:'damage',text:'命中',side:0,visual:{teams:after}},{kind:'result',text:'勝利',visual:{teams:after}}]};
  w.context.LT.onlineActive=true;w.context.LT.onlineBattle=battle;w.context.LT.onlineBattleResult='won';
  ui.updateScene();assert.equal(a.currentId,'rival','raw winner cannot interrupt online battle music');
  now+=w.context.LT.BattleVFX.onlinePlan(battle).total+1;ui.updateScene();assert.equal(a.currentId,'victory');
  w.context.LT.onlineActive=false;ui.battleView=null;e.battle=null;ui.updateScene();assert.equal(a.currentId,'village');
});

test('the retired Void recording is absent from game resources while its production record is archival',()=>{
  const linked=[...html.matchAll(/(?:href|src)=["']([^"']+)["']/g)].map(m=>m[1]);
  assert(!linked.some(url=>url.includes('void-enthusiast')),'no dedicated offline prefetch or audio resource');
  assert(!html.includes('Enthusiast 2026'),'no current dedicated-song title or credits');
  const info=JSON.parse(fs.readFileSync(path.join(root,'docs/void-theme-v40.json'),'utf8'));
  assert.equal(info.status,'archived');assert.equal(info.playback.enabled,false);assert.equal(info.playback.recordingDistributed,false);
  assert(!fs.existsSync(path.join(root,info.recording.path)),'retired MP3 is not shipped');
});
