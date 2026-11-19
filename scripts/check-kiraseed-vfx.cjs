#!/usr/bin/env node
'use strict';
// Production Kiraseed choreography: leaf blades, pollen, great roots and sunlit
// healing, including the real battle hooks and the existing mobile budgets.
// Optional: node scripts/check-kiraseed-vfx.cjs --qa /absolute/path/frames.png
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {runtime,canvas,imageStats}=require('./check-art.cjs');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),source=fs.readFileSync(path.join(root,'battle-vfx.js'),'utf8');
const model=vm.createContext({console});
for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;
  vm.runInContext(script[2],model);if(model.LT?.Engine)break;
}
const D=model.LT.DATA,copy=value=>JSON.parse(JSON.stringify(value));
const moves=[
  {id:'verdant_lance',kind:'damage',style:'seed',category:'physical',duration:1180,impactAt:.43,label:'Leaf blades'},
  {id:'forest_crown',kind:'attack',style:'petals',category:'status',duration:1100,impactAt:.45,label:'Poison pollen'},
  {id:'genesis_bloom',kind:'damage',style:'roots',category:'physical',duration:1400,impactAt:.48,label:'Great roots'},
  {id:'root_drain',kind:'heal',style:'healing',category:'status',duration:1200,impactAt:.43,label:'Sunlit healing'}
];
let systemReduced=false;
const context=vm.createContext({LT:{DATA:D},matchMedia:()=>({matches:systemReduced})});
vm.runInContext(source,context,{filename:'battle-vfx.js'});
const V=context.LT.BattleVFX;
function event(move,side='ally',slot=0,target=0){
  return V.fromEvent({kind:move.kind,move:move.id,side,slot,target,amount:move.kind==='attack'?0:move.kind==='heal'?86:48},null,100);
}
function draw(fx,age,w=768,h=440,options={}){
  const cv=canvas.createCanvas(w,h);assert.equal(V.render(cv.getContext('2d'),w,h,fx.started+fx.duration*age,fx,options),true);return cv;
}
function regionCount(cv,accept){
  const rgba=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let count=0,left=cv.width,right=-1,top=cv.height,bottom=-1;
  for(let i=0;i<rgba.length;i+=4){if(rgba[i+3]<100||!accept(rgba[i],rgba[i+1],rgba[i+2]))continue;
    const x=i/4%cv.width,y=Math.floor(i/4/cv.width);count++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  return {count,left,right,top,bottom};
}
assert.equal(V.effects.length,24);assert.equal(new Set(Object.values(D.moves).map(move=>V.classify(move))).size,24,'All existing families remain in use');
for(const move of moves){
  assert.equal(D.moves[move.id].category,move.category);assert.equal(V.classify(D.moves[move.id]),move.style);
  const fx=event(move);assert.equal(fx.style,move.style);assert.equal(fx.move,move.id);assert.equal(fx.category,move.category);
  assert.equal(fx.duration,move.duration);assert.equal(fx.releaseAt,.14);assert.equal(fx.impactAt,move.impactAt);
  const named=V.fromEvent({kind:move.kind,text:`相手の「${D.moves[move.id].name}」！`,side:'enemy'},null,100);
  assert.equal(named.move,move.id,'Solo narration resolves the same stable move ID');assert.equal(named.style,move.style);
  const miss=V.fromEvent({kind:'miss',move:move.id,side:'ally'},null,100);assert.equal(miss.style,'miss');assert.equal(miss.duration,720,'Misses retain their ordinary timing');
}
const bloom=V.fromEvent({kind:'status',status:'bloom',move:'forest_crown',side:1,slot:1},null,100);
assert.equal(bloom.style,'condition');assert.equal(bloom.condition,'bloom');assert.equal(bloom.move,'','The subsequent condition keeps its own motif and sound route');

const layouts=[
  {w:768,h:440,side:'ally',options:{}},{w:768,h:440,side:'enemy',options:{}},
  {w:320,h:220,side:'ally',options:{}},{w:320,h:220,side:'enemy',options:{}},
  {w:768,h:440,side:0,options:{online:true,side:1}},
  {w:360,h:260,side:1,slot:1,target:0,options:{online:true,double:true,side:1}},
  {w:360,h:260,side:0,slot:0,target:1,options:{online:true,double:true,side:1}}
];
let frames=0;const unique=new Set(),dataBefore=JSON.stringify(D);
for(const move of moves)for(const layout of layouts)for(const quality of ['high','low']){
  const fx=event(move,layout.side,layout.slot||0,layout.target||0),before=JSON.stringify(fx),anchors=V.anchors(layout.w,layout.h,fx,layout.options),hashes=[];
  if(move.kind==='heal')assert.deepEqual(anchors.target,anchors.source,'Sunlight stays on its caster, including the second double-battle slot');
  else assert.notDeepEqual(anchors.target,anchors.source,'The three offensive techniques use the chosen opponent');
  for(const age of [.22,.51,.77]){
    const options={...layout.options,quality},cv=draw(fx,age,layout.w,layout.h,options),first=imageStats(cv);
    assert(first.opaque>45,`${move.id} remains visible on ${layout.w}px ${quality}`);
    const again=draw(fx,age,layout.w,layout.h,options);assert.equal(imageStats(again).hash,first.hash,'The same frame is deterministic');hashes.push(first.hash);
    if(layout===layouts[0]&&quality==='high'&&age===.51)unique.add(first.hash);
    cv.width=cv.height=again.width=again.height=1;frames++;
  }
  assert.equal(new Set(hashes).size,3,'Release, impact and settling must be visibly different');
  assert.equal(JSON.stringify(fx),before,'Rendering cannot alter an effect event');
}
assert.equal(unique.size,4,'The four moves must look distinct');assert.equal(JSON.stringify(D),dataBefore,'Rendering cannot alter move definitions');
// Check the actual visible materials, rather than reproducing the motion paths.
{
  const leaves=draw(event(moves[0]),.37),green=regionCount(leaves,(r,g,b)=>g>r*1.06&&g>b*1.3);
  assert(green.count>200,'Flying blades retain visible green leaf material');leaves.width=leaves.height=1;
  const pollen=draw(event(moves[1]),.57),purple=regionCount(pollen,(r,g,b)=>b>g*1.08&&r>g*1.1),yellow=regionCount(pollen,(r,g,b)=>r>180&&g>145&&b<g*.85);
  assert(purple.count>35&&yellow.count>35,'Pollen combines flower petals with golden spore centres');pollen.width=pollen.height=1;
  const rootFx=event(moves[2]),early=draw(rootFx,.17),late=draw(rootFx,.56),bark=(r,g,b)=>r>60&&r<180&&g>55&&g<145&&r>g*1.06&&g>b*1.13;
  const earlyBark=regionCount(early,bark),lateBark=regionCount(late,bark);
  assert(lateBark.count>earlyBark.count+400,'Great roots grow a solid bark body from the ground');assert(lateBark.bottom-lateBark.top>100,'Roots visibly rise through the target');
  early.width=early.height=late.width=late.height=1;
  const healFx=event(moves[3]),sun=draw(healFx,.51),sunlight=regionCount(sun,(r,g,b)=>r>205&&g>180&&b<g*.87),caster=V.anchors(768,440,healFx).target;
  assert(sunlight.count>100&&sunlight.top<caster.y-70,'Healing has a sun and downward rays above the caster');sun.width=sun.height=1;
}
// Keep phase-edge coordinates finite, cache size bounded and mobile work small.
const probe=canvas.createCanvas(768,440),pc=probe.getContext('2d');let calls=0,largest=0;
const geometry=new Set(['moveTo','lineTo','quadraticCurveTo','bezierCurveTo','arc','ellipse','fillRect','strokeRect','translate','rotate','scale','createRadialGradient']);
const measured=new Proxy(pc,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{calls++;if(geometry.has(key))for(const n of args)if(typeof n==='number')assert(Number.isFinite(n),`${key} received a nonfinite coordinate`);return value.apply(target,args);};},set(target,key,value){return Reflect.set(target,key,value,target);}});
for(const move of moves)for(const [w,h]of [[64,40],[320,220],[768,440]])for(const age of [0,.001,.14,.43,.48,.999,1]){
  const fx=event(move,'enemy');calls=0;V.render(measured,w,h,fx.started+fx.duration*age,fx,{quality:'low'});largest=Math.max(largest,calls);
  assert(calls<2600,`${move.id} exceeds the established mobile draw budget`);assert.equal(pc.globalAlpha,1);assert.equal(pc.globalCompositeOperation,'source-over');
}
for(const move of moves){
  const fx=event(move);pc.clearRect(0,0,768,440);assert.equal(V.render(pc,768,440,fx.started+fx.duration*.5,fx,{reducedMotion:true}),false);assert.equal(imageStats(probe).opaque,0);
  systemReduced=true;assert.equal(V.render(pc,768,440,fx.started+fx.duration*.5,fx),false);systemReduced=false;
  assert.equal(V.render(pc,768,440,fx.started-1,fx),false);assert.equal(V.render(pc,768,440,fx.started+fx.duration+1,fx),false);
}
assert(V.artStatus().motifCache<=V.artStatus().motifCacheLimit);probe.width=probe.height=1;

