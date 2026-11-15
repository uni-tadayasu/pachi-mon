/* Mobile viewport and accidental gesture protection. */
(() => {
  'use strict';
  const root=document.documentElement;
  const mobile=matchMedia('(max-width:700px), (max-width:1024px) and (pointer:coarse), (max-width:1000px) and (max-height:550px)');
  const viewport=document.querySelector('meta[name="viewport"]');
  const baseViewport='width=device-width, initial-scale=1, viewport-fit=cover';
  const editable=target=>target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable="true"]');
  let frame=0;
  function fit(){
    frame=0;root.classList.toggle('mobile-screen',mobile.matches);
    const height=Math.round(window.visualViewport?.height||window.innerHeight);
    root.style.setProperty('--app-height',height+'px');
    viewport?.setAttribute('content',baseViewport+(mobile.matches?', minimum-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=resizes-content':''));
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(fit);}
  mobile.addEventListener('change',schedule);
  window.addEventListener('resize',schedule);
  window.visualViewport?.addEventListener('resize',schedule);
  window.addEventListener('orientationchange',schedule);
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
