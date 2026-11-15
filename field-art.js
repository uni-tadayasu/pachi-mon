/* Pachi Monsters — generated environment artwork, © 2026 KASAI SOLUTIONS INC.
 * Art direction: original, fine clustered pixel art; top-down orthographic RPG.
 * Built-in image generation prompts: 4×4 edge-to-edge ground materials (meadow,
 * moss, dirt, cobble, turquoise water, ocean, sand, snow, cave, basalt, lava,
 * ruins, oak, ceramic, teal carpet, red carpet); transparent 4×4 trees/obstacles;
 * transparent 3×3 centered-door cottage/shop/inn/lab/hall/coast/ruin/snow/lava
 * buildings. Each atlas cell is one independently described original asset.
 * These assets change rendering only; collision, portals and save data remain
 * defined by the existing map. Source PNGs are preserved outside the checkout.
 */
(() => {
  'use strict';
  const LT = globalThis.LT = globalThis.LT || {};
  const textures = new Map(), trees = new Map(), houses = new Map(), props = new Map();
  const sheets = Object.create(null);
  const TILE = 64;
  const themes = {
    village: [0,3,4,[0,2,3,13]], meadow: [0,2,4,[0,3,2]],
    forest: [1,2,4,[1,5,0]], coast: [0,6,5,[4,5,3]],
    harbor: [0,3,5,[4,5,0]], ruins: [1,11,4,[6,14,0]],
    desert: [6,2,4,[7]], glacier: [7,7,4,[8,15]],
    volcano: [9,8,10,[9]], grotto: [8,8,4,[10]],
    observatory: [8,11,5,[11,15]], tower: [8,11,5,[14,11]],
    league: [11,11,5,[11,15]]
  };
  const tile = (m,x,y) => m.tiles[y]?.[x] || '#';
  const canvas = (w,h) => { const e=document.createElement('canvas');e.width=w;e.height=h;return e; };
  function bounded(map,key,value,max) {
    map.set(key,value);
    if (map.size>max) map.delete(map.keys().next().value);
    return value;
  }
  function load(key,url) {
    return new Promise(resolve => {
      const img = new Image(); let settled=false,done=false;
      const release = ok => { if(settled)return;settled=true;clearTimeout(timer);resolve(ok); };
      const finish = ok => {
        if(done)return;done=true;const late=settled;
        img.onload=img.onerror=null;
        if(ok)sheets[key]=img;
        release(ok);
        if(ok&&late)document.dispatchEvent(new Event('pachi-art-ready'));
      };
      const timer=setTimeout(()=>release(false),15000);
      img.onload=()=>finish(img.naturalWidth>0);img.onerror=()=>finish(false);
      img.src=url;
    });
  }
  function crop(image,index,cols,rows,transparent=false) {
    const x=Math.round((index%cols)*image.naturalWidth/cols);
    const y=Math.round(Math.floor(index/cols)*image.naturalHeight/rows);
    const w=Math.round((index%cols+1)*image.naturalWidth/cols)-x;
    const h=Math.round((Math.floor(index/cols)+1)*image.naturalHeight/rows)-y;
    const out=canvas(w,h),c=out.getContext('2d');c.drawImage(image,x,y,w,h,0,0,w,h);
    if(transparent) {
      // A hard alpha contour removes the generator's invisible colored fringe;
      // material colors are retained. Scan the retained silhouette for fitting.
      const data=c.getImageData(0,0,w,h);let left=w,top=h,right=0,bottom=0;
      for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++) {
        const p=(yy*w+xx)*4;
        if(data.data[p+3]<160) { data.data[p+3]=0;continue; }
        data.data[p+3]=255;left=Math.min(left,xx);top=Math.min(top,yy);right=Math.max(right,xx);bottom=Math.max(bottom,yy);
      }
      c.putImageData(data,0,0);
      if(left<=right&&top<=bottom)return {cv:out,left,top,width:right-left+1,height:bottom-top+1};
    }
    return {cv:out,left:0,top:0,width:w,height:h};
  }
  function texture(index) {
    if(textures.has(index))return textures.get(index);
    if(!sheets.terrain)return null;
    const cut=crop(sheets.terrain,index,4,4),out=canvas(128,128),c=out.getContext('2d');
    c.imageSmoothingEnabled=false;c.drawImage(cut.cv,2,2,cut.width-4,cut.height-4,0,0,128,128);
    return bounded(textures,index,out,16);
  }
  function paint(c,index,x,y) {
    const tex=texture(index);if(!tex)return false;
    // Four tiles share one 128px patch. Alternate patches are reflected, so
    // neighboring repeats share their boundary and no atlas divider can leak.
    const px=((x%4)+4)%4,py=((y%4)+4)%4;
    const sx=(px<2?px:3-px)*64,sy=(py<2?py:3-py)*64;
    c.save();c.imageSmoothingEnabled=false;
    c.translate(x*TILE+(px>=2?64:0),y*TILE+(py>=2?64:0));
    c.scale(px>=2?-1:1,py>=2?-1:1);
    c.drawImage(tex,sx,sy,64,64,0,0,64,64);c.restore();return true;
  }
  function color(c,col,x,y,w,h) { c.fillStyle=col;c.fillRect(x,y,w,h); }
  function ground(c,m,x,y,p) {
    if(!sheets.terrain)return false;
    const ch=tile(m,x,y),theme=themes[m.theme]||themes.meadow,X=x*64,Y=y*64;
    if(m.interior) {
      // Preserve wall, exit arrows and bridge geometry from the base renderer.
      if(ch==='#'||ch==='D'||ch==='b')return false;
      const kind=m.roomKind;
      paint(c,ch==='='?(kind==='gym'?14:15):(kind==='lab'?13:12),x,y);
      if(ch==='=')for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]])if(tile(m,x+dx,y+dy)!=='=') {
        if(dx)color(c,'#e5c989',X+(dx<0?2:60),Y,2,64);
        else color(c,'#e5c989',X,Y+(dy<0?2:60),64,2);
      }
      return true;
    }
    // Existing wall/rock/bridge/exit symbols contain structural details.
    if(['#','b','D'].includes(ch))return false;
    if(ch==='o'&&!(m.furniture||[]).some(f=>x>=f.x&&x<f.x+(f.w||1)&&y>=f.y&&y<f.y+(f.h||1)))return false;
    if(ch==='~') {
      paint(c,theme[2],x,y);
      for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]])if(!['~','b'].includes(tile(m,x+dx,y+dy))) {
        c.save();c.beginPath();
        if(dx)c.rect(X+(dx<0?0:59),Y,5,64);else c.rect(X,Y+(dy<0?0:59),64,5);
        c.clip();paint(c,theme[1],x,y);c.restore();
        const foam=m.theme==='volcano'?'#ffc775':'#c6e9d6';
        if(dx)color(c,foam,X+(dx<0?5:57),Y,2,64);else color(c,foam,X,Y+(dy<0?5:57),64,2);
      }
      return true;
    }
    if(ch==='='||ch==='_') {
      paint(c,ch==='_'?3:theme[1],x,y);
      // Shallow path edges preserve map readability without creating obstacles.
      c.save();c.globalAlpha=.18;
      for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]])if(!['=','_','D','b','B'].includes(tile(m,x+dx,y+dy))) {
        if(dx)color(c,p.edge,X+(dx<0?0:62),Y,2,64);else color(c,p.edge,X,Y+(dy<0?0:62),64,2);
      }c.restore();return true;
    }
    paint(c,theme[0],x,y);
    if(ch===':') {
      c.save();c.globalAlpha=.24;color(c,'#123f2d',X,Y,64,64);c.restore();
      // Tall grass has an intentional clear vertical silhouette at tile scale.
      for(let row=0;row<3;row++)for(let col=0;col<4;col++) {
        const xx=X+8+col*15+(row%2?3:0),yy=Y+17+row*20;
        c.fillStyle=p.leaf2;c.beginPath();c.moveTo(xx-5,yy+6);c.lineTo(xx-7,yy-8);c.lineTo(xx-1,yy-2);c.lineTo(xx+1,yy-13);c.lineTo(xx+3,yy-1);c.lineTo(xx+8,yy-7);c.lineTo(xx+5,yy+6);c.fill();
        color(c,p.grass2,xx+1,yy-6,1,10);
      }
    }
    if(ch==='*')for(let i=0;i<5;i++) {
      const xx=X+8+(i*13)%49,yy=Y+12+(i*19)%42;
      color(c,p.leaf2,xx,yy+2,1,5);color(c,i%2?'#efb2b8':'#f5e4bd',xx-2,yy,5,3);color(c,'#f9d581',xx,yy+1,1,1);
    }
    return true;
  }
  function tree(theme,variant=0) {
    if(!sheets.trees)return null;
    const choices=(themes[theme]||themes.meadow)[3],i=choices[Math.abs(variant)%choices.length],key=theme+':'+variant;
    if(trees.has(key))return trees.get(key);
    const cut=crop(sheets.trees,i,4,4,true),out=canvas(128,160),c=out.getContext('2d');
    const ratio=Math.min(122/cut.width,148/cut.height),w=Math.round(cut.width*ratio),h=Math.round(cut.height*ratio);
    c.imageSmoothingEnabled=false;c.drawImage(cut.cv,cut.left,cut.top,cut.width,cut.height,Math.round((128-w)/2),153-h,w,h);
    return bounded(trees,key,out,80);
  }
  function building(c,b,p,index=0,theme='village') {
    if(!sheets.buildings)return false;
    let i={shop:1,inn:2,lab:3,gym:4}[b.kind];
    if(i===undefined)i=theme==='glacier'?7:theme==='volcano'?8:theme==='ruins'?6:['coast','harbor'].includes(theme)?5:0;
    let cut=houses.get(i);if(!cut){cut=crop(sheets.buildings,i,3,3,true);houses.set(i,cut);}
    const x=b.x*64,y=b.y*64,w=b.w*64,base=(b.y+b.h)*64;
    // The original collision footprint and exact portal center are retained.
    const door=b.door?b.door.x*64+32:x+w/2;
    const height=Math.max(170,Math.min(300,104+Math.round(b.h*16*.55)*4));
    const top=base-height,sourceMid=cut.left+cut.width*.5;
    const left=x-8,right=x+w+8;
    c.save();c.imageSmoothingEnabled=false;
    c.drawImage(cut.cv,cut.left,cut.top,cut.width*.5,cut.height,left,top,door-left,height);
    c.drawImage(cut.cv,sourceMid,cut.top,cut.width*.5,cut.height,door,top,right-door,height);
    c.restore();return true;
  }
  function furniture(c,f) {
    if(!sheets.props)return false;
    const mapping={bench:0,stall:1,notice:2,table:3,bed:4,shelf:5,counter:6,desk:7,plant:8,planter:8,pillar:9,barrel:11};
    const kind=f.type||'shelf',index=mapping[kind];
    if(index===undefined)return false;
    let cut=props.get(index);
    if(!cut){cut=crop(sheets.props,index,4,3,true);props.set(index,cut);}
    const width=(f.w||1)*64,height=(f.h||1)*64;
    const tall=['stall','shelf','notice','pillar','plant','planter'].includes(kind);
    const maxW=width+8,maxH=height+(tall?64:24);
    const ratio=Math.min(maxW/cut.width,maxH/cut.height);
    const w=Math.round(cut.width*ratio),h=Math.round(cut.height*ratio);
    const x=Math.round(f.x*64+(width-w)/2),y=Math.round((f.y+(f.h||1))*64-h-2);
    c.save();c.imageSmoothingEnabled=false;
    c.drawImage(cut.cv,cut.left,cut.top,cut.width,cut.height,x,y,w,h);
    c.restore();return true;
  }
  const ready=Promise.all([
    load('terrain','assets/environment-terrain.webp'),
    load('trees','assets/environment-trees.webp'),
    load('buildings','assets/environment-buildings.webp'),
    load('props','assets/environment-props.webp')
  ]).then(results=>({terrain:results[0],trees:results[1],buildings:results[2],props:results[3]}));
  LT.FieldArt={ready,ground,tree,building,furniture,clearCache(){textures.clear();trees.clear();houses.clear();props.clear();}};
})();
