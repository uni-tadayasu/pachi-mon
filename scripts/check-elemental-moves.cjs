#!/usr/bin/env node
'use strict';
// Reclassifying existing moves must not rewrite combat strength, saved PP,
// four-slot teams, exchange IDs, playback timing or the audio output route.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test');
const {canvas,imageStats}=require('./check-art.cjs');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const start='/* Pachi Monsters — twelve existing techniques find their thunder, ice and earth types. */';
const end='/* Pachi Monsters — one shared type chart for adventure and link battles. */';
const overlay=html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
assert(overlay.startsWith(start)&&overlay.includes('Object.assign(D.moves[id],change)'), 'Find the independent move overlay');
const expected={
  thunder:['atlas_wind_1','storm','atlas_wind_8','atlas_wind_7'],
  ice:['frost','atlas_crystal_1','atlas_tide_8','atlas_crystal_7'],
  earth:['sirocco','atlas_crystal_12','atlas_crystal_5','atlas_leaf_7']
};
const ids=Object.values(expected).flat(),copy=value=>JSON.parse(JSON.stringify(value));
function game(updated=true){
  const c=vm.createContext({console,OffscreenCanvas:function(width,height){return canvas.createCanvas(width,height);}});
  for(const m of scripts){
    if(/\bsrc=|application\/ld\+json/.test(m[1]))continue;
    vm.runInContext(updated?m[2]:m[2].replace(overlay,''),c);
    if(c.LT?.Engine)break;
  }
  return c;
}
const context=game(),baseline=game(false),{LT}=context,{DATA:D}=LT;
const vfxSource=fs.readFileSync(path.join(root,'battle-vfx.js'),'utf8');
vm.runInContext(fs.readFileSync(path.join(root,'scene-pixels.js'),'utf8'),context);
vm.runInContext(vfxSource,context);
const V=LT.BattleVFX,old=baseline.LT.DATA;
const audioSource=scripts.find(m=>m[2].includes('class LuminaAudio'))[2];

test('twelve moves retain every gameplay field and every owned, legacy and hidden moveset',()=>{
  assert.equal(Object.keys(D.moves).length,104);
  assert.equal(Object.values(D.moves).filter(m=>!m.hiddenDex).length,96);
  assert.deepEqual(copy(D.moveRoster.reclassified),ids);
  assert.deepEqual(Object.keys(D.moves),Object.keys(old.moves));
  for(const [id,move] of Object.entries(D.moves)){
    const current=copy(move),previous=copy(old.moves[id]);
    if(ids.includes(id))for(const key of ['element','name','description']){delete current[key];delete previous[key];}
    assert.deepEqual(current,previous,`${id}: only the approved label, description and type may change`);
  }
  for(const [id,species] of Object.entries(D.species)){
    assert.deepEqual(copy(species.moves),copy(old.species[id].moves),`${id}: retain all four move IDs and their order`);
    assert.equal(species.moves.length,4);assert.equal(new Set(species.moves).size,4);
  }
  assert.deepEqual(copy(D.legacyMovesets),copy(old.legacyMovesets));
  assert.deepEqual(copy(D.nullLegacyMovesets),copy(old.nullLegacyMovesets));
  assert.deepEqual(copy(D.hiddenMoves),copy(old.hiddenMoves));
  const currentEngine=new LT.Engine(),oldEngine=new baseline.LT.Engine();
  for(const [element,moves] of Object.entries(expected)){
    assert.equal(moves.length,4);
    assert(moves.some(id=>D.moves[id].category==='physical')&&moves.some(id=>D.moves[id].category==='special'));
    assert.equal(D.statusByElement[element],undefined,'Reclassification does not inherit an unrelated condition');
    for(const id of moves){
      const move=D.moves[id];assert.equal(move.element,element);
      assert.equal(currentEngine.maxPP(move),oldEngine.maxPP(old.moves[id]),id+' keeps its PP limit');
      assert(!/花毒|水封|灯焼け|目眩|結晶化/.test(move.description),id+' does not promise the old elemental condition');
    }
  }
  assert.equal(D.elements.earth.name,'土');
});

