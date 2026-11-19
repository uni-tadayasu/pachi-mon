/* The title artwork shares the scenery's visible pixel grid. */
(() => {
  'use strict';
  const backdrop=document.querySelector?.('.title-backdrop');
  if(!backdrop||backdrop.querySelector('canvas'))return;
  const source=new Image();
  source.onload=()=>{
    try{
      if(!source.naturalWidth||!source.naturalHeight)return;
      const scale=Math.min(1,768/Math.max(source.naturalWidth,source.naturalHeight));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(source.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(source.naturalHeight*scale));
      const ctx=canvas.getContext('2d');if(!ctx)return;
      ctx.imageSmoothingEnabled=false;ctx.drawImage(source,0,0,canvas.width,canvas.height);
      canvas.setAttribute('aria-hidden','true');
      backdrop.appendChild(canvas);
      backdrop.classList.add('pixel-backdrop-ready');
    }catch(_){/* The existing CSS illustration remains available on failure. */}
  };
  source.onerror=()=>{};
  source.src=new URL('assets/cover-pixel.webp',new URL('.',document.currentScript?.src||document.baseURI)).href;
})();
