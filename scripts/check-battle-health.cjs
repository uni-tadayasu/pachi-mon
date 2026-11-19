#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8'),source=fs.readFileSync(path.join(root,'battle-health.js'),'utf8');
const model=vm.createContext({console});for(const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(/\bsrc=|application\/ld\+json/.test(script[1]))continue;vm.runInContext(script[2],model);if(model.LT?.Engine)break;}
const {Engine,DATA:D}=model.LT,copy=value=>JSON.parse(JSON.stringify(value));
let passed=0;async function test(name,run){await run();passed++;console.log('PASS '+name);}
function clock(){
 let now=0,next=0;const jobs=new Map();
 const add=(fn,delay,frame=false)=>{const id=++next;jobs.set(id,{at:now+Math.max(0,Number(delay)||0),fn,frame});return id;};
 return {get now(){return now;},get pending(){return jobs.size;},get nextTime(){return Math.min(...[...jobs.values()].map(job=>job.at));},
  requestAnimationFrame:fn=>add(fn,16,true),cancelAnimationFrame:id=>jobs.delete(id),setTimeout:(fn,delay)=>add(fn,delay),clearTimeout:id=>jobs.delete(id),
  tick(ms){const end=now+ms;let iterations=0;for(;;){let found=null;for(const [id,job]of jobs)if(job.at<=end&&(!found||job.at<found[1].at))found=[id,job];if(!found)break;assert(++iterations<100000,'Clock must not spin');jobs.delete(found[0]);now=found[1].at;found[1].fn(found[1].frame?now:undefined);}now=end;},
  async until(promise,max=30000){let done=false,error;promise.then(()=>{done=true;},value=>{done=true;error=value;});const end=now+max;for(let n=0;n<10000&&!done;n++){await Promise.resolve();await Promise.resolve();if(done)break;const when=this.nextTime;assert(Number.isFinite(when)&&when<=end,'Playback must finish on a bounded scheduled timer');this.tick(Math.max(0,when-now));}await Promise.resolve();assert(done,'Playback completes');if(error)throw error;}
 };
}
function element(){
 const classes=new Set();return {style:{setProperty(key,value){this[key]=value;}},dataset:{},textContent:'',innerHTML:'',title:'',hidden:false,children:[],parentElement:{title:''},
  classList:{add:(...values)=>values.forEach(value=>classes.add(value)),remove:(...values)=>values.forEach(value=>classes.delete(value)),toggle(value,on){if(on===undefined)on=!classes.has(value);if(on)classes.add(value);else classes.delete(value);return on;},contains:value=>classes.has(value)},
  appendChild(child){this.children.push(child);return child;},replaceChildren(...children){this.children=children;},querySelectorAll:()=>[],setAttribute(key,value){this[key]=value;}
 };
}
function runtime(options={}){
 const time=clock(),c=vm.createContext({LT:{...model.LT},systemReduced:false,performance:{now:()=>time.now},matchMedia:()=>({matches:c.systemReduced}),
  requestAnimationFrame:time.requestAnimationFrame,cancelAnimationFrame:time.cancelAnimationFrame,setTimeout:time.setTimeout,clearTimeout:time.clearTimeout,...options});
 vm.runInContext(source,c,{filename:'battle-health.js'});return {c,time,H:c.LT.BattleHealth};
}
const width=fill=>Number.parseFloat(fill.style.width),counter=label=>Number(label.textContent.split('/')[0]);
function section(from,to){const start=html.indexOf(from),end=html.indexOf(to,start);assert(start>0&&end>start,from);return html.slice(start,end);}
function solo(){
 const e=new Engine();assert(e.newGame('komori').ok);e.state.party[0].level=50;e.restoreMonster(e.state.party[0]);e.state.party.push(e.makeMonster('shizuku',50));e.markCaught('shizuku');assert(e.startBattle('kirari',50));
 const nodes=new Map(),{c,time,H}=runtime({engine:e,DATA:D,settings:{textSpeed:'normal',reducedMotion:false},busy:false,battleView:null,battleEffect:null,evolutionUntil:0,
  refitBattleText(){},battleActions(){},nameOf:model.LT.displayName,visibleConditions:()=>[],updateScene(){},saved:0,beats:[],
  save:()=>{c.saved++;},updateAll:()=>c.updateBattle(),sound:{fx(){},move(){}},
  document:{querySelector:selector=>selector==='.enemy-card .hp-label'?node('enemy-label'):null,createElement:()=>element()},$:id=>node(id)
 });
 function node(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);}
 const log=node('battle-log'),append=log.appendChild;log.appendChild=function(child){c.beats.push({at:time.now,ally:counter(node('ally-hp-text')),enemy:counter(node('enemy-hp-text'))});return append.call(this,child);};
 c.LT.BattleVFX={fromEvent:(event,move,started)=>['damage','heal','recoil','statusTick','faint','switch'].includes(event.kind)?{kind:event.kind,style:event.kind==='faint'?'faint':'impact',started,duration:200,impactAt:.5}:null};
 vm.runInContext(section('  const escape = s =>','  let engine = new Engine();'),c);
 vm.runInContext(section('  function typeBadge(','  const nameOf='),c);
 vm.runInContext(section('  function battleHealthOptions(','  function battleActions('),c);
 vm.runInContext(section('  function captureBattleView(','  async function doBattle('),c);
 c.battleView=c.captureBattleView();c.updateBattle();return {c,time,H,nodes,node};
}
const visual=(c,ally=c.battleView.state.party[c.battleView.battle.activeIndex],activeIndex=c.battleView.battle.activeIndex)=>({ally:copy(ally),activeIndex,enemy:copy(c.battleView.battle.enemy),enemyIndex:0});
function online(options={}){
 const settings={quality:'low',textSpeed:'normal',reducedMotion:false,...options},frames=[];
 const {c,time,H}=runtime({LT:{...model.LT,Art:{battle(){}},PixelSprites:{duel(canvas,shown,side,now){frames.push({shown:copy(shown),side,now});}}},localStorage:{getItem:()=>JSON.stringify(settings)}});
 vm.runInContext(fs.readFileSync(path.join(root,'battle-vfx.js'),'utf8'),c,{filename:'battle-vfx.js'});
 const canvas={width:320,height:220,getContext:()=>null};
 return {c,time,H,V:c.LT.BattleVFX,settings,frames,draw(state,now){c.LT.PixelSprites.duel(canvas,state,0,now);return frames.at(-1).shown;}};
}
function onlineFixture(mode='single'){
 const frame={teams:[0,1].map(side=>({active:mode==='double'?[0,1]:[0],monsters:[0,1,2].map(index=>({
  uid:`online-${side}-${index}`,species:index===2?'shizuku':'komori',level:50,hp:index===2?75:300,maxHp:300,
  stats:{def:1,spDef:400},pp:{nudge:2,pulse:8}
 }))}))},events=[{kind:'turn',text:'turn',visual:copy(frame)}];
 return {frame,events,push(event,change=()=>{}){change(frame);events.push({...event,visual:copy(frame)});},
  state:()=>({seed:'health-regression',round:1,turn:1,mode,winner:null,teams:copy(frame.teams),events})};
}
function onlineChange(H,V,event,before,after){
 const effect=V.fromEvent(event,null,0),move=D.moves[event.move||event.moveId];
 return {impact:effect?effect.duration*(effect.impactAt??.45):0,
  plan:H.plan({from:before.hp,to:after.hp,max:after.maxHp,def:after.stats.def,spDef:after.stats.spDef,kind:event.kind,category:event.category||move?.category})};
}
function approximately(actual,expected,message){assert(Math.abs(actual-expected)<1e-7,`${message}: ${actual} != ${expected}`);}