test('new palettes and choreography preserve the 24 families, IDs, targets and cue times',()=>{
  assert.equal(V.effects.length,24);assert.equal(new Set(Object.values(D.moves).map(m=>V.classify(m))).size,24);
  assert.equal(new Set(Object.keys(expected).map(type=>JSON.stringify(V.palettes[type]))).size,3);
  for(const id of ids){
    const move=D.moves[id],style=move.element==='thunder'?'lightning':move.element==='ice'?'ice':move.category==='physical'?'impact':'crystals';
    for(const event of [{kind:'damage',moveId:id,side:'enemy',amount:38},
      {kind:'damage',text:`相手の「${move.name}」！`,side:'enemy',amount:38},
      {kind:'damage',move:id,side:1,slot:1,target:0,amount:38,effectiveness:2.25}]){
      const effect=V.fromEvent(event,null,100);
      assert.equal(effect.style,style);assert.equal(effect.move,id);assert.equal(effect.element,move.element);
      assert.equal(effect.releaseAt,.14);assert.equal(effect.impactAt,.43);
      assert.equal(effect.duration,move.power>=40?1180:940);
      assert.equal(effect.side,event.side);assert.equal(effect.slot,event.slot||0);assert.equal(effect.target,event.target||0);
      assert.equal(effect.effectiveness,event.effectiveness);
      const miss=V.fromEvent({...event,kind:'miss'},null,100);assert.equal(miss.style,'miss');assert.equal(miss.duration,720);
    }
  }
});

function clear(ctx,width,height){ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,width,height);ctx.restore();}
test('real canvases render all 12 moves deterministically at both qualities without changing state',()=>{
  const before=JSON.stringify(D),hashes=new Set(),views=[{width:768,height:440,options:{}},{width:963,height:517,options:{online:true,double:true,side:1}}];
  const sheet=canvas.createCanvas(384*4,244*3),sc=sheet.getContext('2d');sc.fillStyle='#182432';sc.fillRect(0,0,sheet.width,sheet.height);
  for(const [index,id] of ids.entries())for(const quality of ['high','low'])for(const view of views){
    const cv=canvas.createCanvas(view.width,view.height),ctx=cv.getContext('2d');
    const event=V.fromEvent({kind:'damage',move:id,side:view.options.online?1:'ally',slot:1,target:0,amount:38},null,100);
    ctx.translate(7,11);ctx.scale(.9,1.1);ctx.globalAlpha=.63;ctx.globalCompositeOperation='source-over';ctx.imageSmoothingEnabled=true;
    const state={matrix:[...ctx.getTransform().toFloat64Array()],alpha:ctx.globalAlpha,blend:ctx.globalCompositeOperation,smooth:ctx.imageSmoothingEnabled};
    for(const phase of [.2,.54,.81]){
      clear(ctx,cv.width,cv.height);
      assert(V.render(ctx,cv.width,cv.height,100+event.duration*phase,event,{...view.options,quality}));
      const first=imageStats(cv);assert(first.opaque>30,`${id}/${quality}/${phase} is visible`);
      assert.deepEqual([...ctx.getTransform().toFloat64Array()],state.matrix);assert.equal(ctx.globalAlpha,state.alpha);
      assert.equal(ctx.globalCompositeOperation,state.blend);assert.equal(ctx.imageSmoothingEnabled,state.smooth);
      clear(ctx,cv.width,cv.height);V.render(ctx,cv.width,cv.height,100+event.duration*phase,event,{...view.options,quality});
      assert.equal(imageStats(cv).hash,first.hash,`${id}: deterministic animation`);
      if(quality==='high'&&!view.options.online&&phase===.54){
        hashes.add(first.hash);const x=index%4*384,y=Math.floor(index/4)*244;
        sc.imageSmoothingEnabled=false;sc.drawImage(cv,x,y+24,384,220);
        sc.fillStyle='#f3f6eb';sc.font='bold 13px sans-serif';sc.fillText(`${D.elements[D.moves[id].element].name} · ${D.moves[id].name}`,x+12,y+17);
      }
    }
    clear(ctx,cv.width,cv.height);
    assert.equal(V.render(ctx,cv.width,cv.height,100+event.duration*.5,event,{...view.options,quality,reducedMotion:true}),false);
    assert.equal(imageStats(cv).opaque,0);
    assert.equal(V.render(ctx,cv.width,cv.height,100+event.duration+1,event,{...view.options,quality}),false);
  }
  assert.equal(hashes.size,12,'All approved techniques have distinct rendered frames');
  assert.equal(JSON.stringify(D),before,'Rendering never changes gameplay data');
  const output=process.argv.find(arg=>arg.startsWith('--out='))?.slice(6);
  if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,sheet.toBuffer('image/png'));}
});

