#!/usr/bin/env node
'use strict';
// Exercise the real music engine with media promises completed out of order.
// The supplied field/battle MP3s stay compressed; only bounded synth buffers may
// be allocated, while playback, ducking, scene ownership and mute remain shared.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const source=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].find(m=>m[1].includes('class LuminaAudio'))[1];
const URL_BATTLE='assets/music/battle-custom.mp3?v=20261119-battle-v52';
const URL_FIELD='assets/music/field-custom.mp3?v=20261119-field-v52';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
class Param{
 constructor(value=0){this.value=value;this.events=[];}
 setValueAtTime(v,t){this.value=v;this.events.push(['set',v,t]);}linearRampToValueAtTime(v,t){this.value=v;this.events.push(['ramp',v,t]);}
 setTargetAtTime(v,t){this.value=v;this.events.push(['target',v,t]);}exponentialRampToValueAtTime(v,t){this.value=v;this.events.push(['exp',v,t]);}cancelScheduledValues(){}
}
class Node{
 constructor(kind){this.kind=kind;this.outputs=[];for(const key of ['gain','frequency','Q','detune','pan','delayTime','threshold','knee','ratio','attack','release'])this[key]=new Param(1);}
 connect(node){this.outputs.push(node);return node;}disconnect(){this.outputs=[];}start(){}stop(){}setPeriodicWave(){}
}
function world({deferFetch=false}={}){
 const log={fetches:[],requests:[],audios:[],sources:[],revoked:[],buffers:[],trace:[]},plays=[],timers=new Map();let tid=0,blob=0,notes=0;
 class Context{
  constructor(){this.state='running';this.currentTime=0;this.sampleRate=4000;this.destination=new Node('destination');}
  resume(){log.trace.push('resume');this.state='running';return Promise.resolve();}suspend(){this.state='suspended';return Promise.resolve();}close(){this.state='closed';return Promise.resolve();}
  createGain(){return new Node('gain');}createOscillator(){return new Node('oscillator');}createBiquadFilter(){return new Node('filter');}createStereoPanner(){return new Node('pan');}
  createDynamicsCompressor(){return new Node('compressor');}createConvolver(){return new Node('convolver');}createDelay(){return new Node('delay');}createBufferSource(){return new Node('buffer');}createWaveShaper(){return new Node('shaper');}createPeriodicWave(){return {};}
  decodeAudioData(){assert.fail('A full recording must never be PCM-decoded by the game');}
  createBuffer(channels,length,rate){assert(length/rate<2,'Only short synth/noise/reverb buffers may be allocated');log.buffers.push({channels,length,rate});const data=Array.from({length:channels},()=>new Float32Array(length));return {getChannelData:i=>data[i],length,sampleRate:rate};}
  createMediaElementSource(audio){const node=new Node('media');node.audio=audio;log.sources.push(node);return node;}
 }
 class Audio{
  constructor(){this.paused=true;this.currentTime=0;this.attrs={};this.listeners={};this.plays=0;log.audios.push(this);}
  setAttribute(k,v){this.attrs[k]=v;}removeAttribute(k){delete this[k];}addEventListener(k,fn){this.listeners[k]=fn;}
  play(){this.plays++;log.trace.push('play');const behavior=plays.shift();if(behavior?.throw)throw behavior.throw;if(behavior instanceof Error)return Promise.reject(behavior);this.paused=false;return Promise.resolve(behavior?.promise).then(()=>{this.paused=false;});}
  pause(){this.paused=true;log.trace.push('pause');}fail(){this.listeners.error?.();}
 }
 const context=vm.createContext({console,LT:{DATA:{maps:{east:{continent:2},village:{theme:'town'},tower:{theme:'tower'}},legendary:{species:'arvelion'},champion2:{id:'zenith-boss'}}},AudioContext:Context,Audio,navigator:{},matchMedia:()=>({matches:false}),document:{hidden:false,dispatchEvent(){}},CustomEvent:class{},
  setTimeout(fn,delay){const id=++tid;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},
  URL:{createObjectURL:()=>`blob:battle-test-${++blob}`,revokeObjectURL:url=>log.revoked.push(url)},
  fetch(url){log.fetches.push(url);const task=deferred();log.requests.push(task);if(!deferFetch)task.resolve({ok:true,blob:async()=>({size:7063964})});return task.promise;}
 });
 vm.runInContext(source,context);const audio=new context.LT.Audio();audio.instrument=audio.drum=()=>{notes++;};
 return {audio,context,log,plays,notes:()=>notes,flush(){const tasks=[...timers.values()];timers.clear();for(const task of tasks)task.fn();},
  ready(url=URL_BATTLE){const i=log.fetches.indexOf(url);assert(i>=0);log.requests[i].resolve({ok:true,blob:async()=>({size:7063964})});},
  fail(url=URL_BATTLE){const i=log.fetches.indexOf(url);assert(i>=0);log.requests[i].reject(Error('Offline'));}};
}
const solo=(extra={},map='village')=>({map,party:[{species:'komori',hp:50}],battle:{enemy:{species:'shizuku',hp:50},...extra}});
function gameData(){
 const context=vm.createContext({console});
 for(const [,attributes,code]of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(attributes))continue;
  vm.runInContext(code,context);if(context.LT?.Engine)break;
 }
 return context.LT.DATA;
}

