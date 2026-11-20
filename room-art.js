/* Pachi Monsters — shared secret rooms, © 2026 KASAI SOLUTIONS INC.
 * Native two-pixel artwork. Geometry and furniture footprints match the room
 * service; rendering never changes a room record or creates collision tiles.
 */
(() => {
  'use strict';
  const LT = globalThis.LT = globalThis.LT || {};
  const TILE = 64;
  const catalog = Object.freeze([
    {id:'plant',name:'観葉植物',width:1,height:1,solid:true},
    {id:'lamp',name:'星あかりランプ',width:1,height:1,solid:true},
    {id:'stool',name:'木のスツール',width:1,height:1,solid:true},
    {id:'table',name:'旅人のテーブル',width:2,height:2,solid:true},
    {id:'sofa',name:'海色のソファ',width:2,height:1,solid:true},
    {id:'shelf',name:'冒険の本棚',width:2,height:1,solid:true},
    {id:'bed',name:'ふかふかベッド',width:2,height:3,solid:true},
    {id:'aquarium',name:'小さな水族館',width:2,height:1,solid:true},
    {id:'crystal',name:'記憶のクリスタル',width:1,height:1,solid:true},
    {id:'plush',name:'パチモンぬいぐるみ',width:1,height:1,solid:true},
    {id:'rug',name:'星環のラグ',width:2,height:2,solid:false},
    {id:'banner',name:'旅団の旗',width:1,height:1,solid:true},
  ].map(Object.freeze));
  const items = new Map(catalog.map(item => [item.id,item]));
  const templateDescriptions=Object.freeze([
    {id:'hall',name:'王座の大広間',description:'広い長方形のホール。深緑の石床と金の装飾。'},
    {id:'sanctum',name:'星環の八角堂',description:'角を落とした八角形。青紫の石床と星の光。'},
    {id:'wings',name:'双翼の回廊',description:'左右へ広がる十字形。木床と若草色の庭園。'}
  ].map(Object.freeze));
  function floorAt(kind,templateId,x,y,width,height){
    if(x<1||y<1||x>=width-1||y>=height-1)return false;
    if(kind!=='kasai'||templateId==='hall')return true;
    if(templateId==='wings')return x>=7&&x<=16||y>=6&&y<=13;
    const inset=y<5?7-y:y>14?y-12:2;
    return x>=inset&&x<=23-inset;
  }
  const freezeLayout = layout => {
    const floorMask=Object.freeze(Array.from({length:layout.height},(_,y)=>Array.from({length:layout.width},(_,x)=>
      floorAt(layout.kind,layout.templateId,x,y,layout.width,layout.height)?'1':'0').join('')));
    const wallMask=Object.freeze(floorMask.map((row,y)=>Array.from(row,(_,x)=>row[x]==='0'&&[-1,0,1].some(dy=>[-1,0,1].some(dx=>floorMask[y+dy]?.[x+dx]==='1'))?'1':'0').join('')));
    return Object.freeze({...layout,spawn:Object.freeze(layout.spawn),exit:Object.freeze(layout.exit),
      protected:Object.freeze(layout.protected.map(Object.freeze)),floorMask,wallMask});
  };
  const secretLayout=freezeLayout({kind:'secret',templateId:'hall',width:18,height:16,spawn:{x:9,y:12},exit:{x:9,y:14},
    protected:[{x:8,y:0,width:2,height:16}]});
  const operatorLayouts=Object.freeze(Object.fromEntries(templateDescriptions.map(({id})=>[id,freezeLayout({kind:'kasai',templateId:id,
    width:24,height:20,spawn:{x:12,y:16},exit:{x:12,y:18},
    protected:[{x:11,y:0,width:2,height:20},{x:8,y:2,width:8,height:6}]})])));
  const templates=Object.freeze(templateDescriptions.map(template=>Object.freeze({...template,...operatorLayouts[template.id]})));
  const legacyGeometry=({width,height,spawn,exit,protected:reserved})=>Object.freeze({width,height,spawn,exit,protected:reserved});
  const layouts=Object.freeze({secret:legacyGeometry(secretLayout),kasai:legacyGeometry(operatorLayouts.hall)});
  function getLayout(kind,templateId='hall'){
    return kind==='kasai'?(Object.hasOwn(operatorLayouts,templateId)?operatorLayouts[templateId]:operatorLayouts.hall):secretLayout;
  }
  function resolveLayout(value){
    if(typeof value==='string')return getLayout(value);
    const kind=value?.kind||value?.roomType||value?.roomKindTag||value?.roomKind||(value?.width===24&&value?.height===20?'kasai':'secret');
    return getLayout(kind,value?.templateId);
  }
  function isFloor(layoutOrRoom,x,y){
    const layout=resolveLayout(layoutOrRoom);
    return Number.isInteger(x)&&Number.isInteger(y)&&layout.floorMask[y]?.[x]==='1';
  }
  function footprintFits(layoutOrRoom,rect){
    if(!rect||![rect.x,rect.y,rect.width,rect.height].every(Number.isInteger)||rect.width<1||rect.height<1)return false;
    const layout=resolveLayout(layoutOrRoom);
    if(rect.x<0||rect.y<0||rect.x+rect.width>layout.width||rect.y+rect.height>layout.height)return false;
    for(let y=rect.y;y<rect.y+rect.height;y++)for(let x=rect.x;x<rect.x+rect.width;x++)if(layout.floorMask[y][x]!=='1')return false;
    return true;
  }
  const P = Object.freeze({ink:'#263947',deep:'#173b44',navy:'#30475a',teal:'#357b80',teal2:'#529b99',
    mint:'#a7d3b8',cream:'#f1e4c1',gold:'#d8b76d',gold2:'#f3d99a',wood:'#b48b5d',wood2:'#d3b07a',
    wood3:'#7a604b',plum:'#6b5b79',sky:'#82bbca',white:'#f8f2dc'});
  const roomPalettes=Object.freeze({
    hall:Object.freeze({deep:P.deep,gold:P.gold,gold2:P.gold2,light:P.mint,carpet:'#24636a',carpetLight:'#87b6a4',carpetDark:'#2e7175',
      stage:'#d3ceb1',stageInner:'#e4d9b8',stageLight:'#f0e6c8',stageSeam:'#b6b79d',felt:'#28636b',seal:'#729b90',sealDark:'#2d646a'}),
    sanctum:Object.freeze({deep:'#222747',gold:'#c8ac69',gold2:'#f6dfa0',light:'#aacded',carpet:'#434e88',carpetLight:'#abbfdf',carpetDark:'#303960',
      stage:'#8785a8',stageInner:'#c0c6dc',stageLight:'#e1e6f5',stageSeam:'#8a95b8',felt:'#36416e',seal:'#aab7dc',sealDark:'#4d5289'}),
    wings:Object.freeze({deep:'#294d43',gold:'#c69c59',gold2:'#f2d49a',light:'#c8e1b0',carpet:'#63886b',carpetLight:'#c4dcb0',carpetDark:'#486b53',
      stage:'#b48757',stageInner:'#d6b588',stageLight:'#f0d9ac',stageSeam:'#ad8358',felt:'#537e65',seal:'#bcdbad',sealDark:'#3f6c53'})
  });
  const templateOf=m=>m?.roomKind==='kasai'&&Object.hasOwn(roomPalettes,m.templateId)?m.templateId:'hall';
  const opposite = {up:'down',down:'up',left:'right',right:'left'};
  const integer = n => Number.isInteger(n) && Number.isFinite(n);
  const getItem = id => items.get(String(id)) || null;
  const rotationOf = value => [0,90,180,270].includes(value) ? value : 0;
  function footprint(itemOrId,rotation=0) {
    const item = typeof itemOrId==='string' ? getItem(itemOrId) : itemOrId;
    if(!item) return null;
    const sideways = rotationOf(rotation)%180!==0;
    return {width:sideways?item.height:item.width,height:sideways?item.width:item.height};
  }
  function inRect(x,y,rect) { return x>=rect.x&&y>=rect.y&&x<rect.x+rect.width&&y<rect.y+rect.height; }
  function normalizedDecorations(record,layout) {
    const source = Array.isArray(record.decorations) ? record.decorations : Array.isArray(record.decors) ? record.decors : [];
    const result=[],used=new Set(),ids=new Set();
    for(const raw of source.slice(0,32)) {
      const item=getItem(raw?.itemId),rotation=rotationOf(raw?.rotation);
      if(!item||!integer(raw.x)||!integer(raw.y)||!String(raw.id||'')||ids.has(String(raw.id))||![0,90,180,270].includes(raw.rotation))continue;
      const {width:w,height:h}=footprint(item,rotation);
      if(raw.x<1||raw.y<2||raw.x+w>layout.width-1||raw.y+h>layout.height-2)continue;
      if(!footprintFits(layout,{x:raw.x,y:raw.y,width:w,height:h}))continue;
      let valid=true;
      for(let y=raw.y;y<raw.y+h;y++)for(let x=raw.x;x<raw.x+w;x++)
        if(used.has(`${x},${y}`)||layout.protected.some(rect=>inRect(x,y,rect)))valid=false;
      if(!valid)continue;
      for(let y=raw.y;y<raw.y+h;y++)for(let x=raw.x;x<raw.x+w;x++)used.add(`${x},${y}`);
      ids.add(String(raw.id));
      result.push({id:String(raw.id),itemId:item.id,x:raw.x,y:raw.y,rotation});
    }
    return result;
  }
  function createMap(record) {
    if(!record||!record.owner||typeof record.owner.id!=='string'||!record.owner.id)
      throw new TypeError('秘密の部屋の持ち主が見つかりません。');
    const kind=record.kind==='kasai'?'kasai':'secret',layout=getLayout(kind,record.templateId),owner=record.owner;
    const entrance=record.entrance||{},outside=LT.DATA?.maps?.[entrance.map];
    if(typeof entrance.map!=='string'||!integer(entrance.returnX)||!integer(entrance.returnY))
      throw new TypeError('秘密の部屋の出口が見つかりません。');
    const returnPoint={map:entrance.map,x:entrance.returnX,y:entrance.returnY,facing:opposite[entrance.facing]||'down'};
    const tiles=layout.floorMask.map(row=>Array.from(row,value=>value==='1'?'_':'#'));
    const decorations=normalizedDecorations(record,layout),furniture=[],floorDecorations=[];
    for(const d of decorations) {
      const item=getItem(d.itemId),size=footprint(item,d.rotation);
      const f={...d,type:'room-item',w:size.width,h:size.height,solid:item.solid};
      (item.solid?furniture:floorDecorations).push(f);
      if(item.solid)for(let y=f.y;y<f.y+f.h;y++)for(let x=f.x;x<f.x+f.w;x++)tiles[y][x]='B';
    }
    tiles[layout.exit.y][layout.exit.x]='D';
    const defaultName=kind==='kasai'?'カサイの特別対戦ホール':`${String(owner.name||'旅人').slice(0,30)}の秘密の部屋`;
    const name=typeof record.name==='string'&&record.name.trim()?record.name.trim().slice(0,40):defaultName;
    return {
      id:`room:${owner.id}`,name,subtitle:kind==='kasai'?(LT.Admin?.player?.id===owner.id?'あなたの専用ステージ。「秘密部屋」から家具を飾ろう。':'カサイ本人と挑戦者を迎える、特別な対戦ステージ。'):'自分らしい家具を飾って、旅人を迎えよう。',
      revision:Number.isSafeInteger(record.revision)?record.revision:0,roomRevision:Number.isSafeInteger(record.revision)?record.revision:0,
      width:layout.width,height:layout.height,spawn:{...layout.spawn,facing:'up'},
      templateId:layout.templateId,floorMask:layout.floorMask,wallMask:layout.wallMask,
      interior:true,sharedRoom:true,roomKind:kind==='kasai'?'kasai':'home',roomType:kind,roomKindTag:kind,roomOwner:owner.id,
      owner:{id:owner.id,name:String(owner.name||'旅人'),isAdmin:owner.isAdmin===true},
      theme:'village',biome:'town',music:kind==='kasai'?'gym':'inn',parentMap:entrance.map,
      region:outside?.region||'星環本土',stage:outside?.stage||1,district:outside?.district,continent:outside?.continent||1,
      requiredSeals:0,level:Array.isArray(outside?.level)?outside.level.slice():[1,100],encounters:[],
      tiles:tiles.map(row=>row.join('')),furniture,floorDecorations,decorations,
      protected:layout.protected.map(rect=>({...rect})),entrance:{...entrance},returnPoint,
      // Kasai is the connected operator. World presence draws the actual
      // player; an offline NPC copy must never appear in the same seat.
      npcs:[],
      exits:[{...layout.exit,to:returnPoint.map,tx:returnPoint.x,ty:returnPoint.y,facing:returnPoint.facing,door:true,label:outside?.name||'フィールドへ戻る'}],
    };
  }

  // All authored coordinates below are logical pixels. One logical pixel is
  // exactly two world pixels, including highlights, outlines and cast shadows.
  const r=(c,x,y,w,h,color)=>{if(w<=0||h<=0)return;c.fillStyle=color;c.fillRect(x,y,w,h);};
  const hash=(x,y)=>(Math.imul(x+17,374761393)^Math.imul(y+31,668265263))>>>0;
  function polygon(c,points,color) {
    const low=Math.floor(Math.min(...points.map(p=>p[1]))),high=Math.ceil(Math.max(...points.map(p=>p[1])));
    c.fillStyle=color;
    for(let y=low;y<high;y++) {
      const xs=[];
      for(let i=0,j=points.length-1;i<points.length;j=i++) {
        const a=points[j],b=points[i];
        if((a[1]<=y+.5&&b[1]>y+.5)||(b[1]<=y+.5&&a[1]>y+.5))xs.push(a[0]+(y+.5-a[1])/(b[1]-a[1])*(b[0]-a[0]));
      }
      xs.sort((a,b)=>a-b);
      for(let i=0;i+1<xs.length;i+=2)c.fillRect(Math.ceil(xs[i]),y,Math.ceil(xs[i+1])-Math.ceil(xs[i]),1);
    }
  }
  function frame(c,x,y,w,h,fill,edge=P.ink,light=P.cream) {
    r(c,x,y,w,h,edge);r(c,x+1,y+1,w-2,h-2,fill);r(c,x+2,y+1,w-4,1,light);
  }
  function diamond(c,x,y,size,color,inside) {
    polygon(c,[[x,y-size],[x+size,y],[x,y+size],[x-size,y]],color);
    if(inside&&size>3)polygon(c,[[x,y-size+2],[x+size-2,y],[x,y+size-2],[x-size+2,y]],inside);
  }
  function star(c,x,y,size,color=P.gold2) {
    polygon(c,[[x,y-size],[x+2,y-2],[x+size,y],[x+2,y+2],[x,y+size],[x-2,y+2],[x-size,y],[x-2,y-2]],color);
    r(c,x-1,y-1,2,2,P.white);
  }
  function pixel(c,draw) {c.save();c.imageSmoothingEnabled=false;c.scale(2,2);draw();c.restore();}
  function wall(c,m,x,y) {
    const X=x*32,Y=y*32,kasai=m.roomKind==='kasai',template=templateOf(m),scheme=roomPalettes[template];
    if(kasai&&template==='wings'){
      r(c,X,Y,32,32,'#513e32');r(c,X+2,Y+1,28,25,'#cfbc8d');
      for(const yy of[3,12,21]){r(c,X+3,Y+yy,26,1,'#e7d5a8');r(c,X+3,Y+yy+7,26,1,'#ae936b');}
      for(const xx of[1,27]){r(c,X+xx,Y,4,32,'#79533a');r(c,X+xx+1,Y+1,1,28,'#bd9060');}
      r(c,X,Y+26,32,6,scheme.deep);r(c,X,Y+27,32,1,scheme.gold2);
      r(c,X+14,Y+4,3,17,'#557950');
      for(const [dx,dy]of[[-4,4],[4,8],[-4,12],[4,16]]){
        diamond(c,X+15+dx,Y+dy,4,'#739c67');r(c,X+14+dx,Y+dy-1,2,1,'#bad59c');
      }
      return;
    }
    const celestial=kasai&&template==='sanctum';
    const ink=celestial?'#282943':kasai?'#203642':'#514d4a',stone=celestial?'#535876':kasai?'#38545e':'#c1b28e',highlight=celestial?'#7e88a6':kasai?'#587278':'#eadbb8';
    r(c,X,Y,32,32,ink);
    for(let row=0;row<3;row++)for(let col=-1;col<3;col++) {
      const xx=X+col*16+(row%2?8:0),left=Math.max(X+1,xx+1),right=Math.min(X+31,xx+15),yy=Y+row*9+1;
      if(right<=left)continue;
      r(c,left,yy,right-left,7,stone);r(c,left+1,yy+1,right-left-2,1,highlight);
      r(c,left+1,yy+6,right-left-2,1,celestial?'#3b405c':kasai?'#293f4b':'#9d8c70');
    }
    r(c,X,Y+26,32,6,kasai?scheme.deep:P.wood3);r(c,X,Y+27,32,1,kasai?scheme.gold:P.wood2);
    r(c,X+2,Y+29,28,1,celestial?'#8997af':kasai?'#5d786e':'#aa895d');
    if((x===0||x===m.width-1||celestial&&m.floorMask?.[y]?.[x+1]==='1')&&y>0&&y<m.height-1){r(c,X+12,Y,8,28,kasai?scheme.deep:P.wood3);r(c,X+13,Y,1,28,kasai?scheme.gold:P.wood2);}
    if(celestial&&(x+y)%3===0){diamond(c,X+16,Y+12,6,scheme.deep);star(c,X+16,Y+12,4,scheme.gold2);}
  }
  function floor(c,m,x,y) {
    const X=x*32,Y=y*32,kasai=m.roomKind==='kasai',n=hash(x,y),template=templateOf(m),scheme=roomPalettes[template];
    if(kasai&&template==='sanctum'){
      r(c,X,Y,32,32,(x+y)%2?'#394563':'#414d6e');r(c,X,Y,32,1,'#667696');r(c,X,Y,1,32,'#5f7191');
      r(c,X+31,Y,1,32,'#28354f');r(c,X,Y+31,32,1,'#2b3551');
      r(c,X+5,Y+5,8,1,'#4d5d7e');r(c,X+23,Y+25,5,1,'#526382');
      if((x+y)%3===0){diamond(c,X+16,Y+16,5,'#6b7ba0');diamond(c,X+16,Y+16,3,'#bdcce4');r(c,X+15,Y+15,2,2,scheme.gold2);}
    } else if(kasai&&template==='wings'){
      r(c,X,Y,32,32,'#896747');
      for(let row=0;row<4;row++){
        const yy=Y+row*8,seam=6+((n+row*11)%21),wood=['#c7a374','#cfae7c','#c39e6c'][(n+row)%3];
        r(c,X,yy,32,7,wood);r(c,X,yy,32,1,'#ead1a0');r(c,X+seam,yy,1,7,'#93724f');
        r(c,X+3+(row%2)*12,yy+4,8,1,'#b28e62');r(c,X+18-(row%2)*10,yy+2,5,1,'#dfbf8b');
      }
      if((x<7||x>16)&&(x+y)%3===0){diamond(c,X+16,Y+16,8,'#648566');diamond(c,X+16,Y+16,5,'#bbd59c');r(c,X+15,Y+13,1,7,'#41694e');}
    } else if(kasai) {
      r(c,X,Y,32,32,n%3===0?'#3b5660':'#3f5b65');r(c,X,Y,32,1,'#58717a');r(c,X,Y,1,32,'#4f6c73');
      r(c,X+31,Y,1,32,'#304852');r(c,X,Y+31,32,1,'#2f4953');
      r(c,X+4,Y+4,8,1,'#496771');r(c,X+22,Y+26,6,1,'#36515d');
      if((x+y)%3===0){r(c,X+15,Y+14,2,2,'#6d8a88');r(c,X+14,Y+15,4,1,'#6d8a88');}
    } else {
      r(c,X,Y,32,32,'#9e7e58');
      for(let row=0;row<4;row++) {
        const yy=Y+row*8,col=['#c4a271','#caaa77','#c0a070'][(n+row)%3],seam=8+((n+row*13)%19);
        r(c,X,yy,32,7,col);r(c,X,yy,32,1,'#dfbc85');r(c,X+seam,yy,1,7,'#947453');r(c,X+seam+1,yy+1,1,5,'#d7b680');
        r(c,X+3+(row%2)*10,yy+3,8,1,'#b79363');r(c,X+14+(row%2)*3,yy+5,6,1,'#d5b07a');
      }
    }
    if(m.tiles[y-1]?.[x]==='#'){r(c,X,Y,32,3,'#1c354a38');r(c,X,Y,32,1,kasai?scheme.gold:P.wood3);}
    if(m.tiles[y]?.[x-1]==='#'){r(c,X,Y,3,32,'#1c354a30');r(c,X,Y,1,32,kasai?scheme.gold:P.wood3);}
    if(m.tiles[y]?.[x+1]==='#')r(c,X+31,Y,1,32,kasai?scheme.gold:P.wood3);
    if(m.tiles[y+1]?.[x]==='#')r(c,X,Y+31,32,1,kasai?scheme.gold:P.wood3);
    if(m.tiles[y]?.[x]==='D') {
      frame(c,X+3,Y+2,26,28,kasai?P.deep:'#435b57',P.ink,P.gold);
      r(c,X+5,Y+3,22,1,P.gold2);r(c,X+7,Y+26,18,1,P.gold);
      polygon(c,[[X+16,Y+22],[X+9,Y+15],[X+13,Y+15],[X+13,Y+9],[X+19,Y+9],[X+19,Y+15],[X+23,Y+15]],P.cream);
    }
  }
  function ground(c,m,x,y) {
    if(!m?.sharedRoom)return false;
    pixel(c,()=>{
      if(m.tiles[y]?.[x]!=='#'){floor(c,m,x,y);return;}
      if(m.wallMask?.[y]?.[x]!=='0'){wall(c,m,x,y);return;}
      const X=x*32,Y=y*32;r(c,X,Y,32,32,'#111e2c');
      if(hash(x,y)%5===0)r(c,X+10,Y+17,2,1,'#1c2d3d');
    });return true;
  }
  function window(c,x,kasai=false,template='hall') {
    const w=46,h=25,y=1,celestial=kasai&&template==='sanctum',scheme=roomPalettes[template];
    frame(c,x,y,w,h,celestial?'#313b66':kasai?'#284d61':'#426f7d',P.ink,scheme.gold);
    r(c,x+3,y+3,w-6,h-6,celestial?'#5069a0':'#a3c9c2');r(c,x+4,y+4,17,9,celestial?'#8399ca':'#87b7bd');r(c,x+24,y+4,17,9,celestial?'#6e85b6':'#749cac');
    r(c,x+4,y+15,17,6,celestial?'#bec8e5':'#c7ddba');r(c,x+24,y+15,17,6,celestial?'#9bb1d2':'#a8c9ba');
    r(c,x+21,y+2,3,h-4,P.cream);r(c,x+2,y+12,w-4,2,P.cream);
    for(const dx of[0,w-5]){r(c,x+dx,y+1,5,h-3,kasai?scheme.carpet:P.plum);r(c,x+dx+1,y+2,1,h-5,kasai?scheme.light:'#a18f9e');}
    if(celestial){star(c,x+12,y+8,3,scheme.gold2);star(c,x+33,y+18,3,scheme.gold2);}
    r(c,x-2,y+h,50,2,P.wood3);r(c,x-2,y+h,50,1,P.gold2);
  }
  function runner(c,x,y,w,h,kasai,template='hall') {
    const scheme=roomPalettes[template];
    frame(c,x,y,w,h,kasai?scheme.carpet:'#4c7c77',P.ink,scheme.gold);
    r(c,x+3,y+2,1,h-4,scheme.gold);r(c,x+w-4,y+2,1,h-4,scheme.gold);
    for(let yy=y+13;yy<y+h-8;yy+=32){diamond(c,x+w/2,yy,8,kasai?scheme.carpetLight:'#a9c8a4');diamond(c,x+w/2,yy,5,kasai?scheme.carpetDark:'#46706b');r(c,x+w/2-1,yy-1,2,2,scheme.gold2);}
    for(let xx=x+5;xx<x+w-4;xx+=4){r(c,xx,y+h,2,3,P.cream);r(c,xx,y-2,2,2,P.cream);}
  }
  function stage(c,m) {
    const x=8*32,y=2*32,w=8*32,h=6*32,template=templateOf(m),scheme=roomPalettes[template];
    runner(c,11*32,8*32,64,10*32-4,true,template);
    if(template==='wings')for(const side of[1,17])runner(c,side*32+4,9*32+4,6*32-8,2*32-8,true,template);
    r(c,x-2,y+4,w+4,h+2,scheme.deep);frame(c,x,y,w,h,scheme.stage,P.ink,scheme.gold2);
    r(c,x+3,y+3,w-6,h-6,scheme.stageInner);
    for(let row=0;row<6;row++)for(let col=0;col<8;col++) {
      r(c,x+col*32+3,y+row*32+3,27,1,scheme.stageLight);r(c,x+col*32+30,y+row*32+4,1,26,scheme.stageSeam);
    }
    frame(c,x+12,y+12,w-24,h-24,scheme.felt,scheme.deep,scheme.gold2);
    r(c,x+16,y+16,w-32,1,scheme.gold);r(c,x+16,y+h-17,w-32,1,scheme.gold);
    r(c,x+16,y+16,1,h-32,scheme.gold);r(c,x+w-17,y+16,1,h-32,scheme.gold);
    for(const xx of[x+24,x+w-24])for(const yy of[y+24,y+h-24]){diamond(c,xx,yy,10,scheme.gold2);diamond(c,xx,yy,7,scheme.deep);star(c,xx,yy,4,scheme.light);}
    const cx=12*32+16,cy=5*32+2;
    polygon(c,[[cx-49,cy-24],[cx-24,cy-49],[cx+24,cy-49],[cx+49,cy-24],[cx+49,cy+24],[cx+24,cy+49],[cx-24,cy+49],[cx-49,cy+24]],scheme.gold);
    polygon(c,[[cx-46,cy-22],[cx-22,cy-46],[cx+22,cy-46],[cx+46,cy-22],[cx+46,cy+22],[cx+22,cy+46],[cx-22,cy+46],[cx-46,cy+22]],scheme.deep);
    if(template==='sanctum'){
      for(const [dx,dy]of[[-34,-34],[34,-34],[-34,34],[34,34]])diamond(c,cx+dx,cy+dy,4,scheme.light);
      polygon(c,[[cx,cy-38],[cx+9,cy-11],[cx+30,cy-30],[cx+12,cy-8],[cx+38,cy],[cx+12,cy+8],[cx+30,cy+30],[cx+9,cy+11],[cx,cy+38],[cx-9,cy+11],[cx-30,cy+30],[cx-12,cy+8],[cx-38,cy],[cx-12,cy-8],[cx-30,cy-30],[cx-9,cy-11]],scheme.gold2);
      diamond(c,cx,cy,16,scheme.sealDark);diamond(c,cx,cy,9,scheme.light);star(c,cx,cy,5,P.white);
    }else if(template==='wings'){
      for(const [dx,dy]of[[-18,0],[18,0],[0,-18],[0,18]])diamond(c,cx+dx,cy+dy,18,scheme.seal);
      diamond(c,cx,cy,17,scheme.sealDark);star(c,cx,cy,10,scheme.gold2);
    }else{diamond(c,cx,cy,34,scheme.seal);diamond(c,cx,cy,29,scheme.sealDark);star(c,cx,cy,22,scheme.gold2);}
    r(c,x+48,y+h-4,w-96,2,scheme.gold2);r(c,x+52,y+h-2,w-104,2,scheme.stageSeam);
    for(const xx of[2,21])for(const yy of[3,8,13])if(isFloor(m,xx,yy)){diamond(c,xx*32+16,yy*32+16,7,scheme.light);diamond(c,xx*32+16,yy*32+16,4,scheme.felt);}
    // A separate challenger seal keeps the two participants legible at entry.
    diamond(c,12*32+16,16*32+16,15,scheme.gold2);diamond(c,12*32+16,16*32+16,12,scheme.deep);star(c,12*32+16,16*32+16,8,P.cream);
  }
  function dressing(c,m) {
    if(!m?.sharedRoom)return false;
    pixel(c,()=>{
      const kasai=m.roomKind==='kasai',template=templateOf(m),scheme=roomPalettes[template];
      const windows=!kasai?[3*32+8,13*32-8]:template==='sanctum'?[6*32+12,15*32+8]:template==='wings'?[7*32+8,15*32-8]:[3*32+8,19*32+8];
      for(const x of windows)window(c,x,kasai,template);
      const cx=kasai?12*32+16:9*32;
      frame(c,cx-24,3,48,21,kasai?scheme.deep:P.wood3,P.ink,scheme.gold2);
      r(c,cx-20,6,40,1,kasai?scheme.carpetLight:P.wood2);diamond(c,cx,13,8,scheme.gold2);diamond(c,cx,13,5,kasai?scheme.carpet:P.plum);
      for(const sign of[-1,1]){r(c,cx+sign*13-3,12,6,1,scheme.gold);r(c,cx+sign*17-2,14,4,1,scheme.gold);}
      if(kasai)stage(c,m);else runner(c,8*32,3*32,64,11*32-5,false);
    });
    for(const f of m.floorDecorations||[])furniture(c,f,m);
    return true;
  }
  function plane(c,w,h,rotation,paint) {
    c.save();
    if(rotation===90)c.transform(0,1,-1,0,w,0);
    else if(rotation===180)c.transform(-1,0,0,-1,w,h);
    else if(rotation===270)c.transform(0,-1,1,0,0,h);
    paint();c.restore();
  }
  function paintItem(c,id,w,h,rotation) {
    const shade='#172d3c38';
    if(id!=='rug'){r(c,3,h-6,w-6,5,shade);r(c,6,h-7,w-12,7,shade);}
    if(id==='plant') {
      r(c,15,-8,2,31,P.wood3);
      const leaves=[[[15,7],[6,3],[2,-6],[8,-6],[16,3]],[[17,9],[24,3],[29,-3],[29,5],[22,11]],[[16,1],[10,-8],[12,-15],[17,-9],[19,-2]],[[15,15],[5,14],[2,6],[8,7],[16,11]],[[17,16],[25,9],[30,10],[26,17],[18,19]]];
      leaves.forEach((leaf,i)=>{polygon(c,leaf,i%2===rotation%2?P.teal:P.teal2);const p=leaf[1];r(c,p[0]+1,p[1]+1,3,1,P.mint);});
      polygon(c,[[7,18],[25,18],[22,29],[10,29]],P.ink);polygon(c,[[9,19],[23,19],[21,27],[11,27]],'#c28c63');
      frame(c,6,17,20,5,P.wood2,P.wood3,P.cream);r(c,11,23,10,1,P.gold2);r(c,11,25,1,2,P.cream);
    } else if(id==='lamp') {
      r(c,6,26,20,4,P.ink);r(c,9,24,14,3,P.wood3);r(c,11,23,10,2,P.gold);r(c,15,4,2,19,P.gold);r(c,16,5,1,18,P.wood3);
      r(c,3,-6,26,15,'#f3d99a18');r(c,6,-10,20,24,'#f3d99a13');
      polygon(c,[[9,-8],[23,-8],[29,6],[3,6]],P.ink);polygon(c,[[10,-7],[22,-7],[26,4],[6,4]],P.gold2);
      polygon(c,[[11,-6],[15,-6],[13,3],[8,3]],P.cream);r(c,7,5,18,2,P.wood3);r(c,15,-11,2,3,P.gold);
      r(c,23,8,1,7,P.wood3);diamond(c,23,17,2,P.gold);
    } else if(id==='stool') {
      plane(c,w,h,rotation,()=>{
        for(const x of[6,23]){r(c,x,16,3,13,P.wood3);r(c,x,17,1,10,P.wood2);}
        frame(c,3,6,26,17,P.wood2,P.ink,P.cream);frame(c,5,7,22,12,P.teal,P.wood3,P.mint);
        diamond(c,16,13,4,P.gold);r(c,6,21,20,1,P.wood3);
      });
    } else if(id==='table') {
      plane(c,w,h,rotation,()=>{
        for(const x of[7,51]){r(c,x,40,6,20,P.ink);r(c,x+1,40,3,18,P.wood3);r(c,x+1,45,1,12,P.wood2);}
        frame(c,3,2,58,48,P.wood3,P.ink,P.cream);frame(c,4,2,56,43,P.wood2,P.wood3,P.cream);
        for(const x of[18,36,52])r(c,x,4,1,39,P.wood);for(const y of[9,23,37])r(c,8,y,8,1,'#e1bf8b');
        frame(c,13,12,30,23,P.cream,P.wood3,P.white);r(c,16,15,24,16,'#ced6b0');
        polygon(c,[[18,15],[25,17],[23,24],[30,24],[36,31],[30,31],[26,27],[19,27]],P.teal2);star(c,34,20,4,P.wood3);
        frame(c,45,12,8,11,P.plum,P.ink,P.cream);r(c,46,15,6,1,P.gold);frame(c,46,30,7,7,P.cream,P.wood3,P.white);r(c,48,32,3,2,P.wood3);
      });
    } else if(id==='sofa') {
      plane(c,w,h,rotation,()=>{
        frame(c,3,2,58,28,P.deep,P.ink,P.mint);r(c,6,27,4,4,P.wood3);r(c,54,27,4,4,P.wood3);
        frame(c,5,1,54,10,P.teal,P.ink,P.mint);r(c,8,4,48,1,P.teal2);
        for(const x of[10,33]){frame(c,x,11,21,15,P.teal2,P.deep,P.mint);r(c,x+2,23,17,1,P.teal);}
        for(const x of[3,55])frame(c,x,8,7,19,P.teal,P.ink,P.mint);
        frame(c,12,13,10,8,P.cream,P.gold,P.white);r(c,14,15,6,3,P.gold2);
      });
    } else if(id==='shelf') {
      frame(c,2,-15,w-4,h+15,P.wood3,P.ink,P.wood2);
      const bottom=h-3;
      r(c,3,bottom,w-6,4,P.ink);r(c,4,-13,w-8,bottom+13,P.wood);
      for(let yy=-10;yy<bottom-4;yy+=15) {
        r(c,5,yy,w-10,12,'#5a514a');
        const colors=[P.teal,P.plum,'#bd8267',P.mint,P.gold];
        for(let xx=7,k=0;xx<w-8;xx+=5,k++) {
          const bh=7+hash(xx,yy)%4;frame(c,xx,yy+11-bh,4,bh,colors[(k+rotation/90)%colors.length],P.wood3,colors[(k+rotation/90)%colors.length]);
          r(c,xx+1,yy+11-bh+2,2,1,P.cream);
        }
        r(c,4,yy+12,w-8,2,P.wood3);r(c,4,yy+12,w-8,1,P.wood2);
      }
      r(c,3,-15,w-6,2,P.cream);r(c,5,bottom,3,2,P.wood2);r(c,w-8,bottom,3,2,P.wood2);
    } else if(id==='bed') {
      plane(c,w,h,rotation,()=>{
        frame(c,4,1,56,93,P.wood3,P.ink,P.gold);frame(c,7,8,50,79,P.cream,P.wood3,P.white);
        frame(c,3,1,58,11,P.wood2,P.ink,P.cream);r(c,8,3,48,2,P.wood);r(c,29,3,6,5,P.gold2);
        frame(c,12,16,40,17,'#e0d9b8','#b6b69b',P.white);r(c,15,17,34,12,P.white);r(c,17,28,30,1,'#d7cfaa');
        frame(c,8,35,48,48,P.teal,P.deep,P.mint);r(c,9,36,46,6,P.mint);r(c,11,37,42,1,P.cream);
        for(const x of[13,49])r(c,x,43,2,37,P.teal2);
        diamond(c,32,60,14,P.gold);diamond(c,32,60,11,P.teal2);star(c,32,60,7,P.cream);
        frame(c,4,83,56,10,P.wood2,P.ink,P.cream);r(c,8,86,48,3,P.wood);for(const x of[4,54])r(c,x,91,6,4,P.ink);
      });
    } else if(id==='aquarium') {
      frame(c,2,-8,w-4,h+8,P.wood3,P.ink,P.gold);
      frame(c,3,-10,w-6,h+1,'#477e8a',P.ink,P.mint);r(c,5,-7,w-10,h-4,'#6ba5b4');
      r(c,5,-6,w-10,3,'#bce0cf');r(c,5,h-16,w-10,6,'#b8b595');r(c,6,h-15,w-12,1,P.cream);
      r(c,8,-2,2,h-14,'#cee9d477');r(c,11,0,1,9,'#e1f3df88');
      for(const xx of[8,w-12]){r(c,xx,h-22,2,10,P.teal);polygon(c,[[xx+1,h-20],[xx-3,h-26],[xx-4,h-21],[xx+1,h-16]],P.teal2);polygon(c,[[xx+1,h-21],[xx+5,h-28],[xx+5,h-22]],P.mint);}
      const fishX=Math.floor(w/2)-5,fishY=Math.floor(h/3)-7;
      polygon(c,[[fishX,fishY],[fishX+9,fishY-3],[fishX+13,fishY],[fishX+9,fishY+3]],P.gold2);polygon(c,[[fishX,fishY],[fishX-4,fishY-4],[fishX-4,fishY+4]],'#d29364');r(c,fishX+10,fishY-1,1,1,P.ink);
      for(const yy of[-2,5,13]){r(c,w-9,yy,2,2,P.cream);r(c,w-8,yy-1,1,1,P.mint);}
      r(c,3,h-9,w-6,2,P.gold);r(c,5,h-6,3,5,P.wood2);r(c,w-8,h-6,3,5,P.wood2);
    } else if(id==='crystal') {
      polygon(c,[[5,20],[11,17],[23,17],[28,21],[25,29],[8,29]],P.ink);polygon(c,[[6,21],[12,18],[22,18],[26,22],[24,26],[9,26]],P.wood3);r(c,9,23,15,1,P.gold);
      polygon(c,[[16,-17],[26,-5],[24,13],[16,21],[7,12],[6,-4]],P.deep);
      polygon(c,[[16,-15],[23,-4],[21,11],[16,18],[10,10],[9,-3]],P.teal2);
      polygon(c,[[16,-14],[16,16],[10,9],[10,-2]],rotation===180?P.teal:P.mint);polygon(c,[[17,-11],[22,-4],[20,10],[17,15]],'#5aafa9');
      r(c,13,-6,2,11,P.cream);r(c,13,6,1,4,P.cream);star(c,5,-9,3,P.gold2);star(c,27,5,3,P.cream);
    } else if(id==='plush') {
      const rear=rotation===180,side=rotation===90||rotation===270;
      if(rotation===270){c.save();c.translate(32,0);c.scale(-1,1);}
      polygon(c,[[4,4],[1,-8],[8,-3],[11,2],[19,2],[24,-6],[29,-9],[27,7],[28,21],[22,28],[9,28],[4,22]],P.ink);
      polygon(c,[[6,4],[3,-5],[8,0],[12,4],[20,4],[25,-3],[27,-5],[25,8],[26,20],[21,26],[10,26],[6,21]],P.teal2);
      r(c,4,-3,2,5,P.mint);r(c,24,-1,2,6,P.mint);r(c,7,9,3,6,P.mint);
      polygon(c,[[11,16],[20,16],[23,23],[20,26],[11,26],[8,23]],rear?P.teal:P.cream);
      if(!rear){for(const x of side?[21]:[11,21]){r(c,x,9,2,4,P.ink);r(c,x,9,1,1,P.white);}r(c,16,14,3,2,P.wood3);r(c,17,16,1,1,P.ink);}
      for(const x of[5,21]){frame(c,x,24,7,5,P.teal,P.ink,P.mint);r(c,x+2,27,1,1,P.cream);}
      if(rotation===270)c.restore();
    } else if(id==='rug') {
      plane(c,w,h,rotation,()=>{
        for(let x=5;x<60;x+=4){r(c,x,1,2,3,P.cream);r(c,x,60,2,3,P.cream);}
        frame(c,3,4,58,56,P.plum,P.ink,P.gold);frame(c,6,7,52,50,P.teal,P.gold,P.cream);
        r(c,8,9,48,1,P.mint);r(c,8,56,48,1,P.mint);r(c,8,10,1,46,P.mint);r(c,55,10,1,46,P.mint);
        diamond(c,32,32,19,P.gold2);diamond(c,32,32,16,P.plum);diamond(c,32,32,11,P.mint);star(c,32,32,7,P.cream);
        for(const x of[13,51])for(const y of[15,49])diamond(c,x,y,3,P.gold2);
      });
    } else if(id==='banner') {
      const flip=rotation===90||rotation===180;if(flip){c.save();c.translate(32,0);c.scale(-1,1);}
      r(c,5,27,23,3,P.ink);r(c,10,25,13,3,P.wood3);r(c,15,-24,3,50,P.wood3);r(c,15,-24,1,49,P.gold2);
      diamond(c,16,-27,3,P.gold2);r(c,5,-23,25,2,P.gold);
      polygon(c,[[6,-21],[29,-21],[29,5],[18,11],[6,5]],P.ink);polygon(c,[[8,-20],[27,-20],[27,3],[18,8],[8,3]],P.teal);
      r(c,9,-19,17,1,P.mint);r(c,10,-17,1,17,P.gold);r(c,24,-17,1,17,P.gold);star(c,18,-7,6,P.gold2);
      if(flip)c.restore();
    }
  }
  function furniture(c,f) {
    if(f?.type!=='room-item'||!getItem(f.itemId))return false;
    const size=footprint(f.itemId,f.rotation);
    pixel(c,()=>{c.translate(f.x*32,f.y*32);paintItem(c,f.itemId,size.width*32,size.height*32,rotationOf(f.rotation));});
    return true;
  }
  function renderDecor(c,m,options={}) {
    if(!m?.sharedRoom)return false;
    const camera=options.camera||{},x=options.cameraX??camera.x??0,y=options.cameraY??camera.y??0,layer=options.layer||'all';
    c.save();c.translate(-x,-y);
    if(layer==='all'||layer==='floor')dressing(c,m);
    if(layer==='all'||layer==='objects')for(const f of [...(m.furniture||[])].sort((a,b)=>(a.y+a.h)-(b.y+b.h)))furniture(c,f,m);
    c.restore();return true;
  }
  function surface(w,h) {
    if(typeof OffscreenCanvas==='function')return new OffscreenCanvas(w,h);
    const cv=document.createElement('canvas');cv.width=w;cv.height=h;return cv;
  }
  function renderThumbnail(canvasOrContext,itemId,options={}) {
    const item=getItem(itemId);if(!item||!canvasOrContext)return false;
    const c=typeof canvasOrContext.getContext==='function'?canvasOrContext.getContext('2d'):canvasOrContext;
    const target=c.canvas,size=footprint(item,options.rotation),w=size.width*TILE,h=size.height*TILE;
    const cv=surface(w+32,h+88),ctx=cv.getContext('2d');ctx.translate(16,64);
    furniture(ctx,{type:'room-item',itemId,x:0,y:0,rotation:rotationOf(options.rotation)});
    const ratio=Math.min((target.width-8)/cv.width,(target.height-8)/cv.height),dw=Math.max(1,Math.floor(cv.width*ratio)),dh=Math.max(1,Math.floor(cv.height*ratio));
    c.save();c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,target.width,target.height);c.imageSmoothingEnabled=false;
    if(options.background){c.fillStyle=typeof options.background==='string'?options.background:P.deep;c.fillRect(0,0,target.width,target.height);}
    c.drawImage(cv,Math.floor((target.width-dw)/2),Math.floor((target.height-dh)/2),dw,dh);c.restore();
    cv.width=cv.height=1;return true;
  }
  function drawDoor(c,room,options={}) {
    const e=room?.entrance;if(!e||!integer(e.x)||!integer(e.y))return false;
    const t=Number.isFinite(options.tileSize)&&options.tileSize>0?options.tileSize:TILE,kasai=room.kind==='kasai'||room.roomKind==='kasai',active=options.active===true;
    const trim=kasai?P.gold2:P.mint,light=active?P.white:trim;
    c.save();c.translate(e.x*t,e.y*t);c.scale(t/32,t/32);c.imageSmoothingEnabled=false;
    // A bright, outlined doorway stays recognizable against trees, masonry,
    // and building art. Everything fits inside the occupied wall tile.
    r(c,1,0,30,32,P.ink);frame(c,3,1,26,29,kasai?'#596750':P.teal,P.ink,light);
    r(c,5,3,22,25,trim);r(c,7,5,18,23,P.deep);r(c,9,7,14,21,'#1f4c57');
    r(c,15,9,1,19,kasai?P.gold:P.teal2);r(c,7,4,18,2,light);
    for(const x of[3,27]){r(c,x,6,2,20,light);r(c,x,7,1,17,P.cream);}
    // The inset entrance pictogram is intentionally simpler than the door:
    // a roof, an open doorway and a light square on the far side.
    polygon(c,[[10,13],[16,7],[22,13]],P.ink);polygon(c,[[11,13],[16,8],[21,13]],light);
    r(c,11,13,10,9,light);r(c,14,15,4,7,P.deep);r(c,15,16,2,5,kasai?P.gold:P.teal2);
    r(c,21,23,2,3,P.gold2);r(c,3,28,26,2,trim);r(c,1,30,30,2,P.ink);r(c,5,30,22,1,light);
    if(active){for(const [x,y] of [[0,0],[28,0],[0,28],[28,28]]){r(c,x,y,4,1,P.white);r(c,x,y,1,4,P.white);}}
    c.restore();
    if(options.label!==false) {
      const raw=kasai?'カサイの部屋':`${String(room.owner?.name||'旅人').slice(0,10)}の部屋`;
      const label=typeof options.label==='string'?options.label:active?'A / E で入室':raw;
      c.save();c.font='bold 13px sans-serif';c.textAlign='center';c.textBaseline='middle';
      const w=Math.min(174,Math.ceil(c.measureText(label).width)+14),x=e.x*t+t/2,y=e.y*t-11;
      r(c,Math.floor(x-w/2),y-10,w,20,'#1b3545ee');r(c,Math.floor(x-w/2),y+9,w,1,light);
      c.fillStyle=kasai?P.gold2:P.cream;c.fillText(label,x,y,w-10);c.restore();
    }
    return true;
  }
  LT.RoomArt=Object.freeze({catalog,layouts,templates,getLayout,isFloor,footprintFits,getItem,footprint,createMap,ground,dressing,furniture,renderDecor,renderThumbnail,drawDoor,
    tileSize:TILE,pixelStep:2,ready:Promise.resolve()});
})();