test('soil effects also render with no helper, image decoder or canvas factory',()=>{
  const c=vm.createContext({LT:{DATA:D}});vm.runInContext(vfxSource,c);
  for(const id of ids){
    const calls=[],gradient={addColorStop(){}};
    const target={canvas:null,globalAlpha:1,createRadialGradient:()=>gradient};
    const ctx=new Proxy(target,{get(object,key){if(key in object)return object[key];return(...args)=>calls.push([key,...args]);}});
    const effect=c.LT.BattleVFX.fromEvent({kind:'damage',move:id,side:'ally',amount:38},null,100);
    assert(c.LT.BattleVFX.render(ctx,768,440,100+effect.duration*.55,effect,{quality:'low'}));
    assert(calls.some(([name])=>name==='fill'||name==='stroke'||name==='fillRect'),id+' has a procedural fallback');
    assert(!calls.some(([name])=>name==='drawImage'),id+' does not require a canvas-backed material');
    assert.equal(calls.filter(([name])=>name==='save').length,calls.filter(([name])=>name==='restore').length,id+' balances context state');
  }
});

function audioSpy(quality='high'){
  const c=vm.createContext({navigator:{},matchMedia:()=>({matches:quality==='low'})});vm.runInContext(audioSource,c);
  const audio=new c.LT.Audio(),calls=[],impacts=[],ducks=[];
  audio.ctx={currentTime:10,state:'running'};audio.enabled=true;audio.setQuality(quality);audio.prune=()=>{};
  audio.duckMusic=(...args)=>ducks.push(args);audio.damageImpact=(...args)=>impacts.push(args);
  for(const method of ['instrument','drum','sweep','texture'])audio[method]=(...args)=>calls.push({method,args});
  return{audio,calls,impacts,ducks};
}
test('thunder, ice and soil have distinct bounded sounds with one hit cue and existing mute controls',()=>{
  const signatures=new Set();
  for(const [element,moves] of Object.entries(expected)){
    const probe={...D.moves[moves[0]],id:'same-fingerprint',category:'special',power:34};
    const high=audioSpy(),low=audioSpy('low');
    for(const harness of [high,low]){
      harness.audio.move(probe,{kind:'damage',amount:38,effectiveness:1.5,side:'ally'},{duration:940,releaseAt:.14,impactAt:.43});
      assert.equal(harness.impacts.length,1);assert.equal(harness.ducks.length,1);
      assert(Math.abs(harness.impacts[0][1]-(10.008+.94*.43))<1e-9);
      assert(harness.calls.length<=9,'Element ornaments keep a bounded voice request count');
    }
    signatures.add(JSON.stringify(high.calls));assert(low.calls.length<high.calls.length,element+' reduces ornaments on low quality');
    const instrument=element==='thunder'?'lead':element==='ice'?'celesta':'bass';
    assert(high.calls.some(call=>call.method==='instrument'&&call.args[1]===instrument),element+' keeps its own timbre');
    assert(!high.calls.some(call=>call.method==='instrument'&&call.args[1]==='bell'),'No new type falls into the old crystal sound');
    for(const id of moves){
      const h=audioSpy(),event={kind:'damage',amount:38,effectiveness:.7,side:'enemy'};
      h.audio.move(D.moves[id],event,{duration:180,impactAt:.43});h.audio.move(D.moves[id],event,{duration:180,impactAt:.43});
      assert.equal(h.impacts.length,1,id+' suppresses duplicate same-frame playback');
      assert(Math.abs(h.impacts[0][1]-(10.008+.18*.43))<1e-9,id+' honors a shortened timeline');
      const muted=audioSpy();muted.audio.enabled=false;muted.audio.move(D.moves[id],event);assert.equal(muted.calls.length,0);
      const suspended=audioSpy();suspended.audio.ctx.state='suspended';suspended.audio.move(D.moves[id],event);assert.equal(suspended.calls.length,0);
    }
  }
  assert.equal(signatures.size,3,'Shared note seeds still produce three different elemental sounds');
});