// Link playback forwards slots and the cue to its renderer, sounds each move
// once, and gives guaranteed pollen and the following bloom separate beats.
{
  let drawn;const sounds=[],statuses=[],hook={DATA:D,Art:{battle(){}},PixelSprites:{duel(cv,state,side,time,options){drawn=options;}},
    playMoveSound(move,fx){sounds.push([move.id,fx.duration,fx.impactAt]);},playStatusSound:fx=>statuses.push(fx.condition)};
  vm.runInNewContext(source,{LT:hook,localStorage:{getItem:()=>JSON.stringify({quality:'low'})}});
  const cv=canvas.createCanvas(360,260),teams=[{active:[0,1],monsters:[{species:'shizuku',hp:100,maxHp:100},{species:'hibana',hp:100,maxHp:100}]},{active:[0,1],monsters:[{species:'komori',hp:100,maxHp:100},{species:'floravelle',hp:100,maxHp:100}]}];
  for(const [i,move]of moves.entries()){
    const state={seed:310+i,turn:1,mode:'double',teams,events:[{kind:move.kind,move:move.id,side:1,slot:1,target:0,amount:move.kind==='attack'?0:40,visual:{teams}}]};
    if(move.id==='forest_crown')state.events.push({kind:'status',status:'bloom',side:0,slot:0,move:move.id,visual:{teams}});
    const snapshot=JSON.stringify(state),start=10000+i*10000,plan=hook.BattleVFX.onlinePlan(state);
    hook.PixelSprites.duel(cv,state,1,start);hook.PixelSprites.duel(cv,state,1,start+move.duration*.51);
    assert.equal(drawn.effect.move,move.id);assert.equal(drawn.effect.slot,1);assert.equal(drawn.effect.target,0);assert.equal(drawn.double,true);assert.equal(drawn.side,1);
    if(move.id==='forest_crown'){
      hook.PixelSprites.duel(cv,state,1,start+plan.beats[1].start+100);assert.equal(drawn.effect.condition,'bloom');
      hook.PixelSprites.duel(cv,state,1,start+plan.beats[1].start+150);
    }
    assert.equal(JSON.stringify(state),snapshot,'Link drawing cannot mutate authoritative snapshots');
  }
  assert.deepEqual(sounds,moves.map(move=>[move.id,move.duration,move.impactAt]));assert.deepEqual(statuses,['bloom']);cv.width=cv.height=1;
}

