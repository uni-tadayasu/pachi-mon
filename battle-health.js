/* Pachi Monsters — HP presentation follows the individual and the actual hit. */
(() => {
  'use strict';
  const LT=globalThis.LT=globalThis.LT||{},clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const finite=(n,fallback=0)=>Number.isFinite(n)?n:fallback;
  const reduced=options=>options?.reducedMotion===true||globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true;
  // Damage is already resolved by the battle engine. This only controls how long
  // its exact HP difference takes to display; it never recalculates damage.
  function plan(options={}){
    const max=Math.max(1,finite(options.max,1)),from=clamp(finite(options.from),0,max),to=clamp(finite(options.to),0,max);
    const delta=Math.abs(to-from),healing=to>from;
    let duration=0;
    if(delta>0&&!reduced(options)){
      const defense=options.kind==='damage'&&!healing?Math.max(0,finite(options.category==='special'?options.spDef:options.def)):0;
      const endurance=Math.min(260,defense*.65);
      const base=180+Math.sqrt(delta)*30+Math.log2(1+max/120)*115+endurance;
      duration=Math.round(clamp(base,220,healing?950:1550)*clamp(finite(options.tempo,1),.5,1.2));
      if(options.fastForward)duration=Math.min(100,duration);
    }
    return {from,to,max,duration};
  }
  function sample(value,elapsed){
    if(!value.duration||elapsed>=value.duration)return value.to;
    const t=clamp(finite(elapsed)/value.duration,0,1);
    return value.from+(value.to-value.from)*t;
  }
  function displayed(value,hp){
    const n=clamp(finite(hp,value.to),0,value.max);
    // A draining counter reaches zero only when the bar has actually emptied.
    return value.to<value.from?Math.ceil(n-1e-8):Math.floor(n+1e-8);
  }
  const bars=new WeakMap(),now=()=>globalThis.performance?.now?.()||0;
  function paint(fill,label,state,hp){
    state.shown=hp;
    fill.style.transition='none';
    fill.style.width=`${clamp(hp/state.plan.max*100,0,100)}%`;
    fill.classList?.toggle('low',hp/state.plan.max<.25);
    if(label)label.textContent=`${displayed(state.plan,hp)} / ${state.plan.max}`;
  }
  function cancel(state){if(state?.frame!==undefined)globalThis.cancelAnimationFrame?.(state.frame);if(state)delete state.frame;}
  function finish(fill){
    const state=bars.get(fill);if(!state)return;
    cancel(state);paint(fill,state.label,state,state.plan.to);state.done=true;
  }
  function update(fill,label,options={}){
    if(!fill)return 0;
    const old=bars.get(fill),max=Math.max(1,finite(options.max,1)),to=clamp(finite(options.hp),0,max),time=now();
    if(old&&old.key===options.key&&old.plan.to===to&&old.plan.max===max){
      old.label=label;
      if(reduced(options)||options.fastForward)finish(fill);
      return old.done?0:Math.max(0,old.plan.duration-(time-old.started));
    }
    cancel(old);
    const event=options.event,move=LT.DATA?.moves?.[event?.moveId||event?.move];
    const continuous=!!event&&old?.key===options.key&&old.plan.max===max;
    const value=plan({...options,from:continuous?old.shown:to,to,max,kind:event?.kind,category:event?.category||move?.category});
    if(!continuous||typeof globalThis.requestAnimationFrame!=='function')value.duration=0;
    const state={key:options.key,plan:value,label,started:time,shown:value.from,done:!value.duration};bars.set(fill,state);
    paint(fill,label,state,value.duration?value.from:to);
    if(value.duration){
      const frame=stamp=>{
        if(bars.get(fill)!==state)return;
        const elapsed=Math.max(0,stamp-state.started),hp=sample(value,elapsed);
        paint(fill,state.label,state,hp);
        if(elapsed>=value.duration){state.done=true;delete state.frame;return;}
        state.frame=globalThis.requestAnimationFrame(frame);
      };
      state.frame=globalThis.requestAnimationFrame(frame);
    }
    return value.duration;
  }
  const api=Object.freeze({plan,sample,displayed,update,finish});LT.BattleHealth=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})();