test('the stone leader renders its four techniques on desktop and phone without falling back to an unrelated element',()=>{
  const expectedStyles=['impact','impact','shield','healing'],before=JSON.stringify(D);
  assert.notDeepEqual(copy(V.palettes.stone),copy(V.palettes.earth),'Stone has a separate gray/gold palette');
  for(const [index,id]of D.offDexLeaders.moves.entries())for(const width of [390,960])for(const quality of ['low','high']){
    const move=D.moves[id],kind=move.kind==='attack'?'damage':move.kind;
    const effect=V.fromEvent({kind,move:id,side:width===390?'ally':1,slot:0,target:0,amount:38},null,100);
    assert(effect);assert.equal(effect.element,move.element);assert.equal(effect.style,expectedStyles[index]);assert.equal(effect.move,id);
    const cv=canvas.createCanvas(width,Math.round(width*.6)),ctx=cv.getContext('2d');
    for(const phase of [.25,.54,.8]){
      clear(ctx,cv.width,cv.height);assert(V.render(ctx,cv.width,cv.height,100+effect.duration*phase,effect,{quality,online:width===960}));
      const first=imageStats(cv);assert(first.opaque>25,`${id}/${width}/${quality}/${phase}: the effect is visible`);
      clear(ctx,cv.width,cv.height);V.render(ctx,cv.width,cv.height,100+effect.duration*phase,effect,{quality,online:width===960});
      assert.equal(imageStats(cv).hash,first.hash,'The same effect frame is deterministic');
    }
  }
  assert.equal(JSON.stringify(D),before,'Visual effects leave combat and saved data unchanged');
});

test('the new stone impact uses its own bounded dry sound and preserves the common hit cue and mute behavior',()=>{
  const move=D.moves.galdoras_crown,event={kind:'damage',amount:38,effectiveness:1.5,side:'ally'},timing={duration:1180,releaseAt:.14,impactAt:.43};
  const high=audioSpy(),low=audioSpy('low'),soil=audioSpy();
  high.audio.move(move,event,timing);low.audio.move(move,event,timing);soil.audio.move({...move,element:'earth'},event,timing);
  assert.equal(high.impacts.length,1);assert.equal(low.impacts.length,1);assert.equal(high.ducks.length,1);
  assert(Math.abs(high.impacts[0][1]-(10.008+1.18*.43))<1e-9,'The stone hit aligns with its visual contact');
  assert(high.calls.length<=10);assert(low.calls.length<high.calls.length);
  assert(high.calls.some(call=>call.method==='instrument'&&call.args[1]==='mallet'));
  assert(!high.calls.some(call=>call.method==='instrument'&&call.args[1]==='bell'));
  assert.notEqual(JSON.stringify(high.calls),JSON.stringify(soil.calls),'Stone does not sound like the earth type');
  for(const state of ['muted','suspended']){const h=audioSpy();if(state==='muted')h.audio.enabled=false;else h.audio.ctx.state='suspended';h.audio.move(move,event,timing);assert.equal(h.calls.length,0);assert.equal(h.impacts.length,0);}
});