test('the supplied file retains the full 374.904-second 48 kHz stereo MP3',()=>{
 const mp3=fs.readFileSync(path.join(root,'assets/music/battle-custom.mp3'));assert(mp3.length>6e6&&mp3.length<8e6);
 let at=0;while(at<mp3.length-4&&!(mp3[at]===255&&(mp3[at+1]&224)===224))at++;
 const header=mp3.readUInt32BE(at);assert.equal((header>>19)&3,3);assert.equal((header>>17)&3,1);assert.equal((header>>10)&3,1);assert.notEqual((header>>6)&3,3);
 const tag=Math.max(mp3.indexOf('Xing',at),mp3.indexOf('Info',at));assert(tag>at&&tag<at+64);assert(mp3.readUInt32BE(tag+4)&1);
 assert(Math.abs(mp3.readUInt32BE(tag+8)*1152/48000-374.904)<.1);assert(!mp3.subarray(0,at).includes(Buffer.from('APIC')),'The embedded JPEG is excluded');
});

test('the field file is the exact supplied 139.632-second 48 kHz stereo MP3',()=>{
 const mp3=fs.readFileSync(path.join(root,'assets/music/field-custom.mp3'));
 assert.equal(mp3.length,3097438);
 assert.equal(crypto.createHash('sha256').update(mp3).digest('hex'),'2dde5f270bee0ac5553e270637f5da82caba25e0e7dd9327b25c7dfc198c7034');
 // Skip ID3, including the original cover image, before reading the MP3 header.
 assert.equal(mp3.toString('ascii',0,3),'ID3');let at=10;
 for(let i=6,size=0;i<10;i++){size=(size<<7)|(mp3[i]&127);if(i===9)at+=size;}
 while(at<mp3.length-4&&!(mp3[at]===255&&(mp3[at+1]&224)===224))at++;
 const header=mp3.readUInt32BE(at);assert.equal((header>>19)&3,3);assert.equal((header>>17)&3,1);assert.equal((header>>10)&3,1);assert.notEqual((header>>6)&3,3);
 const tag=Math.max(mp3.indexOf('Xing',at),mp3.indexOf('Info',at));assert(tag>at&&tag<at+64);assert(mp3.readUInt32BE(tag+4)&1);
 assert(Math.abs(mp3.readUInt32BE(tag+8)*1152/48000-139.632)<.1);
});

test('all battle variants use one looped recording without restarting when opponents or scenes change',async()=>{
 const w=world(),a=w.audio;a.setScene(solo());await a.setEnabled(true);await settle();const rec=a.group.recording,group=a.group;
 assert.equal(rec.id,'battle-custom');assert(rec.ready&&rec.audio.loop&&!rec.audio.paused);rec.audio.currentTime=127.25;const starts=rec.audio.plays;
 const cases=[['battle',solo()],['battle2',solo({},'east')],['rival',solo({rival:true})],['rival2',solo({rival:true},'east')],
  ['guardian',solo({guardian:'mio'})],['guardian2',solo({guardian:'mio'},'east')],['tower',solo({towerFloor:2})],['elite',solo({elite:'one'})],
  ['finale',solo({guardian:'mio'},'observatory')],['champion',solo({champion:true})],['legend',solo({enemy:{species:'arvelion',hp:1}})],
  ['zenith',solo({champion:'zenith-boss'})],['glitchbattle',solo({rival:'glitch-keeper'})]];
 for(const [id,scene]of cases){a.setScene(scene);assert.equal(a.currentId,id);assert.equal(a.group,group);assert.equal(a.group.recording,rec);assert.equal(rec.audio.currentTime,127.25);assert.equal(rec.audio.plays,starts);assert.equal(a.getCurrentTrack().recording.seconds,374.904);assert.equal(a.getCurrentTrack().id,'battle');}
 for(const transport of ['internet','local'])for(const mode of ['single','double']){
  a.setScene({theme:'meadow',battle:{rival:true,mode,transport,teams:[{active:[0],monsters:[{species:'nullmie',hp:1}]},{active:[0],monsters:[{species:'zeroveil',hp:1}]}]}});assert.equal(a.group.recording,rec);assert.equal(rec.audio.currentTime,127.25);
 }
 assert.deepEqual(w.log.fetches,[URL_BATTLE,URL_FIELD]);assert.equal(w.log.audios.length,2);assert.equal(w.log.sources.length,2);
 assert(w.audio.recordings.get('field-custom').audio.paused,'Preloaded field audio stays silent throughout battles');
});

