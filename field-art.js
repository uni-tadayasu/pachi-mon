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
  const textures = new Map(), trees = new Map(), houses = new Map(), props = new Map(), layouts = new Map();
  const sheets = Object.create(null);
  const sourceBase = new URL('.', document.currentScript?.src || document.baseURI);
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
  const pathTile = ch => ['=','_','D','b'].includes(ch);
  const townTheme = theme => ['village','harbor','observatory','league'].includes(theme);
  const hash = (x,y,s=0) => ((Math.imul(x+17,374761393)^Math.imul(y+31,668265263)^Math.imul(s+7,1274126177))>>>0);
  const seed = value => [...String(value)].reduce((s,ch)=>(Math.imul(s,31)+ch.charCodeAt(0))>>>0,17);
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
        if(ok){sheets[key]=img;clearCache();}
        release(ok);
        if(ok&&late)document.dispatchEvent(new Event('pachi-art-ready'));
      };
      const timer=setTimeout(()=>release(false),15000);
      img.onload=()=>finish(img.naturalWidth>0);img.onerror=()=>finish(false);
      img.src=new URL(url,sourceBase).href;
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
  // Single-pixel scanlines keep inlaid stone, leaves and light shafts crisp.
  function polygon(c,points,col) {
    const lo=Math.floor(Math.min(...points.map(p=>p[1]))),hi=Math.ceil(Math.max(...points.map(p=>p[1])));
    c.fillStyle=col;
    for(let y=lo;y<hi;y++) {
      const xs=[];
      for(let i=0,j=points.length-1;i<points.length;j=i++) {
        const a=points[j],b=points[i];
        if((a[1]<=y+.5&&b[1]>y+.5)||(b[1]<=y+.5&&a[1]>y+.5))xs.push(a[0]+(y+.5-a[1])/(b[1]-a[1])*(b[0]-a[0]));
      }
      xs.sort((a,b)=>a-b);
      for(let i=0;i+1<xs.length;i+=2)c.fillRect(Math.ceil(xs[i]),y,Math.ceil(xs[i+1])-Math.ceil(xs[i]),1);
    }
  }
  function flower(c,x,y,petal,leaf='#547f4d') {
    color(c,leaf,x,y+2,1,7);color(c,leaf,x-3,y+5,3,2);color(c,'#92ae6c',x+1,y+4,3,1);
    color(c,petal,x-2,y-2,5,2);color(c,petal,x-3,y,7,2);color(c,petal,x-1,y+2,3,1);
    color(c,'#ffdf91',x,y,2,1);color(c,'#fff7d9',x-1,y-2,2,1);
  }
  function floorTrim(c,m,x,y) {
    const X=x*64,Y=y*64,kind=m.roomKind;
    const edge=kind==='lab'?'#677d85':kind==='gym'?'#66587c':'#795c49',light=kind==='lab'?'#dce8de':'#e8c58e';
    if(tile(m,x,y-1)==='#'){color(c,'#21334445',X,Y,64,8);color(c,edge,X,Y,64,3);color(c,light,X,Y+3,64,1);}
    if(tile(m,x-1,y)==='#'){color(c,'#21334430',X,Y,7,64);color(c,edge,X,Y,3,64);color(c,light,X+3,Y,1,64);}
    if(tile(m,x+1,y)==='#'){color(c,edge,X+61,Y,3,64);color(c,light,X+59,Y,1,64);}
    if(tile(m,x,y+1)==='#'){color(c,edge,X,Y+61,64,3);color(c,light,X,Y+59,64,1);}
  }
  function wall(c,m,x,y) {
    const X=x*64,Y=y*64,kind=m.roomKind;
    const palette=kind==='lab'?['#495f70','#acbebd','#d8e2cf','#819da5']:kind==='gym'?['#343b57','#73738d','#bab7c6','#55516c']:['#5a514e','#c6b99b','#eee0bb','#9b8b73'];
    color(c,palette[0],X,Y,64,64);
    for(let row=0;row<4;row++)for(let col=-1;col<3;col++) {
      const start=X+col*32+(row%2?16:0),left=Math.max(X+1,start+1),right=Math.min(X+63,start+31),yy=Y+row*14+1;
      if(right<=left)continue;
      color(c,palette[1],left,yy,right-left,12);color(c,palette[2],left+1,yy+1,Math.max(1,right-left-2),1);
      color(c,palette[3],left+1,yy+10,Math.max(1,right-left-2),1);
      if(right-left>12){color(c,palette[2],left+4,yy+4,5,1);color(c,palette[3],right-8,yy+8,4,1);}
    }
    color(c,palette[0],X,Y+54,64,10);color(c,palette[2],X,Y+55,64,1);color(c,palette[3],X,Y+57,64,5);
    for(let xx=5;xx<64;xx+=16){color(c,palette[2],X+xx,Y+58,1,3);color(c,palette[0],X+xx+10,Y+58,1,4);}
    color(c,palette[0],X,Y+63,64,1);
  }
  function roadShoulder(c,m,x,y,p) {
    const X=x*64,Y=y*64,paved=townTheme(m.theme)||tile(m,x,y)==='_';
    for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]) {
      if(pathTile(tile(m,x+dx,y+dy))||['B','o'].includes(tile(m,x+dx,y+dy)))continue;
      const vertical=!!dx,base=vertical?X+(dx<0?0:60):Y+(dy<0?0:60);
      for(let i=0;i<64;i+=8) {
        const xx=vertical?base:X+i,yy=vertical?Y+i:base;
        color(c,paved?'#4c636068':p.edge,xx,yy,vertical?4:7,vertical?7:4);
        color(c,paved?'#ddcfaa9c':'#d7c28b70',xx+(vertical?1:0),yy+(vertical?0:1),vertical?1:6,vertical?6:1);
        if(!paved&&i%16===0)color(c,p.leaf2,vertical?xx+(dx<0?0:3):xx+5,vertical?yy+5:yy+(dy<0?0:3),2,2);
      }
    }
  }
  function naturalDetails(c,m,x,y,p) {
    const X=x*64,Y=y*64,n=hash(x,y,seed(m.id)),theme=m.theme;
    const nearRoad=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>pathTile(tile(m,x+dx,y+dy)));
    const nearWater=[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>tile(m,x+dx,y+dy)==='~');
    if(nearWater&&!['volcano','glacier','grotto','observatory','tower','league'].includes(theme)) {
      for(let j=0;j<3;j++) {
        const xx=X+9+(n+j*17)%46,yy=Y+22+(n>>>8)%25;
        polygon(c,[[xx,yy+6],[xx-4,yy-10],[xx,yy-3],[xx+3,yy-16],[xx+4,yy+5]],'#547a4f');
        color(c,'#b6b77b',xx+2,yy-13,1,13);color(c,'#bda36d',xx+2,yy-17,2,4);
      }
    } else if(['desert','volcano','grotto','ruins','observatory','tower','league'].includes(theme)) {
      if(n%4>1)return;
      const xx=X+12+n%33,yy=Y+19+(n>>>8)%27,crystal=['grotto','observatory','tower','league'].includes(theme);
      polygon(c,[[xx-5,yy+3],[xx-7,yy-2],[xx-3,yy-7],[xx+4,yy-5],[xx+7,yy+1],[xx+4,yy+4]],crystal?'#567d99':p.edge);
      polygon(c,[[xx-4,yy],[xx-3,yy-5],[xx+2,yy-3],[xx+1,yy+2]],crystal?'#c0e9e0':p.rock);
      color(c,crystal?'#eafbf0':'#e9d5a27d',xx-3,yy-4,2,1);
      if(theme==='desert')for(let i=0;i<3;i++)color(c,'#f5dca97d',X+8+i*13,Y+44+i%2,10,1);
    } else if(theme==='glacier') {
      if(n%3===0){color(c,'#b1d5e199',X+14,Y+36,30,1);color(c,'#f9fffa',X+22,Y+35,15,1);color(c,'#fffdf1',X+43,Y+14,1,5);color(c,'#fffdf1',X+41,Y+16,5,1);}
    } else if(nearRoad||n%11===0) {
      const bloom=theme==='forest'?['#e2c993','#c0b9df']:['#eeb7b1','#eadb9d','#c5d7ec'];
      for(let i=0;i<(nearRoad?3:2);i++)flower(c,X+9+(n+i*19)%47,Y+14+((n>>>7)+i*11)%36,bloom[(n+i)%bloom.length],p.leaf2);
    }
  }
  function cliff(c,m,x,y,p) {
    const X=x*64,Y=y*64,theme=m.theme;
    const stone=theme==='glacier'?7:theme==='desert'?6:theme==='volcano'?9:['grotto','observatory','tower'].includes(theme)?8:11;
    paint(c,stone,x,y);
    color(c,theme==='glacier'?'#506d8e35':'#253c4847',X,Y,64,64);
    // Masonry joins and exposed strata give impassable tiles a raised face,
    // while retaining the original terrain outline and exit openings.
    for(let row=0;row<3;row++) {
      const yy=Y+row*21+3,seam=X+14+(hash(x,row,y)%3)*16;
      color(c,'#263a414a',X,yy+17,64,2);color(c,'#e4dfb75c',X+2,yy+1,60,1);
      color(c,'#223b435e',seam,yy+2,1,15);color(c,'#e8d8a744',seam+1,yy+3,1,11);
    }
    if(tile(m,x,y+1)!=='#') {
      color(c,'#182d3c59',X,Y+50,64,14);color(c,'#d7d6af88',X,Y+3,64,2);
      for(const off of[8,26,47]) {
        color(c,'#182f424d',X+off,Y+19,2,31);color(c,'#d4d8b33b',X+off+2,Y+20,1,25);
        color(c,'#102d414d',X+off-3,Y+49,6,3);
      }
      if(['village','forest','meadow','harbor','ruins'].includes(theme))for(let i=0;i<4;i++) {
        const xx=X+5+i*16,depth=3+hash(x+i,y)%7;
        color(c,p.leaf2,xx,Y,9,2);color(c,p.leaf,xx+3,Y+2,3,depth);color(c,p.grass2,xx+2,Y+1,4,1);
      }
    }
    if(theme==='glacier') {
      color(c,'#edf8f2',X,Y,64,3);
      for(let i=0;i<8;i++)color(c,'#e4f5ef',X+i*8,Y+3,6,2+hash(i,x,y)%4);
    }
  }
  function bridge(c,m,x,y) {
    const X=x*64,Y=y*64;
    paint(c,12,x,y);
    const vertical=tile(m,x,y-1)==='b'||tile(m,x,y+1)==='b';
    for(const side of[0,1]) {
      if(vertical) {
        const xx=X+(side?58:0);color(c,'#4b4443',xx,Y,6,64);color(c,'#dfbd79',xx+1,Y,1,64);color(c,'#8d714e',xx+3,Y,2,64);
        for(const yy of[10,50]){color(c,'#3b4a50',xx+2,Y+yy,3,3);color(c,'#e6ddaf',xx+2,Y+yy,1,1);}
      } else {
        const yy=Y+(side?58:0);color(c,'#4b4443',X,yy,64,6);color(c,'#dfbd79',X,yy+1,64,1);color(c,'#8d714e',X,yy+3,64,2);
        for(const xx of[10,50]){color(c,'#3b4a50',X+xx,yy+2,3,3);color(c,'#e6ddaf',X+xx,yy+2,1,1);}
      }
    }
    if(vertical)for(let i=0;i<4;i++){color(c,'#644b3b9c',X+6,Y+i*16,52,1);color(c,'#f3d49b99',X+6,Y+i*16+1,52,1);}
    else for(let i=0;i<4;i++){color(c,'#644b3b7d',X+i*16,Y+6,1,52);color(c,'#f3d49b77',X+i*16+1,Y+6,1,52);}
  }
  function ground(c,m,x,y,p) {
    if(!sheets.terrain)return false;
    const ch=tile(m,x,y),theme=themes[m.theme]||themes.meadow,X=x*64,Y=y*64;
    if(m.interior) {
      // Exit arrows retain the existing transition geometry.
      if(ch==='D'||ch==='b')return false;
      if(ch==='#'){wall(c,m,x,y);return true;}
      const kind=m.roomKind;
      paint(c,ch==='='?(kind==='gym'?14:15):(kind==='lab'?13:12),x,y);
      if(ch==='=')for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]])if(tile(m,x+dx,y+dy)!=='=') {
        if(dx){color(c,'#e5c989',X+(dx<0?2:60),Y,2,64);color(c,'#e5c98980',X+(dx<0?6:57),Y,1,64);}
        else {color(c,'#e5c989',X,Y+(dy<0?2:60),64,2);color(c,'#e5c98980',X,Y+(dy<0?6:57),64,1);}
      }
      if(ch==='=')for(const[xx,yy]of[[16,18],[48,46]]) {
        polygon(c,[[X+xx,Y+yy-4],[X+xx+6,Y+yy],[X+xx,Y+yy+4],[X+xx-6,Y+yy]],'#ead09c4a');
        color(c,'#f6e4b985',X+xx,Y+yy,1,1);
      }
      floorTrim(c,m,x,y);
      return true;
    }
    // Impassable cliffs and bridge rails retain the exact old tile geometry.
    if(ch==='D')return false;
    if(ch==='#'){cliff(c,m,x,y,p);return true;}
    if(ch==='b'){bridge(c,m,x,y);return true;}
    if(ch==='o'&&!(m.furniture||[]).some(f=>x>=f.x&&x<f.x+(f.w||1)&&y>=f.y&&y<f.y+(f.h||1))
      &&!decorations(m).some(f=>f.x===x&&f.y===y))return false;
    if(ch==='~') {
      paint(c,theme[2],x,y);
      for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]])if(!['~','b'].includes(tile(m,x+dx,y+dy))) {
        c.save();c.beginPath();
        if(dx)c.rect(X+(dx<0?0:59),Y,5,64);else c.rect(X,Y+(dy<0?0:59),64,5);
        c.clip();paint(c,theme[1],x,y);c.restore();
        const foam=m.theme==='volcano'?'#ffc775':'#c6e9d6';
        if(dx)color(c,foam,X+(dx<0?5:57),Y,2,64);else color(c,foam,X,Y+(dy<0?5:57),64,2);
        for(let i=0;i<64;i+=11) {
          const wobble=(hash(x+i,y)%3)+1;
          if(dx)color(c,m.theme==='volcano'?'#ffe2a78a':'#e2f4dc8a',X+(dx<0?8+wobble:53-wobble),Y+i,1,6);
          else color(c,m.theme==='volcano'?'#ffe2a78a':'#e2f4dc8a',X+i,Y+(dy<0?8+wobble:53-wobble),6,1);
        }
      }
      return true;
    }
    if(ch==='='||ch==='_') {
      paint(c,ch==='_'?3:theme[1],x,y);
      roadShoulder(c,m,x,y,p);return true;
    }
    paint(c,theme[0],x,y);
    if(ch===':') {
      c.save();c.globalAlpha=.24;color(c,'#123f2d',X,Y,64,64);c.restore();
      // Tall grass has an intentional clear vertical silhouette at tile scale.
      for(let row=0;row<3;row++)for(let col=0;col<4;col++) {
        const xx=X+8+col*15+(row%2?3:0),yy=Y+17+row*20;
        polygon(c,[[xx-5,yy+6],[xx-7,yy-8],[xx-1,yy-2],[xx+1,yy-13],[xx+3,yy-1],[xx+8,yy-7],[xx+5,yy+6]],p.leaf2);
        color(c,p.grass2,xx+1,yy-6,1,10);
        color(c,'#d1dba777',xx+1,yy-11,1,3);color(c,'#183e3a5c',xx-3,yy+5,6,1);
      }
    }
    if(ch==='*')for(let i=0;i<5;i++) {
      const xx=X+8+(i*13)%49,yy=Y+12+(i*19)%42;
      flower(c,xx,yy,i%2?'#efb2b8':'#f5e4bd',p.leaf2);
    }
    if(!['T','B','o',':','*'].includes(ch))naturalDetails(c,m,x,y,p);
    return true;
  }
  // Decorative arrangements never modify map tiles or gameplay coordinates.
  // A tall prop may only replace an already blocked tree or rock, away from every
  // portal, actor and arrival. Everything else added here is flat floor inlay.
  function layout(m) {
    if(layouts.has(m))return layouts.get(m);
    const plan={props:[],courtyard:null};
    if(!m.interior&&townTheme(m.theme)) {
      const occupied=(x,y,pad=0)=>(m.furniture||[]).some(f=>x>=f.x-pad&&x<f.x+(f.w||1)+pad&&y>=f.y-pad&&y<f.y+(f.h||1)+pad);
      const protectedSpots=[m.spawn,...(m.npcs||[]),...(m.exits||[])].filter(Boolean);
      const protectedAt=(x,y)=>protectedSpots.some(p=>Math.abs(p.x-x)+Math.abs(p.y-y)<4);
      const candidates=[];
      for(let y=2;y<m.height-2;y++)for(let x=2;x<m.width-2;x++) {
        if(['T','o'].includes(tile(m,x,y))&&!occupied(x,y,1)&&!protectedAt(x,y)
          &&[[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>['=','_'].includes(tile(m,x+dx,y+dy))))
          candidates.push({x,y,rank:hash(x,y,seed(m.id))});
      }
      candidates.sort((a,b)=>a.rank-b.rank);
      for(const point of candidates) {
        if(plan.props.length>=6)break;
        if(plan.props.some(f=>Math.abs(f.x-point.x)+Math.abs(f.y-point.y)<5))continue;
        plan.props.push(Object.freeze({type:plan.props.length%3===2?'planter':'lantern',x:point.x,y:point.y,w:1,h:1,decorative:true}));
      }
      const plaza=[];
      for(let y=2;y<m.height-2;y++)for(let x=2;x<m.width-2;x++) {
        if(!['=','_'].includes(tile(m,x,y))||occupied(x,y,1))continue;
        let clear=true;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(!['=','_'].includes(tile(m,x+dx,y+dy)))clear=false;
        if(clear)plaza.push({x,y,distance:Math.abs(x-(m.spawn?.x||0))+Math.abs(y-(m.spawn?.y||0))});
      }
      plaza.sort((a,b)=>a.distance-b.distance||a.y-b.y||a.x-b.x);
      if(plaza[0])plan.courtyard=Object.freeze({x:plaza[0].x,y:plaza[0].y});
    }
    Object.freeze(plan.props);Object.freeze(plan);
    return bounded(layouts,m,plan,8);
  }
  function decorations(m) { return sheets.props?layout(m).props:[]; }
  function compass(c,x,y,radius,accent,ink) {
    // An eight-point compass is an original recurring landmark for the journey.
    // Outline scanlines let the underlying pavement or carpet remain visible.
    for(let ring=0;ring<2;ring++) {
      const r=radius-ring*4;
      for(let yy=-r;yy<=r;yy++) {
        const half=r-Math.abs(yy);
        color(c,ring?ink:accent,x-half,y+yy,2,1);color(c,ring?ink:accent,x+half-1,y+yy,2,1);
      }
    }
    for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]) {
      const tip=[x+dx*(radius-13),y+dy*(radius-13)],base=[x+dx*8,y+dy*8];
      polygon(c,[tip,[base[0]-dy*6,base[1]+dx*6],[x,y]],accent);
      polygon(c,[tip,[base[0]+dy*6,base[1]-dx*6],[x,y]],ink);
    }
    color(c,'#f4e5bb',x-1,y-2,3,3);
    for(const[dx,dy]of[[1,1],[-1,1],[1,-1],[-1,-1]])color(c,accent,x+dx*(radius-17)-1,y+dy*(radius-17)-1,3,3);
  }
  function windowDetail(c,x,y,kind) {
    const dark=kind==='lab'?'#405d70':'#625549',trim=kind==='gym'?'#c8b67e':'#ddc497';
    color(c,'#1a2e3b44',x-4,y+4,62,45);color(c,dark,x-2,y-2,58,46);color(c,trim,x,y,54,42);
    color(c,'#466c82',x+3,y+3,48,35);color(c,'#8cc7c3',x+5,y+5,44,31);
    polygon(c,[[x+5,y+5],[x+36,y+5],[x+21,y+36],[x+5,y+36]],'#c2e4d0');
    polygon(c,[[x+9,y+5],[x+13,y+5],[x+5,y+22],[x+5,y+14]],'#f4f2ce');
    color(c,dark,x+26,y+3,3,35);color(c,trim,x+25,y+3,2,35);color(c,trim,x+3,y+19,48,3);color(c,'#f7e8be',x+3,y+19,48,1);
    color(c,dark,x-5,y+42,64,5);color(c,trim,x-5,y+41,64,2);color(c,'#f4dfb2',x-3,y+41,60,1);
    if(kind!=='lab') {
      for(const side of[0,1])for(let i=0;i<3;i++)color(c,kind==='gym'?'#726f92':'#b78975',x+(side?50:0)+i*2,y+1,2,36-i*3);
      color(c,'#e6c78d',x+2,y+26,4,2);color(c,'#e6c78d',x+50,y+26,4,2);
    }
  }
  function dressing(c,m,p) {
    if(!sheets.terrain)return false;
    c.save();c.imageSmoothingEnabled=false;
    if(m.interior) {
      // Light is clipped to the existing floor, so it cannot paint over walls,
      // furniture footprints, door arrows or the special battle arena.
      c.save();c.beginPath();
      for(let y=1;y<Math.min(m.height-1,6);y++)for(let x=1;x<m.width-1;x++)if(['_','=','.'].includes(tile(m,x,y)))c.rect(x*64,y*64,64,64);
      c.clip();
      for(const xx of[3,m.width-4]) {
        polygon(c,[[xx*64+9,64],[xx*64+46,64],[xx*64+116,285],[xx*64+38,285]],'#fff1bf15');
        polygon(c,[[xx*64+15,64],[xx*64+21,64],[xx*64+81,285],[xx*64+68,285]],'#fff4cf0b');
        color(c,'#fff5c718',xx*64+31,124,48,2);color(c,'#fff5c712',xx*64+50,189,56,2);
      }
      c.restore();
      for(const xx of[3,m.width-4])if(tile(m,xx,0)==='#')windowDetail(c,xx*64+5,9,m.roomKind);
      for(const f of m.furniture||[])if(f.type==='arena') {
        const x=f.x*64,y=f.y*64,w=f.w*64,h=f.h*64;
        color(c,'#34495666',x+8,y+8,w-16,h-16);
        color(c,'#d5c88b',x+12,y+12,w-24,2);color(c,'#d5c88b',x+12,y+h-14,w-24,2);
        color(c,'#d5c88b',x+12,y+12,2,h-24);color(c,'#d5c88b',x+w-14,y+12,2,h-24);
        color(c,'#e8dfb15a',x+20,y+20,w-40,1);color(c,'#e8dfb15a',x+20,y+h-21,w-40,1);
        compass(c,Math.round(x+w/2),Math.round(y+h/2),Math.round(Math.min(w,h)*.26),'#c6be8c','#536e7e');
        for(const dx of[26,w-27])for(const dy of[26,h-27])polygon(c,[[x+dx,y+dy-5],[x+dx+5,y+dy],[x+dx,y+dy+5],[x+dx-5,y+dy]],'#ded096');
      }
    } else {
      const courtyard=layout(m).courtyard;
      if(courtyard) {
        const x=courtyard.x*64+32,y=courtyard.y*64+32;
        compass(c,x,y,66,'#e1c99b99','#697e7b82');
      }
      for(const e of m.exits||[])if(e.door&&tile(m,e.x,e.y)==='D'&&['=','_'].includes(tile(m,e.x,e.y+1))) {
        const X=e.x*64,Y=(e.y+1)*64;
        color(c,'#3c535741',X+5,Y+2,54,20);color(c,'#ead7ad8c',X+7,Y+2,50,1);
        color(c,'#e7d1a65c',X+7,Y+12,50,1);color(c,'#4b666666',X+6,Y+22,52,1);
        for(let xx=11;xx<56;xx+=12)color(c,'#516b685e',X+xx,Y+3,1,8);
      }
    }
    c.restore();return true;
  }
  function tree(theme,variant=0) {
    if(!sheets.trees)return null;
    const choices=(themes[theme]||themes.meadow)[3],i=choices[Math.abs(variant)%choices.length],key=theme+':'+variant;
    if(trees.has(key))return trees.get(key);
    const cut=crop(sheets.trees,i,4,4,true),out=canvas(128,160),c=out.getContext('2d');
    const ratio=Math.min(122/cut.width,148/cut.height),w=Math.round(cut.width*ratio),h=Math.round(cut.height*ratio);
    c.imageSmoothingEnabled=false;c.drawImage(cut.cv,cut.left,cut.top,cut.width,cut.height,Math.round((128-w)/2),153-h,w,h);
    LT.ScenePixels?.apply(out,{step:2});
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
    const mapping={bench:0,stall:1,notice:2,table:3,bed:4,shelf:5,counter:6,desk:7,plant:8,planter:8,pillar:9,lantern:10,barrel:11};
    const kind=f.type||'shelf',index=mapping[kind];
    if(index===undefined)return false;
    let cut=props.get(index);
    if(!cut){cut=crop(sheets.props,index,4,3,true);props.set(index,cut);}
    const width=(f.w||1)*64,height=(f.h||1)*64;
    const tall=['stall','shelf','notice','pillar','plant','planter','lantern'].includes(kind);
    const maxW=width+8,maxH=height+(tall?64:24);
    const ratio=Math.min(maxW/cut.width,maxH/cut.height);
    const w=Math.round(cut.width*ratio),h=Math.round(cut.height*ratio);
    const x=Math.round(f.x*64+(width-w)/2),y=Math.round((f.y+(f.h||1))*64-h-2);
    c.save();c.imageSmoothingEnabled=false;
    c.drawImage(cut.cv,cut.left,cut.top,cut.width,cut.height,x,y,w,h);
    c.restore();return true;
  }
  function clearCache(){textures.clear();trees.clear();houses.clear();props.clear();layouts.clear();}
  const ready=Promise.all([
    load('terrain','assets/environment-terrain-v33.png'),
    load('trees','assets/environment-trees-v33.png'),
    load('buildings','assets/environment-buildings-v33.png'),
    load('props','assets/environment-props-v33.png')
  ]).then(results=>({terrain:results[0],trees:results[1],buildings:results[2],props:results[3]}));
  LT.FieldArt={ready,ground,tree,building,furniture,dressing,decorations,layout,clearCache,
    status(){return {loaded:Object.keys(sheets),cached:{textures:textures.size,trees:trees.size,houses:houses.size,props:props.size,layouts:layouts.size},maximum:{textures:16,trees:80,houses:9,props:12,layouts:8}};},
    atlasLayout:{terrain:[4,4],trees:[4,4],buildings:[3,3],props:[4,3]}};
})();
