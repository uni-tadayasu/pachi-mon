/* Mobile viewport and accidental gesture protection. */
(() => {
  'use strict';
  const root=document.documentElement;
  // Keep tablet touch controls through rotation and trackpad use. Bounding
  // both axes (long <= 1400, short <= 1100) leaves large touch PCs in the
  // desktop layout; narrow Split View windows retain the phone layout.
  const mobile=matchMedia([
    '(max-width:700px)',
    '(max-width:1100px) and (max-height:1400px) and (any-pointer:coarse)',
    '(max-width:1400px) and (max-height:1100px) and (any-pointer:coarse)',
    '(max-width:1000px) and (max-height:550px)'
  ].join(', '));
  const viewport=document.querySelector('meta[name="viewport"]');
  const baseViewport='width=device-width, initial-scale=1, viewport-fit=cover';
  const editable=target=>target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable="true"]');
  let frame=0,lastShape='';
  const typing=()=>editable(document.activeElement);
  function fit(){
    frame=0;root.classList.toggle('mobile-screen',mobile.matches);
    // The smaller of the layout and visible heights follows an open keyboard;
    // the repeated fits after a rotation catch the final size once it settles.
    const height=Math.round(Math.min(window.innerHeight||Infinity,window.visualViewport?.height||Infinity));
    root.style.setProperty('--app-height',height+'px');
    viewport?.setAttribute('content',baseViewport+(mobile.matches?', minimum-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=resizes-content':''));
    // A rotation or a closed keyboard can leave the page scrolled; the fixed
    // layout then draws in one place and receives taps in another.
    if(mobile.matches&&!typing()&&(window.scrollX||window.scrollY||document.scrollingElement?.scrollTop))window.scrollTo(0,0);
    const shape=`${window.innerWidth>window.innerHeight?'landscape':'portrait'}:${mobile.matches}`;
    if(shape!==lastShape){lastShape=shape;if(typeof CustomEvent==='function')document.dispatchEvent?.(new CustomEvent('pachi-viewport-change',{detail:{shape}}));}
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(fit);}
  // Phones report their final size a moment after rotating, so fit again as it settles.
  function settle(){schedule();if(typeof setTimeout==='function')for(const delay of [120,360,800])setTimeout(schedule,delay);}
  mobile.addEventListener('change',settle);
  window.addEventListener('resize',schedule);
  window.visualViewport?.addEventListener('resize',schedule);
  window.addEventListener('orientationchange',settle);
  window.screen?.orientation?.addEventListener?.('change',settle);
  document.addEventListener('focusout',event=>{if(mobile.matches&&editable(event.target)&&typeof setTimeout==='function')setTimeout(settle,250);});
  for(const name of ['contextmenu','selectstart','dragstart'])document.addEventListener(name,event=>{
    if(mobile.matches&&!editable(event.target))event.preventDefault();
  });
  for(const name of ['gesturestart','gesturechange','gestureend'])document.addEventListener(name,event=>{
    if(mobile.matches)event.preventDefault();
  },{passive:false});
  for(const name of ['touchstart','touchmove'])document.addEventListener(name,event=>{
    if(!mobile.matches||event.touches.length<2)return;
    // Keep D-pad + A/menu taps working. touch-action:none on the console
    // already prevents browser gestures without suppressing button clicks.
    const controlsOnly=Array.from(event.touches).every(touch=>touch.target instanceof Element&&touch.target.closest('.touch-controls'));
    if(!controlsOnly)event.preventDefault();
  },{passive:false});
  document.addEventListener('dblclick',event=>{if(mobile.matches&&!editable(event.target))event.preventDefault();},{passive:false});
  document.addEventListener('wheel',event=>{if(mobile.matches&&event.ctrlKey)event.preventDefault();},{passive:false});
  fit();window.dispatchEvent(new Event('resize'));
})();