test('recording uses the clean shared mix, master volume and effect ducking without song PCM buffers',async()=>{
 for(const scene of [solo(),{map:'village'}]){
 const w=world(),a=w.audio;a.setScene(scene);await a.setEnabled(true);await settle();const rec=a.group.recording;
 assert.equal(w.log.sources.find(node=>node.audio===rec.audio).outputs[0],rec.gain);assert.equal(rec.gain.outputs[0],a.recordedMusicBus);assert.equal(a.recordedMusicBus.outputs[0],a.mix);assert.notEqual(rec.gain.outputs[0],a.musicBus);
 assert.equal(rec.audio.attrs.playsinline,'');assert.match(rec.audio.src,/^blob:/);assert.equal(rec.gain.gain.value,.5);
 for(let i=0;i<20;i++){a.ctx.currentTime+=.1;a.tick();}assert.equal(w.notes(),0,'No composed score overlaps the recording');
 a.setVolume(.22);assert.equal(a.master.gain.value,.22*.72);a.duckMusic(2,.75,.4);
 assert(a.recordedMusicBus.gain.events.some(e=>e[0]==='ramp'&&e[1]===.4));assert.equal(a.master.gain.value,.22*.72);
 a.setVolume(0);assert.equal(a.master.gain.value,0);assert(w.log.buffers.every(b=>b.length/b.rate<2));
 }
});

test('battle results preserve event cues and restore field recording on loss, escape and tower exploration',async()=>{
 for(const [result,id]of [['won','victory'],['caught','resonance'],['lost','village'],['fled','village']]){
  const w=world(),a=w.audio;a.setScene(solo());await a.setEnabled(true);await settle();const rec=a.group.recording;rec.audio.currentTime=31;
  a.setScene(solo({result}));await settle();assert.equal(a.currentId,id);
  if(id==='village')assert.equal(a.group.recording.id,'field-custom');else assert(!a.group.recorded);
  w.flush();assert(rec.audio.paused);assert.equal(rec.audio.currentTime,0);
 }
 const w=world(),a=w.audio;a.setScene(solo({towerFloor:2}));await a.setEnabled(true);await settle();const rec=a.group.recording;
 a.setScene({map:'tower'});await settle();assert.equal(a.currentId,'tower');assert.equal(a.group.recording.id,'field-custom');assert.equal(a.recordingDefinition('tower').id,'field-custom');w.flush();assert(rec.audio.paused);
 a.setScene(solo());assert.equal(a.group.recording,rec);assert.equal(rec.audio.currentTime,0);
});

test('suspending resumes the same position, while OFF silences and retires every recording',async()=>{
 for(const scene of [solo(),{map:'village'}]){
 const w=world(),a=w.audio;a.setScene(scene);await a.setEnabled(true);await settle();const rec=a.group.recording;rec.audio.currentTime=118.5;
 await a.suspend();assert(rec.audio.paused);assert.equal(a.enabled,false);await a.setEnabled(true);await settle();assert(!rec.audio.paused);assert.equal(rec.audio.currentTime,118.5);
 await a.setEnabled(false);assert.equal(a.master.gain.value,0);assert.equal(a.group,null);w.flush();assert(rec.audio.paused);assert.equal(rec.audio.currentTime,0);
 assert(w.log.audios.every(media=>media.paused));a.dispose();assert.equal(w.log.revoked.length,2);assert.equal(a.recordings.size,0);
 }
});

