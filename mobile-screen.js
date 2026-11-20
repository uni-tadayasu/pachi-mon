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
  // Text-selection protection must also cover larger tablets and touch PCs
  // without changing their layout or disabling desktop zoom/scrolling.
  const touch=matchMedia('(any-pointer:coarse)');
  const guarded=()=>mobile.matches||touch.matches||(navigator.maxTouchPoints||0)>0;
  const viewport=document.querySelector('meta[name="viewport"]');
  const baseViewport='width=device-width, initial-scale=1, viewport-fit=cover';
  const editable=target=>{
    const element=target instanceof Element?target:target?.parentElement;
    return element instanceof Element&&!!(element.closest('input,textarea,select')||element.isContentEditable);
  };
  let frame=0,lastShape='';
  const typing=()=>editable(document.activeElement);
  function clearSelection(){
    if(!guarded()||typing())return;
    const selection=document.getSelection?.();
    if(selection?.rangeCount&&!editable(selection.anchorNode)&&!editable(selection.focusNode))selection.removeAllRanges();
  }
  function fit(){
    frame=0;root.classList.toggle('mobile-screen',mobile.matches);
    root.classList.toggle('touch-guard',guarded());
    clearSelection();
    // The smaller of the layout and visible heights follows an open keyboard;
    // the repeated fits after a rotation catch the final size once it settles.
    // A software keyboard reduces available height. A deliberate pinch zoom
    // must not rebuild the layout underneath the reader's magnified view.
    const zoomed=(window.visualViewport?.scale||1)>1.02;
    const height=Math.round(zoomed?(window.innerHeight||window.visualViewport?.height):Math.min(window.innerHeight||Infinity,window.visualViewport?.height||Infinity));
    root.style.setProperty('--app-height',height+'px');
    viewport?.setAttribute('content',baseViewport+', interactive-widget=resizes-content');
    // A rotation or a closed keyboard can leave the page scrolled; the fixed
    // layout then draws in one place and receives taps in another.
    if(mobile.matches&&!typing()&&!zoomed&&document.body.classList.contains('is-playing')&&(window.scrollX||window.scrollY||document.scrollingElement?.scrollTop))window.scrollTo(0,0);
    const shape=`${window.innerWidth>window.innerHeight?'landscape':'portrait'}:${mobile.matches}`;
    if(shape!==lastShape){lastShape=shape;if(typeof CustomEvent==='function')document.dispatchEvent?.(new CustomEvent('pachi-viewport-change',{detail:{shape}}));}
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(fit);}
  // Phones report their final size a moment after rotating, so fit again as it settles.
  function settle(){schedule();if(typeof setTimeout==='function')for(const delay of [120,360,800])setTimeout(schedule,delay);}
  mobile.addEventListener('change',settle);
  touch.addEventListener('change',settle);
  window.addEventListener('resize',schedule);
  window.visualViewport?.addEventListener('resize',schedule);
  window.addEventListener('orientationchange',settle);
  window.screen?.orientation?.addEventListener?.('change',settle);
  document.addEventListener('focusout',event=>{if(mobile.matches&&editable(event.target)&&typeof setTimeout==='function')setTimeout(settle,250);});
  for(const name of ['contextmenu','selectstart','dragstart'])document.addEventListener(name,event=>{
    if(guarded()&&!editable(event.target))event.preventDefault();
  },{capture:true,passive:false});
  document.addEventListener('selectionchange',clearSelection);
  // Game controls use touch-action:none in CSS; reading and editing surfaces
  // keep browser magnification instead of disabling zoom for the whole site.
  document.addEventListener('dblclick',event=>{if(guarded()&&!editable(event.target))event.preventDefault();},{capture:true,passive:false});
  fit();window.dispatchEvent(new Event('resize'));
})();