async function main(){
 await test('duration follows damage amount, maximum HP and the relevant defense without modifying HP',()=>{
  const {H}=runtime(),base={from:80,to:20,max:100,def:20,spDef:20,kind:'damage',category:'physical'},snapshot=copy(base);
  const ordinary=H.plan(base);assert.deepEqual(copy(base),snapshot);assert.equal(ordinary.from,80);assert.equal(ordinary.to,20);
  assert(H.plan({...base,def:300}).duration>ordinary.duration);assert.equal(H.plan({...base,spDef:300}).duration,ordinary.duration);
  const special=H.plan({...base,category:'special'});assert(H.plan({...base,category:'special',spDef:300}).duration>special.duration);assert.equal(H.plan({...base,category:'special',def:300}).duration,special.duration);
  assert.equal(H.plan({...base,category:undefined}).duration,ordinary.duration,'Unspecified damage category is physical');
  const lengths=[100,200,400,1000].map(max=>H.plan({...base,max}).duration);for(let i=1;i<lengths.length;i++)assert(lengths[i]>=lengths[i-1],'Larger max HP cannot shorten the same HP loss');
  assert(H.plan({...base,to:5}).duration>H.plan({...base,to:70}).duration);
  for(const kind of ['statusTick','recoil','heal']){
   const change=kind==='heal'?{from:20,to:80}:{};
   assert.equal(H.plan({...base,...change,kind,def:1,spDef:1}).duration,H.plan({...base,...change,kind,def:9999,spDef:9999}).duration,kind+' ignores defense');
  }
  assert(H.plan({...base,tempo:.5}).duration<ordinary.duration);assert(H.plan({...base,tempo:1.2}).duration>ordinary.duration);
  assert(H.plan({...base,from:99999,to:0,max:99999,def:99999}).duration<=2000,'Even large damage has a bounded visual duration');
 });

 await test('samples are continuous and bounded, counters reach their exact target without premature zero',()=>{
  const {H}=runtime();for(const [from,to]of [[100,0],[100,37],[0,100],[37,100]]){
   const plan=H.plan({from,to,max:100,kind:to>from?'heal':'damage'});assert(plan.duration>0);assert.equal(H.sample(plan,-1),from);assert.equal(H.sample(plan,0),from);assert.equal(H.sample(plan,plan.duration),to);assert.equal(H.sample(plan,plan.duration+500),to);
   let previous=from;for(let n=1;n<20;n++){const hp=H.sample(plan,plan.duration*n/20);assert(hp>=Math.min(from,to)&&hp<=Math.max(from,to));assert(to>from?hp>previous:hp<previous);previous=hp;const shown=H.displayed(plan,hp);assert(Number.isInteger(shown));assert(to>from?shown<=hp+1e-8:shown>=hp-1e-8);if(to===0)assert(shown>=1);}
   assert(H.displayed(plan,H.sample(plan,plan.duration))===to);
  }
  const quiet=H.plan({from:20,to:20,max:100});assert.equal(quiet.duration,0);assert.equal(H.sample(quiet,0),20);
  const clamped=H.plan({from:200,to:-1,max:100});assert.equal(clamped.from,100);assert.equal(clamped.to,0);
 });

 await test('RAF updates both the bar and integer label, preserves inputs and disables the old stepped CSS transition',()=>{
  const {H,time}=runtime(),fill=element(),label=element(),base={key:'one',hp:100,max:100,def:60,spDef:300};assert.equal(H.update(fill,label,base),0);assert.equal(width(fill),100);assert.equal(label.textContent,'100 / 100');
  const options={...base,hp:0,event:{kind:'damage',moveId:'futo_burst'}},before=copy(options),duration=H.update(fill,label,options);assert(duration>0);assert.deepEqual(copy(options),before);assert.equal(fill.style.transition,'none');
  time.tick(duration/2);assert(width(fill)>0&&width(fill)<100);assert(counter(label)>0&&counter(label)<100);assert.equal(counter(label),Math.ceil(width(fill)-1e-8));
  time.tick(duration);assert.equal(fill.style.width,'0%');assert.equal(label.textContent,'0 / 100');assert(fill.classList.contains('low'));assert.equal(time.pending,0);
  const heal=H.update(fill,label,{...base,hp:80,event:{kind:'heal'}});time.tick(heal/2);assert(width(fill)>0&&width(fill)<80);assert.equal(counter(label),Math.floor(width(fill)+1e-8));time.tick(heal);assert.equal(label.textContent,'80 / 100');assert(!fill.classList.contains('low'));
 });

 await test('repeated draws do not restart a drain, retargeting is continuous and replacement identities cannot inherit old HP',()=>{
  const {H,time}=runtime(),fill=element(),label=element(),base={key:'old',hp:100,max:100,def:100};H.update(fill,label,base);
  const first=H.update(fill,label,{...base,hp:20,event:{kind:'damage'}});time.tick(96);const shown=width(fill),remaining=H.update(fill,label,{...base,hp:20});assert(remaining<first);assert.equal(width(fill),shown);
  const next=H.update(fill,label,{...base,hp:0,event:{kind:'damage'}});assert.equal(width(fill),shown,'A second hit starts at the current displayed HP');time.tick(next+20);assert.equal(label.textContent,'0 / 100');
  H.update(fill,label,{...base,hp:100,event:{kind:'heal'}});time.tick(48);assert(width(fill)>0&&width(fill)<100);
  assert.equal(H.update(fill,label,{key:'replacement',hp:75,max:150,event:{kind:'switch'}}),0);assert.equal(width(fill),50);assert.equal(label.textContent,'75 / 150');time.tick(3000);assert.equal(label.textContent,'75 / 150');assert.equal(time.pending,0);
  assert.equal(H.update(fill,label,{key:'replacement',hp:200,max:200,event:{kind:'heal'}}),0,'A new maximum starts a fresh scale');assert.equal(label.textContent,'200 / 200');
 });

 await test('reduced motion, fast-forward and finish cancel pending frames and settle the exact HP',()=>{
  for(const mode of ['option','system','skip','finish']){
   const {H,time,c}=runtime(),fill=element(),label=element(),base={key:'one',hp:100,max:100};H.update(fill,label,base);H.update(fill,label,{...base,hp:0,event:{kind:'damage'}});time.tick(64);
   if(mode==='system')c.systemReduced=true;
   if(mode==='finish')H.finish(fill);else assert.equal(H.update(fill,label,{...base,hp:0,reducedMotion:mode==='option',fastForward:mode==='skip'}),0);
   assert.equal(label.textContent,'0 / 100');assert.equal(time.pending,0);time.tick(3000);assert.equal(width(fill),0);H.finish(fill);
  }
  const {H,c}=runtime();assert.equal(H.plan({from:100,to:0,max:100,reducedMotion:true}).duration,0);c.systemReduced=true;assert.equal(H.plan({from:100,to:0,max:100}).duration,0);c.systemReduced=false;
  assert(H.plan({from:100,to:0,max:100,fastForward:true}).duration<=100);
  const noFrames=runtime({requestAnimationFrame:undefined}),fill=element(),label=element();noFrames.H.update(fill,label,{key:'a',hp:100,max:100});assert.equal(noFrames.H.update(fill,label,{key:'a',hp:25,max:100,event:{kind:'damage'}}),0);assert.equal(label.textContent,'25 / 100');
 });

 await test('solo rendering uses event defense categories and updates snapshots without changing the game state',()=>{
  const {c,time,node}=solo(),before=copy({state:c.engine.state,battle:c.engine.battle}),old=c.battleView.state.party[0],after={...copy(old),hp:old.hp-80},event={kind:'damage',side:'enemy',moveId:'futo_burst'},frame=visual(c,after);
  for(const [side,mon]of [['ally',old],['enemy',c.battleView.battle.enemy]]){
   for(const type of model.LT.TypeSystem.of(mon))assert(node(side+'-type').innerHTML.includes(D.elements[type].name),'The real type helpers render the current species');
   const ability=model.LT.Abilities.get(mon);assert.equal(node(side+'-ability').dataset.ability,mon.species);assert(node(side+'-ability').textContent.includes(ability.name));assert.equal(node(side+'-ability').hidden,false);
  }
  const stats=c.engine.stats(after),expected=c.LT.BattleHealth.plan({from:old.hp,to:after.hp,max:stats.hp,def:stats.def,spDef:stats.spDef,kind:'damage',category:'special'}).duration;
  assert.equal(c.battleHealthDuration(frame,event),expected);c.applyBattleVisual(frame,event);assert.equal(c.battleView.state.party[0].hp,after.hp);assert.equal(counter(node('ally-hp-text')),old.hp);
  time.tick(expected/2);assert(counter(node('ally-hp-text'))<old.hp&&counter(node('ally-hp-text'))>after.hp);c.updateBattle();time.tick(expected);assert.equal(counter(node('ally-hp-text')),after.hp);
  assert.deepEqual(copy({state:c.engine.state,battle:c.engine.battle}),before);
  c.settings.reducedMotion=true;const healed=visual(c,{...after,hp:old.hp});assert.equal(c.battleHealthDuration(healed,{kind:'heal'}),0);c.applyBattleVisual(healed,{kind:'heal'});assert.equal(counter(node('ally-hp-text')),old.hp);
 });

 await test('solo ability recovery events animate actual engine healing and finish before the next message without changing saves',async()=>{
  for(const kind of ['regeneration','reserve']){
   const {c,time,node}=solo(),id=Object.keys(D.species).find(id=>model.LT.Abilities.get(id)?.kind===kind);assert(id,kind+' has a species');
   const mon=c.engine.makeMonster(id,50),max=c.engine.stats(mon).hp;mon.hp=Math.floor(max/4);c.engine.state.party[0]=mon;
   c.battleView=c.captureBattleView();c.updateBattle();const from=mon.hp,events=[];
   c.engine.endOfTurn(events);const event=events.find(event=>event.kind==='ability'&&event.side==='ally'&&event.amount>0);assert(event,'The real engine emits ability recovery');
   assert.equal(events.length,1,'No unrelated effects are required for this recovery');assert.equal(event.visual.ally.hp,from+event.amount);
   const to=mon.hp,duration=c.battleHealthDuration(event.visual,event);assert(duration>0,'Ability HP changes use the same smooth health plan');
   c.engine.event(events,'次の合図。','turn');const original=copy({state:c.engine.state,battle:c.engine.battle,events});
   const promise=c.playBattleEvents({events});assert.equal(counter(node('ally-hp-text')),from);time.tick(duration/2);
   assert(counter(node('ally-hp-text'))>from&&counter(node('ally-hp-text'))<to,'The counter rises through intermediate HP');assert.equal(c.beats.length,1);
   await time.until(promise);assert.equal(c.beats.length,2);assert(c.beats[1].at>=duration);assert.equal(c.beats[1].ally,to,'The next message sees the completed recovery');
   assert.equal(counter(node('ally-hp-text')),to);assert.equal(c.busy,false);assert.equal(time.pending,0);assert.equal(c.saved,1);
   assert.deepEqual(copy({state:c.engine.state,battle:c.engine.battle,events}),original,'Playback cannot apply the ability a second time or edit its snapshots');
  }
 });

 await test('solo event playback completes a fatal HP drain before fainting and resets the replacement identity',async()=>{
  const {c,time,node}=solo(),old=copy(c.battleView.state.party[0]),dead={...old,hp:0},next=copy(c.engine.state.party[1]),damage={kind:'damage',side:'enemy',moveId:'futo_burst',text:'hit',visual:visual(c,dead)};
  const duration=c.battleHealthDuration(damage.visual,damage),events=[damage,{kind:'faint',side:'ally',text:'faint',visual:visual(c,dead)},{kind:'switch',side:'ally',text:'switch',visual:visual(c,next,1)}];
  c.engine.state.party[0].hp=0;c.engine.battle.activeIndex=1;const before=copy({state:c.engine.state,battle:c.engine.battle,events});
  const promise=c.playBattleEvents({events});assert.equal(c.busy,true);time.tick(100+duration/2);
  assert(counter(node('ally-hp-text'))>0&&counter(node('ally-hp-text'))<old.hp);assert.equal(c.battleView.state.party[0].hp,old.hp,'The fatal sprite snapshot waits while only HP drains');assert.equal(c.beats.length,1,'The next event cannot begin before the HP reaches zero');
  await time.until(promise);assert.equal(c.beats.length,3);assert.equal(c.beats[1].ally,0,'Faint narration begins after the HP bar empties');assert(c.beats[1].at>=100+duration);assert.equal(c.beats[2].ally,next.hp,'Replacement starts at its own HP');
  assert.equal(counter(node('ally-hp-text')),next.hp);assert.equal(c.busy,false);assert.equal(c.battleView,null);assert.equal(c.saved,1);assert.equal(time.pending,0);
  assert.deepEqual(copy({state:c.engine.state,battle:c.engine.battle,events}),before,'Playback changes neither damage nor event snapshots');
 });

 await test('solo reduced-motion and in-progress skipping settle bars while aborted playback clears animation state',async()=>{
  for(const mode of ['reduced','skip','abort']){
   const {c,time,node}=solo(),old=c.battleView.state.party[0],after={...copy(old),hp:1},event={kind:'damage',side:'enemy',moveId:'futo_burst',text:'hit',visual:visual(c,after)};
   c.engine.state.party[0].hp=1;if(mode==='reduced')c.settings.reducedMotion=true;
   if(mode==='abort')c.sound.move=()=>{throw Error('Expected sound interruption');};
   const promise=c.playBattleEvents({events:[event]});
   if(mode==='abort'){await assert.rejects(promise,/Expected sound interruption/);assert.equal(c.busy,false);assert.equal(c.battleView,null);assert.equal(counter(node('ally-hp-text')),1);assert.equal(time.pending,0);continue;}
   if(mode==='reduced')assert.equal(counter(node('ally-hp-text')),1);
   else{time.tick(164);assert(counter(node('ally-hp-text'))>1);assert.equal(typeof c.skipBattlePlayback,'function');c.skipBattlePlayback();assert.equal(counter(node('ally-hp-text')),1);}
   await time.until(promise);assert.equal(counter(node('ally-hp-text')),1);assert.equal(time.pending,0);assert.equal(c.busy,false);assert.equal(c.engine.state.party[0].hp,1);
  }
 });

 await test('online single and double battles interpolate damage, curse ticks and healing while waiting for the longest HP change',()=>{
  for(const mode of ['single','double']){
   const {H,V}=online(),fixture=onlineFixture(mode),slot=mode==='double'?1:0,start=100;
   fixture.push({kind:'damage',move:'futo_burst',side:0,slot:0,target:slot,text:'hit'},frame=>{frame.teams[1].monsters[slot].hp=180;});
   fixture.push({kind:'statusTick',status:'curse',side:1,slot,amount:75,text:'curse'},frame=>{frame.teams[1].monsters[slot].hp=105;});
   fixture.push({kind:'heal',side:1,slot,amount:115,text:'heal'},frame=>{frame.teams[1].monsters[slot].hp=220;});
   const state=fixture.state(),original=copy(state),timeline=V.onlinePlan(state);assert(V.onlineBusy(state,start));
   for(let index=1;index<state.events.length;index++){
    const event=state.events[index],before=state.events[index-1].visual.teams[1].monsters[slot],after=event.visual.teams[1].monsters[slot],{impact,plan}=onlineChange(H,V,event,before,after),beat=timeline.beats[index];
    assert(beat.until>=beat.start+impact+plan.duration,'The message beat cannot finish while HP is moving');
    if(index+1<state.events.length)assert(timeline.beats[index+1].start>=beat.start+impact+plan.duration);
    const early=V.onlineView(state,start+beat.start+impact-.01).teams[1].monsters[slot];assert.equal(early.hp,before.hp,'HP waits for the impact');
    const elapsed=plan.duration*.371,shown=V.onlineView(state,start+beat.start+impact+elapsed),mon=shown.teams[1].monsters[slot];
    approximately(mon.hp,H.sample(plan,elapsed),'The view uses the correct damage category and HP plan');assert(!Number.isInteger(mon.hp),'The bar can show a fractional HP position');
    assert.equal(mon.displayHp,H.displayed(plan,mon.hp));assert(Number.isInteger(mon.displayHp));assert.equal(shown.teams[0].monsters[0].hp,300);
    if(mode==='double')assert.equal(shown.teams[1].monsters[0].hp,300,'Only the selected double-battle slot drains');
    const doneAt=start+beat.start+impact+plan.duration+1;
    assert.equal(V.onlineView(state,doneAt).teams[1].monsters[slot].hp,after.hp);assert(V.onlineBusy(state,doneAt),'The settle pause still locks battle commands');
   }
   assert(V.onlineBusy(state,start+timeline.total-1));assert.equal(V.onlineBusy(state,start+timeline.total),false);
   assert.equal(V.onlineView(state,start+timeline.total).teams[1].monsters[slot].hp,220);assert.deepEqual(copy(state),original,'HP, PP and all authoritative event snapshots stay unchanged');
  }
 });

 await test('online single and double ability recoveries animate the correct slot and preserve authoritative HP',()=>{
  for(const mode of ['single','double'])for(const kind of ['regeneration','reserve']){
   const {H,V}=online(),fixture=onlineFixture(mode),slot=mode==='double'?1:0,start=100,id=Object.keys(D.species).find(id=>model.LT.Abilities.get(id)?.kind===kind);assert(id);
   const mon=fixture.frame.teams[1].monsters[slot];mon.species=id;mon.hp=75;fixture.events[0].visual=copy(fixture.frame);
   const ability=model.LT.Abilities.get(mon),recovery=model.LT.Abilities.endTurn(mon,mon.maxHp);assert(recovery.amount>0);
   fixture.push({kind:'ability',side:1,slot,ability:ability.id,abilityId:ability.id,amount:recovery.amount,text:`特性「${ability.name}」で体力が回復した。`},frame=>{frame.teams[1].monsters[slot].hp+=recovery.amount;});
   fixture.push({kind:'turn',text:'次の合図。'});
   const state=fixture.state(),original=copy(state),timeline=V.onlinePlan(state),event=state.events[1],before=state.events[0].visual.teams[1].monsters[slot],after=event.visual.teams[1].monsters[slot],{impact,plan}=onlineChange(H,V,event,before,after),beat=timeline.beats[1];
   assert(plan.duration>0);assert(timeline.beats[2].start>=beat.start+impact+plan.duration,'The next message waits for ability HP to settle');V.onlineView(state,start);
   const mid=start+beat.start+impact+plan.duration/2,shown=V.onlineView(state,mid),healed=shown.teams[1].monsters[slot];
   approximately(healed.hp,H.sample(plan,plan.duration/2),'Ability recovery follows the continuous HP plan');assert(healed.hp>before.hp&&healed.hp<after.hp);assert.equal(healed.displayHp,H.displayed(plan,healed.hp));assert(V.onlineBusy(state,mid));
   if(mode==='double')assert.equal(shown.teams[1].monsters[0].hp,300,'The other double-battle slot does not inherit the recovery');
   assert.equal(V.onlineView(state,start+beat.start+impact+plan.duration+1).teams[1].monsters[slot].hp,after.hp);assert.deepEqual(copy(state),original,'Presentation never reapplies healing to the authoritative state');
  }
 });

 await test('online fatal damage reaches zero before fainting and keeps only the sprite standing through intervening events',()=>{
  for(const mode of ['single','double']){
   const {V,draw}=online(),fixture=onlineFixture(mode),slot=mode==='double'?1:0,start=100;
   fixture.frame.teams[0].monsters[0].hp=100;fixture.events[0].visual=copy(fixture.frame);
   fixture.push({kind:'damage',move:'futo_burst',side:0,slot:0,target:slot,text:'fatal'},frame=>{frame.teams[1].monsters[slot].hp=0;});
   fixture.push({kind:'heal',side:0,slot:0,amount:80,text:'drain'},frame=>{frame.teams[0].monsters[0].hp=180;});
   fixture.push({kind:'status',status:'curse',side:0,slot:0,text:'condition'});
   fixture.push({kind:'item',side:0,slot:0,text:'item'});
   fixture.push({kind:'faint',side:1,slot,text:'faint'});
   fixture.push({kind:'switch',side:1,slot,index:2,text:'switch'},frame=>{frame.teams[1].active[slot]=2;});
   const state=fixture.state(),original=copy(state),timeline=V.onlinePlan(state);V.onlineView(state,start);
   const drained=start+timeline.beats[1].until-1;assert.equal(V.onlineView(state,drained).teams[1].monsters[slot].hp,0);
   assert.equal(draw(state,drained).teams[1].monsters[slot].hp,300,'Fatal damage does not trigger the sprite faint before its own event');
   for(const index of [2,3,4]){
    const now=start+timeline.beats[index].start+1;
    assert.equal(V.onlineView(state,now).teams[1].monsters[slot].hp,0,'HUD stays at zero between damage and faint');
    assert.equal(draw(state,now).teams[1].monsters[slot].hp,300,'Intervening healing, condition and item effects cannot replay a premature faint');
   }
   const faintAt=start+timeline.beats[5].start+1;assert.equal(draw(state,faintAt).teams[1].monsters[slot].hp,0,'The correct single/double slot faints exactly at its own beat');
   const replaced=V.onlineView(state,start+timeline.beats[6].start+1),team=replaced.teams[1];assert.equal(team.active[slot],2);assert.equal(team.monsters[2].hp,75);assert.equal(draw(state,start+timeline.beats[6].start+2).teams[1].monsters[2].hp,75);
   assert.deepEqual(copy(state),original,'Sprite-only survival does not restore real HP');
  }
 });

 await test('online identity and maximum-HP changes reset their scale, while legacy snapshots without UIDs still interpolate',()=>{
  for(const replacement of ['uid','species','maxHp','missingUid']){
   const {V}=online(),fixture=onlineFixture(),start=100;
   fixture.push({kind:'damage',move:'futo_burst',side:0,target:0,text:replacement},frame=>{
    const mon=frame.teams[1].monsters[0];mon.hp=37;
    if(replacement==='uid')mon.uid='replacement';if(replacement==='species')mon.species='kirari';if(replacement==='maxHp')mon.maxHp=500;if(replacement==='missingUid')delete mon.uid;
   });
   const state=fixture.state(),timeline=V.onlinePlan(state),beat=timeline.beats[1],effect=V.fromEvent(state.events[1],null,0);V.onlineView(state,start);
   const early=V.onlineView(state,start+beat.start+effect.duration/2).teams[1].monsters[0];assert.equal(early.hp,300);assert.equal(early.displayHp,undefined,'Different identities cannot interpolate from another monster');
   const settled=V.onlineView(state,start+beat.start+effect.duration+1).teams[1].monsters[0];assert.equal(settled.hp,37);assert.equal(settled.maxHp,replacement==='maxHp'?500:300);assert.equal(settled.displayHp,undefined);
  }
  const {H,V}=online(),fixture=onlineFixture(),start=100;delete fixture.frame.teams[1].monsters[0].uid;fixture.events[0].visual=copy(fixture.frame);
  fixture.push({kind:'damage',move:'futo_burst',side:0,target:0,text:'legacy'},frame=>{frame.teams[1].monsters[0].hp=37;});
  const state=fixture.state(),beat=V.onlinePlan(state).beats[1],{impact,plan}=onlineChange(H,V,state.events[1],state.events[0].visual.teams[1].monsters[0],state.events[1].visual.teams[1].monsters[0]);V.onlineView(state,start);
  const mon=V.onlineView(state,start+beat.start+impact+plan.duration/2).teams[1].monsters[0];assert(mon.hp>37&&mon.hp<300);assert(Number.isInteger(mon.displayHp));
 });

 await test('online reduced motion settles HP immediately, including an accessibility setting changed during a hit',()=>{
  for(const mode of ['initial','system','mid-setting','mid-system']){
   const {c,H,V,settings}=online({reducedMotion:mode==='initial'}),fixture=onlineFixture(),start=100;
   if(mode==='system')c.systemReduced=true;
   fixture.push({kind:'damage',move:'futo_burst',side:0,target:0,text:'hit'},frame=>{frame.teams[1].monsters[0].hp=1;});
   const state=fixture.state(),timeline=V.onlinePlan(state),beat=timeline.beats[1];V.onlineView(state,start);
   let now=start+beat.start;
   if(mode.startsWith('mid-')){
    const {impact,plan}=onlineChange(H,V,state.events[1],state.events[0].visual.teams[1].monsters[0],state.events[1].visual.teams[1].monsters[0]);now+=impact+plan.duration*.3;
    const moving=V.onlineView(state,now).teams[1].monsters[0];assert(moving.hp>1&&moving.hp<300);
    if(mode==='mid-system')c.systemReduced=true;else settings.reducedMotion=true;now++;
   }
   const settled=V.onlineView(state,now).teams[1].monsters[0];assert.equal(settled.hp,1);assert.equal(settled.displayHp,1);
   settings.reducedMotion=false;c.systemReduced=false;assert.equal(V.onlineView(state,now+1).teams[1].monsters[0].hp,1,'Turning motion back on cannot rewind a finished bar');
   assert(V.onlineBusy(state,start+timeline.total-1),'Changing motion does not discard the remaining readable message');assert.equal(V.onlineBusy(state,start+timeline.total),false);
  }
 });

 await test('online HUD uses float bar widths and integer labels on every frame, even between the throttled canvas redraws',()=>{
  const {c,time,H,V}=online(),fixture=onlineFixture(),start=100;
  fixture.push({kind:'damage',move:'futo_burst',side:0,target:0,text:'hit'},frame=>{frame.teams[1].monsters[0].hp=0;});
  const state=fixture.state(),original=copy(state),beat=V.onlinePlan(state).beats[1],{impact,plan}=onlineChange(H,V,state.events[1],state.events[0].visual.teams[1].monsters[0],state.events[1].visual.teams[1].monsters[0]);V.onlineView(state,start);
  const fill=element(),label=element(),card=element();card.dataset.linkHealth='1:0';card.querySelector=selector=>selector==='.link-hp-track>span'?fill:label;
  c.view={battle:state};c.body={querySelectorAll:selector=>{assert.equal(selector,'[data-link-health]');return [card];}};
  vm.runInContext(section('  function hp(mon){','  function commandOptions('),c);
  const mid=start+beat.start+impact+plan.duration*.371,shown=V.onlineView(state,mid).teams[1].monsters[0],markup=c.hp(shown);
  assert(markup.includes(`体力 ${shown.displayHp} / 300`));assert(markup.includes('data-link-hp-text'));assert(!markup.includes(`体力 ${shown.hp} /`),'The numeric label never exposes fractional HP');
  c.refreshLinkHealth(mid);approximately(width(fill),shown.hp/3,'HUD width follows the continuous HP');assert.equal(label.textContent,`体力 ${shown.displayHp} / 300`);assert.equal(fill.style.transition,'none');assert.equal(card.classList.contains('fainted'),false);
  Object.assign(c,{dialog:{open:true},document:{hidden:false},playbackLocked:true,lastDraw:mid,lastShown:2,draws:0,renders:0,draw:()=>c.draws++,render:()=>c.renders++});
  vm.runInContext(section('  function loop(now){if(!dialog.open)','  function reset(){generation++'),c);
  const oldWidth=width(fill);c.loop(mid+16);assert(width(fill)<oldWidth,'HP animates between the 70 ms canvas redraws');assert.equal(c.draws,0);assert.equal(c.renders,0);time.cancelAnimationFrame(c.animation);
  const finished=start+beat.start+impact+plan.duration+1;c.refreshLinkHealth(finished);assert.equal(width(fill),0);assert.equal(label.textContent,'体力 0 / 300');assert(card.classList.contains('fainted'));assert(fill.classList.contains('low'));
  assert(section('  function renderBattle(){','  function loop(now){if(!dialog.open)').includes('data-link-health='),'Rendered combatants expose their stable team/index hook');
  assert.deepEqual(copy(state),original);
 });

 console.log(`Battle health checks passed: ${passed} groups.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