test('late file loads and pending media starts cannot revive an exited battle or defeat a new owner',async()=>{
 const w=world({deferFetch:true}),a=w.audio;a.setScene(solo());await a.setEnabled(true);a.setScene({map:'village'});w.ready();await settle();
 const rec=a.recordings.get('battle-custom');assert(rec.ready&&rec.audio.paused);assert.equal(rec.audio.plays,0);
 const old=deferred();w.plays.push(old);a.setScene(solo());await settle();a.setScene(solo({result:'won'}));w.flush();assert(rec.audio.paused);
 old.resolve();await settle();assert(rec.audio.paused,'A stale successful play is immediately paused');
 const earlier=deferred();w.plays.push(earlier);a.setScene(solo());await settle();a.setScene({map:'village'});w.flush();a.setScene(solo());await settle();assert(!rec.audio.paused);
 earlier.resolve();await settle();assert(!rec.audio.paused,'An old promise cannot pause a newer active playback');
});

test('both recordings wait for gestures when blocked and prewarming keeps the other scene silent',async()=>{
 for(const [scene,otherScene,key,otherKey]of [[solo(),{map:'village'},'battle-custom','field-custom'],[{map:'village'},solo(),'field-custom','battle-custom']]){
 const w=world(),a=w.audio,denied=Object.assign(Error('Tap required'),{name:'NotAllowedError'});w.plays.push(denied);a.setScene(scene);await a.setEnabled(true);await settle();
 const rec=a.group.recording;assert(rec.blocked&&a.needsUnlock());const count=w.log.trace.length;a.primeRecording();const pending=a.setEnabled(true);
 assert(w.log.trace.slice(count).indexOf('play')<w.log.trace.slice(count).indexOf('resume'),'Media play occurs inside the gesture, before the context await');
 await pending;await settle();assert(rec.primed&&!rec.blocked&&!a.needsUnlock());
 const idle=world(),b=idle.audio;b.setScene(otherScene);await b.setEnabled(true);await settle();const prepared=b.recordings.get(key),active=b.recordings.get(otherKey);
 assert(prepared.ready&&prepared.audio.paused&&b.needsUnlock());b.primeRecording();await settle();assert(prepared.audio.paused);assert.equal(prepared.gain.gain.value,0);assert(prepared.primed&&!b.needsUnlock());
 assert(!active.audio.paused);b.setScene(scene);await settle();assert(!prepared.audio.paused);assert.equal(prepared.gain.gain.value,.5);idle.flush();assert(active.audio.paused);
 }
});

test('download, codec and media failures restore the appropriate composed score without retry loops',async()=>{
 const w=world({deferFetch:true}),a=w.audio;a.setScene(solo({champion:true}));await a.setEnabled(true);w.fail();await settle();
 assert.equal(a.currentId,'champion');assert(!a.group.recorded);assert(a.recordings.get('battle-custom').failed);
 for(let i=0;i<20;i++){a.ctx.currentTime+=.1;a.tick();a.setScene(solo({champion:true}));}assert(w.notes()>0);assert.deepEqual(w.log.fetches,[URL_BATTLE,URL_FIELD]);
 for(const synchronous of [false,true]){
  const f=world(),b=f.audio;b.setScene({map:'village'});await b.setEnabled(true);await settle();const error=Object.assign(Error('Unsupported audio'),{name:'NotSupportedError'});
  f.plays.push(synchronous?{throw:error}:error);b.setScene(solo({elite:'one'}));await settle();assert(!b.group.recorded);assert.equal(b.currentId,'elite');assert(b.recordings.get('battle-custom').failed);
 }
 const e=world(),b=e.audio;b.setScene(solo());await b.setEnabled(true);await settle();b.group.recording.audio.fail();assert(!b.group.recorded);assert.equal(b.currentId,'battle');
});

test('music room previews supplied field and battle recordings at entries 15 and 22 and retains other previews',async()=>{
 const w=world(),a=w.audio,tracks=a.getTracks();assert.equal(tracks.length,64);assert.equal(tracks[21].id,'battle');assert.equal(tracks[21].recording.seconds,374.904);assert.match(tracks[21].description,/原音/);
 assert.equal(tracks[14].id,'expedition');assert.equal(tracks[14].recording.seconds,139.632);assert.match(tracks[14].name,/正義の心我らに/);assert.match(tracks[14].description,/原音/);
 assert.equal(tracks[60].id,'glitchbattle');assert.equal(tracks[60].recording,undefined);a.setScene(solo({rival:'glitch-keeper'}));a.preview('glitchbattle');await a.setEnabled(true);await settle();assert(!a.group.recorded);
 a.preview('battle');await settle();assert(a.group.recorded);a.preview(null);assert.equal(a.currentId,'glitchbattle');assert(a.group.recorded);
 a.preview('expedition');await settle();assert.equal(a.group.recording.id,'field-custom');assert.equal(a.getCurrentTrack().recording.seconds,139.632);
 a.preview('village');await settle();assert(!a.group.recorded);assert.equal(a.getCurrentTrack().recording,undefined);
});