async function realRenderer(qa){
  const {LT,engine}=await runtime();
  engine.state.party=[engine.makeMonster('floravelle',70)];assert(engine.startBattle('shizuku',70));
  await LT.CreatureArt.preload(['floravelle','shizuku'],{back:'both'});
  const baseBattle=LT.Art.battle;
  class LocalAccent extends canvas.Image{set src(value){super.src=path.resolve(root,value);}}
  const art=vm.createContext({LT,Image:LocalAccent,setTimeout,clearTimeout,performance});vm.runInContext(source,art,{filename:'battle-vfx.js'});
  assert.equal(await LT.BattleVFX.preload(),true,'QA uses the existing decoded material accent');
  const before=JSON.stringify({data:LT.DATA,state:engine.state,battle:engine.battle}),cv=canvas.createCanvas(768,440);
  let connected=0;
  for(const move of moves){
    const fx=LT.BattleVFX.fromEvent({kind:move.kind,move:move.id,side:'ally',amount:move.kind==='attack'?0:48},null,100),time=fx.started+fx.duration*.51;
    baseBattle(cv,engine,time,{effect:fx,hideLegacyEffect:true,quality:'high'});const plain=imageStats(cv).hash;
    LT.Art.battle(cv,engine,time,{effect:fx,quality:'high'});assert.notEqual(imageStats(cv).hash,plain,'The actual battle wrapper must paint '+move.id);connected++;
  }
  assert.equal(JSON.stringify({data:LT.DATA,state:engine.state,battle:engine.battle}),before);
  if(qa){
    const tileW=512,tileH=294,rowH=355,sheet=canvas.createCanvas(1576,1510),sc=sheet.getContext('2d');
    sc.fillStyle='#101c22';sc.fillRect(0,0,sheet.width,sheet.height);sc.fillStyle='#edf9d3';sc.font='bold 26px sans-serif';sc.fillText('Kiraseed — four production battle effects',20,38);
    sc.fillStyle='#b8cbac';sc.font='15px sans-serif';sc.fillText('Original game sprites and arena · release / impact / settling · existing pixel material atlas',20,65);
    for(const [row,move]of moves.entries()){
      const top=92+row*rowH;sc.fillStyle='#edf9d3';sc.font='bold 18px sans-serif';sc.fillText(`${row+1}. ${move.label}  /  ${move.id}`,20,top);
      const ages=[move.id==='genesis_bloom'?.2:move.id==='root_drain'?.22:.3,.48,.74];
      for(const [column,age]of ages.entries()){
        const fx=LT.BattleVFX.fromEvent({kind:move.kind,move:move.id,side:'ally',amount:move.kind==='attack'?0:48},null,100),time=fx.started+fx.duration*age;
        LT.Art.battle(cv,engine,time,{effect:fx,quality:'high'});const x=12+column*524;sc.imageSmoothingEnabled=false;sc.drawImage(cv,x,top+12,tileW,tileH);
        sc.fillStyle='#b8cbac';sc.font='14px sans-serif';sc.fillText(`${Math.round(move.duration*age)} ms`,x+8,top+328);
      }
    }
    fs.mkdirSync(path.dirname(qa),{recursive:true});fs.writeFileSync(qa,sheet.toBuffer('image/png'));sheet.width=sheet.height=1;
  }
  cv.width=cv.height=1;return connected;
}
const qaAt=process.argv.indexOf('--qa'),qa=qaAt>=0?path.resolve(process.argv[qaAt+1]||'kiraseed-vfx-qa.png'):undefined;
realRenderer(qa).then(connected=>console.log(JSON.stringify({ok:true,moves:4,families:24,frames,actualBattleHooks:connected,largestLowQualityCalls:largest,soloAndDoubles:true,deterministic:true,reducedMotion:true,gameplayUnchanged:true,...(qa?{qa}:{})}))).catch(error=>{console.error(error);process.exitCode=1;});