test('every shipped exterior map shares the field recording through travel and day/night changes',async()=>{
 const w=world(),a=w.audio,data=gameData();w.context.LT.DATA=data;
 const exteriors=Object.values(data.maps).filter(map=>!map.interior);assert.equal(exteriors.length,128);
 a.setScene({map:exteriors[0].id});await a.setEnabled(true);await settle();const rec=a.group.recording,group=a.group;
 assert.equal(rec.id,'field-custom');assert(rec.ready&&rec.audio.loop&&!rec.audio.paused);rec.audio.currentTime=73.25;const starts=rec.audio.plays;
 for(const map of exteriors)for(const night of [false,true]){
  a.setScene({map:map.id,night});assert.equal(a.group,group,`${map.id}, night=${night}`);assert.equal(a.group.recording,rec);
  assert.equal(rec.audio.currentTime,73.25);assert.equal(rec.audio.plays,starts);assert.equal(a.getCurrentTrack().recording.seconds,139.632);assert.equal(a.getCurrentTrack().id,'expedition');assert.equal(a.getCurrentTrack().scene,a.currentId);
 }
 assert.deepEqual(w.log.fetches,[URL_BATTLE,URL_FIELD]);assert.equal(w.log.audios.length,2);
});

test('interiors and event cues leave the field recording, while battle completion returns to it',async()=>{
 const w=world(),a=w.audio,data=gameData();w.context.LT.DATA=data;
 a.setScene({map:'village'});await a.setEnabled(true);await settle();const rec=a.group.recording;
 const interiors=Object.values(data.maps).filter(map=>map.interior);assert(interiors.length>0);
 const eventScenes=[{healing:true},{evolution:true},{ending:true},{trueEnding:true},{battle:{result:'won'}},{battle:{result:'caught'}}];
 for(const scene of [...interiors.map(map=>({map:map.id})),...eventScenes.map(event=>({map:'village',...event}))]){
  a.setScene(scene);await settle();assert(!a.group.recorded,JSON.stringify(scene));assert.equal(a.getCurrentTrack().recording,undefined);w.flush();assert(rec.audio.paused);
  a.setScene({map:'village'});await settle();assert.equal(a.group.recording,rec);assert(!rec.audio.paused);
 }
 rec.audio.currentTime=18;a.setScene(solo());await settle();const battle=a.group.recording;assert.equal(battle.id,'battle-custom');w.flush();assert(rec.audio.paused);
 a.setScene(solo({result:'won'}));w.flush();assert(battle.audio.paused);a.setScene({map:'village'});await settle();assert.equal(a.group.recording,rec);assert(!rec.audio.paused);
});

test('late field loads cannot overtake battle, and field failure falls back without harming battle',async()=>{
 const w=world({deferFetch:true}),a=w.audio;a.setScene({map:'village'});await a.setEnabled(true);a.setScene(solo());w.ready(URL_BATTLE);w.ready(URL_FIELD);await settle();
 const field=a.recordings.get('field-custom'),battle=a.recordings.get('battle-custom');assert(field.ready&&field.audio.paused);assert.equal(field.audio.plays,0);assert.equal(a.group.recording,battle);assert(!battle.audio.paused);
 const old=deferred();w.plays.push(old);a.setScene({map:'village'});await settle();a.setScene({map:'village',interior:true,roomKind:'shop'});w.flush();old.resolve();await settle();assert(field.audio.paused,'A retired field play cannot revive after entering a building');
 const f=world({deferFetch:true}),b=f.audio;b.setScene({map:'village'});await b.setEnabled(true);f.fail(URL_FIELD);f.ready(URL_BATTLE);await settle();assert.equal(b.currentId,'village');assert(!b.group.recorded);assert(b.recordings.get('field-custom').failed);
 for(let i=0;i<20;i++){b.ctx.currentTime+=.1;b.tick();b.setScene({map:'village'});}assert(f.notes()>0);assert.deepEqual(f.log.fetches,[URL_BATTLE,URL_FIELD]);
 b.setScene(solo());await settle();assert.equal(b.group.recording.id,'battle-custom');assert(!b.group.recording.audio.paused);
 const e=world(),c=e.audio;c.setScene({map:'village'});await c.setEnabled(true);await settle();c.group.recording.audio.fail();assert(!c.group.recorded);assert.equal(c.currentId,'village');
});
